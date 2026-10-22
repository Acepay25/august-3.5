# deepseek-harness :: dsh-llm

**Files in shard:** 229 (read: 227, skipped with reason: 2)
**What this shard covers:** the whole `packages/llm/**` capability group of the DeepSeek Harness monorepo: the provider-neutral `llm` service (message/content-block/stream-chunk vocabulary, request assembler, assistant stream, retry policy, error taxonomy), the two DeepSeek provider plugins (API-key route and account route) and their shared Messages transport (`llm-deepseek`), the twin `llm-pi-ai` adapter that serves other providers through pi-ai catalogs, the `llm-retry` executor, the `token-meter` measurement service, the `deepseek-llm-api-extensions` provider-field registry, and the `plugin-package-inventory-deepseek` contributor.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `packages/llm/deepseek-llm-api-extensions/src/index.ts`
- **Purpose:** A registry that lets independent plugins each own one top-level field on an official DeepSeek LLM API request body, without the base adapter knowing about them.
- **Key abstractions:** `DeepSeekLlmApiExtensionRegistry` (a Cordis `Service` registered as `ctx.deepseekLlmApiExtensions`); `register(field, provider)` → disposer; `prepare(request)` → `{ fields, accept }`.
- **Data flow:** a provider plugin calls `register('dsh_session_log', provider)` inside `ctx.effect(...)`, so the registration is scoped to the registering fiber and released when that fiber disposes. The DeepSeek adapter, after serializing its base Messages body, calls `prepare({ body, sessionId?, purpose?, signal })`. The registry snapshots the provider map, calls every provider's `prepare()` concurrently, structured-clones and deep-freezes each returned JSON value, and returns a frozen `fields` record plus an `accept()` commit.
- **Non-obvious design decisions:**
  - The field name is a **declaration-merged key** on `DeepSeekLlmApiExtensionMap` (`src/types.ts:12`), so a contributor's field name is type-checked at compile time and the *value type* is carried by the generic — a plugin cannot claim a field with the wrong shape.
  - Registration is **effect-scoped** (`index.ts:100-107`): the disposer is obtained from `ctx.effect`, so a plugin reload (HMR) automatically releases the field and another provider may claim it. The test at `tests/registry.spec.ts:66` pins "rejects duplicate fields and releases ownership with the registering fiber".
  - A provider that **throws during preparation is omitted, not fatal** (`index.ts:128-136`). Only the *first* failure per field is logged (`warnedFields`), so a persistently broken contributor cannot spam the log on every request. The request still goes out with the other fields.
  - The value is **cloned and frozen** before being handed back (`freezeJson(structuredClone(...))`, `index.ts:30-36`, `index.ts:130`), so a provider cannot mutate the outgoing request after the fact, and cannot alias its own mutable state into the wire body.
  - **Cancellation is honoured even if a provider ignores the signal**: `abortable()` (`index.ts:52-66`) races the provider work against an abort promise and rejects with `signal.reason`. The test at `tests/registry.spec.ts:118` pins this with a provider that returns a never-settling promise.
  - `accept()` is **idempotent and joined**: `acceptance ??= acceptAll(callbacks)` (`index.ts:141-144`) — concurrent callers await the same settlement and each captured callback runs exactly once.
  - Several acceptance failures become **one `AggregateError`; a single failure is rethrown verbatim** (`acceptAll`, `index.ts:39-50`).
- **Edge cases & failure handling:** blank/未trimmed field names throw synchronously at `register` (`index.ts:90-93`); a duplicate field throws at registration time; a provider returning `undefined` contributes nothing; a value that cannot be structured-cloned is treated as a preparation failure and omitted; a cancellation-induced failure is **not** logged as a warning (`index.ts:132`), so an aborted request does not produce a false alarm.
- **Surprising:** the registry deliberately has **no provider-neutral routing and no pi-ai integration** (documented as a known limitation) — the extension mechanism is DeepSeek-route-only, even though the seam itself is generic. The `accept()` callback is bound to the *provider's* result object (`accept.bind(result)`, `index.ts:137`), so `this` inside `accept` is the provider's own value — pinned by `tests/registry.spec.ts:50`.

### `packages/llm/deepseek-llm-api-extensions/src/types.ts`
- **Purpose:** The type vocabulary of the extension registry.
- **Key abstractions:** `DeepSeekLlmApiJson` (a recursive lossless-JSON union), `DeepSeekLlmApiExtensionMap` (an **empty, declaration-merged** interface — the extension point), `DeepSeekLlmApiExtensionRequest` (`body`, `sessionId?`, `purpose?: 'compaction' | 'session-title'`, `signal`), `DeepSeekLlmApiExtensionProvider<T>`, `PreparedDeepSeekLlmApiExtension<T>` (`value` + optional `accept()`), `PreparedDeepSeekLlmApiExtensions` (`fields` + `accept()`).
- **Data flow:** pure type declarations; no runtime behaviour.
- **Non-obvious design decisions:** the map is declared as an **empty interface with a doc comment telling contributors to declaration-merge it** — this is the "one field per plugin" ownership rule expressed in the type system. The `purpose` union (`'compaction' | 'session-title'`) tells a contributor whether the call is a *real* model request or an auxiliary one, so it can decline (`return undefined`) to contribute a session log for a title-generation call.
- **Edge cases & failure handling:** `accept` is optional, so a provider may contribute a pure payload with no post-2xx commit.
- **Surprising:** `PreparedDeepSeekLlmApiExtensions.accept()` is documented as "Repeated calls join the same settlement" — the type comment is the contract, and the implementation matches.

### `packages/llm/llm-deepseek-api-key/src/config.ts`
- **Purpose:** Configuration for the API-key route, layering the shared Messages config with one credential reference.
- **Key abstractions:** `Config` (extends `ProtocolConfig`, adds `apiKeyEnv: Volatile<string>`), the schemastery `Config` object, `Options`, `ResolvedDeepSeekOptions` (extends `DeepSeekConnectionOptions` with `apiKeyEnv: CredentialRef`), `plainOptions(config)`, `resolveAdapterOptions(config, environment)`.
- **Data flow:** the plugin's live `Config` (all fields `Volatile`) is read through `plainOptions()` into plain values; `resolveAdapterOptions()` turns those into validated endpoint facts **plus** a `credentialRef` for the same generation, so the endpoint and the credential reference can never come from different configuration snapshots.
- **Non-obvious design decisions:** `apiKeyEnv` is a **`CredentialRef`, not a literal secret** — the actual key is looked up at request time through the credentials service or the launch environment (`src/index.ts:26-38`). `apiKeyEnv` is `.volatile()` so a settings edit reaches the next request without re-registration.
- **Edge cases & failure handling:** `resolveAdapterOptions` delegates the protocol validation to the shared `llm-deepseek` resolver, so a bad `baseURL` or bad `maxTokens` fails identically on both routes.
- **Surprising:** the *name* `apiKeyEnv` is a misnomer in the modern path — it names a **credential reference**, which may be a keyring entry, not an environment variable.

### `packages/llm/llm-deepseek-api-key/src/index.ts`
- **Purpose:** Registers the `deepseek-official` route: credential resolution plus model discovery gated on credential presence.
- **Key abstractions:** `apply(ctx, config)`; `PROVIDER = 'deepseek-official'`; `resolveApiKey(connection)`.
- **Data flow:** `resolveApiKey` first asks `ctx.get('credentials')` for the credential ref; only if the credentials service is **absent** does it fall back to `launchEnvironmentOf(ctx).get(ref)`. The key is validated by `assertUsableApiKey` and sent as the `x-api-key` header.
- **Non-obvious design decisions:**
  - **Discovery is credential-gated but the settings entry is not.** A missing credential makes `listModels` return `[]` (hiding the route from model pickers) while `registerConfigurableProviders` still publishes the route so the trader can go and set the key (`src/index.ts:40-42`, `src/index.ts:45-50`). The README states this as an explicit contract.
  - **`MISSING_CREDENTIAL` is swallowed by discovery only.** In `discoverModels` the error is caught and turned into an empty catalog; any *other* error (e.g. `INVALID_CREDENTIAL` from a malformed key) propagates. This is pinned by `tests/discovery.spec.ts:8` and `:37`.
  - The route is registered with `settingsNs: ctx.fiber.entry?.options.id ?? name` — the **Cordis entry id** owns the settings namespace, so two instances of the plugin do not collide.
- **Edge cases & failure handling:** missing credential → `MISSING_CREDENTIAL` naming the *reference* to fix, never any part of the key; malformed credential → `INVALID_CREDENTIAL`.
- **Surprising:** `options()` is called eagerly once at `apply` time purely so a bad configuration fails at load rather than at first request (`src/index.ts:21-22`).

### `packages/llm/llm-deepseek-account/src/catalog.ts`
- **Purpose:** A credential-scoped cache of the account's remote `/models` listing, with single-flight loads, background refresh, and last-known-good retention.
- **Key abstractions:** `AccountModelCatalog`; `CatalogDependencies` (`settings`, `token`, `load`, `now`, `info`, `warn`); `CatalogView` (`{ signedIn, listing }`).
- **Data flow:** `view(signal)` reads the current settings, resolves the account token for the listing URL, computes a **scope** = `url + "\n" + sha256(token)`, and if the scope changed, calls `rescope()` (aborts the in-flight load, clears the listing, bumps a generation counter). The **first** access of a scope awaits the load; later accesses return immediately and kick off a background refresh when the listing is older than `maxAgeMs`.
- **Non-obvious design decisions:**
  - **The scope is keyed by a SHA-256 of the token, not the token itself** (`catalog.ts:88`) — the cache key never contains a secret, and a different account gets a different cache (so the service can roll a model out to some accounts first).
  - **A generation counter makes late results harmless.** `start()` captures `generation`; the load's `.then`/`.catch` both return early if `generation !== this.generation`. This is how "a result that settles after disposal is dropped" and "another account's result discards the previous account's" are both handled without locks.
  - **Single-flight**: `this.inflight` is returned if present, so N concurrent first-accesses cause exactly one HTTP request (`tests/catalog.spec.ts:35`).
  - **Abandoning a wait does not abandon the load.** `abandonable()` (`catalog.ts:36-50`) races the caller's wait against the caller's signal, but the shared load continues and its result still lands in the cache — the test at `tests/catalog.spec.ts:66` pins exactly this ("abandons only the caller's wait when its signal aborts").
  - **Last-known-good retention**: a failed refresh keeps the previous listing and warns **once per failing streak** (`this.failing` flag; `tests/catalog.spec.ts:80` asserts the second consecutive failure does not warn again).
  - The first-use wait is bounded by the request deadline via `deadline(request.signal, settings.timeoutMs, LISTING_TIMEOUT)`.
- **Edge cases & failure handling:** signed out → `{ signedIn: false, listing: undefined }` and no I/O at all; a load that fails before any listing → `listing: undefined` and the caller falls back to the bundled catalog; `dispose()` aborts the in-flight request, bumps the generation, and makes later accesses return the current (empty) view.
- **Surprising:** `catalog.current()` (the last published view, no I/O) and `catalog.view(signal)` (which may await) are separate methods, and the plugin uses `current()` for the hot path (`options: () => connectionOf(catalog.current())`) and `view()` only for discovery and `connect()`.

### `packages/llm/llm-deepseek-account/src/config.ts`
- **Purpose:** Configuration for the account route: the listing endpoint, cache timing, and per-model overrides.
- **Key abstractions:** `Config` (the protocol config **minus** `models`, plus `modelsTimeoutMs`, `modelsMaxAgeMs`, `modelOverrides`), `DEFAULT_MODELS_TIMEOUT_MS = 5_000`, `DEFAULT_MODELS_MAX_AGE_MS = 600_000`, `ModelOverride`, `CatalogSettings`, `ResolvedAccountOptions`, `plainAccountOptions`, `resolveAccountOptions`.
- **Data flow:** `plainAccountOptions()` reads every `Volatile` reference; `resolveAccountOptions()` validates and produces `{ protocol, catalog, modelOverrides }`. The listing endpoint is **derived** from the Messages origin: `new URL('/models', new URL(baseURL).origin)` (`config.ts:90-92`) — the token is only ever sent to the Messages origin.
- **Non-obvious design decisions:**
  - **`models` is deliberately retired.** `resolveAccountOptions` throws `"models is no longer configurable; the account /models listing supplies the catalog"` when the key is present (`config.ts:133-137`). A stored config with `models` therefore **fails at load** rather than silently being ignored. The error names the replacement knob (`modelOverrides.<model id>`).
  - **Override semantics: "declared fields only".** `resolveOverride()` drops `undefined` values and **empty arrays** (`config.ts:100-104`), because an unset array materialises as `[]` in parsed config and `[]` would read as "no modalities" rather than "inherit". The comment at `config.ts:46-47` says this outright.
  - **Overrides are validated by constructing a stand-in model** and running it through the shared resolver (`config.ts:107-112`) — a single validation path for catalog entries and overrides. The stand-in uses `inputModalities: ['text','image']` so that an image-related rule is checked even if the override narrows modalities away.
  - `modelOverrides` keys must be non-empty and must not contain `id` (`config.ts:96-97`).
  - Because "settings updates can reach it without schema validation", **every bound is re-judged in the resolver**, not only in the schema (`config.ts:117-119` doc comment). `modelsTimeoutMs` is checked against `MAX_TIMER_DELAY_MS`, `modelsMaxAgeMs` must be a non-negative safe integer.
- **Edge cases & failure handling:** `modelsTimeoutMs: 0` or above the timer ceiling → throw; `modelsMaxAgeMs: -1` or `1.5` → throw; an empty override key → throw; an override setting `id` → throw; an override violating a cross-field rule → throw with the cause chained.
- **Surprising:** `plainAccountOptions` returns options that **still contain `models`** when the config carries it — the retirement check lives in the resolver, not the schema (`tests/config.spec.ts:44` pins this).

### `packages/llm/llm-deepseek-account/src/index.ts`
- **Purpose:** Registers the `deepseek-account` route: account-token auth, the account model listing, and version gating.
- **Key abstractions:** `apply(ctx, config)`, `TOKEN_HEADER = 'x-dsh-auth-token'`, `LOG_TAG = '[llm-deepseek-account]'`, `refuse(model, refusal)`, `AccountConnection`.
- **Data flow:** `resolveAuth` asks `ctx.get('deepseekAccount')?.resolveToken(baseURL)` for the token; a missing token throws `ACCOUNT_SIGN_IN_REQUIRED`. The `onRequestError` callback rewrites failures: a `QUOTA` failure becomes `ACCOUNT_QUOTA`; a 401 becomes `ACCOUNT_TOKEN_INVALID` and calls `account().rejectToken(token)`. The catalog is consulted through the transport's `connect` and `admit` hooks.
- **Non-obvious design decisions:**
  - **A rejected older request cannot clear a replacement login.** The credential is removed only if it *still matches the request token* — the README says so explicitly, and `account()?.rejectToken(token)` passes the captured token, not "the current one".
  - **Credential-removal failure is swallowed** (`catch (_credentialRemovalFailed) { /* Storage failure cannot replace the inference failure. */ }`) — the 401 must be reported, not replaced by a storage error.
  - **Quota classification is route-specific.** A `QUOTA` failure from the shared transport is rewritten to `ACCOUNT_QUOTA` so the account route's top-up action appears for account failures only, never for an API-key or third-party failure. The test at `tests/account-quota.spec.ts:39` pins the three-way distinction, and the in-band SSE error case at `:52` proves the rewrite happens for stream errors too.
  - **The listing is logged once per listing, not per access** (`loggedListing` identity check), and hidden entries are reported to `console.warn` under the `[llm-deepseek-account]` tag. **Secrets are never logged.**
  - **Override diagnostics are published on the provider directory** (`directory.replace([...{ error }])`) so the Models page shows a stale-override error — but only when the error string *changes* (`reportedError` guard), avoiding a directory churn on every request.
  - The account route has **no `apiKeyEnv` field at all** — `Account.Config({})` does not have the property (pinned by `tests/provider.spec.ts:44`).
- **Edge cases & failure handling:** signed out → `ACCOUNT_SIGN_IN_REQUIRED`; a 403 does **not** clear the login; a listing HTTP 401 does **not** remove the stored login; an in-flight listing request is aborted on plugin disposal (`ctx.effect` disposer calls `catalog.dispose()`).
- **Surprising:** the account route **never falls back to an API key**, and the API-key route never uses an account token — two independent credential worlds sharing one transport.

### `packages/llm/llm-deepseek-account/src/listing.ts`
- **Purpose:** Decodes DeepSeek's `GET /models` listing entry by entry and owns the request lifecycle for it.
- **Key abstractions:** `LISTING_TIMEOUT = 'MODEL_LISTING_TIMEOUT'`, `ClientRequirement` (`none` | `min-version` | `invalid`), `ListedFacts`, `ListedCapabilities` (`usable: true` + facts | `usable: false` + reason), `ListingEntry`, `ModelListing`, `parseModelListing(body)`, `requestModelListing(url, headers, signal)`.
- **Data flow:** `requestModelListing` does one `fetch` with `redirect: 'error'`, `accept: application/json`, attribution headers and the auth header, then `JSON.parse` → `parseModelListing` → `ModelListing`.
- **Non-obvious design decisions:**
  - **Redirects are refused** (`redirect: 'error'`) so the account token cannot leave the requested origin — the README calls this out and the test at `tests/listing.spec.ts:107` pins it.
  - **The listing is decoded defensively, row by row.** A row without a usable id, or a repeated id, is **skipped** and counted (`skipped`), and the *count* is reported. A row with unusable capabilities is **not** skipped: its id and name still reach the caller, with `usable: false` and a reason — so the operator can see that a model exists but this build cannot drive it.
  - **Capabilities are narrowed to this build's vocabulary**: `knownModalities` keeps only `text`/`image`, preserves listing order, and drops repeats. A declared `system_prompt_update` other than `in-history` reads as `leading-only` — a *safe* interpretation of an unknown mode.
  - **Client requirements are namespaced by product token**: `client_requirements[APP_IDENTITY.product].min_version`. A requirement under a *different* product key is ignored (`kind: 'none'`); a malformed requirement is `kind: 'invalid'`.
  - The listing's `effort` block is **deliberately not read** (documented limitation) — every model offers `off`/`low`/`high`/`max`.
- **Edge cases & failure handling:** no `data` array or no usable entry → `LlmError('INVALID_RESPONSE')`; non-2xx → `HTTP_<status>`; a timeout deadline → `TIMEOUT` with the elapsed ms in the message; another abort → `ABORTED`; a network failure → `TRANSPORT`; a non-JSON body → `INVALID_RESPONSE`.
- **Surprising:** `capacity()` returns a **tri-state** (`undefined` absent, `false` invalid, number valid) so "absent" and "declared but wrong" are distinguishable — a declared `context_window: 0` makes the whole entry unusable, while an absent one is fine.

### `packages/llm/llm-deepseek-account/src/resolve-catalog.ts`
- **Purpose:** Turns a remote listing + this build's own model knowledge + deployment overrides into the catalog the route serves, and into the refusals the route enforces.
- **Key abstractions:** `CatalogRefusal` (`upgrade-required` | `unsupported`), `AccountCatalogInput`, `AccountCatalog` (`offered`, `resolution`, `refusals`, `problems`, `overrideErrors`), `resolveAccountCatalog(input)`, `layered()`, `listed()`, `gateOf()`.
- **Data flow:** with no listing → the bundled catalog is offered. With a listing → each entry is gated (`gateOf`), then capability-checked, then **layered over** this build's entry for the same id (`listed()`), then the override is layered on top (`withOverride`).
- **Non-obvious design decisions:**
  - **The version gate is the only thing that can offer an unknown model.** `gateOf` returns `unsupported` for an unknown model with *no* declared minimum version — the build must already know the model. But an unknown model **with** a satisfied `min_version` is offered, with listed metadata only (no `toolUpdate`, no description). That is the "vouched model" concept, and it is the mechanism by which the service rolls a new model out ahead of the client.
  - **Prerelease semantics are explicit**: `semver.gte(clientVersion, requirement.version)` — a prerelease orders *below* its release, so `min_version: 0.2.1` refuses `0.2.1-alpha.2`. The README tells operators to declare the *earliest* prerelease they admit (`0.2.1-alpha.0`).
  - **A listing can *remove* an inherited capability.** `listed()` strips `systemPromptUpdate` from the base when the listing says `leading-only`, and `layered()` **drops inherited image limits** when the merged result is text-only (`resolve-catalog.ts:56-63`).
  - **`max_output_tokens` bounds the request default**: `maxTokens: Math.min(routeMaxTokens, facts.maxOutputTokens)`.
  - **Two lists, not one.** `offered` is what the model picker shows; `resolution` additionally contains the bundled models the listing does not offer, so a request for a bundled model still resolves. `offered` is a **slice** of `resolution` (`resolution.slice(0, offered.length)`) — the two are kept in one array so a single `resolveAdapterOptions` call validates both.
  - **An override is validated by re-resolving the merged model**; a failure produces an `overrideError` string and the *unmodified* model is used — a bad override degrades to the model, it does not break the route.
  - An override naming a model that neither the listing nor the bundled catalog describes is reported as an error, but the override for a *refused* model is only judged once the version can serve it (documented in the README).
- **Edge cases & failure handling:** an unreadable `min_version` → `unsupported` + a `problems` entry; a malformed `client_requirements` → `unsupported`; an entry with no `api_capabilities.anthropic_messages` → `unsupported` + a `problems` entry.
- **Surprising:** `problems` deliberately **excludes** unknown-but-vouched models — only *unreadable* declarations and unusable capabilities are reported, so the operator's log is not a list of new models.

### `packages/llm/llm-deepseek/src/adapter.ts`
- **Purpose:** The DeepSeek Messages transport: one cancellable lifecycle per model request, from image preparation to SSE translation.
- **Key abstractions:** `DeepSeekAdapter<C extends Connection>` (extends the core `LlmAdapter`); `generate()`, `request()`, `providerInfo`, `providerRetryPolicy`, `listModels`, `resolveModel`, `imageRequestPricing`, `imageRequestTarget`, `prepareCall`, `stream`.
- **Data flow:** `stream(options)` → `generate()` builds a `consumer` AbortController, combines it with the caller's signal via `AbortSignal.any`, arms an **idle watchdog** (`idleWatchdog(signal, connection.streamIdleTimeoutMs, 'MESSAGES_IDLE')`), and pumps `request()` through `watchdog.next(iterator)`. `request()` prepares images, resolves auth, then loops: `files.beginAttempt()` → `prepareFileIds` (or fall back to inline on `FileResolutionFailure`) → `serialize(...)` → `prepareRequestExtensions(...)` → `fetch` → on non-2xx, optionally `files.retry(detail)` and `continue`; on 2xx, `extensions.accept()` then `translate(parseSse(...))`.
- **Non-obvious design decisions:**
  - **The idle watchdog is a "no bytes" timeout, not a total-request timeout.** `activity()` pulses it on every SSE event *and* on every heartbeat comment (`sse.ts:15` passes `onComment: activity`). A long-but-progressing stream is fine; a silent provider is not. Default 5 minutes.
  - **The generator's teardown deliberately does not await the iterator's drain** (`adapter.ts:104-108`): a demand the deadline abandoned can stay pending forever, and the generator queues its own return behind that demand, so awaiting the drain would re-hang the settled outcome. The comment says this outright — it is a real, documented deadlock avoided.
  - **One stale-file retry only.** `RequestFiles.retry()` returns `true` at most once per request (`request-files.ts:145`).
  - **File-mode and inline-mode are never mixed in one request.** A Files resolution failure flips the whole request to inline base64 (`inline = true`), and the whole request is rebuilt.
  - **Beta headers are computed from the actual body**: `files-api-2025-04-14` only when file ids are present, `mid-conversation-tool-changes-2026-07-01` only when the body actually contains `tool_addition`/`tool_removal` blocks.
  - **The request carries the harness identity headers outside model input**: `x-deepseek-harness-user-id` (a stable anonymous id), `x-deepseek-harness-session-id`, and `x-deepseek-harness-compact: 1` for a compaction request.
  - `prepareCall()` resolves the connection *first* (which may load a provider catalog) and then calls `admit()`, so a refused model fails **before** any network I/O.
- **Edge cases & failure handling:** an idle timeout becomes `TIMEOUT` with the message "DeepSeek Messages stream idle timeout"; a caller abort becomes `ABORTED`; anything else becomes `TRANSPORT`; an empty body becomes `EMPTY_RESPONSE`. The `catch` around `auth.onRequestError` re-throws the *original* error if the failure callback itself throws (`adapter.ts:186-189`).
- **Surprising:** `stream()` (the adapter-level method) and `prepareCall()` (the service-level method) are two entry points to the same `generate()`; the difference is that `prepareCall` resolves a *connected* snapshot (awaiting provider work) and `stream` uses the plain options thunk.

### `packages/llm/llm-deepseek/src/config.ts`
- **Purpose:** The plugin configuration schema and the one explicit resolve step from raw config to validated protocol facts.
- **Key abstractions:** `Config` (all fields `Volatile`), `Options`, `plainOptions(config)`, `catalogModelFields`, `deepSeekConfigFields`, `resolveModels()`, `resolveAdapterOptions(config, environment)`, `PUBLIC_BASE_URL = 'https://api.deepseek.com/anthropic'`, `BASE_URL_ENV = 'DEEPSEEK_BASE_URL'`.
- **Data flow:** `plainOptions` reads every `Volatile` reference; `resolveAdapterOptions` re-validates every bound and returns `DeepSeekConnectionOptions` (base URL, defaults, caps, catalog, image/Files policies, resolved retry policy).
- **Non-obvious design decisions:**
  - **The resolve step re-judges everything**, because "Programmatic construction may bypass Schemastery normalization" and "a dynamic config update reaches this check without schema validation" (`config.ts:196-204`). Every default and bound is checked twice: once in the schema, once here. This is the repo's central pattern — *validation at the boundary, re-validation at the point of use*.
  - **Cross-field checks live in the resolver**, not the schema: `thinking: 'disabled'` with a non-`off` `reasoningEffort` is rejected; each offload quantum must not exceed its own budget; `fileRefreshMarginSeconds` must be below `fileExpiresAfterSeconds`.
  - **The base URL is rejected if it carries credentials, a query, or a fragment** (`config.ts:283-285`) — a "no secrets in a URL" rule enforced at the wire boundary.
  - **`$DEEPSEEK_BASE_URL` is honoured from trusted environment layers only** — and the comment says the product trusts the project it is launched in, so a checkout can point its own agent at the gateway that checkout is meant to use.
  - **Cross-field rules are also applied to a "text-only stand-in"** for overrides: a text-only model may not declare image request limits (`config.ts:169-171`).
  - `imageDetail` is explicitly **retired** with a migration message (`config.ts:150-152`).
- **Edge cases & failure handling:** duplicate catalog ids → throw; empty name / non-positive `contextWindow` / non-positive `maxTokens` → throw; empty or duplicated `inputModalities` → throw; `systemPromptUpdate` other than `in-history` → throw; `toolUpdate` outside the two allowed values → throw.
- **Surprising:** `resolveModels` **strips** unknown/absent fields and always materialises `imageMaxBytes` for an image-capable entry (default 2 MiB) — the returned object is a *normalised* record, not the input.

### `packages/llm/llm-deepseek/src/defaults.ts`
- **Purpose:** The shared numeric defaults for the DeepSeek route.
- **Key abstractions:** `DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000`, `DEFAULT_CONTEXT_WINDOW = 1_000_000`, `DEFAULT_MAX_TOKENS = 256_000`, `DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES = 20 MiB`, `DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM = 64 MiB`, `DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM = 10 MiB`, `DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM = 20`, `DEFAULT_FILE_EXPIRY_SECONDS = 7 days`, `DEFAULT_FILE_REFRESH_MARGIN_SECONDS = 3600`, `DEFAULT_FILE_QUOTA_CLEANUP_BATCH = 100`, `DEFAULT_FILES_API_TIMEOUT_MS = 60_000`.
- **Data flow:** constants only; consumed by `config.ts` and `request-pricing.ts`.
- **Non-obvious design decisions:** the offload **quanta are deterministic steps**, not proportional fractions — "The stepped high-watermark policy avoids rewriting an old request prefix after every new image" (README). Removing a fixed 64 MiB / 10 MiB / 20-image prefix keeps the *prefix* byte-stable, which is what preserves the provider's KV cache.
- **Edge cases & failure handling:** n/a (constants).
- **Surprising:** the 128 MiB *file-mode* budget lives in `request-pricing.ts` while the 20 MiB *inline* budget lives in `defaults.ts` — the two halves of the same policy are split across two files.

### `packages/llm/llm-deepseek/src/file-id.ts`
- **Purpose:** Branded identifier types for the DeepSeek Files API.
- **Key abstractions:** `DeepSeekFileId` (branded string), `DeepSeekFileScope` (branded string), and the two branding functions.
- **Data flow:** `DeepSeekFileId(id)` brands a provider-returned id "after wire validation"; `DeepSeekFileScope(scope)` brands a locally derived namespace digest.
- **Non-obvious design decisions:** the branding is a **type-level** identity only — the function is a bare `as` cast, and the *validation* happens at the wire boundary in `files-api.ts`. The doc comment says so.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the comment on `DeepSeekFileScope` calls it a "Non-secret digest identifying one endpoint and API-key file namespace" — the word "non-secret" is a promise enforced elsewhere (the digest is of a *hash*, never of a key).

### `packages/llm/llm-deepseek/src/host.ts`
- **Purpose:** Shared Host wiring for the DeepSeek protocol adapter: attachments, request extensions, anonymous identity, and atomic retry-policy updates.
- **Key abstractions:** `registerDeepSeekProvider<C>(ctx, provider, dependencies)`.
- **Data flow:** constructs a `DeepSeekAdapter` with the provider's `options`/`resolveAuth`/`connect`/`admit` plus the host's `resolveUserId`, `resolveAttachments`, `resolveImageAccess`, `prepareExtensions`, and three diagnostic callbacks. Registers it on `ctx.llm.registerAdapter([provider], adapter)`.
- **Non-obvious design decisions:**
  - **The retry policy is the only fact captured at registration.** When its resolved value changes (a `loader/volatile-update` event), the route is **re-registered in place** (`registration.replace([provider])`) in one synchronous section, so no request observes a gap (`host.ts:73-82`). Everything else is read per request through a thunk.
  - **Diagnostics are logged once per route/reason, not per request.** Three `Set`s (`degradedReplays`, `omittedRoutes`, `unacceptedRoutes`) suppress repeats (`host.ts:24-27`). A degraded replay key includes the *reason*, so a new reason is reported once too.
  - `deepEqualJson(policy, registeredPolicy)` avoids a needless re-registration when the value is structurally identical.
  - The settings service is **configured with `auto: false`** under the child fiber, so the route's settings are not auto-persisted.
- **Edge cases & failure handling:** a config change that throws while resolving the policy is logged and **ignored** (the old policy stays) rather than crashing the listener.
- **Surprising:** `resolveUserId` memoises the anonymous id in a closure (`() => userId ??= getOrCreateAnonymousUserId()`) — the id is stable for the process, not per request.

### `packages/llm/llm-deepseek/src/images.ts`
- **Purpose:** Deterministic Messages image preparation: Files references first, bounded inline fallback second.
- **Key abstractions:** `prepareImages(history, connection, modelId, attachments, access, signal)`, `inlineImages(messages, versions, connection)`, `prepareFileIds(messages, versions, files)`, `bounds(connection, representation)`.
- **Data flow:** `projectOffloadedImages` replaces already-offloaded images with their deterministic placeholder text; retained images are read once per attachment id into `versions` (a `RequestImageAttachment`); the byte/count budget is then checked.
- **Non-obvious design decisions:**
  - **Offloaded images are projected to text *before* any model lookup**, so an image the harness already decided to offload costs no upload and no visual tokens.
  - **The budget is checked twice, against two different representations**: `assertImagesFit(..., 'raw')` for the Files budget and `'base64'` for the inline budget. Crossing either throws `IMAGE_OFFLOAD_REQUIRED` with the **count of additional oldest occurrences to offload** in `failure.offloadImages` — a machine-readable instruction, not a prose apology.
  - **The failure names the quantum**: "N more oldest occurrence(s) must be offloaded" — the caller removes exactly that prefix.
  - **Images are only allowed in user messages and tool results** (`UNSUPPORTED_CONTENT`), and only for a vision model with an attachment service mounted.
- **Edge cases & failure handling:** no image in the history → returns immediately without touching the attachment service; a text-only route → `UNSUPPORTED_CONTENT`; an image in an assistant message → `UNSUPPORTED_CONTENT`.
- **Surprising:** the *number* of occurrences to offload is computed by `requiredImageOffload` in the core `llm` package — the count is by **occurrence**, not by unique attachment, because the same image can appear in several messages.

### `packages/llm/llm-deepseek/src/messages-api.ts`
- **Purpose:** The shared Messages endpoint root and the two required beta opt-ins.
- **Key abstractions:** `MESSAGES_FILES_BETA = 'files-api-2025-04-14'`, `MESSAGES_TOOL_CHANGES_BETA = 'mid-conversation-tool-changes-2026-07-01'`, `messagesApiRoot(baseURL)`.
- **Data flow:** `messagesApiRoot` strips trailing slashes and appends `/v1` **unless** the path already ends in `/v1`.
- **Non-obvious design decisions:** the "already ends in `/v1`" exception exists because a user-supplied `baseURL` may already point at the versioned root; appending again would produce `/v1/v1/messages`.
- **Edge cases & failure handling:** n/a — the base URL's protocol/credential/query rules are enforced in `config.ts`.
- **Surprising:** the beta flags are **named constants in one place** and referenced by both the adapter (which decides whether to send them) and the Files client (which always sends the files one) — a single source for a wire-level fact.

### `packages/llm/llm-deepseek/src/model-info.ts`
- **Purpose:** Protocol-independent model capabilities and the reasoning-effort ladder a route advertises.
- **Key abstractions:** `catalogModelInfo(provider, model)`; `modelInfo(connection, provider, model)`; the four-entry `REASONING_EFFORTS` table (`off` / `low` / `high` / `max`) and the `OFF_ONLY_REASONING_EFFORTS` table.
- **Data flow:** the resolved connection's model entry plus the request's provider/model are turned into an `LlmModelInfo` (selector metadata) and an `LlmResolvedModelInfo` (exact capabilities). `catalogModelInfo` is the *advisory* projection used by the model picker; `modelInfo` is the *exact* projection used by the runtime.
- **Non-obvious design decisions:**
  - **The effort ladder is a table of `{ id, name, description }`, not bare strings.** Each level carries a human description ("Use for simple tasks that do not need reasoning.", "The default balance for most tasks.", "Reserve for the hardest quality-first tasks."), so a UI can render the control without inventing copy.
  - **A route that disables thinking publishes exactly one effort (`off`).** The `OFF_ONLY_REASONING_EFFORTS` table exists for that case, and the runtime test pins that the resolved model then advertises `off` as both the only effort and the default.
  - **The catalog projection is a strict subset of the exact projection.** The picker sees `{ provider, id, name, description?, inputModalities? }`; the exact projection adds the context window, the output default, the effort ladder, and the system-prompt update mode.
- **Edge cases & failure handling:** an effort the route does not support is refused *before* network I/O (`UNSUPPORTED_REASONING_EFFORT`); a model with no exact entry falls back to the route's default context window and the text-only modality.
- **Surprising:** `off` is expressed as `thinking: { type: 'disabled' }` on the wire, and `output_config.effort` is then **omitted entirely** — the "off" state is a *disabled thinking* flag, not an `off` effort value.

### `packages/llm/llm-deepseek/src/wire-types.ts`
- **Purpose:** The Messages wire body types — the shape the DeepSeek route actually sends.
- **Key abstractions:** `WireBlock` (the union of `text`, `image`, `tool_use`, `tool_result`, `thinking`, and the two tool-change reference kinds); `WireInput`; `WireMessage`; `WireRequest`.
- **Data flow:** `serialize()` produces a `WireRequest`; the adapter `JSON.stringify`s it. The types are the only description of the wire in the package.
- **Non-obvious design decisions:**
  - **`thinking` is a first-class wire block with an optional `signature`** — the native-thinking replay payload is part of the protocol vocabulary, not an adapter-private extra.
  - **`tool_update` is encoded as `tool_use` / `tool_removal` reference kinds** rather than a separate mechanism, so the tool-change capability is expressed in the same block language as everything else.
  - **`WireRequest.thinking` is always present** (`{ type: 'enabled' | 'disabled' }`) — the route never leaves the provider to guess.
  - **`output_config.effort` is optional** and only present when the effort is not `off`.
- **Edge cases & failure handling:** the type forces `max_tokens` to be present and `stream: true` to be literal — the wire shape cannot drift to a non-streaming or unbounded request.
- **Surprising:** the `tools` entries carry `defer_loading?: true` — "Delays tool availability until a tool_addition block activates it" — so the *deferred* tool state is part of the protocol vocabulary, not a harness invention.

### `packages/llm/llm-deepseek/src/models.ts`
- **Purpose:** The default DeepSeek model catalog.
- **Key abstractions:** `DEFAULT_MODELS` — two entries: `deepseek-flash` (text+image, `systemPromptUpdate: 'in-history'`, `toolUpdate: 'addition-only'`, 1M context) and `deepseek-v4-pro` (text only, with a description).
- **Data flow:** consumed as the default for `deepSeekConfigFields.models`.
- **Non-obvious design decisions:** the catalog is **advisory only** — "deployments may replace the catalog" and unlisted ids still pass through as text-only routes. The `deepseek-flash` entry declares the two capability flags that change the *wire shape* (`in-history` system updates, `addition-only` tool activation), so the default route exercises the interesting code paths.
- **Edge cases & failure handling:** n/a.
- **Surprising:** `deepseek-v4-pro` is the "stronger, more expensive" model and is deliberately the *text-only* one, while the cheaper Flash is the multimodal one.

### `packages/llm/llm-deepseek/src/replay.ts`
- **Purpose:** Minimal native thinking metadata for replaying assistant turns back to the provider.
- **Key abstractions:** `ReplayBlock` (`text` | `reasoning` | `tool-call`, optional `signature`), `object(value, code)`, `replayState(model, blocks)`, `readReplay(message, model, onDegrade)`.
- **Data flow:** the response translator accumulates one `ReplayBlock` per emitted block; `replayState()` wraps them in a versioned envelope `{ response: { kind: 'deepseek-messages', version: 1, model }, blocks }`, which the shared assembler persists next to the durable content. On the next request, `readReplay()` validates the envelope against the stored message.
- **Non-obvious design decisions:**
  - **The envelope carries metadata only, never the response text** — "durable Harness blocks own all response text". The block count must equal the content count, and each block's `type` must match the content block's type.
  - **Cross-model signatures are not portable**: `validateReplay` returns `undefined` (silently, no degrade warning) when `response.model !== model`. The *stored* model must match the message's own source model, or it is a hard degrade.
  - **Degradation is graceful**: `readReplay` catches `INVALID_REPLAY_STATE` and calls `onDegrade(reason)` with the message text, then returns `undefined` — the text and tool history are retained, only the *signatures* are dropped.
  - `object()` is the shared "reject malformed JSON objects" guard, reused by `sse.ts` and `translate.ts` with a different code.
- **Edge cases & failure handling:** unsupported kind/version, model mismatch, block-count mismatch, block-type mismatch, and a signature on a non-reasoning block are all `INVALID_REPLAY_STATE`. The `onDegrade` diagnostic receives **no message content and no signatures** (stated in the doc comment).
- **Surprising:** `readReplay` re-throws any non-`LlmError` or any error with a different code, so a future failure inside the validator is not silently swallowed by the degrade path.

### `packages/llm/llm-deepseek/src/request-extensions.ts`
- **Purpose:** Merges plugin-contributed top-level fields into the Messages body and commits their delivery after HTTP acceptance.
- **Key abstractions:** `prepareRequestExtensions(body, options, prepare, onOmitted, onUnaccepted)` → `{ payload, accept() }`.
- **Data flow:** `prepare()` is called with the exact serialized base body; the merged object is `JSON.stringify`'d; `accept()` runs the registry's joint commit.
- **Non-obvious design decisions:**
  - **A field that collides with a base Messages field is a hard error** (`REQUEST_EXTENSION`), not a silent override — the check is `Object.hasOwn(body, field)`.
  - **If the merged request fails to serialize, the base request alone is sent** and acceptance is skipped, so contributors **resend their state on a later request** instead of losing it. This is the "at-least-once delivery" choice, and the README states it.
  - **An acceptance failure after 2xx is logged but does not fail the request** — the stream still flows to the user.
- **Edge cases & failure handling:** a preparation rejection → `LlmError('REQUEST_EXTENSION')` with the **cause chain appended to the message** via `errorChain(error)`; a serialization failure → warn + base-only payload; an acceptance failure → `onUnaccepted` only.
- **Surprising:** the "omitted" diagnostic carries the *field names* and the error, and `host.ts` logs it **once per route** — a permanently broken contributor produces one log line, not one per request.

### `packages/llm/llm-deepseek/src/request-files.ts`
- **Purpose:** Request-scoped Files state: resolution, bounded stale-id recovery, and normalized-image diagnostics.
- **Key abstractions:** `RequestFiles` (`beginAttempt`, `resolve`, `retry`, `errorMessage`), `FileResolutionFailure`, `ImageWireLocation`, `providerRejectedFileId(detail)`, `providerRejectedNormalizedImage(detail)`, `detailNamesFileId(detail, fileId)`, `staleMappings`, `normalizedImageDiagnostic`.
- **Data flow:** `resolve()` uploads one image under its own deadline (`deadline(this.signal, this.timeoutMs, 'DEEPSEEK_FILES_API_TIMEOUT')`) and records the occurrence; `retry(detail)` classifies the provider's error text and, if it names a stale file id, invalidates the mappings in **one index update** and permits one more attempt; `errorMessage()` rewrites a 400 "image rejected" into a diagnostic that names the actual uploaded image occurrences.
- **Non-obvious design decisions:**
  - **Provider errors are classified by *regex over the message text*** — a deliberate, brittle-but-explicit choice: `/expired|not found|deleted|does not exist/iu` plus a file-id mention means "stale id". This is the only way to recover without a structured provider error.
  - **A file id is matched only when it is not surrounded by word characters** (`detailNamesFileId` checks the characters on both sides) — so `file_abc123` inside a longer token does not match.
  - **`staleMappings` prefers the ids the provider named**; if it named none, *every* mapping used by the attempt is invalidated — a conservative default.
  - **At most one stale-id retry per request** (`this.retried` flag), and the retry count is per request, not per file.
  - **The normalized-image diagnostic is unusually good**: it names the file, the message index, the image index, the media type, the colour space (`sRGBA`/`sRGB`), and the pixel dimensions, and it explains *why* ("the provider rejected bytes already normalized by the harness; PNG, JPEG, WebP, and GIF remain supported input formats"). When the provider did not identify a file, it lists **all candidate images** instead of guessing.
- **Edge cases & failure handling:** an upload failure that is not a caller abort becomes `FileResolutionFailure`, which the adapter converts into a whole-request inline fallback; the upload deadline is per image, and the caller signal still bounds the whole request.
- **Surprising:** `resolve()` calls `this.activity()` after a successful upload — uploading counts as *stream activity* for the idle watchdog, so a long upload does not trip the 5-minute idle timeout.

### `packages/llm/llm-deepseek/src/request-pricing.ts`
- **Purpose:** Provider-side request-image pricing for the DeepSeek route, consumed synchronously by the token meter.
- **Key abstractions:** `DEFAULT_MAX_REQUEST_FILES_BYTES = 128 MiB`, `DEFAULT_MAX_IMAGES_PER_REQUEST = 600`, `DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET = 512*512`, `DEFAULT_REQUEST_IMAGE_MAX_BYTES = 2 MiB`, `REQUEST_IMAGE_MAX_DIMENSION = 4096`, `resolveRequestImageMaxBytes(model)`, `resolveRequestImageTarget(model, source)`, `deepSeekImageRequestPricing(connection, model, resolveAccess)`.
- **Data flow:** the pricing function returns `priceImages(images)` — a pure function over the *occurrences* selected by the harness's offload decisions, so the token meter can price a request **before** it is sent.
- **Non-obvious design decisions:**
  - **The pricing mirrors the actual serialisation exactly.** A text-only route prices each occurrence as `textOnlyImageText`; an offloaded occurrence prices as its placeholder text; a retained occurrence prices as `deepSeekImageTokens(target.width, target.height)` plus its handle text. "Provider usage remains the authoritative anchor for completed requests" — the price is an estimate, the usage is truth.
  - **Every request image is capped at 4096 px per side**, the provider's limit for requests carrying 15+ images, so the image count never changes a projection.
  - **Small images are never enlarged** — the projection is one-way.
  - The **encoded-byte target** is 2 MiB by default; the "smallest quality-ladder output that fits" rule is documented in the README (85/75/60 JPEG, WebP effort 0 for alpha).
- **Edge cases & failure handling:** an uncatalogued model prices as text-only (it is not image-capable), so a mis-catalogued model never inflates the estimate.
- **Surprising:** the module doc comment explicitly says the pricing is "consumed synchronously by the token meter through `LlmAdapter.imageRequestPricing`" — the adapter contract includes a *pre-flight cost estimate*, not just a request.

### `packages/llm/llm-deepseek/src/serialize.ts`
- **Purpose:** Maps harness messages into the Messages wire body under the route's declared capabilities.
- **Key abstractions:** `serialize(options, connection, history, images, access, onReplayDegrade, fileIds)` → `WireRequest`; `assistant(message, model, onReplayDegrade)`; `toolInput(raw)`.
- **Data flow:** iterates the history, converting developer messages into deferred `system` updates, system messages into either the top-level `system` string or (for `in-history` routes) a system-role message, and user/assistant/tool messages into wire content; then validates the tool-call pairing; then emits the request.
- **Non-obvious design decisions:**
  - **System-prompt placement depends on the route's declared capability.** For a route with `systemPromptUpdate: 'in-history'`, a system snapshot that arrives mid-conversation becomes a **system-role message placed after the preceding user/tool-result turn**; otherwise the *latest* snapshot becomes the top-level `system` string. This is the "append the changed prompt after the cached history instead of rewriting the leading system message" rule that preserves the provider's KV cache.
  - **The system-update ordering is enforced**: "system update without a preceding user or tool-result turn" → `UNSUPPORTED_CONTENT`. The README documents this as a real limitation.
  - **Developer tool changes become `tool_addition` / `tool_removal` blocks referencing a declared tool**; the `defer_loading` flag rides along on the tool schema.
  - **Historical tool arguments that are not valid JSON objects become `{}`** — the call id, tool name, and result are preserved, and the *original* arguments stay in the session log. Only *newly generated* tool arguments must be valid JSON.
  - **Empty assistant text blocks and empty assistant messages are skipped**; empty *tool results* keep their call ids. This is what lets a saved subagent notice (assistant output) be replayed to the provider.
  - **Consecutive same-role messages are merged** (`previous.content.push(...content)`), and a `tool` message becomes a `user`-role message carrying `tool_result` blocks.
  - **Tool-call pairing is validated strictly**: duplicate call ids → throw; a result with no matching call → throw; a call without an immediate result → throw; history ending with unresolved tools → throw.
  - **The effort ladder is checked before network I/O**: an unsupported value → `UNSUPPORTED_REASONING_EFFORT`; `thinking: 'disabled'` with a non-`off` effort → throw.
  - `max_tokens` precedence is `options.maxTokens ?? model.maxTokens ?? connection.maxTokens`.
- **Edge cases & failure handling:** an unsupported content block type → `UNSUPPORTED_CONTENT`; a missing prepared image → `INVALID_REQUEST`; a missing file id → `INVALID_REQUEST`.
- **Surprising:** the request's `thinking` field is derived from the **effort** (`effort === 'off' ? 'disabled' : 'enabled'`), and `output_config.effort` is only sent when the effort is not `off` — the "off" state is expressed by disabling thinking, not by an `off` effort value.

### `packages/llm/llm-deepseek/src/sse.ts`
- **Purpose:** SSE framing for the Messages stream.
- **Key abstractions:** `parseSse(body, activity)` → async generator of decoded event objects.
- **Data flow:** `body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({ onComment: activity }))`; each frame's `data` is `JSON.parse`d and validated.
- **Non-obvious design decisions:**
  - **The framing is delegated to `eventsource-parser`** — "Decode complete SSE frames without treating an unterminated tail as an event". A truncated tail is dropped, not mis-parsed.
  - **Heartbeat comments pulse the idle watchdog** (`onComment: activity`), so a provider that only sends `: ping` keeps the stream alive.
  - **Event-type mismatch is a hard error**: if the SSE `event:` name and the JSON `type` disagree → `MALFORMED_RESPONSE`.
- **Edge cases & failure handling:** invalid JSON in a frame → `MALFORMED_RESPONSE`; an `error` event → `providerError(event, undefined)` (an in-band error is treated as an HTTP-less provider error).
- **Surprising:** the *only* thing this module owns is framing; the translation is `translate.ts`'s, and the error classification is `transport.ts`'s — three files with three jobs, each independently testable.

### `packages/llm/llm-deepseek/src/translate.ts`
- **Purpose:** Translates Messages SSE events into the harness `StreamChunk` protocol while preserving block order and cumulative usage.
- **Key abstractions:** `translate(events, model)`, `string(value)`, `startBlock(event, index)`, `deltaChunk(block, raw)`, `stopReason(raw)`, `updateUsage(usage, raw)`, the internal `Block` shape.
- **Data flow:** `message_start` seeds usage; `content_block_start/delta/stop` drive per-block accumulation; `message_delta` sets the stop reason and may update usage; `message_stop` emits the final `usage` and `finish` chunk (with the replay envelope).
- **Non-obvious design decisions:**
  - **The wire block index and the harness block index are different.** `startBlock(event, blocks.size)` uses the *arrival count* as the harness index while `blocks.set(wireIndex, block)` keys by the provider's index — so a provider that reuses/skips indices cannot corrupt the harness's block numbering.
  - **Unknown event types are ignored** ("Anthropic permits additional event types"), but a *known* event before `message_start` is a hard error.
  - **Signature deltas are accumulated but not emitted** — `signature_delta` returns `undefined`, so the chunk stream carries no signature noise; the signature is replay metadata only.
  - **Tool-call arguments are accumulated as raw JSON text** and only parsed at `content_block_stop`; the parse is **skipped when the stop reason is `max-tokens`**, because truncated tool JSON is expected and "is retained in the stream, then pruned by the shared assembler".
  - **Usage is cumulative and includes cache tokens**: `totalTokens = input + output + (cacheRead ?? 0) + (cacheWrite ?? 0)`.
  - **A terminal `stop` with no content blocks is `EMPTY_RESPONSE`**, which the default retry policy retries.
  - `message_stop` requires a settled stop reason and all blocks closed — an early stop is `MALFORMED_RESPONSE`.
- **Edge cases & failure handling:** a delta for a closed or unknown block → malformed; a block starting after settlement or repeating an index → malformed; invalid usage numbers → malformed; the stream ending without `message_stop` → `STREAM_CLOSED`; an unsupported response block type → `UNSUPPORTED_CONTENT`.
- **Surprising:** `deltaChunk` **mutates the block's content in place** and returns the chunk — the block holds the accumulated text, and `block-end` emits a copy of it. One source of truth, no re-concatenation.

### `packages/llm/llm-deepseek/src/transport.ts`
- **Purpose:** Normalises HTTP and in-band Messages errors into provider-neutral failure codes.
- **Key abstractions:** `providerErrorDetail(raw)`, `providerError(raw, status, headers)` → `LlmError`.
- **Data flow:** reads the error envelope's `message`/`type`/`code`, builds a `detail` string, and classifies it into a stable code.
- **Non-obvious design decisions:**
  - **The classification order is fixed and load-bearing**: `AUTH` (401/403 or an auth-ish type) → `QUOTA` (quota text or 402) → `RATE_LIMIT` (429) → `CONTEXT_WINDOW_EXCEEDED` → `INVALID_REQUEST` (400/413) → `SERVER` (5xx or an api-error type) → `HTTP_<status>`.
  - **A `retry-after` header is parsed in both forms** — numeric seconds and an HTTP date — and only a finite positive delay is kept (`providerRetryAfterMs`).
  - **The provider request id is read from three possible headers** (`request-id`, `x-request-id`, `x-deepseek-request-id`) and branded as `ProviderRequestId`.
  - `providerErrorDetail` deliberately returns **only** the three fields used by the bounded Files recovery, so unrelated response fields cannot leak into a regex.
- **Edge cases & failure handling:** a missing message → a synthesised one naming the status or "stream error"; a non-2xx with no body → `HTTP_<status>`.
- **Surprising:** an in-band SSE error (no HTTP status) is classified with `status === undefined` → the fallback is `SERVER`, not `HTTP_undefined`.

### `packages/llm/llm-deepseek/src/types.ts`
- **Purpose:** The model catalog shape and the request-local dependency interface of the DeepSeek adapter.
- **Key abstractions:** `DeepSeekCatalogModel` (id, name, description, contextWindow, maxTokens, inputModalities, imagePixelBudget, imageMaxBytes, systemPromptUpdate, toolUpdate), `DeepSeekConnectionOptions`, `DeepSeekRequestAuth` (`headers` + optional `onRequestError`), `DeepSeekAdapterOptions<C>`, `RequestDefaults`.
- **Data flow:** type-only; consumed by the adapter, the serializers, and the two provider plugins.
- **Non-obvious design decisions:**
  - **The two capability flags are documented as wire-shape declarations, not preferences.** `systemPromptUpdate: 'in-history'` says "the endpoint reads the latest `system` message at any position as the complete effective system prompt"; `toolUpdate: 'addition-only'` says "the endpoint activates a `defer_loading` tool from a later `tool_addition` block".
  - **`DeepSeekConnectionOptions` is documented as re-read per operation** — "the adapter trusts it and re-reads it per operation, which is what makes a configuration change reach the next request without re-registration".
  - **`admit(connection, model)` throws to refuse a model before network I/O** — the refusal hook is part of the adapter contract, not an implementation detail.
  - **`resolveAuth(connection)` "never re-reads the endpoint"** — the credential and the endpoint come from the same snapshot, by construction.
- **Edge cases & failure handling:** n/a (types).
- **Surprising:** `DeepSeekAdapterOptions` carries **three diagnostic callbacks** (`onReplayDegrade`, `onExtensionsOmitted`, `onExtensionsUnaccepted`) that the *host* implements with once-per-route log suppression. The adapter reports; the host decides how loudly to complain.

### `packages/llm/llm-deepseek/src/upload-index.ts`
- **Purpose:** A durable, atomic, cross-process index of uploaded attachment → provider-file-id mappings.
- **Key abstractions:** `DeepSeekUploadRecord` (scope, attachmentId, variantId, fileId, bytes, createdAt, expiresAt), `DeepSeekUploadIndex` (`path`, `get`, `commit`, `remove`, `clear`), `deepSeekFileScope(baseURL, credentials)`, `UploadIndexCommit` (`record`, `accepted`).
- **Data flow:** the index is a JSON file at `DSH_HOME/llm-deepseek/files-v3.json`; `get` finds a record by `(scope, variantId)` and checks it is still reusable; `commit` takes a file lock, drops expired/duplicate records, appends the candidate and saves atomically; `remove` deletes exact `(variantId, fileId)` pairs; `clear` removes a whole scope.
- **Non-obvious design decisions:**
  - **The namespace digest is a SHA-256 of the base URL plus the *serialised credential headers* — the raw credentials are never persisted or logged** (`deepSeekFileScope`, `upload-index.ts:39-46`; the doc comment says "used only as hash input"). The file-store computes the same digest from sorted header entries, so a header reordering does not change the namespace.
  - **The key is the *variant id*, not the attachment id.** A variant id is "the complete request transformation identity, including route budgets and encoder parameters" — so changing the image budget produces a new upload rather than reusing a wrongly-sized one.
  - **`commit` is a compare-and-set under a file lock**: if another process already published a reusable mapping for the same `(scope, variantId)`, the candidate is *not* accepted, and the caller deletes the duplicate remote file (`file-store.ts`).
  - **A corrupt or absent index is treated as an empty index** (`load()` catches `ENOENT` *and* `InvalidUploadIndexError`) — a bad file never wedges the route; it just costs re-uploads. A *different* error (e.g. EACCES) still propagates.
  - **The file is written with `mode: 0o600` and `dirMode: 0o700`** via `writeFileAtomic` — owner-private.
  - `formatVersion: 3` is checked on read; an unknown version is treated as corrupt, i.e. reset.
- **Edge cases & failure handling:** duplicate `(scope, variantId)` in the file → corrupt → reset; a record with a non-hex scope or a non-`sha256:` id → corrupt → reset; `remove` of an absent pair is a no-op (no write).
- **Surprising:** `reusable()` is `expiresAt - now > refreshMarginMs` — a mapping is only reused while it has *more than the refresh margin* of life left, so a file id is proactively replaced before it can expire mid-request.

### `packages/llm/llm-deepseek/src/file-store.ts`
- **Purpose:** Upload reuse, invalidation, and quota recovery for the DeepSeek Files API.
- **Key abstractions:** `DeepSeekFileStore` (`ensureUploaded`, `invalidate`, `release`, `reclaimOldestOwned`, `releaseAll`), `DeepSeekFilePolicy`, `DeepSeekFileConnection`, `DeepSeekFileReference` (`record`, `uploaded`), `MAX_IMAGE_BYTES = 32 MiB`.
- **Data flow:** `ensureUploaded(version, connection, policy, signal)` computes the scope and the key `scope\0variantId`; an in-flight upload for the same key is **shared**; otherwise the store checks the durable index for a reusable mapping, uploads if needed, and commits the mapping.
- **Non-obvious design decisions:**
  - **Concurrent uploads are single-flight with waiter-local cancellation.** `waitForUpload` counts waiters; when the last waiter leaves, the shared upload is aborted (`operation.controller.abort(cancelledReason)`). One caller cancelling does not kill another's upload; all of them cancelling does.
  - **A quota failure triggers exactly one bounded cleanup and one retry.** `reclaimOldestOwned(connection, policy.quotaCleanupBatch, signal)` deletes up to N oldest harness-owned files; if it deleted nothing, the original error is rethrown. The harness only deletes files whose names start with `dsh-` — it never touches a user's other files.
  - **Ownership is encoded in the filename**: `dsh-<attachment16>-<variant8>.<ext>`, derived from the content hashes, so ownership survives a restart and is visible in the provider's file list.
  - **A duplicate upload is cleaned up**: when `commit` reports `accepted: false`, the redundant remote file is deleted (best-effort — "The winning mapping is durable. A failed duplicate cleanup affects quota only and is retried by recovery").
  - **The Files API is asked for an explicit expiry** (`expires_after[anchor]=created_at`, `expires_after[seconds]`), and because Messages' file metadata omits the remote expiry, the local reuse deadline is *computed* as `createdAt + expiresAfterSeconds` — the README notes this "does not guarantee remote deletion".
  - The **per-image limit is 32 MiB**, checked before the upload begins.
- **Edge cases & failure handling:** a non-`Error` rejection reason is wrapped into an `Error` with the original as `cause` (`abortReason`, `uploadFailure`); a caller abort before the call → immediate throw; a `release` of an unknown variant → `false`, no network.
- **Surprising:** `reclaimOldestOwned` must page through **every** file because "The API offers no ascending-order query" — it sorts candidates as it goes and keeps the oldest `count`. The pagination loop also has a `page.lastId === after` guard against a non-advancing cursor.

### `packages/llm/llm-deepseek/src/files-api.ts`
- **Purpose:** A direct client for the DeepSeek Files API.
- **Key abstractions:** `DeepSeekFilesClient` (`upload`, `list`, `retrieve`, `delete`), `DeepSeekFileObject`, `DeepSeekFilePage`, `DeepSeekFilesError` (an `LlmError` subclass carrying `detail`), `isFilesQuotaError(error)`, `MIN/MAX_FILE_EXPIRY_SECONDS`, `MAX_FILE_UPLOAD_BYTES = 128 MiB`, `MAX_STORED_FILE_COUNT = 10_000`, `MAX_STORED_FILE_BYTES = 25 GiB`.
- **Data flow:** one `fetch` per operation against `${baseURL}/v1/files…`, always with `redirect: 'error'`, the attribution headers, the `anthropic-version` and `anthropic-beta: files-api-2025-04-14` headers, and the provider's auth headers.
- **Non-obvious design decisions:**
  - **`redirect: 'error'` on every Files call**, so a credential cannot be replayed to another origin.
  - **The response is validated field by field** (`parseFileObject`): `id`, `type === 'file'`, `mime_type`, `size_bytes` (safe integer ≥ 0), `filename` non-empty, and a parseable `created_at`. Anything else → `INVALID_RESPONSE`.
  - **A JSON decode failure becomes `INVALID_RESPONSE` with the operation and the HTTP status in the message**, the status in `LlmError.failure`, and the original `SyntaxError` as `cause`. A *body-read* transport failure keeps its own identity (not swallowed into `INVALID_RESPONSE`).
  - **Quota detection is a regex over the provider's error detail** (`quota|storage|stored files|file count|too many files`) — the same deliberate text-classification technique used for stale file ids.
  - The delete response must say `type: 'file_deleted'` and echo the id.
- **Edge cases & failure handling:** a non-2xx becomes `DeepSeekFilesError` with code `AUTH` / `RATE_LIMIT` / `SERVER` / `FILES_API`; a 401/403 → `AUTH`; a 429 → `RATE_LIMIT`; a 5xx → `SERVER`.
- **Surprising:** `MAX_STORED_FILE_COUNT` and `MAX_STORED_FILE_BYTES` are **declared but unused** in this file — they document the provider's current quota as constants of record.

### `packages/llm/llm-deepseek/src/image-tokens.ts`
- **Purpose:** A verbatim port of DeepSeek's published vision-token calculator.
- **Key abstractions:** `deepSeekRequestImageDimensions(width, height)`, `deepSeekImageTokens(width, height)`; internal `PATCH_SIZE = 14`, `DOWNSAMPLE_RATIO = 3`, `MAX_IMAGE_TOKENS = 1024`, `MIN_PIXELS = 544*544`, `CELL_SIZE = 42`, `solveResizeRatio`, `safeResize`, `resizeOnce`.
- **Data flow:** dimensions → a patch-padded grid → a token-cell grid → a token count; `deepSeekImageTokens` iterates `resizeOnce` to a fixpoint (max 10 iterations).
- **Non-obvious design decisions:**
  - **The provider's algorithm is reproduced exactly**, including the 544×544 scale-up floor (small images are enlarged by the *provider*, so the harness must price them as if they were), the 14-px patch grid, the 3:1 per-axis downsampling, and the 1024-token cap solved by the largest aspect-preserving grid inside the budget.
  - **The token formula is `height * (width + 1) + 2`** — every row carries a separator, plus two framing tokens. A naive `height * width` would under-price every image.
  - **`deepSeekRequestImageDimensions` and `deepSeekImageTokens` can disagree**, and the doc comment says so: "Rounding the aspect-preserving short edge can change the token count from the source's solved grid; request pricing uses the sent dimensions." The pricing therefore prices the **sent** dimensions, not the source's solved grid.
  - The "no alignment pad and no aspect-ratio clamp" note pins the exact provider configuration (`v41`), so a future provider change shows up as a test failure rather than a silent drift.
- **Edge cases & failure handling:** a non-converging resize throws (guarded by `/* v8 ignore */` because the second identical pass is always the fixpoint); a geometry with no fitting grid throws.
- **Surprising:** the whole file is a **transcription of a published formula** — an unusual thing to find in a codebase, and the reason the "image pricing" can be exact rather than an estimate.

### `packages/llm/llm-deepseek/src/index.ts`
- **Purpose:** The public barrel of the `llm-deepseek` transport library.
- **Key abstractions:** re-exports of `Config`, `resolveAdapterOptions`, `DeepSeekAdapter`, `registerDeepSeekProvider`, `catalogModelInfo`, the defaults, the file-store/files-client/upload-index classes, and the image-pricing helpers.
- **Data flow:** n/a (re-export surface).
- **Non-obvious design decisions:** the barrel exports **both** the runtime value and the type for branded ids (`DeepSeekFileId` and `DeepSeekFileIdType`) — the value brands, the type names.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the package exports the *transport library* only; the provider plugins (api-key, account) are separate packages that register routes on top of it.

---

### Tier 1 (continued) — load-bearing source: full entry

### `packages/llm/llm-pi-ai/src/index.ts`
- **Purpose:** The plugin entry for the pi-ai-backed multi-provider adapter: it owns a dict of provider routes and re-registers the same adapter instance when the *route set* (or a route's captured retry policy) changes.
- **Key abstractions:** `apply(ctx, config)`; `registrationFacts(profiles)`; `NS = 'llm-pi-ai'`; re-exports of `Config`, `PiAiAdapter`, `recordKeyFor`, `supportedProtocols`.
- **Data flow:** `resolveProfiles()` produces a `Map<route, ResolvedPiAiProviderProfile>`; `registrationFacts()` reduces that to the facts the registry captures (sorted by provider so a reordered settings document is not mistaken for a change); when the facts differ, the adapter is re-registered in place; per-request facts (credential, endpoint, model, knobs) are read through thunks so a settings change reaches the next request without a restart.
- **Non-obvious design decisions:** the module doc comment is the **configuration reference** — a 70-line YAML example showing a catalog route, a narrowed catalog route, and a hand-declared gateway with its own `reasoningEfforts` wire spellings. **`reasoningEfforts` maps a selectable level to the wire spelling** (`max: ultra`), and "only off may leave the value empty (supported, send nothing)" — so a gateway with its own vocabulary is configurable without code.
- **Edge cases & failure handling:** a route already owned by another adapter fails plugin loading (`DUPLICATE_ADAPTER`); a route whose catalog cannot be built is refused at the *write* that produced it, while an unchanged catalog failure stays editable.
- **Surprising:** the plugin **may start with zero routes** ("dormant") and activate when user settings add them; a settings document that merely reorders its provider keys is explicitly ignored.

### `packages/llm/llm-pi-ai/src/adapter.ts`
- **Purpose:** The pi-ai-backed `LlmAdapter` implementation: many providers, one adapter instance, snapshot per operation.
- **Key abstractions:** `PiAiAdapter extends LlmAdapter`; `PiAiSnapshot` (`{ profiles, models }`); `current()`, `profileOf()`, `modelOf()`; `requestHeaders()`; `reasoningOf()`; `ANTHROPIC_TOOL_UPDATE_PLACEHOLDER`.
- **Data flow:** `current()` captures the profile map and a `createModels(auth)` collection; if the profile map is *identical by reference* the snapshot is reused, otherwise a brand-new collection is built — so a request started under one configuration finishes under it. `modelOf()` resolves the pi-ai `Model` for an exact route/model pair; `stream()` converts harness options to a pi-ai call and maps pi-ai events back to harness chunks.
- **Non-obvious design decisions:**
  - **Deployment headers cannot override attribution.** `requestHeaders()` strips any case-insensitive collision with the harness attribution headers *before* merging them, so a profile cannot forge or hide the product identity.
  - **The reasoning ladder is advertised verbatim.** `reasoningOf()` maps pi-ai's `getSupportedThinkingLevels(model)` to effort ids, and **only publishes a default effort when one was actually configured** — the README says "exposes pi-ai model thinking levels verbatim without inventing a provider default".
  - **The Anthropic placeholder tool.** When a route is `anthropic-messages`, its tool update mode is `in-history`, *every* declared tool is deferred, and the history contains tool-change blocks, the adapter prepends `ANTHROPIC_TOOL_UPDATE_PLACEHOLDER` — because "pi-ai collapses Anthropic tool updates without an initially active declaration". The placeholder's description instructs the model never to call it; if called, it gets an ordinary unknown-tool result.
  - **A snapshot is immutable, not mutable.** A configuration change builds a *new* `createModels()` collection rather than mutating the one in use.
- **Edge cases & failure handling:** an unowned route → `NO_ADAPTER`; a model with a recorded configuration error → `INVALID_CONFIG`; an unknown model → `UNKNOWN_MODEL`; a missing attachment/fs service is resolved **at dispatch time**, so a service mounted *after* the adapter still works.
- **Surprising:** `imageRequestTarget` is answered from the *profile's* pixel/byte budget, not from the pi-ai model descriptor — the route owns the request projection.

### `packages/llm/llm-pi-ai/src/catalog.ts`
- **Purpose:** Materialises one provider route's model catalog: installed pi-ai catalog defaults, overridden field by field by the profile, with strict resolution for writes and deferred resolution with retained diagnostics for reads.
- **Key abstractions:** `MODALITY_GATE`, `THINKING_LEVEL_GATE`, `THINKING_FORMAT_GATE` (drift gates); `declaredInput()`; `PiAiModelProfile`, `PiAiCompatProfile`, `PiAiReasoningEfforts`; `resolveRouteModels()`; `assertOfferedCompatFields()`; `NO_COST`.
- **Data flow:** `resolveRouteModels(request)` merges the installed catalog entry, then the profile's `models` entries, then `modelOverrides`; each merged model is validated; a model that fails validation gets an entry in `modelErrors` and is *excluded* from the serviceable set. A compat switch no protocol offers is refused **before** any protocol resolves.
- **Non-obvious design decisions:**
  - **The drift gates are `Record<Union, true>` maps.** A pi-ai upgrade that adds a modality, a thinking level, or a thinking format **fails compilation** naming the drifted key, instead of silently narrowing what a profile may declare. This is the single most transferable idea in the package.
  - **"Absent" and "empty" mean the same thing for modalities.** `declaredInput()` returns `undefined` for `[]` — because the config schema materialises an absent array as `[]`, and `[]` would read as "a model that accepts nothing" rather than "inherit". A hand-declared vision model must therefore *declare* `image`.
  - **`assertOfferedCompatFields()` judges the key before the value.** A bare `supportsDeveloperRole:` key survives schemastery as `null`; the adapter refuses it as "written but not applied" rather than passing it through to pi-ai's `??`, which would leave the field at pi-ai's base-URL detection.
  - **A compat default no model on the route could read is refused** — but *per field, not per block*, so a route that defaults a completions-only switch beside an anthropic-only model is not failed for the other's sake.
  - **`NO_COST` is zero, not a rate.** "The harness never reads pi-ai's cost metadata … so this is the absence of a fact, not a configurable rate."
- **Edge cases & failure handling:** a duplicate id invalidates the id (including an earlier resolved entry); a model with no id is refused; a route that names no protocol and no endpoint is refused; a withheld (not configurable) compat field produces a message naming the provider instead.
- **Surprising:** a *later* duplicate invalidates an *earlier* valid entry too — the ambiguity is treated as a property of the id, not of the entry.

### `packages/llm/llm-pi-ai/src/config.ts`
- **Purpose:** The profile schema, the resolution step, and the serviceability check for one pi-ai provider route.
- **Key abstractions:** `Config` (a dict of provider profiles); `resolveProfiles()`; `assertServiceable()`; `PiAiProviderProfile`; the fallbacks `DEFAULT_CONTEXT_WINDOW = 262_144`, `DEFAULT_MAX_TOKENS = 32_768`, `DEFAULT_INPUT = ['text']`, `DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 MiB`, `DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048*2048`, `DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1 MiB`.
- **Data flow:** `resolveProfiles(config, ...)` produces the resolved map; a *changed* provider is validated strictly, an *unchanged* one keeps its stored diagnostics so a broken catalog entry stays editable.
- **Non-obvious design decisions:**
  - **`DEFAULT_INPUT = ['text']` is argued, not chosen.** The comment spells out the asymmetry: "Under-claiming refuses the image before it is attached, naming the model. Over-claiming admits one the provider then rejects mid-turn, after the message is durable, leaving the session repeating a request that cannot succeed." That is a *failure-mode-cost* argument for a default.
  - **`DEFAULT_MAX_REQUEST_IMAGE_BYTES` is 20 MiB because base64 expands.** "Every image in history is re-encoded into every request body, so an unbounded conversation eventually exceeds a provider or gateway request-size cap and the session can never complete another request."
  - **`reasoningEfforts: false` is distinguishable from absent** — `false` declares a non-reasoning model (which is how a profile strips reasoning from a catalog model its gateway cannot serve); absent inherits the catalog capability.
- **Edge cases & failure handling:** an unknown reasoning level is rejected "at the write that produced it"; a route whose models could accept nothing is refused; an unknown modality is rejected at either level; an empty provider section is legal.
- **Surprising:** a configured `maxTokens` becomes the model's *request default*, while an inherited or route-fallback value is only a capability and never becomes a request default on its own.

### `packages/llm/llm-pi-ai/src/context.ts`
- **Purpose:** Converts the harness's request history into pi-ai's `Context` vocabulary, including image handling and offload projection.
- **Key abstractions:** `toPiContext()`; `assertSupportedHistory()`; `userContent()`; `toolResultOf()`; `collectImageRefs()`; `flattenText()`.
- **Data flow:** durable messages → pi-ai `Context` (`systemPrompt`, `tools`, `messages`); image blocks become a **text handle** (full attachment id + actual request dimensions + an optional read-only normalised path) **plus** the base64 payload; a surface-offloaded occurrence becomes the route's placeholder text and is never prepared.
- **Non-obvious design decisions:**
  - **The image handle text precedes the image** and names the *request* dimensions (not the source's) — "Identity comes from the occurrence's own durable reference: request versions are prepared per attachment id, so one shared version may serve occurrences whose display names differ."
  - **Only user and tool-result messages may carry images.** System, developer, and assistant history images fail with `UNSUPPORTED_CONTENT` on both conversion paths.
  - **Tool-change blocks require the developer role** — misplaced ones are refused before replay or offloading.
  - **A tool result without `isError` is a success**, and an unmatched tool result keeps `toolName: 'unknown'`.
- **Edge cases & failure handling:** an image with no durable resolver → refused; the encoded-payload bound is enforced **per occurrence and in total**, and exceeding it fails with the *count to offload* (the same machine-readable instruction the DeepSeek route uses); an empty text-only user message is kept.
- **Surprising:** `system` messages are *not* all hoisted — later system messages are preserved in history for pi-ai to resolve model support, and repeated updates keep their order.

### `packages/llm/llm-pi-ai/src/stream.ts`
- **Purpose:** Maps pi-ai's event stream onto the harness `StreamChunk` protocol.
- **Key abstractions:** `toStreamChunks()`; `mapUsage()`; `mapStopReason()`; `toPiReplayState()`.
- **Data flow:** pi-ai `AssistantMessageEvent`s → `block-start` / `text-delta` / `reasoning-delta` / `tool-call-delta` chunks → a `usage` chunk → a terminal `finish` chunk carrying the replay envelope.
- **Non-obvious design decisions:**
  - **The terminal `usage` chunk precedes `finish`** — a deferred-emit contract the runtime test pins ("usage precedes finish (deferred-emit contract)").
  - **In-band pi-ai error events become a terminal `finish` chunk**, not a throw: "pi-ai's style" of in-stream error delivery is mapped to the harness's other sanctioned error path.
  - **Tool arguments are re-stringified.** pi-ai parses them into objects; the harness's convention is the raw JSON string, so the adapter re-serialises.
  - **A stream that ends without `done`/`error` is `STREAM_CLOSED`.**
- **Edge cases & failure handling:** an aborted caller signal is rewritten to a `stopReason: 'aborted'`; reasoning tokens that the provider does not report separately are folded into output usage and pi-ai's exact `totalTokens` is preserved.
- **Surprising:** the `switch` is written without a `default` so that a new pi-ai event type becomes a **compile error** rather than a silently dropped event.

### `packages/llm/llm-pi-ai/src/auth.ts`
- **Purpose:** The three adapters between pi-ai's auth model and the harness credential plane (credential store, ambient auth context, record key).
- **Key abstractions:** `RECORD_SCOPE = 'llm-pi-ai'`; `recordKeyFor(providerId)`; `jsonImage()`; `toPiCredential()`; `toRecord()`; `authContextFrom()`; `credentialStoreFrom()`.
- **Data flow:** a pi-ai login produces a `Credential`; `toRecord()` stores it under `credentialKey('llm-pi-ai', providerId)`; `toPiCredential()` reads it back. The ambient auth context answers pi-ai's resolver questions from the harness credential seam first, then the launch environment.
- **Non-obvious design decisions:**
  - **The seam is provider-agnostic on purpose.** "The harness seams they consume — `ctx.credentials` records and `ctx.authorization` flows — name nothing from this library, so another adapter family can arrive with a different auth model and share the same two seams."
  - **`jsonImage()` exists for one specific reason:** pi-ai credentials idiomatically carry optional members as explicit `undefined` (a Copilot grant holds `enterpriseUrl: undefined`), and the credential store's strict validator refuses an unrepresentable value. The JSON image drops explicitly-undefined members *only*; everything else — non-finite numbers, foreign prototypes — passes through so a genuinely unstorable value still **fails loud at the store**.
  - **An OAuth grant payload is stored verbatim** (refresh fields and all): "the seam treats it as opaque JSON precisely so a library that owns a token format keeps owning it."
- **Edge cases & failure handling:** a provider id outside the record grammar holds nothing; reads work without a credentials service but **writes refuse**; a "not set" answer is given for a name no reference could address; `~` is expanded for a host-filesystem existence check, but an absolute path is checked **without reading the home directory**.
- **Surprising:** the adapter cannot *read* credential file contents — a provider that parses `~/.aws/credentials` itself bypasses the seam entirely, and the README says so.

### `packages/llm/llm-pi-ai/src/login.ts`
- **Purpose:** Bridges pi-ai's login flows onto the harness authorization seam, so a provider that ships a sign-in can be signed into without a settings form.
- **Key abstractions:** `registerPiAiFlows(ctx)`; the pi-ai auth types; the event/prompt restatement.
- **Data flow:** a pi-ai provider's auth methods become harness authorization flows; the flow runs the pi-ai auth type the chosen method names; the produced credential is committed to the harness credential store; every pi-ai login event is restated in the harness's neutral vocabulary.
- **Non-obvious design decisions:** the **key is typed into pi-ai's own prompt**, not into a settings form — the seam is a transport, not a re-implementation of the flow. Each restated prompt carries its **per-prompt withdrawal signal**, and the whole flow carries the attempt-wide cancellation signal.
- **Edge cases & failure handling:** a provider id outside the record grammar cannot sign in (`LlmError('UNSTORABLE_PROVIDER_ID')`); the sign-out is a local `deleteRecord` and does **not** tell the issuer.
- **Surprising:** **the login is not durable** — "authorization attempts do not persist, so refreshing the page mid-login abandons it". A real limitation, documented rather than hidden.

### `packages/llm/llm-pi-ai/src/replay.ts`
- **Purpose:** Stores and validates a versioned, lossless-JSON replay envelope so a provider's native response state (response id, signatures, thinking level) can be replayed to the same provider.
- **Key abstractions:** `ReplayEnvelope`; `toPiAssistant()`; `replayedAssistant()`; `foreignAssistant()`.
- **Data flow:** the response side writes a versioned envelope plus one per-block entry next to the durable content; on the next request `toPiAssistant()` validates the envelope against the message and rebuilds a native pi-ai assistant message; on failure it degrades to provider-neutral conversion and reports the reason.
- **Non-obvious design decisions:**
  - **Degradation is explicit and narrow.** Only an `INVALID_REPLAY_STATE` `LlmError` degrades; any other error is re-thrown ("the guard keeps a future non-replay failure loud instead of silently degrading it").
  - **Missing effort metadata stays missing.** "The adapter validates it and restores the native response id, provider signature and optional `providerThinkingLevel` effort metadata; absent effort metadata remains absent."
  - **The replay is validated against the *requested* model identity**, and the provider-reported response model is kept only as diagnostic metadata.
- **Edge cases & failure handling:** an unsupported envelope version, a flat pre-envelope legacy state, a block count that differs from the durable content, and blocks that do not match all degrade to provider-neutral history rather than failing the request.
- **Surprising:** switching provider A → B → A keeps A's stored content intact, including empty text blocks, tool ids, raw block order, and native replay metadata; unsupported signatures are omitted **only from the request to the other protocol**.

### `packages/llm/llm-pi-ai/src/discovery.ts`
- **Purpose:** Answers "which models can this provider serve?" for a configuration surface that is editing or drafting a route.
- **Key abstractions:** `discoverModels()`; `readListing()`; `readBounded()`; the per-protocol listing shapes.
- **Data flow:** for a route the installed catalog describes, the answer comes from the catalog with **no network call**; otherwise the plugin performs a bounded `GET` and normalises a `data` array or an enriched `models` object into candidates with id, display name, context window, and max output tokens.
- **Non-obvious design decisions:**
  - **The listing URL is normalised; the model request URL is not.** The Anthropic listing accepts an API root with or without a trailing `/v1` "because gateway documentation publishes both", but "only that listing URL normalises that segment; the model request still receives the configured `baseURL` as-is".
  - **A deployment path is kept, not resolved away** — a candidate keeps the path the provider published.
  - **An object's key is the request id** even when the entry names a different canonical id, and primitive-typed object properties are ignored.
  - **An oversized reply is refused**, whether its length was declared or streamed.
- **Edge cases & failure handling:** a missing required credential returns an **empty catalog** (not an error); a rejected credential points at the credential, and only then; a reply that is not a model listing is reported as such; an unreachable endpoint is reported rather than degraded to an empty catalog; a cancellation during the body read is reported as `ABORTED`, not as a raw abort reason.
- **Surprising:** an **illegal or blank probe key is a credential fault**, not an "unreachable endpoint" — the two need different user actions.

### `packages/llm/llm-pi-ai/src/provider.ts`
- **Purpose:** The supported-protocol table and the builder that turns a profile into a pi-ai `Provider`.
- **Key abstractions:** `supportedProtocols()`; `buildProvider()`.
- **Data flow:** a resolved profile → a pi-ai `Provider` with an api, a baseURL, headers, a model collection, and a credential injection.
- **Non-obvious design decisions:** the offered protocol set is **deliberately narrower than pi-ai's full API set** — Bedrock, Vertex, Azure, and Codex authenticate through flows a profile cannot fully describe with a key, an endpoint, and headers, so only an *explicit* override is refused while catalog routes still reach them through their own provider.
- **Edge cases & failure handling:** a route naming an unsupported protocol is refused with the protocol named.
- **Surprising:** Codex *is* sign-in-able through the authorization flow's OAuth grant even though its protocol is not offerable.

### `packages/llm/llm-pi-ai/src/models.ts`
- **Purpose:** A narrow entry point onto pi-ai's model helpers, so the adapter never evaluates pi-ai's aggregate barrel.
- **Key abstractions:** `createModels()`; `setProvider()`; `getModel()`; `getSupportedThinkingLevels()`.
- **Data flow:** a credential store is turned into a pi-ai model collection; providers are set into it from the resolved profiles; models are looked up by route.
- **Non-obvious design decisions:** the runtime imports pi-ai's *provider, API, and utility* entry points only, so a pi-ai upgrade that changes the aggregate entry cannot break the adapter's import graph.
- **Edge cases & failure handling:** an unknown route/model pair returns `undefined` rather than throwing, so the adapter can answer `UNKNOWN_MODEL` with a good message.
- **Surprising:** a hand-declared route has **no** reasoning capability unless it declares one — "a hand-declared model has none and does not reason".

### `packages/llm/llm-pi-ai/scripts/gen-provider-data.ts`
- **Purpose:** The generator that produces the provider display metadata (auth env var names, default base URLs, base-URL env vars) from pi-ai's public catalogue, using only synthetic answers.
- **Key abstractions:** `generateProviderData(providers?)`; `resolverEnv(provider)`; the `SUPPLEMENTS` table (azure / amazon-bedrock / google-vertex).
- **Data flow:** for each installed provider the generator calls the provider's `auth.apiKey.resolve` with a fake `AuthContext` whose `env()` records the names asked for and whose `fileExists()` always answers false; the probe is repeated with an empty set, with each single name, and with each suffix combination, until the set stops growing. The discovered names plus the endpoint facts are written to `src/provider-data.generated.ts` by a TypeScript printer (so the output is formatted by the compiler's own printer, not by string concatenation).
- **Non-obvious design decisions:**
  - **The probe is bounded three ways:** a 2-second timeout per provider, a 128-read limit, and a 64-name limit. A hostile or looping resolver fails the generation rather than hanging it.
  - **The probe never resolves a real credential, never starts a login flow, and never sends a model request.** "It reads no real credentials, starts no login flow, and sends no model request."
  - **The `SUPPLEMENTS` table exists because three providers read endpoint variables outside the auth context.** "Keep exceptions here, not in the UI."
  - **The generated file is checked, not trusted.** The pre-commit hook runs the generator with `--check --cached` and compares the staged file against a fresh computation; CI runs `verify-provider-data` on the checked-out file and the installed dependencies.
  - **The generator's coverage is explicitly bounded**: "Probing covers the installed resolver; it cannot prove every branch that depends on a specific variable value."
- **Edge cases & failure handling:** a resolver failure falls back to a temporary compat entry's `findEnvKeys`; missing fallback data fails the generation rather than shipping a half-empty table; a provider with no auth resolver contributes no env names.
- **Surprising:** the generator *discovers* the env var names by **asking the resolver what it reads** rather than by scraping source — a behavioural probe, with the synthetic environment as the only instrument.

### `packages/llm/llm-pi-ai/src/provider-data.ts` and `packages/llm/llm-pi-ai/src/provider-data.generated.ts`
- **Purpose:** The display metadata (auth env vars, default base URL, base-URL env vars) a configuration surface needs per provider, generated once from pi-ai's public catalog.
- **Key abstractions:** `providerDefaultsOf()`; the generated `PROVIDER_DEFAULTS` table.
- **Data flow:** `scripts/gen-provider-data.ts` probes each installed provider's resolver with a synthetic `AuthContext` (empty, single-variable, and suffix combinations) and writes the discovered env names and endpoints into `provider-data.generated.ts`; the runtime only *reads* the generated table.
- **Non-obvious design decisions:** the probe is **synthetic** — it never resolves a real credential, never starts a login flow, and never sends a model request; it has a 2-second timeout and a 128-read/64-name limit so a hostile resolver cannot hang the generator. Azure, Vertex, and Bedrock need **supplements** because they read endpoint variables outside the auth context.
- **Edge cases & failure handling:** a resolver failure falls back to `findEnvKeys`; missing fallback data fails the generation rather than shipping a half-empty table. The pre-commit hook runs the generator with `--check --cached` and compares the staged file, so a stale generated file cannot be committed; CI runs `verify-provider-data` on the checked-out file.
- **Surprising:** "runtime reads the catalog but does not probe" — the runtime never re-derives env names, so a newly installed pi-ai version's provider is invisible until the file is regenerated.

### `packages/llm/llm-retry/src/index.ts`
- **Purpose:** The retry executor: re-runs a failed model request at a durable agent-step boundary under the failed provider's own policy.
- **Key abstractions:** the `agent/request-error` waterfall listener; the policy lookup by provider; the backoff computation; the durable `llm/retry` / `llm/retry-started` appends.
- **Data flow:** a failed step arrives at the waterfall with its provider and resolved policy. Always mode settles downstream recovery first; normal mode checks the failure code and the remaining budget. The plugin computes the delay (a valid in-bounds provider `Retry-After`, otherwise a bounded exponential backoff with symmetric jitter), **appends the `llm/retry` event, waits on a cancellable timer, appends `llm/retry-started`**, then returns `{ kind: 'retry' }`; the loop re-runs the failed step inside the same open turn.
- **Non-obvious design decisions:**
  - **"Persist, then wait; open the step boundary."** The retry is scheduled in the session log *before* any timer starts, so a crash or a cancellation can never leave an invisible pending retry. The README's source map says it: "the executor is built on one rule".
  - **The retry boundary is the agent turn, not the stream.** A direct `ctx.llm.stream()` consumer is still a single attempt, "because a raw stream cannot durably distinguish the chunks already emitted, and the loop can re-run a failed step inside the same open turn."
  - **A failure before the final adapter was chosen has no provider policy** and is delegated downstream unchanged.
  - **Always mode is unbounded** and retries *every* model-request failure, including permanent ones (auth, quota, invalid request) — the deployment owns the cost control. In always mode an over-cap provider `Retry-After` falls back to the configured local backoff, so the policy cannot be terminated by the provider's instruction.
  - **Nothing about the retry is model-visible.** The retry events, the delay, the provider error, and the failed partial output never reach the model or a derived message.
- **Edge cases & failure handling:** cancellation or plugin disposal aborts an in-flight backoff, waits for an active delegated recovery to settle, and makes a callback captured before disposal fail rather than enter downstream policy; a callback captured before disposal fails *after* disposal; synchronous cancellation while entering delegated recovery is handled; a throwing iterator getter is normalised.
- **Surprising:** **the retry is recorded before it is attempted, and the record establishes the schedule, not the completion.** "A later step or turn event establishes success, exhaustion, or cancellation." The retry id continues only between events with the same provider *and* the same full policy key, so a route replacement with different codes or backoff starts its own history.

### `packages/llm/llm-retry/src/types.ts`
- **Purpose:** The browser-safe payload types of the two retry events.
- **Key abstractions:** `llm/retry` and `llm/retry-started` payload types.
- **Data flow:** the executor writes them into the session log; a browser client reads them without pulling the server types.
- **Non-obvious design decisions:** the payloads are **browser-safe** (plain JSON), and the test pins that the browser-safe payload is *identical* to the session event, so there is exactly one shape.
- **Edge cases & failure handling:** a payload never carries model content, so it cannot leak a partial answer.
- **Surprising:** the retry event is explicitly **not** a surface event — it does not change the visible conversation.

### `packages/llm/llm-retry/src/brand.ts`
- **Purpose:** The `RetryId` brand shared by the two event payloads.
- **Key abstractions:** `RetryId`.
- **Data flow:** a pure type-level brand; no runtime behaviour.
- **Non-obvious design decisions:** the brand lives in its own file so both the payload types and the executor import the *same* nominal type without a cycle.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the retry id is a *durable* identity, not a per-attempt counter — it is what lets the log answer "which retry was this?".

### `packages/llm/llm/src/index.ts`
- **Purpose:** The `LlmRuntime` service: the adapter registry, the configurable-provider directory, the model-discovery registry, call preparation, and the streaming boundary.
- **Key abstractions:** `LlmRuntime extends Service`; `LlmAdapter` (the abstract adapter); `LlmError`; the `llm/stream` waterfall event; `LlmCallConfig` / `ConfigureCall` / `LlmCallControls`; `AdapterRegistration`; `PreparedDispatch`.
- **Data flow:** a caller calls `ctx.llm.stream(options)`; the runtime validates the request against the exact model's capabilities, applies the adapter's configured defaults, projects file blocks to handle text and offloaded images to placeholders, then dispatches through the `llm/stream` waterfall to the resolved adapter's stream; the stream always ends with exactly one terminal `finish` chunk.
- **Non-obvious design decisions:**
  - **The service is a waterfall, not a call.** `llm/stream` is a Cordis waterfall event: a listener can intercept the call, yield its own chunks, or short-circuit it. The retry executor, replay, and routing all sit in it.
  - **Loop-built requests arrive deep-frozen.** "Its content is a pure function of the session log (the reconstructability Agent Note), so listeners read it, never rewrite it." Hand-built calls do not carry the marker and the caller owns their immutability.
  - **Registry changes are atomic.** A candidate route set is validated in full *before* any change, so a rejected change leaves the previous state serving. The topology test pins "replaces a route set in one event, never publishing an empty registry between the two".
  - **`listModels` validates the adapter's answer.** A duplicate id, a mismatched provider, or an empty name is `INVALID_CATALOG` — the service does not trust its own adapters.
  - **Catalog membership is advisory.** Core resolution and streaming accept unlisted ids; only GUI selection requires membership.
  - **The directory and the registry are detached copies.** `detachDirectoryEntry()` copies the arrays so a caller cannot mutate a registered entry.
  - **A prepared call is one-shot** and its config must match the prepared config; `prepareCall()` binds the facts, the detached context, and the retry policy to *one* adapter generation, so an HMR or a settings change cannot mix one generation's image capability with another generation's endpoint.
  - **Failure normalisation contains hostile code.** `normalizeLlmFailure()` handles a throwing `Symbol.toPrimitive`, a throwing `message` accessor, data descriptors, and accessor-backed snapshots without throwing downstream.
- **Edge cases & failure handling:** an unregistered provider is normalised to a terminal `NO_ADAPTER` failure rather than a throw; a throwing iterator getter (`IteratorResult.done` / `.value`) is normalised; a middleware or consumer failure is deliberately **left thrown** (only adapter failures are normalised); an aborted request signal maps the failure to `{ kind: 'aborted' }`; a stream always ends with exactly one `finish`.
- **Surprising:** **files never reach an adapter.** Every `FileBlock` (including one inside a tool result) is replaced with a deterministic handle line naming the file and its read-only saved path, resolved through the mounted attachment + filesystem providers. The model is expected to read the file with a file tool. This is a "one canonical projection, everywhere" decision.

### `packages/llm/llm/src/types.ts`
- **Purpose:** The shared vocabulary: the `StreamChunk` protocol, the content-block union, the finish reasons, the model metadata shapes, and the request options.
- **Key abstractions:** `StreamChunk`; `ContentBlock`; `FinishReason`; `GenerateOptions`; `LlmModelInfo` / `LlmResolvedModelInfo`; `LlmConfigurableProvider`; `LlmImageRequestPricing`; `ToolSchema`; `ToolUpdate`; `SystemPromptUpdate`.
- **Data flow:** every adapter, the assembler, the session log, and the token meter read these types; the runtime validates adapter answers against them.
- **Non-obvious design decisions:**
  - **`ToolUpdate` is a two-valued capability**: `'in-history'` (a route can add *and* remove tools mid-conversation) vs `'addition-only'`. The route declares it and the runtime projects history accordingly.
  - **`SystemPromptUpdate: 'in-history'`** declares that the endpoint reads the latest `system` message *at any position* as the complete effective prompt — a wire-shape fact, not a preference.
  - **`GenerateOptions` carries `sessionId` and `purpose`**, both explicitly "model-hidden transport metadata" an adapter may map.
  - **`LlmConfigurableProvider` carries `defaultBaseURL`, `baseURLEnv`, and `nativeAuth`** so a configuration surface can activate a dormant provider and edit its connection **without calling the adapter** — "the configuration surface reads these fields straight from the directory".
- **Edge cases & failure handling:** `normalizeModelInfo` rejects any `systemPromptUpdate` value other than `'in-history'` with `INVALID_MODEL_INFO`; an invalid context window is `INVALID_MODEL_CONTEXT`.
- **Surprising:** the sampling vocabulary is deliberately tiny — `temperature`, `maxTokens`, `stop` only. No `tool_choice`, no `top_p`, no penalty: the README explains that the vocabulary only grows when a producer lands ("dropped inert request knobs").

### `packages/llm/llm/src/content.ts`
- **Purpose:** The shared file and image helpers every route shares: content traversal, file projection, image-offload counting, offloaded-image projection, and tool-update projection.
- **Key abstractions:** `textOnlyImageText()`; `requestImageHandleText()`; `normalizedAccessText()`; `requiredImageOffload()`; `projectOffloadedImages()`; `projectImagesForTextModel()`; `projectFilesToText()`; `fileHandleText()`; `contentHasImage()` / `contentHasFile()`; `projectToolUpdates()`.
- **Data flow:** the runtime projects the durable history *before* dispatch: offloaded image occurrences become a route placeholder, a text-only route's images become a per-image placeholder, and every file occurrence becomes a handle line. `requiredImageOffload()` walks the history in message order and returns the count of *additional oldest occurrences* to drop.
- **Non-obvious design decisions:**
  - **The omission identity survives without a local path.** "A useful omission identity with and without a local path" — the placeholder still names the attachment digest.
  - **The handle text says the model-facing truth about the bytes:** "Source dimensions, format, and byte size may differ. Copy to a writable path ending in `.png` before editing."
  - **Projection preserves identity where nothing changed.** A message with no offloaded occurrence is returned *by reference* (`projectedMessages.push(message)`), so a caller can compare by identity to see that nothing was rewritten.
  - **`projectToolUpdates()` honours the route's capability**: `addition-only` routes omit removal messages and removed declarations; `in-history` routes keep them; a route with no update support gets the effective tools and no developer messages.
  - **A deferred tool stays deferred** until its first retained addition block — "declaring a deferred tool does not activate it".
- **Edge cases & failure handling:** the traversal visits image occurrences in user and tool messages in message order; inline bytes are accounted by their **base64 length**; an empty array means "no answer" and inherits; a media type that escaped the closed union at runtime is refused (`assertNever`).
- **Surprising:** file detection **reads the current content on every request** and does not cache message identity or frozen state — the archived decision records the measured traversal cost.

### `packages/llm/llm/src/message.ts`
- **Purpose:** The immutable message constructors and the `ContextForm` vocabulary that both delivery, history, and the request share.
- **Key abstractions:** `createUserMessage`, `createAssistantMessage`, `createToolResultMessage`, `createSystemMessage`, `createDeveloperMessage`, `createMessage`; `ContextForm`; `ContextFormed`; `ContextSnapshotSection`; `boundContextSummary()`; `CONTEXT_SUMMARY_MAX_CHARS`.
- **Data flow:** a producer builds a message; the constructor mints an id, deep-freezes the result, and detaches it from the caller's objects. The `source` describes *who* produced it; the `form` describes *what kind of thing* it is.
- **Non-obvious design decisions:**
  - **Two independent axes.** "`MessageSource.kind` answers *who produced this*; `form` answers *what kind of thing it is*, and the two axes are deliberately independent — several producers share one form, and one producer may emit more than one form over a session."
  - **The form vocabulary is SEMANTIC, never visual.** "A value states that the content is a file's instructions or a catalog of available items, and a consumer decides what that looks like. Colors, icons, ordering, and collapse defaults are the consumer's business and must not enter this union."
  - **`form` is discriminated by its required fields** — a `notice` must carry a `summary`, a `snapshot` its `sections` — so a producer cannot select a form without the fields needed to present it.
  - **A producer summary is bounded** (`boundContextSummary`) so an injected context cannot blow the prompt.
  - **A tool result's content is coupled to its cited call id** — one call identity, one result.
- **Edge cases & failure handling:** an existing identity is frozen rather than replaced; the assistant role and the model source kind are fixed at creation and cannot be re-kinded.
- **Surprising:** `ContextForm` includes `'relay'` and `'recall'` — "a message another agent addressed to this one" and "material lifted out of another session's log, possibly reduced on the way in" — a vocabulary of how context *entered*.

### `packages/llm/llm/src/assembler.ts`
- **Purpose:** `BlockAssembler`: the incremental conversion of a chunk stream into content blocks, a message, usage, a finish reason, and a replay envelope.
- **Key abstractions:** `BlockAssembler`; `blocks()`; `assembled()`; `ensure()`; `mustGet()`; `usage`; `finish`; `replayState`; `message(source)`.
- **Data flow:** `push(chunk)` accumulates per-index partials; `blocks()` closes the open blocks in order; `assembled()` returns the blocks plus the pruned replay entries; `message(source)` freezes an assistant message over them.
- **Non-obvious design decisions:**
  - **Replay entries are pruned in step with the blocks.** "Per-block replay entries with the tool calls a max-tokens finish drops" are removed, so a truncated tool call does not leave an orphaned signature.
  - **Replay metadata whose per-block entries misalign with the emitted blocks is omitted entirely** rather than partially trusted.
  - **A `max-tokens` finish with no per-block entries keeps its envelope** — a text-only truncated response still replays.
  - **The assembler tolerates a messy stream**: deltas without a `block-start`, a duplicate `block-start`, and tool-call stragglers after `block-end` are all handled. The property test pins "blocks() never throws and yields only valid content-block tags" — except for a plugin block type never closed by a `block-end`, which is a documented limitation.
- **Edge cases & failure handling:** `assemble()` throws on a partial with an unhandled `blockType`; `mustGet()` throws on a missing index (an invariant violation); a tool call with no id gets a generated one.
- **Surprising:** `finish` **defaults to `{ kind: 'stop' }`** when no finish chunk arrived — the "no news is good news" default, pinned by a property test.

### `packages/llm/llm/src/assistant-stream.ts`
- **Purpose:** A lossless compact representation of one model-stream attempt, plus record-level readers that answer common consumer questions without materialising the members.
- **Key abstractions:** `AssistantStreamRecord` (the packed `text-chunks` / `reasoning-chunks` / `tool-call-chunks` runs plus raw `chunk` records); `AssistantStreamAccumulator`; `expandAssistantStream`; `assistantStreamFirstTokenTime`; `assistantStreamHasVisibleContent`; `assistantStreamHasVisibleText`; `lastAssistantStreamChunk`; `assistantStreamChunks`; `joinAssistantStreamText`; `assembleAssistantStream`; `runFirstTokenTime`; `runFirstVisibleTime`.
- **Data flow:** the accumulator pushes timed chunks and packs consecutive deltas of the same kind into one run with a `time0` and a `dt` array (the gaps); a consumer that needs a single fact scans the compact records and can **exit early**; a consumer that needs the whole stream calls `expandAssistantStream`, which is the validating path for a record read at a durable boundary.
- **Non-obvious design decisions:**
  - **The packed form is a delta encoding, not a copy.** A run stores `time0`, an `index`, a `dt[]` of inter-member gaps, and the text/argument members. The member count is `dt.length + 1`, and the validation asserts exactly that.
  - **Readers trust the static record type; `expandAssistantStream` is the validating path.** The two are deliberately different trust levels.
  - **`expandAssistantStream` is not memoised** — "the retained expansion costs about ten times the memory of the compact stream for the event's lifetime".
  - **Every numeric invariant is checked**: safe integers for times and indices, a non-negative index that is not `-0`, a `dt` array whose length is one less than the member count, and exact key sets.
- **Edge cases & failure handling:** a chunk that is not losslessly JSON-serialisable is refused at push time; a gap that is not a safe integer breaks the run (each member gets its own record).
- **Surprising:** the readers exist so that "the row shows up" and "the first token arrived" questions do **not** require expanding the stream — an O(1) question over a compact record.

### `packages/llm/llm/src/error.ts`
- **Purpose:** The failure taxonomy: `HarnessError`/`LlmError` and the canonical provider-neutral failure codes.
- **Key abstractions:** `HarnessError`; `CONTEXT_WINDOW_EXCEEDED_CODE`; `QUOTA_EXCEEDED_CODE`; `ACCOUNT_QUOTA_EXCEEDED_CODE`; `EMPTY_RESPONSE_CODE`; `INVALID_CREDENTIAL_CODE`; `isContextWindowExceededError()`; `isQuotaExceededError()`.
- **Data flow:** an adapter throws or finishes with an `LlmError`; the runtime normalises it to a terminal `finish` chunk carrying `{ code, message, status?, requestId?, providerRetryAfterMs? }`; consumers route on `code` and never parse `message`.
- **Non-obvious design decisions:**
  - **`EMPTY_RESPONSE` exists because an empty message is a silent dead end.** "Providers occasionally emit a degenerate completion (a terminal stop with zero output); adapters classify it as this failure instead of yielding an empty assistant message, because an empty message silently ends the turn with nothing for the user or the loop to act on."
  - **`INVALID_CREDENTIAL` is deliberately outside the default retryable set** — "a malformed credential fails identically on every attempt", and the fix differs from a missing one.
  - **`ACCOUNT_QUOTA` is separated from `QUOTA`** because only the first-party account balance can be topped up in-product.
  - **The context-overflow classifier is a layered regex set**, deliberately conservative: it accepts "maximum context length", "too large for this model", and an "exceeds … model context" shape, and it explicitly **does not** mistake an unrelated input-validation error for an overflow (the service test pins both directions).
- **Edge cases & failure handling:** a failure carries a `cause` chain; `errorChain()` renders the whole chain, survives non-Error values and cycles, and collapses a cause that repeats the wrapper message verbatim.
- **Surprising:** the error *code* is the contract and the *message* is not. "Route on this, never by parsing `message`."

### `packages/llm/llm/src/retry-policy.ts`
- **Purpose:** The resolution of a provider-owned retry policy into an immutable, validated result.
- **Key abstractions:** `RetryPolicySchema`; `resolveRetryPolicy()`; `ResolvedRetryPolicy`; the `normal` / `always` modes; `BackoffConfig`.
- **Data flow:** a provider's config section → `resolveRetryPolicy(config, path)` → a frozen `{ mode, maxRetries, retryableCodes, backoff }` or `{ mode: 'always', backoff }`; the adapter registry captures the result at registration.
- **Non-obvious design decisions:**
  - **The policy lives on the *provider*, not on the executor.** The executor has no configuration of its own — a single multi-provider adapter puts the policy in each provider profile.
  - **`always` mode has no budget and no code set.** The normal-only fields are *ignored* rather than rejected when switching to always mode (a test pins this) — a stale `maxRetries` cannot silently re-arm a bound.
  - **The result is frozen and its arrays are copied**, so a caller cannot mutate the policy the registry captured.
  - **Every bound is validated with a named path** (`${path}.maxRetries must be a non-negative safe integer`).
- **Edge cases & failure handling:** a non-integer or negative `maxRetries` throws; an empty `retryableCodes` throws; a duplicate code throws; an unknown key is rejected by the schema's exact-key check.
- **Surprising:** the default is **normal mode with five retries** — the aggressive unbounded mode is opt-in.

### `packages/llm/llm/src/adapter-failure.ts`
- **Purpose:** Normalises any thrown value into a serialisable `LlmFailure` without letting the failure escape.
- **Key abstractions:** `normalizeLlmFailure()`.
- **Data flow:** an adapter throws (or a hostile object is thrown) → `normalizeLlmFailure(value)` → `{ message, code }` plus optional `status`, `requestId`, `providerRetryAfterMs`, `cause`.
- **Non-obvious design decisions:** **the normaliser contains hostile code.** A thrown object with a `Symbol.toPrimitive` that throws, a `message` getter that throws, a data descriptor, or an accessor-backed snapshot is contained rather than propagated. The message is replaced with a generic one when it cannot be read — the test pins `{ message: 'LLM adapter failed', code: 'UNKNOWN' }`.
- **Edge cases & failure handling:** a malformed failure snapshot is rejected; a non-Error value yields `code: 'UNKNOWN'`.
- **Surprising:** the *cause* is retained but the *message* is sanitised — the operator gets a stable code and a safe string, not an attacker-controlled text.

### `packages/llm/llm/src/call-config.ts`
- **Purpose:** The call-configuration model: field-wise equality, the deep-freeze ownership helper, and the agent-loop request identity marker.
- **Key abstractions:** `LlmCallConfig`; `LlmCallControls`; `ConfigureCall`; `callConfigEquals()`; `markAgentLoopRequest()`; `isAgentLoopRequest()`; `deepFreeze()`.
- **Data flow:** a caller composes `ConfigureCall` functions; `prepareCall()` applies them to detached frozen controls, materialises the adapter defaults, validates, and freezes the result; the loop marks its own request object so the runtime can tell "the loop built this" from "a caller built this".
- **Non-obvious design decisions:**
  - **`callConfigEquals` compares the stop list element-wise**, not by reference — it is the real-change detector behind "the logged changed headers".
  - **`deepFreeze` never freezes an `AbortSignal`.** "The live cancellation channel keeps working" — a frozen signal would break the abort path.
  - **The freeze is cycle-safe and stack-safe** — the test pins "freezes nesting deeper than the JavaScript call stack".
- **Edge cases & failure handling:** primitives pass through; a cycle terminates; the marker preserves the request's identity (the *same object* is marked, not a copy).
- **Surprising:** the marker is what lets the runtime **read but never rewrite** a loop-built request — an ownership fact encoded as one property on one object.

### `packages/llm/llm/src/attribution.ts`
- **Purpose:** The single source of the product identity every provider request sends as `User-Agent`.
- **Key abstractions:** `AppIdentity`; `APP_IDENTITY`; `userAgent(identity?)`; `attributionHeaders(identity?)`.
- **Data flow:** the package's own `package.json` version is read at load time and rendered into the User-Agent; the header set is the baseline every adapter sends.
- **Non-obvious design decisions:**
  - **The version is read from the manifest, never hand-copied** — the test pins it, and the comment says "the single source so the User-Agent cannot drift from what is published".
  - **The identity carries only static public facts.** "No secrets, local paths, session ids, prompt text, or per-user identifiers belong here, and nothing per-request may influence the values."
  - **The default header set is the User-Agent and nothing else** — a baseline, not a bundle.
- **Edge cases & failure handling:** a custom identity maps onto the User-Agent header only.
- **Surprising:** the header set is deliberately *empty* of telemetry — the harness's own identity is the only thing it brands on the wire.

### `packages/llm/llm/src/api-key.ts`
- **Purpose:** The shared credential-format check every adapter uses.
- **Key abstractions:** `normalizeApiKey()`; `assertUsableApiKey()`.
- **Data flow:** a stored credential is trimmed, checked for printable-ASCII and a minimum substance, and either returned or refused with `INVALID_CREDENTIAL` naming the *reference* (never the value).
- **Non-obvious design decisions:** the check is **shared** so no adapter invents its own notion of a usable key; the refusal **never echoes the key** (the test pins this).
- **Edge cases & failure handling:** a blank stored credential is refused with a missing-credential code; a malformed one with the invalid-credential code; the printable-ASCII boundary characters are accepted.
- **Surprising:** the API's shape is a *result object* (`{ ok, value }` / `{ ok: false, code }`), not a throw — so a caller can distinguish "absent" from "malformed" without exception handling.

### `packages/llm/llm/src/brand.ts`
- **Purpose:** The branded id vocabulary owned by the core package.
- **Key abstractions:** `MessageId`; `ToolCallId`; `ProviderRequestId`; `LlmAttemptId`; `ReasoningEffortId`.
- **Data flow:** pure nominal typing; the constructors are stateless casts.
- **Non-obvious design decisions:** the `Branded<B>` primitive lives in a *separate* package "so every owner of a cross-boundary id can brand it without depending on dsh-llm". The doc comment for `ProviderRequestId` says "no validation is performed" — the brand is a type-level identity, not a runtime check.
- **Edge cases & failure handling:** n/a.
- **Surprising:** `ReasoningEffortId` is deliberately **adapter-owned and opaque** — the Dev Note records that "a shared cross-adapter effort vocabulary is not decided".

### `packages/llm/token-meter/src/index.ts`
- **Purpose:** The `TokenMeter` service: one replay-aware measurement of request and context pressure, read from the durable session log.
- **Key abstractions:** `TokenMeter extends Service` (registered as `ctx.tokenMeter`); `MeasurementAnchor`; `ReplayState`; `measure(session, requestHeader?)`; `estimateMessage(message)`.
- **Data flow:** the service consumes the session log from a cursor, folding surface appends/replacements, step boundaries, assistant messages, and provider usage into a per-session replay state; `measure()` syncs the fold to the log tail and returns a detached, deeply immutable snapshot (`totalTokens`, `surfaceTokens`, `nodes[]`, `baseline`, `logRevision`).
- **Non-obvious design decisions:**
  - **The provider's usage is reused only for an identical request envelope** *and* only when its total is no lower than that call's full route-priced anchor; otherwise the complete current envelope and surface are estimated. A provider number can therefore never *understate* the pressure.
  - **The anchor's surface is repriced under the same route** as the current surface, so a route switch produces a signed delta rather than a discontinuity.
  - **The fold is all-or-nothing.** "A malformed event throws before any change, so the same log fails the same way on every retry."
  - **The configuration is empty and enforced.** `validateConfigKeys()` rejects any key, including a plausible misspelling — "reject stale or misspelled keys before defaults can hide them".
  - **The measurement is O(surface) and the snapshot is a copy**, so a consumer cannot mutate the fold and a low-threshold pressure check is still cheap.
- **Edge cases & failure handling:** a usage sample that would undercut the heuristic scale is discarded in favour of a heuristic anchor; an assistant message without its step boundary is rejected transactionally; a later validation step rejects the event without partially applying the replacement; a corrupt replacement range does not advance the replay cursor.
- **Surprising:** **the service makes no model calls and adds no model-visible content**, and it does not make loop decisions — compaction reads `measure()`, it does not ask the meter what to do.

### `packages/llm/token-meter/src/estimate.ts`
- **Purpose:** The fixed-density heuristic that both the meter and the pure breakdown projection use, so two surfaces price identical content to identical numbers.
- **Key abstractions:** `CHARS_PER_TOKEN = 4`; `BLOCK_OVERHEAD = 4`; `ROLE_OVERHEAD = 4`; `estimateMessage()`; `estimateContent()`; `estimateStructuralBlock()`; `estimateToolsTokens()`.
- **Data flow:** a message is priced as role overhead + per-block structural overhead + the text density of each block; tools are priced as their schema envelopes.
- **Non-obvious design decisions:**
  - **One heuristic, two consumers.** "The harness never reads pi-ai's cost metadata … the fixed heuristic" — the point of a single estimator is that a compaction decision and an occupancy display agree.
  - **Image references are priced by their JSON structure only.** The real request cost of an image is route-owned (`imageRequestPricing`), so the heuristic prices the *reference*, not the pixels.
  - **The estimate is an approximation and the README says so**: "four characters per token severely underestimates CJK text and JSON schema".
- **Edge cases & failure handling:** a merge-extended (plugin) block falls back to the structural price; an empty system prompt prices to zero.
- **Surprising:** `ROLE_OVERHEAD` and `BLOCK_OVERHEAD` are separate constants — the framing cost of "this is a message" is not the framing cost of "this is a block".

### `packages/llm/token-meter/src/surface-fold.ts`
- **Purpose:** The positional surface fold shared with `measure()`: appends, replacements, and the shadow-price protocol.
- **Key abstractions:** `planSurfaceTokens()`; `commitSurfaceTokens()`; `MeterSurfaceNode`.
- **Data flow:** a surface event is planned (a price and a delta) and then committed; a replacement subtracts the *armed shadow price* of the range it replaces and adds the new content's price.
- **Non-obvious design decisions:**
  - **The shadow price is armed by the immediately preceding metering event.** A replacement with no adjacent claim folds at zero delta — "historical replay degrades to drift instead of failing".
  - **A claim that names a different range is a hard error**, and the error names both ranges — the fold refuses to guess.
- **Edge cases & failure handling:** an unmetered non-system replacement folds at zero; the state is not mutated when a claim contradicts.
- **Surprising:** the *heuristic* price is what the shadow price uses, so the O(1) projection fold stays in agreement with the service's own appends.

### `packages/llm/token-meter/src/route-pricing.ts`
- **Purpose:** Route-priced surface pricing: a node's tokens under the *current* route, including visual-token prices and file handle text.
- **Key abstractions:** `priceSurface()`; the substitution rules.
- **Data flow:** the surface is re-priced under the measured route: image occurrences carry the route's declared visual price plus the handle text, an offloaded occurrence carries the placeholder text, and files carry the exact handle text the `llm` service dispatches.
- **Non-obvious design decisions:** **the route total is intentionally different from the heuristic total.** "The shadow-price protocol prices replacements with this value so the O(1) projection fold stays in agreement with its own appends" — the two numbers are kept separate on purpose.
- **Edge cases & failure handling:** a route that answers a mismatched occurrence count **fails loud** rather than being silently reconciled.
- **Surprising:** the route pricing reads the *same* handle text the provider receives — the price and the wire cannot drift.

### `packages/llm/token-meter/src/breakdown-projection.ts`
- **Purpose:** The `contextBreakdown` session projection: the heuristic *composition* of the retained surface (system / tools / messages), independent of route image pricing and provider usage.
- **Key abstractions:** `contextBreakdownProjectionDefinition`; `ContextBreakdownState`; the `claimSchema`; `placeSurfaceEvent()`; the zod checkpoint schema.
- **Data flow:** the projection keeps the surviving system prompts in surface order, one running surface total, and at most one armed shadow-price claim; every other node is priced only as a delta, so the state size follows the *number of system prompts*, not the message count.
- **Non-obvious design decisions:**
  - **State size follows the system prompts, not the message count.** That is the whole design of the checkpoint.
  - **A replacement that puts a system message in place of a metered range is refused** — "its order among the surviving system prompts is unknown".
  - **The checkpoint is a plain-JSON zod schema** and its version invalidates positional checkpoints; the state version 6 makes a positional checkpoint unusable.
  - **The last non-empty living `system/message` in surface order owns `systemTokens`**, even across rewrites and extra source citations.
- **Edge cases & failure handling:** a scalar version-2 cache is discarded; a lower-layer version-3 scalar cache is discarded and the surface is refolded; a dormant empty system tail contributes nothing.
- **Surprising:** the system node is excluded from `messageTokens` — the two figures are disjoint, and their sum equals the surface heuristic total.

### `packages/llm/token-meter/src/usage-projection.ts`
- **Purpose:** The `tokenUsage` and `contextPressure` session projections.
- **Key abstractions:** `tokenUsageProjectionDefinition`; `contextPressureProjectionDefinition`; `TokenUsageProjection`; `ContextPressureProjection`.
- **Data flow:** usage samples accumulate from the log (`uncachedInputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`); a final assistant message's usage replaces the same attempt's streaming sample; `llm/retry-started` closes the replacement range so a retried step contributes another billable usage; pressure is the newest request's prompt-side buckets, not an accumulation.
- **Non-obvious design decisions:**
  - **The final message usage replaces the streaming sample** — a chunk sample and a final usage for the same attempt are one attempt, not two.
  - **The usage fold keeps only the last sample slot**, "because a legal log does not report usage for an earlier step after a later one".
  - **Context pressure excludes response output** and *replaces* rather than accumulates: "pressure with the newest request rather than accumulating".
  - **Historical billing is not erased when the visible surface is replaced** — the usage projection and the surface projection are separate facts.
- **Edge cases & failure handling:** a shadow claim with a mismatched start or end endpoint is rejected; a replacement with no claim folds at zero; a projection that a heuristic error drove below zero is **clamped to zero**.
- **Surprising:** `contextPressure` is a *scalar shadow-price consumer* — it is the second projection that needs the armed-claim protocol, and it inherits the same "no adjacent claim ⇒ zero delta" rule.

### `packages/llm/token-meter/src/surface-projection.ts`
- **Purpose:** The O(1) shadow-price protocol shared by the scalar projections.
- **Key abstractions:** the arm/commit/expire protocol for a shadow price.
- **Data flow:** a metering event arms a claim; the immediately following replacement consumes it; a later event expires it.
- **Non-obvious design decisions:** **the claim expires at the next event** — a stale armed price must not be spent by a much later replacement.
- **Edge cases & failure handling:** a mismatched endpoint is refused; an unarmed replacement folds at zero.
- **Surprising:** the protocol is shared, not per-projection — "the shared shadow-price protocol" is the mechanism that keeps three projections in agreement.

### `packages/llm/token-meter/src/turn-usage.ts`
- **Purpose:** `deriveTurnTokenUsage(events)` — a pure fold of a whole turn into exact per-attempt and per-turn usage for browser consumers.
- **Key abstractions:** `TurnTokenUsage`; `TurnTokenUsageRoute`; the attempt state machine (`idle` / `open` / `settled`).
- **Data flow:** the turn's events are walked; each attempt is opened by a step boundary and closed by a message or a retry; the attempts are aggregated into a turn total and per-route totals.
- **Non-obvious design decisions:**
  - **It fails closed.** Missing lifecycle evidence, an unsafe count, or a contradictory exact total produces **no result at all** rather than a partial one.
  - **An optional aggregate appears only when every participating attempt reports it** — "omits optional aggregates and routes unless every attempt reports them".
  - **An error-finished attempt is counted once across its retry boundary**, and a *scheduled* retry that never started does not invent an attempt.
- **Edge cases & failure handling:** aggregation that would overflow a safe integer fails; an aborted finish after observing usage is accepted; a sampled attempt closes at `step/end`.
- **Surprising:** **the total is not required to be monotonic** — a later attempt with a smaller usage replaces the sample within that attempt.

### `packages/llm/token-meter/src/types.ts`
- **Purpose:** The measurement and surface-node vocabulary.
- **Key abstractions:** `TokenMeasurement`; `TokenMeasurementBaseline`; `TokenSurfaceNode`; `TokenMeterConfig`.
- **Data flow:** the service returns these; the projections re-export their own types.
- **Non-obvious design decisions:** **each surface node carries two prices** — `tokens` (route-priced) and `heuristicTokens` (route-independent) — and the second exists *only* so the shadow-price protocol can price a replacement. The doc comment says so.
- **Edge cases & failure handling:** the baseline is a three-way union (`none` / `estimated` / `usage`) so "no anchor" and "a heuristic anchor" are distinguishable.
- **Surprising:** `TokenMeterConfig` is `Record<string, never>` — the type says "no settings" and the runtime enforces it.

### `packages/llm/token-meter/src/projection.ts`
- **Purpose:** The shared projection type vocabulary re-exported by the package root.
- **Key abstractions:** `ContextBreakdownProjection`; `ContextPressureProjection`; `TokenUsageProjection`.
- **Data flow:** the three projection shapes, plus the `SessionProjectionStateMap` augmentation that registers the `contextBreakdown` state key.
- **Non-obvious design decisions:** the module-edge re-export in `index.ts` exists to "force the emitted index.d.ts to import the projection-unit modules, so their SessionProjectionStateMap augmentations load in aggregate programs that only import the package root" — a real, documented TypeScript augmentation hazard.
- **Edge cases & failure handling:** n/a.
- **Surprising:** a type-only import in `index.ts` is load-bearing for the *emitted* `.d.ts`.

### `packages/llm/token-meter/src/client.ts`
- **Purpose:** The browser-safe client surface of the meter.
- **Key abstractions:** re-exports of the projection types, `deriveTurnTokenUsage`, `TurnTokenUsage`, `TurnTokenUsageRoute`.
- **Data flow:** a browser consumer imports the client entry instead of the server service.
- **Non-obvious design decisions:** the split exists so the **browser bundle does not pull the service** (and its session/compaction dependencies).
- **Edge cases & failure handling:** n/a.
- **Surprising:** a two-line file that exists purely as a boundary — the browser-safe contract is separated from the server implementation.

### `packages/llm/plugin-package-inventory-deepseek/src/index.ts`
- **Purpose:** A best-effort inventory of the *active* Loader-backed plugin packages, contributed to official DeepSeek requests as the `dsh_plugin_packages` field.
- **Key abstractions:** `Config` (`enabled`); `barePackageName()`; `barePackageManifest()`; `nearestManifest()`; the `ActiveEntry` model; the extension registration.
- **Data flow:** on each request the plugin re-reads the host Loader tree's active non-group entries; if `ctx.agentPresets` is present and the session's standing preset resolves to a live agent, that preset's separate Loader tree joins the same collection; each entry's package identity is resolved (bare package via `ctx.pluginPackages` or the Node resolution paths; relative/absolute module by walking up to the nearest `package.json`) and reported as `{ name, version }` or `{ name }`.
- **Non-obvious design decisions:**
  - **The inventory is best-effort and never blocks a request.** "A package resolution, manifest read, or JSON parse failure omits only that entry, and logs one warning per module."
  - **The manifest identity is cached for the process lifetime** — "replacing a mounted package's manifest in place is not a supported upgrade path", but Loader enable/disable/mount/unmount still refreshes the live set.
  - **The `ctx.pluginPackages` service is read once at activation.** "If that service is absent, the plugin keeps Node's native package search for its whole lifetime; mounting a resolver later does not switch the existing inventory." The README says the app boot mounts the service *before* the Loader entries for exactly this reason.
  - **Only the root fiber's `ACTIVE` entries with an enabled Loader state count.** Disabled, pending, failed, disposed, unloading entries, structural `cordis:` entries, ordinary dependencies, loose files with no owning package, programmatically mounted child fibers, and in-memory dynamic plugins are all excluded.
  - **The standing preset's root entry uses the host base** (to match the preset Loader's explicit bare-package overrides), while nested includes keep their own base.
  - **Deduplication is by name and optional version**, sorted locale-independently, with the name-only entry before the versioned one.
- **Edge cases & failure handling:** a manifest with a non-blank `name` but no usable `version` reports the name only; `private: true` is irrelevant; a nested directory with its own manifest does not inherit its parent's identity; the field is withdrawn when the contributing plugin reloads.
- **Surprising:** **the field is model-invisible** — it costs HTTP request bytes and zero input tokens, and a package lifecycle change does not affect the KV-cache prefix.

### `packages/llm/plugin-package-inventory-deepseek/src/types.ts`
- **Purpose:** The inventory identity and extension types.
- **Key abstractions:** `DeepSeekPluginPackageIdentity` (`{ name, version? }`); `DeepSeekPluginPackageInventoryExtension`.
- **Data flow:** the identity is declaration-merged into the extension map, so the field's value type is checked at compile time.
- **Non-obvious design decisions:** the version is **optional** — "only when `version` is a non-blank string" — because a file plugin has no version.
- **Edge cases & failure handling:** a name-only identity is valid.
- **Surprising:** the whole point of the type is that a *private* package and an *unversioned* file plugin are both first-class.

### Tier 2 — bulk: a compact table, one row per file (part 1 of 2: docs, config, manifests)

| File | What it is / what it pins |
| --- | --- |
| `packages/llm/README.md` | Package-group map for the `llm/` family: names the nine packages, their role, their `ctx` key, and the four "related documentation" links. Decides that the core `llm` package owns the *shared message/block/chunk vocabulary* and that `llm-retry` re-runs failures "at durable agent-step boundaries". |
| `packages/llm/README.zh.md` | Chinese mirror of the group map; identical package table, adds the `zh.md` suffix convention for all doc links. |
| `packages/llm/README.i18n.yaml` | Bilingual-pair consistency record: per-heading SHA hashes of the English and Chinese blocks outside code fences, so a one-sided doc edit fails the translation gate. |
| `packages/llm/deepseek-llm-api-extensions/README.md` | Contract of the extension registry: `register` reserves one field per fiber, `prepare` clones/freezes and omits a failing field, `accept()` is a joint idempotent commit. States "the registry owns addition and lifecycle, not field semantics", that the fields are model-hidden (no KV-cache effect), and that there is **no field ordering contract**. |
| `packages/llm/deepseek-llm-api-extensions/README.zh.md` | Chinese mirror of the same contract. |
| `packages/llm/deepseek-llm-api-extensions/README.i18n.yaml` | Bilingual hash record for the extension-registry README. |
| `packages/llm/deepseek-llm-api-extensions/locale/en.json` | UI locale stub: only `meta.title = "deepseek-llm-api-extensions"`. |
| `packages/llm/deepseek-llm-api-extensions/locale/zh.json` | Chinese locale stub: title plus a one-line description ("allows other plugins to add extension fields to DeepSeek model requests"). |
| `packages/llm/deepseek-llm-api-extensions/package.json` | Package manifest: `0.2.1-rc.2`, ESM, `exports` map with a `./src/*` escape hatch, single peer dependency on `@deepseek-ai/cordis`. |
| `packages/llm/deepseek-llm-api-extensions/tsconfig.json` | Project references `vendor/cosmokit` and `vendor/cordis`; `rootDir: src`, `outDir: lib/types`. |
| `packages/llm/deepseek-llm-api-extensions/tests/registry.spec.ts` | Pins: detached+deep-frozen field values (mutating the source object after `prepare` does not change the field), the `accept` receiver binding, duplicate-field rejection and fiber-scoped release, one-vs-many acceptance failures, a single failure rethrown verbatim, warning-once per field, cancellation stopping the wait for a provider that ignores the signal, and no warning for a cancellation-induced failure. |
| `packages/llm/llm-deepseek-api-key/README.md` | Credential contract: `apiKeyEnv` defaults to `DEEPSEEK_API_KEY` and resolves *per request and per discovery*; the credentials service takes precedence, the launch environment is the fallback; missing → `MISSING_CREDENTIAL`, malformed → `INVALID_CREDENTIAL`; discovery returns an empty catalog without a key (hiding the route) but keeps the settings entry; the endpoint and credential reference come from one configuration resolution. |
| `packages/llm/llm-deepseek-api-key/README.zh.md` | Chinese mirror of the credential contract. |
| `packages/llm/llm-deepseek-api-key/README.i18n.yaml` | Bilingual hash record for the API-key README. |
| `packages/llm/llm-deepseek-api-key/locale/en.json` | UI locale stub: `meta.title = "llm-deepseek-api-key"`. |
| `packages/llm/llm-deepseek-api-key/locale/zh.json` | Chinese locale stub: title "DeepSeek API 密钥接入" plus a one-line description. |
| `packages/llm/llm-deepseek-api-key/package.json` | Manifest; declares `dsh-llm`, `dsh-llm-deepseek`, `dsh-launch-environment`, `dsh-credentials` as peers and `cordis-plugin-loader` as an *optional* peer. |
| `packages/llm/llm-deepseek-api-key/tsconfig.json` | Project references to `llm`, `llm-deepseek`, `util/launch-environment`, `credentials/credentials`, `vendor/loader`, `vendor/schemastery`. |
| `packages/llm/llm-deepseek-api-key/tests/discovery.spec.ts` | Pins credential-gated discovery: no key (`undefined` or `''`) → `listModels` returns `[]`; a key → the configured models are advertised; a malformed key (embedded newline) → discovery **rejects** with `INVALID_CREDENTIAL` rather than returning an empty list. |
| `packages/llm/llm-deepseek-account/README.md` | The account route's contract: token only from `deepseekAccount.resolveToken(url)`; never falls back to an API key; the listing comes from the Messages origin's `/models` and is not configurable; first access waits up to `modelsTimeoutMs`, later accesses refresh in the background past `modelsMaxAgeMs`; a failed listing keeps the previous one; the built-in catalog serves before any listing loads; the version gate with prerelease semantics; `modelOverrides` semantics; `models` is retired; `ACCOUNT_TOKEN_INVALID` on 401, `ACCOUNT_QUOTA` rewriting of `QUOTA`. |
| `packages/llm/llm-deepseek-account/README.zh.md` | Chinese mirror of the account-route contract. |
| `packages/llm/llm-deepseek-account/README.i18n.yaml` | Bilingual hash record for the account README. |
| `packages/llm/llm-deepseek-account/locale/en.json` | UI locale stub: `meta.title = "llm-deepseek-account"`. |
| `packages/llm/llm-deepseek-account/locale/zh.json` | Chinese locale stub: title "DeepSeek 账号模型接入" plus a description. |
| `packages/llm/llm-deepseek-account/package.json` | Manifest; real dependencies `semver`, `cosmokit`, `schemastery`, `dsh-util-values`; optional peers `dsh-deepseek-account` and `cordis-plugin-loader`. |
| `packages/llm/llm-deepseek-account/tsconfig.json` | Project references to `llm`, `llm-deepseek`, `util/launch-environment`, `credentials/deepseek-account`, `util/values`, `util/timeout`, and the vendors. |
| `packages/llm/llm-deepseek-account/tests/account-quota.spec.ts` | Pins the three-way quota split: account route 402 → `ACCOUNT_QUOTA` (with and without an API key present); official route 402 → `QUOTA`; an **in-band SSE** balance error on the account route → `ACCOUNT_QUOTA`; a 401 still expires the stored credential. |
| `packages/llm/llm-deepseek-account/tests/catalog.spec.ts` | Pins the listing cache: signed-out view does no I/O; concurrent first accesses share one load; the first wait is bounded by the request deadline; an aborted caller abandons only its wait; an already-aborted signal rejects; a stale listing refreshes in the background; a failing streak warns **once**; a new account rescopes and aborts the previous load; disposal aborts in-flight work and drops a late success. |
| `packages/llm/llm-deepseek-account/tests/config.spec.ts` | Pins the config resolution: the listing endpoint is derived from the Messages origin; the cache defaults are 5 s / 600 s; every invalid bound throws with a named message; `models` is rejected; override keys must be non-empty and must not set `id`; unset override fields and empty lists are dropped; `plainAccountOptions` reads the live `Volatile` values. |
| `packages/llm/llm-deepseek-account/tests/listing.spec.ts` | Pins the listing decoder against the **real 2026-09-24 service payload**: exact decode of two models, skipping of rows without an id and of repeated ids, eight malformed-body rejections, eight client-requirement cases (including the product-key namespacing), eight unusable-capability cases, modality narrowing and the unknown-system-mode fallback; and the request lifecycle: attribution + auth headers, HTTP classification, redirect refusal, transport failure, timeout vs abort. |
| `packages/llm/llm-deepseek-account/tests/provider.spec.ts` | Pins the route end-to-end: the two credential routes are independent in discovery and disposal; listed capabilities merge with the build's knowledge; a failing listing falls back to the bundled catalog with a `[llm-deepseek-account]` warning; unservable models are **hidden** and **refused before any inference request** (`MODEL_UNSUPPORTED`, `CLIENT_UPGRADE_REQUIRED`); an unlisted id passes through; overrides apply and a stale override is reported on the provider directory until it resolves; a retired `models` setting fails at load; disposal aborts an in-flight listing request. |
| `packages/llm/llm-deepseek-account/tests/resolve-catalog.spec.ts` | Pins the catalog resolution: no listing → the bundled catalog; listed capabilities layered over the build's knowledge in listing order; the build's values kept for omitted fields; a vouched unknown model served with listed metadata only; `max_output_tokens` bounding the request default; an inherited `in-history` declaration removed when the listing says `leading-only`; inherited image limits dropped for a text-only listing; nine version-gating cases including prerelease floors; unreadable requirements reported; overrides validated and a bad override degrading to the unmodified model. |
| `packages/llm/llm-deepseek/README.md` | The DeepSeek transport's full contract: the 20 configuration fields with defaults, the endpoint and wire format, the two credential routes, streaming with thinking and images, dynamic configuration, provider-specific request fields, and the failure catalogue (`AUTH`/`QUOTA`/`RATE_LIMIT`/`CONTEXT_WINDOW_EXCEEDED`/`INVALID_REQUEST`/`SERVER`/`HTTP_<status>`, `TRANSPORT`, `ABORTED`, `TIMEOUT`, `REQUEST_EXTENSION`, `STREAM_CLOSED`, `MALFORMED_RESPONSE`, `EMPTY_RESPONSE`, `IMAGE_OFFLOAD_REQUIRED`, `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`). Also documents the **KV-cache effect** section: a changed execution-world path, a refreshed upload, or a Files→base64 fallback can each break prefix reuse. |
| `packages/llm/llm-deepseek/README.zh.md` | Chinese mirror of the DeepSeek transport contract. |
| `packages/llm/llm-deepseek/README.i18n.yaml` | Bilingual hash record for the DeepSeek transport README. |
| `packages/llm/llm-deepseek/package.json` | Manifest for the transport library; peers on `dsh-llm`, `dsh-attachment`, `dsh-anonymous-user-id`, `dsh-timeout`, `dsh-atomic-write`, `dsh-home-paths`, `dsh-brand`, `eventsource-parser`. |
| `packages/llm/llm-deepseek/tsconfig.json` | Project references to `llm`, `llm-deepseek-api-extensions`, `attachment`, `util/timeout`, `util/home-paths`, `util/atomic-write`, and the vendors. |

---

### Tier 2 (part 2 of 2) — test files, fixtures, and the remaining entries

| File | What it is / what it pins |
| --- | --- |
| `packages/llm/llm-deepseek/tests/account-routing.spec.ts` | The two credential routes are independent in discovery, in request headers, and in disposal: the account route sends `x-dsh-auth-token` and never `x-api-key`; the official route is the mirror image. |
| `packages/llm/llm-deepseek/tests/adapter.e2e.ts` | Real-API round trips behind `DEEPSEEK_API_KEY`: in-history system updates, the Files beta header, the real image path, and a comparison with the pi-ai twin's block structure. |
| `packages/llm/llm-deepseek/tests/adapter.spec.ts` | The HTTP lifecycle under real composition (agent loop, session store, attachments, credentials, loader): the account route, the `redirect: 'error'` guarantee, and the attribution headers that must **not** appear. |
| `packages/llm/llm-deepseek/tests/assemble.ts` | The helper that drives a stream through `BlockAssembler` — the same path production uses, not a one-shot convenience. |
| `packages/llm/llm-deepseek/tests/dynamic-config.spec.ts` | A live config edit reaches the *next* request: profile `Config` edits, `credentials-local`, the attachment store, and a mapped filesystem. |
| `packages/llm/llm-deepseek/tests/egress.spec.ts` | The discovery and provider requests go through the configured HTTP proxy. |
| `packages/llm/llm-deepseek/tests/expected/degraded-replay.json` | The expected fixture for a degraded native-thinking replay — the shape the degrade path must produce. |
| `packages/llm/llm-deepseek/tests/extensions.spec.ts` | The plugin-contributed request field: preparation, the commit after 2xx, and the refusal when the field collides with a base Messages field. |
| `packages/llm/llm-deepseek/tests/file-store.spec.ts` | Scope isolation by credential *kind* and by header *order*; reuse across equivalent API roots; expiry, invalidation, and the owned-file quota cleanup. |
| `packages/llm/llm-deepseek/tests/files-api.spec.ts` | The Files client's request shape (attribution, `anthropic-version`, the beta header, `redirect: 'error'`), field-by-field response validation, and the AUTH / RATE_LIMIT / SERVER classification. |
| `packages/llm/llm-deepseek/tests/files.spec.ts` | Files admission, the beta header only when file ids are present, the bounded stale-id recovery, and the whole-request inline fallback. |
| `packages/llm/llm-deepseek/tests/fixtures/cordis.yml` | The Loader composition fixture used by the loader-composition test. |
| `packages/llm/llm-deepseek/tests/fixtures/history.ts` | The shared history fixture (the durable messages the serializer tests project). |
| `packages/llm/llm-deepseek/tests/fixtures/input-history.ts` | A plugin that injects assistant-only content into saved user history, asserting the provider representation carries the closing message and *not* the child's reasoning or tool call. |
| `packages/llm/llm-deepseek/tests/helpers.ts` | The shared adapter/chunk/assemble helpers the DeepSeek suites share. |
| `packages/llm/llm-deepseek/tests/image-tokens.spec.ts` | The pinned vision-token calculator cases — the exact numbers the pricing depends on. |
| `packages/llm/llm-deepseek/tests/loader-composition.spec.ts` | A real Loader composition: profile patch edits and credential updates reach the next real adapter request. |
| `packages/llm/llm-deepseek/tests/mock-server.ts` | The mock HTTP/SSE server behaviours the suites script (`sse`, `http-error`, `close-early`). |
| `packages/llm/llm-deepseek/tests/model-info.spec.ts` | The resolved model-info cases (capabilities, effort ladder, context window). |
| `packages/llm/llm-deepseek/tests/prepared-call.spec.ts` | `prepareCall` binds the route, the model, and the request signal; a refused model throws **before** a prepared call exists. |
| `packages/llm/llm-deepseek/tests/provider-hooks.spec.ts` | The provider hook registration and its disposal — the `admit` gate that refuses a model before network I/O. |
| `packages/llm/llm-deepseek/tests/request-pricing.spec.ts` | The image pricing cases, asserted to mirror the real serialisation exactly (a 800×800 image is 422 visual tokens). |
| `packages/llm/llm-deepseek/tests/runtime.e2e.ts` | Real-API runtime checks: cache reuse, thinking on/off, the raw chunk order (`block-start` first, exactly one `finish` last, `usage` before `finish`). |
| `packages/llm/llm-deepseek/tests/runtime.spec.ts` | 108 cases over 2,383 lines: extension acceptance, the image fallback ladder, stale-id recovery (four shapes), the HTTP→code map, effort switching, the effort ladder's `off` semantics, the model catalog, and every config bound. |
| `packages/llm/llm-deepseek/tests/serialize.spec.ts` | The wire-mapping rules: empty assistant text omitted, tool ids and thinking signatures preserved, the system-update placement, tool-call pairing validation, and the provider-error classification. |
| `packages/llm/llm-deepseek/tests/stream.spec.ts` | The SSE → `StreamChunk` translation rules, including the cumulative usage and the `message_stop` requirement. |
| `packages/llm/llm-deepseek/tests/upload-index.spec.ts` | The durable upload index: the scope digest, the compare-and-set commit, the reuse margin, the corrupt-file reset, and the non-cache filesystem failure that must propagate. |
| `packages/llm/llm-pi-ai/README.i18n.yaml` | Generated bilingual hash record for the pi-ai adapter README. |
| `packages/llm/llm-pi-ai/README.md` | The adapter's contract: route configuration (13 fields), the login path, the catalog/model-override rules, reasoning and protocol compat, runtime config changes, endpoint model discovery, and a long list of honest limitations. |
| `packages/llm/llm-pi-ai/README.zh.md` | Chinese mirror of the same contract. |
| `packages/llm/llm-pi-ai/locale/en.json` | UI locale stub: `meta.title` only. |
| `packages/llm/llm-pi-ai/locale/zh.json` | UI locale stub: title plus a description. |
| `packages/llm/llm-pi-ai/package.json` | Manifest; peers on `dsh-llm`, `dsh-credentials`, `dsh-authorization`, `dsh-settings`, and the pi-ai library. |
| `packages/llm/llm-pi-ai/tsconfig.json` | Project references to `llm`, `llm-retry`, `core/session`, `core/agent`, `settings/settings`, `credentials`. |
| `packages/llm/llm-pi-ai/tests/adapter.e2e.ts` | Real-API e2e: the same prompt through the pi-ai route and the native DeepSeek route produces the **same block structure**. |
| `packages/llm/llm-pi-ai/tests/adapter.spec.ts` | Provider routing, the one-snapshot rule, the header merge, the effort ladder, the idle watchdog, the SDK-retry suppression, and the profile lifecycle. |
| `packages/llm/llm-pi-ai/tests/assemble.ts` | The assemble helper — deliberately the production streaming path, not a service shortcut. |
| `packages/llm/llm-pi-ai/tests/auth-double.ts` | The in-process credential store and ambient context double used by the streaming tests. |
| `packages/llm/llm-pi-ai/tests/auth.spec.ts` | The credential store over harness records (api-key field by field, OAuth grants verbatim, the JSON image of a grant) and the ambient auth context's precedence order. |
| `packages/llm/llm-pi-ai/tests/catalog-provider-ids.spec.ts` | The three provider postures the configurable directory distinguishes: a chat model, a classifier-only model, and no models at all. |
| `packages/llm/llm-pi-ai/tests/catalog.spec.ts` | Hand-declared routes and catalog routes: the declared-modality layering order, the empty-list-means-no-answer rule, duplicate-id diagnostics, the unsupported-protocol refusals, and the per-model override rules. |
| `packages/llm/llm-pi-ai/tests/compat-upgrade.spec.ts` | The gateway compat declarations that must survive a pi-ai upgrade (budget fields, scheduler priority, template args) and the ones that must stay absent. |
| `packages/llm/llm-pi-ai/tests/config.spec.ts` | The reasoning, modality, and image-policy schema boundaries — including `false` staying distinguishable from absent. |
| `packages/llm/llm-pi-ai/tests/context.spec.ts` | The history conversion on both paths: image resolution, the shared normalised-path text, the offload placeholder, the per-occurrence offload count, and the system-prompt handling. |
| `packages/llm/llm-pi-ai/tests/conversation-updates.spec.ts` | Capability-driven transcript updates: Anthropic's full prompt snapshots and grouped tool additions, the deferred placeholder, and the Kimi/Codex/Responses variants of "historical tool availability on the wire". |
| `packages/llm/llm-pi-ai/tests/convert.spec.ts` | `toPiContext` and `toStreamChunks`: tool-name recovery, malformed-argument fallbacks, the four replay-degradation shapes, and the provider thinking level surviving a round trip. |
| `packages/llm/llm-pi-ai/tests/discovery.spec.ts` | Catalog and draft discovery: the two listing formats, the Anthropic listing path, the oversized-reply refusal, the unusable-row drop, the credential-fault-vs-unreachable distinction, and the recorded listings. |
| `packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts` | Dormant-to-active composition, a route added and dropped by the settings layer, a rotated per-request credential, an in-place re-registration on a policy change, and the refusal of a settings write the adapter could not serve. |
| `packages/llm/llm-pi-ai/tests/egress.spec.ts` | The proxy egress check for discovery and for the provider stream. |
| `packages/llm/llm-pi-ai/tests/fixtures/model-listings/anthropic-reference-example.json` | The Anthropic reference listing (ids, display names, capabilities, limits, costs) used to normalise a provider's own listing. |
| `packages/llm/llm-pi-ai/tests/fixtures/model-listings/deepseek-2026-09-02.json` | The DeepSeek `GET /models` listing fixture (three ids, no capacities). |
| `packages/llm/llm-pi-ai/tests/fixtures/model-listings/models-dev-anthropic-2026-09-02.json` | The models.dev Anthropic catalogue fixture — context limits, output limits, and per-token costs. |
| `packages/llm/llm-pi-ai/tests/fixtures/model-listings/openrouter-2026-09-02.json` | The OpenRouter listing fixture (slugged ids, `context_length`, architecture modality). |
| `packages/llm/llm-pi-ai/tests/loader-composition.spec.ts` | A real dormant composition: zero routes at boot, a route the moment settings supply one, the OpenAI sign-in offer, settings-only route headers, and a legacy session whose replay state no longer matches its content. |
| `packages/llm/llm-pi-ai/tests/login.spec.ts` | One flow per installed provider with the methods it ships; the pi-ai auth type the chosen method names; the neutral restatement of every login event and prompt; the attempt-wide cancellation signal. |
| `packages/llm/llm-pi-ai/tests/mock-server.ts` | The mock HTTP/SSE server (with zstd response support) the pi-ai suites script. |
| `packages/llm/llm-pi-ai/tests/native-auth.spec.ts` | The generated provider metadata: the synthetic resolver probe, the env-name discovery, and the fallback data check. |
| `packages/llm/llm-pi-ai/tests/protocol-roundtrip.spec.ts` | Per-protocol request/response round trips — the wire shape of each supported API. |
| `packages/llm/llm-pi-ai/tests/provider-apis.e2e.ts` | Real-API provider round trips behind the provider's own credentials. |
| `packages/llm/llm-pi-ai/tests/sdk-options.spec.ts` | The SDK request options the adapter is allowed to set — and the ones it must not. |
| `packages/llm/llm-pi-ai/tests/tool-argument-streaming.spec.ts` | Streamed tool-call argument handling (the patch that removes the per-delta re-parse). |
| `packages/llm/llm-retry/README.i18n.yaml` | Generated bilingual hash record for the retry README. |
| `packages/llm/llm-retry/README.md` | The retry executor's contract: persist-then-wait, the normal and always modes, the `agent/request-error` waterfall composition, the "no model-visible content" guarantee, and five honest limitations. |
| `packages/llm/llm-retry/README.zh.md` | Chinese mirror of the retry contract. |
| `packages/llm/llm-retry/locale/en.json` | UI locale stub: `meta.title` only. |
| `packages/llm/llm-retry/locale/zh.json` | UI locale stub: title plus a description. |
| `packages/llm/llm-retry/package.json` | Manifest for the retry executor (no configuration of its own). |
| `packages/llm/llm-retry/tsconfig.json` | Project references to `llm`, `core/session`, `core/agent`, `util/brand`, `util/timeout`. |
| `packages/llm/llm-retry/tsdown.config.ts` | The bundle configuration (ESM, node, es2024, `dts: false`). |
| `packages/llm/llm-retry/tests/loader-composition.spec.ts` | A real Loader composition: a provider-supplied policy is loaded and the recovery is recorded through the shipping agent loop. |
| `packages/llm/llm-retry/tests/persistence.spec.ts` | The `llm/retry` event round-trips through JSONL losslessly **without adding a model message**. |
| `packages/llm/llm-retry/tests/retry.spec.ts` | The policy selection by failed provider, the code eligibility set, the bounded jittered backoff, the `Retry-After` handling (in-bounds verbatim, over-cap delegated), the "partial failed chunks stay on their step" rule, the "no failed text reaches the model context" rule, and the disposal/cancellation matrix. |
| `packages/llm/llm-retry/tests/transport-recovery.spec.ts` | Bounded retry through the *real* DeepSeek HTTP/SSE adapter: a refused connection recovered after the endpoint starts, a content-less completion retried, a clean EOF surfaced as a non-default-retryable `STREAM_CLOSED`, a stalled body turned into `TIMEOUT`, and the budget's exhaustion. |
| `packages/llm/llm/README.i18n.yaml` | Generated bilingual hash record for the core service README. |
| `packages/llm/llm/README.md` | The provider-neutral service contract: the vocabulary, the eight invariants, the failure codes, the `ConfigureCall` composition pattern, and the source map. |
| `packages/llm/llm/README.zh.md` | Chinese mirror of the core service contract. |
| `packages/llm/llm/locale/en.json` | UI locale stub: `meta.title` only. |
| `packages/llm/llm/locale/zh.json` | UI locale stub: title plus a description. |
| `packages/llm/llm/package.json` | Manifest for the core service. |
| `packages/llm/llm/tsconfig.json` | Project references to `llm-retry`, `core/session`, `util/brand`, `util/timeout`, `attachment`. |
| `packages/llm/llm/tests/adapter-failure.spec.ts` | The failure normaliser contains hostile code: a throwing `Symbol.toPrimitive`, empty primitive throws, a throwing `message` accessor, and accessor-backed snapshots. |
| `packages/llm/llm/tests/api-key.spec.ts` | The credential format rules, the missing-vs-malformed distinction, and the guarantee that a refused key is never echoed. |
| `packages/llm/llm/tests/assembler.spec.ts` | The assembly rules (interleaved deltas, missing `block-start`, duplicate `block-start`, post-`block-end` stragglers) and the replay-metadata pruning on a `max-tokens` finish. |
| `packages/llm/llm/tests/assistant-stream.spec.ts` | The compact record, the validation invariants, the expansion, and the record-level readers (first token, visible content, last chunk of a type, joined text). |
| `packages/llm/llm/tests/attribution.spec.ts` | The version comes from the package manifest, the identity carries only static public facts, and the baseline header set is the User-Agent alone. |
| `packages/llm/llm/tests/call-config.spec.ts` | Field-wise config equality (including the stop list), the `deepFreeze` helper (never freezes an `AbortSignal`; survives cycles and deep nesting), and the agent-loop request identity marker. |
| `packages/llm/llm/tests/content.spec.ts` | The offload traversal order, the identity-preserving projection, the model-facing image text, the file handle with and without a path, and the frozen-block scan. |
| `packages/llm/llm/tests/message.spec.ts` | Message construction: detached+frozen output, identity minted once, the assistant role fixed, the bounded producer summary, and the tool-result/call-id coupling. |
| `packages/llm/llm/tests/properties.spec.ts` | The property-based `BlockAssembler` properties: the partials map never exceeds the distinct indices, re-assembly is idempotent, `blocks()` never throws, and `finish` defaults to `stop`. |
| `packages/llm/llm/tests/retry-policy.spec.ts` | The normal/always resolution, the frozen result, the detachment of a configured policy, and the rejection of every invalid bound. |
| `packages/llm/llm/tests/service.spec.ts` | The service boundary: the context-overflow classifier (and the unrelated-validation case it must not catch), the quota-vs-rate-limit distinction, `errorChain` over hostile values and cycles, the tool-update projection per route capability, the file projection outcomes, the atomic registry replacement, the failure normalisation, and the HMR disposal. |
| `packages/llm/llm/tests/topology.spec.ts` | The registry's atomicity (a replaced route set never publishes an empty registry), the throwing-listener containment, the configurable-provider directory's detach/withdraw rules, the model-discovery registry, and the image-pricing resolution. |
| `packages/llm/plugin-package-inventory-deepseek/README.i18n.yaml` | Generated bilingual hash record for the inventory README. |
| `packages/llm/plugin-package-inventory-deepseek/README.md` | The inventory's contract: the `enabled` switch, the collection rules, the exclusions, the identity resolution, and the "the inventory never blocks a model request" rule. |
| `packages/llm/plugin-package-inventory-deepseek/README.zh.md` | Chinese mirror of the inventory contract. |
| `packages/llm/plugin-package-inventory-deepseek/locale/en.json` | UI locale stub: `meta.title` only. |
| `packages/llm/plugin-package-inventory-deepseek/locale/zh.json` | UI locale stub: title plus a description. |
| `packages/llm/plugin-package-inventory-deepseek/package.json` | Manifest for the inventory contributor. |
| `packages/llm/plugin-package-inventory-deepseek/tsconfig.json` | Project references to `deepseek-llm-api-extensions`, `core/agent`, `core/session`, `vendor/loader`. |
| `packages/llm/plugin-package-inventory-deepseek/tests/inventory.spec.ts` | The collected inventory: the active-entry filter, the version/no-version reporting, the per-tree base resolution, the preset resolution, and the withdrawal when the contributing plugin reloads. |
| `packages/llm/plugin-package-inventory-deepseek/tests/private-package-composition.spec.ts` | An unversioned file plugin is reported by name alongside a versioned sibling and does not block a Loader-composed request. |
| `packages/llm/token-meter/README.i18n.yaml` | Generated bilingual hash record for the token-meter README. |
| `packages/llm/token-meter/README.md` | The measurement contract: the fold, the anchor, the three session projections, the composition, and "reading the numbers" (occupancy is a reference number, not a billing record). |
| `packages/llm/token-meter/README.zh.md` | Chinese mirror of the token-meter contract. |
| `packages/llm/token-meter/locale/en.json` | UI locale stub: `meta.title` only. |
| `packages/llm/token-meter/locale/zh.json` | UI locale stub: title plus a description. |
| `packages/llm/token-meter/package.json` | Manifest for the token meter. |
| `packages/llm/token-meter/tsconfig.json` | Project references to `llm`, `llm-retry`, `core/session`, `compaction/compaction`, `session/session-projection`. |
| `packages/llm/token-meter/tests/context-breakdown-projection.spec.ts` | The breakdown fold: the system/tools/message split, a compaction's shrinking message figure, the armed shadow claim and its expiry, the checkpoint round trip, and the shared estimator's per-block pricing. |
| `packages/llm/token-meter/tests/route-pricing.spec.ts` | Route-priced surfaces: the routed visual tokens, the repricing under a substituted text-only route, the logged offload repricing, the exact handle text for files, and the loud failure on a mismatched occurrence count. |
| `packages/llm/token-meter/tests/token-meter.spec.ts` | The service contract: the empty configuration type, the unknown-key refusal, the detached immutable measurement, the anchor selection (usage vs heuristic vs estimated), the envelope-change invalidation, the signed surface folds, and the transactional rejection of a malformed event. |
| `packages/llm/token-meter/tests/token-usage-projection.spec.ts` | The `tokenUsage` and `contextPressure` projections: a chunk sample and a final usage counted once, a retried attempt contributing again, the pressure replacing rather than accumulating, the capacity replacement, and the checkpoint round trip. |
| `packages/llm/token-meter/tests/turn-usage.spec.ts` | The exact per-attempt usage fold: the disjoint cache buckets, the final-message replacement, the error-finished attempt across a retry boundary, the no-invented-attempt rule, the optional aggregates, and the fail-closed rules. |

---
### Tier 3 — skipped with a reason

- `packages/llm/llm-deepseek/tests/fixtures/red.png` — binary PNG asset, 69 bytes; size and type confirmed on disk, not a text file.
- `packages/llm/llm-pi-ai/tests/fixtures/qr-code.png` — binary PNG asset, 30,477 bytes; size and type confirmed on disk, not a text file.


## 2. Ideas worth stealing

1. **A machine-readable "how many more to drop" instead of a prose apology.** When a request exceeds an image budget, the failure carries `offloadImages: <count of additional oldest occurrences to offload>` (`packages/llm/llm/src/content.ts:318` `requiredImageOffload()`), and the caller offloads exactly that prefix and re-requests. *Why it transfers:* August Trading's chart screenshots are the same problem — a request that carries too many chart images should come back saying *which* ones to drop, not "too large". This turns a retry loop into a deterministic two-step.
2. **`UNIQUE` — a provider-declared capability flag that changes the wire shape, not a preference.** `ToolUpdate = 'in-history' | 'addition-only'` (`packages/llm/llm/src/types.ts:425`) and `SystemPromptUpdate = 'in-history'` are *route capabilities* the runtime reads to decide how to project history. *Why it transfers:* August Trading's "thinking tier" and "tool history" are currently renderer-side guesses; declaring the capability per model would let the runtime project the transcript correctly per route.
3. **`CONVERGENT` — one canonical projection per fact, applied on every route.** Files never reach an adapter: every `FileBlock` becomes the same deterministic handle line (`packages/llm/llm/src/content.ts:185` `projectFilesToText()`), images become the same handle text (`content.ts:91`), and the token meter prices *the same* handle text it dispatches (`packages/llm/token-meter/src/route-pricing.ts`). *Why it transfers:* August Trading's `Message.toolEvents` / `liveToolEvents` split shows the cost of a non-canonical projection; a single `renderableTextFor(block)` used by the renderer, the pricer, and the logger would make the three agree by construction.
4. **`UNIQUE` — the drift gate as a compile error.** `MODALITY_GATE: Record<PiAiModality, true>` (`packages/llm/llm-pi-ai/src/catalog.ts:48`), `THINKING_LEVEL_GATE` (`:75`), and the compat-field gate (`:566`) make an upstream vocabulary change *fail the build naming the drifted key* rather than silently narrowing what a user may declare. *Why it transfers:* August Trading's `ReasoningEffort` union (`types/provider.ts`) and its provider `FinishReason` normalisation are exactly the places where an upstream provider adds a value; a `Record<Union, true>` gate would make that a build failure with a name.
5. **`UNIQUE` — persist the retry *before* you wait, and let the durable record be the schedule.** The retry executor appends `llm/retry` and only then waits on a cancellable timer (`packages/llm/llm-retry/src/index.ts:188,190`), so a crash or a cancel can never leave an invisible pending retry. *Why it transfers:* August Trading's scheduled automations and the "streak that disables a schedule after three runs that produced nothing" breaker would be much easier to reason about if the *intent* were durable before the wait.
6. **`UNIQUE` — the failure code is the contract, the message is not.** `HarnessError`/`LlmError` carry a stable `code` and the docs say "Route on this, never by parsing `message`" (`packages/llm/llm/src/error.ts:1`), with the canonical set including `EMPTY_RESPONSE` ("an empty message silently ends the turn with nothing for the user or the loop to act on", `error.ts:42`) and `INVALID_CREDENTIAL` (deliberately *not* retryable, `error.ts:51`). *Why it transfers:* August Trading's `toFriendlyProviderError` already normalises; adding an `EMPTY_RESPONSE`-style code for "the model answered but produced nothing" would stop a turn from dying silently.
7. **`UNIQUE` — an "under-claim or over-claim" argument written into a default.** `DEFAULT_INPUT = ['text']` is chosen because "Under-claiming refuses the image before it is attached, naming the model. Over-claiming admits one the provider then rejects mid-turn, after the message is durable" (`packages/llm/llm-pi-ai/src/config.ts` on `DEFAULT_INPUT`). *Why it transfers:* the same asymmetry argument applies to August Trading's chart/vision capability guesses and to whether a "trade idea" flag should default on.
8. **`UNIQUE` — the shared shadow-price protocol that lets three projections agree.** The armed-claim protocol (`packages/llm/token-meter/src/surface-projection.ts`, consumed by `breakdown-projection.ts` and `usage-projection.ts`) is what keeps a *scalar* projection consistent with the service's own O(surface) fold. *Why it transfers:* August Trading's context-window compaction and its occupancy display both need the same "what would the next request cost" answer; one shared arm/commit protocol beats two independent estimates.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** *not in this shard.* This shard has no cron, no TP/SL watcher, no scheduled digest — the `llm-retry` executor's "schedule" is a bounded backoff at an agent step boundary, not a recurring job. The one transferable piece is the **breaker-by-emptiness** idea: the retry executor's budget is per provider and per policy key, and a route replacement with different codes starts a *new* history rather than inheriting the old budget (`packages/llm/llm-retry/src/index.ts`).
- **Human-in-the-loop approval:** *not in this shard*, except one seam: `llm-pi-ai`'s login flows are the harness's authorization seam, and the rule is that a **flow carries a per-prompt withdrawal signal and an attempt-wide cancellation signal** (`packages/llm/llm-pi-ai/src/login.ts`, `tests/login.spec.ts:187`). That is the shape an approval flow wants: every prompt individually cancellable, and the whole attempt cancellable.
- **Post-mortem / reflection loops:** *not in this shard* (no rule/skill store here). The nearest thing is the **replay-degrade protocol**: a native-thinking replay that no longer validates is *degraded* to provider-neutral content with a named reason, and the reason is surfaced to the caller (`packages/llm/llm-deepseek/src/replay.ts` `readReplay()`; `packages/llm/llm-pi-ai/src/replay.ts` `toPiAssistant()`). The transferable pattern is "a historical artefact that no longer matches reality degrades to a plain form, loudly, instead of being trusted or dropped".
- **Multi-agent:** *not in this shard* — no subagent or debate code here. The one relevant seam is the harness's **`ContextForm` vocabulary** (`packages/llm/llm/src/message.ts`): `'relay'` ("a message another agent addressed to this one") and `'recall'` ("material lifted out of another session's log, possibly reduced on the way in") are the two forms that exist precisely because agents exchange context. The rule that makes it safe: the *form* is semantic and the consumer decides how it looks, so an agent can hand over a notice without owning its presentation.
- **Structured logs the model can query:** this shard *is* the substrate of that. Two designs carry it: (a) the **durable session log with a replay fold** — `TokenMeter` measures pressure by *replaying the log* rather than keeping a second copy (`packages/llm/token-meter/src/index.ts:146` `measure()`), so the log is the single source of truth for "what is in the context right now"; and (b) the **compact assistant-stream record** (`packages/llm/llm/src/assistant-stream.ts:100`) — a delta-encoded, time-stamped, per-block record that lets a consumer answer "when was the first token?" in O(1) without expanding the stream, and the expansion is a *validated* path (`assistant-stream.ts:202`). Neither uses a database.
- **Staying simple as features accumulate:** three concrete rules, all visible in code. (i) **The provider owns the wire; the service owns the vocabulary** — `packages/llm/llm/src/index.ts:208` (`LlmAdapter`) is a small abstract surface and the whole provider-specific surface lives in an adapter package. (ii) **The sampling vocabulary only grows when a producer lands** — `GenerateOptions` has `temperature`, `maxTokens`, `stop` and nothing else, and the README cites the deleted "inert request knobs" note (`packages/llm/llm/README.md`, "Known Limitations"). (iii) **A plugin contributes one field, not a feature** — the extension registry makes the *entire* cost of a new provider-side feature one `register()` call plus one field (`packages/llm/deepseek-llm-api-extensions/src/index.ts:66`).

## 4. Non-obvious decisions and gotchas

1. **The DeepSeek "twin" adapters are two different adapters for one provider, and it is deliberate.** `llm-deepseek` speaks the Messages protocol directly; `llm-pi-ai` speaks it through pi-ai's catalogue. The two can be mounted together because their *route names* do not collide, and registering a route another adapter owns fails plugin loading (`packages/llm/llm-pi-ai/README.md`; `packages/llm/llm-pi-ai/src/index.ts`). A reader who assumes "one adapter per provider" will mis-patch this.
2. **The provider's own vision-token formula is transcribed, not approximated.** `packages/llm/llm-deepseek/src/image-tokens.ts:147` is a verbatim port of the published calculator, including the 544×544 scale-up floor, the 14-px patch grid, the 3:1 downsampling, and the `height * (width + 1) + 2` token formula. The module also documents that the *request* dimensions and the *solved grid* can disagree — the pricing prices the sent dimensions.
3. **The `in-history` system-prompt mode is a wire-shape fact, and getting it wrong breaks the request.** A route declares `systemPromptUpdate: 'in-history'` only if the endpoint reads the latest `system` message *at any position* as the complete effective prompt; then the adapter appends a changed system snapshot *after* the cached history instead of rewriting the leading system message — which is what preserves the provider's KV cache. A route that lies about this gets a "system update without a preceding user or tool-result turn" refusal (`packages/llm/llm-deepseek/src/serialize.ts`).
4. **The upload-reuse namespace is a hash of the *credential headers*, not of the credential.** `deepSeekFileScope(baseURL, credentials)` hashes the base URL plus the serialised headers (`packages/llm/llm-deepseek/src/upload-index.ts:45`); the file store computes the same digest from *sorted* header entries, so reordering headers does not change the namespace, but changing a key does (`packages/llm/llm-deepseek/src/file-store.ts`). A reader looking for a stored secret will not find one — the digest is not reversible and no raw credential is persisted.
5. **A provider error is classified by regex over its message text, on purpose.** Stale file ids (`packages/llm/llm-deepseek/src/request-files.ts`) and quota conditions (`packages/llm/llm-deepseek/src/files-api.ts`) are detected by matching the provider's prose. This is brittle by nature — and it is the only way to recover without a structured provider error. The file id match is careful about word boundaries so `file_abc` inside a longer token does not match.
6. **The generator's teardown deliberately does *not* await the iterator's drain.** `packages/llm/llm-deepseek/src/adapter.ts` (the `finally` block) explains that a demand the deadline abandoned can stay pending forever, and awaiting the drain would re-hang the settled outcome. A reader "fixing" this by awaiting cleanup will reintroduce a deadlock.
7. **Two prices for the same content, deliberately.** Every surface node carries a route-priced `tokens` *and* a route-independent `heuristicTokens` (`packages/llm/token-meter/src/types.ts`), and the README says the two totals are *intentionally* different. The heuristic is what the shadow-price protocol uses so an O(1) projection fold stays in agreement with the service's own appends; the route price is what a consumer should show. Conflating them is the mistake the code is written to prevent.
8. **A provider's usage is reused only for an identical request envelope — and only if it does not understate.** `packages/llm/token-meter/src/index.ts` (the anchor logic): the usage is accepted only when the canonical envelope matches *and* the provider's total is no lower than that call's full route-priced anchor. A provider number can therefore never understate the pressure, which is the property a compaction decision depends on.
9. **A refused credential must not be retried, and must not be confused with a missing one.** `INVALID_CREDENTIAL` is "deliberately outside the default retryable set" (`packages/llm/llm/src/error.ts:51`); the account route rewrites the shared `QUOTA` into `ACCOUNT_QUOTA` so a top-up action appears for account failures only, and it expires the stored login only if the token still matches the request (`packages/llm/llm-deepseek-account/src/index.ts`).
10. **The "best-effort" contributor never blocks the request.** The plugin-inventory omits a package it cannot resolve, logs one warning per module, and sends the field anyway (`packages/llm/plugin-package-inventory-deepseek/src/index.ts`). It also caches the manifest identity for the process lifetime — "replacing a mounted package's manifest in place is not a supported upgrade path" — which is a real constraint a reader will trip over.
11. **Login is not durable, and the README says so.** A page refresh mid-login abandons the attempt (`packages/llm/llm-pi-ai/README.md`, "Known Limitations"). It is the one place in this shard where the harness's own persistence discipline is *not* applied to a user-visible flow.
12. **The `pi-ai` SDK retries are deliberately disabled**, so "the durable agent steps and the `llm/retry` events own every visible attempt" and a direct `ctx.llm.stream()` call is still a single attempt. A reader who sees the SDK retry internally will mis-count the attempts a session log shows.
13. **A pi-ai stream is patched to avoid an O(n²) re-parse.** The installed pi-ai carries a patch removing the per-delta re-parse of the whole accumulated tool-argument JSON; unpatched, "a multi-megabyte argument stream burns O(n²) CPU on the event loop and stalls every session in the process" (`packages/llm/llm-pi-ai/README.md`, Known Limitations). Any pi-ai upgrade must re-apply or withdraw it.

## 5. Weak spots

1. **The DeepSeek account route's "models" configuration is retired but the retirement is a load-time *error*, not a migration.** A stored config with `models` fails to load with "models is no longer configurable" (`packages/llm/llm-deepseek-account/src/config.ts`). That is defensible (it cannot be silently ignored) but it is a hard break for any existing deployment.
2. **The provider-error classification is regex over prose, in two places** (stale file ids, quota detection). A provider that rewords an error silently loses its recovery path, and the failure looks like a generic 400.
3. **The `always` retry mode is unbounded and retries permanent failures.** Authentication, quota, invalid-request, and protocol errors are all retried until success, cancellation, or disposal (`packages/llm/llm-retry/README.md`, Known Limitations). The cost control is entirely the deployment's problem, and the "downstream-first" posture means a downstream policy that ignores cancellation and never settles blocks the fallback *and* the turn's quiescence.
4. **The `llm-pi-ai` package is the most complex thing in the shard** — a 47 KB catalogue module with four drift gates, a compat-field refusal protocol, a generated metadata file, and a generator that probes resolvers. It is a lot of machinery whose only job is "let a user point the harness at any provider", and the compat surface is the part that will rot on every pi-ai upgrade.
5. **The token meter's fixed heuristic underestimates badly and the README says so** — four characters per token "severely underestimates CJK text and JSON schema" (`packages/llm/token-meter/README.md`). It is honest about it and the numbers are labelled "approximate composition", but a UI that shows the number prominently is showing a wrong number.
6. **The provider catalogue is *advisory* in a way that can surprise.** An unlisted model id still passes through as a text-only route, and a *saved* selection keeps working after its catalogue entry disappears (`packages/llm/llm-deepseek/README.md`). A user can be sending to a model the UI no longer believes exists.
7. **Two files carry the same policy in two places.** The image budget constants live in `llm-deepseek/src/defaults.ts` (inline) and `llm-deepseek/src/request-pricing.ts` (file mode), and the "stepped offload quantum" rationale is only in the README — the code does not say why 64 MiB / 10 MiB / 20 images.

---


