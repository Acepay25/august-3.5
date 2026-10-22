# hermes-agent :: hermes-tools

**Files in shard:** 371 (read: 368, skipped with reason: 3)
**What this shard covers:** the entire `tools/` package of `hermes-agent` — the Python
implementation of every capability the model can invoke. It is the reference harness's
"tool layer" in the strict sense: a self-registering tool registry, a progressive-disclosure
tool search, a multi-surface human-approval gate, a file/terminal execution stack, an MCP
client, a delegation (subagent) runtime, a cron scheduler, a skills store with its own
lifecycle, a memory store, and a large set of "operator surface" tools (browser, voice,
desktop GUI, messaging). Nothing here is a test, and almost nothing here is a doc: 364 of
371 files are `source`, 3 are `docs`, 3 are binary `assets`, 1 is a shell launcher.

**Read depth (stated up front, because the shard is 7.1 MB):** every one of the 371 files
was opened and read. For 7 files — `tools/todo_tool.py`, `tools/thread_context.py`,
`tools/tool_output_limits.py`, `tools/spill_safety.py`, `tools/human_input_hooks.py`,
`tools/working_diff.py`, `tools/tool_labels.py` — I read the complete source text
line by line. For the remaining 364 source files I read a *complete structural digest*:
the module docstring in full, the import header, **every** `def`/`class` in the file with
its full signature and its full docstring, and every top-level constant with its value.
That is the design record of a Python module — the module docstring states the contract,
the docstrings state the reason — but it is not literally every line of every function
body, and I do not claim it is. The per-file ledger in
`hermes-tools.status.tsv` records the depth for every file. The three binary assets
were confirmed on disk and not read.

---

## 1. File-by-file

### 1.1 The set in one picture

371 files, nine coherent clusters. The set-level shape matters more than any single file:

| Cluster | Files | What the cluster is |
| --- | --- | --- |
| Approval / human gate | 8 | One consequential-action gate, split across seven modules, with a denial breaker, a YOLO bypass contract, an LLM "smart" reviewer, and a wait-accounting clock. |
| Delegation (subagents) | 13 | A parent→child agent runtime: depth, concurrency, worktree isolation, live progress, redaction, structured results, per-child cleanup. |
| Scheduling | 3 | Cron jobs: claim-once execution, stale-claim reaping, event-driven firing, run history. |
| Tool registry / discovery | 12 | A registry every module registers into, plus a **progressive-disclosure** bridge (`tool_search` / `tool_describe` / `tool_call`). |
| File & terminal execution | 30 | Read/write/search/terminal with write guards, read-dedup, a device-path blocklist, and a per-task environment. |
| MCP client | 21 | The Model Context Protocol client: transports, OAuth, lifecycle, discovery, errors, health, costs. |
| Skills | 24 | A skill store with a real lifecycle (active → stale → archived), a usage ledger, a linter, a guard, a hub, and sync. |
| Media / voice / vision | 26 | Image, video, audio, TTS, STT, wake word, vision analysis. |
| Operator surface | rest | Browser automation, desktop GUI control, messaging/Discord/Telegram/Feishu/Yuanbao, computer use, bot desktop, containers. |

### 1.2 Tier 1 — load-bearing source: full entries

#### `tools/registry.py`
- **Purpose:** the one registry every tool module registers into; imported by every other
  tool file (`tools/AGENTS.md:9-14`).
- **Key abstractions:** `registry.register(name, toolset, schema, check_fn, handler, emoji)`,
  `registry.get_emoji`, `tool_error` (the shared error-envelope builder).
- **Data flow:** `registry.register()` is called at *import time* in each `tools/*.py`.
  `model_tools.py` imports the registry and triggers `discover_builtin_tools()`, and every
  consumer (`run_agent.py`, `cli.py`, `batch_runner.py`, `environments/`) reads from it.
  A tool that is a whole package registers from `tools/<pkg>/tool.py` — the only file
  discovery scans inside a package (`tools/AGENTS.md:12-14`).
- **Non-obvious design decisions:** **import side effects are the discovery mechanism.**
  There is no manifest, no plugin table, no hand-maintained import list; a new tool file
  is live the moment it exists, and a file that is *not* imported is invisible. The cost
  is that anything that imports the registry pays for the whole tree, which is why
  `tools/__init__.py:1-3` is explicitly side-effect free: *"importing `tools` must not
  load the tool stack (some subsystems import it while `hermes_cli.config` is still
  initializing)"*.
- **Edge cases & failure handling:** `check_fn` gates availability so a tool whose
  credential is missing simply does not appear, rather than appearing and failing
  (`tools/AGENTS.md:33` shows the canonical `check_requirements` shape).
- **Surprising:** the repo has an explicit **"Footprint Ladder"** policy
  (`tools/AGENTS.md:3`): *"Most capabilities should NOT be core tools."* The registry is
  designed to hold many small tools, and the *core set* is the scarce resource.

#### `tools/tool_search.py` + `tools/tool_search_catalog.py` + `tools/tool_search_validation.py`
- **Purpose:** the progressive-disclosure bridge that lets the model reach a tool that is
  not in its prompt.
- **Key abstractions:** `dispatch_tool_search` (`tools/tool_search.py:438`),
  `dispatch_tool_describe` (`:495`), `scoped_deferrable_names` (`:544`),
  `out_of_scope_reason` (`:553`), `scope_block_reason` (`:568`),
  `resolve_underlying_call` (`:578`), `_record_search_metric` (`:484`).
- **Data flow:** the model calls `tool_search` with free-text queries; the catalog
  tokenizes and scores; a hit returns a *name*, not a schema; `tool_describe` returns the
  schema for one name; only then can `tool_call` invoke it. A tool that is *deferred* is
  reachable only through this bridge, and only if it is in the session's scope.
- **Non-obvious design decisions:** **deferral is a property of the session, not of the
  tool** (`scoped_deferrable_names` reads the *pre-assembly* `tool_defs` of the session
  scope). A tool that is deferred but out of scope produces a distinct
  `scope_block_reason` from `not_deferrable_error` — the codebase treats "you may not have
  this" and "this does not exist" as different failures because they need different
  model behaviour.
- **Edge cases & failure handling:** `tool_search` records a *metric* on every call
  (`_record_search_metric`) so the harness can measure whether disclosure is working;
  `tool_search_validation.normalize_tool_call_entries` normalises the two accepted call
  shapes (advertised batch shape and single call) and rejects a batch that names a local
  tool with a message that restates the valid shape using the *caller's own* names.
- **Surprising:** `tools/todo_tool.py:150-176` shows the bridge is a *first-class
  transcript citizen*: the todo tool's detection must peel the `tool_call` bridge name
  out of the recorded arguments before deciding whether a transcript entry was a todo
  call. Two spellings of one call, handled explicitly.

#### `tools/approval.py` (+ `approval_context`, `approval_detection`, `approval_floors`, `approval_gateway_wait`, `approval_human_wait`, `approval_prompt`, `approval_smart`, `approval_yolo`)
- **Purpose:** the single gate every consequential action passes through.
- **Key abstractions:** `check_all_command_guards`, `check_execute_code_guard`,
  `request_tool_approval` / `_run_approval_gate` (`tools/approval.py:1-12`),
  `submit_pending` (`:247`), `approve_session` (`:253`), `resolve_gateway_approval` (`:142`),
  `withdraw_gateway_approval` (`:179`), `register_gateway_settle` (`:202`).
- **Data flow:** a tool call that trips a guard is matched against the session's
  hardline/dangerous patterns (`approval_detection`), blocked pre-gate by
  `approval_floors`, then *parked*: the entry goes into the session's pending queue, the
  gateway is notified (`register_gateway_notify`, `:126`), and the calling thread blocks
  on an event until a human answers. The answer is `approve`/`deny`/`approve_always`.
- **Non-obvious design decisions — the denial breaker.** `_record_denial` (`:80`)
  counts *consecutive* guardian denials; `_get_denial_breaker_threshold` (`:72`) reads
  `approvals.denial_breaker_threshold` (default 3, 0 disables); `_reset_denials` (`:91`)
  clears the tally the moment anything is approved; `_denial_breaker_addendum` (`:97`)
  appends escalated hard-stop text to the prompt once it trips. **A model that keeps
  getting denied escalates its own prompt.** This is a *model-behaviour* circuit-breaker,
  not a rate limiter, and it is unusual.
- **Non-obvious design decisions — first-settlement wins.** The gateway wait treats a
  choice that lands in the gap between the deadline check and leaving the queue as an
  *answer*, not a timeout (`tools/approval_gateway_wait.py`, the `resolved = state != "timeout" or choice is not None`
  rule). And coalesced followers on one prompt wake with the *leader's* outcome rather
  than each timing out separately on a prompt that no longer exists.
- **Non-obvious design decisions — human wait is measured at the source.**
  `tools/approval_human_wait.py:1-16` explains why: the concurrent tool batch deadline
  excludes human-wait time, but measuring it *in the authorization gate* (residency) would
  let a wedged plugin or a dead approval client grow the exclusion 1:1 with wall clock and
  defeat the deadline entirely. Measuring at the source means only *verifiably blocked on
  a human* time is excluded. `human_wait_ceiling()` (`:45`) = `approvals.timeout + 60s`,
  and the same constant bounds the authorization gate's lock acquire so the two cannot
  drift.
- **Non-obvious design decisions — the YOLO contract.** `tools/approval_yolo.py:1-9` is a
  contract for one toggle across four surfaces (CLI `/yolo`, TUI Shift+Tab, Desktop zap,
  Telegram `/yolo`). The bypass itself is in-memory per key; each surface persists it
  where its session identity lives; the surface hands its writer in as `persist(enabled)`
  and *everything else is decided here*. `transfer_session_yolo` (`:93`) moves the live
  bypass when a conversation continues under a new id (compression rotation, `/branch`) —
  a detail that is easy to miss and breaks the feature if omitted.
- **Edge cases & failure handling:** `withdraw_gateway_approval` (`:179`) removes a
  pending approval *nobody can answer* (the only attached client cannot render it) and
  wakes the waiter. `register_gateway_settle` (`:202`) attaches a `settle(reason)` hook
  that runs exactly once when the wait ends by any path. `human_input_hooks` (§ below)
  fires `on_human_input_request` / `on_human_input_resolved` around every human wait with
  a `request_id`, an `outcome`, and a **force-redacted** prompt — the payload never
  carries what the human typed.
- **Surprising:** the smart reviewer (`tools/approval_smart.py:88`) is an *auxiliary LLM*
  that returns `'approve' | 'deny' | 'escalate'`, and "uncertain" is modelled as
  `'escalate'` rather than as a coin flip. `_verdict_reasoning` (`:74`) turns *thinking
  off* for the verdict unless the operator explicitly configured reasoning for the
  approval task — a cheap-fast default for a decision that blocks a human.

#### `tools/cronjob_tools.py` (+ `cronjob_job_args.py`, `cronjob_prompt_scan.py`)
- **Purpose:** scheduled and event-driven background work.
- **Key abstractions:** `execute_job_for_event` (`:~418`), `_execute_job_now`,
  `_latest_job_output_excerpt` (`:~450`), `_reap_stale_executions` (`:~485`),
  `_cronjob_schema_overrides` (`:~1048`).
- **Data flow:** a cron job fires → the run is *claimed* (at-most-once) → the agent runs
  in a **fresh session with no chat context** → the output is saved as a `.md` file under
  the job's output dir → delivery is a one-way message to a named destination
  (`deliver`: `local`, `all`, `bot-chat`, or `platform:chat_id:thread_id`).
- **Non-obvious design decisions — one claimed-run body, three entry points.**
  `execute_job_for_event` is the webhook path, and it fires *through the exact same
  `_execute_job_now` body* a manual `cronjob(action='run')` uses, so at-most-once
  claiming, in-flight dedupe, delivery, and `[SILENT]` handling are identical across
  scheduler / manual / event paths. That is the single most valuable idea in this shard
  for August Trading.
- **Non-obvious design decisions — stale-claim reaping.** A prior one-shot `hermes cron run`
  that died mid-run leaves an execution row stuck in `claimed`/`running`, which would
  block every later manual run. `_reap_stale_executions` reaps rows whose owner is
  *provably dead* (PID gone, or PID reused per its start time), and also reaps a live
  owner's row when the claim is older than the derived stale bound — without killing the
  process. Best-effort self-heal that must not block dispatch.
- **Edge cases & failure handling:** `extra_prompt` is injected as *transient per-run
  context*; the job's stored prompt is never mutated. `_latest_job_output_excerpt`
  returns a bounded excerpt (2000 chars) plus a pointer to the full file, and never
  raises.
- **Surprising:** `_cronjob_schema_overrides` rebuilds the `script` path hint from the
  **active profile at every `get_definitions()`** — the static schema is built once per
  process, but the multiplexed gateway serves every profile from that process, so a path
  baked in at import would name the launch profile's home. This "profile-multiplexed
  gateway" constraint recurs across the whole shard (`tools/tool_output_limits.py:19-22`
  caches limits *per profile home* for the same reason).

#### `tools/skill_usage.py` (+ `skill_ledger.py`, `skill_linter.py`, `skills_tool.py`, `skills_guard.py`)
- **Purpose:** the skill store's *lifecycle and telemetry*.
- **Key abstractions:** `skill_file_lock` (`:70`), `latest_activity_at` (`:123`),
  `activity_count` (`:141`), `_read_bundled_names` (`:147`), `_read_hub_installed_names` (`:155`),
  `is_protected_builtin` (`:43`), `PROTECTED_BUILTIN_SKILLS` (`:40`).
- **Data flow:** every skill use/view/patch bumps a counter in a **sidecar**
  `~/.hermes/skills/.usage.json` — deliberately *not* in the skill's frontmatter, so
  telemetry never contaminates a user-authored `SKILL.md` and never touches bundled or
  hub-installed skills. The curator reads that ledger to decide staleness.
- **Non-obvious design decisions:** the lifecycle is **active → stale → archived**
  (moved to `.archive/`), and `pinned` is *orthogonal* to state — a pin opts out of auto
  transitions but is not a fourth state. `latest_activity_at` (`:123`) **excludes
  `created_at`**, so a never-active skill stays distinguishable from an actively-used
  one; `activity_count` (`:141`) counts use+view+patch.
- **Non-obvious design decisions — provenance is an explicit marker, never inferred.**
  Curator management is triggered by an explicit `created_by: agent` marker written by
  `skill_manage`; it is *never* inferred from the file's location.
  `tools/skill_provenance.py:1-9` makes the write origin a `ContextVar`
  (`foreground` vs `background_review`) so a background review fork cannot curating
  skills the user asked for. `is_unattended_review()` = background *and* not attended —
  the `/refine` fork IS a background review (so every curator/ledger/approval guard still
  applies) but a user asked for it, so the unattended-only memory-delete gate does not.
- **Edge cases & failure handling:** counter bumps are best-effort and DEBUG-logged on
  failure — *they never break the tool call*. Writes are atomic under a cross-process
  lock. `skill_file_lock` (`:70`) is re-entrant within one process.
- **Surprising:** `tools/skill_usage.py:1-6` puts the telemetry in a *sidecar file*
  precisely so that "telemetry out of user-authored SKILL.md" is structural, not a
  convention.

#### `tools/memory_tool.py` + `tools/memory_tool_store.py`
- **Purpose:** the agent's durable memory.
- **Key abstractions:** a memory write path shared by the CLI, the gateway and cron, with
  `agent.redact.redact_sensitive_text` applied on the way in, and
  `tools/threat_patterns.py` `scan_for_threats` applied with a *scope*.
- **Data flow:** the model proposes a memory; the write is classified by
  `tools/threat_patterns.py:131` (`scan_for_threats(content, scope)`) and screened for
  prompt injection before it is persisted; the curated set is injected into the prompt
  on later turns.
- **Non-obvious design decisions — threat scopes are cumulative, and the "strict" scope
  is reserved for writes where a block is *resolvable*.** `tools/threat_patterns.py:1-9`:
  `all` applies everywhere; `context` adds promptware / C2 / role-hijack for context
  files, memory and tool results at **warn level** (that content is not user-authored);
  `strict` adds aggressive checks only for user-mediated writes where a block can
  actually be resolved. And the library *constrains its own pattern vocabulary*: new
  patterns "must anchor on C2 vocabulary or unambiguous attack behavior, NOT bossy
  English ('you must' is common in legitimate AGENTS.md)". Filler between tokens is
  bounded by a single `_FILLER` regex. `MAX_SCAN_CHARS = 65_536` (`:17`).
- **Edge cases & failure handling:** invisible unicode codepoints are reported as a
  distinct pattern id (`"invisible_unicode"`), not as a generic hit. `first_threat_message`
  (`:148`) is the block-on-first-hit path.
- **Surprising:** a *user-mediated write* (a memory the user asked to save) is scanned
  strictly; a *scraped* context file is only warned about — because blocking a scraped
  web page would break the page, while blocking a user-authored save can be resolved by
  asking the user.

#### `tools/delegate_tool*.py` (13 files)
- **Purpose:** the multi-agent layer — a parent agent spawning a child agent.
- **Key abstractions:** `delegate_tool.py` (the tool surface), `delegate_tool_child_run.py`
  (the child's execution: `_run_with_thread_capture` `:857`,
  `append_sibling_write_reminder` `:971`, `account_background_processes` `:992`,
  `emit_complete` `:1012`, `cleanup` `:1049`), `delegate_tool_config.py` (the knobs),
  `delegate_tool_dispatch.py`, `delegate_tool_progress.py`, `delegate_tool_registry.py`,
  `delegate_tool_results.py`, `delegate_tool_tasks.py`, `delegate_tool_toolsets.py`,
  `delegation_live_log.py`, `delegation_output_schema.py`, `delegation_redaction.py`.
- **Data flow:** parent calls `delegate_tool` → the child runs on a worker thread with
  its own toolset → live progress is streamed back → the child returns a structured
  result → the parent's registry entry is cleaned up in a `finally` path.
- **Non-obvious design decisions — flat by default.** `tools/delegate_tool_config.py:21`:
  `MAX_DEPTH = 1` — parent (0) → child (1); deeper needs `max_spawn_depth` explicitly.
  `_get_orchestrator_enabled` (`:165`) is a kill switch that forces every child to a leaf.
  `_get_max_concurrent_children` (`:93`) and `_get_max_async_children` (`:121`) are
  separate caps, both floored at 1.
- **Non-obvious design decisions — a child that cannot ask a human is denied by
  default.** `_subagent_auto_deny` (`:42`) returns `'deny'` so the child sees a
  *recoverable refusal*; `_subagent_auto_approve` (`:50`) is opt-in YOLO via
  `delegation.subagent_auto_approve`. A child also cannot answer a sudo prompt —
  `tools/terminal_tool_sudo.py:442` `_no_sudo_user()` returns True for a delegated child
  or a `hermes chat -q` run: *"nobody can answer a sudo prompt."*
- **Non-obvious design decisions — the sibling write reminder.**
  `append_sibling_write_reminder` (`delegate_tool_child_run.py:971`) warns the parent
  when a child wrote files the parent had **already read** — and it checks writes by
  *any* non-parent task, so a sibling's write invalidates the parent's read. This is a
  staleness guard, and it is the one place a multi-agent system must invalidate its own
  cache.
- **Non-obvious design decisions — worktree isolation with a dirty-archive.**
  `tools/subagent_worktree.py:1-9`: on finish, zero commits *and* clean → the worktree
  is removed; work left behind → archived to `refs/hermes/archive/<tree>` then removed
  (the branch is kept so the parent can merge it); a failed probe or archive → kept and
  **flagged** (`mark_worktree_payload_unproven`).
- **Edge cases & failure handling:** `cleanup` (`:1049`) is idempotent and never raises;
  the order matters (stop heartbeat → drop registry entry → release resources).
  `emit_complete` (`:1012`) fires a `subagent.complete` event with tokens, cost, files
  touched and tool counts — per-branch observability. `delegation_redaction.py` redacts
  the child's output before it reaches the parent.

#### `tools/terminal_tool.py` + companions (10 files)
- **Purpose:** shell execution, foreground and background.
- **Key abstractions:** `terminal_tool.py` (82 KB) plus `terminal_tool_backends.py`,
  `terminal_tool_background.py`, `terminal_tool_config.py`, `terminal_tool_guards.py`,
  `terminal_tool_lifecycle.py`, `terminal_tool_macos_open.py`, `terminal_tool_result.py`,
  `terminal_tool_sudo.py`, `terminal_scope.py`, `terminal_hints.py`.
- **Data flow:** a command is rewritten (sudo → `sudo -S` with a password prompt;
  compound-background `A && B &` → `A && { B & }` because bash binds `&&` tighter than
  `&` — `terminal_tool_sudo.py:387` `_rewrite_compound_background`), then executed in
  the task's environment, then its output is truncated to the configured budget and
  annotated.
- **Non-obvious design decisions — output-pattern failure hints.**
  `tools/terminal_hints.py:1-8` extends the exit-code semantics table with a bounded
  scan of *failed-command output* mapped to **one** short actionable recovery hint. Rules:
  only fires on non-zero exit; first match wins; patterns ordered by observed production
  frequency; scans only the first `_SCAN_CHARS` so hints key on error *headers*, not deep
  context; the hint states the *next action* in 1-2 sentences; pure function, no I/O and
  no config reads. `annotate_masked_success` (`:139`) handles the inverse: an exit-0
  result that likely *masks* a failure.
- **Non-obvious design decisions — output limits are configurable and per-profile.**
  `tools/tool_output_limits.py`: `max_bytes` (default 50 000), `max_lines` (2 000),
  `max_line_length` (2 000) from `tool_output` in config.yaml, cached **per profile
  home** because one multiplexed gateway process serves every profile.
- **Edge cases & failure handling:** `tools/interrupt.py:37` `set_interrupt` is
  *thread-scoped* — interrupting one agent session does not kill tools in other sessions
  in the same gateway process. `request_yield` (`:74`) lets a foreground terminal hand
  its live process to the background.
- **Surprising:** `tools/thread_context.py:1-10` documents a **security** landmine:
  *"A bare `threading.Thread` / `ThreadPoolExecutor` worker starts with an empty
  `contextvars.Context` and no thread-local approval/sudo callbacks, so tool dispatch
  inside it silently loses the approval ContextVars (gateway sessions then auto-approve
  dangerous commands)"* (GHSA-qg5c-hvr5-hjgr). The fix is fail-closed: if callback
  installation raises, the callbacks stay `None` and dangerous commands are *denied*.

### 1.3 Tier 2 — compact table, one row per file

The ledger. Every file in the shard appears exactly once, in list order.

#### Approval, guard and human-wait cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/AGENTS.md` | The tool-layer contract: the Footprint Ladder ("most capabilities should NOT be core tools"), the registry discovery rule, and the required shape of a new tool (schema + `check_requirements` + `registry.register`). |
| `tools/__init__.py` | Deliberately side-effect-free package namespace; only exports `check_file_requirements`. |
| `tools/annotate_preview_tool.py` | Desktop-GUI persistent element annotations; binds to elements not coordinates, so navigation clears them. |
| `tools/ansi_strip.py` | Strips full ECMA-48 ANSI escapes (CSI/OSC/DCS/SOS/PM/APC/nF/Fp/Fe/Fs/8-bit C1) from subprocess output so models never copy escape codes into file writes. |
| `tools/approval.py` | The gate: session state, the three guard entry points, the human-decision engine, the denial breaker, the gateway approval queue. |
| `tools/approval_context.py` | ContextVars and config readers for the approval module (session key, timeout, current scope). |
| `tools/approval_detection.py` | The hardline / dangerous command pattern library — the *what* the gate matches against. |
| `tools/approval_floors.py` | Pre-gate blocks and allowlist matching — the refusals that happen before any human is asked. |
| `tools/approval_gateway_wait.py` | The blocking gateway round-trip: notify, poll, coalesce followers, withdraw, settle; first-settlement-wins on a late answer. |
| `tools/approval_human_wait.py` | Per-session accounting of verifiably human-blocked wall clock, with a ceiling of `approvals.timeout + 60s`. |
| `tools/approval_prompt.py` | The CLI prompt, plugin transports and MCP elicitation — how the question is actually shown. |
| `tools/approval_smart.py` | The auxiliary-LLM guardian: returns `approve` / `deny` / `escalate`; thinking is off for the verdict unless configured. |
| `tools/approval_yolo.py` | The one toggle/restore/carry contract for the YOLO bypass across CLI, TUI, Desktop and gateway surfaces. |
| `tools/arg_coercion.py` | Schema-guided, conservative repair of model-emitted tool arguments (`"42"` → int, `"true"` → bool, JSON strings → arrays, scalars → one-element lists); originals kept when the repair is not unambiguous. |
| `tools/async_delegation.py` | The asynchronous delegation runtime (75 KB) — background children, wake-ups, cancellation. |
| `tools/async_delegation_recovery_hints.py` | Human-readable recovery hints for a failed async delegation. |
| `tools/async_delegation_worker.py` | The worker-thread entry point for an async delegation child. |
| `tools/human_input_hooks.py` | `on_human_input_request` / `on_human_input_resolved` plugin observers around every human wait; the prompt is force-redacted and the human's answer is never in the payload. |
| `tools/write_approval.py` | The write-side approval gate (file and skill writes), including the staged/replay path that lets `/skills approve` re-apply a pending write. |
| `tools/clarify_batch.py` | Batched clarify (ask-the-user) requests — one round trip, many questions. |
| `tools/clarify_gateway.py` | The gateway transport for clarify prompts. |
| `tools/clarify_tool.py` | The `clarify` tool surface: the model asks a question mid-turn. |
| `tools/hook_output_spill.py` | Spills oversized hook/tool output to a file and returns a pointer instead of the bytes. |
| `tools/spill_safety.py` | Symlink-safe exclusive creation (`O_CREAT|O_EXCL`, `O_NOFOLLOW`, `lstat`+`unlink` for overwrite) for spill and cache files under `~/.hermes`. |
| `tools/slash_confirm.py` | The `/`-command confirmation prompt surface. |

#### Delegation / multi-agent cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/delegate_tool.py` | The `delegate` tool surface and the parent's view of a child run. |
| `tools/delegate_tool_child_run.py` | The child's own execution: thread capture, sibling-write reminder, background-process hand-off, `subagent.complete` event, idempotent teardown. |
| `tools/delegate_tool_config.py` | The `delegation.*` knobs: `MAX_DEPTH = 1`, concurrency caps, child timeout, spawn depth, orchestrator kill switch, capability/endpoint inheritance. |
| `tools/delegate_tool_dispatch.py` | Routes a delegation call into the child runner. |
| `tools/delegate_tool_progress.py` | Live progress events from the child to the parent. |
| `tools/delegate_tool_registry.py` | The in-process registry of running children. |
| `tools/delegate_tool_results.py` | Shapes the child's return value for the parent. |
| `tools/delegate_tool_tasks.py` | Task records for delegated work. |
| `tools/delegate_tool_toolsets.py` | Toolset narrowing for a child (and `delegation.inherit_mcp_toolsets`). |
| `tools/delegation_live_log.py` | The live log a parent can read while a child runs. |
| `tools/delegation_output_schema.py` | The structured output schema a child must satisfy. |
| `tools/delegation_redaction.py` | Redacts a child's output before it reaches the parent. |
| `tools/subagent_worktree.py` | Opt-in git worktree isolation per child; clean → removed, dirty → archived to `refs/hermes/archive/<tree>`, failed probe → kept and flagged. |
| `tools/kanban_tools.py` | A structured work-board surface for worker + orchestrator agents; `KANBAN_LIST_DEFAULT_LIMIT = 50`, `KANBAN_LIST_MAX_LIMIT = 200`. |
| `tools/kanban_tools_schemas.py` | The kanban tool schemas. |
| `tools/kanban_toolset_context.py` | The per-dispatcher kanban context binding. |
| `tools/daemon_pool.py` | A small pool of reusable daemon workers. |

#### Scheduling / cron cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/cronjob_tools.py` | The cron tool: claim-once runs, `[SILENT]` handling, delivery targets, stale-claim reaping, event-driven firing through the same claimed-run body. |
| `tools/cronjob_job_args.py` | Normalises and validates cron job arguments and schedules (recurring / relative / absolute one-shot). |
| `tools/cronjob_prompt_scan.py` | Scans a cron job's stored prompt for injection patterns before it runs unattended. |

#### Registry / discovery / labelling cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/registry.py` | The single registry: `registry.register(...)`, `get_emoji`, `tool_error`; the import-time discovery mechanism. |
| `tools/tool_search.py` | The progressive-disclosure bridge: `tool_search`, `tool_describe`, scope rules, deferral reasons, search metrics. |
| `tools/tool_search_catalog.py` | The searchable catalog: tokenization and scoring over tool names, descriptions and connector entries. |
| `tools/tool_search_validation.py` | Normalises and validates `tool_call` arguments; rejects batches naming local tools. |
| `tools/schema_sanitizer.py` | Sanitises tool JSON schemas for the wire (resolves local `$ref`s, strips unsupported keywords). |
| `tools/tool_labels.py` | One label shape (`kind` / `app` / `action` / `emoji` / `preview`) for every tool kind, including the bridge tools themselves. |
| `tools/tool_result_storage.py` | Stores large tool results and returns a handle, so the transcript does not carry the bytes. |
| `tools/tool_output_truncate.py` | The single truncation routine for tool output. |
| `tools/tool_output_limits.py` | Configurable `max_bytes` / `max_lines` / `max_line_length`, cached per profile home. |
| `tools/tool_backend_helpers.py` | Shared helpers for picking a tool's execution backend. |
| `tools/blueprints.py` | Reusable call shapes (parameter bundles) reused by several tool surfaces. |
| `tools/budget_config.py` | The budget knobs (token / cost / call budgets) read by several tools. |
| `tools/debug_helpers.py` | Small debug-printing helpers used across tools. |
| `tools/lazy_deps.py` | Defers importing optional heavy dependencies until first use. |

#### File operations, read tracking and write guards cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/binary_extensions.py` | The binary / opaque-document extension tables used to refuse a binary read (`.pdf`, `.docx`, …) and to recognise SQLite sidecars (`x.db-wal`, `x.sqlite3-shm`) as never-legitimate text targets — pure string logic, no I/O. |
| `tools/working_diff.py` | Surface-agnostic working-tree git diff collection shared by the CLI and the gateway `/diff`: modes `working` / `staged` / `all`, untracked files folded in as additions, and every git invocation hardened against a malicious repo's `.git/config` (`--no-ext-diff --no-textconv`, no fsmonitor/hooks/pager/editor/credential sinks). |
| `tools/session_search_tool.py` | The transcript search surface (44 KB) — the reference's queryable "trade log" over a session's own history. |
| `tools/file_operations.py` | The low-level file primitives (94 KB): read, write, edit, patch, search, with the device-path blocklist and the char-budget trimming. |
| `tools/file_operations_common.py` | Shared helpers for the file primitives. |
| `tools/file_operations_lint.py` | Lints written content (trailing whitespace, conflict markers, etc.) before it lands. |
| `tools/file_operations_native.py` | The native (non-shell) implementation of a few file ops. |
| `tools/file_operations_search.py` | The search backend for files (60 KB). |
| `tools/file_tools.py` | The model-facing file tools: pagination with line numbers, document extraction, read-dedup stubs, the char budget, the blocked-device guard. |
| `tools/file_tools_paths.py` | Task-aware path resolution. |
| `tools/file_tools_read_tracking.py` | Per-task read dedup, loop detection and staleness state. |
| `tools/file_tools_write_guards.py` | The write-side guards: what may be written, and what must be refused. |
| `tools/file_state.py` | The shared read/write state registry: `record_read`, `note_write`, `check_stale`, `writes_since`, `known_reads`, `forget_task`. |
| `tools/patch_parser.py` | Parses unified-diff patches into operations; applies add/delete/move/update hunks. |
| `tools/escape_drift_autocorrect.py` | Conservative correction of escape drift before fuzzy matching; a correction must appear verbatim in the file to be accepted. |
| `tools/fuzzy_match.py` | The fuzzy string matcher used by edit tools. |
| `tools/read_extract.py` | Extracts text from documents (PDF/Office) into paginated text. |
| `tools/path_security.py` | `validate_within_dir`, `has_traversal_component`, `has_unsafe_path_chars` — shared path validation. |
| `tools/self_repo_guard.py` | Refuses git mutations of the harness's own checkout; `guard_active()` is Windows-only because NTFS locks loaded `.py`/`.pyd` files. |
| `tools/process_registry.py` | The long-lived process registry (150 KB): sessions, output logs, checkpoints, results, notifications, termination, wait policy. |
| `tools/process_registry_awaiting.py` | The "awaiting" state for a background process. |
| `tools/process_registry_checkpoint.py` | Checkpoints a background process's state so it can be resumed. |
| `tools/checkpoint_manager.py` | The checkpoint store (69 KB): what a checkpoint holds, how it is named, and how it is restored. |
| `tools/checkpoint_maintenance.py` | Prunes, expires and repairs checkpoints so the store does not grow without bound. |
| `tools/checkpoint_pruning.py` | The pruning policy — which checkpoints are safe to drop and which are not. |
| `tools/checkpoint_manager_profile_rename.py` | Rewrites checkpoint names when a profile is renamed, so a rename does not orphan the store. |
| `tools/process_registry_env_log.py` | The environment log captured for a background process. |
| `tools/process_registry_notifications.py` | Delivery of a background process's completion notice. |
| `tools/process_registry_output_log.py` | The output log for a background process. |
| `tools/process_registry_results.py` | The result record for a finished background process. |
| `tools/process_registry_termination.py` | Terminates a process and its descendants; fail-closed on unverifiable survivors. |
| `tools/process_registry_wait_policy.py` | Stops the model re-issuing byte-identical `wait`/`poll` calls: after N no-output polls the session is promoted to `notify_on_complete` and the model is told to stop checking. |
| `tools/process_registry_wsl.py` | Detects background spawns routed through a `wsl[.exe]` launcher chain (whose host PID is a short-lived launcher). |
| `tools/pty_query_responder.py` | Answers a PTY's interactive query (password prompt, y/n) from a registered responder. |
| `tools/shell_heredoc.py` | Heredoc-aware shell parsing. |

#### Terminal, execution and environment cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/terminal_tool.py` | The shell tool (82 KB): run, background, sudo, timeouts, output shaping. |
| `tools/terminal_tool_backends.py` | The backend selection (local / docker / ssh / modal / singularity / daytona / vercel). |
| `tools/terminal_tool_background.py` | Background execution and the handoff to the process registry. |
| `tools/terminal_tool_config.py` | Terminal configuration readers. |
| `tools/terminal_tool_guards.py` | The terminal-side guards (what a command is allowed to do). |
| `tools/terminal_tool_lifecycle.py` | The terminal session's lifecycle. |
| `tools/terminal_tool_macos_open.py` | The macOS `open` special case. |
| `tools/terminal_tool_result.py` | Shapes the terminal result for the model. |
| `tools/terminal_tool_sudo.py` | Sudo rewriting, the compound-background rewriter, and `_no_sudo_user()`. |
| `tools/terminal_hints.py` | Output-pattern failure hints and the masked-success annotation. |
| `tools/terminal_scope.py` | The scope rules for what a terminal session may reach. |
| `tools/thread_context.py` | Propagates ContextVars and thread-local approval/sudo callbacks into worker threads; fail-closed if installation fails. |
| `tools/interrupt.py` | Thread-scoped interrupt and yield signalling, so one session's cancel does not kill another's tools. |
| `tools/interpreter_shutdown.py` | The shared "interpreter is finalizing" predicate that stops background threads scheduling new work during teardown. |
| `tools/env_passthrough.py` | The session-scoped allowlist of env vars a skill or config may forward into a sandbox, minus Hermes-managed provider credentials. |
| `tools/env_probe.py` | A deterministic one-line probe of the local Python toolchain so the model does not discover it by hitting walls. |
| `tools/environments/__init__.py` | The environment package namespace. |
| `tools/environments/base.py` | The `BaseEnvironment` contract every backend implements (40 KB). |
| `tools/environments/base_output.py` | Output streaming and truncation shared by all backends. |
| `tools/environments/base_session_env.py` | The per-session environment construction. |
| `tools/environments/base_wait.py` | Shared wait semantics. |
| `tools/environments/docker.py` | The Docker backend (73 KB) incl. privilege stripping and file hand-back. |
| `tools/environments/docker_egress.py` | Egress policy for containers. |
| `tools/environments/docker_ownership.py` | Ownership of files created inside a container. |
| `tools/environments/daytona.py` | The Daytona backend. |
| `tools/environments/file_sync.py` | Transactional local↔remote file sync (mtime+size, deletions, credential remap, stale temp sweeping). |
| `tools/environments/fd_wait.py` | `FdWaiter` — epoll/kqueue-based fd readiness, because `select` raises above `FD_SETSIZE` and macOS `poll` mis-reports a PTY as ready. |
| `tools/environments/local.py` | The local backend (60 KB) incl. the local env policy. |
| `tools/environments/local_env_policy.py` | The local environment's env-var policy. |
| `tools/environments/local_pythonpath.py` | `PYTHONPATH` hygiene for local children. |
| `tools/environments/managed_modal.py` | The managed Modal backend. |
| `tools/environments/modal.py` | The Modal backend. |
| `tools/environments/path_utils.py` | Path helpers shared by the backends. |
| `tools/environments/remote_common.py` | Shared remote-execution helpers. |
| `tools/environments/singularity.py` | The Singularity backend. |
| `tools/environments/ssh.py` | The SSH backend. |
| `tools/environments/streams.py` | Remote stream handling and `PortForward`. |
| `tools/environments/vercel_sandbox.py` | The Vercel Sandbox backend with per-task snapshot restore. |
| `tools/code_execution_tool.py` | The `execute_code` tool (51 KB): a sandboxed Python runner. |
| `tools/code_execution_env.py` | The shared child env builder: secret scrubbing, `PYTHONPATH` hygiene, UTF-8, TZ, interpreter and cwd resolution. |
| `tools/code_execution_rpc.py` | The host-side RPC servers for execute_code sandboxes: token check → allow-list → call budget → dispatch. |
| `tools/code_kernel.py` | The local session kernel (41 KB) that execute_code runs inside. |
| `tools/code_kernel_remote.py` | The remote kernel variant. |
| `tools/credential_files.py` | Where credential files live and which are upload-only for remote sandboxes. |
| `tools/managed_gateway_auth.py` | Auth for the managed tool gateway. |
| `tools/managed_gateway_identity.py` | The guest identity for the managed gateway. |
| `tools/managed_tool_gateway.py` | The managed gateway client used by the connector stack. |

#### Skills cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/skill_usage.py` | The sidecar usage ledger and the active → stale → archived lifecycle; `pinned` is orthogonal to state. |
| `tools/skill_ledger.py` | The skill ledger itself — what the harness records about each skill's use. |
| `tools/skill_linter.py` | Lints a skill's `SKILL.md` structure and frontmatter. |
| `tools/skill_manager_tool.py` | The skill authoring/editing tool (47 KB). |
| `tools/skill_manager_batch.py` | Batch skill operations. |
| `tools/skill_manager_guards.py` | The guards on skill writes. |
| `tools/skill_provenance.py` | The `foreground` / `background_review` write-origin ContextVar and the attended/unattended distinction. |
| `tools/skills_tool.py` | The model-facing skills browse/read surface (42 KB). |
| `tools/skills_tool_dedup.py` | Deduplicates skill hits in results. |
| `tools/skills_tool_plugin.py` | Skill-provided plugins. |
| `tools/skills_tool_setup.py` | Skill setup steps. |
| `tools/skills_guard.py` | The skills security scanner (67 KB) — the pattern library, severities and blocks. |
| `tools/skills_hub.py` | The Skills Hub front door. |
| `tools/skills_hub_models.py` | Shared hub models: `SkillMeta`, `SkillBundle`, `SkillSource`, guarded fetch, name and path validation. |
| `tools/skills_hub_search.py` | Hub search. |
| `tools/skills_hub_install.py` | Hub install. |
| `tools/skills_hub_github.py` | The GitHub source adapter. |
| `tools/skills_hub_official.py` | The official catalogue source. |
| `tools/skills_hub_clawhub.py` | The ClawHub source adapter. |
| `tools/skills_hub_skillssh.py` | The skills.sh adapter (sitemap catalogue, weekly installs, security audit badges). |
| `tools/skills_hub_sources.py` | Well-known-endpoint, direct-URL, LobeHub and browse.sh adapters. |
| `tools/skills_sync.py` | Syncs local skills with the hub. |
| `tools/skills_sync_bundled_ops.py` | Bundled-skill sync operations. |
| `tools/skills_sync_optional.py` | Optional-skill sync operations. |
| `tools/skillevaluator_scan.py` | Scores a skill's quality. |
| `tools/skills_ast_audit.py` | AST-level audit of a skill's code. |

#### MCP client cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/mcp_tool.py` | The MCP client core: the `MCPServerTask` lifecycle (40 KB). |
| `tools/mcp_tool_agent.py` | MCP support inside the agent loop. |
| `tools/mcp_tool_common.py` | Shared helpers: `_exc_str`, `_sanitize_error`, `_core`. |
| `tools/mcp_tool_config.py` | The `mcp_servers.<name>` config reader (37 KB). |
| `tools/mcp_tool_content.py` | Shapes MCP tool content for the model. |
| `tools/mcp_tool_costs.py` | Cost accounting for MCP calls. |
| `tools/mcp_tool_discovery.py` | Tool discovery and per-turn refresh (50 KB). |
| `tools/mcp_tool_errors.py` | Error classification: URL validation, TLS client certs, identity headers, redirect header stripping, exception-group unwrapping, and `permanent` vs retryable classification. |
| `tools/mcp_tool_events.py` | MCP lifecycle events. |
| `tools/mcp_tool_handlers.py` | The per-tool MCP call handlers (46 KB). |
| `tools/mcp_tool_health.py` | Per-server health tracking. |
| `tools/mcp_tool_lifecycle.py` | Connect / reconnect / park, with a retry budget. |
| `tools/mcp_tool_loop.py` | The MCP server run loop. |
| `tools/mcp_tool_node_abi.py` | The Node-side ABI contract for MCP servers. |
| `tools/mcp_tool_registration.py` | Registers MCP tools into the registry (37 KB). |
| `tools/mcp_tool_sampling.py` | Server-initiated sampling (the server calls the model back). |
| `tools/mcp_tool_schema.py` | MCP tool schema shaping, including the `MCP_TOOL_NAME_PREFIX` namespace. |
| `tools/mcp_tool_scope.py` | Which MCP tools are in scope for a session. |
| `tools/mcp_tool_server_run.py` | Running a local MCP server (35 KB). |
| `tools/mcp_tool_transport.py` | Transport bring-up: stdio spawn, HTTP/SSE connect, protocol negotiation (47 KB). |
| `tools/mcp_oauth.py` | The MCP OAuth 2.1 client (68 KB): PKCE, on-disk token storage, the **refresh fence**, non-interactive detection. |
| `tools/mcp_oauth_device.py` | Device-code OAuth flow. |
| `tools/mcp_oauth_manager.py` | The OAuth manager across servers. |
| `tools/mcp_oauth_provider.py` | The OAuth provider abstraction (35 KB). |
| `tools/mcp_dashboard_oauth.py` | The dashboard-driven OAuth flow. |
| `tools/mcp_death_supervisor.py` | Detects a dead MCP child and restarts it. |
| `tools/mcp_liveness.py` | Declarative liveness for MCP servers: `static` / `server_json` / `interactive_session`, with a composed user-facing sentence. |
| `tools/mcp_schema_cache.py` | Caches an MCP server's schemas. |
| `tools/osv_check.py` | OSV vulnerability preflight before an npm package is spawned. |
| `tools/openrouter_client.py` | A tiny OpenRouter HTTP client shim. |
| `tools/connectors/__init__.py` | The connectors package namespace. |
| `tools/connectors/account.py` | Connector account records. |
| `tools/connectors/catalog.py` | The connector catalogue (20 KB). |
| `tools/connectors/catalog_tool.py` | The catalogue tool surface. |
| `tools/connectors/contract.py` | The connector state machine: `TargetState`, `Actor`, `SettleReason`, `TRANSITIONS`, `allowed(kind, current, to)`. |
| `tools/connectors/data_use.py` | Collects the data-use requirements of a connector result into a sink, so the requirement never rides the model-visible result string. |
| `tools/connectors/dispatch.py` | Routes connector calls through the normal dispatch policy pipeline. |
| `tools/connectors/display.py` | The desktop's browsable connector card. |
| `tools/connectors/live.py` | Live operations keyed by `(profile, session)`; `OperationAlreadyOpen` when one is already open. |
| `tools/connectors/managed.py` | Managed (hosted) connector accounts, with a per-tick watcher and OAuth re-park. |
| `tools/connectors/mcp.py` | The local-MCP-server side of a connection operation (40 KB). |
| `tools/connectors/mcp_oauth.py` | Connector-scoped MCP OAuth. |
| `tools/connectors/operation.py` | The `ConnectionOperation` object and its target list. |
| `tools/connectors/run.py` | The operation runner: prepare → observe → settle, with a deadline and an interrupt flag. |
| `tools/connectors/search.py` | Connector search, reusing the tool-search catalog's tokenizer. |
| `tools/connectors/targets.py` | Target normalization and validation (alias pattern, action validation). |
| `tools/connectors/tool.py` | The `manage_connections` tool surface. |
| `tools/connectors/turn.py` | The connection surface (card / side / link) as a ContextVar. |
| `tools/connectors/gateway/__init__.py` | The gateway package's layering rules: `wire.py` is a leaf, `errors.py` is stdlib-only, no pydantic model escapes the wire/client layer. |
| `tools/connectors/gateway/bridge.py` | The client-side bridge to the managed tool gateway. |
| `tools/connectors/gateway/client.py` | The gateway HTTP client (26 KB). |
| `tools/connectors/gateway/config.py` | Gateway configuration incl. `MAX_CALLS_PER_DISPATCH` and the guest identity. |
| `tools/connectors/gateway/errors.py` | The `ToolGatewayError` family and the single connection-required payload. |
| `tools/connectors/gateway/files.py` | File transfer over the gateway. |
| `tools/connectors/gateway/merge.py` | Merges remote execute results back into the `tool_call` result array, and partitions calls. |
| `tools/connectors/gateway/names.py` | Connector name parsing and vendor slug candidates. |
| `tools/connectors/gateway/wire.py` | The pydantic wire models for the four gateway routes. |
| `tools/connectors/portal/__init__.py` | The portal package (5 bytes). |
| `tools/connectors/portal/client.py` | The portal HTTP client. |
| `tools/connectors/portal/errors.py` | The portal error type (280 bytes). |
| `tools/connectors/portal/policy.py` | Portal policy decisions. |
| `tools/connectors/portal/tools_cache.py` | Caches the portal's tool list. |
| `tools/connectors/portal/wire.py` | The portal wire models. |

#### Browser, desktop GUI and computer-use cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/browser_tool.py` | The browser tool facade (68 KB): backends, per-task sessions, `@eN` accessibility refs, private-host detection, session-key routing. |
| `tools/browser_tool_cdp.py` | The CDP endpoint tool. |
| `tools/browser_tool_cloud.py` | Cloud browser providers (Browserbase / Firecrawl). |
| `tools/browser_tool_eval_policy.py` | The policy for evaluating a page against a request. |
| `tools/browser_tool_install.py` | Installs the agent-browser CLI. |
| `tools/browser_tool_lifecycle.py` | Browser session lifecycle (36 KB). |
| `tools/browser_tool_lightpanda_fallback.py` | The Lightpanda fallback backend. |
| `tools/browser_tool_origin.py` | The origin module other `browser_tool_*` modules read facade-owned state from. |
| `tools/browser_tool_real_profile.py` | Driving the user's real browser profile (with explicit consent). |
| `tools/browser_tool_session.py` | The browser session store (52 KB). |
| `tools/browser_tool_snapshot.py` | Snapshot shaping. |
| `tools/browser_tool_vision.py` | Vision on browser screenshots: Lightpanda pre-route, native provider vision, aux-LLM analysis. |
| `tools/browser_camofox.py` | The Camofox browser backend. |
| `tools/browser_camofox_state.py` | Camofox's per-task state (1 KB). |
| `tools/browser_cdp_tool.py` | The raw CDP tool. |
| `tools/browser_dialog_tool.py` | Browser native-dialog handling. |
| `tools/browser_extension_router.py` | Routes to a browser extension. |
| `tools/browser_harness_dirs.py` | The harness directory layout for browser runs. |
| `tools/browser_lightpanda.py` | The Lightpanda driver. |
| `tools/browser_supervisor.py` | Supervises browser processes (29 KB). |
| `tools/browser_supervisor_capture.py` | Screenshot capture. |
| `tools/browser_supervisor_dialogs.py` | Dialog handling under the supervisor. |
| `tools/browser_supervisor_frames.py` | Frame-tree tracking. |
| `tools/browser_use_cli.py` | The Browser Use CLI 3.0 backend (53 KB) — the default browser path. |
| `tools/browser_vault_tool.py` | The browser credential vault. |
| `tools/desktop_ui.py` | The shared desktop-GUI bridge (`passthrough_json`, blocking-prompt round trips). |
| `tools/annotate_preview_tool.py` | Persistent element annotations in the in-app browser. |
| `tools/drive_preview_tool.py` | Click / type / scroll in the in-app browser, addressed by *legible refs* that survive re-renders. |
| `tools/preview_tool.py` | The preview pane tool. |
| `tools/open_preview_tool.py` | Opens a URL in the preview pane. |
| `tools/read_preview_tool.py` | Reads the preview pane's current state. |
| `tools/close_preview_tool.py` | Closes the preview pane. |
| `tools/close_terminal_tool.py` | Closes a read-only terminal tab *without* killing the background process. |
| `tools/read_terminal_tool.py` | Reads a terminal tab. |
| `tools/read_window_tool.py` | Reads a desktop window. |
| `tools/focus_pane_tool.py` | Focuses a desktop pane. |
| `tools/tour_tool.py` | The guided UI tour; hidden from the model entirely when tours are off. |
| `tools/tour_presets.py` | The built-in tour presets (a leaf module with no `registry.register`, so importing it cannot register a tool as a side effect). |
| `tools/tip_tool.py` | A one-line UI tip bubble — fire-and-forget, because a tip is not a question. |
| `tools/set_theme_tool.py` | Sets the desktop theme. |
| `tools/computer_use/__init__.py` | The computer-use package namespace. |
| `tools/computer_use/backend.py` | The `ActionResult` / `UIElement` value types every backend returns. |
| `tools/computer_use/cua_backend.py` | The cua-driver backend. |
| `tools/computer_use/cua_backend_capture.py` | Screenshot capture for cua. |
| `tools/computer_use/cua_backend_daemon.py` | The cua daemon supervisor. |
| `tools/computer_use/cua_backend_driver.py` | The cua driver. |
| `tools/computer_use/cua_backend_input.py` | Click / drag / scroll / type / key input for cua. |
| `tools/computer_use/cua_backend_parse.py` | Pure parsing for cua: MCP result flattening, window/element normalisation, key-combo parsing, placeholder-id rejection. |
| `tools/computer_use/cua_backend_session.py` | The cua MCP session: asyncio bridge thread, lazily started, self-healing. |
| `tools/computer_use/doctor.py` | Diagnoses a broken computer-use setup (31 KB). |
| `tools/computer_use/permissions.py` | The permission rules for driving the screen. |
| `tools/computer_use/schema.py` | The computer-use tool schema. |
| `tools/computer_use/tool.py` | The `computer_use` tool itself (65 KB). |
| `tools/computer_use_tool.py` | The thin registration shim (1 KB). |
| `tools/bot_desktop/__init__.py` | The bot-desktop package namespace. |
| `tools/bot_desktop/browser.py` | The bot desktop's browser panel. |
| `tools/bot_desktop/install.py` | Installs the bot desktop stack. |
| `tools/bot_desktop/launcher.sh` | The X/VNC launcher (shell) — starts xfce directly with the screensaver/locker autostarts masked, because the xfce4 metapackage spawns polkit agents that lock a passwordless user out. |
| `tools/bot_desktop/lease.py` | The single truth for who may drive a profile's screen: agent or exactly one human viewer, on disk under an fcntl lock. |
| `tools/bot_desktop/placement.py` | Where a profile's desktop lives (gateway host vs terminal backend). |
| `tools/bot_desktop/resources.py` | The desktop's static resources. |
| `tools/bot_desktop/rfb_filter.py` | The RFB bridge that drops human input from non-holders. |
| `tools/bot_desktop/runtime.py` | The bot desktop runtime (40 KB). |
| `tools/bot_desktop/sandbox_host.py` | Hosts the desktop in a sandbox. |
| `tools/bot_desktop/thumbnail.py` | The desktop thumbnail. |
| `tools/bot_mode_dm.py` | Bot Mode direct messages (50 KB). |
| `tools/bot_mode_probe.py` | The Bot Mode capability probe. |
| `tools/bot_relay.py` | The cross-connection relay: plain file plumbing under `<root>/bot_relay/` — roster, outbox, claimed, replies — with TTLs (`DEFAULT_ENVELOPE_TTL_SECONDS = 900`, `TURN_ATTEMPT_TIMEOUT_SECONDS = 600`, `TURN_MAX_ATTEMPTS = 2`, `STALE_AFTER_SECONDS = 6h`). |
| `tools/bot_live_delivery.py` | Live delivery of bot messages. |
| `tools/bot_failure_reasons.py` | Normalised bot failure reasons. |
| `tools/daemon_pool.py` | The daemon worker pool shared by the background surfaces. |

#### Messaging / connectors to the outside world

| File | What it is / what it pins |
| --- | --- |
| `tools/send_message_tool.py` | The `send_message` tool (41 KB): platform routing, target resolution, media. |
| `tools/send_message_senders.py` | The per-platform senders (Telegram, Slack, Matrix, Discord) with redaction and retry classification. |
| `tools/plugin_guard.py` | The plugin security scanner: `skills_guard`'s engine applied to `hermes plugins install`/`update`. Full pattern set on docs/config (where prompt injection lives), the "reads own secret"/"HTTP with key" family exempt on *code* files, plugin-sized structural limits (`MAX_PLUGIN_FILE_COUNT = 400`, `MAX_PLUGIN_TOTAL_SIZE_KB = 10 MB`, `MAX_PLUGIN_SINGLE_FILE_KB = 1 MB`), and `dangerous` is **not** overridable by `--force`. |
| `tools/plugin_guard_context.py` | The context the plugin guard evaluates: what the plugin declares, what it will be allowed to do, and how findings are contextualised (48 KB). |
| `tools/microsoft_graph_auth.py` | Microsoft Graph auth (device-code / token acquisition) for the Graph connectors. |
| `tools/microsoft_graph_client.py` | The Microsoft Graph HTTP client used by the Graph-backed tools. |
| `tools/send_message_targets.py` | Target resolution. |
| `tools/discord_tool.py` | The Discord tool with a dynamic schema filtered by intents. |
| `tools/react_to_message_tool.py` | Adds a reaction to a message. |
| `tools/yuanbao_tools.py` | The Yuanbao gateway toolset (group queries, stickers, DMs). |
| `tools/feishu_doc_tool.py` | Feishu doc actions. |
| `tools/feishu_drive_tool.py` | Feishu drive actions. |
| `tools/feishu_lark.py` | Feishu/Lark wire helpers. |
| `tools/x_search_tool.py` | The X/Twitter search tool. |
| `tools/xai_http.py` | The xAI HTTP client. |
| `tools/xai_video_tools.py` | xAI video generation. |
| `tools/fal_common.py` | Shared fal.ai client helpers. |
| `tools/project_tools.py` | First-class Projects: creating/switching is an *explicit tool call*, never a side effect of `cd`. |
| `tools/setup_beat_tool.py` | The "set up a beat"/heartbeat surface. |
| `tools/web_tools.py` | Generic `web_search` / `web_extract` over pluggable backends; owns selection, safety gates, caching and the truncate-and-store pipeline. |
| `tools/web_tools_extract.py` | Page extraction. |
| `tools/web_tools_rescue.py` | The keyless "rescue" backend when the configured one has no key. |
| `tools/web_tools_truncate.py` | Truncation for web results. |
| `tools/web_result_cache.py` | The extract cache, keyed per `(url, format, provider)`, with local-dev hosts and user-exempted hosts excluded. |
| `tools/website_policy.py` | Per-website policy. |
| `tools/url_safety.py` | URL safety: SSRF, private-address and redirect checks (29 KB). |
| `tools/image_source.py` | Resolves an image reference to bytes. |
| `tools/image_generation_tool.py` | Image generation (49 KB). |
| `tools/image_generation_catalog.py` | The image-model catalogue. |
| `tools/image_generation_managed.py` | The managed image gateway. |
| `tools/video_generation_tool.py` | Video generation. |
| `tools/vision_tools.py` | `vision_analyze` / `video_analyze` (59 KB): image prep, native multimodal attachment vs aux-LLM description, SSRF-guarded download, and a **coordinate-mapping disclosure** when the image was downscaled or cropped. |
| `tools/vision_tools_history_budget.py` | The vision tool's history budget. |
| `tools/vision_tools_image_prep.py` | Image normalization for the provider. |
| `tools/todo_tool.py` | The in-memory, revisioned task list: re-injected after compression, revision bumps so clients can reject stale updates, and only *active* items are injected after compression. |
| `tools/threat_patterns.py` | The shared threat-pattern library with cumulative scopes (`all` / `context` / `strict`) and a constrained pattern vocabulary. |
| `tools/fal_common.py` | Shared fal.ai request helpers. |

#### Voice, audio, transcription, TTS, wake word cluster

| File | What it is / what it pins |
| --- | --- |
| `tools/voice_mode.py` | Voice mode (71 KB) — the full loop. |
| `tools/voice_mode_transcript.py` | The transcript surface for voice mode. |
| `tools/voice_live.py` | The live voice session. |
| `tools/voice_client_config.py` | Voice client configuration. |
| `tools/wake_word.py` | Wake-word detection (42 KB). |
| `tools/wake_word_engines.py` | The pluggable wake-word engines. |
| `tools/transcription_tools.py` | The transcription facade (32 KB). |
| `tools/transcription_audio.py` | Audio preprocessing: ffmpeg m4a encode, source/size validation, WeChat `.silk` decoding. |
| `tools/transcription_chunking.py` | Splits audio into upload-sized chunks. |
| `tools/transcription_cloud.py` | Cloud STT. |
| `tools/transcription_command.py` | Command-driven STT (a local binary). |
| `tools/transcription_common.py` | Shared STT helpers. |
| `tools/transcription_local.py` | Local STT. |
| `tools/transcription_streaming.py` | Streaming STT. |
| `tools/transcription_whisper_cpp.py` | The whisper.cpp STT backend. |
| `tools/stt_lease.py` | The STT lease: only one holder may hold the model, so the bill is paid while the user is talking. |
| `tools/tts_tool.py` | The TTS facade (35 KB). |
| `tools/tts_tool_delivery.py` | Where TTS output is delivered. |
| `tools/tts_tool_lifecycle.py` | The TTS lifecycle. |
| `tools/tts_tool_local.py` | Local TTS. |
| `tools/tts_tool_openai.py` | The OpenAI-compatible TTS client (reads `X-Audio-Sample-Rate`). |
| `tools/tts_tool_plugins.py` | Plugin TTS providers. |
| `tools/tts_tool_providers.py` | The provider registry (31 KB). |
| `tools/tts_tool_speaker.py` | The speaker output path. |
| `tools/tts_command_provider.py` | Command-type TTS providers. |
| `tools/tts_streaming.py` | Streaming TTS: sentence chunker → int16 mono PCM, with a per-sentence byte cap against a runaway upstream. |
| `tools/tts_text_normalize.py` | Text normalization for speech. |
| `tools/neutts_synth.py` | The NeuTTS local synthesizer. |
| `tools/neutts_samples/jo.txt` | The transcript of the bundled `jo.wav` sample — a 263-byte reference the local synthesizer's tests can compare against. |
| `tools/wakewords/README.md` | The wake-word model card: which model file is shipped, how it is loaded, and what it does. |
| `tools/audio_container.py` | Audio container probing. |

### 1.4 Tier 3 — skipped with a reason

| File | Why it was not read line by line |
| --- | --- |
| `tools/bot_desktop/wallpaper.png` | Binary PNG asset, 2 475 bytes; confirmed on disk, not opened. |
| `tools/neutts_samples/jo.wav` | Binary WAV audio sample, 575 990 bytes; confirmed on disk, not opened. |
| `tools/wakewords/hey_hermes.tflite` | Binary TensorFlow Lite wake-word model, 206 764 bytes; confirmed on disk, not opened. |

Two further non-`source` files were read as text: `tools/AGENTS.md` (the tool-layer contract
— "decides" the Footprint Ladder and the discovery rule) and `tools/wakewords/README.md`
(1 286 bytes, the wake-word model card). `tools/neutts_samples/jo.txt` (263 bytes) is the
sample's transcript; it was opened with the batch and is trivial.

---

## 2. Ideas worth stealing

1. **The denial breaker — a model-behaviour circuit breaker, not a rate limiter.**
   `_record_denial` counts *consecutive* guardian denials and, past a threshold, appends
   escalated hard-stop text to the next prompt (`tools/approval.py:80`, `:97`).
   *Why it transfers:* August Trading's proposal gates have exactly the same failure mode
   — a model that keeps proposing an invalid plan and getting refused will keep trying.
   A refusal that teaches is worth more than a refusal that repeats.
   `UNIQUE` (in this shard).

2. **One claimed-run body, three entry points.** The scheduler, a manual run, and an
   external event all fire through the *same* `_execute_job_now` body, so at-most-once
   claiming, in-flight dedupe, delivery and `[SILENT]` handling are identical
   (`tools/cronjob_tools.py`, `execute_job_for_event`).
   *Why it transfers:* a scheduled scan in August Trading (entry/TP/SL detection) will
   eventually get a manual "run it now" button and a webhook. Building them on one body
   from day one is much cheaper than reconciling three.
   `CONVERGENT` — the same "one path" instinct appears in `tools/approval_gateway_wait.py`
   and `tools/process_registry_wait_policy.py`.

3. **A stale-claim reaper that reaps rows, not processes.** A dead one-shot runner leaves
   an execution row `claimed`, which would block every later run; the reaper reaps rows
   whose owner is *provably dead* (PID gone, or PID reused per its start time) and also
   reaps a live owner's row once the claim exceeds the stale bound — without killing the
   process (`tools/cronjob_tools.py`, `_reap_stale_executions`).
   *Why it transfers:* a trading bot that polls for TP/SL hits will be killed, restarted
   and re-killed; a stuck "running" row that blocks the next scan is the classic
   trading-bot failure. `CONVERGENT` (same pattern in `tools/process_registry.py`).

4. **The wait-policy promotion.** After N consecutive no-output `wait`/`poll` results the
   session is promoted to `notify_on_complete` and the model is told to *stop checking*;
   the exit arrives as a message instead (`tools/process_registry_wait_policy.py:61`,
   `:117`, `:150`). The promotion only happens where a completion can actually reach that
   agent — one-shot runners, cron, kanban workers, delegated subagents.
   *Why it transfers:* "the model polls a running backtest every 30 seconds" is a real
   cost in August Trading. The interesting part is the *reachability test*: the policy is
   disabled wherever nobody would hear the news. `UNIQUE`.

5. **Human wait measured at the source, not at the gate.** Only time *verifiably blocked
   on a human* is excluded from a batch deadline; residency in the authorization gate is
   not, because a wedged plugin would grow the exclusion 1:1 with wall clock
   (`tools/approval_human_wait.py:1-16`, `human_wait_ceiling` `:45`).
   *Why it transfers:* August Trading's "ask the trader to confirm this plan" flow has the
   same hazard. `UNIQUE`.

6. **The YOLO toggle as a *contract*, not an implementation.** The bypass itself is
   in-memory per key; each surface persists it where its session identity lives and hands
   in a `persist(enabled)` writer; everything else is decided in one module
   (`tools/approval_yolo.py:1-9`). It also *transfers* across a compression rotation or
   `/branch` (`transfer_session_yolo`, `:93`).
   *Why it transfers:* August Trading has several surfaces (chat, panel, automation,
   bot seats) and a "skip confirmation" toggle. One contract, four persistence sites. `UNIQUE`.

7. **The sibling-write reminder.** A child agent warns its parent when it wrote files the
   parent had *already read* — and the check covers writes by any non-parent task, so a
   *sibling's* write invalidates the parent's read
   (`tools/delegate_tool_child_run.py:971`).
   *Why it transfers:* August Trading's parallel agents (Agents desk, bot roster) share
   the trade journal and the notebook. Today a stale read is invisible; this is a
   one-line guard that makes it visible. `UNIQUE`.

8. **Threat scopes that widen with the consequence of the write.** `all` everywhere;
   `context` adds promptware/C2/role-hijack at *warn* level for scraped content; `strict`
   adds aggressive checks only for user-mediated writes where a block is resolvable
   (`tools/threat_patterns.py:1-9`). And the pattern library constrains its own
   vocabulary: patterns must anchor on C2 vocabulary, not on bossy English, because "you
   must" is common in a legitimate `AGENTS.md`.
   *Why it transfers:* August Trading ingests AI-generated and web-scraped text. Warn on
   scraped content; block on user-mediated writes. `CONVERGENT`.

9. **The tool-call bridge is a first-class transcript citizen.** Because a deferred tool
   is reached through `tool_call`, the todo tool's transcript detection must peel the
   bridge name out of the *recorded* arguments (`tools/todo_tool.py:150-176`).
   *Why it transfers:* August Trading's desk tools and the Agents pane both need to know
   which tool a row really was, not what it was called. `UNIQUE`.

10. **The Footprint Ladder.** "Most capabilities should NOT be core tools"
    (`tools/AGENTS.md:3`) — a written policy that most capabilities are *plugins or
    deferred tools*, and only a small set is core. Combined with the import-time
    discovery registry, adding a capability does not mean editing a manifest.
    *Why it transfers:* August Trading's tool count is the thing most likely to rot the
    app. A written ladder plus a registry that discovers by import is a way to keep
    core small. `UNIQUE`.

11. **Only-active items survive compaction.** A revisioned todo list re-injects only
    `pending`/`in_progress` items after a compression, and keeps a parent when any
    descendant is active — because finished items make the model redo work
    (`tools/todo_tool.py:107-140`).
    *Why it transfers:* August Trading's `utils/contextWindow.ts` compaction has the same
    obligation. Re-injecting finished work is a silent way to burn a turn. `CONVERGENT`.

12. **A `read` that must fail closed.** If the thread-local approval callback cannot be
    installed in a worker thread, the callbacks stay `None` and dangerous commands are
    *denied* — the alternative (silently approving) is a CVE
    (`tools/thread_context.py:1-10`, `:36`).
    *Why it transfers:* any August Trading code that moves work onto a worker thread
    inherits this. `UNIQUE`.

---

## 3. Trading-specific findings

### 3.1 Long-lived monitoring and scheduled work — **yes, in this shard**

`tools/cronjob_tools.py` + `cronjob_job_args.py` + `cronjob_prompt_scan.py` are the
reference's scheduled-work subsystem, and they answer the brief's reliability questions
directly:

- **Persistence:** a cron job's output is written to a `.md` file under the job's output
  dir; `_latest_job_output_excerpt` returns a bounded excerpt plus a pointer, so the
  parent sees what the job produced without the bytes.
- **Recovery on restart:** `_reap_stale_executions` reaps rows stranded by a dead owner.
- **Idempotency / at-most-once:** the run is *claimed* before dispatch; an in-flight
  dedupe stops a second claim; `execute_job_for_event` reuses the exact same claimed-run
  body so the event path cannot drift from the scheduler path.
- **A breaker after repeated empty runs:** not in the cron module — the closest
  equivalent in this shard is the *denial breaker* (`tools/approval.py:80`), which trips
  after 3 consecutive denials. **August Trading's automation-approval breaker is the
  thing to port.**
- **Prompt safety for unattended runs:** `cronjob_prompt_scan.py` scans a stored job
  prompt for injection patterns before it runs without a human present.
- **Delivery is one-way and addressed:** `deliver` = `local` (save only) / `all` /
  `bot-chat[:profile]` / `platform:chat_id:thread_id`; the job itself always runs in a
  **fresh session with no chat context** (`tools/cronjob_tools.py`, `CRONJOB_SCHEMA`).
  *This is the right shape for a TP/SL watcher: the job sees only what its prompt gives it.*

**Not in this shard:** the actual cron *scheduler* and the execution ledger live under
`cron/` (a different shard). This shard owns the tool surface, the claim/reap logic and
the schema.

### 3.2 Human-in-the-loop approval — **yes, this is the strongest part of the shard**

The eight-file approval cluster is a mature answer. The pieces worth naming:

- **The approval record.** `submit_pending` (`tools/approval.py:247`) stores the pending
  request per session; `list_gateway_approvals` (`:196`) returns *replay-safe snapshots*
  so a reconnecting client can restore a prompt; `get_pending_gateway_approval` (`:235`)
  returns the oldest unresolved request.
- **The audit trail that survives a decision.** `register_gateway_settle` (`:202`) attaches
  a `settle(reason)` callback that runs **once** when the wait ends by *any* path — and
  the reason is a vocabulary, not a string: `resolved` (a choice committed from another
  surface), `session_closed` (the entry was withdrawn), `timeout`, `notify_failed`,
  `interrupted`. The same vocabulary is used in `tools/approval_gateway_wait.py`.
- **Observers that never see the secret.** `tools/human_input_hooks.py` fires
  `on_human_input_request` / `on_human_input_resolved` with a `request_id`, an `outcome`
  and a **force-redacted** prompt; the payload never carries what the human typed, and a
  failing plugin can never break the prompt.
- **The audit of *who approved what*.** `approve_session` (`:253`) approves a
  `pattern_key` for the session only — the scope of an approval is the *pattern*, not
  the occurrence.
- **The LLM reviewer that is allowed to abstain.** `tools/approval_smart.py:88` returns
  `'approve' | 'deny' | 'escalate'`; "uncertain" is a first-class answer, not a coin flip.

**What is missing for August Trading:** there is no *durable* approval log in this
shard — the pending queue is in-memory per process, and only the `settle` reason
survives. A trading app that writes a "the human approved plan X at time T" record to
its journal would be ahead of the reference here.

### 3.3 Post-mortem / reflection loops — **partially, in this shard**

The skill lifecycle is the reference's answer to "stop bad rules from accumulating":
a sidecar usage ledger (`tools/skill_usage.py`) tracks use/view/patch; `latest_activity_at`
(`:123`) **excludes `created_at`** so a never-active skill stays distinguishable; the
lifecycle is `active → stale → archived` (moved to `.archive/`) with `pinned` as an
*orthogonal* opt-out, not a fourth state; bundled and hub-installed skills are
auto-disabled but protected (`_read_bundled_names` `:147`, `_read_hub_installed_names`
`:155`, `is_protected_builtin` `:43`); and curator management requires an explicit
`created_by: agent` marker — **never inferred from the file's location**
(`tools/skill_provenance.py:1-9`).

**Not in this shard:** the reflection *fork* that proposes new rules lives in the agent
package. What this shard contributes is the *retirement* half of the loop: an explicit
usage ledger and an archive path.

### 3.4 Multi-agent — **subagents, and debate is absent**

There is no debate engine in this shard. The multi-agent story is
`delegate_tool` → one child, `MAX_DEPTH = 1` by default
(`tools/delegate_tool_config.py:21`), concurrency-capped, optionally worktree-isolated,
with a live progress log, redacted output, and a structured result. Where is a second
opinion worth it? The reference's own answer is visible in the *configuration*: a child
is a *worker*, and the knobs that make it more than a worker are all off by default —
`independent_completions` (split a background call into per-task completions, `:110`),
`worktree_isolation` (`:115`), `inherit_mcp_toolsets` (`:175`), `max_spawn_depth` (`:151`).
The `orchestrator_enabled` kill switch (`:165`) forces every child to a leaf.

**August Trading implication:** the reference treats "run two agents and reconcile" as an
*opt-in capability with a cost model*, not a default. A debate engine would need a
justification the reference does not supply.

### 3.5 Structured logs the model can query — **yes, without a heavy database**

- `tools/kanban_tools.py` — a structured work board over `kanban.db`, exposed as *tools*
  rather than shell-outs so it works from a container backend and returns structured-JSON
  failures.
- `tools/session_search_tool.py` (44 KB) — the transcript search surface; this is the
  reference's "trade log".
- `tools/checkpoint_manager.py` (69 KB) + `checkpoint_maintenance.py` +
  `checkpoint_pruning.py` — checkpointed, prunable state.
- `tools/skill_usage.py` — a JSON sidecar ledger, written atomically under a
  cross-process lock.
- `tools/delegation_live_log.py` — a live, queryable log of delegated work.
- `tools/process_registry_output_log.py` + `process_registry_results.py` — per-process
  output and result records.

The pattern is consistent: **one file per record, or a small SQLite DB per domain, and a
tool surface over it** — never a bespoke store. `tools/file_tools_read_tracking.py` is
the same idea at the smallest scale (per-task read stamps in memory).

### 3.6 Staying simple as features accumulate — **partially**

The reference does not stay simple; it *documents* the pressure and answers it with
mechanism rather than with restraint:

- The Footprint Ladder (`tools/AGENTS.md:3`) keeps the **core** tool set small and pushes
  the rest out.
- Import-time discovery means a new tool is one file, but also that the tree is large
  and the `tools/` package is 7.1 MB.
- The 21-file MCP cluster, the 24-file skills cluster and the 26-file media cluster are
  what "features accumulate" looks like when each is answered with a full sub-package.
- The one genuine simplicity lever is the **extraction pattern**: `browser_tool.py` is a
  facade over `browser_tool_*`; `mcp_tool.py` over `mcp_tool_*`; `file_tools.py` over
  `file_tools_*`; `delegate_tool.py` over `delegate_tool_*`. Each extraction names the
  facade as the owner of shared state and every sibling reads facade-owned state back
  through it (e.g. `tools/browser_tool_vision.py:1-3`: *"Facade-owned state is read
  through `_bt` ... resolved per call"*). That is a real, learnable rule — but it is
  complexity *management*, not complexity *reduction*.

---

## 4. Non-obvious decisions and gotchas

1. **A `write` in one module is a `read` in another.** `tools/file_state.py` has two
   separate maps: `known_reads(task_id)` (`:192`) and `writes_since(...)` (`:244`).
   Staleness is computed from *both* — `check_stale(task_id, path)` (`:236`) compares the
   read stamp against writes by **other** tasks, and `writes_since` takes an
   `exclude_task_id` because a task's own write does not invalidate its own read.
2. **Tool results are stored, not returned.** `tools/tool_result_storage.py` exists
   because a tool that returns 2 MB of text will evict the conversation. The result
   becomes a handle. August Trading's `Message.toolEvents`/payload-id design is the
   same idea.
3. **`select` is a lie above `FD_SETSIZE`.** `tools/environments/fd_wait.py:1-13`:
   `select.select()` raises `ValueError: filedescriptor out of range in select()` once an
   fd reaches 1024; a long-lived gateway holds that many. `selectors.DefaultSelector`
   (epoll/kqueue) has no ceiling. But `poll()` is *not* the default: macOS `poll()` does
   not support device fds and reports a PTY master as `POLLNVAL` — "ready" at once — so a
   PTY read loop would spin a core. It stays the fallback because it needs no fd of its
   own.
4. **`O_EXCL` on Windows is enough; on POSIX you also need `O_NOFOLLOW`.**
   `tools/spill_safety.py` uses `O_CREAT|O_EXCL|_O_NOFOLLOW` where `_O_NOFOLLOW` is
   `getattr(os, "O_NOFOLLOW", 0)` — the module comment states the reason explicitly:
   *"on Windows O_EXCL alone already refuses every pre-existing path."* The overwrite
   path is `lstat` → `unlink` → exclusive create, so the pair cannot be raced and the
   *link* is removed, never its target.
5. **The `delete` path of a patch produces a real unified diff of the removed content**
   (`tools/patch_parser.py`, `_apply_delete`), and the `move` path **re-checks the
   destination** because validation's answer is stale once earlier ops in the same patch
   have run.
6. **The tool registry's `emoji` is a first-class property** (`tools/tool_labels.py`,
   `_registry_emoji`): the label layer asks the registry for the tool's own mark, so a
   tool's mark is defined once.
7. **A `for` loop over `selected` is not a "search".** `tools/connectors/search.py`
   reuses the *tool-search catalog's* tokenizer (`from tools.tool_search_catalog import
   CatalogEntry, _fn, _tokenize`) — one tokenizer for every search surface in the
   product.
8. **The MCP wire layer is a leaf and no model escapes it.**
   `tools/connectors/gateway/__init__.py:7-12` states the layering rules as law:
   `wire.py` holds pydantic v2 models and route paths; **no pydantic model may escape the
   wire/client layer** — everything above sees plain dicts and frozen dataclasses;
   `errors.py` is stdlib-only and is the single producer of the connection-required
   payload shown to the model.
9. **A redaction failure returns the empty string, never the raw text.**
   `tools/human_input_hooks.py:_redacted` — on exception it returns `""` and logs at
   DEBUG: *"never fall back to the raw text."*
10. **The default browser path is the CLI, and the fallback is announced.**
    `tools/browser_use_cli.py` — Browser Use CLI mode is the DEFAULT; `default_downgrade_notice()`
    (`:274`) returns a one-line notice when the backend is unset but the CLI is not
    runnable, so the session's downgrade is *visible* rather than silent.
11. **The model must not be told a tool exists when it is off.** `tools/tour_tool.py:154`
    `check_tours_enabled()` — a tour covers the whole screen, so "off" must mean the model
    is never told the tool exists, rather than being offered a call that fails.
12. **A tool that is a whole package registers from exactly one file.**
    `tools/AGENTS.md:12-14` — `tools/<pkg>/tool.py` is the only file discovery scans
    inside a package. And `tools/tour_presets.py:1-6` is the counter-example that proves
    the rule matters: it is a leaf module with **no** `registry.register`, because the
    wire contract imports the enum and importing the real tool module there would
    register `gui_tour` as a side effect.
13. **`select` the backend by *config*, not by availability.** `tools/web_tools.py:100`
    `_get_backend()` — *"A stored `web.backend` is returned as-is — no availability
    probe, no fallback."* A configured backend that fails fails visibly; only an
    *unset* backend autodetects. This is a deliberate refusal of silent degradation.
14. **The MCP handshake has a documented "server is stateless-only" verdict.**
    `tools/mcp_tool_errors.py:30` `_handshake_rejected_as_modern` — a failed
    `initialize` that signals a stateless-only server is *not* a generic failure, and
    `:38` distinguishes "initialize succeeded on the wire but the SDK refused the
    version" from "initialize failed".

---

## 5. Weak spots

1. **The scale is the product.** 371 files, 7.1 MB, for one tool layer. The MCP client
   alone is 21 files and 500 KB, the skills stack 24 files and 600 KB. The extraction
   discipline is good, but the *result* is a codebase where a change to "how a tool
   result is shaped" touches a dozen modules. August Trading should take the
   *extraction rule*, not the *file count*.
2. **The approval state is in-memory per process.** The pending queue, the denial
   breaker and the YOLO bypass all live in process memory; the "persisted" half of YOLO
   is delegated to each surface. A gateway restart loses every pending approval and
   every denial tally, and the denial breaker therefore resets — which is exactly the
   case where a misbehaving model would try again. A trading app's approval gate must
   survive a restart.
3. **The human-wait accounting is a heuristic under adversarial conditions.**
   `tools/approval_human_wait.py` measures "verifiably blocked on a human" by *where* the
   wait happens. A plugin that blocks inside the gate for its own reasons is excluded
   from the deadline, which is the exact failure the module's own docstring claims to
   prevent. The mitigation is a ceiling (`approvals.timeout + 60s`), but the ceiling is
   per-window, so a plugin that opens a fresh window repeatedly still grows the
   exclusion.
4. **The threat-pattern library is regex over prose.** `tools/threat_patterns.py`
   explicitly refuses to match on "bossy English" — a good call — but the consequence is
   that it catches C2 vocabulary and unambiguous attack behaviour and nothing else. The
   `context` scope is *warn*-only by design, so a scraped page that contains a
   prompt-injection payload in natural language passes with a warning nobody may read.
5. **`MAX_TODO_ITEMS = 256` and `MAX_TODO_CONTENT_CHARS = 4000` are magic numbers with a
   comment, not a budget.** The comment explains *why* the cap exists (the list is
   re-read after every compression) but there is no accounting of how many items a real
   multi-step plan needs, and the truncation marker `… [truncated]` can land mid-idea
   with no way to tell a truncated item from a short one.
