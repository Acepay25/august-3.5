# hermes-agent :: hermes-state-mutations

**Files in shard:** 13 (read: 13, skipped with reason: 0)
**What this shard covers:** the write path of Hermes' SQLite state store. Thirteen modules
implement every way a conversation can be *changed* after it exists — changing the model,
the reasoning level, the workspace, the editor approval policy, branching, resetting,
compressing, rewinding, deleting, importing — plus the machinery that makes those writes
safe: optimistic revision/generation fences, exact-retry receipts, idle/busy guards,
durable deletion fences ("tombstones" that outlive the rows they replace), a test-isolation
guard that keeps a pytest run out of the production `state.db`, a cross-process
holder-scan that refuses to rewrite a database another process still has open, and a
read-connection budget that keeps a multi-profile process from walking into `EMFILE`.
There is no UI and no model code here; this is the transactional spine.

---

## 1. File-by-file

All thirteen files are `source` and were read in full, line by line.

### Tier 1 — load-bearing source: full entry

### `hermes_state_guard.py` (170 lines)
- **Purpose:** a live-database test-isolation guard plus the per-process "last init error"
  record that the `/resume`-style slash commands read to explain *why* a store would not open.
- **Key abstractions:** `_real_platform_state_root()` (`:26`), `_running_under_pytest()` (`:54`),
  `_has_pytest_ancestor()` (`:89`), `_in_test_context()` (`:112`), `_is_production_state_db()` (`:117`),
  `_register_test_instance()` (`:144`), `_set_last_init_error()` (`:159`), `get_last_init_error()` (`:168`).
  Two env markers: `HERMES_STATE_DB_GUARD_BYPASS` (`:23`) and `HERMES_TEST_ISOLATION` (`:51`).
- **Data flow:** every `SessionDB` construction is supposed to resolve its path through
  `_ensure_test_isolation` (the caller lives outside this shard). The guard asks two
  independent questions — "is this process (or a parent) a pytest run?" — first by env
  (`PYTEST_CURRENT_TEST`, `PYTEST_VERSION`, `HERMES_TEST_ISOLATION`), then by **process
  ancestry** via `psutil.Process().parents()`. If either says yes and the resolved path is
  the production `state.db` (`<root>/state.db` or `<root>/profiles/<name>/state.db`), the open
  is refused.
- **Non-obvious design decisions:**
  - Ancestry, not just env, is the backstop (`:89-110`). The comment is explicit: a child
    spawned with a *rebuilt* environment loses `PYTEST_*` **and** the `HERMES_HOME` redirect
    at the same instant, so it aims at the production DB *and* disarms the guard in one step
    (issue #82770). Ancestry is the one signal that survives an env rebuild.
  - `_process_looks_like_pytest` **fails open** (`:71-83`): an unreadable cmdline is treated as
    "not pytest", because guessing the other way would refuse production opens.
  - `_is_production_state_db` deliberately does **not** match deeper scratch paths (`:117-128`)
    — a repo worktree's `state.db` is not production.
  - The per-test registry is a `weakref.WeakSet` (`:136`) so a dropped DB never pins memory,
    and registration is gated on the isolation marker so production processes never populate it.
- **Edge cases & failure handling:** `psutil` missing → ancestry check is skipped (guard is
  weaker but not broken); `_real_platform_state_root` swallows every exception and returns
  `None` (`:41-42`). `_set_last_init_error` **never clears on success** (`:159-165`) — the
  comment explains why: a concurrent open would erase the cause another thread's `/resume` is
  about to format.
- **Surprising:** the file carries two unrelated concerns — pytest isolation and a
  user-facing error string — in one module; and the "last init error" is a single
  module-level global with a lock, so it is last-writer-wins across all stores in the process.

### `hermes_state_holders.py` (658 lines)
- **Purpose:** the *proof* that no foreign process still holds the active or an unlinked
  SQLite DB/WAL/SHM generation, i.e. the authority that lets Hermes rewrite a database
  under it (VACUUM, index rebuild, bulk delete).
- **Key abstractions:** `read_only_db_uri()` (`:27`), `describe_holder_pid()` (`:60`),
  `canonical_sqlite_path()` (`:144`), `_argv_scoped_to_other_home()` (`:259`),
  `_windows_restart_manager_holders()` (`:369`), `foreign_state_db_holders()` (`:425`),
  `in_process_state_db_holders()` (`:567`), `held_store_refusal()` (`:585`),
  `live_writer_holds_db()` (`:622`), `_rm_ctypes()` (`:325`), `_looks_like_hermes()` (`:122`).
- **Data flow:** three platform strategies for the same question.
  - **Windows:** the Restart Manager API via `ctypes` (`rstrtmgr`) over the family
    `state.db`, `state.db-wal`, `state.db-shm` (`:364-368`). `RmGetList` is called with a
    size-then-read loop and retried up to 4× because the process set can change between the
    two passes (`:395-419`).
  - **Linux:** walks `/proc/<pid>/fd`, `readlink`s each descriptor and compares the
    canonical path; also compares `(st_dev, st_ino)` so a deleted-but-still-open file is
    still caught (`:483-560`).
  - **Other (macOS):** `psutil.process_iter(['pid','open_files'])`.
- **Non-obvious design decisions:**
  - **A scan failure is an unknown holder, not an empty list.** Every failure path appends
    `(-1, "…scan failed…")` and logs "Could not prove state.db has no foreign holders;
    deferring structural maintenance" (`:437-443`, `:553-559`). `held_store_refusal` then
    refuses with `cannot prove the database is quiet (holder scan incomplete: …)` (`:609-611`).
    An incomplete scan **never reads as an all-clear**.
  - **Ranked evidence for "this process is a different instance"** (`_argv_scoped_to_other_home`,
    `:259-318`): (1) a token naming our `state.db` or a sidecar exactly → ours, definitively;
    (2) the process's own `--hermes-home` / `HERMES_HOME=` / `--profile` / `-p` selection →
    that decides which home a multiplexer serves; (3) path tokens. A token naming only the
    *shared install root* is **neutral** (same binary serves every profile), and `argv[0]`
    locates the *install*, not the home, so it is not other-home evidence for a custom home.
  - `read_only_db_uri` uses `Path.resolve().as_uri()` because a raw `f"file:{path}?mode=ro"`
    truncates at a `?` or `#` in the home path and opens the wrong (empty) database (`:27-31`).
  - `live_writer_holds_db` adds a `BEGIN IMMEDIATE` probe *on top of* the scan but states the
    scan is the authority: the probe cannot see a DELETE-mode (SHARED-only) reader and cannot
    run at all on a malformed file — exactly the states repair gets invoked in (`:622-657`).
- **Edge cases & failure handling:** unreadable `/proc/<pid>/fd` → the process is reported
  as an "uninspectable holder" if it looks like a Hermes process for *this* home (`:494-506`);
  a `stat` failure on a watched file that is not ENOENT/ESRCH is itself an unknown holder
  (`:432-440`); the Linux path uses `os.path.realpath`, **not** `abspath`, because
  `psutil`/libproc report the kernel-resolved pathname and a symlinked `HERMES_HOME` would
  otherwise make every holder invisible (`:433-435`). `in_process_state_db_holders` exists
  because `foreign_state_db_holders` skips the current pid by design, yet "no holders" is
  read as "the store is quiet" by the auto-VACUUM admission path (`:567-583`).
- **Surprising:** `_rm_ctypes` is `@functools.cache`d (`:324-327`) because
  `ctypes.POINTER()` on a freshly defined `Structure` pins it in
  `ctypes._pointer_type_cache` **forever** — rebuilding the struct per scan leaked a class
  set per call. A tiny, very reusable lesson.
- **Surprising:** the operator refusal message is *written for a human operator*, not a log
  line: it names the offending PIDs and their command lines, tells the operator exactly what
  to stop (`hermes <profile> gateway stop`, quit Desktop, pause cron), warns that "nothing is
  lost", and points at a recovery doc URL (`:601-620`).

### `hermes_state_mutation_binding.py` (95 lines)
- **Purpose:** control-only ownership of *unbound legacy history* — who may rename/archive/
  hide a conversation that has no route. Explicitly "never an execution policy".
- **Key abstractions:** `BINDING_PREFIX = 'gateway.history_control.v1.'` (`:5`),
  `_history_sources()` (`:8`), `_owner_user()` (`:16`), `_login_label()` (`:22`),
  `import_history_control()` (`:38`), `authorize_history()` (`:45`), `history_binding()` (`:71`),
  `same_history_owner()` (`:76`).
- **Data flow:** a binding is a JSON array `[profile_id, subject]` stored under
  `state_meta['gateway.history_control.v1.<session_id>']`. `authorize_history` checks, in
  order: the session exists; it has **no** route (`session_key`/`chat_id`/`origin_json` all
  empty); an existing binding matches (else `permission_denied`); the row's `source` is a
  local history source; the row's owner matches the actor; the actor holds `session:create`.
  With `claim=True` the binding is written as a side effect.
- **Non-obvious design decisions:**
  - A **mismatched** binding raises `permission_denied` while an *absent* binding returns
    `False` (`:57-62`) — "not yours" and "bound to somebody else" are different answers.
  - `_login_label` (`:22-35`) reconstructs the `<provider>:<user>` label that Desktop stamps
    on its rows, but only from an **issuer-less** login: the label drops the issuer, so an
    issuer-bearing subject must not claim it. It also refuses a label that would itself read
    as a subject (`auth:` prefix).
  - `authorize_history` refuses **any** row that carries a route (`:50-53`), because import
    intentionally strips routes — a cold native/API transcript must never be reinterpreted as
    imported history even if stale import metadata exists.
  - `same_history_owner` (`:76-95`) compares the exact `(user_id, session_key, chat_id)` triple
    for a *routed* member (a compression continuation copies its parent's route columns) and
    falls back to the *binding* for a routeless member, plus the local rule.
- **Edge cases & failure handling:** a bound (imported) anchor therefore never reaches
  unbound rows (`:94-95`); a malformed receipt names nothing and cannot abort a delete of a
  different session.
- **Surprising:** `_history_sources()` and `_owner_user()` import from
  `hermes_state_local_migration` *inside the function body* — a deliberate late import to
  avoid a module cycle, and it is the kind of thing a reader will trip over.

### `hermes_state_mutation_branch.py` (104 lines)
- **Purpose:** create an independent local route, transcript and frozen policy for a branch,
  committed in one receipt transaction.
- **Key abstractions:** `_branch_boundary()` (`:12`), `_child_policy()` (`:34`),
  `branch_in_transaction()` (`:52`).
- **Data flow:** read the parent's frozen-policy receipt (`state_meta['<POLICY_PREFIX><sid>']`)
  → `validate_local_lineage` → `require_idle(db, conn, {session_id, target})` → derive the
  child id from `local_identity(profile_id, principal_id, request_id)` → build a fresh
  `SessionEntry`/`SessionSource` and a new route via `build_session_key` → publish the child
  session row → copy the active message rows up to the boundary → recount counters → title
  the child → write the child's own policy receipt plus a `gateway_routing` row.
- **Non-obvious design decisions:**
  - **The branch boundary absorbs the tool rows that answer an assistant turn**
    (`:24-30`): "The tool results that directly follow an assistant boundary answer its
    calls, so they belong to it." A branch cut at an assistant message must not leave its
    tool results behind in the parent.
  - **`through` is a physical row id, not a visible-message count** (`:59-60`), and rows
    appended later *in the same commit window* have larger ids and stay out (`:13-16`).
  - **A branch does not inherit the parent's approval policy or credentials.** `_child_policy`
    (`:34-49`) resets `edit_approval_policy` to `'ask'` ("A branch starts at Default, as
    main's ACP `fork_session` did") and refuses to copy `editor_mcp_json` unless the gateway
    prepared the child's *own* selection under the child's scope — "Copying the parent's would
    share its scope, borrowed credentials and live connections." If the parent has an editor
    selection and nothing was prepared, the branch refuses with
    `runtime_coordination_required` (`:41-44`).
  - An untitled branch is given the next name in the parent's lineage ("my session" →
    "my session #2") so the child is its own titled sidebar row (`:88-93`).
- **Edge cases & failure handling:** `through` must name an **active** row of the physical
  target, else `invalid_params`; the prepared selection is checked against both the child id
  and the parent's selection fingerprint, else `revision_conflict` (`:46-47`).
- **Surprising:** the receipt's `picks` field is *always* written (`:97-100`) — "a receipt
  without it predates the field, and `picks_on` reads that one's lineage" — i.e. backwards
  compatibility is handled by a fallback reader, not by a migration.

### `hermes_state_mutation_chat_pick.py` (67 lines)
- **Purpose:** exact-retry receipts for a viewer's `/model` or `/reasoning` override on a
  *messaging* chat, which has no frozen policy for `apply_action` to write.
- **Key abstractions:** `chat_pick_key()` (`:16`), `_fenced_row()` (`:30`),
  `prepare_chat_pick()` (`:41`), `commit_chat_pick()` (`:52`).
- **Data flow:** `chat_pick_key` validates the three ids and both fences, then reuses the
  shared `mutation_receipt_key(principal, session, request_id, operation, payload,
  expected_revision, expected_generation)` to derive a `(key, digest)` pair. `prepare_chat_pick`
  reads either the stored receipt (exact retry) or the fenced mount row. `commit_chat_pick`
  re-checks the fences **inside** the write, bumps `runtime_revision`, and stores
  `{digest, result}` under the receipt key — one transaction.
- **Non-obvious design decisions:** the pick is checked **before** the override is applied, so
  an exact retry never re-applies it (`:9-11` in the module docstring, enforced by
  `replay_mutation_receipt` at `:57-59`). The receipt and the revision bump are committed
  together, so a client can never observe a bumped revision with no receipt.
- **Edge cases & failure handling:** a reused `request_id` with a *different* payload raises
  `admission_conflict` (digest mismatch inside `replay_mutation_receipt`);
  `expected_revision` mismatch → `revision_conflict`; `expected_generation` mismatch →
  `stale_generation`; a missing session → `not_found` (`:30-38`).
- **Surprising:** this module duplicates the receipt plumbing rather than routing through
  `mutate_runtime_session` — because that seam writes a *policy receipt*, and a messaging chat
  has none. The docstring says so explicitly (`:1-7`), which is the right way to justify a
  copy.

### `hermes_state_mutation_compress.py` (27 lines)
- **Purpose:** commit a prepared summary, the new physical target, the execution generation
  and the receipt atomically.
- **Key abstractions:** `compress_in_transaction()` (`:6`).
- **Data flow:** `validate_prepared(db, conn, session_id, prepared)` returns the snapshot
  (receipt, target, target_revision) — and *that call is the guard*: it re-checks that no
  worker/turn/compactor is active on this exact connection. Then either
  `archive_on_connection` (in-place: same target, messages archived) or
  `publish_on_connection` (rotation: a brand-new child session with a `_compressed_from`
  marker). Finally the runtime generation is bumped and the result projection returned.
- **Non-obvious design decisions:** in the rotation case the returned `affected` set is
  **empty** (`:20`) — "Rotation publication already advances the logical revision", so the
  caller must not bump it again. Getting this wrong double-bumps the revision and every
  client's fence silently desynchronises.
- **Edge cases & failure handling:** "No worker/turn/compactor can be active:
  `validate_prepared` checks those obligations on this exact connection. No separate legacy
  transaction runs." (`:11-13`) — the guard and the write share one connection, so there is
  no TOCTOU window.
- **Surprising:** 27 lines doing almost nothing — the interesting content (the summary
  preparation, the lease, the archive) lives in `hermes_state_worker_compression` and
  `hermes_state_mutation_prepared`.

### `hermes_state_mutation_guards.py` (128 lines)
- **Purpose:** the busy/idle guards, evaluated **on the receipt's writer connection**, and the
  closure computation that decides which sessions a delete takes with it.
- **Key abstractions:** `MUTATION_GUARD_REFUSALS` (`:9`), `busy_refusal()` (`:12`),
  `require_not_executing()` (`:19`), `_require_transcript_unleased()` (`:34`),
  `require_target_advanceable()` (`:43`), `require_idle()` (`:52`), `_continuation_edges()` (`:64`),
  `delete_targets()` (`:81`).
- **Data flow:** two ledger tables are consulted — `session_admissions` (statuses
  `queued`/`started`/`unknown`) and `worker_executions` (`registered`/`running`/`unknown`).
  `unknown` (the outcome of a run is not known) → `unknown_execution`; any other live state
  → `session_busy`. Then `db._check_transcript_write_guards` rejects an active turn lease or
  an active compression lock.
- **Non-obvious design decisions:**
  - **Three busy tiers, deliberately different.** `require_not_executing` (used by
    target-advanceable writes: reset, compress, model) allows a **queued follower** — "a
    follower waits on the logical owner and simply runs against whatever physical target the
    mutation publishes". `require_idle` (used by delete and branch) additionally refuses
    `queued`. A queued admission is a legitimate waiter for one class of write and a refusal
    for the other (`:19-62`).
  - **`unknown` is a distinct error code from `busy`** (`:29-31`) — the client can tell "come
    back later" from "we do not know what happened".
  - A compression lock is named in the refusal's `field` (`busy_refusal`, `:12-16`):
    "Stop does not end it, so clients say to wait instead."
  - **A logical owner closed by compression is an ancestor, not a transcript target**
    (`:34-40`): its live successor carries the lease, so the ancestor is skipped.
  - **Fork markers are matched against the edge's parent id, never by presence**
    (`_continuation_edges`, `:64-79`): a continuation copies its parent's `model_config`, so an
    inherited `_branched_from`/`_delegate_from` naming an older row must not make it a fork.
- **Edge cases & failure handling:** `delete_targets` (`:81-128`) computes the full closure:
  the creation id (policy, FIFO), every lineage segment, the current target, every
  continuation edge **in both directions**, and every delegate child — walked to a fixed
  point bounded by `_CHAIN_CAP`. Every walked row must pass `same_history_owner` against its
  anchor, so a forged or imported parent link into **another principal's** chain stops the
  walk instead of deleting their conversation (`:112-115`). The walk goes backward to the root
  as well (`:100-106`), because a sidebar row carries the chain tip's id and a surviving root
  would re-project as the "deleted" conversation on the next reload.
- **Surprising:** the module imports `_CHAIN_CAP` from `hermes_state_compression`,
  `_collect_delegate_child_ids` from `hermes_state_sessions` and `same_history_owner` from
  the binding module — three sibling modules, imported *inside functions* to break cycles.

### `hermes_state_mutation_prepared.py` (147 lines)
- **Purpose:** the optimistic *prepare → revalidate-in-transaction* pattern, and the five
  policy-edit handlers that use it.
- **Key abstractions:** `DEFERRED_PICK_PREFIX` (`:9`), `local_snapshot()` (`:12`),
  `validate_prepared()` (`:23`), `_commit_policy()` (`:32`), `model_in_transaction()` (`:44`),
  `reasoning_in_transaction()` (`:62`), `workspace_in_transaction()` (`:67`),
  `editor_mcp_in_transaction()` (`:82`), `edit_policy_in_transaction()` (`:88`),
  `POLICY_HANDLERS` (`:94`), `picks_on()` (`:102`), `policy_picks()` (`:128`),
  `commit_refreshed_policy()` (`:133`).
- **Data flow:** `local_snapshot` reads the frozen-policy receipt, validates the lineage,
  requires the target to be advanceable, and returns
  `{receipt, target, target_revision}`. `validate_prepared` re-derives that snapshot **inside
  the write transaction** and compares it for exact equality with the client's prepared
  snapshot; any drift → `revision_conflict` (`:23-30`). `_commit_policy` writes the prepared
  policy over the snapshot it was derived from and bumps `runtime_generation`.
- **Non-obvious design decisions:**
  - **The whole design is optimistic concurrency done right**: the client prepares against a
    snapshot, the commit re-derives the snapshot on the writer connection and demands exact
    equality. No lock is held between prepare and commit, and no stale write can land.
  - **A model switch deliberately does NOT reload the launch defaults** (`:49-56`): "Keep the
    transcript and cached prompt byte-stable; the explicit model switch is a client/provider
    boundary, not an implicit reload of launch defaults." Only `provider` is merged into
    `model_config`; the rest of the cached prompt is untouched.
  - **A workspace move REPLACES, never merges** (`:67-80`): the sidebar groups by the row's
    cwd/git identity, so every row of the conversation is rewritten with the new
    `cwd`/`git_branch`/`git_repo_root` and `git_metadata_generation` is bumped.
  - **A deferred pick is superseded, not queued** (`:57-58`): committing an explicit model
    selection *deletes* any pending deferred pick, because "this selection is newer than any
    pick still waiting for a turn boundary".
  - **Picks are reconstructed from the receipt journal** (`picks_on`, `:102-126`): the durable
    record of "what the user picked" is the set of `gateway.mutation.v1.*` receipts with
    `result.operation IN ('model','reasoning','workspace')`, queried with SQLite's JSON
    functions. A *deferred* pick is explicitly **not** a pick. A branch's picks come from its
    own receipt's `picks` field, or — if the branch predates that field — from the parent's
    receipt at the revision the branch committed at.
- **Edge cases & failure handling:** `commit_refreshed_policy` (`:133-146`) is the owner's
  config refresh: it re-checks the epoch, re-snapshots, requires idle, and demands that the
  policy still equals `old` **and** the generation still equals `generation`, else
  `revision_conflict` — "a concurrent mutation or turn wins".
- **Surprising:** `picks_on` reads receipts with `json_extract(value, '$.result.operation')`
  over a `GLOB 'gateway.mutation.v1.*'` key space (`:99-126`) — the "what did the user
  choose" query is SQL, not a Python index.

### `hermes_state_mutation_reset.py` (43 lines)
- **Purpose:** prepare and publish a local reset inside the mutation receipt transaction.
- **Key abstractions:** `reset_in_transaction()` (`:12`).
- **Data flow:** read the policy receipt → `validate_local_lineage` → **discard orphan
  workers** → `require_target_advanceable` → publish a *new* child session row
  (`model_config={'_reset_from': target}`) that inherits the parent's route, origin and
  display name but is marked `is_fresh_reset=True` → mark the parent ended with
  `end_reason='session_reset'` → `db._bump_conversation_generation` → `advance_local_target`
  → bump `runtime_generation`.
- **Non-obvious design decisions:**
  - **A reset is a new physical session that keeps the route.** The conversation continues on
    the same identity with a clean transcript; reset and branch share the "publish a child"
    mechanism and differ only in what they copy (`_reset_from` vs `_branched_from`).
  - **Orphan workers are discarded *before* the idle guard** (`:20-22`): a crashed turn's
    orphan worker is cleaned as part of the reset, so a reset can succeed where a plain
    delete would have been refused as busy.
- **Edge cases & failure handling:** `advance_local_target` already advances the logical
  owner's revision, so the reset must not bump it again (`:39-40`) — the same
  double-bump trap as the compression rotation.
- **Surprising:** the module is 43 lines and almost all of it is ordering. The ordering *is*
  the design.

### `hermes_state_mutation_retirement.py` (433 lines)
- **Purpose:** the durable deletion fences that outlive the rows they replace — "tombstones"
  in `state_meta` that keep a deleted id from being recreated, re-admitted or reissued.
- **Key abstractions:** `RETIRED_PREFIX = 'gateway.retired_session.v1.'` (`:9`),
  `ROUTE_FENCE_PREFIX = 'gateway.retired_route.v1.'` (`:11`), `VIEWER_CLOSE_PREFIX` (`:13`),
  `retired_in()` (`:19`), `create_conflict()` (`:28`), `first_generation()` (`:38`),
  `keep_passed_fences()` (`:57`), `has_mutation_receipt()` (`:73`), `_compact_result()` (`:85`),
  `retire_terminal_receipts()` (`:100`), `retire_sessions()` (`:148`),
  `retire_mutation_receipts()` (`:176`), `retire_prunable()` (`:236`),
  `delete_in_transaction()` (`:261`), `_mark_retired()` (`:286`), `retire_routes()` (`:307`),
  `route_namespace()` (`:320`), `route_fence_key()` (`:327`), `ROUTE_RETIRED_SQL` (`:343`),
  `route_retired()` (`:364`), `fence_shared_routes()` (`:380`),
  `RETRY_HORIZON_S = 7 * 86400` (`:402`), `prune_retired_tombstones()` (`:412`).
- **Data flow:** a delete never just removes rows. It (1) fences the id, (2) retires the
  terminal receipts, (3) strips the user content out of the mutation receipts, (4) fences the
  routes, (5) retires the local receipts, and only then deletes the transcript rows.
- **Non-obvious design decisions:**
  - **A deleted id is never reused; a DERIVED id moves to its next generation.**
    `create_conflict` (`:28-36`) refuses a recreate of a retired id with `session_deleted`.
    But for *derived* ids (Bot Chat, A2A context, hosted-room member, header-less chat) the
    conversation resumes on the **next generation** rather than being recreated
    (`first_generation`, `:38-55`) — the id space is generation-scoped, not unique-forever.
    `keep_passed_fences` (`:57-71`) then makes permanent every fence the walk passed, in the
    same write that binds the successor, so an aging sweep marker cannot send the next turn
    back to the swept generation.
  - **A sweep's marker ages out; a delete's marker is permanent** (`:236-259`). Housekeeping
    retires thousands of ids a pass and a permanent marker each would grow `state_meta`
    without bound. The split is by *derivedness*, not by caller: a derived id keeps a
    permanent fence (its conversation resumes on the next generation), a caller-named API id
    ages out so the caller may use it again.
  - **Keep the receipt, strip the payload.** `retire_mutation_receipts` (`:176-194`) keeps
    each receipt's digest, ids and revision but NULLs `target_message`, `summary` and
    `title` — so an exact retry after a delete still resolves, but the deleted *text* cannot
    be read back. `_compact_result` (`:85-98`) does the same for turn results: keep the final
    response, flags and usage; drop the cumulative `messages`, `last_reasoning`, `tools` and
    `_turn_user_row`.
  - **Worker receipts keep only the closing digest** (`:125-133`): "A terminal worker can
    only replay an explicit `execution.finish` receipt. Every other result (history/context
    reads) is user data that must not outlive the delete, even when it is the last one."
  - **The marker is scoped by `own`** (`:9-12`, `:286-305`): this store's own retired session
    vs another profile's fence in the shared routing index. `_mark_retired`'s UPSERT never
    shortens a permanent marker and never converts an unscoped marker into an owned one.
  - **A local conversation is swept only whole** (`:240-249`): if any of its ids is kept or
    has live work, every one of them is skipped — "the owner's queued admission continues on
    the current segment".
  - **A sweep skips busy rows instead of aborting** (`:236-249`): one busy row cannot abort a
    whole prune pass, whereas an explicit delete refuses with `session_busy`. That is the
  difference between a housekeeping job and a user action, expressed in one predicate.
- **Edge cases & failure handling:** `route_retired` (`:343-369`) implements the fence
  check as one SQL expression, `ROUTE_RETIRED_SQL`, over `state_meta` + `gateway_routing`.
  Every JSON read sits inside a `CASE WHEN json_valid(...)` branch because
  `json_extract` raises *malformed JSON* even behind `json_valid(...) AND` (`:349-356`) — a
  real SQLite gotcha. `fence_shared_routes` (`:380-400`) reclaims the expired sweep fences
  it is about to age out, in the same write, so the owner's prunes bound them without
  depending on the launch profile's own sweep.
- **Surprising:** `prune_retired_tombstones` (`:412-433) reclaims tombstones older than the
  7-day horizon, but a **user delete's marker is never reclaimed** — "it holds only
  `retired_at`, and without it a deleted id could be recreated, re-admitted or reissued as
  a Bot Chat generation." So the tombstone table has one permanent class and one expiring
  class, and the permanent class is the security-relevant one.

### `hermes_state_mutation_transcript.py` (38 lines)
- **Purpose:** the transaction-scoped rewind, shared by the storage path and the canonical
  mutation path.
- **Key abstractions:** `rewind_in_transaction(self, conn, session_id, target_message_id, *,
  preserve_compaction_handoff=False, expected_active_ids=None, expected_target_content=None)`
  (`:5`).
- **Data flow:** transcript write guards → optional optimistic equality check on the active
  id list → fetch the target row (must be role `user`) → optionally split the target into
  (summary, live ask) → **deactivate** every active row with id ≥ target → optionally insert
  the replacement row → bump `rewind_count` → recompute the denormalized counters from the
  active set → return `(target_row, deactivated_ids, head_id, replacement_message_id)`.
- **Non-obvious design decisions:**
  - **A rewind DEACTIVATES rows, it does not delete them** (`:28-30`) — `active = 0`, never
    `DELETE`. That is what makes a rewind undoable, and what lets
    `_summarized_by_compaction` distinguish "compaction took this turn out"
    (`active=0 AND compacted=1`) from "a rewind/undo took it back" (`active=0 AND
    compacted=0`) — see `hermes_state_mutations.py:162-185`.
  - **The counters are recomputed, not incremented** (`:33-35`): `self._active_transcript_counts`
    derives `message_count`/`tool_call_count` from the active set, so the denormalised
    counters cannot drift.
  - **`expected_active_ids` is an optimistic guard** (`:15-19`): "active transcript changed
    before the rewind could be persisted" → `RuntimeError`. The client states the active id
    list it saw; the transaction refuses to rewind a transcript that moved underneath it.
- **Edge cases & failure handling:** a non-existent target → `ValueError`; a target that is
  not a `user` message → `ValueError` naming the role it actually was (`:21-24`);
  `preserve_compaction_handoff` re-inserts the split replacement so a compaction carrier
  keeps its handoff.
- **Surprising:** the function is a **method on `self`** whose `self` is a `SessionDB`-shaped
  object, but it lives in a module that does not import that class — the receiver is duck-typed
  and the module only imports three SQL constants from `hermes_state_messages` (`:1-2`).

### `hermes_state_mutations.py` (231 lines)
- **Purpose:** the closed set of action handlers that run inside the runtime mutation receipt
  transaction, and the payload validator that gates them.
- **Key abstractions:** `METADATA_FIELDS` (`:5`), `validate_action()` (`:8`),
  `_valid_branch_payload()` (`:58`), `_valid_editor_fingerprint()` (`:71`),
  `_COMPRESS_FIELDS` (`:76`), `_valid_compress_payload()` (`:79`), `apply_action()` (`:89`),
  `_delete()` (`:118`), `_rewind()` (`:125`), `COMPACTED_TARGET_DETAIL` (`:159`),
  `_summarized_by_compaction()` (`:162`), `_carrier_live_view()` (`:187`), `_import()` (`:196`).
- **Data flow:** `apply_action(db, conn, session_id, operation, payload, prepared)` dispatches
  by operation to a handler that returns `(affected_session_ids, result_projection)`. The
  caller (`hermes_state_runtime.mutate_runtime_session`) then bumps `runtime_revision` for each
  affected session and stores the receipt. Sidebar/rename/archive edits fall through to a
  generic column writer (`:105-116`).
- **Non-obvious design decisions:**
  - **The payload vocabulary is a closed whitelist per operation.** `validate_action` is a
    long if/elif chain where each branch asserts an *exact* key set
    (`set(payload) == {'policy'}`, `set(payload) - {'target_message_id',
    'preserve_compaction_handoff'}` must be empty) and exact types
    (`type(value) is not METADATA_FIELDS[key]` — an **exact type** check, so `True` does not
    pass as an int). An unknown key is `invalid_params`, not a silently ignored field.
  - **The editor MCP payload carries only a fingerprint** (`:30-33`, `:71-74`): "the owner
    keeps the list in memory and hands the store only its fingerprint, so no transport
    credential reaches a receipt."
  - **`keep_last` is legal only with `partial=True`** and `keep_last >= 1` (`:79-86`).
  - **`focus` alone may still be the raw `/compress` argument string** from an Ink/Desktop
    client; the structured flags come from the shared parser on the native CLI/ACP path
    (`:80-81`).
  - **A composite compaction carrier keeps its handoff** (`:145-152`): a carrier is a row
    that holds both a summary and the next ask; the receipt reports the **live ask**, so
    `/retry` resubmits the ask, not the summary.
  - **The rewind refusal distinguishes two "not there any more" cases** (`:135-142`):
    a target compaction took out → `detail='compacted: target user message was summarized
    when the session was compressed'`; anything else → "target user message is no longer in
    session history". The `compacted:` prefix is a **machine-readable prefix clients match**
    (`:157-159`).
  - **An import refuses to restore a deleted id** (`:203-208`): `admission_conflict` with
    "session {sid} was deleted here; a deleted session is not restored" — "a row restored
    beside the fence would refuse every turn."
  - **An import detaches parents it does not control** (`:216-226`): a parent outside the
    payload is kept only when its import binding equals the child's; otherwise the link is
    dropped and counted as `detached`, because linking under a foreign row would graft the
    import onto a chain that a later chain-aware delete would then remove.
- **Edge cases & failure handling:** `_import` caps the payload at `db._IMPORT_MAX_SESSIONS`
  and requires the payload's first session to be the addressed one (`:198-202`); ids that
  already exist are *skipped*, not overwritten (`:209-212`); malformed payloads produce an
  `invalid_params` refusal rather than a partial import.
- **Surprising:** the `model` operation has a bespoke early-accept branch (`:13-17`) whose
  condition is `not set(payload) - {...}` and `all(isinstance(v, str) and v.strip() …)` and
  a parseable reasoning level — the generic path below would reject it. It is the most
  fragile-looking code in the shard.

### `hermes_state_readpool.py` (259 lines)
- **Purpose:** budget the read-only connections a process opens against a SQLite WAL database,
  so that N handles on one `state.db` cannot walk the process into `EMFILE`.
- **Key abstractions:** `_READ_POOL_MAX = 8` (per file, `:35`), `_READ_POOL_PROCESS_MAX = 24`
  (per process, `:44`), `_HANDLES_PER_PATH_WARN = 4` (`:48`), `_FD_HEADROOM_RESERVE = 64`
  (`:56`), `_FD_USAGE_CACHE_SECONDS = 0.25` (`:60`), `_process_read_permits` (`:62`),
  `_PathReadBudget` (`:140`), `_read_budgets` (`WeakValueDictionary`, `:242`),
  `_fd_headroom_ok()` (`:111`), `_reclaim_idle_read_conn_anywhere()` (`:132`).
- **Data flow:** `acquire()` applies three gates, broadest first: (1) descriptor headroom,
  (2) the process-wide semaphore, (3) the per-file semaphore. On a miss it tries to reclaim
  one **idle** pooled connection — from a peer on the same path for the file ceiling, from
  anywhere for the process ceiling — and retries the semaphore **once** (no looping:
  "Another thread may take a freed permit first: legitimate loss, no looping"). A refusal
  means the caller degrades to the locked writer connection.
- **Non-obvious design decisions:**
  - **A permit is held for a connection's whole lifetime**, not just while checked out
    (`:27-34`): "a `LifoQueue` only caps how many are *returned*, and EMFILE is a peak-instant
    condition". This is why the ceiling is a semaphore and not a pool.
  - **The budget is per FILE and per PROCESS, not per instance** (`:143-152`): the old
    per-instance semaphore "bounded the wrong noun: the descriptors are spent on a *file*, so
    N SessionDB objects on one state.db each got their own allowance and peak scaled as
    N × (1 + MAX)". A multiplexed gateway opens one store per profile, so a per-file ceiling
    alone still grows with the profile count.
  - **Degrade, never fail.** When permits are gone, reads fall back to the locked writer
    connection — "slower, but not a wedge the supervisor can't see" (`:32-34`).
  - **The fd probe fails OPEN when unmeasurable and CLOSED only on evidence** (`:111-129`):
    Windows has no `/proc/self/fd`, so the guard is correctly inert there; a measured
    shortfall or a probe that itself hit EMFILE (`-1`) closes it. The count is cached for
    0.25 s so a read burst is not a syscall per query.
  - **The descriptor reserve is for *other* consumers** (`:51-56`): Hermes's SQLite handles
    are only part of the fd table; the reserve exists so httpx sockets and terminal pipes are
    not pushed over the edge by SQLite's share.
  - **Read-only opens get a bounded retry budget for transient `SQLITE_IOERR`** during a WAL
    transition — but **not** writable opens, because "a writer owns the transition, so an
    IOERR there means a real storage/fd problem" (`:26-35`).
  - **Duplicate writer handles are made visible before they become an incident**
    (`_PathReadBudget.register`, `:166-192`): the warning lists the number of live writable
    handles on the path *and the creation site of each* — the same population as the count,
    "or the list no longer explains the number".
- **Edge cases & failure handling:** the budget registry is a `WeakValueDictionary` keyed by
  the canonical path (`:241-252`), so a dropped `SessionDB` releases the budget and tmp-path
  churn cannot grow the map; two spellings of the same path share one budget.
- **Surprising:** the module logs under the name `"hermes_state"`, not its own module name
  (`:19`), and the comment says the caplog tests pin that name — a deliberate choice so the
  operator sees one logger for the whole store.

### Tier 2 — bulk

None. Every file in this shard is classified `source` and was read in full; there are no
tests, docs, configs or assets in the list.

### Tier 3 — skipped with a reason

None. No file in this shard was skipped.

---

## 2. Ideas worth stealing

Cross-repo convergence could not be verified from this shard alone (it is one repo's
persistence layer), so the marks below are **UNIQUE** by that rule — they are *not* claims
that the other two reference repos lack them.

1. **Exact-retry receipts with a payload digest.** Every mutation stores
   `state_meta['gateway.mutation.v1.<fingerprint>'] = {digest, result}`, where the digest
   covers `(operation, payload, expected_revision, expected_generation)`. The same request id
   with the same payload replays the byte-exact stored result; the same id with a *different*
   payload raises `admission_conflict` instead of silently re-running.
   (`hermes_state_runtime.py:461-480`, `hermes_state_mutation_chat_pick.py:41-67`.)
2. **Two counters with two meanings.** `runtime_revision` = "the logical object's state
   changed" (client-side optimistic concurrency); `runtime_generation` = "a new physical
   target was published" (execution scope). Most writes bump only the first; only
   reset/compress/branch bump the second.
   (`hermes_state_runtime.py:517-521`, `hermes_state_mutation_prepared.py:32-42`.)
3. **Prepare → revalidate-in-the-same-transaction.** The client prepares against a snapshot;
   the commit re-derives that snapshot on the *writer connection* and demands exact equality.
   No lock spans the two calls, and no stale write can land.
   (`hermes_state_mutation_prepared.py:12-30`.)
4. **A deleted id is never reused — a derived id gets a generation.** Permanent fences stop a
   deleted session id from being recreated; derived ids (bot chat, A2A, hosted-room member)
   instead walk to their next generation, and the fences they passed are made permanent in
   the same write that binds the successor.
   (`hermes_state_mutation_retirement.py:28-71`.)
5. **Keep the receipt, strip the payload.** On delete, the receipt's digest/ids/revision
   survive so exact retries still work, while the user content inside it (`target_message`,
   `summary`, `title`, cumulative `messages`, reasoning, tool payloads) is nulled. A retry
   after a delete resolves but cannot read the deleted text back.
   (`hermes_state_mutation_retirement.py:85-98`, `:168-194`.)
6. **Separate the permanent fence from the sweeping marker.** A user delete leaves a
   permanent tombstone; a housekeeping sweep leaves a marker that ages out at a 7-day retry
   horizon, so a cron sweep cannot grow `state_meta` without bound. The split is decided by
   *derivedness*, not by caller.
   (`hermes_state_mutation_retirement.py:148-166`, `:236-259`, `:402`, `:412-433`.)
7. **Fail closed on an incomplete holder scan.** "Could not prove the DB is quiet" is
   represented as an *unknown holder* sentinel, never as an empty list, and the refusal
   message tells the operator exactly which PIDs to stop and how.
   (`hermes_state_holders.py:425-445`, `:585-620`.)
8. **Budget the noun that costs, and degrade instead of failing.** Read permits are per
   *file* and per *process*, not per instance; on a miss the reader falls back to the locked
   writer connection rather than erroring.
   (`hermes_state_readpool.py:35-44`, `:140-175`.)
9. **Distinguish "busy" from "unknown".** A run whose outcome is not known is a different
   error code from a run that is merely in flight, and a queued follower is allowed for
   target-advanceable writes but refused for delete/branch.
   (`hermes_state_mutation_guards.py:19-62`.)
10. **Rewind deactivates, never deletes.** The transcript keeps the rows with `active=0`,
    which is what makes a rewind undoable *and* what lets the store tell "compaction
    summarised this" (`compacted=1`) from "a rewind took this back" (`compacted=0`).
    (`hermes_state_mutation_transcript.py:25-36`, `hermes_state_mutations.py:162-185`.)
11. **A machine-readable prefix inside the error detail.** `detail='compacted: …'` — the
    prefix is what clients match; the rest is the human log line.
    (`hermes_state_mutations.py:157-160`.)
12. **A copy must not inherit credentials.** Branching resets the approval policy to `ask`
    and refuses to copy an editor/MCP selection unless the gateway prepared the child's own
    under the child's scope; the store is handed only a *fingerprint*, never the server list.
    (`hermes_state_mutation_branch.py:34-49`, `hermes_state_mutations.py:30-33`, `:71-74`.)
13. **A machine-readable record of the user's choices, kept in the receipt journal.** The
    durable answer to "what did the user pick, and when" is reconstructed with SQLite JSON
    functions over the mutation receipts — including the rule that a *deferred* pick is not
    yet a pick.
    (`hermes_state_mutation_prepared.py:99-126`.)
14. **A sweep skips busy rows; an explicit delete refuses.** One predicate separates
    housekeeping from user intent, so one live session can never abort a nightly prune pass.
    (`hermes_state_mutation_retirement.py:236-249`.)

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — partly in this shard.** The *scheduling* is not
  (it belongs to the `hermes-cron` shard), but the **housekeeping sweep interface** is:
  `retire_prunable` skips any id with live or unknown work and retires only the quiet ones
  (`:236-249`), and `prune_retired_tombstones` reclaims expired tombstones on a horizon
  (`:412-433`). The lesson transfers directly: a periodic digest/prune job must degrade
  per-item, not abort on one busy row — and it must distinguish an explicit user action
  (refuse) from a sweep (skip).
- **Human-in-the-loop approval — in this shard.** The approval policy is a frozen, per-session
  field with exactly three values (`ask`, `workspace_session`, `session`) that only the
  `edit_policy` operation may set (`hermes_state_mutations.py:34-37`). Two safety rules
  surround it: a branch **resets** it to `ask` rather than inheriting it
  (`hermes_state_mutation_branch.py:38-40`), and an explicit model pick carries a `confirm`
  token for "this exact resolved target" (`hermes_state_mutations.py:11-12`). The audit trail
  survives: every approval is a receipt with a digest, and deleting the session strips the
  *content* out of that receipt while keeping the fact of it.
- **Post-mortem / reflection loops — not in this shard** (the learning/insight services are
  elsewhere). The nearest thing here is the receipt journal: `picks_on` reconstructs the
  user's durable choices — model, reasoning level, workspace — from the receipts themselves
  (`hermes_state_mutation_prepared.py:102-126`), which is the raw material a
  "what did I keep changing, and did it help?" reflector would need.
- **Multi-agent — partially in this shard.** The *debate* machinery is not here, but delegate
  semantics are: a delegate subtree is the parent's by construction and is deleted with it
  (`hermes_state_mutation_guards.py:100-118`), and the `_delegate_from` marker is
  deliberately **not** used to detect forks, because a continuation inherits its parent's
  `model_config` (`:64-79`). For a trading app that runs sub-agents: a child agent's
  conclusions must not outlive a parent trade-plan's deletion.
- **Structured logs the model can query — in this shard.** The receipt journal in `state_meta`
  is a queryable, JSON-shaped log with no extra database: receipts are written with a
  GLOB-scoped key space and read back with `json_extract` (`hermes_state_mutation_prepared.py:99-126`).
  Same pattern as the `gateway.*` key namespaces: one table, prefix-scoped keys, JSON values.
- **Staying simple as features accumulate — in this shard.** The mutation surface is a
  **closed set**: `validate_action` whitelists the exact payload of each of ~12 operations
  (`hermes_state_mutations.py:8-55`), `apply_action` is one dispatch function
  (`:89-116`), the five policy edits share one handler table (`POLICY_HANDLERS`,
  `hermes_state_mutation_prepared.py:94-97`), and the five busy guards share one pair of
  ledger queries. New operations are additions to a table, not new machinery.

---

## 4. Non-obvious decisions and gotchas

1. **`runtime_revision` vs `runtime_generation` are not two versions of the same thing.**
   The revision is the client's optimistic-concurrency token and is bumped by *every*
   affected session; the generation is the execution scope and is bumped only when a new
   *physical target* is published. The compression-rotation path returns an **empty**
   affected set precisely because publication already advanced the revision
   (`hermes_state_mutation_compress.py:20`) — double-bumping it silently desynchronises
   every client fence.
2. **SQLite's `json_extract` raises "malformed JSON" even behind `json_valid(...) AND`.**
   That is why `ROUTE_RETIRED_SQL` wraps *every* JSON read in a `CASE WHEN json_valid(...)`
   branch (`hermes_state_mutation_retirement.py:343-356`). A plain `AND` chain is not safe.
3. **A compaction boundary absorbs the tool rows that answer an assistant turn**
   (`hermes_state_mutation_branch.py:24-30`). Cutting a transcript at "the last assistant
   message" and leaving its tool results in the parent is a bug waiting to happen.
4. **Fork markers are matched against the edge's *parent id*, never by presence**
   (`hermes_state_mutation_guards.py:64-79`), because a continuation copies its parent's
   `model_config` and therefore inherits a `_branched_from`/`_delegate_from` naming an older
   row. Presence-matching misclassifies continuations as forks and deletes the wrong rows.
5. **`ctypes.POINTER()` on a freshly defined `Structure` pins the class in
   `ctypes._pointer_type_cache` forever.** Building the Restart Manager structs per scan
   leaked a class set per call; they are `@functools.cache`d
   (`hermes_state_holders.py:324-327`).
6. **The Linux holder scan must use `realpath`, not `abspath`** — `psutil`/libproc report
   the kernel-resolved pathname, so a symlinked `HERMES_HOME` would hide every holder and
   let maintenance proceed over a live writer (`hermes_state_holders.py:433-435`).
7. **The "last init error" is never cleared on success** (`hermes_state_guard.py:159-165`):
   a concurrent open would erase the cause another thread's `/resume` is about to format.
8. **A queued admission is a legitimate waiter for one class of write and a refusal for
   another** (`hermes_state_mutation_guards.py:19-62`). The difference is a single status
   set, and it is the difference between "publish a new target" and "destroy the
   conversation".
9. **Rewind deactivates and recomputes; it never deletes and never increments**
   (`hermes_state_mutation_transcript.py:25-36`). The denormalised counters are derived from
   the active set, so they cannot drift.
10. **A model switch must not reload the launch defaults** — the transcript and the cached
    prompt stay byte-stable (`hermes_state_mutation_prepared.py:49-56`). Only the `provider`
    field of `model_config` is merged.
11. **A workspace move replaces the cwd/git identity of every row of the conversation** and
    bumps `git_metadata_generation` (`hermes_state_mutation_prepared.py:67-80`) — merging
    would leave the sidebar grouping inconsistent with the new location.
12. **A deleted session's tombstone is never reclaimed, only a sweep's is**
    (`hermes_state_mutation_retirement.py:412-433`). The expiring marker and the permanent
    marker look alike in the table and mean opposite things; the only difference is the
    `expires` field.

---

## 5. Weak spots

1. **Deep private-method reach-through.** This shard calls `db._publish_child_session_row`,
   `db._tail_rows_after_watermark`, `db._clone_message_rows`,
   `db._set_session_title_in_transaction`, `db._row_to_message_dict`,
   `db._bump_conversation_generation`, `db._check_transcript_write_guards`,
   `db._import_session_row`, `db._attach_import_parents`, `db._active_transcript_counts` —
   a dozen private methods of a 95 KB god-object (`hermes_state.py`). The split into
   `hermes_state_mutation_*` modules creates the *appearance* of separation while the
   coupling stays exactly where it was.
2. **SQL embedded in Python string literals.** `ROUTE_RETIRED_SQL` is a ~15-line SQL
   expression with named parameters assembled in Python
   (`hermes_state_mutation_retirement.py:343-369`); `picks_on` builds a WHERE clause by
   concatenating JSON paths (`hermes_state_mutation_prepared.py:99-126`). This SQL is
   effectively untestable except by running SQLite, and a one-character typo is a runtime
   failure in production.
3. **The validator is a 50-line if/elif whitelist with a bespoke early-accept for `model`**
   (`hermes_state_mutations.py:13-17`, `:8-55`). Every operation has its own accepted key
   set, its own type rules and its own special case; a missing combination (e.g. a `model`
   payload with a non-string `provider`) is rejected by accident rather than by design, and
   the acceptance surface is hard to see from the code.
4. **Near-duplicate guards that will drift.** `require_not_executing` and `require_idle` are
   the same query with one status differing; `_require_transcript_unleased` is duplicated
   inside both (`hermes_state_mutation_guards.py:19-62`). Two copies of "what counts as
   live" is precisely the class of bug the module is meant to prevent.
5. **Duplicated receipt plumbing.** `hermes_state_mutation_chat_pick.py` re-implements the
   prepare/commit receipt pair instead of reusing the runtime seam, because a messaging chat
   has no policy receipt — a defensible reason, but it means the fencing rules now live in
   two places that can diverge.
6. **Module cohesion drift.** `hermes_state_guard.py` holds both the pytest-isolation guard
   and a user-facing error string; `hermes_state_mutation_transcript.py` is a method on a
   duck-typed receiver that it does not import. Neither is wrong, but both make the file
   list a worse map of the system than it should be.
