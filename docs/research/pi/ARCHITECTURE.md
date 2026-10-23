# pi — architecture

**A synthesis of the shard reports in `shards/`, plus the coverage ledger.**

`earendil-works/pi` is a TypeScript monorepo (npm workspaces, 10 `packages/*`,
1,987 tracked files, 24 MB). It is the **smallest and sharpest** of the three
references, and the most opinionated about a single thing: **a tool's schema, its
name and its description are not statically knowable**, so they are obtained by
*running* the tool.

---

## 1. The packages

| Package | What it owns |
| --- | --- |
| `packages/ai` (402 files) | The provider layer: 42 providers, model catalogues, cost, the thinking ladder, OAuth, telemetry, the transcript format, the overflow and retry classifiers. |
| `packages/coding-agent` (809) | The product: the interactive mode, the TUI wiring, extensions, MCP, code mode, the session manager, the resource loader, the settings. |
| `packages/durable` (219) | The durable harness: a commit-before-show session, a task scheduler, child tasks, a task graph, compaction, code mode. |
| `packages/agent` (20) | The agent loop itself — 959 lines, one file, and the cleanest turn lifecycle of the three references. |
| `packages/chord` (109) | A document/state model with a delta tracker — the substrate `durable` stores its state in. |
| `packages/tui` (125) | A terminal UI kit. |
| `packages/codemode` / `packages/mcp` / `packages/env` / `packages/telemetry` / `packages/evals` | The seams that keep a new capability from growing a branch inside another. |

---

## 2. The agent loop

`packages/agent/src/agent-loop.ts` is the piece worth studying. It is a **single
outer loop over a single inner loop**, with three host-provided seams and one
decision point.

```
outer: while (true)
  inner: while (hasMoreToolCalls || pendingMessages.length > 0)
    prepareNextTurn?      -> may replace the context, the model and the thinking level
    getSteeringMessages?  -> pick up what the user typed while we were working
    prepareRequest?       -> same, per request
    streamAssistantResponse
    if stopReason is "error" or "aborted":  finishTurn, turn_end, agent_end, RETURN
    executeToolCalls
    finishTurn?           -> { action: "end" | "continue" }
```

The decisions a rebuild would not guess:

- **The prompt is not a parameter; it is part of the transcript.**
  `packages/ai/src/types.ts:544-570` and `packages/ai/src/utils/transcript.ts:73-120`:
  the system prompt and the tool list live *in the transcript*, so a later system
  message patches a named **section** or adds/removes a tool, and each provider
  either replays in place or collapses to one leading message.
- **Three seams, not a god object.** `prepareNextTurn` (`:195`) is where compaction
  lives — the loop does not know about it. `prepareRequest` (`:228`) is the
  per-request preparation. `finishTurn` returns `{ action: "end" | "continue" }`
  (`:295-303`), so the **host** decides whether the loop continues.
- **Steering is picked up during a long preparation.** *"Preparation can be
  long-running (for example, compaction). Pick up steering queued while it ran"*
  (`:210-215`) — and only poll again if the earlier poll returned nothing, *"so
  one-at-a-time mode would deliver two messages in this turn."*
- **`error` and `aborted` are different stop reasons** (`:254`), and both close the
  turn cleanly with a `finishTurn` and a `turn_end`.
- **A truncated message fails its whole tool-call batch.** *"A 'length' stop means
  the output was cut off by the token limit, so every tool call in the message may
  carry truncated arguments. Fail them all instead of executing potentially borked
  calls"* (`:273-279`).
- **Tool failures never reject.** *"Never rejects for tool failures: unknown tools,
  validation errors, blocked calls, and thrown errors come back as `isError: true`"*
  (`:818-819`).

---

## 3. The provider layer — where pi's real lessons are

`packages/ai` is 402 files and mostly about things that are quietly hard.

### Capability flags, not code branches

`packages/ai/src/providers/compat-schema.ts:188-538` holds **24 named boolean
flags** in that window — 31 in the whole file (`grep -c "Type\.Boolean"` at `58c0b02`, measured 2026-10-23;
an earlier version of this document said ~90, which is roughly the file's property count, not its
flags) — in a TypeBox schema, each with a documented default and an auto-detected
fallback. Every provider quirk becomes *data*. The merge refuses to drift: a
duplicated property across API schemas requires an **explicit** override, and an
override that resolves nothing is an error (`:591-617`).

The honest caveat, from the shard report: the schemas all set
`additionalProperties: true` at seven sites (`:348, 413, 500, 510, 521, 537, 639`), so **a typo in a flag
name is accepted silently**. The mitigation covers duplicates, not typos.

### One canonical place for the three questions

`packages/ai/src/utils/overflow.ts`, `retry.ts` and `error-body.ts` decide, in that
order, *"was this a context overflow?"*, *"was this worth retrying?"* and *"what does
this error cost me?"*. Two rules from `overflow.ts` are worth copying whole:

- **The overflow detector must be checked BEFORE the retry detector — and that
  ordering lives in the CALLER, not in `overflow.ts`.** The rule is real: a Bedrock
  throttle reads *"Too many tokens"* and would match the generic overflow pattern
  without `NON_OVERFLOW_PATTERNS` (`packages/ai/src/utils/overflow.ts:76-84`, the
  exclusion list at `:80-84`). But the check-before-retry itself is enforced where the
  two are called: `packages/coding-agent/src/core/agent-session.ts:3769-3772`
  (`if (isContextOverflow(…)) return false;` — *"Context overflow errors are NOT
  retryable (handled by compaction instead)"*) and `packages/durable/src/harness/generation.ts:542`.
  An earlier version of this document attributed the ordering to `overflow.ts:80-84`,
  which is only the exclusion list.
- **A 413 that IS the response status counts as a context overflow — and a 413
  merely mentioned in a body does not** (`packages/ai/src/utils/overflow.ts:64-66`:
  `/^(?:[\w -]+ API error \(413\):|413(?:\s|:|$))/i`, whose own comment says *"Match raw
  SDK errors and formatProviderError's prefix, not a status mentioned in the body"*).
  `packages/ai/test/overflow.test.ts:48-56` asserts the negatives — a body-only `413`,
  a non-leading one, and `4130` are all NOT overflow. The bodyless form is Cerebras-only
  (`overflow.ts:69`, `:151`). An earlier version of this document said "any HTTP 413,
  regardless of body", which is the opposite of the tested rule.

`packages/ai/src/utils/retry.ts:43` matches a status code with a negative lookbehind
— `(?<![a-z0-9])(?:429|500|…)(?![a-z0-9])` — because **a status code inside a
request id is not a status code**.

### Two-layer retry

`packages/ai/src/utils/provider-retry.ts:99-128` (an interruptible transport retry)
and `packages/ai/src/utils/retry.ts:7-31, 205-255` (a message-level retry with an
explicit non-retryable list). The reason pi re-implements the SDK's backoff: **the
SDK's own backoff ignores the abort signal**, so pi's sleep is abortable.

### "A stream that returns is not the same as a stream that succeeded"

`packages/ai/src/types.ts:389-397` states the contract in the type: *"Direct
`streamSimple()` calls may throw synchronously when request auth is missing. Once a
stream is returned, request/model/runtime failures should be encoded in that
stream."*

### The thinking ladder

`packages/ai/src/models.ts:1258-1290` — a map, a support list, and a clamp that
**walks up before down**: asking for `xhigh` on a model that stops at `high` gives
`high`; asking for `minimal` on a model that starts at `low` gives `low` (`:1271-1290`).
`null` in the map means "unsupported".

### A generated, validated catalogue

`packages/ai/src/providers/data/*.json` — one JSON file per provider — plus
`packages/ai/scripts/model-data.ts:214-301`, which validates the catalogue against a
**manifest** carrying a schema version, a structure hash and a per-file SHA-256, and
a build gate that refuses stale data. Publication is atomic:
`packages/ai/scripts/hydrate-model-catalog.ts:66-80` stages in a `mkdtemp`, validates,
then renames. The manifest stamp is a **fixed epoch** for hydrated catalogues so
identical input produces identical bytes (`:63-65`).

This is the "no heavy database" answer to *a queryable structured record*:
**file-per-record JSON + a manifest + a validator**.

---

## 4. The durable harness

`packages/durable` (219 files) is the most transferable thing in the repo for a
trading app, because it answers the question August Trading's automations have to
answer: *how do you run scheduled, unattended work that survives a crash?*

> **"A durable agent harness. Conversations, model turns, tool calls, and your own
> state are committed to storage before anything is shown. If the process dies
> mid-turn, reopening the storage picks the work up where it stopped."**

### Sleeping is a committed state

A task waits for time by ending its phase asleep. The sleep is **stored**, so the
task holds no invocation meanwhile, survives restarts, and resumes at the checkpoint
once the harness clock reaches `until`:

```ts
{ status: "sleeping", until, checkpoint }
```

*"There is no sleep in the middle of a phase: a phase reruns from its top after a
restart, so work after the wait goes in the next phase, and what it needs goes in the
checkpoint."*

### The crash-loop limit

> *"Work that deterministically crashes its process, by exhausting memory or CPU
> before its next checkpoint, would otherwise be resumed and crash again forever.
> Open counts each task a crash, eviction, or reset cut off; a close is not counted,
> and a new state the task commits starts the count over. Once the count reaches
> `settings.restartLimit` (default 5; `Infinity` never parks), the task is parked:
> `inspect()` and the task graph show it as blocked with reason `restart_limit`,
> `wake()` does not count it as active, and `onReport` gets it once as
> `task_parked`."*

And the sentence that generalises it: **"A host can feed `task_faulted` reports of
one kind to its own breaker."**

### Idempotency by request id

> *"A retried submission with the same `requestId` returns the existing submission
> instead of submitting twice."*

After a restart, the same request id finds the same submission.

### Queued inputs after a failed run

`settings.afterFailedRun` chooses: `continue` starts the next run with them, as
after an answer; `withdraw` settles them `unanswered` with reason `run_failed`.

### Abandoned work

`abandonOnRestart: true` — a task its creator awaits only in memory, and never
resumes after a restart, is **aborted with `abortReason: "restart"`**, together with
everything it owns, before any of it runs again.

### Child tasks and the task graph

A task can own child tasks and wait for them by committing a `waiting` state, with
an `on` list and a `policy` (`allSettled` | `failFast`). A task that finishes while
work it owns is still running is `completing` — its outcome is decided, but it
becomes terminal only once that work is done. Aborting runs bottom-up: a task's own
abort handler starts only once the work it owns has been aborted, so **each task
undoes its own effects**.

`harness.taskGraph(context)` shows every live task as one state, for a task panel or
debugging: each node has its owner edge, its status, whether it is `background` or
abort-marked, and the conversations it owns. **After a restart, tasks that were
`running` show as `pending` until they run again.**

### Approval as a hook on the tool

```ts
hook(ToolTask, { beforeTool: (call) => (isDangerous(call) ? { block: "Needs approval" } : undefined) })
```

Approval is not a mode the agent runs in; it is a **hook on the tool**.

### Prompt-cache discipline

> *"The system prompt is built from the selected extensions' sections, rendered in
> order before each request… Sections and tool changes are stored as positional
> system entries in the transcript. Only what changed is sent again, which keeps
> provider prompt caches warm. A section that returns something different every
> time, such as the current time, defeats that."*

---

## 5. Staying simple

`packages/ai/src/index.ts:4-8` says the core entrypoint is *"side-effect free: no
generated catalogs, no provider factories, no api-registry, no OAuth implementations,
no compat"*, and `packages/ai/src/compat.ts:10-11` says the whole legacy global API
is *"deleted with the coding-agent ModelManager migration"*. **Two entrypoints, one of
which is explicitly temporary.** The `createProvider` factory
(`packages/ai/src/models.ts:1077-1218`) is what makes 42 providers cheap: each new
provider is about fifteen lines.

---

## 6. Weak spots in this reference

From the shard reports:

- **Two global mutable registries with different shapes and no owners**
  (`packages/ai/src/compat.ts:102`, `packages/ai/src/images-api-registry.ts:24`), plus
  a third, `sessionResourceCleanups`. Two `Models` collections in one process share
  the api registry, and `resetApiProviders()` clears state another collection may
  depend on. *"The `Models` design is explicitly per-collection; the compat layer is
  explicitly global. The seam is where the bugs live."*
- **`models.ts` is 1,299 lines and holds six unrelated concerns** — the `Provider`
  interface, the `Models` collection, the `createProvider` factory, cost calculation,
  the thinking-level ladder and equality helpers.
- **The `Provider` interface has seven optional members**, each with a "never
  rejects" or "must not throw" contract stated only in prose
  (`packages/ai/src/models.ts:174-246`). A provider that violates one fails silently.
- **The overflow table will rot.** ~25 provider-specific regexes with a hand-maintained
  exclusion list (`packages/ai/src/utils/overflow.ts:38-84`). The rot risk is the
  hand-listed sample texts: `packages/ai/test/overflow.test.ts:35-56` asserts a fixed set
  of strings per provider, and the only test that produces a REAL provider response is
  API-key-gated — `packages/ai/test/context-overflow.test.ts:96`
  (`describe.skipIf(!process.env.ANTHROPIC_API_KEY)`), so CI never runs it. "No test" was
  the wrong word; "no test that runs without a key" is the true one.
- **`compat` holds 31 boolean flags** (24 of them inside the cited `188-538`), and
  seven schema sites allow additional properties, so a typo is invisible. The number was
  earlier written as ~90 here — that figure counted properties, not flags.

---

## 7. Coverage — the gate PASSES

**1,987 tracked files. 1,987 ledger rows. 0 pending, 0 missing, 0 skipped without a
reason, 12 of 12 shards complete. GATE PASS.**

| | Files | Share |
| --- | ---: | ---: |
| **Read** | 1,811 | 91.1 % |
| **Skipped, with a reason** | 176 | 8.9 % |
| Pending / missing / unexplained | **0** | 0 % |

By type: `source` 615 read / 150 skipped · `tests` 826 read / 2 skipped ·
`docs` 90 / 2 · `examples` 138 / 0 · `build-CI` 97 / 0 · `config` 45 / 2 ·
`assets` 0 / 12 · `generated-vendored` 0 / 8.

**What the 176 skipped files are.** Every one carries a one-line reason:

- **147 source files catalogued rather than read line by line** — the note says so
  explicitly: *"bulk tier: catalogued via head + export-signature scan, not read
  line by line."* These are the vendored `highlight.min.js` / `marked.min.js`
  bundles, the 1,076-line export stylesheet, and the large type-only modules.
- **8 generated artefacts** — the npm lockfile, the four PNG screenshot assets.
- **A handful of generated and vendored files** confirmed by name and byte size.

**The authoritative numbers are generated, not written by hand:**

- **`docs/research/pi/COVERAGE.md`** — the per-shard table
  (files / read / skipped-with-a-reason / pending / missing-from-ledger).
- **`docs/research/pi/coverage.tsv`** — the same, as TSV.
- **`docs/research/pi/manifest.tsv`** — the full ledger: every tracked file, its
  size, its type, its owning shard, its status and its reason.

Regenerate with `node %TEMP%\harness-research\merge-status.mjs` (merges the shard
ledgers into the manifest and diffs it against `git ls-files`), then
`node %TEMP%\harness-research\gen-coverage.mjs` (rebuilds `COVERAGE.md`).

**Lead spot-checks.** The lead re-opened the source and confirmed the claims rather
than trusting the shard authors. `pi-ai`: the `StreamFunction` contract at
`packages/ai/src/types.ts:389-397`, the `NON_OVERFLOW_PATTERNS` exclusion list at
`packages/ai/src/utils/overflow.ts:76-84`, and the validator's "Received arguments"
echo at `packages/ai/src/utils/validation.ts:315-355` — **all three verified
exactly, at the cited lines**. `pi-durable`: the crash-loop breaker at
 `packages/durable/src/harness/scheduler.ts:1365-1367` — *"A task cut off
`restartLimit` times in a row"* is the doc comment at `:1365` and the `#parked`
predicate is `:1366-1367`; this citation used to begin at `:1364`, which is a blank
line — and the `settings.restartLimit` default is `src/harness/agent.ts:57`
(`export const DEFAULT_RESTART_LIMIT = 5;`), whose naming comment is `:56`.
**Verified, with two one-line corrections stated rather than quietly restated.**
**6 of 6 claims verified; none false** — *amended 2026-10-23: a later re-open found
four claims of this file's own that were misattributed or miscounted (the ~90-flag census,
the five-`additionalProperties` list, the overflow-before-retry attribution, and the
"any 413 regardless of body" rule); all four are corrected above, and the spot-check that
missed them was sampling the shard reports, not this synthesis.*