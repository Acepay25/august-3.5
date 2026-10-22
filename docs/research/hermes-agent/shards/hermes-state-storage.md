# hermes-agent :: hermes-state-storage

**Files in shard:** 15 (read: 15, skipped with reason: 0)
**What this shard covers:** The durable state layer of the Hermes agent: a SQLite `state.db` that holds
sessions, messages, queued admissions, worker executions, receipts, routing and per-surface metadata,
plus the machinery that keeps that file honest — a schema-drift reconciler, an error-classification
taxonomy, a process-wide connection registry with generation retirement, a corruption latch, WAL/journal
policy, export/import portability, offline repair, and the transaction-owning runtime API.

All 15 files are `source` type, so each gets a full Tier-1 entry. Every claim below carries a
`path:line` reference.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

---

### `hermes_state_common.py` (1,496 lines)

- **Purpose:** The shared constants and helpers for the whole `SessionDB` family: the canonical
  `SCHEMA_SQL`/`FTS_SQL`/`DEFERRED_INDEX_SQL` DDL, the end-reason taxonomy, the session-preview SQL,
  the cross-process advisory-lock machinery, and the FTS rebuild admission authority. It lives outside
  `hermes_state.py` so the mixin modules can import it without an import cycle (`:1-2`).
- **Key abstractions:**
  - The DDL constants: `SCHEMA_SQL` (`:451-770`), `DEFERRED_INDEX_SQL` (`:778-910`), `FTS_SQL`
    (`:941-1022`), `FTS_TRIGRAM_SQL` (`:1066-1128`), `LEGACY_FTS_SQL` / `LEGACY_FTS_TRIGRAM_SQL`
    (`:1155-1211`).
  - The end-reason vocabulary: `_RESET_END_REASONS` (`:179`), `_BOUNDARY_END_REASONS` (`:184`),
    `_RECOVERABLE_END_REASONS` (`:190`), `_AUTOMATIC_END_REASONS` (`:201`), and the single predicate
    `is_automatic_end_reason()` (`:205-211`).
  - The lineage predicates: `_BRANCH_CHILD_SQL`, `_COMPRESSION_CHILD_SQL`, `_RESET_CHILD_SQL`,
    `_LISTABLE_CHILD_SQL`, `_ephemeral_child_sql` (`:171-247`).
  - The preview builder: `_PREVIEW_RAW_SELECT` (`:139-146`), `_sql_preview_raw()` (`:160-166`),
    `_shape_preview()` (`:149-157`).
  - The lock authority: `_acquire_db_flock()` (`:1337-1398`), `fts_rebuild_admission()` (`:1431-1487`),
    `_lock_holder_provably_dead()` (`:1312-1334`), `is_advisory_lock_contention()` (`:1257-1259`).
- **Data flow:** A caller asks the state store for a session list; `_rich_select` composes SQL from
  these fragments; the preview sub-select walks `messages` by index; the end-reason sets decide which
  rows are picker-visible, which are continuation children, and which are accidents that recovery may
  reopen.
- **Non-obvious design decisions:**
  - `SCHEMA_VERSION = 32` is **only a record, not a gate**. Drift is detected by a *read probe*
    (`schema_read_probe_statements`), and the catch-up is the declarative additive DDL every writable
    open already runs. "The bump only records that the declared shape changed; a new table or column
    needs no bump" (`:284-289`).
  - The FTS *layout* version is tracked **independently** of `SCHEMA_VERSION`, in the `state_meta` key
    `fts_storage_version` — the schema version advances freely on open, the FTS layout only advances
    when the store is born fresh or the operator explicitly optimises (`:298-312`).
  - The `messages_fts_src` **view** is the stability contract: tool rows are indexed as a bounded
    8,192-char prefix, so the external-content index must read back *exactly* what the triggers
    indexed, or FTS5's `integrity-check`/`delete` commands disagree with the stored tokens and corrupt
    the index. The projection is "a fixed per-row function with no marker lookups — so the boundary can
    never move again" (`:314-328`, `:933-940`).
  - Every FTS trigger gates on the same `(fts_rebuild_high_water, fts_rebuild_progress)` predicate,
    because "firing an FTS5 external-content 'delete' for a row that is NOT in the index corrupts the
    index" (`:913-931`).
  - `conversation_generations` is a table whose rows are **deliberately never garbage-collected** —
    collecting one resets that peer to "no generation" and re-issues a retired `gwk_` scope, i.e. the
    ABA the table exists to close (`:658-685`).
  - `_sql_preview_raw()` pins `INDEXED BY idx_messages_session`, "with planner stats older than
    idx_messages_session_id, SQLite otherwise reads and sorts the whole session" (`:160-166`).
  - The FTS rebuild admission is a **single authority** for every full structural rebuild entry point,
    deliberately **not** used by the chunked deferred backfill, which claims progress under SQLite
    transaction authority and is intentionally multi-process (`:1213-1243`).
- **Edge cases & failure handling:**
  - The advisory lock records the holder's `pid` + `pidns` + kernel `start_ticks`. "Anything
    indeterminate (no/malformed record, PID owned by another user, /proc unavailable, foreign PID
    namespace) is False: FAIL CLOSED and defer" (`:1312-1315`). A holder that forks then dies leaves
    the flock held forever; the acquirer breaks it only when the holder is *provably* dead, by
    unlinking and retaking on a fresh inode, and then re-verifies that the inode still names the lock
    path (`:1337-1398`).
  - A `RuntimeStoreError`-free `sqlite3` truncation is not handled here, but the `sql` helpers are
    defensive: `escape_like()` escapes `%` and `_` so a substring match on a branch name cannot
    silently widen (`:55-58`).
  - `_json_or()` logs a warning and returns a fallback rather than raising on a malformed JSON column
    (`:1490-1496`).
- **Surprising:**
  - The `messages_transcript_revision_update` trigger bumps `sessions.transcript_revision` on **any**
    content rewrite, because an in-place rewrite (prompt expansion, multimodal context, a redaction)
    moves neither the active row count nor the highest id — so a transcript-derived cache key needs
    its own write-side revision (`:787-796`).
  - The note inside `messages_message_uid_insert` must live *inside* the trigger body: "a comment
    before DROP/CREATE would defeat the settled-trigger skip" (`:808-816`).
  - The `sessions_runtime_ledger_delete_guard` trigger's `RAISE(ABORT, ...)` text must stay free of the
    words the error classifier reads as storage damage, lock contention or disk trouble — a text
    contract between two modules (`:772-786`).
  - `async_delegations` duplicates the delegation tool's own table so two databases at the same
    `schema_version` cannot have different shapes depending on whether the tool ever ran (`:739-747`).

---

### `hermes_state_dbfile.py` (858 lines)

- **Purpose:** File-level health helpers for `state.db`: header probes, deleted-WAL-sidecar holder
  scans, retired-generation capture, zeroed-database quarantine, a read-only stats snapshot, and
  holder-process classification.
- **Key abstractions:** `_pread_db_range()` (`:77-111`), `_read_sqlite_application_id()` (`:119-126`),
  `_fd_is_truly_unlinked()` (`:169-191`), `iter_deleted_sqlite_sidecar_holders()` (`:355-382`),
  `refuse_deleted_wal_generation()` (`:385-393`), `capture_retired_wal_generation()` (`:514-600`),
  `is_zeroed_state_db()` (`:636-645`), `has_invalid_sqlite_header_preopen()` (`:648-652`),
  `quarantine_cross_process_lock()` (`:655-693`), `quarantine_invalid_state_db()` (`:696-742`),
  `collect_state_db_stats()` (`:745-824`), `count_db_holders()` (`:827-843`).
- **Data flow:** A writer wants to open the DB → it refuses if any process holds a *deleted* WAL
  generation → the header is read through a lock-safe `pread` on a cached, never-closed fd → the
  `application_id` is compared to detect an out-of-band `cp`/restore → if the generation was replaced
  under a live handle, the retired WAL bytes are captured durably into a manifest directory before the
  process is allowed to exit.
- **Non-obvious design decisions:**
  - **Never `open()`/`close()` a live SQLite file.** `close()` cancels every POSIX advisory lock the
    process holds on the file, dropping the writer's WAL-mode DMS shared lock so another process can
    treat this writer as dead and rerun WAL-index recovery underneath it. The header probe therefore
    `pread`s through a per-path fd cached for the life of the process, and a re-pointed path's old fd is
    **retired, never closed** (`:63-73`, `:92-108`).
  - The unlinked-generation verdict is an **identity** comparison (`st_dev`, `st_ino`), never a link
    count: on OpenZFS a live file whose dentry was unhashed is reported as deleted while it is the
    same inode, and conversely a stale generation can keep a surviving hard link. "Only an exact
    `(st_dev, st_ino)` match between the fd and the CURRENT watched path proves they are the same live
    file" (`:159-191`).
  - macOS has no `/proc` and never reports a `(deleted)` suffix, so the module carries a **libproc**
    leg (`proc_pidfdinfo`/`PROC_PIDFDVNODEPATHINFO`) with hand-pinned struct offsets, because libproc
    pads `vnode_info` and sizes the record to 1200 bytes (`:210-241`, `:280-311`).
  - The capture writes the retired WAL to `<name>.retired-wal-<ts>-<pid>/` with a `manifest.json`
    carrying identities, sizes and SHA-256 digests, and copies the main image whole **only** up to
    512 MiB — above that only the 100-byte header is kept, "unlike the WAL inode, the main file
    survives process exit at its path, and a multi-GB copy inside a shutdown path is a worse failure
    than a header-only artifact" (`:406-415`, `:576-585`).
  - The manifest explicitly says **nothing is merged**: "Whether those frames belong on top of the main
    file now at the path is an operator's decision" (`:563-565`).
- **Edge cases & failure handling:**
  - A short read during the capture raises `RetiredGenerationCaptureError` and leaves the handle open
    for a retry, "because a truncated copy with a valid-looking manifest would let the caller settle the
    handle while the unlinked inode still dies at exit" (`:461-490`).
  - The darwin fd scan runs in a **daemon thread with a 5 s budget** because a single
    `proc_pidfdinfo` can block uninterruptibly in the kernel; on expiry the scan is abandoned and the
    guard **fails open** (`:235-240`, `:337-352`).
  - The quarantine takes a cross-process lock first, because "two concurrent startups racing" would
    have the second re-check under the lock and find the file gone (or fresh) (`:696-742`).
  - `collect_state_db_stats()` never instantiates `SessionDB` (its constructor runs DDL) and collects
    every field independently, so one failed pragma yields `None` for that field and not a failed
    snapshot (`:745-824`).
- **Surprising:** `_prepare_connection_retirement()` reaches into CPython's C API (`ctypes.pythonapi`
  `Py_IncRef`) to keep a connection alive through interpreter shutdown, so SQLite cannot checkpoint
  its lost WAL generation from a finalizer (`:36-60`).

---

### `hermes_state_errors.py` (326 lines)

- **Purpose:** The exception types and the error-classification predicates for the state store.
- **Key abstractions:** `classify_persistence_error()` (`:293-326`), `is_fts_scoped_corruption_error()`
  (`:122-158`), `is_sqlite_lock_error()` (`:49-66`), `is_transient_sqlite_error()` (`:68-76`),
  `is_malformed_schema_error()` (`:79-87`), `is_disk_full_error()` (`:88-97`),
  `PERSISTENCE_ERROR_CAUSES` (`:99-104`); exception classes `CompressionSessionClosedError` (`:160`),
  `CompressionSessionBusyError` (`:170`), `SessionCompressionInProgressError` (`:173`),
  `PruneRowUnresolvedError` (`:176`), `PruneRowStaleError` (`:174`),
  `HeldRowRewrittenError` (`:189`), `SessionTurnLeaseLostError` (`:196`),
  `SessionActiveWriteGuardError` (`:200`), `StateDbReplacedError` (`:203`),
  `DeletedWalGenerationError` (`:210`), `StateDbCorruptError` (`:241`).
- **Data flow:** An exception (a live `sqlite3` object, a wrapped RPC string, or a logged message) goes
  into `classify_persistence_error()` and comes back as one of eleven coarse cause buckets, which then
  drives HTTP 503-vs-500, the retry decision, and the operator remedy text.
- **Non-obvious design decisions:**
  - **A known SQLite result code outranks prose.** `SQLITE_CORRUPT_VTAB` (267) is FTS-scoped even when
    the text says "malformed image"; bare `SQLITE_CORRUPT`/`SQLITE_NOTADB` carry no object scope and
    therefore fail closed; only *without* a code does the text decide, and then only an `fts5:`
    corruption report or a marker naming a `messages_fts*` object counts (`:122-158`).
  - Corruption markers are checked **before** the disk bucket, because "database disk image is
    malformed" contains the word "disk" and would otherwise be reported as "free some disk space"
    (#77386) (`:107-112`, `:316-322`).
  - The `StateDbCorruptError` quarantine **suppresses the close-time WAL checkpoint**, because a
    handle that kept writing after the first error "checkpointed 15 pages under wrong page numbers and
    turned a readable file into 'file is not a database'" (`:218-241`).
  - `StateDbCorruptError` subclasses `sqlite3.DatabaseError` so every degrade path keeps working, and
  `DeletedWalGenerationError` subclasses `StateDbReplacedError` so every consumer that diverts
    transcripts on a replaced store handles it identically (`:210-212`, `:281-286`).
- **Edge cases & failure handling:** `PruneRowStaleError` exists to *stop* a fallback to the full
  writer, "that writer archives rows it never compared and would republish the stale held text over the
  newer one" (`:196-205`). `HeldRowRewrittenError` is raised **inside** the commit's write
  transaction, after the caller's precheck, because "a write that lands in that window is exactly the
  lost race the precheck cannot see" (`:189-195`).
- **Surprising:** the operator messages are **two-layered** — the first sentence is for the person
  reading a chat bubble ("what happened, nothing is lost, the one thing to do"), the rest is operator
  detail, and the `deleted state.db-wal or state.db-shm` phrase is a *classifier fingerprint* that must
  be preserved (`:219-236`).

---

### `hermes_state_repair.py` (1,173 lines)

- **Purpose:** Offline `state.db` repair, forensic backup, and a writability preflight.
- **Key abstractions:** `repair_state_db_schema()` (`:870-937`), `_repair_state_db_schema_locked()`
  (`:987-1062`), `_REPAIR_STRATEGIES` (`:1141-1151`), `_run_repair_strategies()` (`:1154-1173`),
  `_backup_db_file()` (`:478-534`), `_publish_backup_bundle()` (`:455-475`),
  `preflight_db_writability()` (`:549-586`), `_exclusive_repair_db_guard()` (`:661-682`),
  `_copy_database_snapshot()` (`:685-705`), `_db_opens_cleanly()` (`:769-845`),
  `integrity_damage_is_structural()` (`:722-742`), `_db_fingerprint()` (`:322-340`),
  `_backup_content_identity()` (`:343-366`), `_record_repair_outcome()` (`:408-432`).
- **Data flow:** `repair_state_db_schema()` → cross-process lock → persistent-budget check →
  live-writer check → **forensic backup** → exclusive writer-exclusion guard → snapshot the live DB
  to a scratch file → run the escalating strategies **on the scratch copy** → if one succeeds, promote
  the scratch copy back through SQLite's transactional backup API → restore the journal mode.
- **Non-obvious design decisions:**
  - **Strategies never run in place.** The final strategy ends in `VACUUM`, which rebuilds the file
    from the schema SQLite can still parse — when the damage *is* in the schema b-tree, every table
    hanging off the unreadable part is silently dropped. "Not mutating the original in the first place
    is the property that holds without a human in the loop" (`:990-1002`).
  - **Never `os.replace` the live DB** — Windows rejects replacement under open handles and POSIX
    would leave those handles on the old inode. The guard keeps writer exclusion throughout and the
    promotion is a transactional `Connection.backup()` (`:1038-1042`, `:685-690`).
  - A **cross-restart repair budget**: a sidecar ledger `<db>.repair-attempts.json` refuses further
    surgery after 3 failures against the *same fingerprint*, plus backup dedupe and a retention cap of
    3 forensic copies. The motivating incident: "105 attempts / 89GB of identical dead copies"
    (`:37-47`).
  - The ledger's fingerprint **excludes mtime** and masks the volatile header fields (change counter,
    version-valid-for), "because a malformed-schema DB still accepts writes and DELETE mode writes the
    main file directly, so without the mask any live write re-keys the ledger and the repair budget
    resets to 1 forever" (`:322-340`, `:51-57`).
  - Two *different* identities are kept and explicitly not conflated: `_db_fingerprint` (head+tail
    sample, "same repair epoch?") and `_backup_content_identity` (whole file + sidecars, "byte
    identity for a forensic copy"), because a live writer can commit into an *interior* page while
    preserving size and both 64 KiB slices (`:343-353`).
  - The forensic backup **publishes sidecars first and the main DB last**, because the main DB name is
    the bundle's commit marker; "a failure partway never leaves a countable backup over a missing
    sidecar" (`:455-475`).
  - Only *deterministic* corruption consumes the repair budget. Lock contention, timeouts, disk-full
    and I/O failures are environmental and "must not burn the repair ledger" (`:303-315`).
- **Edge cases & failure handling:**
  - A refused backup is a **HARD STOP** — "aborting schema repair to avoid mutating the only copy of
    the damaged DB" (`:1014-1016`).
  - The disk budget requires room for the snapshot **plus 2× for VACUUM** plus a headroom of
    `max(256 MiB, 2% of the volume)`, because a repair loop on a large `state.db` is a disk amplifier
    (`:58-66`, `:265-289`).
  - `preflight_db_writability()` repairs a read-only file with `chmod u+rw` **only inside the Hermes
    home tree** ("`chmod` fails on files the user doesn't own, bounding the repair exactly"), and never
    deletes or truncates a WAL sidecar (`:549-586`).
  - `_db_opens_cleanly()` runs a full FTS **write** probe (insert a probe row, then `INSERT INTO
    messages_fts(messages_fts) VALUES('flush')`, always rolled back) because a stale `_idx` row at the
    next segid passes `integrity_check` and `MATCH` but fails every real append (`:812-843`).
  - `IntegrityError` is caught as well as `OperationalError` because it is a sibling, not a child —
    "catching only the latter let the trigram-segment collision report 'healthy'" (`:831-839`).
- **Surprising:** `preflight_db_writability()` is explicitly a **port** of Kilo-Org/kilocode#12508
  (`:559`), and `_repair_snapshot_timeout_seconds()` scales the repair-lock timeout with the source
  size so a healthy large-database copy is not cut off by a fixed timeout (`:292-300`).

---

### `hermes_state_runtime.py` (999 lines)

- **Purpose:** The canonical runtime transactions — the admission FIFO, claim/settle, steering,
  worker registration/adoption, and the closed metadata-mutation API. "No execution, transport, or
  authority objects live here" (`:1-5`).
- **Key abstractions:** `RuntimeStoreError` (`:23-32`), `admit_session_input()` (`:124-171`),
  `claim_session_input()` (`:200-236`), `settle_session_input()` (`:239-268`),
  `cancel_session_input()` (`:274-286`), `steer_session_input()` (`:309-328`),
  `settle_steer_transfers()` (`:331-341`), `revert_steer_input()` (`:344-350`),
  `rehome_queued_inputs()` (`:379-407`), `retarget_local_automation()` (`:410-444`),
  `recover_session_inputs()` (`:447-458`), `mutate_runtime_session()` (`:483-555`),
  `import_legacy_session_admissions()` (`:605-648`),
  `resolve_unknown_session_input()` (`:651-688`), `register_worker_execution()` (`:728-756`),
  `adopt_worker_execution()` (`:759-792`), `mutate_worker_execution()` (`:919-944`),
  `apply_worker_receipt()` (`:947-999`).
- **Data flow:** A caller admits an input → the admission row is durable in `session_admissions`
  before the transcript row exists → a drain claims the FIFO head (bumping `sessions.runtime_generation`)
  → the turn runs → the claim settles with an outcome and a compacted result → the session's
  `runtime_revision` is bumped so a client's `expected_revision` fence notices the change.
- **Non-obvious design decisions:**
  - **The epoch is a singleton fence.** `_epoch(conn, epoch)` reads `runtime_epoch` and refuses
    anything from a stale owner; `begin_runtime_epoch()` "Caller MUST hold the profile ownership lock,
    not merely an endpoint ticket" (`:60-64`, `:110-117`).
  - The admission is **durable before the transcript**: "A first prompt is durable in
    `session_admissions` from admission on, while its transcript row lands only at turn start" — so a
    restart in between leaves an `unknown` admission, not a lost prompt (see
    `hermes_state_common.py:362-366`).
  - The FIFO cap is `ADMISSION_QUEUE_MAX = 32` and "holds in both states: a FIFO paused behind an
    unknown turn runs every accepted input after Discard, so it must not grow without bound while
    nobody resolves it" (`:120-122`, `:157-162`).
  - The claim records a **transcript high-water mark** (`MAX(messages.id)`) at claim time, so
    settlement can tell "this turn's own failed-turn boundary from an earlier turn's" (#134889
    GW-21) (`:231-234`).
  - The `queued` filter is "an explicit index-range IN, not `!= 'terminal'`: a negated status cannot
    bound the (target, status, seq) index, so every probe scanned the session's history" (`:188-194`).
  - `RuntimeStoreError` carries `reason` (a bounded wire code callers compare as a string) **plus**
    `field` and `detail` (which check fired and why), both collapsed to one line and length-bounded so
    client text cannot forge a log line (`:23-42`).
  - `mutate_runtime_session()` writes the mutation **and its retry receipt in the same transaction**,
    so an exact retry replays the stored result rather than re-applying the edit (`:461-480`, `:508-550`).
- **Edge cases & failure handling:**
  - An exact replay of an admission with a *different* payload digest is refused
    `admission_conflict`; the same payload replays the stored row (`:149-156`).
  - `recover_session_inputs()` "Never replay started work" — it marks `started` rows `unknown` for the
    operator, and marks an undelivered steering `interrupted` (`:447-458`).
  - `resolve_unknown_session_input()` is "explicit operator acknowledgement; resolves uncertainty,
    never requeues it", and can commit a *captured* result so a finished answer is not thrown away
    (`:651-688`).
  - `adopt_worker_execution()` uses `hmac.compare_digest` on the adoption secret and refuses a
    cross-epoch adoption of an admission-reserved worker, "so recovery's verdict stands" (`:759-792`).
  - The worker receipt path enforces a strict **sequence** (`sequence == last_sequence + 1`) and a
    4 MiB payload cap, and the CAS fence (`runtime_revision`) only moves when the handler actually
    changed durable state — "a read-only receipt (context, history, lineage, lifecycle) must not make
    a client's mutation built on the pre-read revision fail revision_conflict" (`:957-994`).
- **Surprising:** `settle_steer_transfers()` decides an outcome by whether the text *reached the
  agent*: a delivered text under any ending but `completed` is `interrupted` (never replayed), and an
  undelivered one is re-queued in its original FIFO place (`:331-341`, `:302-306`).

---

### `hermes_state_portability.py` (840 lines)

- **Purpose:** Session listing/rich rows, export, and import (portability) for `SessionDB`.
- **Key abstractions:** `SessionPortabilityMixin` (`:160-840`),
  `_export_timings()` (`:120-157`), `export_session()` (`:347-355`),
  `export_session_lineage()` (`:357-372`), `export_all()` (`:374-399`),
  `adopt_session_lineage_from()` (`:401-452`), `_retire_donor_segment()` (`:454-479`),
  `import_sessions()` (`:789-840`), `_validate_import_payload()` (`:660-679`),
  `_validate_import_session()` (`:681-713`), `_normalize_import_message()` (`:574-607`),
  `_import_load_json()` (`:514-527`), `_attach_import_parents()` (`:754-787`),
  `list_cron_job_runs()` (`:248-271`), `cron_run_identity()` (`:273-288`).
- **Data flow:** `export_session()` returns the session row plus its messages plus a derived
  `timings` block; `import_sessions()` validates the whole payload first (shape, size, type), then
  writes each session + its messages in one write transaction, then re-attaches parents without
  creating a cycle, and finally returns `{ok, imported, skipped, detached, errors}`.
- **Non-obvious design decisions:**
  - The export carries a **derived timings block** so a reader attaching it to a bug report does not
    have to infer from raw timestamps whether a slow turn was one long model gap or many small tool
    intervals. It states `complete: False` because "Hermes persists no model/tool stopwatch samples"
    (`:120-157`).
  - The export is **text-free by design**: "Ids, roles, counts and durations only — never prompt
    text, arguments or results" (`:127-128`).
  - Import **refuses** to restore a session that was deleted here: "a deleted session is not
    restored", because its row restored beside the fence "would list fine and refuse every turn"
    (`:813-819`).
  - Import deliberately **resets** the live-activity fields even though the export includes them:
    "resurrecting a stale 'working ...' label would fabricate activity the watchdog acts on" — an
    asymmetry covered by a named regression test (`:789-802`).
  - The import validates **non-finite numbers** anywhere in the decoded JSON, iteratively (a
    recursive visitor would overflow on crafted nesting), because `1e309` decodes to `inf` and strict
    serializers reject it later (`:497-527`).
  - Ints outside SQLite's signed 64-bit range are **bounded to a default** rather than raising at
    INSERT time (an unhandled 500, not a 400) (`:559-572`).
  - `include_compacted` is **off** for payloads that go back through `import_sessions`, because that
    projection is deduped and ordered for display and importing it "would make those turns live
    context" (`:347-355`).
- **Edge cases & failure handling:**
  - Per-session message count, per-session byte size, total bytes and total message count are all
    capped, and the totals accumulate **before** the limit check ("a rejected oversize entry still
    counts") (`:681-713`).
  - `_attach_import_parents()` drops only the *closing* edge of a cycle, so later entries can still
    attach to the now-root session; a child whose parent does not exist is detached so partial
    imports pass FK validation (`:754-787`).
  - The adoption path carries a **divergence guard**: if a segment that will be skipped has kept
    growing in the donor, the donor is **not** retired, and the counts are re-read *at retire time*,
    not at export time, so donor growth never lands behind a non-recoverable archive (`:426-479`).
  - A retirement failure does **not** fail the adoption ("a later resume retries idempotently") but
    never claims success it did not have (`:454-479`).
  - Titles are globally unique within a profile, so a colliding import title gets a suffix
    (`:199-203`).
- **Surprising:** `list_cron_job_runs()` documents its own limitation: "only a run's FIRST session is
  listed. A run that compressed continues in a child session this does not return" (`:258-261`).

---

### `hermes_state_registry.py` (478 lines)

- **Purpose:** A process-wide shared `SessionDB` registry: one connection per resolved path, refcounted,
  with generation-aware retirement when the file is replaced.
- **Key abstractions:** `acquire()` (`:195-274`), `release()` (`:276-312`), `close_all()` (`:346-360`),
  `close_all_under()` (`:362-399`), `release_or_close()` (`:480-484`),
  `other_generations_for_path()` (`:401-419`), `live_shared_session_dbs()` (`:421-425`),
  `borrow_live_shared_session_dbs()` (`:428-451`), `stats()` (`:453-459`); internal `_Generation`
  (`:78-90`), `_TeardownBarrier` (`:48-68`).
- **Data flow:** `acquire(path)` resolves the path, stats the file identity, and either bumps the
  refcount of the live generation or **retires** it (never lent again, but kept alive for its
  holders) and opens a replacement — the open happens **outside** the registry lock, guarded by a
  per-path marker and a per-path lifecycle mutex.
- **Non-obvious design decisions:**
  - The module exists because "each bare `SessionDB()` mints its own writer connection, lock,
    close-time WAL checkpoint and token writer thread, and one connection's close-time checkpoint can
    race another's growth (lost/reordered-page-write corruption)" (`:1-10`).
  - `release(db)` is **object-keyed**, "so holders of an old generation release into its retired
    record, not into whatever the path names" (`:281-286`).
  - The `_TeardownBarrier` **counts** admitted closes per path and is lifted only by the last one:
    "Signalling on the first lets `close_all()` return and `acquire()` publish a replacement while an
    older handle is still inside `PRAGMA wal_checkpoint`/sidecar unlink — the exact overlap (#102827)
    this registry exists to forbid" (`:48-68`).
  - **All teardown happens outside the registry lock**, so a WAL checkpoint cannot stall acquisition
    for every other `state.db` (`:88-92`).
  - `other_generations_for_path()` deliberately **excludes retired generations**, because counting one
    made a single inode replacement skip auto-VACUUM for that path for the rest of the process
    lifetime (`:401-419`).
- **Edge cases & failure handling:**
  - A replacement-open failure leaves the registry holding **no** entry for the path (`:265-270`).
  - A speculative handle opened into a teardown window is discarded rather than published, and the
    opener goes round again once the barrier lifts (`:271-283`).
  - `close_all_under()` waits for directory-matching barriers **even when no generation remains**,
    "otherwise rmtree still sees the open handle" (`:379-399`).
  - A `RetiredGenerationCaptureError` at close is logged at **error** level, not debug, "a lost WAL
    generation whose capture failed is data at risk, not teardown noise" (`:124-134`).
  - `borrow_live_shared_session_dbs()` pins a temporary reference for the whole block, because
    maintenance must not operate on an unowned snapshot the last real owner could close mid-call
    (`:428-451`).
- **Surprising:** the registry is the *in-process* half of a "is this store quiet?" gate that a
  `/proc` descriptor scan structurally cannot answer — that scan skips our own pid, so it only ever
  proves other *processes* are away (`:401-409`).

---

### `hermes_state_reconcile.py` (514 lines)

- **Purpose:** Detect **additive** schema drift (a declared table/column missing), catch it up once
  during a read-only browse, and provide the explicit `hermes sessions repair` path.
- **Key abstractions:** `schema_drift_reason()` (`:17-31`), `reconcile_drift_for_browse()` (`:394-497`),
  `repair_declarative_schema()` (`:500-514`), `DeclarativeDriftError` (`:119-124`),
  `CorruptStoreError` (`:263-268`), `BrowseBudgetExceeded` (`:186-187`), `_Budget` (`:190-216`),
  `_apply_additive_schema()` (`:219-256`), `_integrity_problem()` (`:271-292`),
  `_store_signature()` (`:295-304`), `_lockless_gateway_holder()` (`:165-183`).
- **Data flow:** A browse's read probe fails with `no such table/column` → refuse if a gateway owns
  the store → run a full `PRAGMA integrity_check` **outside** the lock → re-take the lock → re-check
  the file's `(size, mtime)` signature → run the additive DDL in one `BEGIN IMMEDIATE` → re-verify the
  declared shape *inside* the transaction → COMMIT.
- **Non-obvious design decisions:**
  - **Drift is not corruption.** The two paths are strictly separated: additive DDL is never a
    substitute for corruption recovery (`:83-85`, `:386-390`).
  - The integrity scan runs **before** the lock, "so it may be slow on a large store and must never
    block a gateway boot", and the scan is tied to the file's `(size, mtime)` signature: "if the store
    changed by the time the lock is held, the scan no longer vouches for it and nothing is written"
    (`:105-113`, `:369-373`, `:458-463`).
  - A store too large to verify within the 3 s budget is **refused with a retryable message** naming
    `hermes sessions repair` (which has no time limit) rather than written to (`:106-108`, `:425-435`).
  - `quick_check` is explicitly rejected in favour of full `integrity_check(3)`, "quick_check skips
    index-vs-table content, so an index with the right entry count but the wrong keys passes it"
    (`:271-275`).
  - The DDL is **verified inside the transaction before COMMIT**: "a column the shared reconciler
    could not add (it logs and continues) or an expired budget rolls the store back to exactly what it
    was, never a partial upgrade" (`:219-256`).
  - `_lockless_gateway_holder()` scans process argv for a Hermes `gateway` run holding the file
    *without* the profile's `gateway.lock` — a pre-v0.22.1 multiplexer serves named profiles without
    reserving their per-profile lock, "so the lock alone misses it" (`:165-183`).
  - A store missing its `sessions`/`messages` tables is routed to `hermes sessions recover`, never to
    additive DDL: "recreating them empty would hide lost sessions" (`:63-66`, `:409-413`).
  - A read-only file **or directory** is refused with a permissions-specific message, because SQLite
    creates its journal/WAL beside the file (`:470-479`).
- **Edge cases & failure handling:** the budget is a **SQLite progress handler** (`:205-211`), and
  because "busy waiting does not run the progress handler, so each connection's busy timeout is capped
  at the remaining budget" (`:111-113`). A signature that could not be scanned is remembered per
  `(path, signature)` so "a sidebar polls every few seconds; rescanning a multi-GB file on each poll
  only burns I/O for the same answer" (`:307-311`, `:379-385`).
- **Surprising:** the *browse* path can write to the store, but only additive DDL, only under the
  profile's own `gateway.lock`, only within a 3 s budget, and only after a clean integrity scan — a
  read operation that may perform a write.

---

---

### `hermes_state_wal.py` (669 lines)

- **Purpose:** The SQLite journal-mode and PRAGMA policy for `state.db`.
- **Key abstractions:** `apply_wal_with_fallback()` (`:254-340`), `_enable_wal()` (`:343-416`),
  `_set_journal_mode_no_wait()` (`:419-437`), `_apply_delete_for_wal_reset_bug()` (`:450-485`),
  `resolve_journal_mode()` (`:157-168`), `apply_database_pragmas()` (`:644-669`),
  `_apply_synchronous_pragma()` (`:624-641`), `resolve_synchronous_level()` (`:607-620`),
  `_ONCE_LOGS` (`:513-570`), `is_sqlite_wal_reset_vulnerable()` (`:131-134`).
- **Data flow:** The store opens → the on-disk journal mode is read from the header → the configured
  `database.journal_mode` is resolved → WAL is enabled, or the connection falls back to DELETE, or
  the mode is left untouched and the operator is told why. Every outcome is logged **once per
  (process, db_label)** at a deliberately chosen level.
- **Non-obvious design decisions:**
  - **Never live-downgrade.** "Never downgrade to DELETE if the on-disk header reports WAL or cannot
    be read — other gateway/cron/worker connections may hold the DB open, and a live downgrade
    destroys their uncheckpointed commits" (`:265-268`).
  - The mode switch is issued with `busy_timeout=0` as a **concurrency detector**: leaving WAL needs
    exclusive access, so if any other connection holds the DB the pragma fails immediately with
    "database is locked" instead of "sneaking the flip between a writer's transactions" (`:419-437`).
  - `disk i/o error` is **ambiguous** (deterministic ZFS/APFS-CoW incompatibility *or* a one-shot
    transient), so the pragma is retried twice: "treating a transient EIO as a permanent downgrade
    signal produced the mixed-journal-mode corruption pattern" (`:372-394`).
  - A **cross-VM filesystem** (virtiofs/9p — Docker Desktop / OrbStack / Podman host bind mounts) is
    detected from `/proc/self/mountinfo` and WAL is **refused before the pragma**, because the
    failure there is *silent* (zero-filled pages) and the reactive fallback never gets a signal
    (`:177-186`, `:331-339`).
  - On macOS, `checkpoint_fullfsync` and `synchronous=FULL` are enforced because Apple's `fsync(2)`
    guarantees neither data-on-platter nor ordering, so a launchd shutdown can turn a "durable"
    checkpoint into a malformed `state.db` (`:103-122`).
  - `synchronous` is applied **last** and separately, "this PRAGMA decides whether a commit is on the
    platter, so an unrecognised value must not fall through to 'SQLite default'" (`:624-641`).
  - The WAL-reset-bug gate is **retained deliberately**: re-measured on the bundled 3.50.4 there is
    "no evidence that WAL is safer here" (`:254-276`).
- **Edge cases & failure handling:** if **both** pragmas are rejected (APFS external SSDs under
  contention) the connection keeps its current mode and stays usable — WARNING, not ERROR, because
  "propagating would crash every DB-init caller" (`:404-415`, `:533-540`). A configured
  `journal_mode: delete` that did not apply is logged at **ERROR** with the exact command to apply
  it (`:541-546`).
- **Surprising:** the log levels are part of the design: "falling back to DELETE and an ignored
  `journal_mode: delete` are real losses (ERROR); a non-WAL → WAL flip is normally desirable
  (WARNING)" (`:504-505`). And the "journal_upgrade" message warns that a WAL flip "rewrites the
  database header and persists after this process exits", so an operator's deliberate DELETE choice
  would be undone by the next open unless it is set in `config.yaml` (`:519-527`).

---

### `hermes_state_health.py` (114 lines)

- **Purpose:** A process-wide latch that records "this `state.db` is structurally corrupt", so every
  surface reports the same fact.
- **Key abstractions:** `storage_state()` (`:84-87`), `storage_corrupt_reason()` (`:90-93`),
  `mark_storage_corrupt()` (`:65-74`), `note_storage_error()` (`:75-82`),
  `is_structural_corruption_error()` (`:49-59`), `reset_storage_state()` (`:95-103`); constants
  `STORAGE_OK` / `STORAGE_CORRUPT` (`:32-33`).
- **Data flow:** A writer or reader catches a `sqlite3.DatabaseError` → `note_storage_error(path, exc)`
  classifies it → if it is structural, the path is written into a module-level
  `dict[path -> first error text]` under a lock → `gateway.readiness` and the session list read
  `storage_state(path)`.
- **Non-obvious design decisions:**
  - **The latch never clears.** "A corrupt image does not heal, and a store that flickers between
    'ok' and 'corrupt' is the silent failure this replaces." It resets only on process restart, which
    matches `StateDbCorruptError`'s documented recovery boundary (`:15-19`).
  - **No marker is written to disk**: "the file it would describe is the one that is damaged"
    (`:20-21`).
  - Only *structural* corruption latches; FTS-scoped damage and malformed-schema rows are excluded
    because they have their own fail-open / heal paths (`:23-26`, `:49-59`).
- **Edge cases & failure handling:** the reason string is kept "for log only, never served" — the UI
  gets the boolean, the operator gets the text (`:42`).
- **Surprising:** `mark_storage_corrupt` logs the **exact remediation command**
  (`hermes sessions recover --source <db> --inspect-only`) at ERROR (`:65-74`).

---

### `hermes_state_local.py` (279 lines)

- **Purpose:** Hold private local creation receipts (the "policy" that defines a session's route,
  model, cwd and frozen launch request) inside the canonical runtime transaction owner.
- **Key abstractions:** `commit_local_session()` (`:12-85`), `client_request()` (`:87-99`),
  `same_create_request()` (`:101-116`), `same_create_retry()` (`:118-124`),
  `retire_local_receipts()` (`:148-166`), `local_lineage_owner()` (`:168-180`),
  `owned_lineage_ids()` (`:182-188`), `local_conversation_ids()` (`:190-203`),
  `local_lineage_index()` (`:205-228`), `exclude_superseded_segments()` (`:230-237`),
  `annotate_local_lineages()` (`:239-248`), `local_receipt()` (`:250-262`),
  `end_idle_local_session()` (`:264-279`); prefixes `POLICY_PREFIX`, `API_BINDING_PREFIX`,
  `API_DECLARED_PREFIX` (`:7-9`).
- **Data flow:** `commit_local_session()` reserves the `sessions` row, the `gateway_routing` entry and
  the immutable policy receipt in one write transaction, publishes an `on_create` hook (owner memory)
  **before the row becomes visible**, and withdraws it if the transaction fails.
- **Non-obvious design decisions:**
  - The receipt is **JSON round-tripped before it is written** (`encoded = _json(receipt); receipt =
    json.loads(encoded)`), so what is stored is byte-identical to what a later read will see (`:24-26`).
  - The frozen request is compared by **what the client typed**, not by the derived model/endpoint its
    `${VAR}` refs expanded to (`:87-99`).
  - A **retired** receipt refuses to be resurrected under the same deterministic id, "a create/cron
    retry must not resurrect the row (and re-fire its prompt)" (`:39-44`).
  - A request carrying `client_env_json` but no `client_request` is refused `invalid_params`:
    "Lost (a copy): never judge a retry by this attempt's own filtered map instead" (`:16-22`).
  - `retire_local_receipts()` uses **GLOB prefix scans** ("Prefix scans (GLOB uses the key index), not
    one LIKE per id: a prune retires thousands") (`:148-166`).
  - `owned_lineage_ids()` deletes a segment as *all* of the conversation, "an earlier segment's gap
    breaks the lineage, so a lone segment delete strands the rest (and the owner's queued work)
    readable but never continuable" (`:182-188`).
  - `end_idle_local_session()` checks the admission FIFO and worker states **inside the same owner
    write transaction** as the end stamp, "so an admission committed first keeps the row open; one
    committed after is reopened by the drain" (`:264-279`).
- **Edge cases & failure handling:** the `on_create` hook's file read is done in the caller's thread
  **outside** the write transaction (`:29-30`); a failed transaction withdraws only *this attempt's*
  snapshot, "never another winner's" (`:80-85`).
- **Surprising:** the `created_source` column is stamped by the *creator*, because the auxiliary-usage
  insert creates the row with `created_source='unknown'` and "the creator upsert repairs 'unknown',
  but this DO NOTHING insert does not" (`:59-65`).

---

### `hermes_state_local_lineage.py` (193 lines)

- **Purpose:** Hand a local owner's transcript to a new physical segment (a reset or a compression
  child) *inside the existing publication transaction*, without re-keying idempotency digests, queued
  inputs, subscribers or uncertain claims.
- **Key abstractions:** `validate_local_lineage()` (`:14-46`), `local_physical_target()` (`:48-58`),
  `advance_local_target()` (`:70-100`), `_untracked_steps()` (`:102-128`),
  `adoptable_compression()` (`:130-136`), `adopt_untracked_compression()` (`:138-166`),
  `reset_local_target()` (`:168-193`).
- **Data flow:** A creation receipt in `state_meta` (prefix `gateway.local_policy.v1:`) records the
  logical session, its route, its principal, its immutable policy and a `lineage` list of physical
  segment ids. Every read resolves the current physical target through `validate_local_lineage()`.
- **Non-obvious design decisions:**
  - **The creation id stays the admission/execution owner**; transcript rotation must not re-key
    anything else (`:1-5`).
  - The lineage is validated **pairwise**: each parent must have ended with `session_reset` (with
    `_reset_from` pointing at the parent) or `compression` (with the chain step pointing at the
    child) (`:33-45`).
  - `adopt_untracked_compression()` exists purely to repair one specific upgrade bug — a
    0.22.1-compacted local session resumed by a 0.22.2 build "was refused forever" (#140060). It
    re-validates and refuses anything that is not the *expected* receipt (`:138-166`).
  - `_untracked_steps()` walks the compression chain **in batches**, because one
    `_walk_compression_chain` stops after `_CHAIN_CAP` steps "which is not the end of the chain"; a
    step back into the lineage is a cycle and returns `None` (`:102-128`).
- **Edge cases & failure handling:** every refusal is a typed `RuntimeStoreError` —
  `storage_unavailable` for a malformed lineage, `admission_conflict` for a target that moved, and
  `storage_unavailable` for a live turn lease during a reset (`:193`, and
  `hermes_state_local_migration.py:74-78`).
- **Surprising:** the lineage is stored in `state_meta` JSON, not in a table, so a lineage read is a
  JSON parse plus one SQL row per step.

---

### `hermes_state_local_migration.py` (102 lines)

- **Purpose:** Adopt pre-"authority" local CLI/TUI/Desktop rows into the canonical routed model,
  transactionally, "never a second transcript writer" (`:1`).
- **Key abstractions:** `LEGACY_LOCAL_SOURCES` (`:11`), `LEGACY_CREATION_SOURCES` (`:13`),
  `legacy_account_label()` (`:20-25`), `login_owned_by()` (`:27-42`), `validate_legacy_row()`
  (`:44-57`), `bind_legacy_target()` (`:59-81`), `legacy_lineage_root()` (`:84-102`).
- **Data flow:** A receipt carrying `legacy_session_id` is validated against the `sessions` row, the
  row's `session_key`/`chat_id`/`user_id`/`chat_type`/`origin_json` are rewritten in place, and a
  binding receipt is written under `gateway.local_legacy.v1:` — all inside the caller's write
  transaction.
- **Non-obvious design decisions:** **three different identity notions are kept apart on purpose.**
  (1) a `nous:` account label is "a label, not a route or an authenticated owner" and does not block
  adoption (`:20-25`); (2) the WS-upgrade login stamp `<provider>:<user id>` **is** an owner, because
  reading it as no-owner let a login rename, claim and delete another user's chats (#140183 review
  F1) (`:27-42`); (3) a `user_id` equal to the adopting caller's own `subject` is already that
  principal's history (`:44-57`).
- **Edge cases & failure handling:** every refusal is a typed `RuntimeStoreError` — `not_found`
  (not adoptable), `storage_unavailable` (route/session mismatch, an existing foreign binding, or a
  live turn lease), `permission_denied` (a binding to a different profile/principal),
  `admission_conflict` (a compression step already exists on the target) (`:59-81`).
- **Surprising:** binding is a **read-side claim** — the row keeps its original `source` label and
  end stamp, and the first admitted turn reopens it, "exactly as the classic surfaces did" (`:84-87`).

---

### `hermes_state_runtime_workers.py` (112 lines)

- **Purpose:** Keep worker executions, their delegated children, and their read receipts in sync with
  the logical conversation and its physical transcript lineage.
- **Key abstractions:** `runtime_lineage()` (`:5-24`), `worker_states()` (`:26-32`),
  `discard_orphan_workers_on_reset()` (`:33-45`), `retire_child_executions()` (`:48-55`),
  `descendant_range()` (`:62-64`), `retire_stale_children()` (`:66-71`),
  `compact_terminal_receipts()` (`:88-105`), `retired_receipt()` (`:107-108`).
- **Data flow:** `worker_executions` rows are keyed by `execution_id`; a child's id is its parent's
  plus `/child:` plus a random suffix, so all descendants of one execution form a contiguous
  primary-key range.
- **Non-obvious design decisions:**
  - `descendant_range()` returns **lexicographic** bounds (`exec + '/child:'` to `exec + '/child;'`),
    so "is there any live descendant?" is a single index range probe — "a no-child finish costs one
    index probe" (`:62-64`).
  - When an execution goes terminal, its read receipts are **shrunk to a marker**
    (`{'retired': True}`), because "a `compression.history` read stores the whole transcript and a
    context read a full session row, so keeping them leaves one full-history copy per managed turn
    and `state.db` grows quadratically" (`:88-105`).
  - The compaction **keeps `payload_digest`**, so a late duplicate carrying *different* content still
    conflicts, while an exact late replay is simply refused (`:96-98`).
  - The lineage-wide worker probe is a **single indexed query using `json_each`** — "no
    bound-parameter limit on long chains" (`:26-32`).
- **Edge cases & failure handling:** a late child write after retirement is refused
  `stale_generation`; an explicit reset revokes unlinked `unknown` compute but "never replays its side
  effects", and admission-linked work still requires its own Discard receipt (`:33-45`).
- **Surprising:** a child that finished *itself* (an early close: failed constructor, refused
  sibling) never reaches `_retire_children`, which only selects live children — so its session row is
  ended by `compact_terminal_receipts` instead (`:100-105`).

---

### `hermes_state_coverage.py` (264 lines)

- **Purpose:** Resolve which durable rows the compressor actually *held*, so `archive_and_compact`
  archives exactly those (or falls back to a watermark when a held row cannot be named).
- **Key abstractions:** `SessionCoverageMixin` (`:17`), `_resolve_carried_row_ids()` (`:20-80`),
  `_matching_active_ids()` (`:82-93`), `_matching_retired_ids()` (`:95-120`),
  `_merged_user_run()` (`:122-177`), `_proved_coverage()` (`:179-233`),
  `_uncounted_merged_rows()` (`:235-253`), `_tail_originals()` (`:256-264`).
- **Data flow:** carried-forward message dicts are matched back to their active `messages` rows by
  (a) `_row_id` when the stored identity still matches, else (b) a *unique*
  (role/content/tool identity + timestamp) match.
- **Non-obvious design decisions:**
  - **Ambiguity is resolved against the writer**: "Ambiguous or timestamp-less fallbacks are left as
    compacted history rather than risking a false rewind classification" (`:28-32`).
  - The "common micro pass" narrows the index scan to the carried row ids and only falls back to a
    full active-row scan when a stored identity disagrees (`:63-66`).
  - A merged user run is reconstructed by **prefix-matching** the repaired text against consecutive
    active rows, because "a reload without row ids turns a durable `user;user` pair into one dict
    equal to neither row", and read as an unpersisted turn its rows would be re-sequenced behind the
    turn that is running (`:122-177`).
  - "The stamp is provenance and text is not": a surface may have re-rendered the dict since the
    repair, so the run is resolved first and a stamped dict that names none is still durable, never an
    unpersisted turn (`:210-224`).
- **Edge cases & failure handling:** `_proved_coverage()` returns `None` (abandon the ids, use the
  watermark path) when a *persisted* held row cannot be uniquely named; a marker-less miss is an
  unpersisted turn and is **not** a reason to abandon the ids already proved (`:179-200`).
- **Surprising:** `_tail_originals()` loops, widening the window, because "a dict that merged rows
  stands for each of them" — the covered-row count and the carried-dict count are not the same
  number (`:256-264`).

---

## 2. Ideas worth stealing

1. **Latch a terminal storage-health fact instead of letting every surface guess.**
   `hermes_state_health.py:15-21,65-82` records "this store is structurally corrupt" once per
   process per path, and every reader (`/api/status`, the sidebar, the session list) reads the same
   latch. **Why it transfers:** August already has the same instinct in
   `MemoryFilesService.getNotebookWriteFailure()` (a single owner of "the write never reached disk");
   a `SqliteService.storageHealth()` latch would give the Health tab, the sidebar and the chat
   surfaces one answer instead of three guesses. `UNIQUE` to hermes in this shard; **convergent in
   spirit** with August's existing notebook rule.

2. **One error taxonomy, one classifier, so 503-vs-500 cannot drift.**
   `hermes_state_errors.py:99-104,293-326` returns exactly eleven coarse buckets, and *one* predicate
   decides them. **Why it transfers:** August's `utils/runStatus.ts` already does this for run status
   and `GenericProviderService.toFriendlyProviderError` does it for provider errors; the same shape
   applied to *persistence* errors (quota vs corruption vs lock vs read-only) would let the app
   decide "retry" vs "surface to the user" from one place. `CONVERGENT` — pi and deepseek-harness
   shards should be checked for the same taxonomy, but August's own `runStatus.ts` is the same idea.

3. **Result codes outrank prose when classifying an error.**
   `hermes_state_errors.py:49-66,122-158` decides on `sqlite_errorcode` first and only falls back to
   string matching when no code is available; a *known* contradicting code fails closed. **Why it
   transfers:** August's provider-error mapping should prefer a provider's structured error code over
   the message text, exactly as here — a gateway that says "timeout" in prose but returns a 429 code
   must not be retried as a timeout. `UNIQUE` in this shard.

4. **Repair on a scratch copy, promote transactionally, never replace the live file.**
   `hermes_state_repair.py:990-1002,1038-1042` — every strategy runs on a copy; the promotion is
   SQLite's online backup API under an exclusive writer guard; `os.replace` is explicitly forbidden
   (Windows rejects it under open handles; POSIX would strand handles on the old inode). **Why it
   transfers:** August's Capacitor SQLite on a phone can be corrupted by an OS kill; a "rebuild the
   local index" path that never mutates the live file is the same property. `UNIQUE`.

5. **A cross-restart repair budget with a fingerprint, plus backup dedupe and retention.**
   `hermes_state_repair.py:37-47,322-340,408-432` — after 3 failures against the *same* fingerprint,
   stop and surface an actionable error; a successful repair resets the count; identical backups are
   reused and only the newest 3 are kept. **Why it transfers:** this is precisely the "breaker after
   repeated empty runs" pattern August already uses for automations, applied to *data repair*; the
   fingerprint-excludes-volatile-header-fields trick is directly reusable for any dedupe key.
   `UNIQUE` here; **convergent with August's automation breaker**.

6. **A bounded, fail-closed self-heal on the read path.**
   `hermes_state_reconcile.py:105-113,271-292,394-497` — a 3 s budget, a SQLite progress handler, a
   full integrity scan *before* the lock, a `(size, mtime)` signature re-check under the lock, and a
   refusal that names the exact command to run instead. **Why it transfers:** August's app startup
   should never block on a migration; if it must self-heal, it must be bounded, verified, and say
   what to do. `UNIQUE`.

7. **Never mutate shared state unless you can prove you own it; never live-downgrade.**
   `hermes_state_wal.py:265-268,419-437` — a mode switch is issued with `busy_timeout=0` purely as a
   concurrency detector, and an unreadable probe means "not exclusively owned: leave it alone".
   **Why it transfers:** the same rule applies to August's IndexedDB/SQLite store, its Preferences
   mirror and its backup promotion. `UNIQUE` in wording, `CONVERGENT` in principle.

8. **One shared writer connection per file per process, with generation retirement on replacement.**
   `hermes_state_registry.py:1-10,195-312` — refcounted, retired-but-alive generations, teardown
   outside the lock, and a counted teardown barrier so a replacement writer cannot open while an
   older handle is still checkpointing. **Why it transfers:** August's `SqliteService` should own
   exactly one writer connection and detect an out-of-band file replacement (a restored backup on
   mobile) rather than opening a second writer onto the old inode. `UNIQUE`.

9. **Compact terminal receipts to a marker, keeping the digest.**
   `hermes_state_runtime_workers.py:88-105` — a finished turn's read receipts shrink to
   `{'retired': True}` because keeping them left one full-history copy per turn and the DB grew
   *quadratically*; the `payload_digest` stays so a late duplicate with different content still
   conflicts. **Why it transfers:** August's chat log, journal and notebook all keep payloads that a
   finished turn no longer needs; storing a digest + marker bounds growth without losing the ability
   to detect a replay. `UNIQUE`.

10. **A monotonic generation counter that is never garbage-collected, to close ABA.**
    `hermes_state_common.py:658-685` — a `conversation_generations` table lives *outside* prunable
    session history, only ever increments, and is never collected, because a collected row would let a
    new conversation re-issue a retired cache scope. **Why it transfers:** any cache key derived from
    a conversation in August (a prompt-cache affinity scope, a key-levels cache) needs exactly this
    guarantee. `UNIQUE`.

11. **A trigger that bumps a write-side revision, because an in-place rewrite moves no id.**
    `hermes_state_common.py:787-796` — `transcript_revision` increments on any content change, so a
    transcript-derived cache key stays correct. **Why it transfers:** August's transcript-derived
    caches (price levels keyed off a chart, a plan keyed off a transcript) have the same blind spot.
    `UNIQUE`.

12. **Export/import with strict validation and a deliberate asymmetry.**
    `hermes_state_portability.py:497-527,559-572,681-713,789-802` — non-finite-number rejection,
    SQLite int-range bounding, per-session and total size caps, and a rule that import **resets**
    in-flight activity fields even though export includes them, because "resurrecting a stale
    'working ...' label would fabricate activity the watchdog acts on". **Why it transfers:** August's
    Settings → Data export/import should validate the same way and must not restore an "in-flight"
    marker that would make the app think a job is running. `UNIQUE`.

13. **Re-read both sides at the last moment before a destructive "move".**
    `hermes_state_portability.py:426-479` — the donor-retirement check re-reads message counts at
    *retire* time, not export time, and refuses to archive a donor that grew. **Why it transfers:**
    any August operation that moves a trade between journals/accounts needs the same TOCTOU close-out.
    `UNIQUE`.

14. **Two identities with different purposes, explicitly not conflated.**
    `hermes_state_repair.py:343-366` — a cheap head/tail fingerprint ("same repair epoch?") and a
    whole-file digest ("byte identity for a forensic copy"), each with a documented reason they must
    not be swapped. **Why it transfers:** August's backup dedupe and any "is this the same file?"
    check need the same discipline. `UNIQUE`.

15. **A lock holder record with pid + start-ticks + pid-namespace, failing closed on
    indeterminacy.**
    `hermes_state_common.py:1257-1334,1337-1398` — the acquirer breaks a stale lock only when the
    holder is *provably* dead, and verifies after breaking that the inode still names the lock path.
    **Why it transfers:** any cross-process coordination August needs (a desktop app and a CLI
    against the same profile) benefits from this exact "prove, don't assume" rule. `UNIQUE`.

16. **A delete that is refused with a reason rather than silently cascading.**
    `hermes_state_common.py:772-786` — a `BEFORE DELETE` trigger aborts the delete of a session that
    has gateway runtime history, with a message that names the version mismatch. **Why it transfers:**
    August's "delete this trade" should refuse (with a reason) when the row carries runtime history
    it cannot safely drop, rather than leaving the rest of the conversation half-deleted.
    `CONVERGENT` with the "any segment deletes as all of it" rule in `hermes_state_local.py:182-188`.

17. **An export that carries derived timings so a reader does not have to infer them.**
    `hermes_state_portability.py:120-157` — gap intervals per message pair, role counts, tool counts,
    and an honest `complete: False` because no stopwatch samples are persisted. **Why it transfers:**
    an August trade-log export could carry the same "one long model gap vs many small tool
    intervals" evidence, with the same honesty flag. `UNIQUE`.

18. **One log line per (process, database), at a deliberately chosen level.**
    `hermes_state_wal.py:504-570` — a table of message kinds with a chosen level, because "falling
    back to DELETE and an ignored `journal_mode: delete` are real losses (ERROR); a non-WAL → WAL
    flip is normally desirable (WARNING)". **Why it transfers:** August's health/console output could
    use a single registry of "one message per situation, at the right level" instead of ad-hoc
    logging. `UNIQUE`.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — cron runs are ordinary sessions with a durable
  identity.** `hermes_state_portability.py:95-117,248-288` gives a cron run two names: a legacy
  `cron_<job>_<ts>` id range and a unified-runtime `cron:<job>:<execution>` request id under a
  dedicated `CRON_PRINCIPAL_ID`, indexed by a **partial** index so interactive turns pay nothing
  (`hermes_state_common.py:610-617`). The job identity is recoverable even when the request id is
  ambiguous, by reading the creation receipt's policy — "a request id whose only `:` after `cron:`
  ends the job id is unambiguous". **Transfer:** August's automations should give each scheduled run
  a durable, derivable identity that survives compaction and restart, and should be able to answer
  "which job was this run?" from the run row alone.

- **A queue cap that holds even when the queue is stuck.** `hermes_state_runtime.py:120-122,157-162`
  — `ADMISSION_QUEUE_MAX = 32` per session, and the cap holds while the FIFO is paused behind an
  `unknown` turn, "because a FIFO paused behind an unknown turn runs every accepted input after
  Discard, so it must not grow without bound while nobody resolves it". **Transfer:** the direct
  analogue for August is a bounded queue of pending analysis requests per conversation, and — more
  importantly — a rule that a *stuck* queue still counts toward the cap.

- **A stuck turn is an explicit operator state, never silently retried.**
  `hermes_state_runtime.py:447-458,651-688` — on restart, `started` work becomes `unknown`; it is
  never replayed. The operator resolves it with `resolve_unknown_session_input()`, which "resolves
  uncertainty, never requeues it" and can commit a *captured* result so a finished answer is not
  thrown away. **Transfer:** an interrupted August analysis should land in a visible "needs your
  call" state with the answer preserved if it was captured, not in a silent retry.

- **Multi-agent: a worker is a durable row with a fenced sequence and an adoption secret.**
  `hermes_state_runtime.py:728-792,919-999` — a worker registers with `kind IN
  ('cron','child','compute','kanban')`, a `generation` fence, and an HMAC `adoption_digest`;
  persistence goes through one receipt transaction with a strict sequence number and a 4 MiB payload
  cap. `hermes_state_runtime_workers.py:48-71` — a child never outlives its parent: its id is the
  parent's plus `/child:`, and the whole descendant range is retired together, with a
  lexicographic range probe. **Transfer:** August's subagents (if any) and its scheduled workers
  should have the same shape: a durable execution row, a strict ordered sequence, a secret that
  proves the producer, and a rule that a child dies with its parent.

- **Structured logs the model can query: FTS5 over the transcript, with the projection made
  stable.** `hermes_state_common.py:314-328,941-1022,1066-1128` — the base index reads through a
  `messages_fts_src` **view** so the index, the triggers and the integrity checker can never
  disagree; tool rows are indexed as a bounded 8 KB prefix and searched via LIKE on demand; a
  trigram index covers CJK substring search and **excludes** tool rows, cron transcripts and
  delegate-child transcripts (they were ~70% of message bytes on a fan-out-heavy install). **This is
  the "queryable log without a heavy database" answer.** **Transfer:** August's trade log and chat
  log are already SQLite; the stealable part is (a) a *stable projection* so an index and its writer
  cannot drift, and (b) **excluding** the high-volume low-value rows (tool payloads, cron transcripts)
  from the index, with an explicit LIKE fallback so no capability is lost.

- **Staying simple as features accumulate: the feature count is held down by *rejections*, not by
  documentation.** `hermes_state_local_migration.py:1` ("never a second transcript writer"),
  `hermes_state_runtime.py:1-5` ("No execution, transport, or authority objects live here"),
  `hermes_state_coverage.py:1-6` (the mixin owns writes, the coverage mixin only names rows) — each
  module states in its docstring the thing it refuses to do. **Transfer:** August's service-layer
  discipline (AGENTS.md's "one canonical module" rules) is the same technique; the hermes version
  makes it explicit at the top of every file.

- **Not in this shard:** human-in-the-loop approval of consequential actions and the post-mortem /
  reflection loop that turns outcomes into rules. This shard is the *storage* layer; approval records
  and rule retirement live elsewhere in hermes.

---

## 4. Non-obvious decisions and gotchas

1. **`messages.id` is a global AUTOINCREMENT across every session.**
   `hermes_state_runtime.py:231-234` uses `MAX(messages.id)` as a per-conversation "transcript
   high-water mark" — a global counter used as a per-conversation marker. Any code that reasons about
   "the newest message in this conversation" by id must know it is global.

2. **A whole category of SQL is built by string concatenation.**
   `hermes_state_common.py:61-146,451-770` — the preview, the lineage predicates and the whole
   schema are string fragments; `_sql_literal()` (`:71-72`) escapes quotes by hand. The FTS triggers
   are DDL strings with `{}`-interpolated fragments. Correct, but a class of bug the reader should
   look for.

3. **The `state_meta` key space is an untyped KV store with prefixes scattered across modules.**
   `gateway.local_policy.v1:`, `gateway.local_legacy.v1:`, `gateway.api.binding.v1.`,
   `gateway.api.conversation.v1.`, `gateway.mutation.v1.`, `gateway.queued_replacement.v1.`,
   `gateway.prompt_admissions_import.v1`, plus the `fts_*` keys. Some are constants
   (`POLICY_PREFIX`), one is inlined into SQL text (`hermes_state_portability.py:102-105` builds
   `'{POLICY_PREFIX}'` into a SQL string) — a drift hazard.

4. **`conversation_generations` must never be garbage-collected, and nothing enforces that.**
   `hermes_state_common.py:658-685` says so in a comment; a future prune sweep that does not read
   that comment re-opens the ABA bug.

5. **The `sessions_runtime_ledger_delete_guard` trigger's message text is a cross-module
   contract.** `hermes_state_common.py:772-786` — the `RAISE(ABORT, ...)` text must not contain the
   words the error classifier reads as storage damage, lock contention or disk trouble, or the
   classifier will mis-bucket a deliberate refusal as a disk failure.

6. **The FTS rebuild lock and the repair lock are deliberately different files with different
   lifetimes.** `hermes_state_common.py:1213-1243` — `<db>.fts_rebuild.lock` (runtime, live
   connections) vs `<db>.repair.lock` (offline surgery, minutes in VACUUM). The chunked backfill is
   deliberately *not* routed through the rebuild lock.

7. **A corrupt store is quarantined, not repaired in place, and the handle stays quarantined for
   life.** `hermes_state_errors.py:241-268` — writes fail fast, no reopen, and no close-time
   checkpoint; recovery is "restart on a repaired/restored file".

8. **A replaced file is detected by `(st_dev, st_ino)`, which is unknown on Windows.**
   `hermes_state_common.py:338-345` — `st_ino == 0` counts as *unknown*, not as a match, so a
   replaced-file check cannot false-positive on Windows. `hermes_state_dbfile.py:73-74` takes the
   other side: on Windows the deleted-sidecar scan returns `[]`, "it cannot unlink a held sidecar, so
   no retired generation can exist".

9. **The FTS `update` trigger uses `AFTER UPDATE OF <content columns>`, not a blanket update.**
   `hermes_state_common.py:992-1000` — "stronger than the WHEN gate alone and avoids FTS I/O
   saturation on large state.db".

10. **The WAL-mode decision tree has a deliberately surprising default.** `hermes_state_wal.py:254-276`
    — on a WAL-reset-vulnerable SQLite, **new databases are kept in DELETE mode** because the earlier
    WAL-vs-DELETE comparison was confounded (the clean WAL result came from a SQLite that carried
    both the WAL-reset fix *and* the POSIX-lock defence). A reader who assumes "WAL is the default"
    will be wrong on a vulnerable runtime.

11. **A `role='tool'` FTS row is indexed as a prefix, and the *view* must compute the same
    prefix.** `hermes_state_common.py:314-328,941-951` — if the view ever drifts from the trigger's
    projection, FTS5's `integrity-check` and `delete` commands disagree with the stored tokens and
    "corrupt the index" with a recurring checksum-mismatch that has no obvious cause.

12. **`sqlite3` "no more rows available" is treated as transient, not as damage.**
    `hermes_state_errors.py:68-76` — "Transient engine error on contended WAL appends (retries like
    locked/busy); message-scoped because some builds raise it as InterfaceError".

13. **The repair's `_REPAIR_STRATEGIES` escalate, and the last one is destructive.**
    `hermes_state_repair.py:1141-1151` — `rebuild_fts` → `reindex_btree` → `dedup_schema` →
    `drop_fts_rebuild` (drop all FTS schema + `VACUUM`). It is safe only because it runs on a
    scratch copy.

14. **`_repair_failure_consumes_attempt` deliberately does NOT count environmental failures.**
    `hermes_state_repair.py:303-315` — a retryable disk-full must not burn the repair budget, and
    "a generic 'disk is full'/'readonly' must never become a permanent failure".

15. **A WAL receipt's `result_json` is compacted by a `json_type` probe, not a size threshold.**
    `hermes_state_runtime_workers.py:107-115` — only receipts containing a `$.messages` or `$.session`
    key are shrunk; a mutation acknowledgement (counts, annotations) stays replayable.

---

## 5. Weak spots

1. **Enormous defensive surface, with a lot of it expressed in prose in docstrings rather than in
   types.** The three biggest files (`common.py` 1,496 lines; `repair.py` 1,173; `runtime.py` 999)
   are mostly *policy* encoded as comments plus branches. Much of the policy — "the corruption
   marker check must run before the disk check", "the trigger note must live inside the trigger body",
   "the classifier's message must not contain these words" — is a convention a future contributor can
   break with a one-line edit that no test covers. A machine-checkable registry of these rules
   (the kind `tests/` usually holds) would be more robust than the comment.

2. **The `state_meta` key space is an untyped, unvalidated KV store.** Prefix constants live in
   different modules, one of them is inlined into a SQL string
   (`hermes_state_portability.py:102-105`), and values are parsed with ad-hoc `json.loads` at each
   read site with different fallbacks (`hermes_state_local.py:250-262` refuses a malformed receipt;
   `hermes_state_local_lineage.py:78-84` swallows it and returns the session id). The same logical
   record therefore has several incompatible readers.

3. **`hermes_state_coverage.py` is heuristic by construction.** Matching held rows back to durable
   rows by content + timestamp, and reconstructing merged `user;user` runs by prefix-matching text,
   is the kind of logic that degrades silently when the message format changes — the failure mode is
   "the archive is slightly wrong", not an exception. The module's own docstring says the fallback
   is "left as compacted history rather than risking a false rewind classification", which is the
   right trade, but the trade is invisible in the output.

4. **`hermes_state_wal.py` is a museum of platform-specific SQLite failure modes** — macOS NFS/SMB
   silent refusal, ZFS/APFS-CoW `disk i/o error`, virtiofs/9p cross-VM bind mounts, the
   SQLite 3.7.0–3.51.2 WAL-reset bug, FUSE "not authorized", plus per-platform lock primitives and
   a macOS libproc leg with hand-pinned struct offsets in `hermes_state_dbfile.py:225-241`. A reader
   cannot tell which of these are still real, and the module's own comment admits a decision was
   "retained deliberately" on the basis of a measurement that a later SQLite bump would invalidate.

5. **Two modules own the "one shared writer" story and the "one process-wide latch" story, and
   neither is the module a reader would look in.** The registry (`hermes_state_registry.py`) exists
   only because "each bare `SessionDB()` mints its own writer connection" — but nothing stops a
   caller from constructing one directly, and the health latch lives in a third module
   (`hermes_state_health.py`) rather than in the registry. A reader looking for "how does hermes avoid
   two writers?" has to know to look at `hermes_state_registry.py` *and* notice that its `release()`
   returns `False` for a non-registry-managed DB, handing `close()` back to the caller
   (`hermes_state_registry.py:276-312`) — i.e. the "one writer" invariant is opt-in.

6. **The browse-time self-heal writes to the user's database from a read path.**
   `hermes_state_reconcile.py:394-497` — a read-only sidebar can perform additive DDL. The
   precautions are thorough (lock, budget, integrity scan, signature check), but the *shape* —
   a read that writes — is the kind of thing that surprises a user and an auditor, and it is one
   `os.access` check away from writing to a file the user cannot write.

---

*Report produced by reading all 15 files in the shard (source tier, full reads; `hermes_state_common.py`,
`hermes_state_repair.py` and `hermes_state_runtime.py` were read in 3–4 line-numbered chunks each to
avoid output truncation, and the truncated middle of `hermes_state_coverage.py` / the truncated tail of
`hermes_state_registry.py` from an early batch were re-read in full). No file was skipped.*
