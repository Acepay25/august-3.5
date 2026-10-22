# hermes-agent :: hermes-state-sessions

**Files in shard:** 23 (read: 23, skipped with reason: 0)
**What this shard covers:** The `hermes_state_*` persistence layer of Hermes — a Python/SQLite session
store split into ~23 mixin modules composed onto one `SessionDB` class via the MRO. It covers:
durable message identity (uid columns, the `api_content` sidecar), session-id minting and the key
derivations the gateway and the store share, the compression lineage (rotation, leases, locks,
cooldowns, anti-thrash counters), per-turn usage/cost accounting with a coalescing background
writer, FTS5 full-text search with a CJK bigram tokenizer and a fail-open corruption path, the
schema/migration engine (declarative column reconciliation, version-gated data migrations,
cross-process rebuild admission), retention/archiving/VACUUM maintenance, title provenance ranking,
a read-only timeline/prompt index, transcript rewrite/rewind semantics, and a "worker" RPC surface
that re-exposes a strictly closed subset of the store to a sandboxed producer process.

## 1. File-by-file

All 23 files in this shard are `source` (Tier 1) — each gets a full entry.

### `hermes_state_api_content.py`
- **Purpose:** Two row-addressed `UPDATE`s that backfill the `api_content` **sidecar** onto a user
  message row (the bytes the model actually saw, which differ from the raw request text because of
  memory prefetch / plugin context).
- **Key abstractions:** `SessionApiContentMixin.set_latest_user_api_content` (positional — targets the
  newest active user row), `SessionApiContentMixin.set_message_api_content` (row-addressed by
  `_row_id`).
- **Data flow:** the turn prologue finds that the current turn's user row was materialized *before*
  the sidecar could be composed → it writes the sidecar afterwards. The crash-persist path then
  marker-skips that message, so this is the only way the stamped bytes reach the store.
- **Non-obvious design decisions:** `set_latest_user_api_content` carries a long warning that the
  positional form is **not safe on its own** — repeated identical user turns ("ok", "y", "continue")
  make an older row compare equal, so calling it before the current turn's row exists overwrites
  the *previous* turn's sidecar with this turn's bytes: "durable wrong-bytes replay, a worse cache
  break than the missing sidecar" (`hermes_state_api_content.py:17-39`).
- **Edge cases & failure handling:** both updates carry `active = 1` and a `content IS ?` guard, so a
  row the compaction archived or a racing rewrite changed is left untouched. `set_message_api_content`
  rejects a non-int / non-positive / bool `row_id` and returns 0 (`hermes_state_api_content.py:55-58`).
- **Surprising:** the sidecar exists *because of* provider prompt caching — a missing or wrong
  sidecar reopens a prompt-cache divergence on reload.

### `hermes_state_compression.py`
- **Purpose:** Compression lineage, cooldown/streak counters, locks and turn leases for `SessionDB`.
- **Key abstractions:** `_CHAIN_STEP_SQL` (the ONE definition of a compression continuation edge),
  `_walk_compression_chain` / `_CHAIN_CAP`, `stamp_compression_ancestors`,
  `SessionCompressionMixin` (`reopen_if_explicitly_closed`, `stamp_legacy_compression_chains`,
  `find_live_compression_child`, `reopen_orphaned_compression_session`,
  `publish_compression_child` / `_publish_compression_child_on_conn`,
  `record_compression_failure_cooldown` / `get_compression_failure_cooldown` /
  `restore_compression_failure_cooldown_row` / `clear_compression_failure_cooldown`,
  `get/set_compression_fallback_streak`, `get/set_compression_ineffective_count`,
  `get/set_compression_recovery_deadline`, `get/set/increment_compression_overload_streak`,
  `refresh_compression_lock`, `try_acquire_compression_lock`, `release_compression_lock`,
  `try_acquire_session_turn_lease`, `acquire_session_turn_lease`, `refresh_session_turn_lease`,
  `release_session_turn_lease`, `finalize_orphaned_compression_sessions`,
  `get_compression_chain`, `get_compression_tip`, `_compression_tip_on`,
  `get_compression_lineage`).
- **Data flow:** a compressor takes a **lease** on the session, publishes a **child session** that
  carries the compacted transcript, and closes the parent — all in one write transaction, so a
  reader sees either the live parent or a complete child, never an ended parent with a missing
  child.
- **Non-obvious design decisions:** the continuation edge is defined **once**
  (`_CHAIN_STEP_SQL`): a child of a parent that ended with `end_reason='compression'`, excluding
  branch / delegate / reset / tool children, preferring a child that continues the chain or is still
  live. The old `child.started_at >= parent.ended_at` test was "too brittle (gateway + compression
  races insert the real continuation before `ended_at` is written)"
  (`hermes_state_compression.py:31-51`). The forward walk is bounded at `_CHAIN_CAP = 1000` with a
  `seen` set guarding cycles — "100 truncated real compression lineages (~180 deep), stranding
  root→tip walks on a stale mid id" (`hermes_state_compression.py:82-108`).
- **Edge cases & failure handling:** `publish_compression_child` takes a **watermark** (the parent's
  highest row already represented in the handoff): rows with `id > watermark` — appends that landed
  during the slow provider summary — are column-cloned into the child *after* the handoff, and a
  `watermark_ceiling` bounds the clone so the rotation path's own pre-publish flush is not
  duplicated (`hermes_state_compression.py:383-440`). The lease check runs on the same connection as
  the write, so there is no TOCTOU window. The failure cooldown **merge-maxes** with any longer
  live deadline ("so a later shorter write cannot reopen the thrash window") while the error column
  always takes the newest diagnostic (`hermes_state_compression.py:520-535`).
  `restore_compression_failure_cooldown_row` **verifies** the restore and raises if it did not land
  — "cancellation must not be reported mutation-free when compensation failed"
  (`hermes_state_compression.py:566-592`).
- **Surprising:** `refresh_compression_lock` decides ownership by `holder` alone, deliberately NOT
  by `expires_at`: "a live owner whose refresher stalled past its TTL must be able to revive its
  still-unclaimed row, otherwise it keeps compressing with no lease — the window in which a competing
  path can fork the lineage" (`hermes_state_compression.py:831-852`). The anti-thrash counters
  (`compression_fallback_streak`, `compression_ineffective_count`,
  `compression_recovery_deadline`) are persisted in the session row precisely because "the gateway
  rebuilds the compressor every turn / cache eviction, so a process-local deadline restarted the wait
  on each rebuild and a tripped session never earned its probe"
  (`hermes_state_compression.py:795-830`). `acquire_session_turn_lease` distinguishes a *busy
  database* from a *lease holder* — "a busy writer is not a holder, so the attempt is retried at once
  with a longer write patience" rather than telling the user another process owns the session
  (`hermes_state_compression.py:886-940`).

### `hermes_state_detached_results.py`
- **Purpose:** Records results that arrive *between* turns — a detached API delegation's delivery and
  an unviewed local completion's note — as `user`-role rows, exactly once.
- **Key abstractions:** `SessionDetachedResultsMixin.append_delegation_delivery`,
  `append_completion_note`, `_append_detached_result`.
- **Data flow:** a recursive CTE (`_LINEAGE_MATCH_SQL`) walks the session **and its compression
  ancestors** to find an existing matching row; if none, the row is inserted inside the same writer
  transaction and the session counters are bumped.
- **Non-obvious design decisions:** idempotency is keyed by a **stable event id**
  (`delegation_id` / `completion_admission`), *not* by the text or by the active flag. The check and
  the insert share the writer transaction so independent gateway processes cannot duplicate the row,
  and a live turn refuses the write (`reject_active_turn_lease=True`) (`hermes_state_detached_results.py:40-63`).
- **Edge cases & failure handling:** `append_delegation_delivery` raises `ValueError` when no
  `delegation_id` is present — "a stable delegation_id" is required, deliberately.
- **Surprising:** a detached result is stored as a **user** row, so it re-enters the model's
  conversation history as if the human had said it.

### `hermes_state_identity.py`
- **Purpose:** The codec between the *live* in-memory identity keys (`agent.message_metadata`) and the
  durable `message_uid` / `absorbed_message_uids` / `tool_call_uids` / `tool_call_uid` columns
  (schema v31).
- **Key abstractions:** `_live_or_column` (a flushed dict carries the live key, an import payload
  carries the column name), `_uid_list`, `_uid_map`, `_fill_missing_tool_call_uids`,
  `_restore_row_identity`, `_restore_identity_columns`, `_stable_tool_key`.
- **Data flow:** the write path serialises live keys → columns; the restore path deserialises
  columns → live keys; the repair path uses `_stable_tool_key` to collapse display-duplicate rows.
- **Non-obvious design decisions:** a tool-call uid may be a **list** — one uid per occurrence of a
  provider id reused inside one row. `_live_extends` detects "a live per-occurrence list that starts
  with every stored occurrence" and *keeps* the live list, because replacing it with the stored
  single uid would strip the later occurrence (`hermes_state_identity.py:59-63, 77-90`).
- **Edge cases & failure handling:** `_uid_list` falls back to `[]` on a JSON deserialisation failure
  (logged), never raising into a transcript write. `_uid_map` drops any entry whose value is not a
  non-empty string or a list of non-empty strings.
- **Surprising:** `_stable_tool_key` deliberately keeps a tool **result** row's payload in its dedupe
  key — folding an archived full output into its pruned stub would drop the original from compacted
  history and from transcript exports (`hermes_state_identity.py:99-113`).

### `hermes_state_ids.py`
- **Purpose:** The ONE place that knows the `YYYYMMDD_HHMMSS_<hex>` session-id shape.
- **Key abstractions:** `SESSION_ID_PATTERN`, `SESSION_ID_RECOGNIZERS` (a tuple of regexes),
  `is_known_session_id`, `new_session_id`, `DEFAULT_HEX_LEN = 6`.
- **Data flow:** every surface (CLI, TUI, gateway, cron, API server, ACP adapter) mints ids here;
  `hermes_cli/session_lost_and_found.py` classifies schema-less salvage rows with
  `is_known_session_id`.
- **Non-obvious design decisions:** stdlib-only **on purpose** — `agent/`, `cli.py`, `gateway/` and
  `tui_gateway/` must not pull the SessionDB import graph in just to mint an id
  (`hermes_state_ids.py:4-11`). The recogniser list is a *salvage contract*: "a shape change here is a
  recovery-classification change — keep the prefix stable, and add any NEW derived-id shape to
  `SESSION_ID_RECOGNIZERS` or salvage will drop those sessions and mis-infer the table's layout."
- **Edge cases & failure handling:** each derived shape is anchored on what its mint site fixes —
  cron ids (`cron_<job>_<ts>`, where user/legacy job ids like `"job-1"` are real), `/bg` ids (two
  different shapes: `bg_HHMMSS_hex6` from CLI/gateway and `bg_<hex6>` from TUI/Desktop), room ids
  (`room_<sha256[:32]>`), API ids (`api_<ts>_<hex8>` and `api-<sha256[:16]>`), run ids and plain
  UUID4s (`hermes_state_ids.py:28-40`).
- **Surprising:** `new_session_id(now=...)` lets the caller pin the timestamp to a clock it already
  captured, so the id and the row "agree to the second".

### `hermes_state_keys.py`
- **Purpose:** Pure identity derivations that both the canonical store and the gateway need.
- **Key abstractions:** `cron_request_id`, `prefix_range`, `cron_request_range`,
  `cron_run_from_request`, `legacy_cron_run_job`, `admission_fingerprint`, `local_identity`,
  `profile_from_session_key_namespace`, `profile_from_session_key`.
- **Data flow:** the profile scheduler's principal admits every cron fire under `cron:<job>:<execution>`;
  that request id is the pre-image of the run's `local-*` session id, so its admission row **is** the
  run's durable job/execution association (`hermes_state_keys.py:12-18`).
- **Non-obvious design decisions:** stdlib-only, "because the gateway imports the store, so the
  reverse edge is a latent cycle" (`hermes_state_keys.py:3-6`). `prefix_range` returns half-open
  `[prefix, hi)` bounds by bumping the final character, so an index range scan covers exactly the
  prefix — used for `state_meta` key scans (`hermes_state_keys.py:25-29`).
- **Edge cases & failure handling:** `cron_run_from_request` refuses an ambiguous request id — more
  than one `:` is ambiguous (a job id holding `:`, or a refused execution id admitted with one) and
  only the *job_id* its stored policy names splits it (`hermes_state_keys.py:36-53`).
  `admission_fingerprint` uses `allow_nan=False` and `errors='surrogatepass'` so a NaN payload or a
  lone surrogate cannot silently produce a different digest.
- **Surprising:** `profile_from_session_key_namespace` is a *lossy* inverse: `"main"` → `"default"`,
  `"main~"` → `"main"`, anything else is the profile id.

### `hermes_state_media.py`
- **Purpose:** Durable *retirement candidates* for media files and spillover archives, so that
  deleting a transcript does not immediately delete the bytes on disk.
- **Key abstractions:** `retire_media`, `retire_spillover`, `collect_retired_spillover`,
  `collect_retired_media`; key prefixes `gateway.media.retired.v1.` and `gateway.spillover.retired.v1.`.
- **Data flow:** a delete transaction records the candidates into `state_meta` (keyed by a sha256 of
  the media path); a later collection pass unlinks the files that no surviving message references,
  then deletes the candidate rows.
- **Non-obvious design decisions:** `retire_spillover` records the pointers **inside the delete
  transaction**, because "the pointers vanish with the rows" — collecting after the delete would
  lose the names (`hermes_state_media.py:21-31`).
- **Edge cases & failure handling:** `collect_retired_spillover` refuses to act when the reference set
  is unknown (`referenced_spillover_names` returns None) — "Unknown reference set: keep files and
  candidates". An `OSError` on unlink leaves the candidate for the next pass
  (`hermes_state_media.py:34-52`).
- **Surprising:** `collect_retired_media` deletes the candidate row only for a path that no longer
  exists; a still-present file keeps its row so the next pass retries.

### `hermes_state_sessions_model_config.py`
- **Purpose:** Read-modify-write of conversation-wide `sessions.model_config` keys.
- **Key abstractions:** `update_conversation_model_config_value`, `session_ids_with_model_config_key`.
- **Data flow:** the tip of the compression chain is located **on the writer's own connection**
  (`db._compression_tip_on`), the JSON is parsed, `update(value)` is applied, and the result is
  written back in one write transaction.
- **Non-obvious design decisions:** doing the tip lookup inside the transaction is what makes it
  safe: "a rotation cannot publish between finding the tip and writing it (the child would keep the
  old copy)" (`hermes_state_sessions_model_config.py:14-18`). `update` "may run more than once (lock
  retry) and must be pure"; returning `None` removes the key.
- **Edge cases & failure handling:** a missing session row returns `None` and writes nothing.
- **Surprising:** the key scan (`session_ids_with_model_config_key`) is newest-first and uses a
  `json_extract` path built from a caller-supplied key name.

### `hermes_state_terminal.py`
- **Purpose:** Private, terminal-only tombstones — the identity of a *retired* (deleted) session, kept
  so an exact retry of a deleted request can still be answered.
- **Key abstractions:** `compact_result`, `encode_result`, `load_result`, `identity_key`,
  `terminal_api_admissions`, `terminal_admission`, `retry_terminal_admission`,
  `terminal_worker_receipt`.
- **Data flow:** an authenticated edge supplies the original principal/target/request and the frozen
  payload; the store answers "does this exact request have a retired answer?" and refuses fresh
  admission against a retired target.
- **Non-obvious design decisions:** `compact_result` strips the `tools` schema list from every stored
  result — "it is the same session-wide copy each turn (tens of KB, more with MCP) and no
  stored-result reader uses it" (`hermes_state_terminal.py:28-33`). It also keeps only the **current
  turn's** message suffix, except for compression results, whose replacement snapshot is the only
  immutable record of the rewritten prefix (`hermes_state_terminal.py:34-49`).
- **Edge cases & failure handling:** `encode_result`/`load_result` use an explicit envelope
  (`_stored = {v: 1, reply_ref: N}`) so a stored row keeps the reply exactly once: the closing
  assistant message's `content` is stored as `null` and the row points at it
  (`hermes_state_terminal.py:58-102`). `load_result` decodes **in place** — "safe only because each
  call parses its own copy. A cache in front of this must hand out copies, never the decoded dict
  itself."
- **Surprising:** `retry_terminal_admission` is explicitly "a read-only identity lookup, not
  authorization to attach, restore a route, or write. HTTP authentication/grant checks must precede
  this query" (`hermes_state_terminal.py:124-128`). `terminal_worker_receipt` uses
  `hmac.compare_digest` on the adoption secret and refuses a stale generation or a mismatched
  payload digest — "possession never reactivates the worker."

### `hermes_state_timeline.py`
- **Purpose:** A read-only **prompt index** and bounded transcript jumps — without hydrating
  transcript-wide payloads.
- **Key abstractions:** `_prompt_preview`, `_snapshot` (a context manager that opens a read
  transaction and always ROLLBACKs), `_display_rows_sql`, `_register_functions`,
  `get_session_messages_around`, `get_session_timeline`.
- **Data flow:** two SQLite user functions are registered on the connection
  (`timeline_identity_content`, `timeline_preview`) so the *display* projection (dedupe by identity,
  skip synthetic prompts, project compaction messages for display) happens in SQL; only the selected
  bounded page's bodies cross into Python.
- **Non-obvious design decisions:** the count and the page must "see the same compaction/rewind
  generation", so both run inside one snapshot transaction (`hermes_state_timeline.py:42-51`). The
  display rows are computed from a **durable display index** (`display_order`/`display_identity`) when
  present, and fall back to a `ROW_NUMBER() OVER (identity …)` window partition otherwise
  (`hermes_state_timeline.py:53-85`).
- **Edge cases & failure handling:** synthetic prompts (`[ASYNC DELEGATION COMPLETE]`,
  "[IMPORTANT: Background process …]") are filtered out by `_SYNTHETIC_PROMPT` so the timeline only
  shows human prompts. The preview is capped at 120 chars and whitespace-collapsed.
- **Surprising:** "Legacy stores cannot backfill on a GET" — the fallback path does the grouping in
  SQLite and normalises only user content across the Python boundary.

### `hermes_state_titles.py`
- **Purpose:** Session title sanitising, **auto/user provenance ranking**, and lineage-aware lookups.
- **Key abstractions:** `next_title_in_lineage`, `SessionTitlesMixin._title_rank`,
  `sanitize_title`, `_is_compression_ancestor`, `_set_session_title`,
  `_set_session_title_in_transaction`, `_resolve_title_conflict`, `set_session_title`,
  `set_auto_title`, `get_session_title`, `get_session_title_source`,
  `set_session_title_source`, `get_session_by_title`, `resolve_session_by_title`,
  `get_next_title_in_lineage`, `lineage_title_on_conn`.
- **Data flow:** a title is proposed by a source (`user` / `derived` / `llm`); the writer reads the
  current row, compares ranks, and performs a **compare-and-swap UPDATE** in the same transaction.
- **Non-obvious design decisions:** provenance precedence is enforced in SQL with `IS` (NULL-safe)
  comparisons: "a `user` write always lands; `derived`/`llm` land only when the row is untitled or
  holds strictly lower authority (derived upgrades to llm exactly once, nothing overwrites a user
  name, re-running the titler on an llm row is a no-op)" (`hermes_state_titles.py:83-92`). A
  `NULL` `title_source` (pre-provenance rows) ranks as `user`, because it is indistinguishable from a
  manual `/title` of that era (`hermes_state_titles.py:42-47`).
- **Edge cases & failure handling:** `sanitize_title` strips ASCII controls, zero-width, bidi
  override, object-replacement and interlinear-annotation code points, plus lone surrogates sqlite3
  cannot bind, then collapses whitespace; a title longer than `MAX_TITLE_LENGTH` raises `ValueError`
  (`hermes_state_titles.py:49-60`). `_resolve_title_conflict` is the one place the uniqueness rule
  lives and it frees a title in three narrow cases: a hidden compression ancestor (the title is
  *transferred* onto the tip), a deliberately archived hidden Bot Chat, and an "ended, empty, visible
  ghost" the user cannot find to free the name — otherwise it raises "Title '…' is already in use".
- **Surprising:** the canonical Bot Chat's **name is its identity** — Bot Mode resolves it by exact
  title on every open — so renaming it is refused with an explanatory `ValueError`, while a *visible*
  session merely named "Bot Chat" stays renameable (the `hidden` flag is the discriminator)
  (`hermes_state_titles.py:110-121`). `resolve_session_by_title` deliberately breaks the "#N
  continuation wins" preference for the Bot Chat, because routing a DM into a numbered sibling
  would put the teammate's message in a chat whose bot cannot answer (`hermes_state_titles.py:203-220`).

### `hermes_state_todo.py`
- **Purpose:** Finds the newest Todo tool result a resume should restore.
- **Key abstractions:** `SessionTodoResultMixin.get_latest_todo_result`.
- **Data flow:** it walks the **resume lineage** (a branch owns its copied history; compression
  continuations also show their ancestors' archived rows), then scans indexed, bounded pages of
  `tool` rows named `todo_list`/`todo`, newest first, and validates each candidate.
- **Non-obvious design decisions:** a candidate is only accepted if its `tool_call_id` is **paired**
  with an assistant row that actually issued a matching call — including the nested
  `function.name == "tool_call"` shape with an inner `calls` array
  (`hermes_state_todo.py:48-72`). Invalid results are skipped "just as the model's Todo hydration
  does", and explicit empty results are retained.
- **Edge cases & failure handling:** the page query is capped at `length(content) <= max_chars`
  (default `MAX_TODO_RESULT_CHARS`) and 100 rows per page, so a long transcript is never fully
  hydrated. Malformed JSON is caught (`ValueError, TypeError`) and the candidate is skipped.
- **Surprising:** `revision` is read (`int(data.get("revision") or 0)`) but never compared to anything
  — the hydration contract is about validity, not ordering.

### `hermes_state_user_copy.py`
- **Purpose:** Plain-language copy for "session storage is unavailable / could not be written"
  notices, shared by every surface (CLI banner, gateway warning, TUI/Desktop RPC errors).
- **Key abstractions:** `StorageFailure` (frozen dataclass: `cause`, `code`, `gloss`, `action`),
  `_STORAGE_FAILURES` table, `describe_storage_failure`, `storage_failure_details`.
- **Data flow:** `classify_persistence_error` buckets the exception into a cause; the table maps
  cause → `(code, gloss, action)`; the `disk` cause is split by `is_disk_full_error` at lookup time.
- **Non-obvious design decisions:** the machine-readable `code` exists "so a GUI can attach a 'Run
  doctor' button to" (`hermes_state_user_copy.py:6-9`). The `deleted_wal` cause deliberately reuses
  the `storage_replaced` code ("GUI clients key on it") while naming the real remedy
  (`hermes_state_user_copy.py:66-79`).
- **Edge cases & failure handling:** `describe_storage_failure` "never raises"; unknown causes fall
  back to the `unknown` entry; the copy-pasteable command is pinned to the failing profile via
  `profile_cli_selector()`.
- **Surprising:** `storage_failure_details` is capped at 200 chars and is meant for "a trailing,
  secondary 'Details:' line (never the lead sentence)".

### `hermes_state_worker_context.py`
- **Purpose:** The **closed** constructor-context operations available inside the worker receipt
  transaction. "Identity and lineage remain owner-reserved. This is not arbitrary SessionDB RPC."
- **Key abstractions:** `SIDECAR_KEYS` (the three `model_config` sidecars a worker may patch),
  `worker_context`, `worker_prompt`, `worker_sidecars`, `worker_tool_names`, `worker_tail_role`,
  `worker_row_role`.
- **Data flow:** each handler validates its payload with an exact key set, then writes inside the
  caller's transaction — no handler opens or commits a connection.
- **Non-obvious design decisions:** `worker_sidecars` accepts only keys in `SIDECAR_KEYS`
  (`_usage_anchor`, `_proactive_prune_rearm_tokens`, `_anthropic_rejected_thinking`) and raises
  `invalid_params` for anything else (`hermes_state_worker_context.py:39-45`).
  `worker_tool_names` bounds the pin: a JSON list/dict pin is rejected above **4 MiB** ("Bounded so a
  worker cannot write an unbounded blob into the shared table") and a name list is rejected unless
  every name is a 1–256 char string (`hermes_state_worker_context.py:47-69`).
- **Edge cases & failure handling:** every handler raises `RuntimeStoreError('invalid_params')` for a
  payload shape it does not own; `_store_system_prompt` is content-addressed and unreferenced
  prompts are deleted afterwards.
- **Surprising:** `worker_tail_role` is `latest_conversation_role` "on the receipt connection
  (failed-turn boundary)" — the worker gets the *failed* turn's boundary, not a fresh read.

### `hermes_state_fts.py`
- **Purpose:** FTS5 index setup — the CJK-bigram (`cjk_unicode61`) index DDL and tokenizer loader,
  per-table schema ensure with tokenizer-capability fallback, FTS-scoped corruption detection and
  the atomic fail-open trigger detach.
- **Key abstractions:** `FTS_CJK_TABLE_SQL`, `FTS_CJK_TRIGGER_SQL`, `fts5_cjk_so_path`,
  `load_fts5_cjk_extension`, `FTS_VTABLE_LAYOUTS` (a literal registry of every released layout),
  `fts_layout_drift`, `fts_layout_current`, `base_index_recognised`, `base_source_view_is_stale`,
  `_drop_orphan_fts_shadow_tables`, `SessionFtsSetupMixin` (`_ensure_fts_cjk_schema`,
  `_ensure_fts_schema`, `_enter_fts_fail_open`, `_warn_fts5_unavailable`).
- **Data flow:** the CJK index is an external-content FTS5 table over a view that excludes `tool`
  rows; triggers keep it in sync; the trigram index is the fallback tokenizer; a corrupt index is
  detached (triggers dropped + a stale breadcrumb written) so canonical writes continue.
- **Non-obvious design decisions:** the **split DDL** — the table/view is safe to ensure any time,
  but the triggers are created ONLY while the index is complete-or-marker-gated: "A stale index must
  keep its triggers DROPPED — an external-content 'delete' for a rowid the index never held is the
  canonical FTS5 corruption hazard" (`hermes_state_fts.py:22-30`). The rebuild markers
  (`fts_cjk_rebuild_high_water` / `fts_cjk_rebuild_progress`) make the id-gated triggers correct
  until the backfill finishes. The layout registry is *literal on purpose*: "a change to FTS_SQL /
  FTS_TRIGRAM_SQL fails `test_the_layout_registry_ends_with_the_shipping_ddl` until its new form is
  appended here" (`hermes_state_fts.py:156-179`).
- **Edge cases & failure handling:** `_enter_fts_fail_open` writes the stale breadcrumb **before**
  dropping the triggers and commits them atomically, so a crash between the two is merely
  conservative. It re-checks the corruption guard on every retry because "a sibling may quarantine
  the file while we wait for the lock". A missing *optional* tokenizer disables only that table — the
  base FTS5 table stays on (`hermes_state_fts.py:284-295`). `_drop_orphan_fts_shadow_tables` matches
  exact shadow names only, "never a prefix LIKE, so the base family cannot reach
  `messages_fts_trigram_*`".
- **Surprising:** the CJK tokenizer is a **loadable extension** (`libfts5_cjk.so`) with no
  dependencies; when it cannot be loaded the triggers are *dropped* so message writes keep working
  and CJK search falls back to trigram/LIKE (`hermes_state_fts.py:352-390`). The rebuild engine is
  chunked (500 rows) with a **cross-process duty cycle**: sleep ≥ 4× the chunk cost (≤20% duty),
  because one blocking rebuild held the write lock for ~16 minutes on a 25 GB DB.

### `hermes_state_maintenance.py`
- **Purpose:** Retention pruning, stale-session archiving and the VACUUM policy.
- **Key abstractions:** `_PRUNE_FILTERS` (a declarative table of ~21 filters with an "applies-when"
  rule), `_continued_ancestors_sql`, `_PINNED_TAIL_SQL`, `_not_pinned_sql`,
  `SessionMaintenanceMixin` (`prune_empty_ghost_sessions`, `sweep_orphaned_sessions`,
  `_prune_filter_where`, `_prune_where`, `list_prune_candidates`, `count_prune_matches`,
  `count_open_prune_matches`, `archive_stale_sessions`, `maybe_auto_archive`, `prune_sessions`,
  `logical_size_bytes`, `_freelist_ratio`, `vacuum`, `maybe_auto_prune_and_vacuum`).
- **Data flow:** retention filters → a shared WHERE clause → a candidate list → a write transaction
  that deletes rows and orphans (rather than cascades) their children; file cleanup happens outside
  the transaction.
- **Non-obvious design decisions:** the filter table is data, not code — `_PRUNE_FILTERS` is a tuple
  of `(kwarg, applies-when, builder)` and `_prune_filter_where` raises `TypeError` on an unknown
  keyword (`hermes_state_maintenance.py:45-70, 231-234`). "notnone" vs "truthy" is explicit: `0` is a
  real bound for a numeric filter but `""` is unset for a string filter. A **pin covers the whole
  conversation**, including the unpinned continuations a pinned segment covers
  (`hermes_state_maintenance.py:88-107`). `whole_lineages` keeps a compressed-away segment while any
  later segment stays — "deleting it would cut the start off of a chat that is still in use".
- **Edge cases & failure handling:** `prune_sessions` refuses `include_open` outright — "Deletion is
  not reversible, so the ended-session guard is structural here: the archive-only escape hatch must
  never reach the delete path" (`hermes_state_maintenance.py:378-382`). A negative `older_than_days`
  raises `ValueError` because "a negative retention builds a future cutoff that matches every ended
  session". `maybe_auto_prune_and_vacuum` "never raises" — maintenance must never block startup.
- **Surprising:** `maybe_auto_prune_and_vacuum` **skips** the VACUUM when any other process (or an
  in-process sibling) holds the store or a WAL sidecar, because "VACUUM plus the TRUNCATE checkpoint
  retire the WAL generation a sibling writer still holds, and that is exactly the state every agent
  then refuses turns in" (`hermes_state_maintenance.py:526-540`). The VACUUM is also gated on
  `freelist_count / page_count > min_vacuum_freelist_ratio` so a small prune on a dense multi-GB DB
  never triggers a full rewrite.

### `hermes_state_usage.py`
- **Purpose:** Token/usage accounting — a coalescing background token writer, per-model usage rows
  and billing-route columns.
- **Key abstractions:** `_token_update_sql(delta)` (one SQL builder producing the absolute and delta
  variants), `_MODEL_USAGE_UPSERT_SQL`, `SessionUsageMixin` (`update_session_billing_route`,
  `queue_token_counts`, `flush_token_counts`, `_token_writer_loop`, `_apply_token_batch`,
  `_coalesce_token_deltas`, `_stop_token_writer`, `update_token_counts`, `_record_model_usage`,
  `record_auxiliary_usage`, `auxiliary_usage_by_task`, `usage_totals`).
- **Data flow:** a turn enqueues a token delta → a daemon writer thread coalesces adjacent deltas
  with an identical route and applies them → the session row is updated and a
  `session_model_usage` row is upserted.
- **Non-obvious design decisions:** the writer's `busy` flag is set **before** the queue is cleared,
  because "flush's lock-free fast path must never see 'empty and idle' while a popped batch is
  unapplied" (`hermes_state_usage.py:186-190`). `flush_token_counts` refuses to drain a *live*
  writer's in-flight batch — "draining here would race its in-flight batch and reorder deltas
  (breaking last-non-None-wins / first-accounted-route / COALESCE-backfill fields)"
  (`hermes_state_usage.py:152-162`). `absolute=True` updates never merge with anything
  (`hermes_state_usage.py:212-231`).
- **Edge cases & failure handling:** if `close()` already stopped the writer, `queue_token_counts`
  applies the delta **inline** rather than dropping it ("enqueueing would drop the delta silently").
  Coalescing failure is logged and the raw batch is applied; an apply failure is logged and never
  raised into a turn ("Accounting loss is logged, never raised into a turn")
  (`hermes_state_usage.py:197-210`). An `atexit` hook drains leftovers so accounting is not lost at
  interpreter shutdown.
- **Surprising:** per-model attribution only happens on the **incremental** path — "absolute
  cumulative updates cannot be split back into routes; Insights reconciles the residual instead"
  (`hermes_state_usage.py:325-330`). `record_auxiliary_usage` deliberately does **not** touch the
  session summary row (the gateway overwrites those counters with absolute main-loop totals) and
  must not inherit the main-loop route: "vision on gemini while the main loop runs anthropic"
  (`hermes_state_usage.py:380-414`). `auxiliary_usage_by_task` sums over the **compression lineage**
  because "aux calls bill to the id the turn STARTED with while compression mints child ids mid-turn".

### `hermes_state_worker_lifecycle.py`
- **Purpose:** Closed worker lifecycle handlers, called only inside the receipt transaction.
- **Key abstractions:** `_IDENTITY_FIELDS` / `_CREATE_FIELDS` / `_CONSTRUCTOR_CONFIG`,
  `WORKER_LIFECYCLE_HANDLERS` (a dispatch table of 12 verbs), `insert_session_row_in_transaction`.
- **Data flow:** a sandboxed producer issues a verb (`session.title`, `session.activity`,
  `session.create`, …); the handler validates the payload shape and the *authority*, then writes
  inside the receipt transaction and returns `{'value': …}`.
- **Non-obvious design decisions:** `worker_create` will not mint a row — "A worker cannot mint a
  row or supply unreserved routing, lineage or cwd" — it only *merges* into an owner-reserved row
  and refuses any identity field that differs from the row's (`hermes_state_worker_lifecycle.py:16-40`).
  `worker_next_title` will only dedupe a title if the session already has it **or** a receipt records
  an attempted title with that candidate — "Concurrent activity/usage receipts must not invalidate
  that title attempt" (`hermes_state_worker_lifecycle.py:84-108`).
- **Edge cases & failure handling:** `worker_activity` rejects a non-finite timestamp and only
  advances `last_activity_at` monotonically (`WHERE last_activity_at IS NULL OR last_activity_at < ?`).
  `worker_title` catches the expected `ValueError` from a title conflict so it "must not poison the
  retry journal" — it returns `{value: False, error: …, title_candidate: …}` instead
  (`hermes_state_worker_lifecycle.py:62-74`).
- **Surprising:** `insert_session_row_in_transaction` refuses to recreate a deleted session beside
  its durable tombstone — "A delayed constructor/accounting backfill must not recreate a deleted
  session beside its durable tombstone (the exact delete retry would then report a stale success
  while a fresh delete collides with the existing marker)" (`hermes_state_worker_lifecycle.py:213-218`).
  The upsert preserves a `_reset_from` marker across a model_config overwrite.

### `hermes_state_worker_compression.py`
- **Purpose:** The closed set of compression operations a worker may run on the receipt connection.
- **Key abstractions:** `WORKER_COMPRESSION_HANDLERS` (a dispatch table of ~20 verbs),
  `CompressionSnapshot` (a read-only facade over the production read algorithms),
  `archive_on_connection` / `publish_on_connection` / `reopen_on_connection` (thin wrappers that
  call the *owner's* body on the worker's connection).
- **Data flow:** the worker sends a verb with a strict payload; `CompressionSnapshot.authorize`
  checks that the target is in the assigned session's lineage or compression chain; the owner's
  production code runs on the worker's connection.
- **Non-obvious design decisions:** `CompressionSnapshot` deliberately exposes only **read**
  primitives ("this object cannot start/commit a write") and reuses the production read algorithms
  by binding the production mixin methods onto the snapshot class
  (`hermes_state_worker_compression.py:103-126`). The archive and publish bodies are the *owner's*
  functions run on the worker's connection — "one implementation, so main's coverage/merge/timestamp/
  display-order fixes reach worker and mutation verbs too"
  (`hermes_state_worker_compression.py:208-224`).
- **Edge cases & failure handling:** every verb validates with `_fields(payload, required, optional)`
  — exact key sets, no extras. `_number` rejects NaN/inf. TTLs are bounded to `[0.1, 3600]`.
  `_handoff_messages` caps a handoff at 1000 messages and rejects a `_row_id` that does not belong
  to the session (`permission_denied`). `worker_publish` refuses a `model_config` that changes the
  lineage markers (`_branched_from`, `_delegate_from`, `_reset_from`) and refuses to publish over an
  existing child id.
- **Surprising:** `worker_cooldown_clear` is implemented as a *restore to a null snapshot* — it
  reuses the rollback path so clear and restore share one verification
  (`hermes_state_worker_compression.py:86-90`). `_migrate_worker_automation` moves goal/heartbeat/loop
  state across a rotation and *clears the old key*, so a resumed child does not double-run the
  parent's automation.

### `hermes_state_search.py`
- **Purpose:** Full-text / trigram / CJK message search and FTS maintenance.
- **Key abstractions:** `_sanitize_fts5_query`, `_quote_fts_tokens`, `_strip_cjk_wildcards`,
  `_compile_like_boolean_query`, `_or_relaxed_query`, `_trigram_route_ok`, `_has_short_cjk_token`,
  `_search_filter_clauses`, `_rebuild_step`, `_demote_legacy_fts_to_trash`, `_optimize_settle`,
  `optimize_fts_storage`, `search_messages`, `_search_messages_impl`, `_search_cjk`,
  `_search_unindexed_gap`, `optimize_fts`, `rebuild_fts`, `_merge_fts_incrementally`,
  `get_anchored_view`, `list_recent_user_messages`.
- **Data flow:** a query is sanitised → routed to one of four routes (base FTS5 / CJK bigram /
  trigram / canonical LIKE) → optionally topped up by an "unindexed gap" scan while a rebuild is in
  flight → the matched rows get a bounded ±1 neighbour context.
- **Non-obvious design decisions:** the router is **per-token**, not per-query: a query with a CJK
  token shorter than 3 chars cannot use the trigram tokenizer ("with FTS5's implicit AND one such
  token empties the whole MATCH"), and a *lone* 1-char CJK run cannot use the bigram index at all
  (`hermes_state_search.py:870-915`). The `_sanitize_fts5_query` pipeline protects balanced quoted
  phrases with placeholders, strips FTS5-special characters, drops dangling boolean operators and
  quotes dotted/hyphenated terms in **one** pass (sequential passes double-quote
  `my-app.config`) (`hermes_state_search.py:825-860`).
- **Edge cases & failure handling:** a corruption-class `DatabaseError` on a MATCH **detaches** the
  derived indexes and answers from canonical rows — "a live search never runs the unbounded
  rebuild"; the repair paths own the rebuild (`hermes_state_search.py:950-970`). A syntax
  `OperationalError` returns `[]` rather than raising. `rebuild_fts` admits through a
  cross-process `fts_rebuild_admission` authority and **fails closed** (returns 0) because "two
  processes rebuilding one state.db concurrently corrupted production DBs"
  (`hermes_state_search.py:1302-1346`).
- **Surprising:** three escalating fallbacks, all gated on a **zero-result miss** so hits keep exact
  ranking: (1) the CJK bigram index, then trigram, when unicode61 put no boundary between Latin and
  adjacent CJK; (2) an **OR-relaxed** retry that matches any term, because "the implicit AND between
  terms means a paraphrased multi-word query misses a stored sentence that lacks even ONE word"
  (`hermes_state_search.py:1160-1197`); (3) an unindexed-gap LIKE scan while the deferred rebuild
  is in flight, so old messages "never vanish mid-rebuild". `_strip_cjk_wildcards` exists because
  the web/desktop search box appends `*` to each token and the CJK routes quote every token before
  MATCH — so the star became a literal and the search returned nothing.

### `hermes_state_schema.py`
- **Purpose:** Schema creation, column reconciliation and FTS DDL management.
- **Key abstractions:** `schema_read_probe_statements`, `SessionSchemaMixin` (`_init_schema`,
  `_run_data_migrations`, `_reconcile_columns`, `_parse_schema_columns`, `_rebuild_table`,
  `_heal_gateway_routing_pk`, `_heal_session_model_usage_pk`, `_init_fts`, `_recover_stale_fts`,
  `retry_deferred_fts_recovery`, `_defer_stale_fts_for_holders`, `_run_admitted_startup_rebuild`,
  `_advance_message_uid_backfill`, `_ensure_unique_title_index`), plus the module-level
  `apply_declared_schema` and `reconcile_state_schema`.
- **Data flow:** `SCHEMA_SQL` is the single source of truth → columns are reconciled
  declaratively → two table-shape repairs run (SQLite cannot `ALTER` a PK) → version-gated *data*
  migrations run → FTS objects are ensured/repaired → the layout is stamped.
- **Non-obvious design decisions:** **column additions are declarative and version-free** — the
  reconciler parses `SCHEMA_SQL` by executing it in an in-memory DB and reading `PRAGMA table_info`
  (no hand-maintained list: "a hand-maintained list went stale within days")
  (`hermes_state_schema.py:169-184, 724-805`). The parse is memoised on disk keyed by a DDL hash
  (~85 ms per startup otherwise) but "only the reference-side parse is cached — diffing the LIVE
  database still runs every startup". `schema_read_probe_statements` derives its probes from the same
  DDL and **table-qualifies** every column, because "an unqualified double-quoted identifier that
  fails to resolve silently degrades to a string literal (SQLite misfeature) and would pass on the
  stale store". Version-gated migrations are for **data only**; "column additions need no
  version-gated migration".
- **Edge cases & failure handling:** `_reconcile_columns` distinguishes three failures precisely —
  "duplicate column" (a sibling won the race; the store is correct), a **lock error (re-raised**, so
  the lock-patience wrapper retries, because "swallowing lock contention left the store
  half-reconciled"), and anything else (logged loudly: the store is permanently behind `SCHEMA_SQL`)
  (`hermes_state_schema.py:795-804`). `_rebuild_table` wraps RENAME/CREATE/copy/DROP in one explicit
  `BEGIN IMMEDIATE`, because the writer connection is autocommit and a sibling opening the DB
  between RENAME and CREATE would strand every row in the legacy table
  (`hermes_state_schema.py:819-849`). `_advance_message_uid_backfill` walks by **rowid**, not `id`,
  because a store converted from JSONL carries `id TEXT` with no PRIMARY KEY where `MAX(id)` is a
  string and an id range compares lexicographically (`hermes_state_schema.py:1139-1168`).
- **Surprising:** the v23 FTS redesign is **opt-in, not automatic**, and its version marker is
  **decoupled** from `schema_version` (`fts_storage_version`), so a user who never optimises is not
  blocked from future migrations (`hermes_state_schema.py:1050-1137`). The FTS rebuild is a
  cross-process admission, not a lock: "a full structural rebuild must never run concurrently in two
  processes sharing one state.db — that interleaving has structurally corrupted the database in
  production" (`hermes_state_schema.py:1302-1337`).

### `hermes_state_messages.py`
- **Purpose:** Transcript persistence — append/replace/rewind, reactions, resume assembly and
  replayed-user dedupe.
- **Key abstractions:** `_INSERT_MESSAGE_SQL` (one INSERT shape for every writer),
  `_encode_content`/`_decode_content`, `_encode_display_metadata`/`_decode_display_metadata`,
  `_check_transcript_write_guards`, `_stamp_tool_call_uids`, `_display_dedupe_key`,
  `_display_identity`, `_dedupe_display_generations`, `_reconcile_display_orders`,
  `append_message`, `append_messages_batch`, `replace_messages`, `archive_and_compact`,
  `rewind_to_message`, `get_messages`, `get_messages_as_conversation`, `get_resume_conversations`,
  `_resume_lineage_ids`, `conversation_revision`, `resolve_active_row_id`, `purge_stale_tool_call_markers`.
- **Data flow:** a live message dict → content/metadata/identity encoding → one INSERT inside a
  guarded write transaction → counters bumped; the read side decodes and projects through the
  **display identity** fold so one logical message paints once.
- **Non-obvious design decisions:** ordinary appends deliberately **do not** check the compression
  lock: "the lock's job is to stop two COMPRESSIONS colliding, not to fence ordinary transcript
  writes. Blocking appends here was the root cause of a whole symptom family — turns dying as
  `session_persistence_failed` while a slow provider summary held the lease"
  (`hermes_state_messages.py:212-267`). The destructive user mutations opt in via
  `reject_active_*`. `replace_messages` **soft-archives** rather than DELETEs by default
  (`archive_dropped=True`), because "a plain DELETE also evicts the rows from the FTS index, leaving
  nothing to recover from" (`hermes_state_messages.py:719-744`). The kept-prefix match leaves the
  common in-order prefix untouched "with their ids; only the divergent live suffix is archived and
  only the new suffix of `messages` is inserted" — archiving and re-inserting the kept prefix grew
  the archive by the whole transcript on every rewind.
- **Edge cases & failure handling:** `_execute_transcript_write` restores the caller's `_row_id` /
  digest / timestamp on **every attempt and on final failure**, because "a rolled-back insert's id is
  reused by SQLite, so a stale stamp would make a later flush adopt another writer's row and drop
  this message" (`hermes_state_messages.py:472-496`). `_encode_content` escapes a literal string
  carrying the reserved `\x00json:` prefix by double-encoding it, "so a crafted import can't smuggle
  the marker in and have the read path decode attacker-chosen structure". Lone surrogates are scrubbed
  on write because "left raw, sqlite3 raises UnicodeEncodeError and the session silently stops
  persisting". `_row_to_message_dict` drops *unknown* BLOB columns only ("Known columns are exempt:
  popping `content` because a row holds bytes turns a decode problem into a KeyError for every
  `msg["content"]` reader downstream").
- **Surprising:** the compaction **watermark** is the concurrency contract: rows appended during the
  slow provider summary are column-cloned into the compacted set by pure SQL so they "survive
  compaction verbatim", and the original ids are re-resolved by content because "re-sequencing assigns
  the tail rows fresh ids" (`hermes_state_messages.py:901-1018`). The display fold hashes the
  *removed* rows' timestamps only ("a sha256 per live row cost a warm 30k-row resume ~0.17 s") — a
  deliberate performance carve-out. `conversation_revision` is a cheap fingerprint
  (lineage ids + count + max id + a trigger-bumped `transcript_revision`) that lets a
  transcript-derived payload be reused while it holds.

### `hermes_state_sessions.py`
- **Purpose:** Session lifecycle — row upsert/inheritance, lifecycle flags (end/reopen/archive/pin/
  hide/read), `model_config` patching, listing/counting and delete cascades.
- **Key abstractions:** `_parse_model_config`, `_cwd_prefix_clause`, `_workspace_key_clause`,
  `_session_filter_where`, `_expand_compression_lineage_ids`, `_collect_delegate_child_ids`,
  `classify_session_status`, `_LINEAGE_CTE_SQL`, `_UPSERT_KEEP_EXISTING_SQL`,
  `_INHERIT_PARENT_META_SQL`, `_INHERIT_PARENT_ROUTING_SQL`, `SessionSessionsMixin`
  (`_own_profile_name`, `_insert_session_row`, `end_session`, `reopen_session`,
  `promote_to_session_reset`, `update_session_model`, `set_session_archived`, `_auto_archive_lineage`,
  `unarchive_recoverable_session`, `set_session_pinned`, `list_recent_sessions_bounded`,
  `list_sessions_rich`, `session_lifecycle_statuses`, `assert_export_safe`, `delete_session`,
  `delete_sessions`, `delete_session_if_empty`, `archive_sessions`).
- **Data flow:** a session row is created/upserted with parent inheritance → its lifecycle flags
  are set **across the whole compression lineage** via one recursive CTE → listing projects each
  root forward to its live tip → deletion expands the lineage in both directions and orphans what it
  does not own.
- **Non-obvious design decisions:** the upsert **never overwrites what an earlier writer set** —
  the gateway creates a bare row before `create_session` carries the real model/prompt — with one
  deliberate exception: the token-accounting placeholder `source='unknown'` is replaceable, "because
  this upsert is the only writer that could correct it" (`hermes_state_sessions.py:367-413`).
  Routing columns (`user_id`/`session_key`/`chat_id`/…) are inherited by **compression forks only** —
  "delegate and branch children must NOT inherit them (peer recovery could repoint traffic into a
  subagent's session)". `profile_name` inheritance is fenced by a namespace check: two
  `agent:<ns>:`-keyed rows must agree on the namespace, or "a default child forked from a sibling
  profile's row must not be durably mislabelled as that profile's"
  (`hermes_state_sessions.py:262-268`).
- **Edge cases & failure handling:** `end_session` is **first-stamp-wins** ("a compression split must
  keep `'compression'` even if a stale `end_session()` lands later"). `promote_to_session_reset`
  can overwrite a *recoverable* end reason but not an explicit boundary, because "an `agent_close` row
  left recoverable would be resurrected by stale-route recovery"
  (`hermes_state_sessions.py:542-563`). `update_session_cwd` claims a **git metadata generation** so
  an older async worker cannot overwrite a newer claim (A → B → A). `delete_session` supports two
  fences — `expected_delete_ids` (delegate drift) and `expected_display_messages` (transcript
  drift) — both evaluated **inside the same write transaction as the deletion**
  (`hermes_state_sessions.py:1719-1789`). `delete_session_if_empty` refuses a row under an active
  lease, because "the emptiness predicate reads committed state, so a row whose first turn is
  already leased but not yet flushed would be deleted mid-turn".
- **Surprising:** the deliberate-archive vs auto-archive distinction is carried by a second column
  (`auto_archived`): a user archive clears the provenance so the idle sweep never re-labels it, and
  a sweep archive stamps it — "A row already archived keeps its provenance, so a deliberately archived
  ancestor is never relabelled as sweep-owned" (`hermes_state_sessions.py:951-1000`).
  `list_recent_sessions_bounded` is a **latency-bounded** browse: it preselects candidates from an
  indexed timestamp, resolves the lineage under a total-row ceiling, and installs a cooperative
  SQLite progress handler that raises `TimeoutError` past the deadline
  (`hermes_state_sessions.py:1161-1336`). `_remove_session_files` sweeps *every* historical writer
  name, "because a 'deleted' session's snapshot can carry plaintext secrets".

## 2. Ideas worth stealing

1. **Compare-and-swap writes instead of blind updates.** `hermes_state_titles.py:94-129` reads the
   current row and writes with `WHERE … AND title IS ? AND title_source IS ?` (NULL-safe `IS`), so a
   concurrent manual rename is never clobbered. **Where it transfers:** August Trading's trade-log
   and journal writes are the same shape — a plan the trader edits in the UI while the analyst
   writes a post-mortem must not lose the human's edit. `CONVERGENT` (the same CAS pattern appears
   in `hermes_state_messages.replace_messages_in_transaction`'s `expected_active_ids` fence at
   `hermes_state_messages.py:745-778`).
2. **Persist the anti-thrash state, not just the in-memory guard.** `hermes_state_compression.py:795-830`
   persists a fallback streak, an "ineffective compaction" strike count and a **recovery deadline**
   in the session row, because "the gateway rebuilds the compressor every turn / cache eviction, so a
   process-local deadline restarted the wait on each rebuild and a tripped session never earned its
   probe". **Where it transfers:** August Trading's "proactive prune" / context-compaction and its
   automation breaker should keep their counters in the session/preferences row so a restart does not
   reset a tripped guard. `CONVERGENT` (the same "durable half of a process-local guard" idea appears
   in `hermes_state_maintenance`'s `last_auto_prune` / `last_vacuum` meta stamps at
   `hermes_state_maintenance.py:333-362`).
3. **A cooldown that merge-maxes instead of overwriting.** `hermes_state_compression.py:520-535`
   writes the failure cooldown with a `CASE` that keeps the *longer* live deadline, "so a later
   shorter write cannot reopen the thrash window", while the error column always takes the newest
   diagnostic. **Where it transfers:** the automation streak-breaker in August Trading should
   extend, never shorten, an active cooldown. `UNIQUE`.
4. **Charge the *route* per call, not per session.** `hermes_state_usage.py:350-413` records every
   incremental API delta into a per-`(model, provider, route, task)` row so a mid-session model
   switch does not attribute every token to the first model. **Where it transfers:** August Trading's
   per-trade analysis cost should be attributed to the *model/provider that actually produced it*,
   with auxiliary calls (chart reads, title generation) tagged separately so the main loop's numbers
   stay honest. `CONVERGENT` (the "auxiliary task does not inherit the main route" rule appears
   again in `hermes_state_usage.auxiliary_usage_by_task`).
5. **Coalesce accounting writes on a background thread, and never lose a delta.** `hermes_state_usage.py:106-270`
   runs one daemon writer, coalesces *adjacent* deltas with an identical route, keeps an `atexit`
   drain, and falls back to an inline write when the writer has already stopped. **Where it
   transfers:** August Trading's per-turn token/cost accounting can use the same pattern (a queue + a
   writer thread + an inline fallback), so a chat turn does not pay a SQLite write per provider call.
   `CONVERGENT` (the "flush before you change the route" barrier appears at
   `hermes_state_sessions.py:715-744`).
6. **Fail open on a derived index, never on the canonical store.** `hermes_state_fts.py:463-551`
   detaches a corrupt FTS index (drops triggers + writes a stale breadcrumb atomically) so canonical
   writes continue, and the search path falls back to a LIKE scan
   (`hermes_state_search.py:1015-1026`). **Where it transfers:** August Trading's SQLite (via
   Capacitor) FTS / derived indexes should degrade to a scan rather than fail a trade write.
   `UNIQUE`.
7. **Declare the schema, reconcile the columns, migrate only the data.** `hermes_state_schema.py:724-805`
   parses `SCHEMA_SQL` in an in-memory DB and `ALTER TABLE ADD COLUMN`s whatever is missing — "column
   additions need no version-gated migration" — while the version chain handles only row backfills.
   **Where it transfers:** August Trading's `schemas/` + SQLite tables could adopt the same split.
   `UNIQUE`.
8. **Separate "the schema version" from "the layout version".** `hermes_state_schema.py:1026-1049`
   keeps `fts_storage_version` independent of `schema_version` so an opt-in, disk-heavy migration
   cannot hold back every future migration. **Where it transfers:** August Trading's heavier
   migrations (e.g. the notebook sharding already noted in AGENTS.md) should not block the fast path.
   `UNIQUE`.
9. **Guard the whole rebuild under a cross-process admission, and fail closed.** `hermes_state_schema.py:1315-1337`
   and `hermes_state_search.py:1302-1346`: "a full structural rebuild must never run concurrently in
   two processes sharing one state.db — that interleaving has structurally corrupted the database in
   production". **Where it transfers:** any August Trading maintenance job that rewrites the
   database must take a lock file, and must *skip* rather than race. `CONVERGENT` (the same
   admission appears in `hermes_state_search.optimize_fts_storage`).
10. **Search routing decided per token, not per query.** `hermes_state_search.py:862-935`: a CJK
    token shorter than 3 chars cannot use the trigram tokenizer, and a *lone* 1-char CJK run cannot
    use the bigram index — so the route is a function of the tokens, and each route's limits are
    named. **Where it transfers:** August Trading's transcript/learned-notes search should route the
    same way rather than assuming one index covers every query. `UNIQUE`.
11. **Escalating search fallbacks, all gated on a zero-result miss.** `hermes_state_search.py:1160-1197`
    — exact → substring-capable index → OR-relaxed any-term → unindexed-gap LIKE. Gating on a miss
    keeps hits at exact ranking. **Where it transfers:** August Trading's "search my journal/trades"
    should try progressively looser matches *only* when the strict one found nothing. `UNIQUE`.
12. **A read-only prompt index that never hydrates the transcript.**
    `hermes_state_timeline.py:53-166` computes the display projection in SQL (two registered SQLite
    functions), counts and pages inside one snapshot transaction, and fetches bodies only for the
    selected page. **Where it transfers:** August Trading's long chat transcript (the Chat surface and
    the Chart AI dock) could render a message index without loading the whole conversation.
    `UNIQUE`.
13. **A "one logical message" fold with a durable identity.**
    `hermes_state_messages.py:1081-1208`: each row carries a `display_identity` (a sha256 of the
    dedupe key) and a `display_order`; the read folds generations so a message that survives a
    compaction paints once. **Where it transfers:** August Trading's transcript rows that get
    rewritten/compacted would benefit from the same durable identity + order pair. `UNIQUE`.
14. **Close the RPC surface: an explicit verb table, not a general API.**
    `hermes_state_worker_lifecycle.py:194-201` and `hermes_state_worker_compression.py:452-477`
    enumerate every verb a sandboxed worker may call; each validates an exact payload key set and
    returns `{'value': …}`. **Where it transfers:** if August Trading ever lets a background job or a
    subagent write to the store, it should get a verb table, not the store. `UNIQUE`.
15. **Keep the owner's implementation and run it on the caller's connection.**
    `hermes_state_worker_compression.py:208-224`: the worker path calls the *owner's*
    `archive_and_compact` / `publish_compression_child` bodies on the worker's transaction, "so main's
    coverage/merge/timestamp/display-order fixes reach worker and mutation verbs too". **Where it
    transfers:** one implementation, two callers, zero drift. `CONVERGENT` (the same pattern appears
    in `hermes_state_worker_compression.archive_on_connection`).
16. **Authority is a provenance rank, not a boolean.** `hermes_state_titles.py:42-92`: user > llm >
    derived, with a NULL source ranking as `user` for legacy rows, and the write is a CAS. **Where it
    transfers:** August Trading's *learned rules* / skills / pattern memory should carry the same
    authority rank so an auto-generated rule can never overwrite a trader-authored one — and a legacy
    NULL must rank conservatively. `CONVERGENT` (the same "source/provenance column" pattern appears
    in `hermes_state_usage`'s cost_status/cost_source and `hermes_state_sessions`'s
    `created_source`).
17. **One copy table for every surface's error copy.** `hermes_state_user_copy.py:16-113`: a single
    cause→(code, gloss, action) table feeds the CLI banner, the gateway warning and the GUI RPC
    error, with a stable machine-readable `code` so a GUI can attach a "Run doctor" button.
    **Where it transfers:** August Trading's storage-failure messages (quota full, IndexedDB blocked)
    should live in one table, not be retyped per surface. `UNIQUE`.
18. **Idempotency keyed by a stable event id, and the check shares the write transaction.**
    `hermes_state_detached_results.py:40-63`. **Where it transfers:** a scheduled automation's
    delivery to a session (or a subagent's result arriving between turns) must be recorded once even
    if two processes race. `UNIQUE`.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** not in this shard — this is the *store*, not the
  scheduler. What it does provide is the substrate a scheduler needs: a durable **cron request id**
  (`cron:<job>:<execution>`) that doubles as the run's session identity and its admission row
  (`hermes_state_keys.py:12-53`), a per-session **failure cooldown** that merge-maxes and is
  persisted so it survives a restart (`hermes_state_compression.py:520-535`), an **anti-thrash strike
  count and recovery deadline** persisted per session (`hermes_state_compression.py:795-830`), and a
  `last_auto_prune` / `last_vacuum` meta throttle so the maintenance sweep cannot run every startup
  (`hermes_state_maintenance.py:333-362`). The idempotency rule — *one row per stable event id, the
  check and the insert in the same transaction* (`hermes_state_detached_results.py:40-63`) — is the
  reusable part for "a scheduled run must not deliver twice".
- **Human-in-the-loop approval:** not in this shard (no approval verbs here), but the *audit
  substrate* is: every consequential write is a CAS against the values read
  (`hermes_state_titles.py:94-129`), destructive transcript mutations require an in-transaction
  snapshot fence (`expected_active_ids` / `expected_display_messages`,
  `hermes_state_sessions.py:1719-1789`), and a **terminal tombstone** keeps a retired session's
  identity so an exact retry is answerable and a *fresh* admission against it is refused
  (`hermes_state_terminal.py:124-147`). The `_stored` envelope keeps the reply once so "a deleted
  session's exact retry still has its reply".
- **Post-mortem / reflection loops:** the closest analogue is the **title provenance ladder**
  (`user > llm > derived`) with a CAS write and a lineage-aware conflict resolver
  (`hermes_state_titles.py:83-163`) — auto-generated naming can upgrade once but never overwrites a
  human name, and the "next title in lineage" numbering ("my session" → "my session #2") keeps
  duplicates from accumulating. The **anti-thrash counters** (`compression_ineffective_count`,
  `compression_fallback_streak`, `compression_recovery_deadline`) are the "what stops a bad rule from
  accumulating" mechanism in this shard: a session that keeps failing to compact is counted, and a
  recovery deadline is persisted so a restart cannot reset the wait
  (`hermes_state_compression.py:795-830`). The rule store itself is outside this shard.
- **Multi-agent:** the relevant piece is **delegate-child cascade** — `_collect_delegate_child_ids`
  walks the `_delegate_from` marker chain recursively, seeds `visited` with the parents so a marker
  cycle can never make a parent delete itself, and cascades the children's messages
  (`hermes_state_sessions.py:191-248`). The compression lineage is *not* a multi-agent structure: a
  branch, a delegate and a reset fork are each their **own conversation**, and every projection
  (listing, resume, delete, usage attribution) has to distinguish them from a continuation — that
  distinction is enforced by one shared predicate family (`_NON_CONTINUATION_CHILD_FILTER_SQL`,
  `_is_explicit_fork_child_row`). Debate itself is outside this shard.
- **Structured logs the model can query:** yes — this shard *is* the queryable log. A SQLite table
  of `messages` with FTS5 external-content indexes (base + CJK bigram + trigram), a durable
  `display_identity` fold, a read-only prompt index with previews
  (`hermes_state_timeline.py:141-166`), a per-`(session, model, provider, task)` usage table
  (`hermes_state_usage.py:350-413`), and a bounded ±1 neighbour context attached to every search hit
  (`hermes_state_search.py:1039-1068`). No heavy database beyond SQLite; the FTS index is a derived
  artefact that can be dropped and rebuilt at any time.
- **Staying simple as features accumulate:** the strongest signal is that this layer refuses to be a
  framework. It is plain mixin classes with **no `__init__` and no state of their own** — "Plain
  mixin for `hermes_state.SessionDB` (no `__init__`/state of its own). Must never import
  hermes_state (cycle); shared constants live in `hermes_state_common`"
  (`hermes_state_search.py:3-6`, `hermes_state_schema.py:3-6`). Where a rule is needed twice, it is
  a **module-level function** both callers import, not a new class (`hermes_state_titles.py:23-35`,
  `hermes_state_sessions_model_config.py:12-40`, `hermes_state_media.py:11-67`). Where the same
  behaviour is needed on two connections, the *owner's body* is reused on the caller's connection
  rather than a second implementation (`hermes_state_worker_compression.py:208-224`). The feature
  count is kept down by pushing behaviour into SQL: filters are a *table*
  (`_PRUNE_FILTERS`), lineage rules are a *predicate*, and the display fold is one function every
  projection calls.

## 4. Non-obvious decisions and gotchas

1. **A "positional" update by content is a trap.** `set_latest_user_api_content` writes the newest
   active user row *and* matches on content. Two identical user turns ("ok") make an older row
   compare equal — the write lands on the wrong turn and stores durable wrong bytes
   (`hermes_state_api_content.py:17-39`). The row-addressed variant exists for exactly this reason.
2. **Compression lock ≠ transcript-write fence.** Ordinary appends must **not** block on the
   compression lock; blocking them was "the root cause of a whole symptom family" of dead turns
   (`hermes_state_messages.py:212-267`). The watermark + column-clone is what actually protects
   concurrent appends.
3. **`active`/`compacted` are three states, not two.** `active=1` = live; `active=0, compacted=1` =
   summarized away but still *displayable and searchable*; `active=0, compacted=0` = rewound /
   replaced — invisible. The display fold must hide a copy whose newest copy is removed
   (`hermes_state_messages.py:1117-1170`).
4. **`display_order` is per segment and not comparable across a lineage.** A multi-segment lineage
   must dedupe-then-page on the merged set; the per-segment `display_order` paging does not apply
   (`hermes_state_messages.py:1363-1372`).
5. **The FTS "external-content delete" hazard.** An external-content FTS5 index whose triggers fire
   for a rowid it never held is the canonical corruption cause — so a *stale* index must have its
   triggers **dropped**, not re-installed (`hermes_state_fts.py:22-30`).
6. **A missing tokenizer is not a missing feature.** Only the *base* FTS5 module being absent
   disables search; a missing trigram/cjk tokenizer disables one route and logs a fallback
   (`hermes_state_fts.py:284-295`).
7. **`sqlite_master.sql` text is the layout.** Layout drift is detected by comparing normalised DDL
   text, and `CREATE VIEW IF NOT EXISTS` never replaces a differing view — so a stale view must be
   dropped explicitly (`hermes_state_search.py:186-244`, `hermes_state_schema.py:351-405`).
8. **`DROP TRIGGER IF EXISTS` takes the write lock** (the `CREATE … IF NOT EXISTS` forms do not), so
   an unconditional drop+recreate blocks every open of a settled database
   (`hermes_state_schema.py:305-338`).
9. **`executescript()` implicitly COMMITs.** Several code paths explicitly avoid it
   (`_execute_ddl_script_transactional`) or recreate outside the transaction
   (`hermes_state_search.py:443-460`).
10. **SQLite cannot `ALTER` a primary key.** Two tables need a RENAME/CREATE/copy/DROP rebuild, and
    the rebuild must be one `BEGIN IMMEDIATE` transaction because the writer connection is autocommit
    (`hermes_state_schema.py:806-938`).
11. **A NULL `title_source` is not "unknown" — it is "legacy user".** Ranking it as `user` is the
    conservative choice (`hermes_state_titles.py:42-47`).
12. **`profile_name` NULL means "unowned"**, and the owner ladder is fail-closed: a NULL-profile row
    vanishes from listings and deep links. The store derives its own profile from `db_path` alone
    (`hermes_state_sessions.py:338-354`).
13. **Row ids are reused after a rollback.** Any writer that stamps `_row_id` onto a caller-owned
    dict must restore the caller's previous state on failure, or the next flush adopts another
    writer's row (`hermes_state_messages.py:472-496`).
14. **Compression re-sequences row ids.** A caller holding a row id across a compaction must
    re-resolve it (`resolve_active_row_id`,
    `hermes_state_messages.py:1048-1066`).
15. **`_execute_transcript_write` and the worker's `publish` are the same body.**
    `publish_on_connection` calls the owner's `_publish_compression_child_on_conn` on the worker's
    connection — a second implementation would drift.
16. **The compaction tip must be found *inside* the write transaction**, or a rotation can publish
    between the lookup and the write and the child keeps a stale copy
    (`hermes_state_sessions_model_config.py:14-18`).
17. **`conversation_generations` rows are never GC'd** — dropping one re-issues generation 1, the
    ABA the table exists to prevent (`hermes_state_messages.py:1905-1920`).
18. **The clock is not the ordering.** Messages are ordered by `id`, "never timestamp: clocks
    regress" (`hermes_state_messages.py:1344-1348`); the conversation boundary is wall-clock-free so
    an NTP correction cannot reorder it.
19. **A "read-only" open must not run DDL.** `schema_read_probe_statements` exists because
    "read-only opens skip `_reconcile_columns()` (no DDL against another profile's live DB)"
    (`hermes_state_schema.py:169-184`).
20. **`_remove_session_files` sweeps every historical filename** because "a 'deleted' session's
    snapshot can carry plaintext secrets" (`hermes_state_sessions.py:1647-1666`).

## 5. Weak spots

1. **The `messages` table has grown 27 columns and the code says so.**
   `_MESSAGE_WRITE_COLUMNS` is derived by regex from the INSERT statement
   (`hermes_state_messages.py:40-51`), and `_row_to_message_dict` has a generic "drop unknown BLOB
   columns" escape hatch because "a `SELECT *` picks up every column, including any BLOB added to the
   schema later". That is a symptom of a schema that has outgrown its shape; the durable `messages`
   row is doing the work of several tables (content, reasoning sidecars, identity, display index,
   metadata).
2. **Column-level decisions are spread across dozens of SQL constants.** `_LIVE_IDENTITY_SQL`,
   `_DISPLAY_META_ROW_SQL`, `_ARCHIVE_ACTIVE_SQL`, `_SET_COUNTERS_SQL`, `_RESET_COUNTERS_SQL`,
   `_SHADOWED_CHECKPOINT_ROWS_SQL`… each a separate string that must be kept consistent with the
   INSERT shape and the column list. The comment "Every column this module knows how to read"
   (`hermes_state_messages.py:44-47`) is the tell: the module knows about columns by convention.
3. **The comments carry the invariants; the code does not.** The load-bearing rules — "the lock's job
   is to stop two COMPRESSIONS colliding", "the pin covers the whole conversation", "a stale index
   must keep its triggers DROPPED", "a NULL title_source ranks as user" — are enforced by carefully
   crafted SQL and prose, but a future edit that misses one sentence breaks a subtle invariant.
   Several rules are pinned only by *source-scanning tests* ("the SQL trace harness", "the SQL text
   is part of the contract"), which is a strong smell of an over-tight contract.
4. **The recovery paths are themselves large and stateful.** `_recover_stale_fts_locked`,
   `_defer_stale_fts_for_holders`, `optimize_fts_storage`, `_demote_legacy_fts_to_trash` and
   `_fts_teardown_trash_step` together are several hundred lines of state-machine code with
   markers in `state_meta`, FTS table renames into `fts_v22_trash_*`, and a duty-cycled chunked
   backfill. A subtle interaction here (e.g. the trigram tokenizer missing mid-demote) has already
   cost several incident fixes.
5. **A few write paths still silently swallow.** `_write_sql_logged` logs and never raises on
   `sqlite3.Error` (`hermes_state_compression.py:520-535`), and `_carry_parent_timestamps` catches
   every exception and returns (`hermes_state_messages.py:625-656`). Both are deliberate
   best-effort choices — but a reader must know which failures are allowed to vanish.
6. **The FTS layout registry is a literal list of past DDL strings** that must be extended by hand
   for every change, and a test fails if the shipping DDL is not the registry's last entry. It is a
   faithful record but it is also a growing pile of dead strings that only a test can justify.
