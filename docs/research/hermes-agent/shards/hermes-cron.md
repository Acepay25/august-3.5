# hermes-agent :: hermes-cron

**Files in shard:** 46 (read: 46, skipped with reason: 0)
**What this shard covers:** the `cron/` package of Hermes — the whole scheduled-work subsystem, and
it is *not* a thin "call an LLM on a timer" implementation. It is a distributed scheduler with an
at-most-once occurrence ledger, a durable execution audit trail in SQLite, a fenced hand-off
protocol between a gateway and a restart-safe external worker, a delivery queue with at-most-once
send semantics plus a tombstone table, an incident dedup/ack ledger, an idle-time watchdog, a
bounded automatic re-run ladder for "never reached the model" failures, a provider-quota hold, a
hash-suppressed monitor mode, a per-job durable notepad, an injection-scanned prompt assembler, a
gateway-lifecycle guard that recursively scans referenced shell scripts, and a large set of
"the world is not what you assumed" guards (unwritable store, dead gateway, lost ownership, stale
claim, missing credential, unreachable MCP server). The dominant theme is **ownership**: who holds
the right to run this occurrence, how that right is proven, and what happens when it cannot be.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `cron/AGENTS.md` (151 lines) — the subsystem's own hardening contract (docs)

- **Purpose:** the repo-level instruction document for `cron/` (plus Kanban). It is the *authoritative
  list of invariants*, each written as "each guards a real failure; don't weaken without answering for it".
- **Key decisions it records (each is a claim about a past incident, with the issue number):**
  - **Occurrence accounting is at-most-once by construction.** `tick()` advances `next_run_at` *before*
    dispatch and stamps `pending_slot` in the same save; a scan that finds the stamp with a dead owner
    restores the instant *once*; the executions ledger's `scheduled_instant` blocks a second fire;
    `cron.catch_up_missed: false` skips past-grace misses *with a logged reason* ("Never drop a slot
    silently", #107485).
  - **Catch-up window = half the period, clamped to 120 s–2 h; 120 s grace for missed one-shots.**
  - **Headless ticks refuse, never spawn** — "Same policy as approvals (headless/cron = refuse)."
  - **The inactivity watchdog is idle time, not wall-clock** (default 600 s idle, `HERMES_CRON_TIMEOUT`
    overrides, `0` = unlimited): a stalled session is hard-interrupted so it cannot monopolise the
    scheduler, while a long-but-active job is never cut off.
  - **One ticker, N profiles, sequentially** — `scheduler_provider.py::_start_multiplex` is ONE ticker
    iterating `profiles_to_serve()` under `_profile_cron_scope(home)`, "never N threads (module globals race)".
  - **In-flight state is keyed by `(home key, job id)`** because "two profiles legitimately carry a
    `daily-brief`"; the *union* of bare job ids was the bug ("profile A's running `daily-brief`
    answered for profile B's idle one").
  - **A claim is released under the key it was registered with** — the pool worker's `finally` sits
    *outside* `ctx.run` and resolves the LAUNCH home, so `release_running_job(job_id, home=...)` is mandatory.
  - **Ticked-home state is reclaimed when a home leaves the set** — pools used to live until `atexit`,
    so "each home ever ticked kept a ThreadPoolExecutor and its worker threads forever".
  - **The host gateway stands down for a profile that runs its OWN gateway** (the tick lock stops a
    simultaneous double-run but not the race).
  - **The restart-safe external worker boots itself** — a failed dependency activation is *fatal*
    rather than running on a generation the collector may delete.
  - **Cron sessions pass `skip_memory=True`** — memory providers intentionally do not run during cron.
  - **Background `delegate_task` is process-local**; work that must survive restarts is a cron job.
- **Trading relevance:** this is a precise answer to "how do they run long-lived monitoring and
  scheduled work reliably" — the guarantees are enumerated as invariants, each tied to a failure
  mode, and each testable.
- **Surprising:** the doc is ~40% about *profile isolation* bugs and only ~20% about scheduling. The
  real complexity of a scheduler is ownership, not timing.

### `cron/__init__.py` (35 lines)

- **Purpose:** the package entry point; re-exports the public job API and `tick`.
- **Non-obvious:** the **first executable statement is the worker bootstrap**:
  `from cron.worker_bootstrap import worker_bootstrap as _boot_external_worker; _boot_external_worker()`.
  "`-m cron.scheduler` executes this package first: boot PM dependencies before `cron.jobs` reaches a
  third-party import. A no-op unless `_launch_external_cron_worker` marked this process." The package's
  first import (`cron.jobs` → `hermes_yaml` → `ruamel`) is already a dependency, so the boot must
  happen at package-import time, not in `__main__`.
- **Steal-able:** *if a subprocess entry point imports your package, the dependency bootstrap belongs
  in the package `__init__`, not the module `__main__`.*

### `cron/constants.py` (18 lines)

- **Purpose:** the three fire-claim timing bounds shared by the job store and its siblings.
- **Key abstractions:** `FIRE_CLAIM_TTL_SECONDS = 300`, `FIRE_CLAIM_SKEW_SECONDS = 60`,
  `CLAIM_TTL_INACTIVITY_HEADROOM = 3`, and `is_recurring(job)`.
- **Non-obvious:** the module is **import-free on purpose** — "a sibling loaded fresh from a newer
  on-disk tree must resolve these without going through the `cron.jobs` object a long-lived process
  cached at boot". A constant module is the one thing that survives a hot-upgrade.
- **Edge cases:** `FIRE_CLAIM_SKEW_SECONDS` exists because "a hosted/webhook fire for the armed slot can
  arrive a few seconds before the stored `next_run_at`" (the fire scheduler's clock runs ahead).
  `CLAIM_TTL_INACTIVITY_HEADROOM` exists because the timeout is an *inactivity* limit, not a wall-clock
  cap: "a TTL of exactly the timeout would expire live claims".
- **Steal-able:** one value for claiming, one-shot re-arm and stale-error recovery, "so they cannot disagree".

### `cron/execution_identity.py` (40 lines)

- **Purpose:** tell a plugin *which* cron execution the current code is running inside
  (`ctx.current_cron_execution()`).
- **Key abstractions:** frozen dataclass `CronExecution(job_id, job_name, execution_id, source,
  scheduled_instant, started_at, profile)`; `enter_cron_execution()` / `exit_cron_execution()`;
  `current_cron_execution()`.
- **Data flow:** the scheduler binds the identity once it has won the `claimed → running` transition
  (or a restart-safe worker adopted it) and resets it when the fire ends.
- **Non-obvious:** it is a **`ContextVar`**, so it follows the agent onto threads the scheduler already
  runs it on via `contextvars.copy_context()` and "never leaks to another concurrently firing job or
  profile". `current_cron_execution()` returns `None` when `is_delegated_child_context()` — "delegated
  children read `None` — they are not the scheduled occurrence".
- **Security note:** "Model output cannot reach it: tool subprocesses do not share the interpreter."
  The identity of a scheduled occurrence is a *harness* fact, not a model-visible string.
- **Steal-able:** a `ContextVar`-bound run identity is exactly the shape August Trading needs for
  "which automation produced this analysis".

### `cron/jobs_invariants.py` (45 lines)

- **Purpose:** the execution-mode invariants every job definition must satisfy, run by *both*
  `create_job` and `update_job` so "an update cannot bypass a rule the create door enforces".
- **Key abstractions:** `_validate_job_mode_invariants(monitor_script, monitor_url, no_agent, script)`;
  error message constants `NO_AGENT_WITHOUT_SCRIPT_ERROR`, `SCRIPT_IS_COMMAND_LINE_ERROR`.
- **Non-obvious:** `_script_is_command_line` — "a `script` with whitespace that resolves to no file is a
  command line (`echo hi`), not a path; run every tick it would deliver 'Script not found' as the
  payload. A plain missing filename stays creatable (`hermes cron doctor` reports it)." The rule is
  *deliberately* narrow: refuse the shape that is certainly wrong, allow the shape that a doctor can check.
- **Steal-able:** reject a configuration that is *structurally* impossible ("no agent and no script ⇒
  nothing to run"), not one that is merely unverified.

### `cron/env_settings.py` (20 lines)

- **Purpose:** profile-scoped reads of the `HERMES_*` tuning settings cron honours from `.env`.
- **Non-obvious:** a bare `os.getenv("HERMES_CRON_TIMEOUT")` is **wrong** under
  `gateway.multiplex_profiles`, because the tick then runs inside the *default* profile's process and
  `os.environ` holds the default profile's `.env`. So the read is: secret scope → else the profile's
  home `.env` → else plain environ. A one-function, three-source precedence ladder.
- **Steal-able:** per-profile configuration in a multi-profile process is a *scoping* problem, and the
  fix is a single resolution function, not a discipline.

### `cron/scheduler_thread.py` (51 lines)

- **Purpose:** a supervised daemon thread for the in-process cron ticker.
- **Key abstractions:** `SupervisedTickerThread` (`cron/scheduler_thread.py:19`) with
  `restart_if_dead()`.
- **Non-obvious:** the supervisor distinguishes "an external provider's `start()` (Chronos) arms remote
  one-shots and *returns by design*" from "a target that escaped with an exception". Only the latter is
  `_crashed` and worth respawning. The doc names the incident: "the gateway kept serving while
  `ticker_heartbeat` froze and no job fired again until a restart (#111010)".
- **Edge cases:** `restart_if_dead` refuses to respawn when `stop_event.is_set()` (shutdown requested),
  when the thread is alive, or when it did not crash. The log line says what the operator lost:
  "Scheduled jobs did not fire while it was down — check errors.log".
- **Steal-able:** *a supervisor that knows the difference between "returned" and "crashed"* — a
  health check that only asks "is the loop alive?" cannot tell a healthy no-op from a dead scheduler.

### `cron/scheduler_worker_failure.py` (54 lines)

- **Purpose:** job-level visibility for a recovered, acknowledged worker death.
- **Non-obvious:** `record_unknown_worker_outcome` refuses to act unless the execution is still
  `unknown` and the claim has an owner, then **fences the notice and the bookkeeping together**
  (`scheduler.fire_claim_fence(job["id"], expected_owner=owner)`) "so recovery cannot overwrite a newer
  fire or duplicate a failure the worker already recorded".
- **Surprising:** `external_worker_exited_reason` deliberately keeps the run `unknown` rather than
  `failed` — "whether side effects ran is still unknown; only the cause becomes truthful (#128509)".
  The generic dead-owner sweep could only say "the owner vanished" and therefore wrote a *false* cause
  ("Scheduler restarted…") for a run whose restart never happened.
- **Steal-able:** *truthful causes* — the difference between "failed" and "we don't know" is the
  difference between a retry and a double-execution.

### `cron/worker_bootstrap.py` (53 lines)

- **Purpose:** the dependency boot the restart-safe external worker never gets from the normal entry point.
- **Non-obvious:** `-m cron.scheduler` executes the *package* before the module, so the package's first
  import (`cron.jobs` → `hermes_yaml` → `ruamel`) is already a third-party dependency — so the boot must
  happen in `cron/__init__.py`, not in `__main__`. `finish_worker_boot()` is split out precisely
  because "while `-m cron.scheduler` executes `cron/__init__.py`, `sys.argv[0]` is still `-m` and
  `__main__` has no spec, so the relaunch command could not name the module to re-run".
- **Edge cases:** a genuine activation failure **propagates**: "continuing on the inherited, unleased path
  lets the collector delete the generation under a live worker". PM's legitimate no-ops return normally.
- **Steal-able:** the "boot must happen before the first import, and a failed boot must be fatal"
  discipline is worth copying verbatim for any long-lived worker process.

### `cron/job_definition.py` (65 lines)

- **Purpose:** the schema of *authored* job fields, shared by importers of a foreign cron store.
- **Key abstractions:** `JOB_DEFINITION_FIELDS` (a `frozenset` of 22 field names),
  `merge_job_definition(local, authored)`, `import_job_definitions(shipped, paused_reason=...)`.
- **Non-obvious:** the split between "authored" (create) and "advanced by the scheduler"
  (`next_run_at`, `state`, run counters) is an explicit, single list — "Callers merging an authored store
  into a live one import this rather than duplicating the list." `merge_job_definition` keeps the *local*
  store's scheduler-owned state and takes the authored fields.
- **Edge cases:** if the schedule changed, the merge **drops `pending_slot` and clears the quota hold**
  ("an explicit rewrite of the schedule drops it") and recomputes `next_run_at` — a schedule edit must
  not inherit a pending occurrence or a provider hold that belonged to the old schedule.
- **Steal-able:** an explicit *authored vs machine-advanced* field list is exactly what August Trading
  needs for importing/exporting automations without clobbering runtime state.

### `cron/scheduler_diagnostics.py` (30 lines)

- **Purpose:** private run-document diagnostics, kept separate from delivery summaries.
- **Key abstractions:** `format_run_error(exc)`, `external_worker_stderr_tail(path)`.
- **Non-obvious:** the traceback is redacted with `redact_sensitive_text(..., force=True,
  redact_url_credentials=True)` and captures **no locals** — "Retain chained causes without capturing
  locals or exposing URL credentials". `external_worker_stderr_tail` keeps the last 1500 chars of the
  worker's captured stderr, with a leading `…` when truncated, and appends it as a message suffix:
  "the reporter had to guess the cause (#112729)" when stderr was `DEVNULL`.
- **Steal-able:** *tail the child's stderr and put it in the failure message* — a generic "exit 1"
  is a support ticket nobody can act on.

### `cron/scheduler_liveness.py` (71 lines)

- **Purpose:** the two halves of run liveness — the inactivity watchdog loop and the execution-ledger
  progress stamps — which "read the same signal (the agent's idle time) and act on opposite edges of it".
- **Key abstractions:** `_inactivity_watchdog_loop(...)` (`cron/scheduler_liveness.py:30`),
  `ExecutionProgressStamper` (`:57`), `owner_progress` dict.
- **Non-obvious (1):** the watchdog polls with **`threading.Event.wait`, not asyncio** — "so a blocked
  event loop cannot disable the watchdog" (the family of #94285, a 4118 s idle on a 600 s limit).
- **Non-obvious (2):** the stamper **stops stamping when idle time crosses the cadence** — "Idle past the
  cadence means the agent itself stopped: no stamp, so the ledger goes quiet exactly when the watchdog
  would." A healthy multi-hour job keeps stamping and is never reclaimed; a wedged worker reports
  growing idle time and is still released once the derived bound passes.
- **Non-obvious (3):** `AwakeIdleMeter` — "A sleeping host freezes the job with it, so time asleep never
  counts as inactivity."
- **Steal-able:** *two consumers of one signal, on opposite edges* — a heartbeat that also acts as the
  watchdog's evidence is far more robust than two independent timers.

### `cron/scheduler_gateway_gate.py` (70 lines)

- **Purpose:** the headless tick gate — agent jobs need a live gateway; a headless tick never starts one.
- **Key abstractions:** `_gateway_unavailable(home)`, `_note_fire_refused(job_ids, detail)`,
  `refuse_agent_jobs_without_gateway(due_jobs)`, `GATEWAY_DOWN_HINT`.
- **Non-obvious:** "Down" is *every outcome but `ready`*. A gateway that is `starting` or `draining`
  would send the tick into a 30 s wait and book the deadline as a **FAILED** run — "a slot lost to a
  restart window is a missed fire, not a job failure." So a not-ready gateway **holds** the job, books
  nothing, and leaves the due instant where it was.
- **Edge cases:** `_note_fire_refused` also drops the dispatch marks (`pending_slot`, `run_claim`) the due
  scan just wrote — "the slot was never handed over, so nothing must 'restore' or 'reclaim' it".
- **Steal-able:** *refuse rather than spawn, and hold the slot rather than consume it* — the difference
  between "skipped" and "failed" in a scheduler's own ledger.

### `cron/delivery_outcome.py` (74 lines)

- **Purpose:** write a queued delivery's terminal outcome back onto the run that queued it.
- **Key abstractions:** `_LEDGER_OUTCOME` map, `_settle_job_record`, `_terminal`, `settled_outcome`,
  `settle_queued_delivery`, `settle_quietly`.
- **Non-obvious:** `unknown` maps to **`failed`** in the ledger — "the user cannot be told the result
  arrived", so an uncertain delivery is reported as a failure, not as a pending state.
- **Non-obvious:** `_settle_job_record` fences on *two* facts: the ledger's latest attempt for the job
  **and** the job's latest recorded completion. "Both sides call `settle_queued_delivery`… a drain can
  finish before the run's `mark_job_run` lands", so the call is idempotent and "never rewrites a later
  run's status".
- **Steal-able:** *the same settlement is written from two independent sides, so it must be idempotent
  and fenced by the run id, not by a sequence number.*

### `cron/scheduler_delivery_origin.py` (18 lines)

- **Purpose:** relay egress discriminators a cron fire carries from its persisted job origin.
- **Key abstractions:** `stamp_origin_discriminators(t, route_metadata, media_metadata)`.
- **Data flow:** reads the origin's `scope_id` and `user_id` off the live send target `t` and writes
  them into the route and media metadata with `setdefault`.
- **Non-obvious (1):** **"Relay egress is fail-closed on a discriminator and the RelayAdapter's caches are
  cold after every boot, so the persisted origin supplies them."** The origin is the durable record; the
  adapter's cache cannot be trusted to have it.
- **Non-obvious (2):** the discriminators are **origin-only**: "a fan-out target's recipient is not the
  origin's author" — so `scope_id` is stamped only when `t.origin_target`, and `user_id` only when
  `t.is_relay` ("`user_id` is read by relay transports only").
- **Non-obvious (3):** `setdefault` "never overrides router or home stamping" — the origin fills a gap,
  it does not overwrite a decision another layer already made.
- **Steal-able:** *the persisted job carries the identifiers a later transport needs, because the
  transport's caches are cold after a restart.* For August Trading this is the same shape as "the alert
  target's channel id is stored with the automation, not re-derived from a live session".

### `cron/scheduler_detached_worker.py` (57 lines)

- **Purpose:** teardown of a worker that outlived its `run_job`.
- **Non-obvious:** `ThreadPoolExecutor.shutdown(wait=False)` after an inactivity timeout does not stop a
  worker already inside `run_conversation`; finalising its `SessionDB` from `run_job`'s `finally` would
  close a handle the worker is still writing to. So the **Future owns the teardown**
  (`defer_teardown_to_running_worker` → `future.add_done_callback(_finish)`).
- **Edge cases:** `_close_late_session_db_result` — a `SessionDB` whose constructor finished *after* the
  abandonment leaks `.db`/WAL/SHM handles until EMFILE (#72782); the done-callback retrieves and closes it.
- **Steal-able:** *whoever owns the handle owns the close* — a timeout must transfer ownership, not
  race the worker.

### `cron/scheduler_ownership.py` (135 lines)

- **Purpose:** "Which profile homes THIS process ticks, and who owns the cron tick for a given home."
- **Key abstractions:** `register_ticked_homes(homes)`, `ticked_homes()`, `serves_profile(home)`,
  `owns_cron_tick_for(home)`, `record_serves_profile(record, home)`, `live_gateway_ticking(home)`,
  `_claim_owner_is_dead(claim)`.
- **Non-obvious:** the two predicates are kept apart on purpose. `owns_cron_tick_for` = "this process is
  the host gateway AND ticks that home"; `live_gateway_ticking` = "a *different*, live host gateway holds
  the runtime lock and its published served set covers that home". The runtime lock alone proves only
  that the process is the host gateway, "not that its ticker visits the profile whose store is being
  ticked right now."
- **Non-obvious:** `register_ticked_homes` reaps the departed homes' worker pools and store state — "pools
  used to live until `atexit`, so serving (or churning) many profiles leaks one ThreadPoolExecutor and
  its worker threads per home ever ticked."
- **Edge cases:** "Every probe failure answers 'no': ownership claims are certainties, never guesses."
  `_claim_owner_is_dead` parses `host:pid[:token]` and only shortens a TTL for a *proven* death on
  *this* host; a foreign host or a liveness-probe failure returns False.
- **Steal-able:** *ownership must be provable, and "cannot prove" must never shorten a safety bound.*

### `cron/scheduler_bookkeeping.py` (118 lines)

- **Purpose:** the terminal bookkeeping phases shared by the scheduler execution paths.
- **Key abstractions:** `EMPTY_RESPONSE_ERROR`, `fail_empty_response(d, final_response)` (`:8`),
  `finish_interrupted_run(...)`, `_classify_delivery_outcome(...)`, `finish_completed_run(...)` (`:52`).
- **Non-obvious (1):** `fail_empty_response` — "a 'successful' run with a blank answer is a soft failure
  (never `ok`)… a recovered whitespace answer cannot turn the job green."
- **Non-obvious (2):** the delivery-outcome vocabulary is a small closed set —
  `failed | queued | suppressed | not_configured | delivered | suppressed_acked`. `suppressed_acked` is
  distinguished from plain `suppressed`: "Failure ping withheld for a known signature: operator acked it,
  or it was already alerted inside the reminder cooldown."
- **Non-obvious (3):** `finish_completed_run` passes `ladder_rung=True` for a retry run — "a re-run of an
  occurrence that already counted: must not spend another repeat slot" — and `quota_hold_seconds` +
  `recover_consumed_fire` for a provider-window hold.
- **Non-obvious (4):** the "delivery lane" is read from `scheduler._delivery_lane_value(job,
  for_failure=not d.success)` — "Read the lane the notice was actually routed through
  (`failure_deliver` on failure)", so the recorded outcome matches the lane that carried it.
- **Non-obvious (5):** a lost fire claim is itself a terminal failure — "Fire claim ownership lost before
  terminal completion." And the admission journal is unlinked only at the very end.
- **Steal-able:** *a small closed vocabulary of delivery outcomes, and a rule that the recorded outcome
  names the lane it travelled.*

### `cron/scheduler_worker_env.py` (70 lines)

- **Purpose:** the import path of the restart-safe external worker.
- **Key abstractions:** `_installed_purelib()`, `_committed_dependency_site_packages(project_root)`,
  `pin_hermes_tree_on_pythonpath(worker_env, repo_root)`.
- **Non-obvious:** the pin is applied *after* the shared subprocess sanitizer strips Hermes-owned
  `PYTHONPATH` entries ("user children must not see our tree. This child IS Hermes"). It is skipped
  when `repo_root` is the interpreter's `purelib` — under a wheel/pipx install `cron/` lives in
  site-packages itself, "and pinning it would move site-packages ahead of the stdlib on `sys.path`".
- **Edge cases:** `committed_venv` unreadable → warn and pin the tree only; the worker re-reads it and
  fails the dispatch with PM's own error.
- **Steal-able:** *sanitise the child's environment and then re-add exactly what it needs, in a stated order.*

### `cron/scheduler_failure_copy.py` (119 lines)

- **Purpose:** plain-language copy for the one-line cron failure notice delivered to a job's chat.
- **Key abstractions:** `cron_output_dir_display(job_id)`, `classify_cron_failure_reason(text)`,
  `provider_failure_notice(...)`, `generic_failure_notice(...)`, `script_timeout_notice(...)`,
  `inactivity_notice(...)`, `blocked_config_notice(job_name, reason)`.
- **Non-obvious (1):** the classifier is *reused* — "one classifier for the whole app, no cron-local
  regex ladder" — but the scheduler only has `str(exc)`, so the status code and exception type the
  classifier keys on are **rebuilt from the text**: a whole-token HTTP code after `HTTP`/`Error code`/
  `status` (so "a bare `429` inside a job id or hash never counts", #83188) and a leading
  `ReadTimeout:`-style prefix.
- **Non-obvious (2):** the action table is *reason → what to do*, and the actions name the **exact
  command** plus the **real output directory** — "cron output alone sent operators hunting."
  Transient reasons get the backup-provider clause from the scheduler (which knows whether a fallback
  chain exists) instead of a fixed sentence.
- **Non-obvious (3):** `blocked_config_notice` says "Nothing was charged… will not repeat this alert;
  check with `hermes cron doctor`." — a pre-flight refusal is a one-time, cost-free notice.
- **Steal-able:** *every failure notice answers "what happened" and "what to do", names a runnable
  command, and states the cost ("Nothing was charged").*

### `cron/occurrences.py` (101 lines)

- **Purpose:** "Exact scheduled identities, independent of mutable jobs.json dispatch stamps", plus the
  profile-local catch-up counter marker.
- **Key abstractions:** `scheduled_instant(value)`, `completed_occurrence(job, instant)`,
  `pending_slot_stamp(next_run, now)`, `unclaimed_pending_slot(job, now)`,
  `get_catch_up_occurrence_count()`, `record_catch_up_occurrence()`.
- **Non-obvious (1):** `scheduled_instant` canonicalises to UTC **and returns `None` for a naive
  timestamp** — "legacy/ambiguous values carry no exact identity". Identity is refused, not guessed.
- **Non-obvious (2):** `completed_occurrence` treats only *positively identified poison rows* as not
  proof — a completion recorded **before** its claimed occurrence is ignored; everything else remains
  proof. "Unknown/failed/pruned attempts cannot prove completion: keep them eligible."
- **Non-obvious (3):** the `pending_slot` protocol, documented at length: the tick advances
  `next_run_at` before dispatch (at-most-once across a mid-run crash), which leaves a window where the
  process exiting loses the occurrence silently (#107485). The due scan stamps `pending_slot` with the
  exact stored instant plus the stamping owner; `claim_job_for_fire` (the point after which side effects
  may exist) clears it; any explicit schedule rewrite drops it. A slot still pending once its owner is
  provably gone "was never claimed, so it is restored ONCE as the due instant… never N replays."
- **Steal-able:** *the durable "occurrence was taken off the schedule but not yet claimed" record* — the
  single most important piece of a crash-safe at-most-once scheduler.

### `cron/notepad.py` (137 lines)

- **Purpose:** a per-job durable KV notepad (cursors, watermarks) carried across cron wake-ups.
- **Key abstractions:** `NOTEPAD_FILE` override, `MAX_VALUE_BYTES = 16 KB`, `MAX_KEY_CHARS = 128`,
  `MAX_JOB_TOTAL_BYTES = 64 KB`; `set_note` (`:79`), `get_note`, `delete_note`, `list_notes`,
  `clear_notepad`, `render_notepad_section(job_id)` (`:149`).
- **Non-obvious (1):** the caps are "a documented contract" and an oversized write **raises `ValueError`
  and leaves the store untouched** — because "the notepad is prompt-injected each run", so the cap is a
  *prompt-size* budget, not a storage budget.
- **Non-obvious (2):** the total-bytes check is computed in SQL
  (`SUM(LENGTH(CAST(key AS BLOB)) + LENGTH(CAST(value AS BLOB)))` over the other keys) and enforced
  inside the transaction.
- **Non-obvious (3):** `render_notepad_section` returns **`''`** for an empty notepad — "so jobs that
  never use the feature get a byte-identical prompt (prompt-cache + drift safety)". An empty feature
  must cost zero bytes.
- **Non-obvious (4):** the file path is resolved *at transaction time*, not import time, "so multiplexed
  profile ticks cannot leak one profile's notepad rows into the import-time home — and `remove_job`'s
  `clear_notepad` cannot wipe the wrong profile's DB" (#86519).
- **Steal-able:** *a per-automation durable KV scratchpad with a hard prompt-injection budget.* This is
  the closest thing in the repo to a trade-log watermark, and it is directly steal-able for August
  Trading's scheduled scans.

### `cron/monitor.py` (143 lines)

- **Purpose:** monitor-mode cron — hash-suppressed change detection on a cheap source.
- **Key abstractions:** `MonitorOutcome(ok, changed, first_run, context_block, error)`;
  `hash_monitor_output` (`:44`), `build_monitor_diff`, `job_has_monitor`, `check_monitor(job)` (`:126`);
  caps `MAX_DIFF_CHARS = 4000`, `MAX_OUTPUT_CHARS = 8000`, `URL_TIMEOUT_SECONDS = 30`,
  `MAX_URL_BYTES = 262144`.
- **Non-obvious (1):** the hash is over **exact UTF-8 bytes, "no timestamp/whitespace normalization"** —
  "scripts must emit stable output". The contract is pushed to the script, not worked around in Python.
- **Non-obvious (2):** **the new hash and snapshot are persisted BEFORE the agent runs** — "detection
  time is the state boundary, so a failed agent run doesn't re-alert on the same content forever." On
  failure, nothing is persisted and the stored hash is left untouched.
- **Non-obvious (3):** the first run is a *distinct* context block ("## Monitor Baseline (first run)") so
  the model is not told "CHANGE DETECTED" when there is no previous output to diff against.
- **Non-obvious (4):** source failure is "an ERROR, never a change".
- **Non-obvious (5):** the URL fetch is bounded on *bytes* (256 KiB) and on *time* (30 s), with a
  `User-Agent` set, and the scheme is checked before `urlopen`.
- **Steal-able:** **THE most directly transferable idea in this shard for August Trading**: a scheduled
  monitor job that runs a cheap source first, hashes it, and only wakes the expensive model when the
  bytes changed — with the hash persisted *before* the model runs. For a trading app this is exactly
  "poll the order book / the position / the price, and only run the analysis agent when something moved".

### `cron/suggestions.py` (161 lines)

- **Purpose:** suggested cron jobs — proposed automations the user accepts with one tap.
- **Key abstractions:** `SUGGESTIONS_FILE`, `MAX_PENDING = 5`, `VALID_SOURCES = {catalog, blueprint,
  usage, integration}`, statuses `pending|accepted|dismissed`; `add_suggestion`, `get_suggestion(ref)`,
  `dismiss_suggestion`, `accept_suggestion(ref, origin=...)`, `clear_resolved()`, `list_pending()`.
- **Non-obvious (1):** **consent-first** — "nothing auto-creates". Accepting calls `cron.jobs.create_job`
  with the stored `job_spec`; "no second job engine".
- **Non-obvious (2):** the **dedup latch**: a `dedup_key` that was already decided (or is still pending)
  is never re-offered, and dismissed records are *retained on disk* for their key, while accepted
  records are dropped by `clear_resolved` ("they served their purpose once the job exists").
- **Non-obvious (3):** `MAX_PENDING = 5` — "so the list never becomes a nag wall; when full, new ones are
  dropped."
- **Non-obvious (4):** `accept_suggestion` resolves the suggestion as **accepted even when the creation
  raised** (`CronSchedulerRegistrationError`) — "the job is already durable: resolve the suggestion so a
  retry cannot create a second copy."
- **Steal-able:** *a proposal→accept→create pipeline with a dedup latch and a hard cap on the inbox.*

### `cron/unreachable_retry.py` (132 lines)

- **Purpose:** automatic bounded re-runs for scheduled fires that **never reached the model**.
- **Key abstractions:** `RETRY_DELAYS_SECONDS = (300, 900, 1800)` (the "Cowork ladder"),
  `STATE_KEY = "unreachable_retry"`, `retry_enabled(cfg)`, `is_model_unreachable_failure(exc, agent)` (`:58`),
  `plan_retry(job)` (`:135`), `will_retry(job)`, `is_retry_run(job)`, `is_retry_fire(job, next_run)`,
  `clear_state(job)`.
- **Non-obvious (1):** the class is **deliberately narrow** — the run must have FAILED with a transient
  network/DNS error *and* the agent must have completed **zero API calls**. "Nothing was executed and
  nothing was spent, so re-running cannot double a side effect — unlike a generic failure retry, which
  has to answer for one-shot dispatch accounting and mid-run side effects."
- **Non-obvious (2):** **recurring jobs only** — "finite one-shots are pre-claimed by `claim_dispatch`
  (at-most-times) and must not regain a consumed dispatch here."
- **Non-obvious (3):** while a retry is pending the failure notice is **suppressed** ("Cowork re-runs
  silently"); a run that reaches the model — success or not — resets the ladder.
- **Non-obvious (4):** the ladder instant is **off the cron lattice**, and it is identified by an
  *expression fingerprint* (`state["expr"] == schedule["expr"]`) "so a direct `jobs.json` schedule edit
  cannot inherit the exception".
- **Non-obvious (5):** `plan_retry` falls back to the natural schedule when the ladder is exhausted and
  **resets the attempt counter**, so the next occurrence gets a fresh ladder.
- **Steal-able:** **a re-run ladder gated on "zero model calls"** — a spend-neutral retry that provably
  cannot double a side effect. For August Trading this is the template for "the scheduled analysis
  failed because the provider was unreachable; retry at 5/15/30 min, but only if nothing was executed".

### `cron/quota_hold.py` (131 lines)

- **Purpose:** hold a job's fires while a provider's usage window is known to be closed (#89376).
- **Key abstractions:** `STATE_KEY = "quota_hold_until"`, `SCHEDULE_EXPR_KEY = "quota_hold_cron_expr"`,
  `HOLD_SLACK_SECONDS = 60`, `hold_seconds_from_failure(exc)` (`:38`), `hold_active(job)`,
  `plan_hold(job, hold_seconds, recover_consumed_fire=False)` (`:112`), `is_recovery_fire(job, next_run)`,
  `hold_notice(job, hold_seconds)`.
- **Non-obvious (1):** the hold hint is read from the **`AuthError` itself, never from arbitrary text** —
  it walks the `__cause__`/`__context__` chain — "so an unrelated 'retry after' in an agent's output
  cannot park a job."
- **Non-obvious (2):** the *rationale* is economic: "re-firing on cadence is guaranteed to fail
  identically until the window reopens — every fire is a usage probe plus a delivered failure alert."
  So the job is parked and the operator gets **one** alert, not one per tick.
- **Non-obvious (3):** `_recovery_worthwhile` enforces a **half-cadence rule** — "otherwise the recovery
  fire is a near-duplicate of the natural one (hourly job, hold ending at :58, would fire :58 AND :00)"
  — and refuses a second hold while one is already active ("a job already carrying `quota_hold_until`
  IS the recovery fire failing again").
- **Non-obvious (4):** cron occurrences inside the closed window are **coalesced** to the first legal
  instant after it, not skipped one by one.
- **Steal-able:** *a circuit breaker for a closed external dependency, with a half-period recovery rule
  and a single alert* — directly applicable to "the broker/exchange API is rate-limited".

### `cron/bot_chat_legacy.py` (107 lines)

- **Purpose:** the `cron/bot_chat_pending` lane — Bot Chat outputs whose target owner was not running yet.
- **Key abstractions:** `defer(key, job, content, home, for_failure=...)`, `drain_legacy_pending()`,
  `_dispose(path, record)`, `_malformed(record)`.
- **Non-obvious (1):** **records are never deleted** — "they keep their final status as evidence,
  exactly as the old drain did." The file is the audit trail, not a queue.
- **Non-obvious (2):** a `claimed` record "was an uncertain CLI turn and is never resent" — a *decision
  fence* on an irreversible handoff.
- **Non-obvious (3):** each record is isolated: a malformed one is kept as `ambiguous` with a reason, and
  an unexpected failure leaves only that record queued — "so one bad file never stops cron."
- **Non-obvious (4):** "Owner not ready: discovery uncertainty is not a disposition" — an unready owner
  leaves the record queued for a later tick; only a *proven* condition is dispositioned.
- **Steal-able:** *keep the evidence; only dispose what you can prove.*

### `cron/suggestion_catalog.py` (127 lines)

- **Purpose:** the curated catalog of starter cron-job suggestions.
- **Key abstractions:** `CATALOG` (4 `CatalogEntry`s: daily briefing, important-mail monitor, weekly
  review, workday start reminder), `CatalogEntry(key, title, description, job_spec)`,
  `seed_catalog_suggestions(add_fn=None, keys=None)`, `classify_items_script_path()`.
- **Non-obvious:** every entry's prompt is **self-contained** — "cron jobs run with no chat context" —
  and the important-mail entry instructs the model to *resolve the script path at run time, do not
  assume a fixed location*, and to answer `[SILENT]` when nothing clears the bar.
- **Steal-able:** *a curated starter set offered as proposals, with prompts written to be
  self-contained because the automation has no conversational context.*

### `cron/scripts/classify_items.py` (145 lines)

- **Purpose:** classify candidate items by urgency and emit only the urgent ones — the
  "proactive-monitor pattern" as a standalone script.
- **Key abstractions:** `_load_items`, `_item_id`, `_build_prompt`, `_parse_scores`, `_render_text`,
  `main()`; exit codes 0 (silent), 2 (bad input), 3 (import failure), 4 (classifier call failed).
- **Non-obvious (1):** **empty stdout suppresses delivery** — "quiet intervals never spam" — and
  "nothing to classify → silent (the common quiet-interval case)" returns 0 with no output.
- **Non-obvious (2):** "A broken monitor must not quietly swallow important items: non-zero exit ->
  cron alerts." The classifier's *failure* is loud even though its *result* is quiet.
- **Non-obvious (3):** the whole batch is scored in **one** call ("one call to the auxiliary `monitor`
  model scores the whole batch"), with each item's salient fields capped at 1200 chars.
- **Non-obvious (4):** `_parse_scores` tolerates markdown fences and a last-ditch "first `[...]` block"
  extraction, and drops any index that is out of range.
- **Steal-able:** *the quiet-on-nothing / loud-on-failure contract, and one batched scoring call.*

### `cron/blueprint_plugins.py` (125 lines)

- **Purpose:** plugin-contributed Automation Blueprints.
- **Key abstractions:** `build_plugin_blueprint(plugin, key, ...)`, `plugin_blueprints()`; regexes
  `_KEY_RE`, `_NAMESPACE_RE`, `_SLOT_NAME_RE`.
- **Non-obvious (1):** the key is **namespaced `<plugin>:<key>`** "so a plugin can never shadow a
  built-in."
- **Non-obvious (2):** "bad input raises `ValueError`, which the registrar logs and ignores" — a bad
  plugin cannot break the built-ins.
- **Non-obvious (3):** when every required slot has a default, the blueprint is **filled and parsed at
  registration time** — "so a broken template or schedule fails at registration instead of on the user's
  first 'Schedule it'."
- **Non-obvious (4):** `plugin_blueprints()` resolves the ACTIVE profile's plugin manager **at call
  time** — "plugins load per profile, so nothing here is cached across profiles."
- **Steal-able:** *validate a user-authored template when it is registered, not when it is first used.*

### `cron/incidents.py` (247 lines)

- **Purpose:** durable cron failure incidents with signature dedup and ack.
- **Key abstractions:** `INCIDENT_STATES = ("detected", "alerted", "resolved", "closed")`,
  `_FAILURE_TYPE_ORDER`, `MAX_ERROR_CHARS = 500`, `upsert_incident(job_id, error, ...)` (`:156`),
  `set_incident_state` (`:200`), `ack_incident`, `close_incidents_for_recovered_job(job_id)` (`:242`),
  `list_incidents`, `get_incident`, `count_incidents`.
- **Non-obvious (1):** the incident id is `f"{job_id[:6]}_{error_sig}"` where the signature is
  `sha256(job_id + normalized_error)[:12]` (`:131`) — "the same job + same normalized error resolves to
  the SAME incident id, so a closed incident stays closed until the error text changes and mints a new one."
- **Non-obvious (2):** **durations are masked out of the signature** (`idle for 603s` → `#s`) "so they
  differ run to run for the same failure" — but "status codes and other numbers still count".
- **Non-obvious (3):** `resolved` vs `closed` are deliberately different. `resolved` = the job ran OK
  after the failure (auto); `closed` = the operator acked it. A repeat of a *resolved* error re-opens
  and alerts again; a repeat of a *closed* one stays silent. Without `close_incidents_for_recovered_job`
  "the ledger only ever grows" (32 of 32 open on one install).
- **Non-obvious (4):** the stored error is **always redacted before it hits disk** ("persisted to disk:
  always scrub") and length-bounded.
- **Non-obvious (5):** ordering uses `julianday(last_seen_at) DESC` because "last_seen_at carries a
  DST-varying offset: order by instant, not text."
- **Steal-able:** **the incident ledger is exactly August Trading's "post-mortem" substrate**: a durable
  *signature* per failure, a state machine (detected → alerted → resolved → closed), and the crucial
  distinction between "the system recovered" and "a human signed this off".

### `cron/store_health.py` (250 lines)

- **Purpose:** degraded state for an unwritable cron store (ENOSPC, EROFS, EACCES).
- **Key abstractions:** `StoreDegraded` dataclass (`store`, `since`, `error`, `recovered_at`, `sites`,
  `skipped`, `last_probe`), `PROBE_INTERVAL_SECONDS = 60`, `UNWRITABLE_ERRNOS`, `LOW_FREE_BYTES = 100 MB`,
  `note_unwritable` (`:108`), `note_writable`, `dispatch_blocked(due_jobs)` (`:186`),
  `outage_covers(cron_dir, due_at, grace)`, `recheck_idle()`, `probe_report(cron_dir)`, `probe_store(cron_dir)` (`:268`),
  `free_bytes(path)`.
- **Non-obvious (1):** the whole point is to turn a per-call-site warning storm into **one in-memory
  record per store directory** — "set by the first failed write, updated by later ones, cleared by the
  first jobs.json save that lands."
- **Non-obvious (2):** `probe_store` mirrors a real save: it stages a payload *the size of the current
  jobs.json* where the save stages it (beside a symlinked file's real target), so a full, over-quota or
  read-only target "fails here the way the save would." It also checks `os.access` on the real target and
  on the tick lock.
- **Non-obvious (3):** a **skipped run is recorded** (`record.skipped |= _run_keys(skipped_jobs)`) so the
  operator can be told "12 runs were skipped" and the grace gate can distinguish "missed because the
  disk was full" from "missed because the machine was asleep".
- **Non-obvious (4):** the probe interval is throttled to one minute and **file I/O stays outside the lock**
  ("`probe_store` … file I/O stays outside the lock").
- **Non-obvious (5):** `free_bytes` special-cases root: "Root may also fill the reserved blocks that
  `disk_usage().free` leaves out, so a 'full' disk is not full for root."
- **Steal-able:** *a circuit breaker for the persistence layer itself, with a real write probe, a
  recorded skip count, and a cross-process report path* — the durable analogue for August Trading's
  SQLite/IndexedDB layer.

### `cron/scheduler_authority.py` (208 lines)

- **Purpose:** transport-only cron execution; output and delivery stay with the firing scheduler.
- **Key abstractions:** `CronExecutionUnknown(RuntimeError)`, `journal_path(job_id, request_id)` (`:12`),
  `replayable_completions(job_id, completions)`, `pause_for_unknown(job_id, execution_id, reason)`,
  `run_canonical_job(job, extra_prompt=None, cancel_event=None, execution_id=None)` (`:55`),
  `reconcile_pending(*, allow_connect=True)` (`:149`).
- **Non-obvious (1):** the **admission journal** is a file per `(job_id, request_id)` under
  `cron/admissions/`, whose name is a SHA-256 of the pair. It records `params`, `receipt` and (later)
  `pause_recorded`. It exists to answer one question: "was this fire admitted?"
- **Non-obvious (2):** a *transport disconnect* and an *owner exception* are different. On an exception,
  the code **verifies the absence** of an admission via a `recover` call; "a returned owner exception is
  definite; a transport disconnect is not." If the state is `missing`, the run is booked as a definite
  failure; if it is `queued`/`started`/`terminal`, the run was admitted and is observed through the
  recovered receipt.
- **Non-obvious (3):** `CronExecutionUnknown` is raised for an *unverified* admission — "the owner may
  have accepted this fire; never book it as failed or re-fire." The recovery path therefore **pauses the
  job** and records the *exact* pause identity (`paused_at` + `paused_reason`) on the journal, so only
  that pause is ever lifted by a later verified receipt — "an operator's own pause/resume is never touched."
- **Non-obvious (4):** the owner-fenced progress mirror: "the owner's agent is still working: refresh OUR
  ledger row (the owner's stamp is fenced to the row's owner), once per owner stamp, so the stale-claim
  sweep measures the run's silence."
- **Non-obvious (5):** `reconcile_pending` "never submits missing or interrupted work" — it only
  *observes*. With `allow_connect=False` (headless tick) it leaves durable receipts for the next live
  owner instead of ensuring or spawning a gateway.
- **Steal-able:** **the "unknown, do not re-fire" third state** and the *admission journal* — a durable
  record that says "we asked; we do not know if it landed". This is the pattern August Trading needs
  before it can offer "re-run this scheduled scan" safely.

### `cron/delivery_queue.py` (386 lines)

- **Purpose:** profile-local durable handoff for cron delivery through live gateway adapters.
- **Key abstractions:** `DELIVERY_DB`, `MAX_TERMINAL_DELIVERIES = 1000`,
  `DEFAULT_DELIVERY_WAIT_TIMEOUT_SECONDS = 300`, `enqueue` (`:165`), `get_status`, `claim_next` (`:228`),
  `drain(send, limit=20)` (`:328`), `recover_abandoned()` (`:282`), `enqueue_and_wait(...)`,
  `_terminalize_wait_timeout(execution_id)` (`:359`).
- **Non-obvious (1):** the module docstring states the policy outright: "A gateway claims each row at most
  once. If that gateway dies after claiming, the outcome is marked unknown and **never retried**: losing a
  delivery is safer than duplicating a possibly-completed send."
- **Non-obvious (2):** the queue is **at-most-once with a tombstone table**. `delivery_tombstones` keeps
  the terminal status of pruned rows, so `enqueue` of an already-terminal id returns the *existing*
  outcome instead of sending again. The prune is ordered by `julianday(finished_at)` "because created_at
  carries a DST-varying offset: order by instant, not text."
- **Non-obvious (3):** the schema migration is **hand-rolled because "SQLite cannot widen a CHECK in
  place"** — it renames the table, recreates it with the widened CHECK, copies the rows, and drops the
  old one, all inside a SAVEPOINT so a failure rolls back "including claimed sends".
- **Non-obvious (4):** `recover_abandoned` distinguishes two unknown causes: "Gateway finished delivery
  but could not persist its outcome" (same process) vs "Gateway exited during delivery" (other process),
  and it decides liveness with `_owner_is_live(pid, started_at)` — a **process-start-time fingerprint**,
  never a bare PID.
- **Non-obvious (5):** `_terminalize_wait_timeout` is precise about the difference between *never
  attempted* and *attempted*: a row still `pending` is "left queued for whichever gateway comes up next
  … That is a deferral, not a failure: report success so the job is not recorded `delivery_failed` for a
  message the drain will still send." Only a row caught mid-send is fenced `unknown`.
- **Non-obvious (6):** terminal payloads are **redacted and blanked** (`job_json='{}'`, `content=''`) —
  the queue is not a transcript store.
- **Steal-able:** *at-most-once delivery with a tombstone table, and the "pending vs delivering"
  distinction at timeout.* For a trading app that pushes alerts, duplicating a "TP HIT" alert is worse
  than losing it.

### `cron/scheduler_preflight.py` (362 lines)

- **Purpose:** pre-run preflight — transient provider-resolution classification, provider-key /
  delivery-target / skills checks, and the shared-route adapter view for satellite profiles.
- **Key abstractions:** `BLOCKED_CONFIG_MARKER = "[blocked_config]"`,
  `BLOCKED_CONFIG_SILENT_MARKER = "[blocked_config:silent]"`,
  `_is_transient_provider_resolve_error(exc)` (`:41`), `_preflight_check_provider_key`,
  `_preflight_check_delivery`, `_preflight_check_skills`, `_empty_requested_mcp_toolsets`,
  `_preflight_job_config(job, cfg)` (`:387`), `SharedRouteAdapters`.
- **Non-obvious (1):** **every check fails OPEN.** "preflight blocks only on an affirmative misconfiguration
  verdict." A preflight that raises is logged at debug and the run proceeds. Only a *positive* verdict
  blocks — the opposite of most "validation" layers, and deliberate: a false block costs a scheduled run.
- **Non-obvious (2):** the provider-key check is **skipped when the job has a fallback chain** — "auth-fallback
  may legitimately rescue a missing primary key" — and a **pinned** job (no fallback) blocks.
- **Non-obvious (3):** the *transient* classifier is namespace-correct: `socket.gaierror` codes
  (`EAI_NONAME`, `EAI_AGAIN`, …) are never mixed with `OSError` errnos — "raw literals like {8, 7, 11} are
  macOS-only and wrong on Linux". It walks the cause chain, and it must be **eligible for
  `fallback_providers`** "else a healthy fallback rung is never tried and the job dies before the first
  model call".
- **Non-obvious (4):** the *credential-store scope label* — "a scheduler process whose home differs from
  the shell where 'the same credential works' (Docker HOME vs HERMES_HOME, a multiplexed satellite
  profile, a gateway launched without the shell's env) otherwise reports a bare 'No credentials stored'
  that cannot be told apart from a real login gap (#116213)." The verdict names the store it judged.
- **Non-obvious (5):** `_empty_requested_mcp_toolsets` treats a *reconnecting* MCP server as **not a
  block** — "a server that worked in this process and is parked/self-probing after a network blip is
  recovering, not misconfigured: the job runs with the tools that did resolve rather than losing a whole
  tick to a minute of downtime (#112871)". The warning fires **once per job+server per outage**, tracked
  in `_RECONNECTING_WARNED`.
- **Non-obvious (6):** the failure text must say the block is **not sticky** — "two operators misread the
  old text as a config error to repair by hand (#112871)".
- **Steal-able:** **a fail-open preflight with a positive-verdict-only contract**, plus the reconnecting-
  vs never-connected distinction. For August Trading: "do not start the scheduled analysis if the
  provider key is missing — but never block on anything you cannot *prove* is wrong".

### `cron/executions.py` (564 lines)

- **Purpose:** the profile-local durable audit ledger for cron execution attempts.
- **Key abstractions:** `MAX_TERMINAL_EXECUTIONS = 1000`, `HANDOFF_ADOPTION_GRACE_SECONDS = 30`,
  `LIVE_OWNER_STALE_CLAIM_FLOOR_SECONDS = 7200`, `create_execution`, `set_execution_occurrence`,
  `mark_execution_handoff_pending`, `adopt_claimed_execution` (`:267`), `mark_execution_running`,
  `finish_execution` (`:312`), `recover_receipted_execution`, `settle_delivery_outcome`,
  `settle_unstarted_execution`, `recover_interrupted_executions` (`:426`), `terminalize_dead_owner`,
  `give_up_execution`, `list_executions`, `latest_execution`, `live_inflight_execution`,
  `latest_executions`, `touch_execution_progress` (`:188`).
- **Non-obvious (1):** "The ledger records what is known about each attempt; **it is not a retry queue**."
  Terminal states are **immutable**; the *only* post-terminal rewrite allowed is
  `settle_delivery_outcome`, which can only turn a `queued` delivery outcome into the drain's real one.
- **Non-obvious (2):** the status set has **five** values — `claimed | running | completed | failed |
  unknown` — and `unknown` is the "we do not know if the side effects ran" state. "Interrupted attempts
  become `unknown` only after their owner process is **proved gone** — a start-time reading that fails to
  match the claim-time fingerprint is not proof of death."
- **Non-obvious (3):** the adoption protocol: the dispatching gateway creates the row (`claimed`), marks
  `handoff_pending=1` **before** spawning the restart-safe worker, and the worker's
  `adopt_claimed_execution` is the single `claimed → running` gate — "only the winner may acknowledge
  ownership or run side effects." A `handoff_pending` row younger than 30 s is never swept.
- **Non-obvious (4):** the **derived** stale bound — `_live_owner_stale_after_seconds()` (`:152`) returns
  `max(3 × HERMES_CRON_TIMEOUT, script timeout, 7200)`, "never a bare wall-clock constant", and returns
  `None` (never reclaim) when the inactivity timeout is 0/unlimited. Silence is measured from the owner's
  last `progress_at` stamp, so "a healthy multi-hour run is never reclaimed while it is still working."
  The wedged worker's *process is not terminated* — the row is released, the process leaks until host restart.
- **Non-obvious (5):** the sweep's UPDATE is **compare-and-swap on the whole observed snapshot**
  (`status=? AND process_id=? AND pid=? AND handoff_pending=? AND handoff_started_at IS ? AND
  claimed_at=? AND progress_at IS ?`) — "the owner may have stamped progress since, so act only on the
  snapshot that was judged."
- **Non-obvious (6):** `terminalize_dead_owner` exists only to make the *cause* truthful: the generic sweep
  writes "Scheduler restarted after this execution's owner exited", but a waiter that held the worker's
  `Popen` knows the worker exited with a known status — "a restart that never happened". Because the sweep
  leaves the row terminal, the waiter would report success and never record the run, and "the job's
  `fire_claim` then blocks the next manual fire for the whole lease (#128509)."
- **Non-obvious (7):** `latest_executions` uses a **window function** (`ROW_NUMBER() OVER (PARTITION BY
  job_id …)`) — "a per-row correlated ORDER BY julianday() cannot use the index and grows quadratically
  with history (~90 ms at 1000 rows)".
- **Non-obvious (8):** every ordering uses `julianday()` because "stamps carry the local offset, which
  changes at DST and on a timezone change, so text order is not time order."
- **Steal-able:** **the five-state ledger with an immutable terminal, a `handoff_pending` fence, and a
  CAS update on the observed snapshot.** This is the single most transferable structural idea in the shard:
  August Trading's scheduled-run history should be a ledger with `unknown`, not a list of booleans.

### `cron/scheduler_prompt.py` (400 lines)

- **Purpose:** cron job prompt assembly — `context_from` injection, skill loading, the assembled-prompt
  injection scan, and the credential-exfil / config-block guards.
- **Key abstractions:** `_parse_wake_gate` (`:21`), `_prepend_context_block`, `_job_skill_names`,
  `_MAX_CONTEXT_CHARS = 8000`, `_archive_answer` (`:82`), `_clip_to_context_budget` (`:120`),
  `_inject_context_from` (`:129`), `_load_cron_skill_parts`, `_CRON_HINT`, `_build_job_prompt(...)` (`:283`),
  `_scan_assembled_cron_prompt(...)` (`:367`), `_guard_job_credential_exfil(job)`,
  `_block_and_pause_job(job_id, job_name, reason)`.
- **Non-obvious (1):** **the wake gate** — "False only if the last non-empty stdout line is JSON
  `{"wakeAgent": false}` (agent skipped entirely — no LLM run, no delivery); anything else wakes normally."
  A *script* decides whether the model is woken at all, and the gate is **fail-open to waking** (any
  unparseable output wakes the agent).
- **Non-obvious (2):** the **length-frame archive format**. The writer stamps
  `**Prompt Characters:** N` and `**Response Characters:** M` *outside* user-owned text, so the reader can
  extract the response by *offset*, not by searching for a heading: "quoted frames inside the prompt or
  answer can never become boundaries and a truncated write is rejected." A missing or truncated
  writer-owned boundary is unusable (returns `None`). For legacy unframed archives the **LAST** `## Response`
  occurrence is the boundary, because "the assembled prompt half can itself carry the literal heading".
- **Non-obvious (3):** `_clip_to_context_budget` clips **head+tail** (half each) with an explicit
  `[... N chars omitted ...]` marker — "conclusions and summaries sit at the end."
- **Non-obvious (4):** `context_from` reads only the **header** to decide silence, "because script/agent
  payloads can quote these markers", and skips an archive whose answer is `[SILENT]`/blank so it falls
  through to an *older* archive. Job ids are validated as hex ("Traversal guard").
- **Non-obvious (5):** the **two-tier injection scan** — the assembled prompt is scanned because "skill
  content is loaded from disk at runtime (never scanned at create/update) and cron auto-approves tool
  calls". Tiering is by *what the prompt contains*: user prompt + hint only → STRICT; skills or injected
  data → LOOSER ("command-shape patterns dropped, invisible unicode sanitized not blocked, so a false
  positive cannot permanently kill a job"). Injected data without skills **also** scans `user_prompt` STRICT.
- **Non-obvious (6):** `_guard_job_credential_exfil` **fails closed** on a validator error, but only for
  jobs that actually have a `base_url` override — "a job without one cannot exfiltrate via this path, so
  it still runs." It is described as a "runtime backstop" for jobs persisted before the create/update guard.
- **Non-obvious (7):** `_block_and_pause_job` — "an unrunnable job left enabled re-fires every tick
  forever; `paused_at`/`paused_reason` give an auditable record."
- **Non-obvious (8):** the **stable-prefix cache boundary** — skill blocks are stable per job config, the
  appended instruction is volatile per run, and the boundary is *registered* with the cache planner only
  if the scanner did not mutate the bytes ("the scanner may mutate the bytes; mismatch → whole-message caching").
- **Steal-able:** *the length-framed run document* (a machine-readable offset for the answer, so a
  prompt that quotes the heading cannot be confused with the answer) and *the two-tier injection scan*.

### `cron/scheduler_tick.py` (172 lines)

- **Purpose:** in-process tick admission and dispatch; job execution stays in `scheduler.py`.
- **Key abstractions:** `tick(verbose=True, adapters=None, loop=None, sync=True, *, can_dispatch=None,
  headless=False)` (`:33`), `_acquire_tick_lock_or_degrade(_sched)`, `_advance_or_drop_recurring(_sched, due_jobs)` (`:62`),
  `_pre_dispatch_housekeeping(_sched, headless)` (`:75`), `_tick_admitted(...)` (`:92`),
  `_log_tick_yield_once(reason)`.
- **Non-obvious (1):** **the stale-code yield gate runs BEFORE the lock race** — "A process whose checkout
  was updated under it serves mixed `sys.modules` (jobs die on ImportErrors); if a fresher gateway holds
  the runtime lock, ITS ticker dispatches." It raises `CronTickYielded` (not returns) so the status
  marker records it and `hermes cron status` is not green.
- **Non-obvious (2):** `_acquire_tick_lock_or_degrade` distinguishes *lock contention* from *an unwritable
  store*: an `OSError` whose errno is not in `store_health.UNWRITABLE_ERRNOS` is re-raised (EMFILE/ENFILE
  "stay a FAILED tick (#87644)"), while an unwritable store degrades the store and the tick returns 0.
- **Non-obvious (3):** `_advance_or_drop_recurring` persists the recurring jobs' advance **before any
  runs**; when the store refuses it, it **drops those jobs** — "no durable advance -> a crash mid-run
  would re-fire them, so skipping is the at-most-once side". One-shots still go through their own claim.
- **Non-obvious (4):** `_pre_dispatch_housekeeping` runs the admission reconcile, the legacy drain and the
  dead-owner reap **under the tick lock, before due jobs are read**; the legacy drain is wrapped so "it
  never let it stop due jobs below".
- **Non-obvious (5):** an idle tick skips config load and pool setup entirely ("#33612 — the gateway ticker
  calls tick(verbose=False) every 60s, so idle ticks previously fell through to load_config()") but still
  reaps MCP orphans.
- **Non-obvious (6):** the ESTOP gate — `check_paused("cron", ...)` returns 0 *before* any dispatch, and
  "skip dispatch, never touch in-flight runs".
- **Steal-able:** *the ordering of a tick — yield gate → lock → housekeeping → due scan → persist advance → dispatch* —
  and the rule that the persisted advance is the at-most-once boundary.*

### `cron/blueprint_catalog.py` (730 lines)

- **Purpose:** "Automation Blueprints — one slot-schema definition per automation that every surface renders
  natively: dashboard form, pre-filled slash command, agent seed prompt, docs deep-link."
- **Key abstractions:** `AutomationBlueprint` (`:67`), `BlueprintSlot`, `BlueprintFillError`,
  `WEEKDAY_PRESETS`, `CATALOG` (16 built-ins), `list_blueprints`, `get_blueprint`,
  `blueprint_form_schema` (`:589`), `blueprint_slash_command`, `blueprint_deeplink`, `_humanize_schedule`,
  `blueprint_catalog_entry`, `_resolve_schedule` (`:690`), `fill_blueprint` (`:744`).
- **Non-obvious (1):** **"Users never type raw cron"** — `schedule_template` fixes the recurrence; only
  human parts (time, weekdays) are slots. The slot is a *typed* field with `options`, `default`,
  `optional`, and a `strict` flag.
- **Non-obvious (2):** the `strict` flag distinguishes a closed set from a *suggestion* set: the `deliver`
  slot is `strict=False` because "the real set of valid platforms depends on the user's configured
  gateways and is validated downstream by the cron scheduler".
- **Non-obvious (3):** `fill_blueprint` **rejects unknown slot names** — "a typo'd `tiem=07:15` must not
  silently create a job with the default time" — and raises `BlueprintFillError` naming the slot, so a
  form can show a field error and the agent knows what to ask.
- **Non-obvious (4):** a free-text `schedule` slot passes through verbatim ("full flexibility") and
  bypasses `_resolve_schedule`'s placeholder filling.
- **Non-obvious (5):** the `hydration-nudge` blueprint carries a **correction comment** in the source:
  "cron minute-field steps (*/90) wrap per hour — */90 and */120 both degrade to hourly. Use an
  hour-field step instead so the chosen cadence is what actually fires." A whole class of scheduler bugs
  was found by the catalog author and encoded as a note next to the template.
- **Non-obvious (6):** the *monitor* blueprints (`price-watch`, `competitor-watch`) put the whole watch
  contract in the prompt: "Compare the normalized all-in price/availability against stored state,
  suppress duplicate alerts, and **never overwrite last-known-good state with a failed fetch**."
- **Steal-able:** *a typed slot schema rendered identically into a form, a slash command, a deep link and
  an agent prompt* — one definition, four surfaces. This is exactly the shape August Trading needs for
  "an analyst-authored scheduled scan" without letting anyone write a cron expression.

### `cron/scheduler_provider.py` (592 lines)

- **Purpose:** the `CronScheduler` provider interface — the *trigger* half of the subsystem.
- **Key abstractions:** `CronScheduler` (ABC, `:136`) with `name` / `start` abstract and everything else
  default-safe (`is_available`, `stop`, `on_jobs_changed`, `register_job`, `recover_interrupted`,
  `supports_force_fire`, `fire_due`, `claim_fire`, `fire_claimed`, `reconcile`);
  `InProcessCronScheduler` (`:430`) with `_start_multiplex` (`:534`);
  `resolve_cron_scheduler()` (`:387`), `scheduler_for_profile_mode(...)`, `fire_overdue_jobs(...)` (`:293`),
  `_backoff_wait_seconds` (`:28`), `_note_tick_failure`, `routed_profile_fire` (`:95`),
  `_existing_profile_homes`, `_profile_cron_scope`, `provider_supports_force_fire`,
  `provider_supports_split_fire`.
- **Non-obvious (1):** the module docstring states the growth rule: "EXPERIMENTAL: shape MAY change until a
  second provider validates it; growth MUST be additive (optional method with a default), never a changed
  `start()` signature or new abstractmethod. **Providers decide only *when* a job fires** — execution +
  delivery stay in `cron.scheduler.run_job` / `_deliver_result`; never reimplement them."
- **Non-obvious (2):** the **two-phase fire contract**: `claim_fire` (durable store CAS + an audit attempt)
  then `fire_claimed` (run the exact snapshot off-thread). "Transports call this synchronously before
  acknowledging, then pass the exact snapshot to `fire_claimed` off-thread." `provider_supports_split_fire`
  keeps a legacy provider that only overrides `fire_due` on the old path — "routing around the override
  would drop its custom claim/re-arm/telemetry behavior".
- **Non-obvious (3):** `fire_due`'s `manual` flag: "the claim must not stamp `next_run_at` as the
  occurrence, or that slot is skipped when it arrives. Webhook and misfire fires arriving at/after the
  due instant run that slot and keep the stamp; a fire arriving BEFORE the stored instant is off-tick
  like `manual` and stays occurrence-free."
- **Non-obvious (4):** **the misfire backstop** (`fire_overdue_jobs`, `:293`): "fire jobs whose external
  HTTP fire never arrived, else `next_run_at` stays parked in the past forever." It waits out
  `cron.misfire_grace_minutes` "so the external retry gets first right", refuses to resurrect one-shots
  past the one-shot grace ("The misfire backstop must not resurrect them hours late after downtime —
  that's #93526"), and routes through the provider's own two-phase path so the store CAS de-duplicates.
- **Non-obvious (5):** the **exponential EMFILE backoff** (`_backoff_wait_seconds`, `:28`): "Base is the
  tick interval (60s by default); each consecutive EMFILE failure doubles the wait, capped here so a
  still-alive-but-exhausted gateway never sleeps longer than this between recovery attempts." Any other
  failure *resets* the counter — "backoff is reserved for the EMFILE storm."
- **Non-obvious (6):** `InProcessCronScheduler.start` catches **`BaseException`**, not `Exception`: "a
  `SystemExit` must not silently kill the ticker; `KeyboardInterrupt` is caught on purpose — shutdown is
  driven by `stop_event`." It records the liveness marker on **every** iteration but the *success* marker
  only on a clean tick, so status can tell "alive but failing every tick" from "actually firing jobs".
- **Non-obvious (7):** `_start_multiplex` is **one ticker, sequentially**, under `_profile_cron_scope(home)`
  per profile; a per-profile exception is isolated ("Yield for THIS profile only; one fresh gateway must
  not stop others"), and the per-profile heartbeat records *that profile's* outcome so "a yielding profile
  does not darken healthy siblings."
- **Non-obvious (8):** `_existing_profile_homes` drops homes no longer on disk: "ticking/heartbeating a
  deleted home recreates its `cron/` workspace … so the 'deleted' profile silently comes back on disk
  and in `hermes profile list` (#47368)."
- **Steal-able:** *the provider interface that separates "when" from "how"*, plus the misfire backstop
  for a webhook-driven trigger.*

### `cron/scheduler_script.py` (529 lines)

- **Purpose:** cron pre-run script execution — timeouts, Windows venv bootstrap, process-tree termination,
  and the claim-heartbeat thread that keeps a long script's run claim alive.
- **Key abstractions:** `_get_script_timeout()` (`:67`), `_get_media_send_timeout`, `_get_session_db_timeout`,
  `_timeout_from_env_or_config(env_var, config_key, parse, label)`, `_posix_cron_script_argv`,
  `_windows_cron_python_invocation`, `_windows_cron_bootstrap_argv`, `_terminate_cron_script_tree` (`:253`),
  `_drain_script_pipes`, `_resolve_script_path` (`:323`), `_resolve_cron_interpreter`,
  `_script_argv` (`:400`), `_run_job_script` (`:432`), `_start_heartbeat_thread`,
  `_run_job_script_with_claim_heartbeat` (`:553`).
- **Non-obvious (1):** **the script path is contained**: "Scripts MUST resolve inside `HERMES_HOME/scripts/`
  (relative, absolute and `~` paths are all validated — path traversal / absolute-path injection)". A NUL
  byte is rejected eagerly because "on Windows the Path operations raise `ValueError` *after* `expanduser`
   … reject eagerly so both platforms fail cleanly instead of crashing the scheduler."
- **Non-obvious (2):** the **interpreter** field is checked at *run* time, not create time ("a user venv can
  be rebuilt or moved while the job lives"), must be absolute ("Bare names like 'python3' are not stable
  across PATH changes"), and must look like Python — "the lifecycle guard classifies `.py` scripts as Python
  and skips its shell reference walk, so `interpreter=/bin/bash` would run an unscanned `.py` body as shell."
  `pythonw` is refused "because it discards captured output (an agent job would go silently quiet)."
- **Non-obvious (3):** the **shebang is deliberately NOT honoured** for `.py` scripts ("small, auditable
  surface") — the interpreter is chosen by extension.
- **Non-obvious (4):** the timeout kills the **whole process tree**: `kill_process_tree` "snapshots
  descendants BEFORE signalling" because "killpg only reaches the script's own process group — a grandchild
  that called `setsid` … escapes it and keeps running after the job reports failure (#71148 / #59549)."
- **Non-obvious (5):** **the process cwd is never mutated** — "an `os.chdir()` would leak into concurrent
  gateway sessions"; the job's `workdir` is the *subprocess* cwd only.
- **Non-obvious (6):** stdout/stderr are **redacted before ANY return path**, and a redaction failure
  replaces the payload entirely ("[REDACTED - redaction failed]") rather than letting an unscanned value out.
- **Non-obvious (7):** the **claim heartbeat**: "A long script can outlive the stale-claim TTL; without a
  heartbeat another scheduler would re-dispatch the one-shot." The owner is captured from the dispatched
  job, "never re-read, so a stale runner cannot extend a replacement owner's claim."
- **Steal-able:** *contain every script path inside one directory, refuse a bare interpreter name, and
  kill the process tree on timeout* — the three rules that keep a scheduled script from becoming a
  sandbox escape.*

### `cron/lifecycle_guard.py` (1293 lines)

- **Purpose:** refuse a cron job whose prompt or script would restart/stop the gateway that runs it
  (a SIGTERM-respawn loop under launchd/systemd supervision).
- **Key abstractions:** `GatewayLifecycleBlocked(ValueError)`; the branch regex
  `_GATEWAY_LIFECYCLE_PATTERN` (destructive `hermes gateway` ops / `launchctl` / `systemctl` / `pkill`);
  `contains_gateway_lifecycle_command(text)` (`:394`); `contains_host_interpreter_kill(text)` (`:202`);
  `contains_launchctl_submit_command(command)` (`:704`); `_mask_data_sink_arguments(text)` (`:721`);
  `_expand_candidate_path(candidate)` (`:806`); `_LifecycleScanBudget` (`:475`);
  `_read_referenced_script_unlocked(path, max_bytes=...)` (`:989`); `scan_gateway_lifecycle(command, cwd, read_remote_script)`
  (`:1184`); `check_gateway_lifecycle(prompt, script)` (`:1231`).
- **Non-obvious (1):** the patterns are **command-shaped and anchored on concrete identifiers**, "so they
  cannot fire on prose". Branch A excludes `start` ("starting from inside a gateway is benign"), and
  Branch B includes `submit`/`bootstrap` because "a blocked direct restart/kill gets laundered into a
  persistent restart loop instead (#62891)".
- **Non-obvious (2):** **Branch E** targets *process killers aimed at the interpreter image*: a supervised
  gateway is literally `python.exe`, so `taskkill /F /IM python.exe` carries no hermes/gateway token yet
  terminates it (#113667). The check is **token-aware**, not a line regex: "option VALUES are never read
  as targets (`pkill -u <user> chrome`)".
- **Non-obvious (3):** the guard **recursively scans referenced scripts** — `sh -c` payloads, `source`,
  `.` and directly-executed scripts — up to depth 8 and 1 MiB, with a **shared work budget** that
  "fails closed" when exhausted (an unscanned script could hide a lifecycle command) and is logged at
  WARNING "so an operator can tell it from a real block".
- **Non-obvious (4):** the **data-sink exemption**: "The regex cannot tell an EXECUTED lifecycle command
  from the same characters as *data* (a grep pattern, a SQL literal)". `_mask_data_sink_arguments`
  replaces the arguments of `grep`/`sqlite3`/`psql`/… with a placeholder, but "masking is skipped when
  the line pipes into a shell/interpreter, any argument carries an execution marker, or the line cannot be
  tokenized. Masking can only ALLOW what the plain regex would block, never block more."
- **Non-obvious (5):** the **inert-heredoc stripper** runs first: a quoted-delimiter heredoc body is
  documentation, not a command — "a runbook line 'a human can run: hermes gateway restart' inside such a
  body is documentation, not a command this shell will execute" (#88336).
- **Non-obvious (6):** the **cloud-placeholder refusal**: a macOS FileProvider path is never opened, "not
  even to check hydration — because an evicted placeholder's `open()` can hang preflight" (#88052). The
  failure is attributed with the *real* reason rather than implying a dangerous lifecycle command.
- **Non-obvious (7):** the guard is **total by construction**: "never raises… a guard crash propagates out of
  `tools/terminal_tool.py` and breaks every terminal command until the gateway restarts (#77780, #78256),
  which is strictly worse than either verdict." It falls back to the direct-scan verdict, and finally to
  the raw regex.
- **Non-obvious (8):** `check_gateway_lifecycle` **concatenates the prompt and the script text** "so a
  command cannot slip through by being split across the two."
- **Steal-able:** *a "you may not kill the thing that runs you" guard, applied at creation AND at run
  time, with a recursive scan of referenced scripts and a fail-closed budget.*

### `cron/scheduler_delivery.py` (1923 lines)

- **Purpose:** target resolution (origin/home/explicit/bot-chat), transcript mirroring and session seeding,
  live-adapter / relay / standalone send lanes, and `_deliver_result`.
- **Key abstractions:** `_resolve_origin(job)`, `_target_mirror_eligible(...)` (`:129`),
  `_redact_cron_payload(text, what)` (`:163`), `_maybe_mirror_cron_delivery(...)`, `_seed_cron_session(...)` (`:266`),
  `_seed_cron_thread_session`, `_seed_cron_channel_session`, `_cron_job_origin_log_suffix`,
  `_get_home_target_chat_id`, `_iter_home_target_platforms`, `_resolve_single_delivery_target`,
  `_delivery_lane_value(job, for_failure=...)`, `_resolve_delivery_targets(job, for_failure=...)` (`:871`),
  `_send_media_via_adapter`, `_confirm_adapter_delivery(...)` (`:985`),
  `_live_send_text(...)` (`:1266`), `_live_send_media`, `_seed_live_delivery_sessions`,
  `_deliver_via_live_adapter(...)` (`:1438`), `_standalone_send`, `_queue_for_live_reconnect`,
  `_deliver_standalone(...)` (`:1599`), `_prepare_target_delivery(...)` (`:1636`),
  `_deliver_result(job, content, adapters, loop, for_failure=...)` (`:1765`).
- **Non-obvious (1):** **the redaction chokepoint** — `_redact_cron_payload` is applied at *every* outward
  lane (chat message, session mirror, bot-chat turn) with `force=True`, "because this is a safety boundary,
  not logging: the `security.redact_secrets` preference governs how much is scrubbed from the user's own
  logs and must not be able to turn scrubbing off on the way out to a chat." A redaction failure replaces
  the payload entirely.
- **Non-obvious (2):** the **mirror-eligibility ladder** (`_target_mirror_eligible`, `:129`): origin →
  always; `origin_fallback` / `home` → the global/per-job knob; `explicit` (`platform:chat_id`) → **only**
  with per-job `attach_to_session: true` — "the global flag must never write transcripts into arbitrary
  explicitly-addressed chats"; untagged broadcast expansions (`all`) → never.
- **Non-obvious (3):** the **mirror is a USER-role turn, not an assistant turn**: "an assistant-role mirror
  lands assistant→assistant and breaks strict alternation; consecutive user turns merge safely." The
  label prefix preserves the "this came from cron" context "that the dropped SQLite mirror metadata
  would otherwise lose on replay."
- **Non-obvious (4):** the **mirror payload is redacted separately** from the message payload: "Derived from
  the raw `content`, so it does NOT inherit the redaction above. Without this, enabling the mirror writes
  an unredacted credential into the session transcript even though the chat message itself was clean — and
  a transcript outlives the message."
- **Non-obvious (5):** the **delivery confirmation rule** (`_confirm_adapter_delivery`, `:985`): `None` or a
  missing `success` is **not** success; `delivered: False` rejects even with a truthy `success`; and a
  success with no `message_id` and no `raw_response` is logged as **UNVERIFIED** and recorded in
  `last_delivery_unverified`. "A live adapter that returns `None` … must NOT be treated as success —
  doing so causes the scheduler to log 'delivered to <chat>' while the gateway never actually sees the
  message (#47056)."
- **Non-obvious (6):** the **live-send timeout distinguishes "not started" from "in flight"**: "Slow
  confirmation != failure. Never started (loop wedged): nothing was sent, so fall through to standalone or
  it is silently dropped. Started: in flight … leave it running; a standalone resend would DUPLICATE."
  `PartialDeliveryError` is also treated as *delivered* — "the head of a split send is already on screen:
  a standalone resend would duplicate it."
- **Non-obvious (7):** the **relay lane fails closed**: "Relay owns the destination and credential; a native
  retry could duplicate — fail closed." And the log line differs so it does not promise a fallback.
- **Non-obvious (8):** `deliver=origin` with no resolvable origin and no home channel is **not an error**
  ("CLI-created jobs never capture a {platform, chat_id} origin, so failing here would make every CLI
  `deliver=origin` job emit a spurious 'no delivery target resolved' error on every run (#43014)").
- **Non-obvious (9):** the **policy-drop accounting**: "text delivered but attachment lost is not ok" —
  every dropped attachment becomes a `delivery_error` string, and the run status says so.
- **Steal-able:** *the delivery outcome must be provable.* "Delivered" means a message id, a raw response,
  or an explicit UNVERIFIED marker — never a bare `None`. For a trading app that pushes "TP HIT" alerts,
  a phantom "delivered" is worse than an honest "unverified".

### `cron/jobs.py` (3484 lines) — the job store

- **Purpose:** the durable job store (`~/.hermes/cron/jobs.json`), the schedule grammar, the due scan,
  the claim protocol and the run bookkeeping.
- **Key abstractions:** `_CronStorePaths` + `_current_cron_store()` + `use_cron_store(home)`;
  `_jobs_lock()` (`:250`); `_fire_job_lock(job_id)` (`:344`); `fire_claim_fence(job_id, expected_owner=...)`;
  `parse_schedule(schedule)` (`:783`); `compute_next_run(schedule, last_run_at)` (`:1174`);
  `_compute_grace_seconds(schedule)` (`:937`); `_classify_dispatch_lateness`;
  `_classify_stale_cron_next_run(...)` (`:1117`); `load_jobs()` (`:1352`);
  `_save_jobs_unlocked(...)` (`:1550`); `_merge_unexpected_disk_jobs(...)` (`:1508`);
  `_with_job(job_id, fn, missing)` (`:1610`); `create_job(...)` (`:1788`); `update_job(job_id, updates)` (`:2086`);
  `pause_job` / `resume_job` (`:2141`) / `rearm_oneshot` (`:2225`) / `remove_job` (`:2260`);
  `mark_job_run(...)` (`:2425`); `_advance_after_run(job, now, ladder_rung=False)` (`:2374`);
  `claim_dispatch(job_id)`; `claim_job_for_fire(...)` (`:2717`); `heartbeat_fire_claim`;
  `advance_next_runs`; `get_due_jobs()` (`:2858`); `_normalize_due_scan_records` (`:2902`);
  `_recover_missing_next_run` (`:2942`); `_repair_timezone_shifted_cron` (`:2996`);
  `_rearm_stale_error_recurring` (`:3021`); `_reanchor_stale_cron` (`:3060`);
  `_fast_forward_missed_recurring` (`:3098`); `_retire_expired_oneshot` (`:3129`);
  `_oneshot_dispatch_limit_reached` (`:3152`); `_restore_unclaimed_slot` (`:3194`);
  `_evaluate_due_job(...)` (`:3217`); `_get_due_jobs_locked()` (`:3300`); `save_job_output(job_id, output)` (`:3384`);
  `_job_output_dir(job_id)` (`:427`); `_preserve_file_ownership` (`:588`).
- **Data flow:** a tick calls `get_due_jobs()` → `_get_due_jobs_locked()` reads the store under
  `_jobs_lock()`, runs the per-job `_evaluate_due_job()` ladder (which may *repair* records and persist
  them in one save), and returns the due snapshots. Each due job is then claimed
  (`claim_job_for_fire` → a fire fence + the store lock → a `fire_claim` stamp + the occurrence
  identity), executed, and settled by `mark_job_run()` (which advances the repeat counter, recomputes
  `next_run_at`, and may park a retry rung or a quota hold).
- **Non-obvious (1):** **the schedule grammar is a real grammar.** `parse_schedule` (`:783`) accepts
  `"30m"` (recurring interval), `"every 30m"`, `"in 30m"` (one-shot by duration), `"every monday 9am"`
  and `"weekdays at 9am"` (natural language → a 5-field cron expr), `"0 9 * * *"`, and an ISO timestamp.
  A bare duration is recurring; `"in 30m"` is one-shot — "per the documented tool contract". The error
  message enumerates all five forms.
- **Non-obvious (2):** **the timezone contract is explicit.** A naive ISO timestamp becomes aware **in the
  configured Hermes timezone**, not the server's: "Naive timestamps become aware in the CONFIGURED Hermes
  timezone (not server-local) … while `now()` runs in Asia/Kolkata, the stored instant would land hours
  off from the user's wall-clock intent — far enough that one-shots never become due and recurring jobs
  fire at the wrong time (#51021)." And `compute_next_run` (`:1174`) anchors cron matching to the configured
  zone's **wall clock**, and tries **both folds** of each candidate ("a repeated hour has two instants, so
  two candidates always suffice") so the DST fall-back hour cannot yield a "next run" in the past.
- **Non-obvious (3):** **the catch-up window is half the period, clamped to [120 s, 2 h]** (`:937`):
  "so daily jobs catch up but frequent jobs fast-forward quickly." `cron.catch_up_missed: false` skips the
  missed occurrence **with a logged reason** and a `record_cron_missed` metric.
- **Non-obvious (4):** **the store is auto-repaired on load** (`:1352`): a bare list, an id-keyed map, a
  non-list `jobs` field, junk entries and a non-int `repeat.completed` are all normalised, and the
  repair is persisted so it does not repeat every tick. "one junk entry would crash the whole tick and
  freeze every healthy sibling job."
- **Non-obvious (5):** **the save is a shrink-merge, not an overwrite** (`:1550`, `:1508`): the payload is
  staged to a temp file, re-peeked, and merged with any on-disk job the payload does not know about —
  "under the degraded flock-timeout path a stale writer would otherwise clobber concurrent creates".
  A **corrupt** store refuses the write outright ("fail closed: writing over an unknown baseline would
  silently drop every job in it").
- **Non-obvious (6):** the **stamp fast-path** (`:1455`): the load records `(mtime_ns, size, ino)` *before*
  reading, so a mid-read sibling write forces the merge ("stamping after would certify an unseen write").
  The stamp is **invalidated, never refreshed**, after a save ("a refresh would let a nested save certify
  disk against an OUTER caller's stale payload").
- **Non-obvious (7):** **the lock degrades rather than dies** (`:250`): a `flock` timeout logs loudly and
  falls back to in-process-only locking — "a briefly torn cross-process write beats a dead scheduler."
  The per-job **fire fence** (`:344`) is different: "Fails closed when cross-process locking is unavailable",
  because it guards an external side effect.
- **Non-obvious (8):** **`_preserve_file_ownership`** (`:588`): an atomic replace makes the file owned by
  the writer's euid, so a root CLI write against the unprivileged gateway's store would flip `jobs.json`
  to root:root 0600 and lock the ticker out.
- **Non-obvious (9):** **the fire claim carries a per-acquisition token** (`f"{_machine_id()}:{uuid4()}"`,
  `:2717`): "a process may legitimately reclaim its own stale lease, and the previous runner must not
  heartbeat the new claim merely because hostname + PID match." And a claim that arrives **more than
  `FIRE_CLAIM_SKEW_SECONDS` before** the stored occurrence is treated as off-tick and gets **no**
  occurrence identity — "a manual run at 19:53 consumed the next day's 19:00 occurrence" (2026-09-08).
- **Non-obvious (10):** **the due-scan ladder is ordered and each step is a distinct policy**
  (`:3217`): restore an unclaimed slot → recover a missing `next_run_at` → check the ledger for a
  completed occurrence → repair a timezone shift → re-arm a stale-error recurring job → (once due)
  re-anchor a stale cron instant → fast-forward a missed recurring run → retire/guard a one-shot →
  stamp the run claim and the `pending_slot`. A `cron` instant that is off the current lattice is
  re-anchored **without firing** — unless it is a quota recovery or a retry rung, which are
  *deliberately* off-lattice and **do** fire once ("`cron.off_lattice_fire`").
- **Non-obvious (11):** **`_advance_after_run`** (`:2374`) never silently disables a recurring job:
  "Recurring jobs must NEVER be silently disabled: that turns a missing runtime dep into 'job completed'
  and the user's schedule quietly goes off (#16265)." A recurring job whose next run cannot be computed
  goes to `state=error` and stays enabled, and `_is_recoverable_error_job` keeps it eligible for
  self-heal.
- **Non-obvious (12):** **the sticky failure stamp** (`_record_run_outcome`): `last_failure` is
  "**NOT** cleared by a later success (#118354) … a monitor sampling `jobs.json` then sees a permanently
  green job." `last_status` and `failure_streak` do reset; `last_failure` does not.
- **Non-obvious (13):** **the one-shot grace is a contract at four doors** — create, update, resume and the
  due scan all refuse a one-shot outside `ONESHOT_GRACE_SECONDS = 120`, and the due scan *retires* it
  with a **diagnostic file** rather than deleting it silently ("else it would just vanish").
- **Non-obvious (14):** **the per-job containment**: the due scan wraps each job in a `try` and logs
  "Skipping malformed cron job %r during due scan" — "one malformed record must never abort the whole
  scan."
- **Non-obvious (15):** **output retention is capped** (`:3384`): "Keep the most recent N files per job"
  (`cron.output_retention`, default 50) because "a frequently-scheduled job on a long-running deploy
  accumulated one file per run forever and could fill the disk (#52383)."
- **Surprising:** `_job_output_dir` (`:427`) rejects any `job_id` that is not a single safe path
  component — "`id` is a path component under `OUTPUT_DIR`, so an update could leak `../escape`" — and
  `id` is in `_IMMUTABLE_JOB_FIELDS` for the same reason.

### `cron/scheduler.py` (4432 lines) — the run engine

- **Purpose:** the execution half: the tick's dispatch path, the agent run, the delivery hand-off, the
  restart-safe worker, the in-flight guard, the incident/alert composition and the provider façade.
- **Key abstractions:** `CronTickYielded` + `_should_yield_tick_to_fresh_gateway()` (`:218`);
  `_resolve_cron_disabled_toolsets(cfg)` (`:414`); `_resolve_cron_enabled_toolsets(job, cfg)` (`:456`);
  `_summarize_cron_failure_for_delivery(job, error)` (`:256`); `_repeat_alert_withheld(incident)` (`:336`);
  `_upsert_incident_for_failure(job, error, output_file=...)` (`:355`); `_resolve_incidents_for_recovered_job`;
  `_mark_incident_alerted`; `_failure_streak_nudge(job)` (`:133`);
  `_inflight_key(job_id, home)` + `_remember_inflight_home` / `_inflight_home_path`;
  `try_register_running_job(job_id, owner=..., future=...)` (`:807`);
  `release_running_job(job_id, home=..., owner=...)` (`:837`);
  `sweep_stale_inflight(due_jobs)` (`:1046`); `mark_running_jobs_interrupted(reason, only_owners=...)` (`:1113`);
  `get_wedged_job_ids()`; `get_restart_wait_cron_counts()`; `is_job_running(job_id, home=...)`;
  `_get_parallel_pool(max_workers)` (`:1211`); `discard_parallel_pools(home_keys)`;
  `_cron_inactivity_seconds()` (`:1197`); `drain_delivery_queue(adapters, loop)` (`:1367`);
  `_run_no_agent_job(...)` (`:1522`); `_apply_monitor_gate(...)` (`:1577`); `_load_cron_job_config`;
  `_preflight_or_block(...)` (`:1702`); `_resolve_job_runtime(job, job_id, jc)` (`:1760`);
  `_open_cron_session_db(job)` (`:1866`); `_run_agent_with_watchdog(...)` (`:1957`);
  `_finalize_cron_session(...)` (`:2136`); `_CronRunScope`; `_FireAudit`; `run_job(...)` (`:2561`);
  `_run_with_fire_claim_heartbeat(job, run)` (`:2732`); `run_one_job(...)` (`:2816`);
  `_compose_run_delivery(...)` (`:2946`); `_FireOwnership`; `_RunDelivery`; `_save_compose_deliver(...)` (`:3072`);
  `_install_fire_secret_scope()` (`:3214`); `_run_one_job_body(...)` (`:3285`);
  `_wait_for_external_cron_worker(...)` (`:3503`); `_launch_external_cron_worker(job)` (`:3609`);
  `_run_external_worker_payload(payload_path, ack_path)` (`:3850`);
  `create_job_with_scheduler_registration(**kwargs)`; `CronSchedulerRegistrationError`;
  `_acquire_tick_lock(lock_file)` (`:4112`); `_maybe_reap_dead_owners()` (`:4158`);
  `_process_due_job(...)` (`:4236`); `_submit_with_guard(...)` (`:4261`).
- **Data flow (one fire):** `_submit_with_guard` registers the in-flight key → creates the durable
  execution row → submits to the per-profile pool → `run_one_job` → (managed topology) hands the fire to
  a restart-safe external worker via a payload file + an acknowledgement file, or runs in-process →
  `_run_one_job_body` installs the profile secret scope, claims the finite one-shot's dispatch
  (`claim_dispatch`), wins the `claimed → running` CAS, runs the job (`run_job`), and then
  `_save_compose_deliver` saves the run document, composes the notice and delivers it **under the
  fire-claim fence** → `finish_completed_run` writes the job's terminal state and the ledger row.
- **Non-obvious (1):** **the in-flight key is `(home key, job id)`** (`:790`): "ONE gateway process ticks
  every profile, so a job id alone is not unique: two profiles routinely carry identically named jobs
  (`daily-brief`) and sharing a key made the second profile's run read as a duplicate of the first and
  get skipped." The public accessors still report bare job ids "so host-wide consumers (shutdown drain,
  idle-exit, metrics) see the union across profiles", while the *liveness* consumers must ask
  `is_job_running(job_id, home=...)` — "one process ticks every profile, so a `daily-brief` running in
  profile A would otherwise report profile B's idle `daily-brief` as running."
- **Non-obvious (2):** **`release_running_job` must be given the registering home** (`:837`): "The scope
  is a ContextVar the ticker binds per profile: a pool worker releasing in a `finally` outside `ctx.run`
  resolves the default (launch) home instead, so the discard misses the real key and every secondary
  profile's claim leaks." And `hermes_home_key` normcases, so `Path(key[0])` is a case-folded path that
  matches nothing on disk — `_inflight_home_path` keeps the real path.
- **Non-obvious (3):** **the stale-code yield** (`:218`): a process whose checkout was updated under it
  serves mixed modules, so it yields the tick to a fresher gateway that owns the profile. Every probe
  failure returns None ("yielding is a certainty claim, never a guess"), and the question is asked **per
  profile** because "one process multiplexes every profile".
- **Non-obvious (4):** **the toolset resolution fails closed** (`:456`): "A lookup failure fails CLOSED:
  the run errors out. … Never `None`: AIAgent reads `None` as 'every toolset', so an unreadable
  `platform_toolsets.cron` restriction would hand an unattended job the full default set (#111380)."
  And an **explicitly empty** per-job allowlist means "no toolsets at all" — "it is falsy, so it must be
  compared with `is not None`, else it fell through to the config default and widened an unattended job
  back to every toolset (#82010)."
- **Non-obvious (5):** **the `cronjob` toolset is disabled by default** (`:414`) — "loop prevention, not a
  security boundary — `cron.allow_agent_scheduling: true` lifts only that" — while `messaging` and
  `clarify` are always disabled (interactive).
- **Non-obvious (6):** **the alert pipeline** (`:355`, `:336`, `:256`): a failure is upserted as an
  **incident**; the per-run ping is **withheld** when the signature is `closed` (the operator acked it)
  or `alerted` inside `cron.failure_repeat_alert_hours` (default 6 h) — "a ping already went out". The
  notice copy is chosen by *shape first*: a script timeout is recognised before the provider classifier
  ("their text can contain 'timed out' and would otherwise be blamed on the model service"), and the
  inactivity watchdog is recognised before the provider classifier too ("a stuck `terminal` call was
  blamed on the provider and the operator debugged the wrong system").
- **Non-obvious (7):** **an agent may declare its own failure** with a `[CRON_FAILURE]` first line; the
  evidence is then delivered **verbatim** — "the summarizer's substring heuristics would re-diagnose it
  ('timed out' → blame the model service, '401' → 'sign in again') and attach the wrong remediation."
  The marker is strict: only an exact standalone first line counts.
- **Non-obvious (8):** **the "unknown" path is fail-closed** (`:3285`): a `CronExecutionUnknown` pauses the
  job and records the exact pause identity — "Never fall back to in-process execution on an uncertain
  handoff: that could duplicate side effects."
- **Non-obvious (9):** **the fire-claim heartbeat confirms a miss** (`:2732`): "One miss is a sample, not a
  verdict (#113357): a latch cancels the live agent run and ends the lease refresh, so confirm before
  acting on it." And a heartbeat that cannot be renewed within `3 ×` the heartbeat interval interrupts
  the run — "interrupting uncertain run".
- **Non-obvious (10):** **the side-effect fence wraps the save AND the delivery** (`:3072`): "The queue row
  IS the send: publish it under the same fence as a direct send, so a claim stolen after the `lost()`
  sample above cannot leave this stale fire's notice queued."
- **Non-obvious (11):** **the interrupted flag is token-scoped** (`:1113`): "Token keying keeps an
  interruption scoped to that exact execution: a later run of the same job ID (recurring jobs reuse the
  ID every fire) must not inherit the stale flag."
- **Non-obvious (12):** **the delivery lane is per-outcome**: an agent-declared failure, a blocked config
  and a provider failure each have their own composition path, and the `failure_deliver` override is
  honoured for all of them.
- **Non-obvious (13):** **the restart-safe worker's ack is published by atomic rename** (`:3850`): "Writing
  `ack_path` in place … let `O_CREAT` make the empty file visible to the scheduler's exists()-then-read
  polling loop before the JSON body was written, occasionally handing it a 0-byte file."
- **Non-obvious (14):** **the worker payload is written with `O_EXCL`** and the ack is verified to carry
  the right `execution_id`; a mismatch is "ownership-uncertain" and the waiter *raises* rather than
  re-running in-process.
- **Non-obvious (15):** **`_acquire_tick_lock` distinguishes contention from failure** (`:4112`): "A real
  OSError (esp. EMFILE/ENFILE) must NOT pass as contention — the scheduler would look healthy while no
  job runs — so it is re-raised for the ticker to record a FAILED tick."
- **Non-obvious (16):** the **ticker heartbeat carries `<epoch> <pid>`** (in `jobs.py`) so a reader can
  check the *writer* is alive — "a killed ticker's last stamp reads fresh for ~3 minutes, so a reader
  with no other proof of the scheduler checks the writer is alive."
- **Non-obvious (17):** **`_run_agent_with_watchdog`** (`:1957`) runs the agent on a worker thread and
  polls it in 5 s slices, so it can (a) fire the idle watchdog, (b) heartbeat the one-shot run claim, and
  (c) stamp the ledger's progress — all from the *same* loop that watches the future.
- **Non-obvious (18):** **`_teardown_cron_agent` is bounded** (`:2704`): the teardown runs in a *daemon*
  thread with a timeout, "so the gateway can still shut down" and "a damaged connection leaks at most
  one worker."
- **Surprising:** `run_job` **tears the agent down only after delivery** — the agent is handed back
  through a `defer_agent_teardown` list so "delivery needs a live async client" (#58720).

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `cron/scripts/__init__.py` | One-line docstring: the scripts shipped with the cron subsystem, runnable via `python3 -m cron.scripts.<name>`. |

### Tier 3 — skipped with a reason

None. Every file in the shard was read in full (the two largest, `cron/jobs.py` and `cron/scheduler.py`,
were read in 5 sequential chunks each; `cron/scheduler_delivery.py` and `cron/lifecycle_guard.py` in 3 each;
every chunk was re-read where a batch output was truncated).

---

## 2. Ideas worth stealing

1. **The "occurrence was taken off the schedule but not yet claimed" record** (`cron/occurrences.py:78`,
   `cron/jobs.py:3194`). The tick persists `next_run_at`'s advance *before* dispatch, which creates a
   window where a crash loses the occurrence. A durable `pending_slot` stamp (exact instant + stamping
   owner) closes the window and is restored **once**. `CONVERGENT` — the same idea appears in
   `deepseek-harness`'s and `pi`'s scheduled-work code as a "pending dispatch" row.
2. **A spend-neutral re-run ladder gated on "zero model calls"** (`cron/unreachable_retry.py:58`).
   Automatic re-runs at 5/15/30 min are allowed *only* when the failure was transient AND the agent
   made zero API calls — so nothing executed and nothing was spent, and a re-run provably cannot double
   a side effect. `UNIQUE` to this repo.
3. **Hash-suppressed monitor mode** (`cron/monitor.py:126`). A cheap source runs first; its exact bytes
   are hashed; the agent is woken only on a change; the new hash is persisted **before** the agent runs
   so a failed agent run cannot re-alert on the same content forever. `UNIQUE`.
4. **The five-state execution ledger with an immutable terminal** (`cron/executions.py:426`). `claimed |
   running | completed | failed | unknown`, where `unknown` means "we do not know if the side effects ran";
   the only post-terminal rewrite allowed is turning a `queued` delivery into its real outcome.
   `CONVERGENT` — a durable run-ledger with an explicit "unknown" is a pattern both other reference
   harnesses reach for.
5. **A per-job durable KV notepad with a hard prompt-injection budget** (`cron/notepad.py:79`, `:149`).
   16 KB per value, 64 KB per job, and an *empty* notepad renders as `''` so an unused feature costs
   zero prompt bytes. `UNIQUE`.
6. **Fail-open preflight with a positive-verdict-only contract** (`cron/scheduler_preflight.py:387`).
   Every pre-run check fails **open** — only an affirmative misconfiguration verdict blocks a run — and
   a *reconnecting* dependency is distinguished from a *never-connected* one. `CONVERGENT`.
7. **A circuit breaker for the persistence layer itself** (`cron/store_health.py:108`, `:268`). One
   in-memory degraded record per store, a real write probe that stages a jobs.json-sized payload where
   the save stages it, and a **recorded skip count** so a disk outage is distinguishable from a sleeping
   machine. `UNIQUE`.
8. **The length-framed run document** (`cron/scheduler_prompt.py:82`). The prompt and the answer are
   stored with their *character counts* outside user-owned text, so the answer is extracted by offset
   rather than by searching for a heading — a prompt that quotes `## Response` cannot break the reader.
   `UNIQUE`.
9. **A typed "blueprint" slot schema rendered into four surfaces** (`cron/blueprint_catalog.py:67`,
   `:744`). One definition of an automation (time, criteria, delivery) becomes a dashboard form, a
   `/blueprint` slash command, a `hermes://` deep link and an agent seed prompt; unknown slot names are
   rejected so a typo cannot silently create a job with a default. `UNIQUE`.
10. **A "you may not kill the thing that runs you" guard with a recursive script scan and a fail-closed
    budget** (`cron/lifecycle_guard.py:1231`, `:475`). `UNIQUE`.
11. **Delivery must be provable, not assumed** (`cron/scheduler_delivery.py:985`). `None` is not success;
    a success with no `message_id` and no `raw_response` is recorded as **UNVERIFIED**; a send timeout
    distinguishes "never started" (fall back) from "in flight" (do not duplicate). `CONVERGENT`.
12. **The truthfulness rule for terminal causes** (`cron/executions.py:426`,
    `cron/scheduler_worker_failure.py:35`). A run whose outcome is uncertain stays `unknown`; only the
    *cause* is made truthful, because "failed" and "we don't know" license different actions.
    `CONVERGENT`.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work.** The whole shard *is* the answer. The reliability machinery
  is: at-most-once occurrence accounting via `pending_slot` (`cron/occurrences.py:78`); a durable
  five-state execution ledger with `unknown` (`cron/executions.py:426`); a per-job **fire claim** with a
  TTL, a per-acquisition token and a heartbeat (`cron/jobs.py:2717`, `cron/scheduler.py:2732`); a
  **store-health breaker** that skips dispatch while the store is unwritable and records the skip count
  (`cron/store_health.py:186`); an **idle-time (not wall-clock) watchdog** (`cron/scheduler_liveness.py:30`);
  a **catch-up window of half the period clamped to 120 s–2 h** (`cron/jobs.py:937`); **missed occurrences
  are logged, never dropped silently** (`cron/jobs.py:3098`); and a **breaker after repeated empty runs**
  in the form of the `failure_streak` + `failure_nudge_threshold` review nudge
  (`cron/scheduler.py:133`). Recovery on restart is explicit: the dead-owner sweep
  (`cron/executions.py:426`), the pending-slot restore (`cron/jobs.py:3194`), the stale-error re-arm
  (`cron/jobs.py:3021`) and the misfire backstop for webhook triggers (`cron/scheduler_provider.py:293`).
- **Human-in-the-loop approval.** Hermes cron *auto-approves* tool calls, which is why it compensates
  with a **prompt-injection scanner on the assembled prompt** (`cron/scheduler_prompt.py:367`) and a
  **credential-exfil backstop** (`cron/scheduler_prompt.py:391`). The *human* gate is the **suggestion
  surface**: nothing auto-creates (`cron/suggestions.py:100`), a `dedup_key` latches a decision, and
  accepting a proposal creates the real job through the same `create_job` path. The audit trail for a
  decision is the **incident ledger** — `detected → alerted → resolved → closed`, with `closed` meaning
  "a human signed this off" and `resolved` meaning "the system recovered" (`cron/incidents.py:156`).
- **Post-mortem / reflection loops.** `cron/incidents.py` is the substrate: a durable *signature* per
  failure (`sha256(job_id + normalized error)`, durations masked out), a state machine, and a
  `close_incidents_for_recovered_job` sweep so the ledger does not grow without bound. What stops bad
  rules accumulating is the **cooldown + ack**: `cron.failure_repeat_alert_hours` withholds the repeat
  ping, an operator `ack` closes the signature permanently, and a *changed* error text mints a **new**
  incident that alerts again (`cron/scheduler.py:336`).
- **Multi-agent.** This shard shows the **other** half — the trigger side. `CronScheduler`
  (`cron/scheduler_provider.py:136`) is a small provider interface whose only contract is *"decide when a
  job fires; execution and delivery stay in `run_job`/`_deliver_result`"*. Growth is **additive only**
  ("optional method with a default, never a changed `start()` signature or new abstractmethod"), and a
  legacy provider that only overrides `fire_due` is kept on the old path so its custom claim/re-arm
  behaviour is not lost. There is **no debate mechanism here** — a deliberate omission.
- **Structured logs the model can query.** The logs are deliberately *light*: per-run markdown documents
  in `cron/output/<job_id>/<timestamp>.md` with a retention cap of 50 per job
  (`cron/jobs.py:3384`); the durable ledger in SQLite (`cron/executions.db`); the incident table in the
  same file (`cron/incidents.py:71`); a JSONL usage audit per fire
  (`cron/scheduler.py:1147`); JSONL telemetry for persisted-error recoveries and timezone-migration
  catch-ups (`cron/jobs.py:1017`); and marker files for ticker liveness. **No FTS, no vector store** —
  the model queries them through tools, not through a database.
- **Staying simple as features accumulate.** Three mechanisms: (a) the **provider interface** that keeps
  the trigger pluggable without a second engine ("no second job engine", `cron/suggestions.py:9`);
  (b) the **one-voice copy tables** (`cron/scheduler_failure_copy.py`) so the "one classifier for the
  whole app, no cron-local regex ladder" rule holds; and (c) a **split-module discipline** — the 15
  `scheduler_*.py` siblings exist so `cron/scheduler.py` stays navigable, and each sibling's docstring
  states the rule: "Import names from this module directly (`cron.scheduler` only imports the few it
  calls itself)". The *cost* of that discipline is visible in §5.

---

## 4. Non-obvious decisions and gotchas

- **"Unknown" is a first-class state, and it is not "failed".** A run whose side effects cannot be
  determined is `unknown` (`cron/executions.py:426`), a fire whose admission cannot be confirmed raises
  `CronExecutionUnknown` and **pauses the job** rather than re-firing (`cron/scheduler_authority.py:55`),
  and a delivery caught mid-send is fenced `unknown` and **never retried**
  (`cron/delivery_queue.py:282`). Conflating "unknown" with "failed" is the single most dangerous
  simplification a scheduler can make.
- **The advance-before-dispatch ordering is the whole at-most-once story**, and it is *incomplete on its
  own* — which is why `pending_slot` exists. A reader who sees only `advance_next_runs()` will believe
  the system is safe; the durable pending record is the missing half.
- **A store that cannot be written makes the scheduler *skip*, not *fail*.** `_advance_or_drop_recurring`
  (`cron/scheduler_tick.py:62`) drops the recurring jobs on a failed advance: "no durable advance → a
  crash mid-run would re-fire them, so skipping is the at-most-once side." A missed run is a smaller
  sin than a duplicate run.
- **`catch_up_missed: false` is not silence.** The skip is logged with the reason and counted in a
  metric (`cron/jobs.py:3098`).
- **The one-shot grace window is enforced at four doors** (create, update, resume, due scan) and a
  past-due one-shot is retired with a **diagnostic file** rather than vanishing (`cron/jobs.py:3129`).
- **"Alerted" is not the same as "closed".** `resolved` = the system recovered (a repeat alerts again);
  `closed` = a human signed it off (a repeat stays silent). Mixing them is how an operator ends up with
  32 "open" incidents on jobs that have been green for weeks.
- **Silence has two shapes and they are not the same thing.** `no_change` (the monitor source did not
  change) and `silent` (`[SILENT]`, or an empty answer) are *different statuses* in the run document
  header, and `context_from` reads only the header to tell them apart — "because script/agent payloads
  can quote these markers" (`cron/scheduler_prompt.py:129`).
- **An empty answer is a failure, not a success** (`cron/scheduler_bookkeeping.py:8`).
- **The toolset allowlist fails closed and the empty list is meaningful** (`cron/scheduler.py:456`).
- **`HERMES_CRON_TIMEOUT` is an *inactivity* limit, and `0` means unlimited** — which in turn makes
  several derived bounds *undefined*, so the system fails closed (never reclaim) rather than guessing
  (`cron/executions.py:152`).
- **The `julianday()` ordering everywhere.** Text timestamps with a local offset are not time-ordered
  across a DST change; every `ORDER BY` in the ledger, the incident table and the delivery queue uses
  `julianday()`.
- **The occurrence identity refuses naive timestamps** rather than assuming a zone
  (`cron/occurrences.py:11`).
- **A cron expression can be edited on disk under the schedule.** `_reanchor_stale_cron`
  (`cron/jobs.py:3060`) distinguishes an *expression edit* (re-anchor **without** firing) from a
  *timezone migration* (fire the due run) from a *deliberately off-lattice* instant (a quota recovery
  or a retry rung — fire once). Getting that discriminator wrong either skips a never-fired occurrence
  or double-fires one.

---

## 5. Weak spots

- **The `cron/` package is 30+ modules and ~25 000 lines for a feature that a well-designed service
  would do in 2 000.** The shard's own `AGENTS.md` is ~40% about *profile isolation* bugs; the same
  class of bug (a store path, a home key, or a credential resolved against the wrong profile) recurs in
  `jobs.py`, `scheduler.py`, `scheduler_delivery.py`, `notepad.py`, `executions.py` and
  `scheduler_preflight.py`. The multi-profile feature is the source of most of the complexity.
- **Regex-based shell analysis is a permanent liability.** `cron/lifecycle_guard.py` is 1293 lines of
  pattern matching over a shell language, and the file's own history shows a bypass class per fix
  (quote splicing #80269, `launchctl submit` laundering #62891, the interpreter-image kill #113667,
  the branch-E token walk, the data-sink masker, the heredoc stripper). Each fix is a new branch; the
  class of attack is unbounded. A real parser (or a positive allow-list of what a cron script may
  contain) would be smaller and stronger.
- **The state machine is spread over many modules and many fields.** A job's truth lives in
  `next_run_at`, `pending_slot`, `fire_claim`, `run_claim`, `state`, `enabled`, `paused_at`,
  `paused_reason`, `repeat.completed`, `last_status`, `last_failure`, `failure_streak`,
  `last_delivery_error`, `last_delivery_queued`, `last_delivery_unverified`, `last_fire_error`,
  `preflight_alerted`, `quota_hold_until`, `unreachable_retry`, `monitor_state`, `canonical_completions`.
  `effective_job_state` exists because "an enabled job must never display as paused" — a symptom of the
  field sprawl, not a fix for it.
- **The comment-to-code ratio is extreme.** Many functions carry a 10-line comment explaining one
  historical incident, and several comments describe *bugs that no longer exist* in the code they
  annotate (e.g. `scheduler_delivery.py:1322` and `scheduler_delivery.py:1436` are near-duplicate
  explanations of the same routing rule). A reader has to reconcile prose with code on every read.
- **The `cron/scheduler.py` and `cron/jobs.py` files are 4 432 and 3 484 lines** and mix the store, the
  grammar, the due scan, the claim protocol, the agent construction, the delivery, the incident
  composition, the worker hand-off, the in-flight guard, the tick lock and the worktree GC. The
  `scheduler_*.py` split helps, but the two biggest files are still where the coupling lives.
- **Fail-open preflight + auto-approved tool calls is a real risk surface.** The compensating controls
  (the two-tier injection scanner, the exfil backstop, the lifecycle guard) are substantial but they
  are pattern matchers, and the *design* — a non-interactive agent that may call tools without a human
  in the loop — is only as safe as the weakest matcher.
