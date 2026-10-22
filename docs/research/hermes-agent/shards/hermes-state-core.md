# hermes-agent :: hermes-state-core

**Files in shard:** 7 (read: 7, skipped with reason: 0)
**What this shard covers:** the durable-state core of Hermes Agent — the SQLite `state.db` that holds
session metadata, message history, model config and FTS5 search, plus the five satellite modules that
make that store survive a hostile world: a WAL lock guard (OFD `fcntl` locks that a stray `close()`
cannot cancel), a `/proc/locks` reader that *names* the process holding the write lock, a
PID-namespace identity layer for lock/lease holders, an in-place row-rewrite committer for the
proactive transcript prune (with a row-version CAS digest), a backward-looking cross-profile repair
module that finds and settles rows that landed in the wrong store, and a carrier-aware user-turn
rewind (`/undo`, `/retry`) implemented once behind the CLI, the gateway and the TUI. Everything here
is about **one writer connection, many readers, and never losing a turn**.

---

## 1. File-by-file

All seven files are `source` (Tier 1) and were read in full.

### `hermes_state.py` (1,732 lines)

- **Purpose:** The `SessionDB` facade — one SQLite database, WAL mode, one writer connection, a
  bounded read-only pool, FTS5 search, and a hard-won set of refusal behaviours for a store that has
  been replaced, corrupted, or split-brain under it.
- **Key abstractions:**
  - `SessionDB` (`:463`) — a 16-mixin class: `SessionSessionsMixin`, `SessionFtsSetupMixin`,
    `SessionSearchMixin`, `SessionSchemaMixin`, `SessionPortabilityMixin`,
    `SessionTelegramTopicsMixin`, `SessionCompressionMixin`, `SessionGatewayMixin`,
    `SessionMaintenanceMixin`, `SessionUsageMixin`, `SessionTitlesMixin`, `SessionMessagesMixin`,
    `SessionPruneRewriteMixin`, `SessionApiContentMixin`, `SessionCoverageMixin`,
    `SessionRewindMixin`, `SessionProfileRepairMixin`. The facade owns only the *connection*
    lifecycle; every row operation lives in a mixin.
  - `AsyncSessionDB` (`:1719`) — a door onto `SessionDB` where every method is dispatched through
    `asyncio.to_thread`, so a blocking SQLite call never freezes the event loop.
  - The write primitive `_execute_write(fn, patience_s)` (`:1008`) — every mutation in the whole
    system goes through it.
  - The read primitive `_read_ctx()` (`:931`) — a context manager that hands out a pooled read-only
    connection or degrades to the writer connection under `self._lock`.
  - Error taxonomy: `SessionResumeTooLargeError` (`:116`), `SessionExportTooLargeError` (`:130`),
    `SessionCompressionInProgressError` (imported `:44`), `StateDbCorruptError`,
    `StateDbReplacedError`, `DeletedWalGenerationError` (`:39-44`).
- **Data flow:**
  1. `__init__` (`:582`) → `_ensure_test_isolation` (`:213`) → `_open_writer` (`:679`) or
     `_open_read_only` (`:731`) → `_record_db_file_identity` (`:1220`).
  2. `_open_writer` runs a preflight, quarantines a zero-byte/headerless file aside
     (`:775`), connects with a 1 s SQLite timeout, and *then* waits out a sibling's write lock with
     jittered patience (`_connect_and_init_with_lock_patience`, `:833`) so a sibling's VACUUM cannot
     fail the whole open.
  3. After a successful open, `_lockguard.hold(self.db_path)` (`:727`) takes OFD copies of the two
     POSIX lock ranges SQLite relies on.
  4. Writes: `_execute_write` → `BEGIN IMMEDIATE` → `fn(conn)` → `commit`, with the *whole callback*
     retried on lock/busy (`:1010-1125`). Reads: `_read_retrying_ioerr` (`:1153`) → `_read_ctx` →
     pooled `mode=ro` connection.
  5. Every write first calls `_halt_if_db_generation_changed` (`:1276`): the file's inode and
     `application_id` are compared against the identity snapshotted at open, and the WAL/SHM
     sidecar inodes likewise. A replace or a lost generation is **sticky**: it raises
     `StateDbReplacedError` / `DeletedWalGenerationError` forever after.
- **Non-obvious design decisions:**
  - **Patience is time-based, not attempt-counted, and it varies by call criticality**
    (`:486`): transcript writes get 60 s, ordinary writes 20 s, *observation-only* activity
    heartbeats get 0.5 s. The comment is explicit that attempt-counted budgets "destroyed turns on
    a healthy store" — a sibling legitimately holds the lock for seconds (checkpoint, VACUUM, FTS
    pass), and that is not an error.
  - **The compression lease is a correctness boundary, not a busy signal** (`:497-499`): a turn that
    lands mid-compression waits only 5 s and is then *refused* rather than allowed to land a stale
    turn. "The lease is a correctness boundary, not just a busy signal."
  - **`_secure_state_db_files` uses `chmod(2)`, never `open()`+`fchmod()`** (`:246-303`): opening
    and closing a descriptor in the same process drops every POSIX `fcntl` lock the process holds
    on that inode — including a live SQLite connection's own locks. The file is created with
    `O_EXCL|O_NOFOLLOW|O_CLOEXEC` so a brand-new inode gets the 0600 mode and a planted symlink is
    refused.
  - **The close-time checkpoint is disabled on a quarantined handle** (`:1366`,
    `SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE`): SQLite's own `close()` would write a retired generation's
    pages over the *newer* file. On Python < 3.12 (no `setconfig`) the handle is instead **retired
    unclosed** and the connection is pinned (`:1396`, `:1405`) so the stale frames are never
    checkpointed.
  - **Close uses `PASSIVE`, never `TRUNCATE`** (`:1560-1574`): every cron run opens and closes a
    transient `SessionDB`, so a TRUNCATE fires a full WAL reset many times an hour, racing the
    gateway's long-lived writer and tearing hot B-tree pages.
  - **Reads degrade in a ladder, never block** (`:862-901`, `:931-972`): pooled `mode=ro`
    connection → writer connection under the lock → (after `close()`) a loud reopen. A reader that
    cannot get an fd permit "must degrade to the writer lock, not queue here — blocking would
    convert fd exhaustion into a stall, which is the same outage with a different stack trace".
  - **Corrupt FTS shadow tables fail *open*, structural damage fails *closed*** (`:1104-1124`):
    FTS-only damage detaches the derived indexes atomically and retries ("never rebuild here");
    anything else quarantines the handle — no further writes, no automatic reopen, no checkpoint at
    close.
  - **Replay-time scrubbing of the harness's own prompts** (`:306-370`): the background-review
    harness prompt and the assistant reply that followed it are stripped from a restored session,
    because "older builds wrote the forked curator's turns into real sessions; replaying them
    hijacks the session". Stale bare `[marker]` assistant turns are blanked because "replaying it
    teaches the model to keep emitting it".
  - **When the store is replaced under a live process, the transcript is diverted to JSONL, not
    lost** (`:433` `divert_session_transcript_jsonl`).
  - **Content-addressed prompt/tool-pin storage** (`:514`): the system prompt and the tool-name
    pin are stored by SHA-256 hash, and unreferenced ones are GC'd (`:525`).
  - **Title provenance has a rank** (`:1616`): `derived(0) < llm(1) < user(2)`. Auto-titling may
    only replace a *strictly lower*-authority title, never a user-typed name.
  - **One-shot migrations are gated in `state_meta`** (`:1663` `retag_kanban_worker_sessions`):
    the gate key is written in the same transaction as the mutation, so the migration is exactly-once
    per root and survives a crash.
  - **Async token accounting is a deque + one writer thread** (`:1595-1609`): deltas are coalesced
    when their *route* fields are equal (model, cost status, pricing version, billing provider,
    source, task), so the merged `UPDATE` equals applying them sequentially; exact readers call
    `flush_token_counts()`.
- **Edge cases & failure handling:**
  - Zero-byte / invalid-header DB → moved aside (quarantined), a fresh one opened, and the operator
    is told to run `hermes sessions recover --source <path> --inspect-only` (`:775-795`).
  - Malformed `sqlite_master` → one in-place repair with a backup, then one reopen (`:708-720`).
  - A read-only open that hits a transient `SQLITE_IOERR` retries 3× with 50 ms backoff
    (`:184-188`, `:731-763`) — the window is a writer's checkpoint; a lock error is deliberately
    *not* retried (the connection already waited 5 s).
  - `close()` racing an in-flight writer → the writer reopens the connection loudly
    (`_reopen_after_close_locked`, `:974`) with a WARNING naming the race (#94736), and it refuses to
    reopen a quarantined handle.
  - A PID-reuse-safe lease reclaim: `_compression_lock_holder_process_is_dead` (`:141`) proves a
    holder is dead only by kernel evidence; "a wrongly-kept one self-heals" at TTL expiry.
  - Import caps (`:508`): 500 sessions, 10 k messages/session, 50 k messages total, 5 MiB/session,
    25 MiB total — an import holds one `BEGIN IMMEDIATE`, so it is bounded.
  - `__del__` (`:1586`) is only a safety net; the docstring at `:1504-1516` says outright that
    "'eventually, after the idle window and a GC cycle' is not a release policy" and that owners
    must close deterministically.
- **Surprising:**
  - `state_meta` is read on `self._lock` rather than through `_read_ctx` (`:1644`): the FTS rebuild
    step reads its own progress *before* its write transaction, and a WAL reader would not see it.
  - `_is_no_more_rows` is treated as a *transient* error and retried (`:1082`) — "a transient engine
    error on contended WAL appends".
  - `_repair_attempted_paths` (`:419`) is a process-wide set: auto-repair happens **at most once per
    DB path per process**, so a second corruption in the same process gets no repair attempt.
  - The file mixes store mechanics with product policy: file-mode hardening, the pytest live-system
    guard, transcript scrubbing, title provenance, the bot-mode canonical-chat title
    (`CANONICAL_BOT_CHAT_TITLE = "Bot Chat"`, `:1623`), the kanban retag, and the token-accounting
    field lists all live in the facade.

### `hermes_state_lockguard.py` (195 lines)

- **Purpose:** Hold `state.db`'s WAL-mode file locks in a form that a stray `close()` inside the same
  process cannot cancel.
- **Key abstractions:** `hold(db_path, held) -> Held` (`:146`), `release(held)` (`:167`),
  `supported() -> bool` (`:85`), `Identity = (st_dev, st_ino)`, `Held = dict[Identity, (start,
  length)]`, module-level `_HANDLES: dict[Identity, int]` (`:82`).
- **Data flow:** `hold()` computes the two guard ranges (SQLite's SHARED range on the main file at
  `_PENDING_BYTE + 2`, length 510; the DMS byte 128 of `-shm`), resolves the inodes of `state.db` and
  `state.db-shm`, then walks `/proc/self/fd` (or `/dev/fd`) (`:114`) to find *every* descriptor this
  process holds on those inodes, and applies `F_OFD_SETLK` read locks to each (`:95`). `release()`
  decrements a per-inode handle count; only the last handle unlocks (`:167-195`).
- **Non-obvious design decisions:**
  - **OFD locks instead of POSIX locks** (`:1-33`): POSIX advisory locks are per *process*, so any
    `open()`/`close()` of those files anywhere in the holder — a raw probe, a plugin, a tool reading
    `~/.hermes` — cancels SQLite's own locks and strands the holder on a deleted generation
    (sqlite.org/howtocorrupt.html §2.2). OFD locks belong to the *open file description*, so they
    die with the descriptor and cannot be cancelled by another `close()`.
  - **The guard is lifted *before* the handle's own close** (`:167-195`): lifting it first re-takes
    SQLite's own POSIX locks on the same ranges, so the handle is never unlocked while its
    connection is still open, and a true last close still ends the generation normally.
  - **Handle counts are per INODE, not per fd** (`:1-33`, `:82`): "a descriptor number is reusable",
    so counting fds would let a recycled fd be mistaken for a surviving lock.
  - **Capability is probed, not assumed** (`:51-72`): `F_OFD_SETLK` is missing from CPython before
    3.12, so the kernel ABI values are hard-coded (37 Linux, 90 XNU) — and because `_ofd_lock()`
    calls `fcntl.fcntl()`, the module probes for a *callable* `fcntl.fcntl`, not just the constant.
    A partial module must degrade to the no-op, "because every importer of hermes_state dies before
    `supported()` can say 'no' (#118026)".
  - **The platform gate comes FIRST** (`:44-50`): some Windows installs have a third-party module
    importable as `fcntl`, and letting the import decide would arm the guard on a lookalike.
  - **`struct flock` layout differs per libc** (`:74`): glibc/musl put `type`+`whence` first,
    Darwin/BSD last.
- **Edge cases & failure handling:** every `fcntl` call is wrapped; a `BlockingIOError` means the
  range is held EXCLUSIVE elsewhere and `_ofd_lock` returns `False`; `OSError` during `hold` is
  logged at DEBUG and the guard is simply absent; `release()` swallows `OSError`.
- **Surprising:** `_own_fds_for` deliberately includes "the cached header-probe fd too, harmless"
  (`:114-134`) — the guard is about *any* descriptor on the inode, not about SQLite's own.

### `hermes_state_lockowners.py` (125 lines)

- **Purpose:** Name the process that currently holds a write-class lock on `state.db`, by parsing
  Linux `/proc/locks`.
- **Key abstractions:** `parse_proc_locks(text, inodes)` (`:49`) — a pure function from the
  `/proc/locks` text to `[(pid, lock kind, sidecar)]`; `state_db_write_lock_holders(db_path)`
  (`:81`) — the operator-facing strings; `log_write_lock_holders(db_path, patience_s)` (`:115`).
- **Data flow:** stat `state.db`, `-wal`, `-shm` to build an `(st_dev, st_ino) -> sidecar` map
  (`:83-90`); read `/proc/locks`; for each line, drop anything that is not a `WRITE` lock and drop
  blocked waiters (`fields[1] == "->"`); map the byte range to a human name via `_describe_range`
  (`:35`) using SQLite's own lock geometry (`UNIX_SHM_BASE = 120`; slots 120-122 are
  `WAL write`/`checkpoint`/`recover`, 123-127 are read slots, 128 is the shm dead-man switch).
- **Non-obvious design decisions:**
  - **Read locks are dropped** (`:59-63`): in WAL mode they never block a writer.
  - **The file is read three times and the results unioned** (`:93-104`): `/proc/locks` is
    host-wide and served over several `read()`s, so lock churn in other processes shifts it
    mid-read and can skip the holder. "A skip rarely repeats, so union three passes."
  - **An OFD lock is reported with pid `-1`** (`:71-74`, `:107`): the kernel does not export the
    owner of an OFD lock, so the line says so rather than lying.
  - **The message names the operation, not disk damage** (`:115-125`): "state.db write lock
    unavailable for 20s (state.db): <holder> holds WAL write lock on state.db". The sibling module
    comments that classification by phrase would flip the bucket if a holder's argv happened to
    contain e.g. `fix-corrupt-db`.
  - **"no write-class lock held at the deadline (the holder released just before it)"** (`:120`) is
    an explicit, honest case — the failure is real even when the evidence is gone.
- **Edge cases & failure handling:** non-Linux returns `[]`; an unparseable line is skipped; the
  inode map only contains files that exist, so a missing `-wal` is simply not matched.
- **Surprising:** the whole module exists because the open-descriptor scan
  (`hermes_state_holders`) "cannot tell a reader from the one writer: every Hermes process has the
  DB open" (`:5-9`).

### `hermes_state_pidns.py` (132 lines)

- **Purpose:** Make a lock/lease holder's identity meaningful across PID namespaces, so a reader in a
  sibling namespace cannot mistake a live holder for a dead one and reclaim its unexpired row.
- **Key abstractions:** `LocalPidNamespace(id, supported)` (`:30`) — a three-state value:
  *unsupported* (no namespace identity at all), *resolved* (`id` set), or *lookup failed*
  (`supported=True`, `id=None`). `pid_namespace_id()` (`:74`), `holder_namespace_token()` (`:81`),
  `holder_pid_checkable(holder)` (`:109`), `persistent_record_pidns_checkable(recorded)` (`:120`),
  and the shared matrix `_qualify(recorded, unstamped_checkable=...)` (`:96`).
- **Data flow:** a holder string is built as `f"pid={os.getpid()}{holder_namespace_token()}:turn=…"`
  (`:81-88`), where the token is `:pidns=<inode of /proc/self/ns/pid>`. A reader extracts the stamp
  with `_PIDNS_TOKEN_RE` (`:27`) and asks `_qualify`.
- **Non-obvious design decisions:**
  - **Two policies for unstamped (pre-upgrade) records, and the reason is spelled out**
    (`:1-25`, `:96-132`): `holder_pid_checkable` is **STRICT** for TTL rows (compression locks, turn
    leases) — an unstamped holder defers to its expiry, "a false defer self-heals, a false reclaim
    ends a live turn". `persistent_record_pidns_checkable` is **LEGACY** for no-expiry flock
    records — an unstamped record keeps being probed, "because refusing to probe them would
    permanently disable orphaned-lock cleanup".
  - **A failed namespace lookup is NOT cached** (`:49`, `:63-72`): "A failed read is NOT cached — it
    may be transient, and while it lasts every structured holder is unverifiable." A successful
    read *is* cached, because a process cannot move itself into another PID namespace.
  - **"Unknown authority is not authority"** (`:103-105`): if our own lookup failed, nothing is
    checkable.
  - **A holder never asserts a namespace it cannot prove** (`:74-79`): the stamp is omitted rather
    than guessed.
- **Edge cases & failure handling:** non-Linux → `LocalPidNamespace(None, False)` and a plain pid
  probe is used; a `readlink` that fails → `LocalPidNamespace(None, True)`.
- **Surprising:** the same `pid=<n>` string means different things in different namespaces, and the
  fix is a *string* stamp rather than a structured lock record — the holder string is already a
  structured `key:value` token soup, so no new record type was needed.

### `hermes_state_prune_rewrite.py` (259 lines)

- **Purpose:** Commit a *proactive prune* (an edit to a few transcript rows) by rewriting those rows
  **in place**, instead of re-inserting the whole live transcript.
- **Key abstractions:** `SessionPruneRewriteMixin` (`:26`) with `rewritten_held_row_ids(session_id,
  held)` (`:29`), `held_row_mismatches(conn, session_id, held)` (`:52`) and
  `rewrite_pruned_rows(session_id, changes, model_config_patch=None)` (`:133`).
  Module constants `_MESSAGE_ROW_COLUMNS` (`:20`, parsed out of `_INSERT_MESSAGE_SQL` so a rewrite
  can diff `_message_row_params` *by name*) and `_PRUNE_FIXED_COLUMNS` (`:23`:
  `session_id, role, tool_call_id, timestamp, active, display_identity` — "a prune only changes what
  a message says; who said it, when, and in which row never move").
- **Data flow:** for each `(original, replacement)` pair, `_resolve` (`:170-206`) names the target
  row — by `_row_id`, else by `tool_call_id` (tool results), else by the exact `tool_calls` id list
  (assistant turns), else by a single active row with the same role and stored content. It then
  CAS-checks the row: the `DB_ROW_SNAPSHOT` digest (`transcript_row_snapshot(row)`) if the held dict
  carries one, else a representation-safe loader-lens identity compare. On success the row gets
  **one archived twin** of its pre-prune self (`active=0, compacted=1`) and then takes the
  replacement's changed columns under its own id (`:225-259`). Triggers keep FTS and
  display-identity indexes consistent; the counters do not change because no row enters or leaves
  the live set.
- **Non-obvious design decisions:**
  - **The whole point: the old generation writer grew the store by the full live transcript on
    every prune** (`:141-147`): "`archive_and_compact` is a generation writer: it archives every
    active row and re-inserts the whole list, which is right for summary compaction … but makes
    each prune grow the store by the full live transcript although a prune only edits a few rows."
  - **Two distinct failure classes, two distinct error types** (`:149-155`): `PruneRowUnresolvedError`
    (ambiguity — zero or several matches, a merged dict, an inactive row, a user row) means "commit
    through the full writer instead"; `PruneRowStaleError` (the named row's payload moved on) means
    "another writer's generation — the full writer must not be handed the stale transcript".
    Refusing to fall back on a *stale* row is the safety property.
  - **The staleness check is a row-version CAS, not a byte compare** (`:193-206`): the digest is
    computed from the **read-back row**, "so storage affinity can never fake a mismatch", and it
    covers every owned column including assistant `tool_calls` arguments.
  - **The comparison is representation-safe** (`:199-206`, and `hermes_state_rewind.py:48`): raw
    storage bytes are never compared against a loaded/normalized view; both sides go through the
    loader lens.
  - **The replacement is re-stamped with the *committed* digest** (`:255-259`): "a second prune of
    this transcript must compare against what this commit wrote, not what it replaced, or it would
    false-stale against its own output."
  - **The CAS must run inside the writer's commit window** (`:56-63`): `held_row_mismatches(conn, …)`
    takes the caller's connection because "a precheck outside that lock misses a write that lands
    between check and commit".
  - **Identity resolution degrades through three named keys** (`:173-188`): `_row_id` → `tool_call_id`
    → exact `tool_calls` id list → content match; a fuzzy match is refused, not guessed.
  - **The module is split out of `hermes_state_messages` for a FILE_LINES ratchet** (`:1-8`) — a
    size gate, not an architectural one. It is bound into the same MRO slot so every existing
    `session_db.rewrite_pruned_rows(...)` call site and *test patch seam* keeps working.
- **Edge cases & failure handling:** the display-identity trigger nulls the slot of the live row and
  of every visible row sharing its old identity, so the code re-assigns `display_identity` /
  `display_order` to the peers explicitly (`:236-252`); the live row then takes the identity of
  what it now stores. `model_config_patch` is merged with `on_missing="raise"`. Rollback restores
  each dict's row state so a failed commit never leaves a replacement stamped with an uncommitted
  digest (`:262-265`).
- **Surprising:** a user row is *never* rewritten in place (`:171-172`) — only assistant and tool
  rows are eligible; a user row forces the full writer.

### `hermes_state_rewind.py` (163 lines)

- **Purpose:** Carrier-aware user-turn rewind (`/undo`, `/retry`) — **one** implementation behind the
  CLI, the gateway and the TUI.
- **Key abstractions:** `RewindTargetUnavailableError` (`:14`), `RewindPlan` (`:21` — the full
  read-only plan: `target_row_id`, `expected_active_ids`, `expected_target_content`, `scaffold`,
  `prefix`, `durable_prefix`, `live_view`, `live_text`, `durable_user`, `user_ordinal`),
  `RewindOutcome` (`:35`), `SessionRewindMixin` (`:56`) with `rewind_user_turn(...)` (`:59`) and
  `plan_user_turn_rewind(...)` (`:113`).
- **Data flow:** `plan_user_turn_rewind` reads the durable conversation *twice* — once plain and
  once with `repair_alternation=True` — and addresses turns on the **repaired** projection, because
  a live replay merges a stored `user;user` pair into ONE turn (`:135-143`). It computes the prefix,
  splits a compaction carrier into `scaffold` + live view, and validates the warm (in-memory)
  history against the durable one. `rewind_user_turn` then calls `rewind_to_message(...)` with the
  plan's *pins* (`expected_active_ids`, `expected_target_content`) and `preserve_compaction_handoff`
  when a scaffold exists.
- **Non-obvious design decisions:**
  - **The durable transcript is the authority; the warm history only has to agree with it**
    (`:1-4`). If the warm history has a different number of user turns, or the live target text
    differs, it raises `RuntimeError(_HISTORY_CHANGED)` and **nothing changes**.
  - **The plan/apply split exists so a refused re-send leaves the rewind unapplied** (`:113-121`):
    "the gateway `/retry` commits the planned rewind inside its re-send's admission transaction
    (`rewind_in_transaction` with the plan's pins), so a refused re-send leaves it unapplied."
  - **The pins are part of the plan, not the call** (`:21-33`): `expected_active_ids` and
    `expected_target_content` travel with the plan so the write can detect a concurrent change.
  - **Retry text is the *stored bytes*, not the display flattening** (`:150-153`): `"".join` of the
    text parts, never the `"\n"`-joined flattening — "`"ab"` must not come back as `"a\nb"`".
  - **A composite compaction carrier keeps its hidden handoff scaffold as the new head**
    (`:88-95`): the installed scaffold *is* the replacement row, so it carries the replacement's
    `_row_id` and `MESSAGE_UID`, not just its old row id.
  - **Two different comparison targets** (`:154-160`): the *stored* row for a merged turn holds only
    the first ask, so the in-transaction payload pin is compared against `stored_view`, not against
    the merged live view.
  - **`adopt_row_ids` is guarded by a full shape check** (`:96-104`): the warm prefix may only
    adopt the durable identities if the roles, display kinds and projected contents all match.
- **Edge cases & failure handling:** out-of-range ordinal → `RewindTargetUnavailableError`; a
  negative ordinal counts back from the newest and clamps to the oldest (`:137-138`); a
  `ValueError` from `rewind_to_message` (target vanished or changed role) is re-raised as
  `RewindTargetUnavailableError` so the caller shows "nothing to undo" (`:83-85`); a missing
  replacement id → `RuntimeError("rewind did not retain its compaction handoff")` (`:86-88`).
- **Surprising:** the module imports from `agent.context_compressor`,
  `agent.session_persistence`, `hermes_state_messages` *inside the functions* — deliberate late
  imports to break import cycles, and a hint that `state.db` is downstream of the agent core rather
  than the other way round.

### `hermes_state_profile_repair.py` (390 lines)

- **Purpose:** Find and settle **crossed-profile** rows in one `state.db` — sessions whose identity
  disagrees with themselves or with the store they landed in.
- **Key abstractions:** `session_key_profile(session_key)` (`:36`) — the profile encoded in an
  `agent:<ns>:…` gateway key; `SessionLedgeredError` (`:65`); `SessionProfileRepairMixin` (`:72`)
  with finders `find_crossed_profile_sessions(owner)` (`:77`), `find_profile_less_telegram_topic_rows()`
  (`:137`), fixers `relabel_sessions_to_key_profile` (`:162`), `sever_crossed_parents` (`:185`),
  and the move trio `export_session_for_move` (`:210`) / `import_moved_session` (`:237`) /
  `delete_moved_session` (`:278`).
- **Data flow:** every session key encodes the profile that owns the conversation
  (`agent:main:…` = default, `agent:<name>:…` = a named profile). A row is *mislabelled* when
  `profile_name` disagrees with its own key, *foreign* when the key's profile is not this store's
  owner, and *crossed_parents* when a child and its parent name different profiles (`:80-113`).
  The move is two single-store transactions: copy into the target, then delete from the source.
- **Non-obvious design decisions:**
  - **The move order is load-bearing and the reason is stated** (`:17-31`): "Moving a session
    between two stores is two single-store transactions — copy into the target, then delete from the
    source — because a crash between them leaves a *duplicate*, which the next run settles
    idempotently … The reverse order would lose the row." The target's `import_moved_session`
    returns `"present"` when the id already exists (`:240-241`), and the delete only proceeds when
    the target holds at least as many messages.
  - **The module is the *backward-looking half* of a forward-only migration** (`:11-17`): the
    per-profile store model "routes NEW writes to the right store but never touched rows that had
    already landed in the wrong one"; this module "names each crossed row and can settle it".
  - **A session with gateway admission/worker history is refused, not copied** (`:65-70`,
    `:115-130`): those tables are `ON DELETE RESTRICT`, so "a move copies only the transcript, so
    such a row could never leave the source: report it instead of copying it." The check is
    re-run at apply time because "the scan may predate a turn".
  - **The target's schema wins; missing columns are dropped, never invented** (`:270-276`,
    `_insert_row` intersects the payload with `PRAGMA table_info`).
  - **`id` and `display_order` never carry over** (`:62`): `id` is reassigned by the target's
    AUTOINCREMENT and `display_order` points at a message id of the *source* store — left NULL, the
    `messages_display_order_insert` trigger recomputes it from `display_identity` (a content hash,
    store-independent).
  - **A content-addressed pin hash is re-stored, never copied blindly** (`:257-261`): "A pin hash
    means nothing in this store: re-store the pin, or drop an unresolvable ref."
  - **A title collision is resolved in favour of the resident row** (`:249-256`): the moved row
    gets the session id's tail as a suffix, "since the resident row keeps its name, since it is the
    one this profile's clients resolve by title."
  - **The parent link survives only if the parent is already in the target** (`:245-248`): "a moved
    row must never point across stores or at a row of another profile."
  - **The rekey is a substring surgery, guarded by a `substr` predicate** (`:298-316`):
    `agent:main:` → `agent:<profile>:`, only for rows still under the legacy namespace.
  - **Routing rows adopt with `INSERT OR IGNORE`** (`:329-342`): "An existing key wins — the row the
    gateway actually loads stays."
  - **The topic-binding relabel removes the stale duplicate rather than merging** (`:355-366`): a
    binding that would collide with one the named profile already wrote is deleted.
- **Edge cases & failure handling:** `session_key_profile` returns `None` for keyless rows
  (CLI/subagent lineage) or keys minted by another producer (hosted rooms, tests) — those are
  skipped, not guessed. `_stored_profile` treats NULL/blank as "unowned", "not a crossing".
  `delete_moved_session` detaches children left behind before deleting, and emits a
  `session_deleted` event with `reason="profile_repair"` (`:290-295`).
- **Surprising:** the module is explicitly "Store-level only" (`:19-25`): which profiles exist, which
  store owns which home, and the JSON files outside `state.db` are the orchestrator's concern —
  the store layer refuses to know about them.

---

## 2. Ideas worth stealing

1. **A row-version CAS digest on every persisted record.** `DB_ROW_SNAPSHOT` /
   `transcript_row_snapshot(row)` is computed from the *read-back* row and covers every owned
   column, so a writer can prove "the row I read is still the row I am about to overwrite" before
   it writes. `hermes_state_prune_rewrite.py:193-206`, `:255-259`. **Why it transfers:** August
   Trading rewrites persisted analyses and journal entries from several places (a re-analysis, a
   settlement, a learning note); a digest column on the stored record turns "last write wins" into
   "the second writer is told it lost" — and the digest must be re-stamped from the committed row,
   or the writer false-stales against its own output.
2. **Compare through the loader lens, never raw storage against a loaded view.**
   `hermes_state_rewind.py:48-54` (`_comparison_content` → `_durable_content` → `_loaded_view_content`)
   and `hermes_state_prune_rewrite.py:199-206`. **Why it transfers:** August Trading rehydrates
   records from IndexedDB/SQLite and compares them with in-memory objects; a byte compare between a
   JSON-encoded stored field and a structured in-memory field is a permanent false-positive source.
3. **In-place row rewrite for a targeted edit, with an archived twin.**
   `hermes_state_prune_rewrite.py:133-262`. The old generation writer re-inserted the whole live
   transcript for a change that touched two rows, so the store grew by the full transcript on every
   prune (`:141-147`). **Why it transfers:** August Trading's "Log this trade" / settlement pass
   re-writes an existing trade record; rewriting in place (and keeping one archived copy) keeps the
   journal's size proportional to the number of *trades*, not to the number of *edits*.
4. **Plan / apply split for a destructive operation, with the pins travelling in the plan.**
   `hermes_state_rewind.py:21-33` (`RewindPlan`) and `:113-121`. The gateway `/retry` commits the
   *planned* rewind inside the re-send's admission transaction, "so a refused re-send leaves it
   unapplied". **Why it transfers:** August Trading's "re-analyse this setup" and "retry this turn"
   should be planned (validated) first and applied inside the same transaction that performs the
   new work — otherwise a failed re-send leaves the trade half-rewound.
5. **Durable is the authority; the warm view must agree or nothing changes.**
   `hermes_state_rewind.py:1-4` and `:143-149` — a different number of user turns or a different
   live target text raises `RuntimeError` and the store is untouched. **Why it transfers:** the
   React store and the persisted store in August Trading can disagree; the rule "the persisted copy
   wins, and a disagreement is a *refusal* rather than a silent overwrite" is directly reusable for
   the trade journal and the chat transcript.
6. **Two distinct error classes for "I could not name the row": ambiguous vs stale.**
   `hermes_state_prune_rewrite.py:149-155`. `PruneRowUnresolvedError` → fall back to the full
   writer; `PruneRowStaleError` → *refuse*, because the full writer would then archive a newer row
   and republish the stale text over it. **Why it transfers:** August Trading's learning/settlement
   writers need the same split: "I cannot find the record" (re-fetch and retry) vs "the record
   changed under me" (do not overwrite).
7. **Name the lock holder, and be honest when the evidence is gone.**
   `hermes_state_lockowners.py:81-125`. **Why it transfers:** when August Trading's persistence
   fails, "another window holds the write lock" is a real diagnosis; and the explicit
   "no write-class lock held at the deadline (the holder released just before it)" case is the
   kind of honest detail that keeps an operator's trust in the error.
8. **Time-based retry budgets with jitter, budgeted by call criticality.**
   `hermes_state.py:486-502` — transcript 60 s, ordinary 20 s, observation-only 0.5 s, and the
   reason attempt-counted budgets were abandoned ("destroyed turns on a healthy store").
   **Why it transfers:** August Trading's trade-log writes are on the user's critical path; a
   heartbeat or a "last viewed" write is not. One knob per class, not per call site.
9. **A correctness boundary is not a busy signal.** `hermes_state.py:497-499` — a turn that lands
   mid-compression waits 5 s and is then *refused*, not allowed to land a stale turn. **Why it
   transfers:** August Trading has a "trade plan validation" gate; the same rule should apply — a
   bounded wait, then a refusal that names the blocker, never a write that lands against a newer
   generation.
10. **Cross-store migration that is idempotent by construction.** `hermes_state_profile_repair.py:17-31`
    — copy first, delete second; a crash leaves a *duplicate* that the next run settles
    (`import_moved_session` returns `"present"`). **Why it transfers:** any August Trading migration
    (profile switch, workspace move, import) should be written so the crash state is a duplicate,
    never a loss.
11. **The backward-looking half of a migration.** `hermes_state_profile_repair.py:11-17` — the
    forward-only migration "routes NEW writes to the right store but never touched rows that had
    already landed in the wrong one"; a separate module *names* each damaged row and can settle it.
    **Why it transfers:** a repo that has ever changed its storage layout (August Trading's
    `RAW_LOCAL_STORAGE_PREFIXES` migration) should have a finder module that reports what the
    old layout left behind, and fixers that settle it — rather than hoping the forward path
    covered everything.
12. **A live-system guard: refuse to open production data from a test context, detected by env
    *and* ancestry.** `hermes_state.py:213-243`. "Env alone is not enough: a child spawned with a
    rebuilt environment loses `PYTEST_*` and `HERMES_HOME` together, which is precisely the state
    in which it writes to production." **Why it transfers:** August Trading has a desktop shell and
    a web build that can both open the same store; a test that touches the trader's real journal
    is the worst possible failure, and ancestry is the part people forget.
13. **Divert, don't lose.** `hermes_state.py:433-448` — when the store is replaced under a live
    process, the pending transcript is appended to `HERMES_HOME/sessions/<id>.jsonl`. **Why it
    transfers:** August Trading's IndexedDB/SQLite layer should have a "the store moved out from
    under us" path that writes the turn somewhere durable instead of dropping it.
14. **Scrub the harness's own prompts out of the durable transcript.**
    `hermes_state.py:306-344`. The background-review harness prompt and the reply that followed it
    are stripped on restore, because "older builds wrote the forked curator's turns into real
    sessions; replaying them hijacks the session"; a stale bare `[marker]` assistant turn is
    blanked because "replaying it teaches the model to keep emitting it". **Why it transfers:**
    August Trading's settlement-reflection and learning loops write into the same transcript the
    model later replays — a harness prompt in the durable transcript is a prompt injection waiting
    to happen, and a degenerate model output persisted verbatim is a training signal to keep
    producing it.
15. **Provenance ranks for names.** `hermes_state.py:1611-1616` — `derived(0) < llm(1) < user(2)`;
    auto-titling may only replace a strictly lower-authority name. **Why it transfers:** an
    auto-generated title for a trade (derived from the plan) must never overwrite a title the
    trader typed, and an LLM title must never overwrite either.
16. **One-shot migrations gated in the store, in the same transaction as the mutation.**
    `hermes_state.py:1663-1684`. **Why it transfers:** August Trading's schema migrations over
    IndexedDB should carry a one-shot flag written in the same transaction as the data change, so
    the migration is exactly-once and crash-safe.
17. **Derived indexes fail *open*; canonical rows fail *closed*.** `hermes_state.py:1104-1124` — a
    corrupt FTS shadow table is detached atomically and the write is retried ("never rebuild here");
    anything else quarantines the handle — no further writes, no automatic reopen, no checkpoint at
    close. **Why it transfers:** August Trading's FTS/derived summary index should be detachable
    (rebuildable) while the trade rows are authoritative — and the write path should never attempt
    a repair in-line.
18. **Coalesce a queue of deltas when the route fields are equal.**
    `hermes_state.py:1595-1609` — consecutive token deltas with the same (model, cost status,
    pricing version, billing provider, source, task) are merged so "the merged UPDATE equals
    applying them sequentially", and exact readers can flush. **Why it transfers:** August Trading's
    usage/cost accounting writes the same way; a per-turn cost record is usually identical to the
    previous one except for the numbers.
19. **A holder's identity is only meaningful in its namespace — stamp it and never probe a foreign
    one.** `hermes_state_pidns.py:1-25`, `:96-132`, with the STRICT-vs-LEGACY policy split.
    **Why it transfers (as a pattern):** any cross-process lease in August Trading (a lock file, a
    "this device is the active one" marker) must carry a *scope* identity, not just a PID; and
    "unknown authority is not authority" is the right default when the scope cannot be read.
20. **OFD locks: a lock that belongs to a description, not to a process.**
    `hermes_state_lockguard.py:1-33`. **Why it transfers:** only if August Trading ever runs two
    processes against one store (the Electron shell + a CLI, or a headless runner); the *lesson*
    (a stray `close()` in the same process can silently cancel another connection's locks) applies
    to any code that opens a second handle to a file another handle has locked — e.g. a "verify the
    database" button in Settings.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** mostly *not in this shard* (the cron/scheduler lives
  elsewhere), but the shard contains the **lease primitive** a scheduler needs: a TTL-bounded lock
  whose holder is a structured string (`pid=…:pidns=…:turn=…`), reclaimed **only on kernel proof**
  that the holder is gone (`hermes_state.py:141-171`, `hermes_state_pidns.py:109-118`). The rules
  are directly reusable: PID reuse must never steal a live lease; a wrongly-kept lease self-heals at
  expiry (a false defer is safe, a false reclaim ends a live turn); and a failed identity lookup
  makes every holder unverifiable rather than every holder dead. There is **no catch-up-for-missed-
  runs** machinery here — the scheduler shard owns that.
- **Human-in-the-loop approval:** *not in this shard* — no approval gate lives in the store. The
  transferable pattern is the **refusal taxonomy**: each refusal is a distinct exception class
  (`SessionResumeTooLargeError`, `SessionExportTooLargeError`, `RewindTargetUnavailableError`,
  `SessionLedgeredError`, `PruneRowStaleError`, `PruneRowUnresolvedError`) and each carries a
  message that names the *fix*, not just the cause — e.g. "raise the limit with `hermes config set
  sessions.max_resume_messages 0`" (`hermes_state.py:116-127`).
- **Post-mortem / reflection loops:** the shard contains the **scar tissue** of a reflection loop:
  `hermes_state.py:306-370` strips the background-review harness prompt and its reply out of the
  durable transcript on restore, and blanks stale bare `[marker]` assistant turns. The stated reason
  is that older builds wrote "the forked curator's turns into real sessions; replaying them
  hijacks the session", and that a persisted degenerate marker "teaches the model to keep emitting
  it". That is a first-order warning for August Trading's settlement-reflection loop: **a reflection
  agent's own prompts and their replies are not content — they are instrumentation and must not be
  replayed to the model as if they were the conversation.** Nothing here gates *how many* rules a
  reflection loop may add — that gate is not in this shard.
- **Multi-agent:** *not in this shard.* The one relevant trace is the `crossed_parents` finder
  (`hermes_state_profile_repair.py:77-113`): a child and a parent keyed under different profiles
  are a *crossing* that the NULL-fill inheritance fence would otherwise have hidden — a
  multi-agent lineage that has lost its ownership chain.
- **Structured logs the model can query:** the store is SQLite with FTS5 (plus a trigram index and
  a CJK tokenizer extension), and the derived index is deliberately **not authoritative** — a corrupt
  FTS shadow table is detached atomically and the write retried, never rebuilt in the write path
  (`hermes_state.py:1104-1124`). The durable side is a plain SQLite table with an
  `active`/`compacted` generation flag, `display_identity` and `display_order` columns, and
  `state_meta` for scheduler bookkeeping (`hermes_state.py:1644-1717`). For a model-queryable trade
  log the transferable rule is: **the canonical rows are the log; the search index is a disposable
  derivative that may be detached and rebuilt at any time.**
- **Staying simple as features accumulate:** the shard's own answer is *subtraction by file-size
  ratchet* — `hermes_state_prune_rewrite.py` was split out of `hermes_state_messages` explicitly
  "for a FILE_LINES ratchet" (`:1-8`), and the mixin was bound into the same MRO slot so that every
  existing call site and *test patch seam* kept working unchanged. The lesson is that a size gate
  forced a refactor without breaking a single caller — a pattern August Trading's
  "canonical single-source modules" list already follows, and could follow more mechanically.

---

## 4. Non-obvious decisions and gotchas

- **A stray `close()` in the same process can cancel another connection's SQLite locks.** This is
  the shard's central insight (`hermes_state_lockguard.py:1-33`): POSIX advisory locks are
  per-process, so *any* `open()`/`close()` of `state.db` or `-shm` — a raw probe, a plugin, a tool
  reading `~/.hermes` — cancels the locks SQLite believes it holds, and the next foreign close
  strands the holder on a deleted generation. The mitigation (OFD locks) is exotic, but the
  *diagnostic* is portable: if you ever open the same SQLite file twice in one process, one of the
  handles can silently disarm the other.
- **`chmod` on a database file, never `open()`+`fchmod()`+`close()`.**
  `hermes_state.py:246-303` — the second form drops every `fcntl` lock the process holds on that
  inode, including a live SQLite connection's own locks. The same reasoning appears twice more:
  `_read_retrying_ioerr` never closes and reopens a read connection to "recover" from an IOERR
  ("close() cancels this process's POSIX locks for every sibling", `:1153-1176`), and
  `_execute_write` retries an IOERR on the *same* connection (`:1110-1116`).
- **A read that cannot get a file descriptor must degrade, not queue.**
  `hermes_state.py:862-901` — "blocking would convert fd exhaustion into a stall, which is the same
  outage with a different stack trace." The read path is a three-rung ladder: pooled `mode=ro` →
  writer connection under the lock → reopen after an explicit close.
- **`close()` is not a release policy.** `hermes_state.py:1504-1516` — an instance with a started
  token writer used to pin itself, so `__del__` never ran for exactly the instances that leaked
  descriptors; the fix was an idle window plus a weak-reference `atexit` hook, and the docstring
  says explicitly that "eventually, after the idle window and a GC cycle" is *not* a release
  policy — owners must still close deterministically.
- **The store's own close can destroy a *newer* generation.** `hermes_state.py:1366-1394`,
  `:1405-1437` — SQLite's `close()` runs a last-connection checkpoint; on a handle whose WAL
  generation was replaced, that writes the retired frames over the new file. The fix is to switch
  off `SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE`, and on Python < 3.12 (no `setconfig`) to **retire the
  connection unclosed** and pin it so the interpreter cannot checkpoint it either.
- **`_read_open_failed_at` is a timestamp, not a sticky flag** (`:594-596`, `:885-890`): the
  likeliest trigger is transient EMFILE, and a permanent flag would demote every reader forever.
- **`state_meta` is read under the writer lock, not through the read pool** (`:1644-1649`): the
  FTS-rebuild step reads its own progress *before* its write transaction, and a WAL reader would
  not see it.
- **A merged `user;user` pair is ONE turn for addressing but TWO rows in storage**
  (`hermes_state_rewind.py:135-143`): turns must be addressed on the *repaired* projection, or the
  warm history stays "a turn short of the transcript forever"; the merged turn keeps the first
  row's identity, and the in-transaction payload pin must be compared against the *stored* row
  (which holds only the first ask), never against the merged live text.
- **Retry text must be the stored bytes.** `hermes_state_rewind.py:150-153` — `"".join` of the text
  parts, not the `"\n"`-joined display flattening, because `"ab"` must not come back as `"a\nb"`.
- **User rows are never rewritten in place** (`hermes_state_prune_rewrite.py:171-172`); only
  assistant and tool rows are eligible, and a user row forces the full generation writer.
- **Errors are classified by string matching.** `hermes_state.py:1084-1124` — `"disk I/O error"`,
  `"not a database"`, `is_malformed_db_error`. The module itself notes the risk in the sibling
  file: a holder's argv could flip the classification bucket. Brittle across SQLite versions.
- **`_is_no_more_rows` is treated as transient and retried** (`:1082`) — a "no more rows" error
  being retried is surprising enough to be worth checking against the SQLite build in use.
- **The mixin MRO is load-bearing and invisible.** `hermes_state.py:463-472` — 16 mixins;
  `SessionPruneRewriteMixin` uses `self._message_row_params`, `self._row_identity`,
  `self._display_identity`, `self._execute_transcript_write`, all of which are defined in
  *sibling* mixins (`hermes_state_messages`). The split was done for a file-size ratchet, and it
  left the facade depending on methods it does not declare.
- **A `SessionDB` opened through the registry has a different `close()`** (`:1521-1527`): it
  *releases a refcount* instead of closing, so a legacy caller's `close()` cannot tear down a
  connection other in-process callers are still using.

---

## 5. Weak spots

- **The complexity is out of proportion to the job.** "Store a transcript in SQLite" has grown a
  1,732-line facade plus five satellite modules covering OFD `fcntl` locks, `/proc/locks` parsing,
  PID namespaces, `struct flock` layout differences per libc, WAL-generation inode identity,
  `application_id` stamps, and a 16-mixin MRO. Almost all of it exists to survive **multiple
  processes writing one SQLite file** — a problem August Trading (single desktop/web app, one
  store) does not have. The transferable parts are the *patterns*, not the mechanism.
- **The write callback's idempotency contract is unenforceable.**
  `hermes_state.py:1008-1020` — "on locked/busy the Python lock is released, a jitter slept, and
  the WHOLE callback retried — *fn* must stay idempotent under retry." Nothing in the type system,
  the SQL, or a test enforces this, and a non-idempotent callback (a counter increment, an
  "append" that is not an upsert) silently double-applies. A self-disciplining convention in a
  docstring is the whole safety mechanism.
- **The facade mixes store mechanics with product policy.** `hermes_state.py` contains file-mode
  hardening, the pytest live-system guard, transcript scrubbing, title provenance, the bot-mode
  canonical-chat title, the kanban worker retag, and the token-accounting field lists. The title
  rank (`:1611-1616`) and `CANONICAL_BOT_CHAT_TITLE` (`:1623`) have nothing to do with SQLite and
  belong with the session-domain code; they are here because this file is the one everybody imports.
- **Auto-repair is once per path per process** (`:419`, `:708-720`): a second corruption of the
  same file inside one long-running process gets no repair attempt and no distinct error — the
  caller sees the same "malformed" failure with a different cause.
- **The read path fights a self-inflicted EMFILE problem with three mechanisms** — a bounded
  LIFO pool (`:602`), a per-path permit budget (`:611`), and a non-blocking acquire with a
  degradation path (`:877-901`). The comments are candid that unbounded per-thread connections
  "pinned fds for the process lifetime", but three cooperating mechanisms to keep a desktop app
  from running out of file descriptors is a lot of machinery.
- **String-matched error classification and a "no more rows is transient" rule**
  (`:1082`, `:1084-1124`) are the two places where a SQLite upgrade could change behaviour
  silently, with no structured error code to switch on. The module does carry
  `sqlite_errorcode`/`sqlite_errorname` forward on the quarantine path (`:1358-1362`), which shows
  the author knew the right way and did not apply it everywhere.
