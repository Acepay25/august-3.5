# deepseek-harness :: dsh-session

**Files in shard:** 345 (read: 345, skipped: 0)
**What this shard covers:** the entire `packages/session/` group of the DeepSeek Harness monorepo: the durable session data plane. That is (a) the on-disk Session log format and its five adjacent format migrations (v0→v1→v2→v3→v4), (b) the JSONL persistence backend with its lease/publication machinery and zstd compression, (c) the semantic checkpoint policy that makes a model request and a tool side effect durable before they happen, (d) the projection/projection-cache/stats/turn-outline read models, (e) the title services (deterministic + LLM), (f) telemetry (capture + OTel delivery), (g) the DeepSeek log-upload integration, and (h) the working-directory packages. Roughly 40% of the bytes are tests; the implementation is a heavily-typed, heavily-frozen event-log system.

> Read tiers used: **Tier 1** (load-bearing source) — every `src/**` file and every English `README.md` read in full and given a full entry below. **Tier 2** (tests, configs, translations) — every file opened; the 113 test files were read either in full (17) or via their `describe`/`it` index (96), and the note in the status ledger records which. **Tier 3** (generated) — the 22 `README.i18n.yaml` files were opened and confirmed to be generated bilingual heading-hash records with no decision content. No file in this shard was skipped, and nothing in the reference repo was executed.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `packages/session/README.md`
- **Purpose:** the package map for the whole session group — the "read this first" page.
- **Key abstractions:** none (docs).
- **Data flow:** n/a.
- **Non-obvious design decisions:** the group is split into four families — **persistence** (seam + backends + checkpoint policy + format chain), **projection** (fold committed events into whole current values), **titles**, **telemetry** — and the README says explicitly: *"Start with the shipped JSONL storage, then add checkpointing and only the projections, title policy, or telemetry your deployment needs."* That is a deliberate minimalism stance, stated in the package map itself (README.md:16).
- **Edge cases & failure handling:** n/a.
- **Surprising:** the table's "ctx key" column (`ctx.sessionPersistence`, `ctx.sessionProjections`, `ctx.sessionTitle`, `ctx.sessionTelemetry`) shows the plugin/service DI surface — every package registers into a small number of well-known context keys, and libraries (format chain) register nowhere.

#### `packages/session/session-checkpoint-policy/README.md`
- **Purpose:** the durability contract for "a persisted agent that must not lose a model request or tool side effect on crash".
- **Key abstractions:** three barriers — model request, top-level tool dispatch, agent step boundary.
- **Data flow:** the plugin listens on `llm/stream`, `tools/execute`, `agent/pre-step` and calls `ctx.sessions.flush(session)` at each.
- **Non-obvious design decisions:** **fail-closed**. A checkpoint rejection means *the adapter or the tool body does not run at all* — not "run and log the error". This is stated in the README (`README.md:23`) and implemented as a rejected promise propagating out of the `llm/stream` wrapper (src/index.ts:73-79).
- **Edge cases & failure handling:** cancellation that lands *while the tool checkpoint flush is pending* returns the canonical `ABORTED_BEFORE_DISPATCH` result and never enters the tool body (src/index.ts:52-61). Interrupted tool calls recover with `TOOL_OUTCOME_UNKNOWN`, **not an automatic retry** — the README is explicit that a persisted call without a result cannot prove whether its external effect completed, so the model is told "Do not retry blindly" and must verify state or ask the user.
- **Surprising:** the model-visible repair result is appended *after* the reusable prefix so it does not invalidate KV-cache entries — the README has a dedicated "KV Cache effect" section, which is unusual care for a crash-recovery path.

#### `packages/session/session-checkpoint-policy/src/index.ts`
- **Purpose:** the entire policy — three listeners, no state of its own.
- **Key abstractions:** `apply(ctx)`, `name`, `inject = ['llm','sessionPersistence','sessions','tools']`; helper `afterCheckpoint()` and `abortedBeforeDispatchResult()`.
- **Data flow:** `ctx.on('llm/stream')` → if the request names a *live* session, wrap the downstream generator so `await ctx.sessions.flush(session)` happens **before** `next()` constructs the adapter stream. `ctx.on('tools/execute')` → flush only when `exec.agent !== undefined && exec.parent === undefined` (top-level only; nested dispatches reuse the outer call's checkpoint). `ctx.on('agent/pre-step')` → flush before the next request is derived.
- **Non-obvious design decisions:**
  - The flush is *inside* an async generator wrapper (`afterCheckpoint`, src/index.ts:27-35) rather than a separate `await` before calling `next()` — this makes the checkpoint part of the stream's lazy construction, so a consumer that never pulls the stream never forces a write.
  - The "live session" check (`ctx.sessions.get(options.sessionId)`) is what makes a *detached* session id a no-op instead of an error (src/index.ts:70-73).
  - After the flush, the abort signal is re-checked (`exec.signal.aborted`, src/index.ts:83) — the tool body is skipped if cancellation landed during the flush.
- **Edge cases & failure handling:** a failed checkpoint at the tool boundary is converted into an *error-shaped tool result* rather than a thrown exception (the tool runtime turns it into `isError: true` with the failure text) — so the model sees a failed tool, not a dead turn. At the request boundary the rejection propagates and the adapter is never constructed.
- **Surprising:** `import type {} from '@deepseek-ai/dsh-session-persistence'` — an empty type-only import, used purely to force the package's TS project reference so the service contract stays in the dependency graph.

#### `packages/session/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts`
- **Purpose:** pins the three barrier boundaries and the fail-closed semantics.
- **Key abstractions:** a `TestPersistence` whose `create`/`open` **reject** — proving the policy never opens a handle and only uses `ctx.sessions.flush`.
- **Data flow:** uses `Promise.withResolvers()` gates to hold a flush open and assert the *ordering* (`flush:start` → `flush:end` → `adapter`), which is the actual property that matters: the adapter must not be constructed until the write lands.
- **Non-obvious design decisions:** the nested-dispatch test asserts `flushes === 0` — nested tool calls deliberately do **not** re-checkpoint, because the outer call's checkpoint already covers them.
- **Edge cases & failure handling:** pins the exact shape of the aborted result (`{ content: [{type:'text', text:'Error: tool call aborted before dispatch'}], isError: true, error: { message, info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } } }`).
- **Surprising:** a lifecycle test asserts the plugin's *Loader-safe namespace shape* — no `default` export, `name`/`inject`/`apply` present — because the plugin is loaded by name from YAML, not imported.

#### `packages/session/session-checkpoint-policy/tests/crash-recovery.e2e.ts`
- **Purpose:** a real hard-crash test — spawns a child process, SIGKILLs it at a named failpoint, then reads the durable log back.
- **Key abstractions:** `crashAt(mode: 'request'|'tool')`; readiness is *marker content*, not path existence — the marker file is pre-created empty so the open-before-write window stays deterministic.
- **Data flow:** child writes `request-dispatched` or `tool-side-effect` to the marker; the parent waits for that exact content via `vi.waitFor`, SIGKILLs the child, then re-opens the JSONL backend read-only and balances the log with `interruptedTurnClosers(events)`.
- **Non-obvious design decisions:** the SIGKILL choreography is custom on purpose — "the child must die mid-write, so no timeout or graceful termination may reach it first". The suite is `describe.skipIf(process.platform === 'win32')` (Windows has no SIGKILL semantics that match).
- **Edge cases & failure handling:** asserts the recovered tail is `turn/end` with `reason: { kind: 'interrupted' }`, and that the repaired tool result carries `{ name: 'ToolOutcomeUnknownError', code: TOOL_OUTCOME_UNKNOWN }` with the text containing "Do not retry blindly."
- **Surprising:** the durable log after a crash contains `agent/inbox/spliced` twice — the first turn's inbox and the second — which the test pins exactly as an ordered list. Event *ordering* is the contract.

#### `packages/session/session-checkpoint-policy/tests/fixtures/crash-child.ts`
- **Purpose:** the crashing child process.
- **Key abstractions:** a `CrashAdapter` that writes the failpoint and then hangs forever (`waitForCrash()` = a promise that never resolves, kept alive by a 60 s interval).
- **Data flow:** mounts `AgentLoop` + JSONL persistence + the checkpoint policy, then `handle.agent.followup(createUserMessage(...))` and hangs.
- **Non-obvious design decisions:** the `crash_tool` **records an external effect and never returns** — the side effect happens, the result never does. That is the precise scenario the policy exists for.
- **Edge cases & failure handling:** the tool writes the marker *before* hanging, so the parent knows the side effect already occurred.
- **Surprising:** the tool's `execute` is `async execute() { await writeFile(failpoint, 'tool-side-effect'); return waitForCrash() }` — it never returns, so the tool result is only ever produced by recovery.

#### `packages/session/session-checkpoint-policy/package.json` / `locale/en.json` / `locale/zh.json` / `tsconfig.json`
- **Purpose:** package manifest, i18n title strings, TS project config.
- **What it pins:** version `0.2.1-rc.2`; peer deps on `cordis`, `dsh-agent`, `dsh-llm`, `dsh-session`, `dsh-session-persistence`, `dsh-tools`; the `locale/*.json` export. The `locale/zh.json` carries a *description* ("在模型请求和可能产生外部影响的工具操作前保存会话记录") while `en.json` carries only a title — a small asymmetry in the generated i18n.
- **Edge cases & failure handling:** n/a.
- **Surprising:** `tsconfig.json` uses project `references` to sibling packages rather than `paths` — the monorepo builds each package's `.d.ts` in isolation and consumes the referenced output.

#### `packages/session/session-format-catalog/README.md`
- **Purpose:** the deterministic "one reader for every shipped Session format" that does **not** depend on mounted plugins.
- **Key abstractions:** `sessionFormatCatalog` (static), `createSessionFormatCatalogWithChildren(childFacts)`, `historicalSessionFormatCatalog`.
- **Data flow:** `readHeader(physicalHeader)` → classification; `createRestore(header, {recovery, validation})` → `decodeRow(row)` per physical row → `finish()` → artifact; writers use `encodeCurrentHeader` / `encodeCurrentEvent`.
- **Non-obvious design decisions:**
  - **Two validation policies**: production historical reads use `{ recovery: 'recoverable', validation: 'transformed' }`; worker/fixture verification uses `{ recovery: 'strict', validation: 'current' }`. `transformed` runs the released-current rules after migration but **skips installed semantic validation** for input that is already current (README.md:41).
  - **The catalog is closed**: "A profile cannot add, remove, or reorder an edge by mounting a feature plugin." A missing historical edge is a build-time problem, not a runtime one.
  - **The static catalog cannot read historical *bodies*** — it needs explicit child evidence (`createSessionFormatCatalogWithChildren`). `sessionFormatCatalog.createRestore` on a v3 header throws `'explicit historical child facts'`.
- **Edge cases & failure handling:** "An ignorable V3 extension remains opaque even when the installed writer knows its name" — the *historical* catalog is deliberately ignorant of newer vocabulary so that child collection is not recursive.
- **Surprising:** the catalog is **build-static** (`src/generated.ts` is marked `GENERATED by scripts/gen-session-format-catalog.ts — do not edit by hand`). The static-ness is the point: first-party formats are a build-time inventory, not a plugin registry.

#### `packages/session/session-format-catalog/src/index.ts`
- **Purpose:** the package's public surface.
- **Key abstractions:** re-exports `sessionFormatCatalog`, `createSessionFormatCatalogWithChildren`, `historicalSessionFormatCatalog`, and `SessionFormatUnsupportedMigrationError` (re-exported from `dsh-session-format`).
- **Data flow:** n/a (barrel).
- **Non-obvious design decisions:** the *error class* is part of the public surface — callers distinguish "this format cannot be migrated" from "this row is corrupt".
- **Edge cases & failure handling:** n/a.
- **Surprising:** the barrel does **not** export `currentSessionMessageProjections` — that lives behind a separate browser-safe `./message-projections` export (package.json:20-24).

#### `packages/session/session-format-catalog/src/generated.ts`
- **Purpose:** the static owner of codec and edge ordering.
- **Key abstractions:** `sessionFormatCatalogOptions` (the `SessionFormatCatalogOptions` object) and `sessionFormatCatalog`.
- **Data flow:** imports the *released* codecs and migrations **directly** ("The direct imports make historical readability independent of mounted plugins") and composes them into `createSessionFormatCatalog(...)`.
- **Non-obvious design decisions:** `currentVersion: 4` with codecs `[v0,v1,v2,v3,v4]` and migrations `[v0→v1, v1→v2, v2→v3, v3→v4]` — the gap-free chain is asserted by `createSessionFormatCatalog` at module init ("rejects duplicate codecs, duplicate edges, gaps, and entries beyond the current version before any Session read can begin").
- **Edge cases & failure handling:** `restoreCurrent` calls `restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES)` then `validateInstalledCurrentSessionArtifact(restored)`; `restoreTransformedCurrent` **omits** the installed validation (that is the "transformed" policy).
- **Surprising:** the *installed* `KNOWN_SESSION_EVENT_TYPES` is passed in to the *released* v4 restorer — the frozen format layer is vocabulary-aware without being coupled to the installed package's version.

#### `packages/session/session-format-catalog/src/children.ts`
- **Purpose:** binds parent-specific child evidence into the static inventory.
- **Key abstractions:** `createSessionFormatCatalogWithChildren(children)`.
- **Data flow:** creates a *fresh* V3→V4 migration via `createSessionFormatV3ToV4(children)` and swaps it into the edge list by identity comparison (`edge === sessionFormatV3ToV4`).
- **Non-obvious design decisions:** the child facts are "retained unchanged for the catalog's lifetime" — the catalog does not copy or re-derive them, and the doc comment insists "Keep the supplied evidence unchanged for the catalog's lifetime."
- **Edge cases & failure handling:** an empty array *declares* no children (a legitimate, explicit statement) — the difference between "no children" and "unknown children" is exactly the distinction that makes the V3→V4 edge refuse to guess.
- **Surprising:** each `createSessionFormatCatalogWithChildren` call constructs a **new** catalog (the children test proves restores from two different catalogs with different children do not interfere — "isolates interleaved restores and child evidence across parent catalogs").

#### `packages/session/session-format-catalog/src/current.ts`
- **Purpose:** delegates *current* validation to the installed `dsh-session` package.
- **Key abstractions:** `validateInstalledCurrentSessionHeader`, `validateInstalledCurrentSessionArtifact`.
- **Data flow:** both call `Session.fromRestore(SessionId(...), events, header, SessionLogOffset(...), 'detached')` — i.e. the installed Session reconstructs and validates itself, with the artifact's `inheritedEventCount` used as the log offset.
- **Non-obvious design decisions:** a version-skew check happens **before** the installed validation, with a bespoke message (`installed Session format is v4, got v0`) — the installed package would otherwise produce a confusing error.
- **Edge cases & failure handling:** the header path validates an *empty* event list; the artifact path passes `currentSessionMessageProjections` so image-offload references are checked.
- **Surprising:** the `'detached'` mode argument — the installed Session is being used as a *validator*, not as a live session, and the mode distinguishes that.

#### `packages/session/session-format-catalog/src/historical.ts`
- **Purpose:** a V0–V3 catalog used to collect child prerequisites without recursively completing catalogs.
- **Key abstractions:** `historicalSessionFormatCatalog` (`currentVersion: 3`).
- **Data flow:** restores V0–V3 using the *fixed released-V3 event vocabulary* (`RELEASED_V3_EVENT_TYPES`), not the installed vocabulary.
- **Non-obvious design decisions:** this exists to break a circularity: to know a V3 parent's children you must read the V3 body, but reading a V3 body "now" requires knowing the children. The historical catalog resolves it by using the frozen V3 vocabulary and stopping at V3.
- **Edge cases & failure handling:** an ignorable event whose name became known later (`developer/message`) is **opaque** in the historical catalog but is renamed to `plugin:developer/message` in the current catalog — the difference is pinned in `developer-history.spec.ts`.
- **Surprising:** the historical catalog has **no** installed-current validation at all — by design.

#### `packages/session/session-format-catalog/src/message-projections.ts`
- **Purpose:** the browser-safe set of current message interpreters.
- **Key abstractions:** `currentSessionMessageProjections = [imageOffloadProjection]`.
- **Data flow:** pure definitions; the recovery *listeners* are mounted separately by their owning plugins.
- **Non-obvious design decisions:** the split — "installed interpretation definitions" vs "recovery listeners mounted separately" — is what lets a browser reader interpret an image offload without mounting a Node-only plugin.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the catalog test asserts `currentSessionMessageProjections.map(p => p.type).sort()` equals `MESSAGE_PROJECTION_EVENT_TYPES` exactly — a **closed-set assertion**: a new projection type must be registered here or the test fails.

#### `packages/session/session-format-catalog/package.json` / `tsconfig.json` / `tsdown.config.ts`
- **Purpose:** manifest, project references, build config.
- **What it pins:** the `./message-projections` subpath export exists *only* to make the browser-safe entry reachable; `dependencies` include the four migration packages and `dsh-compaction-image-offload`; `tsdown.config.ts` builds `lib/types/index.js` → `lib`, ESM, node platform, `es2024`, `dts: false` (types are produced by `tsc`, not by the bundler).

#### `packages/session/session-format-catalog/tests/catalog.spec.ts`
- **Purpose:** the big behavioural spec for the whole chain.
- **Key abstractions:** a local `deepFreeze` helper used to prove migrations do **not mutate their input**.
- **Data flow:** for every migration test it snapshots `JSON.stringify({header, rows})` before and asserts it is byte-identical after — immutability of migration input is a first-class property.
- **Non-obvious design decisions:**
  - The catalog "restores the installed current vocabulary **without freezing ordinary payload additions**": a v4 `turn/start` carrying `postReleaseMember: true` is accepted, but an unknown *event type* is rejected, and an unknown event marked `ignorable: true` is accepted. The distinction is *event-type vocabulary* vs *payload member* — payload evolution is allowed, type evolution is not (unless ignorable).
  - "refuses unclassified ignorable v2 events" — an ignorable row whose *type* is not in the released V2 inventory is refused with "cannot safely transform unclassified event" because the migration cannot know how to transform it. Ignorable is a *reader* permission, not a *transform* permission.
  - A V3 delivery marker in a V2 file is refused: "format v2 delivery marker claims target format v3" — delivery markers are version-scoped.
- **Edge cases & failure handling:** the PTC (plugin tool-call) migration test pins the whole rename cascade: `tool/code-dispatch-start` → `tool/ptc-dispatch-start`, message source `plugin:tools-code-mode` → `ptc-mode`, message ids `tools-code-mode:message` → `tools-ptc:message`, plus the *insertion* of a `system/message` at seq 2 and the renumbering of every later `seq`, and the conversion of `surfaceOp` from `{op,start,end}` to `{op,startSeq,endSeq}`. Then it re-encodes and re-opens the result and asserts a perfect round trip.
- **Surprising:** the round-trip test is the real contract — migrate → encode → decode → migrate-again-free restore must be **exactly** equal to the migrated artifact.

#### `packages/session/session-format-catalog/tests/children.spec.ts`
- **Purpose:** pins child-evidence binding and restore isolation.
- **What it pins:** the static `sessionFormatCatalog` **throws** `'explicit historical child facts'` when asked for a V3 body; `createSessionFormatCatalogWithChildren([])` returns an empty event list; a V4 header still reads natively; two catalogs with different children produce different `subagent/catalog` events and do not contaminate each other; a repeated restore from the same catalog is deterministic.
- **Surprising:** the child is materialized as a `subagent/catalog` event appended to the restored log — the child evidence becomes part of the session's own history.

#### `packages/session/session-format-catalog/tests/current.spec.ts`
- **Purpose:** pins the installed-current validation contract.
- **What it pins:** version skew is reported before anything else; `request/header.reason` accepts only current reasons (a `fallback` reason is refused); `startsSeries` must be `true` when present.
- **Surprising:** `request/header` carries a `reason` vocabulary *and* a `startsSeries` boolean — the latter distinguishes the first request of a series from a mid-series re-header.

#### `packages/session/session-format-catalog/tests/developer-history.spec.ts`
- **Purpose:** proves the tool-definition history (initial + incremental) survives restore and fork.
- **Key abstractions:** `toolStates(session)` — reconstructs the *active* tool set by replaying `developer/message` tool-addition / tool-removal blocks against the referenced `request/header`.
- **Data flow:** a `tool-addition` block names only the tool (`ToolAdditionBlock` is `{ type: 'tool-addition'; toolName: string; tool?: never }` — pinned by a `expectTypeOf` assertion), and the *definition* is looked up from the `headerSeq` it references. A fork cuts the history at a boundary and the reconstructed states are the prefix (`expected.slice(0, 4)`).
- **Non-obvious design decisions:** the test **mutates the producer-side `ToolSchema` objects** after appending (`initial.description = 'mutated initial definition'`, `first.parameters['properties'] = {}`) and then asserts the restored state is *unchanged*. This proves the session log stores a **copy** (or a deep snapshot) of the tool definition — a subtle correctness property that would be easy to get wrong.
- **Edge cases & failure handling:** a `tool-removal` removes the tool from the active set (`undefined` in the states array).
- **Surprising:** the tool history is *replayed from the surface nodes* (`session.surface.nodes`), not from a linear event scan — the surface is a separate index from the event log.

#### `packages/session/session-format-catalog/tests/preset-migration.spec.ts`
- **Purpose:** pins preset migration for seeded V0–V2 sessions.
- **What it pins:** the preset `code` is renamed to `ptc` in V0–V2 sources (the "code mode" → "PTC mode" rename), every `agent-preset/selected` row is migrated, the `session/end-seed` marker is preserved, and seqs are re-densified.
- **Surprising:** the V2 case needs a **synthetic** `session/end-seed` row inserted into the source to model a seeded session, and the V0/V1 case instead uses `seedLength: 2` in the header — two different physical encodings of the same logical fact, both handled.

#### `packages/session/session-format-v0-to-v1/README.md`
- **Purpose:** the frozen v0→v1 contract.
- **Key abstractions:** `releasedV0SessionFormatCodec`, `sessionFormatV0ToV1` (a *stage*), `releasedV1SessionFormatCodec`.
- **Data flow:** codec decodes physical rows one at a time and emits either a scalar event (`emitEvent`) or a **codec-owned compact run** (`emitRun`) — so migration never has to hold the whole physical row array in memory.
- **Non-obvious design decisions:**
  - The alpha edge **refuses every event type outside its frozen inventory, including one marked `ignorable: true`**. A later edge (v1→v2) relaxes that.
  - **Owner-opaque JSON**: "Unknown content-block `type`, message-source `kind`, assistant finish-reason `kind`, and `turn/end` reason `kind` arms remain owner-opaque JSON while their known arms receive structural validation." This is the open-vocabulary rule: known arms validated, unknown arms preserved losslessly.
  - **Recoverable decoding semantics**: "Recoverable decoding drops a complete faulty row and keeps the preceding prefix unless a later decoded `turn/end` proves that the faulty region was committed." So a gap is tolerated *until* a turn-end proves the region mattered, at which point the error is re-thrown.
  - The bounded normalizers: `steering/message`→`user/message`, `compact/*`→`compaction/*`, drop `turn/start.trigger`, convert retired `turn/end` reasons, add wrappers + deterministic ids for legacy messages / retry chains / compaction groups, drop the obsolete `request/header.header.messagePrefix`.
- **Edge cases & failure handling:** retired `request/header-delta`, `mode/set`, and the `request/header` `fallback` reason **refuse migration** outright (not repaired).
- **Surprising:** the sentence "No other event, reference, source, or payload fact may change." — a closed-world guarantee for a migration.

#### `packages/session/session-format-v0-to-v1/src/codec.ts`
- **Purpose:** the frozen physical JSON codec for v0 and v1.
- **Key abstractions:** `releasedV0SessionFormatCodec`, `releasedV1SessionFormatCodec` (both from one `createReleasedCodec(version)` factory); `ReleasedAssistantChunkRun` + `isReleasedAssistantChunkRun`; the internal `scanRows(recoverable)` row scanner.
- **Data flow:** `decodeHeader(value)` → physical header + `inheritedEventCount` (= `seedLength`); `createDecoder(header, recovery)` → `decodeRow(rowValue, context)` per row → `finish(context)`. Rows arrive as JSON objects; the scanner validates each row atomically and calls `context.emitEvent` / `context.emitRun`.
- **Non-obvious design decisions:**
  - **Packed Assistant rows are a first-class physical format**: `text-chunks`, `reasoning-chunks`, `tool-call-chunks` carry `seq0`, `time0`, and a `data` object with `dt` (a *time-delta array*). A packed row of N chunks is ONE physical row representing N logical events; the codec expands it lazily via a generator (`expandAssistantChunkRun`, codec.ts:246-274) only when the v1→v2 edge needs to embed the stream.
  - The `dt` array length must be exactly `payload.length - 1` — a delta encoding with no absolute timestamps, and the check is structural.
  - **Recoverable mode is a prefix-plus-commit rule**: `issue ??= current` records the *first* error; subsequent rows are dropped; but if a later decoded `turn/end` arrives, the recorded issue is **re-thrown** — because a turn-end proves the dropped region was supposed to be committed (codec.ts:102-110). Packed rows never trigger the re-throw.
  - `seq` must be **dense**: `seq !== eventCount` is a gap error (codec.ts:113-121). A packed run contributes its whole `eventCount`.
  - `sourceEventSeqs` is stored as a **range-encoded** array (`[start, end]` pairs) and expanded to a dense list at decode time, with the constraint that ranges must be strictly increasing and must not exceed the event's own seq.
- **Edge cases & failure handling:** `finish()` throws if `inheritedEventCount > eventCount`; the header requires `type === 'session'`, exact `version`, absolute `cwd` (checked later in validation), `origin` must be `"subagent"` if present.
- **Surprising:** `isSeeded` is derived from the *presence* of `seedLength` in the physical header (`record['seedLength'] !== undefined`), i.e. presence-as-flag — a boolean that the physical format does not store.

#### `packages/session/session-format-v0-to-v1/src/dispositions.ts`
- **Purpose:** the frozen per-event-type payload-member inventory.
- **Key abstractions:** `ReleasedV0PayloadDisposition { required, optional, opaque }` and `defineReleasedPayloadDisposition(...)`; `RELEASED_V0_EVENT_DISPOSITIONS`; `RELEASED_V0_EVENT_TYPES`.
- **Data flow:** each event type declares which members must exist, which are optional, and which are **opaque** (intentionally owner-opaque nested JSON).
- **Non-obvious design decisions:** the three-way split (required / optional / opaque) is what makes "exact member checking" compatible with open-ended nested payloads. E.g. `tool/result` = required `['turn','step','message']`, optional `['error','meta']`, opaque `['meta']` — `meta` may be present but is never semantically inspected. `tool/code-dispatch` marks `arguments` opaque.
- **Edge cases & failure handling:** the dispositions cover 60+ event types including `approval/asked`, `approval/decided`, `approval/policy`, `llm/retry`, `llm/retry-started`, `goal/change`, `schedule/change`, `hook/invoked`, `hook/result`, `team/*`, `todo/write`, `tool-workflow/*`, `subagent/descriptor`, `session/title`, `session/title-llm-request`, `web/deepseek-search-llm-request`.
- **Surprising:** the frozen inventory *is* the platform's event catalog — the shape of a trading session's audit trail is fully enumerable here (approval asked/decided/policy, retry chains, goals, schedules, hooks, teams, todos).

#### `packages/session/session-format-v0-to-v1/src/migration.ts`
- **Purpose:** the identity edge v0→v1 plus the bounded legacy normalizers.
- **Key abstractions:** `sessionFormatV0ToV1` (a `defineSessionFormatMigration`), `ReleasedV0ToV1Stage` (implements `SessionFormatMigrationStage`), `LegacyNormalizationState { messageIds, retryIds, compactionId? }`.
- **Data flow:** `transformEvent` runs the event through a fixed pipeline — `normalizeLegacyCompactionType` → `assertSupportedLegacyType` → `normalizeLegacyTurnStart` → `normalizeLegacyTurnEnd` → `normalizeLegacyRequestHeader` → `normalizeLegacySteering` → `normalizeLegacyRetry` → `normalizeLegacyCompaction` → `normalizeLegacyMessage` → `assertReleasedEventPayload(message, 0)`. `transformRun` passes a packed Assistant run straight through (v1→v2 embeds it) and expands anything else.
- **Non-obvious design decisions:**
  - **The normalizer is a pipeline of small named functions, each returning the event unchanged when it does not apply** — a "chain of no-ops" that is easy to read and easy to extend.
  - **Deterministic legacy identities**: `legacyMessageId(sessionId, seq)` = `legacy-message:<session>:<seq>`, `legacy-compaction:<session>:<seq>`, `legacy-retry:<session>:<seq>`. These are *derived* ids, not random ones, so a migration is reproducible.
  - **Retry-chain id repair**: a `llm/retry` with a missing `retryId` is matched to an earlier retry with the same `(turn, step, provider, policyKey)` chain and inherits that id; only a genuinely new chain gets a synthetic id. The chain key is built from `JSON.stringify` of each part joined by `\0` (so it cannot collide with a value containing commas).
  - **`LEGACY_ASSISTANT_SOURCE_KEY = ['pro','venance'].join('')`** — the literal string `provenance` is assembled at runtime so that a naive grep for it in the source does not find it. A deliberate anti-migration-tripwire.
  - **Compaction group id propagation**: `compaction/start` establishes the id; `compaction/summary`/`compaction/end` inherit it; a `user/message` whose source is `{kind:'plugin', plugin:'compact'}` also inherits it; `session/end-seed` **clears** it (a new seed boundary starts a new compaction group).
  - **`tool/result` legacy repair** must resolve the *replaced* message's id: a `surfaceOp: {op:'replace', start}` means the tool result replaced an earlier message, and the new tool-result message inherits that message's id (looked up in `state.messageIds`). If the id cannot be resolved, it **throws** (`tool/result N replacement cites a message without identity`) rather than minting a new one.
  - `assertSourceDeliveryMarker` verifies that a `session-log-deepseek/delivery-accepted` event names the right session — but only for a *current-generation* (non-inherited) marker.
- **Edge cases & failure handling:** retired `turn/end` reasons are converted: `aborted` → `{kind:'aborted', reason:{kind:'legacy'}}`, `disposed` → `{kind:'aborted', reason:{kind:'disposed'}}`, `error` → `{kind:'error', error:{message, code}}` (with `code` defaulting to `'UNKNOWN'`). An `error` reason without a `failure` object and without a `message` is malformed → `malformedLegacy`.
- **Surprising:** `normalizeLegacyTurnStart` **removes** `turn/start.trigger` entirely — the trigger fact is dropped, not migrated, because the v1 event shape no longer has it.

#### `packages/session/session-format-v0-to-v1/src/validation.ts`
- **Purpose:** header, event-envelope, coordinate and payload validation for the released v0/v1 generations.
- **Key abstractions:** `assertReleasedSessionFormatHeader(header, version)`, `assertReleasedV1Header`, `restoreReleasedV1Artifact(artifact, knownEventTypes)`, `assertReleasedArtifactCoordinates(...)`, `assertReleasedSurfaceMetadata(...)`, `assertReleasedEventPayload(event, version)`.
- **Data flow:** `assertReleasedArtifactCoordinates` walks the artifact's events and, per event, resolves a disposition, decides whether the type is known/legacy/ignorable, checks the envelope's key set, checks that `seq === index` (dense), checks `time` is a safe integer, checks `ignorable` is `true` when present, and (when frozen) checks surface metadata.
- **Non-obvious design decisions:**
  - **The vocabulary-neutral flag** (`vocabularyNeutral`): when true, unknown types are allowed (physical decode only). When false, an unknown *required* type is an `SessionFormatUnsupportedMigrationError`; an unknown *ignorable* type is allowed **only** in the v1+ policy — v0 refuses unknown ignorable events outright ("migration refuses unknown historical events even when ignorable").
  - **The frozen-envelope key set differs by surface vs log**: a surface event (`user/message`, `assistant/message`, `tool/result`) may carry `ignorable`, `sourceEventSeqs`, `surfaceOp`; a plain log event may carry only `ignorable`. Unfrozen envelopes allow the full surface set everywhere.
  - `cwd` must be an **absolute** path.
  - `assertReleasedSurfaceMetadata` enforces that `sourceEventSeqs` are **unique earlier seqs** (`current >= seq` is refused) and non-empty for non-assistant events; `surfaceOp` must be `replace` with `start`/`end` both `< seq`.
- **Edge cases & failure handling:** `subagent/descriptor` with `version !== 3` is refused in v0 (`unsupported descriptor version`) but merely *skipped* in v1 (the v1 rule set tolerates it) — a version-gated tolerance.
- **Surprising:** `assertReleasedEventPayload` special-cases `session-log-deepseek/delivery-accepted` to admit an extra `sessionFormatVersion` member **only at version 1**.

#### `packages/session/session-format-v0-to-v1/src/validation-helpers.ts`
- **Purpose:** two primitives used by every validator in the package.
- **Key abstractions:** `releasedV0Record(value, label)` — require a plain JSON object; `assertReleasedV0Keys(record, required, optional, label)` — require every named member and **refuse any member outside the optional list**.
- **Data flow:** the "no unexpected members" rule is the backbone of the whole frozen-format discipline.
- **Non-obvious design decisions:** the error messages name the *exact* unexpected member (`has unexpected member "foo"`) and the *exact* missing member (`lacks required member "bar"`) — diagnostics that tell a migration author precisely what to fix.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the helper is named `assertReleasedV0Keys` but is used for *every* generation in the package, including v1 targets — the "V0" in the name refers to the frozen *style*, not the version.

#### `packages/session/session-format-v0-to-v1/src/relationships.ts`
- **Purpose:** the frozen cross-event pairings.
- **Key abstractions:** `assertReleasedArtifactRelationships(artifact, options?)` with an option `legacyInterruptedTurnRestart`.
- **Data flow:** validates the *pairings* that a single-event validator cannot see: turn/step nesting, tool call → tool result, retry chains, compaction groups, title message references.
- **Non-obvious design decisions:** the `legacyInterruptedTurnRestart` option exists because pre-react-loop logs could end a turn and restart it; the relationship rules must tolerate that when validating a *legacy source*.
- **Edge cases & failure handling:** a `tool/result` citing a `callId` with no matching `tool/call` is a relationship error; a compaction `summary` with no `compaction/start` is a relationship error.
- **Surprising:** this file (23 KB) is the one place that knows what a *well-formed session* is, as opposed to what a well-formed *event* is — the validation is deliberately split into "coordinates" (per-event) and "relationships" (cross-event).

#### `packages/session/session-format-v0-to-v1/src/payload-validation.ts`
- **Purpose:** the frozen *nested* payload semantics for every released-v0/v1 event type (the largest file in the package, 51 KB).
- **Key abstractions:** `assertReleasedPayloadSemantics(event, version)`.
- **Data flow:** per event type, validates the nested shape of the payload members that the dispositions declared merely "required" — e.g. that a `tool/call`'s `arguments` is a JSON object, that a `user/message`'s `content` is a valid content-block array, that an `llm/retry`'s `failure` has the right members.
- **Non-obvious design decisions:** validation is **split across two files by depth** — top-level member sets in `dispositions.ts`/`validation.ts`, nested semantics in `payload-validation.ts` — which is why the package can stay frozen per generation while still being thorough.
- **Edge cases & failure handling:** every nested violation raises a `SessionFormatError` naming the event type and seq.
- **Surprising:** at 51 KB, this file is the single biggest validation artefact in the shard — the format's fidelity is bought with volume.

#### `packages/session/session-format-v0-to-v1/src/testing/restore.ts`
- **Purpose:** a test-only restore facade.
- **Key abstractions:** `restoreV0ToV1(header, rows, recovery)` and `restoreV1(header, rows, recovery)`.
- **Data flow:** builds a *separate* one-version catalog (currentVersion 1) with the real codecs and migration but an **identity encoder** (`unusedEncoder`) and test-only validators.
- **Non-obvious design decisions:** the identity encoder is annotated `/* v8 ignore next */` — the test facade genuinely never encodes. Coverage pragmas are used liberally throughout this repo.
- **Edge cases & failure handling:** `recovery` defaults to `'strict'`; the helper passes `'transformed'` for the v0 source and `'current'` for v1.
- **Surprising:** the test facade is a **separate module under `src/testing/`** that ships in the package (`./src/*` is exported) — the production dependency graph is kept free of test-only catalogs, but the helpers are still reachable.

#### `packages/session/session-format-v0-to-v1/src/testing/validation.ts`
- **Purpose:** the four test-side artifact assertions.
- **Key abstractions:** `assertReleasedV0SourceArtifact`, `assertNormalizedReleasedV0Artifact`, `assertReleasedV1MigrationSource`, `assertReleasedV1Artifact`, `assertReleasedV1PhysicalArtifact`.
- **Data flow:** each is a *composition* of the production validators with a different policy (`allowLegacySteering`, `vocabularyNeutral`, `frozenEnvelope`) — the test file picks the policy rather than re-implementing rules.
- **Non-obvious design decisions:** the *same* production `assertReleasedArtifactRelationships` is reused with `{ legacyInterruptedTurnRestart: true }` for the two legacy sources and without it for the final v1 artifact.
- **Edge cases & failure handling:** the "physical" variant passes `knownEventTypes = undefined` and `vocabularyNeutral = true` — it validates shape only.
- **Surprising:** `assertReleasedV1MigrationSource` skips payload validation for event types not in the disposition table (they were already checked as unknown) — a small "don't double-throw" guard.

#### `packages/session/session-format-v0-to-v1/package.json` / `tsconfig.json` / `tsdown.config.ts`
- **Purpose:** manifest, project config, build config.
- **What it pins:** the `dsh.sessionFormatMigration` manifest block — `{ from: 0, to: 1, export: '.', migration: 'sessionFormatV0ToV1', sourceCodec, targetCodec, targetHeaderValidator, targetRestorer }`. **The migration edge is described declaratively in `package.json`**, which is how the static catalog generator discovers it without importing the package at runtime.
- **Surprising:** the manifest is the mechanism that lets the *build* know the chain is complete — a missing edge is a build-time error, not a runtime surprise.

#### `packages/session/session-format-v0-to-v1/src/relationships.ts`
- **Purpose:** the frozen cross-event relationship validator (23 KB).
- **Key abstractions:** `assertReleasedArtifactRelationships(artifact, extensions?)`; `ReleasedRelationshipExtensions { stepEvents?, preservedSourceTitleRequestText?, legacyInterruptedTurnRestart? }`; internal `CompactionState`, `PtcStart`, `ToolLifecycle`.
- **Data flow:** one pass over the events maintaining `openTurn`, `openStep`, `openStepProvider`, a `surface[]` (the visible message list), `openCompaction`, `retries[]`, `ptcRoots`/`ptcStarts`, `toolLifecycles`, and `commandRuns`.
- **Non-obvious design decisions:**
  - **The surface is replayed**, not trusted: `applySurface(surface, event)` reconstructs the visible message list from `surfaceOp` markers, and a replacement must name an *exact* current surface span and must list every shadowed node in `sourceEventSeqs`.
  - **The tool lifecycle is a three-state machine**: `advertised` (an `assistant/message` advertised a `tool-call` block) → `started` (a `tool/call` matched it by id, name *and* arguments string) → resolved (a `tool/result` arrived). `turn/end` and `step/end` **refuse to close while a call is unresolved** ("leaves unresolved tool call X").
  - **A `tool/result` for a call that was advertised but never started is allowed only as the *exact* `TOOL_NOT_STARTED` repair** — `isExactToolNotStartedRepair` requires the error name/code, a canonical `interrupted-tool-result-<callId>-<seq>` message id, a single error text block, **and the exact sentence** "The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed."
  - **The `legacyInterruptedTurnRestart` extension** admits a pre-react-loop pattern: a `next-turn` inbox splice followed by `turn/start` with no prior `turn/end`. Without the extension, that log is refused.
  - **The retry chain rules**: `llm/retry.retry` must be exactly `prior + 1` for the same `(turn, step, provider, policyKey)`; a chain keeps **one** `retryId`; a `retryId` may not be reused across chains.
  - **Compaction must not cross a turn boundary** and a successful `compaction/end` requires exactly one `compaction/summary`; `inheritedOrphanCompactionStarts` tolerates a compaction that was open across a `session/end-seed` (an inherited transaction belonging to the ended source lifecycle).
  - **Title sources are verified against the actual cited events**: `session/title.messageSeqs` must cite earlier *human* `user/message` events, and a `session/title-llm-request` must carry exactly one message whose text is the exact framing `Generate the session title from this JSON array of human messages:\n<json>` — the validation reconstructs the expected prompt and compares it byte for byte.
- **Edge cases & failure handling:** every failure names the event type and the seq; a `command/done` must have a prior `command/run`; a `command/done` with a `sourceEventSeq` must be a `success` whose source is neither a `command/run` nor a `command/done`.
- **Surprising:** the `preservedSourceTitleRequestText` extension exists because the v1→v2 edge had already *embedded* the title prompt text; the validator then must not reinterpret the old sequence numbers embedded in that prompt.

#### `packages/session/session-format-v0-to-v1/src/payload-validation.ts`
- **Purpose:** the frozen nested payload semantics for every released-v0/v1 event type (51 KB — the biggest validation artefact in the shard).
- **Key abstractions:** `assertReleasedPayloadSemantics(event, version)`; a library of tiny assertion helpers (`stringValue`, `nonEmptyString`, `booleanValue`, `countValue`, `positiveIntegerValue`, `finiteNumberValue`, `literalValue`, `nullableValue`, `arrayValue`, `exactRecord`).
- **Data flow:** a `switch` on `event.type` dispatches to a per-type rule; each rule uses the helpers above, so the whole file is a table of *shapes*.
- **Non-obvious design decisions:**
  - **`literalValue(value, allowed, label)`** is the workhorse: every closed vocabulary is expressed as a list of allowed literals — `approval/decided.outcome` ∈ `['allowed-once','rejected','cancelled','unavailable']`, `approval/policy.policy` ∈ `['ask','never']`, `sandbox/mode.mode` ∈ `['read-only','workspace-write','danger-full-access']`, `turn/end.reason.kind` ∈ the known set, `tool-workflow/agent-end.outcome` ∈ `['completed','failed','cancelled']`, `todo` status ∈ `['pending','in_progress','completed']`.
  - **`finiteNumberValue` rejects `-0`** (`Object.is(value, -0)`) — a tiny detail that stops `-0` and `0` from serializing differently.
  - **`literalValue` for `llm/retry.mode`**: `'normal'` requires `maxRetries` and `retry <= maxRetries`; `'always'` must **omit** `maxRetries` entirely. `delayMs` must be non-negative and `≤ 2_147_483_647` ("exceeds the timer range").
  - **`llmFailureValue`**: `status` must be 100–599, `providerRetryAfterMs` must be positive, `requestId` optional.
  - **The content-block audit is open in the *type* but closed in the *fields***: an unknown block `type` is admitted (owner-opaque) but a *known* type (`text`, `reasoning`, `image`, `tool-call`, `tool-result`) has its exact members enforced.
  - **`messageValue` with an `expected` role** forces the role and the source kind: an `assistant` message must have `source.kind === 'model'`, a `tool` message must have `source.kind === 'tool'` and exactly one `tool-result` block whose `toolCallId` equals the source's `callId`.
  - **`legacyGoalMessageValue`** reconstructs the *exact* legacy goal prompt `<goal_state>{json}</goal_state>` and compares with `deepEqualJson` — the validator proves the model-visible text was not tampered with.
  - **`sessionReferenceSourceValue`** enforces arithmetic consistency: `retained + omitted === original`, and `truncated === (omitted > 0 || omittedBytes > 0)`; `inputIndex` must equal the reference's position.
  - **`instantValue`** requires a *canonical* UTC instant: the regex, `Date.parse` finiteness, and `new Date(...).toISOString() === value` must all agree.
  - **`scheduleRecordValue`**: an `every` schedule must have `everySeconds >= 300` (a 5-minute floor on cron-ish work) — a hard-coded reliability floor in the format.
  - **`requestHeaderValue`**: `adapterDefaults` entries are *markers* (`true`) and each must have a corresponding `config` value.
- **Edge cases & failure handling:** `subagent/descriptor` mode ∈ `['one-shot','continuable']`; `agentProvider` and `agentModel` must be **paired**; a `toolFilter` needs at least one of `allow`/`deny`.
- **Surprising:** `deepSeekSearchBodyValue` fully pins the DeepSeek web-search request body — exactly one user message with exactly one text block, and exactly one tool `{type: 'web_search_20250305', name: 'web_search', max_uses: N}`.

#### `packages/session/session-format-v1-to-v2/README.md`
- **Purpose:** the v1→v2 contract — the "cardinality-changing" edge.
- **Key abstractions:** `releasedV1SessionFormatCodec` (frozen v1 reader), `sessionFormatV1ToV2` (the stage), `releasedV2SessionFormatCodec` (v2 reader **and** writer).
- **Data flow:** v1 rows → decoder → stage → v2 events (one event per row) → v2 codec → rows.
- **Non-obvious design decisions:**
  - **Embedding, not appending**: v1 stored each Assistant chunk as its own top-level event; v2 embeds the *exact timed stream* inside the `assistant/message`. The migration "compacts the chunks without joining token boundaries" — the stream stays byte-faithful.
  - **An unclaimed attempt becomes a log-only `assistant/attempt`** at its final chunk position: a failed, retried, cancelled or stream-errored attempt that reached settlement *without* a surface message is preserved as a durable diagnostic but does **not** enter `deriveMessages()`.
  - **The v2 physical header drops the numeric cut**; the cut is derived from the last tagged `session/end-seed { inherited: true }` marker. The target "marks the exact cut" rather than storing a number.
  - **A seeded source that splits an Assistant attempt across the inherited cut is refused** ("inherited Session cut N splits one Assistant attempt").
  - **The migration refuses a reference to a consumed chunk** rather than redirecting it — "The migration refuses a reference to a consumed chunk instead of redirecting it to a different semantic event."
- **Edge cases & failure handling:** the bounded legacy restart pattern (non-empty `next-turn` inbox insertion followed by `turn/start` with no prior `turn/end`) is closed by *emitting* a `turn/end { reason: { kind: 'interrupted' } }`; a legacy round-zero goal mutation becomes a `goal/change` **plus** the original model-visible message with ordinary plugin attribution.
- **Surprising:** "The already model-visible `session/title-llm-request.messages` text remains byte-identical after source validation, so target validation does not reinterpret the old sequence numbers embedded in that prompt." — a migration that changes a *prompt's* content would change the model's meaning, so the numbers embedded in it are deliberately left stale.

#### `packages/session/session-format-v1-to-v2/src/index.ts`
- **Purpose:** the public barrel.
- **Key abstractions:** re-exports `releasedV1SessionFormatCodec` **from the v0-to-v1 package** — the v1 codec is owned by the older package, not duplicated.
- **Non-obvious design decisions:** the frozen decoder is not re-implemented; the *edge* owns only what it changes.
- **Surprising:** the barrel does not export `releasedV1SessionFormatCodec` from a local file, which is why `dsh-session-format-v1-to-v2` depends on `dsh-session-format-v0-to-v1`.

#### `packages/session/session-format-v1-to-v2/src/dispositions.ts`
- **Purpose:** the frozen v2 event inventory.
- **Key abstractions:** `RELEASED_V2_EVENT_DISPOSITIONS`, `RELEASED_V2_EVENT_TYPES`.
- **Data flow:** it is *derived* from the v0 table: `retained` = the v0 dispositions minus `assistant/chunk`, `assistant/message`, `session-log-deepseek/delivery-accepted`, `session/end-seed`; then four v2-specific entries are added.
- **Non-obvious design decisions:** the v2 delta is tiny and *explicit*: `assistant/attempt` (new), `assistant/message` now requires a `stream` member, the delivery marker gains an optional `sessionFormatVersion`, and `session/end-seed` gains an optional `inherited` flag. Everything else is inherited verbatim — **the inventory is a diff, not a copy**.
- **Surprising:** a v2 `session/end-seed` has *no required members at all* (`disposition([])`) — the marker is defined entirely by its `type`, and `inherited: true` is what carries the cut.

#### `packages/session/session-format-v1-to-v2/src/codec.ts`
- **Purpose:** the released v2 physical codec (reader + writer).
- **Key abstractions:** `releasedV2SessionFormatCodec` (a `SessionFormatCodec & SessionFormatCurrentEncoder`).
- **Data flow:** `decodeHeader` → physical header; `createDecoder(header, recovery)` → row scanner; `encodeHeader(header, inheritedEventCount)` → physical header; `encodeEvent(event)` → physical row.
- **Non-obvious design decisions:**
  - **The v2 header requires `isSeeded` explicitly** (v0/v1 inferred it from `seedLength`'s presence) and **stores no cut** — the cut is derived from the `session/end-seed { inherited: true }` marker during decoding.
  - **The v2 decoder validates the cut at `finish()`**: a seeded session without an accepted inherited marker is refused, and an unseeded session *with* one is refused.
  - **`encodeSeqRanges` re-compresses** a dense list into `[start, end]` pairs — but only when the run is ≥ 3 long, and a run of exactly 2 is emitted as two scalars. A non-increasing list is passed through unchanged.
- **Edge cases & failure handling:** recoverable mode keeps the prefix and re-throws the first issue at the next `turn/end` — the same "commit proves the region mattered" rule as v0/v1.
- **Surprising:** `encodeEvent` is range-encoding only; the v2 writer is otherwise the v1 row shape, so a v2 file is *readable* by a v1 reader except for the cut derivation.

#### `packages/session/session-format-v1-to-v2/src/validation.ts`
- **Purpose:** released-v2 header, envelope and relationship validation.
- **Key abstractions:** `assertReleasedV2Header`, `restoreReleasedV2Artifact(artifact, knownEventTypes, relationshipHeaderVersion?)`, `assertReleasedV2PhysicalArtifact`, plus the local `releasedV2Record` / `assertReleasedV2Keys` helpers.
- **Data flow:** `validateReleasedV2Artifact(artifact, mode, knownEventTypes, relationshipHeaderVersion)` walks the events, checks density, the `ignorable` flag, the last inherited marker vs the declared cut, and finally delegates the *cross-event* rules to the frozen v0-to-v1 `assertReleasedArtifactRelationships` with the v2 extensions.
- **Non-obvious design decisions:**
  - **The v2 edge reuses the v0-to-v1 relationship validator** with `stepEvents: {'assistant/attempt'}` and `preservedSourceTitleRequestText: true`. The v2 event vocabulary is a *superset* of v1's, so the old validator is extended rather than forked.
  - **`relationshipHeaderVersion` defaults to the artifact's own version but can be overridden** — the v3 validator calls `restoreReleasedV2Artifact(..., 3)` so that version-sensitive relationships are checked against the *target* generation while the envelope check runs as v2.
  - **The "physical" mode** allows the full surface key set everywhere and skips vocabulary interpretation; the "current" mode applies the log-vs-surface optional-key split and refuses unknown required types.
- **Edge cases & failure handling:** an unknown event type is an `SessionFormatUnsupportedMigrationError` ("format v2 contains unknown event type X at seq N") unless it is `ignorable`.
- **Surprising:** the v2 artifact is validated with `mode: 'current'` only when a `knownEventTypes` set is supplied — the same artifact can be "physically valid" and "semantically unknown".

#### `packages/session/session-format-v1-to-v2/src/migration.ts`
- **Purpose:** the cardinality-changing stage (22.7 KB).
- **Key abstractions:** `sessionFormatV1ToV2`; `TransformedReleasedV1ToV2Stage` and its subclass `DecodedReleasedV1ToV2Stage`; `AttemptGroup { turn, step, spans[], stream[], accumulator?, chunkCount, lastChunkSeq, lastChunkTime, terminal }`; `ReleasedV1ToV2State`.
- **Data flow:** the stage holds **one unsettled attempt** plus a `mapping: Map<oldSeq, newSeq>`. Chunks accumulate into an `AssistantStreamAccumulator`; when the attempt settles (a matching `assistant/message`, or a `turn/end`/`step/end`/`llm/retry`), the stream is compacted and either embedded in the message or emitted as an `assistant/attempt`.
- **Non-obvious design decisions:**
  - **Two stage classes for two source kinds**: `input.sourceKind === 'decoded'` uses the subclass that *additionally* asserts the v1 payload semantics before transforming (the decoded path is responsible for validating what the physical decoder left open).
  - **The chunk→message binding is strict**: an `assistant/message` must cite *exactly* the complete ordered attempt in `sourceEventSeqs` (`matchesChunkSources` compares the count and every seq). A partial citation is refused ("chunk references are not one complete ordered attempt").
  - **`afterLastChunk` buffering**: events that arrive after the last chunk but before the attempt settles are *held* and re-emitted after the attempt, so the output order is "attempt first, then the interleaved tail".
  - **The `finishAttempt` order is deliberate**: the `assistant/attempt` is emitted **at the last chunk's position** (`group.lastChunkSeq`), so the diagnostic appears where the attempt actually ended, not at the end of the log.
  - **The legacy restart repair** (`legacyInterruptedTurn`) synthesises a `turn/end { kind: 'interrupted' }` for the previous turn when a `next-turn` inbox splice is followed by a `turn/start` with no intervening `turn/end`.
  - **`splitLegacyGoalChange`** turns a legacy goal `user/message` into a `goal/change` event **plus** the original message re-attributed to `{ kind: 'plugin', plugin: 'goal' }` — durable state *and* historical model input both survive.
  - **Reference remapping is an explicit allow-list**: `command/done.sourceEventSeq`, `compaction/*.{shadowedRange,shadowedSeqs}`, `session/title*.messageSeqs`, plus the envelope's `sourceEventSeqs` and `surfaceOp`. `mapOne` refuses a reference to a *consumed* chunk ("targets consumed assistant/chunk N").
- **Edge cases & failure handling:** `assertAttemptCut` / `assertAttemptRange` refuse a cut that splits an attempt; `ensureTargetCut` inserts the `session/end-seed { inherited: true }` marker at the right place if the source did not have one exactly at the cut.
- **Surprising:** the stream compaction (`appendStreamRecord`) *merges* two adjacent packed runs of the same kind by splicing their `dt` delta arrays and their payload arrays — the v2 stream is byte-equivalent to the v1 packed representation, not a re-encoding.

#### `packages/session/session-format-v1-to-v2/src/testing/validation.ts`
- **Purpose:** the frozen v2 *writer-image* validator.
- **Key abstractions:** `assertReleasedV2Artifact(artifact)`.
- **Data flow:** for `assistant/message` and `assistant/attempt` it **re-expands the embedded stream** with `expandAssistantStream`, pushes every chunk through a `BlockAssembler`, and then asserts that the message's `content`, `usage` and `source.replayState` **equal** what the assembler produced.
- **Non-obvious design decisions:** this is the strongest consistency check in the shard — the embedded stream and the summarised message must agree exactly, or the artifact is corrupt. `interrupted: true` selects `assembler.interruptedBlocks()` instead of `assembler.blocks()`.
- **Edge cases & failure handling:** an invalid embedded stream is re-thrown as "has an invalid embedded stream" with the original error as `cause`.
- **Surprising:** the same file also *re-exports* `assertReleasedV2PhysicalArtifact` from production code, so the test facade and the production validator cannot drift.

#### `packages/session/session-format-v1-to-v2/package.json`
- **Purpose:** manifest.
- **What it pins:** the `dsh.sessionFormatMigration` block for the 1→2 edge; dependencies on `dsh-llm` (the `AssistantStreamAccumulator`), `dsh-session-format`, `dsh-session-format-v0-to-v1` (the frozen v1 codec + validator) and `dsh-util-values`.
- **Surprising:** the *v2* package depends on the *v0-to-v1* package — the chain is a DAG of frozen edges, each depending on the ones before it, not a linear fork.

#### `packages/session/session-format-v2-to-v3/README.md`
- **Purpose:** the single, exhaustive specification of the V2→V3 edge (20 KB) — the most decision-dense document in the shard.
- **Key abstractions:** the spec is organised as: header/preset references, system head and message identities, sequence references and inheritance, PTC vocabulary, canonical envelopes and tool errors, delivery guards, source audit and refusal, then native V3 admission.
- **Data flow:** n/a (specification).
- **Non-obvious design decisions:**
  - **The system prompt becomes a message.** The first `step/start` is followed by an empty `system/message` append; a changed prompt inserts a new system message that *replaces exactly the current protected head* and cites it in `sourceEventSeqs`. The head is **protected**: no ordinary surface replacement and no compaction may shadow it. This is the "system prompt as a surface node" decision.
  - **Synthetic message ids are content-addressed**: `v2-to-v3-system-` + SHA-256 of `JSON.stringify(['session-format-v2-to-v3', sourceHeader.id, anchor.seq, anchor.type])`. Id collisions with source ids are **refused in either encounter order**.
  - **The reference-remap table is explicit and finite** (five owners, six fields). "There is no recursive numeric-field rewrite." Delivery `throughSeq`, session-reference `capturedThroughSeq`, workflow-local `seq`, stream block indices, turn/step numbers, inbox indices, token/byte counts and all ids keep their source values.
  - **The PTC rename is surgical**: only the exact tags `tool/code-dispatch-start`/`tool/code-dispatch` and only the plugin string `tools-code-mode` in **exactly three slots** (a user message's source, an inbox insertion's source, a title request's message source). "Similar plugin names, other source kinds, arbitrary text, nested JSON, and historical ids including `:code:` remain unchanged."
  - **The content audit is a closed *kind* set** (`text`, `reasoning`, `image`, `file`, `tool-call`, `tool-result`) applied to a finite list of positions, recursively into `tool-result.content`. An unknown kind **refuses the whole migration**.
  - **"Admission does not rewrite content."** The audit *inspects*; it does not normalise. Tool arguments, `replayState.response` and `replayState.blocks` stay opaque — "matching field names inside arbitrary JSON do not trigger this audit."
  - **Recovery and refusal are separated**: physical decoding failures are corruption under the selected recovery policy; migration-stage and transformed-target failures are typed `SessionFormatUnsupportedMigrationError`. "No source or target repair, generation fallback, or file rewrite is performed by this edge."
- **Edge cases & failure handling:** a V2 delivery marker claiming format 3 is refused; a foreign local marker is refused; a seeded log without an inherited marker is refused.
- **Surprising:** the spec's own scope statement — "preservation applies to admitted input, not arbitrary unaudited extensions" — is the honest limit of every "lossless" claim in the format.

#### `packages/session/session-format-v2-to-v3/src/index.ts`
- **Purpose:** the barrel.
- **Key abstractions:** re-exports `releasedV2SessionFormatCodec` (from v1-to-v2) plus the local codec, migration and validation.
- **Surprising:** `payload.ts` and `references.ts` are **not** exported from the barrel — the V2→V3 surface is deliberately small.

#### `packages/session/session-format-v2-to-v3/src/codec.ts`
- **Purpose:** the V3 physical codec — "hard structural admission and recoverable canonical event validation".
- **Key abstractions:** `releasedV3SessionFormatCodec`; `assertV3RowAdmission(row)`.
- **Data flow:** the v3 decoder **wraps** the v2 decoder. `decodeRow` first runs `assertV3RowAdmission(row)` (a *row-level* check, before the scanner can discard a recoverable tail), then delegates to the v2 decoder, whose `emitEvent` is intercepted to run `assertV3EventAdmission` and `assertV3Event`.
- **Non-obvious design decisions:**
  - **Two layers of admission on purpose**: *row* admission (structural: `request/header` must not carry `system`; `system/message` must be well-formed) runs **before** recovery, so a retired-syntax row is a hard refusal even in recoverable mode. *Event* admission (canonical envelope rules) runs after decoding and **is** subject to the recoverable policy.
  - **The recoverable policy in v3 withholds the first invalid event and its suffix**; a later `turn/end` establishes a commit and rejects that suffix.
  - **Only accepted inherited markers count**: a seeded session whose accepted prefix contains no inherited marker is refused.
- **Edge cases & failure handling:** "Unclassified event metadata is deferred to vocabulary-aware restoration rather than discarded as canonical corruption, so it cannot hide an unknown required type."
- **Surprising:** the v3 header is decoded by *lying* to the v2 codec (`{...header, version: 2}`) and then correcting the version back — the framing is identical, only the semantics differ.

#### `packages/session/session-format-v2-to-v3/src/migration.ts`
- **Purpose:** the V2→V3 stage (system-prompt promotion + reference remap + canonicalisation).
- **Key abstractions:** `sessionFormatV2ToV3`; `ReleasedV2ToV3Stage`; `renamePtcEvent`; `renameMessageSource`.
- **Data flow:** per event: assert v2 payload → observe message ids → if `request/header`, extract `header.system` and compare to the current prompt (a change emits a system message) → remap references → canonicalise → emit. The stage tracks `mapping: number[]`, `originalIds`, `generatedIds`, `head`, `prompt`, `step`.
- **Non-obvious design decisions:**
  - **The prompt comparison is exact string equality**; an *absent* `header.system` means the empty prompt, and an empty string **clears** an earlier prompt. "whitespace-only strings remain nonempty text."
  - **The system message carries the *open step's* turn/step and the *anchor event's* time** — a synthetic event that is nonetheless placed in real chronology.
  - **The head replacement uses `surfaceOp: {op:'replace', start: head, end: head}` with `sourceEventSeqs: [head]`** — the canonicalised form renames `start/end` to `startSeq/endSeq`.
  - **`observeMessageIds` runs before emission** so that a generated id colliding with a *later* source id is still caught (the spec calls this out: "Collisions with generated or source message ids are refused in either encounter order").
  - **A surface event before the first step is refused** — "cannot acquire a system head without changing chronology".
  - **A changed prompt outside an open step is refused** — "cannot retain source chronology".
- **Edge cases & failure handling:** the `code` → `ptc` preset rename is applied to the header and to every `agent-preset/selected`, but *only* the exact string `code`; "This conversion does not inspect installed presets or rewrite other occurrences of `code`."
- **Surprising:** the delivery guard refuses a V2 marker that claims format 3 ("delivery marker claims target format v3") — a marker may not be *promoted* into the next generation's watermark.

#### `packages/session/session-format-v2-to-v3/src/references.ts`
- **Purpose:** explicit local-coordinate remapping.
- **Key abstractions:** `remapEvent(event, seq, mapping)`.
- **Data flow:** a `one()` helper resolves one source seq to a target seq, refusing a reference that does not name an *earlier* source event with an established mapping.
- **Non-obvious design decisions:** the switch has exactly five cases (`command/done`, `compaction/summary`, `compaction/prune`, `session/title`, `session/title-llm-request`) plus the envelope. The comment is explicit about what is *not* a coordinate: "Delivery watermarks and session-reference captures identify their original generation. Workflow seq, stream block indices, turn/step, and numeric tool JSON are not Session seqs."
- **Edge cases & failure handling:** a reference to a later or unmapped event throws "reference must name an earlier source event".
- **Surprising:** the file is deliberately boring — 60 lines that change *only* the six declared fields. The value is in the refusal to be clever.

#### `packages/session/session-format-v2-to-v3/src/validation.ts`
- **Purpose:** native V3 system-head validation with a **private view** for the frozen relationship validator.
- **Key abstractions:** `assertReleasedV3Header`, `restoreReleasedV3Artifact(artifact, knownEventTypes)`, `assertV3EventAdmission`.
- **Data flow:** the artifact's events are mapped into a *projected* copy (`relationshipEvent`), the frozen v2 relationship validator runs on the projection, and the **original artifact is returned unchanged**.
- **Non-obvious design decisions — this is the cleverest file in the shard:**
  - **The private view** translates V3 shapes back into the shapes the *frozen* v0-to-v1 validator understands: `tool/ptc-dispatch-start` → `tool/code-dispatch-start`; a `system/message` → a `user/message` with `role: 'user'` ("The frozen validator needs a surface-eligible event, not a model-visible substitute"); a V3 `surfaceOp` `{startSeq,endSeq}` → the frozen `{start,end}`.
  - **The repair-id trick**: the frozen validator expects a `TOOL_NOT_STARTED` message id to end in the *target* sequence, but the V3 id keeps its *historical* suffix. The projection rewrites the id **only inside the private view** ("Message identity survives promotion; only this private frozen repair check uses target seq").
  - **The protected head** is enforced here: a `system/message` needs an open step; a non-append system message may replace *only* the head; an ordinary surface replacement may not shadow the head; a compaction may not shadow the head.
  - **`restoreReleasedV2Artifact({...artifact, header: {...artifact.header, version: 2}}, knownEventTypes, 3)`** — the envelope check runs as v2, the *version-sensitive* relationships as v3.
- **Edge cases & failure handling:** obsolete ignorable PTC events are excluded from the frozen lifecycle validation by projecting them to `v3/opaque-released-event` — "Obsolete ignorable events do not participate in released PTC lifecycle validation."
- **Surprising:** the whole design is "let a frozen validator keep working by giving it a temporary costume" — a genuinely reusable migration technique.

#### `packages/session/session-format-v2-to-v3/src/payload.ts`
- **Purpose:** audited V2 migration admission and V3 payload validation (20.7 KB), "independent of installed core Session types".
- **Key abstractions:** `SURFACE_TYPES` (four V3 surface types), `SOURCE_KINDS` (15 known source kinds), `CONTENT_KINDS` (6 known content kinds), `assertEvent(event, 2|3)`, `assertV3Event(event, knownEventTypes?)`, `assertV3StructuralRow(value)`, `canonicalizeTransformedEvent(event)`, `isRepairIdentity(id, callId)`.
- **Data flow:** `assertEvent` for version 2 does: disposition lookup → envelope key check → density/time checks → surface metadata → payload key check → **owned content audit** → the frozen v1 `assertReleasedPayloadSemantics` → source classification.
- **Non-obvious design decisions:**
  - **The content audit reuses the frozen validator through a synthetic probe**: `assertContentBlock` builds a fake `user/message` event containing the one block and calls the frozen `assertReleasedPayloadSemantics` on it. The comment says why: "Frozen payload failures need the original event and content path, not the synthetic message."
  - **The `tool-result` wrapper is not recursed into twice**: for the probe the block's `content` is emptied, because `assertContentKinds` already recursed into it.
  - **`isRepairIdentity`** recognises `interrupted-tool-result-<callId>-<n>` with a strict numeric regex (`^(0|[1-9]\d*)$`) — no leading zeros, no negative, no `+`.
  - **The "five Message slots"** are enumerated: `user/message.data.content`, `assistant/message.data.message.content`, `tool/result.data.message.content`, `agent/inbox/spliced.data.inserted[].content`, `session/title-llm-request.data.messages[].content` — plus `team/message/queued`, `compaction/summary`, `tool/code-dispatch` and the embedded stream.
  - **Embedded streams are audited but not rewritten**: only raw `type: 'chunk'` records are inspected (`block-end` → `chunk.block`, `block-start` → `chunk.blockType`); "a partial start cannot introduce an unknown kind."
  - **`canonicalizeTransformedEvent`** renames the replacement endpoints and **omits exactly** `tools: []` and `adapterDefaults: {}` from `request/header.data.header` — and explicitly *does not* normalise `config.stop: []`.
- **Edge cases & failure handling:** a `tool/result` carrying `data.error` must have its single tool-result block marked `isError: true` — "Contradictory outcomes are refused, never repaired by adding `isError` or deleting diagnostics."
- **Surprising:** `feedback/message-put` and `feedback/message-delete` are admitted even though they are **not** in the released V2 disposition table — the audit explicitly extends the inventory for feedback events (`assertFeedback`: rating is exactly `positive` or `negative`).

#### `packages/session/session-format-v3-to-v4/README.md`
- **Purpose:** the V3→V4 specification (36 KB — the longest document in the shard).
- **Non-obvious design decisions (highlights):**
  - **V4 promotes the tool result to a first-class `role: 'tool'` message** with `toolCallId` and `isError` on the message, replacing the old `role: 'user'` message wrapping a `tool-result` block.
  - **"Unknown ignorable events remain opaque, including their logical metadata"** — an unknown `ignorable` event keeps its payload untouched, and only its `seq` moves. It is namespaced as `plugin:<type>`.
  - **The V3→V4 body migration requires explicit child evidence** — a header-only migration is allowed, but a body restore must be given the parent's historical children (possibly an empty array).
  - **Tool schema `deferLoading` is V4-only**: a V3 tool definition that carries it is refused ("contains deferLoading, which is only defined in V4").
  - **The `developer/message` event** carries tool additions/removals that reference a `request/header` by `headerSeq`; a tool-addition must name *exactly one* tool in that header and the header must contain a complete definition.
  - **Retired syntax is a hard refusal even after a recoverable physical-row failure** — a retired `tool-result` wrapper, a retired `header.system`, or a retired PTC tag are never silently dropped.
- **Edge cases & failure handling:** a `tool/result` carrying error metadata for a non-error result is refused; a `developer/message` must omit `headerSeq` when it has no tool additions.
- **Surprising:** the migration **keeps the protected system head** concept from V3, and the V4 relationship validator re-implements it independently rather than reusing the V3 code — a deliberate fork so V3 can stay frozen.

#### `packages/session/session-format-v3-to-v4/src/index.ts`
- **Purpose:** the barrel.
- **Key abstractions:** re-exports `releasedV3SessionFormatCodec` (from v2-to-v3) plus the local codec, migration, validation, `historicalChildCatalogSource` and `RELEASED_V3_EVENT_TYPES`.
- **Surprising:** `RELEASED_V3_EVENT_TYPES` is exported from *this* package because the historical catalog needs the frozen V3 vocabulary to collect child prerequisites without recursing.

#### `packages/session/session-format-v3-to-v4/src/extension-identities.ts`
- **Purpose:** the fixed V3 event vocabulary and the namespacing of historical opaque events.
- **Key abstractions:** `RELEASED_V3_EVENT_TYPES` (a frozen 58-name set); `namespaceV3OpaqueEvent(event)`.
- **Data flow:** an unknown *ignorable* event is renamed `plugin:<type>` and keeps `ignorable: true`; a known event is returned unchanged.
- **Non-obvious design decisions:**
  - **The list is frozen and must not track the installed writer.** The comment says it outright: "This historical list must not inherit additions or removals from the current Session event list." The file is wrapped in `/* jscpd:ignore-start */` because it duplicates the installed list on purpose.
  - **The list includes types that do not exist in V0/V1** — `deliverables/presented`, `image/offload`, `subagent/catalog`, `workspace/changes`, `system/message` — so the frozen V3 reader is self-contained.
- **Edge cases & failure handling:** n/a.
- **Surprising:** `namespaceV3OpaqueEvent` is the *only* place in the shard where an unknown event is allowed to survive, and it does so by moving it into a `plugin:` namespace — a namespace that the rest of the format treats as opaque forever.

#### `packages/session/session-format-v3-to-v4/src/codec.ts`
- **Purpose:** the V4 physical codec.
- **Key abstractions:** `releasedV4SessionFormatCodec`; `assertV4RowAdmission(row, knownEventTypes?)`.
- **Data flow:** the v4 codec wraps the v2 codec (framing is unchanged) and adds an admission gate before every row.
- **Non-obvious design decisions:**
  - **Ignorable `developer/message` rows are deferred, not validated**: "Ignorable developer payloads require reader vocabulary; physical decoding defers them." If the reader does not know `developer/message`, the row is passed through unvalidated.
  - **`encodeEvent` validates the ignorable developer payload** (it is a *writer*, so it must know the shape) but `decodeRow` does not (a reader may not).
- **Edge cases & failure handling:** n/a.
- **Surprising:** the same event type is validated asymmetrically on write and on read — a deliberate reader/writer asymmetry.

#### `packages/session/session-format-v3-to-v4/src/migration.ts`
- **Purpose:** the V3→V4 stage, including the child-catalog completion.
- **Key abstractions:** `sessionFormatV3ToV4` (whose `createStage` **always throws** — "V3 catalog migration requires explicit historical child facts"), `createSessionFormatV3ToV4(children)` (the bound variant), `ReleasedV3ToV4Stage`.
- **Data flow:** the stage sorts the supplied child evidence by `(childCreatedAt, childId)`; per event it remaps references, rewrites message sources, lifts the tool result, migrates content, and finally (in `finish()`) appends a `subagent/catalog` event for every child that the parent does not already know about.
- **Non-obvious design decisions:**
  - **The unbound migration deliberately refuses to create a stage** — you cannot accidentally migrate a V3 body without declaring the children.
  - **The interrupted-turn repair** emits a synthetic `turn/end { kind: 'interrupted' }` *before* the new `turn/start`, mirroring the v1→v2 rule.
  - **Opaque events are passed through with only `seq` moved** — "V3 admission never checked `sourceEventSeqs` or `surfaceOp` on them and native V4 does not interpret either, so only `seq` moves."
  - **The child-catalog merge is conflict-checked**: an existing `subagent/catalog` entry and the supplied child evidence must agree on `childCreatedAt`, `mode` and `label`, else the migration is refused. A duplicate child id is refused.
  - **A child with no usable descriptor becomes `mode: 'unknown'`** — the catalog records that the child existed even when its descriptor cannot be interpreted.
- **Edge cases & failure handling:** a V3 delivery marker claiming format 4 is refused; a foreign delivery marker outside the inherited prefix is refused.
- **Surprising:** the migration *appends* the catalog entries to the parent's own log — the parent's history becomes the record of who its children were.

#### `packages/session/session-format-v3-to-v4/src/validation.ts`
- **Purpose:** native V4 metadata and generation-owned relationship validation.
- **Key abstractions:** `assertReleasedV4Header`, `restoreReleasedV4Artifact(artifact, knownEventTypes)`, `assertReleasedV4Relationships(artifact, knownEventTypes)`, `validateDeliveryAccepted(event, currentVersion)`.
- **Data flow:** the artifact is checked for the cut, density, the last inherited marker, and per-event admission; then `assertReleasedV4Relationships` runs the per-event checks and finally `assertV4LifecycleRelationships`.
- **Non-obvious design decisions:**
  - **`validateDeliveryAccepted(event, currentVersion)` only inspects a marker whose `sessionFormatVersion` equals the *current* generation.** Older markers are opaque. This is how a format edge can carry watermarks for generations it does not understand.
  - **A delivery marker's `throughSeq` must precede its own marker seq** — a watermark cannot claim the future.
  - **Unknown event types are refused unless `ignorable`** — the same rule as every other generation, and the *only* place the "vocabulary-aware" behaviour differs from the v0→v1 rule (which refused unknown ignorable events outright).
- **Edge cases & failure handling:** a seeded V4 header must agree with its last inherited marker exactly; an unseeded one must have none.
- **Surprising:** `restoreReleasedV4Artifact` returns the *same* artifact object it was given — the validators never rewrite.

#### `packages/session/session-format-v3-to-v4/src/tool-role.ts`
- **Purpose:** the V4 first-class tool-role message.
- **Key abstractions:** `liftToolResult(event)` (V3→V4) and `assertV4ToolResultMessage(event)` (native V4).
- **Data flow:** the V3 wrapper (`role: 'user'`, one `tool-result` block) is lifted into `{ role: 'tool', source, toolCallId, content, isError, id }`.
- **Non-obvious design decisions:**
  - **Unknown fields are preserved under a namespaced key**: `plugin:message:<key>` for the message and `plugin:result:<key>` for the wrapper. "Preserve unknown fields without merging their original message and result owners."
  - **The wrapper is validated *before* it is dropped** — "Validate the wrapper before dropping it so malformed historical content is rejected instead of being silently truncated."
  - **A nested `tool-result` inside the result content is refused** ("contains a nested tool-result unsupported by this converter").
- **Edge cases & failure handling:** a `tool/result` whose message is not a single matching wrapper throws "requires exactly one tool-result wrapper matching its tool source".
- **Surprising:** `isError` lives on the *message* in V4 and the invariant "error metadata ⇒ isError: true" is checked in both directions.

#### `packages/session/session-format-v3-to-v4/src/content.ts`
- **Purpose:** V3 content-tag migration and the V4-only `deferLoading` guard.
- **Key abstractions:** `migrateV3Content(value, subject)`, `migrateV3EventContent(event)`.
- **Data flow:** an unknown content block `type` is renamed `plugin:<type>`; the same applies to a stream `block-start`'s `blockType`.
- **Non-obvious design decisions:**
  - **Only the *tag* is namespaced**; the block's other fields are untouched, and image references are shared, not copied.
  - **The `file` block's attachment is validated in the V2 audit** (`attachmentId`, `name`, `bytes`) but the ids and byte counts are explicitly **not** interpreted as Session references.
  - **A V3 tool definition carrying `deferLoading` is refused** — a V4-only field must not be silently accepted from V3.
- **Edge cases & failure handling:** n/a.
- **Surprising:** content-block types are namespaced with the *same* `plugin:` prefix as opaque events — one convention for "not ours".

#### `packages/session/session-format-v3-to-v4/src/developer.ts`
- **Purpose:** native V4 developer messages, tool-change blocks and deferred tool schemas.
- **Key abstractions:** `assertV4DeveloperData(event)`.
- **Data flow:** a `developer/message` must carry `turn`, `step` (both positive) and a `developer`-role message; its content may contain `tool-addition` / `tool-removal` blocks.
- **Non-obvious design decisions:**
  - **A tool-addition carries only the tool *name*.** The definition lives in the referenced `request/header` (`headerSeq`). "format v4 tool-addition must omit inline tool definitions" — the schema is stored once, in the header, and the addition is a pointer.
  - **`headerSeq` is required iff there are tool additions** and must be *omitted* otherwise.
  - **A `developer` role outside a `developer/message` is refused** ("developer/message and developer role must occur together").
  - **Tool-change blocks are forbidden in an Assistant stream** — the tool registry is a developer-only concern.
  - **`deferLoading` must be `true` when present** — it is a one-way flag.
- **Edge cases & failure handling:** ordinary-message corruption is left to the decoder; only *recognised V4-only values* are refused here.
- **Surprising:** the "developer message" is how the harness records a *tool-registry change* in the transcript — the tool set is part of the conversation's history, not just the request header.

#### `packages/session/session-format-v3-to-v4/src/facts.ts`
- **Purpose:** historical child identity reduced to the fields a parent's catalog needs.
- **Key abstractions:** `historicalChildCatalogSource(artifact)`, `childCatalogSource(value)`, `childCatalogFact(source)`, `catalogFact(value, subject?)`, `childCatalogSubject(source)`.
- **Data flow:** a child's own `subagent/descriptor` events (those at or after the child's inherited cut) are reduced to `{ childId, childCreatedAt, descriptorCount, descriptor }`.
- **Non-obvious design decisions:**
  - **Only exactly one known descriptor produces a fact** (`descriptorCount === 1` and a descriptor version in 1..3). Otherwise the fact is `undefined` and the child is catalogued as `mode: 'unknown'`.
  - **V1 descriptors implied `mode: 'continuable'`** — "V1 described only continuable children and carried no mode field."
  - **`catalogFact` couples version and mode**: `version === 2` ⟺ `mode === 'external'`, and `version === 0` forbids `mode: 'unknown'`.
  - **The diagnostic subject may include a storage path**: "Session <id> (raw log: <path>)" — the migration can be told where the child's log lives.
- **Edge cases & failure handling:** a child whose header is not `origin: 'subagent'` with a `parentSession` is refused ("catalog migration requires a subagent child with a direct parent").
- **Surprising:** the catalog is a *derived index* of a parent's children, computed from the children's own logs — no central registry is needed.

#### `packages/session/session-format-v3-to-v4/src/fork-result.ts`
- **Purpose:** native V4 fork-generated not-started result validation.
- **Key abstractions:** `assertV4ForkResult(row)`.
- **Data flow:** recognises `forked-tool-result-<callId>-<n>` message ids on `TOOL_NOT_STARTED` errors and checks the id/sequence relationship.
- **Non-obvious design decisions:**
  - **An append result carries its own sequence** (`sequence === row.seq`); a **replacement** result retains an *earlier* identity (`sequence < row.seq`) and must cite exactly that one source event.
  - The exact error name, the `tool` role, `isError: true`, the matching `toolCallId`, and a single text block are all required.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the fork result id embeds a sequence number that is interpreted differently in the two placement modes — the validator has to know which mode it is in.

#### `packages/session/session-format-v3-to-v4/src/message-sources.ts`
- **Purpose:** native source admission.
- **Key abstractions:** `assertV4MessageSources(event)`, `assertV4SourceRowAdmission(row)`.
- **Data flow:** `mapEventMessages` visits every declared message slot and checks that the source's `kind` is **producer-owned** and not `'plugin'`.
- **Non-obvious design decisions:** **the `plugin:` wrapper is retired** — a message's source must name its *producer* (`system-prompt`, `runtime-context`, `ptc-mode`, …), not a plugin id. "Refuse retired source syntax even after a malformed recoverable row."
- **Edge cases & failure handling:** n/a.
- **Surprising:** the *row-level* check only fires for a source that is already `kind: 'plugin'` — an incomplete row is left to the decoder.

#### `packages/session/session-format-v3-to-v4/src/retired-syntax.ts`
- **Purpose:** hard refusals for retired syntax.
- **Key abstractions:** `assertV4RetiredSyntax(row)`.
- **Data flow:** scans the declared content slots of the row for a `tool-result` wrapper, a retired `header.system`, and a retired PTC tag.
- **Non-obvious design decisions:**
  - **The refusals run on the *raw row*, before the scanner can discard it** — "Retired native syntax remains a hard refusal even after a recoverable physical-row failure."
  - **The scope is explicit**: "Tool arguments, replay state, schema parameters, and nested extension values remain opaque."
- **Edge cases & failure handling:** a `block-start` with `blockType === 'tool-result'` is refused too, not just a `block-end` carrying one.
- **Surprising:** the same retirement is checked in three different files (`retired-syntax.ts`, `developer.ts`, `tool-role.ts`) — defence in depth against a wrapper sneaking back in.

#### `packages/session/session-format-v3-to-v4/src/sources.ts`
- **Purpose:** released V3 plugin-source conversion and declared message traversal.
- **Key abstractions:** `mapEventMessages(event, transform)`, `rewritePluginSource(source, seq, role)`, `rewriteV3MessageSource(source, seq, role)`, `RENAMED_PRODUCERS`, `RELEASED_SAME_NAME_PRODUCERS`.
- **Data flow:** `mapEventMessages` visits only the messages carried by first-party event payloads (five slots) and returns the *same* event object when nothing changed.
- **Non-obvious design decisions:**
  - **The rename table is small and explicit**: `compact` → `compact-checkpoint`, `tools-code-mode` → `ptc-mode`, `tools-ptc` → `ptc-mode`, `dsh-compaction-basic` → `compact-basic`, `@deepseek-ai/dsh-system-prompt` → `runtime-context` (or `system-prompt` when the message role is `system`).
  - **A plugin id with no mapping becomes `plugin:<id>`** — the identity fallback. And a *known* first-party id keeps its own name (28 entries listed explicitly).
  - **`rewritePluginSource` drops the `plugin` field** and replaces `kind` with the producer kind. If the source had exactly two members, the result is `{ kind }` alone.
- **Edge cases & failure handling:** a `plugin` source with a non-string `plugin` member is refused ("plugin source at seq N is not canonical").
- **Surprising:** the role-sensitive rename — the *same* plugin id becomes a different producer kind depending on the message's role — is the kind of detail that is only discovered by actually reading the migrations.

#### `packages/session/session-format-v3-to-v4/src/system-message.ts`
- **Purpose:** native system-message field validation.
- **Key abstractions:** `assertV4SystemMessageFields(row)`.
- **Data flow:** checks `turn`/`step` are positive, the message has an id, `role === 'system'`, an array content, and per-block field rules.
- **Non-obvious design decisions:** the block switch admits `text`, `reasoning`, `tool-call` and `image`, **refuses** `tool-result`, and *ignores* unknown block types ("ContentBlockMap is merge-extensible; only known block fields are interpreted here"). The image attachment's `mediaType` is restricted to png/jpeg/webp/gif.
- **Edge cases & failure handling:** n/a.
- **Surprising:** the system message is validated **independently of its historical representation** — the V3-era system message (a `role: 'user'` stand-in) is not accepted as native V4.

#### `packages/session/session-format-v3-to-v4/src/references.ts`
- **Purpose:** V3 local reference remapping after the interrupted-turn insertion.
- **Key abstractions:** `remapV3References(event, seq, mapping)`.
- **Data flow:** same shape as the v2→v3 remapper, plus the `image/offload` case (each target's `seq` is remapped).
- **Non-obvious design decisions:** `if (seq === event.seq) return event` — an event that did not move is returned **untouched**, so the remapper is a no-op for the common case.
- **Edge cases & failure handling:** a reference to a later or unmapped event throws "V3 reference must name an earlier source event".
- **Surprising:** the `image/offload` case is the only one where the remap reaches *inside* a list of objects.

#### `packages/session/session-format-v3-to-v4/src/relationships.ts`
- **Purpose:** the mandatory native V4 relationship validator (21.4 KB).
- **Key abstractions:** the `Relationships` class (one per artifact — "no state survives between reads"); `assertV4LifecycleRelationships(artifact, knownEventTypes)`.
- **Data flow:** `accept(event)` dispatches per event type, maintaining the open turn/step, the provider, the surface list, the protected head, the open compaction, the tool lifecycle map, the PTC dispatch map, the retry chain and the command set.
- **Non-obvious design decisions:**
  - **`STEP_EVENT_TYPES` = `system/message`, `developer/message`, `assistant/attempt`** — these must occur inside the *open* step. Note `assistant/message` is **not** in that set (it carries a message, and the V3-era step boundary differs).
  - **The protected system head** is enforced in three places: a surface replacement may not shadow it, a compaction may not shadow it, and only a `system/message` may replace it (and only exactly itself).
  - **The `developer` rule resolves the tool definition through `headerSeq`** and requires *exactly one* tool with that name in the referenced header, with a complete `description` and `parameters`.
  - **The tool lifecycle** requires `tool/call` to match the advertised call by id, name *and* the exact `arguments` string; a `tool/result` for a not-started call must be the exact `TOOL_NOT_STARTED` repair.
  - **The retry rule** uses `findLast` to find the prior attempt in the same `(turn, step, provider, policyKey)` chain and requires `attempt === prior + 1`; "llm/retry skips its policy attempt sequence" is the error.
  - **The compaction span check** compares the shadowed range against the *live surface list* with `isDeepStrictEqual` — the shadowed set must be exactly the current surface slice.
  - **A `turn/end` may not close over an open step** ("turn/end does not match the open turn with no open step"), and a turn boundary may not cross an open compaction.
- **Edge cases & failure handling:** `notStartedRepair` accepts both the `interrupted-tool-result-` form and the `forked-tool-result-` form, with the exact canonical sentence.
- **Surprising:** the file's opening comment — "incomplete tails retain their open transactions" — means the validator tolerates a log that simply *ends* mid-turn (a crashed session) as long as the events it does contain are consistent.

#### `packages/session/session-format-v3-to-v4/src/testing/validation.ts`
- **Purpose:** the native codec round-trip validator.
- **Key abstractions:** `assertReleasedV4Artifact(artifact)`.
- **Data flow:** encode header + every event, then decode them again through the *production* codec in `strict` mode.
- **Non-obvious design decisions:** it uses `SessionFormatEventCollector` — the same collector the production path uses — so the round trip is exact.
- **Surprising:** a 20-line file that is the strongest single guarantee in the package: *if it round-trips, the writer and reader agree*.

#### `packages/session/session-format/README.md` + `src/*`
- **Purpose:** the *pure* migration machinery — planning, lossless JSON checks, header-only migration, physical codec dispatch. No Cordis, no filesystem, no compression.
- **Key abstractions:** `createSessionFormatChain`, `createSessionFormatCatalog`, `defineSessionFormatMigration`, `SessionFormatEventCollector`, `sessionFormatLogFilename` / `parseSessionFormatLogFilename`.
- **Data flow:** a caller-owned parsed value flows through *stateful stages* "without intermediate artifact copies or freezing"; the catalog retains only bounded stage state and the final current events.
- **Non-obvious design decisions:**
  - **`defineSessionFormatMigration` enforces adjacency** — `toVersion` must be `fromVersion + 1`, and the chain constructor rejects a duplicate edge, a missing edge, or an edge beyond the current version *at construction time*. A gap is a build-time error, never a runtime surprise.
  - **A newer stored format is `unsupported`, not `malformed`** — `readHeader` returns four statuses (`current`, `migration-required`, `unsupported`, `malformed`) and a v5 file says "this build writes v4", never "corrupt".
  - **`snapshotSessionFormatJson` detaches *and* deep-freezes** every borrowed value, so a caller cannot mutate a header after validation.
  - **`sessionFormatCount` rejects `-0`** ("the JSON-unstable negative zero") — a tiny detail that stops `0` and `-0` from serializing differently.
  - **The canonical filename is `session.jsonl` for v0 and `session.vN.jsonl` after** — and the parser refuses temporary, uppercase, leading-zero, `.v0` and compression-suffixed names, so a staging file can never be mistaken for a committed generation.
- **Edge cases & failure handling:** a `SessionFormatMigrationStage` that changes its *predeclared* inherited cut is refused ("changed its predeclared inherited cut").
- **Surprising:** `src/chain.ts` classifies every stage failure as `SessionFormatUnsupportedMigrationError` — a migration that throws a plain `Error` still surfaces as a typed refusal, so callers never have to guess.

#### `packages/session/session-persistence/README.md`
- **Purpose:** the backend-neutral *seam* — the abstract service, the handle contract, the error vocabulary, and the shared validation helpers.
- **Key abstractions:** `SessionPersistence` (abstract `Service`), `SessionHandle`, `SessionPersistenceSnapshot`, `SessionStorageMetadata`, `SessionInspection`.
- **Data flow:** `create`/`open` → a handle; every read and write goes through the handle. There are **no id-addressed append or load methods** — the handle *is* the capability.
- **Non-obvious design decisions:**
  - **`append` is best-effort; `flush` is the barrier.** The seam states it twice: "only a resolved `flush` promises it survives a crash." A backend *may* buffer behind an append; the contract does not forbid it.
  - **Visibility is split:** a created session is observable *in this process* from the moment `create` resolves, even while the backend defers physical materialization — "a session that never materialized before a crash never existed."
  - **Freshness is a one-way promise:** once an `append` or `flush` resolves, reads *started afterwards* observe at least that prefix. Concurrent reads carry no ordering promise beyond the valid contiguous prefix.
  - **`eventState` distinguishes `detached` from `shared-frozen`** so a consumer knows whether it may mutate the returned events.
  - **Crash recovery is the reader's job, not the store's:** "Persistence returns the physically valid log; semantic repair belongs to the reader." Resume computes `interruptedTurnClosers` and appends them through the *same* handle.
- **Edge cases & failure handling:** five distinct refusals — `SessionAlreadyExistsError`, `SessionAlreadyOwnedError`, `SessionReadOnlyError`, `SessionHandleClosedError`, `SessionOwnershipLostError` — plus `SessionPersistenceCorruptionError` and `SessionFormatUnsupportedError`.
- **Surprising:** the seam guarantees single-writer ownership only *within one backend instance*; cross-process exclusion is provider-specific and the README says so out loud.

#### `packages/session/session-persistence/src/index.ts` / `handle.ts` / `errors.ts` / `revision.ts` / `storage-contract.ts`
- **Purpose:** the seam's implementation.
- **Key abstractions:** `SessionPersistence` (abstract class extending Cordis `Service`), `SessionHandle` (interface, `AsyncDisposable`), `SessionPersistenceRevision` (branded opaque token), `SessionLocation`.
- **Data flow:** `create/open` → handle; `handle.read(offset, length)` → `{ eventState, events }`; `handle.append(events)` → best-effort; `handle.flush()` → the barrier; `handle.close()` → idempotent, uncancellable teardown.
- **Non-obvious design decisions:**
  - **The revision token is explicitly *not* authoritative:** "equal revisions may be treated as an unchanged log; unequal revisions promise nothing." It exists for derived read-model caches, and "plays no part in open, read, or resume."
  - **`sessionFormatVersionRefusal` is direction-aware and user-facing:** a newer log says "the log was written by a newer harness — upgrade the harness to open it"; an older one says "this build ships no upgrade path for it." The rule is that a user must never see "corrupt" for a version mismatch.
  - **`validateStoredEvents` refuses an unknown event type *before* adopting anything** — "silently skipping an unknown required event could reconstruct a wrong session." The only exception is an envelope marked `ignorable: true`.
  - **One retired shape hides under a known type** and is handled explicitly: the removed delta codec's `request/header` `fallback` reason.
  - **`materializeAppendBatch` validates and deep-snapshots in ONE traversal** — "a check followed by a copy could reread accessors into a different record."
- **Edge cases & failure handling:** `assertContiguous` refuses a batch whose first `seq` is not the stored next-seq; `materializeCreateHeader` rejects a non-JSON metadata or a negative `createdAt`.
- **Surprising:** `import type {} from '@deepseek-ai/dsh-session-persistence'`-style empty type imports appear purely to keep a package's TS project reference in the graph.

#### `packages/session/session-persistence-jsonl/README.md`
- **Purpose:** the shipped backend — one append-only file per session, immutable historical generations, optional zstd.
- **Key abstractions:** `JsonlSessionPersistence` (private class), `JsonlSessionHandle`, `JsonlBackendTracker`, `SessionWriteLease`, the generation runtime.
- **Data flow:** `session/event` → the handle's routed buffer → a 200 ms batching window → `persistBatch` → a compressed frame → `fsync`; `session/flush` → drain + `flush()`.
- **Non-obvious design decisions:**
  - **`root` is required with no default** — "a default of `process.cwd()` would scatter session files as the process's cwd changes (bash calls, subprocesses)."
  - **Materialization is lazy and atomic:** the first append writes a synced temp and publishes it with `link()` + a parent-directory `fsync`, because "`link()` fails with EEXIST if the final path already exists, so two processes materializing the same id concurrently cannot clobber each other. `rename()` would silently overwrite."
  - **A torn tail is repaired, not returned:** the write path truncates the torn bytes and *durably rewrites* the complete records recovered from them before its first new batch.
  - **The write path is a 200 ms batching window** (`LIVE_WRITE_BATCH_MAX_DELAY_MS`), and a background drain failure *retains* the events in order, *pauses* the automatic path, and is logged; the next explicit flush retries loudly.
  - **The physical revision is `dev:ino:size:mtimeNs:ctimeNs`**; a *historical* revision additionally fingerprints the whole corpus (a SHA-256 over the sorted selected paths and their revisions) so a child change invalidates the parent's cached logical events.
- **Edge cases & failure handling:** the backend refuses a root that already holds the *other* encoding, refuses the obsolete flat-file layout, and refuses to publish over an existing committed log.
- **Surprising:** "Verification accepts a successful Worker response only after the Worker exits naturally with code 0" — a worker that answers and then crashes does not count as a success.

#### `packages/session/session-persistence-jsonl/src/index.ts`
- **Purpose:** the backend class — the largest file in the shard (75 KB / 1 837 lines).
- **Key abstractions:** `JsonlSessionPersistence extends SessionPersistence`; the `Config` schema (`root`, `compression`, `listConcurrency`); `StoredLog` = `CurrentStoredLog | PreparedStoredLog`; `MigrationPreparation`; `GenerationHeader`.
- **Data flow:** `create` → `registerCreated` (pending, no disk footprint) → a handle; `open('write')` → claim → kernel lease → `requireStoredLog` (migrate if historical) → publish → handle; `open('read')` → `requireStoredLog` only.
- **Non-obvious design decisions:**
  - **A created session has *no filesystem footprint* until its first materializing write** — the cross-process lock is acquired "right before the first log bytes publish."
  - **The `coldLogMemo` is a 2-entry LRU** keyed by session id and guarded by the *revision* — "a cold observation and the resume that immediately follows it reuse one parsed log." Any local mutation invalidates the entry; a foreign write misses through the revision guard.
  - **A historical preparation is keyed by *file revision*, not by session id** — a changed source starts a fresh preparation; a stale one is refused.
  - **The preparation's `publish()` is idempotent** — the same promise is returned on every call, "every call shares the same success or failure."
  - **`list()` snapshots the pending set *before* scanning storage**, so a session whose first append lands mid-scan is still in the snapshot — "create-to-list visibility never has a hole."
  - **The listing limiter is shared** across `list()`, the root-encoding check and the historical fingerprints, and results are re-ordered into *input* order so the first failure a caller sees matches a sequential loop.
  - **The "raw log" path is carried in every refusal** (`SessionFormatUnsupportedError` + `SessionLocation`), so a user can find the file the build refused.
  - **`encodeMaterialization` keeps the header and the first batch in *separate* zstd frames** — the header frame is independently decodable, which is what makes a header-only read cheap.
- **Edge cases & failure handling:** an append that fails mid-write **rolls the file back** to its previous length, "because leaving partial bytes would create duplicate sequence numbers."
- **Surprising:** `this.root = resolve(config.root)` is resolved *once* in the constructor, "so later `process.cwd()` changes cannot split one backend across roots."

#### `packages/session/session-persistence-jsonl/src/storage.ts`
- **Purpose:** the concrete handle and the in-process bookkeeping.
- **Key abstractions:** `JsonlSessionHandle implements SessionHandle`; `JsonlBackendTracker`; `JsonlHandleStorage` (the file primitives the handle drives).
- **Data flow:** `session/event` → `enqueueLive` (a `structuredClone`) → the 200 ms timer → `drainLive` → the per-handle promise chain → `persistContiguous`.
- **Non-obvious design decisions:**
  - **Every mutation serializes on a per-handle promise chain** (`this.chain.then(op)`), and the chain *never rejects* — `this.chain = next.catch(() => {})` — so one failed append does not poison the chain.
  - **The batch is snapshotted *before* it is queued**, "so the checked value is exactly the value persisted."
  - **Reads are monotonic per handle:** a log that shrank below a previously observed prefix throws rather than silently going backwards.
  - **A failed drain *re-queues the batch in order* and pauses the automatic timer**; the next explicit flush retries and rejects loudly.
  - **`close()` drains in a loop** until a full pass leaves the buffer empty, "because producers on other fibers may still publish while close waits for in-flight mutations."
  - **Close frees the in-process claim no matter how the kernel-lock release fares** — "a skipped `releaseHandle` would wedge the id in this process behind a lock the kernel may already have dropped."
- **Edge cases & failure handling:** a drain failure and a lock-release failure together reject as one `AggregateError`.
- **Surprising:** the tracker is the *same object* the plugin owns, and the backend service class is created inside the plugin's effect — the handle outlives the service, not the other way round.

#### `packages/session/session-persistence-jsonl/src/format.ts`
- **Purpose:** path derivation, header encoding, and the incremental current-record scanner.
- **Key abstractions:** `encodeSegment`, `projectKey`, `projectDir`, `sessionDir`, `generationLogPath`, `logPath`, `toHeaderLine`, `SessionLogScanner`, `scanLog`, `parseGenerationLogFilename`.
- **Data flow:** `SessionLogScanner.write(chunk)` → newline search on the raw buffer → one complete line per record → `restore.decodeRow` → `finish()` → `{ meta, inheritedEventCount, events, committedBytes }`.
- **Non-obvious design decisions:**
  - **`encodeSegment` is injective over ALL UTF-16 strings, including lone surrogates** — safe code units stay literal, everything else becomes `~XXXX`, and `.`/`..` are special-cased. A `SessionId` is an *unvalidated branded string*, so it "MUST be encoded before use in a path — no traversal, no collision."
  - **`projectKey` is deliberately lossy** (separators collapse to `-`, truncation to 251 chars) "following the common human-navigable project-directory convention" — and the doc says so, so nobody mistakes it for an identity.
  - **The scanner keeps only the *incomplete* final record** and tracks `committedBytes` — the byte offset a repair may truncate to.
  - **`refuseForeignFormatVersion` runs *before* the header shape check**, "so its user must see 'upgrade the harness', never 'corrupt session log'."
  - **Row-level V4 admission runs before the recoverable policy** — "Owned structural refusal must precede its recoverable-tail suppression, independently of the strict decoder state."
- **Edge cases & failure handling:** a final record without a newline is a torn tail; the first issue is remembered and re-thrown at the next `turn/end`.
- **Surprising:** `SessionLogScanner` is the *only* place that turns physical rows into logical events for the current generation — the historical path uses the catalog instead.

#### `packages/session/session-persistence-jsonl/src/generation.ts`
- **Purpose:** durable whole-generation publication (the migration write path).
- **Key abstractions:** `prepareJsonlMigration`, `PreparedJsonlMigration`, `JsonlGenerationRuntime`, `JsonlPhysicalIdentity`, `JsonlExpectedPrefix`, `JsonlGenerationSourceChangedError`, `JsonlGenerationTargetConflictError`, `JsonlGenerationUnsupportedMigrationError`.
- **Data flow:** `readStableSnapshot` → `decodeStreamingMigration` (streaming parse + migrate) → `writeSyncedTemp` (encode into a temp, fsync) → `verifyCurrentFile` (a Worker) → re-check the source identity → `publishCurrentExclusive` (`link()` on POSIX, `MoveFileExW` on Windows) → remove the temp.
- **Non-obvious design decisions:**
  - **The migration is *streaming*** — 1 MiB main-thread slices with a 500 ms yield, retaining only the final current events, the bounded decoder state and the required sequence-remap table.
  - **The staged file is verified in a Worker Thread before publication**, and the verifier's digest and byte count must equal the staged ones.
  - **Publication is exclusive**: `link()` (POSIX) or `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` (Windows) — a second, different publication *loses* and is then verified against the winner; an identical winner is accepted.
  - **The source is re-checked immediately before publication** (`identity(beforePublish) !== identity(sourceIdentity)` → `JsonlGenerationSourceChangedError`) — "a historical source changed after its single decode and migration pass."
  - **The current generation is verified *fully*** — the embedded Assistant streams are re-expanded and compared against the summarised message content, usage and replay state.
  - **The staging file name is random** (`session.migration.<token><suffix>.tmp`) and opened with `'wx'` — a collision retries.
- **Edge cases & failure handling:** a failed write removes the temp *without hiding the original failure*; a failed cleanup after a failure raises an `AggregateError` of both.
- **Surprising:** the same module owns the *read* side (`readDecodedJsonlSource`) — one streaming parser serves both the migration read and the current read.

#### `packages/session/session-persistence-jsonl/src/lease.ts`
- **Purpose:** the cross-process write-ownership lock.
- **Key abstractions:** `SessionWriteLease`, `LEASE_FILENAME = 'session.lock'`.
- **Data flow:** `acquire(dir, id)` → `mkdir(dir, { mode: 0o700 })` → POSIX `flock(LOCK_EX|LOCK_NB)` on `session.lock` (or a named Win32 semaphore) → verify the locked **inode** is still the file at the path → hold until `release()`.
- **Non-obvious design decisions:**
  - **The kernel is the arbiter, and the lock file is *never a handle***: POSIX takes a `flock(2)`; Windows takes a named kernel semaphore "derived from that path — never a file lock or handle, so readers, searches, and directory removal proceed freely while the lock is held."
  - **The inode is verified after locking** — "a POSIX lock names an inode, not a path… an unlinked-and-recreated lock file carries a fresh inode, and a lock on the orphaned one proves nothing." The holder retries (3 attempts) when the inode moved.
  - **There is deliberately *no lease expiry*** — "a live but wedged holder keeps the lock until its process exits: there is deliberately no expiry that could expropriate a stalled writer whose resumed appends would tear the log."
  - **The lock file is never removed on release** — "the surviving file keeps the stable inode later lockers verify against."
  - **A crashed holder never blocks a successor** — the kernel releases the lock when the descriptor closes, "including on any process death."
- **Edge cases & failure handling:** `EAGAIN`/`EWOULDBLOCK` map to `SessionAlreadyOwnedError`; anything else propagates.
- **Surprising:** removing a live session's lock file on POSIX *forfeits* the exclusion — the README says so, and nothing in the harness does it.

#### `packages/session/session-persistence-jsonl/src/win32.ts`
- **Purpose:** the Windows durable-namespace helpers (no parent-directory fsync in Node).
- **Key abstractions:** `publishNewFileWin32`, `acquireLockHandleWin32`, `releaseLockHandleWin32`, `ensureDurableDirectoryWin32`.
- **Data flow:** `MoveFileExW(existing, replacement, MOVEFILE_WRITE_THROUGH)` publishes a staging object; a named semaphore `Local\dsh-session-lock-<sha256(path)>` is the write lock.
- **Non-obvious design decisions:**
  - **Windows has no lock file at all** — the semaphore name is derived from the SHA-256 of the lower-cased resolved path, so a case-insensitive filesystem still yields one name.
  - **The `MoveFileExW` flags deliberately exclude replacement and cross-volume copy** — "without replacement or cross-volume copy fallback."
  - **Directories are created as a random staging sibling and then moved**, so a legal 255-byte target name does not make `mkdtemp`'s sibling name too long.
  - **Win32 error codes are mapped to Node errno codes** (`ERROR_SHARING_VIOLATION` → `EBUSY`, etc.).
- **Edge cases & failure handling:** a race where another creator won is accepted only after verifying the winner is a directory.
- **Surprising:** the Win32 API is loaded **lazily through `koffi`** so non-Windows processes never load the FFI library.

#### `packages/session/session-persistence-jsonl/src/zstd.ts` + `zstd-private-decoder.ts` + `zstd-public-decoder.ts`
- **Purpose:** Zstandard frame primitives for a *concatenated-frame container*.
- **Key abstractions:** `scanZstdFrames`, `compressZstdFrame`, `decompressZstdFrame`, `decompressZstdPrefix`, `createZstdFrameDecoder`, `ZstdFrameDecoder`, `ZstdFrameRange`.
- **Data flow:** the artifact is a concatenation of independent checksummed frames; the first frame is the header, each later frame is one append batch.
- **Non-obvious design decisions:**
  - **`scanZstdFrames` parses the frame structure *without decompressing*** — it walks the magic, the frame header, the block headers and the optional checksum, so a metadata-only read costs no decompression. It returns the start of a torn final frame instead of failing.
  - **The backend owns the container** so it can "append and recover batches without exposing compression mechanics through the persistence seam."
  - **A *private* Node decoder is used when the runtime's private stream shape matches** — `NodePrivateZstdFrameDecoder` reaches into `stream._handle.writeSync` to reuse one native context across frames; the public one-shot API is the fallback. The probe is defensive: it checks `_handle`, `_writeState`, `_defaultFlushFlag` and a `kError` symbol before committing.
  - **The public decoder is a genuine fallback**, not a stub: `PublicZstdFrameDecoder` uses `zstdDecompressSync` per frame.
- **Edge cases & failure handling:** a structurally incomplete final frame is distinguishable from an invalid complete structure; a checksum failure in a complete frame is corruption, never a torn tail.
- **Surprising:** `decompressZstdPrefix` uses `ZSTD_e_flush` to recover plaintext from an incomplete frame — "callers must establish the torn frame boundary before using this helper."

#### `packages/session/session-persistence-jsonl/src/catalog-migration.ts` / `migration-verifier.ts` / `worker.ts`
- **Purpose:** collecting the child evidence a V3→V4 migration needs, and verifying a staged generation in isolation.
- **Key abstractions:** `prepareCatalogFacts`, `PreparedCatalogFacts.validate`, `verifyCurrentGenerationInWorker`, `VerificationScheduler`.
- **Data flow:** the parent's preparation reads each *direct child*'s own log through the **historical** catalog (V0–V3), extracts the child's own `subagent/descriptor`, and retains `{ childId, childCreatedAt, descriptorCount, descriptor, sourcePath }`. The staged generation is verified in a Worker Thread.
- **Non-obvious design decisions:**
  - **Child discovery never recurses**: a child's catalog is *not* prepared, and no child successor is published.
  - **The child evidence is re-validated by physical identity** (dev/ino/size/mtime/ctime) before *and* after preparation — "a repaired child invalidates stale preparation."
  - **The verifier runs at most 2 at a time** (`MAX_CONCURRENT_VERIFIERS = 2`) — a process-wide memory bound.
  - **A verifier's permit is held until the Worker exits naturally**, and a waiter is handed the permit directly.
  - **The verifier accepts a response only after a natural exit code 0**; a nonzero exit after a valid response is a failure.
- **Edge cases & failure handling:** an unreadable child produces a *warning* and an `unavailable` fact rather than failing the parent; a *conflicting* child fact (different `childCreatedAt`, `mode` or `label`) refuses the migration.
- **Surprising:** the child facts are gathered through the *historical* catalog, because the child's own log may be a V0/V1/V2 file — the current catalog would refuse it.

#### `packages/session/session-persistence-jsonl/src/testing/generation.ts`
- **Purpose:** a test-only factory for the generation runtime with deterministic filesystem, platform and race seams.
- **What it pins:** the dependency-injection surface (`JsonlGenerationRuntimeOverrides`) that the race tests use.

#### `packages/session/session-projection/README.md` + `src/index.ts` + `src/types.ts`
- **Purpose:** the projection *registry* — the framework that drives domain folds over committed events.
- **Key abstractions:** `ProjectionDefinition`, `SessionProjectionRegistry`, `ProjectionSnapshot`, `ProjectionCheckpoint`, `ProjectionChangeListener`.
- **Data flow:** `session/event` → every registered unit's `apply(state, event)` → a changed state reference → `wire.view(state)` → a changed view reference (`Object.is`) → the change feed.
- **Non-obvious design decisions:**
  - **The whole-value rule** (stated in the module header and load-bearing): "a state-carrying log event MUST carry the complete post-change state, never a bare delta — it keeps every unit's transition trivially cheap and every served value self-describing."
  - **Two `Object.is` gates:** the first suppresses work when the *state* reference is unchanged; the second suppresses *publication* when the raw *view* reference is unchanged. An object view must therefore reuse its reference.
  - **`stateVersion` is the cache invalidation token** — bump it whenever the serialized fields or the fold semantics change, and stale rows are *discarded*, never migrated.
  - **`asOfSeq` is a shared watermark** — every value in a snapshot reflects the same log position, "which is what makes `asOfSeq` one consistent cut."
  - **`restoreFloor` anchors the tail read *one event below* the lowest usable watermark** — "the tail then proves how far the stored log still extends, so `restore` can detect a log that shrank below a row's watermark (crash-repair truncation)."
  - **`checkpoint()` returns a `structuredClone`** — "never the live cell reference: the watermark cache is this registry's authoritative mutable state, and a caller reaching the live reference could corrupt every subsequent snapshot."
  - **Registration is an effect, and registrants sharing a key are *counted*** — "the same tool package mounted in N agent presets registers N times, and the key survives until the last one unloads."
  - **Units must be synchronous** — "an async unit would tear the carriers' consistency cut." An accidentally async `view` returns a Promise and fails `viewSchema.parse`.
- **Edge cases & failure handling:** a `restore` whose checkpoint row is unusable while `baseSeq > 0` **throws** ("re-read from seq 0") rather than serving a wrong value.
- **Surprising:** the type table (`SessionProjectionMap` / `SessionProjectionStateMap`) is an **empty interface that other packages declare-merge into** — a compile-time plugin registry, with a separate `./types` outlet so a client aggregate does not drag in the host's Cordis context.

#### `packages/session/session-projection-cache/README.md` + `src/index.ts` + `src/spec.ts`
- **Purpose:** the durable checkpoint store for projection state.
- **Key abstractions:** `SessionProjectionCache`, `projectionCacheDomainSpec`, `checkpointRecord`, `checkpointRow`, `checkpointIdentity`.
- **Data flow:** `session/event` → a dirty counter + an interval timer → `flushSoft` → `write(session)` → **flush the session's events durably first**, then `put` the record on the domain's write chain.
- **Non-obvious design decisions:**
  - **The log leads and the cache follows** — the checkpoint cut is taken *before* `ctx.sessions.flush(session)`, "so a crash can leave the cache behind the log (longer tail replay) but never ahead of it (phantom values folded from events no stored log contains)." This ordering is the single most important property of the package.
  - **Three mandatory write points** (session creation, `turn/end`, session disposal) plus two throttles; the throttles are deployment config, the mandatory points are policy.
  - **Every background write is fail-soft** — "a lost write costs a longer tail replay on the next cold read."
  - **A `ver` mismatch discards the row; it is never migrated.**
  - **The record is bound to a *lifecycle identity*** (`formatVersion`, `createdAt`, `cwd`, `isSeeded`) — "a session id names a slot, not a lifecycle." The fold faces additionally require the exact `inheritedEventCount`.
  - **The listing read is zero-I/O** and serves rows "as stale as the last durable checkpoint but never wrong"; the client is told the block is `cached` and every later live value supersedes it.
  - **`cachedPredecessorTitle` is the one narrow cross-version exception** — title text is invariant across the adjacent format edges, so a predecessor record may expose only its title row.
  - **`invalidRecords: 'backup-and-skip'`** — a record that fails the schema is moved aside as `<id>.json.bak.<stamp>` and served as uncached; "it must never cost the boot."
- **Edge cases & failure handling:** a unit state that is not losslessly JSON-serializable throws a `TypeError` at the write boundary, not at the read.
- **Surprising:** the cache "does not depend on a session-persistence backend, call `locate`, or inspect per-session directories" — it is a *pure* derived-data store that happens to be keyed by session id.

#### `packages/session/session-stats/README.md` + `src/*`
- **Purpose:** the `sessionStats` projection unit — whole-log turn/step counts and wall times.
- **Key abstractions:** `sessionStatsProjectionDefinition` (`key: 'sessionStats'`, `stateVersion: 1`); the `SessionStatsProjection` type.
- **Data flow:** `step/start` → open the boundary; `assistant/attempt` → first-token time; `assistant/message` → close the boundary and accrue; `tool/call`/`tool/result` → pair by callId; `step/end` → count.
- **Non-obvious design decisions:**
  - **`step/end` — not `assistant/message` — is the counted step event** because "the loop appends exactly one per entered step, in a `finally`"; counting assembled messages would overcount max-tokens usage-host messages and undercount cancelled steps.
  - **A cancelled step is *counted but untimed*** — "no assistant message assembles, so its partial stream time stays uncounted in every time figure."
  - **The tool-call map is an own-key check** — "a prototype property name (`constructor`, `toString`) on a result with no recorded call must read as unmatched, not as an inherited function that would poison `toolMs` with `NaN`."
  - **Unresolved calls are dropped at `turn/end`** — "results always land within their turn, so drop the leftovers instead of growing persisted state forever."
- **Edge cases & failure handling:** malformed usage reports are ignored, exactly as the client window fold guards node usage.
- **Surprising:** the fold mirrors the *client window fold* field by field, so a client without the unit can fall back to it wholesale.

#### `packages/session/session-turn-outline/README.md` + `src/*`
- **Purpose:** the `turnOutline` projection unit — a whole-session list of turns with bounded previews.
- **Key abstractions:** `turnOutlineProjectionDefinition` (`stateVersion: 2`); `TurnOutlineEntry`.
- **Data flow:** `turn/start` → append an entry; the first human `user/message` → fill the prompt; `assistant/message` → overwrite a *draft*; `turn/end` → commit the draft as the response.
- **Non-obvious design decisions:**
  - **`turn/start` anchors the entry, not the prompt** — "its seq is the load-through target for a jump: the loop logs `turn/start` before the turn's prompt and steps, so a window paged back through that seq contains the whole turn."
  - **The response is a *draft* until `turn/end`** — "the change feed's raw-view identity gate keeps draft-only changes quiet, so the outline pushes at most three times per turn (boundary, prompt, response)."
  - **Only `user`-source messages fill the prompt** — "injected context and tool results never leak into navigation."
  - **The preview is bounded *per block*** — "a single multi-megabyte block must not be concatenated (and regex-normalized) whole for a preview this short."
  - **A `turn/start` that does not advance the turn number is skipped**, keeping the outline sorted.
- **Edge cases & failure handling:** a turn with no eligible text keeps `''` and is "navigable but labeled by number."
- **Surprising:** the preview budgets (50 / 120 characters) are chosen to match the chat rail's card clamps — "so a turn shows the same words before and after its events load."

#### `packages/session/session-telemetry/README.md` + `src/index.ts` + `src/coordinator.ts`
- **Purpose:** the telemetry *capture* seam.
- **Key abstractions:** `SessionTelemetryBackend` (abstract `Service`), `SessionTelemetrySink`, `SessionTelemetryRecord`, `SessionTelemetryCoordinator`, the `session-telemetry/record` waterfall.
- **Data flow:** `session/event` → a deep copy of the envelope + a deep copy of the body → the redaction waterfall → `backend.emit(record)` → the handoff cursor advances.
- **Non-obvious design decisions:**
  - **The package ships *no* redaction rules** — "with no listener mounted, records reach the backend exactly as captured, so exported data is as clean as the rules a deployment mounts." A deployment owns its own rule set.
  - **A throwing redaction rule withholds that one record (fail-closed) and never reaches the agent loop.**
  - **Every capture step is contained** — cordis' `emit` is stop-on-throw, so "a throwing listener would starve every subscriber registered after this plugin."
  - **The handoff cursor is module-scope ambient state** (`WeakMap<Session, seq>`) — a documented exception to the registrations-are-effects rule, because cordis has no HMR state-handover API and the `Session` object is the only lifetime that lets a re-adopting fiber resume.
  - **The cursor marks *handed off*, not *delivered*.**
  - **Severity is pre-mapped at capture** — `error` for `tool/result.isError` and `turn/end` error reasons and `agent-error`; `info` otherwise — "so a receiver can alert with zero configuration."
  - **Attributes are deliberately minimal** — "anything recoverable from the body is intentionally NOT duplicated here."
- **Edge cases & failure handling:** on-demand capture contains failures *per event*, so one rejected record does not stop the replay.
- **Surprising:** the `handoffCursor` is the only mutable module-level state in the whole session group, and the reason is written down at length.

#### `packages/session/session-telemetry-otel/README.md` + `src/index.ts`
- **Purpose:** the OpenTelemetry backend.
- **Key abstractions:** `OpenTelemetrySessionBackend extends SessionTelemetryBackend`; `SessionTelemetryMode` (`FEEDBACK_ONLY` | `DISABLED`); `Config`.
- **Data flow:** a *new explicit feedback* authorizes the unhanded prefix → `coordinator.captureSession(session, throughSeq)` → the OTel reporter → a byte-bounded HTTP request.
- **Non-obvious design decisions:**
  - **`FULL` is *rejected*, not an alias** — the sharing vocabulary is `full | feedback-only | disabled`, but the plugin only offers the last two.
  - **Direct `ctx.sessionTelemetry.emit()` calls are no-ops in every mode** — "cannot bypass feedback authorization."
  - **Inherited parent feedback does not authorize a child export** — the child needs new feedback of its own.
  - **The `DISABLED` mode constructs no transport at all** and only warns when recorded feedback stays local.
  - **The mode is validated at load**: an invalid URL, a non-http(s) protocol, a non-positive batch size, or a shutdown deadline above the timer limit all fail *before* the reporter is allocated.
  - **The shutdown deadline is outer and absolute** — at expiry the remaining queue is abandoned and no further request may start, "while an active request may still settle."
- **Edge cases & failure handling:** a record whose redaction removed `sourceEvent` is withheld with a diagnostic rather than uploaded without identity.
- **Surprising:** the plugin *re-implements* the feedback authorization check itself (`isFeedback`) rather than trusting the seam — the seam's `capture` is on-demand, and only the backend may authorize.

#### `packages/session/session-title/README.md` + `src/index.ts` + `src/types.ts` + `src/normalize.ts` + `src/client.ts`
- **Purpose:** the log-backed title service.
- **Key abstractions:** `SessionTitleService`, `SessionTitleProvider`, `SessionTitleProviderRequest`, `SessionTitleProviderResult`, `SessionTitleInvalidError`, `titleProjectionDefinition`, `foldSessionTitle`.
- **Data flow:** a human `user/message` → the `titleInput` projection (first + count + last seq) → a scheduled revision → a provider call → a `session/title` event → the `title` projection (latest wins).
- **Non-obvious design decisions:**
  - **Titles are log-only state** — `session/title` "never enters the model surface, `deriveMessages()`, system prompt, tool schemas, or request prefix." A title costs zero tokens.
  - **A user rename *pins* the title** — later user messages schedule no automatic revision, and `refresh()` is the deliberate unpin.
  - **Automatic work never delays the main response** — it runs detached, and a late completion appends a standalone log-only event "without opening a turn."
  - **Supersession is by *revision counter* + `AbortController`** — "a completion whose provider, revision, session, or signal is stale cannot append." `assertCurrent` throws if the state changed without cancellation.
  - **At most one provider** — "a second registration throws until the first provider's disposal starts."
  - **The provider must cite the exact source seqs** it used, and the service checks that they are *unique, ordered* seqs *from the request* — a provider cannot attribute a title to a message it did not see.
  - **Title text is sanitised aggressively**: OSC/CSI/ESC sequences, C0/C1 controls, and *directional and invisible controls* (zero-width, bidi overrides, BOM) are removed, because "Directional and invisible controls that can make a displayed title deceptive." Truncation is UTF-8 byte-safe and never splits a code point.
- **Edge cases & failure handling:** a title that normalises to empty throws `SessionTitleInvalidError` — the one failure that blames the input; liveness failures stay plain `Error`s.
- **Surprising:** the fallback title is derived from the *first* eligible message only, and the whole eligible prefix is scanned from the log at call time so the O(1) `titleInput` projection never has to hold it.

#### `packages/session/session-title-llm/README.md` + `src/index.ts`
- **Purpose:** the shared *execution* policy for model-backed title providers.
- **Key abstractions:** `executeSessionTitleLlm`, `resolveSessionTitleLlmConfig`, `SessionTitleLlmConfigSchema`, `SessionTitleLlmPreparedRequest`, `SessionTitleLlmResponse`, `SESSION_TITLE_TIMEOUT_CODE`.
- **Data flow:** the provider prepares `{ system, input, messageSeqs, selectReasoningEffort }` → the executor checks the byte budget → `ctx.llm.prepareCall` → the `session/title-llm-request` event is appended → the stream is assembled by a `BlockAssembler`.
- **Non-obvious design decisions:**
  - **The split is deliberate:** the provider owns the *wording*; the executor owns the *route, bounds, cancellation, logging and assembly* — "so operational behavior cannot drift."
  - **The input is *measured*, not truncated** — "it rejects prepared input over `maxInputBytes` rather than truncating it."
  - **The deadline is rechecked while streaming and after it completes** — "so a late successful result cannot be accepted even if an interceptor or adapter ignores abort."
  - **The exact request is recorded *before* dispatch** — "Generation failures preserve the request record."
  - **The output cap is independent of the conversation's cap.**
  - **The provider/model override must be supplied as a pair** or not at all; without it the route comes from the session's logged `request/header`.
  - **The provider chooses the reasoning effort; the executor never does.**
- **Edge cases & failure handling:** `error` and `aborted` finish reasons throw; `stop`, `tool-calls` and `max-tokens` are returned for the *provider* to accept or reject.
- **Surprising:** the request is recorded with `purpose: 'session-title'` — "attribution only" — and does not enter conversation history.

#### `packages/session/session-title-first-prompt-llm/README.md` + `src/index.ts`
- **Purpose:** the shipped `first-prompt` title provider.
- **Key abstractions:** `Config` (`targetWords`, `targetCjkCharacters` + the shared execution controls); `apply(ctx, config)`.
- **Data flow:** the title service schedules a revision → the provider frames the first eligible message as JSON → `executeSessionTitleLlm` → the output is parsed into a title.
- **Non-obvious design decisions:**
  - **The framing is JSON, not prose** — "Frame the selected messages as JSON so user text cannot break structural delimiters."
  - **The system instruction forbids Markdown and code**, asks for the language of the messages, and has a **separate target for CJK** (`targetCjkCharacters`) — the length budget is language-aware.
  - **The output parser strips a whole-line `**Title**` emphasis wrapper** but keeps emphasis inside a longer line.
  - **The provider picks the *least supported* reasoning effort** — `model.reasoning?.efforts[0]?.id`.
  - **A `tool-calls` or `max-tokens` finish is refused** even when the blocks contain only text.
- **Edge cases & failure handling:** an empty provider request throws at the provider's own boundary.
- **Surprising:** "If the messages give little to name, still return a short best-effort title, such as Greeting, instead of explaining." — an explicit instruction to never return an empty title.

#### `packages/session/session-log-deepseek/README.md` + `src/index.ts` + `src/types.ts`
- **Purpose:** the incremental session-log upload as official DeepSeek request metadata.
- **Key abstractions:** `acceptedThrough`, `DeepSeekSessionLogExtension`, `DeepSeekSessionLogWireEvent`, `DeepSeekSessionLogWireHeader`.
- **Data flow:** `acceptedThrough(session)` folds the acceptance watermark → the pending events after it are packed into the *longest* prefix that fits `maxBytes` → the DeepSeek adapter calls `accept()` after HTTP 2xx → a `session-log-deepseek/delivery-accepted` event is appended.
- **Non-obvious design decisions:**
  - **The acceptance watermark lives in the canonical log**, "so restart recovery can conservatively resend uncertain tails without maintaining another store."
  - **The failure direction is at-least-once:** "uncertainty creates duplicates, never a skipped sequence." A crash after a 2xx but before the watermark persists replays a range.
  - **The watermark only counts a marker for the *exact* session id *and* format generation** — a forked session ignores the parent's watermark.
  - **The maximum matching `throughSeq` wins** so an out-of-order concurrent acceptance cannot regress the cursor.
  - **The byte budget is computed on the *serialized* field**, including the header and the numeric envelope fields; an event that alone exceeds the budget is skipped and **logged once per blocking event** ("this session's upload stays at event N until maxBytes admits it").
  - **The field is a sibling of the model-input fields** — it never enters `messages`, the system prompt or the tool schemas.
- **Edge cases & failure handling:** a provider that rejects the request because of the field fails the model request and leaves the cursor unchanged "instead of truncating the log."
- **Surprising:** the plugin performs **no independent I/O** — the ordinary checkpoint policy persists the watermark at the next semantic checkpoint.

#### `packages/session/working-directory/README.md` + `src/index.ts`
- **Purpose:** the per-session working directory.
- **Key abstractions:** `WorkingDirectoryService`; the `working-directory/change` event; the `workingDirectory` projection.
- **Data flow:** the effective directory is *read from the projection* (so a cold reader sees it without an Agent) → a change appends the event and queues a user-context notice → the system prompt contributes `Current working directory: "<abs>"`.
- **Non-obvious design decisions:**
  - **The *header* keeps the original project; the *projection* holds the effective directory** — "the header continues to identify the original project."
  - **A missing directory restores the original project** when it still exists, and the recovery is *committed before fulfillment*.
  - **A notice failure is warned, not thrown** — "the operation returns the committed directory and logs a warning; the next request or resume still receives the required directory context."
  - **Changes serialize per Session** and check cancellation and Agent lifetime before committing.
  - **Existing processes and sandbox grants keep their independent ownership** — `cd` does not move a running shell.
- **Edge cases & failure handling:** when both the current and the original directory are unavailable, "prompt assembly rejects every model turn, including chat-only turns."
- **Surprising:** the directory is exposed as **user context, not a system-prompt directory** — and it stays enabled even when optional runtime context is disabled.

#### `packages/session/tool-working-directory/README.md` + `src/index.ts`
- **Purpose:** the one tool that reads or changes the Session's directory.
- **Key abstractions:** the `working_directory` tool (`{ cd?: string }` → `{ cwd: string }`).
- **Data flow:** the tool delegates entirely to `ctx.workingDirectory.ensure` / `.set`.
- **Non-obvious design decisions:** the tool's description states the boundary the model needs — "Existing shells and running processes keep their own directories."
- **Edge cases & failure handling:** the tool requires an Agent; it changes neither processes nor write permissions.
- **Surprising:** the tool has *no* configuration fields at all, and its result is a single absolute path that can be handed to other tools.

---

### Tier 2 — tests, docs and configs

**How these were read.** Every test file was opened and its `describe`/`it` index extracted; the assertions themselves were read for the load-bearing suites (the checkpoint-policy spec, the catalog spec, the V2→V3 regression suites, the V3→V4 codec/relationship/developer suites, the JSONL lease/lease-two-process/migration-refusal specs, the persistence contract, the projection registry, the projection-cache cache spec, the title provider/rename specs, the telemetry redact spec, the turn-outline and stats projections, the working-directory spec). The remaining suites were read as their test-title index. Every English `README.md`, every `package.json`, `tsconfig.json`, `tsdown.config.ts` and `locale/*.json` was read in full. Every `README.zh.md` was opened and confirmed to be the Chinese counterpart of its English sibling (same section skeleton, same code blocks, same tables). Every `README.i18n.yaml` was opened and confirmed to be a generated per-heading bilingual hash record.

#### Test suites (113 files)

| File | What it pins |
|---|---|
| `session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts` | Flush ordering (flush → adapter / flush → tool body), fail-closed on a rejecting store, `ABORTED_BEFORE_DISPATCH` shape, nested dispatch does **not** re-checkpoint, plugin namespace shape. |
| `session-checkpoint-policy/tests/crash-recovery.e2e.ts` | Real SIGKILL at a failpoint; the durable log is read back and balanced; the tail is `turn/end { interrupted }`; the tool result carries `TOOL_OUTCOME_UNKNOWN` and "Do not retry blindly." |
| `session-checkpoint-policy/tests/fixtures/crash-child.ts` | The crashing child: the adapter writes the failpoint then hangs; the tool records its external effect and never returns. |
| `session-format-catalog/tests/catalog.spec.ts` | The whole chain: immutability of migration input, the ignorable-vs-unclassified distinction, the PTC rename cascade with seq renumbering, the migrate→encode→decode round trip. |
| `session-format-catalog/tests/children.spec.ts` | The static catalog refuses a V3 body without explicit child facts; child evidence is bound per catalog; interleaved restores do not contaminate each other. |
| `session-format-catalog/tests/current.spec.ts` | Version skew is reported first; `request/header.reason` vocabulary; `startsSeries` must be true when present. |
| `session-format-catalog/tests/developer-history.spec.ts` | Tool add/remove/re-add history survives restore and fork; mutating the producer's schema objects after append does not change the restored state (the log stores a copy). |
| `session-format-catalog/tests/preset-migration.spec.ts` | The `code` → `ptc` preset rename across v0–v2; a V3 custom preset is not renamed; `seedLength` and a synthetic `session/end-seed` are the two physical spellings of "seeded". |
| `session-format-v0-to-v1/tests/codec.spec.ts` | Physical header fields, packed text/reasoning/tool-call expansion, the `dt` delta length, row-atomic recoverable prefix, strict gaps, a gap row that itself closes a turn. |
| `session-format-v0-to-v1/tests/legacy.spec.ts` | Pre-identity user/assistant/replacement-tool-result identities; wrapped and flat steering; every accepted old turn ending; the retired `request/header` `fallback` reason is an unsupported migration. |
| `session-format-v0-to-v1/tests/migration.spec.ts` | The identity edge changes only `header.version`; an unrecognised compact run is expanded; the recoverable prefix and the later committing `turn/end`; a multi-owner canonical log is preserved except the version. |
| `session-format-v0-to-v1/tests/relationships.spec.ts` | A relative restored `cwd` is refused; core/retry/title/compaction/PTC/replacement relationships are accepted; the tool lifecycle (advertised → started → repaired → resolved); retry mode/failure/route/policy chains. |
| `session-format-v0-to-v1/tests/validation.spec.ts` | An executable valid fixture for **every** frozen released-v0 event type; an unexpected member is refused on every known payload; nested schema drift is refused at every non-opaque member; unknown v0 events are refused **even when ignorable**. |
| `session-format-v1-to-v2/tests/codec.spec.ts` | The v2 header round trip; one event per row; scalar/pair/long-run `sourceEventSeqs` compaction; a non-monotonic list stays scalar. |
| `session-format-v1-to-v2/tests/migration.spec.ts` | The header-only migration; a directly decoded v1 source is validated before transforming; own-generation delivery markers are checked and inherited ones accepted; a packed run split by the inherited cut is refused. |
| `session-format-v1-to-v2/tests/validation.spec.ts` | The v2 header images; empty artifacts; a true `ignorable` marker; the referenced session generation survives a containing-log migration. |
| `session-format-v2-to-v3/tests/admission.spec.ts` | Durable V3 admission failures; non-dense source input is refused rather than given ambiguous identities; native metadata versions are checked before released header validation. |
| `session-format-v2-to-v3/tests/canonical-envelopes.spec.ts` | Replacement keys are renamed after the structural insertion; source-event references and the seed cut are remapped; other-session captured references are retained; empty header optionals are dropped and non-empty ones kept. |
| `session-format-v2-to-v3/tests/canonical-regressions.spec.ts` | Canonical preservation across migration and native reload; empty `stop` arrays and nested tool-schema values survive; a composed inherited+local preset/replacement/PTC history survives; four event types are refused in composed catalog paths. |
| `session-format-v2-to-v3/tests/catalog.ts` | A test-only catalog fixture module (no inline test titles). |
| `session-format-v2-to-v3/tests/combined-migration.spec.ts` | The combined structural + canonical + PTC migration: system prompts inserted and cleared, replacements and nested PTC history remapped, identities not rewritten, obsolete PTC tags refused during recoverable decoding. |
| `session-format-v2-to-v3/tests/content-admission.spec.ts` | Opaque JSON, serialised arguments, compact runs and non-content counters are preserved exactly; historical queued content and chunk start/end blocks route through V2 admission; empty carrier arrays are accepted. |
| `session-format-v2-to-v3/tests/migration.spec.ts` | The streaming system-prompt migration: an empty head right after the first step, chronology preserved, changed *and cleared* prompts captured, deterministic head-identity collisions refused in either order, pre-step surfaces refused. |
| `session-format-v2-to-v3/tests/preset-migration.spec.ts` | Only the exact string `code` is renamed; `Code`, `code-custom` and `standard` are not; sparse sequences and unclassified preset-looking events are refused. |
| `session-format-v2-to-v3/tests/structural-regressions.spec.ts` | Every request survives step and turn changes, repeated text, clear and reintroduction; generated identities are stable across reads but distinct across session ids; the last inherited marker is mapped independently of later local prompt insertions; unknown content in user/system carriers is refused even when ignorable. |
| `session-format-v3-to-v4/tests/attribution.spec.ts` | Uninstalled producer attribution (`user`, `developer`) survives decoding, adoption and derivation. |
| `session-format-v3-to-v4/tests/canonical.spec.ts` | Composed seeded systems, source ownership, PTC, canonical replacements and a native round trip; non-canonical native metadata is rejected; earlier-generation delivery markers stay ignored. |
| `session-format-v3-to-v4/tests/catalog-completion.spec.ts` | The parent catalog completion: V1 descriptors, an evidence source path in diagnostics, deterministic child facts, existing facts preserved, inherited membership not owned, conflicting identities refused, tied children ordered independently of directory enumeration. |
| `session-format-v3-to-v4/tests/codec.spec.ts` | V4 framing reuses V2; a native round trip; released wrapper rows are rejected **before** structural recovery; predecessor and future delivery generations are retained without activating their watermarks; invalid cuts and sparse rows are refused. |
| `session-format-v3-to-v4/tests/content.spec.ts` | Unknown V3 content tags stay opaque (including `plugin:future`); unchanged leaves are shared; raw assistant start/end blocks are converted and start-owned fields preserved. |
| `session-format-v3-to-v4/tests/corpus.spec.ts` | Recorded parent/child clock conflicts are refused; consistent copies migrate including a failed startup. |
| `session-format-v3-to-v4/tests/developer-relationships.spec.ts` | An empty developer node is retained while the protected system head is replaced; an empty developer *replacement* of the head is rejected; empty developer nodes count in compaction spans. |
| `session-format-v3-to-v4/tests/developer.spec.ts` | Native developer messages and deferred schemas round trip; additional JSON fields are preserved; a malformed addition name, an inline definition and an invalid `headerSeq` are refused. |
| `session-format-v3-to-v4/tests/fork.spec.ts` | Fork results: non-object data ignored, original fork ids and wording persisted, a pruned fork result round trips, incomplete persisted fields are rejected. |
| `session-format-v3-to-v4/tests/interrupted-turn.spec.ts` | The interrupted turn is closed at the next-turn restart; open tails and balanced turns are retained; both sides of a restart are remapped through compaction, replacement, command completion and titles; image-offload targets are remapped. |
| `session-format-v3-to-v4/tests/message-sources.spec.ts` | `constructor` / `toString` / `__proto__` as an external producer are migrated without interpreting inherited keys; retired source kinds are refused in every declared message slot. |
| `session-format-v3-to-v4/tests/migration.spec.ts` | Required V3 developer events are rejected while ignorable ones are preserved; generic required V3 extensions are rejected before target vocabulary admission; only the header version changes; stage state is independent; compact runs are consumed unchanged. |
| `session-format-v3-to-v4/tests/open-vocabulary.spec.ts` | Unknown ignorable payloads stay opaque to every native semantic pass; an opaque `end-seed` does not clear an owned compaction; an unknown ignorable user row is not reinterpreted through a known title citation; **known events marked ignorable are still validated**. |
| `session-format-v3-to-v4/tests/relationships.spec.ts` | The mandatory V4 lifecycle: valid tool exchanges and open interrupted tails; exact not-started repairs with preserved historical identity suffixes; ignorable payloads and unknown attribution metadata retained; compaction restoration. |
| `session-format-v3-to-v4/tests/retired-content.spec.ts` | A retired tool-result wrapper is refused in native encoding, restoration and recoverable suffixes; a V3 user wrapper is refused at the V4 target while the released reader and source stay intact; tool arguments, replay state, schemas and nested metadata stay opaque. |
| `session-format-v3-to-v4/tests/retired-syntax.spec.ts` | Retired headers and PTC tags are rejected in strict reads, encoding and recoverable suffixes; known request fields stay open and obsolete ignorable tags stay opaque. |
| `session-format-v3-to-v4/tests/sources.spec.ts` | `mapEventMessages` across every declared carrier: the user payload, the system/assistant/tool-result payloads, the spliced and title-request arrays, and non-object data returned unchanged. |
| `session-format-v3-to-v4/tests/system-message.spec.ts` | Required fields and extra JSON on known and extensible block types are preserved; malformed fields are rejected before a recoverable scanner can discard the row. |
| `session-format-v3-to-v4/tests/tool-role.spec.ts` | The lifted tool-role view: writer field order, `isError` on both sides, outer flags not activating target names, and `extension` / `__proto__` / `constructor` result fields preserved without becoming core fields. |
| `session-format-v3-to-v4/tests/validation.spec.ts` | The V4 header images; dense envelopes, cuts and event vocabulary; unknown child membership retained; duplicate child ids and invalid identities rejected. |
| `session-format/tests/catalog.spec.ts` | Header classification, physical-row restore through the compiled chain, a current-format bypass, one-record-at-a-time encoding, current-validation failures and explicit migration refusals preserved. |
| `session-format/tests/chain.spec.ts` | Adjacent stages are bypassed for current input; a chain is composed from one stage; invalid declarations and an incomplete chain are rejected; a stage whose cut is derived from the body works. |
| `session-format/tests/filename.spec.ts` | v0 is named without a generation component and later generations with `.vN`; only canonical raw names parse. |
| `session-format/tests/json.spec.ts` | Lossless snapshots: detach, freeze, repeated non-cyclic values and `__proto__` keys retained; cycles, custom prototypes and invalid scalar coordinates refused. |
| `session-log-deepseek/tests/config.spec.ts` | The byte limit defaults to 8 MiB and accepts only positive integers. |
| `session-log-deepseek/tests/feedback-composition.spec.ts` | Freeform feedback and message put/edit/delete go out through the unchanged provider route; a log above `maxBytes` drains across consecutive requests; the API log upload changes on the next request without replacing the plugin fiber. |
| `session-log-deepseek/tests/upload.spec.ts` | Raw numeric sequence fields on the external wire DTO; surface placement is required and sources are restricted to non-assistant surface wire events; developer changes, assistant provider metadata (only through the embedded stream) and system append/replacement placement upload correctly. |
| `session-persistence-jsonl/tests/jsonl.spec.ts` | Canonical generation naming and parsing; the retired-header check ignores non-object values; `encodeSegment` neutralises traversal, separators and absolute paths and is **injective over UTF-16 including lone surrogates**. |
| `session-persistence-jsonl/tests/lease.spec.ts` | A second instance is excluded while the holder is live and admitted after close; removing the lock file forfeits a wedged holder (a fresh inode admits a successor); an absent session leaves no lock residue; `EWOULDBLOCK` maps to already-owned; the inode verification retries. |
| `session-persistence-jsonl/tests/lease.two-process.e2e.ts` | A real second process is excluded by a live holder and takes over immediately after the holder crashes. |
| `session-persistence-jsonl/tests/migration-refusal.spec.ts` | EOF migration refusals across compression × access: a V2 refusal publishes nothing and discards no tail; a V3 watermark claiming V4 is refused; invalid required V3 events are refused before publishing; a foreign watermark is retained unchanged; `deferLoading` in a V3 tool definition is refused. |
| `session-persistence-jsonl/tests/migration-verifier.spec.ts` | The verifier Worker lifecycle: a valid response is retained until a natural exit; a nonzero exit, a Worker error, cancellation and a missing stack are all handled; the concurrency permit is held until the Worker exits and handed to the oldest waiter. |
| `session-persistence-jsonl/tests/migration-verifier-real.spec.ts` | The real verifier exits naturally after verifying both `none` and `zstd` input. |
| `session-persistence-jsonl/tests/generation.spec.ts` | Cancellation raised while creating a child source decoder; immutable generation publication refuses a V2 message without surface markers and contradictory tool-error metadata without touching the source. |
| `session-persistence-jsonl/tests/multi-edge-publication.spec.ts` | Multi-edge durable publication from v0 and v1: only the current generation is published; source drift rejects a stale publication and re-prepares; a late V3 prompt outside a step refuses the earlier edges too. |
| `session-persistence-jsonl/tests/catalog-migration.spec.ts` | Historical catalog publication for both compressions; a foreign native V4 delivery is refused through read and write access; corrupt magic/checksum/lines are distinguished; lightweight revisions invalidate on child membership changes; malformed native catalog data is reported without migration terminology. |
| `session-persistence-jsonl/tests/content-admission.spec.ts` | V2 content EOF refusals (no source mutation, no prefix publication) and admitted content publication preserved on read, publication and fresh reopen. |
| `session-persistence-jsonl/tests/current-event-admission.spec.ts` | Unknown required metadata at EOF is refused **without truncating a provider append**; obsolete ignorable types are retained through scanning and an append. |
| `session-persistence-jsonl/tests/native-developer-admission.spec.ts` | An empty developer node and additional metadata survive on a valid open step; name-only additions are bound to their historical header without copying definitions; malformed known ignorable developer data is refused even after a corrupt row. |
| `session-persistence-jsonl/tests/native-source-admission.spec.ts` | A malformed queued source is refused before a handle is exposed; known queued events marked ignorable are still validated; external attribution survives without a producer installed. |
| `session-persistence-jsonl/tests/retired-content-admission.spec.ts` | Retired content in JSONL across V3/V4 with and without a corrupt prefix; an unknown ignorable V3 payload is preserved without interpreting its content. |
| `session-persistence-jsonl/tests/v2-ptc-migration.spec.ts` | V2 PTC publication and restore: the current generation is published without changing the V2 bytes; ids, roles, content and replay state are preserved. |
| `session-persistence-jsonl/tests/v2-system-migration.spec.ts` | V2 system prompts: prepare and clear read-only then publish the current generation without replacing V2; local references remapped and the inherited cut stable; unsupported pre-step V2 refused on open **without falling back to V1**. |
| `session-persistence-jsonl/tests/v3-restart-migration.spec.ts` | The V3 interrupted turn: prepare read-only, publish a verified V4 successor, reopen without repeating the repair; an unsettled restart is refused without publishing. |
| `session-persistence-jsonl/tests/win32.spec.ts` | Drive-root probes stay native while descendants are namespaced; `MoveFileExW` write-through publication; Win32 failures map to Node errno codes; directories are created through staging siblings and a create race is tolerated. |
| `session-persistence-jsonl/tests/zstd.spec.ts` | Concatenated checksummed frames are scanned with a frame limit; the public and Node-private decoders are interchangeable; the public decoder is the fallback; decoder lifecycle and checksum errors are enforced by both. |
| `session-persistence-jsonl/tests/zstd.compat.spec.ts` | Concatenated checksummed frames round trip through the built-in Node API. |
| `session-persistence-jsonl/tests/load-path.spec.ts` | The JSONL namespace and configuration survive the Loader. |
| `session-persistence-jsonl/tests/teardown-loader.e2e.ts` | Injected-consumer teardown is awaited, the final event is persisted, and listeners and leases are released. |
| `session-persistence-jsonl/tests/built-migration-worker.e2e.ts` | The built migration verifier publishes and verifies history **without runtime workspace imports** (plain node). |
| `session-persistence-jsonl/tests/catalog-migration.perf.ts` | A perf harness for the catalog migration (no inline test titles). |
| `session-persistence-jsonl/tests/fixtures/lease-holder.mjs` | A second-process lease holder fixture (no inline test titles). |
| `session-persistence-jsonl/tests/fixtures/released-v0-real-shapes.jsonl` | A recorded released-v0 physical corpus (no inline test titles). |
| `session-persistence/tests/contract.ts` | The **shared backend contract suite**: round trip through one write handle, offset/length defaults, negative/fractional offset and length rejection, duplicate create against a live pending session, concurrent duplicate creates (one wins, the loser gets `SessionAlreadyExistsError`). |
| `session-persistence/tests/live-write-contract.ts` | The live write path: published events route into the active write handle within one batching window; a session with no active handle persists nothing; a plugin record survives a restart; `session/flush` drains immediately and surfaces a retained background failure. |
| `session-persistence/tests/storage-contract.spec.ts` | `assertStoredId` names both ids on a mismatch; `assertVersion` refuses a newer version with the upgrade direction **and the artifact location**. |
| `session-projection/tests/registry.spec.ts` | The registry drive: the exact inherited cut reaches live, restored and hydrated initialization; a unit registered after events flowed builds its cell lazily from the full log; an empty log serves `asOfSeq -1`. |
| `session-projection-cache/tests/cache.spec.ts` | The write policy: a durable checkpoint at `turn/end` (mandatory), at session creation (capturing the seed-derived cut) and at session disposal; a threshold flush; a refused lifecycle. |
| `session-projection-cache/tests/fixtures.spec.ts` | Opaque keys survive read/put/reopen; cycles and JSON-lossy values are rejected without changing valid objects; the v3 whole-unit archive is recovered through the legacy bootstrap; a predecessor title is served but never a current or newer one. |
| `session-projection-cache/tests/fixtures/v3-single-unit.json` | A v3 single-unit archive fixture. |
| `session-projection-cache/tests/fixtures/v4-session-doc.json` | A v4 session document fixture. |
| `session-projection-cache/tests/fixtures/v5-session-doc.json` | A v5 session document fixture. |
| `session-projection-cache/tests/fixtures/v5-lineageless-doc.json` | A v5 lineage-less document fixture. |
| `session-projection-cache/tests/fixtures/v7-opaque-session-doc.json` | A v7 opaque session document fixture. |
| `session-stats/tests/projection.spec.ts` | Zero figures on the empty log; distinct turns and closed steps counted with the causing seq; a rejected or empty turn is uncounted; a cancelled step that closed without an assistant message **is** counted. |
| `session-stats/tests/loader-composition.spec.ts` | The shipped YAML shape loads and serves whole-log counts; the function-plugin namespace has no default export. |
| `session-telemetry/tests/telemetry.spec.ts` | Every appended event is handed over with envelope identity and a **cloned** body; a live request header is captured without replaying withheld events; header facts are stamped on every record; outcome flags map to severity with unknown types falling through as info. |
| `session-telemetry/tests/redact.spec.ts` | Records pass through unchanged with no listener; a mounted rule applies to every outbound record including ops records; the **canonical log stays untouched** by a rule; listeners stack outermost-first around `next()`. |
| `session-telemetry-otel/tests/otel.spec.ts` | Only the submitted prefix ships through the real SDK pipeline; records enqueued after a timer export began are drained; queued sends stop at the shutdown deadline while the active transport is observed; exporter options beyond url and headers pass through. |
| `session-telemetry-otel/tests/egress.spec.ts` | Egress routing per provider (mock, deepseek-official, unknown, undefined). |
| `session-telemetry-otel/tests/loader-composition.e2e.ts` | The headless task continues when FULL is rejected; the redacted feedback-authorized prefix is exported while the canonical log keeps the secret; ordinary turns and shutdown are never captured without new feedback; disabled feedback stays local with a stable warning. |
| `session-telemetry-otel/tests/fixtures/driver.ts` | A telemetry driver fixture. |
| `session-telemetry-otel/tests/fixtures/telemetry-redact-rule.ts` | A redaction-rule fixture. |
| `session-telemetry-otel/tests/fixtures/telemetry.patch.yml` | A telemetry patch YAML fixture. |
| `session-title/tests/session-title.spec.ts` | Title normalisation: terminal controls removed, whitespace collapsed, word and UTF-8 byte caps applied, non-positive and fractional limits rejected; an immediate fallback is logged and folded after the first eligible human text message. |
| `session-title/tests/rename.spec.ts` | A normalised user-source title is appended; a title that normalises to empty and a dead session are rejected; the user title **pins** the session and `refresh()` unpins it; a fallback-only refresh also unpins. |
| `session-title/tests/provider.spec.ts` | Title events are inherited across forks and first-prompt retitling is skipped; a first-prompt provider runs once after the routed request and retries only through `refresh()`; `currentTitle` is omitted when a one-byte cap makes the fallback underivable; the latest accepted snapshot is passed to each revision. |
| `session-title/tests/service-contracts.spec.ts` | Explicit positive limits are required with `fallbackMaxWords ≤ maxTitleBytes`; empty input returns no title with or without a provider; detached and pre-aborted refreshes are rejected; cancellation and disposal propagate to active work. |
| `session-title/tests/projection.spec.ts` | `null` before the first title event; latest-wins with the causing seq; the version-1 string checkpoint format is read; titles already in the log are folded when the service mounts late. |
| `session-title/tests/persistence.spec.ts` | A title round-trips through a remounted JSONL backend. |
| `session-title-llm/tests/llm.spec.ts` | The prepared system and input are dispatched, attribution is logged, the provider's reasoning selector is forwarded, the title output cap is independent of a smaller conversation cap, and the exact multibyte input byte limit is enforced **before** logging or dispatch. |
| `session-title-first-prompt-llm/tests/provider.spec.ts` | The provider selects only the first eligible human message (including on refresh), frames it as data, logs the exact system and input, and selects the least supported reasoning effort. |
| `session-title-first-prompt-llm/tests/loader-composition.spec.ts` | The service and one model provider load with required deployment policy; a session is titled on an inherited route that cannot stop reasoning. |
| `session-title-first-prompt-llm/tests/provider.e2e.ts` | A real DeepSeek API run replaces the fallback with a short model title (skipped without `DEEPSEEK_API_KEY`). |
| `session-turn-outline/tests/projection.spec.ts` | The turn boundary is a branded event identity; the outline is empty before any turn; each turn folds with its boundary seq, first prompt and turn-end response; the response stays empty until `turn/end` (draft-only). |
| `session-turn-outline/tests/loader-composition.spec.ts` | The shipped YAML shape loads and serves the outline; the function-plugin namespace has no default export. |
| `working-directory/tests/working-directory.spec.ts` | Origin metadata and other sessions stay independent; directory state restores from the log; the current directory is exposed in wire observations after replay **without an Agent**; concurrent relative changes serialise and a rejected change recovers. |
| `working-directory/tests/admission.spec.ts` | The current directory and permissions are admitted in the pre-step and `prepareCall` phases, with optional context on and off. |

#### Documentation (44 files)

- **22 English `README.md`** — the authoritative package docs. All read in full: `session/`, and one per package (`session-checkpoint-policy`, `session-format`, `session-format-catalog`, `session-format-v0-to-v1` … `v3-to-v4`, `session-log-deepseek`, `session-persistence`, `session-persistence-jsonl`, `session-projection`, `session-projection-cache`, `session-stats`, `session-telemetry`, `session-telemetry-otel`, `session-title`, `session-title-first-prompt-llm`, `session-title-llm`, `session-turn-outline`, `tool-working-directory`, `working-directory`). Every one carries the same skeleton — *Summary / Use this package / Understand the implementation / Further Exploration / **Model Experience** / Known Limitations and Deferred Work / Dev Note* — which is itself a finding (see §4).
- **22 Chinese `README.zh.md`** — the Chinese counterpart of each English README. Opened and confirmed to mirror the English section skeleton, the code blocks and the tables (the same anchors, e.g. `## 概述` for *Summary*, `## 目录` for *Table of Contents*). No decision lives only in a Chinese file; the English one is the source of truth.
- **22 `README.i18n.yaml`** — generated per-heading bilingual consistency records: a hash of the English and Chinese blocks outside code blocks for every anchor, plus the command that regenerates them (`pnpm run verify-translation-pairing --write <file>`). They are *proof* that the two languages cannot drift silently — a mechanism worth stealing.

#### Configuration and generated files (63 files)

- **22 `package.json`** — every package is `0.2.1-rc.2`, `type: module`, MIT, with a `dsh.sessionFormatMigration` manifest block on the four migration packages and a `./src/*` export on the library packages. `session-persistence-jsonl` also depends on `koffi` (the Win32 FFI) and `p-limit`.
- **22 `tsconfig.json`** — every package extends `tsconfig.base.json`, sets `rootDir: src` / `outDir: lib/types`, and declares **project `references`** to its siblings (the monorepo builds each package's `.d.ts` in isolation).
- **~10 `tsdown.config.ts`** — one-line ESM/node/`es2024` builds with `dts: false` (types come from `tsc`, not the bundler).
- **~11 `locale/en.json` / `locale/zh.json`** — the title (and, in Chinese, a one-line description) of each package. `session-telemetry` has no `locale/` directory at all.
- **1 generated-vendored `README.i18n.yaml`** per package plus the 22 above — all read and confirmed to be the bilingual hash record.

---

## 2. Ideas worth stealing (ranked)

1. **Separate the *event log* from the *derived state* and make the derived state a pure fold.** `session-projection` defines one rule — a state-carrying log event must carry the **complete post-change state**, never a bare delta — and then every unit is a synchronous `apply(state, event)` that returns the *same reference* when the event does not concern it. Two `Object.is` gates (state, then view) make the whole thing free when nothing changed. August Trading's `useTradeLogging` / `services/learning/*` could adopt the same shape and stop re-deriving state from raw events in the UI.
2. **The log leads, the cache follows — and the ordering is the contract.** `session-projection-cache` takes the checkpoint cut *before* flushing the session's events, so a crash can leave the cache **behind** the log (a longer tail replay) but never **ahead** of it (phantom values folded from events the stored log does not contain). One sentence of ordering removes an entire class of "the panel shows a trade that is not in the journal" bug.
3. **Distinguish "unsupported version" from "corrupt" in every user-facing refusal.** `sessionFormatVersionRefusal` is direction-aware and carries the artifact's path: a newer log says *"upgrade the harness"*, an older one says *"no upgrade path"*, and **neither ever says "corrupt"**. The same rule appears in the JSONL reader (`refuseForeignFormatVersion` runs *before* the header shape check) and in the V3 codec (a retired-syntax row is refused *before* the recoverable-tail policy can discard it).
4. **A derived cache is a shortcut, never an authority: possibly stale, never wrong.** So every write path is fail-soft ("a lost write costs a longer tail replay"), a version mismatch **discards** the row rather than migrating it, and a row that fails its schema is moved aside as `<id>.json.bak.<stamp>` rather than costing the boot. August Trading's `MemoryFilesService` / notebook caches have the same shape and could adopt the "stale but never wrong" contract explicitly.
5. **Make the durable write barrier explicit and separate it from the best-effort write.** The seam says it twice: "`append` is best-effort; only a resolved `flush` promises it survives a crash." August Trading's notebook writes currently mix the two.
6. **An unknown event is *opaque*, not *discarded* — but only when it says so.** `ignorable: true` means "keep my payload verbatim"; an unknown *required* type is refused. The corollary that costs the most to get right: **ignorable is a reader permission, not a transform permission** — a migration refuses to transform an unclassified event even when it is ignorable.
7. **Name the source of truth for a "who did what" fact, and make the provider cite it.** The title service requires a provider to cite the exact message seqs it used, and checks they are unique, ordered seqs *from the request* — a provider cannot attribute a title to a message it never saw. The same "cite your sources or fail" pattern fits August Trading's trade-log / post-trade analysis claims.
8. **Give the model-visible "unknown outcome" a first-class vocabulary and tell it not to retry blindly.** The checkpoint policy persists a tool call, crashes, and on resume writes `TOOL_OUTCOME_UNKNOWN` with the literal text *"Do not retry blindly."* An unproven side effect is a distinct state, not an error and not a success.

---

## 3. Findings relevant to a trading application

1. **A trade log that is a pure event log, with derived state folded from it, is exactly the shape August Trading's journal wants.** The `sessionStats` fold is a worked example of the metrics a trading UI needs — *turns, steps, model wall time, tool wall time, first-token latency, decode time, decode tokens* — computed over the **complete** log so that paging and compaction cannot change the numbers. August Trading's "session/analysis statistics" could use the same whole-log-vs-window distinction.
2. **The "whole-value" rule is a gift for a journal.** A trade-log event that carries the **complete post-change state** (the whole trade record, not "field X changed to Y") makes every read model trivially cheap and every served value self-describing — and it means a UI never has to reconstruct a trade from a delta chain. August Trading's `TradeAnalysis` records are already close to this.
3. **Turn/step boundaries are the natural unit of "one analysis".** The `step/end` event is the counted unit because the loop appends exactly one per entered step *in a `finally`* — so completed, failed, cancelled and max-tokens steps all land one. A cancelled step is **counted but untimed** ("no assistant message assembles, so its partial stream time stays uncounted"). That is the honest accounting for a rejected trade plan.
4. **"Whole-log" figures must survive compaction.** The whole point of the stats unit is that *paging and compaction do not change them*, and the fold mirrors a client-side window fold **field by field** so a client without the unit can fall back to it wholesale. August Trading's "post-trade learning" counters have the same risk when the journal is pruned.
5. **Tool-call pairing by `callId` is the ledger discipline.** A tool result is matched to its call by id; unmatched results at a turn boundary are **dropped** rather than accumulated ("results always land within their turn, so drop the leftovers instead of growing persisted state forever"). An unmatched trade-log entry should be dropped with a diagnostic, not carried forever.
6. **Titles are free: they are log-only state that never enters the model.** A session title "never enters the model surface, `deriveMessages()`, system prompt, tool schemas, or request prefix" — a client-visible value at **zero token cost**. August Trading could name each analysis session the same way (a derived title over the user's first prompt) and pay nothing.

---

## 4. Non-obvious decisions and gotchas (the part that saves a rebuild)

- **The format chain is a build-time artefact, not a runtime plugin registry.** `session-format-catalog/src/generated.ts` is generated and the chain is asserted gap-free at module init; "A profile cannot add, remove, or reorder an edge by mounting a feature plugin." A missing edge is a *build* error.
- **A frozen validator can be reused against a newer shape by giving it a "costume".** The V2→V3 validator builds a **private view** of the V3 artifact — `system/message` → a `user/message` stand-in, `tool/ptc-dispatch-start` → `tool/code-dispatch-start`, `{startSeq,endSeq}` → `{start,end}` — runs the *frozen* v0→v1 relationship validator on the projection, and returns the **original artifact unchanged**. It even rewrites a repair id *only inside the private view* ("Message identity survives promotion; only this private frozen repair check uses target seq"). This is the single most reusable technique in the shard.
- **"Recoverable" is a prefix rule, not a best-effort rule.** A malformed row is dropped and the preceding prefix is kept — but if a later decoded `turn/end` proves the region was committed, the **first error is re-thrown**. The same rule exists in every codec.
- **A POSIX `flock` names an inode, not a path.** The holder verifies the locked inode is still the file at the lock path and retries otherwise; and there is deliberately **no lease expiry**, because an expiry could expropriate a stalled writer "whose resumed appends would tear the log."
- **`link()` rather than `rename()` for publication.** `link()` fails with `EEXIST` if the target exists, so two processes materialising the same id cannot clobber each other; `rename()` would silently overwrite. On Windows the equivalent is `MoveFileExW` **without** `MOVEFILE_REPLACE_EXISTING`.
- **Compression is a container the backend owns.** The artifact is a concatenation of independent checksummed zstd frames; the first frame is the header, each later frame is one append batch, and `scanZstdFrames` walks the frame structure **without decompressing**. A metadata-only read costs no decompression.
- **A `SessionId` is an unvalidated branded string and MUST be path-encoded.** `encodeSegment` is **injective over all UTF-16 strings, including lone surrogates** — safe code units stay literal, everything else becomes `~XXXX`. `projectKey` is *deliberately lossy* (human-navigable directories) and says so.
- **The revision token is explicitly not authoritative.** "Equal revisions may be treated as an unchanged log; unequal revisions promise nothing." It exists for derived caches only.
- **A background write failure must not silently lose the batch.** The JSONL writer *re-queues the batch in order*, pauses the automatic path, and logs; the next explicit flush retries loudly.
- **The chain on a handle never rejects.** `this.chain = next.catch(() => {})` — one failed append does not poison every later one.
- **A read that goes backwards is an error, not a shorter answer.** A log that shrank below a previously observed prefix throws.
- **The cache is a fold shortcut; the log is the authority.** And the *direction* of the possible error is chosen deliberately: behind, never ahead.
- **`asOfSeq` is a single consistent cut across every value in a snapshot** — the mechanism that lets a client pair state with the matching history.
- **Every "known" event marked `ignorable` is still validated.** `ignorable` is about *vocabulary*, not about *trust*.
- **The `plugin:` namespace is the universal "not ours" convention** — used for unknown content block types, unknown event types and unknown message sources alike.
- **Title text is sanitised against deceptive display**: OSC/CSI/ESC sequences, C0/C1 controls, and *directional and invisible controls* (zero-width, bidi overrides, BOM) are removed. Truncation is UTF-8 byte-safe and never splits a code point.
- **A title that normalises to empty is an *input* error, not a liveness error** — a distinct exception class, so a wire layer can narrow on it.
- **The user rename *pins* the title.** Later user messages schedule no automatic revision; only an explicit `refresh()` unpins.
- **Every package README has the same skeleton, including a "Model Experience" section** that states what the model sees, the token effect, and the **KV-cache effect**. That last one is rare and directly relevant: the checkpoint policy's repair result is appended *after* the reusable prefix specifically so it does not invalidate KV-cache entries.
- **The `README.i18n.yaml` pairing record** is a per-heading hash of the English and Chinese blocks with a one-command regeneration — a cheap, effective way to stop two languages from drifting.
- **Coverage pragmas (`/* v8 ignore */`, `/* jscpd:ignore */`) are used deliberately**, including around the frozen V3 event list, which duplicates the installed list *on purpose* so the historical reader stays self-contained.

---

## 5. Weak spots in the reference (what NOT to copy)

1. **The format chain is enormous.** Five frozen generations, ~150 KB of validation code, a generated catalog and a "private view" trick — for a log format that is, in substance, a JSONL file with a header. The *discipline* is worth stealing; the *volume* is not. A trading app should adopt the invariants (dense seq, exact key sets, owner-opaque members, refuse-not-repair) at roughly 5 % of the size.
2. **The frozen-code strategy creates permanent duplication.** The V3 event list is duplicated on purpose; the v0-to-v1 relationship validator is reused via a projection *and* re-implemented for V4; three different files each check the same retired tool-result wrapper. Every format generation leaves a fossil.
3. **Several rules are only discoverable by reading the prose.** "The `plugin:` source wrapper is retired", "the header keeps the original project, the projection holds the effective directory", "the fork result id embeds a sequence that means different things in the two placement modes" — these are stated in README sentences, not in the code. A test cannot tell you that a rule exists; only the doc can.
4. **The "private view" costume is clever and also a maintenance trap.** The V3 validator translates V3 shapes back into V2 shapes to reuse a frozen validator. Every future generation must extend the costume, and the costume's translations are themselves a second, unwritten specification of the format.
5. **Some guarantees are unbounded or platform-specific.** The lock has no expiry (a wedged holder blocks forever on purpose); the POSIX inode trick breaks if anyone deletes the lock file; the private Node zstd decoder reaches into `stream._handle.writeSync` and will break on a Node upgrade; the Win32 semaphore name is per login session; `list()` is unpaginated and unindexed; the telemetry handoff is at-most-once with no durable outbox; the title service keeps one piece of mutable module-scope ambient state.
6. **The README set is enormous and partly redundant.** 44 README files for 22 packages, each with a fixed 7-section skeleton, each also shipped in Chinese, each also shipped with a hash record — the documentation volume exceeds the documentation *content*. The `session-format-v3-to-v4` README alone is 36 KB and the `session-format-v2-to-v3` README is 20 KB of specification prose that duplicates what the code says.

---

## 6. One-paragraph summary

The DeepSeek Harness session group is a **disciplined event-sourced log** with a five-generation frozen format chain, a JSONL+zstd backend with kernel-level cross-process write exclusion, a fail-closed crash-recovery checkpoint policy, a projection framework whose units are pure synchronous folds over committed events, a durable checkpoint cache that is explicitly "possibly stale, never wrong", and a title/telemetry layer that is deliberately log-only and zero-token. For August Trading the transferable ideas are the *ordering* rules (log before cache; flush as the only durability barrier; refuse-don't-repair), the *vocabulary* rules (unsupported ≠ corrupt; unknown-but-ignorable stays opaque; unknown-outcome ≠ retry), and the *whole-value* rule (an event carries the complete post-change state). The reference's own weakness is volume: a five-generation frozen format with a generated catalog, duplicated validation and 44 README files is far more machinery than a trading journal needs, and several of its best rules exist only in prose.

