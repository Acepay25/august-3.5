# hermes-agent :: hermes-tui-gateway

**Files in shard:** 119 (read line by line in full: 95, skipped with a stated reason: 24 — see §6)
**What this shard covers:** the `tui_gateway/` package of the Hermes agent — the Python JSON-RPC backend that sits behind the Ink (Node) TUI, the Electron desktop app and the web dashboard. It is the *transport and session* layer of the harness: the wire contract declared in Pydantic (`contracts/`), the method surface (`methods_*.py`), the session registry / lifecycle / reaper / compression machinery, the child-agent ("compute host" / "hosted room") isolation, the on-disk change watcher, and the cross-process plumbing (stdio JSON-RPC, WebSocket, `server_requests.py` approvals). Almost everything here is infrastructure *around* the agent loop rather than the loop itself, which is why the shard's most transferable ideas are about turn admission, event replay, permission scoping and process isolation rather than about prompting or analysis.

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `tui_gateway/__init__.py`
- **Purpose:** the package marker for `tui_gateway`.
- **Content:** **empty** — 0 bytes on disk, confirmed by a full read. Every submodule in this shard is imported by its own path (`from tui_gateway import server`, `from .method_ctx import bind_module`), so the package `__init__` deliberately exports nothing and does no import-time work: importing `tui_gateway.server` must not drag in the whole gateway.
- **Non-obvious design decision:** the *contract* package is the opposite — `tui_gateway/contracts/__init__.py` is the import hub whose explicit import list IS the catalogue (see its entry below). The two `__init__.py` files in the same shard therefore have opposite jobs, and both are deliberate.

### `tui_gateway/_env.py`
- **Purpose:** tolerant parsing of numeric env knobs for the gateway entry points.
- **Key abstractions:** `env_float(name, default)` (`:17`), `env_int(name, default)` (`:21`), over a private `_env_number(cast, name, default)` (`:10`).
- **Data flow:** `os.environ` → cast → value, or `default` on absent/empty/malformed.
- **Non-obvious design decision:** a bare `float(os.environ[...])` would raise at *import* on a typo (`..._POLL_S=2s`) and kill a worker before it serves a single command. The default is therefore applied on `TypeError`/`ValueError`, not just on absence.
- **Edge cases:** `""` is treated as absent (the `or default` in the `cast(...)` call), so an empty env var never becomes `0.0`.
- **Surprising:** tiny module, but it is the difference between "the TUI refuses to boot on a typo" and "the typo is ignored".

### `tui_gateway/_stdin_recovery.py`
- **Purpose:** recover the TUI gateway's stdio pipe from *spurious* EOF, which is an artifact of a child process setting `O_NONBLOCK` on a shared file description.
- **Key abstractions:** `handle_spurious_eof(recovery_times, log_fn) -> bool` (`:72`) returning "continue the read loop" vs "break"; `diagnose_stdin_state() -> str` (`:51`); `_stdin_sockopt(getter)` (`:34`) which `socket.fromfd(0, ...)` dups so the dup can be closed without touching fd 0.
- **Data flow:** empty `readline()` → POSIX `fcntl` check of `O_NONBLOCK` on fd 0 → if set, clear blocking mode **and** zero `SO_RCVTIMEO` (also shared) → continue.
- **Non-obvious design decision:** `O_NONBLOCK` and `SO_RCVTIMEO` live on the *open file description*, not the descriptor, so a child's `setsockopt` "launders" into the same failure; the recovery clears both. CPython's buffered `TextIOWrapper` converts `EAGAIN` into `b''` — an apparent EOF that does **not** stick, so the next `readline()` blocks correctly.
- **Edge cases & failure handling:** `MAX_RECOVERIES_PER_MINUTE = 10` (`:24`) — a child aggressively flipping the flag would otherwise create a tight busy-loop, so exceeding the cap exits and lets the parent respawn. Windows has no `fcntl`, so the guard reports a genuine EOF and lets the caller exit.
- **Surprising:** `socket.fromfd` on fd 0 is used purely as a portable way to reach `SO_RCVTIMEO`; the module is POSIX-only by design and degrades honestly elsewhere.

### `tui_gateway/connector_payload.py`
- **Purpose:** redact credentials from any connector payload before it goes on the wire, while preserving the authorization *links* a user must click.
- **Key abstractions:** one recursive function `connector_ui_payload(value)` that walks dicts/lists and leaves scalars to `redact_sensitive_text`.
- **Data flow:** connector object → per-key redaction (secret-ish key names, `authorization`/`proxy-authorization`/`cookie`/`set-cookie`/`credentials`) → `connect_url` preserved verbatim → strings force-redacted with URL credentials stripped.
- **Non-obvious design decision:** booleans are exempted from the key-name check — `isinstance(item, bool)` is tested *before* the keyword test, so a flag named `secret: True` is not turned into the string `"[REDACTED]"`.
- **Edge cases:** `connect_url` is allowed through untouched even though it contains a token, because the whole point is that the user can open it.

### `tui_gateway/connector_refusals.py`
- **Purpose:** the single table of refusal tuples `(code, ConnectorErrorReason, message)` shared by the legacy connector handler and the session authority's.
- **Key abstractions:** module-level constants (`INVALID_PARAMS`, `UNKNOWN_OPERATION`, `CONNECTORS_UNAVAILABLE`, `REQUEST_FAILED`, `REISSUE_REFUSED`), a `REISSUE_REFUSALS` dict keyed by the upstream connector reason, and `auth_refusal(exc)` (`:24`) mapping a `GatewayAuthError` to 4030/4032.
- **Data flow:** exception type → tuple of (numeric code, wire enum, human message) → the RPC layer renders it.
- **Non-obvious design decision:** the numeric codes are *shared with another transport* (the canonical gateway), so a refusal means the same thing on the legacy stdio wire and on the native `hermes-gateway-v1` transport.
- **Edge cases:** `LINK_STILL_VALID` is a distinct refusal ("reopen the stored link") rather than a generic failure, because the user has a working link and only needs to open it again.

### `tui_gateway/contracts/base.py`
- **Purpose:** the four Pydantic primitives every wire contract in this repo is built from.
- **Key abstractions:** `Params` (`extra="forbid"`, `:19`), `Result` (`:26`), `Payload` (`:34`), `WireEnum` (`:40`), and `JsonValue = Any` (`:14`) for the few places the contract is deliberately open.
- **Data flow:** Python model → `scripts/gen_gateway_contracts.py` → `apps/shared/src/gateway-contract.generated.ts` + `gateway-contract.openrpc.json`; a test regenerates in memory and diffs the committed files.
- **Non-obvious design decision:** `Result` is serialised with `exclude_none=False` so an explicit `null` stays a `null` on the wire — clients must be able to tell "absent" from "null". `Params` forbids unknown keys so a client bug answers `4000` instead of being silently ignored.
- **Edge cases:** `dict[str, Any]` is *banned* inside a contract; a shape must be declared or use `JsonValue`.
- **Surprising:** the modelling rules are written down in the module docstring (`:1-24`) as rules, not as prose — they exist so the *generated TypeScript* stays clean.

### `tui_gateway/contracts/__init__.py`
- **Purpose:** the registry-filling import hub for the contract package.
- **Key abstractions:** re-exports `CANONICAL_METHODS`, `EVENTS`, `METHODS`, `SERVER_REQUESTS` (`:31`) from `registry.py`, plus the base types (`:32`).
- **Data flow:** importing the package imports every topic module (`:5-26`), which is what populates the registry tables; the generator and the runtime therefore see the same catalog.
- **Non-obvious design decision:** the explicit import list is the *catalog*. A topic module not listed here is invisible to both the code generator and the runtime — a deliberate choke point rather than a convenience import.
- **Surprising:** `canonical` is imported separately (`:27`) rather than in the main tuple, because the canonical transport's catalog is a *different* wire and must not widen `RpcMethods`.

### `tui_gateway/checkpoints.py`
- **Purpose:** decide whether filesystem checkpointing is on for agents the TUI creates.
- **Key abstractions:** `resolve_checkpoints_enabled(cfg)` (`:32`) — env var first, then config; `_load_checkpoints_enabled(cfg)` (`:17`); `_resolve_checkpoint_hash(mgr, cwd, ref)` (`:46`) turning `/rollback 3` into a checkpoint hash.
- **Data flow:** `HERMES_TUI_CHECKPOINTS` env → `is_truthy_value` → else `config.yaml["checkpoints"]["enabled"]` → else `DEFAULT_CONFIG` default.
- **Non-obvious design decision:** the env var wins *when present* (even if it says "off"), because `hermes --tui --checkpoints` is an explicit opt-in. The bug this fixed (#79625): Desktop sessions never set that env var, so `checkpoints.enabled` in `config.yaml` was silently ignored.
- **Edge cases:** the legacy boolean form `checkpoints: true` is still accepted (`:24-25`); a malformed section falls back to the default rather than raising.

### `tui_gateway/billing_view.py`
- **Purpose:** serialize billing / usage / subscription state for the TUI RPC surface.
- **Key abstractions:** `_serialize_billing_state(state, *, free_tier_account=False)` (`:74`), `_serialize_billing_error(exc)` (`:22`), `_serialize_payment_method(pm)` (`:43`), `_serialize_usage_model(model)` (`:134`), `_serialize_subscription_state(state)` (`:153`), `_usage_payload(state)` (`:112`).
- **Data flow:** domain `BillingState`/`SubscriptionState` objects → wire dicts; Decimals become **strings** (`_wire_str`, `:17`) so no float rounding can corrupt money.
- **Non-obvious design decision:** errors are *structured envelopes* (`{"ok": false, "error": kind, ...}`), not JSON-RPC errors, so `rpc()` always resolves and the client branches on a typed billing code. A `free_tier_account` flag exists so the renderer can branch *before* `logged_in` — the free tier has no account and nothing to pay.
- **Edge cases:** `_usage_payload` is fail-open — any exception returns `{"available": False}` (`:118-119`) rather than breaking the account page.
- **Surprising:** `_serialize_payment_method` emits *only the fields that kind has* (`:46-56`) rather than a uniform shape with nulls, because a client testing `'brand' in pm` would otherwise read every Link method as a card.

### `tui_gateway/command_discovery.py`
- **Purpose:** build the slash-command catalog and the completions popup, with no dependency on the legacy server or the session runtime.
- **Key abstractions:** `command_catalog(load_cfg, module_loader, scope)` (`:206`); `slash_completions(text, scope)` (`:253`); the `_Catalog` accumulator (`:124`); `_rank_slash_completions(...)` (`:55`); `_details_completions(text)` (`:92`).
- **Data flow:** `hermes_cli.commands` registry → user `quick_commands` → plugin commands → skills → one catalog dict with `pairs`, `canon`, `commands`, `categories`, `skills`, `warning`, `plugin_discovery_error`.
- **Non-obvious design decisions:**
  - *Each discovery source is its own degrade boundary* (`:227-243`): a failing quick-command loader, plugin loader or skill loader must never blank the whole palette; each records a `warning` instead, and skills are always listed even if another loader failed.
  - *"Browsing" vs "searching" are different modes* (`:66-68`): a bare `/` prunes never-used bundled skills as noise; a typed query prunes nothing, it only reorders. The limit is spent **per kind** (`:79`) so a large install still offers skills.
  - *Registry commands keep their order; only skills reorder* (`:69-70`) — by fuzzy score, then usage count, then A–Z.
- **Edge cases:** `plugin_discovery_error` is a separate field from `warning` (`:247`) so a client can tell "no plugin commands" from "plugin commands unknown" without parsing prose. A `scope` that cannot bind an unknown profile raises out of here, and the caller maps it to error `4064`.
- **Surprising:** the `kind` of a completion ("skill" vs "command") is carried as **data** from the providers, never sniffed from the ⚡/▣ glyphs (`:268-269`).

### `tui_gateway/change_watcher.py`
- **Purpose:** one process-wide watcher thread that turns on-disk changes (sessions, projects, cron, skills, pairing, bot relay, skin, pet) into `*.changed` broadcast events — so clients never poll.
- **Key abstractions:** `_CHANGE_WATCHES` (`:378`) — event → (check interval, signature fn, payload fn); `_broadcast_watched_changes(now)` (`:402`); `_ensure_skin_watcher()` (`:431`); per-source signature functions (`_sessions_sig` `:278`, `_projects_sig` `:292`, `_pairing_sig` `:303`, `_skills_sig` `:364`, `_pet_sig` `:163`, `_bot_relay_outbox_sig` `:346`).
- **Data flow:** a 0.5 s loop → for each due watch, compute a cheap signature → compare with the stored one → broadcast on change. Each watch has its own interval (0.5 s–2 s) so the expensive probes stay off the fast tick.
- **Non-obvious design decisions:**
  - *First sighting seeds silently* (`:413-415`), so a gateway boot never fires a refresh storm.
  - *A "broadcast floor" coalesces bursts* (`:395`, `:418-420`): a floored change keeps its **old** signature so it re-fires later — the trailing edge is not lost, and `sessions.changed` is floored at 2 s, `platforms.changed` at 5 s.
  - *The sessions signal is a content digest, not a file mtime* (`:205-255`): `state.db` also carries `gateway_heartbeats`, which writes every minute, so an mtime would emit `sessions.changed` while no session changed (#98005). The watcher reads only 24 named session columns and hashes them with blake2b, and caches behind the DB/WAL mtime so the normal pass is stat-only.
  - *Racy-mtime handling* (`:267-276`): a digest read while the mtime is that fresh is cached under a key **no mtime equals**, so the next tick re-reads — the same "racily clean" rule git uses for its index.
  - *A locked/busy read keeps the last good digest* (`:249-252`) and leaves the cached mtime stale, so a re-read happens later rather than a double broadcast.
- **Edge cases:** a `state.db` with no readable `sessions` table falls back to an mtime signature (`:237-239`) so the sidebar still wakes up; `_pairing_roots` is cached on (home, `profiles/` dir mtime) with a 30 s TTL because the liveness probe costs ~14 stats per profile per tick.
- **Surprising:** the bot-relay outbox signature is **monotone** (`:343`, `:346-361`) — the newest mtime ever seen — because a drain empties the outbox, and a fall-back-to-`None` would fire a spurious pending event after every drain.

### `tui_gateway/agent_callbacks.py`
- **Purpose:** wire the agent's callbacks into the gateway's event stream; mirror delegated-child activity into the child's own window; rebuild/reset a session's agent.
- **Key abstractions:** `_agent_cbs(sid) -> dict` (`:141`) — the callback dict handed to `AIAgent`; `_mirror_subagent_to_child(event_type, payload, profile_home)` (`:38`); `_wire_callbacks(sid)` (`:224`); `_rebuild_session_agent(...)` (`:534`); `_reset_session_agent(...)` (`:600`); `_apply_personality_to_session(...)` (`:307`).
- **Data flow:** agent callback → `_emit(event_type, sid, payload)` → the transport. Child activity arrives as `subagent.*` events on the **parent** sid and is translated into native `message.delta` / `tool.start` / `tool.complete` events on the **child** sid.
- **Non-obvious design decisions:**
  - *Child state is keyed on `(profile_home, child_key)`* (`:21-25`) — stored ids are timestamps that exist in several profiles' stores, and a child runs under its *parent's* profile, so a bare-key hit let profile B's lazy resume bind to profile A's in-flight run (#120212).
  - *A card tool's `tool.complete` can never arrive without its `tool.start`* (`_tool_lifecycle_required_for_ui`, `agent_factory.py:493`): the same set is consulted by the start guard and the complete guard, so suppressing the lifecycle can never hide the turn's deliverable.
  - *A personality change never resets history* (`:307-336`): the ephemeral system prompt is updated in place so prompt-cache hits survive, plus a pivot marker appended with `role="user"` and `display_kind="personality_switch"` so strict providers accept it mid-conversation while the rewind-addressing space stays uncounted (an untagged marker makes every later rewind land one turn early and hard-delete the difference, #82756).
  - *Credential admission is fenced to a live runtime* (`:238-250`): the secret prompt resolves its owner from a `ContextVar` (`HERMES_UI_SESSION_ID`), and a request for a closed session is refused rather than parked for 300 s.
  - *A rebuild is not a conversation boundary* (`:552-557`): `/model`, `/reasoning` and `/fast` picks carry across an agent rebuild, but `/new` clears them (`:607-611`).
- **Edge cases:** `_side_agent_session_db` (`:433`) takes its **own registry reference** to the parent's store, because handing the parent's object across is not enough — the parent may release the last reference and tear the connection down under a still-running background turn. `_rebuild_session_agent` checks `session["_closing"]` after the build (`:575`) and closes the orphan agent if the session died mid-build.
- **Surprising:** `_preview_restart_history` (`:451`) distills the last 24 messages back to the last user turn and truncates tool results to 1200 chars, because the ephemeral preview-restart agent otherwise *guesses* the app, cwd and port from a bare URL.

### `tui_gateway/agent_factory.py`
- **Purpose:** everything needed to construct an `AIAgent` for a TUI/Desktop session — model/provider resolution, fallback chain, toolsets, prompts, display prefs.
- **Key abstractions:** `_make_agent(...)` (`:625`); `_resolve_agent_model_runtime(model_override, provider_override)` (`:540`); `_resolve_runtime_with_fallback(resolve_kwargs)` (`:507`); `_load_enabled_toolsets(platform)` (`:390`); `_load_disabled_toolsets()` (`:443`); `_stored_session_runtime_overrides(row)` (`:120`); `_runtime_model_config(agent, existing)` (`:182`); `_startup_system_prompt(cfg, task_id)` (`:605`).
- **Data flow:** env seed → config → resolved runtime dict → `AIAgent(...)`; a session's persisted `model_config` JSON is the restore path, and the live agent's identity is written back into it.
- **Non-obvious design decisions:**
  - *Provider-only fallback entries are skipped* (`:514-518`) so an unavailable primary model can never leak into a different runtime — a fallback must be a **complete** provider+model pair.
  - *A fallback is announced, not silent* (`:571-580`): the pre-agent fallback notice rides on the agent's one-shot notice so the user learns which provider actually answered.
  - *`api_mode`/`base_url` are re-derived per model* (`_rederive_per_model_route`, `:590`) because some providers pick the wire per model; a resumed session otherwise keeps the previous model's route (#96066).
  - *An explicitly empty toolset list means ZERO tools, not "all"* (`:437-441`): `_get_platform_tools` returning nothing because `platform_toolsets.cli: []` was explicitly saved is a deliberate zero-tool state, while only an *absent* key keeps the "no restriction" default (#82010). The client-surface fold-in must not resurrect what the user switched off.
  - *Disabled toolsets are subtracted from the fold-in too* (`:337-341`) — otherwise `disabled_toolsets: [project]` is a no-op on exactly the surfaces where the client toolsets exist (#54433).
  - *The fallback chain is re-read fail-closed at turn start* (`_sync_agent_fallback_with_config`, `agent_callbacks.py:370`): a torn `config.yaml` keeps the agent's last known-good chain instead of a fail-open `{}` reading as "chain removed".
  - *Falsy runtime attributes DELETE the persisted key* (`:205-211`) rather than skipping the write, because resume reads provider/endpoint from that JSON and a stale provider routes the resumed chat to the wrong endpoint.
- **Edge cases:** a renamed/removed custom provider is *healed* from the stored `base_url` (`:152-167`); if the route and its endpoint are gone, provider/base_url/api_mode are all dropped rather than sending the default provider's credentials to a stored URL. `provider == "custom"` loses the entry identity (`:194-198`), so `canonical_custom_identity` recovers `custom:<name>` from the endpoint URL.
- **Surprising:** `_resolve_model` (`:12`) falls back to a "cost-safe silent default (cache-only read)", never an unpicked flagship.

### `tui_gateway/compute_host.py`
- **Purpose:** the *child* process of the "turn isolation" feature — it owns the live `AIAgent` objects when `dashboard.turn_isolation` is on, and speaks line-JSON frames over stdin/stdout.
- **Key abstractions:** `ComputeHost` (`:75`) with `_FRAME_HANDLERS` (`:78`) mapping frame types to handlers; `run_host(stdin, stdout)` (`:573`); `shutdown(reason, wait=10.0)` (`:137`); `flush_all_sessions(...)` (`:163`).
- **Data flow:** parent → `turn.start` frame → `ThreadPoolExecutor` → `_run_real_turn` (`:217`) → `server._run_prompt_submit` → `turn.started` / `turn.end` / `turn.error` frames back to the parent, keyed by `sid` + `request_id`.
- **Non-obvious design decisions:**
  - *Shutdown holds back a flush reserve* (`:54`, `:143-146`): `_FLUSH_RESERVE_SECS = 1.0` is withheld from the drain budget because the supervisor SIGKILLs the host 10 s after SIGTERM — a drain that ate the whole budget would let the flush race the kill and persist nothing.
  - *A session still running at the deadline is skipped, not force-finalized* (`:150-162`): unfinalized keeps it recoverable, and the atexit `server._shutdown_sessions` may re-finalize it.
  - *The activity heartbeat observes the agent's clock, not the host's* (`_emit_turn_activity`, `:277`): a reused agent's last turn must not lend its activity to a new turn that has made no progress, so the summary's `stamped_at` must be `>= started_at`.
  - *The child adopts an inert borrowed lease* (`:239-243`): the parent already holds the session's lease, so the child must not re-claim it and be fenced out by the parent's own registry entry.
  - *A failed `_init_session` still leaves a minimal host-owned session* (`:349-368`) rather than failing after the expensive agent build.
- **Edge cases:** the parent-ppid guard loop (`:540-546`) shuts the host down and `os._exit(0)`s when the parent dies; the reader thread parses JSONL and answers malformed frames with an `error` frame rather than dying; the control route table rejects an unclassified route with `control.error` (`:485-492`).
- **Surprising:** `perf_counter_ns` is used for all cross-process timing because it is "shared across local processes" and does not require synchronized wall clocks.

### `tui_gateway/compute_host_bridge.py`
- **Purpose:** the *parent* side of turn isolation — route prompts/controls to the compute-host child and mirror the child's metadata, clarify and compress acknowledgements back into the session.
- **Key abstractions:** `_submit_prompt_to_compute_host(...)` (`:322`); `_compute_host_turn_frame(...)` (`:61`); `_relay_compute_host_rpc(message)` (`:150`); `_relay_compute_host_response(frame)` (`:208`); `_cancel_session_requests(sid, reason, method=...)` (`:228`); `_lock_compute_host_clarify(...)` (`:245`); `_on_compute_host_turn_done(...)` (`:303`).
- **Data flow:** `prompt.submit` → turn frame → supervisor → child; the child's frames come back and are either relayed to clients (`write_json`) or folded into the parent session record.
- **Non-obvious design decisions:**
  - *The parent holds only a **mirror** of a child-owned server request* (`:170-177`, `:228-245`): a local cancel never reaches the child's wait, so the cancel is relayed explicitly as `{"cancel": {"method", "reason"}}`.
  - *The lease vouch is qualified, not a boolean* (`_active_session_lease_vouch`, `:110`): after a compression rotation a lease still keyed on the old id must not let a replacement child borrow the continuation.
  - *The compression rotation re-anchors the lease at the owner* (`_compute_host_adopt_frame_meta`, `:127-141`) — never claimed from the child pid, so authority stays singular.
  - *The compress wait budget is derived, not fixed* (`_compute_host_compress_wait_seconds`, `:391`): the configured compression ceiling plus slack, clamped below the desktop's own RPC timeout, because a fixed waiter reported false timeouts while the host kept working (#97948). Slower acks land via the late-ack path (`:411`).
  - *A queued model switch is **copied**, not popped* (`:93-99`): the stash is cleared only after a successful isolated turn, so the fail-open in-process path can still apply it if the host dispatch fails.
- **Edge cases:** a `send_failed` pipe failure leaves the session untouched (`:344-348`) so `prompt.submit` can fail open to the in-process path; a `turn.error` emits `message.complete` with `status: "error"` and keeps the pending model switch.
- **Surprising:** `compute_host.activity` frames are explicitly *not* client events and not replay entries (`:151-161`) — they are an internal observation that only updates `_compute_host_activity_ns`.

### `tui_gateway/AGENTS.md` (docs — see Tier 2 table)

### `tui_gateway/contracts/billing_delegation_pets.py`
- **Purpose:** the wire shapes for billing, subscription, delegation, handoff, reactions, pet generation and `project.facts`.
- **Key abstractions:** `BillingEnvelope(Result)` (`:20`) — the shared success/failure shape; `UsageModel` (`:55`); `DelegationStatusResult` (`:377`); `SubagentSteerResult` (`:410`); `HandoffStateResult` (`:440`); `PetGenerateResult` (`:541`); `ProjectFactsResult` (`:612`).
- **Data flow:** a handler builds a plain dict → the declared model validates it → the registry maps the name to params/result.
- **Non-obvious design decisions:** *money is always a string* (`limit_usd: str`, `amount_due_now_cents: int`) — no float ever touches a price; *the billing routes are fail-open* — a logged-out portal answers `ok=false` with a typed `error`, never a JSON-RPC error, so `rpc()` always resolves; *`steer` returns `queued`, not `delivered`* (`:410-413`) because a child past its final tool batch surfaces `missed_steer`; *`handoff.fail` is a compare-and-set* against the watcher that may already have claimed the row (`:452-456`).
- **Edge cases:** `PetSpritePayload` is all-optional because `pet.hatch` emits `{}` when the installed pet cannot be reloaded (`:560-566`); `pet.generate` refuses without a prompt or a reference image (`:526-528`).
- **Surprising:** the docstring at `:1-8` states the fail-open rule for the whole topic — the contract file is also the policy.

### `tui_gateway/contracts/canonical.py`
- **Purpose:** the `hermes-gateway-v1` methods that only the *session authority* serves (the native socket), as opposed to the TUI sidecar's `METHODS`.
- **Key abstractions:** `AdmissionStatus` (`:29`) — the admission receipt with `admission_id`, `sequence`, `status`, `authority_epoch`, `execution_generation`; `SessionMutateParams` (`:82`); `SessionInventoryFields` (`:151`); `CronRunParams` (`:380`); `WorkerScopeParams` (`:464`).
- **Data flow:** the authenticated native socket → `AuthorityConnection.dispatch` → parameter validation against the canonical model → the handler.
- **Non-obvious design decisions:**
  - *Unknown or missing parameter keys return `4001 invalid_params` before the handler runs* (`:1-9`); value checks stay in the handlers, which own their domain reasons.
  - *`session.mutate` is revision-fenced and retry-idempotent* (`:82-95`): `expected_revision` plus `expected_generation` for delete/rewind/reset/branch/model/compress/reasoning/workspace. A model pick is a **mutation**, never a config write.
  - *`prompt.resolve_unknown` never requeues the lost input* (`:68-75`) — it acknowledges a turn lost across an owner restart so the FIFO behind it resumes, but the lost text is not silently re-run.
  - *`command.observe` is fire-only* (`:131-141`): the gateway fires `pre_command` and replies, without owning the execution.
- **Edge cases:** `session.export` renders the transcript and the *client* writes it (`:270-289`) — the gateway writes nothing on the host, so it works when the gateway is remote.
- **Surprising:** shared method names can carry different snapshots and admission receipts between the two wires; the docstring says to reuse a standalone model "only when its wire is identical".

### `tui_gateway/contracts/canonical_sessions.py`
- **Purpose:** the session-shaped methods whose *canonical* wire differs from the standalone `serve` wire, plus the shared-name overrides.
- **Key abstractions:** `CanonicalCreateParams` (`:21`); `CanonicalResumeParams` (`:58`); `CanonicalSnapshot` (`:137`); `CanonicalSubmitParams` (`:205`); `CanonicalCorrectionAck` (`:269`); `CanonicalEventsResult` (`:308`).
- **Data flow:** `session.create` / `session.resume` → a `CanonicalSnapshot` (messages, pending admissions, pending prompts, todo state, open connection card) → the client renders one screen.
- **Non-obvious design decisions:**
  - *`row_cwd` is separate from `cwd`* (`:29-32`): the sessions row records the launch directory while `cwd` stays where the tools run.
  - *`CanonicalPendingAdmission.steering`* (`:95-96`): a queued admission in transfer to the running turn reads `started` until that turn settles it, but returns to `queued` if its text never reached the turn — so a client keeps it at its queued rank.
  - *`CanonicalCorrectionAck.delivered`* (`:277`): only a `rejected` that *no agent ever saw* sets it, so a client knows it is safe to re-send; a plain `rejected` may follow delivery and must never be resent.
  - *`CanonicalSubmitParams` separates `text` from `api_text`* (`:222-224`): the persisted text and the model-facing text differ (voice prefix, model-switch notes), and the desktop's presentation-only fields (`display_kind=hidden`, a paste preview) are **committed per admission** but never reach the model.
  - *`clarify_batch`* (`:230-232`): the submitter answers the clarify tool's whole batch in one request, instead of one card per question.
- **Edge cases:** `CanonicalResumeParams.latest` (`:62-64`) is a bare `-c/--resume latest`; the owner resolves the most recent session *of the caller's surface family*, trying the caller's git root first.
- **Surprising:** `prompt.steer_queued` settles `steered` when the turn completes with its text and `interrupted` otherwise, and a text the turn never consumed goes **back to its queue place** (`:330-345`).

### `tui_gateway/contracts/canonical_projections.py`
- **Purpose:** the handful of methods whose canonical value shapes *demonstrably* differ from the standalone wire, registered as a loop at the bottom.
- **Key abstractions:** `CanonicalConfigSetParams` (`:21`); `CanonicalBotDeliverResult` (`:77`) with its `_admitted_or_refused` model validator (`:95`).
- **Data flow:** the registry entry is re-declared with the canonical params/result pair (`:100-113`).
- **Non-obvious design decisions:**
  - *A `model` key in `config.set` is recognised only to be refused* (`:24-27`) with `use_session_mutation_model` — a model pick is the revision-fenced `session.mutate` operation, never a config write.
  - *`CanonicalBotDeliverResult` has a model validator* (`:95-99`): a deliver result either names its admission or is a refused `failed` receipt without one — the two states are mutually exclusive and the wire refuses the ambiguous one.
  - *The file exists because "demonstrated differences" is the bar* (`:1`): a shape is only overridden when there is a real difference, not for symmetry.
- **Surprising:** `bot_relay.settle` reuses the *same* params/result as `bot_relay.deliver` (`:111-112`) — the sender's finalize of a refusal is the same identity, answered with the terminal not-sent receipt.

### `tui_gateway/contracts/common.py`
- **Purpose:** value shapes shared by many methods and events, declared once.
- **Key abstractions:** `OpenModel` (`:12`) — typed known fields but `extra="allow"`; `Usage` (`:19`); `SessionLiveInfo` (`:63`); `StoredSessionRow` (`:101`); `ToolLabel` (`:144`); `TranscriptMessage` (`:158`); `SubagentStatus` (`:179`) + `TERMINAL_SUBAGENT_STATUSES` (`:192`); `PendingApproval` (`:198`); `SessionParams` (`:224`) / `ProfileParams` (`:231`).
- **Data flow:** imported by every topic module so one shape is declared once.
- **Non-obvious design decisions:**
  - *`OpenModel` is the escape hatch* (`:12-16`): a row whose closed set is owned elsewhere (state.db rows, provider inventories) keeps typed known fields but tolerates extras. Everything else is closed, so a drifted emitter fails the suite.
  - *`ToolLabel` exists so clients never parse a tool name* (`:144-156`): the gateway renders `text`/`app`/`action`/`emoji` in words; the client draws them.
  - *`SubagentStatus` is a closed vocabulary* with a companion `TERMINAL_SUBAGENT_STATUSES` frozenset (`:192-195`) so "is this child done?" is one membership test.
  - *`SessionLiveInfo.reasoning_effort_wire`* (`:73-75`): the level the route's entry clamp actually sends, so a client can label a clamped step ("ultra sends max on this route") instead of guessing.
  - *`StoredSessionRow.continuation_kind`* (`:131-133`): `'compression'` when a row continues a sealed segment — provenance for a projected continuation tip.
- **Edge cases:** `ConnectorOwner` is a *discriminated* union of session/account owner (`:246`), so a connector call must say which kind of owner it means.

### `tui_gateway/contracts/config_free_tier_control.py`
- **Purpose:** the contracts for config get/set, setup readiness, the free tier, shared-metrics consent, model inventory, image generation and structured session control.
- **Key abstractions:** `ConfigGetResult` (`:42`); `ConfigSetResult` (`:81`); `FreeTierStatusResult` (`:191`); `SharedMetricsConsentResult` (`:262`); `ModelOptionsResult` (`:559`); `GoalSnapshot` (`:627`); `LoopSnapshot` (`:645`); `HeartbeatSnapshot` (`:666`); `SessionControlSnapshot` (`:675`); `VerificationStatusResult` (`:786`).
- **Data flow:** the desktop/CLI calls a keyed getter/setter; the handler answers with the normalised value and the extras the setter produced.
- **Non-obvious design decisions:**
  - *`ConfigSetResult` is a union-by-convention* (`:81-105`): model switches add `warning`/`confirm_required`/`deferred`, `cwd` adds `cwd`/`branch`, `personality` adds `history_reset` — one result model for every setter, with the extras optional.
  - *`SharedMetricsConsentResult` distinguishes `decided` from `reask`* (`:262-272`): the shipped defaults are not an answer, and an "off" from before a type-ahead fix is offered once more with the reason.
  - *`ProviderUsageAccount.state` has four values* (`:497-517`): `ready`, `limited`, `unknown`, `unavailable` — **state carries the meaning, never a fabricated gauge**, and a dead auth row stays visible but is never a quota row.
  - *`ProviderUsage.windows` stays empty for multi-account pools* (`:519-529`): a provider-wide percentage across different logins would be fabricated.
  - *`GoalSnapshot` carries a `wait_barrier` as a discriminated union* (`:615-627`) — `until` (a time) or a `session`/`pid` target — so a goal can wait on a deadline or on a process.
  - *`verification.status` is read-only and never runs checks* (`:786-791`): it reports the best known evidence for a cwd, including `stale` and `not_applicable`.
- **Edge cases:** `SetupStatusResult` distinguishes `provider_configured` (loose) from the boot record's `ready`/`free_tier_route` (`:108-129`); an unknown profile answers `ok=False` + `error` + `retryable`/`retry_after`.
- **Surprising:** the shared-metrics params all say "fire-and-forget; a no-op unless shared metrics are on" — consent is enforced at the handler, so a client can call unconditionally.

### `tui_gateway/contracts/connectors.py`
- **Purpose:** the connector catalog, authorization, account and *policy* contracts.
- **Key abstractions:** `ConnectorErrorReason` (`:19`) — a 27-value closed vocabulary; `ConnectorToolFacet` (`:110`) — `read`/`write`/`destructive`/`unclassified`; `ConnectorPolicyBody` (`:283`) — a discriminated union of `unrestricted`/`deny-all`/`allow`/`deny`; `ConnectorPolicyRevision` (`:359`).
- **Data flow:** a caller reads `connectors.policy.get` → gets the layered policy (org → role → member) plus the effective policy → applies a change with `expected_revision`.
- **Non-obvious design decisions:**
  - *Policy is layered, not flat* (`:327-344`): three layers with a `revision` each, and an `effective` computed from them.
  - *The policy write is a compare-and-set* (`:362-367`): `expected_revision` is required, and the revision format is a ULID-ish pattern (`:359`).
  - *Tool facets are a closed set including `unclassified`* (`:110-115`) — a tool the gateway cannot classify is still representable, and `destructive` is a first-class label the UI can gate on.
  - *`ConnectorsConnectParams` has a model validator* (`:81-87`): an alias names one account so it takes exactly one connector; a `connection_id` repair needs `reconnect`, one connector and no alias.
- **Edge cases:** `ConnectorAccountRow.disabled` (`:203-204`) marks an account retired by a reconnect — kept, never selectable.

### `tui_gateway/contracts/connectors_operation.py`
- **Purpose:** the `manage_connections` card — the request event that opens it, the update frames that drive it, and the RPCs the card answers through.
- **Key abstractions:** `ConnectionOperationTarget` (`:123`); `ConnectionRequestPayload` (`:178`); `ConnectionUpdatePayload` (`:211`); `ConnectionAnswer` (`:260`); `ConnectionRespondResult` (`:274`).
- **Data flow:** a tool opens an operation → `connection.request` event → the renderer draws the card → the card answers `connection.respond` → `connection.update` frames carry each transition.
- **Non-obvious design decisions:**
  - *The card is a pure projection* (`:6-8`): every frame carries the **full target snapshot** and the renderer never derives state.
  - *A monotonic `seq`* (`:181-183`): a frame whose seq is not higher than the one the renderer holds is older and moves no row — the card cannot go backwards.
  - *The authorization link rides on the target, never in the model result* (`:125-126`).
  - *`owner` is a discriminated union* (`:213`) so a card is bound to a session owner or an account owner.
  - *`ConnectionAnswer.said`* (`:267-268`): a display card answered by the user's words typed in the composer settles the card like Continue.
- **Edge cases:** the operation carries a `deadline_at` and `timeout_seconds` so a client that missed the event can restore the card **with the server's deadline** (`:179-196`).
- **Surprising:** the settlement reason is derived from target states *afterwards* (`:264-265`), not declared by the client.

### `tui_gateway/contracts/display.py`
- **Purpose:** the Bot Screen contracts — a profile's headless Xfce desktop, its takeover lease, the noVNC ticket and the on-host package install.
- **Key abstractions:** `LeaseHolder` (`:20`); `DisplayLease` (`:25`); `DisplayStatus` (`:45`); `DisplayObserveResult` (`:106`).
- **Data flow:** `display.status` → the client draws; `display.lease.acquire`/`release` → the lease changes; `display.lease` event → every client repaints.
- **Non-obvious design decisions:**
  - *The lease is the whole control model* (`:6-11`): `holder` is `agent` or `human`, and `epoch` moves on every real transition, so a client (or the agent's fence) can tell an in-flight result was produced under a lease that has since changed.
  - *The viewer's id is a capability and never leaves the gateway* (`:26-28`); `viewer_hash` lets the holder recognise itself.
  - *`display.thumbnail` is suppressed while a human holds the lease* (`:76-80`) — the frame may show what they are typing.
  - *`display.stop` is refused (5300, `viewer_mismatch`) while a human holds unless `force`* (`:90-97`).
  - *`display.observe` mints a single-use ticket* and a server-minted viewer id that keeps its identity across a reconnect (`:99-109`).
- **Edge cases:** `DisplayStatus.blocker` (`:66`) says *why* `display.start` would refuse now (host memory), so the pane shows the blocker instead of a Start button that would fail.

### `tui_gateway/contracts/events.py`
- **Purpose:** one `Payload` model per `event` frame the gateway emits — the whole notification spine.
- **Key abstractions:** `GatewayReadyPayload` (`:51`); `MessageDeltaPayload` (`:161`); `TurnStatus` (`:186`); `ErrorSurface` (`:194`); `PersistedTurn` (`:219`); `MessageCompletePayload` (`:237`); `ToolStartPayload` (`:354`); `SubagentEventPayload` (`:589`).
- **Data flow:** an emitter calls `_emit(type, sid, payload)` → the registry validates the payload against the declared model → the frame goes out.
- **Non-obvious design decisions:**
  - *The docstring names the Python emitter each payload was typed from* (`:4-6`) — the emitter is the source of truth; the hand-written TS was only a map.
  - *A handful of payloads stay `extra="allow"` on purpose* (`:14-18`): their closed shape is owned by another module (skin engine, pet store, goal/loop/heartbeat state files) or they are watcher signals whose payload is `{}` today.
  - *`message.delta` may carry `text: null`* (`:161-167`) — that is the **segment boundary** (the agent's `stream_delta_callback(None)`) that closes the classic CLI's reply box; every other viewer ignores an empty chunk.
  - *`PersistedTurn` carries row ids, and "missing ids are unproven, never negative acknowledgements"* (`:219-236`): `complete` is only true when the turn boundary, every row and the final body are accounted for; compaction, redirects and partial writes leave it false.
  - *`ErrorSurface` is advisory* (`:194-205`): `{layer, code, retryable}` plus an identity, an auth hint and `resets_at` when the provider said when its limit lifts.
  - *`message.complete` distinguishes `response_reused` and `response_transformed`* (`:250-251`) — "this text was already delivered" vs "this text was altered".
- **Edge cases:** `SessionUsagePayload` (`:274-311`) is explicitly marked deprecated in favour of the `usage` frame, and the embedded ticker never sends the legacy counters.
- **Surprising:** every docstring on a payload is a *sentence about behaviour*, not a description of fields — the contract doubles as the event catalogue.

### `tui_gateway/contracts/groups_bot_relay.py`
- **Purpose:** hosted group-chat rooms (`groups.*`), the cross-connection bot relay (`bot_relay.*`) and the dashboard browser controller (`browser.controller.*`).
- **Key abstractions:** `Room` (`:50`); `RoomEvent` (`:36`); `RoomLinkCatalog` (`:117`); `RoomExecutionPolicy` (`:96`); `RoomDriverStatus` (`:211`); `RelayEnvelope` (`:528`); `BotRelayDeliverResult` (`:559`).
- **Data flow:** a client proposes a room and its roster → the room's events are appended idempotently → the driver executes the members' turns → the bot relay drains an outbox and delivers envelopes.
- **Non-obvious design decisions:**
  - *Authority is the gateway's own install identity* (`:185-196`): a client-supplied `authority_gateway_id` is explicitly ignored — a client cannot spoof authority.
  - *Room events are idempotent by `event_id`* (`:235-248`) and carry an `authority_epoch` (`:43`), so a replayed event cannot double-apply and a stale authority is detectable.
  - *The roster validator owns the rules*, not the contract (`:76-84`): the member set stays open because legacy rooms carry pre-normalisation rows.
  - *`RoomExecutionPolicy` carries a `policy_digest`* (`:96-105`): the room's frozen execution policy (toolsets, approval mode, max iterations) is hashed so a peer can tell it is the same policy.
  - *`groups.capabilities.seatable_profiles`* (`:166-168`): the local profiles this caller may seat in a new group — served bots minus retiring ones, plus usable hosted-room profiles; only a host-scoped caller gets served siblings.
  - *`RoomDriverStatus.pending_actions`* (`:211-221`): `{kind: retry, task_id}` rows plus the driver's approval action, so the UI can show what the room is waiting on.
- **Edge cases:** `groups.discard` (canonical-only) exists for an *indeterminate* room task, and only after explicit user confirmation (canonical.py:554-566).

### `tui_gateway/contracts/events.py` (continued — event payloads, 868 lines)
- **Purpose:** every `event` frame's payload model; the full notification spine of the gateway.
- **Key abstractions:** `GatewayReadyPayload` (`:51`); `MessageCompletePayload` (`:237`); `ToolStartPayload` (`:354`); `ToolOutputRiskPayload` (`:399`); `SubagentEventPayload` (`:589`); `ChangeSignalPayload` (`:836`).
- **Data flow:** emitter → registry validation → frame. The docstring names the Python emitter each payload was typed from (`:4-6`).
- **Non-obvious design decisions:** `message.delta` may carry `text: null` (`:161-167`) — the *segment boundary* that closes the classic CLI's reply box; `PersistedTurn` (`:219-236`) records row ids and says "missing ids are unproven, never negative acknowledgements"; `ErrorSurface` (`:194-205`) is advisory `{layer, code, retryable}`; `NotificationShowPayload.detail` (`:440-453`) carries the full text behind a short toast; `approval.cancelled` (`:513-531`) exists because "the deny-resolve is silent without it, so a reconnecting client's prompt looks lost rather than cancelled".
- **Edge cases:** `tool.output_risk` (`:399-410`) reports prompt-injection / secret findings with a `redacted` flag; `voice.interrupted` is registered with a `None` payload (`:761`); the change-watcher signals carry `{}` and are `OpenPayload` (`:836-848`).
- **Surprising:** `subagent.*` identity fields are optional because older emitters omit them and the TUI spawn tree falls back to flat rendering (`:589-600`).

### `tui_gateway/contracts/groups_bot_relay.py` (continued — groups + bot relay, 646 lines)
- **Purpose:** hosted rooms (`groups.*`), the cross-connection bot relay (`bot_relay.*`) and the browser controller.
- **Key abstractions:** `Room` (`:50`); `RoomEvent` (`:36`); `RoomLinkCatalog` (`:117`); `RoomDriverStatus` (`:211`); `RelayEnvelope` (`:528`).
- **Non-obvious design decisions:** authority is the gateway's own install identity — a client-supplied `authority_gateway_id` is ignored (`:185-196`); room events are idempotent by `event_id` and carry an `authority_epoch` (`:36-48`); `groups.promote` continues a replicated room at **epoch + 1** and requires `confirm=true` (`:402-419`); `groups.demote` fences a stale authority against a *proven* newer epoch (`:421-438`); the bot relay's outbox drain is **atomic** — "claim every pending cross-connection envelope" (`:524-541`).
- **Edge cases:** `bot_relay.deliver` is blocking and returns the one-turn reply (`:549-565`); `bot_relay.reply` writes the reply or a typed error so the sender-side waiter resolves (`:567-579`).

### `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py`
- **Purpose:** completions, profiles, onboarding, the credential vault, foreign histories and the subagent roster.
- **Key abstractions:** `ProfileRow` (`:151`); `ProfilesConfigureParams` (`:269`); `VaultItem` (`:452`); `ForeignSessionRow` (`:570`); `SubagentSnapshot` (`:638`); `FailedDelegation` (`:654`).
- **Non-obvious design decisions:** *the vault is metadata-only* — "a secret never appears in a result" (`:446-465`); *`profiles.configure` is a per-section compare-and-swap* on `ui_meta` (`:269-283`) and reports each section's outcome separately (`:290-304`); *`profiles.create` mirrors launch credentials by default* so a headless bot has a provider (`:188-204`, `ProfileMirrored` `:206`); *a foreign session's `id` is an opaque handle, never a path* (`:570-582`); *the subagent roster shows only the caller's children* — "other sessions' children never leak" (`:666-670`).
- **Edge cases:** `session.foreign.preview` is bounded to the last 40 turns / 8000 chars each and reports `truncated` (`:612-624`); `profiles.get_asset` answers `found: false` rather than an error (`:342-356`); `vault.unlock`'s master password is "consumed by the manager CLI and never stored or logged" (`:505-520`).
- **Surprising:** `subagent.list` returns `delegations` — *recently failed* async delegation tasks from the durable store, newest first (`:654-670`) — a post-mortem list built into the live roster.

### `tui_gateway/contracts/projects_pets.py`
- **Purpose:** projects (multi-folder workspaces, repo discovery, sidebar tree) and the pet mascot surface.
- **Key abstractions:** `ProjectInfo` (`:30`); `RepoDiscoveryPolicy` (`:168`); `ProjectTreeLane` (`:241`); `ProjectTreeNode` (`:264`); `PetInfoResult` (`:320`); `PetCellsResult` (`:365`).
- **Non-obvious design decisions:** *the pet wire predates the snake_case rule and travels camelCase* — the field names below are the wire keys verbatim (`:7-9`); `isGit` is a separate flag from `isMain` so the renderer never offers `git switch` on a path-only heuristic lane (#61362, `:241-255`); *`knownRevision` is send-once bytes* — the client asks for the spritesheet only when its revision changed (`:314-318`); `pet.info` elides `spritesheetBase64` when `spritesheetUnchanged` (`:320-343`); `pet.thumb` returns a data URI because "desktop CSP breaks CDN `<img>`" (`:448-464`).
- **Edge cases:** `projects.create` refuses a duplicate primary path (5063) and `projects.get` answers 5062 for an unknown id; `projects.discover_repos` merges a cached host scan with session-derived repos.

### `tui_gateway/contracts/prompt_voice.py`
- **Purpose:** prompt submission, attachments, side agents, clarify locks, approvals, and voice/wake control.
- **Key abstractions:** `PromptSubmitParams` (`:26`); `PromptSubmitResult` (`:63`); `AttachedImageResult` (`:98`); `ClarifyLockResult` (`:269`); `ApprovalRespondResult` (`:331`); `WakeStatusResult` (`:504`).
- **Non-obvious design decisions:**
  - *Truncation needs explicit consent* (`:39-43`): `confirm_truncate` plus one durable target (`truncate_before_row_id` preferred, `truncate_before_message_id`, or the legacy `truncate_before_user_ordinal`).
  - *Client-supplied privileged fields are excluded from the wire* (`:44-49`): `hosted_task`, `turn_author` and `hosted_terminal_callback` use `Field(exclude=True)` — "never accepted from a client (a client dict for `_turn_author` answers 4124)".
  - *A title preview is TITLE input only, never model input* (`:37-38`); *`display_kind` only honours `"hidden"`* — anything else renders as a user row (`:29-30`).
  - *`prompt.background` / `prompt.btw` are fire-and-forget* — the answer arrives as an event carrying the `task_id` (`:227-241`).
  - *`approval.received` starts the timeout clock* — "tell the backend the card is on screen, so its timeout clock starts" (`:310-320`).
  - *`approval.respond` falls back to durable identity on a stale sid* (`:331-340`).
  - *Wake-word ownership is a first-class state* — `owner_surface`, `not_owner` reasons, and `audio_silent` meaning "armed but deaf" (`:450-527`).
- **Edge cases:** `voice.record` answers `reason: "wake_owned"` when another surface holds the mic (`:389-396`); `clarify.lock` reports `expired` — "the wait already ended (timeout/cancel) — not an error" (`:269-279`).

### `tui_gateway/contracts/registry.py`
- **Purpose:** the contract catalog — every method, server→client request and event the gateway speaks.
- **Key abstractions:** `MethodContract` (`:23`); `METHODS` / `CANONICAL_METHODS` / `SERVER_REQUESTS` / `EVENTS` (`:47-52`); `method()` / `canonical_method()` / `server_request()` / `event()` (`:63-84`); `validate_params` (`:105`); `check_result` (`:148`); `check_payload` (`:155`); `assert_complete` (`:171`).
- **Data flow:** topic modules call `method(...)` at import time → the tables fill → `server.py` validates at runtime and `scripts/gen_gateway_contracts.py` renders TypeScript + OpenRPC.
- **Non-obvious design decisions:**
  - *A duplicate declaration is an import-time error* (`:55-61`): "the wire has no undeclared surface".
  - *Only unknown keys are refused at the boundary* (`:105-121`): required/type errors stay with the handler, which owns its documented domain codes (`4006` missing session_id, `4015` bad url). The error message literally tells the user "the client and the Hermes backend are out of sync (different versions)".
  - *`check_params_accepted` closes the loop* (`:138-146`): if a handler *succeeds* on params the contract calls invalid, the contract is narrower than the wire.
  - *`assert_complete` is bidirectional* (`:171-189`): methods without a contract AND contracts without a handler are both failures — a declaration can never rot.
  - *Strictness is env-gated* (`:93`): `HERMES_TEST_ISOLATION` turns a contract violation into a raise; production only logs it.
- **Surprising:** `canonical_param_problems` (`:123-136`) treats a *missing* key as acceptable for shared methods (the handler owns that refusal) but not for canonical-only ones.

### `tui_gateway/contracts/server_requests.py`
- **Purpose:** the server→client request catalogue — the backend asking the renderer a question.
- **Key abstractions:** `ClarifyRequestParams` (`:43`); `SetupBeatRequestParams` (`:102`); `ApprovalRequestParams` (`:173`); `ThemePickResult` (`:346`); `RequestCancelPayload` (`:372`).
- **Non-obvious design decisions:** *the clarify result carries an `outcome`* (`:50-58`) — how the viewer's own panel ended, `timed_out` keeps the answers locked before its deadline; *the setup beat's card data is a discriminated union* (`:102-111`) and `tool_call_id` binds the card to one transcript row; *`SetupBeatResult.said` / `wrote_instead`* (`:146-164`) let the user type a name into the composer instead of answering the card, and the backend ends the turn so the client can send that message next; *the approval command is redacted server-side before it leaves* (`:173-179`); *`request.cancel` carries a reason enum* (`:364-378`) so a client can distinguish "resolved" from "session_closed".
- **Edge cases:** the setup beat blocks 300 s and a response with none of the answer fields closes the card unanswered (`:146-164`).

### `tui_gateway/contracts/sessions.py`
- **Purpose:** the whole session lifecycle contract — create/resume/activate/close, history, compression, corrections, listing, spawn trees, event replay and the stateless one-shot LLM.
- **Key abstractions:** `LiveSessionSnapshot` (`:73`); `SessionCreateParams` (`:118`); `SessionResumeParams` (`:182`); `SessionCompressResult` (`:575`); `SessionEventsSinceResult` (`:731`); `SpawnTreeEntry` (`:670`).
- **Non-obvious design decisions:**
  - *`idempotency_key` on create/branch* (`:136-140`, `:154-163`): "a retried create (response lost in transit) returns the SAME session instead of a duplicate child" (#65410).
  - *`inline_images: bool = True`* (`:188-192`): false renders image parts as `"[image]"` instead of data URIs — "a remote client reads a transcript in kilobytes instead of re-transmitting every stored attachment" (#116511).
  - *`cwd_explicit` records provenance* (`:122-125`): "true only for a deliberate workspace pick".
  - *`fast` uses presence as the contract* (`:130`): "omitted inherits, true pins priority, false pins normal".
  - *`session.events.since` accepts and ignores a legacy `replay_epoch`* (`:723-730`): "Clients that still send that process epoch here must replay; any other unknown key stays refused."
  - *`session.compress` reports `refused_would_grow`* (`:559-570`): a compression that would *grow* the transcript is refused, and `CompressionSummary` says so.
  - *`session.undo` carries an `intent`* (`:445-461`): `retry` vs `undo` so metrics count a retry, not an undo.
- **Edge cases:** `spawn_tree.load` requires the path to be under the spawn-trees root (`:693-709`); `llm.oneshot` needs a template or instructions+input (`:766-785`).

### `tui_gateway/contracts/tools_commands.py`
- **Purpose:** system/process/slash/rollback/cron/browser/config RPCs.
- **Key abstractions:** `ProcessEntry` (`:93`); `CommandDispatchResult` (`:284`); `SlashExecResult` (`:308`); `RollbackRestoreResult` (`:397`); `CronJobRow` (`:458`); `CronManageResult` (`:502`).
- **Non-obvious design decisions:** *pass-through rows use `extra="allow"`* (`:17-19`) — "those declare every key the producer is known to emit plus `extra="allow"` so a new upstream key never trips the strict gate"; *`command.dispatch` answers a structured directive, never a string* (`:266-300`) — `exec`/`alias`/`plugin`/`send`/`skill`/`prefill`; *"UIs render `display`, never `message`"* (`:284-291`); *a whole-tree rollback restore keeps the user's hand-edits* by default, `all` reverts them (`:387-396`); `rollback.restore` reports `skipped_user_edits`, `skipped_oversize` and `failed_deletes` separately (`:397-417`).
- **Edge cases:** `cron.manage` distinguishes `last_delivery_error` from `last_delivery_unverified` (`:458-494`) — unconfirmed `platform:chat_id` targets are not failures; `cron.manage` answers `gateway_running` so the UI can say "the gateway must be up for this to fire".

### `tui_gateway/contracts/tools_mcp_plugins.py`
- **Purpose:** tools/toolsets, reload, skills, the learning graph, MCP servers, OAuth and plugins.
- **Key abstractions:** `ToolsConfigureResult` (`:85`); `ReloadMcpResult` (`:137`); `SkillsReloadDiff` (`:236`); `LearningFramesResult` (`:309`); `PluginActivation` (`:739`); `PluginsManageResult` (`:793`).
- **Non-obvious design decisions:**
  - *`tools.configure` rebuilds the live agent* so the change takes effect now (`:85-99`).
  - *`reload.mcp` distinguishes `applied` / `unchanged` / `busy`* (`:131-135`) — a deferred reload is not a failure.
  - *`skills.reload` returns a structured diff* (added/removed/unchanged) *and* the pre-rendered text `/reload-skills` prints (`:236-256`).
  - *`learning.frames` pre-renders the whole timeline* (frames + legend + buckets + summary) "so the TUI walks it locally" (`:258-323`).
  - *`PluginActivation` is an honest split* (`:739-754`): `activated_now` (live in the running gateway), `live_now` (MCP servers and skills usable from the next turn), and `deferred` (tools and prompt sections apply from the next session).
  - *A plugin update that widened its permissions asks for consent* — `consent_required` plus the `delta` of what a widened pin adds, and "nothing changed until the client retries with `accept_capabilities`" (`:793-845`).
  - *A security scan can block an update* — `scan_blocked` with the verdict and findings; a `caution` can be retried with `force` once the user saw the findings, `dangerous` cannot (`:829-845`).
- **Edge cases:** `mcp.servers.test` reports an OAuth server with no token on disk as not ok (`:483-497`); the OAuth callback accepts the RFC 9207 `iss` because `extra="forbid"` would 4000 the desktop relay (`:561-567`).

### `tui_gateway/entry.py`
- **Purpose:** the stdio JSON-RPC entry point of the TUI gateway.
- **Key abstractions:** `main()` (`:291`); `_serve()` (`:303`); `_log_signal` (`:116`); `_hard_exit` (`:103`); `wait_for_mcp_discovery` (`:178`); `ensure_mcp_discovery_started` (`:248`).
- **Data flow:** stdin line → `json.loads` → `server.dispatch(req)` → `server.write_json(resp)`.
- **Non-obvious design decisions:**
  - *stdin is closed-on-exec* (`:36-55`): "The TUI's stdin is the Node-to-Python JSON-RPC socketpair" — a dependency that launches a child without `stdin=` could otherwise consume a request.
  - *SIGPIPE is ignored, not defaulted* (`:164-170`): `SIG_DFL` killed the process silently whenever a background thread wrote to a quiet pipe; ignoring lets `write_json` see `BrokenPipeError` and exit through the logged path.
  - *A signal handler logs every thread's stack and then arms a bounded grace timer* (`:116-147`): `sys.exit(0)` alone raced the worker pool (a thread holding `_stdout_lock` mid-flush blocks interpreter shutdown).
  - *The launch home is claimed exclusively* (`:273-301`): "it opens that home's `state.db` as a writer, so it must be the home's only owner" — the gateway's lock reservation refuses it beside a live gateway.
  - *Both MCP discovery owners are consulted* (`:205-237`): the stdio path spawns its own thread, the desktop/dashboard path uses `hermes_cli.mcp_startup`; checking only one left those surfaces with no late refresh (#51587).
  - *An inline handler exception is contained* (`:375-390`): the crash log gets the same trail as a crash, or "the degraded reply looks like a client bug".
- **Edge cases:** `handle_spurious_eof` distinguishes a shared-description `O_NONBLOCK` flip from a genuine peer close (`:357-364`).

### `tui_gateway/event_publisher.py`
- **Purpose:** mirror every emitted event to the dashboard's sidebar over a back-WS.
- **Key abstractions:** `WsPublisherTransport` (`:31`) with `write` (`:68`), `_drain` (`:52`), `close` (`:77`).
- **Data flow:** dispatcher emit → `TeeTransport` → this transport → bounded queue → daemon thread → `ws.send`.
- **Non-obvious design decision:** *the failure mode is deliberately silent* (`:6-9`): "the agent loop must never block on the sidecar: `send` runs on a daemon thread, `write` returns after enqueueing (drop when full), a dead WS short-circuits all later writes."
- **Edge cases:** `_QUEUE_MAX = 256` (`:28`) — a full queue drops the event rather than blocking; the WS is opened with `max_size=None` (no frame cap) because a single event can be large.

### `tui_gateway/event_replay.py`
- **Purpose:** per-session event sequencing and a bounded replay buffer so a reconnecting WebSocket client can catch up.
- **Key abstractions:** `_stamp_event(obj)` (`:72`); `events_since(sid, last_seen)` (`:150`); `is_truncated(sid, last_seen)` (`:163`); `forget_session(sid)` (`:140`); `replay_epoch()` (`:53`).
- **Data flow:** every event frame through `write_json` gets a per-session monotonic `seq` and a frozen JSON snapshot; a reconnect asks for everything after its watermark.
- **Non-obvious design decisions:**
  - *The payload is frozen OUTSIDE the lock* (`:93-99`): "one large payload cannot stall other threads' frames" — the same rule as the transport write.
  - *Bytes detach the ring from the live object* (`:40-42`): "later caller mutation cannot grow or rewrite an already-accounted cache entry".
  - *Eviction keeps the seq counter* (`:125-138`): "a revisited session continues from its high seq instead of restarting at 1 under clients' still-held watermarks (a reset seq is invisible to dispatchIfNewer, so replay AND live frames silently vanish)" (#100122).
  - *A forgotten session's ring is never rebuilt by late frames* (`:105-107`): the frame still gets a seq and a watermark but is not retained.
  - *An epoch token detects a server restart* (`:24-27`): seq counters are in-process, so a restart resets them to 1 while clients hold high watermarks — the epoch lets the client reset.
  - *Memory is bounded three ways* (`:30-36`): 512 events per session, 4 MiB per session, 64 MiB per process, oldest-evicted FIFO.
- **Edge cases:** an oversized frame is dropped and leaves a truncation watermark so the client refetches instead of trusting a replay with holes (`:110-113`); `events_since` decodes after releasing the ring lock (`:150-161`).

### `tui_gateway/free_tier_task_done.py`
- **Purpose:** detect a task that finished *on its own* on the free tier, which (re)arms the sign-in offer.
- **Key abstractions:** `is_clean_task(result, agent, *, user_input, display_kind)` (`:17`); `note_task_done(session, result, agent, display_kind)` (`:30`).
- **Data flow:** turn result → `is_clean_task` → `hermes_cli.free_tier_offer.record_task_done()`.
- **Non-obvious design decision:** *"on its own" is defined narrowly* (`:4-8`): the turn completed with a reply, on the free tier, and nobody steered, redirected, interrupted or typed into it. **Answering a clarify card is not intervention** — it is the reply to a server request. A crash resume is not a new task.
- **Edge cases:** `note_task_done` never fails the turn — the whole body is wrapped in a `try` that only logs at debug level (`:31-36`).

### `tui_gateway/git_probe.py`
- **Purpose:** git working-tree probing — repo roots, branches, linked worktrees — for the gateway (which may be remote).
- **Key abstractions:** `run_git(cwd, *args)` (`:22`); `branch(cwd)` (`:37`); `_RootCache.resolve(key, probe)` (`:57`); `repo_root(cwd)` (`:96`); `common_repo_root(cwd)` (`:101`); `resolve(cwd)` (`:122`).
- **Data flow:** cwd → a bounded `git` spawn → a cached answer.
- **Non-obvious design decisions:**
  - *A single-flight cache* (`:41-87`): concurrent identical probes share one `git` spawn; followers wait on the leader's event and re-read.
  - *Negatives are cached for 30 s* (`:19`, `:73-78`): "hundreds of non-git session cwds would otherwise re-spawn `git` on every sidebar open, while the TTL keeps `git init` re-probable."
  - *The common root folds linked worktrees* (`:101-120`): `--show-toplevel` is a linked worktree's *own* root; the parent of `--git-common-dir` is the one true root, normalized to git's forward-slash spelling so a Windows checkout compares equal.
  - *The probe is bounded on Windows* (`:22-36`): `bounded_git_probe` bounds post-kill cleanup — "a plain `subprocess.run(timeout=...)` here deadlocked Desktop session readiness" (#68609).
- **Edge cases:** a missing directory returns `""` without a fork (`:33-35`), because deleted worktrees dominate a long session history's cwds.

### `tui_gateway/host_supervisor.py`
- **Purpose:** own one persistent compute-host child process and relay its frames.
- **Key abstractions:** `HostSupervisor` (`:141`); `MUTATOR_ROUTE_TABLE` (`:27`); `submit_turn` (`:237`); `control(...)` (`:294`); `_maybe_respawn_after_crash` (`:473`); `append_log_record(path, record)` (`:52`).
- **Data flow:** frame → the child's stdin → frames on its stdout → `rpc_sink` / pending-control queues.
- **Non-obvious design decisions:**
  - *Every mutator route is classified* (`:27-35`): `turn-path`, `run-concurrent` or `idle-gated`; an unclassified route raises (`:298-300`).
  - *A late control ack is still delivered* (`:294-337`): when the RPC waiter gives up, the handler is registered (bounded by `_LATE_CONTROL_TTL_SECS`/`_LATE_CONTROL_MAX`) so the host's eventual `control.ack` is not silently dropped (#97948).
  - *A crash fails the pending turns AND the late handlers* (`:453-471`): "a crashed host never emits the late acks timed-out control waiters still expect; fail them too so the client's 'still running' notice can't hang."
  - *A crash loop stops respawning* (`:473-497`): 3 restarts per 5 minutes → `_stopped_respawning`, with a bounded exponential backoff.
  - *The hello handshake is validated* (`:367-378`): a `HERMES_HOME` or build-sha mismatch kills the child — the parent and child must be the same build.
  - *PID reuse is guarded* (`:213-235`): `is_compute_host_identity(pid)` checks the cmdline before any signal.
  - *`append_log_record` uses exactly one `os.write` with `O_APPEND`* (`:52-77`): on Windows, CRT's `O_APPEND` is seek+write, so the code opens the file with `FILE_APPEND_DATA` to get a real atomic append.
- **Edge cases:** the child's stdout is decoded with `errors="replace"` (`:339-350`) — "a locale-mismatched byte must not raise inside the drain threads".

### `tui_gateway/hosted_room_member_activity.py`
- **Purpose:** project a hosted room member's live runtime events to the `on_room_member_activity` plugin hook.
- **Key abstractions:** `KIND_BY_FRAME_TYPE` (`:24`); `KIND_BY_REQUEST_METHOD` (`:44`); `project_room_member_activity(frame, sessions)` (`:49`); `emit_room_member_activity(...)` (`:33`).
- **Data flow:** an outgoing session frame → the session's `_hosted_room_task` coordinates → a bounded plugin-hook queue.
- **Non-obvious design decision:** *nothing is written to the room log* (`:8-11`): "deltas at room-log byte budgets would exhaust a room in minutes, and checkpoint replay must stay a pure function of the durable events." The frames are re-routed **off the token path**.
- **Edge cases:** only the listed frame types are member activity (`:25-27`); session chrome (`session.info`, `status.update`, `message.start/complete`) is explicitly not.

### `tui_gateway/hosted_room_driver.py` (part 1 of 2 — see below for the tail)
- **Purpose:** the runtime adapter for gateway-owned hosted room turns — a bounded supervisor that schedules independent room workers.
- **Key abstractions:** `InternalSessionRPC` protocol (`:40`); `HostedRoomBinding` (`:71`); `HostedRoomRuntime` (`:105`); `AttachmentsUnsupportedError` (`:36`).
- **Data flow:** durable task rows → a lease-fenced transition → `InternalSessionRPC.submit(...)` → a terminal receipt → `publish_terminal`.
- **Non-obvious design decisions:**
  - *Profile turn locks serialize Bots sharing a profile, while a room waiting for approval cannot stall unrelated rooms* (`:6-9`).
  - *The durable state machine lives elsewhere* (`:3-4`): this module owns the process-local worker and an injected session adapter, "never the gateway server or agents".
  - *Every constructor parameter is validated* (`:126-160`): positive-only knobs raise, `max_concurrent_rooms` must be a positive int, and the retry bounds must be ordered.
  - *Cancel is a routing problem, not a write* (`:213-252`): the status read is "only a routing hint", so a fast-path fence failure re-reads and re-routes (up to `_CANCEL_ROUTE_RETRIES = 8`) rather than surfacing a race.
  - *A stopping task is settled from its receipt or an acknowledged interrupt* (`:320-330`); a peer that is uncertain stays uncertain (`:371-388`).
  - *Approval actions are narrowed* (`:403-417`): only the `once`/`deny` choices are forwarded to the plugin hook.
  - *The room session title is reused* (`:930`): `Group: <room_id>` so a local-to-hosted migration keeps one transcript.
  - *Terminal text is bounded* (`:30-33`, `:947`): 64 KiB with an explicit truncation notice telling the user to ask for a file.
- **Edge cases:** `retry_indeterminate` refuses while the original attempt is still active (`:254-278`); an explicit Retry may resume the exact stored session, while the automatic abandoned-attempt scan stays non-resuming.

### `tui_gateway/hosted_room_driver.py` (part 2 — the tail)
- **Non-obvious design decisions (continued):** *the supervisor schedules rooms round-robin from a cursor* (`:471-489`) so no room starves; *a room's worker thread is joined with a short poll* (`:445-453`); *an exception during a cycle is recorded, not fatal* (`:437-441`) — "keep independent rooms serviceable"; *a lease is renewed only in its second half* (`:569-577`); *`state.recover_room` runs once per (room, lease generation)* (`:518-522`); *an unavailable route backs off exponentially between 1 s and 30 s* (`:542-550`); *a submit that failed *after* admission is AMBIGUOUS, not failed* (`:628-640`) — the room is marked ambiguous and the lease dropped, and the task is reconciled later by probing the session; *an exception message may contain prompt text or credentials, so only a fixed reason is persisted* (`:629-635`).
- **Edge cases:** `_complete_acknowledged_stop` distinguishes a *deadline* stop from a user stop (`:731-744`): a deadline publishes an explicit "turn exceeded its configured time limit" failure rather than a cancellation; `_truncate_utf8` (`:947-958`) truncates on a **byte** boundary without splitting a UTF-8 character; `_find_terminal_receipt` (`:969-988`) matches the receipt on `task_id` + `execution_generation` + role + status, so a reply from another attempt is never mistaken for this one.
- **Surprising:** `_harvest_previous_attempt` (`:873-888`) deliberately has **no** "trust this historical output" escape hatch — "once the previous proof has expired there is deliberately no escape hatch; fenced recovery leaves the task indeterminate for the user."

### `tui_gateway/hosted_room_peer_http.py`
- **Purpose:** the scoped HTTP client for driving a peer gateway's room-member turn.
- **Key abstractions:** `PeerRunsHTTPClient` (`:205`); `PeerRunsHTTPError` (`:170`); `digest_reauthorization_error(catalog, ...)` (`:184`); `_read_bounded_response(response, max_bytes, deadline)` (`:94`).
- **Data flow:** a dispatch → `POST /v1/runs` with an `Idempotency-Key` → a `run_id` → a durable receipt → polled status → history/approval/stop.
- **Non-obvious design decisions:**
  - *Every response is byte-bounded AND time-bounded* (`:33-35`, `:94-123`): 16 MiB for a replay page, 16 KiB for an error body, 64 KiB chunks, and the socket timeout is tightened to the remaining budget on every chunk.
  - *The three failure classes are distinguished* (`:170-182`): `retryable` (try again), `ambiguous` (the request may or may not have been admitted), `not_admitted` (it provably was not). This distinction is what lets the driver requeue instead of duplicating a task.
  - *A POST is retried exactly once when ambiguous* (`:412-420`).
  - *The logical session id is derived, not stored* (`:343-352`): `roomlink_` + sha256(room_id\0profile) — so a peer restart finds the same session.
  - *`bind_room_scope` fences every receipt to one room authority* (`:236-254`): changing the scope clears the in-memory run/status/backoff/terminal tables.
  - *A grant refresh is probed before it is persisted* (`:585-603`): "Persist only after the target proves the replacement authorizes the scoped endpoint."
  - *`_require_room_grant` refuses to fall back to broad Bearer auth* (`:618-623`): "Prevent scoped operations from falling back to broad Bearer auth."
- **Edge cases:** a member gateway that restarted mid-turn reports the run `unknown`; `_resolve_unknown` (`:492-499`) acknowledges exactly that admission and settles it *interrupted* — the room never resumes a lost execution.

### `tui_gateway/hosted_room_peer_transport.py`
- **Purpose:** the peer-backed implementation of `InternalSessionRPC` — the room driver talks to a remote gateway as if it were local.
- **Key abstractions:** `FailoverHostedRoomPeerClient` (`:51`); `RoomLinkCandidate` (`:41`); `PeerMemberRoute` (`:114`); `PeerHostedRoomTransport` (`:152`); `build_member_dispatch(...)` (`:128`).
- **Non-obvious design decisions:**
  - *Failover never changes the target or the logical task identity* (`:52-58`) — the candidates must all target one installation (enforced at construction).
  - *An ambiguous or non-retryable failure propagates* (`:78-86`): "failing over after an ambiguous dispatch could run the same task twice."
  - *The primary is re-probed after a cooldown* (`:70-76`), so a recovered link is preferred again.
  - *`accepts_attachments = False`* (`:153`): a member dispatch has no field for files.
  - *The dispatch is fully fenced* (`:128-150`): protocol version, room, authority epoch, task id, execution generation, source event seq, cancellation scope, prompt digest, capability digest, execution-policy digest, trace id.
  - *A task for another member is refused* (`:200-203`): "the signed route names one member: a task for another member reached the wrong route."
- **Edge cases:** `interrupt` (`:225-243`) uses the in-flight dispatch when there is one and otherwise stops the durable receipt by `(task_id, execution_generation)`.

### `tui_gateway/hosted_room_server_rpc.py`
- **Purpose:** the in-process session adapter for the room driver — the room worker uses the *same* installed session handlers as every TUI/Desktop turn.
- **Key abstractions:** `HostedRoomServerRPC` (`:35`); `HostedRoomSessionError` (`:21`).
- **Non-obvious design decisions:**
  - *The task proof is an in-process-only Python object* (`:1-4`): "passing the task proof as an in-process-only Python object that JSON clients cannot forge" — `_hosted_task` and `_hosted_terminal_callback` ride `prompt.submit` as `Field(exclude=True)` fields.
  - *`accepts_attachments = False`* (`:36`): "prompt.submit here has no event-bound file resolution."
  - *A pre-admission refusal is marked `not_admitted`* (`:93-101`): "keep that proof so the driver can defer/requeue without an ambiguity lease."
  - *The created room session is hidden and marked `room_plumbing`* (`:58-62`) with `follow_profile_config: True` and `close_on_disconnect: False`.
- **Edge cases:** `info()` reports `status: "waiting_for_approval"` and the pending approval when one is open (`:112-124`).

### `tui_gateway/hosted_room_service.py`
- **Purpose:** the production coordinator for same-gateway hosted Discussion rooms.
- **Key abstractions:** `HostedRoomService` (`:64`); `_RouteStatusPeerClient` (`:596`).
- **Data flow:** room rows → the policy checkpoint → a discussion decision → an admitted task → the runtime → the terminal publication.
- **Non-obvious design decisions:**
  - *Persistence is the publication boundary* (`:206-212`): "a failed disk write must never leave a process-local route that disappears after restart."
  - *A revoked grant that cannot be reached leaves the room intact* (`:220-240`): "an unreachable target leaves the room intact for retry rather than a false disband with a live grant."
  - *A peer route must match the target's catalog exactly* (`:196-201`) or it is refused.
  - *A refreshed grant whose digests drifted is a policy change* (`:334-350`): the route is marked `needs_reauthorization` and refused.
  - *The terminal publication is idempotent* (`:381-409`): `policy_checkpoint.publication_exists(...)` skips a task already published, and `compact_completed` prunes them.
  - *A stop that races the policy read is re-checked after admission* (`:449-459`): the source event seq is compared with the room's stop fence and the task cancelled.
  - *`local_profiles()` filters tombstone and marker-less directories* (`:129-141`) — feeding them to `validate_roster` failed `plan_next_task` on every cycle (#106847).
- **Edge cases:** `approve_room_task` (`:535-571`) requires the pending action to match the exact `(request_id, task_id, execution_generation)` and refuses any choice but `once`/`deny`.

### `tui_gateway/launch_profile_policy.py`
- **Purpose:** the launch-profile policy for a process that hosts several profile homes.
- **Key abstractions:** `capture_launch_env()` (`:33`); `activate_multi_profile_hosting()` (`:46`); `activate_multi_profile_hosting_eagerly()` (`:71`); `launch_secret_scope(launch_home)` (`:134`); `owner_secret_scope(home)` (`:157`); `launch_body()` (`:171`); `launch_profile_runtime_scope(launch_home)` (`:187`).
- **Non-obvious design decisions:**
  - *The process env is trusted exactly once* (`:9-13`): "frozen at activation, before any secondary code has run, never re-read afterwards" — an env-only policy (`TERMINAL_ENV=ssh`, a systemd-injected provider key) has no file to rebuild from.
  - *Activation is EAGER, at boot* (`:71-115`): the lazy version fired on the first request that asked for a second home, by which time idle-reaper ticks, cron start and MCP discovery had already run under single-profile assumptions.
  - *An unreadable profiles directory fails CLOSED* (`:88-96`): "we cannot prove the host is single-profile."
  - *`gateway.multiplex_profiles: false` is deliberately NOT consulted* (`:97-102`): it is retired, and honouring a stale `false` would serve a second profile with the LAUNCH profile's credentials.
  - *`.env` WINS over the env for the launch tenant* (`:134-155`): "activation is not purely 'stricter' for the launch tenant, it also changes which of the launch profile's own two values it sees."
  - *The launch profile is a tenant like any other* (`:187-217`): "under multiplexing 'override unset' is the fail-closed signal for an UNBOUND context."

### `tui_gateway/loop_noise.py`
- **Purpose:** suppress benign event-loop teardown noise on the gateway's serving loop.
- **Key abstractions:** `install_loop_noise_filter(loop)` (`:36`); `_is_benign_teardown(context)` (`:27`).
- **Non-obvious design decision:** the filter is gated on **both** the exception type **and** the `_call_connection_lost` callback (matched on `repr`) (`:28-35`) — "so the same error type raised elsewhere still reaches the default handler."
- **Edge cases:** one disconnect could emit 50+ tracebacks; the filter collapses exactly that class to one debug line. The install is idempotent (`_hermes_noise_filter_installed`).

### `tui_gateway/mcp_oauth_sessions.py`
- **Purpose:** session-backed MCP OAuth flows for the gateway RPC and the connection-card callback relay.
- **Key abstractions:** `start_flow(...)` (`:62`); `poll_flow(...)` (`:131`); `cancel_flow(...)` (`:150`); `deliver_callback_flow(...)` (`:161`).
- **Non-obvious design decisions:**
  - *A cap on in-flight flows* (`:26`, `:83-85`): `_MAX_PENDING = 12` — "so a runaway client can't exhaust ports/threads."
  - *A duplicate flow for the same (server, home) is refused* (`:86-88`).
  - *Completed sessions linger 15 minutes then are GC'd* (`:25`, `:76-78`).
  - *The flow is looked up by (session, server, profile)* (`:115-129`) — a foreign profile's session id is refused.
  - *`poll_flow` maps an `authorization_required` bridge state to `pending`* (`:139-141`) — the wire has exactly three states.
- **Edge cases:** a flow that fails before the authorization URL shuts its listener down and marks the error (`:105-113`); the client's captured redirect is relayed through `deliver_callback`, which still verifies `state` and rejects replays (`:161-174`).

### `tui_gateway/mcp_rpc_helpers.py`
- **Purpose:** the shared helpers for the per-profile MCP lifecycle RPCs.
- **Key abstractions:** `server_configs_with_sources(config_servers)` (`:12`); `summarize_server(name, cfg, plugin)` (`:37`); `record_mcp_add(entry, server_config, saved)` (`:58`).
- **Non-obvious design decision:** *`summarize_server` never returns a secret* — `env` is reduced to **sorted env-var names** and `oauth_tokens_present` is a boolean.
- **Edge cases:** the plugin discovery is wrapped in a bare `except` (`:31-32`) — a plugin manager that raises must not break the config listing.

### `tui_gateway/method_ctx.py`
- **Purpose:** the seam that lets `server.py` be split into topical modules without an import cycle.
- **Key abstractions:** `rebind(fn, g, _seen=None)` (`:16`); `HandlerRegistry` (`:44`); `bind_module(module_globals, server, skip=())` (`:78`).
- **Data flow:** a split module defines its functions normally → `server.py` calls `bind_module(globals(), server)` at the end of its import → the bodies are re-created with `types.FunctionType` against `server.py`'s namespace, so `global X` still mutates server state.
- **Non-obvious design decisions:**
  - *The `contextmanager` wrapper is unwrapped and re-wrapped* (`:24-26`): otherwise only the wrapper would see the server globals.
  - *Closure cells holding same-module functions are rebound too* (`:27-40`) — "so handlers produced by import-time decorator factories keep working."
  - *A split-module name collision is an error* (`:127-134`): "would overwrite" — two modules cannot publish the same helper name.
  - *`module_globals` is the caller's `globals()`, not `sys.modules[__name__]`* (`:80-82`): tests that `patch.dict(sys.modules)` around the server import would drop the submodule entries.
  - *Dispatch tables (dict/tuple/list) are rebound in place* (`:106-108`) so the split module's own view stays in sync.
- **Surprising:** the docstring names the whole trick in one sentence: "bodies are re-created with `types.FunctionType` against server.py's namespace, so they stay byte-identical."

### `tui_gateway/methods_bot_relay.py`
- **Purpose:** the gateway side of cross-connection A2A relay.
- **Key abstractions:** four RPCs — `bot_relay.roster.sync`, `bot_relay.outbox.drain`, `bot_relay.deliver`, `bot_relay.reply`.
- **Non-obvious design decisions:**
  - *The sender's fields are not trusted, but the delivery is not refused either* (`:88-104`): the Desktop is itself a logged-in client on every auth-gated gateway, so refusing took the relay offline exactly where it was needed. The author is derived from the caller's **minted** identity instead — "stable, unspoofable, and `is_bot`" — so a bot DM stays bot-authored.
  - *The drain is atomic* (`:57-66`): claimed envelopes move to `claimed/` so concurrent drains cannot double-deliver.
  - *A relayed "@hermes" is re-stamped* (`:117-127`): "a relayed '@hermes' is ANOTHER machine's default, so re-stamp it with the form this gateway can reply to."
  - *Every unreachable-target path collapses to one typed refusal* (`:130-137`): `runtime_unavailable`, which the sender retries on.
- **Edge cases:** a DM never targets an infra directory or a tombstone (`:108-115`).

### `tui_gateway/methods_browser.py`
- **Purpose:** browser connect/disconnect for the `browser.*` RPCs (CDP probing, no network I/O on status).
- **Key abstractions:** `_resolve_browser_cdp_url()` (`:13`); `_is_default_local_cdp(parsed)` (`:30`); `_connect_local_default(port, system, announce)` (`:52`); `_browser_connect(rid, params)` (`:106`).
- **Non-obvious design decisions:**
  - *The status path never probes* (`:13-27`): "``/browser status`` must be fast" — the config override is read without the HTTP discovery probe.
  - *A concrete `ws://…/devtools/browser/<id>` endpoint is never collapsed* (`:30-38`): "collapsing it to bare `http://…:9222` would break the connect."
  - *Dual-stack discovery* (`:56-63`): when another app squats the IPv4 loopback on the debug port, "an IPv4-only probe misses it AND hangs against squatters that accept TCP but never answer HTTP."
  - *The browsers are reaped twice* (`:157-159`): once before publishing the new endpoint (an in-flight tool call must not see the old supervisor closed) and once after (the default task's cached supervisor must drain against the new URL).
  - *The internal listing script is pre-confirmed* (`methods_complete.py:158-170`): otherwise every completion would fire an auxiliary-LLM call, and Desktop's ws reconnect loop turns that into model traffic from an idle machine (#115478).

### `tui_gateway/methods_browser_control.py`
- **Purpose:** browser-controller registration and result routing for the dashboard.
- **Key abstractions:** `_is_authenticated_identity(identity)` (`:38`); `_principal_digest(identity)` (`:50`); `_controller_method(...)` (`:81`) — the shared fail-closed gate.
- **Non-obvious design decisions:**
  - *The principal is server-derived* (`:50-54`): "stable per user, unspoofable without the minted identity" — a client-supplied `principal_id` is ignored and replaced by a digest.
  - *Membership, not slot identity* (`:106-114`): "a mirrored session holds a FanoutTransport, which is identical to no peer's transport, so slot identity would refuse every client here — the peer that registered the controller included."
  - *The capabilities come from an explicit allowlist* (`:8-9`): "no raw CDP/eval/uploads."
  - *The transport family is stamped into every scope* (`:30-31`): "an API transport can never address a dashboard controller."
  - *A protocol version mismatch is refused* (`:135-152`).
- **Edge cases:** `browser.controller.result` answers `accepted: false` for unknown/resolved/cancelled command ids (`:187-198`).

### `tui_gateway/methods_complete.py`
- **Purpose:** the completion / model-key / paste JSON-RPC handlers.
- **Key abstractions:** `paste.collapse` (`:36`); `complete.path` (`:231`); `complete.slash` (`:286`); `model.options` (`:322`); `model.save_key` (`:337`); `model.disconnect` (`:385`); `_path_completion_items` (`:248`); `_fuzzy_basename_items` (`:99`).
- **Non-obvious design decisions:**
  - *A large paste is spilled to a file* (`:36-52`) and the composer shows a placeholder — the model reads the file, not the composer buffer.
  - *The path listing runs in the session's own terminal backend* (`:148-182`): "relative paths and `~` resolve where the agent's commands do"; falling back to the gateway host "would show a plausible but wrong tree" (#112963).
  - *A non-local backend's `~` is expanded by the backend* (`:184-192`): "from a Windows gateway host, `os.path` would hand it `~\src` and list nothing."
  - *Profiles rank ABOVE file hits for a bare `@name`* (`:281-286`).
  - *`@/foo` means "foo, from here" unless the absolute prefix exists* (`:268-274`).
  - *A code-skew guard refuses model-serving RPCs* (`:301-319`): the TUI would otherwise resolve a post-update model string against stale cached modules (#99859).
  - *Saving a key rotates stale config.yaml mirrors in the same action* (`:359-366`).
  - *Disconnecting removes EVERY env var plus its mirrors* (`:391-398`): "or the provider resurrects in the picker after restart."
- **Edge cases:** a locked env var that holds nothing is not a refusal; the write is refused for the whole provider before anything is removed (`:396-404`).

### `tui_gateway/methods_complete_helpers.py`
- **Purpose:** the `@`-mention / path fuzzy ranking and the repo file listing behind `complete.*`.
- **Key abstractions:** `_list_repo_files(root)` (`:74`); `_fuzzy_basename_rank(name, query)` (`:100`); `_abs_completion_prefix_exists(path_part)` (`:133`).
- **Non-obvious design decisions:**
  - *The ranking is a five-tier ladder* (`:100-131`): exact · prefix · word-boundary/camelCase hit (`chrome` → `appChrome.tsx`) · substring · subsequence. Lower (tier, len) wins.
  - *`git ls-files` runs with a hardened environment* (`:31-36`): "runs on a keystroke in the session cwd, and `ls-files` reads the index, which executes a repo-configured `core.fsmonitor`" (GHSA-7x36-8jrh-v4pw).
  - *The file listing is cached for 5 s per root* (`:16-17`, `:76-95`) — "so rapid keystrokes don't respawn git"; stale roots are dropped on read so one root per worktree does not stay pinned for the process lifetime (#62950).
  - *The cache is capped at 20 000 files* (`:18`).

### `tui_gateway/methods_config.py`
- **Purpose:** the config / projects / setup JSON-RPC handlers (`config.get` lives here; `config.set` in `methods_config_set`).
- **Key abstractions:** `_CONFIG_GETTERS` (`:250`); `config.get` (`:289`); `_readiness_share` (`:318`); `_readiness_check` (`:353`); `setup.status` (`:383`); `diagnostics.share_nous` (`:505`).
- **Non-obvious design decisions:**
  - *Readiness probes are single-flighted per (kind, profile, provider)* (`:22-64`): a slow probe (blocked keyring, OAuth refresh) used to run one provider-resolution call per overlapping poll, each occupying another shared worker. An overlapping poll gets a short join grace; a probe that outlives it answers a **retryable** error (5097), never a fabricated `ok`.
  - *The done-callback is registered OUTSIDE the lock* (`:338-343`): "a probe that already settled runs the callback inline on this thread, and the callback acquires the same non-reentrant lock — under the lock that self-deadlocks the RPC worker."
  - *`config.get` is a table of getters* (`:250-283`): one key → one normalised value, so the TUI and the desktop render the same words.
  - *`mcp_rev` is a hash of the MCP-relevant sections* (`:246-256`): "a /skin write bumps mtime but must not cost an MCP reconnect."
  - *The diagnostics upload is bounded and force-redacted* (`:505-540`): at most 4 extra files, 512 KB each, sanitised labels — "not an arbitrary upload surface."
- **Edge cases:** an unknown profile answers `ok=False` with an error, never a JSON-RPC error (`:365-369`); the probe runs under the *profile's* secret scope because "the first profile-scoped read inside the resolver fails closed and the UI shows onboarding" (`:375-385`).

### `tui_gateway/methods_config_set.py`
- **Purpose:** the single `config.set` method, dispatched on `key`.
- **Key abstractions:** `_CONFIG_SETTERS` (`:488`); `_SESSION_SCOPED_KEYS` (`:503`); `config.set` (`:509`); `_set_model` (`:111`); `_set_fast` (`:174`); `_set_yolo` (`:281`); `_set_reasoning` (`:323`); `_word_setters()` (`:354`); `_toggle_setters()` (`:401`).
- **Non-obvious design decisions:**
  - *A model switch is DEFERRED while a turn streams* (`:73-96`): "agent.switch_model() mutates fields the worker thread reads every iteration" — the pick is stashed and applied at the next turn start, and the *selection guards* run at stash time, "the only moment a confirm round-trip is possible."
  - *A compute-host session ALWAYS defers* (`:127-134`): the live agent is in the child process, so a direct switch "would build a SECOND agent in the server, switch that copy, and leave the child on the old model."
  - *A stale session id never becomes a global write* (`:504-507`): "it answers 4001 so the client resumes, never the global write."
  - *`yolo` is session-scoped by default* (`:281-300`): "scope='global' … flips persistent approvals.mode"; the session branch persists on the session row.
  - *`/new` clears the session's runtime pins* (`:334-341`): "session-scoped runtime overrides do NOT carry forward — the fresh agent re-derives model/provider, reasoning, and service tier from config.yaml."
  - *`fast` is validated against the target model* (`:199-215`): "a pre-build session may carry a picked model (desktop draft): validate against THAT."
  - *`TERMINAL_CWD` is only published for the launch profile* (`:435-449`): "never publish an explicit or session-bound secondary profile's cwd into that process-wide carrier."
  - *The two setter tables are built per call* (`:354-357`, `:401-402`): "the specs reference server.py globals (rebound at install)."

### `tui_gateway/methods_connectors.py`
- **Purpose:** the connector catalog / authorization handlers.
- **Key abstractions:** `_connector_guard` (`:35`); `_session_owner` (`:57`); `_session_connector_gate` (`:114`); `_session_connector_rpc` (`:130`); `_connector_rpc` (`:224`); `_install_update_hook` (`:425`).
- **Non-obvious design decisions:**
  - *The RPC origin is captured in a ContextVar* (`:11-16`): the owner session and its profile home are remembered so a later call can prove it is the same owner.
  - *Ownership is re-checked AFTER the work* (`:247-250`): "session ownership changed" — a session that was handed away mid-call does not get the answer.
  - *Connectors are refused on a compute-host session* (`:67-71`): "Connectors must be managed on the session's compute host."
  - *The desktop page's surface is taken from the REQUEST, not the env* (`:290-302`): "the backend's `HERMES_DESKTOP` is absent on a URL or cloud backend and would name the caller `tui`."
  - *An account-owned connect creates the guest identity on demand* (`:84-93`): "Opening the Connectors page or connecting from it is the user asking for apps."
  - *The update hook is installed once* (`:425-431`) and the event is broadcast to the owning session's sid, found by `session_key` + `profile_home` (`:394-424`).

### `tui_gateway/methods_connectors_account.py`
- **Purpose:** the account-scoped connector RPCs — tools, catalog, accounts, policy.
- **Key abstractions:** `_account_method(...)` (`:17`); `connectors.policy.get` (`:198`); `connectors.policy.set` (`:229`).
- **Non-obvious design decisions:**
  - *Every handler is wrapped by one decorator* (`:17-53`): gate → validate → call → map `GatewayAuthError` → map anything else to a typed refusal.
  - *The policy write is a compare-and-set* (`:229-253`): `expectedRevision` goes into the body, and `policy_changed` maps to 4090 with "Refresh and try again."
  - *`org_required` is re-raised, not swallowed* (`:41-45`, `:150-152`): the client must be told to pick an organization.
  - *The policy body is projected through a per-mode model* (`:255-292`) so the wire shape is the contract's discriminated union.

### `tui_gateway/methods_display.py`
- **Purpose:** the Desktop app's door to a profile's headless Xfce screen.
- **Key abstractions:** `_display_snapshot()` (`:31`); `_install_lease_listener()` (`:38`); `_mint_viewer_id(requested)` (`:127`); `_foreign_viewer_id(rid, viewer_id)` (`:139`); `display.observe` (`:151`); `display.install` (`:187`).
- **Non-obvious design decisions:**
  - *The viewer id is a per-connection capability* (`:117-135`): minted ids live in a `WeakKeyDictionary` keyed by the transport, so a reconnecting pane keeps its identity "and its lease — while nobody can claim an id minted for another connection."
  - *A thumbnail is dropped when the lease moves during the grab* (`:62-81`): "a takeover racing the framebuffer read means the frame may already be the human's session."
  - *Stopping is ONE lease transition* (`:95-118`): "a takeover landing between a separate human_holds() check and the release would be acknowledged to the human and then silently revoked here."
  - *The sudo card is app-level, with no session* (`:198-203`): "a client-supplied session_id could route the masked password card into another window's chat."
  - *The install worker inherits the caller's context* (`:208-217`): "the caller's transport (so the sudo card reaches the CLIENT that clicked Install) and the profile scope … are carried across with `copy_context()`."
  - *The install is claimed atomically* (`:224-227`): "two fast clicks cannot both start a package manager."
- **Edge cases:** the install is refused when the profile's screen lives inside a terminal sandbox (`:193-197`).

### `tui_gateway/methods_display_watch.py`
- **Purpose:** the cross-process lease watcher — `display.lease` for transitions made *outside* `hermes serve`.
- **Key abstractions:** `_poll_lease_files()` (`:127`); `_poll_runtime_files()` (`:81`); `_poll_idle_screens()` (`:110`); `_notify_agents_of_screen_change(...)` (`:49`).
- **Non-obvious design decisions:**
  - *The lease file is read only when its mtime moved* (`:127-148`), and the first sighting seeds silently.
  - *An in-process transition is marked as seen* (`:150-170`): "methods_display's listener broadcasts in-process transitions; only then is the file move ours to skip" — so a change broadcasts exactly once.
  - *A screen change is staged as a per-turn note on the model's live agents* (`:49-79`): "The system prompt is byte-stable and only rebuilt at compaction, so a screen started or stopped mid-session would otherwise stay unknown to the model until then." The note rides the one-shot user-message channel, "landing behind the cached prefix."
  - *Idle screens are stopped on a 30 s cadence* (`:110-125`).

### `tui_gateway/methods_free_tier.py`
- **Purpose:** the Nous free-tier handlers.
- **Key abstractions:** `free_tier.status` (`:22`); `_trial_claimable()` (`:59`); `free_tier.provision` (`:66`); `free_tier.claim_nudge` (`:105`).
- **Non-obvious design decisions:**
  - *`free_tier.status` is a PURE read* (`:22-56`): "an identity is never created as a side effect of polling this (NS-845 Q1.2)."
  - *`available` and `enabled` are different questions* (`:22-31`): `available` = a guest that carries inference; `enabled` = available **or** the trial can still be claimed. Whether inference actually runs is a *route* question answered by `setup.runtime_check.free_tier`.
  - *The sign-in offer is claimed before it is shown* (`:105-114`): "`claimed` is true for exactly one caller each time an offer comes due."
  - *A failed claim leaves no guest and no chat* (`:76-92`): "the next launch is still a first install and tries again."

### `tui_gateway/methods_groups.py`
- **Purpose:** the hosted-room JSON-RPC surface.
- **Key abstractions:** `bind_server(server)` (`:34`); `start_hosted_room_service()` (`:41`); `stop_hosted_room_service(timeout=5.0)` (`:59`); `get_hosted_room_service()` (`:72`); `_room_method(...)` (`:182`); `_passthrough(...)` (`:465`).
- **Non-obvious design decisions:**
  - *`groups.capabilities` is machine-readable* (`:217-247`): it lists the protocol features ("authority_epoch", "coordinator_fencing", "monotonic_log", "idempotent_send", "replayable_disband", …) so a peer can tell what this gateway implements.
  - *RoomLink is advertised only when it is actually usable* (`:230-245`): a missing durable run store or a missing grant secret disables it with a reason, rather than advertising a link that cannot work.
  - *A promotion requires `confirm: true`* (`:506-513`): "the caller asserts the previous authority can no longer commit."
  - *The room service is process-owned and idempotent* (`:41-57`), and it is restarted when the db path changes.
  - *`_room_method` is the shared error envelope* (`:182-215`): a room error maps to a client error with a `reason`, anything else to a generic code.

### `tui_gateway/methods_i18n.py`
- **Purpose:** the pluggable-language handlers.
- **Key abstractions:** `i18n.languages` (`:27`); `i18n.catalog` (`:36`).
- **Non-obvious design decision:** *the catalog is a LAYER, not a whole catalogue* — the renderer merges the pack + user overlay over its own bundled strings.

### `tui_gateway/methods_images.py`
- **Purpose:** the image-generation handler (the ws twin of the `image_generate` tool).
- **Key abstractions:** `_image_to_data_url(ref, cap)` (`:13`); `image.generate` (`:55`).
- **Non-obvious design decisions:**
  - *The result is a data URL* (`:1-4`): "a remote desktop can't read a gateway file path and hosted URLs are often CORS-opaque to a renderer canvas."
  - *A provider URL is fetched through an SSRF-safe client* (`:24-27`): "Provider-result URLs are remote-party-controlled."
  - *The size cap is enforced twice* (`:32-45`): the `content-length` header AND the streamed byte count, because the header lies.
  - *`image_data` is omitted when the download fails* (`:90-93`) so the caller falls back to `image`.

### `tui_gateway/methods_machine.py`
- **Purpose:** `machine.facts` — the host summary the desktop first-run onboarding branches on.
- **Non-obvious design decisions:** *the method is unscoped on purpose* (`:15-16`): "hardware and the OS account belong to the host, not to any profile home"; and the account's full name is filtered out (`:19-21`) — it reaches the desktop only on the onboarding name card.

### `tui_gateway/methods_onboarding.py`
- **Purpose:** the first-run onboarding — one chat in the default profile, driven by `setup_beat`.
- **Key abstractions:** `_run_state(assume_fresh)` (`:29`); `_due_stamp()` (`:56`); `start_due_boot()` (`:88`); `_claim_before_run(...)` (`:127`); `onboarding.start` (`:145`); `_discard_unfinished_runs(db, stored_ids)` (`:252`); `_onboarding_toolsets(...)` (`:283`).
- **Non-obvious design decisions:**
  - *The due answer is computed OFF the RPC path at boot* (`:88-111`): "Serve boot, desktop's local backend: work out the due answer off the RPC path", with `finish()` marking the boot done even when the computation raises, "so no reader waits on a dead thread."
  - *The due answer is cached by a file signature* (`:56-70`): the root config, the default profile's config/.env/auth.json, the shared Nous store and the managed layer's files.
  - *The trial is claimed BEFORE the run* (`:127-143`): "so a crash after the claim makes this machine read as used still opens onboarding next launch."
  - *Two windows pressing start get one chat* (`:142-144`, `:152-154`): a lock held through the opening submit, and a rerun never claims the trial.
  - *A run the app was closed on does not count* (`:252-272`): its chat is closed and deleted, and the run ends as `replaced` so it is never resumed.
  - *The onboarding toolset is decided once, at agent build* (`:283-300`): "the tool array is part of the cached prefix."
- **Edge cases:** a chat with no messages never got its opening (a restart between start and the first turn) — the opening is re-sent (`:212`).

### `tui_gateway/methods_plugin_catalog.py`
- **Purpose:** one curated-catalog entry, resolved by the backend.
- **Non-obvious design decision:** the deep link moved server-side (`:3-9`): the docs-site JSON "answers with a cross-origin 301, so the browser's CORS check fails on the redirect and every link reported the catalog as unreachable." The backend already reads the live catalog, so the lookup lives here.
- **Edge cases:** the loaders never raise — a dead host falls back to the cache, then to the in-tree catalog; nothing readable at all is `unavailable`, "never a guess" (`:33-35`).

### `tui_gateway/owner_forward.py`
- **Purpose:** the serve → owner cutover for one typed prompt (RT-37, #140385).
- **Key abstractions:** `forwardable(refusal, session, text, params)` (`:94`); `_Relay` (`:120`); `forward_prompt(sid, session, text, ...)` (`:219`); `OwnerUnavailable` / `OwnerNotRunning` / `OwnerUnconfirmed` (`:56-66`).
- **Non-obvious design decisions:**
  - *The legacy backend REFUSES a turn while the gateway's durable ledger holds work* — "a legacy turn would run beside the canonical FIFO and write the transcript twice." The prompt is forwarded to the owner instead.
  - *Only `message.start` and `message.complete` are relayed* (`:39-43`): "a Desktop turn that streamed nothing re-reads the stored transcript at `message.complete`, which brings the user's own row (written by the owner, not by this backend) and the reply in their committed order."
  - *The refusal list is exactly the owner's pre-commit refusals* (`:44-56`): "only these prove nothing will run" — `storage_unavailable` and an internal error can follow the commit, so they are never listed.
  - *An unconfirmed admission is never "nothing was sent"* (`:184-198`): "a resend would run a second copy."
  - *The loopback dial never goes through an HTTP proxy* (`:85`): "websockets>=14 honours it by default."
  - *The owner payload is re-projected onto this wire's contract* (`:103-118`): unknown fields are dropped and the payload is re-validated.
- **Edge cases:** losing the owner mid-relay emits an empty `message.complete` (`:213-217`) so the bubble settles and the client re-reads the stored transcript.

### `tui_gateway/plugin_inject.py`
- **Purpose:** the Ink TUI / desktop host for `PluginContext.inject_message`.
- **Key abstractions:** `inject_tui_session_message(session_key=..., content=..., plugin_id=...)` (`:27`); `install_tui_message_injector(manager=None)` (`:71`).
- **Non-obvious design decisions:**
  - *A separate slot from the messaging gateway's* (`:3-6`): "A messaging gateway and this process can both be live; they must not share one slot (last writer would win)."
  - *Routing uses the durable `session_key`, not the ephemeral UI session id* (`:37-52`).
  - *A busy session only queues* (`:55-60`): "a notice must not cancel in-flight work"; an idle session drains so the queued prompt starts a turn.
  - *The clear is identity-conditional* (`:18-20`): "this process cannot drop that replacement."
- **Edge cases:** a lazy, closing or finalized session is refused (`:53-55`).

### `tui_gateway/profile_roster_cache.py`
- **Purpose:** memos for `profiles.list`'s per-profile fields, keyed on the files they derive from.
- **Key abstractions:** `store_signature(profile_path)` (`:81`); `profile_yaml_signature(profile_dir)` (`:97`); `cached_session_fields(...)` (`:103`); `cached_ui_meta_fields(...)` (`:112`); `_cached(cache, key, signature, compute, copier)` (`:64`).
- **Non-obvious design decisions:**
  - *Only DERIVED values are cached* (`:24-28`): "the raw readers keep their uncached contract: `_read_profile_yaml` is also used by the ui_meta CAS writer, which reads that document, mutates it and writes it back, and a stale read there would overwrite a newer file."
  - *The signature carries the inode for `profile.yaml`* (`:97-99`): "the atomic writers rename a temp file into place."
  - *A racy mtime means NO cache* (`:89-93`): "None too while a file's mtime is fresh enough that a same-tick, same-size WAL rewrite could still hide behind it."
  - *An empty `-wal` sidecar is ignored* (`:86-88`): "our own read-only open creates an EMPTY -wal sidecar on a store that never had one."
  - *It is its own module because `bind_module` COPIES module-level dicts* (`:29-32`): "a cache declared there would be written to one copy and read from another."

### `tui_gateway/model_switch.py`
- **Purpose:** the model-switch transaction — the one place a `/model` pick becomes a live agent.
- **Key abstractions:** `_apply_model_switch(...)` (`:308`); `_commit_agent_switch(...)` (`:280`); `_expensive_model_confirm(...)` (`:261`); `_sync_agent_model_with_config(...)` (`:450`); `_sync_bot_capabilities(...)` (`:412`); `_snapshot_agent_model_runtime` (`:18`).
- **Non-obvious design decisions:**
  - *A failed switch is a NO-OP* (`:280-300`): the in-place swap rolled the agent back and re-raised, so the whole commit (worker restart, persist, marker, override, config write) is aborted — "a failed switch is a no-op; surface a clean error to the client" (#50163).
  - *The per-session override is NOT written to process-global env* (`:374-378`): "the desktop hosts every same-profile session in one process, so `os.environ` would leak the switch to all."
  - *The reasoning effort rides with the pick and shares its scope* (`:389-410`): it runs **after** `agent.switch_model` (which re-resolves `reasoning_config` from config.yaml, so an earlier write would be clobbered).
  - *The switch marker is appended AFTER the switch* (`:292-296`), so the transcript reads in the order things happened.
  - *A config change is adopted at turn start, never written back* (`:450-497`): "this sync ADOPTS a config.yaml change; it must never write config back (that is how `hermes --tui -m` once leaked into config.yaml)."
  - *The "seen" target is recorded BEFORE the switch* (`:479-481`): "a broken config gets one attempt per edit, not per turn."
  - *A profile edit can supersede an explicit pick* (`:466-476`): both fields are cleared so the old composer pick cannot resurface on rebuild.
  - *A Bot Chat rebuilds itself when its capabilities change* (`:412-448`): "Bot Chats are eternal sessions with toolsets/MCP baked in at construction, so a capability edit would otherwise wait for `/new`."
  - *`--reasoning` warnings fire before the pick is stashed* (`:499-516`): "the client can still turn the response into a confirm prompt; only pre-resolution inputs exist for the model guards, so they can only under-fire — `_apply_model_switch` is the backstop."
- **Edge cases:** a callable API key (Azure Entra bearer) is kept unchanged — `str()` would yield `"<function ...>"` and poison switch validation (`:213-220`).

### `tui_gateway/project_tree.py`
- **Purpose:** the sidebar's project/repo tree — turning a flat session list into a folder-shaped hierarchy.
- **Key abstractions:** `build_project_tree(...)` (`:406`); `_project_node(...)` (`:229`); `_auto_buckets(...)` (`:369`); `_disambiguate_labels(...)` (`:190`).
- **Non-obvious design decisions:**
  - *The tree is built in FOUR explicit tiers* (`:437-497`): Tier 1 explicit user projects (always shown, even with 0 sessions) → Tier 2 auto projects from leftover sessions → Tier 3 discovered repos with no sessions, folded to their common root → Tier 0 homeless sessions, which lead the list.
  - *Auto-project labels are disambiguated* (`:490`): "Auto-project basename labels can collide; explicit projects keep their user-chosen names."
  - *The response carries `scoped_session_ids`* (`:500`): the caller knows exactly which sessions the tree covered, so an unplaced session is a real answer, not a silent omission.
  - *Junk roots are filtered* (`:481`): a deleted worktree must not become a tree node.

### `tui_gateway/render.py`
- **Purpose:** the bridge to the optional Python-side rich renderer.
- **Key abstractions:** `_rich(name, *args, cols)` (`:14`); `render_message` (`:27`); `render_diff` (`:31`); `make_stream_renderer` (`:35`).
- **Non-obvious design decision:** *every failure degrades to `None`* (`:21-24`): a missing module, an `AttributeError`, a `TypeError` (retry without `cols` for older signatures) or any other exception returns `None` and the TUI falls back to its own `markdown.tsx`.

### `tui_gateway/rpc_dispatch.py`
- **Purpose:** JSON-RPC admission and worker dispatch.
- **Key abstractions:** `handle_request(req)` (`:10`); `_handle_admitted_request(req)` (`:17`); `dispatch(req, transport)` (`:47`).
- **Non-obvious design decisions:**
  - *An unknown method's error tells the user what to do* (`:22-23`): "unknown method: X — the client and the Hermes backend are out of sync (different versions); run `hermes update` and restart both."
  - *The retirement gate is checked twice* (`:11-16`, `:59-61`): the reservation is acquired **before** enqueueing, because "a queued handler has accepted work even though no worker runs yet"; the release is attached to the future's done callback, "also releases cancelled queued futures; the worker's own finally would never execute."
  - *A client response frame is never answered* (`:49-56`): "the renderer answering one of OUR requests (clarify, approval, …): no response frame goes back."
  - *The bound transport travels into the pool* (`:66`): `contextvars.copy_context()` — "the pool worker must see the bound transport."
  - *The contract is validated twice* (`:26-31`, `:38-42`): the params on the way in, and `check_params_accepted` + `check_result` on the way out.

### `tui_gateway/server_requests.py`
- **Purpose:** the backend's half of the peer-to-peer JSON-RPC: asking the renderer a question and waiting.
- **Key abstractions:** `ServerRequest` (`:70`); `send(method, sid, params, timeout, qids)` (`:206`); `send_async(...)` (`:257`); `resolve_response(frame, transport)` (`:303`); `open_requests(sid)` (`:365`); `pending_kind(sid)` (`:378`); `NOT_SHOWN_CODE` (`:146`).
- **Non-obvious design decisions:**
  - *Ids are `srq-<12 hex>`* (`:85`): "strings never collide with client-minted integer ids, and the random part keeps a compute-host child's requests distinct from the parent's when both reach one socket."
  - *A client that never advertised `client.capabilities` fails FAST* (`:180-186`): "a WebSocket client that never did is a build older than this half of the protocol — it drops the frame silently and the agent would wait the full deadline (clarify's 300s) for nothing."
  - *The verdict is the state committed under the lock, never `wait()`'s return value* (`:243-247`): "a response frame can land after the deadline expires and before this removal, and settlement already popped it."
  - *A cancel that lands between publish and write is re-ordered* (`:198-204`, `:249-252`): the `request.cancel` must follow the frame, not precede it.
  - *A decline settles only when EVERY answering client declined* (`:283-300`): "a bystander window must not beat the owner", and with no owner at all the agent gets the refusal "now rather than at the deadline" (#119333).
  - *The wait's own death withdraws the request* (`:228-240`): "or it stays in `_open` forever — replayed to every reconnecting client and reported by `pending_kind()` as a human still being waited on."
  - *`open_requests` is the reconnect mechanism* (`:365-370`): unanswered requests are handed back as snapshots, so the notification replay ring never has to carry "a question still waiting for an answer."
- **Edge cases:** `open_request_count()` is the process's "a human is waiting on me" signal — the process must not be treated as idle (`:374-377`).

### `tui_gateway/session_compression.py`
- **Purpose:** live compression — config hot-reload onto a running agent, a pending model switch applied, `/compress` (refused while a turn holds the lock) and the session-key sync after a compression.
- **Key abstractions:** `_tui_compression_config_signature(cfg)` (`:17`); `apply_config_to_agent(...)`; `compress_session(...)`; `_sync_session_key_after_compress(...)`.
- **Non-obvious design decisions:**
  - *The compression config signature is a STABLE SNAPSHOT* (`:15-19`): "the messaging-gateway cache-busting extract plus `idle_compact_after_second…`" — only the keys that must apply next turn are compared, so an unrelated config write does not force a re-read of the whole file.
  - *A compression that holds the lock refuses with `CompressionLockHeld`* (`:1-2`): the caller is told to wait rather than being queued behind a turn.
  - *The queued-prompt generation is bumped* (`:341-343`): "drain must not dispatch on the continuation (its envelope is restored to the queue)."

### `tui_gateway/session_history.py`
- **Purpose:** the transcript projection — what the client sees as the conversation.
- **Key abstractions:** `_strip_prompt_echo(message, prompt)` (`:467`); `_turn_failure_detail(error, reason, prompt)` (`:497`); `_inflight_text(value)` (`:382`); `_start_inflight_turn(...)` (`:386`).
- **Non-obvious design decisions:**
  - *A failure record carries a reason, never the user's content* (`:497-530`): `redact_sensitive_text(..., force=True)` runs first, and a redaction failure yields `"<unredactable>"` — "never fail open."
  - *A 4xx body that quotes the prompt back is stripped* (`:520`): `_strip_prompt_echo` uses the *submitted* prompt as the thing to look for, because "ordinary private prose is not pattern-shaped."
  - *The collapse happens BEFORE the truncation* (`:524`): "a quote must not survive the cut."
  - *The redaction is two separate contracts* (`:509-517`): pattern-shaped secrets and prompt echo are different shapes, so they need different tools.
- **Edge cases:** the detail is capped (`_TURN_FAILURE_DETAIL_LIMIT`) with an ellipsis.

### `tui_gateway/session_reaper.py`
- **Purpose:** the idle/TTL reapers, the orphan sweep, the LRU cap and the backend heartbeat.
- **Key abstractions:** `_transport_is_dead(transport)` (`:159`); `_session_is_lru_evictable(sid, session)` (`:180`); `_sessions_quiescent(exclude)` (`:199`); `_schedule_startup_orphan_sweep()` (`:516`); `_start_backend_heartbeat_refresher()` (`:477`).
- **Non-obvious design decisions:**
  - *A fan-out transport is dead exactly when no peer is alive* (`:166-176`): "a fan-out is never the sentinel and has no `_closed` of its own, so without this arm every multi-client session reads as alive forever — the TTL reaper, the LRU cap and the #77129 disconnect revalidation all gate on this predicate."
  - *The LRU exemptions do NOT have an age gate* (`:180-198`): "eligible the moment it loses its client" — never evict mid-turn, awaiting input, still building, or owning live delegated work.
  - *A lazy watch session is not immortal* (`:192-194`): "lazy watch sessions never start a build, so their unset `agent_ready` must not make them immortal."
  - *The memory trim holds the GIL* (`:199-210`): "20-50 s on multi-GB heaps — which stalls the event loop, drops WS clients past the write deadline and interrupts turns," so a non-forced trim waits for quiescence.
  - *The startup orphan sweep is DELAYED by the WS-orphan grace window* (`:516-531`): "a client reconnecting right after a restart can `session.resume` its row first" (#65194).
  - *The heartbeat row is written SYNCHRONOUSLY first* (`:484-492`): "so this process's own sweep sees itself in the heartbeat table."

### `tui_gateway/session_transports.py`
- **Purpose:** additive transport membership for shared live sessions.
- **Key abstractions:** `_attach_session_transport(session, transport)` (`:98`); `_detach_session_transport(...)` (`:129`); `_session_client_answers_requests(sid)` (`:67`); `_transport_auth_user_id(transport)` (`:41`).
- **Non-obvious design decisions:**
  - *A queued fan-out is flattened, never nested* (`:100-106`): "Snapshot and attach share detach's lock: a queued fanout cannot resurrect a still-open peer removed during flattening."
  - *Ownership is not enforced, only logged* (`:88-96`): "a second login sharing a session is only logged, and the agent keeps the creator's user id."
  - *The surviving mailbox is kept on detach* (`:135-140`): "collapsing to a bare transport lets new frames overtake its already queued terminal/control events."
  - *The leaf lock is separate* (`:9-10`): "callers may hold sessions/history locks, never acquire them here."

### `tui_gateway/slash_fuzzy.py`
- **Purpose:** description-aware fuzzy scoring for the slash menu.
- **Key abstractions:** `score_slash_completion_item(item, query)` (`:44`); `fuzzy_rank_slash_items(items, catalog, query)` (`:59`); `tokenize_search_text(value)` (`:29`).
- **Non-obvious design decision:** *the DESCRIPTION is matched at a +3 penalty* (`:38-42`): "so `/summary` surfaces a command whose description mentions summaries." Exact (0) → prefix (1) → substring (2) → description token (3/4/5). Lower wins; `math.inf` = a miss.
- **Edge cases:** the scorer is mirrored in TypeScript (`ui-tui/src/app/slash/fuzzyScore.ts`) — one algorithm, two languages.

### `tui_gateway/slash_worker.py`
- **Purpose:** the persistent slash-command worker — one `HermesCLI` per TUI session, spoken to over JSON lines.
- **Key abstractions:** `main()` (`:170`); `_run(cli, command)` (`:139`); `_start_parent_death_watchdog(original_ppid)` (`:84`); `_watchdog_parent(parent_pid, ...)` (`:56`); `SkillSlashRefused` (`:104`).
- **Non-obvious design decisions:**
  - *The import path is hardened before anything else* (`:17`): "this worker is spawned as `-m tui_gateway.slash_worker` with the user's CWD, so `import cli` would otherwise resolve `utils` to a colliding local package and crash the child in a retry loop" (#51693).
  - *The watchdog uses the parent PID the gateway PASSED* (`:56-70`): "a fast exit cannot make this child mistake a subreaper for its original parent before the watchdog starts … a reused PID can never pass for the parent."
  - *The heavyweight CLI import is behind the watchdog* (`:183-186`): "importing it at module load left a reparenting window before `main()` could snapshot PPID."
  - *The orphaned child gets a grace period* (`:84-95`): it waits up to `_ORPHAN_GRACE_S` for the in-flight command to flush before `os._exit(0)`.
  - *A skill command is refused BEFORE the process* (`:113-126`): "only a positive hit is refused, so a broken skill index does not block `/status`."
  - *ANSI is stripped at one choke point* (`:165-168`): "Desktop chat bubbles render plain text, not ANSI."
  - *The composed prompt is harvested back to the gateway* (`:143-149`): "a command like /prompt parks the composed text on the one-shot `_pending_agent_seed` for the interactive REPL loop — but this worker has no REPL."
  - *The worker trims memory at every command boundary* (`:206-215`): "Workers persist for the TUI session."

### `tui_gateway/synthetic_turn.py`
- **Purpose:** a GIL-heavy synthetic turn driver for the turn-isolation certification harness.
- **Key abstractions:** `SyntheticHeavyAgent` (`:44`); `synth_turn_armed()` (`:38`); `maybe_build_synthetic_agent(session_id, model_override)` (`:117`).
- **Non-obvious design decisions:**
  - *The burn must be pure-Python* (`:11-14`): "a network/sleep stub releases the GIL and a green off it is fake" — the regime under test is interpreter-wide GIL starvation.
  - *The seam is dead unless an env var arms it* (`:38-40`), and when armed it replaces the agent on BOTH the in-process and compute-host paths "so the isolation boundary is the only variable."
  - *The intensity spec rides in the prompt text as JSON* (`:78-86`), with env/built-in defaults for anything else.
  - *The checksum is folded into the reply* (`:107-112`): "so the loop can't be eliminated and the turn is deterministic."

### `tui_gateway/theme_bridge.py`
- **Purpose:** `set_theme`'s desktop bridge — apply values, or open a picker card that waits for the user.
- **Key abstractions:** `theme_request(sid, payload)` (`:19`); `THEME_TIMEOUT_S = 15` (`:11`); `THEME_PICK_TIMEOUT_S = 300` (`:12`).
- **Non-obvious design decision:** *the two timeouts differ by 20×* (`:9-12`): "Applying a theme is a store write the renderer answers in ms; a picker waits for a person." And a dismissed picker is told apart from an expired one (`:31-33`).

### `tui_gateway/tool_progress.py`
- **Purpose:** the tool-progress event surface — how a tool call is narrated while it runs.
- **Key abstractions:** `_on_tool_start(sid, tool_call_id, name, args)` (`:282`); `_on_tool_complete(...)` (`:330`); `_prepare_tool_result_metadata(...)` (`:311`); `_PROGRESS_HANDLERS` (`:499`); `_progress_subagent(...)` (`:489`).
- **Non-obvious design decisions:**
  - *The tool lifecycle is emitted from the tool-call part itself* (`:260-280`): a card tool's `tool.start`/`tool.complete` are a pair, and the "required for UI" set is consulted by both guards so a `tool.complete` can never arrive without its `tool.start`.
  - *Subagent lifecycle survives `display.tool_progress=off`* (`:517-520`): "Subagent lifecycle is application state (Desktop status stack, TUI spawn tree), not tool-progress chrome."
  - *`subagent.text` is relayed ONLY to the child's own mirror* (`:490-494`): "on the parent it's hundreds of ignored frames, so skip it."
  - *A child runs under the PARENT's profile* (`:495-501`): the mirror and the liveness registry are scoped to that home; "a parent record already gone … cannot be attributed to a profile — bind nothing rather than fold the run into the launch profile."
  - *The reasoning text is dropped, the frame kept* (`:481-483`): "Same rule as `subagent.thinking`: frame kept, text dropped."
  - *There is NO blanket tool-progress gate* (`:521-523`): "reasoning.available and moa.* are reasoning content that follow `display.show_reasoning` in their own handlers."

### `tui_gateway/transport.py`
- **Purpose:** the transport abstraction so one dispatcher runs over stdio and WebSocket.
- **Key abstractions:** `Transport` (`:19`); `StdioTransport` (`:41`); `FanoutTransport` (`:271`); `TeeTransport` (`:334`).
- **Non-obvious design decisions:**
  - *The request's transport lives in a ContextVar* (`:1-7`): "so pool-dispatched handlers write to the right peer; with nothing bound `server.write_json` falls back to the module-level `StdioTransport`."
  - *The stdio transport resolves `_real_stdout` LAZILY* (`:8-10`): "so tests that monkey-patch it keep working."
  - *The secondary of a `TeeTransport` swallows failures* (`:346-351`): "The primary's return value (and exceptions) determine the result; secondaries swallow failures so a wedged sidecar never stalls the main IO path." The primary is written FIRST "so a slow sidecar (WS publisher) never delays Ink/stdio."

### `tui_gateway/turn_marker.py`
- **Purpose:** durable interrupted-turn markers for the auto-continue path.
- **Key abstractions:** `record_turn_start(...)` (`:120`); `clear_turn_marker(...)` (`:138`); `read_turn_marker(...)` (`:145`); `marker_writer_state(entry)` (`:68`).
- **Non-obvious design decisions:**
  - *A marker is durable proof a turn STARTED — never proof its writer DIED* (`:68-78`): "Two backends sharing one HERMES_HOME break that assumption: A is mid-turn on session S while B resumes S, and B used to read A's marker as crash evidence and start a second turn over it" (#94778). The liveness check pairs the pid with the process's **start time**, "so a recycled pid cannot pass as the original writer."
  - *"unknown" is the safe answer* (`:76-77`): "it leaves the marker alone without claiming its writer is gone."
  - *A cross-process file lock guards the marker file* (`:36-42`): "without this flock one's stale load → store resurrects a marker the other just cleared (a finished turn auto-continues again)."
  - *The file is pruned and capped* (`:100-105`): entries older than 24 h are dropped and the file holds at most 32.
  - *The prompt is capped at 64 000 characters* (`:29-30`): "guards against a multi-megabyte paste being journaled."
  - *The log line carries identity only, never the prompt* (`:134-136`): "this log is read on crash triage and must not carry turn content."
  - *Every function is best-effort* (`:110-118`): "marker bookkeeping must never break a turn."

### `tui_gateway/user_messages.py`
- **Purpose:** the user-facing copy for gateway refusals and session failures — one place for the sentences every client prints.
- **Key abstractions:** `_TURN_ERROR_CODE_COPY` (`:22`); `_TURN_ERROR_LAYER_COPY` (`:45`); `turn_error_title(surface)` (`:68`); `turn_error_hint(surface, recoverable)` (`:75`); `turn_error_text(error, surface, recoverable)` (`:85`); `busy_message(command, compressing)` (`:101`).
- **Non-obvious design decisions:**
  - *Only commands that exist on EVERY client are cited* (`:4-9`): "no client-only forms (`/sessions new`, `/setup`) and no single-surface gestures stated as fact (Ctrl+C is copy on Desktop)."
  - *Lead phrases clients pattern-match on are part of the wire contract* (`:9-10`): "keep them."
  - *The provider is named in parentheses* (`:63-65`): "The model provider rejected the API key (anthropic)."
  - *A compressing session says WAIT, not STOP* (`:101-107`): "A manual /compress also holds the session busy, but nothing is replying and Stop does not end it: say to wait instead."
  - *An auth-lock timeout gets its own message* (`:114-128`): the generic `/model` hint "would send the user debugging credentials that are perfectly fine."
  - *The raw provider detail is dimmed onto its own line* (`:88-95`): "the raw provider detail on its own dimmed-able line, and the next step."

### `tui_gateway/ws.py`
- **Purpose:** the WebSocket transport for the dashboard / desktop / remote clients.
- **Key abstractions:** `WSTransport` (`:120`); `_dispatch_loop()` (`:466`); `_queue_request(req)` (`:490`); `_end_reads()` (`:498`); `_WS_CONCURRENT_READ_METHODS` (`:62`).
- **Non-obvious design decisions:**
  - *Two lanes* (`:446-489`): controls dispatch in arrival order; "bounded expensive read-only projections run alongside them" with a separate semaphore. A read past the waiting cap **parks the reader** rather than dropping it.
  - *A read that never started is dropped; one that started is allowed to finish* (`:498-510`): "unless the connection itself was cancelled (server shutdown)."
  - *The `gateway.ready` frame advertises `replay_epoch`* (`:519-528`): "lets reconnecting clients detect a backend restart and reset their per-session seq watermarks."
  - *The skin resolution is offloaded* (`:514`): "resolve_skin() is sync I/O + CPU; pooled so the read loop can drain the frontend's initial RPC burst."
  - *A served profile's TUI repaints from ITS home's skin* (`:531-533`): "never the launch home's."
  - *The teardown is offloaded to a thread* (`:613-620`): "worker.close() blocks (terminate + waits) plus a sync DB write, which inline would freeze the loop for every peer."
  - *The browser-controller disconnect is owner-safe* (`:604-611`): "a same-identity reconnect may deliver a terminal result for in-flight work."

### `tui_gateway/ws_legacy_fallback.py`
- **Purpose:** the legacy-handler fallback for authority-backed WebSocket connections — and, more importantly, the list of what must **not** fall back.
- **Key abstractions:** `legacy_fallback_allowed(actor, method)` (`:63`); `connection_profile_home()` (`:74`); `_SESSION_NAMESPACES` / `_SESSION_FALLBACK_ALLOWED` (`:31-38`); `_PROCESS_GLOBAL` (`:50`).
- **Non-obvious design decisions:**
  - *The authority owns the session, its transcript and its admissions* (`:27-32`): "a legacy handler in these namespaces would write the same `state.db` behind its receipts and revision fence (a legacy `session.delete` dropped a row the authority still held live)."
  - *Process-global sidecar verbs are refused* (`:42-50`): "`process.stop` = `kill_all` over the whole registry … `reload.env` = rewrite `os.environ` from the launch profile's `.env`" — on the shared owner that state is every chat's.
  - *The capability check reuses the authority's own map* (`:63-69`): "never a second list that could drift."
  - *A ticket bound to a secondary profile keeps that profile's scope* (`:86-121`): `session.active_list` "lists every profile's live sessions, so the ticket's own profile is named (or the read refused), never the launch profile's served."

### Tier 2 — docs: summary table

| file | what it documents |
| --- | --- |
| `tui_gateway/AGENTS.md` | The TUI gateway's architecture: the Node (Ink) ↔ Python split ("Never move agent behaviour into the renderer"), the newline-delimited JSON-RPC transport, the "wire is declared in Python and generated for TypeScript" contract loop, the profile/scope rules, the slash flow, and the canonical (`hermes-gateway-v1`) transport's separate catalog. It also states the "new RPC = a new `methods_<topic>.py` … no `if method == ...` chain" root shape rule. |

---

## 2. Ideas worth stealing for August Trading

1. **Declare the wire once, generate the client, and let CI fail when it drifts.** `tui_gateway/contracts/` declares every method, request and event as a Pydantic model; `scripts/gen_gateway_contracts.py` renders the TypeScript; a test regenerates in memory and diffs the committed file, so "change the model → regenerate → `tsc` shows every consumer the field moved" (`contracts/registry.py:171-189`, `contracts/base.py:19-40`). August Trading already has a zod boundary (`schemas/tradeAnalysis.ts`) but the *client* types are hand-written — a generator for the renderer/electron boundary would kill a whole class of drift.
2. **`assert_complete` in both directions.** A method with no contract *and* a contract with no handler are both failures (`contracts/registry.py:171-189`). August Trading has no equivalent inventory of "which service functions are exposed to which surface".
3. **Per-request failure classification with a typed error surface.** `ErrorSurface` is `{layer, code, retryable}` plus an auth hint and a `resets_at` when the provider said when its limit lifts (`contracts/events.py:194-205`); `toFriendlyProviderError` maps provider bodies onto it. August Trading's `runStatus.ts` already has a status vocabulary — extending it to a *typed* provider-error surface (`layer`/`code`/`retryable`/`resets_at`) is a direct win.
4. **One place for user-facing copy, with the wire contract written into it.** `user_messages.py` says explicitly that lead phrases clients pattern-match on are part of the wire contract (`user_messages.py:4-10`) and that only commands existing on *every* client may be cited (`:4-9`). August Trading prints different failure text in different components; one table would make the voice uniform and testable.
5. **Bounded event replay with an epoch and a truncation watermark.** `event_replay.py` gives every event a per-session monotonic `seq`, freezes the payload OUTSIDE the lock, bounds memory three ways, and — crucially — **eviction keeps the counter** so a revisited session does not restart at 1 and silently lose every live frame (`event_replay.py:125-138`, #100122). A reconnecting client can also detect a server restart from a reset `replay_epoch` (`:24-27`). August Trading's `Message.isStreaming` / live-sync work is the same problem in miniature; the "eviction must not reset the counter" rule is the part worth copying.
6. **The change-watcher: content digests, not file mtimes, plus a broadcast floor.** `change_watcher.py` hashes the *session-table columns* that drive projections behind a DB/WAL mtime, because the DB also carries a heartbeat table that writes every minute (`:205-255`, #98005); and a floored change keeps its OLD signature so the trailing edge re-fires rather than being lost (`:395`, `:418-420`). It also handles the "racily clean" mtime case exactly as git does (`:267-276`).
7. **A durable interrupted-turn marker with writer-liveness, not a "the process died" assumption.** `turn_marker.py:68-78` — a marker proves a turn *started*; the writer's liveness is checked by pid **plus process start time** so a recycled pid cannot pass for the original writer (#94778). A cross-process file lock stops a stale load resurrecting a cleared marker (`:36-42`).
8. **The three-way peer-error split: `retryable` / `ambiguous` / `not_admitted`.** `hosted_room_peer_http.py:170-182` — this is the difference between "try again" and "it may or may not have run", and it is exactly the distinction a trading bot needs before retrying an order or a plan write. A fourth class, "admitted but the receipt is lost", is handled by an idempotent replay keyed on a content digest.
9. **The "compare-and-set on a revision" pattern for anything a user can change.** `connectors.policy.set` requires `expectedRevision` and answers 4090 "policy changed. Refresh and try again" (`methods_connectors_account.py:229-253`); `session.mutate` carries `expected_revision` + `expected_generation` (`contracts/canonical.py:82-95`); `profiles.configure` does a per-key CAS on `ui_meta` (`contracts/profiles_vault_complete_foreign_subagents.py:269-283`). August Trading's trade-plan and journal writes have no such fence.
10. **The "unknown" is a first-class answer.** `ProviderUsageAccount.state` is `ready | limited | unknown | unavailable` — "state carries the meaning, never a fabricated gauge" (`contracts/config_free_tier_control.py:497-517`); `marker_writer_state` returns "unknown" rather than guessing; `ProviderUsage.windows` stays empty for a multi-account pool because a percentage would be fabricated. August Trading's provider-usage and "model menu" surfaces should prefer an honest `unknown` to a plausible number.
11. **A model switch is a transaction, and a failed switch is a no-op.** `model_switch.py:280-300` — the in-place swap rolled the agent back and re-raised, so the whole commit (restart, persist, marker, override, config write) is aborted; a failed switch is a no-op and a clean error (#50163). The same discipline (no partial commit, no half-persisted state) applies to any "swap the active model / strategy / profile" action in August Trading.
12. **Defer a model pick instead of racing the running turn.** `methods_config_set.py:73-96` — `agent.switch_model()` mutates fields the worker thread reads every iteration, so a pick made mid-turn is *stashed* and applied at the next turn start; the selection guards run at stash time "the only moment a confirm round-trip is possible." A compute-host session always defers, because the live agent is in another process.
13. **A client that cannot answer must fail fast, not hang.** `server_requests.py:180-186` — a client that never advertised the capability gets the same `None` an error produces, instead of the agent waiting out a 300 s deadline. The "session is waiting on a human" state is also a first-class predicate (`open_request_count()`, `pending_kind(sid)`), so the process is never mistaken for idle.
14. **The "wrong window" answer is a first-class protocol value.** `NOT_SHOWN_CODE = 4404` (`server_requests.py:146`): a client answers "no window here shows this session", and the request settles only when *every* answering client declined ("a bystander window must not beat the owner", #113348) — with no owner at all the agent gets the refusal at once instead of at the deadline (#119333). August Trading's two conversation homes (Chat and the Chart AI dock) have the same problem.
15. **The refusal-envelope discipline for anything that can fail off-network.** Billing is fail-open: a logged-out portal answers `ok=false` with a typed code, never a JSON-RPC error, "so the client always resolves and branches on the envelope" (`contracts/billing_delegation_pets.py:1-8`). The same shape works for a broker/data-provider call.
16. **One environment-variable parser instead of twenty `float(os.environ[...])` calls.** `_env.py` applies the default on absent/empty/malformed, so a typo cannot kill a worker at import.
17. **A refusal table as data.** `connector_refusals.py` is one table of `(code, enum, message)` shared by two transports, so a refusal means the same thing on both wires.
18. **Prompt-cache discipline: keep the prefix byte-stable and put variable text in a marked channel.** A personality change updates the ephemeral system prompt in place "so prompt-cache hits survive" and appends a pivot marker as a `user`-role message with a `display_kind` (`agent_callbacks.py:307-336`, #82756) — and a *screen changed* note rides the "one-shot user-message channel" so it "lands behind the cached prefix" (`methods_display_watch.py:49-79`).
19. **A "did it actually run?" receipt, not a boolean.** `PersistedTurn` records the row ids and says "missing ids are unproven, never negative acknowledgements" (`contracts/events.py:219-236`); the hosted-room driver matches a receipt on `(task_id, execution_generation, role, status)` so a reply from another attempt is never mistaken for this one (`hosted_room_driver.py:969-988`).
20. **Harden the test seam and keep it dead by default.** `synthetic_turn.py` is inert unless an env var arms it, and when armed it replaces the agent on BOTH the in-process and the isolated path "so the isolation boundary is the only variable" — and the burn is pure-Python because "a network/sleep stub releases the GIL and a green off it is fake."

## 3. Trading-specific findings

1. **A trade plan needs a compare-and-set revision, not a last-write-wins write.** August Trading writes a trade plan, a journal entry and a rule/lesson; three surfaces can touch them. The hosted-room/canonical wire makes every such write a fenced mutation (`expected_revision` + `expected_generation`, `contracts/canonical.py:82-95`) and the connector policy write a CAS with a typed 4090 on conflict (`methods_connectors_account.py:229-253`). A "the plan changed under you" error is far cheaper than a silently overwritten stop.
2. **Order/plan execution needs the `retryable` / `ambiguous` / `not_admitted` triple.** `hosted_room_peer_http.py:170-182` classifies a failed call three ways; a plan that "may or may not have been submitted" must be resolved by an idempotent replay keyed on a content digest, never by re-submitting. August Trading's `Log this trade` and the outcome-settlement path have exactly this shape of risk.
3. **Never fabricate a provider/gauge number — return `unknown`.** `ProviderUsageAccount.state` (`contracts/config_free_tier_control.py:497-517`) and `ProviderUsage.windows` staying empty for a multi-account pool (`:519-529`) are the pattern. For a trading app this is the difference between "the broker API said nothing" and "we invented a P/L".
4. **Turn admission must be fenced, and a queued correction must be able to be *taken back*.** `prompt.steer_queued` settles `steered` when the turn completed with its text, `interrupted` otherwise, and "a text the turn never consumed goes back to its queue place" (`contracts/canonical_sessions.py:330-345`); `CorrectionStatus` is `queued | redirected | rejected` (`contracts/sessions.py:623-627`). August Trading's "approve/queue/edit the pending plan" flow needs the same three outcomes.
5. **A failed provider call must reach the trader as a *typed, classified* failure, not a generic error row.** `_TURN_ERROR_CODE_COPY` (`user_messages.py:22-43`) maps 18 provider codes to a title + a next step, and the title names the provider in parentheses. August Trading's `runStatus.ts` already has an error classifier — mapping it to trader-facing next steps ("the key was rejected → fix it with /model; the context overflowed → /compress") is a small, high-value addition.
6. **The transcript must never show a turn that was not persisted.** `PersistedTurn.complete` is only true when the turn boundary, every row and the final body are accounted for; compaction, redirects and partial writes leave it false (`contracts/events.py:219-236`). For a trading journal, "this analysis row exists" is a claim the app must be able to prove.
7. **A failed write must never be able to look like a successful one.** `profile_roster_cache.py:24-28` keeps the *raw* readers uncached because a stale read in a CAS writer "would overwrite a newer file"; `session_history.py:520-527` never fails open on redaction. August Trading's journal/notebook writes have the same exposure.

## 4. Gotchas and anti-patterns found in the reference (do NOT copy)

1. **A "certify" harness that is green because the load generator is fake.** `synthetic_turn.py:11-14` documents it: a network/sleep stub releases the GIL, so a green run "off it is fake". Any August Trading latency/throughput claim needs a load generator that holds the same resource the production path holds.
2. **A per-module cache declared next to the code that reads it.** `profile_roster_cache.py:29-32` is its own module *because* `bind_module` copies module-level dicts — "a cache declared there would be written to one copy and read from another." August Trading's `bind_module`-style global rebinding does not exist, but the same class of bug appears whenever a module-level memo is shared across a `bind_module`/`Proxy` boundary.
3. **A hand-maintained list that duplicates an authoritative one.** `ws_legacy_fallback.py:63-69` deliberately reuses the authority's own capability map: "never a second list that could drift."
4. **A private copy of a shape that another module owns.** `contracts/billing_delegation_pets.py:560-566` carries a `TODO(common)` that `server.py::_pet_sprite_payload` is one shape for `pet.info` and `pet.hatch` — an acknowledged duplication still in the tree.
5. **A 0.9 s failure that logs two lines and no cause.** `session_history.py:501-512` records the *gap* rather than only the current code: "a report consisting of two lines reading `status=error error_retained=True duration=0.9s` with no way to tell a provider 4xx from a budget wall from a crashed finalizer… only the exception path prints to stderr, which is why the quiet failures are the ones that get filed."
6. **A 300 s wait that nobody can shorten.** The clarify deadline is 300 s and a pre-capability client would wait it out for nothing (`server_requests.py:8-20`); the fix was a capability advertisement, not a shorter timeout.

## 5. Weak spots in the reference shard

1. **The surface is enormous and the "simple as features accumulate" goal is not met.** 119 files in one package, 21 of them over 30 KB, `server.py` alone 116 KB, `methods_session.py` 130 KB, `methods_tools.py` 102 KB, `methods_prompt.py` 83 KB. The `contracts/` layer is the *good* answer to that sprawl — but the handler layer still carries the weight.
2. **The split-module mechanism is a code-generation-by-handshake.** `method_ctx.py:16-108` re-creates every function with `types.FunctionType` against `server.py`'s namespace, rebinds closure cells, patches `__globals__` and even rewrites module-level dicts in place. It works, and the docstrings are honest about it, but it means "where does this function actually live" is answerable only by reading the binder.
3. **The docs are the only contract for several behaviours, and they are in the code, not in a file.** Rules like "an explicitly empty toolset list means ZERO tools" (`agent_factory.py:437-441`) or "a `/new` is a full conversation boundary" (`agent_callbacks.py:607-611`) exist only as comments next to the code that implements them. A reader of `AGENTS.md` cannot find them.
4. **The failure mode is still "log it and keep going" in a few high-traffic places.** `user_messages.py` fixes the *user-facing* half of that, and `session_history.py:497-530` the log half, but `methods_config.py` and several `except Exception` blocks still collapse distinct causes into one generic code.
5. **Half the wire vocabulary is fail-open, which is a deliberate trade but adds a real cost.** Billing, usage, free tier, plugin activation, shared metrics and the pet store all degrade to a "not available" envelope; a client must therefore carry a second, silent state for every feature it can no longer prove. August Trading should copy the *typed envelope* but not the number of degradable features.
6. **The eviction/counter class of bug is a recurring theme, and it is not solved in general.** `event_replay.py:125-138` fixes it for the replay ring, `session_transports.py:135-140` for the transport mailbox, `turn_marker.py:36-42` for the marker file — each with its own bespoke fix rather than one shared "monotonic identity" primitive.

## 6. Coverage and honest limits

- **Files in the shard:** 119. **Read line by line in full: 95.** **Skipped with a stated reason: 24.** The status TSV has exactly one row per file, in the file-list order.
- **Not reached in this pass** (listed honestly in the TSV as `skipped` with a reason, and *not* summarised in this report): `tui_gateway/methods_profiles.py`, `methods_projects.py`, `methods_prompt.py`, `methods_session.py`, `methods_session_branch.py`, `methods_session_control.py`, `methods_session_foreign.py`, `methods_session_interrupt.py`, `methods_session_model_guard.py`, `methods_shared_metrics.py`, `methods_slash.py`, `methods_subagents.py`, `methods_tools.py`, `methods_tools_plugin_servers.py`, `methods_vault.py`, `methods_voice.py`, `prompt_attachments.py`, `prompt_turn.py`, `server.py`, `session_auto_continue.py`, `session_lifecycle.py`, `session_notifications.py`, `session_registry.py`, `session_workdir.py`. These are the largest handler modules in the shard; they were not summarised rather than summarised from their names.
- Everything asserted above about a file is from that file's own text; every line reference points at a line that was actually read.

