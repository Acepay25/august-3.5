# hermes-agent :: hermes-tests-agent-tools

**Files in shard:** 1860 (read: 1860, skipped with reason: 0)
**What this shard covers:** the entire `tests/agent/` and `tests/tools/` suites of
`hermes-agent` (Python). It is the executable specification of the agent loop, the
provider/transport layer, the context-compression machinery, the tool registry and its
approval/permission gates, the MCP client, the browser/computer-use surfaces, the skill
and memory subsystems, the cron/scheduler, the delegation (subagent) stack, and the
credential/secret pool. Nothing in this shard is product code — every file is a test,
fixture or helper — so the shard is read as a *set*: what it pins is the contract the
implementation is expected to hold, and the docstrings carry the incident numbers and
causal stories that explain why each pin exists.

**Reading method.** 1860 files at 18 MB is a bulk-tier set. Every file was opened and
its module docstring (the incident narrative), its imports and the complete list of its
test-case names were extracted in batches of 30–50 files; the load-bearing files listed
in §1.1 were additionally read end-to-end. The per-file ledger in §1.3 is generated from
each file's own docstring and test-case names, so it is a faithful description of what
each file pins rather than a guess from the filename.

## 1. File-by-file

### 1.1 Tier 1 — the load-bearing specifications

This shard contains **no product code** — it is the test suite. So the "load-bearing"
files here are the specifications the rest of Hermes is built to satisfy: the ones
whose docstring names the incident that made the behaviour non-negotiable. These 32
were read in depth (head, tail and the full test-name inventory); the other 1828 are
in the table in §1.3.

#### `tests/agent/test_run_agent.py` (300 KB, 247 cases)
- **Purpose:** the unit surface of `run_agent.AIAgent` — the agent's own class.
- **Key abstractions:** `_sanitize_api_messages`, `_cap_delegate_task_calls`,
  `_deduplicate_tool_calls`, `_uniquify_tool_call_ids` (the four guardrails also
  pinned in `tests/agent/test_agent_guardrails.py`), the persist/flush cursor, and
  the "override" mechanism that replaces the current user message's DB row.
- **Data flow:** the agent's `messages` list is the single mutable transcript; every
  outbound request is a projection of it (`_sanitize_api_messages`), and every
  durable write is a flush of the same list against `SessionDB`.
- **Non-obvious decisions:** the transcript is mutated *in place* by sanitisation and
  compression, and the flush cursor (`_last_flushed_db_idx`) is what makes
  persistence idempotent — `tests/agent/test_860_dedup.py` and
  `test_identity_flush.py` pin that a repeated flush writes once.
- **Edge cases:** orphaned tool calls get a stub result; duplicate call ids are
  re-minted; a malformed call id is left for the fallback path.
- **Surprising:** the guardrails are *pre-LLM* — they repair the message list before
  the request, so a provider never sees an unpaired `tool_call`.

#### `tests/agent/test_context_compressor.py` (181 KB, 136 cases)
- **Purpose:** the compression engine: thresholds, tail protection, summary
  generation, fallbacks.
- **Key abstractions:** `ContextCompressor`, `SUMMARY_PREFIX`,
  `COMPRESSED_SUMMARY_METADATA_KEY`, `_PRUNE_MIN_CHARS`, `_find_tail_cut_by_tokens`.
- **Data flow:** messages → (head protect) → (tail protect) → middle → one LLM
  summary → a `[CONTEXT COMPACTION — REFERENCE ONLY]` handoff carrying a metadata
  flag; the flag is what the next turn's repair code uses to tell a real user turn
  from a summary.
- **Non-obvious decisions:** the tail walk counts the **full tool-call envelope**
  (id + type + name + arguments), not just the arguments — the old accounting
  undercounted parallel fan-outs 2–15× and made compression ineffective
  (`tests/agent/test_compressor_tool_call_budget.py`).
- **Edge cases:** a zero-user transcript is repaired so a summary never lands as the
  only turn; a truncated summary (`finish_reason == "length"`) is rejected rather
  than stored (`test_compressor_truncated_summary_guard.py`).
- **Surprising:** a *reference-only* summary row uses `role="user"`, so the model
  reads it as context rather than as an instruction — and
  `test_reference_handoff_active_turn.py` proves such a row never becomes the
  active user turn after a completed answer.

#### `tests/agent/test_error_classifier.py` (97 KB, 139 cases)
- **Purpose:** one classifier that turns any provider failure into a
  `FailoverReason` (auth / billing / rate_limit / content_policy / context_overflow /
  image_too_large / data_policy_denied / …).
- **Key abstractions:** `classify_api_error`, `ClassifiedError`, `FailoverReason`,
  `is_reasoning_field_rejection`.
- **Data flow:** exception → status code + body + provider → reason → the loop's
  next move (retry / rotate a credential / fall back to another provider / abort).
- **Non-obvious decisions:** the same HTTP status means different things per
  provider. A 403 from a WAF is `upstream_blocked`, not `auth`
  (`test_error_classifier_upstream_blocked.py`); a 404
  `insufficient_credits_for_paid_model` is *billing* (`test_credit_404_fallback.py`);
  a 403 `data_policy_denied` never retries and never falls back.
- **Edge cases:** the classifier is **fail-open** — an unrecognised body is
  `unknown`, which is retryable, never a silent abort.
- **Surprising:** `tests/agent/test_error_classifier_observed.py` keeps a table of
  *real* provider bodies captured from production, plus one run-time `xfail` for a
  body main still mishandles. The classifier is maintained against evidence.

#### `tests/agent/test_message_sequence_repair.py` (72 KB, 64 cases)
- **Purpose:** the pre-API repair that keeps the transcript legal for strict
  providers (alternation, tool-pair integrity).
- **Key abstractions:** `_repair_message_sequence`,
  `_drop_trailing_empty_response_scaffolding`.
- **Data flow:** every outbound request passes through repair, which merges
  consecutive user rows, drops orphan tool results, and keeps an executed tool pair
  alive under scaffolding.
- **Non-obvious decisions:** repair never *drops* an executed tool call — it
  re-anchors it, because losing the pair creates a `tool → user` boundary that makes
  Gemini and Claude hallucinate continuations
  (`test_close_interrupted_tool_sequence.py`).
- **Edge cases:** a dangling tool row with an unknown call id is dropped; a Codex
  call id is kept.
- **Surprising:** the current-turn row index must be re-anchored *after* the repair
  runs, because the repair can move the row
  (`test_repair_reanchors_current_turn_user_idx.py`).

#### `tests/agent/test_credential_pool.py` (79 KB, 48 cases)
- **Purpose:** the multi-credential pool: rotation, benching, persistence.
- **Key abstractions:** `CredentialPool`, `PooledCredential`, `load_pool`,
  `mark_exhausted_and_rotate`, `STATUS_DEAD` / `STATUS_EXHAUSTED`.
- **Data flow:** `auth.json` → pool rows → a lease per request → a status per failure
  → a write-through of the rotation back to disk.
- **Non-obvious decisions:** a *rotated* key clears its exhaustion state
  (`test_credential_pool_key_rotation.py`), but a *transient* 429 on a **sole**
  credential gets a short cooldown, not an hour-long bench
  (`test_credential_pool_sole_cooldown.py`) — a single-key setup must not be
  bricked by one throttle.
- **Edge cases:** a rotation that can only hand back the entry just marked exhausted
  is **not a recovery** and must return `None`
  (`test_credential_pool_sole_rotate_recovery.py`); an unmatched-identity branch is
  bounded so the pool cannot loop forever
  (`test_credential_pool_unmatched_rotation_bound.py`).
- **Surprising:** env-backed rows (`source: env:VAR`) persist **without** the secret
  and are re-hydrated on every load — the pool never writes a secret to disk.

#### `tests/agent/test_redact.py` (69 KB, 131 cases)
- **Purpose:** the secret masker used by logs, tool results, memory, MCP and the
  terminal.
- **Key abstractions:** `mask_secret`, `redact_sensitive_text`, `redact_cdp_url`,
  `RedactingFormatter`.
- **Data flow:** any string that could reach a log, a transcript, a memory store or
  a browser → `redact_sensitive_text` → masked.
- **Non-obvious decisions:** matchers are *prefix-shaped* (a provider prefix plus a
  key-shaped suffix) so a benign token is not mangled; the tests assert on
  *absence* of the secret, never on a mask format.
- **Edge cases:** strict mode (`force=True`) is used at persistence boundaries even
  when the global redaction flag is off
  (`test_compaction_redaction_boundaries.py`).
- **Surprising:** redaction is applied to the *memory fan-out* too
  (`test_memory_sync_redaction.py`) — a key echoed inside a tool result would
  otherwise be archived verbatim by the provider.

#### `tests/agent/test_curator.py` (43 KB, 35 cases)
- **Purpose:** the background skill-curator: inactivity transitions, archiving,
  consolidation, and its own scheduler state.
- **Key abstractions:** `maybe_run_curator`, `apply_automatic_transitions`,
  `.curator_state` (`agent/curator.py`).
- **Data flow:** activity timestamps (view / use / cron reference) → per-skill state →
  `stale` (14 d) → `archived` (30 d) → a report plus `run.json` under
  `~/.hermes/logs/curator/<ts>/`.
- **Non-obvious decisions:** the curator **archives, never deletes** (recoverable), it
  touches only curator-managed skills, and a **pinned** skill bypasses every
  transition. A skill referenced by a cron job survives inactivity by name *and* by
  absolute path, and an unresolvable reference is kept verbatim rather than guessed.
- **Edge cases:** one process claims a due pass (a second CLI launched 12 s later
  does not duplicate the work — `test_curator_run_hygiene.py`); a prune-only pass
  takes no snapshot but still ages old ones out.
- **Surprising:** the LLM consolidation fork is **opt-in** (`consolidate` defaults to
  `False`); the deterministic inactivity prune always runs. A prune-only pass is
  what keeps a 1.9 GB skills tree affordable.

#### `tests/agent/test_background_review.py` (32 KB, 15 cases)
- **Purpose:** the post-turn self-improvement fork: a second agent that reads the
  turn's transcript and may write memory or skills.
- **Key abstractions:** `spawn_background_review_thread`,
  `_summarize_background_review_actions`, the review tool whitelist.
- **Data flow:** turn ends → snapshot cloned → fork agent → restricted tool
  whitelist → a summary of the actions it took → the parent shows the summary.
- **Non-obvious decisions:** the fork inherits the parent's **full** tool *schema*
  (so the provider's prompt-cache prefix matches) but enforces the memory+skills
  restriction at **runtime** through a thread-local whitelist, not by narrowing the
  schema. The fork's memory scope follows the trigger that fired it
  (`test_background_review_memory_scope.py`).
- **Edge cases:** the fork is skipped when the provider cannot carry Hermes tool
  calls back (a guaranteed no-op that would still cost a whole agent spawn); the
  fork's usage is recorded against the parent session
  (`test_background_review_usage.py`).
- **Surprising:** the fork inherits the parent's *cached* system prompt byte-for-byte
  — a fresh timestamp would break the prefix cache and cost ~26 % of the turn
  (`test_background_review_cache_parity.py`).

#### `tests/agent/test_periodic_scheduler.py` (5 KB, 6 cases)
- **Purpose:** the one timer thread that dispatches isolated periodic callbacks.
- **Key abstractions:** `PeriodicScheduler`, `schedule` (module-level default).
- **Data flow:** a handle with an interval → one shared timer thread → the callback
  runs in a worker → returning `False` unschedules it.
- **Non-obvious decisions:** a **raising** callback is rescheduled and does not kill
  its siblings; a **blocked** callback does not stall a due sibling (the due check
  runs on the timer, the work on a pool).
- **Edge cases:** `cancel()` joins the in-flight callback; a worker-start failure
  keeps the timer alive.
- **Surprising:** the callback runs in the `Context` that owned the scheduled handle
  (`test_periodic_scheduler_context.py`) — a `ContextVar` set at schedule time is
  still visible at fire time.

#### `tests/agent/test_authorization_gate.py` (13 KB, 15 cases)
- **Purpose:** the concurrent authorisation gate and the human-wait accounting that
  keeps a batch deadline honest.
- **Key abstractions:** the gate's serialisation lock, `human_wait_window`,
  `excluded_seconds()`.
- **Data flow:** a tool asks for authorisation → the gate serialises callbacks → a
  real human wait opens a window → the window is **excluded** from the batch
  deadline.
- **Non-obvious decisions:** the exclusion is measured at the **source of the human
  wait** (the CLI prompt and the gateway poll loop), not as residency inside
  `gate.run()`. The old measure was algebraically incapable of firing:
  `remaining = deadline − window_started`, constant forever.
- **Edge cases:** a wedged plugin inside the gate contributes **nothing** to the
  exclusion (so the batch still times out); a lock timeout degrades to
  unserialised rather than hanging.
- **Surprising:** the lock acquire is bounded, and overlapping human windows
  coalesce — two prompts for the same session are one wait.

#### `tests/agent/test_steer.py` (41 KB, 37 cases)
- **Purpose:** mid-run user steering — adding a note to the agent's next tool
  result without interrupting the current call.
- **Key abstractions:** `AIAgent.steer`, the steer queue, `_requeue_pending_steer`.
- **Data flow:** a user message during a tool call → queued steer → folded into the
  next `role="tool"` result (never as a `role="user"` row).
- **Non-obvious decisions:** the steer rides **inside** a tool result, so the
  transcript's role alternation is untouched. A withdrawn steer is refused even if
  its text is still buffered.
- **Edge cases:** compaction must re-anchor a steer that survived into the tail
  (`test_compression_busy_steer_anchor.py`); a steer merged into a tool-result turn
  keeps the in-flight thinking block.
- **Surprising:** a steer is a *display* identity as well as content — it keeps one
  identity across compactions (`test_steer_compaction_persistence.py`).

#### `tests/agent/test_turn_finalizer_final_response_persistence.py` (18 KB, 10 cases)
- **Purpose:** what the turn finaliser writes as the final answer.
- **Key abstractions:** `finalize_turn`, the final-response row, the tool-tail close.
- **Data flow:** last assistant text → the final row → the persistence flush → the
  surface.
- **Non-obvious decisions:** the final response **closes the tool tail** before it is
  persisted, and it *fills* a pure tool-call tail rather than dropping it.
- **Edge cases:** a delayed SQLite write keeps the fallback timestamp; a failed
  flush does not abort a completed turn.
- **Surprising:** the final response is not always the last assistant row — the
  finaliser is the only thing allowed to decide which one is the answer.

#### `tests/agent/test_tool_call_incremental_persistence.py` (44 KB, 20 cases)
- **Purpose:** incremental persistence: a tool call is durable *before* it runs.
- **Key abstractions:** the flush cursor, the interim-assistant row, the
  `_DB_PERSISTED_MARKER`.
- **Data flow:** assistant tool-call row → flush → UI projection → tool executes →
  tool-result row → flush.
- **Non-obvious decisions:** if the assistant row cannot be persisted, the tool's
  side effects are **blocked** and the UI projection is withheld. The reason is
  stated plainly: a crash between the two would otherwise leave an orphan tool
  call that no result ever matches.
- **Edge cases:** an abnormal exit still leaves the interim assistant durable.
- **Surprising:** the same file also owns the "preview is durable before emission"
  rule for edit previews (`test_inline_edit_persistence.py`).

#### `tests/agent/test_review_engine.py` (16 KB, 20 cases)
- **Purpose:** the `/review` command: snapshot the conversation, dispatch a
  reviewer subagent, deliver the verdict.
- **Key abstractions:** `build_review_task`, the auxiliary `review` credential
  resolution, the dispatch-note formatter.
- **Data flow:** last 10 chat messages → a reviewer task → a background dispatch →
  a note.
- **Non-obvious decisions:** the snapshot is the **last ten chat messages only** —
  tool-call stubs are skipped — because a reviewer wants the conversation, not the
  machinery.
- **Edge cases:** oversized messages are capped; multimodal content is handled.
- **Surprising:** the review runs as a delegated background task, so a long review
  does not block the turn that asked for it.

#### `tests/agent/test_learning_graph.py` (4 KB, 4 cases)
- **Purpose:** the learning-graph assembler — skills and memories as a graph.
- **Key abstractions:** edge integrity, clusters, memory cards.
- **Data flow:** the live skill catalog + the memory store → nodes + edges → the
  "Star Map" render.
- **Non-obvious decisions:** the tests assert **invariants** (edges resolve to real
  nodes, clusters cover every node), never a snapshot of the catalog — the catalog
  grows every release, so a count assertion would be a change-detector.
- **Edge cases:** isolated nodes still count in the density stats; a memory card is
  split on its separator.
- **Surprising:** a foreground-created skill must appear in the journey **before**
  its first use.

#### `tests/agent/test_insights.py` (29 KB, 29 cases)
- **Purpose:** the `/insights` analytics: token totals, cost, per-model breakdown.
- **Key abstractions:** `InsightsEngine`, `_estimate_cost`, `_bar_chart`.
- **Data flow:** `SessionDB` usage rows → per-model aggregation → a rendered report.
- **Non-obvious decisions:** a mid-session model switch splits the breakdown — the
  model that answered part of a session is priced as part of it.
- **Edge cases:** a custom model with no pricing entry falls back to a heuristic and
  is *not* counted as "known pricing".
- **Surprising:** the cost model is deliberately honest about what it does not
  know: an unknown model is shown as unknown, not silently priced at zero.

#### `tests/agent/test_kanban_turn_recovery.py` (33 KB, 26 cases)
- **Purpose:** the kanban worker's turn-retry policy and the claim/lease proof.
- **Key abstractions:** retry eligibility, the live run/claim proof, the exit-code
  mapping.
- **Data flow:** a failed worker turn → a retry decision → a claim with a lease →
  the next turn.
- **Non-obvious decisions:** a retryable failed turn is eligible; a *non*-retryable
  one is not. A missing board, a missing pinned carrier, or a missing DB pin all
  **fail closed** rather than guessing an ambient board.
- **Edge cases:** the max-attempts value is parsed and clamped; a delay schedule
  repeats its last entry.
- **Surprising:** the exit code is owned by `hermes_cli.turn_exit.turn_exit_code`
  and pinned row by row elsewhere — the kanban layer does not re-derive it.

#### `tests/agent/test_memory_provider.py` (61 KB, 58 cases)
- **Purpose:** the memory provider interface, the manager, and the builtin store.
- **Key abstractions:** `MemoryProvider`, `MemoryManager`,
  `inject_memory_provider_tools`.
- **Data flow:** provider → `prefetch` → a `<memory-context>` block → the user
  row's `api_content` sidecar → replayed verbatim on later turns; writes flow the
  other way.
- **Non-obvious decisions:** the manager runs every provider's
  `on_turn_start`/`sync_turn` through **one** worker; a provider that does not
  accept a kwarg is called without it (each provider is probed for what it
  accepts).
- **Edge cases:** an oversized external prefetch is **spilled** rather than injected
  whole; a runaway recall still spills; the builtin prefetch is not spilled.
- **Surprising:** end-of-turn sync is **asynchronous** — a provider that blocks for
  300 s must not hold the turn open (`test_memory_async_sync.py`).

#### `tests/agent/test_context_engine_message_uid.py` (25 KB, 19 cases)
- **Purpose:** a context engine must see a stable `message_uid` on every message.
- **Key abstractions:** the uid stamp, the row id, the composite merge record.
- **Data flow:** a durable row → a dict with a `message_uid` → the engine's
  `compress()` input, `post_llm_call` history, and `on_turn_complete` clones.
- **Non-obvious decisions:** the uid must reach the engine **after** a cold restore
  that never asked for `_row_id`, survive the persist override, and survive an
  in-place compaction commit — but must **never** reach the provider.
- **Edge cases:** a consecutive-user merge keeps the first constituent's uid and
  records the absorbed ones; a superseded verification candidate is not a witness
  constituent.
- **Surprising:** the live-list walk binds a tool result to the **nearest call that
  names it**, not to the previous row — a reused provider id must not merge two
  unrelated calls.

#### `tests/agent/test_prompt_caching.py` (37 KB, 42 cases)
- **Purpose:** Anthropic `cache_control` injection.
- **Key abstractions:** `apply_anthropic_cache_control`, `_build_marker`,
  `_can_carry_marker`, `_count_cache_markers`.
- **Data flow:** the message list → a cache plan (which sections carry a breakpoint)
  → the wire.
- **Non-obvious decisions:** only **unmodified** history rows may share a cached
  block; a section that was rewritten cannot. Marker placement is not part of the
  cache key — splitting one string into several parts *is* a content change.
- **Edge cases:** an endpoint that cannot carry a marker does not consume a slot.
- **Surprising:** the plan is computed per request from the section list, not from
  re-parsed marker strings, so a payload that *quotes* a marker cannot poison the
  stable prefix.

#### `tests/agent/test_tool_guardrails.py` (20 KB, 24 cases)
- **Purpose:** the tool-call loop guardrail primitive.
- **Key abstractions:** the tool-call signature hash, the warn/hard-stop thresholds.
- **Data flow:** a tool call → a canonical signature (hashed args) → the guard
  decides warn / hard stop.
- **Non-obvious decisions:** the signature hashes **canonical nested unicode args**
  and never exposes the raw arguments in the log.
- **Edge cases:** the gateway platform defaults to hard-stop; interactive platforms
  keep warning-only.
- **Surprising:** the same call with different arguments is a different signature —
  a repeated *identical* failure is the signal, not a repeated tool.

#### `tests/tools/test_approval.py` (91 KB, 127 cases)
- **Purpose:** the dangerous-command approval gate.
- **Key abstractions:** `detect_dangerous_command`, `detect_hardline_command`,
  `check_all_command_guards`, `prompt_dangerous_approval`, `approve_session`,
  `load_permanent`, `_smart_approve`.
- **Data flow:** a command → a danger detector (a floor below yolo) → a mode
  resolver (`off` / `manual` / `smart` / `yolo`) → a prompt → a decision → a
  session-scoped or permanent allowlist entry.
- **Non-obvious decisions:** three different vocabularies are kept apart: the
  **hardline** list (never runnable, even under yolo), the **dangerous** list (needs
  approval), and the **allowlist** (pre-approved). A smart approval does **not**
  allowlist the pattern for the session — the human's one "yes" is one command.
- **Edge cases:** a **timeout is not a denial**: `outcome == "timeout"`,
  `user_consent == False`, and the message says "timed out without user response /
  Silence is not consent". A cancelled approval is attributed to its cause, never
  to the user (`test_approval_cancelled_attribution.py`).
- **Surprising:** the "smart" mode asks an auxiliary LLM for a one-word verdict with
  thinking off and a 16-token budget, and still demands that the *human* path exists
  before it can be used.

#### `tests/tools/test_delegate.py` (89 KB, 71 cases)
- **Purpose:** the subagent delegation tool.
- **Key abstractions:** the toolset intersection, the batch shape, the child agent
  construction, the completion result.
- **Data flow:** a task list → per-task child agents → results → a summary back to
  the parent.
- **Non-obvious decisions:** the child toolset is the **intersection** with the
  parent's, and a child can never gain a tool the parent lacks. The delegation
  toolset itself is stripped from children (no recursive fan-out unless the parent
  is a dispatcher). The child's prompt-cache tier is **downgraded** from the
  parent's 1 h to 5 m.
- **Edge cases:** a child's summary is capped against the parent's remaining context
  headroom, split across the batch, and spilled losslessly when it overflows
  (`test_delegate_summary_budget.py`); a child's `child_timeout_seconds` bounds
  **inactivity**, not total runtime.
- **Surprising:** a child that is stopped mid-work reports the partial output it
  already had, rather than a bare "interrupted".

#### `tests/tools/test_cronjob_tools.py` (34 KB, 61 cases)
- **Purpose:** the cron tool surface: prompt scanning, schedule/list/remove.
- **Key abstractions:** the prompt-injection scanner, the job schema, the schedule
  dispatch.
- **Data flow:** a job definition → a scan → a store row → a scheduled occurrence →
  a run → a delivery.
- **Non-obvious decisions:** the prompt scanner is a **deny** gate on the job
  prompt: an injected instruction ("ignore all prior instructions") is refused at
  creation time. Unquoted YAML `off`/`on` arriving as booleans must normalise to
  the safe manual mode.
- **Edge cases:** a script path that does not exist is rejected **at creation
  time**, not at fire time (`test_cronjob_job_args.py`).
- **Surprising:** `action="run"` is a real immediate execution that claims and fires
  the job, not a "set next_run_at = now" that waits for the scheduler.

#### `tests/tools/test_session_search.py` (56 KB, 55 cases)
- **Purpose:** the model-facing recall tool over the session database.
- **Key abstractions:** one tool, four inferred shapes — DISCOVERY (`query`), SCROLL
  (`session_id` + `around_message_id`), READ (`session_id`), BROWSE (no args).
- **Data flow:** an FTS5 query over the SQLite session DB → a deduped, lineage-aware
  result set → a bounded, hydrated response.
- **Non-obvious decisions:** there are **no LLM calls** — every shape returns actual
  DB messages. Raw FTS rows are only a *plan*; the response hydrates its own window
  and bookends. Automation sessions (`cron`) are **demoted, not excluded**, because
  bare BM25 otherwise lets cron vocabulary starve the user's own sessions ("recall
  blindness"). Per-message content is capped at 2000 chars.
- **Edge cases:** compaction handoff summaries are excluded from bookends; a runaway
  lineage walk is capped.
- **Surprising:** the same search over the same DB returns different shapes purely
  from the arguments — there is no `mode` parameter, which removes a whole class of
  model mistakes.

#### `tests/tools/test_process_registry.py` (128 KB, 113 cases)
- **Purpose:** the background-process registry: spawn, poll, kill, checkpoint.
- **Key abstractions:** `ProcessRegistry`, `ProcessSession`, the completion queue,
  the checkpoint file.
- **Data flow:** spawn → a session row → polling → completion (published once, by
  the owner) → a checkpointed `processes.json` → a next-interpreter adoption.
- **Non-obvious decisions:** a kill that leaves survivors must **not** write a killed
  receipt and must not prune the session (`test_kill_verify_tree_death.py`) — the
  live tree would become unmanageable. A recycled PID is detected via the start
  time, not the number.
- **Edge cases:** a completion is published exactly once, by its owner, and only
  with its final output; a child that exits while the reader's pipe is still open
  does not end the session early.
- **Surprising:** importing the module must never open the canonical store — only
  the runtime that owns delegation state may restore it
  (`test_process_registry_import_fence.py`).

#### `tests/tools/test_skill_ledger.py` (32 KB, 24 cases)
- **Purpose:** the per-mutation audit ledger for skills, with rollback.
- **Key abstractions:** the ledger entry, the blob store, `rollback_entry`.
- **Data flow:** a skill mutation → a ledger entry (before/after blobs) → a
  background-review or foreground patch → a rollback that restores the "before"
  bytes.
- **Non-obvious decisions:** entries store **deltas, not whole-package manifests**
  (`test_skill_ledger_delta.py`) — a rollback writes every *before* path and removes
  *after*-only paths. The write origin is a `ContextVar`, so a background-review
  fork's patch is ledgered as `background_review` and a foreground patch as `agent`.
- **Edge cases:** a rollback of a batch is itself undoable; a legacy full-manifest
  entry is rewritten in place to the compact form.
- **Surprising:** the ledger is the mechanism that makes an autonomous
  self-improvement loop *reversible* — without it, a bad skill write is
  unrecoverable.

#### `tests/tools/test_write_approval.py` (20 KB, 20 cases)
- **Purpose:** the gate on the agent's cross-session writes (memory and skills).
- **Key abstractions:** `write_approval` (a per-subsystem boolean), the pending
  store.
- **Data flow:** a memory/skill write → if the gate is on, the write is **staged**
  to `<HERMES_HOME>/pending/{memory,skills}/<id>.json` (or prompted inline for
  memory in an interactive CLI) instead of being committed.
- **Non-obvious decisions:** the gate applies to **both** origins — a foreground
  turn *and* a background-review fork — which is the whole point: the fork is the
  agent writing to itself.
- **Edge cases:** a non-dict pending record is skipped rather than crashing; a
  malformed `enabled` value coerces to the safe default.
- **Surprising:** the pending store is a *review queue on disk*, not a UI concept —
  a human can approve a staged write out of band.

#### `tests/tools/test_tool_result_storage.py` (33 KB, 47 cases)
- **Purpose:** the three-layer tool-result persistence (inline → spilled → file).
- **Key abstractions:** `maybe_persist_tool_result`, `PERSISTED_OUTPUT_TAG`.
- **Data flow:** a tool result → a size check → inline, or spilled to a file with a
  tag the model can follow, or truncated.
- **Non-obvious decisions:** the spill is **lossless and recoverable** — the model
  gets a pointer plus a truncated preview, and a later `read_file` recovers the
  whole thing.
- **Edge cases:** a result exactly at the boundary stays inline; a multimodal
  envelope's *text* part goes through the same policy as a string result
  (`test_multimodal_tool_result_spill.py`).
- **Surprising:** the same policy is shared by terminal, `execute_code` and MCP
  (`test_tool_output_truncate.py`), so one algorithm decides every truncation.

#### `tests/tools/test_mcp_tool.py` (126 KB, 99 cases)
- **Purpose:** the MCP client surface.
- **Key abstractions:** the server registry, the transport builders, the tool
  handler, the circuit breaker.
- **Data flow:** a configured server → a transport → a session → a tool list → a
  call → a result (with `structuredContent` preserved).
- **Non-obvious decisions:** a hard **result size cap** exists because a buggy or
  malicious server could otherwise return megabytes; the cap is enforced on the
  wire body, not after the fact.
- **Edge cases:** one failing server must not churn the whole bridge (a per-server
  backoff); a parked (auth-failed) server is not revived by discovery until its
  credentials change; a `tools/list_changed` notification re-registers tools.
- **Surprising:** a stdio server whose native addon was built for another Node ABI
  is diagnosed by name ("rebuild under Hermes' Node") rather than reported as a
  generic crash.

#### `tests/tools/test_tool_search.py` (35 KB, 41 cases)
- **Purpose:** progressive tool disclosure — the model asks for a tool by name
  instead of carrying every schema.
- **Key abstractions:** the deferral modes (`auto` / a list / `false`), the index,
  `tool_describe`.
- **Data flow:** a `tool_search` call → a scored index hit → a deferred tool is
  registered → the model calls it.
- **Non-obvious decisions:** the default is the **registered list**; a user list
  replaces it. Deferred tools are not described to the model until they are
  searched for.
- **Edge cases:** the gate is provider-aware — a provider with a small context
  window activates it sooner.
- **Surprising:** multi-query search with stemming is a first-class mode, because a
  model that knows "the tool is called X" should not have to guess the exact token.

#### `tests/tools/test_file_write_safety.py` (49 KB, 69 cases)
- **Purpose:** the write sandbox: `HERMES_WRITE_SAFE_ROOT`, deny lists, and the
  refusal copy.
- **Key abstractions:** the safe-root resolution, the deny list, the shadow-path
  checks.
- **Data flow:** a target path → resolve → safe-root check → deny-list check →
  write or refuse.
- **Non-obvious decisions:** the guard is **shape-based** as well as path-based: a
  path whose *shape* names a system location (`/etc/shadow`,
  `~/.ssh/authorized_keys`) is refused even if it is not literally under a denied
  prefix.
- **Edge cases:** a temp file is allowed by default; a symlink-shaped path is
  refused; a look-alike outside the home is not refused (a false positive is worse
  than a false negative here).
- **Surprising:** the same write gate also refuses *binary document* targets
  (`test_binary_document_write_guard.py`) because a plain-text write can never
  produce a valid OOXML/PDF payload — refusing it stops silent corruption.

### 1.2 What the set as a whole does

Read as a whole, `tests/agent/` and `tests/tools/` are **Hermes' executable
specification**, and they have a shape that is worth stealing:

**1. The docstring is the design document.** Almost every file opens with a
paragraph naming the *incident* — a GitHub issue number, a user's report, a
production date — and then states the contract in the present tense ("the fix
rides the existing ack-continuation path", "the guard exists to stop the
empty-retry loop re-billing large inputs"). A reader who has never seen the code
can reconstruct *why* the assertion exists. This is the single highest-value
property of the shard: the tests double as the changelog of the system's
hard-won knowledge.

**2. Fail-open is a named, tested stance.** The classifiers, the redaction layer,
the memory manager, the approval gate and the tool registry all state what they do
when they do not understand the input. `test_error_classifier.py` treats an
unrecognised provider body as retryable, never as a silent abort. `test_redact.py`
asserts on *absence* of a secret, never on a mask format, so the mask can change.
`test_memory_provider.py` spills an oversized prefetch rather than injecting it.

**3. Every irreversible action has a receipt.** A tool call is persisted before it
runs (`test_tool_call_incremental_persistence.py`). A credential rotation is
write-through to disk before it is reported as success
(`test_anthropic_credential_persist_failure.py` — a spent refresh token that was
never committed stays unusable). A compaction commit is stamped durable before the
next flush (`test_in_place_persist_marker.py`). A skill mutation lands in a ledger
with its "before" bytes (`test_skill_ledger.py`). The recurring pattern is:
**commit first, then report**.

**4. There is a single owner for every concept, and the tests say who it is.**
`agent/backend_identity.py` owns "same backend?"; `agent/error_classifier.py` owns
"what kind of failure?"; `agent/message_sanitization.py` owns the call-id and
reasoning policies; `agent/redact.py` owns secret masking;
`tools/tool_result_storage.py` owns tool-result persistence. The test files say so
explicitly ("audit F4 consolidation: agent/message_sanitization.py now owns…"), and
`test_backend_identity.py` says the tests live *at the predicate*, not at the call
sites, so a new call site cannot re-derive the rule. That is the opposite of
August Trading's current state, where several modules each hold part of a policy.

**5. The tests are adversarially framed.** Many are written as "the bug that
shipped", not "the feature that exists": `test_message_sequence_repair.py` exists
because a tool result followed by a user message produced silent empty responses;
`test_credential_pool_sole_rotate_recovery.py` exists because a rotation that
returned the credential it had just benched looped at ~2 req/s for hours;
`test_compression_rotation_state.py` exists because a `/goal` silently died at the
compaction boundary. The naming convention is a gift: the file name tells you the
failure mode, so a reader can grep for "what broke".

**6. The blast radius is measured, not asserted.** `test_context_compressor.py`
counts tool-call envelopes; `test_canon_args_memo_parity.py` proves the
`json.loads` count is *linear* rather than quadratic;
`test_background_review_cache_parity.py` quotes a measured 26 % saving;
`test_oneshot_footprint.py` reports "7 skills created and 37 of ~215 tool calls
spent on skill_view/skill_manage" across 21 one-shot trajectories. Performance and
cost regressions are treated as correctness.

**7. Cross-cutting invariants are pinned by dedicated files.**
`test_cross_profile_guard.py`, `test_multiplex_tool_cache_scope.py`,
`test_secret_scope*.py`, `test_profile_home_override_precedence.py` and
`test_credential_pool_provider_boundary.py` all assert the same law in different
places: *a value scoped to one profile/session must never be read by another*.
This is the shape August Trading needs most, because its services run in one
Electron process and the "who owns this state" question is answered nowhere.

**8. The set is enormous but it is not a mess.** 1 860 files, ~18 MB, in two
directories, with a naming convention that carries the intent
(`test_<subject>_<what_pins_it>.py`), a consistent docstring shape, and
deliberate size ratchets (`test_run_agent_interrupt_hook.py` says it was "split out
of tests/agent/test_run_agent.py (code-health size ratchet)"). The discipline is
visible in the file organisation itself.

### 1.3 Tier 2 - per-file ledger (1828 rows, one per file)




| `tests/agent/__init__.py` | Helper/fixture module (no test cases of its own). |
| `tests/agent/conftest.py` | Fast-path fixtures shared across tests/agent/. Many tests in this directory exercise the retry/backoff paths in the agent loop. |
| `tests/agent/lsp/__init__.py` | Pytest helpers for LSP-related tests. |
| `tests/agent/lsp/_mock_lsp_server.py` | Helper script / fixture module (not a pytest module). |
| `tests/agent/lsp/test_backend_gate.py` | Integration test: LSP layer is skipped on non-local backends. The host-side LSP server can't see files inside a Docker/Modal/SSH sandbox. |
| `tests/agent/lsp/test_broken_set.py` | Tests for the broken-set short-circuit added to handle outer-timeout failures. |
| `tests/agent/lsp/test_client_e2e.py` | End-to-end client tests against the in-process mock LSP server. |
| `tests/agent/lsp/test_compound_extensions.py` | Compound extensions (`.blade.php`) route to their own server; the last segment alone keeps its server. |
| `tests/agent/lsp/test_custom_servers.py` | Config-declared LSP servers (`lsp.servers.<id>` with `extensions`) route files and spawn like built-ins. |
| `tests/agent/lsp/test_delta_key.py` | Tests for cross-edit LSP delta filtering. The delta-filter contract spans three pieces: 1. |
| `tests/agent/lsp/test_diagnostics_field.py` | Tests for the `lsp_diagnostics` field on WriteResult / PatchResult. |
| `tests/agent/lsp/test_eventlog.py` | Tests for the structured logging dedup model. The contract: a 1000-write session in one project should emit exactly ONE INFO line ("active for <root>") at the defaul… |
| `tests/agent/lsp/test_incremental_unicode.py` | The server's document mirror must match disk after each incremental replacement. |
| `tests/agent/lsp/test_install_and_lint_fixes.py` | Tests for follow-up fixes to the LSP integration (PR after #24168). Covers: 1. |
| `tests/agent/lsp/test_lifecycle.py` | Tests for service-singleton lifecycle: atexit handler, idempotent shutdown. |
| `tests/agent/lsp/test_manager_locking.py` | Concurrency invariants for the LSP service state lock. |
| `tests/agent/lsp/test_multi_root.py` | Multi-root servers share ONE process across project roots. A profiled session with subagents editing across ~30 git worktrees ran 30-60 pyright processes. |
| `tests/agent/lsp/test_nested_root_current_diagnostics.py` | _current_diags_async` must find a single-root client under the root it was spawned with. |
| `tests/agent/lsp/test_powershell_server.py` | Tests for the PowerShellEditorServices (PSES) server registration. |
| `tests/agent/lsp/test_protocol.py` | Tests for the LSP protocol framing layer. The framer is small but load-bearing — Content-Length parsing is the single most common reason for hand-rolled LSP clients … |
| `tests/agent/lsp/test_python_discovery.py` | Pyright uses the project environment before the Hermes runtime fallback. |
| `tests/agent/lsp/test_reporter.py` | Tests for the diagnostic reporter (formatting layer). |
| `tests/agent/lsp/test_root_policy.py` | Per-root policy knobs of :class:`LSPService` (#116446): `lsp.exclude_roots` gates a workspace off without disabling the server fleet-wide, and `lsp.warmup_timeout… |
| `tests/agent/lsp/test_service.py` | Tests for the synchronous LSPService wrapper. Drives the service through `snapshot_baseline` → `get_diagnostics_sync` against the mock LSP server, exercising the… |
| `tests/agent/lsp/test_shell_linter_lsp_skip.py` | Skip the per-file shell linter when LSP will handle the same file. |
| `tests/agent/lsp/test_stale_diagnostics.py` | Regression tests for the "ghost diagnostics" staleness bug. |
| `tests/agent/lsp/test_versionless_push_during_send.py` | A versionless publishDiagnostics read while didChange is still being written must count as fresh. |
| `tests/agent/lsp/test_vue_server.py` | Tests for the Vue server registration. `@vue/language-server` 3.x only works behind a client-hosted tsserver tunnel (`tsserver/request` notifications) that Herme… |
| `tests/agent/lsp/test_windows_binary_resolution.py` | Windows binary resolution must prefer the runnable `.cmd`/`.exe`/`.bat` wrapper over npm's POSIX `#!/bin/sh` shim, which shares the bare name and fails `Cre… |
| `tests/agent/lsp/test_workspace.py` | Tests for workspace + project-root resolution. |
| `tests/agent/lsp/test_workspace_release.py` | Workspace-scoped teardown: removed worktrees and deleted roots must not keep language servers alive. |
| `tests/agent/lsp/test_workspace_trust.py` | Nothing a checkout ships runs unless the operator trusts that workspace. |
| `tests/agent/lsp/test_write_never_waits_on_lsp.py` | Invariant: a write never waits on the language server, and its diagnostics still reach the model (the session that made the edit, and only that session). |
| `tests/agent/metadata_transport.py` | Socket-free response data for tests that exercise the real metadata transport. |
| `tests/agent/repro_image_shrink_brick.py` | Runnable proof for issue #48013 — image-dimension 400 session brick. |
| `tests/agent/test_413_compression.py` | Tests for payload/context-length → compression retry logic in AIAgent. |
| `tests/agent/test_413_image_payload_recovery.py` | Regression tests: HTTP 413 recovery must score progress in BYTES. |
| `tests/agent/test_860_dedup.py` | Tests for issue #860 — SQLite session transcript deduplication. Verifies that: 1. _flush_messages_to_session_db uses _last_flushed_db_idx to avoid re-writing 2. |
| `tests/agent/test_account_policy_block.py` | An upstream account ban relayed as HTTP 200 + an SSE `error` event is permanent. |
| `tests/agent/test_account_usage.py` | Covers test codex usage prefers explicit live agent credentials; test codex usage falls back to native credential pool; test codex weekly only primary window is labeled weekly |
| `tests/agent/test_account_usage_fetch.py` | Covers test fetch account usage codex; test fetch account usage reaches registered plugin profile and fails open; test fetch account usage prefers builtin fetcher over profile |
| `tests/agent/test_account_usage_pool_fetch.py` | Real-path source parsing and routing for per-credential usage fetches. |
| `tests/agent/test_acp_openai_bridge.py` | The ACP text bridge is what makes Hermes' own tools reachable on an ACP provider. |
| `tests/agent/test_acp_provider_rails.py` | Two core decisions must key on the `acp://` scheme, not on one vendor. |
| `tests/agent/test_activity_persist_off_relay_loop.py` | A managed worker's activity heartbeat must not reach the synchronous persistence RPC on Relay's event loop (#139029). |
| `tests/agent/test_actual_auxiliary_routing.py` | Actual background tasks exercise the same configured route as foreground chat. |
| `tests/agent/test_affordable_402_main_loop.py` | Main-loop credit-limited 402: retry once with the affordable output cap (#49769). |
| `tests/agent/test_agent_guardrails.py` | Unit tests for AIAgent pre/post-LLM-call guardrails. |
| `tests/agent/test_anthropic_adapter.py` | Tests for agent/anthropic_adapter.py — Anthropic Messages API adapter. |
| `tests/agent/test_anthropic_adapter_extra_headers.py` | Anthropic-messages clients honour `custom_providers[].extra_headers` (#24293, #9721). |
| `tests/agent/test_anthropic_billing_guidance.py` | Tests for the Anthropic-subscription branch of `agent.conversation_loop._billing_or_entitlement_message`. |
| `tests/agent/test_anthropic_borrowed_row_authority.py` | The borrowed `claude_code` row is a reference, never a token authority. |
| `tests/agent/test_anthropic_client_auth.py` | Auth-boundary shard for the Anthropic adapter. An api-key-style client must not inherit ANTHROPIC_AUTH_TOKEN from the environment: the SDK fills an unset `auth_toke… |
| `tests/agent/test_anthropic_credential_persist_failure.py` | Failure-injection coverage for the Anthropic refresh *commit* step. |
| `tests/agent/test_anthropic_dead_grant_hints.py` | Hermes credential hints and the Anthropic token-endpoint error shape (#113023). |
| `tests/agent/test_anthropic_external_login_optout.py` | auth.adopt_external_logins: false` keeps Hermes off the Claude Code login (#113023). |
| `tests/agent/test_anthropic_keychain.py` | Tests for Bug #12905 fixes in agent/anthropic_adapter.py — macOS Keychain support. |
| `tests/agent/test_anthropic_kimi_signed_thinking_replay.py` | Kimi-family endpoints don't need thinking blocks stripped on replay; DeepSeek does. |
| `tests/agent/test_anthropic_kwargs_sanitize.py` | Tests for sanitize_anthropic_kwargs (#31673). Guards the Anthropic Messages dispatch boundary against Responses-API-only kwargs (`instructions`, `input`, `store… |
| `tests/agent/test_anthropic_mcp_prefix_strip.py` | Tests for GH-25255: Anthropic OAuth `mcp__` tool-name round-trip. |
| `tests/agent/test_anthropic_message_stop.py` | Regression coverage for incomplete native Anthropic Messages streams (#121320). |
| `tests/agent/test_anthropic_mid_tool_call_drop.py` | The Anthropic streaming path must not accept a tool_use block whose stream died before its input arrived (#80498 sibling). |
| `tests/agent/test_anthropic_model_cooldowns.py` | A generic Anthropic 429 benches only the model that was rate-limited (#111769, #61451). |
| `tests/agent/test_anthropic_oauth_pkce.py` | Regression tests for the Anthropic OAuth PKCE flow. Guards against re-introducing the bug where the PKCE `code_verifier` was reused as the OAuth `state` paramete… |
| `tests/agent/test_anthropic_oauth_stress.py` | Load / stress test for the Anthropic OAuth cross-process refresh race fix. |
| `tests/agent/test_anthropic_oauth_ua_prefix.py` | Regression tests for the OAuth User-Agent header in anthropic_adapter.py. |
| `tests/agent/test_anthropic_output_field_leak.py` | Regression: output-only SDK fields must not leak into Anthropic request input. |
| `tests/agent/test_anthropic_owned_routing.py` | Owned OAuth must win without rotating an unrelated borrowed grant. |
| `tests/agent/test_anthropic_preserved_thinking_replay.py` | Assistant row carrying the same thinking in every field the stores write. |
| `tests/agent/test_anthropic_prompt_cache_policy.py` | Tests for AIAgent._anthropic_prompt_cache_policy(). The policy returns `(should_cache, use_native_layout)` for five endpoint classes. |
| `tests/agent/test_anthropic_request_blank_block_guard.py` | Regression: the final Anthropic request must carry no blank text block. |
| `tests/agent/test_anthropic_request_client_reuse.py` | Per-request Anthropic wire client reuse across sequential LLM calls. |
| `tests/agent/test_anthropic_route_oauth_identity.py` | A `key_cmd` Claude Code OAuth token keeps its OAuth identity on native api.anthropic.com routes (#114967). |
| `tests/agent/test_anthropic_signed_platform_replay.py` | Signed thinking reaches the wire wherever the upstream can verify it, and only there. |
| `tests/agent/test_anthropic_spent_rotation_verdict.py` | A rotation that was consumed but never committed must stay unusable. |
| `tests/agent/test_anthropic_stream_fallbacks.py` | Invariants: Anthropic stream failures fall back or stub in a shape the loop accepts. |
| `tests/agent/test_anthropic_structured_output.py` | Structured-output translation for Anthropic auxiliary calls. |
| `tests/agent/test_anthropic_thinking_block_order.py` | Regression test for the Anthropic interleaved thinking-block 400. |
| `tests/agent/test_anthropic_thinking_disable.py` | Thinking off' on the native Anthropic Messages wire. Adaptive Claude models (4.6+) think by DEFAULT. |
| `tests/agent/test_anthropic_third_party_oauth_guard.py` | Tests for `_is_anthropic_oauth` guard against third-party Anthropic-compatible providers. |
| `tests/agent/test_anthropic_token_scope_isolation.py` | Regression tests: resolve_anthropic_token() must honour the profile secret scope. |
| `tests/agent/test_anthropic_truncation_continuation.py` | Regression test for anthropic_messages truncation continuation. |
| `tests/agent/test_anthropic_whitespace_text_blocks.py` | Regression: whitespace-only text blocks must be coerced, not sent verbatim. Reproduces HTTP 400 `messages: text content blocks must contain non-whitespace text`. |
| `tests/agent/test_api_content_row_addressed_backfill.py` | Row-addressed `api_content` backfill (NousResearch/hermes-agent#102194). |
| `tests/agent/test_api_content_sidecar.py` | Tests for the `api_content` sidecar ("persist what you send"). |
| `tests/agent/test_api_max_retries_config.py` | Tests for agent.api_max_retries config surface. Closes #11616 — make the hardcoded `max_retries = 3` in the agent's API retry loop user-configurable so fallback-pr… |
| `tests/agent/test_arcee_trinity_overrides.py` | Tests for Arcee Trinity Large Thinking per-model overrides. |
| `tests/agent/test_astra_baseline_runtime.py` | Focused real-path coverage for the GPT-6 Astra baseline contract. |
| `tests/agent/test_astra_oauth_native_compaction.py` | gpt-6-astra (and its `-900k` picker alias) is native-compaction eligible only on official Codex OAuth (#103720). |
| `tests/agent/test_async_httpx_del_neuter.py` | Tests for the AsyncHttpxClientWrapper.__del__ neuter fix. |
| `tests/agent/test_async_token_accounting.py` | Async token accounting — SessionDB background writer queue. |
| `tests/agent/test_async_utils.py` | Tests for agent.async_utils.safe_schedule_threadsafe. |
| `tests/agent/test_auth_provider_failover.py` | Auth-failure provider failover (conversation loop). A 401/403 that survives the per-provider credential-refresh attempt (revoked OAuth, blocked/expired key, an accou… |
| `tests/agent/test_aux_affordable_402_retry.py` | Credit-limited 402 handling: clamp to the affordable budget and retry. |
| `tests/agent/test_aux_custom_endpoint_headers.py` | The aux client's anonymous custom arm (`provider: custom` + a base URL) sends the `extra_headers` of the custom provider entry whose base URL is that endpoint, a… |
| `tests/agent/test_aux_progress_streaming.py` | Tests for the auxiliary forward-progress streaming layer. |
| `tests/agent/test_aux_relay_progress_seam.py` | Every relay attempt (retries, recovery rungs, fallbacks) streams through the progress hook (#98466). |
| `tests/agent/test_aux_session_endpoint_affinity.py` | Auxiliary routing sticks to the session's configured OpenAI endpoint; a rejection elsewhere is not a dead key. |
| `tests/agent/test_aux_stream_host_deadline.py` | 99692 — the streamed auxiliary summary must not outlive its compression host. |
| `tests/agent/test_aux_stream_host_deadline_sibling_wires.py` | 99692 sibling wires — the host compression deadline must stop EVERY aux stream consumer, not only the chat.completions accumulator. |
| `tests/agent/test_auxiliary_anthropic_pool_fallback_regression.py` | Regression: _try_anthropic() must fall back to the legacy token resolver when the credential pool is present but has no usable entry. |
| `tests/agent/test_auxiliary_auth_rung_fallthrough.py` | The auxiliary recovery ladder must not let a failed auth-refresh retry escape. |
| `tests/agent/test_auxiliary_auto_never_guesses_provider.py` | auxiliary.*.provider: auto` never bills a provider the user did not select. |
| `tests/agent/test_auxiliary_auto_route_xai_oauth_refresh.py` | Auto-routed auxiliary calls on xAI OAuth refresh the grant after a 403 bad-credentials (#84845). |
| `tests/agent/test_auxiliary_client.py` | Tests for agent.auxiliary_client resolution chain, provider overrides, and model overrides. |
| `tests/agent/test_auxiliary_client_anthropic_custom.py` | Tests for agent.auxiliary_client._try_custom_endpoint's anthropic_messages branch. |
| `tests/agent/test_auxiliary_client_azure_foundry.py` | Tests for auxiliary client routing of the `azure-foundry` provider. |
| `tests/agent/test_auxiliary_client_base_url_host_validation.py` | Regression tests for issue #52608. auxiliary_client `_try_anthropic()` must NOT apply `cfg["model"]["base_url"]` when the configured base_url host is not an Anthropi… |
| `tests/agent/test_auxiliary_client_bootstrap_skew.py` | Regression for #64333 — auxiliary client must survive a version-skewed agent.process_bootstrap that lacks build_keepalive_http_client. |
| `tests/agent/test_auxiliary_client_cache_eviction.py` | Regression coverage for provider-scoped auxiliary cache eviction (#113022). |
| `tests/agent/test_auxiliary_client_cache_follows_credential.py` | Regression coverage: the auxiliary client cache key follows the pooled credential (#113022). |
| `tests/agent/test_auxiliary_client_minimax_oauth.py` | Regression: `resolve_provider_client("minimax-oauth", ...)` must build a refresh-capable Anthropic auxiliary client, not silently return (None, None). |
| `tests/agent/test_auxiliary_client_nous_401_cache_key.py` | A Nous 401 refresh must replace the auxiliary client under the SAME cache key `call_llm` acquired it with (model dimension #56889, task dimension #58894). |
| `tests/agent/test_auxiliary_client_proxy_env.py` | Regression guard: auxiliary OpenAI clients must use env-only proxy policy. |
| `tests/agent/test_auxiliary_client_resolve_dedup.py` | Tests for resolve_provider_client fall-through log dedup (salvage #56283). |
| `tests/agent/test_auxiliary_client_ssl_verify.py` | Regression: auxiliary-client keepalive httpx client must honor custom CA bundles. |
| `tests/agent/test_auxiliary_client_xai_oauth_recovery.py` | Tests for xAI OAuth 403 error recovery in auxiliary_client. |
| `tests/agent/test_auxiliary_codex_completion_status.py` | Auxiliary Responses normalization must not certify a partial checkpoint. |
| `tests/agent/test_auxiliary_compression_timeout_floor.py` | Regression tests for the compression-scoped auxiliary timeout floor (#54915). Context compression summarises large conversation histories. |
| `tests/agent/test_auxiliary_concurrency.py` | Tests for per-task concurrency limiting on auxiliary LLM calls (#23324). |
| `tests/agent/test_auxiliary_error_classification.py` | Auxiliary error classification shares the main classifier's billing table and labels quarantines truthfully. |
| `tests/agent/test_auxiliary_explicit_base_anthropic.py` | Tests for resolve_provider_client's `custom` + `explicit_base_url` branch when the endpoint speaks Anthropic Messages. |
| `tests/agent/test_auxiliary_explicit_cancellation.py` | Deterministic cross-thread cancellation tests for compression aux transports. |
| `tests/agent/test_auxiliary_fallback_multihop.py` | Auxiliary `provider: auto` fallback walk is multi-hop (#106367). |
| `tests/agent/test_auxiliary_hooks.py` | pre_auxiliary_call` / `post_auxiliary_call` fire for auxiliary LLM calls (#79733). |
| `tests/agent/test_auxiliary_main_first.py` | Regression tests for the `auto` → main-model-first policy. |
| `tests/agent/test_auxiliary_named_custom_providers.py` | Tests for named custom provider and 'main' alias resolution in auxiliary_client. |
| `tests/agent/test_auxiliary_ollama_local_provider.py` | Explicit `provider: ollama` (and the sibling local-server aliases `vllm` / `llamacpp`) must route through the `custom` branch in the auxiliary client, as it … |
| `tests/agent/test_auxiliary_opencode_routing.py` | Auxiliary clients for OpenCode Zen/Go follow the per-model wire table the main runtime uses (#98799). |
| `tests/agent/test_auxiliary_openrouter_max_tokens.py` | Test that _build_call_kwargs preserves max_tokens for OpenRouter endpoints. |
| `tests/agent/test_auxiliary_parameter_rung_chaining.py` | Auxiliary parameter-rejection rungs chain in any order, on the primary AND the fallback path. |
| `tests/agent/test_auxiliary_provider_supplied_client.py` | Auxiliary `api_key` routes honor `ProviderProfile.create_client()` — parity with the main agent. |
| `tests/agent/test_auxiliary_reasoning_catalog_floor.py` | The route's model catalog decides the title lane's first request (no guaranteed 400 on mandatory routes). |
| `tests/agent/test_auxiliary_reasoning_field_rejection_retry.py` | Reasoning-field rejection retry in `agent.auxiliary_client` (#112781). |
| `tests/agent/test_auxiliary_reasoning_floor.py` | Reasoning-required rejection → step the aux effort up to the floor and remember the route. |
| `tests/agent/test_auxiliary_relay.py` | Covers test auxiliary retries share logical relay identity; test auxiliary provider fallback closes one real logical call; test auxiliary provider fallback records one terminal model route |
| `tests/agent/test_auxiliary_runtime_cache_key.py` | Regression coverage for implicit live-runtime auxiliary cache keys. |
| `tests/agent/test_auxiliary_structured_output.py` | Structured-output (`response_format`) handling on auxiliary routes that reject it. |
| `tests/agent/test_auxiliary_title_timeout_bound.py` | Auto-title timeouts are bounded by ONE `auxiliary.title_generation.timeout` window and named as timeouts (#89445, #66251). |
| `tests/agent/test_auxiliary_transient_retry.py` | Per-model client-cache isolation: two concurrent auxiliary calls to the same provider/base_url/key but DIFFERENT models (e.g. |
| `tests/agent/test_auxiliary_transport_autodetect.py` | Tests for transport auto-detection in agent.auxiliary_client. |
| `tests/agent/test_auxiliary_unavailable_nous_reason.py` | The goal judge names a Nous auxiliary auth failure instead of an opaque judge error (#42177). |
| `tests/agent/test_auxiliary_user_default_headers.py` | Tests for user-configured `model.default_headers` in the auxiliary client. |
| `tests/agent/test_auxiliary_wire_messages.py` | The final auxiliary destination owns message sanitation, not virtual MoA. |
| `tests/agent/test_azure_identity_adapter.py` | Tests for the Microsoft Entra ID adapter (agent/azure_identity_adapter.py). |
| `tests/agent/test_backend_identity.py` | Owner-level tests for agent.backend_identity. This module is the single owner of the "same backend?" question — tests live HERE, against the predicate, not against e… |
| `tests/agent/test_background_review_cache_parity.py` | Tests that the background review fork inherits the parent's cached system prompt. |
| `tests/agent/test_background_review_cost_controls.py` | Unit coverage for the background-review aux-model selector + routed digest. |
| `tests/agent/test_background_review_input_budget.py` | Regression tests for the background-review aggregate input budget (#93057). The review fork replays its snapshot on every provider request in its tool loop. |
| `tests/agent/test_background_review_list_shapes.py` | Regression tests for the list-shape AttributeError guards in `agent.background_review.summarize_background_review_actions` (#59437). |
| `tests/agent/test_background_review_memory_scope.py` | The review fork's memory access must follow the trigger that fired (#105921). |
| `tests/agent/test_background_review_routed_effort.py` | Routed background reviews honor `auxiliary.background_review.reasoning_effort` (#94825). The review fork is a full AIAgent, not an auxiliary_client call. |
| `tests/agent/test_background_review_summary.py` | Tests for AIAgent._summarize_background_review_actions. |
| `tests/agent/test_background_review_tool_call_guard.py` | The background-review fork must not spawn when it could only no-op. |
| `tests/agent/test_background_review_toolset_restriction.py` | Tests that the background review agent restricts tools at runtime, not at schema time. |
| `tests/agent/test_background_review_usage.py` | Background-review usage attribution (issue #87250). Background-review forks run with `_session_db = None` (persistence isolation), so their provider-billed API cal… |
| `tests/agent/test_battery.py` | Behavior tests for the status-bar battery helper (agent/battery.py). |
| `tests/agent/test_bedrock_1m_context.py` | Tests for the 1M-context beta header on AWS Bedrock Claude models. |
| `tests/agent/test_bedrock_adapter.py` | Tests for the AWS Bedrock Converse API adapter. Covers: - AWS credential detection and region resolution - Message format conversion (OpenAI → Converse and back) - T… |
| `tests/agent/test_bedrock_context_cache.py` | Bedrock cache provenance and compressor budgets across disk-backed restarts. |
| `tests/agent/test_bedrock_converse_reasoning_replay.py` | Claude reasons on Bedrock Converse, and each Converse model gets back only the reasoning it can take. |
| `tests/agent/test_bedrock_credential_probe.py` | The AWS credential probe the provider ladder runs: one walk of boto3's chain per question, and no instance-metadata lookup from the desktop's own backend (a laptop, … |
| `tests/agent/test_bedrock_empty_text_blocks.py` | Regression tests for Bedrock Converse empty/whitespace text block rejection. |
| `tests/agent/test_bedrock_guardrail_claude_route.py` | bedrock.guardrail` must be enforced on the Claude route, not only Converse. |
| `tests/agent/test_bedrock_integration.py` | Integration tests for the AWS Bedrock provider wiring. |
| `tests/agent/test_bedrock_interrupt_post_worker.py` | Regression: /stop must not be swallowed on the Bedrock streaming path. Companion to the OpenAI/Anthropic streaming post-worker guard. |
| `tests/agent/test_bedrock_stream_completion.py` | Audit: actual boto3 HTTP/EventStream parsing before Hermes normalization. |
| `tests/agent/test_bedrock_transport_replay.py` | Production Bedrock transport/history replay regressions. |
| `tests/agent/test_billing_links.py` | Tests for provider-agnostic billing recovery links (agent/billing_links.py). |
| `tests/agent/test_billing_unverified_carrythrough.py` | 82154: an unverified billing verdict must carry its ambiguity through every downstream surface — the returned terminal response, the structured result fields, the cr… |
| `tests/agent/test_billing_usage.py` | Tests for the shared dollar usage model (agent/billing_usage.py). |
| `tests/agent/test_billing_view.py` | Unit tests for the Phase 2b Remote Spending core + HTTP client. Covers: - Decimal money parsing/formatting (server emits decimal strings, not 2dp). |
| `tests/agent/test_bitwarden_secrets.py` | Hermetic tests for the Bitwarden Secrets Manager integration. Secret/cache behavior stays offline. |
| `tests/agent/test_bot_chat_toolset_refresh.py` | 124211: a Bot Chat capability refresh must rebuild tools[] through the surface's own builder (what a fresh desktop/TUI session gets), not just the system prompt. |
| `tests/agent/test_bot_profile_prompt_isolation.py` | Regression: a bot profile's system prompt must reflect ITS OWN skills/home, never the launch (default) profile's — even when the agent build runs on a thread that di… |
| `tests/agent/test_bounded_response.py` | Tests for bounded reads of streaming HTTP error response bodies. |
| `tests/agent/test_budget_reasoning_details_exclusion.py` | Regression tests for #73298 (second site): the tail-budget walk must not charge the signed/base64 `reasoning_details` envelope at chars/4. |
| `tests/agent/test_builtin_memory_disabled_surface.py` | Built-in memory disabled in config must leave no dead surface behind. |
| `tests/agent/test_cache_disabled_on_stubs.py` | Regression for #76085: prompt_caching.cache_ttl off on stub policy paths. |
| `tests/agent/test_callable_api_key.py` | Tests that callable api_key (Entra ID bearer provider) flows through the agent stack without coercion. |
| `tests/agent/test_canon_args_memo_parity.py` | Byte-parity + complexity proof for the memoized send-path tool-call argument canonicalization (agent/conversation_loop.py). |
| `tests/agent/test_capability_probe_credentials.py` | Capability probes materialize credentials without consuming the chat source. |
| `tests/agent/test_cascading_interrupt.py` | Regression guard for the cascading-interrupt hang (PR #6600). |
| `tests/agent/test_chat_completion_helpers_provider_sort.py` | Covers test validated openrouter provider sort accepts valid values; test validated openrouter provider sort rejects invalid values |
| `tests/agent/test_chat_completion_helpers_tool_calls.py` | Slot assignment of streamed tool-call deltas whose id changes at a reused index. |
| `tests/agent/test_chat_sdk_transform_bypass.py` | Chat-completions request-transform bypass (#93650 extended to chat.completions). |
| `tests/agent/test_cjk_token_estimation.py` | Covers test message estimate counts korean content as token dense; test cjk tail does not expand to english char budget; test perf gated estimator matches per char reference |
| `tests/agent/test_claude_code_version_path.py` | Claude Code version detection must see the CLI from a GUI-launched process. |
| `tests/agent/test_close_interrupted_tool_sequence.py` | Regression tests for `close_interrupted_tool_sequence` (#48879 follow-up). |
| `tests/agent/test_codex_app_server_compaction.py` | Covers test codex app server native auto mode leaves thread compaction to codex; test codex app server compaction heartbeat refreshes activity while waiting; test codex app server compression failure preserves bookkeeping |
| `tests/agent/test_codex_app_server_event_bridge.py` | Regression tests for the codex_app_server → Hermes UI event bridge. |
| `tests/agent/test_codex_app_server_integration.py` | Integration test for the codex_app_server runtime path through AIAgent. |
| `tests/agent/test_codex_app_server_lifecycle.py` | Codex app-server session lifecycle on hard agent teardown (#65260). |
| `tests/agent/test_codex_app_server_persist.py` | Regression for #49225 — codex app-server turns must reach the session DB exactly once. |
| `tests/agent/test_codex_app_server_thread_resume.py` | 100531 — the codex app-server thread survives an AIAgent rebuild (API-server restart, per-request agents). |
| `tests/agent/test_codex_aux_no_progress_timeout.py` | Progress-aware deadlines for the Codex auxiliary Responses stream. |
| `tests/agent/test_codex_aux_timeout_fd_ownership.py` | Regression: the timeout watchdog must not release the client's FDs. |
| `tests/agent/test_codex_cloudflare_headers.py` | Regression coverage for required Codex identity and account headers. |
| `tests/agent/test_codex_echo_ownership.py` | The accepted input owns its row; transport echoes do not own new rows. |
| `tests/agent/test_codex_first_event_timing.py` | Covers test codex stream records first lifecycle event before text; test codex stream without accepted event keeps timing unset |
| `tests/agent/test_codex_gpt55_autoraise_notice.py` | Regression tests for the Codex gpt-5.x autoraise notice gate. Covers two layers: 1. |
| `tests/agent/test_codex_happy_eyeballs.py` | Covers test codex sync client uses happy eyeballs backend; test other sync clients keep httpcore default backend; test connection staggers past blackholed ipv6 |
| `tests/agent/test_codex_incomplete_budget_escalation.py` | Responses-wire `status=incomplete` continuation must change the request when reasoning consumed the whole output budget (#90393): a retry with the same `max_outpu… |
| `tests/agent/test_codex_model_entitlement_rotation.py` | A Codex ChatGPT-account model entitlement 400 rotates to the next pool credential (#71970). |
| `tests/agent/test_codex_multimodal_tool_result.py` | Tests for codex_responses_adapter multimodal tool-result handling. |
| `tests/agent/test_codex_no_tools_nonetype.py` | Regression coverage for #32892. The openai SDK's `responses.stream()` / `responses.parse()` eagerly call `_make_tools(tools)`, which iterates `tools` *withou… |
| `tests/agent/test_codex_reasoning_only_streak.py` | Codex Responses reasoning-only stall recovery (#67321). |
| `tests/agent/test_codex_request_compression.py` | Codex Responses bodies go out zstd-compressed to the official backend only (official-client parity). |
| `tests/agent/test_codex_request_transport_diagnostics.py` | Diagnostics for Codex Responses transport failures. |
| `tests/agent/test_codex_responses_adapter.py` | Covers test responses wire tools preserve explicit boolean strictness; test chat content drops images from assistant role; test chat content keeps images on user role |
| `tests/agent/test_codex_responses_settle_pending_tool_calls.py` | Regression: settle pending function calls when a Responses stream completes successfully without `response.output_item.done`. |
| `tests/agent/test_codex_runtime_history_seed.py` | A codex app-server thread started from scratch is seeded with the session's prior turns (#26035, #74712). Direction from #26081 (@LeonSGP43). |
| `tests/agent/test_codex_runtime_live_events.py` | Regression tests for live Codex app-server events. The history projector is completion-only. |
| `tests/agent/test_codex_runtime_prompt_handoff.py` | The codex_app_server runtime hands Hermes' composed system prompt to the codex thread (#74712, #26035). |
| `tests/agent/test_codex_sdk_transform_bypass.py` | Regression tests for the SDK request-transform bypass (#93650). |
| `tests/agent/test_codex_service_tiers.py` | Selected-credential speed ceiling regression for #135024 (no live accounts). |
| `tests/agent/test_codex_soft_failure_pool_rotation.py` | Codex Responses HTTP-200 soft failures (`response.status == "failed"`) must reach the same-provider credential pool before cross-provider fallback (#24159). |
| `tests/agent/test_codex_stream_rotating_item_ids.py` | Copilot rotates opaque item IDs within a call; output_index remains stable. |
| `tests/agent/test_codex_stream_supersession.py` | A Codex Responses stream that loses the delta sink to a newer attempt keeps consuming (#69486). |
| `tests/agent/test_codex_token_expired_replay_recovery.py` | A persisted Codex session must not loop on 401 `token_expired` when the credential is fine. |
| `tests/agent/test_codex_ttfb_watchdog.py` | Regression tests for the Codex TTFB (first parsed stream event) watchdog. |
| `tests/agent/test_codex_usage_attribution.py` | Exercise required Codex attribution through real SDK request construction. |
| `tests/agent/test_codex_watchdog_reasoning_effort.py` | Codex non-stream watchdogs honour the request's reasoning effort (#112909). |
| `tests/agent/test_codex_xai_oauth_recovery.py` | Regression tests for the May 2026 xAI OAuth (SuperGrok / X Premium) bugs. Three distinct failure modes the user community hit during rollout: 1. |
| `tests/agent/test_coding_context.py` | Tests for agent.coding_context — RuntimeMode seam, resolver, toolset, git probe. |
| `tests/agent/test_coding_worktree_note.py` | A gateway-owned session opened in a linked git worktree gets the isolated-worktree guidance. |
| `tests/agent/test_command_secret_source.py` | E2E tests for the `command` secret source. These exercise the REAL resolution path: real helper shell scripts written to a temp dir (chmod +x), real `/bin/sh -c`… |
| `tests/agent/test_command_token_source.py` | key_cmd`: derive a provider API key by running a command. |
| `tests/agent/test_commit_memory_session_context_engine.py` | Regression tests for AIAgent.commit_memory_session. Issue #22394: commit_memory_session was calling MemoryManager.on_session_end but never ContextEngine.on_session_e… |
| `tests/agent/test_compaction_anti_thrash.py` | The anti-thrashing guard must actually fire. Two defects made it dead code: 1. |
| `tests/agent/test_compaction_events.py` | hermes.compaction` v1 records: one content-free record per history rewrite, on every path. |
| `tests/agent/test_compaction_ops_notification_anchor.py` | Operational notifications must not anchor compaction or auto-focus (#92703). |
| `tests/agent/test_compaction_prompt_rebuild.py` | Compaction ALWAYS rebuilds the system prompt from the live builder (#95681). |
| `tests/agent/test_compaction_redaction_boundaries.py` | Strict redaction at every compaction text boundary (issue #43666 item 2). |
| `tests/agent/test_compress_context_progress_timeout.py` | Progress-aware timeout around in-agent compress_context (#72016). |
| `tests/agent/test_compress_focus.py` | Tests for focus_topic flowing through the compressor. Verifies that _generate_summary and compress accept and use the focus_topic parameter correctly. |
| `tests/agent/test_compress_signal_leak.py` | Invariant: stale signal leak between consecutive compress_context calls. |
| `tests/agent/test_compressed_summary_metadata.py` | Regression tests for the compressed-summary metadata flag (#38389). |
| `tests/agent/test_compression_abort_state_reset.py` | Regression tests for #58630: every compression abort path must reset per-attempt in-place compaction state. |
| `tests/agent/test_compression_adoption_preserves_live_tail.py` | Regression: preflight durable-snapshot adoption must not drop the live turn's un-persisted user input. |
| `tests/agent/test_compression_anti_thrash_persistence.py` | Anti-thrash state must survive process restarts (#54923). |
| `tests/agent/test_compression_anti_thrash_recovery.py` | Anti-thrash recovery: the tripped guard must not be permanent (#14694). |
| `tests/agent/test_compression_attempt_effect.py` | Attempt telemetry names why a compression ran, what it changed, and how the summary was made. |
| `tests/agent/test_compression_attempt_lifecycle.py` | Attempt-lifecycle regression tests for #97488 / #96775. |
| `tests/agent/test_compression_attempt_ownership.py` | Attempt-ownership guards for overlapping compression attempts (#96634). |
| `tests/agent/test_compression_attempt_telemetry.py` | Covers test compression attempt telemetry is metadata only; test aux call telemetry records durations without content; test aux call telemetry records content free phase timings |
| `tests/agent/test_compression_auto_summary_fallback.py` | 116472: an `auto`-resolved compression summary model that fails (e.g. a proxy channel answering HTTP 200 with empty content) must fall back to the main model. |
| `tests/agent/test_compression_aux_fallback_authority.py` | Current-main regressions for #113322 / #130895 auxiliary compression fallback routing. |
| `tests/agent/test_compression_aux_fallback_route.py` | The aux-summary fallback must actually reach the main model (#123362). |
| `tests/agent/test_compression_boundary.py` | Tests for context compression boundary alignment. Verifies that _align_boundary_backward correctly handles tool result groups so that parallel tool calls are never s… |
| `tests/agent/test_compression_boundary_hook.py` | Test: the context engine is notified of a compression-boundary rollover. |
| `tests/agent/test_compression_budget_rearm.py` | Regression test for re-arming the compression budget after tool progress. |
| `tests/agent/test_compression_budget_refund.py` | Behavioral tests for provider-confirmed compression-budget rearming. |
| `tests/agent/test_compression_busy_steer_anchor.py` | Regression coverage for busy-steer preservation across compaction (#100053). |
| `tests/agent/test_compression_child_source.py` | A compression child is the same conversation as its parent: it keeps the parent's persisted source (`--source tool`, `oneshot`, an inherited `kanban`) instead … |
| `tests/agent/test_compression_closed_adoption.py` | Compression race at the flush chokepoint: a turn writing against a session already closed by compression must adopt the LIVE continuation tip instead of dying with `… |
| `tests/agent/test_compression_commit_fence_race.py` | Regression: out-of-order completion of overlapping `_compress_context` calls must not corrupt `_active_compression_commit_fence`. |
| `tests/agent/test_compression_concurrent_fork.py` | Regression: prevent transcript fork when two paths compress the same session_id. |
| `tests/agent/test_compression_config_defaults.py` | A failed config load hands `_parse_compression_config` `{}`; every key must fall back to DEFAULT_CONFIG, and an explicit `threshold_tokens: null` must stay the… |
| `tests/agent/test_compression_count_warning.py` | Regression for #36908: the repeated-compression warning must reach the TUI / gateway, not just CLI stdout. |
| `tests/agent/test_compression_fallback_budget.py` | Tests for #62452 — compression fallback timeout independence + escalating timeout cooldown. |
| `tests/agent/test_compression_feasibility.py` | Tests for _check_compression_model_feasibility() — warns when the auxiliary compression model's context is smaller than the main model's compression threshold. |
| `tests/agent/test_compression_interrupt_protection.py` | Regression for #23975: context compression must survive a mid-flight gateway interrupt. |
| `tests/agent/test_compression_last_assistant_anchor.py` | Compaction must not deactivate the just-delivered assistant reply (#118900). |
| `tests/agent/test_compression_lock_defer.py` | Lock-contended compression no-ops must soft-DEFER, never exhaust (#49874). |
| `tests/agent/test_compression_logging_session_context.py` | Regression: compaction must move the LOGGING session context with the id. |
| `tests/agent/test_compression_marker.py` | 121548: model-visible elision mints the non-imitable compression marker. |
| `tests/agent/test_compression_max_attempts_config.py` | compression.max_attempts — config-driven compression retry cap. |
| `tests/agent/test_compression_orphan_recovery.py` | Recovery for legacy compression parents with no continuation child. |
| `tests/agent/test_compression_persistence.py` | Tests for context compression persistence in the gateway. |
| `tests/agent/test_compression_progress.py` | Regression: detect compression progress by tokens, not just rows. |
| `tests/agent/test_compression_prompt_reading.py` | Compression leaves llama-server's prompt reading out of its total time limit. The limit (600 s by default) stops a summary that trickles out a token at a time. |
| `tests/agent/test_compression_refusal_restores_transcript.py` | Regression: a refused compression candidate hands back the original transcript. |
| `tests/agent/test_compression_review.py` | Regressions for the #76354 review of the compression timeout architecture. |
| `tests/agent/test_compression_rotation_state.py` | Compression rotation hardening — state-loss fixes at the compaction boundary. |
| `tests/agent/test_compression_small_ctx_threshold_floor.py` | Compression hygiene: small-context threshold floor, reasoning-trace exclusion, and bounded summary size. Covers the July 2026 compression tuning pass: 1. |
| `tests/agent/test_compression_stall_deterministic_fallback.py` | A repeated summary stall escalates to the deterministic fallback summary — #112420. |
| `tests/agent/test_compression_stall_fallback.py` | Compression falls back after an aborted (stalled) summary — #78981. |
| `tests/agent/test_compression_stall_interrupt.py` | Stall-interrupted preflight compression must persist a durable backoff. |
| `tests/agent/test_compression_supersession_split.py` | Candidate supersession must key on working attempts, not entry claims. |
| `tests/agent/test_compression_terminal_activity_persist.py` | Terminal compression activity stamps must reach the DURABLE activity projection. |
| `tests/agent/test_compression_timeout_terminal.py` | Host compression timeout terminates the turn before provider re-entry (#98722). |
| `tests/agent/test_compression_trigger_labels.py` | Each automatic compression entry point names itself in the attempt record. |
| `tests/agent/test_compression_worker_isolation.py` | Regressions for #76354 review F3/F4/F5 — worker isolation, durable lease cancellation, and session ContextVar repair. |
| `tests/agent/test_compressor_actionable_tail_anchor.py` | Regression tests for blank user echoes displacing actionable compaction state. |
| `tests/agent/test_compressor_assistant_tail_anchor.py` | Covers test skips assistant role context summary marker; test multimodal text block counts; test respects head end lower bound |
| `tests/agent/test_compressor_fallback_update.py` | Tests that _try_activate_fallback updates the context compressor. |
| `tests/agent/test_compressor_historical_media.py` | Tests for post-compression historical-media stripping. Port of Kilo-Org/kilocode#9434 (adapted for OpenAI-style message lists). |
| `tests/agent/test_compressor_image_tokens.py` | Tests for image-token accounting in the context compressor. |
| `tests/agent/test_compressor_media_stripping.py` | Tests for MEDIA directive stripping in context compaction (#14665). |
| `tests/agent/test_compressor_stale_tool_images.py` | Retire stale vision_analyze / screenshot tool images inside the protected tail. |
| `tests/agent/test_compressor_tail_cut_oob_fix.py` | Regression test for #75588 — short tool-only suffix can make context compressor scan past messages, causing IndexError in _find_context_summaries(). |
| `tests/agent/test_compressor_tail_cut_tool_pair_floor.py` | Regression coverage: the minimum-progress floor must not split a tool group. |
| `tests/agent/test_compressor_tool_call_budget.py` | Regression tests for tool_call envelope accounting in the compression tail-protection budget walks (issue #28053). |
| `tests/agent/test_compressor_truncated_summary_guard.py` | Truncated compaction summaries must never become checkpoints. |
| `tests/agent/test_compressor_zero_user_guard.py` | Regression coverage for #58753 — compression could drop the only user-role message, leaving a transcript with ZERO user turns. |
| `tests/agent/test_concurrent_interrupt.py` | Tests for interrupt handling in concurrent tool execution. |
| `tests/agent/test_content_policy_blocked.py` | Regression guard for #18028: provider content-policy / safety-filter blocks must classify as `content_policy_blocked`, be non-retryable, and trigger the `is_clien… |
| `tests/agent/test_content_policy_refusal_stop_details.py` | handle_content_policy_refusal: an Anthropic refusal with an empty body still tells the user why. |
| `tests/agent/test_context_breakdown.py` | Tests for live session context breakdown. |
| `tests/agent/test_context_compressor_bench_probe.py` | The summary-model bench (fallback streak >= 2) and its persisted probe window. |
| `tests/agent/test_context_compressor_cross_session_guard.py` | Tests for cross-session _previous_summary contamination bug (#38788). |
| `tests/agent/test_context_compressor_custom_providers.py` | Per-model `context_length` overrides from custom_providers reach the compressor's deferred resolution (#83324). |
| `tests/agent/test_context_compressor_reasoning_fallback.py` | Reasoning-model summaries must not trip the empty-content failure path. |
| `tests/agent/test_context_compressor_session_end_clears_state.py` | Tests for on_session_end() clearing all per-session compressor state. |
| `tests/agent/test_context_compressor_structural_backoff.py` | Structural no-op backoff (#93022). A compression attempt that finds nothing eligible inside the protection window (too few messages / empty window / post-handoff res… |
| `tests/agent/test_context_compressor_summary_continuity.py` | Regression tests for iterative context-summary continuity. |
| `tests/agent/test_context_compressor_summary_hook_compat.py` | Compatibility coverage for third-party summary hook overrides. |
| `tests/agent/test_context_compressor_tail.py` | Lean stale-tail demotion: a demoted `skill_view` body keeps its reload marker (#32106). |
| `tests/agent/test_context_compressor_task_heading.py` | Task-snapshot heading identity across the summarizer prompt, the template, and grounding. |
| `tests/agent/test_context_compressor_temporal_anchoring.py` | Tests for temporal anchoring in context-compaction summaries. |
| `tests/agent/test_context_compressor_zero_user_provenance.py` | Regression coverage for zero-user compaction integrity (#64539). |
| `tests/agent/test_context_display_provenance.py` | Estimated occupancy must not masquerade as provider usage (or vice versa). |
| `tests/agent/test_context_engine.py` | Tests for the ContextEngine ABC and plugin slot. |
| `tests/agent/test_context_engine_host_contract.py` | Regressions for the context-engine host contract. These tests pin the five generic host-side guarantees that external context engine plugins (e.g. |
| `tests/agent/test_context_engine_on_turn_complete_usage.py` | Integration test: `finalize_turn` forwards the turn's real usage to the `ContextEngine.on_turn_complete()` observation hook. |
| `tests/agent/test_context_engine_select_context.py` | Tests for the per-turn `ContextEngine.select_context()` hook. |
| `tests/agent/test_context_estimator_multimodal.py` | Stale-call watchdog estimator prices images at the learned per-image cost, not their base64 length (#63871 / #76411; salvage of #76471 by @crdesign8). |
| `tests/agent/test_context_file_sources.py` | Per-file context manifest (`agent/context_file_sources.py`) behind the `/context` Rules figure. |
| `tests/agent/test_context_pin.py` | model.context_length` is a visible pin: one warning when it disagrees with the advertised window, and a `(pinned)` label wherever the window is rendered (#66168). |
| `tests/agent/test_context_references.py` | Covers test parse typed references ignores emails and handles; test folder listing falls back when rg is blocked; test folder listing outside cwd inside widened allowed root |
| `tests/agent/test_context_refs_concurrent.py` | Tests for concurrent @-reference expansion in context_references. test_refs_expand_concurrently asserts that N URL refs are fetched CONCURRENTLY. |
| `tests/agent/test_context_route_mismatch.py` | Tests for agent_init._context_route_mismatch context-pin scoping. |
| `tests/agent/test_context_token_tracking.py` | Tests for context token tracking in run_agent.py's usage extraction. |
| `tests/agent/test_continuation_ceiling_wedge.py` | Regression tests for the post-ceiling session wedge. |
| `tests/agent/test_continuation_repetition_guard.py` | Regression tests for repetition-dominated response handling. |
| `tests/agent/test_conversation_compression_manual.py` | Invariants for the shared manual-/compress core (`agent/conversation_compression_manual`). |
| `tests/agent/test_conversation_fallback_state.py` | Regression tests for conversation loop fallback state management. |
| `tests/agent/test_conversation_loop_interpreter_shutdown.py` | Regression guard: interpreter-shutdown errors must abort the conversation loop immediately instead of retrying. |
| `tests/agent/test_copilot_acp_client.py` | Focused regressions for the Copilot ACP shim safety layer. |
| `tests/agent/test_copilot_acp_deprecation.py` | Tests for gh-copilot CLI deprecation detection and GitHub Models Azure URL mapping. |
| `tests/agent/test_copilot_initiator.py` | Tests for per-turn Copilot x-initiator header injection (issue #3040). |
| `tests/agent/test_copilot_native_vision_headers.py` | Covers test request client adds copilot vision header for native image payload |
| `tests/agent/test_corruption_recovery_guidance.py` | Regression tests for #88235 — state.db corruption must surface a warning to the user's messaging platform, not stay silently in the logs. |
| `tests/agent/test_create_openai_client_disables_sdk_retries.py` | Regression guard: _create_openai_client must disable SDK-level retries. |
| `tests/agent/test_create_openai_client_kwargs_isolation.py` | Guardrail: _create_openai_client must not mutate its input kwargs. #10933 injected an httpx.Client directly into the caller's `client_kwargs`. |
| `tests/agent/test_create_openai_client_proxy_env.py` | Regression guard: _create_openai_client must honor HTTP(S)_PROXY env vars. |
| `tests/agent/test_create_openai_client_reuse.py` | Regression guardrail: sequential _create_openai_client calls must not share a closed transport across invocations. |
| `tests/agent/test_create_openai_client_ssl_verify.py` | Regression: keepalive httpx client must honor custom CA bundles for HTTPS providers. |
| `tests/agent/test_credential_pool_anthropic_refresh_race.py` | Regression tests for cross-process races refreshing Anthropic OAuth tokens. |
| `tests/agent/test_credential_pool_auto_detect.py` | Reproduction test for issue #63425: Provider auto-detection discards credential pools. |
| `tests/agent/test_credential_pool_codex_singleton_isolation.py` | Codex pool entries and the auth.json singleton: who may adopt whose tokens. |
| `tests/agent/test_credential_pool_connectors_guest.py` | A guest that does not carry inference here never serves inference through the credential pool. |
| `tests/agent/test_credential_pool_deferred_refresh.py` | Thread-safety of the deferred single-use-token refresh path (#71775). The deferred path deliberately runs OAuth network I/O outside the pool lock. |
| `tests/agent/test_credential_pool_interrupt.py` | Regression test for #26145: credential pool rotation after interrupt-resume. |
| `tests/agent/test_credential_pool_key_rotation.py` | Tests for credential pool upsert — key rotation clears exhaustion state. |
| `tests/agent/test_credential_pool_lease_refresh_reselect.py` | acquire_lease must re-select after a deferred single-use-token refresh. |
| `tests/agent/test_credential_pool_no_entries_log_throttle.py` | Regression: the credential-pool "no available entries" INFO line must be throttled so an empty/exhausted pool cannot storm the shared rotating log. |
| `tests/agent/test_credential_pool_nous_refresh_stampede.py` | Concurrent Nous 401 recovery must not stampede the shared OAuth grant. |
| `tests/agent/test_credential_pool_oat_authtype.py` | Regression tests for #63737: sk-ant-oat pool entries are OAuth. |
| `tests/agent/test_credential_pool_oauth_writethrough.py` | Regression tests for credential-pool OAuth refresh write-through to root. Companion to `tests/hermes_cli/test_xai_oauth_writethrough.py`. |
| `tests/agent/test_credential_pool_operations.py` | Durable pool administration and selection invariants. |
| `tests/agent/test_credential_pool_plugin_seam.py` | Plugin providers in the credential pool (#116408): opaque metadata round-trips and refresh goes through the profile's `refresh_credential` hook — eligibility deriv… |
| `tests/agent/test_credential_pool_profile_oauth_fork.py` | Regression tests for #100339: cloned / borrowed single-use Anthropic OAuth grants must never fork across profiles. |
| `tests/agent/test_credential_pool_provider_boundary.py` | Credential pools must never cross provider or custom-endpoint boundaries. |
| `tests/agent/test_credential_pool_refresh_sweep_spacing.py` | A multi-entry deferred refresh sweep must leave waiter windows between holds (#124533). |
| `tests/agent/test_credential_pool_routing.py` | Tests for credential pool preservation through turn config and 429 recovery. Covers: 1. CLI _resolve_turn_agent_config passes credential_pool to runtime dict 2. |
| `tests/agent/test_credential_pool_seed_existing_env_sources.py` | Env-backed pool rows outside the registry tuple are hydrated on load. |
| `tests/agent/test_credential_pool_sole_cooldown.py` | Sole-credential cooldown: a pool with nothing to rotate to should not bench its only key for an hour on a transient throttle (429/403/5xx). |
| `tests/agent/test_credential_pool_sole_rotate_recovery.py` | 97315: a rotation that can only hand back the entry that was just marked exhausted is no recovery — it must return None so the turn fails. |
| `tests/agent/test_credential_pool_terminal_refresh_visibility.py` | A terminally rejected OAuth refresh token must leave a trace at the default log level. |
| `tests/agent/test_credential_pool_unmatched_rotation_bound.py` | 70401: the unmatched-identity rotation branch in `mark_exhausted_and_rotate()` must be bounded and must not write cooldowns onto innocent healthy keys. |
| `tests/agent/test_credential_rotation_route_settings.py` | Credential rotation must not carry route-scoped TLS policy. |
| `tests/agent/test_credential_source_labels.py` | A callable API key is labelled by its credential source, never by "is it callable". |
| `tests/agent/test_credit_404_fallback.py` | Regression for #115702: a paid Nous model behind an empty credit balance answers HTTP 404 `insufficient_credits_for_paid_model`. |
| `tests/agent/test_credits_cold_start.py` | Tests for cold-start credits hydration at session open. |
| `tests/agent/test_credits_notices_toggle.py` | Tests for the display.credits_notices config gate on _emit_credits_notices. The toggle suppresses notice EMISSION only — credits state capture and /usage stay live. |
| `tests/agent/test_credits_policy.py` | Tests for evaluate_credits_notices — pure threshold reconciliation policy (L4.1). |
| `tests/agent/test_credits_tracker.py` | Tests for agent.credits_tracker — CreditsState + parse_credits_headers. Covers the 9-state matrix plus validation edge cases. |
| `tests/agent/test_credits_view.py` | Tests for the /credits command — shared view core + gateway handler. `/credits` is the focused money surface (balance in, top-up out). |
| `tests/agent/test_cron_inflight_prompt_reappend.py` | Regression coverage for #100818: compaction of a single-prompt session (the cron shape) must not leave the model with nothing to obey. |
| `tests/agent/test_cron_inline_api_call.py` | Regression guard for #62151 — gateway cron must not wedge on the 2nd+ call. |
| `tests/agent/test_cross_process_turn_lease.py` | AIAgent enters turns only after acquiring and reloading durable state. |
| `tests/agent/test_cross_turn_reasoning_continuity.py` | Responses routes whose model renders earlier-turn reasoning keep it on the wire and through compaction. |
| `tests/agent/test_crossloop_client_cache.py` | Tests for cross-loop client cache isolation fix (#2681). |
| `tests/agent/test_ctx_halving_fix.py` | Tests for the context-halving bugfix. Background ---------- When the API returns "max_tokens too large given prompt" (input is fine, but input_tokens + requested max… |
| `tests/agent/test_curator_activity.py` | Regression tests for curator skill activity timestamps. |
| `tests/agent/test_curator_backup.py` | Tests for agent/curator_backup.py — snapshot + rollback of the skills tree. |
| `tests/agent/test_curator_classification.py` | Tests for the curator consolidated-vs-pruned classifier. |
| `tests/agent/test_curator_reports.py` | Tests for the curator per-run report writer (run.json + REPORT.md). |
| `tests/agent/test_curator_rollback_staging.py` | Failed recovery must retain the staged files omitted from safety snapshots. |
| `tests/agent/test_curator_run_hygiene.py` | Curator run hygiene: what a pass costs on disk and who gets to run it. |
| `tests/agent/test_cursor_optimizations_parity.py` | Byte-parity checks for the per-iteration cursor optimizations. Drives the pure functions directly (no AIAgent): 1. |
| `tests/agent/test_custom_pool_mismatch_guard.py` | Regression tests for the credential-pool provider-mismatch guard with custom providers (Bernard's Fireworks report, June 2026). |
| `tests/agent/test_custom_provider_ca_probes.py` | Probe-specific policy edges; real TLS handshakes live in test_ssl_transport_contracts. |
| `tests/agent/test_custom_provider_extra_body.py` | Covers test custom provider extra body preserves caller override; test named custom provider extra body matches provider key |
| `tests/agent/test_custom_provider_extra_body_matching.py` | Tests for custom-provider model matching (extra_body / service_tier drop bug). |
| `tests/agent/test_custom_provider_extra_headers_client.py` | Per-provider `extra_headers` applied to the OpenAI client (#3526 salvage). |
| `tests/agent/test_custom_providers_vision.py` | Tests for custom_providers[].models[].supports_vision override (#41036). |
| `tests/agent/test_dead_connection_cleanup.py` | Regression tests for stale provider sockets in agent-owned client pools. |
| `tests/agent/test_deadline.py` | Tests for agent/deadline.py — the unified deadline layer (#85125). |
| `tests/agent/test_deadline_fork_race.py` | Real-process deadline regression; the probe owns and reaps its whole subtree. |
| `tests/agent/test_declared_conversation_scope.py` | Host-declared conversation scope on the affinity-key path (issue #96811). |
| `tests/agent/test_deepseek_anthropic_thinking.py` | Regression guard: preserve thinking blocks on DeepSeek's /anthropic endpoint. |
| `tests/agent/test_deepseek_reasoning_content_echo.py` | Regression test: DeepSeek V4 thinking mode reasoning_content echo. |
| `tests/agent/test_degenerate_final_recovery.py` | Degenerate-final recovery (#103483). Provider-side collapse: a turn executes its tool work correctly, then ends on `finish_reason=stop` with an ENTIRE visible answ… |
| `tests/agent/test_detached_fork_lifecycle_hooks.py` | Lifecycle-hook isolation for persistence-disabled internal forks. |
| `tests/agent/test_dict_tool_call_args.py` | Covers test tool call validation accepts dict arguments |
| `tests/agent/test_direct_contexts_stream_inline.py` | Delegated children and cron turns stream on the wire (#90202, #100260). |
| `tests/agent/test_direct_provider_url_detection.py` | Covers test direct openai url requires openai host; test direct openai url accepts native host |
| `tests/agent/test_display.py` | Tests for agent/display.py — build_tool_preview() and inline diff previews. |
| `tests/agent/test_display_emoji.py` | Tests for get_tool_emoji in agent/display.py — skin + registry integration. |
| `tests/agent/test_display_todo_progress.py` | Tests for get_cute_tool_message todo progress display. |
| `tests/agent/test_display_tool_failure.py` | Tests for _detect_tool_failure + _trim_error + get_cute_tool_message inline failure suffix rendering. |
| `tests/agent/test_dropped_tool_call_recovery.py` | Regression tests for dropped tool-call recovery. Some providers (observed: claude-opus-4.8 / claude-sonnet-4.5 on GitHub Copilot, ~2026-07) return `finish_reason="t… |
| `tests/agent/test_empty_response_fallback_refund.py` | Empty-response fallback hop refunds its API call (#77305). |
| `tests/agent/test_empty_response_guard.py` | Tests for agent/empty_response_guard.py (NS-503). The guard exists to stop the empty-retry loop re-billing large inputs for deterministic empties (unsignaled provide… |
| `tests/agent/test_empty_response_recovery_persistence.py` | Regression tests for empty-response recovery transcript persistence. |
| `tests/agent/test_empty_terminal_reasoning_surface.py` | Tests for reasoning-only final responses. A clean-stop response (`finish_reason == "stop"`) with no ordinary content but structured reasoning is promoted only for … |
| `tests/agent/test_empty_tool_name_loop_dampening.py` | Regression for #47967 — empty-name phantom tool calls. |
| `tests/agent/test_endpoint_blackhole.py` | Tests for short-circuiting probes to endpoints that blackhole TCP connects. A routable-but-dead endpoint (e.g. |
| `tests/agent/test_engine_preflight_wire.py` | Engine-driven sub-threshold preflight maintenance (#20316, salvaged from #20424). |
| `tests/agent/test_entitlement_fail_closed.py` | 106475: with a single credential, a Codex ChatGPT-account entitlement 400 must fail closed — the rejected slug is skipped by the fallback walk and restore_primary_ru… |
| `tests/agent/test_env_credential_turn_refresh.py` | Per-turn adoption of ~/.hermes/.env credential edits (#67821). |
| `tests/agent/test_env_loader_applied_homes.py` | Regression tests for #40597: _APPLIED_HOMES must be marked AFTER a real fetch attempt, so early failures (malformed config, disabled sources) stay retryable within t… |
| `tests/agent/test_env_loader_reload_restore.py` | load_hermes_dotenv() reloads must not clobber values an external secret source resolved (#74265). |
| `tests/agent/test_env_loader_secret_sources.py` | Tests for the secret-source tracking in `hermes_cli.env_loader`. |
| `tests/agent/test_error_classifier_content_policy.py` | Provider safety-filter refusals classify as content_policy_blocked, never as a retryable outage. |
| `tests/agent/test_error_classifier_data_policy.py` | A Nous 403 `data_policy_denied` is deterministic for this context: no retry, no rotation, no fallback. |
| `tests/agent/test_error_classifier_observed.py` | Provider error bodies observed in real sessions, through the real SDK exception types. |
| `tests/agent/test_error_classifier_reasoning_level.py` | A 400 that names the reasoning field and refuses its *value* against a closed level set. |
| `tests/agent/test_error_classifier_upstream_blocked.py` | A 403 written by a WAF/CDN in front of the provider is not an API-key rejection (#53099, #70566). |
| `tests/agent/test_error_surface.py` | Tests for agent/error_surface.py — turn-error → UI layer descriptors. |
| `tests/agent/test_estimator_parity.py` | Regression tests for #84371 — compaction dead-loop on reasoning-heavy codex_responses sessions. |
| `tests/agent/test_exit_cleanup_interrupt.py` | A second Ctrl+C during cron finalization must not skip resource cleanup. |
| `tests/agent/test_export_current_turn_boundary.py` | The loop exports `{turn_id, current_turn_user_idx}` beside the exact `messages` it addresses, and only when that row is this turn's user message verbatim. |
| `tests/agent/test_external_process_provider_init.py` | External-process profiles receive their resolved ACP launch details at client construction. |
| `tests/agent/test_external_skills.py` | Tests for external skill directories (skills.external_dirs config). |
| `tests/agent/test_external_skills_dirs_cache.py` | Guards for `get_external_skills_dirs` mtime-based memo. |
| `tests/agent/test_failed_turn_chat_copy.py` | Terminal failed-turn results carry a specific `failure_reason` and plain-language chat copy on every surface (the CLI-only 💡 hints used to be the only place with … |
| `tests/agent/test_failed_turn_site_codes.py` | Deterministic loop outcomes (context overflow, empty reply, persistence failure) end as failed turns whose chat copy names the slash command to run, and whose `fail… |
| `tests/agent/test_failover_identity.py` | Tests for system-prompt model-identity sync across provider failover. The system prompt is session-stable and embeds `Model:`/`Provider:` identity lines. |
| `tests/agent/test_fallback_429_after_timeout.py` | Regression test for #32646: fallback_providers not activated when HTTP 429 follows a successful primary-transport recovery. |
| `tests/agent/test_fallback_api_mode_preservation.py` | Fallback activation must preserve the Anthropic wire signal (PR #79787). Three behaviors salvaged from PR #79787: 1. |
| `tests/agent/test_fallback_credential_isolation.py` | Tests for fallback credential pool isolation. Verifies that fallback activation isolates the credential pool from the primary provider, preventing two bugs: 1. |
| `tests/agent/test_fallback_dynamic_credential.py` | Fallback rebuilds retain the credential source, not its last token. |
| `tests/agent/test_fallback_entry_base_url.py` | A `fallback_providers` entry's `base_url` must reach the client (#121359). |
| `tests/agent/test_fallback_exhaustion_cooldown.py` | Regression tests for #24996 — fallback-switch storm on host memory. When every provider in the fallback chain fails non-retryably back-to-back (e.g. |
| `tests/agent/test_fallback_reasoning_override.py` | Tests for per-model reasoning_effort override during fallback activation. |
| `tests/agent/test_fallback_restore_codex_early_reopen.py` | A session pinned to its fallback returns to a Codex primary whose quota window reopened early. |
| `tests/agent/test_fast_compression_lane.py` | Contract tests for the opt-in non-reasoning compression fast lane. |
| `tests/agent/test_fast_mode_auto.py` | Bounded /fast auto/cold windows and the shared route-aware gate. |
| `tests/agent/test_file_mutation_verifier.py` | Tests for the per-turn file-mutation verifier footer. Covers the three moving pieces: 1. |
| `tests/agent/test_file_safety.py` | Tests for agent/file_safety.py read guards — env file blocking. Run with: python -m pytest tests/agent/test_file_safety.py -v |
| `tests/agent/test_file_safety_container_mirror.py` | Tests for the container-context sandbox-mirror guard (#32049 follow-up). |
| `tests/agent/test_file_safety_credentials.py` | Tests for HERMES_HOME credential-file read blocking in file_safety. |
| `tests/agent/test_file_safety_cross_profile.py` | Tests for the active-profile resolver in agent/file_safety. |
| `tests/agent/test_file_safety_sandbox_mirror.py` | Tests for the sandbox-mirror write guard in agent/file_safety. |
| `tests/agent/test_file_safety_session_state.py` | Session transcript stores are read-only to agent file tools. Inspired by Claude Code 2.1.205's auto-mode rule preventing transcript manipulation. |
| `tests/agent/test_file_safety_write_credentials.py` | Secret stores under HERMES_HOME are write-denied; control files stay writable (#110464). `get_read_block_error` refuses every credential store. |
| `tests/agent/test_first_chunk_at_hook.py` | Regression tests for first_chunk_at in the post_api_request hook (#98555). |
| `tests/agent/test_flush_diverts_on_corrupt_state_db.py` | Agent flush path: a quarantined (structurally corrupt) SessionDB diverts to JSONL. |
| `tests/agent/test_free_tier_rate_limit_class.py` | Every free-tier refusal offers sign-in: any anonymous 429 (reason or not) and a 402 from the welcome host classify as a welcome refusal; a signed-in account's identi… |
| `tests/agent/test_future_timeout_worker_death.py` | A worker that DIES raising a timeout-class error must not be mistaken for a live one. |
| `tests/agent/test_gateway_turn_sidecar.py` | Gateway must-deliver notes on the current user message. |
| `tests/agent/test_gemini_alias_native_route.py` | Provider aliases preserve the native-vs-compatible client boundary. |
| `tests/agent/test_gemini_fast_fallback.py` | Regression tests for #11314 — credential-pool rotation vs. fallback. |
| `tests/agent/test_gemini_free_tier_gate.py` | Tests for Gemini free-tier detection and blocking. |
| `tests/agent/test_gemini_key_surface_guidance.py` | Tests for the 403 PERMISSION_DENIED key-surface guidance (#115306). |
| `tests/agent/test_gemini_long_decode.py` | Gemini long decode: dropped streams resume from the last checkpoint, hops are bounded, usage splits billing from context. |
| `tests/agent/test_gemini_native_adapter.py` | Tests for the native Google AI Studio Gemini adapter. |
| `tests/agent/test_gemini_native_reservation.py` | Native Gemini output-token reservation at agent init (#57275 claim 4). |
| `tests/agent/test_gemini_schema.py` | Tests for agent.gemini_schema — OpenAI→Gemini tool parameter translation. |
| `tests/agent/test_gemini_standard_key_guidance.py` | Tests for Gemini legacy Standard-key auth guidance. Google began rejecting unrestricted legacy "Standard" Google Cloud API keys on the Gemini API on June 19, 2026 (a… |
| `tests/agent/test_gemini_thinking_config.py` | Disabling reasoning must actually stop (or minimise) Gemini thinking (#91927). |
| `tests/agent/test_gemini_type_arrays.py` | Native tool translation must preserve union alternatives at every depth. |
| `tests/agent/test_generated_media_durable.py` | Generated image/video output must survive the gateway media sweep (#126445). |
| `tests/agent/test_ghost_skill_pruning.py` | Ghost-skill defense tests (#32106, salvage of PR #44166). |
| `tests/agent/test_glm_context_window_resolution.py` | GLM context windows: hyphenated relay slugs, provider-level custom overrides, and the aux feasibility check inherit the right window instead of the `glm` 202,752 c… |
| `tests/agent/test_grid_sweep_cli_tui_stream_diagnostics.py` | Code-flow grid sweep (NOUS-368, wave 2): pre-existing automatic diagnostics on the CLI/TUI/stream rails that bypassed the warning boundary. |
| `tests/agent/test_hermetic_side_effect_guards.py` | Regression tests for hermetic guards around local desktop side effects. |
| `tests/agent/test_hygiene_timeout_cooldown_isolation.py` | Pre-agent hygiene retry spacing must not block in-agent compression. |
| `tests/agent/test_i18n.py` | Tests for agent.i18n -- catalog parity, fallback, language resolution. |
| `tests/agent/test_i18n_languages.py` | Language identity: every bundled catalog has an endonym row and vice versa; `language_options` is `en` first, endonym-only, and reports where each language comes… |
| `tests/agent/test_i18n_layers.py` | Layered i18n: user overlay > bundled, plugin pack > overlay, partial packs fall through, pack-only languages become supported, and unload drops the layer. |
| `tests/agent/test_i18n_tui_packs.py` | Bundled TUI packs: `locales/<lang>.tui.yaml` mirror `locales/_keys.tui.json` and are served by `i18n.catalog {surface: 'tui'}` underneath overlay and plugin pa… |
| `tests/agent/test_identity_flush.py` | Regression tests for identity-based SessionDB flushing (#46053). |
| `tests/agent/test_idle_compaction.py` | Tests for the opt-in idle-triggered compaction policy. |
| `tests/agent/test_idle_compaction_lock_and_guards.py` | Idle-triggered compaction: interaction with the compression guards. |
| `tests/agent/test_image_corrupt_recovery.py` | Tests for reactive recovery when a provider rejects an image as corrupt. |
| `tests/agent/test_image_eviction_policy.py` | Arithmetic contract of the shared send-path image-eviction policy (#113517). |
| `tests/agent/test_image_gen_registry.py` | Tests for agent/image_gen_registry.py — provider registration & active lookup. |
| `tests/agent/test_image_generate_parallel.py` | Regression tests for parallel image-generation tool batches. |
| `tests/agent/test_image_rejection_fallback.py` | Tests for the image-rejection fallback in run_agent. When a server rejects image content (e.g. |
| `tests/agent/test_image_replay.py` | Turns rebuilt from the session DB re-attach the newest retained user images (agent/image_replay.py). |
| `tests/agent/test_image_routing.py` | Tests for agent/image_routing.py — the per-turn image input mode decision. |
| `tests/agent/test_image_shrink_recovery.py` | Tests for reactive image-shrink recovery. Covers the full chain for Anthropic's 5 MB per-image ceiling (and any future provider that returns an image-too-large error… |
| `tests/agent/test_image_token_cost.py` | Per-image token cost learned from provider usage (agent/image_token_cost.py, #70328). |
| `tests/agent/test_in_place_commit_rollback.py` | Regression test for #99477: a FAILED in-place compaction commit must roll the live transcript back to its pre-compression snapshot. |
| `tests/agent/test_in_place_compaction.py` | Tests for in-place context compaction (config: compression.in_place, #38763). |
| `tests/agent/test_in_place_merged_user_rows.py` | In-place compaction over a turn that was killed before it finished. A crash between turn start and the reply leaves a durable `user;user` pair. |
| `tests/agent/test_in_place_persist_marker.py` | Regression test for #98450: in-place batch compaction commit must stamp _DB_PERSISTED_MARKER on the committed dicts. |
| `tests/agent/test_in_place_preflight_rewind.py` | In-place compaction's positional rewind must land on the carried tail's own originals. |
| `tests/agent/test_infinite_compaction_loop.py` | Tests for the infinite compaction loop fix (issue #40803). |
| `tests/agent/test_init_exhausted_pool_billing_error.py` | An exhausted (402) provider pool must be named as a billing failure at init. |
| `tests/agent/test_init_fallback_on_exhausted_pool.py` | Regression test for #17929: AIAgent.__init__ should try fallback_model when primary provider credentials are exhausted. |
| `tests/agent/test_init_fallback_refusal_warning.py` | A fully-refusing init-time fallback ladder must say why at WARNING before dying. |
| `tests/agent/test_injected_param_strip_retry_registry.py` | Registry walk for the injected-parameter strip-and-retry safety class. |
| `tests/agent/test_inline_edit_persistence.py` | Real edit -> executor -> SQLite -> history projection, without model calls. |
| `tests/agent/test_inline_session_search_profile.py` | The inline `session_search` executor forwards `profile` so a routed gateway agent can read a named profile's store instead of silently searching the injected (de… |
| `tests/agent/test_inline_tool_executors_memory_args.py` | The inline memory alias persists writes and preserves content precedence. |
| `tests/agent/test_intent_ack_continuation.py` | Intent-ack continuation gate + detector behavior. Covers the config-driven generalization of the codex intent-ack continuation (issue #27881): the historical `codex… |
| `tests/agent/test_interpreter_shutdown_turn_exit.py` | Interpreter-shutdown handling in the conversation loop's outer retry path. |
| `tests/agent/test_interrupt_compat.py` | Compatibility contract for explicit hard-stop producers. |
| `tests/agent/test_interrupt_issuer_attribution.py` | interrupt()` records who asked for the stop, so the turn exit reason can attribute it (#112647). |
| `tests/agent/test_interrupt_propagation.py` | Test interrupt propagation from parent to child agents. |
| `tests/agent/test_invalid_context_length_warning.py` | Tests that invalid context_length values in config produce visible warnings. |
| `tests/agent/test_iron_proxy.py` | Hermetic tests for the iron-proxy egress integration. |
| `tests/agent/test_iron_proxy_e2e.py` | End-to-end smoke test for the iron-proxy egress integration. |
| `tests/agent/test_iteration_budget_race.py` | Tests for IterationBudget thread safety. The `used` property must acquire the lock before reading `_used` to prevent data races with concurrent `consume()` / `refund… |
| `tests/agent/test_iteration_budget_warning.py` | Iteration checkpoints preserve the transcript and the hard budget. |
| `tests/agent/test_iteration_summary_reasoning_details.py` | The max-iterations summary call treats `reasoning_details` per api_mode: the anthropic_messages converter rebuilds signed thinking blocks from it, so the summary m… |
| `tests/agent/test_jiter_preload.py` | Covers test preload jiter native extension loads sdk parser dependency; test preload jiter native extension is best effort |
| `tests/agent/test_kanban_budget_checkpoint.py` | Checkpoint eligibility follows explicit opt-in or dispatcher ownership. |
| `tests/agent/test_kanban_stop.py` | Tests for the kanban worker turn-end stop guard. |
| `tests/agent/test_kimi_coding_anthropic_thinking.py` | Kimi / Moonshot thinking behavior on the Anthropic-Messages wire. |
| `tests/agent/test_kimi_coding_openai_base_url.py` | 102247: OpenAI-wire client creation must normalize api.kimi.com/coding to /v1 to avoid HTTP 404 when appending /chat/completions. |
| `tests/agent/test_last_total_tokens.py` | Test that last_total_tokens is correctly set by ContextCompressor. |
| `tests/agent/test_lean_single_aux_call.py` | Lean compaction makes EXACTLY ONE auxiliary LLM request per attempt. |
| `tests/agent/test_learn_prompt.py` | Tests for /learn — open-ended skill distillation. Covers the shared prompt builder (agent.learn_prompt.build_learn_prompt) and the slash-command registry wiring. |
| `tests/agent/test_learning_graph_render.py` | Behavior contracts for the terminal Star Map renderer. |
| `tests/agent/test_learning_mutations.py` | Behavior contracts for journey node edit/delete (agent.learning_mutations). |
| `tests/agent/test_legacy_cli.py` | The packaged `hermes-agent` console script honours argv (#54648). |
| `tests/agent/test_length_continuation_thinking_exhaustion.py` | Regression tests for thinking-only length truncations. |
| `tests/agent/test_length_continuation_window_headroom.py` | Length continuation stops when the PROMPT filled the context window (#106120). |
| `tests/agent/test_litellm_tool_part_cache_markers.py` | Regression tests for #89886: part-level cache_control on role:tool messages must be suppressed on LiteLLM-style envelope routes. |
| `tests/agent/test_live_db_preview_locks.py` | File previews may not cancel SQLite's live POSIX locks (including WAL sidecars). |
| `tests/agent/test_llamacpp_alias_managed_endpoint.py` | A bare llama.cpp alias resolves to the profile's managed local server, and only to it. |
| `tests/agent/test_lmstudio_load_mode.py` | Covers test lmstudio jit load mode skips explicit preload; test explicit budget below loaded runtime limits effective context |
| `tests/agent/test_lmstudio_reasoning.py` | Reasoning-effort resolution for LM Studio. Covers the contract that Hermes' generic effort ladder must stay monotonic once it is mapped onto LM Studio's narrower voc… |
| `tests/agent/test_load_time_durability_stamp.py` | Regression (#92231): resumed transcripts must not re-append to state.db. |
| `tests/agent/test_local_probe_disk_cache.py` | Tests for the local-endpoint probe disk L2 cache in agent/model_metadata. |
| `tests/agent/test_local_prompt_progress.py` | llama-server prompt progress, sleep-aware stall timers, and the local stale-breaker reset. |
| `tests/agent/test_local_stream_timeout.py` | Tests for local provider stream read timeout auto-detection. |
| `tests/agent/test_local_tool_batches.py` | Local batches use the live agent pipeline, not registry fan-out. |
| `tests/agent/test_lock_fallback_base_semantics.py` | Steer requeue/drain semantics and the `_is_openai_client_closed` truth table. |
| `tests/agent/test_malformed_tool_args_no_fallback.py` | A 400 for the model's own malformed tool-call JSON must not walk the fallback chain (#12770). |
| `tests/agent/test_malformed_tool_arguments.py` | Malformed model tool arguments are rejected at the dispatch boundary. |
| `tests/agent/test_manual_compression_feedback.py` | Behavioral coverage for manual compression status messages. |
| `tests/agent/test_manual_compression_refusal_feedback.py` | Regression tests: manual /compress feedback for a would-grow refusal. |
| `tests/agent/test_markdown_tables.py` | Tests for `agent.markdown_tables.realign_markdown_tables`. |
| `tests/agent/test_materialize_data_url_cleanup.py` | Regression test: temp file cleanup when materializing data URLs for vision. |
| `tests/agent/test_max_iteration_handoff.py` | Shared classification of a non-failed iteration-cap turn (#102213). |
| `tests/agent/test_mcp_execution_deadline.py` | A server-owned deadline must survive the outer executor without widening a sibling batch. |
| `tests/agent/test_memory_agent_context.py` | Regression for #80646: the `agent_context` handed to memory providers follows the platform (`cron` / `subagent` skip writes per the `MemoryProvider.initialize… |
| `tests/agent/test_memory_async_sync.py` | Regression guard: end-of-turn memory sync must not block the turn. |
| `tests/agent/test_memory_boundary_commit.py` | Tests for MemoryManager.commit_session_boundary_async. |
| `tests/agent/test_memory_context_dedupe.py` | A recalled bullet is stated once per `<memory-context>` block. |
| `tests/agent/test_memory_migration_notifications.py` | A configured memory provider that cannot be recovered at agent start is shown to the user, never only logged (#119769): the CLI prints it; other drivers get a warn n… |
| `tests/agent/test_memory_provider_caller_profile.py` | PLG-11 (#140058): a memory-provider tool call belongs to the calling turn's profile. |
| `tests/agent/test_memory_provider_init.py` | Regression tests for memory provider selection during AIAgent init. |
| `tests/agent/test_memory_provider_unavailable_warning.py` | Regression tests for NousResearch/hermes-agent#2765. A memory provider configured via `memory.provider` but reporting `is_available() == False` (e.g. |
| `tests/agent/test_memory_recall_indicator.py` | MemoryManager.describe_recall — the deterministic recall indicator. |
| `tests/agent/test_memory_session_switch.py` | Tests for the on_session_switch hook and session_id propagation. |
| `tests/agent/test_memory_skill_scaffolding.py` | MemoryManager strips slash-skill scaffolding for every provider. |
| `tests/agent/test_memory_stalled_background_call.py` | A background provider call that never returns pins its mem-sync worker thread forever (Python cannot stop a thread), and MemoryManagers are rebuilt per agent. |
| `tests/agent/test_memory_sync_interrupted.py` | Regression guard for #15218 — external memory sync must skip interrupted turns. |
| `tests/agent/test_memory_sync_redaction.py` | Every MemoryManager fan-out scrubs secrets before a memory provider sees them (#115104). |
| `tests/agent/test_memory_user_id.py` | Tests for per-user memory scoping via user_id threading. |
| `tests/agent/test_memory_write_bridge.py` | Behavior tests for the built-in memory → external provider bridge. |
| `tests/agent/test_merged_user_override.py` | A replayed merged row keeps the unanswered request and exact wire sidecar. |
| `tests/agent/test_message_content.py` | Covers test flatten message text accepts chat and responses text parts; test flatten message text accepts object parts |
| `tests/agent/test_message_metadata.py` | Covers test stamp preserves source timestamp; test append stamps same mapping at append time |
| `tests/agent/test_message_reactions.py` | Message reactions: persistence, tapback semantics, and cache safety. |
| `tests/agent/test_message_sanitization_policy.py` | Tests for the single-owner call_id + reasoning_content policies. |
| `tests/agent/test_meta_agent_init.py` | Tests for AIAgent provider=meta host-mandated api_mode. |
| `tests/agent/test_meta_usage_cache_reporting.py` | Usage cache reporting for Meta Responses path. |
| `tests/agent/test_micro_compaction.py` | Tests for per-turn micro-compaction in `ContextCompressor`. |
| `tests/agent/test_mid_turn_compaction_turn_boundary.py` | Covers test post tool compression reanchors the active user boundary; test pre api compression mid turn keeps this turns tool pair on the wire |
| `tests/agent/test_minimax_auxiliary_url.py` | Tests for Anthropic-to-OpenAI auxiliary URL normalization. MiniMax and MiniMax-CN set inference_base_url to the /anthropic path. |
| `tests/agent/test_minimax_provider.py` | Tests for MiniMax provider hardening — context lengths, thinking, catalog, beta headers, transport. |
| `tests/agent/test_missing_provider_credentials_hint.py` | The "no credentials" error for an explicit provider names a remedy that can actually work. |
| `tests/agent/test_mistral_tool_ids.py` | Mistral rejects any tool id that is not exactly 9 alphanumeric characters. A split `tool_call` batch mints `call_` + 12 hex via `deterministic_call_id`. |
| `tests/agent/test_moa_aggregator_cache_control.py` | MoA aggregator cache decoration: the acting aggregator (`MoAChatCompletions`) and advisor fan-out are re-read across iterations and stay decorated; the one-shot `… |
| `tests/agent/test_moa_aggregator_cost_slot.py` | Tests for MoA aggregator-slot exposure used by session cost accounting. |
| `tests/agent/test_moa_aggregator_prefix_stability.py` | MoA aggregator requests must grow as a byte-stable prefix across tool-loop iterations. |
| `tests/agent/test_moa_alternation_recovery.py` | MoA aggregator: strict-alternation destinations get their adjacent same-role messages merged reactively and per destination (#112358, last atom). |
| `tests/agent/test_moa_cold_start_cache.py` | Regression tests for MoA cold-start caching (#66793). |
| `tests/agent/test_moa_context_max_tokens.py` | Regression test for aggregate_moa_context's reference/aggregator max_tokens split. |
| `tests/agent/test_moa_fanout_cadence.py` | every_n fanout cadence: advisors refresh every Nth tool iteration and off-cadence iterations reuse the cached guidance from the last on-cadence run. |
| `tests/agent/test_moa_fanout_liveness.py` | MoA fan-out must stamp the turn-liveness activity clock (#110015). |
| `tests/agent/test_moa_loop_mode.py` | moa: default_preset: review presets: review: reference_models: - provider: openai-codex model: gpt-5.5 aggregator: provider: openrouter model: anthropic/claude-opus-… |
| `tests/agent/test_moa_observability_bridge.py` | Per-advisor MoA metrics crossing the plugin-hook boundary. |
| `tests/agent/test_moa_prepared_request_client_swap.py` | _moa_prepared_request` must never reach a client that cannot consume it. |
| `tests/agent/test_moa_prepared_request_leak.py` | Test: _moa_prepared_request does not leak to native OpenAI clients (#78382). |
| `tests/agent/test_moa_privacy_filter.py` | MoA privacy redaction filter (config: moa.privacy_filter — display / full). Reworked from PR #60463 (issue #59959). |
| `tests/agent/test_moa_progress.py` | Tests for the MOA progress indicator added in issue #59546. |
| `tests/agent/test_moa_quiet_reference_output.py` | MoA display events honour the `-Q` quiet contract. |
| `tests/agent/test_moa_reasoning_effort.py` | Covers test slot reasoning config parses effort and none; test moa reference passes per slot reasoning config; test global yaml false disables |
| `tests/agent/test_moa_slot_api_mode.py` | Tests for MoA slot_runtime api_mode propagation (issue #54379). |
| `tests/agent/test_moa_slot_max_tokens.py` | Tests for per-slot max_tokens in MoA reference calls. |
| `tests/agent/test_moa_stale_guidance_note.py` | Cached advisor guidance must announce that it predates the tool results below it. |
| `tests/agent/test_moa_streaming.py` | Tests for MoA aggregator streaming. MoAChatCompletions.create() honors stream=True by running the references first and then returning the aggregator's raw streaming … |
| `tests/agent/test_moa_switch_api_mode.py` | Regression test for MoA primary-call routing on persisted preset switches. |
| `tests/agent/test_moa_trace_streamed_capture.py` | Tests for MoA trace aggregator-output capture across streaming modes. |
| `tests/agent/test_model_extra_type_guard.py` | Regression test for PR #15157: non-dict `model_extra` must not crash tool-call normalization. |
| `tests/agent/test_model_metadata.py` | Tests for agent/model_metadata.py — token estimation, context lengths, probing, caching, and error parsing. |
| `tests/agent/test_model_metadata_cache.py` | Concurrent writers of `context_length_cache.yaml` (race audit lostupdate-7). |
| `tests/agent/test_model_metadata_http.py` | Exercise probe transport redirects, proxies, and early response closure. |
| `tests/agent/test_model_metadata_local_ctx.py` | Tests for _query_local_context_length and the local server fallback in get_model_context_length. |
| `tests/agent/test_model_streaming_config.py` | model.streaming` config seeds the session's streaming decision (#72901). |
| `tests/agent/test_models_dev.py` | Tests for agent.models_dev — models.dev registry integration. |
| `tests/agent/test_models_dev_provider_capabilities.py` | Plugin-declared per-model capabilities (#102115): one declaration on `ProviderProfile` feeds every models.dev consumer — capability lookup, context lookup, the pic… |
| `tests/agent/test_moonshot_schema.py` | Tests for Moonshot/Kimi flavored-JSON-Schema sanitizer. |
| `tests/agent/test_multimodal_interim.py` | Tests for issue #66267 — multimodal (list) tool-result content must not crash interim-assistant-message handling or non-streaming message building. |
| `tests/agent/test_multimodal_tool_content_recovery.py` | Tests for reactive multimodal-tool-content recovery. |
| `tests/agent/test_multimodal_tool_result_spill.py` | Oversized TEXT parts inside a multimodal tool envelope must go through the same persistence policy as string results (#95429): a `browser_exec` call that captured … |
| `tests/agent/test_multiplex_base_url_scope.py` | Multiplex invariant: a scoped API key is never paired with the DEFAULT profile's base URL / proxy. |
| `tests/agent/test_multiplex_cloud_credential_clients.py` | Cloud-SDK credential clients under `gateway.multiplex_profiles`: boto3 and azure-identity freeze the credential chain into the client at construction, so a slot ke… |
| `tests/agent/test_native_compaction.py` | Tests for native OpenAI Responses server-side compaction (gpt-5.6 only). |
| `tests/agent/test_native_compaction_nontext_retention.py` | Regression coverage for image-only user content across native compaction. |
| `tests/agent/test_native_compaction_summary_retention.py` | Tests for native compaction summary retention during pre-checkpoint pruning (#90975). |
| `tests/agent/test_native_compaction_switch_capabilities.py` | Covers test trusted destination capabilities are explicitly enabled; test untrusted destination capabilities are explicitly denied; test default openai destination is enabled without explicit base url |
| `tests/agent/test_native_compaction_typed_user_retention.py` | Retain the newest typed (input_text) ask at a native checkpoint boundary. |
| `tests/agent/test_native_preflight_estimate.py` | Native Responses preflight must count the checkpoint-pruned wire (#96155). |
| `tests/agent/test_non_chat_primary_restore.py` | A primary already known to be non-chat must not be restored on the next turn. |
| `tests/agent/test_non_stream_stale_timeout.py` | Tests for the non-stream stale-call detector context estimator. |
| `tests/agent/test_none_deref_guards.py` | Regression tests for None-dereference guards on `.get(key, "").method()` patterns (#55997 salvage + config-derived sibling sites). |
| `tests/agent/test_nonretryable_error_html_summary.py` | Regression: non-retryable API failures must not leak raw HTML pages. |
| `tests/agent/test_nonretryable_result_carries_verdict.py` | A non-retryable 4xx (rejected OAuth token, bad key) must reach UI clients with the classifier's verdict: without `failure_reason` the desktop error card read a 401… |
| `tests/agent/test_nonstream_wait_notice.py` | Wait status describes request-local silence, never active generation. |
| `tests/agent/test_notice_spine.py` | Regression tests for the notice-spine (AgentNotice + emitter callbacks). Covers: A. |
| `tests/agent/test_notification_persistence.py` | A muted wake keeps durable evidence while hiding only its new presentation rows. |
| `tests/agent/test_nous_credits_gauge.py` | Tests for the Nous-credits subscription % gauge in build_nous_credits_snapshot. |
| `tests/agent/test_nous_credits_snapshot.py` | Tests for build_nous_credits_snapshot (L6-A, magnitudes-only). |
| `tests/agent/test_nous_fallback_unavailable.py` | Tests for Nous fallback local-availability suppression. |
| `tests/agent/test_nous_key_pre_expiry_adoption.py` | Nous agent keys live ~1 h. Every agent in a process must not learn about expiry from its own 401. |
| `tests/agent/test_nous_portal_anthropic_wire.py` | Nous Portal `anthropic/*` models route on the native Messages wire. |
| `tests/agent/test_nous_rate_guard.py` | Tests for agent/nous_rate_guard.py — cross-session Nous Portal rate limit guard. |
| `tests/agent/test_nous_usage_profile_context.py` | The bounded account fetch must read auth from the routed profile, not the launch profile. |
| `tests/agent/test_nous_welcome_client_contract.py` | The client side of the Nous welcome tier's gateway contract: auxiliary calls on the welcome host use its one model, the `x-nous-model-switch` header moves a sessio… |
| `tests/agent/test_nous_wire_auto.py` | nous.anthropic_wire: auto` decides a session's wire once, from its first response. |
| `tests/agent/test_nt_namespace_guard.py` | Windows NT/device-namespace paths are rejected on the RAW string, before any resolution. |
| `tests/agent/test_ollama_num_ctx.py` | Tests for Ollama num_ctx context length detection and injection. |
| `tests/agent/test_onboarding.py` | Tests for agent/onboarding.py — contextual first-touch hint helpers. |
| `tests/agent/test_onboarding_first_tasks.py` | agent/onboarding_first_tasks.py`: which first tasks the model may put on the build card. |
| `tests/agent/test_onboarding_flow.py` | agent/onboarding_flow.py`: the beats, the run record and every event, across machine fixtures. |
| `tests/agent/test_onepassword_secrets.py` | Hermetic tests for the 1Password (`op` CLI) secret source. |
| `tests/agent/test_oneshot.py` | Tests for agent.oneshot — shared one-off (stateless) LLM requests. |
| `tests/agent/test_oneshot_footprint.py` | One-shot sessions (`hermes chat -q`) drop the self-improvement footprint. |
| `tests/agent/test_openai_client_lifecycle.py` | Covers test retry after api connection error recreates request client; test stale non stream close is single owner; test closed shared client is recreated before request |
| `tests/agent/test_openai_ultrafast.py` | OpenAI Ultrafast (`service_tier: "ultrafast"`): one tier word table, a per-model request gate, and pricing from the tier the response was SERVED at. |
| `tests/agent/test_opencode_session_affinity.py` | x-opencode-session rides on every OpenCode request, on every transport. |
| `tests/agent/test_openrouter_response_cache.py` | Tests for OpenRouter response caching header injection. |
| `tests/agent/test_openrouter_silent_default_purge.py` | Regression tests for issue #81952 — aux free default + env-ingestion WARNING. |
| `tests/agent/test_outbound_stale_vision.py` | Send-path eviction of stale vision_analyze / screenshot tool payloads. |
| `tests/agent/test_outbound_webhooks.py` | Tests for the outbound webhook dispatcher (agent.outbound_webhooks). |
| `tests/agent/test_outer_error_retry_bound.py` | Tests for issue #92450 — outer-loop error retries must be bounded even when the turn budget (`max_iterations`) is unlimited. |
| `tests/agent/test_output_cap_parsing.py` | OpenRouter/Nous phrase the output-cap error as a context breakdown. |
| `tests/agent/test_over_window_compression_fail_closed.py` | An over-window session that compression cannot shrink must not block the host toward the compression ceiling or send a request the model cannot accept (#116472). |
| `tests/agent/test_overflow_overhead_aware_tokens.py` | Overflow recovery handlers (413, context overflow, Anthropic long-context tier 429) must hand the compressor an overhead-aware token estimate that counts tool schema… |
| `tests/agent/test_overflow_partial_terminal.py` | Regression tests for #106260: a context-overflow error after partial stream delivery must NOT seed a continuation stub with the recovered text. |
| `tests/agent/test_owned_process_cleanup.py` | Agent teardown owns processes, not their shared terminal environment. |
| `tests/agent/test_partial_stream_continuation_prompt.py` | After a mid-stream transport cut the continuation must keep tools on the table (#74990). |
| `tests/agent/test_partial_stream_finish_reason.py` | Regression tests for issue #30963 — partial-stream stub finish_reason. |
| `tests/agent/test_per_model_compression_threshold.py` | Tests for per-model compression threshold overrides. Users who swap between models with very different context windows (e.g. |
| `tests/agent/test_per_model_provider_routing.py` | provider_routing.models.<id>` overlays the flat OpenRouter routing for the CURRENT agent.model. |
| `tests/agent/test_per_model_threshold_init_ordering.py` | Follow-up regression tests for per-model compression threshold overrides. Covers the gaps flagged in the review of PR #63020: 1. |
| `tests/agent/test_percentage_clamp.py` | Tests for percentage clamping at 100% across display paths. |
| `tests/agent/test_periodic_scheduler_context.py` | Context propagation contract for the shared periodic scheduler. |
| `tests/agent/test_pet_engine.py` | Tests for the petdex pet engine (agent/pet/*). Behavior/invariant focused — no network, no live manifest. |
| `tests/agent/test_phantom_tool_references.py` | Phantom tool references: system-prompt blocks must not name tools the session can't call (Blank Slate audit, Aug 2026). |
| `tests/agent/test_plan_prompt.py` | Tests for the built-in /plan command (formerly the bundled `plan` skill). |
| `tests/agent/test_platform_hint_cron_delivery.py` | A cron agent's system prompt carries its delivery channel's hint. |
| `tests/agent/test_platform_hint_desktop.py` | System-prompt assembly for the desktop chat surface. |
| `tests/agent/test_platform_hint_overrides.py` | Tests for per-platform prompt-hint overrides (config.yaml → platform_hints). |
| `tests/agent/test_plugin_context_engine_clone.py` | A plugin-registered context engine is one shared instance; agent init hands each agent its own copy through `clone_for_agent()` (default deepcopy), so engines with… |
| `tests/agent/test_plugin_context_engine_init.py` | Tests that plugin context engines get update_model() called during init. |
| `tests/agent/test_plugin_context_references.py` | Tests for plugin context reference provider API (Issue #26193). |
| `tests/agent/test_plugin_live_notes_delivery.py` | A plugin that goes live while a turn runs is told to the model in that turn, once. |
| `tests/agent/test_plugin_llm.py` | Unit tests for the plugin LLM facade (`agent.plugin_llm`). |
| `tests/agent/test_plugin_llm_task_routing.py` | Tests for plugin auxiliary-task routing via `ctx.llm.complete(task=...)`. |
| `tests/agent/test_plugin_prompt_sections.py` | Covers test real aiagent freezes section within life and rerenders on invalidate; test fresh process resume restores identical full prompt without callback |
| `tests/agent/test_plugin_stream_hooks.py` | Covers test stream delta plugin hook is queued off token path; test stream delta plugin hook error does not break streaming; test stream hook queue drops oldest pending event when full |
| `tests/agent/test_pool_revert_after_cooldown.py` | A live session rotated off a quota-benched credential moves back once the bench lifts. |
| `tests/agent/test_pool_rotation_endpoint_veto.py` | Mid-run credential rotation never rebinds a session to a same-provider entry for another endpoint. |
| `tests/agent/test_portal_tags.py` | Tests for agent.portal_tags — Nous Portal request tag contract. |
| `tests/agent/test_post_compaction_hook.py` | post_compaction` fires once per committed compaction, never for an attempt that changed nothing, and a raising plugin never changes what the compaction returns (#11… |
| `tests/agent/test_post_compression_trim.py` | A successful compaction hands allocator pages back to the OS. |
| `tests/agent/test_post_tool_compression_attempt_cap.py` | Behavioral regression tests for the post-tool compression attempt cap. |
| `tests/agent/test_pre_compress_checkpoint_contract.py` | Host-side contract tests for the opt-in pre-compress checkpoint API (v2). |
| `tests/agent/test_pre_compress_memory_context.py` | Behavior contracts for memory-provider context in compression prompts. |
| `tests/agent/test_pre_compress_memory_context_handoff.py` | Behavior contracts for the pre-compression memory-context handoff. |
| `tests/agent/test_preflight_compression_cap_e2e.py` | E2E: compression.max_attempts=6 drives a 4th+ preflight compaction pass. |
| `tests/agent/test_preflight_compression_gate.py` | Regression tests for issue #27405. The preflight compression gate must trigger when *either* the message count exceeds the protected ranges OR the cheap char-based t… |
| `tests/agent/test_preflight_compression_timeout_fail_closed.py` | Regression coverage for stalled preflight compression. |
| `tests/agent/test_preflight_lock_defer.py` | Preflight lock-defer must not arm the insufficient-progress blocker. |
| `tests/agent/test_preflight_timeout_typed_result.py` | The turn-start preflight timeout surfaces as a typed result, not a traceback. |
| `tests/agent/test_primary_runtime_restore.py` | Tests for per-turn primary runtime restoration and transport recovery. Verifies that: 1. Fallback is turn-scoped: a new turn restores the primary model/provider 2. |
| `tests/agent/test_private_credential_writers.py` | Cross-writer invariant: every private-credential file is 0600 from the moment its temp file exists. |
| `tests/agent/test_proactive_prune_config.py` | compression.proactive_prune_* — config parse seam for the proactive prune. |
| `tests/agent/test_proactive_prune_loop_wiring.py` | Behavioral tests for the post-tool proactive tool-result prune wiring. |
| `tests/agent/test_proactive_prune_rearm_threshold.py` | Proactive-prune rearm must not lock out an over-threshold session (#101889). |
| `tests/agent/test_proactive_prune_restart_safety.py` | Restart-safety regressions for proactive tool-result pruning. |
| `tests/agent/test_proactive_tool_result_pruning.py` | Tests for proactive tool-result pruning. `ContextCompressor.prune_tool_results_only` runs the cheap, deterministic Phase-1 prune (summarize old tool outputs, dedup… |
| `tests/agent/test_probe_cache_followups.py` | Tests for probe-cache follow-ups on the #29988/#37595/#50572 salvage. |
| `tests/agent/test_profile_home_override_precedence.py` | Regression: multiplex gateway profile scoping + full-prompt wiring. Two scenarios for _agent_home's resolution order (#86313 post-merge findings): 1. |
| `tests/agent/test_project_skills.py` | Tests for project-local skill discovery (skills.trusted_project_dirs). |
| `tests/agent/test_prompt_builder.py` | Tests for agent/prompt_builder.py — context scanning, truncation, skills index. |
| `tests/agent/test_prompt_cache_boundary.py` | Builder-declared stable-prefix cache boundaries (#81867). |
| `tests/agent/test_prompt_cache_prefix_contract.py` | Prompt-cache prefix contract on caching routes, through a real AIAgent and a recording fake provider. |
| `tests/agent/test_prompt_cache_scope.py` | Tests for the rotation-stable prompt-cache scope (issue #79017). Legacy `compression.in_place: false` compaction rotates the physical session_id mid-conversation. |
| `tests/agent/test_prompt_cache_ttl_auto.py` | prompt_caching.cache_ttl: auto` picks the Anthropic cache tier by who paces the session. |
| `tests/agent/test_prompt_cache_ttl_propagation.py` | 84733: prompt-cache TTL/prefix propagation into MoA/aux paths + failover re-preflight. |
| `tests/agent/test_protected_tail_pressure.py` | Algorithmic reproduction and regression for issue #61932. |
| `tests/agent/test_provider_attribution_headers.py` | Attribution default_headers applied per provider via base-URL detection. |
| `tests/agent/test_provider_client_cancel.py` | Request-owned non-HTTP transports must participate in interruption. |
| `tests/agent/test_provider_client_seam.py` | A provider profile can supply its own client — the registration seam. |
| `tests/agent/test_provider_fallback.py` | Tests for ordered provider fallback chain (salvage of PR #1761). |
| `tests/agent/test_provider_history_parity.py` | Provider-native replay carriers stay private to their owning provider. |
| `tests/agent/test_provider_id_mint_normalization.py` | Provider-minted parallel tool-call ids are normalized once, at mint time (#130363). |
| `tests/agent/test_provider_media.py` | Route save_url's fetch through an httpx MockTransport and stub the URL policy check — SSRF behavior has dedicated tests in test_save_url_image.py; these pin the stre… |
| `tests/agent/test_provider_parity.py` | Provider parity tests: verify that AIAgent builds correct API kwargs and handles responses properly for all supported providers. |
| `tests/agent/test_provider_profile_recovery_seam.py` | A pure model-provider plugin participates in error classification and the 401 refresh path through its `ProviderProfile` hooks — no PluginManager hook lifecycle, n… |
| `tests/agent/test_provider_projection.py` | Agent-as-provider transcript projection + skill-nudge tick. A provider that IS an agent executes its own tools inside its own session. |
| `tests/agent/test_provider_reset_cooldown.py` | Provider-declared reset windows govern primary fallback cooldowns (#117484). |
| `tests/agent/test_provider_scope_keys.py` | Equivalent home paths address one provider slot and generation. |
| `tests/agent/test_proxy_and_url_validation.py` | Tests for malformed proxy env var and base URL validation. |
| `tests/agent/test_proxy_bypass_shared.py` | Invariant: the LLM transport (`agent/process_bootstrap`) and the platform adapters (`gateway/platforms/base`) answer "is this host in NO_PROXY" with the same mat… |
| `tests/agent/test_pydantic_dump_warning_leak.py` | Serializer-warning leak regression tests (#82xxx). The Anthropic SDK's streaming accumulator builds `ParsedMessage` snapshots whose content blocks (`ParsedTextBlo… |
| `tests/agent/test_rate_limit_reset_hint.py` | A rate-limit retry names the provider's reset window on the status line (#26889). "Rate limited. |
| `tests/agent/test_rate_limit_tracker.py` | Tests for agent.rate_limit_tracker — header parsing and formatting. |
| `tests/agent/test_reactions.py` | Behavior tests for the token-free reaction detector. |
| `tests/agent/test_read_dedup_rewrite_boundaries.py` | Repeat-read dedup across transcript rewrites that are not a compaction boundary. |
| `tests/agent/test_reasoning_carriers.py` | Gemini text-turn signatures and Copilot reasoning carriers survive capture and reach only their route. |
| `tests/agent/test_reasoning_disable_recovery.py` | Main-loop recovery for a route that rejects a reasoning disable by field name (#114460). |
| `tests/agent/test_reasoning_echo_resolver_e2e.py` | Production-shape coverage for reasoning_echo: real resolver + real init read. |
| `tests/agent/test_reasoning_effort_labels.py` | 61634: `ultra` is Hermes-internal and every wire clamps it; the display label used by the effort pickers and `/reasoning` status must say what the route really s… |
| `tests/agent/test_reasoning_effort_module.py` | Tests for agent.reasoning_effort — the canonical effort ladder + clamp. |
| `tests/agent/test_reasoning_effort_wire_translation.py` | Wire translation for Hermes' extended reasoning-effort vocabulary (#89503). |
| `tests/agent/test_reasoning_only_stop_persistence.py` | Reasoning promoted on a reasoning-only clean stop is returned, never persisted as a reply. |
| `tests/agent/test_reasoning_replay_routes.py` | Stored reasoning is replayed to every chat-completions route that can read it, on the carriers that route reads; strict schemas never receive a reasoning key; a rout… |
| `tests/agent/test_reasoning_shape_boundaries.py` | Structured reasoning keeps text and answer channels intact on every chat consumer. |
| `tests/agent/test_reasoning_stale_timeout_floor.py` | Regression tests for the reasoning-model stale-timeout floor (issue #52217). |
| `tests/agent/test_reasoning_summaries.py` | Reasoning summary-part boundary repair (agent/reasoning_summaries.py). |
| `tests/agent/test_recovery_diagnostic_producers.py` | Real recovery producers retain work/evidence while hiding diagnostic copies. |
| `tests/agent/test_redaction_registry.py` | Tests for the plugin redaction-pattern registry. Covers `agent.redact.register_redaction_patterns` (validation, dedupe, additive semantics, matcher rebuild), the `… |
| `tests/agent/test_reference_handoff_active_turn.py` | Regression coverage for #80622: a reference-only compaction handoff must never become the active user turn after a completed assistant response. |
| `tests/agent/test_refine_focus.py` | Tests for the /refine focus parameter on spawn_background_review_thread. |
| `tests/agent/test_refine_snapshot_isolation.py` | Every review path hands the fork a snapshot that cannot alias the live transcript. |
| `tests/agent/test_relay_atof_cwd.py` | Hermes scope cwd export through the real NeMo Relay ATOF plugin. |
| `tests/agent/test_relay_compaction.py` | Compaction marks land on the owning session's Relay scope stack. |
| `tests/agent/test_relay_compaction_atof.py` | Compaction marks through the real NeMo Relay ATOF plugin, and the freshness reset they drive. |
| `tests/agent/test_relay_cwd.py` | Logical working directories attached to Hermes-owned Relay scopes. |
| `tests/agent/test_relay_llm.py` | Tests for the core Relay-managed physical LLM attempt adapter. |
| `tests/agent/test_relay_nested_execution.py` | Regression tests for nested managed Relay execution (#77244). The native Relay pipeline binds its Futures to the event loop that entered `run_in_session_async`. |
| `tests/agent/test_relay_runtime_bounded_scope_ops.py` | Bounded native scope operations in the Relay session coordinator. |
| `tests/agent/test_relay_runtime_plugins.py` | Tests for native NeMo Relay plugin configuration ownership. |
| `tests/agent/test_relay_scope_pop_metadata.py` | Regression for #78993: scope.pop metadata kwarg on older NeMo Relay. |
| `tests/agent/test_relay_session_segments.py` | Session-span segmentation for continuous sessions. Continuous gateway sessions keep the Relay session scope open indefinitely; close-driven export means the session … |
| `tests/agent/test_relay_tools.py` | Tests for the core Relay-managed Hermes tool adapter. |
| `tests/agent/test_remote_fetch_ssrf_guard.py` | Every remote-party-supplied URL fetch refuses internal targets before a socket opens. |
| `tests/agent/test_repair_reanchors_current_turn_user_idx.py` | prepare_iteration` runs the alternation repair, which merges adjacent user rows in place (after a compaction the role=user summary sits next to the protected first … |
| `tests/agent/test_repair_tool_call_arguments.py` | Tests for _repair_tool_call_arguments — malformed JSON repair pipeline. |
| `tests/agent/test_repair_tool_call_name.py` | Tests for AIAgent._repair_tool_call — tool-name normalization. |
| `tests/agent/test_repeated_dropped_tool_args.py` | Dropped streams must not dispatch repetition-dominated tool arguments. |
| `tests/agent/test_repetition_guard.py` | Unit tests for repetition-dominated model output detection. |
| `tests/agent/test_replay_budget_accounting.py` | Tests for provider-aware replay-field accounting in tail-budget walks (#73624). |
| `tests/agent/test_replay_cleanup.py` | Tests for agent.replay_cleanup — shared replay-tail sanitizers. |
| `tests/agent/test_replay_echo_retirement.py` | Replay-echo retirement for interrupt placeholders (#132949, alongside #81841). A hidden assistant row still reaches the provider as assistant content on replay. |
| `tests/agent/test_request_client_reuse.py` | Per-request OpenAI wire client reuse across sequential LLM calls. |
| `tests/agent/test_request_client_reuse_abort_races.py` | Races between the request-client reuse cache and the abort machinery. Invariants pinned here: 1. |
| `tests/agent/test_reset_aware_primary_restore.py` | Reset-aware primary restore — stay on fallback until the primary's rate-limit window actually resets. |
| `tests/agent/test_responses_empty_tool_replay.py` | Responses replay must not invent a blank assistant turn before a tool call. |
| `tests/agent/test_responses_watchdog_accommodations.py` | Regression tests for #86444 - large-context watchdog accommodations for codex_responses transports. Ensures: 1. |
| `tests/agent/test_restore_primary_pool_reselect.py` | Test that _restore_primary_runtime re-selects from the credential pool instead of using a stale snapshot key. |
| `tests/agent/test_resume_stale_active_task.py` | Regression coverage for #35344: a resumed session must not let a stale historical task snapshot from an inherited compaction handoff hijack the reply to a new, unrel… |
| `tests/agent/test_retry_delay_parsers_shared.py` | Invariants for the shared retry-delay parsers in `agent/retry_utils.py`. |
| `tests/agent/test_retry_exhaustion_partial_retention.py` | 119001: an API error that ends the turn AFTER partial output was delivered must retain that output instead of ending the turn error-only, and must not persist the da… |
| `tests/agent/test_retry_status_buffer.py` | Tests for the retry/fallback status buffer helpers on AIAgent. |
| `tests/agent/test_retry_utils.py` | Tests for agent.retry_utils jittered backoff. |
| `tests/agent/test_review_fork_cache_scope.py` | A background-review fork gets its OWN cache scope on xAI once it has compacted. |
| `tests/agent/test_review_idle_queue.py` | Deferred background review on the managed local runtime. |
| `tests/agent/test_rotation_flush_persisted_boundary.py` | Regression (#68196): rotating preflight compression must not re-append the already-persisted transcript to the parent session on cold resume. |
| `tests/agent/test_router_timeout_shim.py` | HTTP-200 router timeout shim (#68396) in the OpenAI-compatible consumers that bypass `validate_response`: the stream assembler and the auxiliary `_validate_llm_re… |
| `tests/agent/test_run_agent_codex_responses.py` | Short-circuit retry backoff so Codex retry tests don't block on real wall-clock waits (5s jittered_backoff base delay + tight time.sleep loop). |
| `tests/agent/test_run_agent_interrupt_hook.py` | Sequential and concurrent tool execution: Ctrl-C emits a cancelled `post_tool_call` hook. |
| `tests/agent/test_run_agent_multimodal_prologue.py` | Regression tests for run_conversation's prologue handling of multimodal content. |
| `tests/agent/test_run_budget.py` | Tests for the optional wall-clock run budget (agent.run_budget_seconds / --run-budget). Covers: 1. |
| `tests/agent/test_runtime_cwd.py` | Tests for agent/runtime_cwd.py — the single source of truth for the agent working directory. |
| `tests/agent/test_runtime_self_protection.py` | The runtime's own interpreter/venv is not agent-deletable (#58748). |
| `tests/agent/test_runtime_session_store.py` | Covers test outbox freezes failed payload and reopens exclusively; test outbox has private posix mode; test outbox capacity failure does not advance or discard |
| `tests/agent/test_runtime_session_store_lease_refresh.py` | A managed worker's turn lease survives its periodic refresh (the store is the agent's session_db). |
| `tests/agent/test_runtime_session_store_proxy.py` | A managed worker's owner RPC is a loopback dial: a user's HTTPS_PROXY must never carry it. |
| `tests/agent/test_runtime_session_store_surface_parity.py` | A managed worker's agent gets a RuntimeSessionStore as its session_db. |
| `tests/agent/test_safe_worker_policy.py` | Fresh exec probes for the private managed safe-worker bootstrap contract. |
| `tests/agent/test_salvage_grown_transcript.py` | Mechanical salvage for compression candidates that would grow. |
| `tests/agent/test_sanitiser_escalation.py` | Empty-transcript sanitizer: stop the per-send heal/WARNING loop (#96870). |
| `tests/agent/test_save_url_image.py` | Direct tests for `agent.image_gen_provider.save_url_image` (#26942). |
| `tests/agent/test_secret_scope.py` | Tests for the profile-scoped credential primitive (Workstream A / Phase 2). |
| `tests/agent/test_secret_scope_env_cache.py` | The per-path `load_env_file()` memo in `agent.secret_scope`. |
| `tests/agent/test_secret_scope_pinned_launch_home.py` | The launch home is pinned once the process serves several profiles (#119242). |
| `tests/agent/test_secret_scope_tier1_migration.py` | Regression tests for the Tier-1 core-gateway secret-scope migration. |
| `tests/agent/test_secret_scope_user_message.py` | UnscopedSecretError reaches end users verbatim (compression-aborted replies, cron notices), so `str(exc)` must be the one actionable sentence; the developer diagnosi… |
| `tests/agent/test_send_path_history_isolation.py` | Send-path transforms must never write through into persisted history. |
| `tests/agent/test_sequential_deadline_delegate_exempt.py` | delegate_task` runs a nested orchestrator's whole batch inside one tool call by design, so it must not sit under the generic sequential-call deadline: with it, ever… |
| `tests/agent/test_sequential_tool_interrupt.py` | Sequential tool execution must abandon the wait when the user interrupts. |
| `tests/agent/test_sequential_tool_timeout.py` | Sequential tool calls recover when one dispatch never returns. |
| `tests/agent/test_served_model.py` | agent.served_model — per-response served-model capture behind routing proxies (#54864). |
| `tests/agent/test_serves_routed_profile_pin.py` | A host that mirrors the served profile into HERMES_HOME must not flip launch-home identity. |
| `tests/agent/test_session_activity.py` | Unit tests for the shared session activity observation contract. |
| `tests/agent/test_session_activity_persist.py` | Durable session activity projection from AIAgent._touch_activity (#72016). |
| `tests/agent/test_session_affinity_header.py` | Per-provider `session_affinity_header` (#86241, #104449). |
| `tests/agent/test_session_id_env.py` | Test that HERMES_SESSION_ID is exposed as an env var and ContextVar. |
| `tests/agent/test_session_meta_filtering.py` | Tests for session_meta filtering — issue #4715. Ensures that transcript-only session_meta messages never reach the chat-completions API, via both the API-boundary gu… |
| `tests/agent/test_session_reset_fix.py` | Tests for session reset completeness (fixes #2635). /clear and /new must not carry stale state into the next session. |
| `tests/agent/test_session_rotation_flush_cold_resume.py` | Regression (#68454): /new, /resume, /branch must not re-append cold-resumed transcript rows when flushing before session rotation. |
| `tests/agent/test_session_row_under_live_agent_persist.py` | A session row deleted under a live agent must heal on the next flush (#123583). |
| `tests/agent/test_session_snapshot_removal.py` | Automatic persistence stays in SQLite; explicit exports remain available. |
| `tests/agent/test_session_source.py` | A finite `hermes chat -q` / `hermes -z` run is tagged `oneshot`, whether launched from a plain shell or spawned inside a TUI/Desktop session (whose transport label i… |
| `tests/agent/test_set_runtime_main_custom_provider.py` | Regression test: set_runtime_main() must pass base_url/api_key/api_mode so that _resolve_auto_route() can route custom: providers in Step 1. |
| `tests/agent/test_setup_beat_card_round.py` | A setup_beat round in the turn loop. It never ends in the empty-response nudge: the line written with the card is the turn's reply when the follow-up comes back empt… |
| `tests/agent/test_setup_logging_profile_scope.py` | 125974 — `agent.agent_init._setup_logging` must honor the active profile scope. |
| `tests/agent/test_shared_client_fd_corruption.py` | 70773: the shared OpenAI-wire client must never be pool-closed from a non-owner thread. |
| `tests/agent/test_shared_http_transport.py` | Keepalive httpx clients share one HTTPTransport per (verify, proxy) identity. |
| `tests/agent/test_shell_hooks.py` | Tests for the shell-hooks subprocess bridge (agent.shell_hooks). |
| `tests/agent/test_shell_hooks_consent.py` | Consent-flow tests for the shell-hook allowlist. Covers the prompt/non-prompt decision tree: TTY vs non-TTY, and the three accept-hooks channels (--accept-hooks, HER… |
| `tests/agent/test_shell_hooks_tree_kill.py` | Process-tree cleanup for timed-out shell hooks (port of openai/codex#37527). |
| `tests/agent/test_side_question.py` | Tests for agent/side_question.py — the /btw context-aware side question engine. |
| `tests/agent/test_skill_app_snapshot.py` | Application requirements survive disk and in-process skill-index reuse. |
| `tests/agent/test_skill_applied_notifications.py` | Covers test applied skill operations notify with names; test unapplied skill operations never notify |
| `tests/agent/test_skill_bundles.py` | Tests for agent/skill_bundles.py — YAML-defined skill bundles. |
| `tests/agent/test_skill_cache_thrash.py` | Regression test for #104849: skill command cache thrash from platform/home flapping. |
| `tests/agent/test_skill_commands.py` | Tests for agent/skill_commands.py — skill slash command scanning and platform filtering. |
| `tests/agent/test_skill_commands_freshness.py` | CFG-8: a skill installed from another terminal reaches the long-lived gateway's slash map. |
| `tests/agent/test_skill_commands_reload.py` | Tests for `agent.skill_commands.reload_skills`. Covers the helper that powers `/reload-skills` (CLI + gateway slash command). |
| `tests/agent/test_skill_inline_bash_windows.py` | Native Windows execution contract for opt-in skill snippets. |
| `tests/agent/test_skill_inline_shell_output.py` | Inline-shell snippets never turn a silent failure into an empty (looks-fine) result. |
| `tests/agent/test_skill_inline_shell_trust.py` | Inline-shell expansion is trust-scoped (#63307): community hub installs never auto-execute ` !`cmd` ` snippets, mirroring the hub scan's INSTALL_POLICY trust gate … |
| `tests/agent/test_skill_invocation_description.py` | describe_skill_invocation() — recovering what the user typed from a /skill turn. A /skill invocation expands into a message that embeds the whole skill body. |
| `tests/agent/test_skill_session_platform_gate.py` | The session_platforms frontmatter gate (skills-index slim PR). |
| `tests/agent/test_skill_todo_retention_parity.py` | Retention parity at the compaction boundary (#84718). |
| `tests/agent/test_skill_utils.py` | Tests for agent/skill_utils.py. |
| `tests/agent/test_skills_auto_load.py` | skills.auto_load: pinned skills land in every new session's prompt, resolved once per agent. |
| `tests/agent/test_skills_guidance_content_filter.py` | SKILLS_GUIDANCE must not carry the phrasing Anthropic's content filter rejects. |
| `tests/agent/test_skills_index_delta.py` | Skills that change mid-conversation reach the model, behind the cached system prompt. |
| `tests/agent/test_skip_background_review.py` | Tests for the skip_background_review constructor flag. |
| `tests/agent/test_skip_memory_store.py` | Regression test for issue #65429. An agent built with `skip_memory=True` AND `enabled_toolsets=["memory"]` used to get a memory tool wired to `store=None` (the… |
| `tests/agent/test_soul_legacy_bot_protocol.py` | The plugin-era "## Messaging other agents" SOUL append is dead weight: the server injects the live section in Bot Chat only, so every copy in SOUL.md must vanish — a… |
| `tests/agent/test_soul_md_profile_isolation.py` | Regression (#50233, SOUL.md half): a profile agent's SOUL.md must load from ITS OWN home, never the ambient/launch home — even on a thread that did not bind the HERM… |
| `tests/agent/test_split_turn_compaction.py` | Regression for #80449 — an oversized in-progress turn must stay compressible. |
| `tests/agent/test_ssl_transport_contracts.py` | TLS assertions reach real client transports, never the host certificate store. |
| `tests/agent/test_ssl_verify.py` | TLS trust contract: the OS certificate store, with explicit config on top. |
| `tests/agent/test_stale_replay_prune.py` | Tests for compaction's codex_reasoning_items handling (#71058, #71077 by @webtecnica). Per-turn reasoning items are never pruned (they are replay continuity). |
| `tests/agent/test_stall_guards.py` | Runtime anti-stall guards (agent.stall_guards). Two guards, both notice/re-prompt-only: 1. |
| `tests/agent/test_start_order_gate.py` | Tests for the concurrent start-order gate (PR #79571 / issue #79569). |
| `tests/agent/test_steer_compaction_persistence.py` | Regression coverage for steer display identity across compactions (#117137). |
| `tests/agent/test_stream_chunk_byte_estimate.py` | Tests for _estimate_chunk_bytes — the cheap per-chunk stream size proxy. Replaced `len(repr(chunk))` in the streaming hot loop. |
| `tests/agent/test_stream_drop_logging.py` | Tests for richer stream-drop diagnostics in agent.log. |
| `tests/agent/test_stream_interrupt_abort_socket.py` | An interrupt abort must reach the in-flight stream's socket (#98974). |
| `tests/agent/test_stream_interrupt_retry.py` | Tests that /stop interrupts streaming retry loops immediately. |
| `tests/agent/test_stream_reasoning_details.py` | Opaque reasoning records survive both collectors and durable replay. |
| `tests/agent/test_stream_retry_backoff.py` | Stream-level reconnects back off exponentially and stay interruptible (#60029). |
| `tests/agent/test_stream_retry_route_switch.py` | A stream retry never replays a request built for a route the agent has since left. |
| `tests/agent/test_stream_runaway_repetition.py` | A stream stuck in a repetition loop must not keep the turn alive for as long as it streams. |
| `tests/agent/test_stream_serving_provider.py` | Regression tests for the serving-provider field in stream diagnostics (#90216). |
| `tests/agent/test_stream_single_writer.py` | Regression tests for the streaming single-writer invariant (#65991). |
| `tests/agent/test_stream_single_writer_guard.py` | Regression tests for the best-effort single-writer fence accessors. |
| `tests/agent/test_stream_stale_breaker_reset.py` | Follow-up for the cross-turn stream-stale circuit breaker (#58962). |
| `tests/agent/test_stream_stale_circuit_breaker.py` | Cross-turn stream-stale circuit breaker (issue #58962). |
| `tests/agent/test_stream_stale_kill_unwedge.py` | A stale-killed provider stream must actually unwedge its reader. |
| `tests/agent/test_stream_unmask_5xx.py` | Streaming 5xx unmasking: the non-streaming probe surfaces the provider's real error. |
| `tests/agent/test_stream_wait_notice.py` | Resumed chunks clear only the stream monitor's own silence notice. |
| `tests/agent/test_streamed_reasoning_details.py` | Streamed `reasoning_details` survive to the assembled response (replay continuity). |
| `tests/agent/test_streamed_text_accumulation.py` | Tests for how a turn's streamed assistant text is built up. The text used to be grown with `+=` on an attribute. |
| `tests/agent/test_streaming.py` | Tests for streaming token delivery infrastructure. Tests the unified streaming API call, delta callbacks, tool-call suppression, provider fallback, and CLI streaming… |
| `tests/agent/test_streaming_context_scrubber.py` | Unit tests for StreamingContextScrubber (agent/memory_context.py). |
| `tests/agent/test_streaming_tool_call_repair.py` | Tests for tool call argument repair in the streaming assembly path. |
| `tests/agent/test_strict_api_validation.py` | Test validation error prevention for strict APIs (Fireworks, etc.) |
| `tests/agent/test_strip_reasoning_tags_cli.py` | Tests for cli.py::_strip_reasoning_tags — specifically the tool-call XML stripping added in openclaw/openclaw#67318 port. |
| `tests/agent/test_structured_output_rejection_retry.py` | Regression tests for the structured-output rejection retry in `agent.auxiliary_client`. |
| `tests/agent/test_studio_bridge_affinity.py` | Affinity contract on Hermes Studio's group-chat bridge shape (#96811). |
| `tests/agent/test_subagent_lifecycle.py` | Contract tests for the public plugin subagent lifecycle API. |
| `tests/agent/test_subagent_progress.py` | Tests for subagent progress relay (issue #169). Verifies that: - KawaiiSpinner.print_above() works with and without active spinner - _build_child_progress_callback h… |
| `tests/agent/test_subagent_stop_hook.py` | Tests for the subagent_stop hook event. Covers wire-up from tools.delegate_tool.delegate_task: * fires once per child in both single-task and batch modes * is dispat… |
| `tests/agent/test_subdirectory_hints.py` | Tests for progressive subdirectory hint discovery. |
| `tests/agent/test_subdirectory_hints_tilde.py` | Regression tests for the home-directory RuntimeError bug. |
| `tests/agent/test_subprocess_env_guard.py` | Lint guard: no new raw `os.environ.copy()` / `**os.environ` spawn-env sites. |
| `tests/agent/test_subscription_view.py` | Tests for agent.subscription_view — the surface-agnostic /subscription core. |
| `tests/agent/test_summarize_api_error.py` | Regression: empty-body HTTP 4xx errors must still surface a real provider message. |
| `tests/agent/test_summarize_tool_result_type_safety.py` | Type safety tests for _summarize_tool_result. When LLMs return non-string parameter values (e.g. |
| `tests/agent/test_summary_prefix_semantics.py` | Pin the semantics of SUMMARY_PREFIX so the compaction handoff doesn't re-introduce conflicting instructions. |
| `tests/agent/test_summary_prefix_tool_use.py` | Regression tests for the SUMMARY_PREFIX tool-use clause (#65848 class). |
| `tests/agent/test_summary_role_template_alternation.py` | Regression coverage: the compaction summary role must alternate against TEMPLATE-VISIBLE neighbours, not literal list neighbours. |
| `tests/agent/test_surrogate_chokepoints.py` | Lone-surrogate chokepoint regression tests. One class of bug, many crash sites: a lone UTF-16 surrogate (U+D800–U+DFFF) in model output or a request payload crashes … |
| `tests/agent/test_switch_model_bedrock_sigv4.py` | Every non-startup Bedrock client rebuild (/model switch, fallback-to-Bedrock, fallback restore) must land on the same wire startup uses: AnthropicBedrock SDK for Cla… |
| `tests/agent/test_switch_model_context.py` | Tests that switch_model does not inherit stale context_length overrides. |
| `tests/agent/test_switch_model_fallback_prune.py` | Regression test for TUI v2 blitz bug: explicit /model --provider switch silently fell back to the old primary provider on the next turn because the fallback chain — … |
| `tests/agent/test_switch_model_pool_reload.py` | Regression tests for #52727: switch_model() must reload the credential pool when the provider changes. |
| `tests/agent/test_switch_model_reapplies_config_context_pin.py` | A live model/provider switch must re-derive the durable `model.context_length` pin. `model.context_length` is the user's profile-wide ceiling. |
| `tests/agent/test_switch_model_reapplies_headers.py` | Regression tests for #61099: switch_model must reapply provider-specific default headers when it rebuilds _client_kwargs from scratch. |
| `tests/agent/test_switch_model_reasoning_override.py` | Tests for per-model reasoning_effort override during /model switch. Tests that switch_model: 1. |
| `tests/agent/test_switch_model_request_overrides.py` | Regression tests for the in-place /model switch (CLI/TUI) carrying a custom provider's request_overrides (extra_body) — _apply_switched_provider_request_overrides. |
| `tests/agent/test_switch_model_rollback.py` | Regression test for #33175: switch_model() must roll back to the pre-swap state if the client rebuild raises. |
| `tests/agent/test_switch_model_stale_base_url.py` | Regression tests for #47828: switch_model must not pair a new provider label with the previous provider's base_url when the resolver returns no new base_url for a ge… |
| `tests/agent/test_synthetic_turn_display_kind.py` | A synthesized turn's row is typed when it is WRITTEN, not when it ends. |
| `tests/agent/test_system_prompt.py` | Tests for agent/system_prompt.py — context-file cwd wiring. |
| `tests/agent/test_system_prompt_restore.py` | Tests for `agent.conversation_loop._restore_or_build_system_prompt`. |
| `tests/agent/test_system_prompt_switch_invalidation.py` | A /model (or route) commit must not null a continuing session's stored system prompt. |
| `tests/agent/test_terminal_approval_batch.py` | Desktop batches publish consent together, never shell effects together. |
| `tests/agent/test_terminal_env_registry.py` | Tests for the terminal environment provider registry + ABC. Mirrors tests/agent/test_image_gen_registry.py in structure. |
| `tests/agent/test_text_turn_incremental_persistence.py` | Behavior contract: a completed pure-text assistant turn is durable before the conversation loop yields control (#81641). |
| `tests/agent/test_think_scrubber.py` | Tests for StreamingThinkScrubber. These tests lock in the contract the scrubber must satisfy so downstream consumers (ACP, api_server, TTS, CLI, gateway) never see r… |
| `tests/agent/test_thinking_only_sanitizer.py` | Tests for the thinking-only assistant message sanitizer. Covers _is_thinking_only_assistant() + _drop_thinking_only_and_merge_users() in run_agent.py. |
| `tests/agent/test_thinking_prefill_trailing_turn.py` | Regression test for the thinking-only prefill reaching the wire. |
| `tests/agent/test_thinking_timeout_guidance.py` | Tests for the reasoning-model thinking-timeout detection + guidance. Two layers: 1. |
| `tests/agent/test_thread_scoped_output.py` | Tests for agent.thread_scoped_output.thread_scoped_silence. |
| `tests/agent/test_title_generator.py` | Tests for agent.title_generator — auto-generated session titles. |
| `tests/agent/test_title_input.py` | Title-only input must not change history, eligibility, or fallback behavior. |
| `tests/agent/test_tls_fd_recycle_corruption.py` | Regressions for issue #29507 — cross-thread close of the per-request OpenAI client could release a TLS socket FD whose integer was still cached in the owning httpx w… |
| `tests/agent/test_token_estimator_shared.py` | Invariant: every rough token estimate in the tree derives from `estimate_tokens_rough` / `CHARS_PER_TOKEN` in `agent/model_metadata.py`, so the `/context` br… |
| `tests/agent/test_token_guard_session_source.py` | The token-accounting guard never mints an anonymous session row (#111999). |
| `tests/agent/test_token_memo_release_on_close.py` | A closed agent's message bodies leave the token-estimate memo. |
| `tests/agent/test_token_persistence_non_cli.py` | Covers test run conversation persists tokens for telegram sessions; test session search lazily opens db when entrypoint did not pass one |
| `tests/agent/test_tool_activity_heartbeat.py` | Tests for the in-flight tool activity heartbeat (#84491). |
| `tests/agent/test_tool_arg_coercion.py` | Tests for tool argument type coercion. When LLMs return tool call arguments, they frequently put numbers as strings ("42" instead of 42) and booleans as strings ("tr… |
| `tests/agent/test_tool_batch_segmentation.py` | Segment-aware mixed tool-batch dispatch. A model response containing several parallel-safe reads plus one unsafe tool used to lose ALL concurrency: `_should_parallel… |
| `tests/agent/test_tool_call_arg_no_redaction.py` | Regression test for #43083. `build_assistant_message` must NOT redact tool-call arguments. |
| `tests/agent/test_tool_call_args_sanitizer.py` | Tests for AIAgent._sanitize_tool_call_arguments. |
| `tests/agent/test_tool_call_guardrail_runtime.py` | Runtime tests for tool-call loop guardrails. |
| `tests/agent/test_tool_dispatch_helpers.py` | Tests for the tool-result message builder — focuses on the untrusted-content delimiter wrapping that hardens against indirect prompt injection (#496). |
| `tests/agent/test_tool_executor_checkpoint_paths.py` | Behavioral coverage for checkpoint path resolution across terminal backends. |
| `tests/agent/test_tool_name_db_persistence.py` | Test that tool_name is correctly persisted to the session DB for tool-result messages. |
| `tests/agent/test_tool_result_classification.py` | Tests for shared tool result classification helpers. |
| `tests/agent/test_tool_result_memory_trim.py` | A >=1 MB tool result hands allocator pages back via `trim_memory` — after the batch (#70684). |
| `tests/agent/test_trace_upload.py` | Tests for agent.trace_upload — Hugging Face session-trace upload. |
| `tests/agent/test_trajectory_file_locking.py` | save_trajectory()` appends must be serialized across processes (#12684). |
| `tests/agent/test_transcript_decoration_idempotence.py` | Idempotence law for transcript decoration passes: f(f(x)) == f(x). |
| `tests/agent/test_transcription_registry.py` | Tests for agent/transcription_registry.py and agent/transcription_provider.py. |
| `tests/agent/test_transform_llm_output_persistence.py` | 44239: what `transform_llm_output` shows the user is what the session stores and replays. |
| `tests/agent/test_treekill_consolidation.py` | 85125 Phase 4d — site-local tree-kills delegate to agent.deadline. |
| `tests/agent/test_truncated_tool_call_boost.py` | Truncation retries must send a larger output budget than the failed request (#72770), without exceeding the model's known output limit (#79715). |
| `tests/agent/test_tts_registry.py` | Tests for agent/tts_registry.py and agent/tts_provider.py. |
| `tests/agent/test_turn_api_call_interrupt.py` | Tests for `agent/turn_api_call.py::handle_api_interrupt` — the plain (non-redirect) interrupt that lands mid provider call and records the streamed partial as the … |
| `tests/agent/test_turn_api_error_stream_parse.py` | jiter SSE parse ValueErrors are transient provider failures, not local bugs (#65147). |
| `tests/agent/test_turn_author.py` | Tests for agent.turn_author: the per-turn author carried from a dispatcher to memory hooks. |
| `tests/agent/test_turn_base_display_anchor.py` | Turn-base display anchor: the context meter shows durable-transcript cost. |
| `tests/agent/test_turn_completion_explainer.py` | Tests for the end-of-turn completion explainer (#34452). |
| `tests/agent/test_turn_context.py` | Unit tests for the extracted turn prologue (`agent/turn_context.py`). |
| `tests/agent/test_turn_context_compaction.py` | Unit tests for `agent.turn_context_compaction` (turn-start compaction extracted from `build_turn_context`). |
| `tests/agent/test_turn_context_overflow_warning.py` | Tests for the silent-context-overflow warning (the fix for the bug where a session crosses the compression threshold but compression is blocked — by the summary-LLM … |
| `tests/agent/test_turn_end_stall_diagnostics.py` | Regression coverage for #131740: the turn-end activity stamp and the watchdog stall stack dump. |
| `tests/agent/test_turn_facade_lease.py` | Unit tests for agent.turn_facade_lease (admission + lease bracket). |
| `tests/agent/test_turn_finalizer_cleanup_guard.py` | Regression test for #8049. When the post-loop cleanup chain in `finalize_turn` raises — trajectory save (file I/O), resource teardown (remote VM/browser), or sessi… |
| `tests/agent/test_turn_finalizer_interrupt_alternation.py` | Regression test for #48879. When a turn is interrupted via `/stop` right after a tool completes — but before the assistant streams any final text — the transcript … |
| `tests/agent/test_turn_finalizer_iteration_limit_exit.py` | Regression tests for iteration-limit exit normalization (#61631). |
| `tests/agent/test_turn_iteration_prep.py` | apply_retry_restarts` bounds the refunding restarts (#106108). |
| `tests/agent/test_turn_liveness.py` | Unit coverage for agent/turn_liveness.py config resolution (#95548/#95663). |
| `tests/agent/test_turn_liveness_watchdog.py` | Turn liveness watchdog (#95548): force-abort turns that stall silently. |
| `tests/agent/test_turn_overlap_tripwire.py` | note_turn_start / note_turn_persisted — the concurrent-turn tripwire. |
| `tests/agent/test_turn_recovery_autorecover.py` | Bounded post-exhaustion auto-recovery ladder (#85426, #107307): fallback first, transient outages only, visible on every surface, interrupt cancels. |
| `tests/agent/test_turn_retry_state.py` | Copilot provider detection used by the turn-retry recovery gates. |
| `tests/agent/test_turn_scripted_prelude.py` | A scripted prelude's tool call id is unique per chat: a rerun of onboarding plays the same name card at the same place in a new chat, and the desktop keys tool rows … |
| `tests/agent/test_turn_summary.py` | Tests for per-turn accounting: summary formatter, collector, spinner flow, gating. |
| `tests/agent/test_turn_usage_log_line.py` | The per-call log line carries what a cost or cache investigation needs: the cache write count, the provider's response id, and the serving upstream when the route re… |
| `tests/agent/test_turn_user_intervened.py` | A turn reports `user_intervened` when the user steered, redirected or interrupted it, even when the correction was fully absorbed and the turn still `completed` … |
| `tests/agent/test_uncompressed_context_guardrail.py` | Uncompressed context overflow guardrail (#89297). When compression is explicitly disabled (`compression.enabled: false`), sessions can grow past the model context … |
| `tests/agent/test_unicode_ascii_codec.py` | Tests for UnicodeEncodeError recovery with ASCII codec. |
| `tests/agent/test_unset_reasoning_effort_default.py` | An unset `agent.reasoning_effort` resolves to `medium` on custom / OpenAI-compatible routes. |
| `tests/agent/test_unsupported_parameter_retry.py` | Regression tests for the generic unsupported-parameter detector in `agent.auxiliary_client`. |
| `tests/agent/test_unsupported_temperature_retry.py` | Regression tests for the universal "unsupported temperature" retry in `agent.auxiliary_client`. |
| `tests/agent/test_usage_anchor.py` | Usage-anchored context accounting (agent/usage_anchor.py). |
| `tests/agent/test_usage_pricing.py` | Covers test astra whole request price tier includes cache writes; test direct first party route prices models missing from snapshot; test normalize usage reads deepseek native cache hit tokens |
| `tests/agent/test_vault_backends.py` | Invariants for external password-manager vault backends (1Password / Bitwarden). Two contracts that must never regress: 1. |
| `tests/agent/test_vault_store.py` | VaultStore._read_all` must surface every decryptable-but-malformed vault file as `VaultError` so callers that catch `VaultError` (the `hermes vault` commands,… |
| `tests/agent/test_verification_continuation_budget.py` | End-to-end regression coverage for verification budget exhaustion (#61631, #65919 §7). |
| `tests/agent/test_verification_evidence.py` | The ledger is inert unless verify-on-stop is enabled; these tests exercise the ledger. |
| `tests/agent/test_verification_evidence_disabled.py` | With verify-on-stop off (the default) the evidence ledger must be fully inert: no recording, no staleness tracking, and no `verification_evidence.db` ever created.… |
| `tests/agent/test_verification_evidence_fd_leak.py` | Regression: the verification-evidence ledger must close every connection. Sibling of the cron execution-ledger leak (#69567 / PR #69594). |
| `tests/agent/test_verification_stop.py` | The ledger is inert unless verify-on-stop is enabled; `clear_verify_env` (requested explicitly, so it runs after this) strips it again for the enabled()-logic test… |
| `tests/agent/test_verification_stop_caching.py` | Verification-loop synthetic scaffolding must never reach durable session state. |
| `tests/agent/test_verify_hooks.py` | Unit tests for the verification-loop policy (agent/verify_hooks.py). |
| `tests/agent/test_vertex_adapter.py` | Tests for the Vertex AI adapter (agent/vertex_adapter.py). Vertex uses OAuth2 (short-lived access tokens from a service-account JSON or ADC), NOT a static API key. |
| `tests/agent/test_video_gen_registry.py` | Tests for agent/video_gen_registry.py — provider registration & active lookup. |
| `tests/agent/test_vision_aware_preprocessing.py` | Tests for the vision-aware image preprocessing in run_agent.py. |
| `tests/agent/test_vision_resolved_args.py` | Test that call_llm vision path passes resolved provider args, not raw ones. |
| `tests/agent/test_vision_routing.py` | Regression tests for issue #31179. Before the fix: - `auxiliary.vision.provider: openai` silently failed to resolve because `openai` is not a first-class provide… |
| `tests/agent/test_vision_tool_messages.py` | Tests for proactive vision-tool-message downgrade (issue #41072). When a provider supports vision in user messages but rejects list-type tool message content (e.g. |
| `tests/agent/test_voice_turn_route.py` | auxiliary.voice_chat`: a voice turn runs on the voice model, the next turn on the main one. |
| `tests/agent/test_wait_notice_cadence.py` | The long-wait status line is one neutral notice per silence, not a 30s warning drumbeat (#92550). |
| `tests/agent/test_wait_state_visibility.py` | Tests for wait-state visibility — the live "what are we waiting on" notices. |
| `tests/agent/test_warning_presentation.py` | Notification policy changes presentation, not diagnostic state or task content. |
| `tests/agent/test_welcome_error_identity.py` | The anonymous UI is a property of the request credential, not a free model or host (#111970). |
| `tests/agent/test_welcome_tier_recovery.py` | Nous free tier, inference side: the dark-tier 403 keyed on the route, the one-shot model move after `model_not_free`, the wrong-host heal, the long-wait rule for s… |
| `tests/agent/test_worker_outbox_adoption.py` | A retained worker outbox follows verified owner adoption (epoch replacement, physical-target rotation) without a second receipt, and is still refused for anything bu… |
| `tests/agent/test_worker_outbox_reopen.py` | A worker reopening an acknowledged-but-unjournaled write reconciles before its next write. |
| `tests/agent/test_worker_rpc_connection_reuse.py` | A managed worker keeps one authenticated owner connection instead of dialing per persistence call. |
| `tests/agent/test_worker_rpc_loop_diagnostic.py` | The on-loop guard names its caller at WARNING (#139029): a best-effort write swallows the raise at debug, and only the sticky follow-up failures reached the logs. |
| `tests/agent/test_worker_rpc_proxy.py` | Private loopback worker persistence does not use ambient HTTP proxies. |
| `tests/agent/test_would_grow_refusal_runway.py` | Regression: a would-grow refusal must not disarm the proactive-prune runway. #91830 follow-up. |
| `tests/agent/transports/__init__.py` | Helper/fixture module (no test cases of its own). |
| `tests/agent/transports/test_bedrock_transport.py` | Tests for the BedrockTransport. |
| `tests/agent/transports/test_chat_completions.py` | Tests for the ChatCompletionsTransport. |
| `tests/agent/transports/test_chat_completions_empty_tool_calls.py` | Tests for empty / null `tool_calls` stripping in ChatCompletionsTransport. |
| `tests/agent/transports/test_chat_completions_reasoning_details_replay.py` | reasoning_details` replay is route-scoped: OpenRouter-format gateways (OpenRouter, Kilo, Vercel AI Gateway, Nous Portal) and vendors documenting it read it; strict … |
| `tests/agent/transports/test_chat_completions_xai_tool_search_alias.py` | Tests for the xAI `tool_search` reserved-name alias (#95003). |
| `tests/agent/transports/test_codex_app_server.py` | Invariants for CodexAppServerClient's transport-loss contract (#87433, #83127). |
| `tests/agent/transports/test_codex_app_server_runtime.py` | Tests for the optional codex app-server runtime gate. These are unit tests for the api_mode rewriter and the wire-level transport module. |
| `tests/agent/transports/test_codex_app_server_session.py` | Tests for CodexAppServerSession — drive turns through a mock client. |
| `tests/agent/transports/test_codex_event_projector.py` | Tests for CodexEventProjector — codex item/* events → Hermes messages list. |
| `tests/agent/transports/test_codex_transport.py` | Tests for the ResponsesApiTransport (Codex). |
| `tests/agent/transports/test_codex_transport_cron_scope.py` | Unified-runtime cron fires share one Codex prompt-cache scope per job (#139434). |
| `tests/agent/transports/test_codex_transport_github_reasoning.py` | GitHub/Copilot Responses reasoning fields on the Codex transport. |
| `tests/agent/transports/test_codex_worker_mcp_overrides.py` | Kanban worker MCP overrides must target the server entry the runtime migration registers. |
| `tests/agent/transports/test_finish_reason_normalization.py` | Uppercase wire finish reasons (STOP / MAX_TOKENS from Gemini-fronting OpenAI-compatible gateways) must fold to the lowercase OpenAI contract at both wire-intake chok… |
| `tests/agent/transports/test_hermes_tools_mcp_server.py` | Tests for the hermes-tools-as-MCP server module surface. |
| `tests/agent/transports/test_meta_codex_cache.py` | Tests for Meta api.meta.ai prompt_cache_retention and transport plumbing. |
| `tests/agent/transports/test_plugin_transport_api_mode.py` | A provider plugin's own `api_mode` reaches the runtime transport (#53054). |
| `tests/agent/transports/test_profile_hook_keyword_compat.py` | A plugin profile's `build_api_kwargs_extras` written against the older keyword set keeps working. |
| `tests/agent/transports/test_provider_wire_snapshot.py` | Golden wire snapshot: the exact request every registered provider is sent. |
| `tests/agent/transports/test_reasoning_effort_sibling_sites.py` | Sibling-site coverage for the reasoning-effort wire-vocabulary class (#89503). |
| `tests/agent/transports/test_router_codex_efforts.py` | Router catalog-declared reasoning-effort clamping on the codex transport. |
| `tests/agent/transports/test_transport.py` | Tests for the transport ABC, registry, and AnthropicTransport. |
| `tests/agent/transports/test_types.py` | Tests for agent/transports/types.py — dataclass construction + helpers. |
| `tests/tools/__init__.py` | Helper/fixture module (no test cases of its own). |
| `tests/tools/_child_env_fixtures.py` | Isolated, real processes for the child-environment contract tests. |
| `tests/tools/conftest.py` | Shared fixtures for tests/tools/ web-provider tests. |
| `tests/tools/environments/__init__.py` | Helper/fixture module (no test cases of its own). |
| `tests/tools/environments/test_local_path_completion.py` | Terminal-subshell PATH completion in `tools/environments/local.py`. |
| `tests/tools/file_ops_fakes.py` | Fakes for `ShellFileOperations`' compound shell probes. |
| `tests/tools/test_a2a_reason_roundtrip.py` | Tests: typed reason codes survive the A2A relay roundtrip (#93091). |
| `tests/tools/test_accretion_caps.py` | Accretion caps for _read_tracker (file_tools) and _completion_consumed (process_registry). |
| `tests/tools/test_allowlist_legacy_config.py` | Covers test legacy string allowlist recovers only string lists; test malformed allowlist does not grant approval |
| `tests/tools/test_allowlist_quoted_metachars.py` | Tests for the quote-aware allowlist shell-operator check. Port of can1357/oh-my-pi#7553: `command_allowlist` glob rules (e.g. |
| `tests/tools/test_annotate_preview_tool.py` | Tests for the GUI-surface `annotate_preview` tool. |
| `tests/tools/test_ansi_strip.py` | Comprehensive tests for ANSI escape sequence stripping (ECMA-48). |
| `tests/tools/test_approval_bun_deno_eval.py` | Bun and Deno evaluate inline scripts through forms the interpreter flag tables did not know: `bun -e/--eval`, and Deno's bare `eval` subcommand (`deno eval "cod… |
| `tests/tools/test_approval_cancelled_attribution.py` | A gateway approval wait that ends without a user answer must not be reported as a user deny. |
| `tests/tools/test_approval_config_readonly.py` | Regression tests: the approval guard path reads config via load_config_readonly() (no per-call deepcopy). The guard path runs per terminal command. |
| `tests/tools/test_approval_deny_rules.py` | Tests for user-defined deny rules (approvals.deny in config.yaml). approvals.deny is a list of fnmatch globs matched against terminal commands. |
| `tests/tools/test_approval_gateway_wait_coalesce_race.py` | Coalesced gateway approvals under concurrent leader/follower threads. |
| `tests/tools/test_approval_gateway_wait_late_choice.py` | A gateway approval choice that lands after the deadline check is an answer, not a timeout (#112548). |
| `tests/tools/test_approval_global_flag_scan.py` | Global-flag rules must terminate on long flag runs without dropping long commands (#129281). Subprocess timeout bounds regressions without hanging pytest on the GIL. |
| `tests/tools/test_approval_grep_in_substitution.py` | A grep nested inside a command substitution must lex as its own simple command. |
| `tests/tools/test_approval_hook_session_id.py` | Approval hooks must carry the Hermes session id to observer plugins. |
| `tests/tools/test_approval_interrupt.py` | Regression: a blocking gateway approval wait must honor an interrupt (#8697). |
| `tests/tools/test_approval_launchctl_performance.py` | Long non-launchctl inputs must not starve other Gateway threads. Subprocess timeout bounds regressions without hanging pytest on the GIL. |
| `tests/tools/test_approval_lifecycle_guard_parity.py` | Parity between the approval layer and the in-gateway lifecycle hard block (launchctl verbs). |
| `tests/tools/test_approval_mode_parity.py` | Cross-surface approval mode/timeout parity invariant. |
| `tests/tools/test_approval_outcome_parity.py` | Gateway-tail outcome parity + sudo human-wait exclusion (#85125 Phase 2e). |
| `tests/tools/test_approval_plugin_hooks.py` | Tests for pre_approval_request / post_approval_response plugin hooks. |
| `tests/tools/test_approval_timeout_overflow.py` | Regression tests for #83220: oversized approvals.timeout must never overflow platform wait primitives (macOS time_t OverflowError). |
| `tests/tools/test_approval_unattended_presence.py` | Unattended-platform runs resolve flagged commands from `approvals.unattended_mode` unless a client can actually answer the card. |
| `tests/tools/test_approval_user_summary.py` | Approval and background-task outcomes carry one plain sentence for the person at the keyboard. The model-facing `BLOCKED: ... |
| `tests/tools/test_approval_windows.py` | Windows destructive-command approval coverage (#69472). |
| `tests/tools/test_approval_yolo.py` | The session /yolo contract every surface shares (`tools.approval_yolo`): a toggle persists before it flips the live flag, a fresh process re-arms it from the store… |
| `tests/tools/test_approved_command_clean_slate.py` | Regression tests: a user-approved command runs from a clean interrupt slate. |
| `tests/tools/test_async_batch_task_failure_notice.py` | A failed child of a still-running detached fan-out is surfaced to the parent immediately. |
| `tests/tools/test_async_delegation.py` | Tests for async (background) delegation — tools/async_delegation.py. |
| `tests/tools/test_async_delegation_failed_surface.py` | Failed async delegations stay visible after the live roster forgets them (#97202). |
| `tests/tools/test_async_delegation_fd_leak.py` | Regression: the async-delegation ledger must close every SQLite connection. Sibling of the cron execution-ledger leak (#69567 / PR #69594). |
| `tests/tools/test_async_delegation_orphan_sweep.py` | A completion whose owner process died is re-offered by processes that are ALREADY running (#97202). |
| `tests/tools/test_async_delegation_requeue.py` | An acknowledged completion goes back to the delivery queue when its turn could not confirm the owner. |
| `tests/tools/test_async_delegation_retirement.py` | Background delegations cannot outlive the admission proof used to retire their process. |
| `tests/tools/test_async_delegation_stale_profile_scope.py` | Profile-scope regression for async-delegation stale finalization. |
| `tests/tools/test_async_delegation_worker.py` | Closed ledger authority and token-guarded retry contracts. |
| `tests/tools/test_async_delegation_worker_routing.py` | Worker routing never falls through to raw canonical SQLite. |
| `tests/tools/test_audio_container.py` | Tests for the shared magic-byte audio container sniffer. |
| `tests/tools/test_base_environment.py` | Tests for BaseEnvironment unified execution model. Tests _wrap_command(), _extract_cwd_from_output(), _embed_stdin_heredoc(), init_session() failure handling, and th… |
| `tests/tools/test_binary_document_write_guard.py` | Tests for the binary-document write guard (port of nearai/ironclaw#7109). |
| `tests/tools/test_blocked_command_guidance.py` | Tests for blocked-command recovery guidance (parser-limit + backgrounding). |
| `tests/tools/test_blueprints.py` | Tests for the blueprints layer (skill frontmatter <-> cron automation bridge). A blueprint is a skill with a metadata.hermes.blueprint block. |
| `tests/tools/test_bot_delivery_install_launcher.py` | Bot deliveries must not pin the caller's obsolete dependency generation. |
| `tests/tools/test_bot_desktop_browser.py` | The dock's Browser and agent-browser resolve to one identity: same executable, same user-data-dir — and when a human opened that browser first, the agent attaches to… |
| `tests/tools/test_bot_desktop_browser_fence.py` | The bot's browser tools obey the screen lease: while a human holds the shared browser, nothing is dispatched, and a command whose run crossed a takeover loses its re… |
| `tests/tools/test_bot_desktop_idle.py` | Bot Desktop idle auto-stop: a screen nobody used past `bot_desktop.idle_stop_minutes` is stopped, one a human holds or that saw recent use is not. |
| `tests/tools/test_bot_desktop_install.py` | Bot Desktop package install: sudo hand-off and single-flight invariants. |
| `tests/tools/test_bot_desktop_launcher_seed.py` | Bot Desktop launcher seeds: the dock only points at programs that exist, the look is applied. |
| `tests/tools/test_bot_desktop_launcher_xvnc.py` | The Bot Desktop's Xvnc is started with the RFB options the lease design relies on. |
| `tests/tools/test_bot_desktop_lease.py` | Bot Desktop invariants: the byte-level RFB input gate follows the lease, and computer_use refuses every action (capture included) while a human holds the screen. |
| `tests/tools/test_bot_desktop_placement.py` | Bot Desktop placement: the screen (and with it computer_use and the browser) follows the terminal backend. |
| `tests/tools/test_bot_desktop_resources.py` | Bot Desktop memory gate: the screen is refused, with a reason clients can show, while the host cannot spare `bot_desktop.min_free_memory_mb`; a host we cannot read… |
| `tests/tools/test_bot_desktop_rfb_filter_limits.py` | RFB client-message framing at the bridge: a client-declared ClientCutText length is bounded at the header (the bridge must not buffer up to 2 GiB for a viewer that h… |
| `tests/tools/test_bot_desktop_runtime.py` | Bot Desktop runtime: thumbnail and display-number allocation invariants. |
| `tests/tools/test_bot_desktop_thumbnail.py` | thumbnail_data_url` swaps the process-wide XAUTHORITY around the grab; two profiles grabbed on worker threads at once must each see their own cookie file, not the o… |
| `tests/tools/test_bot_dm_payload_cache.py` | DM payload files must be reaped by gateway housekeeping, not only in-band. |
| `tests/tools/test_bot_failure_reasons.py` | Tests: typed failure-reason codes (tools/bot_failure_reasons.py, #93091). Pins the closed reason vocabulary, the ordered classifier (incl. |
| `tests/tools/test_bot_legacy_producer.py` | A stale owner advertisement must never create another execution queue. |
| `tests/tools/test_bot_live_delivery_windows_acl.py` | 139485 / #138872 on real Windows ACLs. The reporters' mailbox dir was created by an elevated process: owner BUILTIN\\Administrators, a DACL with no entry for the use… |
| `tests/tools/test_bot_live_owner_delivery.py` | Canonical delivery invariants: stable envelope IDs, authority-only admission, immutable receipts. The mailbox is receipt storage, never an execution queue. |
| `tests/tools/test_bot_mode_canonical_chat_resolution.py` | Property-style regression suite: Bot Mode canonical-chat resolution algebra. |
| `tests/tools/test_bot_mode_dm.py` | Tests for tools/bot_mode_dm.py — the Bot-Chat-only `message_agent` tool. |
| `tests/tools/test_bot_mode_dm_entry.py` | The `bot_mode_dm.py` runner entry boots Hermes' dependency environment itself. |
| `tests/tools/test_bot_mode_probe.py` | Tests for tools/bot_mode_probe.py — the Bot Mode teammate-protocol section. |
| `tests/tools/test_bot_mode_refusal_contract.py` | Covers test one shot cli preserves refusal reason |
| `tests/tools/test_bot_no_fallback.py` | Unavailable authority is a refusal, never permission for another executor. |
| `tests/tools/test_bot_profile_relay.py` | Relay discovery and mailbox ownership are profile scoped. |
| `tests/tools/test_bot_receipt_read_lock.py` | Receipt polling joins the writer's short lock even when replacement rewrites in place. |
| `tests/tools/test_bot_relay.py` | Tests: cross-connection bot relay (tools/bot_relay.py + message_agent route). |
| `tests/tools/test_bot_relay_windows_paths.py` | Windows-path viability and venv CLI resolution for bot relay (#93590). Two failures on a Windows desktop install talking to a remote gateway: 1. |
| `tests/tools/test_bot_reply_receipt.py` | A relay reply is an immutable delivery receipt, not a last-writer-wins file. |
| `tests/tools/test_bot_retry_policy.py` | Tests: bot-turn retry session policy (#93091 item 5). Maintainer ruling (2026-08-23): a retried bot turn never mints a fresh session. |
| `tests/tools/test_bot_turn_lock.py` | Tests: per-profile bot turn lock (#93091 — tools/bot_relay.py). |
| `tests/tools/test_browser_camofox.py` | Tests for the Camofox browser backend. |
| `tests/tools/test_browser_camofox_auth.py` | Tests that Camofox browser sends Authorization header when CAMOFOX_API_KEY is set. Regression test for https://github.com/NousResearch/hermes-agent/issues/20476 |
| `tests/tools/test_browser_camofox_ensure_tab.py` | Regression test: _ensure_tab must send `listItemId` (not `sessionKey`). The Camoufox REST API server requires `listItemId` in the `POST /tabs` body. |
| `tests/tools/test_browser_camofox_persistence.py` | Persistence tests for the Camofox browser backend. Tests that managed persistence uses stable identity while default mode uses random identity. |
| `tests/tools/test_browser_camofox_private_page_guard.py` | Regression tests for the Camofox private-page read guards. |
| `tests/tools/test_browser_camofox_state.py` | Tests for Hermes-managed Camofox state helpers. |
| `tests/tools/test_browser_camofox_timeout.py` | Tests for browser_camofox._get_command_timeout — config-driven timeout. |
| `tests/tools/test_browser_cdp_override.py` | Covers test keeps full devtools websocket url; test redacts secret query params in success log; test redacts secret query params in failure log |
| `tests/tools/test_browser_cdp_tool.py` | Unit tests for browser_cdp tool. Uses a tiny in-process `websockets` server to simulate a CDP endpoint — gives real protocol coverage (connect, send, recv, close) … |
| `tests/tools/test_browser_cleanup.py` | Regression tests for browser session cleanup and screenshot recovery. |
| `tests/tools/test_browser_cloud_fallback.py` | Tests for cloud browser provider runtime fallback to local Chromium. |
| `tests/tools/test_browser_cloud_provider_cache.py` | Tests for `_get_cloud_provider()` caching policy. Regression coverage for issue #22324: a transient `None` from the resolver must not be cached for the lifetime … |
| `tests/tools/test_browser_command_timeout_race.py` | Regression tests for the _get_command_timeout cache race (#14331). |
| `tests/tools/test_browser_computer_use_profile_cache_keys.py` | Browser-exec and computer_use backend caches are namespaced by the served profile. |
| `tests/tools/test_browser_console.py` | Tests for browser_console tool and browser_vision annotate param. |
| `tests/tools/test_browser_console_ssrf.py` | Tests that browser_console blocks console messages and errors from eval-navigated private pages. |
| `tests/tools/test_browser_env_loopback_no_proxy.py` | Loopback CDP dials must never go through a proxy (#110565). |
| `tests/tools/test_browser_eval_shim_args.py` | agent-browser CLI arguments must survive the Windows `.cmd` shim hop (#113838): cmd.exe re-parses the child command line, so a newline truncates an argument to its… |
| `tests/tools/test_browser_eval_ssrf.py` | Tests that browser_console(expression=...) cannot bypass the SSRF guard. |
| `tests/tools/test_browser_eval_supervisor_path.py` | Unit tests for the supervisor-WS fast path in browser_console / _browser_eval. |
| `tests/tools/test_browser_extension_router.py` | Covers test feature off calls existing backend once without touching broker; test bound request without exact capable controller fails closed; test stamped identity without registered lane keeps legacy backend |
| `tests/tools/test_browser_extension_router_wiring.py` | Wiring regression tests for the browser extension router. |
| `tests/tools/test_browser_get_images_ssrf.py` | Tests that browser_get_images blocks image data from eval-navigated private pages. |
| `tests/tools/test_browser_hardening.py` | Tests for browser_tool.py hardening: caching, security, thread safety, truncation. |
| `tests/tools/test_browser_headed_mode.py` | Tests for headed browser mode: config/env resolution, --headed injection, and the per-turn cleanup skip that keeps headed sessions alive between turns. |
| `tests/tools/test_browser_hybrid_routing.py` | Tests for hybrid browser-backend routing (LAN/localhost auto-local). |
| `tests/tools/test_browser_lightpanda.py` | Tests for Lightpanda engine support in browser_tool.py. |
| `tests/tools/test_browser_lightpanda_serve.py` | Tests for tools/browser_lightpanda.py — the `lightpanda serve` launcher Browser Use mode uses when `browser.engine` is `lightpanda`. |
| `tests/tools/test_browser_open_timeout.py` | Tests for browser first-open timeout and timeout diagnostics. |
| `tests/tools/test_browser_orphan_reaper.py` | Tests for _reap_orphaned_browser_sessions() — kills orphaned agent-browser daemons whose Python parent exited without cleaning up. |
| `tests/tools/test_browser_pm.py` | Browser consumers use real PM facts, not ambient npm caches. |
| `tests/tools/test_browser_private_page_action_guard.py` | Regression tests for private-page browser interaction guards. |
| `tests/tools/test_browser_process_tree.py` | Browser cleanup fallback contracts, retained after retiring the npx warmer. |
| `tests/tools/test_browser_profile_live_cdp.py` | CLI-9 (#134889): a live `/browser connect` belongs to ONE profile on a multiplexed gateway. |
| `tests/tools/test_browser_profile_scope_edges.py` | GW-23 (#134889): per-profile browser scope edges left after CLI-9. |
| `tests/tools/test_browser_real_profile.py` | Tests for real-profile browsing: resolvers, snapshot, launch routing, consent. |
| `tests/tools/test_browser_real_profile_pin.py` | Tests for the LOCAL real_profile_pin patch (browser.real_profile_pin). |
| `tests/tools/test_browser_redact_depth.py` | Page-controlled JSON must not crash browser output redaction (#137067). |
| `tests/tools/test_browser_secret_exfil.py` | Tests for secret exfiltration prevention in browser and web tools. |
| `tests/tools/test_browser_snapshot_ssrf.py` | Tests that browser_snapshot blocks content from eval-navigated private pages. |
| `tests/tools/test_browser_snapshot_threshold.py` | Behavior tests for config-driven browser snapshot thresholds. |
| `tests/tools/test_browser_ssrf_local.py` | Tests that browser_navigate SSRF checks respect local-backend mode and the allow_private_urls setting. |
| `tests/tools/test_browser_supervisor.py` | Integration tests for tools.browser_supervisor. Exercises the supervisor end-to-end against a real local Chrome (`--remote-debugging-port`). |
| `tests/tools/test_browser_supervisor_capture.py` | Behavior contract for `SUPERVISOR_REGISTRY.capture` (public CDP seam for trusted plugins). |
| `tests/tools/test_browser_supervisor_capture_dispatch.py` | Dispatch/lossless-wait extension exercised through the real public capture API. |
| `tests/tools/test_browser_supervisor_healthcheck.py` | Unit tests for _SupervisorRegistry cache-hit healthcheck. |
| `tests/tools/test_browser_supervisor_reconnect.py` | CDPSupervisor reconnect budget: a supervisor that attached once must not retry a dead endpoint forever (#114172). No real Chrome — `websockets.connect` is stubbed. |
| `tests/tools/test_browser_suspect_recycle.py` | Tests for #85125 Phase 3b (browser) + 4c: suspect-session recycle after a command timeout (#72205, salvaging #72206) and daemon tree-kill on the wedged path (#68139)… |
| `tests/tools/test_browser_type_redaction.py` | Regression tests for browser_type display redaction. |
| `tests/tools/test_browser_use_cli.py` | Tests for the Browser Use CLI 3.0 backend (tools/browser_use_cli.py). |
| `tests/tools/test_browser_use_harness.py` | Browser Use caller -> browser-harness on Hermes's own interpreter -> actual child. |
| `tests/tools/test_browser_use_session_expiry.py` | Regression coverage for provider-authoritative cloud browser expiry. |
| `tests/tools/test_browser_vault.py` | Tests for the vault-backed password-blind browser autofill feature. |
| `tests/tools/test_browser_windows_headless.py` | Regression for #64867: local Chromium stays headless on Windows Desktop. |
| `tests/tools/test_budget_config.py` | Unit tests for tools/budget_config.py. Covers default values, resolve_threshold() priority chain (pinned > tool_overrides > registry > default), immutability, and th… |
| `tests/tools/test_build_subprocess_env.py` | Real children observe factory scrubbing, overrides and routed profile homes. |
| `tests/tools/test_capability_fingerprint_skill_scope.py` | The capability epoch tracks the skills the model can actually invoke. |
| `tests/tools/test_checkpoint_footprint_notice.py` | checkpoint_footprint_notice`: tells a user their /rollback store is on and large. |
| `tests/tools/test_checkpoint_gitlinks.py` | Real-Git rollback contracts for checkpoints containing uncaptured gitlinks. |
| `tests/tools/test_checkpoint_manager.py` | Tests for tools/checkpoint_manager.py — CheckpointManager (v2 single-store). |
| `tests/tools/test_checkpoint_path_roundtrip.py` | Checkpoint file names must survive Git's machine-readable path output. |
| `tests/tools/test_checkpoint_size_cap.py` | Real history retention and failure propagation at the public pruning callers. |
| `tests/tools/test_checkpoint_store_ownership.py` | Maintenance cannot prune objects another checkpoint process has not published. |
| `tests/tools/test_clarify_gateway.py` | Tests for the gateway-side clarify primitive (tools/clarify_gateway.py). |
| `tests/tools/test_clarify_tool.py` | Tests for tools/clarify_tool.py - Interactive clarifying questions. |
| `tests/tools/test_clawhub_owner_http.py` | Owner-qualified ClawHub fetches retain identity across actual HTTP requests. |
| `tests/tools/test_clawhub_zip_stream.py` | Bound the archive before extraction, without buffering response.content. |
| `tests/tools/test_cli_approval_exec_ask_leak.py` | Regression: interactive CLI must not lose the Dangerous Command panel. |
| `tests/tools/test_clipboard.py` | Tests for clipboard image paste — clipboard extraction, multimodal conversion, and CLI integration. |
| `tests/tools/test_close_preview_tool.py` | Tests for the GUI-surface `close_preview` tool. |
| `tests/tools/test_code_execution.py` | Tests for the code execution sandbox (programmatic tool calling). |
| `tests/tools/test_code_execution_file_rpc.py` | Generated stubs and the production file poller over real shell/filesystem I/O. |
| `tests/tools/test_code_execution_hermes_home.py` | execute_code child env honors the multiplexed per-turn HERMES_HOME override (#110303). |
| `tests/tools/test_code_execution_modes.py` | Real interpreter, environment and RPC contracts for both execution modes. |
| `tests/tools/test_code_execution_pm_runtime.py` | PM runtime dependencies survive the kernel child boundary (#124049). |
| `tests/tools/test_code_execution_windows_env.py` | Windows essentials and the native Winsock control. Actual production UTF-8 env and Unicode RPC are exercised in `test_code_execution_modes.py`; never reproduce the p… |
| `tests/tools/test_code_kernel.py` | Tests for execute_code's session kernel. Session kernels are always on (the `code_execution.kernel_mode` key is retired): each (task, mode, interpreter, cwd, tool-… |
| `tests/tools/test_code_kernel_remote.py` | Remote session kernels (tools/code_kernel_remote.py) — hermes-agent#96873. |
| `tests/tools/test_command_guards.py` | Tests for check_all_command_guards() — the combined floor + dangerous-command guard. |
| `tests/tools/test_compaction_tool_refresh.py` | Compaction rebuilds dynamic tool schemas (forever-session fix, #95681 arc). |
| `tests/tools/test_completed_process_results.py` | Completed work remains retrievable when its finite CLI owner exits. |
| `tests/tools/test_computer_use.py` | Tests for the computer_use toolset (cua-driver backend, universal schema). |
| `tests/tools/test_computer_use_approval_isolation.py` | computer_use approval is the shared `tools.approval` gate — no private grant store, no default-allow. |
| `tests/tools/test_computer_use_ax_walk_bound.py` | Bound on the driver's accessibility-tree walk per capture (`computer_use.ax_max_elements`). |
| `tests/tools/test_computer_use_backend_lifecycle.py` | Backend admission during Bot Screen rebind/release; extracted from #114565 for #108914. |
| `tests/tools/test_computer_use_backend_plugins.py` | Computer-use provider plugins: `computer_use.backend` selects exactly one provider per profile, only that one is imported, the built-in `cua` stays the default, … |
| `tests/tools/test_computer_use_backend_rebind.py` | A cached computer_use backend is bound to the display it spawned on; the identity helpers notice a change. |
| `tests/tools/test_computer_use_capture_fence.py` | A frame captured across a human takeover never leaves the process: the lease fence runs as soon as the backend hands the frame back, before it is persisted to the me… |
| `tests/tools/test_computer_use_capture_routing.py` | End-to-end regression for #24015 — capture routing via auxiliary.vision. |
| `tests/tools/test_computer_use_capture_self_window.py` | Capture target selection must never implicitly target Cua Driver itself. |
| `tests/tools/test_computer_use_cua_0_10_permissions.py` | Behavior contracts for cua-driver 0.10 permission-mode integration. |
| `tests/tools/test_computer_use_cua_0_9.py` | Behavior contracts for cua-driver's verify/escalate and typed-browser ladder. |
| `tests/tools/test_computer_use_cua_backend_linux.py` | Regression tests for Linux/X11 capture target selection (#58026, #54173). |
| `tests/tools/test_computer_use_cua_macos_identity.py` | macOS CuaDriver.app path and signing identity contracts. |
| `tests/tools/test_computer_use_delivery_ladder.py` | Regression tests for the cua-driver verify → escalate ladder. |
| `tests/tools/test_computer_use_display_count_guard.py` | macOS ScreenCaptureKit display_count=0 diagnosability. |
| `tests/tools/test_computer_use_doctor_stale_units.py` | hermes computer-use doctor` names a daemon unit whose cua-driver Exec target was pruned, and a configured `cua-driver serve` unit whose daemon is not listening (#114… |
| `tests/tools/test_computer_use_empty_discovery_diagnosis.py` | Diagnosability of empty window discovery + CLI-fallback fail-fast. Live-QA findings (Aug 2026, locked KDE desktop): 1. |
| `tests/tools/test_computer_use_fullscreen_capture.py` | Full-screen vs desktop-shell capture routing (#60081, wallpaper-only bug). |
| `tests/tools/test_computer_use_input_target_guard.py` | Input actions must not silently deliver to a different app than requested. |
| `tests/tools/test_computer_use_native_platform.py` | Exercise existing computer-use actions on the actual Windows/macOS CI hosts. |
| `tests/tools/test_computer_use_null_pid_windows.py` | Regression for the X11 null-PID `list_windows` crash. |
| `tests/tools/test_computer_use_placeholder_ids.py` | A zero-filled `pid`/`window_id` must not be read as exact targeting. |
| `tests/tools/test_computer_use_screenshot_dedup.py` | Screenshot dedup — unchanged frames are delivered without their image. |
| `tests/tools/test_computer_use_zero_bounds.py` | Zero-rect AX bounds must read as 'unknown', never as a clickable position. |
| `tests/tools/test_computer_use_zero_delivery_verdict.py` | Zero-delivery `type` verdict: web inputs behind trusted-event checks swallow synthetic keystrokes entirely (delivered 0 of N). |
| `tests/tools/test_config_null_guard.py` | Tests for config.get() null-coalescing in tool configuration. |
| `tests/tools/test_connector_accounts.py` | Several accounts of one connector, each addressed by its name (alias). |
| `tests/tools/test_connector_bridge_wiring.py` | Behavior tests for the connector leg of the tool_search bridge. |
| `tests/tools/test_connector_dispatch_policy.py` | Real connector dispatch must run policies against each composed name. |
| `tests/tools/test_connector_files.py` | Connector file inputs and outputs: the model passes local paths, the agent stages them through the tool gateway and storage, and files a tool returns are saved under… |
| `tests/tools/test_connector_local_batches.py` | Local deferred tools retain the live agent path; batches must not bypass it. |
| `tests/tools/test_connector_names.py` | Invariant tests for model-facing connector names and wire-slug recovery. |
| `tests/tools/test_connector_session_scope.py` | Connector capabilities follow session grants, not process-wide credentials. |
| `tests/tools/test_connector_wire_identity.py` | Caller identity on connector requests: the User-Agent always, correlation ids only with consent, the gateway's request id logged on every outcome, and `initiator` … |
| `tests/tools/test_connectors_catalog.py` | manage_catalog` (catalog install through the connection card). |
| `tests/tools/test_connectors_contract.py` | Connection contract: target states, who may cause each transition, settle reasons. The transition table is the single statement of the operation's lifecycle. |
| `tests/tools/test_connectors_display.py` | manage_connections` action `display`: the desktop directory card. |
| `tests/tools/test_connectors_execute_status.py` | Single-call execute: every failure status becomes the call's own error entry, the model-facing shape stays what the array envelope produced, and an older gateway sti… |
| `tests/tools/test_connectors_gateway_client.py` | Behavior tests for ConnectorClient and the bridge entry points. |
| `tests/tools/test_connectors_gateway_merge.py` | Behavior tests for the pure connectors.gateway merge/partition/name logic. |
| `tests/tools/test_connectors_gateway_wire.py` | Gateway wire model: the status vocabulary the gateway sends is typed, unknown values fail loud, and the execute-path CONNECTION_REQUIRED error carries a link only wh… |
| `tests/tools/test_connectors_guest_on_first_use.py` | A guest identity for connectors is created on the first hosted connector action. |
| `tests/tools/test_connectors_import_deadlock.py` | Regression tests for the `tools.connectors` import surface. |
| `tests/tools/test_connectors_live.py` | Live operation registry: one open op per session, found by op_id, closed on settle. |
| `tests/tools/test_connectors_managed.py` | Managed connectors on the connection operation. Contracts: - connect/reconnect mint ONE operation, block the turn via the callback, return per-target outcomes; links… |
| `tests/tools/test_connectors_mcp.py` | MCP targets of manage_connections (the fold that retired setup_mcp). |
| `tests/tools/test_connectors_operation.py` | Connection operation: transitions checked against the contract, exactly-once settlement, server-owned deadline as a constant, wake on every change. |
| `tests/tools/test_connectors_tool.py` | Behavior tests for manage_connections. DI-callable idiom: a fake client injected through manage_connections' seams; no module mocks, no network. |
| `tests/tools/test_container_cwd_sanitize.py` | Regression tests for host-path cwd sanitization on container backends. |
| `tests/tools/test_credential_files.py` | Tests for credential file passthrough and skills directory mounting. |
| `tests/tools/test_credential_pool_env_fallback.py` | Tests for credential_pool .env fallback and auth credential_pool lookup. |
| `tests/tools/test_cron_approval_mode.py` | Tests for approvals.cron_mode — configurable approval behavior for cron jobs. |
| `tests/tools/test_cron_not_interactive.py` | Unattended approval contexts never resolve as interactive (#110932). |
| `tests/tools/test_cron_prompt_injection.py` | Regression tests for cron prompt injection scanner bypass. |
| `tests/tools/test_cronjob_job_args.py` | Tests for tools/cronjob_job_args.py::_validate_cron_script_path (issue #105761). |
| `tests/tools/test_cronjob_run_background.py` | Tests for cronjob action='run' background dispatch. A manual `cronjob(action='run')` used to execute the job synchronously on the calling agent's tool thread — a ful… |
| `tests/tools/test_cronjob_run_delivery_notice.py` | Honesty of the manual-run delivery notice (issue #83993). |
| `tests/tools/test_cronjob_run_immediate.py` | Tests for cronjob action='run' immediate execution (#41037). |
| `tests/tools/test_cronjob_run_primary_routed.py` | Manual runs of a satellite job that delivers through the primary gateway's profile route. Regression for #120330. |
| `tests/tools/test_cross_profile_guard.py` | Tests for the cross-profile soft guard wired into write_file / patch / skill_manage. The classifier is tested in tests/agent/test_file_safety_cross_profile.py. |
| `tests/tools/test_daemon_pool.py` | Tests for tools.daemon_pool.DaemonThreadPoolExecutor. |
| `tests/tools/test_daytona_environment.py` | Unit tests for the Daytona cloud sandbox environment backend. |
| `tests/tools/test_debug_helpers.py` | Tests for tools/debug_helpers.py — DebugSession class. |
| `tests/tools/test_deferral_fixes.py` | Deferral-layer fixes: behavior regression suite. Each test class pins one user-visible behavior that was broken while the tool_search bridge was active. |
| `tests/tools/test_delegate_apiserver_background.py` | delegate_task(background=true) on stateless API-server sessions. |
| `tests/tools/test_delegate_batch_tag.py` | Batch tag on delegation progress lines (#p1-campaign feedback, Sep 2026). |
| `tests/tools/test_delegate_batch_validation.py` | Batch input validation for delegate_task(tasks=[...]). |
| `tests/tools/test_delegate_capability_inheritance.py` | Subagent capability inheritance (follow-up to #94036/#97292). |
| `tests/tools/test_delegate_capacity_interrupt.py` | A rejected background batch retains synchronous cancellation ownership. |
| `tests/tools/test_delegate_child_cache_ttl.py` | Subagents never inherit the 1h prompt-cache tier: with `prompt_caching.cache_ttl: 1h` the parent keeps 1h, the child is built at 5m, and the child's wire markers c… |
| `tests/tools/test_delegate_child_compression_cap.py` | delegation.compression_threshold_tokens` is an OPTIONAL absolute cap on a subagent's compaction trigger, off by default, and its value is validated rather than coer… |
| `tests/tools/test_delegate_child_transcript_release.py` | Finished delegate children must not pin their transcripts in the parent heap. |
| `tests/tools/test_delegate_completion_model.py` | The async completion header names the model the children actually run on. |
| `tests/tools/test_delegate_composite_toolsets.py` | Tests for composite toolset expansion in delegate_task intersection. |
| `tests/tools/test_delegate_control_actions.py` | delegate_task(action=...) — model-facing live orchestration of subagents. |
| `tests/tools/test_delegate_cost_footer.py` | Per-delegation cost in the serialized result entry. Each entry in the results array returned to the parent model should carry the child's spend (cost_usd + cost_stat… |
| `tests/tools/test_delegate_cron_sync_fallback.py` | Regression test for #86632: cron's synchronous delegate_task fallback must return after the child completes — the automatic background review must not fire inside th… |
| `tests/tools/test_delegate_depth_prompt.py` | Child-facing nesting guidance must agree with depth-derived capability. |
| `tests/tools/test_delegate_external_provider.py` | A selected external-process provider must survive child command resolution. |
| `tests/tools/test_delegate_failure_copy.py` | Subagent failure lines gloss the classified `failure_reason` instead of echoing the child's raw exception, and always name the next step (/agents). |
| `tests/tools/test_delegate_fallback_matrix.py` | Pin x delegation.fallback_providers decision table for child agents (#80450, #65038). |
| `tests/tools/test_delegate_group_schema.py` | Grouping is advertised only when the delivery policy consumes it. |
| `tests/tools/test_delegate_images.py` | Per-task image forwarding on delegate_task: a task's `images` (local paths, http(s) or data: URLs) reach a vision-capable child as native `image_url` content par… |
| `tests/tools/test_delegate_interrupted_partial_output.py` | Invariant: a child stopped mid-work reports what it HAD so far. |
| `tests/tools/test_delegate_kanban_isolation.py` | Regression tests for delegate_task isolation from parent Kanban workers. |
| `tests/tools/test_delegate_late_child_inherits_stop.py` | A stop that lands on an orchestrator subagent mid-fan-out reaches every grandchild it builds afterwards. |
| `tests/tools/test_delegate_liveness_timeout.py` | delegation.child_timeout_seconds` bounds INACTIVITY, not total runtime (#116001). |
| `tests/tools/test_delegate_native_vision.py` | Delegated children keep the route identity required by native vision. |
| `tests/tools/test_delegate_output_schema.py` | T1-24: structured-output schema on delegate_task. Per-task `output_schema` (JSON Schema object): the child receives the schema as an explicit output contract, the … |
| `tests/tools/test_delegate_parallel_interrupt_join.py` | A wedged child must not hold the parent past an interrupt (#116435). |
| `tests/tools/test_delegate_request_overrides.py` | Regression tests for the delegation.request_overrides config key. |
| `tests/tools/test_delegate_stale_heartbeat_collect.py` | A child whose worker settles shortly AFTER the heartbeat's stale verdict must be COLLECTED — its recorded result wins over a synthesized timeout (#113222). |
| `tests/tools/test_delegate_stale_wait_release.py` | A child whose worker never returns after the heartbeat declares it stale must not hold the parent forever (#109749: sync delegation in a -Q one-shot kept the Bot Cha… |
| `tests/tools/test_delegate_subagent_timeout_diagnostic.py` | Regression tests for subagent timeout diagnostic dump (issue #14726). |
| `tests/tools/test_delegate_summary_budget.py` | Tests for subagent summary budgeting (PR #9126). delegate_task caps subagent summaries against the parent's remaining context headroom (split across the batch) befor… |
| `tests/tools/test_delegate_sync_failure_echo_policy.py` | Salt R11-B1: synchronous child failure echo above the CLI spinner is an automatic diagnostic presentation and honors display.suppress_warning_notifications under the… |
| `tests/tools/test_delegate_timeout_cleanup.py` | Regression coverage for timed-out delegation teardown. |
| `tests/tools/test_delegate_toolset_scope.py` | Tests for delegate_tool toolset scoping. Verifies that subagents cannot gain tools that the parent does not have. |
| `tests/tools/test_delegated_output_redaction.py` | Completed child output must be redacted before delegation consumers (#137594). |
| `tests/tools/test_delegation_live_log.py` | Tests for tools/delegation_live_log.py — live subagent transcripts. |
| `tests/tools/test_delegation_recovery_diagnostics.py` | Public dispatch/restart diagnostics for an owner lost before any child finishes. |
| `tests/tools/test_denial_circuit_breaker.py` | Tests for the consecutive-denial circuit breaker in smart approvals. |
| `tests/tools/test_desktop_tools_diet.py` | Desktop tool consolidation + diet (#95681, maintainer-directed). |
| `tests/tools/test_desktop_ui.py` | Tests for the desktop-only renderer-event bridge. |
| `tests/tools/test_discord_send_message_caption.py` | Discord standalone MEDIA:<path> caption delivery. When `hermes send --to discord "MEDIA:/x.png This Caption"` targets a normal (non-forum) channel, the caption must … |
| `tests/tools/test_discord_tool.py` | Tests for the Discord server introspection and management tool. |
| `tests/tools/test_display_toggles.py` | The desktop's Appearance switches, as the AGENT experiences them. |
| `tests/tools/test_docker_backend_real.py` | The Docker terminal backend against a real daemon and a real container. Every other Docker backend test mocks `subprocess` or the docker CLI. |
| `tests/tools/test_docker_cgroup_limits.py` | Tests for cgroup resource-limit gating in the docker backend. On hosts where the cgroup v2 cpu/memory/pids controllers are not delegated (e.g. |
| `tests/tools/test_docker_config_migrate.py` | Covers test docker config migrate backs up and migrates legacy config; test docker config migrate skips below floor config untouched; test docker config migrate stamps unversioned config |
| `tests/tools/test_docker_daemon_redirect.py` | Docker/Podman daemon-redirect and lifecycle flag-insertion detection. |
| `tests/tools/test_docker_environment.py` | Mock subprocess.run to intercept docker run -d and docker version calls. Returns a list of captured (cmd, kwargs) tuples for inspection. |
| `tests/tools/test_docker_find.py` | Tests for tools.environments.docker.find_docker — Docker CLI discovery. |
| `tests/tools/test_docker_mounted_host_session_cwd.py` | A session cwd that IS the directory mounted at /workspace must not be a container cd. |
| `tests/tools/test_docker_network_config.py` | Regression tests for the Docker terminal network toggle. Ported from NanoClaw PR #2713's opt-in egress lockdown idea. |
| `tests/tools/test_docker_orphan_reaper_integration.py` | Integration tests for the docker orphan-reaper wiring in terminal_tool. |
| `tests/tools/test_docker_ownership_handback.py` | Root-run Docker sandboxes hand their bind-mounted files back to the host user after the container stops and before it is removed; the next root container takes back … |
| `tests/tools/test_docker_rebootstrap_nous_session.py` | Unit tests for scripts/docker_rebootstrap_nous_session.py. |
| `tests/tools/test_docker_session_isolation.py` | Per-session docker container isolation (docker + container_persistent: false). |
| `tests/tools/test_docker_teardown_drain.py` | 86317: a container-teardown worker must be joined at exit even after the idle reaper popped its env out of `_active_environments` (the atexit drain only knew the r… |
| `tests/tools/test_docker_windows_cwd_mount.py` | Docker must bind a configured Windows workspace even when /workspace is taken. |
| `tests/tools/test_drain_fd_windows.py` | Windows stdout drain: bounded when a grandchild keeps the pipe's write handle open. |
| `tests/tools/test_drain_high_fd.py` | Regression for #94928: no output reader may lose output once its fd is at or above FD_SETSIZE (1024). |
| `tests/tools/test_drive_preview_tool.py` | Tests for the GUI-surface `drive_preview` tool. |
| `tests/tools/test_ensure_task_env.py` | Unit tests for terminal_tool.ensure_task_env — the lazy sandbox bring-up used by vision_analyze so a session's first action can be an in-sandbox file read without a … |
| `tests/tools/test_env_passthrough.py` | Tests for tools.env_passthrough — skill and config env var passthrough. |
| `tests/tools/test_env_probe.py` | Tests for tools/env_probe.py — local Python toolchain probe. |
| `tests/tools/test_escape_drift_autocorrect.py` | Tests for escape-drift auto-correction on `patch` (tools/escape_drift_autocorrect.py). |
| `tests/tools/test_execute_code_approval_cluster.py` | Regression tests for the execute_code approval-bypass cluster. Covers the canonical fix for issues #4146, #27303, #30882, #33057: 1. |
| `tests/tools/test_execute_code_lifecycle_guard_deadline.py` | execute_code's gateway-lifecycle identity probe shares the cell deadline (#111922). |
| `tests/tools/test_execute_code_local_session_approval.py` | execute_code approval in a gateway-run local session (T2). |
| `tests/tools/test_execute_helper_contract.py` | Execute the helper usage taught by the public schema and recovery hints. |
| `tests/tools/test_execution_flag_detection.py` | Execution-bearing option detection across interpreters and read-only tools. |
| `tests/tools/test_explicit_mcp_schema_reload.py` | Explicit reloads refresh a changed MCP schema even when tool names are unchanged. |
| `tests/tools/test_fal_common.py` | Tests for tools/fal_common.py — shared FAL.ai SDK plumbing. |
| `tests/tools/test_fal_sdk.py` | Managed FAL adapter against the installed SDK; only HTTP leaves are replaced. |
| `tests/tools/test_file_operations.py` | Tests for tools/file_operations.py — deny list, result dataclasses, helpers. |
| `tests/tools/test_file_operations_delete.py` | Behavior tests for `ShellFileOperations.delete_file` (real LocalEnvironment shell). |
| `tests/tools/test_file_operations_edge_cases.py` | Tests for edge cases in tools/file_operations.py. Covers: - `_is_likely_binary()` content-analysis branch (dead-code removal regression guard) - `_check_lint()` … |
| `tests/tools/test_file_ops_cwd_tracking.py` | Regression tests for cwd-staleness in ShellFileOperations. |
| `tests/tools/test_file_ops_env_not_ready.py` | A terminal environment that cannot run commands (container still starting, removed out-of-band, transport down) must surface as an environment error, never as "File … |
| `tests/tools/test_file_ops_single_roundtrip.py` | read_file` / `write_file` cost one shell round-trip, not four. |
| `tests/tools/test_file_read_guards.py` | Tests for read_file_tool safety guards: device-path blocking, character-count limits, file deduplication, and dedup reset on context compression. |
| `tests/tools/test_file_staleness.py` | Tests for file staleness detection in write_file and patch. |
| `tests/tools/test_file_state_registry.py` | Tests for the cross-agent FileStateRegistry (tools/file_state.py). Covers the three layers added for safe concurrent subagent file edits: 1. |
| `tests/tools/test_file_sync.py` | Tests for FileSyncManager — mtime tracking, deletion detection, transactional rollback. |
| `tests/tools/test_file_sync_back.py` | Tests for FileSyncManager.sync_back() — pull remote changes to host. |
| `tests/tools/test_file_sync_sigint.py` | Cross-platform regression for the deferred-SIGINT re-delivery in sync-back. |
| `tests/tools/test_file_sync_upload_snapshot.py` | Upload hashes must describe the bytes received by the remote sandbox. |
| `tests/tools/test_file_tools.py` | Tests for the file tools module (schema, handler wiring, error paths). |
| `tests/tools/test_file_tools_container_config.py` | Tests for docker container_config key propagation in file_tools. |
| `tests/tools/test_file_tools_cwd_resolution.py` | Regression tests for file-tool path resolution base correctness. |
| `tests/tools/test_file_tools_live.py` | Live integration tests for file operations and terminal tools. These tests run REAL commands through the LocalEnvironment -- no mocks. |
| `tests/tools/test_file_tools_plugin_container_cwd.py` | The file-tools env creation path applies the container cwd guard through the same predicate the terminal tool uses, so a plugin backend declaring `is_container` ge… |
| `tests/tools/test_file_tools_tilde_profile.py` | Regression tests for profile-aware tilde expansion in file tools. |
| `tests/tools/test_file_write_surrogate_roundtrip.py` | Surrogate-safe stdin piping for the local execution environment (#79178). |
| `tests/tools/test_find_shell.py` | Tests for _find_shell — user-login-shell preference on POSIX. |
| `tests/tools/test_finite_delegation_outcomes.py` | Finite dispatch returns sibling outcomes, not an orphaned async handle. |
| `tests/tools/test_focus_pane_tool.py` | Tests for the GUI-surface `focus_pane` tool. |
| `tests/tools/test_fuzzy_match.py` | Tests for the fuzzy matching module. |
| `tests/tools/test_gateway_cwd_contract.py` | Tool-surface cwd contract tests for gateway workspaces. |
| `tests/tools/test_generation_source_confinement.py` | Tests for the generation-tool source-image confinement chokepoint. |
| `tests/tools/test_git_consumer_environment.py` | Git consumers use the selected package environment without owning its layout. |
| `tests/tools/test_gnu_long_option_abbreviation_bypass.py` | Tests for GNU long-option abbreviation bypass in DANGEROUS_PATTERNS. GNU tools accept unique long-option prefix abbreviations at runtime (e.g. |
| `tests/tools/test_hardline_blocklist.py` | Tests for the unconditional hardline command blocklist. |
| `tests/tools/test_hardline_escaped_quote_state.py` | The hardline floor judges shell quoting on the AUTHOR's text, not on normalized text. |
| `tests/tools/test_hermes_subprocess_env.py` | Tests for hermes_subprocess_env() — the centralized credential-safe env builder for the non-terminal subprocess spawn surface. |
| `tests/tools/test_hook_output_spill.py` | Tests for tools.hook_output_spill. |
| `tests/tools/test_hub_lock_non_utf8.py` | Regression test for #68053 — hub lock.json with Windows-1252 bytes. |
| `tests/tools/test_human_input_hooks.py` | on_human_input_request / on_human_input_resolved fire wherever the agent blocks for a human (#132333). |
| `tests/tools/test_image_generate_schema.py` | image_generate dynamic schema — capability-gated params (#95681 diet). Contract: args the active model cannot honor are NOT advertised. |
| `tests/tools/test_image_generation.py` | Tests for tools/image_generation_tool.py — FAL multi-model support. |
| `tests/tools/test_image_generation_artifacts.py` | Covers test postprocess adds agent visible image for active ssh env; test concurrent image results preserve shared remote sync state; test handle image generate postprocesses plugin result |
| `tests/tools/test_image_generation_env.py` | FAL_KEY env var normalization (whitespace-only treated as unset). |
| `tests/tools/test_image_generation_image_to_image.py` | Tests for the image-to-image / editing surface of `image_generate`. |
| `tests/tools/test_image_generation_interrupt.py` | _wait_fal_result must notice a user interrupt while the FAL job runs. |
| `tests/tools/test_image_generation_managed.py` | The single managed image row: model id → gateway, and a de-duplicated union catalog. |
| `tests/tools/test_image_generation_plugin_dispatch.py` | Declared controls reach generate(); an undeclared one the model sent anyway is dropped, so a plugin whose generate() lacks **kwargs never sees it. |
| `tests/tools/test_image_source.py` | Tests for tools/image_source.py — the unified vision image-source resolver. |
| `tests/tools/test_init_session_cwd_respect.py` | Tests that init_session() respects the configured cwd. |
| `tests/tools/test_interrupt.py` | Tests for the interrupt system. Run with: python -m pytest tests/test_interrupt.py -v |
| `tests/tools/test_interrupted_command_cwd.py` | An interrupted command must not adopt the shared environment's cwd. |
| `tests/tools/test_kanban_comment_injection.py` | Live operator-note injection into a running kanban worker. |
| `tests/tools/test_kanban_complete_parents_tool.py` | Dependency refusals name the open parents on every surface. `complete_task` reports every refusal as bare `False`. |
| `tests/tools/test_kanban_descendant_scope.py` | Real shell/CLI ingress: inherited context is not a board-write grant. |
| `tests/tools/test_kanban_persisted_identity.py` | Board identity follows the profile a kanban call runs FOR, never the generic `"worker"`. |
| `tests/tools/test_kanban_provenance.py` | Worker provenance is not a dependency edge or a transient runtime session. |
| `tests/tools/test_kanban_redaction.py` | Tests: redact_sensitive_text is applied in kanban tool handlers. |
| `tests/tools/test_kanban_tools.py` | Tests for the Kanban tool surface (tools/kanban_tools.py). |
| `tests/tools/test_kanban_toolset_opt_in.py` | Saved tool opt-ins must reach the real schema without leaking across platforms. |
| `tests/tools/test_kanban_unknown_arguments.py` | Unknown review arguments must not silently mutate the board (#115641). |
| `tests/tools/test_kill_verify_tree_death.py` | Post-kill tree-death verification (#115490). A kill that leaves survivors must NOT write a killed receipt or prune the session: the live tree would become unmanageab… |
| `tests/tools/test_known_file_write_baseline.py` | Whole-file knowledge survives what does not change it. |
| `tests/tools/test_launchctl_guard_diagnostic.py` | Diagnostics must distinguish policy rejection from inspected job properties. |
| `tests/tools/test_lazy_deps_runtime.py` | Retired runtime installers must not turn agent construction into an update. |
| `tests/tools/test_line_ending_preservation.py` | Tests for CRLF line-ending preservation in write_file and patch. |
| `tests/tools/test_live_env_cwd_override_sanitize.py` | Invariants for cwd overrides written into LIVE cached envs (#113894, #98723). |
| `tests/tools/test_llm_content_none_guard.py` | Tests for None guard on response.choices[0].message.content.strip(). |
| `tests/tools/test_local_background_child_hang.py` | Regression tests for issue #8340. When a user command backgrounds a child process (`cmd &`, `setsid cmd & disown`, etc.), the backgrounded grandchild inherits th… |
| `tests/tools/test_local_cwd_permission_fallback.py` | Regression tests for inaccessible-cwd fallback (#65583). |
| `tests/tools/test_local_env_blocklist.py` | Child-observed terminal policy, profile lifetime and PYTHONPATH provenance. |
| `tests/tools/test_local_env_bot_desktop.py` | Terminal child envs route GUI launches to the running Bot Desktop (#125830). |
| `tests/tools/test_local_env_cwd_recovery.py` | Tests for LocalEnvironment recovery when `self.cwd` is deleted. |
| `tests/tools/test_local_env_relative_cwd.py` | Regression tests for local terminal initial cwd normalization. |
| `tests/tools/test_local_env_session_leak.py` | Cross-session HERMES_SESSION_* leak guard for the local terminal backend. |
| `tests/tools/test_local_env_windows_msys.py` | Tests for the Windows / Git Bash MSYS-path normalization in `LocalEnvironment`. |
| `tests/tools/test_local_interrupt_cleanup.py` | Regression tests for _wait_for_process subprocess cleanup on exception exit. |
| `tests/tools/test_local_persistent_shell.py` | TERMINAL_LOCAL_PERSISTENT end to end on a real local bash: on (the default) carries exported env vars between commands, off starts every command from the login-time … |
| `tests/tools/test_local_setsid_descendant_sweep.py` | Regression tests for #85125 Phase 4b (terminal flavor of the #71148 class). LocalEnvironment._kill_process kills the process GROUP (SIGTERM -> wait -> SIGKILL). |
| `tests/tools/test_local_shell_init.py` | Tests for terminal.shell_init_files / terminal.auto_source_bashrc. |
| `tests/tools/test_local_temp_dir.py` | Tests for `LocalEnvironment.get_temp_dir` temp-dir redirect. |
| `tests/tools/test_macos_protected_search.py` | macOS TCC-safe behavior for broad file searches. |
| `tests/tools/test_managed_browserbase_and_modal.py` | Load a plugin module by file path from `plugins/`. Mirror of :func:`_load_tool_module` for the plugin tree. |
| `tests/tools/test_managed_media_gateways.py` | Covers test managed fal submit uses gateway origin and nous token; test openai tts uses managed audio gateway when direct key absent; test openai tts accepts openai api key as direct fallback |
| `tests/tools/test_managed_modal_environment.py` | Save and restore sys.modules entries so fakes don't leak to other tests. |
| `tests/tools/test_managed_tool_gateway.py` | Covers test resolve managed tool gateway derives vendor origin from shared domain; test resolve managed tool gateway uses vendor specific override; test resolve managed tool gateway is inactive without nous token |
| `tests/tools/test_managed_worker_tool_diagnostics.py` | A tool this session cannot reach must never be answered with "call it directly". |
| `tests/tools/test_mcp_app_gate.py` | Application requirements compose with live, recycled, and lazy MCP connections. |
| `tests/tools/test_mcp_auth_park_discovery_nudge.py` | An OAuth server parked on an auth failure must not be revived by discovery passes until a re-authorization rewrites its credentials: every nudge replayed the same re… |
| `tests/tools/test_mcp_bridge_single_failure.py` | Regression test for #50394. A single failing stdio MCP server must not churn the whole MCP bridge. |
| `tests/tools/test_mcp_cancelled_error_propagation.py` | Regression tests for `MCPServerTask.run` + `asyncio.CancelledError`. |
| `tests/tools/test_mcp_capability_gating.py` | Tests for capability-gated MCP tool discovery and keepalive. Prompt-only / resource-only MCP servers do not implement the `tools/*` request family. |
| `tests/tools/test_mcp_cimd.py` | Tests for CIMD (Client ID Metadata Document) support in MCP OAuth. |
| `tests/tools/test_mcp_circuit_breaker.py` | Tests for MCP tool-handler circuit-breaker recovery. |
| `tests/tools/test_mcp_client_cert.py` | Tests for mTLS client certificate config on MCP HTTP/SSE transports. Covers: 1. |
| `tests/tools/test_mcp_config_change_rebind.py` | A remote MCP server definition edited in config.yaml while the process runs must take effect on the next transport rebuild (#113907): `run()` used to keep its star… |
| `tests/tools/test_mcp_config_whitespace_warning.py` | Tests for MCP config hidden-whitespace warnings. Inspired by Claude Code v2.1.219: warn when MCP config values carry hidden leading/trailing whitespace (pasted token… |
| `tests/tools/test_mcp_connect_secret_scope.py` | MCP connect resolves credentials under the connection owner's profile secret scope. Discovery at gateway startup runs outside any per-turn scope. |
| `tests/tools/test_mcp_dashboard_oauth.py` | Hosted-dashboard bridge for MCP OAuth browser callbacks. |
| `tests/tools/test_mcp_death_supervisor.py` | Contract tests for the shared parent-death supervisor for stdio MCP servers. |
| `tests/tools/test_mcp_device_flow.py` | RFC 8628 login invariants through the production CLI and local HTTP. |
| `tests/tools/test_mcp_dynamic_discovery.py` | Tests for MCP dynamic tool discovery (notifications/tools/list_changed). |
| `tests/tools/test_mcp_elicitation.py` | Tests for the MCP elicitation handler in tools.mcp_tool_sampling. |
| `tests/tools/test_mcp_empty_error_message.py` | Regression tests for MCP error messages when str(exc) is empty. |
| `tests/tools/test_mcp_enabled_reader.py` | Every reader of `mcp_servers.<name>.enabled` gives one answer per value. |
| `tests/tools/test_mcp_events.py` | MCP Events client (webhook delivery): opt-in utility tools, subscribe/unsubscribe against the dynamic webhook route store, and the refresh loop's re-subscription rul… |
| `tests/tools/test_mcp_failure_classification.py` | Tests for exception-group unwrapping and failure classification in `tools/mcp_tool.py` (#65673, #66092). |
| `tests/tools/test_mcp_google_offline_access.py` | Google-hosted MCP OAuth: offline access and the device-flow issuer mismatch (#117510). |
| `tests/tools/test_mcp_http_body_cap.py` | Wire-body cap for MCP HTTP/SSE transports. Exercises `_make_mcp_body_cap_transport` with a real httpx AsyncClient over a MockTransport: oversized finite bodies and… |
| `tests/tools/test_mcp_http_proxy.py` | Proxy support for MCP HTTP/SSE transports (#111794). |
| `tests/tools/test_mcp_identity_header.py` | Tests for the per-server MCP identity header (`identity_header`). |
| `tests/tools/test_mcp_image_content.py` | Regression tests for MCP ImageContent block handling. |
| `tests/tools/test_mcp_initial_connect_shutdown.py` | Regression tests for initial MCP failure ownership and teardown. |
| `tests/tools/test_mcp_invalid_url.py` | Tests for the MCP remote-URL validator. Ported from anomalyco/opencode#25019 (`fix: handle invalid mcp urls`). |
| `tests/tools/test_mcp_lazy_start.py` | Behavior-contract tests for lazy MCP server startup (#56832). |
| `tests/tools/test_mcp_list_pagination.py` | Tests for MCP list_* pagination (nextCursor draining). |
| `tests/tools/test_mcp_liveness.py` | Covers test parse liveness contract; test invalid registered liveness degrades to static; test live endpoint reloads file and registers token before use |
| `tests/tools/test_mcp_liveness_catalog.py` | Covers test hidden declared server appears in listing and empty summary; test hidden undeclared server is absent |
| `tests/tools/test_mcp_loop_profile_override.py` | Regression tests for HERMES_HOME override propagation onto the MCP loop. |
| `tests/tools/test_mcp_multiplex_connection_keys.py` | Two multiplexed profiles that name the same MCP server with different credentials are two connections (#106005, #91654): the ledgers in `tools.mcp_tool` are keyed … |
| `tests/tools/test_mcp_node_abi.py` | A stdio MCP server whose native addon was built by another Node.js (#124264). Hermes runs stdio servers on its own Node only. |
| `tests/tools/test_mcp_npx_cached_bin.py` | npx -y <pkg>` should spawn the cached binary, not a resident `npm exec`. |
| `tests/tools/test_mcp_oauth.py` | Tests for tools/mcp_oauth.py — OAuth 2.1 PKCE support for MCP servers. |
| `tests/tools/test_mcp_oauth_bidirectional.py` | Regression test for the `HermesMCPOAuthProvider.async_auth_flow` bidirectional generator bridge. |
| `tests/tools/test_mcp_oauth_callback_latch.py` | The loopback OAuth callback latches the first terminal result (#116278). |
| `tests/tools/test_mcp_oauth_cold_load_expiry.py` | Tests for cold-load token expiry tracking in MCP OAuth. |
| `tests/tools/test_mcp_oauth_discovery_requests.py` | SDK-built OAuth discovery/registration requests: default User-Agent, and discovery context on failure. |
| `tests/tools/test_mcp_oauth_integration.py` | End-to-end integration tests for the MCP OAuth consolidation. |
| `tests/tools/test_mcp_oauth_issuer_binding.py` | Refresh tokens are bound to the authorization-server issuer that granted them. |
| `tests/tools/test_mcp_oauth_issuer_origin.py` | A path-scoped authorization server whose RFC 8414 metadata names its origin (#116233). |
| `tests/tools/test_mcp_oauth_manager.py` | Tests for the MCP OAuth manager (tools/mcp_oauth_manager.py). |
| `tests/tools/test_mcp_oauth_metadata.py` | Tests for OAuth server metadata persistence across process restarts. |
| `tests/tools/test_mcp_oauth_missing_iss.py` | Regression for #111135: Figma advertises RFC 9207 `iss` support and then omits `iss` from the redirect, so the SDK rejected every valid authorization code. |
| `tests/tools/test_mcp_oauth_stdin_console.py` | _is_interactive()` must not trust `isatty()` alone on Windows: the CRT reports a DEVNULL / detached stdin as a TTY, so the background gateway looked interactive a… |
| `tests/tools/test_mcp_oauth_user_agent.py` | Tests for the per-server `oauth.user_agent` on MCP OAuth token requests. |
| `tests/tools/test_mcp_park_log_dedupe.py` | Tests for parked-MCP-server log dedupe (#115713). A parked server's timed self-probe wakes the run task, which retries the transport and — when the dependency is sti… |
| `tests/tools/test_mcp_parked_probe_no_browser.py` | A parked MCP server's timed self-probe is unattended: it must never start a browser OAuth flow. |
| `tests/tools/test_mcp_parked_probe_skips_disabled.py` | A parked server's timed self-probe must honour `enabled: false` / a deleted config entry: the probe rebuilds the transport from the config captured at start, so wi… |
| `tests/tools/test_mcp_parked_self_probe.py` | Tests for the parked-server self-probe revival path (#57129). |
| `tests/tools/test_mcp_poll_loop_oom_integration.py` | End-to-end coverage for the MCP poll-loop OOM spin (#63892). |
| `tests/tools/test_mcp_preflight_content_type.py` | Tests for MCPServerTask._preflight_content_type fast-fail behaviour. |
| `tests/tools/test_mcp_probe.py` | Tests for probe_mcp_server_tools() in tools.mcp_tool. |
| `tests/tools/test_mcp_protocol_negotiation.py` | MCP 2026-07-28 protocol-era negotiation (_negotiate_session). |
| `tests/tools/test_mcp_rapid_drop_budget.py` | Tests for the MCP rapid-drop reconnect budget (#62212). |
| `tests/tools/test_mcp_reconcile_with_config.py` | Live MCP servers follow `mcp_servers` as it is on disk: an entry removed (or disabled) after boot is torn down instead of self-probing for the life of the process. |
| `tests/tools/test_mcp_reconnect_log_hygiene.py` | Tests for MCP reconnect log hygiene and backoff jitter (#65673, #66092). |
| `tests/tools/test_mcp_reconnect_retry_reset.py` | Tests for MCP reconnect retry counter reset (#57604). |
| `tests/tools/test_mcp_reconnect_signal.py` | Tests for the MCPServerTask reconnect signal. When the OAuth layer cannot recover in-place (e.g., external refresh of a single-use refresh_token made the SDK's in-me… |
| `tests/tools/test_mcp_register_wakes_stale.py` | New sessions must wake parked/stale cached MCP servers immediately. |
| `tests/tools/test_mcp_resource_content.py` | Tests for MCP ResourceLink / EmbeddedResource / AudioContent handling. |
| `tests/tools/test_mcp_restart_on_new_inputs.py` | A plugin settings save reconnects only the MCP servers whose resolved launch inputs changed: a new `${VAR}` value the server's `env` passes through restarts it w… |
| `tests/tools/test_mcp_result_size_limit.py` | Regression tests for the MCP hard result cap (#56059). |
| `tests/tools/test_mcp_schema_cache.py` | Unit tests for the on-disk MCP schema cache (tools/mcp_schema_cache.py). |
| `tests/tools/test_mcp_schema_cache_ttl.py` | SEP-2549 schema-cache TTL expiry (tools/mcp_schema_cache.py). |
| `tests/tools/test_mcp_server_log_notifications.py` | Tests for MCP server log notification handling (port of anomalyco/opencode#34529). |
| `tests/tools/test_mcp_server_reconnecting_predicate.py` | mcp_server_reconnecting` (cron preflight's "is this outage healing on its own?" question) must say True only for a transient park. |
| `tests/tools/test_mcp_session_scope.py` | Real stdio registrations must not become sibling-session capabilities. |
| `tests/tools/test_mcp_shared_connection_resolved_identity.py` | A multiplexed profile never adopts another profile's live MCP connection when the inputs that connection was opened with resolve differently for it: external secret-… |
| `tests/tools/test_mcp_sse_fallback.py` | Invariant tests: automatic Streamable HTTP -> SSE transport fallback (#53676, #104343). |
| `tests/tools/test_mcp_sse_transport.py` | Regression tests for SSE transport in `MCPServerTask._run_http`. |
| `tests/tools/test_mcp_stability.py` | Tests for MCP stability fixes — event loop handler, PID tracking, shutdown robustness. |
| `tests/tools/test_mcp_startup_summary_names_failures.py` | The MCP startup summary names every failing server with its reason (#114746). |
| `tests/tools/test_mcp_stderr_lifecycle.py` | MCP shutdown releases only the selected profile's cached stderr handle. |
| `tests/tools/test_mcp_stdio_children_dead.py` | Regression tests for MCP stdio aggregate liveness (#94335 / #94637). |
| `tests/tools/test_mcp_stdio_dead_reconnect.py` | Regression test for #115483: dead stdio child past the proof deadline. |
| `tests/tools/test_mcp_stdio_encoding_handler.py` | Tests for MCP stdio encoding error handler fix (issue #46099). |
| `tests/tools/test_mcp_stdio_env_unset_ref.py` | Stdio MCP launch env: an env entry rendered from one unset `${VAR}` counts as absent. |
| `tests/tools/test_mcp_stdio_fastfail_reconnect.py` | Regression tests for dead stdio subprocess recovery (#95626 salvage). |
| `tests/tools/test_mcp_stdio_init_timeout.py` | Regression test for the stdio-MCP subprocess/FD leak (#59349). A stdio MCP server that never completes `initialize` (e.g. |
| `tests/tools/test_mcp_streamable_http_arity.py` | The streamable-HTTP transport must accept both SDK generations' arity. |
| `tests/tools/test_mcp_structured_content.py` | Tests for MCP tool structuredContent preservation. |
| `tests/tools/test_mcp_timeout_resolution.py` | Contract tests for MCP tool-timeout resolution (#85125 Phase 2g). |
| `tests/tools/test_mcp_tool_401_handling.py` | Tests for MCP tool-handler auth-failure detection. When a tool call raises UnauthorizedError / OAuthNonInteractiveError / httpx.HTTPStatusError(401), the handler sho… |
| `tests/tools/test_mcp_tool_client_info.py` | The MCP handshake names hermes-agent and its release, not the SDK default ("mcp"/"0.1.0"). |
| `tests/tools/test_mcp_tool_costs.py` | Declared MCP tool costs and the per-chat spend limit (`tools.mcp_tool_costs`). |
| `tests/tools/test_mcp_tool_errors.py` | Invariants for `tools/mcp_tool_errors._format_connect_error` on malformed exception chains. |
| `tests/tools/test_mcp_tool_issue_948.py` | A command found later on the child's PATH must not pull its directory ahead of earlier entries: the child's other bare lookups (node, python3, git) follow the PATH o… |
| `tests/tools/test_mcp_tool_progress.py` | An MCP server's `notifications/progress` during `tools/call` reaches the agent's `tool_progress_callback` as throttled `tool.progress` events for that call i… |
| `tests/tools/test_mcp_tool_session_expired.py` | Tests for MCP tool-handler transport-session auto-reconnect. |
| `tests/tools/test_mcp_transport_group_reconnect.py` | Regression tests for issue #66092. Streamable-HTTP / SSE MCP transports run their stream pump inside an anyio TaskGroup. |
| `tests/tools/test_mcp_trust_gating.py` | Tests for MCP tool trust-tier gating via readOnlyHint annotations. |
| `tests/tools/test_mcp_utility_capability_gating.py` | Regression tests for capability-gated MCP utility schema registration. |
| `tests/tools/test_mcp_windows_orphan_fix.py` | Tests for the Windows MCP orphan fix (#61059). Windows has no POSIX parent-death supervisor / killpg safety net, so orphaned npx → node.exe trees accumulated across … |
| `tests/tools/test_media_caption_split.py` | Guard test for the MEDIA:<path> caption chokepoint (_media_caption_split). |
| `tests/tools/test_memory_patch_action.py` | Regression for #124582: the memory tool had no find-and-splice edit, so a partial edit of one clause of a packed multi-fact entry could only be expressed as a whole-… |
| `tests/tools/test_memory_target_contract.py` | Memory calls must name one store before writing or staging a proposal. |
| `tests/tools/test_memory_tool.py` | Tests for tools/memory_tool.py — MemoryStore, security scanning, and tool dispatcher. |
| `tests/tools/test_memory_tool_import_fallback.py` | Regression tests for memory-tool import fallbacks. |
| `tests/tools/test_memory_tool_schema.py` | Schema-shape tests for the built-in memory tool. The memory tool previously used `allOf: [{if: ..., then: {required: ...}}]` at the top level of `parameters` to … |
| `tests/tools/test_microsoft_graph_auth.py` | Tests for tools/microsoft_graph_auth.py. |
| `tests/tools/test_microsoft_graph_client.py` | Tests for tools/microsoft_graph_client.py. |
| `tests/tools/test_modal_bulk_upload.py` | Tests for Modal bulk upload via tar/base64 archive. |
| `tests/tools/test_modal_sandbox_fixes.py` | Tests for Modal sandbox infrastructure fixes (TBLite baseline). Covers the bugs discovered while setting up TBLite evaluation: 1. |
| `tests/tools/test_modal_snapshot_isolation.py` | Covers test modal environment migrates legacy snapshot key and uses snapshot id; test resolve modal image uses snapshot ids and registry images; test persistent cleanup snapshots without expiry |
| `tests/tools/test_model_tools.py` | Tests for model_tools.py — function call dispatch, agent-loop interception, legacy toolsets. |
| `tests/tools/test_multiplex_tool_cache_scope.py` | Multiplexed gateway: module-level caches in tools/ and agent/ must not hand profile A's config/.env-derived value to profile B. |
| `tests/tools/test_multiplex_tool_credential_scope.py` | Multiplex invariant: tool-side profile credentials / targets never leak from the default profile. |
| `tests/tools/test_multiplex_tool_memo_scope.py` | Under `gateway.multiplex_profiles` one process serves every profile; each routed turn runs with a context-local HERMES_HOME override. |
| `tests/tools/test_multiplex_turn_parity.py` | Multiplexed-gateway parity for what a TURN sees: a profile served by the default multiplexer (`_profile_runtime_scope`) must observe the same tool-side policy its … |
| `tests/tools/test_notebook_recovery_path.py` | Recovery hints must name the user-visible notebook, not its byte-transport copy. |
| `tests/tools/test_notify_on_complete.py` | Tests for notify_on_complete background process feature. |
| `tests/tools/test_oneshot_completion_linger.py` | One-shot CLI exit linger for notify_on_complete background processes (#90879). |
| `tests/tools/test_open_preview_tool.py` | Tests for the GUI-surface `open_preview` tool. |
| `tests/tools/test_osv_check.py` | Tests for OSV malware check on MCP extension packages. |
| `tests/tools/test_parse_env_var.py` | Tests for _parse_env_var and _get_env_config env-var validation. |
| `tests/tools/test_patch_already_applied.py` | Tests for already-applied patch detection (success-shaped no-op). |
| `tests/tools/test_patch_multimatch_locations.py` | Tests for multi-match location listing in patch ambiguity errors. |
| `tests/tools/test_patch_parser.py` | Tests for the V4A patch format parser. |
| `tests/tools/test_patch_v4a_gate.py` | patch V4A provider gate (#95681). V4A is the OpenAI apply_patch dialect; the dual-mode schema taxed every non-OpenAI session ~149 tok/call for a format their models … |
| `tests/tools/test_patch_ws_diagnosis.py` | Tests for whitespace-visualized mismatch diagnosis in patch no-match hints. |
| `tests/tools/test_permanent_allowlist_live_reload.py` | A hand edit to `command_allowlist` must reach a long-lived process's approval check. |
| `tests/tools/test_permanent_allowlist_reconcile.py` | command_allowlist` is a file the operator edits; a save must not clobber it. |
| `tests/tools/test_persist_on_release.py` | Lifecycle kill sweeps must skip terminal(background=true, persist_on_release=true) jobs (#41225). |
| `tests/tools/test_pgid_starttime_drift.py` | PGID start-time guards tolerate same-host start-time drift (#117505; follow-up to #131910). |
| `tests/tools/test_plugin_guard.py` | Tests for tools/plugin_guard.py — plugin install security scanning. Inspired by Claude Cowork's skill & plugin security scanning (pass/warn/fail on upload/edit). |
| `tests/tools/test_plugin_guard_block_reason.py` | Behavior contracts for plugin-guard dangerous-install diagnostics. |
| `tests/tools/test_plugin_skills.py` | Tests for namespaced plugin skill registration and resolution. |
| `tests/tools/test_pr_6656_regressions.py` | Regression tests for PR #6656 — skill uninstall + bundle hash + pairing lock. Three independent fixes that were salvaged together: 1. |
| `tests/tools/test_pre_transcription_hook.py` | Tests for the `pre_transcription` plugin hook and STT prompt threading (issue #64168) wired into `tools.transcription_tools.transcribe_audio`. Covers: 1. |
| `tests/tools/test_preview_scope_gate.py` | tool_call scope gate for session-gated GUI tools (#120413). |
| `tests/tools/test_process_checkpoint_readopt.py` | Checkpoint recovery must not invent an exit for a live child. A still-live host PID is re-attached and stays running. |
| `tests/tools/test_process_checkpoint_worker_handoff.py` | processes.json keeps the worker handoffs its writer does not track (ahrazzle B2-04). |
| `tests/tools/test_process_heartbeat.py` | Heartbeat notifications for long background processes. |
| `tests/tools/test_process_registry_completion_races.py` | A process's completion is published once, by its owner, and only with its final output. |
| `tests/tools/test_process_registry_env_spawn_cwd.py` | Background launches on environment-backed backends run in the requested cwd. |
| `tests/tools/test_process_registry_import_fence.py` | Importing a tool module must never open the canonical store. |
| `tests/tools/test_process_registry_lazy_restore.py` | Importing the tool registry must not touch state.db; the durable completion replay runs when a consumer asks for it (#123265). |
| `tests/tools/test_process_registry_list_exit.py` | List refresh observes the child, not its descendants' capture-pipe lifetime. |
| `tests/tools/test_process_registry_owner_chain.py` | RED tests for #120546: background WSL work leaves ownerless PIDs. |
| `tests/tools/test_process_registry_pty_kill.py` | Killing a PTY background process must return while a descendant that escapes it holds the PTY. |
| `tests/tools/test_process_registry_windows_live.py` | LIVE Windows E2E for background-executor spawn parity (#70716 / PR salvage). Runs ONLY on a real Windows host (the on-demand `windows-venv-e2e.yml` lane). |
| `tests/tools/test_process_registry_write_stdin_surrogates.py` | Sibling regression test for #79178: background-PTY stdin must round-trip surrogateescape content instead of crashing on the strict UTF-8 encode. |
| `tests/tools/test_process_schema_diet.py` | process schema diet contract (#95681). Pins the shape: enum names the verbs, description carries only non-obvious semantics, and the write-vs-submit trap teaching (W… |
| `tests/tools/test_process_wait_auto_notify.py` | Repeated process_manage wait/poll on a silent running process promotes it to notify_on_complete. |
| `tests/tools/test_process_wait_clarity.py` | Tests for process wait timeout-result clarity (not-an-error semantics). |
| `tests/tools/test_profile_gate_env_isolation.py` | A child spawned FOR another profile never inherits this process's authorization gates (#113270). |
| `tests/tools/test_profile_gate_env_shape.py` | A profile gate is a PLATFORM prefix plus a gate-shaped suffix; an operator's own variable that merely contains `_ALLOWED_` is script data and must survive the rout… |
| `tests/tools/test_project_tools.py` | Covers test agent session project create keeps profile active pointer and moves session; test legacy project create sets profile active pointer; test legacy project switch sets profile active pointer |
| `tests/tools/test_protected_instruction_cli_channel.py` | Protected-instruction approval fails closed at once, without asking anyone, where nobody can answer. |
| `tests/tools/test_pty_query_responder.py` | Tests for tools.pty_query_responder (port of openai/codex#41436). |
| `tests/tools/test_qqbot_send_message_media.py` | QQ Bot proactive MEDIA delivery via send_message / _send_to_platform (#37315). |
| `tests/tools/test_react_to_message_tool.py` | Ownership tests for desktop message reactions. |
| `tests/tools/test_reaction_session_identity.py` | Agent reactions address durable session ids, not routing keys (#139102). |
| `tests/tools/test_read_binary_type_disclosure.py` | Tests for magic-byte type disclosure in the binary-file refusal. |
| `tests/tools/test_read_extract.py` | Tests for structured-document extraction in the read_file tool. |
| `tests/tools/test_read_file_schema_gating.py` | read_file schema diet (#95681): static unconditional format list (anydoc bundled in core) + PDF-coverage teaching moved to the response-time warning. |
| `tests/tools/test_read_file_utf8_binary_regression.py` | End-to-end regression tests for the UTF-8 'flagged as binary' class. |
| `tests/tools/test_read_loop_detection.py` | Tests for the read-loop detection mechanism in file_tools. Verifies that: 1. Only *consecutive* identical reads trigger warnings/blocks 2. |
| `tests/tools/test_read_past_eof_note.py` | Tests for the past-EOF and empty-file notes in read_file. |
| `tests/tools/test_read_preview_tool.py` | Tests for the GUI-surface `read_preview` tool. |
| `tests/tools/test_read_shell_line_clamp.py` | Shell-pipeline per-line clamp in ShellFileOperations.read_file. A file with one pathological line (e.g. |
| `tests/tools/test_read_special_file_guard.py` | Tests for the stat-based special-file guard in read_file_tool. |
| `tests/tools/test_read_unicode_filename_retry.py` | Tests for unicode-equivalent filename retry + near-miss suggestions. |
| `tests/tools/test_read_window_tool.py` | Tests for the GUI-surface `read_window_below` tool. |
| `tests/tools/test_refresh_agent_mcp_tools.py` | Tests for the shared MCP agent-tool refresh helper and discovery-wait bound. |
| `tests/tools/test_registry.py` | Tests for the central tool registry. |
| `tests/tools/test_remote_binary_write_guard.py` | Binary-document overwrite guard must decide WHERE THE WRITE WILL EXECUTE. |
| `tests/tools/test_removed_backend_migration.py` | Removed-backend migration warnings (registry added in #100540). |
| `tests/tools/test_request_tool_approval.py` | Tests for tools.approval.request_tool_approval — the plugin pre_tool_call `{"action": "approve"}` escalation into the human-approval gate. |
| `tests/tools/test_resolve_path.py` | Tests for _resolve_path_for_task() — TERMINAL_CWD-aware path resolution in file_tools_paths. |
| `tests/tools/test_restored_delegation_ownership.py` | Regression coverage for #64484 — durable-restored delegation completions must never be adopted by a session that cannot positively prove ownership. |
| `tests/tools/test_rollback_all_directories.py` | Regression tests for the /rollback all-directories fallback (#10505). |
| `tests/tools/test_safe_getcwd_permission_error.py` | Regression tests for _safe_getcwd() PermissionError handling (macOS TCC). |
| `tests/tools/test_safe_worker_mcp.py` | Fresh-interpreter proof that a safe worker never spawns MCP servers; config-only keeps them. |
| `tests/tools/test_safe_worker_tools.py` | Fresh-interpreter proof of the safe worker's reviewed tool import closure. |
| `tests/tools/test_sandbox_failure_hints.py` | Tests for execute_code sandbox failure hints. |
| `tests/tools/test_schema_boolean_required.py` | Covers test boolean required preserves parent intent; test boolean required does not modify literal data |
| `tests/tools/test_schema_sanitizer.py` | Tests for tools/schema_sanitizer.py. Targets the known llama.cpp `json-schema-to-grammar` failure modes that cause `HTTP 400: Unable to generate parser for this t… |
| `tests/tools/test_search_auto_multiline.py` | Tests for search_files auto-multiline routing on \\n patterns. |
| `tests/tools/test_search_budget_truncation.py` | Covers test timeout helper strips only trailing marker; test rg timeout returns partial results without marker; test real rg error still hard fails |
| `tests/tools/test_search_error_guard.py` | Regression tests for the rg/grep error guard in content search. |
| `tests/tools/test_search_files_cpu_windows.py` | Concurrency admission tests for expensive filename walks. |
| `tests/tools/test_search_files_engine_selection.py` | Behavior tests for file-search ordering and ripgrep selection. |
| `tests/tools/test_search_giant_line_containment.py` | Giant single-line file containment in content search (cline/cline#13525 port). |
| `tests/tools/test_search_hidden_dirs.py` | Tests that search_files excludes hidden directories by default. |
| `tests/tools/test_search_native_rg.py` | Local POSIX content/file search runs rg as a direct argv subprocess. The shell path pays two bash spawns per search (`test -e` probe + `set -o pipefail; rg ... |
| `tests/tools/test_search_zero_match_and_multipath.py` | Tests for search_files zero-match probes and multi-path recovery. |
| `tests/tools/test_self_repo_guard.py` | Tests for tools/self_repo_guard.py — the running-source-checkout git guard. |
| `tests/tools/test_send_message_cross_loop.py` | Regression tests for the cross-event-loop deadlock fix in send_message. |
| `tests/tools/test_send_message_missing_platforms.py` | Tests for _send_mattermost, _send_matrix, _send_dingtalk. |
| `tests/tools/test_send_message_multiplex_profile_adapter.py` | send_message must deliver through the ACTIVE PROFILE's gateway adapter under multiplex. |
| `tests/tools/test_send_message_plugin_extensibility.py` | Cross-surface regressions for standalone platform send extensibility (#64900). |
| `tests/tools/test_send_message_react.py` | Tests for send_message action='react'/'unreact' dispatch. |
| `tests/tools/test_send_message_relay_target_authz.py` | P5(a): `send_message` cannot silently name an arbitrary relay target. |
| `tests/tools/test_send_message_slack.py` | Slack-specific send_message delivery regressions. Salvaged from #47547 and adapted to the post-#41112 plugin layout: the legacy `_send_slack` helper moved to `plu… |
| `tests/tools/test_send_message_surrogate_sanitization.py` | Outbound send bodies must not carry lone surrogate code points (#113799). |
| `tests/tools/test_send_message_target_parse.py` | Parser-only and lightweight routing tests for send_message targets. |
| `tests/tools/test_send_message_telegram_proxy.py` | Regression tests for the standalone Telegram send path's proxy support. |
| `tests/tools/test_send_message_tool.py` | Tests for tools/send_message_tool.py. |
| `tests/tools/test_session_cwd_store.py` | Session-cwd record store (cwd rearchitecture, step 1: dual-write). The store is the future single source of truth for per-session working directories. |
| `tests/tools/test_session_search_readonly.py` | Search never becomes another session-database initializer. |
| `tests/tools/test_session_search_worker_store.py` | Recall in a gateway-managed worker (#141705). The worker's agent is constructed with `session_db=RuntimeSessionStore` (`agent/managed_worker.py`), a facade over … |
| `tests/tools/test_session_tool_env.py` | T3: a local session's tool subprocesses (terminal, background processes, execute_code) start with its client's allowlisted toolchain environment (PATH, an activated … |
| `tests/tools/test_set_theme_tool.py` | set_theme`: the model hears what the desktop applied, never a success it assumed. |
| `tests/tools/test_setup_beat_plugin_skills.py` | The build beat names a plugin's skill by the name it registered under. |
| `tests/tools/test_setup_beat_tool.py` | setup_beat` through the agent's inline executor, with a real session store and a fake card answer standing in for the desktop. |
| `tests/tools/test_shared_container_task_id.py` | Regression tests for the shared-container task_id mapping. |
| `tests/tools/test_shell_arg_transport.py` | Non-path values survive local argv and serialized POSIX-script transport. |
| `tests/tools/test_shell_bypass_denylist.py` | Shell-obfuscation bypass coverage for the dangerous-command denylist. |
| `tests/tools/test_signal_media.py` | Tests for Signal media delivery in send_message_tool.py. |
| `tests/tools/test_single_query_approval_mode.py` | Tests for approvals.single_query_mode — configurable approval behavior for single-query (-q) sessions. |
| `tests/tools/test_singularity_persistent_overlay.py` | Persistent-overlay path safety for the Singularity environment. |
| `tests/tools/test_singularity_preflight.py` | Tests for Singularity/Apptainer preflight availability check. |
| `tests/tools/test_skill_bundle_provenance.py` | Multi-file third-party skill bundles and scanner provenance (#60598). |
| `tests/tools/test_skill_create_dir.py` | Tests for `skills.create_dir` — config-driven skill creation directory. |
| `tests/tools/test_skill_env_passthrough.py` | Test that skill_view registers required env vars in the passthrough registry. |
| `tests/tools/test_skill_improvements.py` | Tests for skill fuzzy patching via tools.fuzzy_match. |
| `tests/tools/test_skill_ledger_delta.py` | Ledger entries carry deltas, not whole-package manifests. |
| `tests/tools/test_skill_linter.py` | Tests for tools/skill_linter.py — the advisory SKILL.md convention linter. |
| `tests/tools/test_skill_manage_batch.py` | skill_manage operations[] batch (#95681 arc, maintainer-approved). |
| `tests/tools/test_skill_manage_schema_diet.py` | skill_manage schema diet contract (#95681, second pass). |
| `tests/tools/test_skill_manager_tool.py` | Tests for tools/skill_manager_tool.py — skill creation, editing, and deletion. |
| `tests/tools/test_skill_pending_diff_batch.py` | Batch pending diff for /skills diff <id> (#123315). Writes staged through `skill_manage` `operations[]` are `batch` records; without a batch case `skill_pendi… |
| `tests/tools/test_skill_provenance.py` | Tests for tools/skill_provenance.py — write-origin ContextVar. |
| `tests/tools/test_skill_provenance_external.py` | 108032: external-dir skills get an 'external' provenance tier, not 'agent'. |
| `tests/tools/test_skill_size_limits.py` | Tests for skill content size limits. Agent writes (create/edit/patch/write_file) are constrained to MAX_SKILL_CONTENT_CHARS (100k) and MAX_SKILL_FILE_BYTES (1 MiB). |
| `tests/tools/test_skill_usage.py` | Tests for tools/skill_usage.py — sidecar telemetry + provenance filtering. |
| `tests/tools/test_skill_view_dedup.py` | Tests for skill_view repeat-view dedup (unchanged-skill stub). |
| `tests/tools/test_skill_view_traversal.py` | Tests for path traversal prevention in skill_view. Regression tests for issue #220: skill_view file_path parameter allowed reading arbitrary files (e.g., ~/.hermes/.… |
| `tests/tools/test_skillevaluator_scan.py` | Tests for the advisory SkillEvaluator Tier 1 install scan. |
| `tests/tools/test_skills_ast_audit.py` | Tests for tools.skills_ast_audit — opt-in AST diagnostic scanner. |
| `tests/tools/test_skills_guard.py` | Tests for tools/skills_guard.py - security scanner for skills. |
| `tests/tools/test_skills_guard_agent_config.py` | Regression tests for skills-guard agent-config persistence patterns (#92021). |
| `tests/tools/test_skills_hub.py` | Tests for tools/skills_hub.py — source adapters, lock file, taps, dedup logic. |
| `tests/tools/test_skills_hub_browse_sh.py` | Helper script / fixture module (not a pytest module). |
| `tests/tools/test_skills_hub_clawhub.py` | Helper script / fixture module (not a pytest module). |
| `tests/tools/test_skills_hub_generic_dir.py` | Skills hub: a skills.sh skill kept in a generic dir (`skills/SKILL.md`) resolves and installs under its slug. |
| `tests/tools/test_skills_hub_github_fetch.py` | GitHubSource file downloads: which host serves a skill's files. |
| `tests/tools/test_skills_hub_lock_file.py` | skills/.hub/lock.json and taps.json survive concurrent writers from different processes. |
| `tests/tools/test_skills_list_modified_diff.py` | Tests for discovering and diffing user-modified bundled skills. |
| `tests/tools/test_skills_runtime_cache.py` | Runtime caches must not take ownership of updater-managed skill packages. |
| `tests/tools/test_skills_sync.py` | Tests for tools/skills_sync.py — manifest-based skill seeding and updating. |
| `tests/tools/test_skills_tool.py` | Tests for tools/skills_tool.py — skill discovery and viewing. |
| `tests/tools/test_skills_tool_discovery_cache.py` | Regression tests for the find_all_skills discovery cache (#58985 salvage). |
| `tests/tools/test_skills_tool_profile_scope.py` | Regression tests for profile-scoped skills_tool path resolution. |
| `tests/tools/test_slack_send_message_media.py` | Slack media delivery for send_message. Covers `plugins/platforms/slack/adapter.py::_standalone_send` media path: text+file, media-only, caption-on-upload, missing-… |
| `tests/tools/test_slash_confirm.py` | Tests for tools/slash_confirm.py — the generic slash-command confirmation primitive. |
| `tests/tools/test_smart_approval_injection.py` | Regression tests for prompt injection hardening in smart approvals. The smart approval guard sends shell commands to an auxiliary LLM for risk assessment. |
| `tests/tools/test_smart_approval_policy.py` | Tests for the operator-customizable smart-approval policy. |
| `tests/tools/test_smart_approval_reasoning.py` | The smart-approval guardian asks for its verdict with thinking off, unless the operator chose. Its budget is 16 tokens for one word. |
| `tests/tools/test_snapshot_multiline_session_env_injection.py` | Newline in bridged session env must not become shell code via the snapshot. |
| `tests/tools/test_snapshot_session_id_leak.py` | Cross-session HERMES_SESSION_ID leak via the shared bash snapshot. |
| `tests/tools/test_spawn_site_child_env.py` | Real children started by the production spawn sites observe the secret scrub. |
| `tests/tools/test_spill_safety.py` | Symlink-refusal and permission tests for tools.spill_safety. |
| `tests/tools/test_ssh_bulk_upload.py` | Tests for SSH bulk upload via tar pipe. |
| `tests/tools/test_ssh_environment.py` | Tests for the SSH remote execution environment backend. |
| `tests/tools/test_ssh_remote_cwd.py` | SSH file paths and cwds live in the remote namespace, never the Hermes host's. |
| `tests/tools/test_ssh_session_cwd.py` | Late session cwd updates must stay in the SSH peer's namespace. The creation path already translates the Hermes subprocess home to remote ~. |
| `tests/tools/test_stage2_hook_api_server_keygen.py` | Regression tests for the stage2 API_SERVER_KEY bootstrap (OOF-285). |
| `tests/tools/test_stage2_hook_nous_routing_env.py` | Regression tests for the stage2 Nous routing-override sync. |
| `tests/tools/test_stage2_hook_seed_one_symlinks.py` | Regression tests for symlink-safe Docker stage2 first-boot seeds. |
| `tests/tools/test_stage2_hook_symlink_chown.py` | Regression tests for symlink-safe Docker stage2 ownership repair. |
| `tests/tools/test_startup_latency_regressions.py` | Startup-latency regressions: probe-mode aux clients, lazy MCP SDK, non-blocking banner update check. |
| `tests/tools/test_strict_provider_selection.py` | Strict tool-provider selection: the `hermes tools` choice always wins. Policy (owner decision): the provider string stored in config.yaml is what runs at call time. |
| `tests/tools/test_stt_cloud_trim.py` | Tests for the cloud STT pre-upload silence trim. Local faster-whisper gets Silero VAD (`build_local_transcribe_kwargs`); cloud providers upload the raw file. |
| `tests/tools/test_stt_idle_unload.py` | Tests for the local whisper model idle-unload mechanism. |
| `tests/tools/test_stt_language_resolution.py` | Tests for the unified STT language resolution (_resolve_stt_language). |
| `tests/tools/test_stt_resolution_passive.py` | STT provider RESOLUTION never installs; transcription still does. |
| `tests/tools/test_stt_silence_hallucinations.py` | Tests for the local faster-whisper silence-hallucination hardening. |
| `tests/tools/test_subagent_process_handoff.py` | Subagent → parent background-process handoff (process_manage action='handoff'). |
| `tests/tools/test_subagent_steer.py` | steer_subagent — redirecting a live delegated child without stopping it. |
| `tests/tools/test_subagent_sudo_prompt.py` | delegate_task children must never trigger the interactive sudo prompt. |
| `tests/tools/test_subagent_worktree.py` | Tests for opt-in subagent worktree isolation (tools/subagent_worktree.py). |
| `tests/tools/test_subprocess_home_isolation.py` | Tests for subprocess HOME handling in profile mode. Hermes state stays profile-scoped through HERMES_HOME. |
| `tests/tools/test_subprocess_stdin_guard.py` | Verify that TUI-context subprocess calls specify stdin=. This is the pytest wrapper for scripts/check_subprocess_stdin.py. |
| `tests/tools/test_subprocess_utf8_encoding.py` | Regression test for #53428 (fix PR #55339): `subprocess.run(text=True)` decoding of secret-manager CLI output must never crash on undecodable bytes. |
| `tests/tools/test_sync_back_backends.py` | Tests for backend-specific bulk download implementations and cleanup() wiring. |
| `tests/tools/test_telegram_send_message_caption.py` | Standalone Telegram MEDIA:<path> caption delivery. When `hermes send --to telegram "MEDIA:/x.png This Caption"` carries a single captionable file plus short text, th… |
| `tests/tools/test_telegram_send_message_video_metadata.py` | The standalone `hermes send` Telegram path must carry video metadata too. |
| `tests/tools/test_terminal_backend_unavailable_reason.py` | Invariant: when a terminal backend's requirements check fails, the human reason is captured so the CLI startup notice / doctor can tell the user WHY the terminal too… |
| `tests/tools/test_terminal_background_spawn_failure.py` | A background launch that never started must be reported as an error, not a session. |
| `tests/tools/test_terminal_bounded_execute.py` | Foreground terminal execute must return when the inner wait loop wedges. |
| `tests/tools/test_terminal_compound_background.py` | Regression tests for _rewrite_compound_background. Context: bash parses `A && B &` as `(A && B) &` — it forks a subshell for the compound and backgrounds the sub… |
| `tests/tools/test_terminal_config_env_sync.py` | Regression tests for terminal config -> env-var bridging. terminal_tool._get_env_config() reads ALL terminal settings from os.environ (TERMINAL_*). |
| `tests/tools/test_terminal_cwd_echo.py` | Tests for the terminal result cwd echo (feat/terminal-cwd-echo). |
| `tests/tools/test_terminal_degraded_mode.py` | Remote terminal backend graceful degradation (terminal.degraded_mode). |
| `tests/tools/test_terminal_env_bridge.py` | Behavioral regressions for the terminal config → env bridge. `terminal_tool._get_env_config()` reads TERMINAL_* variables. |
| `tests/tools/test_terminal_environment_recreated_notice.py` | The model must be told when the backend replaced its container/sandbox mid-command (ported from lobehub/lobehub#19329): silent recovery leaves the agent assuming bac… |
| `tests/tools/test_terminal_error_redaction.py` | Terminal tool result errors must not leak credential-shaped strings. |
| `tests/tools/test_terminal_exit_semantics.py` | Tests for terminal command exit code semantic interpretation. |
| `tests/tools/test_terminal_foreground_timeout_cap.py` | Tests for foreground timeout cap in terminal_tool. A foreground command with timeout > FOREGROUND_MAX_TIMEOUT is promoted to a tracked background process with notify… |
| `tests/tools/test_terminal_heredoc_background_guard.py` | Regression tests for conservative heredoc-aware background-'&' detection. |
| `tests/tools/test_terminal_hints.py` | Tests for tools/terminal_hints.py — output-pattern failure hints. |
| `tests/tools/test_terminal_macos_open.py` | Regression tests for the macOS `open` frontmost raise-ladder. |
| `tests/tools/test_terminal_none_command_guard.py` | Regression tests for invalid/None terminal command handling. |
| `tests/tools/test_terminal_output_transform_hook.py` | Covers test terminal output unchanged when transform hook not registered; test terminal output transform still runs strip and redact; test large process output is bounded before sudo and plugin hooks |
| `tests/tools/test_terminal_plugin_cwd_and_streams.py` | Plugin terminal backends declare where commands start (`default_cwd`) and whether Bot Desktop, computer_use and the browser can follow the terminal into them (`su… |
| `tests/tools/test_terminal_pre_guard_deadline.py` | Terminal pre-execution guards share the command's wall-clock deadline (#111922). |
| `tests/tools/test_terminal_requirements.py` | Remove terminal env vars that could affect requirements checks. |
| `tests/tools/test_terminal_sandbox_builder_dispatch.py` | Regression coverage for sandbox backend builder dispatch (#112715). |
| `tests/tools/test_terminal_scope_multiplex.py` | Per-turn terminal scope isolation under profile multiplexing (#68559 class). |
| `tests/tools/test_terminal_self_repo_guard.py` | terminal_tool wiring tests for the self-repo git mutation guard. |
| `tests/tools/test_terminal_signal_exit.py` | Tests for signal-termination exit code interpretation. |
| `tests/tools/test_terminal_task_cwd.py` | Regression tests for task/session cwd propagation in terminal_tool. |
| `tests/tools/test_terminal_timeout_output.py` | Verify that terminal command timeouts preserve partial output. |
| `tests/tools/test_terminal_tool.py` | Regression tests for sudo detection and sudo password handling. |
| `tests/tools/test_terminal_tool_exception_redaction.py` | Terminal-tool exception paths must redact secrets before returning to the model. |
| `tests/tools/test_terminal_tool_pty_fallback.py` | Covers test command requires pipe stdin detects gh with token; test terminal background keeps pty for regular interactive commands |
| `tests/tools/test_terminal_tool_requirements.py` | Tests for terminal/file tool availability in local dev environments. |
| `tests/tools/test_terminal_trailing_amp_auto_background.py` | A foreground command whose ONLY backgrounding is a trailing `&` runs as terminal(background=true). |
| `tests/tools/test_terminal_truncation_spill.py` | Tests for terminal truncation spill + metadata (deferred retrieval). |
| `tests/tools/test_terminal_watcher_arming.py` | Gateway completion watchers are armed at launch, not only after the turn ends. |
| `tests/tools/test_terminal_yield_to_background.py` | A user message sent while a foreground terminal command runs must not wait for the command. |
| `tests/tools/test_termux_api_detection.py` | Regression tests for issue #31015 — Termux:API app detection. |
| `tests/tools/test_threaded_process_handle.py` | Tests for _ThreadedProcessHandle — the adapter for SDK backends. |
| `tests/tools/test_threat_patterns.py` | Tests for tools/threat_patterns.py — shared threat-pattern library. |
| `tests/tools/test_timeout_transport_drain.py` | 94248 (native half): delegation timeout must drain transports FD-safely. A timed-out child's daemon worker is typically parked inside an in-flight OpenSSL read. |
| `tests/tools/test_tip_tool.py` | Tests for the GUI-surface `tip` tool. |
| `tests/tools/test_todo_nested.py` | Tests for nested subtasks in the todo tool (parent field). |
| `tests/tools/test_todo_tool.py` | Tests for the todo tool module. |
| `tests/tools/test_todo_tool_type_coercion.py` | Tests for defensive type coercion in todo_tool (issue #14185). Covers three crash patterns: 1. todos is a JSON string instead of a list 2. |
| `tests/tools/test_tool_backend_helpers.py` | Unit tests for tools/tool_backend_helpers.py. Tests cover: - managed_nous_tools_enabled() subscription-based gate - normalize_browser_cloud_provider() coercion - coe… |
| `tests/tools/test_tool_output_limits.py` | Tests for tools.tool_output_limits. Covers: 1. Default values when no config is provided. 2. |
| `tests/tools/test_tool_output_truncate.py` | Invariant: terminal, execute_code, MCP and the bounded output collector truncate through one head/tail algorithm — 40% head / 60% tail, exactly one notice, kept text… |
| `tests/tools/test_tool_search_context_provider.py` | Regression coverage for provider-aware context sizing in the tool-search gate. |
| `tests/tools/test_tool_search_multiquery.py` | Multi-query `tool_search`, batched `tool_describe`, and stemming. |
| `tests/tools/test_toolset_distributions.py` | Tests for toolset_distributions.py — distribution CRUD, sampling, validation. |
| `tests/tools/test_toolsets.py` | Tests for toolsets.py — toolset resolution, validation, and composition. |
| `tests/tools/test_tour_tool.py` | Tests for the GUI-surface `tour` tool. |
| `tests/tools/test_transcription.py` | Tests for transcription_tools.py — local (faster-whisper) and OpenAI providers. |
| `tests/tools/test_transcription_chunking.py` | Cloud STT inputs over the provider's upload cap are fitted, not rejected (real ffmpeg, real files). |
| `tests/tools/test_transcription_command_providers.py` | Tests for the STT command-provider registry (`stt.providers.<name>`). |
| `tests/tools/test_transcription_deepinfra.py` | Tests for the DeepInfra STT provider. `_transcribe_deepinfra` is a thin shim that resolves credentials/model then delegates to `_transcribe_openai`. |
| `tests/tools/test_transcription_dotenv_fallback.py` | Regression tests for the transcription_tools variant of #17140. |
| `tests/tools/test_transcription_plugin_dispatch.py` | Tests for STT plugin dispatch in tools/transcription_tools.py. |
| `tests/tools/test_transcription_streaming.py` | Live STT sessions: wire behaviour over a real socket, and the recorder hand-off. |
| `tests/tools/test_transcription_tools.py` | Tests for tools.transcription_tools — three-provider STT pipeline. |
| `tests/tools/test_transcription_whisper_cpp.py` | The managed command remains passive until transcription and caches verified models. |
| `tests/tools/test_translate_execute_context.py` | Translation threats must not discard unrelated role instructions. |
| `tests/tools/test_truncation_footer_sandbox_paths.py` | Truncation footers tell the AGENT where the full text lives, and the agent's read_file runs inside the active terminal backend: under docker the mounted cache is at … |
| `tests/tools/test_tts_command_providers.py` | Tests for custom command-type TTS providers. These tests cover the `tts.providers.<name>` registry: built-in precedence, command resolution, placeholder rendering,… |
| `tests/tools/test_tts_container_repair.py` | Tests for the class-level TTS .ogg container repair. |
| `tests/tools/test_tts_deepinfra.py` | Tests for the DeepInfra TTS provider. `_generate_deepinfra_tts` is a thin shim that resolves credentials/model then delegates to `_generate_openai_tts`. |
| `tests/tools/test_tts_dotenv_fallback.py` | Regression tests for #17140. TTS provider tools must resolve API keys from `~/.hermes/.env` (via `hermes_cli.config.get_env_value`) and not only from `os.enviro… |
| `tests/tools/test_tts_failure_preserves_existing.py` | A failed text_to_speech call must never destroy a file that already lived at output_path. |
| `tests/tools/test_tts_gemini.py` | Tests for the Google Gemini TTS provider in tools/tts_tool.py. |
| `tests/tools/test_tts_identifier_speech.py` | Identifier-to-speech normalization (#119207). Both speech normalizers — tools/tts_text_normalize.py (gateway/CLI/TTS tool) and apps/desktop/src/lib/speech-text.ts (D… |
| `tests/tools/test_tts_importers.py` | SDK import fallback uses the real import system and exact PM feature mapping. |
| `tests/tools/test_tts_instructions.py` | Tests for the OpenAI TTS `instructions` field passthrough. |
| `tests/tools/test_tts_kittentts.py` | Tests for the KittenTTS local provider in tools/tts_tool.py. |
| `tests/tools/test_tts_lifecycle_leases.py` | TTS engine lifecycle driven by speech-output toggles (issue #100881). |
| `tests/tools/test_tts_long_form_chunking.py` | Tests for the long-form TTS chunking and delivery packing pipeline. |
| `tests/tools/test_tts_macos_output.py` | macOS output policy for streaming TTS. On macOS, stream_tts_to_speaker must NOT open a sounddevice OutputStream (PortAudio/CoreAudio init triggers a kTCCServiceMedia… |
| `tests/tools/test_tts_max_text_length.py` | Tests for per-provider TTS input-character limits. With long-form chunking, text exceeding the provider cap is split into ordered chunks instead of silently truncate… |
| `tests/tools/test_tts_minimax_region.py` | MiniMax TTS region, endpoint, and credential selection tests. |
| `tests/tools/test_tts_mistral.py` | Tests for the Mistral (Voxtral) TTS provider in tools/tts_tool.py. |
| `tests/tools/test_tts_model_cache_lru.py` | LRU bound on the Piper/KittenTTS model caches. Each cached entry is a whole loaded TTS model (tens of MB). |
| `tests/tools/test_tts_openai_config.py` | tts.openai.api_key / base_url from config.yaml drive the OpenAI audio client. |
| `tests/tools/test_tts_opus_routing.py` | Covers test edge cli preserves native mp3; test edge telegram converts to opus voice; test edge matrix converts to opus voice |
| `tests/tools/test_tts_output_dir_profile_scope.py` | Regression tests for profile-scoped TTS default output dir (#98749). |
| `tests/tools/test_tts_output_timestamp.py` | Regression test for salvaged PR #43911 — microsecond TTS output timestamps. |
| `tests/tools/test_tts_path_traversal.py` | Regression: text_to_speech_tool output_path must reject '..' traversal. |
| `tests/tools/test_tts_piper.py` | Tests for the native Piper TTS provider. These tests pin the resolution / caching / dispatch paths for Piper without requiring the `piper-tts` package to actually … |
| `tests/tools/test_tts_plugin_dispatch.py` | Tests for TTS plugin dispatch in tools/tts_tool.py (issue #30398). Covers the three core invariants of the plugin dispatcher: 1. |
| `tests/tools/test_tts_prepare_spoken.py` | Unit tests for the shared TTS text cleaner (tools/tts_text_normalize). |
| `tests/tools/test_tts_provider_authority.py` | Tests for config-authoritative TTS provider selection (#90109). |
| `tests/tools/test_tts_pythonpath_fallback.py` | Regression tests for #53259. When TTS/STT packages (edge-tts, elevenlabs, mistralai) installed outside the venv but importable on sys.path (e.g. |
| `tests/tools/test_tts_requirements_passive.py` | check_tts_requirements` is the `text_to_speech` tool's `check_fn`: a PASSIVE probe. |
| `tests/tools/test_tts_response_body_cap.py` | Regression tests for bounded upstream TTS response reads. |
| `tests/tools/test_tts_speed.py` | Tests for TTS speed configuration across providers. |
| `tests/tools/test_tts_streaming.py` | Tests for the provider-agnostic streaming TTS backend (tools.tts_streaming) and its dispatch through tools.tts_tool_speaker.stream_tts_to_speaker. |
| `tests/tools/test_tts_text_normalize.py` | Christchurch today\n\n- **Now:** about **14°C**, feels like **14°C**\n- **Wind:** 9 km/h\n- **Rain:** 1.3 mm\n- **Range:** 11\u201317°C\n |
| `tests/tools/test_tts_xai_speech_tags.py` | Tests for xAI TTS speech-tag handling. |
| `tests/tools/test_unicode_tag_strip.py` | Tests for Unicode TAG character stripping (U+E0000–U+E007F). |
| `tests/tools/test_url_safety.py` | Tests for SSRF protection in url_safety module. |
| `tests/tools/test_utf16_read.py` | Tests for UTF-16 text file reading (transcode to UTF-8). |
| `tests/tools/test_vercel_sandbox_environment.py` | Unit tests for the Vercel Sandbox terminal backend. |
| `tests/tools/test_video_analyze.py` | Tests for video_analyze tool in tools/vision_tools.py. |
| `tests/tools/test_video_generate_schema.py` | video_generate dynamic schema — capability-gated params (#95681 diet). Mirrors tests/tools/test_image_generate_schema.py (#97057). |
| `tests/tools/test_video_generation_dispatch.py` | Tests for the unified `video_generate` tool dispatch surface. |
| `tests/tools/test_video_generation_dynamic_schema.py` | Tests for the dynamic schema builder. |
| `tests/tools/test_video_generation_tool_surface_matrix.py` | Tool-surface routing matrix: every (provider, model, modality) combo. |
| `tests/tools/test_vision_history_budget.py` | Invariants for the native-embed history budgets (#112095). |
| `tests/tools/test_vision_native_fast_path.py` | Tests for the native-vision fast path inside vision_analyze. |
| `tests/tools/test_vision_region.py` | Tests for the optional region crop parameter on vision_analyze. |
| `tests/tools/test_vision_scale_disclosure.py` | Downscale coordinate-scale disclosure tests. When an image is downscaled (or region-cropped) before reaching a vision model, the model's reported coordinates are in … |
| `tests/tools/test_vision_tools.py` | Tests for tools/vision_tools.py — URL validation, type hints, error logging. |
| `tests/tools/test_voice_cli_integration.py` | Tests for CLI voice mode integration -- markdown stripping, voice state management, TTS/STT wiring, barge-in and the full-duplex listener. |
| `tests/tools/test_voice_client_config.py` | E2E tests for tools.voice_client_config — the /api/audio/voice-config resolver. |
| `tests/tools/test_voice_credential_pool_resolution.py` | Tests for `resolve_provider_secret` — the single owner of STT/TTS provider key resolution (#68003). |
| `tests/tools/test_voice_max_recording_seconds.py` | Regression test: voice.max_recording_seconds is actually enforced. |
| `tests/tools/test_voice_mode.py` | Tests for tools.voice_mode -- all mocked, no real microphone or API calls. |
| `tests/tools/test_voice_mode_playback_env_scrub.py` | Voice-mode system playback must scrub credential env (sibling of #70342). |
| `tests/tools/test_voice_silence_threshold_stop.py` | Bug-fix regression tests for #84046: `AudioRecorder.stop()` must apply the CONFIGURED silence threshold (`self._silence_threshold`, wired from `voice.silence_th… |
| `tests/tools/test_voice_stop_phrase.py` | Tests for the voice-chat stop phrase (say "stop" and nothing else to end). |
| `tests/tools/test_voice_thinking_sound.py` | Tests for the ambient voice-chat "thinking" sound (tools/voice_mode.py). Contract: - `voice.thinking_sound` config gates it (default True). |
| `tests/tools/test_voice_tts_echo_guard.py` | Tests for the playback-phase TTS-echo guard (#75780). |
| `tests/tools/test_voice_wsl_pipewire.py` | Regression: WSL voice detection must honor PIPEWIRE_REMOTE, not only PULSE_SERVER. |
| `tests/tools/test_wake_word.py` | Tests for tools.wake_word — the "Hey Hermes" hotword detector. |
| `tests/tools/test_wake_word_stream_recovery.py` | Regression for #118001: a read error must not permanently disarm wake detection. |
| `tests/tools/test_watch_patterns.py` | Tests for watch_patterns background process monitoring feature. |
| `tests/tools/test_web_backend_capability_isolation.py` | A per-capability web backend key must not reroute the other capability. |
| `tests/tools/test_web_extract_robustness.py` | Tests for web_extract truncate-store robustness (findings from #54843 review). Covers two robustness gaps left unaddressed when #54843 merged: 1. |
| `tests/tools/test_web_extract_timeout.py` | web_extract provider dispatch must be wall-clock bounded (#57155, salvage #57180). |
| `tests/tools/test_web_free_fast_search.py` | Free managed Perplexity fast search for any Nous identity: anonymous guest, or signed in with no usable credits and no tool pool. |
| `tests/tools/test_web_keyless_fallback.py` | Keyless free-tier web search/extract fallback (Parallel + Exa MCP). |
| `tests/tools/test_web_keyless_rescue.py` | One-shot keyless rescue: keyed/configured backend fails → THIS call rides the keyless ring; the NEXT call attempts the chosen backend again. |
| `tests/tools/test_web_managed_routing.py` | Real config, dispatch and local HTTP must preserve web billing boundaries. |
| `tests/tools/test_web_picker_active_rows.py` | Picker row highlighting for per-capability web backends. |
| `tests/tools/test_web_providers.py` | Tests for the web tools provider architecture. Covers: - WebSearchProvider / WebExtractProvider ABC enforcement - Per-capability backend selection (_get_search_backe… |
| `tests/tools/test_web_providers_brave_free.py` | Tests for the Brave Search (free tier) web search provider. |
| `tests/tools/test_web_providers_ddgs.py` | Tests for the DuckDuckGo (ddgs) web search provider. |
| `tests/tools/test_web_providers_searxng.py` | Tests for the SearXNG web search provider. Covers: - SearXNGWebSearchProvider.is_available() env var gating - SearXNGWebSearchProvider.search() — happy path, HTTP er… |
| `tests/tools/test_web_providers_xai.py` | Tests for the xAI Web Search provider (plugins/web/xai/). |
| `tests/tools/test_web_result_cache.py` | Tests for tools/web_result_cache.py — TTL memo for web_search and the disk-backed extract cache, plus their wiring into web_tools. |
| `tests/tools/test_web_tools_config.py` | Tests for web backend client configuration and singleton behavior. |
| `tests/tools/test_web_tools_dict_urls.py` | Regression tests for model-forwarded web-search result objects. |
| `tests/tools/test_web_tools_perplexity.py` | Perplexity web backend — search + snippets dispatch through the real tools. |
| `tests/tools/test_web_tools_tavily.py` | Tests for Tavily web backend integration. Coverage: _tavily_request() — keyed Bearer vs keyless header, attribution, error bodies. |
| `tests/tools/test_web_tools_truncate.py` | Unit tests for the truncate-and-store web_extract path (no LLM). |
| `tests/tools/test_whatsapp_send_message_media.py` | WhatsApp media delivery for send_message (#19105). Covers two layers: * `_bridge_media_type` — extension/voice/force_document -> bridge mediaType. |
| `tests/tools/test_windows_agent_loop_papercuts.py` | Windows agent-loop correctness regressions. Covers the papercut class swept in #84364/#84378's follow-up: silent path mangling, crashes, and divergent hashing that m… |
| `tests/tools/test_windows_native_support.py` | Behavioral tests for Windows-specific compatibility fixes. |
| `tests/tools/test_working_diff.py` | Tests for tools.working_diff.collect_working_diff — the git collection layer shared by the CLI and gateway `/diff` command. |
| `tests/tools/test_write_deny.py` | Tests for _is_write_denied() — verifies deny list blocks sensitive paths on all platforms. |
| `tests/tools/test_write_file_rewrite_hint.py` | write_file tells the caller when it just re-sent a large file that was already on disk. |
| `tests/tools/test_write_file_syntax_gate.py` | Tests for the fail-closed pre-write syntax gate on write_file. |
| `tests/tools/test_write_verification.py` | Tests for write_file post-write content verification (verified flag). |
| `tests/tools/test_x_search_tool.py` | Tests for the X (Twitter) Search tool backed by xAI Responses API. |
| `tests/tools/test_xai_http_credentials.py` | Covers test xai credentials fail closed without profile scope; test xai credentials do not fall back to environ when scope has no key; test prefer api key wins over available oauth |
| `tests/tools/test_xai_http_storage.py` | Tests for xAI Imagine storage helper behavior. |
| `tests/tools/test_xlsx_phonetic_text.py` | Phonetic guides (XLSX `rPh`, DOCX `w:rt` ruby) annotate base text; they are not the value. |
| `tests/tools/test_yolo_mode.py` | Tests for --yolo (HERMES_YOLO_MODE) approval bypass. |
| `tests/tools/test_zombie_process_cleanup.py` | Tests for zombie process cleanup — verifies processes spawned by tools are properly reaped when agent sessions end. |

<!-- LEDGER-SENTINEL -->

### 1.4 Tier 3 — skipped with a reason

None. Every one of the 1 860 files in the shard was opened and read; the shard contains no binary assets, no generated or vendored files, and no file too large to open (the largest, tests/agent/test_run_agent.py at 300 KB, was read as head + tail + full test-name inventory).

## 2. Ideas worth stealing

*Convergence note: `CONVERGENT` means the pattern is standard enough across agent
harnesses that the `pi` / `deepseek-harness` shards almost certainly do something
equivalent; `UNIQUE` means it is a Hermes-specific mechanism that a reader would not
predict. Confirm against the sibling shards before relying on the labels.*

1. **One file per failure mode, named after the failure.** The suite is organised
   so that the filename *is* the incident: `test_credential_pool_sole_rotate_recovery.py`,
   `test_compression_rotation_state.py`, `test_413_image_payload_recovery.py`.
   August Trading's `tests/` currently mixes a policy test, a snapshot test and a
   regression test in the same file; splitting one file per *failure mode* makes
   "what did we break last time" a grep, and makes it obvious when a behaviour has
   no test at all. — `tests/agent/test_credential_pool_sole_rotate_recovery.py:1`,
   `tests/agent/test_compression_rotation_state.py:1` **UNIQUE**

2. **The docstring names the incident, the date and the user-visible symptom.**
   Almost every file opens with the production story. This turns a test suite into
   the system's institutional memory and makes an AI agent's first read of an
   unfamiliar repo far more efficient. — `tests/agent/test_error_classifier_observed.py:1-12`,
   `tests/tools/test_oneshot_footprint.py:1-6` **UNIQUE**

3. **Assert on absence, not on format.** `test_redact.py` asserts that the secret
   is *not present* in the output, never that it matches a particular mask, so the
   mask can change without breaking 131 tests. The same discipline appears in
   `test_memory_sync_redaction.py` ("asserts on absence of the secret, never on a
   mask format"). — `tests/agent/test_redact.py:1-10` **CONVERGENT**

4. **A timeout is not a denial.** The approval gate distinguishes
   `outcome == "timeout"` from `outcome == "denied"`, sets `user_consent = False`
   in both cases, and says "Silence is not consent" on the timeout path. Any
   approval surface in August Trading (the proposal gate, the "Log this trade"
   button) should carry the same distinction, or a stalled UI will be recorded as
   the trader saying no. — `tests/tools/test_approval.py` (tail, `test_guard_classifies_callback_timeout_as_timeout`),
   `tests/tools/test_approval_cancelled_attribution.py:1-6` **CONVERGENT**

5. **A "smart" reviewer never becomes the approver.** Hermes can ask an
   auxiliary LLM to classify a dangerous command, but the human's one approval
   applies to *that one command* — it never allowlists the pattern for the
   session. This is a clean rule for August Trading: the model may *propose* a
   trade or a tool action, but a single human "yes" must never become standing
   consent. — `tests/tools/test_approval.py:65-95` (`test_smart_approval_does_not_allowlist_the_pattern_for_session`) **UNIQUE**

6. **Persist the intent before the side effect.** A tool call is written to the
   session DB *before* the tool runs; if the write fails, the tool's side effect is
   blocked and the UI projection is withheld. The same "commit, then act" order
   governs credential rotation, compaction commits and skill mutations. August
   Trading's trade journal should persist the *proposal* (and its `planId`) before
   the order path, not after. — `tests/agent/test_tool_call_incremental_persistence.py:1-20` **CONVERGENT**

7. **Stage, don't block.** When the write-approval gate is on, a memory or skill
   write is *staged* to `<HERMES_HOME>/pending/<subsystem>/<id>.json` for
   out-of-band review rather than prompting inline or refusing. A durable,
   file-based review queue works in a desktop app with no active session, and it
   leaves an audit trail by construction. — `tests/tools/test_write_approval.py:1-9` **UNIQUE**

8. **Make every autonomous write reversible.** The skill ledger stores a
   *delta* (the before-bytes of the changed paths) plus the write origin
   (`agent` vs `background_review`), and can roll back. This is the difference
   between an autonomous learning loop and an autonomous learning loop that can
   delete itself. August Trading's learning/pattern subsystem needs the same
   before-bytes-plus-origin ledger. — `tests/tools/test_skill_ledger.py:1-10`,
   `tests/tools/test_skill_ledger_delta.py:1-8` **UNIQUE**

9. **A dedicated curator that archives instead of deleting, on a usage clock.**
   Skills go `stale` after 14 days unused and `archived` after 30; a pinned skill
   is never touched; a skill referenced by a scheduled job is exempt; the
   LLM-consolidation half is **opt-in** and the deterministic prune always runs.
   That is a complete, conservative rule-set for stopping learned rules from
   accumulating — directly applicable to August Trading's `services/learning/`
   rules, insights and pattern memory. — `tests/agent/test_curator.py:1-12`,
   `tests/agent/test_curator_classification.py:1-12` **UNIQUE**

10. **A scheduled job's identity is its *occurrence*, not its job id.** Cron
    dedupes on the canonical `scheduled_instant`, and the advance is persisted
    *before* dispatch — at-most-once, so a crash mid-run does not re-fire the job.
    A completed occurrence that is not re-run leaves exactly one WARNING line as
    its trace. This is the "did my 09:00 job already run?" question, answered
    exactly once. — `tests/agent/test_cron_inflight_prompt_reappend.py:1-12`,
    `tests/agent/test_max_iteration_handoff.py:1-8` **UNIQUE**

11. **A cron job's prompt is a single user turn, and compaction must not eat
    it.** `SUMMARY_PREFIX` literally says "If no user message appears AFTER this
    summary, do nothing", so a compacted cron run silently does nothing and
    records `last_status: ok`. The fix re-appends the in-flight task after the
    handoff. Any scheduled job in a summarising agent needs the same guarantee.
    — `tests/agent/test_cron_inflight_prompt_reappend.py:1-16` **UNIQUE**

12. **A soft-defer must never look like exhaustion.** A lock-contended
    compression is *deferred*; exhaustion is what the gateway answers with a full
    session auto-reset. Misclassifying a temporary wait as exhaustion is a
    session wipe. — `tests/agent/test_compression_lock_defer.py:1-14` **UNIQUE**

13. **A breaker that is not permanent.** The anti-thrash guard grants exactly
    **one** probation probe after a recovery window; an ineffective probe re-trips
    it and the next recovery waits a full fresh window. The counter is persisted
    in the session row so it survives a restart. This is a reusable shape for
    "stop the loop, but do not kill the session". —
    `tests/agent/test_compression_anti_thrash_recovery.py:1-18`,
    `tests/agent/test_compression_anti_thrash_persistence.py:1-14` **UNIQUE**

14. **Retry-delay parsing lives in one place.** Every consumer of `Retry-After`
    and of free-text reset grammars goes through one parser, so an HTTP-date
    header and a "resets in 2 hours 5 minutes" body yield the same wait
    everywhere. — `tests/agent/test_retry_delay_parsers_shared.py:1-8` **CONVERGENT**

15. **Demote, do not exclude, when ranking is skewed.** Cron sessions stay
    searchable but are ranked below interactive ones, because bare BM25 otherwise
    lets cron vocabulary starve the user's own sessions ("recall blindness"). A
    trading analogue is immediate: an automated-scan journal and a discretionary
    trade journal must not compete on the same ranking, or the recall tool
    surfaces only the bots. — `tests/tools/test_session_search.py:1-20` **UNIQUE**

16. **One search tool, four shapes inferred from the arguments.** There is no
    `mode` parameter for session search; the shape is inferred, which removes a
    whole class of model mistakes. — `tests/tools/test_session_search.py:1-12` **UNIQUE**

17. **The system prompt must not name tools the session cannot call.** A lean
    toolset gets a lean operating brief, and an unknown toolset keeps the full
    brief. August Trading's desk mandate and tool catalogue are exactly this
    hazard: a prompt that promises a tool the session does not have produces
    phantom tool references. — `tests/agent/test_phantom_tool_references.py:1-14` **UNIQUE**

18. **The prompt cache is a first-class contract.** "Every request in a session
    must re-send the previous request's content unchanged and only append"; the
    cache scope is the compression *lineage root*, not the physical session id, so
    a rotation does not go cache-cold. — `tests/agent/test_prompt_cache_scope.py:1-12`,
    `tests/agent/test_prompt_cache_prefix_contract.py:1-10` **CONVERGENT**

19. **Persist the bytes you sent.** The `api_content` sidecar stores the exact
    sent content of the current user turn and replays it verbatim, so the request
    prefix cannot diverge from the stored transcript — which is what the provider's
    prompt cache keys on. — `tests/agent/test_api_content_sidecar.py:1-14` **UNIQUE**

20. **A denial circuit-breaker for repeated refusals.** After N consecutive
    guardian denials in a session the smart-approval path short-circuits; any
    approval resets the tally. — `tests/tools/test_denial_circuit_breaker.py:1-10` **UNIQUE**

21. **A closed, hardline list that yolo cannot override.** The hardline
    commands are refused unconditionally; the dangerous list is what a human can
    approve; the allowlist is what is pre-approved. Three lists, three owners, no
    overlap. — `tests/tools/test_hardline_blocklist.py:1-12`,
    `tests/tools/test_approval_lifecycle_guard_parity.py:1-8` **CONVERGENT**

22. **Bounded everything, and the bound is in the test's name.**
    `test_approval_timeout_overflow.py` pins that an oversized `approvals.timeout`
    cannot overflow a platform wait primitive; `test_mcp_result_size_limit.py`
    pins the MCP result cap; `test_tool_output_limits.py` pins the three
    configurable output limits. — `tests/tools/test_approval_timeout_overflow.py:1-8` **CONVERGENT**

23. **Spill, don't truncate, when the output is worth keeping.** A large tool
    result is written to disk with a tag the model can follow and a later
    `read_file` recovers it whole. The transcript stays small; the evidence stays
    available. This is the right shape for a long market-data or backtest
    payload. — `tests/tools/test_tool_result_storage.py:1-12` **UNIQUE**

24. **Degrade the tool surface rather than the model.** The "process" schema
    names the verbs in an enum and the description carries only non-obvious
    semantics; the desktop tool consolidation merged 576 preview operations into
    ~235. — `tests/tools/test_process_schema_diet.py:1-6`,
    `tests/tools/test_desktop_tools_diet.py:1-8` **UNIQUE**

25. **The one-shot session drops the self-improvement footprint.** A finite run
    has no consumer for skills it creates, so the surface is removed
    (`skip_background_review`, no `skill_manage`). — `tests/agent/test_oneshot_footprint.py:1-10` **UNIQUE**

26. **Cost and cache counters belong on the per-call log line.** The line carries
    the cache-write count, the provider's response id and the serving upstream;
    an existing forensic parser reads them back. — `tests/agent/test_turn_usage_log_line.py:1-10` **UNIQUE**

27. **Prove the "no silent success" property structurally.** The file-mutation
    verifier makes it impossible for the model to claim "all files edited" when
    half the patches failed: the user always sees the list of files that did *not*
    change. Any agent that reports on its own work needs this. —
    `tests/agent/test_file_mutation_verifier.py:1-14` **UNIQUE**

28. **Assert the absence of a dead surface.** Turning a feature off must leave no
    schema entry, no prompt block, and no cost — `test_builtin_memory_disabled_surface.py`
    walks the real resolution chain (config on disk → check_fn → schema) and
    asserts the tool is gone. — `tests/agent/test_builtin_memory_disabled_surface.py:1-14` **UNIQUE**

## 3. Trading-specific findings

**Long-lived monitoring & scheduled work** — this is the strongest area of the
shard. Hermes runs scheduled work through `cron/` (a store, a tick loop, a
delivery queue, a detached worker) and the tests pin the reliability properties
that matter:

- **Exactly-once per occurrence.** A job's identity is the canonical
  `scheduled_instant`, and the recurring advance is persisted *before* dispatch
  (at-most-once on a crash). A completed occurrence is never re-run and leaves
  exactly one WARNING as its trace. — `tests/agent/test_cron_inflight_prompt_reappend.py:1-16`
- **The scheduler yields rather than double-fires.** A process holding stale code
  refuses admission and logs, once per episode, that "a fresher gateway owns the
  runtime lock — jobs will fire from that process". — `tests/tools/test_cronjob_run_primary_routed.py:1-8`
- **A missed run is not silently re-run.** The occurrence ledger and the
  completion check make a skipped slot explicit rather than a silent drop.
- **A stuck scheduler is diagnosable.** `cron/scheduler_diagnostics.py`,
  `cron/incidents.py` and `cron/notepad.py` exist, and
  `tests/agent/test_cronjob_run_delivery_notice.py` pins that a whitespace-only
  `deliver` defers to the error record rather than posting an empty message.
- **A breaker after repeated empty runs.** The compression fallback ladder
  escalates the cooldown 60 s → 300 s → 900 s on consecutive timeout-class
  failures and resets on success; the stall ladder ends in a deterministic
  fallback summary rather than re-entering the same silent route every turn.
  — `tests/agent/test_compression_fallback_budget.py:1-10`,
  `tests/agent/test_compression_stall_deterministic_fallback.py:1-12`
- **The missed-run equivalent for a human-wait**: the authorisation gate excludes
  a genuine human wait from the batch deadline, so a trader who takes 30 s to
  approve a proposal does not cause a timeout that cancels the trade. —
  `tests/agent/test_authorization_gate.py:1-14`

**Human-in-the-loop approval** — the approval surface is the most complete part
of the suite and maps directly onto a trading proposal gate:

- The **approval record** is a first-class object: `register_gateway_notify` /
  `submit_pending` / `resolve_gateway_approval` / `ack_gateway_approval` /
  `withdraw_gateway_approval`, plus a per-session allowlist and a permanent
  on-disk allowlist reconciled against hand edits to `config.yaml`.
  — `tests/tools/test_permanent_allowlist_live_reload.py:1-8`
- The **audit trail** is the structured result, not prose: `outcome`,
  `user_consent`, `smart_approved`, plus a one-sentence `user_summary` beside the
  model-facing `BLOCKED: … Do NOT retry` text.
  — `tests/tools/test_approval_user_summary.py:1-10`
- **Unattended contexts resolve differently.** `approvals.cron_mode`,
  `approvals.single_query_mode` and `approvals.unattended_mode` decide what a
  scheduled or headless run may do; `test_cron_not_interactive.py` proves a
  leaked `HERMES_EXEC_ASK=1` cannot make a cron run look interactive.
  — `tests/tools/test_cron_approval_mode.py:1-12`
- **An approval that nobody can answer fails closed** at once, without asking.
  — `tests/tools/test_protected_instruction_cli_channel.py:1-8`

**Post-mortem / reflection loops** — Hermes has two, and they answer the
"what stops bad rules accumulating" question directly:

- The **background review fork** reads the turn and may write memory or skills;
  it is scope-limited by trigger, tool-restricted at runtime, and its writes are
  *staged* behind the write-approval gate and recorded in the skill ledger.
- The **curator** is the garbage collector: usage-driven `stale` → `archived`
  (never delete), pinned skills exempt, cron-referenced skills exempt,
  consolidation opt-in, a per-run report and `run.json`, and a safety snapshot +
  rollback of the whole skills tree before any change.
  — `tests/agent/test_curator_backup.py:1-12`, `tests/agent/test_curator_classification.py:1-12`
- The **learning graph** turns skills and memories into a navigable structure with
  a "journey" that must show a foreground-created skill *before* its first use.
  — `tests/agent/test_learning_graph.py:1-8`, `tests/agent/test_learning_mutations.py:1-12`

**Multi-agent** — Hermes is firmly in the *subagent* camp, and the tests show
where the value is:

- The child is a **restricted clone**, not a peer: its toolset is the
  intersection with the parent's, its prompt-cache tier is downgraded, its
  summary is capped against the parent's remaining headroom, and it may not
  fan out further unless the parent is a dispatcher.
  — `tests/tools/test_delegate.py:1-16`, `tests/tools/test_delegate_child_cache_ttl.py:1-8`,
  `tests/tools/test_delegate_summary_budget.py:1-10`
- **Where debate is deliberately absent:** the MoA (mixture-of-agents) path is a
  *reference fan-out plus one aggregator*, and the tests treat it as a cost
  problem, not a quality win: `every_n` cadence reuses cached advisor guidance
  between iterations, the aggregator gets a **byte-stable prefix** so the prompt
  cache survives, and a cached reference is explicitly marked as predating the
  tool results below it. — `tests/agent/test_moa_fanout_cadence.py:1-8`,
  `tests/agent/test_moa_aggregator_prefix_stability.py:1-8`,
  `tests/agent/test_moa_stale_guidance_note.py:1-8`
- The honest summary: for Hermes, subagents add value for **fan-out work** (a
  reviewer, a per-file auditor) and cost value for **quality improvement of one
  answer** — the aggregator path exists but is engineered to be cheap, not to be
  clever.

**Structured logs the model can query** — the equivalent of a trade log is
SQLite (`hermes_state.SessionDB`) with an FTS5 index, and the model-facing reader
is a single tool:

- `tools/session_search_tool.py` — one tool, four inferred shapes, **no LLM
  calls**, FTS5 discovery deduped by lineage, a bounded scan, a per-message
  content cap, and demotion of automation sessions so a user's own history is
  not starved. No heavy database: SQLite + FTS5, which is the same choice
  August Trading has already made for its SQLite/IndexedDB layer.
  — `tests/tools/test_session_search.py:1-14`
- The durable artefacts around it are plain files: JSONL transcripts, a
  `processes.json` checkpoint, `~/.hermes/logs/curator/<ts>/run.json` + `REPORT.md`,
  `state.db` usage rows, and a `trajectory` file with a cross-process lock.
  — `tests/agent/test_trajectory_file_locking.py:1-6`,
  `tests/tools/test_process_registry.py:1-12`
- The trade-log equivalent Hermes does *not* have: no FTS over a structured
  *event* stream (entries, exits, fills). Everything is a **message** row with a
  role and text. A trading app needs the other shape.

**Staying simple as features accumulate** — the shard is itself the evidence,
and the mechanisms are explicit:

- The **tool surface is a diet**, measured: `test_desktop_tools_diet.py` records
  preview 576 → ~235 and project 244 → a single tool.
- The **schema diet** contract: an enum names the verbs, the description carries
  only non-obvious semantics, and dynamic schemas are *capability-gated* — an
  argument the active model cannot honour is not advertised at all.
  — `tests/tools/test_process_schema_diet.py:1-6`,
  `tests/tools/test_image_generate_schema.py:1-8`
- **Progressive disclosure** replaces "carry every tool": `tool_search` +
  `tool_describe` let the model fetch a schema on demand.
  — `tests/tools/test_tool_search.py:1-10`
- **A disabled feature leaves no surface** — no schema entry, no prompt block, no
  cost. — `tests/agent/test_builtin_memory_disabled_surface.py:1-14`
- **The one-shot session drops the self-improvement footprint** entirely.
  — `tests/agent/test_oneshot_footprint.py:1-8`
- **A size ratchet on the test files themselves**, and a deliberate "no snapshot
  of a growing catalogue" rule in the learning-graph tests.

## 4. Non-obvious decisions and gotchas

1. **A summary row is `role="user"` but is not a user turn.** The compaction
   handoff uses `role="user"` so the model reads it as context, and the prefix
   text says "If no user message appears AFTER this summary, do nothing" — which
   is exactly how a *cron* job silently became a no-op with `last_status: ok`.
   Any "detect the user's real ask" logic must exclude the summary. —
   `tests/agent/test_cron_inflight_prompt_reappend.py:1-16`,
   `tests/agent/test_reference_handoff_active_turn.py:1-14`

2. **A "successful" credential rotation can be a lie.** The refresh POST spends a
   single-use refresh token; if the *commit* to disk fails, the pair is gone but
   the disk still holds the old one. The rule: never report, mark or persist a
   rotation as successful unless the commit landed — and a later `load_pool()`
   must not resurrect the spent pair. —
   `tests/agent/test_anthropic_credential_persist_failure.py:1-16`,
   `tests/agent/test_anthropic_spent_rotation_verdict.py:1-14`

3. **A 403 is not an auth failure.** A WAF/CDN 403 in front of the provider is
   `upstream_blocked`; printing key guidance for it sends the user to rotate a
   key that was fine. — `tests/agent/test_error_classifier_upstream_blocked.py:1-8`

4. **A 400 for the model's own malformed tool JSON must not walk the fallback
   chain.** Walking it re-sends a 40 KB transcript to every configured provider
   for a request that can never succeed. —
   `tests/agent/test_malformed_tool_args_no_fallback.py:1-10`

5. **Classification is provider-scoped, not status-scoped.** A generic Anthropic
   429 benches only the model that was rate-limited; auth and billing failures
   stay credential-wide. — `tests/agent/test_anthropic_model_cooldowns.py:1-8`

6. **Empty ≠ deterministic.** The empty-response guard only calls an empty reply
   deterministic after two attempts with the *same* signature (model, provider,
   finish_reason) and no observed generation. A single attempt, or any observed
   reasoning, is never deterministic — otherwise a reasoning model is billed
   twice for a thinking answer. — `tests/agent/test_empty_response_guard.py:1-20`

7. **"Thinking off" must be sent explicitly.** On adaptive Claude models,
   omitting `thinking` is *not* a disable; `{"type":"disabled"}` is. A route that
   rejects the disable keeps the omission — a silently ignored disable is a
   better failure than a dead turn. —
   `tests/agent/test_anthropic_thinking_disable.py:1-14`

8. **A blank text block is a permanent session wedge.** Anthropic and Bedrock
   both reject a whitespace-only text block with a 400 that replays on every
   turn. The fix must be at the **request** level, not only per-message, because
   a summary message or a role merge can synthesise the blank afterwards.
   — `tests/agent/test_anthropic_request_blank_block_guard.py:1-10`,
   `tests/agent/test_bedrock_empty_text_blocks.py:1-8`

9. **A partial stream must not seed a continuation stub.** After partial
   delivery, a context-overflow error must return a *terminal* stub; seeding tens
   of KB of partial content makes every later request larger, so the session
   loops forever growing the context. —
   `tests/agent/test_overflow_partial_terminal.py:1-10`

10. **Provider-minted tool-call ids are rewritten once, at mint time** — and the
    rewrite must survive the composite `response_item` half. A stale id
    announcement produces two executable calls. —
    `tests/agent/test_provider_id_mint_normalization.py:1-10`

11. **A superseded attempt must not clobber the new one.** The compression
    attempt generation counter means a late unwinding primary cannot restore
    stale state over a fallback that has already committed; the commit fence slot
    is a *stack*, not a save/restore cell. —
    `tests/agent/test_compression_attempt_ownership.py:1-16`,
    `tests/agent/test_compression_commit_fence_race.py:1-8`

12. **The "one row per turn" rule for the transcript.** A tool call and its
    result are one *paired* row; a line count that doubles per call doubles every
    number the user is shown. The tool trail and the payload ids are separate
    fields for this reason.

13. **A background review fork inherits the parent's cached system prompt
    byte-for-byte.** Rebuilding it (fresh timestamp, fresh session id, a
    different skills prompt) costs the whole uncached system prompt per nudge —
    a measured ~26 % of the turn. The fork also inherits the parent's tool
    *schema* so the prefix matches, and restricts tools at runtime instead.
    — `tests/agent/test_background_review_cache_parity.py:1-14`

14. **Tool results are truncated by ONE algorithm** — 40 % head / 60 % tail, one
    marker — shared by terminal, `execute_code`, MCP and the bounded collector.
    — `tests/tools/test_tool_output_truncate.py:1-8`

15. **An untrusted checkout must not run anything.** The LSP layer only starts
    allow-listed servers in an untrusted workspace, pinned to Hermes' own code, and
    never evaluates the repo's `.venv`, `node_modules`, `svelte.config.js` or
    `rust-toolchain.toml`. The tests record which servers *would* start rather
    than executing them. — `tests/agent/lsp/test_workspace_trust.py:1-14`

16. **A Windows NT device-namespace path must be refused on the raw string,
    before any resolution** — merely resolving `\\??\UNC\host\share` initiates
    SMB authentication and leaks the user's NTLM hash. —
    `tests/agent/test_nt_namespace_guard.py:1-8`

17. **Do not close a TLS client's file descriptors from another thread.**
    `close()` from a non-owning thread releases the raw fd while the owner's
    OpenSSL BIO still caches that integer, so the next `open()` in the process can
    hand the same integer to a database handle — and the owner's unwinding TLS
    flush writes an application record into that database file. `shutdown()` is
    FD-safe from any thread; `close()` is not.
    — `tests/agent/test_codex_aux_timeout_fd_ownership.py:1-8`

18. **A killed process tree that still has survivors is not a kill.** No killed
    receipt, no prune — otherwise the live tree becomes unmanageable.
    — `tests/tools/test_kill_verify_tree_death.py:1-10`

## 5. Weak spots

1. **The suite is a monument to a five-alarm firefight.** A large fraction of
   `tests/agent/` exists to repair damage from *earlier* repairs: attempt
   generations, commit fences, restore guards, stale-baseline detection, marker
   sweeps, re-anchored indices, ownership fences, supersession splits, lock
   deferrals, cooldown escalations, backoff refunds, budget re-arms, attempt
   lifecycles, attempt ownership, attempt telemetry. The compression subsystem
   alone carries ~90 files. This is honest engineering under a hostile provider
   surface, but it is also a signal that the *state machine* is too implicit —
   the guards are symptoms, and each new guard is another thing to keep
   consistent. August Trading should read this as a warning about compaction
   design, not as a template.

2. **The provider surface is enormous and the portability cost is real.** Roughly
   a third of `tests/agent/` is per-provider adaptation (Anthropic, Bedrock,
   Gemini, Codex, Grok, Kimi, DeepSeek, GLM, MiniMax, Azure, Vertex, Copilot,
   Nous, OpenRouter, xAI, and half a dozen relays), each with its own wire
   quirks. Hermes pays this to serve every provider; August Trading serves one
   (or two) and must not copy this shape.

3. **The "one giant file" habit is still visible.** `test_run_agent.py` is
   300 KB with 247 cases, `test_context_compressor.py` is 181 KB, `test_approval.py`
   is 91 KB. The shard shows the author *knows* this is a problem — several
   files were split out with a note "code-health size ratchet" — but the ratchet
   is applied ad hoc, by hand, and the big files are still big.

4. **The test names are excellent; the test *bodies* are often over-specified.**
   Many files assert on exact wire bytes, exact log lines and exact SQL, which
   makes them change-detectors: a reworded warning or a re-ordered column is a
   red test with no behaviour change. The learning-graph file explicitly avoids
   this ("a count assertion would be a change-detector") — that discipline is
   applied there and largely *not* applied elsewhere.

5. **Some of the security surface is asserted but not enforced end to end.**
   The workspace-trust tests record "which servers Hermes would start" rather
   than proving nothing in an untrusted checkout can execute; the
   self-repo guard is a soft block; the sandbox-mirror guard is explicitly "defense
   in depth, NOT a security boundary". The threat model is documented honestly,
   but the guarantees are narrower than the test names suggest.

6. **A handful of files are pure speculation about other harnesses.** A few
   docstrings reason about what Claude Code or opencode does
   ("port of openai/codex#37527", "inspired by Claude Code 2.1.205's auto-mode
   rule"), and the resulting ports inherit the *other* project's assumptions
   without the other project's evidence. A reader who trusts those pins is
   trusting a second-hand contract.
