# hermes-agent :: hermes-tests-gateway

**Files in shard:** 1689 (read: 1689, skipped with reason: 0)
**What this shard covers:** The entire `tests/gateway/` tree of the *hermes-agent* reference
repository — a Python "agent gateway" that fronts one long-lived agent process behind many
messaging surfaces (Telegram, Discord, Slack, WhatsApp, Matrix, Feishu, WeCom, Weixin, Signal,
Teams, IRC, e-mail, SMS, QQBot, Yuanbao, DingTalk, Weibo/Webhook, and a TypeScript relay
connector). The directory is not a unit-test suite: it is the repository's **executable
specification** of a production agent gateway. It contains (a) a shared harness
(`conftest.py`, `_plugin_adapter_loader.py`, `feishu_helpers.py`, `restart_test_helpers.py`),
(b) ~60 "peer"/"daemon"/"probe" fixtures that boot *real* gateway processes, (c) ~40
platform-adapter suites, (d) ~40 relay-conformance suites, and (e) ~1,550 top-level
`test_*.py` files that pin the gateway's turn lifecycle, durable admission FIFO, delivery
obligation ledger, cron/automation scheduler, session authority, compaction hygiene, approval
gating, profile multiplexing, and every platform adapter's wire format.

The single most important structural fact for August Trading: **almost every file here is a
regression test written *after* a production incident, and the docstring names the incident.**
The set is therefore a catalogue of failure modes, not a catalogue of features.

**Read method (honest disclosure):** every one of the 1,689 files was opened and read through
its full byte content with `Get-Content -Raw` / `[System.IO.File]::ReadAllText`. For the
Tier-2 bulk I extracted, per file, the module docstring, the production modules it imports,
and the complete list of test-function names; that digest is the evidence behind every table
row. The four files marked Tier 1 below (`conftest.py`, `_plugin_adapter_loader.py`,
`feishu_helpers.py`, `restart_test_helpers.py`) plus `test_delivery_ledger.py`,
`test_cron_drain_floor.py` and `test_agent_cache_pressure.py` were additionally read
line-by-line with line numbers. No repo code was executed; no install, build or test command
was run; the reference tree was opened read-only.

---

## 1. File-by-file

### Tier 1 — load-bearing source (read in full)

### `tests/gateway/conftest.py`
- **Purpose:** The single shared pytest harness for 1,689 gateway tests — a session-scoped
  Telegram/`discord`/`slack_bot` module mock installer plus collection-time AST guards.
- **Key abstractions:** `private_db_probe_cleanup` (opt-in fixture that releases only the
  SQLite header-probe fds a test opened under its own `tmp_path`); `_bind_lark_sdk_globals_when_installed`;
  `make_async_session_db`; `_FakeEnumMember` (a `StrEnum`-faithful stand-in for PTB constants
  so `str(x)`, `==` and `repr(x)` all behave).
- **Data flow:** at import it registers a mock `telegram` package in `sys.modules` *before*
  any test file can trigger `from plugins.platforms.telegram.adapter import ...`, and at
  collection time it walks every test module's AST looking for the banned anti-pattern.
- **Non-obvious design decisions:** the docstring states the reason plainly — without the mock,
  whichever test file collects first caches `ChatType = None` from the production ImportError
  fallback, and 30+ downstream tests fail wherever `ChatType.GROUP` is touched. The repo
  treats *test-order-dependent import pollution* as a first-class bug class.
- **Edge cases & failure handling:** the guard fails **collection** with a pointer to
  `load_plugin_adapter` rather than letting a plugin test half-import. `private_db_probe_cleanup`
  deliberately does **not** close production probes: "closing one while SQLite still owns the
  inode cancels its POSIX locks".
- **Surprising:** the production *reason* for the mock is written down in the test harness —
  this is a repository that documents its own scars.

### `tests/gateway/_plugin_adapter_loader.py`
- **Purpose:** Load a platform plugin's `adapter.py` in isolation, without `sys.path` mutation.
- **Key abstractions:** `load_plugin_adapter(plugin_name) -> ModuleType`.
- **Data flow:** builds an `importlib.util.spec_from_file_location` under the unique module
  name `plugin_adapter_<plugin_name>`, registers it in `sys.modules` **before** `exec_module`
  (so a module doing `sys.modules[__name__]` reflection during import works), and pops it back
  out of `sys.modules` if the exec raises.
- **Non-obvious design decisions:** every platform plugin ships its own `adapter.py`, so two
  tests doing `sys.path.insert(0, "plugins/platforms/irc")` race for `sys.modules["adapter"]`;
  whichever collects first wins and the other raises `ImportError`, and the polluted
  `sys.path` cascades into unrelated tests in the same worker. The helper makes that
  structurally impossible, and `conftest.py` rejects the anti-pattern at collection time.
- **Edge cases & failure handling:** a missing plugin raises `FileNotFoundError` that lists
  every known plugin directory; a failed exec removes the half-registered module.
- **Surprising:** this is the *only* sanctioned way to import a plugin adapter, and the repo
  enforces it with a static AST guard rather than a code review rule.

### `tests/gateway/feishu_helpers.py`
- **Purpose:** Small builders for Feishu adapter tests (sender/message namespaces and an
  adapter skeleton built with `object.__new__`).
- **Key abstractions:** `make_sender`, `make_message`, `make_adapter_skeleton`, `install_dedup_state`, `stub_mention`.
- **Data flow:** `make_adapter_skeleton` bypasses `FeishuAdapter.__init__` entirely and
  assigns only the attributes the admission path reads (`_bot_open_id`, `_group_policy`,
  `_allow_bots`, `_require_mention`, `_seen_message_ids`, …).
- **Non-obvious design decisions:** the skeleton is built by attribute assignment, not by a
  constructor call, so a test never depends on the constructor's side effects (config load,
  SDK import, network).
- **Edge cases & failure handling:** `install_dedup_state` installs a **no-op**
  `_persist_seen_message_ids`, so dedup persistence never touches disk in a unit test.

### `tests/gateway/restart_test_helpers.py`
- **Purpose:** A hand-assembled `GatewayRunner` for restart/drain tests, with only the
  attributes the drain actually reads.
- **Key abstractions:** `RestartTestAdapter` (records every `send`), `make_restart_source`,
  `make_restart_runner`.
- **Data flow:** the runner is built with `object.__new__(GatewayRunner)` and then
  ~30 private methods are re-bound from the class
  (`GatewayRunner._drain_active_agents.__get__(runner, GatewayRunner)`), so the test drives
  **production** drain code without running `GatewayRunner.__init__`.
- **Non-obvious design decisions:** the drain constants are imported from
  `gateway.restart` (`DEFAULT_GATEWAY_CRON_DRAIN_TIMEOUT`, `DEFAULT_GATEWAY_RESTART_DRAIN_TIMEOUT`,
  `DEFAULT_GATEWAY_RESTART_AFTER_TURN_TIMEOUT`, `DEFAULT_GATEWAY_SIGNAL_INTERRUPT_GRACE_TIMEOUT`)
  rather than being re-declared, so a default change in production cannot be papered over by
  a stale test literal.
- **Edge cases & failure handling:** `_is_user_authorized` is stubbed to `True` so authz does
  not mask the drain behaviour; the adapter's `set_message_handler` is an `AsyncMock`.
- **Surprising:** the file is not a test — it has no `test_` functions — yet it is the
  highest-value seam in the shard.

---

### Tier 2 — bulk: one row per file

The table is the ledger. Every file in the shard appears exactly once, in the shard file-list
order. Files under `tests/gateway/fixtures/` are helper processes rather than tests, so their
row says what the helper *is*; files under `tests/gateway/relay/` are the gateway half of a
cross-implementation conformance contract with a TypeScript connector.

| File | What it is / what it pins |
| --- | --- |
| `tests/gateway/__init__.py` | Empty package marker (0 bytes). |
| `tests/gateway/_plugin_adapter_loader.py` | Isolated loader for a plugin's `adapter.py` (see Tier 1). |
| `tests/gateway/conftest.py` | Shared harness: Telegram/Discord/Slack mocks + collection-time AST guard (see Tier 1). |
| `tests/gateway/feishu_helpers.py` | Feishu sender/message/adapter-skeleton builders (see Tier 1). |
| `tests/gateway/fixtures/agent_persistence_worker.py` | Helper: real `AIAgent` in a separate interpreter over the worker transport, to prove persistence across process boundaries. |
| `tests/gateway/fixtures/ancillary_reads_peer.py` | Authenticated TCP fixture with owner-seeded state; no inference, no external services. |
| `tests/gateway/fixtures/api_authority_peer.py` | Real HTTP/WS API execution probe against a loopback inference peer. |
| `tests/gateway/fixtures/api_daemon_witness.py` | Observes real agent identities without replacing daemon boot or execution. |
| `tests/gateway/fixtures/api_recovery_daemon.py` | Crash barrier placed *after* a real API commit and its HTTP ACK. |
| `tests/gateway/fixtures/api_usage_peer.py` | Loopback peer emitting explicit SSE usage frames for per-admission accounting probes. |
| `tests/gateway/fixtures/authority_clarify_lock_peer.py` | E2E: a CLI-shaped turn's `clarify_batch` answered from a *second* viewer via `clarify.lock` over a real WS API. |
| `tests/gateway/fixtures/authority_clarify_peer.py` | Owned loopback model + real clarify tool + native card + two authenticated sockets. |
| `tests/gateway/fixtures/authority_controls_peer.py` | Disposable real approval worker, loopback model, authenticated WS clients. |
| `tests/gateway/fixtures/authority_events_peer.py` | Real authority execution observed by an OS-full observer and an independent reader. |
| `tests/gateway/fixtures/authority_stream_peer.py` | Real SSE execution with authenticated authority observers, in a disposable process. |
| `tests/gateway/fixtures/automation_peer.py` | Ordinary daemon, real terminal child, loopback-only relay/provider peers. |
| `tests/gateway/fixtures/bot_authority_peer.py` | Authenticated production WebSockets and loopback-only inference. |
| `tests/gateway/fixtures/browser_scope_peer.py` | Authenticated WS fixture for `browser.manage` on the shared owner, scoped to the session's profile. |
| `tests/gateway/fixtures/cli_launch_policy_probe.py` | Ordinary daemon + concurrent classic CLI; records loopback launch receipts. |
| `tests/gateway/fixtures/cli_plugin_free_startup.py` | The classic CLI's real startup and command dispatch in a fresh process, recording every plugin discovery/execution entry point reached. |
| `tests/gateway/fixtures/compression_persistence_worker.py` | Registered worker invoking real `AIAgent` compression over an ordinary daemon. |
| `tests/gateway/fixtures/config_policy_recovery_probe.py` | Unmodified daemon/config-source restart over actual loopback inference. |
| `tests/gateway/fixtures/control_boundaries.py` | Helper defining the control-socket boundary probes used by the host/attach suites. |
| `tests/gateway/fixtures/desktop_process_verbs_peer.py` | Authenticated WS fixture: Desktop's exact process/MCP frames on the shared owner; no inference. |
| `tests/gateway/fixtures/estop_interactive_peer.py` | `hermes pause` (ESTOP) must hold every gateway turn, interactive ones included, and let a running turn finish. |
| `tests/gateway/fixtures/execution_frames_capture.py` | Captures real `SessionEvents.publish` frames; output is the Desktop execution-authority fixture JSON. |
| `tests/gateway/fixtures/hosted_auth_probe.py` | Loopback OIDC/model boundaries; daemon, auth, tickets and room controls are real. |
| `tests/gateway/fixtures/kanban_owner_probe.py` | Actual dispatcher argv, ordinary daemon, loopback tool round, disposable board. |
| `tests/gateway/fixtures/kanban_recovery_probe.py` | Disposable ordinary owner, actual dispatcher, custom paths and process death. |
| `tests/gateway/fixtures/ledger_tool_worker.py` | Real registered worker with the production terminal tool enabled. |
| `tests/gateway/fixtures/legacy_bot_mailbox.py` | Executed against the pre-authority checkout on `PYTHONPATH`, not the new writer. |
| `tests/gateway/fixtures/legacy_migration_probe.py` | Actual classic-CLI persistence followed by native-owner migration (loopback). |
| `tests/gateway/fixtures/lifecycle_persistence_worker.py` | Lifecycle extension of the separate-interpreter worker fixture. |
| `tests/gateway/fixtures/local_automation_daemon.py` | Crash barrier after a real automation commit, before the producer ACK/first claim. |
| `tests/gateway/fixtures/local_automation_peer.py` | Ordinary daemon + local authenticated clients + actual terminal completion. |
| `tests/gateway/fixtures/local_lineage_daemon.py` | Pauses only after a real rotation/reset publication and durable queued admission. |
| `tests/gateway/fixtures/local_lineage_probe.py` | Separate ordinary daemon restarts after the production physical-target handoff. |
| `tests/gateway/fixtures/local_recovery_daemon.py` | Test-only committed-before-schedule crash barrier around the ordinary daemon. |
| `tests/gateway/fixtures/local_recovery_probe.py` | Real daemon restart driver; model and pre-claim crash barriers are separate fixtures. |
| `tests/gateway/fixtures/local_session_peer.py` | Owned loopback fixture: no native credentials, no alternative agent runtime. |
| `tests/gateway/fixtures/local_status_notice_peer.py` | Real owner + real `AIAgent` turn + authenticated local WS viewer for status/notices. |
| `tests/gateway/fixtures/native_ingress_media_peer.py` | Owned temp-profile native admission/recovery with real loopback inference. |
| `tests/gateway/fixtures/native_ingress_trust_multiplex.py` | Opposing transport/runtime policy and restart controls; no vendor credentials. |
| `tests/gateway/fixtures/native_ingress_trust_peer.py` | Real native callback/runner/SQLite probe in an owned interpreter. |
| `tests/gateway/fixtures/native_reply_crash_daemon.py` | Crash barriers around a native reply's terminal commit (`KILL_BEFORE_LEDGER`, `KILL_BEFORE_COMMIT`). |
| `tests/gateway/fixtures/native_role_fences.py` | Owned await-race and fresh-interpreter retention controls. |
| `tests/gateway/fixtures/native_role_peer.py` | Owned Discord SDK peer + actual public adapter/TurnRunner/HTTP execution. |
| `tests/gateway/fixtures/native_telegram_recovery_daemon.py` | First-owner-only scheduler barrier; every recovery boot is ordinary. |
| `tests/gateway/fixtures/operator_cross_surface_peer.py` | Disposable gateway; only the IdP and loopback model wire are synthetic. |
| `tests/gateway/fixtures/persistence_worker.py` | Owned inert tool witness; commands arrive through a private test pipe. |
| `tests/gateway/fixtures/plugin_mcp_daemon.py` | Ordinary daemon with a fake MCP server in its own registry (`probe-mcp` answers with the call and the holding pid). |
| `tests/gateway/fixtures/process_scope_peer.py` | Authenticated WS fixture: process-global sidecar verbs on the shared owner; no inference. |
| `tests/gateway/fixtures/replay_gap_owner.py` | A real owner (`SessionAuthority`, `AuthorityConnection`, `FanoutTransport` overflow) for one session and one viewer whose socket stops reading while paused. |
| `tests/gateway/fixtures/rotation_persistence_worker.py` | Registered worker invoking real `AIAgent` compression over an ordinary daemon. |
| `tests/gateway/fixtures/session_policy_peer.py` | Real concurrent source/model/tool/cwd launch proof; no external provider. |
| `tests/gateway/fixtures/shared_authority_peer.py` | Disposable production-runtime peer; only provider and vendor wire are synthetic. |
| `tests/gateway/fixtures/shared_authority_recovery.py` | Crash/restart scenarios layered on the real shared-authority peer. |
| `tests/gateway/fixtures/shell_exec_peer.py` | Authenticated WS fixture: Ink `!cmd` on the shared owner; no inference. |
| `tests/gateway/fixtures/stack_dump_daemon.py` | Ordinary daemon plus delayed diagnostics: after `UGW_STACK_DUMP_AFTER` seconds every OS thread stack and asyncio task stack is appended to `$HERMES_HOME/logs/stacks.txt`. |
| `tests/gateway/fixtures/subagent_controls_peer.py` | Authenticated owner fixture: Desktop's per-child Steer/Stop reach only this session's children. |
| `tests/gateway/fixtures/terminal_commit_daemon.py` | Stops the actual owner after the result commit, before any publication. |
| `tests/gateway/fixtures/trampoline_daemon.py` | Makes the daemon believe its interpreter is a launcher trampoline (uv-venv shape on Windows) so every child is a launcher whose grandchild is the real Python. |
| `tests/gateway/fixtures/tui_desktop_routes_peer.py` | Authenticated TCP fixture for the Ink/Desktop verbs the owner serves itself; no inference. |
| `tests/gateway/fixtures/webhook_route_authority.py` | Real durable admission for route tests; only execution is held at scheduling. |
| `tests/gateway/platforms/__init__.py` | Empty package marker (0 bytes). |
| `tests/gateway/platforms/test_yuanbao_recall_db_only.py` | Yuanbao recall branch A1 (exact id) and A2 (content match) work against DB-only transcripts, via the `platform_message_id` column. |
| `tests/gateway/platforms/test_yuanbao_state_cleanup.py` | Yuanbao per-turn state cleanup: `RecallGuard` tracking dicts and the member-cache TTL are cleared only by the owning turn's event. |
| `tests/gateway/relay/__init__.py` | Empty package marker (0 bytes). |
| `tests/gateway/relay/stub_connector.py` | In-memory stub implementing `RelayTransport`: fixed `CapabilityDescriptor` at handshake, synthetic inbound `MessageEvent`s, recorded outbound actions. Must stay under `tests/`. |
| `tests/gateway/relay/test_auth.py` | Gateway-side relay auth must reproduce the connector's TypeScript `makeToken`/`sign` byte-for-byte (frozen vector). |
| `tests/gateway/relay/test_channel_context_consume.py` | `CapabilityDescriptor.supports_context` defaults False, round-trips JSON, and maps the connector's read-only `context` array into `MessageEvent.channel_context`. |
| `tests/gateway/relay/test_cold_opt_out.py` | Standalone relay routing must not bootstrap the gateway or reload secrets (read-only config read). |
| `tests/gateway/relay/test_descriptor.py` | The experimental `CapabilityDescriptor`: legacy op-set assumption, malformed `supported_ops` normalisation. |
| `tests/gateway/relay/test_explicit_disable.py` | `platforms.relay.enabled: false` beats a deployment-injected relay URL; YAML/JSON precedence across both readers. |
| `tests/gateway/relay/test_handoff_relay_aliasing.py` | `/handoff discord` must resolve on a relay-fronted gateway in both the CLI pre-check and the gateway watcher. |
| `tests/gateway/relay/test_identity_token_resolver.py` | The canonical caller-identity token resolver: generic OAuth2 client-credentials vs ambient GET vs Nous-Portal, with strict refusal on malformed/short responses. |
| `tests/gateway/relay/test_live_cards_flow_trace.py` | Local integration trace: real `StreamConsumer` + real `RelayAdapter` + stub transport, recording the exact op sequence the connector sees. |
| `tests/gateway/relay/test_provision_secret_optional.py` | `POST /relay/provision` may answer `secretIssued: false` with `secret`/`deliveryKey` absent; a withheld response must never overwrite stored credentials. |
| `tests/gateway/relay/test_relay_ack_ambiguity.py` | A transport timeout-shaped RESULT is *ambiguous*, not a rejection: a lost SEAL ack retries the idempotent frame and keeps interception armed. |
| `tests/gateway/relay/test_relay_adapter.py` | `RelayAdapter` capability advertisement: descriptor max length, UTF-16 length counting, scoped reply re-attachment, typing clear, `get_chat_info` fallback, idle teardown. |
| `tests/gateway/relay/test_relay_discord_interaction_labels.py` | A relayed Discord interaction carries the same chat/user labels as a relayed message, so the pinned session-context prompt does not re-render. |
| `tests/gateway/relay/test_relay_egress_declines.py` | Connector egress DECLINES must surface as real errors: no text fallback, no re-send as plain text, per-lane decline recognition, and a structured decline carried by every outbound lane. |
| `tests/gateway/relay/test_relay_follow_up.py` | The token-less `follow_up` capability action carries no credential; the connector resolves it from its vault. |
| `tests/gateway/relay/test_relay_format_hints.py` | Block-formatting hints stamped on outbound frames only when the connector advertises the capability and the operator knob is on. |
| `tests/gateway/relay/test_relay_going_idle.py` | The going-idle/buffered-flip handshake: buffered inbound acked after the handler, reconnect re-dials, dormant→wake→drain. |
| `tests/gateway/relay/test_relay_inbound_dedupe.py` | Relay inbound is at-least-once: replayed inbound frames are dropped by a bounded seen-set keyed by platform+message-id. |
| `tests/gateway/relay/test_relay_inchannel_continuable.py` | The flat in-channel continuable cron surface: a per-platform capability bit, per-logical-platform sub-block, and correct defaulting. |
| `tests/gateway/relay/test_relay_interactive.py` | Relay Phase 3: exec-approval / slash-confirm / clarify all render through ONE `prompt` op; reaction ack lifecycle; prompt-id scoping and expiry. |
| `tests/gateway/relay/test_relay_interrupt.py` | A connector-delivered mid-turn interrupt cancels exactly the targeted `session_key`'s turn, never a sibling's. |
| `tests/gateway/relay/test_relay_live_cards.py` | Slack live cards on the relay: `draft`, `task_card`, `task_card_stop` ops, descriptor gating, and draft state clearing on seal. |
| `tests/gateway/relay/test_relay_media.py` | Five `send_*` overrides route through one `send_media` op with op-level gating; local paths upload first; inbound media is localized. |
| `tests/gateway/relay/test_relay_multiplatform.py` | Multi-platform-per-agent: keyed identity map, one `/relay/provision` POST per platform, per-frame platform stamping. |
| `tests/gateway/relay/test_relay_multiplatform_semantics.py` | Stream semantics and draft capability resolve **per chat**, not from the primary scalar descriptor. |
| `tests/gateway/relay/test_relay_native_refusal_ack.py` | A refused relay native admission is acked on the same socket; the reader keeps serving (never a replay loop). |
| `tests/gateway/relay/test_relay_passthrough.py` | Connector-forwarded passthrough requests (Discord interactions) arrive over the same outbound WS; the body is byte-preserved and routed through `handle_message`. |
| `tests/gateway/relay/test_relay_passthrough_authority.py` | A relayed Discord interaction reaches the default native session authority only through the authenticated WS reader. |
| `tests/gateway/relay/test_relay_per_platform_caps.py` | Per-platform message-length caps resolve per inbound platform, not from the primary descriptor's scalar. |
| `tests/gateway/relay/test_relay_policy_send.py` | The gateway projects its mention-gating / free-response / allow-bots config into the connector's relevance vocabulary and POSTs it at boot (fail-soft). |
| `tests/gateway/relay/test_relay_prompt_ack_stream_isolation.py` | A prompt-ack send must never seal an open draft stream — the "✅ Approved once" ack carries no turn identity. |
| `tests/gateway/relay/test_relay_registration.py` | The relay platform registers when a connector URL is configured (env or `config.yaml`), the same shape as `gateway.proxy_url`; registration is a no-op otherwise. |
| `tests/gateway/relay/test_relay_roundtrip.py` | End-to-end relay round-trip against the in-memory stub: connect, inbound `MessageEvent`, `SessionSource` isolation, outbound send. |
| `tests/gateway/relay/test_relay_roundtrip_telegram.py` | The same round-trip for Telegram, whose discriminator profile differs (no `scope_id`). |
| `tests/gateway/relay/test_relay_seal_cancellation.py` | Cancellation during the final seal must restore the open-draft state so the remote stream is not orphaned. |
| `tests/gateway/relay/test_relay_sheds_crypto.py` | The relay path re-validates nothing: the connector is the sole crypto/identity boundary (asserted by scanning the package for signature verification). |
| `tests/gateway/relay/test_relay_slack_dm_streaming.py` | Slack relay DM streaming: the edit anchor must be kept in thread mode and dropped in flat mode; media keeps the anchor; typing/clear share one anchor. |
| `tests/gateway/relay/test_relay_slack_prompt_dm_root.py` | Relay Slack interactive prompts follow the turn's thread stamp; the threading mode is decided in exactly one place (`_resolve_progress_thread_id`). |
| `tests/gateway/relay/test_relay_slack_unfurl.py` | Relay-side Slack unfurl suppression: booleans stamped only for Slack chats, with the config knobs' precedence and the effect on draft streaming. |
| `tests/gateway/relay/test_relay_state_bounds.py` | Draft/seal coordination dicts are FIFO-bounded (a per-turn tombstone key previously grew forever). |
| `tests/gateway/relay/test_relay_stream_semantics_gating.py` | "Stream is the message" is a Slack semantic, not a relay semantic: Telegram's final is a real send, Slack's final seals. |
| `tests/gateway/relay/test_relay_task_card_failures.py` | Task-card transport failures degrade (return a failed result) and never raise out of the turn-cleanup path. |
| `tests/gateway/relay/test_relay_threads.py` | Relay Phase 4: thread create/rename ops with a no-clobber guard, `reply_to` enrichment, auto-thread feedback with a bounded wait, and a hello-command manifest. |
| `tests/gateway/relay/test_relay_turn_keying.py` | Per-TURN stream/card identity: two parallel turns in one thread must not collide, and a flat DM with no thread metadata still seals. |
| `tests/gateway/relay/test_self_provision.py` | Boot-time relay self-provisioning: URL mapping, secret pinning, in-process env wiring, fail-soft on a missing NAS token. |
| `tests/gateway/relay/test_wire_user_identity.py` | Relay wire hygiene: `user_display_name` / `user_handle` enrichment, with the handle as a last resort only. |
| `tests/gateway/relay/test_wire_voice_media.py` | `message_type: "voice"` parses; the rich `media[]` array maps mimes per attachment without positional misalignment. |
| `tests/gateway/relay/test_ws_transport.py` | `WebSocketRelayTransport` against a real in-process `websockets` server: handshake, inbound frames, request/response futures, and 4401 revocation latching. |
| `tests/gateway/relay/test_ws_transport_hardening.py` | WS transport hardening after a WAN-latency incident: pending futures fail promptly on a read-loop exit, sends fail fast in the redial window, and the redial hold cannot strand a lost suspend. |
| `tests/gateway/restart_test_helpers.py` | Hand-assembled `GatewayRunner` for drain/restart tests (see Tier 1). |
| `tests/gateway/test_abandoned_turn_process_cleanup.py` | An abandoned turn's subprocess is reaped by a watchdog that reaps only processes it created, is idempotent, and dumps wedged worker stacks before interrupting. |
| `tests/gateway/test_access_policy_mixin.py` | Five hand-copied allow/deny predicates (weixin, wecom, qqbot, whatsapp, yuanbao) are replaced by one `OwnAccessPolicyMixin`; the test asserts every adapter agrees. |
| `tests/gateway/test_active_session_text_merge.py` | Busy text follow-ups merge into one next-turn pending message instead of clobbering each other, with a short debounce. |
| `tests/gateway/test_active_turn_recovery.py` | Exact durable active-turn restart recovery: an exact persisted marker, compare-and-swap cleanup, promotion into `resume_pending`, and a timezone-change-safe timestamp. |
| `tests/gateway/test_adapter_authz_secret_scope.py` | Adapter authz gates must read allow-all/allowlist through the profile secret scope, never raw `os.environ`. |
| `tests/gateway/test_adapter_connect_classification.py` | Connect-failure classification: auth errors and dependency failures are terminal; network errors are retryable; a watcher escalates a long-queued platform exactly once. |
| `tests/gateway/test_adapter_guard_cache_race.py` | The collection-guard verdict cache is published under a temp name and renamed, so a concurrent reader never sees an empty file (the "ERROR:" flake). |
| `tests/gateway/test_adapter_session_key_seam.py` | Every adapter-side session key goes through one seam, so an adapter's batching key equals the runner's session key. |
| `tests/gateway/test_adapter_settings_profile_parity.py` | Standalone-vs-served parity for adapter *settings* (not credentials) under `gateway.multiplex_profiles`. |
| `tests/gateway/test_adapter_settings_scoped_precedence.py` | Per-profile adapter settings resolve explicit scoped env → the profile's own YAML → default, with the central `allow_bots` gate agreeing. |
| `tests/gateway/test_adapter_startup_secret_scope.py` | 13 platform adapters' credential reads at `__init__`/availability-check time must be scope-aware under multiplexing. |
| `tests/gateway/test_admission_queue_cap.py` | A session's durable FIFO holds at most the busy-queue cap of queued inputs, paused or not. |
| `tests/gateway/test_admission_queue_cap_notice.py` | A messaging follow-up past the FIFO cap gets a plain `queue_full` notice, not a turn error. |
| `tests/gateway/test_admission_result_reply_once.py` | A settled turn result stores the reply exactly once and every reader still gets it exactly (verified by byte size). |
| `tests/gateway/test_admission_results.py` | Structured results are claim-owned and visible only after settlement; a stale result cannot overwrite a settled claim. |
| `tests/gateway/test_adversarial_mutation_lifecycle.py` | Cancelling a model request cannot strand the next admission; profile retirement waits for the mutation thread. |
| `tests/gateway/test_adversarial_responses_eviction.py` | Durable exact Responses retries keep their output after response-body LRU eviction. |
| `tests/gateway/test_adversarial_responses_pending.py` | A Responses retry stays pinned to its first admission's target, including after pointer loss. |
| `tests/gateway/test_adversarial_settlement_review.py` | Failed-settlement cleanup and ownership races: a commit-then-error still releases terminal media and publishes the committed completion. |
| `tests/gateway/test_agent_cache.py` | The gateway agent cache: reuse across messages, rebuild on model/provider/toolset change, in-place reasoning update, eviction on reset and on fallback activation. |
| `tests/gateway/test_agent_cache_memory_lifecycle.py` | Memory-provider lifecycle of cached agents: soft eviction (`release_clients`) vs end-of-session teardown (`close`). |
| `tests/gateway/test_agent_cache_pressure.py` | Memory-pressure eviction: the cgroup-derived budget, the three things it must never shed (mid-turn agent, MRU sessions, unflushed transcripts). |
| `tests/gateway/test_agent_cache_release_profile_scope.py` | Agent-cache eviction commits end-of-session memory under the **owning** profile, not the launch profile. |
| `tests/gateway/test_agent_error_reply_401_hint.py` | A 401 reply names the turn's provider and the failing profile's own sign-in command. |
| `tests/gateway/test_agent_loop_stopped_hook.py` | The `agent_loop_stopped` plugin hook fires when the gateway interrupts a running turn (`/stop` and the `/new` fast path). |
| `tests/gateway/test_agents_command_delegations.py` | `/agents` surfaces background delegations with live activity, driven through the real registry dispatch. |
| `tests/gateway/test_allowed_channels_widening.py` | The `allowed_{channels,chats,rooms}` whitelist extension across Telegram/Matrix/Mattermost/DingTalk; empty = no restriction, DMs never filtered. |
| `tests/gateway/test_allowlist_qualified_ids.py` | Allowlist matching compares **qualified** user ids, not bare `@` localparts (a bare `alice` must not admit `alice@<any domain>`). |
| `tests/gateway/test_allowlist_warning_platform_gate.py` | The "no env user allowlists configured" reminder fires only when a messaging platform is enabled. |
| `tests/gateway/test_api_admission_off_loop.py` | API admission never blocks the shared owner loop on a held SQLite writer. |
| `tests/gateway/test_api_admission_queued_on_drain.py` | A queued API caller is told its input is *saved* when the gateway retires, so a retry does not run the work twice. |
| `tests/gateway/test_api_authority_continuity.py` | A declared API conversation restores at its current physical compression tip. |
| `tests/gateway/test_api_authority_controls.py` | Run controls are fenced to the exact canonical admission. |
| `tests/gateway/test_api_authority_daemon.py` | An ordinary daemon/API listener and a private authenticated WS share execution. |
| `tests/gateway/test_api_authority_execution.py` | API and authenticated WS share the existing selected cached agent (one `TurnRunner`). |
| `tests/gateway/test_api_authority_retry.py` | Busy API retries observe one committed execution. |
| `tests/gateway/test_api_authority_runs.py` | Run acceptance follows the same durable FIFO as HTTP/WS turns. |
| `tests/gateway/test_api_authority_store.py` | API storage selection borrows the runtime's store, never another profile's. |
| `tests/gateway/test_api_binding_served_profile.py` | A `/p/<profile>/` API session runs under the profile whose authority admitted it. |
| `tests/gateway/test_api_canonical_projection.py` | Canonical API admissions project the real turn: media, tool payloads, controls, outcomes, reasoning and approval prompts. |
| `tests/gateway/test_api_chat_run_owner.py` | A chat-completion admission carries the caller's run-owner scope durably. |
| `tests/gateway/test_api_compressed_receipt_history.py` | Responses chaining preserves a turn's compressed replacement while ordinary receipts stay compact. |
| `tests/gateway/test_api_crash_recovery.py` | SIGKILL recovery exercises authenticated HTTP on ordinary fresh daemons. |
| `tests/gateway/test_api_cutover_contract.py` | Private API ingress preserves caller content and conversation authority; the declared key is durable and cannot be rebound. |
| `tests/gateway/test_api_cutover_results.py` | Runs retain caller-selected history and an exact terminal status across polling and SSE. |
| `tests/gateway/test_api_delegation_delivery_contract.py` | A detached API result must have an addressable consumer and exactly one durable row. |
| `tests/gateway/test_api_doors_logical_owner.py` | Every API door admits a compression continuation's id on its lineage root. |
| `tests/gateway/test_api_hosted_binding.py` | Hosted source binding preserves the canonical hidden-room identity. |
| `tests/gateway/test_api_hosted_daemon.py` | Real invitation/grant HTTP inference and hidden-room restoration survive an owner restart. |
| `tests/gateway/test_api_idempotency_after_delete.py` | An `Idempotency-Key` stays exactly-once after its session is deleted (the tombstone scan is client-key-paid only). |
| `tests/gateway/test_api_idempotency_namespace.py` | Canonical OpenAI-compat idempotency is scoped to the authenticated key namespace (a rotated key is a different principal). |
| `tests/gateway/test_api_image_capture_lease.py` | An accepted API image keeps its bytes while its admission is still committing. |
| `tests/gateway/test_api_image_delete_scale.py` | Deleting a session and recovering API turns stay under SQLite's expression limit (1,000 images). |
| `tests/gateway/test_api_image_mislabelled_mime.py` | A data URL whose label disagrees with its bytes is admitted under the sniffed type. |
| `tests/gateway/test_api_implicit_session_after_delete.py` | A header-less conversation that opens like a deleted one becomes a new *generation* of that opening, not a refusal forever. |
| `tests/gateway/test_api_media_admission_bounds.py` | API images are validated as a batch before any byte is staged or committed. |
| `tests/gateway/test_api_media_profile_scope.py` | Startup collection of retained API images pairs each profile's media root with its own `state.db`. |
| `tests/gateway/test_api_media_retention.py` | Native scratch cleanup must not retire API image context sharing its bytes. |
| `tests/gateway/test_api_model_lock_fallback.py` | A confirmed browser model lock on a canonical API turn never falls back to the profile chain. |
| `tests/gateway/test_api_notification_outcomes.py` | Diagnostic presentation must not rewrite execution evidence or next-turn callbacks. |
| `tests/gateway/test_api_observe_settled.py` | An API observer arriving after a fast settle or a cancel returns the committed result / the cancellation. |
| `tests/gateway/test_api_observer_gone_session.py` | An exact streaming Chat retry after its session was deleted replays the receipt, not a 500. |
| `tests/gateway/test_api_pending_daemon.py` | API controls and WS views resolve the same real blocking tool waiter. |
| `tests/gateway/test_api_relay_metadata_handoff.py` | Relay metadata a client sends on an API request reaches the canonical turn that executes it. |
| `tests/gateway/test_api_request_one_target.py` | One `Idempotency-Key` names one admission: a second session target never runs it again. |
| `tests/gateway/test_api_responses_replay_frozen_tool_events.py` | A keyed streaming Responses retry replays the incremental tool frames exactly as first sent. |
| `tests/gateway/test_api_responses_stream_retry.py` | An exact streaming Responses retry replays the recorded stream, never a new admission; a changed body under an in-flight key is refused. |
| `tests/gateway/test_api_retired_media.py` | Canonical API turns retain logical identity, reachable controls and owned image bytes. |
| `tests/gateway/test_api_run_steer_before_adopt.py` | `POST /v1/runs/{id}/steer` accepted while the turn is still building its agent reaches that agent. |
| `tests/gateway/test_api_runs_admission_storage_error.py` | A lost admission write answers a retryable 503 and keeps no reservation, so an exact retry runs the work. |
| `tests/gateway/test_api_runs_legacy_declared_key.py` | A session written by an earlier release with a declared `X-Hermes-Session-Key` is adopted, not 409'd forever. |
| `tests/gateway/test_api_runs_native_session_refusal.py` | `/v1/runs` against a natively owned session is a bounded 409, never a 500 with a phantom reservation. |
| `tests/gateway/test_api_runs_poll_shape.py` | `GET /v1/runs/{id}` keeps the documented poll shape. |
| `tests/gateway/test_api_server.py` | The OpenAI-compatible API server: Chat Completions, Responses, chaining, auth, `/v1/models`, redaction, LRU eviction, concurrency dedupe, run ownership markers, security headers. |
| `tests/gateway/test_api_server_active_work_drain.py` | API-server work is adapter-owned; the shutdown drain must count a `/v1/runs` task that exists before its agent, and refuse new API turns once draining. |
| `tests/gateway/test_api_server_artifact_store_async.py` | Artifact-store resolution for the one-shot artifact routes runs off the loop, single-flight. |
| `tests/gateway/test_api_server_bind_guard.py` | The API server bind-address guard: `is_network_accessible` classification and refusal to start without `API_SERVER_KEY`. |
| `tests/gateway/test_api_server_bot_chat_title_fallback.py` | The peer-dm title fallback honours the listing's own filters and never resurrects an archived Bot Chat. |
| `tests/gateway/test_api_server_compaction_projection.py` | Client projections must not expose model-only compaction scaffolding, while keeping real content. |
| `tests/gateway/test_api_server_declared_conversation.py` | Declared-conversation identity (`X-Hermes-Session-Key`) resolves the live session, is isolated per key, rotates with compression and never rebinds across settlement. |
| `tests/gateway/test_api_server_jobs.py` | The Cron Jobs API: CRUD, pause/resume/run, input validation, and auth enforcement. |
| `tests/gateway/test_api_server_media_data_urls.py` | `MEDIA:<path>` tags are inlined as markdown data URLs before crossing the HTTP boundary. |
| `tests/gateway/test_api_server_memory_sessions.py` | `api_server` keeps one memory provider per session across requests. |
| `tests/gateway/test_api_server_model_options_include_unconfigured.py` | `GET /api/model/options` forwards `include_unconfigured` instead of hardcoding it. |
| `tests/gateway/test_api_server_multimodal.py` | Inline image inputs on `/v1/chat/completions` and `/v1/responses` through a real aiohttp app. |
| `tests/gateway/test_api_server_multiplex_secret_scope.py` | Under multiplex the default listener's API requests must still get a profile scope or they fail closed. |
| `tests/gateway/test_api_server_normalize.py` | `_normalize_chat_content` across the four content-part shapes. |
| `tests/gateway/test_api_server_profile_prefix_misdelivery.py` | A `/p/<profile>/` prefix on a non-multiplexed gateway must not misdeliver — it is an *address*. |
| `tests/gateway/test_api_server_reasoning_ladder.py` | API-server reasoning-effort parsing accepts the full ladder (`max`, `ultra` included), not just `none..xhigh`. |
| `tests/gateway/test_api_server_reasoning_nonstream.py` | Non-streaming routes carry `message.reasoning_content` / a `reasoning` output item, and an echoed reasoning item is not a 400. |
| `tests/gateway/test_api_server_reasoning_stream.py` | The SSE writers emit reasoning as `delta.reasoning_content` and the reasoning-summary event family, with a monotonic `sequence_number`. |
| `tests/gateway/test_api_server_response_store_profile_scope.py` | `/v1/responses` state belongs to the routed profile (client-chosen conversation names must not cross profiles). |
| `tests/gateway/test_api_server_responses_history_cap.py` | An opt-in byte cap on tool outputs in the stored Responses history (one 677 KB write was the incident). |
| `tests/gateway/test_api_server_responses_history_dedupe.py` | Stored Responses transcripts must not duplicate history across chained turns (3→8→17 growth was the bug). |
| `tests/gateway/test_api_server_room_dispatch.py` | Compatibility seams for extracted RoomLink dispatch handling; extra fields are rejected before grant verification. |
| `tests/gateway/test_api_server_room_grants.py` | RoomLink grant authority: policy drift, gateway-owned secret, superseded authority. |
| `tests/gateway/test_api_server_runs.py` | `/v1/runs`: start, status, events, steer, stop; subscriber fan-out, reconnect deltas, CORS, auth, terminal status mapping. |
| `tests/gateway/test_api_server_runs_hosted_room.py` | `/v1/runs` under hosted-room grants: exact approval request ids, grant scope limits, idempotent refresh, revoke fencing. |
| `tests/gateway/test_api_server_runs_import_isolation.py` | Import-time invariant: a missing `RequestKey` must not take `web` down with it. |
| `tests/gateway/test_api_server_sse_keepalive.py` | Every SSE writer emits a comment frame before remote clients' ~20 s idle drop. |
| `tests/gateway/test_api_server_status_stream.py` | Agent status lines reach the OpenAI-compatible SSE writers as `hermes.status` events. |
| `tests/gateway/test_api_server_toolset.py` | The default `api_server` toolset includes the terminal toolset. |
| `tests/gateway/test_api_server_transform_llm_output.py` | `transform_llm_output` rewriting the final still reaches the client on the *streaming* routes. |
| `tests/gateway/test_api_server_turn_boundary.py` | The Responses current-turn boundary is anchored on this turn's user row, not on prefix equality with the client history. |
| `tests/gateway/test_api_session_compression_exhaustion.py` | An API conversation whose turn exhausts compression stays addressable and the re-run continues the failed attempt's row. |
| `tests/gateway/test_api_session_create_after_delete.py` | `POST /api/sessions` with a deleted id is refused at create time (409 `session_deleted`), not later at every turn. |
| `tests/gateway/test_api_session_preflight.py` | The browser may send the advertised continuation header only from allowed origins. |
| `tests/gateway/test_api_settled_history_release.py` | Settlement itself drops a text-only API row's client history, not only the next restart's sweep. |
| `tests/gateway/test_api_settled_payload_compaction.py` | A settled API admission keeps its committed image by reference, not as a second base64 copy. |
| `tests/gateway/test_api_settled_row_retention.py` | A settled API admission row keeps only what exact-retry projections read. |
| `tests/gateway/test_api_source_binding.py` | API source restoration cannot mint a parallel native conversation. |
| `tests/gateway/test_api_stop_claim_race.py` | Stopping a queued API run the drain claims mid-stop interrupts the claim, never 409s. |
| `tests/gateway/test_api_store_error_status.py` | Canonical API refusals keep their retry semantics on the wire: 503+Retry-After / 400 / 409. |
| `tests/gateway/test_api_synthetic_nudge_receipt.py` | An internal user-role recovery nudge must not erase earlier output in the same API turn. |
| `tests/gateway/test_api_terminal_http.py` | Transport projections never report a non-successful result as completion. |
| `tests/gateway/test_api_unknown_resolution.py` | HTTP run owners can acknowledge an exact unknown API admission after a restart, exactly once and only for the right owner. |
| `tests/gateway/test_approval_boundary.py` | WeCom native-streaming approval boundary: finalizes and disables native, uses a placeholder, and falls back to a send when the finalize fails. |
| `tests/gateway/test_approval_prompt_redaction.py` | The approval prompt must redact credential-shaped values from the command text before sending it to a chat platform. |
| `tests/gateway/test_approval_send_timeout_ambiguity.py` | An approval prompt-send **timeout** is ambiguous, not a failure: it must not trigger the re-ask/text-fallback lane. |
| `tests/gateway/test_approval_timeout_notice.py` | The exec-approval timeout notice hook fires only for the still-current run and only for a timeout. |
| `tests/gateway/test_approvals_command.py` | A non-admin cannot make a persistent approval change through `/approvals`. |
| `tests/gateway/test_approve_deny_commands.py` | `/approve` and `/deny`: per-session FIFO of concurrent approvals, canonical timeout, a `deny` reason, and contextvar-based routing to the originating session. |
| `tests/gateway/test_async_delegation_session_binding.py` | Async delegations pin to the spawning session, never resurrect a dead parent, and are dropped by `/new`. |
| `tests/gateway/test_async_delivery_capability.py` | Tools that promise async delivery must refuse the promise on a stateless (API-server) channel. |
| `tests/gateway/test_async_media_cache.py` | The async media-cache wrapper keeps the event loop responsive, propagates validation errors and uses the active profile home. |
| `tests/gateway/test_async_session_db.py` | `AsyncSessionDB` offloads each synchronous call via `asyncio.to_thread`; concurrent claim handoff has a single winner. |
| `tests/gateway/test_attachment_retry_mixed_staging.py` | A missing staging file must not hide a changed sibling on an exact retry. |
| `tests/gateway/test_audio_cache.py` | Audio cache dir, byte caching, old-file cleanup and screenshot-cache cleanup. |
| `tests/gateway/test_auth_fallback.py` | An `AuthError` triggers fallback-provider resolution. |
| `tests/gateway/test_authenticated_session_identity.py` | Verified dashboard identities own separate durable authority receipts. |
| `tests/gateway/test_authority_active_list.py` | `session.active_list` is answered by the session authority from its own live turns (a 45 s quiet turn is "working", not reaped). |
| `tests/gateway/test_authority_approval_projection.py` | The authority answers the Desktop's approval-replay reads for its own sessions. |
| `tests/gateway/test_authority_automation.py` | Completion producers must commit to the same FIFO as human input. |
| `tests/gateway/test_authority_busy_plaintext_approval.py` | Under the session authority a busy bare "yes" still answers a blocking approval. |
| `tests/gateway/test_authority_busy_preempt_parity.py` | The authority's busy preempt keeps main's busy handler: voice steers, steer folds, busy ack. |
| `tests/gateway/test_authority_cold_route_recovery.py` | A cold messaging-platform session mounts for a local viewer; a route moved past the row mounts from its own origin, never another profile's. |
| `tests/gateway/test_authority_complete_persisted_turn.py` | `message.complete` carries the turn's committed row receipt and precedes the idle `session.info`. |
| `tests/gateway/test_authority_complete_reused_final.py` | A reused final keeps main's `message.complete` contract (the `response_reused` flag). |
| `tests/gateway/test_authority_connection.py` | Connection membership against the real authority: repeated resume/close preserve only live memberships; a SQLite failure keeps the wire error and logs its cause without flooding. |
| `tests/gateway/test_authority_events.py` | A full observer cannot block real authority execution; replay matches the subscription watermark or requires a snapshot. |
| `tests/gateway/test_authority_listing_loop_turns.py` | Live listings read the store **off the loop in batches** (a 4,049-row store stalled the loop past 10 s). |
| `tests/gateway/test_authority_pause_recovery.py` | Paused FIFO heads release observers and resume after their compute worker finishes. |
| `tests/gateway/test_authority_principal.py` | Server-stamped grants retain their scope through connection admission; a question response does not grant execution control. |
| `tests/gateway/test_authority_resident_stop.py` | Authority Stop must reach a running agent after its reusable cache entry is evicted. |
| `tests/gateway/test_authority_stream.py` | The canonical execution stream has one order and rejects retired callbacks. |
| `tests/gateway/test_authority_unknown_resolution.py` | An owner restart leaves a started admission `unknown`; a client must be able to acknowledge it exactly once, fenced by generation. |
| `tests/gateway/test_auto_continue.py` | After a mid-agent-work restart, an API-only system note tells the model not to re-execute stale interrupted tool calls. |
| `tests/gateway/test_auto_reset_clean_context.py` | After a compression-exhaustion auto-reset the next turn's transcript is empty. |
| `tests/gateway/test_auto_reset_evicts_cached_agent.py` | Auto-reset is a full conversation boundary: per-session caches do not survive it. |
| `tests/gateway/test_auto_skill_title_input.py` | Title input is user intent, not the gateway's model-facing skill payload. |
| `tests/gateway/test_auto_voice_reply_format.py` | Auto-TTS voice-reply audio format is platform-aware and never inherits global auto-TTS for A2A or local sessions. |
| `tests/gateway/test_automation_compression_media.py` | Producer completions and heartbeats keep entering a conversation after compression moved its route to a child. |
| `tests/gateway/test_automation_notification_category.py` | Diagnostic-only metadata survives the canonical FIFO, with a closed producer set for `display_kind`. |
| `tests/gateway/test_automation_retry.py` | Durable producer retries retain batch identities after an owner restart; an unowned completion refunds every sibling. |
| `tests/gateway/test_background_command.py` | `/bg` runs a prompt in a separate background session and sends the result. |
| `tests/gateway/test_background_process_notifications.py` | Configurable background-process notification modes (off/result/error/all), session-key parsing, off-loop store reads, and drain formatting. |
| `tests/gateway/test_background_process_served_apiserver_wake.py` | A served profile's background-process completion wakes its `api_server` session in-process, never on the shared default listener. |
| `tests/gateway/test_base_auto_tts_output_format.py` | Base-adapter auto-TTS must pass a platform-aware explicit output path (a cleared contextvar always resolved False). |
| `tests/gateway/test_base_topic_sessions.py` | Base-adapter topic-aware session handling: same-topic interrupt and same-topic reply. |
| `tests/gateway/test_base_warning_owner_scope.py` | Composed delivery policy across real profile files, runner scopes and adapter transport. |
| `tests/gateway/test_baseexception_turn_notify.py` | A `SystemExit`/`KeyboardInterrupt` escaping a turn still notifies the user and is re-raised. |
| `tests/gateway/test_bluebubbles_plugin.py` | The BlueBubbles iMessage adapter: env overrides, markdown stripping, webhook registration, attachment caching, and no core wiring left. |
| `tests/gateway/test_bootstrap_deferred_integrity_scan.py` | `start_gateway` runs the unclean-exit `state.db` scan off the event loop, after the runner is live. |
| `tests/gateway/test_bootstrap_early_exit_teardown.py` | A startup that never reaches running mode must not look like a clean shutdown. |
| `tests/gateway/test_bot_authority.py` | Bot relay uses the ordinary daemon's durable FIFO, not an attached viewer. |
| `tests/gateway/test_bot_chat_follows_profile.py` | A Bot Chat follows its profile's current route, whoever creates it; other titles and deliberate freezes stay frozen. |
| `tests/gateway/test_bot_chat_unadoptable_local_title.py` | An unadoptable local "Bot Chat" row is moved aside rather than refusing every Bot Chat delivery for good. |
| `tests/gateway/test_bot_dm_held_by_session_writer.py` | A Bot DM the owner refuses before admission is a definite, named no-send, settled durably so nothing replays it. |
| `tests/gateway/test_bot_door_message_cap.py` | The shared Bot door caps a relayed bot DM but admits a trusted producer's report whole. |
| `tests/gateway/test_bot_loop_guard.py` | Bot-to-bot loop guard: a chat in cooldown is refused, bots are counted once, humans are never metered, and the budget is per chat and platform. |
| `tests/gateway/test_bot_mailbox_async.py` | Bot receipt polling is local and mailbox serialization never parks the event loop. |
| `tests/gateway/test_bot_mailbox_cancellation.py` | Startup cancellation cannot release mailbox ownership before the I/O physically ends. |
| `tests/gateway/test_bot_paused_waiter.py` | The legacy Bot watcher survives a recoverable shared-FIFO pause. |
| `tests/gateway/test_bot_receipt_corruption.py` | Bulk Bot receipt recovery isolates structurally corrupt files without weakening exact-id failures. |
| `tests/gateway/test_bot_receipt_pin_fifo.py` | Legacy Bot mailbox tickets keep FIFO order across an unresolved pre-admission pin. |
| `tests/gateway/test_bot_receipt_queue_full.py` | A `queue_full` refusal withdraws the pre-admission pin so the same-id retry admits once the backlog drains. |
| `tests/gateway/test_bot_receipt_recovery_logs.py` | Startup Bot receipt recovery says what it could not answer, and where (file + traceback). |
| `tests/gateway/test_bot_receipt_refusal.py` | A definitely-refused delivery turns its pin into a terminal `failed` receipt that the bulk scan reads without warning. |
| `tests/gateway/test_bot_receipt_stale_pin.py` | A stale pre-admission pin whose admission never committed is withdrawn by the owner's scan past the grace window. |
| `tests/gateway/test_bot_receipt_tombstone_expiry.py` | A deleted session's admission tombstones age out; the receipts naming them do not, and none may become `storage_unavailable`. |
| `tests/gateway/test_bot_result_recovery.py` | Bot receipts recover only their exact committed admission result. |
| `tests/gateway/test_bot_roster_fleet.py` | Every Bots roster row resolves its own profile's Bot Chat however that chat was created. |
| `tests/gateway/test_bot_roster_worker_session.py` | The canonical Bots roster answers `worker_session` with the contract's fields. |
| `tests/gateway/test_boundary_evict_commits_memory.py` | `/new` and `/compress` are session *boundaries* for memory providers, not resource evictions — they commit the transcript first. |
| `tests/gateway/test_bounded_adapter_teardown.py` | The shutdown teardown loop must not hang on a wedged adapter: bounded cancel, then continue. |
| `tests/gateway/test_branch_after_compressed_root_delete.py` | Deleting a compressed, branched conversation leaves its branch a working conversation. |
| `tests/gateway/test_branch_routing_columns.py` | `/branch` must write the routing columns at create time, not only on `switch_session`. |
| `tests/gateway/test_branch_secondary_profile_origin.py` | A branched local session keeps its owning profile's origin and resumes after restart. |
| `tests/gateway/test_branch_thread_command.py` | `/branch` on thread-capable platforms opens a sibling thread and keeps the origin. |
| `tests/gateway/test_browser_control_api.py` | Browser-control registration grants only an exact action allowlist; tickets are short-lived and single-use; capabilities are truthful and disabled by default. |
| `tests/gateway/test_browser_control_artifacts.py` | One-shot artifact transport: size/MIME gates, SHA-256 verification, scope binding, per-principal rate limits, and Developer Mode gating of `browser_evaluate`/raw CDP. |
| `tests/gateway/test_browser_control_broker.py` | Broker registration tickets, controller selection, noop round-trips, cancellation targeting, and detach semantics. |
| `tests/gateway/test_browser_control_broker_hardening.py` | Broker hardening: detach emits cancel before the controller is removed, the selected controller is revalidated after a detach race, and a completion must match the pending command's scope. |
| `tests/gateway/test_browser_control_cloud.py` | Cloud browser control: dashboard ticket identity is carried forward without trusting the client, and the server never judges a client by the pipe owner. |
| `tests/gateway/test_browser_manage_shared_owner.py` | `/browser connect|disconnect` runs in the session's profile alone, on a shared owner. |
| `tests/gateway/test_busy_burst_merge_shared.py` | A busy same-sender burst is one authority admission, as main merged it into one turn. |
| `tests/gateway/test_busy_burst_serial_reader.py` | A serial receive loop's busy burst still merges and the loop never waits out the hold window. |
| `tests/gateway/test_busy_command.py` | `/busy` status/set dispatch, with a failed save preserving the mode. |
| `tests/gateway/test_busy_durable_acceptance.py` | Serial transports regain their receive loop once input is durable. |
| `tests/gateway/test_busy_followup_after_session_release.py` | A follow-up routed while a session finishes must not be stranded. |
| `tests/gateway/test_busy_followup_guard_release.py` | A busy follow-up must not be parked when the turn it queued behind finishes mid-decision. |
| `tests/gateway/test_busy_followup_marker_handoff.py` | A busy follow-up's crash marker survives until its reply is in the delivery ledger. |
| `tests/gateway/test_busy_photo_interrupt_once.py` | A photo sent during a running turn is one next turn, not two. |
| `tests/gateway/test_busy_redirect_anchor.py` | A successful busy redirect re-anchors the running turn's reply to the redirecting message. |
| `tests/gateway/test_busy_reply_internal_anchor.py` | A busy-path reply to an internal wake never hands the wake's producer identity to the adapter. |
| `tests/gateway/test_busy_requeue_hot_loop.py` | A busy follow-up the runner re-queues must not hot-loop through the adapter drain. |
| `tests/gateway/test_busy_session_ack.py` | Busy-session acknowledgement: immediate status instead of silence, with FIFO text follow-ups, steer/interrupt modes and a no-denominator status detail. |
| `tests/gateway/test_busy_session_auth_bypass.py` | Unauthorized users are blocked in the busy-session path too (the busy path used to skip the auth check entirely). |
| `tests/gateway/test_busy_session_profile_scope.py` | A secondary multiplex profile's busy follow-ups authorize against *that* profile's allowlist. |
| `tests/gateway/test_busy_steer_origin.py` | Per-injection origin survives every busy steer/redirect entry point (lossless data, not prompt lines). |
| `tests/gateway/test_busy_steer_subagent_fanout.py` | Busy-mode steer must fan out to the subagents the parent is blocked on. |
| `tests/gateway/test_busy_wake_admission.py` | Trusted wakes cross the real adapter busy boundary, not external-user auth. |
| `tests/gateway/test_buzz_adapter.py` | The Buzz (Nostr) adapter: npub/hex handling, scoped env, secret fallbacks, SSRF-guarded downloads, and 146 cases in all. |
| `tests/gateway/test_buzz_authz.py` | `BUZZ_ALLOWED_USERS` accepts npub or hex; the comparison decodes npub at comparison time. |
| `tests/gateway/test_buzz_forum_kinds.py` | Buzz forum-kind dispatch (kind 45001/45003) — the WS subscription filter and the dispatch gate previously hardcoded kind 9. |
| `tests/gateway/test_buzz_mention_resolution.py` | Buzz `@mention` resolution: membership-accurate candidates, token boundaries, ambiguity, and publish retries. |
| `tests/gateway/test_buzz_progress_thread_routing.py` | Buzz progress/status thread routing. |
| `tests/gateway/test_buzz_thread_topology.py` | NIP-10 thread-root anchoring across send/image/inbound, plus `reply_in_thread` / `reply_to_mode` config honouring. |
| `tests/gateway/test_buzz_websocket.py` | The Buzz WebSocket transport (NIP-42): BIP-340 signing vector, reconnect/back-off, discovery, and channel pruning. |
| `tests/gateway/test_cached_agent_history_guard.py` | Cached gateway transcript selection: replay cleanup preserved, live rows win, and persistent transcript lag escalates to an error. |
| `tests/gateway/test_cached_agent_max_iterations.py` | A long-lived cached agent must run the *current* configured iteration budget, not the one it was constructed with. |
| `tests/gateway/test_cancel_background_drain.py` | `cancel_background_tasks` must drain late-arriving tasks, not drop the reference to a live one. |

| `tests/gateway/test_canonical_complete_path.py` | The Ink TUI's `complete.path` over the canonical connection lists the session's own folder, rooted at the session policy cwd, and refuses a session it does not serve. |
| `tests/gateway/test_canonical_desktop_metadata.py` | Canonical GUI metadata follows the authenticated local-session route across create/info/reattach. |
| `tests/gateway/test_canonical_resume_display_projection.py` | A resumed canonical session renders through main's display projection (compaction handoffs stripped, `/steer` rows unwrapped, tool rows labelled from the paired `tool_calls`). |
| `tests/gateway/test_canonical_resume_reasoning_snapshot.py` | A cold Desktop resume reports the reasoning level its frozen policy will run, so the pill never spins. |
| `tests/gateway/test_canonical_session_inventory.py` | A canonical session's snapshot carries main's banner/status inventory (tools by toolset, skills by category, MCP servers, version, provider) for its frozen policy. |
| `tests/gateway/test_canonical_stop_hard_cancel.py` | Canonical Stop is main's Stop: hard-cancel plus ending the session's delegations. |
| `tests/gateway/test_canonical_tui_desktop_routes.py` | Ink/Desktop verbs that used to answer `-32601` now run their gateway handlers (message.react, session control buttons, connection card, exec-quick). |
| `tests/gateway/test_canonical_typed_voice_stop.py` | A bare stop phrase typed into a voice chat ends the voice chat and admits nothing, and only for an authorized sender. |
| `tests/gateway/test_canonical_wire_contract.py` | The canonical dispatcher speaks only the declared wire contract; declared params gate the verbs before their handlers. |
| `tests/gateway/test_canonical_wire_contracts.py` | Canonical RPC validation must not reuse the independently shipped serve wire; a handler contract violation is caught. |
| `tests/gateway/test_cgroup_cleanup.py` | The systemd `ExecStopPost` cgroup reaper parses v2 paths, no-ops without `/proc`, and refuses when a live gateway is in the cgroup. |
| `tests/gateway/test_channel_continuity_hint.py` | A lightweight Slack/Discord channel session-continuity hint is emitted only for an auto-reset session with real prior activity. |
| `tests/gateway/test_channel_directory.py` | Channel resolution and display: exact/case-insensitive/prefix matching, off-loop directory builds, pagination, and alias persistence. |
| `tests/gateway/test_channel_directory_connected_only.py` | Session-based channel discovery must not resurrect disconnected platforms. |
| `tests/gateway/test_channel_overrides.py` | Per-channel model and system-prompt overrides, matched by channel or thread id. |
| `tests/gateway/test_chat_completions_approval.py` | Legacy `/v1/chat/completions` streams surface approval requests the client can resolve through `/v1/runs/{id}/approval`; an exact retry replays the pending approval. |
| `tests/gateway/test_chat_completions_final_fallback.py` | Streaming Chat Completions must surface `final_response` when no content delta was streamed, without duplicating it. |
| `tests/gateway/test_chat_completions_tool_progress_optout.py` | `platforms.api_server.tool_progress_events: false` drops the custom `hermes.tool.progress` SSE frames but keeps content frames. |
| `tests/gateway/test_checkpoint_config.py` | Filesystem-checkpoint configuration reaches the real agent from the gateway. |
| `tests/gateway/test_checkpoint_prune_housekeeping.py` | Checkpoint-store pruning rides the gateway housekeeping tick, not the constructor (a tens-of-seconds `git gc` at construction made the first restart look hung). |
| `tests/gateway/test_child_notice_profile_admission.py` | Child-process notices follow the owning profile's policy and live ownership across profile hand-offs. |
| `tests/gateway/test_choice_picker.py` | The interactive choice picker (`/reasoning`, `/fast`) gates on the adapter *type* and falls back to the text status card; a picker selection applies exactly like the typed command. |
| `tests/gateway/test_cjk_fts_config_bridge.py` | `config.yaml sessions.cjk_fts` bridges the search-index knob. |
| `tests/gateway/test_claim_reopen_off_loop.py` | The claim phase's reopen of a finalized local row is a write and runs off the owner loop. |
| `tests/gateway/test_clarify_active_session_bypass.py` | A clarify reply while a gateway session is busy is routed to the runner, namespaced by profile under multiplex. |
| `tests/gateway/test_clarify_batch_settlement_parity.py` | One settlement rule for a batch clarify, whichever registry holds it — both registries call `tools.clarify_batch.settle_batch`. |
| `tests/gateway/test_clarify_card_retire_on_timeout.py` | A clarify that ends without a click retires the adapter's native card with the expired notice; adapters without a card get nothing scheduled. |
| `tests/gateway/test_clarify_delivery_fallback.py` | A clarify card that cannot render is retried as plain text, and a card that fails late does not pass for user inactivity. |
| `tests/gateway/test_clarify_lock_keeps_locked_answers.py` | An answer already locked with `clarify.lock` survives every way the wait can end (timeout, interrupt, cancel-all, error). |
| `tests/gateway/test_clarify_lock_owner.py` | The batch `clarify` request a local viewer gets is answered with `clarify.lock` through the real dispatcher; a foreign profile's viewer cannot answer. |
| `tests/gateway/test_clarify_progress_leak.py` | Raw clarify tool-call JSON must never leak into the chat as a tool-progress bubble. |
| `tests/gateway/test_clarify_send_timeout_ambiguity.py` | A clarify prompt-send **timeout** keeps the registration armed and proceeds to wait; only a definitive error tears it down. |
| `tests/gateway/test_clarify_thread_followup_not_swallowed.py` | A pending native multi-choice clarify must not swallow unrelated thread prose. |
| `tests/gateway/test_classic_slot_holds_fifo_head.py` | A message admitted while a classic fallback wake holds the route's slot waits queued and runs as its own admitted turn. |
| `tests/gateway/test_clean_shutdown_marker.py` | A graceful shutdown writes a `.clean_shutdown` marker so the next startup skips crash-turn recovery. |
| `tests/gateway/test_cleanup_off_loop.py` | Synchronous agent-resource cleanup runs inline on the event loop from three places; it must be off-loop, bounded and swallow executor failure. |
| `tests/gateway/test_cli_plugin_command_in_gateway.py` | A classic CLI plugin command runs in the gateway and its `ctx.call_mcp` reaches the gateway's MCP registry; a redial to a restarted gateway re-reads the plugin. |
| `tests/gateway/test_cli_plugin_command_own_socket.py` | A classic CLI plugin command never holds the CLI's own gateway connection (the gateway answers one socket's requests one at a time). |
| `tests/gateway/test_code_fence_tracking.py` | Code-fence tracking across message split / truncation / streaming: every emitted chunk is a balanced fence, so Discord never renders the rest as one code block. |
| `tests/gateway/test_codex_hygiene_compaction.py` | codex_app_server compression must not be a no-op: the live thread is compacted at the RPC boundary, with a persistent cooldown and no local fallback. |
| `tests/gateway/test_cold_platform_activation.py` | A cold gateway config load imports only the platform adapters the profile configures (~0.5 s per deferred adapter). |
| `tests/gateway/test_command_bypass_active_session.py` | Slash commands must bypass the base adapter's active-session guard, or they are queued as user text. |
| `tests/gateway/test_command_discovery.py` | Command discovery stays transport-independent and cannot select another profile. |
| `tests/gateway/test_compaction_heartbeat_gateway_filter.py` | The compaction heartbeat is classified like `COMPACTION_STATUS` so chat platforms stay quiet but the TUI keeps receiving it. |
| `tests/gateway/test_complete_path_at_filter.py` | The TUI gateway's `complete.path` handler: `@folder:` lists only dirs, `@file:` only files, a remote backend speaks the backend's own POSIX paths. |
| `tests/gateway/test_completion_admission.py` | Real adapter admission is the completion acknowledgement boundary: no admission means no ack, and a replay never repeats. |
| `tests/gateway/test_completion_admission_compression_race.py` | The compression-after-admission result-loss window is closed. |
| `tests/gateway/test_completion_delivery.py` | Lifecycle-scoped delivery of terminal completions: exactly one injection, failed injection stays retryable, batch coalescing is per route, redaction, and shutdown semantics. |
| `tests/gateway/test_completion_owner_retry.py` | Durable delivery retries uncertain delegate ancestry without moving the route. |
| `tests/gateway/test_completion_ownership_proof.py` | An admitted completion carries the ownership proof, so one transient owner read cannot drop it. |
| `tests/gateway/test_completion_session_boundary.py` | Background-process completions are stamped with the spawning conversation's session-db id, so a completion after `/new` is not injected into the new session. |
| `tests/gateway/test_compress_command.py` | `/compress`: works with auto-compaction disabled, surfaces aux-model failure, preserves the platform and gateway session key, and runs under the profile secret scope. |
| `tests/gateway/test_compress_focus.py` | `/compress <focus>` passes the focus topic to the agent. |
| `tests/gateway/test_compress_plugin_engine.py` | `/compress` works with a context-engine plugin (the handler used to reach into `ContextCompressor` private helpers). |
| `tests/gateway/test_compress_preview.py` | `/compress --preview` returns a report without building an agent or touching the transcript. |
| `tests/gateway/test_compression_concurrent_sessions.py` | Concurrent compression: distinct sessions never alias each other; two agents on one session id serialize to exactly one rotation. |
| `tests/gateway/test_compression_failure_session_sync.py` | A failed turn still syncs the compression session split and keeps the failure metadata. |
| `tests/gateway/test_compression_in_flight_check.py` | `_session_has_compression_in_flight` offloads both blocking sources to a thread pool. |
| `tests/gateway/test_compression_interrupt_demotion.py` | With compression in flight, `busy_input_mode='interrupt'` demotes to queue semantics so a burst cannot fork orphaned compression siblings. |
| `tests/gateway/test_compression_progress_notices.py` | `compression.progress_notices: true` opens an opt-in gate for routine compression status on chat platforms only. |
| `tests/gateway/test_config.py` | Gateway configuration: file layers, `to_dict`/`from_dict` round-trips, malformed-value fallbacks, env-ref expansion and the config→env bridge. |
| `tests/gateway/test_config_driven_access_policy.py` | Config-driven platform access policies at the gateway layer: the adapter owns the policy, a stored route cannot reuse a prior authorization, and open DM/group policies fail closed. |
| `tests/gateway/test_config_env_bridge_authority.py` | `config.yaml` is authoritative for `agent.*`, `display.*`, `timezone` and `security.*`; a stale `.env` must not shadow it. |
| `tests/gateway/test_config_policy_daemon.py` | Config-policy recovery on an ordinary daemon. |
| `tests/gateway/test_config_policy_recovery.py` | Config credentials borrow only their frozen profile source across a restart; a changed fallback secret removes that fallback. |
| `tests/gateway/test_config_secret_scope.py` | A frozen config-secret reference is bound to the secrets it carries and the endpoints they authenticate (an added policy field must not wedge every turn). |
| `tests/gateway/test_context_ref_expansion_runtime.py` | The `@` context-reference block must resolve the real context length; the copied `self._model`/`self._base_url` pattern never existed on `GatewayRunner`. |
| `tests/gateway/test_control_socket.py` | The gateway control socket: short/long home, pointer fallback, Windows pipe naming, verb dispatch, stale-socket replacement and fleet inventory. |
| `tests/gateway/test_control_socket_forwarded_subject.py` | A forwarded mutation acts as the dashboard's authenticated principal, not the socket UID; a malformed subject fails closed. |
| `tests/gateway/test_control_socket_pause.py` | The `pause` control-socket verb asks a running gateway to drain and exit cleanly; older gateways answer nothing and the legacy marker path is kept. |
| `tests/gateway/test_control_socket_peer_security.py` | Control-socket trust boundary: symlinked home, pointer publication races, ACL masks, a listener run by another uid, and a squatted fallback directory. |
| `tests/gateway/test_control_socket_windows_live.py` | LIVE Windows E2E: a real child binds the real named pipe with the default verb handlers and the real fleet consumers drive it. |
| `tests/gateway/test_conversation_scope_funnel.py` | `_clear_conversation_scope` is the ONE conversation-boundary funnel: every per-session dict is registered in one place (four "boundary X forgot dict Y" bugs). |
| `tests/gateway/test_cron_active_work_drain.py` | The shutdown drain was structurally blind to in-flight cron work (cron runs in its own thread pool, outside `_running_agents`). |
| `tests/gateway/test_cron_admission_error_surface.py` | A message typed into a cron session fails with a renderable read-only descriptor, present in the reopened transcript. |
| `tests/gateway/test_cron_canonical_receipt_regression.py` | Cron consumes the real Bot Chat receipt over an owned daemon's WebSocket. |
| `tests/gateway/test_cron_delivery_housekeeping.py` | Restart-safe cron deliveries drain independently of the gateway, per profile, with a credential-less satellite queue row. |
| `tests/gateway/test_cron_drain_floor.py` | `restart_drain_timeout` defaults to 0, but cron work drains on its own floor (a cron run has no `resume_pending` and nobody is waiting on it). |
| `tests/gateway/test_cron_fire_startup_gate.py` | A cron fire that lands while the gateway is still starting waits for its adapters; a draining gateway refuses the fire. |
| `tests/gateway/test_cron_fire_webhook.py` | The Chronos cron-fire webhook: a NAS-minted JWT verified by a pluggable fire-verifier, a durable admission before the 202, and ESTOP refusal. |
| `tests/gateway/test_cron_interrupt_notification.py` | When the shutdown interrupts an in-flight cron job, the owner is told — the notice is sent while the adapter is still connected. |
| `tests/gateway/test_cron_owner_progress_stamp.py` | An owner-side canonical cron run proves progress on the *firer's* ledger row. |
| `tests/gateway/test_cron_profile_gate.py` | The gateway ticker stands down for a profile whose own gateway process ticks it. |
| `tests/gateway/test_cron_shutdown_drain.py` | A cron delivery scheduled onto the event loop must not be lost by a synchronous `thread.join()` in the shutdown wait. |
| `tests/gateway/test_cron_ticks_every_profile.py` | The host gateway's cron ticker visits every profile, flag or no flag. |
| `tests/gateway/test_custom_provider_request_overrides.py` | Provider-derived `request_overrides` are preserved on the runtime path and merged under fast mode, not replaced. |
| `tests/gateway/test_cwd_placeholder.py` | `resolve_placeholder_terminal_cwd` uses the messaging cwd; the docker mount is off unless set. |
| `tests/gateway/test_dashboard_mount_close_race.py` | A gateway stop that wins the race with the dashboard's lifespan start never leaves it mounted. |
| `tests/gateway/test_dead_targets.py` | Confirmed-dead delivery targets (deleted groups, kicked bots) are short-circuited and self-heal on a later success. |
| `tests/gateway/test_decline_fallback_suppression.py` | A connector DECLINE must never trigger the text fallback; an ordinary failure still does. |
| `tests/gateway/test_dedupe_user_turns.py` | A persisted user message after a transient provider failure must not stack duplicate user turns on a Telegram retry. |
| `tests/gateway/test_delegation_session_id_leak.py` | Delegated children must not replace their parent's session identity (contextvar *and* environment). |
| `tests/gateway/test_delete_secondary_profile_multiplex.py` | A multiplexed secondary profile's delete retires routing under one owner. |
| `tests/gateway/test_delete_session_no_resurrect.py` | A hard-deleted session must not resurrect through the routing index. |
| `tests/gateway/test_delivery.py` | Delivery routing: explicit targets, source round-trips, native-adapter-wins-over-relay, private topics, truncation and Windows codepage handling. |
| `tests/gateway/test_delivery_flood_invariants.py` | Delivery retries honour the platform deadline without crossing ownership boundaries. |
| `tests/gateway/test_delivery_ledger.py` | The delivery-obligation ledger: state machine, dead-owner claiming, attempts cap, stale cutoff, retention, id stability and the startup redelivery sweep. |
| `tests/gateway/test_delivery_ledger_fd_leak.py` | The delivery ledger must close every SQLite connection (`with sqlite3.connect(...)` commits but never closes). |
| `tests/gateway/test_delivery_ledger_process_home.py` | A served profile's reply is ledgered where the boot sweep looks for it. |
| `tests/gateway/test_delivery_ledger_producer.py` | Producer-hook contract: the obligation is recorded (pending→attempting) *before* the send await, and a ledger failure never blocks the send. |
| `tests/gateway/test_delivery_ledger_single_connection.py` | Recording a reply opens exactly one SQLite connection (the prune must run on the recording connection). |
| `tests/gateway/test_delivery_silence_filter.py` | The outbound silence-narration filter (anti-loop): hallucinated `*(silent)*` tokens are dropped pre-send, with a per-profile filter. |
| `tests/gateway/test_delivery_unknown_target.py` | An unknown destination must not acknowledge a successful local delivery. |
| `tests/gateway/test_derived_generation_after_sweep.py` | A derived conversation resumed after a housekeeping sweep stays on its new generation, and the generation walk never splits a chain. |
| `tests/gateway/test_derived_session_after_delete.py` | A hosted-room member or A2A peer context whose session was deleted continues on a new one, and an exact retry is not re-run. |
| `tests/gateway/test_desktop_process_verbs.py` | Desktop's `/stop`, per-process Stop, MCP reload and file attach are served by the shared owner and reach only this session. |
| `tests/gateway/test_destructive_slash_always_persist_report.py` | "Always Approve" must not claim an opt-out that was not saved (`save_config_value` reports through its return value, not an exception). |
| `tests/gateway/test_destructive_slash_confirm.py` | The destructive-slash-confirm wrapper: native yes/no buttons where supported, text fallback elsewhere, and an opt-out that runs immediately. |
| `tests/gateway/test_diagnostic_wake_presentation.py` | A diagnostic-only wake executes while its unsolicited free-form reply stays private. |
| `tests/gateway/test_diff_command.py` | `/diff` returns fenced, truncated diff text from real git repos and a real checkpoint store. |
| `tests/gateway/test_dingtalk.py` | The DingTalk adapter: env config, webhook send, card payloads, streaming card finalisation and allowlist matching. |
| `tests/gateway/test_dingtalk_reconnect_circuit_breaker.py` | A repeated identical stream error trips a breaker and stays silent; a real SDK start error is bounded and fatal. |
| `tests/gateway/test_discard_delivers_captured_answer.py` | Discarding a turn whose settlement failed commits its captured answer *and* delivers it once. |
| `tests/gateway/test_discord_admission_thread_exemption.py` | A thread the bot joined is exempt from the mention requirement on every ingress path. |
| `tests/gateway/test_discord_allow_bots_yaml_config.py` | `config.yaml discord.allow_bots` reaches the adapter's bot gate through `PlatformConfig.extra`. |
| `tests/gateway/test_discord_allowed_mentions.py` | The Discord `allowed_mentions` safe default blocks `@everyone`/`@here`/role pings so an LLM reply cannot spam a server. |
| `tests/gateway/test_discord_approval_mentions.py` | Discord approval prompts can opt into owner mentions. |
| `tests/gateway/test_discord_attachment_download.py` | Attachment downloads prefer `att.read()` over the legacy URL path, with the SSRF guard still applied. |
| `tests/gateway/test_discord_attachment_receipts.py` | Media targets and receipts describe the attachment, not a fallback notice. |
| `tests/gateway/test_discord_auto_thread_prompt_parity.py` | An auto-threaded @mention reads the *new thread's* topic, as the thread's next message does. |
| `tests/gateway/test_discord_auto_thread_rename_pin.py` | Hermes's own auto-thread title rename keeps the pinned session-context prompt; a moderator's rename does not. |
| `tests/gateway/test_discord_bot_auth_bypass.py` | `DISCORD_ALLOW_BOTS` works without `DISCORD_ALLOWED_USERS` and does not leak to other platforms. |
| `tests/gateway/test_discord_bot_inline_mentions.py` | Bot-authored Discord messages need a typed `<@bot>` by default — a reply ping alone no longer wakes the bot (two bots otherwise volley forever). |
| `tests/gateway/test_discord_channel_controls.py` | `ignored_channels` and `no_thread_channels` config, with the auto-thread failure path notifying the user. |
| `tests/gateway/test_discord_channel_obfuscation.py` | Discord's obfuscated channels (VIEW_CHANNEL-less, flag 1<<17) are skipped by enumeration. |
| `tests/gateway/test_discord_channel_prompts.py` | Per-channel prompt resolution is attached to the dispatched `MessageEvent` on every path. |
| `tests/gateway/test_discord_channel_skills.py` | Channel skill bindings: parent-id matching, thread binding wins. |
| `tests/gateway/test_discord_clarify_buttons.py` | Discord clarify button rendering and resolution, including label truncation and unauthorized-click rejection. |
| `tests/gateway/test_discord_component_auth.py` | Every interactive component view honours the allowlists (a role-allowlist deployment had a wide-open approval surface). |
| `tests/gateway/test_discord_connect.py` | Discord connect: wildcard allowlist resolution, zombie-socket prevention, timeout handling and a non-retryable fatal when the SDK is missing. |
| `tests/gateway/test_discord_document_handling.py` | Document/file attachments: text injected, large text cached not injected, per-attachment size caps. |
| `tests/gateway/test_discord_double_dispatch.py` | The thread-starter message must not run the agent twice. |
| `tests/gateway/test_discord_edit_message_overflow.py` | Oversized `edit_message` splits and delivers (the old code clipped to 1997 chars and reported success). |
| `tests/gateway/test_discord_event_silence.py` | Dispatch-side liveness: a socket that ACKs heartbeats but parses zero DISPATCH events is deaf and trips the silence dimension. |
| `tests/gateway/test_discord_exec_approval_content.py` | Exec-approval prompt content stays inside Discord's cap; slash-confirm and clarify are header-only cards. |
| `tests/gateway/test_discord_format.py` | Discord formatting: tables become bullet groups, truncated URLs keep a clickable full target, markdown delimiters are escaped. |
| `tests/gateway/test_discord_free_response.py` | Free-response defaults, mention gating, auto-thread opt-ins and channel-context backfill/caching (30 cases). |
| `tests/gateway/test_discord_home_link.py` | A pasted Discord channel *link* is accepted wherever a channel id is. |
| `tests/gateway/test_discord_imports.py` | The Discord adapter imports even when the `discord` dependency is missing. |
| `tests/gateway/test_discord_liveness.py` | Health comes from the active WebSocket's ready/open/ACK and heartbeat latency, not from `fetch_user()`. |
| `tests/gateway/test_discord_missed_message_backfill.py` | Missed-message startup backfill: candidate selection, recovery ledger pruning, coalescing, bounded redispatch and cursor safety. |
| `tests/gateway/test_discord_model_picker.py` | The Discord `/model` picker clears its controls before running the switch callback. |
| `tests/gateway/test_discord_model_picker_partition.py` | A provider with more than 25 models is partitioned across multiple Select menus instead of silently truncating. |
| `tests/gateway/test_discord_pending_text_batch_shutdown.py` | The pending text batch is awaited before the background-task set is cleared. |
| `tests/gateway/test_discord_platform_events.py` | `gateway_platform_event` fire-sites: normalized plain-dict envelopes, bot-authored events dropped, malformed identities failing closed. |
| `tests/gateway/test_discord_plugin_setup.py` | The Discord interactive-setup wizard writes credentials and clears the home channel on blank. |
| `tests/gateway/test_discord_prompt_content_siblings.py` | Slash-confirm, clarify and update prompts mirror their payload into plain message content (embeds do not render on some clients). |
| `tests/gateway/test_discord_prompt_timeout_config.py` | The interactive-view timeout is configurable and clamped so a typo cannot outlive Discord's 15-minute interaction token. |
| `tests/gateway/test_discord_race_polish.py` | Concurrent `join_voice_channel` must not double-invoke `channel.connect()`. |
| `tests/gateway/test_discord_reactions.py` | Discord message reactions tied to the processing lifecycle hooks. |
| `tests/gateway/test_discord_reply_mode.py` | `reply_to_mode` (off/first/all) governs threading of multi-chunk replies. |
| `tests/gateway/test_discord_roles_dm_scope.py` | `DISCORD_ALLOWED_ROLES` is **guild-scoped**: a role held in any mutual guild must not authorise a DM. |
| `tests/gateway/test_discord_send.py` | Discord sends: whitespace rejection, retry without a deleted reply target, forum file posts, and guild upload limits. |
| `tests/gateway/test_discord_slash_auth.py` | Slash invocations mirror all four `on_message` gates (users, roles, channels, ignored channels) — they used to bypass every gate. |
| `tests/gateway/test_discord_slash_commands.py` | Native Discord slash fast-paths: thread creation, auto-thread, plugin command registration and the 100-command limit. |
| `tests/gateway/test_discord_split_cap.py` | A split-delivery cap: a degenerate 60 KB turn becomes N−1 chunks plus a short notice, not 31 messages. |
| `tests/gateway/test_discord_sync_limit.py` | Slash-command sync respects the 100-command hard limit. |
| `tests/gateway/test_discord_thread_persistence.py` | Thread participation survives adapter restarts via `~/.hermes/discord_threads.json`. |
| `tests/gateway/test_discord_thread_slash_expired_defer.py` | A `/thread` creation still runs when the interaction token has expired (error 10062), skipping only the ephemeral follow-ups. |
| `tests/gateway/test_discord_triggering_note_persistence.py` | The `[Triggering message id: …]` note rides the API-bound user message but is never persisted as the user row's content. |
| `tests/gateway/test_discord_turn_prompt_parity.py` | Turns built outside `on_message` (slash, thread starter, voice) carry the same prompt inputs as a typed message. |
| `tests/gateway/test_discord_username_allowlist_env_reload.py` | Gateway authz survives the per-turn `.env` hot-reload when the allowlist contains usernames. |
| `tests/gateway/test_discord_view_base_parity.py` | The shared `_HermesView` base: one rejection string shape, one timeout behaviour. |
| `tests/gateway/test_discord_voice_mixer.py` | The continuous voice mixer (ambient + ducked speech) and the verbal-ack-before-tool-calls hook. |
| `tests/gateway/test_discord_voice_rekey.py` | VoiceReceiver re-key resilience: Discord rotates the transport `secret_key` on every (re)connect, and a receiver that snapshots it goes deaf. |
| `tests/gateway/test_discord_voice_role_grant.py` | A spoken turn from a role-admitted member reaches the agent (the role grant is recomputed for the current speaker). |
| `tests/gateway/test_discord_voice_stale_binding.py` | An utterance is dispatched only into the conversation it was captured for. |
| `tests/gateway/test_disk_status.py` | The `/api/status` disk rollup: percent + headroom, absolute floor, and `unknown` for a missing or malformed sample. |
| `tests/gateway/test_display_admission.py` | Desktop's large-paste `title_preview` and hidden `display_kind` survive canonical admission, bound to their own turn. |
| `tests/gateway/test_display_config.py` | The per-platform display/verbosity resolver: winning source, platform override, legacy keys, and string-boolean normalisation. |
| `tests/gateway/test_display_null_turn_wiring.py` | A profile config with `display: null` must not crash turn wiring. |
| `tests/gateway/test_dm_topics.py` | Telegram DM private-chat topics: creation, persistence back to `config.yaml`, hot reload and skill binding. |
| `tests/gateway/test_docker_session_workspace.py` | A gateway-owned session's client cwd reaches the Docker terminal backend; per-session containers mount their own cwd. |
| `tests/gateway/test_document_cache.py` | The document cache: dir creation, filename preservation, old-file cleanup and MIME routing. |
| `tests/gateway/test_document_context_note.py` | The document context note tells the agent to read the cached path for non-inlined text and how to extract binary documents. |
| `tests/gateway/test_draft_id_restart_uniqueness.py` | Draft ids are unique across gateway incarnations (the connector's tombstones outlive the process). |
| `tests/gateway/test_drain_active_work_report.py` | A draining gateway *names* the work it is waiting on, and the updater's wait prints it. |
| `tests/gateway/test_duplicate_reply_suppression.py` | Duplicate reply suppression across four fix paths in the base adapter and the run path. |
| `tests/gateway/test_duplicate_user_message.py` | User messages stored twice in `state.db`: the fallback appends must use `skip_db=True` when the agent owns the DB. |
| `tests/gateway/test_email.py` | The e-mail adapter: config, header/body extraction, authorization, IMAP fetch, poison-message skipping and reconnect snapshot restore. |
| `tests/gateway/test_email_charset_fallback.py` | Unknown or malformed charsets must never drop mail (UIDs are marked seen *before* the fetch). |
| `tests/gateway/test_email_imap_id_protocol.py` | IMAP ID negotiation against a local protocol peer preserves the inbox connection. |
| `tests/gateway/test_email_robustness.py` | Malformed IMAP responses are skipped instead of aborting the batch; Message-ID generation tolerates a missing `@`. |
| `tests/gateway/test_email_secret_scope.py` | The e-mail adapter reads its credentials from the profile-scoped secret store, not `os.environ`. |
| `tests/gateway/test_empty_model_fallback.py` | Empty-model fallback when a provider is configured but the model is missing. |
| `tests/gateway/test_empty_model_recovery.py` | An empty model on the post-interrupt recovery turn recovers the session's last good route. |
| `tests/gateway/test_empty_sentinel_rewrite_copy.py` | The `(empty)` sentinel rewrite reads the same constant as the CLI explainer. |
| `tests/gateway/test_env_override_explicit_disable.py` | An explicit `platforms.<x>.enabled: false` in `config.yaml` survives `_apply_env_overrides` when credentials are present in the environment. |
| `tests/gateway/test_ephemeral_reply.py` | `EphemeralReply`: a slash handler can ask for auto-deletion of its reply after a TTL. |
| `tests/gateway/test_escape_reasoning_fences.py` | Inner triple-backtick markers are escaped before reasoning text is wrapped in an outer fence. |
| `tests/gateway/test_estop_interactive_turns.py` | `hermes pause` holds every gateway turn, interactive ones included; a running turn finishes; `hermes resume` lifts it. |
| `tests/gateway/test_exec_approval_template.py` | The exec-approval choice set comes from one place; adapters only render it. |
| `tests/gateway/test_exec_approval_timeout_notice.py` | When a messaging-platform approval prompt times out, the chat says the command did not run. |
| `tests/gateway/test_exec_quick_command_tree.py` | A timed-out or cancelled `exec` quick command leaves nothing running (the whole process group is killed). |
| `tests/gateway/test_executor_pool_isolation.py` | Best-effort session housekeeping must not be able to starve agent turn bodies (an abandoned future still occupies a worker). |
| `tests/gateway/test_external_drain_control.py` | The external drain-control marker contract: presence-based, epoch-stamped, expiring, and a reversible state machine that refuses new turns. |
| `tests/gateway/test_extract_local_files.py` | Auto-detection of bare local file paths in model output for native media delivery: path matching, code-block exclusion, URL rejection, dedupe. |
| `tests/gateway/test_failure_writer_ownership.py` | Accepted inbound turns have one durable owner, including the exception-fallback path. |
| `tests/gateway/test_fallback_chain_reload.py` | The gateway must not freeze `fallback_providers` at process start; the chain is re-read per turn. |
| `tests/gateway/test_fast_command.py` | `/fast` support and priority-processing routing, session override over config default, and a recovered Telegram topic key. |
| `tests/gateway/test_faulthandler_no_stderr.py` | The gateway survives `faulthandler.enable()` with `sys.stderr=None` (the SIGUSR2 stack dump). |
| `tests/gateway/test_feishu.py` | The Feishu integration: env config, WS connect, card/edit/delete, reactions, group policy, post/audio/text extraction and dedup persistence. |
| `tests/gateway/test_feishu_approval_buttons.py` | Feishu interactive card approval buttons: resolve-once, unauthorized clicks, chat mismatch, and the response file written only by an authorized operator. |
| `tests/gateway/test_feishu_bot_admission.py` | Feishu bot-sender admission: identity variants, bot-vs-app classification, DM pairing forwarding and profile-scoped DM policy. |
| `tests/gateway/test_feishu_bot_auth_bypass.py` | The Feishu bot-sender authorization bypass, mirroring Discord's, without leaking to other platforms. |
| `tests/gateway/test_feishu_channel_prompts.py` | Feishu per-channel prompt resolution, attached to the dispatched event on every path. |
| `tests/gateway/test_feishu_comment.py` | `feishu_comment` event filtering, access control and the wiki reverse lookup. |
| `tests/gateway/test_feishu_comment_rules.py` | The 3-tier access-control rule engine for Feishu comments. |
| `tests/gateway/test_feishu_group_policy_surfacing.py` | The empty-allowlist default deny in Feishu group admission is surfaced once at WARNING with the keys to set. |
| `tests/gateway/test_feishu_lazy_import.py` | Deferred Feishu SDK loading: a configured platform does not load the SDK at check time; `connect()` loads it on a worker thread. |
| `tests/gateway/test_feishu_meeting_invite.py` | `vc.bot.meeting_invited_v1` handling: body parsing, routing as a synthetic message, duplicate drop. |
| `tests/gateway/test_feishu_onboard.py` | Feishu scan-to-create registration: device code, QR poll, lark-tenant domain switch and failure paths. |
| `tests/gateway/test_feishu_profile_scope_hops.py` | The Feishu adapter's thread hops keep the profile scope (the drive-comment agent turn and the WS client thread). |
| `tests/gateway/test_feishu_sdk_executor.py` | The adapter owns its SDK `ThreadPoolExecutor` and recreates it after a shutdown (the "zombie gateway" bug). |
| `tests/gateway/test_feishu_table_markdown.py` | A markdown pipe table must use `post`+`md`, not be downgraded to `text`. |
| `tests/gateway/test_feishu_voice_message_type.py` | Lark's native `audio` msg_type is a VOICE note and is auto-transcribed. |
| `tests/gateway/test_feishu_ws_multiplex_isolation.py` | The `lark_oapi` WS client's module-level loop global is last-write-wins; N profiles need N loops and a supervisor that restarts a dead WS thread. |
| `tests/gateway/test_fence_chunker.py` | The shared fence-aware markdown chunker core, asserted by *contract* rather than snapshot. |
| `tests/gateway/test_fifo_overflow_rescue.py` | FIFO overflow orphan rescue: a demoted follow-up that never got promoted is returned to the slot in FIFO order. |
| `tests/gateway/test_finalize_session_off_loop.py` | `on_session_finalize` plugin hooks must not block the gateway event loop and must be bounded. |
| `tests/gateway/test_finite_unattended_wire_grant.py` | An unattended (auto-approving) finite turn is `hermes -z` only; every other submitter gets `invalid_params`. |
| `tests/gateway/test_finite_viewer_final_send.py` | A finite viewer's turn must not mark the reply `already_sent` off the transport's confirmation. |
| `tests/gateway/test_first_contact_dm.py` | A messaging gateway's first-ever DM carries the baseline profile-build offer, once. |
| `tests/gateway/test_first_turn_session_meta_rebaseline.py` | The first-turn `session_meta` row must be re-baselined into the agent cache's message-count snapshot. |
| `tests/gateway/test_follow_profile_followups.py` | `follow_profile_config` follow-ups: one profile read per turn, explicit create-time choices over followed defaults, and followed secrets never recovered from a frozen receipt. |
| `tests/gateway/test_follower_marker_handoff.py` | A queued follower is not claimed while the settled turn's crash marker is still with its adapter. |
| `tests/gateway/test_footer_command_mid_run.py` | `/footer` dispatches to its handler while an agent is running (it is a pure display toggle). |
| `tests/gateway/test_foreign_stale_gateway_lock.py` | A `gateway.lock` this user cannot read to prove unheld is refused with a terminal reason and the exact recovery command. |
| `tests/gateway/test_fresh_reset_skill_injection.py` | Topic/channel skill auto-injection still works after `/new` or `/reset` (the fresh-reset flag must survive the `created_at == updated_at` window). |
| `tests/gateway/test_gateway_api_session_platform.py` | A session created over the gateway's own API is platform `LOCAL` whether the client is local or remote. |
| `tests/gateway/test_gateway_api_token_exposure.py` | The always-on HTTP listener must never publish its bearer token to a loopback peer. |
| `tests/gateway/test_gateway_command_dispatch_minimal.py` | An idle queue sends its payload as the next turn. |
| `tests/gateway/test_gateway_command_help.py` | Help rendering sanitises slash-command mentions for Telegram. |
| `tests/gateway/test_gateway_command_line_matcher.py` | The strict gateway command-line matcher (a loose substring match made `gateway status` look like a running gateway). |
| `tests/gateway/test_gateway_history_persistence_stamp.py` | The DB flush collect does not re-collect gateway history rows. |
| `tests/gateway/test_gateway_inline_bootstrap_identity.py` | A gateway started through one of Hermes' own inline bootstraps is a gateway on every OS (launcher shapes, bundled payload). |
| `tests/gateway/test_gateway_liveness_home_guard.py` | A profile directory copied out of another `HERMES_HOME` must never read as running. |
| `tests/gateway/test_gateway_mcp_oauth_unattended.py` | No gateway MCP path may start a browser OAuth flow, and `mcp_servers` edits after boot are tracked. |
| `tests/gateway/test_gateway_platform_event_hook.py` | The `gateway_platform_event` observer hook: normalized envelopes, post-auth checks, bounded values, and no inert hook surface. |
| `tests/gateway/test_gateway_process_exit.py` | `main` terminates via `os._exit` rather than `SystemExit`, and the exit backstop releases the pid file and runtime lock. |
| `tests/gateway/test_gateway_shutdown.py` | Gateway shutdown: background tasks cancelled, agents interrupted, tool subprocesses killed before adapter disconnect, MCP teardown non-blocking. |
| `tests/gateway/test_gateway_silence_tokens.py` | Intentional-silence tokens: a human turn always gets a visible fallback, an internal turn stays silent, and a failed result is never silence. |
| `tests/gateway/test_gateway_streaming_nested_config.py` | The nested `gateway.streaming` config must be loaded, with the mode/boolean normalisation rules. |
| `tests/gateway/test_gateway_trust_env.py` | One config key controls aiohttp proxy-env honouring at every adapter site. |
| `tests/gateway/test_gateway_utf8_encoding.py` | Static AST guard: every `read_text`/`write_text` in the gateway passes an explicit `encoding=`. |
| `tests/gateway/test_gateway_watchdog_host_sleep.py` | Inactivity watchdogs must not charge host sleep (laptop lid closed) as turn idleness — simulated by advancing the wall clock while the monotonic clock stays put. |
| `tests/gateway/test_goal_continuation_drain.py` | A `/goal` continuation enqueued via the adapter FIFO is drained automatically, with no extra user message. |
| `tests/gateway/test_goal_gate_access.py` | Adding a shell-backed goal quality gate requires an explicit admin (or group admin). |
| `tests/gateway/test_goal_max_turns_config.py` | The gateway goal uses `goals.max_turns` from the full config, and a slow DB init still persists. |
| `tests/gateway/test_goal_resume_restart.py` | `/goal resume` must restart work — it schedules exactly one canonical continuation prompt through the surface's own input path. |

| `tests/gateway/test_goal_status_notice.py` | The goal status notice defers until the post-delivery callback. |
| `tests/gateway/test_goal_verdict_send.py` | The goal verdict message ("✓ Goal achieved", "⏸ budget exhausted") must reach the user — the check used `hasattr(adapter, "send_message")` and adapters expose `send()`. |
| `tests/gateway/test_google_chat.py` | The Google Chat adapter: Pub/Sub and HTTP callback routing, SSRF-guarded downloads, chunked sends, typing cards and authorization. |
| `tests/gateway/test_google_chat_oauth_dependencies.py` | Google Chat dependency installation crosses the package manager's declared-feature interface. |
| `tests/gateway/test_grid_sweep_gateway_diagnostics.py` | Three automatic gateway diagnostics must obey the warning boundary; a requested outcome is never suppressed. |
| `tests/gateway/test_handoff_owned_recovery.py` | A row a completed `/handoff` owns stays recoverable even when the source interface's teardown stamps a non-recoverable `end_reason`. |
| `tests/gateway/test_handoff_secondary_profile_adapter.py` | A secondary profile's handoff must deliver through *its own* adapter and config. |
| `tests/gateway/test_handoff_thread_session_key.py` | A CLI→Discord handoff must key a thread destination on the thread's own id, matching organic in-thread messages. |
| `tests/gateway/test_handoff_watcher_async_db.py` | Every blocking `SessionDB` call in the handoff watcher goes through the `AsyncSessionDB` facade (the Discord heartbeat was stalling). |
| `tests/gateway/test_handoff_watcher_multiprofile.py` | The handoff watcher polls **every** served profile's store and resolves scopes off the event loop. |
| `tests/gateway/test_handoff_watcher_resilience.py` | No head-of-line blocking (one slow handoff must not stop the watcher polling other profiles) and no stranded rows. |
| `tests/gateway/test_heartbeat_acceptance.py` | An adapter slot is not proof a heartbeat reached execution; a cancelled admission is refunded but a started execution is not. |
| `tests/gateway/test_heartbeat_execution_ownership.py` | Admitted heartbeat work belongs to a conversation, not to a reusable route. |
| `tests/gateway/test_heartbeat_inflight_owner_scan.py` | The heartbeat poller coalesces behind an in-flight heartbeat admission wherever it lives. |
| `tests/gateway/test_heartbeat_poller.py` | Heartbeat polls wake idle adapters and never accumulate deferred ticks; the emergency stop holds a due tick without messaging. |
| `tests/gateway/test_heartbeat_session_boundaries.py` | Heartbeat ownership follows compression but ends at a conversation boundary. |
| `tests/gateway/test_heartbeat_watch_lifecycle.py` | Heartbeat watches follow their route and profile, not the poller's creator. |
| `tests/gateway/test_heartbeat_watch_restore.py` | Restart recovery uses current routing and never borrows another profile's heartbeat. |
| `tests/gateway/test_history_media_current_turn.py` | Current-turn TTS media must not be dedup-stripped by the history-media guard. |
| `tests/gateway/test_home_target_env_var.py` | `/sethome` writes to the platform's *own* home-target env var (Matrix `HOME_ROOM`, e-mail `HOME_ADDRESS`). |
| `tests/gateway/test_hook_consent_resync.py` | A running gateway registers a shell hook once consent is recorded and drops it once revoked — no restart, no session open. |
| `tests/gateway/test_hooks.py` | The event hook system: valid hooks load, wildcard matching, async handlers, sync return values collected, `None` dropped. |
| `tests/gateway/test_host_attach_lifecycle.py` | The gateway lifecycle verbs mean "the ONE host process": ATTACH requires a live `identify` answer, a record alone proves only that an owner exists. |
| `tests/gateway/test_host_attach_standalone.py` | A configured standalone profile may coexist but never double-binds a served profile. |
| `tests/gateway/test_host_gateway_lock_refusal.py` | The host gateway lock *refuses* a second gateway instead of observing it. |
| `tests/gateway/test_host_gateway_profile_env.py` | A host gateway spawned from a profile-scoped process must not adopt that profile. |
| `tests/gateway/test_host_rendezvous.py` | Host-wide singleton invariants: one lock per host, staleness proved by incarnation fields, a recycled pid is not the gateway. |
| `tests/gateway/test_host_rendezvous_windows.py` | The host rendezvous token is written with a protected owner-only DACL (`os.open(0o600)` sets no ACLs on Windows). |
| `tests/gateway/test_host_topology.py` | Host topology: the DEFAULT profile is a served profile, not a special owner. |
| `tests/gateway/test_hosted_attachment_bridge.py` | The hosted attachment bridge accepts only a bound manifest after producer authorization. |
| `tests/gateway/test_hosted_clarification_refusal.py` | A persisted hosted policy declines a question without a reply channel; a local one still asks. |
| `tests/gateway/test_hosted_discussion_manifests.py` | Exact event-bound media survives deterministic planning and reconstruction; a forged manifest is rejected. |
| `tests/gateway/test_hosted_document_custody.py` | Hosted non-image documents are retained inputs; the native GC's holder scan keeps the bytes a live row needs. |
| `tests/gateway/test_hosted_group_members.py` | Which local bots a Desktop group may seat: the profiles this gateway serves, plus configured destinations. |
| `tests/gateway/test_hosted_mux_runtime.py` | Hosted multiplexing through real owners and private sockets, with a private RPC that builds policy in the destination scope. |
| `tests/gateway/test_hosted_observation_bounded.py` | Cross-profile hosted observation stays bounded (512 KiB per response line) and an oversized response is its own structured error. |
| `tests/gateway/test_hosted_room_attachment_publication.py` | Canonical message insertion and attachment rollback share one write fence; a failed event insert rolls back retention. |
| `tests/gateway/test_hosted_room_attachments.py` | The hosted room attachment store: private, atomic, deduplicated, quota-bounded, integrity-checked and reconciled at restart. |
| `tests/gateway/test_hosted_room_auth_daemon.py` | Hosted-room isolation over real OIDC-authenticated ordinary daemon sockets. |
| `tests/gateway/test_hosted_room_discussion.py` | Deterministic same-gateway Discussion policy: round planning, mention selection, pass detection, idempotent publication and bounded turns. |
| `tests/gateway/test_hosted_room_driver.py` | The hosted-room driver state machine: leases, fencing, idempotent task admission, indeterminate recovery and schema migration. |
| `tests/gateway/test_hosted_room_execution_policy.py` | Target-issued execution policy: a digest over tools/approvals/iterations, drift requiring re-authorisation, and the served profile's catalog. |
| `tests/gateway/test_hosted_room_expired_commit.py` | Expired staged bytes cannot be revived by a delayed share. |
| `tests/gateway/test_hosted_room_gateway_lifecycle.py` | Messaging-gateway ownership of the hosted Group Chat worker: the supervisor restarts a dead room worker. |
| `tests/gateway/test_hosted_room_links.py` | Private negotiated RoomLink storage: transactional, upserted, owner-only mode, and a repr that never contains the grant. |
| `tests/gateway/test_hosted_room_member_binding.py` | A per-member hosted producer refuses a submit that names another member. |
| `tests/gateway/test_hosted_room_peer.py` | Autonomous cross-gateway hosted-room members: a private persistent grant secret, a tamper-evident catalog digest and scoped grants. |
| `tests/gateway/test_hosted_room_replicas.py` | Replica ingest, promotion and stale-authority demotion for hosted rooms (gap/epoch/authority-stamp checks). |
| `tests/gateway/test_hosted_room_retention_restart.py` | A real process reopen and SQL failures preserve the accepted file boundary. |
| `tests/gateway/test_hosted_room_runtime_attachments.py` | The canonical authority route carries a member turn's bound file end to end. |
| `tests/gateway/test_hosted_rooms.py` | The gateway-hosted room event log: idempotent create, monotonic sequences, per-actor idempotency, bounded paging and retention pruning. |
| `tests/gateway/test_hosted_rooms_read_path.py` | Listing hosted rooms does not enter a write transaction or prune. |
| `tests/gateway/test_hosted_submission_capture_lease.py` | A hosted-room submission holds the documents it captured until its admission commits. |
| `tests/gateway/test_housekeeping_profile_scope.py` | Housekeeping chores that read a profile's home, config or credentials run under the **owning** profile's runtime scope. |
| `tests/gateway/test_hygiene_compaction_keeps_seeded_prompt.py` | Gateway hygiene compression must not persist a reduced-toolset prompt over a live session. |
| `tests/gateway/test_hygiene_compaction_trigger_label.py` | Every automatic compression entry point labels its attempt `gateway_hygiene` so telemetry is honest. |
| `tests/gateway/test_hygiene_deferred_work_drain.py` | Shutdown accounting for executor work detached by hygiene timeouts. |
| `tests/gateway/test_hygiene_failure_cooldown_ladder.py` | Session-hygiene compression escalates its cooldown for repeat failures (60 → 300 → 900 s), across restarts, per session, with a recovery ladder. |
| `tests/gateway/test_hygiene_no_commit_reason.py` | An uncommitted hygiene attempt keeps the transcript; a committed in-place one is adopted. |
| `tests/gateway/test_hygiene_wait_moved_deadline.py` | The hygiene wait judges each slice against the deadline *as it stands after the slice*. |
| `tests/gateway/test_hygiene_warning_lifecycle.py` | Real hygiene turn admission, durable cooldown and notice sink. |
| `tests/gateway/test_identity_canonical_ingress.py` | Identity is canonicalized **first** on every ingress path, so two bots on one gateway keep distinct lanes. |
| `tests/gateway/test_image_input_routing_runtime.py` | A named custom provider selects the vision override, and the route identity check keeps the loop responsive. |
| `tests/gateway/test_import_preserves_tui_cwd.py` | Importing gateway helpers must not apply messaging-only cwd defaults. |
| `tests/gateway/test_inactivity_timeout_receipt.py` | A watchdog timeout stays *failed* even when the handler projects its diagnostic as text. |
| `tests/gateway/test_inbound_media_profile_scope.py` | Inbound attachments on a multiplexed gateway live in the **routed** profile's cache. |
| `tests/gateway/test_incomplete_gateway_turns.py` | A hidden-reasoning-only incomplete turn closes its transcript without a Slack delivery. |
| `tests/gateway/test_ingress_admission_off_loop.py` | Ingress admissions commit off the owner loop: a held SQLite writer must not freeze every session, timer and socket. |
| `tests/gateway/test_ingress_binding_user_id_route.py` | A profile route declared by `user_id` must resolve inside admission. |
| `tests/gateway/test_interactive_prompt_base.py` | The shared interactive-prompt formatting cores: exec-approval template, choice-page pagination, truncation, byte parity with the rewired adapters. |
| `tests/gateway/test_interim_only_consumer_warning.py` | An interim-only stream consumer must not fire the duplicate-send diagnostic. |
| `tests/gateway/test_interim_send_lanes.py` | Every gateway-side mid-turn send lane is marked interim, so seal-interception does not treat it as a final. |
| `tests/gateway/test_internal_event_bypass_pairing.py` | Internal synthetic events bypass user authorization and do not trigger DM pairing. |
| `tests/gateway/test_internal_event_never_interrupts_busy_session.py` | An internal synthetic event must never interrupt a busy session (it was treated as user text and hit the interrupt path). |
| `tests/gateway/test_internal_event_pin_wiring.py` | Call-site wiring guard: an internal event reuses the session-context prompt pin verbatim, so it cannot re-key the conversation. |
| `tests/gateway/test_internal_notification_marker.py` | Internal synthetic turns are persisted typed (`display_kind='internal_notification'`) while keeping `role='user'`. |
| `tests/gateway/test_internal_wake_never_interrupts.py` | An internal wake never interrupts or steers an admitted user turn. |
| `tests/gateway/test_internal_wake_reply_anchor.py` | An internal wake never reply-anchors to its `message_id` (that identity is a JSON producer triple). |
| `tests/gateway/test_interrupt_keeps_parked_internal_wake.py` | Interrupting a session discards a parked human follow-up but never a parked internal wake. |
| `tests/gateway/test_irc_adapter.py` | The IRC adapter: CTCP, byte-limit splitting, unauthorized users, identity lock and standalone send. |
| `tests/gateway/test_journey_compress_restart_fifo.py` | Journey: queued followers → automatic compression → gateway restart before drain; every admission keeps its identity and runs once. |
| `tests/gateway/test_journey_new_session_queued_work.py` | Journey: `/new` rebinds only the invoking view; the earlier session keeps its FIFO. |
| `tests/gateway/test_journey_restart_open_prompts.py` | Journey: restart while one session waits on an approval and another on a clarification; stale prompt ids are refused. |
| `tests/gateway/test_kanban_auto_decompose_live.py` | The auto-decompose setting is re-read every tick, so flipping it to `false` takes effect without a restart. |
| `tests/gateway/test_kanban_auto_decompose_secret_scope.py` | The auto-decompose tick installs the launch profile's secret scope before reading secrets. |
| `tests/gateway/test_kanban_changes_requested_notifier.py` | A "changes requested" notify is passive-only; the wake variant is actionable and exactly routed. |
| `tests/gateway/test_kanban_finite_admission.py` | Dispatched cards retain headless approval semantics, and the durable key lookup is exact. |
| `tests/gateway/test_kanban_multiplex_served_profile_parity.py` | Standalone-vs-served parity for the Kanban dispatcher and notifier under multiplexing. |
| `tests/gateway/test_kanban_notifier.py` | The Kanban notifier: per-subscription delivery metadata, profile isolation, redelivery on the dispatch cycle, and block-loop triage wording. |
| `tests/gateway/test_kanban_notifier_apiserver_wake.py` | On a stateless `api_server` subscription a failed send rewinds the cursor instead of advancing past a never-delivered event. |
| `tests/gateway/test_kanban_notifier_served_apiserver_wake.py` | A served profile's multiplexed `api_server` Kanban wake delivers in-process, in its own scope. |
| `tests/gateway/test_kanban_notifier_wake_only_ordering.py` | In wake-only mode the cursor advances only *after* the wake succeeds. |
| `tests/gateway/test_kanban_notifier_watcher_dispatch_gate.py` | The notifier polling has an independent gateway config gate and needs no dispatch ownership. |
| `tests/gateway/test_kanban_notifier_zero_sub_gate.py` | A board with zero subscriptions is never opened writable (schema init + WAL sidecars per tick). |
| `tests/gateway/test_kanban_reconcile_orphans.py` | Orphaned-card reconciliation: a running card with broken claim bookkeeping is requeued, a live worker pid defers. |
| `tests/gateway/test_kanban_recovery.py` | Real dispatch preserves custom board identity and unknown attempts. |
| `tests/gateway/test_kanban_result_exit.py` | Canonical Kanban receipts retain the shared one-shot outcome semantics. |
| `tests/gateway/test_kanban_route_anchor_capture.py` | Route anchors survive background/subprocess producers without a stale fallback. |
| `tests/gateway/test_kanban_routed_transport.py` | Persisted notification routes authorise exactly one transport, including route-only profiles. |
| `tests/gateway/test_kanban_wake_acceptance.py` | Push admission and durable notifier retries use real adapter/SQLite lifecycles. |
| `tests/gateway/test_kanban_wake_scope.py` | A Kanban wake must key to the same session as inbound messages (Slack session keys include the workspace id). |
| `tests/gateway/test_keep_typing_timeout.py` | The typing-indicator refresh must not block the loop on a slow `send_typing` round-trip, and must pause before a stalled final send. |
| `tests/gateway/test_late_plugin_rewire.py` | Plugins loaded after the gateway started get their platform handlers wired; the rewire is idempotent per native client. |
| `tests/gateway/test_launch_key_resume_rebind.py` | A launch-only key revoked by an owner restart can be re-supplied on `session.resume` — only the session's own durable fingerprint, never a persisted copy. |
| `tests/gateway/test_launch_profile_scope_fallback.py` | A body with no routed profile home belongs to the launch profile — and to nobody else. |
| `tests/gateway/test_launch_secret_retirement.py` | Deleting a local session drops the launch key and frozen config secrets it held in memory, but a branch keeps them until the last descendant dies. |
| `tests/gateway/test_launchd_exit_timeout_drain_cap.py` | A signal-driven stop under launchd must fit the live `ExitTimeOut`; the drain cap applies only to signal stops. |
| `tests/gateway/test_legacy_acp_route.py` | A thread main's in-process ACP server wrote resumes on the route it saved (`model_config`). |
| `tests/gateway/test_legacy_desktop_source.py` | Every old local row the native resume adopts also takes a sidebar edit. |
| `tests/gateway/test_legacy_session_continue_label.py` | Continuing an adopted pre-authority session keeps the label main wrote on its row. |
| `tests/gateway/test_legacy_session_migration.py` | Pre-authority rows never grant ownership to the first remote claimant. |
| `tests/gateway/test_legacy_session_owner_backfill.py` | The owner migrates pre-ownership NULL session rows itself, scoped to its own store. |
| `tests/gateway/test_legacy_session_route_turn.py` | A session a pre-0.22.1 surface wrote resumes on **its** route, with only that route's credential. |
| `tests/gateway/test_legacy_session_row_parity.py` | Resuming a session main created leaves its row as main would (source label and end stamp untouched). |
| `tests/gateway/test_legacy_stamped_bot_chat.py` | Desktop's Bot Chat lookup adopts a legacy local row stamped with the caller's own subject. |
| `tests/gateway/test_lifecycle_ledger.py` | The unclean-shutdown sentinel: `record_startup` claims it, every exit path marks it, and a still-running sentinel from a dead pid is an unclean death. |
| `tests/gateway/test_lifecycle_state_db_check.py` | An unclean gateway death triggers a deferred, off-loop `state.db` integrity check with a bounded deadline. |
| `tests/gateway/test_line_plugin.py` | The LINE adapter: HMAC signature verification, three-way allowlist gating, inbound dedup and the RequestCache state machine. |
| `tests/gateway/test_live_settlement_recovery.py` | An owner that is still alive must expose a failed settlement as recoverable uncertainty, not as a lost result. |
| `tests/gateway/test_load_transcript_db_only.py` | `load_transcript` returns SQLite messages with no JSONL file present. |
| `tests/gateway/test_local_authority_transitions.py` | Local mutation replay and pause episodes respect the durable FIFO. |
| `tests/gateway/test_local_automation.py` | Local automation belongs to the owner: with no observer a completion becomes a note on the next turn, never a lost one. |
| `tests/gateway/test_local_context_ref_session_cwd.py` | `@` references on a local session resolve in that session's cwd, not the daemon's. |
| `tests/gateway/test_local_context_ref_turn_text.py` | `@` references reach the model on every local route (CLI API text, managed workers, refused injections). |
| `tests/gateway/test_local_control_compression_child.py` | Renaming or archiving a cold compressed local conversation by its physical id maps to the lineage owner. |
| `tests/gateway/test_local_create_alias_retry.py` | An exact retry of an alias `session.create` is the same request whatever the owner's `.env` now expands the alias to. |
| `tests/gateway/test_local_create_env_refs.py` | A new local session expands `config.yaml` `${VAR}` refs against the profile's *current* `.env`. |
| `tests/gateway/test_local_debug_never_uploads.py` | `/debug local` on a local session returns the redacted report and makes no network call; from a messaging chat it is refused. |
| `tests/gateway/test_local_desktop_ui.py` | Desktop window bridges for a local viewer's turn: events reach the turn's stream, GUI reads are server requests, and the tour fails fast. |
| `tests/gateway/test_local_display_key.py` | `/reasoning show|hide` and `/footer` on a local session take effect on every local surface. |
| `tests/gateway/test_local_goal_gate_owner_admin.py` | On a local session the session's owner counts as the admin for `/goal gate add`. |
| `tests/gateway/test_local_moa_then_refine.py` | `/refine` still finds the conversation straight after a `/moa` turn — the conversation belongs to the session, not to the cached agent. |
| `tests/gateway/test_local_model_connection_reply.py` | Provider connection errors produce specific, jargon-free replies with a named slash command. |
| `tests/gateway/test_local_producer_admission.py` | Background producers reach the chat that started them, through the real authorities, adapters, turn path and SQLite. |
| `tests/gateway/test_local_reasoning_projection.py` | A local final does not receive the platform reasoning projection. |
| `tests/gateway/test_local_receipt_missing_profile.py` | Old local receipts omit the served profile in origin; the restore still works. |
| `tests/gateway/test_local_receipt_untracked_compression.py` | A session created under 0.22.1 and compressed under 0.22.2 opens again on the gateway, on its compressed tip. |
| `tests/gateway/test_local_recovery_pre_profile_origin.py` | A served profile's refused local receipt names its failing check in `gateway.log`. |
| `tests/gateway/test_local_refine_keeps_session_resources.py` | A cold `/refine` leaves the session's tool resources alone (it releases only its own clients). |
| `tests/gateway/test_local_refine_review_guard.py` | The cold `/refine` review belongs to the session, so a second one is refused and the next turn cancels it. |
| `tests/gateway/test_local_refine_skips_memory_provider.py` | A cold `/refine` never builds or starts an external memory provider. |
| `tests/gateway/test_local_reset_lineage_one_conversation.py` | A local reset lineage is ONE conversation in the listing, the gateway delete and the legacy store delete. |
| `tests/gateway/test_local_resume_compression_child.py` | `session.resume` by a compressed local conversation's *physical* id opens the logical owner. |
| `tests/gateway/test_local_review_summary_event.py` | A local viewer sees the background review's summary as a `review.summary` event. |
| `tests/gateway/test_local_route_orphan_reap_stamp.py` | A local route the authority owns keeps its conversation when its row is stamped ended. |
| `tests/gateway/test_local_session.py` | A fresh local session owns its execution across viewers. |
| `tests/gateway/test_local_session_info_fields.py` | `session.info` carries the classic CLI's status fields (title, times, yolo, api_mode, tool count, masked credential hint). |
| `tests/gateway/test_local_session_lineage.py` | A local conversation keeps one admission owner across physical transcript boundaries. |
| `tests/gateway/test_local_session_recovery.py` | Local creation is durable before publication and a restart never replays a claim. |
| `tests/gateway/test_local_session_voice_tts.py` | A local session's `/voice tts` is refused rather than synthesizing unplayable audio. |
| `tests/gateway/test_local_source_labels.py` | A canonical local session keeps its source label; human pickers hide non-conversation labels. |
| `tests/gateway/test_local_turn_origin_execute_code_gate.py` | Only a turn the session's viewer submitted skips the whole-script `execute_code` approval. |
| `tests/gateway/test_local_viewer_clarify_batch.py` | A classic-CLI viewer's clarify batch goes out as ONE request; the messaging path still asks one card per question. |
| `tests/gateway/test_local_viewer_events_submit.py` | The classic CLI's per-turn `prompt.submit` fields survive canonical admission and bind to that admission's execution. |
| `tests/gateway/test_local_viewer_events_turn.py` | Every callback main's CLI passed to its in-process agent must reach the viewer as an execution event (20 cases). |
| `tests/gateway/test_local_viewer_reasoning.py` | Reasoning a local viewer's turn sends: the live stream by default, the final reasoning on `message.complete`. |
| `tests/gateway/test_local_viewer_secret_prompt.py` | A local viewer's turn asks for a missing skill env var through the masked secret panel and saves the answer in the profile `.env`. |
| `tests/gateway/test_local_viewer_status_notice.py` | A local viewer sees the agent's status lines and notices. |
| `tests/gateway/test_local_viewer_sudo_prompt.py` | A local viewer's turn asks for the sudo password through the TUI's masked prompt. |
| `tests/gateway/test_local_viewer_usage.py` | `session.usage` / `session.stats` publish the session-cumulative counters the CLI read off its in-process agent. |
| `tests/gateway/test_local_yolo_cold_restore.py` | An explicit `/yolo` OFF on a local session survives a cold owner restore of its creation receipt. |
| `tests/gateway/test_login_command.py` | The `/login` flow: pairing code delivery, drain outcomes, a superseded attempt, and a local session's event stream. |
| `tests/gateway/test_loop_command.py` | The `/loop` command: dispatch, route capture, mid-run guard and the post-turn completion hook. |
| `tests/gateway/test_loop_exception_handler.py` | A loop-level transient-network safety net: `TimedOut`/`NetworkError` are logged and swallowed instead of killing the gateway. |
| `tests/gateway/test_loop_liveness_watchdog.py` | Event-loop freeze backstops: a thread watchdog that dumps stacks and exits, with a configurable delay. |
| `tests/gateway/test_lost_worker_receipt_compaction.py` | A managed worker closed by loss or a reset's orphan discard keeps no full-history read receipt. |
| `tests/gateway/test_managed_runtime_live_drain.py` | A real managed child persists its final receipt while the ordinary daemon drains. |
| `tests/gateway/test_managed_spawn_cancellation.py` | Cancelling a threaded `Popen` acquisition still reaps the child it eventually creates. |
| `tests/gateway/test_managed_turn_contract.py` | Managed turns carry a finite approval policy, accounting and live tool details; a current YOLO revocation overrides the frozen launch. |
| `tests/gateway/test_managed_turn_shutdown_drain.py` | Managed-worker turns are part of the bounded shutdown drain: counted, stopped on timeout, settled in bounded time. |
| `tests/gateway/test_managed_unstarted_cancel.py` | Cancellation before reservation closes any acquired child and settles the unexecuted claim. |
| `tests/gateway/test_managed_worker_background_output.py` | A background process a managed worker starts keeps its output past the worker's exit. |
| `tests/gateway/test_managed_worker_bypass.py` | Bypass sessions execute in the admission-owned worker, which binds the safe policy first. |
| `tests/gateway/test_managed_worker_checkpoint_limits.py` | A managed worker builds its agent with the session's frozen checkpoint limits, not only the enable flag. |
| `tests/gateway/test_managed_worker_clarify_timeout.py` | A managed worker's clarify wait honours the profile's clarify timeout (≤0 = unlimited). |
| `tests/gateway/test_managed_worker_client_env.py` | CLI sessions attached through the gateway's ticket run their tools in managed workers under their client's toolchain, and the client env never appears in a public projection. |
| `tests/gateway/test_managed_worker_construct.py` | Managed execution gets the same owner-resolved construction inputs as the in-process turn: the fallback chain, the instruction and the prefill examples. |
| `tests/gateway/test_managed_worker_delegation.py` | `delegate_task` inside a managed worker: the child is reserved by the owner, returns its result, and dies with the owner. |
| `tests/gateway/test_managed_worker_detached_work.py` | A managed worker must never hand out detached work — it exits at its turn boundary, so the work runs inline. |
| `tests/gateway/test_managed_worker_drain.py` | Already-reserved compute remains able to persist while new work is refused. |
| `tests/gateway/test_managed_worker_env_boundary.py` | A worker for another profile never inherits the launch profile's credentials, and a ledger id never names a path outside the worker outboxes. |
| `tests/gateway/test_managed_worker_fencing.py` | Loss is not success: a delayed parent result cannot revive an admission, and a late bootstrap handshake cannot rearm a recovered one. |
| `tests/gateway/test_managed_worker_finished_exit.py` | A managed turn whose worker acknowledged its durable finish keeps its answer even when the worker exits slowly or non-zero. |
| `tests/gateway/test_managed_worker_frozen_config.py` | An ordinary managed worker serves its session's frozen config, never the live profile file. |
| `tests/gateway/test_managed_worker_group_close.py` | Owner-initiated teardown reaps the worker's process *group*, so its tool children are not orphaned. |
| `tests/gateway/test_managed_worker_hard_stop_frame_fence.py` | Managed-worker Stop parity: a Stop hard-cancels the agent, and the owner's frame loop fences on the executing generation. |
| `tests/gateway/test_managed_worker_hooks.py` | Ordinary managed runs register the session's shell hooks and outbound webhooks in the worker; bypass sessions register none. |
| `tests/gateway/test_managed_worker_images.py` | A managed assignment preserves the image bytes committed at admission. |
| `tests/gateway/test_managed_worker_kill_escalation.py` | `close()` always finishes its teardown even when the post-kill wait times out. |
| `tests/gateway/test_managed_worker_late_stop.py` | A Stop requested long after `hello` still receives its full acknowledgement window; repeated Stops share one deadline. |
| `tests/gateway/test_managed_worker_launch.py` | The ordinary daemon, not a fixture launcher, owns the real tool worker. |
| `tests/gateway/test_managed_worker_lineage.py` | Real owner parity: stable admission ids, physical history and terminal publication. |
| `tests/gateway/test_managed_worker_parent_death.py` | A managed worker dies with its owner, descendants included, even when its turn ignores the interrupt. |
| `tests/gateway/test_managed_worker_profile_env.py` | A served secondary profile's managed worker never inherits launch-profile residue. |
| `tests/gateway/test_managed_worker_reader_thread.py` | Managed-worker pipe reads never occupy the loop's shared default executor, and a cancelled read loses no frame. |
| `tests/gateway/test_managed_worker_reservation_off_loop.py` | The managed worker's reservation and loss writes run off the owner loop. |
| `tests/gateway/test_managed_worker_result_usage.py` | A managed turn's receipt keeps its spend: the result frame carries the bounded accounting fields of `run_conversation`. |
| `tests/gateway/test_managed_worker_retire.py` | A managed worker's turn-final memory work drains before the provider shuts down. |
| `tests/gateway/test_managed_worker_route_key.py` | A managed worker without a launch key resolves its route's credential the way the in-process runner does, from its own profile home. |
| `tests/gateway/test_managed_worker_routing_kwargs.py` | A managed worker builds its agent with the session's provider routing and service tier. |
| `tests/gateway/test_managed_worker_rpc_close.py` | A managed worker closes its owner connection when `execute` ends, and a failing close never replaces the turn's outcome. |
| `tests/gateway/test_managed_worker_stderr_log.py` | Managed-worker stderr lands in the owning profile's private, redacted, size-capped log. |
| `tests/gateway/test_managed_worker_stop_before_hello.py` | Stop is never acknowledged into a queue nobody drains: a child that never says hello is terminated and the admission settles interrupted. |
| `tests/gateway/test_managed_worker_stop_deadline.py` | Stop bounds managed-worker supervision by ONE deadline from the first Stop, even if the child keeps emitting valid frames. |
| `tests/gateway/test_managed_worker_tool_events.py` | A managed worker's tool events reach every viewer in the shape an in-process turn publishes. |
| `tests/gateway/test_managed_worker_trampoline.py` | Worker identity is verified by the *owner* through launcher chains (the uv venv `python.exe` is a trampoline), never asserted by the worker. |
| `tests/gateway/test_managed_worker_turn_author.py` | A managed worker's turn carries its author so memory providers attribute it like the owner path. |
| `tests/gateway/test_managed_worker_turn_flags.py` | A managed worker applies the same per-turn approval facts as the in-process turn, including a YOLO revocation. |
| `tests/gateway/test_managed_worker_unknown_status.py` | A lost managed worker's `message.complete` carries the contract's error `TurnStatus` next to outcome `unknown`. |
| `tests/gateway/test_matrix.py` | The Matrix adapter (101 cases): E2EE setup, markdown conversion, tables, voice (MSC3245), mentions, threads, and dependency probes. |
| `tests/gateway/test_matrix_approval_reaction_fail_closed.py` | With no `MATRIX_ALLOWED_USERS`, approval reactions are denied by default. |
| `tests/gateway/test_matrix_crypto_store_per_profile.py` | The Matrix crypto store is pinned per profile at `connect()`, not at import (one shared `crypto.db` broke inbound E2EE). |
| `tests/gateway/test_matrix_deps_rebind.py` | A fresh Matrix dependency rebind must not `NameError` on unimported type globals. |
| `tests/gateway/test_matrix_dm_invite_recording.py` | A Matrix DM room is recorded in `m.direct` when the invite carries `is_direct: true`. |
| `tests/gateway/test_matrix_encrypted_drop_warning.py` | Matrix fails loud (once per room) when encrypted events arrive with no E2EE decryptor. |
| `tests/gateway/test_matrix_exec_approval.py` | A Matrix reaction resolves a pending approval. |
| `tests/gateway/test_matrix_handoff_thread.py` | Matrix has no create-thread API: the adapter seeds a root message and returns its event id as the thread handle. |
| `tests/gateway/test_matrix_latex_maths.py` | Outbound `$...$` / `$$...$$` become Element `data-mx-maths` markup. |
| `tests/gateway/test_matrix_media_filename.py` | Media filenames are stripped from the event body so the filename never reaches the model as user text. |
| `tests/gateway/test_matrix_media_gate_before_download.py` | Matrix gates (require-mention / allowed rooms) *before* downloading inbound media: a dropped media event performs zero downloads. |
| `tests/gateway/test_matrix_mention.py` | Matrix require-mention gating and auto-thread features. |
| `tests/gateway/test_matrix_message_event_metadata.py` | Matrix `MessageEvent` carries sender and reply context like every other adapter. |
| `tests/gateway/test_matrix_message_length.py` | Matrix outbound message length is configurable via `extra` and env. |
| `tests/gateway/test_matrix_pending_invite_auth.py` | The inviter allowlist gates the pending-invite reconciliation pass (an unconditional join re-admitted rejected invites). |
| `tests/gateway/test_matrix_plugin_setup.py` | The Matrix interactive-setup wizard clears the home room on blank. |
| `tests/gateway/test_matrix_project_context_isolation.py` | Matrix project A / project B context isolation — one room scope per project, no bleed. |
| `tests/gateway/test_matrix_recovery_key_scope.py` | `MATRIX_RECOVERY_KEY` honours the active profile's secret scope (cross-signing failed otherwise). |
| `tests/gateway/test_matrix_send_voice_dispatch.py` | `send_voice(..., is_voice=...)` is accepted by every adapter (Matrix raised `TypeError` and dropped the attachment). |
| `tests/gateway/test_matrix_voice.py` | Matrix voice messages (MSC3245): local path, cache fallback and opus transcode. |
| `tests/gateway/test_mattermost.py` | The Mattermost adapter: progress events, thread roots, markdown, image upload, ignore/system filtering and WS gating. |
| `tests/gateway/test_mattermost_native_admission.py` | A Mattermost post with an attachment is admitted, runs a turn and keeps its media. |
| `tests/gateway/test_mattermost_plugin_setup.py` | The Mattermost interactive-setup wizard clears the home channel on blank. |
| `tests/gateway/test_max_concurrent_sessions.py` | The `max_concurrent_sessions` cap gives a clean error; `/status` bypasses it. |
| `tests/gateway/test_mcp_reload_held_revision.py` | A `reload.mcp` naming the revision the session already holds answers the success shape, not a refusal. |
| `tests/gateway/test_mcp_reload_new_server.py` | An MCP server added after a local session started reaches it only through a gateway-committed policy generation. |
| `tests/gateway/test_mcp_reload_refreshes_cached_agents.py` | `/reload-mcp` refreshes cached agents' tool lists (users had to `/new` to pick up new tools). |
| `tests/gateway/test_mcp_shutdown_profile_passes.py` | MCP teardown divides the caller's budget across per-profile passes, and the wildcard pass is never poisoned. |
| `tests/gateway/test_media_cache.py` | The shared mime↔ext dispatch, with per-adapter parity spot-checks that hardcode each adapter's historical mappings as the contract. |
| `tests/gateway/test_media_cache_cleanup_signature.py` | Every cache cleanup the housekeeping loop iterates accepts the loop's call shape. |
| `tests/gateway/test_media_download_retry.py` | Media download retry, HTML-content rejection, DNS-rebind and private-redirect SSRF guards. |
| `tests/gateway/test_media_extraction.py` | MEDIA tags are extracted only from the **current** turn, so voice messages are not re-sent every reply. |
| `tests/gateway/test_media_metadata_contract.py` | Media-send overrides must accept the `metadata` kwarg (this is how WhatsApp/e-mail image delivery broke). |
| `tests/gateway/test_media_only_outcome.py` | A media-only turn reports success (it delivered an attachment and no text). |
| `tests/gateway/test_media_resend_dedup.py` | An explicit media resend is delivered despite the session-wide history dedup, and the bare-path lookup fails open. |
| `tests/gateway/test_media_spaced_paths_and_history_dedupe.py` | Spaced paths, GIS extensions and cross-turn dedupe plumbing; code-block-safe streaming display strip. |
| `tests/gateway/test_media_tag_cleanup.py` | The `MEDIA_TAG_CLEANUP_RE` boundary rules (full-width suffixes, adjacent tags, Chinese delivery lines). |
| `tests/gateway/test_media_tag_formatting_variants.py` | Sentence-final punctuation, multi-part extensions and inline-code-wrapped MEDIA tags all deliver. |
| `tests/gateway/test_media_tag_separator.py` | Two back-to-back MEDIA tags must not merge into one invalid path. |
| `tests/gateway/test_media_terminal_sentinel.py` | A leaked terminal `<|eos|>` sentinel must not hide a MEDIA attachment. |
| `tests/gateway/test_memory_flush_on_reset.py` | `/reset` drains the memory manager's background write worker before shutting the provider down. |
| `tests/gateway/test_memory_monitor.py` | Periodic process-memory logging (a structured `[MEMORY] rss=…` line) so leaks show as a time series. |
| `tests/gateway/test_memory_status.py` | The `/api/status` memory rollup: absolute floor, fraction, elevated band, stale/future heartbeats, and `unknown` for corrupt files. |
| `tests/gateway/test_memory_trim_housekeeping.py` | The long-lived gateway housekeeper performs the periodic memory trim. |
| `tests/gateway/test_message_deduplicator.py` | The TTL is checked at *query* time, not only on eviction (messages were "duplicate" forever otherwise). |
| `tests/gateway/test_message_timestamps.py` | Timestamp rendering: naive/aware ISO, DST gaps and folds, unrenderable epochs, and the compaction-summary exemption. |
| `tests/gateway/test_messaging_discard_reach.py` | Messaging `/discard` reaches every lost turn it promises to, even into a cold conversation after a restart. |
| `tests/gateway/test_messaging_new_drops_claimed_turn.py` | A `/new` between the drain's claim and the turn's session lookup drops the claimed turn. |
| `tests/gateway/test_messaging_session_moved_on.py` | Messaging-session reads after the conversation moved on: the control card follows the conversation through compression. |
| `tests/gateway/test_messaging_session_picks.py` | A model or reasoning pick on a messaging chat is the chat's own next-turn override, fenced by its receipt and revision. |
| `tests/gateway/test_messaging_slash_command_fifo.py` | A slash command that becomes a turn joins the chat's durable FIFO like text. |
| `tests/gateway/test_messaging_stop_new_cancel_queued.py` | Messaging `/stop` and `/new` drop the durable queued follow-up. |
| `tests/gateway/test_messaging_stop_owner_turn.py` | `/stop` and `/new` reach the authority's claimed turn and its queued follow-up, even before the agent exists. |
| `tests/gateway/test_mirror.py` | Session mirroring: the most recent matching session, thread disambiguation, and the active-profile home fallback. |
| `tests/gateway/test_mixed_attachment_routing.py` | Each attachment is classified by its **own** mimetype, not the message-level type. |
| `tests/gateway/test_moa_one_shot_restore.py` | A one-shot model override is restored on every exit, including when the turn raises (the restore lived in the `try`). |
| `tests/gateway/test_model_alias_credential.py` | `/model <alias>` keeps the alias endpoint's own credential on the next turn. |
| `tests/gateway/test_model_alias_credential_restart.py` | A literal alias key commits a reference, so a restarted owner re-derives it from *its own* profile. |
| `tests/gateway/test_model_alias_scalar_model.py` | A scalar `model: <name>` config is valid and must not crash the alias credential reader. |
| `tests/gateway/test_model_command_async_offload.py` | The `/model` picker listing is a read path: cache-only catalogs and a probe of only the selected endpoint, off the loop. |
| `tests/gateway/test_model_command_context_offload.py` | `/model` context-length resolution must not block the gateway event loop. |
| `tests/gateway/test_model_command_custom_providers.py` | `/model` supports `config.yaml custom_providers` and switches off the loop. |
| `tests/gateway/test_model_command_expensive_confirm.py` | A typed `/model <expensive>` routes through the same confirmation gate as the pickers. |
| `tests/gateway/test_model_command_flat_string_config.py` | `/model X --global` persists even when `config.yaml` has a flat-string `model:` value. |
| `tests/gateway/test_model_command_profile_config.py` | The `/model` picker reads the routed profile's config. |
| `tests/gateway/test_model_command_reasoning_flag.py` | `/model <m> --reasoning <level>` rides the pick through the same applier `/reasoning` uses. |
| `tests/gateway/test_model_command_request_overrides.py` | `/model` preserves a named custom provider's `request_overrides`. |
| `tests/gateway/test_model_confirmation_clients.py` | Every native surface collects the owner's guarded-model confirmation (the CLI chat view and the ACP adapter). |
| `tests/gateway/test_model_picker_persist.py` | The inline-keyboard model picker persists like the typed command (a tap used to revert on the next launch). |
| `tests/gateway/test_model_switch_persistence.py` | A session model override is applied on the next turn, is not mistaken for fallback activation, and survives until `/reset`. |
| `tests/gateway/test_moved_platforms_yaml_allowlist.py` | `config.yaml platforms.<name>.allowed_users` gates DMs on the platforms moved from core into plugins. |
| `tests/gateway/test_msgraph_authority.py` | The Graph boundary uses the canonical internal queue, not a background ACK. |
| `tests/gateway/test_msgraph_webhook.py` | The Microsoft Graph webhook adapter: validation-token echo, `clientState`, loopback binding and source allowlists. |
| `tests/gateway/test_multiplex_adapter_registry.py` | Secondary-profile adapter registry: same-token conflict detection, secret hydration off the loop, per-profile namespaces and retry ladders. |
| `tests/gateway/test_multiplex_adapter_session_key_namespace.py` | Adapter-level session keys must carry the profile (two Telegram bots on one gateway collided on `chat.id`). |
| `tests/gateway/test_multiplex_api_server_routing.py` | `/p/<profile>/` routing for the `api_server` adapter: the default listener owns the port. |
| `tests/gateway/test_multiplex_background_task_scope.py` | Background tasks respect the profile secret scope (a fire-and-forget task had an empty scope). |
| `tests/gateway/test_multiplex_busy_input_mode.py` | Profile-specific busy-input behaviour for multiplexed gateways (16 cases). |
| `tests/gateway/test_multiplex_cold_profile_sidebar_mutation.py` | Cold-profile sidebar mutations reach the served profile's own authority under multiplex. |
| `tests/gateway/test_multiplex_credential_isolation.py` | End-to-end credential isolation proof: two profiles never see each other's keys, and an unscoped read fails closed. |
| `tests/gateway/test_multiplex_docker_media_delivery_scope.py` | A multiplexed secondary's Docker `MEDIA:` paths are validated under **that** profile's home and terminal policy. |
| `tests/gateway/test_multiplex_endpoint_identity_scope.py` | An adapter's endpoint/identity resolves through the same profile scope as its secret. |
| `tests/gateway/test_multiplex_hot_serve.py` | Hot-serve: a profile created after boot is served, a deleted one is torn down, and a changed config gets its adapters. |
| `tests/gateway/test_multiplex_hot_serve_live.py` | Live hot-serve contract of a real multiplexer: a profile created under it is served and owned. |
| `tests/gateway/test_multiplex_http_routing.py` | HTTP-inbound `/p/<profile>/` routing for the webhook adapter. |
| `tests/gateway/test_multiplex_interactive_auth.py` | Multiplex interactive auth: the routed primary uses its own pairing store; a secondary uses its own allowlist. |
| `tests/gateway/test_multiplex_lifecycle.py` | Multiplex lifecycle guard and per-profile observability. |
| `tests/gateway/test_multiplex_log_routing.py` | Each profile's records land in its own `logs/` instead of fanning out into the default profile's. |
| `tests/gateway/test_multiplex_mcp_discovery.py` | MCP servers are discovered and reloaded **per profile**, and a shared server's tools are removed for a non-owner. |
| `tests/gateway/test_multiplex_notice_egress_profile_adapter.py` | Out-of-band gateway egress for a secondary session leaves through **that** profile's bot. |
| `tests/gateway/test_multiplex_pairing_stores.py` | Per-profile `PairingStore` creation for secondary profiles (a `NameError` silently disabled pairing). |

| `tests/gateway/test_multiplex_phase0.py` | Phase 0 foundations: the `gateway.multiplex_profiles` flag, `profiles_to_serve`, and a profile-stamped `build_session_key` that is byte-identical when the flag is off. |
| `tests/gateway/test_multiplex_primary_token_scope.py` | The multiplex primary must not fail forever without bot tokens: an empty token is skipped, not queued for infinite reconnect. |
| `tests/gateway/test_multiplex_process_global_sinks.py` | The remaining process-global sinks (auto-sethome env write, `terminal.env_passthrough`, Slack ignored-channels) become per-profile. |
| `tests/gateway/test_multiplex_process_memo_scope.py` | Per-turn config, credentials and hooks follow the **routed** profile, not the launch home the module constants were frozen from. |
| `tests/gateway/test_multiplex_profile_authz.py` | Multiplex profile-aware own-policy authorization: adapter intake and central authz agree on the same list. |
| `tests/gateway/test_multiplex_requires_default_profile.py` | Only the default profile runs the multiplexer; a named launch would split the default's sessions. |
| `tests/gateway/test_multiplex_residue_parity.py` | A served profile reads its own `sessions.*` / proxy env; a stale served route never re-scaffolds an archived profile. |
| `tests/gateway/test_multiplex_routing_authz.py` | Routing/authorization invariants: a shared bot route does not hijack a dedicated secondary bot, and mid-turn authz reads the admitting transport's allowlist. |
| `tests/gateway/test_multiplex_secondary_port_binding_env.py` | A secondary's `API_SERVER_KEY` wires the key without claiming the listener. |
| `tests/gateway/test_multiplex_served_profile_parity.py` | Standalone-vs-served parity for goals/loops, completion notices and process recovery. |
| `tests/gateway/test_multiplex_session_db_profile_scope.py` | The `SessionDB` handle follows the active profile scope (a named profile's sessions were written to the root `state.db`). |
| `tests/gateway/test_multiplex_shared_ingress.py` | A secondary's inbound-port platform is served on the default profile's shared listener at `/p/<profile>/<path>`, verified by that profile's adapter. |
| `tests/gateway/test_multiplex_toolsets_profile_isolation.py` | `/p/<x>/v1/toolsets` reflects profile *x*'s own toolsets; a foreign prefix is a 404. |
| `tests/gateway/test_multiplex_transport_matrix.py` | The intake/delivery transport matrix: live rows reply through the receiving bot, restored rows fail closed on intake. |
| `tests/gateway/test_multiplex_unserved_shared_ingress.py` | A secondary enabling shared-ingress Relay must not be silently unserved: one INFO per platform and a loud WARNING when nothing runs it. |
| `tests/gateway/test_multiplex_yaml_env_bridge_isolation.py` | A secondary's `config.yaml` must never be bridged into the process env (first-writer-wins made the first secondary the default). |
| `tests/gateway/test_mutation_prepare_off_loop.py` | The model/compress prepare transaction runs off the owner loop like its commit. |
| `tests/gateway/test_native_admission_arrival_order.py` | A chat's inputs reach its FIFO in arrival order even when off-loop media capture is needed. |
| `tests/gateway/test_native_admission_edit.py` | An edited message is its own admission, not a changed replay of the original send. |
| `tests/gateway/test_native_admission_metadata.py` | Native admission keeps main's inbound contract: real adapter events run a turn. |
| `tests/gateway/test_native_admission_named_refusal.py` | A native admission refusal names the failing clause in the error and the log, and in the chat reply only for content clauses. |
| `tests/gateway/test_native_admission_path_text.py` | A message whose first token is a filesystem path is text, even when the adapter typed it COMMAND. |
| `tests/gateway/test_native_config_owner_scope.py` | A native ticket binds its own home even when a foreign home override is ambient. |
| `tests/gateway/test_native_epoch_timestamp.py` | A producer that pins epoch 0 for a stable retry fingerprint still records local time. |
| `tests/gateway/test_native_execution_secret_scope_off_loop.py` | Admitted native turns hydrate profile secret sources off the owner loop. |
| `tests/gateway/test_native_fifo_compression_identity.py` | Native FIFO identity survives a compression that moves the physical route to a child. |
| `tests/gateway/test_native_fifo_context_exhaustion.py` | Native messages queued behind a context-exhausting turn run once, in order, on the fresh session the auto-reset creates. |
| `tests/gateway/test_native_http_auth.py` | Private native grants authenticate HTTP, never another purpose or profile, and are single-use. |
| `tests/gateway/test_native_http_per_profile_edits.py` | Old local rows take the Desktop's sidebar edits over each profile's own native grant. |
| `tests/gateway/test_native_http_secondary_profile_binding.py` | A secondary-profile native ticket binds every implicit profile selector to its own home. |
| `tests/gateway/test_native_image_buffer_isolation.py` | The native image buffer is isolated per session and not cleared by another session. |
| `tests/gateway/test_native_ingress_media.py` | Native attachments are committed bytes, not mutable adapter paths. |
| `tests/gateway/test_native_ingress_trust.py` | Trust is minted at native callbacks, never by serialized source flags. |
| `tests/gateway/test_native_media_acl_provenance.py` | Native media capture keeps the Hermes-home provenance of its store; a symlink below the home never grants an elevated path. |
| `tests/gateway/test_native_media_alias_safety.py` | Shared publication and physical alias custody without executing a turn. |
| `tests/gateway/test_native_media_budget.py` | Public attachments are bounded per admission and their retained bytes are released. |
| `tests/gateway/test_native_media_capture_lease.py` | Retained media is held from capture until its admission commits or is refused. |
| `tests/gateway/test_native_media_capture_off_loop.py` | Native media capture (copy + SHA-256 + fsyncs) runs off the owner loop, under the admission lease. |
| `tests/gateway/test_native_media_history_retention.py` | A settled native input stays on disk while the transcript still tells a follow-up turn where it is saved, bounded by a 24 h media age. |
| `tests/gateway/test_native_media_ownership.py` | Retained native bytes always have an owner: no orphan from a rejected batch. |
| `tests/gateway/test_native_media_redelivery.py` | A provider redelivery of a committed media message is the same admission, whatever staging name its re-download got. |
| `tests/gateway/test_native_operator_provenance.py` | Security fences for durable operator provenance on native-session recovery. |
| `tests/gateway/test_native_pause_notice.py` | A messaging user whose session FIFO is paused is told once, and can `/reset` out of it. |
| `tests/gateway/test_native_plugin_ws_auth.py` | Desktop plugin WebSockets ride the private native-HTTP grant, single-use, under the same peer/Origin rules. |
| `tests/gateway/test_native_producer_owner_matrix.py` | Native media producers keep routed owner decisions across alternating homes. |
| `tests/gateway/test_native_profile_create.py` | A dedicated same-user grant creates profiles without widening profile HTTP grants. |
| `tests/gateway/test_native_profile_registry_grant.py` | Desktop rename/delete of a served profile rides a dedicated `native-profile-registry` grant. |
| `tests/gateway/test_native_recovery_viewer_queue.py` | Native restart recovery accepts viewer work actually admitted by the authority. |
| `tests/gateway/test_native_reply_crash_recovery.py` | A settled native reply survives an owner death before it reached the delivery ledger; an uncommitted one is never delivered. |
| `tests/gateway/test_native_reply_delivered_once.py` | A native reply reaches the chat exactly once even when the drain claims and runs it before `admit_message` registers its waiter. |
| `tests/gateway/test_native_role_reauthorization.py` | Current connector membership, not role flags, authorizes durable work. |
| `tests/gateway/test_native_startup_recovery.py` | Ordinary startup recovers native admissions without a recovery fixture call, and only after the adapter publication. |
| `tests/gateway/test_native_stream_warning_composition.py` | An actual warning callback and media producer beside an armed native Slack stream do not seal the requested final. |
| `tests/gateway/test_native_telegram_startup_recovery.py` | Actual Telegram polling ingress, SIGKILL and uninstrumented owner recovery. |
| `tests/gateway/test_native_warning_coverage.py` | Native diagnostic producers keep captions, controls and truthful receipts — a rejected media upload never becomes a fake success. |
| `tests/gateway/test_new_moves_automation_wake.py` | Messaging `/new` keeps a queued automation wake and runs it on the fresh session. |
| `tests/gateway/test_normal_runtime_boot.py` | The ordinary no-platform process must earn its bootstrap readiness, and an API bind failure unwinds the control DB and reservation. |
| `tests/gateway/test_normalize_empty_agent_response.py` | Persistence-failure-aware messaging: a storage failure never tells the user to `/reset`, and `error: None` never renders "None". |
| `tests/gateway/test_notice_delivery.py` | A platform notice uses private delivery when configured. |
| `tests/gateway/test_notice_rendering.py` | `render_notice_line` turns an `AgentNotice` into the single plaintext line pushed over a messaging platform. |
| `tests/gateway/test_notify_fatal_error_shield.py` | The fatal-error handler survives cancellation of the task that awaits it. |
| `tests/gateway/test_ntfy_plugin.py` | The ntfy platform plugin: topic/token reads, publish vs subscribe, dedupe, and per-profile secret scope. |
| `tests/gateway/test_offloop_write_retirement_join.py` | An authority write moved off the owner loop is still the authority's work: retirement joins it before answering True. |
| `tests/gateway/test_ogg_opus_transcode_routing.py` | An in-place `transcode_to_ogg_opus` repair never destroys the source on failure. |
| `tests/gateway/test_one_turn_route_publish.py` | A one-turn model override must not become the route other clients read; a same-provider override keeps the session endpoint and key. |
| `tests/gateway/test_operator_cross_surface.py` | Real native bootstrap and dashboard login share one canonical worker, not identities. |
| `tests/gateway/test_orphan_exit_grace.py` | A retiring gateway must get long enough to finish its WAL checkpoint (a 5-second SIGTERM→SIGKILL window corrupted a 500 MB WAL store). |
| `tests/gateway/test_output_caps_removed.py` | User configuration cannot impose generation caps; wire budgets remain internal. |
| `tests/gateway/test_own_policy_startup_gate.py` | An unrelated `allow_all` does not bypass the Yuanbao open-policy startup gate. |
| `tests/gateway/test_owner_backfill_live_owner.py` | Desktop's per-boot owner backfill no longer 409s against the live owner. |
| `tests/gateway/test_owner_liveness_drift.py` | Owner-liveness checks tolerate a ~1 s same-host start-time drift (a recycled pid is still not an owner). |
| `tests/gateway/test_owner_loop_writes_a2a_hosted_create.py` | A2A forward and hosted-room member creation commit their session off the owner loop. |
| `tests/gateway/test_owner_loop_writes_bot_chat_create.py` | The Bot Chat a first delivery mints commits off the owner loop. |
| `tests/gateway/test_owner_loop_writes_class.py` | The bug class: a synchronous SQLite write reached from an `async def` on the owner loop. |
| `tests/gateway/test_owner_loop_writes_create_api.py` | `session.create`'s creation commit and an API turn's settings write run off the owner loop. |
| `tests/gateway/test_owner_loop_writes_cron_create.py` | Cron fire creation commits its session off the owner loop. |
| `tests/gateway/test_pairing.py` | The DM pairing security system: salted hashes, per-platform pending caps, rate limits, lockout, expiry, and per-profile stores. |
| `tests/gateway/test_pairing_allowlist_bypass.py` | A pairing-store entry is a first-class authorization grant; approving mirrors into the configured allowlist and revoking removes it. |
| `tests/gateway/test_pairing_reply_off_loop.py` | Unauthorized-DM pairing replies must not block the event loop on the pairing lock. |
| `tests/gateway/test_parked_profile_ingress.py` | Ingress for a parked secondary is never acknowledged and then dropped: a relay frame is refused to its sender, a webhook gets a retryable 503. |
| `tests/gateway/test_parked_profile_platform_refusal.py` | A message a direct platform bot routes to a parked profile is refused out loud, never dropped. |
| `tests/gateway/test_parked_profile_rescan.py` | A secondary parked at boot and served again by the control-socket rescan is fully served, and its queued work is recovered. |
| `tests/gateway/test_parked_profile_served_set.py` | A profile whose retirement misses its deadline leaves the published served set and the ticket store at once. |
| `tests/gateway/test_parked_profile_unserved_ingress.py` | Every ingress path for a parked profile is a retryable 503, so a client retry is processed exactly once. |
| `tests/gateway/test_parked_route_refusal_discord.py` | A parked-profile refusal on Discord reads as an outage notice, so backfill still picks the message up. |
| `tests/gateway/test_parked_route_refusal_google_chat.py` | A Google Chat HTTP event for a parked profile is answered retryably; Pub/Sub is refused in chat. |
| `tests/gateway/test_parked_route_refusal_relay.py` | A parked-profile notice sent through relay never seals another turn's open Slack stream. |
| `tests/gateway/test_parked_route_refusal_send.py` | A parked-profile refusal whose send fails is logged with safe fields only — never the message text or the raw platform error. |
| `tests/gateway/test_peer_client_unknown_run.py` | A hosted-room peer whose member gateway restarted mid-turn reports the run `unknown` and settles it interrupted. |
| `tests/gateway/test_peer_dm_bot_chat_authority.py` | A peer turn into the canonical Bot Chat is that chat's own admission, never a second writer. |
| `tests/gateway/test_peer_dm_bot_chat_context_overflow.py` | A peer DM that overflows the Bot Chat's context auto-resets it and the follow-up is answered. |
| `tests/gateway/test_peer_dm_bot_chat_headless.py` | A headless gateway's first peer DM lands in a Bot Chat its own authority FIFO owns (18 cases). |
| `tests/gateway/test_peer_dm_hidden_e2e.py` | E2E: `hermes peer dm` against a real API server whose canonical Bot Chat is hidden. |
| `tests/gateway/test_peer_dm_into_open_bot_chat.py` | A peer DM into a Bot Chat is answered by that chat, never by a second writer. |
| `tests/gateway/test_peer_dm_transient_retry.py` | The peer-DM transport retries a transiently failed turn once, resuming the row the failed attempt persisted. |
| `tests/gateway/test_pending_drain_no_recursion.py` | Chained pending-message drains must not grow the call stack. |
| `tests/gateway/test_pending_drain_race.py` | Pending-drain + finally-cleanup races must not spawn duplicate agents or silently drop late arrivals. |
| `tests/gateway/test_pending_queue_spool.py` | A transcript message evicted by the per-session pending cap is *spooled* to disk and replayed, not silently discarded. |
| `tests/gateway/test_pending_steer_drain.py` | Late steering retains FIFO messages and channel inputs. |
| `tests/gateway/test_personality_routed_profile.py` | A routed multiplex profile's personality must reach its turns (the prompt was snapshotted at boot). |
| `tests/gateway/test_pii_redaction.py` | PII redaction in session-context prompts: deterministic hashing, per-platform opt-in, and home-channel ids preserved. |
| `tests/gateway/test_plaintext_approval_routing.py` | A plain-text "yes"/"deny" must resolve a blocking dangerous-command approval instead of being steered. |
| `tests/gateway/test_planned_restart_notice_multiplex.py` | A planned restart notifies **every** served profile's home channels, and the marker survives until each was reached. |
| `tests/gateway/test_planned_stop_accepted_debt.py` | The planned-stop consumer and the accepted-stop evidence a Windows update pause relies on. |
| `tests/gateway/test_planned_stop_watcher.py` | The planned-stop marker watcher (the Windows fallback when `asyncio.add_signal_handler` is unavailable). |
| `tests/gateway/test_platform_adapter_i18n.py` | Telegram and Discord read their chat copy from the i18n catalog **at call time**, with per-platform length caps and language-dependent command fingerprints. |
| `tests/gateway/test_platform_authz_scope.py` | Platform authorization reads honour the per-profile secret scope (raw `os.getenv` silently missed a secondary's allowlists). |
| `tests/gateway/test_platform_base.py` | `gateway/platforms/base.py`: `MessageEvent`, media extraction, slash-command parsing, image-ref handling and truncation (103 cases). |
| `tests/gateway/test_platform_bundled_authz_fallback.py` | Bundled platforms' authorization env names survive a registry entry that lacks them. |
| `tests/gateway/test_platform_connected_checkers.py` | Every gateway platform has a connection checker, so `get_connected_platforms()` cannot silently drop one. |
| `tests/gateway/test_platform_entry_authz_fields.py` | Bot-bypass and own-policy startup gates read the plugin's `PlatformEntry`, not a core table. |
| `tests/gateway/test_platform_entry_plugin_seams.py` | `PlatformEntry` seams a plugin uses instead of a core special case (`trusted_inbound`, `display_tier`). |
| `tests/gateway/test_platform_env_overrides.py` | The env→`GatewayConfig` bridge every static plugin platform declares, with secrets kept out of the terminal blocklist. |
| `tests/gateway/test_platform_http_client_limits.py` | The shared `httpx.Limits` helper for long-lived platform adapters, with an SSRF guard. |
| `tests/gateway/test_platform_plugin_canonical_class.py` | A plugin that imports siblings by absolute path must register by that same path (two adapter classes were live). |
| `tests/gateway/test_platform_plugin_handlers.py` | Plugin-registered native platform handler factories: validation, queuing, wiring and defensive error isolation. |
| `tests/gateway/test_platform_reconnect.py` | The platform reconnection watcher: connect-timeout handling, retryable vs non-retryable errors, replayed inbound suppression, and a bounded slow tier. |
| `tests/gateway/test_platform_reconnect_fd_leak.py` | An adapter that fails to connect must be disposed, or every retry leaks its SQLite response store (12 fds/hour). |
| `tests/gateway/test_platform_registry.py` | The platform adapter registry and the dynamic `Platform` enum: deferred materialization, installers, and the shared-key bridge. |
| `tests/gateway/test_platform_shared_metrics.py` | Shared platform health / delivery / first-reply metrics through the real runner seams. |
| `tests/gateway/test_plugin_check_housekeeping.py` | Plugin checks are due-gated from startup, not delayed for an hour. |
| `tests/gateway/test_plugin_gateway_session_parity.py` | Plugin code running inside the gateway sees the session it runs for, and approval hooks report that session's surface. |
| `tests/gateway/test_plugin_keyless_inject.py` | A key-less `ctx.inject_message` lands in the session the plugin is working for, with a refusal and a bounded warning. |
| `tests/gateway/test_plugin_message_injection.py` | Plugin-triggered turns in existing gateway sessions: stored origin, re-checked authorization, drain-safe dispatch. |
| `tests/gateway/test_plugin_origin_injection.py` | `ctx.inject_message(origin=...)` starts a session in the plugin's **own** profile and cannot reach another. |
| `tests/gateway/test_plugin_origin_injection_authority.py` | `inject_message(origin=...)` under the session authority answers `False` up front for a chat the FIFO cannot admit into. |
| `tests/gateway/test_plugin_post_message.py` | `PluginContext.post_message`: one message in the calling session's chat, edited in place. |
| `tests/gateway/test_pm_activation.py` | Gateway startup remains fail-open when PM admission itself fails. |
| `tests/gateway/test_policy_secret_projections.py` | Terminal and config secret projections recover without a durable write. |
| `tests/gateway/test_poller_fd_lifecycle.py` | Poller socket lifecycle: `IMAP4.abort` falls back to `shutdown`, and the poll loop recycles a broken session. |
| `tests/gateway/test_post_delivery_callback_chaining.py` | `register_post_delivery_callback` chains callbacks instead of clobbering, and per-callback exceptions are swallowed. |
| `tests/gateway/test_post_gateway_admission.py` | `post_gateway_admission`: a fail-open plugin hook that may consume an admitted message. |
| `tests/gateway/test_post_stream_media_delivery.py` | Post-stream media delivery is explicit-only — a bare local path in a streamed reply is text the user already saw. |
| `tests/gateway/test_pre_agent_fallback_notice.py` | A fallback resolved during credential resolution (before any agent exists) carries a user-visible notice through the agent's one-shot mechanism. |
| `tests/gateway/test_pre_command_in_gateway.py` | `pre_command` fires once, in the gateway, for every local surface; a hung callback is bounded per session. |
| `tests/gateway/test_pre_gateway_dispatch.py` | The `pre_gateway_dispatch` hook lets plugins intercept inbound messages before auth and dispatch (`skip`/`rewrite`/`allow`). |
| `tests/gateway/test_pre_gateway_dispatch_relay_reader.py` | The hook runs at admission, never on the relay socket reader; a cancelled admission releases its prepared media. |
| `tests/gateway/test_priority_path_compression_demotion.py` | The PRIORITY busy path also demotes to queue semantics when compression is in flight. |
| `tests/gateway/test_process_cmdline_source.py` | The process-cmdline reader asks the cheapest source that can answer (psutil before forking `ps`). |
| `tests/gateway/test_process_hermes_home_expansion.py` | Process-level home readers expand a literal `~` in `HERMES_HOME`. |
| `tests/gateway/test_producer_owner_continuity.py` | Background and room producers retain source ownership across media and transcript lifetimes. |
| `tests/gateway/test_profile_authority_park_reason.py` | A profile parked for an unusable store names the *open* failure, not an ownership mismatch. |
| `tests/gateway/test_profile_identity_purge.py` | Profile identity purge lives behind the delete-only verb, never in the unserve path (a rename still needs its identity to rekey). |
| `tests/gateway/test_profile_isolation_runtime.py` | Profile isolation in a single-process multi-profile runtime: the boundary is a context-local override, not the process environment. |
| `tests/gateway/test_profile_resolution.py` | `_resolve_profile_home_for_source`: the source profile wins over routing, an unserved route is rejected, and a matcher failure rejects instead of serving the default. |
| `tests/gateway/test_profile_retire_stops_turns.py` | Unserving a profile stops **and joins** its running turns before ownership is released. |
| `tests/gateway/test_profile_routing.py` | Profile-based routing: exact thread match, conjunctive guild+chat, user-id routes, and route survival across `to_dict`/`from_dict`. |
| `tests/gateway/test_profile_serve_signature.py` | The profile re-scan watcher rebuilds adapters after a config replacement that keeps mtime and size. |
| `tests/gateway/test_profile_signature_during_connect.py` | A config saved while a profile connects stays pending for the next scan. |
| `tests/gateway/test_profile_spool_recovery.py` | Boot recovery replays a routed profile's spooled transcript backlog. |
| `tests/gateway/test_profiles_adopted_bot_chat.py` | Adopted local chats stay visible in the bot roster. |
| `tests/gateway/test_project_plugins_warning.py` | The gateway never loads `./.hermes/plugins`; an opted-in session is told so, and an unlistable folder never blocks the session. |
| `tests/gateway/test_prompt_attachments.py` | Public `prompt.submit` attachments are scoped to the profile staging dir and committed as bytes. |
| `tests/gateway/test_prompt_cancel_claimed.py` | `prompt.cancel` on a row the drain claims mid-flight stops that claim instead of refusing. |
| `tests/gateway/test_prompt_decline_no_fallback.py` | A connector egress **decline** must not collapse into `failed`, which is the cue to run the text fallback. |
| `tests/gateway/test_prompt_queued_controls.py` | `prompt.steer_queued` / `prompt.replace_queued` consume the still-queued admission in the owner's own write transaction. |
| `tests/gateway/test_prompt_queued_transfer.py` | Steer/replace failure windows: a durable queued prompt is never reported steered unless its text reached the turn that settled. |
| `tests/gateway/test_prompt_tail_freeze.py` | The ephemeral session-context prompt is byte-stable — every byte change re-keys the provider prompt cache and busts the agent cache. |
| `tests/gateway/test_proxy_mode.py` | Proxy mode: forwarding messages to a remote API server, with TTL re-reads, chunk framing and error handling. |
| `tests/gateway/test_publish_execution_stamp_fence.py` | `publish_execution` fences on the claim's execution stamp, not a per-delta ledger read. |
| `tests/gateway/test_purge_profile_routing.py` | The in-memory routing index must drop a deleted profile's namespace and persist the drop. |
| `tests/gateway/test_qqbot.py` | The QQ Bot adapter: config, DM/group policy, STT, WebSocket send/reconnect and chunk reads. |
| `tests/gateway/test_qqbot_credential_isolation.py` | The QQ adapter resolves `QQ_*` through the active profile secret scope, never raw `os.getenv`. |
| `tests/gateway/test_qqbot_scope_paths.py` | End-to-end profile-scope coverage for QQ authorization, startup validation and direct send. |
| `tests/gateway/test_qqbot_update_prompt_key.py` | The QQ update-prompt authz key comes from `build_session_key`, not a hard-coded literal. |
| `tests/gateway/test_queue_command.py` | `/queue` stores a follow-up with its full payload — media and reply context are not dropped. |
| `tests/gateway/test_queue_consumption.py` | Queued messages are consumed after normal agent completion, in FIFO order, with a photo burst still merged. |
| `tests/gateway/test_queued_final_ledger.py` | A queued-lane final is ledger-bracketed like the normal final send, under its own inbound id. |
| `tests/gateway/test_queued_followup_final_delivery.py` | The queued lane and the completion send share one "already delivered" source of truth. |
| `tests/gateway/test_queued_followup_processing_hooks.py` | The runner-side drain fires the `on_processing_start` / `on_processing_complete` lifecycle hooks. |
| `tests/gateway/test_queued_native_image_session_key.py` | A queued follow-up uses the pending event's session key for native image handling. |
| `tests/gateway/test_raft_adapter.py` | The Raft channel adapter: content detection, bridge token, activity endpoint auth, and per-profile slug. |
| `tests/gateway/test_readiness.py` | Runtime readiness collection degrades on an invalid config or a stop, and prefers the running session store's state. |
| `tests/gateway/test_reaped_eviction_interrupts_run.py` | Work evicted from a gateway turn slot is interrupted before release, and a stale finalizer cannot release a replacement generation. |
| `tests/gateway/test_reaped_session_recovery.py` | The durable-reaped session guard: a session ended in `state.db` while the process lived must not take the priority interrupt path. |
| `tests/gateway/test_reaper_profile_scope.py` | The abandoned-turn reaper thread keeps the served profile's home. |
| `tests/gateway/test_reasoning_command.py` | `/reasoning` parses ASCII and smart-global forms, reloads state from config, and accepts the extended efforts. |
| `tests/gateway/test_reasoning_config_per_model.py` | Per-model `reasoning_effort` overrides take precedence over the global default. |
| `tests/gateway/test_reconcile_probe_skip_keeps_parked.py` | A profile skipped by the own-gateway probe keeps its parked verdict. |
| `tests/gateway/test_reconnect_attention_profile_scope.py` | `agent.reconnect_attention_after` is read from the profile bound at call time, not a module constant. |
| `tests/gateway/test_refused_delete_read_detach.py` | A refused picker delete must not leave the closed session in the live list. |
| `tests/gateway/test_refused_owner_windows.py` | Real Windows probes behind the named refusal states: own session, elevation, and a session-0 owner. |
| `tests/gateway/test_rekey_profile_routing.py` | `hermes profile rename` rekeys the live in-memory routing index, not just the DB. |
| `tests/gateway/test_relay_authority.py` | Real authenticated relay ingress shares the ordinary execution authority. |
| `tests/gateway/test_relay_completion_injection_routing.py` | Completion injection must resolve the **relay** adapter for fronted platforms. |
| `tests/gateway/test_relay_delivery_followups.py` | Relay delivery follow-ups: classifier/resolver agreement on ended parents, drain grace, and a disconnect that tolerates a legacy transport signature. |
| `tests/gateway/test_relay_final_delivery_incident.py` | The relay "skip redundant final edit" branch must record the *acked* payload, not the accumulated one. |
| `tests/gateway/test_relay_injection_egress_priming.py` | Synthetic injections must prime the relay's egress routing cache before egress. |
| `tests/gateway/test_relay_seal_failure.py` | A seal-time transport failure retries the same idempotent frame and never loses or duplicates the final answer. |
| `tests/gateway/test_relay_source_platform_metrics.py` | Replies the relay carries are labelled with the platform the conversation lives on. |
| `tests/gateway/test_relay_teardown_drain.py` | Relay transport teardown drains in-flight outbound frames within a bounded grace. |
| `tests/gateway/test_relay_upstream_authz.py` | Relay upstream-enforced authorization: the base adapter defaults to not-upstream-authorized (deny). |
| `tests/gateway/test_reload_signal_logs_graceful_restart.py` | SIGUSR1 is a graceful restart and the gateway says so in its log. |
| `tests/gateway/test_reload_skills_command.py` | `/reload-skills` rescans the skill dir, renders a diff, and queues a one-shot note. |
| `tests/gateway/test_reload_skills_discord_resync.py` | `/reload-skills` resyncs the Discord `/skill` autocomplete (the closure held the only live copy). |
| `tests/gateway/test_remote_media_fetch.py` | A MEDIA path inside a remote terminal sandbox is fetched for delivery, after the same denylist the host applies. |
| `tests/gateway/test_replace_child_reap.py` | `--replace` reaps the old gateway's children (POSIX taskkill `/T` parity). |
| `tests/gateway/test_replace_ownership_guard.py` | `--replace` must never signal a gateway it cannot prove belongs to this `HERMES_HOME`; unprovable ownership stamps `startup_failed`. |
| `tests/gateway/test_replay_entry_fields.py` | The gateway rebuilds `agent_history` from the persisted transcript; the assistant whitelist keeps all six reasoning fields. |
| `tests/gateway/test_reply_to_injection.py` | The `[Replying to: "..."]` prefix is a disambiguation pointer, injected even when the text is already in history. |

| `tests/gateway/test_reset_button_deadlock.py` | The `/new` confirmation button must not run synchronous agent cleanup on the event loop. |
| `tests/gateway/test_reset_lineage_session_count.py` | The session counts that page a listing count a local reset lineage once. |
| `tests/gateway/test_reset_tip_unknown_barrier.py` | The unknown-turn barrier resolves a reset child to its creation owner; a crash marker is never treated as admission-free. |
| `tests/gateway/test_response_filters.py` | Silence-token recognition: the exact marker, the autonomous variant, the translated sentinel, and prose that merely mentions it. |
| `tests/gateway/test_responses_chain_api_content.py` | A chained Responses turn replays the earlier turn's user row as the model saw it, including its `api_content`. |
| `tests/gateway/test_responses_compressed_chain.py` | `previous_response_id` follows the logical conversation across an out-of-place compression. |
| `tests/gateway/test_responses_disconnected_identity.py` | A Responses identity settles from its admission's terminal outcome even when the streaming client left before the replay record was written. |
| `tests/gateway/test_responses_idem_replay_record.py` | Only the publishing Responses stream writes the durable `idem:` replay record. |
| `tests/gateway/test_responses_identity_bound_on_open.py` | A reopened Responses store enforces its settled-identity bound before serving a request. |
| `tests/gateway/test_responses_identity_migration.py` | Identities migrated from a store that predates settlement tracking join the bounded lifecycle. |
| `tests/gateway/test_responses_identity_retention.py` | Accepted `Idempotency-Key` identity has a bounded lifecycle beside the response-body LRU. |
| `tests/gateway/test_responses_output_order.py` | Responses output ids and indexes stay identical across observers, late joiners and eviction. |
| `tests/gateway/test_responses_request_identity.py` | Canonical response retry identity is fixed before concurrent admission. |
| `tests/gateway/test_responses_unkeyed_stream_no_recording.py` | An unkeyed streaming Responses request keeps no replay copy of its frames. |
| `tests/gateway/test_restart_after_turn.py` | In-band restart after-turn deferral helpers: timeout parsing, the wait budget and the cron drain. |
| `tests/gateway/test_restart_drain.py` | The restart drain: request semantics, busy vs idle, wedged-turn accounting, per-profile cron scoping and a Windows detached restart. |
| `tests/gateway/test_restart_drain_recovery_dedup.py` | A drain-window-interrupted turn is findable by its platform message id, so a backfill does not re-run it. |
| `tests/gateway/test_restart_interrupt_notice.py` | A turn a restart interrupts says so; a user stop is not relabelled, and the notice never overwrites an existing turn warning. |
| `tests/gateway/test_restart_notice_replay.py` | The planned-restart online notice survives an offline home-channel transport at boot. |
| `tests/gateway/test_restart_notification.py` | The `/restart` notification: the marker file is written atomically, the startup notification carries thread metadata and respects the disable flag. |
| `tests/gateway/test_restart_redelivery_dedup.py` | A re-delivered `/restart` (Telegram update re-delivery) must not restart the new process again. |
| `tests/gateway/test_restart_resume_pending.py` | `resume_pending` continuity: the flag, the injected note, the freshness window, and the boot gate that closes until warm-up completes. |
| `tests/gateway/test_restart_service_detection.py` | `/restart` detects a service manager (launchd vs interactive) and picks the right exit path. |
| `tests/gateway/test_restart_wait_prompt_reach.py` | A graceful restart's after-turn wait stays reachable for a turn parked on a human prompt. |
| `tests/gateway/test_resume_command.py` | `/resume` and `/sessions`: lane-exact listing, ranking, cross-user isolation and admin widening. |
| `tests/gateway/test_resume_display_history.py` | A resume after a compression shows the whole display history, with archived turns marked and only live rows as undo/retry targets. |
| `tests/gateway/test_resume_latest_local_cli.py` | `session.resume latest='cli'` finds the CLI's own gateway sessions (it searched `source IN ('cli','oneshot')` only). |
| `tests/gateway/test_resume_todo_state.py` | `session.resume` carries the session's todo snapshot. |
| `tests/gateway/test_retained_response_chain_after_delete.py` | A retained Responses chain whose transcript was deleted continues on a new generation. |
| `tests/gateway/test_retire_settles_waiters.py` | A successful profile retirement settles every observer still waiting on a queued admission. |
| `tests/gateway/test_retired_authority_cron_fence.py` | A retired profile authority refuses every verb that writes the home it released, until a successor advances the runtime epoch. |
| `tests/gateway/test_retired_media_ownership.py` | Receipt retries preserve transcript boundaries, successor ownership and media identity. |
| `tests/gateway/test_retired_media_scan_bound.py` | Retired-media collection: one bounded messages pass per collection, never on the event loop. |
| `tests/gateway/test_retired_session_reset_notice.py` | Gateway startup names every served profile whose config still declares a retired timed reset. |
| `tests/gateway/test_retry_authority_refusal.py` | `/retry` answers the authority's admission refusals *before* it rewrites the transcript, so a refused retry never loses a turn. |
| `tests/gateway/test_retry_native_provenance.py` | `/retry` re-admits natively (a freshly built event carries no native provenance). |
| `tests/gateway/test_retry_replacement.py` | `/retry` replacement and carrier-aware undo semantics, including refusals that must leave the transcript unchanged. |
| `tests/gateway/test_review_command.py` | `/review` dispatches a background subagent and is refused while an agent is running. |
| `tests/gateway/test_rich_sent_store_off_loop.py` | The rich-sent index write runs off the event loop for coroutine callers and loses no entry under concurrency. |
| `tests/gateway/test_room_work_evidence.py` | Passive receipts survive owner changes without granting replay rights. |
| `tests/gateway/test_room_work_receipt_capture.py` | A real peer receipt insertion immediately updates passive evidence. |
| `tests/gateway/test_room_work_service_capture.py` | A canonical hosted producer reaches passive capture without an explicit publisher. |
| `tests/gateway/test_room_work_transition_capture.py` | Real driver transitions retain passive evidence without becoming replay authority. |
| `tests/gateway/test_routing_save_fast_path.py` | The single-row routing-save fast path never loses a *needed* write, and the legacy `sessions.json` mirror may lag. |
| `tests/gateway/test_run_cleanup_progress.py` | Opt-in cleanup of temporary progress bubbles, chaining with existing callbacks; a failed run keeps the breadcrumbs. |
| `tests/gateway/test_run_progress_interrupt.py` | Interrupt-aware tool-progress suppression: a stop stops queueing progress bubbles and drops the already-queued ones. |
| `tests/gateway/test_run_progress_topics.py` | Topic-aware gateway progress updates (38 cases): anchors, per-platform modes, Slack task cards, and the queued-message lane. |
| `tests/gateway/test_run_progress_verbose_args.py` | Verbose tool-progress args render as a code block on markdown platforms. |
| `tests/gateway/test_run_runtime_hot_serve_cleanup.py` | Failed hot-serve initialization retires all authority task families before release. |
| `tests/gateway/test_run_tool_media_re.py` | Tool-media regex matching on Windows paths and case-insensitive extensions. |
| `tests/gateway/test_runner_compressed_receipt.py` | A `TurnRunner` result that compressed the transcript is stored whole, never cut to a turn suffix. |
| `tests/gateway/test_runner_fatal_adapter.py` | A fatal adapter error queues a retryable runtime fatal for reconnection; the exit policy keeps the service-restart verdict. |
| `tests/gateway/test_runner_startup_failures.py` | Startup failure classification: a global startup conflict, `--replace` aborting while a force-killed pid is alive, and a non-retryable error's exit code. |
| `tests/gateway/test_running_agent_session_toggles.py` | `/yolo` and `/verbose` dispatch mid-agent-run (a small allowlist bypasses the running-agent guard). |
| `tests/gateway/test_runtime_api.py` | Real TCP HTTP/WS coverage for the gateway-owned API lifecycle; the HTTP lifespan must not own the runtime services. |
| `tests/gateway/test_runtime_bootstrap.py` | The private control pipe: single-use profile-bound tickets, atomic socket cleanup, peer identification, and a Windows DACL. |
| `tests/gateway/test_runtime_bootstrap_lifecycle.py` | Live runtime HTTP lifecycle boundaries: the browser ticket gate is preserved and a drain withdraws native admission before the listener closes. |
| `tests/gateway/test_runtime_bootstrap_server_identity.py` | A non-elevated client identifies an elevated gateway from the control pipe itself (17 cases). |
| `tests/gateway/test_runtime_config_env_expansion.py` | Runtime config env-var expansion; the top-level prefills win over the legacy key. |
| `tests/gateway/test_runtime_describe_skin.py` | `runtime.describe` carries the owning profile's resolved skin. |
| `tests/gateway/test_runtime_downgrade_exit.py` | A gateway stops itself when its checkout is moved back to a pre-runtime release. |
| `tests/gateway/test_runtime_env_reload_config_authority.py` | The per-turn env reload preserves `config.yaml` authority for `max_turns` and the terminal backend. |
| `tests/gateway/test_runtime_footer.py` | The opt-in runtime-metadata footer appended to final replies: field order, latency, model and per-platform overrides. |
| `tests/gateway/test_runtime_listener_supervision.py` | A dead session listener must never leave a ready gateway behind. |
| `tests/gateway/test_runtime_ownership.py` | Real process exclusion before writable gateway construction; an unusable lock is never unlinked. |
| `tests/gateway/test_runtime_provider_override_target_model.py` | Provider-override credential resolution keys off the override's **model**, not the config default. |
| `tests/gateway/test_runtime_token_identity.py` | Legacy token authentication becomes an explicit authority principal. |
| `tests/gateway/test_runtime_worker_shutdown.py` | Shutdown counts managed claims and retains profile ownership until the actual threads stop. |
| `tests/gateway/test_runtime_writer_drain.py` | Live runtime writers retain runtime exclusion after a drain deadline. |
| `tests/gateway/test_safe_adapter_disconnect.py` | A failed connect path must call `adapter.disconnect()` (otherwise `aiohttp` sessions leak). |
| `tests/gateway/test_save_command_delivery.py` | `/save` delivers the export document through the requester's live adapter, and reports a missing adapter without a crash. |
| `tests/gateway/test_scalar_model_config_policy.py` | A scalar `model: <id>` config must not crash `session.create`. |
| `tests/gateway/test_scale_to_zero.py` | Scale-to-zero idle detection: each conjunct of the idle predicate and each clause of the arm-gate is exercised independently. |
| `tests/gateway/test_scale_to_zero_dashboard_client.py` | An attached dashboard/desktop/TUI WS client counts as activity (13 of 72 instances flapped suspend→wake every ~60 s). |
| `tests/gateway/test_scale_to_zero_watcher.py` | The idle watcher's dormant sequence and the arm-gate wiring (35 cases). |
| `tests/gateway/test_scoped_lock_dir_unusable.py` | A token-lock dir this user may not write gives one named warning, never a crash loop. |
| `tests/gateway/test_scoped_process_reservations.py` | Non-gateway setup processes can reserve an existing adapter lock; a recycled owner is stale. |
| `tests/gateway/test_secondary_local_pick_multiplex.py` | A secondary profile's local model pick reaches its next turn under multiplexing. |
| `tests/gateway/test_secondary_route_fence_scope.py` | Retirement is keyed by (profile, id): a secondary's delete or prune fences its routes there, never in the launch profile. |
| `tests/gateway/test_send_error_classification.py` | Structured send-error classification (`SendResult.error_kind`) so consumers branch on a category, not a substring. |
| `tests/gateway/test_send_image_file.py` | `send_image_file` across Telegram/Discord/Slack plus MEDIA-tag extraction and screenshot cleanup. |
| `tests/gateway/test_send_multiple_images.py` | Native multi-image batching per platform, with chunking and a URL redirect guard. |
| `tests/gateway/test_send_retry.py` | The shared send-retry path: transient errors retry with backoff, permanent errors fall back to plain text, `Retry-After` is honoured. |
| `tests/gateway/test_send_retry_hooks.py` | Photon's forked retry path was replaced by two hooks so it inherits the shared fixes; Slack and Discord parse `Retry-After` (including HTTP dates). |
| `tests/gateway/test_send_voice_dispatch_signatures.py` | Every adapter's `send_voice` must accept the `is_voice` keyword the base dispatch passes. |
| `tests/gateway/test_send_voice_reply_notify.py` | The auto voice reply marks its metadata `notify=True` so push notifications are not silenced. |
| `tests/gateway/test_serving_authorities.py` | Readers of every served ledger skip a slot that serves nothing (unbuilt or parked). |
| `tests/gateway/test_session.py` | Gateway session management: routing keys, thread scopes, workspace scoping, and untrusted-metadata quoting in prompts. |
| `tests/gateway/test_session_a2a.py` | Forwarded profile identity is owner-bound, not a title or latest-row guess. |
| `tests/gateway/test_session_activity_ordering.py` | Recovered UTC routes coexist with legacy local-time routes in the listing. |
| `tests/gateway/test_session_ancillary_reads.py` | Canonical observers read owner state without bootstrapping legacy services. |
| `tests/gateway/test_session_api.py` | API session-control endpoints: capabilities, message paging, forking, model lock, SSE stream classification and the confirmed-runtime lock rules. |
| `tests/gateway/test_session_approval_commands.py` | Typed `/approve` and `/deny` on a local session resolve the same waiting tool call as `approval.respond`. |
| `tests/gateway/test_session_authoring_commands.py` | Authoring/workflow slash commands (`/plan`, `/learn`, `/moa`, `/goal`, `/loop`) run the messaging gateway's own handler for a local session. |
| `tests/gateway/test_session_authorities_multiplex.py` | One session authority per served profile home. |
| `tests/gateway/test_session_authority.py` | Real messaging ingress and an authenticated WS share one warm agent. |
| `tests/gateway/test_session_authority_adopted_stop.py` | A Stop after the turn adopted its agent reaches that agent even if the cache no longer holds it. |
| `tests/gateway/test_session_authority_cancel_settlement.py` | Cancelling a queued admission settles every observer kind in the authority, not per caller. |
| `tests/gateway/test_session_authority_late_stop.py` | A Stop for a finishing turn reaches only that turn, never the next one on the cached agent. |
| `tests/gateway/test_session_authority_preadopt_stop.py` | A Stop accepted before the claimed turn adopts its agent reaches the agent that turn runs. |
| `tests/gateway/test_session_bot_retry.py` | The owner retries a transiently failed Bot DM delivery exactly once, never as unknown execution. |
| `tests/gateway/test_session_bot_target_lifecycle.py` | A renamed or deleted auto-created Bot Chat target spends its creation identity and gets a fresh replacement. |
| `tests/gateway/test_session_boundary_security_state.py` | `clear_session_boundary_security_state` is scoped and wakes blocked approvals. |
| `tests/gateway/test_session_busy_compression_refusal.py` | A rewind refused because another writer holds the compression lock names the lock in `field`. |
| `tests/gateway/test_session_busy_controls.py` | Public owner controls never become a second admission or change the cached prefix. |
| `tests/gateway/test_session_bypass_policy.py` | Bypass launches freeze a typed isolation policy chosen before any profile read. |
| `tests/gateway/test_session_chat_approval.py` | Session chat streams surface approval requests keyed by run id. |
| `tests/gateway/test_session_client_env.py` | A shell-launched client's allowlisted `HERMES_*` behaviour values ride `session.create` and apply to that session only. |
| `tests/gateway/test_session_commands.py` | Local slash resolution is not another execution owner. |
| `tests/gateway/test_session_commands_session_scope.py` | Slash commands and discovery on a local session resolve against **that** session's frozen policy. |
| `tests/gateway/test_session_config_loaders.py` | A gateway-owned session runs with `provider_routing` and `prefill_messages_file` from its own profile's config as of its creation. |
| `tests/gateway/test_session_config_projection.py` | Native config/model reads cross the authenticated owner without executing. |
| `tests/gateway/test_session_context_inheritance.py` | Cross-session `ContextVar` inheritance leak guard (`asyncio.create_task` snapshots context at creation). |
| `tests/gateway/test_session_continuity.py` | Session continuity: a `/new` whose DB writes failed silently must not time-travel the user back to a zombie predecessor. |
| `tests/gateway/test_session_create_tier_cwd.py` | Desktop create parity: speed tier and cwd provenance frozen into the session policy. |
| `tests/gateway/test_session_cron.py` | Cron admissions retain exact job identity and the stored job's model policy. |
| `tests/gateway/test_session_db_corrupt_fallback.py` | A structurally corrupt `state.db` makes the store divert to the JSONL/spool fallback, not retry forever. |
| `tests/gateway/test_session_db_handle_sharing.py` | One gateway process must not hold two `SessionDB` handles on one `state.db`. |
| `tests/gateway/test_session_db_recovery.py` | Recoverable `SessionDB` opens: backoff, single-flight retry, sanitised health, and `close_all` semantics. |
| `tests/gateway/test_session_db_replaced_fallback.py` | The store must not FTS-repair a replaced `state.db`. |
| `tests/gateway/test_session_db_warning_recheck.py` | The startup `state.db` warning is not broadcast once the store has healed. |
| `tests/gateway/test_session_deferred_pick_restart.py` | A guarded deferred model pick stays answerable across a real owner restart. |
| `tests/gateway/test_session_degraded_db_continuity.py` | Session continuity when the default/global `state.db` is unavailable (the JSONL routing fallback). |
| `tests/gateway/test_session_detach_end_reason.py` | `session.detach {end_reason}` ends the idle local row with the reason main's classic CLI wrote. |
| `tests/gateway/test_session_dm_thread_seeding.py` | DM thread sessions start empty — no parent transcript seeding. |
| `tests/gateway/test_session_edit_policy.py` | An ACP session's edit-approval policy is owner data: durable, visible to every viewer, restored after restart, enforced where the edit runs. |
| `tests/gateway/test_session_end_delegations.py` | `exit` and `/new` end that session's own async delegations; an unviewed completion becomes a note, not an unattended turn. |
| `tests/gateway/test_session_env.py` | The session env contextvars: set/clear/reset, the `os.environ` fallback, executor inheritance and the cron blank-masking rule. |
| `tests/gateway/test_session_event_observer_isolation.py` | A failed same-thread projection cannot abort canonical event publication. |
| `tests/gateway/test_session_events_execution_stamp.py` | The execution stamp marks exactly one claimed, unsettled execution. |
| `tests/gateway/test_session_events_overflow.py` | A subscriber that overflows its bounded mailbox must learn it, not stay silently stale. |
| `tests/gateway/test_session_follow_profile_config.py` | Bot Chat's `follow_profile_config` on the shared owner: each turn re-reads the profile's model sections. |
| `tests/gateway/test_session_group_controls.py` | Canonical group management is profile-bound and never starts inference. |
| `tests/gateway/test_session_group_execution_controls.py` | Native room controls retain the service protocol and authenticated ownership. |
| `tests/gateway/test_session_history_canonical.py` | `session.history` returns the durable display transcript with each row's `row_id`. |
| `tests/gateway/test_session_hosted_controls.py` | Canonical room controls retain the original attempt fence; an unknown discard is exact and never requeues. |
| `tests/gateway/test_session_hosted_daemon.py` | A real native socket and canonical room member inference in a disposable daemon. |
| `tests/gateway/test_session_hosted_rpc.py` | Room worker threads use the real authority ledger, never TUI dispatch. |
| `tests/gateway/test_session_hosted_service.py` | The hosted room service: owner survives a restart, a foreign actor cannot act, and historical unowned rooms are not run. |
| `tests/gateway/test_session_hosted_transport.py` | Real private owner sockets: source attestation, chunked reads, and a preflight that verifies by digest. |
| `tests/gateway/test_session_hygiene.py` | Gateway session hygiene: auto-compression of pathologically large transcripts using the same threshold as the agent. |
| `tests/gateway/test_session_hygiene_turnhold_adoption.py` | The hygiene turn-hold must not burn a watermark-fenced compression attempt (100 % of the summary was discarded). |
| `tests/gateway/test_session_id_cache_coherence.py` | A cross-process guard must not invalidate the agent cache when the active `session_id` differs but the `session_key` matches. |
| `tests/gateway/test_session_identity.py` | One frozen `RoutingIdentity` per inbound event that every reader agrees on; unresolved under multiplex raises, never means default. |
| `tests/gateway/test_session_identity_restore.py` | Identity survives a restart: a restored lane delivers through the bot that received it, or fails closed. |
| `tests/gateway/test_session_images.py` | Canonical uploads stage bytes only after viewer and owner authorization. |
| `tests/gateway/test_session_images_profile.py` | `image.attach_bytes` accepts its declared `profile` selector for the owner's own home. |
| `tests/gateway/test_session_import_chain_ownership.py` | Import parent links and chain-aware deletes never cross principals. |
| `tests/gateway/test_session_info.py` | `_format_session_info` surfaces the session's config: context length, endpoint, MoA preset, named provider and profile config. |
| `tests/gateway/test_session_kanban.py` | Task claims, not caller-supplied launch policy, authorise Kanban execution. |
| `tests/gateway/test_session_kanban_run_off_loop.py` | The Kanban DB is the cross-profile dispatch bus; its writes must not freeze the owner loop. |
| `tests/gateway/test_session_kanban_turn_recovery.py` | Owner-side Kanban workers retry a failed turn in place, proven from the bound frame's claim. |
| `tests/gateway/test_session_list_allowed_sources.py` | `session.list` surfaces **all** user-facing sources (a hard-coded allow-list hid new platforms). |
| `tests/gateway/test_session_list_live_hidden.py` | The live session list honours hidden/archived like every stored picker. |
| `tests/gateway/test_session_listener_lazy_dashboard.py` | The session listener serves local sessions **without importing the dashboard app** (~690 routes, ~0.6 s on the loop). |
| `tests/gateway/test_session_llm_oneshot.py` | `llm.oneshot` borrows the chat's model, and a burst of slow one-shots never starves the gateway. |
| `tests/gateway/test_session_llm_oneshot_pool.py` | The owner's one-shot pool is bounded, scoped like the handler, and owned by connection and owner. |
| `tests/gateway/test_session_load_bool.py` | A corrupted `sessions.json` entry (a bare bool) must not abort loading all remaining sessions. |
| `tests/gateway/test_session_local_mcp_refreeze.py` | The admission-start editor MCP re-check is best-effort, bounded, and only for an authorized head. |
| `tests/gateway/test_session_local_reopen_on_turn.py` | Mounting a finalized local session is a read; the first admitted turn reopens it. |
| `tests/gateway/test_session_local_route.py` | `-m <alias>` at `session.create` is decoded against the profile's own aliases (the raw alias must never reach the default provider). |
| `tests/gateway/test_session_local_title.py` | Authority-side title selection follows main's classic rule without leaking foreign titles. |
| `tests/gateway/test_session_memory_review.py` | `/memory` and `/skills` review verbs on a local session match the classic CLI's reach. |
| `tests/gateway/test_session_messages_shutdown_preserve.py` | When the transcript flush raises, the in-memory transcript is dumped to a recovery snapshot instead of lost. |
| `tests/gateway/test_session_model_command_commits.py` | A typed `/model` admitted as a prompt on a local session commits the session's policy. |
| `tests/gateway/test_session_model_override_credential_pool.py` | Session `/model` overrides must attach the `credential_pool` for 402 rotation. |
| `tests/gateway/test_session_model_override_persistence.py` | Per-session `/model` overrides survive a gateway restart and are rehydrated on first use. |
| `tests/gateway/test_session_model_override_routing.py` | A session-scoped override must reach the agent, not just the stored row. |
| `tests/gateway/test_session_model_reset.py` | `/new` (and `/reset`) clears session-scoped overrides — and only its own. |
| `tests/gateway/test_session_mutation_branch.py` | Branches are independent frozen local owners, never route aliases. |
| `tests/gateway/test_session_mutation_branch_boundary.py` | A selected-message branch copies exactly the requested prefix, validated inside the receipt transaction. |
| `tests/gateway/test_session_mutation_cold.py` | Cold history authorisation does not manufacture an execution route. |
| `tests/gateway/test_session_mutation_compress.py` | Real summary preparation commits only against the unchanged local transcript. |
| `tests/gateway/test_session_mutation_compress_managed.py` | The same, under the `managed_workers` opt-in. |
| `tests/gateway/test_session_mutation_compress_preview.py` | `/compress --preview` is read-only on the canonical mutation path, on every surface. |
| `tests/gateway/test_session_mutation_coordinator.py` | Shared mutation publication and live-state coordination: a metadata mutation publishes once while the work is queued. |
| `tests/gateway/test_session_mutation_delete_fences.py` | Deletion covers live descendants before their durable claim. |
| `tests/gateway/test_session_mutation_import_owner.py` | The importer owns cold control before another authenticated actor can claim it. |
| `tests/gateway/test_session_mutation_lineage_delete.py` | Deleting a logical local owner retires its current physical transcript too. |
| `tests/gateway/test_session_mutation_model.py` | Explicit model changes cross the real provider wire, not profile defaults. |
| `tests/gateway/test_session_mutation_model_busy.py` | A model pick on a session with a running turn lands for the **next** turn, fenced by revision. |
| `tests/gateway/test_session_mutation_model_provider_identity.py` | A model pick freezes only the picked provider; a displaced legacy entry keeps its own secret. |
| `tests/gateway/test_session_mutation_model_provider_replacement.py` | A model pick replaces the picked provider's frozen entry whole — a withdrawn secret is never kept. |
| `tests/gateway/test_session_mutation_model_route.py` | A canonical model pick switches **from** the route the session runs now, as one tuple (a frozen endpoint with the current key would leak the key to a new host). |
| `tests/gateway/test_session_mutation_reset.py` | Reset commits the prepared physical target without changing logical ownership. |
| `tests/gateway/test_session_mutation_retirement.py` | Native deletion retires routing and keeps only exact authorised retries. |
| `tests/gateway/test_session_mutation_retry_repair.py` | An exact mutation retry reconciles the runtime projection a failed first attempt left behind. |
| `tests/gateway/test_session_mutation_rpc.py` | Competing viewers must not overwrite a newer metadata revision. |
| `tests/gateway/test_session_operator_scope.py` | Operator scope changes access, not durable authorship or execution fences. |
| `tests/gateway/test_session_override_thread_recovery.py` | Session-scoped `/model` and `/reasoning` overrides are not lost on Telegram forum/DM topics or after compression splits. |
| `tests/gateway/test_session_policy.py` | Fresh local policy is frozen and scoped: the surface, the cwd, the launch options, the provider route and the key. |
| `tests/gateway/test_session_policy_coding_posture.py` | The gateway, not the client, applies the coding posture to a session that did not pick toolsets. |
| `tests/gateway/test_session_policy_refusal_fields.py` | Every `session.create` refusal names the check that fired, at the policy, on the wire, in the log and in the CLI copy. |
| `tests/gateway/test_session_policy_remote_cwd.py` | A remote or container terminal backend never runs in the client's host launch folder. |
| `tests/gateway/test_session_policy_shadowed_custom_create.py` | A Desktop pick of a custom endpoint named like a built-in freezes the endpoint's own route. |
| `tests/gateway/test_session_policy_verbs.py` | Desktop's typed `/reasoning` and "Move to project" are revision-fenced `session.mutate` operations on the frozen policy. |
| `tests/gateway/test_session_policy_workspace_readiness.py` | A removed workspace keeps a local chat readable and movable; only a turn refuses. |
| `tests/gateway/test_session_process_scope.py` | Process-global sidecar verbs never reach the shared owner's other sessions. |
| `tests/gateway/test_session_race_guard.py` | The session race guard: a sentinel placed before agent setup, and follow-ups merged into the pending queue. |
| `tests/gateway/test_session_read_commands.py` | Read/report slash commands run their real gateway handler for a local session (and only reads). |

| `tests/gateway/test_session_recovery.py` | Flush-recovery `session_key` → `session_id` resolution, profile-aware. |
| `tests/gateway/test_session_reset_notify.py` | Internal turns preserve the user activity clock. |
| `tests/gateway/test_session_resume_compression_tip.py` | `session.resume`'s legacy-source branch remaps a pre-authority cli/tui/gui tip. |
| `tests/gateway/test_session_resume_config_refresh.py` | A resumed local session re-derives its config-derived fields (toolsets, backend, max turns, cwd) from the profile's *current* config. |
| `tests/gateway/test_session_route_identity.py` | Launch-route gates compare what the runtime resolves, not how the provider was spelled. |
| `tests/gateway/test_session_row_cwd.py` | The session row's `cwd` is row metadata, split from the execution cwd. |
| `tests/gateway/test_session_setting_commands.py` | Per-session setting commands run their real gateway handler for a local session and read back through `config.get`. |
| `tests/gateway/test_session_shell.py` | Ink `!cmd` runs for its own local session, in that session's directory, behind the safety gates. |
| `tests/gateway/test_session_split_brain.py` | Telegram sessions trapped in "Interrupting current task…" while `/stop` reports no task: task ownership, self-heal and generation-matched release. |
| `tests/gateway/test_session_stall_watchdog.py` | The session stall watchdog: idle detection from a shared activity snapshot, one notification per stall, and retry after a send failure. |
| `tests/gateway/test_session_state_cleanup.py` | Running-agent state lived in three dicts that drifted; the release pops all three and is idempotent. |
| `tests/gateway/test_session_steer_before_adopt.py` | A steer accepted while the claimed turn is still building its agent reaches that agent. |
| `tests/gateway/test_session_steer_stale_busy_refusal.py` | A correction for a claimed turn with no live agent is *refused*, not errored (clients turn an error into "the send failed"). |
| `tests/gateway/test_session_store_expiry_finalized.py` | Expiry finalization closes sessions as `session_reset` so stale-routing recovery does not reopen them. |
| `tests/gateway/test_session_store_lock_io.py` | Blocking I/O must not run while `session_store._lock` is held (a full routing-index rewrite + `fsync` on every inbound message). |
| `tests/gateway/test_session_store_prune.py` | The in-memory session dict grew unbounded; the prune honours `updated_at`, skips sessions with active processes, and rewrites `sessions.json`. |
| `tests/gateway/test_session_store_runtime_stale_guard.py` | Runtime self-heal for stale `sessions.json` routing entries: an ended row is recovered preserving its id. |
| `tests/gateway/test_session_store_stale_prune.py` | Crash self-healing: startup prunes stale routing entries whose sessions are ended in `state.db`. |
| `tests/gateway/test_session_subagent_controls.py` | Desktop's subagent Steer/Stop reach only this session's children. |
| `tests/gateway/test_session_time_persistence.py` | Elapsed time cannot replace a durable conversation; explicit boundaries still can. |
| `tests/gateway/test_session_title_rename_lane.py` | Which title stage may spend a platform rename (Discord allows two renames per ten minutes). |
| `tests/gateway/test_session_tui_config.py` | The TUI's profile preferences are written by the shared owner into the **owning** profile's `config.yaml`. |
| `tests/gateway/test_session_tui_ops.py` | Ink's `/save`, `/reload`, `/agents pause` and `/rollback` on the shared owner (main's sidecar parity). |
| `tests/gateway/test_session_tui_ops_session_diff.py` | The classic CLI's `/diff session` follows the session's frozen checkpoint policy and returns the body as data. |
| `tests/gateway/test_session_tui_side.py` | Ink's `/bg` and `/btw` run a detached side agent off the session's FIFO. |
| `tests/gateway/test_session_viewer_automation.py` | `session.automation`: the classic CLI's `/goal`, `/subgoal`, `/loop` and `/heartbeat` managers run by the owner. |
| `tests/gateway/test_session_ws_upgrade_failure_logged.py` | An owner that fails a session WebSocket upgrade names the cause in `gateway.log`. |
| `tests/gateway/test_sethome_synthetic_thread.py` | `/sethome` must not persist Slack's synthetic per-message session thread. |
| `tests/gateway/test_settled_result_size.py` | A settled turn result stores this turn's output and accounting, never per-session copies. |
| `tests/gateway/test_settlement_lock_liveness.py` | A settlement waiting on a contended SQLite writer never stalls the owner event loop. |
| `tests/gateway/test_settlement_off_loop.py` | Settlement's write runs off the owner loop; completion, idle info and waiters keep their order. |
| `tests/gateway/test_setup_feishu.py` | The Feishu interactive setup writes env vars that drive the adapter (credentials, mode, DM/group policy). |
| `tests/gateway/test_shared_adapter_utils.py` | The three shared lifecycle utilities (`cancel_task`, `MessageDeduplicator`, `bounded_put`) instead of re-declared copies. |
| `tests/gateway/test_shared_busy_receive_loop.py` | A busy-session follow-up releases the adapter's serial receive loop once it is durably queued, and is delivered exactly once. |
| `tests/gateway/test_shared_clarify.py` | A clarification response survives viewer detach through the real gateway worker. |
| `tests/gateway/test_shared_gateway_harness.py` | Acceptance reports must cover the required manifest, not only successes. |
| `tests/gateway/test_shared_group_sender_prefix.py` | The Slack author mention prefix in shared-thread preprocessing. |
| `tests/gateway/test_shared_platform_boilerplate.py` | Every plugin platform's env-driven enablement reads through the ONE profile-scoped reader; the YAML bridge seeds `extra` without writing env. |
| `tests/gateway/test_shared_session_controls.py` | A shared approval outlives its viewer and bypasses the FIFO; a foreign or retired worker's control identity is rejected. |
| `tests/gateway/test_shell_hook_resync.py` | The gateway re-syncs the profile's shell hooks on every local session open; the gateway itself never prompts. |
| `tests/gateway/test_shutdown_cache_cleanup.py` | Idle agents in the LRU cache are cleaned at shutdown so `MemoryProvider.on_session_end()` fires. |
| `tests/gateway/test_shutdown_executor_quiesce.py` | Gateway shutdown quiesces its thread pool **before** closing `state.db` (a blocking DB write during the WAL checkpoint corrupted the file). |
| `tests/gateway/test_shutdown_flush.py` | Pending-message durability: the flush writes each payload to a file, and the recovery replays it into the DB. |
| `tests/gateway/test_shutdown_flush_recovery.py` | Cross-restart recovery of cap-dropped transcript spool files: drop order, quarantine, and boot recovery counting. |
| `tests/gateway/test_shutdown_forensics.py` | A fast shutdown snapshot plus an asynchronous diagnostic spawn, with an owner-only log. |
| `tests/gateway/test_shutdown_inflight_transcript_flush.py` | An interrupted turn's transcript is persisted so the pre-restart context survives a resume. |
| `tests/gateway/test_shutdown_kill_off_loop.py` | `ProcessRegistry.kill_all()` (blocking, up to 15 s per target) must not run on the event loop. |
| `tests/gateway/test_shutdown_memory_provider_messages.py` | Shutdown passes the agent's conversation transcript to `shutdown_memory_provider` (providers saw an empty list). |
| `tests/gateway/test_shutdown_runtime_ownership.py` | Exit-state persistence is not the end of canonical writer lifetime. |
| `tests/gateway/test_shutdown_settle_leash.py` | A gateway stop settles authority work within the watchdog leash it has left, and never closes `state.db` under a live turn. |
| `tests/gateway/test_shutdown_spool_limits.py` | Recovery must not retain every decoded spool payload while sorting. |
| `tests/gateway/test_shutdown_teardown_profile_scope.py` | Gateway-hosted teardown fires memory-provider lifecycle hooks under the **owning** profile's scope. |
| `tests/gateway/test_shutdown_watchdog.py` | The shutdown watchdog and the loop-liveness heartbeat file contract (a frozen loop makes asyncio timeouts structurally unable to fire). |
| `tests/gateway/test_sibling_route_reserve.py` | A host-scoped connection's sibling route follows the profile's current authority. |
| `tests/gateway/test_signal.py` | The Signal adapter: config, media type guessing, contact lookup, chunking and the RPC send paths. |
| `tests/gateway/test_signal_format.py` | Markdown→Signal bodyRanges conversion, including the false-positive regressions that caused spurious italics. |
| `tests/gateway/test_signal_plugin.py` | Signal ships as a bundled platform plugin: the registry entry carries what core used to hard-wire. |
| `tests/gateway/test_signal_rate_limit.py` | The Signal attachment scheduler's token-bucket simulator, calibrated from `Retry-After`. |
| `tests/gateway/test_silent_partial_delivery.py` | Silent partial delivery: a delivery flag with no recorded payload must not suppress the gateway's normal final send. |
| `tests/gateway/test_simplex_plugin.py` | The SimpleX Chat plugin: config, DM/group send, image flattening, contacts listing and per-profile scope. |
| `tests/gateway/test_single_profile_flip_keeps_launch_work.py` | A single-profile gateway that starts multiplexing in place keeps the **default** profile's own work running. |
| `tests/gateway/test_single_profile_host_serves_new_profile.py` | A host gateway that booted with one profile serves a profile created afterwards. |
| `tests/gateway/test_skill_slash_native_boundary.py` | The messaging skill slash path stays filesystem-only; plugin skill bodies are for interactive surfaces. |
| `tests/gateway/test_skill_slash_offloop.py` | The skill-slash fallthrough must not hold the gateway event loop. |
| `tests/gateway/test_skip_context_files_wiring.py` | Per-platform `skip_context_files` wiring: config → signature → agent kwargs. |
| `tests/gateway/test_slack.py` | The Slack adapter (176 cases): app-mention handling, multi-workspace state, proxying, uploads, thread backfill and command parsing. |
| `tests/gateway/test_slack_agent_sessions_api.py` | Slack routing onto the slack-sdk Agent Sessions API (typing, clear, thread rename). |
| `tests/gateway/test_slack_api_human_senders.py` | A message posted through the Web API with a *user* token is a human even without a `client_msg_id`. |
| `tests/gateway/test_slack_approval_buttons.py` | Slack Block Kit approval buttons and thread-context fetching (self-bot replies included as assistant context). |
| `tests/gateway/test_slack_block_kit.py` | The Slack Block Kit renderer as a pure function: nesting, tables, clamping and schema validity. |
| `tests/gateway/test_slack_block_kit_adapter.py` | Block Kit wiring: off by default, on ⇒ blocks plus a text fallback, edits only on finalize. |
| `tests/gateway/test_slack_bot_auth_bypass.py` | Slack bot/workflow senders are authorized when `allow_bots` says so, without weakening the human gate. |
| `tests/gateway/test_slack_channel_session_scope.py` | A top-level Slack message must not get a unique `thread_id` (every top-level message spawned a brand-new session). |
| `tests/gateway/test_slack_channel_skills.py` | Slack channel skill bindings resolve by DM channel id. |
| `tests/gateway/test_slack_clarify_buttons.py` | Slack Block Kit clarify buttons, including the "Other" flip to text mode and a late click being a no-op. |
| `tests/gateway/test_slack_cron_continuable_surface.py` | The `cron_continuable_surface` extra key and its pairing warning. |
| `tests/gateway/test_slack_dedup_ttl.py` | The Socket Mode dedup TTL must outlast Slack's reconnect redelivery window. |
| `tests/gateway/test_slack_download_redirects.py` | Authenticated Slack downloads retain the token only on validated CDN hops. |
| `tests/gateway/test_slack_download_ssrf.py` | Inbound Slack file downloads are SSRF-guarded on every redirect. |
| `tests/gateway/test_slack_ignore_other_user_mentions.py` | The bot stays silent on a message that opens by mentioning someone else, unless it is also mentioned. |
| `tests/gateway/test_slack_log_noise.py` | Slack log noise and privacy: a catch-all ack, metadata-only diagnostics, and clarify resolution logged by index. |
| `tests/gateway/test_slack_mention.py` | Slack mention gating, `free_response_channels`, DM exemption and `allowed_channels`. |
| `tests/gateway/test_slack_mention_humanization.py` | Slack user mentions are humanized to display names and the bot's identity is grounded in the prompt. |
| `tests/gateway/test_slack_model_picker.py` | The Slack Block Kit model picker: provider → model → back, with expiry and authorization on every click. |
| `tests/gateway/test_slack_native_streaming.py` | Slack native streaming (`chat.startStream`/`appendStream`/`stopStream`), 23 cases. |
| `tests/gateway/test_slack_pasted_tables.py` | A pasted table (in `table` blocks, sometimes nested in attachments) reaches the agent. |
| `tests/gateway/test_slack_peer_agent_smoke.py` | Repeatable smoke tests for Slack peer-agent routing after config changes or deploys. |
| `tests/gateway/test_slack_plugin_action_handlers.py` | Plugin-registered Slack Block Kit action handlers, with defensive wrapping. |
| `tests/gateway/test_slack_plugin_setup.py` | The Slack interactive-setup wizard saves the home channel and clears it on blank. |
| `tests/gateway/test_slack_relay_parent_command.py` | A relay parent becomes a gateway command. |
| `tests/gateway/test_slack_reply_expected.py` | The adapter tells the gateway whether an admitted message was addressed to the bot (a bare silence marker may stand only then). |
| `tests/gateway/test_slack_require_mention_channels.py` | `require_mention_channels` always demands a mention, even in a free-response channel. |
| `tests/gateway/test_slack_runner_ignored_channels.py` | The runner drops Slack ignored channels before auth, hooks and session work. |
| `tests/gateway/test_slack_sdk_response.py` | Slack Web API responses are `SlackResponse` objects, **not** dicts — `isinstance(resp, dict)` collapsed every real call into the "unexpected shape" branch. |
| `tests/gateway/test_slack_send_retry.py` | Slack `send()` must surface `retryable` + `retry_after` on a 429 (chunks were silently dropped). |
| `tests/gateway/test_slack_socket_reconnect_heal.py` | Socket Mode teardown stops the task before the session closes, and the watchdog restarts a dead transport. |
| `tests/gateway/test_slack_status_update.py` | `send_or_update_status` sends fresh on the first call and edits thereafter, with independent keys. |
| `tests/gateway/test_slack_thread_require_mention.py` | Per-thread require-mention parsing and the top-level free-response exemption. |
| `tests/gateway/test_slack_turn_recipient_identity.py` | Per-turn Slack egress identity (recipient user/team) stamped from per-turn metadata. |
| `tests/gateway/test_slack_unfurl_duplicate_turn.py` | A link unfurl must not become a second user turn (one message produced two agent runs). |
| `tests/gateway/test_slack_unfurl_nested_blocks_budget.py` | Nested `attachments[].blocks[]` text in link unfurls shares one bounded budget. |
| `tests/gateway/test_slack_wake_external_bot_messages.py` | Human replies in threads whose root was posted by the bot via a direct `chat.postMessage` are not dropped. |
| `tests/gateway/test_slash_access.py` | The pure per-platform slash-command access resolver: DM vs group admin scope, id coercion, alias stripping. |
| `tests/gateway/test_slash_access_dispatch.py` | The same gate at the real dispatch site: a non-admin sees only runnable commands, per platform. |
| `tests/gateway/test_slash_command_metrics.py` | Messaging slash commands reach the shared metrics once each, tagged surface `gateway`. |
| `tests/gateway/test_slash_command_profile_scope.py` | Gateway slash commands must do their blocking work inside the routed profile (a bare `run_in_executor` starts with an empty context). |
| `tests/gateway/test_slash_config_writes_routed_profile.py` | Slash-command config writes must land in the routed profile's `config.yaml`, not the launch home. |
| `tests/gateway/test_slash_dispatch_routed_scope.py` | Slash dispatch binds the **routed** profile's runtime scope around every table handler. |
| `tests/gateway/test_sms.py` | The SMS (Twilio) adapter: config, truncation, echo prevention and Twilio signature validation. |
| `tests/gateway/test_split_final_suffix_reconcile.py` | An authoritative final that prefix-extends a **split** delivery reconciles by suffix, not by full resend. |
| `tests/gateway/test_sse_agent_cancel.py` | An SSE client disconnect interrupts the agent and cancels its task, without misclassifying the outcome. |
| `tests/gateway/test_sse_frame.py` | The shared `_sse_frame` encoder reproduces the exact bytes the inline encoders used to emit. |
| `tests/gateway/test_ssl_cert_detection.py` | Gateway imports must not replace the platform trust store with a bundled CA file. |
| `tests/gateway/test_stacked_skill_platform_disabled.py` | A stacked skill slash (`/a /b do X`) re-checks **every** skill against the per-platform disabled list. |
| `tests/gateway/test_stale_base_url_api_mode.py` | A `/model` switch to a custom provider clears the stale `base_url` and persists `api_mode`. |
| `tests/gateway/test_stale_confirmation_expiry.py` | High-risk confirmation text is stripped on resume so the model does not re-execute a destructive action. |
| `tests/gateway/test_stale_finalize_suppression.py` | A stale streamed finalize snapshot must not suppress the complete response (20 cases). |
| `tests/gateway/test_stale_platform_lock_retryable.py` | A stale platform lock is **retryable**; a lock conflict names its owning profile. |
| `tests/gateway/test_stale_self_heal_agent_cache_eviction.py` | The #54878 × #54947 interaction: a dead cached session id is not reused, but a live sibling still shares the agent. |
| `tests/gateway/test_standalone_gateway_launch_scope.py` | A standalone gateway keeps resolving the launch profile's credentials after a hosted room activates the process-wide secret guard. |
| `tests/gateway/test_standalone_injected_config.py` | The runner boundary honours a profile opt-out even for an explicit `--config`. |
| `tests/gateway/test_standalone_send_redaction.py` | A standalone sender's failure envelope never carries vendor secrets to the model. |
| `tests/gateway/test_startup_agent_budget_log.py` | The startup "Agent budget" line reports the budget the turn loop actually enforces. |
| `tests/gateway/test_startup_connect_parallel.py` | Platform connects run concurrently: one slow platform no longer delays every later one. |
| `tests/gateway/test_startup_environment_probe.py` | The boot warm-up primes the local toolchain probe the first prompt build reads. |
| `tests/gateway/test_startup_failed_platform_reports_degraded.py` | A configured platform that fails to start must not let the gateway report a normal run. |
| `tests/gateway/test_startup_launch_profile_hooks_scope.py` | The launch profile's `hooks:` block registers at startup, and a registration failure is a WARNING, not DEBUG. |
| `tests/gateway/test_startup_model_context_warmup.py` | The model-context warm-up resolves the default route's window up front (a blocking catalog probe inside agent construction). |
| `tests/gateway/test_startup_no_eager_platform_install.py` | `_apply_env_overrides` must not lazy-install platform SDKs for platforms the user has not configured. |
| `tests/gateway/test_startup_recovery_parks_profile.py` | A secondary whose durable leftovers cannot be recovered is parked, and every other profile still starts. |
| `tests/gateway/test_startup_restart_race.py` | A startup aborted by a concurrent restart does not start cron or housekeeping. |
| `tests/gateway/test_startup_warmup_logger_offloop.py` | The boot-time warning must not park the loop on `logging.Handler.lock` (a watchdog exit-75 death loop). |
| `tests/gateway/test_startup_warmup_profile_scope.py` | Boot probes run inside the launch profile's scope (a non-production Portal's refresh token was POSTed to production). |
| `tests/gateway/test_startup_watchdog.py` | The startup-liveness watchdog (38 cases): arm/disarm, CPU-progress exemption, leases, and the dump-and-exit path. |
| `tests/gateway/test_static_token_session_mutations.py` | The same verified static token owns the same session on HTTP and WebSocket. |
| `tests/gateway/test_status.py` | Runtime status tracking (93 cases): atomic pid file, runtime lock, per-profile platform entries, writer identity and Windows process guards. |
| `tests/gateway/test_status_command.py` | The `/status` command: token totals from the session DB, live agent model/context, `/agents`, `/tasks` and `/context`. |
| `tests/gateway/test_status_phrases.py` | Status phrases never leak a raw preview or the user's args. |
| `tests/gateway/test_status_strict_identity_live.py` | Strict gateway identity against a **real** process holding `gateway.lock`. |
| `tests/gateway/test_stderr_formatting.py` | Operator-visible gateway stderr formatting includes a timestamp. |
| `tests/gateway/test_steer_command.py` | `/steer` injects into the agent's next tool result without interrupting, and falls back to `/queue` on the pending sentinel. |
| `tests/gateway/test_steer_fifo_overwrite.py` | The `/steer` fallback must not overwrite the FIFO head. |
| `tests/gateway/test_sticker_cache.py` | The sticker-description cache: corrupt file, cache/retrieve, and a name without an emoji ignored. |
| `tests/gateway/test_sticker_cache_off_loop.py` | The sticker cache's `os.replace` (unbounded under filesystem pressure) must not run on the event loop. |
| `tests/gateway/test_stop_chat_scope.py` | `/stop` means "stop what's running in this chat": a thread-sibling miss falls back to the chat scope, authorisation-gated. |
| `tests/gateway/test_stop_claim_race_class.py` | Stop of a queued admission the drain claims mid-stop stops the claim instead of refusing `stale_generation`. |
| `tests/gateway/test_stop_ends_background_delegations.py` | `/stop` ends the session's **background** delegate children too, not only the in-turn ones. |
| `tests/gateway/test_stop_thread_sibling.py` | `/stop` can interrupt a sibling participant's run in a per-user thread, for authorised users only. |
| `tests/gateway/test_stored_picker_routed_sources.py` | The native picker's stored feed lists messaging and cron sessions, not only local labels. |
| `tests/gateway/test_stored_session_picker.py` | The native picker enumerates old transcripts without adopting them on read. |
| `tests/gateway/test_stream_abandon_on_turn_death.py` | A dying turn closes its native stream (a stale generation left the live indicator on forever). |
| `tests/gateway/test_stream_consumer.py` | The stream consumer (52 cases): media directive stripping, edit vs send, segment breaks, overflow splits and final-send suppression. |
| `tests/gateway/test_stream_consumer_continuation_cut.py` | The word-boundary fallback continuation cut: the prefix backs up to the last space or newline. |
| `tests/gateway/test_stream_consumer_draft.py` | Native draft streaming (`sendMessageDraft`): transport selection, fallback, and per-turn draft ids. |
| `tests/gateway/test_stream_consumer_fresh_final.py` | The fresh-final-for-long-lived-previews path: deliver the final as a new message and delete the stale preview. |
| `tests/gateway/test_stream_consumer_hot_reload.py` | New consumer code paired with an old in-memory adapter: the length budget falls back to the legacy `message_len_fn`. |
| `tests/gateway/test_stream_consumer_oversized_leftover.py` | A seal must not leave an oversized leftover on the non-final send lane. |
| `tests/gateway/test_stream_consumer_silence.py` | Streaming intentional-silence suppression, including retracting a partial marker preview. |
| `tests/gateway/test_stream_consumer_thread_routing.py` | The stream consumer passes `reply_to` on the first send and ignores it on subsequent edits. |
| `tests/gateway/test_stream_consumer_tool_progress.py` | Tool-progress lines injected into the native streaming bubble and overwritten by text deltas. |
| `tests/gateway/test_stream_consumer_wecom_native.py` | Native streaming for adapters that cannot edit but expose a cumulative stream protocol (25 cases). |
| `tests/gateway/test_stream_edit_flood_retry_after.py` | A flood-refused streaming edit honours the server's `retry_after` instead of only doubling its own interval. |
| `tests/gateway/test_stream_events.py` | The structured stream-event protocol: typed events decoupled from delivery, with a default rendering. |
| `tests/gateway/test_stream_final_contract.py` | The consumer-declared final contract: `finish(final_text=…)` is authoritative and interim sends never seal. |
| `tests/gateway/test_streaming_tts_consumer.py` | The streaming-TTS consumer and adapter contract (begin/write/finish/abort, duplicate suppression, per-turn isolation). |
| `tests/gateway/test_streaming_tts_gateway_regression.py` | The outer finalisation path must not `NameError` on the streaming-TTS consumer. |
| `tests/gateway/test_strip_markdown_links.py` | `strip_markdown` drops link targets by default and keeps bare URLs when asked. |
| `tests/gateway/test_stt_config.py` | The gateway honours `stt.enabled: false` from `config.yaml`. |
| `tests/gateway/test_stt_transcript_echo_config.py` | STT transcript echo defaults on for backwards compatibility. |
| `tests/gateway/test_stuck_loop.py` | Stuck-session detection: a session active across 3+ consecutive restarts is auto-suspended on startup. |
| `tests/gateway/test_subagent_failure_notice.py` | A dead subagent surfaces as one clean human-readable line (no traceback walls, no silence). |
| `tests/gateway/test_subagent_protection.py` | Sending a message while `delegate_task` runs must not kill the subagent — interrupt demotes to queue. |
| `tests/gateway/test_submit_after_delete_gate.py` | A submit waiting on deletion revalidates the session before staging its input. |
| `tests/gateway/test_suppression_contract_matrix.py` | The final-send suppression contract: suppression requires the **complete** answer on the wire. |
| `tests/gateway/test_surface_admission.py` | HUD / live-voice submit fields survive canonical admission and reach the model as a per-turn note. |
| `tests/gateway/test_swept_bot_chat_fence.py` | A Bot Chat retired by a housekeeping sweep keeps its deletion fence past the retry horizon. |
| `tests/gateway/test_switch_session_keeps_model_override.py` | A `/model` pin belongs to the chat route, not to one session id. |
| `tests/gateway/test_systemd_notify.py` | The optional systemd event-loop watchdog protocol (abstract socket, non-blocking datagram). |
| `tests/gateway/test_systemd_stop_mark.py` | A supervisor-ordered stop exits cleanly instead of logging a failure. |
| `tests/gateway/test_systemd_watchdog_lifecycle.py` | The runner starts the watchdog only after it is running. |
| `tests/gateway/test_table_helpers.py` | The shared GFM table → bullet conversion helpers. |
| `tests/gateway/test_task_card_destination_preflight.py` | Destination eligibility must precede transport failure and its text fallback. |
| `tests/gateway/test_teams.py` | The Microsoft Teams adapter plugin: config, Graph delivery, attachment download, token acquisition and the address gate. |
| `tests/gateway/test_teams_dotenv_isolation.py` | Canaries for Teams SDK import-time dotenv isolation. |
| `tests/gateway/test_teams_pipeline_runtime_wiring.py` | The Teams pipeline runtime wiring is skipped without the MSGraph adapter. |
| `tests/gateway/test_telegram_approval_buttons.py` | Telegram inline-keyboard approval buttons, with UTF-16 budget and escaping. |
| `tests/gateway/test_telegram_audio_vs_voice.py` | Telegram `message.voice` goes to STT; `message.audio` is a file attachment and does not. |
| `tests/gateway/test_telegram_auth_check.py` | Unauthorized users are blocked before any text batching, event building or response generation. |
| `tests/gateway/test_telegram_bot_auth_bypass.py` | Telegram bot-origin authorization, without weakening the human gate. |
| `tests/gateway/test_telegram_callback_auth_fail_closed.py` | The callback authorisation fallback denies by default when the allowlist is empty. |
| `tests/gateway/test_telegram_caption_merge.py` | Caption deduplication: a shorter caption that is a substring is **not** dropped. |
| `tests/gateway/test_telegram_channel_posts.py` | `Update.channel_post` uses `effective_message` so channel broadcasts are not ignored. |
| `tests/gateway/test_telegram_clarify_buttons.py` | Telegram inline-keyboard clarify buttons and the numbered-text fallback. |
| `tests/gateway/test_telegram_closewait_limits.py` | Every PTB client shares the platform SSL context and a tight keep-alive (the general pool leaked CLOSE_WAIT fds). |
| `tests/gateway/test_telegram_closewait_windows_live.py` | Windows live E2E for the CLOSE-WAIT `getUpdates` reconnect fix, against a real half-closed local server. |
| `tests/gateway/test_telegram_cold_boot_queue.py` | The cold-boot pending-queue knob: a cold boot drops Telegram's server-side pending updates unless opted out. |
| `tests/gateway/test_telegram_conflict.py` | Polling-conflict handling: a bounded retry ladder, a webhook cleared before polling, and pending updates preserved on reconnect. |
| `tests/gateway/test_telegram_connect.py` | A missing Telegram token or SDK sets a **non-retryable** fatal error. |
| `tests/gateway/test_telegram_dm_topic_auto_transfer.py` | Telegram `/topic` mode: opt-in root-DM auto transfer with a lobby-recovery fallback. |
| `tests/gateway/test_telegram_documents.py` | Telegram document handling: type detection, download/cache, text injection, size limits and the photo-burst buffer. |

| `tests/gateway/test_telegram_error_redaction.py` | The four remaining unredacted Telegram transport-error sites (the most severe being `connect()`'s fatal path) must not print the bot token. |
| `tests/gateway/test_telegram_fallback_pool_release.py` | The Telegram fallback transport built one `AsyncHTTPTransport` per fallback IP eagerly and never tore them down — a file-descriptor leak. |
| `tests/gateway/test_telegram_final_delivery.py` | Final delivery after a streamed edit failure: the missing tail is delivered, `retry_after` is honoured, and the reply anchor is preserved. |
| `tests/gateway/test_telegram_format.py` | MarkdownV2 escaping and the markdown→MarkdownV2 conversion pipeline, with 46 edge cases around fences, inline code and blockquotes. |
| `tests/gateway/test_telegram_forum_commands.py` | Lazy forum-command registration: once, race-safe, and the command-menu skill scan off the event loop. |
| `tests/gateway/test_telegram_group_gating.py` | 27 cases of group gating: unmentioned observation, multi-bot exclusive mentions, guest mode, topic allowlists and bot-loop breaking. |
| `tests/gateway/test_telegram_image_precompress.py` | Large rasters are converted to progressive JPEG (above 1600 px) before upload, through the real Pillow path with real file I/O. |
| `tests/gateway/test_telegram_inbound_warning_owner.py` | Inbound cache diagnostics use the routed owner before agent admission. |
| `tests/gateway/test_telegram_ingress_delivery_gap.py` | The one signal transport probes cannot give — whether PTB's dispatcher actually handed the fetched updates to a handler — and a once-per-adapter report. |
| `tests/gateway/test_telegram_init_deadline.py` | A thread deadline that abandons the wait, runs cleanup on timeout and dumps diagnostics when the loop is blocked. |
| `tests/gateway/test_telegram_inline_picker.py` | The inline command picker exists because the BotCommand menu is capped; it ranks, paginates and authorizes. |
| `tests/gateway/test_telegram_lazy_install_typehandler.py` | The lazy-install rebind must rebind **every** placeholder symbol, or `TELEGRAM_AVAILABLE` flips while a placeholder stays. |
| `tests/gateway/test_telegram_long_command_batching.py` | A long `/queue <prompt>` paste split by the client must be re-joined, not dispatched as a command plus an orphan continuation. |
| `tests/gateway/test_telegram_max_doc_bytes.py` | The 20 MB `getFile` cap is raised to 2 GB only when a locally-hosted bot API server is configured. |
| `tests/gateway/test_telegram_media_read_timeout.py` | Every media upload uses the longer media-read timeout (the server processes the file before answering). |
| `tests/gateway/test_telegram_mention_boundaries.py` | Mention detection relies on Telegram's `MessageEntity` objects, not a substring check, with UTF-16 offsets. |
| `tests/gateway/test_telegram_mention_context.py` | Multi-bot addressing survives routing into the agent's event without destabilising the session prompt. |
| `tests/gateway/test_telegram_model_picker.py` | The Telegram model picker escapes dynamic provider labels and honours the group callback allowlist. |
| `tests/gateway/test_telegram_network.py` | The fallback transport layer: per-IP routing inside Telegram's own CIDR, sticky IPs, DoH discovery, proxy env and closing every transport. |
| `tests/gateway/test_telegram_network_reconnect.py` | 34 cases of polling recovery: self-scheduling reconnects, bounded pool drains, heartbeat escalation and PTB pool-timeout classification. |
| `tests/gateway/test_telegram_new_topic_opener.py` | A client-created topic whose opener arrives without `message_thread_id` is adopted from the preceding `forum_topic_created` message. |
| `tests/gateway/test_telegram_noise_filter.py` | Gateway noise/secret filtering across chat surfaces: routine compression statuses, provider errors and every credential shape are suppressed. |
| `tests/gateway/test_telegram_overflow_partial.py` | A split edit that fails after some chunks reports the later partial failure. |
| `tests/gateway/test_telegram_pending_update_probe.py` | PTB can report `updater.running == True` while its long-poll is stuck, so `pending_update_count` is watched as the real signal. |
| `tests/gateway/test_telegram_photo_interrupts.py` | A photo sent during a running turn is a follow-up, not a priority interrupt. |
| `tests/gateway/test_telegram_polling_health_confirmation.py` | "Reconnected and healthy" must differ in the log from "reconnected and hung": the first confirmed round-trip emits an INFO. |
| `tests/gateway/test_telegram_polling_progress.py` | Generation-safe polling progress: only a *successful* `getUpdates` records progress. |
| `tests/gateway/test_telegram_polling_stall_watchdog.py` | The stall watchdog for a wedged `getUpdates` long-poll that every other probe reports as healthy. |
| `tests/gateway/test_telegram_prune_stale_topic_binding.py` | A DM topic the user deleted is pruned from the bindings table, so recovery stops proposing it. |
| `tests/gateway/test_telegram_reactions.py` | Message reactions tied to the processing lifecycle hooks, with a profile-scoped configuration read. |
| `tests/gateway/test_telegram_reply_mode.py` | `reply_to_mode` (off/first/all) governs multi-chunk threading, with topic and synthetic-anchor precedence. |
| `tests/gateway/test_telegram_reply_quote.py` | A native partial quote uses the user-selected substring, not the whole replied-to message. |
| `tests/gateway/test_telegram_rich_messages.py` | Bot API 10.1 `sendRichMessage`: raw markdown, legacy fallback, capability latching and token redaction. |
| `tests/gateway/test_telegram_rich_newlines.py` | Rich-message payloads normalise single newlines to Markdown hard breaks. |
| `tests/gateway/test_telegram_send_draft_format.py` | The draft preview must use the same MarkdownV2 rendering as the final send, or the answer visibly snaps at the end. |
| `tests/gateway/test_telegram_send_path_health.py` | After reconnect storms the PTB client can wedge; the send path is short-circuited so cron falls through to standalone HTTP. |
| `tests/gateway/test_telegram_send_reconnect_wait.py` | `send()` waits for the reconnect instead of dropping the final reply (the ledger held the answer until the next boot). |
| `tests/gateway/test_telegram_shared_outbound_budget.py` | `sendMessage` and `editMessageText` share one per-chat rate slot: a send waits, an interim edit is skipped, the final edit is never gated. |
| `tests/gateway/test_telegram_slash_confirm.py` | The slash-confirm card must use `format_message` + MarkdownV2. |
| `tests/gateway/test_telegram_split_send_flood.py` | A split reply under flood control resumes from the undelivered tail — never re-sends the head. |
| `tests/gateway/test_telegram_start_polling_timeout.py` | `start_polling()` is time-bounded; an unbounded call wedged the reconnect ladder and the heartbeat. |
| `tests/gateway/test_telegram_status_indicator.py` | The bot's short description is the closest thing to a presence dot, so it reads "Online"/"Offline". |
| `tests/gateway/test_telegram_status_update.py` | `send_or_update_status` sends fresh first and edits thereafter, with independent keys. |
| `tests/gateway/test_telegram_text_batch_perf.py` | The adaptive text-batch delay never produces NaN/Inf from a float env var. |
| `tests/gateway/test_telegram_text_batching.py` | 21 cases of inbound text aggregation, including a disconnect that holds, re-dispatches and salvages the pending batch. |
| `tests/gateway/test_telegram_text_link_expansion.py` | A `text_link` entity is inlined so the model can actually see the URL, with UTF-16 offsets and idempotence. |
| `tests/gateway/test_telegram_thread_fallback.py` | Topic/thread routing fallbacks: a private DM topic needs both a thread id and a reply anchor, and the fallback fires once. |
| `tests/gateway/test_telegram_topic_mode.py` | 22 cases of private-chat topic mode: lobby transfer, binding heals, compression-tip following and unauthorized refusal. |
| `tests/gateway/test_telegram_topic_profile_isolation.py` | The Telegram topic tables namespace by profile. |
| `tests/gateway/test_telegram_topic_profile_routing.py` | The gateway routes `source.profile` into the Telegram topic state, never a global. |
| `tests/gateway/test_telegram_typing_backoff.py` | A transient typing-indicator failure enters a cooldown; a DM-topic fallback success does not. |
| `tests/gateway/test_telegram_typing_retrigger.py` | The post-send typing re-arm is scheduled off the send path and collapsed per chat (it starved the `getUpdates` long-polls). |
| `tests/gateway/test_telegram_username_chat_id.py` | A `@username` home channel is normalised, not force-cast with `int()`. |
| `tests/gateway/test_telegram_video_metadata.py` | Videos over ~10 MB must carry explicit geometry, duration and a thumbnail, or clients draw a square tile. |
| `tests/gateway/test_telegram_voice_caption_markdown.py` | Voice captions render markdown, with a plain fallback when the Bot API rejects the entities. |
| `tests/gateway/test_telegram_voice_duration.py` | Voice/audio messages carry an explicit duration (Telegram only derives it for short recordings). |
| `tests/gateway/test_telegram_voice_v0_regressions.py` | Voice-note merging during pending STT, the video size gate and the interrupt transcript reuse. |
| `tests/gateway/test_telegram_webhook_secret.py` | GHSA-3vpc-7q5r-276h: webhook mode refuses to start without `TELEGRAM_WEBHOOK_SECRET`. |
| `tests/gateway/test_terminal_commit_crash.py` | A committed result survives an owner SIGKILL without pausing its follower. |
| `tests/gateway/test_text_batch_delay_defaults.py` | Text-batch debounce defaults are clamped to shared ceilings so WhatsApp/Weixin do not hold every reply for seconds. |
| `tests/gateway/test_text_batch_flush_invariants.py` | The base flush owns the disconnect shield and the task-identity check; every adapter that still overrides it is swept for the same contract. |
| `tests/gateway/test_text_batching.py` | Text batching across Discord, Matrix, WeCom and the adaptive delay logic. |
| `tests/gateway/test_thread_tracker_mark_off_loop.py` | The thread-participation tracker's atomic write (unbounded under filesystem pressure) must not run on the event loop. |
| `tests/gateway/test_ticket_profile_scope.py` | An issued interactive ticket keeps its profile scope across sibling selectors. |
| `tests/gateway/test_timestamp_sidecar_replay.py` | Timestamp rendering must not discard the exact sent user-message prefix. |
| `tests/gateway/test_tini_shim.py` | The docker tini shim's argument stripping, tested without Docker via its recording hooks. |
| `tests/gateway/test_title_command.py` | `/title` across the messenger platforms: conflicts, control-char sanitising and topic renames. |
| `tests/gateway/test_tool_log_mode.py` | The `log` tool-progress mode appends to a rotating per-turn logger and keeps the chat silent. |
| `tests/gateway/test_tool_response_drop_recovery.py` | A non-empty answer that the extract pipeline reduces to an empty string must still be sent (it used to vanish silently). |
| `tests/gateway/test_transcript_offset.py` | The gateway transcript lost one message per turn because `session_meta` rows were counted in the offset. |
| `tests/gateway/test_transcript_read_failure.py` | A failed transcript read must not masquerade as an empty history; the slash handlers must answer "history unreadable". |
| `tests/gateway/test_transient_failure_transcript.py` | A transient 429/timeout must not drop the user's message from the transcript (only a context overflow may). |
| `tests/gateway/test_tts_media_routing.py` | Cross-platform audio/voice media routing, and queued-follow-up delivery that strips the MEDIA tag from the text. |
| `tests/gateway/test_tui_approval_redaction.py` | The TUI JSON-RPC transport is the third egress for approval prompts; it must redact the command too. |
| `tests/gateway/test_tui_busy_default.py` | A TUI session with no explicit busy mode reports main's TUI default `queue`; every other surface keeps `interrupt`. |
| `tests/gateway/test_tui_detach_end_stamp.py` | The TUI's close stamps the row with main's `end_reason`, and only when no other viewer remains. |
| `tests/gateway/test_tui_session_reads.py` | `/status`, `/context` and `/cron` on a local TUI session read as main's TUI sidecar did. |
| `tests/gateway/test_tui_slash_worker_path.py` | A minimal inherited `PATH` must not break the spawned worker's ability to resolve Hermes-managed CLIs. |
| `tests/gateway/test_turn_context.py` | The `TurnContext`/`TurnRunner` seam: the closure bodies moved byte-identically onto methods, with each closed-over local as a field. |
| `tests/gateway/test_turn_lease.py` | The per-session turn lease serializes [load history → run → flush] per **resolved** session id, closing the alias-key overlap. |
| `tests/gateway/test_turn_pool_unbounded.py` | An accepted turn must never queue behind other turn bodies on the turn pool (a finite 10-thread pool starved the user's next message for minutes). |
| `tests/gateway/test_turn_request_overrides.py` | A custom provider's `request_overrides` survive the per-turn agent config; the gateway used to rebuild the runtime from a fixed key whitelist. |
| `tests/gateway/test_turn_result_retention.py` | A turn result retains only the turn's own output. |
| `tests/gateway/test_typing_indicator_toggle.py` | A per-platform `typing_indicator` toggle gates the refresh loop without affecting delivery. |
| `tests/gateway/test_unauthorized_dm_behavior.py` | 16 cases of unauthorized-DM behaviour: pairing by default, silence with an allowlist, and the per-platform allowlist matching. |
| `tests/gateway/test_unauthorized_sender_notices.py` | The pairing DM tells a stranger what happens next; an ignored DM stays silent toward the stranger while the owner gets the approve command. |
| `tests/gateway/test_unavailable_skill_hint.py` | The unavailable-skill hint matches the frontmatter slug, not the directory name (~19 skills were mis-hinted). |
| `tests/gateway/test_undo_rewind_session.py` | `/undo [N]` soft-deletes truncated rows and fails closed when the transcript changes after the snapshot. |
| `tests/gateway/test_unified_gateway_native_live.py` | A native live proof of the unified gateway runtime on the current host OS: discovery, tickets, FIFO, hard-kill recovery exactly once. |
| `tests/gateway/test_unified_runtime_init_multiplex.py` | The unified runtime's init path builds per-profile registries, not process-wide ones. |
| `tests/gateway/test_unknown_automation_settles.py` | An `unknown` admission nobody is waiting on settles as interrupted; a person's unknown turn still pauses the FIFO. |
| `tests/gateway/test_unknown_command.py` | An unrecognized slash command returns guidance instead of being forwarded to the model as plain text. |
| `tests/gateway/test_unknown_receipt_boundaries.py` | A discard-closure failure keeps the unknown fence and the retry is exact. |
| `tests/gateway/test_unknown_resolution_physical_worker.py` | Resolving an unknown admission also retires its physical worker assignment. |
| `tests/gateway/test_unmanaged_idle_exit.py` | An auto-started gateway exits once idle and publishes why; anything it serves keeps it up. |
| `tests/gateway/test_unserve_release_order.py` | Unserve releases a profile's `gateway.lock` only after its handles in that home close. |
| `tests/gateway/test_unviewed_completion_notes.py` | An unviewed local completion becomes a note through the gateway FIFO, never a lost or early one. |
| `tests/gateway/test_update_command.py` | `/update`: 20 cases of argv resolution, pending markers, deferred notification and platform-fallback discovery. |
| `tests/gateway/test_update_cron_drain.py` | The update path must drain in-flight cron jobs before `process_registry.kill_all()`. |
| `tests/gateway/test_update_streaming.py` | `/update` live streaming, prompt forwarding and the file-based gateway IPC. |
| `tests/gateway/test_upstream_native_admission.py` | An adapter that declares `authorization_is_upstream` is admitted without a principal allowlist; every other adapter default-denies. |
| `tests/gateway/test_usage_command.py` | `/usage` prefers the running agent, then the cached agent, then the persisted route. |
| `tests/gateway/test_used_delete_restart.py` | A real daemon delete/restart: the history disappears and exact authorised retries survive. |
| `tests/gateway/test_verbose_command.py` | `/verbose` is config-gated and cycles the tool-progress mode. |
| `tests/gateway/test_video_context_note.py` | A video attachment gets a path note, not a document note. |
| `tests/gateway/test_viewer_close_lifecycle.py` | 18 cases of the end-of-conversation lifecycle: the last viewer close commits memory and finalizes the session exactly once. |
| `tests/gateway/test_vision_memory_leak.py` | The auxiliary vision LLM's echo of the system-prompt memory context is stripped before the description reaches the user. |
| `tests/gateway/test_vision_preprocess.py` | Vision pre-processing merges the analysis with the user text without an output cap. |
| `tests/gateway/test_voice_command.py` | 55 cases of `/voice` and auto voice reply: TTS, silence detection, Discord voice channels and playback timeouts. |
| `tests/gateway/test_voice_mode_platform_isolation.py` | Voice-mode state is namespaced by platform (Telegram chat `123` and Slack chat `123` shared a key). |
| `tests/gateway/test_voice_transcode.py` | `[[audio_as_voice]]` works for every audio format through a shared `transcode_to_ogg_opus`. |
| `tests/gateway/test_voice_transcript_dedup_scope.py` | Voice-transcript dedup belongs to the bot that heard the utterance and the conversation it is bound to. |
| `tests/gateway/test_wake_delivery.py` | Background wake delivery: push-capable adapters keep the event path; the stateless API server self-POSTs with the raw session id. |
| `tests/gateway/test_warning_delivery_real_producers.py` | Actual adapter producers with only the vendor transport and pacing clocks replaced. |
| `tests/gateway/test_warning_emission_boundary.py` | The shared channel-warning boundary preserves the transport receipt and the input metadata. |
| `tests/gateway/test_warning_notification_contracts.py` | Diagnostic suppression preserves real producer outcomes and the control paths. |
| `tests/gateway/test_warning_notifications.py` | Warning delivery is independent of normal replies and of the operational state. |
| `tests/gateway/test_warning_notifications_transport.py` | Real native/relay send paths and a profile-scoped effective warning policy. |
| `tests/gateway/test_warning_render_boundary.py` | UI sink gating never suppresses the producer nor interprets its return value. |
| `tests/gateway/test_warning_wiring_conservation.py` | Actual per-turn wiring retains observers before the presentation scope binds. |
| `tests/gateway/test_watch_automation_identity.py` | Distinct pattern hits must not collapse into one completion identity. |
| `tests/gateway/test_watch_notification_reset_pin.py` | A watch notice pinned to a session that ended at `/new` is dropped, not requeued forever. |
| `tests/gateway/test_watchdog_review.py` | Activity-write budget, watchdog pre-delivery revalidation and the import/export activity asymmetry. |
| `tests/gateway/test_weak_credential_guard.py` | Known-weak placeholder tokens are rejected at gateway startup instead of failing silently against the platform API. |
| `tests/gateway/test_webhook_adapter.py` | The generic webhook adapter: HMAC validation (GitHub/GitLab/Svix/generic), prompt templates, event filters, idempotency and rate limits. |
| `tests/gateway/test_webhook_authority.py` | Signed TCP ingress must not acknowledge an uncommitted input. |
| `tests/gateway/test_webhook_coalescing.py` | Per-route webhook event coalescing: rapid same-entity events debounce into one run on the latest state. |
| `tests/gateway/test_webhook_cron_trigger.py` | The `cron_job` route mode fires an existing job through the same claimed-run body a manual run uses. |
| `tests/gateway/test_webhook_deliver_only.py` | `deliver_only` routes push plain text to a chat **without invoking the agent**. |
| `tests/gateway/test_webhook_durable_destination.py` | Admission owns the exact destination, never process-local send state. |
| `tests/gateway/test_webhook_dynamic_routes.py` | Dynamic route loading, with an empty secret rejected and a missing secret inheriting the global. |
| `tests/gateway/test_webhook_filter_interpreter.py` | Webhook filter scripts run under the Git-Bash-safe interpreter and a silent non-zero exit is logged. |
| `tests/gateway/test_webhook_finalization_recovery.py` | Settled webhook admissions remain closeable without repeating their turn. |
| `tests/gateway/test_webhook_integration.py` | End-to-end: a GitHub PR webhook triggers the agent and delivery routes cross-platform. |
| `tests/gateway/test_webhook_mcp_events.py` | MCP event routes: the verification challenge is echoed without a run, control envelopes update the route, and occurrences dedupe by `eventId`. |
| `tests/gateway/test_webhook_offloop_delivery.py` | A 30-second `gh` subprocess must not freeze the entire gateway event loop. |
| `tests/gateway/test_webhook_profile_egress.py` | Webhook egress under multiplex stays bound to the routed profile; a default-bound route never borrows a secondary's adapter. |
| `tests/gateway/test_webhook_replay_scope.py` | Webhook replay/credential invariants the durable ledger does not cover. |
| `tests/gateway/test_webhook_route_toolsets.py` | Per-route webhook toolset overrides, validated through the same path as platform config. |
| `tests/gateway/test_webhook_session_close.py` | A late webhook finalizer cannot end a replacement route or generation. |
| `tests/gateway/test_webhook_signature_rate_limit.py` | HMAC validation happens **before** rate limiting, so an attacker cannot exhaust a victim's quota. |
| `tests/gateway/test_webhook_startup_restore_admission.py` | An admission the authority is executing is never parked by the startup-restore gate. |
| `tests/gateway/test_wecom.py` | 51 cases of the WeCom adapter: media typing, scoped credentials, proactive/passive sends, task merging and the `req_id` cache. |
| `tests/gateway/test_wecom_callback.py` | WeCom callback mode: crypto round-trip, app selection per scoped chat id, token refresh on `errcode 40001` and body size limits. |
| `tests/gateway/test_wecom_double_send.py` | A timeout inversion between the consumer's finalize ack and the gateway's join produced a duplicate bubble. |
| `tests/gateway/test_wecom_per_turn.py` | Per-turn stream isolation: concurrent users, concurrent turns in one chat and per-turn expiry. |
| `tests/gateway/test_wecom_stream_dup_fix.py` | Toggle-validated behaviour contracts for the WeCom duplicate-bubble fix (the assertions track behaviour, not a snapshot). |
| `tests/gateway/test_weixin_plugin.py` | 33 cases of the Weixin adapter: formatting, split rules, token persistence off the loop, retries and the rate-limit circuit. |
| `tests/gateway/test_weixin_secret_scope.py` | Weixin credential reads follow the Slack pattern: a scoped miss never borrows from `os.environ`. |
| `tests/gateway/test_weixin_typing.py` | WeChat iLink typing-ticket refresh logic. |
| `tests/gateway/test_weixin_voice_warning_policy.py` | A voice downgrade diagnostic is optional; the actual attachment is not. |
| `tests/gateway/test_whatsapp_allowlist_lid_resolution.py` | WhatsApp delivers senders in LID form while operators configure phone numbers; the allowlist must resolve the alias. |
| `tests/gateway/test_whatsapp_bridge_dir_resolution.py` | A read-only install tree mirrors the bridge source into a writable `HERMES_HOME` location. |
| `tests/gateway/test_whatsapp_bridge_pidfile.py` | The stale-bridge cleanup must never kill a stranger (the kernel recycles PIDs). |
| `tests/gateway/test_whatsapp_cloud.py` | 48 cases of the WhatsApp Cloud API adapter: Graph send, the verify-token handshake, signature validation and media. |
| `tests/gateway/test_whatsapp_cloud_allowed_users.py` | The documented `WHATSAPP_CLOUD_ALLOWED_USERS` env vars must actually drive the DM intake gate. |
| `tests/gateway/test_whatsapp_connect.py` | 17 cases of `connect()` error handling: an uninitialised `data` NameError, bridge log leaks, lock release and Windows taskkill safety. |
| `tests/gateway/test_whatsapp_formatting.py` | WhatsApp formatting and chunking, with room reserved for the bridge's self-chat prefix. |
| `tests/gateway/test_whatsapp_from_owner.py` | Owner-message metadata is lifted onto the event and tagged once. |
| `tests/gateway/test_whatsapp_group_allowlist_env.py` | The WhatsApp adapter never read `WHATSAPP_GROUP_ALLOWED_USERS`; config key presence wins, then the scoped env. |
| `tests/gateway/test_whatsapp_group_gating.py` | 12 cases of group gating: require-mention, regex wake words, free-response chats and broadcast filtering. |
| `tests/gateway/test_whatsapp_identity.py` | Alias resolution on the modern WhatsApp platform layout. |
| `tests/gateway/test_whatsapp_media_path_profile.py` | The inbound-media path validator follows the active profile override instead of an import-time constant. |
| `tests/gateway/test_whatsapp_multiplex.py` | Profile-local WhatsApp credentials and a non-destructive secondary startup (port ownership verdicts). |
| `tests/gateway/test_whatsapp_multiplex_secret_scope.py` | `WHATSAPP_*` reads must go through the profile secret scope or the bridge silently falls back to `self-chat`. |
| `tests/gateway/test_whatsapp_native_delivery.py` | Invisible Unicode prefixes are sanitised and a location posts to the bridge's location endpoint. |
| `tests/gateway/test_whatsapp_reply_prefix.py` | `reply_prefix` and `send_read_receipts` bridge from `config.yaml` into the adapter and the bridge subprocess. |
| `tests/gateway/test_whatsapp_stale_bridge.py` | A long-lived bridge must be restarted when the read-receipt config changed, not adopted forever. |
| `tests/gateway/test_whatsapp_text_batching.py` | Text-debounce batching reads its delays from `config.extra`, not env vars. |
| `tests/gateway/test_whatsapp_to_jid.py` | Every outbound target is rewritten to `<digits>@s.whatsapp.net` (Baileys' `jidDecode` crashes on a bare number). |
| `tests/gateway/test_windows_venv_import_guard.py` | The Windows venv overlay is blocked for a committed generation and for an unknown/foreign ABI. |
| `tests/gateway/test_worker_admission_reservation.py` | Owner-issued admission reservations never weaken idle public registration; fingerprints survive a clock step. |
| `tests/gateway/test_worker_agent_execution.py` | An unmocked worker `AIAgent` over loopback inference persists its context usage and releases the lease. |
| `tests/gateway/test_worker_compression_admission.py` | Admission-backed automatic compression retains the retry identity and the FIFO. |
| `tests/gateway/test_worker_compression_execution.py` | Real compression with a real registered worker and the ordinary owner transport. |
| `tests/gateway/test_worker_delegation_bridge.py` | The authenticated worker ledger bridge publishes committed owner events and rejects a second principal. |
| `tests/gateway/test_worker_delegation_receipts.py` | Ledger retry durability shares the worker sequence and the epoch boundary. |
| `tests/gateway/test_worker_ledger_tool_execution.py` | A real tool-enabled worker never opens the canonical database. |
| `tests/gateway/test_worker_lifecycle_execution.py` | A worker lifecycle followed by an owner successor refuses the late mutations. |
| `tests/gateway/test_worker_persistence.py` | A separate worker survives an owner restart without repeating the tool call. |
| `tests/gateway/test_worker_register_restriction.py` | `worker.register` requires the worker-adoption capability a launched worker's ticket carries. |
| `tests/gateway/test_worker_rotation_adoption.py` | A rotated agent survives an owner kill and an explicit adoption. |
| `tests/gateway/test_worker_rotation_execution.py` | A full agent-worker rotation continues inference without the canonical database. |
| `tests/gateway/test_ws_auth_retry.py` | The Mattermost WS loop stops reconnecting on a 401/403 instead of looping forever. |
| `tests/gateway/test_ws_auth_retry_verifier_probe.py` | Adversarial verifier probes for the 401-classify fix's boundary cases. |
| `tests/gateway/test_ws_dial_happy_eyeballs.py` | Cold-start WebSocket dials race IPv6/IPv4 (a blackholed AAAA record burned the full connect timeout). |
| `tests/gateway/test_yolo_command.py` | `/yolo` is session-scoped: a launch revocation survives the next turn, a restart, and a session boundary. |
| `tests/gateway/test_yolo_launch_tristate.py` | Routing entries nobody toggled follow the `--yolo` launch policy; only an explicit OFF revokes it. |
| `tests/gateway/test_yolo_restart_revocation.py` | An explicitly revoked `--yolo` launch stays off in a fresh gateway interpreter. |
| `tests/gateway/test_yuanbao_forwarded_heartbeat.py` | The loading heartbeat was a coroutine that was never awaited, so the slow inbound path never sent it. |
| `tests/gateway/test_yuanbao_integration.py` | Yuanbao module integration: adapter init, the `Platform` enum, connected-platform logic and eviction. |
| `tests/gateway/test_yuanbao_markdown.py` | The Yuanbao markdown chunker: fences, tables, sentence and Chinese sentence boundaries. |
| `tests/gateway/test_yuanbao_media_ssrf.py` | `download_url` is SSRF-guarded against cloud-metadata and loopback endpoints. |
| `tests/gateway/test_yuanbao_pipeline.py` | 48 cases of the inbound middleware pipeline: decode, dedupe, skip-self, group/DM routing and the pairing policy. |
| `tests/gateway/test_yuanbao_plugin_registration.py` | Yuanbao ships as a bundled platform plugin: registry entry shape and no core wiring left. |
| `tests/gateway/test_yuanbao_proto.py` | 20 cases of the Yuanbao protobuf wire format: varint, conn/biz layers, text and file elements. |
| `tests/gateway/test_yuanbao_reconnect_set_active.py` | After a WS reconnect the active singleton must be restored (it stayed `None` until a full restart). |
| `tests/gateway/test_yuanbao_secret_scope.py` | Yuanbao's `dm_policy`/`group_policy`/allowlist reads honour the active profile's secret scope. |
| `tests/gateway/test_yuanbao_shutdown.py` | A non-responsive Yuanbao WS server must not stall the gateway shutdown (the close await is bounded). |


---

## 2. Ideas worth stealing for August Trading

### 2.1 The delivery-obligation ledger (`tests/gateway/test_delivery_ledger.py`, `test_delivery_ledger_producer.py`)

Hermes records a **durable obligation** for every outbound reply *before* the send is awaited,
then moves it through `pending → attempting → delivered/failed`, and a startup sweep redelivers
what a dead owner left behind. The docstring is explicit about the honesty rule
(`test_delivery_ledger.py:1-10`):

> pending rows redeliver plainly (send never started, no dup risk);
> attempting/failed rows carry the recovered-reply marker (**honest at-least-once; ambiguity is
> labeled, never silently resent**);
> rows owned by a LIVE process are never claimed;
> poison rows abandon at the attempts cap / stale cutoff.

`test_delivery_ledger_producer.py` pins the ordering that makes this work: the obligation is
recorded *before* the send await, so a crash between "sent" and "recorded" is impossible; a
ledger failure never blocks the send. `test_delivery_ledger_single_connection.py` adds a detail
most implementations miss — the retention prune must run **inside** the recording transaction
rather than on a second connection, or the two connections race.

**Steal this** for August Trading's trade-log writes and provider calls. A trade-log row that
was "sent to the broker" but whose local write failed is exactly the ambiguous case. Hermes'
answer — a durable row with a *labelled* ambiguity and a recovery sweep — is strictly better
than a `try/catch` that logs and forgets.

### 2.2 Failure modes named as tests, with the incident number in the docstring

Almost every file opens with a defect report: a GitHub issue number, a date, a platform and a
one-line symptom. Examples:

- `test_turn_pool_unbounded.py`: "A turn body holds its executor thread for the whole turn
  (every tool call blocks). With a finite pool (it was 10 threads), a burst of turns after a
  restart … filled it, and every later turn, including the user's next message, waited in the
  executor queue for minutes **with no log line naming the wait**."
- `test_owner_loop_writes_class.py` exists purely to kill a bug *class*: "a synchronous SQLite
  write reached from an `async def` on the owner loop."
- `test_stream_consumer.py` (52 cases) is a catalogue of streaming-edge cases: "a failed head
  send yields the loop instead of spinning"; "mid-stream edit success does not mark content
  delivered".

**Steal the naming discipline**: when August Trading finds a bug, the regression test's name
should be the *symptom the user saw*, not the function that was wrong. `test_turn_pool_...`
says "your message was stuck"; `test_api_runs_admission_storage_error.py` says "the request
returned a 503 and a retry ran the work anyway". Symptom-named tests survive refactors;
function-named tests become lies.

### 2.3 The "collection-time AST guard" (`tests/gateway/conftest.py`)

Hermes does not *review* for a banned import pattern; it **fails collection** with a pointer to
the sanctioned helper. The same idea appears in
`test_gateway_utf8_encoding.py` (every `read_text`/`write_text` must pass an explicit
`encoding=`) and `test_relay_sheds_crypto.py` (the relay package must contain *no* signature
verification, asserted by scanning the package).

**Steal this for August Trading**: a lint-style *test* that scans the source tree for a
forbidden pattern. The `docs/plan/full-audit.md` evidence and the `check-flow-doc-anchors`
gate are the same idea; a source-scanning test would catch a whole class at CI time, with a
message that names the sanctioned alternative.

### 2.4 A shared, per-profile "scope" as the unit of isolation

Roughly 80 files in this shard are about **one** invariant: the code that runs for profile B
must not read profile A's credentials, config, home, or personality. The mechanism is a
context-var scope; the failure mode is always the same shape — *a background thread, an
executor hop, a shutdown hook, or a `run_in_executor(None, ...)` starts with an EMPTY
context*, so it silently falls back to the launch profile.

Representative pins:

- `test_slash_command_profile_scope.py`: "a bare `loop.run_in_executor(None, ...)` starts the
  worker with an EMPTY context, so `SessionDB()` / `get_hermes_home()` inside the worker resolve
  the LAUNCH home".
- `test_shutdown_teardown_profile_scope.py`: "Shutdown runs on the main loop outside any adapter
  handler, so its executor hop carried an EMPTY scope and a secondary profile's
  `get_secret(...)` failed closed — the end-of-session commit was skipped and logged as a
  WARNING."
- `test_housekeeping_profile_scope.py`: "The housekeeping thread has no turn on the stack, so
  nothing bound a profile for it."

**Steal this**: August Trading's provider configs and API keys are per-profile/per-seat already,
but any *background* work (housekeeping, compaction, export, backup) must re-establish the
scope explicitly rather than inherit it. The August `AGENTS.md` even names the same hazard in a
different place ("Two writers to one ref is sometimes correct and always needs a comment").

### 2.5 Off-loop discipline, stated as a *class* of test

There is a whole family here: `test_owner_loop_writes_*` (5 files), `test_owner_loop_writes_a2a_hosted_create.py`,
`test_settlement_off_loop.py`, `test_thread_tracker_mark_off_loop.py`, `test_sticker_cache_off_loop.py`,
`test_shutdown_kill_off_loop.py`, `test_ingress_admission_off_loop.py`,
`test_native_media_capture_off_loop.py`, `test_webhook_offloop_delivery.py` (a 30 s `gh`
subprocess froze the whole event loop), `test_slash_command_profile_scope.py`.

The recurring shape: **a blocking call reached from an `async def` on the shared loop**. The
repo's answer is a named test family, so a new one is impossible to add without noticing the
pattern.

**Steal this**: August Trading has a real version of this — `services/analysis/monteCarlo.worker.ts`
was moved to a Web Worker precisely because of it, but nothing prevents the next
`await fs.writeFile()` from stalling the UI. A `tests/noBlockingIoInAsync.test.ts` that greps
for the banned patterns (or a runtime guard) would make the rule enforceable.

### 2.6 Bounded, labelled degradation instead of silent success

Hermes has a hard rule that a *decline* must not collapse into a *failure*, because failure is
the cue for a fallback lane. `test_prompt_decline_no_fallback.py` (12 cases) pins it: "a
decline collapsed into `failed` — which is precisely the cue to run the plain-text fallback
into the chat the connector had just refused." The same distinction appears in
`test_approval_send_timeout_ambiguity.py` (a timeout is *ambiguous*, not a failure) and
`test_relay_ack_ambiguity.py`.

**Steal this**: in August Trading, a provider "partial fill" is not an error, and a
"rejected" is not a "timed out". A trade-log row whose outcome is one of
`filled | partial | rejected | ambiguous | expired` with a defined next action per value is
directly modelled on this.

### 2.7 The "state machine with a legal transition set" as the unit of design

`test_delivery_ledger.py` tests a *state machine* (pending/attempting/delivered/failed) with an
attempts cap, a stale cutoff, retention and id stability. `test_bot_receipt_refusal.py` tests
the same shape for bot receipts. `test_hosted_room_driver.py` tests a "lease, fencing,
idempotent task admission, indeterminate recovery" driver. `test_session_mutation_*` (16
files) treat every session operation as a transaction with a receipt, a revision fence and an
exact-retry contract.

**Steal this**: model August Trading's *trade lifecycle* (proposed → validated → submitted →
partially filled → closed → archived) as one explicit state machine with a legal-transition
table and an attempts cap, and test the table rather than the functions. The existing
`services/validation/` gate scoring and `outcomeEngine` are already half-way there.

### 2.8 The "exact retry" contract (`Idempotency-Key` family)

`test_api_request_one_target.py`, `test_api_idempotency_namespace.py`,
`test_api_idempotency_after_delete.py`, `test_api_responses_stream_retry.py`,
`test_webhook_durable_destination.py` and ~20 more implement one contract: an idempotency key
names **one** admission, a changed body under an in-flight key is refused, a settled key
replays the recorded result, and a deleted session's key is a *tombstone* that costs the
client a re-key, not a re-run.

**Steal this**: an August "submit trade" action that a user can double-tap (or a retry after a
timeout) must be exactly-once. A client-generated idempotency key stored with the trade row,
plus a tombstone on delete, is the same shape.

### 2.9 The "every adapter agrees" parity sweep

`test_access_policy_mixin.py` replaces five hand-copied allow/deny predicates with one mixin
and then asserts that *every* adapter agrees. `test_platform_connected_checkers.py` asserts
every platform has a connection checker. `test_text_batch_flush_invariants.py` pins the base
flush contract and then *sweeps every adapter that still overrides it*.
`test_embedded_media_alias_safety.py`-style checks appear throughout.

**Steal this**: August Trading has one provider abstraction but the same setting is read in
several places (Electron main, the Vite dev proxy, the renderer). A parity test that asserts
each surface resolves the *same* policy object would have caught the drift the AGENTS.md warns
about ("a second implementation is how the numbers drift apart").

### 2.10 The "exhaustive contract table" test

`test_platform_toolset_compatibility.py`-style matrices, `test_suppression_contract_matrix.py`,
`test_buzz_thread_topology.py` and the `test_media_cache.py` "per-adapter parity spot-checks
that hardcode each adapter's historical mappings as the contract" are **tables, not examples**.

**Steal this**: August Trading's provider request policy (thinking gates, temperature, URL
host policy — currently one `shared/providerRequestPolicy.cjs`) could carry a table-driven
test that asserts the full matrix (provider × feature) in one place, so adding a provider
forces a decision rather than a default.

### 2.11 The incident-flavoured docstring as living documentation

The docstrings read like post-mortems. Two standouts:

- `test_telegram_group_gating.py`'s sibling `test_cron_drain_floor.py` (read in full):
  "`restart_drain_timeout` defaults to `0`, and the drain applied that single budget to every
  class of in-flight work. That default is deliberate for chat turns — the user is told the
  gateway is restarting and the session is pre-marked resume_pending, so interrupting one is
  cheap and recoverable — but a cron run has neither property: it is written to jobs.json as a
  permanent failure that nobody is waiting on."
- `test_delivery_ledger.py`: "honest at-least-once; ambiguity is labeled, never silently resent".

**Steal this**: the *why* belongs next to the assertion, in the test that pins it, not in a
PR description that nobody reads a year later. August's `AGENTS.md` already does this at file
level; doing it at *case* level is the upgrade.

### 2.12 A "read the world" seam that makes the whole tree testable

`tests/gateway/restart_test_helpers.py` builds a `GatewayRunner` with `object.__new__` and
re-binds ~30 private methods from the class, so a test can drive **production** drain code
without the constructor's side effects. `tests/gateway/conftest.py` similarly provides
`make_async_session_db` and `_FakeEnumMember`.

**Steal this**: in August Trading, a `tests/harness/runnerHarness.ts` that constructs the real
`App`/service graph with a stubbed `Preferences`/`SQLite` and *real* production methods would
let the next 500 tests be behaviour tests rather than mock-shape tests.

### 2.13 "Two writers to one ref" and other in-repo rules as tests

`test_conversation_scope_funnel.py` exists because "four 'boundary X forgot dict Y' bugs" —
the fix was to make `_clear_conversation_scope` the ONE funnel, and the test pins that every
per-session dict is registered in one place. This is the "canonical single-source module"
discipline the August `AGENTS.md` already states, expressed as an executable assertion.

**Steal this**: for each of August's canonical modules (`utils/riskReward.ts`,
`utils/runStatus.ts`, `utils/turnStatus.ts`, `utils/harnessMarks.ts`, `utils/memoryBudget.ts`),
a test that *scans the source* for any second implementation of the same rule. The `AGENTS.md`
lists the modules; the scan makes the list self-enforcing.

---

## 3. Trading-relevant findings

### 3.1 The trade log is the delivery ledger, and it should be the same object

Hermes' ledger is the closest analogue in the reference set to a trade log: a durable row per
outbound *action* (not per conversation), a state machine, a recovery sweep on boot, and an
explicit "ambiguous" state. For a broker integration, the same table answers the question the
August journal currently cannot: *did my order actually reach the broker?*

### 3.2 A "clock-step" and "recycled PID" paranoia that applies to order idempotency

`test_worker_admission_reservation.py` asserts "process fingerprints survive a clock step on
macOS" and "process birth is create time where psutil applies — no reference to the process
list". `test_host_rendezvous.py` proves a recycled PID is not the owner. `test_whatsapp_bridge_pidfile.py`
refuses to kill a stranger. For trading, the analogue is a **client order id**: it must be
unique across a broker's retention window and across a client clock change, and it must never
be derived from a timestamp.

### 3.3 "Exactly one writer" is an invariant, and it is violated in the most natural way

`test_telegram_network.py` names a bug class the whole shard keeps hitting: *two subsystems
that each believe they own the same state*. In trading terms: the trade journal and the broker
reconciler must not both write a position row. Hermes solves it with a single owner
(`SessionAuthority`) plus fenced generations — `test_session_mutation_rpc.py` ("competing
viewers must not overwrite a newer metadata revision").

### 3.4 Backpressure and queue caps are product decisions, not engineering details

`test_admission_queue_cap.py` caps a session's durable FIFO; `test_admission_queue_cap_notice.py`
turns the cap into a plain `queue_full` notice rather than a turn error;
`test_bot_door_message_cap.py` caps a relayed bot DM but admits a trusted producer's report
whole. For a trading app, the equivalent is: how many analysis requests may be queued for a
symbol before the user is told, and which producers bypass the cap. Deciding this *explicitly*
is what the test forces.

### 3.5 Scheduled work needs its own drain budget

`test_cron_drain_floor.py` (read in full) is the single most transferable file in the shard for
August's `services/automation/` (cron + run history). The insight: **a chat turn and a
scheduled run are different kinds of work** and must not share one interruption budget. A
scheduled run has nobody waiting on it, it is written to disk as a permanent failure, and a
recurring job simply skips to its next schedule — so interrupting it cheaply is wrong, but
waiting forever is also wrong, and the fix is a *separate floor clamped to the watchdog leash*.
August's automation runner has exactly one `restart_drain_timeout`-like concept today.

### 3.6 Memory pressure must shed work, but never the wrong work

`test_agent_cache_pressure.py` (read in full) pins a cgroup-derived budget, and three
invariants: **a mid-turn agent is never evicted**, the most-recently-used sessions are
protected, and a session whose transcript has not finished reaching disk is never shed. The
auto budget must also leave headroom below the cgroup limit, because hitting `memory.high` is
what makes the shutdown flush time out in the first place. August's `utils/memoryBudget.ts`
has soft/trigger/hard byte caps for the *notebook*; it has no equivalent for the in-memory
analysis state.

### 3.7 Reconnection health is a first-class signal, not a boolean

`test_telegram_polling_stall_watchdog.py` and `test_telegram_send_path_health.py` describe a
state in which the transport looks healthy (`get_me()` works, `updater.running` is true) but
the **delivery path** is wedged. The repo's answer is a separate "send path degraded" signal
that changes the behaviour (fall through to a different transport) and a stall watchdog keyed on
*observed progress*, not on liveness. For August Trading: a provider that answers `/models`
but has wedged `/chat/completions` is the same failure, and the app's "provider healthy" badge
is not evidence.

### 3.8 Redaction is a boundary, applied at every egress

`test_telegram_error_redaction.py` closes the four remaining sites where a raw exception could
print a bot token; `test_approval_prompt_redaction.py` redacts the command before it reaches a
chat; `test_tui_approval_redaction.py` covers the third egress; `test_managed_worker_stderr_log.py`
redacts a worker's stderr into a size-capped private log. August's `services/providers/GenericProviderService.ts`
has `toFriendlyProviderError`, but a trade log or screenshot could still capture a raw body.

---

## 4. Non-obvious decisions and gotchas (the things a skim would miss)

1. **The tests ARE the architecture document.** 1,689 files, each named after a *defect*, mean
   the gateway's real design is: one durable FIFO per session, one authority, one owner per
   profile, one delivery ledger, and a strict separation between "admitted" and "executed".
2. **`object.__new__(GatewayRunner)` + re-bound methods** is the sanctioned way to test a
   class with an expensive constructor. It means the tested code is the *production* code path,
   not a re-implementation. (August's own `AGENTS.md` says "Unit tests cannot see the
   transcript" — this is the pattern for testing the *orchestration* without jsdom's blind
   spots.)
3. **A test file that fails to collect is a hard failure with a pointer**, not a skip.
   `conftest.py` refuses to let the plugin-adapter anti-pattern through, and the reason
   (`sys.modules["adapter"]` racing) is a *real* production-shaped bug.
4. **"Empty" is a decision, not a default.** `resolve_agent_cache_bounds({})` must leave the
   bounds *unset* so the runner keeps its defaults; `protect_recent: 0` means "shed anything"
   and is distinct from "unset". August's config bridges have the same hazard.
5. **A "cap" needs a floor.** `restart_drain_timeout: 0` is legitimate for chat and wrong for
   cron. Any budget a user can set to zero needs a per-class floor.
6. **Ambiguity is a first-class outcome**, distinct from success and failure, in four
   different families: send outcomes, approval prompt sends, relay acks and admission writes.
7. **The recovery sweep must not claim work a live process owns** — and "live" is proven by a
   PID *plus* a start time *plus* a session id, never by the PID alone.
8. **A profile is the unit of isolation**, and the isolation boundary is a *context*, not the
   process environment. Anything that leaves the context (thread, subprocess, executor) must
   re-enter it explicitly.
9. **Some tests are deliberately "toggle-validated"**: they are written so that disabling the
   fix makes them fail. `test_wecom_stream_dup_fix.py` says so explicitly — "proving the
   assertions track behavior, not a frozen snapshot". This is a self-check against a test that
   passes for the wrong reason.
10. **Contracts over snapshots.** `test_fence_chunker.py` says it asserts "by *contract* rather
    than snapshot", and `test_platform_media_contract.py` hardcodes each adapter's historical
    mappings on purpose — a *changed* mapping should be a deliberate decision, not an accident.

---

## 5. Weak spots in the reference (and the traps in copying it)

1. **The shard is 1,689 files for one subsystem.** The size is bought with a very heavy fixture
   vocabulary (`peer`, `daemon`, `witness`, `probe`, `worker`) that a newcomer must learn before
   reading a single assertion. August should take the *invariants*, not the *surface area*:
   copy the "one durable FIFO, one authority, one ledger" model, not the seventeen ways to boot
   a test process.
2. **Near-total platform breadth is a maintenance tax.** Seventeen messaging platforms, each
   with its own formatting, allowlist, theme, typing indicator and stream protocol, is why
   there are ~200 adapter test files. The parity sweeps exist only because the breadth drifted.
   August's single-surface app should not copy this shape.
3. **The tests are reactive, so they are biased toward *past* failures.** A 1,689-file suite
   with an incident number on nearly every docstring is strong evidence about failure modes
   but weak evidence about *design quality*. There is no test here that says "the architecture
   is right"; only that the architecture is not-yet-broken in these 1,689 ways.
4. **Heavy use of `MagicMock` and re-bound private methods** makes some assertions
   tautological (a mock that returns what the test configured proves only that the call
   happened). The genuinely load-bearing tests here are the ones that use *real* SQLite, *real*
   subprocesses and *real* sockets — and those are a minority.
5. **The "owner" concept is expensive.** Fenced generations, epoch counters, ownership
   receipts, and per-viewer close semantics solve a real problem (a shared gateway serving
   several clients) that August does not have. Importing the machinery without the problem
   would be pure cost.
6. **The comment-to-code ratio is extreme.** Several docstrings are longer than the file's
   logic. Excellent for archaeology; a maintenance burden if the behaviour changes without the
   prose being updated (which the repo itself occasionally has to fix, e.g. the stale
   `test_yuanbao_markdown.py` docstring still tells the reader to run the file by hand).

