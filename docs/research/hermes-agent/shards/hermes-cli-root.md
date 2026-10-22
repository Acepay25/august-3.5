# hermes-agent :: hermes-cli-root

**Files in shard:** 766 (read: 766, skipped with reason: 0)
**What this shard covers:** The entire `hermes_cli/` package of the Hermes Agent repository — the Python command-line/TUI/gateway front-end, and the single largest subsystem in the repo. It is organised as a very large, very flat module bag: ~470 `hermes_cli/*.py` modules plus `hermes_cli/dashboard_auth/`, `hermes_cli/local_runtime/`, `hermes_cli/observability/`, `hermes_cli/proxy/`, `hermes_cli/web_routers/`, and `hermes_cli/subcommands/`. This shard contains the scheduled-work engine (`cron`, `heartbeat`, `loops`, `goals`), the human-approval machinery, the memory/compaction and prompt-budget code, the multi-agent kanban board, the gateway session/runtime layer, the configuration and model-routing layer, the observability/metrics layer, and the whole web dashboard server. The agent loop itself is *outside* this shard (it lives in `agent/`, `gateway/`, `cron/`), so what is here is Hermes's **operational** behaviour: how work is scheduled, gated, measured, persisted, recovered, and presented.

**Reading method (important for the ledger):** every one of the 766 files was opened and read. For the ~60 load-bearing files below, the read was a full or near-full read (head+tail for the giants). For the remainder — which are overwhelmingly CLI plumbing, argparse trees, platform backends and updater stages — the read was a *structural* read: the module docstring, every top-level `def`/`class` with its own docstring line, the module's line count, and a targeted head/tail on the load-bearing parts. That structural read is what the one-line Tier-2 table rows are derived from. Nothing in the table is a guess from the filename.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entries

### `hermes_cli/AGENTS.md`
- **Purpose:** The package's own developer contract. It states, in the repo's own words, the architectural rules that the rest of this shard implements.
- **Key decisions it pins:** (1) `cli.py` holds `HermesCLI` and everything else is a *mixin*; **"There is no `elif` ladder — do not add one."** (2) `COMMAND_REGISTRY` in `hermes_cli/commands.py` is the single source for slash commands; every surface (CLI dispatch, gateway, Telegram menu, Slack map, autocomplete, help) derives from it, and adding an alias updates all of them for free. (3) **Three config loaders** — `load_cli_config()`, `load_config()`, `load_user_config_effective()` — and the rule "if the CLI sees a key and the gateway doesn't, you're on the wrong loader". (4) `.env` is **secrets only**; non-secret settings go in `config.yaml`. (5) One writer seam: every `config.yaml` write goes through `atomic_config_write`/`atomic_config_replace`, and a CI lint rejects `yaml.dump` on a config path. (6) **"Every `DEFAULT_CONFIG` key has a runtime reader, and every reader a registry entry"** — both drift modes are silent, so a new key needs a `rg` in two places plus an invariant test. (7) Skill slash commands are injected as a **user message, never into the system prompt** (prompt caching). (8) The update pipeline is `plan → snapshot → apply → restart-per-kind → verify → report`, and post-commit failures are *owed follow-ups* that exit 0. (9) `update_handoff.py` / `update_serve_obligations.py` are a **frozen compat surface** — removing a name bricks releases mid-update. (10) Profiles are independent islands; a *marker-less* profile dir is never served, ticked or resolvable.
- **Why it transfers:** This is the clearest statement anywhere in the three reference repos of how to keep a large surface from turning into a feature pile: **one registry, three loaders, one writer, and a lint that rejects the wrong writer.**

### `hermes_cli/goals.py` (1,539 lines)
- **Purpose:** "Persistent session goals — the Ralph loop for Hermes." A free-form objective stays active across turns; after each turn an auxiliary-model *judge* decides whether it is satisfied.
- **Key abstractions:** `GoalState` (persisted), `GoalContract` (five optional fields: outcome / verification / constraints / boundaries / stop_when), `GoalGate` (a deterministic shell command that must pass before DONE is allowed), `GoalManager`.
- **Data flow:** turn ends → `evaluate_after_turn(last_response)` → judge prompt built from one of four templates → judge returns a one-line JSON verdict (`done` / `blocked` / `continue` / `wait`) → the verdict becomes either a continuation prompt appended **as a normal user message** or a pause.
- **Non-obvious decisions:** (a) The continuation prompt is a *user message*, never a system-prompt mutation — "no system-prompt mutation or toolset swap, so prompt caching stays intact." (b) Judge failures are **fail-open** (`continue`), with the turn budget as the backstop. (c) But *parse* failures and *transport* failures are counted separately: 3 consecutive unparseable verdicts auto-pause and point at the judge config; 5 consecutive transport failures auto-pause and point at the provider/key. A broken judge cannot burn the whole budget. (d) The judge output budget is 4,096 tokens, not 200 — reasoning models burn hidden tokens before the visible JSON and a 200-token cap reliably truncated the verdict and tripped the auto-pause. (e) The judge sees only the **last 4,000 characters** of the response. (f) `wait` is a first-class verdict with three shapes (`wait_on_session`, `wait_on_pid`, `wait_for_seconds`) so a blocked-on-async loop parks instead of burning turns.
- **Edge cases:** a gate that fails short-circuits the judge entirely and its bounded 3,000-char output tail becomes the continuation prompt; a gate whose workspace no longer exists is a *refusal* (running it elsewhere would check a different project); the kanban variant treats `wait` as `continue` and blocks rather than parking.
- **Surprising:** `run_kanban_goal_loop` at the file's end is a *second, smaller* Ralph loop for kanban workers, and it treats "judge says done but the worker never called `kanban_complete`" as a **block**, not a success.

### `hermes_cli/loops.py` (611 lines)
- **Purpose:** `/loop` — recurring in-session wakeups (Claude Code parity). A fixed interval or a *self-paced* mode that starts at a floor, doubles while the reply is unchanged, and snaps back on any change.
- **Key abstractions:** `LoopState` (status / mode / interval / current_delay / times / until / max_ticks / ticks_fired / `awaiting_response` / `last_response_digest` / route), `LoopManager`.
- **Data flow:** state lives in `SessionDB.state_meta` under the key `loop:<session_id>`; a driver polls `is_due()`, injects the wakeup prompt, and marks `awaiting_response` so a tick cannot double-fire mid-turn.
- **Non-obvious decisions:** (a) The completion sentinel is a **line the agent writes** (`LOOP_COMPLETE` on its own line), not a schema field — a model can emit it. (b) The 30-second floor is a *deliberate* anti-busy-loop, commented as "Claude Code allows 30s; anything tighter is almost always an accident that burns tokens polling unchanged state." (c) `awaiting_response` is a two-phase latch: it stops a tick from firing twice and tells the post-turn hook that the turn that just ended was the loop's. (d) Self-paced mode hashes the response (`last_response_digest`) to decide "unchanged".
- **Edge cases:** a corrupt stored state is a warning, not a crash; `list_active_loops()` returns `[]` on any DB error; `store_has_active_loop` returns **True** for an unparseable row ("unknown, so the caller keeps its full sweep") and **propagates** read errors, so an idle gate can tell "empty" from "unavailable".
- **Surprising:** the state manager reuses `goals.py`'s cached SessionDB — the previous copy here booted its own, "which froze the loop for the init duration and dropped the first `loop:*` write (the /goal bug class, #88965)."

### `hermes_cli/heartbeat.py` (228 lines)
- **Purpose:** Session heartbeats — recurring re-entry prompts for the *current* session. Explicitly session-scoped and in-process: "durable cross-process scheduling stays `hermes cron`."
- **Key abstractions:** `HeartbeatState` (prompt / interval / status / created / last_fired / fire_count), `HeartbeatManager`.
- **Non-obvious decisions:** the heartbeat prompt explicitly instructs the model: *"If there is nothing meaningful to do or report for this instruction right now, reply briefly that nothing has changed and stop — **do not invent work**."* That single line is the difference between a monitoring loop and a hallucination generator. The 60-second floor is called out as "a busy-loop, not a heartbeat." The `status` field is `active | paused | cleared`, and `clear`/`pause` **keep their rows** — so key existence alone is not "active".
- **Edge cases:** `store_has_active_heartbeat` treats an *unparseable* row as active (fail-safe) and lets read errors propagate; a dropped write calls `_warn_dropped_write` rather than vanishing.

### `hermes_cli/cron.py` (879 lines)
- **Purpose:** The `hermes cron` CLI: list / status / doctor / tick / runs / incidents / notepad / create / edit / pause / resume / run / remove.
- **Key abstractions:** the subcommand table `_CRON_SUBCOMMANDS`; `cron_doctor()`; `_cron_doctor_issues_for_job()`; `_job_action()`.
- **Non-obvious decisions (all directly transferable):**
  - **A 15-minute overdue grace** (`_OVERDUE_GRACE_SECONDS`): "A busy tick can push dispatch a few minutes late; only a `next_run_at` parked well in the past means the job is silently not firing." The *same* grace is shared by `cron status`, `cron list` and `cron doctor` "so status, list, and doctor tell one consistent story about when a job counts as overdue."
  - **Delivery failure is separate from execution failure.** `last_status == "delivery_failed"` means *the agent run succeeded* and only the delivery broke; the doctor says so in those words.
  - **`last_delivery_unverified`** is its own issue: "adapter acked without evidence."
  - **Lateness is measured, not inferred.** A `last_dispatch` record with `kind` in `late`/`catch_up` produces a warning that "clears at the next on-time fire" — so a job does not look broken forever after one bad night.
  - **`_missed_fire_issue`** uses `last_fire_error` because "the handoff error survives `next_run_at` advancing beyond the failed dispatch."
  - **Script paths are containment-checked** against `~/.hermes/scripts` — a script resolving outside is a doctor issue.
- **Edge cases:** `cron run` in a one-shot CLI forces a **synchronous** run by setting `_SESSION_ASYNC_DELIVERY` to False for the duration, because a background dispatch would be orphaned mid-LLM-call and leave the execution row stuck `claimed`. `cron run` also reports the *dispatch* rather than a verdict when the run went to the background.

### `hermes_cli/subcommands/cron.py` (184 lines)
- **Purpose:** The argparse tree for `hermes cron`. This file is effectively the *specification* of the scheduled-job model.
- **What it pins:** `--no-agent` (skip the LLM entirely — "the classic watchdog pattern (memory alerts, disk alerts, CI pings)"); `--monitor-script` / `--monitor-url` (**a cheap source runs each tick; unchanged output (exact-bytes hash) suppresses the agent run entirely**, changed output injects a "MONITOR CHANGE DETECTED" diff into the prompt, and the script's output "must be stable (no timestamps)"); `--continuity` (each run wakes with the job's own previous output injected, so it can dedupe and continue); `--workdir` (injects `AGENTS.md`/`CLAUDE.md`/`.cursorrules` and sets the tool cwd); `--model` / `--pin` / `--provider` / `--reasoning-effort` (a job may be pinned to a model, and `--pin` locks the *current* model so a later `hermes model` change never touches the job); `--interpreter` (a script may run under the user's own venv); `--failure-deliver` (failures can go elsewhere, or be suppressed with `local`); `--paused` + `--paused-reason` ("Auditable reason; requires `--paused`"); and the `notepad` subcommand — a **per-job durable KV** the running agent can update via its terminal tool, injected into the next run's prompt.
- **Why it transfers:** The monitor-hash-suppression idea and the per-job notepad are the two most directly stealable things in this shard for a trading app.

### `hermes_cli/gateway_automation.py` (211 lines)
- **Purpose:** The CLI's `/goal`, `/subgoal`, `/loop` and `/heartbeat` managers, now **backed by the gateway session** rather than the CLI process.
- **Key abstraction:** `_Remote` — a shared plumbing base whose `_rpc` calls `session.automation` on the gateway; `GatewayGoalManager`, `GatewayLoopManager`, `GatewayHeartbeatManager` each declare `kind` and a `_state_cls`.
- **The non-obvious trick:** the local managers' *pure read* methods (`is_active`, `status_line`, `render_gates`, `next_continuation_prompt`, `is_due`) are **re-bound onto the remote object** via `from hermes_cli.goals import GoalManager as _Local; is_active = _Local.is_active`. The gateway becomes the single writer and the judge runner; the CLI keeps its own rendering code unchanged, running against a mirrored state object.
- **Edge cases:** a dropped write is swallowed to a debug log ("Main's managers swallowed a dropped write (debug log, no crash); the REPL stays up"); a gateway that does not answer yields a `{"status": None, "should_continue": False, ...}` decision with `reason: "gateway unavailable"` rather than an exception; `due_prompt` does the *cheap local* `is_due` check first so an idle poll costs no round trip.

### `hermes_cli/approval_mode.py` (53 lines)
- **Purpose:** The persistent, profile-scoped approval mode: `manual | smart | off`.
- **Key decision:** changing the mode must **not** rebuild a live agent or mutate its system prompt / tool schema — "preserving the prompt-cache prefix." The guard reads the effective mode on *every* check instead.
- **Edge cases:** `set_config_value` reports managed policy through stderr + `SystemExit`, and the fail-closed write guard raises `RuntimeError` on an unparseable `config.yaml`; both are captured and turned into slash-command output rather than killing the interactive worker. After a write the command **re-reads the effective mode and reports failure if the requested value did not become effective.**

### `hermes_cli/approval_transport.py` (153 lines)
- **Purpose:** The host-owned contract for plugin-provided human-approval transports. A transport presents an immutable, redacted request and returns a correlated decision. It does **not** participate in detection or authorization policy.
- **Key abstractions:** `ApprovalRequest` (frozen dataclass, `schema_version`, `request_id`, `digest`, command, description, pattern keys, surface, timeout, allowed choices), `ApprovalDecision` (request_id + digest + choice), `ApprovalTransportResult`, `RegisteredApprovalTransport`.
- **The security core:** the request's `digest` is a SHA-256 over a **canonical JSON** of every field *plus the session key*. A decision is only honoured if `value.request_id == rid` **and** `value.request_digest == request.digest`. A stale or mismatched decision is rejected as `"stale"`. This binds the human's answer to the exact request that was shown.
- **Fail-closed behaviour:** every failure is a **denial** — `"busy"` (the 8-slot `BoundedSemaphore` for transport workers is exhausted), `"timeout"` (the deadline passed), `"interrupted"`, `"error"`, `"invalid"` (wrong type or a choice not in `allowed_choices`). Async callbacks are awaited with `asyncio.run` on a *daemon worker thread*, never on the gateway or TUI event loop, and a late result past the deadline is discarded so it "cannot authorize another request."
- **Why it transfers:** This is the cleanest "human approval" contract in the three repos: an immutable, hashed, expiring request; a correlated answer; and *every* failure mode collapsed into a denial.

### `hermes_cli/approvals_suggest.py` (328 lines)
- **Purpose:** Mine past approval decisions into `command_allowlist` proposals. Note the framing in the module docstring: "Hermes has no dedicated approval-decision ledger … So this module mines **implied approvals**."
- **Data flow:** read `state.db` read-only (`file:…?mode=ro`), stream assistant `tool_calls` in 2,000-row batches, keep terminal calls whose result contains no BLOCK marker, classify with the *same* `detect_dangerous_command` that triggers the prompt, aggregate into globs, filter, rank, and only write with `--apply N,M`.
- **The safety asymmetry (a genuinely clever idea):** `_UNSAFE_CLASS_PATTERNS` + `_UNSAFE_ROOT_BINARIES` never propose a destructive class no matter how often it was approved — "a benign class accidentally excluded costs the user one manual config edit; a destructive class accidentally proposed costs them data." Compound commands (shell operators) get no glob; they are proposed under their *class key* instead, because the runtime allowlist matcher refuses compound commands anyway.
- **Edge cases:** redaction is applied to the *displayed* example but the glob is derived from the **raw** command, because "a redacted `***` inside a persisted pattern would be three fnmatch wildcards" — so if redaction touched the embedded tokens, the proposal falls back to the class key. Hardline-blocked commands are never mined at all, "defense in depth against stale DB rows."

### `hermes_cli/approvals_test.py` (123 lines)
- **Purpose:** A **dry-run** of the real approval verdict — "without running it, prompting anyone, or persisting anything."
- **What it pins (the ordering is the contract):** 1 container-skip gate → 2 hardline blocklist (never bypassable, fires before yolo/off) → 3 sudo-stdin guard (unconditional) → 4 user `approvals.deny` rules (fire before yolo/off) → 5 yolo / `approvals.mode: off` bypass → 6 permanent `command_allowlist` → 7 dangerous-pattern detection (would prompt).
- **Why it transfers:** The same ordered ladder, exposed as a *pure function* with distinct exit codes (0 allow / 2 ask / 3 deny), is exactly the shape a trading app wants for "what would the risk gate do with this order?" — plus the `normalized_variants` trace, which shows the de-obfuscated forms the detectors actually evaluated.

### `hermes_cli/write_approval_commands.py` (158 lines)
- **Purpose:** Shared handlers for the `/memory` and `/skills` **write-approval** subcommands — a staged-write queue the human approves or rejects.
- **Key decisions:** pending records carry an `origin` (`foreground` / `background_review`) and are shown as `[auto]`. On approve, the output distinguishes **replaced / patched / removed** entries and prints the *full text* of what was overwritten, because "a memory `replace` overwrites the WHOLE matched entry … the approver is the last person who can notice a clause went missing." A staged replace/remove is *pinned* to the exact entry it matched, and an unpinned legacy target is refused with "reject and recreate before approving."
- **Why it transfers:** The staged-write + "show me exactly what will be lost" pattern is directly applicable to a skill/rule/strategy write-approval flow.

### `hermes_cli/moa_config.py` (286 lines)
- **Purpose:** Mixture-of-Agents **configuration and slash-command helpers** — N reference "advisor" models plus one aggregator, as named presets.
- **Key decisions:** (a) **Three fan-out cadences:** `user_turn` (default — advisors run once per user turn, "the cheapest cadence"), `per_iteration` (every tool iteration, "so advice tracks live task state at the cost of multiplying advisor spend by tool-loop depth"), and `every_n:<N>` (the middle ground, where in-between iterations reuse the cached guidance). (b) **Recursion is refused at the config layer:** a slot whose provider is `moa` is rejected with "the Mixture of Agents provider cannot be used inside a preset (recursive MoA)" — and the check is duplicated in `_slot_problem` so the write-boundary validator and the tolerant runtime normalizer "can never disagree." (c) **Read-time tolerance vs write-time strictness:** `normalize_moa_config` degrades to defaults for a hand-edited config, but `validate_moa_payload` returns the list of problems that normalization "would silently paper over" and the write path rejects loudly — because "read-time tolerance is a corruption engine at write time." (d) `privacy_filter` has three modes (`''` / `display` / `full`) and a hand-edited boolean `true` maps to `full`, because the issue that introduced it framed the toggle as "redact before passing to the aggregator."
- **Why it transfers:** The "degrade on read, refuse on write" asymmetry and the "advisors run once per user turn by default" cadence are both directly applicable to a multi-model trading analysis (e.g. a bull/bear/critic panel that must not multiply cost per tool iteration).

### `hermes_cli/moa_cmd.py` (162 lines)
- **Purpose:** The CLI for configuring Mixture-of-Agents presets (list / configure / delete).
- **Key decisions:** (a) The **explicit cost warning** — the aggregator "is the acting model: it runs every tool-loop step, and almost all of the run's cost lands on its provider." `_provider_mismatch_notice` tells the user when the aggregator is on a different provider from the main model, because "the whole tool loop will be billed there, not to `main_provider`." (b) The slot picker only offers providers the user can *actually call* (`include_unconfigured=False`), "because including setup-only rows makes an unconfigured canonical provider (usually OpenRouter, due to catalog ordering) become the default." (c) The picker payload is built inside a worker thread with a *contextvar* profile scope rather than `_profile_scope`'s `RLock`, "because the payload build can block for 15s on a models.dev cache miss, and `_profile_scope`'s RLock held across that block starves concurrent `/api/config` and freezes the server (#58576)."

### `hermes_cli/kanban_swarm.py` (265 lines)
- **Purpose:** "Kanban Swarm v1: thin swarm topology helpers on top of Kanban. Deliberately **no second scheduler**."
- **The topology:** a planning root (completed immediately) → parallel specialist workers → a verifier (todo until all workers done) → a synthesizer (todo until the verifier done).
- **Key decision — the shared blackboard:** state lives in **structured JSON comments on the root task** (`[swarm:blackboard] {json}`), so "all state lives in existing `task_comments`/`task_events` rows and the dashboard, notifier, slash command and dispatcher keep working without a new service." `latest_blackboard` merges comments by key and records `_authors[key]` for traceability.
- **Edge cases:** the root's blocked→done flip is done **inline** inside the caller's transaction, because calling `kb.complete_task` would open its own transaction and run post-commit side effects "while the outer txn can still roll back"; `recompute_ready` runs only *after* the commit. Idempotency: if the root already exists, the topology is recovered from the blackboard rather than duplicated.
- **Why it transfers:** Multi-agent orchestration as a **task-graph in the existing store** with a blackboard, not a new service, is the most reusable idea in this shard.

### `hermes_cli/kanban_decompose.py` (288 lines)
- **Purpose:** Fan a rough triage task into a graph of child tasks via an auxiliary LLM.
- **Key decisions:** (a) The prompt asks for `parents` as **indices into the same list** — "Tasks with no parents run in PARALLEL. Tasks with parents wait until every parent completes." and "Prefer parallelism." It also caps at "2-6 tasks for normal work. Don't create 20 tiny tasks. Don't cram everything into 1 task." (b) Assignees are chosen by matching a profile's **description**, not its name. (c) **A child is never left unassigned** — an unknown assignee is rewritten to `default_assignee` and the rewrite is logged. (d) `fanout: false` collapses to a single tightened spec, making `decompose` a strict superset of `specify`. (e) The root's assignee is preferred over the *active* profile as orchestrator, because "that profile must never silently become the owner of work the card was assigned away from."
- **Edge cases:** malformed JSON, an empty task list, a non-int parent index, an out-of-range parent index and a self-parent are all dropped or refused; the root stays alive as the parent of every leaf so it "wakes back up when the graph completes."

### `hermes_cli/kanban_resume_guard.py` (59 lines)
- **Purpose:** The ONE place deciding whether a Kanban-owned worker transcript may resume as an ordinary write-capable session.
- **The reasoning:** a resumed worker transcript carries none of the dispatcher-granted ownership env (`HERMES_KANBAN_TASK` / `_RUN_ID` / `_BOARD` / `_CLAIM_LOCK`), "so the board cannot observe or supervise it — and unblocking the card can then dispatch a second writer into the same workspace."
- **Fail-open boundary (deliberate and documented):** a *probe error* fails open ("an ordinary session must never be blocked by a broken probe"), but a **positive** kanban-provenance match always refuses. A store that cannot classify at all (no `is_kanban_owned_session` method) is treated as unclassified and passes.
- **Why it transfers:** "A resumed automation transcript must not become an unsupervised second writer" is exactly the risk in a scheduled trading monitor that can be resumed by hand.

### `hermes_cli/partial_compress.py` (155 lines)
- **Purpose:** Boundary-aware partial compression — "summarize up to here".
- **Key decisions:** (a) The compressed head must end with a summary/handoff and the verbatim tail must **begin with a `user` message**, so the rejoined history keeps the user↔assistant alternation providers validate. Exchanges are counted by *user* messages to find the boundary. (b) The head compressor's output shape is not contractually guaranteed (a plugin engine could end on a user turn), so `rejoin_compressed_head_and_tail` defends the seam: if the last head message and first tail message share a role, the tail's first string content is folded onto the head's last message; non-string (multimodal) content gets a minimal bridging turn so nothing is lost. `tool` messages are left alone — consecutive tool entries are the one legal repetition. (c) `--preview` is a pure, side-effect-free report of exactly what the real run would do. (d) A degenerate split returns `(history, [])`, signalling the caller to fall back to full compression rather than "rotating the session for a no-op."
- **Why it transfers:** The seam-defending rejoin is directly applicable to any summarisation-plus-verbatim-tail scheme.

### `hermes_cli/prompt_size.py` (199 lines)
- **Purpose:** `hermes prompt-size` — a prompt-budget diagnostic that builds a **real** inspection agent (so the numbers match what ships on the wire) but makes **no network call** (dummy credentials force the direct-construction path).
- **What it produces:** system-prompt total; the three prompt tiers (`stable` / `context` / `volatile`) with byte counts; a per-skill breakdown of *always-on index cost* vs *on-disk SKILL.md read cost*; and a per-toolset breakdown of tool-schema JSON bytes, largest first.
- **Non-obvious:** the skills index lives in the **volatile** tier — "moved from stable so skill edits don't invalidate the cached identity prefix." Per-skill index bytes are apportioned exactly, including the shared prefix and separators of a compact `[names only]` line (divmod on the shared base), so the parts sum to the whole.
- **Why it transfers:** "What does each skill cost on every request, and what does each toolset cost?" is a report August Trading does not have and would find expensive to retrofit.

### `hermes_cli/mem_trim.py` (165 lines)
- **Purpose:** Rate-limited heap release for long-lived gateway processes (`malloc_trim(0)` on glibc, `gc.collect()` everywhere).
- **Key decisions:** a cooldown (default 60 s) and a **5-second floor even for forced trims**, because `AIAgent.close()` forces a trim and "delegate batches close N child subagents back-to-back in the SAME process — without a floor that stacks N+1 uncooled full `gc.collect()` passes (50-500ms each in a large gateway process)." The attempt is recorded *before* calling into libc so repeated failures do not turn every turn boundary into an expensive full collection. The config is read with a **read-only, no-deepcopy** loader, because "a full-config deepcopy per attempt is exactly the allocator garbage this module exists to release."
- **Why it transfers:** The "forced trim still honours a floor because a batch of closes stacks" observation applies to any long-lived Electron/Node main process in August Trading.

### `hermes_cli/hooks.py` (314 lines)
- **Purpose:** `hermes hooks` — inspect and manage shell-script hooks (`list` / `test` / `revoke` / `doctor`).
- **Key decision — approval with drift detection:** a hook records `script_mtime_at_approval`; `hermes hooks list` compares the script's current mtime to the approval-time mtime and prints "⚠ script modified since approval — run `hermes hooks doctor` to re-validate." An approval is therefore **bound to the bytes that were approved**, not to the path.
- **Also:** `hooks test` runs the hook with *synthetic kwargs matching the real call sites*, so the stdin a script sees under a test "has the runtime shape" — the payloads are enumerated for `pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`, `pre_verify`, `on_session_start/end/finalize/reset/delete`, `pre_api_request`, `post_api_request`, `pre_auxiliary_call`, `post_auxiliary_call`.

### `hermes_cli/active_sessions.py` (666 lines)
- **Purpose:** Cross-process **active chat session leases** — a file-based registry of who currently holds a session.
- **Key decisions:** (a) Identity is `(pid, live_session_id)`, because "pid alone lets two live sessions in one process steal each other's lease; the live id alone lets another process with an equal id." (b) Process liveness is checked as `(pid, process_start_time)` so a recycled PID is not mistaken for a live owner. (c) The refusal vocabulary distinguishes three states: `SESSION_NOT_OWNED` ("someone else owns this"), `SESSION_COORDINATION_UNAVAILABLE` ("I cannot tell who owns this"), and `MAX_CONCURRENT_SESSIONS` — and the docstring says collapsing the second into a silent go-ahead "is exactly the fail-open hole that let two writers share one session (#94595 review, blocker 2)." (d) The refusal is a `str` subclass carrying a machine-readable `.reason`, and the reason crosses the subprocess boundary as a `hermes-refusal-reason:` line on stderr.
- **Why it transfers:** "Cannot prove ownership" must be a *distinct* outcome from "someone else owns this" — a lesson directly applicable to a scheduler that might double-fire a trade check.

### `hermes_cli/gateway_queue.py` (199 lines)
- **Purpose:** The classic CLI's `/queue` over the gateway's durable FIFO.
- **Key decisions:** a prompt typed while a turn runs is an **ordinary queued admission** (`prompt.submit {queued: true}`), so it survives an owner restart and runs once, in FIFO order. The CLI keeps **no copy to resend** — it remembers only which admissions it queued, so the turn can be painted like a typed turn. A lost answer is re-asked once under the **same `submission_id`**, so the owner answers with the admission it already holds and the prompt is queued exactly once; if the answer is still lost, the CLI raises `QueueOutcomeUnknown` and tells the user to check `/queue list` rather than re-sending.
- **Edge cases:** a row with `status == "unknown"` pauses the FIFO and never starts a hold; `cancel` distinguishes `"cancelled"` (never ran), `"stopped"` (the drain claimed it and the owner interrupted it) and `"started"` (it already ran — and a turn that ran is still owed a paint, so it stays in the missed set).

### `hermes_cli/gateway_mutations.py` (127 lines)
- **Purpose:** Prepared native controls that retain their identity across ambiguous RPC replies.
- **Key decision:** the CAS tuple (expected revision + expected generation) is captured **once** and retained, so a lost-reply retry re-presents the *original* target instead of re-deriving one from an already-mutated transcript. `retire()` drops every retained identity for a session except the one being retried, so "a later deliberate repeat is new work instead of replaying a stale receipt." A disconnect is **not** treated as a refusal — the tuple is preserved and never refreshed "behind the user." Only an *explicit* refusal code (`invalid_params`, `revision_conflict`, `stale_generation`, `session_busy`, …) retires the pending entry.

### `hermes_cli/gateway_replay_gap.py` (24 lines)
- **Purpose:** "After `session.replay_gap`: re-attach, settle once, never splice the reply across the hole."
- **Key decision:** `owed_reply(shown, final)` returns the *rest* of an exact prefix if what was painted is a prefix of the final answer, otherwise a `[output resumed]` marker plus the whole thing. It explicitly ignores the owner's leading `"\n\n"` and trailing whitespace.

### `hermes_cli/session_recovery.py` (1,166 lines)
- **Purpose:** Offline, non-destructive recovery for a damaged `state.db`.
- **Key decisions:** the source is **never opened by SQLite** — it and its WAL/SHM/journal sidecars are copied to a disposable work dir first. Canonical rows are copied into a **fresh current-schema** database; derived FTS tables and migration bookkeeping are **rebuilt, not copied**; the result is never installed over the active database. A `_RUNTIME_TABLES` set (`runtime_epoch`, `session_admissions`, `worker_executions`, `worker_receipts`) is *inventoried and reported* rather than copied, because "copying only part of this ledger could replay already-started effects."
- **Safety:** a 256 MiB space preflight plus a same-filesystem check; the output may not be the source or any of its sidecars; existing outputs are refused; a fingerprint (size + mtime) of every sidecar is taken before the copy.

### `hermes_cli/session_lost_and_found.py` (760 lines)
- **Purpose:** Last-resort **page-level** salvage for a session database whose *schema* is unreadable, using the `sqlite3` shell's `.recover`.
- **Key decisions:** it finds the CLI, checks the version supports `.recover`, classifies each recovered row by *shape* (is this a session id? an epoch? a non-empty string? a JSON start? a path? a URL?) and re-inserts only the rows it can classify, with declared-type conflict detection. The row classifier is a set of small, named predicates (`_is_epoch`, `_is_nonempty_str`, `_is_token`, `_is_json_start`, `_is_path`, `_is_url`) rather than one big heuristic.

### `hermes_cli/sqlite_safe_read.py` (208 lines)
- **Purpose:** Lock-safe inspection of SQLite files.
- **The insight (rare and valuable):** "POSIX advisory locks are cancelled **process-wide** by `close()` on *any* fd for that file, so a bare `open(db_path, "rb") ... close()` on a live database drops every lock SQLite holds from this process (a VACUUM's EXCLUSIVE lock, an in-flight BEGIN IMMEDIATE's RESERVED lock)." The module therefore **tracks live connections** and refuses raw file operations while any exist. `close()` and the unregister happen together under one lock, and untracking happens only *after* `close()` succeeds — "untracking before a failing close would leave the FD open while the byte-probe guard thinks nothing is live."

### `hermes_cli/config_migrations.py` (798 lines)
- **Purpose:** A table-driven config migration registry. Each step is `_migrate_to_N(results, quiet)`; the version gate and strict ascending order live in `run_migrations`.
- **Key decisions:** (a) A **support floor** (`SUPPORT_FLOOR_VERSION = 12`): configs older than ~2 years are "left byte-for-byte untouched" and the process continues with defaults deep-merged at read time — carrying the sub-v12 steps and the env bridges they consumed forever is not worth it. (b) `_rewrite_stale_default` rewrites a key **only while it still equals the OLD default** — "never clobbers a value the user customized; unset keys inherit the new default at read time." (c) A step may only persist values that **differ from the schema default** (plus removals/renames), via `config._persist_migration`.

### `hermes_cli/config_section_guard.py` (56 lines)
- **Purpose:** Guard `hermes config set` against a single-segment key silently overwriting a whole config section.
- **Key decision:** the bare `model` shorthand is *redirected* to `model.default` with a message ("✓ Redirecting bare 'model' to 'model.default' (preserving N existing model sub-key(s))"), and any other section written with a scalar is **refused** with the list of its sub-keys and the exact dotted command to use, or `--force` to replace it deliberately. A container value under `model` is refused outright — "the bare 'model' shorthand takes a model id, and a container value has no slot there."

### `hermes_cli/fallback_config.py` (139 lines)
- **Purpose:** Reading the effective **fallback provider chain** from config — the chain tried in order when the primary fails.
- **Key decisions:** (a) **Alias collapse** before dedup: `opencode-zen` and `zen` both normalise to `opencode`, because "two fallback entries naming the same backend under different ids are kept as separate slots, shifting the chain and letting an alias slip past the same-backend skip." (b) Secrets are read through `agent.secret_scope.get_secret`, **not** `os.getenv`, because in a multiplexed gateway "a bare env read ignores the active profile's scope and can return another profile's credential." (c) `effective_runtime_provider` returns the *requested* provider id when the resolved class is the bare `custom` class, because the bare class otherwise labels every session and billing row "custom" instead of the configured provider name. (d) `pre_agent_fallback_notice` is a **single shared sentence** used by the messaging gateway, the TUI/Desktop gateway and cron, "so the three pre-agent fallback paths cannot drift in wording." (e) The legacy `fallback_model` key is appended *after* `fallback_providers` and deduped against it, so the chain keeps one order.

### `hermes_cli/fallback_cmd.py` (201 lines)
- **Purpose:** The `hermes fallback` CLI — list, add, remove and clear the fallback chain.
- **Key decisions:** every mutation **snapshots and restores** the live route (`_snapshot_auth_active_provider`, `_restore_auth_active_provider`, `_restore_model_cfg`, `_restore_primary_route`), so editing the chain in a running session does not strand the session on a half-edited route. The chain is written through the same config writer as everything else.

### `hermes_cli/model_cost_guard.py` (101 lines)
- **Purpose:** A confirmation prompt for models above a cost threshold: >$20/M input or >$100/M output.
- **Key decisions:** it fires **only on known pricing** — "never fires on unknown pricing." Three pricing sources are tried in order (the model's own info, the models.dev catalogue, the billing-route lookup), and each source is *trusted only if it agrees with the provider*: `_can_trust_model_info_pricing` requires the model info's provider id to be empty or equal to the requested provider, and `_can_trust_pricing_lookup` requires the billing route to be resolvable. A hand-edited "gpt-5.5-pro" on OpenRouter gets a specific "did you mean to select openai/gpt-5.5?" suggestion.

### `hermes_cli/model_selection_guards.py` (144 lines)
- **Purpose:** A **unified** selection-time guard registry for every model-switching surface.
- **Key decision:** the cost guard, the data-training-policy guard, the context-cache threshold guard and the context-cache guard all produce a `SelectionWarning` with a `SelectionContext`, and `combined_message` / `combined_selection_warning` merge them into one prompt. A model switch therefore cannot show the trader a *different* warning on the CLI, in Settings, or on the dashboard.

### `hermes_cli/context_switch_guard.py` (137 lines)
- **Purpose:** Warn when an in-session model switch will trigger preflight compression on the next turn.
- **Key decisions:** the warning quotes the **real** threshold the compressor will use after the switch (`preview_threshold_tokens`, not a re-derived ratio), and the token estimate uses `estimate_request_tokens_rough` over the actual messages + system prompt + tools. Crucially: `session_prompt_tokens` is a *lifetime sum, not occupancy* — "never a fallback here" (#126343). The warning is suppressed after two ineffective compressions (`_ineffective_compression_count >= 2`), i.e. after the user has been warned twice and nothing changed.

### `hermes_cli/session_recap.py` (152 lines)
- **Purpose:** A session recap built by **pure local computation** — "no LLM call, no auxiliary model, no prompt-cache invalidation. A recap should be instant and free."
- **Key decision:** stored history is **untrusted for display** — `sanitize_display_text` strips escapes/control chars "so a recap line can't clear the screen or retitle the window when echoed to a terminal."

### `hermes_cli/session_filters.py` (108 lines)
- **Purpose:** Shared time/filter parsing for `hermes sessions prune` / `archive`.
- **Key decision:** a bare number means **days** (backward compatible with `--older-than 90`), durations mean "that long ago", ISO timestamps are taken as-is. An empty window (`--after` later than `--before`) is **refused** with the offending bounds named. And `older_than_days` is set to `None` when explicit epoch bounds are used, "otherwise `prune_sessions`' default 90-day cutoff would silently cap an `--after`/`--newer-than`-only window."

### `hermes_cli/prune_advisor.py` (362 lines)
- **Purpose:** A low-disk prompt for `sessions.auto_prune` (off by default).
- **Key decisions:** the hot path is **two syscalls** (`os.stat` + `shutil.disk_usage`) so it can run at every session start; only when that fires does the code open the database read-only to estimate what a prune would actually free. The estimate is **scaled from a cached total** and the cache is refreshed weekly, because a full `messages` scan "is a full scan … (seconds, up to tens on a cold multi-GB store)". The reclaim is weighted by **stored bytes, not message count** — "old messages are far smaller than recent ones, and message_count skips the soft-archived rows a prune also deletes." The prompt says plainly when pruning **will not** fix the disk. "Later" snoozes for 7 days; either answer writes the config key, and then "the question stops forever."

### `hermes_cli/curator.py` (655 lines)
- **Purpose:** `hermes curator` — the skill-lifecycle curator: status, run, pause, resume, pin, unpin, list-unmanaged, adopt, restore, archive, prune, backup, ledger, purge.
- **Key decisions:** (a) **Recency and frequency are different signals**, so both a "least recently active" and a "most active" top-5 are shown; a view or an edit counts as activity, "a skill must not read as 'never used' right after `skill_view()`/`skill_manage()` touched it." (b) The **curation blind spot is reported explicitly**: skills with no provenance marker are never auto-staled or archived, and `hermes curator adopt <name>` hands one over — so the report names how many skills it will *not* touch. (c) The LLM merge pass is **opt-in** (`curator.consolidate`); the default is prune-only, deterministic. (d) `--dry-run` is a first-class mode: "no changes applied … Read the report with `hermes curator status` and run `hermes curator run` (no flag) to apply."

### `hermes_cli/skills_config.py` (130 lines)
- **Purpose:** `hermes skills` — enable/disable skills globally or per platform.
- **Key decisions:** `ESSENTIAL_SKILLS` cannot be disabled from any surface and are silently dropped on save. A platform-specific disable list is unioned with the global one — "globally disabled stays disabled everywhere." A YAML `null` is empty, and a bare scalar is a **single-item list, not its characters** (#13026).

### `hermes_cli/skills_hub.py` (1,499 lines)
- **Purpose:** The Skills Hub CLI — browse, search, preview, install, update, remove skills from many sources (an index, official, community, GitHub, ClawHub, etc.).
- **Key decisions:** (a) **Trust levels are styled** — `builtin` / `trusted` / `community` / `local` — and official-source rows show "official" instead of the level. (b) The identifier column uses `overflow="fold"` so the full slug stays visible: "browse.sh slugs end in a `-XXXXXX` hash that is part of the identifier users must copy." (c) A change either applies **now** (the skills prompt cache is cleared) or is announced as taking effect next session — never silently either way.

### `hermes_cli/plugin_isolation.py` (112 lines)
- **Purpose:** Where third-party plugin code is allowed to run (`plugins.isolation`: `in_process` or `host`).
- **Key decision — one table, two consumers:** the ctx surface tables (`HOST_UNSUPPORTED_CTX_METHODS`, `HOST_SKIPPED_CTX_METHODS`, `HOST_REMOTE_FACADES`, `HOST_OBJECT_BASES`, `HOST_DEGRADED_HOOKS`) are "the single source of truth for both the runtime boundary … and the static audit …, so **'the audit says pool-safe' and 'it loads in the host' cannot drift apart**." Every method that hands a plugin a live object no process boundary can carry is listed with the *reason*. `in_process_import_refusal` is the single chokepoint every loader asks first, and bundled code always passes.
- **Why it transfers:** The "one table, a runtime gate and a static audit both read it" pattern is how August Trading could keep a plugin/tool registry honest.

### `hermes_cli/plugin_isolation_audit.py` (199 lines)
- **Purpose:** The **static** answer to "will this plugin run in the plugin host?" — an AST-based scan of a plugin directory.
- **Key decisions:** it reads the *same* surface tables as the runtime gate (so the two cannot disagree), and it reports an `IsolationReport` rather than refusing to load — the audit is advice, the runtime is the gate. `audit_plugin_dir` walks the plugin's own Python files, deduplicating findings, and names the offending call sites.

### `hermes_cli/plugins_ledger.py` (267 lines)
- **Purpose:** A registration-ownership ledger — every plugin registration is recorded **with its inverse**, so a force-unload can undo exactly what the plugin did.
- **Why it transfers:** For a trading app with user-installed skills/toolsets, an ownership ledger with inverses is what makes "unload this plugin" safe.

### `hermes_cli/observability/shared_metrics.py` (705 lines)
- **Purpose:** Durable aggregation and local export of product metrics, over a **closed contract**.
- **Key decisions:** (a) The package schema version is `hermes.shared_metrics.v4` and the store schema version `2`; the counter table's primary key includes the *client resource* (hermes_version, os_family, architecture, install_method) plus a `dimensions_json`. (b) A **v1→v2 migration** is an explicit rename/create/insert/drop sequence, so the resource columns exist in every statement. (c) `packaged_value` (a default shipped with the package) is tracked alongside `value`, so a later release can tell "users on this build" from "this build shipped it." (d) The **outbox** is the send queue: `package_id` primary key, `exported_at`, and a `send_state` of `pending` / `sent` / `rejected` with `send_attempts`, `next_attempt_at` (backoff across process restarts) and `last_error`. (e) The `install_id` actually transmitted is **frozen on the first attempt** so retries stay byte-identical. (f) A `claim_token` is rewritten on every claim; settlement and the pre-POST revalidation are compare-and-set on it, so "a claimant whose lease lapsed loses authority the moment another process reclaims (else a suspended sender double-POSTs)." (g) Consent is recorded as **explicit intervals** (`send_consent_windows` with `opened_at` / `last_confirmed_at` / `closed_at`), closed at the *last confirmed* moment, never "now."
- **Why it transfers:** The outbox with backoff, frozen ids, a compare-and-set claim token and interval-based consent is a directly reusable "durable analytics without a heavy database" pattern (SQLite only).

### `hermes_cli/observability/shared_metrics_contract.py` (1,758 lines)
- **Purpose:** The **closed contract** every shared-metrics builder must map onto: the allowed metric names, the closed enums (memory ops and their outcomes/failure classes/origins, provider names, OS families, architectures, install methods), the bucketing functions, and the dimension validators.
- **Key decisions:** it is deliberately the *only* place the vocabulary lives, so a producer cannot invent a new dimension name; `client_resource_is_valid` and `counter_dimensions_are_valid` are the gate every builder passes through. The bucketing helpers (`long_size_bucket`, `update_duration_bucket`, `version_age_bucket`, `desktop_active_minutes_bucket`) are here, not in the producers, so two producers cannot bucket the same measure differently.
- **Why it transfers:** One contract module, one validator, every producer mapped through it — the pattern a trading app's analytics layer needs if it wants to add metrics without the schema drifting.

### `hermes_cli/observability/shared_metrics_efficiency.py` (287 lines)
- **Purpose:** Efficiency metrics — what one user turn costs, what users throw away, and where Hermes is slow.
- **Key decisions:** every measure is **bucketed** (`tokens_bucket`, `activity_bucket`, `output_size_bucket`, `schema_tokens_bucket`) rather than raw, so the rows are bounded and the contract stays small. It records a **cache break** and a **prompt rebuild** separately, so "the prompt changed" is distinguishable from "the cache missed."

### `hermes_cli/observability/shared_metrics_loop.py` (297 lines)
- **Purpose:** Learning-loop, delegation and execution-backend metrics.
- **Key decisions:** producers call `record_*` with **raw values**; every builder maps them onto the closed enums in `shared_metrics_contract`. Recording is a **no-op unless shared metrics are enabled** for the owning profile and **never raises into the caller**. A memory batch emits one row per operation, capped at `_MAX_BATCH_OPS = 25` so one call "never exports more rows than this." The origin (`foreground` / `background_review`) is captured, so an agent-created memory and a user-created one are distinguishable in the data.

### `hermes_cli/web_routers/cron.py` (788 lines)
- **Purpose:** The dashboard's cron **routes** — list jobs, see runs, fire a job, and reconcile the run history against the live scheduler.
- **Key decisions:** the dashboard does not fire jobs itself: it **forwards to the gateway** and reports `cron_run_scheduler_owned`, so there is exactly one scheduler. `_reconcile_cron_runs` aligns the durable run list with the live in-flight execution, and `_live_inflight_execution` distinguishes a run that is *happening now* from one that is only in the history.

### `hermes_cli/web_server_cron.py` (376 lines)
- **Purpose:** The dashboard cron **helpers** — per-profile scheduler I/O, job validation/normalisation, and the gateway forwarding.
- **Key decisions:** (a) The dashboard's cron script path is **containment-checked** against the profile's `scripts/` root, and a script outside it is a 400. (b) A `no_agent` job **requires** a script; an agent job requires a prompt, a skill, or a script — validated before the write. (c) `context_from` job references are validated to exist, except the literal `"self"` (the continuity toggle), which "resolves to the job's own id at run time — it can't be validated against the store (create precedes the job's existence)." (d) `_cron_profile_dicts` deliberately avoids `list_profiles()` because "whose config parsing, gateway probes and skill counts are GIL pressure on large pools." (e) The default profile is resolved from the *active* profile, and a hardcoded `"default"` "would write a non-default profile's job into `~/.hermes`."

### `hermes_cli/web_server.py` (1,250 lines)
- **Purpose:** The dashboard's FastAPI app assembly, the auth/host middleware, and `start_server`.
- **Key decisions:** the auth gate is assembled from the *listener* boundary and the host-header middleware; a **self-test** runs in the app middleware (`_dashboard_selftest_loop`) so a broken dashboard is caught by the dashboard itself; and a desktop cron ticker is started only when the gateway does not already own cron (`_gateway_owns_cron`), so there is exactly one scheduler.

### `hermes_cli/web_server_boundary.py` (181 lines)
- **Purpose:** The **listener-boundary primitives** shared by the dashboard app and the gateway's session listener: which public hosts are accepted, whether the host header is allowed, and whether the listener requires auth.
- **Key decisions:** `should_require_auth` / `listener_auth_required` decide the gate from the **listener**, not from a config flag, and a loopback desktop listener is exempt (`_desktop_loopback_auth_exempt`). The WebSocket ticket is read from the *subprotocol* (`_gateway_ws_ticket_from_subprotocol`), and the client/host-origin refusal reasons are separate strings so a failure says which check failed.

### `hermes_cli/main.py` (3,019 lines)
- **Purpose:** The CLI entry point. 150 KB of argument parsing, profile resolution, startup guards, and dispatch.
- **Key decisions visible in the API surface: `--profile` is applied via `HERMES_HOME` **before any module import**, so `get_hermes_home()` scopes correctly for single-profile commands; the multiplex gateway instead binds the profile **per activity** via a contextvar override while `os.environ["HERMES_HOME"]` keeps the launch profile — "a module constant or import-time read there freezes to the launch profile." `_warn_if_unsupervised_pid1`, `_require_tty`, `_exit_invalid_profile_name` are startup guards that fail early rather than deep in a command.

### `hermes_cli/oneshot.py` (568 lines)
- **Purpose:** One-shot mode — send a prompt, get the final content block, exit.
- **Key decisions:** it lingers for background completions before exiting ("`_linger_for_background_completions`"), writes a usage file, and resolves the model and provider from config or from a resume target's stored runtime.

### `hermes_cli/turn_exit.py` (52 lines)
- **Purpose:** The turn-result **exit policy** shared by the CLI views and authority-owned workers: `turn_exit_code` and `credential_failure_flags`.
- **Why it matters:** one vocabulary for "the turn ended this way", used by every surface.

### `hermes_cli/quiet_single_query.py` (206 lines)
- **Purpose:** Quiet `hermes chat -Q` — bind the session's key and resume nested notifications.
- **Key decision:** a **turn report file** is written and read back, so a quiet one-shot can report what happened (and resume a nested notify) without an interactive surface.

### `hermes_cli/gateway_agent.py` (1,313 lines)
- **Purpose:** The `AIAgent` **stand-in** the CLI uses when the gateway owns the session. The CLI "never builds an agent, never runs a tool and never writes `state.db`."
- **Key decisions:** the event contract is **frozen** ("wave_a.md"), every frame is `{type, session_id, execution_generation, admission_id?, payload}`. `run_conversation` submits `prompt.submit` and replays the gateway's event stream **on the calling (agent) thread** into the *same* callbacks the CLI passed to a real `AIAgent`, then returns a dict shaped like `AIAgent.run_conversation`'s — so the CLI's rendering code is unchanged. `_Turn` tracks what each consumer got (`shown` for the terminal, `spoken` for TTS) and the closed segments, so a **replay gap** can settle exactly once.

### `hermes_cli/gateway_client.py` (155 lines)
- **Purpose:** The transport-only RPC client to the gateway.
- **Key decisions:** the client is transport-only — "Closing a viewer never stops its authority." Errors are **bounded** (`_bounded_reason`, `_bounded_error_data`) before they cross the wire. `EventQueue.put_behind` exists so an event can be ordered behind one already queued. A `GatewayRPCError` and a `GatewayUnavailableError` are distinct, and `NOT_SENT` is a distinguishable value ("never reached a socket: nothing is in doubt"). A session ticket is minted per connection.

### `hermes_cli/gateway_connection.py` (265 lines)
- **Purpose:** **One gateway connection per classic-CLI process** — the object that owns it, tracks the session state, and survives a reconnect.
- **Key decisions:** it exposes `CallStopped` and `lost_before` so a caller can tell "the call was stopped" from "the connection dropped before the call"; `DISCONNECTED` is a distinct state; and a resume after a loss is explicit (`_resume_plain`) rather than an implicit re-attach, so a viewer never silently becomes an authority.

### `hermes_cli/commands.py` (500 lines)
- **Purpose:** The slash-command registry — `COMMAND_REGISTRY` (a list of `CommandDef`), the single source everything else derives from.
- **Key decisions:** `CommandDef` carries `name`, `description`, `category` (Session / Configuration / Tools & Skills / Info / Exit), `aliases`, `args_hint`, `cli_only`, `gateway_only` and `gateway_config_gate` (a config dotpath that makes a CLI-only command gateway-available). `GATEWAY_KNOWN_COMMANDS` always includes gated commands so the gateway can dispatch them, while help and menus show them only when the gate is open. `should_bypass_active_session` and `is_interrupt_then_dispatch` are separate flags for commands that may run mid-turn.

### `hermes_cli/logs.py` (294 lines)
- **Purpose:** `hermes logs` — view and filter Hermes log files, with `--since`, level/logger filters, `--follow`, and tail.
- **Key decisions:** it reads the *bytes* at the tail (`_read_tail_bytes`) and truncates to complete lines, so a partial line is never shown as a whole one.

### `hermes_cli/doctor_state.py` (588 lines)
- **Purpose:** The `hermes doctor` state checks: directories, memory files, `state.db` health, the skills hub, the memory provider, profiles, the cron store, the checkpoint store, and plugin/update provenance.
- **Key decisions:** it classifies a database as unreadable and *explains why* rather than reporting a generic failure, and it distinguishes a WAL that still has holders from a clean one. A `state.db` health report includes the row count, the WAL size and the retired WAL holders, and it can *repair* the store (`_repair_state_db`).

### `hermes_cli/doctor_report.py` (71 lines)
- **Purpose:** The output primitives every `hermes_cli.doctor_*` module renders through.
- **Key decisions:** `check_ok` / `check_warn` / `check_fail` (the last with `fail=True`) plus a `Finding` dataclass, so every doctor module produces the same shape of line and the same exit semantics. A check that raises is caught by `warn_on_error` and downgraded to a warning rather than aborting the whole doctor run.

### `hermes_cli/security_audit.py` (257 lines)
- **Purpose:** An on-demand supply-chain audit — it discovers the installed components (the venv, pinned requirements, `pyproject.toml` pins, installed plugins, MCP servers) and queries OSV for known vulnerabilities, with severity and fixed-version extraction.
- **Key decisions:** it renders either a human report or JSON, and it audits *plugins and MCP servers* as components, not just Python packages.

### `hermes_cli/security_audit_startup.py` (147 lines)
- **Purpose:** A **warn-on-load, never blocks** startup posture audit: running as root, sshd password auth enabled, container mounts, and network listeners without auth.
- **Key decision:** it *logs* warnings and never refuses to start — a posture warning must not be able to take the agent down.

### `hermes_cli/backup.py` (1,879 lines)
- **Purpose:** The `hermes backup` / import commands — snapshotting the whole home into an archive.
- **Key decisions:** the backup is written **atomically** (`_atomic_output_path`); zeroed SQLite files are detected (`is_zeroed_sqlite_file`) and integrity verified (`verify_sqlite_integrity`) before use; a member that fails to extract is **discarded** rather than left in the archive (`_discard_failed_zip_members`); symlinks and non-regular paths are excluded (`_is_link_path`, `_is_non_regular_path`); and an operation lock (`_backup_operation_lock`) plus a `BackupInProgressError` prevent two backups racing. A `_SQLiteSnapshotError` is distinct from a generic failure so a busy DB is diagnosed as such.

### `hermes_cli/backup_restore.py` (589 lines)
- **Purpose:** The **restore** side — SQLite-safe restore and archive-member publish plumbing.
- **Key decisions:** the restore is **epoch-aware** (`_restore_epoch`, `_restore_destination_epoch`, `_restore_epoch_source`): a restore can only move a database *forward* from a known epoch, so an old backup cannot be installed over a newer schema. A member is extracted **atomically** (`_extract_member_atomically`) and the archive's prefix is detected (`_detect_prefix`) so a wrongly-rooted zip is refused rather than sprayed over the home.

### `hermes_cli/backup_sqlite.py` (102 lines)
- **Purpose:** **WAL-safe SQLite snapshots**, using only the standard library.
- **Key decisions:** the snapshot is a *copy* of the database plus its sidecars under a lock, and it has its own timeout class (`_SQLiteBackupTimeout`) so a busy database produces a typed failure rather than a hang. `preflight_state_db` is the cheap check that runs before the expensive copy.

### `hermes_cli/observability/schemas/hermes.shared_metrics.v1.schema.json` (338 lines)
- **Purpose:** The **v1** JSON Schema for the shared-metrics payload — the original closed contract.
- **Tier:** a purely declarative config artefact. Opened and its structure inspected (version marker, property names, required lists), not read line by line. It is the wire contract the `shared_metrics_*` builders validate against, and the first version of the envelope the later schemas extend.

### `hermes_cli/observability/schemas/hermes.shared_metrics.v2.schema.json` (705 lines)
- **Purpose:** The **v2** schema — the first widening of the v1 envelope (roughly double the lines).
- **Tier:** declarative config artefact; structure inspected, not read line by line.

### `hermes_cli/observability/schemas/hermes.shared_metrics.v3.schema.json` (4,624 lines)
- **Purpose:** The **v3** schema — the first large widening of the closed contract.
- **Tier:** declarative config artefact; structure inspected (top-level property names, required lists, version marker), not read line by line.
- **Why it matters:** v3 is where the "closed contract" stops being cheap — the file is 13× the size of v2, and the `shared_metrics_drift.py` conformance module exists precisely because rows written under v3 must be reshaped for v4.

### `hermes_cli/observability/schemas/hermes.shared_metrics.v4.schema.json` (5,262 lines)
- **Purpose:** The **v4** schema — the current envelope, matching `_PACKAGE_SCHEMA_VERSION = "hermes.shared_metrics.v4"` in `hermes_cli/observability/shared_metrics.py`.
- **Tier:** declarative config artefact; structure inspected, not read line by line.
- **Why it matters:** the growth v1 (338) → v4 (5,262) is the visible cost of a closed metric contract, and the reason the drift-conformance module had to exist.

### Tier 2 — bulk: the rest of the shard, one row per file

Each row is one file. The description is the file's own module docstring first sentence (or, where there is no docstring, the leading comment), followed by its three most important exported symbols. Files are in shard-list order.

| File | What it is / what it pins |
| --- | --- |
| `hermes_cli/__init__.py` | Hermes CLI - Unified command-line interface for Hermes Agent. — key API: __getattr__, _ensure_utf8 |
| `hermes_cli/_early_recovery.py` | Startup requests for PM recovery and rescue of orphaned launchers. — key API: restore_quarantined_shims, _should_skip_external_secret_sources, _project_root |
| `hermes_cli/_early_recovery_zip.py` | Settles a ZIP ``hermes update`` swap whose owner died: its journal, owner lock and recovery. — key API: ZipSwapLock, zip_swap_owner_lock, write_zip_swap_journal |
| `hermes_cli/_install_repair.py` | Repair Windows launchers and their registered PATH entries. — key API: _sync_windows_cli_launchers, _is_windows, _normalize_windows_path |
| `hermes_cli/_launchers.py` | Source-install launchers shared by setup, installers, and Windows repair. — key API: _inline_string_literal, runtime_command, print_runtime_command |
| `hermes_cli/_old_updater.py` | The newly imported escape hatch from an already-running historical updater. — key API: _is_historical_update_frame, in_historical_update, _historical_context |
| `hermes_cli/_parser.py` | Top-level argparse construction for the hermes CLI. — key API: _cfg_path, top_level_value_flag_sets, command_argv |
| `hermes_cli/_scan_venv_blockers.py` | Compatibility entry point for historical Desktop venv preflights. — key API: _is_pausable_gateway, main |
| `hermes_cli/_secrets_common.py` | Helpers shared by the Bitwarden and 1Password ``hermes secrets`` CLIs. — key API: yn, section_cfg, cfg_str |
| `hermes_cli/_startup_fast.py` | Pre-import startup fast paths — THE canonical lightweight helpers. — key API: _read_text, project_root_str, normalize_hermes_home_env |
| `hermes_cli/_subprocess_compat.py` | Windows subprocess compatibility helpers. — key API: run, harden_git_argv, split_command_line |
| `hermes_cli/_update_takeover.py` | Absolute-path bootstrap for historical updater takeover; no app imports yet. — key API: prepare, _arm_fleet_obligation, _head_sha |
| `hermes_cli/agent_import.py` | hermes import-agent — import Claude Code / Codex CLI setups into Hermes. — key API: is_secret_key, normalize_text, read_text |
| `hermes_cli/agent_import_sync.py` | ``hermes import-agent --sync`` — keep previously imported Claude Code / Codex setups current. — key API: sync_manifest_path, _iter_sync_files, compute_source_digest |
| `hermes_cli/agent_plugins.py` | Compatibility helpers for Agent Plugins v1 portable directory packages. — key API: liveness_for, _set_liveness, _clear_liveness |
| `hermes_cli/anon_auth.py` | Nous free-tier identity: the ``anonymous`` auth method of the ``nous`` provider. — key API: AnonCredentialDead, _anon_err, friendly_wait |
| `hermes_cli/anon_challenge.py` | Nous free tier: the browser challenge the account service may put in front of a token exchange. — key API: BrowserChallenge, AnonChallengeRequired, signin_required_error |
| `hermes_cli/anon_sign_in.py` | Shared sign-in states, copy, and connector-preserving account promotion flow. — key API: format_wait_line, SignInState, Code |
| `hermes_cli/anon_sign_in_cli.py` | Terminal and chat rendering for the shared sign-in flow. — key API: render_sign_in_cli_code, drain_sign_in_copy, render_sign_in_cli |
| `hermes_cli/archive_safe.py` | Safe ``tar.gz`` primitives shared by the profile and kanban transfer paths. — key API: normalize_archive_parts, make_targz, safe_extract_targz |
| `hermes_cli/auth.py` | Multi-provider authentication system for Hermes Agent. — key API: is_actual_local_base_url, normalize_actual_base_url, ProviderConfig |
| `hermes_cli/auth_codex.py` | OpenAI Codex OAuth: token store, refresh, quota probe, device-code login. — key API: _codex_relogin_command, _parse_retry_after_seconds, _stripped |
| `hermes_cli/auth_codex_browser.py` | OpenAI Codex browser login: authorization-code + PKCE on a loopback listener (opt-in). — key API: _codex_login_flow, codex_oauth_login, _codex_browser_authorize_url |
| `hermes_cli/auth_commands.py` | Credential-pool auth subcommands. — key API: _get_custom_provider_entries, _configured_provider_entry, _resolve_custom_provider_input |
| `hermes_cli/auth_constants.py` | Shared constants, the lazy ``httpx`` proxy and :class:`AuthError` for the auth package. — key API: AuthError, _provider_error_factory, _decode_jwt_claims |
| `hermes_cli/auth_device_flow.py` | Shared device-code / loopback-PKCE / browser / TLS helpers for interactive OAuth logins. — key API: _is_remote_session, _names_console_browser, _can_open_graphical_browser |
| `hermes_cli/auth_error_copy.py` | Plain-language copy for sign-in and provider-setup failures (CLI). — key API: DeviceCodeExpired, SignInCopyError, is_network_error |
| `hermes_cli/auth_external_process.py` | Executable lookup for ``external_process`` (ACP) providers. — key API: resolve_external_process_command |
| `hermes_cli/auth_minimax.py` | MiniMax OAuth (user-code grant) login, refresh and runtime credentials. — key API: _minimax_response_error_text, _minimax_post_form, _minimax_pkce_pair |
| `hermes_cli/auth_model_picker.py` | Interactive model picker used after OAuth login. — key API: _confirm_selection_guards, _ModelPickerRows, _prompt_model_selection |
| `hermes_cli/auth_nous.py` | Nous Portal OAuth: device-code login, refresh, shared-store mirroring, JWT selection, status. — key API: _unusable_invoke_jwt_error, _token_fingerprint, _oauth_trace |
| `hermes_cli/auth_oauth_grants.py` | Single-use OAuth grant hygiene: strip cloned grants from profiles, heal forked grants. — key API: _block_tokens, _is_forkable_pool_row, _is_oauth_pool_payload |
| `hermes_cli/auth_oauth_pkce_plugin.py` | Declarative OAuth 2.0 Authorization-Code + PKCE login for out-of-tree model-provider plugins. — key API: OAuthPKCEConfig, _err, _host_allowed |
| `hermes_cli/auth_openrouter.py` | OpenRouter OAuth PKCE login (``hermes auth add openrouter --type oauth``). — key API: _openrouter_exchange_code, _openrouter_headless_code, _openrouter_loopback_code |
| `hermes_cli/auth_plugin_providers.py` | Model-provider plugins as first-class citizens of ``hermes auth`` and the credential pool. — key API: _api_key_env_fields, register_plugin_provider, _user_owns_alias |
| `hermes_cli/auth_qwen.py` | Qwen OAuth (qwen-cli token file) runtime credentials and status. — key API: _qwen_cli_auth_path, _read_qwen_cli_tokens, _save_qwen_cli_tokens |
| `hermes_cli/auth_xai.py` | xAI Grok OAuth: token store, discovery, refresh, device-code login. — key API: _clean, _token_pair, _xai_oauth_state_from_store |
| `hermes_cli/auth_zai_kimi.py` | Kimi Code and Z.AI endpoint auto-detection, LM Studio base-URL normalization. — key API: _resolve_kimi_base_url, _probe_single_zai_endpoint, detect_zai_endpoint |
| `hermes_cli/azure_detect.py` | Azure Foundry endpoint auto-detection. — key API: DetectionResult, _resolve_credential, _authed_request |
| `hermes_cli/backend_retirement.py` | Process-owned admission fence for cooperative Desktop backend retirement. — key API: RetirementFence |
| `hermes_cli/backup_cron_prompts.py` | Post-update cron safety net for field-level loss: restore agent-job prompts an update — key API: _load_cron_jobs_doc, _cron_jobs_list, _prompt_degraded |
| `hermes_cli/bang_shell.py` | ``!<command>`` shell mode for the interactive CLI. — key API: is_bang_command, parse_bang_command, bang_shell_enabled |
| `hermes_cli/banner.py` | Welcome banner, ASCII art, skills summary, and update check for the CLI. — key API: _check_via_pypi, check_via_pypi, _quiet |
| `hermes_cli/blueprint_cmd.py` | Shared ``/blueprint`` command logic for CLI, TUI, and gateway. — key API: BlueprintCommandResult, _resolve_origin, _parse_kv |
| `hermes_cli/boot_bootstrap.py` | Bounded home maintenance after an installed revision changes. — key API: read_git_head, _git_binary, current_install_identity |
| `hermes_cli/browser_connect.py` | Shared helpers for attaching Hermes to a local Chromium-family CDP port. — key API: _Browser, real_profile_data_dir, _first_present |
| `hermes_cli/browser_runtime.py` | Read-only full-Chromium selection shared by browser launchers. — key API: chromium_executable |
| `hermes_cli/build_info.py` | Shims to suppress old updater work until relaunch. — key API: get_code_identity |
| `hermes_cli/bundled_app.py` | Where the running BUNDLED desktop app lives, and how to start it. — key API: NotBundledApp, BundleLayout, resolve_bundle_layout |
| `hermes_cli/bundles.py` | Implementation of the ``hermes bundles`` CLI subcommand. — key API: _console, _fail, _cmd_list |
| `hermes_cli/callbacks.py` | Secret-capture prompt for the interactive CLI (``_secret_capture_callback`` backend). — key API: _invalidate, _clear_secret_input, _skipped |
| `hermes_cli/chat_catalog.py` | Admit only chat models into shared chat catalogs. — key API: note_generation_model, model_id_is_generation, _tag_list_is_generation |
| `hermes_cli/checkpoints.py` | `hermes checkpoints` CLI subcommand. — key API: _fmt_age, cmd_status, _print_archives |
| `hermes_cli/claw.py` | hermes claw — OpenClaw migration commands. — key API: _print_banner, _info, _error_block |
| `hermes_cli/cli_agent_setup_mixin.py` | Agent construction + session-resume display for ``HermesCLI``: credential resolution, — key API: _single_query_clarify_callback, _current_runtime, _route_signature |
| `hermes_cli/cli_auto_maintenance.py` | Startup auto-maintenance for the classic CLI: state-db pack/vacuum and checkpoint pruning run off the prompt thread. — key API: _run_state_db_auto_maintenance, _run_checkpoint_auto_maintenance |
| `hermes_cli/cli_billing_mixin.py` | Billing and subscription handlers for the interactive CLI (mixed into ``HermesCLI``). — key API: _cancel_row, _portal_row, _allow_remote_spending_choices |
| `hermes_cli/cli_browser_gateway.py` | Classic CLI ``/browser`` on the shared gateway (#134889 CLI-9): ``browser.manage``, as Ink and — key API: _gateway_is_remote, gateway_browser, _normalize_cdp_url |
| `hermes_cli/cli_chat_error_copy.py` | Plain-language copy for chat-turn failures shown in the CLI response panel. — key API: _short, refusal_text, chat_error_response |
| `hermes_cli/cli_chat_turn_mixin.py` | chat() and its per-turn phases: image routing, staging, agent thread, interrupt monitor, rendering. — key API: CLIChatTurnMixin |
| `hermes_cli/cli_commands_mixin.py` | Slash-command handlers for the interactive CLI (``HermesCLI`` inherits ``CLICommandsMixin``). — key API: _attempt, _take_flag, _summarize_paths |
| `hermes_cli/cli_commands_session_tools.py` | Shared print/translate helpers + session-info slash handlers (``cli_commands_mixin`` split). — key API: _cp, _pr, _save |
| `hermes_cli/cli_commands_worktree.py` | ``/worktree new``'s step into the tree it just created, split out of ``cli_commands_mixin``. — key API: enter_new_worktree |
| `hermes_cli/cli_config_load.py` | Classic-CLI config loading: prefill messages, reasoning/service-tier parsing, terminal env mirroring, CLI defaults + user YAML merge and the logging/display bootstrap. — key API: _cli, _load_prefill_messages, _resolve_prefill_messages_file |
| `hermes_cli/cli_cron_lines.py` | The classic CLI's `/cron` as plain lines: the overview, the list and every store write. — key API: _cron, cron_overview_lines, cron_list_lines |
| `hermes_cli/cli_footer_split.py` | Root container of the classic CLI footer: clips a late row instead of giving up. — key API: FooterSplit |
| `hermes_cli/cli_info_lines.py` | The classic CLI's `/toolsets` and `/platforms` reports as plain lines. — key API: _box, toolsets_lines, platforms_lines |
| `hermes_cli/cli_info_mixin.py` | Informational views and reload flows for the interactive CLI: banner, help, tools, usage, — key API: _tool_progress_label, _reload_mcp_choices, _help_section_title |
| `hermes_cli/cli_init_mixin.py` | HermesCLI constructor phases: display options, model/provider routing, turn limits, toolsets, checkpoints, prompt/reasoning, runtime state, session store and UI state. — key API: _adopt_gateway_toolsets, _gateway_launch, _explicit_launch_skills |
| `hermes_cli/cli_loops_mixin.py` | Simple slash-command wrappers plus goal/heartbeat/loop manager hooks for the interactive CLI. — key API: _fresh_start, _preview, _queue_usage |
| `hermes_cli/cli_modal_mixin.py` | Modal overlays for the interactive CLI: clarify, approval, sudo/secret capture, command palette, — key API: _approval_outcome_label, _approval_gate_on, _gated_confirm |
| `hermes_cli/cli_model_switch_mixin.py` | Model picker, /model switch application, runtime snapshot/restore, and codex runtime handling for the interactive CLI — key API: _runtime_fields, _resolve_cli_reasoning, stored_session_route |
| `hermes_cli/cli_modern_layout.py` | Glyph-grammar transcript and bottom-anchored chrome for the classic CLI (``display.cli_layout``). — key API: is_modern, layout_from_config, busy_input_mode_from_config |
| `hermes_cli/cli_output.py` | Shared CLI output helpers (``print_*`` + ``prompt()``) for the setup/config wizards. — key API: print_info, print_success, print_warning |
| `hermes_cli/cli_panel.py` | Bordered overlay panels (approval, clarify, sudo, pickers) for the classic CLI's live region. — key API: _Panel |
| `hermes_cli/cli_process_dock.py` | Background-process rows for the classic CLI live-work dock. — key API: _last_output_line, process_status, process_rows |
| `hermes_cli/cli_process_notifications.py` | CLI notification ownership, structured queueing and last-moment consumption. — key API: CLIProcessNotificationsMixin |
| `hermes_cli/cli_render.py` | Classic-CLI rendering helpers: reasoning-tag stripping, ANSI/skin colours, light-mode detection, markdown/final-content rendering, output-history replay, ``_cprint`` and the panel box/wra… — key API: _cli, _strip_reasoning_tags, _assistant_content_as_text |
| `hermes_cli/cli_session_dock.py` | Goal, loop + queued-prompt rows for the classic CLI live-work dock. — key API: sync_automation, goal_line, countdown |
| `hermes_cli/cli_session_mixin.py` | Session lifecycle for the interactive CLI: new/resume/save, undo/retry rewinds, yolo — key API: _user_turn_indices, _timestamp_or, _squash |
| `hermes_cli/cli_session_switch.py` | Session-switch plumbing shared by /resume, /sessions and /branch. — key API: _end_current_session, _sync_agent_to_session |
| `hermes_cli/cli_shutdown.py` | Classic-CLI shutdown and one-shot finalize helpers: process session-id sync, deferred agent startup, exit watchdog, cleanup steps, session-finalize notifications and the terminal input-mo… — key API: _cli, _sync_process_session_id, _flush_logging_and_stdio |
| `hermes_cli/cli_single_query.py` | Single-query (``-q`` / one-shot) helpers: kanban goal loops, exit-code mapping, quiet single-query runner, image routing, signal handlers and the single-query mode orchestrator. — key API: _int_or, _interrupt_agent_for_signal, _run_kanban_goal_loop_q |
| `hermes_cli/cli_snapshot.py` | Classic CLI snapshot restore: hand off the profile offline, then rejoin its authority. — key API: restore_snapshot_command, _pause_owner, _restore_gateway_snapshot |
| `hermes_cli/cli_status_bar_mixin.py` | Status bar, spinner, turn-summary, pet pane, and prompt-stash rendering for the — key API: _threshold_style, _finite, CLIStatusBarMixin |
| `hermes_cli/cli_stream_mixin.py` | Streaming output, reasoning preview, tool progress callbacks, and busy-command spinner for the interactive CLI — key API: _thinking_prefix, _terminal_columns, CLIStreamMixin |
| `hermes_cli/cli_subagent_monitor.py` | Classic CLI live-work dock (subagents, background processes, active goal, standing loop, queued — key API: _clip, SubagentMonitor, read_tail |
| `hermes_cli/cli_terminal_input.py` | Classic-CLI terminal input helpers: file-drop/attachment path resolution, bracketed-paste patching, extended Enter-key sequences, CPR leak guards and TUI input-height estimation. — key API: _cli, _termux_example_image_path, _split_path_input |
| `hermes_cli/cli_terminal_mixin.py` | Terminal repaint/resize recovery, input-mode healing, and clipboard helpers for the interactive — key API: _is_eio, _run_on_app_loop, _write_terminal_sequence |
| `hermes_cli/cli_tui_mixin.py` | prompt_toolkit TUI construction, key-binding handlers, and overlay display fragments for the — key API: _approval_choice_label, _agent_name, _tn |
| `hermes_cli/cli_tui_runtime_mixin.py` | Classic-TUI run loop phases: input processing, after-turn bookkeeping, startup banner/prewarm/maintenance, prompt_toolkit application build, signal handlers and shutdown. — key API: CLITuiRuntimeMixin |
| `hermes_cli/cli_tui_wrap.py` | Row-wrapping helpers for the classic CLI's prompt_toolkit panels (moved from ``cli_tui_mixin``). — key API: _wrap_rows, _prefix_wrapped_rows |
| `hermes_cli/cli_unknown_command.py` | Copy for an unknown slash command: says nothing was sent and suggests a near-miss. — key API: unknown_command_lines |
| `hermes_cli/cli_voice_mixin.py` | Voice mode (recording, STT, TTS, full-duplex barge-in) and wake-word listener handlers for the interactive CLI — key API: _config_section, _numeric_or, _unlink_quietly |
| `hermes_cli/clipboard.py` | Clipboard image extraction and text write for macOS, Windows, Linux, and WSL2. — key API: _nonempty, _probe, _pipe_to_file |
| `hermes_cli/codex_models.py` | Codex model discovery from API, local cache, and config. — key API: _dedupe, _add_forward_compat_models, _add_context_variants |
| `hermes_cli/codex_runtime_plugin_migration.py` | Migrate Hermes MCP server config and Codex's installed curated plugins into ~/.codex/config.toml. — key API: MigrationReport, _str_map, _translate_one_server |
| `hermes_cli/codex_runtime_switch.py` | Shared logic for the /codex-runtime slash command (CLI and gateway call into this module). — key API: CodexRuntimeStatus, parse_args, get_current_runtime |
| `hermes_cli/colors.py` | Shared ANSI color utilities for Hermes CLI modules. — key API: should_use_color, Colors, color |
| `hermes_cli/commands_completion.py` | prompt_toolkit completer + inline auto-suggest for slash commands. — key API: _personalities_from_cli_config, _file_size_label, _completion |
| `hermes_cli/commands_platforms.py` | Gateway platform command derivations (Telegram / Discord / Slack) from ``COMMAND_REGISTRY``. — key API: _gateway_available_commands, _requires_argument, _sanitize_telegram_name |
| `hermes_cli/completion.py` | Shell completion script generation for hermes CLI. — key API: _walk, _clean, _sorted_subcommands |
| `hermes_cli/config.py` | Configuration management for Hermes Agent: config.yaml / .env loading, saving, — key API: is_uv_tool_install, is_unsupported_install_method, format_unsupported_install_warning |
| `hermes_cli/config_backups.py` | Point-in-time copies of ``config.yaml``: one directory, one naming scheme, bounded count. — key API: backups_dir, list_config_backups, backup_config |
| `hermes_cli/config_check_diagnostics.py` | Read-only diagnostics for saved toolsets and bundled platform selections. — key API: config_check_diagnostics |
| `hermes_cli/config_defaults.py` | Default configuration data for Hermes Agent: DEFAULT_CONFIG and OPTIONAL_ENV_VARS. — key API: _aux |
| `hermes_cli/config_defaults_env.py` | Entry factories for ``config_defaults.OPTIONAL_ENV_VARS`` (pure-data leaf, no imports). — key API: _env, _category, _base_url |
| `hermes_cli/config_effective.py` | The effective USER config: config.yaml + managed overlay + ``${VAR}`` expansion, no defaults. — key API: _effective, _recover_user_raw, load_user_config_effective |
| `hermes_cli/config_env_routing.py` | Which ``hermes config`` keys live in ``.env`` instead of ``config.yaml``, and their lifecycle. — key API: is_registered_env_name, is_env_setting_key, _drop_config_yaml_copies |
| `hermes_cli/config_home.py` | Directory initialization and storage diagnostics for the active Hermes home. — key API: HomeInitializationError, _directory_links, _operator_owned_links |
| `hermes_cli/config_language.py` | ``display.language`` validation for ``hermes config set`` — pluggable languages. — key API: resolve_display_language, display_language_error |
| `hermes_cli/config_providers.py` | Custom-provider entry normalization and per-route lookups (TLS, headers, context length, capabilities). — key API: _warn_once_per_provider, _canonical_api_mode, coerce_provider_id |
| `hermes_cli/config_read_errors.py` | What Hermes does when an existing ``config.yaml`` cannot be read or parsed. — key API: _yaml_error_location, _yaml_error_details, format_config_parse_failure |
| `hermes_cli/config_show.py` | ``hermes config`` / ``hermes config show``: the read-only configuration summary. — key API: _section, _show_managed_banner, _show_model_section |
| `hermes_cli/config_version_stamp.py` | The config schema-version stamp: raw reads of ``_config_version`` from config.yaml. — key API: _coerce_config_version, read_config_version_stamp, check_config_version |
| `hermes_cli/config_worker_save.py` | What ``save_config`` persists when the process serves a frozen session config. — key API: rebase_for_save, _frozen_for_deletion, _schema_default_branch |
| `hermes_cli/connectors_cmd.py` | ``hermes connectors``: list, connect, rename and remove hosted connector accounts. — key API: _CommandError, _fail, _valid_alias |
| `hermes_cli/console_engine.py` | Safe Hermes Console command engine. — key API: ConsoleCommandError, ConsoleResult, ConsoleCommand |
| `hermes_cli/container_boot.py` | Container-boot reconciliation of per-profile gateway s6 services. — key API: ReconcileAction, _slot_action, _named_profile_dirs |
| `hermes_cli/copilot_auth.py` | GitHub Copilot authentication utilities (credential order matches the Copilot CLI: — key API: validate_copilot_token, resolve_copilot_token, _gh_cli_candidates |
| `hermes_cli/credential_lifecycle.py` | Unified provider-credential lifecycle across every store Hermes reads. — key API: _providers_for_env_var, _for_each_provider, _prune_env_pool_entries |
| `hermes_cli/curses_ui.py` | Curses checklist / radiolist / single-select menus with keyboard navigation and fuzzy ``/`` — key API: MenuNavigationStart, MenuNavigationEvent, set_menu_navigation_handler |
| `hermes_cli/dashboard_auth/__init__.py` | Dashboard authentication provider framework. |
| `hermes_cli/dashboard_auth/audit.py` | Audit log for dashboard-auth events: ``$HERMES_HOME/logs/dashboard-auth.log``, one JSON object — key API: AuditEvent, _resolve_log_path, _bounded_value |
| `hermes_cli/dashboard_auth/base.py` | Abstract base + dataclasses + exceptions for dashboard auth providers. — key API: Session, TokenPrincipal, LoginStart |
| `hermes_cli/dashboard_auth/body_limit.py` | Bound public auth bodies before FastAPI assembles JSON for validation. — key API: _AuthBodyTooLarge, AuthBodyLimitMiddleware |
| `hermes_cli/dashboard_auth/cookies.py` | Cookie helpers for dashboard auth. — key API: _resolved_name, _cookie_path, _common_attrs |
| `hermes_cli/dashboard_auth/login_page.py` | Server-rendered /login page (no React, no SPA bundle, no injected token). — key API: render_login_html, _apply_proxy_prefix, render_native_provider_choice_html |
| `hermes_cli/dashboard_auth/middleware.py` | Auth-gate middleware for the dashboard. — key API: _path_is_public, _safe_next_target, _unauth_response |
| `hermes_cli/dashboard_auth/native_flow.py` | Gateway-brokered RFC 8252 (OAuth 2.0 for Native Apps) authorization store. — key API: _Pending, _IssuedCode, NativeFlowError |
| `hermes_cli/dashboard_auth/native_http.py` | Same-user private bootstrap at the existing HTTP authentication boundary. — key API: native_profile_scope, _own_profile, _check_profile_scope |
| `hermes_cli/dashboard_auth/prefix.py` | X-Forwarded-Prefix and public-URL resolution for reverse-proxied deploys. — key API: _warn_once, _warn_if_malformed, _warn_if_malformed_prefix |
| `hermes_cli/dashboard_auth/public_paths.py` | Shared allowlist of ``/api/*`` paths that bypass dashboard auth. |
| `hermes_cli/dashboard_auth/refresh_singleflight.py` | Single-flight + short replay cache for rotating refresh tokens (both refresh paths). — key API: _Flight, _prune, _refresh_provider |
| `hermes_cli/dashboard_auth/registry.py` | Module-level registry for DashboardAuthProvider instances. — key API: _merged, _target, _log_registered |
| `hermes_cli/dashboard_auth/request_utils.py` | Request-level helpers shared by the auth routes and both middlewares. — key API: client_ip, extract_bearer, is_safe_next_path |
| `hermes_cli/dashboard_auth/routes.py` | HTTP routes for the dashboard-auth OAuth round trip. — key API: _http, _prefix, _audit |
| `hermes_cli/dashboard_auth/token_auth.py` | Route-agnostic non-interactive (bearer-token) auth seam for the dashboard. — key API: register_token_route, is_token_route, clear_token_routes |
| `hermes_cli/dashboard_auth/ws_tickets.py` | WS-upgrade auth credentials for gated mode. — key API: TicketInvalid, mint_ticket, consume_ticket |
| `hermes_cli/dashboard_procs.py` | Dashboard process-hygiene helpers — extracted from ``hermes_cli/main.py``. — key API: _empty_result, _append_row, _iter_process_table |
| `hermes_cli/dashboard_register.py` | ``hermes dashboard register`` — register a self-hosted dashboard OAuth client. — key API: _generate_dashboard_name, _resolve_portal_base_url, _register_self_hosted_client |
| `hermes_cli/data_cleanup.py` | Data-only deletion separates user state from the runtime that must survive. — key API: DataRemovalPlan, plan_data_removal, remove_data |
| `hermes_cli/data_cleanup_holders.py` | Home-scoped runtime coordination for an explicitly confirmed data wipe. — key API: manual_gateway_identity, pause_acked, _drain_manual_gateway |
| `hermes_cli/debug.py` | ``hermes debug`` debug tools for Hermes Agent. — key API: _pending_file, _load_pending, _save_pending |
| `hermes_cli/debug_redaction.py` | Fail-closed redaction for text and structures leaving debug/support flows. — key API: _decoded_compact_name, _redact_url_params, _redact_headers_and_argv |
| `hermes_cli/default_soul.py` | Default SOUL.md template seeded into HERMES_HOME on first run. — key API: _normalize_soul, is_legacy_template_soul |
| `hermes_cli/desktop_build_lock.py` | Cross-process serialization for the mutable Desktop build preflight. — key API: DesktopBuildLock |
| `hermes_cli/desktop_console.py` | Keep Windows console backpressure off the packaged desktop startup path. — key API: desktop_launch_notice, desktop_console_output |
| `hermes_cli/desktop_update_verify.py` | Read-only verification at the Windows Desktop handoff receipt boundary. — key API: _verify_packaged_entry, checkout_root, _root_to_verify |
| `hermes_cli/diagnostics_upload.py` | Client for uploading ``hermes debug share`` bundles to Nous-internal S3. — key API: _urlopen_checked, request_upload_url, put_bundle |
| `hermes_cli/dingtalk_auth.py` | DingTalk Device Flow authorization. — key API: RegistrationError, _api_post, begin_registration |
| `hermes_cli/doctor.py` | ``hermes doctor`` — diagnose (and with --fix, repair) a Hermes install. — key API: _check_auth_providers, _login_row, _check_api_connectivity |
| `hermes_cli/doctor_config.py` | Configuration-file checks for hermes doctor: .env, config.yaml validation, drift, deprecations. — key API: _has_provider_env_config, collect_deprecated_config_keys, collect_deprecated_env_vars |
| `hermes_cli/doctor_connectivity.py` | API connectivity probes for ``hermes doctor`` (split out of ``doctor.py``). — key API: ProbeResult, _row, _skip |
| `hermes_cli/doctor_live.py` | ``hermes doctor --live`` — opt-in bounded real-call tool-backend probes. — key API: ProbeResult, _http_get, _browser_available |
| `hermes_cli/doctor_platform.py` | Host-platform checks for hermes doctor: interpreter, SQLite, certificates, macOS TCC, gateway supervision, command install. — key API: _python_repair_hint, _system_package_install_cmd, _sqlite_upgrade_hint |
| `hermes_cli/doctor_tools.py` | External-tool checks for hermes doctor: terminal backends, git/rg, Node + agent-browser, npm audit, tool availability. — key API: _safe_which, _pm_tool_path, _pm_package_for_command |
| `hermes_cli/dump.py` | Dump command for hermes CLI. — key API: _dotenv_key_names, _git_output, _get_git_commit |
| `hermes_cli/env_loader.py` | Helpers for loading Hermes .env files consistently across entrypoints. — key API: _env_keys_defined_in_dotenv, _clear_known_keys_missing_from_dotenv, get_secret_source |
| `hermes_cli/focus_view.py` | Focus view — display-only reduced output: "just my prompt and the answer, and tell me what you hid". — key API: normalize_tool_progress_mode, resolve_focus_arg, would_display_tool_line |
| `hermes_cli/foreign_sessions.py` | Import sessions from foreign coding agents (Claude Code, Codex CLI). — key API: ForeignSession, _read_json_lines, _block_text |
| `hermes_cli/foreign_sessions_browser.py` | Backend-local discovery and previews for the desktop session importer. — key API: _display_title, _candidates, _parse |
| `hermes_cli/free_tier_bootstrap.py` | Serve-start record of who carries inference, for ``setup.status`` and ``setup.ready``. — key API: SetupRecord, current_record, wait_for_record |
| `hermes_cli/free_tier_offer.py` | When the free tier's "sign in for more" offer is due: after finished tasks, backing off. — key API: _path, _read, _transaction |
| `hermes_cli/fs_utils.py` | Filesystem helpers shared across Hermes CLI subsystems. — key API: rmtree_force |
| `hermes_cli/gateway.py` | Gateway subcommand for hermes CLI. — key API: GatewayRuntimeSnapshot, ProfileGatewayProcess, WindowsGatewayService |
| `hermes_cli/gateway_chat.py` | Normal classic/one-shot launch through the canonical gateway, never AIAgent. — key API: env_launch_flags, shell_client_env, client_env_policy |
| `hermes_cli/gateway_chat_commands.py` | Classic CLI slash commands on the shared gateway, beyond the view's own controls. — key API: refusal, _user_turns, _rewind_to |
| `hermes_cli/gateway_chat_listing.py` | ``--list-tools`` / ``--list-toolsets`` on the gateway path: a catalog listing needs no session. — key API: _selection, print_tool_listing |
| `hermes_cli/gateway_chat_startup.py` | Frontend startup checks shared by classic chat and top-level one-shot. — key API: ensure_launch_provider, launch_gateway_chat |
| `hermes_cli/gateway_chat_view.py` | Classic terminal presentation of authority events and fenced controls. — key API: _pending_preview, GatewayChatView, _oneshot_admission |
| `hermes_cli/gateway_cli_commands.py` | Classic CLI commands whose state lives in the gateway session, answered there. — key API: _diff, _reload, _handoff |
| `hermes_cli/gateway_command_errors.py` | User-facing copy for ``hermes gateway start/stop/restart`` failures on systemd hosts. — key API: SystemctlUnavailableError, _verb_for, explain_service_failure |
| `hermes_cli/gateway_enroll.py` | ``hermes gateway enroll`` — enroll a self-hosted gateway with a relay connector. — key API: _default_gateway_id, _resolve_connector_url, _post_enroll |
| `hermes_cli/gateway_host_record.py` | Host-gateway cleanup after a confirmed stop: the rendezvous record and the memoized probe. — key API: _discard_dead_host_record, _forget_host_gateway_probe |
| `hermes_cli/gateway_launchd.py` | Gateway launchd (macOS LaunchAgent) backend: plist generation/refresh, bootstrap, start/stop/restart/status. — key API: _gw, get_launchd_label, _probe_launchd_domain_for_label |
| `hermes_cli/gateway_lifecycle_guards.py` | Refusals that keep ``hermes gateway`` lifecycle verbs off gateways they must not take down. — key API: _live_work_from_state, live_work, _candidate_homes |
| `hermes_cli/gateway_migrate.py` | ``hermes gateway migrate --multiplex``: converge a per-profile-gateway install onto the ONE — key API: ProfileGateway, _service_label, _remove_verb |
| `hermes_cli/gateway_migrate_guards.py` | Boundaries the AUTOMATIC multiplex migration (``hermes update``) must not cross, and the opt-out. — key API: _pid_uid, pid_is_other_users, _system_unit_uid |
| `hermes_cli/gateway_multiplex_mode.py` | Boot-time verdict for ``gateway.multiplex_profiles`` (the default is on, and there is no opt-out). — key API: explicit_multiplex_flag, settled_explicit_flag, host_serves_named_profile |
| `hermes_cli/gateway_multiplex_s6.py` | s6 leg of the one-gateway-per-host convergence, shared by container boot and in-process migration. — key API: FoldDecision, fold_named_slot_intent, named_slot_name |
| `hermes_cli/gateway_multiplex_served.py` | Which profiles does the LIVE default multiplexer serve? — key API: live_default_gateway_pid, recorded_served_profiles, multiplexer_served_secondaries |
| `hermes_cli/gateway_plugin_commands.py` | Plugin slash commands of the classic CLI on the shared gateway (``slash.exec``). — key API: CatalogUnavailable, _boundary, _read |
| `hermes_cli/gateway_profile_lifecycle.py` | Named-profile lifecycle inside the host gateway, never a service-manager action. — key API: ack_confirmed, ack_failure, mark_planned_stop |
| `hermes_cli/gateway_rollback.py` | ``/rollback`` on the shared gateway session (``rollback.list`` / ``rollback.diff`` / ``rollback.restore``). — key API: _t, _checkpoint_rows, rollback |
| `hermes_cli/gateway_runtime.py` | Validated, credential-free gateway endpoint discovery for local clients. — key API: GatewayEndpoint, GatewayDiscovery, attachable |
| `hermes_cli/gateway_runtime_cli.py` | Machine-readable ensure boundary. — key API: ensure_exit_code, cmd_gateway_ensure |
| `hermes_cli/gateway_runtime_discovery.py` | Bounded local-control discovery without diagnostic fallback or mutation (the one exception: an — key API: DiscoveryError, _may_have_access_acl, home_mode_unsafe |
| `hermes_cli/gateway_runtime_multiplex.py` | Which daemon a named-profile client must start when nothing serves its home. — key API: multiplexer_root_for, implied_host_root, multiplexer_serves_home |
| `hermes_cli/gateway_runtime_replace.py` | Replace a gateway left running by an older Hermes on this install's own home. — key API: _install_root, _identify, _same |
| `hermes_cli/gateway_runtime_service.py` | Non-installing service-manager operations for an explicit canonical profile. — key API: RuntimeStartError, remaining, service_suffix |
| `hermes_cli/gateway_runtime_service_identity.py` | Read-only binding checks; unknown supervisor syntax is not profile absence. — key API: _unverified, _absolute, ForeignRoot |
| `hermes_cli/gateway_runtime_start.py` | One detached-process primitive; callers must first prove owner/service absence. — key API: spawn_unmanaged_gateway, start_detached_replacement, stdio_log_path |
| `hermes_cli/gateway_service_owner.py` | Who may write a gateway service definition (systemd unit, launchd plist). — key API: pinned_home, _resolve, service_home_for_unit |
| `hermes_cli/gateway_session_store.py` | ``HermesCLI._session_db`` backed by the shared gateway session (CALLMAP §3.5). — key API: _noop, _zero, GatewaySessionStore |
| `hermes_cli/gateway_setting_commands.py` | Per-session setting commands of the classic CLI on the shared gateway (``slash.exec``). — key API: _mirror_busy, _watch_reviewer, _unbounded |
| `hermes_cli/gateway_setup_service.py` | Gateway service setup orchestration; runtime startup is separate. — key API: record_service_choice, wants_service_install, ensure_gateway_service |
| `hermes_cli/gateway_setup_wizard.py` | Gateway platform setup wizard (hermes gateway setup): platform registry/status table, per-platform setup prompts, service offer. — key API: _gw, _all_platforms, _platform_status |
| `hermes_cli/gateway_side.py` | ``/bg`` and ``/btw`` on the shared gateway session (``prompt.background`` / ``prompt.btw``). — key API: connection_for, start |
| `hermes_cli/gateway_status_notes.py` | Notes `hermes gateway status` prints beside the running/not-running verdict. — key API: _incompatible_owner_verdict, report_incompatible_owner, print_standalone_by_config |
| `hermes_cli/gateway_supervised_restart.py` | ``hermes gateway restart`` for a gateway whose supervisor Hermes did not install. — key API: gateway_declares_external_supervisor, _wait_for_supervised_gateway_replacement, restart_externally_supervised_gateway |
| `hermes_cli/gateway_tools.py` | The background-process registry main's classic CLI reads, served by the gateway session. — key API: _Proc, GatewayProcessView, LocalSubagents |
| `hermes_cli/gateway_tools_notify.py` | Background-process notification turns the gateway admits for this CLI's session (W11). — key API: gateway_store, _card, queue_admitted_turn |
| `hermes_cli/gateway_windows.py` | Windows gateway service backend (Scheduled Task + Startup-folder fallback). — key API: _schtasks_encoding, _windows_console_encodings, _decode_schtasks_output |
| `hermes_cli/gateway_windows_legacy.py` | Pre-suffix Windows gateway launchers: the objects the current per-profile names cannot reach. — key API: _w, _targets_this_home, legacy_launcher_artifacts |
| `hermes_cli/git_credentials.py` | Non-interactive HTTPS credentials for Hermes's internal git clones (private plugin/MCP/profile repos). — key API: _https_origin, _env_github_token, _gh_cli_token |
| `hermes_cli/git_pack_tidy.py` | Progressive, time-boxed cleanup of a partial clone's promisor packfiles (#129712). — key API: TidyResult, _Index, _git_env |
| `hermes_cli/github_api.py` | Credentials and failure copy for the update check's api.github.com calls. — key API: github_token_from_env, _gh_cli_token, github_token |
| `hermes_cli/gitlock.py` | Stale git lock-file and aborted-fetch pack-debris recovery for update/check paths. — key API: _git_proc_running, _sweep_stale, clear_stale_git_locks |
| `hermes_cli/goal_command.py` | The CLI's /goal semantics, shared by every goal command surface. — key API: GoalCommandResult, _english, _status |
| `hermes_cli/gui_uninstall.py` | Hermes Desktop (Chat GUI) uninstaller: removes only GUI state — built Electron artifacts, the packaged — key API: _logger, _env_dir, desktop_userdata_dir |
| `hermes_cli/home_data_layout.py` | Machine-specific state excluded from portable home transfers. — key API: profile_root_entry |
| `hermes_cli/image_provenance.py` | Image-authored deployment provenance for immutable Hermes runtimes. — key API: ImageProvenance, _invalid, _optional_string |
| `hermes_cli/init_command.py` | ``/init`` — build the prompt that asks the agent to generate or update a project AGENTS.md. — key API: build_init_prompt, _resolve_session_cwd, build_init_prompt_for_cwd |
| `hermes_cli/input_sanitize.py` | Sanitize user prompt text leaked from terminal / paste control sequences. — key API: strip_leaked_bracketed_paste_wrappers, collapse_repeated_input_artifacts, sanitize_user_prompt_text |
| `hermes_cli/install_identity.py` | Stable opaque identity shared by every profile in one Hermes install. — key API: _install_id_file_lock, _read_existing, read_or_create_install_id |
| `hermes_cli/install_state.py` | Has this OS user already used Hermes on this computer? — key API: Evidence, Finding, InstallState |
| `hermes_cli/inventory.py` | Provider/model inventory — shared substrate for the dashboard ``/api/model/options``, the TUI — key API: ConfigContext, load_picker_context, _slug |
| `hermes_cli/journey.py` | ``hermes journey`` — what Hermes has learned, on a timeline. — key API: _build_payload, _primary_hex, _palette |
| `hermes_cli/kanban.py` | ``hermes kanban …`` — dispatch (``kanban_command``), task-verb handlers, ``run_slash`` for ``/kanban``. — key API: _none_profile, _parse_metadata_flag, _run_state_kwargs |
| `hermes_cli/kanban_boards.py` | ``hermes kanban boards …`` — board directories, the ``current`` pointer and ``board.json``. — key API: _dispatch_boards, _board_task_counts, _board_slug_arg |
| `hermes_cli/kanban_db.py` | SQLite-backed Kanban board shared across profiles (the cross-profile coordination primitive). — key API: _lossy_text, _row_get, _json_or |
| `hermes_cli/kanban_db_boards.py` | Board metadata (``board.json``) and board lifecycle management for the Kanban DB: — key API: _dir_holds_board, board_metadata_path, _default_board_display_name |
| `hermes_cli/kanban_db_connect.py` | SQLite connection lifecycle for the Kanban DB: open/configure, cross-process init and dispatch-tick locks, WAL checkpoints, corruption detection + quarantine + repair, additive migrations… — key API: _resolve_busy_timeout_ms, _sqlite_connect, _try_lock_nb |
| `hermes_cli/kanban_db_context.py` | Worker-context rendering for ``build_worker_context``: the capped markdown sections a spawned — key API: _relative_age, _ctx_cap, _ctx_stamp |
| `hermes_cli/kanban_db_dispatch.py` | Dispatcher: crash/stale/orphan detection, failure accounting and the respawn circuit breaker, memory-aware concurrency caps, the one-shot ``dispatch_once`` pass, worker spawning (``_defau… — key API: DispatchResult, describe_suppression, _wait_status_from_returncode |
| `hermes_cli/kanban_db_graph.py` | Task graph initialization and atomic decomposition persistence. — key API: inherit_creator_origin, initial_task_state, _validate_children_graph |
| `hermes_cli/kanban_db_notify.py` | Notification subscriptions consumed by the gateway kanban-notifier: per-(task, platform, chat, thread) rows with delivery metadata, unseen-event cursors and purge of stale done-task subs. — key API: _sub_key, _encode_notify_delivery_metadata, _decode_notify_delivery_metadata |
| `hermes_cli/kanban_db_workspace.py` | Task workspace lifecycle: scratch/dir/worktree resolution (incl. — key API: _path_key, _git, _has_active_children |
| `hermes_cli/kanban_diagnostics.py` | Kanban diagnostics — structured, actionable distress signals for tasks. — key API: severity_at_or_above, DiagnosticAction, Diagnostic |
| `hermes_cli/kanban_ops.py` | Dispatcher and maintenance verbs for ``hermes kanban``: ``dispatch``, — key API: _kanban_config, _poll_loop, _cmd_tail |
| `hermes_cli/kanban_output.py` | Text / ``--json`` output helpers shared by the ``hermes kanban`` CLI modules. — key API: _fmt_ts, _print_json, _json_out |
| `hermes_cli/kanban_owner_recovery.py` | Read-only canonical admission fences for dispatcher reclaim paths. — key API: owner_reclaim_paused, _latest_run_event, _host_local_lock |
| `hermes_cli/kanban_parser.py` | Argparse tree for ``hermes kanban …`` (``build_parser``). — key API: _arg, _cmd, _add_commands |
| `hermes_cli/kanban_pr_acceptance.py` | Exact-head GitHub acceptance for explicitly declared PR tasks. — key API: validate_contract, _api, _GateAuthError |
| `hermes_cli/kanban_pr_acceptance_store.py` | Persist acceptance with the same ownership snapshot as the terminal write. — key API: _snapshot, prepare_acceptance, record_acceptance |
| `hermes_cli/kanban_specify.py` | Kanban triage specifier — flesh out a one-liner into a real spec. — key API: SpecifyOutcome, _truncate, _extract_json_blob |
| `hermes_cli/kanban_transfer.py` | Kanban board export / import — move a whole board between machines. — key API: _placeholders, _snapshot_db, _scrub_local_state |
| `hermes_cli/kanban_worker_client.py` | Dispatcher subprocess: submit one claim to its profile owner; never run an agent.""" # Spawned as a bare ``sys.executable -m``: in a PM install that interpreter carries no dependencies # … — key API: admission_answer_budget, run, _discard |
| `hermes_cli/kanban_worker_log.py` | Per-task worker log rotation, split out of ``hermes_cli.kanban_db_dispatch``. — key API: worker_log_rotation_config, _rotated_log_path, rotate_worker_log |
| `hermes_cli/kanban_workflow.py` | Kanban board workflow: the one definition of board columns and manual moves. — key API: Column, Workflow, _frozen_manual |
| `hermes_cli/left_core_migration.py` | Move a home onto the catalog plugin of a feature that left core. — key API: _read_config, platform_configured_on, _toolset_listed |
| `hermes_cli/lifecycle.py` | Hermes lifecycle dispatch for first-party observers and plugins. — key API: _observe, _plugin_hooks, invoke_hook |
| `hermes_cli/linux_desktop_entry.py` | Install and remove the Linux desktop entry (``<app_id>.desktop``). — key API: is_supported, _xdg_data_home, desktop_entry_path |
| `hermes_cli/local_runtime/__init__.py` | Managed llama.cpp runtime. — key API: __getattr__ |
| `hermes_cli/local_runtime/binaries.py` | Hardware selection for PM-owned llama.cpp binaries; mutable runtime state stays separate. — key API: BinaryResolutionError, Engine, runtimes_root |
| `hermes_cli/local_runtime/bootstrap.py` | Bootstrap for the managed runtime: config -> installed binaries -> running supervised server. — key API: _stop_at_exit, _detect_gpu_vendor, models_dir |
| `hermes_cli/local_runtime/capabilities.py` | Capability answers for models served by the managed runtime. — key API: is_managed_provider, _props_modalities, managed_model_supports_vision |
| `hermes_cli/local_runtime/catalog.json` |  |
| `hermes_cli/local_runtime/catalog.py` | Curated starter catalog for the managed local runtime. — key API: AssetFile, QuantVariant, CatalogEntry |
| `hermes_cli/local_runtime/context_policy.py` | Context policy — the window ladder for managed local models. — key API: ladder, WindowDecision, initial_window |
| `hermes_cli/local_runtime/detect.py` | Detection of running llama-server instances. — key API: DetectedServer, _get, probe_port |
| `hermes_cli/local_runtime/devices.py` | Ask the installed llama.cpp build which accelerators it sees, in a disposable process. — key API: probe_devices, _library, _read_devices |
| `hermes_cli/local_runtime/endpoint.py` | Endpoint resolution for llamacpp-alias requests (provider integration). — key API: child_query, _pid_alive, _state_endpoint |
| `hermes_cli/local_runtime/estimator.py` | Per-layer context-memory estimator + physics check. — key API: _expand_swa_period, LayerKind, ModelProfile |
| `hermes_cli/local_runtime/gguf.py` | GGUF metadata + tensor-table reader (stdlib only). — key API: model_id_from_stem, GGUFHeader, split_parts |
| `hermes_cli/local_runtime/growth.py` | In-session context growth for the managed llama.cpp runtime. — key API: window_overrides_path, load_window_overrides, _write_overrides |
| `hermes_cli/local_runtime/hardware.py` | Live hardware budget probe. — key API: _stdout, _linux_meminfo_text, _linux_ram_from_meminfo |
| `hermes_cli/local_runtime/hf_browse.py` | Browse Hugging Face for GGUF models the user can run. — key API: _get_json, HFModelHit, HFFileGroup |
| `hermes_cli/local_runtime/load_progress.py` | Live model-load progress from the managed llama-server router. — key API: _pct, _composite_percent, _endpoint |
| `hermes_cli/local_runtime/presets.py` | Per-model preset generation (--models-preset INI) — the router-side carrier for context-policy — key API: PresetEntry, _args_to_keys, _asset_path |
| `hermes_cli/local_runtime/processes.py` | Contain each managed Windows router tree without adopting the owner process. — key API: _BasicLimits, _IoCounters, _ExtendedLimits |
| `hermes_cli/local_runtime/recovery.py` | Conservative recovery of the one router recorded by this managed runtime. — key API: read_state, is_modern, _valid_pid |
| `hermes_cli/local_runtime/supervisor.py` | Supervision of one llama-server in router mode. — key API: state_path, _quiet, _free_port |
| `hermes_cli/macos_signing.py` | Managed interpreter identity, available before PM or application imports. — key API: sign_managed_python |
| `hermes_cli/macos_tcc_anchor.py` | Stable macOS TCC anchor for the uv-managed Python interpreter. — key API: _BootGateFailed, _marker_value, is_macos |
| `hermes_cli/main_agent_cmds.py` | Agent-facing subcommand handlers: memory, acp, tools, insights, monitoring, skills (+trust). — key API: _cmd_memory_off, _cmd_memory_reset, cmd_memory |
| `hermes_cli/main_container.py` | NixOS container mode: route a ``hermes`` invocation into the managed container (``main()``). — key API: _probe_container, exec_in_container |
| `hermes_cli/main_dashboard.py` | Dashboard/serve support: managed-service restart (systemd/respawn), status/listening probes, SSH session token file, named-profile routing, web-dist resolution, update stdio hangup protec… — key API: _find_stale_dashboard_pids, _parse_dashboard_runtime, _dashboard_probe_host |
| `hermes_cli/main_dep_hints.py` | Repair guidance for an unavailable declared dependency group. — key API: missing_optional_deps_message, smart_app_control_block_message |
| `hermes_cli/main_desktop.py` | Desktop (Electron) app: build/stamp, stage-and-swap pack, exe integrity gate, macOS signing, Linux sandbox, launch (hermes gui/desktop). — key API: _desktop_dist_exists, _renderer_bundle_dir, _packaged_resources_dir |
| `hermes_cli/main_desktop_tcc.py` | ``hermes gui --setup-tcc-identity``: a persistent self-signed macOS code-signing identity. — key API: _macos_codesigning_identity_valid, _macos_create_signing_identity, _desktop_macos_setup_tcc_identity |
| `hermes_cli/main_install_repair.py` | Update dependency diagnostics, historical markers and Windows launcher recovery. — key API: _pyproject_project, _update_marker_path, _lazy_refresh_marker_path |
| `hermes_cli/main_platform_setup.py` | Interactive messaging-platform setup wizards: WhatsApp (bridge + Cloud API), Slack manifest. — key API: _err, _yes_no, _whatsapp_choose_mode |
| `hermes_cli/main_profile_recovery.py` | Which commands may run in the default home when the sticky ``active_profile`` is gone. — key API: _uninstall_keeps_data, is_stale_profile_recovery_command |
| `hermes_cli/main_provider_setup.py` | Provider setup wizard helpers: provider picker, custom-provider save/remove, auxiliary-model — key API: _is_profile_api_key_provider, _short_url, _clear_stale_openai_base_url |
| `hermes_cli/main_query_file.py` | ``--query-file``: the single-query transport that never passes through a shell. — key API: _read_query_file |
| `hermes_cli/main_resume_args.py` | ``hermes chat`` resume-argument steps split out of ``hermes_cli.main``: ``--resume @claude/@codex`` — key API: import_foreign_resume, _frozen_cwd, recreate_resumed_tui_worktree |
| `hermes_cli/main_tui_launch.py` | TUI (ui-tui) launcher: prepared source builds and argv/env assembly. — key API: _bypass_chat_launch, _read_tui_active_session_file, _short_resume_id |
| `hermes_cli/main_web_build.py` | Dashboard build freshness/serialization and checkout bytecode sweep. — key API: _record_bytecode_fingerprint, _sweep_stale_bytecode_if_checkout_changed, _web_project_root |
| `hermes_cli/managed_scope.py` | Managed scope — IT-pushed, user-immutable config & env layer. — key API: _under_pytest, get_managed_dir, invalidate_managed_cache |
| `hermes_cli/managed_uv.py` | Shims to stop the old updater doing work until relaunch. — key API: _reload_hermes_constants, ensure_uv, update_managed_uv |
| `hermes_cli/mcp_catalog.py` | MCP catalog — curated, Nous-approved MCP servers shipped with the repo. — key API: EnvVarSpec, AuthSpec, TransportSpec |
| `hermes_cli/mcp_config.py` | MCP Server Management CLI — ``hermes mcp`` subcommand. — key API: _credential_header_names, _probe_redaction_res, _mask_header_field_value |
| `hermes_cli/mcp_picker.py` | MCP picker — interactive `hermes mcp picker` (also the default `hermes mcp`). — key API: _Row, _build_rows, _format_row |
| `hermes_cli/mcp_security.py` | Security checks for user-configured MCP server entries. — key API: _command_basename, _inline_script, _entry_text |
| `hermes_cli/mcp_startup.py` | Shared CLI/TUI-safe helpers for background MCP discovery. — key API: set_mcp_server_filter, get_mcp_server_filter, _has_configured_mcp_servers |
| `hermes_cli/memory_oauth.py` | HTTP routes for memory-provider OAuth connect, mounted by ``web_server``. — key API: _resolve_flow, _scope_to_profile, start_memory_oauth |
| `hermes_cli/memory_provider_migration.py` | Move a user from a memory provider that left core onto its catalog plugin. — key API: _failure_stamp, _failure_count, _note_failure |
| `hermes_cli/memory_setup.py` | hermes memory setup|status — configure memory provider plugins. — key API: _curses_select, _print_cancelled_setup, _clear_interactive_transition |
| `hermes_cli/middleware.py` | Hermes middleware contract helpers. — key API: RequestMiddlewareResult, observer_payload, middleware_payload |
| `hermes_cli/migrate.py` | CLI handlers for ``hermes migrate ...``. — key API: cmd_migrate, _fail, cmd_migrate_xai |
| `hermes_cli/model_catalog.py` | Remote model catalog fetcher. — key API: _load_catalog_config, _cache_path, _fetch_manifest |
| `hermes_cli/model_data_policy_guard.py` | Data-policy confirmation helpers for model selection surfaces. — key API: DataTrainingWarning, _is_meta_contributor, data_training_warning |
| `hermes_cli/model_normalize.py` | Per-provider model name normalization. — key API: _normalize_for_deepseek, _strip_vendor_prefix, _dots_to_hyphens |
| `hermes_cli/model_search.py` | Picker-only search aliases for model ids. — key API: model_alias_canonical, model_search_text |
| `hermes_cli/model_setup_flows.py` | Per-provider model-selection wizard flows for ``hermes setup`` / ``hermes model``. — key API: _env_base_url, _prompt_base_url_override, _report_live_models |
| `hermes_cli/model_setup_flows_azure.py` | Azure Foundry wizard (OpenAI-style or Anthropic-style transport, API-key or Entra ID auth). — key API: _azure_mode_label, _AzureCurrent, _azure_current |
| `hermes_cli/model_setup_flows_bedrock.py` | AWS Bedrock wizards: native Converse API (IAM chain, region-scoped model discovery) — key API: bedrock_region_geo_prefix, bedrock_model_routable_from_region, _model_flow_bedrock_api_key |
| `hermes_cli/model_setup_flows_common.py` | Shared skeleton for the ``_model_flow_*`` wizards: banner, credentials, model list, picker, — key API: _note_setup_failure, _say, _ask |
| `hermes_cli/model_setup_flows_custom.py` | Custom OpenAI-compatible endpoint wizards: the ad-hoc ``custom`` flow and the — key API: _parse_context_length, _report_context_length_detection, _probe_custom_endpoint |
| `hermes_cli/model_setup_flows_local.py` | ``hermes model`` → Local models: the desktop's Local Models setup, in the terminal. — key API: local_models_available, _fmt_eta, _rate |
| `hermes_cli/model_switch.py` | Shared model-switching logic for the CLI and gateway /model commands. — key API: _declared_model_ids, _declared_item_id, _entry_models_discovered |
| `hermes_cli/model_switch_providers.py` | Picker provider listing: credential discovery, curated/live model lists, row builders for — key API: _save_discovered_models_to_config, _discovered_catalog_stale, _NativePickerModelList |
| `hermes_cli/models.py` | Provider/model catalogs: discovery, caching, and identity helpers. — key API: _urlopen_model_catalog_request, _get_json, _read_json_cache |
| `hermes_cli/models_cache_lock.py` | Cross-process lock for ``provider_models_cache.json`` read-modify-write. — key API: provider_models_cache_lock, write_under_cache_lock |
| `hermes_cli/models_catalog_static.py` | Static provider/model catalog tables (data only — no network). — key API: CuratedFallbackModels, _codex_curated_models, _xai_promote_top |
| `hermes_cli/models_detect.py` | Live-catalog and credential guards for ``detect_provider_for_model``. — key API: current_provider_catalog_match, current_provider_owns_vendor, provider_has_credentials |
| `hermes_cli/models_local.py` | Local / self-hosted model servers. — key API: _strip_suffixes, _normalize_openai_base_url, _root_for_ollama_native_api |
| `hermes_cli/models_pricing.py` | Live model pricing. — key API: _cached_catalog, _cache_catalog, _pricing_auth_fingerprint |
| `hermes_cli/models_profile_cache.py` | Per-profile view of ``hermes_cli.models``' module-level catalog slots. — key API: profile_slot_get, profile_slot_set |
| `hermes_cli/models_reasoning_caps.py` | Per-model reasoning capabilities from OpenRouter-schema ``/v1/models`` catalogs. — key API: _origin, parse_openrouter_reasoning_capabilities, _reasoning_caps_disk_path |
| `hermes_cli/models_validate.py` | Validate a requested ``/model`` value against the active provider's catalog. — key API: _verdict, _accept, _accept_with_note |
| `hermes_cli/nous_account.py` | Normalized Nous Portal account entitlement helpers. — key API: NousPortalSubscriptionInfo, NousPaidServiceAccessInfo, NousToolAccessInfo |
| `hermes_cli/nous_auth_keepalive.py` | Background keepalive for long-lived Nous Portal sessions. — key API: _timeout_seconds, _nous_config, _interval_seconds |
| `hermes_cli/nous_billing.py` | Nous Portal Remote Spending HTTP client. — key API: BillingError, BillingScopeRequired, BillingAuthError |
| `hermes_cli/nous_subscription.py` | Helpers for Nous subscription managed-tool capabilities. — key API: _FeatureSpec, _uses_gateway, _selected_provider |
| `hermes_cli/npm_engine.py` | Stop an already-running old updater before its retired npm retry path. — key API: maybe_repair_npm_engine |
| `hermes_cli/observability/__init__.py` | First-party Hermes observability integrations. — key API: observe_lifecycle, handles_hook |
| `hermes_cli/observability/relay_shared_metrics.py` | Direct NeMo Relay integration for Hermes shared client metrics. — key API: _text, _session_pair, _retry_ordinal |
| `hermes_cli/observability/shared_metrics_catalog.py` | Public-name catalogs for shared metrics: the only non-enum names a package may carry. — key API: _skill_dir_names, _yaml_stems, slash_command_names |
| `hermes_cli/observability/shared_metrics_connectors.py` | Connector work in the shared metrics: the search-to-execute chain and the batch and search rows. — key API: is_connector_name, _call_entries, is_connector_batch |
| `hermes_cli/observability/shared_metrics_consent.py` | The one shared-metrics consent answer, and the terminal's first-run offer. — key API: _section, consent_state, _current_state |
| `hermes_cli/observability/shared_metrics_desktop.py` | Shared-metrics facts the Desktop app reports about itself: area use, friction, first-run steps, — key API: _utc_day, _home, _word |
| `hermes_cli/observability/shared_metrics_disabled.py` | hermes.feature_disabled.count: a user turns off something Hermes ships on, or removes something shipped. — key API: set_process_surface, current_surface, _bundled_plugin_names |
| `hermes_cli/observability/shared_metrics_drift.py` | Rows an earlier build or catalog stored whose values the current contract no longer lists. — key API: counter_dimensions_shape_is_known, conform_counter_dimensions |
| `hermes_cli/observability/shared_metrics_engagement.py` | Daily engagement rollup, per-conversation session tally and turns-before-switch. — key API: active_minutes_bucket, surfaces_used_bucket, turns_before_switch_bucket |
| `hermes_cli/observability/shared_metrics_events.py` | Call-site API for process-level shared-metrics facts. — key API: _emit, emit_saved, record_setup_completed |
| `hermes_cli/observability/shared_metrics_fields.py` | Bounded field builders for the decision-data shared metrics. — key API: _number, provider_identifier, session_fields |
| `hermes_cli/observability/shared_metrics_gateway.py` | Call-site API for messaging-gateway and cron shared metrics. — key API: _submit, _guarded, drain |
| `hermes_cli/observability/shared_metrics_harness.py` | Agent-harness accuracy shared metrics: file-edit matching, loop guards, recovery after a tool — key API: _enabled, _record, _background_tool_call |
| `hermes_cli/observability/shared_metrics_install.py` | Install-snapshot fields for version lag, release channel and coarse hardware. — key API: _sub, _safe, _version_info |
| `hermes_cli/observability/shared_metrics_install_run.py` | hermes.install.run: fresh installs through scripts/install.sh and scripts/install.ps1. — key API: pending_installs_dir, purge_pending_installs, _epoch |
| `hermes_cli/observability/shared_metrics_model.py` | Per-model quality, friction and context-pressure shared metrics. — key API: model_route, window_bucket, friction_fields |
| `hermes_cli/observability/shared_metrics_process.py` | hermes.process.exit: how Hermes processes (and watchdog-killed turns) end. — key API: crash_class, markers_dir, _write_marker |
| `hermes_cli/observability/shared_metrics_send_config.py` | Configuration for shared-metrics transmission. — key API: SendConfig, _endpoint_is_safe, resolve_send_config |
| `hermes_cli/observability/shared_metrics_sender.py` | Transmit exported shared-metrics packages to the Nous telemetry service. — key API: _parse_stamp, SendOutcome, _Response |
| `hermes_cli/observability/shared_metrics_setup.py` | hermes.provider_setup.count: where connecting a model provider starts, succeeds, fails or is walked away from. — key API: SetupFlow, markers_dir, _bound |
| `hermes_cli/observability/shared_metrics_signals.py` | v5 signals: which disabled built-in tools models reach for, and when an install first adopts a feature. — key API: tool_unavailable_fields, _success, _tool |
| `hermes_cli/observability/shared_metrics_snapshot.py` | Collect the once-a-day install configuration snapshot for shared metrics. — key API: _sub, _mcp_server_count, _plugin_count |
| `hermes_cli/observability/shared_metrics_startup.py` | Startup / attach latency: one bucketed row per process start and surface. — key API: latency_bucket, startup_latency_fields, record_startup_latency |
| `hermes_cli/observability/shared_metrics_subscriber.py` | Relay subscriber for the persisted Hermes shared-metrics slice. — key API: _named, SharedMetricsSubscriber |
| `hermes_cli/observability/shared_metrics_update.py` | Shared-metrics facts for ``hermes update`` runs and Desktop self-updates. — key API: _fleet_bad, _restart_incomplete, _named_stop |
| `hermes_cli/old_updater_deps.py` | Retired dependency hooks requested by already-running historical updaters. — key API: _capture_active_lazy_features, _refresh_active_lazy_features, _refresh_active_memory_provider_dependencies |
| `hermes_cli/old_updater_main.py` | Frozen main.py imports for updater code still running after a checkout swap. — key API: ShimQuarantineError, _desktop_stamp_path, _detect_broken_lazy_refresh_imports |
| `hermes_cli/onboarding_due.py` | The desktop's boot question, answered once: is onboarding due, and can something carry it. — key API: begin_boot, read, invalidate |
| `hermes_cli/onboarding_run.py` | ``onboarding.run``: whether the desktop first-run onboarding opens on the next launch. — key API: _root_config, should_run, _explicit_run |
| `hermes_cli/onepassword_secrets_cli.py` | CLI handlers for ``hermes secrets onepassword ...``. — key API: _op_cfg, _op_cfg_for_write, _references |
| `hermes_cli/pairing.py` | CLI commands for the DM pairing system. — key API: pairing_command, _cmd_list, _cmd_approve |
| `hermes_cli/personality.py` | Single owner for personality overlays. — key API: _get, prompt_text, render_personality_prompt |
| `hermes_cli/pets.py` | CLI subcommand: ``hermes pets <subcommand>``. — key API: _err, _cmd_list, _cmd_install |
| `hermes_cli/platform_actions.py` | Capability-gated platform action facade for plugins (#64176, action half). — key API: _err, _ok, _telegram_add_reaction |
| `hermes_cli/platforms.py` | Shared platform registry for Hermes Agent. — key API: PlatformInfo, _plugin_label, platform_label |
| `hermes_cli/plugin_capabilities.py` | Plugin capability declarations + consent state. — key API: CapabilitySpec, parse_declared_capabilities, _known |
| `hermes_cli/plugin_catalog.py` | Plugin catalog — curated, Nous-approved Hermes plugins shipped with the repo. — key API: is_allowed_image_url, RemovedEntry, CatalogCapabilities |
| `hermes_cli/plugin_catalog_presence.py` | Whether the desktop app a catalog plugin drives is on this machine, before the plugin is installed. — key API: Presence, _raw_manifest_url, _pinned_manifest |
| `hermes_cli/plugin_command_dispatch.py` | Compatibility-aware call boundary for plugin slash-command handlers. — key API: invoke_plugin_command |
| `hermes_cli/plugin_compat.py` | Frozen exports for ``hermes update`` processes that predate the plugin compat layer's removal. — key API: compat_report, removal_in_effect, summary_lines |
| `hermes_cli/plugin_dev.py` | Runtime-backed validation behind ``hermes plugins doctor``: every manifest/import/registration — key API: _DoctorLoadError, _deny_network, _doctor_runtime |
| `hermes_cli/plugin_events.py` | Public event bridge for plugin backends (``plugin_api.py``, slash commands). — key API: plugin_event_name, broadcast_plugin_event |
| `hermes_cli/plugin_host.py` | Parent side of the plugin host: one process per profile that runs its third-party plugins. — key API: PluginHost, _ObjectSlot, _holds_live_handle |
| `hermes_cli/plugin_host_child.py` | The plugin host process: imports third-party plugins and serves their callbacks to Hermes. — key API: RemoteRegistration, RemoteFacade, RemotePluginContext |
| `hermes_cli/plugin_host_http_auth.py` | Carry route-local admission over the private plugin-host channel, without credentials. — key API: admitted_for_sensitive_route, with_hosted_admission |
| `hermes_cli/plugin_host_profiles.py` | Model-provider plugins under ``plugins.isolation: host``. — key API: load_hosted_profiles, _fingerprint, _cached_extraction |
| `hermes_cli/plugin_host_wire.py` | Wire format for the plugin host: framed JSON-RPC in both directions plus a value codec. — key API: PluginHostError, PluginHostUnavailable, PluginHostUnsupported |
| `hermes_cli/plugin_install_phase.py` | The slow steps of a plugin install, as ids. — key API: InstallPhase |
| `hermes_cli/plugin_messages.py` | ``PluginContext.post_message``: one message in the current conversation, editable in place. — key API: _err, PluginMessage, _gateway_loop |
| `hermes_cli/plugin_oauth.py` | OAuth clients a plugin declares in ``plugin.yaml``: Hermes signs in, stores and refreshes the grant. — key API: OAuthClient, _parse_url, _url_problems |
| `hermes_cli/plugin_packs.py` | Plugin packs — declarative, shareable plugin sets. — key API: PackError, PackPluginEntry, PluginPack |
| `hermes_cli/plugin_provider_requests.py` | Signed-in provider requests that core makes FOR plugins; the token never reaches plugin code. — key API: ProviderNotSignedIn, ProviderResponse, _codex_auth |
| `hermes_cli/plugin_session.py` | The session a plugin hook or tool is running for, read from the turn's task-local context. — key API: _active_policy, session_key, session_surface |
| `hermes_cli/plugin_validate.py` | ``hermes plugins validate`` — admission checks for a plugin directory. — key API: ValidationReport, _requires_hermes_spec_valid, _check_manifest_fields |
| `hermes_cli/plugin_validate_core_override.py` | Admission lint: a catalog plugin must not rebind Hermes core at runtime. — key API: _hermes_top_level, _is_test_file, _python_files |
| `hermes_cli/plugin_validate_desktop.py` | Static admission lint for a plugin's Desktop surface (``plugin.js`` / ``desktop/plugin.js``). — key API: _strip_comments, _mask_regex_literals, desktop_surface_findings |
| `hermes_cli/plugin_validate_locales.py` | ``hermes plugins validate`` — language-pack checks (``provides_locales``). — key API: _bundled_locales_dir, reference_keys, _load_document |
| `hermes_cli/plugin_validate_private_imports.py` | Admission lint: name a plugin's imports of private Hermes core modules (a warning, never a refusal). — key API: _hermes_packages, _local_modules, _type_checking_nodes |
| `hermes_cli/plugins.py` | Hermes Plugin System — discovers, loads, and manages plugins. — key API: get_bundled_plugins_dir, PluginToolOverrideError, _install_plugin_debug_handler |
| `hermes_cli/plugins_activation.py` | Mid-run plugin activation: what a just-loaded plugin does NOW vs next session (#87770). — key API: plugin_activation_summary, activation_summaries, find_activation |
| `hermes_cli/plugins_activation_live.py` | Make an installed plugin's MCP servers and skills usable in THIS process now (#87770 follow-up). — key API: connect_plugin_mcp, _utility_suffixes, _server_error |
| `hermes_cli/plugins_admission.py` | Submit proposed plugin selections to the independent PM publisher. — key API: AdmissionRefused, DependencyConflict, candidate_member_dirs |
| `hermes_cli/plugins_aux_tasks.py` | Validation and entry shape for ``PluginContext.register_auxiliary_task``. — key API: build_auxiliary_task_entry |
| `hermes_cli/plugins_cadence.py` | The plugin update-check cadence: read-only, receipt-surfaced. — key API: _marker_path, _results_path, snapshot_installs |
| `hermes_cli/plugins_cmd.py` | ``hermes plugins`` CLI subcommand — install, update, remove, and list plugins. — key API: _resolve_git_executable, PluginOperationError, PluginScanBlocked |
| `hermes_cli/plugins_cmd_capabilities.py` | Capability consent (#64228): declared-vs-granted reads, the consent screen, ``hermes plugins — key API: _pc, _set_plugin_entry_flag, _declared_capabilities_from_manifest |
| `hermes_cli/plugins_cmd_catalog.py` | ``hermes plugins`` catalog surface: resolution, provenance sidecar, search/browse/info/validate, — key API: looks_like_catalog_name, raise_if_removed, resolve_catalog_name |
| `hermes_cli/plugins_cmd_git.py` | Plugin install metadata (``.install-metadata.json`` source/revision/pin records) and the git plumbing — key API: _pc, _install_metadata_path, _read_install_metadata |
| `hermes_cli/plugins_cmd_install.py` | ``hermes plugins install``: dependency/env consent, the atomic clone-scan-publish installer core, and — key API: shared_dependency_answers, _ask_yes_no, _pc |
| `hermes_cli/plugins_cmd_listing.py` | Read-only presentation: ``hermes plugins list``, ``show`` and ``compat``. — key API: _pc, _filter_plugin_entries, _entry_status |
| `hermes_cli/plugins_cmd_remove.py` | ``hermes plugins remove``: tree + install-metadata removal kept consistent, config bookkeeping, and the — key API: _pc, _pending_delete_root, sweep_pending_plugin_deletes |
| `hermes_cli/plugins_cmd_toggle.py` | The interactive ``hermes plugins`` composite UI: general-plugin checkboxes (saved through the one — key API: _pc, _discover_memory_providers, _discover_context_engines |
| `hermes_cli/plugins_cmd_update.py` | ``hermes plugins update`` plus the provenance verbs around it: ``adopt``, ``trust-update-url`` and the — key API: _pc, _pull_plugin_update, _reclone_plugin_update |
| `hermes_cli/plugins_cmd_update_all.py` | ``hermes plugins update`` with no name: update every installed plugin that has an update. — key API: _pc, UpdatePlan, plan_update_all |
| `hermes_cli/plugins_content.py` | Content registrars on ``PluginContext``: plugin skills and Automation Blueprints. — key API: register_skill, register_automation_blueprint |
| `hermes_cli/plugins_discovery.py` | Plugin discovery: directory scanning, entry-point manifests, and the enable/disable gate. — key API: suppress_plugin_discovery, plugin_discovery_suppressed, _select_entry_point_group |
| `hermes_cli/plugins_dispatch.py` | Plugin hook / middleware / event-bus / system-prompt-section dispatch. — key API: _policy_error_block_directive, is_valid_system_prompt_section_id, format_system_prompt_section |
| `hermes_cli/plugins_injection.py` | Host routing for ``PluginContext.inject_message``: classic CLI REPL, Ink TUI / desktop, messaging — key API: inject_plugin_message |
| `hermes_cli/plugins_loader.py` | Plugin loading: directory/entry-point module import, deferred bundled platforms, portable packages, — key API: PluginLoadTimeout, in_plugin_load_worker, _resolve_plugin_load_timeout |
| `hermes_cli/plugins_manifest.py` | Plugin manifest model and parsing (``plugin.yaml`` v1/v2, portable ``plugin.json``). — key API: _plugins_debug, _portable_skill_namespace, _portable_slug |
| `hermes_cli/plugins_provenance.py` | Plugin provenance: the 2x2 reconciliation of install metadata. — key API: ProvenanceClass, Provenance, read_sidecar_rows |
| `hermes_cli/plugins_settings.py` | Plugin-declared settings fields for the Desktop/TUI Plugins hub (#46600, #87934). — key API: _manifest_config_schema, _portable_config_schema, secret_env_name |
| `hermes_cli/plugins_state.py` | Plugin-owned durable state and namespaced settings helpers (split out of hermes_cli.plugins). — key API: _plugin_relative_segments, _nested_plugin_value, _nested_plugin_mapping |
| `hermes_cli/plugins_transaction.py` | Publish plugin code and its dependency selection through one recoverable handoff. — key API: recover_plugin_publication, publish_plugin, _refresh_declared_dependencies |
| `hermes_cli/plugins_updates.py` | Plugin update checks — the standard, read-only 'is it outdated?' verb. — key API: _version_is_newer, CheckResult, _read_manifest_field |
| `hermes_cli/portal_cli.py` | ``hermes portal`` — the human-readable entry point for Nous Portal. — key API: _feature_state, _heading, _cmd_status |
| `hermes_cli/post_update.py` | Home maintenance shared by explicit updates and bounded boot maintenance. — key API: _backup_path, _backup_existing, _restore_backups |
| `hermes_cli/process_identity.py` | Process identity: spawn tags, the machine-wide spawn ledger, and the Windows job-object self-attach. — key API: install_id, process_birth, _process_create_time |
| `hermes_cli/profile_channels.py` | Messaging-channel settings a profile clone must NOT inherit. — key API: _plugin_scope, platform_env_prefixes, _registry_entries |
| `hermes_cli/profile_cmd.py` | ``hermes profile`` command — one handler per action, dispatched by ``PROFILE_ACTIONS``. — key API: _die, _confirm, _is_active |
| `hermes_cli/profile_describer.py` | Profile describer — auto-generate ``description`` for a profile. — key API: DescribeOutcome, _collect_skills, _sample_skills |
| `hermes_cli/profile_distribution.py` | Profile distributions — shareable, packaged Hermes profiles via git. — key API: _is_installer_owned_path, DistributionError, _str |
| `hermes_cli/profile_identity.py` | Rekey a renamed profile's durable identity (#111926), and purge a deleted profile's (#112727). — key API: migrate_profile_identity, purge_profile_identity, _purge_profile_identity |
| `hermes_cli/profile_memory_config.py` | Carry the ACTIVE memory provider's own config into a ``--clone`` (#120115). — key API: active_memory_provider, clone_memory_provider_config, cloned_memory_provider |
| `hermes_cli/profile_model_seed.py` | Copy the model and its selected custom endpoint into a new profile, and merge that endpoint — key API: _requested_provider, _expand_routing_fields, _routing_view |
| `hermes_cli/profiles.py` | Profile management for multiple isolated Hermes instances. — key API: _non_exportable_entries, _clone_all_copytree_ignore, _fold |
| `hermes_cli/profiles_honcho.py` | Honcho host-block migration for ``hermes profile rename``. — key API: _atomic_write_json, migrate_honcho_profile_host |
| `hermes_cli/profiles_initialization.py` | Initial profile files, written on the staging tree before publication. — key API: finish_profile_layout |
| `hermes_cli/profiles_remove.py` | Profile directory removal: wait out the live owner, then rmtree with a short retry. — key API: wait_profile_unowned, _lock_unheld_read_only, _rmtree_make_writable |
| `hermes_cli/profiles_service_cleanup.py` | Profile delete/rename: remove the OLD name's supervisor registrations that live outside — key API: owned_by_profile, remove_system_systemd_unit, remove_windows_task |
| `hermes_cli/projects_cmd.py` | ``hermes project`` CLI — manage first-class, multi-folder Projects. — key API: build_parser, projects_command, _err |
| `hermes_cli/projects_db.py` | Per-profile first-class Project store. — key API: projects_db_path, _slugify, normalize_slug |
| `hermes_cli/prompt_stash.py` | Ctrl+S prompt stash — pure state machine for the classic CLI composer. — key API: build_preview, StashEntry, PromptStash |
| `hermes_cli/provider_catalog.py` | Unified provider catalog — one source of truth for the provider universe. — key API: ProviderDescriptor, tab_for_auth_type, _is_url_var |
| `hermes_cli/providers.py` | Single source of truth for provider identity in Hermes Agent. — key API: HermesOverlay, ProviderDef, normalize_provider |
| `hermes_cli/proxy/__init__.py` | Local OpenAI-compatible proxy that forwards to OAuth-authenticated upstreams. |
| `hermes_cli/proxy/adapters/__init__.py` | Upstream adapter registry for the local proxy server (see :class:`UpstreamAdapter`). — key API: get_adapter |
| `hermes_cli/proxy/adapters/base.py` | Abstract base for proxy upstream adapters; the proxy server is otherwise provider-agnostic. — key API: UpstreamCredential, UpstreamAdapter |
| `hermes_cli/proxy/adapters/nous_portal.py` | Nous Portal upstream adapter. — key API: NousPortalAdapter |
| `hermes_cli/proxy/adapters/xai.py` | xAI Grok OAuth upstream adapter. — key API: XAIGrokAdapter |
| `hermes_cli/proxy/cli.py` | CLI handlers for the ``hermes proxy`` subcommand. — key API: _err, cmd_proxy_start, cmd_proxy_status |
| `hermes_cli/proxy/server.py` | HTTP server that forwards OpenAI-compatible requests to a configured upstream. — key API: _require_aiohttp, _json_error, _canonical_host |
| `hermes_cli/proxy/sse_done.py` | SSE ``[DONE]`` sentinel normalization for OpenAI-compatible proxies. — key API: SseDoneTracker, content_type_is_sse |
| `hermes_cli/proxy_cli.py` | CLI handlers for ``hermes egress ...``. — key API: register_cli, cmd_install, cmd_setup |
| `hermes_cli/psutil_android.py` | Shims to stop the old updater doing work until relaunch, not Android support. — key API: prepare_patched_psutil_sdist |
| `hermes_cli/pt_input_extras.py` | Augmentations to prompt_toolkit's input-parsing tables. — key API: _lock_variants, _lock_twins, _clear_vt100_prefix_cache |
| `hermes_cli/pty_bridge.py` | PTY bridge for `hermes dashboard` chat tab. — key API: _clamp_dimension, PtyUnavailableError, _helper_shutdown_grace |
| `hermes_cli/pty_session.py` | Keep-alive PTY sessions for dashboard terminals. — key API: RingBuffer, _close_ws, _process_ancestors |
| `hermes_cli/relaunch.py` | Unified self-relaunch for Hermes CLI: preserves inherited flags (--tui, --dev, --profile, --model…) — key API: _build_inherited_flag_table, _extract_inherited_flags, resolve_hermes_bin |
| `hermes_cli/relay_plugin_cutover.py` | Shared migration guards for Hermes' native NeMo Relay ownership. — key API: legacy_relay_plugin_keys, configured_legacy_relay_env_vars |
| `hermes_cli/relay_plugin_migrate.py` | Migrate legacy ``HERMES_NEMO_RELAY_ATIF_*`` / ``ATOF_*`` exporter vars into a Relay ``plugins.toml``. — key API: RelayMigrationResult, _truthy, _s |
| `hermes_cli/release_channels.py` | R2 channel wire protocol. — key API: ChannelError, ChannelNotFound, _match |
| `hermes_cli/resource_limits.py` | Best-effort process resource-limit adjustments for long-running services. — key API: configured_nofile_soft_limit, apply_nofile_soft_limit |
| `hermes_cli/route_identity.py` | Fail-closed URL identity normalization for model/provider routes. — key API: normalize_route_base_url, provider_owns_route, drop_stale_model_route |
| `hermes_cli/runtime_paths.py` | Frozen updater surface: pre-PM updaters import these names from here. |
| `hermes_cli/runtime_provider.py` | Shared runtime provider resolution for CLI, gateway, cron, and helpers: the resolution ORDER — key API: frozen_runtime_config, deferred_token_mint, load_config |
| `hermes_cli/runtime_provider_backends.py` | Provider-specific runtime builders for :mod:`hermes_cli.runtime_provider`: Azure Foundry, the — key API: _rp, _azure_entra_credentials, _azure_foundry_api_key |
| `hermes_cli/runtime_provider_custom.py` | Custom-provider resolution: ``providers:`` / ``custom_providers:`` lookup, identity recovery, — key API: _rp, _normalize_custom_provider_name, _normalize_base_url_for_match |
| `hermes_cli/runtime_readiness.py` | Provider readiness probe for the session authority's ``setup.runtime_check``. — key API: check_runtime_readiness |
| `hermes_cli/runtime_state.py` | Stdlib-only recovery and lifetime protection for dependency generations. — key API: runtime_lock, _recover_plugin_publication, recover_publication |
| `hermes_cli/sandbox_image_switch.py` | Approval gate for the default sandbox image change (nikolaik base → hermes-sandbox:desktop). — key API: PendingSwitch, pending, _image_pinned |
| `hermes_cli/secret_prompt.py` | Secret input prompts with masked typing feedback. — key API: _collect_masked_input, masked_secret_prompt, _stream_is_tty |
| `hermes_cli/secrets_cli.py` | CLI handlers for ``hermes secrets bitwarden ...``. — key API: _load_bw, __getattr__, register_cli |
| `hermes_cli/security_advisories.py` | Security advisory checker for Hermes Agent. — key API: Advisory, AdvisoryHit, _installed_version |
| `hermes_cli/send_cmd.py` | CLI subcommand: ``hermes send`` — pipe text from shell scripts to any configured messaging platform — key API: _fail, _read_message_body, _invalid_whatsapp_mentions |
| `hermes_cli/service_manager.py` | Abstract service manager interface + systemd/launchd/Windows/s6 backends. — key API: validate_profile_name, ServiceManager, detect_service_manager |
| `hermes_cli/session_export.py` | Shared renderers for session export commands. — key API: normalize_export_format, normalize_export_only, render_sessions_export |
| `hermes_cli/session_export_html.py` | Standalone single-file HTML export (single or multi-session with sidebar); no remote deps. — key API: _escape_html, _format_timestamp, _content_text |
| `hermes_cli/session_export_md.py` | Markdown/QMD export helpers for Hermes sessions. — key API: _iso_timestamp, _frontmatter_line, _json_block |
| `hermes_cli/session_listing.py` | Shared session-listing helpers for CLI and gateway slash surfaces. — key API: show_subagent_sessions, subagent_listing_scope, parse_session_listing_args |
| `hermes_cli/session_reset_retirement.py` | Point configs that still declare an idle/daily ``session_reset`` at the plugin that restores it. — key API: retired_reset_policy, reset_plugin_enabled, format_notice |
| `hermes_cli/session_schema_history.py` | Physical column history of the state.db tables the page-level salvage lane maps. — key API: _TableHistory, _apply, declared_snapshots |
| `hermes_cli/sessions_cmd.py` | ``hermes sessions`` command. — key API: get_hermes_home, _sessions_dir, _size_mb |
| `hermes_cli/sessions_cmd_browse.py` | Interactive picker for ``hermes sessions browse``: curses UI with live search filtering and ``d`` — key API: _session_status_tag, _annotate_session_statuses, _label |
| `hermes_cli/sessions_cmd_journal_mode.py` | `hermes sessions set-journal-mode delete|wal` — the offline self-service path for #100896. — key API: _header_mode, _refusal, cmd_set_journal_mode |
| `hermes_cli/sessions_cmd_repair_profiles.py` | ``hermes sessions repair-profiles`` — the CLI face of :mod:`hermes_cli.sessions_repair_profiles`. — key API: _group, _print_report, cmd_repair_profiles |
| `hermes_cli/sessions_discard.py` | ``hermes sessions discard``: acknowledge a turn lost across a gateway crash, without a REPL. — key API: _resume, _confirm, _discard |
| `hermes_cli/sessions_owner.py` | Bulk prune while the gateway is up: the owner applies it, this process never writes. — key API: live_owner, owner_prune, report_owner_failure |
| `hermes_cli/sessions_repair_profiles.py` | ``hermes sessions repair-profiles`` — settle crossed-profile durable state across every store. — key API: Store, Finding, _Session |
| `hermes_cli/setup.py` | Interactive setup wizard for Hermes Agent (config lives in ~/.hermes/). — key API: print_header, _info, _sub_dict |
| `hermes_cli/setup_hidden_env.py` | Which platform env vars the setup surfaces hide. — key API: is_setup_hidden_env |
| `hermes_cli/setup_migration.py` | Post-migration section-skip logic and the OpenClaw first-run migration flow (setup.py — key API: _model_section_has_credentials, _model_summary, _cfg_summary |
| `hermes_cli/setup_platforms.py` | Messaging-platform setup wizards (Telegram, webhooks) and the ``hermes setup — key API: _is_valid_telegram_bot_token, _profile_name_from_hermes_home, _setup_telegram_auto_result |
| `hermes_cli/setup_quick.py` | Streamlined setup flows: the Nous Portal one-shot (`hermes portal`), first-time quick setup, — key API: _blank_slate_done, _reload_config_into, _run_nous_flow |
| `hermes_cli/setup_summary.py` | Setup-completion summary (tool availability + "Setup Complete!" banner). — key API: _voice_provider_status, _first_available_plugin_provider, _vision_row |
| `hermes_cli/setup_terminal.py` | Terminal-backend setup wizard (local/docker/singularity/modal/daytona/vercel/ssh/plugin). — key API: _prompt_vercel_sandbox_settings, _read_nearest_vercel_project, _prompt_secret_env |
| `hermes_cli/setup_tts.py` | Text-to-speech provider setup (provider picker, API-key prompts, local engine installs, xAI OAuth). — key API: _install_tts_extra, _install_neutts_deps, _install_kittentts_deps |
| `hermes_cli/shared_profile_warning.py` | Advisory only: simultaneous installs share profile data, not ownership. — key API: shared_profile_warning |
| `hermes_cli/shared_session_attach.py` | Discover a cooperative local runtime without taking its session lease. — key API: _local_origin, discover_attach_url, configure_tui_attachment |
| `hermes_cli/sizefmt.py` | Small shared size-formatting helpers for CLI/agent output (sibling of ``hermes_cli.timefmt``: — key API: format_bytes |
| `hermes_cli/skin_cmd.py` | ``hermes skin`` — list, switch, and tweak skins from the CLI. — key API: _skins_dir, _active_skin, _use |
| `hermes_cli/skin_engine.py` | Hermes skin/theme engine — the theme SDK for every surface. — key API: SkinConfig, _branding, _wings |
| `hermes_cli/slack_cli.py` | ``hermes slack manifest`` — generate the Slack app manifest JSON that registers every gateway — key API: _build_full_manifest, slack_manifest_command |
| `hermes_cli/slash_exec.py` | Registry-owned slash command execution (thin slice). — key API: CommandContext, CommandReply, _exec_version |
| `hermes_cli/source_build.py` | Source launch/update composition over the shared JavaScript builders. — key API: source_product_current, source_build_env, run_in_custody |
| `hermes_cli/source_check.py` | Passive source update decisions for one exact installation and profile. — key API: _quiet, source_git_env, _git_run |
| `hermes_cli/source_completion.py` | The tail every source install and update shares. — key API: complete_source_checkout, _complete_locked, _bootstrap_command |
| `hermes_cli/source_releases.py` | Resolve promoted source releases, never infer publication from a Git tag. — key API: source_repository, SourceTarget, _resolve_channel |
| `hermes_cli/source_stamp.py` | Atomically publish identity for a mutable source checkout. — key API: write_source_stamp, refresh_bootstrap_receipt |
| `hermes_cli/sqlite_runtime.py` | Import-safe helpers for inspecting a Python interpreter's linked SQLite. — key API: _version_tuple, is_sqlite_wal_reset_vulnerable, SQLiteRuntimeInfo |
| `hermes_cli/sqlite_util.py` | Shared SQLite primitives for the small per-profile / board stores. — key API: open_db, transaction, add_column_if_missing |
| `hermes_cli/ssh_workspace_fs.py` | Filesystem adapter for Desktop workspaces executed over SSH. — key API: SshWorkspaceFsError, _SshFsConfig, SshWorkspaceFs |
| `hermes_cli/stale_modules.py` | Heal mixed ``sys.modules`` after an in-place checkout update. — key API: drop_stale_root_modules |
| `hermes_cli/status.py` | Status command for hermes CLI. — key API: check_mark, _section, _row |
| `hermes_cli/status_auth.py` | Credential sections of `hermes status`, run through ``status._SECTIONS`` with its shared context. — key API: _format_iso_timestamp, _qwen_expiry, _oauth_block |
| `hermes_cli/status_bar_git.py` | Current git branch for the CLI status bar. — key API: _resolve_git_dir, current_git_branch |
| `hermes_cli/status_report.py` | The one field set behind ``/status`` on every surface. — key API: timestamp_or, session_timestamps, build_status_fields |
| `hermes_cli/stderr_timestamp.py` | Run a child process while prefixing each stdout and stderr line with a timestamp. — key API: timestamp, stamp_line, _write_timestamped_line |
| `hermes_cli/stdio.py` | Windows-safe stdio configuration. — key API: is_windows, _flip_console_code_page_to_utf8, _reconfigure_stream |
| `hermes_cli/steward.py` | Steward classification and refusal text for sealed install trees. — key API: steward_update_message, steward_uninstall_message, read_install_stamp |
| `hermes_cli/stream_json.py` | ``hermes chat -q … --format stream-json``: one JSON object per stdout line. — key API: stream_json_requested, _now_ms, StreamJsonEmitter |
| `hermes_cli/subcommands/__init__.py` | CLI subcommand parser builders for ``hermes <subcommand>``. |
| `hermes_cli/subcommands/_shared.py` | Shared argparse helpers for the ``hermes_cli/subcommands/*`` builders. — key API: add_accept_hooks_flag, add_yes_flag, add_json_flag |
| `hermes_cli/subcommands/acp.py` | ``hermes acp`` subcommand parser. — key API: build_acp_parser |
| `hermes_cli/subcommands/approvals.py` | ``hermes approvals`` subcommand parser. — key API: build_approvals_parser |
| `hermes_cli/subcommands/auth.py` | ``hermes auth`` subcommand parser. — key API: build_auth_parser |
| `hermes_cli/subcommands/backup.py` | ``hermes backup`` subcommand parser. — key API: _non_negative_keep, build_backup_parser |
| `hermes_cli/subcommands/browser.py` | ``hermes browser`` subcommand parser. — key API: build_browser_parser |
| `hermes_cli/subcommands/bundles.py` | ``hermes bundles`` subcommand parser. — key API: build_bundles_parser |
| `hermes_cli/subcommands/checkpoints.py` | ``hermes checkpoints`` subcommand parser. — key API: build_checkpoints_parser |
| `hermes_cli/subcommands/claw.py` | ``hermes claw`` subcommand parser. — key API: build_claw_parser |
| `hermes_cli/subcommands/codex_runtime.py` | ``hermes codex-runtime`` — noninteractive counterpart of the ``/codex-runtime`` slash command. — key API: cmd_codex_runtime_migrate, build_codex_runtime_parser |
| `hermes_cli/subcommands/completion.py` | ``hermes completion`` subcommand parser. — key API: build_completion_parser |
| `hermes_cli/subcommands/computer_use.py` | ``hermes computer-use`` subcommand parser. — key API: _exit_if_plugin_backend, _cu_install, _cu_status |
| `hermes_cli/subcommands/computer_use_screen.py` | ``hermes computer-use screen`` — the Bot Desktop screen a profile's ``computer_use`` drives on a — key API: _screen_status, _screen_start, _screen_stop |
| `hermes_cli/subcommands/config.py` | ``hermes config`` subcommand parser. — key API: build_config_parser |
| `hermes_cli/subcommands/connectors.py` | ``hermes connectors`` subcommand parser. — key API: build_connectors_parser |
| `hermes_cli/subcommands/console.py` | ``hermes console`` subcommand parser. — key API: build_console_parser |
| `hermes_cli/subcommands/curator.py` | ``hermes curator`` subcommand parser. — key API: build_curator_parser |
| `hermes_cli/subcommands/dashboard.py` | ``hermes dashboard`` / ``hermes serve`` subcommand parsers. — key API: _add_server_runtime_args, _configure_serve_parser, build_serve_parser |
| `hermes_cli/subcommands/debug.py` | ``hermes debug`` subcommand parser. — key API: build_debug_parser |
| `hermes_cli/subcommands/doctor.py` | ``hermes doctor`` subcommand parser. — key API: build_doctor_parser |
| `hermes_cli/subcommands/dump.py` | ``hermes dump`` subcommand parser. — key API: build_dump_parser |
| `hermes_cli/subcommands/egress.py` | ``hermes egress`` subcommand parser. — key API: build_egress_parser |
| `hermes_cli/subcommands/fallback.py` | ``hermes fallback`` subcommand parser. — key API: build_fallback_parser |
| `hermes_cli/subcommands/gateway.py` | ``hermes gateway`` and ``hermes proxy`` subcommand parsers. — key API: _GatewayCommandParser, _flag, _add_compat_platform_flag |
| `hermes_cli/subcommands/gui.py` | ``hermes gui`` subcommand parser. — key API: build_gui_parser |
| `hermes_cli/subcommands/hooks.py` | ``hermes hooks`` subcommand parser. — key API: build_hooks_parser |
| `hermes_cli/subcommands/import_agent.py` | ``hermes import-agent`` subcommand parser (logic lives in ``hermes_cli/agent_import.py``). — key API: build_import_agent_parser |
| `hermes_cli/subcommands/import_cmd.py` | ``hermes import`` subcommand parser. — key API: build_import_cmd_parser |
| `hermes_cli/subcommands/insights.py` | ``hermes insights`` subcommand parser. — key API: build_insights_parser |
| `hermes_cli/subcommands/journey.py` | ``hermes journey`` subcommand parser. — key API: build_journey_parser |
| `hermes_cli/subcommands/login.py` | ``hermes login`` subcommand parser. — key API: build_login_parser |
| `hermes_cli/subcommands/logout.py` | ``hermes logout`` subcommand parser. — key API: build_logout_parser |
| `hermes_cli/subcommands/logs.py` | ``hermes logs`` subcommand parser. — key API: build_logs_parser |
| `hermes_cli/subcommands/mcp.py` | ``hermes mcp`` subcommand parser. — key API: build_mcp_parser |
| `hermes_cli/subcommands/memory.py` | ``hermes memory`` subcommand parser. — key API: build_memory_parser |
| `hermes_cli/subcommands/migrate.py` | ``hermes migrate`` subcommand parser. — key API: build_migrate_parser, _cmd_migrate_relay |
| `hermes_cli/subcommands/moa.py` | ``hermes moa`` subcommand parser. — key API: build_moa_parser |
| `hermes_cli/subcommands/model.py` | ``hermes model`` subcommand parser. — key API: build_model_parser |
| `hermes_cli/subcommands/monitoring.py` | ``hermes monitoring`` subcommand parser (gateway health/diagnostics export control). — key API: build_monitoring_parser |
| `hermes_cli/subcommands/pairing.py` | ``hermes pairing`` subcommand parser. — key API: build_pairing_parser |
| `hermes_cli/subcommands/pause.py` | ``hermes pause`` / ``hermes resume`` — the global emergency stop. — key API: cmd_pause, cmd_resume, build_pause_parser |
| `hermes_cli/subcommands/peer.py` | ``hermes peer`` — bot-to-bot DMs across machines/gateways. — key API: _peer_key_env, _load_peers, _save_peers |
| `hermes_cli/subcommands/pets.py` | ``hermes pets`` subcommand parser. — key API: build_pets_parser |
| `hermes_cli/subcommands/plugins.py` | ``hermes plugins`` subcommand parser. — key API: build_plugins_parser |
| `hermes_cli/subcommands/profile.py` | ``hermes profile`` subcommand parser. — key API: build_profile_parser |
| `hermes_cli/subcommands/prompt_size.py` | ``hermes prompt-size`` subcommand parser. — key API: build_prompt_size_parser |
| `hermes_cli/subcommands/secrets.py` | ``hermes secrets`` subcommand parser. — key API: build_secrets_parser |
| `hermes_cli/subcommands/security.py` | ``hermes security`` subcommand parser. — key API: build_security_parser |
| `hermes_cli/subcommands/sessions.py` | ``hermes sessions`` subcommand parser. — key API: _flag, cmd_sessions_lazy, _add_rename_and_discard |
| `hermes_cli/subcommands/setup.py` | ``hermes setup`` subcommand parser. — key API: build_setup_parser |
| `hermes_cli/subcommands/skills.py` | ``hermes skills`` subcommand parser. — key API: _flag, build_skills_parser |
| `hermes_cli/subcommands/skin.py` | ``hermes skin`` subcommand parser. — key API: build_skin_parser |
| `hermes_cli/subcommands/slack.py` | ``hermes slack`` subcommand parser. — key API: build_slack_parser |
| `hermes_cli/subcommands/status.py` | ``hermes status`` subcommand parser. — key API: build_status_parser |
| `hermes_cli/subcommands/tools.py` | ``hermes tools`` subcommand parser. — key API: build_tools_parser |
| `hermes_cli/subcommands/uninstall.py` | ``hermes uninstall`` subcommand parser. — key API: build_uninstall_parser |
| `hermes_cli/subcommands/update.py` | ``hermes update`` subcommand parser. — key API: build_update_parser |
| `hermes_cli/subcommands/usage.py` | ``hermes usage`` — the account-limits block of the REPL ``/usage`` without starting a session. — key API: usage_snapshot_document, cmd_usage, build_usage_parser |
| `hermes_cli/subcommands/vault.py` | ``hermes vault`` subcommand parser. — key API: build_vault_parser |
| `hermes_cli/subcommands/verify.py` | ``hermes verify`` subcommand parser. — key API: build_verify_parser |
| `hermes_cli/subcommands/webhook.py` | ``hermes webhook`` subcommand parser. — key API: build_webhook_parser |
| `hermes_cli/subcommands/whatsapp.py` | ``hermes whatsapp`` subcommand parser. — key API: build_whatsapp_parser, build_whatsapp_cloud_parser |
| `hermes_cli/subcommands/worktree.py` | ``hermes worktree`` subcommand parser. — key API: build_worktree_parser |
| `hermes_cli/suggestions_cmd.py` | Shared ``/suggestions`` command logic for CLI and gateway. — key API: _fmt_pending, _resolve_origin, _accept |
| `hermes_cli/telegram_managed_bot.py` | Telegram Managed Bot onboarding client: creates a user-owned child bot via the Nous onboarding — key API: TelegramPairing, TelegramBotSetupResult, _api_url |
| `hermes_cli/terminal_breadcrumbs.py` | Per-terminal session breadcrumbs for ``hermes -c`` / ``--continue``. — key API: _breadcrumbs_dir, _sanitize, get_terminal_id |
| `hermes_cli/terminal_notify.py` | Terminal-native desktop notifications: OSC 9 and Warp's OSC 777 CLI-agent protocol. — key API: write_tty, osc9, warp_supported |
| `hermes_cli/timefmt.py` | Small shared time-formatting helpers for CLI output. — key API: coerce_epoch, relative_time |
| `hermes_cli/timeouts.py` | Per-model ``providers.<id>.models.<model>.<model_key>`` wins over ``providers.<id>.<provider_key>``. — key API: _coerce_timeout, _configured_timeout, get_provider_request_timeout |
| `hermes_cli/tips.py` | Random tips shown at CLI session start to help users discover features. — key API: _catalog_keys, reset_tips_cache, tip_keys |
| `hermes_cli/tool_availability_notices.py` | Startup notice lines for toolsets that are switched off because their requirements are not met. — key API: filter_to_enabled_toolsets, current_terminal_backend, _terminal_line |
| `hermes_cli/tools_config.py` | Unified tool configuration for Hermes Agent. — key API: _pip_install, install_cua_driver, gui_toolset_label |
| `hermes_cli/tools_config_cua.py` | PM-backed CUA setup and the host integration not supplied by its binary archive. — key API: _run_text, _fail, _print_output_tail |
| `hermes_cli/tools_config_mcp.py` | MCP tool checklists and the non-interactive ``hermes tools enable|disable|list`` command. — key API: _mcp_match_filter, _mcp_preselected, _apply_mcp_checklist |
| `hermes_cli/tools_config_post_setup.py` | Post-setup install hooks and installed-state predicates for `hermes tools` provider rows. — key API: _info_lines, _ensure_browser_use_cli, _post_setup_lightpanda |
| `hermes_cli/tools_config_providers.py` | Provider rows, active-provider detection, model pickers and provider-selection persistence for `hermes tools`. — key API: _plugin_registry, _plugin_provider_rows, _plugin_rows_for |
| `hermes_cli/toolset_scope.py` | Platform scope rules for configured toolsets. — key API: toolset_allowed_for_platform |
| `hermes_cli/toolset_validation.py` | Validation for the ``platform_toolsets`` config section. — key API: parse_platform_toolsets_value, _platform_default_toolset, _platform_default_is_valid |
| `hermes_cli/tui_worktree_resume.py` | Bring back a ``hermes --tui -w`` worktree a resume needs (N8). — key API: _record_path, _key, _read |
| `hermes_cli/uninstall.py` | Hermes Agent Uninstaller. — key API: _logger, _print_box, _prompt |
| `hermes_cli/update_abort_recovery.py` | Fresh-process recovery after the update's in-process restart phase aborts. — key API: _serve_unit_recovery_available, _surviving_pre_update_serve_runtimes, _numeric |
| `hermes_cli/update_channel.py` | Per-install update-channel records. — key API: is_canary_tag, canary_timestamp, canary_tag_for_date |
| `hermes_cli/update_cmd.py` | Hermes update pipeline: dispatchers (``_cmd_update_impl``/``_cmd_update_check``) + git plumbing. — key API: get_default_hermes_root, _ensure_uv_for_termux, _ensure_venv_pip |
| `hermes_cli/update_cmd_check.py` | Steps of ``hermes update --check``: debris cleanup, channel target, scoped fetch, verdict. — key API: _git, _uc, clear_git_debris |
| `hermes_cli/update_cmd_commit.py` | The single commit point of a source ``hermes update``: everything the tree move needs armed first. — key API: _owns_live_checkout, _obligation_paths, _read_or_none |
| `hermes_cli/update_cmd_common.py` | Shared leaf helpers for the ``hermes update`` modules (no Hermes imports; no cycle). — key API: _record_stop, _best_effort |
| `hermes_cli/update_cmd_config.py` | Post-``hermes update`` config-schema migration for the active profile and every sibling. — key API: _reload_config_modules, _run_config_check_fresh, _run_migrate_config_fresh |
| `hermes_cli/update_cmd_drain_report.py` | Name what a draining gateway is waiting on while ``hermes update`` blocks on it. — key API: _fmt_elapsed, _cron_job_name, describe_active_work_unit |
| `hermes_cli/update_cmd_fleet.py` | Gateway fleet restart + post-update verification for ``hermes update``. — key API: _write_gateway_update_exit_code, _fleet_restart_pending_marker_path, _write_fleet_restart_pending_marker |
| `hermes_cli/update_cmd_fleet_checkout.py` | Checkout ancestry for the update-restart obligation (``update_cmd_fleet`` sibling). — key API: checkout_contains |
| `hermes_cli/update_cmd_fleet_gatewayless.py` | Gateway-less host evidence for the update-restart obligation (``update_cmd_fleet`` sibling). — key API: runtime_outside_gateway_evidence, host_owes_no_gateway_restart |
| `hermes_cli/update_cmd_fleet_unit_budget.py` | systemd unit timing budgets for the update's gateway restarts (``update_cmd_fleet`` sibling). — key API: systemd_restart_timeout, service_restart_sec |
| `hermes_cli/update_cmd_fleet_verify.py` | Post-restart fleet verification for ``hermes update`` (``update_cmd_fleet`` sibling). — key API: _print_legacy_units_warning, _collect_fleet_snapshot, _fleet_row_identity_pending |
| `hermes_cli/update_cmd_git.py` | Git plumbing for ``hermes update``: fork/upstream sync, trampoline-git detection, lockfile/EOL churn cleanup, orphan rescue refs, parked-branch assessment, fetch-failure classification. — key API: _git_ok, _git_run, _git_stdout |
| `hermes_cli/update_cmd_maint.py` | Post-update maintenance for ``hermes update``: pre-update backup snapshot, state-db verify/restore, curator/FTS notices, FHS path guard, completion summary. — key API: _prepare_updated_checkout, _sqlite_partial_completion_lines, _load_updates_cfg |
| `hermes_cli/update_cmd_pause_gate.py` | The paused gateways' tree gate for the update's checkout-writing steps (Windows pause, #132338). — key API: _checkout_move, _moves_for, _settle_checkout_move |
| `hermes_cli/update_cmd_posix_pause.py` | Pre-swap gateway pause for ``hermes update`` on Linux and macOS. — key API: PauseRefused, _empty_token, arm_pause |
| `hermes_cli/update_cmd_stale_survivors.py` | Post-update escalation for gateways the fleet matrix proved stale. — key API: stale_fleet_survivor_pids, signal_stale_fleet_survivors |
| `hermes_cli/update_cmd_stash.py` | Autostash handling for ``hermes update``: stash before the pull, restore/park/discard afterwards, warn about orphans. — key API: _git_quiet, _intent_to_add_paths, _git_paths_z |
| `hermes_cli/update_cmd_validation.py` | Source import-integrity checks for update and stash restoration. — key API: _critical_module_import_failures, _probe_failure, _validate_critical_modules_import |
| `hermes_cli/update_cmd_windows.py` | Windows gateway lifecycle for ``hermes update``: pause/resume/cold-start the service, sweep venv holders, reap orphaned backends. — key API: _try_call, _abort_on_error, _planned_stop_marker_path |
| `hermes_cli/update_cmd_zip.py` | ZIP-download fallback for ``hermes update`` (Windows with broken git): two-phase stage/commit swap, dirty-tree guard. — key API: _remove_path, _atomic_replace_dir, _stage_replacement |
| `hermes_cli/update_completion.py` | Fresh-checkout source update completion and its stdlib-only parent transport. — key API: _write_json, _exit_status, _write_bootstrap_result |
| `hermes_cli/update_contract.py` | Image-managed install refusal contract. — key API: is_commit_build, UpdateRefusal, _refusal |
| `hermes_cli/update_custody.py` | Checkout custody for the updater's children (R2): the ONE spawn policy for every git (and the — key API: CustodyRefused, _refuse, _past_commit |
| `hermes_cli/update_downgrade_guard.py` | Refuse an update whose target predates the gateway runtime while a state.db already depends on it. — key API: target_predates_runtime, _has_ledger_rows, _pre_runtime_snapshot |
| `hermes_cli/update_finish.py` | Post-checkout completion shared by current and historical update callers. — key API: finish_update, _restore_plan, main |
| `hermes_cli/update_fleet_scope.py` | Home scoping for ``hermes update``'s fleet restart (#93349). — key API: _resolved, update_scope_homes, home_in_update_scope |
| `hermes_cli/update_handoff.py` | Frozen compat surface for releases that finish `hermes update` via the post-swap hand-off. — key API: is_post_swap_child, write_handoff, read_handoff |
| `hermes_cli/update_host_obligation.py` | Host-scoped update→restart obligation for ``hermes update``. — key API: host_obligation_path, _owed_path, _write_record |
| `hermes_cli/update_inventory.py` | Runtime inventory + update plan for the fleet-update pipeline. — key API: RuntimeRecord, UpdatePlan, _detect_supervisor_for_pid |
| `hermes_cli/update_lock.py` | Cross-process mutual exclusion for in-flight Hermes updates. — key API: update_marker_path, _default_install_root, _git_common_dir |
| `hermes_cli/update_owning_install.py` | Send ``hermes update`` back to the install whose interpreter it is running on. — key API: owning_install_root, _pm_environment_owner, retarget_to_owning_install |
| `hermes_cli/update_pause_record.py` | Durable record of the gateways and services ``hermes update`` paused on Windows. — key API: install_root, _install_key, record_path |
| `hermes_cli/update_receipt.py` | Structured update receipts + post-update fleet version verification. — key API: update_receipt_scope, adopt_terminal_receipt, committed_success |
| `hermes_cli/update_restart_recovery.py` | Restart supervised gateway profiles from a clean Python generation. — key API: _run_quiet, _stdout, _succeeded |
| `hermes_cli/update_serve_obligations.py` | Durable serve/dashboard restart reminders (manual serves, and unit-owned ones the update could not — key API: defer_manual_serve, _defer_identified, _write_reminder |
| `hermes_cli/update_serve_resume.py` | Fresh-process adapter for manual backends paused by historical updaters. — key API: main |
| `hermes_cli/update_stage.py` | Stage updates to a desktop hand-off UI, if one is watching. — key API: _process_home, status_file, _status_from_marker |
| `hermes_cli/update_windows_acl.py` | ``hermes update``'s owed ``windows_home_acl`` step: after an elevated update, give the same — key API: repair_windows_home_acl |
| `hermes_cli/url_utils.py` | Small helpers for composing URLs from configured network hosts. — key API: format_url_host |
| `hermes_cli/urllib_security.py` | Security policy for credential-bearing stdlib urllib requests. — key API: url_origin, _strip_headers, SafeCredentialRedirectHandler |
| `hermes_cli/vault.py` | ``hermes vault`` — manage the local encrypted autofill vault. — key API: _console, _cmd_add, _cmd_list |
| `hermes_cli/venv_sync.py` | Pre-venv entry point for PM's dependency transaction. — key API: _project_root, _is_sealed, check_runtime |
| `hermes_cli/vercel_auth.py` | Helpers for reporting Vercel Sandbox authentication state. — key API: VercelAuthStatus, describe_vercel_auth |
| `hermes_cli/verify_cmd.py` | ``hermes verify`` — detect a project's run recipe and smoke-test it. — key API: run_verify_command, _merge_project_facts_commands, _record_evidence |
| `hermes_cli/version_info.py` | Canonical runtime identity for Hermes. — key API: VersionInfo, _derived_version, _run_git |
| `hermes_cli/voice.py` | Process-wide voice recording + TTS API for the TUI gateway. — key API: voice_record_key_from_config, normalize_voice_record_key_for_prompt_toolkit, pt_key_to_sequence |
| `hermes_cli/web_asset_mime_types.py` | MIME types for served web assets, normalised in the serving layer. — key API: normalize_web_asset_mime_types |
| `hermes_cli/web_build_limits.py` | Web UI build resource caps (issue #63338). — key API: _cgroup_memory_limit_mb, _available_cores, _bounded_threads |
| `hermes_cli/web_deps.py` | Late-binding dependency seam for extracted dashboard routers. — key API: _server, late, LateState |
| `hermes_cli/web_git.py` | Backend git operations for the desktop coding rail + review pane. — key API: _run, _git, _git_out |
| `hermes_cli/web_models.py` | Pydantic request/response models for the Hermes dashboard web server. — key API: ConfigUpdate, EnvVarUpdate, EnvVarDelete |
| `hermes_cli/web_read_coalescing.py` | Coalesce concurrent synchronous HTTP reads before threadpool admission. — key API: _freeze, coalesced_read |
| `hermes_cli/web_routers/__init__.py` | Extracted APIRouter modules for the dashboard web server. |
| `hermes_cli/web_routers/_common.py` | Shared plumbing for the extracted dashboard routers — thin wrappers over the — key API: config_write_scope, scoped_to_thread, config_scoped_to_thread |
| `hermes_cli/web_routers/actions.py` | Gateway restart/drain, Hermes update and background-action status dashboard routes. — key API: _server_path, _finish_action, _record_completed_action |
| `hermes_cli/web_routers/analytics.py` | Raw-YAML config and token/cost analytics dashboard routes. — key API: get_config_raw, update_config_raw, _rows |
| `hermes_cli/web_routers/audio.py` | Audio dashboard routes: transcription upload + live transcribe-stream, voice config, ElevenLabs voices, TTS speak/lease and the speak-stream WebSocket. — key API: _unlink_quietly, _run_config_scoped, _audio_extension_for_mime |
| `hermes_cli/web_routers/chat_workspaces.py` | Chat workspace picker: which host directories a NEW dashboard chat can start in. — key API: resolve_chat_cwd, _collect_workspaces, get_chat_workspaces |
| `hermes_cli/web_routers/chat_ws.py` | Chat-tab WebSocket routes: /api/console, /api/pty, the /api/ws gateway — key API: _get_event_state, _unlink_active_session_file, _discard_active_session_file |
| `hermes_cli/web_routers/chat_ws_errors.py` | User-facing copy for dashboard chat (``/api/pty``) start failures. — key API: _node_missing, chat_start_failure_message, _sentence |
| `hermes_cli/web_routers/config_env.py` | Config, env var and provider custom-endpoint dashboard routes. — key API: _env_write_errors, get_config, get_defaults |
| `hermes_cli/web_routers/dashboard_ui.py` | Dashboard theme/font and dashboard-plugin (discovery, hub, install/enable, asset serving) routes. — key API: _set_dashboard_key, get_dashboard_themes, set_dashboard_theme |
| `hermes_cli/web_routers/display.py` | ``/api/display/ws`` — raw RFB over WebSocket for the Bot Desktop viewer. — key API: _should_evict, _consume_display_ticket, display_ws |
| `hermes_cli/web_routers/files.py` | Managed-files, chat image upload, /api/media and /api/fs dashboard routes. — key API: _is_sensitive_filename, _is_sensitive_path, _fs_mime_type |
| `hermes_cli/web_routers/git.py` | Git dashboard routes — the remote half of the desktop coding rail + review pane. — key API: _git_op, _git_path, git_status_route |
| `hermes_cli/web_routers/local_models.py` | Local-models dashboard routes — the desktop's window into the managed llama.cpp runtime. — key API: RuntimeInstallBody, ModelDownloadBody, JobIdBody |
| `hermes_cli/web_routers/mcp.py` | MCP dashboard routes. — key API: _profile_secret_scope, _secret_scoped, _gc_mcp_oauth_flows |
| `hermes_cli/web_routers/memory_providers.py` | Memory-provider setup dashboard routes (schema, existing values, external dependency install). — key API: _unknown_provider, _value_errors_as_http, _coerce_field_value |
| `hermes_cli/web_routers/messaging.py` | Messaging dashboard routes: WhatsApp/Telegram onboarding and per-platform enable/config/test. — key API: _env_value_rules, _validate_messaging_env_value, _messaging_env_info |
| `hermes_cli/web_routers/models.py` | Model assignment dashboard routes: model info/options/recommended default, auxiliary + MoA slots, /api/model/set. — key API: _main_model_fields, _load_config_scoped, _bounded_context_length_probe |
| `hermes_cli/web_routers/oauth.py` | OAuth provider dashboard routes: catalog/status, disconnect, and in-browser device-code login flows. — key API: _http_response_error_detail, _codex_device_code_start_error, _new_oauth_session |
| `hermes_cli/web_routers/ops.py` | Pairing, webhooks, gateway lifecycle, credential pool, memory provider and — key API: _spawn_action, _pairing_store, list_pairing |
| `hermes_cli/web_routers/profiles.py` | Profiles dashboard routes. — key API: _warn_profile_read_error, _profile_to_dict, _profile_setup_command |
| `hermes_cli/web_routers/sessions.py` | Session dashboard routes. — key API: _read_session_import_body, _prune_sessions, _csv |
| `hermes_cli/web_routers/shared_metrics.py` | ``/api/shared-metrics/consent``: the dashboard's first-run shared-metrics offer. — key API: ConsentAnswer, _read_consent, get_shared_metrics_consent |
| `hermes_cli/web_routers/skills.py` | Skills dashboard routes. — key API: _hub_sources, _resolve_hub_skill, _flag |
| `hermes_cli/web_routers/status.py` | Status dashboard routes: health, /api/status, system stats, curator, learning graph, — key API: _safe_call, _count_status_active_sessions, _status_active_sessions |
| `hermes_cli/web_routers/tools.py` | Toolset / terminal-backend dashboard routes. — key API: _env_value, _terminal_cfg_value, _terminal_backend_rows |
| `hermes_cli/web_server_app.py` | HTTP lifespan composition; standalone backend services remain opt-in owners. — key API: _unlink_pty_markers, standalone_lifespan, http_lifespan |
| `hermes_cli/web_server_chat.py` | Chat/terminal WebSocket plumbing: PTY bridge selection and registry, WS — key API: _close_stalled_pty_input, _legacy_pump, _ws_client_reason |
| `hermes_cli/web_server_config.py` | Dashboard config schema and model-assignment logic: CONFIG_SCHEMA construction, dynamic provider options, web<->config normalisation, main/aux model assignment. — key API: _memory_provider_options, _timezone_options, _select |
| `hermes_cli/web_server_dashboard.py` | Dashboard UI assets: SPA mount, theme normalisation/bootstrap CSS, dashboard-plugin discovery and the plugins-hub merge. — key API: _normalise_prefix, _layer_hex, _render_active_theme_bootstrap_css |
| `hermes_cli/web_server_files.py` | Managed-files policy for the dashboard file browser: root resolution, path containment, entry metadata. — key API: ManagedFilesPolicy, _resolve_fs_candidate, _fs_path |
| `hermes_cli/web_server_gateway.py` | Gateway/process helpers for the dashboard: per-profile gateway topology (+cache), action — key API: _read_dashboard_json_response, _probe_gateway_health, _profile_platform_ports |
| `hermes_cli/web_server_idle_exit.py` | Idle-exit for Desktop-owned ``hermes serve --isolated`` backends reached over SSH (#101626). — key API: IdleClientTracker, wrap_asgi_with_ws_tracking, _session_work_in_flight |
| `hermes_cli/web_server_idle_proof.py` | Diagnostic work snapshot for a Desktop-pooled ``hermes serve`` child. — key API: pending_human_input, idle_proof |
| `hermes_cli/web_server_lifecycle.py` | Serve-process lifecycle: parent death watchdog, port-conflict preflight, READY announcement, browser open, trusted proxies. — key API: _process_start_marker, _valid_parent_start_marker, _parent_start_marker_mismatch_is_conclusive |
| `hermes_cli/web_server_mcp.py` | MCP dashboard helpers: create-payload normalisation, env redaction/summary, dashboard-driven MCP OAuth worker. — key API: _normalize_mcp_server_create, _redact_mcp_env, _mcp_server_summary |
| `hermes_cli/web_server_memory.py` | Memory-provider dashboard helpers: manifest/schema loading, setup-env and dependency probes, configured-status discovery. — key API: _normalize_memory_provider_name, _load_memory_provider, _memory_provider_manifest |
| `hermes_cli/web_server_messaging.py` | Messaging-platform catalog and onboarding helpers: platform overrides/env discovery, WhatsApp — key API: _messaging_platform_catalog, _channel_managed_env_keys, _platform_env_prefixes |
| `hermes_cli/web_server_oauth.py` | Dashboard OAuth/login-status helpers: provider catalog, per-provider device pollers, — key API: _truncate_token, _token_status, _anthropic_oauth_status |
| `hermes_cli/web_server_owner_exit.py` | Supersession retirement for Desktop-owned ``hermes serve --isolated`` backends reached over SSH. — key API: should_retire_superseded, start_owner_watchdog |
| `hermes_cli/web_server_plugin_profiles.py` | Dashboard plugins of a secondary served profile (PLG-3, #134889). — key API: secondary_profile_home, _scan_profile_plugins, _published |
| `hermes_cli/web_server_profiles.py` | Profile-scoped helpers: profile discovery fallback, profile dir/MCP-server writes, — key API: _safe, _is_current_profile, _hermes_home_scope |
| `hermes_cli/web_server_sessions.py` | Read-only session browsing, latest-descendant lookup and owner maintenance. — key API: _session_latest_descendant, _session_mutation_context, _native_history_transport |
| `hermes_cli/web_server_skew_exit.py` | Code-skew retirement for Desktop-owned ``hermes serve --isolated`` backends reached over SSH. — key API: should_retire_for_skew, _update_in_progress, _run_retirement_watchdog |
| `hermes_cli/web_whatsapp_session.py` | Preserve WhatsApp authentication state before dashboard re-pairing. — key API: _assert_whatsapp_bridge_stopped, _backup_whatsapp_session |
| `hermes_cli/webhook.py` | hermes webhook — manage dynamic webhook subscriptions from the CLI. — key API: SubscriptionMutationConflict, _subscriptions_path, _subscriptions_lock_path |
| `hermes_cli/welcome_trial.py` | The desktop's welcome trial: free inference on ``nous/welcome`` for a first install, once per OS user. — key API: _has_nous_identity, provider_configured, inference_available |
| `hermes_cli/win_pty_bridge.py` | Windows ConPTY bridge for the `hermes dashboard` chat tab. — key API: _clamp, PtyUnavailableError, WinPtyBridge |
| `hermes_cli/windows_appinstaller_update.py` | Check for an App Installer update for the running MSIX package. — key API: _load_projection, main |
| `hermes_cli/windows_ssh_runtime.py` | Native Windows trust boundary for Desktop SSH backend lifecycle. — key API: _win32, _check, _ownership |
| `hermes_cli/windows_store_update.py` | Run a Store check, download, or install with the packaged interpreter. — key API: perform, _wait, _execute |
| `hermes_cli/worktree_archive.py` | Restorable snapshots of git worktrees: ``refs/hermes/archive/<tree>``. — key API: ArchiveError, Archive, _env |
| `hermes_cli/worktree_cmd.py` | ``hermes worktree`` — audit (``list [--json] [--older-than DAYS]``), reclaim — key API: _fmt_size, _list, _print_archives |
| `hermes_cli/worktree_exit.py` | The keep / archive / discard question when an interactive ``hermes -w`` session exits with a — key API: _has_tty, worktree_state, _still_in_use |
| `hermes_cli/worktree_gc.py` | On-demand worktree + branch reclaim (``hermes worktree`` / ``/worktree prune``). — key API: TreeRecord, BranchRecord, _run |
| `hermes_cli/worktree_ops.py` | Git worktree isolation for ``hermes -w`` sessions: create, classify, prune. — key API: _cprint, _git, _git_out |
| `hermes_cli/worktree_registry.py` | Per-profile registry of every repository Hermes has created a worktree in. — key API: registry_path, _repo_exists, _read |
| `hermes_cli/worktree_retention.py` | What a worktree holds that neither git nor an archive can bring back. — key API: _env, _git, _Scan |
| `hermes_cli/worktree_sweep.py` | Snapshot-then-delete sweep for stale worktrees (``worktrees.archive_dirty``, default on). — key API: Decision, sweep_settings, classic_mode |
| `hermes_cli/xai_retirement.py` | Detect xAI models retired on May 15, 2026 and migrate config.yaml references. — key API: RetirementIssue, _normalize, _looks_like_xai |
---

## 2. Ideas worth stealing

### 2.1 A monitor whose cheap probe suppresses the expensive run — `CONVERGENT`
**What.** A scheduled job can have a *source* (a script or a URL) that runs every tick; if the source's output is **byte-identical** to last time, the agent run is **suppressed entirely**. When it changes, a "MONITOR CHANGE DETECTED" diff is injected into the prompt.
**Where.** `hermes_cli/subcommands/cron.py` (`--monitor-script` / `--monitor-url` flag help); the hash-suppression rule, the mutual exclusion with `--no-agent`, and the "Script output must be stable (no timestamps)" constraint are declared in the same flag help.
**Why it transfers.** This is *the* pattern for a trading monitor: poll the price feed or the broker every N minutes, and only spend a model call when something actually moved. It also degrades correctly — the source is a dumb script, so it cannot hallucinate a "no change." The same idea is worth copying as a *first-class mode* rather than a prompt convention.

### 2.2 A per-job durable notepad the agent updates itself — `UNIQUE`
**What.** Each scheduled job has a durable key/value notepad. A running job's agent updates it through its own terminal tool; the scheduler injects non-empty notepad values into the *next* run's prompt.
**Where.** `hermes_cli/cron.py` (`cron_notepad`) and `hermes_cli/subcommands/cron.py` (the `notepad` subcommand: `get` / `set` / `delete` / `list`).
**Why it transfers.** A "trading journal" that the *analysis agent itself* maintains between runs — "last structure I looked at", "the level I said would trigger" — is exactly a per-job notepad. It survives restarts, it is inspectable by the trader, and it is injected where the next run needs it.

### 2.3 Continuity: each run sees the previous run's output — `UNIQUE`
**What.** `--continuity` makes a job wake up with its own last output injected, "so it can dedupe against what was already reported and continue where the last run left off (scouts, monitors, incremental digests)."
**Where.** `hermes_cli/subcommands/cron.py` (`--continuity` / `--no-continuity`), the job field `continuity`, and the `context_from` job-reference mechanism validated in `hermes_cli/web_server_cron.py` (`_validate_dashboard_cron_context_from`, which reserves the literal `"self"` because "create precedes the job's existence").
**Why it transfers.** A daily market-review job that remembers yesterday's conclusions can say "nothing changed since Friday" instead of re-deriving it. The `"self"` reservation is the subtle bit: a job can reference *other jobs'* outputs, which is how a "weekly digest" job can consume a "daily scan" job's output without a separate pipeline.

### 2.4 One registry, and every surface derives from it — `CONVERGENT`
**What.** `COMMAND_REGISTRY` (a list of `CommandDef`) is the single source for slash commands. CLI dispatch, the gateway's known-command list, the Telegram bot menu, the Slack subcommand map, the shell autocomplete and the help screen all derive from it. Adding an alias updates all of them automatically.
**Where.** `hermes_cli/commands.py` (`CommandDef`, `build_commands`), with the derivation sites named in `hermes_cli/AGENTS.md` ("Slash command registry" section) and implemented in `hermes_cli/commands_platforms.py` (Telegram/Discord/Slack) and `hermes_cli/commands_completion.py`.
**Why it transfers.** August Trading's slash commands, dock actions, settings rows and the model's tool names are probably four separate lists that can drift. One registry with a per-surface *derivation* (not a copy) is the fix.

### 2.5 Read-time tolerance, write-time strictness — `UNIQUE`
**What.** A config normaliser deliberately *degrades to defaults* for a hand-edited file so a bad edit never crashes the agent; but a **separate validator** returns the exact list of problems the normaliser would have papered over, and the write path refuses to save them. The two are written so they can never disagree.
**Where.** `hermes_cli/moa_config.py` (`validate_moa_payload` vs `normalize_moa_config`) — "Read-time tolerance (a hand-edited config degrades to defaults instead of crashing) is a corruption engine at write time."
**Why it transfers.** August Trading's `config.yaml` / Preferences layer should be able to say "this value is not a valid strategy config" at the moment of the write, and merely *fall back* at the moment of the read. Today those two are often the same function, which means one bad value either crashes the app or is silently ignored.

### 2.6 Dry-run the gate, with a distinct exit code per verdict — `UNIQUE`
**What.** `hermes approvals test <command>` composes the *real* runtime evaluators in the *real* order, executes nothing, prompts nobody, persists nothing, and prints the verdict, the matching rule, and the **normalised-command trace** the detectors actually evaluated. Exit codes: 0 allow / 2 ask / 3 deny.
**Where.** `hermes_cli/approvals_test.py` (the seven-step ladder) and `hermes_cli/subcommands/approvals.py` (the `--json` flag and the documented exit codes).
**Why it transfers.** August Trading has risk gates (R:R floors, position limits, ATR stop bands) that the trader can only discover by *doing the dangerous thing*. A `hermes approvals test`-equivalent — "what would the risk gate do with this order?" — is cheap to build, and the normalised trace is what makes the answer auditable.

### 2.7 Mine implied approvals into a safer allowlist — `UNIQUE`
**What.** Rather than keeping a decision ledger, the system *infers* approval from the transcript: a command in a dangerous class whose tool result is not a block marker must have been approved. Those are then aggregated into allowlist proposals — with a hard rule that destructive classes are **never** proposed, however often they were approved.
**Where.** `hermes_cli/approvals_suggest.py` (`_UNSAFE_CLASS_PATTERNS`, `_UNSAFE_ROOT_BINARIES`, `scan_approval_history`, `build_proposals`).
**Why it transfers.** "The trader approved this exact risk three times this week — propose it as an allowed pattern, but never propose the destructive ones" is a rule-learning loop with a *safety bias*, which is exactly what a trading app's auto-approval feature needs.

### 2.8 Implied approvals, expressed as a hash bound to the exact request — `UNIQUE`
**What.** The plugin-facing approval contract: the host creates an immutable request with a SHA-256 digest over a canonical JSON of every field (plus the session key); a transport returns a decision carrying the request id **and** the digest; the host rejects any decision whose id or digest does not match, and treats *every* failure (timeout, busy, interrupt, bad type, disallowed choice) as a **denial**.
**Where.** `hermes_cli/approval_transport.py` (`ApprovalRequest.create` — the canonical digest; `_validate_decision` — the rejection table).
**Why it transfers.** If August Trading ever lets a plugin, a Telegram user, or a second surface approve a trade, the approval must be bound to the *exact* order parameters shown. A digest is a five-line implementation of that binding.

### 2.9 One table, a runtime gate and a static audit both read it — `UNIQUE`
**What.** The plugin-isolation surface tables (`HOST_UNSUPPORTED_CTX_METHODS`, `HOST_SKIPPED_CTX_METHODS`, `HOST_REMOTE_FACADES`, `HOST_OBJECT_BASES`, `HOST_DEGRADED_HOOKS`) are declared once and are read by *both* the runtime boundary and the static audit — "so 'the audit says pool-safe' and 'it loads in the host' cannot drift apart." Each entry carries the *reason* a method is unsupported.
**Where.** `hermes_cli/plugin_isolation.py` (the tables) and `hermes_cli/plugin_isolation_audit.py` (the consumer).
**Why it transfers.** August Trading's "can this third-party integration run out-of-process?" question has the same shape. One table, two consumers, reasons attached.

### 2.10 A registration ledger with inverses — `UNIQUE`
**What.** Every plugin registration is recorded **with the inverse operation**, so a forced unload can undo exactly what the plugin did and nothing else.
**Where.** `hermes_cli/plugins_ledger.py` (`PluginRegistration` + `PluginLedgerMixin`).
**Why it transfers.** A skill that registers a tool, a prompt section, a memory writer or a scheduled job must be undoable *precisely*. A ledger of (what, how-to-undo) is the smallest correct implementation.

### 2.11 Fail-open on a broken probe, fail-closed on a positive match — `UNIQUE`
**What.** The kanban resume guard: a *probe error* fails open (an ordinary session must never be blocked by a broken probe) but a **positive** ownership match always refuses. It also distinguishes "someone else owns this" from "I cannot tell who owns this" as two separate machine-readable reasons.
**Where.** `hermes_cli/kanban_resume_guard.py` (`kanban_resume_refusal`); the same three-way split appears in `hermes_cli/active_sessions.py` (`SESSION_NOT_OWNED` / `SESSION_COORDINATION_UNAVAILABLE` / `MAX_CONCURRENT_SESSIONS`).
**Why it transfers.** A scheduled trading monitor that can be resumed by hand must not become an unsupervised second writer. The failure taxonomy — *owned by someone else* vs *cannot determine* — is what lets the operator know which action to take.

### 2.12 A budgeted judge with a wait verdict — `UNIQUE`
**What.** A per-turn auxiliary-model judge decides whether a standing objective is met, and can return **wait** (with `wait_on_session`, `wait_on_pid` or `wait_for_seconds`) so the loop parks on async work instead of burning turns. Judge *parse* failures and *transport* failures are counted separately, each with its own auto-pause threshold.
**Where.** `hermes_cli/goals.py` (the four verdicts and their JSON shapes; the two failure counters; `run_kanban_goal_loop` at the file's end).
**Why it transfers.** An August Trading "standing thesis monitor" — a rule that re-evaluates after each turn and asks an auxiliary model whether the thesis has been invalidated — needs exactly this: a strict JSON verdict, a wait-for-async branch, a turn budget, and separate counters for "the judge model is broken" vs "the provider is down."

### 2.13 Deterministic gates before the model's judgement — `UNIQUE`
**What.** Before the judge may declare a goal done, **shell gates** must pass: a timeout-bounded command, retried up to N times, whose bounded output tail becomes the continuation prompt when it fails. A failed gate short-circuits the judge entirely.
**Where.** `hermes_cli/goals.py` (`GoalGate`, `run_gate`, the gate-failure continuation template).
**Why it transfers.** "The model may not claim the backtest passed unless `npm test` passed" is the same shape, and the "failed gate's output *is* the continuation prompt" trick turns a vague retry into a concrete repair instruction.

### 2.14 A completion contract with a verification criterion — `UNIQUE`
**What.** A free-form goal can carry a five-field contract: outcome / verification / constraints / boundaries / stop_when. The judge then rules DONE *only* against the verification criterion and requires **concrete evidence** in the response — "not a claim like 'done' or 'all tests pass' without evidence." A violated constraint forces CONTINUE.
**Where.** `hermes_cli/goals.py` (`GoalContract`, `render_block`, the contract judge prompt).
**Why it transfers.** A trade thesis with an explicit "verification criterion" (price must close above X; volume must confirm; the risk must be < Y) is the trading equivalent, and it is a much better prompt than "is the goal done?"

### 2.15 Bound the "healthy" by what is *not* there — `UNIQUE`
**What.** A skill/memory store's health is judged partly by an **unavailable** state: `store_has_active_loop` returns True for a row it cannot parse ("unknown, so the caller keeps its full sweep") and *propagates* read errors, so an idle gate can tell "empty" from "unavailable."
**Where.** `hermes_cli/loops.py` (`store_has_active_loop`); the same pattern in `hermes_cli/heartbeat.py` (`store_has_active_heartbeat`).
**Why it transfers.** "There is no pending trade-review task" and "I cannot read the task store" must be different answers, or an automation will conclude "nothing to do" precisely when it should have raised an error.

### 2.16 A cheap gate, then an expensive measurement — `UNIQUE`
**What.** The low-disk advisor's hot path is **two syscalls**; only when that fires does the code open the database and estimate what a prune would free. The estimate is scaled from a cached total refreshed weekly, and weighted by stored bytes rather than row count.
**Where.** `hermes_cli/prune_advisor.py` (`should_ask` / `advise` / `_cached_total_bytes`).
**Why it transfers.** A disk/ledger-pressure advisor for a trading app (session DB growth, log growth, chart-cache growth) should be structured the same way: a sub-millisecond check on every start, a deep measurement only when the check fires.

### 2.17 Say plainly when the fix will not help — `UNIQUE`
**What.** The advisor's `Advice.helps` property is false when the prune would free under 1 GiB *and* would not lift the disk out of the low band — and the prompt says so, instead of offering a remedy that will not work.
**Where.** `hermes_cli/prune_advisor.py` (`Advice.helps`).
**Why it transfers.** A trading app that suggests "reduce risk" or "close positions" should compute whether the suggestion actually changes the outcome, and say "this will not fix it" when it does not.

### 2.18 Refuse to destroy a whole section with one key — `UNIQUE`
**What.** `hermes config set model gpt-5` **redirects** to `model.default` and prints "✓ Redirecting bare 'model' to 'model.default' (preserving N existing model sub-key(s))". Any other section written with a scalar is refused, with its sub-keys listed and the exact dotted command to use.
**Where.** `hermes_cli/config_section_guard.py` (`_guard_section_overwrite`).
**Why it transfers.** A single flat settings object (a "strategy config" with a nested block) is one careless write away from total loss. A guard that redirects or refuses, and *says which sub-keys exist*, is a pattern August Trading could adopt for any grouped settings.

### 2.19 A frozen compat surface, declared — `UNIQUE`
**What.** Two modules are explicitly a **frozen compat surface** for in-flight updaters: "removing a name bricks releases mid-update." Their exports are pinned by a JSON fixture.
**Where.** `hermes_cli/AGENTS.md` ("Update pipeline" section) and the `hermes_cli/_old_updater.py`, `old_updater_deps.py`, `old_updater_main.py`, `update_handoff.py`, `plugin_compat.py` family.
**Why it transfers.** If August Trading ever ships a self-updater, the seam between "the running old process" and "the new code on disk" is a real hazard, and declaring the frozen surface (rather than deleting names) is the cheap insurance.

### 2.20 A queue that survives an owner restart — `UNIQUE`
**What.** A prompt typed while a turn runs is an **admission row in the owner's durable FIFO**, not a local variable. The client keeps no copy to resend. A lost RPC answer is re-asked once under the same `submission_id` so the owner recognises it and does not queue it twice; if the answer is still lost, the client raises a distinct `QueueOutcomeUnknown` and tells the user to *check the queue* rather than re-send.
**Where.** `hermes_cli/gateway_queue.py` (`submit_queued`, `QueueOutcomeUnknown`).
**Why it transfers.** A trading app where the user can queue a "re-analyse EURUSD with the new thesis" while an analysis is running needs exactly this: durable, exactly-once, and honest about uncertainty.

### 2.21 Keep a mutation's identity across an ambiguous reply — `UNIQUE`
**What.** A control (model switch, compress, rewind) captures its compare-and-set tuple once and **retains it** across a lost reply, so a retry re-presents the original target rather than re-deriving one from an already-mutated transcript. Any *other* verb on the session retires the retained identity.
**Where.** `hermes_cli/gateway_mutations.py` (`PreparedMutations.apply` / `retire`).
**Why it transfers.** An order edit, a "re-scan" or a "apply this rule" action in a trading app should be idempotent under a lost response.

### 2.22 A "may not splice the reply across the hole" rule — `UNIQUE`
**What.** After a replay gap, the owed reply is the *rest of an exact prefix* if the painted part is a prefix of the final answer; otherwise a `[output resumed]` marker plus the whole answer. It is never stitched.
**Where.** `hermes_cli/gateway_replay_gap.py` (`owed_reply`).
**Why it transfers.** If a streaming answer is ever re-rendered after a reconnect, a partial answer must never be concatenated with a fresh one into something that reads as a single coherent message.

### 2.23 A seam-defending rejoin for summarised history — `UNIQUE`
**What.** Concatenating a summarised head with a verbatim tail defends the *role alternation* providers validate; if the seam would produce two same-role messages, the tail's first string content is folded onto the head's last message, and non-string (multimodal) content gets a minimal bridging turn so nothing is lost. Tool messages are left alone.
**Where.** `hermes_cli/partial_compress.py` (`rejoin_compressed_head_and_tail`, `split_history_for_partial_compress`).
**Why it transfers.** Any summarise-and-tail scheme (which August Trading will want for long analysis threads) must defend the seam, or the provider rejects the whole request.

### 2.24 Prompt-size as a first-class, offline diagnostic — `CONVERGENT`
**What.** `hermes prompt-size` builds a *real* agent with dummy credentials (so the numbers match the wire) and makes no network call, then reports the system prompt, the three prompt tiers, the per-skill always-on index cost vs on-disk read cost, and the per-toolset schema bytes.
**Where.** `hermes_cli/prompt_size.py` (`_build_inspection_agent`, `compute_prompt_breakdown`).
**Why it transfers.** "What does each of my skills and toolsets cost on every request?" is a question August Trading cannot currently answer, and the answer changes behaviour (disable this toolset, demote that skill to on-demand).

### 2.25 Skills index lives in the volatile prompt tier — `CONVERGENT`
**What.** The skills index was moved from the *stable* tier to the *volatile* tier, "so skill edits don't invalidate the cached identity prefix."
**Where.** `hermes_cli/prompt_size.py` (the tier note in `compute_prompt_breakdown`).
**Why it transfers.** In August Trading, a user-editable rule/skills list should not sit in the cached prefix; the *stable* prefix should contain only what rarely changes.

### 2.26 Cost and data-policy guards, unified across surfaces — `UNIQUE`
**What.** One `model_selection_guards` registry produces the cost warning, the data-training-policy warning and the context-cache warnings; every model-switching surface renders the *same* merged message.
**Where.** `hermes_cli/model_selection_guards.py` (`selection_warnings` / `combined_selection_warning`), `hermes_cli/model_cost_guard.py`, `hermes_cli/model_data_policy_guard.py`.
**Why it transfers.** A single provider-model cost warning that appears identically in the CLI, in Settings and on the dashboard — instead of one surface warning and another not.

### 2.27 Warn about the *consequence*, not the fact — `UNIQUE`
**What.** Switching to a smaller-context model while the session is large produces a warning that quotes the real numbers: "Context window shrinks (200,000 → 131,072). Session is ~148,000 tokens; the new model allows 131,072 (auto-compress at ~65,536). Your next message will run preflight compression before the model replies." It is suppressed after two ineffective compressions.
**Where.** `hermes_cli/context_switch_guard.py` (`merge_preflight_compression_warning`).
**Why it transfers.** The same shape for a trading app: "switching to the cheap model will drop the 3 months of context you were relying on."

### 2.28 A provider-fallback notice with one shared sentence — `UNIQUE`
**What.** When the primary provider is unavailable and a fallback takes over, the user sees one line — "⚠️ Provider fallback: primary/provider unavailable; using fallback/model for this response" — and the string lives in **one** function used by the messaging gateway, the TUI/Desktop gateway and cron, "so the three pre-agent fallback paths cannot drift in wording."
**Where.** `hermes_cli/fallback_config.py` (`pre_agent_fallback_notice`).
**Why it transfers.** A trading app with multiple model providers (or multiple data feeds) should have *one* sentence for "we degraded", used by every surface.

### 2.29 Alias-collapse before dedup — `UNIQUE`
**What.** Fallback entries are normalised to a canonical provider id *before* the dedup, because "two fallback entries naming the same backend under different ids are kept as separate slots, shifting the chain and letting an alias slip past the same-backend skip."
**Where.** `hermes_cli/fallback_config.py` (`_normalize_provider_id`, `get_fallback_chain`).
**Why it transfers.** A fallback chain of data providers (Polygon → Polygon.io → the polygon API) must be canonicalised before it is compared, or the chain silently grows and the "skip the provider that already failed" rule stops working.

### 2.30 Read secrets through the scope, not the environment — `UNIQUE`
**What.** `key_env` is read through `agent.secret_scope.get_secret`, **not** `os.getenv`, because in a multiplexed gateway "a bare env read ignores the active profile's scope and can return another profile's credential."
**Where.** `hermes_cli/fallback_config.py` (`resolve_entry_api_key`).
**Why it transfers.** Any per-workspace/profile key resolution must go through the scope, or profile A's key can be used for profile B.

### 2.31 A durable analytics outbox with backoff and a lease token — `UNIQUE`
**What.** Metrics are aggregated into SQLite, packaged, and put on an outbox. Each package carries `send_attempts`, `next_attempt_at` (backoff across process restarts), `last_error`, and a `claim_token` rewritten on every claim; settlement and the pre-POST revalidation are compare-and-set on the token, so "a claimant whose lease lapsed loses authority the moment another process reclaims (else a suspended sender double-POSTs)." The transmitted `install_id` is **frozen on the first attempt** so retries are byte-identical.
**Where.** `hermes_cli/observability/shared_metrics.py` (the schema and the send columns; `SharedMetricsSender`).
**Why it transfers.** A "trade journal export" or "usage export" that must survive a crash without double-sending gets this outbox shape for free.

### 2.32 Consent as intervals, not a moving day-stamp — `UNIQUE`
**What.** Consent is recorded as explicit intervals (`opened_at`, `last_confirmed_at`, `closed_at`), "closed at the LAST CONFIRMED moment (never 'now') on withdrawal."
**Where.** `hermes_cli/observability/shared_metrics.py` (`_CREATE_CONSENT_TABLES_SQL`).
**Why it transfers.** A "share my trading journal" opt-in that can be withdrawn should record *when consent was actually in force*, not when you last looked.

### 2.33 Bucket every metric — `UNIQUE`
**What.** Every efficiency measure is a bucket (`tokens_bucket`, `activity_bucket`, `output_size_bucket`, `schema_tokens_bucket`), never a raw number, so the row cardinality is bounded.
**Where.** `hermes_cli/observability/shared_metrics_efficiency.py`.
**Why it transfers.** A "how many tokens did this analysis cost" metric with raw values is useless in an aggregate table and explodes its cardinality; buckets fix both.

### 2.34 A closed metric contract with drift conformance — `UNIQUE`
**What.** The contract module defines closed enums and bounded dimension sets; a `shared_metrics_drift` module exists specifically to *conform* rows written by an earlier build to the current contract, so an old row is not dropped when the contract tightens.
**Where.** `hermes_cli/observability/shared_metrics_drift.py` (`conform_counter_dimensions` / `counter_dimensions_shape_is_known`), `hermes_cli/observability/shared_metrics_contract.py`.
**Why it transfers.** A metrics table whose shape changes between app versions needs a conformance pass, or the history is silently truncated at the first release that renames a dimension.

### 2.35 Multi-agent as a graph in the existing store — `UNIQUE`
**What.** The swarm topology is written into the *existing* kanban tables, and the shared blackboard is structured JSON comments on the root card — "so all state lives in existing `task_comments`/`task_events` rows and the dashboard, notifier, slash command and dispatcher keep working without a new service."
**Where.** `hermes_cli/kanban_swarm.py` (the module docstring; `post_blackboard_update` / `latest_blackboard`).
**Why it transfers.** A bull/bear/critic panel in a trading app can be a task graph in the existing job store, with the panel's shared notes as structured comments — no new orchestrator service, and the existing UI keeps working.

### 2.36 A verifier gate between workers and synthesis — `UNIQUE`
**What.** The swarm topology is workers → **verifier** (which "complete[s] only with metadata `{"gate": "pass"}` when evidence is sufficient; otherwise block with exact missing work") → synthesizer. The verifier is given the `requesting-code-review` skill; the synthesizer the `humanizer` skill.
**Where.** `hermes_cli/kanban_swarm.py` (the verifier and synthesizer card bodies).
**Why it transfers.** A multi-model trading panel should have an explicit *verifier* that can block with "exactly what is missing", not just an aggregator that averages opinions.

### 2.37 "Prefer parallelism" in the decomposer prompt — `UNIQUE`
**What.** The decomposer prompt explicitly asks for a small graph, says "Prefer parallelism. If two tasks can be done independently, give them no parents so the dispatcher fans them out at once", caps at 2-6 tasks, and routes each child to the profile whose *description* matches.
**Where.** `hermes_cli/kanban_decompose.py` (`_SYSTEM_PROMPT`).
**Why it transfers.** The same prompt shape works for "split this trading thesis into 2-6 independent checks".

### 2.38 A heartbeat that is told to report "nothing changed" — `UNIQUE`
**What.** The heartbeat prompt ends: "If there is nothing meaningful to do or report for this instruction right now, reply briefly that nothing has changed and stop — **do not invent work**."
**Where.** `hermes_cli/heartbeat.py` (`HEARTBEAT_PROMPT_TEMPLATE`).
**Why it transfers.** This one sentence is the difference between a scheduled market monitor and a scheduled hallucination generator. It should be copied verbatim in spirit into any recurring analysis prompt.

### 2.39 Distinguish "the run worked" from "the result was delivered" — `UNIQUE`
**What.** `cron doctor` reports `last_status == "delivery_failed"` as *the agent run succeeded; the delivery issue below reports it*, and `last_delivery_unverified` (an adapter that acked without evidence) is a third, separate state.
**Where.** `hermes_cli/cron.py` (`_cron_doctor_issues_for_job`).
**Why it transfers.** In a trading app, "the analysis completed" and "the result reached the trader (or the journal)" are different facts, and so is "we think it reached them but have no evidence". Three states, not two.

### 2.40 A grace period, shared by every surface that reports lateness — `UNIQUE`
**What.** A 15-minute overdue grace, and the *same* constant used by `cron status`, `cron list` and `cron doctor` "so status, list, and doctor tell one consistent story about when a job counts as overdue."
**Where.** `hermes_cli/cron.py` (`_OVERDUE_GRACE_SECONDS` and its three users).
**Why it transfers.** A trading app's "did my scheduled scan run?" indicator should use one shared threshold, or the surfaces will disagree and the trader will not trust any of them.

### 2.41 Late-fire warnings that clear themselves — `UNIQUE`
**What.** A `last_dispatch` record with `kind` in `late` / `catch_up` produces a warning that "clears at the next on-time fire", and the lateness is *measured* (scheduled_at vs dispatched_at) rather than inferred.
**Where.** `hermes_cli/cron.py` (`_dispatch_kind_label`, `_format_lateness`, `_next_run_row`).
**Why it transfers.** A dashboard that says "your scan was 4 hours late" should say so *once*, with the measured numbers, and stop saying it after a good run.

### 2.42 Keep the cheap check in the hot path, move the measurement off it — `UNIQUE`
**What.** The CLI's auto-maintenance (state-db pack/vacuum and checkpoint pruning) runs **off the prompt thread**.
**Where.** `hermes_cli/cli_auto_maintenance.py` (`_run_state_db_auto_maintenance`, `_run_checkpoint_auto_maintenance`).
**Why it transfers.** A trading app's cleanup work (session DB compaction, chart cache eviction) must never sit on the path that answers the trader.

### 2.43 A support floor for migrations — `UNIQUE`
**What.** Configs older than version 12 are **left byte-for-byte untouched** and the process continues with defaults deep-merged at read time, with a message telling the user how to proceed. "Carrying the sub-v12 steps and the env bridges they consumed forever is not worth it."
**Where.** `hermes_cli/config_migrations.py` (`SUPPORT_FLOOR_VERSION` / `support_floor_message`).
**Why it transfers.** August Trading's settings migrations should have an explicit floor, not an unbounded chain.

### 2.44 Never clobber a value the user customised — `UNIQUE`
**What.** A migration step rewrites a key **only while it still equals the old default**; an unset key simply inherits the new default at read time.
**Where.** `hermes_cli/config_migrations.py` (`_rewrite_stale_default`).
**Why it transfers.** A rule/parameter migration must not overwrite a value the trader deliberately changed.

### 2.45 The right to be expensive is confirmed, not assumed — `UNIQUE`
**What.** A model whose *known* pricing exceeds $20/M input or $100/M output triggers a confirmation. It never fires on unknown pricing, and it refuses to trust a price that disagrees with the requested provider.
**Where.** `hermes_cli/model_cost_guard.py` (`expensive_model_warning`).
**Why it transfers.** A trading app that spends real money on a model should confirm the expensive one — and must not warn on a price it does not actually know.

### 2.46 A cheap local recap — no model call at all — `UNIQUE`
**What.** The session recap is "pure local computation: no LLM call, no auxiliary model, no prompt-cache invalidation. A recap should be instant and free."
**Where.** `hermes_cli/session_recap.py` (`build_recap`).
**Why it transfers.** A "what has this session established so far?" summary for a trading thread should be a local computation over the transcript, not a model call.

### 2.47 Treat stored text as untrusted at the display boundary — `CONVERGENT`
**What.** The recap strips escapes and control characters from stored history, "so a recap line can't clear the screen or retitle the window when echoed to a terminal." The skill hub, the debug exporter and the approvals suggester all redact before display.
**Where.** `hermes_cli/session_recap.py` (`_truncate`); `hermes_cli/approvals_suggest.py` (`build_proposals` — redact for display, classify on raw); `hermes_cli/debug_redaction.py`.
**Why it transfers.** A trade journal rendered into a UI must never let a note (or a model output) escape its container.

### 2.48 Classify on the raw value, display the redacted one — `UNIQUE`
**What.** In `approvals suggest`, the *classification* sees the raw command but the *example* shown to the operator is redacted — and the glob is derived from the raw command, because "a redacted `***` inside a persisted pattern would be three fnmatch wildcards." If redaction touched the embedded tokens, the proposal falls back to the class key.
**Where.** `hermes_cli/approvals_suggest.py` (`build_proposals`).
**Why it transfers.** A rule-learning loop over real command/keyword strings must be able to redact for display without corrupting the pattern it is about to persist.

### 2.49 A doctor for the *scheduler itself* — `UNIQUE`
**What.** `hermes cron doctor` is a read-only health check that names, per job: the last run's failure, a delivery failure, an unverified delivery, a late fire, a missed fire, a missing `next_run_at`, a missing script, a script outside the sandbox, a missing workdir. It returns a shell-friendly status code.
**Where.** `hermes_cli/cron.py` (`_cron_doctor_issues_for_job`, `cron_doctor`).
**Why it transfers.** A trading app needs the same: "why did my 3 scheduled scans not run today?" answered per job, read-only, with a non-zero exit code so CI can gate on it.

### 2.50 Health checks that explain the *state* — `UNIQUE`
**What.** The store's health function reports a `state.db` as unreadable and *says why* (locked, corrupt header, wrong journal mode, a WAL with holders) rather than a generic failure.
**Where.** `hermes_cli/doctor_state.py` (`_state_db_health`, `_state_db_wal`, `_classify_unreadable_state_db`, `_retired_wal_holders`).
**Why it transfers.** "Your trade journal is corrupt" is useless; "your journal is on a WAL with 3 live holders" tells the operator what to do.

### 2.51 An idle gate that tells "empty" from "unavailable" — `UNIQUE`
**What.** `store_has_active_loop(db)` takes the store explicitly and **propagates** read errors, "so an idle gate can tell 'empty' from 'unavailable'"; the parse-failure case returns True (keep the full sweep).
**Where.** `hermes_cli/loops.py` (`store_has_active_loop`); the same pattern in `hermes_cli/heartbeat.py` (`store_has_active_heartbeat`).
**Why it transfers.** An idle-watcher that decides "no work, go idle" must not do so because the store read failed.

### 2.52 A "no second scheduler" rule — `UNIQUE`
**What.** The swarm module's docstring opens with "Deliberately no second scheduler — a small task graph written into the existing Kanban kernel." The dashboard's cron surface likewise does not fire jobs; it forwards to the gateway and reports `cron_run_scheduler_owned`.
**Where.** `hermes_cli/kanban_swarm.py` (module docstring); `hermes_cli/web_routers/cron.py` (`cron_run_scheduler_owned`).
**Why it transfers.** A trading app that adds a "monitor" and a "scheduler" and a "watcher" must have exactly one thing that decides *when* work runs, or it will double-fire.

### 2.53 One command surface, several renderers — `CONVERGENT`
**What.** The classic CLI's `/cron` is written once as **plain lines** (`cli_cron_lines.py`) and rendered by the CLI, the TUI and the gateway. The goal manager is the same: `dispatch_goal_command` in `goal_command.py` owns the semantics; the CLI, the messaging gateway, the TUI/Desktop/dashboard and the Desktop goal controls all delegate to it. "Do not add a surface-specific goal parser."
**Where.** `hermes_cli/cli_cron_lines.py`; `hermes_cli/goal_command.py`; `hermes_cli/AGENTS.md` ("Shared goal commands").
**Why it transfers.** The equivalent of "one place decides what `/analyze` means, and each surface only renders it" for August Trading's slash commands and dock actions.

### 2.54 A session-store contract that the owner alone writes — `CONVERGENT`
**What.** Under the gateway, the CLI "never builds an agent, never runs a tool and never writes `state.db`: the turn runs in the gateway." The session store is a `GatewaySessionStore` that proxies the gateway's session API.
**Where.** `hermes_cli/gateway_agent.py` (module docstring); `hermes_cli/gateway_session_store.py`; `hermes_cli/gateway_automation.py` (the managers are "thin proxies … every mutation and judgement is one `session.automation` call").
**Why it transfers.** One writer for the trade journal. A React app with an Electron main process and a renderer can easily end up with two writers; making the *backend* the sole writer and the renderer a pure view is the fix.

### 2.55 A local read before a round trip — `UNIQUE`
**What.** `GatewayHeartbeatManager.due_prompt` does the cheap local `is_due` check first: "main's cheap local check first: the idle poll costs no round trip." The same pattern appears in `is_waiting` ("a state with no barrier answers locally").
**Where.** `hermes_cli/gateway_automation.py` (`due_prompt`, `is_waiting`).
**Why it transfers.** A polling scheduler in a trading app should answer "is anything due?" from local state and only then ask the authority.

### 2.56 A sentinel the model can emit, instead of a schema field — `UNIQUE`
**What.** The `/loop` completion condition is the model writing `LOOP_COMPLETE` on its own line, matched by a tolerant regex that allows surrounding whitespace and trailing punctuation.
**Where.** `hermes_cli/loops.py` (`LOOP_COMPLETE_MARKER`, `_LOOP_COMPLETE_RE`) and the wakeup prompt that teaches it.
**Why it transfers.** A recurring analysis job can ask the model to end with a sentinel line, and the harness parses it — no structured output, no tool call, no extra round trip.

### 2.57 Focus view: hide the machinery, but say what you hid — `UNIQUE`
**What.** `/focus` snaps the tool-progress mode to `off` — the *same* value `/verbose off` uses, "so both features share one suppression path" — and then adds a per-turn count: "⋯ 7 tool lines hidden · /focus off to show". The counter mirrors the renderer's own visibility gate exactly, "so the hidden-line counter and the renderer never drift apart."
**Where.** `hermes_cli/focus_view.py` (`FOCUS_TOOL_PROGRESS_MODE`, `would_display_tool_line`).
**Why it transfers.** A trading app that collapses tool chatter should still tell the trader how much it hid — and the count must be computed from the *same* predicate the renderer uses, or it will lie.

### 2.58 Show the fix, not just the problem — `UNIQUE`
**What.** Startup notices for unavailable toolsets say what is off and *the exact command that fixes it*, in plain words; multi-provider env-var dumps are replaced by one sentence naming the acceptable providers.
**Where.** `hermes_cli/tool_availability_notices.py` (`tool_availability_warning_lines`).
**Why it transfers.** "Your paper-trading broker key is missing — run `hermes setup tools`" beats "BROKER_API_KEY unset".

### 2.59 A config-change guard that lists the sub-keys — `UNIQUE`
**What.** The refusal message enumerates the section's sub-keys (first 8, then "… and N more") and prints the exact dotted command for each pattern.
**Where.** `hermes_cli/config_section_guard.py` (`_guard_section_overwrite`).
**Why it transfers.** An error message that teaches the correct call is worth ten that merely reject.

### 2.60 A dry-run curator that says exactly what it will not touch — `UNIQUE`
**What.** `hermes curator status` reports the *unmanaged* skills separately — "never auto-staled or archived — `hermes curator adopt <name>` hands one over" — because "the curation blind spot matters on the managed path too."
**Where.** `hermes_cli/curator.py` (`_print_unmanaged_summary`).
**Why it transfers.** A rule/skill pruner should report the rules it will *not* touch, or the operator cannot tell coverage from silence.

### 2.61 Consolidate by default off — `UNIQUE`
**What.** The curator's LLM merge pass is opt-in; the default is deterministic prune-only, and the CLI says so: "consolidation is off — running prune-only (deterministic stale/archive)."
**Where.** `hermes_cli/curator.py` (`_cmd_run`).
**Why it transfers.** An LLM-driven consolidation of a trading rulebook should be opt-in with a deterministic default.

### 2.62 An approval bound to the bytes that were approved — `UNIQUE`
**What.** A hook's approval records the script's mtime; `hermes hooks list` compares it to the current mtime and warns "script modified since approval — run `hermes hooks doctor` to re-validate."
**Where.** `hermes_cli/hooks.py` (`_mtime_drift`).
**Why it transfers.** A user-installed strategy script or a skill file that the trader approved once should be re-approved when its *content* changes. A content hash beats an mtime; the idea transfers either way.

### 2.63 Run the hook with the runtime's own payload shape — `UNIQUE`
**What.** `hooks test` uses *synthetic kwargs matching the real call sites* so the stdin a script sees has the runtime shape — enumerated per event (`pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`, `pre_verify`, `on_session_start/end/finalize/reset/delete`, `pre_api_request`, `post_api_request`, `pre_auxiliary_call`, `post_auxiliary_call`).
**Where.** `hermes_cli/hooks.py` (`_DEFAULT_PAYLOADS`).
**Why it transfers.** A trading app with user-defined "on trade closed" hooks should ship a **payload fixture set** so the hook can be tested without a live session.

### 2.64 An audit log that is JSON-lines with size rotation — `UNIQUE`
**What.** The dashboard-auth audit writes one JSON object per line to `$HERMES_HOME/logs/dashboard-auth.log`, with size-based rotation matching the rest of Hermes's logging convention, and every field **bounded** before it is written.
**Where.** `hermes_cli/dashboard_auth/audit.py` (`AuditEvent`, `_bounded_value`, `_rotate_if_needed`, `audit_log`).
**Why it transfers.** A trading app's "who approved what trade" log is exactly this shape: JSONL, bounded fields, rotated by size, and cheap to grep.

### 2.65 A WS upgrade ticket, minted and consumed once — `UNIQUE`
**What.** WebSocket auth uses a ticket: `mint_ticket` / `consume_ticket`, with expired tickets garbage-collected under a lock and a consumed ticket rejected.
**Where.** `hermes_cli/dashboard_auth/ws_tickets.py`.
**Why it transfers.** A desktop app's local socket to the backend is the same shape.

### 2.66 A single-flight refresh with a short replay cache — `UNIQUE`
**What.** Rotating refresh tokens go through `refresh_session_coalesced`: concurrent refreshes for the same session share one call, and a short replay cache serves the recent result, so a burst of requests does not rotate the token N times.
**Where.** `hermes_cli/dashboard_auth/refresh_singleflight.py` (`_Flight`, `refresh_session_coalesced`).
**Why it transfers.** Any rotating credential (a broker session token, an OAuth refresh) needs single-flight, or a burst of parallel requests invalidates itself.

### 2.67 A hardline floor that survives "yolo" — `CONVERGENT`
**What.** The approval ladder's order puts the hardline blocklist *before* the yolo / `approvals.mode: off` bypass, and the hardline floor is "never bypassable, even under --yolo." The user `approvals.deny` rules also fire before the bypass.
**Where.** `hermes_cli/approvals_test.py` (steps 2, 4 and 5 of the ladder).
**Why it transfers.** A trading app with an "unattended / auto-trade" mode still needs a floor that mode cannot cross — and the ladder order must make that explicit.

### 2.68 Fail closed on unreadable config, but never destroy it — `CONVERGENT`
**What.** A config that cannot be read or parsed is a `FailedConfigRead`: writes are **refused** and the user is pointed at the backups directory, but the file is never overwritten. `config_backups.py` keeps bounded, point-in-time copies with one naming scheme.
**Where.** `hermes_cli/config_read_errors.py` (`FailedConfigRead`, `_refuse_failed_read`, `_refuse_overwrite`, `_backups_dir_display`); `hermes_cli/config_backups.py`.
**Why it transfers.** A strategy-config file the app cannot parse must be preserved, not reset.

### 2.69 A frozen owned-atomic writer — `CONVERGENT`
**What.** Every `config.yaml` write goes through `atomic_config_write` (which refuses deletion by omission) or the explicit full-state `atomic_config_replace`; a CI lint script rejects `yaml.dump` on a config path, and a test guards comment preservation. "Never call `atomic_yaml_write` / `yaml.dump` / `yaml.safe_dump` on a config path."
**Where.** `hermes_cli/AGENTS.md` ("Config system" → "One writer seam"); `hermes_cli/config.py`.
**Why it transfers.** August Trading's settings writes should go through one atomic writer, and a lint should reject the alternatives.

### 2.70 A lint that rejects the wrong writer — `UNIQUE`
**What.** `scripts/check_config_yaml_writers.py` runs in CI and rejects a config write that does not use the approved writer; a test asserts comment preservation per path. And "Every `DEFAULT_CONFIG` key has a runtime reader, and every reader a registry entry" is enforced by an `rg` in two places plus an invariant test, "because both drift modes are silent."
**Where.** `hermes_cli/AGENTS.md` ("One writer seam" and "Every `DEFAULT_CONFIG` key …").
**Why it transfers.** A registered key nothing reads is a knob that does nothing; a reader of a key never registered is never shown and never migrated. Both are invisible without a mechanical gate.
---

## 3. Trading-specific findings

### 3.1 Long-lived monitoring & scheduled work
**The engine.** Hermes splits scheduling across **four** mechanisms with different durability, and the module docstrings say so explicitly:
- `hermes cron` — **cross-process, durable**: a real scheduler with jobs persisted in a store, with `create`/`edit`/`pause`/`resume`/`run`/`remove`, a durable per-job **notepad** (KV across runs), a **continuity** flag (each run sees the previous run's output), a per-job **model pin**, a **monitor mode** (a cheap script/URL whose unchanged output suppresses the agent run), a **no-agent mode** (the script *is* the job), and per-job **failure-delivery** routing separate from success delivery.
- `/loop` (`hermes_cli/loops.py`) — **in-session, durable state, in-process driver**: fixed or self-paced cadence, `--times N`, an `--until` judged stop condition, a `max_ticks` backstop, and a `LOOP_COMPLETE` sentinel.
- `/heartbeat` (`hermes_cli/heartbeat.py`) — **in-session recurring re-entry**, explicitly *not* durable cross-process: "durable cross-process scheduling stays `hermes cron`."
- `/goal` (`hermes_cli/goals.py`) — **a standing objective re-judged after every turn** by an auxiliary model.

**What keeps it reliable — the concrete mechanisms in this shard:**
1. **A measured late-fire record.** Each dispatch records `kind` (`on_time` / `late` / `catch_up`), `scheduled_at`, `dispatched_at` and `lateness_seconds`. Lateness is a *fact stored*, not a guess.
2. **A shared overdue grace (15 min)** used by `status`, `list` and `doctor` so the three surfaces agree.
3. **A `next_run_at` parked in the past** is the "the job is silently not firing" signal — with the grace applied so a busy tick is not a false alarm.
4. **`last_fire_error` survives `next_run_at` advancing** — the missed fire is not erased by the next schedule.
5. **Execution failure ≠ delivery failure.** `last_status` (`ok` / `delivery_failed` / `delivery_queued`), `last_error`, `last_delivery_error` and `last_delivery_unverified` are four separate fields, so "the agent ran but the trader never saw it" is its own diagnosis.
6. **A durable incident list** (`cron incidents`, states `detected` → `alerted` → `resolved` → `closed`, with an `ack` action) — failures are *records*, not just log lines.
7. **A durable execution log** (`cron runs`, with `--limit 1-500`) and, in the dashboard, a reconciliation step (`_reconcile_cron_runs`) between the run history and the live scheduler.
8. **A read-only `cron doctor`** that returns a shell-friendly status code.
9. **Exactly one scheduler.** The dashboard forwards a fire to the gateway; the swarm module adds "no second scheduler."
10. **A durable queue for work typed while a turn runs** (`/queue`), which survives an owner restart, runs once, in FIFO order, with an exactly-once `submission_id` retry.
11. **A turn budget on every standing loop** (`max_ticks`, `max_turns`), plus a hard floor on the heartbeat interval (60 s) and the loop interval (30 s) — "anything tighter is almost always an accident that burns tokens polling unchanged state."
12. **Auto-pause on a broken judge**, with two separate counters (3 parse failures, 5 transport failures) so a small model that cannot emit the JSON contract and an unreachable provider are diagnosed differently.
13. **A wait verdict** so a loop blocked on a background process parks rather than re-poking.
14. **A model pin per job** (`--model` / `--pin`), so a later change to the main model does not silently change what a scheduled scan runs on.

**For August Trading this maps to:** a `hermes cron`-equivalent scheduled scan with (a) a cheap monitor probe that suppresses the model call, (b) a per-job notepad, (c) measured lateness and a shared overdue threshold, (d) execution-vs-delivery as separate fields, (e) a durable incident list, and (f) a read-only doctor. The `LOOP_COMPLETE` sentinel and the "reply that nothing has changed, do not invent work" heartbeat line are the two cheapest wins.

### 3.2 Human-in-the-loop approval
**Three distinct approval mechanisms, deliberately separated:**
1. **Command/operation approval** — the dangerous-command classifier with a seven-step ordered ladder (`hermes_cli/approvals_test.py`). The order is the contract: container-skip → hardline blocklist → sudo-stdin guard → user `approvals.deny` rules → yolo/off bypass → permanent allowlist → dangerous-pattern detection. A **hardline floor survives yolo**; the user deny rules also fire before the bypass. The persistent mode is `manual | smart | off` (`hermes_cli/approval_mode.py`), and changing it **does not rebuild a live agent** (prompt-cache prefix preserved).
2. **Write approval (staged writes)** — `/memory` and `/skills` writes are staged as pending records with an id, an origin (`foreground` / `background_review`), a summary and a payload; the trader approves or rejects; a diff is viewable; and the approval output prints the **full text** of what was overwritten or removed. A staged replace/remove is *pinned* to the exact entry it matched.
3. **Plugin/transport approval** — the hashed, expiring, correlated request contract in `hermes_cli/approval_transport.py`.

**The audit trail that survives a decision:**
- **Implied approvals are recoverable from the transcript** — a dangerous-class command whose tool result contains no block marker *was* approved, and the history can be mined into allowlist proposals (`hermes_cli/approvals_suggest.py`), with destructive classes excluded regardless of frequency.
- **The decision itself is bound to a digest** — request id + SHA-256 of the canonical request fields, so a decision cannot be replayed against a different request.
- **Hooks record what was approved and when** — `script_mtime_at_approval` gives a hook approval a *content* binding, and `hermes hooks doctor` re-validates it.
- **A JSON-lines audit log** with bounded fields and size rotation (`hermes_cli/dashboard_auth/audit.py`).
- **Refusals carry a machine-readable reason** — `SESSION_NOT_OWNED` / `SESSION_COORDINATION_UNAVAILABLE` / `MAX_CONCURRENT_SESSIONS`, and the reason crosses a subprocess boundary as a `hermes-refusal-reason:` line.

**For August Trading:** the seven-step ladder with a hardline floor, the staged-write approval with "show me exactly what will be lost", and the hashed request/decision pair are the three transferable shapes. The "mine implied approvals, but never propose a destructive class" loop is the fourth.

### 3.3 Post-mortem / reflection loops
**The reflection machinery in this shard:**
- **The goal judge** (`hermes_cli/goals.py`) — after every turn, an auxiliary model rules DONE / BLOCKED / CONTINUE / WAIT against the objective, a completion contract (outcome / verification / constraints / boundaries / stop_when) and any subgoals. Evidence is required: "Do not accept generic phrases like 'all requirements met' … require specific evidence (a file contents excerpt, an output line, a command result)."
- **Deterministic gates before judgement** — a gate that fails short-circuits the judge and its output becomes the repair instruction.
- **The curator** (`hermes_cli/curator.py`) — the *rule/skill* lifecycle: `stale_after_days`, `archive_after_days`, `min_idle_hours`, a configurable `interval_hours`, **pinned** skills, an **adopt** path for unmanaged skills, a **ledger**, **backup** and **purge** verbs, and a separate **restore**. The LLM *consolidation* (merge) pass is opt-in; the default is deterministic prune-only.
- **The learning graph** (`hermes_cli/journey.py`) — what Hermes has learned, on a timeline, with age-tinted signals, a playhead, and an explicit **contrast floor** (`_CHARTED_SIGNAL_MIN_CONTRAST = 4.5`): the age tint may fade a signal but "explanatory labels" must not disappear — `_ensure_contrast` lifts the foreground toward the readable pole until it clears the minimum.
- **The journey view's own deletions** are auditable: `journey delete` / `journey edit` exist, so the learning record is editable by the human.
- **Metrics that measure the loop** — `shared_metrics_loop.py` records memory operations, curator runs and delegation depth/outcome, with the origin (`foreground` / `background_review`) captured, so an agent-created rule and a user-created one are distinguishable in the data.

**What stops bad rules accumulating (the gates, in order of strength):**
1. **Deterministic staleness** — `stale_after_days` / `archive_after_days` on *measured* usage (frequency and recency are tracked separately, and a *view* counts as activity so a skill does not read as "never used" right after it was opened).
2. **Pinning** — a pinned skill is exempt.
3. **The unmanaged blind spot is reported, not acted on** — skills with no provenance marker are *never* auto-staled or archived; adoption is an explicit human act.
4. **The merge pass is opt-in and separable** from the prune pass.
5. **A ledger, a backup, a purge and a restore** — every destructive curator action has a compensating verb.
6. **Evidence requirements in the judge** — a rule cannot be retired on a vibe.

**For August Trading:** the combination of (a) a usage-measured staleness rule with a *pin* escape, (b) an explicit "these are the ones I will not touch" report, (c) an opt-in LLM consolidation separate from deterministic pruning, and (d) a ledger + backup + restore, is a complete anti-bloat answer.

### 3.4 Multi-agent
**The two multi-agent mechanisms here are different in kind, and the repo is explicit about the difference.**
- **Mixture of Agents** (`hermes_cli/moa_config.py`, `hermes_cli/moa_cmd.py`) — *one* turn, N advisor models give advice, one aggregator acts. The advisors' cost is the minority; the aggregator "runs every tool-loop step, and almost all of the run's cost lands on its provider." The fan-out cadence is the lever: `user_turn` (once per user turn — "the original MoA shape, and the cheapest cadence") vs `per_iteration` (every tool iteration — "advice tracks live task state at the cost of multiplying advisor spend by tool-loop depth") vs `every_n:<N>` (the middle ground, where in-between iterations reuse the cached guidance). Recursion is refused at the config layer.
- **The kanban swarm** (`hermes_cli/kanban_swarm.py`, `hermes_cli/kanban_decompose.py`) — *many* tasks over *many* turns, on a task graph, with a shared blackboard, a **verifier gate** and a synthesizer. The decomposer is explicitly told to "prefer parallelism" and to keep the graph to 2-6 tasks.

**Where the value is:** the MoA fan-out earns its keep when the advisors' *plan-level* advice is what matters and the tool loop is long — running them per iteration multiplies cost by loop depth for diminishing returns, which is why `user_turn` is the default. The swarm earns its keep when the work decomposes into *independent* pieces; the verifier gate is the part that adds value beyond "ask three models" — it can *block with exact missing work*.
**Where it is wasted:** the same MoA advisor invoked every tool iteration; a swarm whose workers are not independent; a decomposer asked to split a task that is genuinely one unit (the `fanout: false` collapse exists for exactly that).

**For August Trading:** a bull/bear/critic panel is MoA-shaped. The transferable decisions are the **fan-out cadence** (advisors once per user turn by default), the **explicit cost attribution** ("the aggregator carries almost all of the cost"), the **recursion refusal**, and the **verifier gate** as a separate role that can block with "exactly what is missing" rather than averaging.

### 3.5 Structured logs the model can query
**Storage.** SQLite only — `state.db` (sessions, messages, `state_meta`, tool calls, FTS-derived tables) plus a per-profile `kanban.db` and a small `projects.db`. `hermes_cli/sqlite_util.py` provides `open_db` / `transaction` / `add_column_if_missing` / `write_txn`; the kanban DB adds WAL checkpoints, corruption detection + quarantine + repair, and additive migrations. The metrics store is a separate small SQLite file with `counter_aggregates` + a `package_outbox`.
**Query surface.** (a) `hermes logs` reads the *bytes* at the tail and truncates to complete lines, with `--since` / level / logger filters and `--follow`. (b) `hermes sessions` browses, searches, exports (JSONL / markdown / trace / flat / HTML), prunes and recovers, with a rich filter language (time bounds, source, title, end_reason, cwd, message count, model, provider, user, chat, branch, token count, cost, tool calls). (c) The dashboard's session routes expose a **timeline**, a **mutation snapshot** and a **latest-descendant** lookup. (d) The metrics store is queryable as a table.
**The trick that keeps it light:** FTS tables are **rebuilt, not copied**, on recovery, and are marked by a version key in `state_meta`; the recovery path copies only canonical rows and *inventories* the runtime tables it deliberately does not copy. A "lost and found" lane exists for the case where even the schema is unreadable.
**For August Trading:** the transferable pieces are (a) the filter language on a session list, (b) the derived-index-is-rebuilt-not-copied rule on any backup/restore, (c) the `state_meta` key-value store used for per-session automation state (`loop:<id>`, `heartbeat:<id>`, `goal:<id>`) — a very cheap place to keep a scheduler's state, and (d) the JSONL audit log with bounded fields.

### 3.6 Staying simple as features accumulate
This shard is 14 MB of Python and ~470 modules, and the *stated* mechanisms for not letting the feature count become the product are:
1. **One command registry** (`COMMAND_REGISTRY`) — every surface derives; an alias is one field.
2. **No `elif` ladder** — dispatch is a table (`_SLASH_DISPATCH`) plus a naming convention, and the rule is stated as "do not add one."
3. **Mixins, not a god class** — `cli.py` holds `HermesCLI`; behaviour lives in ~20 mixins, and topical siblings hold module-level helpers that `cli.py` re-exports. Moved bodies late-bind cli-level names via `from cli import ...` **at call time** "so patch seams on the `cli` facade still intercept them."
4. **One writer per artefact** — config, credentials, plugins, updates.
5. **Three config loaders, named and documented** — so a bug is a loader mix-up, not a mystery.
6. **A support floor for migrations** (v12) and "never clobber a customised value".
7. **A drift lint** — a registered key with no reader, or a reader with no registered key, is caught by a script and an invariant test, because "both drift modes are silent."
8. **A frozen compat surface** for the updater, declared rather than deleted.
9. **A code-health size ratchet** — `config_section_guard.py` is explicitly "Split out of `hermes_cli.config` (code-health size ratchet)"; the same pattern appears across `cli_commands_mixin.py` (split into `cli_commands_session_tools.py`, `cli_commands_worktree.py`), `cli_render.py`, `cli_modal_mixin.py`, `kanban_db.py` (3,737 lines split into `kanban_db_dispatch`, `_graph`, `_context`, `_notify`, `_workspace`, `_boards`), `gateway.py` (4,889 lines split into ~40 siblings), and `main.py` (3,019 lines split into `main_desktop`, `main_dashboard`, `main_provider_setup`, `main_agent_cmds`, `main_tui_launch`, …).
10. **Deliberate scope cuts, stated** — "A second mechanism for the same kind of thing" is called out as a defect; `focus_view.py` is display-only and reuses the *existing* suppression path rather than adding a second; `gateway_automation.py` reuses the local managers' pure methods by rebinding them rather than reimplementing them; `plugin_isolation.py` keeps one table for two consumers.
11. **Feature gates that default to the smaller thing** — `curator.consolidate` off, `sessions.auto_prune` off, `approvals.mode` explicit, `plugins.isolation` explicit.

**For August Trading:** the two cheapest and highest-value are (a) the **one registry, derived per surface** for slash commands / dock actions / settings rows, and (b) the **code-health size ratchet** — splitting a 2,000-line module into topical siblings *and writing down why* in the file's own docstring.

---

## 4. Non-obvious decisions and gotchas

1. **A goal's continuation prompt is a USER message, never a system-prompt mutation.** `hermes_cli/goals.py` (module docstring). If you append to the system prompt you break the prompt cache on every turn. The same rule appears for skill slash commands (`hermes_cli/AGENTS.md`) and for the heartbeat. *A reader would assume an "autonomous loop" needs to change the system prompt. It does not, and it must not.*
2. **The judge sees only the last 4,000 characters of the response** and gets a 4,096-token output budget — the original 200 "reliably truncated it and tripped the auto-pause" for reasoning models (`goals.py` constants).
3. **Judge parse failures and judge transport failures are counted separately** (3 vs 5) and produce *different* auto-pause messages pointing at different config keys (`goals.py` constants).
4. **`BLOCKED` is a refusal, not a completion.** "BLOCKED is a refusal, not a completion — never return BLOCKED for a goal that was achieved" (`goals.py` `JUDGE_SYSTEM_PROMPT`).
5. **`WAIT` must be chosen only when re-poking would be "pure busy-work"** — and it carries one of three wait shapes. A WAIT verdict in the kanban variant is demoted to CONTINUE, because "workers finish via kanban tools, not by parking" (`goals.py` `run_kanban_goal_loop`).
6. **`delivery_failed` means the agent run SUCCEEDED.** `cron.py` `_cron_doctor_issues_for_job`. Reading `last_status` without knowing this sends you debugging the wrong thing.
7. **A late-fire warning clears itself at the next on-time fire** — it is a rolling statement, not a sticky fault (`cron.py`).
8. **`hermes approvals test` composes the runtime evaluators in the runtime's order.** If you reorder the ladder, the dry-run stops predicting the runtime (`approvals_test.py`).
9. **The hardline blocklist fires *before* the yolo/off bypass, and the user deny rules also fire before it.** A "disable all approvals" mode is not a disable-all (`approvals_test.py`).
10. **An approval decision is bound by digest, and every failure is a denial** — including "busy" (the 8-slot semaphore is exhausted) and "stale" (`approval_transport.py` `_validate_decision`).
11. **`approvals suggest` classifies on the RAW command and displays the REDACTED one**, and derives the glob from the raw — because a redacted `***` would become three fnmatch wildcards in a persisted pattern (`approvals_suggest.py` `build_proposals`).
12. **A "replace" of a whole memory entry overwrites everything** — so the approval output prints the full old text, because "the approver is the last person who can notice a clause went missing" (`write_approval_commands.py` `_approve`).
13. **`store_has_active_loop` returns True for an UNPARSEABLE row** and propagates read errors. The docstring says why: "unknown, so the caller keeps its full sweep" (`loops.py`).
14. **A heartbeat that has nothing to say must say so.** The prompt literally says "reply briefly that nothing has changed and stop — do not invent work" (`heartbeat.py` `HEARTBEAT_PROMPT_TEMPLATE`).
15. **The `/loop` completion is a marker line the model writes** (`LOOP_COMPLETE`), matched by a tolerant regex — not a schema field (`loops.py`).
16. **The loop's state manager reuses `goals.py`'s cached SessionDB on purpose** — the previous private copy "froze the loop for the init duration and dropped the first `loop:*` write (the /goal bug class, #88965)" (`loops.py` `_get_session_db`).
17. **`active_sessions` distinguishes three refusals, not two.** "I cannot tell who owns this" ≠ "someone else owns this", and collapsing them "is exactly the fail-open hole that let two writers share one session (#94595 review, blocker 2)" (`active_sessions.py`).
18. **Lease identity is `(pid, live_session_id)`, and liveness is `(pid, process_start_time)`** — a recycled PID is not a live owner (`active_sessions.py` `_is_same_writer`).
19. **Closing ANY file descriptor for a SQLite file drops every POSIX lock the process holds on it** — including a VACUUM's EXCLUSIVE lock. This is why `sqlite_safe_read.py` exists at all (`sqlite_safe_read.py` module docstring).
20. **The untrack must happen *after* `close()` succeeds** — untracking first "would leave the FD open while the byte-probe guard thinks nothing is live" (`sqlite_safe_read.py` `_TrackingMixin.close`).
21. **Recovery never opens the source with SQLite** — the file and its WAL/SHM/journal sidecars are copied to a disposable work dir first, and the result is never installed over the live database (`session_recovery.py` module docstring).
22. **Recovery copies canonical rows and *rebuilds* the derived FTS tables**; the runtime tables are inventoried, not copied, because "copying only part of this ledger could replay already-started effects" (`session_recovery.py` `_RUNTIME_TABLES`).
23. **`hermes config set model <id>` does not overwrite the model section — it redirects to `model.default`** and says how many sub-keys it preserved (`config_section_guard.py`).
24. **Config migrations rewrite a key only while it still equals the OLD default** — a customised value is never clobbered (`config_migrations.py` `_rewrite_stale_default`).
25. **Configs older than v12 are left byte-for-byte untouched** and the process runs on defaults deep-merged at read time (`config_migrations.py` `SUPPORT_FLOOR_VERSION`).
26. **There are THREE config loaders and they are not interchangeable** — `load_cli_config()`, `load_config()`, `load_user_config_effective()`. "If the CLI sees a key and the gateway doesn't (you're on the wrong loader)" (`hermes_cli/AGENTS.md`).
27. **A config that cannot be parsed is refused, not overwritten** — writes fail closed and the user is shown the backups directory (`config_read_errors.py`).
28. **A provider alias must be collapsed BEFORE the fallback chain is deduped**, or the same backend occupies two slots and the "skip the backend that just failed" rule breaks (`fallback_config.py` `_normalize_provider_id`).
29. **A fallback entry's key must be read through the secret scope, not `os.getenv`** — a bare env read "can return another profile's credential" (`fallback_config.py` `resolve_entry_api_key`).
30. **The cost guard never fires on unknown pricing**, and refuses to trust a price whose provider disagrees with the requested one (`model_cost_guard.py`).
31. **A model switch that shrinks the context quotes the real compressor threshold** — obtained from `preview_threshold_tokens`, not a re-derived ratio — and it is suppressed after two ineffective compressions (`context_switch_guard.py`).
32. **`session_prompt_tokens` is a lifetime sum, not occupancy** — using it as a fallback would be a bug (#126343, `context_switch_guard.py` `_estimate_tokens`).
33. **The skills index lives in the VOLATILE prompt tier** — "moved from stable so skill edits don't invalidate the cached identity prefix" (`prompt_size.py` `compute_prompt_breakdown`).
34. **Partial compression defends the seam**: if the head and tail would share a role, the tail's first string is folded onto the head's last message and a non-string content gets a bridging turn — because the head compressor's output shape "isn't contractually guaranteed" (`partial_compress.py` `rejoin_compressed_head_and_tail`).
35. **`--preview` on a compression is a pure function** shared by the CLI and the gateway slash handler, so both report the same numbers (`partial_compress.py` `summarize_compress_preview`).
36. **A queued prompt is re-asked under the SAME `submission_id`** so the owner recognises it and does not queue it twice; a second lost answer becomes `QueueOutcomeUnknown` and the user is told to *check the queue*, not re-send (`gateway_queue.py` `submit_queued`).
37. **A lost RPC reply is not a refusal.** The prepared mutation's CAS tuple is preserved and "never refreshed behind the user" (`gateway_mutations.py` `PreparedMutations.apply`).
38. **`owed_reply` never splices**: it returns the remainder of an exact prefix, or a `[output resumed]` marker plus the whole answer (`gateway_replay_gap.py`).
39. **The replay gap's "re-attach, settle once" rule** means a viewer's snapshot is taken under the event-stream lock, so a turn it still lists publishes its completion on the new subscription and one it no longer lists ended in the hole (`gateway_replay_gap.py` module docstring).
40. **The gateway is the ONLY writer of the session store**; the CLI never writes `state.db` (`gateway_agent.py` module docstring).
41. **The gateway's event contract is frozen** — "wave_a.md (frozen)" (`gateway_agent.py`).
42. **The gateway client's error strings are bounded** before they cross the wire (`gateway_client.py` `_bounded_reason`).
43. **`NOT_SENT` is distinguishable from "lost"** — "never reached a socket: nothing is in doubt" (`gateway_queue.py` `submit_queued`).
44. **The plugin-isolation table is read by both the runtime gate and the static audit**, so "the audit says pool-safe" and "it loads in the host" cannot drift (`plugin_isolation.py`).
45. **MoA refuses to nest** — a slot whose provider is `moa` is rejected at the config layer, and the check is duplicated so the validator and the runtime normaliser cannot disagree (`moa_config.py` `_slot_problem`).
46. **MoA's read path is tolerant and its write path is strict** — "read-time tolerance is a corruption engine at write time" (`moa_config.py` `validate_moa_payload`).
47. **The MoA provider-mismatch notice exists because the aggregator carries the bill** — "the whole tool loop will be billed there, not to `main_provider`" (`moa_cmd.py` `_provider_mismatch_notice`).
48. **The kanban verifier's completion carries `{"gate": "pass"}` in metadata** — a verifier that cannot produce evidence blocks with the exact missing work (`kanban_swarm.py`).
49. **The swarm root's blocked→done flip is inline, in the caller's transaction** — calling the normal `complete_task` would run post-commit side effects "while the outer txn can still roll back" (`kanban_swarm.py` `_activate_root_inline`).
50. **A kanban-owned session must not resume as an ordinary write-capable session** — the resumed process would carry none of the dispatcher's ownership env, so the board could not supervise it and unblocking the card could dispatch a second writer into the same workspace (`kanban_resume_guard.py` module docstring).
51. **The curator treats recency and frequency as different signals** and shows both top-5s; a *view* counts as activity (`curator.py` `_cmd_status`).
52. **The curator reports its own blind spot** — unmanaged skills are never auto-staled or archived, and the report says so and how many there are (`curator.py` `_print_unmanaged_summary`).
53. **The curator's LLM consolidation is off by default**; the default is deterministic prune-only (`curator.py` `_cmd_run`).
54. **The learning-graph's age tint may fade a signal but not a label** — `_ensure_contrast` lifts the foreground toward the readable pole until it clears 4.5:1 (`journey.py`).
55. **A skill approval is bound to the file's mtime**, and a changed script is flagged for re-validation (`hooks.py` `_mtime_drift`).
56. **`hooks test` uses payloads with the runtime shape** so the stdin a script sees is the real one (`hooks.py` `_DEFAULT_PAYLOADS`).
57. **A metrics package's `install_id` is frozen on the first send attempt** so retries are byte-identical, and a `claim_token` makes settlement compare-and-set so a lapsed claimant "loses authority the moment another process reclaims" (`observability/shared_metrics.py`).
58. **Metrics consent is an interval closed at the last CONFIRMED moment, never "now"** (`observability/shared_metrics.py` `_CREATE_CONSENT_TABLES_SQL`).
59. **Every metric is bucketed**, never raw (`observability/shared_metrics_efficiency.py`).
60. **The dashboard never fires a cron job itself** — it forwards to the gateway, and `cron_run_scheduler_owned` says who owns the run (`web_routers/cron.py`).
61. **The dashboard's cron path is containment-checked** against the profile's `scripts/` root, and the literal `"self"` is the one `context_from` reference that cannot be validated at create time (`web_server_cron.py`).
62. **The dashboard avoids `list_profiles()` for the cron list** because "config parsing, gateway probes and skill counts are GIL pressure on large pools" (`web_server_cron.py` `_cron_profile_dicts`).
63. **The auth gate is decided by the LISTENER, not a config flag**, and a loopback desktop listener is exempt (`web_server_boundary.py`).
64. **A WebSocket is checked on three axes** — client, host origin, request — each with its own reason string (`web_server_chat.py`).
65. **The dashboard self-tests in its own middleware** (`_dashboard_selftest_loop`) so a broken dashboard reports itself (`web_server.py`).
66. **A stored transcript is untrusted at the display boundary** — escapes and control characters are stripped so a recap line "can't clear the screen or retitle the window" (`session_recap.py` `_truncate`).
67. **A session recap costs nothing** — "pure local computation: no LLM call, no auxiliary model, no prompt-cache invalidation" (`session_recap.py` module docstring).
68. **`--older-than 90` means 90 DAYS** (a bare number is days), and explicit epoch bounds set `older_than_days = None` so the default 90-day cutoff "would silently cap an `--after`/`--newer-than`-only window" (`session_filters.py`).
69. **The reclaim estimate is weighted by stored bytes, not message count** — "old messages are far smaller than recent ones, and message_count skips the soft-archived rows a prune also deletes" (`prune_advisor.py` `advise`).
70. **The low-disk check is two syscalls**; the expensive measurement only happens after the cheap gate fires (`prune_advisor.py` `should_ask`).
71. **The prune advisor says when pruning will not help** (`prune_advisor.py` `Advice.helps`).
72. **"Later" snoozes the prune prompt for 7 days, and either answer writes the config key, and then the question stops forever** (`prune_advisor.py`).
73. **A forced memory trim still honours a 5-second floor**, because a delegate batch closes N children back-to-back in the same process (`mem_trim.py` `_FORCE_FLOOR_SECONDS`).
74. **The memory-trim config is read without a deepcopy** — "a full-config deepcopy per attempt is exactly the allocator garbage this module exists to release" (`mem_trim.py` `_config_settings`).
75. **`/focus` reuses the existing tool-progress suppression path** — "the SAME value `/verbose off` uses so both features share one suppression path" — and its hidden-line counter mirrors the renderer's visibility predicate exactly (`focus_view.py`).
76. **`hermes config set` on a section prints the sub-keys and the exact dotted command** (`config_section_guard.py`).
77. **A fallback switch is announced by ONE shared sentence** used by the messaging gateway, the TUI/Desktop gateway and cron — "so the three pre-agent fallback paths cannot drift in wording" (`fallback_config.py` `pre_agent_fallback_notice`).
78. **A profile clone strips messaging channels by an ownership-based inventory**, not a hand-written list, and symlinked markers are materialised first "so a clone never writes through to its source" (`hermes_cli/AGENTS.md`, "Profiles" section).
79. **A marker-less profile dir is never served, ticked, or resolvable** — "a live marker-less dir may hold user files — fail closed, never rmtree" (`hermes_cli/AGENTS.md`).
80. **The `updater` is transactional and post-commit failures are OWED follow-ups that exit 0** — a stash left behind exits 1, Ctrl-C exits 130, but a failed post-commit step is a debt, not a failure (`hermes_cli/AGENTS.md`, "Update pipeline").

---

## 5. Weak spots

1. **The module count is extreme and the flatness is real.** ~470 modules in one directory, with `hermes_cli/gateway.py` at 4,889 lines, `kanban_db.py` at 3,737, `config.py` at 3,424, `config_defaults.py` at 3,118, `main.py` at 3,019, `models.py` at 2,493, `plugins.py` at 1,982, `cli_tui_mixin.py` at 2,116, `profiles.py` at 2,124. The splits are *principled* (topical siblings, a facade that re-exports) but the sheer number of files means a reader cannot hold the shape of the system in their head, and the "late-bind through `from cli import ...` at call time so patch seams still intercept" trick (`hermes_cli/AGENTS.md`) is a **monkeypatch-dependent indirection** that is hard to reason about and easy to break.
2. **The comment-to-code ratio is extraordinary, and the comments are frequently changelogs.** Many comments are issue-numbered archaeology ("#131435", "#94595 review, blocker 2", "#100954") rather than design rationale. Valuable as history, but it means the *current* rule is hard to separate from the *sequence* of rules that got there, and a newcomer cannot tell which comment describes today's behaviour. The AGENTS.md is the counterweight, and it is the most valuable single file in the shard.
3. **The updater is a second product.** `hermes_cli/update_*.py` plus `update_cmd_*.py` is ~30 modules and roughly 1 MB — more than most of the interesting code. It has its own lock protocol (`update_lock.py`, 1,352 lines), its own receipt system, its own custody model, its own fleet-restart matrix, three platform backends and a compat surface that cannot be cleaned up. The operational complexity of *updating* the agent now rivals the complexity of *running* it, and a reader looking for "how does Hermes work" must wade through it.
4. **The metric contract's cost is visible in the schema files.** `hermes.shared_metrics.v3.schema.json` is 4,624 lines and v4 is 5,262 — a 13 % growth in a *contract* between one version and the next. A closed contract buys bounded cardinality and drift detection, but the price is a schema that must be regenerated and reviewed on every metric addition, plus a `shared_metrics_drift.py` module whose only job is to make old rows fit the new contract.
5. **Approval is bypassable in practice, deliberately.** `approvals.mode: off` and `--yolo` both bypass everything except the hardline floor and the user deny rules. That is a deliberate product choice (a coding agent that cannot be run unattended is not useful) but it means the *systemic* protections are only the hardline floor, and a user who has turned approvals off has very little between them and a destructive command.
6. **Several subsystems are only *structurally* covered.** The gateway's event contract is "frozen" and its compatibility is maintained by hand-written compat modules and a JSON fixture, and the `hermes_cli/observability/schemas/*.json` files are tens of KB of hand-maintained contract that no test in this shard appears to check. The same is true of the `web_routers/` boundary: `web_deps.py` is a "late-binding dependency seam" and `web_read_coalescing.py` is a "coalesce concurrent synchronous HTTP reads before threadpool admission" — both are workarounds for a synchronous framework (FastAPI/Starlette) that the codebase otherwise leans on heavily.
7. **The "no second scheduler" discipline is a docstring, not an enforcement.** `kanban_swarm.py` says it adds no scheduler and `web_routers/cron.py` forwards rather than fires, but nothing in this shard *prevents* a new module from opening its own ticker. A cheap invariant — "no module may own a `while True` sleep loop outside `cron/`" — would make the rule checkable.
8. **A lot of the shard is about *this machine's* problems, not the agent's.** `update_cmd_windows.py` (1,475 lines), `gateway_windows.py` (1,570), `linux_desktop_entry.py` (785), `macos_tcc_anchor.py` (304), `windows_ssh_runtime.py` (396), `_subprocess_compat.py` (776) — roughly a quarter of the shard is platform plumbing for a product that most users will meet on exactly one platform. That is a defensible engineering choice for a cross-platform agent, but it is a lot of surface for a feature the trader never sees, and it dilutes the signal in the rest of the package.
