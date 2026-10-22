# hermes-agent :: hermes-evals

**Files in shard:** 236 (read: 223, skipped with reason: 13)
**What this shard covers:** `evals/` — Hermes's entire evaluation and experiment layer. It is not
one harness but ~60 small, self-contained, mostly-offline probes, A/B batteries and scorecards
that each answer a narrow question about the agent runtime: wire contracts at the provider
boundary, session/delegation persistence, compaction quality, browser-tool economics, agent
navigability of the codebase, auth-pool behaviour, approval-denial dispatch, cron delivery
ownership, and a large `postmortem/` forensics suite. The house style is uniform and highly
transferable: every probe runs the *production* code path against a **loopback fixture** in a
throwaway `HOME`/`HERMES_HOME`, asserts invariants with plain `assert`, writes a machine-readable
JSON receipt, and states in its own docstring exactly what it does *not* prove ("not provider
proof", "not native Windows parity"). Larger batteries are **resume-safe** (one JSONL line per
cell, completed cells skipped on rerun) and A/B by **pinned tree checkouts** (merge-base vs
branch), with **oracle-checked** task definitions and an LLM judge that sees the gold answer but
the answerer does not.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `evals/__init__.py`
- **Purpose:** empty package marker for the `evals` tree.
- **Key abstractions:** none.
- **Data flow:** none.
- **Non-obvious design decisions:** the whole eval tree is an importable package so probes can
  `from evals.compaction.fixtures import ...` (see `evals/compaction/jev_cycles.py:20`).
- **Edge cases & failure handling:** n/a.
- **Surprising:** the 0-byte `__init__.py` files recur in three subpackages
  (`evals/codebase_navigability`, `evals/postmortem`, `evals/postmortem/forensics`) — they exist
  only so the harness code is importable from a checkout.

### `evals/acp_empty_session_wire.py`
- **Purpose:** probes the native ACP stdio adapter end to end against a local HTTP model fixture,
  then inspects the resulting SQLite `state.db`.
- **Key abstractions:** inline `BaseHTTPRequestHandler` fixture model; `rpc(method, params)`
  JSON-RPC helper; `rows()` SQL reader.
- **Data flow:** writes a `config.yaml` into a temp `HERMES_HOME` with `mcp_servers: {}` and
  `disabled_toolsets: [all]`, spawns `python -m acp_adapter` as a subprocess, and drives
  `initialize` → `session/new` → `session/prompt` → `session/fork` → `session/load`.
- **Non-obvious design decisions:** the central invariant is that **`session/new` must not create
  a durable row** — `assert result['after_open'] == [], 'session/new created an empty durable
  row'` (`evals/acp_empty_session_wire.py:132`). A forked session must materialise real messages
  and a `message_count > 0` row. The `session/load` case deliberately inserts a *legacy* row with
  only `id/source/started_at` to prove the adapter backfills `model_config` and `message_count`
  rather than crashing on a half-populated row.
- **Edge cases & failure handling:** the subprocess is terminated and the server shut down in a
  `finally`; `stderr` is captured to `<output>.stderr`; the RPC read has a 120 s timeout.
- **Surprising:** the env is scrubbed to `PATH/LANG/TZ` only and re-pointed at the fixture, and
  `HERMES_ACP_SKIP_CONFIGURED_MCP='1'` is set so a user's real MCP config cannot leak in.

### `evals/anthropic_proxy_thinking_replay.py`
- **Purpose:** measures *which thinking blocks* a real `AIAgent` replays to an
  Anthropic-compatible relay — synthetic SSE fixtures, explicitly not live-provider proof.
- **Key abstractions:** `scenario(model, path)`; `HISTORY` — a canned conversation containing
  one unsigned thinking block and one **foreign-signed** thinking block; `_sse(events)`.
- **Data flow:** a local `ThreadingHTTPServer` answers `/messages` with an Anthropic-shaped SSE
  stream; `run_agent.AIAgent` runs `run_conversation` with `reasoning_config={"effort":"high"}`;
  the captured request bodies are mined for `content[]` blocks of type `thinking`/`redacted_thinking`.
- **Non-obvious design decisions:** the interesting case is the **signed** thinking block carried
  from "elsewhere" — the probe reports the wire's thinking blocks so a reader can see whether a
  foreign signature was forwarded verbatim. `requests` only records paths ending in `/messages`,
  deliberately skipping the Ollama `/api/show` capability probe so the count means something.
- **Edge cases & failure handling:** `agent._api_max_retries = 1` keeps a failure cheap; the
  agent is closed and the server shut down in `finally`; a `TemporaryDirectory` HOME isolates
  the run and `HERMES_DISABLE_PLUGINS=1` stops plugin loading.
- **Surprising:** the two scenarios are two *different model ids* on the same fake relay, so the
  probe can show the replay is model-dependent, not provider-dependent.

### `evals/api_delegation_http_probe.py`
- **Purpose:** exercises the loopback HTTP API server with the real executor/session bindings but
  a mocked agent, to see exactly what the runtime hands the model.
- **Key abstractions:** `APIServerAdapter`; `get_session_env`/`_resolve_async_wake_sid`;
  `persist_delegation_delivery`; `SessionDB`.
- **Data flow:** a real `SessionDB` holds a `parent` session (ended) and a `child` session
  (`parent_session_id='parent'`); the adapter is driven over aiohttp `TestClient` for
  `/v1/chat/completions` (stream and non-stream, with and without an explicit
  `X-Hermes-Session-Id`) and `/v1/runs` (session, caller_history, response_chain, declared_key).
- **Non-obvious design decisions:** the four `/v1/runs` variants are **four different ways a
  caller can assert which history is authoritative** — a named session, a caller-supplied
  history, a `previous_response_id` chain, and a declared `X-Hermes-Session-Key`. The probe
  records which one the runtime actually used, and `unsolicited_calls` counts how many agent
  invocations happened *without* a request — the "async delegation woke a stranger" bug class.
- **Edge cases & failure handling:** two concurrent `persist_delegation_delivery` calls are
  gathered to test idempotency; `delivery_error` records the exception type rather than swallowing
  it; `durable_child_rows` proves the child session did not inherit the parent's rows.
- **Surprising:** the probe asserts the *resumed* history after a delegation delivery — the
  delivery must land in the owner session's history, not in the child's.

### `evals/api_delegation_sync_probe.py`
- **Purpose:** model-free version of the same question, using only real request-context binding,
  dispatch policy and SQLite persistence.
- **Key abstractions:** `clear_session_vars(tokens)` (a contextvar token bundle);
  `db.acquire_session_turn_lease` / `release_session_turn_lease`.
- **Data flow:** binds an API-server session context, asks `_resolve_async_wake_sid` for the
  target session id, persists a delegation delivery, then rotates/ends the parent session.
- **Non-obvious design decisions:** the **lease** is the mechanism: a delivery into a session
  whose turn lease is held must fail (`busy_delivery`) and succeed only after release
  (`after_release_rows`). That is a real concurrency contract, not a mock.
- **Edge cases & failure handling:** `stranger_rows` proves an unrelated session is never written
  to; the `finally` always releases the lease.
- **Surprising:** the probe reads the *signature* of internal functions with `inspect.signature`
  and adapts its call — a deliberately version-tolerant probe that keeps working across
  refactors of the internal API.

### `evals/approval_deny_dispatch.py`
- **Purpose:** offline receipt for the approval **deny** path — proves a denied command never
  reaches the privileged binary.
- **Key abstractions:** `tools.registry.registry.dispatch("terminal", {...})`;
  `approval_context._get_approval_config()`.
- **Data flow:** writes a config with `approvals: {mode: "off", deny: ["sudo *", "printf SAFE",
  "git status"]}` and puts an **owned marker executable** named `sudo` first on `PATH`; if the
  marker is ever reached it prints `OWNED_EXECUTABLE_REACHED`, which must never appear in output.
- **Non-obvious design decisions:** the 30+ case list is an **evasion battery** over GNU
  `env -S`, `env -a`, `env --argv0`, `command`, `bash -c`, backslash escapes, comments, and
  `env -S` argument-splitting. The expected outputs are indexed by position
  (`expected_outputs = {5: ..., 6: ...}`) and `--verify` asserts either the exact benign output
  or `status == 'blocked'` with `'user-defined deny rule' in error` and **empty output**.
- **Edge cases & failure handling:** `os.environ.clear()` then a minimal env; `gnuenv` is
  symlinked when present because host `env -S` semantics differ; the marker executable is
  `chmod 0o700`.
- **Surprising:** the deny rule is checked against the *parsed command*, not the raw string — the
  probe's whole purpose is to find parser gaps, and it keeps a list of exactly which shapes
  were expected to slip through.

### `evals/auth_pool_controls.py`
- **Purpose:** live-PTY test of the credential pool's `reset`/`priority`/`refresh` commands against
  a loopback OAuth server — production parser, command, pool refresh, HTTP client and persistence
  all execute.
- **Key abstractions:** `token(subject)` (an unsigned-but-well-formed JWT); the `cases` list of
  `(name, provider, argv, status)`; the per-case `auth.json` fixture.
- **Data flow:** for each case a temp `HERMES_HOME` is written with a two-row credential pool
  (both rows `last_status='exhausted'`, `last_error_code=429`), the real CLI is run under a
  **pty** (`pty.openpty`) so the interactive menu is exercised, and the on-disk `auth.json` is
  re-read to see what actually changed.
- **Non-obvious design decisions:** the child process gets an env with every `TOKEN/API_KEY/
  SECRET/PASSWORD/HERMES/PYTEST` variable stripped, and `httpx.Client.send` is monkeypatched to
  **raise `AssertionError('NONLOCAL_NETWORK')` for any non-loopback host** — a hard network
  boundary that the final assertion checks for. `secrets_printed` is asserted false for every case.
- **Edge cases & failure handling:** the "nous" provider has a *singleton* credential shared with
  the pool; the probe distinguishes `nous-independent` (a row whose refresh must NOT be used —
  expects exit != 0 and **zero wire requests**) from `nous-singleton` (expects exactly one
  targeted request). Cooldown fields on the *sibling* row must be preserved in both.
- **Surprising:** the assert block at the end is a **receipt-grade contract** — it is written so
  that a reader can see the intended invariants without running anything.

### `evals/auxiliary_resource_exhausted.py`
- **Purpose:** local HTTP contract probe for the auxiliary (auxiliary/compression) client: what
  happens when the primary auxiliary route is quota- or payment-exhausted.
- **Key abstractions:** `aux.call_llm` / `aux.async_call_llm` / `aux.aux_progress_hook`;
  the `fallback_chain` config key.
- **Data flow:** two loopback listeners — a primary (`nvidia`-labelled profile pointing at
  listener A) and a fallback (a *named custom provider* with its own `base_url` and credential
  label, listener B). The primary returns `ResourceExhausted: Worker local total request limit
  reached (32/32)`, in three wire shapes: plain JSON error, non-200 status, and an SSE error
  frame.
- **Non-obvious design decisions:** the fallback must be a **different backend identity** (distinct
  `base_url`), because a payment/quota error is credential-wide — falling back to the same
  credential would fail identically. The probe asserts `messages_preserved`: the messages sent
  to the fallback are byte-identical to the ones sent to the primary.
- **Edge cases & failure handling:** `--spelling` changes the error's spelling (a provider may
  say `ResourceExhausted` or `resource_exhausted`) and `--mode` picks sync/async/SSE; the probe
  records `error_status` and `error_message` and never raises.
- **Surprising:** the config is written as **JSON** because JSON is valid YAML — a deliberate
  dependency-free choice for a standalone probe.

### `evals/botmode-dm-delivery/mock-trigger.patch`
- **Purpose:** a 15-line patch to the shared mock server that teaches it to answer a scripted
  `E2E_DM(<target>)[<message>]` prompt with a `message_agent` tool call.
- **Key abstractions:** `startMockServer`; `streamScriptedTurn` / `nonStreamingScriptedTurn`.
- **Data flow:** the mock server inspects the last user text; if it matches `E2E_DM(...)` and no
  `tool` role message follows, it emits a `message_agent` tool call.
- **Non-obvious design decisions:** the `!messages.slice(lastUserIndex + 1).some(m => m?.role ===
  'tool')` guard makes the trigger **one-shot per turn** — the same prompt echoed back later does
  not re-fire the tool, which is what lets the probe assert "delivered exactly once".
- **Edge cases & failure handling:** the patch is applied with plain `git apply` and reversed with
  `git apply -R`; the README keeps the failed run's evidence rather than overwriting it.
- **Surprising:** the trigger lives in the *shared* mock server, so one patch serves both probes.

### `evals/botmode-dm-matrix/mock-trigger.patch`
- **Purpose:** the same one-shot `E2E_DM` trigger, in the hunk form the matrix probe applies.
- **Key abstractions:** `startMockServer`; the `E2E_DM` regex.
- **Data flow:** identical to the delivery variant — the mock server emits one `message_agent` call
  per matching user turn.
- **Non-obvious design decisions:** the two patches differ only in the hunk header
  (`--unidiff-zero` context), which is why the matrix README needs `git apply --unidiff-zero`.
- **Edge cases & failure handling:** the patch is applied and reversed around the run, so the
  checkout is left clean.
- **Surprising:** the *same* trigger serves both probes — the matrix needs no second mock-server
  change.

### `evals/botmode-dm-delivery/probe-cron-root.spec.ts`
- **Purpose:** Playwright/Electron probe proving an *ordinary* (never-deferred) cron job pins an
  unowned named target under a **custom Hermes root**.
- **Key abstractions:** `createSandbox`, `launchDesktop`, `writeMockProviderConfig`;
  `find_canonical_live_owner`; `_deliver_to_bot_chat`.
- **Data flow:** three profiles (`default`, `alpha`, `beta`) each with their own `HERMES_HOME`;
  a `hermes` shim on `PATH` records `PID $HERMES_HOME $*` to `children.log` so the probe can
  prove *which* checkout and *which* root the child ran under.
- **Non-obvious design decisions:** the mock server **holds** the first completion
  (`holdFirstCompletionContaining: 'ORDINARY_CRON_SENTINEL'`) so the probe can observe the
  mid-flight state — while the child is held, `find_canonical_live_owner(alpha).surface` must be
  `'cli'`, and the default owner's `lease_id` must be **unchanged**. The probe then asserts the
  pending-queue file `cron/bot_chat_pending` does **not** exist (delivery was admitted, not
  queued), and finally that a removed profile is **not recreated** and that no second `.hermes`
  root is created under `HOME`.
- **Edge cases & failure handling:** the "missing profile" case runs after the main one and
  asserts `result` is non-null (a refusal receipt) with `recreated === false`.
- **Surprising:** the fixture asserts on **SQLite rows** (`select session_id,role,content from
  messages`) in addition to the DOM, so the UI cannot lie.

### `evals/botmode-dm-delivery/probe-dm-delivery.spec.ts`
- **Purpose:** two native probes — cron output waiting for a CLI-only owner, and a nested
  one-shot `message_agent` delivery.
- **Key abstractions:** `openBot(name)`; `dbMessages(name)`; `spawn(python, ['-m',
  'hermes_cli.main', '-p', 'beta', 'chat', '--in', '~', '-c', 'Bot Chat', '--create-if-missing',
  '-Q', '-q', ...])`.
- **Data flow:** the quiet CLI child holds the model stream; the cron producer calls
  `_deliver_to_bot_chat`; the *ticker* is then run with a **changed `HOME`**
  (`changed-launch-home`) to prove delivery is authorised through the profile authority, not by
  re-resolving `~`.
- **Non-obvious design decisions:** `HERMES_SINGLE_QUERY_LINGER_SECONDS` is set to `30` in the
  first probe and `1` in the cron-root probe — the harness tunes the product's own linger knob
  to make timing deterministic rather than sleeping.
- **Edge cases & failure handling:** the second probe asserts the nested sentinel appears
  **exactly once** in alpha's rows and that the "show message" disclosure expands to reveal it
  after a reload.
- **Surprising:** the README records that a *failed* fixture attempt is retained
  (`native-green.log`) alongside the passing ones — evidence hygiene is part of the house style.

### `evals/botmode-dm-matrix/probe-dm-matrix.spec.ts`
- **Purpose:** the delivery **matrix** — default Desktop owner vs quiet CLI owner vs unowned
  target, nested two levels deep.
- **Key abstractions:** `owner(name)` (via `find_canonical_live_owner`), `snapshot(name)` (sessions
  + messages + `active_session_registry_snapshot` + `processes.json`), `capture(label)`,
  `unfold()`.
- **Data flow:** `E2E_DM(beta)[E2E_DM(gamma)[matrix-unowned-sentinel]]` is typed into the Desktop
  composer; the model (mocked) calls `message_agent` twice, spawning two quiet CLI children.
- **Non-obvious design decisions:** the probe pins **identity**, not position: the nested child's
  `session_key` must equal `matrix-beta`, its `parent_session_id` must equal `matrix-beta`, and
  its `owner_task_id` must **not** equal the default owner's `session_id`. The default session
  must receive **zero** rows starting with `Message from`, and the default owner snapshot must be
  byte-identical before and after.
- **Edge cases & failure handling:** `BOT_DM_SERVICE_PATH=1` installs a *stale* launcher on `PATH`
  that exits 2 and records the invocation; the probe asserts `wrong-path.log` **does not exist**
  afterwards — i.e. the fix made children use the worktree-pinned entrypoint.
- **Surprising:** the second test asserts the incoming sender card renders **before any reload**
  — a direct anti-"you must refresh to see it" assertion.

### `evals/browser_use/benchmark_browser_eval.py`
- **Purpose:** micro-benchmark comparing the in-process CDP **WebSocket** path against the
  `agent-browser` **subprocess** path for the same `Runtime.evaluate` call.
- **Key abstractions:** `SUPERVISOR_REGISTRY.get_or_start(task_id, cdp_url)`;
  `supervisor.evaluate_runtime(expr)`; `_run_browser_command(task_id, "eval", [...])`.
- **Data flow:** starts headless Chrome with a temp profile, waits for `/json/version` to expose a
  `webSocketDebuggerUrl` (15 s deadline), then times N iterations of each path.
- **Non-obvious design decisions:** a **sanity check** (`1 + 1` must equal `2`) gates the
  benchmark — a fast wrong answer is worse than no answer. The subprocess arm is **skipped**
  rather than failed when `agent-browser`/`npx` is absent.
- **Edge cases & failure handling:** Chrome is terminated in `finally`, with a 3 s wait then
  `kill()`; the temp profile is removed.
- **Surprising:** the comparison exists because the WS path avoids a process spawn per tool call —
  the same "transport cost vs tool cost" trade-off that recurs across this repo.

### `evals/browser_use/orchestrate.py`
- **Purpose:** the local-CDP battery orchestrator: tasks × arms × models × reps.
- **Key abstractions:** `ARMS`/`MODELS`/`TASKS`/`REPS`; the `cells` product; `reset_browser_state()`.
- **Data flow:** each cell is a `subprocess.run` of `single_run.py`; the orchestrator reads the
  child's stdout for a `RESULT_JSON:` line and appends one JSON object per cell to
  `results/results.jsonl`.
- **Non-obvious design decisions:** **resume-safety** is achieved by reading the existing JSONL at
  start-up and skipping `(arm, task, model, rep)` tuples already present; a killed battery
  continues where it left off. `reset_browser_state()` kills lingering drivers and clears cookies
  *between every cell* so state cannot leak across arms.
- **Edge cases & failure handling:** `subprocess.TimeoutExpired` is caught and recorded as
  `ok=False, error="orchestrator-timeout-{N}s"`; a missing `RESULT_JSON` records
  `stderr_tail`/`stdout_tail` so a failure is diagnosable from the log alone.
- **Surprising:** `ENV["PATH"]` is prefixed with `~/.local/bin` — the browser driver is resolved
  from the user-local install, not the repo.

### `evals/browser_use/orchestrate_cloud.py`
- **Purpose:** the same battery against a **provisioned cloud browser** per cell.
- **Key abstractions:** `NousCloud` and `Browserbase` classes, each with `create(name)` and
  `close(sess)`; a `provider` chosen by `--backend`.
- **Data flow:** per cell it creates a session, exports the CDP endpoint as `BENCH_CDP_URL` /
  `BU_CDP_WS`, runs `single_run.py pr …` with that env, then closes the session in `finally`.
- **Non-obvious design decisions:** the cloud arm always uses the `pr` tree — the point is the
  backend matrix, not a second A/B. Session teardown is in `finally` and its failure is a
  **warning, not a failure** (a leaked cloud browser must not invalidate the measurement).
- **Edge cases & failure handling:** a session-creation failure is recorded as
  `ok=False, error="session-create: {e}"` and the loop continues.
- **Surprising:** the same `single_run.py` and the same task file serve the local and cloud
  batteries, so the backend is the only variable.

### `evals/browser_use/report.py`
- **Purpose:** aggregate the JSONL into the scorecard tables.
- **Key abstractions:** `cells[(model, arm)]`; `base_tok[model]`.
- **Data flow:** group rows by `(model, arm)`, compute ok-rate, token mean/median, tool calls,
  wall clock, and the **delta vs the `base` arm of the same model**.
- **Non-obvious design decisions:** the delta column is only populated when a `base` arm exists
  for that model — a missing baseline yields a blank, not a misleading 0%.
- **Edge cases & failure handling:** unparsable lines are skipped; a missing `total_tokens`
  defaults to 0.
- **Surprising:** errors are printed separately with a 10-row cap so a broken cell does not
  dominate the table.

### `evals/browser_use/single_run.py`
- **Purpose:** one benchmark cell — arm × task × model × rep — printing a single
  `RESULT_JSON:{…}` line.
- **Key abstractions:** `WT` (the pinned tree per arm); `task = TASKS[TASK_KEY]`; `_ok(text)`;
  the `prns` ablation hook.
- **Data flow:** builds a throwaway `HERMES_HOME`, writes a per-arm `config.yaml`, strips the
  web-fetch credential env vars, imports `run_agent` **from the pinned tree** and asserts the
  loaded module is under that tree (`assert _loaded.startswith(_want)`).
- **Non-obvious design decisions:** two deliberate controls: (1) the web-fetch credentials
  (`FIRECRAWL_API_KEY`, `NOUS_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`) are **popped** so
  every arm must actually drive the browser; (2) the `prns` arm reaches into
  `tools.browser_use_cli` and replaces the schema description with the header only, to isolate
  the value of the helpers digest. The comment at `single_run.py:135` also warns that
  `terminal` must be in the toolset for the `pr` arms, and that `tool_call_names` should be
  audited for terminal-tool bypasses (curl etc.).
- **Edge cases & failure handling:** the agent runs with `max_iterations=30`; any exception is
  captured as `error = f"{type(e).__name__}: {e}"` and the messages are still harvested for
  `tool_call_names`.
- **Surprising:** the "no credential" case raises `SystemExit` with an explicit message rather
  than failing obscurely.

### `evals/browser_use/tasks/easy.json`
- **Purpose:** the 5 oracle-checked *easy* browser tasks against stable `toscrape`-family sites.
- **Key abstractions:** `prompt`, `oracle_any` (list) or `oracle_all` (list of regex-escaped
  literals).
- **Data flow:** `single_run.py` applies the oracle to the model's final answer to decide `ok`.
- **Non-obvious design decisions:** `oracle_all` demands *every* literal, which is how a
  multi-part question ("state the count **and** the cheapest title **and** its price") is made
  checkable instead of hand-waved.
- **Edge cases & failure handling:** the oracle is applied to the *final answer only* — the
  README notes `n<=3` per cell and that sub-100% cells must be audited run by run before being
  called a regression.
- **Surprising:** the five easy tasks are one per *shape* — price lookup, category extract,
  count/aggregate, login, pagination — so a regression can be attributed to a shape.

### `evals/browser_use/tasks/hard.json`
- **Purpose:** the 6 oracle-checked *hard* browser tasks — full-category multi-page crawls,
  five-star rating aggregation, JS/delayed render, a login chain and a cross-category compare.
- **Key abstractions:** the same `prompt` / `oracle_all` shape, with multi-literal answers.
- **Data flow:** the same `single_run.py` path, at 3 reps per cell.
- **Non-obvious design decisions:** the `delayed_render` task's content appears only after a
  delayed JS render — a deliberate anti-"you only tested the happy path" case.
- **Edge cases & failure handling:** the `login_then_extract` task must both confirm the login and
  report which authors appear twice, so the oracle is multi-literal.
- **Surprising:** the hard battery is where the −60 % token win was measured (25 934 vs 64 594
  mean tokens at identical accuracy).

### `evals/cli_deferred_notice.py`
- **Purpose:** drives the real CLI under a Linux PTY to prove a **deferred update notice** does
  not garble the prompt.
- **Key abstractions:** `run_case(root, output, name, behind, early, cancel)`; a FIFO used as the
  cached update result; `pump_until(predicate, timeout)`.
- **Data flow:** a FIFO is created at `<HERMES_HOME>/notice-result.json`; the CLI's
  `source_check.check_for_updates` is replaced to read that file. The harness waits for the
  prompt to render (`\x1b[?2004h`), then writes to the FIFO and asserts the notice text appears
  **after** the prompt.
- **Non-obvious design decisions:** the FIFO is the whole trick — a regular file would be read
  before the prompt renders, so the notice would arrive in the wrong place; the FIFO blocks
  until the CLI asks for it. The `--expect clean|garbled` flag lets the *same* harness be run
  against base and head to produce a before/after receipt.
- **Edge cases & failure handling:** the `cancel-pending` case sends `\x03` (Ctrl-C) to cancel;
  the process is killed with `SIGKILL` to the **process group** (`os.killpg`) in `finally`.
- **Surprising:** the probe asserts the banner came from the *worktree* (`loaded_worktree`), so
  a probe that accidentally tests an installed hermes fails loudly.

### `evals/cli_fallback_add_picker_error.py`
- **Purpose:** proves that an ordinary `PermissionError` inside the fallback picker's
  `deactivate_provider` **restores the previous primary** instead of stranding the config.
- **Key abstractions:** `_persisted_model(root, env)` — reads the `model` section back through
  the CLI's own `load_config()`; the `curses` shim.
- **Data flow:** a `curses` stub package that raises `ImportError` forces the numbered fallback
  menu (so the PTY exchange is line-oriented); the auth store is `chmod 0` **after** the menu
  renders, so the picker's own write fails with a plain `OSError`.
- **Non-obvious design decisions:** the failure is injected at the *narrowest* possible moment
  (after the snapshot, before the restore), and the invariant is stated up front: *"config.yaml
  `model` must equal the pre-picker primary afterwards"*. The fixture uses `PermissionError`
  deliberately — *not* `SystemExit` — because the two are different failure modes for the
  restore path.
- **Edge cases & failure handling:** the auth file's mode is restored to `0o600` in `finally`;
  the exit code is asserted non-zero and the error text must contain `PermissionError`.
- **Surprising:** the probe reads the persisted config with the CLI's own loader rather than
  parsing YAML itself — the assertion is about what the product *reads*, not about the file.

### `evals/codebase_navigability/bench.py`
- **Purpose:** measures what a codebase costs an **LLM agent** to work in — "how much code must be
  read to see one definition?"
- **Key abstractions:** `source_modules`, `test_imports`, `resolve_definer` (follows re-exports up
  to depth 6), `top_level_defs`, `_reexports`, `cyclomatic`, `_tokenizer`.
- **Data flow:** the workload is *not hand-picked*: every `from <first-party module> import <Name>`
  in `tests/` (~19k tasks) is resolved through re-exports to the module that **defines** the name;
  per task it records file tokens, symbol tokens, overhead, whether the file fits 32k/128k, how
  many 2,000-line windows it spans, sibling top-level symbols and the symbol's cyclomatic
  complexity.
- **Non-obvious design decisions:** the `_PLUGIN_COMPAT_LAZY` dict is treated as a re-export
  table, because that is how the plugin system actually re-exports. Token counts use real
  `tiktoken` `o200k_base` and **fall back to bytes/4 with a label** if tiktoken is missing.
  `_is_alias` distinguishes a re-export (`x = y`) from a real definition.
- **Edge cases & failure handling:** `SKIP_TOP` excludes `evals`, `tests`, `docs`, `skills`,
  `apps`, `website`, `build`, `.venv`; unresolvable names are counted as `unresolved` rather
  than dropped silently.
- **Surprising:** the summary reports `tasks_file_over_128k` / `_over_32k` / `_over_8k` and
  `read_windows_2k_mean` — the metric is framed as *how many reads would a scanner need*, which
  is exactly how an agent experiences a god file.

### `evals/codebase_navigability/lookup_sim.py`
- **Purpose:** the complementary "skilled agent" cost — what a careful model actually pays to
  look a symbol up.
- **Key abstractions:** `index(tree)`, `grep_hits`, `simulate(name, idx, files, tok)`;
  `WINDOW = 2000`, `FIRST_READ = 200`, `MARGIN = 5`.
- **Data flow:** the simulated policy is exactly `grep -n` (1 call) → `read_file` a 200-line
  window around the hit (1 call) → page forward in 2,000-line windows only while the definition
  is still running; the cost charged is tool calls plus returned tokens.
- **Non-obvious design decisions:** the two trees are compared on the **intersection** of symbol
  names, so a symbol that moved to a smaller file counts as a win and a deleted symbol is
  excluded rather than scored as a loss. The sample is weighted toward names an agent would
  actually look up (public, not `__dunder__`, not `test_`).
- **Edge cases & failure handling:** the output includes `worst_regressions` and `best_wins`
  lists, so a summary metric cannot hide a bad case.
- **Surprising:** the README is explicit that this metric *barely moves* when a file is split —
  and that stripping comments makes a fixed 200-line window **more expensive** in tokens even
  though the code got smaller. Both effects are reported, not the flattering one.

### `evals/codebase_navigability/runtime_bench.py`
- **Purpose:** runtime benchmarks for one tree (import time, CLI startup, hot paths, pytest
  collection, bytecode footprint).
- **Key abstractions:** `IMPORT_TARGETS`, `CLI` probe table, the `hot` in-process `timeit` script.
- **Data flow:** every probe runs in a **fresh subprocess** with an isolated `HERMES_HOME` so
  nothing is cached across reps; results are medians + minima over reps.
- **Non-obvious design decisions:** the import probe **detects cross-tree contamination** by
  scanning `sys.modules` for any module whose `__file__` contains `hermes-agent` but is not under
  the tree under test (an editable install silently crossing-contaminates) and reports
  `FOREIGN_MODULES`. `PYTHONDONTWRITEBYTECODE` is explicitly `"0"` so bytecode is written and
  measured.
- **Edge cases & failure handling:** each probe is individually fault-tolerant: an import error
  becomes `err`, a missing attribute becomes `xxx_err` with a truncated repr, and the script still
  writes a complete JSON.
- **Surprising:** `pytest --collect-only` is measured as a first-class metric — "how fast the dev
  loop starts" is treated as a product property.

### `evals/codebase_navigability/static_metrics.py`
- **Purpose:** static shape metrics for one tree — LOC split, file/function size distributions,
  elif-chain lengths, nesting depth, radon CC/MI, import graph with Tarjan SCC cycles.
- **Key abstractions:** `code_lines(src)` (tokenize + ast docstring detection), `analyse(files)`,
  `radon(files)`.
- **Data flow:** source and tests are analysed separately; the import graph is built from
  `ast.Import`/`ast.ImportFrom` and reduced to first-party edges.
- **Non-obvious design decisions:** the LOC split is **pygount-style** — a line is "code" only if
  it carries a token that is not a comment, newline, indent or a docstring row. `elif` chains are
  counted by walking `orelse` chains, which is the shape a reader actually finds hard.
- **Edge cases & failure handling:** `ast.parse` failures are counted as `unparsable` and the file
  is skipped; radon failures degrade to `cc_error`/`mi_error` keys rather than aborting.
- **Surprising:** `sys.setrecursionlimit(20000)` is set before the Tarjan SCC walk — the import
  graph really does have cycles deep enough to blow the default recursion limit.

### `evals/codex_echo/fixture_server.py`
- **Purpose:** an **offline** JSON-RPC peer that speaks the Codex app-server protocol.
- **Key abstractions:** `send(value)`; the `ECHO_FIXTURE_MODE` env var; `item/completed` and
  `turn/completed` notifications.
- **Data flow:** reads newline-delimited JSON-RPC requests on stdin; answers `thread/start` and
  `turn/start`; then emits `item/completed` notifications for a user message (unless
  `assistant_only`) and an agent message, plus an optional later equal user message
  (`later_equal`).
- **Non-obvious design decisions:** the four modes (`echo`, `assistant_only`, `different`,
  `later_equal`) are the *rows of the ownership matrix* — they are the minimum set that
  distinguishes "the runtime owns the echo" from "the runtime double-wrote the input".
- **Edge cases & failure handling:** requests without an `id` are ignored (notifications).
- **Surprising:** the fixture deliberately echoes the *submitted* text back as a `userMessage`,
  so a client that naively appends the echo will double-write — the bug the probe hunts.

### `evals/codex_echo/probe.py`
- **Purpose:** runs the real Codex transport, projector, persistence and SQLite replay against the
  offline fixture, across 4 modes × 2 input shapes.
- **Key abstractions:** `codex_runtime._persist_projected_messages`;
  `agent._flush_messages_to_session_db`; `SessionPersistenceMixin`.
- **Data flow:** for each (mode, rich) it creates a session, appends a user message, flushes,
  runs a turn with either a plain string or a rich list (`text` + `image_url` data URI), persists
  the projected messages, and flushes again — **twice**, to test a repeated accepted input.
- **Non-obvious design decisions:** the expectation is `4` user rows for `different`/`later_equal`
  and `2` for the others — i.e. the *same input accepted twice* must produce exactly two user
  rows, never four. The `later_equal` mode exists to prove a *later identical* user event is not
  swallowed by a dedupe.
- **Edge cases & failure handling:** `assert turn.error is None` and
  `assert turn.final_text == "fixture reply"` fail fast; `session.close()`/`db.close()` in
  `finally`.
- **Surprising:** the rich (keyless) input variant exists because the image path historically took
  a different ownership branch than the plain-text path.

### `evals/codex_masked_replay_review.py`
- **Purpose:** local HTTP contract review of **masked-error recovery** for the Codex responses
  transport — when the provider returns "Request blocked" with no useful cause.
- **Key abstractions:** `scenario(name, provider, replay)`; the `ITEM` reasoning item with
  `encrypted_content`; `ERROR`; `digest(value)`.
- **Data flow:** a local SSE server emits either a `response.failed` terminal frame (the shape
  codex actually shows for a blocked turn), a 400 JSON error, or a normal completed response; the
  real `AIAgent` (api_mode `codex_responses`) runs with `reasoning_config={"effort":"high"}`.
- **Non-obvious design decisions:** the probe measures **retry stability**: `stable_retry_fields`
  checks that `reasoning`, `instructions` and `tools` hash identically across retries, so a
  deterministic rejection cannot burn retries with a *changing* request. It also checks
  `signed_payload_unchanged` — the provider's signed `encrypted_content` must be forwarded
  byte-identically, and `replay_enabled_after` records whether the runtime turned replay off
  after the failure.
- **Edge cases & failure handling:** `_api_max_retries = 3` is set deliberately "to show whether a
  deterministic rejection burns identical retries".
- **Surprising:** the `explicit_encrypted` scenario uses a *different* error code
  (`invalid_encrypted_content`) to separate "the signed item is the problem" from "the request
  is blocked for another reason".

### `evals/compaction/fixtures.py`
- **Purpose:** transcript loading, token estimation and a synthetic transcript generator for the
  compaction eval.
- **Key abstractions:** `estimate_tokens(msg)`, `total_tokens`, `load_transcript(path, cap_tokens)`,
  `synthetic_transcript(n_turns, seed)`.
- **Data flow:** a transcript is `{"messages": [...]}`; the cap takes a chronological prefix and
  then **drops trailing assistant `tool_calls` whose results were cut off** so the input is
  well-formed.
- **Non-obvious design decisions:** the token estimate is `chars/4` and is documented as *"the
  harness's scoring convention"* — the same convention is used for scoring before and after, so
  the ratio is meaningful even if the absolute number is not.
- **Edge cases & failure handling:** `load_transcript` accepts a bare list as well as a dict;
  the cap loop keeps at least 10 messages before breaking.
- **Surprising:** the synthetic transcript plants a distinctive fact every 10th turn ("The deploy
  code for region N is Z1234") so CI smoke tests can assert recall mechanics **without an LLM**.

### `evals/compaction/policies.py`
- **Purpose:** the compaction **policy matrix** — a name → spec map.
- **Key abstractions:** `POLICIES`; `apply_policy(compressor, spec)`; `EVAL_MODEL` /
  `EVAL_WINDOW`.
- **Data flow:** each spec has `ctor` (extra `ContextCompressor` kwargs), `attrs` (post-construction
  attribute overrides, e.g. `tail_token_budget`), and optionally `engine: "jev"` + `jev: {...}`.
- **Non-obvious design decisions:** `attrs` exists so a policy can pin a *derived* value
  (`tail_token_budget`) without editing the class — the matrix stays declarative and the
  production code stays untouched. The `jev_top60k` / `recent_top60k` pair is a **matched-budget
  A/B**: same retained size, ranked by the model's judgment vs by recency, so the only variable
  is the ranking.
- **Edge cases & failure handling:** unknown policy names are skipped by the runner, not fatal.
- **Surprising:** `codex_style` is a policy with `protect_last_n: 3` and a 2,000-token tail —
  "nearly no tail, the summary carries everything" — because a competitor's posture is a
  legitimate arm.

### `evals/compaction/report.py`
- **Purpose:** renders `scorecard.json` as a terminal table and a markdown table.
- **Key abstractions:** `main(out_dir)`.
- **Data flow:** sorts the scorecard by `recall_pct` descending and writes `scorecard.md`.
- **Non-obvious design decisions:** the `kept` column is `after/before` as a percentage — recall
  *and* retained size side by side, because a policy that scores higher while keeping 2× the
  tokens is not a win.
- **Edge cases & failure handling:** a missing `before_tokens` renders `?` rather than crashing.
- **Surprising:** the markdown file is written next to the JSON so the scorecard is a shareable
  artifact, not just terminal output.

### `evals/compaction/jev_arm.py`
- **Purpose:** a Python port of `fast-jev-compaction` as a *compaction eval arm* — replace the
  summary with per-tool-call keep/drop decisions from TypeSafe's Jev "System One" model.
- **Key abstractions:** `ToolCall`, `Decision`, `JevOptions`, `JevUsage` dataclasses;
  `collect_tool_calls`, `fit_state`, `batch_calls`, `questions_for`, `decide_call`,
  `apply_decisions`, `JevCompactor`, `fake_asker`.
- **Data flow:** the whole history (tool results replaced by a size note) is sent as `state`; two
  `noul` questions per candidate call ask whether the *call* and whether the *verbatim result*
  must stay; the transcript is rebuilt with nothing rewritten. Text messages are never touched.
- **Non-obvious design decisions:** `fit_state` is a **staged shrinker** — full → inputs≤200 →
  inputs≤60 → texts abridged → old messages collapsed → old calls compacted → old messages left
  out → old calls merged — and each stage is *recorded* (`state_stage`) so the scorecard can say
  which stage was binding. `is_pinned` protects the first and last N rows, and the ordering puts
  **unpinned entries first** so the shrinker spends the budget on the expendable parts first.
  The `select="recency"` mode never calls the model at all — it is the control.
- **Edge cases & failure handling:** if the state cannot be fitted, `fit_state` raises
  `ValueError("history too large for Jev …")`, which the runner records as `jev_fallback` rather
  than scoring an uncompressed arm. `apply_decisions` guarantees **no orphaned call/result
  pairs**: a dropped call takes its result row with it, and a dropped result keeps a bounded
  head plus a note naming the truncation.
- **Surprising:** `estimate_tokens` is a tokenizer-free port (letters/6, digits/2, symbols 0.9) —
  the eval can size a transcript without a tokenizer dependency, matching the plugin's own
  accounting so the ceiling is comparable.

### `evals/compaction/runner.py`
- **Purpose:** the compaction eval runner — the whole pipeline from transcript to scorecard.
- **Key abstractions:** `run_policy`, `_compress_with_policy`, `generate_questions`,
  `summarized_region`, `keyword_search`, `openrouter_price_usd`, `_AuxMeter`, `EVAL_USAGE`.
- **Data flow:** load + cap the transcript → generate (or load cached) recall questions **from the
  region the current policy would summarize** → per policy: compress, answer each question with
  only the compressed context, judge the answer against gold → write per-policy JSON and a
  `scorecard.json`.
- **Non-obvious design decisions:** several, and they are the most transferable ideas in this
  shard:
  1. **The question bank is generated from the most conservative boundary** — the region the
     *current* policy summarizes — so every policy is asked the identical exam
     (`runner.py:186`).
  2. **The default arm is `current+recovery`** — the production path, which is the summary *plus*
     one `session_search` round-trip. A bare policy name is closed-book and is documented as
     scoring 30+ points lower on needle questions; it exists to measure that floor, not to be
     used.
  3. **`keyword_search` simulates `session_search` on the real engine** — an in-memory SQLite
     **FTS5 + BM25** index with `snippet()`, degrading to term-frequency scoring if FTS5 is
     unavailable — so the retrieval quality in the sim matches production.
  4. **`_AuxMeter` monkeypatches the compressor's module-level `call_llm`** to total the
     *summary* spend separately from the harness's own exam spend (`eval_usage.json`).
  5. **A `--also-uncompacted` control arm** answers from the full transcript — the recall ceiling.
  6. The answerer is told to answer **"NOT IN CONTEXT"** and then guess, and the judge scores
     `"NOT IN CONTEXT; guess X"` as **1 (partial)** but a wrong guess as **0** — a rubric that
     rewards calibrated abstention over confident wrongness.
- **Edge cases & failure handling:** question banks are cached by `md5(transcript@cap)` so every
  arm answers the identical exam; a judge parse failure is recorded as
  `{"score": 0, "why": "judge parse failure: …"}` rather than aborting the run; a `jev` arm that
  throws is recorded as a fallback with `after_tokens: None`.
- **Surprising:** `openrouter_price_usd` prices *any* provider's summary call at OpenRouter's
  list price for that model id — a deliberate common yardstick so arms routed through different
  providers can still be compared on cost.

### `evals/compaction/scripts/build_html_report.py`
- **Purpose:** builds a self-contained HTML report comparing compaction runs side by side.
- **Key abstractions:** `msg_class(m)` (classifier for summary/skillpruned/digest/todosnap
  markers), `render_msg`, `render_column`, `survival_stats`, `stat`/`rows`.
- **Data flow:** pairs `runs/<checkout>_<session>.json` files by session id and renders three
  columns (BEFORE, AFTER-main, AFTER-PR) plus a diff table.
- **Non-obvious design decisions:** the diff table **highlights only rows that differ**
  (`class='diff'`), so the reader sees what changed rather than re-reading identical numbers.
  `survival_stats` counts how many before-messages survived verbatim (matched on the first 400
  chars), which is a direct measure of "how much of the transcript is still there".
- **Edge cases & failure handling:** content longer than 20,000 chars is truncated in the `<pre>`
  with a `[… N more chars]` marker rather than being silently dropped.
- **Surprising:** the report is a single HTML file with inline CSS — no asset pipeline, no server,
  openable from disk years later.

### `evals/compaction/scripts/codex_arm.py`
- **Purpose:** runs the **real Codex CLI** as an eval arm on the same transcripts and question
  bank, so a competitor's compaction is measured, not guessed.
- **Key abstractions:** `prepare_chunks`, `codex(args, prompt)`, `judge(question, gold, answer)`,
  `rollout_stats(path)`.
- **Data flow:** the 500K-token prefix is split into ~150KB chunk files; `codex exec` is told to
  `cat` every file completely and write a 2-3 sentence summary per file; the read volume exceeds
  codex's 258K window so its auto-compaction fires naturally; then `codex exec resume --last`
  answers the same 15 questions, and the same LLM judge scores them.
- **Non-obvious design decisions:** the arm **verifies its own premise** — `rollout_stats` counts
  `compacted` events and the peak context, and if compaction never fired the loop re-reads (up to
  3 extra passes) and finally prints *"WARNING: compaction never fired — arm invalid"*. An
  experimental arm that did not reach the condition it is measuring is invalid, and the harness
  says so.
- **Edge cases & failure handling:** answers are parsed out of the agent's numbered reply with a
  regex; an unparseable answer becomes `"(no answer parsed)"` and is scored, not skipped.
- **Surprising:** the quiz prompt explicitly forbids re-reading ("answer only from what you
  currently retain in context") and allows "UNKNOWN" — the same calibrated-abstention rubric the
  Hermes runner uses.

### `evals/compaction/scripts/jev_cycles.py`
- **Purpose:** simulates **repeated** compaction over a growing session, to expose the failure mode
  a one-shot recall score misses.
- **Key abstractions:** `tokens(ms)`, `text_floor(ms)`, the `cycles` list.
- **Data flow:** feed the lineage chronologically; whenever the estimate crosses the threshold,
  compact with the Jev arm and record the cycle (tokens before/after, percent freed, text floor,
  candidates, dropped, fitting stage, state tokens, requests, USD).
- **Non-obvious design decisions:** compaction only fires on a **well-formed boundary** (an
  assistant row with `tool_calls` whose result rows are present) — otherwise the transcript is
  malformed. The run **stops** when a cycle frees nothing (`stuck`) or the state cannot fit
  (`fallback`), and the text floor is tracked separately because that is the quantity that
  actually runs out.
- **Edge cases & failure handling:** a `ValueError` from the compactor is caught and recorded as a
  `fallback` cycle with the call count.
- **Surprising:** the README's diagnosis is the valuable part — *"it never removes user/assistant
  text, so each cycle frees only `threshold − text_floor` and the floor grows monotonically"*.
  The eval was designed to find a ratchet, and it did.

### `evals/compaction/scripts/jev_cycles_report.py`
- **Purpose:** renders the repeated-compaction table from `jev_cycles.py` outputs.
- **Key abstractions:** `describe(d)`.
- **Data flow:** one markdown row per run: cycles reached, raw session consumed, freed-per-cycle
  first→last, text floor first→last, and **how the run ended**.
- **Non-obvious design decisions:** the end-state vocabulary is graded — `still working` /
  `STUCK (floor ≥ threshold, 0% freed)` / `degraded: N tokens freed/cycle` / `fallback on cycle N`.
  A run that merely slowed down is visibly different from one that stopped.
- **Edge cases & failure handling:** a run with no scored cycles renders `—` for every metric
  rather than a misleading zero.
- **Surprising:** the report's *last* column is the verdict — the reader is meant to see that
  "still working" at cycle 40 is not the same as healthy.

### `evals/compaction/scripts/reconstruct_lineage.py`
- **Purpose:** rebuilds the **full uncompacted transcript** of a session lineage from a copy of
  `state.db`.
- **Key abstractions:** the `children` map from `parent_session_id`; `SYNTH_MARKERS`;
  the md5 dedupe key.
- **Data flow:** BFS the descendant tree from the root, sort by `started_at`, then walk each
  session's messages in id order, skipping synthetic compaction artifacts and de-duplicating
  rotation-copied rows by `md5(role + content + tool_calls)`.
- **Non-obvious design decisions:** the system prompt is resolved through the `system_prompts`
  **dedup table** (sessions only carry a hash) with a fallback to the inlined `system_prompt`
  column. The synthetic markers (`[CONTEXT COMPACTION`, `[CONTEXT SUMMARY`, `[PRIOR CONTEXT`,
  `preserved across context compression`) are stripped so the transcript is the *organic* history.
- **Edge cases & failure handling:** the docstring says "ALWAYS run against a COPY of state.db,
  never the live file" — the safety instruction is in the module docstring, where it will be read.
- **Surprising:** the dedupe-by-content-hash is what makes a rotation lineage (parent → compressed
  child → grandchild) reconstructable at all; without it every rotation would multiply the
  transcript.

### `evals/compaction/scripts/replay_lineage.py`
- **Purpose:** replays a ~500K-token prefix of a lineage through a given checkout's real
  `ContextCompressor`.
- **Key abstractions:** `tok(m)`; the prefix/alignment logic; the output JSON's `meta` block.
- **Data flow:** takes the chronological prefix at the token cap, **aligns the end** so it never
  ends on an assistant row whose tool results were cut off, then calls
  `comp.compress(prefix, current_tokens=before_tokens, force=True)` exactly as the live trigger
  would, and dumps before/after.
- **Non-obvious design decisions:** `force=True` and the 50%-of-window cap (500K of a 1M window)
  reproduce the *production* trigger condition rather than an artificial one. The `meta` block
  records `summary_error` and `todo_injection_block` so a silent summariser failure is visible in
  the report.
- **Edge cases & failure handling:** the trailing-orphan cleanup mirrors what
  `compress()`'s `_sanitize_tool_pairs` would do, but the comment says the input is kept clean
  deliberately rather than relying on the production sanitiser.
- **Surprising:** the script inserts the *checkout* on `sys.path` so the same transcript can be
  replayed through two different trees — this is the A/B primitive the whole shard rests on.

### `evals/compaction/test_region_scoping.py`
- **Purpose:** a **tripwire** proving the summariser only ever sees the region it is supposed to
  summarise.
- **Key abstractions:** `HEAD_SENTINEL` / `MID_SENTINEL` / `TAIL_SENTINEL`; `_mk_transcript()`;
  `run_mode(tail_mode)`.
- **Data flow:** a transcript with sentinels planted in the head, the middle (every 5th step) and
  the tail; `call_llm` is patched to capture the summariser prompt; the compression runs in both
  `legacy` and `lean` modes.
- **Non-obvious design decisions:** the assertion is on the **serialised TURNS body** — the text
  *before* the `"FOCUS TOPIC:"` marker — not on the whole prompt, because head/tail user messages
  are *intentionally* included in the focus-topic steering block. The test also asserts the tail
  and head survive in the output. The `lean` mode additionally checks the summary's
  "END OF CONTEXT SUMMARY" section for tail leakage.
- **Edge cases & failure handling:** `comp.tail_token_budget = 3_000` forces a real middle on the
  small fixture; both `agent.context_compressor.call_llm` and
  `agent.auxiliary_client.call_llm` are patched, so the test survives a call-site move.
- **Surprising:** the file is runnable directly (`python test_region_scoping.py`) *and* collects
  under pytest — a tripwire that can be used as a gate without a test framework.

### `evals/completion_backlog_probe.py`
- **Purpose:** proves the *completion backlog* (many background processes finishing at once) is drained exactly once, on every surface that drains it — CLI idle, TUI poller, and the post-turn hook.
- **Key abstractions:** `probe(surface, scenario, directory)`; the `ProcessRegistry`; a loopback HTTP "turn sink" that records each submitted turn.
- **Data flow:** real shell children are spawned through `registry.spawn_local`; the CLI's `chat` and the gateway's `_run_prompt_submit` are both pointed at the sink, so every drained notification becomes an observable turn.
- **Non-obvious design decisions:** the sink **replaces `chat/_run_prompt_submit` only** — ownership, consumption, queue draining, batching and formatting all stay real. Five scenarios cover `single`, `backlog`, `consumed`, `foreign` (a different session key must not drain it) and `mixed` (a delegation event interleaved with process completions). `payload_order` and `all_payloads_preserved` prove no notification is reordered or dropped.
- **Edge cases & failure handling:** the `foreign` scenario swaps the session key so the drain must be a no-op; `queue_remaining` must be 0 at the end; every spawned process is killed in `finally`.
- **Surprising:** `format_process_notification` is the single formatter used for the assertion, so the probe checks the *user-visible* string, not an internal event.

### `evals/core_tool_deferral/orchestrator.py`
- **Purpose:** the battery runner for the core-tool-deferral A/B (288 live runs).
- **Key abstractions:** `run_cell(cell)`; the `results/<model>/<arm>__<task>__rep<N>.json` layout; a `ThreadPoolExecutor`.
- **Data flow:** each cell is a `worker.py` subprocess with a per-task wall timeout; the result JSON is the unit of resume.
- **Non-obvious design decisions:** **errored records are deleted and retried** on the next run, while records with `score > 0` are kept — so a crash cannot be mistaken for a zero. `INFRA_ABORT` (exit 3) is counted and **three infra aborts stop the whole battery** rather than producing 288 poisoned cells.
- **Edge cases & failure handling:** a worker that exits non-zero without writing a file gets a synthetic zero-score record with the stderr tail; a wall timeout writes a zero-score record too.
- **Surprising:** the arm is the only variable — `base` and `pr` are two **plain checkouts**, never `pip install -e`.

### `evals/core_tool_deferral/report.py`
- **Purpose:** aggregates the deferral A/B into per-task and per-arm tables.
- **Key abstractions:** `load(model)`; the `MEAN-OF-TASK-MEANS` row.
- **Data flow:** reads every `*.json` under `results/<model>/` (skipping `*.transcript.json`) and computes per-task score spread, turns, tokens, wall and bridge calls.
- **Non-obvious design decisions:** the aggregate is a **mean of task means**, not a mean of runs, so a task with 6 reps cannot dominate a task with 3. The score column shows `mean [min-max]` so the spread is visible next to the mean.
- **Edge cases & failure handling:** errored runs are counted and listed at the end (`errored runs: n -> arm/task/rN: error`), and `raw-XML noise` runs are called out separately.
- **Surprising:** the "noise" bucket exists because some providers emit raw XML instead of tool calls — those runs are excluded from the score and named in the report.

### `evals/core_tool_deferral/sandbox.py`
- **Purpose:** keeps an eval agent's **host-level side effects** inside the run's sandbox.
- **Key abstractions:** `isolate_host(run_root, hermes_home)`; the `_CRONTAB_SHIM` shell script; `CRONTAB_FILE_ENV`.
- **Data flow:** pins every terminal child's `HOME` to `{HERMES_HOME}/home` via the product's own `TERMINAL_HOME_MODE=profile` contract, puts a file-backed `crontab` first on `PATH`, and drops `DBUS_SESSION_BUS_ADDRESS` / `XDG_RUNTIME_DIR` so `systemctl --user` cannot reach the real manager.
- **Non-obvious design decisions:** the docstring records the *reason* with a scar: *"a past run of `longrange_backup_pipeline` left three nightly cron jobs and two scripts on the operator's machine, pointing into run dirs that no longer existed."* The fix uses the product's own contract rather than a bespoke sandbox.
- **Edge cases & failure handling:** the shim supports `-l`, `-r`, `-e` and `-` so the agent's real `crontab` usage works; the crontab file lives in the run dir and is deleted with it.
- **Surprising:** the shim is a POSIX `sh` script, so the eval needs a POSIX host — a documented constraint, not an accident.

### `evals/core_tool_deferral/tasks.py`
- **Purpose:** the 14-task battery for the deferral A/B, one task per deferred tool plus controls.
- **Key abstractions:** `TASKS` (list of dicts with `id`, `prompt`, `fixtures`, `grade`, `timeout`, `clarify_answers`); the graders `g_screenshot`, `g_recall`, `g_clarify`, `g_cron`, `g_process`, `g_layout`, `g_preview`, `g_project`, `g_longrange`, `g_control`, `g_distractor`; the planted constants (`FOCUSED_APP`, `MED_FACT = "12.5"`, `BACKUP_REPO = "sparks-data"`, `TERMINAL_TAIL`).
- **Data flow:** `fixtures(ws)` writes the workspace; `grade(ctx)` reads the tool-call counts, the workspace files, the final answer and the persisted todo dump.
- **Non-obvious design decisions:** the graders give **partial credit** (0.15–0.6 per fact) rather than a binary pass, so a regression is visible in the gradient. `g_clarify` has a **FATAL branch**: if `prod.yaml` was deleted the score is forced to 0 and the run is annotated, so "acted without asking" and "acted destructively" are distinguishable. `g_process` opens a real socket to port 8123 to prove the server is really down.
- **Edge cases & failure handling:** `_grep_home` does a **binary-safe** grep over the whole `HERMES_HOME` tree (sqlite included) to prove a cron expression was persisted. `g_control` can subtract score (`-0.1`) for leaving the old value in place.
- **Surprising:** the planted constants are shared with the *session-DB seed* in `worker.py` — the recall and long-range tasks are answerable only by searching real prior sessions, and the seeds include decoys (a cat's dose, a "25 mg" typo).

### `evals/core_tool_deferral/worker.py`
- **Purpose:** one `(arm, model, task, rep)` cell of the deferral A/B, in an isolated subprocess.
- **Key abstractions:** the `TASKS` import; `clarify_cb` and the other callbacks; the registry stubbing (`_stub_entry`).
- **Data flow:** a temp `HERMES_HOME` + workspace, `isolate_host()`, a seeded `SessionDB` (targets + decoys), then a real `AIAgent` with 14 toolsets and the task prompt.
- **Non-obvious design decisions:** the hermetic env is built **before any hermes import**, and every `*_API_KEY`/`*_TOKEN` except `OPENROUTER_API_KEY` is popped. The desktop surfaces (`computer_use`, `image_generate`, `gui_tour`, `read_terminal`, `drive_preview`, `read_window_below`, `manage_connections`) are stubbed at the **registry handler** — not the schema — so the schema and the tool budget stay real. A "counting wrapper" around `_compress_context` keeps the real summariser out of the loop while still recording the trigger.
- **Edge cases & failure handling:** the **interactive-fairness continuation** sends up to 2 scripted replies when the agent ends its turn with a plain-text question, and counts them as `user_roundtrips` — the README says the first terra run was discarded for exactly this unfairness. A `grader crashed` is caught and scored 0 with the reason in `notes`.
- **Surprising:** `raw_xml_noise` is detected by looking for `<function=` in an assistant message — a provider-format failure recorded as a separate axis so it is not scored as a behaviour regression.

### `evals/cron_error_diagnostics.py`
- **Purpose:** a local-I/O A/B proving a failed cron run persists a useful traceback and lists a *reason*, with credentials redacted.
- **Key abstractions:** the injected `connection_failure` seam (a real SDK call to a **non-listening** loopback socket); `jobs.save_job_output`; `cron_list_lines`.
- **Data flow:** a job is created, `scheduler.run_job` is called with the seam patched to raise, the output is saved, the run is marked, and the job is listed.
- **Non-obvious design decisions:** the failure is a **connection refused** to a real loopback port, so the persisted output must contain both `Traceback (most recent call last)` and `Connection refused`. The error string returned to the caller stays **concise** (`RuntimeError: Connection error.`) while the full traceback lives in the saved output. Two separate fields are checked: `last_delivery_error` and `last_fire_error` must both be `None` (a fire failure is not a delivery failure).
- **Edge cases & failure handling:** a credentialed error message is injected and the listing must redact `password` and `secret-token` while keeping `localhost` (so the error is still diagnosable). A healthy script job is run as a control and must succeed with no error.
- **Surprising:** the docstring states the limit plainly — *"this does not diagnose the original macOS/Gmail incident"*.

### `evals/cron_timeout_fork_race.py`
- **Purpose:** proves the cron script timeout cleans up only the processes **it** owns, even when a child forks a detached grandchild.
- **Key abstractions:** `PR_SET_CHILD_SUBREAPER` via `ctypes`; the patched `psutil._ppid_map`; the `spawner.py` fixture.
- **Data flow:** a fixture script spawns a detached child, waits for a release file, then spawns a *late* child; the scheduler's own timeout is 2 s; the probe asserts the timeout message and that every recorded pid ended `gone` or `ZOMBIE`.
- **Non-obvious design decisions:** the probe makes itself a **child subreaper** so orphaned grandchildren are reparented to it and are therefore *visible* — without that, the late child would escape the check. The `scheduling_map` hook fires the release *exactly* at the moment the scheduler takes its snapshot, which is the race the probe is built around.
- **Edge cases & failure handling:** `psutil.Process().children(recursive=True)` is captured *before* the finally block so cleanup kills only what the probe spawned. The assertion accepts `ZOMBIE` because a reaped-but-not-waited child is a zombie, not a leak.
- **Surprising:** the comment *"The scheduling hook retains psutil's real snapshot; it never invents process state"* is the harness's core honesty rule.

### `evals/dashboard_auth/refresh_singleflight_live_e2e.py`
- **Purpose:** live E2E for the auth refresh **single-flight**: N concurrent stale-token requests must rotate the refresh token exactly once.
- **Key abstractions:** `SlowRotatingIdP(StubAuthProvider)`; the real `uvicorn` server; the real `hermes_cli.web_server` app.
- **Data flow:** 4 concurrent `/auth/native/refresh` calls, then 4 concurrent cookie-gated `/api/auth/me` calls, then a slow (3 s) refresh timed against a `/api/status` request.
- **Non-obvious design decisions:** the stub IdP **detects refresh-token reuse** and raises `RefreshExpiredError` — so a double rotation fails loudly rather than silently succeeding. The third case is an **event-loop wedge** test: a 3 s provider refresh must not block `/api/status` for more than 1 s.
- **Edge cases & failure handling:** the two refresh paths (bearer and cookie) are tested separately because they are separate code paths with the same contract; the verdict is a single `PASS`/`FAIL` line.
- **Surprising:** the file imports the repo's own `tests/hermes_cli/conftest_dashboard_auth.py` stub rather than re-implementing one — the harness reuses the test tree on purpose.

### `evals/delegation_group_schema/probe.py`
- **Purpose:** measures the **schema footprint** of the delegation tool, offline, with networking forbidden.
- **Key abstractions:** `get_tool_definitions(enabled_toolsets=["hermes-cli"])`; `tiktoken` `o200k_base`.
- **Data flow:** the environment is cleared and `socket.socket.connect` is monkeypatched to raise; the eager CLI tool definitions are assembled twice and serialised.
- **Non-obvious design decisions:** **byte-stability** is asserted: assembling the schema twice must produce identical bytes. The probe reports the *delegate* schema's token count separately from the total, so a change to one tool is visible against the whole.
- **Edge cases & failure handling:** JSON is written as the config file because JSON is valid YAML — the probe needs no YAML dependency.
- **Surprising:** it measures *schema tokens*, and the README says so: *"This measures schema footprint, not model quality or billed savings."*

### `evals/delivery_flood_wire.py`
- **Purpose:** a local-wire A/B of the **delivery ledger** under flood control — a failed delivery must be retried on a schedule and a *confirmed* delivery must never be resent.
- **Key abstractions:** the `Wire` class (a fake Telegram endpoint with per-chat deadlines); `delivery_ledger.record_obligation` / `mark_failed`; `_redeliver_failed_obligations_for_platform`.
- **Data flow:** two chats flood (429 with a `retry_after`), one is permanently forbidden (403), one belongs to a *foreign* bot. The probe waits 64 s and then runs two extra explicit sweeps.
- **Non-obvious design decisions:** the **foreign row** (a different adapter profile) must not be claimable by the connected default bot. The `boot` mode runs the producer in a **separate process** so the "real child owns the failed row and exits" path is exercised without a patched liveness predicate. `delivery_state`/`delivery_attempts` are read straight from the SQLite `delivery_obligations` table.
- **Edge cases & failure handling:** `cleanup` cancels the flood redelivery tasks and shuts the bot down; the probe asserts the *attempt count* and the final state, not just the wire.
- **Surprising:** the wire fixture implements Telegram's real 429 semantics (`parameters.retry_after`), so the runtime's own backoff logic is genuinely exercised.

### `evals/desktop-pane-fixture/vitest.config.mts`
- **Purpose:** replays a **slow module evaluation** without changing any pane behaviour or deadline.
- **Key abstractions:** a Vite plugin with `enforce: 'post'` that appends an 11 s await to the real pane-tree store's transform.
- **Data flow:** the transformed module is the production `components/pane-shell/tree/store.ts`; the config merges the app's own `vite.config.ts`.
- **Non-obvious design decisions:** the README insists the fixture *"does not mock pane functions, inspect source text in an assertion, lower a deadline, or alter the two test bodies"* — the delay is injected at the module boundary, not into the behaviour under test. `testTimeout: 15_000` and the default 10 s hook deadline are left alone.
- **Edge cases & failure handling:** the marker appears twice on base and once on the fixed tree, which is how the A/B is recognised.
- **Surprising:** this is a *scheduling-controlled* reproduction of import latency — explicitly "not a claim that a local machine reproduced the original CI load unassisted".

### `evals/desktop-reap-clock-pressure.cjs`
- **Purpose:** replays scheduling pressure on `Date.now()` without changing what it returns.
- **Key abstractions:** a `NODE_OPTIONS --require` preload that wraps `Date.now` and parks the calling thread for 5 ms when the stack contains `electron/backend-ownership.ts`.
- **Data flow:** the wrap is transparent to callers; only the *timing* changes.
- **Non-obvious design decisions:** the interception is **stack-scoped** — it only slows the specific module under test, so other code sees normal clock behaviour. The comment explains why: *"The old 1ms fixtures can expire before their first record is processed."*
- **Edge cases & failure handling:** `Atomics.wait` with a 5 ms timeout is used so the wait is bounded and the process cannot hang.
- **Surprising:** a 540-byte file that is one of the most useful ideas in the shard — **pressure without changing the clock's answers**.

### `evals/desktop_bug_campaign/async-report-producer.py`
- **Purpose:** builds real completion envelopes and reads back the durable SQLite rows.
- **Key abstractions:** `format_process_notification`; `persist_delegation_delivery`; `SessionDB`.
- **Data flow:** a cron job's output is saved and formatted, then six envelope shapes (cron, process, batch, legacy, plain, malformed) are persisted into five sessions and read back.
- **Non-obvious design decisions:** the fixture report contains a heading, a bold conclusion, a **table**, a hard break, and a fenced code block — every markdown shape the renderer must handle. The batch case carries a **multiline goal** because the producer does not flatten goals. The `malformed` case's envelope is a deliberately broken string.
- **Edge cases & failure handling:** `stored_exactly` asserts the row content equals the envelope byte-for-byte; `model_requests: 0` is printed as proof no model was involved.
- **Surprising:** the "process" case is an async-delegation event through the process formatter, *not* a terminal process completion — the README says so explicitly to stop a future reader from mis-reading the fixture.

### `evals/desktop_bug_campaign/async-report-probe.tsx`
- **Purpose:** the React entry that renders the **production** chat components for the async-report probe.
- **Key abstractions:** `toChatMessages` (current) vs `baselineHydrate` (`git show a688e7d5…:apps/desktop/src/lib/chat-messages/hydration.ts`); `useExternalStoreRuntime`; `SystemMessage`.
- **Data flow:** the Vite server aliases `@baseline-hydration` to a file extracted from a pinned commit; the Playwright script loads `/async-report-probe.html?baseline` or without, calls `window.renderProducer(rows)` and reads back headings, tables, `<strong>` counts and the text.
- **Non-obvious design decisions:** the baseline is extracted with `git show` at run time, so the "before" is a **real commit**, not a hand-written mock.
- **Edge cases & failure handling:** `pageerror` events are collected and printed; the comparison is "headings and tables are absent before and present after, plain results survive, malformed envelopes remain compact".
- **Surprising:** this is how Hermes A/Bs a *renderer* change: pin the baseline module, alias it, render both, diff the DOM.

### `evals/desktop_bug_campaign/async-report-vite.mjs`
- **Purpose:** the Vite dev server that serves the async-report probe page and resolves the pinned baseline module.
- **Key abstractions:** the `@baseline-hydration` alias; the `configureServer` middleware that rewrites `FIXTURE_ENTRY` to the TSX entry.
- **Data flow:** serves `/async-report-probe.html` on loopback with the TSX entry transformed by Vite.
- **Non-obvious design decisions:** the Vite `cacheDir` is deliberately placed *under* a `node_modules` directory, because "Babel must not compile optimized deps".
- **Edge cases & failure handling:** the server binds a fixed port so the probe and the driver agree.
- **Surprising:** the "before" arm is a *git object*, not a fixture file.

### `evals/desktop_bug_campaign/async-report-live.mjs`
- **Purpose:** the Playwright driver that renders each producer case before and after and diffs the DOM.
- **Key abstractions:** `window.renderProducer(rows)`; the `?baseline` query switch.
- **Data flow:** for each case it loads the page, projects the rows, waits for the system message, harvests headings/tables/`<strong>`/text, and writes `before.json` / `after.json` plus a screenshot.
- **Non-obvious design decisions:** the source sha is recorded in the receipt (`git rev-parse HEAD`), so the artefact names the tree that produced it.
- **Edge cases & failure handling:** `page.on('pageerror')` collects renderer errors; the exit status follows the comparison.
- **Surprising:** the "before" and "after" are two runs of the *same* script with one argument.

### `evals/desktop_bug_campaign/history_live.py`
- **Purpose:** a real serve + HTTP + WebSocket **history witness** against seeded SQLite data.
- **Key abstractions:** `session.resume` / `session.history` / `session.activate` over the real WebSocket; `SessionDB`.
- **Data flow:** a session with a codex-style sidecar (`codex_message_items`, `reasoning`, a tool call and its result) is seeded; the probe opens a WebSocket, resumes lazily, reads the history, then resumes again, activates, and reads the history a second time.
- **Non-obvious design decisions:** the sidecar row is the interesting case — the assistant message's content is empty and the real answer lives in `codex_message_items`, so a history reader that only looks at `content` sees nothing. The probe asserts the answer is present in `messages[1]` for both reads.
- **Edge cases & failure handling:** a "control" session with a plain reply proves the reader is not just echoing a fixture; the server is terminated in `finally` and the log is closed.
- **Surprising:** the probe writes two receipts — the RPC transcript *and* the raw frames — so a future reader can re-derive the verdict.

### `evals/desktop_bug_campaign/hooks_live.py`
- **Purpose:** proves the **`pre_tool_call` hook** gates a tool call for every consented profile, and that an unapproved profile's hook does not run.
- **Key abstractions:** the `Provider` fixture (deterministic SSE tool call); the `guard.py` hook script; `hooks_auto_accept`.
- **Data flow:** four profiles (default, alpha, beta, unapproved) each with a `config.yaml` declaring a `pre_tool_call` hook; the real `hermes_cli.main serve` is started; a `prompt.submit` is sent per profile and the completion is awaited.
- **Non-obvious design decisions:** the hook script prints `{"decision":"block", …}` — the tool must be blocked and the protected file must **not exist**. The probe asserts the hook was called **exactly once** per consented profile (`hook_calls - hook_calls_before == 1`) and **zero** times for the unapproved one. `alpha` is run twice to show the count is per-session, not cumulative.
- **Edge cases & failure handling:** `HERMES_IGNORE_RULES=1` and a scrubbed env keep the run hermetic; the receipt records the sha *and* the blob hash of `tui_gateway/server.py`, so the receipt identifies the exact code that ran.
- **Surprising:** the "unapproved" profile is a separate case precisely because a hook that runs without consent is the failure mode worth pinning.

### `evals/desktop_bug_campaign/leases_live.py`
- **Purpose:** real backend subprocesses + WebSocket, proving the **lease and orphan-reap** recovery paths.
- **Key abstractions:** the `/lease-probe/{action}/{sid}` control endpoint; `dispatch_async_delegation`; `_reap_idle_sessions`.
- **Data flow:** two backend processes on 18040/18041; a session is created on the first, a second backend tries to use it and must be fenced (error code `4090`); the first disconnects, the orphan timer is cancelled by fault injection, and a reconnect must retain the same runtime.
- **Non-obvious design decisions:** the fault injection is *surgical*: `lose-timer` cancels the pending reap and `lose-detach` additionally restores the **real closed transport** so the model can see missed detachment. The probe then asserts the "same backend reconnect retains runtime" — a repaired grace period must not mint a new session.
- **Edge cases & failure handling:** while a delegation is in flight, the foreign backend must stay fenced; after the delegation finishes, the periodic maintenance must **recover the lost timer** and the foreign backend may finally submit. The reply is checked to be persisted to the *receiver's* database.
- **Surprising:** the two faults (lost timer vs lost detach) are separate cases, because a fix for one does not fix the other.

### `evals/desktop_bug_campaign/linux_launcher_probe.py`
- **Purpose:** a real Linux venv + XDG probe of the desktop **launcher entry** installation.
- **Key abstractions:** `venv.EnvBuilder(with_pip=False, symlinks=True)`; a `probe.pth` that puts the tested checkout first and then the real dependencies.
- **Data flow:** the real `install_desktop_entry` writes a `.desktop` file; the probe reads the generated `Exec=` line and runs it with `--help`.
- **Non-obvious design decisions:** the `probe.pth` puts the **tested checkout before its editable install**, so the probe cannot accidentally test an installed copy. The probe asserts the *base* interpreter cannot import the deps (`base_import_negative`) while the venv can — that is the whole bug class. `stable_rewrite` asserts a second install is byte-identical, and `custom_preserved` asserts a user-edited entry is not clobbered when `manage_launcher_entry: false`.
- **Edge cases & failure handling:** the probe asserts the generated `Exec` does **not** contain the resolved base interpreter path (resolving the symlink would discard the venv).
- **Surprising:** the fidelity line says it plainly: *"real venv, native Linux XDG installer, real generated argv --help; NOT Electron window/menu-click proof."*

### `evals/desktop_bug_campaign/markdown-producer.py`
- **Purpose:** the Markdown-only producer — a cron completion through the real formatter and durable delivery, with no model and no backend.
- **Key abstractions:** `save_job_output`; `_manual_run_completion`; `format_process_notification`; `persist_delegation_delivery`.
- **Data flow:** a markdown report is written, formatted, persisted, and read back from SQLite.
- **Non-obvious design decisions:** the report deliberately contains every markdown shape at once — heading, bold, a table, a hard line break, and a fenced code block — so one fixture exercises the whole renderer. `display_kind` is read from the row.
- **Edge cases & failure handling:** `report_preserved` asserts the report text is inside the stored row, not just echoed back.
- **Surprising:** the split from the async-report lane is deliberate: "the separate async-report lane owns #101078", and the history of the combined fixture is recorded in a commit sha.

### `evals/desktop_bug_campaign/native_ready_probe.mjs`
- **Purpose:** a real backend plus the **production READY parser**, with no Electron renderer.
- **Key abstractions:** `waitForDashboardPortAnnouncement` (imported from the production `electron/backend-ready.ts`).
- **Data flow:** `hermes_cli.main serve --port 0` is spawned; the production parser reads the child's stdout; the probe then polls `/api/status` and `/api/profiles` and opens the WebSocket for 90 s.
- **Non-obvious design decisions:** the probe *"matches production's synchronous attach-then-wait order, without synthetic output"* — the parser is the real one, fed by a real child. The child is launched with `--port 0` so the port is chosen by the OS and the parser is genuinely exercised.
- **Edge cases & failure handling:** the loop fails fast if the backend exits or the WebSocket closes, rather than waiting out the 90 s.
- **Surprising:** the final line is honest about its limits: *"not full Electron UI proof"*.

### `evals/desktop_bug_campaign/navigation-markdown-probe.tsx`
- **Purpose:** the React entry that mounts the **production** Markdown renderer for the whitespace probe.
- **Key abstractions:** the `ingress` map (assistant, media, preview, embedded, generated); the `samples` map (hard, soft, indented, unfinished, code, blanks); `MarkdownTextContent`; `preprocessMarkdown`.
- **Data flow:** each sample is put through five ingress transforms, rendered, and read back: `<br>` count, `code` textContent, whether Shiki highlighted, and the **real clipboard** after clicking the code card's Copy control.
- **Non-obvious design decisions:** the expected code text is the parser's **final LF included** — *"we preserve its raw payload rather than arbitrarily trimming it"*. The `unfinished` fence (no closing ```) and the trailing-space case are the shapes that break naive whitespace handling.
- **Edge cases & failure handling:** the probe asserts on `dom.code === expectedCode && copy === expectedCode` — the DOM *and* the clipboard must agree.
- **Surprising:** the harness asserts **30 cases** and treats a non-zero exit as a failed assertion or a page error, and keeps the JSON + screenshot.

### `evals/desktop_bug_campaign/navigation-vite.mjs`
- **Purpose:** the Vite server for the Markdown-renderer probe.
- **Key abstractions:** the `configureServer` middleware that serves `/navigation-markdown-probe.html`.
- **Data flow:** transforms the TSX entry and serves it on loopback port 18160 (`strictPort: true`).
- **Non-obvious design decisions:** the `cacheDir` keeps the `node_modules` segment so Babel must not compile optimised deps.
- **Edge cases & failure handling:** `strictPort` means a port clash fails loudly rather than silently moving the port.
- **Surprising:** the whole renderer probe needs no Electron — just a Vite server and a browser.

### `evals/desktop_bug_campaign/navigation-markdown-live.mjs`
- **Purpose:** the Playwright driver for the Markdown-renderer probe.
- **Key abstractions:** the sample/ingress matrices; the code card's Copy control.
- **Data flow:** renders every sample, reads the DOM, clicks Copy, reads the clipboard back, and writes the JSON + a screenshot.
- **Non-obvious design decisions:** the clipboard is read from the **real** system clipboard, not from a stub, so a copy handler that writes the wrong string is caught.
- **Edge cases & failure handling:** a non-zero exit or a `pageerror` fails the run; the artefacts are kept.
- **Surprising:** the same sample is rendered under five different ingress transforms, because a Markdown string's meaning depends on where it came from.

### `evals/desktop_bug_campaign/persistence_live.py`
- **Purpose:** a real serve + WebSocket probe of **profile rebuild ownership** — a session's rows must land in the right profile's database.
- **Key abstractions:** `probe.ownership` (added by `rebuild_observer.py`); `session.compress`; `tools.configure`.
- **Data flow:** a session is created in the `worker` profile, a turn is run, then a rebuild is forced (by touching a `fail-rebuild` marker) and a second turn is run; the probe then reads **both** `state.db` files.
- **Non-obvious design decisions:** the core assertion is `wrong_profile_writes` — the rebuild must not write the next turn into the *launch* store. The `--compress` case additionally checks that compaction retains archived generations and that there are **zero duplicate active groups** (`SELECT … WHERE active=1 GROUP BY role, content HAVING COUNT(*)>1`). The `--invalid-targets` case checks that a stale session cannot change the launch config and that a global `tools.configure` *can*.
- **Edge cases & failure handling:** `read_user_config_raw` is used to read the worker profile's toolsets, so the assertion is about the product's own view of the config. The ownership probe reports `owns_db` and the DB refcount so a leak is visible.
- **Surprising:** `rebuild_observer.py` injects a failure by *raising inside a patched `_config_model_target`*, keyed on the call stack containing `_reset_session_agent` — a failure at exactly one point in a real rebuild, without patching the predicate itself.

### `evals/desktop_bug_campaign/rebuild_observer.py`
- **Purpose:** a probe-only serve bootstrap that observes real ownership and injects one config-read failure.
- **Key abstractions:** `server._config_model_target`; `hermes_state_registry._generations`; the `probe.ownership` RPC.
- **Data flow:** the patched target raises once (the marker file is unlinked first, so it is a one-shot), and the `probe.ownership` method returns the agent id, `owns_db`, and the per-DB refcounts.
- **Non-obvious design decisions:** the failure seam is chosen by **call stack inspection** — `any(frame.function in {"_reset_session_agent", "_sync_bot_capabilities"} ...)` — so the failure lands at a real rebuild point instead of anywhere. The module docstring states it plainly: *"Not imported by production."*
- **Edge cases & failure handling:** the refcount map is read under the registry's lock; the ownership RPC is added to `server._methods` so the real dispatcher serves it.
- **Surprising:** the probe asserts `teardown leaked profile DB ref` — a *leak* of a database reference is a first-class failure, not a detail.

### `evals/desktop_bug_campaign/thread-scroll/fixture.tsx`
- **Purpose:** the React fixture that renders the production `Thread` with a synthetic 200-message transcript and exposes the scroll probe API.
- **Key abstractions:** `metrics()` (`top`, `height`, `scrollHeight`, `following`, `gap`); `window.scrollProbe` (`run`, `grow`, `scope`, `remount`, `partial`, `release`); `startTransition` for the deferred hydration.
- **Data flow:** Playwright drives real wheel input and reads the viewport geometry the fixture publishes.
- **Non-obvious design decisions:** the probe reads `x.dataset.following` — the app's own "am I following the tail" flag — rather than inferring it from scroll maths. The `partial` case parks a remembered offset and then releases the rest of the history inside a `startTransition`, so the "clamped restore" race is reproduced.
- **Edge cases & failure handling:** the assertions use **tolerances in pixels** (15 px for remount/reload, 32 px for the hydration race) and the README records the drift history: 323 px historically, 72 px, then 17 px, now 0 px.
- **Surprising:** the `?twins` mode mounts two independent Threads for diagnosis but the automated probe expects one viewport.

### `evals/desktop_bug_campaign/thread-scroll/ownership-probe.mjs`
- **Purpose:** the diagnostic variant of the scroll probe that shows *which* thread owns the scroll.
- **Key abstractions:** the `?twins` query mode.
- **Data flow:** mounts two independent Threads and reports each one's `following` state and gap side by side.
- **Non-obvious design decisions:** the automated probe deliberately expects **one** viewport; the twins mode exists so a human can attribute a jump to one of the two threads.
- **Edge cases & failure handling:** the diagnostic is opt-in; it is not part of the pass/fail path.
- **Surprising:** the "ownership" question (whose scroll state wins) is separated from the "distance" question (how far from the bottom).

### `evals/desktop_bug_campaign/thread-scroll/probe.mjs`
- **Purpose:** the automated scroll probe — the pass/fail half of the pair.
- **Key abstractions:** the case list (load, read, switch-away, switch-back, scroll-up, reload, live growth).
- **Data flow:** real wheel input (`page.mouse.wheel`), then `metrics()` after each step; the result JSON is written per tag.
- **Non-obvious design decisions:** the live-growth case asserts both that the gap grew **and** that the reader's `top` did not move — "live growth below the reader must not move their viewport". The continuation "observes late Markdown/intrinsic-row resizes until reader input or a live run takes over".
- **Edge cases & failure handling:** the browser is closed in a `finally`; each assertion is a named `assert.ok` with the metric it concerns.
- **Surprising:** the A→B→A assertion is "the reading distance must be **preserved**", not "restored to the bottom" — the reader's intent, not the app's convenience, is the contract.

### `evals/desktop_gateway_ticket_native/build.mjs`
- **Purpose:** bundles the Electron-main probe with the **locked esbuild**.
- **Key abstractions:** `createRequire` resolved against `apps/desktop/package.json`; `build({ bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] })`.
- **Data flow:** `run.py` calls it to produce `electron-main.cjs` (or the multiplex variant) in a temp dir.
- **Non-obvious design decisions:** the `nodePaths` include both the root and `apps/desktop` `node_modules`, so the production imports resolve. `external: ['electron']` keeps the real Electron module, not a stub.
- **Edge cases & failure handling:** a missing esbuild fails the probe at build time, before any daemon is started.
- **Surprising:** the bundle is fed to a **real Electron binary** — the README insists the probe runs in "Electron main (`process.type === 'browser'` and a real `process.versions.electron`), not Node with a forged platform".

### `evals/desktop_gateway_ticket_native/electron-main.ts`
- **Purpose:** the native ticket probe — proves a gateway ticket is **single-use**, bound to one instance/profile/epoch, and cannot be minted for a wrong instance or a sibling profile.
- **Key abstractions:** `mintLocalGatewayTicket`; `nativeGatewayHttpHeaders`; `mintGatewayTicketWithPython`; `describe(ticket, replay)`.
- **Data flow:** the production ticket client is configured, an HTTP `GET /api/config` is made, the same grant is **replayed** (must be 401/403), a WS `runtime.describe` is made with the ticket, and the ticket is replayed on the WebSocket.
- **Non-obvious design decisions:** the **negative controls are against a live sibling**, not a missing socket: "Combining its profile with the first owner's instance must not mint a usable credential". A **positive control runs after the negatives** to prove the listener survived repeated clients. The receipt records `wrongOsOwnerSid: { status: 'not_exercised' }` even when everything else passes — an unimplemented check is reported, never hidden.
- **Edge cases & failure handling:** a 90 s watchdog calls `app.exit(2)`; the receipt is written in `finally`; tickets are never printed or retained in the receipt.
- **Surprising:** the README's "Explicit limits" section is a model of honesty: it lists exactly which claims this probe does **not** support (Windows named pipes, macOS socket permissions, a real second-account SID).

### `evals/desktop_gateway_ticket_native/electron-main-multiplex.ts`
- **Purpose:** the **multiplex attach + cold-profile mutation** acceptance case for the local-pool cutover.
- **Key abstractions:** `runGatewayEnsure` → `ensureLocalGateway`; `sidebarPatch` (a byte-for-byte copy of `mutateSessionHttp`).
- **Data flow:** one `gateway.run` serves default + warm + cold; each profile attaches through the production Desktop path; a session is created in `cold` over an interactive attach, the socket is terminated (it goes cold), and the session is archived and unarchived over the exact `PATCH /api/sessions/{id}` shape the renderer sends.
- **Non-obvious design decisions:** the PATCH body carries `{request_id, expected_revision, expected_generation}` read from a `mutation-snapshot` GET — a **compare-and-swap** on the revision, which is how the archive/unarchive is made safe. The unarchive must bump the revision by exactly 1.
- **Edge cases & failure handling:** the default profile's descriptor must get **403** on the cold profile's rows, and the warm attachment must still be live after the cold mutation.
- **Surprising:** the README names this as "the acceptance case for the local-pool cutover (PR #106742, cold-profile archive report)".

### `evals/desktop_gateway_ticket_native/run.py`
- **Purpose:** the driver — launch ordinary disposable gateway daemons, run the real Electron main against them, and clean up.
- **Key abstractions:** `stop_owned(process)`; `query_identify(home, timeout=2)`; the allowlisted child env.
- **Data flow:** two `python -m gateway.run` processes with temporary HOME/USERPROFILE/HERMES_HOME; the Electron bundle is launched with `NATIVE_TICKET_INPUT` pointing at a JSON file; the receipt is read back and the exit status checked.
- **Non-obvious design decisions:** the child env is an **allowlist** (PATH, SYSTEMROOT, DISPLAY, …) — no provider credentials reach the daemon. `stop_owned` kills descendants in reverse order, waits, and then force-kills survivors. The venv launcher path is **not** resolved to its base interpreter.
- **Edge cases & failure handling:** `receipt['ownedProcessesStopped']` asserts every owned process is gone; the temp directory is cleaned up in `finally`.
- **Surprising:** the README says to *"Inspect both downloaded receipts, not just job conclusions"* — a green CI job is not the evidence.

### `evals/desktop_gateway_ticket_native/run_multiplex.py`
- **Purpose:** the multiplex driver — one gateway serving several profiles, with the real Desktop attach path per profile.
- **Key abstractions:** the `gateway.multiplex_profiles: true` config; the per-profile `runGatewayEnsure` invocation.
- **Data flow:** starts ONE `gateway.run` serving default + warm + cold, then drives the production attach and the `PATCH /api/sessions/{id}` mutation shape per profile.
- **Non-obvious design decisions:** the same `ensureLocalGateway` child (`hermes --profile <p> gateway ensure --json`) is used, so the probe exercises the *product's* admission path rather than a shortcut.
- **Edge cases & failure handling:** the receipt records each profile's instance id, epoch and `control_home`.
- **Surprising:** one multiplexer serving three profiles is the topology the acceptance case is written for.

### `evals/desktop_gateway_ticket_native/workflow.yml`
- **Purpose:** the temporary native CI workflow.
- **Key abstractions:** real `windows-latest` and `macos-latest` jobs; a push trigger on an `e2e/native-ticket-*` branch.
- **Data flow:** `uv sync --locked` + root `npm ci`, then the probe per OS, uploading the per-OS receipts.
- **Non-obvious design decisions:** the file is deliberately **outside `.github`** so it cannot run on the default branch; the header says "Never merge this temporary workflow."
- **Edge cases & failure handling:** it needs no secrets, and a dispatch on a non-default workflow alone is insufficient — a push trigger is required.
- **Surprising:** the README insists on inspecting *both downloaded receipts*, not just the job conclusions.

### `evals/desktop_mcp_oauth/backend_http_fixture.py`
- **Purpose:** a credential-free live OAuth/MCP persistence probe — real discovery, dynamic registration, PKCE, token persistence and a fresh-process authenticated MCP call.
- **Key abstractions:** the `Provider` server (RFC 8414 metadata, `/register`, `/authorize`, `/token`, `/mcp`); `mcp_oauth_sessions`; `HermesTokenStorage`.
- **Data flow:** a flow is started against a *remote* redirect URI, a real browser-like HTTP GET follows the authorize redirect to a local callback server, and the callback is delivered; then a `--cold-probe` re-execs proves a **fresh process** can use the token from disk without re-authorising.
- **Non-obvious design decisions:** the negative controls are the interesting part: wrong state, wrong server, wrong owner, **callback replay**, and a cross-profile attempt where the *session id and a valid state are supplied* and must still be rejected. The owner's own callback must still work afterwards. The token file must be mode `0o600`.
- **Edge cases & failure handling:** the provider's `log_message` is a no-op so callback queries, codes and bearer headers are never logged. The receipt contains booleans and paths, never token material; the token files are verified and then deleted with the temp HOME.
- **Surprising:** the probe re-execs itself with `--isolated-worker` under a scrubbed env, and the parent asserts the temp home was removed.

### `evals/desktop_mcp_oauth/renderer_lifecycle.mjs`
- **Purpose:** the renderer half of the MCP OAuth check — the real `McpTab` in Chromium against a fixture backend and a registration-only Electron IPC adapter.
- **Key abstractions:** the esbuild'd `mcp-oauth-callback-ipc.ts` loaded with a fake `electron.ipcMain`; the `mcp.servers.oauth.*` WebSocket fixture; `window.hermesDesktop` (`api`, `getConnectionFor`, `mcpOauth`, `openExternal`).
- **Data flow:** the user clicks Authenticate; the app opens the authorize URL; the `openExternal` stub either follows the callback (approved) or triggers the cancel/unmount flow.
- **Non-obvious design decisions:** three scenarios — `approved`, `cancel`, `unmount` — and the two abandonment scenarios must **both** cancel the backend session *and* close the native listener, and must **not relay a callback**. The `approved` scenario asserts the native flow was used and that **no REST `/auth` request was made**.
- **Edge cases & failure handling:** cleanup must retain the *original* owner (`scope.profile === 'profile-b'`), so a cancelled tab cannot steal the connection.
- **Surprising:** the README notes the approved assertion **fails before** the shared relay change and the cleanup assertions fail on the checkout immediately before the scoped-tab cleanup — each probe is pinned to the defect it reproduces.

### `evals/fanout_resource_bench.py`
- **Purpose:** measures the **host's** resource cost of a fan-out of N child agents through the real `delegate_task` path.
- **Key abstractions:** `_snap(pid, db_path)`; `_count_live(cls_name)` (via `gc.get_objects`); the fake OpenAI server.
- **Data flow:** 24 children are dispatched across 6 real git worktrees (so the LSP/pyright path is exercised for real); the host's threads, RSS, fds, TCP sockets, child processes, `state.db` size and live Python object counts are sampled every 0.5 s.
- **Non-obvious design decisions:** the children edit **python files in real worktrees** specifically so pyright starts — that is the expensive part being measured. The snapshot counts `httpx` `Client`/`HTTPTransport` objects and `SessionDB`/`AIAgent` instances by class name, so a leak shows up even when the process count looks fine.
- **Edge cases & failure handling:** the worktrees are real git repos with a `pyproject.toml` so the LSP roots resolve; `gc.collect()` runs before the "after" snapshot; the process exits with `os._exit(0)` after shutting down the LSP and kernels, so nothing lingers.
- **Surprising:** `--compare a.json b.json` prints a markdown delta table — the bench is designed to be run twice and diffed.

### `evals/gateway/session_time_persistence_ab.py`
- **Purpose:** a real `SessionStore`/SQLite A/B proving that **elapsed-time session rotation does not discard the routed conversation**.
- **Key abstractions:** `GatewayConfig.from_dict({"default_reset_policy": {...}})`; `SessionStore`; `store.reset_session`.
- **Data flow:** for each policy mode (`idle`, `daily`, `both`, `none`) a session is created, two messages are appended, the session is aged three days and marked `resume_pending`, and the store is re-opened.
- **Non-obvious design decisions:** the same script runs against four policy modes to show the *policy* is irrelevant to the invariant — the routed messages survive in all of them. An **explicit** `reset_session` must still rotate, with `end_reason == "session_reset"`.
- **Edge cases & failure handling:** the assertion requires `same_session`, `routed_messages == 2` and `explicit_rotated` **together** — a "fix" that simply disabled rotation would fail the explicit-rotation check.
- **Surprising:** the mode list includes `"none"` precisely so that a reader can see the no-rotation case is not special-cased.

### `evals/gateway/session_time_persistence_controls.py`
- **Purpose:** isolated production-library controls for the same area — the legacy YAML/env keys must be **ignored**, and the agent cache must release memory without losing the transcript.
- **Key abstractions:** `AgentCacheBounds`; `_sweep_idle_cached_agents`; `_sweep_agent_cache_under_pressure`; `_enforce_agent_cache_cap`.
- **Data flow:** three strategies (`ttl`, `lru`, `pressure`) are each exercised against a real `GatewayRunner` with a stubbed agent; the `commit_memory_session` / `release_clients` order is recorded.
- **Non-obvious design decisions:** the release order is asserted exactly (`["memory", "release"]`) — memory must be **committed before the clients are released**, or the transcript is lost. An *unflushed* agent must survive the pressure sweep. A `ws_orphan_reap` end reason must **reopen the same transcript**, while an explicit `suspend_session` must rotate it. A migration script's `migrate_session_config` must **ignore** timer settings and archive them instead.
- **Edge cases & failure handling:** the legacy `session_reset` YAML and `SESSION_IDLE_MINUTES`/`SESSION_RESET_HOUR` env vars are asserted to have **no effect** (`"default_reset_policy" not in config.to_dict()`).
- **Surprising:** the same file also checks that `hermes info`'s gateway status does not print "Error loading gateway config" when no policy is configured.

### `evals/gateway_completion/delivery_lifecycle.py`
- **Purpose:** the completion-delivery lifecycle — notify completion, idle watch matching, notice-only behaviour, async completion delivery, and an unavailable raw API owner.
- **Key abstractions:** the real `GatewayRunner`; the real `DiscordAdapter`; `spawn_background_process`; `dispatch_async_delegation`.
- **Data flow:** real terminal subprocesses, real process-reader threads and real delegation workers; only the **outbound transport and the model boundary** are replaced.
- **Non-obvious design decisions:** the *raw* watcher deliberately sends a **notice with no model turn** — the probe asserts `not turns and len(sends) == 1`. A session with **no API adapter** must stay `pending` with **zero** delivery attempts and must leave the completion in the queue. A *private* completion (a secondary profile's adapter) must never enter the primary bot.
- **Edge cases & failure handling:** the watch case asserts the `watch_match` event is **not** left in the queue after the next post-turn hook, and that the turn count does not double.
- **Surprising:** the README records the *durable* evidence separately: "base exhausted eight attempts and dropped; fixed stayed pending/zero then delivered both batch siblings at one attempt" — measured with ten fresh subprocesses sharing SQLite.

### `evals/gateway_failure_ownership/probe.py`
- **Purpose:** exception-path **input ownership** — when a turn fails after the input was accepted, whose input is it?
- **Key abstractions:** `ControlledAgent(AIAgent)`; `TranscriptReadError`; the `tracemalloc` measurement.
- **Data flow:** a real loopback peer, a real `GatewayRunner`, real `SessionDB`; faults are injected as a controlled agent-construction failure, a voice-policy failure after persistence, a history-read failure, and an HTTP 400.
- **Non-obvious design decisions:** a durable owner marker is written per accepted input and must be **unique** and **absent from the provider wire messages**. 5,000 archived 4-KiB rows are inserted to prove the failure handler stays under 8 MiB of traced allocation with **zero raw transcript scans** (`raw_reads` must not increase).
- **Edge cases & failure handling:** chat A succeeds with platform id `100`; chat B resumes the same session with the **same id** and fails construction — both inputs must remain with unmodified platform ids. The socket is patched so any non-loopback connection raises.
- **Surprising:** the README's scope statement is precise: *"This is exception-path input arbitration, not global exactly-once delivery or content deduplication."*

### `evals/gateway_failure_ownership/foreign_writer.py`
- **Purpose:** the probe's proof that the gateway is **not** the universal writer.
- **Key abstractions:** a standalone script invoked as `python foreign_writer.py <repo> <state.db> <sid>`.
- **Data flow:** it commits an unrelated input into the same `state.db` from a **separate process**, during a keyless agent-constructor failure.
- **Non-obvious design decisions:** the write happens *from another process* so it cannot be attributed to the gateway's in-memory ownership; the probe then asserts **both** writers' inputs survive.
- **Edge cases & failure handling:** the script is run with `stdin=DEVNULL`, a 20 s timeout and `check=False`; the probe asserts `returncode == 0` before continuing.
- **Surprising:** a single extra process is enough to expose a class of bug that no in-process mock could reach.

### `evals/gateway_status_render/iteration_ceiling_ab.py`
- **Purpose:** what the three user-facing status lines actually **render** for the iteration counter.
- **Key abstractions:** `_busy_ack`, `_heartbeat`, `_timeout`; a real `AIAgent` with its default (unlimited) `max_iterations`.
- **Data flow:** the real render paths are driven (busy ack, long-running heartbeat, inactivity-timeout diagnostic) with a stub adapter that records the outbound text.
- **Non-obvious design decisions:** `sentinel_leaks` counts how many rendered strings contain `sys.maxsize` — the probe exists because an unlimited iteration count leaked an enormous number into the user-facing text.
- **Edge cases & failure handling:** `--finite 250` lets the same harness be run against a tree with a ceiling, so before/after can be compared.
- **Surprising:** the probe builds the agent with `enabled_toolsets=[]` and `disabled_toolsets=["*"]` — the status text is the subject, so nothing else is allowed to vary.

### `evals/gemini_type_array_probe.py`
- **Purpose:** an offline A/B of the Gemini schema sanitiser, validated by the **real Google SDK types**.
- **Key abstractions:** `FunctionDeclaration.model_validate`; `sanitize_gemini_tool_parameters`.
- **Data flow:** the transport is stopped at the wire boundary (HTTP 418), the captured `tools` are converted to `functionDeclarations` and validated by `google.genai.types`.
- **Non-obvious design decisions:** the baseline implementation is loaded by `git show` and `exec`'d into a throwaway module, so the A/B is base-vs-worktree with **no file edits**. The cases include `nullable`, `nullable_enum`, `union_enum`, `nested_items`, `nested_anyof`, `constrained_union`, `structural_union` and a `scalar_control`. The probe asserts the input parameters object is **unchanged** by the sanitiser (no mutation).
- **Edge cases & failure handling:** the `scalar_control` must be accepted on both arms — otherwise a sanitiser that breaks everything would "pass".
- **Surprising:** the final line is the scope statement: *"LOCAL SDK VALIDATION ONLY: no Google API call or Windows Desktop exercise."*

### `evals/goal_command_parity.py`
- **Purpose:** a CLI `/goal` **semantic oracle** — the same command sequence must produce the same state and queued prompts on two trees.
- **Key abstractions:** `GoalManager`; `CLICommandsMixin`; the `command_args` sequence.
- **Data flow:** 23 commands (`show`, `pause`, `resume`, `clear`, `draft`, `wait`, `gate`, `done`, `status`, …) are run against a real manager with a real pending-input queue; each row records the state, the contract, the queued prompts and the printed output.
- **Non-obvious design decisions:** the process id in the output is replaced with `<PID>` so two runs are **byte-comparable**. The manager is given a fixed `default_max_turns=17`.
- **Edge cases & failure handling:** the multi-line goal string (`Maintain the service\nconstraints: keep data\nstop when: credentials missing`) is part of the command list, so the contract parsing is exercised, not just the single-line path.
- **Surprising:** the harness produces a *semantic* diff (state + prompts), not a golden transcript — so a reworded prompt that changes nothing would still pass.

### `evals/heartbeat_idle_wire.py`
- **Purpose:** the **heartbeat** wire contract — a 15-minute poll must coalesce into one turn, an idle gap must not fire, and a cancelled admission must refund the claim.
- **Key abstractions:** `WireAdapter`; `HeartbeatManager`; `_heartbeat_poll_once`; a patched `heartbeat.time`.
- **Data flow:** the real poller, SQLite and adapter lifecycle run against a fake model; the clock is a `SimpleNamespace(now=…)` so time is deterministic.
- **Non-obvious design decisions:** the probe distinguishes **in-loop** holding (the first turn is still running) from a **user wake**; a genuinely idle 15-minute gap with 5 same-time polls must produce **exactly one** new turn (`fire_count == 1`). A *pinned route* must not enter the pre-claim executor recovery gap. A route mismatch must be an **adapter rejection**, not a fabricated return value.
- **Edge cases & failure handling:** the `drain()` helper yields once after `asyncio.gather` because "gather() over tasks that are ALL already done completes without yielding (3.12+), so a finished task whose queued `_background_tasks.discard` callback has not run yet would spin this loop forever".
- **Surprising:** the base poller can be substituted by `--base-poller <path>/run_goals_base.py` and `exec`'d, so the same harness A/Bs two implementations of the poller.

### `evals/hosted_attachment_transfer/bench.py`
- **Purpose:** measures the cost of transferring a hosted-room attachment over the real private control socket.
- **Key abstractions:** `SourceMeter`; `HostedRoomOwnerRPC`; `check_remote_hosted_admission`; `GatewayControlServer`.
- **Data flow:** two served profiles on one multiplexed runner; an N-MB attachment is committed, then `produce('submit')` and the admission check are measured.
- **Non-obvious design decisions:** the meter counts **round trips**, **source bytes read** and **source bytes hashed** separately — the question is not "how big is the file" but "how many times does the source read and hash it". `hashlib` is wrapped with a `CountingHashlib` that only counts while a thread-local `in_source` flag is set, so the *store verify* and the *handler* hash are both attributed.
- **Edge cases & failure handling:** the driver-side history poller is stopped before the preflight measurement so it does not count against it.
- **Surprising:** the whole point is the ratio — `source_hashed` vs `source_read` — because hashing the payload twice is what a naive implementation does.

### `evals/kanban_graph_identity.py`
- **Purpose:** a credential-free SQLite probe of the kanban **graph identity** — a task's tenant, its parent links and its fan-out.
- **Key abstractions:** `decompose_triage_task`; `_apply_fanout`; `kb.write_txn`; `PRAGMA integrity_check`.
- **Data flow:** tasks and links are created, a triage task is decomposed, and a `threading.Barrier(2)` makes two threads race the same fan-out.
- **Non-obvious design decisions:** **exactly one** winner must emerge from the concurrent fan-out (`concurrent_winners == 1`). A **repeat** fan-out must be refused — and so must a repeat after the task's events were garbage-collected (`retention_repeat_refused`). Three `dispatch_once` ticks must not create any new task ids.
- **Edge cases & failure handling:** the probe runs in a **child process** with a scrubbed env so it can never touch a real board; `PRAGMA integrity_check` must be `ok`.
- **Surprising:** the refusal is keyed on the *event retention* as well as the task status — a repeat is refused even after the events that recorded the first fan-out have been GC'd.

### `evals/kanban_pr_acceptance_live.py`
- **Purpose:** a local HTTP/lifecycle probe of **PR acceptance** — the four outcomes and the compare-and-swap on the run id.
- **Key abstractions:** the repo's own `tests/hermes_cli/test_kanban_pr_acceptance.py` fixture (`github.__wrapped__`); `kb.complete_task(expected_run_id=…)`.
- **Data flow:** a task with a `completion_contract` is completed four times with different `conclusion` values (failure, cancelled, timed_out, success); then a race: another process claims the task, blocks and unblocks it, and the completion is attempted with the **old** `expected_run_id`.
- **Non-obvious design decisions:** the probe reuses the **test tree's own fixture** rather than inventing a GitHub double, so the adapter's real request shapes are used. The `completion_contract` column is added by `ALTER TABLE` when the tree does not have it, so the same probe runs on both trees.
- **Edge cases & failure handling:** the `pr_acceptance` task-event receipt is read back and counted; the CAS case must produce **one** receipt, not two.
- **Surprising:** the fixture is loaded from a **path argument**, so the probe can be pointed at another checkout's fixture.

### `evals/kanban_scope_probe.py`
- **Purpose:** a credential-free **scope** probe: a child process may only mutate the task it was assigned.
- **Key abstractions:** `CodexAppServerClient`; the `hermes-tools` MCP server; the `HERMES_KANBAN_*` env contract.
- **Data flow:** a task is claimed in a temp board; a native child is spawned with `command/exec` and the full env, and it tries to complete the task; then the MCP server is exercised for a foreign task and the own task.
- **Non-obvious design decisions:** the child is given `sandboxPolicy: {type: 'dangerFullAccess'}` — the point is that the *board scope*, not the sandbox, is the boundary. The probe asserts the child saw the delegated marker (`HERMES_DELEGATED_CHILD_CONTEXT == "1"`) and that its mutation was **refused**.
- **Edge cases & failure handling:** the foreign task must stay `running` while the own task becomes `done`; `PRAGMA integrity_check` must be `ok`.
- **Surprising:** the probe runs the real Codex app-server — the scope must hold through a real MCP transport, not just a direct function call.

### `evals/key_cmd_picker_live.py`
- **Purpose:** a live A/B of the model picker's **`key_cmd`** credential path — a provider whose key is minted by a command.
- **Key abstractions:** the `rows_worker` (a direct call to the picker's row builder); `cli_pty` (a PTY-driven `hermes model`).
- **Data flow:** a `key_cmd` helper script is minted into a temp home; the CLI's model picker is driven under a PTY and the "Found N models" count is read from the transcript; the rows path is called in-process and its `total_models` read back.
- **Non-obvious design decisions:** the picker is **cancelled** (Ctrl-C) once it renders, so no selection is ever saved. The helper's invocation count is recorded, so a build that mints the key twice is visible. Two config shapes are tested (`providers` and `custom_providers`) and two surfaces (CLI and rows), because they are separate code paths.
- **Edge cases & failure handling:** the server returns 401 for an unauthorised request and the probe asserts that the *unauthorised* case is the "before" behaviour and the authorised one the "after".
- **Surprising:** the JSON-config comment again: "JSON is valid YAML; no third-party harness dependencies."

### `evals/liveness/ws_orphan_reconnect.py`
- **Purpose:** real WebSocket / `session.create` / disconnect / timers / RPC — the orphan-settlement contract.
- **Key abstractions:** `handle_ws`; `_WS_ORPHAN_REAP_GRACE_S`; `_pending_ws_reaps`; `_drain_queued_prompt`.
- **Data flow:** a session is created over a real WebSocket, the socket is closed while a turn is running, and the interrupt + reap are observed; the same is then done with a reconnect.
- **Non-obvious design decisions:** only *construction and model execution* are doubles — no lifecycle predicate is patched. The `redetach` mode asserts the **poll budget is not inherited**: a new detachment must get a fresh poll count. The settling guard returns error code `4009` while a session is settling.
- **Edge cases & failure handling:** the negative case asserts an orphan that never reconnects **is** reaped; the positive case asserts the abandoned interrupt claim is released (`_client_gone_interrupt_requested is None` afterwards) and that `session.resume`, `session.activate` and `prompt.submit` all succeed after settlement.
- **Surprising:** the docstring is honest about the fixture's limits: it "seeds a post-interrupt queued envelope to reproduce the bypass-writer schedule, not the exact naturally arriving queue race."

### `evals/mcp_device_flow.py`
- **Purpose:** the RFC 8628 **device-authorisation** flow against a local OAuth fixture.
- **Key abstractions:** `oauth_fixture(mode)` with modes `success`, `denied`, `expiry`, `malformed`, `preregistered`, `persistence`, `issuer`, `resource`, `multi_issuer`, `unsupported`.
- **Data flow:** the real CLI (`hermes mcp login fixture --flow device`) runs against the fixture; the wire is recorded; a token is then aged and `hermes mcp test fixture` is run to exercise the refresh.
- **Non-obvious design decisions:** the fixture implements the **real polling semantics** — `authorization_pending` then `slow_down` — so the client's backoff is genuinely exercised. The `malformed` mode returns an access token that is an **object**; the `expiry` mode gives a 0.1 s expiry. The `persistence` mode injects a filesystem write error **after** real registration writes, and asserts the previous token files are **unchanged** (a failed write must not clobber a good token).
- **Edge cases & failure handling:** the error description deliberately contains a secret-shaped string (`fixture-device-secret MUST NOT BE PRINTED`) to catch a leak.
- **Surprising:** the `preregistered` mode requires the client secret to be correct — the fixture rejects it otherwise — so a client that ignores the registered secret fails.

### `evals/native_compaction/ab_checkpoint_preflight.py`
- **Purpose:** does a native compaction **checkpoint** false-trigger local compression on the next preflight?
- **Key abstractions:** `_FakeResponses` (a local Responses SSE server); `estimate_native_responses_preflight_tokens`; the `awaiting_real_usage_after_compression` latch.
- **Data flow:** the real `AIAgent.run_conversation` against a fake Responses server that returns a `compaction` output item with 5,169,420 characters of ciphertext.
- **Non-obvious design decisions:** the probe distinguishes the **CLI shape** (the same history list objects across turns) from the **gateway shape** (history re-read from the DB, so the usage anchor keyed on `id` is stale and the rough estimator decides). A negative scenario (`over_threshold_negative`) proves the deferral is **one request, not a disable**: when real usage is over the threshold, local compression must still fire.
- **Edge cases & failure handling:** the `restore` scenario writes the transcript to a real `SessionDB`, closes and reopens it, and a **fresh** agent resumes — the first turn must reach the provider without local compression.
- **Surprising:** the checkpoint size is taken from the real issue (`5,169,420 ciphertext chars → ~1.29M rough tokens`) — the fixture reproduces the production magnitude, not a toy one.

### `evals/openrouter_pkce_ab/harness.py`
- **Purpose:** the real `hermes auth add openrouter --type oauth` flow against a **fake OpenRouter** that enforces the published contract.
- **Key abstractions:** `FakeOpenRouter`; `scripted_browser`; the `EXPECT` predicate table.
- **Data flow:** `webbrowser.open` is replaced by a scripted browser that follows the auth URL's `callback_url` the way openrouter.ai would; the exchange endpoint checks the S256 verifier, single-use codes and returns 403 otherwise.
- **Non-obvious design decisions:** four scenarios with *different* expected shapes: `legit` (pool entry with `source: manual:openrouter_pkce`), `wrong_state` (the browser redirects to a **forged nonce path** → 404, no exchange, no pool entry), `replayed_code` (the code is already consumed → 403), `malformed` (the exchange returns JSON without a `key`), and `api_key_path` (the manual `--api-key` route must still work with no `--type`).
- **Edge cases & failure handling:** the module import itself is guarded — if `hermes_cli.auth_commands` fails to import, the outcome is recorded as `IMPORT FAILURE` rather than crashing. The pool entries are reported with a **key prefix only** (`sk-or-v1-`), never the full secret.
- **Surprising:** the harness is designed so that running it against `origin/main` produces a *documented BEFORE state* — every oauth scenario fails with `SystemExit "not implemented"` — and against the branch an AFTER state.

### `evals/output_caps_local_capture.py`
- **Purpose:** a zero-cost local SDK **wire capture** of every output-cap surface, before and after the removal.
- **Key abstractions:** the `Capture` HTTP server; `ChatCompletionsTransport().build_kwargs`; `AnthropicTransport`; `BedrockTransport`.
- **Data flow:** each surface builds a real request and the **captured body** is recorded; nothing leaves the loopback server.
- **Non-obvious design decisions:** the oracle is the **capture body**, not the fake response length — a response-length oracle cannot tell "the cap was removed" from "the model answered briefly".
- **Edge cases & failure handling:** `VERIFY_OUTPUT_CAP_REMOVAL` asserts `max_tokens` is absent from every production surface but present in the internal-budget and native-Anthropic ones.
- **Surprising:** the whole eval costs nothing — no model is called at all.

### `evals/output_caps_surfaces.py`
- **Purpose:** the surface enumeration — the list of production paths whose request bodies are captured.
- **Key abstractions:** the named surfaces: gateway, API server, provider, agent, registered profile, compression helper, delegation helper, MoA, curator, review fork, CLI PTY, boto3.
- **Data flow:** each surface is driven once and contributes one captured body to the capture server.
- **Non-obvious design decisions:** the list is the *deliverable* as much as the harness — a removal is only complete when every listed surface has been re-captured.
- **Edge cases & failure handling:** the "internal budget" case (43) is the control that must survive the removal.
- **Surprising:** a "production surface" is a list you have to maintain by hand, and a missing entry is a silent hole in the removal.

### `evals/output_caps_scope.md`
- **Purpose:** the scope note that defines what the removal does and does not touch.
- **Key abstractions:** the removed set (`HERMES_MAX_TOKENS`, `model.max_tokens`, provider `max_output_tokens`, MoA preset caps, auxiliary compression caps) and the preserved set (native Anthropic `max_tokens`, Converse's optional `inferenceConfig.maxTokens`, MCP `SamplingHandler.max_tokens_cap`, `request_overrides`/`extra_body` as generic passthrough).
- **Data flow:** none — it is a specification the capture probe checks against.
- **Non-obvious design decisions:** *"no global request-field scrubber is introduced"* — the removal is surgical, because stripping arbitrary native fields would break other protocols.
- **Edge cases & failure handling:** the preserved fields are listed explicitly so a future broad scrubber is caught.
- **Surprising:** the difference between a product cap and a protocol field is the whole difference between a safe removal and a broken client.

### `evals/plugin_isolation/audit_catalog.py`
- **Purpose:** audits **every catalog plugin** for whether it can run unchanged in the plugin host.
- **Key abstractions:** `load_catalog()`; `audit_plugin_dir`; `_fetch(entry, src_root)`; `_reason_class(reason)`.
- **Data flow:** each catalog entry is fetched shallowly at its **pinned sha** (`--depth 1 --filter=blob:none`) into `<dir>/src/`, and the production auditor is run on its subdirectory.
- **Non-obvious design decisions:** the fetch is **cached by a `.audited_sha` marker** so a re-run does not re-fetch, and the audit is re-run if the sha changed. The blocker reasons are **classified** into a small vocabulary ("patches a Hermes module attribute", "mutates a Hermes registry directly", "ctx.<x>()", "model-provider builds its own SDK client", "dashboard backend API streams"), so the report says *why* a plugin needs in-process loading rather than just how many.
- **Edge cases & failure handling:** a failed fetch is a verdict (`fetch_failed`), not a crash; the summary counts only the audited entries in the percentage.
- **Surprising:** the output is a **markdown table** ready to paste into a PR — the audit is meant to be read, not just run.

### `evals/postmortem/forensics/common.py`
- **Purpose:** the shared loader that turns a **copy** of `state.db` into a run tree, a disjoint population, fitted pricing and message iterators.
- **Key abstractions:** the `Run` dataclass; `_rollover_ids`; `_fit_pricing`; `_lstsq`.
- **Data flow:** the DB is opened read-only (`file:…?mode=ro`); the root is discovered as the session with the most descendants; compression-rollover children are **excluded**; pricing is fitted by least squares from the usage columns to `estimated_cost_usd`.
- **Non-obvious design decisions:** the rollover exclusion is precise: a child whose `source` is a top-level surface (not `subagent`), whose parent shares that source, and which started within ±5 s of the parent ending — that is a **conversation continuing**, not a fan-out, and including it would double-count the cost. The pricing fit drops columns with <0.1% of the token mass, because a negligible column makes the normal equations ill-conditioned.
- **Edge cases & failure handling:** fewer than 8 priced sessions yields zero prices rather than a garbage fit; the least-squares solver is a hand-written Gaussian elimination because numpy is not a dependency.
- **Surprising:** the fitted prices make the recomputed dollars match **that Hermes's own estimator**, not an invoice — and the docstring says so.

### `evals/postmortem/forensics/tokens.py`
- **Purpose:** lane 1 — where the money went, context-size distribution and the compression-cap counterfactual.
- **Key abstractions:** `_per_call_context(run, sid)`; `sawtooth(calls, cap, floor)`; `CHARS_PER_TOKEN = 3.5`; `TOOL_SCHEMA_TOKENS = 12_000`.
- **Data flow:** cost is bucketed by depth and duration; a per-call prompt size is reconstructed from message character counts plus the system prompt and the tool-schema size; the excess-cache-write proxy compares actual cache writes with the ideal "only what was appended".
- **Non-obvious design decisions:** every figure is labelled **OBSERVED** or **MODELED** in the output, and the caveats are printed with the number (the reconstruction omits the initial prefix write and reasoning accumulation). The sawtooth replay is a *counterfactual*: "if the session compressed to `floor` whenever ctx exceeded `cap`".
- **Edge cases & failure handling:** the two lanes that compute a sawtooth deliberately differ (reconstructed sizes vs real logged sizes) and the README says which number the tracking issue quotes.
- **Surprising:** the report prints both the observed and the modeled figure on one line, so a reader cannot accidentally quote the flattering one.

### `evals/postmortem/forensics/delegation.py`
- **Purpose:** lane 2 — nested-delegate timeouts, orphaned children, polling cost, batch-join delivery delay and summary truncation.
- **Key abstractions:** the `_TIMEOUT`, `_SLEEP` and `_TRUNC` regexes; the batch-join grouping (children dispatched within 60 s).
- **Data flow:** every `delegate_task` tool result in the run tree is classified; `sleep N` seconds after the first timeout are summed; batch-join "withheld child-hours" are computed per parent depth.
- **Non-obvious design decisions:** the **withheld** metric is explicitly *not* critical-path time — it is the child-hours a batch join held back from the parent, reported separately per parent depth. The lifetime cost of timeout sessions carries a caveat: it "includes legitimate work after the timeout, and its cache writes overlap the tokens lane's excess proxy".
- **Edge cases & failure handling:** background batches re-enter as a `user`-role block, and the parser counts `--- ✓ TASK` / `--- ✗ TASK` / `--- ⚠ TASK` entries to avoid double-counting summaries.
- **Surprising:** the finding that 242.6 hours were spent *sleeping* after a first timeout is a failure mode no other metric would surface.

### `evals/postmortem/forensics/logcalls.py`
- **Purpose:** lane 1b — per-call cache behaviour from the rotated `agent.log`.
- **Key abstractions:** the `_LINE` regex for the API-call line; `sawtooth_real`; `itertools.pairwise`.
- **Data flow:** the logs are parsed for calls belonging to the run's sessions; the prompt-size distribution, hit-ratio buckets and the plateau signature are computed.
- **Non-obvious design decisions:** **two** definitions of a broken cache prefix are reported separately, because an independent review caught them being conflated: `strict_plateau` (the hit count is *exactly* the previous call's) and `non_advancing_hit` (the hit count did not grow while the input did). The **coverage fraction is printed first**, and the README insists on quoting nothing without it.
- **Edge cases & failure handling:** logs rotate, so extrapolations from the window are explicitly "upper bounds".
- **Surprising:** the optional fields `write=`, `id=` and `upstream=` are parsed opportunistically, so the same parser works across log-format generations.

### `evals/postmortem/forensics/tools.py`
- **Purpose:** lane 3 — tool-layer friction: hardline false blocks, foreground refusals, whole-file rewrites and output volume.
- **Key abstractions:** the `_HARDLINE`, `_MALFORMED`, `_FG_TIMEOUT` constants; `read_paths_by_sess`.
- **Data flow:** every assistant `tool_calls` and every `tool` result in the tree is scanned; `write_file` calls are counted with their characters, and a write over 20,000 chars to a path that was **read in this session** is counted as a rewrite.
- **Non-obvious design decisions:** the "malformed" class of hardline blocks is counted separately from the total, because 566 of 579 blocks were that class — i.e. the blocklist was rejecting **parseable-looking** commands, not just dangerous ones. The output volume is priced at the fitted output-token rate, so "92.8M characters" becomes a dollar figure.
- **Edge cases & failure handling:** a tool result is counted as an error if its metadata status is not ok **or** the payload contains an `"error"` field or a non-zero `exit_code`.
- **Surprising:** the rewrite metric is per-session, so "wrote the file it had just read" is a *behavioural* pattern rather than a size statistic.

### `evals/postmortem/forensics/goal_loop.py`
- **Purpose:** lane 4 — the `/goal` loop: nudges, judge verdicts and parked time.
- **Key abstractions:** the `_WAITING` regex; the `goal:{root}` row in `state_meta`.
- **Data flow:** the root session's messages are scanned for `[Continuing toward your standing goal]` nudges, `[ASYNC DELEGATION …]` batch notices and `[IMPORTANT: Background process` notices; the persisted goal state is read for the final wait barrier.
- **Non-obvious design decisions:** a nudge is annotated with whether the *previous* assistant turn had already said it was waiting, and with the gap in seconds — the interesting number is "nudges fired <180 s after a turn that said it was waiting" (2 of 5). The barrier's age at session end is reported as the time the loop sat parked, with the caveat that the user may have cleared it afterwards.
- **Edge cases & failure handling:** the goal state is read defensively; a missing row yields an empty state rather than an error.
- **Surprising:** the fixture in the harness's own test plants exactly this shape — a nudge, a batch notice, a hardline block, a `waiting_on_session` barrier — and the test asserts the counts.

### `evals/postmortem/forensics/rework.py`
- **Purpose:** lane 5 — the post-open rework inventory for a large PR, reproducible part only.
- **Key abstractions:** the subject-prefix grouping (`fix`, `review-fix`, `revert`, `test`, `docs`, `simplify`, …); `check_public_surface.py`.
- **Data flow:** the public surface at PR-open is measured with the repo's own checker; the commits between the open SHA and the merged head are grouped by prefix with files/insertions/deletions and whether tests were touched.
- **Non-obvious design decisions:** the script refuses to reproduce the hand-made root-cause classification and says so in its own output — it provides "the mechanical inventory that classification started from". `touching_no_tests` is reported per group, because a fix commit with no test is a review smell.
- **Edge cases & failure handling:** the checker is looked up in this tree first and then in the target repo; if it is missing, the output says so instead of failing.
- **Surprising:** the honesty note in the output ("root-cause classes were hand-labeled in the original audit; not reproduced here") is a deliberate part of the deliverable.

### `evals/postmortem/live_ab/auth_stampede.py`
- **Purpose:** live A/B of the hourly-expiry **stampede** — N agents holding a stale JWT must not produce N 401s.
- **Key abstractions:** the `jwt(exp, sub)` helper (the `sub` matters); the patched `resolve_nous_runtime_credentials`; the patched `start_nous_auth_keepalive`.
- **Data flow:** N agents are built with a stale token that expires in 30 s, then all fire one call concurrently; the server counts 401s and 200s.
- **Non-obvious design decisions:** the `sub` claim is in the token because **pre-expiry adoption only swaps to a key for the same account** — the stampede fix must not silently move an agent to a different account. The keepalive thread is disabled (out of scope) so the test isolates *adoption*.
- **Edge cases & failure handling:** the results list records both the response and the first five characters of the resulting key, so the reader can see which key was adopted.
- **Surprising:** the probe prints `keys:` — the *set* of keys the agents ended up with — because the failure mode is "all agents adopted the wrong (or the same wrong) key".

### `evals/postmortem/live_ab/batch_failure_notice.py`
- **Purpose:** does the parent's completion queue see a **per-task failure notice before** the consolidated batch result?
- **Key abstractions:** `dd._Batch.run_child`; `process_registry.drain_notifications`.
- **Data flow:** three grouped tasks are dispatched in the background; task 0 fails instantly, the others sleep 8 s; the queue is drained and the *order* of the events is printed.
- **Non-obvious design decisions:** the tasks are **grouped** on purpose: siblings share ONE final result, so a dead sibling would otherwise wait for the slowest. The ungrouped case is explicitly noted as already reporting as they finish.
- **Edge cases & failure handling:** the 30 s deadline and the `BATCH_FINAL` break condition bound the run.
- **Surprising:** the probe is a *timing* probe — its verdict is the printed `ORDER:` line, so the receipt is the sequence.

### `evals/postmortem/live_ab/cache_concurrency_probe.py`
- **Purpose:** the instrument behind the cache-sticky question — is cache routing sticky under a fan-out?
- **Key abstractions:** the patched `Messages.stream` and `Completions.create`; the `ideal`/`stuck`/`collapse` pair classification.
- **Data flow:** N independent agents run the same growing tool loop; for every call the probe records prompt/cache-read/cache-creation/output tokens, the response id, the upstream provider and **a sha of the system prompt, tools and every message**.
- **Non-obvious design decisions:** the per-message shas are what **rule client-side prefix mutation in or out** — the classification can then separate "the prefix was mutated" from "the routing lost the cache". A pair whose system sha changed is classified as `compaction` and **excluded**. The `settle` option sleeps before every request to test whether the effect is a race.
- **Edge cases & failure handling:** the probe pins the cache TTL itself so a user config cannot leak in; the summary JSON carries the bad pairs with **both** response ids and the `cf-ray` header, so the provider can be given the evidence.
- **Surprising:** the measured results are in the docstring: Nous native 13.9% stuck, Nous chat 0/320, OpenRouter pinned 0/161, OpenRouter unpinned 9.8% collapse — and "Use this to clear a new upstream before flipping `agent/nous_wire.py::GMI_NATIVE_WIRE_CLEARED`."

### `evals/postmortem/live_ab/cache_prefix_live.py`
- **Purpose:** the live **prefix-mutation** test — if Hermes strips prior-turn thinking, call N+1's messages will not equal call N's.
- **Key abstractions:** the wrapped Anthropic converter; `sig(m)` (a message signature: role + block types + lengths + signature presence).
- **Data flow:** a real tool loop runs against the provider; every outbound payload is captured and consecutive payloads are compared prefix-by-prefix; the per-call cache hit ratio is read from `agent.log`.
- **Non-obvious design decisions:** the "arm B" monkeypatches `_manage_thinking_signatures` to keep every thinking block, dropping only `cache_control` — that isolates the digest's value. The README notes the arm-B patch is applied at both the module and the adapter, because the adapter "imports the name at call time".
- **Edge cases & failure handling:** the task deliberately makes the model "think carefully for a moment" before each tool call, so thinking blocks actually exist to strip.
- **Surprising:** the live probe's final line counts how many assistant messages in the final payload still carry a thinking block — a direct measure of the thing under test.

### `evals/postmortem/live_ab/cache_prefix_wire.py`
- **Purpose:** the wire-only half of the pair — the same comparison without the live model.
- **Key abstractions:** the message-signature function; the captured Anthropic request bodies.
- **Data flow:** outbound payloads are captured and compared by signature, so a length-only mutation is still detected.
- **Non-obvious design decisions:** the comparison uses a *signature* rather than raw bytes, because a payload can be byte-identical in the interesting part and differ in a length field.
- **Edge cases & failure handling:** a pair whose prefix changed is reported with the differing signature, so the failing block is identified, not just counted.
- **Surprising:** the two halves agree by construction: the live one proves it against a provider, the wire one proves it cheaply in CI.

### `evals/postmortem/live_ab/goal_judge_wait.py`
- **Purpose:** a live judge A/B on the run's **real "waiting" response shape**.
- **Key abstractions:** `goals.judge_goal`; the `active_delegations` keyword (added only if the signature accepts it).
- **Data flow:** a realistic "Round 3 status: 4 worker batches are still running …" response is judged N times.
- **Non-obvious design decisions:** the response is taken from the **actual run** rather than invented, and the signature is probed so the probe works on both trees. The expected verdict is `wait` with a directive, not `continue` — the failure mode being pinned is the judge telling the agent to keep working while it should wait.
- **Edge cases & failure handling:** the `SUMMARY` line prints the verdicts, so a flakiness rate is visible.
- **Surprising:** the probe passes `active_delegations=4` — the judge needs to know how many workers are running, and that argument is itself part of the fix.

### `evals/postmortem/live_ab/hardline_scanner_matrix.py`
- **Purpose:** an 11-case matrix for the **hardline command scanner**.
- **Key abstractions:** `detect_dangerous_command`.
- **Data flow:** eleven commands are checked, each with a required verdict; the script prints `ALL OK` or the failure count.
- **Non-obvious design decisions:** the matrix mixes the **reviewer's witnesses** (a newline-hidden `reboot` inside a quoted `$(grep …)`) with the **original class that must stay fixed** (`sed -n "$(grep -n X f | cut -d: -f1),+3p" f` must stay allowed) and with **data that must stay allowed** (`grep -F 'sudo reboot' notes.md`, a commit message containing "sudo reboot handling").
- **Edge cases & failure handling:** the "546-block class" (the malformed-payload block) is explicitly allowed to keep blocking.
- **Surprising:** the false-positive cases are as important as the true positives — a security scanner that blocks a legitimate `sed`/`grep` pipeline is its own failure mode.

### `evals/postmortem/live_ab/nested_delegate_deadline.py`
- **Purpose:** the nested-delegate deadline — a depth-1 orchestrator's `delegate_task` must not time out while its leaf is still working.
- **Key abstractions:** `ag._delegate_depth = 1`; `ag._delegate_role = "orchestrator"`; `resolve_timeout`.
- **Data flow:** the agent is configured exactly as `delegate_tool_child_run` configures a real nested orchestrator; the child runs `sleep 75 && echo LEAF_DONE_MARKER`.
- **Non-obvious design decisions:** the sequential deadline is **shortened to 40 s** in a temp config (copied from the real `auth.json` and `config.yaml`) so the run takes ~1.5 min instead of 8 — and the fix exempts `delegate_task` from that deadline entirely, so the shortened value is exactly what main will hit. The verdict checks both the timeout flag and whether the orchestrator got the leaf's result.
- **Edge cases & failure handling:** the temp home is cleaned up; the credentials are *copied* from the real home, never moved.
- **Surprising:** the marker `LEAF_DONE_MARKER` is checked in the final answer, not in the tool output — the question is what the *parent* ended up believing.

### `evals/postmortem/live_ab/subagent_context_cap.py`
- **Purpose:** what context trigger does a real child resolve to on a 1M-window model?
- **Key abstractions:** `dt._build_child_agent` (found by scanning the module for the function that constructs an `AIAgent`); `child.context_compressor`.
- **Data flow:** the parent's real spawn path is used; the child's `threshold_tokens`, `threshold_tokens_cap` and `threshold_percent` are read.
- **Non-obvious design decisions:** the constructor function is **discovered by introspection** (`inspect.getmembers` + a source scan for `AIAgent(`), with the signature's parameters filled in generically — so the probe survives a rename.
- **Edge cases & failure handling:** the parent's own trigger is printed next to the child's, so the "parent untouched" claim is checkable.
- **Surprising:** the probe prints the discovery (`constructor fn: [...]`) so a reader can see exactly which function it exercised.

### `evals/postmortem/review_probes/cache_estimator_probe.py`
- **Purpose:** does the **preflight estimate** agree with the Anthropic wire size when thinking is retained?
- **Key abstractions:** `_preflight_request_tokens`; `convert_messages_to_anthropic`; `estimate_messages_tokens_rough`.
- **Data flow:** 48 assistant/tool rounds with a large `reasoning` block each are built; the preflight estimate and the converted wire are compared, and the two `should_compress` decisions are compared.
- **Non-obvious design decisions:** a **local signature-prefix checker** validates the documented contract: for each thinking block's signature, the preceding non-thinking content must be unchanged. After a real compression, the retained signatures' prefixes are re-checked.
- **Edge cases & failure handling:** the probe states the limit: "actual agent rebuilds system too, so this is lower bound".
- **Surprising:** it reproduced a defect in the *first* version of the PR — this is the pattern the whole `review_probes/` directory follows.

### `evals/postmortem/review_probes/context_cap_probe.py`
- **Purpose:** the child context cap must hold through **repeated compression and persistence**.
- **Key abstractions:** `_build_child_agent`; `_apply_child_compression_cap`; `_preflight_request_tokens`; `_agent_stale_thinking_on_wire`.
- **Data flow:** four compression cycles are driven with a local summary stub; then the model is switched (128k and 1M windows) and the cap is re-checked; then a set of raw config values (`'200k'`, `True`, `0`, `None`, `200000.9`, `inf`) are fed to the config applier.
- **Non-obvious design decisions:** the probe distinguishes the **threshold** (which the cap changes) from **route-aware pressure accounting** (which it must not) — the "ACCOUNTING" section shows the same history producing different pressures for `openai-compat` and `deepseek`. A "legacy tail" case checks the already-cached legacy path resolves compatibly.
- **Edge cases & failure handling:** the config applier's *exceptions* are caught and printed per value, so a bad config value is a visible outcome, not a crash. Network is blocked by replacing `socket.socket.connect`.
- **Surprising:** the probe prints `IDENTITY` (which files were loaded) and `SPAWN` (parent trigger, child trigger, cap, tail) before it does anything else — identity first, always.

### `evals/postmortem/review_probes/credential_identity_probe.py`
- **Purpose:** an explicit **account-A key** must not be replaced by the singleton's account-B key.
- **Key abstractions:** `sys.addaudithook` network guard; `prepare_iteration`; `_adopt_nous_key_before_expiry`.
- **Data flow:** three cases — same account, explicit account-A key vs an account-B store, and far-from-expiry — then a 12-thread contention test against a real local refresh POST.
- **Non-obvious design decisions:** the **audit hook** blocks any non-loopback socket *from the standard library's audit event*, which catches connections that a `socket.socket.connect` monkeypatch would miss. The messages array is compared before/after to prove the key swap did not mutate the conversation. The contention case asserts **exactly one** refresh POST for twelve agents.
- **Edge cases & failure handling:** the "main" mode loads the *baseline* `prepare_iteration` from a sibling file, so the same probe runs against both trees.
- **Surprising:** the final asserts are the regression contract: "the explicit account-A key must stay A; same-account fresh key must still be adopted" — the fix must not disable adoption entirely.

### `evals/postmortem/review_probes/deadline_probe.py`
- **Purpose:** the nested-delegate deadline through **actual dispatch**, plus the provider-usage accounting matrix.
- **Key abstractions:** `_run_sequential_tool_execution_middleware`; `execute_tool_calls_sequential`; `record_response_usage`; `_parent_summary_char_budget`.
- **Data flow:** the tool boundary is measured for `delegate_task`, `terminal` and `execute_code`; then a *non-cooperative* delegated operation is interrupted; then twelve provider usage shapes (openai, anthropic, bedrock, google, deepseek, moonshot, openai-codex, openai-compat, minimax …) are fed to the real writer.
- **Non-obvious design decisions:** the deadline is set to **0.3 s** and the tool body sleeps 0.65 s, so the timing is unambiguous. The usage matrix is the point: the same logical usage expressed in each provider's field names must produce the same budget — and the MoA deposit/consume path and the codex app-server path are exercised too.
- **Edge cases & failure handling:** network is blocked by replacing `socket.socket.connect`; every imported module is asserted to be under the tree under test (`is_relative_to(root)`).
- **Surprising:** the probe ends by driving the **full sequential executor** (`execute_tool_calls_sequential`) with only the model body replaced, so the boundary is proven end-to-end rather than at the middleware alone.

### `evals/postmortem/review_probes/finalizer_schedule_probe.py`
- **Purpose:** a pytest plugin that forces the **consumer-first** schedule on a streaming relay.
- **Key abstractions:** `pytest_addoption`; the autouse `finalizer_schedule_probe` fixture; the patched `_provider_stream` and `_count_chunk`.
- **Data flow:** the provider stream is wrapped so a *terminal* chunk (a usage-only chunk or a `finish_reason == "tool_calls"` chunk) sets a gate and then **waits**; the consumer's `_count_chunk` releases the gate.
- **Non-obvious design decisions:** the gate is the whole point: if the consumer runs *after* the provider's finaliser, the terminal chunk is finalised before the consumer sees it. The probe asserts both counts at the end (`gated_terminal_chunks`, `consumer_releases`).
- **Edge cases & failure handling:** `asyncio.wait_for(..., timeout=10)` bounds the wait so a broken schedule fails rather than hangs.
- **Surprising:** it is a **pytest plugin**, so it can be applied to an existing test file without editing it: `-p evals.postmortem.review_probes.finalizer_schedule_probe --finalizer-probe=consumer-first`.

### `evals/postmortem/review_probes/goal_repaste_probe.py`
- **Purpose:** a `/goal` re-paste must be distinguished from an **option-selecting** fragment.
- **Key abstractions:** the real `HermesCLI`, `GoalManager`, `GatewayGoalCommandsMixin`, and the TUI `slash.exec` dispatcher.
- **Data flow:** the same goal text is run through the CLI, the real TUI slash RPC and the real gateway handler; two *option-selecting* fragments ("ship the API" / "ship the UI") are also run.
- **Non-obvious design decisions:** the "ship the API" vs "ship the UI" pair is the sharpest test: the two goals are different but the *model prompt* must be the **same** (the goal is not re-pasted). The conversation history must be **unchanged** after the command, and the pending queue must hold exactly one prompt. The `/goal draft` path is exercised with its only paid dependency stubbed to `None`.
- **Edge cases & failure handling:** the probe reads two real messages out of a state.db copy (ids 264820 and 267045) and asserts they are equal — the re-paste really did happen in the original run.
- **Surprising:** the probe also replays the **actual archived turn** from the run, so the "useful actions and terminal waits" are the real ones.

### `evals/postmortem/review_probes/goal_scope_probe.py`
- **Purpose:** the goal **judge's process scope** and the delegation WAIT lifecycle.
- **Key abstractions:** `goals.gather_background_processes`; `count_active_delegations`; `GoalManager.wait_on` / `wait_on_session` / `wait_for_seconds` / `stop_waiting`.
- **Data flow:** a fake process registry holds an *own* and a *child* process; the CLI, gateway and TUI post-turn paths are each driven and the judge's `background_processes` and `active_delegations` kwargs are captured.
- **Non-obvious design decisions:** the three surfaces (CLI, gateway, TUI) must all give the judge the **same** scope — a judge that sees another tenant's processes is the bug. A wait that has been parked for 30 minutes must **expire**; a long timer must still hold; and after a delegation completes, the barrier must lift.
- **Edge cases & failure handling:** the `evaluate_after_turn` call is asserted to make a **judge call** (not zero), and the persisted `waiting_until` is read back from a fresh manager.
- **Surprising:** the probe ends by driving the real new judge branch with a fake auxiliary client, so the `{"verdict":"wait", …}` contract is exercised end to end.

### `evals/postmortem/review_probes/notice_delivery_probe.py`
- **Purpose:** an interim notice must not claim, acknowledge or de-duplicate the batch's **final** result.
- **Key abstractions:** `ad.push_task_failure_notice`; `ad.claim_event_delivery`; `_notification_event_dedup_key`; the `Sink(GatewayNotificationsMixin)`.
- **Data flow:** three grouped tasks are run behind gates; the first notice, the second notice and the final are pulled from the completion queue and delivered through the real gateway notification mixin.
- **Non-obvious design decisions:** the **claim token** for an interim notice must be **empty** (`assert claim == ''`) — an interim notice is explicitly NON-durable — while the final result must still be claimable after a notice was consumed. The probe also checks that different TUI UI-dedup keys do **not** fix a shared durable claim identity, i.e. two different dedup keys must not make the final claimable.
- **Edge cases & failure handling:** the `main_control` branch runs the same probe on a tree with no `push_task_failure_notice` and asserts there is **no** early event — the control for the fix's own absence.
- **Surprising:** the assertion `"the fixed head must deliver both notices AND the final"` pins the *ordering* of three events, not just their presence.

### `evals/postmortem/review_probes/rewrite_hint_probe.py`
- **Purpose:** the whole-file rewrite hint must not be quadratic, must not block on a FIFO, and must not leak host state to a remote backend.
- **Key abstractions:** `_whole_file_rewrite_hint`; `_file_ops_uses_host_paths`; `write_file_tool`.
- **Data flow:** a repetitive file is grown to 1k/4k/10k/20k lines and the hint is timed; a live write is measured; a `RemoteOps` double makes the tool believe the file is remote; a FIFO is written with a `SIGALRM` timeout.
- **Non-obvious design decisions:** the **quadratic** case is the point — 460 KB of repeated lines must be *skipped*, not re-read 20 times. The FIFO case uses `signal.alarm(2)` to prove the read cannot block forever, and the baseline (hint disabled) is measured for comparison. The remote case asserts the host file is **unchanged**.
- **Edge cases & failure handling:** the probe prints the POSIX-only footgun in a comment rather than pretending it is portable.
- **Surprising:** the three hazards (remote backend, FIFO, quadratic) are all in one file because they are the same feature's failure modes.

### `evals/postmortem/review_probes/scanner_bypass_probe.py`
- **Purpose:** a hardline command hidden after a **newline** inside a double-quoted `$(grep …)` must stay blocked, with no approval callback.
- **Key abstractions:** `check_dangerous_command`; `check_all_command_guards`; `_command_detection_variants`; `_shell_tokens_with_spans`.
- **Data flow:** the command is built as `'echo "$(grep -P \'safe\' /dev/null\n' + 're' + 'boot)"'` (the name is split so the probe's own source does not contain it); a **harmless Bash witness** — a shell function shadowing the dangerous name — is executed and must write a marker.
- **Non-obvious design decisions:** the witness proves **reachability** without ever invoking a host shutdown binary: the function shadows the name and the marker file proves the shell would have run it. A benign backtick argument (`grep -e \`printf needle\` f`) is executed for real and must still work, and the reporter's exact `sed -n "$(grep -n X f | cut -d: -f1),+3p" f` fixture is run in a temp dir and must still work.
- **Edge cases & failure handling:** the callback list must be **empty** (`0 callbacks`) and the approval must be `False`; the baseline module can be loaded from a path for a side-by-side verdict.
- **Surprising:** the probe is written to be *safe to run* — the dangerous name is assembled at runtime and shadowed by a function.

### `evals/postmortem/run.py`
- **Purpose:** the runner that executes the post-mortem probes against one or two checkouts and prints a comparison table.
- **Key abstractions:** the `PROBES` table — `(script, args-template, expected stdout substring, live?, PR)`.
- **Data flow:** each probe is a standalone script run in a fresh interpreter with the target checkout on `sys.path` and a temp `HERMES_HOME`; a probe "passes" when its exit code is 0 **and** its stdout contains the documented marker.
- **Non-obvious design decisions:** the table records that two probes **pass on main as well** (the scanner bypass and the notice delivery) and explains why: "They guard against regressing INTO the round-1 defects." Only the **last** column gates the exit code, so `--compare` reports the second tree's result.
- **Edge cases & failure handling:** a timeout is reported as `FAIL(rc=124)`; probes that spend money only run with `--live`.
- **Surprising:** the marker is the *behaviour the corresponding PR fixed* — a prose string in the table, not a test name.

### `evals/prefix_rediet/run.py`
- **Purpose:** the battery runner and readout for the **fixed-prefix re-diet** A/B.
- **Key abstractions:** the `TASKS` list (7 tasks); `PRD_BASE_TREE` / `PRD_PR_TREE`; the `--parallel=N` fan-out.
- **Data flow:** each cell is a `worker.py` subprocess in its own temp home; the results are resume-safe per `(model, task, arm, rep)`.
- **Non-obvious design decisions:** the inference key is read **fresh from `$HERMES_HOME/auth.json` for every cell** and is read-only — the harness never refreshes or copies the OAuth grant.
- **Edge cases & failure handling:** an errored cell scores 0 and stays in the denominator; exit 3 (no model turn) is an infra failure and is never written.
- **Surprising:** the arms are two **plain checkouts** of the same repo, so the delta is attributable to the diff alone.

### `evals/prefix_rediet/worker.py`
- **Purpose:** one cell of the re-diet A/B: a real agent, real terminal/cron/session-search, stubbed browser and vault.
- **Key abstractions:** the `TASKS` dict; the browser/vault stubs; `isolate_host` reused from `core_tool_deferral`.
- **Data flow:** the browser and the vault are deterministic stubs, so the score measures tool *selection* and *discovery* rather than browser plumbing.
- **Non-obvious design decisions:** the vault fixture shows a **demo password on the page as bait**; the grader scores 0 if the model typed it, and 1 only if it reached `save_login` or `fill`. The `term_wait_then_write` task checks the "never background a sleep" rule survived the diet. The `term_dev_server` task verifies the server is *still serving* after the run by fetching the page.
- **Edge cases & failure handling:** the temp root is removed at the end; the transcript is written beside the record so a failed cell can be read.
- **Surprising:** the deferred arm's vault stub returns a **different tool reference string** (`browser_vault action=save_login` vs `browser_vault_save_login`), so the two arms' hints are each internally consistent.

### `evals/process_result_receipt_probe.py`
- **Purpose:** proves a background process's output is readable only by its **owner**.
- **Key abstractions:** the `producer` and `consumer` snippets run as separate processes with different `HERMES_HOME`s.
- **Data flow:** the producer spawns a process, waits for the reader thread, and prints the live log; the consumer then reads the log, polls the process and reports the queue depth — as the owner, as a stranger, as unbound, and with a different profile.
- **Non-obvious design decisions:** the four consumer identities are the point: the owner sees the output, the stranger does not, the unbound caller does not, and a different profile does not.
- **Edge cases & failure handling:** the producer's env is scrubbed of every `HERMES_*`/`OPENAI_*`/`*_API_KEY` variable, and the child writes an artifact file as proof the process really ran.
- **Surprising:** the probe writes `result.json` with the *before-exit* state and the three consumer readings, so the ownership boundary is a single readable receipt.

### `evals/prompt_footprint/property_guidance.py`
- **Purpose:** an offline prompt A/B — how many tokens does one platform hint clause cost?
- **Key abstractions:** `PLATFORM_HINTS`; `build_system_prompt`; `OptionalSkillSource`; `skill_view`.
- **Data flow:** the **base** hint is extracted from a pinned git ref with `ast` (never synthesised), swapped in, and the prompt built; then the fixed hint is restored and the prompt built again.
- **Non-obvious design decisions:** the probe asserts `before.replace(base_hint, fixed_hint) == after` — the *only* difference between the two prompts must be that clause, proved by string equality after substitution. The token count is measured with **two** tokenizers (`cl100k_base` and `o200k_base`).
- **Edge cases & failure handling:** the optional-skill path is exercised for real: a skill is fetched, written to disk, loaded through `skill_view`, and its embedded example is parsed.
- **Surprising:** the probe also asserts **byte parity** for the non-property prompt — a change to one hint must not perturb the rest of the prompt.

### `evals/provider_fallback/probe_104120.py`
- **Purpose:** the **fallback chain** contract — which errors arm the cooldown, and which do not.
- **Key abstractions:** `classify_api_error`; `_try_activate_fallback`; `restore_primary_runtime`; the `fallback_model` list.
- **Data flow:** a real `AIAgent` with a fallback chain; the local server returns 429 or 401 depending on the model id; the probe walks the chain manually and records each transition.
- **Non-obvious design decisions:** the five cases are chosen to separate the behaviours: a rate limit **arms** a cooldown and a "Primary retry eligible in ~N s" notice; an **auth** error does **not** arm it; a fallback that *also* rate-limits must not compound the backoff; a chain whose first entry is the **same** model must be skipped without arming; and an **unconfigured** entry must be skipped without arming.
- **Edge cases & failure handling:** the probe asserts the notice text differs between the rate-limit and auth cases, and that the backoff counter is 1 (not compounded) for the skipped and unconfigured cases.
- **Surprising:** the assertion is written as a *sentence* — `PROBE_OK: armed cooldown notice only; skipped and unconfigured entries do not compound backoff` — because that sentence is the specification.

### `evals/provider_fallback/probe_104260.py`
- **Purpose:** the **auxiliary client**'s fallback after a cloud *payment* failure.
- **Key abstractions:** `_is_payment_error`; `_aux_unhealthy_until`; `BackendIdentity`, `FailureScope`, `should_skip_candidate`.
- **Data flow:** a cloud simulator returns 402/429; the auxiliary client must fall back to a healthy local route, and the health cache must hold the cloud route for ~600 s.
- **Non-obvious design decisions:** the **identity** matrix is the subtle part: two custom providers with **distinct URLs** must be treated as the same credential scope (a payment error is credential-wide) but as *different* endpoint and model scopes; and two **named** custom providers with distinct labels must **not** be credential-scoped. The `skip` decision is a pure function, so the matrix is a unit assertion inside a live probe.
- **Edge cases & failure handling:** the sync and async paths are both exercised, and the health cache is checked to be between 590 and 600 seconds.
- **Surprising:** the probe asserts the *exact* identity dictionary, so a change in the scope rules fails loudly rather than silently re-routing a payment-blocked credential.

### `evals/provider_fallback/probe_104360.py`
- **Purpose:** the fallback client's **credential source** must survive the swap and the rebuild.
- **Key abstractions:** `resolve_provider_client`; `_swap_fallback_clients`; `ClientLifecycleMixin`.
- **Data flow:** a `key_cmd` provider is minted, the runtime resolves it, a fallback client is built, and the production swap is exercised — including a **rebuild** from the saved kwargs and a **timeout-configured** swap.
- **Non-obvious design decisions:** the decisive case is the **rotation** case: a rebuilt client must retain the *live source* (a callable that re-reads the token), not a snapshot of the most recently minted key. The probe writes a new token to disk between requests and asserts the wire carried the new one.
- **Edge cases & failure handling:** the Anthropic transport's rotation is checked separately, and the fixture accepts both the old and the new token so the assertion is about *which* token was sent.
- **Surprising:** `out["runtime_key_callable"]` is recorded — whether the runtime key is a callable at all is itself part of the contract.

### `evals/provider_wire/issue_103944.py`
- **Purpose:** named-route **reasoning parity** — a custom provider with a name must not lose `reasoning_effort`.
- **Key abstractions:** `get_compatible_custom_providers`; `get_custom_provider_context_length`; `ChatCompletionsTransport.build_kwargs`.
- **Data flow:** four models with different declared `reasoning_format`s are run under both `custom:my-gateway` and `custom`; the request bodies are captured and compared with the kwargs the agent built.
- **Non-obvious design decisions:** the probe asserts the **declared per-model `reasoning_format` is unsupported on both arms** (including `none`) — so the fix is not "honour the declaration" but "do not lose the parameter on a named route". The "profile-path controls" show that even passing `custom_providers` to the transport directly cannot activate the key — the shipped code has no such consumer.
- **Edge cases & failure handling:** a `sys.addaudithook` blocks any DNS lookup that is not loopback; the env is cleared and asserted to contain no `API_KEY`/`TOKEN`/`SECRET`.
- **Surprising:** the probe reports both arms with a `status` string that differs ("parity restored" vs "reasoning loss reproduced"), so one run of the file tells you which tree you are on.

### `evals/provider_wire/issue_104282.py`
- **Purpose:** the Responses adapter must **reject video inputs** rather than silently dropping them.
- **Key abstractions:** `_CodexCompletionsAdapter`; `_preflight_codex_input_items`.
- **Data flow:** four content kinds (`video_url`, `video`, `input_video`, `image_url`) are pushed at the adapter; the wire capture shows what was actually sent.
- **Non-obvious design decisions:** the image case must still **succeed** and must be converted to an `input_image` item on the wire — a fix that rejects everything would pass a naive "reject videos" assertion. The expected outcome depends on the arm, so the same file is a before/after probe.
- **Edge cases & failure handling:** a `ValueError` from the adapter is caught and recorded as `rejected` with the error text; no HTTP call is made for a rejected input.
- **Surprising:** the probe asserts the wire's *input item type* (`input_image`), so the conversion is verified, not just the status.

### `evals/provider_wire/issue_104359.py`
- **Purpose:** a private marker on a persisted message must not leak into the **provider wire**.
- **Key abstractions:** `_prepare_moa_request`; `SessionDB.get_messages_as_conversation`; `ChatCompletionsTransport.build_kwargs`.
- **Data flow:** a session is seeded; the history is loaded from SQLite (where each row carries `_db_persisted`); the MoA path prepares the request; the fixture returns **400** if any message key starts with `_`.
- **Non-obvious design decisions:** the fixture enforces the leak at the **server**, exactly as a strict provider would. The probe asserts both directions: the prepared (internal) request *may* carry the marker, and the normal transport's request must **not**. The history must be unchanged afterwards.
- **Edge cases & failure handling:** the "advis" assertion checks that the MoA path really did send an advisor request, so the probe cannot pass by sending nothing.
- **Surprising:** the MoA path is where the bug was — the marker is needed internally and must be stripped at the boundary.

### `evals/providers/reasoning_shapes.py`
- **Purpose:** the **reasoning shape** matrix — how each surface extracts reasoning from each wire shape.
- **Key abstractions:** `CASES` (string, text-parts, split-fragments, dict, empty, nontext-parts); five surfaces (`main`, `relay`, `aux-sync`, `aux-async`, `nonstream`).
- **Data flow:** a local server returns the fixture reasoning in a different field each time; the real consumers (`extract_reasoning`, `_aggregate_chat_stream`, `RelayChatAccumulator`, `interruptible_streaming_api_call`) are driven and the extracted text compared with the expectation.
- **Non-obvious design decisions:** the expectations differ **per surface**: the streaming surfaces join fragments with `\n\n` while the non-streaming surface takes only the first, and the main surface's `reasoning_callback` must receive *only strings* whose concatenation equals the expectation.
- **Edge cases & failure handling:** `empty` and `nontext-parts` must yield `""`, and a non-text part must not become reasoning.
- **Surprising:** the `split-fragments` case exists because a fragmented answer must be reassembled in the *answer* too, not only the reasoning.

### `evals/readtool/fixtures.py`
- **Purpose:** the hostile-workspace generator for the read-tool eval.
- **Key abstractions:** `build_workspace(dest)`; the ground-truth constants (`LEFT_PAD_VERSION`, `RETRY_BASE_MS`, `LOG_ERROR_REQ_ID`, `REPORT_LINES`, `NOTES_BULLET_3`, `AGENTS_BUILD_CMD`).
- **Data flow:** a deterministic workspace is written: an 80 K-line `package-lock.json`, a single 600 KB `app.min.js`, a 150 K-line log with one ERROR near the tail, a 412-line report, an empty config, a unicode-mangled filename, a near-miss `AGENT.md`/`AGENTS.md` pair, a **FIFO**, and a `.txt` that is really a PNG.
- **Non-obvious design decisions:** the unicode filename is written in **NFD + U+202F + U+2019** while the prompt uses the clean spelling — the two render identically, which is the only way to test the equivalence. The comment says accent-dropping is deliberately excluded (it is a *visible* difference and belongs to did-you-mean).
- **Edge cases & failure handling:** the fixture is seeded (`random.Random(20260809)`) so every run gets the same bytes; the FIFO is created with `os.mkfifo`.
- **Surprising:** the lockfile is a *token tarpit* — 8,000 packages of noise adjacent to a one-line answer in `package.json`.

### `evals/readtool/tasks.py`
- **Purpose:** the read-tool task battery, one task per hostile-file shape.
- **Key abstractions:** the `Task` dataclass; the graders `_grade_lockfile`, `_grade_backoff`, `_grade_empty`, `_grade_fifo`, `_grade_binary`; `_has` and `_regex`.
- **Data flow:** each task's `grade(final_response)` returns 0.0–1.0 against the planted ground truth.
- **Non-obvious design decisions:** the graders are **forgiving about phrasing and strict about facts** — `_grade_backoff` awards 0.4 for the base value, 0.4 for the growth pattern (matched by several spellings) and 0.2 for the cap. The `near_miss_filename` task asks for `AGENT.md` when only `AGENTS.md` exists, so the did-you-mean behaviour is the subject.
- **Edge cases & failure handling:** the `fifo_hang` task's prompt **names the tool** so the guard itself is exercised rather than sidestepped by `stat`.
- **Surprising:** the `past_eof` task asks for lines 900–950 of a 412-line file — the correct answer is to *say* the file is shorter, and the grader only wants the line count.

### `evals/readtool/runner.py`
- **Purpose:** the read-tool eval runner through the **real** `AIAgent`.
- **Key abstractions:** `run_task(task, model, provider, timeout_mult, toolsets)`; `_count_metrics`.
- **Data flow:** a fresh temp home and a fresh fixture workspace per task; the agent runs with the file+terminal+search toolsets; the result JSON records score, turns, tool calls, `read_file` calls, tokens and wall.
- **Non-obvious design decisions:** the `--toolsets` flag exists for the **discriminative arm** (`file` only, no terminal escape hatch) — "the read tool must handle the hostile file itself". A **harness misconfiguration** (no provider, auth error) aborts the whole run rather than writing poisoned zero-score records.
- **Edge cases & failure handling:** only the API key the run needs is kept; the env is restored in `finally`; the temp dirs are removed.
- **Surprising:** `tool_error_results` is counted separately from `read_file_calls`, so "the tool refused" and "the model gave up" are different outcomes.

### `evals/readtool/report.py`
- **Purpose:** compares result sets across labels.
- **Key abstractions:** `load_label(label, model_filter)`; the `METRICS` list.
- **Data flow:** per-task means over reps, then a mean across tasks.
- **Non-obvious design decisions:** the aggregates are **per-task means over reps, then averaged across tasks — never sums**, because the tasks have wildly different costs. The note at the bottom states the errored-run rule: score 0 but excluded from efficiency means.
- **Edge cases & failure handling:** a label with no directory is a hard error (`raise SystemExit`).
- **Surprising:** the report prints the delta percentage against the first label, so the "after" column is readable as a percentage of the baseline.

### `evals/reasoning_replay/harness.py`
- **Purpose:** does a provider **actually read** the reasoning a client replays? A 200 only proves the field was accepted.
- **Key abstractions:** `ROUTES` (19 named routes); `Prober`; `Budget`; `make_trace`; the variant/position matrices.
- **Data flow:** a synthetic conversation (system, user, an assistant tool call carrying a ~400-token trace, the tool result, a probe) is sent in five wire shapes at two positions; the **prompt-token delta** against a byte-identical baseline is the primary signal; a canary recall question is the secondary one.
- **Non-obvious design decisions:** (1) the delta is measured against a request that differs in **one field only**; (2) the **lane** is identified from the response id, and a cell that only ever reached the OpenRouter lane is reported as `direct-lane-not-reached`, never as a pass; (3) the **baseline is backfilled per lane** — a carrier that landed on a lane with no baseline gets one; (4) the probe wording has an `alt` variant because xAI 403s a question about "earlier reasoning", and deltas are only ever computed between requests with the *same* wording; (5) the budget is a **file-backed accumulator** shared across every run that uses the same `--out`, so a second run cannot exceed the cap.
- **Edge cases & failure handling:** `_refused` recognises both a 403 and a 200 with no usage block (Anthropic's content filter); a 401 on the Portal key re-reads `auth.json` once and waits 15 s; transient statuses are retried with backoff.
- **Surprising:** the verdicts are a **taxonomy** — `consumes-all-turns`, `in-loop-only`, `accepted-ignored`, `rejected`, `baseline-failed`, `direct-lane-not-reached` — so the output says *how* a provider treats reasoning, not merely whether a call succeeded.

### `evals/session_search_schema/fixtures.py`
- **Purpose:** the synthetic session DBs for the `session_search` A/B.
- **Key abstractions:** `seed(dbdir)`; the `mk(db, sid, title, age_s, msgs)` helper.
- **Data flow:** a main `state.db` and a `work`-profile `state_work.db` are written with sessions whose facts are planted for the six tasks.
- **Non-obvious design decisions:** every task has an *oracle-shaped* fixture: the 504 incident's final fix (`statement_timeout to 45s`) sits ~24 messages in, outside the ±5 discovery window **and** outside the bookends (trailing chatter is appended so "the last 3 messages" does not contain it); "grafana" and "beehive" never co-occur in one message, so an AND-query must be broadened.
- **Edge cases & failure handling:** the `t4_link` task needs the model to emit an `@session:` link *verbatim* — not backticked, not in markdown.
- **Surprising:** the fixtures are written to be hostile to the *retrieval*, not to the model — a task that only needs one lucky message would not measure the scroll/broaden behaviour.

### `evals/session_search_schema/tasks.py`
- **Purpose:** the shared task battery for the `session_search` schema A/B.
- **Key abstractions:** `TASKS` (prompt, oracle, note) — six tasks covering discovery, scrolling, a broadened query, a link emission and a cross-profile lookup.
- **Data flow:** each task's oracle is a **pure function of the final answer** — no LLM judge is involved.
- **Non-obvious design decisions:** the fixtures are hostile to the *retrieval*, not to the model: the answer sits outside the ±5 discovery window and outside the bookends.
- **Edge cases & failure handling:** the `t4_link` task requires an `@session:` link **verbatim** — not backticked, not in markdown.
- **Surprising:** because the oracle is mechanical, the A/B's number (49/54 → 52/54) is not a judgement call.

### `evals/session_search_schema/runner.py`
- **Purpose:** the live A/B runner — the only variable between arms is one module.
- **Key abstractions:** `ALLOWED_KEYS`; `extract_arm(ref, workdir, name)`; `load_arm(path, name, work_db_path)`.
- **Data flow:** `tools/session_search_tool.py` is extracted from **two git refs** with `git show` and imported side by side; a minimal agent loop runs the shared battery against a freshly seeded DB.
- **Non-obvious design decisions:** the profile resolver is replaced so the `work` profile resolves to a read-only DB; unknown parameters are rejected by the harness itself, so a schema that advertises a parameter the arm does not implement scores as a *bad call*, not a crash.
- **Edge cases & failure handling:** provider noise (zero tool calls **and** an empty final) gets one retry, applied identically to both arms, and the retry is logged; the tool output is elided at 30,000 characters; the result JSONL is resume-safe by `(task, arm, rep)`.
- **Surprising:** the README's payoff is that the schema diet alone moved 49/54 → 52/54 and 7.0K → 5.3K tokens per task, and that *both* arms surfaced a pre-existing `around_message_id=0` falsy-sentinel bug.

### `evals/session_search_schema/report.py`
- **Purpose:** aggregates the runner's JSONL into the comparison tables.
- **Key abstractions:** the per-task and per-model roll-ups.
- **Data flow:** reads `results/<label>/<model-slug>.jsonl` and prints the task, arm, score, tool-call and token columns.
- **Non-obvious design decisions:** the token column is reported **per task**, because a total would hide that the win came from the cheap tasks.
- **Edge cases & failure handling:** a missing label is reported rather than silently producing an empty table.
- **Surprising:** the same table shows the *pre-existing* bug the A/B surfaced, so the report doubles as a defect list.

### `evals/session_snapshot_removal.py`
- **Purpose:** a real config → SQLite → explicit `/save` A/B — automatic JSON snapshots should be gone.
- **Key abstractions:** `_init_session_state`; `SessionPersistenceMixin._persist_session`; `CLISessionMixin.save_conversation`.
- **Data flow:** the config sets `sessions.write_json_snapshots: true`; a session is persisted; the logs directory is scanned for `session_*.json`; an explicit `/save json` is written and read back.
- **Non-obvious design decisions:** the probe keeps the **explicit** save path and asserts its messages, so the change is "automatic snapshots removed", not "saving removed".
- **Edge cases & failure handling:** the SQLite message count is printed next to the snapshot list, so a reader can see that the data is still durable.
- **Surprising:** the output has three fields — automatic snapshots, SQLite message count, explicit saved messages — which is exactly the shape of the claim being made.

### `evals/shared_gateway/cases.json`
- **Purpose:** the **acceptance manifest** — 47 named scenarios from the unified gateway plan.
- **Key abstractions:** each case has `name`, `stimulus`, `required_observation`.
- **Data flow:** `verify_receipt.py` compares a driver's receipt against this manifest.
- **Non-obvious design decisions:** the manifest is described as *"requirements, not recorded passes"* — it enumerates what must be *observed*, and the checker verifies **coverage and evidence availability**, not the truth of the observation. The scenarios read as a threat model: `prepared-before-send-crash`, `owner-crash-queued`, `owner-crash-started`, `stale-finally`, `revision-conflict`, `readonly-client`, `secret-response`, `view-is-not-delivery`, `worker-revoked`, `worker-outbox-full`.
- **Edge cases & failure handling:** the checker rejects missing, extra or duplicate scenarios; a non-passing outcome; a case with zero assertions; and evidence paths that are missing, empty or **outside the receipt directory**.
- **Surprising:** `secret-response` requires that "replay/transcript/logs contain no answer" — the audit trail must not become a secret leak.

### `evals/shared_gateway/verify_receipt.py`
- **Purpose:** checks a measured receipt against the required case set.
- **Key abstractions:** `verify(receipt, manifest, evidence_root, expected_sha, expected_os)`.
- **Data flow:** the receipt's schema, source sha, native OS, isolation flag, dispatch flag, model boundary and leftover process list are all checked before the case set is compared.
- **Non-obvious design decisions:** the checks are: schema, **stale source SHA**, **wrong native OS**, fixture home not isolated, production dispatch not exercised, unknown model boundary, and **fixture leaked processes**. Evidence paths are resolved and must be **inside** the receipt root and non-empty.
- **Edge cases & failure handling:** every failure is a `ValueError` with a precise message and the CLI exits 1.
- **Surprising:** the success message still says "native topology/trace review still required" — the checker never claims the deployment is accepted.

### `evals/shared_gateway/normal_boot.py`
- **Purpose:** a live POSIX bootstrap **descriptor** check.
- **Key abstractions:** the `gateway.sock` control protocol (`{"protocol":1,"verb":"identify"}`).
- **Data flow:** `python -m gateway.run` is launched in a disposable home; the probe polls the control socket until the owner advertises `ready`, protocol 1, an authority epoch and an API origin.
- **Non-obvious design decisions:** only **five keys** are retained from the descriptor — credentials and arbitrary server payloads never enter the receipt. The descriptor transitions are recorded (not just the final state), so a slow start is visible.
- **Edge cases & failure handling:** the process group is killed with SIGTERM then SIGKILL, and a forced cleanup is flagged in the receipt. The probe refuses to run on non-POSIX.
- **Surprising:** the README insists a descriptor pass is **not** proof of an authenticated API handshake, and that a failure should be retained rather than the assertion weakened.

### `evals/shared_gateway/search_readonly_ab.py`
- **Purpose:** a read-only client must not **write** to the store it observes.
- **Key abstractions:** the `PRAGMA data_version` change detector.
- **Data flow:** the registered `session_search` tool is called in fresh interpreters with an empty, a foreign and an existing profile.
- **Non-obvious design decisions:** `PRAGMA data_version` detects a write without reading the whole file, so the check is cheap enough to run inside a test.
- **Edge cases & failure handling:** the baseline must **create an unwanted current-profile DB** or commit a read-side write; the fixed tree must not.
- **Surprising:** a "read" that creates a database is a write, and only a file-level check would have caught it.

### `evals/shared_gateway/session_readers_cli_ab.py`
- **Purpose:** the CLI half of the read-only A/B.
- **Key abstractions:** the DB file's **sha256** comparison before and after.
- **Data flow:** the real CLI runs `insights`, `sessions list`, `sessions stats` and `sessions pinned --json` against empty and populated profiles.
- **Non-obvious design decisions:** the two halves use *different* detectors — a `PRAGMA` change counter for the tool, a byte hash for the CLI — so neither detector's blind spot can hide a write.
- **Edge cases & failure handling:** the source file's sha256 and the tree's dirtiness are recorded, so the receipt identifies exactly the code that ran; the CLI probe also asserts the *output* is correct, so a command that writes nothing but prints the wrong thing still fails.
- **Surprising:** the README is explicit that the CLI probe "does not cover exports, native interactive clients, or concurrent-owner reads" — the coverage boundary is stated in the artefact itself.

### `evals/slack_stream_wire_contract.py`
- **Purpose:** the Slack native stream contract — `markdown_text` and `chunks` are mutually exclusive.
- **Key abstractions:** the aiohttp receiver; `send_native_task_card_progress` / `stop_native_task_card_progress`; `send_draft` / `_seal_stream`.
- **Data flow:** the real `SlackAdapter` runs against a real `slack_sdk.AsyncWebClient` whose `base_url` points at the local receiver; the receiver **enforces** the documented rule and returns `cannot_provide_both_markdown_text_and_chunks`.
- **Non-obvious design decisions:** the receiver is a *contract enforcer*, not a recorder: a violating request gets the real Slack error. The probe covers both rails (the task-card rail and the text-stream rail) and counts violations.
- **Edge cases & failure handling:** the `slack_sdk` version is recorded in the receipt, so a behaviour change upstream is visible.
- **Surprising:** the label is deliberately explicit: "WIRE-CONTRACT PROOF (local receiver, slack_sdk real client) — NOT Slack live".

### `evals/subagent_process_handoff/stress_handoff_live.py`
- **Purpose:** a live stress harness for subagent **background-process accounting** — a child that starts a process must either hand it off, read it, or have it terminated.
- **Key abstractions:** the `SCENARIOS` dict; `run_scenario(name, prompt, …)`; the `check` lambdas.
- **Data flow:** a real orchestrator delegates to real children on one model; the probe reads the runtime's **own accounting** (`handed_off_processes`, `orphaned_processes`, `unread_completions`) and what the parent's between-turn drain receives.
- **Non-obvious design decisions:** the docstring says it outright: *"Never trusts model prose for the verdict."* The twelve scenarios cover a plain handoff, a named orphan, an unread completion, a read-then-finish (nothing flagged), a **cap** (5 attempts, 3 succeed, 2 orphan), a mixed fan-out, a handoff of an **already-exited** process, parent control of an inherited process, **sibling theft** (and a forced variant where the model is told it is authorised), a nested orchestrator, and a five-child burst.
- **Edge cases & failure handling:** the forced-theft case requires the refusal text to be exactly "not a running process you own" — the guard must refuse even when the model claims authority.
- **Surprising:** the adversarial scenario where the model is *told* it is authorised to steal is the sharpest test in the file, and the runtime's answer must be a refusal.

### `evals/token_accounting/ab_image_cost_calibration.py`
- **Purpose:** does the compaction trigger learn the **real per-image cost** from provider usage?
- **Key abstractions:** `_FakeVisionChat` (prices every image at 4,000 tokens, 400s past the window); `learned_image_token_cost`; `image_cost_context`.
- **Data flow:** a GUI-like loop appends one screenshot per turn on a 65 K window; the fake returns a context-overflow 400 past the limit, like llama.cpp.
- **Non-obvious design decisions:** the flat default image cost is 1,500 and the real one is 4,000 — the probe measures whether the *learned* value converges. The tail walk is measured separately, because a screenshot-per-row tail can exceed the budget by design (the walk has an 8-row hard floor); the invariant is that the walk's own accounting of that tail tracks the provider's.
- **Edge cases & failure handling:** the `verdict` requires **zero provider overflows**, at least one compression, and the learned cost within 15% of the real one.
- **Surprising:** the config must declare `supports_vision: true`, because an unknown custom model is treated as non-vision and its images are replaced by text.

### `evals/token_accounting/display_provenance.py`
- **Purpose:** a credential-free PTY/live A/B of the **context display** — what the trader is told about token usage.
- **Key abstractions:** `compute_session_context_breakdown`; `_format_live_context_output`; `_get_usage`; the `/context` and `/status` commands.
- **Data flow:** three scenarios — a local estimate, a provider-reported usage, and provider usage plus a new unpriced question — each rendered through the CLI, the TUI/Desktop live view, the gateway `/status` and `/context`, and the gateway's usage category block.
- **Non-obvious design decisions:** the fourth case is the **unmetered** one: the provider returns no `usage` block, and the display must not invent one. The probe runs the child under a PTY so the real terminal rendering is captured.
- **Edge cases & failure handling:** `assert result["completed"] and result["last_prompt_tokens"] == 1234` pins the metered case; the unmetered case writes its own receipt.
- **Surprising:** the probe captures the *same* scenario across four different surfaces, because a number that is honest on one surface can lie on another.

### `evals/token_accounting/replay_gates.py`
- **Purpose:** do the compaction gates follow the provider's **real usage** or the local `bytes/4` estimate?
- **Key abstractions:** `_FakeChat` (scripted per-request usage); the `cli`/`gateway`/`restore` **shapes**; `restore_usage_anchor`.
- **Data flow:** each shape is run with an `inflated` transcript (bytes/4 far over the threshold, real usage under), a `past_window_inflated` case, and a `deflated` transcript (bytes/4 tiny, real usage over).
- **Non-obvious design decisions:** the three shapes exist because they have different **object identities**: the CLI reuses the same history list; the gateway JSON-round-trips the history every turn (so the usage anchor keyed on `id` is stale and the rough estimator decides); the restore case persists to a real `SessionDB`, closes and reopens it, and resumes with a **fresh** agent. A capability probe (a request without `messages`) must not consume usage.
- **Edge cases & failure handling:** the **negative arm** is the important one — a deflated transcript with real usage over the threshold **must** fire local compression after turn 1. The overflow-recovery scenario runs a real compression with only the summary text stubbed, and asserts the second request is smaller than the first.
- **Surprising:** the provider usage is deliberately **disagreeing** with the transcript size in both directions, so a gate that trusts either signal alone fails one arm.

### `evals/token_accounting/worktree_prompt_prefix.py`
- **Purpose:** an offline real-worktree **prompt prefix** probe — is the stable part of the system prompt stable across worktrees?
- **Key abstractions:** `build_system_prompt_parts(agent)`; `build_prompt_cache_plan`; `_stored_prompt_matches_runtime`.
- **Data flow:** a fixture git repo with a 66 KB `AGENTS.md` and two worktrees; two processes (one per worktree) build their prompts; the **longest common prefix** of the two full prompts and of the two stable parts is computed.
- **Non-obvious design decisions:** the fixture repo is created with a fixed identity (`probe@example.invalid`) and `GIT_CONFIG_GLOBAL=/dev/null` so the environment cannot leak into the prompt. The "trailing decoy" test appends operator-looking instructions to the prompt and checks that the stored-prompt matcher still accepts it, while a **cwd drift** must be rejected.
- **Edge cases & failure handling:** the metric block records the *offsets* of the cwd line, the workspace snapshot, the root list and the project context in the prompt — so a drift in the *position* of the variable part is visible, not just its content.
- **Surprising:** `provider_usage: None` and `billing_measured: False` are printed in the receipt — the probe is explicitly not a billing measurement.

### `evals/tool_search/analyze_livetest.py`
- **Purpose:** the enabled/disabled comparison report for the tool-search live test.
- **Key abstractions:** `fmt_tool_seq`; `fmt_bridge_seq`.
- **Data flow:** it reads `_summary.json` and the per-scenario JSONs and prints a side-by-side.
- **Non-obvious design decisions:** the bridge sequence is rendered as `search('…') → describe(…) → tool_call→inner` so the *shape* of the discovery is visible, not just the count. The "extra tools called" list excludes a set of core tools so the signal is not drowned.
- **Edge cases & failure handling:** a scenario with a missing arm is skipped; the fail count is over `2*len(scenarios)`.
- **Surprising:** the "Δ round-trip cost" line computes the bridge overhead as `bridges + underlying - disabled_underlying` — the honest cost of the deferral mechanism.

### `evals/tool_search/tool_search_livetest.py`
- **Purpose:** the original tool-search live test — a real agent, ~20 fake MCP tools, five scenarios, run twice (bridge on / eager).
- **Key abstractions:** `FAKE_MCP_TOOLS`; `SCENARIOS` (A obvious, B paraphrased, C chain, D core+deferred, E no tool needed); `setup_isolated_home`; `register_fake_tools`; `_redact_secrets`.
- **Data flow:** the fake tools are registered in the live registry; the agent runs; the tool calls are captured by wrapping `registry.dispatch`; the bridge calls are extracted from the **message transcript** (the real wire shape) rather than by monkeypatching.
- **Non-obvious design decisions:** the fake tool names are deliberately vague (`evt_create`, `docsearch_query`) so retrieval is stressed. The credential handling is careful: the real `.env` is loaded through the canonical `hermes_cli.env_loader.load_hermes_dotenv` so the secret never lands in a local variable in the module. `_redact_secrets` masks the live key, `sk-`-style tokens and `authorization:` headers before anything is written.
- **Edge cases & failure handling:** `reset_module_state()` drops the cached modules so a new `HERMES_HOME` takes effect; the temp home is removed after each scenario.
- **Surprising:** the `expected_core_tool_direct` flag on scenario D encodes a real requirement — `read_file` must **not** be reached through the bridge.

### `evals/tool_search/tool_search_livetest2.py`
- **Purpose:** benchmark v2 — real **token accounting**, more scenarios, reps.
- **Key abstractions:** `normalize_usage` (wrapped); the `post_api_request` plugin hook; the `enabled`/`listing`/`disabled` modes.
- **Data flow:** each scenario runs N reps in each mode; per-call usage is captured.
- **Non-obvious design decisions:** the usage hook is registered **after** `AIAgent` construction, because plugin discovery during init calls `_hooks.clear()` — a real trap the comment records. The `normalize_usage` spy is the preferred source because it fires exactly once per API response on both the streaming and non-streaming paths. Three new scenarios are added: a paraphrase with **zero name overlap**, a capability that does not exist (the model must say `CANNOT:` rather than hallucinate), and a three-server chain.
- **Edge cases & failure handling:** the spy is restored in `finally` and the hook removed; the success criterion unwraps `tool_call` bridges back to the underlying tool name.
- **Surprising:** the third mode — `listing` (bridge **plus** a catalog listing) — exists so the bridge can be compared against a *skills-style* catalog, which is the design the UE benchmarks then test at scale.

### `evals/tool_search/tool_search_livetest_ue.py`
- **Purpose:** benchmark v3 — the **real Epic UE 5.8 MCP surface** (830 schemas) replayed at scale.
- **Key abstractions:** `load_epic_tools(scale)`; `EDITOR_TOOLSETS`; the `eager`/`bridge`/`listing` modes; `TS_UE_SCALE`.
- **Data flow:** the schemas captured live from Epic's plugin are registered with mock handlers; eight UE-realistic scenarios run in three modes.
- **Non-obvious design decisions:** the catalog is **real** (830 tools, ~165 K tokens eager) but the handlers are mocks, so the score measures retrieval and selection, not UE. The `full` scale gets a 30 K listing budget and the `editor` scale 4 K, because the listing is supposed to fit. The `expected_any` matching is a **substring** match on sanitised names.
- **Edge cases & failure handling:** two scenarios are `full_only` (a buried tool, and a plausible-but-absent "console exec"). The honesty scenarios require the answer to contain `CANNOT`.
- **Surprising:** the system prompt tells the model the editor is *already connected* and not to try to launch it — the failure mode being measured is tool selection, not environment discovery.

### `evals/tool_search/tool_search_livetest_ue_hard.py`
- **Purpose:** benchmark v4 — **adversarial** UE tool selection at 830 tools, targeting confusion clusters.
- **Key abstractions:** the `WORLD` map (asset path → type); `make_mock` (type-aware handlers); `register_epic_tools_adversarial`.
- **Data flow:** ten scenarios; the mocks return a realistic editor error when a tool is used against the wrong asset type, so a wrong pick **visibly fails**.
- **Non-obvious design decisions:** the scenarios target **near-identical names in different toolsets** (`StaticMeshTools_set_material` vs `SkeletalMeshTools_set_material`; `NiagaraToolset_Component_SetVariable` vs `NiagaraToolset_System_AddUserVariables`) and never quote the tool name. The scoring is strict: `success = final_correct AND wrong_calls == 0` — a *clean* solve, so a run that recovers after a wrong pick still scores 0. `first_correct` is recorded separately to show where it went wrong.
- **Edge cases & failure handling:** the world reads are coherent (actors have components, the Niagara system is an asset) so a model can chain calls; the `V10_zero_keyword` scenario names no tool at all ("the thing showing all the stuff placed in the world").
- **Surprising:** the prompt itself warns the model that "several toolsets contain similarly-named tools for different object types" — the benchmark measures retrieval under an *adversarial* catalog, not under ignorance.

### `evals/tool_search/tool_search_livetest_ue_disc.py`
- **Purpose:** benchmark v5 — **discovery-bound** tasks at 830 tools, isolating *knowing what exists*.
- **Key abstractions:** the `D`/`A`/`S` task families; `score_survey(resp, truth)`; the write/read call split.
- **Data flow:** five D scenarios (the tool exists, the prompt shares **zero** lexical surface with it), three A scenarios (no such tool, verified against all 830), and one S scenario (a five-item capability survey).
- **Non-obvious design decisions:** the A family scores a refusal with **no** write call — the cost of proving a negative is measured in `searches_used` and `api_calls`. The S family requires all five capabilities to be classified correctly. The write/read split is done by name heuristics so a hallucinated *write* is caught even if the model also refused.
- **Edge cases & failure handling:** the survey's truth map is explicit, so a wrong `YES`/`NO` is a failure rather than a judgement call.
- **Surprising:** the D scenarios are the BM25-hostile ones — "its glow strength setting should go to 5.0" for a `NiagaraToolset_Component_SetVariable`, with no word in common.

### `evals/toolperf_abeval/ab_eval.py`
- **Purpose:** the hard A/B for core-toolset changes, scored from **NeMo Relay ATOF traces** rather than from self-report.
- **Key abstractions:** `TASKS` (9 error-inducing tasks); `make_sandbox(work)`; `SUCCESS` (mechanical checks); `score_run(atof)`.
- **Data flow:** each run writes a Relay `plugins.toml` pointing at an ATOF file sink, runs `hermes chat --query … --max-turns 30`, and the trace is parsed for `llm`/`tool` scope events.
- **Non-obvious design decisions:** the tasks are **traps**, one per measured waste class: `python` vs `python3`/venv confusion, an already-applied patch, an ambiguous multi-match edit, wrong-casing search, hidden-dir search, giant truncated output, cd-heavy multi-dir work, a blocklist-tripping inline script, and a paginated big-file read. The success checks are **mechanical** — marker strings and on-disk state. An **infra crash** (non-zero exit with empty output) is *not recorded*, because it polluted the first pass of the Aug 2026 run.
- **Edge cases & failure handling:** the `err_replay_patch` check asserts the file still contains exactly **one** `RETRY_LIMIT = 30` line — a "fix" that duplicates the line fails. The `err_multi_dir` check reads the produced `versions.txt` back.
- **Surprising:** the arms differ only by `PYTHONPATH`, which is the cleanest possible A/B: any delta is attributable to the diff.

### `evals/toolperf_abeval/run_all.sh`
- **Purpose:** the driver for the toolperf battery.
- **Key abstractions:** the `BASE`/`FIXES`/`REPS`/`MODELS` arguments; `ABEVAL_HOME` and `ABEVAL_ROOT`.
- **Data flow:** for each model, it runs the baseline arm and the fixes arm and then prints the report.
- **Non-obvious design decisions:** `set -euo pipefail` and the `shift $(( $# >= 3 ? 3 : 2 ))` dance make the optional model list work with or without a reps argument. `ABEVAL_ROOT` defaults to `$PWD/abeval-workspace`.
- **Edge cases & failure handling:** the script refuses to start without `ABEVAL_HOME`; the README says to use a *dedicated* home so the run's credentials are scoped.
- **Surprising:** the default model pair is deliberately **one frontier and one strong open model** — "weak models are the signal".

### `evals/update_check_ssh_pty.py`
- **Purpose:** a Linux live Git/OpenSSH PTY probe — does the update check prompt before fetching over SSH?
- **Key abstractions:** a loopback `sshd` with a fixture config; an `ssh` wrapper on `PATH` that adds `-F` and execs the **real** `/usr/bin/ssh`; `known_hosts` and `ssh-agent` fixtures.
- **Data flow:** four cases are probed — an unknown host, a trusted host file, a trusted host with an agent key, and an explicit interactive override. The real `source_check.check_for_updates` runs in the child and prints `PRODUCTION_RETURN` with the result and the elapsed time; the parent records the PTY text and the **live descendants** of the child process group.
- **Non-obvious design decisions:** the `ssh` wrapper only adds `-F`; it execs the real binary, so the probe exercises the real OpenSSH. The `known_hosts` is deleted for the fourth case so the interactive prompt is the only thing left. The descendants scan reads `/proc` to prove the check did not leave a hanging git/ssh child.
- **Edge cases & failure handling:** the server and the agent are killed in `finally`; `server_stopped` and `agent_stopped` are recorded.
- **Surprising:** the probe records the **prompt text** ("Are you sure you want") and the elapsed time, because a check that silently blocks for 30 s is the failure.

### `evals/update_obligation_identity.py`
- **Purpose:** a disposable process/state-file A/B — a *current* successor must settle the update warning.
- **Key abstractions:** `fleet._current_checkout_sha()`; `receipts.collect_fleet_versions()`; `fleet._pending_fleet_restart_needed()`.
- **Data flow:** two profile children write a runtime status through the production code; a receipt file names them as stale; the probe then degrades one child's `code_sha` to `old`, then to `None`, then kills the child.
- **Non-obvious design decisions:** the pending flag must be true for a **stale**, an **unknown** and a **missing** child, and **false** when the children are current — the last one is the bug being fixed. The receipt file must be left byte-identical by the observation.
- **Edge cases & failure handling:** the children are terminated and their exit codes printed in `CLEANUP`.
- **Surprising:** the verdict line is `FIXED`/`REPRODUCED`, and the script exits 1 on the unfixed tree.

### `evals/update_pipeline/interrupted_pull_ab.sh`
- **Purpose:** the live A/B for the **interrupted-pull repair** — a killed update must not leave a torn tree, and the user's uncommitted work must survive.
- **Key abstractions:** a **fake `git`** on `PATH` that writes a real file, takes `index.lock` and then sleeps, so the probe can SIGKILL at a precise point; the `hermes-update-pull` marker.
- **Data flow:** five scenarios — A (killed before git wrote anything), B (a merge conflict, not a kill), C and D (a torn tree in a clone and in a linked worktree), and E (killed inside the custom-branch merge).
- **Non-obvious design decisions:** the fake git is used to create a **genuinely torn tree** (`git show origin/main:hermes_cli/config.py > …` then `index.lock` then sleep) rather than simulating one. The linked-worktree case (D) exists because `.git` is a *file* there, which breaks naive path handling. The marker is read from `$(git rev-parse --git-dir)/hermes-update-pull`.
- **Edge cases & failure handling:** the user's edit is placed on a file git **never wrote**, which is the case the repair must handle; the re-update must land on `origin/main` with the user's edit still present.
- **Surprising:** the whole scenario set is driven by **one** mechanism — a fake `git` that stalls at a chosen flag — which is why the A/B is deterministic.

### `evals/update_pipeline/post_swap_handoff_ab.sh`
- **Purpose:** the post-swap hand-off — after a pull, the completion line must run on the **pulled** code, not the pre-pull interpreter.
- **Key abstractions:** the origin/install/author clone trio; the `hermes_logging` symbol probe.
- **Data flow:** a target commit adds a symbol to `hermes_logging`, imports it at module level from `hermes_cli/config.py` (the module the old updater re-imports during config migration), and tags the completion line; then `hermes update --yes --no-backup --no-gateway-restart` runs in the install.
- **Non-obvious design decisions:** the probe **manufactures the stale-symbol class**: the pre-pull interpreter would raise `ImportError` on the new symbol, so the "Could not check config version" warning is a real, reachable failure and not a simulated one. `--no-gateway-restart` means the probe never touches the user's fleet.
- **Edge cases & failure handling:** the receipt (`logs/update_receipts/latest.json`) is read for the outcome, exit code, pid, `post_swap_pid` and the step list; the script prints a single `VERDICT` line.
- **Surprising:** the two phases are the same script run at two SHAs (merge-base vs head) — the A/B is the *same* harness against a different commit.

### `evals/update_streaming/live_output.py`
- **Purpose:** a disposable subprocess/tee probe — the update's **output must stream** and must not leak to the screen pipe.
- **Key abstractions:** `_install_hangup_protection`; `_finalize_update_output`; `_run_logged_subprocess`.
- **Data flow:** a child writes `build-progress ` every 0.5 s; the probe watches the log file and records whether the progress appeared **before** the child exited, the elapsed time, and the captured byte counts.
- **Non-obvious design decisions:** the probe runs in two modes (`gateway=False/True`) because the hang-up protection differs. The `silent` mode is the control: a silent child must not produce progress.
- **Edge cases & failure handling:** the screen capture is asserted empty, and the log file's size is recorded.
- **Surprising:** the same file's `--step` mode is driven by the **Windows watchdog** script, so the Python probe and the PowerShell watchdog are two halves of one contract.

### `evals/update_streaming/watchdog.ps1`
- **Purpose:** the native Windows **hand-off watchdog** — a child must be quiesced by a private job object, and the build output must not leak to the screen pipe.
- **Key abstractions:** `Invoke-HermesStep`; the script block extracted from `scripts/desktop-update/windows.ps1`.
- **Data flow:** the **maintained** production script is read, the handoff boundary is located by two marker strings, and that block is dot-sourced — the probe executes the real boundary, not a reimplementation.
- **Non-obvious design decisions:** the source is located with `IndexOf('$script:StepDrainGraceSeconds = 20')` and `IndexOf('$finalCode = 1')`; if the markers are not found the script throws "SETUP FAIL: handoff boundary not found" rather than testing a reimplementation. All the actual update/service/marker/Desktop phases are deliberately omitted.
- **Edge cases & failure handling:** the progress run must exit with the expected code and the silent run must exit **124** (the watchdog's timeout) — "silent child escaped watchdog" is the failure. Each row must report `tree_quiesced` and `job_assigned`.
- **Surprising:** the probe reuses the production file by *substring extraction* — a genuinely maintained boundary that cannot drift from the script it tests.

### `evals/update_unit_client_budget.py`
- **Purpose:** a real disposable **user-systemd** transaction — never a production gateway.
- **Key abstractions:** `_systemctl_reset_and_restart`; `scoped_systemctl`; `systemd-run --user --unit … --property=ExecStop=… --property=TimeoutStopSec=45`.
- **Data flow:** a transient unit is started with a 16 s (or 31 s) stop timeout, the restart is timed, and the unit's `MainPID` is polled until it changes.
- **Non-obvious design decisions:** the **client budget** is the point: the stop timeout must be longer than the child's own `ExecStop` sleep, or the client gives up before the child does. The `--catchup` mode scopes the unit discovery to the probe's own transient unit so the probe never enumerates the user's services.
- **Edge cases & failure handling:** a missing unit must **preserve the error** (`missing_unit_error_preserved`), and the cleanup must leave the unit inactive.
- **Surprising:** the discovery is replaced with a function that filters to the probe's own unit — an explicit boundary against a probe that touches the user's services.

### `evals/vault_fill_live_e2e.py`
- **Purpose:** a live E2E of **vault fill** through the real `browser_exec` path (Browser Use CLI + the packaged Chromium).
- **Key abstractions:** `browser_vault_fill`; `browser_vault_save_login`; `SUPERVISOR_REGISTRY`; `_redact_cdp_output`; `request_elicitation_consent`.
- **Data flow:** `browser_exec` opens three tabs (the login page is deliberately **not** the first); the supervisor must attach; a saved login is filled; a payment card is filled after a consent gate.
- **Non-obvious design decisions:** the secret must be **absent from every model-facing result** but present in the tab (the raw supervisor read proves the write landed). The payment path is exercised **twice**: declined (the fields must stay empty) and accepted (three fields, the country select untouched without a value). The save-on-page case starts from a blank default page so the tool must find the login tab itself.
- **Edge cases & failure handling:** `about:blank` pages are never candidates (`focus_page` must return False); the vault redaction values are cleared at the end.
- **Surprising:** the docstring names the exact problem it proves fixed — "on the default browser backend the login page lives in a tab browser_exec opened, the supervisor is attached by browser_exec itself".

### `evals/webhook_auth/standard_webhooks_ab.py`
- **Purpose:** the **Standard Webhooks** signature scheme (`webhook-id`/`-timestamp`/`-signature`) against the real webhook adapter.
- **Key abstractions:** `_sign(secret, msg_id, ts, body)`; `_std_headers`; the real `WebhookAdapter`.
- **Data flow:** thirteen cases are POSTed at a real adapter bound to loopback: the positive path, a raw-secret route, a wrong secret, a tampered body, a stale timestamp, partial headers, the wrong scheme prefix, a replayed id, the legacy `svix-*` headers, the GitLab `X-Gitlab-Token` path, and a dual-token case.
- **Non-obvious design decisions:** the signing key is **base64-decoded** when the secret has the `whsec_` prefix, and the HMAC covers `{id}.{timestamp}.{body}` — the spec. The regressions that must not move are explicit: `svix-*` and GitLab's `X-Gitlab-Token` must keep working, and a GitLab install that sends `webhook-id`/`-timestamp` on every delivery but signs only with a token must still authenticate.
- **Edge cases & failure handling:** a replayed id returns **200** (deduplicated) rather than 401 — a different status for a different failure. The `mismatches` list is printed at the end.
- **Surprising:** the dual-token case has `expect=None` — the probe records what happens rather than asserting, because the desired behaviour is the open question.

### Tier 2 — bulk: a compact table, one row per file

Docs, configuration, package markers and test harnesses. Every file in the shard appears in
**exactly one** listing below: 179 Tier-1 entries, 44 Tier-2 rows and 13 Tier-3 rows.

| File | What it is / what it pins |
| --- | --- |
| `evals/codebase_navigability/__init__.py` | Empty package marker; makes the navigability probes importable from a checkout. |
| `evals/postmortem/__init__.py` | Empty package marker for the post-mortem suite. |
| `evals/postmortem/forensics/__init__.py` | Empty package marker; the forensics lanes import `from evals.postmortem.forensics.common import Run`. |
| `evals/postmortem/live_ab/__init__.py` | Empty package marker for the live A/B lanes. |
| `evals/postmortem/review_probes/__init__.py` | Empty package marker; the probes are also usable as `pytest -p` plugins. |
| `evals/postmortem/tests/__init__.py` | Empty package marker for the harness self-test. |
| `evals/postmortem/tests/test_postmortem_harness.py` | The harness's own self-test: builds a tiny `state.db` and asserts the four lanes produce the expected counts (1 delegate timeout, 1 malformed hardline block, 1 nudge within 180 s) and that `run.PROBES` lists every tracked PR. |
| `evals/botmode-dm-delivery/README.md` | The delivery probe's receipt book: verified results, the `SESSION_NOT_OWNED` refusal, the changed-HOME follow-up, the corrupt-record case, and the explicit non-claims (no native Windows parity, at-most-once queue, no general retry). |
| `evals/botmode-dm-matrix/README.md` | The matrix README: the stale-launcher simulation, the "the runtime is not the only writer" claim, and the named limits of the evidence. |
| `evals/browser_use/README.md` | The browser battery's method: arms differ only by tree + config, oracle-checked tasks, resume-safe JSONL, the backend matrix, and the scorecard tables (base 64 594 tok vs pr 25 934 tok, −60 %). |
| `evals/codebase_navigability/README.md` | The three questions the navigability suite asks (naive locate, skilled lookup, static shape) and — crucially — how to read the numbers honestly, including the cases where the metric barely moves. |
| `evals/codex_echo/README.md` | The input-ownership matrix (8 cases) and the reason the runtime must own the echo exactly once. |
| `evals/compaction/README.md` | The compaction eval's method: question bank from the summarised region, the `current+recovery` default arm, the Jev engine description, the policy list, and how to run it. |
| `evals/compaction/results/SCORECARD-2026-08-15.md` | The four-transcript scorecard: `lean+recovery` beats `current` by +22.5 pts at 3.3× fewer tokens, the anchor index fixed the needle-fact class, and the real Codex CLI (36.7 %) loses to Hermes lean+recovery (68.3 %) because Codex has no `session_search` equivalent. |
| `evals/compaction/results/SCORECARD-2026-09-19-jev.md` | The verdict on Jev: do not adopt it; summary + search on the shipped mechanism wins, and the repeated-compaction run exposes a monotonic text floor. |
| `evals/core_tool_deferral/README.md` | The deferral battery's method and its explicit limits (the toolset union is not the product, and a missing tool is scored zero in both arms). |
| `evals/core_tool_deferral/results/SUMMARY.md` | The recorded verdict and numbers for the deferral A/B, with the scoring rules. |
| `evals/delegation_group_schema/README.md` | The scope note: this probe measures **schema footprint**, not model quality or billed savings. |
| `evals/desktop-pane-fixture/README.md` | The claim the pane fixture may make: it does not mock pane functions, inspect source text in an assertion, lower a deadline, or alter the two test bodies. |
| `evals/desktop_bug_campaign/async-report-README.md` | The async-report probe's scope: producer/store integration plus live Chromium rendering — *not* scheduled execution, poller/HTTP/WebSocket E2E, Bot Chat routing, or native macOS QA. |
| `evals/desktop_bug_campaign/markdown-README.md` | The Markdown-only producer's scope and the commit sha where the combined fixture's history was moved. |
| `evals/desktop_bug_campaign/navigation-markdown-README.md` | The renderer probe's scope: production Markdown renderer only, no Hermes runtime. |
| `evals/desktop_bug_campaign/thread-scroll/README.md` | The scroll probe's method and the **drift history** (323 → 72 → 17 → 0 px), which is the most useful part of the file. |
| `evals/desktop_gateway_ticket_native/README.md` | The native ticket probe's runbook and its "Explicit limits" list (no Windows named pipes, no macOS socket permission coverage, no real second-account SID) plus the "never merge this temporary workflow" rule. |
| `evals/desktop_mcp_oauth/README.md` | The OAuth/MCP probe's runbook: the five negative controls, the `--cold-probe` fresh-process proof, and the note that the token files are verified and then deleted with the temp HOME. |
| `evals/gateway_completion/README.md` | The completion-delivery lifecycle's method and the durable evidence line ("base exhausted eight attempts and dropped; fixed stayed pending/zero then delivered both batch siblings at one attempt"). |
| `evals/gateway_failure_ownership/README.md` | The exception-path input-arbitration scope statement and the durable-owner-marker contract. |
| `evals/postmortem/README.md` | The post-mortem methodology: five forensic lanes, live A/B lanes, review probes, what is *not* in the bundle (no trajectories, the secret gist), and the provenance (five parallel subagents, 2026-09-04). |
| `evals/prefix_rediet/README.md` | The re-diet battery's task table (7 tasks) and the rule that errored cells score 0 while infra aborts (exit 3) are never written. |
| `evals/readtool/README.md` | The read-tool eval's method, the hostile-file table, the metric list, and the discipline rules (3 reps minimum, ±3 % is noise, two models on purpose, never edit `tools/` mid-run). |
| `evals/readtool/results/SUMMARY.md` | The recorded verdict + numbers for each read-tool feature evaluated, with the `results/` layout. |
| `evals/reasoning_replay/README.md` | The reasoning-consumption method: the five wire variants, the two positions, the prompt-token delta as the primary signal, the lane taxonomy, and the `alt` probe wording for providers that refuse the question. |
| `evals/session_search_schema/README.md` | The `session_search` schema A/B's method, the oracle-only scoring (no LLM judge), and the reference numbers (49/54 → 52/54; 7.0K → 5.3K tokens per task). |
| `evals/shared_gateway/README.md` | The shared-gateway acceptance method: the receipt format, the coverage checker, and the rule that a failure must be retained rather than the assertion weakened. |
| `evals/tool_search/README.md` | The tool-search benchmark's method: the bridge vs eager vs listing modes, the success criteria, and the "expected_core_tool_direct" requirement. |
| `evals/toolperf_abeval/README.md` | The NeMo Relay ATOF harness's method: trace-scored, error-inducing trap tasks, mechanical success checks, and the "infra crash is not recorded" rule. |
| `evals/browser_use/results/.gitignore` | One line: ignores the generated result JSONL. |
| `evals/core_tool_deferral/results/.gitignore` | One line: ignores the generated per-cell JSON and transcripts. |
| `evals/readtool/results/.gitignore` | One line: ignores everything under `results/` except the committed `SUMMARY.md`. |
| `evals/desktop_gateway_ticket_native/.gitignore` | Three lines: ignores `.electron-local/`, `.results*/` and `__pycache__/`. |
| `evals/hosted_attachment_transfer/.gitignore` | One line: ignores `/last_run.json`. |
| `evals/desktop_bug_campaign/async-report-probe.html` | The tiny HTML host for the async-report probe (the Vite middleware rewrites `FIXTURE_ENTRY` to the TSX entry). |
| `evals/desktop_bug_campaign/navigation-markdown-probe.html` | The tiny HTML host for the Markdown renderer probe. |
| `evals/desktop_bug_campaign/thread-scroll/fixture.html` | The tiny HTML host for the scroll fixture. |

### Tier 3 — skipped with a reason

All thirteen are **generated result artefacts** committed alongside the harnesses that produced them
(per-session scorecard JSON, per-run cycle JSON, and per-cell result JSONL). Each was opened and
its head read to confirm the shape; none was read line by line, because the *content* is a
regression-free dump of numbers the harness already reports elsewhere, and the analytic content is
in the accompanying scorecard `.md` files (read in full, above).

| File | Why not read line by line |
| --- | --- |
| `evals/compaction/results/codex-arm-2026-08-15/acp.json` | Generated scorecard for the real-Codex arm (recall 36.7 %, 1 compaction event, peak ctx 454 931, a 15-element score vector, an absolute rollout path). Head peeked; the analysis is in `SCORECARD-2026-08-15.md`. |
| `evals/compaction/results/codex-arm-2026-08-15/gui.json` | Same shape (recall 40.0 %, peak ctx 482 525). Head peeked. |
| `evals/compaction/results/codex-arm-2026-08-15/prmerge.json` | Same shape (recall 43.3 %, peak ctx 465 131). Head peeked. |
| `evals/compaction/results/codex-arm-2026-08-15/sweep.json` | Same shape (recall 26.7 %, peak ctx 482 248). Head peeked. |
| `evals/compaction/results/jev-cycles-2026-09-19/cycles-afff57-500k.json` | Generated cycle log; head peeked — cycle 1 ends in the `history too large for Jev` fallback, floor 22 650, 542 candidate calls. |
| `evals/compaction/results/jev-cycles-2026-09-19/cycles-prreview-160k.json` | Generated cycle log; head peeked — cycle 1 freed 87.3 % at 0.0011 USD. |
| `evals/compaction/results/jev-cycles-2026-09-19/cycles-prreview-500k.json` | Generated cycle log; head peeked. |
| `evals/compaction/results/jev-cycles-2026-09-19/cycles-sigsegv-160k.json` | Generated cycle log; head peeked. |
| `evals/compaction/results/jev-cycles-2026-09-19/cycles-sigsegv-500k.json` | Generated cycle log; head peeked. |
| `evals/compaction/results/jev-cycles-2026-09-19/cycles-sysprompt-500k.json` | Generated cycle log; head peeked. |
| `evals/session_search_schema/results/pr95570/openai_gpt-5.6-luna.jsonl` | Generated 36-line result JSONL (one row per task/arm/rep with the tool calls and the final answer). First rows peeked; the analysis is in `session_search_schema/README.md`. |
| `evals/session_search_schema/results/pr95570/openai_gpt-5.6-terra.jsonl` | Same shape; first rows peeked. |
| `evals/session_search_schema/results/pr95570/qwen_qwen3-coder-30b-a3b-instruct.jsonl` | Same shape; first rows peeked. |

---

## 2. Ideas worth stealing

1. **A/B a *renderer* by pinning the baseline module and diffing the DOM.** Extract the "before"
   implementation with `git show <sha>:<path>`, alias it in the dev server, mount the *production*
   component against both, and compare the rendered output — headings, tables, text, clipboard.
   `evals/desktop_bug_campaign/async-report-vite.mjs:20` and
   `evals/desktop_bug_campaign/navigation-markdown-live.mjs:20`. **Why it transfers:** August's
   `render-probe` counts rows but cannot say *how* a row looks; a DOM diff against a pinned
   baseline turns "the panel renders" into "the panel renders **differently from commit X**".
   `UNIQUE` in this shard.
2. **Generate the exam from the region the *current* policy would summarise**, so every arm answers
   the identical questions. `evals/compaction/runner.py:186`. **Why it transfers:** the same trick
   applies to August's `accuracyValidation` and `outcomeEngine` — build the question set from what
   the *worst* arm would drop, and every arm answers the same paper. `UNIQUE`.
3. **A recall eval whose default arm is "summary + one search round-trip", with closed-book
   measured separately as a floor.** `evals/compaction/runner.py:120` (the `current+recovery`
   default) and the FTS5+BM25 simulation of the real `session_search` at
   `evals/compaction/runner.py:150`. **Why it transfers:** August's context compaction has exactly
   this shape; the sim uses the *production* engine so the retrieval quality is not a toy.
   `CONVERGENT` — the same "search the archive" idea appears in `evals/session_search_schema` and
   in the `postmortem` lanes.
4. **Judge rubric that scores calibrated abstention above confident wrongness** — "NOT IN CONTEXT;
   guess X" where X is right scores **1**, a wrong guess scores **0**.
   `evals/compaction/runner.py:95` (the `JUDGE_PROMPT`). **Why it transfers:** directly to
   August's post-trade analysis: a model that says "the outcome was not recorded" should score
   better than one that invents a number. `UNIQUE`.
5. **Model the search *inside* the eval** instead of stubbing it: an in-memory SQLite **FTS5 +
   BM25** index with `snippet()`, degrading to term-frequency if FTS5 is missing.
   `evals/compaction/runner.py:141` (`keyword_search`). **Why it transfers:** August can evaluate
   its own notebook recall against the same engine the product uses, with no service running.
   `UNIQUE`.
6. **Reconstruct the uncompacted lineage by de-duplicating rotation-copied rows by content hash**
   (`md5(role + content + tool_calls)`) and stripping the synthetic compaction markers.
   `evals/compaction/scripts/reconstruct_lineage.py:60`. **Why it transfers:** August's chat
   persistence with compaction/rollover has the same shape; without this, every rotation
   multiplies the transcript and every cost estimate is wrong. `UNIQUE`.
7. **Prove the *arm* actually reached the condition it measures, and say so when it did not.**
   `evals/compaction/scripts/codex_arm.py` counts `compacted` events in the rollout and prints
   *"WARNING: compaction never fired — arm invalid"*. **Why it transfers:** an eval that silently
   measured the wrong condition is worse than no eval. `UNIQUE`.
8. **A strict scoring rule that punishes a wrong tool call even if the run recovers.**
   `success = final_correct AND wrong_calls == 0` in
   `evals/tool_search/tool_search_livetest_ue_hard.py:14`. **Why it transfers:** August's
   `deskToolCatalogue` and tool-selection work needs the same "clean solve" definition; a
   recovering run must not be scored as a pass. `UNIQUE`.
9. **Defer the tool surface and measure the *listing* budget, not the tool count** — the UE battery
   runs 830 real schemas in three modes (`eager` ~165 K tokens, `bridge`, `listing` with a 30 K
   budget) and an adversarial variant where near-identical tool names in different toolsets are
   the subject. `evals/tool_search/tool_search_livetest_ue.py:6` and
   `evals/tool_search/tool_search_livetest_ue_hard.py:6`. **Why it transfers:** August has 100+
   tools; the "capability listing" pattern is the direct analogue of Hermes's `tool_search` bridge
   and would fit August's `desk` toolsets. `UNIQUE`.
10. **Measure whether the model can *refuse* a capability that does not exist** — the "A" family
    scores a refusal with **no** write call, and the honesty scenarios require the answer to
    contain `CANNOT`. `evals/tool_search/tool_search_livetest_ue_disc.py:100` and
    `evals/tool_search/tool_search_livetest.py` (scenario E). **Why it transfers:** the direct
    analogue for August is a model that must refuse to invent a price level or a backtest result
    it does not have. `UNIQUE`.
11. **Reprocess scheduling pressure without changing the clock's answers** — a `Date.now` wrapper
    that parks the *calling thread* for 5 ms, but only when the stack shows the module under test.
    `evals/desktop-reap-clock-pressure.cjs:8`. **Why it transfers:** August has deadline-based
    reapers (automation settlement, session leases); this is the cheapest way to reproduce a
    "the timer fired before the record landed" race in CI. `UNIQUE`.
12. **Hard network boundaries in three escalating forms** — a `socket.connect` monkeypatch
    (`evals/provider_fallback/probe_104120.py:31`), a `sys.addaudithook` that also catches DNS
    (`evals/provider_wire/issue_103944.py:88`), and a `httpx` client swap that raises
    `AssertionError('NONLOCAL_NETWORK')` (`evals/auth_pool_controls.py:120`). **Why it transfers:**
    any August eval that must prove "this code path made no network call" should use the audit
    hook, not the monkeypatch. `CONVERGENT` — used across the whole shard.
13. **Assert the receipt, not the behaviour** — the credential-pool probe ends with a block of
    invariants written as a *specification* in prose
    (`evals/auth_pool_controls.py:180`). **Why it transfers:** August's trade-log and
    `outcomeEngine` probes could use the same "the receipt IS the contract" style, which makes a
    regression legible from the artefact alone. `UNIQUE`.
14. **Do the A/B by *extracting the module from two git refs***, not by checking out two trees —
    `git show <ref>:tools/session_search_tool.py` imported as two side-by-side modules, with the
    *only* variable being that one file. `evals/session_search_schema/runner.py:64`
    (`extract_arm`). **Why it transfers:** August can A/B a single service file (a validator, the
    outcome engine, the gate scorer) without a second checkout, in seconds. `UNIQUE`.
15. **A sandbox that uses the product's *own* isolation contract** rather than a bespoke one —
    `TERMINAL_HOME_MODE=profile` plus a file-backed `crontab` shim, with the scar recorded in the
    docstring. `evals/core_tool_deferral/sandbox.py:10`. **Why it transfers:** August's
    `automation` surface can run background work; the same "use the product's own home-pinning"
    trick keeps an eval from touching the trader's real machine. `UNIQUE`.
16. **Write the "what this does NOT prove" section into the artefact itself**, not just the PR.
    `evals/desktop_gateway_ticket_native/README.md` ("Explicit limits"), the compaction README's
    caveats, and `evals/compaction/results/SCORECARD-2026-08-15.md`'s "Known caveats". **Why it
    transfers:** a research report that is read months later needs the caveat attached to the
    number. `CONVERGENT` — nearly every README here ends with a limits paragraph.
17. **Score *cost* on the same yardstick for every arm** — every provider's summary call is priced
    at OpenRouter's list price for that model id, so arms routed through different providers remain
    comparable. `evals/compaction/runner.py` (`openrouter_price_usd`). **Why it transfers:**
    August compares Claude/Gemini/Qwen arms constantly; a single price table is the only way the
    numbers mean anything. `UNIQUE`.
18. **Force the *user's* model to prove it can find a tool, with the tool surface *deferred* —
    a 3.4 KB pinned "helpers digest" costs nothing and saves a little, while a full 11 KB live
    skill dump adds nothing.** `evals/browser_use/README.md` (the digest ablation). **Why it
    transfers:** August's `constants/prompts` and the `desk mandate` are exactly this budget, and
    Hermes measured the two ends of it. `UNIQUE`.

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work.** This shard is mostly about *how the scheduler's own
  behaviour is pinned*, not about the business logic, but the mechanics transfer directly:
  a failed cron run persists a **full traceback** to the job output while the caller gets a
  *concise* message, and a **fire failure is not a delivery failure** (`last_fire_error` and
  `last_delivery_error` are separate fields) — `evals/cron_error_diagnostics.py:60`. A cron script
  that forks must be cleaned up **only for the processes it owns**, and the probe makes itself a
  child subreaper so a detached grandchild cannot escape the check
  (`evals/cron_timeout_fork_race.py:40`). A delivery obligation is **at-most-once after claim**,
  and a crash between claim and spawn stays inspectable rather than being retried
  (`evals/botmode-dm-delivery/README.md`). A "no-op" schedule that produced nothing three times
  running is the same idea August's automation breaker already has — the breaker's *symptom* here
  is "exhausted eight attempts and dropped" (`evals/gateway_completion/README.md`).
- **Human-in-the-loop approval.** Two mechanisms appear. The **hardline scanner** has both true and
  false positives as first-class cases: a `reboot` hidden after a newline inside `"$(grep …)"` must
  stay blocked with **zero approval callbacks**, while a legitimate
  `sed -n "$(grep -n X f | cut -d: -f1),+3p" f` and a `grep -F 'sudo reboot' notes.md` must stay
  **allowed** (`evals/postmortem/review_probes/scanner_bypass_probe.py:30`,
  `evals/postmortem/live_ab/hardline_scanner_matrix.py:10`). The probe proves *reachability*
  safely: a shell function shadows the dangerous name so the witness is a marker file, not a
  shutdown. Second, a **pre-tool hook** can veto a tool per profile; the receipt proves the hook
  ran **exactly once** for each consented profile and **zero** times for the unapproved one
  (`evals/desktop_bug_campaign/hooks_live.py:120`). The audit trail that survives a decision is
  the durable SQLite row plus the receipt (sha + blob hash of the exact file that ran).
- **Post-mortem / reflection loops.** The most transferable idea here is that a post-mortem is a
  **query over a run tree**, not a prose summary. `evals/postmortem/forensics/common.py:60` builds
  the tree from a **copy** of `state.db` (read-only, `mode=ro`), excludes compression-rollover
  children so the cost populations stay disjoint, and **fits the price per token by least squares**
  from the usage columns to the recorded `estimated_cost_usd`, so the recomputed dollars match
  *that* Hermes's own estimator rather than an invoice. The lanes then answer questions a prose
  summary would miss: where the money went, how many delegate timeouts and what the session spent
  after the first one, which tool calls were blocked and why, and how long the goal loop sat
  parked. What stops bad rules accumulating is *not* addressed by this shard — the reflection loop
  itself lives in another shard — but the input format is: a JSONL of structured, queryable rows.
- **Multi-agent.** This shard is evidence *against* the value of extra agents, and the evidence is
  strong. The compaction scorecard shows that the mechanism that beat a frontier competitor was
  **one summary plus one search round-trip**, not more agents
  (`evals/compaction/results/SCORECARD-2026-08-15.md`). The delegation lane shows what fan-out
  actually costs: a parent's batch join withholds child-hours that are *not* critical path, and
  242.6 hours were spent **sleeping** after a first delegate timeout
  (`evals/postmortem/forensics/delegation.py:60`). The subagent accounting probe's verdict is
  that the child's background processes must be **handed off, read, or terminated** — never left
  orphaned — and it explicitly refuses a model that claims authority to steal a sibling's process
  (`evals/subagent_process_handoff/stress_handoff_live.py:30`).
- **Structured logs the model can query.** No heavy database. **SQLite** (`state.db`) is the
  system of record, and queryability is added with **FTS5 + BM25** — the same engine production
  `session_search` uses, simulated inside the eval
  (`evals/compaction/runner.py:141`). The query layer is deliberately **scoped**: the `session_search`
  A/B shows the *schema* (description + parameter diet) alone moved 49/54 → 52/54 and 7.0K → 5.3K
  tokens per task, with **no LLM judge** — pure-function oracles
  (`evals/session_search_schema/README.md`). A read-only client must not write to the store it
  observes, and the probe proves it with `PRAGMA data_version` and a file sha256 comparison
  (`evals/shared_gateway/search_readonly_ab.py:20`).
- **Staying simple as features accumulate.** The house answer is *defer, then measure*. Five eager
  `browser_vault_*` tools became one deferred `browser_vault`, and the A/B proved the deferred
  version was **found** in every case (`evals/prefix_rediet/README.md`). The 830-tool UE battery
  then measured the same deferral at scale against a real catalog, and the adversarial variant
  found the actual failure mode: **confusion clusters**, not absence
  (`evals/tool_search/tool_search_livetest_ue_hard.py:6`). The repo also *removes* capability when
  it is not earning its tokens: the output-cap removal deleted `max_tokens` from every production
  surface while **preserving** the native Anthropic field, Converse's optional
  `inferenceConfig.maxTokens` and MCP's `SamplingHandler.max_tokens_cap`
  (`evals/output_caps_scope.md`), and the reasoning-replay harness concluded that a pinned 3.4 KB
  digest "costs nothing and saves a little, while the full 11 KB live skill dump adds nothing"
  (`evals/browser_use/README.md`).
- **Not in this shard:** the actual trade-log schema, the entry/TP/SL detection logic, the
  performance-feedback learning loop and the skill/rule lifecycle live in other hermes-agent
  shards (`hermes-state-*`, `hermes-skills-*`) and are not answered here.

## 4. Non-obvious decisions and gotchas

- **A `200 OK` is not consumption.** The reasoning-replay harness exists because a provider can
  accept a `reasoning` field and silently discard it; the only trustworthy signal is the
  **prompt-token delta** against a byte-identical request, plus a canary the model must recall
  (`evals/reasoning_replay/README.md`). The same trap appears for *cache* prefixes: a cache hit
  can be lost to **client-side prefix mutation** (Hermes stripping prior-turn thinking), so the
  probe records a sha of the system prompt, tools and every message, and classifies a consecutive
  pair as `ideal` / `stuck` / `collapse` only after **excluding** pairs whose system sha changed
  (`evals/postmortem/live_ab/cache_concurrency_probe.py:10`).
- **Two "stuck" definitions that were being conflated.** The log lane reports `strict_plateau`
  (the cache read equals the previous call's *exactly*) and `non_advancing_hit` (the read did not
  grow while the input did) **separately**, and prints the coverage fraction before either
  (`evals/postmortem/forensics/logcalls.py:40`).
- **The direction of a monotonic ratchet.** The repeated-compaction simulator found that a
  keep/drop policy never removes user/assistant **text**, so every cycle frees only
  `threshold − text_floor` and the floor *grows*; the run then stops with `STUCK`
  (`evals/compaction/scripts/jev_cycles_report.py:30`,
  `evals/compaction/results/SCORECARD-2026-09-19-jev.md`).
- **"Recovery" is a real arm, not a footnote.** A closed-book policy scores 30+ points lower on
  needle questions; that number is a *floor* the design is measured against, not a result to
  publish (`evals/compaction/runner.py:120`).
- **A grep-like agent is not a `grep` command.** The baseline in the code-navigability suite
  assumes `grep -n` → read a 200-line window → page forward; and the *same* metric barely moves
  when a file is split, while **stripping comments makes a fixed window more expensive in tokens**
  (`evals/codebase_navigability/README.md`). The naive-locate metric and the skilled-lookup metric
  answer different questions and disagree.
- **The compaction trigger is fed by the provider, not by the transcript.** The `replay_gates`
  probe deliberately makes the provider's reported usage **disagree** with the local `bytes/4`
  estimate in *both* directions, because the CLI and the gateway have different **object
  identities** for the history — the gateway JSON-round-trips it every turn, so the usage anchor
  keyed on `id` goes stale and the rough estimator decides
  (`evals/token_accounting/replay_gates.py:20`).
- **A failed update must leave the user's uncommitted work alone.** The interrupted-pull A/B
  creates a genuinely torn tree with a **fake `git`** that stalls at a chosen flag, and places the
  user's edit on a file git *never wrote* — the case the repair must handle
  (`evals/update_pipeline/interrupted_pull_ab.sh:1`).
- **The Windows watchdog probe reuses the production script by substring extraction** and throws
  "SETUP FAIL: handoff boundary not found" rather than testing a reimplementation
  (`evals/update_streaming/watchdog.ps1:30`).
- **Escaping is the test.** A probe that would contain a dangerous command in its own source
  assembles the name at runtime and shadows it with a shell function
  (`evals/postmortem/review_probes/scanner_bypass_probe.py:36`).
- **A `git` wrapper, not a `git` mock.** The update probes put a wrapper on `PATH` that adds `-F`
  and execs the **real** `/usr/bin/ssh`, and a fake `git` that writes real files and takes a real
  `index.lock` (`evals/update_check_ssh_pty.py:60`,
  `evals/update_pipeline/interrupted_pull_ab.sh:1`).
- **The probe must be safe to run on the operator's machine.** The cron sandbox exists because a
  past run left three nightly cron jobs on the author's machine
  (`evals/core_tool_deferral/sandbox.py:10`); the systemd probe scopes its discovery to its own
  transient unit (`evals/update_unit_client_budget.py:40`).

## 5. Weak spots

- **The shard is a pile of one-file probes, not a framework.** There is no shared runner, no
  common receipt schema, and no way to run "all evals" — `evals/postmortem/run.py` is the only
  place that does this, and it exists for one directory. Every probe re-implements its own
  temp-home, env-scrub, network-block and JSON-writing boilerplate, so the boilerplate is
  inconsistent (some use `sys.addaudithook`, some only monkeypatch `socket.connect`; some use
  `pytest`, some are `python file.py`).
- **A large share of the "evidence" is a single run.** The compaction scorecard's own caveats
  admit that `sweep`/`gui` rows predate a question-bank regeneration, that 15 questions per
  transcript means ±3.3 pts of noise, and that the `prmerge` recovery misses are "mostly query
  formulation" (`evals/compaction/results/SCORECARD-2026-08-15.md`). The read-tool README applies
  the same discipline from the other side — "single-run deltas within ±3 % are noise, not wins" —
  but many of the other batteries do not state a rep count at all.
- **Live cost and flakiness.** A number of these probes need a paid model
  (`evals/postmortem/live_ab/*`, `evals/prefix_rediet/`, `evals/tool_search/*`,
  `evals/readtool/`), so the results are not reproducible for a reader without credentials, and
  some of them are explicitly timing-sensitive (`evals/postmortem/live_ab/batch_failure_notice.py`
  measures the *order* of three events over 8-second sleeps).
- **A few probes are pinned to one provider's quirks**, which makes them age badly:
  `evals/reasoning_replay/harness.py` has a hard-coded list of routes and a `PROBE_ALT` wording
  that exists only because xAI 403s and Anthropic content-filters the question.
- **The "honesty" machinery is uneven.** Some probes state their non-claims precisely
  (`evals/desktop_gateway_ticket_native/README.md`, `evals/postmortem/README.md`), while others
  quietly report a green check for a condition they did not exercise — the native ticket receipt
  still carries `wrongOsOwnerSid: { status: 'not_exercised' }` inside an otherwise passing run.
- **The whole shard is *offline by construction***, and several probes say so only in a
  parenthetical. A "loopback fixture proves the contract" result is strictly weaker than a
  provider-boundary result, and the boundary is not always marked.
- **`evals/postmortem/forensics/rework.py` openly cannot reproduce its own headline claim** — the
  root-cause classes were hand-labelled — so the most quotable number in the post-mortem is
  partially manual, and the script says so in its output.
