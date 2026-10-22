# hermes-agent — architecture

**A synthesis of the shard reports in `shards/`, plus the coverage ledger.**

`NousResearch/hermes-agent` is a **Python-first** agent (20,695 tracked files,
220 MB) with a TypeScript desktop app and TUI. It is the largest and the most
*operational* of the three references: where `pi` and `deepseek-harness` are
libraries and a product, Hermes is an **agent that runs unattended on a server**
and therefore has to survive crashes, duplicate ticks, multi-profile hosts, and a
human who is sometimes not there.

> *"The self-improving AI agent built by Nous Research. It's the only agent with a
> built-in learning loop — it creates skills from experience, improves them during
> use, nudges itself to persist knowledge, searches its own past conversations, and
> builds a deepening model of who you are across sessions."*

---

## 1. The shape of the repo

| Area | What it owns |
| --- | --- |
| `hermes_state_*.py` (60 files, the root) | The state plane: sessions, messages, schema, search (FTS), compression, a WAL, a local store, portability, repair, reconciliation, runtime workers, and the **mutation binding** that gates every write. |
| `agent/` + `run_agent.py` | The agent loop and the tool registry. |
| `tools/` (371) | The tool implementations, including the skill manager, the skill ledger, the skill usage sidecar, the skill provenance, the linter and the evaluator. |
| `skills/` (331) + `optional-skills/` (857) | The skill corpus: `<category>/<skill>/SKILL.md` plus `references/ templates/ scripts/ assets/`. |
| `cron/` (46) | The scheduler — and the single densest invariants file in the repo. |
| `gateway/` (328) + `tui_gateway/` (119) | The messaging gateways (Telegram, Discord, Slack, WhatsApp, Signal, CLI) and the TUI bridge. |
| `hermes_cli/` (766) | The CLI: subcommands, observability, web routers, local runtime, dashboard auth, proxy. |
| `apps/desktop/` (4,314) | The Electron desktop app. |
| `ui-tui/` (627), `web/` (250) | The terminal and web clients. |
| `evals/` (236) | Evaluations, including a `postmortem` and a `compaction` suite. |
| `tests/` (7,225) | The test suite. |

---

## 2. The scheduler — the densest invariants in any of the three repos

`cron/AGENTS.md` is a document written by the people who got hurt. Its own framing:
*"Hardening invariants — each guards a real failure; don't weaken without answering
for it."*

- **The inactivity watchdog is IDLE time, not wall-clock.** Default 600s idle,
  `HERMES_CRON_TIMEOUT` overrides, `0` = unlimited. *"A stalled session is
  hard-interrupted so it cannot monopolise the scheduler, while a long-but-active job
  is never cut off."* Attached scripts are bounded separately (3600s).
- **Every recurring occurrence is accounted for.** `tick()` advances `next_run_at`
  **BEFORE** dispatch (at-most-once across a mid-run crash) and stamps `pending_slot`
  in the same save; a scan that finds the stamp with a dead owner restores the
  instant **ONCE**; the executions ledger's `scheduled_instant` blocks a second
  fire; `cron.catch_up_missed: false` skips past-grace misses **with a logged
  reason**. *"Never drop a slot silently (#107485)."*
- **The catch-up window is half the period**, clamped to 120s–2h, with a 120s grace
  for missed one-shots.
- **A per-home tick lock** prevents duplicate ticks across processes for that
  profile's store — and *"never a `~/.hermes/...` literal"*.
- **Headless ticks refuse, never spawn.** `hermes cron tick` (system crontab) calls
  `tick(headless=True)`; `cron/scheduler_gateway_gate.py` **skips** agent jobs when
  discovery says no gateway owns the home — stamping `last_fire_error`, warning once
  per tick, and leaving the due instant untouched — rather than letting
  `run_canonical_job → connect_gateway → ensure_gateway_runtime` spawn an unmanaged
  daemon. *"Same policy as approvals (headless/cron = refuse)."*
- **A claim is released under the key it was registered with.** The cron scope is a
  `ContextVar`; the pool worker's `finally` sits *outside* `ctx.run` and resolves the
  launch home. Pass the registering home, or every secondary profile's claim leaks.
- **Per-profile process assumptions are the bug class.** One process ticks N homes, so
  anything keyed on "this process's profile" is wrong. In-flight state is keyed by
  `_inflight_key(job_id) = (home key, job id)` — *"two profiles legitimately carry a
  `daily-brief`; the union made profile A's running `daily-brief` answer for profile
  B's idle one."*

This is the single most directly applicable body of material in any of the three
repos for a trading app with scheduled automations.

---

## 3. The skill lifecycle — the best answer to "how do you stop bad rules accumulating"

`tools/skill_manager_tool.py` (47 KB) and its three siblings.

**The lifecycle is explicit and small:**

- `tools/skill_usage.py` — *"Lifecycle: active -> stale -> archived (moved to
  `.archive/`); `pinned` opts out of auto transitions, orthogonal to state."*
- **Usage telemetry lives in a sidecar**, `~/.hermes/skills/.usage.json`, *"never
  frontmatter — keeps telemetry out of user-authored SKILL.md and off bundled/hub
  skills"*.
- **Provenance is an explicit marker, never inferred.** `created_by: agent` is
  written by `skill_manage`; *"never inferred from location"*
  (`tools/skill_usage.py:4-5`, enforced by `tools/skill_manager_guards.py:192-197`).
- **Write origin is a `ContextVar`.** `tools/skill_provenance.py` separates a
  background-review write from a foreground, user-directed one: *"the curator only
  curates skills the self-improvement review fork created; skills a user asked for
  belong to the user."*
- **A skill is a directory**, not a file:
  `<skills>/[category/]<skill>/SKILL.md` plus optional `references/ templates/
  scripts/ assets/`.

**The audit ledger is a JSONL file, not the database:**

> `tools/skill_ledger.py` — *"Per-mutation skill audit ledger + single-edit rollback.
> Every skill mutation (any actor) appends one JSONL entry to
> `~/.hermes/skills/.curator_ledger.jsonl` with before/after file manifests whose
> contents are stored content-addressed (sha256-deduped) under
> `~/.hermes/.curator_backups/blobs/`. JSONL, not the state DB: durable, greppable,
> survives DB resets. TELEMETRY, NOT A GATE: every public write path swallows and
> logs — except `rollback_entry`, which FAILS CLOSED when its safety capture
> fails."*

**The guards are separate files with one job each:** `tools/skill_manager_guards.py`
(every guard returns `None` when the operation may proceed, else a refusal),
`tools/skill_linter.py`, `tools/skillevaluator_scan.py`, `tools/skill_provenance.py`.

**A script is always a file, never a command line.** `script='echo hi'` is refused
at creation; a script is always a FILE under `HERMES_HOME/scripts/`.

---

## 4. Human-in-the-loop approval

Three separate mechanisms, each with a different scope:

1. **Approval *mode* is profile-scoped configuration, not conversation state.**
   `hermes_cli/approval_mode.py` — the modes are `manual`, `smart`, `off`. Changing
   it *"affects subsequent terminal guard checks immediately because approval.py
   loads config on each check; it must not rebuild a live agent or mutate its system
   prompt/tool schema, preserving the prompt-cache prefix."*
2. **The approval prompt says three things, and says them in one place.**
   `gateway/platforms/base_exec_approval.py` — *"what Hermes wants to run, why it
   was flagged, and that silence means the command does NOT run once
   `approvals.timeout` elapses. Keeping the text here means one edit changes every
   platform."* The timeout notice reads: *"⌛ Approval timed out after {window} —
   the command was NOT run. Ask me to try again if you still want it, or raise
   approvals.timeout in config.yaml."*
3. **An unattended context refuses rather than acts** (see the cron section).

**Silence means no.** That is the rule worth stealing: a consequential action that
needs a human and does not get one does not happen.

---

## 5. The state plane

`hermes_state_*.py` is 60 root files and a few hundred KB, and it is the part of
Hermes that most resembles a database — but it is **files**: a WAL
(`hermes_state_wal.py`), an FTS index (`hermes_state_fts.py`), a schema
(`hermes_state_schema.py`), a search surface (`hermes_state_search.py`), a session
and message store, a compression worker, a repair pass, a reconciliation pass, and
a **mutation binding** that is the control-only ownership seam for unbound legacy
history.

`hermes_state_mutation_binding.py` opens with a line that is the whole design in
six words: **"Control-only ownership for unbound legacy history; never an execution
policy."**

---

## 6. Staying simple

The seams are one-idea files, and the corpus is files:

- **Skills are directories of markdown.** A skill is a `SKILL.md` plus optional
  `references/ templates/ scripts/ assets/` — no database, no schema, no migration.
- **The ledger is JSONL** — *"durable, greppable, survives DB resets."*
- **The usage sidecar is a sidecar** — telemetry never touches a user-authored file.
- **Scripts are files**, never command lines.
- **The agent is a loop over a tool registry**; the tools are plugins; the corpus is
  markdown.

---

## 7. Weak spots in this reference

- **The scheduler is a correctness minefield, and the file says so.** Every
  invariant in `cron/AGENTS.md` exists because a specific bug shipped. The
  per-profile keying, the `ContextVar` scope, the claim-release key — each is a
  lesson paid for. A trader-facing product should not copy this complexity; it
  should copy the *rules* (advance the slot before dispatch, idle not wall-clock,
  refuse rather than spawn) and nothing else.
- **`tools/skill_manager_tool.py` is 47 KB in one file.** The guards are split out,
  but the tool itself is not.
- **The contributor directory is PII** — `contributors/emails/` holds 2,110 personal
  email addresses. It is **skipped and deliberately not read** in this research, and
  nothing from it is reproduced anywhere in these reports.
- **`hermes_state_common.py` is 74 KB** and `hermes_state_messages.py` is 130 KB —
  the state plane concentrates a great deal in single files.

---

## 8. Coverage — the gate PASSES

**20,695 tracked files. 20,695 ledger rows. 0 pending, 0 missing, 0 skipped without a
reason, 34 of 34 shards complete. GATE PASS.**

| | Files | Share |
| --- | ---: | ---: |
| **Read** | 18,168 | 87.8 % |
| **Skipped, with a reason** | 2,527 | 12.2 % |
| Pending / missing / unexplained | **0** | 0 % |

By type: `source` 5,708 read / 109 skipped · `tests` 9,372 read / 4 skipped ·
`docs` 1,620 / 73 · `config` 1,118 / 17 · `build-CI` 301 / 3 · `examples` 49 / 0 ·
`assets` 0 / 186 · `generated-vendored` 0 / 2,135.

**These are the post-re-dispatch numbers.** An earlier version of this table was
generated before the 24 `tui_gateway/methods_*.py` files were re-read (§ below) and
counted them as skipped (18,144 / 2,551, with `source` 5,684 / 133). The manifest,
`coverage.tsv` and `STATUS.md` all carry 18,168 / 2,527; this table now matches them.

**What the 2,551 skipped files are.** Every one carries a one-line reason:

- **2,110 contributor records** — one per person, containing a personal email
  address. **Deliberately not read and not reproduced anywhere in these reports.**
  Two of the 2,112 are profile metadata derived from the git log, also skipped.
- **54 brand design-system markdown files** (~1 MB) — catalogued as a set.
- **~190 binary assets** — confirmed by name and byte size.
- **The rest** are generated or vendored files, and a set of helper scripts read
  by their module docstring plus their public function signatures rather than
  line by line; the note says exactly that.

**One gap was re-dispatched rather than accepted.** The `hermes-tui-gateway` reader
ran out of budget and left 24 `tui_gateway/methods_*.py` files unread, marking
them `skipped` with the reason *"not reached before this run's read budget was
exhausted"*. That is an honest skip, but it is not coverage, so those 24 files were
re-dispatched and read. **The gate is not satisfied by an admission of not having
read something; it is satisfied by reading it.**

**The authoritative numbers are generated, not written by hand:**

- **`docs/research/hermes-agent/COVERAGE.md`** — the per-shard table
  (files / read / skipped-with-a-reason / pending / missing-from-ledger).
- **`docs/research/hermes-agent/coverage.tsv`** — the same, as TSV.
- **`docs/research/hermes-agent/manifest.tsv`** — the full ledger: every tracked
  file, its size, its type, its owning shard, its status and its reason.

Regenerate with `node %TEMP%\harness-research\merge-status.mjs` (merges the shard
ledgers into the manifest and diffs it against `git ls-files`), then
`node %TEMP%\harness-research\gen-coverage.mjs` (rebuilds `COVERAGE.md`).

**Lead spot-checks.** The lead re-opened the source and confirmed the claims rather
than trusting the shard authors:

- `hermes-cron`: `cron/occurrences.py:78` (`unclaimed_pending_slot` — *"Stored
  instant of a slot the dispatcher never claimed"*) and `cron/jobs.py:3194`
  (`_restore_unclaimed_slot` — *"Put an occurrence the dispatcher advanced past but
  never claimed back on the schedule (#107485) … Restored ONCE"*) — **both verified
  exactly, at the cited lines, including the issue number.**
- `hermes-tools`: `tools/skill_provenance.py:1-9` (the write-origin `ContextVar`),
  `tools/skill_usage.py:1-6` (the sidecar) and `tools/skill_usage.py:70`
  (`skill_file_lock`, *"Re-entrant within one thread"*) — **verified exactly**.
- `hermes-skills-core`: `tools/skill_usage.py:4-5` (*"an explicit `created_by: agent`
  marker written by skill_manage — never inferred from location"*), `:35`
  (`STATE_ACTIVE, STATE_STALE, STATE_ARCHIVED`) and `:56` (`.archive`) — **verified
  exactly**.

**One attribution was corrected as a result:** the `created_by` marker is documented
in `tools/skill_usage.py:4-5` and enforced by `tools/skill_manager_guards.py:192-197`,
not in `tools/skill_manager_tool.py` as the proposals first stated. **No claim was
found false.**