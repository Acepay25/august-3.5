# hermes-agent :: hermes-tests-cli

**Files in shard:** 1708 (read: 1708, skipped with reason: 0)
**What this shard covers:** the entire `tests/hermes_cli/` tree of the Hermes CLI harness — 1,708 files, ~349,000 lines, 12,827 test functions, plus 10 non-test helper modules (conftest, fixtures, a fake portal, a benchmark harness). It is the specification of a *product surface*: a personal-agent CLI with a desktop/dashboard/TUI front end, a plugin system, a per-provider auth layer, a local-model runtime, a cron scheduler, a kanban worker fleet, and a self-updating installer. Because almost every file carries a docstring that states the contract it pins (and cites the issue number it came from), the *set* is the readable artefact: this report treats the suite as a catalogue of enforced invariants rather than 1,708 isolated test files.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `tests/hermes_cli/conftest.py`
- **Purpose:** the shared pytest fixtures for the whole `hermes_cli` suite.
- **Key abstractions:** `all_assignees_spawnable` (monkeypatch) and friends; the module is 180 lines of fixture plumbing.
- **Data flow:** pytest asks for a fixture → the fixture patches a production seam (e.g. the dispatcher's "does this assignee profile exist on disk" guard) → the test body runs against a temp `HERMES_HOME`.
- **Non-obvious design decisions:** the dispatcher has a *profile-exists guard* (PR #20105) that synthetic assignees ("alice", "bob") would trip; the fixture exists to disable that guard rather than to create profiles. The suite deliberately tests "what happens if the operator is wrong" and "what happens if the operator is right" as two different worlds.
- **Edge cases & failure handling:** fixtures are function-scoped and re-patch per test, so a test that mutates a process-global cache must reset it (see the `goals._DB_CACHE.clear()` pattern in `test_goals.py:24-27`).
- **Surprising:** the file is small and entirely about *not* mocking the product. The suite's stated bias is "the wire contract is exercised through Hermes' real client code, never mocked away" (`test_anon_auth_core.py:3-5`).

#### `tests/hermes_cli/anon_portal.py`
- **Purpose:** a fake Nous "NAS" anonymous/free-tier service — one `FakePortal`, one `install_portal`, behind every `portal` fixture.
- **Key abstractions:** `PORTAL`, `install_portal`, `as_local_desktop_backend`, `claimed_trial`; scenario flips are `gate_closed`, `dead_tokens`, a canned `create_response` / `token_response`, and `raise_transport` (which makes the wire itself fail).
- **Data flow:** a test installs a portal with a scenario → the production `hermes_cli.anon_auth` / `anon_challenge` code performs a *real HTTP-shaped* exchange against it → the portal asserts what was asked and answers with the service's real refusal shapes.
- **Non-obvious design decisions:** the fake is a *server*, not a mock. The suite explicitly says the failure-mode contract is "driven through a fake NAS whose responses are the ones the real service sends (see the code table in `hermes_cli.anon_auth`), never through mocked-away client code" (`test_anon_failure_modes.py:3-6`). This is the single most transferable testing idea in the shard.
- **Edge cases & failure handling:** the browser challenge (HTTP 428) is polled *outside* the auth locks, and a host failure wakes the waiter but still requires an authoritative mint (`test_anon_challenge.py:1-4`).
- **Surprising:** there is a separate *connectors-only* guest token so a user who only calls tools never meets the inference browser challenge (`test_anon_connectors_token.py:1-5`).

#### `tests/hermes_cli/plugin_worker_support.py`
- **Purpose:** offline fixtures for the plugin *command* path — only tool acquisition is substituted.
- **Key abstractions:** a prepared test interpreter, an isolated site-packages, a PM-hosted worker process.
- **Data flow:** a plugin command → a real PM worker → a real dependency selection → a fresh interpreter that does **not** inherit the parent's site-packages.
- **Non-obvious design decisions:** "The actual client, worker, resolver, lock, publication callbacks and receipts run unchanged" (`plugin_worker_support.py:3-5`) — the substitution is at the *acquisition* boundary only, so the transaction semantics under test are the production ones.
- **Edge cases & failure handling:** a process death must not leave new plugin code paired with the old dependency selection (`test_plugin_update_recovery.py:1`).
- **Surprising:** this helper is what makes `test_plugin_worker_lifecycle.py` ("Command → real PM worker → offline wheels → persisted state → fresh imports") possible without a network.

#### `tests/hermes_cli/conftest_dashboard_auth.py`
- **Purpose:** a stub auth provider + fixtures for the dashboard-OAuth gate. Deliberately **not** a `conftest.py` — it is an importable helper module, imported as `from tests.hermes_cli.conftest_dashboard_auth import StubAuthProvider`.
- **Key abstractions:** `StubAuthProvider`; it bounces straight back to the OAuth callback with a fake code so the round trip completes in-process.
- **Data flow:** the dashboard auth gate → `StubAuthProvider` → callback → token persistence → WS/HTTP auth state.
- **Non-obvious design decisions:** "Phase 2 of the dashboard-OAuth plan; used by Phase 3's end-to-end gate tests" — the helper is versioned against a *plan phase*, which is how the repo keeps a staged OAuth migration testable.
- **Edge cases & failure handling:** a pre-fence client (an old Desktop build) gets a *named upgrade refusal* it can render, not a bare 401 (`test_session_mutation_legacy_client.py:1`).
- **Surprising:** the whole dashboard-auth subsystem is 15 separate test files (`test_dashboard_auth_*.py`, ~130 KB) — the auth gate is treated as a product surface with its own release plan, not a helper.

#### `tests/hermes_cli/benchmark_session_timeline.py`
- **Purpose:** a reproducible HTTP-payload benchmark using generated data, never a live store.
- **Key abstractions:** a standalone script (not a pytest file) that prints a JSON receipt; fixture setup is excluded from the timings.
- **Data flow:** synthetic rows → the real timeline handler → timing samples → a JSON receipt.
- **Non-obvious design decisions:** "No provider, credential, or app access" — the benchmark is hermetic by construction so it can run on a laptop with no account.
- **Edge cases & failure handling:** n/a — it is a measurement harness, not a test.
- **Surprising:** the repo ships its *benchmarks inside the test tree*, so they are versioned with the code they measure.

#### `tests/hermes_cli/gateway_client_options.py`
- **Purpose:** a 6-line pytest plugin adding `--client-test-runtime-root`.
- **Key abstractions:** `pytest_addoption`.
- **Data flow:** CLI flag → the native client/runtime compatibility probe points at a disposable gateway peer checkout.
- **Non-obvious design decisions:** a *second checkout* is a supported test configuration, so the suite can test a client against a runtime it did not build.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the option is deliberately obscure and defaults to `None` — a two-checkout probe is opt-in.

#### `tests/hermes_cli/fixtures/plugin_compat_legacy/__init__.py` and `tests/hermes_cli/fixtures/plugin_compat_legacy/plugin.yaml`
- **Purpose:** a *frozen* legacy plugin used by the behaviour-compatibility suite.
- **Key abstractions:** `register(ctx)` registering an `on_session_start` hook in its old, narrow form.
- **Data flow:** the loader loads this fixture plugin → the hook is called with the legacy payload → the runtime must not break.
- **Non-obvious design decisions:** "Keep this callback in its old, narrow form: it intentionally predates additive hook payload fields and does not accept `**kwargs`" (`fixtures/plugin_compat_legacy/__init__.py:2-4`). The manifest carries a `future_manifest_field` with `schema: 2, additive: true` so unknown-field forward compatibility is exercised by a real file, not a synthetic dict.
- **Edge cases & failure handling:** a plugin whose hook signature is wrong must be reported by `plugins doctor`, not crash at load (`test_plugin_dev.py:6`).
- **Surprising:** the fixture's manifest declares `provides_hooks: [on_session_start]` — a fixture that documents the *old* contract is itself a versioned artefact.

#### `tests/hermes_cli/__init__.py`, `tests/hermes_cli/web_routers/__init__.py`
- **Purpose:** empty package markers (0 bytes).
- **Note:** `web_routers/` exists so the dashboard router tests can live in a package that mirrors the production layout — the two tests inside it (`test_chat_ws_lease_holder.py`, `test_codex_device_login_transient_retry.py`) are deliberate *copies* of CLI behaviour for the web surface, and the copy is itself a contract.

---

### Tier 1b — the highest-signal test suites (read in depth, not just inventoried)

#### `tests/hermes_cli/test_cron.py` (685 lines, 29 tests)
- **Purpose:** the `hermes cron` command surface — create / edit / pause / list jobs.
- **Key abstractions:** `cron.jobs.create_job / get_job / list_jobs / load_jobs / pause_job / save_jobs`; `hermes_cli.cron.cron_command`; `hermes_cli.subcommands.cron.build_cron_parser`.
- **Data flow:** the parser builder is wired into a real `argparse` tree → `cron_command(args)` → the job row is persisted to `jobs.json` under a temp `CRON_DIR` → the test reads it back with `get_job`.
- **Non-obvious design decisions:** the fixture redirects `cron.jobs.CRON_DIR`, `JOBS_FILE` and `OUTPUT_DIR` — three module-level constants — so the *same* code path is exercised without a special "test mode" branch (`test_cron.py:18`). Job edits persist user-owned inference pins (`--model`, `--provider`) and can replace *or clear* skills, so a cron job is a full agent configuration, not just a prompt.
- **Edge cases & failure handling:** the job store is a JSON file, so the suite pairs with `test_jobs_json_utf8_bom.py` (BOM tolerance) and `test_backup_cron_prompts_lock.py` (prompt recovery must re-read `jobs.json` under the canonical cron lock and publish through the locked, merged writer — no lost update).
- **Surprising:** `hermes cron` is one of the few surfaces where the *model and provider* are pinned per job, and `test_cron_fire_dashboard.py:1-4` pins that the fire webhook must live on the dashboard app — the same bug was introduced by a relocation.

#### `tests/hermes_cli/test_goals.py` (952 lines, 42 tests)
- **Purpose:** persistent cross-turn goals (`/goal`) — a goal survives a turn, is judged, and continues.
- **Key abstractions:** `GoalState`, `GoalManager`, `run_gate`, `_parse_judge_response`; state lives in `SessionDB.state_meta`.
- **Data flow:** a `/goal` turn ends → a *judge* is asked whether the goal is done → the judge answers JSON (`{"done": true, "reason": ...}` or `{"verdict": "wait", "wait_on_pid": 4242}`) → the manager either closes the goal or schedules the next continuation.
- **Non-obvious design decisions:** the judge is **fail-open** — "Judge exception → fail-open continue (don't wedge progress on judge bugs)" (`test_goals.py:75`). A judge that throws must not deadlock the loop. The judge also understands delegated subagents: "In a fan-out run 4 of 5 `/goal` nudges fired 6–153 s after a turn that had said 'waiting on workers, not…'" (`test_goal_judge_delegations.py:1-3`), so the verdict vocabulary includes `wait_on_pid`.
- **Edge cases & failure handling:** a `Ctrl+C` during a `/goal` turn *auto-pauses* the goal rather than merely interrupting the turn (`test_cli_goal_interrupt.py:1-3`); an empty/whitespace continuation is rejected.
- **Surprising:** a parked goal resumes from the idle hook once its barrier lifts, without waiting for another turn (`test_cli_goal_parked_resume.py:1-2`).

#### `tests/hermes_cli/test_goal_gates.py` (324 lines, 19 tests)
- **Purpose:** quality gates attached to a goal — a shell command that must pass before the goal may be called done.
- **Key abstractions:** `GoalGate(command, timeout_seconds, max_retries)`, `run_gate`, `DEFAULT_GATE_TIMEOUT_SECONDS`, `DEFAULT_GATE_MAX_RETRIES`.
- **Data flow:** the gate is serialised inside `GoalState.to_json()` / `from_json()` → `run_gate` executes the command → `(passed, code, output)` decides whether the goal may advance.
- **Non-obvious design decisions:** a gate that fails **captures its output** so the next continuation can see why (`test_goal_gates.py:66`); a pre-gates state row loads with `gates == []`, so the feature is backward compatible with existing state; garbage (`None`, `"nonsense"`) degrades to an empty command rather than raising.
- **Edge cases & failure handling:** `run_gate` is platform-sensitive — a POSIX-only command like `echo broken >&2; exit 3` "passes" under `cmd.exe`, so the test is marked `@pytest.mark.platforms("linux")` rather than pretending the behaviour is universal.
- **Surprising:** the gate is *data in the goal state*, not code. The same goal JSON round-trips through the session DB, so a goal survives a restart with its gates attached.

#### `tests/hermes_cli/test_loops.py` (680 lines, 64 tests)
- **Purpose:** `/loop` — recurring in-session wakeups (a turn that re-arms itself on an interval).
- **Key abstractions:** `parse_interval_token`; loop state in the same `SessionDB.state_meta` store as goals.
- **Data flow:** `/loop 5m <prompt>` → an interval token is parsed → the manager re-arms a wakeup after each turn.
- **Non-obvious design decisions:** the token grammar is strict and total: `5m`, `30s`, `2h`, compound `1h30m`, case-insensitive, and a **bare number is not an interval** (`3` → `None`, `test_loops.py:57-60`). A typo must not silently become a 3-second loop.
- **Edge cases & failure handling:** the fixture busts the goals module's DB cache between tests (`goals._DB_CACHE.clear()`) so a changed `HERMES_HOME` is re-resolved — the same pattern `test_goals.py:30` uses.
- **Surprising:** `/loop` and `/goal` share one persistence substrate and one cache, and the two suites carry identical fixtures — the loop and goal managers are siblings.

#### `tests/hermes_cli/test_heartbeat.py` (186 lines, 16 tests)
- **Purpose:** `/heartbeat` — a periodic self-check that can live past a session.
- **Key abstractions:** `HeartbeatManager`, `HeartbeatState`, `parse_interval`, `format_interval`, `MIN_INTERVAL_SECONDS`, `load_heartbeat` / `save_heartbeat` / `migrate_heartbeat_to_session`.
- **Data flow:** `/heartbeat 10m check CI` → the interval is parsed → the state is persisted → a due check fires.
- **Non-obvious design decisions:** there is a **floor** on the interval: `5s` and `30s` are rejected (`parse_interval` returns `-1`), and exactly `MIN_INTERVAL_SECONDS` is allowed (`test_heartbeat.py:46-49`). A user cannot build a hot loop. The parser also accepts prose forms (`"every 2 hours"`, `"90 minutes"`) and rejects ambiguous ones (`""`, `"banana"`, `"check CI"`, `"every"`, `"m10"`).
- **Edge cases & failure handling:** a heartbeat that predates the session store is *migrated into* it (`migrate_heartbeat_to_session`) — the state moves rather than being duplicated.
- **Surprising:** `format_interval` is the inverse of `parse_interval` and is tested as such — the display string and the stored seconds are one contract.

#### `tests/hermes_cli/test_approvals_suggest.py` (340 lines, 15 tests)
- **Purpose:** `hermes approvals suggest` — mine the history for commands the user already consented to and offer them as allowlist entries.
- **Key abstractions:** `scan_approval_history`, `build_proposals`, `apply_proposals`, `derive_glob`, `normalize_command`, `suggest_command`, `Proposal`.
- **Data flow:** the session DB (`state.db`) is opened → every assistant `terminal` tool call is paired with its `role='tool'` result → a *dangerous-classified* command whose result is **not** a BLOCKED/denied/pending marker is read as "the user consented" → proposals are ranked → `--apply` merges them into the allowlist.
- **Non-obvious design decisions:** "Approval history in Hermes is implied, not ledgered" (`test_approvals_suggest.py:3`). There is no separate approvals table: the transcript *is* the ledger, and the "was this approved?" question is answered by reading the tool result. This is the cheapest possible audit trail, and it costs a full scan to query.
- **Edge cases & failure handling:** the scan has a `--days` window and a home-prefix normaliser a `--days` window (`test_approvals_suggest.py:135`) and a home-prefix normaliser (`test_approvals_suggest.py:149`); safety exclusions keep destructive commands out of the suggestions.
- **Surprising:** the same repo also ships a *dry-run* verdict CLI (`hermes approvals test`, `test_approvals_test.py:1-4`) that composes the **real** runtime evaluators from `tools.approval` and returns exit 0 (allow), 1 (deny) and 2 (ask). A policy can be tested without a model in the loop.

#### `tests/hermes_cli/test_approval_transport.py` (570 lines, 20 tests)
- **Purpose:** the approval transport *plugin* contract and fail-closed host routing.
- **Key abstractions:** `PluginContext.register_approval_transport`, a transport registry keyed by name, `builtin` reserved.
- **Data flow:** a plugin registers a transport → the host offers a scope → the transport returns a decision → the host validates it.
- **Non-obvious design decisions:** the host **rejects** a scope that was not offered by the request and rejects invalid or stale decisions (`test_approval_transport.py:1-2`, `:112`, `:157`). A transport cannot widen its own permissions, and `force_reload` must clear the registry so a disabled plugin cannot keep serving approvals.
- **Edge cases & failure handling:** transport names are unique and profile-isolated; the registry itself *is* the manager, so a reload is the only way to change it.
- **Surprising:** approval is a *pluggable transport*, not a hardcoded modal — and the host is the trust boundary, not the plugin.

#### `tests/hermes_cli/test_cli_approval_ui.py` (563 lines, 16 tests)
- **Purpose:** the interactive approval surface.
- **Non-obvious design decisions:** "offer only once and deny" — a denied smart-approval callback and a session-less gate must each offer exactly once and then default to deny, and a sudo prompt must **restore the existing draft** after the prompt (`test_cli_approval_ui.py:71`). A user who is interrupted by a gate does not lose what they typed.
- **Surprising:** the same "offer once, then deny" contract appears for three different gate kinds — it is one rule, re-tested per surface.

#### `tests/hermes_cli/test_approvals_test.py` (197 lines, 15 tests)
- **Purpose:** `hermes approvals test` — a dry-run approval verdict CLI.
- **Key abstractions:** the real runtime evaluators from `tools.approval` (`detect_hardline_command`, the dangerous-command classifier and the allowlist check) composed into one verdict.
- **Data flow:** a command string → the *production* evaluators → a verdict → an exit code (0 = allow, 1 = deny, 2 = ask).
- **Non-obvious design decisions:** "The tester must compose the REAL runtime evaluators from `tools.approval`" (`test_approvals_test.py:1-4`) — a *copy* of the policy would test nothing, and the policy drifting from the tester is the exact failure this forbids. A benign command allows with exit 0, a hardline command denies *and names the rule that denied it*, and a merely-dangerous command asks with exit 2.
- **Edge cases & failure handling:** the exit code is the contract, so automation can gate on it; the rule name is part of the output so the user can see *why*.
- **Surprising:** a policy engine with a testable, model-free verdict surface is a much better foundation for a HITL approval flow than a modal that needs a live model.

#### `tests/hermes_cli/test_update_receipt_truthfulness.py` (275 lines, 9 tests)
- **Purpose:** the honesty contract of the self-updater's receipt.
- **Key abstractions:** `hermes_cli.update_receipt` (`begin → record → finalize → read back`), `hermes_cli.update_inventory.match_runtime_outcomes`, `report_unaccounted_runtimes`.
- **Data flow:** an update begins → steps are recorded → the run is finalized into a receipt on disk → the dashboard/Desktop read the latest receipt through `/api/hermes/update/receipt`.
- **Non-obvious design decisions:** three invariants, each with the enforcing site named in the docstring:
  1. **RECEIPT ALWAYS FINALIZED** — every post-begin run leaves a parseable record; a begun-but-never-finalized run (a simulated crash) writes **nothing** to disk, so a reader can never interpret a crash as success (`test_update_receipt_truthfulness.py:11-19`).
  2. **SUCCESS IMPLIES ACCOUNTING** — the pre-update plan *is* the restart worklist; the outcome is exactly `"partial" if incomplete else "success"`, and the test drives that expression with the real decision function's return value, so sabotaging the enforcement fails the suite (`:21-30`).
  3. **REFUSAL IS NOT FAILURE** — an exit-2 preflight refusal must be distinguishable from a failed update, and the reader must report `refused` (`:33-35`).
- **Edge cases & failure handling:** only paths/env are monkeypatched; every receipt is produced by the real API.
- **Surprising:** this is the clearest example in the repo of "the word must be backed by evidence" — a receipt is a *legal record of what actually happened*, and a crash produces silence rather than a false success.

#### `tests/hermes_cli/test_kanban_review_lifecycle.py` (930 lines, 24 tests)
- **Purpose:** the first-class `running → review` transition in the kanban worker fleet.
- **Key abstractions:** `hermes_cli.kanban_db` (`request_review`), `kanban_db_connect`, `kanban_db_notify`, `kanban_db_dispatch`, `kanban_ops`.
- **Data flow:** an executor worker finishes implementing → `request_review` transitions the task and closes the active run with `outcome="review_requested"` → exactly one `review_requested` event is emitted, carrying the handoff summary and the implementer → a reviewer picks it up.
- **Non-obvious design decisions:** review is **not a blocker**. "Repeated review requests on the same task (a review → rerun → review follow-up cycle) never touch `block_recurrences` and never route to `triage` — the false `block_loop_detected` escalation that plagued the block-reason approach cannot happen" (`test_kanban_review_lifecycle.py:12-16`). The earlier design encoded "review required" as prose inside a `kanban_block` call, and the false escalation was the cost. A *state transition* beats a *parsed string*.
- **Edge cases & failure handling:** `expected_run_id` is honoured as a **CAS guard**, so a stale or superseded worker cannot move the task (`:17-19`). A second `request_review` is idempotent in the event stream (exactly one event).
- **Surprising:** the reviewer model is *coexist* with same-card review (`test_kanban_review_lifecycle_complete.py:1-6`) — two review models with different owners, both first-class.

#### `tests/hermes_cli/test_context_policy.py` (438 lines, 27 tests)
- **Purpose:** the local-model context-window policy — how big a context the machine can actually afford.
- **Key abstractions:** `hermes_cli.local_runtime.context_policy` (`FLOOR`, `SPEED_FLOOR_TOK_S`, `WindowDecision`, `growth_decision`, `initial_window`, `ladder`, `launch_args`, `recurrent_spill_blocks`, `spill_overrides`, `ub_logits_bytes`) and `local_runtime.estimator` (`HardwareBudget`, `LayerKind`, `ModelProfile`, `PhysicsRefusal`, `ctx_bytes`, `physics_check`).
- **Data flow:** a synthetic `ModelProfile` (layers, bytes/token, weight GiB, native context) + a `HardwareBudget` → the policy emits a `WindowDecision` (initial window, growth ladder, launch args) → the physics check can *refuse* (`PhysicsRefusal`) if the plan does not fit.
- **Non-obvious design decisions:** the tests are **decision tables, not snapshots**: "synthetic per-layer profiles → relationships, never exact numbers. Real-model spot checks pin the estimator to constants measured on real GGUFs" (`test_context_policy.py:1-5`). The suite explicitly refuses change-detector tests — a new model must not break the suite, and the suite must not need editing when one is added.
- **Edge cases & failure handling:** the estimator prices a **split** GGUF as the set of its shards (`test_local_runtime_gguf_split.py:1-3`), prices tensors the engine reads lazily as *not* loaded (`test_local_runtime_lazy_read.py:1-3`), and trusts the GGUF's own SWA pattern over a hardcoded architecture table (`test_local_runtime_gguf_swa.py:1-3`).
- **Surprising:** `recurrent_spill_blocks` and `spill_overrides` encode that a recurrent model's state cannot be duplicated for speculative decoding — the *economics* of the machine shape the window policy, not just the raw VRAM number.

#### `tests/hermes_cli/test_curator_status.py` (87 lines, 1 test) and `test_curator_pin_visibility.py` (199 lines, 3 tests)
- **Purpose:** the curator — the agent that ages unused skills out of the library.
- **Key abstractions:** `hermes_cli.curator` (CLI half), `agent.curator`, `tools.skill_usage`.
- **Data flow:** skills on disk under `$HERMES_HOME/skills` → usage counters (view / patch / use all count as activity) → `hermes curator status` ranks by least-recently-active.
- **Non-obvious design decisions:** "view/patch/use all count as activity" (`test_curator_status.py:4`) — a skill the user *read* is not dead, so the curator will not archive it. Pinning is a durable "keep" flag: `hermes curator pin <name>` refuses to archive a pinned skill and prints an `unpin` hint (`test_curator_archive_prune.py:1-3`), and a pin on an *unmanaged* skill must still be truthful (`test_curator_pin_unmanaged.py:1-3`).
- **Edge cases & failure handling:** the pin must be *visible* where the user looks — "two stacked defects, each with its own failing assertion: 1. false success, 2. invisible pin" (`test_curator_pin_visibility.py:3-6`).
- **Surprising:** the curator is the repo's answer to "how do you stop skills accumulating" — a monthly/weekly pass that archives by *usage* (not by age), with an explicit pin as the user's veto.

#### `tests/hermes_cli/test_prune_advisor.py` (238 lines, 10 tests)
- **Purpose:** the low-disk prompt — ask the user whether to prune.
- **Key abstractions:** `prune_advisor.should_ask(home)`, `.snooze(home)`, `.decide(answer, home)`.
- **Data flow:** free disk below the threshold → `should_ask` returns a prompt → the user answers → either `snooze` (a "later" marker) or `decide`, which writes a single `auto_prune` key into `config.yaml`.
- **Non-obvious design decisions:** "asks only while undecided, says when pruning will not help" (`test_prune_advisor.py:1`). With plenty of space the advisor is silent; after a snooze it stays silent for the window; **either** answer ends the question permanently, because the decision is persisted in config rather than re-asked (`test_prune_advisor.py:34-45`). And if nothing is old enough to prune, the prompt *says so* instead of offering a useless action.
- **Edge cases & failure handling:** the config write is asserted to contain `auto_prune` exactly **once** — a duplicated key is a bug.
- **Surprising:** the advisor is a three-state machine (undecided / snoozed / decided) with a durable home, and the snooze marker is a separate file (`_snooze_path`) rather than a config key.

#### `tests/hermes_cli/test_cron_dispatch_visibility.py` (136 lines, 7 tests) and `tests/hermes_cli/test_cron_run_scheduler_ownership.py` (162 lines, 5 tests)
- **Purpose:** make a scheduler's behaviour *visible* rather than inferred.
- **Key abstractions:** `_dispatch_display`, `_format_lateness`, `_print_active_jobs_summary`; the job row's `last_dispatch` stamp carries `scheduled_at`, `dispatched_at`, `lateness_seconds` and a `kind` (`catch_up`).
- **Data flow:** the scheduler fires (or catches up) → the dispatch stamp is written to the job row → `hermes cron list` renders a **Dispatch line** with scheduled-vs-actual, lateness and disposition; `hermes cron status` calls out jobs whose last dispatch was a late or missed-fire catch-up (`test_cron_dispatch_visibility.py:1-4`).
- **Non-obvious design decisions:** "A never-closed cron run is live while the scheduler **OWNS** it, not while it ticked recently" (`test_cron_run_scheduler_ownership.py:1`). A 300-second activity window is a *heuristic*; ownership is the *fact*. A run that ticked 5 minutes ago and is still owned is live; a run that ticked 1 second ago and is not owned is not.
- **Edge cases & failure handling:** the dashboard's cron-fire webhook must live on the dashboard app — a relocation bug is pinned as a regression (`test_cron_fire_dashboard.py:1-4`).
- **Surprising:** the lateness is computed and *displayed*; a catch-up dispatch after downtime is a first-class, visible outcome rather than a silent late run.

#### `tests/hermes_cli/test_active_session_exclusivity.py` (204 lines, 10 tests)
- **Purpose:** the property that **at most one live owner may run a given stored session**, whether or not a concurrency cap is configured.
- **Key abstractions:** the active-session registry (acquisition + release), lease entries keyed by owner.
- **Data flow:** an owner acquires a lease → a second acquire on the same session is refused → the lease is released → the next owner may acquire.
- **Non-obvious design decisions:** "capacity and exclusivity are not the same switch" (`test_active_session_exclusivity.py:97`). The reason is correctness, not load: "a second owner does not merely duplicate work. It loads its own snapshot of the transcript, reasons from a history that does not include the first owner's in-flight turn" (`:3-6`). Two owners of one session means two divergent truths.
- **Edge cases & failure handling:** a dead owner is pruned and a successor may acquire; a **recycled PID** does not keep a lease alive (`test_active_session_exclusivity.py:130`).
- **Surprising:** the lease is released on *orphaned* entries too — a crashed owner's lease must not wedge the session forever, but a foreign or vouched lease is spared.

#### `tests/hermes_cli/test_sessions_pin.py` (137 lines, 5 tests) and `tests/hermes_cli/test_kanban_gc_retention.py` (223 lines, 7 tests)
- **Purpose:** the two halves of "never delete what the user wants".
- **Key abstractions:** the session `pin` flag in `state.db` (durable, written by the Desktop sidebar and readable by the CLI); `hermes kanban gc`'s retention window.
- **Data flow:** a pin is set → bulk prune/archive skips the row → the pin survives export/import.
- **Non-obvious design decisions:** "Pin state is the durable 'keep' flag in `state.db`" (`test_sessions_pin.py:3`). For retention: "a negative window builds a future cutoff that matches every row; zero disables the sweep rather than deleting all" (`test_kanban_gc_retention.py:1-2`). A GC configuration cannot accidentally nuke the board — a negative number is clamped and a zero is a *disable*, not a *delete-everything*.
- **Edge cases & failure handling:** the retention-backup must cover exactly the rows prune can delete (`test_sessions_export_retention.py:1-2`).
- **Surprising:** the same repo contains both a "keep" flag and a conservative GC — a pin is a veto over an age-based sweep, and the sweep's edge values are designed to fail safe.

#### `tests/hermes_cli/test_browse_schema_drift.py` (1011 lines, 27 tests) and `test_sessions_repair_declarative.py` (154 lines, 7 tests)
- **Purpose:** a store whose schema lags the code must stay *browsable*, and an explicit repair must restore browsing.
- **Key abstractions:** `SCHEMA_SQL` (the code's idea of the schema) vs the store's `schema_version`; a page-level salvage lane that infers a salvaged store's physical column order from `session_schema_history`.
- **Data flow:** a store written by an older build → the reader detects the drift → the named-column queries still work by *salvaging* a page-level projection → an explicit `hermes sessions repair` (declarative) migrates the store forward.
- **Non-obvious design decisions:** "A store that lags `SCHEMA_SQL` must stay browsable" (`test_browse_schema_drift.py:1`). Read paths degrade; write paths refuse. The `sessions:` config also gates auto-archive per profile (`test_web_server_auto_archive_profile_config.py:1-2`).
- **Edge cases & failure handling:** "Explicit repair must restore browsing after additive schema drift" (`test_sessions_repair_declarative.py:1`) — repair is *declarative* (run the known migrations) rather than a rebuild.
- **Surprising:** `test_session_schema_history.py:1-3` keeps a *history of the schema itself* so a salvaged store's column order can be inferred — the recovery path needs to know what the file used to look like.

#### `tests/hermes_cli/test_shared_metrics_signals.py` (633 lines, 29 tests) and `test_shared_metrics_consent_windows.py` (310 lines, 13 tests)
- **Purpose:** the opt-in telemetry store — "v5 signals: `hermes.tool_unavailable.count`, `hermes.provider_setup.count`, `hermes.feature_adoption.count`".
- **Key abstractions:** a durable shared-metrics store; a consent-interval model; a sender with a period-based consent gate and a frozen identity across rotation.
- **Data flow:** an event → a closed-set value → a durable row → a periodic sender → an HTTP export. The dashboard's own metrics (friction, onboarding, dislike) collapse onto a closed code list (`test_shared_metrics_desktop.py:1-2`), and "user-named models never leave the machine" (`test_shared_metrics_model_attribution.py:1-3`).
- **Non-obvious design decisions:** the consent model is tested as **property tests**, not examples: "every scenario here is a defect that a … harness … would have caught" (`test_shared_metrics_consent_windows.py:1-2`). Consent is an *interval*, not a boolean, and the properties are what matter.
- **Edge cases & failure handling:** the interactive path must not block on telemetry (`test_shared_metrics_send_wiring.py:1-2`); a malformed store must not turn dashboard polling into a traceback storm (`test_web_analytics_corrupt_store.py:1`).
- **Surprising:** telemetry is the *only* feature in the suite with a "tools" toggle that is pinned by the repo's own AGENTS.md — the consent gate is a contract, not a preference.

#### `tests/hermes_cli/test_plugin_capabilities.py` (419 lines, 35 tests)
- **Purpose:** the plugin capability model and the consent flow.
- **Key abstractions:** a capability declaration in a plugin manifest; a consent grant persisted in config; re-consent on update.
- **Data flow:** a plugin declares capabilities → the loader asks the user → the grant is persisted → the plugin may act within the granted scope.
- **Non-obvious design decisions:** "declaration parsing, consent grant/persist, update re-consent on added capabilities" (`test_plugin_capabilities.py:3-4`). A plugin *update* that adds a capability re-opens the consent question — an existing grant does not cover a capability the user has never seen. A plugin can *ask* for its MCP server to be gated, but never to be widened (`test_agent_plugins.py:158`).
- **Edge cases & failure handling:** a plugin that fails identically on every call is reported **once**, not once per call (`test_plugin_hook_failure_reporting.py:1-3`).
- **Surprising:** the whole plugin system runs third-party code in a **per-profile host process** reached only via `ctx` (`test_plugin_host.py:1-2`) — a plugin never touches the agent's memory.

#### `tests/hermes_cli/test_dashboard_auth_audit.py` (119 lines, 5 tests)
- **Purpose:** the audit log for dashboard-auth events.
- **Key abstractions:** `hermes_cli.dashboard_auth.audit.audit_log`, `AuditEvent` (with `LOGIN_FAILURE` etc.).
- **Data flow:** an auth event → the event is serialised as **one JSON object per line** → the line is appended to `$HERMES_HOME/logs/dashboard-auth.log` (profile-aware).
- **Non-obvious design decisions:** "Token-like kwargs are dropped before serialisation so we never leak refresh tokens or JWTs to disk" (`test_dashboard_auth_audit.py:4-5`). Every string value is **bounded to 256 characters** and truncated with a `...[truncated]` suffix; a `Path` value is stringified, not serialised (`test_dashboard_auth_audit.py:28`).
- **Edge cases & failure handling:** a hostile 1000-line string cannot blow up the log; the truncated value still *starts with* the original, so the record is still useful.
- **Surprising:** this is the repo's cleanest "audit trail that survives a decision" — a JSONL file, append-only, profile-scoped, with secrets stripped and lengths bounded.

#### `tests/hermes_cli/test_doctor_exit_status.py` (54 lines, 2 tests)
- **Purpose:** `hermes doctor`'s exit status must agree with its unresolved findings.
- **Non-obvious design decisions:** a diagnostic tool that finds problems but exits 0 is a diagnostic tool nobody automates. The suite pins that agreement as a contract, not a convenience.
- **Surprising:** the same doctor also *reports* rather than deletes: "doctor names the stale config key; the user removes it" (`test_doctor_channel_hygiene.py:1-3`).

#### `tests/hermes_cli/test_kanban_host_cap.py` (362 lines, 12 tests)
- **Purpose:** host-level concurrency accounting and **review-lane fairness**.
- **Non-obvious design decisions:** the cap is *host*-level (across profiles) and the review lane is protected from the execution lane's traffic — a fleet that starves its own reviewers is a fleet that stops learning.
- **Edge cases & failure handling:** per-profile caps exist on top of the host cap (`test_kanban_per_profile_cap.py:1-2`).

#### `tests/hermes_cli/test_worker_first_always_grant.py` (265 lines, 12 tests)
- **Purpose:** an "Always" approval typed inside a frozen managed worker must still reach `config.yaml`.
- **Non-obvious design decisions:** the worker's frozen policy binds `command_allowlist` the way the worker bootstrap binds it, so the grant is written to the *profile's* config, not swallowed by the frozen snapshot (`test_worker_first_always_grant.py:12`).
- **Surprising:** "Always" is a *durable* decision that must survive the process that made it — the single most-requested behaviour in any approval system, and the one most often lost.

---

### Tier 2 — the bulk ledger: 1,672 remaining files, one row each

The table below is the ledger. Every row's "what it pins" is the file's own module docstring (the contract it states) or, where the file has no docstring, the names of the first test functions it defines. Rows are in the shard's file-list order.

<!-- TABLE:BEGIN -->
| File | What it pins |
| --- | --- |
| `tests/hermes_cli/test_active_sessions.py` | test_resolve_max_concurrent_sessions_values, test_cross_process_acquire_claims_only_one_last_slot. |
| `tests/hermes_cli/test_actual_provider.py` | the Actual Computer provider wiring. |
| `tests/hermes_cli/test_agent_env_advertisement.py` | the AI_AGENT / HERMES_AGENT harness-attribution env vars. Port of earendil-works/pi#7493: entry points advertise the agent harness to. |
| `tests/hermes_cli/test_agent_import.py` | hermes_cli.agent_import — ``hermes import-agent``. Covers: source detection, Claude Code and Codex parsing, mapping into the real Hermes. |
| `tests/hermes_cli/test_agent_plugins.py` | Agent Plugins v1 portable package validation tests. |
| `tests/hermes_cli/test_aggregator_overlap_twin_upstream.py` | Aggregator overlap strip vs a user row that IS the same upstream as a built-in aggregator. |
| `tests/hermes_cli/test_ai_gateway_models.py` | AI Gateway model list and pricing translation. Vercel AI Gateway exposes ``/v1/models`` with a richer shape than OpenAI's spec (type, tags. |
| `tests/hermes_cli/test_alibaba_coding_plan_cn_provider_listing.py` | alibaba-coding-plan and alibaba-coding-plan-cn must not both appear in the /model picker off a single shared key (#101122). The CN profile now has. |
| `tests/hermes_cli/test_anon_auth_core.py` | Nous free tier core: identity lifecycle, token-acquisition seam, routing pin, opt-out. Behaviour contracts on the public seams. |
| `tests/hermes_cli/test_anon_challenge.py` | Nous free tier: the browser challenge in front of a token exchange (``hermes_cli.anon_challenge``). Driven through the fake NAS with Hermes' real. |
| `tests/hermes_cli/test_anon_connectors_token.py` | Nous free tier: the connectors-only guest token (NAS hermes-portal#1516). A guest who only uses connectors or managed tools never meets the. |
| `tests/hermes_cli/test_anon_desktop_signin.py` | Desktop (dashboard API) sign-in over a Nous free-tier identity. ``POST /api/providers/oauth/nous/start`` registers the connector transfer with the. |
| `tests/hermes_cli/test_anon_failure_modes.py` | Nous free tier: every way the account service or the wire can refuse the free tier, and what Hermes does with each (the failure-mode contract behind. |
| `tests/hermes_cli/test_anon_first_notice.py` | The one-time free-tier notice flag: pending once for a guest that carries the trial, then never. |
| `tests/hermes_cli/test_anon_picker.py` | Model pickers under a Nous free-tier identity. A guest carrying the welcome trial shows one row, "Nous · free tier", with the single model. |
| `tests/hermes_cli/test_anon_sign_in_flow.py` | ``anon_auth.run_sign_in``: the one sign-in composition every surface renders. Driven directly against the same fake account service ``hermes auth. |
| `tests/hermes_cli/test_anon_surfaces.py` | Nous free tier on the read-only display surfaces and the keepalive. Contract (R-USR-1): wherever a free-tier identity renders (``hermes auth status. |
| `tests/hermes_cli/test_anon_upgrade.py` | ``hermes auth upgrade``: the free tier signs into a Nous account, keeping its connectors. Driven through a fake portal covering the device-code. |
| `tests/hermes_cli/test_anthropic_model_flow_stale_oauth.py` | Bug #12905 fix — stale OAuth token detection in hermes model flow. Bug 3: `hermes model` with `provider=anthropic` skips OAuth. |
| `tests/hermes_cli/test_anthropic_models_pagination.py` | Anthropic /v1/models cursor pagination — regression tests. The endpoint defaults to a 20-item page and signals continuation via. |
| `tests/hermes_cli/test_anthropic_oauth_flow.py` | Anthropic OAuth setup flow behavior. |
| `tests/hermes_cli/test_anthropic_oauth_routes_to_messages_api.py` | coverage for issue #32243. OAuth Pro/Max credentials must always reach Anthropic via the native ``/v1/messages`` endpoint, never the. |
| `tests/hermes_cli/test_anthropic_picker_curated.py` | the Anthropic model-picker dropping curated aliases. Bug — newly-routed curated aliases vanished on a native Anthropic setup. |
| `tests/hermes_cli/test_anthropic_pool_model_discovery.py` | test_anthropic_picker_discovers_models_with_pool_api_key, test_anthropic_pool_api_key_overrides_conflicting_active_endpoint. |
| `tests/hermes_cli/test_anthropic_provider_persistence.py` | Anthropic credential persistence helpers. |
| `tests/hermes_cli/test_api_key_providers.py` | API-key provider support (z.ai/GLM, Kimi, MiniMax, AI Gateway). |
| `tests/hermes_cli/test_api_mode_aliases.py` | Legacy ``api_mode`` spellings must keep selecting the transport they named. Regression coverage for the silent api_mode vocabulary break: earlier. |
| `tests/hermes_cli/test_apply_model_switch_result_context.py` | test for the `/model` picker confirmation display. Bug (April 2026): after choosing a model from the interactive `/model` picker. |
| `tests/hermes_cli/test_apply_profile_override.py` | _apply_profile_override HERMES_HOME guard (issue #22502). When HERMES_HOME is set to the hermes root (e.g. systemd hardcodes. |
| `tests/hermes_cli/test_approvals_command.py` | Cross-surface contract for the persistent /approvals mode command. |
| `tests/hermes_cli/test_arcee_provider.py` | Arcee AI provider support — standard direct API provider. |
| `tests/hermes_cli/test_archive_safe.py` | the shared tar.gz writer (``hermes_cli.archive_safe.make_targz``). ``make_targz`` backs both ``hermes profile export`` and ``hermes kanban. |
| `tests/hermes_cli/test_argparse_flag_propagation.py` | parent→subparser flag propagation. When flags like --yolo, -w, -s exist on both the parent parser and the 'chat' subparser, placing the. |
| `tests/hermes_cli/test_at_context_completion_filter.py` | test: `@folder:` completion must only surface directories and `@file:` must only surface regular files. Reported during TUI v2 blitz. |
| `tests/hermes_cli/test_atomic_json_write.py` | utils.atomic_json_write — crash-safe JSON file writes. |
| `tests/hermes_cli/test_atomic_yaml_write.py` | utils.atomic_yaml_write — crash-safe YAML file writes. |
| `tests/hermes_cli/test_audio_playback_guard.py` | the test-suite audio-playback guard. The incident: a plain test run spoke the words "partial answer complete" out of a. |
| `tests/hermes_cli/test_audio_router_scope.py` | Scope-isolation regression for the ElevenLabs voices route's env fallback. ``get_elevenlabs_voices`` reads ``ELEVENLABS_API_KEY`` through the secret. |
| `tests/hermes_cli/test_auth_codex_bounded_body.py` | Codex OAuth/device-auth responses are read through a 1 MiB body cap (#55253). A hostile or broken auth endpoint/proxy answering 200 with megabytes. |
| `tests/hermes_cli/test_auth_codex_browser_login.py` | ``hermes auth add openai-codex --browser``: opt-in loopback authorization-code + PKCE (#95743). Exercises the real loopback listener and a real. |
| `tests/hermes_cli/test_auth_codex_no_proxy_ipv6.py` | ``_codex_http_client`` survives a bracketed-IPv6 NO_PROXY environment (#118159). Clash Verge / mihomo write ``[::1]`` into NO_PROXY; httpx 0.28.1. |
| `tests/hermes_cli/test_auth_codex_provider.py` | Codex auth — tokens stored in Hermes auth store (~/.hermes/auth.json). |
| `tests/hermes_cli/test_auth_codex_quota_probe.py` | the Codex upstream-quota-restored probe and cooldown clearing. Covers issue #43747 (externally-reset variant): Codex 429s persist a. |
| `tests/hermes_cli/test_auth_codex_self_heal.py` | Codex refresh_token self-heal (cross-store rotation). Hermes keeps its OWN copy of the Codex OAuth token (per profile +. |
| `tests/hermes_cli/test_auth_commands.py` | auth subcommands backed by the credential pool. |
| `tests/hermes_cli/test_auth_key_prefix_skip.py` | #93593: a malformed provider key in .env must not silently shadow a valid credential-pool key. Before the fix. |
| `tests/hermes_cli/test_auth_lock_timeout_diagnosis.py` | The auth-store lock timeout must name the lock file, and a holder only when one is real. ``_auth_store_lock`` serializes auth.json transactions. |
| `tests/hermes_cli/test_auth_model_key_env.py` | #106336: Desktop-saved registry-provider credentials. The Desktop settings UI persists a registry provider's API key as a. |
| `tests/hermes_cli/test_auth_nous_provider.py` | Nous OAuth refresh and inference JWT interactions. |
| `tests/hermes_cli/test_auth_placeholder_rejection.py` | Placeholder credentials must read as "not configured", never as a usable secret. ``.env.example`` ships ``your_key_here`` for four providers. |
| `tests/hermes_cli/test_auth_pool_operations.py` | OAuth control commands against a loopback token endpoint. |
| `tests/hermes_cli/test_auth_profile_fallback.py` | cross-profile auth fallback. When ``HERMES_HOME`` points to a named profile, ``read_credential_pool()`` and ``get_provider_auth_state()``. |
| `tests/hermes_cli/test_auth_provider_gate.py` | is_provider_explicitly_configured(). |
| `tests/hermes_cli/test_auth_provider_scope.py` | resolve_provider auto-detection must read provider keys through the profile secret scope under multiplex (#86917). A secondary profile whose config. |
| `tests/hermes_cli/test_auth_qwen_provider.py` | Qwen OAuth provider authentication (hermes_cli/auth.py). Covers: _qwen_cli_auth_path, _read_qwen_cli_tokens, _save_qwen_cli_tokens. |
| `tests/hermes_cli/test_auth_store_read_failure.py` | A transient read failure on auth.json must not degrade to an empty store. ``_load_auth_store`` treated every exception as corruption and returned. |
| `tests/hermes_cli/test_auth_store_windows_encoding.py` | auth store encoding on Windows. ``_load_auth_store`` and the Codex/Nous shared-store readers previously called. |
| `tests/hermes_cli/test_auth_toctou_file_modes.py` | TOCTOU-safe credential file writers in ``hermes_cli.auth``. Background ========== The three writers below used to create a temp. |
| `tests/hermes_cli/test_auth_xai_oauth_provider.py` | xAI Grok OAuth — tokens stored in Hermes auth store (~/.hermes/auth.json). |
| `tests/hermes_cli/test_authenticated_providers_exhausted_pool.py` | test for #45759. An all-exhausted credential pool holds entries but no *usable* credential. ``list_authenticated_providers`` must not. |
| `tests/hermes_cli/test_aux_assignment_reasoning_effort.py` | Desktop Settings → Model → Auxiliary can set a task's reasoning effort (#89259, salvage #90649). ``POST /api/model/set`` carries. |
| `tests/hermes_cli/test_aux_config.py` | the auxiliary-model configuration UI in ``hermes model``. Covers the helper functions: - ``_save_aux_choice`` writes to config.yaml. |
| `tests/hermes_cli/test_aux_picker_inventory.py` | Auxiliary-task pickers share one provider-inventory substrate. Every aux picker (``hermes model`` → Configure auxiliary models, the ``hermes tools``. |
| `tests/hermes_cli/test_azure_detect.py` | hermes_cli.azure_detect — transport & model auto-detection. |
| `tests/hermes_cli/test_azure_foundry_entra.py` | Azure Foundry Entra ID runtime resolution. Covers the contract introduced in PR for Microsoft Entra ID auth on ``azure-foundry``: *. |
| `tests/hermes_cli/test_backend_retirement.py` | Cooperative retirement is a reservation, never a sampled idle. |
| `tests/hermes_cli/test_backup.py` | hermes backup and import commands. |
| `tests/hermes_cli/test_backup_all_profiles.py` | the #66140 fix: pre-update snapshots cover every profile. |
| `tests/hermes_cli/test_backup_cron_prompts_lock.py` | Cron prompt recovery (#82990) must serialize with cron writers: it re-reads jobs.json under the canonical cron lock and publishes via the locked. |
| `tests/hermes_cli/test_backup_import_deleted_holder.py` | Invariant: importing a backup must not publish a NEW state.db inode while a live process still holds the deleted one (#110179). |
| `tests/hermes_cli/test_backup_path_errors.py` | test: `hermes backup -o <bad path>` errors cleanly (round-3 SUB-01). Before, an unwritable/nonexistent-parent output path raised a raw. |
| `tests/hermes_cli/test_backup_preflight.py` | Preflight must work while the app is broken and its database is still. |
| `tests/hermes_cli/test_backup_retention_roundtrip.py` | hermes backup retention (--keep) and the session-store import round. |
| `tests/hermes_cli/test_backup_stability.py` | test_backup_lock_rejects_a_second_operation, test_atomic_output_publishes_only_after_clean_close. |
| `tests/hermes_cli/test_backup_zip_serialization.py` | The manual and automatic archive paths use the same WAL-safe serialization. |
| `tests/hermes_cli/test_bang_shell_mode.py` | `!<command>` shell mode in the interactive CLI. Covers bang detection/parsing, that the terminal tool's approval gate is invoked for a. |
| `tests/hermes_cli/test_banner.py` | banner toolset name normalization and skin color usage. |
| `tests/hermes_cli/test_banner_distribution_label.py` | The banner names the desktop shell shape, not just "desktop-app". An old-style installer artifact (payload ``bootstrap``, mechanism ``self``) runs. |
| `tests/hermes_cli/test_banner_release_channel.py` | Passive checks use the same release selection as explicit source. |
| `tests/hermes_cli/test_banner_skills.py` | banner get_available_skills() — disabled and platform filtering. |
| `tests/hermes_cli/test_banner_skills_width.py` | banner skills display — terminal-width-aware truncation. |
| `tests/hermes_cli/test_bare_custom_picker_row.py` | The bare ``model.provider: custom`` picker row must survive switching away. The row is built from the session's current-provider slice when the. |
| `tests/hermes_cli/test_base_url_host_identity.py` | tests: provider-identity checks must compare URL *hostnames*, not raw substrings. Port of earendil-works/pi#7933's bug class (DeepSeek. |
| `tests/hermes_cli/test_bedrock_mantle_key_env.py` | Bedrock API-key setup must produce a config that actually authenticates. The wizard used to stash the Bedrock bearer token in ``OPENAI_API_KEY`` and. |
| `tests/hermes_cli/test_bedrock_model_picker.py` | AWS Bedrock integration in the model picker and provider catalog. Covers the three paths changed by. |
| `tests/hermes_cli/test_bedrock_region_scoped_picker.py` | #28156 — Bedrock picker must be region-scoped. Geo-prefixed cross-region inference profiles (us.*, eu.*, apac.*, ...) only. |
| `tests/hermes_cli/test_billing_portal_url.py` | Portal-URL resolution for Phase 2b billing errors (nous_billing). The server emits ``portalUrl`` relative by design (``/billing?topup=open``); the. |
| `tests/hermes_cli/test_billing_scope_stepup.py` | the Phase 2b billing:manage scope step-up (auth.py). |
| `tests/hermes_cli/test_boot_bootstrap.py` | Boot-time post-update bootstrap: identity, records, locks, single-flight. The record files are an optimization layer over idempotent steps; these. |
| `tests/hermes_cli/test_boot_convergence.py` | Real startup paths share one passive PM verdict, including fast. |
| `tests/hermes_cli/test_boot_preset_staleness.py` | Every staged model must launch with a policy decision, never stock fit. The managed server autoloads any GGUF in its models dir; a model missing. |
| `tests/hermes_cli/test_boot_wiring.py` | C26 wiring: the boot registry is reached by the real entry points, and the cadence has a production caller. Proven with real imports against a temp. |
| `tests/hermes_cli/test_borrowed_home_launch.py` | A launch under a data root that does not own the checkout leaves the checkout to its owner (#123238). Layout in every test: the user's default root. |
| `tests/hermes_cli/test_bot_desktop_screen_status.py` | ``hermes computer-use screen status`` shows the lease the way every RPC surface does: the holder's viewer id is a capability (whoever presents it. |
| `tests/hermes_cli/test_bot_desktop_screen_stop.py` | The documented CLI stop --force is also recovery for a disconnected viewer's. |
| `tests/hermes_cli/test_bounded_probe_run.py` | ``bounded_probe_run`` — deadlock-safe capture for fail-open probes (#87134). On Windows, ``subprocess.run(..., capture_output=True, timeout=N)`` can. |
| `tests/hermes_cli/test_bracketed_paste_timeout.py` | bracketed-paste timeout safety valve (#16263). Verifies the production helper in cli.py monkey-patches prompt_toolkit's Vt100Parser.feed(). |
| `tests/hermes_cli/test_branch_command.py` | the /branch (/fork) command — session branching. Verifies that: - Branching creates a new session with copied conversation history - The. |
| `tests/hermes_cli/test_browser_connect_default_chromium.py` | Default-Chromium detection and profile-dir resolution (hermes_cli.browser_connect). These exercise the parsers with real command output shapes. |
| `tests/hermes_cli/test_browser_connect_dual_stack.py` | Dual-stack loopback discovery + port-squatter handling for /browser connect. Regression context: on Windows, an IDE debugger (VS Code js-debug). |
| `tests/hermes_cli/test_browser_connect_media_permissions.py` | The chrome-debug Chromium profile and Hermes media-cache dirs are created owner-only. ``$HERMES_HOME/chrome-debug`` is a real Chromium user-data dir. |
| `tests/hermes_cli/test_browser_connect_real_profile_snapshot_errors.py` | Real-profile snapshot while the browser runs, and the error when cookies can't be read. A running Chrome on macOS/Linux lets ``Cookies`` back up but. |
| `tests/hermes_cli/test_browser_runtime.py` | Browser resolution uses installed PM facts without provisioning a. |
| `tests/hermes_cli/test_bundled_desktop_launch.py` | ``hermes desktop`` from inside a BUNDLED desktop payload. A bundled artifact ships the CLI inside ``<app>/resources/agent-payload`` and the desktop. |
| `tests/hermes_cli/test_bundles.py` | hermes_cli/bundles.py — the `hermes bundles` CLI subcommand. |
| `tests/hermes_cli/test_busy_input_mode_command.py` | the /busy CLI command and busy-input-mode config handling. |
| `tests/hermes_cli/test_busy_policy_invariants.py` | Invariant tests for the declarative busy_policy on CommandDef. Guards the contract introduced by the Guard-2 refactor (gateway/run.py): every. |
| `tests/hermes_cli/test_bytecode_sweep.py` | the launch-time stale-bytecode sweep (checkout fingerprint guard). Bug class: the checkout's ``.py`` files change (``hermes update``. |
| `tests/hermes_cli/test_cached_fetch_api_models.py` | Cache-contract tests for ``cached_fetch_api_models()``. Custom OpenAI-compatible endpoints (named ``custom_providers`` rows, bare ``provider. |
| `tests/hermes_cli/test_canonical_custom_identity.py` | ``canonical_custom_identity`` must return the durable config-key identity. A keyed ``providers:`` entry's identity is its config key, not its. |
| `tests/hermes_cli/test_catalog_json.py` | The pulled catalog: packaged JSON is the offline truth, a GitHub fetch swaps entries in memory only, and min_engine gates day-0 models. Nothing here. |
| `tests/hermes_cli/test_catalog_variants.py` | Variant-selection contracts: fit the catalog's single Q4-class build to a machine and price it honestly. Pure decision-table tests over synthetic. |
| `tests/hermes_cli/test_chat_c_fail_loudly.py` | `chat -c <title>` failing loudly (stderr) and `--create-if-missing`. Regression for #86794: a background/quiet `hermes chat -c "<title>". |
| `tests/hermes_cli/test_chat_catalog_excludes_generation_models.py` | Chat catalogs must not offer generation models, and a direct switch must reject them. Name shape and capability type are the catalog's own signals —. |
| `tests/hermes_cli/test_chat_q_exit_clear.py` | #53009: chat -q final response erased by exit-summary clear. |
| `tests/hermes_cli/test_chat_query_file.py` | --query-file: single-query text arrives verbatim, never shell-interpreted. Regression tests for the Bot Mode DM injection fix: the DM protocol used. |
| `tests/hermes_cli/test_chat_skills_flag.py` | test_top_level_skills_flag_defaults_to_chat, test_continue_worktree_and_skills_flags_work_together. |
| `tests/hermes_cli/test_chat_turn_streaming_tts_arming.py` | Streaming-TTS arm gate regression (#84046): ``_chat_setup_turn_audio`` used to gate streaming TTS on a ``sounddevice`` import, which raises on macOS. |
| `tests/hermes_cli/test_checkout_mutation_guards.py` | The test suite must never mutate the LIVE checkout or its venv. Regression tests for the pytest-guards on the checkout-root mutation paths. Before. |
| `tests/hermes_cli/test_checkpoints_clear_legacy.py` | `hermes checkpoints clear-legacy` exit code must reflect whether the archives are gone. `clear_legacy()` counts failed deletions as ``errors`` and. |
| `tests/hermes_cli/test_checkpoints_prune.py` | `hermes checkpoints prune`'s orphan confirmation flow. Covers the P1 raised on PR #69141: the confirmation preview must cover BOTH v2. |
| `tests/hermes_cli/test_classic_browser_manage.py` | CLI-9: the classic CLI's /browser goes to the gateway (``browser.manage``), like Ink and Desktop. Browser tools run in the gateway, so a ``/browser. |
| `tests/hermes_cli/test_classic_cli_routing.py` | The classic CLI is main's HermesCLI again: `hermes` / `hermes chat` (interactive and -q) reach ``cli.main``; only stream-json and the safe-mode. |
| `tests/hermes_cli/test_claude_code_account_connection.py` | Accounts Connected must follow Claude Code token validity, not token. |
| `tests/hermes_cli/test_claw.py` | hermes claw commands. |
| `tests/hermes_cli/test_clear_stale_base_url.py` | _clear_stale_openai_base_url() cleanup after provider switch (#5161). |
| `tests/hermes_cli/test_cli_active_session_limit.py` | test_cli_claim_active_session_respects_global_limit. |
| `tests/hermes_cli/test_cli_async_delegation_delivery.py` | coverage for CLI async-delegation completion ownership. |
| `tests/hermes_cli/test_cli_background_busy_path.py` | classic-CLI mid-run /bg and /btw dispatch. Background ---------- ``/bg`` (formerly ``/background``) exists to start independent. |
| `tests/hermes_cli/test_cli_background_status_indicator.py` | the /bg indicator in the CLI status bar. The classic prompt_toolkit status bar shows `▶ N` when N tasks launched via `/bg` are still. |
| `tests/hermes_cli/test_cli_billing_i18n.py` | The billing/subscription CLI copy resolves through the i18n catalog at call time. Menu labels and outcome copy used to live in import-time module. |
| `tests/hermes_cli/test_cli_bracketed_paste_sanitizer.py` | defensive bracketed-paste wrapper stripping in the CLI. |
| `tests/hermes_cli/test_cli_browser_connect.py` | CLI browser CDP auto-launch helpers. |
| `tests/hermes_cli/test_cli_clarify_batch.py` | Batch (multi-question) clarify panel state machine — CLI side. Drives ``_clarify_callback`` with a ``questions`` list on a background thread (the. |
| `tests/hermes_cli/test_cli_clarify_panel_height.py` | Batch clarify panel stays inside the viewport so choices remain selectable. The panel is an unsized Window. HSplit clips the tail, and the active. |
| `tests/hermes_cli/test_cli_cmd_backspace.py` | Verify Cmd+Backspace / Cmd+ForwardDelete byte sequences from CSI-u terminals reach prompt_toolkit's readline kill bindings instead of leaking into. |
| `tests/hermes_cli/test_cli_command_messages.py` | User-facing message contracts for `hermes skills/plugins/mcp/cron/doctor` failure paths. Every failure line must say what happened and name an. |
| `tests/hermes_cli/test_cli_config_vertex_label.py` | T6 (#134889): classic-CLI ``/config`` on a Vertex route names the credential honestly. The gateway-backed CLI resolves Vertex under. |
| `tests/hermes_cli/test_cli_context_reference_passthrough.py` | The classic CLI leaves ``@`` references to the gateway, which expands them once against the session's cwd; a client-side pass first expanded them. |
| `tests/hermes_cli/test_cli_context_warning.py` | the low context length warning in the CLI banner. |
| `tests/hermes_cli/test_cli_copy_command.py` | CLI /copy command. |
| `tests/hermes_cli/test_cli_ctrl_c_draft_priority.py` | Ctrl+C / Ctrl+Q in the classic CLI: a typed draft wins over interrupting a running turn. Mirrors the Ink TUI's ``resolveCtrlCComposerAction``. |
| `tests/hermes_cli/test_cli_custom_provider_vision.py` | End-to-end CLI coverage for named custom-provider vision routing. Adapted from the independently reproduced CLI regression in #69896. Unlike that. |
| `tests/hermes_cli/test_cli_delegate_background_notice.py` | The CLI spells out auto-resume when a delegate_task goes to the background. A top-level ``delegate_task`` returns a handle immediately and runs the. |
| `tests/hermes_cli/test_cli_extension_hooks.py` | protected HermesCLI TUI extension hooks. Verifies that wrapper CLIs can extend the TUI via: - _get_extra_tui_widgets() -. |
| `tests/hermes_cli/test_cli_external_editor.py` | CLI external-editor support. |
| `tests/hermes_cli/test_cli_fallback_chain_hot_reload.py` | An open classic-CLI chat adopts a ``fallback_providers`` chain added after it started (#95066). ``HermesCLI`` holds one long-lived agent and read. |
| `tests/hermes_cli/test_cli_file_drop.py` | _detect_file_drop — file path detection that prevents dragged/pasted absolute paths from being mistaken for slash. |
| `tests/hermes_cli/test_cli_first_message.py` | A fresh install's first CLI message reaches the model exactly as typed. The first-contact note (the profile-build offer or the plain intro) is sent. |
| `tests/hermes_cli/test_cli_first_run_setup.py` | First-run onboarding routing for a completely unconfigured install. Regression tests for the "keyless first run boots into a broken chat" bug: a. |
| `tests/hermes_cli/test_cli_footer_split.py` | The classic CLI footer never paints prompt_toolkit's "Window too small..." placeholder. Regression for #57393: a footer row appearing between the. |
| `tests/hermes_cli/test_cli_force_redraw.py` | CLI redraw helpers used to recover from terminal buffer drift. Covers: - _force_full_redraw (#8688 cmux tab switch, /redraw, Ctrl+L) - the. |
| `tests/hermes_cli/test_cli_gateway_model_route.py` | The classic CLI's model choices reach the gateway session. ``/model`` swaps the live agent, and ``/moa`` rebuilds it on the MoA route. Both have to. |
| `tests/hermes_cli/test_cli_gateway_model_scope.py` | ``/model --once`` is one turn; a session ``/model`` is the session's route. ``--once`` swaps the agent and restores it after one turn, and never. |
| `tests/hermes_cli/test_cli_goal_interrupt.py` | CLI goal-continuation interrupt handling. Covers: - Ctrl+C during a /goal turn auto-pauses the goal (no more continuations). -. |
| `tests/hermes_cli/test_cli_goal_kick_prompt.py` | `/goal <text>` kicks the loop with a short pointer when the user's last message already carries the goal. In one run `/goal <2,000-char handoff. |
| `tests/hermes_cli/test_cli_goal_parked_resume.py` | A parked /goal resumes from the idle hook once its barrier lifts, without waiting for another. |
| `tests/hermes_cli/test_cli_image_command.py` | test_handle_image_command_attaches_local_image, test_handle_image_command_bare_shows_usage. |
| `tests/hermes_cli/test_cli_import_without_patch_stdout.py` | ``cli`` must import even when ``prompt_toolkit.patch_stdout`` is missing (#96075). The top-level ``from prompt_toolkit.patch_stdout import. |
| `tests/hermes_cli/test_cli_info_i18n.py` | CLI info/help copy resolves through the i18n catalog: /help consumes ``CommandDef.describe()``, module-level label tables became call-time lookups. |
| `tests/hermes_cli/test_cli_init.py` | HermesCLI initialization -- catches configuration bugs that only manifest at runtime (not in mocked unit. |
| `tests/hermes_cli/test_cli_insights_command.py` | test_cli_insights_accepts_positional_days, test_cli_insights_keeps_days_flag_and_source. |
| `tests/hermes_cli/test_cli_interrupt_ack_race.py` | the CLI interrupt-acknowledgement race. Symptom (user report, July 2026): interrupting an active turn is unreliable — the. |
| `tests/hermes_cli/test_cli_interrupt_drain_regression.py` | test for #20271: classic-CLI hangs when messages typed during an agent turn never leave ``_interrupt_queue``. Background ---------- The. |
| `tests/hermes_cli/test_cli_interrupt_subagent.py` | End-to-end test simulating CLI interrupt during subagent execution. Reproduces the exact scenario: 1. Parent agent calls delegate_task 2. Child. |
| `tests/hermes_cli/test_cli_light_mode.py` | the light-mode terminal detection + color remap in cli.py. Covers the env-override path and the SkinConfig.get_color() wrapper that the. |
| `tests/hermes_cli/test_cli_loading_indicator.py` | loading feedback on slow slash commands. |
| `tests/hermes_cli/test_cli_manual_compress.py` | test_manual_compress_does_not_pass_cached_system_prompt, test_manual_compress_flush_failure_discards_notification. |
| `tests/hermes_cli/test_cli_markdown_rendering.py` | test_final_assistant_content_uses_markdown_renderable, test_final_assistant_content_keeps_non_path_markdown_escapes. |
| `tests/hermes_cli/test_cli_mcp_config_watch.py` | automatic MCP reload when config.yaml mcp_servers section changes. |
| `tests/hermes_cli/test_cli_model_once.py` | test_cli_model_once_records_restore_and_does_not_persist, test_cli_restore_model_runtime_snapshot_restores_agent. |
| `tests/hermes_cli/test_cli_model_switch_i18n.py` | The /model switch mixin's CLI copy resolves through the i18n catalog at call. |
| `tests/hermes_cli/test_cli_modern_layout.py` | The glyph CLI layout (``display.cli_layout: modern``): scrollback rows never depend on the terminal width, and the status line renders under the. |
| `tests/hermes_cli/test_cli_new_session.py` | CLI fresh-session commands. |
| `tests/hermes_cli/test_cli_output.py` | test_line_input_supports_cursor_and_emacs_navigation, test_line_input_preserves_builtin_input_for_redirected_stdin. |
| `tests/hermes_cli/test_cli_partial_update_hint.py` | Chat startup must explain a mixed-version ImportError (#96900). A half-updated install can ship a newer ``cli.py`` (or launcher) importing config. |
| `tests/hermes_cli/test_cli_pet_pane.py` | The base-CLI petdex pane: reactive half-block sprite above the prompt. Mirrors the TUI's PetPane. The methods are tested in isolation via __new__ so. |
| `tests/hermes_cli/test_cli_prefix_matching.py` | slash command prefix matching in HermesCLI.process_command. |
| `tests/hermes_cli/test_cli_profile_toolsets.py` | A stale ``platform_toolsets.cli`` entry (a toolset whose plugin was uninstalled) must not refuse every `hermes chat` (#138670): the profile default. |
| `tests/hermes_cli/test_cli_provider_resolution.py` | test_provider_flag_uses_named_custom_default_model, test_explicit_model_wins_over_provider_default_model. |
| `tests/hermes_cli/test_cli_queue_gateway_fifo.py` | The classic CLI's ``/queue`` goes into the gateway's durable FIFO (refs #134889, N5). On main ``/queue <prompt>`` typed while a turn runs only. |
| `tests/hermes_cli/test_cli_queue_paste.py` | collapsed paste references passed to /queue. |
| `tests/hermes_cli/test_cli_quiet_stdout_leak.py` | `hermes chat -Q` must not leak presentation output into stdout. |
| `tests/hermes_cli/test_cli_reload_skills.py` | the ``/reload-skills`` CLI slash command (``HermesCLI._reload_skills``). The CLI handler prints the diff (name + description) for the user. |
| `tests/hermes_cli/test_cli_resume_command.py` | test_show_recent_sessions_includes_indexes_and_resume_hint, test_handle_resume_by_index_switches_to_numbered_session. |
| `tests/hermes_cli/test_cli_retire_agent.py` | The interactive CLI must release the old AIAgent's LLM clients when it drops the instance for a rebuild (/personality, /reasoning, /fast. |
| `tests/hermes_cli/test_cli_retry.py` | CLI /retry and carrier-aware rewind semantics. |
| `tests/hermes_cli/test_cli_save_config_value.py` | save_config_value() in cli.py — atomic write behavior. |
| `tests/hermes_cli/test_cli_secret_capture.py` | test_secret_capture_callback_can_be_completed_from_cli_state_machine, test_cancel_secret_capture_marks_setup_skipped. |
| `tests/hermes_cli/test_cli_session_store_shared_registry.py` | The CLI's session store is the gateway's, never a state.db writer in the CLI process. Main acquired ``hermes_state_registry`` (a writer handle) at. |
| `tests/hermes_cli/test_cli_sessions_behind_newer_surfaces.py` | CLI session lookups must page by creating surface, not by a fixed local window. Gateway rows for Desktop, TUI and the classic CLI are stored as. |
| `tests/hermes_cli/test_cli_shift_enter_newline.py` | Verify Shift+Enter byte sequences parse to the same key tuple Alt+Enter produces, so the existing Alt+Enter newline handler in `cli.py` fires for. |
| `tests/hermes_cli/test_cli_shutdown_memory_messages.py` | #15165 (CLI sibling site) — CLI exit cleanup must forward the agent's conversation transcript to ``shutdown_memory_provider``. |
| `tests/hermes_cli/test_cli_skin_integration.py` | test_secret_prompt_fragments_preserve_secret_state, test_narrow_terminals_compact_voice_recording_prompt_fragments. |
| `tests/hermes_cli/test_cli_startup_maintenance_off_main_thread.py` | The CLI's startup housekeeping (curator pass, skill sync) must never hold the prompt. A due weekly curator pass on a large library snapshotted and. |
| `tests/hermes_cli/test_cli_startup_model_cost_guard.py` | test_cmd_chat_rejects_noninteractive_gpt55_pro_startup_override, test_cmd_chat_rejects_noninteractive_gpt55_pro_even_with_yolo. |
| `tests/hermes_cli/test_cli_startup_trim.py` | Startup/exit work that belongs to the gateway never runs in the classic CLI's process. Rewired, every chat turn executes in the gateway session. |
| `tests/hermes_cli/test_cli_status_bar.py` | test_session_title_is_right_aligned_after_it_is_queued, test_snapshot_refreshes_persisted_session_title. |
| `tests/hermes_cli/test_cli_status_bar_goal.py` | Status-bar goal segment (⊙ goal N/M) — active-goal-only rendering. The segment mirrors the desktop composer goal indicator: it appears only while a. |
| `tests/hermes_cli/test_cli_status_canonical_session_id.py` | T16 (#134889): classic-CLI ``/status`` names a gateway session by its canonical ``local-…`` id. Main printed the ``YYYYMMDD_HHMMSS_<hex>`` id it. |
| `tests/hermes_cli/test_cli_status_command.py` | CLI /status command behavior. |
| `tests/hermes_cli/test_cli_steer_busy_path.py` | classic-CLI mid-run /steer dispatch. Background ---------- /steer sent while the agent is running used to be queued through. |
| `tests/hermes_cli/test_cli_terminal_response_sanitizer.py` | defensive terminal control-response stripping in the CLI. Covers Cursor Position Report (CPR / DSR) responses that occasionally leak into. |
| `tests/hermes_cli/test_cli_terminal_shortcuts.py` | terminal navigation/focus escape sequences. Ghostty/macOS window and tab navigation can deliver terminal focus reports (CSI I /. |
| `tests/hermes_cli/test_cli_tools_command.py` | /tools slash command handler in the interactive CLI. |
| `tests/hermes_cli/test_cli_tui_i18n_lazy_labels.py` | TUI approval labels and modal hints are catalog lookups at render time, not import-time text. A language pack registered (or ``display.language``. |
| `tests/hermes_cli/test_cli_user_message_preview.py` | test_default_preview_shows_first_two_lines_and_last_two_lines. |
| `tests/hermes_cli/test_cli_yolo_resume_persistence.py` | tests: YOLO mode persists across ``hermes --resume``. Pre-fix bug: the ``/yolo`` toggle (and the process-start ``--yolo`` flag) lived. |
| `tests/hermes_cli/test_cli_yolo_toggle.py` | the CLI ``/yolo`` in-chat toggle. Pre-fix bug (issue #33925): ``cli.HermesCLI._toggle_yolo`` mutated only. |
| `tests/hermes_cli/test_clipboard_text_write.py` | native clipboard text write (hermes_cli/clipboard.py). Mirrors the TUI's writeClipboardText fallback chain: pbcopy / PowerShell. |
| `tests/hermes_cli/test_cmd_uninstall.py` | The real uninstall parser must select the data path, never code. |
| `tests/hermes_cli/test_cmd_update.py` | Git trampoline recovery; branch updates use the real target-identity. |
| `tests/hermes_cli/test_cmd_update_docker.py` | ``hermes update`` / ``--check`` inside the Docker container. Background: ``.dockerignore`` excludes ``.git``, so the existing git-pull. |
| `tests/hermes_cli/test_coalesce_session_args.py` | _coalesce_session_name_args — multi-word session name merging. |
| `tests/hermes_cli/test_code_skew.py` | gateway code-skew detection (stale-checkout guard). Companion to ``tests/test_stale_utils_module_import.py``: that test proves the crash. |
| `tests/hermes_cli/test_codex_cli_model_picker.py` | the /model picker's credential-discovery paths. Covers: - Normal path (tokens already in Hermes auth store) - Claude Code. |
| `tests/hermes_cli/test_codex_credential_host_binding.py` | A Codex credential is only ever sent to the host it belongs to (#121486). Adversarial regressions for the catalog picker, the context probe, the. |
| `tests/hermes_cli/test_codex_device_login_ssl_hint.py` | Codex device-login transport errors keep the underlying SSL detail and add a hint (#106384). OpenSSL 3.5+ advertises post-quantum hybrid groups. |
| `tests/hermes_cli/test_codex_device_login_transient_retry.py` | Codex device-login survives transient transport blips. A single dropped connection (e.g. an SSL EOF between polls) used to abort the whole. |
| `tests/hermes_cli/test_codex_models.py` | test_codex_catalog_never_offers_chatgpt_rejected_pro_slugs, test_picker_synthesizes_900k_variants_for_verified_slugs. |
| `tests/hermes_cli/test_codex_relogin_copy_names_profile.py` | Codex credential-failure copy sends the user to THIS profile's own sign-in. Profiles are islands (93889b770da): a bare ``hermes auth`` / ``hermes. |
| `tests/hermes_cli/test_codex_runtime_plugin_migration.py` | the codex MCP plugin migration helper. |
| `tests/hermes_cli/test_codex_runtime_switch.py` | the /codex-runtime slash-command shared logic. These cover the pure-Python state machine; CLI and gateway handlers are tested separately. |
| `tests/hermes_cli/test_codex_token_writethrough.py` | Codex OAuth refresh writes back to the store the grant was resolved FROM (#87503). Codex refresh tokens are single-use with rotation-family reuse. |
| `tests/hermes_cli/test_command_palette.py` | /help declutter + Ctrl+P command palette (C-04 / C-05). |
| `tests/hermes_cli/test_commands.py` | the central command registry and autocomplete. |
| `tests/hermes_cli/test_commands_execute.py` | Invariant for registry-owned slash execution (CommandDef.execute). Every ``CommandDef`` with ``execute`` set must name a key that exists in. |
| `tests/hermes_cli/test_commit_build_cli.py` | Exercise the installed CLI with a sealed code copy and its build. |
| `tests/hermes_cli/test_commit_build_updates.py` | A one-commit artifact cannot enter any self-update path. |
| `tests/hermes_cli/test_completer_config_reads.py` | The /personality completer memoises the parsed config per keystroke, but a config edit on disk must show up in the next completion (never a stale. |
| `tests/hermes_cli/test_completion.py` | hermes_cli/completion.py — shell completion script generation. |
| `tests/hermes_cli/test_completion_backlog.py` | Completion backlogs preserve results without multiplying autonomous. |
| `tests/hermes_cli/test_compress_flags.py` | /compress --preview/--dry-run/--aggressive flags and the /compact alias (PR #3243 salvage). Covers the pure helpers in. |
| `tests/hermes_cli/test_compress_here.py` | /compress here [N] — boundary-aware partial compression. Verifies the CLI handler (_manual_compress) splits the history, compresses only. |
| `tests/hermes_cli/test_computer_use_cli.py` | CLI coverage for the public Computer Use command surface. |
| `tests/hermes_cli/test_computer_use_screen_install.py` | `hermes computer-use screen install` shares the Desktop pane's installer (one lock, list-form. |
| `tests/hermes_cli/test_config.py` | hermes_cli configuration management. |
| `tests/hermes_cli/test_config_backups.py` | config.yaml backups: one dir, deduped, bounded — never a pile of siblings in. |
| `tests/hermes_cli/test_config_cache_signature.py` | #111105: a config.yaml replacement that keeps mtime and size (``cp -p``, ``rsync -t``, a timestamp-pinning writer) must still invalidate the. |
| `tests/hermes_cli/test_config_check_diagnostics.py` | Config check reports stale saved capabilities without changing profile. |
| `tests/hermes_cli/test_config_client_env_passthrough.py` | ``terminal.client_env_passthrough`` (a shell client's extra toolchain names) is a registered. |
| `tests/hermes_cli/test_config_display_language.py` | ``hermes config set display.language`` accepts every ``supported_languages()`` id — bundled, alias, and a plugin language pack found through real. |
| `tests/hermes_cli/test_config_dotted_key_names.py` | dotted config key names (#84064 bug class). Every issue in the family has a distinct repro shape, all rooted in the same. |
| `tests/hermes_cli/test_config_edit_seed.py` | Every writer that seeds or first-configures config.yaml must leave each messaging platform's display defaults alone (#121230). The gateway loader. |
| `tests/hermes_cli/test_config_effective.py` | Invariants for ``hermes_cli.config_effective.load_user_config_effective`` — the one loader every defaults-free config reader (gateway runtime, TUI. |
| `tests/hermes_cli/test_config_env_expansion.py` | ${ENV_VAR} substitution in config.yaml values. |
| `tests/hermes_cli/test_config_env_ref_parity.py` | Config `${env:VAR}` SecretRef parity (salvaged from PR #59516). `${env:VAR}` already resolved in MCP server config (mcp_tool._env_ref_name). |
| `tests/hermes_cli/test_config_env_refs.py` | test_save_config_preserves_unresolved_env_refs, test_save_config_allows_intentional_secret_value_change. |
| `tests/hermes_cli/test_config_guard_surfaces.py` | Fail-closed corrupt-config guards on gateway, serve, and cron surfaces. Companion to test_noninteractive_config_guard.py (PR #81988): issue #81952. |
| `tests/hermes_cli/test_config_lkg_backup.py` | A fresh process recovers the last successfully parsed config.yaml when the file is broken. The in-process last-known-good (#31188 port) only helps a. |
| `tests/hermes_cli/test_config_loader_e2e.py` | E2E for the canonical-loader migration (managed-scope/env-expansion drift fix). Runs a real subprocess with a temp HERMES_HOME whose config.yaml. |
| `tests/hermes_cli/test_config_lock_free_cache_hit.py` | A cached config read must not block behind a config WRITER. ``_load_config_impl`` served cache hits from inside ``_CONFIG_LOCK``, which. |
| `tests/hermes_cli/test_config_migration_45_connections.py` | Migration 44→45: saved ``platform_toolsets`` lists gain the ``connections`` toolset. ``hermes tools`` persists an explicit per-platform toolset. |
| `tests/hermes_cli/test_config_migration_48_sandbox_image.py` | Migration 47→48: the container sandbox default becomes nousresearch/hermes-sandbox:desktop. Contract: a saved image still equal to the OLD default. |
| `tests/hermes_cli/test_config_migration_49_vercel_image.py` | Migration 48→49: Vercel Sandbox moves from the deprecated `node24` runtime to a managed image. Contract: a saved runtime still equal to the old. |
| `tests/hermes_cli/test_config_migration_50_tirith.py` | Config v50: the bundled tirith scanner left Hermes. |
| `tests/hermes_cli/test_config_migration_nested_guards.py` | Config migrations survive malformed nested values (#116593). Hand-edited or legacy config.yaml files hold scalars where a migration step expects a. |
| `tests/hermes_cli/test_config_platform_env_routing.py` | ``hermes config set/get/unset`` route every name Hermes registers as an environment variable to ``.env`` — the file the platform setup flows and. |
| `tests/hermes_cli/test_config_provider_id_string.py` | #117345: ``model.provider`` must survive config load as a string. An unquoted YAML scalar (``provider: 2``) loads as ``int``, and. |
| `tests/hermes_cli/test_config_read_guard.py` | Lint guard: no new raw yaml.safe_load(config.yaml) reads outside owner modules. The drift class this kills: scattered ``yaml.safe_load`` reads of. |
| `tests/hermes_cli/test_config_retired_key_migrations.py` | Config migrations that retire or rewrite obsolete keys (v43 / v44 / v51, stamp-independent. |
| `tests/hermes_cli/test_config_rmw_lock.py` | Concurrent dashboard config writers must not drop each other's mutations. Only ``PUT /api/config`` (and the ``config_write_scope`` routers) held. |
| `tests/hermes_cli/test_config_save_integrity.py` | config.yaml write integrity: a failed read never reaches disk, and a save keeps what the user. |
| `tests/hermes_cli/test_config_set_coercion.py` | `config set` value coercion + key validation (round-3 CFG). Covers: - CFG-02: negative / whitespace-padded numerics coerce to. |
| `tests/hermes_cli/test_config_set_list_values.py` | ``hermes config set`` must parse list/mapping literals, not store them as strings. Before this fix, ``hermes config set platform_toolsets.discord. |
| `tests/hermes_cli/test_config_set_platforms_redirect.py` | #71047 (Problem A): per-platform display settings. `hermes config set platforms.<name>.<display_setting> <value>` must write to. |
| `tests/hermes_cli/test_config_unversioned_migration.py` | A config.yaml without ``_config_version`` is current-schema content that was never stamped: the installers seed it from cli-config.yaml.example and. |
| `tests/hermes_cli/test_config_validation.py` | config.yaml structure validation (validate_config_structure). |
| `tests/hermes_cli/test_config_worker_save_deletion.py` | A frozen managed worker's config write-back never resurrects a branch the operator. |
| `tests/hermes_cli/test_config_yaml_comment_preservation.py` | guard for #92554: every config.yaml writer preserves user comments and key order. Each test seeds a hand-commented config.yaml, runs one. |
| `tests/hermes_cli/test_configured_builtin_models.py` | Configured models extend built-in picker rows. |
| `tests/hermes_cli/test_connectors_cmd.py` | Behaviour contracts for ``hermes connectors``. |
| `tests/hermes_cli/test_console_engine.py` | test_sessions_optimize_accepts_the_force_override_it_advertises, test_sessions_list_and_stats_use_isolated_session_store. |
| `tests/hermes_cli/test_container_aware_cli.py` | container-aware CLI routing (NixOS container mode). When container.enable = true in the NixOS module, the activation script writes a. |
| `tests/hermes_cli/test_container_boot.py` | hermes_cli.container_boot — the cont-init.d-time reconciliation that recreates per-profile gateway s6 service slots from the persistent. |
| `tests/hermes_cli/test_context_cache_switch_guard.py` | Context-cache model-switch guard. A mid-session model switch abandons the provider prompt cache, so the first call after the switch re-reads the. |
| `tests/hermes_cli/test_context_switch_guard.py` | hermes_cli.context_switch_guard. |
| `tests/hermes_cli/test_copilot_auth.py` | hermes_cli.copilot_auth — Copilot token validation and resolution. |
| `tests/hermes_cli/test_copilot_catalog_oauth_fallback.py` | Catalog-API-key fallback for the Copilot ``/model`` picker. Regression for #16708: when the user's only Copilot credential is a ``gho_*`` token. |
| `tests/hermes_cli/test_copilot_context.py` | Copilot live /models context-window resolution. |
| `tests/hermes_cli/test_copilot_custom_model_ids.py` | #110597: Copilot custom/enterprise (BYOK) model ids must survive normalization. GitHub's enterprise custom-model (BYOK) catalog. |
| `tests/hermes_cli/test_copilot_in_model_list.py` | GitHub Copilot entries shown in the /model picker. |
| `tests/hermes_cli/test_copilot_model_api_mode.py` | Copilot model API-mode routing. |
| `tests/hermes_cli/test_copilot_runtime_api_mode.py` | Copilot runtime api_mode resolution. |
| `tests/hermes_cli/test_copilot_runtime_api_mode_stale.py` | #46527: Copilot primary api_mode resolution must not honor a stale/incompatible explicit ``api_mode``. The gateway resolves and. |
| `tests/hermes_cli/test_copilot_token_exchange.py` | Copilot token exchange (raw GitHub token → Copilot API token). |
| `tests/hermes_cli/test_corelane_frozen_worker_skill_env.py` | A frozen-policy worker never opens the profile's ``.env`` -- including the skill readiness probe. ``hermes_cli.config.load_env`` already returns. |
| `tests/hermes_cli/test_cpr_local_leak.py` | Classic-CLI prompt_toolkit output selection: native Windows keeps prompt_toolkit's default output unless PROMPT_TOOLKIT_NO_CPR opts in to the. |
| `tests/hermes_cli/test_cprint_bg_thread.py` | cli._cprint's bg-thread cooperation with prompt_toolkit. Background: when a prompt_toolkit Application is running, a bg thread that calls. |
| `tests/hermes_cli/test_credential_lifecycle.py` | E2E tests for the unified provider-credential lifecycle (#51071 #59761 #62269). A provider API key can live in .env, auth.json's credential_pool. |
| `tests/hermes_cli/test_credential_pool_off_loop.py` | the #91912 salvage — credential-pool handlers off-loop and the bounded Copilot token exchange. The 2026-08-22 incident: ``GET. |
| `tests/hermes_cli/test_cron_dashboard_off_loop.py` | tests: cron dashboard handlers must not run profile I/O on the event loop. Guards the residual sites missed by the 49fa04a23/346e5673d. |
| `tests/hermes_cli/test_cron_delivery_targets_scope.py` | Regression: the delivery-targets route read a profile secret unscoped. The dashboard/desktop ``serve`` backend flips multi-profile hosting. |
| `tests/hermes_cli/test_cron_fire_dashboard.py` | the Chronos cron-fire webhook ON THE DASHBOARD APP (web_server). Regression guard for the relocation bug: the fire webhook MUST live on. |
| `tests/hermes_cli/test_cron_parser_builder.py` | the extracted ``hermes cron`` parser builder. Confirms ``build_cron_parser`` wires up the same subactions, aliases, options, and. |
| `tests/hermes_cli/test_cron_run_history_sessions.py` | Dashboard/Desktop run history for agent cron runs the unified gateway runtime creates (#138812). A unified-runtime fire is a healthy. |
| `tests/hermes_cli/test_cron_satellite_diagnostics.py` | test_status_preserves_profile_health_contract, test_host_record_rung_names_the_roster_and_a_runnable_restart. |
| `tests/hermes_cli/test_cron_status_next_run.py` | Cron status orders persisted next runs by instant, including a DST. |
| `tests/hermes_cli/test_cron_status_profile_isolation.py` | guard for #98790 — profile isolation in cron status. Issue #98790: `hermes cron status` in profile B reports profile A's gateway PID as. |
| `tests/hermes_cli/test_cross_profile_kill_refusal.py` | Cross-profile kill refusal regression tests (#89315). A poisoned/contaminated ``gateway.pid`` inside one profile's HERMES_HOME can truthfully name. |
| `tests/hermes_cli/test_ctrl_enter_newline.py` | issue #22379 — Ctrl+Enter newline over SSH/WSL. prompt_toolkit treats c-j (LF) as Enter on POSIX so thin PTYs (docker exec. |
| `tests/hermes_cli/test_ctrlg_editor_submit.py` | Ctrl+G external-editor submit in the classic CLI. Ctrl+G opens the current draft in ``$EDITOR``; on a clean save the draft is submitted. |
| `tests/hermes_cli/test_curator_archive_prune.py` | `hermes curator archive` refuses pinned skills (with an `unpin` hint) and never archives. |
| `tests/hermes_cli/test_curator_pin_unmanaged.py` | Pin/unpin messaging on unmanaged skills (#92993). `hermes curator pin <name>` on an unmanaged skill (curation-eligible but no `created_by` marker —. |
| `tests/hermes_cli/test_curator_pin_visibility.py` | issue #92993 — `curator pin` false success + invisible pin. Two stacked defects, each with its own failing assertion: 1. |
| `tests/hermes_cli/test_curator_recent_run_notice.py` | `_print_curator_recent_run_notice`. The notice prints the most recent curator run summary on `hermes update`, exactly once per run. |
| `tests/hermes_cli/test_curator_run.py` | `hermes curator run` CLI behavior. |
| `tests/hermes_cli/test_curator_usage.py` | `hermes curator usage` — the all-skills usage view. Covers: - Lists every skill regardless of provenance (agent / bundled / hub), unlike. |
| `tests/hermes_cli/test_curses_arrow_keys.py` | arrow-key decoding in the curses menus. Root cause these guard against: on many terminals/terminfo entries, cursor keys are. |
| `tests/hermes_cli/test_curses_radiolist_viewport.py` | Exercise radiolist rendering and navigation with a bounded terminal. |
| `tests/hermes_cli/test_curses_ui_fuzzy_rank.py` | the ranked fuzzy scorer used by the searchable curses pickers. |
| `tests/hermes_cli/test_curses_ui_search.py` | test_reconcile_cursor_moves_to_first_visible_match, test_active_search_consumes_query_editing_and_confirm_keys. |
| `tests/hermes_cli/test_custom_entry_shadow_key_env.py` | A ``providers:`` entry keyed like a built-in sends its own ``key_env``, never the built-in's key. The entry's durable pool slug equals the. |
| `tests/hermes_cli/test_custom_opencode_family_runtime.py` | Custom OpenCode-family provider runtime resolution (#85589). A user-defined provider whose name extends an OpenCode family slug. |
| `tests/hermes_cli/test_custom_provider_context_feedback.py` | #2513: a blank context-length prompt in the custom-endpoint wizard tells the user whether the runtime resolver detected a value or will run on the. |
| `tests/hermes_cli/test_custom_provider_context_length.py` | custom_providers per-model context_length resolution. Covers the fix for #15779 — mid-session /model switch to a named custom. |
| `tests/hermes_cli/test_custom_provider_extra_headers.py` | per-provider ``extra_headers`` in providers / custom_providers config. PR #3526 salvage — user-configurable extra HTTP headers on LLM API. |
| `tests/hermes_cli/test_custom_provider_identity.py` | find_custom_provider_identity (base_url → custom:<name>). Reverse lookup used by tui_gateway session persistence to recover a named. |
| `tests/hermes_cli/test_custom_provider_key_env_scope.py` | Custom-provider ``key_env`` reads in the CLI picker/catalog helpers go through the profile secret scope (#67935): a key that lives only in the. |
| `tests/hermes_cli/test_custom_provider_model_switch.py` | `hermes model` always shows the model selection menu for custom providers, even when a model is already saved. Regression test for the. |
| `tests/hermes_cli/test_custom_provider_normalize_no_mutate.py` | Regression: _normalize_custom_provider_entry must never mutate its input. Provider entries frequently alias cached config dicts. |
| `tests/hermes_cli/test_custom_provider_tls.py` | per-provider TLS settings in custom_providers config. |
| `tests/hermes_cli/test_daemon_env_profile_donation.py` | A named-profile client that auto-starts the host daemon never donates its own dotenv to it. |
| `tests/hermes_cli/test_daemon_launch_env_strip.py` | One launch's hook consent and Kanban/terminal pins never reach the auto-started shared. |
| `tests/hermes_cli/test_dashboard_admin_endpoints.py` | the dashboard admin API endpoints (MCP, pairing, webhooks, credential pool, memory, gateway lifecycle, ops, skills hub). These endpoints. |
| `tests/hermes_cli/test_dashboard_auth_401_reauth.py` | Phase 6 — 401 re-auth + ``next=`` propagation tests. Verifies the contract documented in Phase 6 v2 of the plan: - API 401 responses carry. |
| `tests/hermes_cli/test_dashboard_auth_body_limit.py` | Body budgets apply before parsing public auth requests, not to. |
| `tests/hermes_cli/test_dashboard_auth_cookies.py` | the dashboard-auth cookie helpers. |
| `tests/hermes_cli/test_dashboard_auth_gate.py` | harness for the dashboard auth gate. Phase 0 — establish a baseline pin on the current (pre-OAuth) behavior so later phases can prove. |
| `tests/hermes_cli/test_dashboard_auth_middleware.py` | End-to-end behavioural tests for the dashboard auth gate. Uses ``StubAuthProvider`` so the OAuth round trip can complete in-process without any. |
| `tests/hermes_cli/test_dashboard_auth_native_flow.py` | E2E + unit tests for the RFC 8252 native-app (system-browser + loopback + PKCE) dashboard-auth flow. Covers: * ``native_flow`` broker unit behaviour. |
| `tests/hermes_cli/test_dashboard_auth_password_login.py` | the password (non-redirect) dashboard-auth login flow. Covers the protocol extension (``supports_password`` +. |
| `tests/hermes_cli/test_dashboard_auth_plugin_hook.py` | The plugin context exposes register_dashboard_auth_provider. Mirrors the image-gen / memory-provider hooks (see plugins.py:531 for prior. |
| `tests/hermes_cli/test_dashboard_auth_prefix.py` | Path-prefix (X-Forwarded-Prefix) awareness for the dashboard-auth gate. Mission-control style deployments reverse-proxy the dashboard at a path. |
| `tests/hermes_cli/test_dashboard_auth_status_endpoint.py` | Phase 7 — /api/status exposes auth-gate state + AuthWidget integration. The dashboard's status endpoint now reports ``auth_required`` and. |
| `tests/hermes_cli/test_dashboard_auth_ws_auth.py` | the WS-upgrade auth helper (Phase 5 task 5.2). The dashboard's WS endpoints (``/api/pty``, ``/api/console``, ``/api/ws``, ``/api/pub``. |
| `tests/hermes_cli/test_dashboard_auth_ws_tickets.py` | the WS-upgrade ticket store (Phase 5 task 5.1). The store is process-local and threading-safe. Under the per-file isolation runner each. |
| `tests/hermes_cli/test_dashboard_basic_auth_plugin_enable.py` | dashboard basic-auth plugin enablement (#54489). When ``dashboard.basic_auth`` is configured but the bundled ``basic`` provider. |
| `tests/hermes_cli/test_dashboard_initial_profile_bootstrap.py` | test_spa_bootstrap_includes_dashboard_initial_profile, test_spa_bootstrap_escapes_initial_profile_for_script_context. |
| `tests/hermes_cli/test_dashboard_lifecycle_flags.py` | ``hermes dashboard --stop`` / ``--status`` flags. These flags share the detection + kill path with the post-``hermes update`` cleanup, so. |
| `tests/hermes_cli/test_dashboard_oauth_endpoints_server_gate.py` | guard for PR #61281 (mobile/hosted dashboard OAuth). The PR removed the *client-side* ``X-Hermes-Session-Token`` requirement from the. |
| `tests/hermes_cli/test_dashboard_param_clamps.py` | Dashboard query-param clamps (#39200 + #74778 salvage). FastAPI Query bounds reject out-of-range values at the validation layer (422) instead of. |
| `tests/hermes_cli/test_dashboard_plugin_routes_secret_scope.py` | Dashboard agent-plugin mutations run in the request's profile scope, off the event loop. Regression for #115256: install/update reached. |
| `tests/hermes_cli/test_dashboard_procs_kill_grace.py` | The dashboard SIGTERM→SIGKILL grace must outlast the lifespan teardown (#111912), and a descendant that outlives it must not survive the stop. |
| `tests/hermes_cli/test_dashboard_register.py` | ``hermes dashboard register``. Covers the CLI half of self-hosted dashboard registration: - Docker-style auto-name generation -. |
| `tests/hermes_cli/test_dashboard_stop_spare_caller.py` | Root selection for ``dashboard --stop`` / update cleanup must spare the caller. The dashboard scan also selects the shell the ``--stop`` was typed. |
| `tests/hermes_cli/test_dashboard_system_gateway_elevation.py` | Dashboard gateway lifecycle actions must elevate on a system-scope install. Regression for #110820: the Restart Gateway button spawned ``hermes. |
| `tests/hermes_cli/test_dashboard_token_auth.py` | Contract tests for the generic non-interactive (bearer-token) auth seam. Covers Task 2.0a: the reusable token-auth capability in the dashboard auth. |
| `tests/hermes_cli/test_dashboard_tui_backcompat.py` | test: `hermes dashboard --tui` must not hard-crash. Older Hermes desktop app shells (<= 0.15.x) spawn the backend as:: hermes dashboard. |
| `tests/hermes_cli/test_dashboard_unified_launch.py` | the unified profile→machine dashboard launch routing. `<profile> dashboard` routes to ONE machine-level dashboard instead of spawning a. |
| `tests/hermes_cli/test_dashboard_web_dist_validation.py` | tests: `hermes dashboard` validates HERMES_WEB_DIST before serving. A custom HERMES_WEB_DIST without --skip-build previously skipped BOTH. |
| `tests/hermes_cli/test_data_dir_suffix.py` | Default-root isolation through the real Python resolution chain. |
| `tests/hermes_cli/test_data_uninstall.py` | Data deletion respects declared runtime ownership, confirmation and. |
| `tests/hermes_cli/test_data_uninstall_holders.py` | Data deletion must establish quiescence, never infer it from a signal. |
| `tests/hermes_cli/test_debug.py` | ``hermes debug`` CLI command and debug utilities. |
| `tests/hermes_cli/test_debug_share_update_logs.py` | tests: debug share captures update.log + desktop-update-handoff.log. A Desktop-driven update that fails at the Electron rebuild (updater. |
| `tests/hermes_cli/test_default_interface_resolution.py` | the configurable default interface (cli vs tui). `hermes` launches the classic prompt_toolkit REPL by default, but users can flip. |
| `tests/hermes_cli/test_deferred_platform_client_tools.py` | Deferred platform plugins must still register their *client* tools. Issue #78050: a bundled ``kind: platform`` plugin is registered as a deferred. |
| `tests/hermes_cli/test_deleted_profile_tombstone.py` | Deleted named profiles must stay gone until explicitly recreated. A live serve/logging process can mkdir ``profiles/<name>/logs`` after ``hermes. |
| `tests/hermes_cli/test_deprecated_cwd_warning.py` | warn_deprecated_cwd_env_vars() migration warning. |
| `tests/hermes_cli/test_desktop_build_git_windows.py` | The installer stage and later desktop product build are separate. |
| `tests/hermes_cli/test_desktop_build_lock.py` | Behavior tests for the Desktop build's cross-process lock. |
| `tests/hermes_cli/test_desktop_console.py` | Real child output must drain even when no interactive console is consuming. |
| `tests/hermes_cli/test_desktop_cron_ticker_gateway_standdown.py` | Desktop cron ticker yields to a live gateway that owns cron on the same HERMES_HOME (#52202). Every built-in path (multiplex, and the fail-open. |
| `tests/hermes_cli/test_desktop_cron_ticker_profiles.py` | Desktop cron ticker: every local profile's store must be ticked. The desktop app pools per-profile backends and reaps them after ~10 idle minutes. |
| `tests/hermes_cli/test_desktop_esbuild_ignore_scripts.py` | the esbuild / ignore-scripts build-failure diagnosis (#53082). |
| `tests/hermes_cli/test_desktop_exe_integrity.py` | Behavior tests for the Windows desktop-exe integrity gate (#69179). The desktop self-update chain (Desktop → hermes-setup --update → ``hermes. |
| `tests/hermes_cli/test_desktop_install_after_update.py` | ``hermes update`` refreshes the installed macOS ``Hermes.app`` from the rebuilt bundle (#52339). ``hermes desktop --build-only`` only packages into. |
| `tests/hermes_cli/test_desktop_lifecycle_windows_live.py` | LIVE Windows E2E for the Desktop-lifecycle cold-start skip (#76129/#76745). Runs ONLY on a real Windows host (the on-demand ``windows-venv-e2e.yml``. |
| `tests/hermes_cli/test_desktop_local_flag.py` | The desktop subcommand's --local launch flag. Local models ship on main behind this flag: `hermes desktop --local` (or `Hermes.exe --local`. |
| `tests/hermes_cli/test_desktop_native_deps_stale.py` | A matching source stamp must not hide a packaged app whose node-pty has no native binary. Regression for #62462: ``hermes desktop`` reported. |
| `tests/hermes_cli/test_desktop_profile_launch.py` | hermes desktop forwards an explicit profile into the packaged Electron launch. Electron boots from active-profile.json. ``hermes -p <name> desktop``. |
| `tests/hermes_cli/test_desktop_repo_discovery_config.py` | test_desktop_repo_discovery_defaults_are_opt_in_by_root, test_desktop_repo_discovery_keys_are_in_generated_schema. |
| `tests/hermes_cli/test_desktop_slash_registry.py` | The desktop's offline slash block-list is a dump of COMMAND_REGISTRY, never. |
| `tests/hermes_cli/test_desktop_socket_tmpdir.py` | The Electron child needs a socket-safe temp root, not a long CLI scratch path. |
| `tests/hermes_cli/test_desktop_source_build.py` | Desktop launch prepares once, then stages and publishes the local. |
| `tests/hermes_cli/test_desktop_startup_cost.py` | Startup regressions exercised against real source trees on the current host. Source freshness itself is the compiler's receipt. |
| `tests/hermes_cli/test_desktop_swap_crash_recovery.py` | A desktop app swap that died between its two renames is finished on the next swap, never erased: the previous app must survive a crash at the commit. |
| `tests/hermes_cli/test_desktop_swap_file_lock_retry.py` | Desktop stage-and-swap promotion rides out a transient Windows file lock (#112544). A real-time scanner (AV/EDR) briefly holds. |
| `tests/hermes_cli/test_desktop_update_verify.py` | Receipt validation uses packaged output, not just a source stamp. |
| `tests/hermes_cli/test_desktop_wsl_gpu.py` | ``hermes gui`` under WSLg selects the installed Mesa D3D12 driver before Electron spawns its GPU process (#106117) — and never overrides an explicit. |
| `tests/hermes_cli/test_destructive_slash_confirm.py` | cli.HermesCLI._confirm_destructive_slash. Drives the helper directly via __get__ on a SimpleNamespace stand-in so we don't have to. |
| `tests/hermes_cli/test_destructive_slash_confirm_gate.py` | the approvals.destructive_slash_confirm config gate. Destructive session slash commands (/clear, /new, /reset, /undo) discard conversation. |
| `tests/hermes_cli/test_destructive_slash_inline_skip_e2e.py` | End-to-end integration test for the destructive-slash inline-skip path. Drives ``HermesCLI.process_command("/reset now")`` against a minimal. |
| `tests/hermes_cli/test_detect_api_mode_for_url.py` | hermes_cli.runtime_provider._detect_api_mode_for_url. The helper maps base URLs to api_modes for four cases: * api.openai.com →. |
| `tests/hermes_cli/test_determine_api_mode_hostname.py` | ``determine_api_mode`` hostname handling. Companion to tests/hermes_cli/test_detect_api_mode_for_url.py — the same. |
| `tests/hermes_cli/test_device_poll_waf_backoff.py` | tests: edge/WAF non-JSON error responses must not abort an in-flight device-code login. Vercel fronts the Nous Portal and answers. |
| `tests/hermes_cli/test_diagnostics_upload.py` | ``hermes_cli.diagnostics_upload`` — the Nous-S3 upload client. All network I/O is mocked at ``urllib.request.urlopen``; no real requests. |
| `tests/hermes_cli/test_diff_command.py` | the CLI ``/diff`` command handler. ``/diff`` shows git changes in the working directory (unstaged + untracked by default. |
| `tests/hermes_cli/test_dingtalk_auth.py` | hermes_cli/dingtalk_auth.py (QR device-flow registration). |
| `tests/hermes_cli/test_discard_lockfile_churn.py` | `hermes update` lockfile-churn cleanup must respect npm workspace ownership (#112378). The single root ``package-lock.json`` spans every workspace. |
| `tests/hermes_cli/test_discord_skill_clamp_warning.py` | Discord /skill 32-char clamp collision warnings. Discord's per-command name limit is 32 chars, so ``discord_skill_commands_by_category``. |
| `tests/hermes_cli/test_display_ws_drop_keeps_lease.py` | A dropped viewer link (1006: lid closed, Wi-Fi) must NOT hand the screen back to the agent — the human may be mid-login on it. Only a clean close. |
| `tests/hermes_cli/test_display_ws_ticket.py` | The display bridge admits only a display ticket minted for THIS profile's socket: a gateway ticket, an expired ticket, or one for another provider. |
| `tests/hermes_cli/test_doctor.py` | hermes_cli.doctor. |
| `tests/hermes_cli/test_doctor_audit_remedy.py` | Doctor npm-audit remedy guidance — the fix must persist across `hermes update`. Regression for #116774: `npm audit fix` on a managed install is. |
| `tests/hermes_cli/test_doctor_azure_foundry_probe.py` | ``hermes doctor`` connectivity probe for Azure Foundry Anthropic-style endpoints (#66756). The ``/anthropic`` route on Foundry has no ``GET. |
| `tests/hermes_cli/test_doctor_cache_hogs.py` | ``hermes doctor`` names cache-root dirs that no pruner covers once they are big. |
| `tests/hermes_cli/test_doctor_channel_hygiene.py` | Doctor's channel-record hygiene check (_check_channel_record_hygiene). Report-don't-delete: doctor names the stale config key; the user removes it. |
| `tests/hermes_cli/test_doctor_command_install.py` | Command diagnostics use the same selection and launch contract as. |
| `tests/hermes_cli/test_doctor_dedicated_provider_skip.py` | Regression: hermes doctor must not run a generic Bearer-auth health check for providers that already have a dedicated check (Anthropic, OpenRouter. |
| `tests/hermes_cli/test_doctor_github_token_probe.py` | ``hermes doctor`` validates a configured GITHUB_TOKEN/GH_TOKEN against api.github.com (#115257). An expired PAT left in ``.env`` used to be reported. |
| `tests/hermes_cli/test_doctor_ipv6_probe.py` | ``hermes doctor`` dead-IPv6 probe (#114265 secondary finding 1). An advertised-but-blackholed IPv6 route stalls every serial connect for the full. |
| `tests/hermes_cli/test_doctor_journal_modes.py` | doctor's per-database journal-mode report. `hermes doctor` lists each Hermes-managed database with its journal mode and flags databases. |
| `tests/hermes_cli/test_doctor_legacy_checkout.py` | the legacy-desktop-checkout report in hermes doctor. |
| `tests/hermes_cli/test_doctor_live.py` | ``hermes doctor --live`` — opt-in bounded real-call tool-backend probes. All probes are mocked at the HTTP/client layer; no real network. |
| `tests/hermes_cli/test_doctor_no_proxy_ipv6.py` | ``hermes doctor`` probes survive a bracketed-IPv6 NO_PROXY environment (#118159). Clash Verge / mihomo write ``[::1]`` into NO_PROXY; httpx 0.28.1. |
| `tests/hermes_cli/test_doctor_pm_store_probe.py` | Doctor and launched commands share PM's read-only installed selection. |
| `tests/hermes_cli/test_doctor_relay_plugins.py` | ``hermes doctor`` names the Relay plugin files the runtime actually loads. Relay discovers user and system ``plugins.toml`` files outside the Hermes. |
| `tests/hermes_cli/test_doctor_structural_corruption.py` | #88587 — doctor must name STRUCTURAL state.db corruption honestly. The write-health probe's failure used to be reported as "FTS write corruption". |
| `tests/hermes_cli/test_doctor_terminal_backends.py` | Invariants for the terminal-backend doctor lines (tools-runtime-30): each failure names the backend in plain words and points at `hermes setup. |
| `tests/hermes_cli/test_doctor_update_provenance.py` | Doctor's plugin update-provenance check (SPEC-05 warning surface). Bounded and READ-ONLY: the pure 2x2 plugin provenance reconciliation. |
| `tests/hermes_cli/test_doctor_wal_checkpoint_guard.py` | #103339 item 2: ``hermes doctor --fix`` never checkpoints state.db through a bare writable ``sqlite3.connect`` — the checkpoint runs on the. |
| `tests/hermes_cli/test_doctor_wal_holder_guard.py` | Regression: ``hermes doctor --fix`` must not checkpoint the live WAL under a running gateway. Checkpoint-lock premise (#40177): a bare. |
| `tests/hermes_cli/test_doctor_web_dashboard_import.py` | ``hermes doctor`` reports a dashboard web surface that dies at import (#124214). The optional ``web`` extra pins fastapi/starlette in lockstep, but. |
| `tests/hermes_cli/test_doctor_workspace_audit.py` | Workspace audit warnings must reflect their runtime and build dependency. |
| `tests/hermes_cli/test_dump_env_visibility.py` | `hermes debug` must not report a shell-only API key as plainly "set". The dump reads ``os.getenv`` — the invoking terminal's environment — but the. |
| `tests/hermes_cli/test_dump_gateway_status.py` | ``hermes dump`` gateway line for a supervised gateway with no scannable PID. |
| `tests/hermes_cli/test_dump_git_commit.py` | hermes_cli.dump._get_git_commit — git SHA resolution for ``hermes dump``. ``hermes dump`` prints the running commit so support bug reports. |
| `tests/hermes_cli/test_dump_terminal_backend.py` | `hermes debug` must report the EFFECTIVE terminal backend. ``terminal.backend`` in config.yaml is bridged to the ``TERMINAL_ENV`` env var, but a. |
| `tests/hermes_cli/test_early_recovery.py` | Startup triggers PM recovery without importing the damaged dependencies. Real generation rebuilds and pre-activation startup live in tests/pm; these. |
| `tests/hermes_cli/test_empty_session_hygiene.py` | empty-session hygiene — gemini-cli#27770 port. Starting the CLI and immediately quitting (or rotating sessions with /new) used to leave. |
| `tests/hermes_cli/test_enable_no_capabilities.py` | Enable asks for declared privileges, not an unsolicited override. |
| `tests/hermes_cli/test_ensure_acp_launcher.py` | `hermes update` must self-heal the ``hermes-acp`` launcher. ACP hosts (Zed, JetBrains, Buzz Desktop) resolve the agent by the ``hermes-acp`` command. |
| `tests/hermes_cli/test_ensure_gateway_service.py` | Service setup failure reporting; consent integration lives in. |
| `tests/hermes_cli/test_ensure_hermes_home_memo.py` | ensure_hermes_home is memoized per home path (perf: it runs on every load_config), but a deleted home must still be recreated on the next. |
| `tests/hermes_cli/test_ensure_hermes_home_uid.py` | #34107 — Docker UID/GID handling in ensure_hermes_home. When Hermes runs in Docker with ``HERMES_UID=1000`` /. |
| `tests/hermes_cli/test_ensure_utf8_locale.py` | hermes_cli._ensure_utf8(). Covers the crash class where the setup wizard (and other banner-printing commands) emit box-drawing. |
| `tests/hermes_cli/test_ensure_windows_bin_launchers.py` | ``hermes`` must survive git operations on the checkout (launcher layout). The Windows ``hermes`` command is a staged launcher whose canonical home. |
| `tests/hermes_cli/test_env_custom_keys.py` | GET /api/env surfaces arbitrary/custom .env keys (not just catalogued ones). The dashboard Keys page previously rendered only keys present in a. |
| `tests/hermes_cli/test_env_deprecation_truthtable.py` | Truth-table regression test for the 'Deprecated .env settings' warning. Behavior contract (pins the fix for the TERMINAL_CWD false-positive class. |
| `tests/hermes_cli/test_env_export_line_lifecycle.py` | the Tools & Keys GitHub PAT save/remove path (#40041). Users following generic docs add ``export GITHUB_TOKEN=ghp_...`` to. |
| `tests/hermes_cli/test_env_export_prefix.py` | ``export `` prefix handling in the hand-rolled .env parsers. Bash-compatible .env files commonly prefix lines with ``export `` (users. |
| `tests/hermes_cli/test_env_load_cache.py` | the load_env() process-level cache. The cache exists to keep `hermes tools` → "All Platforms" fast: every `get_env_value()` lookup used to. |
| `tests/hermes_cli/test_env_loader.py` | test_recovered_update_retry_skips_external_secret_sources, test_utf8_bom_does_not_mangle_first_key. |
| `tests/hermes_cli/test_env_loader_op_bootstrap.py` | the 1Password bootstrap-token reliability patches. Two behaviours are covered: 1. ``load_hermes_dotenv()`` auto-loads. |
| `tests/hermes_cli/test_env_loader_self_reference.py` | Self-referential .env lines (``PATH=/x:${PATH}``) must resolve once per process, not grow on every reload (#109902: gateway per-turn and cron. |
| `tests/hermes_cli/test_env_sanitize_on_load.py` | .env sanitization during load to prevent token duplication (#8908). |
| `tests/hermes_cli/test_env_write_race.py` | Concurrent ``.env`` writers must not clobber each other (#77187). ``save_env_value`` / ``remove_env_value`` do a read-modify-write cycle on. |
| `tests/hermes_cli/test_exit_delete_session.py` | `/exit --delete` and `/quit --delete` session deletion. Ports the behavior from google-gemini/gemini-cli#19332: running `/exit` or `/quit`. |
| `tests/hermes_cli/test_exit_summary_resume_hint.py` | the CLI exit summary's resume hint, including profile-flag support. |
| `tests/hermes_cli/test_exit_watchdog_signal_arm.py` | Exit watchdog: arm on shutdown *intent* (signal), never at chat startup. Regression coverage for the #65998 class: a ``hermes --tui`` process whose. |
| `tests/hermes_cli/test_external_process_auth_status.py` | external-process provider auth status and Accounts-tab wiring. Covers the copilot-acp fix class: * ``get_auth_status()`` dispatches on. |
| `tests/hermes_cli/test_external_process_cli_prefixes.py` | A Claude Code CLI outside PATH is found by every core check, not only by the Anthropic adapter. A backend started by a macOS LaunchAgent or spawned. |
| `tests/hermes_cli/test_external_process_provider_seam.py` | An external-process (ACP) provider can ship from outside this tree. The known-provider gate, the binary, the argv and the env var names used to be. |
| `tests/hermes_cli/test_fallback_chain_alias_dedup.py` | Test that fallback-chain identity dedup normalizes provider aliases. A provider can appear under two ids that are the same backend: the canonical. |
| `tests/hermes_cli/test_fallback_cmd.py` | `hermes fallback` — chain reading, add/remove/clear, legacy migration. |
| `tests/hermes_cli/test_fallback_config.py` | hermes_cli/fallback_config.py — fallback entry API-key resolution. |
| `tests/hermes_cli/test_fast_command.py` | the /fast CLI command and service-tier config handling. |
| `tests/hermes_cli/test_fast_serve_launch.py` | test_lean_serve_parser_matches_full_subcommand_parser, test_fast_serve_launch_dispatches_only_unambiguous_serve. |
| `tests/hermes_cli/test_finite_chat_delegation.py` | Finite chat must consume parallel delegated results before the CLI. |
| `tests/hermes_cli/test_fireworks_provider.py` | Focused tests for Fireworks AI first-class provider wiring. These tests pin the wiring that makes Fireworks a real provider — alias resolution. |
| `tests/hermes_cli/test_fleet_config_migration_windows_live.py` | LIVE Windows E2E for the fleet-wide config migration (wine2e lane). Real profile homes on the Windows filesystem, real migration pipeline. |
| `tests/hermes_cli/test_fleet_matrix_down_state.py` | Fleet matrix DOWN-state coverage (Phase-1 verification gap, #91277). A gateway that was ALIVE at update start, got stopped by the restart phase, and. |
| `tests/hermes_cli/test_fleet_matrix_self_restart_pending.py` | A gateway this updater runs INSIDE (cron update in the gateway tree, #100179) accepted a self-restart request and can only restart after the updater. |
| `tests/hermes_cli/test_focus_view.py` | ``/focus`` — the display-only reduced-output view. Focus view composes with the existing ``/verbose`` tool-progress machinery rather than. |
| `tests/hermes_cli/test_foreign_sessions.py` | hermes_cli.foreign_sessions — Claude Code / Codex CLI import. Fixture JSONL is synthesized inline (tmp_path); the SessionDB is opened. |
| `tests/hermes_cli/test_foreign_sessions_browser.py` | Discovery keeps readable sessions available when a neighboring log is. |
| `tests/hermes_cli/test_free_tier_offer.py` | The install-wide record behind the free tier's sign-in offer: first due a fixed delay after the first finished task, then again only after another. |
| `tests/hermes_cli/test_fts_optimize_notice.py` | coverage for FTS storage upgrade discoverability. |
| `tests/hermes_cli/test_gateway.py` | hermes_cli.gateway. |
| `tests/hermes_cli/test_gateway_agent.py` | GatewayAgent drives main's HermesCLI callbacks from a scripted gateway (no live. |
| `tests/hermes_cli/test_gateway_agent_compress.py` | Classic CLI ``/compress`` through GatewayAgent: main's ``compress_now`` is the gateway's ``session.mutate compress``, and the CLI prints the owner's. |
| `tests/hermes_cli/test_gateway_agent_replay_gap.py` | Classic CLI (`hermes`, `hermes chat` -> GatewayAgent) across a ``session.replay_gap``: it re-attaches, shows the settled reply once and never leaves. |
| `tests/hermes_cli/test_gateway_automation.py` | The classic CLI's /goal, /loop, /heartbeat managers on a gateway session are proxies over ``session.automation``: no local GoalManager (so no. |
| `tests/hermes_cli/test_gateway_chat.py` | Client launch must not silently downgrade policy or own execution. |
| `tests/hermes_cli/test_gateway_chat_blocking_controls.py` | Finite gateway chat tracks session-blocking controls without leaking foreign. |
| `tests/hermes_cli/test_gateway_chat_commands_live.py` | Classic `hermes --cli chat` session commands on the shared gateway, driven in a real PTY. The classic CLI is main's HermesCLI again (gateway-backed. |
| `tests/hermes_cli/test_gateway_chat_failures.py` | Failure-path and terminal-receipt contracts for the transport-only. |
| `tests/hermes_cli/test_gateway_chat_flags_live.py` | Launch flags on the classic CLI (main's HermesCLI, gateway-backed): bare -c, --resume latest, --list-tools, resume footer. Expectations are main's. |
| `tests/hermes_cli/test_gateway_chat_native.py` | Native PTY clients against an ordinary daemon and loopback model only. `hermes --cli chat` (interactive and -q/-Q) is main's HermesCLI again, its. |
| `tests/hermes_cli/test_gateway_chat_pending_preview.py` | A resumed classic CLI shows what each pending admission will run, safely, from the real. |
| `tests/hermes_cli/test_gateway_chat_plugin_inject.py` | `ctx.inject_message(text)` with no session_key/origin (plugins.md "Active CLI conversation") reaches the attached classic `hermes chat` session as a. |
| `tests/hermes_cli/test_gateway_chat_query_file_read.py` | The live --query-file read keeps main's contract (B2-09): undecodable bytes are replaced; an unreadable or empty file exits 2 naming it, with a. |
| `tests/hermes_cli/test_gateway_chat_retry_lost_refresh.py` | Classic /retry keeps its prepared rewind until the post-rewind refresh lands: real authority, SQLite and AuthorityConnection.dispatch; the one. |
| `tests/hermes_cli/test_gateway_chat_retry_validate.py` | Classic /retry validates the target turn before rewinding it (dokterdok N92): real authority, SQLite and AuthorityConnection.dispatch; an image turn. |
| `tests/hermes_cli/test_gateway_chat_send_directive.py` | The classic CLI view submits a ``send`` directive from slash.exec as its own durable. |
| `tests/hermes_cli/test_gateway_chat_title_live.py` | Title-keyed resume on the classic CLI (main's HermesCLI, gateway-backed) against an ordinary daemon. The CLI process may read state.db but never. |
| `tests/hermes_cli/test_gateway_chat_unknown.py` | Resume must expose the admission needed by the existing fenced discard. |
| `tests/hermes_cli/test_gateway_chat_view_replay_gap.py` | GatewayChatView (`chat -q`, stream-json, `-z`, the thin chat) across a ``session.replay_gap``: it re-attaches; a one-shot prints the reply once. |
| `tests/hermes_cli/test_gateway_cli_commands.py` | Classic CLI commands whose state lives in the gateway session are answered there (tracker #134889 CLI-8, CLI-17, CLI-21): ``/diff session`` (the. |
| `tests/hermes_cli/test_gateway_client_backlog.py` | A client's own event backlog never fails its turn (#134889). The frames a socket already buffered (a CLI resumed from Ctrl-Z) are read in one burst. |
| `tests/hermes_cli/test_gateway_client_env.py` | LC-8 / T3 client side: the classic CLI and the Ink TUI launcher send this shell's allowlisted environment as ``session.create``'s ``client_env``. |
| `tests/hermes_cli/test_gateway_client_recovery_backlog.py` | Recovery RPCs awaited from a client's only event consumer (#134889 CLI-35/CLI-37 review). ``GatewayChatView`` and ACP await ``session.resume`` /. |
| `tests/hermes_cli/test_gateway_client_rpc.py` | The viewer RPC client keeps an owner refusal's structured verdict (code + bounded. |
| `tests/hermes_cli/test_gateway_client_ws_target.py` | Every owner dial (viewer, worker RPC, A2A forward, bot delivery, Ink bootstrap) builds the same. |
| `tests/hermes_cli/test_gateway_command_parity.py` | The gateway command parity table is generated from the code and must be regenerated with. |
| `tests/hermes_cli/test_gateway_command_parity_live_session.py` | A sidecar live-session RPC (``@_rpc(..., live_session=True)``) resolves ``session_id`` in the sidecar's own session map, which never holds a. |
| `tests/hermes_cli/test_gateway_connection_command_socket.py` | ``GatewayConnection.call_until`` sends its one request on a socket of its own (#134889 PLG-7): never on the viewer's socket, never twice, and the. |
| `tests/hermes_cli/test_gateway_connection_reconnect.py` | The classic CLI dials the gateway again after it restarts (#134889). GatewayConnection kept its finished loop thread, so after a gateway restart. |
| `tests/hermes_cli/test_gateway_disconnect_outcome.py` | Expected keepalive close preserves an honest unknown outcome and no task. |
| `tests/hermes_cli/test_gateway_enroll_multiplex_warning.py` | Gateway enroll: secondary-multiplex-profile warning for relay routing stamps. ``hermes gateway enroll --connector-url/--wake-url`` persists. |
| `tests/hermes_cli/test_gateway_external_supervisor.py` | explicit ownership by a wrapped external gateway supervisor. |
| `tests/hermes_cli/test_gateway_first_run_live.py` | First-run guidance on the real CLI without a configured executor. |
| `tests/hermes_cli/test_gateway_foreign_unit_guard.py` | `hermes gateway stop|restart|start` from a sandbox home must never operate ANOTHER install's systemd unit. Real incident: an e2e helper ran `hermes. |
| `tests/hermes_cli/test_gateway_foreign_xdg_runtime.py` | a foreign/leaked ``XDG_RUNTIME_DIR`` in the user-systemd preflight (#86558). ``runuser``/``su``/``sudo -u`` from a root shell. |
| `tests/hermes_cli/test_gateway_host_stop_refusal.py` | The host multiplexer is never the pid a served profile's ``gateway stop`` may SIGTERM (#141133). While the host serves a profile it publishes its. |
| `tests/hermes_cli/test_gateway_host_verbs.py` | ``gateway start/restart --all`` and ``gateway run`` mean "the ONE host multiplexer". Base behaviour: ``--all`` SIGTERMed every gateway process on. |
| `tests/hermes_cli/test_gateway_job_teardown_live.py` | LIVE Windows E2E for #48820 (4th repro): Job-Object teardown vs the gateway restart watcher, with real processes on a real windows-latest runner. |
| `tests/hermes_cli/test_gateway_launch_lifetime.py` | Detached owners must not lose the checkout their session still. |
| `tests/hermes_cli/test_gateway_launch_supervisor.py` | Local readers of a gateway's ``identify`` answer see what launched it, not the protocol's "none". The session runtime protocol reports a manual or. |
| `tests/hermes_cli/test_gateway_lifecycle_guards.py` | Gateway lifecycle verbs never take down a gateway they must not touch. Two P0 invariants: * A lifecycle call never acts on a service definition. |
| `tests/hermes_cli/test_gateway_linger.py` | gateway linger auto-enable behavior on headless Linux installs. |
| `tests/hermes_cli/test_gateway_migrate_compensator_resume.py` | The compensator's outcome, and a stranded host's recovery, under the flipped host lock. Both scenarios are about states the PR itself can create, so. |
| `tests/hermes_cli/test_gateway_migrate_converged_host.py` | A CONVERGED host is a no-op for ``hermes gateway migrate --multiplex``, run after run. Driven through the REAL topology path, not stubbed. |
| `tests/hermes_cli/test_gateway_migrate_multiplex.py` | ``hermes gateway migrate``: preflight verdicts, apply/rollback bookkeeping, and the update hook. Service layer is faked through the module's. |
| `tests/hermes_cli/test_gateway_model_switch_cli.py` | The classic CLI's model switches over the shared gateway session (#134889 M1, review of #138717). The CLI's agent is a ``GatewayAgent`` stand-in and. |
| `tests/hermes_cli/test_gateway_multiplex_lifecycle.py` | Per-profile lifecycle never stops the shared host or hides an installed. |
| `tests/hermes_cli/test_gateway_multiplex_mode.py` | ``gateway.multiplex_profiles`` defaults to ON, but an UNSET flag is settled at boot by ``hermes_cli.gateway_multiplex_mode.resolve_multiplex_mode``. |
| `tests/hermes_cli/test_gateway_multiplex_refusal.py` | ``gateway.standalone`` and the multiplexer refusal: ``_named_profile_refused_under_multiplexer``. A profile that authored ``gateway.standalone. |
| `tests/hermes_cli/test_gateway_multiplex_s6.py` | s6 container: the unset multiplex default resolves ON when the boot has parked every named slot, ``hermes gateway migrate --multiplex`` folds an UP. |
| `tests/hermes_cli/test_gateway_multiplex_served_record.py` | The live multiplexer's recorded ``served_profiles`` decides "served"; every start verb honours it. - Probe. |
| `tests/hermes_cli/test_gateway_multiplex_status.py` | PR #69118: a named profile served by the default multiplexer reports as running. ``hermes gateway status`` / ``gateway list`` / ``profile list``. |
| `tests/hermes_cli/test_gateway_no_new_standalone_profile.py` | A named profile cannot create a NEW standalone gateway — multiplexer running or not (#109417). One gateway per host serves every profile. ``hermes. |
| `tests/hermes_cli/test_gateway_platform_gating.py` | Host-specific gating in ``hermes_cli.gateway._all_platforms()``. Some messaging platforms can't function on every host. The gate lives in one place. |
| `tests/hermes_cli/test_gateway_plugin_commands.py` | Plugin slash commands typed in the classic CLI run in the gateway (#134889 PLG-7, CLI-13). The plugin's hooks, tools and MCP servers live in the. |
| `tests/hermes_cli/test_gateway_proc_fallback.py` | /proc-based gateway PID detection in Docker environments. Verifies that _scan_gateway_pids() uses /proc/*/cmdline when available (Docker. |
| `tests/hermes_cli/test_gateway_queued_unknown.py` | A finite queued viewer detaches when its predecessor becomes unknown. |
| `tests/hermes_cli/test_gateway_refused_owner.py` | #139845 / #140252: a same-user gateway that refuses the client is named, not ``authorization``. #139845: an elevated gateway's pipe/process refuses. |
| `tests/hermes_cli/test_gateway_reload_mcp.py` | /reload-mcp on the shared gateway: the gateway reconciles its MCP servers and refreshes its agents (``reload.mcp``); the CLI never touches its. |
| `tests/hermes_cli/test_gateway_restart_external_supervisor.py` | ``hermes gateway restart`` must hand an externally-supervised gateway back to its supervisor. A custom launchd agent (a plist/label outside the. |
| `tests/hermes_cli/test_gateway_restart_loop.py` | gateway restart-loop defenses (#30719). Covers: - Defense 1: gateway stop/restart refuse when _HERMES_GATEWAY=1 - Defense 2: cron create. |
| `tests/hermes_cli/test_gateway_restart_no_unit_linger.py` | ``hermes gateway restart`` without an installed service unit must actually restart. Linger is a systemd-unit concern. With no unit installed the. |
| `tests/hermes_cli/test_gateway_restart_warm_probe_cache.py` | ``hermes gateway restart`` of a manual gateway must not attach to the gateway it just stopped. The host-gateway probe is memoized for. |
| `tests/hermes_cli/test_gateway_restart_watcher_bare_python.py` | The detached gateway restart watcher must survive on an interpreter without the dependency env. ``hermes update`` finishes on the bare store Python. |
| `tests/hermes_cli/test_gateway_resume_launch_key.py` | The classic CLI re-supplies its launch-only key on every resume (refs #134889, RV-14). An owner restart revokes launch keys and takes the same key. |
| `tests/hermes_cli/test_gateway_rollback.py` | /rollback on the shared gateway: the checkpoints are the gateway's, so list/diff/restore go to the owner's ``rollback.*`` verbs and print main's. |
| `tests/hermes_cli/test_gateway_run_hard_exit.py` | CLI gateway run exit behavior. ``hermes gateway run`` enters through hermes_cli.gateway, not gateway.run.main(). After graceful. |
| `tests/hermes_cli/test_gateway_runtime.py` | Runtime discovery must distinguish absence from an unsafe/live. |
| `tests/hermes_cli/test_gateway_runtime_discovery.py` | Private discovery must not assume another process shares its temp. |
| `tests/hermes_cli/test_gateway_runtime_ensure.py` | Real local-control and subprocess boundaries, never real service. |
| `tests/hermes_cli/test_gateway_runtime_health.py` | test_runtime_health_lines_flags_stale_running_with_dead_pid, test_runtime_health_lines_include_fatal_platform_and_startup_reason. |
| `tests/hermes_cli/test_gateway_runtime_home_identity.py` | Endpoint discovery matches served homes by canonical identity on BOTH sides. ``_canonical_home`` resolves symlinks and case-folds (Windows. |
| `tests/hermes_cli/test_gateway_runtime_replace_incompatible.py` | An owner from an older Hermes on the SAME home is replaced by ensure, never reported forever. Upgrade path (Windows Desktop report, TUI "retrying in. |
| `tests/hermes_cli/test_gateway_runtime_service.py` | Installed identity proofs at inert native supervisor executable. |
| `tests/hermes_cli/test_gateway_runtime_service_roots.py` | Explicit requested-root naming and start-response encoding contracts. |
| `tests/hermes_cli/test_gateway_s6_dispatch.py` | the Phase 4 s6 dispatch helper in hermes_cli.gateway. `_dispatch_via_service_manager_if_s6` decides whether a `hermes gateway. |
| `tests/hermes_cli/test_gateway_scan_home_identity.py` | The gateway pid scan follows a process's real home. Regression: a web server started on a temp HERMES_HOME runs the orphan reaper at startup. Its. |
| `tests/hermes_cli/test_gateway_scm_feature_removed.py` | the REMOVAL of the MSIX SCM Windows service feature (audit C06/C07). Settled user decision (2026-09-03): Windows gateway supervision stays on. |
| `tests/hermes_cli/test_gateway_served_guard_ownership.py` | The CLI served-profile guard only counts a host gateway that is OURS and NOT our own process. ``host_multiplexer_serving`` reads the HOST-wide. |
| `tests/hermes_cli/test_gateway_service.py` | gateway service management helpers. |
| `tests/hermes_cli/test_gateway_service_choice.py` | Service consent through real config/discovery/install; only OS peers are. |
| `tests/hermes_cli/test_gateway_service_owner.py` | Gateway service-definition writes belong to the home the definition pins. Every gateway boot refreshes "its" unit, and a scratch/E2E process whose. |
| `tests/hermes_cli/test_gateway_service_paths.py` | test_service_path_skips_nonexistent_node_modules, test_service_path_includes_node_modules_when_present. |
| `tests/hermes_cli/test_gateway_session_end_ownership.py` | A gateway-backed classic CLI leaves the end of its session to the gateway. Regression for #134889 LC-2. The CLI's ``end_session`` (exit, ``/new``). |
| `tests/hermes_cli/test_gateway_session_store.py` | GatewaySessionStore: main's ``_session_db`` facade over gateway verbs (scripted gateway, no live. |
| `tests/hermes_cli/test_gateway_setting_commands.py` | Per-session settings typed in the classic CLI run the gateway's handler (slash.exec) when the session is on the gateway; client-enforced state. |
| `tests/hermes_cli/test_gateway_setup_moved_platforms_status.py` | Setup-menu status for the messaging platforms that moved from core into bundled plugins. The old static wizard rows read credentials through. |
| `tests/hermes_cli/test_gateway_side.py` | /bg and /btw on the shared gateway: the side task runs in the gateway (prompt.background / prompt.btw) and its answer is routed off the event stream. |
| `tests/hermes_cli/test_gateway_snapshot_restore_guards.py` | CLI-16: the restore's own outcome decides the reply; a supervised owner or bad id never. |
| `tests/hermes_cli/test_gateway_snapshot_restore_live.py` | CLI-16 in #134889: restore offline, then keep chatting on the restored. |
| `tests/hermes_cli/test_gateway_start_attestation.py` | the #91675 gateway-start honesty fixes. Two holes closed by the fix: 1. ``_wait_for_gateway_ready`` returned on the FIRST process-table. |
| `tests/hermes_cli/test_gateway_startup_consent.py` | A consented launch reaches main's HermesCLI (``cli.main``) with its scoped. |
| `tests/hermes_cli/test_gateway_startup_validation.py` | Invalid launch options must not inspect configuration they bypass. |
| `tests/hermes_cli/test_gateway_tools.py` | Main's process dock, status-bar ``⚙ N`` and ``/stop`` read the gateway session's processes. Rewired, ``terminal(background=true)`` runs in the. |
| `tests/hermes_cli/test_gateway_tools_notify.py` | A notification turn the gateway admits while the classic CLI is idle reaches main's screen. On main the CLI drained ``tools.process_registry``. |
| `tests/hermes_cli/test_gateway_unit_paths.py` | User systemd unit location and identity: the account home owns the unit dir (#98699) and a bare ``hermes-gateway.service`` pinning THIS home is this. |
| `tests/hermes_cli/test_gateway_unnamed_default_home_verbs.py` | Unnamed dashboard gateway lifecycle verbs issued from the DEFAULT home must name ``-p default`` explicitly (``_own_profile_selector``), so the. |
| `tests/hermes_cli/test_gateway_user_bus_adoption.py` | #104893: a gateway started by a system-level systemd unit adopts its own user bus at. |
| `tests/hermes_cli/test_gateway_windows.py` | hermes_cli.gateway_windows. |
| `tests/hermes_cli/test_gateway_wsl.py` | WSL detection and WSL-aware gateway behavior. |
| `tests/hermes_cli/test_gemini_express_key_probes.py` | Key-validation surfaces never reroute a key by its prefix, matching chat (#115306). Google issues ``AQ.`` keys for both Google AI Studio and Vertex. |
| `tests/hermes_cli/test_gemini_free_tier_setup_block.py` | the Gemini free-tier block in the setup wizard. |
| `tests/hermes_cli/test_gemini_provider.py` | Google AI Studio (Gemini) provider integration. |
| `tests/hermes_cli/test_get_env_value_scope.py` | get_env_value must be scope-aware — the last scope-blind reader (#67027). Under a multiplexed profile turn, ``os.environ`` can hold another. |
| `tests/hermes_cli/test_git_pack_tidy.py` | Progressive partial-clone pack cleanup (#129712), on real git: partial clones of a local. |
| `tests/hermes_cli/test_git_probe_no_lazy_fetch.py` | Read-only git probes never lazy-fetch from a partial clone's promisor remote. In a blobless clone, asking about an object the clone has not fetched. |
| `tests/hermes_cli/test_git_probe_tree_kill.py` | POSIX process-tree cleanup for ``bounded_git_probe`` (port of openai/codex#36793). Timing out a git probe must not leave helper descendants. |
| `tests/hermes_cli/test_git_trampoline_windows_live.py` | Live Windows E2E for the Git-for-Windows trampoline self-heal (#87876). Runs ONLY on a real windows-latest runner (wine2e/** on-demand lane). No. |
| `tests/hermes_cli/test_gitlock.py` | hermes_cli.gitlock — stale git lock recovery + ancestry probe. These cover the two failure modes that produced the false "update. |
| `tests/hermes_cli/test_gitlock_tmp_packs.py` | Aborted-fetch tmp_pack debris sweep (#93732, campaign #91277). Every git fetch that dies mid-transfer strands a tmp_pack_* file in. |
| `tests/hermes_cli/test_global_auth_store_memo.py` | Measured-work pins for the _load_global_auth_store() memo. read_credential_pool() -> load_pool() runs _load_global_auth_store() once per provider. |
| `tests/hermes_cli/test_global_switch_persists_base_url_api_mode.py` | #25106: CLI `/model <name> --global` never persisted ``model.base_url``/``model.api_mode`` to config.yaml, so a global provider. |
| `tests/hermes_cli/test_gmi_provider.py` | Focused tests for GMI Cloud first-class provider wiring. |
| `tests/hermes_cli/test_goal_dispatch.py` | Every goal surface applies the same commands to real persisted. |
| `tests/hermes_cli/test_goal_judge_delegations.py` | The goal judge knows about delegated subagents. In a fan-out run 4 of 5 /goal nudges fired 6-153 s after a turn that had said "waiting on workers. |
| `tests/hermes_cli/test_goal_judge_timeout_config.py` | `auxiliary.goal_judge.timeout` must actually reach the judge (#91022). The key is declared in DEFAULT_CONFIG (60s) and surfaces in the auxiliary. |
| `tests/hermes_cli/test_goals_db_bootstrap_off_loop.py` | SessionDB bootstrap must never run schema init on an event-loop thread. Enterprise field report (2026-08-14): after an unclean shutdown plus a. |
| `tests/hermes_cli/test_gpt56_registration.py` | Behavior contracts for the GPT-5.6 (Sol/Terra/Luna) registration. Invariant tests only — no list snapshots (per the no-change-detector-tests. |
| `tests/hermes_cli/test_gpt6_tiers_registration.py` | Behavior contracts for the GPT-6 Sol/Terra/Luna registration (the 5.6 tier successors). Invariant tests only, no list snapshots. They pin what would. |
| `tests/hermes_cli/test_graphical_browser_detection.py` | `_can_open_graphical_browser()` in hermes_cli.auth. Guards the fix for the May 2026 report where `hermes auth add xai-oauth` launched a. |
| `tests/hermes_cli/test_gui_command.py` | ``hermes gui`` desktop launcher wiring. |
| `tests/hermes_cli/test_gui_uninstall.py` | hermes_cli.gui_uninstall — GUI-only uninstall + install discovery. Covers the cross-platform artifact discovery, the agent/GUI detection. |
| `tests/hermes_cli/test_gui_uninstall_retention.py` | #128974: GUI dry-run and GUI removal preserve shared state. |
| `tests/hermes_cli/test_handoff_cleanup_race.py` | #88234 — CLI cleanup must NOT finalize a session that was handed off to the gateway. The handoff flow re-binds the CLI. |
| `tests/hermes_cli/test_handoff_slow_dispatch_timeout.py` | tests: a slow gateway handoff dispatch must not be misreported as "gateway not running" — and no waiter may stomp a claimed (running). |
| `tests/hermes_cli/test_hatch_prompt_thread_safety.py` | test: bare /hatch must not call raw input() off the main thread. Slash commands dispatch from the process_loop daemon thread while. |
| `tests/hermes_cli/test_hermes_home_shared_launchers.py` | A launch under another HERMES_HOME must not rebind shared launchers (#123238). The checkout's ``.hermes/bin`` launchers are shared by every data. |
| `tests/hermes_cli/test_hf_browse.py` | The HF browser: search the firehose, price it roughly, and let any GGUF become a normal staged model. Parsing contracts run against canned HF API. |
| `tests/hermes_cli/test_history_commentary_display.py` | Public Codex commentary is a display projection, never a replay. |
| `tests/hermes_cli/test_home_directory_diagnostics.py` | Home initialization must respect operator-owned links and diagnose. |
| `tests/hermes_cli/test_home_init_soul_symlink.py` | Home initialization must survive a SOUL.md symlink the seed cannot write through. A cyclic ``SOUL.md -> SOUL.md`` link (ELOOP) or a link dangling. |
| `tests/hermes_cli/test_hooks_cli.py` | the ``hermes hooks`` CLI subcommand. |
| `tests/hermes_cli/test_ignore_user_config_flags.py` | --ignore-user-config and --ignore-rules flags on `hermes chat`. Ported from openai/codex#18646 (`feat: add --ignore-user-config and. |
| `tests/hermes_cli/test_image_gen_picker.py` | plugin image_gen providers injecting themselves into the picker. Covers `_plugin_image_gen_providers`, `_visible_providers`, and. |
| `tests/hermes_cli/test_imagegen_managed_gateway.py` | image_gen provider persistence (managed FAL clobber). Historical bug: ``_select_plugin_image_gen_provider`` hardcoded the. |
| `tests/hermes_cli/test_indicator_command.py` | the /indicator CLI command and busy-indicator style config. The /indicator command is registered in COMMAND_REGISTRY (and advertised by. |
| `tests/hermes_cli/test_init_command.py` | /init — generate or update AGENTS.md from a project scan. Covers the shared prompt builder (hermes_cli.init_command.build_init_prompt) and. |
| `tests/hermes_cli/test_input_sanitize.py` | shared user prompt input sanitization. |
| `tests/hermes_cli/test_install_bucket_separation.py` | Uninstall and profile cloning respect the install/profile bucket split. Runtime artifacts belong to an install; config, sessions and skills belong. |
| `tests/hermes_cli/test_install_cua_driver.py` | CUA runtime validation, explicit PM setup, and native host integration. |
| `tests/hermes_cli/test_install_identity.py` | test_concurrent_first_use_returns_one_persisted_identity, test_existing_identity_survives_read_only_root_or_racing_publication. |
| `tests/hermes_cli/test_install_lock_timeout.py` | A backend binds even while another process holds the install lock. Regression: ``runtime_lock`` waited forever, and the lock is held across a whole. |
| `tests/hermes_cli/test_install_state.py` | Behaviour of the machine-level install probe (``hermes_cli.install_state``). |
| `tests/hermes_cli/test_interrupt_output_history_regression.py` | #60920/#60941: interrupt marker duplication on redraw. The root cause: The interrupt marker ("_[Interrupted - processing new. |
| `tests/hermes_cli/test_interrupt_requeue_image_payload.py` | #110737: an interrupting message that carries image attachments is a ``(text, images)`` tuple on ``_interrupt_queue``; the re-queue block in. |
| `tests/hermes_cli/test_inventory.py` | Behavior tests for hermes_cli.inventory. Locks the invariants the three migrated consumers (web_server.py /api/model/options, tui_gateway. |
| `tests/hermes_cli/test_inventory_featured.py` | the ``featured_models`` shortlist in hermes_cli.inventory. The shortlist exists to keep multi-lab *routing aggregators*. |
| `tests/hermes_cli/test_inventory_pricing.py` | inventory._apply_pricing — the pricing/tier enrichment that feeds the desktop GUI model picker (and onboarding) so it can show $/Mtok. |
| `tests/hermes_cli/test_inventory_reasoning_caps.py` | the reasoning detail inventory._apply_capabilities puts on the picker payload. The desktop model picker hides its Thinking toggle from. |
| `tests/hermes_cli/test_ipv6_url_authorities.py` | IPv6 binds must render as bracketed URL authorities everywhere a URL is built. An IPv6 literal followed by ``:port`` is only a valid URL authority. |
| `tests/hermes_cli/test_iron_proxy_cli.py` | ``hermes_cli.proxy_cli`` command handlers. These tests cover the user-facing CLI surface that was previously uncovered. We mock the. |
| `tests/hermes_cli/test_isolated_serve_ledger_marker.py` | An isolated serve says so in the spawn ledger; an ordinary serve does not. Desktop's attach-first discovery reads ``spawn-ledger.json`` and attaches. |
| `tests/hermes_cli/test_jobs_json_utf8_bom.py` | UTF-8 BOM tolerance for independent jobs.json readers (dump/status). cron/jobs.load_jobs is covered in tests/cron/test_jobs.py. dump and status each. |
| `tests/hermes_cli/test_journey_render.py` | Behavior contracts for /journey output routing. The interactive CLI captures Rich output and re-renders it through prompt_toolkit, so it needs. |
| `tests/hermes_cli/test_kanban_aux_affinity.py` | Kanban specify/decompose run headless (no agent turn), yet their auxiliary calls must still carry a relay-affinity key — the OpenCode Go relay. |
| `tests/hermes_cli/test_kanban_block_classify.py` | block_task() classifies an untyped breaker block in place (#117363). |
| `tests/hermes_cli/test_kanban_block_kinds.py` | typed block reasons + the unblock-loop breaker. Covers the built-in fix for the kanban "blocked loop" — a worker blocks a task, a cron. |
| `tests/hermes_cli/test_kanban_blocked_sticky.py` | #28712 — kanban dispatcher must not auto-promote worker-initiated ``kanban_block`` (sticky blocks), but must keep. |
| `tests/hermes_cli/test_kanban_board_path_priority.py` | _board_path priority: explicit board trumps env pin. t_3f1c63a5: MCP-only sessions (dispatcher workers) always run with. |
| `tests/hermes_cli/test_kanban_board_project.py` | Board→project scoping in kanban_db. A kanban board can be scoped to a first-class Hermes project so every task on it anchors to that project. |
| `tests/hermes_cli/test_kanban_boards.py` | the multi-board kanban layer (``hermes kanban boards …``). Covers the pieces added when boards became a first-class concept: * Slug. |
| `tests/hermes_cli/test_kanban_cli.py` | the kanban CLI surface (hermes_cli.kanban). |
| `tests/hermes_cli/test_kanban_cli_dispatch_passthrough.py` | #33488 (CLI max_in_progress / max_spawn / per-profile config passthrough) and #29415 (kanban_swarm humanizer skill ref). These. |
| `tests/hermes_cli/test_kanban_cli_exit_status.py` | coverage for Kanban CLI process exit status propagation. |
| `tests/hermes_cli/test_kanban_comment_queries.py` | Comment-watermark queries in kanban_db. ``list_comments_after`` backs the live worker bridge: it returns only comments newer than a cursor so a. |
| `tests/hermes_cli/test_kanban_complete_live_claim_guard.py` | Invariant: ``complete_task`` never closes a live worker's run for a caller that neither owns the run nor asked for an operator override (issue. |
| `tests/hermes_cli/test_kanban_core_functionality.py` | Core-functionality tests for the kanban kernel + CLI additions. Complements tests/hermes_cli/test_kanban_db.py (schema + CAS atomicity) and. |
| `tests/hermes_cli/test_kanban_count_notify_subs.py` | ``kanban_db.count_notify_subs`` — the read-only subscription probe. The gateway notifier uses it to skip boards with zero subscriptions. |
| `tests/hermes_cli/test_kanban_create_body_file.py` | `kanban create --body-file` — shell-proof body delivery (#115432). `--body` is a plain string: embedded newlines and trailing flag-like tokens (e.g. |
| `tests/hermes_cli/test_kanban_creator_origin.py` | All explicit creator paths share durable lineage without graph. |
| `tests/hermes_cli/test_kanban_credential_startup_exit.py` | Credential rejection before a turn must retain the Kanban exit. |
| `tests/hermes_cli/test_kanban_db.py` | the Kanban DB layer (hermes_cli.kanban_db). |
| `tests/hermes_cli/test_kanban_db_init.py` | test_legacy_text_pk_tables_rebuilt_to_integer_autoincrement, test_migration_is_idempotent. |
| `tests/hermes_cli/test_kanban_db_repair.py` | kanban DB corruption repair, backup retention, WAL checkpointing, and the ``hermes kanban repair`` CLI. |
| `tests/hermes_cli/test_kanban_decompose.py` | the decomposer module + `hermes kanban decompose` CLI surface. The auxiliary LLM client is mocked — no network calls. Tests exercise the. |
| `tests/hermes_cli/test_kanban_decompose_db.py` | decompose_triage_task — the DB-layer atomic fan-out from the triage column. LLM-free by. |
| `tests/hermes_cli/test_kanban_default_assignee.py` | #27145 — kanban.default_assignee for unassigned ready tasks. When the dispatcher hits an unassigned ready task and. |
| `tests/hermes_cli/test_kanban_diagnostics.py` | hermes_cli.kanban_diagnostics — rule-engine that produces structured distress signals (diagnostics) for kanban tasks. These tests exercise. |
| `tests/hermes_cli/test_kanban_dispatch_claim_allowlist.py` | kanban.dispatch_profiles: per-home claim allowlist for shared boards (#110995). On a board shared across Hermes homes (one kanban.db mounted in. |
| `tests/hermes_cli/test_kanban_dispatch_lock.py` | the kanban dispatcher single-writer lock (issue #35240). A ``hermes gateway run --replace`` / ``gateway restart`` from a shell on a. |
| `tests/hermes_cli/test_kanban_dispatch_tick_hook.py` | the ``on_kanban_dispatch_tick`` observer hook. Re-port of PR #56066 per the #64231 batch disposition: renamed to the taxonomy form and. |
| `tests/hermes_cli/test_kanban_dispatch_unknown_assignee_event.py` | Dispatcher must leave per-task diagnostics for unknown assignees (#122422). A card assigned to a profile that does not exist lands in the aggregate. |
| `tests/hermes_cli/test_kanban_empty_completion.py` | ``complete_task`` refuses empty / whitespace-only evidence (#117483). |
| `tests/hermes_cli/test_kanban_gateway_restart_handoff.py` | Managed-gateway isolation for dispatcher-owned Kanban workers. |
| `tests/hermes_cli/test_kanban_goal_judge_affinity.py` | Goal-judge handoff gates: per-task relay-affinity scope + fail-open on transport failure. Both terminal-handoff gates (``hermes_cli.kanban`` for the. |
| `tests/hermes_cli/test_kanban_goal_mode.py` | kanban goal_mode — per-card Ralph-style goal loop. Covers three layers: 1. DB: goal_mode / goal_max_turns persist through create_task +. |
| `tests/hermes_cli/test_kanban_goal_mode_worker_log.py` | A goal_mode Kanban worker keeps the live tool feed in its worker log. The dispatcher used to force ``-Q`` on goal_mode cards because the judge loop. |
| `tests/hermes_cli/test_kanban_graph_identity.py` | Graph identity is completion history, not prerequisite edges. |
| `tests/hermes_cli/test_kanban_init_lock_bounded.py` | the bounded kanban init lock (issue #36644). `connect()` wrapped its entire body in an unbounded blocking `flock(LOCK_EX)` on every call. |
| `tests/hermes_cli/test_kanban_lifecycle_hooks.py` | kanban lifecycle plugin hooks. Verifies that claim/complete/block transitions fire the kanban_task_claimed / kanban_task_completed /. |
| `tests/hermes_cli/test_kanban_list_undecodable_text.py` | Invariant: one task row with an undecodable text field cannot take down the board listing (issue #111743). A ``body`` stored as TEXT holding invalid. |
| `tests/hermes_cli/test_kanban_managed_exit_reconciliation.py` | Join authority-owned worker receipts with main's exit classification. |
| `tests/hermes_cli/test_kanban_managed_result_pid.py` | A managed Kanban run's lost-ACK recovery honours the exit its authority recorded. ``tasks.worker_pid`` is the dispatcher's spawned submitter, but. |
| `tests/hermes_cli/test_kanban_memory_guard.py` | Memory-aware kanban dispatch guard (OOF-30 / OOF-77). Two production incidents shared the same failure shape: no ``kanban.max_in_progress``. |
| `tests/hermes_cli/test_kanban_notify.py` | test_notify_sub_delivery_mode_persists_and_last_write_wins, test_notify_subscribe_cli_records_discord_multiplex_anchors. |
| `tests/hermes_cli/test_kanban_owner_receipt_reclaim.py` | A dead attempt behind an unresolved owner receipt must not hold its claim forever. Regression for #140858. Card t_5ea03658 sat ``running`` for 16. |
| `tests/hermes_cli/test_kanban_parent_reopen_invalidation.py` | Regressions for domain-layer descendant invalidation on ancestor reopen. ``kanban_db.invalidate_descendants_for_parent_reopen`` is the single. |
| `tests/hermes_cli/test_kanban_per_profile_cap.py` | #21582 — per-profile concurrency cap in dispatcher. When ``kanban.max_in_progress_per_profile`` is set, no single profile gets. |
| `tests/hermes_cli/test_kanban_pr_acceptance.py` | Two lifecycle invariants, using real SQLite and a local GitHub HTTP. |
| `tests/hermes_cli/test_kanban_project_link.py` | Kanban <-> Projects integration: project-linked tasks get a deterministic worktree path + branch instead of the random ``wt/<task-id>``. |
| `tests/hermes_cli/test_kanban_promote.py` | the kanban `promote` verb (issue #28822). The realistic bug scenario from #28822 is: a child task ends up in ``todo`` with all its parents. |
| `tests/hermes_cli/test_kanban_reclaim_claim_lock_guard.py` | Tests: reclaim paths are claim-lock-aware so they can't desync a re-claimed task (issue #36910). A stale crash/stale-claim/max-runtime reclaim. |
| `tests/hermes_cli/test_kanban_resume_guard.py` | Kanban worker transcripts must not resume as ordinary write-capable sessions (#68779). Behaviour tests for the centralized guard. |
| `tests/hermes_cli/test_kanban_review_lifecycle_complete.py` | End-to-end regressions for the Kanban review lifecycle. These tests cover the two review models that must coexist: * first-class same-card review. |
| `tests/hermes_cli/test_kanban_review_surfaces.py` | Cross-surface regressions for the complete Kanban review lifecycle. |
| `tests/hermes_cli/test_kanban_specify.py` | the specifier module + `hermes kanban specify` CLI surface. The auxiliary LLM client is mocked — these tests don't hit any network or real. |
| `tests/hermes_cli/test_kanban_specify_db.py` | kb.specify_triage_task — the DB-layer atomic promotion from the triage column to todo. LLM-free by. |
| `tests/hermes_cli/test_kanban_swarm.py` | test_create_swarm_builds_parallel_workers_verifier_and_synthesizer, test_create_swarm_graph_is_atomic_and_rolls_back_partial_build. |
| `tests/hermes_cli/test_kanban_task_updated_hook.py` | the ``on_kanban_task_updated`` mutation observer (RFC #58548). Verifies the task-mutation boundary observer: ``assign_task`` fires it with. |
| `tests/hermes_cli/test_kanban_terminal_worker_reaper.py` | Invariant: a worker that outlives its own terminal transition is still reachable and gets reaped by the dispatcher (issue #111791). |
| `tests/hermes_cli/test_kanban_transfer.py` | kanban board export / import (``hermes_cli.kanban_transfer``). The contract these pin down is "a board survives the trip to another. |
| `tests/hermes_cli/test_kanban_watch_banner.py` | Watch identifies the board selected by the production command. |
| `tests/hermes_cli/test_kanban_worker_admission_wait.py` | KB-7: the Kanban submitter waits for ``kanban.run``'s admission answer past the default RPC budget. Before it answers, the owner's ``kanban.run``. |
| `tests/hermes_cli/test_kanban_worker_exit_decode.py` | Worker exit classification must not depend on POSIX-only ``os.WIF*`` helpers. ``_classify_worker_exit`` feeds the dead-worker reclaim: a. |
| `tests/hermes_cli/test_kanban_worker_exit_trailer.py` | A dead Kanban worker is booked the same way whichever process notices it. ``_recent_worker_exits`` is filled by ``os.waitpid`` and so only knows. |
| `tests/hermes_cli/test_kanban_worker_image_extraction.py` | Worker-side image enrichment for kanban tasks. When a kanban task body contains a local image path or an ``http(s)://`` image URL, the worker must. |
| `tests/hermes_cli/test_kanban_worker_lifecycle_hooks.py` | the ``on_kanban_worker_*`` observer hooks (RFC #58548). Verifies the worker-lifecycle observers accepted in the #64231 batch disposition. |
| `tests/hermes_cli/test_kanban_worker_owner_wait.py` | A Kanban worker spawned while `hermes update` drains the owner waits for it instead of failing. The dispatcher keeps spawning workers during an. |
| `tests/hermes_cli/test_kanban_worker_pid_fingerprint.py` | A recycled worker PID is never mistaken for our worker. ``tasks.worker_pid`` survives a reboot; the number can then belong to an unrelated process. |
| `tests/hermes_cli/test_kanban_worker_session_source.py` | Kanban worker runs must not surface as user conversations. Workers spawn as `hermes chat -q "work kanban task <id>"`, which used to land in state.db. |
| `tests/hermes_cli/test_kanban_worker_spawn_toolsets.py` | test_default_spawn_pins_assignee_profile_cli_toolsets, test_default_spawn_does_not_pass_mutable_launch_overrides. |
| `tests/hermes_cli/test_kanban_worker_terminal_cwd.py` | Tests: kanban worker spawn pins TERMINAL_CWD to the task workspace. Regression coverage for #34619 and #41312 (same root cause): ``_default_spawn``. |
| `tests/hermes_cli/test_kanban_worker_terminal_scope.py` | A kanban worker spawned for profile B must not inherit the DISPATCHER's credentials. ``_default_spawn`` gated the credential scrub on. |
| `tests/hermes_cli/test_kanban_workflow.py` | Kanban workflow definition: shape, validation, and the copies that derive from it. ``DEFAULT_WORKFLOW`` is data the kernel does not consult yet. |
| `tests/hermes_cli/test_kanban_worktree_isolation.py` | Per-task worktree isolation for decompose siblings. Decompose children used to inherit the root's literal ``workspace_path``, so every sibling of a. |
| `tests/hermes_cli/test_kanban_worktree_teardown.py` | worktree workspace teardown at task completion/archive. Covers the ownership gap where kanban ``worktree`` workspaces were never reaped by. |
| `tests/hermes_cli/test_kanban_worktree_unicode_path.py` | Regression: a composed (NFC) workspace path must resolve against its repo root. macOS hands back DECOMPOSED path strings (NFD: ``o`` + U+0308) for. |
| `tests/hermes_cli/test_kanban_write_guard.py` | #69283: kanban write guard prevents tests from writing to real. |
| `tests/hermes_cli/test_kanban_write_txn_busy_retry.py` | write_txn BUSY-retry behaviour. These tests target the transaction boundary (BEGIN IMMEDIATE / COMMIT) only. On unmodified main write_txn has no. |
| `tests/hermes_cli/test_keyed_provider_credential_pool.py` | Keyed ``providers.<key>`` entries must use the durable pool slug. ``hermes auth add b-ai`` stores keys under ``credential_pool.b-ai``. Runtime used. |
| `tests/hermes_cli/test_kimi_cn_provider_listing.py` | Test that kimi-coding and kimi-coding-cn both appear in the /model picker. Both providers share the same models.dev ID (kimi-for-coding) but are. |
| `tests/hermes_cli/test_kitty_keypad_parity.py` | Modified kitty keypad keys must behave like their non-keypad twins. |
| `tests/hermes_cli/test_launch_readonly.py` | Launch metadata reads cannot create or migrate canonical storage. |
| `tests/hermes_cli/test_launchd_install_start_now.py` | `hermes gateway install --no-start-now` and the setup wizard's "Start the gateway now?" = No on launchd. The plist carries RunAtLoad, so loading it. |
| `tests/hermes_cli/test_launchd_plist_guard.py` | the launchd plist scan's malformed-file tolerance. ``_loaded_launchd_backend_jobs`` documents that unreadable or malformed. |
| `tests/hermes_cli/test_launchd_refresh_reporting.py` | launchd plist refresh must not report success when launchd never registered the service. |
| `tests/hermes_cli/test_launchd_restart_refresh.py` | ``launchd_restart`` must never kickstart a stale service definition. ``launchctl kickstart -k`` re-runs whatever definition launchd already holds. |
| `tests/hermes_cli/test_launcher.py` | the top-level `./hermes` launcher script. |
| `tests/hermes_cli/test_launcher_runtime_selection.py` | Launch-time dependency selection survives a change after launcher. |
| `tests/hermes_cli/test_lazy_command_exports.py` | The frozen updater surface on hermes_cli.main stays lazy and resolvable. ``hermes_cli/update_cmd*.py`` (frozen: old installed versions call into it). |
| `tests/hermes_cli/test_lazy_secrets_dispatch.py` | End-to-end tests for lazy cryptography loading. These tests invoke the real CLI paths as subprocesses to verify: 1. `hermes secrets bitwarden setup. |
| `tests/hermes_cli/test_lazy_secrets_import.py` | test: hermes update must not load cryptography eagerly. |
| `tests/hermes_cli/test_left_core_migration.py` | ``hermes_cli.left_core_migration``: homes that used a feature that left core get its catalog plugin. Real config/.env files under a temp home; the. |
| `tests/hermes_cli/test_legacy_launchers_windows_live.py` | Live Windows probe: pre-suffix gateway launchers are reported by ``status`` and removed by ``uninstall`` (#116157). Runs only on real Windows (the. |
| `tests/hermes_cli/test_lifecycle.py` | test_invoke_hook_notifies_builtin_observers_before_plugins, test_finalize_session_closes_core_before_plugin_export. |
| `tests/hermes_cli/test_linux_desktop_entry.py` | the Linux XDG desktop entry installed by ``hermes desktop``. |
| `tests/hermes_cli/test_linux_launcher_management.py` | Native Linux launcher management through real config and filesystem. |
| `tests/hermes_cli/test_linux_ram_probe.py` | Linux RAM availability must include reclaimable page cache (#102252). ``getconf _AVPHYS_PAGES`` counts only free pages, so the Desktop statusbar. |
| `tests/hermes_cli/test_linux_sandbox_fixup.py` | the Linux desktop sandbox-helper fixup and the userns probe. ``_desktop_linux_sandbox_fixup`` historically demanded a root-owned 4755. |
| `tests/hermes_cli/test_list_picker_providers.py` | ``list_picker_providers`` — the /model picker filter. ``list_picker_providers`` wraps ``list_authenticated_providers`` and post-processes. |
| `tests/hermes_cli/test_list_recent_user_messages_handoffs.py` | list_recent_user_messages must skip legacy compaction handoffs (#80622). Legacy standalone ``[CONTEXT COMPACTION — REFERENCE ONLY]`` handoffs. |
| `tests/hermes_cli/test_lmstudio_context_policy.py` | test_missing_echo_refreshes_loaded_state, test_explicit_override_above_known_maximum_rejects_even_when_loaded. |
| `tests/hermes_cli/test_load_progress.py` | Model-load progress: SSE events -> composite percent -> wait notices. The 40-second problem: a cold local model streams 16-21 GB of weights before. |
| `tests/hermes_cli/test_local_abandoned_requests.py` | Abandoned-request lifecycle: work sent to the managed local server must die when its caller goes away, and teardown must never orphan VRAM. The. |
| `tests/hermes_cli/test_local_component_jobs.py` | Desktop component jobs pause real PM archive transfers before. |
| `tests/hermes_cli/test_local_context_resolution.py` | Context-length resolution for the managed llama.cpp router. The incident: the statusbar showed 131K for a local model the server had granted 262144. |
| `tests/hermes_cli/test_local_download_jobs.py` | Local-model jobs use PM transfers for every entry point. |
| `tests/hermes_cli/test_local_external_draft.py` | An external DFlash draft on a recurrent model: replaces MTP when it fits, on one slot. Speculative decoding keeps one copy of a recurrent model's. |
| `tests/hermes_cli/test_local_growth.py` | In-session growth contracts (growth.py + the presets override seam). The live half of the window ladder: grow before compress, overrides persist. |
| `tests/hermes_cli/test_local_job_registry.py` | Paused work remains discoverable, and terminal phase changes honor pause. |
| `tests/hermes_cli/test_local_launch_budget.py` | Launch windows are sized beside what other programs hold on the card, not from capacity alone. On a 32 GiB card, the capacity plan booted Qwen3.8. |
| `tests/hermes_cli/test_local_legacy_engine.py` | A pre-PM engine under runtimes/llamacpp/ moves into PM's store instead of forcing first-run. |
| `tests/hermes_cli/test_local_legacy_models_dir.py` | Models staged under the old per-profile ``<profile home>/models`` layout are moved into the machine-scoped ``<root>/models`` so they keep. |
| `tests/hermes_cli/test_local_models_activate_rescan.py` | The activate flow's rescan must fire even when another process owns the local server (#115237). ensure_local_runtime returns None when the router is. |
| `tests/hermes_cli/test_local_models_routes.py` | Contract tests for the local-models dashboard routes (Rollout 4). Real FastAPI TestClient against the real router; the runtime pieces underneath are. |
| `tests/hermes_cli/test_local_mtp_head.py` | A model whose MTP head ships as its own file. Qwen3.8 Flash Next carries no MTP layers. ggml-org publishes a head for it in its own repo. |
| `tests/hermes_cli/test_local_n1x_pci_identity.py` | Verify N1X recommendations use PCI identity rather than driver display names. Simulated nvidia-smi output feeds the production memory probe. |
| `tests/hermes_cli/test_local_picker_identity.py` | The managed local server owns its picker identity. A live session on the managed llama-server reports provider "custom" (the resolution seam's. |
| `tests/hermes_cli/test_local_preset_admission.py` | The router must serve only admitted presets, retaining refusal and spill facts on. |
| `tests/hermes_cli/test_local_provider_alias_parity.py` | Parity contract for local OpenAI-compatible provider aliases (issue #62213). The CLI, config, and credential layers each normalise provider names. |
| `tests/hermes_cli/test_local_quickstart.py` | Quickstart route: one POST from nothing to a working local default. Contract, not implementation: the route must (a) preflight-fail synchronously. |
| `tests/hermes_cli/test_local_reasoning_default.py` | Managed reasoning defaults belong to the model preset, below explicit client. |
| `tests/hermes_cli/test_local_recommendation.py` | The recommendation decision table — the reviewable matrix. The recommendation itself is DERIVED (catalog.recommended_entry: best quality among. |
| `tests/hermes_cli/test_local_recommendation_policy.py` | Automatic recommendations require residency; manual choices may. |
| `tests/hermes_cli/test_local_residency_admission.py` | Residency admission is priced against the card, not a constant count. Residency was bounded by ``models_max`` alone, so a second model was admitted. |
| `tests/hermes_cli/test_local_router_autoload.py` | Status reads never load a model. llama-server's router (b11370, ``--models-autoload``) loads an unloaded model for any request that names it. |
| `tests/hermes_cli/test_local_runtime.py` | Contract tests for hermes_cli.local_runtime — Rollouts 1+2. Per the design's verification plan: relationships and contracts, no change-detector. |
| `tests/hermes_cli/test_local_runtime_child_env.py` | A managed llama-server child never inherits credential-shaped environment variables. Issue #116109: on Windows the bundled libomp.dll crashed with. |
| `tests/hermes_cli/test_local_runtime_gguf.py` | Behavior contracts for the managed local runtime's GGUF reader. |
| `tests/hermes_cli/test_local_runtime_gguf_split.py` | A split GGUF is priced as the SET of its shards, never as its first file. Publishers lay split shards out so the first part can hold little more. |
| `tests/hermes_cli/test_local_runtime_gguf_swa.py` | profile_from_gguf must trust the GGUF file's own per-layer SWA pattern over the hardcoded architecture-name table (#109551): an architecture absent. |
| `tests/hermes_cli/test_local_runtime_lazy_read.py` | Tensors llama.cpp reads from disk on demand are not priced as loaded weights. The engine's model loader leaves a tensor its architecture marks. |
| `tests/hermes_cli/test_local_runtime_legacy_state.py` | Legacy local-runtime records must not adopt a reused PID. |
| `tests/hermes_cli/test_local_runtime_load_mode.py` | Managed launch preserves direct I/O across engine command-line. |
| `tests/hermes_cli/test_local_runtime_package_import.py` | Shipped updaters import ``hermes_cli.local_runtime.processes`` from the new tree mid-update. v2026.9.24's ``_subprocess_compat.bounded_probe_run``. |
| `tests/hermes_cli/test_local_runtime_picker_row.py` | The llamacpp provider row in the model picker payload. Contract: staged local GGUFs appear as a selectable provider row in build_models_payload —. |
| `tests/hermes_cli/test_local_runtime_pm.py` | Backend selection uses reviewed target pins and never installs on. |
| `tests/hermes_cli/test_local_runtime_processes.py` | Native containment tests; all processes and homes are disposable. |
| `tests/hermes_cli/test_local_runtime_recovery.py` | Recovery only targets the recorded managed router, never a process-name. |
| `tests/hermes_cli/test_local_runtime_updates.py` | Engine updates read PM pins; boot retains installed bytes without. |
| `tests/hermes_cli/test_local_server_lifecycle.py` | Server on/off lifecycle route (round-9 feedback: 'we should be able to completely turn off the local engine'). Contract: stop tears the server down. |
| `tests/hermes_cli/test_local_window_compute.py` | Compute buffers that grow with the window are priced at the launch posture. Qwen4Exp's QSA attention scores the whole window each microbatch. Under. |
| `tests/hermes_cli/test_local_windows_commit_budget.py` | Windows unified memory: the model and its prompt cache must fit in commit. Windows charges every GPU allocation to commit (RAM Windows can see plus. |
| `tests/hermes_cli/test_local_windows_igpu_pool.py` | An integrated GPU on Windows is budgeted from what Windows lets it allocate, never all of RAM. Windows caps an integrated GPU's allocations at its. |
| `tests/hermes_cli/test_login_cli_command.py` | test_the_cli_handler_prints_the_code_then_drains_off_thread, test_the_drain_only_moves_the_free_tier_model_on_completion. |
| `tests/hermes_cli/test_logs.py` | hermes_cli.logs — log viewing and filtering. |
| `tests/hermes_cli/test_macos_fda_guidance.py` | macOS Full Disk Access onboarding guidance (issue #52010 follow-up). One FDA grant silences every per-folder TCC prompt permanently. Doctor reports. |
| `tests/hermes_cli/test_macos_tcc_anchor.py` | the dylib-complete macOS TCC anchor (issue #95596). Re-land of the interpreter anchor reverted in #95563. The first landing bricked real. |
| `tests/hermes_cli/test_main_merge_lifecycle.py` | Behavior parity at lifecycle helpers extracted before the main. |
| `tests/hermes_cli/test_main_model_custom_provider_normalization.py` | Dashboard main-model writes preserve declared provider identities. |
| `tests/hermes_cli/test_managed_install_shapes.py` | Managed-mode detection across the Nix install shapes. The NixOS module and the Home Manager module both mark the install as managed, and the CLI. |
| `tests/hermes_cli/test_managed_installs.py` | test_recommended_update_command_defaults_to_hermes_update, test_get_managed_system_false_values. |
| `tests/hermes_cli/test_managed_scope.py` | hermes_cli.managed_scope (resolver + loaders + key helpers). |
| `tests/hermes_cli/test_managed_scope_cli_config.py` | Managed scope must reach cli.py's independent config loader (CLI_CONFIG). cli.py's load_cli_config() builds config separately from. |
| `tests/hermes_cli/test_managed_scope_config.py` | Config integration tests — managed scope wins over user config at the. |
| `tests/hermes_cli/test_managed_scope_env.py` | Env integration tests — managed .env applied last with override. |
| `tests/hermes_cli/test_managed_scope_loaders.py` | Each standalone config loader (gateway, TUI/desktop, cron) must honor managed scope. These loaders build their own config dict instead of routing. |
| `tests/hermes_cli/test_managed_scope_overlay.py` | apply_managed_overlay() — the shared helper used by every standalone. |
| `tests/hermes_cli/test_managed_scope_regression.py` | harness — pins config/env load behavior BEFORE managed scope exists. Every test here must keep passing through all later phases when NO. |
| `tests/hermes_cli/test_managed_scope_surfacing.py` | Surfacing tests — managed scope shown in `config show` and `hermes. |
| `tests/hermes_cli/test_managed_scope_writeguard.py` | Write-guard tests — managed keys can't be set/removed by the user. |
| `tests/hermes_cli/test_managed_vision_capability.py` | Vision capability for managed local models answers from ground truth. Cloud capability catalogs have never heard of a local GGUF, so without a. |
| `tests/hermes_cli/test_manual_compress.py` | CLI manual compression messaging. |
| `tests/hermes_cli/test_manual_serve_deferral.py` | Manual serve restart obligations survive gateway completion and receipt rotation. |
| `tests/hermes_cli/test_mcp_catalog.py` | hermes_cli.mcp_catalog and hermes_cli.mcp_picker. Manifest parsing, install/uninstall config writes, and picker plumbing are exercised. |
| `tests/hermes_cli/test_mcp_catalog_env_boundary.py` | Security boundary tests for dashboard MCP catalog credential writes. |
| `tests/hermes_cli/test_mcp_config.py` | hermes_cli.mcp_config — ``hermes mcp`` subcommands. These tests mock the MCP server connection layer so they run without any actual MCP. |
| `tests/hermes_cli/test_mcp_dashboard_oauth.py` | Dashboard HTTP contract for hosted MCP OAuth. |
| `tests/hermes_cli/test_mcp_discovery_timing.py` | MCP discovery timing in non-interactive sessions. Covers the race where AIAgent snapshots its tool registry at construction. |
| `tests/hermes_cli/test_mcp_helper_ledger.py` | stdio MCP helper children in the spawn ledger (#61514). Covers ``register_child`` (the ledger mirror of ``register_self`` for subprocesses. |
| `tests/hermes_cli/test_mcp_login_window.py` | An OAuth login waits as long as ``oauth.timeout`` says, and a probe timeout names itself (#116278). ``hermes mcp login`` (and the dashboard /. |
| `tests/hermes_cli/test_mcp_probe_redaction.py` | MCP test/dashboard must not fingerprint Authorization credentials. |
| `tests/hermes_cli/test_mcp_security.py` | MCP server exfiltration hardening. |
| `tests/hermes_cli/test_mcp_startup.py` | bounded/lazy CLI MCP startup. |
| `tests/hermes_cli/test_mcp_tools_config.py` | MCP tools interactive configuration in hermes_cli.tools_config. |
| `tests/hermes_cli/test_mem_trim.py` | the long-lived gateway heap-trim helper. |
| `tests/hermes_cli/test_memory_dependency_admission.py` | Memory setup admits a complete candidate before saving its selection. |
| `tests/hermes_cli/test_memory_provider_core_sentinels.py` | ``memory.provider`` set to a core sentinel (``builtin``/``default``/``none``) names the built-in store, not a plugin: doctor and the provider. |
| `tests/hermes_cli/test_memory_provider_migration.py` | A memory provider that left core is installed from the catalog, config untouched; a provider the catalog does not know is reported with the. |
| `tests/hermes_cli/test_memory_setup.py` | test_cmd_setup_generic_choice_cancel_writes_nothing, test_install_dependencies_prepares_declared_extra_even_if_importable. |
| `tests/hermes_cli/test_memory_setup_env_denylist.py` | the env-write denylist on the memory-setup ``.env`` writer. ``hermes_cli.memory_setup._write_env_vars`` persists provider plugin. |
| `tests/hermes_cli/test_memory_setup_provider_arg.py` | `hermes memory setup [provider]` routing. The `memory setup` subcommand accepts an optional positional ``provider`` so a fresh install can. |
| `tests/hermes_cli/test_memory_status_env_hint.py` | `hermes memory status` should explain *why* a provider is unavailable. Regression coverage for NousResearch/hermes-agent#2765: when the selected. |
| `tests/hermes_cli/test_merge_profile_tree.py` | _merge_profile_tree folds projects across profiles by normalized. |
| `tests/hermes_cli/test_messaging_catalog_plugin_metadata.py` | A platform plugin's PlatformEntry is the single source of its dashboard card and write. |
| `tests/hermes_cli/test_meta_prompt_cache.py` | Behavior contracts for Meta Muse prompt-caching host mandate. |
| `tests/hermes_cli/test_migrate_xai.py` | ``hermes migrate xai`` — apply path with ruamel round-trip. |
| `tests/hermes_cli/test_minimax_model_validation.py` | MiniMax model validation via static catalog (issues #12611, #12460, #12399, #12547). MiniMax and MiniMax-CN providers don't expose. |
| `tests/hermes_cli/test_minimax_oauth.py` | MiniMax OAuth provider (hermes_cli/auth.py). Covers: - PKCE pair generation (S256 challenge) - _minimax_request_user_code happy path and. |
| `tests/hermes_cli/test_moa_command.py` | test_moa_bare_shows_usage_no_switch, test_moa_arg_is_always_one_shot_prompt. |
| `tests/hermes_cli/test_moa_config.py` | test_moa_slot_picker_excludes_unconfigured_providers, test_normalize_moa_config_uses_default_named_preset. |
| `tests/hermes_cli/test_moa_numeric_config.py` | Malformed numeric MoA settings must degrade to defaults, not break the CLI or. |
| `tests/hermes_cli/test_moa_preset_config_warnings.py` | A user's named MoA presets are not schema-defaulted config options. |
| `tests/hermes_cli/test_moa_preset_deletion.py` | A MoA preset dropped from the payload must leave config.yaml. ``PUT /api/model/moa`` expresses a deletion by OMITTING the preset from ``presets``. |
| `tests/hermes_cli/test_moa_set_models_preserves_extra_keys.py` | ``set_moa_models`` preserving undeclared config keys. Issue #58819: ``MoaConfigPayload`` does not declare ``save_traces`` or. |
| `tests/hermes_cli/test_model_alias_credentials.py` | Direct-alias (``model_aliases:``) credential resolution (#83612). An alias that points at a custom endpoint must authenticate with **its own**. |
| `tests/hermes_cli/test_model_assignment_env_key_mirror.py` | #88990: Desktop model assignment must not copy env-backed keys into model.api_key. ``POST /api/model/set`` (``_apply_model_assignment_sync``). |
| `tests/hermes_cli/test_model_cache_fallback_rows.py` | A curated fallback served because the live catalog fetch failed must never be pinned in the disk cache as if it were the account's real catalog. |
| `tests/hermes_cli/test_model_cache_parallel_prefetch.py` | parallel model-catalog prefetch and thread-safe cache writes. Regression tests for the serial /v1/models bottleneck: when the 1h disk. |
| `tests/hermes_cli/test_model_cache_swr.py` | Stale-while-revalidate behavior for the model-id disk cache and the remote model-catalog manifest. Regression tests for the /model picker stall. |
| `tests/hermes_cli/test_model_catalog.py` | hermes_cli.model_catalog — remote manifest fetch + cache + fallback. |
| `tests/hermes_cli/test_model_cost_guard.py` | test_no_warning_when_known_prices_are_at_threshold, test_warns_when_models_dev_input_price_exceeds_threshold. |
| `tests/hermes_cli/test_model_data_policy_guard.py` | the data-training-tier selection guard. |
| `tests/hermes_cli/test_model_flow_external_process_setup.py` | `hermes model` for a process provider gates on the CLI's login and lists its live picker. The generic plugin flow (``_model_flow_plugin_provider``). |
| `tests/hermes_cli/test_model_flow_local.py` | ``hermes model`` → Local models runs the desktop's Local Models setup in the. |
| `tests/hermes_cli/test_model_flow_pooled_credentials.py` | Pool-only credentials must be visible to interactive model setup. |
| `tests/hermes_cli/test_model_info_probe_timeout.py` | /api/model/info must bound its context-length probe (#63214). The resolver chain (``agent.model_metadata.get_model_context_length``) runs several. |
| `tests/hermes_cli/test_model_normalize.py` | hermes_cli.model_normalize — provider-aware model name normalization. Covers issue #5211: opencode-go model names with dots (e.g. |
| `tests/hermes_cli/test_model_options_account_usage.py` | The model picker shows subscription usage before the wall, without ever waiting on a usage API. Usage windows come from the provider's API, so. |
| `tests/hermes_cli/test_model_options_pool_usage.py` | Pool-aware model-picker usage: per-account rows, cache isolation, honest failures. Real-path regression tests for. |
| `tests/hermes_cli/test_model_options_rate_limited_pool.py` | A rate-limited provider stays in the GUI model picker (#103829, #124510). Claude Pro/Max and ChatGPT subscriptions hit usage windows constantly. The. |
| `tests/hermes_cli/test_model_options_read_path_catalogs.py` | ``model.options`` is a READ path: opening the picker must not wait on a provider catalog probe. A normal open (``refresh=False``) used to run live. |
| `tests/hermes_cli/test_model_persist_one_shape.py` | One config.yaml shape for a persisted model selection, whichever surface wrote it. ``/model --global`` reaches config.yaml from four places (CLI. |
| `tests/hermes_cli/test_model_picker_excluded_providers.py` | ``model_catalog.excluded_providers`` hides providers from the interactive ``hermes model`` CLI picker. The CLI picker. |
| `tests/hermes_cli/test_model_picker_expensive_confirm.py` | test_prompt_toolkit_model_picker_defers_confirmation_off_key_handler. |
| `tests/hermes_cli/test_model_picker_filter.py` | the /model picker fuzzy filter (C-01). The filter narrows a provider's concrete model list as the user types, but selection must still. |
| `tests/hermes_cli/test_model_picker_secret_scope.py` | The /model picker must read provider keys through the per-profile scope. 854007d1c ("route remaining main-agent fallback key reads through. |
| `tests/hermes_cli/test_model_picker_viewport.py` | the prompt_toolkit /model picker scroll viewport. Regression for: when a provider exposes many models (e.g. Ollama Cloud's 36+), the. |
| `tests/hermes_cli/test_model_prefix_routing.py` | vendor-prefix model routing and dict model.aliases (#87189). ``--model nous/deepseek-v4-pro`` / ``--model ollama/qwen3.5:4b``. |
| `tests/hermes_cli/test_model_provider_persistence.py` | provider selection via `hermes model` always persists correctly. Regression tests for the bug where _save_model_choice could save. |
| `tests/hermes_cli/test_model_search.py` | Picker search aliases for brand-less wire model ids. |
| `tests/hermes_cli/test_model_search_alias_dedup.py` | Picker dedup must fold live bare wire-ids into their curated public slug. Kimi Coding Plan live-discovers its flagship as the bare id ``k3`` while. |
| `tests/hermes_cli/test_model_selection_atomic_persistence.py` | A saved model route is one publication, including stale credential. |
| `tests/hermes_cli/test_model_selection_guards.py` | the unified model-selection guard registry. |
| `tests/hermes_cli/test_model_set_preserve_custom_endpoint.py` | Red test for #76324: POST /api/model/set preserving a CLI-configured bare ``custom`` endpoint. The CLI gateway setup writes:: model: default. |
| `tests/hermes_cli/test_model_set_secret_copy.py` | POST /api/model/set must never copy an env-expanded secret into config.yaml. Regression for #88990: ``_apply_model_assignment_sync`` ran on the. |
| `tests/hermes_cli/test_model_switch_configured_provider_routing.py` | #45006: typed `/model <name>` resolution must route a model declared in user/custom provider config to that provider instead of. |
| `tests/hermes_cli/test_model_switch_confirm_thread.py` | The /model <name> --provider <p> path must run the expensive-model confirm + apply sequence off the main thread. The confirm modal blocks its. |
| `tests/hermes_cli/test_model_switch_context_display.py` | test for /model context-length display on provider-capped models. Bug (April 2026): `/model gpt-5.5` on openai-codex (ChatGPT OAuth). |
| `tests/hermes_cli/test_model_switch_copilot_api_mode.py` | Copilot api_mode recomputation during /model switch. When switching models within the Copilot provider (e.g. GPT-5 → Claude). |
| `tests/hermes_cli/test_model_switch_custom_providers.py` | /model support of config.yaml custom_providers. The terminal `hermes model` flow already exposes `custom_providers`, but the. |
| `tests/hermes_cli/test_model_switch_external_process_alias.py` | `/model <alias>` stays on an external-process provider that declares the alias. Process providers are not in models.dev, so ``list_provider_models``. |
| `tests/hermes_cli/test_model_switch_filter_unresolved.py` | Picker rows must resolve to a runtime provider (#57503). |
| `tests/hermes_cli/test_model_switch_openai_api_mode.py` | OpenAI-direct api_mode recomputation during /model switch. api.openai.com only accepts the Responses API (codex_responses) for. |
| `tests/hermes_cli/test_model_switch_opencode_anthropic.py` | OpenCode /v1 stripping during /model switch. When switching to an Anthropic-routed OpenCode model mid-session (e.g. ``/model. |
| `tests/hermes_cli/test_model_switch_parsing.py` | Single-owner /model argument parsing (hermes_cli.model_switch.parse_model_switch_args). |
| `tests/hermes_cli/test_model_switch_persist_default.py` | session-scoped-by-default model switching. Covers: - ``resolve_persist_behavior`` applies the config-gated default and the ``--session`` /. |
| `tests/hermes_cli/test_model_switch_reasoning_flag.py` | ``/model <name> --reasoning <level>`` — one request carries a model pick AND its effort. The parser is the single owner. |
| `tests/hermes_cli/test_model_switch_reasoning_reresolve.py` | The CLI-level ``reasoning_config`` follows the model on every path that moves ``cli.model``. Startup resolves the effort once for the launch model. |
| `tests/hermes_cli/test_model_switch_user_provider_slug_verbatim.py` | A model the user selected on their own ``providers.<key>`` endpoint survives ``/model`` verbatim — whether the slug arrives as ``custom:<key>`` or. |
| `tests/hermes_cli/test_model_switch_variant_tags.py` | OpenRouter variant tag preservation in model switching. Regression test for GitHub PR #6088 / Discord report: OpenRouter model IDs with. |
| `tests/hermes_cli/test_model_validation.py` | provider-aware `/model` validation in hermes_cli.models. |
| `tests/hermes_cli/test_model_validation_managed_local.py` | the managed llama.cpp runtime branch in /model validation (#115237). |
| `tests/hermes_cli/test_models.py` | the hermes_cli models module. |
| `tests/hermes_cli/test_models_analytics_attribution.py` | Models analytics must attribute usage per API call, not per session (#71778). The ``sessions`` row keeps only the final ``(model. |
| `tests/hermes_cli/test_models_analytics_dedup.py` | Models analytics must emit one row per (model, provider) pair (#89631). ``_aux_usage_rows`` groups by (model, task, billing_provider), so a model. |
| `tests/hermes_cli/test_models_catalog_late_plugin_provider.py` | A provider registered after ``hermes_cli.models`` was imported still reaches the picker catalog. ``CANONICAL_PROVIDERS`` admitted plugin providers. |
| `tests/hermes_cli/test_models_detect_credential_gate.py` | Auto-detection must never hand the user a provider they hold no credentials for. Regression for the "accidental provider" class: ``/model <name>``. |
| `tests/hermes_cli/test_models_detect_live_catalog.py` | ``detect_provider_for_model`` must not re-route a model the CURRENT provider already serves. Regression for the OpenRouter hijack (#97487, the. |
| `tests/hermes_cli/test_models_detect_vendor_ownership.py` | A first-party session never re-routes its own vendor's model when the live catalog cannot vouch. Second half of the Astra incident (#97487): the. |
| `tests/hermes_cli/test_models_dev_preferred_merge.py` | the models.dev-preferred merge behavior in provider_model_ids and list_authenticated_providers. These guard the contract: * For providers. |
| `tests/hermes_cli/test_models_relay_base_url.py` | `model.base_url` relays must be probed instead of the vendor's canonical host. |
| `tests/hermes_cli/test_modify_other_keys_aliases.py` | issue #87711 — Ctrl+key / Alt+key combos broken under modifyOtherKeys level 2. When the CLI pushes ``ESC[>4;2m``. |
| `tests/hermes_cli/test_multiplex_cli_cache_scope.py` | Multiplexed gateway: hermes_cli's process-wide caches must not hand profile A's value to profile B. Every test builds two real profile homes. |
| `tests/hermes_cli/test_multiplex_host_topology_reporting.py` | Multiplex-only reporting: one host gateway serving N profiles must be reported as such. Invariants (all fail on origin/main): * ``hermes -p <served>. |
| `tests/hermes_cli/test_native_profile_route_names.py` | Profiles NAMED like a collection route (``active``, ``import``, ``sessions``) are ordinary profiles. ``/api/profiles/active`` is the sticky-default. |
| `tests/hermes_cli/test_native_profile_scope_threads.py` | A secondary-profile native ticket's implicit scope must reach the audio worker. |
| `tests/hermes_cli/test_nebius_token_factory_provider.py` | Focused tests for Nebius Token Factory provider wiring. |
| `tests/hermes_cli/test_node_runtime_npm_resolution.py` | POSIX npm path classification: only Windows shims are refused (#112041. |
| `tests/hermes_cli/test_non_ascii_credential.py` | non-ASCII credential detection and sanitization. Covers the fix for issue #6843 — API keys containing Unicode lookalike characters (e.g. ʋ. |
| `tests/hermes_cli/test_noninteractive_config_guard.py` | coverage for fail-closed non-interactive config startup. |
| `tests/hermes_cli/test_noninteractive_git.py` | Non-interactive internal git invocations (port of openai/codex#34540/#34612). Internal git plumbing (MCP catalog installs, plugin install/update. |
| `tests/hermes_cli/test_normalize_main_model_assignment.py` | ``_normalize_main_model_assignment`` (POST /api/model/set). Named custom providers are represented as ``custom:<name>`` slugs. |
| `tests/hermes_cli/test_nous_account.py` | normalized Nous Portal account entitlement helpers. |
| `tests/hermes_cli/test_nous_anthropic_wire_default.py` | ``nous.anthropic_wire`` selects the Portal route for ``anthropic/*``: ``chat`` (default) rides /v1/chat/completions, ``native`` rides /v1/messages. |
| `tests/hermes_cli/test_nous_auth_keepalive.py` | test_refresh_always_fires_before_expiry_for_observed_lifetimes, test_interval_precedence_and_disable. |
| `tests/hermes_cli/test_nous_auth_status_cache.py` | the get_nous_auth_status() process-level cache. The cache avoids re-validating Nous credentials on every menu paint — `hermes tools` →. |
| `tests/hermes_cli/test_nous_billing_request.py` | the hermes_cli.nous_billing HTTP client's response handling. Focus: a 2xx response with a NON-JSON body (e.g. a reverse-proxy / SPA. |
| `tests/hermes_cli/test_nous_hermes_non_agentic.py` | the Nous-Hermes-3/4 non-agentic warning detector. Prior to this check, the warning fired on any model whose name contained ``"hermes"``. |
| `tests/hermes_cli/test_nous_inference_url_validation.py` | Nous Portal inference_base_url host-allowlist validation. A poisoned ``inference_base_url`` from a Portal refresh response. |
| `tests/hermes_cli/test_nous_nonproduction_inference_host.py` | Operator authority over Nous routing overrides and Portal-returned inference hosts. Portal-returned inference URLs go through a host allowlist. |
| `tests/hermes_cli/test_nous_picker_cached_only_key.py` | The GUI/in-chat picker's on-sale union reads what the prewarm actually cached. The Nous fetcher registers its provider cache key WITHOUT the. |
| `tests/hermes_cli/test_nous_picker_on_sale.py` | Paid-tier Nous pickers surface every model the gateway is discounting, not only curated ones. A sale exists only in the live ``/v1/models``. |
| `tests/hermes_cli/test_nous_picker_pricing_cached_only.py` | The Nous picker row never starts a pricing fetch: the picker only uses the ids the Portal unions append, and a cold pricing cache must not hold the. |
| `tests/hermes_cli/test_nous_policy_filter.py` | Narrowing the Nous model lists to an org's policy. The gateway omits policy-blocked rows from an authenticated ``GET /v1/models``, so that. |
| `tests/hermes_cli/test_nous_policy_surfaces.py` | Every Nous model list is narrowed to the org's policy before it is shown. Four surfaces build their list from the curated manifest unioned with the. |
| `tests/hermes_cli/test_nous_portal_staging_allowlist.py` | the Nous Portal env-override bypassing the host allowlist, mirroring the existing NOUS_INFERENCE_BASE_URL /. |
| `tests/hermes_cli/test_nous_reasoning_metadata.py` | Nous Portal reasoning-capability metadata. The Portal serves OpenRouter's catalog schema, so it reuses. |
| `tests/hermes_cli/test_nous_recommendation_disk_cache.py` | Recommendation requests reuse disk entries and negotiate gzip across real. |
| `tests/hermes_cli/test_nous_session_validity.py` | the local-only Nous session classifier exposed on /api/status. |
| `tests/hermes_cli/test_nous_subscription.py` | Nous subscription feature detection. |
| `tests/hermes_cli/test_npm_engine.py` | The frozen npm retry import hands off, never provisioning in the old. |
| `tests/hermes_cli/test_oauth_status_pool_observation.py` | A status snapshot observes the credential pool; it never leases (refreshes / rotates) an entry. ``get_codex_auth_status`` /. |
| `tests/hermes_cli/test_observational_sessiondb_modes.py` | coverage for #110173: observational `hermes sessions` readers stay. |
| `tests/hermes_cli/test_official_openai_host.py` | Security + parity contract for ``is_official_openai_host``. One predicate decides "is this endpoint OpenAI's official API surface?" for every lane. |
| `tests/hermes_cli/test_old_updater_additional_shims.py` | Retired import names hand off old updater work without claiming. |
| `tests/hermes_cli/test_old_updater_main_shims.py` | Historical main imports must not restart pre-PM updater work after a. |
| `tests/hermes_cli/test_old_updater_shims.py` | The post-swap import boundary must never revive retired installers. |
| `tests/hermes_cli/test_old_updater_takeover.py` | Historical frames stay old; completion runs once in a clean child. |
| `tests/hermes_cli/test_ollama_cloud_auth.py` | Ollama Cloud authentication and /model switch fixes. Covers: - OLLAMA_API_KEY resolution for custom endpoints pointing to ollama.com -. |
| `tests/hermes_cli/test_ollama_cloud_provider.py` | Ollama Cloud provider integration. |
| `tests/hermes_cli/test_onboarding_due.py` | The boot-time onboarding due answer (``hermes_cli.onboarding_due``): a reader during the boot computation waits for it, and a writer that moves the. |
| `tests/hermes_cli/test_onboarding_run.py` | ``onboarding.run`` lives in the root profile's config.yaml: unset runs onboarding only on a machine that never used Hermes, an explicit bool wins. |
| `tests/hermes_cli/test_oneshot_exit_contract.py` | ``hermes -z`` exit-code contract: the outcome is judged from the turn result, not from whether any text was printed (#111770 — an incomplete or. |
| `tests/hermes_cli/test_oneshot_fallback.py` | #81209: ``hermes -z`` must consult the fallback chain at *resolution* time. A quota-exhausted / expired primary raises ``AuthError`` from. |
| `tests/hermes_cli/test_oneshot_resume.py` | `hermes -z --resume <session>` (#105892). The oneshot path used to accept ``--resume``/``-c`` in the parser but silently drop them. |
| `tests/hermes_cli/test_oneshot_resumed_session_persist.py` | #88583 — one-shot resumed-session turns must persist. Bot Mode's bot-to-bot send (``hermes -p <bot> chat --in ~ -c "Bot Chat". |
| `tests/hermes_cli/test_oneshot_skills.py` | tests: -z/--oneshot must honor -s/--skills (#31548, #65119). The oneshot path builds its AIAgent directly (bypassing HermesCLI), so the. |
| `tests/hermes_cli/test_oneshot_streamed_live.py` | `hermes -z` against a real gateway with streaming on: the one-shot prints the reply (#139666). With ``streaming.enabled`` the local route's stream. |
| `tests/hermes_cli/test_oneshot_surrogate.py` | Oneshot stdout must survive lone UTF-16 surrogates in model text. |
| `tests/hermes_cli/test_oneshot_usage_file.py` | hermes -z --usage-file (per-run JSON usage report). |
| `tests/hermes_cli/test_openai_codex_model_validation_fallback.py` | OpenAI Codex model validation when the listing lags behind actually usable backend model IDs. The bug originally reported in. |
| `tests/hermes_cli/test_openai_discovery_endpoint.py` | Discovery honors ``model.base_url`` and cache identity tracks the endpoint. Coatue data-residency report, issues 3 and 4: with ``model.base_url. |
| `tests/hermes_cli/test_openai_listing_authority.py` | Live-listing authority on official OpenAI hosts (model switching). Coatue data-residency report, issue 2: on an API key whose project only grants a. |
| `tests/hermes_cli/test_openai_picker_curated.py` | two OpenAI/OpenRouter model-picker bugs. Bug 1 — OpenAI picker dumped the raw ``/v1/models`` catalog. |
| `tests/hermes_cli/test_opencode_go_flat_namespace.py` | opencode-go / opencode-zen flat-namespace model handling. OpenCode Go is NOT a vendor/model aggregator like OpenRouter — its. |
| `tests/hermes_cli/test_opencode_go_in_model_list.py` | Test that opencode-go appears in /model list when credentials are. |
| `tests/hermes_cli/test_opencode_go_validation_fallback.py` | the static-catalog fallback in validate_requested_model. OpenCode Go and OpenCode Zen publish an OpenAI-compatible API at paths that do. |
| `tests/hermes_cli/test_opencode_zen_model_limit.py` | OpenCode Zen model picker limits. |
| `tests/hermes_cli/test_openrouter_preset_validation.py` | coverage for OpenRouter preset references (issue #31739). |
| `tests/hermes_cli/test_openrouter_reasoning_metadata.py` | OpenRouter reasoning-capability metadata (prime-agent#1258 port). Covers: - parse_openrouter_reasoning_capabilities: catalog-entry. |
| `tests/hermes_cli/test_orphan_desktop_serve_reap.py` | Orphan Desktop-local ``hermes serve`` reap at backend start. When Desktop dies uncleanly, local ``serve --host 127.0.0.1 --port 0`` children can be. |
| `tests/hermes_cli/test_overlay_slug_resolution.py` | Test that overlay providers with mismatched models.dev keys resolve correctly. HERMES_OVERLAYS keys may be models.dev IDs (e.g. "github-copilot"). |
| `tests/hermes_cli/test_pairing.py` | test_cli_listed_request_id_and_bot_code_can_be_approved. |
| `tests/hermes_cli/test_parser_help_home.py` | The top-level parser's help text must not trip the wrong-profile fallback warning. ``main._apply_profile_override`` builds the parser. |
| `tests/hermes_cli/test_partial_compress.py` | hermes_cli.partial_compress — the pure split/parse helpers behind ``/compress here [N]`` (boundary-aware "summarize up to here"). Inspired. |
| `tests/hermes_cli/test_passive_update_opt_out.py` | Passive opt-out keeps explicit update checks available. |
| `tests/hermes_cli/test_path_completion.py` | file path autocomplete in the CLI completer. |
| `tests/hermes_cli/test_peer_cmd.py` | ``hermes peer`` — cross-machine bot-to-bot DMs. |
| `tests/hermes_cli/test_peer_dm_reporting.py` | What ``hermes peer dm`` tells the sender when the turn does not come back. A peer DM is one synchronous ``POST /api/sessions/{id}/chat`` with a 600. |
| `tests/hermes_cli/test_pending_supervisor_recovery.py` | A pending restart is discharged by supervisor evidence, not an empty PID. |
| `tests/hermes_cli/test_personality_none.py` | /personality none — clearing personality overlay. Updated for the single-owner unification (hermes_cli.personality): built-ins always. |
| `tests/hermes_cli/test_personality_single_owner.py` | hermes_cli.personality — the single owner of personality state — and the v34 one-time personality reset migration. Regression coverage for. |
| `tests/hermes_cli/test_pet_toggle.py` | pet slash-command config helpers. |
| `tests/hermes_cli/test_picker_key_cmd_discovery.py` | Command-auth discovery is lazy, credential-scoped, and never persists. |
| `tests/hermes_cli/test_picker_prewarm.py` | the /model picker background cache prewarm. ``prewarm_picker_cache_async()`` warms the provider-models disk cache off the user's critical. |
| `tests/hermes_cli/test_picker_probe_budget_decoupling.py` | test for the probe-budget decoupling on #103843. ``for_picker`` historically picked the custom-endpoint discovery timeout (1.5s fast / 5s. |
| `tests/hermes_cli/test_pin_kanban_board_env.py` | `_pin_kanban_board_env` helper invoked by `cmd_chat`. Regression coverage for #20074: a chat session must export the active kanban board. |
| `tests/hermes_cli/test_pip_install_detection.py` | test_code_scoped_stamp_wins_over_home_stamp, test_container_without_stamp_is_not_docker. |
| `tests/hermes_cli/test_plan_reconciliation_windows_live.py` | LIVE Windows E2E for plan-reconciliation (#92902) on windows-latest. Real processes with real Hermes-shaped argv, real inventory collection. |
| `tests/hermes_cli/test_platform_actions.py` | the capability-gated platform action facade (#64176, action half). Covers: * gate default-off: no grant → ``capability_not_granted``. |
| `tests/hermes_cli/test_platform_plugin_env_injection.py` | User-installed platform plugins feed OPTIONAL_ENV_VARS like bundled ones (#46600, redo of #46964). The Desktop Gateway form and ``hermes config``. |
| `tests/hermes_cli/test_plugin_api_compat.py` | Behavior-contract compatibility tests for native Hermes plugins. |
| `tests/hermes_cli/test_plugin_api_consent_gate.py` | The runtime plugin gate holds on every transport and for every profile a multiplexed daemon serves. Regressions for #134889: - PLG-8. |
| `tests/hermes_cli/test_plugin_api_hot_mount.py` | A plugin installed and enabled after the web server imported must serve its backend API on the first request — no restart — and stop serving once. |
| `tests/hermes_cli/test_plugin_aux_tasks_dashboard.py` | Plugin-registered auxiliary tasks reach the dashboard/Desktop Models settings. ``PluginContext.register_auxiliary_task`` already puts a plugin task. |
| `tests/hermes_cli/test_plugin_auxiliary_tasks.py` | Plugin-registered auxiliary tasks merge into the built-in task list and. |
| `tests/hermes_cli/test_plugin_call_mcp.py` | the capability-gated ``ctx.call_mcp`` plugin surface (#64204). The gate: ``plugins.entries.<plugin_id>.mcp_allowlist`` — a list of MCP. |
| `tests/hermes_cli/test_plugin_catalog.py` | Plugin catalog contracts (hermes_cli/plugin_catalog.py): the in-tree seed is valid, bad entries are skipped not raised, kill-list matching is. |
| `tests/hermes_cli/test_plugin_catalog_known_issues.py` | #124058: catalog ``known_issues`` is an informational field. The catalog (``plugin-catalog/hindsight.yaml``) documents in prose that. |
| `tests/hermes_cli/test_plugin_catalog_presence.py` | The onboarding card's catalog plugins: curated flag, platform filter, and the pinned app. |
| `tests/hermes_cli/test_plugin_cli_registration.py` | Memory plugin CLI discovery: only the active provider's ``cli.py`` commands are. |
| `tests/hermes_cli/test_plugin_command_source.py` | Plugin slash-command handlers receive only the calling-session context they. |
| `tests/hermes_cli/test_plugin_config_state_bridge.py` | End-to-end coverage for the profile-scoped plugin config/state bridge. |
| `tests/hermes_cli/test_plugin_dependency_consent.py` | Only declared Python dependencies require Python install consent. |
| `tests/hermes_cli/test_plugin_dev.py` | test_doctor_uses_registration_to_reject_bad_hook_and_callback_signature, test_doctor_accepts_manifest_defaults_from_runtime_parser. |
| `tests/hermes_cli/test_plugin_doctor_desktop_copy.py` | ``hermes plugins doctor`` warns when Desktop runs a stale copy of a unified package's desktop. |
| `tests/hermes_cli/test_plugin_doctor_unload.py` | `plugins doctor` must unload the plugin before removing the temp home (#99918). Doctor loads a plugin under a temporary ``HERMES_HOME`` through a. |
| `tests/hermes_cli/test_plugin_event_bus.py` | the inter-plugin event bus (PluginContext.emit / subscribe). Covers: - Two plugins communicate via emit/subscribe; emit returns listener. |
| `tests/hermes_cli/test_plugin_events.py` | Public event bridge for plugin backends (#116305 item 8, salvage of #116419). A plugin backend pushes events to its own desktop half through. |
| `tests/hermes_cli/test_plugin_historic_compat.py` | Shipped plugin callers keep their contract without owning PM publication. |
| `tests/hermes_cli/test_plugin_hook_failure_reporting.py` | A plugin hook that fails identically on every call is reported once, not once per call. A callback whose signature names a parameter the hook never. |
| `tests/hermes_cli/test_plugin_host.py` | plugins.isolation: host — third-party plugins run in a per-profile host process, reached only via. |
| `tests/hermes_cli/test_plugin_host_route_auth.py` | #140499: upstream admission survives credential-free hosting. |
| `tests/hermes_cli/test_plugin_install_manifest_version.py` | Installer accepts every manifest_version the runtime loader supports (#85879). The installer used to carry its own private manifest-version cap. |
| `tests/hermes_cli/test_plugin_install_records_concurrent.py` | Plugins installed a second apart both keep their install record. The Desktop install card runs its rows a second apart. Each install reads. |
| `tests/hermes_cli/test_plugin_install_ref.py` | Exact-commit plugin installation and source metadata. |
| `tests/hermes_cli/test_plugin_loader_module_eviction.py` | Regression: ``_evict_modules`` must survive concurrent mutation of. |
| `tests/hermes_cli/test_plugin_manifest_v2.py` | plugin manifest v2 (#64165). Covers: v1 regression (unchanged behavior), v2 field parsing, unknown-field forward compat, requires_plugins. |
| `tests/hermes_cli/test_plugin_message_injection.py` | plugin message injection across CLI and gateway hosts. |
| `tests/hermes_cli/test_plugin_module_eviction_race.py` | A module mapping that grows while ``_evict_modules`` walks it must not fail the eviction (refs #139134). ``_evict_modules`` runs at the start of. |
| `tests/hermes_cli/test_plugin_native_ws_scope.py` | A Desktop plugin socket's native grant decides its consent and its scope before plugin code (PLG-1). The one-use ``native-http`` grant names the. |
| `tests/hermes_cli/test_plugin_oauth.py` | Plugin-declared OAuth clients: Hermes signs in, stores and refreshes the grant; plugin code never holds a token. A real plugin directory under the. |
| `tests/hermes_cli/test_plugin_ownership_ledger.py` | End-to-end coverage for plugin registration ownership and reload. |
| `tests/hermes_cli/test_plugin_packs.py` | Plugin packs (#64166): parse/validate, SHA enforcement, install fan-out, export round-trip, consent-not-bypassed, partial-failure exit codes. No. |
| `tests/hermes_cli/test_plugin_presence_by_name.py` | ``presence_for(names)``: catalog plugins by name for the desktop questionnaire — unknown and removed names dropped, other-OS entries dropped, order. |
| `tests/hermes_cli/test_plugin_private_repo_auth.py` | Private-repo plugin installs attach the user's stored HTTPS credential to git without persisting it. Public-repo installs (the catalog default) must. |
| `tests/hermes_cli/test_plugin_prompt_sections.py` | test_registration_validates_stable_id_position_budget_and_duplicates, test_render_is_deterministic_bounded_and_session_info_is_read_only. |
| `tests/hermes_cli/test_plugin_provider_picker_admission.py` | Picker admission for out-of-tree provider plugins with non-api-key auth types. Regression: the CANONICAL_PROVIDERS auto-extend skipped every plugin. |
| `tests/hermes_cli/test_plugin_provider_picker_residue.py` | An admitted plugin provider is selectable and status-accurate on every surface (#116408). Residue after picker admission: `hermes model` had no flow. |
| `tests/hermes_cli/test_plugin_provider_requests.py` | Core makes Codex-signed requests for plugins; the token never reaches plugin code. Real loopback HTTP servers stand in for the provider; a real. |
| `tests/hermes_cli/test_plugin_runtime_disable_gate.py` | runtime plugin disable gating. Covers two residual bypasses addressed in the PR: 1. Plugin API routes mounted at startup remain. |
| `tests/hermes_cli/test_plugin_scan_dunder_dirs.py` | Plugin directory scans must skip dunder dirs and survive OSError. |
| `tests/hermes_cli/test_plugin_scanner_recursion.py` | PR1 pluggable image gen: scanner recursion, kinds, path keys. Covers ``_scan_directory`` recursion into category namespaces. |
| `tests/hermes_cli/test_plugin_secondary_profile_host.py` | PLG-3: a secondary served profile's dashboard plugins run in that profile's own plugin host. On a gateway serving several profiles, dashboard. |
| `tests/hermes_cli/test_plugin_uninstall_windows_live.py` | LIVE Windows E2E: ``hermes plugins uninstall`` while a real gateway has the plugin loaded. A real ``hermes gateway run`` child (temp HOME /. |
| `tests/hermes_cli/test_plugin_update_recovery.py` | Process death cannot leave new plugin code paired with the old dependency. |
| `tests/hermes_cli/test_plugin_update_scan_override.py` | Updating a git-installed plugin scans the new code on every surface, and a caution verdict can be overridden: ``hermes plugins update NAME`` asks. |
| `tests/hermes_cli/test_plugin_update_transaction.py` | Catalog pins and custom Git updates publish only a validated dependency. |
| `tests/hermes_cli/test_plugin_validate.py` | ``hermes plugins validate`` (hermes_cli/plugin_validate.py). Static manifest checks + subprocess-isolated capability probing against a. |
| `tests/hermes_cli/test_plugin_validate_locales.py` | ``hermes plugins validate`` on language packs: bad keys WARN by name, non-text leaves fail, a manifest-only pack is loadable, a declared id with no. |
| `tests/hermes_cli/test_plugin_validate_private_imports.py` | ``hermes plugins validate`` warns (never fails) on imports of private Hermes core. |
| `tests/hermes_cli/test_plugin_version_order.py` | Plugin update consumers share strict version ordering and unknown. |
| `tests/hermes_cli/test_plugin_worker_lifecycle.py` | Command → real PM worker → offline wheels → persisted state → fresh. |
| `tests/hermes_cli/test_plugins.py` | the Hermes plugin system (hermes_cli.plugins). |
| `tests/hermes_cli/test_plugins_admission_setter.py` | Publication failures through the command and real worker, not a fake. |
| `tests/hermes_cli/test_plugins_cadence.py` | Tests: the plugin update-check cadence — clock-gated, receipt-surfaced, apply-explicit. All seams injected. |
| `tests/hermes_cli/test_plugins_check_updates.py` | Tests: check-updates — address resolution, saved-tag security, feeds. All network seams injected (fetch, ls-remote, PyPI probe) — hermetic. The. |
| `tests/hermes_cli/test_plugins_cmd.py` | hermes_cli.plugins_cmd — the ``hermes plugins`` CLI subcommand. |
| `tests/hermes_cli/test_plugins_cmd_activation_keys.py` | Plugin activation writes and reads the SAME key on every surface (#27548, #73131, #82898). Runs the real ``hermes_cli.plugins_cmd`` commands against. |
| `tests/hermes_cli/test_plugins_cmd_catalog.py` | Catalog-aware ``hermes plugins`` surface (hermes_cli/plugins_cmd_catalog.py): a bare catalog name installs the PINNED sha and records provenance. |
| `tests/hermes_cli/test_plugins_cmd_category_discovery.py` | the nested category plugin discovery fix (issue #41066). Verifies that _discover_all_plugins() recurses into category directories (up to 2. |
| `tests/hermes_cli/test_plugins_cmd_enable_disable_nested.py` | Canonical keys and privilege consent through real admission. |
| `tests/hermes_cli/test_plugins_cmd_list.py` | test_filter_plugin_entries_enabled_only, test_cmd_list_plain_compact_output. |
| `tests/hermes_cli/test_plugins_cmd_remove_bookkeeping.py` | ``plugins remove`` (CLI, dashboard, ``plugins.manage`` RPC) leaves no config residue and never follows a symlink (#54336, plugin-scan L2-F1/F2/F5). |
| `tests/hermes_cli/test_plugins_disable_reaches_gateway.py` | ``hermes plugins disable`` must reach the running gateway, or say a restart is needed (LC-3). Under one gateway the daemon holds the plugin manager. |
| `tests/hermes_cli/test_plugins_hub_live_catalog.py` | Live plugin-catalog lookups must not multiply per installed plugin. A slow or unreachable catalog host used to cost one request timeout per plugin. |
| `tests/hermes_cli/test_plugins_hub_perf_guard.py` | test_plugins_hub_does_not_probe_cold_check_fns, test_plugins_hub_cold_cache_schedules_background_probe. |
| `tests/hermes_cli/test_plugins_live_notice.py` | ``live_notice``: what an open chat is told when a plugin goes live in it. The notice stays in the chat's history and rides every later request, so. |
| `tests/hermes_cli/test_plugins_loader.py` | test_nested_plugin_load_runs_inline_on_deadline_worker. |
| `tests/hermes_cli/test_plugins_middleware_chain.py` | Request middleware chaining (#128638): rewrites compose in registration. |
| `tests/hermes_cli/test_plugins_picker_effective_state.py` | The bare ``hermes plugins`` picker writes only the rows the user flipped. Bundled platforms are active without a ``plugins.enabled`` entry; the. |
| `tests/hermes_cli/test_plugins_provenance.py` | Tests: plugin provenance reconciliation — the 2x2. Row-presence says "hermes installed this"; `.git`-presence cross-checks it. The reconciliation IS. |
| `tests/hermes_cli/test_plugins_transcription_registration.py` | PluginContext.register_transcription_provider(). Exercises the plugin context hook end-to-end: drops a fake plugin into. |
| `tests/hermes_cli/test_plugins_tts_registration.py` | PluginContext.register_tts_provider() (issue #30398). Exercises the plugin context hook end-to-end: drops a fake plugin into. |
| `tests/hermes_cli/test_plugins_update_all.py` | `hermes plugins update` with no name: offer every plugin that has an update, never move one. |
| `tests/hermes_cli/test_plugins_update_sync.py` | Every update surface validates staged code before changing an active. |
| `tests/hermes_cli/test_pool_missing_endpoint.py` | Endpoint-less manual credentials resolve through the public runtime. |
| `tests/hermes_cli/test_pooled_served_profile_backend_unscoped.py` | A pooled Desktop backend (``hermes --profile X serve``, HERMES_HOME=<root>/profiles/X) answers its REST without ``?profile=``. Those UNSCOPED. |
| `tests/hermes_cli/test_post_setup_gating.py` | the post_setup install-state gate in `_toolset_needs_configuration_prompt`. Regression coverage for the cua-driver silent-no-op bug (issue. |
| `tests/hermes_cli/test_post_update.py` | post_update step registry: scopes, isolation, and the migrate contract. These assert behavior contracts, not snapshots: the registries' scopes must. |
| `tests/hermes_cli/test_post_update_adoption.py` | step_adopt_blessed_checkout — one-time birth certificate for shipped stampless installs. Blessed root + .git + no stamp → write {updateMechanism. |
| `tests/hermes_cli/test_post_update_expose_cli.py` | expose_cli — the launcher owner repairs PATH conveniences. The installers write ~/.local/bin/hermes* once, at install time. This step rewrites them. |
| `tests/hermes_cli/test_pre_command_hook.py` | the ``pre_command`` observer hook (#64204). The hook fires when a recognized slash command is about to be dispatched, BEFORE the handler. |
| `tests/hermes_cli/test_prefill_config.py` | CLI prefill config key compatibility. |
| `tests/hermes_cli/test_prepend_note_to_message.py` | cli._prepend_note_to_message. Regression coverage for the TypeError raised when a queued /model or /reload-skills note was prepended to a. |
| `tests/hermes_cli/test_pricing_cache_auth_key.py` | ``_pricing_cache`` keys on the credential, not just the base URL. Nous ``/v1/models`` answers each caller with the catalog their org may reach, so. |
| `tests/hermes_cli/test_process_dock.py` | Background processes share the classic CLI live-work dock with subagents (Processes. |
| `tests/hermes_cli/test_process_identity.py` | hermes_cli.process_identity — spawn tags, the machine spawn ledger, and the updater's ledger-identified reap rung. Layer context (Aug. |
| `tests/hermes_cli/test_process_identity_canonical_matchers.py` | Process-identity contract: the two kill/relaunch predicates and the profile liveness probe defer to the canonical matchers instead of argv. |
| `tests/hermes_cli/test_process_notification_display.py` | Background-process completions paint a compact title while the model keeps the raw. |
| `tests/hermes_cli/test_profile_alias_orphan_removal.py` | `hermes profile alias <name> --remove` must clean up an ORPHAN alias (#90983). An orphan alias is a wrapper in ``~/.local/bin`` whose profile no. |
| `tests/hermes_cli/test_profile_cleanup_foreign_unit.py` | `hermes profile delete|rename` never removes another install's gateway service. Service names derive from the profile name and the user unit dir is. |
| `tests/hermes_cli/test_profile_clone_channels.py` | ``hermes profile create --clone`` leaves messaging channels behind (``hermes_cli.profile_channels``). Invariant, not snapshot: the clone's. |
| `tests/hermes_cli/test_profile_credential_collisions.py` | #118388: a platform singleton secret (``TELEGRAM_BOT_TOKEN``) duplicated across local profile homes was invisible to ``hermes. |
| `tests/hermes_cli/test_profile_delete_held_lock.py` | A profile delete (or multiplexed rename) never removes/moves a home whose gateway.lock a live runtime still holds (N60). A multiplexer answers the. |
| `tests/hermes_cli/test_profile_delete_log_handlers.py` | Profile deletion must release the profile-routed log handlers this process holds (#112538). A long-lived multiplex process (the Desktop's ``hermes. |
| `tests/hermes_cli/test_profile_delete_mcp_log.py` | Profile deletion after a real stdio MCP probe must release its log. |
| `tests/hermes_cli/test_profile_delete_read_only_copy.py` | A read-only profile copy (0555 dirs, 0444 files) can still be deleted (N106): the owner check cannot reserve gateway.lock there, so it proves the. |
| `tests/hermes_cli/test_profile_delete_service_name.py` | Deleting a profile from a multiplexed process removes THAT profile's service, never the host's. A multi-profile dashboard/tui-gateway process has. |
| `tests/hermes_cli/test_profile_delete_wrapper.py` | `hermes profile delete` removes the profile's wrapper (#131753). Windows wrappers are ``<alias>.bat``; delete used to look only for the bare name. |
| `tests/hermes_cli/test_profile_describer.py` | the profile.yaml metadata layer (description + description_auto) and the profile_describer LLM. |
| `tests/hermes_cli/test_profile_display_name.py` | Profile display_name (#45624): presentation-only label in profile.yaml. The canonical profile id ("default" for ~/.hermes) is never touched —. |
| `tests/hermes_cli/test_profile_distribution.py` | hermes_cli.profile_distribution — git-based profile installs. Covers manifest parsing, version requirement checks, install / update /. |
| `tests/hermes_cli/test_profile_export_credentials.py` | credential exclusion + secret scrubbing during profile export. Profile exports should NEVER include auth.json or .env — these contain API. |
| `tests/hermes_cli/test_profile_export_default_path.py` | coverage for safe automatic profile-export destinations. |
| `tests/hermes_cli/test_profile_export_special_files.py` | special-file handling during profile export. :func:`shutil.copytree` cannot copy Unix sockets, FIFOs, or device nodes — it collects. |
| `tests/hermes_cli/test_profile_identity_purge_cmd.py` | The `hermes profile purge-identity` retry path: dispatched, and honest about failure. `hermes profile delete` reports a pending identity settlement. |
| `tests/hermes_cli/test_profile_install_env_encoding.py` | Regression: the distribution-install preview must read .env as UTF-8. `_render_distribution_plan` inspects the target profile's `.env` to decide. |
| `tests/hermes_cli/test_profile_listing_cache.py` | ``list_profiles`` re-reads a profile's YAML only when that file has changed. The listing is the shared body of ``GET /api/profiles`` and JSON-RPC. |
| `tests/hermes_cli/test_profile_model_seed.py` | Fresh profiles retain the selected custom endpoint, without copying its. |
| `tests/hermes_cli/test_profile_pm_portability.py` | Portable transfers keep user files, not machine-specific PM state. |
| `tests/hermes_cli/test_profile_rename_checkpoints.py` | Profile rename must preserve profile-local checkpoint history. |
| `tests/hermes_cli/test_profile_rename_service.py` | Renaming a profile removes the gateway service registered under its old name. The launchd/systemd unit and the s6 slot are named after the profile. |
| `tests/hermes_cli/test_profile_service_cleanup_scopes.py` | Deleting or renaming a profile removes its system-scope systemd unit and Windows Scheduled Task, not only the user unit / launchd plist. Both carry. |
| `tests/hermes_cli/test_profiles.py` | Comprehensive tests for hermes_cli.profiles module. Tests cover: validation, directory resolution, CRUD operations, active profile management. |
| `tests/hermes_cli/test_profiles_s6_hooks.py` | the Phase 4 s6 hooks in hermes_cli.profiles. Specifically: _maybe_register_gateway_service, _maybe_unregister_gateway_service. The. |
| `tests/hermes_cli/test_profiles_session_archived_pages.py` | Archived profile pages count archived rows even when live pins. |
| `tests/hermes_cli/test_profiles_sidebar_cache.py` | dashboard sidebar scan coalescing. |
| `tests/hermes_cli/test_profiles_sidebar_failed_load.py` | A failed profile scan must not look like an empty session list. Browsing never repairs the owner's store: a read that fails (lagged schema, busy. |
| `tests/hermes_cli/test_profiles_sidebar_scope.py` | The sidebar's profile scope, across both endpoints that serve it. Two behaviors that only show up with more than one profile on disk: *. |
| `tests/hermes_cli/test_project_plugin_rce_bypass.py` | coverage for GHSA-5qr3-c538-wm9j (#29156) — Remote Code Execution via the ``HERMES_ENABLE_PROJECT_PLUGINS`` bypass in the web server's. |
| `tests/hermes_cli/test_projects_cli.py` | the `hermes project` CLI dispatch (hermes_cli/projects_cmd). |
| `tests/hermes_cli/test_projects_db.py` | the per-profile Projects store (hermes_cli/projects_db). |
| `tests/hermes_cli/test_prompt_api_key.py` | ``_prompt_api_key`` — the shared Keep/Replace/Clear menu used by ``hermes setup`` / ``hermes model`` when an API key already exists in. |
| `tests/hermes_cli/test_prompt_compose_command.py` | the CLI `/prompt` editor-compose command. `/prompt` opens `$VISUAL`/`$EDITOR` on a temp markdown file so the user can hand-edit a. |
| `tests/hermes_cli/test_prompt_size.py` | the ``hermes prompt-size`` diagnostic (issue #34667). |
| `tests/hermes_cli/test_prompt_stash.py` | the Ctrl+S prompt stash state machine (hermes_cli.prompt_stash). Covers the pure state machine directly — no prompt_toolkit, no TUI: -. |
| `tests/hermes_cli/test_prompt_stash_cli.py` | the Ctrl+S prompt stash wiring inside HermesCLI. The state machine itself is covered by tests/hermes_cli/test_prompt_stash.py. These tests. |
| `tests/hermes_cli/test_prompt_text_input_thread_safety.py` | ``HermesCLI._prompt_text_input`` thread-safe input dispatch. Raw ``input()`` prompts can race with prompt_toolkit when called from the. |
| `tests/hermes_cli/test_prompt_turn_ack_order.py` | /plan, /learn, /init acknowledge on the same paint channel as the turn they queue. Main prints the acknowledgement, then the queued turn paints its. |
| `tests/hermes_cli/test_provider_auth_seam.py` | OAuth-shaped model-provider plugins are first-class in `hermes auth` (#116408). The seam: ``ProviderProfile.auth_handler``. These tests drive the. |
| `tests/hermes_cli/test_provider_catalog.py` | the unified provider catalog (hermes_cli.provider_catalog). These are invariant tests, not snapshots: they assert the parity *contract*. |
| `tests/hermes_cli/test_provider_config_validation.py` | providers config entry validation and normalization. Covers Issue #9332: camelCase keys silently ignored, non-URL strings accepted as. |
| `tests/hermes_cli/test_provider_groups.py` | provider-group folding (display-only picker grouping). These are invariant tests, not catalog snapshots: they assert how. |
| `tests/hermes_cli/test_provider_live_curated_merge.py` | live+curated merge in the generic profile-based provider path. Guards two contracts: * #46850 — when a provider's live /v1/models endpoint. |
| `tests/hermes_cli/test_provider_parity.py` | End-to-end provider parity contract: the desktop Providers tabs must show the SAME provider universe as ``hermes model`` (the CLI/TUI picker). This. |
| `tests/hermes_cli/test_provider_precedence.py` | #29285 — provider precedence in resolve_provider("auto"). Explicit user intent (config.yaml model.provider, env-var API keys). |
| `tests/hermes_cli/test_provider_profile_identity.py` | Plugin ProviderProfiles resolve wherever a provider NAME is resolved at switch time (#69576). Discovery is real (a plugin dir under the test. |
| `tests/hermes_cli/test_provider_registry_override.py` | A `$HERMES_HOME` provider plugin re-registering a bundled name reaches the runtime (#48450). ``register_provider()`` is last-writer-wins for the. |
| `tests/hermes_cli/test_provider_section3_grouping.py` | section-3 (``providers:``) same-endpoint grouping in ``list_authenticated_providers`` and for ``format_model_for_display``. |
| `tests/hermes_cli/test_proxy.py` | the `hermes proxy` subcommand and its upstream adapters. |
| `tests/hermes_cli/test_proxy_off_loop.py` | `hermes proxy` must resolve upstream credentials off the event loop. ``UpstreamAdapter`` is a synchronous contract (``adapters/base.py`` — every. |
| `tests/hermes_cli/test_prune_spares_pinned.py` | tests: pinned sessions survive bulk prune/archive (round-3 SES-01). Pinning is a durable "keep" flag. Before this fix. |
| `tests/hermes_cli/test_pty_bridge.py` | hermes_cli.pty_bridge — PTY spawning + byte forwarding. These tests drive the bridge with minimal POSIX processes (echo, env, sleep. |
| `tests/hermes_cli/test_pty_keepalive_ws.py` | test_attach_token_reuses_same_session, test_stalled_input_closes_only_the_keepalive_socket. |
| `tests/hermes_cli/test_pty_session.py` | test_ringbuffer_keeps_everything_under_capacity, test_ringbuffer_drops_oldest_over_capacity. |
| `tests/hermes_cli/test_quarantine_forensic_logging.py` | Redaction-safe forensic logging at the Nous OAuth quarantine path. A NAS-hosted Fly agent's Nous bootstrap session can take a terminal. |
| `tests/hermes_cli/test_quarantine_orphan_rescue.py` | tests: a failed quarantine restore must never strand `hermes`. On Windows the updater renames the live ``hermes*.exe`` shims aside. |
| `tests/hermes_cli/test_quick_commands.py` | user-defined quick commands that bypass the agent loop. |
| `tests/hermes_cli/test_quiet_turn_author.py` | ``hermes chat -Q`` passes the dispatcher's HERMES_TURN_AUTHOR to ``run_conversation`` as ``turn_author``. A bot-to-bot delivery runs the recipient's. |
| `tests/hermes_cli/test_read_raw_config_readonly.py` | read_raw_config_readonly() — the no-deepcopy raw config read. The readonly variant exists for per-turn policy checks (e.g. the. |
| `tests/hermes_cli/test_readers_concurrent_owner.py` | Real CLI readers stay usable while the canonical store has a writer. |
| `tests/hermes_cli/test_real_home_tripwire.py` | Real-home guards are exercised against disposable protected roots. |
| `tests/hermes_cli/test_reasoning_caps_disk_cache.py` | The reasoning-capability disk mirror. Every consumer of these capabilities sits on a per-request hot path that must never block on HTTP, so a. |
| `tests/hermes_cli/test_reasoning_command.py` | the combined /reasoning command. Covers both reasoning effort level management and reasoning display toggle, plus the reasoning extraction. |
| `tests/hermes_cli/test_reasoning_effort_menu.py` | test_reasoning_menu_orders_minimal_before_low, test_current_reasoning_effort_reads_dict_form. |
| `tests/hermes_cli/test_reasoning_full_command.py` | the CLI `/reasoning full` / `/reasoning clamp` recap toggle. The post-response "Reasoning" recap box clamps long thinking to the first 10. |
| `tests/hermes_cli/test_redact_config_bridge.py` | test for config.yaml `security.redact_secrets: false` toggle. Bug: `agent/redact.py` snapshots `_REDACT_ENABLED` from the env var. |
| `tests/hermes_cli/test_refresh_singleflight.py` | Native HTTP replay boundaries and deterministic provider-level. |
| `tests/hermes_cli/test_regression.py` | coverage for issue #16767. |
| `tests/hermes_cli/test_relaunch.py` | hermes_cli.relaunch — unified self-relaunch utility. |
| `tests/hermes_cli/test_relaunch_verify_budget_starts_at_respawn.py` | The relaunch liveness budget has to start when the replacement process appears. Regression for the Desktop dialog *"The update finished, but needs. |
| `tests/hermes_cli/test_relay_plugin_cutover.py` | migration from the removed Hermes Relay plugin. |
| `tests/hermes_cli/test_relay_plugin_migrate.py` | ``hermes update`` / ``hermes migrate relay``: legacy ``HERMES_NEMO_RELAY_ATIF_*``/``ATOF_*`` vars become a validated ``relay-plugins.toml`` per. |
| `tests/hermes_cli/test_relay_shared_metrics.py` | Focused tests for the Hermes shared-metrics durable store. |
| `tests/hermes_cli/test_relay_shared_metrics_runtime.py` | the direct Hermes-to-Relay shared-metrics runtime. |
| `tests/hermes_cli/test_release_channels.py` | Public channel resolution is strict, pinned, and independent of name. |
| `tests/hermes_cli/test_remote_spending_gate_contract.py` | the Remote-Spending gate denial contract (NAS PR #481). Behavior contracts: the HTTP→exception mapping in. |
| `tests/hermes_cli/test_resolve_ephemeral_system_prompt.py` | resolve_ephemeral_system_prompt_from_config. |
| `tests/hermes_cli/test_resolve_last_session.py` | Verify `hermes -c` picks the session the user most recently used. |
| `tests/hermes_cli/test_resolve_provider_corrupt_config.py` | issue #81952 (silent OpenRouter paid-default class fix). When ``~/.hermes/config.yaml`` EXISTS but fails to parse. |
| `tests/hermes_cli/test_resolve_provider_custom_endpoint.py` | A configured custom (OpenAI-compatible) endpoint is explicit provider intent. Regression for #108383: ``resolve_provider("auto")`` recognised only. |
| `tests/hermes_cli/test_resolve_provider_openrouter_pool.py` | issue #42130. A credential added via `hermes auth add openrouter` lives in the credential pool, NOT as an OPENROUTER_API_KEY. |
| `tests/hermes_cli/test_resolve_token_memo.py` | the resolve_nous_access_token startup-burst memo (PR #66016). The memo collapses the startup burst of managed-tool check_fn calls into a. |
| `tests/hermes_cli/test_resolve_turn_limit.py` | :func:`hermes_cli.config.resolve_turn_limit` and the ``TURN_LIMIT_UNLIMITED`` sentinel. Covers the full spelling table (int, float. |
| `tests/hermes_cli/test_resource_limits.py` | configurable RLIMIT_NOFILE startup handling. |
| `tests/hermes_cli/test_restart_plan_reconciliation.py` | Plan-vs-execution reconciliation (#91277 Phase 2: restart via declared mechanism). Pins: - match_runtime_outcomes classifies every planned runtime. |
| `tests/hermes_cli/test_restore_own_holder_guard.py` | tests: restore paths must fail closed under an IN-PROCESS live connection to the destination database (#90837 / #90950 own-holder gap). |
| `tests/hermes_cli/test_restore_source_integrity.py` | Restore must read the literal source path and validate it before mutating a live. |
| `tests/hermes_cli/test_resume_alias_model.py` | Repeating the creation `-m <alias>` on resume is the same frozen route, not an. |
| `tests/hermes_cli/test_resume_alias_remote_config.py` | A repeated `-m alias` on resume is judged by the owner's creation provenance, not the client's own alias map (andrexibiza C19): the owner maps. |
| `tests/hermes_cli/test_resume_compressed_gateway_id.py` | Classic CLI ``--resume <root>`` of a twice-compressed local conversation addresses the gateway by the id it owns a receipt for (live-pass finding. |
| `tests/hermes_cli/test_resume_display.py` | session resume history display — _display_resumed_history() and _preload_resumed_session(). Verifies that resuming a session shows a. |
| `tests/hermes_cli/test_resume_latest_and_in_dir.py` | `--resume latest` and `--in DIR` launch sugar. `hermes --tui --resume latest --in ./dir` (and the classic-CLI equivalents) resolve. |
| `tests/hermes_cli/test_resume_model_restore.py` | CLI resume model restoration and /model session persistence. Covers _restore_session_model, _persist_model_switch_to_session (cli.py) and. |
| `tests/hermes_cli/test_resume_quiet_stderr.py` | /resume status lines going to stderr in quiet mode (#11793). The fix in cli._init_agent routes three messages to stderr when. |
| `tests/hermes_cli/test_retirement_atomicity.py` | Freeze admission before consulting ledgers, without holding a lock across their. |
| `tests/hermes_cli/test_review_update_runtime.py` | Source update safety at the bootstrap and completion boundaries. |
| `tests/hermes_cli/test_router_provider.py` | Behavior contracts for the Ramp Router (api.router.com) provider. Router is Responses-native: the host implements GET /v1/models and POST. |
| `tests/hermes_cli/test_runtime_install_progress.py` | PM download bytes and install phases remain separate, faithful UI. |
| `tests/hermes_cli/test_runtime_machine_scope.py` | The managed runtime is machine-scoped, not profile-scoped. Engine binaries, models, presets, and server state are machine assets: a second profile. |
| `tests/hermes_cli/test_runtime_maintenance_exclusion.py` | Maintenance must not replace the database behind a live authority. |
| `tests/hermes_cli/test_runtime_paths.py` | Payload stores follow the payload, not the launching shell's home. |
| `tests/hermes_cli/test_runtime_provider_late_binding.py` | Regression: runtime_provider's config helpers must be late-bound. Test-pollution class found Aug 2026: ``hermes_cli.runtime_provider`` is frequently. |
| `tests/hermes_cli/test_runtime_provider_openai_runtime.py` | Runtime provider resolution: model.openai_runtime overlay, the ``openai`` alias, and launch. |
| `tests/hermes_cli/test_runtime_provider_resolution.py` | test_configured_api_key_provider_without_key_fails_closed, test_noauth_lmstudio_still_resolves. |
| `tests/hermes_cli/test_runtime_transport_precedence.py` | Runtime transport precedence: declared provider transport is the fallback. The Coatue data-residency report (2026-07): pointing ``openai-api`` at. |
| `tests/hermes_cli/test_safe_mode.py` | `hermes chat --safe-mode` is an owner-frozen policy executed out of process, not client env. Contract recipe D-F: sentinels seeded in a disposable. |
| `tests/hermes_cli/test_sale_pricing.py` | Sale UI pricing helpers: gateway pricing.original → discount chrome. |
| `tests/hermes_cli/test_sandbox_image_switch.py` | The default sandbox image change is a decision, not a surprise. Two contracts, exercised through the real config loader, both env bridges and the. |
| `tests/hermes_cli/test_save_conversation_location.py` | /save — the conversation snapshot slash command. Regression: the old implementation wrote ``hermes_conversation_<ts>.json`` to the current. |
| `tests/hermes_cli/test_save_transcript_history.py` | /save md (CLI and gateway) carries the display history; /save json (CLI, gateway, TUI/Desktop) every kept. |
| `tests/hermes_cli/test_scan_venv_blockers.py` | The retired scanner's historical import and desktop CLI contracts. |
| `tests/hermes_cli/test_scroll_list_panel_row_layout.py` | Invariants for ``CLITuiMixin._render_scroll_list_panel`` (the ``/model`` picker's model stage and the command palette) with labels long enough to. |
| `tests/hermes_cli/test_secret_prompt.py` | test_collect_masked_input_shows_feedback_without_echoing_secret, test_collect_masked_input_raises_keyboard_interrupt. |
| `tests/hermes_cli/test_secret_source_bootstrap.py` | plugin secret-source first-process re-pull (#64177). |
| `tests/hermes_cli/test_secrets_bitwarden_non_tty.py` | hermes secrets bitwarden setup non-TTY guard. Issue #40274: cmd_setup() crashes with EOFError when stdin is not a TTY because. |
| `tests/hermes_cli/test_secrets_token_rotation.py` | `hermes secrets bitwarden token` / `hermes secrets onepassword token`. The rotation command must: verify the candidate token BEFORE. |
| `tests/hermes_cli/test_security_advisories.py` | hermes_cli.security_advisories. The advisory module is the user-facing detection / remediation surface for supply-chain attacks (e.g. the. |
| `tests/hermes_cli/test_security_audit.py` | hermes_cli.security_audit — parsers + OSV plumbing. These never hit the live OSV API; HTTP is monkeypatched. The live-call path is. |
| `tests/hermes_cli/test_security_audit_startup.py` | the startup security posture audit (hermes_cli.security_audit_startup). |
| `tests/hermes_cli/test_seeded_interactive_query.py` | Seeded interactive ``-q`` behavior (Aug 2026). On a real TTY, ``hermes chat -q "…"`` seeds a normal interactive session with the prompt submitted. |
| `tests/hermes_cli/test_send_cmd.py` | the ``hermes send`` CLI subcommand. Covers the argument parsing / stdin / file / list behavior of ``hermes_cli.send_cmd``. The underlying. |
| `tests/hermes_cli/test_serve_command.py` | Contract for the headless ``hermes serve`` backend command. ``serve`` is what the desktop app and remote backends launch — the same gateway as. |
| `tests/hermes_cli/test_serve_host_attach.py` | A second `hermes serve` attaches to the host backend instead of binding a second port. Attach is a PROOF, not a guess: exit 0 means the recorded. |
| `tests/hermes_cli/test_serve_mcp_discovery_after_bind.py` | Desktop `serve` starts background MCP discovery only after the socket binds; a standalone `hermes dashboard` arms it at boot and the first /api/ws. |
| `tests/hermes_cli/test_serve_parent_watchdog.py` | Desktop-owned ``hermes serve`` lifecycle tracking. |
| `tests/hermes_cli/test_serve_parent_watchdog_live_macos.py` | #95693 / #93958 — live macOS proof for the parent-death watchdog. The unit tests in ``test_serve_parent_watchdog.py`` pin ``_is_serve_orphaned`` as. |
| `tests/hermes_cli/test_serve_port_in_use.py` | #93608 — port bind conflict must be machine-readable, not a bare exit 1. The reporter's repro: something already listens on the serve port (another. |
| `tests/hermes_cli/test_serve_runtime_inventory.py` | Serve-kind runtime inventory (#63206, campaign #91277). A network-bound `hermes serve --host <ip>` powering a remote Desktop used to be invisible to. |
| `tests/hermes_cli/test_serve_skill_maintenance.py` | Exercise the real periodic maintenance loop with isolated on-disk. |
| `tests/hermes_cli/test_serve_windows_loop_factory.py` | Windows serve must run uvicorn on a SelectorEventLoop. Regression for #120164. uvicorn 0.41's ``asyncio_loop_factory`` returns ProactorEventLoop on. |
| `tests/hermes_cli/test_served_profile_mirror_platforms.py` | A served secondary's api_server/webhook are MIRRORS of the default's listener (``/p/<profile>/...``), never adapters of their own, so the. |
| `tests/hermes_cli/test_service_manager.py` | hermes_cli.service_manager — the abstract ServiceManager protocol, the detect_service_manager() entry point, and the host-side adapter. |
| `tests/hermes_cli/test_session_boundary_hooks.py` | test_session_finalize_on_reset, test_session_finalize_on_cleanup. |
| `tests/hermes_cli/test_session_browse.py` | the interactive session browser (`hermes sessions browse`). Covers: - _session_browse_picker logic (curses mocked, fallback tested) -. |
| `tests/hermes_cli/test_session_detail_malformed_db.py` | A corrupt state.db must not be reported as a missing session. Regression for the 2026-08-31 incident: ``state.db`` corruption (rowid out of order in. |
| `tests/hermes_cli/test_session_dock.py` | Active /goal and queued /queue prompts share the classic CLI live-work. |
| `tests/hermes_cli/test_session_end_messages.py` | Plugin ``on_session_finalize`` return values reach the user out-of-band on every surface. A hook returns ``str`` or ``{"message": str}``; the CLI. |
| `tests/hermes_cli/test_session_export.py` | test_html_export_escapes_tool_call_names, test_export_record_count_switches_unit_for_prompt_only_exports. |
| `tests/hermes_cli/test_session_export_batch.py` | test_export_all_batches_message_reads_without_changing_export_rows. |
| `tests/hermes_cli/test_session_export_html.py` | the HTML session export renderer. |
| `tests/hermes_cli/test_session_export_html_escape.py` | test_role_is_escaped_in_html_export. |
| `tests/hermes_cli/test_session_export_md.py` | test_safe_session_filename_is_deterministic_and_path_safe, test_verify_export_file_checks_count_and_sha. |
| `tests/hermes_cli/test_session_filters.py` | hermes_cli.session_filters — CLI time/filter parsing for `hermes sessions prune` / `hermes sessions. |
| `tests/hermes_cli/test_session_handoff.py` | session handoff (CLI to gateway platform). The handoff state machine lives on the ``sessions`` table: None → "pending" → "running" →. |
| `tests/hermes_cli/test_session_list_reader_disposable.py` | Read-only session-list opens must stay disposable. Two properties that a "keep the read-only handle for the process lifetime" optimisation silently. |
| `tests/hermes_cli/test_session_listing.py` | the shared session-listing helpers (hermes_cli/session_listing.py). |
| `tests/hermes_cli/test_session_maintenance_http.py` | Legacy bulk maintenance must exclude the real gateway owner reservation. |
| `tests/hermes_cli/test_session_message_page_owner.py` | test_message_pages_identify_the_serving_profile, test_message_pages_type_untyped_failed_turn_rows. |
| `tests/hermes_cli/test_session_messages_inline_images.py` | ``GET /api/sessions/{id}/messages`` honors ``inline_images=false`` (#116511). The REST pages carry ``content`` verbatim (a parts list with inline. |
| `tests/hermes_cli/test_session_mutation_http.py` | Real HTTP and WS clients share the owner revision and retry receipt. |
| `tests/hermes_cli/test_session_mutation_legacy_client.py` | A pre-fence client (Desktop 0.22.2) gets a named upgrade refusal it can render (#139742). 0.22.2's session PATCH/DELETE carry no. |
| `tests/hermes_cli/test_session_mutation_models.py` | Mutation identities and boolean intent must survive HTTP parsing. |
| `tests/hermes_cli/test_session_mutation_snapshot.py` | HTTP mutation preparation reads the owner's exact persisted counters. |
| `tests/hermes_cli/test_session_mutation_standalone.py` | Standalone ``hermes serve``/``dashboard`` (no gateway authority) keeps session edits. The edit runs the gateway's receipt transaction on the. |
| `tests/hermes_cli/test_session_owner_backfill.py` | Legacy NULL-profile session owner backfill (#94724). Pre-#95407 session rows carry ``profile_name = NULL``. Once a Desktop has registry topology (≥2. |
| `tests/hermes_cli/test_session_recap.py` | hermes_cli.session_recap. |
| `tests/hermes_cli/test_session_recovery.py` | test_snapshot_blocks_connections_opened_during_the_copy, test_partial_recovery_keeps_messages_when_sessions_are_unsalvageable. |
| `tests/hermes_cli/test_session_recovery_lost_and_found.py` | recovery-tooling gaps: issue #80205 (range-query budget can omit a recoverable tail row) and the lost_and_found last-resort lane for. |
| `tests/hermes_cli/test_session_recovery_model_config.py` | Invariant: session recovery neutralises unparseable ``sessions.model_config``. ``integrity_check`` never looks at column contents, so a source whose. |
| `tests/hermes_cli/test_session_recovery_timestamps.py` | Invariant: session recovery never ships an out-of-window timestamp cell (#91536). A damaged page can decode as a valid-looking garbage double. |
| `tests/hermes_cli/test_session_save.py` | the /save current-session export helpers. |
| `tests/hermes_cli/test_session_schema_history.py` | ``hermes_cli.session_schema_history`` must track SCHEMA_SQL. The page-level salvage lane infers a salvaged store's physical column order from this. |
| `tests/hermes_cli/test_session_search_context_batch.py` | Batched context preserves neighboring rows and projection fast. |
| `tests/hermes_cli/test_session_skill_previews.py` | Session previews must never surface a /skill's own body. `preview` is the head of the first user message, and it is the TITLE FALLBACK on every. |
| `tests/hermes_cli/test_session_switch_mid_turn_guard.py` | /branch, /resume and /sessions <id> refuse to switch sessions while a turn is in flight. The classic CLI shares ONE agent object across sessions: a. |
| `tests/hermes_cli/test_session_system_prompt_dedup.py` | Behavior coverage for content-addressed session system prompts. |
| `tests/hermes_cli/test_session_timeline.py` | Real read-only timeline requests against temporary profile stores. |
| `tests/hermes_cli/test_session_vacuum_config.py` | test_explicit_auto_prune_false_is_respected, test_negative_retention_days_in_config_deletes_nothing. |
| `tests/hermes_cli/test_sessions_delete.py` | test_sessions_delete_accepts_unique_id_prefix, test_sessions_delete_with_unfinished_turn_points_to_discard. |
| `tests/hermes_cli/test_sessions_discard.py` | `hermes sessions discard`: a script can clear a turn lost in a gateway crash without a. |
| `tests/hermes_cli/test_sessions_error_exit_codes.py` | tests: `hermes sessions` error paths return non-zero (SES-04). Before this, delete/rename not-found, prune bad-arg, blank rename, and. |
| `tests/hermes_cli/test_sessions_export_backup_round_trip.py` | `hermes sessions export` JSONL — the documented backup format — must round-trip a compacted session: import restores the turns in-place compaction. |
| `tests/hermes_cli/test_sessions_export_md_cli.py` | test_sessions_export_md_writes_single_session, test_sessions_export_verified_delete_keeps_file. |
| `tests/hermes_cli/test_sessions_export_output_dir.py` | `hermes sessions export` single-file formats accept a directory as. |
| `tests/hermes_cli/test_sessions_export_retention.py` | #131075: a retention backup must cover the rows prune can delete. |
| `tests/hermes_cli/test_sessions_held_store_gate.py` | `hermes sessions optimize|optimize-storage|prune` refuse while another process holds state.db (#110054). Running the storage rewrite underneath a. |
| `tests/hermes_cli/test_sessions_list_truncation.py` | ``hermes sessions list`` tells the user when ``--limit`` cut the listing (#111989). The cap is applied inside the SQL query, so the lister probes. |
| `tests/hermes_cli/test_sessions_observation.py` | Session listings must not initialize or migrate canonical storage. |
| `tests/hermes_cli/test_sessions_prune_via_owner.py` | `hermes sessions prune` while the always-on gateway owns state.db (live smoke LS-F7). The gateway is always up, so a CLI prune that refuses whenever. |
| `tests/hermes_cli/test_sessions_repair_check_only_exit.py` | `hermes sessions repair --check-only` must fail (non-zero) when the store is unhealthy. Automation gates on the exit status; printing the reason and. |
| `tests/hermes_cli/test_sessions_repair_declarative.py` | Explicit repair must restore browsing after additive schema drift. |
| `tests/hermes_cli/test_sessions_repair_profiles.py` | ``hermes sessions repair-profiles``: the backward-looking half of the per-profile store model. The forward-only fixes (#88734 store routing, the. |
| `tests/hermes_cli/test_sessions_repair_prompts.py` | Behavior contracts for hermes sessions repair-prompts (#122822). |
| `tests/hermes_cli/test_sessions_rest_scaffold_notices.py` | REST session transcripts must not ship untyped gateway scaffold notices as user rows. A ``[System: …]`` ``role=user`` row persisted without a. |
| `tests/hermes_cli/test_sessions_set_journal_mode.py` | `hermes sessions set-journal-mode` converts an existing WAL store offline and refuses under a foreign holder. #100896 (@ruangraung). |
| `tests/hermes_cli/test_sessions_size_delta_label.py` | the session-store size-delta label (`hermes sessions optimize*`). A negative before/after delta means the DB grew — printing "reclaimed. |
| `tests/hermes_cli/test_sessions_source_local.py` | ``hermes sessions list|browse|stats --source cli`` must see gateway rows stored as. |
| `tests/hermes_cli/test_set_config_value.py` | set_config_value — verifying secrets route to .env and config to. |
| `tests/hermes_cli/test_settings_only_provider_block_validation.py` | #120020: a settings-only ``providers.<slug>`` block must not reroute model validation into the custom-endpoint branch. Repro. |
| `tests/hermes_cli/test_setup.py` | setup.py configuration flows. |
| `tests/hermes_cli/test_setup_agent_settings.py` | agent-settings copy in the interactive setup wizard. |
| `tests/hermes_cli/test_setup_blank_slate.py` | Blank Slate setup mode (hermes_cli/setup.py). Blank Slate is the third first-time setup option: everything off except the bare minimum. |
| `tests/hermes_cli/test_setup_hermes_script.py` | test_setup_hermes_script_is_valid_shell. |
| `tests/hermes_cli/test_setup_hidden_env.py` | Setup surfaces ask only for what a platform can't start without. The knobs in SETUP_HIDDEN_ENV_SUFFIXES are self-configuring (/sethome) or already. |
| `tests/hermes_cli/test_setup_irc.py` | IRC gateway configuration via `hermes setup gateway` UI. Covers the full plugin-platform discovery → status → configure flow so that a. |
| `tests/hermes_cli/test_setup_model_provider.py` | interactive setup provider/model persistence. Since setup_model_provider delegates to select_provider_and_model() from. |
| `tests/hermes_cli/test_setup_noninteractive.py` | non-interactive setup and first-run headless behavior. |
| `tests/hermes_cli/test_setup_openclaw_migration.py` | OpenClaw migration integration in the setup wizard. |
| `tests/hermes_cli/test_setup_pin_values.py` | Cold setup consumes lock values before executing any downloaded. |
| `tests/hermes_cli/test_setup_prompt_menus.py` | test_prompt_choice_escape_keeps_default_without_numbered_fallback, test_setup_navigation_escape_cancels_and_left_goes_back. |
| `tests/hermes_cli/test_setup_provider_catalog.py` | First-time setup must consume the registered provider catalog. |
| `tests/hermes_cli/test_setup_reconfigure.py` | the setup wizard's returning-user behavior. On an existing install: - Bare `hermes setup` drops straight into the full reconfigure wizard. |
| `tests/hermes_cli/test_setup_reset_backup.py` | Ordering guarantees for the setup wizard's config.yaml backup (#3522). The wizard copies ``config.yaml`` into ``backups/config/`` so a user can. |
| `tests/hermes_cli/test_setup_summary_provider_warning.py` | Setup summary must warn loudly when no provider got configured. Regression test for the "wizard silently succeeds with no model" dead end. |
| `tests/hermes_cli/test_setup_telemetry.py` | shared-metrics configuration discovery and setup. |
| `tests/hermes_cli/test_setup_terminal.py` | hermes_cli/setup_terminal.py backend wizards. |
| `tests/hermes_cli/test_setup_tts_xai_oauth.py` | Regression: TTS/setup xAI OAuth must not hijack the active chat. |
| `tests/hermes_cli/test_shallow_boundary_repair.py` | Repair of shallow boundaries dropped by the stale-graft prune (#108286). ``prune_stale_shallow_grafts()`` dropped ``.git/shallow`` grafts that. |
| `tests/hermes_cli/test_shallow_graft_prune.py` | Stale shallow-graft pruning after depth-1 update checks (#105951). Every ``git fetch --depth 1`` appends the fetched tip to ``.git/shallow`` as a. |
| `tests/hermes_cli/test_shared_metrics_compression_outcome.py` | ``hermes.compression.count`` keeps a committed fallback's class instead of reading as a clean success. A committed fallback is either a. |
| `tests/hermes_cli/test_shared_metrics_connectors.py` | Connector work in the shared metrics: per-entry tool counting, gateway error classes, the search-to-execute chain, and the tool_search / tool_batch. |
| `tests/hermes_cli/test_shared_metrics_consent_windows.py` | Property tests for the consent-interval model. Ported from the /tmp validation harness that gated the redesign: every scenario here is a defect that. |
| `tests/hermes_cli/test_shared_metrics_desktop.py` | v5 desktop: hermes.desktop.{feature_use,friction,onboarding,dislike,mode_use,action_use}. Every value the Desktop sends collapses onto a closed. |
| `tests/hermes_cli/test_shared_metrics_efficiency.py` | v5 efficiency metrics: per-turn cost, wasted tokens, tool output truncation, tool overhead and prompt-cache. |
| `tests/hermes_cli/test_shared_metrics_engagement.py` | Engagement invariants: the daily rollup reports each closed day once per profile, a compressed conversation is one session row with its whole. |
| `tests/hermes_cli/test_shared_metrics_gateway.py` | Invariants for gateway / cron shared metrics: bounded platform names with proven catalog provenance, opt-in gating, and contract-valid. |
| `tests/hermes_cli/test_shared_metrics_harness.py` | Agent-harness accuracy shared metrics: file edits, loop guards, tool-error recovery, terminal command outcomes and model reply. |
| `tests/hermes_cli/test_shared_metrics_install_failures.py` | Why installs and updates fail: failure_class on hermes.extension.install.count and hermes.update.run, registry on hub skill installs (closed sets. |
| `tests/hermes_cli/test_shared_metrics_install_run.py` | hermes.install.run: the installers' local receipt, counted by a later start only while collection is. |
| `tests/hermes_cli/test_shared_metrics_install_v4.py` | Startup latency and the install snapshot's version-lag, channel and hardware. |
| `tests/hermes_cli/test_shared_metrics_loop.py` | Learning-loop, delegation and execution-backend shared metrics, read back from the real. |
| `tests/hermes_cli/test_shared_metrics_model.py` | Per-model tool-call quality, friction and context-peak shared. |
| `tests/hermes_cli/test_shared_metrics_model_attribution.py` | Provider/model attribution invariants for the per-model shared metrics: which route a row names, that user-named models never leave the machine. |
| `tests/hermes_cli/test_shared_metrics_reliability.py` | v4 reliability metrics: hermes.update.run / hermes.update.stage from the final update receipt, hermes.process.exit from per-process markers and turn. |
| `tests/hermes_cli/test_shared_metrics_send_config.py` | shared-metrics send configuration resolution. |
| `tests/hermes_cli/test_shared_metrics_send_migration.py` | the additive send-state migration on ``package_outbox``. The store schema version must NOT move when these columns are added: the existing. |
| `tests/hermes_cli/test_shared_metrics_send_wiring.py` | wiring the sender into the shared-metrics export hook. The properties that matter here are negative ones: the interactive path must not. |
| `tests/hermes_cli/test_shared_metrics_sender.py` | the shared-metrics sender. Covers the four contract responses, the period-based consent gate, frozen identity across rotation. |
| `tests/hermes_cli/test_shared_metrics_sender_e2e.py` | End-to-end test: the real sender against a real HTTP server. Everything else stubs the transport. This exercises the actual code path — urllib. |
| `tests/hermes_cli/test_shared_metrics_surface_attribution.py` | Every AIAgent construction path must attribute its execution surface. The shared-metrics contract normalises a missing or unrecognised ``platform``. |
| `tests/hermes_cli/test_shared_metrics_tools_toggle.py` | the `hermes tools` shared-metrics consent toggle. AGENTS.md requires outbound telemetry to be reachable from a config gate, the setup. |
| `tests/hermes_cli/test_shared_metrics_update_stop_reasons.py` | Every `hermes update` exit before the apply step names its closed reason (hermes.update.run ``failure_class``), in-process and through the parked. |
| `tests/hermes_cli/test_shared_profile_warning.py` | Live subprocesses, real ledger I/O, and isolated profile homes. |
| `tests/hermes_cli/test_shared_session_attach.py` | Local owner discovery must fence profile and lease identity. |
| `tests/hermes_cli/test_show_config_credential.py` | test: /config must show the LIVE agent credential. HermesCLI.__init__ seeds ``self.api_key`` from OPENAI_API_KEY / OPENROUTER_API_KEY env. |
| `tests/hermes_cli/test_show_model_picker_exhausted_pool.py` | test for #103829: the interactive CLI's main ``/model`` picker (``/model`` with no args) must request exhausted-pool visibility. |
| `tests/hermes_cli/test_sibling_config_migration.py` | Fleet-wide config migration (#91277 Phase 2 — #20438/#54926/#79048 class). `hermes update` migrated only the active profile's config.yaml; sibling. |
| `tests/hermes_cli/test_signal_handler_kanban_worker.py` | test for #28181 — kanban worker SIGTERM must terminate the process. The single-query signal handler in cli.py (``_signal_handler_q``). |
| `tests/hermes_cli/test_single_query_clarify.py` | the single-query clarify guard (#94943). ``hermes chat -q`` wires the interactive prompt_toolkit clarify callback. |
| `tests/hermes_cli/test_single_query_exit_contract.py` | One-shot ``chat -q`` runs report their outcome in the exit code, like ``-Q`` always did. The non-quiet one-shot path used to fall through to an. |
| `tests/hermes_cli/test_single_query_plugin_cli_ref.py` | ``hermes chat -q``/``-Q`` runs leave this process's plugin manager alone. On main they set ``PluginManager._cli_ref`` so a plugin tool dispatched. |
| `tests/hermes_cli/test_single_query_session_finalize.py` | test_finalize_single_query_releases_lease_before_cleanup, test_finalize_single_query_runs_cleanup_when_finalize_hook_fails. |
| `tests/hermes_cli/test_sizefmt.py` | the shared byte formatter (hermes_cli.sizefmt). Consolidates six near-identical formatters (backup, checkpoints, doctor, update_cmd. |
| `tests/hermes_cli/test_skill_collision_visibility.py` | A skill named like a built-in command is kept out of auto-registration (the 370ebf2d3 guard) and every listing surface says so where the user looks. |
| `tests/hermes_cli/test_skills_config.py` | hermes_cli/skills_config.py and skills_tool disabled filtering. |
| `tests/hermes_cli/test_skills_failure_exit_code.py` | A failed ``hermes skills install|update|uninstall|snapshot import`` exits non-zero (#118301). The Desktop spawns these as detached actions and. |
| `tests/hermes_cli/test_skills_hub.py` | test_do_list_platform_env_is_ignored, test_check_for_skill_updates_does_not_fall_back_across_registries. |
| `tests/hermes_cli/test_skills_install_flags.py` | --yes / --force flag separation in `hermes skills install`. --yes / -y → skip_confirm (bypass interactive prompt, needed in TUI mode). |
| `tests/hermes_cli/test_skills_provider_filter.py` | Provider filters must run before a source's result limit can discard. |
| `tests/hermes_cli/test_skills_skip_confirm.py` | skip_confirm and invalidate_cache behavior in /skills install and /skills uninstall slash commands. Slash commands always skip. |
| `tests/hermes_cli/test_skills_uninstall_flags.py` | --yes / -y flag in `hermes skills uninstall` CLI subcommand. Verifies the parser registers the flag and the value reaches. |
| `tests/hermes_cli/test_skin_cmd.py` | `hermes skin set` — deterministic single-color tweak of the active skin. The whole point is that changing one token never disturbs the rest of the. |
| `tests/hermes_cli/test_skin_engine.py` | hermes_cli.skin_engine — the data-driven skin/theme system. |
| `tests/hermes_cli/test_skin_palettes.py` | Built-in skin palette audit: completeness + WCAG contrast, per polarity. Every built-in skin must be a complete, coherent palette with no accidental. |
| `tests/hermes_cli/test_slack_cli.py` | Slack CLI helpers. |
| `tests/hermes_cli/test_slash_command_interrupt.py` | the KeyboardInterrupt guard around slash command dispatch. A Ctrl+C during a slow slash command (e.g. /skills browse on a large skill. |
| `tests/hermes_cli/test_slash_command_metrics.py` | Classic-CLI slash commands reach shared metrics once each: canonical name, surface. |
| `tests/hermes_cli/test_slash_confirm_windows.py` | #30768, #32383, and #33961. ``_prompt_text_input_modal`` answers destructive-slash confirmations through a queue-based modal. |
| `tests/hermes_cli/test_slash_dispatch_table.py` | Slash-command dispatch semantics in cli.HermesCLI. The pre-dispatch side effects (pre_command hook, pending-resume reset, unknown-command. |
| `tests/hermes_cli/test_slash_undo_title_robustness.py` | slash-command dispatch robustness (round-3 QA). Covers: - SC-01: `/undo <non-numeric>` must NOT quit the CLI (process_command. |
| `tests/hermes_cli/test_smart_app_control_block.py` | Windows Smart App Control detection in the dashboard deps check (#63796). When the policy blocks the embedded Python runtime's ``_ssl`` DLL, the. |
| `tests/hermes_cli/test_snapshot_restore_gateway_session.py` | /snapshot restore in a gateway-backed classic CLI keeps the CLI on its gateway session. Regression for #134889 N7: after a /snapshot restore. |
| `tests/hermes_cli/test_snapshot_restore_oauth.py` | Quick snapshot auth restore must not roll back rotated single-use OAuth. |
| `tests/hermes_cli/test_source_build.py` | Source orchestration uses real node-deps/npm in an isolated checkout. Only PM's tool acquisition (and its installed-node record) is substituted with. |
| `tests/hermes_cli/test_source_channel_integration.py` | Source channel tracers through real HTTP, Git, and completion. |
| `tests/hermes_cli/test_source_check.py` | Exercise the passive checker with real linked worktrees and loopback. |
| `tests/hermes_cli/test_source_completion_stamp.py` | A source checkout publishes identity only after successful completion. |
| `tests/hermes_cli/test_source_launcher_publication.py` | Source launchers keep custom-home and selected-generation state at. |
| `tests/hermes_cli/test_source_release_channels.py` | Release-channel checks and updates against actual repositories and HTTP. |
| `tests/hermes_cli/test_source_release_probe.py` | A desktop check must not reinterpret unreadable channel config as. |
| `tests/hermes_cli/test_source_stamp.py` | Source checkout identity is written only from the checkout itself. |
| `tests/hermes_cli/test_spawn_gateway_restart_cooldown.py` | the _spawn_gateway_restart repeat-request cooldown (#89034). A finished ``gateway-restart`` child does not mean the gateway is back, so. |
| `tests/hermes_cli/test_spawn_gateway_restart_reap.py` | The gateway-restart flow refuses BEFORE it stops anything (#125394, #77276). The Desktop backend's ``_spawn_gateway_restart`` used to reap "orphan". |
| `tests/hermes_cli/test_sqlite3_cli_salvage_gate.py` | #100368 regression: the corruption guidance must not direct a WAL-reset- vulnerable sqlite3 CLI at a live Hermes database. Field forensics (issue. |
| `tests/hermes_cli/test_sqlite_runtime.py` | Behavioral tests for exact-interpreter SQLite runtime inspection. |
| `tests/hermes_cli/test_sqlite_util_canonical.py` | Invariants for the canonical SQLite connect/transaction layer (``hermes_cli/sqlite_util.py``). Every small store used to carry its own connect +. |
| `tests/hermes_cli/test_sse_done.py` | SSE [DONE] sentinel tracking (issue #90848). |
| `tests/hermes_cli/test_ssh_ownership_endpoint.py` | test_ssh_ownership_endpoint_requires_token_and_returns_exact_nonce, test_ssh_ownership_reports_replaced_runtime. |
| `tests/hermes_cli/test_ssh_session_token_parser.py` | test_token_file_is_read_and_unlinked_through_private_directory, test_token_anchor_is_os_home_not_active_profile. |
| `tests/hermes_cli/test_ssh_workspace_fs.py` | test_ssh_workspace_fs_lists_and_reads_remote_paths, test_ssh_workspace_fs_maps_remote_size_failure. |
| `tests/hermes_cli/test_stable_forward_only_shallow.py` | An unchosen default channel never moves a checkout backward on a guess, and an ancestry probe that never answered never refuses the update. |
| `tests/hermes_cli/test_stable_lookup_github_auth.py` | The stable lookup spends the user's GitHub credential, not the shared anonymous. |
| `tests/hermes_cli/test_stale_aux_local_endpoint.py` | Aux pins on local/LAN endpoints are not "stale" — they never bill a provider. |
| `tests/hermes_cli/test_stale_pid_guard.py` | the fail-closed PID-ownership guard. Refs #90471 / #89614. The shared Windows ``taskkill`` boundaries: -. |
| `tests/hermes_cli/test_stale_root_module_bridge.py` | Bridge for pre-hand-off ``hermes update``: a stale root ``utils`` must not kill restart. Updaters up to v2026.9.14 finish the post-pull phases in. |
| `tests/hermes_cli/test_startup_fast_guards.py` | hermes_cli._startup_fast — the pre-import version fast path. Two invariants, each of which has been broken before: 1. IMPORT WEIGHT. |
| `tests/hermes_cli/test_startup_model_routing.py` | startup model/provider routing (#87189). |
| `tests/hermes_cli/test_startup_plugin_gating.py` | CLI startup performance regression. ``hermes_cli.main`` skips eager plugin discovery at argparse-setup time when the invocation is. |
| `tests/hermes_cli/test_state_db_guard.py` | the state.db integrity guard used by the update flow (#68474). Exercises ``verify_sqlite_integrity`` against REAL SQLite files (valid. |
| `tests/hermes_cli/test_status.py` | test_show_status_all_does_not_print_keenable_key_value, test_show_status_all_does_not_print_tavily_key_value. |
| `tests/hermes_cli/test_status_bar_git_branch.py` | Invariant tests for the opt-in git-branch status-bar field. |
| `tests/hermes_cli/test_status_lines_held_during_stream_box.py` | Agent status lines (subagent ``✓ [set n · i/N]`` completions, background-process notices) arrive on other threads mid-stream. The CLI's. |
| `tests/hermes_cli/test_status_model_provider.py` | hermes_cli.status model/provider display. |
| `tests/hermes_cli/test_status_provider_label.py` | `hermes status` provider label honors config.yaml model.base_url. |
| `tests/hermes_cli/test_status_readonly.py` | Status must not bootstrap the session writer it merely observes. |
| `tests/hermes_cli/test_status_report_contract.py` | Contract: the CLI, gateway and TUI /status renderers report the SAME common facts. Every surface renders through. |
| `tests/hermes_cli/test_stderr_timestamp.py` | hermes_cli.stderr_timestamp. |
| `tests/hermes_cli/test_stepfun_picker_merge.py` | StepFun /model picker merges the Step Plan live catalog with the curated list. The StepFun provider's inference endpoint is the Step Plan API, whose. |
| `tests/hermes_cli/test_steward_detection.py` | Steward detection reads the install stamp beside the code, not markers. ``hermes_cli.steward`` decides whether a steward owns this tree (and. |
| `tests/hermes_cli/test_stream_delta_think_tag.py` | _stream_delta's handling of <think> tags in prose vs real reasoning. |
| `tests/hermes_cli/test_stream_flush_left.py` | Streamed response lines must be flush-left (no leading indent). The 4-space ``_STREAM_PAD`` indent made every copied line carry leading whitespace. |
| `tests/hermes_cli/test_stream_json.py` | ``hermes chat -q … --format stream-json`` emits a parseable JSONL event stream and nothing else on. |
| `tests/hermes_cli/test_stream_partial_line_flush.py` | Streaming display: logical lines are emitted ONLY at real newlines. The July 2026 TTFT force-flush hard-wrapped long partial lines at terminal. |
| `tests/hermes_cli/test_stt_picker.py` | the Speech-to-Text category in `hermes tools` (tools_config). Covers the STT provider picker rows, config writes (stt.provider /. |
| `tests/hermes_cli/test_subagent_dock_collapse.py` | Collapsing the passive dock never takes space or focus from the. |
| `tests/hermes_cli/test_subagent_dock_surface.py` | A passive dock paints a bounded surface without acquiring the. |
| `tests/hermes_cli/test_subagent_monitor.py` | The dock is bounded, session-owned, and only repaints changing live. |
| `tests/hermes_cli/test_subagent_monitor_gateway.py` | CLI-12: the Ctrl+T monitor and dock read the gateway session's subagents. Rewired, delegate_task children run in the gateway, so the CLI process's. |
| `tests/hermes_cli/test_subagent_monitor_prompts.py` | Blocking prompts reclaim input from the nested monitor without a. |
| `tests/hermes_cli/test_subagent_monitor_resize.py` | A queued composer resize must not erase the alternate-screen monitor. |
| `tests/hermes_cli/test_subagent_monitor_ui.py` | Monitor navigation keeps controls pinned while live children finish. |
| `tests/hermes_cli/test_subagent_notification_display.py` | Completion notices stay human-facing while the parent retains full. |
| `tests/hermes_cli/test_subagent_shortcut.py` | The shared TUI shortcut routes without editing the classic composer. |
| `tests/hermes_cli/test_subcommands_batch.py` | Smoke tests for the batch-extracted subcommand parser builders. Each ``build_<group>_parser`` should attach its subcommand to a subparsers group and. |
| `tests/hermes_cli/test_subcommands_final_batch.py` | Smoke tests for the final batch of subcommand builders extracted from main(). These groups either imported their handler from a sibling module. |
| `tests/hermes_cli/test_subcommands_followup.py` | Smoke tests for the Phase 2 follow-up subcommand builders (promoted handlers). These 9 subcommands had their handler defined as a closure inside. |
| `tests/hermes_cli/test_subcommands_profile_gateway.py` | extracted subcommand parser builders (profile, gateway). Confirms the builders attach the same subactions and ``func=`` dispatch that. |
| `tests/hermes_cli/test_subprocess_text_encoding.py` | Guard: every text-mode subprocess call in hermes_cli pins utf-8 decoding (#55658). On Windows, ``text=True`` without ``encoding`` decodes child. |
| `tests/hermes_cli/test_subprocess_timeouts.py` | subprocess.run() timeout coverage in CLI utilities. |
| `tests/hermes_cli/test_subscription_cli.py` | the /subscription CLI change flow (cli.py::_show_subscription). Parity with the TUI overlay: the classic CLI now previews + applies a plan. |
| `tests/hermes_cli/test_system_stats_platform.py` | test_windows_11_build_displays_as_windows_11, test_non_windows_platform_unchanged. |
| `tests/hermes_cli/test_systemd_optional_directives.py` | systemd optional-directive normalization (issue #41119). On older systemd versions that don't support RestartMaxDelaySec / RestartSteps. |
| `tests/hermes_cli/test_systemd_replace_dropin.py` | A Hermes-authored systemd ``--replace`` drop-in must not survive unit refresh. An older Hermes wrote ``<unit>.d/20-replace.conf`` to end a respawn. |
| `tests/hermes_cli/test_systemd_watchdog_unit.py` | Generated service behavior for the opt-in systemd watchdog. |
| `tests/hermes_cli/test_tag_fetch_partial_clone.py` | The post-update tag fetch must not convert a full clone into a partial one. `fetch_full_commit_graph` passes `--filter=tree:0` so installer-created. |
| `tests/hermes_cli/test_taskkill_identity_windows_live.py` | Live Windows probes for the fail-closed taskkill process-identity guard. Runs only on real Windows (the on-demand ``wine2e/**`` windows-latest. |
| `tests/hermes_cli/test_teams_pipeline_plugin_cli.py` | the teams_pipeline plugin CLI. |
| `tests/hermes_cli/test_telegram_managed_bot.py` | hermes_cli.telegram_managed_bot — QR codes, deep links, pairing. |
| `tests/hermes_cli/test_tencent_tokenhub_provider.py` | Tencent TokenHub provider support (Hy4 preview). |
| `tests/hermes_cli/test_terminal_backend_docker_probe.py` | Dashboard docker-backend probe must follow the same runtime resolution as the agent. Regression: Desktop showed "Docker CLI not found" on. |
| `tests/hermes_cli/test_terminal_breadcrumbs.py` | hermes_cli/terminal_breadcrumbs.py — per-terminal ``hermes -c``. Covers terminal id derivation (tty vs env vars vs none), breadcrumb. |
| `tests/hermes_cli/test_terminal_bridge_profile_scope.py` | Regression: the terminal config→env re-bridge is scoped to the *true* process profile, never a per-task ``set_hermes_home_override``. The multiplex. |
| `tests/hermes_cli/test_terminal_interrupt_recovery.py` | #33271: terminal recovery after interrupt. When the user interrupts a running agent turn by typing a new message. |
| `tests/hermes_cli/test_terminal_io_broken.py` | CLI freezes UI paints after stdout/PTY EIO (#81521). A stream-stall interrupt that corrupts the PTY used to leave the classic CLI invalidating. |
| `tests/hermes_cli/test_terminal_menu_fallbacks.py` | numbered fallbacks when the interactive curses menu cannot initialize (e.g. non-TTY, curses unavailable, terminal. |
| `tests/hermes_cli/test_terminal_notify.py` | display.bell_on_prompt / bell_on_complete also drive OSC 9 + Warp OSC 777 via. |
| `tests/hermes_cli/test_termios_drift_heal.py` | cooked-mode termios drift healing (cli._heal_cooked_mode_drift). Failure class: prompt_toolkit's ``run_in_terminal`` flips the. |
| `tests/hermes_cli/test_termux_gateway_launch.py` | Termux's interactive fast launch keeps main's deferred-startup hints (main's HermesCLI runs. |
| `tests/hermes_cli/test_timeouts.py` | test_anthropic_adapter_honors_timeout_kwarg, test_resolved_api_call_timeout_priority. |
| `tests/hermes_cli/test_timestamps_command.py` | the CLI `/timestamps` toggle and timestamps in `/history`. `display.timestamps` already drove the live `[HH:MM]` label suffix on. |
| `tests/hermes_cli/test_tips_catalog.py` | hermes_cli.tips reads its catalog through i18n: count follows the English catalog, text follows the active language, and a partial translation falls. |
| `tests/hermes_cli/test_tool_availability_notices.py` | Invariants for the CLI startup 'some tools disabled' notice (tools-runtime-01 /. |
| `tests/hermes_cli/test_tool_gen_start_dedupe.py` | A batch of parallel tool calls announces "preparing <tool>…" once per tool, not once per call. |
| `tests/hermes_cli/test_tool_progress_scrollback.py` | stacked tool progress scrollback lines in the CLI TUI. When tool_progress_mode is "all" or "new", _on_tool_progress should print. |
| `tests/hermes_cli/test_tool_token_estimation.py` | tool token estimation and curses_ui status_fn support. |
| `tests/hermes_cli/test_tools_config.py` | hermes_cli.tools_config platform tool persistence. |
| `tests/hermes_cli/test_tools_config_post_setup.py` | Provider setup delegates package policy to PM and external server. |
| `tests/hermes_cli/test_tools_disable_enable.py` | hermes tools disable/enable/list command (backend). |
| `tests/hermes_cli/test_toolset_validation.py` | hermes_cli.toolset_validation (see #38798). Pure logic — the validity predicate is injected, so these tests need neither the tool. |
| `tests/hermes_cli/test_top_level_value_flags_parity.py` | Top-level value-flag classification must match the real parser (#93530). ``_first_positional_argv`` and ``_apply_profile_override`` in ``main.py``. |
| `tests/hermes_cli/test_transformed_stream_output.py` | coverage for CLI delivery after transform_llm_output streaming. |
| `tests/hermes_cli/test_tts_picker.py` | the TTS plugin picker surface in hermes_cli/tools_config.py (issue #30398). Covers ``_plugin_tts_providers()`` and the. |
| `tests/hermes_cli/test_tui_bundled.py` | test_tui_finds_bundled_entry_js. |
| `tests/hermes_cli/test_tui_exit_summary_short_id.py` | The TUI exit epilogue names a canonical session as compactly as main did (PR #106742 row 36). Main printed ``hermes --tui --resume. |
| `tests/hermes_cli/test_tui_first_run_routing.py` | First-run routing between the classic CLI guard, the TUI and the shared-metrics offer. A blank install (no provider) must reach the TUI's own "Setup. |
| `tests/hermes_cli/test_tui_heap_sizing.py` | cgroup-aware TUI V8 heap sizing. V8 is not cgroup-aware: a flat ``--max-old-space-size=8192`` lets the heap grow toward 8GB in a. |
| `tests/hermes_cli/test_tui_launcher_skips_plugin_discovery.py` | test: the TUI launcher must not spend time on plugin discovery. `hermes --tui` just spawns a Node process; the spawned tui_gateway. |
| `tests/hermes_cli/test_tui_mouse_residue_suppression.py` | the TUI-hot-path mouse-residue suppression. The Python launcher (`hermes --tui …`) has a ~100–300ms cold-start window where stdin is still. |
| `tests/hermes_cli/test_tui_npm_install.py` | TUI launch consumes the shared dependency preparation and compiler. |
| `tests/hermes_cli/test_tui_rapid_enter_paste.py` | Enter arriving mid-paste (no bracketed paste; each newline is its own key event) must not submit / steer the partial line (#10994). Only the. |
| `tests/hermes_cli/test_tui_resume_flow.py` | test_exit_after_oneshot_flushes_stdio_and_calls_os_exit, test_oneshot_subprocess_exits_without_teardown_abort. |
| `tests/hermes_cli/test_tui_terminal_reset_on_exit.py` | GitHub #36823 — the TUI must reset terminal input modes on exit so focus-reporting / mouse-tracking escape sequences don't leak. |
| `tests/hermes_cli/test_tui_worktree_clean_quit.py` | N8: quitting ``hermes --tui -w`` removes a clean worktree (and its branch), as ``main`` did before #106742; a dirty one, or one the gateway still. |
| `tests/hermes_cli/test_tui_worktree_resume_recreate.py` | N8 review 2.2: quitting a clean ``hermes --tui -w`` session that had a conversation removes its tree and branch, but the session's policy froze that. |
| `tests/hermes_cli/test_unified_pool_quirk.py` | The unified-pool vendor quirk must never misclassify a discrete card. On unified-memory NVIDIA devices under Windows, nvidia-smi answers from a WDDM. |
| `tests/hermes_cli/test_uninstall_dry_run.py` | test_dry_run_prints_plan_without_mutating, test_dry_run_lists_named_profiles_without_desktop_userdata. |
| `tests/hermes_cli/test_uninstall_full_wipe_sweep.py` | Full-uninstall macOS sweep: dashboard/serve launchd jobs and Electron/setup caches that live OUTSIDE HERMES_HOME and survive the home rmtree. |
| `tests/hermes_cli/test_uninstall_gateway_service.py` | ``uninstall_gateway_service`` — the per-platform service dispatch. The dispatch is table-driven (``_GATEWAY_SERVICE_REMOVERS``, keyed by. |
| `tests/hermes_cli/test_uninstall_gui_userdata.py` | Keep-data uninstall must not delete the desktop app's Electron userData dir. Regression for #122548: ``hermes uninstall`` option 1 (Keep data) wiped. |
| `tests/hermes_cli/test_uninstall_install_kind.py` | the install-kind uninstall gate + the data-only mode. The rule under test: only a git checkout may have its code removed by the. |
| `tests/hermes_cli/test_uninstall_leftovers.py` | Uninstall sweeps every leftover: both LaunchAgent label patterns, macOS Library app-store entries and the XDG cache/data dirs outside HERMES_HOME. |
| `tests/hermes_cli/test_uninstall_node_symlinks.py` | hermes_cli.uninstall.remove_node_symlinks. Regression for #34536: the POSIX installer drops node/npm/npx symlinks in ~/.local/bin pointing. |
| `tests/hermes_cli/test_uninstall_shell_configs.py` | ``remove_path_from_shell_configs`` — the uninstaller's shell-rc rewrite. This rewrites files Hermes does not own (``~/.bashrc``. |
| `tests/hermes_cli/test_uninstall_windows_bin_launchers.py` | Uninstall must not leave a dangling ``hermes`` command on Windows. Every uninstall mode deletes the code checkout, but the launcher copies staged. |
| `tests/hermes_cli/test_unsupervised_pid1_warning.py` | The PID-1-with-no-init startup warning (#111577): a Compose ``entrypoint:`` override makes hermes PID 1 with no reaper above it, so orphaned. |
| `tests/hermes_cli/test_update_apply_shallow_count.py` | Shallow-checkout guard on the ``hermes update`` apply path (#53479, mirroring #86257). ``rev-list --count HEAD..origin/<branch>`` on a shallow. |
| `tests/hermes_cli/test_update_autostash.py` | Real Git local-work safety: caller divergence, restore faults and rescue. |
| `tests/hermes_cli/test_update_autostash_orphan_warning.py` | Orphaned update-autostash surfacing (#63717 problem 6). ``hermes update`` can legitimately leave an autostash behind (--keep-stash parks it; a. |
| `tests/hermes_cli/test_update_behind_count_recovery.py` | Behind-count recovery via the GitHub compare API (source_check.py). The class of bug: any code path that knows two tip SHAs but has no local history. |
| `tests/hermes_cli/test_update_bootstrap_cache_refresh.py` | _refresh_bootstrap_cache_scripts (the stale-installer-cache fix). Pre-#67193 hermes-setup binaries reuse. |
| `tests/hermes_cli/test_update_channel.py` | Per-install update-channel records (hermes_cli/update_channel.py). Channel is config, keyed by the install id (sha16 of the canonical install-root. |
| `tests/hermes_cli/test_update_channel_stable.py` | Source-update channel selection policy. |
| `tests/hermes_cli/test_update_cold_start_gateway_liveness.py` | #84185: a Windows gateway cold-started after update that dies immediately (e.g. a job object denying breakaway) must not be reported as started. |
| `tests/hermes_cli/test_update_command.py` | the /update slash command in the classic CLI and TUI launcher. Verifies that ``HermesCLI._handle_update_command`` correctly: - Refuses to. |
| `tests/hermes_cli/test_update_commit_obligations.py` | The commit point's obligations: armed before the tree moves, handed back only when still ours. ``arm_commit_obligations`` owes the completion tail. |
| `tests/hermes_cli/test_update_completion_lease.py` | L3: the Windows bootstrap completion child joins the checkout lock (with its own R5b lease) before it writes the. |
| `tests/hermes_cli/test_update_completion_process.py` | A checkout transition must not finish in the old interpreter's module. |
| `tests/hermes_cli/test_update_completion_routing.py` | All source selection routes hand off once, without old-process. |
| `tests/hermes_cli/test_update_concurrent_quarantine.py` | Windows gateway service invariants and launcher identity after PM. |
| `tests/hermes_cli/test_update_config_clears_custom_fields.py` | hermes_cli.auth._update_config_for_provider clearing stale fields. When the user switches from a custom provider (e.g. MiniMax with. |
| `tests/hermes_cli/test_update_config_migration_on_current.py` | Migration UX policy; selected-child and real profile writes live in completion. |
| `tests/hermes_cli/test_update_contract.py` | Image-managed refusal contract tests (#91277 Phase 3). Marker semantics (image_provenance.py, salvaged from #92545 @andrexibiza): absent → None. |
| `tests/hermes_cli/test_update_cron_deadlock_guard.py` | #100179: cron-update three-way restart deadlock. When `hermes update` runs INSIDE the gateway's own process tree (the. |
| `tests/hermes_cli/test_update_cua_pm.py` | Updates reconcile owned CUA pins without bypassing native host. |
| `tests/hermes_cli/test_update_custody.py` | R2: every updater git runner shares ONE custody policy (hermes_cli.update_custody). Real git, real processes, no mocks: * every runner passes ``-c. |
| `tests/hermes_cli/test_update_detached_rescue_ref.py` | `hermes update` must not orphan commits made on a detached HEAD. Both update shapes move HEAD off a detached commit: the branch update checks out. |
| `tests/hermes_cli/test_update_diverged_rescue_ref.py` | `hermes update` must not drop local commits without leaving a named way back. When the checkout sits on the update's target branch and its history. |
| `tests/hermes_cli/test_update_downgrade_guard.py` | `hermes update` refuses a target that predates the gateway runtime once a state.db holds ledger rows. Downgrading is unsupported (#106742. |
| `tests/hermes_cli/test_update_downgrade_guard_named_profile.py` | A named-profile update's refusal tells the user to reopen THAT profile for its. |
| `tests/hermes_cli/test_update_eol_churn.py` | Regression: ``hermes update`` should take a managed checkout off autocrlf=true. Git for Windows ships ``core.autocrlf=true`` in its system config. |
| `tests/hermes_cli/test_update_existing_branch_baseline.py` | Real Git regression coverage for updates that land via an existing. |
| `tests/hermes_cli/test_update_exit_code_publication.py` | Every writer of ``.update_exit_code`` publishes it atomically. The gateway /update watcher (gateway/run_notifications_update.py) polls. |
| `tests/hermes_cli/test_update_external_checkout.py` | coverage for separate-checkout gateways (#117449). |
| `tests/hermes_cli/test_update_external_profile_reconciliation.py` | A symlinked profile that is really another install must not fail `hermes update` (#120240). ``~/.hermes/profiles/work -> ~/.hermes-work`` where. |
| `tests/hermes_cli/test_update_fetch_failure_classifier.py` | Fetch-failure classification for `hermes update` / `hermes update --check`. A GitHub-side HTTP 429 (rate limit / outage) used to be reported as the. |
| `tests/hermes_cli/test_update_fetch_timeout.py` | A dead-stalled network fetch ends `hermes update` with an error, never a hang (#93759, #95777). `_git_run(network=True)` bounds the wait; a. |
| `tests/hermes_cli/test_update_finish.py` | Historical takeover completion in a fresh, dependency-selected process. PM preparation has its own worker tests. Here the tool provisioner supplies. |
| `tests/hermes_cli/test_update_finish_stamp.py` | Historical takeover publishes source identity before restarting. |
| `tests/hermes_cli/test_update_flat_install_state_gitignore.py` | Flat-install runtime state must be gitignored so ``hermes update``'s untracked autostash cannot sweep the live state.db (#110648). On a flat install. |
| `tests/hermes_cli/test_update_fleet_check_fail_closed.py` | #93406 — post-update fleet version check must fail closed. ``collect_fleet_versions()`` swallows every probe failure via. |
| `tests/hermes_cli/test_update_fleet_checkout_build_stamp.py` | ``checkout_contains`` on a build-stamped image (no ``.git``): ancestry collapses to stamp equality. On a Docker/Cloud image ``git merge-base`` has. |
| `tests/hermes_cli/test_update_fleet_completion.py` | SQLite completion and fleet verification remain independent update. |
| `tests/hermes_cli/test_update_fleet_home_scope.py` | #93349 — ``hermes update`` restarts only the gateways of the home it is updating. ``hermes-gateway*`` units and ``gateway run`` processes are. |
| `tests/hermes_cli/test_update_fleet_incomplete_warning.py` | Incomplete-fleet-restart hint on a systemd host (Linux arm of ``_warn_incomplete_gateway_fleet_restart``; the macOS arm lives in. |
| `tests/hermes_cli/test_update_fleet_probe_resume_token.py` | #93406 (residual) — the Windows pause/resume token is NOT a fleet runtime and must not be counted by. |
| `tests/hermes_cli/test_update_fleet_restart_pending.py` | Interrupted-update fleet-restart obligation (#95294 parts 1+2). A ``hermes update`` killed after git pull advanced HEAD but before the fleet restart. |
| `tests/hermes_cli/test_update_fleet_restart_timeout.py` | #68523 — one systemctl timeout must not abort fleet restarts. On hosts with many profile-backed ``hermes-gateway*.service`` units. |
| `tests/hermes_cli/test_update_fleet_snapshot_settle.py` | #111272: wait for a supervised gateway to publish its state. A systemd restart can report the unit active before the replacement. |
| `tests/hermes_cli/test_update_fork_sync_identity.py` | The fork sync acts on ONE upstream commit (review R6 m2). ``_sync_with_upstream_if_needed`` fetches ``refs/remotes/upstream/main`` and fast-forwards. |
| `tests/hermes_cli/test_update_gateway_launcher_refresh.py` | Legacy pythonw launcher normalization + post-update launcher refresh. Covers the two halves of the "legacy pythonw gateways survive updates forever". |
| `tests/hermes_cli/test_update_gateway_restart_aborted.py` | #78574 — a crashed gateway-restart phase must not stay silent. ``hermes update`` wrapped its entire gateway auto-restart phase in a. |
| `tests/hermes_cli/test_update_gateway_restart_fallback.py` | coverage for #88654. ``hermes update`` relaunches manually-run profile gateways through ``_prepare_profile_gateway_update_restart``. When. |
| `tests/hermes_cli/test_update_hangup_protection.py` | SIGHUP protection and stdout mirroring in ``hermes update``. Covers ``_UpdateOutputStream``, ``_install_hangup_protection``, and. |
| `tests/hermes_cli/test_update_head_moved_gate.py` | the post-pull HEAD-movement gate in ``hermes update``. Issue #79678: a detached/pinned checkout can report "N new commit(s)" against. |
| `tests/hermes_cli/test_update_host_obligation.py` | The update→restart obligation is HOST-scoped, and one update restarts the host gateway once. Multiplex-only (Teknium ruling): exactly one ``hermes. |
| `tests/hermes_cli/test_update_import_guard.py` | the post-update *import* guard in ``hermes update``. ``_validate_critical_files_syntax`` only parses files, so it cannot detect a. |
| `tests/hermes_cli/test_update_interrupted_pull.py` | A `hermes update` killed while git writes the new tree must leave a recoverable install. Git rewrites the checkout file by file and moves HEAD last. |
| `tests/hermes_cli/test_update_inventory.py` | hermes_cli.update_inventory — the plan phase (#91277 Phase 2). |
| `tests/hermes_cli/test_update_launch_completion.py` | A fresh launch finishes a source update using PM's success record, not a. |
| `tests/hermes_cli/test_update_launchd_fleet_restart.py` | #41403 — ``hermes update`` must restart ALL macOS launchd gateways. The macOS branch of the update's fleet-restart step only. |
| `tests/hermes_cli/test_update_launchd_restart_verification.py` | #88848 - a launchd restart the update never verified. ``hermes update`` on macOS printed ``Update complete!`` and exited 0 while the. |
| `tests/hermes_cli/test_update_launchd_unloaded_gateway.py` | #74973 — `hermes update` must not leave the gateway down. On macOS the update's launchd branch guarded the restart behind ``launchctl. |
| `tests/hermes_cli/test_update_list_venv_holders.py` | ``hermes update --list-venv-holders``: read-only JSON twin of the Windows venv-holder refusal. Drives ``cmd_update`` (the production entry point) so. |
| `tests/hermes_cli/test_update_live_output.py` | Live output must reach disk before exit, without concealing silence. |
| `tests/hermes_cli/test_update_lock.py` | Cross-process update mutual exclusion (``hermes_cli.update_lock``). Three surfaces can start an update of one install tree: a terminal ``hermes. |
| `tests/hermes_cli/test_update_lock_fd_provenance.py` | A same-process status reader cannot donate a descriptor to checkout. |
| `tests/hermes_cli/test_update_lock_protocol.py` | Marker mutation protocol (A7) and checkout custody (R2/R11) with real processes and files. Each test reproduces a review finding on the pre-A7 head. |
| `tests/hermes_cli/test_update_lock_windows_live.py` | Windows live cells for the checkout lock (contract C1.7): msvcrt byte lock + kill-on-close job. Invariant under test: the checkout lock is free =>. |
| `tests/hermes_cli/test_update_marker_corpus.py` | The shared update-marker corpus, run against the Python reader/releaser (A7 rule 7). ``tests/fixtures/update_marker_corpus.json`` is the one table. |
| `tests/hermes_cli/test_update_messages.py` | User-facing wording contracts for ``hermes update`` failure/partial output. Invariants only (what the user must be able to read and act on), never. |
| `tests/hermes_cli/test_update_missing_configured_deps.py` | Configured-feature warnings must describe the selected update child (#10651). PM's atomic dependency union cannot validate a configured but. |
| `tests/hermes_cli/test_update_modified_notice.py` | Skill sync keeps user edits and tells the updater's user how to inspect. |
| `tests/hermes_cli/test_update_narrow_clone_compare_ref.py` | #125112: the updater must resolve its compare ref on narrow clones. A tag-pinned ``git clone --depth 1 --single-branch --branch. |
| `tests/hermes_cli/test_update_narrow_clone_refspec.py` | test for #125112: `hermes update --check` on a narrow clone. |
| `tests/hermes_cli/test_update_no_gateway_restart.py` | The PM completion child honors --no-gateway-restart without skipping preparation. |
| `tests/hermes_cli/test_update_obligation_identity.py` | A historical receipt cannot outweigh complete, identity-matched live. |
| `tests/hermes_cli/test_update_owning_install.py` | ``hermes update`` from a PM environment's workspace goes to the checkout that owns it. |
| `tests/hermes_cli/test_update_parked_branch_guard.py` | the parked-branch guard in ``hermes update``. Live incident (2026-08-17, Teknium's Linux box): the source checkout was parked. |
| `tests/hermes_cli/test_update_pause_boundaries.py` | Real-process pause/consume/recovery contracts, not native Windows SCM. |
| `tests/hermes_cli/test_update_pause_checkout_moves.py` | Every checkout-writing step binds the paused gateways' tree gate first (#132338 R3, thread 5). The Windows pause records what "the tree before this. |
| `tests/hermes_cli/test_update_pause_debt_windows_live.py` | Native Windows restart-debt boundaries of the update pause (#132338 R8): real files held the way Windows readers hold them, a real SCM service, real. |
| `tests/hermes_cli/test_update_pause_moved_head_gate.py` | The paused gateways' tree gate judges a MOVED HEAD too (#132338 R3 follow-up). ``git checkout <existing branch>`` can exit 0 and move HEAD while. |
| `tests/hermes_cli/test_update_pause_record.py` | Paused-gateway record and update-claim adoption, with real processes and a real. |
| `tests/hermes_cli/test_update_pause_recover_backoff.py` | A launch's paused-gateway recovery never makes every command wait on the same unready relaunch. ``recover()`` runs before every command (chat. |
| `tests/hermes_cli/test_update_pause_recovery_stdout.py` | Startup recovery never writes to the stdout of the command it runs ahead of. ``update_pause_record.recover()`` resumes gateways an interrupted. |
| `tests/hermes_cli/test_update_pause_service_rollback.py` | A failed service pause keeps its record exactly when its rollback left gateways down. ``_pause_windows_gateways_for_update`` decides whether to. |
| `tests/hermes_cli/test_update_pause_step_interruptions.py` | The stash and churn steps bind the paused gateways' tree gate too (#132338 R3 follow-up). ``git stash push`` / ``stash apply`` and the. |
| `tests/hermes_cli/test_update_pause_stop_evidence.py` | Accepted-stop evidence the pause record cannot read or could not write: the debt stays owed. The gateway is this test process (a live incarnation. |
| `tests/hermes_cli/test_update_pause_unmapped_home_proof.py` | A paused unmapped gateway keeps the home discovery proved for it (#132338 R2 / review thread 7). Discovery owns a gateway whose environment is. |
| `tests/hermes_cli/test_update_pause_unmapped_identity.py` | An unmapped gateway's restart debt is retired only by ITS runtime (#132338 review C). The pause records an unmapped gateway (no profile PID file. |
| `tests/hermes_cli/test_update_pm_git.py` | Windows installs whose git is PM's: install.ps1 stages it, PM's facts must record. |
| `tests/hermes_cli/test_update_posix_pause.py` | POSIX pre-swap gateway pause: what survives a killed updater, and what a paused update asks. Real processes and a real record; the live stop/restart. |
| `tests/hermes_cli/test_update_post_commit_followups.py` | Contract C3: after the commit point nothing fails `hermes update`. Post-commit step failures are ⚠ + a receipt follow-up + an armed obligation; the. |
| `tests/hermes_cli/test_update_post_commit_safety.py` | Post-commit completion keeps exit status, runtime safety and owed debt as separate facts. Each test runs the real completion (or receipt rotation). |
| `tests/hermes_cli/test_update_post_pull_syntax_guard.py` | the post-pull syntax guard in ``hermes update``. When a bad commit lands on ``main`` with a syntax error in a critical file (e.g. orphan. |
| `tests/hermes_cli/test_update_products.py` | Update retries use the same dependency transaction as a newly pulled. |
| `tests/hermes_cli/test_update_receipt.py` | hermes_cli.update_receipt — Phase 1 of the fleet-update plan (#91277). Covers: - receipt lifecycle (begin → record → finalize → read back). |
| `tests/hermes_cli/test_update_receipt_durability.py` | Receipt recovery must preserve terminal and user-action facts across. |
| `tests/hermes_cli/test_update_receipt_endpoint.py` | Phase-1 bullet 3 (#91277): the dashboard/Desktop READ the update receipt. The update receipt (written by every `hermes update` run since #91283. |
| `tests/hermes_cli/test_update_receipt_owe_followup.py` | A post-commit follow-up lands on the run exactly once, whether its receipt is still open or. |
| `tests/hermes_cli/test_update_receipt_pm_embed.py` | Tests: update receipts embed ONLY their own pm sync sections. The updater embeds the sync receipt that carries ITS correlation id — read from. |
| `tests/hermes_cli/test_update_receipt_profile_store.py` | Under a named profile the updater (root store) and pm (profile store) still see each other's. |
| `tests/hermes_cli/test_update_receipt_run_record.py` | A run's own archive is read through one lookup: an unreadable record is a missing. |
| `tests/hermes_cli/test_update_receipt_scope.py` | Nested command boundaries and copied contexts cannot close an outer. |
| `tests/hermes_cli/test_update_recovery_closure.py` | A killed tree move that tears the launch repair's own code is still repaired at the next launch. The repair (``hermes_bootstrap`` ->. |
| `tests/hermes_cli/test_update_recovery_custody.py` | Broken custody imports never authorize repair of a possibly live. |
| `tests/hermes_cli/test_update_restart_recovery.py` | coverage for fresh-process recovery after an update restart abort. The updater may have loaded the pre-pull module graph when the. |
| `tests/hermes_cli/test_update_restore_authority.py` | Maintenance must not replace the database behind a live authority. |
| `tests/hermes_cli/test_update_scoped_reconciliation.py` | Marker settlement uses its own inventory, never a historical receipt's. |
| `tests/hermes_cli/test_update_secret_import_lock.py` | coverage for Windows updater self-locking native dependencies. External secret backends are useful during normal Hermes startup, but the. |
| `tests/hermes_cli/test_update_serve_generation_recovery.py` | coverage for stale ``hermes serve`` generations after an abort. Issue #92145: ``hermes update`` moves the checkout from generation N to. |
| `tests/hermes_cli/test_update_shallow_heal.py` | A shallow checkout is unshallowed (commit graph only) before the updater's bounded fetch. From a depth-1 install far behind main, a plain ``git. |
| `tests/hermes_cli/test_update_shim_self_lock.py` | Pending-rename filter for the Windows console-shim update self-lock (#88838, #89599, #86093). ``_filter_pending_shim_renames`` is a pure function. |
| `tests/hermes_cli/test_update_sqlite_remediation.py` | Selected-runtime admission and dashboard completion bookkeeping. |
| `tests/hermes_cli/test_update_ssl_cert_file.py` | SSL_CERT_FILE → GIT_SSL_CAINFO for the updater's git children (#124654). git's libcurl ignores ``SSL_CERT_FILE``; behind a TLS-inspecting proxy. |
| `tests/hermes_cli/test_update_stage.py` | Stage publishing into a watching desktop-update UI (hermes_cli.update_stage). The desktop hand-off shim renders progress from a status JSON file. |
| `tests/hermes_cli/test_update_stale_dashboard.py` | the stale-dashboard handling run at the end of ``hermes update``. ``hermes update`` detects ``hermes dashboard`` processes left over from. |
| `tests/hermes_cli/test_update_stale_gateway_yield.py` | #117275: a stale-code ticker that yields every tick must never read as healthy, and the updater must hand a proven-stale survivor to the. |
| `tests/hermes_cli/test_update_state_autorestore.py` | Updater restore must publish snapshot rows without replaying the old. |
| `tests/hermes_cli/test_update_system_dashboard_unit.py` | ``hermes update`` on a system-scope ``hermes-dashboard`` unit without root (#141021). The fleet loop correctly declines to restart the unit (no. |
| `tests/hermes_cli/test_update_target_identity.py` | Stable updates consume one remote commit across Git and archive. |
| `tests/hermes_cli/test_update_unit_client_budget.py` | Update clients cover unit transactions without hiding manager. |
| `tests/hermes_cli/test_update_upstream_prompt_noninteractive.py` | The fork-upstream prompt must never block a non-interactive update (#60240). `_sync_with_upstream_if_needed` asks "Add official repo as 'upstream'. |
| `tests/hermes_cli/test_update_venv_holder_retirement.py` | PM updates do not require the currently running venv to become. |
| `tests/hermes_cli/test_update_version_report.py` | Version transition reporting after ``hermes update``. Ported from PrimeIntellect-ai/prime-agent#630: a successful self-update reports both versions. |
| `tests/hermes_cli/test_update_wedged_gateway.py` | the wedged-gateway health probe + bounded escalation (#81642). A gateway whose event loop is stalled cannot process a graceful shutdown. |
| `tests/hermes_cli/test_update_windows_cross_install_gateway.py` | ``hermes update`` on Windows pauses only its own install's gateways (#124659). The host-wide gateway scan sees every install's gateway. Each process. |
| `tests/hermes_cli/test_update_windows_home_acl.py` | Windows update ACL repair contracts (the Windows ACL effect: ``tests/test_hermes_dir_acl_windows.py``). |
| `tests/hermes_cli/test_update_zip_completion.py` | ZIP completion uses the Git maintenance/fleet path after a real local. |
| `tests/hermes_cli/test_update_zip_fallback_guards.py` | ZIP fallback must not fire on dependency failures or clobber a dirty tree. Issue #87304: on Windows the update ``try`` spans git pull *and* ``uv pip. |
| `tests/hermes_cli/test_update_zip_release_preserve.py` | #70337/#87331/#90495: the ZIP swap must preserve the gitignored build outputs. The GitHub source ZIP carries only source; the BUILT desktop app. |
| `tests/hermes_cli/test_update_zip_symlink_reject.py` | Regression: _update_via_zip must reject ZIP members with symlink mode. A symlink member in a downloaded update ZIP would let an attacker who can. |
| `tests/hermes_cli/test_update_zip_sync_failure.py` | ZIP and Git-error fallback return the completion owner's exact. |
| `tests/hermes_cli/test_update_zip_two_phase.py` | the two-phase ZIP replace and the shared venv-layout helpers. ``_atomic_replace_dir`` (#49145) made each *individual* directory swap safe. |
| `tests/hermes_cli/test_upstage_provider.py` | Focused tests for Upstage Solar first-class provider wiring. Regression guard for the bug where `hermes model` saved `provider: upstage` correctly. |
| `tests/hermes_cli/test_urllib_security.py` | Wire-level tests for credential-safe stdlib urllib redirects. |
| `tests/hermes_cli/test_usage_command.py` | ``hermes usage`` — the non-interactive /usage surface (issue #33094). Drives the real ``hermes`` argparse entrypoint; only the network fetch is. |
| `tests/hermes_cli/test_user_provider_timeout_only_entry.py` | #110402: a ``providers.<name>`` block with no endpoint (only tuning keys like ``stale_timeout_seconds``/``request_timeout_seconds``). |
| `tests/hermes_cli/test_user_providers_model_switch.py` | user-defined providers (providers: dict) in /model. These tests ensure that providers defined in the config.yaml ``providers:`` section. |
| `tests/hermes_cli/test_ux_messages_chat_sessions.py` | Plain-language contracts for chat/session failure copy (CLI UX message campaign, cluster D). Each test asserts the CONTRACT (what happened + the. |
| `tests/hermes_cli/test_ux_messages_startup.py` | Invariant tests for the plain-language startup messages of the ``hermes`` CLI. Contracts (not snapshots): a mistyped subcommand names the typo. |
| `tests/hermes_cli/test_vault_sources_shape.py` | `hermes vault sources --disable` must not crash on a hand-edited non-dict ``vault:`` section in config.yaml (the same YAML-shape hazard class. |
| `tests/hermes_cli/test_venv_current_launch.py` | prepare_launch() recognizes the store interpreter it would re-exec into (#122513). PM spells the store Python through HERMES_HOME, which may contain. |
| `tests/hermes_cli/test_venv_holder_classifier.py` | Cross-platform unit tests for the venv-holder message classifier. |
| `tests/hermes_cli/test_venv_holder_windows_live.py` | LIVE Windows E2E for retained lifecycle holder discovery (fleet-update #91277). Runs ONLY on a real Windows host (the on-demand. |
| `tests/hermes_cli/test_venv_sync.py` | venv_sync must work on trees where the venv does not exist yet. It is the stdlib-only-at-import pre-venv entry point: the installers call it on a. |
| `tests/hermes_cli/test_venv_sync_currency.py` | Checkout freshness follows the selected PM generation, not a second. |
| `tests/hermes_cli/test_venv_sync_update_tree.py` | A launch never runs the completion tail beside a live update tree whose marker is gone. A killed ``hermes update`` leaves its completion child. |
| `tests/hermes_cli/test_verify_console_scripts.py` | Orphan launcher discovery follows the declared console script. |
| `tests/hermes_cli/test_version_command.py` | the /version slash command. |
| `tests/hermes_cli/test_version_info.py` | test_derived_version_shows_plus_question_for_dirty_unknown_distance, test_display_version_names_the_distance_without_the_commit. |
| `tests/hermes_cli/test_vertex_model_picker.py` | Vertex visibility in the /model picker (follow-up to PR #56688). Community verification of the vertex-registration fix found two remaining gaps that. |
| `tests/hermes_cli/test_vertex_provider.py` | Vertex AI runtime-provider resolution and profile registration. Covers: provider-profile registration + aliases, alias canonicalization. |
| `tests/hermes_cli/test_video_gen_picker.py` | plugin video_gen providers in the tools picker. Covers the reconfigure path that previously failed to write ``video_gen.provider`` when a. |
| `tests/hermes_cli/test_vim_mode_command.py` | display.vim_mode: config-only vi keybindings for the CLI composer. |
| `tests/hermes_cli/test_voice_wrapper.py` | ``hermes_cli.voice`` — the TUI gateway's voice wrapper. The module is imported *lazily* by ``tui_gateway/server.py`` so that a box with. |
| `tests/hermes_cli/test_wake_word_config_schema.py` | The config UI offers the same wake providers the runtime resolves. |
| `tests/hermes_cli/test_warning_callback_conservation.py` | Concrete CLI sinks own filtering; generic agent callbacks remain. |
| `tests/hermes_cli/test_web_analytics_corrupt_store.py` | A malformed state.db must not turn dashboard analytics polling into a traceback storm. |
| `tests/hermes_cli/test_web_build_limits.py` | Web dashboard build resource caps (issue #63338). ``npm run build`` under ``web/`` runs Vite 8's Rust-native bundler (Rolldown) plus the TypeScript. |
| `tests/hermes_cli/test_web_capability_gateway_route.py` | Each web capability picks its own route: the user's own key or the Nous Tool Gateway. "Use for Extract" on the Nous Subscription row must send. |
| `tests/hermes_cli/test_web_git_gh_stderr.py` | Behavioral tests for the gh wrappers' failure reporting (#87731). `_gh` used to collapse every non-zero exit to `(False, "")` and `review_create_pr`. |
| `tests/hermes_cli/test_web_git_identity.py` | Review commits preserve native Git identity without enabling hooks. |
| `tests/hermes_cli/test_web_logs_async.py` | test_get_logs_yields_while_reading_and_filtering. |
| `tests/hermes_cli/test_web_memory_provider_setup_install.py` | CLI/dashboard setup resolves declarations, not ambient importability. |
| `tests/hermes_cli/test_web_memory_user_dir_provider.py` | A memory provider installed under ``$HERMES_HOME/plugins/`` (catalog install) keeps the Desktop surfaces a bundled copy has: host-block config. |
| `tests/hermes_cli/test_web_multi_profile_scope.py` | Dashboard routers that read a named profile's config/credentials run under that profile's FULL scope (home + secrets) and never mutate the dashboard. |
| `tests/hermes_cli/test_web_oauth_dispatch.py` | the OAuth dispatcher in hermes_cli.web_server. Bug history (2026-05-09): the `_OAUTH_PROVIDER_CATALOG` had two entries flagged. |
| `tests/hermes_cli/test_web_plugins_catalog.py` | Dashboard plugin-catalog surface: GET /api/dashboard/plugins/catalog merges installed state via the installer-owned install-metadata ``catalog``. |
| `tests/hermes_cli/test_web_profile_delete_settlement.py` | ``DELETE /api/profiles/{name}``: a settle-pending delete reports a partial success, not a 500. Deleting a profile can end with the directory gone. |
| `tests/hermes_cli/test_web_profile_soul_writes.py` | ``PUT /api/profiles/{name}/soul`` must not destroy an existing SOUL.md. The dashboard persona editor replaces the whole document on every Save. A. |
| `tests/hermes_cli/test_web_profiles_model_scope.py` | ``PUT /api/profiles/{name}/model`` must validate under the target profile's secret scope. ``_write_profile_model`` used to enter only the. |
| `tests/hermes_cli/test_web_profiles_off_loop.py` | tests: ``/api/profiles`` handlers must not block the event loop. ``hermes_cli/web_routers/profiles.py`` holds handler bodies that were. |
| `tests/hermes_cli/test_web_provider_selection.py` | Web setup reports the selected backend without interrupting config. |
| `tests/hermes_cli/test_web_read_coalescing.py` | GET /api/profiles coalesces a poll burst before AnyIO threadpool admission. |
| `tests/hermes_cli/test_web_read_confinement.py` | Locked preview and review routes share the managed-file read boundary. |
| `tests/hermes_cli/test_web_recommended_default_profile.py` | ``GET /api/model/recommended-default?provider=nous`` answers for the requested profile. The Nous branch returned before the route entered the. |
| `tests/hermes_cli/test_web_routers_destructive_profile_scope.py` | One backend serves every profile, so a REST handler that reads ``get_hermes_home()`` directly mutates the LAUNCH profile's data no matter which. |
| `tests/hermes_cli/test_web_routers_endpoint_probe.py` | Endpoint-probe contract for the Desktop local/custom endpoint validators (#63472). httpx honours ``HTTP(S)_PROXY`` (and the Windows system proxy). |
| `tests/hermes_cli/test_web_routers_status_health.py` | ``GET /api/health`` ``commit`` contract (review G4). The public health probe reports the backend's BOOT ``commit`` so an attaching client can refuse. |
| `tests/hermes_cli/test_web_routers_tools_install_on_enable.py` | Install-on-enable for toolset toggles (dashboard/desktop PUT endpoint). When a toolset is toggled ON via ``PUT /api/tools/toolsets/{name}`` and its. |
| `tests/hermes_cli/test_web_server.py` | hermes_cli.web_server and related config utilities. |
| `tests/hermes_cli/test_web_server_approvals_broadcast.py` | Approvals config saves must re-emit session.info to live gateway sessions. Regression for the desktop "YOLO toggle does nothing / flips back off". |
| `tests/hermes_cli/test_web_server_asset_mime.py` | Dashboard asset MIME types are platform-independent (#28987). On Windows, ``mimetypes.init()`` reads the registry, where ``.js`` can be mapped to. |
| `tests/hermes_cli/test_web_server_auto_archive_gateway_lock.py` | Invariant: `hermes serve`'s opportunistic auto-archive never opens a WRITABLE SessionDB for a profile whose gateway is live (#110405). The gateway. |
| `tests/hermes_cli/test_web_server_auto_archive_profile_config.py` | Invariant: a profile's OWN ``sessions:`` config governs its store's auto-archive. ``_maybe_auto_archive_for_profile`` sweeps an arbitrary profile's. |
| `tests/hermes_cli/test_web_server_boot_handshake.py` | Integration tests for the desktop boot handshake fix (PR #50231 / issue #50209). Simulates a slow hermes_cli.gateway import (15-30 s on a fresh. |
| `tests/hermes_cli/test_web_server_chat_workspaces.py` | Dashboard chat workspace picker: ``GET /api/chat/workspaces`` + ``/api/pty?cwd=``. A fresh dashboard chat can be aimed at a host directory (the same. |
| `tests/hermes_cli/test_web_server_config_offloop.py` | GET /api/config must not block the event loop on _SKILLS_PROFILE_LOCK. Regression for a captured 1.044s gateway stall: the endpoint entered. |
| `tests/hermes_cli/test_web_server_console_ws.py` | Dashboard Hermes Console websocket tests. |
| `tests/hermes_cli/test_web_server_cors_preflight.py` | CORS preflight ordering on the dashboard web server. Regression: ``CORSMiddleware`` was registered *before* the. |
| `tests/hermes_cli/test_web_server_cron_profiles.py` | dashboard cron job profile routing. |
| `tests/hermes_cli/test_web_server_cron_repeat.py` | coverage for finite repeat counts in the dashboard cron create API. |
| `tests/hermes_cli/test_web_server_executor_isolation.py` | Control-plane routes stay available when asyncio's default pool is wedged. Regression for #95559: the event loop and lightweight async routes. |
| `tests/hermes_cli/test_web_server_files.py` | the dashboard-managed file browser API. |
| `tests/hermes_cli/test_web_server_fs.py` | test_fs_list_sorts_and_hides_noise, test_fs_routes_workspace_reads_to_ssh_backend. |
| `tests/hermes_cli/test_web_server_gateway_health.py` | _probe_gateway_health() — cross-container gateway detection, including the bounded JSON response body reads (moved from test_web_server.py. |
| `tests/hermes_cli/test_web_server_gateway_topology.py` | the /api/status profile + gateway topology readout. Covers the loopback-only ``profiles`` / ``gateway_mode`` / ``gateways`` fields added. |
| `tests/hermes_cli/test_web_server_git.py` | test_gh_auth_concurrent_cache_misses_share_one_probe, test_gh_auth_refresh_waits_out_a_probe_started_before_it. |
| `tests/hermes_cli/test_web_server_host_header.py` | GHSA-ppp5-vxwm-4cf7 — Host-header validation. DNS rebinding defence: a victim browser that has the dashboard open could be tricked into. |
| `tests/hermes_cli/test_web_server_idle_exit.py` | A Desktop-owned ``serve --isolated`` backend over SSH must retire itself once no client has been connected for the grace window and no turn is. |
| `tests/hermes_cli/test_web_server_idle_proof.py` | A Desktop-pooled ``hermes serve`` child must PROVE it is idle before the Desktop may retire it for a foreground open (supersedes #104871, whose idle. |
| `tests/hermes_cli/test_web_server_launch_env_freeze.py` | The launch-env freeze is the LAST boot step, not the first. Activation snapshots ``os.environ`` as the launch profile's credentials, and that. |
| `tests/hermes_cli/test_web_server_listener_logging.py` | Building a listener's ``uvicorn.Config`` must leave Hermes's own file logging alone. uvicorn's default ``log_config`` runs. |
| `tests/hermes_cli/test_web_server_media_async.py` | Dashboard media reads must not run on the event-loop thread. |
| `tests/hermes_cli/test_web_server_messaging_posture.py` | The Channels "Test" button must answer the auth-posture question too (#66030). ``POST /api/messaging/platforms/{platform_id}/test`` used to stop at. |
| `tests/hermes_cli/test_web_server_messaging_profiles.py` | profile-scoped dashboard Channels endpoints. Before the ``profile`` parameter existed, ``/api/messaging/platforms`` always. |
| `tests/hermes_cli/test_web_server_messaging_stale_runtime.py` | A stopped gateway's per-platform verdict is history, not current state. ``gateway_state.json`` preserves platform entries across restarts, so a. |
| `tests/hermes_cli/test_web_server_nous_recommended_default.py` | Dashboard recommended-default model: the paid-tier Nous cost-safe policy. |
| `tests/hermes_cli/test_web_server_owner_exit.py` | A Desktop-over-SSH ``serve --isolated`` backend retires itself once the Desktop's ownership lock names a newer spawn (#132034): a reconnect that. |
| `tests/hermes_cli/test_web_server_plugin_secret_scope.py` | A plugin API handler's ``get_secret()`` resolves the requested profile's credentials (#120310), through the real mount path: the launch profile's. |
| `tests/hermes_cli/test_web_server_profile_unification.py` | the machine-dashboard multi-profile unification. The dashboard is ONE machine-level management surface: config, env, MCP. |
| `tests/hermes_cli/test_web_server_pty_idle_backoff.py` | Regression: dashboard PTY pump must back off when the terminal is. |
| `tests/hermes_cli/test_web_server_pty_import.py` | Test the platform-branched PTY bridge import in hermes_cli.web_server_chat. The /api/pty WebSocket handler picks its bridge at import time via. |
| `tests/hermes_cli/test_web_server_pty_reconnect.py` | Focused tests for dashboard PTY reconnect breadcrumbs. |
| `tests/hermes_cli/test_web_server_session_owner_forward.py` | A standalone dashboard's mutations must reach the live gateway owner (#138915). While a gateway serves the same home, the dashboard process is not. |
| `tests/hermes_cli/test_web_server_session_search.py` | test_desktop_session_search_merges_id_matches_before_content_matches, test_desktop_session_search_stamps_the_requested_profile. |
| `tests/hermes_cli/test_web_server_session_search_titles.py` | GET /api/sessions/search must match session titles, not only ids and FTS5 message content. Regression for #66242: the search endpoint composed only. |
| `tests/hermes_cli/test_web_server_sessiondb_eventloop.py` | Dashboard session routes must run SessionDB open + work off the event loop. Regression for #60747: /search, /stats, /{id} (and bulk delete) ran FTS. |
| `tests/hermes_cli/test_web_server_sessions_compression.py` | Dashboard sessions endpoints vs compression-continuation children (#54298, #57543). The sessions list collapses each compression chain to one row. |
| `tests/hermes_cli/test_web_server_skew_exit.py` | A Desktop-over-SSH ``serve --isolated`` backend retires itself once the install under it moved to new code: nothing on its host may restart it (only. |
| `tests/hermes_cli/test_web_server_skill_editor.py` | the dashboard skill editor endpoints and cron skill attachment. The Skills page can now create/edit custom skills (SKILL.md) and the Cron. |
| `tests/hermes_cli/test_web_server_skills_profiles.py` | dashboard profile-scoped skills/toolsets management. "Set as active" on the Profiles page only flips the sticky. |
| `tests/hermes_cli/test_web_server_speak_stream.py` | /api/audio/speak-stream — desktop streaming TTS over WebSocket. |
| `tests/hermes_cli/test_web_server_status_topology_cache.py` | the /api/status profile-topology cache. The desktop app polls /api/status ~1/s while waiting for the backend to become ready. |
| `tests/hermes_cli/test_web_server_stt_lease.py` | ``POST /api/audio/stt-lease`` — desktop voice input as STT warm-up/release. The desktop acquires a lease when the mic opens so the backend pre-loads. |
| `tests/hermes_cli/test_web_server_tts_lease.py` | ``POST /api/audio/tts-lease`` — desktop speech toggles as TTS warm-up/release. The desktop's "Read replies aloud" and voice-conversation toggles. |
| `tests/hermes_cli/test_web_server_update_status.py` | Dashboard update status reads the ROOT home's shared update.log, correlated by action. |
| `tests/hermes_cli/test_web_server_ws_ping.py` | Test that start_server configures ws-ping keepalive. The server now uses uvicorn.Server directly (not uvicorn.run) so we stub Config + Server +. |
| `tests/hermes_cli/test_web_status_watchdog_surfaces.py` | ``/api/status`` agrees with ``hermes gateway status`` on the two #113372 shapes: * PID alive but the heartbeat stamp is past the freshness TTL. |
| `tests/hermes_cli/test_web_ui_build.py` | Web launch keeps freshness/serialization but never masks a failed. |
| `tests/hermes_cli/test_web_unknown_profile_404.py` | An unknown ``?profile=`` is the profile scope's 404 on every dashboard route, never a generic 500 from a handler's. |
| `tests/hermes_cli/test_webhook_cli.py` | hermes_cli/webhook.py — webhook subscription CLI. |
| `tests/hermes_cli/test_webhook_cron_profile.py` | Webhook cron references belong to the route's profile (#139332). |
| `tests/hermes_cli/test_welcome_trial.py` | The desktop's welcome trial (``hermes_cli.welcome_trial``): who may claim it, what a claim leaves behind, which guests keep the free model, and that. |
| `tests/hermes_cli/test_whatsapp_cloud_setup.py` | the WhatsApp Cloud API setup wizard. Covers: - Field-shape validators (catch the #1 setup mistake — phone number in the Phone Number ID. |
| `tests/hermes_cli/test_whatsapp_dashboard_repair.py` | Dashboard recovery must bypass revoked credentials without losing. |
| `tests/hermes_cli/test_whatsapp_missing_runtime.py` | A successful PM preparation must still supply a runnable bridge. |
| `tests/hermes_cli/test_whatsapp_onboarding.py` | test_apply_whatsapp_onboarding_saves_pairing_policy, test_start_whatsapp_onboarding_existing_creds_returns_linked_account. |
| `tests/hermes_cli/test_whatsapp_setup_ordering.py` | ``cmd_whatsapp`` env-var write ordering. Before the fix, ``hermes whatsapp`` wrote ``WHATSAPP_ENABLED=true`` at step 2 — before. |
| `tests/hermes_cli/test_win_pty_bridge.py` | hermes_cli.win_pty_bridge — ConPTY spawning + byte forwarding. Windows-only counterpart to tests/hermes_cli/test_pty_bridge.py. |
| `tests/hermes_cli/test_windows_gateway_cold_start_desktop_lifecycle.py` | #76129: post-update Windows cold-start must not steal Desktop-owned lifecycle. A vestigial Startup/Scheduled-Task autostart is not proof the user. |
| `tests/hermes_cli/test_windows_gateway_job_teardown.py` | #48820 (4th repro): job-object teardown killed the post-update respawned gateway silently, and the updater printed "✓. |
| `tests/hermes_cli/test_windows_relaunch_ready_poll.py` | Post-update relaunch verification polls every paused target at once (#132338 review, kshitij). Each relaunched profile / unmapped gateway is retired. |
| `tests/hermes_cli/test_windows_relaunch_verify_budget.py` | Post-update gateway relaunch verification: watcher identity and liveness budget (#107002). Two invariants, both host-independent (the platform. |
| `tests/hermes_cli/test_windows_update_restart_reconciliation.py` | Regression: Windows gateway pause/resume must feed the #91277 Phase 2 plan-vs-execution reconciliation, not report a correctly-relaunched Windows. |
| `tests/hermes_cli/test_worktree.py` | git worktree isolation (CLI --worktree / -w flag). Verifies worktree creation, cleanup, .worktreeinclude handling, .gitignore management. |
| `tests/hermes_cli/test_worktree_command.py` | the CLI ``/worktree`` command handler. ``/worktree`` (Copilot CLI-inspired) inspects or creates isolated git worktrees mid-session. These. |
| `tests/hermes_cli/test_worktree_gc.py` | Behavior contracts for hermes_cli.worktree_gc (attended reclaim). Each guard gets its own contract against a REAL git repo fixture (no mocks — the. |
| `tests/hermes_cli/test_worktree_lock_old_git.py` | Worktree lock state without ``git worktree list --porcelain -z`` (git < 2.36, e.g. Ubuntu 22.04). The pruner read every lock through ``list -z``; on. |
| `tests/hermes_cli/test_worktree_pushed_tier.py` | Pushed-branch tier of the worktree pruners (#A, Aug 2026). Behavior contract: a clean worktree whose branch head EXACTLY matches what origin holds. |
| `tests/hermes_cli/test_worktree_retained_cwd_identity.py` | A retained ``--tui -w`` tree stays live when its session's stored cwd spells the same native path differently (Windows: case-insensitive, either. |
| `tests/hermes_cli/test_worktree_security.py` | Security-focused integration tests for CLI worktree setup. |
| `tests/hermes_cli/test_worktree_selfheal.py` | git self-heal: atomic worktree-add failure cleanup + pack maintenance. Regression for the Aug 2026 `hermes -w` timeout incident: 39. |
| `tests/hermes_cli/test_worktree_snapshot_prune.py` | Invariants of the snapshot-then-delete worktree sweep (``worktrees.archive_dirty``). Real git repos, real processes, no mocks: an idle. |
| `tests/hermes_cli/test_worktree_sync_base.py` | worktree base-ref resolution — branch from the fresh remote tip. A worktree created off the standalone clone's local ``HEAD`` roots the. |
| `tests/hermes_cli/test_ws_auth_display_ticket.py` | A Bot Desktop display ticket admits one RFB bridge on ``/api/display/ws`` — it must never pass as a full login on ``/api/ws`` (the reverse of. |
| `tests/hermes_cli/test_xai_curated_models.py` | xAI curated + models.dev picker-time merge. |
| `tests/hermes_cli/test_xai_model_flow.py` | test_xai_model_flow_reauth_uses_standard_radio_prompt, test_xai_model_flow_cancel_skips_reauth. |
| `tests/hermes_cli/test_xai_oauth_profile_auth.py` | xAI OAuth auth resolution in profile/cron contexts. |
| `tests/hermes_cli/test_xai_oauth_refresh.py` | test_xai_oauth_token_expiring_uses_one_hour_skew, test_xai_proactive_refresh_skew_short_lived_token. |
| `tests/hermes_cli/test_xai_oauth_writethrough.py` | xAI OAuth refresh write-through to the global root. Companion to ``test_xai_oauth_profile_auth.py``. That file covers the READ. |
| `tests/hermes_cli/test_xai_provider_labels.py` | xAI provider label disambiguation. |
| `tests/hermes_cli/test_xai_retirement.py` | hermes_cli.xai_retirement (May 15, 2026 model retirement). |
| `tests/hermes_cli/test_xiaomi_provider.py` | Xiaomi MiMo provider support. |
| `tests/hermes_cli/test_yolo_startup_order.py` | #60328: --yolo must set HERMES_YOLO_MODE in main() before _prepare_agent_startup() triggers tool imports. The freeze mechanism. |
| `tests/hermes_cli/web_routers/test_chat_ws_lease_holder.py` | The dashboard reads a resumed chat's lease holder from the HOME that chat runs in. Regression for #131172: a profile-scoped chat's TUI child claims. |
| `tests/hermes_cli/web_routers/test_codex_device_login_transient_retry.py` | Dashboard/Desktop Codex device-code login survives transient transport blips. The web-surface worker is a deliberate copy of the CLI poll loop. |
<!-- TABLE:END -->

### Tier 3 — skipped with a reason

None. Every one of the 1,708 files in the shard was opened and read: the 1,698 test modules were read as bulk tier (module docstring + the full inventory of def test_* functions, i.e. the file's stated contract and the complete list of behaviours it pins), and the 10 non-test helper modules were read in full. No file was unreadable, truncated or binary, and no file was summarised from its name alone.

---

## 2. Ideas worth stealing

1. **The receipt is a legal record, not a log line.** The updater's receipt is always finalized; a crash writes *nothing* rather than a false success; a preflight refusal is distinguishable from a failure; "success" is only permitted if the plan's accounting is complete. (`tests/hermes_cli/test_update_receipt_truthfulness.py:11`, `:21`, `:32`) — **UNIQUE**. August Trading's trade log and settlement events want exactly this shape: an outcome that the app *asserts* must be backed by the record that produced it. A "settled" trade row that no receipt justifies should be impossible to write.
2. **Approval history is implied, not ledgered.** Hermes derives "the user consented to this command" from the transcript — a dangerous-classified `terminal` call whose paired tool result is not a BLOCKED/denied/pending marker *ran with consent* — and offers those commands as an allowlist. (`tests/hermes_cli/test_approvals_suggest.py:3`, `:6`) — **UNIQUE**. August Trading can offer the same: a "log this trade" / "apply this risk rule" allowlist mined from the trade journal, with no second store to keep in sync.
3. **A dry-run verdict CLI that composes the real evaluators.** `hermes approvals test <cmd>` returns 0/1/2 by running the *production* approval evaluators, so a policy can be tested with no model in the loop. (`tests/hermes_cli/test_approvals_test.py:1-4`) — **UNIQUE**. August Trading's `services/validation` gate could expose the same shape: a CLI that answers "would this plan be allowed?" from the live gate.
4. **The document's first sentence is the contract.** Almost every one of the 1,708 files opens with a docstring that states the invariant it pins *and cites the issue number it came from*. The suite is greppable as a specification. — **UNIQUE to this repo's discipline**; August Trading's `docs/plan/` already moves in this direction, and the tests could adopt the same "one sentence + the issue id" header convention.
5. **Pin/keep as a durable veto over every bulk sweep.** A `pin` flag in the session store survives prune and archive, and the GC's edge values fail *safe*: a negative retention window matches nothing destructive (it is clamped to a future cutoff) and zero **disables** the sweep rather than deleting everything. (`tests/hermes_cli/test_sessions_pin.py:3`, `tests/hermes_cli/test_kanban_gc_retention.py:1-2`) — **UNIQUE**. August Trading's auto-archive / notebook-prune paths want a pinned flag whose semantics are specified at the extremes.
6. **"Ask only while undecided" as a product rule.** The low-disk advisor is silent when there is space, silent after a snooze, and permanently quiet after either answer — and it *says when pruning will not help*. (`tests/hermes_cli/test_prune_advisor.py:1`, `:39-45`) — **UNIQUE**. Directly transferable to August Trading's automation prompts: an automation should ask once, remember the answer, and be honest when the action would not achieve anything.
7. **Review is a state transition, never prose in a block reason.** `request_review` is first-class; repeated review requests never touch `block_recurrences` and never route to `triage`, so the false "blocked loop" escalation cannot happen. (`tests/hermes_cli/test_kanban_review_lifecycle.py:12-16`) — **UNIQUE**. August Trading's post-trade review / pattern-confirmation flow should be a real state, not a marker string inside a note.
8. **Decision tables, not snapshots.** The context-policy suite asserts *relationships* ("synthetic per-layer profiles → relationships, never exact numbers") and the model-registration suites assert *invariants* ("Invariant tests only — no list snapshots (per the no-change-detector-tests policy)"). (`tests/hermes_cli/test_context_policy.py:1-5`, `tests/hermes_cli/test_gpt56_registration.py:3-4`) — **CONVERGENT** (the same "no change-detector tests" policy appears in the model-registration, local-runtime and provider-catalog suites). August Trading's provider/model catalogue tests should follow it.
9. **Ownership beats recency for liveness.** "A never-closed cron run is live while the scheduler **OWNS** it, not while it ticked recently." (`tests/hermes_cli/test_cron_run_scheduler_ownership.py:1`) — **UNIQUE**. A scheduled strategy in August Trading should carry an owner/lease, not infer "still running" from a heartbeat timestamp.
10. **Exclusivity is a correctness property, not a capacity knob.** At most one live owner may run a given stored session, *whether or not* a concurrency cap is configured, because a second owner reasons from a transcript that excludes the first owner's in-flight turn. (`tests/hermes_cli/test_active_session_exclusivity.py:3-6`, `:10`) — **UNIQUE**. The August Trading analogue is a trade-plan or journal row that two sessions must never both own.
11. **Idle must be *proved*, not inferred.** A pooled `serve` child must prove it is idle before the Desktop may retire it. (`tests/hermes_cli/test_web_server_idle_proof.py:1`) — **UNIQUE**. Same shape as a scheduled backtest that must prove it released the trade's state before the next run claims it.
12. **Diagnostic tools exit non-zero when findings are unresolved.** `hermes doctor`'s exit status must agree with its unresolved findings. (`tests/hermes_cli/test_doctor_exit_status.py:1`) — **UNIQUE**. August Trading's Health tab has a natural CI contract here.
13. **A JSONL audit log with secrets stripped and lengths bounded.** One JSON object per line, profile-scoped, token-like kwargs dropped, every string bounded to 256 chars with a truncation marker. (`tests/hermes_cli/test_dashboard_auth_audit.py:3-5`, `:26-45`) — **UNIQUE**. This is a ready-made shape for a trading-app approval/audit trail.

---

## 3. Trading-specific findings

**Long-lived monitoring & scheduled work.** Hermes runs three *different* cadences, and the suite pins each separately:
- `hermes cron` — durable, profile-scoped jobs in a `jobs.json` store, each job carrying its own prompt, schedule, model, provider and skills (`tests/hermes_cli/test_cron.py:27`). Reliability comes from: a locked, merged writer for prompt recovery (`test_backup_cron_prompts_lock.py:1-3`); a *Dispatch line* on `cron list` that renders scheduled-vs-actual, lateness and disposition, including **catch-up** dispatches after downtime (`test_cron_dispatch_visibility.py:1-4`); and a rule that a run is live only while the scheduler *owns* it, not while it ticked recently (`test_cron_run_scheduler_ownership.py:1`). There is no "missed run" that is invisible — a late fire is a named, visible outcome.
- `/goal` — a *persistent cross-turn* objective that survives turns, is judged by a separate model call, and continues until the judge says `done`. The judge is **fail-open** so a judge bug cannot wedge progress (`tests/hermes_cli/test_goals.py:67-75`), and it can return `wait_on_pid` when the work is delegated to subagents (`test_goal_judge_delegations.py:1-3`). Quality gates are *data in the goal state* — a command, a timeout and a retry count that must pass before the goal may advance (`tests/hermes_cli/test_goal_gates.py:25-40`).
- `/loop` and `/heartbeat` — in-session recurring wakeups with a **hard interval floor** (`MIN_INTERVAL_SECONDS`, `tests/hermes_cli/test_heartbeat.py:46-49`) and a strict token grammar that refuses a bare number (`test_loops.py:64`).
- The dashboard/Desktop runs a **cron ticker** that yields to a live gateway owning cron on the same home, and ticks every local profile's store (`test_desktop_cron_ticker_gateway_standdown.py:1-3`, `test_desktop_cron_ticker_profiles.py:1-3`). That is a textbook "one owner, many observers" rule.
- *Not in this shard*: the cron scheduler's own source (`cron/`) and the gateway's cron host live outside `tests/hermes_cli/`.

**Human-in-the-loop approval.** Three layers, each with a different record:
1. *The prompt* — the interactive gate offers once and then denies; a sudo prompt restores the existing draft (`tests/hermes_cli/test_cli_approval_ui.py:1-4`).
2. *The policy* — a pluggable transport that may not widen the scope it was offered, and whose registry is cleared on reload (`tests/hermes_cli/test_approval_transport.py:1-2`).
3. *The trail* — the transcript itself is the ledger ("implied, not ledgered", `tests/hermes_cli/test_approvals_suggest.py:3`); the *auth* side keeps a separate JSONL audit log with tokens dropped and values bounded (`tests/hermes_cli/test_dashboard_auth_audit.py:3-5`); and an "Always" grant written inside a frozen managed worker still reaches `config.yaml` (`tests/hermes_cli/test_worker_first_always_grant.py:1-12`).

**Post-mortem / reflection loops.** Hermes has two, and both are rate-limited by *usage*, not by age: the **curator** archives skills by least-recently-active with view/patch/use counting as activity, and honours a durable pin (`tests/hermes_cli/test_curator_status.py:4`, `test_curator_archive_prune.py:1-3`). The **goal judge** turns a completed objective into a verdict and can gate the next one behind shell gates (`tests/hermes_cli/test_goals.py:75`, `test_goal_gates.py:25-40`). What stops bad rules accumulating: pins, a durable "keep" flag (`test_sessions_pin.py:3`), and GC windows that fail safe at the extremes (`test_kanban_gc_retention.py:1-2`).

**Multi-agent.** The kanban fleet is the reference: one dispatcher, N worker processes, a `running → review` first-class transition that is explicitly *not* a blocker (`tests/hermes_cli/test_kanban_review_lifecycle.py:12-16`), CAS-guarded by `expected_run_id` so a superseded worker cannot move the task (`:17-19`), a host-level concurrency cap with a protected review lane (`test_kanban_host_cap.py:1-3`), per-profile caps on top (`test_kanban_per_profile_cap.py:1-2`), and a PID-fingerprint guard so a recycled PID is never mistaken for the worker (`test_kanban_worker_pid_fingerprint.py:1-2`). Debate is *not* the model here: delegation is by `delegate_task`, and the parent's dock shows bounded live work (`test_subagent_monitor.py:1-2`). The suite also pins the cost of delegation: the goal judge must know about delegated children or it will nudge 4 times out of 5 (`test_goal_judge_delegations.py:1-3`).

**Structured logs the model can query.** SQLite (`state.db`) with an FTS projection and a `messages` table carrying `role`, `content`, `tool_calls`, `tool_call_id` and a timestamp. Read paths that matter: a dashboard search that merges **id matches before content matches** and de-duplicates by compression-lineage root (`test_web_server_session_search.py:6`); a title search that the FTS5 content index cannot answer, so titles are matched separately (`test_web_server_session_search_titles.py:1-3`); FTS storage upgrades that must be *discoverable* — a deployed v1 trigram projection still receives the opt-in notice (`test_fts_optimize_notice.py:1-2`); and a store that lags `SCHEMA_SQL` must stay browsable (`test_browse_schema_drift.py:1`). Retention is bounded by a durable pin, a conservative GC, and a retention backup that covers exactly the rows prune can delete (`test_sessions_export_retention.py:1-2`).

**Staying simple as features accumulate.** The repo's answer is a *file* — `hermes doctor` — plus a *registry* — `COMMAND_REGISTRY` — plus a *single owner* per concept. The suite pins that no second implementation creeps in: a stale `platform_toolsets.cli` entry must not refuse every chat (`test_cli_profile_toolsets.py:1-3`); the desktop's offline slash block-list is "a dump of `COMMAND_REGISTRY`, never hand-authored" (`test_desktop_slash_registry.py:1-2`); the gateway command-parity table "is generated from the code and must be regenerated with it" (`test_gateway_command_parity.py:1-2`); the curator's status uses "least recently active" rather than "least recently created" (`test_curator_status.py:4`); and a `doctor` that reports rather than deletes (`test_doctor_channel_hygiene.py:1-3`). The `test_sizefmt.py` file is a nice small signal: "Consolidates six near-identical formatters" — the repo actively collapses duplicates.

---

## 4. Non-obvious decisions and gotchas

1. **A test file's docstring is the requirement.** The issue number in the docstring (`#140315`, `#138812`) is the *only* pointer to the original report; the repo has 1,000+ of them. Reading the suite backwards from the issue ids is how the design intent is recovered.
2. **`"read in bulk"` is not a legal reading here.** The suite's stated bias is "the wire contract is exercised through Hermes' real client code, never mocked away" (`test_anon_auth_core.py:3-5`); a fake *server* (`anon_portal.py`) is preferred over a mock. A test that mocks the thing under test would be a style violation, not just a weak test.
3. **A failed gate defaults to DENY, and it may only offer once.** "Offer only once and deny" appears for the smart-denied callback, the session-less gate, and the sudo prompt (`test_cli_approval_ui.py:71`). A retry loop around a human prompt is a bug.
4. **The subject is the *agent*, not the *model*, that owns a row.** An AI row is claimed by identity, not by provider+model — a direct parallel to August Trading's own rule.
5. **`is_active` on a run row is a 300-second activity window, and that is explicitly NOT the truth.** The truth is scheduler ownership (`test_cron_run_scheduler_ownership.py:1`).
6. **A `0` retention window disables a sweep; it does not delete everything** (`test_kanban_gc_retention.py:2`). Negative windows are clamped to a future cutoff that matches no row.
7. **A crashed run writes *nothing*.** Not "an error record" — nothing. The absence of a receipt is the signal (`test_update_receipt_truthfulness.py:11-19`).
8. **"refused" is a third outcome, not a flavour of "failed"** (`test_update_receipt_truthfulness.py:33-35`).
9. **A pin beats a sweep; a snooze beats a prompt.** Three orthogonal "do not touch this" mechanisms: `pin` (durable, config), `snooze` (time-boxed, separate file), `auto_prune` decision (durable, config, written once).
10. **Read paths degrade, write paths refuse.** A schema-drifted store stays browsable; `hermes sessions repair` is *declarative*; `sessions optimize` refuses while another process holds the store (`test_sessions_held_store_gate.py:1-2`).
11. **Two of the deepest test files in the shard are about *file* discipline, not behaviour**: `test_config_yaml_comment_preservation.py` ("every `config.yaml` writer preserves user comments and key order", one test per writer) and `test_subprocess_text_encoding.py` ("every text-mode subprocess call in `hermes_cli` pins utf-8 decoding"). A repo that edits the user's YAML must not reformat it.
12. **"No list snapshots" is an explicit policy**, not an accident: `test_gpt56_registration.py:3-4` and `test_gpt6_tiers_registration.py:1-2` say so in those words.

---

## 5. Weak spots

1. **The suite is 1,708 files for one CLI.** At ~349k lines it is larger than most of the products it tests, and the update suite alone is 130 files. The `hermes update` machinery is far over-specified relative to its user value, and it has produced a famously long-lived "8.5k-line flow" that the tests themselves complain about (`test_update_receipt_truthfulness.py:23` — "`_cmd_update_impl` (update_cmd.py ~8331-8373, a 8.5k-line flow)"). This is the "feature count becomes the product" failure mode, visible in a repo that otherwise preaches minimalism.
2. **The docstring convention is a documentation smell in one place**: the issue-number citation is excellent for archaeology but makes the suite hard to read as a specification — a reader must strip `(#140315)` to see the requirement.
3. **The tests pin behaviour that is *arguably* wrong.** A `/loop` and a `/goal` share one persistence substrate and one DB cache, and a gate command that "passes" under `cmd.exe` is guarded only by a platform marker rather than a platform-aware runner (`test_goal_gates.py:66`). A cross-platform product that silently evaluates a POSIX gate as "passed" on Windows is a real hole.
4. **Approximations survive in the hot path.** "Liveness" is a 300-second window in more than one place, and `test_active_sessions.py` carries a "recycled PID" guard — meaning the PID identity model is known to be weak and is patched rather than replaced.
5. **There is no eval suite here** — only unit/behaviour tests. The `evals/` directory exists at the repo root but is outside this shard; the CLI suite proves *contracts*, never *quality*.





