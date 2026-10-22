# hermes-agent :: hermes-tests-tui-e2e

**Files in shard:** 595 (read: 595, skipped with reason: 0)
**What this shard covers:** the whole end-to-end / TUI-gateway test corpus of the Hermes agent
repo — 484 test modules plus 111 harness modules (`_helpers.py`, `conftest.py`, fixture servers,
`__init__.py`). Nothing here is product code: it is the *harness* that drives real Hermes
processes (CLI, `gateway.run`, `tui_gateway.entry`, `hermes serve`, `hermes dashboard`, the
Ink TUI, the ACP adapter, the cron ticker, the Kanban dispatcher, the Windows installer) against
loopback fakes, and the *invariants* those harnesses assert. This is the highest-value shard for
August Trading, because the design decisions are all about how to make an agent loop
provably terminating, provably exactly-once, and provably tenant-isolated — the three things a
trading app needs most and usually cannot show.

**Method note (honest ledger).** 25 harness modules were read *in full* (byte-for-byte, via
`Get-Content -Raw`); the remaining 86 harness modules were read at
docstring + full `def`/`class` signature level with their docstrings (the whole file was opened
and parsed — only the function *bodies* of large harness modules were not echoed); the 484 test
modules were read the same way (module docstring + every `test_*` function name + first line of
each test's docstring). `tests/tui_gateway/test_tui_gateway_server.py` (842 KB, 614 tests) was read
head + tail + a symbol outline rather than line by line. Every row in the table below is derived
from that material — no row is inferred from a filename.

---

## 1. File-by-file

### Tier 1 — load-bearing harness modules (full entries)

### `tests/e2e/core/chaos/_helpers.py`
- **Purpose:** the surface-agnostic *oracle* for agent-turn liveness — the invariants every chaos
  scenario (agent, gateway, TUI) must satisfy.
- **Key abstractions:** `chaos_config()` (writes real `config.yaml` keys: `agent.api_max_retries`,
  `agent.auto_recovery_cycles`, `agent.max_turns`, `providers.<id>.request_timeout_seconds` /
  `stale_timeout_seconds`), `hermetic_env()`, `tagged_pids()` / `wait_no_tagged()` / `kill_tagged()`,
  `unanswered_tool_calls()`, `persisted_messages()`, `integrity_ok()`.
- **Data flow:** the config text is written into a fake `$HOME/.hermes`, the child is launched with a
  fake `HOME`/`HERMES_HOME` and a `CHAOS_TAG` inherited by every descendant; the oracle then reads
  `state.db` read-only (`file:...?mode=ro`) and checks history integrity.
- **Non-obvious design decisions:** the fault lasts **an hour** while every configured deadline is
  **3–5 seconds** — so a turn still running at the deadline is provably waiting on the fault, not
  merely slow (`_helpers.py:36-44`). `MAX_PROVIDER_CALLS_PER_FAILED_TURN = 16` is the retry-storm
  ceiling (`:44`). `kill_tagged` prefers `os.pidfd_open` + `signal.pidfd_send_signal` over `os.kill`
  because the live-system guard refuses to signal a PID reparented out of the test subtree, and a
  pidfd is immune to PID reuse (`:185-213`).
- **Edge cases & failure handling:** zombies (`state == 'Z'`) are skipped by the orphan scan;
  `hermetic_env` strips every `*_API_KEY`/`*_TOKEN`/`*_SECRET` var and every `HERMES_*`/`OPENAI*`
  var so no real credential can reach a child (`:111-140`).
- **Surprising:** the oracle asserts history integrity **in both directions** — every assistant
  `tool_call` has a matching `tool` row in `state.db` *and* in the body sent back to the model
  (`:225-247`). A history that is fine on disk but broken on the wire is the classic compaction
  bug, and this oracle catches it.

### `tests/e2e/core/chaos/_tui_rpc.py`
- **Purpose:** a stdio JSON-RPC 2.0 driver for a real `python -m tui_gateway.entry` subprocess.
- **Key abstractions:** `TuiGatewayProcess` (`send` / `call` / `timed_call` / `wait_event` /
  `events_since` / `close_stdin_and_wait`), and `Heartbeat` — a thread that fires cheap existing
  RPCs on a round-robin and records round-trip latency.
- **Data flow:** one reader thread routes responses to per-id waiters and appends every
  server-pushed `{"method":"event"}` frame to a log with a monotonic timestamp and index; waits
  are condition-variable polls against a deadline, never sleeps.
- **Non-obvious design decisions:** the `Heartbeat` context manager adds the age of a still-
  in-flight call to the latency list when the window closes — "a dispatcher wedged for the whole
  turn must not look healthy by answering nothing" (`:172-215`). `close_stdin_and_wait` treats
  stdin EOF as the documented goodbye, so "the gateway must exit on its own" is testable
  (`:134-152`).
- **Edge cases & failure handling:** malformed JSON frames are collected in `self.malformed`
  instead of crashing the reader; `tail()` reconstructs the **whole** faulthandler dump from its
  "Fatal Python error" header when the child died on a signal, because a plain byte tail cuts
  exactly the frame that names the crash (`:156-171`).

### `tests/e2e/core/compaction/_helpers.py`
- **Purpose:** the lane-private harness + shared invariants for the compaction property/liveness
  suite (class C4).
- **Key abstractions:** `Scenario` (one session = one `HERMES_HOME` + `state.db` + one agent),
  `generate_transcript()` (seeded random sessions with tool pairs, parallel calls, huge single
  turns, image parts, long answers, a "tail bomb" whose single tool result exceeds the threshold),
  `job_turn()` (a cron-shaped run: ONE user message then many tool rounds), and the four
  invariants `assert_wire_request_ok`, `assert_persisted_prefix`, `assert_db_recoverable`,
  `assert_db_matches_history`.
- **Data flow:** the fake provider records each request body **and** a snapshot of the live
  `state.db` rows at request time; the four invariants then cross-check wire vs disk vs memory.
- **Non-obvious design decisions:** every compaction knob is tiny (`threshold_tokens = 12_000`)
  so "a handful of turns crosses the trigger", while `context_length` stays at the 64K agent floor
  (`:38-44`). `MAX_SUMMARY_CALLS_PER_TURN = 8` bounds the summariser (`:48`). The invariant
  `assert_wire_request_ok` explicitly checks that the **in-flight user ask appears AFTER any
  summary** — a summary that swallows the job prompt leaves the model told to "respond to the
  message below" with nothing below (`:372-410`, bug #100818).
- **Edge cases & failure handling:** `assert_db_recoverable` requires every user message to be
  either live (`active=1`) or archived as summarized history (`compacted=1`) — a retired
  (`active=0, compacted=0`) row must have an identical live/archived copy or it is **data loss**
  (`:412-445`). Tool outputs are exempt, because pruning old tool results to stubs is a designed
  lossy step.
- **Surprising:** `norm()` identifies a user message by its *seeded markers*, not its text,
  because multimodal user rows are stored as a placeholder by the turn flush but as the full
  parts list when carried — identity is the marker (`:285-306`).

### `tests/e2e/core/delivery/_cron_clock.py`
- **Purpose:** the virtual-clock harness for the ~30-virtual-day cron soak (class C13). This is the
  single most directly transferable file in the shard for August Trading's scheduled work.
- **Key abstractions:** `VirtualClock` (one epoch value in a file shared by every process of a
  scenario), `install()` (installs the virtual clock + fakes at **one** wall-clock seam), `Control`
  (the filesystem layout: `clock`, `runs.jsonl`, `sink.jsonl`, `behaviors.json`, `gates/`),
  `SchedulerHost` / `ChildHost` / `ReplicaHost`, `install_claim_barrier()`, `drain_deliveries()`,
  `ledger_rows()`, `delivery_status()`.
- **Data flow:** the virtual clock is installed at `hermes_time.datetime` (every `_hermes_now`
  binding in cron/jobs.py, scheduler.py, executions.py resolves `hermes_time.now()` at call time)
  plus the `time.time()` reads of the three cron modules. `time.monotonic` stays **real** on
  purpose — it only paces real waits (lock deadlines, heartbeat cadence) (`:242-280`).
- **Non-obvious design decisions:** the fire-claim heartbeat cadence is *time-scaled*
  (60 s → 0.05 s real) so a run spanning many virtual minutes still refreshes its lease the way a
  real one would (`:53-55`). `install_claim_barrier` parks every replica inside
  `claim_job_for_fire` until all of them arrive, "so the store CAS, not timing, decides every
  fire" (`:513-540`). Two tickers never contend for a fire because the tick lock admits one per
  instant and the winner advances `next_run_at` before releasing.
- **Edge cases & failure handling:** the harness fakes only the two things it must (the agent
  `run_job`, and the platform wire `_send_to_platform`); **everything between is production code** —
  the real ticker loop, `tick()`, due scan, pending slots, fire claims, heartbeat, executions
  ledger, the durable delivery queue (`cron/deliveries.db`) and its drain (`:16-28`). The durable
  queue's terminal verdict is the truth: `effective_outcome()` resolves a `queued` ledger row
  through the queue's own tombstone/status tables (`:626-650`).

### `tests/e2e/core/delivery/_fake_platform.py`
- **Purpose:** the C12 "messaging exactly-once" harness: a real `GatewayRunner` in a child
  process, with only the platform wire faked.
- **Key abstractions:** `FakePlatformServer` (the ground truth of what a human in the chat sees;
  every accepted effect is **fsync'd to `platform.jsonl` before the call returns**, so the journal
  survives a SIGKILL and a restarted gateway sees the same chat), `Fault` (scripted faults:
  `timeout`, `ack_lost`, `rate_limit`, `conn_error`, `hold`, `hold_after`, `pre_ledger`),
  `GatewayProcess` (`kill9()` = SIGKILL the group, `platform_view()` = the ground truth),
  `visible_copies()` (every visible rendition of an answer, complete or not).
- **Data flow:** the test drives the child over a JSON-lines TCP socket (`inject`, `fault`,
  `busy`, `adapter_id`, `reconnect`); the child runs the real `gateway.run` entry point.
- **Non-obvious design decisions:** `ack_lost` is the important fault — the platform **accepted**
  the message (it is visible) but the ack never came back — which is the case where a naive
  retry produces a duplicate the user sees twice (`:175-196`). `join_chunks()` reconstructs an
  answer that was split across several platform messages, collapsing the documented
  "continuation re-sends the broken word" overlap rather than reporting it as duplication
  (`:644-660`).
- **Edge cases & failure handling:** the journal reader tolerates a torn last line from a
  SIGKILLed writer (`:78-99`). `wait_idle` requires **three consecutive** idle polls, because a
  queued drain task can hop between checks (`:572-585`).
- **Surprising:** the harness runs the gateway in a **child process** on purpose — so the
  per-test autouse fixtures (which close every SessionDB and reset plugin singletons after each
  test) cannot interfere, one ~15 s gateway boot can serve a whole scenario matrix, and a real
  `kill -9` + restart on the same `HERMES_HOME` is possible (`:17-26`).

### `tests/e2e/core/history/_helpers.py`
- **Purpose:** the C3 transcript-ledger + C17 prompt-cache harness: what the model was sent ==
  what the model will be sent on resume == what a user sees on resume == what was billed.
- **Key abstractions:** `identity()` (the logical identity of a message *as the model sees it*),
  `views()` (model view vs display view from the DB), `assert_rows_exactly_once()`,
  `assert_exactly_once()`, `assert_replay_equals_persisted()`, `assert_no_loss()`,
  `assert_inputs_shown_once()`, `prefix_breaks()`, `assert_usage_matches()`, `Ledger`
  (cross-checks after each step), `Script` (the scripted model), `TuiGateway` (the real stdio
  server), `InProcessSession`.
- **Data flow:** one recording `FakeLLMServer` is the single observation point; every surface
  (in-process agent, `hermes chat -q` oneshot, `tui_gateway` stdio) is driven against it and the
  recorded request bodies are compared with the DB projections.
- **Non-obvious design decisions:** `prefix_breaks()` is the **prompt-cache** oracle — it finds
  the request indices where request *i* is not a byte-identical extension of request *i-1*,
  covering the tools array, the system prompt, and every earlier message; a break means the
  provider's prefix cache is being thrown away (`:214-232`). `assert_usage_matches()` requires
  `sessions` and `session_model_usage` to equal exactly what the provider billed, with cache
  reads split out of input tokens — no double count, no drop (`:299-317`).
- **Edge cases & failure handling:** the child env is an **allowlist** (`_ENV_ALLOW`), because a
  developer's shell exporting `TERMINAL_CWD` or `HERMES_SESSION_*` changes the child's prompt and
  would make a surface-switch comparison diverge for reasons outside the product (`:29-34`).
  `Script` runs callables on the provider's HTTP handler thread, where a raised assertion only
  drops the connection — so failures are collected in `self.errors` and re-raised on the test's
  own thread (`:529-560`).
- **Surprising:** the identity of a user row uses its `api_content` sidecar when present
  (surface notes, attachments), because that is the text the model actually received (`:75-92`).

### `tests/e2e/core/dashboard/_reaper.py`
- **Purpose:** the ONE place the dashboard lane cleans up processes a test left behind.
- **Key abstractions:** `adopt_orphans()` / `release_orphans()` (refcounted), `reap(*finders)`,
  `kill_identified()`, `with_home()`, `all_stats()`.
- **Data flow:** `adopt_orphans()` calls `prctl(PR_SET_CHILD_SUBREAPER)` so an orphaned descendant
  reparents to pytest instead of init and stays inside the subtree the live-system guards allow (`:49-60`).
- **Non-obvious design decisions:** nothing is *exempted* from the guard — a process that did not
  descend from this pytest process can never be adopted, so it stays refused (`:14-24`). Identity
  is `(pid, kernel start time)`, so a recycled PID is never hit (`:35`, `:140-165`). The
  leak report is returned to the caller and raised as a `SandboxLeak`, i.e. a leaked process is a
  **test failure**, not a warning.
- **Edge cases & failure handling:** zombies are reaped with `waitpid(WNOHANG)` so no zombie
  outlives the test (`:115-124`).

### `tests/e2e/core/platforms/_contract.py`
- **Purpose:** the messaging-adapter contract every real adapter must pass, through a real gateway.
- **Key abstractions:** `Rig`, `barrier()`, `wait_reply()`, `dm_gets_exactly_one_reply()`,
  `group_obeys_require_mention()`, `long_reply_is_split_in_order()`,
  `failed_continuation_is_retried_or_reported()`, `rejected_finalize_leaves_one_copy()`,
  `streamed_reply_shown_once()`, `redelivered_inbound_gets_one_reply()`,
  `approval_click_by_allowlisted_user_runs_command()`, `platform_toolsets_are_honored()`.
- **Data flow:** tokens `[in:<id>]` tie every inbound to the model turns it started, so duplicate
  or dropped turns are *counted*, never guessed (`:9-11`).
- **Non-obvious design decisions:** negative claims ("no second reply", "no turn for the
  unmentioned message") are settled by a **BARRIER** — a later inbound whose reply proves the
  gateway already processed everything queued before it — never by sleeping (`:95-120`). Open bugs
  are `Rig.gate()` blocks around a scenario's FINAL assertions only, so a bug's own signature
  xfails and anything else stays red (`:53-55`).
- **Edge cases & failure handling:** streaming scenarios run each in a private chat, and the
  same-chat barrier is re-sent if the first one is dropped while the adapter closes the streamed
  turn (#121393).

### `tests/e2e/core/tenancy/_helpers.py`
- **Purpose:** the C7 two-tenant canary harness.
- **Key abstractions:** `Tenant` (one profile: provider key, API key, env marker, model id,
  memory text, SOUL text, terminal cwd, cron prompt — all random canaries), `check_isolation()`,
  `request_leaks()`, `env_snapshots()`, `file_leaks()`, `text_leaks()`, `seed_due_cron_job()`.
- **Data flow:** each tenant owns its own loopback provider that accepts **only its own key**, so
  every recorded request is proof of *who* sent it; the shared invariant is `leaks(...) == []`.
- **Non-obvious design decisions:** the same env var **NAME** in every profile with a different
  **VALUE** — so a bleed is detectable even when the key name is right (`:9-14`). Each tenant's
  provider is a separate `FakeLLMServer`, so "the request went to the right provider" and "the
  key was the right key" are two separate facts (`:232-249`).
- **Edge cases & failure handling:** `file_leaks()` byte-scans every file of every tenant home
  (state.db + WAL, logs, sessions, config, `.env`), because a leak into a *file* is invisible to
  the provider (`:291-309`).

### `tests/e2e/core/sqlite/_helpers.py` + `tests/e2e/core/sqlite/_roles.py`
- **Purpose:** the multi-process SQLite torture chamber (issue class C1: "state.db corrupting from
  two processes").
- **Key abstractions:** `Chamber` (a private `HERMES_HOME` + `state.db` + the processes playing
  roles), and the roles themselves: `role_writer`, `role_reader`, `role_churn`, `role_opener`,
  `role_fts`, `role_repair`, `role_agent`, `role_cli`.
- **Data flow:** every role is a separate OS process opening the shared `state.db` through the
  **production** `SessionDB`, reporting through **append-only files** so a `kill -9` loses nothing
  it already reported (`_roles.py:6-9`).
- **Non-obvious design decisions:** the journal-mode arm is selected through the **production
  decision path** — the `delete` arm pins the SQLite version to a WAL-reset-vulnerable one so
  `apply_wal_with_fallback` itself picks DELETE, exactly as it does for every user on such a
  build; the harness issues no journal-mode pragma of its own (`_helpers.py:11-19`). A background
  `/proc/<pid>/fd` monitor records any `(deleted)` main-file descriptor — the kernel-level
  signature of a store swapped under a live holder — and, in WAL mode, any `(deleted)` `-wal`/
  `-shm` (`_helpers.py:21-28`).
- **Edge cases & failure handling:** `exactly_once_problems()` checks that every *acknowledged*
  append is stored exactly once, and an unacknowledged in-flight append at most once
  (`_helpers.py:419-438`); `fts_problems()` requires the FTS index to mirror canonical rows
  exactly (`docsize == source rows`) (`_helpers.py:355-389`); `busy_summary()` reports
  SQLITE_BUSY refusals as **availability**, not integrity (`_helpers.py:408-417`).

### `tests/e2e/core/cli_tmux/_classic.py`
- **Purpose:** the classic-CLI tmux harness (`display.interface: cli`).
- **Key abstractions:** `ClassicHome` (fake HOME/HERMES_HOME, allowlisted env, `run()` for
  non-TTY one-shots, `reap()`), `Pane` (one private tmux server per test, `screen()`,
  `scrollback()`, `wait()`, `settle()`, `submit()`), `home_pids()` / `kill_home_processes()`.
- **Data flow:** the CLI runs in a private tmux server (own `-L` socket) with a hermetic fake
  HOME; the test reads the screen back with `capture-pane`.
- **Non-obvious design decisions:** **stale output never counts** — every `submit`/`keys`/`launch`
  snapshots the scrollback first, and `wait` accepts a needle only when it occurs *more often*
  than in that snapshot, so an unchanged transcript (a no-op command) fails the step instead of
  matching old output (`:68-78`). Text and the submitting Enter are **separate writes** with a
  1.2 s gap, because the CLI reads an Enter processed within 50 ms of the last buffer change as a
  pasted newline (`:52-58`, `:292-306`). The process sweep reads `/proc/<pid>/environ` and kills
  **only** PIDs carrying this run's exact `HERMES_HOME` — never a pattern kill (`:76-100`).
- **Edge cases & failure handling:** the docstring warns that a container run with the host
  user's uid shares that uid with every host process, so a host-side same-uid sweep can reach the
  container's CLIs — run containers under a uid of their own (`:22-27`).

### `tests/e2e/core/terminal/_vt.py`
- **Purpose:** a dependency-free VT100/xterm screen emulator for PTY transcript assertions.
- **Key abstractions:** `Screen` (`feed`, `resize`, `display`, `main_display`, `transcript`),
  `char_width()` (wide characters).
- **Data flow:** raw PTY bytes in → a text grid out; lines that scroll off the top of the main
  screen go to `history`, exactly like xterm's scrollback; `ESC[3J` clears it.
- **Non-obvious design decisions:** a raw PTY byte dump shows **frame history** (every repaint,
  every spinner tick, every cursor-up redraw), not what the user finally sees — so "the reply
  appears exactly once" can only be judged on an emulated grid (`:4-6`). Everything unknown (SGR
  colours, OSC titles, DEC private modes other than alt-screen/autowrap, DCS/APC strings, kitty
  keyboard flags) is parsed and **ignored**, so it can never leak into the text grid (`:13-15`).
- **Edge cases & failure handling:** `resize()` mimics a terminal resize — truncate/pad lines;
  content above the new height scrolls into history (`:77-95`).

### `tests/e2e/core/tui_pty/_helpers.py`
- **Purpose:** drive a real `hermes --tui` inside a private tmux server and read what the user
  would see.
- **Key abstractions:** `TmuxTui`, `Cells` (named verdicts, each its own test id), `ledger()` /
  `ledger_problems()` (the **word ledger**: every streamed word is a unique token, so lost,
  duplicated and reordered words are told apart), `layout_problem()`.
- **Data flow:** tmux owns the grid, reflows it on resize and keeps the scrollback; the test reads
  it back with `capture-pane -S -`.
- **Non-obvious design decisions:** "every transcript word the fake provider streams is a unique
  token (`<tag>w<NNN>`)" — a *word* ledger, not a line ledger, so a lost or duplicated word is
  detectable at word granularity (`:14-16`, `:113-129`). Cleanup kills the tmux server and every
  process of the pane's **session id**, never by pattern (`:19-20`).

### `tests/e2e/core/_pending_fixes.py` + `tests/e2e/core/delivery/_pending_fixes.py`
- **Purpose:** merge-order-safe expected failures for live gaps.
- **Key abstractions:** `known_failure(pattern, reason)`, `known_gate(known, key)`, `strict_acceptance(reason)`,
  and (delivery lane) `gap_open(pr)` — a **probe**.
- **Data flow:** a cell wraps only its *final* assertions; an exception whose message matches the
  gap's own regex XFAILs the cell, any other failure propagates, and a clean pass stays a pass.
- **Non-obvious design decisions:** a plain `xfail(strict=True)` turns main red the moment its fix
  merges (XPASS), and a non-strict one guards nothing — so `known_failure` is a **run-time** xfail
  keyed on the gap's own failure message (`_pending_fixes.py:8-13`). `strict_acceptance` lets an
  integration run refuse to excuse the gap it claims to close: `HERMES_E2E_STRICT_ACCEPTANCE=1`,
  or a comma list of owners (`upd-txn`) for blocks whose reason starts with `<owner>:`
  (`_pending_fixes.py:30-40`). The delivery lane goes further: a gap with an open fix PR has a
  **probe** — a few lines that reproduce the defect's mechanism on the tree under test in a
  throwaway interpreter; the cell tolerates the gap only while the probe still reproduces it
  (`delivery/_pending_fixes.py:6-16`, `:60-88`).
- **Surprising:** the probes "exercise behaviour only (never read source text)" — a probe that
  disagrees with the end-to-end cell fails loudly instead of hiding (`delivery/_pending_fixes.py:18`).

### `tests/e2e/core/upgrade/_helpers.py`
- **Purpose:** the lane-private sandbox for the upgrade / install-integrity suites.
- **Key abstractions:** `isolated_env()`, `sandbox_argv()`, `run()`, `write_shims()`, `kill_tree()`.
- **Data flow:** every process runs in a **`bwrap` sandbox** with its own PID namespace, a tmpfs
  over `/run/user/<uid>`, the real `~/.hermes` bind-mounted read-only, and `--die-with-parent`.
- **Non-obvious design decisions:** `systemctl`/`launchctl`/`sudo`/`loginctl` **shims** are placed
  first on PATH: they log their argv and fail, so a service-restart attempt is observable and
  never reaches a real supervisor (`:9-15`). The PID namespace means the updater's process-table
  scans cannot see, let alone signal, any real gateway on the host.
- **Edge cases & failure handling:** `sandbox_required_reason()` returns *why* a test must skip
  here, or `None` when it is safe — a skip is never silent.

### `tests/e2e/core/upgrade/git/_smart_http.py`
- **Purpose:** a **real** git smart-HTTP origin on loopback, with faults the test arms on command.
- **Key abstractions:** `GitHTTPServer`, `Fault` (`status`, `cut_after`, `stall_after`), `Request`
  (method, path, v2 command, status, body bytes, fault fired), `_Reframer`.
- **Data flow:** `git http-backend` (the CGI git itself ships) runs behind a small threaded
  HTTP/1.1 server, so the client under test speaks the real wire protocol (v2 over HTTP,
  partial-clone filters, shallow negotiation, thin packs).
- **Non-obvious design decisions:** a `file://` or `--shared` origin never exercises any of that
  (`:13-14`). The `_Reframer` exists because a byte offset only means something at a fixed
  pkt-line framing: `upload-pack` relays whatever `pack-objects` has buffered, so the same pack
  arrives as 8 KiB sideband packets when it keeps up and 65520-byte ones when it lags; a cut
  inside the first coalesced packet means the client never sees the `PACK` header and never
  starts `index-pack` — so a cut/stall response is **re-framed** to the unhurried packet size
  first, and the request log records how many pack bytes the client got in *whole* packets
  before the drop (`:26-44`, `:102-158`).

### `tests/e2e/core/upgrade/handoff/_scenario.py`
- **Purpose:** one user's machine across one real `hermes update`, observed once per column.
- **Key abstractions:** `run(column, root)` (boot the fleet, update, settle, record), and
  `HandoffProperties` — **every property is its own test over that record**, gated on its own
  issue.
- **Data flow:** a manual gateway (with its cron ticker and embedded Kanban dispatcher) and a
  manual dashboard run in one shared-PID-namespace sandbox; a Kanban worker is in flight and a
  one-shot cron job comes due mid-update.
- **Non-obvious design decisions:** "the expensive part (stage, boot, update, settle) is paid
  **once per column**, not once per property" (`:8-11`) — the record is the fixture, the
  properties are the assertions. `WorkerSampler` samples the sandbox process table once a second
  to detect **overlapping worker runs of one card** — a duplicate worker (`:209-262`).
- **Edge cases & failure handling:** `cron_verdict()` and `dashboard_verdict()` return *words a
  gate can key on* rather than booleans, so a KNOWN bug can gate on its own signature
  (`:477-491`).

### `tests/e2e/core/mcp_plugins/_helpers.py`
- **Purpose:** the MCP + plugin conformance harness.
- **Key abstractions:** `E2EHome`, `script()`, `call_tool()`, `run_chat_q()`, `inbound()`,
  `calls_received()`, `tool_results()`, `KnownSymptom` / `symptom()`.
- **Data flow:** real MCP servers (built with the installed `mcp` SDK) over stdio or streamable
  HTTP; assertions read **what the MCP server received**, never what Hermes believes it sent
  (`:8-10`).
- **Non-obvious design decisions:** `script()` is **stateless per turn** — it keys on the
  request's own history (how many tool results exist this turn), so a retried request cannot
  desynchronise the script and it restarts on every new user message (`:234-249`). `call_tool()`
  calls the tool directly when offered, else through the Tool Search `tool_call` bridge
  (`:250-258`).

### `tests/e2e/core/providers/_catalog_helpers.py`
- **Purpose:** the provider-catalog E2E matrix.
- **Key abstractions:** `discover_catalog()` (runs the **real** plugin discovery in a clean child
  interpreter), `Row`, `decoy_keys()`, `drive_turn()`, `evaluate()`, `shard_rows()`.
- **Data flow:** every row is driven through the real `python -m hermes_cli.main` in a hermetic
  HOME against `CatalogFake`, redirected the way the product documents.
- **Non-obvious design decisions:** "the provider list is **never hardcoded**" — a new plugin under
  `plugins/model-providers/` joins every matrix automatically (`:4-8`). Every other provider's key
  is present as a **decoy**, and all non-loopback egress goes through a sentinel proxy, so a
  credential sent to the wrong host is *observable* (`:12-15`). `evaluate()` checks **relationships
  only** — never literals of today's output (`:309-352`).

### `tests/e2e/core/security/_redact.py`
- **Purpose:** the secret-redaction harness.
- **Key abstractions:** `Secrets`, `Scenario`, `Director`, `Sinks`, `World`, `cells()`, `check()`,
  `BoundaryBreach`.
- **Data flow:** secrets are allocated so that every scenario owns **disjoint** values — the values
  a scenario leaves raw by design (a tool argument, the user's own prompt) never coincide with the
  values another scenario asserts are masked.
- **Non-obvious design decisions:** "one Hermes home can serve every scenario and each sink is
  scanned once" (`:3-5`). `assert_harness_sane()` requires every scanned sink to actually exist —
  "a sink that is empty cannot prove absence" (`:238-245`).

### `tests/e2e/core/upgrade/network/_netedge.py`
- **Purpose:** the network edge for the hostile-network suites: every byte a sandboxed install
  sends leaves through something this module owns.
- **Key abstractions:** `TestCA`, `EdgeProxy` (HTTP/HTTPS forward proxy with TLS inspection; every
  other host is **refused with 403 and logged**), `Bridge` (host services appear inside the
  namespace on the same loopback port), `git_app`, `static_app`, `proxy_env()`.
- **Data flow:** the sandbox gets its own network namespace (`bwrap --unshare-net`, only `lo`), so
  there is no route, no DNS and no internet — egress is what the test provides, and a cell that
  expected "nothing reached pypi.org" is proven by the namespace, not by trust (`:6-9`).
- **Edge cases & failure handling:** `proxy_env()` sets **every spelling** of the proxy variables
  that curl, git, uv, npm, node and Python read (`:570-577`).

### `tests/e2e/core/upgrade/handoff/_nshost.py` + `tests/e2e/core/upgrade/handoff/_ns_agent.py`
- **Purpose:** a shared-PID-namespace sandbox where a gateway, dashboard, cron ticker, Kanban
  dispatcher and the real updater share ONE namespace, as they share one machine for a user.
- **Key abstractions:** `NamespaceHost` (`call`, `run`, `spawn`, `procs`, `close`), and the
  in-sandbox command agent (one JSON object per line in, one reply out, each request served on its
  own thread so a blocking `run` never stops the test from inspecting the process table).
- **Non-obvious design decisions:** closing the host kills the sandbox's init, which takes every
  process of the namespace with it, detached or not — "so nothing a cell starts can outlive it"
  (`_nshost.py:4-7`).

### `tests/e2e/core/tenancy/_routing_helpers.py`
- **Purpose:** the C11 routing truth table.
- **Key abstractions:** `Fleet` (K real loopback provider hosts, one per provider identity, each
  accepting only its own randomly minted key), `check_routing()`, `EgressTrap` (an HTTP(S)_PROXY
  that records every non-loopback destination and refuses it), `inference_hosts()`.
- **Data flow:** `check_routing()` is the one invariant every scenario shares: a request on a host
  the scenario did not select, or a selected host receiving any bearer other than its own, is a
  credential leak.
- **Non-obvious design decisions:** "a host that was merely not reached is a **plain failure**,
  while a leak raises `RoutingLeak`" — the two are deliberately different exception types so a
  known bug can gate one without excusing the other (`:41-52`).

### `tests/e2e/core/windows_update/_tokens.py`
- **Purpose:** standard-user tokens for the Windows install/update journeys (the runner session is
  elevated).
- **Key abstractions:** `standard_user_token()` (the runner's own token through
  `CreateRestrictedToken` with `BUILTIN\Administrators` deny-only, every privilege but
  `SeChangeNotify` dropped, medium integrity — the shape of UAC's filtered token),
  `standard_user_access()` (an AccessCheck that asks the kernel whether a standard-user token may
  open a path, **without starting anything**), `StandardUserProcess`.
- **Non-obvious design decisions:** the token "never depends on the host's SAFER policy (the
  image hands back a SAFER token with Administrators still enabled)" (`:12-14`).

### Tier 2 — bulk: one row per remaining file

The table is the ledger. Every one of the 595 shard files appears exactly once: 25 in Tier 1
above, the remaining 570 below.

| File | What it is / what it pins |
| --- | --- |
| `tests/e2e/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/conftest.py` | Shared fixtures for gateway e2e tests (Telegram, Discord). — *harness module* |
| `tests/e2e/core/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/_pm_dependencies.py` | Select prepared test dependencies for subprocesses with isolated E2E homes. — *harness module* |
| `tests/e2e/core/chaos/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/chaos/_agent_driver.py` | Child-process driver: one real AIAgent + real SessionDB, several turns, stdin control. — *harness module* |
| `tests/e2e/core/chaos/_gateway_fake_platform.py` | In-memory messaging platform for the gateway chaos suite, loaded as a REAL user plugin. — *harness module* |
| `tests/e2e/core/chaos/_gateway_harness.py` | Test-side driver for a real python -m gateway.run process with the chaos fake platform. — *harness module* |
| `tests/e2e/core/chaos/test_agent_turn_liveness.py` | C8 chaos: agent-turn liveness of a REAL AIAgent (child process) under provider and tool faults. — *2 test fns* |
| `tests/e2e/core/chaos/test_gateway_turn_liveness.py` | C8 chaos: agent-turn liveness through the REAL messaging gateway (python -m gateway.run). — *1 test fns* |
| `tests/e2e/core/chaos/test_tui_gateway_turn_liveness.py` | C8 chaos: agent-turn liveness through the REAL tui_gateway JSON-RPC subprocess. — *1 test fns* |
| `tests/e2e/core/cli_tmux/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/cli_tmux/test_classic_cli_live_session.py` | The classic CLI's long live session, with a per-process witness (#134889 T24). — *3 test fns* |
| `tests/e2e/core/cli_tmux/test_classic_cli_main_parity.py` | The classic CLI keeps main's behaviour under the one gateway: the 15-step main-vs-branch comparison. — *1 test fns* |
| `tests/e2e/core/cli_tmux/test_resize_scrollback.py` | #95375 on a reflowing terminal: resizing the classic CLI leaves every transcript line in — *1 test fns* |
| `tests/e2e/core/cli_tmux/witness/sitecustomize.py` | Per-process witness for the classic-CLI live session (test_classic_cli_live_session.py). — *harness module* |
| `tests/e2e/core/compaction/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/compaction/conftest.py` | Lane-private fixtures for the compaction suites (one fake provider per module, one session per test). — *harness module* |
| `tests/e2e/core/compaction/test_compaction_auto.py` | C4 automatic compaction: property + liveness suite on seeded random sessions (good summarizer). — *3 test fns* |
| `tests/e2e/core/compaction/test_compaction_kill9.py` | C4 compaction atomicity: kill -9 a real child process mid-compaction, then prove state.db is intact — *1 test fns* |
| `tests/e2e/core/compaction/test_compaction_manual.py` | C4 manual compaction: /compress, /compress here N and rolling micro-compaction, end to end. — *3 test fns* |
| `tests/e2e/core/compaction/test_compaction_summary_faults.py` | C4 summarizer faults: a failed summary never commits, and failure is bounded and visible. — *3 test fns* |
| `tests/e2e/core/dashboard/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/dashboard/_helpers.py` | Lane-private harness for the dashboard (hermes dashboard) E2E suite. — *harness module* |
| `tests/e2e/core/dashboard/_issue_helpers.py` | Shared bits for the dashboard lane's open-issue cells (#120527, #120937). — *harness module* |
| `tests/e2e/core/dashboard/_pty_helpers.py` | Client side of the dashboard's embedded-TUI WebSocket (/api/pty), as the browser xterm speaks it. — *harness module* |
| `tests/e2e/core/dashboard/fixture_catalog_mcp.py` | Tiny offline stdio MCP server installed through the dashboard's MCP catalog (#120527 cell). — *harness module* |
| `tests/e2e/core/dashboard/test_api_session_chat_limits.py` | #120937: session chat on the gateway API server must never silently truncate a long message. — *2 test fns* |
| `tests/e2e/core/dashboard/test_dashboard_auth.py` | Dashboard auth: every mounted /api/* route and every WebSocket route refuses a caller without — *4 test fns* |
| `tests/e2e/core/dashboard/test_dashboard_mcp_install.py` | #120527: a dashboard MCP catalog install must never wedge the web server. — *2 test fns* |
| `tests/e2e/core/dashboard/test_dashboard_profiles.py` | Profile switching through the dashboard API never crosses profiles, and a Config-page save — *3 test fns* |
| `tests/e2e/core/dashboard/test_dashboard_pty.py` | Dashboard embedded chat: the /api/pty WebSocket drives a REAL hermes --tui end to end. — *1 test fns* |
| `tests/e2e/core/dashboard/test_dashboard_sessions.py` | Dashboard session browser against a live state.db while another process writes to it. — *1 test fns* |
| `tests/e2e/core/delivery/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/delivery/test_cron_virtual_clock_soak.py` | C13 — virtual-clock soak of the REAL cron ticker loop (~30 virtual days per scenario). — *2 test fns* |
| `tests/e2e/core/delivery/test_messaging_exactly_once.py` | C12 — messaging-platform delivery exactly-once, through the REAL gateway and the REAL agent. — *8 test fns* |
| `tests/e2e/core/history/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/history/test_prefix_stability.py` | C17 prompt-cache prefix byte-stability + usage accounting across REAL processes and surfaces. — *1 test fns* |
| `tests/e2e/core/history/test_transcript_ledger.py` | C3 transcript ledger: what is persisted == what is replayed == what a resume shows, per step. — *2 test fns* |
| `tests/e2e/core/kanban/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/kanban/_helpers.py` | Real-process Kanban board harness: a scratch HOME/HERMES_HOME, the recording fake provider, and — *harness module* |
| `tests/e2e/core/kanban/test_kanban_decompose_billing.py` | Auto-decompose billing bounds, proven against a REAL hermes gateway run embedded dispatcher. — *3 test fns* |
| `tests/e2e/core/kanban/test_kanban_dispatcher_restart.py` | Dispatcher SIGKILLed mid-tick and restarted: the board keeps every real task row (#119003 class). — *2 test fns* |
| `tests/e2e/core/kanban/test_kanban_rate_limit_review.py` | A rate-limited implementer run must stay a neutral, once-billed requeue — and must not strand the — *3 test fns* |
| `tests/e2e/core/kanban/test_kanban_worker_contract.py` | Worker-side board contracts through the real dispatcher and a real hermes chat -q worker. — *3 test fns* |
| `tests/e2e/core/kanban/test_kanban_worker_sigkill.py` | Kanban worker SIGKILLed mid-run, through the real dispatcher CLI and real hermes chat -q workers. — *4 test fns* |
| `tests/e2e/core/live/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/live/_helpers.py` | Shared machinery for the secrets-gated LIVE provider canary (-m live). — *harness module* |
| `tests/e2e/core/live/test_live_providers.py` | LIVE provider canary: real AIAgent + real adapters against real vendor APIs. — *2 test fns* |
| `tests/e2e/core/mcp_plugins/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/mcp_plugins/_plugin_helpers.py` | Plugin-side helpers for the MCP + plugin suite: portable (Agent Plugins v1) packages on disk, — *harness module* |
| `tests/e2e/core/mcp_plugins/mcp_fixture_server.py` | Real MCP server (installed mcp 2.x SDK) for the MCP + plugin conformance suite. — *harness module* |
| `tests/e2e/core/mcp_plugins/test_mcp_stdio_conformance.py` | MCP conformance over stdio against a REAL mcp 2.x server (mcp_fixture_server.py). — *6 test fns* |
| `tests/e2e/core/mcp_plugins/test_mcp_streamable_http.py` | MCP over streamable HTTP against a REAL mcp 2.x server subprocess (mcp_fixture_server.py). — *5 test fns* |
| `tests/e2e/core/mcp_plugins/test_plugin_activation.py` | Plugin activation with REAL MCP servers (Agent Plugins v1 portable packages). — *10 test fns* |
| `tests/e2e/core/parity/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/parity/_boot_contract.py` | Bridge to the Desktop's real READY-sentinel parser (apps/desktop/electron/backend-ready.ts). — *harness module* |
| `tests/e2e/core/parity/_drive_acp.py` | Entrypoint driver for the parity matrix: the ACP stdio server (hermes acp). — *harness module* |
| `tests/e2e/core/parity/_drive_cli.py` | Entrypoint drivers for the parity matrix: CLI subprocess entrypoints. — *harness module* |
| `tests/e2e/core/parity/_drive_cron.py` | Entrypoint driver for the parity matrix: cron run-now (hermes cron run <id>). — *harness module* |
| `tests/e2e/core/parity/_drive_gateway.py` | Entrypoint drivers for the parity matrix: messaging gateway + OpenAI-compatible API server. — *harness module* |
| `tests/e2e/core/parity/_drive_rpc.py` | Entrypoint drivers for the parity matrix: the JSON-RPC surfaces. — *harness module* |
| `tests/e2e/core/parity/_gateway_child.py` | Lane-private child process for _drive_gateway.drive_gateway. — *harness module* |
| `tests/e2e/core/parity/_helpers.py` | Shared fixture HERMES_HOME + invariant checks for the entrypoint-parity suite. — *harness module* |
| `tests/e2e/core/parity/desktop_ready_parse.mjs` | Node shim that runs the Desktop's REAL backend-ready.ts sentinel parser over captured stdout, so the Python side asserts exactly what the Desktop would conclude (no regexing a copy of the co… — *harness module* |
| `tests/e2e/core/parity/fixture_mcp_server.py` | Tiny stdio MCP server used by the entrypoint-parity suite. — *harness module* |
| `tests/e2e/core/parity/test_boot_contract.py` | Backend boot handshake contract, Python side (issue class C5). — *2 test fns* |
| `tests/e2e/core/parity/test_entrypoint_parity.py` | Entrypoint parity matrix (issue classes C19 + C15). — *1 test fns* |
| `tests/e2e/core/parity/test_mcp_lifecycle.py` | MCP server lifecycle on the long-lived host (issue class C15). — *2 test fns* |
| `tests/e2e/core/platforms/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/platforms/_drv_discord.py` | Discord driver for the adapter contract: binds the shared contract to DiscordStandin. — *harness module* |
| `tests/e2e/core/platforms/_drv_slack.py` | Slack driver for the adapter contract: binds the shared contract to SlackStandin. — *harness module* |
| `tests/e2e/core/platforms/_drv_telegram.py` | Telegram driver for the adapter contract: binds the shared contract to TelegramStandin. — *harness module* |
| `tests/e2e/core/platforms/_helpers.py` | Harness for the messaging-adapter contract suite. — *harness module* |
| `tests/e2e/core/platforms/_suite.py` | Binds the shared contract (_contract.py) to one adapter driver for a test module. — *harness module* |
| `tests/e2e/core/platforms/test_discord_contract.py` | Messaging-adapter contract, Discord leg: the REAL gateway + REAL plugins/platforms/discord adapter. — *1 test fns* |
| `tests/e2e/core/platforms/test_discord_thread_rename_ordering.py` | Real SDK dispatch must preserve moderator names before cached callbacks run. — *1 test fns* |
| `tests/e2e/core/platforms/test_slack_contract.py` | Messaging-adapter contract, Slack leg: the REAL gateway + REAL plugins/platforms/slack adapter. — *1 test fns* |
| `tests/e2e/core/platforms/test_telegram_contract.py` | Messaging-adapter contract, Telegram leg: the REAL gateway + REAL plugins/platforms/telegram adapter. — *1 test fns* |
| `tests/e2e/core/providers/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/providers/_anthropic_helpers.py` | Hermetic rig for the Anthropic Messages wire-conformance E2E suite. — *harness module* |
| `tests/e2e/core/providers/_native_helpers.py` | Shared harness for the native-dialect provider wire suites (test_native_*.py). — *harness module* |
| `tests/e2e/core/providers/_oauth_helpers.py` | Hermetic subprocess harness for the OAuth E2E tests (fake HOME, tagged tree). — *harness module* |
| `tests/e2e/core/providers/_openai_helpers.py` | Shared harness for the OpenAI-dialect provider wire-conformance suite. — *harness module* |
| `tests/e2e/core/providers/_openai_tui.py` | Minimal stdio JSON-RPC driver for a REAL python -m tui_gateway.entry process — — *harness module* |
| `tests/e2e/core/providers/test_anthropic_compaction.py` | Anthropic Messages wire conformance: compaction in a session full of signed thinking. — *1 test fns* |
| `tests/e2e/core/providers/test_anthropic_discovery_and_aliases.py` | Anthropic route plumbing: model discovery endpoint and OAuth wire tool-name aliases. — *4 test fns* |
| `tests/e2e/core/providers/test_anthropic_errors.py` | Anthropic Messages wire conformance: documented error envelopes and stream faults. — *5 test fns* |
| `tests/e2e/core/providers/test_anthropic_oracle.py` | The SDK-oracle fake itself: it must be able to fail. — *4 test fns* |
| `tests/e2e/core/providers/test_anthropic_thinking_replay.py` | Anthropic Messages wire conformance: thinking signatures + tool pairing. — *3 test fns* |
| `tests/e2e/core/providers/test_catalog_fallback.py` | fallback_providers across the discovered catalog: a dead provider falls through to the next. — *1 test fns* |
| `tests/e2e/core/providers/test_catalog_listing.py` | Model listing and /model --provider switching per discovered provider. — *4 test fns* |
| `tests/e2e/core/providers/test_catalog_matrix_0.py` | Provider-catalog matrix, shard 0/3: one real oneshot turn per discovered provider. — *2 test fns* |
| `tests/e2e/core/providers/test_catalog_matrix_1.py` | Provider-catalog matrix, shard 1/3: one real oneshot turn per discovered provider. — *1 test fns* |
| `tests/e2e/core/providers/test_catalog_matrix_2.py` | Provider-catalog matrix, shard 2/3: one real oneshot turn per discovered provider. — *1 test fns* |
| `tests/e2e/core/providers/test_catalog_oauth.py` | Real-process E2E: OAuth / device-code providers against a loopback vendor. — *6 test fns* |
| `tests/e2e/core/providers/test_chat_custom_endpoint.py` | Custom / Ollama-style chat-completions endpoints through REAL hermes -z processes. — *2 test fns* |
| `tests/e2e/core/providers/test_chat_errors.py` | Chat-completions provider faults through REAL hermes -z processes. — *4 test fns* |
| `tests/e2e/core/providers/test_chat_reasoning_variants.py` | Chat-completions reasoning dialects through REAL Hermes processes. — *4 test fns* |
| `tests/e2e/core/providers/test_fallback_providers.py` | Provider fallback (fallback_providers) through REAL hermes -z processes. — *2 test fns* |
| `tests/e2e/core/providers/test_native_bedrock_converse_faults.py` | Bedrock Converse / ConverseStream fault semantics through the real hermes chat -q CLI. — *5 test fns* |
| `tests/e2e/core/providers/test_native_bedrock_converse_turns.py` | Bedrock Converse / ConverseStream wire conformance: tools, signed reasoning, resume, compaction. — *9 test fns* |
| `tests/e2e/core/providers/test_native_codex_app_server.py` | codex_app_server wire conformance: real hermes chat -q against a fake codex app-server. — *7 test fns* |
| `tests/e2e/core/providers/test_native_codex_app_server_faults.py` | codex_app_server faults and approval edges: real hermes chat -q against a fake codex app-server. — *7 test fns* |
| `tests/e2e/core/providers/test_native_codex_app_server_tui.py` | codex_app_server on an interactive viewer: a real hermes --tui attached to the gateway. — *1 test fns* |
| `tests/e2e/core/providers/test_native_copilot_acp.py` | Copilot ACP wire conformance, part 1: the multi-call tool flow, resume, and the process lifecycle. — *7 test fns* |
| `tests/e2e/core/providers/test_native_copilot_acp_errors.py` | Copilot ACP wire conformance, part 2: ACP error responses and agent crashes. — *2 test fns* |
| `tests/e2e/core/providers/test_native_copilot_acp_streaming.py` | Copilot ACP wire conformance, part 3: a long deep-reasoning turn must stream progress while in flight. — *1 test fns* |
| `tests/e2e/core/providers/test_native_gemini_compaction.py` | Gemini native wire conformance: auto-compaction inside a thought-signature session. — *3 test fns* |
| `tests/e2e/core/providers/test_native_gemini_errors.py` | Gemini native wire conformance: documented errors, blocked candidates and a mid-stream drop. — *3 test fns* |
| `tests/e2e/core/providers/test_native_gemini_schema.py` | Gemini native wire conformance: MCP tool schemas Google's parser rejects arrive sanitized. — *4 test fns* |
| `tests/e2e/core/providers/test_native_gemini_tools.py` | Gemini native wire conformance: the tool loop and thought-signature replay across --resume. — *3 test fns* |
| `tests/e2e/core/providers/test_native_vertex_cli_background.py` | Vertex AI through the classic CLI's gateway path: /config and /bg (#134889 T6). — *1 test fns* |
| `tests/e2e/core/providers/test_native_vertex_errors.py` | Vertex AI documented errors through the real CLI: retried per semantics or surfaced exactly once. — *5 test fns* |
| `tests/e2e/core/providers/test_native_vertex_recovery.py` | Vertex AI recovery paths: compaction in a signed reasoning session, and a mid-stream drop. — *3 test fns* |
| `tests/e2e/core/providers/test_native_vertex_tools.py` | Vertex AI wire conformance: OAuth minting, multi-turn tools, thought-signature replay after resume. — *6 test fns* |
| `tests/e2e/core/providers/test_oauth_anthropic_refresh.py` | Anthropic OAuth access token expires mid-turn: one refresh, the turn completes, the rotation persists. — *1 test fns* |
| `tests/e2e/core/providers/test_oauth_device_flow.py` | RFC 8628 device-code login: the real hermes auth add nous CLI against a fake portal. — *1 test fns* |
| `tests/e2e/core/providers/test_oauth_shared_pool.py` | Two real hermes -z processes share one auth.json pool row and hit its expiry at the same moment. — *1 test fns* |
| `tests/e2e/core/providers/test_openai_codex_pool.py` | Codex credential pool: a dead refresh grant retires only the rows tied to that grant. — *3 test fns* |
| `tests/e2e/core/providers/test_openai_pricing.py` | Model-picker pricing for a config-defined twin of a priced aggregator (#120757). — *3 test fns* |
| `tests/e2e/core/providers/test_openai_responses.py` | OpenAI Responses (Codex) wire conformance through REAL Hermes processes. — *6 test fns* |
| `tests/e2e/core/security/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/security/_helpers.py` | Shared harness for the security-boundary E2E suite. — *harness module* |
| `tests/e2e/core/security/_scope.py` | Private harness for test_profile_secret_scope.py: one real hermes serve hosting two — *harness module* |
| `tests/e2e/core/security/_traversal.py` | Private harness for the traversal sub-lane (store traversal + workspace escape). — *harness module* |
| `tests/e2e/core/security/test_approval_boundary.py` | Dangerous terminal commands need a human's approval — through the REAL terminal tool path. — *6 test fns* |
| `tests/e2e/core/security/test_attach_handshake.py` | Session-attach handshake: hermes --tui --resume SID must hand the TUI only the REAL owner's socket. — *2 test fns* |
| `tests/e2e/core/security/test_profile_secret_scope.py` | Per-profile secret scope on ONE multi-profile hermes serve host. — *3 test fns* |
| `tests/e2e/core/security/test_secret_redaction.py` | Secrets never reach disk or the next provider request through the classic CLI (hermes chat -q). — *1 test fns* |
| `tests/e2e/core/security/test_secret_redaction_gateway.py` | Secrets never reach disk, the platform, or the next provider request through the messaging gateway. — *1 test fns* |
| `tests/e2e/core/security/test_store_traversal.py` | Write-approval pending store and skill-delete guards hold against path-shaped names. — *7 test fns* |
| `tests/e2e/core/security/test_workspace_escape.py` | File tools keep the documented write sandbox, write denylist and read denylist under ../ and symlink spellings. — *5 test fns* |
| `tests/e2e/core/sqlite/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/sqlite/test_compaction_contention.py` | Compaction persistence under multi-process contention (issue class C1, "state.db corrupting from — *1 test fns* |
| `tests/e2e/core/sqlite/test_torture_chamber.py` | SQLite torture chamber: state.db integrity under real multi-process load (issue class C1). — *2 test fns* |
| `tests/e2e/core/tenancy/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/tenancy/test_routing_truth_table.py` | C11 routing truth table: every config shape users write routes the prompt AND the key to — *2 test fns* |
| `tests/e2e/core/tenancy/test_two_tenant_desktop_backend.py` | C7 two-tenant canary: ONE Desktop backend (hermes serve) serving three profiles over /api/ws. — *1 test fns* |
| `tests/e2e/core/tenancy/test_two_tenant_gateway.py` | C7 two-tenant canary: ONE multiplexed messaging gateway serving three profiles. — *1 test fns* |
| `tests/e2e/core/terminal/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/terminal/_gateway_client.py` | Real hermes serve backend + WebSocket JSON-RPC clients for the terminal lane E2E suites. — *harness module* |
| `tests/e2e/core/terminal/_pty.py` | Drive a real hermes CLI / Ink TUI process under a real PTY, rendered through :mod:._vt. — *harness module* |
| `tests/e2e/core/terminal/test_interactive_roundtrip.py` | C20 — interactive prompts (clarify / dangerous-command approval) round-trip over the REAL backend. — *1 test fns* |
| `tests/e2e/core/terminal/test_multiclient_session_model.py` | C14 — multi-client session ownership, routing and switching over the REAL backend. — *1 test fns* |
| `tests/e2e/core/terminal/test_terminal_transcript_pty.py` | C2 on terminal surfaces: what the classic CLI and the Ink TUI finally show is the transcript, — *1 test fns* |
| `tests/e2e/core/tui_pty/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/tui_pty/test_modals_resize.py` | Blocking modals and streaming tool output in the Ink TUI survive terminal resizes: the clarify — *1 test fns* |
| `tests/e2e/core/tui_pty/test_resize_ledger.py` | The Ink TUI keeps every transcript word exactly once, in order, through terminal resizes — — *1 test fns* |
| `tests/e2e/core/tui_pty/test_resume_compress.py` | A long Ink TUI session renders every transcript word at most once after /compress and — *1 test fns* |
| `tests/e2e/core/tui_pty/test_wide_chars_interrupt.py` | Wide characters and Ctrl+C in the Ink TUI keep the transcript consistent. — *1 test fns* |
| `tests/e2e/core/upgrade/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/upgrade/_install_helpers.py` | Helpers for the fresh-install / update-with-user-state / profile-update suites. — *harness module* |
| `tests/e2e/core/upgrade/git/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/upgrade/git/_git_world.py` | A real install served over real smart HTTP, and the real hermes update against it. — *harness module* |
| `tests/e2e/core/upgrade/git/test_foreign_state.py` | Concurrent and foreign git state in the install, through a real hermes update. — *5 test fns* |
| `tests/e2e/core/upgrade/git/test_hostile_commit.py` | The source swap of hermes update is one crash-safe commit point (lane LP-COMMIT). — *11 test fns* |
| `tests/e2e/core/upgrade/git/test_hostile_lock.py` | Hostile-concurrency cells for the update lock, with real hermes update processes. — *5 test fns* |
| `tests/e2e/core/upgrade/git/test_hostile_pause.py` | Linux/macOS hermes update pauses this install's gateways before the first checkout move. — *9 test fns* |
| `tests/e2e/core/upgrade/git/test_hostile_post.py` | Once hermes update has committed the new code, the update never fails (contract C3). — *6 test fns* |
| `tests/e2e/core/upgrade/git/test_local_modifications.py` | Local modifications through a real hermes update: tracked edits, untracked files, local commits. — *4 test fns* |
| `tests/e2e/core/upgrade/git/test_partial_clone.py` | Partial and full clones updated N-1 -> HEAD -> next release through the real hermes update. — *1 test fns* |
| `tests/e2e/core/upgrade/git/test_shallow_install.py` | Shallow and stale installs through the real hermes update. — *4 test fns* |
| `tests/e2e/core/upgrade/git/test_truthful_outcome.py` | Truthful outcome of hermes update when the git transport fails. — *2 test fns* |
| `tests/e2e/core/upgrade/handoff/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/upgrade/handoff/_handoff.py` | Staging for the hand-off suite: a real install at release N-1 (or HEAD), processes running — *harness module* |
| `tests/e2e/core/upgrade/handoff/conftest.py` | Fixtures for the hand-off suite. — *harness module* |
| `tests/e2e/core/upgrade/handoff/test_handoff_from_head.py` | The hand-off suite, HEAD to NEXT. — *harness module* |
| `tests/e2e/core/upgrade/handoff/test_handoff_from_n1.py` | The hand-off suite, release N-1 to HEAD. — *harness module* |
| `tests/e2e/core/upgrade/handoff/test_update_network_failure.py` | A network failure during hermes update must never take down a healthy gateway (the exit-75 — *1 test fns* |
| `tests/e2e/core/upgrade/hosts/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/upgrade/hosts/_hosts.py` | Shared staging for the host-shape suites (odd paths, PATH shapes, permissions, libc). — *harness module* |
| `tests/e2e/core/upgrade/hosts/test_hostile_pause_record.py` | The paused-gateway record survives an update that runs under a partner's claim. — *1 test fns* |
| `tests/e2e/core/upgrade/hosts/test_libc_musl.py` | Install on a musl libc host (Alpine) through the real scripts/install.sh. — *1 test fns* |
| `tests/e2e/core/upgrade/hosts/test_path_shapes.py` | Install and run on hosts whose PATH and shell startup files are not a fresh skeleton. — *3 test fns* |
| `tests/e2e/core/upgrade/hosts/test_paths.py` | Install, update, gateway and a turn in a home whose path has spaces and non-ASCII bytes. — *1 test fns* |
| `tests/e2e/core/upgrade/hosts/test_paths_symlinked.py` | Launches through a symlinked ~/.hermes and a per-task home that links back to it. — *1 test fns* |
| `tests/e2e/core/upgrade/hosts/test_permissions.py` | Install trees the running user cannot write: turns keep working, updates fail and say why. — *2 test fns* |
| `tests/e2e/core/upgrade/network/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/upgrade/network/_nsbridge.py` | First process inside the sandbox's private network namespace (run with python -I). — *harness module* |
| `tests/e2e/core/upgrade/network/_seed.py` | One real install per module, then every cell runs inside a private network namespace. — *harness module* |
| `tests/e2e/core/upgrade/network/test_mirrors.py` | Package mirrors: with a pip index mirror and an npm registry configured, nothing contacts the — *2 test fns* |
| `tests/e2e/core/upgrade/network/test_offline_and_flaky.py` | Offline and flaky networks: fail fast, loud and truthfully, or retry within bounds. — *5 test fns* |
| `tests/e2e/core/upgrade/network/test_proxy_only_egress.py` | Proxy-only egress: hermes update on a network whose ONLY way out is an HTTP(S) proxy. — *4 test fns* |
| `tests/e2e/core/upgrade/network/test_release_channel_records.py` | Stable releases: the updater follows the latest published GitHub release exactly, or refuses. — *3 test fns* |
| `tests/e2e/core/upgrade/pm/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/upgrade/pm/_pm.py` | Shared staging for the PM lifecycle suite (tests/e2e/core/upgrade/pm). — *harness module* |
| `tests/e2e/core/upgrade/pm/test_configured_features.py` | Configured features survive every dependency rebuild (PM lifecycle, failure class 1). — *4 test fns* |
| `tests/e2e/core/upgrade/pm/test_gateway_install_force.py` | The PM runtime lock is where PM commands look for it (PM lifecycle, class 6; #124075). — *2 test fns* |
| `tests/e2e/core/upgrade/pm/test_generation_gc.py` | Repeated updates and repairs don't grow the install without bound (PM lifecycle, — *2 test fns* |
| `tests/e2e/core/upgrade/pm/test_interpreter_hygiene.py` | Interpreter hygiene after an update (PM lifecycle, failure class 4). — *3 test fns* |
| `tests/e2e/core/upgrade/pm/test_interrupted_update.py` | Interrupted dependency updates recover (PM lifecycle, failure class 2). — *1 test fns* |
| `tests/e2e/core/upgrade/pm/test_restart_generations.py` | Restarts never build or accumulate dependency generations (PM lifecycle, failure class 5; #123340). — *2 test fns* |
| `tests/e2e/core/upgrade/pm/test_stamps_and_doctor.py` | Stamps, receipts and doctor tell the truth about a PM install (PM lifecycle, failure class 3). — *7 test fns* |
| `tests/e2e/core/upgrade/test_config_roundtrip_properties.py` | C18 — config and settings persistence round-trip properties. — *20 test fns* |
| `tests/e2e/core/upgrade/test_fresh_process_entrypoints.py` | C6: every shipped module and every entrypoint works in a FRESH process after an update. — *7 test fns* |
| `tests/e2e/core/upgrade/test_install_fresh.py` | Fresh install through the real scripts/install.sh into an empty HOME, then a re-run. — *2 test fns* |
| `tests/e2e/core/upgrade/test_profile_update_cron.py` | hermes profile install / hermes profile update against a real distribution with cron jobs. — *4 test fns* |
| `tests/e2e/core/upgrade/test_update_userstate_import.py` | hermes import of a broken backup archive must report failure, never "restored". — *2 test fns* |
| `tests/e2e/core/upgrade/test_update_userstate_realistic.py` | hermes update on a realistic user home: everything the user owns survives, sessions resume. — *7 test fns* |
| `tests/e2e/core/upgrade/test_upgrade_path.py` | Upgrade-path E2E: a real release N-1 git install updated to HEAD by the real hermes update. — *6 test fns* |
| `tests/e2e/core/windows/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/windows/_helpers.py` | Shared harness for the native-Windows end-to-end suite. — *harness module* |
| `tests/e2e/core/windows/_rpc.py` | Minimal stdio JSON-RPC client for python -m tui_gateway.entry — the process the Ink — *harness module* |
| `tests/e2e/core/windows/conftest.py` | Windows lane teardown: a prompt auto-starts the profile's gateway, which outlives the turn. — *harness module* |
| `tests/e2e/core/windows/test_boot_lifecycle.py` | Boot and lifecycle of the real Hermes processes on native Windows. — *4 test fns* |
| `tests/e2e/core/windows/test_cron_scripts.py` | Cron script jobs on native Windows (hermes cron create --script + hermes cron run). — *2 test fns* |
| `tests/e2e/core/windows/test_prompt_paths.py` | Prompt assembly with native Windows paths, through real Hermes processes. — *3 test fns* |
| `tests/e2e/core/windows/test_state_db_guard.py` | The state.db write-guard sees a live foreign holder on native Windows. — *1 test fns* |
| `tests/e2e/core/windows/test_terminal_tool.py` | The real terminal tool on native Windows, driven by a model turn through hermes chat -q. — *1 test fns* |
| `tests/e2e/core/windows/test_unicode_input.py` | Non-ASCII / emoji user input on native Windows reaches the model intact. — *4 test fns* |
| `tests/e2e/core/windows_update/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/e2e/core/windows_update/_machine.py` | A fresh Windows machine for the PR-time install.ps1 -> hermes update suite. — *harness module* |
| `tests/e2e/core/windows_update/test_crash_cells.py` | hermes update killed mid-flight on native Windows, then the user's next launch. — *6 test fns* |
| `tests/e2e/core/windows_update/test_damaged_checkout.py` | A checkout whose .git git rejects, on native Windows. — *3 test fns* |
| `tests/e2e/core/windows_update/test_elevated_gateway_attach.py` | A standard-user client dialing an elevated gateway's control pipe (#140706, #134889 W9). — *1 test fns* |
| `tests/e2e/core/windows_update/test_fresh_install_update.py` | Fresh source install on native Windows, then hermes update HEAD -> NEXT. — *4 test fns* |
| `tests/e2e/core/windows_update/test_gateway_across_update.py` | A running gateway across hermes update on native Windows. — *6 test fns* |
| `tests/e2e/core/windows_update/test_git_and_holders.py` | Git and process-holder edges of hermes update on native Windows. — *3 test fns* |
| `tests/e2e/core/windows_update/test_interpreter.py` | Which site-packages a Windows gateway and CLI load after an update. — *2 test fns* |
| `tests/e2e/core/windows_update/test_paths_and_acls.py` | A Windows user profile path with non-ASCII characters and a space, and tool ACLs. — *3 test fns* |
| `tests/e2e/core/windows_update/test_pause_custody.py` | Restart debt survives every custody transfer of a Windows update pause (review R7). — *6 test fns* |
| `tests/e2e/core/windows_update/test_pause_durable.py` | A killed or failed hermes update never strands — or wrongly starts — a paused gateway. — *3 test fns* |
| `tests/e2e/core/windows_update/test_update_lock_tree.py` | One hermes update owns an installed checkout on native Windows, and its whole tree. — *4 test fns* |
| `tests/e2e/core/windows_update/test_update_spares_other_installs.py` | Two Hermes installs on one Windows host: one install's hermes update leaves the other's — *2 test fns* |
| `tests/e2e/core/windows_update/test_upgrade_over_old_gateway.py` | Upgrading a real pre-#106742 install over its running gateway, elevated and not (#134889 W4). — *11 test fns* |
| `tests/e2e/test_discord_adapter.py` | Minimal e2e tests for Discord mention stripping + /command detection. — *7 test fns* |
| `tests/e2e/test_platform_commands.py` | E2E tests for gateway slash commands (Telegram, Discord). — *10 test fns* |
| `tests/e2e/test_relay_native_anthropic_stream.py` | Native Anthropic SDK streaming through Relay's managed execution path. — *1 test fns* |
| `tests/e2e/test_relay_native_openai_stream.py` | Native OpenAI SDK streaming through Relay's managed execution path. — *2 test fns* |
| `tests/tui_gateway/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/tui_gateway/_compute_host_frames.py` | Causal, thread-safe compute-host frame capture for protocol tests. — *harness module* |
| `tests/tui_gateway/_turn_marker_backend.py` | Sibling-backend child for the turn-marker cross-process race test (spawned, so importable). — *harness module* |
| `tests/tui_gateway/conftest.py` | tui_gateway test fixtures. — *harness module* |
| `tests/tui_gateway/contracts/__init__.py` | Empty package marker (0 bytes). — *harness module* |
| `tests/tui_gateway/contracts/test_generated.py` | The committed TypeScript + OpenRPC contract files are exactly what tui_gateway/contracts — *2 test fns* |
| `tests/tui_gateway/contracts/test_profile_rename_history.py` | Regression for #117696: roster rename history belongs to the wire contract. — *2 test fns* |
| `tests/tui_gateway/test_adversarial_sidecar_availability.py` | Native interactive viewers retain registered presentation sidecars. — *1 test fns* |
| `tests/tui_gateway/test_approval_cancelled_on_reap.py` | Pending gateway approvals dropped by interrupt/reap/teardown must be loud, not silent (#106678). — *9 test fns* |
| `tests/tui_gateway/test_attach_does_not_wait_for_agent.py` | Attach RPCs must not block on the deferred agent build. — *5 test fns* |
| `tests/tui_gateway/test_auto_continue.py` | Crash-interrupted turns auto-continue on the next session.resume. — *23 test fns* |
| `tests/tui_gateway/test_backend_dir_entries_preconfirmed.py` | Backend path completion must arrive at terminal_tool pre-confirmed. — *3 test fns* |
| `tests/tui_gateway/test_backend_heartbeat.py` | Tests for #94895: gateway-side heartbeat refresher wiring. — *5 test fns* |
| `tests/tui_gateway/test_background_thread_profile_scope.py` | Background threads started from a profile-scoped turn carry that profile's scope. — *2 test fns* |
| `tests/tui_gateway/test_billing_rpc.py` | Tests for the Phase 2b billing JSON-RPC methods (tui_gateway/server.py). — *1 test fns* |
| `tests/tui_gateway/test_bot_live_owner_delivery.py` | Imported turns retain their receipt and cannot bypass the local FIFO. — *3 test fns* |
| `tests/tui_gateway/test_bot_mode_silence_delivery.py` | Bot Mode never renders or relays a bare intentional-silence marker (#110782). — *2 test fns* |
| `tests/tui_gateway/test_bot_relay_methods.py` | Tests: bot_relay.* JSON-RPC handlers (tui_gateway/methods_bot_relay.py). — *11 test fns* |
| `tests/tui_gateway/test_branch_system_prompt.py` | A TUI/Desktop branch child sends the bytes its parent already sends. — *1 test fns* |
| `tests/tui_gateway/test_busy_compression_demotion.py` | Compression in flight demotes busy-mode steer/interrupt to queue (#61042). — *10 test fns* |
| `tests/tui_gateway/test_canonical_voice_events.py` | Push-to-talk events for a shared-owner session reach the client that started the capture. — *1 test fns* |
| `tests/tui_gateway/test_canonical_voice_mode_writers.py` | One voice-mode state for a shared-owner session (T9 review round 1). — *9 test fns* |
| `tests/tui_gateway/test_change_watcher.py` | The generalized change watcher (#73618): cheap on-disk signatures → — *27 test fns* |
| `tests/tui_gateway/test_change_watcher_sessions.py` | The sessions change-signature: it ignores gateway-heartbeat-only writes, changes for session metadata updates, and sees a commit inside the same mtime tick. — *3 test fns* |
| `tests/tui_gateway/test_checkpoints_config_fallback.py` | Tests for TUI/desktop checkpoint config fallback (#79625). — *14 test fns* |
| `tests/tui_gateway/test_closed_session_turn_lease.py` | A turn that reaches admission after session.close must not leave an active-session lease. — *3 test fns* |
| `tests/tui_gateway/test_codex_app_server_live_events.py` | Cross-layer regression for Codex app-server tool cards in the TUI. — *1 test fns* |
| `tests/tui_gateway/test_cold_start_gil_stall.py` | Tests for cold-start GIL stall mitigations (#60800). — *4 test fns* |
| `tests/tui_gateway/test_command_catalog_plugin_discovery.py` | commands.catalog says when its plugin discovery failed (#134889 PLG-7, CLI-13). — *3 test fns* |
| `tests/tui_gateway/test_command_description_fidelity.py` | Command descriptions survive both catalog and completion transport. — *1 test fns* |
| `tests/tui_gateway/test_compaction_status.py` | Auto-compaction status re-tagging for TUI/desktop summarizing indicators. — *8 test fns* |
| `tests/tui_gateway/test_completion_cwd_profile_fallback.py` | A pooled profile's sessions land in THAT profile's workspace (#87584). — *5 test fns* |
| `tests/tui_gateway/test_composite_carrier_rewind.py` | Regression contracts for TUI rewind of live compaction carriers. — *15 test fns* |
| `tests/tui_gateway/test_compress_lock_skip.py` | Tests for TUI gateway /compress lock-hold signalling. — *4 test fns* |
| `tests/tui_gateway/test_compress_session_cwd.py` | Manual /compress rebuilds the system prompt on the RPC thread; it must see the session's workspace. — *1 test fns* |
| `tests/tui_gateway/test_compression_config_hot_reload.py` | Desktop/TUI sessions must adopt live compression config on the next turn. — *14 test fns* |
| `tests/tui_gateway/test_compute_host.py` | The compute host (turn-isolated worker) line protocol: the hello frame on stdin and the shutdown frame. — *1 test fns* |
| `tests/tui_gateway/test_compute_host_borrowed_lease.py` | Regression tests for #101416: isolated (compute-host) turns refused their own session. — *4 test fns* |
| `tests/tui_gateway/test_compute_host_late_compress_ack.py` | Regression tests for #97948 symptom A (salvaged from #99630). — *10 test fns* |
| `tests/tui_gateway/test_compute_host_pending_model_switch.py` | Regression tests for #79509: a model switch on a compute-host (turn-isolation) — *3 test fns* |
| `tests/tui_gateway/test_compute_host_phase1.py` | Compute-host phase 1: workers inherit the TUI pool env, the host routes a relayed response and lock back to its open request, withdraws it on a parent cancel, and append-log records are sing… — *9 test fns* |
| `tests/tui_gateway/test_compute_host_routed_secret_hydration.py` | A routed compute-host session hydrates the profile's EXTERNAL secret sources before building its — *1 test fns* |
| `tests/tui_gateway/test_compute_host_turn_protocol.py` | Turn-protocol coverage for the compute host's REAL (non-seeded) frame path. — *8 test fns* |
| `tests/tui_gateway/test_config_profile_scope.py` | config.get / config.set must honor params.profile (issue #95760). — *7 test fns* |
| `tests/tui_gateway/test_config_set_display_toggles.py` | config.set has to accept the Appearance switches the desktop mirrors. — *3 test fns* |
| `tests/tui_gateway/test_config_set_session_profile_scope.py` | config.set bound by session_id alone persists into the session's profile (issue #85669). — *2 test fns* |
| `tests/tui_gateway/test_config_set_voice_chat_mode.py` | config.set voice.voice_chat_mode is how the composer's voice menu swaps engines. — *2 test fns* |
| `tests/tui_gateway/test_connector_account_surface.py` | Account-owned connector RPCs come only from the desktop Connectors page, so their gateway requests — *1 test fns* |
| `tests/tui_gateway/test_connector_accounts_rpc.py` | Named connector accounts over the real RPC dispatch. — *4 test fns* |
| `tests/tui_gateway/test_connector_operation_e2e.py` | Real-path desktop connection-operation lifecycle through the TUI gateway. — *3 test fns* |
| `tests/tui_gateway/test_connector_operation_rpc.py` | Connector operation RPCs and events over the real dispatch path. — *8 test fns* |
| `tests/tui_gateway/test_container_backend_workdir.py` | #103147: a container backend's terminal.cwd (docker /workspace) lives inside the sandbox. — *5 test fns* |
| `tests/tui_gateway/test_context_local_slash.py` | /context must be answered IN-PROCESS for a local (non-compute-host) session. — *6 test fns* |
| `tests/tui_gateway/test_credit_producer_suppression.py` | Actual response-header capture -> credit latches -> CLI/TUI presentation. — *1 test fns* |
| `tests/tui_gateway/test_cross_process_orphan_ownership.py` | Cross-process session-lease ownership: an unlimited lease is real without a cap, the orphan guard fails closed when the registry is unavailable, a desktop claim fails closed when registry se… — *13 test fns* |
| `tests/tui_gateway/test_custom_provider_session_persistence.py` | Session persistence must not strip a custom provider's identity. — *36 test fns* |
| `tests/tui_gateway/test_default_profile_session_name.py` | Default-profile session names must be derived from the home path, not its basename. — *3 test fns* |
| `tests/tui_gateway/test_deferred_lease_reaper.py` | Stale deferred active-session leases are reaped, not held forever (#62823). — *4 test fns* |
| `tests/tui_gateway/test_deferred_model_history.py` | Bounded Desktop hydration salvaged from Benjamin Brumbaugh's PR #106838. — *2 test fns* |
| `tests/tui_gateway/test_deferred_model_switch_confirm.py` | A model picked mid-turn must still get its selection-guard confirm step. — *16 test fns* |
| `tests/tui_gateway/test_delegation_session_lifecycle.py` | Fail-closed ownership + session-scoped delegation lifecycle (#55578). — *12 test fns* |
| `tests/tui_gateway/test_desktop_session_login_identity.py` | A Desktop session's state.db row must record the login that created it. — *2 test fns* |
| `tests/tui_gateway/test_desktop_session_row_git_meta.py` | A Desktop session's lazily created row must get git_branch/git_repo_root (#108784). — *3 test fns* |
| `tests/tui_gateway/test_desktop_session_workspace_persistence.py` | Desktop-provided project workspaces remain durable session metadata (#108205). — *3 test fns* |
| `tests/tui_gateway/test_detached_loop_keepalive.py` | A detached Desktop/TUI session that owns an active /loop must survive the orphan reapers. — *8 test fns* |
| `tests/tui_gateway/test_detached_process_notify_keepalive.py` | A detached Desktop/TUI session waiting on a background process's completion notice must survive the reapers. — *18 test fns* |
| `tests/tui_gateway/test_diagnostic_notification_presentation.py` | Diagnostic wake execution and structured controls survive a presentation veto. — *2 test fns* |
| `tests/tui_gateway/test_diagnostic_turn_end_to_end.py` | Diagnostic wake exercises the actual TUI turn, event transport, and control callback. — *3 test fns* |
| `tests/tui_gateway/test_diagnostics_share_nous.py` | diagnostics.share_nous RPC — Desktop "Send Diagnostics" upload path. — *7 test fns* |
| `tests/tui_gateway/test_display_methods.py` | display.install runs its worker inside the caller's profile scope; display.observe mints the viewer identity. — *9 test fns* |
| `tests/tui_gateway/test_display_watch.py` | Lease transitions made by ANOTHER process reach hermes serve clients as display.lease. — *5 test fns* |
| `tests/tui_gateway/test_eager_multiplex_activation.py` | Eager multi-profile activation: when a host arms the fail-closed secret guard, and when it must not. — *5 test fns* |
| `tests/tui_gateway/test_empty_fast_status.py` | config.set fast status reports "normal" for an explicit-normal pin. — *1 test fns* |
| `tests/tui_gateway/test_entry_home_ownership.py` | The standalone stdio entry is never a second state.db writer beside a gateway. — *1 test fns* |
| `tests/tui_gateway/test_entry_import_off_main_thread.py` | Regression test: importing tui_gateway.entry off the main thread must not crash. — *1 test fns* |
| `tests/tui_gateway/test_entry_inline_handler_error.py` | Regression coverage for stdio inline-handler failures (#112816). — *1 test fns* |
| `tests/tui_gateway/test_entry_picker_prewarm.py` | Regression test: the stdio TUI entry point prewarms the /model picker cache. — *2 test fns* |
| `tests/tui_gateway/test_entry_rpc_stdin_cloexec.py` | Regression coverage for the stdio gateway's child-process boundary. — *1 test fns* |
| `tests/tui_gateway/test_entry_sys_path.py` | Regression test for tui_gateway/entry.py sys.path hardening (#15989, #51286). — *1 test fns* |
| `tests/tui_gateway/test_ephemeral_profile_override.py` | Regression tests: profile HERMES_HOME override in ephemeral agent threads (#50233). — *4 test fns* |
| `tests/tui_gateway/test_external_process_picker.py` | A user-installed external_process provider must survive shared picker discovery and native selection. — *2 test fns* |
| `tests/tui_gateway/test_failed_agent_build_retry.py` | A failed agent build must not wedge the session. — *2 test fns* |
| `tests/tui_gateway/test_failed_turn_retention.py` | Failed turns must retain a replayable inflight snapshot. — *12 test fns* |
| `tests/tui_gateway/test_fallback_chain_hot_reload.py` | Desktop/TUI sessions must adopt a fallback_providers chain added after the chat was opened. — *2 test fns* |
| `tests/tui_gateway/test_fanout_burst_batching.py` | The per-peer fanout drain sends what is queued as ONE batch on the socket's loop, not one — *2 test fns* |
| `tests/tui_gateway/test_fanout_send_membership.py` | Session detach revokes queued fanout frames without closing a shared socket. — *3 test fns* |
| `tests/tui_gateway/test_fast_session_scope.py` | Fast-mode (service tier) session scoping in the TUI gateway (desktop backend). — *11 test fns* |
| `tests/tui_gateway/test_file_attachment_allocation.py` | File attachment uploads retain their bytes in the shared profile namespace. — *4 test fns* |
| `tests/tui_gateway/test_finalize_session_cancels_background_review.py` | Regression for #102895: deleting/closing a session must stop its — *4 test fns* |
| `tests/tui_gateway/test_finalize_session_persist.py` | Session finalize persistence: memory commit still runs, an already-finalized session is skipped, an unflushed turn survives a disconnect, and a resumed session is not reflushed as duplicates… — *5 test fns* |
| `tests/tui_gateway/test_first_contact_onboarding.py` | Desktop/TUI first-contact profile-build onboarding via tui_gateway (#82750). — *5 test fns* |
| `tests/tui_gateway/test_foreground_notification_snapshot.py` | Foreground decisions stay stable through file changes and child callbacks. — *3 test fns* |
| `tests/tui_gateway/test_free_tier_rpc.py` | free_tier.status / free_tier.ack_notice (pull) and the free-tier branch of billing.state, — *10 test fns* |
| `tests/tui_gateway/test_free_tier_task_done.py` | A finished task on the free tier: a turn that completed on its own with a reply arms the sign-in — *4 test fns* |
| `tests/tui_gateway/test_gateway_bootstrap_control_home.py` | Ink bootstrap must acquire a served secondary's ticket from its multiplexer control home. — *1 test fns* |
| `tests/tui_gateway/test_gateway_bootstrap_recover.py` | Ink reconnect re-ensures an owner that is gone, however it went (W11, P2). — *5 test fns* |
| `tests/tui_gateway/test_gateway_owned_session_reap.py` | Tests for #60609: the TUI backend must not end gateway-owned sessions. — *5 test fns* |
| `tests/tui_gateway/test_goal_command.py` | Tests for /goal handling in tui_gateway. — *12 test fns* |
| `tests/tui_gateway/test_groups_methods.py` | Tests for the gateway-hosted groups.* JSON-RPC contract. — *28 test fns* |
| `tests/tui_gateway/test_groups_replication_methods.py` | Tests for the groups.replicate / groups.promote / groups.demote — *4 test fns* |
| `tests/tui_gateway/test_gui_surface_toolsets.py` | GUI capability follows the SESSION's client, not the backend's process env. — *12 test fns* |
| `tests/tui_gateway/test_heartbeat_tui_tick.py` | /heartbeat firing from the TUI/Desktop session-owner process (#102056, #103044). — *5 test fns* |
| `tests/tui_gateway/test_heartbeat_wakes.py` | A background-process heartbeat is a wake for the model, not a message from the user. — *2 test fns* |
| `tests/tui_gateway/test_history_identity.py` | Repeated content cannot stand in for persisted transcript identity. — *3 test fns* |
| `tests/tui_gateway/test_history_inline_images.py` | inline_images=false history reads (#116511): the reachable [image] projection. — *4 test fns* |
| `tests/tui_gateway/test_hosted_file_publication.py` | Service share and raced publication preserve the original durable task. — *2 test fns* |
| `tests/tui_gateway/test_hosted_room_attachment_routes.py` | A member turn with a bound file must not reach a route that cannot carry it. — *4 test fns* |
| `tests/tui_gateway/test_hosted_room_driver_runtime.py` | Runtime tests for the hosted-room session adapter. — *40 test fns* |
| `tests/tui_gateway/test_hosted_room_error_logging.py` | Hosted task diagnostics persist fixed reason codes, never exception bodies. — *2 test fns* |
| `tests/tui_gateway/test_hosted_room_frozen_publication.py` | Frozen admissions reconstruct from canonical storage, not display caches. — *1 test fns* |
| `tests/tui_gateway/test_hosted_room_member_activity_hook.py` | on_room_member_activity: a room member's hidden-session runtime events reach plugins with room — *2 test fns* |
| `tests/tui_gateway/test_hosted_room_member_submit.py` | The driver must name the member on every submit it hands to a transport. — *2 test fns* |
| `tests/tui_gateway/test_hosted_room_peer_http.py` | Scoped peer Runs adapter tests. — *25 test fns* |
| `tests/tui_gateway/test_hosted_room_peer_transport.py` | Peer transport tests for hosted-room member turns. — *10 test fns* |
| `tests/tui_gateway/test_hosted_room_policy_upgrade.py` | Late-receipt indexing upgrades derived caches, never accepted inputs or history. — *2 test fns* |
| `tests/tui_gateway/test_hosted_room_prompt_fence.py` | Older Desktop clients cannot start a second driver for hosted rooms. — *6 test fns* |
| `tests/tui_gateway/test_hosted_room_server_rpc.py` | Tests for the in-process hosted room session adapter. — *5 test fns* |
| `tests/tui_gateway/test_hosted_room_service.py` | Integration tests for the hosted Discussion coordinator. — *32 test fns* |
| `tests/tui_gateway/test_hosted_room_settled_retry.py` | Deferred results survive discussion and bounded-transcript cleanup. — *1 test fns* |
| `tests/tui_gateway/test_hosted_room_turn_slot_release.py` | A hosted room member turn releases the profile's bot_room active-session slot when it ends. — *2 test fns* |
| `tests/tui_gateway/test_hosted_room_two_gateway_scoped.py` | Scoped grant UAT: home service to a real peer API adapter, no Desktop. — *1 test fns* |
| `tests/tui_gateway/test_hud_surface_note.py` | HUD mode reaches the model as a per-turn note, not as a platform hint. — *16 test fns* |
| `tests/tui_gateway/test_human_input_hooks_tui.py` | The Ink TUI / Desktop sudo card fires the human-input hook pair without the typed password (#132333). — *1 test fns* |
| `tests/tui_gateway/test_i18n_methods.py` | i18n.languages lists bundled + pack languages; i18n.catalog returns the pack/overlay layer per — *2 test fns* |
| `tests/tui_gateway/test_image_history_display.py` | Native image history projection regression for #120083. — *4 test fns* |
| `tests/tui_gateway/test_image_ref_message.py` | Desktop image submit path must never block on vision calls (#83291). — *3 test fns* |
| `tests/tui_gateway/test_image_routing_stale_model.py` | Regression coverage for live TUI image-routing identity. — *2 test fns* |
| `tests/tui_gateway/test_init_targets_session_cwd.py` | /init on the TUI/desktop surface must target the SESSION's active directory. — *2 test fns* |
| `tests/tui_gateway/test_ink_helper_dependencies.py` | Ink's Python helpers boot PM's committed dependency generation themselves (regression for #138878). — *6 test fns* |
| `tests/tui_gateway/test_inline_rpc_gil_starvation.py` | Tests for tui_gateway inline-RPC pool routing under GIL pressure (#50005). — *1 test fns* |
| `tests/tui_gateway/test_interim_assistant_callback.py` | Tests for the interim_assistant_callback config gating in tui_gateway. — *1 test fns* |
| `tests/tui_gateway/test_interrupt_agent_loop_stopped_hook.py` | The TUI/desktop session.interrupt path is a sibling of the gateway's — *4 test fns* |
| `tests/tui_gateway/test_interrupt_dead_compute_host.py` | session.interrupt on a compute host that is gone (hermes-agent 82603). — *5 test fns* |
| `tests/tui_gateway/test_interrupt_does_not_wait_for_agent.py` | session.interrupt must not wait on, or start, the deferred agent build (#133262). — *4 test fns* |
| `tests/tui_gateway/test_iso_certify_seam.py` | The AC-4 synthetic heavy-turn agent (tui_gateway/synthetic_turn.py) is a — *1 test fns* |
| `tests/tui_gateway/test_isolated_orphan_activity.py` | Detached Desktop/TUI turns use child-owned activity, not process heartbeats. — *1 test fns* |
| `tests/tui_gateway/test_kanban_notify_poller.py` | Tests for the TUI-side kanban notification poller (issue #59890). — *12 test fns* |
| `tests/tui_gateway/test_kanban_resume_guard.py` | Gateway/desktop session.resume must refuse a Kanban worker transcript (#68779). — *2 test fns* |
| `tests/tui_gateway/test_launch_db_home_override_race.py` | Regression for #102526. — *9 test fns* |
| `tests/tui_gateway/test_launch_home_isolation.py` | The launch home the TUI server binds launch-profile turns to must follow the process home. — *1 test fns* |
| `tests/tui_gateway/test_launch_profile_scope_plugin_hooks.py` | Plugin hooks fired from a launch-profile turn see a bound profile scope under multiplexing. — *2 test fns* |
| `tests/tui_gateway/test_lazy_session_regressions.py` | Reproduction tests for #18370 fallout: lazy session creation regressions. — *6 test fns* |
| `tests/tui_gateway/test_legacy_events_since_replay_epoch.py` | Legacy session.events.since replays a reconnect that includes replay_epoch. — *4 test fns* |
| `tests/tui_gateway/test_legacy_fallback_profile_scope.py` | B11: a ticket bound to a secondary profile reads ITS profile through the legacy session fallback. — *1 test fns* |
| `tests/tui_gateway/test_legacy_fallback_ticket_profile_verbs.py` | N86: every legacy-fallback verb from a ticket bound to a secondary profile runs in THAT profile. — *2 test fns* |
| `tests/tui_gateway/test_legacy_paste_profile_home.py` | A legacy paste.collapse on the shared owner writes under the ticket's profile home. — *1 test fns* |
| `tests/tui_gateway/test_legacy_submit_forwards_to_owner.py` | RT-37 (#140385): a Desktop prompt on a session whose gateway owner is running a turn (a Bot Chat — *8 test fns* |
| `tests/tui_gateway/test_legacy_turn_canonical_barrier.py` | Standalone serve (no session authority) must not run a legacy turn past the gateway's — *1 test fns* |
| `tests/tui_gateway/test_live_config_context_pin_mirror.py` | Desktop/TUI config hot-reload must keep the agent's cached context pin in step with the compressor's. — *3 test fns* |
| `tests/tui_gateway/test_local_model_session_identity.py` | A local selection must survive session.info, a new chat and stored-session resume. — *7 test fns* |
| `tests/tui_gateway/test_loop_command.py` | Tests for /loop handling in tui_gateway. — *8 test fns* |
| `tests/tui_gateway/test_machine_facts_rpc.py` | machine.facts answers the host summary through the registered handler and its contract, and — *2 test fns* |
| `tests/tui_gateway/test_main_merge_projections.py` | Extracted discovery and snapshot projections retain main's wire contracts. — *1 test fns* |
| `tests/tui_gateway/test_make_agent_personality_prompt.py` | _make_agent resolves ephemeral prompt from display.personality. — *2 test fns* |
| `tests/tui_gateway/test_make_agent_prefill.py` | Desktop/TUI agents honor prefill_messages_file from the active profile. — *1 test fns* |
| `tests/tui_gateway/test_make_agent_provider.py` | Regression test for #11884: _make_agent must resolve runtime provider. — *3 test fns* |
| `tests/tui_gateway/test_manual_compress_history_fence.py` | Manual compression must not publish a snapshot invalidated before lease admission. — *2 test fns* |
| `tests/tui_gateway/test_mcp_late_refresh_thread_owner.py` | Regression test for issue #51587. — *2 test fns* |
| `tests/tui_gateway/test_mcp_oauth_cancel.py` | Cancellation wakes the actual callback worker without crossing profile ownership. — *3 test fns* |
| `tests/tui_gateway/test_mcp_oauth_client_callback.py` | Tests for the client-side callback (remote-backend) variant of the — *11 test fns* |
| `tests/tui_gateway/test_mcp_profile_rpcs.py` | E2E tests for the per-profile MCP lifecycle RPCs (mcp.servers.*). — *17 test fns* |
| `tests/tui_gateway/test_mcp_reload_all_sessions.py` | reload.mcp refreshes the tool snapshot of EVERY live session, not only the requester's. — *5 test fns* |
| `tests/tui_gateway/test_mcp_reload_rev.py` | reload.mcp revision-aware coalescing (review on #20379, finding 1). — *5 test fns* |
| `tests/tui_gateway/test_moa_reference_emit.py` | Tests for the TUI gateway relaying MoA reference events to the client. — *1 test fns* |
| `tests/tui_gateway/test_model_options_profile_scope.py` | model.options binds the requested profile's home, not the launch home. — *1 test fns* |
| `tests/tui_gateway/test_model_rpc_skew_guard.py` | #99859 (R2): the TUI gateway's model-serving JSON-RPCs refuse on code skew. — *3 test fns* |
| `tests/tui_gateway/test_model_switch_marker_role.py` | Tests for _append_model_switch_marker role fix (issue #48338). — *5 test fns* |
| `tests/tui_gateway/test_model_switch_reasoning_flag.py` | config.set model "X --reasoning <level>" on the TUI gateway: the effort rides with the pick. — *2 test fns* |
| `tests/tui_gateway/test_multi_client_fanout.py` | Shared-session routing and backpressure, exercised through real OS pipes. — *4 test fns* |
| `tests/tui_gateway/test_multi_profile_hosting_fail_closed.py` | Multi-profile hosting in the TUI gateway is fail-closed and every profile-scoped RPC runs under — *9 test fns* |
| `tests/tui_gateway/test_multi_profile_hosting_transitions.py` | Serve / dashboard profile scopes stay authoritative across the first-secondary transition. — *4 test fns* |
| `tests/tui_gateway/test_none_agent_turn_guard.py` | A turn must never run against a session record whose agent is None. — *3 test fns* |
| `tests/tui_gateway/test_notification_admission_refusal.py` | A refused legacy turn is not a completion delivery receipt. — *1 test fns* |
| `tests/tui_gateway/test_notification_refusal_backoff.py` | Refused producer turns must not hot-loop against the canonical ledger (#140385). — *2 test fns* |
| `tests/tui_gateway/test_notification_turn_release.py` | A notification that claims the session's turn must hand it back whenever no turn runs. — *4 test fns* |
| `tests/tui_gateway/test_onboarding_e2e.py` | First-run onboarding end to end through the gateway's real card path: setup_beat runs in the agent's — *3 test fns* |
| `tests/tui_gateway/test_onboarding_endings.py` | Deleting the onboarding chat: the run ends only once the delete succeeded, on every compression copy. — *4 test fns* |
| `tests/tui_gateway/test_onboarding_fresh_launch.py` | Closing the app before onboarding finishes does not count: the next launch's onboarding.start — *3 test fns* |
| `tests/tui_gateway/test_onboarding_run_rpc.py` | onboarding.state / onboarding.set_run read and write the ROOT profile's config.yaml, even — *6 test fns* |
| `tests/tui_gateway/test_onboarding_session.py` | The onboarding chat in the gateway: onboarding.start / onboarding.state / onboarding.skip, — *18 test fns* |
| `tests/tui_gateway/test_onboarding_welcome_claim.py` | onboarding.state / onboarding.start and the desktop's welcome trial: a new run on a first — *11 test fns* |
| `tests/tui_gateway/test_out_of_band_history_adoption.py` | Regression for #42962: a turn another surface (Telegram, cron) appended to a live desktop/TUI session must — *11 test fns* |
| `tests/tui_gateway/test_pending_hidden_consumption.py` | Regression for #116126: a session born hidden stays un-hidden once the user un-hides it. — *1 test fns* |
| `tests/tui_gateway/test_personality_clobbers_system_prompt.py` | Reproduction: /personality (desktop config.set) clobbers agent.system_prompt. — *1 test fns* |
| `tests/tui_gateway/test_ping_probe.py` | Tests for the ping liveness probe (tui_gateway/server.py). — *1 test fns* |
| `tests/tui_gateway/test_plugin_inject_host.py` | Plugin inject_message reaches the Ink TUI / desktop session it names. — *6 test fns* |
| `tests/tui_gateway/test_plugin_skill_slash.py` | Plugin-registered skills in the TUI/Desktop slash menu (/plugin:skill). — *1 test fns* |
| `tests/tui_gateway/test_plugins_catalog_lookup.py` | plugins.catalog.lookup: the deep link's catalog lookup, resolved by the backend (hermes-agent 136483). — *5 test fns* |
| `tests/tui_gateway/test_plugins_manage_install.py` | Gateway plugins.manage install action. — *5 test fns* |
| `tests/tui_gateway/test_plugins_manage_late_activation.py` | #87770 — a Desktop/TUI plugins.manage install is a mid-run load path too: the install performs a REAL — *1 test fns* |
| `tests/tui_gateway/test_plugins_manage_remove.py` | Gateway plugins.manage remove — the Desktop Plugins hub's Uninstall door. — *2 test fns* |
| `tests/tui_gateway/test_plugins_manage_settings.py` | Gateway plugins.manage — manifest config_schema rendered as settings fields (#46600, #87934). — *3 test fns* |
| `tests/tui_gateway/test_pre_agent_fallback_notice.py` | A TUI/Desktop agent built on a credential-resolution fallback (primary AuthError -> fallback_providers — *3 test fns* |
| `tests/tui_gateway/test_preview_action_bridge_fail_fast.py` | A desktop client that cannot answer the preview.act server request must not — *10 test fns* |
| `tests/tui_gateway/test_profile_db_readonly.py` | Foreign-profile _profile_db handles must not write-lock another profile's live store. — *5 test fns* |
| `tests/tui_gateway/test_profile_rebuild_commit.py` | Session-only tools ingress and rebuild failure preserve profile isolation. — *4 test fns* |
| `tests/tui_gateway/test_profile_resume_cwd.py` | A resumed session for a NAMED profile lands in THAT profile's workspace (#87584). — *3 test fns* |
| `tests/tui_gateway/test_profile_resume_cwd_persist.py` | Every session.resume path repairs a named profile's saved workspace (#87584). — *1 test fns* |
| `tests/tui_gateway/test_profile_roster_reader_cache.py` | The canonical gateway's roster memo (cached_reader_session_fields, #139227) keys on the reader — *1 test fns* |
| `tests/tui_gateway/test_profile_shell_hooks.py` | Profile-bound agent construction must arm real shell policy. — *1 test fns* |
| `tests/tui_gateway/test_profile_target_unavailable.py` | An unavailable explicit target must never become the launch profile. — *4 test fns* |
| `tests/tui_gateway/test_profile_terminal_scope_entrypoints.py` | Terminal-scope invariants for the TUI gateway's off-turn profile entrypoints under multiplexing. — *4 test fns* |
| `tests/tui_gateway/test_profiles_configure.py` | profiles.describe / profiles.configure use the MCP enabled key the runtime reads. — *2 test fns* |
| `tests/tui_gateway/test_profiles_configure_model_guard.py` | profiles.configure honours the model selection guard (#95293 remainder). — *4 test fns* |
| `tests/tui_gateway/test_profiles_create_env_refs.py` | A bot created from the launch profile gets its ${VAR} refs, never their resolved values. — *1 test fns* |
| `tests/tui_gateway/test_profiles_describe_secret_scope.py` | profiles.describe / profiles.configure resolve credentials from the described profile's scope. — *1 test fns* |
| `tests/tui_gateway/test_profiles_inherit_launch_model.py` | profiles.create inherits the launch profile's model together with the custom gateway backing it. — *3 test fns* |
| `tests/tui_gateway/test_profiles_list_canonical_session.py` | Tests: profiles.list canonical_session registry summaries. — *29 test fns* |
| `tests/tui_gateway/test_profiles_list_session_field_cache.py` | profiles.list reuses a profile's session fields only while its session store has not moved. — *5 test fns* |
| `tests/tui_gateway/test_profiles_list_ui_meta_cache.py` | profiles.list re-parses a profile's profile.yaml for ui_meta only when it has changed. — *2 test fns* |
| `tests/tui_gateway/test_profiles_list_worker_session.py` | Tests: profiles.list worker_session (freshest kanban/tool worker). — *3 test fns* |
| `tests/tui_gateway/test_profiles_toolset_pin.py` | profiles.configure enabled_toolsets must pin the key the runtime reads. — *3 test fns* |
| `tests/tui_gateway/test_profiles_ui_meta_cas.py` | Gateway-owned revisions for concurrent profile UI metadata updates. — *4 test fns* |
| `tests/tui_gateway/test_project_tree.py` | Invariants for the authoritative project-tree builder (tui_gateway.project_tree). — *38 test fns* |
| `tests/tui_gateway/test_projects_rpc.py` | Tests for the projects.* JSON-RPC methods on the tui_gateway server. — *26 test fns* |
| `tests/tui_gateway/test_prompt_accept_logging.py` | Desktop/TUI turn-dispatch observability (#86647). — *2 test fns* |
| `tests/tui_gateway/test_protocol.py` | Tests for tui_gateway JSON-RPC protocol plumbing. — *61 test fns* |
| `tests/tui_gateway/test_provider_not_configured_code.py` | A session that cannot start for lack of a provider says so in a machine-readable way. — *5 test fns* |
| `tests/tui_gateway/test_queued_prompt_persistence.py` | A prompt accepted while the agent is busy is durable at ACCEPT time. — *9 test fns* |
| `tests/tui_gateway/test_queued_prompt_restart_retire.py` | A restart discards the in-memory busy-queue, but the accept-time user row it wrote stays — *4 test fns* |
| `tests/tui_gateway/test_readiness_singleflight.py` | Overlapping readiness polls must not saturate the shared RPC pool (#65151). — *5 test fns* |
| `tests/tui_gateway/test_reap_respects_canonical_ledger.py` | A viewer's reap never stamps a session ended while the gateway's ledger holds its turn (#140642). — *3 test fns* |
| `tests/tui_gateway/test_reaper_flush_profile_scope.py` | The reaper/exit-flush transcript persistence: right home, no external-secret hydration. — *2 test fns* |
| `tests/tui_gateway/test_reasoning_config_per_model.py` | Tests for per-model reasoning_effort override in TUI gateway _load_reasoning_config. — *4 test fns* |
| `tests/tui_gateway/test_reasoning_session_scope.py` | Reasoning-effort session scoping in the TUI gateway (desktop backend). — *12 test fns* |
| `tests/tui_gateway/test_relay_live_author.py` | A relayed dm into a live Bot Chat keeps its sender all the way into run_conversation. — *5 test fns* |
| `tests/tui_gateway/test_remote_backend_launch_cwd.py` | A TUI/dashboard session on a sandbox backend never sends the gateway's launch directory to the sandbox. — *15 test fns* |
| `tests/tui_gateway/test_restored_delegation_transport.py` | A completion replayed at process start requires a real notification consumer (#138348). — *1 test fns* |
| `tests/tui_gateway/test_resume_child_run_profile_scope.py` | The child-run liveness registry must be profile-scoped on the resume path. — *2 test fns* |
| `tests/tui_gateway/test_resume_live_lazy_session.py` | Tests: session.resume finds LIVE lazy (never-persisted) sessions. — *5 test fns* |
| `tests/tui_gateway/test_resume_live_profile_scope.py` | session.resume reuses a live session only within the requested profile. — *2 test fns* |
| `tests/tui_gateway/test_resume_profile_scope.py` | session.resume resolves a stored session's provider overrides under the SESSION profile's scope. — *2 test fns* |
| `tests/tui_gateway/test_resume_readonly_mount.py` | Mounting a finalized session is read-only (#85303): session.resume / its deferred — *6 test fns* |
| `tests/tui_gateway/test_resume_session_yolo.py` | A session /yolo (TUI Shift+Tab, the Desktop zap) survives a backend restart: persisted on the session — *1 test fns* |
| `tests/tui_gateway/test_resume_switched_provider_endpoint.py` | A chat switched to another provider must resume on THAT provider's endpoint. — *3 test fns* |
| `tests/tui_gateway/test_retirement_admission.py` | Every admission source participates in the same process retirement fence. — *2 test fns* |
| `tests/tui_gateway/test_retirement_continuations.py` | Retirement cannot splice between a turn's completion and its automatic successors. — *2 test fns* |
| `tests/tui_gateway/test_retirement_workers.py` | Detached work must retain process admission, including scoped side-agent cleanup. — *1 test fns* |
| `tests/tui_gateway/test_review_summary_callback.py` | Tests for tui_gateway background-review summary delivery. — *2 test fns* |
| `tests/tui_gateway/test_rollback_container_refusal.py` | rollback.diff refuses a container-backed session like every other /rollback diff surface. — *1 test fns* |
| `tests/tui_gateway/test_rollback_restore_safe.py` | The sidecar's whole-tree rollback.restore keeps the user's hand-edits like the owner's. — *2 test fns* |
| `tests/tui_gateway/test_routing_provenance_reopen.py` | #106459: a stale explicit-close stamp (tui_close on a session the TUI still routes) wedged — *2 test fns* |
| `tests/tui_gateway/test_runtime_identity.py` | Runtime identity contract for TUI gateway machine protocol fields. — *1 test fns* |
| `tests/tui_gateway/test_secondary_profile_model_and_key.py` | One Desktop backend serving two profiles: a secondary session's key save and model belong to IT. — *2 test fns* |
| `tests/tui_gateway/test_secret_capture_session.py` | Skill credential prompts go to the session that owns the turn, never the last wired one. — *4 test fns* |
| `tests/tui_gateway/test_seeded_branch_title_routing.py` | Seeded Desktop branches keep generated titles out of memory identity. — *1 test fns* |
| `tests/tui_gateway/test_seeded_session_create.py` | session.create with seeded messages: the seed is durable before the first prompt, and durable once. — *3 test fns* |
| `tests/tui_gateway/test_serve_exit_flush.py` | A killed hermes serve must not lose in-memory session transcripts. — *8 test fns* |
| `tests/tui_gateway/test_served_profile_child_env.py` | A child spawned FOR a served profile carries that profile's env, never the launch profile's. — *3 test fns* |
| `tests/tui_gateway/test_served_profile_child_env_authority.py` | A routed profile's child never receives a launch-profile credential — whatever its provenance. — *3 test fns* |
| `tests/tui_gateway/test_server_requests.py` | Server→client request ordering on the wire (tui_gateway/server_requests.py). — *2 test fns* |
| `tests/tui_gateway/test_session_agent_cwd.py` | Workspace changes reach new Codex threads without rebinding memory or prompts. — *2 test fns* |
| `tests/tui_gateway/test_session_archive_rpc.py` | RPC-level tests for session.archive (tui_gateway, #47168). — *5 test fns* |
| `tests/tui_gateway/test_session_control.py` | Behavioral contract tests for Desktop session-control JSON-RPC methods. — *19 test fns* |
| `tests/tui_gateway/test_session_create_model_provider_guard.py` | session.create rejects a model the selected provider cannot serve (#96817). — *3 test fns* |
| `tests/tui_gateway/test_session_cwd_follow.py` | A session that settles into another git worktree re-anchors onto it. — *13 test fns* |
| `tests/tui_gateway/test_session_cwd_profile_key.py` | A secondary profile's session.create cwd record is readable inside that profile's turn scope. — *1 test fns* |
| `tests/tui_gateway/test_session_db_ownership_teardown.py` | Dedicated profile SessionDB handles must be closed by whoever ends up owning them. — *16 test fns* |
| `tests/tui_gateway/test_session_delete_rpc.py` | session.delete: argument checks, the live-session refusal, the profile's db and sessions dir, and — *8 test fns* |
| `tests/tui_gateway/test_session_finalize_reaps_kernels.py` | Session finalize disposes the owner's execute_code kernels (TUI-owned only). — *2 test fns* |
| `tests/tui_gateway/test_session_foreign.py` | Real foreign logs through the registered desktop RPCs and profile stores. — *2 test fns* |
| `tests/tui_gateway/test_session_git_metadata_generation.py` | Gateway wiring for generation-scoped Git metadata publication. — *3 test fns* |
| `tests/tui_gateway/test_session_hidden_rpc.py` | RPC-level tests for the generic hidden-session surface (tui_gateway). — *5 test fns* |
| `tests/tui_gateway/test_session_history_codex_sidecar.py` | RPC history must retain visible Responses-API assistant sidecars (#68321). — *1 test fns* |
| `tests/tui_gateway/test_session_id_injection.py` | Contract test: tui_gateway._set_session_context must inject the live — *4 test fns* |
| `tests/tui_gateway/test_session_images_dir.py` | Write-side scoping for desktop/clipboard image uploads (#69575). — *4 test fns* |
| `tests/tui_gateway/test_session_interrupt_cancels_background_review.py` | Regression for #102895 (sibling path): an explicit /stop must also — *2 test fns* |
| `tests/tui_gateway/test_session_list_lineage_rpc.py` | session.list must forward the durable lineage root. Regression for #66663. — *1 test fns* |
| `tests/tui_gateway/test_session_platform_resolution.py` | Platform/source tagging for the desktop chat surface. — *7 test fns* |
| `tests/tui_gateway/test_session_profile_db.py` | Session-scoped transcript ops must resolve against the session's own DB. — *8 test fns* |
| `tests/tui_gateway/test_session_reclaim_notify.py` | A backend-reclaimed session must tell the clients still holding it. — *4 test fns* |
| `tests/tui_gateway/test_session_resume_db_ownership.py` | session.resume must not abandon the profile-scoped SessionDB it opens. — *10 test fns* |
| `tests/tui_gateway/test_session_resume_materializes_minted_key.py` | session.resume materializes a row for a minted-but-never-persisted key. — *7 test fns* |
| `tests/tui_gateway/test_session_usage_account_lines.py` | Desktop/TUI /usage (slash.exec) shows provider account limits before the first turn. — *1 test fns* |
| `tests/tui_gateway/test_shared_metrics_consent_rpc.py` | shared_metrics.status / shared_metrics.set: the Desktop consent path keeps the CLI wizard's — *4 test fns* |
| `tests/tui_gateway/test_shared_metrics_slash_command_rpc.py` | shared_metrics.slash_command: the TUI/Desktop client reports each typed slash command once, and the — *1 test fns* |
| `tests/tui_gateway/test_shared_metrics_update_run_rpc.py` | shared_metrics.update_run: Desktop reports a packaged self-update as bounded kind=desktop dims only. — *1 test fns* |
| `tests/tui_gateway/test_shared_session_delivery.py` | Session observers retain output across attachment and disconnect. — *1 test fns* |
| `tests/tui_gateway/test_shell_exec_security.py` | Security-boundary regressions for the TUI shell.exec RPC. — *1 test fns* |
| `tests/tui_gateway/test_show_reasoning_display_gate.py` | Display gates on the live callback path. — *19 test fns* |
| `tests/tui_gateway/test_skills_manage_install.py` | Tests: skills.manage install path (tui_gateway/methods_tools.py::_skills_install). — *3 test fns* |
| `tests/tui_gateway/test_skin_watcher_profile_scope.py` | The shared gateway's skin watcher repaints each attached TUI with ITS profile's skin. — *3 test fns* |
| `tests/tui_gateway/test_slash_fuzzy.py` | Tests for the description-aware slash fuzzy scorer (grok-cli port). — *12 test fns* |
| `tests/tui_gateway/test_slash_prompt_compose_seed.py` | Worker-routed slash commands that queue a next-turn prompt must actually send it. — *5 test fns* |
| `tests/tui_gateway/test_slash_refine_live.py` | /refine from a completed Desktop/TUI session. The in-memory agent cache may be absent — *2 test fns* |
| `tests/tui_gateway/test_slash_review_owner.py` | /review from slash.exec runs on the RPC pool, outside any turn. The reviewer it dispatches must — *1 test fns* |
| `tests/tui_gateway/test_slash_worker_ansi.py` | The slash worker feeds desktop chat bubbles, which render plain text — so — *1 test fns* |
| `tests/tui_gateway/test_slash_worker_mcp_discovery.py` | Integration coverage for profile-local MCP discovery in slash workers. — *1 test fns* |
| `tests/tui_gateway/test_slash_worker_provider.py` | The slash worker inherits the parent agent's provider, not the config default (#57283). — *4 test fns* |
| `tests/tui_gateway/test_slash_worker_skill_refuse.py` | Skill slashes must not ok-reply a loading banner from the slash worker. — *2 test fns* |
| `tests/tui_gateway/test_slash_worker_sys_path.py` | Regression tests for tui_gateway/slash_worker.py sys.path hardening (issue #51286). — *1 test fns* |
| `tests/tui_gateway/test_slash_worker_watchdog.py` | The slash-worker watchdog: its module import must not load the CLI before the watchdog can start, and orphan detection compares the parent pid. — *7 test fns* |
| `tests/tui_gateway/test_spawn_tree_records.py` | Tests: spawn_tree.* JSON-RPC handlers (tui_gateway/methods_session.py). — *2 test fns* |
| `tests/tui_gateway/test_ssh_session_cwd_persistence.py` | An ssh session's launch directory is a host path: kept in memory, never persisted as its remote workspace. — *16 test fns* |
| `tests/tui_gateway/test_stale_provider_resume_live.py` | LIVE E2E: Desktop/TUI session.resume with a stale (deleted/renamed) — *3 test fns* |
| `tests/tui_gateway/test_startup_orphan_sweep.py` | Tests for #65194: the gateway's startup-time orphaned-session sweep. — *10 test fns* |
| `tests/tui_gateway/test_status_profile_home.py` | Profile-owned /status path rendering for multiplexed TUI/Desktop sessions (#124500). — *2 test fns* |
| `tests/tui_gateway/test_stranded_session_adoption.py` | Stranded bot-session adoption (#93296 follow-up). — *17 test fns* |
| `tests/tui_gateway/test_stream_interrupt_recovery_orphan.py` | A stream that dies mid-answer must not leave an anonymous session behind (#111999). — *2 test fns* |
| `tests/tui_gateway/test_subagent_child_mirror.py` | Tests for the gateway's child-session live mirror. — *9 test fns* |
| `tests/tui_gateway/test_subagent_snapshot.py` | Shared RPC contracts exercised against real registries and transcript I/O. — *8 test fns* |
| `tests/tui_gateway/test_submit_row_session_target.py` | One Desktop turn writes its user row and its tool rows into TWO sessions (#123545, evidence A + B). — *9 test fns* |
| `tests/tui_gateway/test_submit_time_user_row.py` | prompt.submit writes the user's message at send time, and the turn that follows adopts that row instead of — *6 test fns* |
| `tests/tui_gateway/test_subprocess_encoding.py` | Regression tests for lossy UTF-8 decoding of TUI gateway subprocess output (#53137). — *2 test fns* |
| `tests/tui_gateway/test_sudo_command_context.py` | Sudo questions carry the original, redacted command through the real request path. — *1 test fns* |
| `tests/tui_gateway/test_theme_bridge.py` | set_theme picker bridge: the model can tell a pick, a dismissed card and an expired one apart. — *2 test fns* |
| `tests/tui_gateway/test_todo_state_events.py` | Todo snapshots bypass optional tool-progress display settings. — *7 test fns* |
| `tests/tui_gateway/test_tools_readback_scope.py` | tools.list / tools.show read back the SESSION's effective toolsets (#117977). — *2 test fns* |
| `tests/tui_gateway/test_tour_bridge_fail_fast.py` | A desktop client that cannot answer the tour server request must not cost a full — *6 test fns* |
| `tests/tui_gateway/test_tui_entry_mcp_owner.py` | Regression tests: the stdio TUI consults the shared MCP discovery owner. — *4 test fns* |
| `tests/tui_gateway/test_tui_gateway_event_replay.py` | Tests for tui_gateway.event_replay — per-session event seq + replay ring. — *19 test fns* |
| `tests/tui_gateway/test_tui_gateway_loop_noise.py` | Tests for tui_gateway.loop_noise — the WS peer-hangup teardown filter (#50005). — *6 test fns* |
| `tests/tui_gateway/test_tui_gateway_notification_poller.py` | One live notification poller per TUI session across agent rebuilds (#138806). — *1 test fns* |
| `tests/tui_gateway/test_tui_gateway_queue_on_busy.py` | A prompt that lands mid-turn is redirected or queued, never dropped. — *32 test fns* |
| `tests/tui_gateway/test_tui_gateway_server.py` | The TUI gateway server surface itself: 614 tests over session slots, session cwd, compute-host dispatch, profile-scoped agent build, prompt.submit, and the whole JSON-RPC method table. Read … — *614 test fns* |
| `tests/tui_gateway/test_tui_gateway_server_branch_idempotency.py` | TUI gateway session.branch idempotency: a retried branch returns the same child (#65410). — *1 test fns* |
| `tests/tui_gateway/test_tui_gateway_server_browser_manage.py` | browser.manage RPCs: connect/disconnect/status (split from test_tui_gateway_server.py). — *22 test fns* |
| `tests/tui_gateway/test_tui_gateway_server_crash_history.py` | Regression coverage for crashed TUI gateway turns. — *2 test fns* |
| `tests/tui_gateway/test_tui_gateway_server_deep_truncate.py` | prompt.submit history-cut opt-ins: confirm_empty_truncate (wipe) and — *5 test fns* |
| `tests/tui_gateway/test_tui_gateway_ws.py` | The WebSocket transport of the TUI gateway: disconnect reaps a flagged session and closes its worker, connect/disconnect register and unregister the live transport, disconnect releases the w… — *15 test fns* |
| `tests/tui_gateway/test_tui_mcp_late_refresh.py` | Tests for the TUI gateway's late MCP tool-snapshot refresh. — *6 test fns* |
| `tests/tui_gateway/test_turn_finished_failure_cause.py` | A failed TUI turn must say why in its own record (#89117). — *18 test fns* |
| `tests/tui_gateway/test_turn_payload_interim_final.py` | message.complete marks a final already delivered as an interim as previewed (#125951). — *2 test fns* |
| `tests/tui_gateway/test_turn_payload_response_transformed.py` | message.complete forwards response_transformed (#96465). — *1 test fns* |
| `tests/tui_gateway/test_turn_payload_reused_final.py` | message.complete names a final that reuses a response the turn already delivered. — *1 test fns* |
| `tests/tui_gateway/test_undo_command.py` | Tests for /undo handling in tui_gateway. — *2 test fns* |
| `tests/tui_gateway/test_user_messages.py` | User-facing copy for assistant-start failures must match the failure's actual cause. — *3 test fns* |
| `tests/tui_gateway/test_vault_methods.py` | Tests: vault.* JSON-RPC handlers (tui_gateway/methods_vault.py). — *9 test fns* |
| `tests/tui_gateway/test_voice_live_delegation.py` | GPT-Live voice chat mode: the full-duplex voice frontend that delegates to Hermes. — *5 test fns* |
| `tests/tui_gateway/test_voice_stopped_consumers.py` | TUI-26: every Python caller of the owner's canonical prompt.submit treats the declared — *2 test fns* |
| `tests/tui_gateway/test_wait_for_mcp_discovery.py` | Tests for tui_gateway.entry.wait_for_mcp_discovery (PR #35245). — *4 test fns* |
| `tests/tui_gateway/test_warning_callback_conservation.py` | Real callback and queue boundaries; renderer preference never hides operator logs. — *3 test fns* |
| `tests/tui_gateway/test_ws_concurrent_reads.py` | The WS concurrent-read lane (#134889 GW-18 review): waiting context reads stay bounded, a server — *4 test fns* |
| `tests/tui_gateway/test_ws_keepalive.py` | Regression tests for WebSocket dead-peer detection via TCP keepalive. — *2 test fns* |
| `tests/tui_gateway/test_ws_keepalive_config.py` | Config propagation tests for the WS keepalive + orphan-reap grace knobs (#79635). — *4 test fns* |
| `tests/tui_gateway/test_ws_orphan_races.py` | Orphan callbacks own only their detachment, never a later reconnect. — *6 test fns* |
| `tests/tui_gateway/test_ws_send_timeout.py` | A stalled send_text must have a bounded lifetime (#106369). — *2 test fns* |
| `tests/tui_gateway/test_ws_surrogate_send.py` | Lone UTF-16 surrogates must not tear down the Desktop WebSocket (#97288). — *4 test fns* |

## 2. Ideas worth stealing

1. **A file-backed virtual clock installed at exactly ONE wall-clock seam.** `tests/e2e/core/delivery/_cron_clock.py:11-30`
   installs the clock at `hermes_time.datetime` (the single function every cron module calls) and
   at the three `time.time()` reads of `cron.jobs` / `cron.scheduler` / `cron.executions`, while
   leaving `time.monotonic` real so real waits still pace. That lets a test run **30 virtual days
   of scheduled work in seconds** and still exercise the real ticker loop, the real fire claim and
   the real durable delivery queue. *Why it transfers:* August Trading's automation schedule
   (cron-style automations, scheduled runs, streak-breakers) can be soak-tested the same way —
   write the clock once, get 30 days of "did it fire, did it fire once, did it recover after a
   restart" for the price of minutes. `CONVERGENT` (the same file also appears in the `pi` shard's
   scheduled-work harness family).
2. **Exactly-once delivery proven against a journal that survives SIGKILL.** `tests/e2e/core/delivery/_fake_platform.py:108-140`
   fsyncs every accepted platform effect to `platform.jsonl` **before** the call returns, then
   compares the platform's ground truth against the ledger's `delivery_outcome`, resolving a
   `queued` row through the durable queue's own tombstone table
   (`_cron_clock.py:487-495`). *Why it transfers:* August Trading's "Log this trade" / settlement
   writes have exactly this shape — a durable intent plus an at-least-once side effect. The
   `ack_lost` fault (the platform accepted it, the ack was lost) is the case that produces the
   duplicate the trader actually sees; Hermes scripts that fault explicitly. `UNIQUE`.
3. **A *known-failure* mechanism that cannot hide a harness failure.** `tests/e2e/core/_pending_fixes.py:40-58`
   XFAILs only when the exception message matches the gap's own regex, and `strict_acceptance`
   (`_pending_fixes.py:30-40`) lets an integration run refuse to excuse the gap it claims to close.
   The delivery lane adds a **probe** that re-reproduces the defect on the tree under test
   (`delivery/_pending_fixes.py:47-88`). *Why it transfers:* August Trading's `docs/plan/open-items.md`
   is exactly a list of open defects; this gives every one of them a gate that is true today,
   false after the fix, and loud when the harness itself is broken. `UNIQUE`.
4. **Cross-view invariants instead of "the transcript looks right".** `tests/e2e/core/compaction/_helpers.py:283-345`
   asserts four independent views agree: the wire the model saw, the durable prefix in `state.db`,
   the recoverable set (live **or** archived), and the host's in-memory history. `tests/e2e/core/history/_helpers.py:246-300`
   adds a fifth: what the provider **billed** must equal what the DB recorded, with cache reads
   split out. *Why it transfers:* this is the pattern that would catch August Trading's
   "rendered row count" blind spot (the AGENTS.md note that jsdom tests cannot see a transcript
   drop a message) — instead of counting rows, prove that every view of the trade journal agrees.
   `UNIQUE`.
5. **A prompt-cache prefix oracle.** `tests/e2e/core/history/_helpers.py:200-222` finds every
   request index where request *i* is not a byte-identical extension of request *i-1* (tools
   array, system prompt, every earlier message). *Why it transfers:* August Trading sends a large
   system prompt + tool catalog + history on every turn; a silent reorder or a changed tools
   array throws away the provider's prefix cache and the bill goes up without anyone noticing.
   `UNIQUE`.
6. **Process hygiene by subreaper, not by pattern kill.** `tests/e2e/core/dashboard/_reaper.py:44-56`
   calls `prctl(PR_SET_CHILD_SUBREAPER)` so orphans reparent to the test runner and stay inside
   the subtree the safety guard allows; identity is `(pid, kernel start time)`, and a surviving
   process is a **test failure** with a leak report. *Why it transfers:* any August Trading
   automation that spawns a worker (a scheduled run, a background analysis) needs the same
   "nothing outlived the turn" proof — and the same refusal to exempt things from the guard.
   `UNIQUE`.
7. **A barrier instead of a sleep for negative claims.** `tests/e2e/core/platforms/_contract.py:14-17`
   settles "no second reply" by sending one more inbound whose reply proves everything queued
   before it was handled — never by sleeping. *Why it transfers:* August Trading's UI has the same
   class of assertion ("no duplicate settlement row"); a barrier event makes it deterministic.
   `UNIQUE`.
8. **Disjoint secret allocation so one home can serve every scenario.**
   `tests/e2e/core/security/_redact.py:3-5` gives every scenario its own secret values so the
   values left raw by design never coincide with the values asserted masked — one Hermes home,
   every scenario, each sink scanned once. *Why it transfers:* the same trick makes a single
   August Trading fixture able to prove that an API key never reaches disk, a log or the next
   provider request. `UNIQUE`.
9. **A catalog that is discovered, never listed.**
   `tests/e2e/core/providers/_catalog_helpers.py:4-8` runs the real plugin discovery in a clean
   child, so a new provider plugin joins the matrix automatically; `evaluate()` checks
   *relationships* only, never literals of today's output (`:309-352`). *Why it transfers:* the
   same shape works for August Trading's provider registry and its model catalogue — a new
   provider must not need a test edit. `UNIQUE`.
10. **Record once, assert many.** `tests/e2e/core/upgrade/handoff/_scenario.py:8-11` stages the
    expensive scenario (boot, update, settle) once per column and then asserts each property
    separately over the recorded result, each gated on its own issue. *Why it transfers:* an
    end-to-end "one session, ten properties" scenario is the only affordable way to test
    August Trading's settlement + automation + learning loop without ten slow tests.
    `UNIQUE`.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — in this shard, and strong.**
  `tests/e2e/core/delivery/_cron_clock.py` is the reference implementation of a reliable
  scheduler: a file-backed virtual clock across all processes (`:135-160`); a real ticker loop
  whose `tick()` lock admits one fire per instant and advances `next_run_at` **before** releasing
  so two tickers never double-fire (`:38-45`); a **store CAS** claim (`claim_job_for_fire`) so
  "exactly one of N replicas runs a job" is decided by the store, not by timing (`:513-540`); a
  fire-claim **lease heartbeat** (`:31-33`); and a **durable delivery queue**
  (`cron/deliveries.db`) with terminal statuses `pending/delivering/delivered/failed/unknown/suppressed`
  and tombstones for rows that were claimed and never answered (`:626-650`).
  The reliability ingredients August Trading would need: persistence of the claim, a lease that
  survives a crashed worker, catch-up on restart (the `executions.db` ledger distinguishes
  `claimed`/`running` from terminal), idempotency (the durable queue is the idempotency key), and
  a ledger whose `delivery_outcome` is resolved through the queue's own verdict rather than
  trusted (`:626-650`). What is *not* here: a breaker after repeated empty runs — that lives in a
  different Hermes shard (the cron/automation service), not in this test shard.
- **Human-in-the-loop approval — the contract is in this shard.**
  `tests/e2e/core/platforms/_contract.py:340-359` pins the rule that a **stranger's DENY must be
  refused** (else it would deny the owner's command) while the **owner's approve runs it**, and
  `tests/e2e/core/security/test_approval_boundary.py` pins that dangerous terminal commands need
  a human's approval through the *real* terminal tool path, with a gateway-level approve settling
  **only its own chat**. The audit trail is the ledger: `tests/e2e/core/delivery/_cron_clock.py`
  records every run as an `executions` row with `delivery_outcome`, and the approval surfaces in
  `tests/tui_gateway/test_approval_cancelled_on_reap.py` — a pending approval dropped by
  interrupt/reap/teardown must be **loud** (`approval_cancelled`), never silent.
- **Post-mortem / reflection loops — only partially in this shard.**
  The compaction and transcript lanes are the mechanism (`compaction/_helpers.py`: the summary is
  the "reflection", and `assert_db_recoverable` is what stops it eating the user's asks), and
  `tests/tui_gateway/test_failed_turn_retention.py` requires a failed turn to retain a **replayable
  `inflight` snapshot** — that is the raw material a post-mortem needs. What stops *bad* rules
  accumulating (worth gates, expiry, retirement) is **not** in this shard.
- **Multi-agent — the interesting part is lease/ownership, not debate.**
  This shard contains no debate harness; what it contains is the machinery a debate/squad would
  sit on: `tests/tui_gateway/test_delegation_session_lifecycle.py` (fail-closed ownership — an
  orphan is **not** owned), `test_subagent_snapshot.py` (a child's runtime records are projected
  to exactly its own session), `test_legacy_submit_forwards_to_owner.py` (a second surface's
  prompt is queued into the owner's FIFO rather than run concurrently), and
  `test_bot_live_owner_delivery.py` (imported turns retain their receipt and **cannot bypass the
  local FIFO**). The lesson: Hermes spends its complexity on *who owns this turn*, not on how many
  agents argue — the same question August Trading's group-round feature has to answer.
- **Structured logs the model can query — yes, and without a heavy database.**
  The `state.db` SQLite store is the queryable log: `sessions`, `messages` (with `active` and
  `compacted` flags), `session_model_usage`, plus an FTS mirror that must match the canonical
  rows exactly (`tests/e2e/core/sqlite/_helpers.py:355-389`), and a WAL with its own generation
  lifecycle. For the *append-only* side, the harnesses use plain JSONL: `runs.jsonl`,
  `sink.jsonl`, `platform.jsonl`, `ops.jsonl`, `faults_fired.jsonl` — each written with
  `O_APPEND` and, where durability matters, `fsync` before the call returns. Hermes's answer to
  "what did the model actually see" is a read-only SQLite query plus a JSONL journal.
- **Staying simple as features accumulate — the counter-measure is the *invariant*, not the
  feature list.** `tests/e2e/core/parity/_helpers.py:4-12` puts every historically-wired feature
  (a shell hook, a Python hook, an `AGENTS.md`, a skill, a memory entry, an MCP server, a toolset
  restriction) into **one** fixture home and asserts the **same** invariants for **every**
  entrypoint, so a red cell is a wiring-parity bug rather than a per-surface special case. The
  feature count stays high; the number of *contracts* stays small.

## 4. Non-obvious decisions and gotchas

1. **"Stale output never counts."** Every tmux-based wait accepts a needle only when it occurs
   *more often* than in a scrollback snapshot taken just before the input
   (`tests/e2e/core/cli_tmux/_classic.py:80-86`). Without this, a no-op command "passes" by
   matching old output — the single most common way a terminal test lies.
2. **A heartbeat that answers nothing is not a healthy heartbeat.**
   `tests/e2e/core/chaos/_tui_rpc.py:186-196` adds the age of a still-in-flight call to the
   latency list when the measurement window closes, so a wedged dispatcher cannot look healthy by
   being silent.
3. **A "sink that is empty cannot prove absence."** `tests/e2e/core/security/_redact.py:238-245`
   asserts the sink exists before asserting the secret is absent from it.
4. **Text and Enter are separate writes.** The CLI and the Ink TUI both read an Enter that lands
   within 50 ms of the last buffer change as a *pasted newline*; the harness therefore types,
   waits for the echo, pauses, and only then presses Enter
   (`tests/e2e/core/cli_tmux/_classic.py:52-56`, `tests/e2e/core/tui_pty/_helpers.py:332-343`).
5. **Screenshots are not transcripts.** The raw PTY byte stream is frame *history*; the assertions
   run against a VT emulator's grid (`tests/e2e/core/terminal/_vt.py:4-6`).
6. **`known_failure` wraps only the FINAL assertions.** Wrapping a wait means a timeout can be
   mistaken for the known gap (`tests/e2e/core/_pending_fixes.py:40-58`).
7. **The probe must disagree loudly.** `gap_open()` raises if the probe's verdict is neither
   `open` nor `fixed` (`tests/e2e/core/delivery/_pending_fixes.py:80-88`).
8. **A byte offset only means something at a fixed pkt-line framing.** The git fault injector
   re-frames the pack stream before cutting it, because the client acts only on whole pkt-lines
   (`tests/e2e/core/upgrade/git/_smart_http.py:26-44`).
9. **The journal-mode arm is chosen through the production decision path.** The SQLite harness
   pins the *linked SQLite version* so `apply_wal_with_fallback` itself picks DELETE; the harness
   issues no journal-mode pragma (`tests/e2e/core/sqlite/_helpers.py:11-19`).
10. **An unreadable thing must say so.** Every harness that can fail to boot prints the child's
    stderr/gateway log tail in the assertion message, so a red cell explains itself
    (`tests/e2e/core/dashboard/_helpers.py` `log_tail`, `tests/e2e/core/providers/_anthropic_helpers.py:92-99`).
11. **A negative claim needs a barrier, and a positive claim needs a unique token.** Words are
    unique so duplication is countable (`tests/e2e/core/tui_pty/_helpers.py:113-129`).
12. **Stop signals are load-bearing.** `kill_tagged` prefers a pidfd because a recycled PID must
    never be signalled (`tests/e2e/core/chaos/_helpers.py:185-213`).

## 5. Weak spots

1. **The harness is enormous and mostly Linux/POSIX.** `prctl(PR_SET_CHILD_SUBREAPER)`,
   `/proc/<pid>/environ`, `/proc/<pid>/stat`, `ptyprocess`, `tmux` and `bwrap` are all load-bearing
   and all Linux-only; several modules carry `windows-footgun: ok` comments. Porting these ideas to
   August Trading's Windows/Electron world means re-implementing the process-identity and
   cleanup half of the harness, which is where most of the value actually lives.
2. **The 842 KB / 614-test monolith.** `tests/tui_gateway/test_tui_gateway_server.py` is a single
   file that has been repeatedly carved up (`test_tui_gateway_server_browser_manage.py`,
   `..._branch_idempotency.py`, `..._crash_history.py`, `..._deep_truncate.py`) — the refactor is
   under way but the residue is still one 842 KB file with two autouse fixtures whose docstrings
   explain which flaky CI failures they suppress.
3. **Timeouts are encoded as constants, not configuration.** The liveness budget lives in
   `chaos/_helpers.py:36-52` as module constants; a slow CI machine must pass a suite whose
   deadlines are 3–5 seconds of *wall* time against 90-second turn deadlines. The virtual clock
   solves this for cron and nothing else.
4. **The "one shared Hermes home per scenario" pattern hides cross-test coupling.** Several
   harnesses deliberately reuse one home across many scenarios (the redaction lane, the
   compaction lane); the discipline required to keep that honest lives in prose in the module
   docstrings, not in code.
