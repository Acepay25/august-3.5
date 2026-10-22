# hermes-agent :: hermes-platform-acp-providers

**Files in shard:** 56 (read: 44, skipped with reason: 12)
**What this shard covers:** three unrelated but adjacent "platform" layers of the Hermes agent.
(1) `acp_adapter/` — the Agent Client Protocol (ACP) adapter that exposes Hermes inside an editor
(Zed, Codex, Claude Code, OpenCode) over JSON-RPC stdio, in two flavours: an *in-process* server
(`server.py`, owning its own `AIAgent`) and a *gateway projection* (`gateway_server.py`, a thin
viewer of a long-running profile daemon that owns execution). (2) `hermes_platform/` — the single
answer for "what machine is this, and where is the app I need?", a fact-cache + resolver stack with
an explicit three-tier effort model (locate / inspect / probe). (3) `providers/` — the declarative
`ProviderProfile` registry that every transport reads, plus a plugin-discovery layer keyed by
profile home. Also `native/fts5_cjk/`, a C FTS5 tokenizer for CJK session search.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `acp_adapter/__init__.py`
- **Purpose:** one-line package docstring — "ACP (Agent Communication Protocol) adapter for hermes-agent".
- **Key abstractions:** none.
- **Data flow:** none.
- **Non-obvious design decisions:** the package exports nothing; every consumer imports the submodule
  directly (`from acp_adapter.server import HermesACPAgent`), which keeps import cost out of the
  common path.
- **Edge cases & failure handling:** n/a.
- **Surprising:** `acp_adapter/__main__.py` calls `main()` at import time with **no** `if __name__`
  guard — importing the package as `python -m acp_adapter` runs the server. Fine for a stdio entry
  point, but it means `python -m acp_adapter` cannot be used to introspect the module.

#### `acp_adapter/__main__.py`
- **Purpose:** `python -m acp_adapter` → `from .entry import main; main()`.
- **Key abstractions:** `main` (re-exported from `entry.py`).
- **Data flow:** none of its own.
- **Non-obvious design decisions:** keeps the package runnable as a module without a console-script
  shim, and puts the real entry logic in `entry.py` so `hermes acp` and `hermes-acp` share it.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the `main()` call is unguarded at module scope — see above.

#### `acp_adapter/auth.py`
- **Purpose:** detect the live Hermes runtime provider and advertise ACP auth methods at handshake.
- **Key abstractions:** `detect_provider() -> str | None`, `build_auth_methods() -> list`,
  `TERMINAL_SETUP_AUTH_METHOD_ID = "hermes-setup"`.
- **Data flow:** `hermes_cli.runtime_provider.resolve_runtime_provider()` → `{api_key, provider}` →
  a provider name is accepted only if a **string** key is non-blank **or** `api_key` is *callable*
  (`acp_adapter/auth.py:16-26`).
- **Non-obvious design decisions:** a callable `api_key` counts as a valid credential because
  Azure Foundry's Entra ID bearer-token provider is a callable, not a string — otherwise a
  legitimate Entra deployment would fall back to `"openrouter"` and the handshake would reject it
  (`acp_adapter/auth.py:12-15`). The terminal setup method is **always** advertised, because the
  ACP registry requires ≥1 usable auth method in the initial handshake and a fresh Zed install has
  no credentials yet (`acp_adapter/auth.py:29-33`).
- **Edge cases & failure handling:** every exception in `detect_provider` is swallowed and the
  provider is simply "unknown" (`acp_adapter/auth.py:27-28`).
- **Surprising:** `build_auth_methods()` imports `acp.schema` lazily so the module stays importable
  without the ACP SDK installed.

#### `acp_adapter/catalog.py`
- **Purpose:** read the ACP session catalog from the shared `state.db` **without** opening a
  storage owner or an execution owner (read-only `SessionDB`).
- **Key abstractions:** `read_catalog_rows(path)`, `read_local_owners(path)`,
  `logical_session_id(path, session_id)`, `catalog_sessions(path, cwd=None)`.
- **Data flow:** `state.db` → `list_sessions_rich(source="acp", limit=1000)` → rows projected through
  `_session_info()` → filtered by cwd and message count → de-duplicated so one *logical*
  conversation yields one row (`acp_adapter/catalog.py:61-83`).
- **Non-obvious design decisions:** the public session id an editor holds is **logical**, not
  physical: compression and a canonical reset advance the internal transcript id but never the
  identity. The mapping is recovered from a *local creation receipt* stored in `state_meta` under
  `POLICY_PREFIX` (`acp_adapter/catalog.py:24-45`), falling back to the compression lineage root
  (`acp_adapter/catalog.py:48-59`). A compressed chat's tip is projected for the *listing* but the
  editor keeps the logical id.
- **Edge cases & failure handling:** a missing DB file returns `{}`; a malformed receipt JSON is
  skipped; legacy reset histories with no receipt "stay independent chats" (documented, not fixed).
- **Surprising:** the module imports four *private* helpers from `acp_adapter.session`
  (`_normalize_cwd_for_compare`, `_parse_model_config`, `_session_info`, `_updated_at_sort_key`) —
  cross-module private coupling that a rename would silently break.

#### `acp_adapter/commands.py`
- **Purpose:** headless slash commands (`/help`, `/model`, `/tools`, `/context`, `/reset`,
  `/compress`, `/steer`, `/queue`, `/version`) for the in-process ACP server.
- **Key abstractions:** `SlashCommandsMixin` (a mixin over `HermesACPAgent`), `_COMMANDS` table
  (name → help/description/input-hint), `_MID_TURN_BLOCKED_COMMANDS = {"reset","compress","model"}`
  (`acp_adapter/commands.py:40`), `_estimate_tokens()`.
- **Data flow:** prompt text → `_handle_slash_command()` → table lookup → `getattr(self, f"_cmd_{cmd}")`
  → handler mutates `SessionState` → response string returned to the editor.
- **Non-obvious design decisions:** three commands are *mid-turn blocked* because they mutate shared
  turn state (`state.history`, `state.agent`) while a turn iterates them
  (`acp_adapter/commands.py:34-39`). The gate is a dedicated `state.command_op` flag held for the
  **whole handler**, not just the check, so the check-then-act window (a `/compress` LLM call and a
  `/model` agent rebuild take seconds) cannot be entered by a concurrent prompt
  (`acp_adapter/commands.py:102-107`). Handlers run in a **fresh copied context** with the cwd
  re-pinned, because `/compress` and `/model` rebuild the system prompt and an unpinned rebuild
  would bake the Hermes install tree into the persisted cached prompt
  (`acp_adapter/commands.py:115-124`).
- **Edge cases & failure handling:** a handler exception is caught and returned as
  `"Error executing /x: <e>"`; `command_op` is always released in a `finally`
  (`acp_adapter/commands.py:126-133`). `_cmd_reset` still saves the session in a `finally` even when
  the agent's own reset failed.
- **Surprising:** `/context` reports a **rough** token estimate
  (`estimate_request_tokens_rough`) against the compressor's threshold, and states plainly
  "Auto-compaction is disabled (`compression.enabled: false`); `/compress` still compresses
  manually" — the gate applies to *automatic* compaction only
  (`acp_adapter/commands.py:184-230`). `/compress` temporarily nulls `agent._session_db` so the
  internal SQLite session split does not rotate the ACP session id
  (`acp_adapter/commands.py:245-256`).

#### `acp_adapter/content.py`
- **Purpose:** convert ACP prompt content blocks (text / image / audio / resource / embedded
  resource) into Hermes/OpenAI user-content payloads.
- **Key abstractions:** `_content_blocks_to_openai_user_content(prompt) -> str | list[dict]`,
  `_resource_link_to_parts`, `_embedded_resource_to_parts`, `_path_from_file_uri`,
  `_decode_text_bytes`, `_MAX_ACP_RESOURCE_BYTES = 512 * 1024` (`acp_adapter/content.py:22`).
- **Data flow:** ACP blocks → per-kind converters → OpenAI content parts → a **string** when the
  prompt is pure text, a list only when media is present (`acp_adapter/content.py:256-288`).
- **Non-obvious design decisions:** pure-text prompts stay a string so text-only providers and
  slash-command detection still work (`acp_adapter/content.py:281-283`). Binary detection is
  content-based (a NUL byte plus a non-text MIME type) rather than extension-based, and the comment
  explains the failure it prevents: feeding decoded ELF/Mach-O/PE bytes back into the lifecycle
  guard tokenises machine code into bogus NUL-bearing paths and crashes the scanner (#77703)
  (`acp_adapter/content.py:119-133`). Windows drive letters and WSL `/mnt/<drive>/` forms are
  normalised (`acp_adapter/content.py:82-113`).
- **Edge cases & failure handling:** every read is capped at 512 KB and the note says how much was
  kept vs. what existed ("truncated to 512 KiB of N bytes"), never a silent truncation
  (`acp_adapter/content.py:181-186`); images over the cap become a text note; an unreadable file
  becomes "[Could not read attached file: ...]".
- **Surprising:** the "cannot read non-file ACP resource URIs" case is expressed as a **text part**
  saying Hermes cannot read it — the model still sees the reference rather than the prompt failing.

#### `acp_adapter/edit_approval.py`
- **Purpose:** pre-execution approval for file mutations in ACP sessions (a ContextVar-bound
  requester, deliberately isolated from the generic tool registry).
- **Key abstractions:** `EditProposal` (frozen dataclass: `tool_name`, `path`, `old_text`,
  `new_text`, `arguments`, `paths`), `EditApprovalRequester`, `set_edit_approval_requester` /
  `reset_edit_approval_requester` (`acp_adapter/edit_approval.py:41,53,58`),
  `build_edit_proposal`, `should_auto_approve_edit(proposal, policy, cwd)`
  (`acp_adapter/edit_approval.py:149`), `maybe_require_edit_approval`
  (`acp_adapter/edit_approval.py:177`), `make_acp_edit_approval_requester`.
- **Data flow:** tool name + arguments → proposal builder (per tool/mode) → policy check → either
  auto-approve or an ACP `request_permission` round-trip → allow/deny.
- **Non-obvious design decisions:** the approval requester is a **ContextVar**, so it is bound for
  the duration of one ACP agent run and other surfaces (CLI, gateway) leave it unset and bypass
  the guard entirely (`acp_adapter/edit_approval.py:6-9,41`). Sensitive paths (`.env`, `.env.local`,
  `.env.production`, `id_rsa`, `id_ed25519`, anything under `.git`/`.ssh`) **always ask**, even under
  the most permissive policy (`acp_adapter/edit_approval.py:143-147,157`). A multi-file V4A patch
  stores every touched file in `proposal.paths` and the policy checks run **per real target**, so a
  sensitive file cannot hide inside a comma-joined display string
  (`acp_adapter/edit_approval.py:150-156`). `workspace_session` policy is checked against both the
  temp root and the workspace, using `tempfile.gettempdir()` resolved (on macOS `/private/tmp`).
- **Edge cases & failure handling:** a proposal that cannot be built **denies** ("could not prepare
  diff"); an exception inside the requester **denies by default**
  (`acp_adapter/edit_approval.py:183-192`). `patch` in `replace` mode goes through the repo's own
  `fuzzy_find_and_replace` so the diff shown to the approver is the diff that will actually be
  written (`acp_adapter/edit_approval.py:95-109`).
- **Surprising:** `EditProposal.path` is documented as possibly being a comma-joined *display*
  string — a data model that leaks the UI representation into the security check, mitigated only by
  the parallel `paths` tuple.

#### `acp_adapter/elicitation.py`
- **Purpose:** the canonical `clarify` prompt in an ACP editor, delivered either as an
  `elicitation/create` form (if the client advertises `elicitation.form`) or as a permission card
  with one option per choice plus Skip.
- **Key abstractions:** `client_supports_form_elicitation(initialize_params)`
  (`acp_adapter/elicitation.py:17`), `build_clarify_elicitation(session_id, prompt)`,
  `elicited_answer(response) -> str | None`, `build_clarify_permission(prompt)`.
- **Data flow:** owner prompt `{prompt_id, question, choices, multi_select}` → form schema or
  permission options → client answer → `clarify.respond` on the gateway.
- **Non-obvious design decisions:** capability detection reads the **raw** initialize params
  because the pinned SDK's typed `ClientCapabilities` model silently drops the `elicitation` field
  (`acp_adapter/elicitation.py:17-28`). The answer vocabulary is tri-state: accept → the answer,
  decline/cancel → `""` (the universal skip), anything else → `None` (**not answered**), which
  leaves the canonical waiter to other viewers (`acp_adapter/elicitation.py:40-53`).
- **Edge cases & failure handling:** a multi-select answer is returned as a JSON array string
  (the clarify decoder's contract); a non-string answer is `None`.
- **Surprising:** the module credits an external contributor in the docstring
  ("Form schema and capability detection adapted from #126313 (Utku Bakir)").

#### `acp_adapter/entry.py`
- **Purpose:** the `hermes-acp` CLI entry point — bootstrap, env loading, logging, transport.
- **Key abstractions:** `main(argv)`, `_setup_logging()`, `_load_env()`, `_run_check()`,
  `_run_setup()`, `_BenignProbeMethodFilter`.
- **Data flow:** argv → flags → (exit) or start → `HermesACPAgent()` → `acp.run_agent(agent,
  use_unstable_protocol=True)` → `agent.aclose()`.
- **Non-obvious design decisions:** `hermes_bootstrap` must be the **very first import** (UTF-8 stdio
  on Windows) and `hermes_bootstrap.harden_import_path()` stops a `utils/`/`proxy/`/`ui/` package in
  the launch cwd from shadowing Hermes modules (`acp_adapter/entry.py:11-21`). All logging goes to
  **stderr** because stdout is reserved for ACP JSON-RPC (`acp_adapter/entry.py:64-80`). A logging
  filter suppresses the "Background task failed" traceback for liveness probes (`ping`, `health`,
  `healthcheck`) while leaving every other background-task error visible
  (`acp_adapter/entry.py:45-61`). On Windows the memory provider and numpy are imported on the main
  thread **before** the reader thread starts, because a native-extension import racing another
  thread's import chain deadlocked in `create_module` and `session/new` never answered (#58083)
  (`acp_adapter/entry.py:177-181`).
- **Edge cases & failure handling:** a partial `hermes update` (git reset landed, install did not) is
  repaired by `hermes_cli._early_recovery.restore_interrupted_pull()` before any other import
  (`acp_adapter/entry.py:24-28`). The adapter is a **viewer**: MCP discovery and execution belong
  to the gateway daemon, and the owner ends an ACP session when its last viewer detaches
  (`acp_adapter/entry.py:200-215`).
- **Surprising:** `_run_setup()` rewrites `sys.argv` to `hermes model` to reuse the CLI's provider
  setup, then offers a browser-tools install only on a TTY (`acp_adapter/entry.py:120-143`).

#### `acp_adapter/events.py`
- **Purpose:** bridge `AIAgent` callbacks to ACP `session/update` notifications, on the right
  thread.
- **Key abstractions:** `make_tool_progress_cb`, `make_step_cb`, `make_message_cb`,
  `make_thinking_cb`, `AssistantMessageIdAllocator` (`acp_adapter/events.py:185`),
  `flush_open_tool_calls` (`acp_adapter/events.py:97`), `close_tool_call`,
  `_build_plan_update_from_todo_result`.
- **Data flow:** agent callback (worker thread) → `safe_schedule_threadsafe(...)` onto the event
  loop → `conn.session_update(...)` → client.
- **Non-obvious design decisions:** parallel calls of the **same** tool name are tracked in a
  per-name FIFO (`deque`), so each completion closes the right bubble
  (`acp_adapter/events.py:74-88`). A `turn_state["saw_completion"]` flag makes the *executor* the
  authority on completion — the `step_callback` fallback only fires when the runtime never
  projected a `tool.completed` (`acp_adapter/events.py:138-152,255-262`). `None` from the text
  callback is the **flush sentinel** that closes the active `messageId`, so the next delta opens a
  new assistant bubble instead of merging into the previous one
  (`acp_adapter/events.py:214-222`). The `messageId` allocator exists because ACP clients replace
  "the current assistant message" on each chunk; without ids, separate autonomous turns collapse
  into one bubble (`acp_adapter/events.py:180-196`).
- **Edge cases & failure handling:** `flush_open_tool_calls` closes every tool call still open at
  turn end as **abandoned** — a tool blocked by scope, guardrail or an editor permission prompt
  never projects `tool.completed`, so without this its bubble spins forever and the client reads
  the turn as one that never ran a tool (`acp_adapter/events.py:97-117`). The update send has a
  5-second bounded wait and swallows failure at DEBUG level.
- **Surprising:** ACP's plan vocabulary has no "cancelled", so a cancelled todo is kept as a
  terminal entry with a `[cancelled]` prefix in its content
  (`acp_adapter/events.py:30-31,44-51`).

#### `acp_adapter/gateway_commands.py`
- **Purpose:** the editor slash commands on the **gateway** path — every one is an existing gateway
  verb, not in-process logic.
- **Key abstractions:** `run_command(agent, session_id, command, arg)`, `CommandRefused`
  (a refusal the editor shows as the command's *reply*), the `ROUTES` table
  (`acp_adapter/gateway_commands.py:186-200`), `_forward`, `_rewind`, `_steer`, `_mutate`.
- **Data flow:** slash text → `ROUTES` lookup → handler → a gateway RPC (`session.mutate`,
  `session.steer`, `prompt.resolve_unknown`, `slash.exec`) → a reply string, or `(None, text)` when
  the text must be submitted as the next prompt.
- **Non-obvious design decisions:** `ROUTES` is *the* table of what ACP answers itself, and a
  generated parity script documents it, so a route cannot change without the table changing
  (`acp_adapter/gateway_commands.py:181-185`). Everything not in `ROUTES` is forwarded to the
  owner's `slash.exec`; an `unsupported_command` RPC error becomes the shared refusal text and
  reaches the editor as a **reply**, never as a failed prompt (`acp_adapter/gateway_commands.py:88-100`).
  `/steer` targets **this editor's own admission** (`prompt.receipt`), never the session's latest
  turn, because while our prompt waits behind another client's turn, that turn is not ours to
  redirect (`acp_adapter/gateway_commands.py:127-135`). A `stale_generation` refusal from
  `session.steer` means the turn ended meanwhile — the text is left for the next turn, which is a
  different outcome from a permission refusal and is handled separately.
- **Edge cases & failure handling:** `_rewind` re-reads the *snapshot* before archiving so a refusal
  (an image turn `/retry` cannot resend) becomes the command's reply, and a repeat after a lost
  refresh replays the same rewind instead of deriving a new target from an already-shortened
  transcript (`acp_adapter/gateway_commands.py:140-175`).
- **Surprising:** `/discard <admission id>` is a first-class command: it acknowledges one exact
  *lost* turn and refreshes the FIFO snapshot (`acp_adapter/gateway_commands.py:78-99`).

#### `acp_adapter/gateway_media.py`
- **Purpose:** stage editor media (images) for `prompt.submit`, and fingerprint a prompt so a
  retry reuses the same admission.
- **Key abstractions:** `stage_user_content(content, home=None) -> (text, attachments)`
  (`acp_adapter/gateway_media.py:42`), `submit_fingerprint(session_id, content)`
  (`acp_adapter/gateway_media.py:101`), `_fetch_remote_image`, `_take`.
- **Data flow:** content parts → base64 decode / remote fetch (through the gateway's SSRF-guarded
  image fetcher) → sniff the MIME from the **bytes** → stage in the profile image cache → the owner
  commits at admission.
- **Non-obvious design decisions:** the sniffed bytes are authoritative; the client's declared type
  (a file suffix, or `image/png` by default) is never trusted
  (`acp_adapter/gateway_media.py:70-78`). A remote image that cannot be fetched degrades to a text
  marker, so the user's text still runs (`acp_adapter/gateway_media.py:24-33`). The fingerprint is
  taken **before** staging, so a retry matches without re-fetching a remote image whose second
  download could fail or return different bytes and change what is submitted
  (`acp_adapter/gateway_media.py:101-114`).
- **Edge cases & failure handling:** an unsupported image format or an over-cap part degrades to a
  text note; the staged cache copy is deleted after the bytes are read.
- **Surprising:** `stage_user_content` re-enters itself with a `HERMES_HOME` override when a
  per-task overlay is given, because the overlay does not share `cache/images` and admission accepts
  only the owner's cache (`acp_adapter/gateway_media.py:52-59`).

#### `acp_adapter/gateway_reply.py`
- **Purpose:** how a gateway turn's reply reaches the editor — `messageId` grouping,
  exactly-once final text, tool/permission bubbles closed as the in-process agent closes them.
- **Key abstractions:** `GatewayReplyMixin` with `_project_tool`, `_finish_reply`,
  `_flush_open_tools`, `_chunk`, `_end_message`, `_project_side_update`, `_close_segment`,
  `_final_remainder`, `_close_card`.
- **Data flow:** gateway event → projection into ACP `session/update`; streamed text accumulates in
  `self._streamed[aid]`, closed segments in `self._segments[aid]`, the gap cut in `self._cut[aid]`.
- **Non-obvious design decisions:** exactly-once text is the hard part: `_final_remainder` compares
  the settled reply against what was already streamed and shown, and uses the owner's explicit
  `response_reused` / receipt flags rather than inferring from text
  (`acp_adapter/gateway_reply.py:117-155`). A replay gap is handled by `gateway_replay_gap.owed_reply`,
  which either emits the missing remainder once or marks it in full
  (`acp_adapter/gateway_reply.py:134-140`).
- **Edge cases & failure handling:** a tool call the admission started and never completed is closed
  as `failed` with the text "ended without a result (blocked, denied, or interrupted)"
  (`acp_adapter/gateway_reply.py:71-80`). Closing a permission card is display-only: a failure is
  logged at DEBUG and never costs the user their answer its delivery
  (`acp_adapter/gateway_reply.py:174-190`).
- **Surprising:** `reasoning.delta` never enters the reply's segments, so `message.complete`'s
  final remainder is unaffected by reasoning output (`acp_adapter/gateway_reply.py:84-101`).

#### `acp_adapter/gateway_session_meta.py`
- **Purpose:** editor session metadata on the gateway path, projected from the gateway's existing
  reads (never from a live agent).
- **Key abstractions:** `COMMANDS` table (`acp_adapter/gateway_session_meta.py:26`),
  `available_commands_update()`, `help_text()`, `current_mode(info)`, `session_modes(info)`,
  `model_state(info)`, `provenance_meta(db_path, acp_session_id, session_id)`, `usage_update(stats)`,
  `turn_usage(stats)`, `title_update(title)`.
- **Data flow:** `session.info` / `session.stats` / `message.complete.usage` / `state.db` → ACP
  `SessionModelState` / `SessionModeState` / `UsageUpdate` / `SessionInfoUpdate`.
- **Non-obvious design decisions:** the mode is derived from the session's *edit approval policy*
  (`EDIT_APPROVAL_POLICY_TO_MODE`), so an owner without the field falls back to the default "ask"
  (`acp_adapter/gateway_session_meta.py:59-63`). The model picker falls back to a single
  current-model row when the shared inventory is broken, because "a broken inventory must not fail
  session/new; the current model still shows" (`acp_adapter/gateway_session_meta.py:75-90`).
- **Edge cases & failure handling:** an unreadable store returns `None` provenance (best effort, as
  in the in-process server); `usage_update` returns `None` unless the context length is a positive
  **int** (`type(size) is not int` rejects a bool/str sneaking in).
- **Surprising:** `title_update` uses `datetime.now(UTC)` as `updated_at` because the `sessions`
  table has no `updated_at` column (`acp_adapter/gateway_session_meta.py:134-139`).

#### `acp_adapter/model_catalog.py`
- **Purpose:** the ACP model picker — deduplicated `provider:model` rows from the Hermes inventory
  plus named custom endpoints.
- **Key abstractions:** `encode_model_choice(provider, model)` (`acp_adapter/model_catalog.py:146`),
  `_ModelCatalog` (`acp_adapter/model_catalog.py:156`), `build_model_state(model, provider, base_url)`
  (`acp_adapter/model_catalog.py:238`), `_named_custom_provider_catalogs()`,
  `_semantic_provider`, `_empty_catalog_applies`, `_choice_provider`.
- **Data flow:** `hermes_cli.inventory.build_models_payload(...)` (the same substrate as `hermes
  model` / TUI / dashboard) + named endpoints → `_ModelCatalog` dedupe → `SessionModelState`.
- **Non-obvious design decisions:** dedupe is **two-keyed**: the encoded choice id *and* a semantic
  `provider:model` id, so `ollama` and `custom:ollama` are the same row
  (`acp_adapter/model_catalog.py:156-186`). A bare/`custom` current provider whose `base_url` matches
  an ollama inventory row is resolved to `custom:ollama` by base-URL identity, not by name
  (`acp_adapter/model_catalog.py:205-212`). A `providers:` key that *shadows* a canonical name must
  leave the canonical row alone — otherwise picking "current" re-routes the session to the proxy
  (`acp_adapter/model_catalog.py:253-264`). An authoritative-empty catalog removes that provider's
  rows from the picker entirely, and the current model is then *not* re-inserted
  (`acp_adapter/model_catalog.py:275-289`).
- **Edge cases & failure handling:** a per-provider cap of 200 rows (`ACP_MAX_MODELS_PER_PROVIDER`)
  is a *per-provider* cap, not a total; the current model is always kept via the fallback insert
  (`acp_adapter/model_catalog.py:15-19,281-288`). Live discovery is best-effort with a 1.5 s
  timeout; declared models survive a failed discovery because some endpoints have no `/models`
  route (`acp_adapter/model_catalog.py:47-58`).
- **Surprising:** the module reaches into four private helpers of `hermes_cli.model_switch*` and
  `hermes_cli.models_local` — a strong coupling that will break when those are refactored.

#### `acp_adapter/modes.py`
- **Purpose:** the ACP edit modes, one table shared by the in-process server and the gateway path.
- **Key abstractions:** `MODES` (`acp_adapter/modes.py:11`), `MODE_TO_EDIT_APPROVAL_POLICY`,
  `EDIT_APPROVAL_POLICY_TO_MODE`, `DEFAULT_MODE`, `DEFAULT_EDIT_APPROVAL_POLICY = "ask"`,
  `EDIT_APPROVAL_POLICY_CONFIG_ID`.
- **Data flow:** an ACP mode id → an edit-approval policy → the policy the edit guard enforces.
- **Non-obvious design decisions:** the table is deliberately tiny and each row names exactly what it
  does *and what it still asks about*: `accept_edits` auto-allows workspace + temp-dir edits but
  still asks for sensitive paths; `dont_ask` auto-allows file edits for the session **except**
  sensitive paths (`acp_adapter/modes.py:11-15`). The docstring names where the policy is
  *enforced* (where the edit runs) and notes that sensitive paths always ask.
- **Edge cases & failure handling:** n/a — the table is the whole contract.
- **Surprising:** the mode → policy mapping is a **bijection** (`dont_ask` → `session`,
  `accept_edits` → `workspace_session`), so the ACP mode the user sees is recoverable from the
  stored policy and vice versa — the gateway path needs that to project a mode change made on
  another surface.

#### `acp_adapter/permissions.py`
- **Purpose:** bridge Hermes dangerous-command approvals to ACP `request_permission`.
- **Key abstractions:** `_OPTION_ID_TO_HERMES` (`acp_adapter/permissions.py:17`),
  `_build_permission_options`, `_build_permission_tool_call`, `await_permission(...)`
  (`acp_adapter/permissions.py:77`), `resolve_permission_timeout(timeout)`
  (`acp_adapter/permissions.py:117`), `make_approval_callback(...)`.
- **Data flow:** Hermes approval callback (worker thread) → `request_permission` scheduled on the
  event loop → ACP options → the user's pick → an approval string (`once` / `session` / `always` /
  `deny` / `timeout`).
- **Non-obvious design decisions:** the **option ids are stable across the `allow_permanent` True
  and False paths** even though the option list differs, so a persisted answer still maps
  (`acp_adapter/permissions.py:14-20`). A gate that re-asks every time collapses to the same two
  options as a Smart DENY — offering a scope Hermes discards would re-prompt every write (#81887,
  `acp_adapter/permissions.py:30-40`). ACP has no session-scoped kind, so `allow_session` is
  emitted as kind `allow_always` with the Hermes semantics carried in the id
  (`acp_adapter/permissions.py:41`). The SDK's accepted option kinds are **probed** by constructing
  a throwaway `PermissionOption` (`acp_adapter/permissions.py:23-29`).
- **Edge cases & failure handling:** timeout returns the distinct string `"timeout"` (not `"deny"`)
  so `tools.approval` reports "timed out without user response" instead of a user denial
  (`acp_adapter/permissions.py:140-147`). The timeout is **read from the user's
  `approvals.timeout` setting** (default 300 s), not hardcoded: the ACP bridges used to hardcode
  60 s, so a host whose approval card was still waiting saw Hermes self-deny under it (#73403,
  `acp_adapter/permissions.py:117-126`).
- **Surprising:** the permission bubble is closed as `completed` for an allow and `failed`
  otherwise, so the visible card's terminal state always matches the decision actually taken
  (`acp_adapter/permissions.py:99-115`).

#### `acp_adapter/provenance.py`
- **Purpose:** derive ACP session-provenance metadata from the existing compression chain — an
  additive `_meta.hermes` extension other clients ignore.
- **Key abstractions:** `build_session_provenance(db, acp_session_id, current_hermes_session_id,
  previous_hermes_session_id=None)` (`acp_adapter/provenance.py:32`),
  `session_provenance_meta(...)`, `_MAX_WALK = 100` (`acp_adapter/provenance.py:18`).
- **Data flow:** `sessions` table (`parent_session_id`, `end_reason`) → walk parents → a
  provenance dict (`acpSessionId`, `currentHermesSessionId`, `rootHermesSessionId`,
  `parentHermesSessionId`, `sessionKind`, `compressionDepth`, optional `previousHermesSessionId`,
  `reason`, `creatorKind`).
- **Non-obvious design decisions:** **no new persisted state** — everything is derived from columns
  that already model compression-continuation chains (`acp_adapter/provenance.py:4-12`). Only
  parents whose `end_reason == "compression"` count toward compression depth: delegate/branch
  children share the `parent_session_id` column but are not compaction boundaries
  (`acp_adapter/provenance.py:44-47`). The `acp_session_id` stays the stable public handle; the
  internal id may rotate. A session is a "continuation" iff its immediate parent ended with
  `end_reason == "compression"` (`acp_adapter/provenance.py:56-57`).
- **Edge cases & failure handling:** the walk is bounded at 100 levels and cycle-guarded by a
  `seen` set (`acp_adapter/provenance.py:47-56`); a DB that cannot be read returns `None` rather
  than raising.
- **Surprising:** the `reason: "compression"` / `creatorKind: "compression"` flags are set only
  when the id changed *and* a previous id was supplied — the only mechanism that rotates the
  internal id mid-turn is a compression-driven session split (`acp_adapter/provenance.py:66-72`).

#### `acp_adapter/server.py`
- **Purpose:** the in-process ACP agent server — owns an `AIAgent` per session, streams events,
  answers permissions, replays history.
- **Key abstractions:** `HermesACPAgent(SlashCommandsMixin, acp.Agent)` (1090 lines),
  `_TurnCallbacks` dataclass, `ModelRejected(ValueError)`, `_history_replay_updates(history)`
  (`acp_adapter/server.py:126`), `_claim_turn_or_queue(...)` (`acp_adapter/server.py:729`),
  `prompt(...)` (`acp_adapter/server.py:815`), `_finish_turn(...)`
  (`acp_adapter/server.py:945`), `_drain_queued_prompts(...)` (`acp_adapter/server.py:1005`).
- **Data flow:** ACP request → `SessionManager` (DB-backed, restorable) → a `ThreadPoolExecutor`
  worker runs `agent.run_conversation(...)` → callbacks push `session/update` onto the loop → the
  turn's result is persisted and the final text emitted.
- **Non-obvious design decisions:**
  - `HermesACPAgent.__new__` returns a **`GatewayACPAgent`** when no session manager is supplied —
    the same class name is a façade that routes to the gateway projection
    (`acp_adapter/server.py:246-251`).
  - All agent construction and DB work happens off the event loop (`asyncio.to_thread`); inline it
    froze the loop serving every JSON-RPC request (#58083, `acp_adapter/server.py:566-568`).
  - The turn runs inside `contextvars.copy_context()` so ContextVar writes are isolated between
    concurrent sessions on the shared executor (`acp_adapter/server.py:855-861`).
  - The approval callback is bound on the **executor thread** because approval routing is
    thread-local, and interactive routing is a `tools.approval` contextvar rather than an
    `os.environ` flag, so concurrent workers cannot race a global flag onto the non-interactive
    auto-approve path (GHSA-96vc-wcxf-jjff, `acp_adapter/server.py:760-766`).
  - `session/load` and `session/resume` **stream the history back before responding** — the ACP
    spec requires it and deferring via `call_soon` broke every spec-compliant client (#12285,
    `acp_adapter/server.py:520-545`).
  - A key-presence check, not truthiness, decides whether to adopt the result's history:
    `messages=[]` is a legitimate cleared transcript (#10844, `acp_adapter/server.py:952-956`).
  - The `command_op` flag is set for a model switch *and* released in a `finally`, with the queued
    prompts drained **after** the response is queued so a mid-switch prompt does not run a whole
    turn before the client sees the switch result (`acp_adapter/server.py:1005-1030`).
  - A `ModelRejected` (a model no provider can serve) is mapped to `RequestError.invalid_params`
    (-32602) so the client attributes the fault to its request, not to Hermes; a `ValueError` from
    the rebuild stays on the -32603 path (#72439, `acp_adapter/server.py:1000-1004`).
- **Edge cases & failure handling:** history replay is best-effort — a corrupt message must not
  turn the load into an error, so the replay is wrapped and the failure logged
  (`acp_adapter/server.py:521-533`). A missing session returns `PromptResponse(stop_reason="refusal")`.
  `cancel()` restores the session from the DB off the loop and takes the runtime lock so no other
  prompt mistakes the cancelled turn for redirectable work (`acp_adapter/server.py:608-624`).
- **Surprising:** `agent.thinking_callback = None` is set explicitly — "Thought panes get provider
  reasoning only — no local status updates, no fake accordion" (`acp_adapter/server.py:964`).

#### `acp_adapter/session.py`
- **Purpose:** map ACP sessions to Hermes `AIAgent` instances, in memory **and** in the shared
  `state.db`, so a session survives a restart.
- **Key abstractions:** `SessionState` (dataclass: `session_id`, `agent`, `cwd`, `model`,
  `history`, `cancel_event`, `is_running`, `command_op`, `queued_prompts`, `runtime_lock`,
  `current_prompt_text`, `interrupted_prompt_text`, `message_ids`), `SessionManager`
  (`acp_adapter/session.py:156`), `_normalize_cwd_for_compare`, `_translate_acp_cwd`,
  `_expand_acp_enabled_toolsets`.
- **Data flow:** create/fork/load → `SessionState` in memory + a `sessions` row + `messages` rows
  in `state.db`; restore → DB → a rebuilt `AIAgent` + history.
- **Non-obvious design decisions:**
  - The DB is acquired through `hermes_state_registry.acquire(...)` so the ACP server holds **one**
    writer on `state.db` instead of two (#100896, `acp_adapter/session.py:318-325`).
  - `_persist` has a careful double-write guard: when the agent owns persistence to the same DB
    (`agent._session_db is db and agent._session_db_created`), it returns early, because
    `replace_messages()` would DELETE the archived pre-compaction rows and, after a compression id
    rotation, clobber the ended parent transcript — silent data loss for any conversation long
    enough to compress (`acp_adapter/session.py:343-401`).
  - When the agent is not the owner, only the `active=1` set is replaced, so archived rows survive
    — and the call is **unconditional** because an existence probe would fail OPEN on a DB error
    and can race a concurrent `archive_and_compact` (`acp_adapter/session.py:390-401`).
  - A `cwd` change claims an **ordering generation**; a slow `git rev-parse` probe for a previous
    workspace cannot overwrite a newer claim (the A → B → A contract)
    (`acp_adapter/session.py:262-268,403-417`).
  - An ACP stdio shutdown is the session end: `end_all_sessions()` stamps `ended_at` on every live
    session, because ACP v0.9 has no per-session destroy and without this writer the ended-session
    guard can never reach `source='acp'` rows (#118216, `acp_adapter/session.py:277-306`).
  - A contentless session is deliberately **ephemeral** — it is not persisted until it has history
    (`acp_adapter/session.py:347-351`).
- **Edge cases & failure handling:** `get_session` transparently restores from the DB under a
  separate `_restore_lock` so two overlapping restores share one agent build
  (`acp_adapter/session.py:203-215`). A one-shot `backfill_acp_session_cwd()` repairs rows minted
  before the adapter wrote the `cwd` column (#115705). Restoring a session reopens it
  (`db.reopen_session`) — the same contract the TUI gateway's cold-resume path uses.
- **Surprising:** `_normalize_cwd_for_compare` runs `os.path.realpath` so macOS's `/var` vs
  `/private/var` and `/tmp` vs `/private/tmp` aliases compare equal; without it, ACP history
  filters silently dropped a workspace's own sessions (ported from prime-agent#628,
  `acp_adapter/session.py:36-62`).

#### `acp_adapter/tools.py`
- **Purpose:** map Hermes tools to ACP `ToolKind` and build the tool-call content.
- **Key abstractions:** `TOOL_KIND_MAP` (`acp_adapter/tools.py:18`), `get_tool_kind`,
  `build_tool_start` (`acp_adapter/tools.py:780`), `build_tool_complete`
  (`acp_adapter/tools.py:817`), `build_tool_abandoned` (`acp_adapter/tools.py:837`),
  `coerce_tool_args`, `_json_loads_maybe`, `_tool_result_failed` (`acp_adapter/tools.py:168`),
  `_COMPLETION_FORMATTERS`, `_POLISHED_TOOLS`, `_START_CONTENT_BUILDERS`, `extract_locations`.
- **Data flow:** Hermes tool name + args + result → an ACP `ToolCallStart` / `ToolCallProgress`
  with curated Markdown content.
- **Non-obvious design decisions:**
  - `_tool_result_failed` is deliberately **conservative**: plain text may legitimately contain the
    word "error", so only structured tool-level failures map to a failed status — with one
    exception, the executor's canonical `"Error executing tool '<name>': ..."` prefix, which a
    well-behaved tool cannot produce, so a tool that blew up is not shown green
    (`acp_adapter/tools.py:168-190`).
  - `_json_loads_maybe` falls back to `raw_decode` because some Hermes tools append a human hint
    after the payload (`{...}\n\n[Hint: ...]`), and the structured rendering path must survive it
    (`acp_adapter/tools.py:140-156`).
  - `build_tool_start` is wrapped in a try/except that falls back to a **minimal valid** start
    event: it runs on the live tool-progress callback and during history replay, so a malformed
    argument from a model ignoring the schema must never abort the render
    (`acp_adapter/tools.py:780-797`).
  - `_fenced_text` computes a fence that cannot be broken by backticks in the payload, because
    `read_file` output is `|`-line-numbered and raw Markdown would let Zed parse pipes as tables
    (`acp_adapter/tools.py:158-163,275-282`).
  - The completion content is per-tool curated (~20 formatters) and the generic formatter renders
    nested JSON as compact bullets, with `_PRIORITY_KEYS` first and a 40-line cap
    (`acp_adapter/tools.py:560-660`).
  - `web_extract` shows **only its errors**; success stays compact via the title
    (`acp_adapter/tools.py:818-821`).
- **Edge cases & failure handling:** `build_tool_abandoned` closes a call that ended without a
  result as `failed` — "the tool did not produce a result" is the honest terminal state
  (`acp_adapter/tools.py:837-847`). `coerce_tool_args` decodes a JSON string, and an undecodable
  one becomes `{"raw": ...}` rather than raising (`acp_adapter/tools.py:133-140`).
- **Surprising:** `_POLISHED_TOOLS` is a 50-entry allow-list of tools whose raw JSON output is
  suppressed in favour of a curated form; unknown/plugin tools stay conservative and keep their
  raw output (`acp_adapter/tools.py:44-68`).

#### `acp_adapter/gateway_server.py`
- **Purpose:** the ACP **projection** of the profile gateway — "never constructs an execution owner"
  (1178 lines).
- **Key abstractions:** `GatewayACPAgent(GatewayReplyMixin, acp.Agent)`, `_slash_command(text)`,
  `_bypass_route()`, `_tools_changed_notice(payload)`, `_reattach` (`acp_adapter/gateway_server.py:177`),
  `_teardown` (`acp_adapter/gateway_server.py:243`), `prompt` (`acp_adapter/gateway_server.py:621`),
  `_recover` (`acp_adapter/gateway_server.py:785`), `_unknown_recovery`
  (`acp_adapter/gateway_server.py:835`), `_events` (`acp_adapter/gateway_server.py:907`).
- **Data flow:** ACP request → gateway RPC (`session.create`, `session.resume`, `prompt.submit`,
  `prompt.receipt`, `session.mutate`) → the gateway's event stream → ACP `session/update`.
- **Non-obvious design decisions:**
  - An **admission** is the unit of a turn. Every prompt becomes an admission id; the reply is
    delivered exactly once by whichever path gets there first (`message.complete` or a retry's
    terminal receipt) — the `_settling` / `_receipted` sets implement that mutual exclusion
    (`acp_adapter/gateway_server.py:88-100,971-995`).
  - A lost turn is a first-class state: `prompt.submit` may be acknowledged but the turn lost in a
    gateway restart (`status == "unknown"`). The adapter then **refuses new work** with a message
    naming the exact recovery control (`/discard <admission id>`) and never resubmits
    (`acp_adapter/gateway_server.py:835-855,621-636`).
  - A transport death is **ambiguous, never retried**: the link generation (`self._link`) is bumped
    on teardown, and a waiter whose transport was replaced reports that transport's ambiguous
    failure instead of waiting on a connection it never used
    (`acp_adapter/gateway_server.py:243-280,700-710`).
  - The un-acked submit identity is retained for the editor's retry, keyed by a content
    **fingerprint** taken before staging (`acp_adapter/gateway_server.py:98-100,666-680`).
  - `session/load` and `session/resume` are the **same** code path (`_resume`), and the load's id
    is recorded as an *alias* of the logical id, so the editor keeps addressing the same
    conversation after a compression rotation (`acp_adapter/gateway_server.py:333-380`).
  - The editor's MCP servers are passed in `editor:` on `session.resume`; a second editor with an
    empty list must not strip the first editor's tools, and an owner without the capability
    capability is refused explicitly (`acp_adapter/gateway_server.py:340-366`).
  - `_adopt` is the single install path for every snapshot, and events before its watermark are
    skipped so the state they carried is projected from the snapshot itself — the editor is never
    left showing "Default" while the owner enforces "Accept Edits" (#141338,
    `acp_adapter/gateway_server.py:195-210`).
- **Edge cases & failure handling:** a projection failure **must** reach every waiter, or they
  block forever on the condition variable — so the event pump catches *any* exception, stores it
  as `_failure` and notifies all waiters (`acp_adapter/gateway_server.py:907-930`). A transport loss
  or a dismissed card is **not** a denial: the canonical waiter belongs to the execution and may
  still be answered by another viewer (`acp_adapter/gateway_server.py:1078-1101`).
- **Surprising:** `_bypass_route()` refuses `--safe-mode` / `--ignore-user-config` launches that
  carry no model and no provider, because the owner accepts a model alone but then its first turn
  cannot build the agent — the failure is moved to `session/new` where it can be explained
  (`acp_adapter/gateway_server.py:55-67,281-290`).

#### `hermes_platform/declaration.py`
- **Purpose:** parse and register application requirements shared by MCP and skill offer-time gates.
- **Key abstractions:** `AppSpec`, `RequiresSpec`, `Declaration`, `parse_app`, `parse_requires`,
  `parse_declaration` (`hermes_platform/declaration.py:233`), `register` /
  `unregister` / `lookup` / `clear`, `DeclarationError`, `GPU_LABELS`
  (`hermes_platform/declaration.py:83`).
- **Data flow:** a manifest's `app:` / `requires:` blocks → validated dataclasses → the process
  registry (`_REGISTRY`, guarded by `_REGISTRY_LOCK`) → a `Declaration` the resolver consumes.
- **Non-obvious design decisions:** `app` and `requires` are **separate on purpose** — "one is
  data, one is policy" (`hermes_platform/declaration.py:45-47`). Validation is exhaustive and
  cross-checks the two: `requires.min_version` requires `requires.app: true` *and* a version
  source under the relevant OS block, with the Linux exception spelled out (Linux has no version
  source, so a Linux-only declaration is gated on presence only)
  (`hermes_platform/declaration.py:200-231`). A path must be absolute or start with `~` / `%VAR%` /
  `$VAR`, and may not contain `..`, `**` or a URL scheme (`hermes_platform/declaration.py:101-116`).
- **Edge cases & failure handling:** every parse failure raises `DeclarationError` with a
  human-readable `where` label; the registry never raises on `register`.
- **Surprising:** `requires.gpu` accepts only `"nvidia"`, and the comment explains why a broader
  set would be wrong: `facts.gpu_class()` reports the *highest-priority* vendor present, which
  answers "is an NVIDIA GPU here" exactly but would not answer it for AMD or Intel on a machine
  that also has an NVIDIA GPU (`hermes_platform/declaration.py:79-86`).

#### `hermes_platform/host/facts.py`
- **Purpose:** cached OS, architecture, CPU, memory and GPU facts for the current machine.
- **Key abstractions:** `os_family()`, `process_arch()`, `native_arch()`
  (`hermes_platform/host/facts.py:80`), `cpu_model()` (`:163`), `cpu_vendor()`,
  `ram_total_bytes()` (`:235`), `gpu_class()` (`:320`), `nvidia_gpus()` (`:386`),
  `interactive_session()` (`:412`), `clear_caches()` (`:425`), plus pure parsers
  (`parse_cpuinfo`, `parse_cpuinfo_vendor`, `parse_meminfo_total`, `parse_windows_display_adapters`,
  `parse_nvidia_gpu_model`, `classify_gpu_vendors`).
- **Data flow:** the registry / sysctl / IOKit / procfs / sysfs → a cached value per process.
- **Non-obvious design decisions:** **facts take no environment-variable input and never spawn a
  subprocess** — a hardware recognizer cannot be set from a shell
  (`hermes_platform/host/facts.py:5-7`, and `hermes_platform/AGENTS.md`). Native architecture uses
  `IsWow64Process2`, never `PROCESSOR_ARCHITECTURE` alone (it reads AMD64 under x64-on-ARM64
  emulation), and on macOS uses `sysctl.proc_translated` for Rosetta
  (`hermes_platform/host/facts.py:80-93`). The pure parsers are separated from the readers so the
  parsing rules are testable without a machine. Every fact is `functools.cache`d and
  `clear_caches()` exists for tests.
- **Edge cases & failure handling:** every reader returns a safe empty value on failure
  (`_read_text` returns `""`, `_winreg_str` returns `""`, `_sysctl_*` return `None`); `gpu_class()`
  returns the string `"unknown"` (not `None`) when devices were seen but none could be read.
- **Surprising:** the GPU-class priority is a fixed order
  (`nvidia` > `amd` > `intel`) because a discrete vendor wins over an integrated one on hybrid
  machines (`hermes_platform/host/facts.py:262-270`).

#### `hermes_platform/host/darwin_pci.py`
- **Purpose:** read macOS PCI display controllers from the IOKit registry via `ctypes`.
- **Key abstractions:** `display_vendor_ids() -> list[str] | None` (`hermes_platform/host/darwin_pci.py:50`).
- **Data flow:** `IOServiceMatching("IOPCIDevice")` → iterate up to 256 devices → read the
  `class-code` / `vendor-id` CFData properties → keep the display-class ones.
- **Non-obvious design decisions:** the matching dictionary is **consumed** by the call, so it is
  created fresh inside the loop over a bounded device count; every CF object is released in a
  `finally` (`hermes_platform/host/darwin_pci.py:57-86`). Apple silicon has no PCI display
  controller, which is why `gpu_class()` short-circuits on `arm64`.
- **Edge cases & failure handling:** returns `None` when IOKit cannot be read at all (the caller
  treats that as `unknown`, not as "no GPU").
- **Surprising:** reads happen with no environment-variable input and no subprocesses — a policy
  the whole `host/` package follows.

#### `hermes_platform/host/gpu_adapters.py`
- **Purpose:** Windows graphics adapters as DXGI reports them.
- **Key abstractions:** `Adapter` (frozen dataclass with a `memory_bytes` property
  (`hermes_platform/host/gpu_adapters.py:32`)), `windows_gpu_adapters()`
  (`hermes_platform/host/gpu_adapters.py:62`).
- **Data flow:** `CreateDXGIFactory1` → `EnumAdapters1` → `GetDesc1` → an `Adapter` per device.
- **Non-obvious design decisions:** "Task Manager's GPU memory" is **DXGI dedicated + shared
  system memory**, and that sum is what Windows lets the adapter allocate — an integrated GPU has
  almost no dedicated memory, so its shared allowance is its real pool (`hermes_platform/host/gpu_adapters.py:3-9`).
  The software-renderer flag (`DXGI_ADAPTER_FLAG_SOFTWARE`) is captured so the Basic Render Driver
  is not mistaken for a real GPU. The vtable is walked by hand with explicit slot indices.
- **Edge cases & failure handling:** off Windows, or when DXGI cannot answer, the function returns
  an empty tuple (`functools.cache`d, with `suppress(OSError, AttributeError)`).
- **Surprising:** the adapter list is capped at 16 and every COM object is `Release`d in a
  `finally` — a leak here would be invisible in a long-lived desktop process.

#### `hermes_platform/host/products.py`
- **Purpose:** NVIDIA platform recognition derived from host facts.
- **Key abstractions:** `classify_nvidia_platform(*, os_family, native_arch, cpu_model, gpu_class,
  nvidia_gpus)` (`hermes_platform/host/products.py:23`), `nvidia_platform()`
  (`hermes_platform/host/products.py:45`), `is_nvidia_n1x_pci_id(pci_id)`, `NvidiaPlatform` literal.
- **Data flow:** host facts → `rtx_spark` / `dgx_spark` / `discrete` / `None`.
- **Non-obvious design decisions:** the classifier is a **pure function of injected facts**, and the
  cached-facts wrapper is separate — so the rules are testable without the hardware. The PCI-id
  helper masks the low 16 bits because NVML packs the device id *above* the 16-bit vendor id.
- **Edge cases & failure handling:** returns `None` (not "discrete") when the host has no NVIDIA
  GPU.
- **Surprising:** the docstring states plainly which branches were **verified on hardware** and
  which were not ("Not verified on hardware: the GB10 model name in
  `/proc/driver/nvidia/gpus/*/information`") — an honest confidence marker
  (`hermes_platform/host/products.py:45-58`).

#### `hermes_platform/host/runtime.py`
- **Purpose:** cached runtime-environment predicates for WSL, containers and Termux.
- **Key abstractions:** `is_termux()` (`hermes_platform/host/runtime.py:8`), `is_wsl()` (`:17`),
  `is_container()` (`:32`), `_root_mount_has_marker` (`:66`).
- **Data flow:** `/proc/version`, `/.dockerenv`, `/run/.containerenv`,
  `KUBERNETES_SERVICE_HOST`, `/proc/1/cgroup`, `/proc/self/mountinfo` → a cached bool.
- **Non-obvious design decisions:** under cgroup v2 **only the root mount** identifies this
  process's container; scanning all mountinfo lines misclassifies hosts that *run* containers
  (#58135, `hermes_platform/host/runtime.py:58-63`).
- **Edge cases & failure handling:** every read failure degrades to `False`; all three predicates
  are cached in module globals.
- **Surprising:** `is_termux` *does* read `PREFIX` / `TERMUX_VERSION` from the environment — the
  "no env input" rule is about **hardware** facts, and this is a runtime-environment fact.

#### `hermes_platform/host/summary.py`
- **Purpose:** one summary of the machine and its OS account, for desktop first-run onboarding.
- **Key abstractions:** `summary()` (`hermes_platform/host/summary.py:149`),
  `full_name_from(login, full)` (`:61`), `_locale()` (`:123`), `_account()`.
- **Data flow:** host facts + OS user records (`pwd` / Win32 / CoreFoundation) → a dict with
  `machine`, `machine_kind`, `has_nvidia_gpu`, `nvidia_platform`, `locale`, `full_name`.
- **Non-obvious design decisions:** account facts come from OS user records, **never from `HOME` or
  `LANG`**, and never from a subprocess or the network
  (`hermes_platform/host/summary.py:5-8`). A login handle is never offered as the user's name:
  `full_name_from` rejects generic accounts, handles, all-lowercase names, and anything with
  digits/underscores (`hermes_platform/host/summary.py:61-75`). On macOS the OS release is
  `platform.mac_ver()[0]`, not the Darwin kernel version
  (`hermes_platform/host/summary.py:141-144`).
- **Edge cases & failure handling:** a key that was not measured is **left out** of the `machine`
  dict entirely (not set to `None`) — "leaves out a key that was not measured"
  (`hermes_platform/host/summary.py:161-170`).
- **Surprising:** the docstring warns that the summary describes the machine running the **backend**,
  which is not the user's laptop when the desktop app drives a remote backend
  (`hermes_platform/host/summary.py:8-9`).

#### `hermes_platform/resolver/base.py`
- **Purpose:** the resolver protocols and the results of the two non-passive tiers.
- **Key abstractions:** `Effort` enum (`LOCAL` / `NETWORK` / `DIAGNOSTIC`,
  `hermes_platform/resolver/base.py:16`), `Inspection` (`:25`), `Probe` (`:35`), `Resolver`
  protocol (`:45`), `Probeable` protocol (`:54`).
- **Data flow:** the tier contract — `locate` (metadata only), `inspect` (bounded file reads and
  in-process OS APIs), `probe` (fresh, never cached, the only tier that may open a socket or spawn).
- **Non-obvious design decisions:** `Effort.NETWORK` **never implies subprocess**; only
  `DIAGNOSTIC` alone may spawn (`hermes_platform/resolver/base.py:16-20`). `Probe.__bool__`
  **raises** `TypeError` — "Probe is not a boolean; read .running/.answering" — so nobody can
  accidentally treat a probe as a truth value (`hermes_platform/resolver/base.py:42-44`).
- **Edge cases & failure handling:** `Inspection.ok` is false only when a state is `error`; a
  `not_checked` observation is not an error.
- **Surprising:** `Inspection` carries a `signer` observation that the whole `app.py` resolver
  never populates (always `not_checked`) — a reserved slot.

#### `hermes_platform/resolver/core.py`
- **Purpose:** the result and context types shared by every resolver, plus passive command location.
- **Key abstractions:** `ABSENT` sentinel (`hermes_platform/resolver/core.py:26`), `CheckState`
  (`:29`), `Observation` (`:38`), `Candidate`, `LookupContext` (`:58`), `Resolution`,
  `locate_command(name, ctx, known_dirs=())` (`:116`).
- **Data flow:** a name → candidates (PATH, then known dirs) → a `Resolution` whose `kind` is one of
  `explicit_path` / `path_executable` / `known_path` / `package_runner` / `missing`.
- **Non-obvious design decisions:** `LookupContext.path` is a **tri-state**: `ABSENT` = the caller
  did not say, `None` = ambient, `""` = search nothing
  (`hermes_platform/resolver/core.py:58-64`) — so "search nothing" and "use the ambient PATH" are
  distinguishable. An explicit relative path is **not trusted** (only absolute paths are), because
  it would resolve against the ambient cwd
  (`hermes_platform/resolver/core.py:126-131`). An explicit `pathext` is honoured without mutating
  `os.environ` (`shutil.which` reads `PATHEXT` from the environment)
  (`hermes_platform/resolver/core.py:88-97`).
- **Edge cases & failure handling:** `locate_command` never opens a file, spawns, or connects.
  `_known_dir_variants` enumerates the `PATHEXT` suffixes on Windows so one candidate per known
  dir is recorded.
- **Surprising:** `Resolution.kind` includes `"package_runner"`, which no resolver in this shard
  ever produces.

#### `hermes_platform/resolver/app.py`
- **Purpose:** the desktop-application resolver over an `AppDef` (from an MCP manifest's `app:`
  block).
- **Key abstractions:** `AppLocation`, `AppDef`, `Endpoint` (a `__repr__` that redacts the token),
  `AppResolver` with `locate` (`:93`) / `inspect` (`:101`) / `probe` (`:136`) / `endpoint` (`:123`),
  `LOCATION_KINDS` (`:220`), `_mcp_initialize` (`:405`), `_endpoint_observation` (`:387`).
- **Data flow:** a declared `AppDef` → `locate` (stat every declared location in order) →
  `inspect` (read the version source in-process) → `probe` (re-read the vendor's runtime file on
  every call) → `Endpoint`.
- **Non-obvious design decisions:**
  - The three tiers are kept strictly apart: `locate` stats only, `inspect` may open files and call
    OS APIs, `probe` is fresh and never cached.
  - A `*` path segment stands for a versioned folder, and the **highest version is tried first**
    (`_version_order` splits digits so `5.10` > `5.9`) (`hermes_platform/resolver/app.py:171-183`).
  - The **bearer token in the vendor's runtime file never leaves the module**: `_Session.__repr__`
    redacts it and `Endpoint.__repr__` redacts it
    (`hermes_platform/resolver/app.py:71-80,300-313`).
  - The endpoint must be a **loopback plain-http URL with a numeric port and no userinfo**; the
    path is fixed by the declaration, not by the vendor's file
    (`hermes_platform/resolver/app.py:387-403`).
  - A UNC `InstallLocation` is skipped so a presence check never touches the network
    (`hermes_platform/resolver/app.py:190-196`).
  - `probe` performs an MCP `initialize` POST under **one absolute deadline** covering connect,
  headers and body — a `remaining()` helper re-derives the time left at each step
    (`hermes_platform/resolver/app.py:405-441`).
- **Edge cases & failure handling:** a vendor's plist/PE/registry entry is treated as untrusted
  input — an exception becomes `Observation(CheckState.ERROR, detail=exc.__class__.__name__)` and
  never aborts the caller (`hermes_platform/resolver/app.py:105-117`). An HTTP 401/403 counts as
  "answering" (the server is up and authenticating).
- **Surprising:** `_endpoint_observation` rejects a non-loopback host outright — the vendor's
  runtime file is untrusted input that could otherwise point the probe at the internet.

#### `hermes_platform/resolver/availability.py`
- **Purpose:** decide whether a catalog entry can be **offered** on this host, from its `app` and
  `requires` blocks.
- **Key abstractions:** `Availability` (a frozen dataclass whose `__bool__` **raises**
  `TypeError` — "read .offerable or .state", `hermes_platform/resolver/availability.py:57`),
  `availability(entry, *, os_family=None)` (`:80`), `version_at_least(found, minimum)` (`:69`),
  `OFFERABLE` (`:27`), `AvailabilityState` literal.
- **Data flow:** a declaration + the host's cached GPU fact → `locate` + `inspect` → an
  `Availability` with one of `available` / `installed_not_running` / `missing_app` /
  `version_too_old` / `unsupported_os` / `unsupported_gpu` / `no_requirements`.
- **Non-obvious design decisions:** an unreadable GPU (`unknown`) **passes** — "refusing on a
  failed registry or sysfs read would lock out the machines that have the GPU"
  (`hermes_platform/resolver/availability.py:102-105`). **Every present copy is read** for its
  version, so an old copy found first does not hide a newer one found later; location order only
  breaks ties among qualifying copies (`hermes_platform/resolver/availability.py:118-127`).
  Version comparison **fails closed** on invalid input (`hermes_platform/resolver/availability.py:69-77`).
- **Edge cases & failure handling:** `availability` runs `locate`, `inspect` and the cached GPU
  fact only — it never probes, never spawns, never connects, and holds **no cache** (the callers
  that need a TTL already have one) (`hermes_platform/resolver/availability.py:5-8`).
- **Surprising:** the module deliberately avoids importing `hermes_cli` by depending on the
  `_HasRequirements` Protocol slice instead (`hermes_platform/resolver/availability.py:30-40`).

#### `hermes_platform/resolver/known_dirs.py`
- **Purpose:** the tables of directories where tools install outside PATH, grouped by ecosystem.
- **Key abstractions:** `homebrew_dirs()` (`hermes_platform/resolver/known_dirs.py:16`),
  `user_local_bin`, `rust_tool_dirs`, `node_tool_dirs`, `hermes_vendored_dirs`,
  `machine_marker_files()` (`:36`), `hermes_home_globs`, `gateway_service_definition_globs()` (`:57`),
  `system_gateway_service_definition_globs`, `mac_privacy_protected_dirs`,
  `windows_user_program_dirs`, `visual_studio_installer_dirs`, `mac_application_dirs`,
  `flatpak_export_dirs`, `snap_bin_dirs`.
- **Data flow:** none — pure tables, read by the resolvers.
- **Non-obvious design decisions:** **every table in Hermes lives here**; a directory literal
  outside this module fails the ratchet in `tests/test_managed_runtime_resolution.py`
  (`hermes_platform/resolver/known_dirs.py:3-6`). Each table is **empty on an OS where the
  ecosystem does not install there**, so callers compose tables without OS branches
  (`hermes_platform/resolver/known_dirs.py:6-8`).
- **Edge cases & failure handling:** `machine_marker_files` reads the *first* entry but also reads
  the rest, because MSIX builds that ran with filesystem virtualisation wrote under the package's
  `LocalCache` (`hermes_platform/resolver/known_dirs.py:36-44`).
- **Surprising:** `mac_privacy_protected_dirs` exists so the resolver can avoid opening anything
  that would raise a TCC permission prompt (`hermes_platform/resolver/known_dirs.py:67-72`).

#### `hermes_platform/resolver/__init__.py`
- **Purpose:** the resolver package's public surface.
- **Key abstractions:** re-exports `Effort`, `Inspection`, `Probe`, `Probeable`, `Resolver`,
  `Resolution`, `Observation`, `CheckState`, `Candidate`, `LookupContext`, `ABSENT`,
  `locate_command`.
- **Data flow:** n/a.
- **Non-obvious design decisions:** the package exports a **closed vocabulary** — everything a
  consumer may branch on is in `__all__`, so a new tier cannot be added without editing the
  package's public surface.
- **Edge cases & failure handling:** n/a.
- **Surprising:** `app.py` imports `known_dirs` from the package (`from hermes_platform.resolver
  import known_dirs`) while the package's `__init__` imports `base` and `core` — a circular-ish
  arrangement that works only because `app` is not imported by `__init__`.

#### `hermes_platform/host/__init__.py`
- **Purpose:** the cached-facts package's public surface.
- **Key abstractions:** re-exports `interactive_session` only.
- **Data flow:** n/a.
- **Non-obvious design decisions:** only *one* symbol is exported, and the docstring states the
  constraint that the whole package obeys: "Facts use hardware sources without environment-variable
  input or subprocesses" (`hermes_platform/host/__init__.py:1-5`).
- **Edge cases & failure handling:** n/a.
- **Surprising:** `facts` itself is not re-exported, so consumers import
  `hermes_platform.host.facts` directly (as `summary.py` and `products.py` do).

#### `hermes_platform/__init__.py`
- **Purpose:** the package docstring — "Machine facts and resource resolution for every Hermes
  surface. Host facts describe the machine running this interpreter; resolution has no side
  effects."
- **Key abstractions:** none.
- **Data flow:** n/a.
- **Non-obvious design decisions:** the "no side effects" half of the contract is stated in the
  package docstring itself, which is the visible guardrail for every resolver.
- **Edge cases & failure handling:** n/a.
- **Surprising:** a two-line `__init__` that carries a real architectural rule.

#### `native/fts5_cjk/fts5_cjk.c`
- **Purpose:** a `cjk_unicode61` FTS5 tokenizer — unicode61 plus CJK character bigrams
  (Lucene CJKAnalyzer semantics).
- **Key abstractions:** `cjk_is_cjk(cp)` (`native/fts5_cjk/fts5_cjk.c:34`),
  `cjk_emit(...)` (`:96`), `cjkInnerCallback`, `cjkCreate` (`:173`), `cjkDelete`, `cjkTokenize`,
  `sqlite3_ftscjk_init` (`:231`), `sqlite3_fts5_cjk_init` (alias).
- **Data flow:** text → unicode61 tokenizer → every emitted token re-examined → maximal CJK runs
  re-emitted as overlapping character **bigrams**; non-CJK segments pass through unchanged.
- **Non-obvious design decisions:** the whole point is the FTS5 phrase semantics: consecutive
  tokens emitted from one query term become a phrase, so `캘린더` → `[캘린][린더]` gives exact
  substring semantics at index speed, down to 2-character terms
  (`native/fts5_cjk/fts5_cjk.c:14-19`). A fast path scans for any CJK first and passes the token
  through untouched if there is none (`native/fts5_cjk/fts5_cjk.c:102-110`). A lone CJK character
  (run length 1) is emitted as a **unigram**
  (`native/fts5_cjk/fts5_cjk.c:158-163`). The `fts5_api` pointer is obtained by preparing
  `SELECT fts5(?1)` and binding a pointer (`native/fts5_cjk/fts5_cjk.c:220-229`).
- **Edge cases & failure handling:** invalid UTF-8 bytes decode as themselves so segmentation still
  terminates (`native/fts5_cjk/fts5_cjk.c:56-77`); every emitted offset is clamped to
  `[iStart, iEnd)` (`native/fts5_cjk/fts5_cjk.c:96-100`).
- **Surprising:** the header comment quantifies the problem it fixes — a 2-character Korean query
  fell through to a full-table `LIKE` scan measured at **3–6 s per query on a 6.8 GB messages
  table**, the #1 driver of `session_search` latency (`native/fts5_cjk/fts5_cjk.c:6-12`).

#### `native/fts5_cjk/build.sh`
- **Purpose:** build `libfts5_cjk.so` and install it to `~/.hermes/lib/` (or `$1`).
- **Key abstractions:** none (a 19-line shell script).
- **Data flow:** `fts5_cjk.c` → `gcc -shared -fPIC -O2` → `install -m 0644` into the destination.
- **Non-obvious design decisions:** the script **probes for the system `sqlite3ext.h`** and falls
  back to the vendored copy with `-Ivendor`, so the build works without `libsqlite3-dev`
  (`native/fts5_cjk/build.sh:10-16`).
- **Edge cases & failure handling:** `set -euo pipefail`; the destination directory is created if
  missing.
- **Surprising:** it builds only a `.so` — there is no Windows build path, and the C source
  `#ifdef _WIN32` exports exist for a manual build.

#### `providers/base.py`
- **Purpose:** the `ProviderProfile` base class — everything about an inference provider declared
  in one place.
- **Key abstractions:** `ProviderProfile` (`providers/base.py:42`), `OMIT_TEMPERATURE` sentinel
  (`:24`), `fetch_models` (`:361`), `supported_reasoning_efforts` (`:285`), `create_client` (`:326`),
  `resolve_aux_model` (`:166`), `listed()` (`:314`), `prepare_messages`, `build_extra_body`,
  `build_api_kwargs_extras`, `default_reasoning_config`, `get_model_context_length`,
  `get_max_tokens`, `get_usage_cost`, `fetch_account_usage`, `setup_status`, `discover_models`.
- **Data flow:** the transport calls the profile's hooks on **every request**
  (`prepare_messages` → `build_extra_body` → `build_api_kwargs_extras`); discovery surfaces call
  `fetch_models` and `listed()`.
- **Non-obvious design decisions:**
  - The profile is **declarative**: it does not own client construction, credential rotation or
    streaming — those stay on `AIAgent` (`providers/base.py:6-10`).
  - `OMIT_TEMPERATURE` is a **sentinel object**, not `None`, because `None` means "use the caller's
    default" and the sentinel means "do not send temperature at all" (Kimi: the server manages it)
    (`providers/base.py:24,138`).
  - `supported_reasoning_efforts` is **tri-state** and the semantics are spelled out: `None` =
    undeclared (keep the transport default), `()` = the model accepts **no** reasoning parameters
    (some gateways 400 rather than ignore), a non-empty tuple = clamp the requested effort onto
    these levels (never escalate) — and it **must be cache-only**, because it is on the request hot
    path (`providers/base.py:285-313`).
  - `create_client` returning `None` is always safe, and the hook is what lets a provider ship
    **outside the tree** (a `$HERMES_HOME` plugin or a pip entry point can supply its own
    transport with no core edit) (`providers/base.py:326-359`).
  - `resolve_aux_model` exists because a hardcoded cheap-model id **rots**: when the provider
    retires it, every auxiliary call spends a round-trip 404ing before the retry net catches it
    (`providers/base.py:166-183`).
  - `supports_prompt_cache_key` is opt-in only, because many OpenAI-compatible endpoints **reject
    unknown top-level fields** rather than ignoring them (`providers/base.py:110-114`).
  - `listed()` for a hidden (pre-release) provider reads `auth.json` only, because it runs on every
    picker build (`providers/base.py:314-324`).
- **Edge cases & failure handling:** `fetch_models` returns `None` on any failure (callers must
  fall back to the static list) and sets a `hermes-cli/<version>` User-Agent because some
  providers sit behind a WAF that 403s the default `Python-urllib` UA
  (`providers/base.py:28-39,393-397`). `fetch_account_usage` must fail open at the dispatch
  boundary.
- **Surprising:** the `auth_handler` / `refresh_credential` / `classify_api_error` hooks let a
  provider own its own token endpoints; Hermes passes no secrets beyond the pooled row itself
  (`providers/base.py:80-95`).

#### `providers/__init__.py`
- **Purpose:** the provider module registry and the plugin-discovery layer.
- **Key abstractions:** `register_provider(profile)` (`providers/__init__.py:122`),
  `get_provider_profile(name)` (`:192`), `list_providers()` (`:260`),
  `unlisted_provider_names()` (`:285`), `provider_source(name)`, `_HomeLayer` (`:68`),
  `_refresh_home_layer` (`:326`), `_discover_providers` (`:643`), `_discover_entry_point_providers`,
  `_import_plugin_dir`, `_sync_auth_registry`.
- **Data flow:** plugin directories (bundled, `$HERMES_HOME`, pip entry points) → import →
  `register_provider()` → the registry → every downstream layer reads the profiles.
- **Non-obvious design decisions:**
  - **Per-home layers.** One process serves many profiles (multiplex gateway, Desktop `serve`), so
    user plugins are keyed by the home bound **at lookup time**, not the home bound at first
    discovery — otherwise a plugin installed in a secondary profile was "Unknown provider" in
    Desktop while the same profile worked in a terminal (#88143)
    (`providers/__init__.py:68-90`).
  - The layer a `$HERMES_HOME` plugin import registers into is a **ContextVar**, not a module
    global, so two turn threads scanning two profile homes cannot cross-register — and no lock is
    held across the import itself (a thread mid-`import hermes_cli.auth` whose import calls
    `list_providers()` would deadlock) (`providers/__init__.py:95-100`).
  - Discovery is **lazy** and the plugin-dir mtimes are a **stamp** with a 1 s TTL, so a plugin
    installed while the process runs is discovered without a restart and without two filesystem
    stats on every model lookup (`providers/__init__.py:64,326-352`).
  - Precedence is explicit: pip entry points are discovered **first** (lowest precedence) so a
    third-party package cannot hijack a first-party provider name; bundled plugins next; legacy
    single-file `providers/<name>.py` modules last (`providers/__init__.py:643-720`).
  - A user plugin's module name is a **hash of the home key** plus the plugin name, so two
    profiles can carry the same plugin without aliasing each other's registrations
    (`providers/__init__.py:451-453`).
  - Entry-point plugins are **opt-in**: they are subject to the same `plugins.enabled` allow-list
    the general PluginManager enforces — "a pip package is never imported just because it is
    installed" (`providers/__init__.py:540-560`).
  - A missing-profile lookup is **memoised per home on the config file's signature** — the miss
    path is ~2.5 ms and is reached per model/prefix, so it must not be paid per iteration
    (`providers/__init__.py:165-190`).
  - A `custom:` route that has no explicit profile **shares the generic wire policy** rather than
    resolving to `None` (`providers/__init__.py:215-224`).
- **Edge cases & failure handling:** a broken third-party package must not break discovery —
  failures are swallowed per entry and logged at warning level
  (`providers/__init__.py:600-620`). `_sync_auth_registry` reaches into `hermes_cli` **only via
  `sys.modules`**, because importing it would run its top-level code mid-scan
  (`providers/__init__.py:105-131`). `safe_worker_enabled()` short-circuits the whole registry
  (`providers/__init__.py:193-197`).
- **Surprising:** `list_providers()`'s cache is invalidated on every process-wide registration but
  a home-layer registration does not clear it — the cache holds the *process-wide* layer only, and
  the home layer is merged on top (`providers/__init__.py:260-280`).

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `hermes_platform/AGENTS.md` | The rule that makes the whole platform layer trustworthy: machine facts go through `hermes_platform.host` only, take **no environment-variable input**, and `host.*` answers for the control host only (not an SSH target or the Desktop client). A bare `shutil.which` or a hand-written known-path table outside `hermes_platform/` fails `tests/test_managed_runtime_resolution.py` unless allowlisted with a reason; lookup never installs, downloads or starts anything. |
| `native/fts5_cjk/README.md` | Decides the install contract for the CJK tokenizer: `./build.sh` → `~/.hermes/lib/`, system `sqlite3ext.h` when available else the vendored copy, the next `SessionDB` open creates the `messages_fts_cjk` index (external-content, tool rows excluded), `hermes sessions optimize-storage` backfills it, `sessions.cjk_fts: false` disables it, `HERMES_FTS5_CJK_SO` overrides the `.so` path. |
| `providers/README.md` | Decides the provider architecture: every provider is declared once as a `ProviderProfile`; every other layer reads the profiles instead of keeping a parallel copy. Names the eight downstream consumers (auth, models, doctor, config, runtime_provider, model_metadata, auxiliary_client, transport) and the six overrideable hooks, including the tri-state `supported_reasoning_efforts`. |

### Tier 3 — skipped with a reason

| File | Why it was not read line by line |
| --- | --- |
| `assets/backgrounds/squircle-dark.svg` | Asset (236 B). Read in full (4 lines) to confirm: a single 1024×1024 `<rect rx=245>` app-icon background in `#0d1117`. No logic. |
| `assets/backgrounds/squircle-light.svg` | Asset (235 B). Read in full (4 lines): the same rect in `#ffffff`. |
| `assets/backgrounds/squircle-mac-dark.svg` | Asset (388 B). Read in full (6 lines): the macOS-HIG variant, 824×824 at `rx=185.4` with 100 px transparent margins. |
| `assets/backgrounds/squircle-mac-light.svg` | Asset (387 B). Read in full (6 lines): the same macOS-HIG rect in white. |
| `assets/banner.png` | Binary asset (12,333 B). Confirmed on disk: PNG magic `89 50 4E 47 0D 0A 1A 0A` + `IHDR`; dimensions read from the header, contents not decoded. |
| `assets/dmg-volume.png` | Binary asset (285,680 B). Confirmed on disk: PNG magic + `IHDR`; a macOS DMG volume-icon bitmap, no code. |
| `assets/icon-master-dark.svg` | Vector artwork (137,768 B). Head/tail peeked: a single `<path>` of Bézier data (`inkscape:label` in the tail) — the app icon master, no logic. |
| `assets/icon-master.svg` | Vector artwork (116,350 B). Head/tail peeked: the same path data, light variant. |
| `assets/nous-girl-black.svg` | Vector artwork (118,169 B). Head/tail peeked: one `<path>`, the mascot, `inkscape:label="nous girl"`. |
| `assets/nous-girl-white.svg` | Vector artwork (139,596 B). Head/tail peeked: the same mascot path, light variant. |
| `native/fts5_cjk/vendor/sqlite3.h` | Vendored upstream artefact (675,743 B): the public-domain SQLite amalgamation header. Head/tail read to confirm (the SQLite "blessing" banner; the file ends with the fts5.h include block and `#endif /* SQLITE3_H */`). Not Hermes logic; 675 KB of upstream C API declarations. |
| `native/fts5_cjk/vendor/sqlite3ext.h` | Vendored upstream artefact (39,044 B): the public-domain SQLite loadable-extension header. Head/tail read to confirm (`SQLITE_EXTENSION_INIT1/2/3` macros). Not Hermes logic. |

---

## 2. Ideas worth stealing

1. **A "the turn ended but left a bubble spinning" flush is a first-class concern.**
   `acp_adapter/events.py:97` (`flush_open_tool_calls`) and
   `acp_adapter/gateway_reply.py:71-80` (`_flush_open_tools`) both close every tool call the turn
   left open as `failed`/`abandoned`, with the honest text "ended without a result (blocked,
   denied, or interrupted)". *Why it transfers:* August Trading's transcript holds a tool trail per
   message; a turn that aborts mid-tool leaves a row that never settles, and a row that never
   settles is a row a reader counts. **UNIQUE** to this repo — the other two repos have no
   per-tool-call lifecycle to flush.
2. **Distinguish "not answered" from "declined" in every approval round-trip.**
   `acp_adapter/elicitation.py:40-53` returns `""` for a decline/cancel (the universal skip) and
   `None` for "not answered"; `acp_adapter/gateway_server.py:1078-1101` treats a transport loss or
   a dismissed card as **not a denial**, so the canonical waiter can still be answered by another
   viewer. *Why it transfers:* August's approval inbox and bot-approval flow need the same
   three-way answer, or a transport hiccup silently converts "unanswered" into "denied" and the
   trader's plan is dropped. **UNIQUE.**
3. **The approval timeout is a *user setting*, read per request — never a constant.**
   `acp_adapter/permissions.py:117-126` resolves `approvals.timeout` (default 300 s) instead of
   the 60 s the bridges used to hardcode, with the incident recorded: a host whose card was still
   waiting saw Hermes self-deny. *Why it transfers:* the same bug shape exists wherever a timeout
   is written into a bridge. **UNIQUE.**
4. **One table of "what this surface answers itself", with everything else forwarded to the owner.**
   `acp_adapter/gateway_commands.py:186-200` (`ROUTES`) plus the parity script that documents it.
   *Why it transfers:* August has a growing set of surfaces (chat, dock, bot turns, automations);
   a single "who answers this verb" table with a generated parity check stops the surfaces from
   drifting. **UNIQUE** in this shape; the *idea* of a shared command table is **CONVERGENT** with
   `constants/promptRegistry.ts` in August.
5. **Fail-closed observation enums instead of booleans.**
   `hermes_platform/resolver/core.py:29-56` (`CheckState`: `not_checked` / `present` / `absent` /
   `unavailable` / `error`) and `Observation(state, value, detail)`; `Availability.__bool__` and
   `Probe.__bool__` **raise** so nobody can branch on a truth value
   (`hermes_platform/resolver/availability.py:57`, `hermes_platform/resolver/base.py:42-44`).
   *Why it transfers:* August's provider-health and model-capability checks are booleans today;
   an `Observation` with a `detail` string would let a UI say *why* a provider is unavailable
   instead of just "not ready". **UNIQUE.**
6. **A three-tier resource-resolution contract with an explicit effort budget.**
   `hermes_platform/resolver/base.py:16-20` — `locate` (metadata only), `inspect` (bounded reads
   and in-process OS APIs), `probe` (fresh, never cached, the only tier that may open a socket or
   spawn), with `Effort.NETWORK` never implying a subprocess. *Why it transfers:* August's market
   data fetches and tool registry would benefit from a tier that says exactly what a check is
   allowed to do — and a "probe" tier that is explicitly allowed to be expensive. **UNIQUE.**
7. **A declarative provider profile that every layer reads, instead of parallel data.**
   `providers/base.py:42` + `providers/README.md` (one `ProviderProfile` per provider; the
   transport, auth, models, doctor, config and metadata layers all read it). *Why it transfers:*
   August's `ProviderConfigService` + `utils/providerUtils.ts` already do part of this, but the
   **hook** pattern — `prepare_messages`, `build_extra_body`, `build_api_kwargs_extras`,
   `supported_reasoning_efforts` — is the part worth copying: each provider's wire quirks live in
   the provider, not in the transport. **CONVERGENT** with the other two repos' provider layers.
8. **A tri-state reasoning-effort vocabulary that fails closed.**
   `providers/base.py:285-313` — `None` (undeclared, keep the transport default), `()` (the model
   accepts **no** reasoning parameters; some gateways 400 rather than ignore), a tuple (clamp onto
   these levels, never escalate). *Why it transfers:* August has a thinking-tier ladder
   (`EFFORT_CHOICES` / `effortChoiceOf`); a per-model declared vocabulary would let the app refuse
   a tier a gateway would reject, instead of discovering the 400 at runtime. **CONVERGENT** in
   spirit with the other repos' effort ladders.
9. **A "capability row" for the model picker, not a flat list.**
   `acp_adapter/model_catalog.py:156-289` dedupes on **two** keys (the encoded choice id and a
   *semantic* `provider:model` id) so `ollama` and `custom:ollama` are one row, resolves a bare
   `custom` provider to `custom:ollama` by **base-URL identity**, and drops a provider whose
   catalog is authoritative-empty. *Why it transfers:* August's `ModelMenu` shows providers and
   models; the same two-identity dedupe would kill the duplicate rows August must be filtering
   by hand. **UNIQUE.**
10. **A generation counter for "the newest answer wins" on any async write.**
    `acp_adapter/session.py:403-417` (`_claim_cwd_generation`) and
    `acp_adapter/gateway_server.py:243-280` (the `_link` connection generation) — a slow probe or
    a stale transport cannot overwrite a newer claim. *Why it transfers:* August's async
    provider results and bot turns race the same way. **UNIQUE** in this form.
11. **An "ambiguous, never retry" failure mode for a transport loss.**
    `acp_adapter/gateway_server.py:700-710` — if the transport died before the outcome arrived,
    the turn's result is *unknown*, the editor is told "do not resend accepted input", and a
    `/discard <admission id>` control acknowledges the exact lost turn
    (`acp_adapter/gateway_server.py:835-855`). *Why it transfers:* this is exactly the shape of a
    trade that was submitted but whose fill is unknown. **UNIQUE.**
12. **A vendored native extension with a one-line build script and a graceful fallback.**
    `native/fts5_cjk/` — the C tokenizer plus a build script that probes for the system header and
    falls back to the vendored copy, and a README that states the whole operational contract
    (index creation, backfill command, disable flag, `.so` override).
    *Why it transfers:* if August ever needs a native FTS accelerator, the *operational contract in
    the README* is the part to copy. **UNIQUE.**

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** **not in this shard.** The ACP adapter has no cron
  and no periodic digest; the only "long-lived" behaviour is (a) the ACP stdio process being a
  *viewer* of a daemon-owned session (`acp_adapter/entry.py:200-215`) and (b) the gateway's
  `session.replay_gap` recovery, which re-attaches a session after a restart and reconciles what
  was lost (`acp_adapter/gateway_server.py:929-951`). The scheduling itself lives in the
  `hermes-cron` shard.
- **Human-in-the-loop approval:** the **strongest** part of this shard. Three gates, all
  session-scoped and all recorded:
  - *Dangerous commands* — `acp_adapter/permissions.py:77-160`: an ACP `request_permission` with
    `allow_once` / `allow_session` / `allow_always` / `deny` / `deny_always`, mapped to Hermes
    approval strings, with a timeout that returns a **distinct** `"timeout"` verdict so a
    self-deny is never recorded as a user denial.
  - *File edits* — `acp_adapter/edit_approval.py:149-175`: three modes (`ask` /
    `workspace_session` / `session`), with **sensitive paths always asking** (`.env*`, `id_rsa`,
    `id_ed25519`, anything under `.git`/`.ssh`) and the check running per *real* target for
    multi-file patches.
  - *Guarded model switches* — `acp_adapter/gateway_server.py:511-560`: a model pick that needs
    consent is asked as a permission card; a declined pick names the model still in force
    ("Model switch to X was not applied (refused); still using Y").
  The **audit trail** is thin here: the decision lives in the owner's session state and in the
  transcript, not in a separate decision log.
- **Post-mortem / reflection loops:** **not in this shard.** The closest thing is the session
  *provenance* (`acp_adapter/provenance.py:32-79`), which derives "this turn is a continuation of
  a compacted transcript, depth N" from columns that already exist — an example of **reflection
  metadata derived rather than persisted** that a rules/outcome engine could copy: don't add a
  column for "what kind of event was this" if the existing columns already answer it.
- **Multi-agent:** the ACP layer does not debate; it *projects* one execution owner onto many
  viewers. The interesting transfer is the **admission** model (`acp_adapter/gateway_server.py:621-760`):
  a turn has an id, a receipt, an execution generation and a terminal outcome, and a turn that is
  lost is `unknown` rather than failed. For a bot-orchestrated trading app, that is a better
  primitive than a boolean "the turn ran". Debate itself is not in this shard.
- **Structured logs the model can query:** the substrate is a **SQLite store with FTS5**
  (`hermes_state.SessionDB`) plus the `native/fts5_cjk` tokenizer that makes 2-character CJK terms
  indexable instead of a 3–6 s full-table `LIKE` scan
  (`native/fts5_cjk/fts5_cjk.c:6-12`). The *lesson* for August: the "model can query my history"
  feature is an **index**, not a feature — and a native tokenizer is worth writing when the
  substring minimum length exceeds the words people actually use.
- **Staying simple as features accumulate:** the ACP layer's discipline is **one owner, many
  projections**. `acp_adapter/gateway_server.py:1` states it in the module docstring: "ACP
  projection of the profile gateway; never constructs an execution owner." Every surface answer is
  a gateway verb, and the ACP surface adds no execution of its own. The equivalent discipline for
  August is: the Chat surface and the Chart dock should be *projections* of one turn pipeline, not
  two implementations of it.

---

## 4. Non-obvious decisions and gotchas

1. **A physical id and a logical id are different things.** Compression and a canonical reset
   advance the *physical* transcript but never the session identity; the editor holds the logical
   id and the adapter maps between them through a local creation receipt
   (`acp_adapter/catalog.py:24-59`, `acp_adapter/gateway_server.py:333-380`). Reading
   `acp_adapter/catalog.py` as "just a session list" misses the entire design.
2. **`command_op` exists because `is_running` is not enough.** A `/compress` or `/model` handler
   holds the session for *seconds* while the check-then-act window is open; a bare `is_running`
   check would let a prompt claim the turn mid-mutation (`acp_adapter/commands.py:34-40,102-107`).
3. **A `None` text chunk is a protocol sentinel, not "no text".** Hermes sends `None` between
   assistant messages; the adapter treats it as "close the current `messageId`" so the next delta
   opens a new bubble (`acp_adapter/events.py:214-222`).
4. **A tool result's *structured* failure decides "failed", not the word "error" in prose**
   (`acp_adapter/tools.py:168-190`) — but the executor's canonical error prefix is treated as
   structured failure, which is the one place the heuristic is overridden.
5. **`_persist` will destroy pre-compaction history if it writes the whole message set.** The
   guard (`agent._session_db is db and agent._session_db_created` → return early) and the
   `active_only=True` fallback are load-bearing, not defensive decoration
   (`acp_adapter/session.py:343-401`).
6. **The `cwd` comparison must be `realpath`-normalised** or macOS aliases make a workspace's own
   sessions disappear from the history filter (`acp_adapter/session.py:36-62`).
7. **A denied approval is not the same as an expired approval.** `"timeout"` is a third verdict
   (`acp_adapter/permissions.py:140-147`).
8. **"No model and no provider" is refused at `session/new`, not at the first turn** — the owner
   accepts a model alone, and the failure would otherwise surface as "cannot build the agent"
   (`acp_adapter/gateway_server.py:55-67`).
9. **The `host/` facts deliberately refuse environment variables.** `PATH`-shaped env vars cannot
   change a hardware answer, and the module docstring says so explicitly
   (`hermes_platform/AGENTS.md`, `hermes_platform/host/__init__.py:3-5`). The one exception
   (`is_termux` reading `PREFIX`) is a *runtime-environment* fact, not a hardware fact.
10. **`"unknown"` beats `"none"` for an unreadable GPU**, and an unreadable GPU **passes** the
    availability gate (`hermes_platform/host/facts.py:320-340`,
    `hermes_platform/resolver/availability.py:102-105`).
11. **A UNC install path is skipped so a presence check never touches the network**
    (`hermes_platform/resolver/app.py:190-196`), and a vendor runtime file may only name a
    **loopback** endpoint (`hermes_platform/resolver/app.py:387-403`).
12. **A provider's *discovery* order is its *precedence* order** — pip entry points first so they
    lose to everything else (`providers/__init__.py:643-720`).
13. **An installed pip plugin is not an enabled plugin** (`providers/__init__.py:540-560`).
14. **The FTS5 tokenizer's trick is the phrase semantics, not the bigrams.** Bigrams alone would
    match too much; FTS5 turning consecutive tokens from one query term into a phrase is what
    makes `캘린더 → [캘린][린더]` an exact substring match (`native/fts5_cjk/fts5_cjk.c:14-19`).

---

## 5. Weak spots

1. **The ACP adapter is two implementations of one protocol.** `acp_adapter/server.py` (1090
   lines, owns an agent) and `acp_adapter/gateway_server.py` (1178 lines, projects a daemon) solve
   the same problems twice — two slash-command tables (`acp_adapter/commands.py:52-76` vs
   `acp_adapter/gateway_session_meta.py:26-42`), two model pickers, two usage projections, two
   "close the open tool" paths. The parity is maintained by a *generated script*
   (`acp_adapter/gateway_commands.py:181-185`) and by comments, which is a weak substitute for one
   shared implementation. August should not copy the duplication.
2. **Cross-module private coupling is pervasive.** `acp_adapter/catalog.py` imports four
   `_`-prefixed helpers from `acp_adapter.session`; `acp_adapter/model_catalog.py` reaches into
   four private helpers of `hermes_cli.model_switch*`; `acp_adapter/session.py` calls
   `self.session_manager._get_db()` and `self.session_manager._make_agent(...)` from the server.
   A rename in any of those breaks a sibling module with no type error and no test failure.
3. **The provider registry's hot path is defended by memoisation and TTLs rather than by
   structure.** `_PLUGIN_DIR_STAMP_TTL_SECONDS = 1.0` and the per-home config-signature memo
   (`providers/__init__.py:64,165-190`) exist because the registry is consulted per model and per
   prefix. It works, but it means a *filesystem* concern (plugin directories) sits inside the
   *lookup* path of every request — a slow or network-mounted `HERMES_HOME` would degrade every
   model resolution.
4. **`_final_remainder` is a pile of special cases** (`acp_adapter/gateway_reply.py:117-155`):
   `response_reused`, receipts, replay gaps, `cut` sentinels, and segment sets. The exactly-once
   text guarantee is the most valuable behaviour in the adapter and the least readable code in it.
