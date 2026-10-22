# hermes-agent :: hermes-plugins

**Files in shard:** 430 (read: 423, skipped with reason: 7)
**What this shard covers:** the entire `plugins/` tree of Hermes Agent — the plugin host and its per-kind discovery systems, the plugin-policy document, the memory / cron / context-engine / computer-use / browser / model-provider / image-gen / video-gen / web-search plugin families, the dashboard-auth providers, the ephemeral-file cleanup plugin, the Google Meet bot, the security-guidance pattern scanner, the Microsoft Teams meeting-summary pipeline, the A2A (agent-to-agent) protocol plugin, and 27 chat-platform adapters. It is the **harness surface** of Hermes: how work is scheduled, how providers are reached, how secrets and trust are gated, how sessions are remembered, and how a second agent is talked to. It contains almost no trading logic — that lives elsewhere in the repo — so the trading findings below are about *scheduling, approval, audit, memory and multi-agent* mechanics, not about markets.

> **How this was read.** Every file in the shard was opened. The load-bearing source files (the plugin host, memory providers, cron provider, auth providers, cleanup plugin, Meet plugin, security scanner, Teams pipeline, A2A plugin, and the two dashboard backends) were read line by line. The ~200 chat-platform adapter files (Discord 385 KB, Slack 373 KB, Telegram 442 KB, Feishu 226 KB, Matrix 180 KB, and their siblings) were read as **structure**: the module docstring plus the complete top-level def/class map, which is what the per-file rows below reflect. Four large files were read partially and say so in their row. The seven generated bundles, binary screenshots and the npm lockfile were **not** read line by line and are listed in §1's Tier-3 table with the reason.

## 1. File-by-file (1 of 3 — plugin core, memory, cron, auth, cleanup, Meet)

### Tier 1 — load-bearing source: full entry

#### `plugins/AGENTS.md` (docs, 14 KB)
- **Purpose:** The canonical policy document for everything under `plugins/` — what may live in the tree, the per-kind discovery table, the plugin-host isolation boundary, the native-compatibility contract, and the "plugins never touch core" rule.
- **Key abstractions:** the plugin-kind table (General / Memory provider / Model provider / Context engine / Platform adapters), each with its discovery path and its precedence rule.
- **Data flow:** none (a document), but it *decides* the runtime behaviour of `plugins/*/__init__.py` files.
- **Non-obvious decisions:** (a) **memory providers are bundled-first** while general plugins are **later-wins** — the reversal is deliberate because a provider is activated by name, so a dropped-in directory must not shadow a shipped one (`plugins/AGENTS.md`, "Plugin kinds" table). (b) **"A hook with no concrete consumer is speculative infrastructure and is rejected (root)."** — an explicit gate against speculative extension points. (c) `plugins/memory/` is **closed to new in-tree providers**; new backends must ship as standalone repos through the catalog. (d) "Plugins never touch core": widen the *generic* surface instead of hardcoding plugin logic into `run_agent.py`/`cli.py`.
- **Edge cases & failure handling:** documents the discovery-timing pitfall (`discover_plugins()` only runs as a side effect of importing `model_tools.py`; anything reading plugin state must call it explicitly), the "never emit `on_plugin_loaded` from an RPC" rule, and the rule that a plugin changing a default must add a migration guard keyed on `_explicitly_configured`.
- **Surprising:** the "internal import paths are not API" section — a 2026-09-14 removal window means an old import path now raises `ImportError` **surfaced as the plugin's load error in `hermes plugins list`**, and re-export shims are forbidden.

#### `plugins/plugin_loader.py` (12 KB)
- **Purpose:** Shared loader for `plugins/<kind>/<name>/` discovery packages: import `__init__.py` *by path* with siblings pre-registered so relative imports work, then extract the provider via `register(ctx)` or an ABC-subclass fallback.
- **Key abstractions:** `load_plugin_module()`, `load_named()`, `instance_from_module()`, `iter_plugin_dirs()`, `read_plugin_description()`, `probe_availability()`, `bounded_load_wait()`, `NoopPluginContext`, `register_synthetic_package()`.
- **Data flow:** path → `importlib` spec → `sys.modules` under a synthetic name → `register(ctx)` or subclass scan → provider instance. Sibling `.py` files are exec'd *before* the package `__init__` so `from ._x import Y` resolves; the child is then bound onto the parent and siblings onto the module.
- **Non-obvious decisions:** the **deadlock detector**. importlib cannot see the loader's own lock in its deadlock check, so `_load_would_deadlock()` walks both the loader-lock graph and `importlib._bootstrap._blocking_on` to detect a cycle and accept a partially-built module the way importlib does. A **bounded wait** (`_CONCURRENT_LOAD_WAIT_SECS = 10.0`) means a per-turn caller gives up on another thread's hung plugin import instead of stalling the turn; the module is then marked *stalled* and later bounded callers refuse at once.
- **Edge cases & failure handling:** a failed `exec_module` leaves the `sys.modules` entry in place (callers wanting a clean retry pop it themselves); `iter_plugin_dirs` swallows a per-child `OSError` (mode-000 / ACL-denied directory must not abort the listing) and logs a warning; `probe_availability` treats a provider with no `is_available()` as available.
- **Surprising:** `load_plugin_module` **refuses to import user code in-process** when `plugins.isolation: host` is set — the refusal is the boundary, and a synthetic-namespace import that routes anywhere else is a policy violation.

#### `plugins/plugin_storage.py` (2.1 KB)
- **Purpose:** Per-plugin persistent storage at `<hermes home>/plugin-data/<name>/`.
- **Key abstractions:** `plugin_data_dir(name)`, `plugin_db(name, filename)`.
- **Data flow:** name → validated path → created directory; `plugin_db` opens a SQLite connection in WAL mode.
- **Non-obvious decisions:** plugins must **not** park state in `<hermes home>/plugins/<name>/` (the install dir, deleted by `remove` and git-pulled by `update`); the home is resolved **on every call** so it follows the active profile rather than being cached across a profile switch.
- **Edge cases & failure handling:** the name is validated against `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$` with a `..` rejection (traversal); the db filename must be a bare name; WAL is set through the *shared* `open_db` helper rather than a raw `PRAGMA`, so network-filesystem and WAL-reset-bug fallbacks still apply.
- **Surprising:** secrets are deliberately **not** part of this convention — credential reads go through `agent.secret_scope` / `.env`.

#### `plugins/plugin_utils.py` (2.3 KB)
- **Purpose:** Thread-safe lazy singletons for plugin authors (stdlib-only).
- **Key abstractions:** `SingletonSlot[T]`, `lazy_singleton(factory)`.
- **Data flow:** `accessor()` → `slot.get(factory)` → double-checked lock → cached instance; `accessor.reset()` drops it.
- **Non-obvious decisions:** **"first config wins"** — the factory runs at most once under concurrent first calls; if it raises, nothing is cached and the next call retries. The fast path reads a bool + a ref without taking the lock (atomic under the GIL).
- **Edge cases & failure handling:** an exception in the factory propagates but leaves the slot unset, so a transient failure does not poison the provider forever.
- **Surprising:** the docstring names the exact footgun it removes — `if _client is None: _client = Expensive()` lets two threads both build and the second leaks the first's connections.

#### `plugins/__init__.py` (25 B)
- **Purpose:** Marks `plugins` as a package; one comment line. Nothing else.

#### `plugins/browser/_common.py` (5.9 KB)
- **Purpose:** Shared base class for the bundled cloud-browser plugins: every vendor speaks the same REST shape (POST to create, one request to release).
- **Key abstractions:** `CloudBrowserProvider` with `provider_id`, `label`, `release_method`, `release_path`, `missing_credentials_error`, `setup_tag`, `setup_env_vars`, `create_label_suffix`, `close_fail_fmt`; hooks `_get_config_or_none()`, `_headers()`, `_release_body()`.
- **Data flow:** `create_session()` → `_post_create()` → `_check_created()` → dict of `{session_name, bb_session_id, cdp_url, features}`; `close_session()` → `_release()` → boolean.
- **Non-obvious decisions:** `requests_verify()` is passed explicitly because "requests resolves `verify=True` through a bundle path frozen at its own import, which a replaced install environment leaves dangling" — the live bundle path is handed in on every call. The per-subclass logger is `type(self).__module__`, so emitted text still matches the pre-refactor per-vendor modules.
- **Edge cases & failure handling:** `close_session` returns `False` and logs rather than raising on a missing credential or a non-OK status; `emergency_cleanup()` is the best-effort variant (5 s timeout); `_post_create` wraps network errors into `RuntimeError` *unless* `wrap_errors=False`, which the managed gateway needs so it can retry with a preserved idempotency key.
- **Surprising:** `setup_tag = None` **hides** a provider from the setup picker — a provider can be fully registered but invisible in the onboarding UI.

#### `plugins/browser/browser_use/provider.py` (7.3 KB)
- **Purpose:** The only backend with **dual auth**: a direct `BROWSER_USE_API_KEY` or the managed Nous tool gateway (billed to a subscription).
- **Key abstractions:** `BrowserUseBrowserProvider`, `_get_or_create_pending_create_key()`, `_should_preserve_pending_create_key()`.
- **Data flow:** selection (`read_selection("browser")`) → direct **or** managed config → `POST /browsers` with an `X-Idempotency-Key` in managed mode → session dict.
- **Non-obvious decisions:** the selection is **strict**: `"nous"` means managed *only*; any other stored selection means direct *only* — no silent managed fallback. The managed mode asks NAS for a **5-minute** session (`_DEFAULT_MANAGED_TIMEOUT_MINUTES = 5`) because "billing authorization must not default to a long Browser-Use timeout".
- **Edge cases & failure handling:** the idempotency key is preserved across retries only when the failure is retryable (any 5xx, or a 409 whose body says "already in progress"); a 4xx auth/bad-request failure drops the key so the next attempt is clean. `is_available()` avoids the synchronous OAuth refresh path (`peek_nous_access_token`) so availability scans stay cheap.
- **Surprising:** the imports of the managed gateway are **lazy inside the method** so direct-key users never pull in the Nous auth stack.

#### `plugins/browser/browserbase/provider.py` (5.4 KB)
- **Purpose:** Browserbase cloud browser (direct key + project id), with stealth/proxies/keep-alive knobs.
- **Key abstractions:** `BrowserbaseBrowserProvider`, `_PAID_FEATURE_FALLBACKS`.
- **Data flow:** env/secret → `session_config` → `POST /v1/sessions` → features dict.
- **Non-obvious decisions:** **graceful degradation on HTTP 402**: the paid features are dropped *in retry order* (`keepAlive` first, then `proxies`) and the request is retried, with the dropped set recorded in the returned `features` so the caller can tell the trader which protections were lost. The base URL is read through the **scoped** secret so a per-profile key is not sent to the default profile's endpoint.
- **Edge cases & failure handling:** an invalid `BROWSERBASE_SESSION_TIMEOUT` logs a warning and is ignored; a missing key/project id makes `is_available()` false rather than raising.
- **Surprising:** the returned `features` map is a *truth report* (`basic_stealth`, `proxies`, `advanced_stealth`, `keep_alive`, `custom_timeout`), not just booleans for the UI.

#### `plugins/browser/firecrawl/provider.py` (2.8 KB)
- **Purpose:** Firecrawl cloud browser (`/v2/browser` only) — distinct from the `plugins/web/firecrawl/` search plugin, though both share the API key.
- **Key abstractions:** `FirecrawlBrowserProvider`.
- **Data flow:** `FIRECRAWL_BROWSER_TTL` (default 300 s) → `POST /v2/browser` → session dict.
- **Non-obvious decisions:** `_get_config()` **never raises** — a missing key surfaces from `_headers()` *inside* the request try-block, so `close_session` logs it as an exception (deliberately preserving legacy behaviour).
- **Edge cases & failure handling:** a malformed TTL falls back to 300 s rather than failing the join.

#### `plugins/browser/*/__init__.py` + `plugin.yaml` (6 files)
- **Purpose:** one-line `register(ctx)` shims + manifests for the three cloud-browser backends.
- **What they pin:** the manifest's `kind: backend` and `provides_browser_providers:` list is what the discovery path reads; `plugin.yaml` descriptions are what `read_plugin_description()` surfaces in `hermes tools` — **listing never imports the provider**.

#### `plugins/computer_use/__init__.py` (5.2 KB)
- **Purpose:** Computer-use provider discovery: bundled first, then user plugins; **exactly one** provider is active, named by `computer_use.backend` in the active profile's config.
- **Key abstractions:** `discover_computer_use_providers()`, `find_provider_dir()`, `load_computer_use_provider()`, `configured_backend_name()`, `get_active_provider()`.
- **Data flow:** config name → directory → module load → `ComputerUseProvider` instance.
- **Non-obvious decisions:** discovery uses a **cheap text heuristic** (`"register_computer_use_provider" in source or "ComputerUseProvider" in source` over the first 8 KB) so listing never imports anything. A configured name that resolves to nothing **fails** — "there is no fallback driver", and the error message distinguishes "could not be loaded" from "is not installed".
- **Edge cases & failure handling:** providers hand back *live driver sessions*, so they load in-process only; under `plugins.isolation: host` the loader refuses and the failure surfaces as "could not be loaded" — an honest, specific message.
- **Surprising:** the fallback `is_available()` accepts a missing host driver when the desktop is placed inside a terminal backend whose image carries the driver — placement is config, the binary is probed lazily.

#### `plugins/computer_use/cua/__init__.py` + `plugin.yaml` (2 files)
- **Purpose:** The built-in `cua` computer-use provider (cua-driver over MCP) and its manifest.
- **What they pin:** `create_backend(permission_mode=...)`; `is_available()` = supported OS + driver binary, else the terminal-backend placement check.

#### `plugins/context_engine/__init__.py` (6.0 KB)
- **Purpose:** Context-engine plugin discovery (bundled → user), separate from the general plugin system: `context.engine` in config names the active engine, so a user engine needs no `plugins.enabled` entry.
- **Key abstractions:** `discover_context_engines()`, `find_engine_dir()`, `load_context_engine()`, `_EngineCollector`.
- **Data flow:** name → dir → module → `ContextEngine` instance via `register_context_engine` or a subclass.
- **Non-obvious decisions:** the `_EngineCollector` forwards `register_command` to the **global plugin command registry**, and refuses a command name that collides with a built-in or an existing plugin command (a warning, not an exception) — a context engine cannot shadow a core command.
- **Edge cases & failure handling:** `probe_availability()` in `discover_context_engines()` actually *loads* each engine to test availability, so a broken engine shows as unavailable rather than silently vanishing.
- **Surprising:** under `plugins.isolation: host` a user engine is loaded through `host.load_instance(..., capture="register_context_engine", base_ref=...)` — the host returns a *proxy* registered as a subclass of the ABC, so the caller's `isinstance` checks still work.

#### `plugins/cron_providers/__init__.py` (4.5 KB)
- **Purpose:** Cron-scheduler provider discovery: bundled → user; the built-in `InProcessCronScheduler` is core and is the permanent fallback.
- **Key abstractions:** `discover_cron_schedulers()`, `find_provider_dir()`, `load_cron_scheduler()`, `_ProviderCollector`.
- **Data flow:** `cron.provider` in config → provider dir → module → `CronScheduler` instance.
- **Non-obvious decisions:** the built-in ticker **cannot be removed** ("so the fallback can't be removed") — a hard constraint expressed in the module docstring. Discovery uses the same text heuristic as the other kinds.
- **Edge cases & failure handling:** `load_cron_scheduler` returns `None` (not an exception) when the provider is missing or fails, and the resolver falls back to the built-in ticker.

#### `plugins/cron_providers/chronos/__init__.py` (9.7 KB) — **the single most relevant file in this shard for trading work**
- **Purpose:** A NAS-mediated managed cron provider that lets a hosted agent **scale to zero** and still fire scheduled jobs: the agent computes the next-fire time and asks NAS to arm one external one-shot; NAS calls back `/api/cron/fire`.
- **Key abstractions:** `ChronosCronScheduler` with `start()`, `stop()`, `on_jobs_changed()`, `register_job()`, `reconcile()`, `fire_claimed()`, `_arm_one_shot()`, `_note_identity_rejected()`, `_list_armed()`.
- **Data flow:** `jobs.json` → `reconcile()` → `provision(job_id, fire_at, dedup_key=f"{job_id}:{fire_at}")` → NAS arms → NAS callback → `fire_claimed()` → job runs → re-arm the next one-shot. `start()` **returns immediately** — there is no 60 s ticker and no periodic wake.
- **Non-obvious decisions:** (a) **`dedup_key=(job_id, fire_at)`** makes re-arming the same fire a no-op on the NAS side, which is what makes "reconcile on every warm event" safe. (b) `reconcile()` is *convergent*, not imperative: it arms what is missing/changed and **cancels orphans** (observed − desired). (c) `is_available()` does **no network** — config presence + stored-token presence only. (d) The 403 `invalid_client` path: NAS maps the bearer to a *provisioned instance*; a plain `hermes auth` login is neither, and re-logging in **cannot** fix it. On that signal the provider sets `_identity_rejected` and **hands this process's fires to the built-in ticker** via `spawn_context_thread`, so scheduled jobs keep firing on time instead of silently misfiring.
- **Edge cases & failure handling:** a cold process simply re-arms (idempotent); `recover_interrupted()` classifies an interrupted process as *unknown* and never requeues; reconcile/fire failures are logged, never raised, so the loop cannot die on a NAS blip; `_arm_logged` swallows everything except the identity-rejection case.
- **Surprising:** there is deliberately **no `fire_due` override** — `provider_supports_split_fire` treats *any* override as the legacy single-phase signal, so adding one would silently opt Chronos out of claim admission and cancel-aware drain. The comment is a warning to the next editor.

#### `plugins/cron_providers/chronos/_nas_client.py` (4.0 KB)
- **Purpose:** Thin HTTP client for `agent → NAS` `agent-cron` endpoints (provision / cancel / list), authenticated with the existing Nous Portal token.
- **Key abstractions:** `NasCronClient`, `NasCronClientError` (with `status`, `error_code`, and the `identity_rejected` property).
- **Data flow:** JSON POST/GET → 2xx payload; non-2xx or transport error → `NasCronClientError`.
- **Non-obvious decisions:** the error type distinguishes a **deterministic** rejection (`403` + `invalid_client` — never transient) from a 5xx, so the provider can act on it instead of retrying forever.
- **Edge cases & failure handling:** 15 s timeout; the error body is truncated to 200 chars; a non-dict/odd `list` payload yields `[]` rather than raising.

#### `plugins/cron_providers/chronos/verify.py` (3.4 KB)
- **Purpose:** Inbound cron-fire token verification for Chronos: NAS POSTs `/api/cron/fire` with a short-lived NAS-minted JWT.
- **Key abstractions:** `verify_nas_fire_token()`, `get_fire_verifier()` (the pluggable seam), the `_FIRE_PURPOSE = "cron_fire"` claim.
- **Data flow:** bearer → PyJWT decode against a JWKS URL or inline PEM → claims → `{"purpose": "cron_fire"}` check.
- **Non-obvious decisions:** **never fall back to unsigned decode** on a security boundary (explicit comment); the purpose claim scopes a general agent JWT so it cannot be replayed at the fire endpoint; the PyJWKClient is cached **process-wide by JWKS URL** because PyJWKClient caches keys on the *instance* and a fresh client per fire re-fetched JWKS every time (the portal rate-limits 403→401, a relay 504s).
- **Edge cases & failure handling:** verification never raises — it returns `None` so the handler answers 401 without leaking which check failed; symmetric algorithms are rejected; `exp`/`nbf` are checked with 30 s leeway; `iss` is checked when configured.

#### `plugins/memory/__init__.py` (27.8 KB)
- **Purpose:** Memory-provider plugin discovery: bundled → user → project (opt-in) → pip entry points, with the precedence **deliberately reversed** from the general plugin manager.
- **Key abstractions:** `discover_memory_providers()`, `load_memory_provider()`, `import_memory_provider_module()`, `import_provider_module()`, `find_provider_dir()`, `list_memory_provider_names()`, `_ProviderCollector`, `discover_plugin_cli_commands()`, `_prune_inactive_memory_provider_skills()`.
- **Data flow:** name → directory (or entry point) → module load → `register(ctx)` → `MemoryProvider` instance; skills registered by the provider are tracked **per Hermes home** so pruning under one multiplexed profile cannot retract a sibling profile's skills.
- **Non-obvious decisions:** (a) discovery is **AST-parsed, never imported** when the 8 KB text heuristic misses — `_defines_memory_provider()` looks for a `register_memory_provider(...)` call or a `MemoryProvider` subclass, so a long module docstring cannot hide a provider. (b) The `register()` contract: **a raise *after* `register_memory_provider()` must not cost the provider** — the registered instance is kept and the later registrations skipped, because falling through to the subclass scan would hand back a bare second instance (a silent downgrade that looks like success). (c) `import_memory_provider_module()` exists because on Windows a first-time native import (numpy) racing another thread's import chain deadlocked `session/new` — the heavy import is paid on the main thread before any other thread starts. (d) `_ProviderCollector.__getattr__` forwards *any* `register_*` call to a real `PluginContext`; a hand-maintained stub had drifted and cost the provider.
- **Edge cases & failure handling:** `plugins.disabled` is honoured for non-bundled providers under **any spelling** (provider name, directory name, manifest `name:`) — otherwise "disabled" would be a lie in the UI; a failed schema load is **never cached** (it would pin an empty panel until restart); the CLI scan imports only the *active* provider's `cli.py`, so `hermes --help` stays clean; a pip entry point's directory is resolved **without importing it** (discovery runs before a provider is selected).
- **Surprising:** `load_memory_provider()` only registers the provider's **skills** when it is the configured active provider, so *inspecting* an inactive provider leaves no registry side effects.

#### `plugins/memory/config_schema.py` (4.8 KB)
- **Purpose:** A declarative config schema so one generic renderer + one `GET/PUT /api/memory/providers/{name}/config` pair drive the UI for every memory provider.
- **Key abstractions:** `ProviderField`, `ProviderFieldOption`, `ProviderConfigSchema`, `get_provider_config_schema()`, the `KIND_*` and `STORAGE_*` constants.
- **Data flow:** `config_schema.py` beside `__init__.py` → **loaded by path, never imported as a package** → frozen dataclasses → JSON to the dashboard.
- **Non-obvious decisions:** schema files are loaded by path because "plugin `__init__` pulls in the agent runtime, which must not load into the web server"; they may import only this pure-data module. Secrets live under `env_key` in the env store and are **never read back** — only `is_set`.
- **Edge cases & failure handling:** the schema is cached by **resolved file path**, not by provider name (user plugins are per-profile); a failed load is logged and returns `None` and is *not* cached.
- **Surprising:** under `plugins.isolation: host` a user schema is user code too, so it is fetched through the host and **rebuilt from a plain-data record** (`_schema_from_record`).

#### `plugins/memory/query_rewrite.py` (4.7 KB)
- **Purpose:** Rewrite the latest user message into one clean question for memory retrieval — provider-agnostic, so any memory provider can pass `rewrite_memory_query` as its query rewriter.
- **Key abstractions:** `rewrite_memory_query()`, `_normalize_rewrite()`, `_bounded_user_message()`, `_SYSTEM_PROMPT`.
- **Data flow:** user message → bounded (4 000 chars, head+tail with a `[... middle omitted ...]` marker) → auxiliary LLM call (temperature 0, max_tokens 96) → a question, or `""`.
- **Non-obvious decisions:** the output is **validated, not trusted**: it must start with a question word, must mention the user/their history/preferences, must not leak instructions, and must be a single sentence under 320 chars — otherwise it is discarded and the old behaviour (raw message) is preserved. The prompt treats the user message as **untrusted data** and passes it as a JSON string so the model cannot be talked into answering instead of rewriting.
- **Edge cases & failure handling:** any exception → `""` (fail to the old behaviour, never fail the turn); markdown fences, prefixes like `Query:` and quotes are stripped first.
- **Surprising:** the rewriter is an *auxiliary* LLM call with its own task key (`memory_query_rewrite`) and its own config (`auxiliary.memory_query_rewrite`), so it is budgeted and routed separately from the turn.

#### `plugins/memory/byterover/__init__.py` (13.9 KB)
- **Purpose:** ByteRover memory provider — a persistent knowledge tree driven through the `brv` CLI (hierarchical context tree, tiered retrieval).
- **Key abstractions:** `ByteRoverMemoryProvider` (`prefetch`, `queue_prefetch`, `sync_turn`, `on_memory_write`, `on_pre_compress`, `get_tool_schemas`, `handle_tool_call`), `brv_query` / `brv_curate` / `brv_status` schemas.
- **Data flow:** `prefetch()` runs `brv query` **synchronously** (10 s timeout) so context is ready before the first LLM call; `sync_turn()` curates the turn in a background thread; `on_pre_compress()` flushes the last 10 user/assistant messages before compaction discards them.
- **Non-obvious decisions:** the tool schemas are hand-written JSON-Schema dicts rather than a framework helper, and every tool result is a **JSON string** (the provider protocol's contract). `prefetch` refuses queries shorter than 10 characters (noise filter) and refuses to inject an output shorter than 20 characters.
- **Edge cases & failure handling:** the `brv` binary path is resolved once and cached under a lock (`None` = unresolved, `""` = resolved-missing); a vanished binary resets the cache; `subprocess.run` has a 30 s timeout for curate and the error text is returned as a tool error, not raised. `shutdown()` joins the sync thread for up to 10 s.
- **Surprising:** the child environment is **scrubbed and rebuilt** under multiplexed profiles: the launch profile's `BRV_*` keys are stripped and the served profile's key is re-read through the secret scope, because `os.environ` holds the *launch* profile's `.env`.

#### `plugins/memory/retaindb/__init__.py` (28.1 KB)
- **Purpose:** RetainDB cloud memory: a durable SQLite write-behind queue, semantic search + profile, a context overlay, a dialectic/agent self-model prefetch, and a shared file store.
- **Key abstractions:** `RetainDBMemoryProvider`, `_Client`, `_WriteQueue`, `_build_overlay()`, `_AGENT_MODEL_FIELDS`, the `_SCHEMAS` / `_TOOLS` tables.
- **Data flow:** turn → `sync_turn()` → `enqueue()` → SQLite `pending` table → a writer thread → `ingest_session()`; the row is deleted on success, or `last_error` is recorded and it is retried after 2 s. On startup, up to 200 leftover rows are **replayed** (crash recovery).
- **Non-obvious decisions:** the prefetch is a **three-job background fan-out** (context / dialectic / agent self-model) fired at turn end and *consumed* by the next turn's `prefetch()`; a failed fetch leaves the previous cache value untouched (`fetch` returning `None` does not overwrite). The reasoning level for the "ask the user" synthesis is **sized to the query** (`<120` chars → low, `<400` → medium, else high). The agent's identity is seeded from `SOUL.md` in the background.
- **Edge cases & failure handling:** the write queue survives crashes (SQLite `pending` table, replayed on startup); each thread owns and closes its own SQLite connection (sqlite3 connections must close on their owning thread); `shutdown()` joins the prefetch threads, drains the queue sentinel and closes straggler connections; the project id is resolved env → config → `hermes-<profile>` → `"default"` so a multiplexed secondary's memories never land in the default profile's project.
- **Surprising:** `_Client._with_fallback()` silently retries every memory route against the **legacy** URL shape on any error — a two-route compatibility shim that hides a permanently broken primary route behind a working legacy one.

#### `plugins/memory/byterover/README.md`, `retaindb/README.md`, `byterover/plugin.yaml`, `retaindb/plugin.yaml` (4 files)
- **Purpose:** Operator-facing setup docs and manifests for the two bundled memory providers.
- **What they pin:** the required env vars (`BRV_API_KEY` optional / `RETAINDB_API_KEY` required), the working directories (`$HERMES_HOME/byterover/`), the tool lists, and the fact that `requests` is a core dependency so no separate SDK install is needed.

#### `plugins/dashboard_auth/_shared.py` (15.5 KB)
- **Purpose:** The shared machinery for every bundled dashboard-auth provider: config/env resolution, skip/register bookkeeping, PKCE login start, token exchange, and JWT verification.
- **Key abstractions:** `SkipRegistration`, `register_provider()`, `pkce_login_start()`, `exchange_token()`, `verify_jwt()`, `make_jwks_client()`, `session_from_claims()`, `JwtOAuthProvider`, `NonInteractiveMixin`, `parse_leeway()`.
- **Data flow:** config/env → `settings()` → `provider_cls(**kwargs)` → `ctx.register_dashboard_auth_provider(provider)`; login → authorize URL + PKCE cookie → token endpoint → JWT verify → `Session`.
- **Non-obvious decisions:** (a) **`parse_leeway` fails closed**: an unparseable / negative / NaN / inf value falls back to `0.0`, so a typo can only ever *lose* tolerance, never widen the window. (b) The **error taxonomy is the product**: an unreachable JWKS is a `ProviderError` (503 — an outage), while a bearer that is not one of our JWTs (opaque peer key, foreign kid), an expired token, or a not-yet-valid token is an `InvalidCodeError` (→ `None` → try the next provider). Folding both into 503 broke peer-key bearers (#94558) and discarded rotated refresh tokens (#47815). (c) `validate_redirect_uri` fast-fails obvious breakage but allows any `http://` host so a dashboard behind a TLS-terminating proxy on a LAN IP is not rejected.
- **Edge cases & failure handling:** `exchange_token` does **not** follow redirects (the body carries an auth code); a 400 raises the caller-supplied `bad_request_exc` so the auth-code path and the refresh path keep distinct handling; a missing token or a non-bearer `token_type` is an error; `session_from_claims` requires `sub`; the diagnostic path decodes the token **without** verification only to report the unverified `iss`/`aud`.
- **Surprising:** the `JwtOAuthProvider.verify_session` contract returns `None` for expiry/invalidity (the middleware then tries refresh) but lets a `ProviderError` bubble (→ 503) — the difference between "log out" and "the identity provider is down" is the whole design.

#### `plugins/dashboard_auth/basic/__init__.py` (12 KB)
- **Purpose:** Username/password dashboard auth with **stateless HMAC-signed sessions** (no IDP, no database).
- **Key abstractions:** `BasicAuthProvider`, `hash_password()`, `_verify_password()`, `_sign()` / `_unsign()`.
- **Data flow:** credential form → `complete_password_login()` → scrypt verify → a signed access blob (12 h) + a signed refresh blob (30 d) → cookie.
- **Non-obvious decisions:** (a) **the login always hashes**, even for an unknown username — the real hash when the user matches, a module-level `_DUMMY_HASH` otherwise, and the username itself is compared with `compare_digest`, so neither the username nor its length leaks via timing. (b) The signed token is `base64url(json) || hmac-sha256` with **no separator** ("binary HMAC bytes can't be confused with a delimiter"). (c) Env password overrides a config `password_hash` (rotation without editing config), but a config `password_hash` beats a config plaintext.
- **Edge cases & failure handling:** a malformed hash string → `False` (never an exception); `secret` must be ≥ 16 bytes; with no configured secret a random per-process key is generated and the operator is told sessions will not survive a restart or span workers.
- **Surprising:** `revoke_session()` is a no-op — stateless tokens cannot be revoked, and the code says so rather than pretending.

#### `plugins/dashboard_auth/drain/__init__.py` (7.2 KB)
- **Purpose:** A non-interactive **shared-bearer-secret** provider for the gateway drain-control endpoint — the first consumer of the generic `supports_token` / `verify_token` capability.
- **Key abstractions:** `DrainSecretProvider`, `assess_secret_strength()`, `_shannon_bits()`.
- **Data flow:** inbound `Authorization` bearer → `hmac.compare_digest` → a `TokenPrincipal("drain-control", scopes=(scope,))` → the route is registered as token-authable.
- **Non-obvious decisions:** a **three-layer entropy gate** (length ≥ 43 chars, ≥ 16 distinct characters, ≥ 128 Shannon bits) evaluated **twice** — once at registration and again in the constructor, so a caller bypassing `register()` still cannot build a weak provider. The gate is *fail-closed*: a rejected secret leaves the drain endpoint **disabled**.
- **Edge cases & failure handling:** `verify_session()` returns `None` (never raises) so the provider stacks harmlessly in the cookie-verify loop; `refresh_session()` raises `NotImplementedError` because there is no interactive flow.
- **Surprising:** the minimum length (43) is exactly `secrets.token_urlsafe(32)`, so a correctly-provisioned secret clears the bar exactly — the gate is calibrated to the generator, not to a round number.

#### `plugins/dashboard_auth/nous/__init__.py` (8.3 KB)
- **Purpose:** Nous Portal OAuth (authorization-code + PKCE) for the dashboard.
- **Key abstractions:** `NousDashboardAuthProvider` (a `JwtOAuthProvider`).
- **Data flow:** `client_id` (shape `agent:{instance_id}`) → authorize URL + PKCE → token endpoint → RS256 access token verified against the Portal JWKS with `aud` = the **bare** client id → `Session`.
- **Non-obvious decisions:** the **rotating refresh token** must be persisted back to the cookie on every refresh, or the next refresh replays a rotated token and revokes the whole session — the docstring names this as a hard contract with the middleware. The RT goes in **both** the body and an `x-nous-refresh-token` header (Portal reconciles the two and keeps the value out of body access logs); header-only → 400.
- **Edge cases & failure handling:** `client_id` must match `agent:{instance_id}` or construction fails; a mismatched `agent_instance_id` claim is a `ProviderError`; a missing `oauth_contract_version` claim only warns ("should" not "must"), but a *different* version is rejected; the refresh token is optional (absent → access-token-only session).
- **Surprising:** `revoke_session()` is a no-op because the Portal exposes no revocation grant — logout is client-side cookie clearing and the RT expires within its TTL.

#### `plugins/dashboard_auth/self_hosted/__init__.py` (17.1 KB)
- **Purpose:** A generic self-hosted OIDC relying party (Authentik, Keycloak, Zitadel, Authelia, Auth0, Okta…) built on OIDC discovery.
- **Key abstractions:** `SelfHostedOIDCProvider`, `_require_https_or_loopback()`, `_origin()`, `_token_endpoint_auth()`.
- **Data flow:** `{issuer}/.well-known/openid-configuration` → cached 1 h → authorization endpoint + PKCE → token endpoint → **ID token** verified against the discovered `jwks_uri` with `iss`/`aud` pinned → `Session`.
- **Non-obvious decisions:** (a) **the resolved-origin pin**: the discovery document only counts as the IDP's when the URL that *actually served it* shares the configured issuer's origin — the `issuer` field *inside* the body is attacker-controlled content and cannot prove where the document came from, so a single cleartext or attacker-hosted redirect hop could otherwise serve a forged document with an attacker's `jwks_uri`. (b) `HS256` is **deliberately excluded** (algorithm confusion). (c) Discovery follows redirects; the token/revocation POSTs **do not**. (d) The verified ID token is stored as `Session.access_token` so the per-request `verify_session` re-verifies a real JWT, while the opaque OAuth access token is discarded.
- **Edge cases & failure handling:** the issuer must be https (or http on loopback); discovery is resolved lazily so a boot-time IDP outage fails per-request instead of preventing registration; a trailing-slash issuer difference is tolerated; a missing `token_endpoint_auth_methods_supported` falls back to the OIDC default (basic); the `client_secret` is form-url-encoded *before* base64 (a secret containing `:` would otherwise corrupt the header).
- **Surprising:** the org/tenant field is non-standard, so it accepts several spellings and otherwise joins the `groups` claim — "surface *something*" rather than nothing.

#### `plugins/dashboard_auth/*/plugin.yaml` (4 files)
- **Purpose:** manifests for the four auth providers.
- **What they pin:** each provider's activation condition (`requires_env`), its canonical config surface, and a description that doubles as operator documentation — e.g. the drain manifest states the fail-closed rule and the 256-bit bar in prose.

#### `plugins/disk-cleanup/__init__.py` (10.2 KB)
- **Purpose:** Auto-cleanup of ephemeral files created during sessions, driven by `pre_tool_call` / `post_tool_call` / `on_session_end` hooks — "the agent never needs to remember to call a tool".
- **Key abstractions:** `_on_pre_tool_call()`, `_on_post_tool_call()`, `_on_session_end()`, `_handle_slash()`, `_PATH_EXTRACTORS`.
- **Data flow:** pre-hook snapshots the argument paths that **did not exist** (keyed by owner + `tool_call_id`); post-hook tracks only the paths that the *same* call's snapshot saw absent and that now exist; session-end runs the safe cleanup when any `test` file was tracked.
- **Non-obvious decisions:** (a) the snapshot is the **proof of creation** — a path seen only in terminal *output* (an `ls` listing) or absent from the snapshot carries no such proof and is never tracked. (b) `tool_call_id` alone is not unique (llama.cpp reuses one constant id), so the key is `(owner, tool_call_id)`. (c) the pre-hook **fails closed**: an error records no absent path (a raise would block the tool). (d) a 1-hour TTL sweeps snapshot entries whose post hook never fired.
- **Edge cases & failure handling:** `on_session_end` drains both the session bucket and every task-scoped bucket (subagents record into their own); the quick-cleanup failure is logged at debug and swallowed; `shlex.split(posix=os.name == "posix")` keeps Windows backslash paths intact.
- **Surprising:** the plugin tracks only files it can prove were *created* — an existing file the call edits, runs or lists is never tracked, which is the difference between a cleanup tool and a data-loss tool.

#### `plugins/disk-cleanup/disk_cleanup.py` (18.5 KB)
- **Purpose:** The cleanup library behind the plugin: the categories, thresholds, protected trees, and the audit log.
- **Key abstractions:** `is_safe_path()`, `track()`, `forget()`, `dry_run()`, `quick()`, `status()`, `guess_category()`, `load_tracked()` / `save_tracked()`, `_sweep_empty_dirs()`.
- **Data flow:** `tracked.json` (a list of `{path, timestamp, category, size}`) → age/category rules → delete (auto) or list for confirmation (prompt) → append to `cleanup.log`.
- **Non-obvious decisions:** (a) **two-tier deletion**: auto (`test` at session end, `temp` > 7 d, `cron-output` > 14 d, empty dirs) vs prompt (`research` > 30 d beyond the 10 newest, `chrome-profile` > 14 d, any file > 500 MB). (b) **re-validation at deletion time**: stored categories are re-checked against `guess_category()`, so a stale `tracked.json` entry misfiled as `cron-output` or `test` is dropped rather than deleted. (c) The **cron control plane is protected by exact path** (`cron/`, `cron/output/` root, `jobs.json`, `.tick.lock`) — "never widen to everything under `cron/output/`", because run artifacts there are disposable but wholesale deletion of `output/` is fatal. (d) The **Git-ownership probe**: a `test_*` file inside a Git-owned tree is usually a committed regression test, not scratch, so `guess_category` returns `None` for it. The check asks git *per candidate* (`ls-files --error-unmatch -- ':(literal)<name>'`) instead of caching an index, so a file committed after first classification is seen immediately. (e) the empty-dir sweep is **iterative post-order** and prunes `.git`/`node_modules`/`venv`/… because "a full rglob over a checkout+venv under HERMES_HOME can stall the gateway loop for minutes".
- **Edge cases & failure handling:** atomic writes (`.tmp` → backup → rename) with a `.bak` restore on corruption; `is_safe_path` resolves the path and rejects Windows mounts (`/mnt/c`); the `/tmp` alias is detected by resolving the POSIX root (macOS `/tmp` → `/private/tmp`); a tracked *directory* under a protected top level is never `rmtree`'d — only its files age out.
- **Surprising:** `_protected_cron_paths` is `functools.lru_cache`'d "keyed by home" because a multiplexed process serves several profiles.

#### `plugins/disk-cleanup/README.md`, `plugin.yaml` (2 files)
- **Purpose:** The rule table (category → threshold → confirmation) and the safety list.
- **What they pin:** the protected top-level trees (including `workspace/`, `projects/`, `plans/`, `home/`, `patches/`, `kanban/`) that are never swept even for `test_*` files, and the manifest's `provides_hooks:` list.

#### `plugins/google_meet/__init__.py` (2.8 KB)
- **Purpose:** The google_meet plugin entry point: five tools, the `hermes meet` CLI, and an `on_session_end` hook.
- **Key abstractions:** `_TOOLS` (name, schema, handler, emoji), `_on_session_end()`.
- **Data flow:** `register(ctx)` → `ctx.register_tool(..., check_fn=check_meet_requirements, emoji=...)`; session end → stop a still-running call.
- **Non-obvious decisions:** the plugin **no-ops on Windows** ("no tested audio-routing path and flaky guest-join Chromium — refuse rather than half-work"); the tool descriptions carry the agent-facing policy (announce yourself; there is no automatic consent announcement; poll rather than re-read the transcript).
- **Edge cases & failure handling:** the session-end cleanup never raises (`# pragma: no cover`).

#### `plugins/google_meet/SKILL.md` (6.9 KB)
- **Purpose:** The agent-facing usage guide (front-matter: name, description, version, platforms, tags).
- **What it decides:** the two modes (`transcribe` default vs `realtime`, which "costs real money"), the two locations (local vs remote node), the six-step flow (join → announce → poll → speak → leave → follow up), the limits (caption quality, lobby timeout, one meeting per location, no Windows, best-effort barge-in), and the `meet_status()` key reference including `leaveReason` values (`duration_expired`, `lobby_timeout`, `denied`, `page_closed`).
- **Non-obvious decision:** the skill *tells the agent what not to do* — "Don't re-read the whole transcript every turn", "don't queue hundreds of lines", "you should announce yourself" — i.e. the prompt is written to bound the agent's polling and spend.

#### `plugins/google_meet/README.md` (7.2 KB)
- **Purpose:** The versioned architecture document (v1 transcribe / v2 realtime / v3 remote node) with the ASCII diagram and the file table.
- **What it decides:** the safety list (URL gate, no calendar scanning, no auto-dial, bearer-token node auth, one active meeting per gateway+node pair, `meet_say` refused unless realtime) and an explicit "Out of scope" section (calendar scanning, multi-tenant node sharing, Windows, macOS input switching, meeting-audio ingestion).

#### `plugins/google_meet/process_manager.py` (8.2 KB)
- **Purpose:** The local bot subprocess lifecycle manager — one active meeting at a time, recorded in `$HERMES_HOME/workspace/meetings/.active.json`.
- **Key abstractions:** `start()`, `status()`, `transcript()`, `enqueue_say()`, `stop()`.
- **Data flow:** `start()` → validate URL → stop any running bot → wipe stale `transcript.txt`/`status.json` → `subprocess.Popen([sys.executable, "-m", "plugins.google_meet.meet_bot"], start_new_session=True)` with a `HERMES_MEET_*` env → the record `{pid, meeting_id, out_dir, url, started_at, session_id, log_path, mode}` → the bot writes `status.json` + `transcript.txt` and the **filesystem is the only IPC**.
- **Non-obvious decisions:** the bot is **detached** (`start_new_session=True`, stdout/stderr → `bot.log`, `stdin=DEVNULL`) so the agent loop can never block on it; the realtime API key is resolved **in the parent at spawn time** because the detached child inherits env, not the profile secret scope (a contextvar).
- **Edge cases & failure handling:** `_pid_alive` uses `gateway.status._pid_exists` rather than `os.kill(pid, 0)` — "on Windows that can kill the target (bpo-14484)"; `stop()` sends SIGTERM, waits up to 10 s in 0.5 s steps, then SIGKILL, and always clears the active pointer; `status()` merges the bot's own `status.json` over the record; a malformed `status.json` is ignored.
- **Surprising:** the stale-file wipe on `start()` is keyed by the *meeting id*, so re-joining the same meeting code starts from a clean transcript.

#### `plugins/google_meet/tools.py` (8.0 KB)
- **Purpose:** The agent-facing tool schemas and handlers, with a uniform local/remote dispatch.
- **Key abstractions:** `MEET_*_SCHEMA` constants, `handle_meet_*`, `_dispatch()`, `resolve_node()`, `check_meet_requirements()`.
- **Data flow:** tool args → validate (`mode` ∈ {transcribe, realtime}; `last` ≥ 1) → remote `NodeClient` call or a local `process_manager` call → a JSON string result `{"success": bool, ...}`.
- **Non-obvious decisions:** every schema sets `additionalProperties: False` and the descriptions carry the *policy* ("no calendar scanning, no auto-dial", "the speech lags by a couple of seconds", "Requires … mode='realtime'"). `check_fn=check_meet_requirements` is the local gate; the handlers relax it when a remote node is addressed (a node only needs `websockets`).
- **Edge cases & failure handling:** a failed remote resolution returns a *specific* error naming the fix (`hermes meet node approve <name> <url> <token>`); a remote exception is wrapped, not raised.
- **Surprising:** `_dispatch` returns `success` derived from `ok`, so the agent sees one consistent envelope shape whether the work ran locally or remotely.

#### `plugins/google_meet/meet_bot.py` (24.8 KB)
- **Purpose:** The standalone Playwright bot subprocess: join, enable captions, scrape them, optionally speak.
- **Key abstractions:** `_BotState` (flushed to `status.json` on every change), `_CAPTION_OBSERVER_JS`, `_ENABLE_CAPTIONS_JS`, `_ADMISSION_PROBE_JS`, `_DENIED_PROBE_JS`, `_drain_loop()`, `_ensure_mic_on()`, `_start_realtime_speaker()`, `_pcm_tail_loop()`.
- **Data flow:** env config → Chromium → `page.evaluate` of the observer → `window.__hermesMeetDrain()` → `state.record_caption()` → append `[ts] speaker: text` to `transcript.txt` and flush `status.json`.
- **Non-obvious decisions:** (a) **no WebRTC audio parsing** — captions are watched with a `MutationObserver` on the ARIA-labelled region: "lossy and English-biased, but deterministic (no STT billing) and stable thanks to the ARIA role". The observer is installed with a 1.5 s retry because the region only appears after captions are enabled *and* someone speaks. (b) Captions are **deduplicated** by `(speaker, text)` so the same line is not appended twice. (c) The caption toggle is a **keyboard event** (`key: 'c'`), not a click, because "click targeting is too brittle". (d) `_join` **polls** for up to 30 s because Meet renders the pre-join buttons asynchronously — "a single miss leaves the bot silently in the lobby". (e) `_ensure_mic_on` un-mutes the bot after admission (Meet may seat a bot muted) and reports `unmuted` / `unmuted_clicked` / `unknown` so the outcome is *visible*.
- **Edge cases & failure handling:** every exit path sets `leave_reason` (`duration_expired`, `lobby_timeout`, `denied`, `page_closed`); a closed page ends the loop rather than spinning; SIGTERM sets a **flag** (not an exception) so the Playwright teardown still runs and the transcript is finalised; realtime failures **fall back to transcribe mode** and set `error`; a missing `ffmpeg`/`paplay` sets a precise error and skips the pump.
- **Surprising:** the barge-in heuristic (`_looks_like_human_speaker`) treats a caption attributed to our own guest name, `unknown`, or `you` as our own echo and does **not** cancel the response — and the SKILL.md admits barge-in is best-effort because captions lag ~500 ms.

#### `plugins/google_meet/cli.py` (12.3 KB)
- **Purpose:** The `hermes meet` argparse tree (`setup / install / auth / join / status / transcript / say / stop / node`).
- **Key abstractions:** `register_cli()`, `_DISPATCH`, `_cmd_*`.
- **Data flow:** argv → dispatch table → `process_manager` or `NodeClient` → printed JSON.
- **Non-obvious decisions:** `install` **prompts before** `sudo apt-get` / `brew install` unless `--yes`; `_cmd_setup` is a real preflight (platform, playwright spec, Chromium executable on disk, saved auth state) that exits non-zero until everything is ready; the auth flow opens a **headed** Chromium and saves `storage_state`.
- **Edge cases & failure handling:** every command returns an exit code; `_cmd_join` refuses a non-Meet URL with exit code 2; `_cmd_say` refuses empty text.
- **Surprising:** the macOS path prints an explicit "hermes will not switch your default input for you" note — the tool refuses a surprising side effect on the user's machine.

#### `plugins/google_meet/_jsonfile.py` (1.1 KB)
- **Purpose:** Tiny JSON/JSONL file helpers shared by the bot, the process manager, the node registry and the node server.
- **Key abstractions:** `read_json()`, `say_queue_lock()`.
- **Data flow:** file → parsed JSON (or `None`); a cross-process file lock around `say_queue.jsonl` edits.
- **Non-obvious decision:** the lock exists because "the bot's speaker re-reads and rewrites the queue to drop what it spoke; an agent-side append landing in between would be wiped by the rewrite" — a classic read-modify-write race, closed with a lock file and a 10 s timeout.

#### `plugins/google_meet/audio_bridge.py` (5.3 KB)
- **Purpose:** A virtual audio device so generated speech can enter Chrome's fake microphone.
- **Key abstractions:** `AudioBridge` (`setup()`, `teardown()`, `device_name`, `write_target`).
- **Data flow:** Linux: `pactl load-module module-null-sink` + `module-virtual-source` on the sink's monitor → Chrome is given `PULSE_SOURCE`; macOS: verify BlackHole 2ch is installed.
- **Non-obvious decisions:** macOS **only verifies** the device is present — the default-input switch is left to the user, because "switching default input on a whim would be a surprising side effect". `teardown()` unloads the modules in reverse order (virtual source before null sink) and never raises.
- **Edge cases & failure handling:** a failed virtual-source load **rolls back** the null sink it just created so it does not leak; `pactl` not found → a clear install hint; the module id is parsed from the last token of the first output line.

#### `plugins/google_meet/realtime/openai_client.py` (9.3 KB)
- **Purpose:** A minimal OpenAI Realtime WebSocket client plus a file-queue speaker.
- **Key abstractions:** `RealtimeSession` (`connect`, `speak`, `cancel_response`), `RealtimeSpeaker` (`run_until_stopped`).
- **Data flow:** text → `conversation.item.create` + `response.create` → `response.audio.delta` frames → base64-decoded PCM appended to `speaker.pcm` (opened `'ab'` per call so a streaming reader can consume it) → the pump streams it into the virtual mic.
- **Non-obvious decisions:** (a) the session is **write-locked** because `speak` and `cancel_response` (barge-in) may run on different threads. (b) the sink is opened in append mode per call so a *streaming* reader (the PCM tail loop) sees the growing file. (c) `run_until_stopped` processes **one entry per iteration** and re-reads the queue under the lock before dropping the head, so an agent-side append cannot be lost. (d) the `websockets` API changed (`additional_headers=` vs `extra_headers=`), and the code tries the new spelling and falls back on `TypeError`.
- **Edge cases & failure handling:** a deadline-based receive raises `TimeoutError` past the timeout; an `error` frame raises with the provider's message; the speaker records each result to `say_processed.jsonl` and keeps the queue file (empty when drained) because consumers may watch its mtime.
- **Surprising:** `audio_bytes_out` / `last_audio_out_at` are **public counters on the session**, read by the bot and mirrored into `status.json` — the progress signal is the number of bytes actually written, not a synthetic percentage.

#### `plugins/google_meet/realtime/__init__.py` (0.2 KB)
- **Purpose:** Re-exports `RealtimeSession` and `RealtimeSpeaker`; one line of docstring.

#### `plugins/google_meet/node/protocol.py` (3.6 KB)
- **Purpose:** The gateway ↔ node RPC wire protocol (JSON envelopes).
- **Key abstractions:** `VALID_REQUEST_TYPES`, `make_request/make_response/make_error`, `encode/decode`, `validate_request`.
- **Data flow:** `{type, id, token, payload}` → server-side validation → `{type: "response"|"error", id, payload|error}`.
- **Non-obvious decisions:** the request **type is a closed set** (`start_bot`, `stop`, `status`, `transcript`, `say`, `ping`) and `make_request` refuses anything else; replies are correlated by **`id`**, not by type; `validate_request` is an ordered list of lazily-evaluated checks so the first failing check wins and the reason is safe to send back to the client.
- **Edge cases & failure handling:** `decode` raises `ValueError` for malformed JSON, a non-object envelope or a missing string `type`/`id`.

#### `plugins/google_meet/node/registry.py` (2.5 KB)
- **Purpose:** A file-backed registry of approved remote nodes (`$HERMES_HOME/workspace/meetings/nodes.json`).
- **Key abstractions:** `NodeRegistry` (`get`, `add`, `remove`, `list_all`, `resolve`).
- **Data flow:** name → `{url, token, added_at}` → atomic JSON write.
- **Non-obvious decision:** `resolve(None)` returns the sole registered node, and **returns `None` when zero *or several* nodes exist** — ambiguity is a refusal, not a guess.
- **Edge cases & failure handling:** a malformed file is treated as empty; `add` validates that name/url/token are non-empty strings.

#### `plugins/google_meet/node/client.py` (2.9 KB)
- **Purpose:** The gateway-side RPC client — **one short-lived synchronous WebSocket per call**, so non-async tool handlers need no persistent connection.
- **Key abstractions:** `NodeClient` (`start_bot`, `stop`, `status`, `transcript`, `say`, `ping`).
- **Data flow:** request envelope → WS connect → send → receive → decode → payload dict.
- **Non-obvious decisions:** the client validates the response **`id` matches the request id** and that the payload is a dict; a missing `websockets` package becomes a `RuntimeError` with an install hint.
- **Edge cases & failure handling:** an `error` envelope raises `RuntimeError("node error: …")`; 10 s open/close/receive timeouts.

#### `plugins/google_meet/node/server.py` (5.7 KB)
- **Purpose:** The node host's WebSocket server, dispatching validated RPCs to the local `process_manager`.
- **Key abstractions:** `NodeServer` (`ensure_token`, `_handle_request`, `serve`), the `_RPC` table, `_RpcError`.
- **Data flow:** WS frame → decode → `validate_request` (token compare) → dispatch → response envelope.
- **Non-obvious decisions:** (a) the token is **32 hex chars minted on first boot and persisted** with mode `0o600`, so approved gateways survive restarts. (b) `_rpc_start_bot` **whitelists** the kwargs it forwards to `pm.start` (`_START_BOT_KEYS`) — the RPC payload cannot inject arbitrary process-manager arguments. (c) `_handle_request` **never raises**: handler exceptions become error envelopes, and `pm`'s own `ok`/`error` travels inside a normal response payload.
- **Edge cases & failure handling:** a decode failure returns an error envelope with an empty id; `serve()` raises a `RuntimeError` with an install hint if `websockets` is absent.

#### `plugins/google_meet/node/cli.py` (3.8 KB)
- **Purpose:** The `hermes meet node {run,list,approve,remove,status,ping}` subcommand tree.
- **Key abstractions:** `register_cli()`, `_COMMANDS`, `node_command()`.
- **Data flow:** argv → command table → `NodeRegistry` / `NodeClient` / `NodeServer`.
- **Non-obvious decision:** `list` prints only the **first 6 characters** of each token — a deliberate redaction of a credential in a listing a user might paste into a ticket.
- **Edge cases & failure handling:** `run` never touches the registry; `ping` returns a JSON error blob on failure.

#### `plugins/google_meet/node/__init__.py` (1.1 KB)
- **Purpose:** Package docstring + re-exports of the node surface (`NodeClient`, `NodeRegistry`, `NodeServer`, the protocol helpers).
- **What it decides:** the topology in one sentence — "gateway (Linux) ── ws://mac.local:18789 ──▶ node server (Mac) → process_manager → meet_bot" — and the reason: "Google sign-in + Chrome profile live on the user's laptop; running the bot there reuses that profile without shipping credentials."
### Tier 1 — load-bearing source (continued)

#### `plugins/hermes-achievements/dashboard/plugin_api.py` (55 KB) — **read in two parts (head 29 KB + tail 28 KB)**
- **Purpose:** The dashboard backend that scans the local Hermes session history into per-session stats, evaluates a 60+ badge catalog, and serves the result under `/api/plugins/hermes-achievements/`.
- **Key abstractions:** `ACHIEVEMENTS` (the catalog, built by `_ach()`), `analyze_messages()`, `aggregate_stats()`, `evaluate_tiered()`, `evaluate_requirements()`, `scan_sessions()`, `evaluate_all()`, `_compute_from_scan()`, the routes `/achievements`, `/scan-status`, `/recent-unlocks`, `/sessions/{id}/badges`, `/rescan`, `/reset-state`.
- **Data flow:** `SessionDB(read_only=True)` → per-session stats → an aggregate → each badge definition evaluated against the aggregate → a snapshot published to `_SNAPSHOT_CACHE` → JSON to the dashboard.
- **Non-obvious decisions:** (a) **checkpointed incremental scanning** — the checkpoint stores per-session stats keyed by a `(started_at, last_active, model, title)` fingerprint, so a warm scan only re-analyzes changed sessions. (b) **Sticky unlocks:** `state.json` is a *floor* — a badge earned on evidence that compaction later removed must not flicker back to locked. (c) **Partial snapshots are published during a background scan** but `_SNAPSHOT_CACHE_AT` stays 0 so they remain in the "stale" regime and the UI keeps polling `/scan-status` rather than mistaking an in-flight result for a finished one. (d) The scan reads **compaction-archived** rows (`include_compacted=True`) so lifetime totals are monotonic; the schema-1 (active-only) checkpoint is rescanned once.
- **Edge cases & failure handling:** the DB is opened **read-only** ("a writable open here was a second writer connection … counted toward the 'live SessionDB handles' precursor"); a progress callback that raises is advisory and never aborts the scan; `_compute_from_scan(is_partial=True)` skips persisting unlocks but still *reads* persisted ones so an earned badge renders as unlocked during a rescan; the scan is unbounded by default (a former cap of 200 "silently shrank lifetime totals").
- **Surprising:** the whole thing is a **metrics engine over a session log** — 40+ regex counters, a tiered ladder (Copper→Silver→Gold→Diamond→Olympian) and a multi-condition evaluator. It is the closest thing in this repo to a "reflection loop that turns behaviour into progress" and it deliberately treats the persisted state as monotonic.

#### `plugins/hermes-achievements/README.md` (docs, 4.9 KB)
- **Purpose:** The plugin's user-facing document.
- **What it decides:** three visible states (Unlocked / Discovered / Secret), the tier ladder, the vendoring story (upstream repo stays the staging ground), the API route list, and the **update notice** that a scan-performance refactor landed on 2026-04-29 (snapshot cache + incremental checkpoint) — an explicit "your install changed, update" warning.

#### `plugins/hermes-achievements/dashboard/manifest.json` (config, 344 B)
- **Purpose:** The dashboard-tab manifest.
- **What it pins:** the tab path and position (`after:analytics`), the `dist/index.js` entry, the `style.css`, and the `api: plugin_api.py` module.

#### `plugins/hermes-achievements/tests/test_achievement_engine.py` (tests, 10.6 KB)
- **Purpose:** The engine's unit tests.
- **What it pins:** tool-call counting and the `port_conflict` detector; tier selection reaching the *highest* matching tier; a "discovered but not unlocked" state; **the sticky-unlock floor** (a rescan whose metric shrinks keeps the persisted unlock, including on partial snapshots); a secret badge staying hidden with zero progress; multi-condition unlocks requiring *all* requirements; the catalog having 60+ unique ids; model/provider aggregation; the **absence of three removed noisy achievements** (`fallback_pilot`, `browser_sleuth`, `release_ritualist`); the local-model metric counting only session metadata; `config_events` ignoring generic config words; and a CSS assertion that the card hover rule does not move the click target.

#### `plugins/hermes-achievements/LICENSE` (docs, 1.1 KB) — MIT text, "Hermes Achievements contributors".
#### `plugins/kanban/dashboard/plugin_api.py` (87 KB) — **read in three parts (head 24 KB, lines 505–900, tail 12 KB) + full route map**
- **Purpose:** The Kanban board's HTTP API — a multi-agent task board with columns, dependencies, runs, comments, attachments, diagnostics, profiles, boards and a live event stream.
- **Key abstractions:** `get_board()`, `create_task()`, `update_task()`, `bulk_update()`, `_apply_status()` / `_STATUS_HANDLERS`, `_set_status_direct()`, `list_diagnostics()`, `stream_events()` (WebSocket), `_EventTail`, `get_orchestration_settings()` / `set_orchestration_settings()`, `decompose_task_endpoint()`.
- **Data flow:** every handler is a **thin wrapper around `hermes_cli.kanban_db`** (the same code paths the CLI and the gateway command use, "so the surfaces cannot drift"); SQLite tables `tasks`, `task_runs`, `task_events`, `task_comments`, `task_links`, `attachments`.
- **Non-obvious decisions:** (a) **the status verb dispatch** — `done` / `blocked` / `scheduled` / `review` / `ready` / `todo` / `triage` are *verbs* with preconditions, not raw column writes; `review` and `done` pass `force=True` because "a dashboard action is a human override of a live worker claim". (b) `running` is **rejected from the dashboard** ("use the dispatcher/claim path"). (c) leaving `review` goes through `reopen_review_task()` (stale-run recovery + parent re-gate), not a raw write. (d) The 409 for a refused transition **names the blocking parents** so the UI can render an actionable toast instead of a silent no-op. (e) `_with_board_pinned` pins the board **context-locally**, never via the process-global `HERMES_KANBAN_BOARD` env var, because concurrent requests for different boards would cross-write. (f) The event stream tails `task_events` on a 300 ms poll and **captures the tail at accept, before the first wait** — a missing cursor must not mean 0, or every board open becomes a refetch storm. (g) an **archived board is 404, not a resurrection** (#43243).
- **Edge cases & failure handling:** the board is pinned at the WS handshake; an archived/deleted board closes the stream with `WS_1008_POLICY_VIOLATION`; the poll races `ws.receive()` against the interval so an idle board does not leak poll tasks; the attachment download re-checks that the stored path is still under the board's attachments root (defence in depth against a tampered DB row); uploads stream in 1 MB chunks with a hard size cap and delete the partial file on overflow; a "not found" mid-request maps to 404 via `_require_ok()`.
- **Surprising:** the **decompose** endpoint fans a triage task out into child tasks through an *auxiliary LLM* call, and a non-OK outcome is **not** an HTTP error — the UI renders the reason inline. The same "non-OK is not an HTTP error" convention appears on `describe-auto`.

#### `plugins/kanban/dashboard/manifest.json` (config, 382 B) — the Kanban tab (`/kanban`, position `after:skills`).
#### `plugins/kanban/systemd/hermes-kanban-dispatcher.service` (build-CI, 1.3 KB)
- **Purpose:** A **deprecated** standalone dispatcher unit.
- **What it pins:** the migration note ("the kanban dispatcher now runs inside the gateway by default"), the `--force` flag so nobody accidentally keeps two dispatchers racing against the same `kanban.db`, and the explicit warning that running this unit *and* a gateway with `dispatch_in_gateway=true` is NOT supported.

#### `plugins/security-guidance/__init__.py` (6.1 KB)
- **Purpose:** Pattern-matched security warnings appended to file-write tool results.
- **Key abstractions:** `_TARGET_TOOLS` (tool → path arg + content args), `_compile_rules()`, `_rule_matches()`, `_scan_content()`, `_scan_args()`, `_format_warning_block()`, `_on_pre_tool_call()` (block mode), `_on_transform_tool_result()` (warn mode).
- **Data flow:** `write_file` / `patch` / `skill_manage` args → the path + every populated content field → the compiled rule set → findings → a Markdown block appended to the tool result (or a block refusal).
- **Non-obvious decisions:** **warn by default, not block**, "because patterns have a real false-positive rate (`eval(` in a tokenizer, ECB in a test fixture)". The block mode exists (`SECURITY_GUIDANCE_BLOCK=1`) and the kill switch exists (`SECURITY_GUIDANCE_DISABLE=1`). The file is **still written** in warn mode so "the model self-corrects next turn" — a *post-hoc* correction loop rather than a veto.
- **Edge cases & failure handling:** a **raising path predicate is a non-match** (a broken rule cannot block a write); content over 256 KB is skipped ("matching a multi-MB blob has poor signal and slows the agent loop"); error results are not decorated ("the model already has bigger problems"); an invalid regex is skipped at compile time with a warning.
- **Surprising:** `patch` is scanned with **both** `new_string` and the raw `patch` text, and `skill_manage`'s `file_path` is the path *inside the skill directory* — the rule set is per-tool, not per-argument-name.

#### `plugins/security-guidance/patterns.py` (14 KB)
- **Purpose:** 25 pure-data security rules (regex + literal substrings) with per-extension path filters.
- **Key abstractions:** `SECURITY_PATTERNS` (list of rule dicts), `_rule()`, the `_JS_ONLY` / `_PY_ONLY` / `_NOT_DOCS` path filters, the per-rule reminder texts.
- **Data flow:** a rule dict → `__init__.py::_compile_rules()` → compiled regexes + substring tuples → matched per write.
- **Non-obvious decisions:** the **path filters are the noise control** — Python-only rules skip `.js`, JS rules skip `.py`, and the `eval` rule skips docs entirely. The regexes use **negative lookbehind** `(?<![a-zA-Z0-9_\.])` so `model.eval()` and `redis.eval()` do not trip the `eval(` rule. `torch_unsafe_load` is suppressed by `weights_only=True` on the same line (200 chars) — the comment names the multi-line false positive as a known limitation.
- **Edge cases & failure handling:** the `yaml.load` rule explicitly excludes `Safe` loaders within 80 chars; `pickle` matches only *deserialization* (`load`/`loads`/`Unpickler`) and `pkl_load` needs a word boundary; `numpy.load` only matches with an explicit `allow_pickle=True`.
- **Surprising:** the module is a **verbatim Apache-2.0 fork** of Anthropic's `claude-plugins-official` pattern set (commit `0bde168`); only the upstream RuleId telemetry table was dropped, because "Hermes has no consumer".

#### `plugins/security-guidance/README.md` (docs, 4.6 KB) — the 25-rule coverage table, the three modes, and an explicit "**What it does not do (yet)**" list (no LLM diff review, no agentic commit review, no project-local rules file) plus a limitations section ("treat warnings as suggestions, not a substitute for code review").
#### `plugins/security-guidance/LICENSE` (docs, 11.6 KB) — Apache License 2.0 (head read; the rest is the standard licence body).
#### `plugins/security-guidance/NOTICE` (config, 1.3 KB) — the attribution notice: which file is forked from where, at which commit, under which licence, and that the glue code is original MIT work.
#### `plugins/security-guidance/plugin.yaml` (config, 635 B) — the manifest naming the two hooks it provides (`transform_tool_result`, `pre_tool_call`).

#### `plugins/teams_pipeline/pipeline.py` (30 KB)
- **Purpose:** The transcript-first Teams meeting summary pipeline with a durable job lifecycle.
- **Key abstractions:** `TeamsMeetingPipeline` (`create_job_from_notification`, `run_job`, `_resolve_meeting`, `_obtain_transcript`, `_transcribe_recording`, `_generate_summary_payload`, `_write_sinks`), `TeamsPipelineConfig`, the error taxonomy (`TeamsPipelineError` → `TeamsPipelineRetryableError` → `TeamsPipelineArtifactNotFoundError` / `TeamsPipelineSinkError`), `NotionWriter`, `LinearWriter`, `_heuristic_summary()`.
- **Data flow:** a Graph change notification → a job row (`received`) → `resolving_meeting` → `fetching_transcript` (or `downloading_recording` → `transcribing_audio`) → `summarizing` → `writing_notion` → `writing_linear` → `sending_teams` → `completed`; a retryable failure lands on `retry_scheduled`, anything else on `failed`.
- **Non-obvious decisions:** (a) **transcript first, recording+STT as a fallback**, and the fallback is *gated* by `transcript_min_chars` (80) — a technically-present but sparse transcript is treated as absent. (b) **the LLM summary has a heuristic fallback** (`_heuristic_summary`) that greps the transcript for "decide/decision", "action:/todo:/next step:" and "risk/blocker" and sets `confidence: low` — the pipeline never hard-fails on the model. (c) the summary prompt truncates the transcript at 18 000 chars. (d) **the sink order is part of the contract** (Notion → Linear → Teams) and each sink's result is recorded in a `sink_records` row keyed `name:meeting_id`, so a re-run updates rather than duplicates. (e) the recording's `display_name` is **organizer-controlled Graph data**: only the basename is kept and `.`/`..` are rejected, "so a crafted `../../etc/cron.d/evil` cannot escape tmp_dir".
- **Edge cases & failure handling:** the retryable/failed split is persisted as `error_info` on the job, so a failure is *inspectable*; ffmpeg missing → retryable; an empty STT result → retryable; a missing `meeting_ref` → a hard error.
- **Surprising:** the *heuristic* summary is a deliberate product decision — the pipeline prefers a low-confidence answer over no answer, and says so in `confidence_notes`.

#### `plugins/teams_pipeline/store.py` (5.1 KB)
- **Purpose:** A JSON-backed durable store with five buckets.
- **Key abstractions:** `TeamsPipelineStore` (`upsert_job`, `upsert_subscription`, `record_notification_receipt`, `get_sink_record`, `delete_subscription`, `stats`), `resolve_teams_pipeline_store_path()`, `build_notification_receipt_key()`.
- **Data flow:** bucket → key → record; every write is an **atomic temp-file replace** (`NamedTemporaryFile` → `tmp_path.replace(self.path)`).
- **Non-obvious decisions:** (a) **the receipt key is the idempotency primitive** — an explicit notification `id` if present, else `sha256` of the canonicalised JSON; `record_notification_receipt` returns `False` for a duplicate, which is how Graph's at-least-once delivery is de-duplicated. (b) the on-disk bucket list is **frozen** ("the on-disk JSON shape must stay stable for existing user stores"). (c) every read returns a `deepcopy` so a caller cannot mutate the store's state.
- **Edge cases & failure handling:** a corrupt or non-dict file loads as empty (no crash); `created_at` is set once and `updated_at` is stamped on every upsert.

#### `plugins/teams_pipeline/subscriptions.py` (6.0 KB)
- **Purpose:** Microsoft Graph subscription renewal.
- **Key abstractions:** `maintain_graph_subscriptions()`, `sync_graph_subscription_record()`, `is_managed_subscription()`, `expected_client_state()`, `utc_timestamp()`.
- **Data flow:** list remote subscriptions → filter to *managed* ones → sync locally → renew those within the threshold → mark locally-known-but-remote-missing ones `missing_remote`.
- **Non-obvious decisions:** (a) **"managed" means ours** — the store knows the id, or its `clientState` matches the configured one. (b) **a subscription Graph no longer reports is flagged, never deleted** ("flagged, never deleted"). (c) the renewal is a **convergent patch** (`expirationDateTime`), with a `dry_run` mode that computes the candidates without calling Graph. (d) the extension is computed as `max(now, expiration) + extend_hours`, so an already-expired subscription is renewed from *now*, not from the past.
- **Edge cases & failure handling:** a missing expiration → skipped; an already-expired subscription → marked `expired` locally, not renewed; a sync failure → skipped with the reason.

#### `plugins/teams_pipeline/runtime.py` (5.4 KB)
- **Purpose:** The gateway wiring for the pipeline.
- **Key abstractions:** `build_pipeline_runtime_config()`, `build_pipeline_runtime()`, `bind_gateway_runtime()`.
- **Data flow:** gateway config → `teams.extra.meeting_pipeline` → `TeamsMeetingPipeline`; the msgraph webhook adapter's `set_notification_scheduler()` receives the `_schedule` coroutine.
- **Non-obvious decisions:** (a) **the Teams delivery target is mirrored** from the Teams platform config so it is not configured twice — "pipeline keys win". (b) **Graph wants a prompt 202**: the notification is accepted and the job persisted *inside* the request, then the fetch/transcript/summary pipeline runs detached. (c) **the runtime failure path installs a drop-scheduler** so Graph notifications still ack cleanly and do not retry-storm. (d) a duplicate job id in one batch is claimed once (`scheduled` set) so the same still-`received` job is not run twice.
- **Edge cases & failure handling:** a `TeamsSummaryWriter` import failure disables Teams *outbound delivery* only, not the pipeline; the runtime error is stored on the gateway for the operator.

#### `plugins/teams_pipeline/models.py` (8.6 KB)
- **Purpose:** The normalized dataclasses.
- **Key abstractions:** `_Model` (shared snake/camel `from_dict` / None-dropping `to_dict`), `GraphSubscription`, `TeamsMeetingRef`, `MeetingArtifact`, `TeamsMeetingSummaryPayload`, `TeamsMeetingPipelineJob`, `_parse_datetime()`, `_serialize_datetime()`.
- **Data flow:** a Graph JSON payload → `from_dict` (alias lookup, converters, required-field check, datetime parsing) → a dataclass → `to_dict()` (datetimes → ISO-Z, nested models → dicts, empty lists/dicts dropped).
- **Non-obvious decisions:** (a) the **alias table** is per-field, so `expiration_datetime` reads `expirationDateTime` and `download_url` reads `@microsoft.graph.downloadUrl` — one place where the wire's spelling variants live. (b) **naive datetimes are assumed UTC**; aware ones keep their offset. (c) `TeamsMeetingSummaryPayload.from_dict` **requires** `meeting_ref` ("a missing key raises KeyError rather than building a half-empty payload"). (d) `MeetingArtifact.artifact_type` is validated against a closed set at construction.
- **Edge cases & failure handling:** an unknown field is ignored; a blank required field raises `ValueError` naming the field.

#### `plugins/teams_pipeline/meetings.py` (14 KB)
- **Purpose:** The Graph-backed meeting helpers.
- **Key abstractions:** `parse_graph_meeting_resource()`, `looks_like_transcript_id()`, `resolve_meeting_reference()`, `fetch_preferred_transcript_text()`, `download_recording_artifact()`, `enrich_meeting_with_call_record()`, `_transcript_sort_key()`.
- **Data flow:** a Graph resource path → ids (organizer / meeting / transcript / recording) → a `TeamsMeetingRef` → artifacts → text.
- **Non-obvious decisions:** (a) the Graph path regexes accept **both** the slash and the quoted-key spellings (`users/{id}/…` and `users('{id}')/…`). (b) **collection function names are sentinels** — `getalltranscripts` etc. are not meeting ids. (c) `looks_like_transcript_id` base64-decodes a Graph id because "getAllTranscripts `resourceData.id` blobs only carry their `-TranscriptV2` marker in the *decoded* payload". (d) the **transcript sort key** is `(completed, downloadable, most-recent)` — a transcript that is still processing loses to one that is ready. (e) **call records are optional-soft**: a 401/403 on `CallRecords.Read.All` returns `None` rather than failing the pipeline.
- **Edge cases & failure handling:** a transcript id is *refused* as a meeting id ("Graph v1.0 does not support that id format"); a Graph 401/403 maps to `TeamsMeetingPermissionError`, a 404 to `TeamsMeetingNotFoundError`; a join-URL lookup escapes the single quote in the OData filter.

#### `plugins/teams_pipeline/cli.py` (15.5 KB)
- **Purpose:** The `hermes teams-pipeline` operator CLI.
- **Key abstractions:** `_SUBCOMMANDS` (one table: name, aliases, help, options, handler — "order defines both the --help listing and the usage string"), `_ACTIONS` (alias → handler), `_REQUIRED_ARGS`.
- **Data flow:** argv → the command table → the store / the Graph client / the pipeline → printed JSON.
- **Non-obvious decisions:** (a) the command table is the **single source of truth** for names, aliases, help and validation. (b) `validate` is a **configuration snapshot** that reports issues *and* warnings separately (missing Graph creds = issue; Teams delivery disabled = warning). (c) `run` is aliased `replay` — replaying a stored job is a first-class operation. (d) `token-health` can force a refresh and reports the outcome without printing the token.
- **Edge cases & failure handling:** a missing required arg prints a specific message and exits 0 (not a traceback); a Graph-not-configured error prints a `.env` snippet and exits 1; `_compact_job` replaces the transcript with a 240-char preview so the CLI never dumps a whole meeting.

#### `plugins/teams_pipeline/__init__.py` (739 B) — registers **only** the operator CLI ("invoked by the agent via the terminal tool; no model tools").
#### `plugins/teams_pipeline/plugin.yaml` (config, 275 B) — `kind: standalone`, linux/macos/windows.

#### `plugins/platforms/a2a/protocol.py` (22.6 KB)
- **Purpose:** The A2A v1.0 protocol helpers — Agent Card, JSON-RPC framing, task store, conversation persistence.
- **Key abstractions:** `build_agent_card()`, `skills_from_toolsets()`, `text_message()`, `extract_text()`, `build_task()`, `status_update()`, `artifact_update()`, `sse_data()`, `TurnTracker`, `RateLimiter`, `Metrics`, `TaskStore`, `persist_message()`, `load_conversation()`, `message_context_id()`.
- **Data flow:** a JSON-RPC request → `decode`/`extract_context_id` → a `TaskStore` record → a per-task `Future` → a `SendMessageResponse` (task or message) or an SSE stream of `StreamResponse` objects.
- **Non-obvious decisions:** (a) **the context id is derived from the message id** when a first message carries none (`sha256(scope\0message_id)`) — "a retry of that send after a timeout reopens the same context instead of a fresh one". (b) `build_task` accepts `created_at` but **does not serialize it** ("the v1.0 Task proto has no createdAt and strict ProtoJSON parsers reject unknown fields"). (c) `extract_text` is **tolerant of three Part shapes** (v1.0 member-presence, v0.3 `kind`, pre-0.3 `type`). (d) the **SSE closure is a comment** (`: done`), because `data: {}` would make JSON-RPC clients parse an empty envelope. (e) the task store keeps **terminal tasks** (bounded to 500) so `tasks/get` still answers; `fail_orphans` is idempotent.
- **Edge cases & failure handling:** the store is **scoped** by `agent_slug`/`tenant` — a reader outside the scope gets not-found (the spec's authz rule); `complete()` is idempotent and resolves the watchers; the turn tracker prunes contexts idle over an hour; the rate limiter is a sliding window per identity.
- **Surprising:** the metrics bag is a **module singleton shared by the inbound adapter and the outbound client tools**, while the task store and the turn tracker are adapter-instance objects — a deliberate split stated in DESIGN.md.

#### `plugins/platforms/a2a/security.py` (10.2 KB)
- **Purpose:** The A2A security primitives.
- **Key abstractions:** `A2ASecurityContext` (immutable, captured at adapter startup), `filter_inbound()`, `wrap_inbound()`, `redact_outbound()`, `is_safe_callback_url()`, `audit()`, `_INJECTION_PATTERNS`, `PRIVACY_PREFIX`.
- **Data flow:** env → `A2ASecurityContext.capture()` → bind host / identity / trust decisions; inbound text → `filter_inbound` → `PRIVACY_PREFIX` framing; outbound text → `redact_for_egress` + an email scrub; every exchange → `a2a_audit.jsonl`.
- **Non-obvious decisions:** (a) **the context is captured once at startup** because "HTTP request threads don't inherit the gateway's profile ContextVars; resolving once keeps them off another profile's env". (b) **no token ⇒ localhost only** — "a token alone does not widen the bind; remote exposure requires token *and* explicit `A2A_HOST`". (c) **identity comes from the credential, never the body**; a shared token authenticates as `ip:<addr>`. (d) **injection is neutralised, not rejected** ("so a task that merely *mentions* these still gets through") — the markers become `[filtered]`. (e) **every inbound message is framed, including `/`-prefixed text** — "remote peers must never reach the gateway's operator slash commands". (f) `dispatch_fails_closed()`: a network-exposed token bind with no allow-list and no allow-all refuses *every* peer.
- **Edge cases & failure handling:** comparisons are constant-time; the audit write never raises; the callback URL check blocks link-local/AWS-metadata/RFC1918 even in localhost mode (only `127.`/`::1` are allowed there); `PRIVACY_PREFIX` names the peer and frames it as untrusted external input.

#### `plugins/platforms/a2a/adapter.py` (50 KB) — **read: module docstring + full def/class map (88 symbols)**
- **Purpose:** The inbound A2A server (stdlib `http.server` on a daemon thread).
- **Key abstractions:** `A2ARequestHandler` (module-level, reached through `server.adapter` so the RPC handlers are unit-testable without HTTP), `A2AAdapter` (`connect`, `disconnect`, `_prepare_task`, `_rpc_message_send`, `_rpc_message_stream`, `_rpc_tasks_*`, `_send_push_notification`, `send`, `on_processing_complete`), `_ThreadingHTTPServerV6`.
- **Data flow:** HTTP POST → `validate_request` → `_prepare_task` (framed text, task record, pending Future) → the **live gateway session** → `adapter.send()` fulfils the per-task Future → the HTTP handler unblocks → the response envelope.
- **Non-obvious decisions:** (a) **live-session injection** — inbound tasks route through the normal `MessageEvent` → `handle_message` path keyed by the A2A `contextId`, "so the agent that answers is the same one serving the user — full memory/context, not a clone". (b) the pending futures are **per-context FIFO**, so concurrent same-context requests cannot cross-talk. (c) a **watchdog fails orphaned tasks** after 5 minutes, with idempotent transitions so the metrics are not double-counted. (d) the Agent Card is **dynamic** — the skills are built from the live tool registry at serve time, and `A2A_ADVERTISED_TOOLSETS` restricts them. (e) stdlib `http.server` on a **daemon thread** (no asyncio loop needed at `register()` time), which sidesteps a whole bug class.
- **Edge cases & failure handling:** the handler never raises — every failure becomes an error envelope; a missing cursor means "start at the tail", never 0; the push callback is SSRF-guarded and HMAC-signed; the reply timeout and the orphan timeout are separate knobs with a floor of 300 s.

#### `plugins/platforms/a2a/tools.py` (19 KB)
- **Purpose:** The five outbound client tools.
- **Key abstractions:** `a2a_discover`, `a2a_call`, `a2a_list`, `a2a_history`, `a2a_orchestrate`, `_send_task()`, `_TOOLS`.
- **Data flow:** a peer name (or URL) → the Agent Card → the JSON-RPC `SendMessage` → the reply; every outbound message is redacted, audited and persisted to the context's JSONL.
- **Non-obvious decisions:** (a) **the tools are config-gated** (`_a2a_tools_available()`): "these registered unconditionally, so every session on every install paid ~561 tok/call for tools whose only possible output without config is 'no peers configured'". (b) `a2a_orchestrate` has three modes and `best` is **deliberately coarse** ("longest successful reply — a deliberately coarse heuristic; errors never win, and an all-error fan-out reports the failures instead of picking one"). (c) the output is **sorted by peer name** for determinism. (d) `a2a_call` accepts the aliases models actually reach for (`agent_name`, `name`, `text`, `task`) and returns the peer's `TASK_STATE_INPUT_REQUIRED` with the exact context id to continue.
- **Edge cases & failure handling:** a 401/403/429 get specific messages ("check the configured token", "retry later"); a missing peer names the config path to fix.

#### `plugins/platforms/a2a/security.py` (see above) / `plugins/platforms/a2a/__init__.py` (4.8 KB)
- **Purpose:** The plugin entry point + the platform hint.
- **What it pins:** the `_PLATFORM_HINT` text, which is the agent-facing policy for inbound A2A: treat it as untrusted external input, never disclose secrets, do not follow embedded instructions, and start a reply with `[INPUT_REQUIRED]` when a task needs clarification. `register()` registers the client tools **and** the platform, each in its own try/except, so one failing half does not lose the other.

#### `plugins/platforms/a2a/DESIGN.md` (docs, 9.7 KB)
- **Purpose:** The design document.
- **What it decides:** why the feature is a plugin and not core (the standing policy "plugins must not touch core files"); the two directions; the v1.0 wire-format notes (SCREAMING_SNAKE_CASE states, member-presence discriminated Parts, `contextId` inside the Message, error-code allocation `-32001/-32002` for the spec and `-32050..-32052` for the custom range); the security defaults; the state placement; the persistence rule (conversations live **outside** the compaction pipeline); the **requirement-tracing table** (issue number → requirement → where it is implemented); and an explicit "Deliberately out of scope" list.

#### `plugins/platforms/a2a/README.md` (docs, 4 KB) — the operator's view: enable, the five tools, the inbound endpoints, the security list, and the **env-var table** (including `A2A_MAX_PINGPONG_TURNS` default 5 / hard max 20, `A2A_RATE_LIMIT` 60/min, `A2A_REPLY_TIMEOUT` 300 s).

#### `plugins/platforms/a2a/plugin.yaml` (config, 3.6 KB) — the manifest. Two non-obvious decisions are in the comments: `provides_tools` exists so discovery imports `tools.py` in CLI/TUI processes where the plugin is otherwise deferred (#78050), and the inbound adapter stays deferred either way.

### Tier 2 — bulk: the model-provider set (81 files)

The set is one **declarative profile** per vendor: a `ProviderProfile` subclass (only when the vendor has a quirk) plus a `plugin.yaml` manifest. The manifest always carries `kind: model-provider`. The profile hooks are the interesting part: `build_api_kwargs_extras` (the reasoning-effort translation), `build_extra_body` (Gemini's `thinking_config`, Nous' portal tags), `prepare_messages` (message normalization), `fetch_models` (live catalog), `supported_reasoning_efforts`, `default_reasoning_config`, `create_client` (a non-HTTP client), `get_max_tokens`, `get_setup_schema`.

| File | What it is / what it pins |
| --- | --- |
| `plugins/model-providers/README.md` | The plugin layout, the discovery rule (lazy, last-writer-wins so a user plugin overrides a bundled one), the 3-step "add a provider" recipe, and the two non-trivial profile examples (OpenRouter's `build_extra_body`, Gemini's `thinking_config`). |
| `plugins/model-providers/actual/__init__.py` | Actual Computer; macOS-only CA-bundle pinning, and a `none` effort that is echoed as `reasoning_effort` (unlike the Moonshot/DeepSeek wires). |
| `plugins/model-providers/actual/plugin.yaml` | Manifest: `actual-provider`. |
| `plugins/model-providers/ai-gateway/__init__.py` | Vercel AI Gateway: attribution headers + a `reasoning` passthrough. |
| `plugins/model-providers/ai-gateway/plugin.yaml` | Manifest: `ai-gateway-provider`. |
| `plugins/model-providers/alibaba-coding-plan/__init__.py` | Alibaba Coding Plan (intl + CN); DashScope "keep replayed prior-turn thinking" extras. |
| `plugins/model-providers/alibaba-coding-plan/plugin.yaml` | Manifest: `alibaba-coding-plan-provider`. |
| `plugins/model-providers/alibaba/__init__.py` | Alibaba DashScope: 4 profiles (intl, CN, Token Plan, Token Plan CN) sharing one quirk. |
| `plugins/model-providers/alibaba/plugin.yaml` | Manifest: `alibaba-provider`. |
| `plugins/model-providers/anthropic/__init__.py` | Native Anthropic: `x-api-key` + `anthropic-version`, and a **cursor-paginated** `/v1/models` fetch. |
| `plugins/model-providers/anthropic/plugin.yaml` | Manifest: `anthropic-provider`. |
| `plugins/model-providers/arcee/__init__.py` | Arcee AI — a bare profile. |
| `plugins/model-providers/arcee/plugin.yaml` | Manifest: `arcee-provider`. |
| `plugins/model-providers/azure-foundry/__init__.py` | Azure Foundry — an empty base URL because it is per-resource. |
| `plugins/model-providers/azure-foundry/plugin.yaml` | Manifest: `azure-foundry-provider`. |
| `plugins/model-providers/bedrock/__init__.py` | AWS Bedrock — `auth_type="aws_sdk"`, `supports_model_listing=False`. |
| `plugins/model-providers/bedrock/plugin.yaml` | Manifest: `bedrock-provider`. |
| `plugins/model-providers/commandcode/__init__.py` | CommandCode (chat + anthropic); delegates DeepSeek-family reasoning to the *registry* entry, not a module import. |
| `plugins/model-providers/commandcode/plugin.yaml` | Manifest: `commandcode-provider`. |
| `plugins/model-providers/copilot-acp/__init__.py` | GitHub Copilot over an **ACP stdio subprocess** — no REST models endpoint; the model list comes from a short-lived signed-in session. |
| `plugins/model-providers/copilot-acp/plugin.yaml` | Manifest: `copilot-acp-provider`. |
| `plugins/model-providers/copilot/__init__.py` | GitHub Copilot; a catalog-gated effort ladder with a clamp that "never drop[s] straight to medium, which inverted the ladder (ultra < high)". |
| `plugins/model-providers/copilot/plugin.yaml` | Manifest: `copilot-provider`. |
| `plugins/model-providers/custom/__init__.py` | Custom/Ollama/local endpoints: `think=false` only on Ollama URLs, Groq's `reasoning_effort: "default"`, and an honest widest-effort ceiling. |
| `plugins/model-providers/custom/plugin.yaml` | Manifest: `custom-provider`. |
| `plugins/model-providers/deepinfra/__init__.py` | DeepInfra: `reasoning_effort` mapping, live vision-model discovery (key-gated, `chat`-tagged), and an **empty** `fallback_models` ("an empty picker beats silently routing to a retired model"). |
| `plugins/model-providers/deepinfra/plugin.yaml` | Manifest: `deepinfra-provider`. |
| `plugins/model-providers/deepseek/__init__.py` | DeepSeek: `thinking` set **explicitly** to avoid the `reasoning_content` echo trap; `json_schema` declared unsupported (a guaranteed 400). |
| `plugins/model-providers/deepseek/plugin.yaml` | Manifest: `deepseek-provider`. |
| `plugins/model-providers/fireworks/__init__.py` | Fireworks: top-level `reasoning_effort` only; attribution headers via `default_headers` so they survive model switches. |
| `plugins/model-providers/fireworks/plugin.yaml` | Manifest: `fireworks-provider`. |
| `plugins/model-providers/gemini/__init__.py` | Gemini: native vs OpenAI-compat `thinking_config` translation (camel vs snake_case) and the long-decode output budget. |
| `plugins/model-providers/gemini/plugin.yaml` | Manifest: `gemini-provider`. |
| `plugins/model-providers/gmi/__init__.py` | GMI Cloud — a bare profile with attribution + fallbacks. |
| `plugins/model-providers/gmi/plugin.yaml` | Manifest: `gmi-provider`. |
| `plugins/model-providers/huggingface/__init__.py` | Hugging Face router — a bare profile. |
| `plugins/model-providers/huggingface/plugin.yaml` | Manifest: `huggingface-provider`. |
| `plugins/model-providers/kilocode/__init__.py` | Kilo Code — a bare profile. |
| `plugins/model-providers/kilocode/plugin.yaml` | Manifest: `kilocode-provider`. |
| `plugins/model-providers/kimi-coding/__init__.py` | Moonshot Kimi: `thinking` **xor** `reasoning_effort` (400 on both), `keep: "all"` for K2.x, `Accept-Encoding: gzip` to dodge a brotli SSE bug, and a strict canonical-URL check. |
| `plugins/model-providers/kimi-coding/plugin.yaml` | Manifest: `kimi-coding-provider`. |
| `plugins/model-providers/lmstudio/__init__.py` | LM Studio: effort clamped to the model's **published** `allowed_options`, probed and cached; `base_url` left empty so local-server detection for Ollama/llama.cpp/vLLM is not disabled. |
| `plugins/model-providers/lmstudio/plugin.yaml` | Manifest: `lmstudio-provider`. |
| `plugins/model-providers/meta-ai/__init__.py` | Meta Muse Spark: filters non-chat models out of the picker, maps `none` → `minimal`, uses the Responses API for prompt caching, and declares `supports_vision_tool_messages=False` (an image inside a `role:tool` 400s). |
| `plugins/model-providers/meta-ai/plugin.yaml` | Manifest: `meta-ai-provider` (third-party author, homepage recorded). |
| `plugins/model-providers/minimax/__init__.py` | MiniMax: intl/CN/OAuth profiles on the anthropic_messages wire, plus M3's `reasoning_split` on the OpenAI-compat route. |
| `plugins/model-providers/minimax/plugin.yaml` | Manifest: `minimax-provider`. |
| `plugins/model-providers/nebius-token-factory/__init__.py` | Nebius: a conservative model-family allowlist for reasoning + a "nearest weaker" clamp. |
| `plugins/model-providers/nebius-token-factory/plugin.yaml` | Manifest: `nebius-token-factory-provider`. |
| `plugins/model-providers/nous/__init__.py` | Nous Portal: product tags, a **sticky `session_id` routing key** (cache-breakpoint affinity), and a reasoning-disable that is *omitted* when the route cannot disable it. |
| `plugins/model-providers/nous/plugin.yaml` | Manifest: `nous-provider`. |
| `plugins/model-providers/novita/__init__.py` | NovitaAI — a bare profile with fallbacks. |
| `plugins/model-providers/novita/plugin.yaml` | Manifest: `novita-provider`. |
| `plugins/model-providers/nvidia/__init__.py` | NVIDIA NIM: a **copy-on-write** `prepare_messages` that strips `name`/`tool_name` from tool messages (NIM's stricter schema). |
| `plugins/model-providers/nvidia/plugin.yaml` | Manifest: `nvidia-provider`. |
| `plugins/model-providers/ollama-cloud/__init__.py` | Ollama Cloud: `xhigh` → `max`; `none` is the only off switch; a "minimal" that would 400 is clamped to `low`. |
| `plugins/model-providers/ollama-cloud/plugin.yaml` | Manifest: `ollama-cloud-provider`. |
| `plugins/model-providers/openai-codex/__init__.py` | OpenAI Codex (Responses) — no API key; `env_vars=()` because the credential is OAuth-external. |
| `plugins/model-providers/openai-codex/plugin.yaml` | Manifest: `openai-codex-provider`. |
| `plugins/model-providers/opencode-zen/__init__.py` | OpenCode Zen + Go: per-model reasoning (GLM-5.2, Kimi K2, DeepSeek), a per-model `max_tokens` cap, a **usage-window fetch**, and `supports_vision_tool_messages=False` because a rejected row stays in history. |
| `plugins/model-providers/opencode-zen/plugin.yaml` | Manifest: `opencode-zen-provider`. |
| `plugins/model-providers/openrouter/__init__.py` | OpenRouter: sticky `session_id`, a **catalog-declared effort clamp**, reasoning-mandatory Anthropic routes that route effort onto `verbosity` instead, speed-tier endpoint pins, the Grok cache-parity fork scope, and the Pareto Code router plugin. |
| `plugins/model-providers/openrouter/plugin.yaml` | Manifest: `openrouter-provider`. |
| `plugins/model-providers/qwen-oauth/__init__.py` | Qwen Portal: content normalization to list-of-parts, `cache_control` on the system message, `vl_high_resolution_images`, and metadata in top-level kwargs. |
| `plugins/model-providers/qwen-oauth/plugin.yaml` | Manifest: `qwen-oauth-provider`. |
| `plugins/model-providers/router/__init__.py` | Ramp Router: a **per-home efforts cache** (memory + disk mirror + background warmer, never HTTP on the hot path), a disk write via write-then-rename, and `contextvars.copy_context()` for the warmer thread. |
| `plugins/model-providers/router/plugin.yaml` | Manifest: `router-provider`. |
| `plugins/model-providers/solstice/__init__.py` | Solstice: a per-user-quota Gemini subscription over OAuth, `hidden=True` until the user signs in by name, with a hardcoded fallback ladder ordered "lite stays last as the reserve". |
| `plugins/model-providers/solstice/auth.py` | The NAS-brokered PKCE flow: client discovery, the token exchange, and the "a refresh NAS rejects is a dead grant" rule. |
| `plugins/model-providers/solstice/transport.py` | `GeminiNativeClient` subclassed onto `:generateContentPerUserQuota` with a Bearer instead of an API key, and API-key remedies turned off. |
| `plugins/model-providers/solstice/plugin.yaml` | Manifest: `solstice-provider` (pre-release). |
| `plugins/model-providers/stepfun/__init__.py` | StepFun — a bare profile. |
| `plugins/model-providers/stepfun/plugin.yaml` | Manifest: `stepfun-provider`. |
| `plugins/model-providers/tencent-tokenhub/__init__.py` | Tencent TokenHub: effort clamped to low/medium/high, omitted when thinking is off, and `high` as the main-loop default. |
| `plugins/model-providers/tencent-tokenhub/plugin.yaml` | Manifest: `tencent-tokenhub-provider`. |
| `plugins/model-providers/upstage/__init__.py` | Upstage Solar: an unset effort defaults reasoning **on** (Solar's own default is off), a deny-list of non-reasoning families, and bespoke levels collapsing to `high` rather than silently downgrading. |
| `plugins/model-providers/upstage/plugin.yaml` | Manifest: `upstage-provider`. |
| `plugins/model-providers/vertex/__init__.py` | Google Vertex: OAuth2 (`auth_type="vertex"`) so a credentials path is never mistaken for a key; no model listing route. |
| `plugins/model-providers/vertex/plugin.yaml` | Manifest: `vertex-provider`. |
| `plugins/model-providers/xai/__init__.py` | xAI Grok on the Responses API — a bare profile with a UA header. |
| `plugins/model-providers/xai/plugin.yaml` | Manifest: `xai-provider`. |
| `plugins/model-providers/xiaomi/__init__.py` | Xiaomi MiMo: health check off (401 with a valid key), vision on, tool-message images off. |
| `plugins/model-providers/xiaomi/plugin.yaml` | Manifest: `xiaomi-provider`. |
| `plugins/model-providers/zai/__init__.py` | Z.AI/GLM: `extra_body.thinking` + `clear_thinking: false` (preserved thinking), a per-version effort ladder (5.2 high/max, 5.3 low..max), and GLM-5.3's "reject[s] disabled thinking" handled by mapping it to `low`. |
| `plugins/model-providers/zai/plugin.yaml` | Manifest: `zai-provider`. |

### Tier 2 — bulk: image / video generation (18 files)

| File | What it is / what it pins |
| --- | --- |
| `plugins/image_gen/_common.py` | The shared plumbing: the `OPENAI_SIZES` aspect map, the `GPT_IMAGE_2_TIERS` virtual model ids (same API model, different `quality`), `resolve_static_model()`'s **known-id-wins** precedence chain (explicit → env → provider-scoped config → top-level config → default, with an opt-in `passthrough`), `StaticImageGenProvider`, `error_factory()`, `materialize_image()` (base64 always cached; a URL cached best-effort), `record_token_usage()`, and `post_json()` with its `HttpFailure` taxonomy (**unreachable** = never connected vs **connection** = dropped after connecting). |
| `plugins/image_gen/deepinfra/__init__.py` | DeepInfra image: a **fully dynamic** catalog (no hardcoded ids), text-to-image only, and a `no_model_available` error rather than a guess. |
| `plugins/image_gen/deepinfra/plugin.yaml` | Manifest: `deepinfra` (requires `DEEPINFRA_API_KEY`). |
| `plugins/image_gen/fal/__init__.py` | FAL.ai: a thin adapter over the legacy `image_generate_tool`, reshaping the JSON-string result into the ABC dict, and a `capabilities()` that depends on the *selected* model's edit endpoint. |
| `plugins/image_gen/fal/plugin.yaml` | Manifest: `fal` (requires `FAL_KEY`). |
| `plugins/image_gen/krea/__init__.py` | Krea: an **async submit → poll** backend with backoff, a 180 s ceiling, a per-tier catalog with prices, a managed-gateway path, a **fallback-eligibility rule** (only "no job was created" failures may fall back), the Krea-2 style-reference vs Krea-3 edit split, a 3 MB local-reference budget, and a best-effort Enhance pass. |
| `plugins/image_gen/krea/plugin.yaml` | Manifest: `krea` v1.1.0. |
| `plugins/image_gen/meta-ai/__init__.py` | Meta `muse-image`: base64 WebP → cache, an alias-ordered key list, and a base URL read through the secret scope. |
| `plugins/image_gen/meta-ai/plugin.yaml` | Manifest: `meta-ai-image-gen`. |
| `plugins/image_gen/openai-codex/__init__.py` | gpt-image-2 over the Codex **native** images endpoints; documents *why* the hosted-tool route was abandoned (OpenAI withdrew the model id for an account cohort and the host model was free to answer in text); 25 MB / 16-reference caps; an SSRF-safe fetch for remote inputs; and it **reports** `reported_quality`/`reported_size` because the backend does not honour them. |
| `plugins/image_gen/openai-codex/plugin.yaml` | Manifest: `openai-codex`. |
| `plugins/image_gen/openai/__init__.py` | OpenAI images: the GPT Image 2.5 tier matrix, a **named-endpoint** reuse of a chat endpoint's URL+key, an env-only-proxy client, the `OpenAI-Project` header blanked, and `response_format` deliberately not sent. |
| `plugins/image_gen/openai/plugin.yaml` | Manifest: `openai` (requires `OPENAI_API_KEY`). |
| `plugins/image_gen/openrouter/__init__.py` | OpenRouter images: **two surfaces** (chat-completions image output vs the Dedicated Image API), a curated per-model knob table (aspect ratios / resolutions / quality / background / seed / n), a knob filter that drops what a model does not declare (the endpoint silently ignores unknown parameters, which would let a caller believe `background=transparent` took effect), a **fallback model chain** (OpenAI first, Gemini when gated), and a cached image-API catalog probe keyed by (base URL, key fingerprint). |
| `plugins/image_gen/openrouter/plugin.yaml` | Manifest: `openrouter` v1.1.0. |
| `plugins/image_gen/xai/__init__.py` | xAI Grok Imagine: a live `/image-generation-models` catalog (credential-keyed), a separate edit model, a 3-source cap, and materialising the temporary URL because `imgen.x.ai/xai-tmp-*` 404s within minutes. |
| `plugins/image_gen/xai/plugin.yaml` | Manifest: `xai`. |
| `plugins/video_gen/deepinfra/__init__.py` | DeepInfra video: an OpenAI-compatible `create → poll → download_content` provider with a live `video-gen`-tagged catalog. |
| `plugins/video_gen/deepinfra/plugin.yaml` | Manifest: `deepinfra` (video). |
| `plugins/video_gen/fal/__init__.py` | FAL video: a **family catalog** (each family declares its own endpoints, aspect ratios, resolutions, duration range/enum, audio key name, and which keys to drop), a duration clamp that snaps to an enum and then applies a per-resolution cap, a strict managed-vs-direct selection, and an optional SeedVR2 upscale. |
| `plugins/video_gen/fal/plugin.yaml` | Manifest: `fal` (video). |
| `plugins/video_gen/openrouter/__init__.py` | OpenRouter video: a live `/videos/models` catalog, a **nearest-value clamp** (duration by distance, resolution by pixel height, aspect by ratio) because the tool always sends a default and an out-of-enum value is a guaranteed 400, a poll with a 900 s deadline, and a content URL derived from the configured origin (never from `unsigned_urls`). |
| `plugins/video_gen/openrouter/plugin.yaml` | Manifest: `openrouter` (video). |
| `plugins/video_gen/xai/__init__.py` | xAI video: text / image / reference-to-video plus edit and extend; the model is chosen by **modality**, not by the config value; a reference cap of 10 s; and the stored public URL is preferred over the temporary one. |
| `plugins/video_gen/xai/plugin.yaml` | Manifest: `xai` (video). |

### Tier 2 — bulk: web search / extract (21 files)

| File | What it is / what it pins |
| --- | --- |
| `plugins/web/__init__.py` | Two comment lines: the layout and the auto-load/registration contract. |
| `plugins/web/_common.py` | The shared plumbing: the **fixed result shapes** ("key order is part of the contract — it reaches the model as JSON"), the guarded execution wrapper (interrupt check + uniform failure classification), `http_get_json`, `titled_rows`, `cached_sdk_client()` (the `(key, client)` pair so a rotated key can never sit beside another key's client), `BaseWebSearchProvider` (whose `is_available` **ignores** the keyless tier so the preference walk cannot route a keyed user onto a free tier), and the keyless variant schemas. |
| `plugins/web/keyless_mcp.py` | The **keyless ring**: four free-tier vendors (Exa, Parallel, Firecrawl, Keenable) behind a **round-robin with failover**, resolved strictly last, with a rate-limit-shaped error detector, a per-URL error contract, an MCP/SSE body parser that splits SSE frames only on the real line terminators (so CJK text is not cut), a charset-aware decode (SSE has no charset and `requests` would decode it as ISO-8859-1), and a `served_by` field when a different vendor answered. |
| `plugins/web/brave_free/__init__.py` | The registration shim. |
| `plugins/web/brave_free/plugin.yaml` | Manifest: `web-brave-free`. |
| `plugins/web/brave_free/provider.py` | Brave Search free tier — search only, a 20-result cap, title-first rows. |
| `plugins/web/ddgs/__init__.py` | The registration shim. |
| `plugins/web/ddgs/plugin.yaml` | Manifest: `web-ddgs` (optional `ddgs` dependency). |
| `plugins/web/ddgs/_search_worker.py` | The **child-process** search worker: one JSON request in, one envelope out, with test hooks gated behind `HERMES_DDGS_ALLOW_TEST_HOOKS=1` and a GIL-holding simulation of the native `primp` hang. |
| `plugins/web/ddgs/provider.py` | DuckDuckGo: **every search runs in a disposable child process** because `ddgs`/`primp` can block in native code while holding the GIL — "a thread-pool `future.result(timeout=…)` cap can never fire and Ctrl+C/SIGTERM freeze the process". |
| `plugins/web/exa/__init__.py` | The registration shim. |
| `plugins/web/exa/plugin.yaml` | Manifest: `web-exa`. |
| `plugins/web/exa/provider.py` | Exa via the `exa-py` SDK (lazy-installed); search and extract, keyless or keyed. |
| `plugins/web/firecrawl/__init__.py` | The registration shim. |
| `plugins/web/firecrawl/plugin.yaml` | Manifest: `web-firecrawl`. |
| `plugins/web/firecrawl/provider.py` | Firecrawl with **three routes** (keyless cloud, direct SDK, Nous tool-gateway); an SSRF-safe scrape; a per-URL error contract; and a `_FirecrawlProxy` that satisfies `isinstance` checks so the three routes share one code path. |
| `plugins/web/keenable/__init__.py` | The registration shim. |
| `plugins/web/keenable/plugin.yaml` | Manifest: `web-keenable`. |
| `plugins/web/keenable/provider.py` | Keenable — a keyless-ring member with the mandatory `X-Keenable-Title` app id. |
| `plugins/web/openai_native/__init__.py` | The registration shim. |
| `plugins/web/openai_native/plugin.yaml` | Manifest: `web-openai-native`. |
| `plugins/web/openai_native/provider.py` | OpenAI native web search: **the provider never searches**; selecting it tells the Responses transport to declare the server-side `web_search` built-in. |
| `plugins/web/parallel/__init__.py` | The registration shim. |
| `plugins/web/parallel/plugin.yaml` | Manifest: `web-parallel`. |
| `plugins/web/parallel/provider.py` | Parallel.ai: sync search + **async** extract, three search modes (`agentic`/`fast`/`one-shot`). |
| `plugins/web/perplexity/__init__.py` | The registration shim. |
| `plugins/web/perplexity/plugin.yaml` | Manifest: `web-perplexity`. |
| `plugins/web/perplexity/provider.py` | Perplexity: the Search API plus the query-relevant `content/snippets` route; a managed-gateway option; per-capability backend keys. |
| `plugins/web/searxng/__init__.py` | The registration shim. |
| `plugins/web/searxng/plugin.yaml` | Manifest: `web-searxng`. |
| `plugins/web/searxng/provider.py` | SearXNG — search only (it aggregates engines but does not fetch URLs). |
| `plugins/web/tavily/__init__.py` | The registration shim. |
| `plugins/web/tavily/plugin.yaml` | Manifest: `web-tavily`. |
| `plugins/web/tavily/provider.py` | Tavily: keyed (`Authorization: Bearer`) or keyless (`X-Tavily-Access-Mode: keyless`); Tavily is **not** in the zero-config ring — keyless is opt-in. |
| `plugins/web/xai/__init__.py` | The registration shim. |
| `plugins/web/xai/plugin.yaml` | Manifest: `web-xai`. |
| `plugins/web/xai/provider.py` | xAI web search via Grok's server-side `web_search`; the model is asked for structured JSON so rows match every other provider; domain allow/exclude lists (max 5, mutually exclusive). |

### Tier 2 — bulk: platform adapters (≈200 files)

All of these follow one shape: a `plugin.yaml` manifest (`kind: platform`) declaring `requires_env` / `optional_env` (each with a `description`, `prompt`, `url` and `password` flag that the config UI renders), an `__init__.py` that calls `register(ctx)`, an `adapter.py` implementing `BasePlatformAdapter`, and optional helper modules split out of the adapter facade.

| File | What it is / what it pins |
| --- | --- |
| `plugins/platforms/bluebubbles/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/bluebubbles/adapter.py` | BlueBubbles (iMessage): a local macOS server, REST sends + a webhook listener, media, typing indicators, read receipts, tapbacks, group wake-word gating. |
| `plugins/platforms/bluebubbles/gateway_env.py` | The env → gateway-config bridge. |
| `plugins/platforms/bluebubbles/plugin.yaml` | Manifest: `bluebubbles-platform` (requires `BLUEBUBBLES_SERVER_URL`). |
| `plugins/platforms/buzz/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/buzz/adapter.py` | Buzz (Block's Nostr relay): shells out to the `buzz` CLI (JSON in/out); media refs are rewritten; mention escaping. |
| `plugins/platforms/buzz/buzz_cursors.py` | **Durable per-channel receive cursors** so a restart resumes from the saved position. |
| `plugins/platforms/buzz/nostr_auth.py` | **Dependency-free Nostr signing**: secp256k1 / BIP-340 Schnorr, hand-written bech32 and tagged hashing. |
| `plugins/platforms/buzz/send_targets.py` | The `send_message` declarations for the PlatformEntry. |
| `plugins/platforms/buzz/plugin.yaml` | Manifest: `buzz-platform`. |
| `plugins/platforms/dingtalk/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/dingtalk/adapter.py` | DingTalk Stream Mode; replies via session-webhook markdown or AI Cards; an SDK version guard; a log guard. |
| `plugins/platforms/dingtalk/gateway_env.py` | The env bridge. |
| `plugins/platforms/dingtalk/inbound.py` | **Pure parsers** for the inbound `ChatbotMessage` payload — no I/O, no adapter state. |
| `plugins/platforms/dingtalk/plugin.yaml` | Manifest: `dingtalk-platform`. |
| `plugins/platforms/discord/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/discord/adapter.py` | The Discord adapter (385 KB): voice, slash commands, threads, reactions, channel skill bindings, native media. |
| `plugins/platforms/discord/adapter_authorization.py` | **Fresh membership checks** for owner-held durable native inputs. |
| `plugins/platforms/discord/adapter_component_auth.py` | Shared user-or-role authorization for button clicks. |
| `plugins/platforms/discord/adapter_config_readers.py` | config.yaml readers: DM role-auth guild opt-in + the button-view timeout. |
| `plugins/platforms/discord/adapter_hint.py` | The system-prompt platform hint, kept out of the adapter facade. |
| `plugins/platforms/discord/adapter_media.py` | Native media uploads + delivery fallbacks. |
| `plugins/platforms/discord/adapter_slash_auth.py` | The slash-command authorization verdict — "the on_message gates, side-effect free". |
| `plugins/platforms/discord/adapter_thread_titles.py` | Keeps Hermes' own auto-thread title rename **out of** the pinned session-context prompt. |
| `plugins/platforms/discord/adapter_voice_info.py` | Who is in the voice channel and who is speaking, for status and prompt context. |
| `plugins/platforms/discord/dashboard_card.py` | The Channels-page card. |
| `plugins/platforms/discord/ffmpeg_utils.py` | ffmpeg discovery for voice. |
| `plugins/platforms/discord/gateway_env.py` | The env bridge. |
| `plugins/platforms/discord/onboarding.py` | Onboarding: a bot-token check against Discord, the message-content intent, the invite, the allowlist. |
| `plugins/platforms/discord/recovery.py` | **Durable state for reconnect message recovery.** |
| `plugins/platforms/discord/send_targets.py` | The `send_message` declarations. |
| `plugins/platforms/discord/voice_mixer.py` | A continuous PCM mixer (discord.py allows one `AudioSource` per VoiceClient) with a numpy child process. |
| `plugins/platforms/discord/plugin.yaml` | Manifest: `discord-platform` (requires `DISCORD_BOT_TOKEN`). |
| `plugins/platforms/email/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/email/adapter.py` | Email: IMAP polled inbound, SMTP outbound, an IPv4-only SMTP client, automated-sender detection. |
| `plugins/platforms/email/gateway_env.py` | The env bridge. |
| `plugins/platforms/email/plugin.yaml` | Manifest: `email-platform`. |
| `plugins/platforms/feishu/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/feishu/adapter.py` | Feishu/Lark (226 KB): the lark-oapi SDK, WebSocket or webhook, threads, DM pairing, group mention gating, drive comments, meeting invites. |
| `plugins/platforms/feishu/adapter_hint.py` | The platform hint. |
| `plugins/platforms/feishu/dashboard_card.py` | The Channels-page card. |
| `plugins/platforms/feishu/feishu_admission_diagnostics.py` | Operator-facing diagnostics for inbound admission (e.g. the empty-allowlist drop warning). |
| `plugins/platforms/feishu/feishu_comment_rules.py` | Document comment access-control: exact doc > wildcard > top-level > code defaults, with a pairing-approval file. |
| `plugins/platforms/feishu/feishu_comment.py` | Drive document comment handling (the `comment_add_v1` event → the Drive comment APIs), with retries and text sanitisation. |
| `plugins/platforms/feishu/feishu_meeting_invite.py` | Meeting-invitation events → a synthetic gateway `MessageEvent`, with a dedupe key. |
| `plugins/platforms/feishu/gateway_env.py` | The env bridge. |
| `plugins/platforms/feishu/send_targets.py` | The `send_message` declarations. |
| `plugins/platforms/feishu/plugin.yaml` | Manifest: `feishu-platform`. |
| `plugins/platforms/google_chat/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/google_chat/adapter.py` | Google Chat: authenticated HTTP callbacks or a Cloud Pub/Sub pull subscription, ID-token verification, service-account credentials. |
| `plugins/platforms/google_chat/cards.py` | Outbound text formatting + Cards v2 widget rendering. |
| `plugins/platforms/google_chat/oauth.py` | The per-user OAuth helper (token persistence, refresh, authorised-email list). |
| `plugins/platforms/google_chat/setup_files.py` | The in-chat `/setup-files` OAuth flow for native attachment delivery. |
| `plugins/platforms/google_chat/plugin.yaml` | Manifest: `google_chat-platform`. |
| `plugins/platforms/irc/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/irc/adapter.py` | IRC — **stdlib asyncio only, zero external dependencies**; message parsing, nick extraction, a privmsg budget, a line splitter. |
| `plugins/platforms/irc/plugin.yaml` | Manifest: `irc-platform`. |
| `plugins/platforms/line/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/line/adapter.py` | LINE: an aiohttp webhook with **HMAC-SHA256 signature verification**, a reply-token cache, and a postback bubble so a slow answer can be fetched later for free. |
| `plugins/platforms/line/plugin.yaml` | Manifest: `line-platform`. |
| `plugins/platforms/matrix/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/matrix/adapter.py` | Matrix via mautrix, with optional E2EE, HTML sanitisation, media uploads, mention gating. |
| `plugins/platforms/matrix/adapter_crypto.py` | The E2EE crypto state-store shim for mautrix's `OlmMachine`. |
| `plugins/platforms/matrix/adapter_hint.py` | The platform hint. |
| `plugins/platforms/matrix/dashboard_card.py` | The Channels-page card. |
| `plugins/platforms/matrix/gateway_env.py` | The env bridge (with the E2EE flag). |
| `plugins/platforms/matrix/send_targets.py` | The `send_message` declarations. |
| `plugins/platforms/matrix/voice_mention.py` | **Parks unmentioned voice messages** until the sender's bare @mention claims them. |
| `plugins/platforms/matrix/plugin.yaml` | Manifest: `matrix-platform`. |
| `plugins/platforms/mattermost/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/mattermost/adapter.py` | Mattermost: REST v4 + WebSocket (no SDK), thread-mode replies, native uploads, channel allowlists. |
| `plugins/platforms/mattermost/gateway_env.py` | The env bridge. |
| `plugins/platforms/mattermost/plugin.yaml` | Manifest: `mattermost-platform`. |
| `plugins/platforms/ntfy/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/ntfy/adapter.py` | ntfy: HTTP-streaming inbound (`/json`, `poll=false`), POST outbound, no SDK. |
| `plugins/platforms/ntfy/plugin.yaml` | Manifest: `ntfy-platform`; notes that ntfy has **no user-identity primitive**, so a topic is one trusted channel. |
| `plugins/platforms/photon/__init__.py` | The plugin entry point. |
| `plugins/platforms/photon/adapter.py` | Photon Spectrum (iMessage): a supervised Node sidecar over a long-lived gRPC stream; runtime-record bookkeeping, sidecar dependency staleness checks, an error mapper. |
| `plugins/platforms/photon/auth.py` | The dashboard API client + the RFC-8628 device-code login; a credential pool. |
| `plugins/platforms/photon/cli.py` | `hermes photon …` — device login, token, project, credentials, status, telemetry, sidecar install. |
| `plugins/platforms/photon/sidecar_paths.py` | Where the sidecar runs and where its Node deps live; writability + install-lock freshness checks. |
| `plugins/platforms/photon/README.md` | The plugin's architecture doc: the gRPC/loopback diagram, the six-step setup, the credentials split (`~/.hermes/.env` vs `auth.json`). |
| `plugins/platforms/photon/plugin.yaml` | Manifest: `photon-platform` v0.3.0. |
| `plugins/platforms/photon/sidecar/.gitignore` | Ignores `node_modules/` and the npm error log. |
| `plugins/platforms/photon/sidecar/README.md` | The sidecar's contract: the SDK, the loopback HTTP control channel (`X-Hermes-Sidecar-Token`), the inbound drain. |
| `plugins/platforms/photon/sidecar/index.mjs` | The sidecar itself (47 KB): inbound NDJSON, the send/typing/react endpoints, the health endpoint, and the zombie-stream watchdog. Read as the header + the constant/symbol map; the control-channel handlers were not read line by line. |
| `plugins/platforms/photon/sidecar/package.json` | The sidecar manifest: `spectrum-ts` 12.7.0, a `postinstall` that runs the patch script, and pinned `overrides` (undici, protobufjs, the OTel packages). |
| `plugins/platforms/photon/sidecar/package-lock.json` | The committed lockfile (55 KB) — **not read line by line** (a generated lockfile; the dependency set and integrity hashes were confirmed by reading the head). |
| `plugins/platforms/photon/sidecar/patch-spectrum-mixed-attachments.mjs` | A **postinstall patch** of the vendored SDK: it rewrites the two iMessage inbound mappers so a mixed text+attachment bubble keeps its text. It uses `replaceOnce`/`replaceExactly` and **fails loudly** if the upstream shape changes, and it no-ops when upstream already preserves mixed payloads. |
| `plugins/platforms/photon/sidecar/send-format.mjs` | The outbound builder choice: markdown with a URL goes through the **text** builder (the markdown builder's data detection 500s on raw URLs). Pure, so tests can run the real decision under node. |
| `plugins/platforms/photon/sidecar/stream-staleness.mjs` | The zombie-stream watchdog's **pure** decision helpers: a not-found rejection proves the channel is alive, anything else is *inconclusive*, and silence alone never degrades the stream. |
| `plugins/platforms/qqbot/__init__.py` | `from .register import register`. |
| `plugins/platforms/qqbot/adapter.py` | QQ Bot (Official API v2): a WebSocket gateway inbound, REST outbound. |
| `plugins/platforms/qqbot/chunked_upload.py` | The 10 MB–100 MB chunked upload flow with daily-limit and file-too-large errors, hashes and a job model. |
| `plugins/platforms/qqbot/constants.py` | Package-level constants. |
| `plugins/platforms/qqbot/crypto.py` | AES-256-GCM for the scan-to-configure credential decryption. |
| `plugins/platforms/qqbot/gateway_env.py` | The env bridge. |
| `plugins/platforms/qqbot/keyboards.py` | Inline keyboards + **approval / update-prompt button helpers** — a button click dispatches an action. |
| `plugins/platforms/qqbot/onboard.py` | The QR-code scan-to-configure onboarding (the Feishu pattern mirrored). |
| `plugins/platforms/qqbot/register.py` | The registry entry + standalone sender. |
| `plugins/platforms/qqbot/send.py` | The out-of-process sender (cron/CLI): text tries guild → C2C → group; media uploads. |
| `plugins/platforms/qqbot/utils.py` | The User-Agent, HTTP headers and config coercion. |
| `plugins/platforms/qqbot/plugin.yaml` | Manifest: `qqbot-platform`. |
| `plugins/platforms/raft/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/raft/adapter.py` | Raft: a **content-free wake-channel** — the bridge sends only a wake hint and "the adapter never touches message bodies or delivery cursors"; the agent reads and sends through the Raft CLI. |
| `plugins/platforms/raft/plugin.yaml` | Manifest: `raft-platform` (requires `RAFT_PROFILE`). |
| `plugins/platforms/signal/__init__.py` | `from plugins.platforms.signal.register import register`. |
| `plugins/platforms/signal/adapter.py` | Signal via a `signal-cli` daemon in HTTP mode: SSE inbound, JSON-RPC outbound, DMs, allowlisted groups, attachments, reactions. |
| `plugins/platforms/signal/gateway_env.py` | The env bridge. |
| `plugins/platforms/signal/register.py` | The configured/validate checks and the registration. |
| `plugins/platforms/signal/setup.py` | The interactive setup wizard. |
| `plugins/platforms/signal/signal_format.py` | Markdown → Signal native formatting (UTF-16 length, bullet normalisation, table fencing). |
| `plugins/platforms/signal/signal_rate_limit.py` | A **process-wide token-bucket simulator** of Signal's per-account attachment rate limit, with a retry-after parser. |
| `plugins/platforms/signal/standalone.py` | The out-of-process send (cron / `hermes send`). |
| `plugins/platforms/signal/plugin.yaml` | Manifest: `signal-platform`; "phone numbers are treated as PII in logs". |
| `plugins/platforms/simplex/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/simplex/adapter.py` | SimpleX: a persistent WebSocket to a `simplex-chat` daemon, opaque contact IDs, an allowlist warning, and a text-batching delay. |
| `plugins/platforms/simplex/plugin.yaml` | Manifest: `simplex-platform` v1.1.0. |
| `plugins/platforms/slack/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/slack/adapter.py` | Slack (373 KB): slack-bolt Socket Mode, messages, slash commands, threads, approval blocks, free-response channels, channel skill bindings. |
| `plugins/platforms/slack/adapter_hint.py` | The platform hint. |
| `plugins/platforms/slack/adapter_slash_lane.py` | A **per-session handoff order** for slash commands. |
| `plugins/platforms/slack/adapter_slash_payload.py` | Slash-command payload decoding: the gateway text and the thread anchor. |
| `plugins/platforms/slack/block_kit.py` | Agent markdown → Block Kit blocks (lists, tables, quotes, preformatted, rich text). |
| `plugins/platforms/slack/dashboard_card.py` | The Channels-page card. |
| `plugins/platforms/slack/gateway_env.py` | The env bridge. |
| `plugins/platforms/slack/send_targets.py` | The `send_message` declarations. |
| `plugins/platforms/slack/plugin.yaml` | Manifest: `slack-platform`. |
| `plugins/platforms/sms/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/sms/adapter.py` | SMS via Twilio: the REST API + an inbound webhook, TwiML responses, markdown stripped to plain text. |
| `plugins/platforms/sms/gateway_env.py` | The env bridge. |
| `plugins/platforms/sms/plugin.yaml` | Manifest: `sms-platform`. |
| `plugins/platforms/teams/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/teams/adapter.py` | Microsoft Teams: the Bot Framework SDK, an aiohttp bridge, an aiohttp-vs-HTTPS host allowlist, Adaptive Card approval prompts. |
| `plugins/platforms/teams/summary_writer.py` | The pipeline-facing Teams outbound delivery (the meeting-summary writer). |
| `plugins/platforms/teams/plugin.yaml` | Manifest: `teams-platform`. |
| `plugins/platforms/telegram/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/telegram/adapter.py` | Telegram (442 KB): python-telegram-bot, inbound media, commands, outbound replies, streaming edits, flood caps. |
| `plugins/platforms/telegram/adapter_hint.py` | The platform hint. |
| `plugins/platforms/telegram/dashboard_card.py` | The Channels-page card. |
| `plugins/platforms/telegram/gateway_env.py` | The env bridge (with the fallback-IP list). |
| `plugins/platforms/telegram/inline_picker.py` | An inline command picker — searchable access to **every** command and skill. |
| `plugins/platforms/telegram/telegram_context.py` | Group addressing helpers: does the message mention other participants, the group trigger text, the group identity prompt. |
| `plugins/platforms/telegram/telegram_entities.py` | `text_link` expansion with UTF-16-correct offsets. |
| `plugins/platforms/telegram/telegram_held_inbound.py` | The **held-inbound queue**: events PTB already acked that cannot dispatch yet are held until they can. |
| `plugins/platforms/telegram/telegram_ids.py` | Chat-id normalisation (`@username` vs numeric id) and send-target parsing. |
| `plugins/platforms/telegram/telegram_network.py` | A hostname-preserving fallback transport: Host + SNI stay, the address is rewritten, DoH is used to resolve fallback IPs, and retryable connect errors are classified. |
| `plugins/platforms/telegram/telegram_topic_routing.py` | Routes a client-created DM topic's thread-less opener into that topic. |
| `plugins/platforms/telegram/telegram_topic_transfer.py` | An opt-in root-DM → fresh-topic transfer. |
| `plugins/platforms/telegram/update_admission.py` | Admission before every PTB handler group, with a **durable receipt file** so a crash does not re-admit or drop an update. |
| `plugins/platforms/telegram/plugin.yaml` | Manifest: `telegram-platform`. |
| `plugins/platforms/wecom/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/wecom/adapter.py` | WeCom Smart Robot over the `openws` WebSocket gateway, with a QR scan for bot info. |
| `plugins/platforms/wecom/callback_adapter.py` | WeCom callback mode: decrypt the POSTed XML, queue it, **ack immediately**. |
| `plugins/platforms/wecom/gateway_env.py` | The env bridge (bot + callback sibling). |
| `plugins/platforms/wecom/media.py` | Inbound attachment caching + outbound chunked `aibot_upload_media_*` uploads. |
| `plugins/platforms/wecom/send_queue.py` | Per-chat FIFO send queues + a token bucket for WeCom's 30 msgs/min/chat limit. |
| `plugins/platforms/wecom/streaming.py` | WeCom native streaming (`msgtype: stream`): per-turn state, per-request-id reply queues, an expiry error. |
| `plugins/platforms/wecom/wecom_crypto.py` | WeCom callback AES-CBC crypto, wire-compatible with Tencent's `WXBizMsgCrypt`. |
| `plugins/platforms/wecom/plugin.yaml` | Manifest: `wecom-platform` (registers two platforms). |
| `plugins/platforms/weixin/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/weixin/adapter.py` | Weixin (personal WeChat) over the iLink Bot API: long-poll `getupdates`, per-peer `context_token` echo, AES-128-ECB media through the CDN, session-expiry detection. |
| `plugins/platforms/weixin/gateway_env.py` | The env bridge. |
| `plugins/platforms/weixin/plugin.yaml` | Manifest: `weixin-platform` (pairing/open/allowlist DM policy; group policy defaults to disabled). |
| `plugins/platforms/whatsapp/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/whatsapp/adapter.py` | WhatsApp via a **Baileys Node bridge**: a pidfile-owned bridge process with stale-process reaping and port-ownership checks. |
| `plugins/platforms/whatsapp/bridge_ownership.py` | Non-destructive bridge allocation for multiplexed secondary profiles. |
| `plugins/platforms/whatsapp/gateway_env.py` | The env bridge. |
| `plugins/platforms/whatsapp/plugin.yaml` | Manifest: `whatsapp-platform`. |
| `plugins/platforms/whatsapp_cloud/__init__.py` | `from .adapter import register`. |
| `plugins/platforms/whatsapp_cloud/adapter.py` | WhatsApp Cloud API: the Graph API outbound, an aiohttp webhook with `X-Hub-Signature-256` verification, interactive buttons, DM policies. |
| `plugins/platforms/whatsapp_cloud/gateway_env.py` | The env bridge. |
| `plugins/platforms/whatsapp_cloud/setup_wizard.py` | The six-credential setup wizard with per-field validators. |
| `plugins/platforms/whatsapp_cloud/plugin.yaml` | Manifest: `whatsapp_cloud-platform`. |
| `plugins/platforms/yuanbao/__init__.py` | `from plugins.platforms.yuanbao.register import register`. |
| `plugins/platforms/yuanbao/adapter.py` | Yuanbao: a persistent WebSocket gateway (AUTH_BIND, ping/pong, reconnect), a **middleware pipeline** (decode → extract fields → dedupe → recall guard), and a Markdown processor. |
| `plugins/platforms/yuanbao/gateway_env.py` | The env bridge. |
| `plugins/platforms/yuanbao/register.py` | The registry entry, the standalone sender and the send-target parser. |
| `plugins/platforms/yuanbao/yuanbao_media.py` | Image format sniffing (PNG/JPEG/GIF/WebP size parsing), file ids and an HMAC-SHA1 signature. |
| `plugins/platforms/yuanbao/yuanbao_proto.py` | A **hand-written protobuf wire-format codec** (no `google.protobuf` dependency). |
| `plugins/platforms/yuanbao/yuanbao_sticker.py` | Sticker search with a bigram-Jaccard / longest-subsequence similarity scorer. |
| `plugins/platforms/yuanbao/plugin.yaml` | Manifest: `yuanbao-platform`. |

### Tier 3 — skipped with a reason

| File | Why not read line by line |
| --- | --- |
| `plugins/hermes-achievements/dashboard/dist/index.js` | **Generated bundle** (47 KB) — a compiled dashboard plugin. Size and the head were confirmed on disk; it is the minified output of the plugin's own frontend, not source. |
| `plugins/hermes-achievements/dashboard/dist/style.css` | **Generated bundle** (18 KB) — the compiled stylesheet; one rule (`ha-card:hover`) was inspected via the test file, which asserts it does not move the click target. |
| `plugins/hermes-achievements/docs/assets/achievements-dashboard-hd.png` | **Binary asset** (1.4 MB PNG) — a screenshot; confirmed on disk, not decoded. |
| `plugins/hermes-achievements/docs/assets/achievements-tier-showcase-hd.png` | **Binary asset** (1.4 MB PNG) — a screenshot; confirmed on disk, not decoded. |
| `plugins/kanban/dashboard/dist/index.js` | **Generated bundle** (210 KB) — a compiled dashboard plugin. |
| `plugins/kanban/dashboard/dist/style.css` | **Generated bundle** (46 KB) — the compiled stylesheet. |
| `plugins/platforms/photon/sidecar/package-lock.json` | **Generated lockfile** (55 KB) — the committed npm lockfile. The dependency set and integrity hashes were confirmed by reading the head; the lockfile was not read line by line. |

## 2. Ideas worth stealing

> **Convergence note.** This shard covers `hermes-agent` only. A `CONVERGENT` mark requires evidence from the `pi` and `deepseek-harness` shards, which I did not read; I therefore mark items `UNIQUE` (this repo is the only place in this shard with the pattern) and flag the few that are likely shared with `(check other shards)`.

1. **A scheduled job that can be handed to an external scheduler, with idempotent re-arming** — the agent computes each job's next-fire time, asks an external service to arm *one* one-shot, and the service calls back. `dedup_key=(job_id, fire_at)` makes re-arming the same fire a no-op, and `reconcile()` is convergent: it arms what is missing and **cancels orphans** (observed − desired). `plugins/cron_providers/chronos/__init__.py:111`, `:103`. **Why it transfers:** August Trading's automation scheduler can push a job's next-fire time to a cloud trigger service (or a local `setTimeout` with a durable journal) and still stay idempotent across restarts and duplicate deliveries. `UNIQUE`.
2. **A deterministic, non-recoverable failure gets a working fallback instead of a retry loop.** A `403 invalid_client` from the scheduler service is *proven* non-transient ("re-logging in cannot fix it"), so the provider hands the process's fires to the built-in ticker and keeps jobs on time instead of misfiring. `plugins/cron_providers/chronos/__init__.py:116`. **Why it transfers:** an automation whose auth has been revoked should degrade to the in-process scheduler, not silently stop firing — exactly the shape of August's "automation stopped" incident class. `UNIQUE`.
3. **A pattern scanner that warns first and blocks on demand.** 25 regex/substring rules matched against the content the agent is about to write; the file is still written, and the warning rides back in the tool result so the model self-corrects on the next turn. `plugins/security-guidance/__init__.py:115`, `:106`. Blocking is an env-var opt-in, and the kill switch is a separate var. **Why it transfers:** August Trading could apply the same shape to trade-plan payloads and notebook writes (e.g. an unbounded `max_tokens`, a non-atomic ledger write, a `Promise.all` over an unbounded symbol list) without ever refusing a legitimate write. `UNIQUE`.
4. **"Proof of creation" for cleanup.** A file is only eligible for automatic deletion if the *same tool call's* pre-hook snapshot saw the path absent before the call and the path exists after it. `plugins/disk-cleanup/__init__.py:78`, `:97`. A path seen only in a tool's *output* (an `ls` listing) is never tracked. **Why it transfers:** the same shape works for "delete this scratch file" tooling in August Trading — never delete a file you cannot prove you created. `UNIQUE`.
5. **Re-validate a stored category at deletion time, and protect the control plane by exact path.** A stale `tracked.json` entry is re-classified before it is deleted, and `cron/`, `cron/output/`'s root, `jobs.json` and `.tick.lock` are protected by exact path — "never widen to everything under `cron/output/`", because run artifacts there are disposable but wholesale deletion of `output/` is fatal. `plugins/disk-cleanup/disk_cleanup.py:158`, `:121`, `:409`. **Why it transfers:** the same rule protects August Trading's `automation/history` and `services/automation` registries from a mis-categorised sweep. `UNIQUE`.
6. **A crash-replaying write-behind queue for anything that leaves the process.** A SQLite `pending` table; the writer thread deletes the row only after the remote call succeeds, records `last_error` and retries, and **replays up to 200 leftover rows on startup**. `plugins/memory/retaindb/__init__.py:184`, `:197`. **Why it transfers:** this is the exact shape for August Trading's trade-log writes, automation-run records and any provider call that must not be lost when the renderer is closed mid-write. `UNIQUE`.
7. **A persisted unlock state that is a *floor*, never a ceiling.** A badge earned on evidence that compaction later removed must not flicker back to locked; the persisted `state.json` is read and re-applied, and partial (in-flight) snapshots read it too so an earned badge does not render as locked for the duration of a rescan. `plugins/hermes-achievements/dashboard/plugin_api.py:713`, `:730`. **Why it transfers:** the same monotonic rule should protect August Trading's "this trade/plan was already reviewed/settled" markers, so a compaction or a re-scan cannot make a settled decision look pending. `UNIQUE`.
8. **A metrics engine over the session log with a checkpointed incremental scan.** A per-session fingerprint (`started_at`, `last_active`, `model`, `title`) decides reuse vs re-analysis; the checkpoint schema version forces one full rescan when the scan semantics change. `plugins/hermes-achievements/dashboard/plugin_api.py:547`, `:144`. **Why it transfers:** August Trading could compute per-session/per-day trading-discipline metrics (plan adherence, R:R discipline, override frequency) over its conversation log the same way — cheap warm loads, one honest rescan when the definition changes. `UNIQUE`.
9. **Reasoning-effort clamping from a *live catalog*, cached per credential, never on the hot path.** The provider asks the vendor's `/v1/models` what effort levels each model accepts, clamps to the nearest weaker level, and caches the answer in memory plus a disk mirror refreshed by a background warmer (`contextvars.copy_context()` so the warmer uses the right profile's key). `plugins/model-providers/router/__init__.py:233`, `:277`; `plugins/model-providers/openrouter/__init__.py:64`. **Why it transfers:** August Trading's provider layer could clamp *its* own knobs (thinking tier, token budget) to what the selected model actually supports instead of guessing. `UNIQUE`.
10. **A "no token ⇒ localhost only" bind rule plus a fail-closed trust gate.** A credential alone never widens the bind; a network-exposed bind with no allow-list and no allow-all refuses *every* peer; the identity comes from the credential, never from the request body. `plugins/platforms/a2a/security.py:82`, `:111`. **Why it transfers:** the same rule protects any August Trading surface that could be reached from outside (a local API, a webhook receiver for broker alerts). `UNIQUE`.
11. **Neutralise prompt-injection markers instead of rejecting the message, but frame every inbound message as untrusted.** `plugins/platforms/a2a/security.py:167`. A task that merely *mentions* `ignore previous instructions` still gets through (as `[filtered]`), and every inbound message carries a privacy prefix — including `/`-prefixed text, so a remote peer can never reach an operator command. **Why it transfers:** the same framing rule applies to any content August ingests from outside (a broker API field, a pasted news item, a fetched web page). `UNIQUE`.
12. **A cap on agent-to-agent turn ping-pong, and a task store that keeps terminal tasks.** A per-context turn cap (default 5, hard max 20) rejects a runaway exchange; terminal tasks stay queryable (bounded to 500) so a late reader still gets an answer; an orphan watchdog fails stale tasks idempotently. `plugins/platforms/a2a/protocol.py:235`, `:305`, `:425`. **Why it transfers:** August Trading's multi-agent rounds (and any "agent asks agent" loop) need a hard turn cap and a terminal-but-retrievable record. `UNIQUE`.
13. **A round-robin provider ring with rate-limit-shaped failover.** Four free-tier search vendors; the cursor advances per unpinned request; a failure advances to the next vendor **only** when the error is rate-limit-shaped (a malformed query fails everywhere, so it stops the walk); the answer records `served_by` when a different vendor answered. `plugins/web/keyless_mcp.py:340`, `:365`, `:383`, `:398`. **Why it transfers:** August Trading's market-data or LLM providers could share one failover ring with one "which vendor actually answered" field. `UNIQUE` (the *ring* shape is common; the detection of "rate-limit-shaped vs not" is the transfer).
14. **A "best" mode that is deliberately coarse, and an all-error fan-out that reports the failures instead of picking one.** `plugins/platforms/a2a/tools.py` (`a2a_orchestrate`). **Why it transfers:** if August Trading ever fans a question out over several analyst roles, "longest answer wins" is a bad tie-break and "all failed" must say so. `UNIQUE`.
15. **A status transition as a *verb with preconditions*, not a column write.** Dragging a card to `done` calls `complete_task(..., force=True)` ("a dashboard action is a human override of a live worker claim"); `running` is refused from the dashboard; a refused transition's 409 **names the blocking parents** so the UI can render an actionable toast. `plugins/kanban/dashboard/plugin_api.py:594`, `:638`, `:579`. **Why it transfers:** August Trading's "approve / reject / cancel an automation" should be domain verbs with preconditions and a 409 that names the blocking condition, not a status column. `UNIQUE`.
16. **A durable, idempotent, replayable job record with a terminal-state store.** A Graph notification's receipt key is its id, or the sha256 of its canonical JSON; the receipt is recorded once and a duplicate returns `False`; a job moves through named states and each transition is persisted. `plugins/teams_pipeline/store.py:98`, `:104`, `:21`; `plugins/teams_pipeline/pipeline.py:192`. **Why it transfers:** this is a ready-made design for August Trading's automation runs: a dedupe key, a state machine, a persisted error, and a replay command. `UNIQUE`.
17. **A quality gate that falls back to a heuristic instead of failing.** The LLM summary is parsed, and if it is unavailable a deterministic heuristic summary is produced with `confidence: low` and a note saying so. `plugins/teams_pipeline/pipeline.py:481`. **Why it transfers:** August Trading's post-trade summariser should degrade to a deterministic, clearly-labelled-low-confidence summary rather than dropping the record. `UNIQUE`.
18. **A transcript-first pipeline with an explicit fallback ladder and a minimum-substance threshold.** Prefer the cheap artifact; treat it as absent if it is under a substance floor; fall back to the expensive one; the fallback is *opt-out*. `plugins/teams_pipeline/pipeline.py:268`. **Why it transfers:** the same ladder (cheap summary → cached summary → recompute) belongs on any August Trading analysis path that can be expensive. `UNIQUE`.
19. **A model-selection chain with a declared per-model capability table, and a clamp to the model's real limits.** `plugins/video_gen/openrouter/__init__.py:73` (nearest-value clamp by duration/resolution-height/ratio), `plugins/image_gen/_common.py:71` (known-id-wins precedence), `plugins/image_gen/openrouter/__init__.py` (a per-model knob table that *drops* what a model does not declare, because the endpoint silently ignores unknown parameters). **Why it transfers:** August Trading's chart/indicator or provider selection should clamp to what the selected model actually supports and *report* what came back. `UNIQUE`.
20. **An HTTP failure taxonomy that distinguishes "never connected" from "dropped after connecting".** `plugins/image_gen/_common.py:241`, `:284`. Only the first proves the server accepted nothing — which is exactly the condition under which a *fallback* is safe. **Why it transfers:** August Trading's provider fallback should be allowed only when nothing was billed or accepted. `UNIQUE`.
21. **An interceptor that neutralises, never blocks, and says what the alternatives are.** `plugins/web/_common.py:105`; the failure message names the env var and the signup URL and offers "another web backend". **Why it transfers:** every August Trading provider error should name the fix, not just the failure. `UNIQUE`.
22. **A key that is cached *with* its client, as one value.** `plugins/web/_common.py:181` — the key is resolved before the cache is consulted, and `(key, client)` is stored as a pair, "so concurrent builds under different keys can never leave one key recorded beside another key's client". **Why it transfers:** August Trading's provider config can change mid-session (the user edits the key in Settings); this pattern makes the cache key-safe. `UNIQUE`.
23. **A "first config wins" lazy singleton that never caches a failed build.** `plugins/plugin_utils.py` (`SingletonSlot.get`). The factory runs at most once under concurrent first calls; if it raises, nothing is cached and the next call retries. **Why it transfers:** a direct fix for the classic "two components each build a client, the second leaks the first's connection" bug. `UNIQUE`.
24. **A loader that detects a cross-thread import deadlock and bounds a per-turn wait.** `plugins/plugin_loader.py:42`, `:57`, `:27`. A bounded wait (10 s) means one hung plugin import cannot stall a turn; the module is then marked *stalled* and later bounded callers refuse at once. **Why it transfers:** August Trading's provider init should never be able to hang a turn. `UNIQUE`.
25. **A clock-skew tolerance that fails *closed*.** `plugins/dashboard_auth/_shared.py:59` — an unparseable / negative / NaN / inf leeway falls back to `0.0`, "so a typo can only ever *lose* tolerance, never widen the window". **Why it transfers:** every configurable numeric guard in August Trading should fail toward the stricter side. `UNIQUE`.
26. **A secret gate with three independent measures and a fail-closed endpoint.** Length, distinct-character count and Shannon entropy, checked twice (at registration and in the constructor), and a weak secret leaves the endpoint **disabled** rather than degraded. `plugins/dashboard_auth/drain/__init__.py:48`, `:31`. **Why it transfers:** the same gate suits any August Trading broker API key. `UNIQUE`.
27. **A retrieval query that is validated, not trusted.** The rewritten query must start with a question word, must be grounded in the user's history, must not leak instructions, and must be a single sentence under 320 characters — otherwise it is discarded and the raw message is used. `plugins/memory/query_rewrite.py:69`, `:25`. **Why it transfers:** August Trading's "recall my past setups" search should validate the query the same way. `UNIQUE`.
28. **A hold-then-redispatch queue for inbound events the platform already acked.** `plugins/platforms/telegram/telegram_held_inbound.py:38` — an event that cannot dispatch *yet* is held and redispatched later, rather than dropped or double-acked. **Why it transfers:** the same shape applies to any inbound that arrives before its session is ready. `UNIQUE`.
29. **A watchdog whose "inconclusive" result never degrades anything.** Silence alone never degrades the stream; a probe that resolves (or fails with a not-found) proves the channel is alive; anything else is inconclusive and changes nothing. `plugins/platforms/photon/sidecar/stream-staleness.mjs:42`, `:82`. **Why it transfers:** August Trading's "is the market-data feed alive?" check should have three outcomes, not two. `UNIQUE`.
30. **A patch of a vendored dependency that fails loudly and no-ops when upstream fixes it.** `plugins/platforms/photon/sidecar/patch-spectrum-mixed-attachments.mjs` — exact-match anchors, a marker comment, a re-entrancy guard, and an explicit "upstream preserves mixed payloads" exit. **Why it transfers:** the right way to carry a local fix for an upstream bug. `UNIQUE`.
31. **A convention that "internal import paths are not API" and old paths now raise.** `plugins/AGENTS.md`. **Why it transfers:** August Trading's own `docs/plan/` discipline. `UNIQUE` (check other shards).
32. **A feature-count brake stated as a rule: "a hook with no concrete consumer is speculative infrastructure and is rejected."** `plugins/AGENTS.md`. **Why it transfers:** the direct answer to "how do you stop the feature count becoming the product". `UNIQUE`.

## 3. Trading-specific findings

**Long-lived monitoring & scheduled work.** This shard's answer is the Chronos provider plus the disk-cleanup cron protections. A scheduled job is armed as **one external one-shot** with an idempotency key, reconciled convergently (arm missing, cancel orphans), and re-armed after it fires (`plugins/cron_providers/chronos/__init__.py:111`, `:146`). Recovery is explicit: `recover_interrupted()` classifies an interrupted process as *unknown* and never requeues. The breaker analogue is the **identity-rejection fallback** — a proven-non-transient auth failure hands the fires to the in-process ticker instead of letting them misfire (`:116`). Idempotency is the receipt-key pattern (`plugins/teams_pipeline/store.py:98`). There is **no** "three empty runs → disable" breaker in this shard; the closest is disk-cleanup's category-threshold table (`test` at session end, `temp` > 7 d, `cron-output` > 14 d, prompt-only for `research`/`chrome`/`large`) and the teams pipeline's `retry_scheduled` vs `failed` split (`plugins/teams_pipeline/pipeline.py:220`).

**Human-in-the-loop approval.** Two mechanisms appear. (1) The **A2A trust gate**: a network-exposed bind with no allow-list refuses every peer, the identity is the credential, and the decision is per-identity (`plugins/platforms/a2a/security.py:111`). (2) The **dashboard override as a distinct authority**: `done` and `review` pass `force=True` because "a dashboard action is a human override of a live worker claim" (`plugins/kanban/dashboard/plugin_api.py:594`), while `running` is refused outright, and a refused transition's 409 names the blocking parents. The approval *record* is the `task_events` table (an append-only event per transition) plus the `tasks`/`task_runs` rows; the A2A equivalent is the append-only `a2a_audit.jsonl` (`plugins/platforms/a2a/security.py`, `audit()`). The QQ adapter builds **explicit approval keyboards** whose button payload is parsed back into a decision (`plugins/platforms/qqbot/keyboards.py:80`, `:99`).

**Post-mortem / reflection loops that turn outcomes into new rules.** The closest thing here is the achievements engine: a session log is mined into 40+ metrics, evaluated against a tiered ladder, and the *unlock state is persisted as a floor* so an earned badge never flickers back (`plugins/hermes-achievements/dashboard/plugin_api.py:713`, `:730`). What stops bad rules accumulating is **not** present: there is no expiry, no retirement and no consolidation for badges; the only bounds are the metric thresholds and the fact that removal is explicit (the test asserts three "noisy" achievements were removed from the catalog). The teams pipeline's `confidence` + `confidence_notes` fields are the other reflection primitive — the pipeline is *honest about its own uncertainty* rather than silently confident (`plugins/teams_pipeline/pipeline.py:481`).

**Multi-agent.** Two architectures coexist. (a) **Sub-agents inside one session** — the Kanban board: a dispatcher claims tasks, workers run them, `task_runs` records each attempt, `task_events` is the append-only trace, and a watchdog fails orphans (`plugins/platforms/a2a/protocol.py:425` is the A2A twin; `plugins/kanban/dashboard/plugin_api.py:742` is the Kanban one). (b) **Peer agents over a protocol** — A2A v1.0: a live-session injection so the answering agent is the *same* one serving the user (full memory, not a clone), a per-context FIFO so concurrent same-context requests cannot cross-talk, a turn cap to stop ping-pong, and an outbound fan-out whose "best" mode is deliberately coarse. **Where debate adds value over one agent, per this shard:** the fan-out modes `all` / `first` / `best` (`plugins/platforms/a2a/tools.py`) — `all` for the model to judge, `first` to stop early on a good answer, `best` as a coarse fallback. **Where it is wasted:** the toolset is **config-gated** precisely because "every session on every install paid ~561 tok/call for tools whose only possible output without config is 'no peers configured'" — the repo's own measurement of debate's cost when it is not wanted.

**Structured logs the model can query.** The answer here is deliberately **no database**: a JSONL file per conversation. A2A conversations are appended to `~/.hermes/a2a_conversations/<context>.jsonl` — **outside the context-compaction pipeline**, so "compaction and restarts can't lose them" — and `a2a_history` recalls them by context id (`plugins/platforms/a2a/protocol.py`, `persist_message()` / `load_conversation()`). The audit log is the same shape (`a2a_audit.jsonl`, one JSON object per line). Elsewhere: the teams pipeline uses a **JSON store with five named buckets** and an atomic temp-file replace (`plugins/teams_pipeline/store.py:21`), and disk-cleanup uses an atomic `tracked.json` with a `.bak` restore on corruption. The only SQLite in the shard is the Kanban board's `kanban_db` and the RetainDB write queue.

**Staying simple as features accumulate.** Three explicit brakes. (1) *"A hook with no concrete consumer is speculative infrastructure and is rejected"* (`plugins/AGENTS.md`). (2) **The in-tree tree is closed** — "No new in-tree memory providers (May 2026)… `plugins/memory/` is closed"; new backends ship as standalone repos through a catalog with a **mandatory 40-hex SHA pin** and a **kill list** (`removed.yaml`) that every install path refuses, compared by canonical `host/owner/repo` so `git@`/`ssh://`/`www.` spellings match. (3) **The toolset is gated on configuration** — the A2A tools cost 561 tok/call when unused, so they only register when a peer is configured. The counter-pressure is visible too: 27 platform adapters, each a self-contained plugin, which is the "features become the product" risk the rules are trying to bound.

**What this shard does *not* answer for trading.** Entry/TP/SL detection, price-alert evaluation, broker order placement, and any indicator/strategy logic live outside `plugins/` — this shard is the harness surface, not the trading surface. The closest trading-shaped objects are the **trade-plan validation shapes** (a plan is a closed set of fields, an invalid one is refused with a named reason — e.g. the A2A `TaskStore` scope rule and the Kanban status verb) and the **plan/risk gating** vocabulary in the model-provider profiles (`unsupported_response_formats`, per-model effort ladders, `max_tokens` caps).

## 4. Non-obvious decisions and gotchas

1. **The memory-provider precedence is the *reverse* of the general plugin manager.** Bundled wins, then user, project, entry point. A provider is activated *by name*, so a directory dropped into the working tree must never shadow a shipped one. Changing the order is a breaking change (`plugins/memory/__init__.py` header).
2. **`register()` that raises *after* registering must not cost the provider.** The registered instance is kept and the later registrations skipped — falling through to the subclass scan would hand back a bare second instance, "a silent downgrade that looks like success" (`plugins/memory/__init__.py`, `_load_provider_from_dir`).
3. **A config-schema load that fails is never cached** — caching it would pin an empty panel until restart (`plugins/memory/config_schema.py`).
4. **The plugin loader can detect its own deadlock.** importlib cannot see the loader's lock in its deadlock check, so `_load_would_deadlock()` walks both lock graphs and accepts a partially-built module the way importlib does; a bounded wait means a hung plugin import cannot stall a turn (`plugins/plugin_loader.py:42`).
5. **The discovery timing pitfall:** `discover_plugins()` runs only as a side effect of importing `model_tools.py`; any code that reads plugin state without that import must call it explicitly (`plugins/AGENTS.md`).
6. **A plugin that changes a default must add a migration guard** keyed on an "existing config" signal, so existing users keep the old default (`plugins/AGENTS.md`).
7. **Chronos deliberately has no `fire_due` override.** `provider_supports_split_fire` treats *any* override as the legacy single-phase signal, so adding one would silently opt it out of claim admission and cancel-aware drain (`plugins/cron_providers/chronos/__init__.py`).
8. **The Chronos `403 invalid_client` is deterministic** — a plain `hermes auth` re-login cannot fix it, which is what users try first (`plugins/cron_providers/chronos/__init__.py:116`).
9. **The drain secret's minimum length (43) is exactly `secrets.token_urlsafe(32)`** — the gate is calibrated to the generator, not to a round number (`plugins/dashboard_auth/drain/__init__.py`).
10. **Basic auth always hashes, even for an unknown username** (a module-level `_DUMMY_HASH`), and compares the username with `compare_digest` too, so neither the username nor its length leaks via timing (`plugins/dashboard_auth/basic/__init__.py`).
11. **The self-hosted OIDC discovery document is pinned by the URL that served it, not by its `issuer` field** — the field is attacker-controlled content and cannot prove provenance (`plugins/dashboard_auth/self_hosted/__init__.py`, `_fetch_discovery`).
12. **The OIDC `clock_skew` default is 60 s and 0 restores strict mode**; the *parse* fails closed to 0.0 on a typo (`plugins/dashboard_auth/_shared.py:59`).
13. **The security-guidance plugin warns by default and says so** — "the false-positive rate is mediocre but tolerable; the plugin is warn-by-default precisely because of that" (`plugins/security-guidance/README.md`).
14. **A rule with a raising path predicate is a non-match** — a broken rule can never block a write (`plugins/security-guidance/__init__.py`, `_rule_matches`).
15. **`eval(` uses a negative lookbehind** so `model.eval()` and `redis.eval()` do not trip it; the `torch.load` rule is suppressed by `weights_only=True` on the same line and the comment names the multi-line false positive as a known limitation (`plugins/security-guidance/patterns.py`).
16. **The disk-cleanup pre-hook fails closed** — an error records *no* absent path, so a broken snapshot can never make a pre-existing file look created (`plugins/disk-cleanup/__init__.py:78`).
17. **`tool_call_id` alone is not unique** (llama.cpp reuses one constant id), so the snapshot key is `(owner, tool_call_id)` (`plugins/disk-cleanup/__init__.py`).
18. **The Git-ownership probe asks git per candidate** (`ls-files --error-unmatch -- ':(literal)<name>'`) rather than caching an index, "so a file committed after first classification is seen immediately" (`plugins/disk-cleanup/disk_cleanup.py`, `_git_tracks`).
19. **The empty-dir sweep is iterative post-order and prunes `.git`/`node_modules`/`venv`** — "a full rglob over a checkout+venv under HERMES_HOME can stall the gateway loop for minutes" (`plugins/disk-cleanup/disk_cleanup.py:313`).
20. **The Meet bot scrapes captions with a `MutationObserver`** and *does not* touch WebRTC audio: "lossy and English-biased, but deterministic (no STT billing) and stable thanks to the ARIA role" (`plugins/google_meet/meet_bot.py:106`).
21. **The Meet bot's captions are de-duplicated by `(speaker, text)`** and its progress is counted in **bytes actually written** (`audio_bytes_out`), not a synthetic percentage (`plugins/google_meet/meet_bot.py:80`; `plugins/google_meet/realtime/openai_client.py`).
22. **The Meet `say` queue is rewritten under a cross-process lock** — "an agent-side append landing in between would be wiped by the rewrite" (`plugins/google_meet/_jsonfile.py`).
23. **The Meet bot resolves its realtime key in the parent at spawn time** — the detached child inherits env, not the profile secret scope (a contextvar) (`plugins/google_meet/process_manager.py:64`).
24. **The RetainDB prefetch is a three-job background fan-out** fired at turn end and consumed by the *next* turn; a failed fetch leaves the previous cached value untouched (`plugins/memory/retaindb/__init__.py:357`, `:396`).
25. **RetainDB's `_Client._with_fallback()` retries every memory route against the legacy URL shape on any error** — a permanently broken primary route is hidden behind a working legacy one (`plugins/memory/retaindb/__init__.py`).
26. **The A2A task store is scoped by `agent_slug`/`tenant`** — a reader outside the scope gets *not-found*, which is the spec's authz rule (`plugins/platforms/a2a/protocol.py:305`).
27. **A2A `build_task` accepts `created_at` but does not serialize it** — strict ProtoJSON parsers reject unknown fields (`plugins/platforms/a2a/protocol.py`).
28. **A2A's SSE closure is a comment** (`: done`), because `data: {}` makes JSON-RPC clients parse an empty envelope (`plugins/platforms/a2a/protocol.py`, `sse_done`).
29. **A2A's context id is derived from the message id** when a first message carries none, so a retried send reopens the same context (`plugins/platforms/a2a/protocol.py:131`).
30. **The web keyless ring's SSE parser splits only on the real line terminators** — `str.splitlines()` also breaks on U+0085/U+2028/U+2029, which legitimately occur in CJK page text (`plugins/web/keyless_mcp.py`).
31. **`cached_sdk_client` stores `(key, client)` as one value** so a rotated key can never sit beside another key's client (`plugins/web/_common.py:181`).
32. **The DDGS provider runs every search in a disposable child process** because the native library can hold the GIL — a thread-pool timeout "can never fire" and Ctrl+C freezes the process (`plugins/web/ddgs/provider.py`).
33. **The Kanban event stream captures the tail at accept, before the first wait** — a missing cursor must not mean 0, or every board open is a refetch storm (`plugins/kanban/dashboard/plugin_api.py:1700`).
34. **The Kanban board is pinned context-locally**, never through the process-global `HERMES_KANBAN_BOARD` env var, because concurrent requests for different boards would cross-write (`plugins/kanban/dashboard/plugin_api.py`, `_with_board_pinned`).
35. **The teams pipeline sanitizes the recording's `display_name`** (organizer-controlled Graph data) down to a basename and rejects `.`/`..` (`plugins/teams_pipeline/pipeline.py`).
36. **The teams pipeline's LLM summary has a deterministic fallback** with `confidence: low` — the pipeline prefers a low-confidence answer to no answer (`plugins/teams_pipeline/pipeline.py:481`).
37. **The Photon SDK patch fails loudly** when the upstream shape changes and exits "ok" when upstream already preserves the payload (`plugins/platforms/photon/sidecar/patch-spectrum-mixed-attachments.mjs`).

## 5. Weak spots

1. **The platform-adapter surface is enormous and mostly duplicated.** 27 adapter directories, ~2.6 MB, with several near-identical `gateway_env.py` / `send_targets.py` / `adapter_hint.py` / `dashboard_card.py` files per platform. The set is coherent (one shape, one manifest grammar), but a reader cannot tell which adapter is *maintained* and which is legacy — and the repo's own policy is that most of these should move out of tree, which they have not.
2. **The model-provider set encodes a large amount of vendor folklore as per-file code.** Forty profiles each carry a bespoke effort-mapping rule, and the rules disagree in small ways (one sends `thinking`, one sends `reasoning_effort`, one sends `verbosity`). A single declarative "capability table" plus a per-vendor adapter would remove most of it, and the `MetaAIProfile` comment ("whose emission is gated by a core host allowlist a third-party plugin must not edit") shows the abstraction is already leaking.
3. **The achievements engine measures agent *activity*, not agent *quality*.** The metrics are counts of tool calls, errors, file touches and mentions — "the number of times you did a thing" — and the badges reward more activity (`toolchain_maxxer`, `autonomous_avalanche`, `total_tool_calls` at 50 000). There is no outcome metric, so the engine cannot distinguish a disciplined session from a chaotic one. For a trading analogue this is the exact gap: counting actions is not measuring decisions.
4. **Almost nothing in this shard has a retry/backoff policy with a persisted attempt counter.** The teams pipeline has `retry_scheduled` as a *state* but no scheduler, no backoff and no attempt ceiling; the only real retry-with-backoff in the shard is the image-generation poll loop (2 s → 5 s, 180 s ceiling) and the Krea job poll. A long-lived trading automation would need that machinery and it is not here.
5. **Several provider wrappers swallow errors into a uniform "failed" string.** `run_search` / `run_extract` in `plugins/web/_common.py` classify every exception into one message, and the image providers return a dict rather than raising — good for a chat surface, bad for a system that needs to distinguish a credential failure from a rate limit from a timeout (the code that *can* distinguish them, `HttpFailure`, lives in only one of the two image helpers).
6. **The plugin tree's policy is excellent but its enforcement is documentary.** "Plugins never touch core", "a hook with no concrete consumer is rejected", "no new in-tree memory providers" — all of these are stated in `plugins/AGENTS.md` and none of them is a test. The repo does have a static isolation audit (`plugin_isolation_audit.py`), which covers the *host boundary* but not the tree-size policy.
7. **The A2A "true task abort" is not implemented** — `tasks/cancel` marks the task canceled and drops the reply but "cannot abort the live session's in-flight turn" (`plugins/platforms/a2a/DESIGN.md`, "Deliberately out of scope"). A cancelled-but-still-running agent is exactly the state a trading automation must not be able to reach.
8. **The keyless web ring is a free-tier workaround that is explicitly last in the resolution order**, and its failover detection is a regex over error text. It is the right shape, but the shape depends on free tiers remaining free — a product decision dressed as an architecture.

