# hermes-agent :: hermes-agent-loop

**Files in shard:** 393 (read: 393, skipped with reason: 0)
**What this shard covers:** the runtime core of Hermes — the `agent/` package that holds the
`AIAgent` turn loop, its per-phase siblings (`turn_*.py`), the context/compression stack, the
auxiliary-LLM router, the provider/credential pools, the memory & skill-learning machinery, the
monitoring plane, and the top-level `run_agent.py` facade. It is the reference implementation of a
production-grade multi-provider agent harness in Python, and it is where almost every interesting
*engineering* decision (not just feature) lives.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

The shard is one enormous `source` set, so Tier 1 below covers the files whose behaviour the
report's claims actually rest on. The remaining ~330 files are Tier 2 (compact table) — they were
all opened and read, but they are adapters, registries, or leaf modules whose contract is fully
determined by the core.

---

#### `agent/AGENTS.md`
- **Purpose:** the repo's own map of the `agent/` package — the architecture note a contributor
  reads first.
- **Key abstractions:** none (prose). Names the turn-phase siblings, the `INLINE_TOOL_EXECUTORS`
  interception table, the compression facade, the memory/curator split.
- **Data flow:** none.
- **Non-obvious design decisions:** the invariant list at `agent/AGENTS.md:56` — *"The system prompt
  is byte-stable for the life of a conversation; the ONLY context mutation is compression"*, and
  anything injected mid-conversation must ride a **user message or tool result**, never the system
  prompt. That single rule is what keeps the provider's prompt cache alive, and it is enforced by
  review, not by code.
- **Edge cases & failure handling:** the doc says the invariant is "reviewed against", not
  tested — the enforcement is social.
- **Surprising:** the same doc admits the file is a *prose* contract, so a violated invariant is
  only caught by a human reading the diff.

#### `agent/conversation_loop.py` (1651 L)
- **Purpose:** `run_conversation(agent, ...)` — the single user turn: model call, tool dispatch,
  retry, fallback, compression, post-turn hooks.
- **Key abstractions:** `run_conversation`; phase helpers imported at module scope and *bound at
  import* so a source-tree swap cannot load a skewed phase mid-turn (`:435-454`).
- **Data flow:** messages in → per-iteration request assembly → provider call → response intake →
  tool round (messages mutated in place) → next iteration, or final response.
- **Non-obvious design decisions:**
  - `_ra()` indirection (`agent/conversation_loop.py:399`): symbols callers patch on `run_agent`
    (`handle_function_call`, `_set_interrupt`, `OpenAI`) resolve through `_ra` so the patches keep
    working after the loop was extracted out of `AIAgent`. This is the seam that made a 1651-line
    file extractable at all.
  - `RUN_BUDGET_WRAPUP_NOTICE` is appended to the **newest `role:"tool"` message**, not the system
    prompt, specifically to stay cache-safe (`:469-473`, `:518-524`).
  - `_midturn_request_pressure_tokens` prefers the *native Responses* preflight estimate over the
    generic transcript estimate, because on a compacted session the generic estimate overstates
    the wire by orders of magnitude and would trigger a 600-second local compression the main
    request never needed (`:477-503`).
- **Edge cases & failure handling:** `_review_input_budget_exhausted` only gates forks that carry
  an explicit `_review_input_token_budget`, and it fires at the *top of the next iteration* so the
  budget-crossing request completes first (`:506-515`).
- **Surprising:** the file is 1651 lines despite the repo's own "one phase per ~600-line file"
  advice in `agent/AGENTS.md:39-47` — the doc describes the *target*, the file is the reality.

#### `agent/turn_*.py` (33 sibling files)
- **Purpose:** the turn decomposed into per-phase modules: `turn_preflight`, `turn_iteration_prep`,
  `turn_request_assembly`, `turn_api_call`, `turn_api_error`, `turn_response_intake`,
  `turn_response_check`, `turn_empty_response`, `turn_tool_round`, `turn_tool_validation`,
  `turn_overflow`, `turn_truncation`, `turn_scripted_prelude`, `turn_context_compaction`,
  `turn_recovery`, `turn_recovery_autorecover`, `turn_retry_state`, `turn_stop_gates`,
  `turn_liveness`, `turn_usage`, `turn_final_response`, `turn_finalizer`, `turn_summary`,
  `turn_facade`, `turn_facade_lease`, `turn_failure_copy`, `turn_author`, `turn_context`,
  `turn_api_request`, `turn_explainers`, `turn_loop_errors`, `turn_preflight_gate`.
- **Key abstractions:** each phase is a pure-ish function over `(agent, messages, ...)`.
- **Data flow:** the loop calls them in sequence; each mutates the message list in place and
  returns a verdict.
- **Non-obvious design decisions:** `turn_stop_gates.py` runs **four** gates in a fixed order —
  late-LSP verdicts → verify-on-stop → `pre_verify` plugin hook → kanban terminal-tool guard
  (`agent/turn_stop_gates.py:132-221`). Each gate keeps the candidate answer as
  `pending_verification_response` and **clears `final_response`**, so the finalizer can tell a
  gated stop from an error exit (`:146-157`). Nudges are appended as `role:"user"` rows *after*
  the assistant row, so role alternation holds (`:142-144`).
- **Edge cases & failure handling:** the LSP gate is capped at 3 turn-end notes
  (`_MAX_LSP_TURN_END_NOTES = 3`, `:96`); the kanban guard nudges once or twice, then records a
  `protocol_violation`.
- **Surprising:** `turn_recovery_autorecover.py` is a *post-exhaustion wait-and-retry ladder*
  (jittered 15/30/60/60/60s, `Retry-After` honoured up to 120s) that only engages when the
  provider is **temporarily** away and **no answer text has reached the user yet**. Delivered text
  is never replayed by that path (`agent/turn_recovery_autorecover.py:59-62`).

#### `agent/context_compressor.py` (5117 L) + its 6 mixin siblings
- **Purpose:** automatic context-window compression — a cheap auxiliary model summarises middle
  turns while head and tail are protected.
- **Key abstractions:** `ContextCompressor`; mixins `ProactivePruneMixin` (deterministic tool-result
  prune), `PreLlmSkipMixin`, `SummaryDispatchMixin`, `MicroCompactionMixin`,
  `CompressionTelemetryMixin`.
- **Data flow:** transcript → prune (deterministic, no LLM) → summarise middle → re-assemble with
  head/tail protected → write back under a CAS fence.
- **Non-obvious design decisions:**
  - The prune is a **no-op contract**: it returns the *input object* so callers can gate on
    `result is not input` (`agent/context_compressor_prune.py:72`).
  - Prompt-cache hysteresis: the prune only commits when the reclaim is meaningful, and requires a
    full trigger-sized regrowth before the next cache-breaking rewrite (`:75-81`). A rewrite
    destroys the provider's prefix cache — an expensive thing to do for 200 tokens.
  - `StaleHeldHistory` — if another compaction already committed, the prune leaves the input alone
    rather than publishing beside the winner (`:92-112`).
  - The summary route pin is a **`ContextVar`, not an attribute on the shared compressor**, because
    the aborted worker is detached and still alive on the pool; context is copied per worker
    (`agent/context_compressor.py:317-336`).
- **Edge cases & failure handling:** a stalled summary gets exactly ONE retry against a pinned
  fallback route; the pin is consumed by the *next* call and the main-model retry must NOT re-issue
  it (`:352-358`). A provably unhealthy route degrades once to a deterministic summary instead of
  re-entering the same silent stream (`:360-373`).
- **Surprising:** `retryable_user_text` fails closed for media/unknown content parts — there is no
  replay protocol, so it raises *before* destructive mutation
  (`agent/context_compressor_retry.py:8`).

#### `agent/error_classifier.py` (1334 L)
- **Purpose:** map an API exception to a `ClassifiedError` with recovery hints.
- **Key abstractions:** `FailoverReason` (≈30 members), `ClassifiedError` with
  `retryable` / `should_compress` / `should_rotate_credential` / `should_fallback`.
- **Data flow:** exception → pattern tables → reason + hints → the retry loop consults the hints
  instead of re-matching strings.
- **Non-obvious design decisions:**
  - The taxonomy separates `upstream_rate_limit` from `rate_limit` (aggregator's upstream 429 →
    fallback model, key is healthy) and `upstream_blocked` from `auth_permanent` (a WAF/CDN 403 →
    key is healthy, fallback). Conflating them would rotate a perfectly good credential.
  - `billing_unverified` — Anthropic returns the *same* "out of extra usage" body for a
    content-filter rejection (`agent/error_classifier.py:253-256`). The verdict stays `billing` but
    is marked unverified so surfaces hedge and the pool uses a short cooldown.
  - Provider-scoped codes: xAI's spending-limit arrives as **403, not 402**; other providers'
    billing codes on a 403 stay auth failures (`:259-260`).
  - "terminal billing limit" free text is deliberately NOT matched, because substring rules cannot
    negate the "non-terminal billing limit" wording — the structured code covers it (`:246-251`).
- **Edge cases & failure handling:** `context_overflow` sets `should_compress` rather than
  `should_fallback` — overflow is not a provider problem.
- **Surprising:** `content_policy_blocked` and `data_policy_denied` are *deterministic per-request*
  and must not be retried unchanged (`:186-187`).

#### `agent/deadline.py` (408 L)
- **Purpose:** one bounded-execution primitive and one timeout resolver for the whole harness.
- **Key abstractions:** `resolve_timeout`, `clamp_timeout`, `run_bounded_async`,
  `run_bounded_sync`, `BoundedResult`, `DeadlineExpired`, `kill_process_tree`,
  `SuspectableBackend` protocol.
- **Data flow:** config `timeouts:` → legacy env var → default → clamp → wall-clock bound.
- **Non-obvious design decisions:**
  - The deadline is a **daemon `threading.Timer`**, not an asyncio timer, so a blocked event loop
    cannot disable it; a *second* timer dumps all thread stacks when the loop provably failed to
    process the expiry (`:190-197`, `:222-233`).
  - `MAX_SAFE_TIMEOUT_S` is platform-specific: Windows `WaitForSingleObject` takes a **DWORD
    milliseconds** argument, so anything above ~49.7 days raises `OverflowError` rather than
    waiting (`:44-60`).
  - A timeout here is *Hermes's* deadline, not the provider's — `DeadlineExpired` is classified
    distinctly from a transport timeout (`:13`).
  - `SuspectableBackend` lets a timed-out MCP/browser/LSP client be marked suspect so the owner
    health-checks and recycles it before reuse; `mark_suspect` MUST be non-blocking and must not
    take locks the guarded operation may hold (`:81-87`).
- **Edge cases & failure handling:** `run_bounded_sync` slices the wait to 0.2s so a `/stop` or
  SIGINT is observed promptly (`:65-69`); the worker runs under `contextvars.copy_context()` so
  secret scope and session id survive; on timeout the worker is **abandoned** (leaks one daemon
  thread — do not use per-item in hot loops) (`:305-318`).
- **Surprising:** `resolve_timeout` explicitly rejects `bool` and NaN so a YAML `true` cannot
  become a 1-second deadline and a NaN cannot silently become "unbounded" (`:164-175`).

#### `agent/periodic_scheduler.py` (137 L)
- **Purpose:** ONE process-wide timer thread for all periodic maintenance callbacks.
- **Key abstractions:** `PeriodicScheduler`, `ScheduledHandle`, module-level `schedule()`.
- **Data flow:** `schedule(fn, interval)` → heap of `(due, seq, handle)` → one daemon thread
  pops due handles and starts each body on its own short-lived worker.
- **Non-obvious design decisions:** it replaced per-child `while not stop.wait(interval)` daemon
  threads, which with ~130 in-process subagents meant 2-3 sleeping OS threads per child. Now
  steady-state thread use is near zero (`:484-504`). A **blocked callback cannot delay unrelated
  timers** because each body runs on its own worker. A handle never overlaps itself: it is
  re-queued only once its in-flight run has returned (`:500-503`).
- **Edge cases & failure handling:** a body that returns `False` stops itself; a body that raises
  is logged at debug and rescheduled — one bad callback must never kill the shared thread; a
  worker-start failure re-queues the handle and logs a warning rather than retiring it (`:498-503`,
  `:583-594`).
- **Surprising:** the first call happens `interval` seconds after `schedule()`, and each later call
  `interval` seconds after the previous body *returned* — drift-inclusive by design (`:496-499`).

#### `agent/background_review.py` (1209 L)
- **Purpose:** after every turn, fork the agent on a daemon thread, replay the conversation
  snapshot, and ask "should any skill/memory be saved or updated?".
- **Key abstractions:** `_BackgroundReviewRun` (cancellation + request-completion handshake),
  `prepare_background_review_run`, `finish_background_review_run`, `load_background_review_settings`.
- **Data flow:** turn ends → fork a copy of the agent → replay snapshot → the fork writes to the
  memory + skill stores → the main conversation and its prompt cache are never touched.
- **Non-obvious design decisions:**
  - The fork inherits the parent's **live runtime** (provider, model, credentials, cached system
    prompt) so it hits the same prefix cache — a review that paid full price for a cold cache
    would not be affordable at every turn (`:5-7`).
  - The run token is installed on the parent **before** `Thread.start()` so a successor cannot
    race the predecessor's `request_done` (`:76-91`).
  - `finish_background_review_run` is **ABA-safe**: it publishes the event once and never clears a
    successor's run (`:93-95`, `:56-63`).
- **Edge cases & failure handling:** the review runs under a dispatch-side **tool whitelist** so a
  background judgement can never mutate the world (`:7`); a cancel that arrives before the
  provider-capable phase is admitted is honoured (`:39-45`).
- **Surprising:** the review is *not* a "reflection" that rewrites the system prompt — it writes to
  the skill/memory stores, which are re-read on the next turn. The prompt stays byte-stable.

#### `agent/review_idle_queue.py` (1651→?) — idle deferral for reviews
- **Purpose:** on the managed local runtime the post-turn review fork monopolises the GPU the next
  prompt needs, and the next live turn cancels it — decode cost paid, learning lost.
- **Key abstractions:** `ReviewIdleQueue` (module singleton `QUEUE`), `defer_mode`,
  `defer_max_age_s`, `review_targets_managed_local`.
- **Data flow:** review requested → enqueue (one slot per session) → dispatcher thread waits for
  quiet + idle → dispatch.
- **Non-obvious design decisions:**
  - **Newest snapshot wins** on coalesce — a review replays the whole conversation, so coalescing
    is deduplication, not loss (`:840-849`).
  - Coalescing keeps the **original** enqueue time, so a busy session cannot push its age-out
    forever (`:936-944`).
  - The enabled gate is re-checked at **dispatch** time, not enqueue time — disabling reviews while
    one is queued must stick (`:1013-1020`).
- **Edge cases & failure handling:** items aged past `defer_max_age_s` (default 30 min) dispatch
  **regardless of idleness** — a review that never runs is a silent loss of learning (`:867`,
  `:965-981`).
- **Surprising:** the idle probe calls the local supervisor with `autoload=false` so a *status
  read* cannot load a model that was deliberately unloaded (`:1043-1046`).

#### `agent/curator.py` (1055 L)
- **Purpose:** background skill maintenance — inactivity-triggered state transitions plus an
  optional LLM consolidation fork.
- **Key abstractions:** `should_run_now`, `apply_automatic_transitions`, `maybe_run_curator`,
  `load_state`/`save_state` (`.curator_state`).
- **Data flow:** idle tick → `should_run_now` → deterministic transitions (no LLM) → optional
  forked agent that may pin/archive/consolidate/patch via `skill_manage` → state persisted.
- **Non-obvious design decisions — this is the best "how do you stop bad rules accumulating"
  answer in the reference set:**
  - **Never delete, only archive** (recoverable). Archives live in
    `~/.hermes/skills/.archive/` (`:8`, `:172-174`).
  - **Pinned skills bypass all transitions** (`:8`).
  - **Cron-referenced skills are treated as pinned** — usage only bumps when a job fires, so a
    paused or rare job would age its skill out (`:186-190`).
  - `use_count == 0` is **absence of evidence, not staleness**: a never-used skill is never
    archived before `stale_after_days` (`:249-255`).
  - A first sighting anchors its inactivity clock to **now**, not epoch — a fresh install must not
    mass-archive a library (`:84-88`).
  - The consolidation prompt is an **umbrella-building** prompt: "a collection of hundreds of
    narrow skills where each one captures one session's specific bug is a FAILURE of the library"
    (`:290-305`); the target shape is class-level SKILL.md + a *small* set of topical
    `references/`.
  - The LLM consolidation fork is **opt-in** (`DEFAULT_CONSOLIDATE = False`); the deterministic
    inactivity prune always runs when enabled (`:36`).
  - A **dry-run banner** forbids every mutating action and demands the report say so if one slipped
    (`:266-287`).
- **Edge cases & failure handling:** `should_run_now` seeds `last_run_at` on first observation and
  defers one full interval, so a fresh install never mutates the library on its first tick
  (`:160-181`). A bad `curator.<key>` value below 1 falls back to the default because the automatic
  path runs *unconfirmed* (`:123-135`).
- **Surprising:** the curator archives a skill via a ledger actor tagged `'curator'` so the ledger
  entry reads as an **autonomous transition, not a foreground call** (`:195-207`).

#### `agent/learning_graph.py` (257 L) + `agent/learning_mutations.py`
- **Purpose:** make learning visible — a graph of non-base skills plus `MEMORY.md`/`USER.md` chunks
  as first-class nodes.
- **Key abstractions:** `SkillNode`, `build_skill_nodes`, `memory_fingerprint`, and in
  `learning_mutations.py` the node-id grammar `memory:<source>:<index>:<fingerprint>`.
- **Data flow:** skill dirs + usage ledger + memory files → nodes + edges + clusters + stats.
- **Non-obvious design decisions:** a memory node id carries a **fingerprint of the card's text**,
  so the entry the user clicked is still nameable after the list shifts underneath them
  (`agent/learning_mutations.py:8-11`, `:41-51`). A stale id raises "memory node id is stale —
  refresh the graph" rather than editing the wrong memory (`:71`).
- **Edge cases & failure handling:** deleting a skill *archives* it; deleting a memory rewrites its
  file under the memory tool's lock (`:11-13`). Legacy ids without a fingerprint resolve by
  position.
- **Surprising:** skills mounted from `skills.external_dirs` are tagged so the graph keeps a
  *configured* skill out of *learning* milestones (`:1437-1444` in the structural read) — a mount
  is not a learning event.

#### `agent/tool_guardrails.py` (665 L)
- **Purpose:** pure, side-effect-free tool-call loop guardrails.
- **Key abstractions:** `ToolCallGuardrailController`, `ToolCallSignature`,
  `ToolGuardrailDecision` (`allow | warn | block | halt`), `LoopCapConfig`,
  `ToolCallGuardrailConfig`.
- **Data flow:** per-turn observations → decisions; the *runtime* decides whether a decision becomes
  warning guidance, a synthetic tool result, or a controlled halt (`:2-5`).
- **Non-obvious design decisions:**
  - The controller is **pure** — the guardrail is testable without a runtime, and the escalation
    policy lives in the caller.
  - `STALL_GUARD_IDENTICAL_CALL_THRESHOLD = 3` tolerates one double-check; a **repeat-cycle
    detector** (A,B,A,B,…) defeats the consecutive-streak rule, because every alternation resets
    the streak — a model replaying the same 2-4 call batch each iteration ran to the budget
    unflagged (`:1648-1657`).
  - `FAILURE_TOLERANT_TOOL_NAMES` — for a red test run or an empty grep, `same_tool_failure`
    never halts; only an exact-args replay with no intervening change can.
  - `PROGRESS_RESET_TOOL_NAMES` — a successful call to `write_file`/`patch`/etc. marks progress
    for every failing signature still counted, so the next retry is a *new experiment*, not a replay
    (`:1670-1675`).
  - From the 2nd byte-identical repeat the duplicate payload becomes a **reference stub** (>512
    chars); errors never are (`:1658-1661`).
- **Edge cases & failure handling:** hard stops are opt-in on interactive platforms and **default
  ON for unattended gateway/cron platforms** (`:94`, `:118`).
- **Surprising:** the guardrail config is per-platform — the same loop is a warning for a human
  and a hard stop for a cron job.

#### `agent/terminal_approval_batch.py` (330 L)
- **Purpose:** prepare desktop terminal consent *without running shells ahead of their turn*.
- **Key abstractions:** `_TerminalSlot`, `_CancelledPreparation`, contextvars `_batch` / `_slot`.
- **Data flow:** a batch of terminal calls → each slot runs **only the policy read**
  (`_check_all_guards`) ahead of its turn → the sequential executor releases each worker and
  persists its result before releasing the next.
- **Non-obvious design decisions:**
  - No terminal environment/cwd is acquired while preparing, and the real execution still runs
    every command guard (`:1-6`).
  - The guard key is on **what will actually run**: a foreground `cmd &` executes as `cmd`, so the
    trailing-amp background command is resolved first (`:2336-2340`).
  - Preparation polls `self.release.wait(0.1)` and re-checks cancellation each tick, so a
    cancelled turn never starts a shell (`:2347-2349`).
- **Edge cases & failure handling:** `_CancelledPreparation` distinguishes "cancelled" from
  "started and then failed" — the command was not started (`:2316-2318`).
- **Surprising:** the whole point is to batch the *human* decision while keeping execution
  strictly sequential — a consent UI that runs the command before the user answers would be a
  different product.

#### `agent/subagent_lifecycle.py` (473 L)
- **Purpose:** a public, plugin-safe lifecycle API for delegated subagents — **immutable
  contracts, not `AIAgent` objects**.
- **Key abstractions:** `SubagentLaunchRequest`, `SubagentHandle`, `SubagentStatus`,
  `SubagentTerminalState`, `SubagentCancelResult`, `SubagentResult`, `SubagentState` enum,
  `SubagentLifecycleError`.
- **Data flow:** plugin → launch request → handle → status/result.
- **Non-obvious design decisions:**
  - Hard size caps on every user-controlled string: goal 16 000 chars, context 32 000, metadata
    8 192 bytes, result 32 000 (`:2631-2635`).
  - A **duplicate `correlation_id` for the same parent session is rejected** (`:2895-2896`) —
    idempotency of the caller's key is the ledger's job.
  - Routing precedence is explicit: `request.provider` > delegation config > parent (`:2902-2903`).
  - `PUBLIC_CONTRACT_VERSION = 1` and `SubagentHandle.contract_version` make the wire shape
    versioned.
- **Edge cases & failure handling:** terminal retention is 1 hour, so a finished subagent cannot
  be read forever (`:2635`).
- **Surprising:** plugins get dataclasses, not the agent — the agent's ~60 constructor parameters
  are deliberately not a public API.

#### `agent/review_engine.py` (247 L)
- **Purpose:** the shared `/review` engine — every surface calls this.
- **Key abstractions:** `snapshot_recent_messages`, `collect_parent_loaded_skills`,
  `build_review_task`, `start_review`, `format_dispatch_note`.
- **Data flow:** recent messages → bounded snapshot → reviewer goal + briefing → an independent
  background subagent whose result re-enters the spawning session as a normal async-delegation
  completion.
- **Non-obvious design decisions:**
  - The reviewer is told the parent's **loaded skills are binding**: "the work was produced under
    them and must be judged against them" (`:764-768`).
  - Only whole-skill loads seed the reviewer; a `references/` file read is a detail of the
    parent's task, not a skill to load (`:730-733`).
  - The snapshot is capped at 10 messages and 12 000 chars per message — "generous (a PR
    summary/diff excerpt is exactly what the reviewer needs) but bounded against a pathological
    turn" (`:663-668`).
- **Edge cases & failure handling:** `auxiliary.review` credentials are passed as
  `credentials_cfg` to `delegate_task` so native-SDK providers, api_mode detection and credential
  pools behave identically to a normal delegation pin (`:7-11`).
- **Surprising:** the reviewer is explicitly told to **investigate the artifacts** (open the PR,
  read the diff, run the tests) rather than judge from the excerpt alone (`:670-677`).

#### `agent/managed_worker.py` (473 L)
- **Purpose:** a private exec entry — a worker process the owner drives over a framed pipe.
- **Key abstractions:** `WorkerChannel`, `WorkerControls`, `result_frame`, `accept_result`,
  `validate_bootstrap`, `bind_worker_policy`, `outbox_dir`.
- **Data flow:** owner → bootstrap frame (newline-JSON, ≤4 MB) → worker constructs an agent and
  runs turns → result frame → owner.
- **Non-obvious design decisions:**
  - **No agent/config imports before adopted process authority** — the bootstrap is the first
    import, because in a PM install the interpreter carries no dependencies until `hermes_bootstrap`
    selects the committed environment (`:1-13`).
  - The worker's frozen config is what every config reader in the process returns, so **a profile
    edit after creation cannot reshape a live session** — MCP server definitions included
    (`:1177-1184`).
  - The bootstrap frame is validated with **exact key sets** (`set(frame) - BOOTSTRAP_FIELDS` must be
    empty) and a `pid`/`birth` identity check — the owner, never the worker, decides whether the
    ancestor chain matches (`:1157-1174`, `:1490-1497`).
  - The result frame is a **whitelist of scalar fields**; anything non-scalar is dropped, and
    `billing_block` is the one structured field with its own whitelist (`:1084-1092`).
  - When the owner's control pipe closes, the worker interrupts at once but gives cooperative tools
    `ORPHAN_GRACE_SECONDS = 10` (`:1206-1209`).
- **Edge cases & failure handling:** the owner gets **no raw traceback** — runtime exceptions may
  contain credentials, so the worker logs locally and sends `reason='managed_worker_failed'`
  (`:1513-1517`).
- **Surprising:** `execution_id` is a ledger key containing `:`, which is not a legal Windows path
  character, so the outbox directory uses a portable spelling of the same identity (`:1328-1336`).

#### `agent/turn_stop_gates.py` (223 L) — see Tier 1 entry under `agent/turn_*.py` above.
#### `agent/turn_summary.py` (165 L)
- **Purpose:** per-turn accounting for the CLI — display-only, pure.
- **Key abstractions:** `TurnSummaryCollector`, `TurnTally`, `format_turn_summary`,
  `format_token_flow`, `format_elapsed`.
- **Data flow:** the `tool_progress_callback` feed → `TurnTally` → one dim line:
  `⋯ 12.4s · edited 2 files +18 -3 · read 4 files · ran 3 commands`.
- **Non-obvious design decisions:**
  - **Failed calls are skipped**: "edited 2 files" when one write was denied is exactly the
    over-claim to avoid (`:338-340`).
  - Line deltas are read from the tool's **own diff**, never by shelling out to git
    (`:299-325`).
  - A diff with no +/- content lines yields `None`, not `+0 -0` — "unknown" is honest, "zero" is a
    claim (`:322-325`).
  - A tool-less turn faster than 2.0s renders as `""` — it was a chat reply, not work
    (`:249-250`).
- **Edge cases & failure handling:** unlisted (plugin/MCP) tools fall into a generic "called N
  tools" bucket rather than being dropped (`:341-343`).
- **Surprising:** the collector threads **no agent-loop state** — it rides the public tool-progress
  feed, so the accounting works on any surface that emits it (`:1-6`).

#### `agent/learning_mutations.py` (185 L) — see `agent/learning_graph.py` entry above.
#### `agent/tool_result_classification.py` — shared classification of tool results.
#### `agent/iteration_budget.py` (95 L)
- **Purpose:** a thread-safe per-turn iteration budget.
- **Key abstractions:** `IterationBudget` with `consume`, `refund`, `used`, `remaining`.
- **Non-obvious design decisions:** `refund` exists for `execute_code` turns that need an extra
  iteration (`:528-531`).
- **Surprising:** the loop condition in `agent/AGENTS.md:27-28` is
  `while (api_call_count < max_iterations and iteration_budget.remaining > 0) or self._budget_grace_call`
  — a **one-turn grace call** lets a turn finish after the budget is spent.

#### `agent/error_surface.py`, `agent/api_error_summary.py`, `agent/empty_response_guard.py`
- **Purpose:** the layer that turns a classified error into copy a human can act on.
- **Non-obvious design decisions:** the empty-response guard is on by default with a $0.25 cost
  threshold (`agent/agent_init.py`, `_apply_agent_section`); a malformed config section falls back
  to schema defaults rather than disabling the guard.

#### `agent/auxiliary_client.py` (8392 L) — the auxiliary-LLM router
- **Purpose:** route side tasks (compression, search, vision, summarisation) to a provider chain.
- **Key abstractions:** `call_llm`, `aux_probe_mode`, `aux_interrupt_protection`,
  `AuxiliaryExplicitCancellation`, `_OpenAIProxy`, `CompressionFastLane`.
- **Data flow:** task → chain resolution (main provider+model → OpenRouter → Nous Portal → custom
  endpoint → native Anthropic → direct API-key providers → None) → call → fall through on HTTP 402.
- **Non-obvious design decisions:**
  - `AuxiliaryExplicitCancellation` subclasses **`BaseException`**, so broad `except Exception`
    retry/fallback code never treats a host stop as a transport failure; the cause is immutable
    class data so nothing re-queries a mutable host Event after the transport unwound
    (`:217-221`).
  - The vision chain and the text chain are **different chains** (`:4-10`).
  - `auxiliary.free_only` restricts the OpenRouter lane to `:free` SKUs; Codex OAuth is in
    *neither* chain (undocumented, shifting allow-list) (`:10-11`).
  - `_OpenAIProxy` is a lazy stand-in that preserves `isinstance` checks and
    `patch("...OpenAI")` — the SDK import is deferred so a missing optional dependency never
    breaks import time.
  - The compression fast lane is only certified by an **explicit** reasoning disablement — a
    config that merely *claims* fast-only controls is not trusted (`:6268-6300`).
- **Edge cases & failure handling:** the effective auxiliary timeout has a **floor for
  compression** so a reasoning model summarising a large context is not cut off (`:6357-6366`).

#### `agent/chat_completion_helpers.py` (3582 L) + `agent/chat_completion_nonstream.py` (294 L)
- **Purpose:** the OpenAI-shaped wire path — streaming, non-streaming, tool calls, wait notices.
- **Non-obvious design decisions:** the stream monitor pins *this attempt's* socket and retires the
  watchdog **before** the response hands its connection back to the pool — a timer callback that
  already woke must never shut down a pooled connection a later request has acquired
  (keepalive reuse) (`agent/chat_completion_stream_monitor.py:58-59`).
- **Edge cases & failure handling:** a stream that stalls *after* a `finish_reason` (and usage) is
  in hand is **teardown, not a stall** — the completed response and its billed usage are kept
  (`:161-163` in the structural read).

#### `agent/agent_init.py` (2154 L) + `agent/client_lifecycle.py` (954 L)
- **Purpose:** assemble `AIAgent` — ~60 constructor parameters, credential pool, provider
  resolution, client construction, model switching.
- **Non-obvious design decisions:**
  - `switch_model` snapshots **every** field the swap mutates so a failed rebuild rolls back
    atomically — otherwise a new model name with an OLD client 400s on the next turn
    (`agent/agent_init.py:2135-2151`).
  - `_apply_switched_provider_request_overrides` matches by provider key, base_url **and** model, so
    a different model at the same endpoint never inherits another's `extra_body` (`:2099-2113`).
  - A provider plugin that raises is logged and skipped — "a third-party plugin must not be able to
    take the turn down, it can only fail to provide a client" (`:1893-1924`).

#### `agent/credential_pool.py` (2776 L) + `agent/credential_sources.py` (294 L)
- **Purpose:** the credential pool, and the unified **removal** contract for every credential
  source.
- **Non-obvious design decisions:** `auth.adopt_external_logins` — Codex and Claude OAuth refresh
  tokens are **single-use and rotate**, so once Hermes borrows a CLI's token pair the two programs
  hold one token family and whichever refreshes first logs the other out
  (`agent/credential_sources.py:43-52`).
- **Edge cases & failure handling:** each source registers a `RemovalStep` whose `remove_fn`
  cleans the external state, and the dispatcher suppresses `(provider, source_id)` in `auth.json`
  so the seeding branch skips the upsert — otherwise the entry comes back on the next
  `load_pool()` (`:39-47`).

#### `agent/memory_manager.py` (1055 L) + `agent/memory_provider.py` + `agent/memory_context.py`
- **Purpose:** fan the agent's memory hooks out to registered providers.
- **Non-obvious design decisions:** the builtin provider is always allowed; only **ONE** external
  plugin provider may be registered at a time — tool-schema bloat and conflicting backends
  (`agent/memory_manager.py:1-6`).

#### `agent/agent_runtime_helpers.py` (3490 L) + 2 siblings
- **Purpose:** the runtime helpers mixed into `AIAgent` — client rebuild, switch, tool invoke,
  tool-name repair.
- **Non-obvious design decisions:** `repair_tool_call` normalises case, separators, CamelCase and
  strips a `_tool` suffix **twice** so `TodoTool_tool` reduces correctly.

#### `agent/moa_loop.py` (1550 L) — Mixture-of-Agents
- **Purpose:** gather reference-model context before each model iteration of a `/moa` turn; the
  normal agent loop still owns tool calling and turn termination.
- **Non-obvious design decisions:**
  - **References deliberately do NOT inherit the global reasoning effort** — inheriting a global
    `xhigh` into every advisor would multiply cost (`:233-248`).
  - The aggregator's reasoning config is `slot > per-model > global` — a shared chokepoint.
  - Each reference is priced at **its own** rate and summed in dollars, because advisors may run a
    different model than the aggregator (`:158-217`).
  - The privacy filter is its own opt-in, independent of the global log-redaction toggle, and
    `force=True` (`:58-71`).
  - A reference's liveness is bridged to the agent's activity clock through a thread-local hook,
    because the fan-out runs in worker threads outside the main loop (`:304-330`).
- **Edge cases & failure handling:** the accounting slot is never redacted; only the advisor text
  is (`:80-83`).

#### `agent/turn_facade_lease.py` — the durable turn lease
- **Purpose:** make a turn exclusive across processes against a SQLite row.
- **Non-obvious design decisions:**
  - A session id **without a row still takes the lease** — client-addressed ids are not
    process-unique, and the first turn creates the row mid-turn, so a second writer would
    otherwise interleave its turn into this one (`:316-320`).
  - The whole renewal must finish **before** the authority runs out; a renewal still waiting on
    the write lock past expiry keeps this turn running while a successor reclaims the row
    (`:216-219`).
  - A locked / non-WAL read proves neither presence nor absence — `get_session` returns `None`
    rather than raising (`:288-291`).
  - The committed expiry is taken **before** acquisition so it is never later than the real expiry
    (`:268-282`).
- **Edge cases & failure handling:** `carry_unadmitted_user_message` preserves the user's message
  when the lease is not acquired, so a turn is not silently lost.

#### `agent/monitoring/` (9 files)
- **Purpose:** a **content-free** observability plane — service health plus redacted diagnostics.
- **Key abstractions:** `GatewayHealthEvent`, `GatewayDiagnosticEvent`, `CronExecutionEvent`,
  `MonitoringEmitter`, `GatewayHealthSnapshot`.
- **Non-obvious design decisions:**
  - The plane emits **no prompts, messages, tool args/results, session history, or usage
    analytics** — "the only shapes the monitoring plane emits" (`agent/monitoring/events.py:1-10`).
  - Field order is **wire order** (`asdict`); never reorder (`:10-11`).
  - Collection is **opt-in**: disabled until a plane exporter attaches its first subscriber
    (`agent/monitoring/emitter.py:147`).
  - `classify_exit_reason` reduces free-form shutdown text to a bounded operational class, and
    `_safe_instance_id` returns a stable opaque key **without exporting the source id**
    (`agent/monitoring/gateway_health.py:72-108`).
  - The emitter drops oldest to make room — bounded memory, newest-wins.
- **Edge cases & failure handling:** the bounded queue drops the oldest batch under pressure, so a
  stall in the exporter cannot grow the process.

#### `agent/insights.py` — the session insights engine
- **Purpose:** aggregate the SQLite state DB into usage insights (tokens, cost, tool/skill usage).
- **Non-obvious design decisions:** the source filter also matches the gateway's `local` rows, so
  `--source cli` still finds the classic CLI's sessions (`:80-85`).

#### `agent/verification_evidence.py` (24 969 B) + `agent/verification_stop.py` (9369 B) + `agent/verify/*`
- **Purpose:** the verify-on-stop loop — after a turn that edited code, require proof the change
  works before the agent is allowed to finish.
- **Key abstractions:** `build_verify_on_stop_nudge`, `verify_on_stop_enabled`, `Recipe`,
  `Environment` manifest, the smoke-test runner.
- **Non-obvious design decisions:**
  - The nudge is **suppressed for prose-only turns** (markdown, skills, README, LICENSE) — "a
    SKILL.md/README edit must never demand a /tmp verification script" (`agent/verification_stop.py:18-20`).
  - The verify manifest at `<project>/.hermes/environment.json` is the **user-editable source of
    truth**; when present and valid it wins over fresh static detection
    (`agent/verify/environment.py:3-6`).
  - A corrupt manifest degrades to fresh detection rather than failing (`:23-24`).
- **Edge cases & failure handling:** the recipe loader accepts both Hermes field names and grok's
  camelCase aliases — a tolerant loader, not a strict one (`agent/verify/recipes.py:50-51`).

#### `agent/lsp/` (13 files)
- **Purpose:** an async LSP client, one per `(server, workspace_root)`.
- **Non-obvious design decisions:**
  - Freshness is tracked with **document versions, not timestamps** — a slow server's leftovers must
    never masquerade as a verdict on the current content ("ghost diagnostics")
    (`agent/lsp/client.py:1-10`).
  - Whole-document sync is always sent, and every `open_file` also fires
    `didChangeWatchedFiles` (clangd/eslint only re-scan on it) (`:9-11`).
  - `ContentModified` (-32801) is retried with exponential backoff (`:11-12`).
  - One process serves **every project root** as extra `workspaceFolders` instead of one process
    per root (`:75-77`).

#### `agent/redact.py` (71 KB), `agent/secret_scope.py`, `agent/secret_sources/*`, `agent/vault_backends/*`
- **Purpose:** secrets in and out.
- **Non-obvious design decisions:**
  - Secret sources have a **precedence** (mapped beats bulk; within a shape, `secrets.sources` order
    else registration order; first claim wins) and `override_existing` may beat `.env`/shell but
    **never another source and never a protected var** (`agent/secret_sources/registry.py:1-12`).
  - `enabled_source_names` — "a source missing here was removed or disabled, so a value it injected
    earlier is no longer backed by anything and must be **revoked**, not kept as process residue"
    (`:290-297`).
  - Vault logins: `bw unlock --raw --passwordenv VAR` — the variable exists only in the child's
    environment, never in argv or ours (`agent/vault_backends/bitwarden.py:59-61`).

#### `agent/reasoning_effort.py`, `agent/reasoning_params.py`, `agent/reasoning_promotion.py`, `agent/reasoning_summaries.py`, `agent/reasoning_timeouts.py`, `agent/reasoning_carriers.py`
- **Purpose:** the thinking-tier ladder and its carriers.
- **Non-obvious design decisions:** the tier a turn ran under is resolved **once** and rides out on
  the outcome — the same discipline August Trading already enforces via
  `types/provider.ts` / `resolveComposerEffort`.

#### `agent/prompt_caching.py`, `agent/prompt_cache_boundary.py`, `agent/prompt_cache_scope.py`
- **Purpose:** the prompt-cache plan and the scope identity that keys it.
- **Non-obvious design decisions:** the cache scope is keyed on the full resolved identity
  `(platform, home, project)`; the previous single-slot memo missed on every poll in a desktop
  serve process whose identity flaps across requests, rescanning the whole skills dir ~3×/5s
  (`agent/skill_commands.py:18-31`).

#### `agent/skill_commands.py` (52 KB), `agent/skill_utils.py` (39 KB), `agent/skill_bundles.py`, `agent/skills_index_delta.py`, `agent/skill_preprocessing.py`
- **Purpose:** slash-command skills, auto-load, preloading, and the index delta.
- **Non-obvious design decisions:** a `/skill` turn is expanded into a model-facing message embedding
  the full skill body; memory providers storing the raw user turn would capture the body instead
  of what the user asked, so `extract_user_instruction_from_skill_message` recovers just the
  instruction (`agent/skill_commands.py:43-46`).
- **Edge cases & failure handling:** the skill-name regex keeps Unicode letters so a skill named
  `小说拆条` registers as `/小说拆条` instead of slugging to "" and being dropped (`:37-38`).

---

### Tier 2 — bulk: a compact table, one row per file

Every remaining file in the shard. Read in batches; the "what it pins" column says what the file
actually does.

| File | What it is / what it pins |
| --- | --- |
| `agent/__init__.py` | Package marker; eagerly imports `jiter_preload` so the tokenizer lib is warm before the first request. |
| `agent/account_usage.py` | Provider quota/credit snapshots → renderable `/usage` lines. Fails open to `[]`. |
| `agent/account_usage_cache.py` | TTL cache for usage snapshots: reuse within 120s; a snapshot older than 15 min renders as `unknown`, not a confident gauge. |
| `agent/acp_openai_bridge.py` | Bridges the ACP (agent-client-protocol) transport to the OpenAI-shaped wire. |
| `agent/activity_tracking.py` | The activity clock: `(generation, timestamp)` observations used by the liveness watchdog. |
| `agent/agent_init_fallback.py` | Fallback wiring used when the primary provider init fails. |
| `agent/agent_init_ollama.py` | Ollama/local-runtime init branch. |
| `agent/agent_init_params.py` | The parameter-shape shim between `AIAgent.__init__` and `init_agent`. |
| `agent/agent_runtime_helpers_dead_connections.py` | Detects and drops dead provider connections. |
| `agent/agent_runtime_helpers_placeholders.py` | The `hidden_interrupt_placeholder_row` scaffold row used to keep role alternation after an interrupt. |
| `agent/anthropic_adapter.py` | Anthropic-native wire adapter (messages API, thinking blocks). |
| `agent/anthropic_credentials.py` | Anthropic credential resolution: API key, OAuth, refresh, and the "invalidate on 401" rule. |
| `agent/anthropic_endpoints.py` | Anthropic endpoint shapes and their beta headers. |
| `agent/anthropic_message_convert.py` | Converts Hermes messages → Anthropic wire, including image eviction. |
| `agent/anthropic_thinking_policy.py` | When a thinking block is allowed to be sent back to Anthropic. |
| `agent/anthropic_thinking_replay.py` | Replay of thinking blocks with their signatures; strips stale signatures. |
| `agent/api_error_summary.py` | Renders a classified API error as a short operator-facing summary. |
| `agent/api_request_hooks.py` | Pre/post request hook points for provider calls. |
| `agent/async_utils.py` | Small async helpers (gather with per-task outcome capture). |
| `agent/aux_accounting.py` | Per-task auxiliary token/cost accounting. |
| `agent/auxiliary_async_rebuild.py` | Rebuilds a cached async client whose event loop died. |
| `agent/auxiliary_call_outcome.py` | The outcome record of one auxiliary LLM call. |
| `agent/auxiliary_client_registry.py` | Registry of auxiliary clients keyed by route. |
| `agent/auxiliary_codex_response.py` | Normalises a Codex Responses payload into the common shape. |
| `agent/auxiliary_fallback_recovery.py` | Rebuilds the client after a fallback aborts mid-flight. |
| `agent/auxiliary_health.py` | Health probe for the auxiliary route. |
| `agent/auxiliary_hooks.py` | Hook points around auxiliary calls (pre/post, usage capture). |
| `agent/auxiliary_key_rotation.py` | Rotates the auxiliary key on a 401. |
| `agent/auxiliary_local_runtime.py` | Detects the managed local (llama-server) runtime endpoint. |
| `agent/auxiliary_managed_local.py` | Managed-local endpoint identity + netloc matching. |
| `agent/auxiliary_plugin_oauth.py` | OAuth for plugin-provided auxiliary providers. |
| `agent/auxiliary_reasoning_floor.py` | Enforces a minimum reasoning depth on auxiliary calls that need it. |
| `agent/auxiliary_stream_watchdog.py` | The no-progress watchdog on auxiliary streams. |
| `agent/auxiliary_structured_output.py` | Forces a JSON/schema-shaped answer out of an auxiliary call. |
| `agent/auxiliary_task_config.py` | Per-task auxiliary config resolution (`auxiliary.<task>.*`). |
| `agent/auxiliary_unavailable.py` | The "no auxiliary provider available" path and its user-facing copy. |
| `agent/auxiliary_wire.py` | The shared auxiliary wire-format helpers. |
| `agent/azure_identity_adapter.py` | Entra ID / Azure AI Foundry identity. |
| `agent/backend_identity.py` | Identity of the backend behind a route. |
| `agent/battery.py` | Small power/battery-state probe used by environment prompts. |
| `agent/bedrock_adapter.py` | AWS Bedrock wire adapter, including the Converse API. |
| `agent/billing_links.py` | `BillingBlock` — the one structured billing field on a result. |
| `agent/billing_usage.py` | Per-provider billing usage accumulation. |
| `agent/billing_view.py` | Renders the billing block for the UI. |
| `agent/bounded_response.py` | Caps a response's size at the reader. |
| `agent/browser_provider.py` | ABC for cloud browser backends; `is_available` must be cheap and must not make network calls. |
| `agent/browser_registry.py` | Active cloud-browser resolution: config wins *regardless of availability* so the user gets a typed "X_API_KEY is not set" instead of a silent switch. |
| `agent/chat_completion_helpers_relay.py` | Relay-specific glue for the OpenAI-shaped helpers. |
| `agent/chat_completion_helpers_tool_calls.py` | Tool-call assembly for the OpenAI-shaped path. |
| `agent/chat_completion_local.py` | Local (llama-server) branch of the OpenAI-shaped path. |
| `agent/chat_completion_stream_monitor.py` | Stream monitor: pins the socket, retires the watchdog before the pool can reuse the connection. |
| `agent/chat_completion_wait_notice.py` | The "still waiting" notice emitted on a slow first token. |
| `agent/codex_headers.py` | The header set the Codex backend requires. |
| `agent/codex_responses_adapter.py` | Codex Responses wire adapter; the native-preflight token estimate lives here. |
| `agent/codex_runtime.py` | The Codex runtime session: history seed, replay, service tier. |
| `agent/codex_runtime_history_seed.py` | Seeds a Codex session's history on first use. |
| `agent/codex_service_tiers.py` | Maps a named service tier to a wire parameter. |
| `agent/coding_context.py` | Cheap, byte-stable project facts for the prompt — never runtime detection. |
| `agent/command_token_source.py` | Resolves the token source for a shell-command route. |
| `agent/compaction_display.py` | Renders the compaction notice to the user. |
| `agent/compaction_events.py` | Emits the compaction lifecycle events. |
| `agent/compression_automation.py` | The switch that enables automatic hygiene compression. |
| `agent/compression_facade.py` | The public compression entry point the loop calls. |
| `agent/compression_marker.py` | The elision markers written into a compacted transcript. |
| `agent/context_breakdown.py` | Token breakdown of the prompt by section — the prompt-size discipline tool. |
| `agent/context_compressor_prellm.py` | The "skip compression before the LLM" pre-check mixin. |
| `agent/context_compressor_tail.py` | Tail-budget management: demote stale tail tools, detect demoted stubs. |
| `agent/context_compressor_telemetry.py` | Compression metrics (tokens before/after, cache breaks). |
| `agent/context_engine.py` | The context engine: what memory/context block is assembled for the prompt. |
| `agent/context_file_sources.py` | The files (AGENTS.md etc.) discovered and injected as context. |
| `agent/context_pin.py` | Pins context items that must survive compaction. |
| `agent/context_references.py` | Reference resolution for context items. |
| `agent/conversation_compression_archive.py` | Archives the pre-compaction transcript. |
| `agent/conversation_compression_checkpoint.py` | The checkpoint written around a compaction. |
| `agent/conversation_compression_codex.py` | The Codex-specific compaction path. |
| `agent/conversation_compression_deadline.py` | The wall-clock deadline on a compaction. |
| `agent/conversation_compression_manual.py` | Manual (user-triggered) compaction. |
| `agent/conversation_compression_reply_anchor.py` | Keeps the assistant's last reply anchored across a compaction. |
| `agent/conversation_compression_telemetry.py` | Compaction telemetry events. |
| `agent/conversation_compression_watermark.py` | The watermark that says how much history is durable. |
| `agent/copilot_acp_client.py` | The Copilot ACP client. |
| `agent/credential_persistence.py` | Persists credential state safely (atomic write). |
| `agent/credential_pool_admin.py` | Admin commands over the credential pool. |
| `agent/credential_pool_model_cooldowns.py` | Per-model cooldowns in the pool. |
| `agent/credential_pool_plugin.py` | Plugin-provided credentials. |
| `agent/credential_pool_timestamps.py` | Parses epoch seconds / epoch ms / ISO-8601 into epoch seconds. |
| `agent/credential_source.py` | Names a callable API key's source *without calling it* (display paths must not mint a token to mask it). |
| `agent/credits_tracker.py` | Tracks remaining provider credits. |
| `agent/curator_backup.py` | Backs up the skill library before a curator mutation pass. |
| `agent/custom_entry_pool.py` | Pool of custom provider entries. |
| `agent/delegation_context.py` | The context handed to a delegated child. |
| `agent/display.py` | CLI rendering of the turn: status lines, tool progress, failure detection. |
| `agent/estop.py` | The emergency-stop switch. |
| `agent/fallback_cooldown.py` | Cooldown bookkeeping for fallback providers. |
| `agent/fast_mode.py` | The fast-mode turn wrapper. |
| `agent/file_safety.py` | Classifies file writes/deletes for safety. |
| `agent/gemini_long_decode.py` | Handles Gemini's long-encoded responses. |
| `agent/gemini_native_adapter.py` | Gemini native wire adapter. |
| `agent/gemini_schema.py` | The Gemini response schema shape. |
| `agent/history_commentary.py` | The commentary rows between a turn's steps. |
| `agent/i18n.py` | The translation lookup (`t`). |
| `agent/i18n_languages.py` | The language table. |
| `agent/i18n_layers.py` | Layered translation (base + overlay) resolution. |
| `agent/image_eviction_policy.py` | One shared image-eviction policy for both outbound passes. The trigger is a **provider limit, not a keep-newest count** — retiring an image edits a message the provider already cached, and Anthropic matches its cache on an exact byte prefix, so a keep-newest-N window is a full-prefix miss every turn. |
| `agent/image_gen_provider.py` | ABC for image-generation backends. |
| `agent/image_gen_registry.py` | Active image-generation provider resolution. |
| `agent/image_replay.py` | Replays an image into a later turn. |
| `agent/image_routing.py` | Routes attachments to native content parts or to a transport. |
| `agent/image_token_cost.py` | Estimates the token cost of an image part. |
| `agent/inline_tool_executors.py` | The `INLINE_TOOL_EXECUTORS` table — agent-level tools intercepted before `handle_function_call`. |
| `agent/interrupt_compat.py` | The one hard-interrupt entry point. |
| `agent/interrupt_control.py` | Interrupt bookkeeping. |
| `agent/interrupt_scope.py` | Scopes an interrupt to a thread/task. |
| `agent/jiter_preload.py` | Preloads the `jiter` tokenizer. |
| `agent/kanban_stop.py` | The kanban worker's terminal-tool guard. |
| `agent/kanban_turn_recovery.py` | Recovers a failed kanban turn: "no proof, no retry" — a fail-closed nudge rather than a blind re-run. |
| `agent/lazy_forward.py` | Lazy attribute forwarding. |
| `agent/learn_prompt.py` | The prompt used to decide what is worth remembering. |
| `agent/learning_graph_render.py` | Renders the learning graph for the desktop. |
| `agent/legacy_cli.py` | The legacy CLI entry points. |
| `agent/lmstudio_reasoning.py` | LM Studio's reasoning parameter shape. |
| `agent/local_prompt_progress.py` | Progress reporting for the local runtime. |
| `agent/lsp/__init__.py` | LSP package marker. |
| `agent/lsp/cli.py` | The `hermes lsp` CLI. |
| `agent/lsp/deferred.py` | Defers LSP diagnostics that arrive after the tool result. |
| `agent/lsp/edit_check.py` | Checks an edit against the server's diagnostics. |
| `agent/lsp/eventlog.py` | The LSP event log. |
| `agent/lsp/install.py` | Installs/configures an LSP server. |
| `agent/lsp/manager.py` | Owns the per-(server, root) client registry. |
| `agent/lsp/protocol.py` | The JSON-RPC message shapes. |
| `agent/lsp/range_shift.py` | Shifts LSP ranges across an edit. |
| `agent/lsp/reporter.py` | Renders LSP problems for the model. |
| `agent/lsp/servers.py` | The built-in server table + user-declared servers. |
| `agent/lsp/sync_diagnostics.py` | Synchronous diagnostic pull. |
| `agent/lsp/workspace.py` | Workspace-root discovery and trust. |
| `agent/manual_compression_feedback.py` | Lets a user say "compress more/less". |
| `agent/markdown_tables.py` | Markdown table helpers. |
| `agent/memory_caller_scope.py` | Bounds a memory read to the caller's scope; refuses out-of-scope reads. |
| `agent/memory_context.py` | Builds and sanitizes the memory context block. |
| `agent/memory_manager_tools.py` | Injects the memory-provider tools into the tool list. |
| `agent/message_content.py` | The message content shape (string vs content parts). |
| `agent/message_metadata.py` | `append_message` and `without_persistence_fields` — the one place a message is added to a transcript. |
| `agent/message_sanitization.py` | Repairs malformed tool-call arguments and sanitises surrogates. |
| `agent/micro_compaction.py` | The cheap, in-turn micro-compaction. |
| `agent/moa_alternation.py` | The MoA advisor alternation order. |
| `agent/moa_trace.py` | Persists the redacted MoA trace. |
| `agent/model_metadata.py` | Model metadata, context lengths, and token estimation. |
| `agent/model_metadata_cache.py` | The context-length cache: atomic write (a truncating write killed mid-dump would wipe EVERY cached length), cross-process lock, stale-row drop. |
| `agent/model_metadata_http.py` | HTTP probes for model metadata. |
| `agent/model_metadata_llamacpp.py` | llama.cpp runtime `n_ctx` probes; `autoload=false` so a probe cannot undo an Eject. |
| `agent/model_metadata_token_memo.py` | Releases a closed conversation's entries from the per-message token-estimate memo (the memo pins every string it fingerprints). |
| `agent/models_dev.py` | The models.dev registry: in-memory cache → disk cache → network only when no cache exists; ETag conditional GET; failed refreshes back off 5 min. |
| `agent/monitoring/__init__.py` | Monitoring package marker. |
| `agent/monitoring/cron_health.py` | Health of the durable cron runner. |
| `agent/monitoring/emitter.py` | The bounded, opt-in monitoring emitter. |
| `agent/monitoring/gateway_health_export.py` | Exports the health snapshot. |
| `agent/monitoring/otlp_exporter.py` | The OTLP exporter that attaches the plane. |
| `agent/monitoring/policy.py` | What the monitoring plane is allowed to emit. |
| `agent/monitoring/redaction.py` | Redaction applied before export. |
| `agent/moonshot_schema.py` | Moonshot's response schema. |
| `agent/native_compaction.py` | The provider-native compaction path. |
| `agent/notification_presentation.py` | Presents a notification to the user. |
| `agent/nous_rate_guard.py` | Rate guard for the Nous gateway. |
| `agent/nous_wire.py` | The Nous gateway wire format. |
| `agent/onboarding.py` | The onboarding entry point. |
| `agent/onboarding_facts.py` | The safe facts onboarding collects. |
| `agent/onboarding_first_tasks.py` | The first-task suggestions. |
| `agent/onboarding_flow.py` | First-run onboarding **as data**: `apply(record, event, facts, now=…)` is pure — no I/O, no clock. |
| `agent/onboarding_record.py` | Stores the onboarding record. |
| `agent/onboarding_text.py` | Renders the onboarding reminders. |
| `agent/oneshot.py` | The one-shot (non-interactive) turn. |
| `agent/oneshot_footprint.py` | The token/cost footprint of a one-shot run. |
| `agent/opencode_affinity.py` | Interop with the opencode runtime. |
| `agent/outbound_webhooks.py` | Outbound webhook delivery. |
| `agent/persisted_turn_receipt.py` | The durable turn receipt — outcome, exit reason, tokens, cost, model. |
| `agent/pet/__init__.py` | Pet package marker. |
| `agent/pet/constants.py` | Pet constants. |
| `agent/pet/generate/__init__.py` | Pet-generation package marker. |
| `agent/pet/generate/atlas.py` | The Atlas sprite generator. |
| `agent/pet/generate/imagegen.py` | The image-generation backend for pets. |
| `agent/pet/generate/orchestrate.py` | Orchestrates pet generation. |
| `agent/pet/generate/prompts.py` | The pet prompts — vary the *look*, not the pose, so the base grounds consistent rows. |
| `agent/pet/manifest.py` | Fetches the public petdex manifest. |
| `agent/pet/render.py` | Renders the pet. |
| `agent/pet/state.py` | Pet state. |
| `agent/pet/store.py` | Pet storage. |
| `agent/plan_prompt.py` | The plan-mode prompt. |
| `agent/plugin_live_notes.py` | Live notes from plugins. |
| `agent/plugin_llm.py` | A plugin-provided LLM route. |
| `agent/plugin_stream_hooks.py` | Stream hooks plugins can install. |
| `agent/portal_tags.py` | Portal tag handling. |
| `agent/primary_runtime_snapshot.py` | The `_primary_runtime` snapshot: the route a fallback turn restores next turn, resolved against a *recorded* record so a mid-session config edit can't hand the session another account's key. |
| `agent/process_bootstrap.py` | Lazy OpenAI import, crash-resistant stdio, env-only proxy, Happy Eyeballs. |
| `agent/prompt_builder.py` | Assembles the system prompt. |
| `agent/provider_base.py` | The provider ABC. |
| `agent/provider_media.py` | Provider media handling. |
| `agent/provider_projection.py` | Projects provider capabilities. |
| `agent/provider_registry.py` | The provider catalog. |
| `agent/proxy_bypass.py` | Proxy bypass rules. |
| `agent/proxy_sources/__init__.py` | Proxy-source package marker. |
| `agent/proxy_sources/iron_proxy.py` | The Iron proxy source. |
| `agent/rate_limit_credits.py` | Credit-based rate limits. |
| `agent/rate_limit_tracker.py` | Tracks per-route rate limits. |
| `agent/reactions.py` | User reactions to a turn. |
| `agent/relay_compaction.py` | Compaction for the Relay transport. |
| `agent/relay_cwd.py` | The cwd for a Relay route. |
| `agent/relay_llm.py` | The NeMo Relay adapters (sync/async/streaming over one managed attempt). |
| `agent/relay_runtime.py` | Relay session context and the managed-callback guard. |
| `agent/relay_tools.py` | Relay tool-call bridging. |
| `agent/repetition_guard.py` | Detects a runaway repetition loop. |
| `agent/replay_cleanup.py` | Cleans up replay state. |
| `agent/retry_utils.py` | Retry helpers (backoff, jitter). |
| `agent/route_binding.py` | Binds a route to a provider/model/credential. |
| `agent/runtime_cwd.py` | The single source of truth for the agent's working directory; the package root itself is excluded so a self-spawned desktop backend cannot inject the repo's contributor AGENTS.md as project context. |
| `agent/runtime_self_protection.py` | The running runtime's own interpreter is not agent-deletable — deleting it bricks the install and no agent work can repair it. |
| `agent/runtime_session_child.py` | The owner-side reservation of a delegated child. |
| `agent/runtime_session_compression.py` | Compaction for a runtime session. |
| `agent/runtime_session_lifecycle.py` | The runtime session's lifecycle. |
| `agent/runtime_session_store.py` | The session store used by the managed worker. |
| `agent/safe_worker_policy.py` | The frozen safe / ignore-user-config policy. |
| `agent/sdk_transform_bypass.py` | Bypasses an SDK's own request transform where Hermes must control the wire. |
| `agent/search_policy.py` | The web-search policy (allow/deny, provider choice). |
| `agent/served_model.py` | The model actually served (vs the model requested). |
| `agent/session_activity.py` | Per-session activity tracking. |
| `agent/session_client_env.py` | The client environment for a session. |
| `agent/session_persistence.py` | Persists the transcript and the session row. |
| `agent/session_source.py` | The surface a session came from. |
| `agent/shell_hooks.py` | Shell-level hooks (pre/post command). |
| `agent/side_question.py` | The side-question path — a question answered out of band. |
| `agent/skill_bundles.py` | Groups skills into bundles. |
| `agent/stream_delivery.py` | Delivers the stream to the surface. |
| `agent/stream_diag.py` | Stream diagnostics. |
| `agent/stream_single_writer.py` | Enforces a single writer per stream. |
| `agent/subdirectory_hints.py` | Hints from subdirectories. |
| `agent/subscription_view.py` | The subscription view. |
| `agent/surface_switch.py` | Identity/runtime lines shown when the surface switches. |
| `agent/system_prompt.py` | The system prompt's own assembly and the tool-use / execution-guidance gates. |
| `agent/terminal_env_provider.py` | ABC for pluggable terminal execution backends; `is_available` must make no network calls (it runs on every UI paint). |
| `agent/terminal_env_registry.py` | Terminal backend registry; built-in names are reserved so a plugin can never shadow them. |
| `agent/think_scrubber.py` | Scrubs thinking text for display. |
| `agent/thinking_timeout_guidance.py` | Guidance shown when thinking times out. |
| `agent/thread_scoped_output.py` | Silences output in a specific thread. |
| `agent/title_generator.py` | Generates a session title (an async thread that bills through the store). |
| `agent/tool_call_batches.py` | Groups tool calls into parallel/sequential segments. |
| `agent/tool_dispatch_helpers.py` | Shared tool-dispatch helpers. |
| `agent/tool_executor.py` (98 KB) | The tool executor: per-call scope/probe/hooks, the authorisation gate, the batch deadline, and the checkpoint that persists exactly the text the next model call will see. |
| `agent/tool_progress_relay.py` | Relays tool progress to the surface. |
| `agent/trace_upload.py` | Uploads a trace. |
| `agent/trajectory.py` | The trajectory record of a run. |
| `agent/transcript_repair.py` | Repairs a malformed persisted transcript. |
| `agent/transcription_provider.py` | ABC for STT backends. |
| `agent/transcription_registry.py` | STT registry; built-ins always win. |
| `agent/transports/__init__.py` | Transports package marker. |
| `agent/transports/anthropic.py` | The Anthropic transport. |
| `agent/transports/base.py` | The transport ABC. |
| `agent/transports/bedrock.py` | The Bedrock transport. |
| `agent/transports/chat_completions.py` | The OpenAI-shaped transport. |
| `agent/transports/codex.py` | The Codex transport. |
| `agent/transports/codex_app_server.py` | The codex app-server transport. |
| `agent/transports/codex_app_server_session.py` | The codex app-server session. |
| `agent/transports/codex_event_projector.py` | Projects codex `item/*` notifications into OpenAI-shaped messages; each item yields **at most** one assistant + one tool entry (the message-alternation invariant). |
| `agent/transports/hermes_tools_mcp_server.py` | Exposes a curated subset of Hermes tools over stdio MCP for the codex runtime. |
| `agent/transports/types.py` | Transport wire types. |
| `agent/tts_provider.py` | ABC for TTS backends. |
| `agent/tts_registry.py` | TTS registry. |
| `agent/turn_api_call.py` | The provider call and its interrupt handling. |
| `agent/turn_api_error.py` | The API-error branch of a turn. |
| `agent/turn_api_request.py` | Builds the API request. |
| `agent/turn_author.py` | Parses/serialises the turn author (who asked). |
| `agent/turn_context.py` | Builds the turn's context; `drop_stale_api_content`. |
| `agent/turn_context_compaction.py` | The compaction phase inside a turn. |
| `agent/turn_empty_response.py` | The empty-response phase. |
| `agent/turn_explainers.py` | Explains a turn's state to the user. |
| `agent/turn_facade.py` | The public turn facade. |
| `agent/turn_iteration_prep.py` | Prepares one iteration: budget, announcements, retry restarts. |
| `agent/turn_liveness.py` | The liveness watchdog: `ActivitySnapshot` + a commit callback that revalidates `(generation, timestamp)` under the *same lock* `_touch_activity` stamps with, so a turn that resumed is never hard-cancelled. |
| `agent/turn_loop_errors.py` | The outer-loop error handler. |
| `agent/turn_overflow.py` | The context-overflow branch. |
| `agent/turn_preflight.py` | The preflight phase. |
| `agent/turn_preflight_gate.py` | The preflight gate. |
| `agent/turn_recovery.py` | The recovery ladder. |
| `agent/turn_recovery_codex.py` | The Codex-specific recovery rungs: strip a stale encrypted-reasoning blob; reset the replay verdict when the route changes. |
| `agent/turn_request_assembly.py` | Per-iteration request assembly. |
| `agent/turn_response_check.py` | Validates the provider response. |
| `agent/turn_response_intake.py` | Normalises the model response. |
| `agent/turn_retry_state.py` | `TurnRetryState` — the per-turn retry bookkeeping. |
| `agent/turn_scripted_prelude.py` | Tool calls a prompt built-in plays before the first model call. |
| `agent/turn_tool_round.py` | The tool round. |
| `agent/turn_tool_validation.py` | Validates a tool call before dispatch. |
| `agent/turn_truncation.py` | The truncation branch. |
| `agent/turn_usage.py` | Per-turn token/cost usage. |
| `agent/usage_anchor.py` | Anchors a usage record to a turn. |
| `agent/usage_pricing.py` | Per-model pricing. |
| `agent/vault_backends/__init__.py` | Vault package marker. |
| `agent/vault_backends/base.py` | The `LoginBackend` ABC. |
| `agent/vault_backends/unlock.py` | Shared unlock flow. |
| `agent/vault_login_classifier.py` | Classifies a login prompt (username vs password vs TOTP). |
| `agent/vault_store.py` | The local Fernet vault store. |
| `agent/vertex_adapter.py` | Vertex AI wire adapter. |
| `agent/video_gen_provider.py` | ABC for video-generation backends. |
| `agent/video_gen_registry.py` | Video-generation provider resolution. |
| `agent/vision_message_prep.py` | Prepares image content for the wire. |
| `agent/voice_turn_route.py` | Routes a voice turn. |
| `agent/web_search_provider.py` | ABC for web-search backends. |
| `agent/web_search_registry.py` | Web-search provider resolution; a *single-eligible shortcut* here (unlike the browser registry) is deliberate. |
| `batch_runner.py` | Runs a batch of prompts through the agent. |
| `hermes_bootstrap.py` | Selects the committed environment for a spawned interpreter before any dependency-bearing import. |
| `model_tools.py` | The model-facing tool surface. |
| `run_agent.py` | The public facade: `AIAgent` assembled from mixins; ~60 constructor parameters; `chat()` and `run_conversation()`. |
| `toolset_distributions.py` | The distribution of toolsets across profiles. |
| `toolsets.py` | The toolset catalogue and the enabled/disabled filtering. |

### Tier 3 — skipped with a reason

None. All 393 files were opened and read; none was unreadable, binary, or truncated.

---

#### `agent/backend_identity.py` (133 L) — the failure-axis model
- **Purpose:** one owner for "is this candidate the same backend as the one that failed, along the
  axis that failure invalidated?"
- **Key abstractions:** `FailureScope` (enum), `BackendIdentity`, `should_skip_candidate`,
  `same_credential_surface`, `same_endpoint`, `same_deployment`.
- **Non-obvious design decisions:** the module's whole reason to exist is that **"provider"
  conflates three axes** — credential surface (401/402), endpoint (DNS/refused), and model
  deployment (timeout/overload/429) (`:1-11`). A timeout invalidates ONE model deployment; a 401
  invalidates the shared credential; a DNS failure invalidates the endpoint. Every fallback /
  dedup / skip / quarantine decision asks the same question against the right axis.
- **Edge cases & failure handling:** an *unknown* axis can neither prove sameness nor difference on
  its own, so the remaining axes decide (`:40`); an unprovable axis answers "different" (one wasted
  RTT) rather than "same" (a stranded failover) (`:77-90`).
- **Surprising:** two *different* registry providers have distinct credential surfaces even when
  they share an inference host (`xai-oauth` vs `xai`), but a **custom/shim alias is not in the
  registry**, so sameness is unprovable there and must not be assumed (`:61-91`).

#### `agent/turn_overflow.py` (511 L) — byte-scored 413 recovery
- **Purpose:** overflow recovery for 413 payload-too-large and context-length errors.
- **Key abstractions:** `OverflowVerdict`, `_Recovery`, `recover_from_overflow`.
- **Non-obvious design decisions:** **a 413 is a BYTE-size error, so progress is scored in payload
  bytes — never the token estimate** (`:245-251`). The token estimator prices every image at a flat
  per-image cost, so two vision results were 96.6% of the request body but ~3.7% of the estimate;
  token-scored progress burned every attempt on "no progress" and wedged the session permanently.
- **Edge cases & failure handling:** after compression the request is **re-measured** — same-message-count
  compression (tool-result pruning, in-place summarisation) can shrink the payload without shrinking
  the message array (`:204-210`).
- **Surprising:** the context-length error has **two shapes** — "prompt too long" (input overflows →
  shrink the window *and* compress) vs "max_tokens too large" (input fits but input + max_tokens >
  window → shrink the **output cap only**) (`:368-410`).

#### `agent/empty_response_guard.py` (243 L) — the cost-aware retry budget
- **Purpose:** deterministic-empty detection and a cost-aware retry budget.
- **Key abstractions:** `resolve_guard_settings`, `deterministic_empty`, `empty_retry_budget`,
  `EmptyAttempt`.
- **Non-obvious design decisions:** two independent guards, both failing OPEN. (1) *Deterministic
  empty*: two consecutive empties, both with usage present and `output_tokens == 0`, from the same
  `(model, provider, finish_reason)` → skip the remaining retries. (2) *Cost-aware budget*: when
  one empty attempt's estimated input cost exceeds $0.25, the retry budget drops from **3 to 1**
  (`:1-20`).
- **Edge cases & failure handling:** reasoning tokens are real generation — a reasoning-only
  response is **not** a deterministic empty (`:167-168`).
- **Surprising:** each retry re-bills the **full input**, so three retries on a large context is
  three times the cost of the turn that failed.

#### `agent/message_metadata.py` (325 L) — the durable message identity
- **Purpose:** the internal metadata attached to durable conversation messages.
- **Key abstractions:** `append_message`, `mint_uid`, `stamp_message_uid`, `message_uid_or_none`,
  `index_tool_call_uids`, `merge_tool_call_uids`, `without_persistence_fields`.
- **Non-obvious design decisions:** a `message_uid` is minted **once at the row's first insert** and
  kept by every host copy of that logical message (in-place compaction generation, rotation child,
  concurrent-tail clone, replace re-issue, rewrite in place) — unlike `_row_id` (a physical id
  re-issued per copy), it is restored unconditionally, so context engines can key on it across
  restarts and boundaries (`:27-30`).
- **Edge cases & failure handling:** provider tool-call ids **repeat** (llama.cpp emits one constant
  id for every call), so an assistant row carries `{provider id: uid}` for its `tool_calls` and its
  tool-result rows carry the matching uid; the provider-facing `id` is never rewritten (`:36-38`).
- **Surprising:** the persistence-only fields are a *named set*, and the token estimator ignores
  them — an edit's inline diff in `display_metadata` is ~9 KB and would otherwise trigger premature
  compaction (`:13-17`).

#### `agent/moa_alternation.py` (64 L) — reactive, destination-scoped repair
- **Purpose:** the aggregator request deliberately ends `user(task), user(guidance)` on iteration 1
  so every earlier message stays byte-stable; strict chat templates 400 on that adjacency.
- **Non-obvious design decisions:** the merge is **reactive and destination-scoped** — a 400
  classified `role_alternation` triggers a retry ONCE with merged messages, and the *destination*
  is remembered on the facade so later iterations pre-merge for it. Destinations that accepted the
  split shape are never touched, so their prefix stays byte-stable (`:1-20`).
- **Surprising:** merging proactively for everyone would re-introduce the divergence the split shape
  removed and only move the 400 (`:12-15`).

#### `agent/estop.py` (138 L) — the global emergency stop
- **Purpose:** a resumable pause for **new work only**.
- **Key abstractions:** `is_engaged`, `engage`, `disengage`, `get_state`, `check_paused`.
- **Non-obvious design decisions:** `hermes pause` writes a sentinel at `$HERMES_HOME/ESTOP`;
  while it exists the cron scheduler, kanban dispatcher and new gateway turns skip work, but
  **in-flight work is never killed** (`:1-8`). The check is one or two uncached `os.stat` calls.
- **Edge cases & failure handling:** a corrupt or empty file still counts as engaged — fail safe
  (`:1-8`); the stat itself fails **safe** (True) (`:52`).
- **Surprising:** a profile gateway (`HERMES_HOME=~/.hermes/profiles/<n>`) must still honour the
  operator's root `~/.hermes/ESTOP`, so the candidate paths are profile-home-first, then the fleet
  root (`:36`).

#### `agent/surface_switch.py` (140 L) — a surface switch without a prompt rebuild
- **Purpose:** moving a session between surfaces (desktop ↔ TUI) changes only which interface
  renders the reply — but the surface guidance and `Platform:` trailer are embedded in the persisted
  system prompt.
- **Non-obvious design decisions:** rebuilding the prompt for it diverged the prompt within its
  first blocks, so the **entire request behind it re-prefilled** — a 220K-token session came back
  at a 1% cache hit (`:1-8`). The stored bytes are kept and the current surface's guidance is
  delivered on the **per-turn user-message channel** instead, stamped into the byte-stable
  `api_content` sidecar so later turns replay it unchanged. The prompt converges at the next
  rebuild boundary (compaction).
- **Edge cases & failure handling:** the frozen tool set is kept deliberately — removing a tool is
  the one thing that would still re-prefill the request behind the preserved prompt — so the model
  is *told* which pinned tools this surface did not build (`:83-101`).

---

## 2. Ideas worth stealing

1. **The system prompt is byte-stable for the life of a conversation — the only mutation is
   compression, and everything else rides a user message or tool result.**
   `agent/AGENTS.md:56-76`, `agent/conversation_loop.py:469-473`.
   **Why it transfers:** August Trading rebuilds prompts in several places. Making "the system
   prompt never changes mid-conversation" an explicit, reviewable invariant would let the provider
   prefix cache be relied on, and it converts "where do I inject this?" from a per-feature argument
   into a single rule.
   **UNIQUE** to this shard's reading (it is stated as a *review* invariant, not enforced by code).

2. **A pure, side-effect-free guardrail controller that returns decisions; the runtime decides
   the escalation.**
   `agent/tool_guardrails.py:2-5`, `:1791-1808`.
   **Why it transfers:** August Trading's gate scoring (`services/validation/`) and the desk-tool
   guardrails are entangled with UI. A pure `allow | warn | block | halt` decision object with the
   policy moved to the caller is testable without a React mount — which is exactly the class of
   test August currently cannot write.
   **CONVERGENT** — the same "pure decision, side effects in the runtime" split appears in
   `agent/turn_stop_gates.py` and `agent/error_classifier.py`.

3. **A "no proof, no retry" recovery nudge instead of a blind re-run.**
   `agent/kanban_turn_recovery.py:290-337` (`build_recovery_nudge`, `_emit_recovery_skipped`).
   **Why it transfers:** when an automated August Trading job (a scheduled analysis, a backtest
   sweep) fails, the temptation is to re-run it. Hermes records the failed attempt as a
   *protocol violation* and refuses to retry without a proof-of-life signal. That is the right
   shape for "a scheduled run produced nothing".
   **UNIQUE.**

4. **Curator-style lifecycle: never delete, only archive; pin what matters; treat cron-referenced
   skills as pinned; `use_count == 0` is absence of evidence, not staleness; a first sighting
   anchors the clock to now.**
   `agent/curator.py:8`, `:186-190`, `:249-255`, `:84-88`, `:172-174`.
   **Why it transfers:** August Trading has a learning/skills system and a rule store. This is a
   complete, small, defensible retirement policy — and the "cron-referenced ⇒ pinned" rule is
   exactly the analogue of "a scheduled automation depends on this rule".
   **CONVERGENT** with `agent/learning_graph.py` (the archive-not-delete contract) and
   `agent/curator_backup.py` (backup before a mutation pass).

5. **The consolidation prompt that treats "one session → one rule" as a FAILURE of the library.**
   `agent/curator.py:290-330` (`CURATOR_REVIEW_PROMPT`).
   **Why it transfers:** August's insights/pattern-memory store accumulates per-incident notes.
   Hermes states the target shape (class-level rule + a small set of topical references), states
   the distillation rule ("imperative + one clause of why"; "the same lesson stated twice becomes
   one rule"), and states what to drop (incident narration, PR numbers, dates, quoted chatter).
   That is a ready-made prompt contract for a pattern-memory curator.
   **UNIQUE.**

6. **A unified deadline layer where the deadline is a daemon thread, not an event-loop timer, and
   a second timer dumps all thread stacks when the loop provably failed to process the expiry.**
   `agent/deadline.py:190-197`, `:222-233`.
   **Why it transfers:** any August Trading feature that must not hang (a provider call, a worker)
   currently needs its own ad-hoc timeout. One `run_bounded_sync`/`run_bounded_async` with
   `clamp_timeout` and a "our deadline ≠ provider timeout" distinction removes a whole class of
   bug — and the "blocked loop" stack dump is the diagnostic you wish you had.
   **CONVERGENT** with `agent/chat_completion_stream_monitor.py` (a watchdog independent of the
   request path).

7. **A content-free observability plane: no prompts, no messages, no tool args, no session
   history, no usage analytics; field order is wire order; collection is opt-in.**
   `agent/monitoring/events.py:1-11`, `agent/monitoring/emitter.py:147`.
   **Why it transfers:** if August Trading ever ships an ops plane, this is the shape that survives
   a privacy review. The "the only shapes the plane emits" phrasing is a specification you can
   paste into a test.
   **UNIQUE.**

8. **One process-wide timer thread for every periodic callback; each body on its own worker; a
   blocked callback cannot delay unrelated timers; a handle never overlaps itself.**
   `agent/periodic_scheduler.py:484-504`, `:572-594`.
   **Why it transfers:** August's automation/price-alert scheduler is the exact place this matters —
   a slow alert check must not delay a second alert check. This is a drop-in scheduler with
   documented semantics (first call after one interval, drift-inclusive, `False` stops the handle).
   **UNIQUE.**

9. **`AuxiliaryExplicitCancellation` subclasses `BaseException` so broad `except Exception` retry
   code cannot mistake a host stop for a transport failure.**
   `agent/auxiliary_client.py:217-221`.
   **Why it transfers:** August's provider retry ladders use `catch (e) { retry }`. A user pressing
   Stop during a fetch is currently at risk of being retried. `BaseException` is the smallest,
   sharpest fix.
   **UNIQUE.**

10. **A fingerprint on memory entries so a user clicking an entry still edits that entry after
    the list shifts.**
    `agent/learning_mutations.py:8-11`, `:41-51`, `:71`.
    **Why it transfers:** August's trade log / pattern memory is list-shaped and gets reordered.
    An id that carries a content digest (and refuses with "stale — refresh" rather than editing
    the wrong row) is a small, high-value correctness fix.
    **UNIQUE.**

11. **Fail-closed on retry after a destructive mutation: `retryable_user_text` raises *before* the
    mutation when the payload is media.**
    `agent/context_compressor_retry.py:8`.
    **Why it transfers:** any August flow that retries a write (logging a trade, applying a rule)
    must extract the retry text *before* mutating, and must refuse media rather than silently
    dropping it.
    **UNIQUE.**

12. **A "no proof, no retry" *and* a dry-run banner that forbids mutating actions and asks the
    model to say so if one slipped.**
    `agent/curator.py:266-287`.
    **Why it transfers:** August's "Save as skill" / rule-approval flow could adopt the same
    two-stage shape: a read-only preview pass whose output is the deliverable, then a human
    approval, then the live pass.
    **UNIQUE.**

13. **A three-axis failure model: credential surface / endpoint / model deployment.**
    `agent/backend_identity.py:1-11`, `:23-33`, `:127-186`.
    **Why it transfers:** August's provider/credential rotation (and the credential pool in
    `services/providers/`) needs exactly this: a 429 says "this model on this account is
    throttled", a 401 says "this key is bad", and a DNS failure says "this endpoint is down" —
    three different responses that a single "provider failed" flag would collapse. The module
    exists because inlining the question at each call site "kept reintroducing the same bugs".
    **UNIQUE.**

14. **Score a 413 by payload BYTES, not by token estimate.**
    `agent/turn_overflow.py:245-251`, `:204-210`.
    **Why it transfers:** August's tool results carry large payloads (market data, backtest output,
    chart renders). Hermes' measured case — two vision results = 96.6% of the request body but
    ~3.7% of the token estimate — burned every retry on "no progress" and wedged the session
    permanently. A byte-scored progress check plus a **re-measure after compression** (same message
    count, smaller bytes) is the fix.
    **UNIQUE.**

15. **A cost-aware retry budget: when one attempt costs more than $0.25, drop the retry budget
    from 3 to 1.**
    `agent/empty_response_guard.py:1-20`, `:229-240`.
    **Why it transfers:** August's provider retry ladder re-bills the full input on every attempt.
    A cost-aware ceiling is a two-line change that directly bounds the worst case of an empty/
    malformed-response loop.
    **UNIQUE.**

16. **A durable `message_uid` minted once and carried by every copy of a logical message.**
    `agent/message_metadata.py:27-30`, `:109-127`, `:222-257`.
    **Why it transfers:** August's trade log, chat transcript and learning store all copy rows
    around (compaction, branch, rotation, replace). A stable per-message identity is what lets a
    projection, an export or a "delete this entry" action keep pointing at the right row after the
    list has moved — and it is the prerequisite for the fingerprint pattern in idea 10.
    **UNIQUE.**

17. **A global emergency-stop sentinel that pauses NEW work and never kills in-flight work.**
    `agent/estop.py:1-8`, `:52-60`.
    **Why it transfers:** if August ever ships a scheduled-analysis surface, the operator needs a
    "stop everything new" lever that is a single file write, is checked by one `os.stat`, fails
    safe, and can be lifted by deleting the file. A one-line check in the scheduler's admission
    path.
    **UNIQUE.**

18. **An idle-gated, session-coalescing queue for deferred work, with an age-out that dispatches
    regardless of idleness.**
    `agent/review_idle_queue.py:840-849`, `:936-944`, `:965-981`.
    **Why it transfers:** the direct analogue for a scheduled job that must not compete with a live
    user turn (a background analysis, a learning pass). "Newest snapshot wins" is dedup, not loss;
    keeping the *original* enqueue time stops a busy session from postponing its work forever; and
    the age-out means deferred work still happens.
    **UNIQUE.**

---

## 3. Trading-specific findings

**1. Long-lived monitoring & scheduled work.** In this shard the *scheduler substrate* is
`agent/periodic_scheduler.py` (one shared timer thread, per-handle workers, no self-overlap,
`False` stops the handle, a raising body is logged and rescheduled). The *durable job* substrate
lives outside the shard (`cron/jobs.py` is referenced by `agent/curator.py:186-190` and
`agent/monitoring/cron_health.py` exists but the jobs store is not in this file list). Four
reliability ideas that *are* in the shard and that map directly onto a trade-log app:
(a) **cron-referenced skills are treated as pinned** (`agent/curator.py:186-190`) — the analogue of
"a scheduled automation depends on this rule, so the rule must not be retired";
(b) **the review idle queue's age-out** (`agent/review_idle_queue.py:867`, `:965-981`): a deferred
job dispatches regardless of idleness past a max age, because a job that never runs is a silent
loss of learning — the same argument applies to a scheduled TP/SL check that is deferred under
load;
(c) **the global ESTOP sentinel** (`agent/estop.py:1-8`): `hermes pause` writes one file; the cron
scheduler, kanban dispatcher and new gateway turns skip work; **in-flight work is never killed**.
The check is one or two uncached `os.stat` calls and a corrupt file still counts as engaged
(fail-safe). This is the "stop the automations" lever a trading app wants before a broker
incident;
(d) **the `should_run_now` gate** (`agent/curator.py:160-181`): enabled, not paused, and the last
run older than the interval; a *first observation seeds the clock and defers a full interval*, so a
fresh install never mutates on its first tick. The **breaker** pattern is not in this shard (it
belongs to the cron store).

**2. Human-in-the-loop approval.** Approval is real but lives mostly outside the shard
(`tools/approval.py`, `tools/approval_context.py` are referenced, not listed). What the shard
pins down is the *shape* of a consent flow, and it is a good one:
- `agent/terminal_approval_batch.py` prepares the **policy read only** ahead of the turn, never the
  execution (`:1-6`, `:2326-2343`); the guard key is on *what will actually run* — a foreground
  `cmd &` executes as `cmd` (`:2336-2340`).
- **Informed consent is per-batch state the user SAW**: once any slot in a batch has published a
  failed or denied result, a later slot's pre-collected approval no longer describes the world its
  command will run in, so it is **not consumed** and the guard re-runs live
  (`agent/terminal_approval_batch.py:105-109`, `:224-230`). Nothing is auto-denied — an explicit
  human answer still wins; only the *prepared* (often auto/policy) decision is dropped. That is
  the correct semantics for a trading app too: a denied trade in a batch must not license the
  rest of the batch.
- `agent/tool_executor.py` **serialises** policy prompts and **excludes the human wait** from the
  batch deadline — measured at the *source* of the wait, not as gate residency, and the acquire is
  bounded so a wedged plugin cannot park other workers forever.
- The audit trail is `agent/managed_worker.py`'s result frame: a **whitelist of scalar fields**
  (`:1084-1092`), with `billing_block` the one structured field and its own whitelist. The owner
  gets **no raw traceback** — runtime exceptions may contain credentials, so the worker logs
  locally and sends `reason='managed_worker_failed'` (`:1513-1517`).
- `agent/credential_sources.py`'s `RemovalStep` ledger is the same idea for credentials: the
  removal is *attributed*, and the ledger actor is tagged so an autonomous transition reads
  differently from a foreground call (`agent/curator.py:195-207`).
- `agent/learning_mutations.py:166-180` adds the rule that a **pinned** skill must be respected by
  *autonomous* actors too — the background review fork is "the same kind of autonomous, no-user-present
  actor, so it must not write to a pinned skill either… precisely because there is no user in the
  loop to consent to an edit here."

**3. Post-mortem / reflection loops.** The strongest pattern in the shard.
`agent/background_review.py` forks the agent on a daemon thread after every turn, replays the
conversation snapshot, and asks "should any skill/memory be saved or updated?" — writing only to
the memory and skill stores, never touching the live prompt (`agent/background_review.py:1-7`).
The fork inherits the parent's **live runtime and cached system prompt** so it hits the same
prefix cache — a review that paid full price for a cold cache would not be affordable at every
turn (`:5-7`); and it runs under a **dispatch-side tool whitelist** so a background judgement can
never mutate the world (`:7`). It is **budgeted** in aggregate input tokens (75% of the fork's
context window, capped at 600k) and the budget is checked at the top of the *next* iteration so the
budget-crossing request completes first (`agent/background_review.py:174-179`,
`agent/conversation_loop.py:112-122`). A misrouted review model is a **user-visible** notice, not a
debug line — "the misrouted model never ran and nothing said so" (`:294-296`).
What stops bad rules accumulating is the **curator** (`agent/curator.py`): archive-not-delete,
pinning, cron-reference protection, absence-of-evidence handling, first-sighting anchoring, a
deterministic (no-LLM) prune that always runs and an LLM consolidation that is opt-in, a dry-run
banner, and a **backup** (`agent/curator_backup.py`). `agent/learning_graph.py` then makes the
result *visible* as a graph, and `agent/learning_mutations.py` gives the user a safe delete/edit
with a content fingerprint. `agent/review_engine.py` is the explicit `/review` sibling: an
independent senior reviewer, told to *investigate the artifacts* rather than judge from the
excerpt, and told the parent's loaded skills are binding (`agent/review_engine.py:670-677`,
`:764-768`). The *compaction* stack has its own reflection: `agent/context_compressor.py` asks the
memory provider for `on_pre_compress()` insights and folds them into the summary
(`agent/conversation_compression.py:2889-2925`), and `_build_recovery_footer` leaves the model a
deterministic pointer into session history so "compaction is deferred retrieval, not loss".

**4. Multi-agent: subagents vs debate.** The shard has both, and the split is explicit.
**Subagents** (`agent/subagent_lifecycle.py`) are *immutable contracts, not agent objects* — a
plugin gets dataclasses with hard size caps (goal 16k, context 32k, metadata 8 KB) and a
versioned contract, and `delegate_task` runs on an async rail. A **duplicate `correlation_id` for
the same parent session is rejected** (`:2895-2896`) — idempotency of the caller's key is the
ledger's job. **Debate / Mixture-of-Agents** (`agent/moa_loop.py`) is *not* a debate: the normal
agent loop still owns tool calling and turn termination, and MoA only **gathers reference-model
context before each model iteration** — the references are advisors whose outputs are injected, not
peers whose votes are counted. The cost discipline is explicit and worth stealing: **references
deliberately do not inherit the global reasoning effort** (`:233-248`) and each advisor is priced
at its own rate (`:158-217`). The review path (`agent/review_engine.py`) is the case where an
independent agent genuinely adds value: it re-reads the artifacts under a different rubric. So the
answer the shard gives is: *debate adds value when the second agent is checking the first agent's
work against a rubric (the reviewer), and is wasted when the second agent is asked to re-derive the
same answer (the MoA reference).*

**5. Structured logs the model can query.** Hermes uses **SQLite** for the state DB
(`agent/insights.py` aggregates "the SQLite state DB" into usage insights; the durable turn lease
is a SQLite row; `agent/context_compressor.py` imports `sqlite3` and archives pre-compaction
transcripts). The interesting part is not the database but the *access patterns* that avoid a
heavy query engine:
- the **insights engine** reads the state DB and renders it — the model never raw-SQLs;
- the **turn receipt** (`agent/persisted_turn_receipt.py`, `agent/managed_worker.py:1084-1092`) is a
  **flat, whitelisted, scalar-only record** of a turn: outcome, exit reason, tokens, cost, model,
  service tier, `failure_reason`;
- the **learning graph** (`agent/learning_graph.py`) is a node/edge projection over files
  (skills + `MEMORY.md`/`USER.md` chunks), not a table;
- the **session store** (`agent/runtime_session_store.py`) owns transcript persistence;
- the durable turn **lease** is a SQLite row with a TTL and a renewal thread, which is the piece
  that makes a long-lived scheduled agent safe against two writers.
For a trade log, the transferable shape is: **a flat, typed, scalar-only per-event record with a
fixed field set**, plus a *projection* layer that answers the questions the model actually asks —
not a general query surface over an event log. The `message_uid` discipline (idea 16) is the other
half: the projection layer needs a stable identity for a row that moves.

**6. Staying simple as features accumulate.** The shard's answer is **decomposition by phase, with
a written rule of what each phase may touch**. The turn is ~33 sibling files (`turn_*.py`), each
one phase, each importable independently; `agent/AGENTS.md:39-47` says the point is that "a change
to (say) overflow handling touches one ~600-line file". The prompt-cache invariant (`:56-76`) is the
second rule: it stops new features from reaching into the system prompt — and the
`agent/surface_switch.py` module is the proof that this rule is load-bearing (a surface switch
that rebuilt the prompt re-prefilled a 220K-token session at a 1% cache hit).
`agent/curator.py`'s consolidation policy is the third: it explicitly treats a growing pile of
one-off skills as a **failure**. The `FILE_LINES` ratchet mentioned in
`agent/context_compressor_prune.py:1-10` is the mechanism — the origin module keeps the class,
the sibling owns the feature, and *every origin-module symbol is read through `_cc()` at call time
so tests that patch `agent.context_compressor.X` stay effective*. That last clause is the trick
that makes decomposition safe: the split is invisible to the test seam.

---

## 4. Non-obvious decisions and gotchas

1. **`_ra()` indirection.** After `run_conversation` was extracted out of `AIAgent`, symbols that
   callers patch on `run_agent` (`handle_function_call`, `_set_interrupt`, `OpenAI`) must still
   resolve — so the loop reaches them through `_ra()`
   (`agent/conversation_loop.py:396-400`). A reader who greps for `handle_function_call` in the
   loop will not find the real binding.
2. **`FailoverReason` has ≈30 members and the distinction is load-bearing.**
   `upstream_rate_limit` vs `rate_limit`, `upstream_blocked` vs `auth_permanent`,
   `context_overflow` sets `should_compress` (not `should_fallback`),
   `content_policy_blocked` is deterministic per-request and must not be retried unchanged
   (`agent/error_classifier.py:166-199`).
3. **"out of extra usage" is ambiguous.** Anthropic returns the same body for a content-filter
   rejection; the verdict stays `billing` but is flagged `billing_unverified` so surfaces hedge
   and the pool uses a short cooldown (`agent/error_classifier.py:253-256`).
4. **`auxiliary.free_only` and Codex OAuth are deliberately outside the chains.** Codex OAuth is
   in neither the text nor the vision chain — it is an undocumented, shifting allow-list, and an
   explicit `auxiliary.<task>.provider` is the only way in (`agent/auxiliary_client.py:10-11`).
5. **The image-eviction trigger is a provider limit, not a keep-newest count.** Retiring an image
   edits a message the provider has already cached, and Anthropic matches its prompt cache on an
   **exact byte prefix** — so a keep-newest-N window retires one more message on every new image
   and every turn is a full-prefix miss. Hermes holds images until the request would cross a real
   API limit (`agent/image_eviction_policy.py:1-20`).
6. **The turn-summary line never over-claims.** Failed tool calls are skipped entirely, and a diff
   with no +/- content lines yields "unknown", not "+0 -0"
   (`agent/turn_summary.py:322-325`, `:338-340`).
7. **A cron-referenced skill counts as pinned**, because usage only bumps when the job *fires* — a
   paused or rare job would otherwise age its own dependency out of the library
   (`agent/curator.py:186-190`).
8. **The consolidation fork is opt-in; the deterministic prune is not.** `DEFAULT_CONSOLIDATE =
   False` (`agent/curator.py:36`). A "curator" that always asks an LLM is a curator that burns
   tokens and produces unreviewed mutations.
9. **`AuxiliaryExplicitCancellation` is a `BaseException`.** Any `except Exception` around a
   provider call will not catch it — by design (`agent/auxiliary_client.py:217-221`).
10. **`resolve_timeout` rejects `bool` and NaN.** A YAML `true` must not become a 1-second
    deadline and a NaN must not become "unbounded"
    (`agent/deadline.py:164-175`).
11. **`run_bounded_sync` leaks a daemon thread per timeout.** The docstring says so explicitly:
    "do NOT use per-item in hot loops" (`agent/deadline.py:313-315`).
12. **`kill_process_tree` on POSIX freezes the tree before signalling.** A running parent can fork
    after a PID map is built and escape the final signal; hard-kill targets are suspended, the
    tree is rescanned, then descendants are signalled bottom-up (`agent/deadline.py:366-421`).
13. **The lease is taken even when the session row does not exist.** Client-addressed session ids
    are not process-unique and the first turn creates the row mid-turn, so a second writer would
    otherwise interleave (`agent/turn_facade_lease.py:316-320`).
14. **A locked or non-WAL SQLite read proves nothing.** `get_session` returns `None` rather than
    raising, so a locked read is not read as "the row is gone"
    (`agent/turn_facade_lease.py:288-291`).
15. **A "first observation seeds the clock" rule appears twice** — in the curator
    (`agent/curator.py:84-88`) and in the model-metadata cache
    (`agent/model_metadata_cache.py:21-31`: a truncating write killed mid-dump would otherwise wipe
    *every* cached length). Both are the same lesson: a fresh install must not act on an
    unanchored clock.
16. **The chat-completion stream monitor retires its watchdog *before* the connection returns to
    the pool.** A timer callback that already woke must never shut down a connection a later
    request has acquired (`agent/chat_completion_stream_monitor.py:58-59`).
17. **`_openai` is imported lazily behind a proxy that preserves `isinstance`.** `patch("...OpenAI")`
    still works, and a missing optional dependency never breaks import time
    (`agent/process_bootstrap.py:119-130`, `agent/auxiliary_client.py:66-76`).
18. **The `self` reference in a managed worker's `hello()` is the ancestor chain, not a
    self-reference.** The owner, never the worker, decides whether the ancestors match
    (`agent/managed_worker.py:1490-1497`).
19. **The credential-source label is read *without* calling the credential.** A callable key mints
    a bearer on first use; a display path that called it just to mask it would mint a token
    (`agent/credential_source.py:19`).
20. **A profile edit after session creation cannot reshape a live session.** The worker's config
    is frozen before any config-reading import, and the *frozen* config is what every reader in
    the process returns (`agent/managed_worker.py:1177-1184`).

---

## 5. Weak spots

1. **The turn is 33 files and ~1651 lines in the loop itself.** `agent/AGENTS.md:39-47` promises
   "one ~600-line file" per phase, but `agent/conversation_loop.py` is 1651 lines and
   `agent/auxiliary_client.py` is 8392. The decomposition is real but uneven, and the *rule* is
   prose, not a lint.
2. **Prose invariants are the enforcement mechanism.** "The system prompt is byte-stable for the
   life of a conversation" (`agent/AGENTS.md:56-76`) is reviewed, not tested. Nothing in the shard
   asserts it, so a mid-conversation system-prompt rebuild would pass every test and only cost
   money (a cache miss) in production.
3. **Enormous surface, enormous comment load.** A large fraction of the bytes in this shard are
   long issue-numbered rationale comments. That is a real asset for a maintainer, but it means the
   code is read at ~2× the rate of the logic it implements, and the comments reference an issue
   tracker that is not in the repository — a reader without the tracker cannot reconstruct the
   reasoning, only accept it.
4. **The error taxonomy is a 30-member enum matched by substring tables.** It is thorough, but the
   classification is string-matching over provider error bodies (`agent/error_classifier.py:229-262`),
   and provider wording changes silently. The `billing_unverified` escape hatch is the visible
   scar of that design.
5. **`agent/auxiliary_client.py` is 8392 lines** with a provider-chain policy embedded in the
   middle of a transport module — the chain rules (which providers, in which order, who is
   excluded) are the least testable part of the harness and live in the worst place.
6. **Two independent "who owns the turn" mechanisms coexist** — the durable SQLite lease
   (`agent/turn_facade_lease.py`) and the in-process `PeriodicScheduler` watchdog — and the
   interaction between them (a lease renewal that misses while the watchdog aborts) is not
   described anywhere in this shard.
