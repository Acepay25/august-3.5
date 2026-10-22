# deepseek-harness — architecture

**A synthesis of the shard reports in `shards/`, plus the coverage ledger.**

`deepseek-ai/deepseek-harness` is a TypeScript monorepo (pnpm workspaces, 66
`packages/*` + 4 `apps/*`). It is the most architecturally opinionated of the three
references: it treats the **session event log** as the spine of the whole system, and
almost everything else is either a writer of, or a reader of, that log.

---

## 1. The one idea the whole repo is built on

**The append-only session event log is the single source of truth.**

`packages/session` — 345 files, the largest shard in the ledger — holds an
**event-sourced session**: a durable, ordered log of everything that happened
(`turn/start`, `step/start`, `user/message`, `assistant/message`, `tool/call`,
`tool/result`, `approval/asked`, `llm/retry`, `compaction/start` … `compaction/end`,
`goal/change`, `schedule/change`, `todo/write`, `team/*`). No package in the repo
owns a database. Compaction appends a *bracket* to the log; the log is the durable
lock, the audit trail and the queryable corpus at once.

Three consequences run through everything:

1. **The log leads, the cache follows — and the ordering is the contract.**
   `session-projection-cache` takes the checkpoint cut *before* flushing the
   session's events, so a crash can leave the cache **behind** the log (a longer tail
   replay) but never **ahead** of it (phantom values folded from events the stored log
   does not contain). One sentence of ordering removes an entire class of "the panel
   shows a trade that is not in the journal" bug.

2. **A derived cache is a shortcut, never an authority: possibly stale, never
   wrong.** Every write path is fail-soft ("a lost write costs a longer tail
   replay"); a version mismatch *discards* the row rather than migrating it; a row
   that fails its schema is moved aside as `<id>.json.bak.<stamp>` rather than
   costing the boot.

3. **A state-carrying log event carries the COMPLETE post-change state, never a
   bare delta.** Every unit is a synchronous `apply(state, event)` that returns the
   *same reference* when the event does not concern it, so two `Object.is` gates make
   the whole thing free when nothing changed. A reader never has to reconstruct a
   value from a delta chain.

### The prompt is a log event, not a parameter

This is the sharpest idea in the repo, and it is in `packages/core/agent-loop`
(175 files). `step()` calls `this.systemPrompt.project(renderedPrompt, …)` and
appends the result as `system/message` nodes *before* `buildRequest` derives
`session.deriveMessages()`. **The request therefore carries no `system` field** — the
prompt reaches the provider as ordinary derived history, and the request is a pure
fold over the log (`packages/core/agent-loop/src/agent.ts`, and
`packages/core/agent-loop/src/runtime-context.ts:90-103`).

The corollary is a prompt-cache decision worth stealing: a capable continuing series
**appends** the changed prompt rather than replacing node 0, *"because appending
preserves the cached prefix; replacing node 0 in full would miss the provider's
prefix cache from that token"* (`runtime-context.ts:100-103`). And an empty prompt is
not the same as no prompt: *"The first prompt — even an empty one — reserves surface
node 0"*, because "no system node" and "an empty prompt" are different states
(`runtime-context.ts:90-92`).

### Two APIs, one log

`docs/agent-lifecycle.md` (generated from the source) draws the line explicitly:
**`session/event` carries the durable replay facts; `agent/*` is the live
coordination API** — queue/status, prompt interception, request construction,
steering, continuation and errors. *"SDK users that need replayable transcript data
should consume `session/event`; `agent/*` is the live coordination API."*

---

## 2. The turn lifecycle

`packages/core/agent-loop/src/agent.ts` owns it. The state machine is one union,
`Phase` (`idle | maintenance | running`, `src/agent.ts:42`); the flow is
`send()` → inbox splice → `wakeDriver()` → `kick()` → `turn()` → `preStep()` →
`step()` → `prepareRequest()` → `buildRequest()` → `AssistantStreamAttempt` →
durable `assistant/message` → `executeToolCalls()` → durable `tool/call`/`tool/result`
pairs → next step.

Decisions in it that a rebuild would not guess:

- **`max-tokens` is sticky for the whole turn** (`agent.ts:338-341`): once any step
  hits the output ceiling, a later step that completes normally must not downgrade
  the turn's ending.
- **Only adapter failures are recoverable.** A provider/adapter failure enters the
  `agent/request-error` waterfall where a listener may answer `{ kind: 'retry' }`;
  middleware / result-processing / plugin failures are thrown and close the turn
  directly — *"plugin failure ends the turn, not the loop."*
- **A cancelled stream still commits what the user saw** (`agent.ts:400-417`): the
  delivered prefix is appended as an `assistant/message` with `interrupted: true`,
  so the next request contains it. If nothing was delivered, an `assistant/attempt`
  event is committed instead.
- **Failure results for unanswered tool calls are written before the step closes**
  (`agent.ts:270-283`): a recorded `tool/call` with no committed result gets
  `TOOL_OUTCOME_UNKNOWN`, a request with no call record gets `TOOL_NOT_STARTED`.
- **The request is deep-frozen per message identity**, and the identity is
  remembered in a `WeakSet` (`agent.ts:118`, `:530-537`). The `AbortSignal` is the
  one mutable part of a frozen request (`:539-547`).
- **The durable write barrier is explicit and separate from the best-effort write**:
  *"`append` is best-effort; only a resolved `flush` promises it survives a crash."*

### The inbox is in the log, not in memory

`packages/core/agent-loop/src/inbox.ts` holds pending input (a queued prompt for the
next turn, steering for the next step) **in the session log**, as `agent/inbox/spliced`
events. The projection is the source of truth, not a cache: `ReactLoopInbox` reads
`projections.stateOf(session, 'inbox')` for *every* operation, so a resumed session
rebuilds its pending queue from the log.

The rule that is easiest to get wrong: **a live mutation is forgiving, a replayed one
is not.** NaN splice coordinates are normalised to 0, negative indices count from the
end, over-long delete counts clamp — but a persisted out-of-range or
duplicate-identity splice throws `invalid persisted inbox splice at session seq N`
(`inbox.ts:31-72`).

---

## 3. Tools, skills, goals, schedules

### Tools are plugins, and the catalogue is generated from the running system

`docs/tool-catalog.md` is a **generated** document. The generator *"BOOTS each tool
plugin on a real context and reads `ctx.tools.schemas()`, because a tool schema is
not statically knowable (runtime-spread enums, concatenated descriptions,
config-driven names, raw-JSON-Schema MCP tools)"*. A completeness guard *"fails if
any package is missing from the generator's boot manifest, so a new tool cannot be
silently undocumented"*, and `pnpm run verify-tool-catalog` is part of `doc-sync`.

The tool packages themselves are thin: the model-visible name is a load-time config
(`toolName`), and the per-package note records shipped aliases.

### Skills: catalogue and body are separate

`packages/skill` splits the **catalogue** (the index a model sees) from the **body**
(the procedure). *"Every load re-reads the current file, so editing a skill body needs
no versioning or cache invalidation."* The registry refuses to grow a second
abstraction: the provider interface is `list()` + `get()`, and everything else
(ranking, shadowing, invalidation) is the registry's problem.

### Goals: a durable round count, not an in-memory counter

`packages/goal/goal-round-driver/src/index.ts:111/150/176` is the repo's answer to
"how do you run a long-lived loop reliably". The driver fires **only at whole-agent
idle, only for an *armed* goal, only after a fail-closed durability checkpoint, and
only once the agent's descendants have settled**. The round allowance is a **durable
admitted-round count derived from the log** (`packages/goal/goal/src/fold.ts:325-330`),
so it survives a restart. At the cap the round exits with a **stable code**
(`round-limit`), and there is **no auto-restart after a cancellation**.

What the repo says is *absent*: catch-up for missed runs, wall-clock or cost budgets,
and any metering beyond the round count — the README says so outright ("Round cap,
not resource budget").

### The goal tool's authority is two-tier, and the log is the audit trail

`packages/goal/tool-goal/src/authority.ts:100/111`: `direct-human` for edit / pause /
resume, and `direct-human` *or* `goal-round` for complete / blocked. Every mutation
is a `goal/change` event with the full post-mutation snapshot, and the fold can prove
that a recorded change was legal (`packages/goal/goal/src/fold.ts:200`). **There is
no separate approval table; the log IS the audit trail.** And the model cannot resume
a durably paused goal (`packages/goal/tool-goal/src/index.ts:270`) — the human owns
that transition.

The goal domain is explicitly **single-owner**: one current goal per session, and
the tool authority refuses a live child agent creating or editing a goal
(`authority.ts:80`). Subagents are *waited for*, never debated with.

### Schedules and jobs

`packages/schedule` + `packages/jobs` + `packages/workflow` (the
`dsh-workflow-jobs-schedule` shard, 139 files). The schedule tool accepts
`after_seconds`, an absolute `at`, a bounded `every_seconds`, daily/weekly local
times in an explicit IANA zone, and a five-field cron; *"due messages resume the
original Session"*. The jobs seam is the kind-agnostic background-job controller
(`job_kill`, `job_list`, `job_output`).

---

## 4. Context, compaction, and the spill store

`packages/compaction` + `packages/context` + `packages/session-query` (221 files).

**Compaction is a bracket on the log, not a rewrite of the history.**
`compaction/start` establishes a group id; `compaction/summary` / `compaction/end`
inherit it; a `user/message` whose source is the compact plugin inherits it too; and
`session/end-seed` **clears** it — a new seed boundary starts a new compaction group.
The trigger is a *minimum* of two independent bounds: the window fraction is a soft
target and the headroom arithmetic is a hard floor (`packages/compaction/compaction-basic/src/config.ts:203-206`).
Unknown config keys are a **hard error**, not a warning (`:330`) — *"Reject stale or
misspelled keys before defaults can hide them."*

**The context plugins are separate, named seams**: `agent-instructions`,
`session-reference`, `file-reference`, `file-reference-local`, `time-context`,
`tmux-context`, `harness-dev-context`. Each is one idea with one file, which is why
adding one does not grow a branch inside another.

**The spill store is the "no heavy database" answer.** When a payload is too big for
the context it is written to a private session-scoped file and the model gets **a
path plus a retrieval hint** — *"Use read with offset/limit, or grep this path to
search within it"* (`packages/spill/spill-local/src/index.ts:149-157`). The seam is
one method and owns no policy (`packages/spill/spill/src/index.ts:29-42`).

**`session-query` is how a model reads its own past.** Five read-only tools
(`session_event_read`, `session_event_search`, `session_event_trace`,
`session_search`, `session_trace`) hide provider cursors and authorise every result
from the immutable calling agent session.

---

## 5. Storage, format, and the details that cost a rebuild

`packages/session` is the deepest shard in the ledger, and much of it is **format
discipline** — the frozen v0/v1 session format, its migrations, and its validators.

- **The format chain is a build-time artefact, not a runtime plugin registry.**
  `session-format-catalog/src/generated.ts` is generated and the chain is asserted
  gap-free at module init; *"A profile cannot add, remove, or reorder an edge by
  mounting a feature plugin."* A missing edge is a *build* error.
- **A frozen validator can be reused against a newer shape by giving it a
  "costume."** The V2→V3 validator builds a **private view** of the V3 artifact
  (`system/message` → a `user/message` stand-in, `{startSeq,endSeq}` → `{start,end}`),
  runs the *frozen* v0→v1 relationship validator on the projection, and returns the
  **original artifact unchanged**. This is the single most reusable technique in the
  shard.
- **"Recoverable" is a prefix rule, not a best-effort rule.** A malformed row is
  dropped and the preceding prefix is kept — but if a later decoded `turn/end` proves
  the region was committed, the **first error is re-thrown**.
- **Distinguish "unsupported version" from "corrupt" in every user-facing refusal.**
  A newer log says *"upgrade the harness"*, an older one says *"no upgrade path"*, and
  **neither ever says "corrupt"**.
- **A POSIX `flock` names an inode, not a path.** The holder verifies the locked
  inode is still the file at the lock path and retries otherwise; and there is
  deliberately **no lease expiry**, because an expiry could expropriate a stalled
  writer *"whose resumed appends would tear the log."*
- **`link()` rather than `rename()` for publication.** `link()` fails with `EEXIST`
  if the target exists, so two processes materialising the same id cannot clobber
  each other; `rename()` would silently overwrite. On Windows the equivalent is
  `MoveFileExW` **without** `MOVEFILE_REPLACE_EXISTING`.
- **Compression is a container the backend owns.** The artifact is a concatenation of
  independent checksummed zstd frames; the first frame is the header, each later
  frame is one append batch, and `scanZstdFrames` walks the frame structure
  **without decompressing** — a metadata-only read costs no decompression.
- **A `SessionId` is an unvalidated branded string and MUST be path-encoded.**
  `encodeSegment` is injective over all UTF-16 strings, including lone surrogates.
- **The revision token is explicitly not authoritative.** *"Equal revisions may be
  treated as an unchanged log; unequal revisions promise nothing."*
- **The chain on a handle never rejects.** `this.chain = next.catch(() => {})` — one
  failed append does not poison every later one.
- **A read that goes backwards is an error, not a shorter answer.** A log that shrank
  below a previously observed prefix throws.
- **An unknown event is *opaque*, not *discarded* — but only when it says so.**
  `ignorable: true` means "keep my payload verbatim"; an unknown *required* type is
  refused. **Ignorable is a reader permission, not a transform permission.**
- **Tool-call pairing by `callId` is the ledger discipline.** Unmatched results at a
  turn boundary are **dropped** rather than accumulated — *"results always land within
  their turn, so drop the leftovers instead of growing persisted state forever."*

---

## 6. Staying simple — the rules the repo writes down

`docs/defensive-patterns/README.md` states five habits, each a requirement the repo
enforces in review, and each stated as *the rule and the defect it prevents*:

1. **Make correctness explicit** — write it into the structure (named call points,
   explicit lifecycles, explicit conditions and types) rather than compensating for
   it afterwards with timing.
2. **Keep one source of truth** — one read path for a piece of data, one home for a
   fact, one owner for shared state.
3. **Extend through the registered seam** — a new capability registers; an existing
   carrier stops taking new logic instead of growing a branch inside it.
4. **Keep the change face equal to the review face** — a change carries only the lines
   its stated behaviour change needs; a migration moves code rather than rewriting it.
5. **Require evidence** — a claim is falsifiable and recomputable, measured before
   and after or checked by a gate, rather than kept in sync by hand.

The repo also *demonstrates* the deletion discipline: the debate-style subsystems
and the 2D floor were removed outright rather than deprecated, and the legacy global
API was **quarantined behind a second, explicitly temporary entrypoint** rather than
deleted on day one.

---

## 7. Weak spots in this reference

The repo is a reference, not a saint. The shard reports carry the detail; the
recurring themes are:

- **The frozen-format machinery is bought with volume.** `payload-validation.ts` is
  51 KB on its own, and `relationships.ts` (23 KB) is *"the one place that knows what
  a well-formed session is, as opposed to what a well-formed event is."*
- **A strict, frozen format is a migration burden.** Every generation must keep its
  validator, its disposition table and its costume forever; a repository that deletes
  a format must keep the chain gap-free.
- **The event vocabulary is wide.** 60+ event types in the disposition table, and the
  live prompt still has to be assembled from projections of them.

---

## 8. Coverage

The authoritative numbers are **generated, not written by hand**:

- **`docs/research/deepseek-harness/COVERAGE.md`** - the per-shard table
  (files / read / skipped-with-a-reason / pending / missing-from-ledger).
- **`docs/research/deepseek-harness/coverage.tsv`** - the same, as TSV.
- **`docs/research/deepseek-harness/manifest.tsv`** - the full ledger: every tracked
  file, its size, its type, its owning shard, its status and its reason.

Regenerate with `node %TEMP%\harness-research\merge-status.mjs` (merges the shard
ledgers into the manifest and diffs it against `git ls-files`), then
`node %TEMP%\harness-research\gen-coverage.mjs` (rebuilds `COVERAGE.md`).

**Totals for the repo:** 16,297 tracked files across 47 shards. The manifest
accounts for every tracked file - no file is missing from the ledger and no ledger
row names a file that is not tracked. `dsh-generated` (1,839 files: committed test
snapshots, in-tree vendor code, prebuilt native artefacts) is a deliberate `skipped`
tier with a one-line reason per file: it is machine output, not hand-authored source.

**Lead spot-checks.** The lead re-opened the source and confirmed the claims in
`dsh-core` and `dsh-session-query-context` rather than trusting the shard author:
6 of 7 claims verified exactly, 1 verified true with a line-number drift
(`max-tokens` stickiness is at `packages/core/agent-loop/src/agent.ts:338-341`, not
`:262-267` as cited). No claim was found false.