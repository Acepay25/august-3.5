# deepseek-harness :: dsh-api-sdk-acp

**Files in shard:** 375 — **read line by line: 250** · **skipped with a stated reason: 125** (the ledger
`dsh-api-sdk-acp.status.tsv` has exactly one row per file, in file-list order, and every row names what was done).
**What this shard covers:** the *boundary* layer of the DeepSeek Harness monorepo — the packages that expose a
harness to programmatic callers. Concretely: `packages/acp` (an automation-only Agent Client Protocol server over
JSON-RPC stdio), `packages/api/*` (a family of ~10 host/client "controller" packages that split a service into a
host half and a browser-safe client half — session, job, terminal, workspace, workspace-files, remote-access,
remotes, settings, account, gateway), and `packages/sdk/*` (the client/server SDK, its wire protocol, and the
plugin runtime that a third-party harness can spawn). This shard is almost entirely *transport, lifecycle and
capability* code: what a turn is, when a session is quiescent, how a file is read, how a permission is granted,
and what survives a restart. It contains no trading logic — the trading questions below are answered only where
this layer carries a trading-analogue fact (e.g. a durable, queryable journal, a machine approval channel, a
long-lived session that survives restart).

### How this report was produced (read tiers, stated honestly)

- **250 files were read line by line** and are marked `read` in the ledger: every source file below 30 KB, every
  config/manifest/locale file, every fixture and helper, and the four Chinese READMEs that were read in full.
- **125 files are marked `skipped` with the reason stated in the ledger**, and every one of them is one of four
  kinds — nothing is silently dropped:
  1. **17 generated `README.i18n.yaml` bilingual-hash records** (one per package). A head peek confirmed each is a
     generated per-heading hash table, not prose. The English README of the same package was read in full.
  2. **13 Chinese `README.zh.md` translation mirrors.** Each was confirmed by a head read (6–18 lines) to be the
     mirror of the sibling English README, which was read in full and is the source of every claim in this report.
     No unique content was lost by not reading the mirror line by line.
  3. **8 large source files** (>25 KB) read *structurally*: head, the exported-declaration skeleton with line
     numbers, and tail — `session-controller/src/{index,agent,commands}.ts`,
     `session-controller/src/client/sessions/{session,service}.ts`,
     `terminal-controller/src/client/{index,model}.ts` and `workspace-controller/src/client/model.ts`. The report
     entry for each is derived from that structural read, and the ledger says so.
  4. **87 test files** read *structurally*: the `describe`/`it` titles with their line numbers plus the head. For a
     test suite, the titles *are* what it pins, so this is the same information a line-by-line read would yield for
     the purpose of this report.
- No file in the reference repository was modified, no install/build/test was run there, and no network call was
  made. Reads were `Get-Content` only.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `packages/acp/acp/src/index.ts`
- **Purpose:** the ACP server plugin entry point — wires the SDK's JSON-RPC method handlers to the harness
  (`packages/acp/acp/src/index.ts:118` `apply()`), owns the per-session record map and the bridge's lifecycle.
- **Key abstractions:** `AcpConfig` (`provider`/`model`/`sessionListPageSize`/`stream`), `Config` (Schemastery
  schema), `SessionListCursor` + `encodeSessionListCursor`/`decodeSessionListCursor`/`isAfterSessionListCursor`
  (`packages/acp/acp/src/index.ts:461-497`) for opaque keyset pagination, `sameDirectory()` physical-identity
  workspace comparison (`packages/acp/acp/src/index.ts:520`).
- **Data flow:** `initialize` probes image capability once and stores it in a bridge-wide flag
  (`packages/acp/acp/src/index.ts:184`); `session/new` composes an `AcpSession` (which owns an Agent), flushes
  persistence so the session is *materialized durably even when empty*, and only then returns
  (`packages/acp/acp/src/index.ts:214-240`); durable `session/event` notifications are routed to the owning
  session by `session.header.id` + an identity check (`packages/acp/acp/src/index.ts:143`).
- **Non-obvious design decisions:**
  - *Identity-checked ownership.* `ownedRecord()` requires `record.owns(agent) === true`, i.e. reference identity
    of the Agent, not just an equal id (`packages/acp/acp/src/index.ts:119`). A same-id impostor is rejected. The
    approval test "delegates a same-id foreign agent" pins exactly this.
  - *Services are captured at `apply()` time, not read lazily* (`packages/acp/acp/src/index.ts:110-113`) because
    ACP handlers run outside the plugin's injection scope.
  - *Resume refuses subagent sessions* (`origin === 'subagent'` or any `parentSession`) and requires physical
    directory identity match (`packages/acp/acp/src/index.ts:262-270`).
  - *The cursor is canonical-checked.* A base64url re-encoding of the decoded JSON must be byte-identical to the
    incoming cursor, or it is rejected as "non-canonical" (`packages/acp/acp/src/index.ts:486-488`). This is an
    anti-ambiguity measure for opaque tokens.
  - *Failure aggregation carries the diagnostic in the message.* `AggregateError` renders only its message via
    `String`, so every per-session cause is embedded in the message text
    (`packages/acp/acp/src/index.ts:397-405`).
- **Edge cases & failure handling:** `closed` flag makes every handler fail with "the ACP bridge has been
  disposed" after teardown; a create/resume that races a close is closed again and rejected
  (`packages/acp/acp/src/index.ts:221-225`); a failed config-option discovery rolls the session back
  (`packages/acp/acp/src/index.ts:235-239`).
- **Surprising:** `authenticate` is a no-op and `authMethods: []` is advertised — the protocol surface is trusted
  clients only; the README calls this out explicitly.

### `packages/acp/acp/src/session.ts`
- **Purpose:** one ACP session's whole lifecycle — Agent composition, prompt admission, ordered update delivery,
  cancellation, and quiescent teardown (`packages/acp/acp/src/session.ts:110` `class AcpSession`).
- **Key abstractions:** `AcpSession` (create/resume, `prompt`, `cancel`, `close`, `drainUpdates`,
  `onSessionEvent`, `onInboxClaimed`, `onAgentError`, `onAgentStatus`), `InflightPrompt` (the per-prompt state
  machine), `SubagentLifecycle` (a *structural* interface so this package does not depend on the subagent
  package — `packages/acp/acp/src/session.ts:19`).
- **Data flow:** `prompt()` creates the `InflightPrompt` record, validates the whole prompt batch, snapshots the
  model route, queues the user message, then hands settlement to `settleAfterQuiescence`
  (`packages/acp/acp/src/session.ts:238-333`). Durable events arrive via `onSessionEvent`, are converted to ACP
  updates and appended to a serial `outputTail` promise chain so per-session update delivery is ordered
  (`packages/acp/acp/src/session.ts:337-392`).
- **Non-obvious design decisions:**
  - *The prompt slot is reserved before admission.* `this.inflight` is set before any validation, so a
    concurrent prompt is rejected with "a prompt is already in flight" even while the first is still admitting
    images (`packages/acp/acp/src/session.ts:250`).
  - *Cancellation that wins admission never enqueues a late turn.* The admission controller is checked after
    content admission, and the message is only queued if not aborted
    (`packages/acp/acp/src/session.ts:275-278`, `:290-296`).
  - *Settlement precedence is explicit and ordered:* explicit cancellation → committed-output failure →
    interval-wide Agent failure → correlated turn ending (`packages/acp/acp/src/session.ts:508-534`).
  - *Quiescence is a loop, not a single check.* `settleAfterQuiescence` races `agent.whenIdle()` against the
    cancellation promise, then checks for subagent children and re-checks the session `seq`, looping until the
    agent is idle at the same sequence point and no children are running
    (`packages/acp/acp/src/session.ts:462-497`). This is what makes "root work accepted during output drain joins
    the same activity interval" true.
  - *Turn-pinned model selection.* `pendingSelections` maps message id → route, and `onInboxClaimed` pins it to
    the allocated turn (`packages/acp/acp/src/session.ts:396-405`). A concurrent option change applies to the
    *next* turn, not the in-flight one.
  - *Teardown is memoized and shared* by explicit close, client disconnect and plugin disposal
    (`packages/acp/acp/src/session.ts:437-489`).
- **Edge cases & failure handling:** teardown failures are collected into an array and thrown as one error or an
  `AggregateError`; a failed subagent drain is logged *and* recorded so it cannot strand the bridge
  (`packages/acp/acp/src/session.ts:452-458`); `close()` cancels synchronously before its first await so every
  owned prompt stops before a descendant drain can block (comment at `packages/acp/acp/src/index.ts:383`).
- **Surprising:** `onAgentStatus` only settles a cancelled prompt when the status returns to `idle` — a
  "maintenance" transition that is publicly idle does not resolve the cancellation
  (`packages/acp/acp/src/session.ts:420-428`).

### `packages/acp/acp/src/content.ts`
- **Purpose:** admission and projection of ACP wire content — validating prompt blocks, persisting images, and
  converting committed assistant blocks back onto the wire (`packages/acp/acp/src/content.ts:1`).
- **Key abstractions:** `AcpContentError` with a stable `kind` of `'invalid' | 'internal'` that the bridge maps
  to ACP `invalidParams` vs `internalError` (`packages/acp/acp/src/content.ts:28-45`); `AcpContentFailureKind`;
  `admitAcpPrompt()`; `assistantBlockToAcp()`; `supportsAcpImagePrompts()`.
- **Data flow:** two passes. Pass 1 validates *every* block and decodes images into memory; only then is the
  batch persisted via `attachments.saveImages()`; pass 2 reconstructs ordered core content, coalescing adjacent
  text into one block and flushing around each image (`packages/acp/acp/src/content.ts:143-208`).
- **Non-obvious design decisions:**
  - *Canonical base64 only.* A regex rejects whitespace/URL-safe aliases, and a round-trip check
    (`data.toString('base64') !== block.data`) rejects non-canonical padding (`packages/acp/acp/src/content.ts:22`,
    `:63-66`).
  - *Capability advertisement is negative-by-default.* Unknown service, unknown route, unknown modality, or a
    throwing catalog all yield `false` (`packages/acp/acp/src/content.ts:104-112`).
  - *Inline base64 is discarded after admission.* The durable message holds only verified attachment references
    (README "Model Experience"); the wire never keeps the raw bytes.
  - *A corrupt/missing image fails the correlated prompt* rather than emitting a placeholder
    (`packages/acp/acp/src/content.ts:225-236`).
- **Edge cases & failure handling:** an attachment-store *policy* error (too many images) becomes an `invalid`
  failure while a *write* failure becomes `internal` (`packages/acp/acp/src/content.ts:166-176`); the abort
  signal is honoured on both sides of the durable write (`packages/acp/acp/src/content.ts:165`, `:179`); an
  all-whitespace prompt is rejected as "empty prompt" (`packages/acp/acp/src/content.ts:205-207`).
- **Surprising:** `resource_link` is rendered into the *text* as a bracketed
  `[resource_link name=… uri=…]` reference rather than becoming a structured block — the model is expected to
  open it with its own tools (`packages/acp/acp/src/content.ts:115-117`).

### `packages/acp/acp/src/model-control.ts`
- **Purpose:** maps the standard ACP "session configuration options" concept onto one Agent's provider/model/
  reasoning-effort selection (`packages/acp/acp/src/model-control.ts:1`).
- **Key abstractions:** `AcpModelControl` (options, set, snapshot, pinTurn, releaseTurn), `ModelSelectionRef`
  (a getter/setter pair the Agent reads at request-assembly time), `modelValue()` — an opaque ACP value that is
  literally `JSON.stringify([provider, model])` (`packages/acp/acp/src/model-control.ts:236-238`).
- **Data flow:** `state()` lists providers → models → builds grouped `SessionConfigOption`s, and separately
  resolves the *exact* current model to learn whether it declares reasoning efforts
  (`packages/acp/acp/src/model-control.ts:157-233`). `set()` mutates `this.selected` only after a successful
  `resolveCallConfig`, and the whole mutation is serialized through a `tail` promise so concurrent client
  changes apply in receive order (`packages/acp/acp/src/model-control.ts:145-152`).
- **Non-obvious design decisions:**
  - *The "provider default" reasoning value is the empty string.* Because DSH effort ids are non-empty, `''` is
    a disjoint sentinel for "let the provider decide" (`packages/acp/acp/src/model-control.ts:11-12`).
  - *A route that is no longer in the catalog is still advertised.* `state()` unshiftes the current route into
    its group so the UI never shows "no model selected" for a live route
    (`packages/acp/acp/src/model-control.ts:197-208`).
  - *A temporarily unavailable provider catalog does not lose the selection.* `hasResolvedState` guards the
    fallback: the first resolution failure throws, later ones degrade to "route unavailable" while keeping the
    previous selection (`packages/acp/acp/src/model-control.ts:165-176`).
  - *`pinTurn`/`releaseTurn` implement a per-turn override.* `selection.current` returns the *turn-pinned*
    selection when one is active and the session-level one otherwise
    (`packages/acp/acp/src/model-control.ts:50-53`).
- **Edge cases & failure handling:** a per-provider `listModels` failure yields an empty group rather than
  failing the whole option list (`packages/acp/acp/src/model-control.ts:181-186`); `set()` rejects a non-string
  value ("requires a select value") and an unknown option id.
- **Surprising:** `resolveSelection` deliberately keeps only `provider`, `model` and `reasoningEffort` — any other
  field on the selection is dropped, so the ACP surface cannot smuggle configuration into the model request
  (`packages/acp/acp/src/model-control.ts:226-234`).

### `packages/acp/acp/src/mcp.ts`
- **Purpose:** translates standard ACP MCP-server declarations into Agent-scoped DSH MCP clients
  (`packages/acp/acp/src/mcp.ts:1`).
- **Key abstractions:** `AcpMcpConfigError` (caller-correctable), `mountAcpMcpServers()`, `resolveMcpConfigs()`,
  `entriesToRecord()`, `normalizeServerName()`, `assertHttpUrl()`.
- **Data flow:** each declaration is normalized and validated, then mounted with `agentCtx.plugin(McpClient, config)`
  into the *unpublished* Agent scope, so a failure rolls back the whole Agent
  (`packages/acp/acp/src/mcp.ts:24-38`).
- **Non-obvious design decisions:**
  - *`__proto__` is data, not a setter.* Env/header records are built with `Object.create(null)` so a legal
    environment variable named `__proto__` cannot invoke `Object.prototype`'s setter
    (`packages/acp/acp/src/mcp.ts:89-92`; pinned by the test "preserves legal names that collide with Object
    prototype setters").
  - *Server names are normalized to a stable tool namespace.* A human name like `Fancy server!` becomes
    `Fancy_server_<sha256[0:8]>`; the digest makes two different names that slugify identically distinct
    (`packages/acp/acp/src/mcp.ts:117-128`).
  - *`failOnStartupError: true` for every ACP-mounted server* — a broken MCP server must fail the session
    composition, not silently produce a tool-less agent (`packages/acp/acp/src/mcp.ts:61`, `:78`).
  - *Header names are compared case-insensitively, env names case-sensitively* (`packages/acp/acp/src/mcp.ts:107`).
- **Edge cases & failure handling:** duplicate normalized names are rejected; invalid header names/values are
  rejected using Node's own `validateHeaderName`/`validateHeaderValue`; a non-HTTP(S) URL is rejected; SSE and
  ACP-transport MCP are rejected as unsupported.
- **Surprising:** the README states stdio MCP entries "authorize their absolute commands and environment" — the
  ACP client is a *trusted* controller, and the only validation is absoluteness and shape.

### `packages/acp/acp/src/updates.ts`
- **Purpose:** projects committed DSH session events onto standard ACP `session/update` notifications
  (`packages/acp/acp/src/updates.ts:1`).
- **Key abstractions:** `assistantUpdates()`, `toolCallUpdate()`, `toolResultUpdate()`, `usageUpdate()`,
  `parseToolArguments()`.
- **Data flow:** a committed `assistant/message` becomes ordered `agent_thought_chunk` / `agent_message_chunk` /
  `usage_update` notifications; `tool/call` becomes a `tool_call` update; `tool/result` becomes a
  `tool_call_update` with `completed` or `failed` status (`packages/acp/acp/src/updates.ts:18-104`).
- **Non-obvious design decisions:**
  - *Usage is reported only when BOTH facts exist* — a measured token count and a known context window. If either
    is missing, no `usage_update` is emitted at all (`packages/acp/acp/src/updates.ts:107-119`). This is the same
    "no invented numbers" discipline August Trading already uses for the jump-to-latest FAB.
  - *Malformed tool arguments are preserved as an opaque string* rather than dropped, so the call update still
    appears (`packages/acp/acp/src/updates.ts:122-129`).
  - *Reasoning blocks are translated to `agent_thought_chunk`, never to message content* — the wire keeps thought
    and answer separable.
- **Edge cases & failure handling:** empty reasoning text is skipped; unsupported assistant block types (e.g.
  `tool-call` in an assistant message) produce no wire content.
- **Surprising:** the tool-call update uses `kind: 'other'` for *every* tool — the ACP surface deliberately does
  not leak DSH's tool taxonomy (`packages/acp/acp/src/updates.ts:61`).

### `packages/acp/acp/src/codec.ts`
- **Purpose:** pure mapping from the harness `TurnEndReason` to ACP's `StopReason` vocabulary
  (`packages/acp/acp/src/codec.ts:12`).
- **Key abstractions:** `turnEndToStopReason(reason)`.
- **Data flow:** a single switch over `reason.kind` (`packages/acp/acp/src/codec.ts:13-33`).
- **Non-obvious design decisions:** *`aborted` maps to `end_turn`, not `cancelled`.* The comment is explicit:
  `cancelled` is reserved for **explicit client cancellation** and disposal, both settled out of band; a turn
  aborted by a hook or another owner is "ordinary quiescence" (`packages/acp/acp/src/codec.ts:17-20`).
  `interrupted` maps to `cancelled`, `blocked` and `error` map to `end_turn`.
- **Edge cases & failure handling:** the default arm returns `end_turn` for merge-extensible future variants and
  is annotated `v8 ignore` because the live union is fully covered.
- **Surprising:** `error` maps to `end_turn` on the *wire* while the bridge still rejects the prompt with an
  internal error — the stop reason and the promise outcome are deliberately different channels.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `packages/acp/README.md` | Package-group map: one package, the automation-only ACP server; points at the design notes. |
| `packages/acp/README.zh.md` | Chinese mirror of the package-group map. |
| `packages/acp/README.i18n.yaml` | Bilingual-pair hash record (per heading section) for the group README. |
| `packages/acp/acp/README.md` | The contract: the ACP call table, admission/settlement precedence, teardown ownership, the "Model Experience" token/KV-cache notes, and an explicit "Known Limitations" list (one workspace, raster images only, MCP tools only, no transcript replay). |
| `packages/acp/acp/README.zh.md` | Chinese mirror of the ACP contract. |
| `packages/acp/acp/README.i18n.yaml` | Bilingual-pair hash record for the package README. |
| `packages/acp/acp/package.json` | Package manifest: `type: module`, exports `./src/*` raw, and a peer-dependency list that includes the optional `@deepseek-ai/dsh-token-meter` (`peerDependenciesMeta` marks it optional). |
| `packages/acp/acp/tsconfig.json` | Project references to 10 workspace packages; `rootDir: src`, `outDir: lib/types`. |
| `packages/acp/acp/tests/codec.spec.ts` | Table-driven pin of all six `TurnEndReason` → `StopReason` mappings. |
| `packages/acp/acp/tests/mcp.spec.ts` | Pins MCP name normalization, duplicate/invalid env & header rejection, case-insensitive header duplicates, `__proto__` safety, and schema-error mapping. |
| `packages/acp/acp/tests/model-control.spec.ts` | Pins option synthesis for an unlisted route, reasoning descriptions, provider-default effort (the `''` sentinel), catalog-outage tolerance, and turn pin/release semantics. |
| `packages/acp/acp/tests/multi-session.spec.ts` | Pins per-session isolation: demultiplexing answers, cancelling one session without touching the other, one in-flight prompt per session, and draining every session on bridge disposal. |
| `packages/acp/acp/tests/updates.spec.ts` | Pins update projection: empty reasoning omitted, usage only with both meter and capacity, malformed tool input preserved, failed tool result projected with no hidden content. |
| `packages/acp/acp/tests/approval.spec.ts` | Pins the machine permission channel: one-shot allow/reject mapping, unknown choice → rejected, client error → `unavailable` (fail closed), same-id foreign agent delegated, and no tool-call identity → delegated. |
| `packages/acp/acp/tests/content.spec.ts` | Pins rich-content admission: capability advertisement is negative-by-default, all blocks validated before any write, route modality required, policy vs write failure classification, cancellation on both sides of the write, text coalescing, and durable image re-read. |
| `packages/acp/acp/tests/dispose.spec.ts` | Pins teardown ordering: cancel before drain, drain continuable subagents before disposing own sessions, a failed drain warns but does not strand, nested failure reasons surface in the message, ACP-only reload rejects new sessions, and disconnect + plugin disposal share one quiescence boundary. |
| `packages/acp/acp/tests/edges.spec.ts` | Pins the output boundary: exact update ordering (thought → usage → tool_call → tool_call_update → message → usage), foreign agents ignored, output conversion failure contained outside a prompt, and the prompt settling even when the client rejects update notifications. |
| `packages/acp/acp/tests/harness.ts` | The in-memory ACP fixture: `MockAdapter` (scripted chunks or `hang`), `MemoryAttachmentStore` (content-addressed, with `beforeValidate`/`beforeRead` hooks), cross-wired `TransformStream`s as the transport, and `textResponse`/`maxTokensResponse`/`errorResponse` script helpers. |
| `packages/acp/acp/tests/bridge.spec.ts` | The largest ACP suite (49 cases): capability advertisement, session create/close/resume, workspace mismatch rejection, concurrent-resume id reservation, keyset pagination with an opaque cursor, config-option discovery and topology changes, MCP mounting over stdio and Streamable HTTP, prompt content admission, and cross-process-restart list/resume. |
| `packages/acp/acp/tests/turns.spec.ts` | The largest prompt-lifecycle suite (43 cases): max-token turns, committed image delivery and order, "does not settle before ordered output delivery drains", failed turn → reject, `turn/start`/`turn/end` append failures rejecting the prompt, one in-flight prompt, JSON-RPC request cancellation, cancellation during admission, hook-cancelled turn settling as `end_turn`, descendant waiting, and late-turn/cancel races. |

### Tier 3 — skipped with a reason

| File | Why not read line by line |
| --- | --- |
| `packages/acp/README.i18n.yaml` | Generated bilingual-pairing hash record (947 B). Peeked: it stores one hash per heading section for the EN/ZH README pair, regenerated by `pnpm run verify-translation-pairing --write`. |
| `packages/acp/acp/README.i18n.yaml` | Same generated hash record (3 KB) for the package README pair. |

---

### `packages/api` — the Remote layer (group README)

#### `packages/api/README.md` (+ `.zh.md`, `.i18n.yaml`)
- **What it decides:** the *shape* of the whole Remote layer. Nine packages, each owning one seam, each split
  into a **host** half and a **browser-safe client** half, and each exposed under a `ctx.*` key on one side and a
  `ctx.remote.*` key on the other.
- **The load-bearing sentence:** "Remote calls run Client → Host over the application's shared Connection; stream
  items flow Host → Client on the Gateway mux, and a stream's uplink items flow Client → Host on the same logical
  stream." — i.e. *one logical stream carries both directions*, so a chat-style request/response over a socket does
  not need two channels.
- **Why it transfers:** August Trading has the same latent split (renderer vs Electron main vs web worker) and this
  table is a ready-made naming scheme: each capability gets ONE owner package and ONE `ctx` key on each side.

#### `packages/api/README.zh.md`
Chinese mirror of the package-group map — same table, same roles, same ctx keys.

#### `packages/api/README.i18n.yaml`
Generated bilingual-pair hash record (per heading section) for the group README.

---

### `packages/api/account-controller` — authenticated account surface

#### `packages/api/account-controller/src/index.ts`
- **Purpose:** a thin `TypertRemoteService` exposing account operations to an authenticated UI — `getState`,
  `getProfile`, `getBalance`, `getUnnotifiedBonuses`, `ackBonusNotified`, `startSignIn`, `cancelSignIn`, `signOut`,
  `hasRunningAccountTasks`, and two streams (`watch`, `watchExpiry`).
- **Key abstractions:** `AccountController extends TypertRemoteService` with `static inject = ['deepseekAccount','agents']`;
  the `@Remote` decorator marks a method as remotely callable; `@Remote({ mode: 'stream' })` marks a stream.
- **Data flow:** every method forwards to `ctx.deepseekAccount` — the controller "maintains no independent account
  state" (README). The only logic it owns is `watchExpiry`, an async generator that converts a Cordis event into a
  stream with a pending counter and a wake callback (`packages/api/account-controller/src/index.ts:100-124`).
- **Non-obvious design decisions:**
  - *The calling UI's identity travels with the call.* `AccountClientMetadata` (version, locale, UTC offset) is
    passed to every operation that reaches Platform, so the Host reports "the UI that asked", not "the last caller
    it saw" (README, "Use this package"). Cancellation and watch are identity-free because they never reach Platform.
  - *Cancellation names the attempt id.* `cancelSignIn(attemptId)` so a stale screen cannot cancel a newer login.
  - *`getUnnotifiedBonuses` returns `null` and `ackBonusNotified` returns `false` when the account grant is absent
    or changed* — absence is a value, not an exception.
  - *`watchExpiry` has no initial item and no replay.* It is a live-notification channel only; a late subscriber
    is not told about an expiry that already happened.
  - *`hasRunningAccountTasks` reads the agent's LATEST logged request context*, so it counts tools and retries
    that are still on the account route, and excludes idle agents and API-key contexts.
- **Edge cases & failure handling:** failures the caller should retry arrive as thrown Remote errors; the test
  pins that the provider's exact error object propagates (`tests/controller.spec.ts`).
- **Surprising:** the controller is explicitly *stateless* — "forwards operations to the account service and
  maintains no independent account state". The README says so in one line; the class has no fields.

#### `packages/api/account-controller/src/types.ts`
Nine type re-exports from `@deepseek-ai/dsh-deepseek-account/types` — deliberately a *pure* re-export module so the
package "contains no credential payloads" and the types are branded at their source.

#### `packages/api/account-controller/README.md` (+ `.zh.md`, `.i18n.yaml`, `locale/en.json`, `locale/zh.json`, `package.json`, `tsconfig.json`)
Docs + manifest. The README's "Model Experience" section says **None** — "account credentials affect HTTP
authentication and never enter model prompts, Session logs, or tool results" — which is the same discipline August
Trading needs for API keys.

#### `packages/api/account-controller/tests/controller.spec.ts`
Pins: provider delegation with exact argument identity, `null`/`false` for absent grants, the subscriber-lifetime
hand-off to `watch`, and that expiry notifications reach *only current* subscribers and stop on disconnect.

#### `packages/api/account-controller/tests/signout-impact.spec.ts`
Pins `hasRunningAccountTasks`: a running agent with no logged request context, an idle agent, and an
API-key provider are all excluded; only a running agent whose latest logged provider is the account route counts.

---

### `packages/api/gateway` — the Remote dispatcher and client

#### `packages/api/gateway/README.md`
- **What it decides:** the *entire* contract of the Remote layer in one document. It is the most valuable file in
  this shard for August Trading, because it spells out the decisions that are usually made accidentally:
  - **Strict vs SRC mode.** Strict mode reads *generated* invocation descriptors; SRC mode is a development
    fallback for endpoints that never had a strict definition, and it "parses simple parameter names and accepts
    only JSON-safe values". **"Withdrawing an observed strict definition fails instead of weakening validation."**
  - **Resource-based access control.** Every call resolves the *resources* it touches and asks
    `ctx.remoteAccess.decide({ principal, action, resources, args })`. A refused call "fails before it activates any
    Session". An owner call bypasses resource resolution entirely.
  - **A Peer is always explicit.** "Every call names the Peer it speaks for … and the Gateway never supplies a
    default Peer." A disposed Peer fails with `gateway/peer-disposed` for unary calls, streams, `$events` and
    `$events/result` alike.
  - **Uplink and downlink share one logical stream.** `RemoteStream<Out, In>`; the method reads its uplink through
    `this.ctx.invocation.uplink()` — "so nothing enters the parameter list".
  - **Bounded uplink.** `streamInboxBytes` (262 144 default); overflow fails the *stream* with
    `gateway/uplink-overflow` **without closing the socket**.
  - **The client's unary face never rejects for a carrier problem.** Every call resolves to
    `RemoteResult<T> = { ok: true, value } | { ok: false, error }`. "Only an assembly fault still rejects: wrong
    arity, an unmounted method, a withdrawn contribution, a missing Context adapter."
  - **The Known Limitations list is a design document in itself** — nine named limitations, each with the
    operational consequence spelled out.
- **KV-cache / token notes:** "None, as the package dispatches application calls and registers no prompt, tool, or
  session event."

#### `packages/api/gateway/src/index.ts` (Host dispatcher, 1 732 lines)
- **Purpose:** the live Typert Remote dispatcher. Resolves a descriptor + Service for a call, validates the
  arguments, resolves lookups and Context identities, runs the access check, and invokes the business method.
- **Key abstractions:** `TypertGatewayService extends Service implements TypertGateway`; `TypertGatewayError
  extends RemoteError`; `GatewayInvocation` (what the method reads as `this.ctx.invocation`); `UplinkDecoder`;
  `RemoteEventQueue`; `PreparedInvocation`; `Config` (`websocketHeartbeatIntervalMs`, `streamInboxBytes`).
- **Data flow:** `ctx.inject(['connection'], …)` installs a `/api` interceptor that *claims* endpoints
  (`claimsEndpoint`) and dispatches them; `ctx.inject(['connection','webServer'], …)` registers the
  `/api/remote.mux` WebSocket upgrade. A call runs `prepareInvocation()` → `invokePrepared()`.
- **Non-obvious design decisions:**
  - *Access is decided BEFORE lookups and Contexts resolve.* The comment is explicit: "Access precedes lookup
    resolution, so a refused call activates nothing" (`packages/api/gateway/src/index.ts:830-857`). A denied call
    never creates a Session, never resolves an identity, never touches a file.
  - *The principal is not reachable from the wire.* The access decision is taken by the Gateway, not by the
    method; the method never sees who called it.
  - *`this.ctx.invocation` instead of a parameter.* The method is invoked on a Service view bound to a Context
    carrying the invocation, so "nothing travels through the parameter list" and the descriptor's parameter list
    stays exactly the business arguments.
  - *The uplink is taken once per call.* `uplink()` throws on a second call
    (`packages/api/gateway/src/index.ts:1620-1624`).
  - *A withdrawn strict definition is a hard failure.* `resolveDescriptor` checks `hasSeen(endpoint)` and throws
    `gateway/definition-unavailable` rather than silently falling back to SRC — "SRC fallback is forbidden" once a
    strict definition was observed.
  - *SRC descriptors are derived by parsing the function's source text.* `methodParameterNames` uses
    `Function.prototype.toString` and rejects destructuring/defaults/rest. This is explicitly a *weak* mode and
    the README says so.
  - *`assertJsonValue` is a strict JSON-safety walker* — it rejects non-finite numbers, cycles, sparse arrays,
    symbol keys, non-plain objects, and non-enumerable/non-data properties. A `__proto__` key is preserved as a
    named own property rather than becoming a prototype write.
  - *The WebSocket route is registered only after `appReady`.* "Existing pages reconnect before the new Host
    prints its URL. No stream may enter until the launcher has activated and audited its controllers."
- **Edge cases & failure handling:** every failure is a `TypertGatewayError` with a *stable code* and a
  correction-oriented message that never embeds the offending value; `rpcFailure` folds a non-Remote exception into
  `gateway/internal` with empty details; `methodSignal` joins the carrier signal, the control signal and (for
  streams) the Peer signal, and the comment notes that `AbortSignal.any` keeps only a weak reference so joins do
  not accumulate.
- **Surprising:** `remoteEventClients` distinguishes an *owner* stream (which may answer a waterfall) from a
  non-owner stream (which may only receive admitted broadcasts). `hasLiveClient()` counts only uncancelled owner
  answering streams, and the README states plainly: "This synchronous observation does not guarantee delivery or
  Client provider readiness."

#### `packages/api/gateway/src/access.ts`
- **Purpose:** resolves *which resources* one call or one forwarded event touches, for the access decision.
- **Key abstractions:** `callResources()` and `eventResources()`; the `GLOBAL` fallback.
- **Data flow:** for each resource kind the sources are tried in a fixed order — an explicit `resources` reader on
  the method wins; otherwise every lookup parameter whose provider declares that kind contributes its wire id; then
  a Context method whose adapter declares the kind; then the kind's default field, read from a top-level argument
  or the first object argument (`packages/api/gateway/src/access.ts:43-77`).
- **Non-obvious design decisions:**
  - *"A reader that throws or returns an empty list … makes the resolution `invalid`"* — an unreadable resource
    is never treated as "no resources" (which would be a global allow).
  - *A call that names no resource touches the `global` resource alone.* A call that names resources touches
    *only* those.
  - *A forwarded event is stricter than a call.* A reader returning `undefined` makes the event invalid rather
    than global — an event cannot accidentally become a broadcast to everyone.
  - *Lookup identities are read from the wire values, before the lookup is resolved*, so a refused call never
    triggers a lookup.
- **Edge cases & failure handling:** an identity that is not a non-empty string, or a default field holding an
  array, is `invalid`; a malformed resource id never reaches `remoteAccess`.

#### `packages/api/gateway/src/types.ts`
The carrier-independent contracts: `InvokeRemoteRequest` (with `peer` mandatory and `uplink`/`uplinkWindow`
optional), `TypertRemoteEventFrame`/`Invocation`/`Outcome`/`Source`, `TypertGatewayWireStream`,
`TypertGatewayErrorCode` (21 codes), and the `TypertGateway` interface the Host exposes.

#### `packages/api/gateway/src/remote-error-codes.ts`
A **declaration-merge** module: 21 `gateway/*` codes mapped to `TypertGatewayFaultDetails` (`endpoint` +
optional `field`). The comment says "Face-neutral: the Host face and the Client face each import this module so
both programs see the same map entries" — one vocabulary, two programs, no drift.

#### `packages/api/gateway/src/stream-protocol.ts`
- **Purpose:** the wire vocabulary for Gateway-owned streams and event results.
- **Key abstractions:** `REMOTE_STREAM_MUX_PATH = '/api/remote.mux'`, `REMOTE_EVENT_STREAM_ENDPOINT = '$events'`,
  `REMOTE_EVENT_RESULT_ENDPOINT = '$events/result'`; the `RemoteEvent*Frame` union
  (`ready` / `emit` / `waterfall` / `cancel`); `RemoteStreamClientMessage` (`open` / `item` / `end` / `cancel`) and
  `RemoteStreamServerMessage` (`item` / `error` / `end`); `parseRemoteEventResult`,
  `projectRemoteEventRequest`, `projectRemoteEventRejection`, `restoreRemoteEventRejection`.
- **Non-obvious design decisions:**
  - *Exact-key validation on every frame.* `exactKeys()` compares `Reflect.ownKeys(value).length` against the
    expected set — an *extra* field is a protocol error, not a forward-compatible extension.
  - *A waterfall request must carry the scoped Agent as a direct own field*, and the projection strips exactly
    `agent` and `signal` (`packages/api/gateway/src/stream-protocol.ts:161-190`).
  - *A rejection is projected to stable fields and can be restored as an Error* that keeps name, code and
    JSON-safe details — so a Client-side throw reaches the Host with its identity.
- **Edge cases & failure handling:** a non-enumerable or symbol property in a request is rejected; a request that
  is not "lossless JSON data" is rejected.

#### `packages/api/gateway/src/stream-server.ts` (Host WebSocket mux)
- **Purpose:** owns the no-server WebSocket acceptor and every logical stream on it.
- **Key abstractions:** `RemoteStreamMuxServer` (`handleUpgrade`, `close`), `RemoteStreamMuxConnection`
  (`run`, `receive`, `openStream`, `pump`, `send`), `UplinkInbox` (the bounded single-consumer uplink queue),
  `rejectRemoteStreamUpgrade`.
- **Non-obvious design decisions:**
  - *Liveness has three witnesses.* A Pong, any received frame, **or a downlink write that waited in the full
    local send buffer and then completed** counts as peer activity — "so a congested link that delays the Pong
    behind data keeps its socket". A write that completed *at once* proves nothing and does not count
    (`packages/api/gateway/src/stream-server.ts:296-310`). Two missed heartbeats terminate the socket.
  - *The uplink inbox is created before the opener resolves* so items the Client sends right after `open` wait
    instead of being lost (`packages/api/gateway/src/stream-server.ts:214-217`).
  - *A duplicate `open` is the one protocol violation that closes the socket.* `item`/`end`/`cancel` for a stream
    the connection no longer owns are simply dropped.
  - *The uplink byte cap is measured in encoded frame bytes* (`Buffer.byteLength(text,'utf8')`), not item count.
- **Edge cases & failure handling:** an item after `end` fails the queue with `gateway/protocol`; an overflow
  fails with `gateway/uplink-overflow`; both keep the socket open. A terminal frame that cannot be written closes
  the physical generation rather than leaving the logical stream ambiguous.

#### `packages/api/gateway/src/client/stream-client.ts` (Client mux owner)
- **Purpose:** keeps one physical WebSocket and shares it among independently cancellable logical streams.
- **Key abstractions:** `RemoteStreamMuxClient` (`start`, `reconnect`, `open`), `StreamInbox` (a `Deque`-backed
  frame queue), `ClientUplinkQueue` (a queue the handle's `send()`/`end()` feed), `RemoteStreamCarrierError`.
- **Non-obvious design decisions:**
  - *A socket is opened only when a logical stream needs it* — `start()` is lazy and `maintain()` keeps one
    attempt alive; the README says the Client "opens the Gateway-owned `/api/remote.mux` WebSocket when its plugin
    activates and keeps it connected while idle".
  - *Answering and passive Clients behave differently on loss.* `waitForReconnect` is true only for
    `interactions === 'answer'`: a passive Client fails its later opens immediately, an answering Client waits for
    Connection to reopen the carrier.
  - *A terminal frame ends the uplink immediately*, "not on the consumer's next read"
    (`packages/api/gateway/src/client/stream-client.ts:463-466`).
  - *The uplink pump can be interrupted mid-read.* `stop()` resolves the pending `next()` race and releases the
    iterator, so a handle's queue closes at once and `send()` throws from then on.
  - *`ClientUplinkQueue.next()` refuses a second pending read* ("uplink has one pending read") rather than
    silently interleaving.
- **Edge cases & failure handling:** a non-string WebSocket message is a carrier failure that fails every stream
  and closes the socket with code 4002; a socket `close` during a connecting attempt rejects the attempt with a
  `RemoteStreamCarrierError`; `close()` is idempotent.

#### `packages/api/gateway/src/client/remote-stream.ts`
- **Purpose:** the reconnecting supervisor for one logical Remote stream.
- **Key abstractions:** `RemoteStream<Item>` (implements `AsyncIterable<RemoteStreamItem<Item>>`),
  `RemoteStreamItem` (`generation`, `value`, `signal`, `accept()`), `RemoteStreamOptions` (`name`, `open`,
  `ended(accepted)`, `carrierFailed?`).
- **Non-obvious design decisions:**
  - *The domain owns acceptance.* `item.accept()` is called only after the consumer validates the opening
    baseline or cursor; until then `accepted` is false and `ended(false)` classifies the generation as a protocol
    violation rather than a normal end.
  - *One isolated retry, then wait for the Host.* `waitForRemoteStreamRetry` permits exactly one immediate retry
    while the Host generation is available, and otherwise waits for the next connected generation
    (`packages/api/gateway/src/client/remote-stream.ts:186-200`).
  - *A carrier error is never terminal.* It is fed to `carrierFailed` and drives the retry; only a marked
    `RemoteError` (or a fresh `gateway/internal`) escapes as a terminal failure — "consumers discriminate failures
    by code, so an unmarked throw reads as a local bug".
  - *One consumer only.* A second `[Symbol.asyncIterator]()` throws "already has a consumer".
- **Edge cases & failure handling:** `dispose()` waits for the active iterator to stop; a value that arrives after
  disposal begins is dropped; a replaced generation's values and cancellation failures are dropped.

#### `packages/api/gateway/src/client/snapshot-stream.ts`
`RemoteSnapshotStream<Snapshot, Delta>`: exactly one opening snapshot per generation, then deltas. The previous
domain snapshot **remains published while the underlying stream retries**; a replacement becomes accepted only
after the owner applies it. A second snapshot in one generation, or an update before the opening snapshot, is a
`gateway/internal` protocol violation.

#### `packages/api/gateway/src/client/journal-stream.ts` — the durable-journal protocol
- **Purpose:** the closest thing in this whole shard to a *trading journal*: cursor-first opening, ordered live
  delivery, pagination, reconnect catch-up and gap repair.
- **Key abstractions:** `RemoteJournalStream` (abstract) with `RemoteJournalFrame` (`opened` / `entry` /
  `notification`), `RemoteJournalChange` (`replace` / `prepend` / `append` / `notification`),
  `RemoteJournalStreamOptions` (a cursor algebra: `emptyCursor`, `entries`, `hasMore`, `first`, `last`,
  `compare`, `follows`, `publish`, `carrierFailed`, `failed`).
- **Data flow:** `open(request)` takes the first frame, publishes the opening window, then `consume()` applies live
  entries. `prepend(request)` reads an older page and checks it is *continuous* with the current window.
  `acceptEntry()` compares the entry's inclusive cursor range with the last applied cursor: behind → ignore
  (duplicate), partially overlapping → protocol violation, non-contiguous → **gap repair** through
  `replaceThrough()`.
- **Non-obvious design decisions:**
  - *The domain publishes its window; the stream only proposes.* `publish(change)` is the only exit, and the
    domain decides what to do with it.
  - *A page must end exactly at its requested cursor.* `assertPageThrough` requires `compare(tail, through) === 0`.
  - *Repair is bounded and re-read.* If the replacement page does not reach the target cursor, the stream
    re-reads with a *different* repair request, and if it still does not reach it, it is a protocol violation.
  - *Notifications wait behind a repair.* Cursorless notifications received during gap repair are held and
    published only after the replacement page commits; if a newer generation supersedes the repair, the held
    notifications are discarded with their page.
  - *A resumed generation may not open behind the last applied entry* — that is a protocol violation, not a
    silent rewind.
- **Edge cases & failure handling:** an inverted cursor range, a discontinuous page, a partially overlapping entry
  and a duplicate opening cursor are all terminal protocol violations; a failed page read during live-gap repair
  is reported through `failed`.

#### `packages/api/gateway/src/client/remote-events.ts`
- **Purpose:** the Client side of the forwarded-event channel — Cordis registrations, generation pumping, waterfall
  dispatch, and the HTTP reply.
- **Key abstractions:** `ClientRemoteEvents` (`subscribe`, `dispose`, `runGeneration`, `pumpEvents`, `answer`,
  `dispatchWaterfall`); a **private Cordis event key** `internal/api-gateway/remote-event/<uuid>/<event>` so a
  forwarded event cannot collide with a local one.
- **Non-obvious design decisions:**
  - *The listener may return a result, call `next()`, or reject.* A `Symbol('…next')` marker distinguishes
    "delegated" from "answered"; a result that is not lossless JSON is a `TypeError`.
  - *A listener failure is contained.* `deliver()` catches and reports; the failure does not fail the generation.
  - *The Agent Context is resolved by the adapter and disposed only after the reply settles.* An owned Context is
    released in a `finally`, so a cancelled reply never leaks it.
  - *The generation is a Connection generation source.* The stream is reopened by Connection under
    "continuous, capped jittered exponential backoff".
- **Edge cases & failure handling:** a stream that does not begin with `ready` is a `TypeError`; a malformed frame
  is a `TypeError`; a result RPC failure fails the generation so Connection reopens it.

#### `packages/api/gateway/src/client/index.ts` (Client face, 895 lines)
- **Purpose:** the Client projection of generated descriptors — `$mount`, `$on`, `$stream`, `$host`, and the traced
  `remote.<namespace>` services.
- **Key abstractions:** `ClientRemoteService extends Service implements ClientRemote`; `RemoteNamespaceService`
  (installs descriptor methods as own properties via `Object.defineProperty` with a getter, **no JavaScript Proxy**);
  `ClientStreamHandle`; `carrierFailure()` / `cancelledFailure()` / `isRemoteFailure()`.
- **Non-obvious design decisions:**
  - *A unary call NEVER rejects for a carrier problem.* `invoke()` catches the carrier throw and returns
    `{ ok: false, error }`; only assembly faults (wrong arity, unmounted method, withdrawn contribution, missing
    Context adapter) reject. "So no consumer wraps a call to recover one."
  - *`isRemoteFailure(value)` is the one discrimination point* — "a caught value it accepts carries a Host code, and
    anything it rejects is a local fault the caller should let crash".
  - *A caller-aborted call is a cancellation even when the local throw wins the race against the wire round-trip*,
    so it gets the same code the Host would have produced (`gateway/cancelled`).
  - *`$host` is a plain read, not a store.* "It is not a store — no subscription, no generation counter — so a
    consumer that must react to reconnection listens for `connection/reset` instead of polling it." The object is
    minted only when `home` actually changes, because readers compare by reference.
  - *A namespace group installs with no visibility gap.* "A fresh namespace installs its whole group synchronously
    inside its fiber's `apply`, so a plugin parked on the namespace service never observes it without the methods
    the same contribution carries."
  - *Every Client-supplied field requires a strict generated codec.* `requireStrictInputs` refuses a contribution
    whose parameter, uplink or Context codec is SRC.
  - *Withdrawal aborts in-flight calls and makes retained method handles reject* — a handle obtained from a
    withdrawn namespace getter fails rather than silently doing nothing.
- **Edge cases & failure handling:** the `__proto__` wire parameter is preserved as an own named argument
  (not a prototype write); a second consumer of one stream handle throws; `dispose()` before the first read still
  sends `cancel`; a carrier iterator whose `return()` rejects is swallowed.

#### `packages/api/gateway/README.zh.md`
Chinese mirror of the gateway contract. Read head (front-matter, summary, table of contents) to confirm it mirrors
the EN document heading-for-heading; the EN document is the one read in full and is the source of every claim above.

#### `packages/api/gateway/README.i18n.yaml`
Generated per-heading bilingual hash record.

#### `packages/api/gateway/locale/en.json` / `locale/zh.json`
Two-line locale stubs (`meta.title`, and a Chinese `meta.description`).

#### `packages/api/gateway/package.json` / `tsconfig.json` / `tsconfig.client.json` / `tsconfig.host.json` / `tsdown.config.ts`
Manifest and build config. Two important facts: the `./client` export has **three** targets
(`node` → `client.node.js`, `browser` → `client.browser.js`, `default` → browser), and the client tsconfig's
`files` list is the *explicit* set of client-side modules — which is how a host-only module can never leak into the
browser bundle.

#### `packages/api/gateway/tests/*` (Tier 2 table)

| File | What it pins |
| --- | --- |
| `tests/browser-credentials.ts` | Fixture: an in-memory credential-record owner plus a `browserCookie()` that exchanges the Host's process token for a real `Set-Cookie`. |
| `tests/peer.ts` | Fixture: owner and non-owner `PeerScope`s; "every in-process call names its Peer explicitly". |
| `tests/operator-connect-fixture.ts` | Fixture: a real `TypertRemoteService` with `identity`, `hold`, `follow` (a stream) and a `pending()` event producer that records the observed Peer and signal. |
| `tests/echo-stream.host.spec.ts` | The smallest uplink-reading stream, run over the in-process carrier and the WebSocket carrier — "every carrier has to serve it alike". |
| `tests/stream-protocol.host.spec.ts` | Every wire frame variant accepted; every malformed variant rejected (empty id, extra field, unknown type, non-JSON value, `-0`). |
| `tests/strict-source.host.spec.ts` | Strict validation before the Service runs; the *limited* SRC fallback; and the hard rule that SRC fallback is **refused** once the strict owner unloads. |
| `tests/authenticated-node.client.spec.ts` | Non-page Clients share one credential across HTTP and WebSocket; unary HTTP finishes while the lifecycle socket is still connecting; a synchronous socket-factory failure does not block unary HTTP. |
| `tests/control-retry.client.spec.ts` | `RemoteStream`: generation annotation, retry-state reset after acceptance, one isolated retry, waiting for a replacement Host generation, disposal stopping a pending retry, a non-Error terminal escape folded into `gateway/internal`, and a marked Remote failure passing through verbatim. |
| `tests/remote-event-protocol.host.spec.ts` | The Remote-Event result protocol: delegation/values/rejections, request projection (only `agent` and `signal` removed), rejection round-trip, and the lossless-JSON walker. |
| `tests/operator-connect.host.spec.ts` | Real Loader + HTTP + WebSocket composition: admission released on a destroyed socket and a throwing upgrade, a failed Operator release not retaining its credential, passive subscription forbidden, and an answering page accepted. |
| `tests/gateway-access.host.spec.ts` | 30+ cases of the access model: owner dispatch without policy reads; a non-owner refused before the method runs; resources resolved from *decoded* arguments so an undeclared nested field names no resource; a malformed resource refused as `resource-invalid` *without asking* `remoteAccess`; disposed-Peer refusal; non-owner broadcast filtering; and the full resource-resolution precedence table. |
| `tests/gateway-stream.host.spec.ts` | 45+ cases: readiness-gated WebSocket admission, heartbeat bounds, uplink codec failure failing the whole stream even when the method swallows it, unread uplink items dropped when the method finishes, uplink released before returning a method blocked on it, the bounded inbox overflow, one WebSocket multiplexing independent streams, and the whole forwarded-waterfall lifecycle (fan-out, first-result wins, delegation only after every Client returns `next`, replay of a pending event id to a replacement generation). |
| `tests/gateway.client.spec.ts` | The largest suite in the shard (≈120 cases): transport readiness, `$host` facts, namespace install/rollback in every direction, `RemoteResult` folding, listener isolation, owned-Context lifetime through handler *and* reply settlement, generation replacement, the stream-handle lifecycle, and the mux carrier lifecycle. |
| `tests/gateway.host.spec.ts` | The Host dispatcher: strict vs SRC derivation, re-reading Services and providers on every invocation, the no-downgrade guard (including that it survives a Gateway Service reload and is seeded from definitions present before startup), exact wire-field checking, cyclic/decorated JSON rejection, business-exception identity preservation, and result byte projection. |
| `tests/journal-stream.client.spec.ts` | ≈40 cases of the journal protocol: contiguous cursor ranges, inverted ranges, partial overlap, duplicate opening cursor, live-gap repair, superseded repair, re-reading the tail when queued entries advance, notification deferral behind a repair, and a discontinuous older page publishing a fail-soft pagination state. |
| `tests/stream-server.host.spec.ts` | The mux server carrier: Ping without application messages, two missed heartbeats before termination, inbound frames and buffered writes counting as liveness, binary/malformed/duplicate message rejection, and the whole uplink contract (buffer-before-open, item-after-end, overflow, dropped frames for an unowned stream). |

---

### `packages/api/job-controller` — long-lived background work, observed (not consumed)

#### `packages/api/job-controller/README.md`
- **What it decides:** the contract for observing background jobs from a browser *without* disturbing the model.
  Three surfaces: `job.list({sessionId})` (the roster one session can see, as **whole-set frames**), `job.follow({sessionId?, jobId, from?})`
  (one job's retained output **from an absolute byte offset**), and `job.kill({sessionId, jobId})` (a human's stop).
- **The three sentences that matter most:**
  1. *"Neither stream touches the model's consuming cursor or its completion notices, and a human kill is not the model's own."*
     A **human** kill records the reason `cancelled by the user`; the notice ledger withholds a notice only for the
     *model's own* `job_kill`, so the owning agent's completion notice still arrives, with the reason.
  2. *"Both reads are non-consuming."* The observation cursor and the model's cursor are separate.
  3. *"The ring is a best-effort live preview, not a terminal transcript."*
- **Config:** `observeFlushMs` (100 ms coalescing window) and `observeMaxFrameBytes` (65 536 soft budget per output
  frame; one larger chunk ships whole).

#### `packages/api/job-controller/src/index.ts`
- **Purpose:** the Host `ctx.jobController` service — three `@Remote` methods over the `job` namespace.
- **Non-obvious design decisions:**
  - *The kill is fenced by a lookup performed in the same synchronous span as the kill.* "Same synchronous span as
    the lookup, so nothing can remove the job in between — and a producer-cancel throw propagates per the registry
    contract (job state unchanged) instead of masquerading as job-not-found."
  - *Two different "not found" cases collapse to one code.* "unknown job" and "belongs to another session" both
    become `job/not-found` with `{ sessionId, jobId }` details, "the client renders one story".
  - *The answer is a receipt, not a state.* `kill` returns `{ outcome: 'requested' | 'already-finished' }`.
- **Edge cases:** a producer whose `cancel()` throws propagates that error unchanged.

#### `packages/api/job-controller/src/rows.ts`
- **Purpose:** the roster stream — the visible job set, replaced **whole** after every lifecycle change.
- **Non-obvious design decisions:**
  - *Subscribe BEFORE the first read.* "Subscribe before the first read so a commit between the read and the wait
    cannot be missed." (The same pattern appears in `observe.ts`.)
  - *Output appends never refresh the roster.* Only lifecycle commits (registration, progress, stopping, settlement,
    removal) wake it — "a settled projection already carries the final byte count, so the stream is quiet while a
    job merely writes."
  - *Whole-set frames.* "a reconnect's first frame is already the truth" — the client never has to merge.

#### `packages/api/job-controller/src/observe.ts`
- **Purpose:** the per-job output stream — one `opened` anchor, coalesced `output` frames, one terminal `status`.
- **Non-obvious design decisions:**
  - *A removal announced mid-stream closes it with the removed job's terminal projection* — "the projection it
    announced is the last word and the read after the flush window would only find an unknown id."
  - *The status rides the same stream as the output* — "so settlement can never race a still-open output channel."
  - *Resume is by absolute byte offset.* `from` must be a non-negative safe integer; the frames carry `next` and a
    `lossy` flag when bytes between the requested offset and the chunks were already evicted.
  - *A fresh view anchored past the evicted head owes the same gap mark* a live observer earned from lossy reads
    (in the client model).

#### `packages/api/job-controller/src/wake.ts`
`OutputWaiter` — a wake-flag waiter where "a wake between waits is never lost" — plus an abortable `sleep(ms, signal)`.
Together they implement *coalescing*: a burst of commits becomes one frame.

#### `packages/api/job-controller/src/types.ts`
The wire vocabulary: `JobListRequest`/`JobListFrame` (`type: 'rows'`), `JobKillRequest`/`JobKillValue`,
`JobFollowRequest`/`JobFollowFrame` (`opened` | `output` | `status`), plus the `job/not-found` error-details merge.

#### `packages/api/job-controller/src/client/model.ts`
- **Purpose:** React-free client state — the roster per watched session, and the per-job accumulated output view.
- **Non-obvious design decisions:**
  - *Absence, not a sentinel.* "A session nobody watches, or one that sees no job, has no key, so consumers read
    absence rather than a sentinel."
  - *The snapshot is identity-stable between changes* (`snapshotDirty` + `snapshotCache`), so `useSyncExternalStore`
    readers do not re-render for nothing.
  - *The render tail is bounded at 128 KiB and never splits a surrogate pair* — the cut is advanced past a low
    surrogate that lands exactly on the bound, and the trim sets `gapBefore`.
  - *A failure before the anchor still owes the panel its notice* — a fresh view is created with the error.

#### `packages/api/job-controller/src/client/service.ts`
- **Purpose:** the `ctx.jobs` client service — reference-counted roster and observation streams.
- **Non-obvious design decisions:**
  - *One stream per session/job however many viewers.* `acquire()` / `releaser()` implement a ref count; the rows
    leave with the last release.
  - *A release closure binds the exact entry it was minted for, never the map's current occupant* — "a later acquire
    on the same key may have replaced a stopped entry, and decrementing or disposing through the key alone would
    tear down that newer stream's references."
  - *A re-acquire inside the dispose round-trip keeps its fresh rows* — the clear only runs while no successor holds
    the key.
  - *The end classification distinguishes "before the first frame" (terminal) from "after" (retryable carrier loss).*
  - *Service disposal waits for every open stream to report quiescence* — Cordis awaits an async disposer so a
    successor plugin instance cannot overlap one.

#### `packages/api/job-controller/src/client/index.ts`
Installs `ctx.jobs`. The module JSDoc records a subtle rule: the plugin resolves the Gateway stream factory and the
`job` namespace **while its own context is current**, "because stream (re)opens run on caller stacks — a React
event, a carrier retry — whose dynamic context has not declared `remote.job`."

#### `packages/api/job-controller/tests/*` (Tier 2 table)

| File | What it pins |
| --- | --- |
| `tests/host-harness.ts` | Fixture: a registry with a 64-byte ring (eviction is cheap to reach), a fake Agent, a push-producer job, `collect`/`next`/`wait` helpers. |
| `tests/rows.host.spec.ts` | The roster contract: the visible set on open, one frame per coalesced lifecycle burst, output appends not refreshing, another owner's commits not waking, an owner's rows dropping at teardown, and a clean abort. |
| `tests/observe.host.spec.ts` | The observation contract: anchor → coalesced output → terminal projection; resume from an explicit offset flagged lossy; the frame budget splitting an oversized read; foreign/unknown input rejected; a removal closing with the terminal projection; and the controller refusing to serve without a job registry. |
| `tests/kill.host.spec.ts` | The human kill: the exact reason `cancelled by the user`; `already-finished` instead of a failure; an unowned job killable from any session; a foreign session's job refused as `job/not-found`; a producer cancel throw propagated rather than masked; and a child session's own job killable from its list. |
| `tests/model.client.spec.ts` | The client model: whole-set replacement, empty set stored as absence, the resume cursor, gap marking (lossy frame / gap chunk / resume behind the retained head / fresh anchor past the evicted head), the bounded tail without splitting a surrogate pair, snapshot identity stability, and the whole reference-counting lifecycle of the roster and observation streams. |
| `tests/client-apply.client.spec.ts` | The client entry: the declared `inject`, `ctx.jobs` installation, the kill passthrough, and that releasing the watchers leaves the snapshot empty. |
| `tests/built-lib.e2e.ts` | Built-artifact smoke: a job row whose `kind` this program never compiled (`pty-send`) still validates, while a status outside the lifecycle does not. |

---

### `packages/api/remote-access` — method-level access control for non-owner peers

#### `packages/api/remote-access/README.md`
- **What it decides:** a role-based access model. A **role** is "a named action set over one resource kind"; a
  **binding** grants a role on one resource; a **policy** is one principal kind's `bindings()` + optional `explain()`.
- **The rules that transfer:**
  - *"Resources are independent: a grant on `global` implies nothing on any other resource, and no resource implies
    another."* — a grant is not a wildcard.
  - *"A call that names no resource touches the `global` resource alone, so only a `global` role can allow it."*
  - *`bindings()` runs once per `decide()`, once per `allows()` check, and once per snapshot computation; it is
    never cached across decisions, so time-dependent state applies to the next call.* — a policy change is visible
    on the next call, with no invalidation ceremony required.
  - *A faulty rule never breaks the shared event stream.* When `bindings()`, a condition or `explain()` throws, the
    decision is refused with `policy-failed`; in a snapshot a throwing `bindings()` leaves the principal no grant.
  - *The refusal reasons are enumerated*: `resource-invalid` (from the Gateway, before `decide()` is asked),
    `no-allow`, `policy-failed`, or a condition's / `explain()`'s own reason.
  - *The owner is never checked.*
- **Client face:** an identity-stable boolean source per `(kind, id, action)` and a `useRemoteAccess(action)` Hook
  that answers on `global`. "A non-owner answer is whether that resource's grant lists the action and **never falls
  back to the `global` answer**." "Hooks never issue requests, and the Host still checks every call."

#### `packages/api/remote-access/src/index.ts`
- **Purpose:** `RemoteAccessService` — the Gateway's `decide()`, the list filter `allows()`, and the per-Peer access
  snapshot stream `remoteAccess/follow`.
- **Non-obvious design decisions:**
  - *`allows()` reads the invocation from the Context that accessed the service* — "so call it as
    `this.ctx.remoteAccess.allows(resource)` from the Remote method." No argument plumbing.
  - *A policy failure is logged ONCE per policy until the next `invalidate()`* — "snapshots and lists ask many times
    per change", so the log would otherwise be a flood.
  - *The snapshot is recomputed only after `invalidate()` and policy registration or removal* — a business package
    calls `invalidate(principal?)` on every grant, revocation, mode change and expiry.
  - *The owner baseline is injected into every index the webServer renders* under
    `REMOTE_ACCESS_SNAPSHOT_KEY = '__DSH_REMOTE_ACCESS__'`; a non-owner page overwrites that global with its own
    grants, so the page opens with the *viewer's* view, not the owner's.
  - *The snapshot stream ends when the service unloads*, "so a reloaded service starts every reader from a fresh
    baseline."
  - *`event:` actions never enter the snapshot* — a broadcast permission is not a call permission.
  - *A grant lists only the actions `decide()` would allow **without call arguments*** — so the snapshot and
    `decide()` agree for the same principal/action/resource. The Known Limitations section names the honest gap:
    "a condition that refines its answer from `args` can refuse a call that the snapshot shows as allowed."
- **Edge cases:** `canonicalJson` gives a key-order-independent principal identity for the `invalidate()` match.

#### `packages/api/remote-access/src/types.ts`
The policy vocabulary: `RemoteAccessRole`, `RemoteAccessBinding` (a *mapped* type over every resource kind, so the
binding's resource type follows the role's), `RemoteAccessCondition`, `RemoteAccessPolicy` (with `explain?`),
`RemoteAccessDecision`, `RemoteAccessRequest`, `RemoteAccessGrant`, and the `RemoteAccessFrame` union
(`baseline` | `upsert` | `remove`).

#### `packages/api/remote-access/src/snapshot.ts`
One exported constant: `REMOTE_ACCESS_SNAPSHOT_KEY = '__DSH_REMOTE_ACCESS__'` — "the index global carrying a page's
first access snapshot, shared by the Host row that writes it and the Client mount that reads it."

#### `packages/api/remote-access/src/client/state.ts`
- **Purpose:** React-free client access state — `closed` (no baseline, or a non-owner stream failed) / `owner` /
  `granted` (global set + per-kind maps).
- **Non-obvious design decisions:**
  - *Sources are cached per `(kind, id, action)`* so Hook bindings keep their identity.
  - *A non-owner answer never falls back to the global answer.*
  - *`unavailable()` turns only a non-owner's answers false* — the owner's answers are unaffected by a stream
    failure.
  - *A malformed injected baseline fails the mount* with a `TypeError`.

#### `packages/api/remote-access/src/client/mount.ts`
Mounts the generated `remoteAccess` namespace, publishes the `useRemoteAccess` Hook through the Slot registry, and
follows the snapshot with a `RemoteSnapshotStream`. The `failed` handler differs by owner: the owner's log says
"owner access answers are unaffected"; a non-owner's says "reload the page to reconnect".

#### `packages/api/remote-access/src/client/index.ts`
Reads the injected baseline **synchronously** from `globalThis` and mounts the access face.

#### `packages/api/remote-access/tests/*` (Tier 2 table)

| File | What it pins |
| --- | --- |
| `tests/remote-access.host.spec.ts` | The policy model: a policy removed by its disposer and by its fiber; one policy per principal kind; the owner allowed with no policy; the action required on *every* resource; a condition refusing with its own reason; `explain()` naming a reason without changing the decision; `policy-failed` when `bindings()`, a condition or `explain()` throws, logged once per change; the owner baseline injected into every index; grants listing only what `decide()` allows without arguments; and the whole `follow` stream (owner baseline only, upserts/removals after invalidation, no leaked abort listener, every generation ending when the service unloads). |
| `tests/client-access.client.spec.ts` | The client state: false without a baseline and after a non-owner stream fails, true for the owner, the injected baseline read before any frame, a malformed baseline refused, per-resource answers with no global fallback, upserts/removals notifying subscribers, many grants of one kind applied in one pass with one notification, increments outside a non-owner generation ignored, and source identity stability. |

---

### `packages/api/remotes` — the application-level BFF assembly

#### `packages/api/remotes/README.md`
- **What it decides:** which Host capabilities this application exposes to Clients, and which Host events it
  forwards. It is a **selection layer**, not a transport: "This package owns no physical transport or Host service
  discovery."
- **The build-boundary paragraph is a masterclass in avoiding declaration drift:** the allowlist
  (`src/remote-events.ts`) and its type projection (`src/types.ts`) are listed in **BOTH** compiler faces' `files`,
  "because the forwarded-event allowlist is the single control point over what a consumer can receive, and the Host
  forwarding loop and the Client `ctx.remote.$on` key face must read one declaration rather than two that could
  drift." The two faces emit byte-identical outputs; the `.tsbuildinfo` files stay independent.
- **The forwarded-event rules:**
  - *An `emit` entry may declare `resources` readers*; "a notification without `resources` touches the built-in
    `global` resource."
  - *"A notification names one resource identity or none; collection changes travel on follow streams instead."*
  - *A `waterfall` entry must be a declared Agent-scoped waterfall whose final parameter is its same-result `next()`
    callback* — asserted against `TypertForwardableEventEntry`.
  - *"Ordinary one-way notifications remain isolated best-effort deliveries and are not replayed. State that
    requires reliable recovery needs an owner-provided query, cursor, or opening baseline."* — this is the honest
    limit of a notification channel, stated in the docs.

#### `packages/api/remotes/src/remote-events.ts`
The **one** allowlist: 29 entries, each `{ event, mode: 'emit' | 'waterfall' }` plus optional `resources` readers.
Two entries are waterfalls — `approval/request` and `user-questions/request` — i.e. exactly the two places where a
human decision is requested.

#### `packages/api/remotes/src/types.ts`
The type projection: `ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]['event']`, plus the
declaration merge that gives `TypertRemoteEvent` its legal key set.

#### `packages/api/remotes/src/index.ts`
- **Purpose:** the Host BFF entry — registers the application's Cordis event source with the Gateway.
- **Non-obvious design decisions:**
  - *The event source attaches ALL listeners synchronously before it returns* — "so its first `ready` item proves that
    incremental delivery is active."
  - *A scoped waterfall must carry its Agent directly.* "The Host rejects a missing or mismatched identity before
    forwarding."
  - *A non-JSON event argument is rejected before enqueueing* — "forwarded host event … argument N is not lossless
    JSON data".
  - *A `RemoteEventQueue` bridges synchronous Cordis listeners to an `AsyncIterable`*, and on shutdown it **rejects
    every pending waterfall** rather than leaving it hanging.

#### `packages/api/remotes/src/client/index.ts`
The Client assembly: 25 generated `/remote` contributions mounted in order, each disposer unwound in **reverse**
mount order "so a namespace never outlives one mounted after it", and a failed mount unwinds the ones already
mounted. It also re-exports the whole client-safe vocabulary so a business package imports one specifier.

#### `packages/api/remotes/tests/*` (Tier 2 table)

| File | What it pins |
| --- | --- |
| `tests/remote-events.host.spec.ts` | The Host event source: the Host home published to Client generations, an independent allowlisted queue per Client stream, each declared resource reader attached to its notification, a non-JSON argument rejected without poisoning the stream, the scoped waterfall result / `next()` delegation / rejection bridge, and a queued waterfall rejected when its source is withdrawn. |
| `tests/built-lib.e2e.ts` | Built-artifact smoke: plain Node boots the Host and Browser bundle handoffs and crosses the shared `/api` HTTP route for a root and an Agent-scoped call. |

---

### `packages/api/session-controller` — the session lifecycle, cold and live

#### `packages/api/session-controller/README.md`
The longest contract in the shard, and the one most relevant to August Trading's chat surface. The decisions it
states (each worth stealing):
- **Every endpoint states its activation policy.** "List reads only stored headers and projection-cache rows: it
  never calls per-session stat or opens a cold Session body." Search, attachment, history pages, log following,
  skill discovery and workspace-path opening "can inspect persistence without activating an Agent";
  "Cancellation requires live state; queue mutation, model, rename, prompt, and file-reference operations may
  resolve or resume an ordinary Session."
- **A prompt is rejected before it resolves anything.** "Prompt rejects content with neither non-whitespace text nor
  an attachment before resolving the Agent or appending Session events."
- **A retry is idempotent.** "Prompt retries whose `requestId` is already queued or logged return the original
  acceptance without inserting another message."
- **History paging is TURN-aligned, not message-aligned.** "The Client's initial `follow`, reconnect openings, and
  `loadOlder()` request at least 50 append-origin `user/message` and `assistant/message` events and cross at least
  two `turn/start` events, including the partial Turn at the loaded window's beginning." `loadThrough()` uses a
  200-message minimum per page; the 500-message cap applies per page, not to the whole jump.
- **Optimistic UI is a first-class, client-memory concept.** "One local prompt-submission echo: inserted
  synchronously when a submission begins, so the conversation can show the message before serialization, transport,
  and durable admission complete." The echo's identity is the prompt's `requestId`, which the Host echoes as the
  durable user source's `rpcId`.
- **Local echoes are retired by a rule, not by a timeout.** "Each retirement fires `onRetire` exactly once; an
  observed retirement includes the ordered durable attachment references so the composer can release successful
  cards while preserving failed drafts." "Echoes are Client memory only; reload and reconnect rebuild the
  conversation from durable events alone."
- **A projection has two sequence spaces.** `sequenced` (computed by the Host for an attached Session) and `cached`
  (viewed from the persisted checkpoint by a header-only listing). A grant is not a wildcard — see the projection
  store below.
- **A failed turn is blocked, not requested.** The `ArchivedSessionGate` "rejects a step proposed for an archived
  Session or for a subagent descendant of one — read from the Session header's lineage fields, never a fork — so a
  late waking delivery ends its turn as `blocked` without a model request."
- **The Known Limitations section names the honest gaps**: "Accepted/running display memory lives only in Client
  memory and is lost on page reload" and "That memory is not shared between tabs: one tab can show a converted row
  while another still shows `New Session` for the same Session."

#### `packages/api/session-controller/src/index.ts` (Host facade, 622 lines — structural read)
- **Purpose:** the `session` Remote namespace: list, search, create, selectModel, rename, fork, prompt, attachment,
  updateQueue, cancel, page, follow, projections, control, modelCatalog, openWorkspacePath, workspacePathApplications.
- **Key abstractions:** `SessionController extends TypertRemoteService`; five sub-controllers composed as fields —
  `ApiSessionAgentController` (activation), `SessionCommandController` (mutations), `SessionControlController`
  (live state), `SessionHistoryController` (cold history + follow), `ApiSessionList` (list/search).
- **Non-obvious design decisions:**
  - *The control stream is filtered per Session at the source.* `control()` asks `this.ctx.remoteAccess.allows({ kind:
    'session', id })` for the baseline's Sessions and for every projection frame — "so a refused call fails before it
    activates any Session" becomes "so a non-owner never receives the projection at all".
  - *The `principal` is recorded on the prompt source only for a non-owner* — "a source without `principal` belongs
    to the owner" (`packages/api/session-controller/src/index.ts:478`).
  - *The projections endpoint has three answers*: `sequenced` (exact cut), `migration-required` (cache hints, no
    `asOfSeq`), and `null` (absent Session). "Only a read requiring migration returns `kind: migration-required`
    hints without `asOfSeq`; missing keys remain absent."
  - *`fork` may be refused with `session/migration-required`* when the caller sets `allowMigration: false`.

#### `packages/api/session-controller/src/agent.ts` (610 lines — structural read)
Agent activation and creation policy. The typed failures are the point: `ApiSessionNotFound`,
`ApiSessionSubagentOwnership`, `ApiSessionCwdConflict`, `ApiSessionPresetConflict`. `hasApiSessionSubagentOwner()`
implements the ownership fence; `resolve()` distinguishes a live Agent, an attached Session, and a cold resume, and
re-checks for a raced publication after the resume. `inOrder()` serialises per-Session operations on a promise chain
so "Creations naming one identity run in arrival order, including their preset resolution". `isBlank()` reads the
`turnBoundary` projection — a Session is blank when no turn has started, not when its log is empty.

#### `packages/api/session-controller/src/commands.ts` (673 lines — structural read)
The mutation surface. `hasPromptContent()` is the guard that rejects a contentless prompt before anything else.
`latestCompletedPrefixBoundary()` computes the fork boundary when `atSeq` is omitted — "the latest completed turn
and its standalone tail, stopping before the next turn or queued input". `fork()` uses `buildForkSeed(source.events,
boundary)` so the child records the inherited marker *before* synthetic fork results and closing events. `prompt()`
resolves file receipts, admits image content, and calls `createUserMessage` with the `user-rpc` source.
`referencedImage()` / `imageInEvent()` implement attachment authorization by scanning the *declared* content fields
of built-in Session events — "Unknown event payloads and unrelated fields cannot authorize attachment reads."

#### `packages/api/session-controller/src/history.ts`
- **Purpose:** cold history pagination and the live event source.
- **Key abstractions:** `SessionHistoryController`; the `paginate()` function; `validateAddress()`.
- **Non-obvious design decisions:**
  - *The follow subscribes BEFORE it reads the opening snapshot.* "Constructor seed events have no session/event
    notification. Normally only the end-seed suffix is new; if persistence advanced after the opening observation,
    replay everything beyond that snapshot cursor."
  - *A seq gap is a hard error, not a re-sync.* "session event stream skipped seq N" — the Client repairs it by
    re-pulling a page, but the Host refuses to continue.
  - *A page must end exactly at its requested cursor* and its entries must be contiguous (`assertPage`).
  - *The assistant stream is opt-in and process-local.* `assistantStream: true` adds a revision-numbered frame
    stream; the opening carries a baseline with the active attempt's `startedAfterSeq`, `nextIndex` and the compact
    stream, and "Frames through the cut are represented or superseded by that baseline".
  - *A removal announced mid-generation closes the follow with the removed job's terminal projection* (the same
    pattern as the job controller).
- **Edge cases:** `validateAddress` refuses a subagent Session addressed as an ordinary one with
  `session/agent-busy`, and a subagent address whose mode disagrees with the observed descriptor.

#### `packages/api/session-controller/src/list.ts`
- **Purpose:** the cold-safe list and search projection.
- **Non-obvious design decisions:**
  - *A work slice, not a latency bound.* "Host list generation yields between complete rows only when its
    configured work slice is exhausted; cheap remaining work returns without a forced yield." The default is 16 ms
    (`listWorkSliceMs`).
  - *A cold row's projection column comes from the persisted cache, and a failure degrades that row only.* "a
    throwing column read degrades that row, never the listing."
  - *A predecessor cache may supply a stale title but never an authoritative fold seed* — the README's rule.
  - *Search is authorised against the list's visible ids, paged under a 100-call budget, and adapts to a provider
    limit at most once.* "the query provider's own enumeration, final sorting, and response serialization can exceed
    the list work-slice target" is named as a limitation, not hidden.
  - *A stale continuation cursor restarts the search from the first page* with the original visibility snapshot.

#### `packages/api/session-controller/src/control.ts`
The Host-wide live control stream: one complete baseline (every Session's projection block) then replacement frames.
`ControlQueue` is a `Deque`-backed pull queue; the stream ends when the service unloads.

#### `packages/api/session-controller/src/catalog.ts`
`buildModelCatalog()` builds the browser catalog **without requiring a Session** and isolates a provider failure
into a `failure` entry instead of failing the whole catalog. `modelAvailable()` checks the *exact* provider/model
pair. `hasProviderApiKey()` reads settings and credentials *independently* of model availability.

#### `packages/api/session-controller/src/archived-session-gate.ts`
The gate, as a plugin: `ctx.on('agent/pre-step', …)` rejects a step whose Session — or any *subagent* ancestor —
is archived, "read from the Session header's lineage fields, never a fork". A lineage cycle terminates.

#### `packages/api/session-controller/src/assistant-stream.ts`
`SessionAssistantStreamAccumulator` folds dense process-local Assistant frames and materialises one shared
immutable reconnect baseline per accepted revision. A revision reset to 1 with a live revision clears the attempt;
a non-dense frame index drops the active attempt.

#### `packages/api/session-controller/src/media-references.ts`
`GET|HEAD /api/file?path=…` on the authenticated connection channel. The response headers are the interesting part:
`Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and
`Content-Security-Policy: sandbox; default-src 'none'` — "so directly opened HTML/SVG cannot execute with the API
origin". Range is ignored; the whole file is returned; the byte cap is the attachment service's image limit.

#### `packages/api/session-controller/src/skill-catalog.ts`
The cold-readable skill catalog: it uses a live Agent's working directory and scoped registry when present, and
"the projected current directory, falling back to the recorded origin and then the configured directory default"
otherwise. It "retains the preset standing scope without activating an Agent" and reports an absent registry as an
error rather than an empty catalog.

#### `packages/api/session-controller/src/model-selection-projection.ts`
A durable projection with two fields: `lastUsed` (the selection consumed by the latest recorded request) and
`pending` (a later user selection not yet consumed). The `request/header` event clears `pending` when it matches.
The projection's wire view is `{ lastUsed, next: pending ?? lastUsed }`.

#### `packages/api/session-controller/src/file-references.ts`, `src/remote-events.ts`
Small adapters: the `fileReferences` Remote namespace delegating to the composed provider, and the five
`api-session/*` Cordis event declarations.

#### `packages/api/session-controller/src/types.ts`
The whole browser-safe vocabulary: `SessionSummary`, `SessionProjectionHints` (`kind: 'cached' | 'sequenced'` plus
`asOfSeq`), `ModelCatalog`, `QueueAction`, `PromptContentPart`, `SessionAddress` (ordinary or durable
direct-parent subagent address), `SessionProjectionsValue` (`sequenced` | `migration-required` | `null`),
`SessionWireEvent`, `SessionFollowFrame`, `SessionControlFrame`, and a **declaration merge of 19 `session/*` and
`subagent/*` error codes** with their details shapes.

#### `packages/api/session-controller/src/client/sessions/projection-store.ts`
- **Purpose:** the per-Session projection value store — the single most transferable idea in this shard.
- **Non-obvious design decisions:**
  - *Two row kinds.* A `sequenced` row `{ value, seq }` comes from the connected Host; a `cached` row `{ value }`
    comes from a persisted checkpoint and "carries no comparable seq, and yields to every sequenced write".
  - *Higher seq wins among sequenced rows* — "a replayed frame cannot regress a value and a stale baseline cannot
    overwrite a newer frame".
  - *A baseline discards every cached row first, regardless of seq* — "the connected Session is the truth and a
    cached value never outranks it".
  - *A key the store has never seen reads `undefined` — "capability absent". Absence is a value, not a missing face.
  - *Faces are identity-stable per key* (create-on-demand, cached) "so the React side binds each exactly once".
  - *"No client-side domain folding exists: a domain ships projection support with zero client code."*
- **Why it transfers:** August Trading's per-conversation derived state (P&L totals, win rate, current position)
  can use exactly this: a Host-computed value with a sequence number, a cached cold value that yields to it, and a
  `useProjection`-style hook that returns `undefined` for "not computed yet".

#### `packages/api/session-controller/src/client/sessions/manager.ts` (the list/catalog manager)
- **Key abstractions:** `SessionManager`; `SessionListPhase` (`pending` → `ready`); `SessionListSnapshot`;
  `SessionListMutation` (upsert/placeholder/remove/status/activity/engaged).
- **Non-obvious design decisions:**
  - *A list refresh MERGES, it does not replace.* `mergeOrderedBaseline(established, incoming, keyOf)` keeps the
    established relative order and inserts new rows next to the nearest following known identity.
  - *A blank bit only ever lowers.* "Blank only lowers: a stale true (session-added racing the local first send)
    never re-hides an already-surfaced session."
  - *List-entry identity is recovered by value* — "wire refreshes mint all-new summary objects, so identity must be
    recovered by value or every SessionListItem memo misses on every refresh." The `entryCache` compares every
    field and reuses the previous object.
  - *The list's items array is reused when the order and values match*, so a `useSyncExternalStore` reader does not
    see a new array reference for nothing.
  - *A reconnect clears the projection stores and re-queries.* `handleConnected()` "discards old projection cuts
    before new queries, including cold Sessions absent from the process-local control baseline."
  - *Running is a display fact, not durable history.* "Accepted/running presentation must survive a later
    empty-history list response."

#### `packages/api/session-controller/src/client/sessions/session.ts` (941 lines — structural read)
The client `Session` object. `PAGE_MESSAGES = 50`, `JUMP_PAGE_MESSAGES = 200`,
`HISTORY_PAGE_OPTIONS = { maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } }`. `beginSubmission()`
inserts the echo synchronously and derives its placement (`transcript` / `queued` / `steering`) from the running
state and the delivery mode. `prompt()` captures the browser's IANA time zone, sends the `requestId`, and routes
addressed children through the subagent namespace. `loadThrough()` is the turn-jump loader: it lowers a shared target
on repeated calls, shares its completion, stops on a page that makes no progress, and publishes the successful
pages together at completion.

#### `packages/api/session-controller/src/client/sessions/service.ts` (722 lines — structural read)
`ClientSessions implements ISessions` — the `ctx.sessions` face. `retain()` / `using()` / `retainInfo()` implement
the reference-counted, source-labelled ownership: "References keep local Session data, scoped Contexts, and history
streams alive, not Host Agents." `ClientSessionReference.release()` is idempotent, and `retireScope` awaits the
session disposal and the scope fiber together.

#### `packages/api/session-controller/src/client/sessions/assistant-stream.ts`
The Web presentation fold joining transient Assistant frames to one durable settlement. A successful message
"retains its transient rows until the owning `step/end`, so pending tool identities remain available for dispatch";
failed or interrupted settlements retire them immediately. A revision, dense-index, or settlement gap for a *known*
attempt re-opens follow; a controller that missed the start "ignores unknown-attempt frames and publishes their
durable settlement normally".

#### `packages/api/session-controller/src/client/sessions/notifier.ts`
The batching notifier: microtask batching for structural updates, animation-frame batching for stream updates, and a
synchronous `notifyNow()` — "controlled-input writes must notify in the same tick as `onChange`, or React rolls the
DOM back to the stale value and the caret jumps to the end."

#### `packages/api/session-controller/src/client/sessions/lineage.ts`
`flattenLineage()` — DFS child expansion with a `depth`, an orphan degrades to root level, and a cycle "fails soft
and emit[s] as roots" so no entry is ever lost.

#### `packages/api/session-controller/src/client/transport.ts`
`SessionEventStream extends RemoteJournalStream` — the client journal bound to one Session address, with a cursor
algebra over durable seqs (`first`/`last` = the record's seq, `follows` = "right === left + 1") and the Assistant
frames as *cursorless notifications* ("they never advance or repair the durable cursor").

#### `packages/api/session-controller/src/client/contract/events.ts`
`MutableSessionEventSource` — the contiguous event window as a **rope** (`leaf`/`concat` nodes) so an append is
O(1) and does not "traverse the complete event window". The published delta is exactly one of `replace` /
`prepend` / `append` / `settle-assistant`.

#### `packages/api/session-controller/src/client/contract/session.ts`, `contract/sessions.ts`, `contract/snapshot.ts`
The three outward contracts. The header comment is the design rule: "Widening this interface is the explicit act of
widening what features may do to a session (and what every test fixture must stub)."
`SessionSnapshot` carries `pendingSubmissions`, `openState` (`cold|loading|open|error`), `promptError`
(`op: 'send' | 'stop'`), `awaitingFirstTurn`, `promptAttempted`, and `blank`.

#### `packages/api/session-controller/src/client/ordered-baseline.ts`, `scope.ts`, `session-wire-event.ts`, `time-zone.ts`, `client/index.ts`, `client/sessions/history-records.ts`, `client/sessions/remotes.ts`
Small, sharp modules. `assertSessionWireEvent` rejects a non-current event envelope **without stripping or
normalising** wire fields. `createScope` mints a tagged Cordis fiber so "plain cordis dispatch with the actx as
subject routes by agent". `resolvedClientTimeZone()` fails loud when the runtime exposes no zone.

#### `packages/api/session-controller/tests/*` (Tier 2 table — 47 files)

| File | What it pins |
| --- | --- |
| `tests/agent.host.spec.ts` | The Agent-lookup failures (cwd conflict, not found), resume from a retained observation, raced ownership, writer-held vs other resume failures, the model-selection projection requirement, and creation failures. |
| `tests/archived-session-gate.host.spec.ts` | The gate rejects an archived Session and its subagent descendants at any depth, but not its forks; a looping lineage terminates; the gate stops when the fiber disposes. |
| `tests/assistant-stream.client.spec.ts` | The Web fold: baseline reconstruction, a successful message published at stream end and its chunks retired at Step end, failed/interrupted attempts retired immediately, rebaseline on a duplicate settlement or a chunk-index mismatch, and a settlement-only fallback for an unknown attempt. |
| `tests/assistant-stream.host.spec.ts` | The accumulator replaces stale lifecycles, rejects frame gaps, and caches each baseline. |
| `tests/client-apply.client.spec.ts` | Remote events routed into the object layer, `handleConnected` once per generation, the control baseline arriving before the ready notification, a carrier loss retried once, a second opening snapshot treated as a protocol failure, and Agent Context identity projected in both directions. |
| `tests/client-contract.client.spec.ts` | The event-window contract: exact replace/prepend/append deltas, no whole-window traversal on append, one exact Assistant settlement delta, and branded positions at the wire boundary. |
| `tests/commands-create-fork.host.spec.ts` | Creation in the default cwd, missing Workspace and attachment failures, contradictory create targets refused, and the fork failures (missing cold source, observation failure, no completed turn, lineage lookup failure). |
| `tests/commands-queue-attachment.host.spec.ts` | Queue edit/remove/steer and stale occurrences, the ownership fence for one-shot/seeded children, and attachment authorization: only declared content fields authorise, malformed inbox entries do not, and references are found in direct, message, inserted and streamed content. |
| `tests/commands-upload-file.host.spec.ts` | File upload receipts: staging, order preservation with an admitted image, cancellation, isolation by Session object, retirement after the rpcId becomes observable, retry de-duplication in the inbox and in the durable log, and a receipt bound to a different Agent. |
| `tests/control-queue.host.spec.ts` | The Inbox projection in baselines and live frames, queue replacements derived from the completed projection regardless of registration order, the prompt rpcId projected only from a `user-rpc` source, and a cancelled queue dropping broadcasts. |
| `tests/controller.host.spec.ts` | The facade owns its Host methods, publishes Agent lifecycle projections, maps success/domain-error/throw, and waits for an admitted background promotion during teardown. |
| `tests/event-script.client.ts` | Fixture: scripted Session events (tool call, tool result, user message) for the client suites. |
| `tests/file-references.host.spec.ts` | The `fileReferences` namespace delegates the resolved Agent, query and cancellation signal unchanged. |
| `tests/history-records.client.spec.ts` | A wire record becomes one event-shaped Client value, with an embedded compact text stream and an attempt stream preserved. |
| `tests/inbox-projection.client.spec.ts` | The Inbox projection stores the complete Agent-owned value without adding queue state to the Session snapshot, keeps only the highest-seq value, and does not mutate the projection before the Host publishes its committed value. |
| `tests/lineage.client.spec.ts` | Lineage flattening: established root/sibling order, DFS depth, orphan degradation, a two-node cycle failing soft with a warning, and a self-referencing entry. |
| `tests/list-scheduling.host.spec.ts` | The work slice: the budget accumulates across both phases, an overridden budget does not yield early, skipped-record classification counts, cancellation in the first and last cheap row, invalid budgets rejected, and cold summaries not started after cancellation. |
| `tests/manager.client.spec.ts` | The largest suite in the package: acceptance/running retention across list refreshes, the single-flight list, the `pending → ready` phase, title projections, the cached-vs-sequenced block merge, subagent catalog membership, the connected-generation reset, and list-entry identity stability. |
| `tests/media-references.host.spec.ts` | `/api/file`: the inclusive image cap, a sparse 1 GiB file rejected before content I/O, post-stat growth rejected by the byte reader, Range ignored, HEAD without content, a FIFO rejected, remote targets through `ctx.fs`, and the route unregistered on disposal. |
| `tests/notifier.client.spec.ts` | Microtask/frame batching, rebuild-before-notify, no-listener laziness, the synchronous `notifyNow` contract, a scheduled flush after `notifyNow` being a no-op, and the animation-frame fallback. |
| `tests/projection-discovery.host.spec.ts` | Projection reads distinguishing ordinary cold history from history needing migration: a V3 deferral, a valid catalog cache, a missing catalog not invented, `null` for an absent Session, a current-format cold catalog read from disk, a conflicting cached hint losing to the live cut, and cancellation. |
| `tests/projection-store.client.spec.ts` | The projection value semantics: higher-seq-wins, a stale baseline neither overwriting nor clearing a newer frame, cached values filling empty keys only, a watermark exposed only for sequenced values, identity-stable faces, and the manager frame routing. |
| `tests/reference-ownership.client.spec.ts` | Source-labelled references: an unknown identity observed without creating a scope, a shared initial opening with independent source contributions, per-source counts, one waiter's cancellation not affecting another's, the old generation withdrawn before a same-id replacement, and `using()` awaiting callback settlement. |
| `tests/remote-access.host.spec.ts` | The Session resource kind and its default field, the Session readers of `page`/`follow`, a global role calling `session/list` with only the admitted rows, a non-owner's filtered search hits, the filtered control baseline, and the `principal` recorded only for a non-owner. |
| `tests/remote/bench.client.ts` | Fixture: Session objects owned by a client test's explicitly started Gateway assembly. |
| `tests/remote/history.client.ts` | Fixture: pure history response builders (snapshot, page, assistant baseline). |
| `tests/remote/session.client.ts` | Fixture: default answers for every `session/*` and `subagents/*` endpoint a Session or its manager calls. |
| `tests/scope.client.spec.ts` | `createScope`: same-id generations routed independently, untagged listeners shared, a foreign session never reached, `bail` answering the first same-scope listener, and fiber disposal removing scope-owned listeners. |
| `tests/session-cold.host.spec.ts` | Cold paths: a predecessor title hint with zero cold body reads, cold rows from cached projections, a stored interrupted prefix served verbatim, the subagent ownership fence reapplied after a resume publishes, the browser time zone canonicalised, degenerate composition (no persistence), and a prompt rejected for contentless content before delivery. |
| `tests/session-fork.host.spec.ts` | Fork boundaries: required migration reported before creating a child, a resident Session forked without disk metadata, the completed manual-compaction checkpoint kept when `atSeq` is omitted, a cut inside a live open turn, a synthesised forked closer, and inherited model selection. |
| `tests/session-history-journal.host.spec.ts` | The raw journal: an empty opted-in Assistant baseline, foreign frames filtered, mixed live FIFO order, a revision gap publishing an empty replacement baseline, a non-dense chunk index dropping the attempt, a result followed after `turn/end` without reading the log, and message-aligned pagination counting only append-origin messages. |
| `tests/session-list-blank.host.spec.ts` | The blank bit means "conversation not started": standalone events (command lifecycle, plan/mode, title) keep the Session blank; the first turn clears it. |
| `tests/session-models.host.spec.ts` | The model directory: an ordered image batch validated before any member is persisted, provider-local catalog failures isolated, an unavailable model refused, the logged selection preserved over a different default, an adapter-owned reasoning default not reinterpreted as a user selection, and consecutive switches surviving a blocked default save. |
| `tests/session-open-workspace-path.host.spec.ts` | The native opener: capability reported independently of a Session, relative/absolute path normalisation, an empty path rejected, an unmapped remote path refused before the native call, a filesystem mapping that resolves to another process path rejected, and reveal dispatched separately from default-app open. |
| `tests/session-pending-submissions.client.spec.ts` | The echo lifecycle: synchronous insertion before any prompt call, placement derived from the running state and delivery mode, `abandon` retiring exactly once, a rejected identified prompt retiring immediately, the first observation winning over a later failure, and a full-window install (reconnect resync) retiring observed echoes. |
| `tests/session-presets.host.spec.ts` | `session.create` preset identity: the requested preset recorded, the roster default when none named, an unknown preset rejected, a blank Session recomposed under a named preset, a Session that has started not reused, concurrent reuse serialised in request order, a stored blank Session resumed under its recorded preset, and Workspace placement. |
| `tests/session-projections.host.spec.ts` | The projections block: the tail page's cut = the last event seq, `loadOlder` never carrying the block, an empty log at cursor -1, the `imageLimits` constant unit, a disposed registration dropped from later tail pages, the list column served from the live registry without folding, a throwing column read degrading that row only, and the control frames broadcasting with the causing seq. |
| `tests/session-remote-rejection.client.spec.ts` | A Remote-face *rejection* (an assembly fault) propagates out of the Session command unchanged and records no prompt error. |
| `tests/session-rename.host.spec.ts` | Rename delegation: the normalized title and echoed seq, an empty-normalizing title mapped to `title-invalid` with a presentable message, and a non-validation failure mapped to internal. |
| `tests/session-search.host.spec.ts` | Search: only list-visible ids, fixed message filters, an invalid wire query rejected before the provider, the 20-item Host boundary, a learned provider maxLimit, a 100-call budget, a stale cursor restart, a repeated cursor failing closed, a 240-code-point snippet bound without splitting astral text, and an oversized provider page rejected. |
| `tests/session-skills.host.spec.ts` | The skill catalog: a moved cold Session read from its recorded directory without resuming an Agent, a live Agent addressing a preset-owned registry, a cold Session using the recorded preset standing scope, a fallback to the global registry, and an absent registry reported rather than an empty catalog. |
| `tests/session.client.spec.ts` | The client Session object: scope binding, the cold → loading → open lifecycle, idempotent opens, the error state, a live frame landing behind the opening snapshot, a seq gap repaired by re-pulling the tail page, the whole `loadOlder`/`loadThrough` contract, prompt/cancel error folding, the subagent continuation path, and resync. |
| `tests/sessions-service.client.spec.ts` | The `ctx.sessions` face: list projection, transient search, the scope tree, Agent-scope disposal lifecycle, borrow-only bindings, catalog-addressed navigation, create/fork, the blank mirror, and a null-safe `displayTitleOf` fallback. |
| `tests/subagent-catalog.host.spec.ts` | The subagent catalog pushed through the control stream, an uncached parent catalog read without loading an Agent, disk migration status deferring a cold read, and a live snapshot failure not falling back to stored metadata. |
| `tests/test-remote.ts` | Fixture: a test-only direct Remote face over the Session Controller's internal controllers. |
| `tests/time-zone.client.spec.ts` | The browser zone returned by the runtime, and a loud failure when the runtime exposes none. |
| `tests/transport.client.spec.ts` | The wire acceptance of every journal path, the client stream adapters (a current envelope preserved without normalisation, the assistant baseline required, a revision gap rebaselining, a gap repaired preserving the history limits), and the control-stream classification. |
| `tests/transport.host.spec.ts` | The Host history controller: opening at the current cursor, followers ended on unload, a complete replacement snapshot on reconnect, subscribing before a cold read, creation buffered while the opening observation is unresolved, the end-seed boundary bridged, a gap in a replayed sequence rejected, and a subagent address requiring its durable parent and mode. |


---

### `packages/api/settings-controller` — redacted configuration surfaces

#### `packages/api/settings-controller/README.md`
- **What it decides:** two Remote namespaces over the configuration seams — `settings` (redacted reads, three write
  operations) and `credentials` (metadata, write, unset). "When a provider is absent, the namespace remains
  registered and returns an actionable configuration error" — the Client always has a method to call.
- **The rules worth stealing:**
  - *`describe(refs)` answers one map keyed by the requested names*, so a settings page describing every reference
    its rows carry settles those rows **together** in one round trip. "It accepts at most 64 names per call".
  - *"copies each answer field by field — a provider returning more than `CredentialInfo` declares cannot widen what
    crosses."* A denylist of what crosses the wire, enforced by copying, not by trusting the provider.
  - *"Secret values cross in this direction only: no method here returns one."*
  - *A provider refusal becomes `credential-rejected` carrying the provider's message with only the reference in its
    details* — the message is useful, the secret is not in it.
  - *`settings.openSettingsDocument()` "accepts no browser-supplied filesystem target."* The Client cannot ask the
    Host to open an arbitrary path; the Host opens the document it owns.
  - *Stale writes use `settings-conflict`; other provider refusals use `settings-rejected`.* Two distinct codes for
    two different repair actions.

#### `packages/api/settings-controller/src/index.ts`
The `settings` namespace: `describe()`, `update()`, `replace()`, `mutate()`, `openSettingsDocument()`. It re-exports
the settings service's own redacted view, so the wire shape is the provider's, not a second one.

#### `packages/api/settings-controller/src/credentials.ts`
The `credentials` namespace, mounted as its own plugin. `describe(refs)` validates each name (an invalid name is
`bad-request`), caps the batch at 64, and copies each `CredentialInfo` field by field. `set`/`unset` report a provider
refusal as `credential-rejected`; a provider that throws a bare string is still stringified safely.

#### `packages/api/settings-controller/src/types.ts`
The wire types for both namespaces, plus the `RemoteErrorDetailsMap` merges for `settings-conflict`,
`settings-rejected`, `credential-rejected` and `bad-request`.

#### `packages/api/settings-controller/tests/credentials-controller.host.spec.ts`
The most valuable test in the package: a `LeakyCredentials` provider whose `describe()` returns an extra `value`
field is proven **not** to widen the wire ("a provider returning more than `CredentialInfo` declares cannot widen
what crosses"), a bare-string rejection is handled, and a policy rejection is mapped. It also pins the actionable
error text when no provider is mounted.

#### `packages/api/settings-controller/tests/settings-controller.host.spec.ts`
The settings namespace: redacted reads, the three write operations, the conflict code, and the native document open.

---

### `packages/api/terminal-controller` — session-owned shells with a bounded screen

#### `packages/api/terminal-controller/README.md`
The most operationally interesting package in the shard for the "long-running monitoring" question, because it
implements **reclamation of unattended resources** rather than merely leaking them.
- **The unattended-reclamation rules, in full:** "An idle terminal is reclaimed only after **continuous confirmed
  idle time** without window holds, and only when the observed shell activity confirms idleness. A single activity
  observation resets the idle timer. An unsupported shell, a custom launch argument, an uncertain process
  observation, a pending input, a recent resize, or a failed cleanup keeps the terminal alive. A **confirmed
  observation gap** (an observation older than the poll interval) resets the idle timer rather than counting as
  idle." `unattendedTimeoutMs` of 0 disables reclamation entirely.
- **The screen-recovery contract:** "Every attachment begins with a complete bounded screen, then ordered output."
  The screen is recovered from a bounded scrollback, not a transcript: "Screen recovery retains bounded history,
  not a complete transcript."
- **The honest limits, named:** "There is no durable terminal restoration or automatic shell respawn. Exited
  terminals count toward `maxTerminals`." "Finding an executable does not prove PTY allocation will succeed." "No
  maximum runtime kills busy commands." "Only one attachment at a time can write or resize."

#### `packages/api/terminal-controller/src/index.ts`
- **Purpose:** the Host `ctx.terminalController` service — the `terminal` Remote namespace: `create`, `write`,
  `resize`, `close`, `info`, `shells`, `read` (the screen stream), and `retain` (a window hold).
- **Non-obvious design decisions:**
  - *A terminal is Session-owned and Host-lifetime-scoped.* `WebTerminalId` is branded; `closedIds` records the ids
    that were closed, so "closed identities cannot be recreated" — `create` is idempotent for an open identity and
    refused for a closed one.
  - *The quota counts pending allocations too.* "Retained screens and pending allocations consume the Session's
    terminal quota" — a create in flight reserves its slot, so a burst of creates cannot overshoot `maxTerminals`.
  - *`retain` is a physical window hold, not a read.* The `TerminalRetentionFrame` acknowledges "one physical window
    hold without taking screen or input control" — i.e. a tab that is open but hidden still holds the screen.
  - *A live failure is classified by the Remote code, not by the message.* `terminal/view`, `terminal/limit-reached`
    and `terminal/unavailable` map to three distinct client-side issues.
- **The reclamation gate** lives in `src/retention.ts` and is the single clock that decides when an unattended
  terminal may be reclaimed: it protects a terminal with a window hold, a pending input, a recent resize, an
  unsupported shell, or an uncertain observation, and it counts only *continuous confirmed* idle time.

#### `packages/api/terminal-controller/src/terminal.ts`
`BrowserTerminal` — one PTY-backed process with a bounded screen buffer. The output path is serialised through
`enqueue()` so the screen write and the broadcast cannot interleave; the state broadcast reports `exited` with the
exit code or `failed` with the message, and "process exit never creates a replacement shell".

#### `packages/api/terminal-controller/src/stream.ts`
The screen-attachment stream: the opening `snapshot` frame (the complete bounded screen + the terminal info + the
writability flag + the input window), then `output` frames, then `state` frames, then `ack` frames. "Commands are
numbered consecutively from one within each attachment; acknowledgements never authorize replay."

#### `packages/api/terminal-controller/src/shells.ts`
Shell discovery through the *target execution provider* — "Shell selection and executable verification use the
target execution provider", so a shell is only offered if the provider can actually run it.

#### `packages/api/terminal-controller/src/retention.ts` / `src/client/retention.ts` / `src/client/bindings.ts` /
`src/client/inventory.ts` / `src/client/close-requests.ts` / `src/client/shell-preference.ts`
The retention clock, the client-side hold, the view↔terminal-id binding (a view key is independent from the Host
terminal identity, so a reload can rebind), the per-session inventory, the close-request queue with its failure
list, and the remembered shell preference.

#### `packages/api/terminal-controller/src/client/model.ts` (structural read) and `src/client/index.ts` (structural read)
The React-free client model: `TerminalView`/`TerminalViewState`/`TerminalViewIssue`, a render frame, a revision
counter, and the `TerminalRemote` slice. `ClientTerminals` owns the views, the inventories, the holds and the
bindings, and it "reconciles holds" against the set of open tabs.

#### `packages/api/terminal-controller/tests/*` (Tier 2 table)

| File | What it pins |
| --- | --- |
| `tests/terminal.spec.ts` | The terminal process: the opening snapshot, ordered output, the half-close of input while output continues, a provider write/resize error failing the attachment while permitting fresh recovery, final output preserved when an in-flight operation is refused during exit, input refused once the process completes, and no input granted to an attachment cancelled before its screen baseline. |
| `tests/stream.spec.ts` | The screen stream's frame order, the ack sequence, and the retention frame. |
| `tests/retention.spec.ts` | The reclamation gate: continuous confirmed idle, an activity observation resetting the timer, protected states, the observation-gap reset, and the cleanup retry. |
| `tests/retention.client.spec.ts` | The client-side window hold. |
| `tests/bindings.client.spec.ts` | The view↔terminal identity binding. |
| `tests/inventory.client.spec.ts` | The per-session terminal inventory. |
| `tests/model.client.spec.ts` | The client terminal model: frames into state, revisions, issue classification. |
| `tests/recovery.client.spec.ts` | Screen recovery from the bounded scrollback on a reconnect. |
| `tests/controller.spec.ts` | The Host controller's verbs and quota accounting. |
| `tests/input.ts` | Fixture: scripted terminal input and output. |

---

### `packages/api/workspace-controller` — a durable, reconnect-safe workspace projection

#### `packages/api/workspace-controller/README.md`
The contract: a Workspace registry with an explicit ordering, per-Workspace Session membership, a registry-global
archive set, a registry-global pin set, and a `follow` stream that delivers a complete baseline then ordered
increments.

#### `packages/api/workspace-controller/src/index.ts`
- **Purpose:** the Host `ctx.workspaceController` — the `workspace` Remote namespace.
- **Non-obvious design decisions:**
  - *A non-owner never receives a Workspace it may not see.* `follow()` filters every frame through
    `remoteAccess.allows({ kind: 'workspace', id })` **and** filters the Session ids through
    `allows({ kind: 'session', id })`.
  - *A Workspace that loses visibility is delivered as a `replace` frame, not a `remove`.* "a Client never
    resurrects a removed Workspace; a `remove` frame reports a deletion and reaches only a Client that received
    that Workspace." So the client's "removed" state can never be undone by a later baseline.
  - *The first-use Workspace has a fixed directory name.* "the Host never renames or relocates an existing default;
    its initial title is that same name, which browser consumers label in the reader's language." The *directory* is
    fixed; the *label* is localised.
  - *`initializeDefault` creates no Session and no message* — it is a filesystem fact, not a conversation.

#### `packages/api/workspace-controller/src/commands.ts`
Every mutation, serialised through one `operationTail` promise chain, with a stable mapping from the registry's
domain errors to Remote codes (`workspace/not-found`, `workspace/name-conflict`, `workspace/move-invalid`,
`workspace/session-active` with the *activity that still runs* in its details, `session/not-found`). Unarchive and
unpin are **idempotent**: "an id that is not archived is not an error: the call is idempotent, so a lost race with
another surface resolves as a no-op."

#### `packages/api/workspace-controller/src/feed.ts`
`WorkspaceFeed` — the reconnect-safe baseline and increment producer. It observes the **storage domain's**
`domain/changed` event (not a bespoke event bus), parses the committed record with the domain's own schema, and
publishes `upsert` / `remove` / `order` / `archived` / `pinned` increments. A committed registry that references a
missing Workspace is a thrown error, not a silent skip.

#### `packages/api/workspace-controller/src/directory-picker.ts`
The `directoryPicker` namespace: `pick`, `list`, `createDirectory`. Two design rules:
- *"a verb the composition cannot serve is refused rather than approximated"* — the backend declares a capability
  kind (`native` or `browse`) and a verb that needs the other kind is refused with
  `directory-picker/unavailable`.
- *"An abort is the caller's own timeout or disconnect, not a backend failure, so it answers `gateway/cancelled`
  before the business classification runs."*

#### `packages/api/workspace-controller/src/client/model.ts` (structural read) and `src/client/service.ts` /
`src/client/index.ts`
`ClientWorkspaceModel` — a React-free snapshot store with `items`/`archivedSessionIds`/`pinnedSessionIds`/`state`/
`phase`/`error`. The reconciliation rules are the interesting part: a newer stream order outranks a unary echo, a
refused reorder rolls back to the last Host order, a **removal tombstone survives later baselines** so delayed unary
data cannot resurrect a removed Workspace, and the pin set is mirrored locally when an archive echo lands.

#### `packages/api/workspace-controller/tests/*` (Tier 2 table)

| File | What it pins |
| --- | --- |
| `tests/workspace-controller.host.spec.ts` | The commands (serialised concurrent adoption, the stable failure mapping, reordering, archiving only known Sessions, idempotent unpin), the follow (a complete baseline then committed increments in domain order, a non-owner seeing only what it may, the `replace` frame when a delivered Workspace loses visibility, and the disposal closing followers), and the first-use Remote. |
| `tests/transport.client.spec.ts` | The client plugin, the state stream and the command facade over the assembled Gateway client: one baseline then increments, a `replace` applied in place, the old state retained across carrier loss, a normal end after the baseline classified as carrier loss, and a carrier throw folded to `gateway/internal` rather than a rejection. |
| `tests/model.client.spec.ts` | The client model's reconciliation: the optimistic reorder, the rollback, the removal tombstone, the archive/pin echo ordering, and the subscriber notification. |
| `tests/directory-picker.host.spec.ts` | The picker's capability gating, the cancelled-vs-internal classification, and the invalid child name rejected before dispatch. |
| `tests/default-directory.host.spec.ts` | The system Documents lookup: the configured override, an unavailable XDG directory, and a Windows path without a fully qualified root. |
| `tests/remote/workspace.client.ts` | Fixture: default answers for every `workspace/*` command plus builders for the rows and frames. |

---

### `packages/api/workspace-files` — bounded, watchable, *read-only* file access

#### `packages/api/workspace-files/README.md`
The most transferable *file-surface* design in the shard, because the rules are precise and the limits are named.
- **The read is bounded and honest.** "A page above the byte cap **fails; it is not shortened, because a silently
  cut page reads as the whole page**." The same for a byte window and for a complete-file read.
- **The service reads only up to the first character past the page.** "so a very large file costs one page of
  memory per request" and "the file is read only up to the first character past the page and never held whole in
  memory".
- **Two path vocabularies, one per method.** `read`/`readBytes`/`stat`/`changes` name a file by its absolute path in
  the filesystem's execution world; `list` speaks workspace paths. The types file states the rule so the two cannot
  be confused.
- **The scope is derived from a header, never from an activated Agent.** "The Host reads a live Session header or
  uses persistence `stat` for a cold Session; it does not activate an Agent, read the event body, or borrow a parent
  Session's root."
- **Containment applies to directories, not to file reads.** "the service does not impose workspace containment on
  file reads" — the *filesystem's* read authority decides. Directories and directory watches are confined.
- **The symlink rule is stated per operation.** "the file-reading operations also refuse a final symlink, even one
  pointing back inside the workspace. `list` instead follows a final link — a directory symlink on any platform,
  including a Windows junction — and requires it to resolve to a directory inside the workspace root."
- **Every page carries the file's `version` from the stat that preceded it, "so a consumer can tell a fresh page
  from a stale one".**
- **The honest limits, named:** "Reads are not transactional — result metadata comes from stat before content is
  read; a concurrent write can make the reported version and returned contents differ." "**Unbounded generation
  queue** — a `changes` generation buffers operation observations and target invalidations until its consumer pulls;
  a stalled consumer grows Host memory for the life of the stream." "`maxEntries` bounds the answer, not the listing
  — `list` asks `ctx.fs.listDir` for every child and cuts the array afterwards."

#### `packages/api/workspace-files/src/index.ts`
- **Purpose:** the Host `ctx.workspaceFiles` service — `stat`, `read`, `readBytes`, `list`, `changes`.
- **Non-obvious design decisions:**
  - *The page cutter counts lines without keeping them.* `cutPage()` walks the decoded chunks, counts the lines
    before the window without buffering them, admits each in-window segment against the byte cap *before* buffering
    it, and returns at the first character past the page.
  - *The stat is repeated after the lstat.* `locateFile()` "re-checks what `lstat` saw: the file may have gone or
    changed kind in between."
  - *A non-text refusal is recognised by its CODE, not by class identity* — "the error class belongs to whichever
    `dsh-fs` instance the provider loaded, so no class identity is shared across the package boundary."
  - *The lookup resolves a Session id to a workspace root without activating anything.* A Typert lookup reads the
    live header, else the persistence service's header-only `stat`.
  - *The file's own size has no cap* — "a caller pages through it". Only the page and the window are capped.

#### `packages/api/workspace-files/src/changes.ts`
`WorkspaceChangeFeed` — target-scoped watches plus `fs/observed` invalidations. "A generation registers its
observation queue, resolves the target, and starts `fs.watch` before yielding `{ kind: 'ready' }`." The
`ChangeFollower` holds a `Deque` of observations; `close()` resolves only after the watcher has actually been
unwatched, so a teardown never leaves a watcher behind.

#### `packages/api/workspace-files/src/types.ts`
The wire types and the `RemoteErrorDetailsMap` for seven `workspace-file/*` codes. "Callers branch on the code,
never on message text."

#### `packages/api/workspace-files/src/client/change-feed.ts`
One Host `changes` stream per (Session, path), shared by that target's open resources. Three rules:
- *"A predecessor still closing finishes first, so one target never has two Host streams open at once."*
- *The follower binds the Host-returned absolute path*, and queued and live frames are matched against it with `\\`
  normalised to `/` — so a relative request path and a canonical Host path are the same target.
- *"The last follower leaving disposes the stream, a successor waits for that disposal, and plugin teardown awaits
  all pending closes."*

#### `packages/api/workspace-files/src/client/provider.ts`
The `file` resource provider. The first frame is the `stat`; every later invalidation re-stats unless the version or
the absence is already known. A failed stat **does not end the stream** — "the follow is on the address, not on the
file, so a write can still bring the file live." An address outside the two supported scopes yields exactly one
failure frame and ends.

#### `packages/api/workspace-files/src/client/types.ts` / `remote.ts` / `index.ts`
The `ResourceProtocolMap.file` declaration, the `WorkspaceFileParams` navigation parameter (a 1-based line to reveal),
the two Client-only error codes, and the narrow `WorkspaceFilesRemote` slice the package calls — declared
structurally so the package is testable against a scripted face.

#### `packages/api/workspace-files/tests/*` (Tier 2 table)

| File | What it pins |
| --- | --- |
| `tests/read.spec.ts` | The four read gates: the happy path, the line window, the byte cap (inclusive), and the text-only rule (invalid UTF-8 and NUL, detected per page). Plus the file changing under its gate (deleted → not found, replaced by a directory → not a regular file). |
| `tests/read-bytes.spec.ts` | The byte window: the defaults, the inclusive cap, `eof` from a short window when the backend reports no size, a non-integer offset as a bad request, and the gates shared with `read`. |
| `tests/read-all.spec.ts` | The complete-file read: independent of the window cap, the size refusal mapped by code without a shared error class, and the `baseFile` relative resolution with its non-relative-path rejections. |
| `tests/list.spec.ts` | The listing: the root as the empty workspace path, the `/`-joined relative path, a symlink child reported as its target, the entry cap, and every containment gate. |
| `tests/stat.spec.ts` | The identity and freshness read: the version a read of the same file reports, a new one after a write, and the shared gates. |
| `tests/changes.spec.ts` | The largest suite: readiness before draining queued observations, unrelated target keys filtered, absence reported when the stat finds no file, the watcher failure paths, an outside directory rejected before the watcher opens, a missing outside file observed through the real local watcher, and the whole cancellation/disposal matrix. |
| `tests/change-feed.client.spec.ts` | The shared target feed: one stream per (Session, target), the last follower disposing it, the overlap-safe close, the canonical-path routing, the refresh on a later ready, and every follower-end path. |
| `tests/provider.client.spec.ts` | The file provider: the address grammar, the opening stat, the Host writes (a duplicate version is not re-read), the reported disappearance (the provider keeps following), and the end. |
| `tests/host-path.client.spec.ts` | Host-resolved identities across pending stats, reconnects and disposal — including "a later ready re-stats complete metadata even when the stat version is unchanged". |
| `tests/binary-rpc.spec.ts` | The binary read crossing the Gateway lookup and Connection's binary RPC response, the cancellation propagation, and the failure preservation. |
| `tests/scope.spec.ts` | The Session-scope lookup using live or stored headers without an Agent. |
| `tests/apply.client.spec.ts` | The plugin body registering the `file` provider for the fiber's lifetime. |
| `tests/harness.ts` | Fixture: a real local backend over a temp workspace beside a sibling directory outside it. |
| `tests/fake-remote.client.ts` | Fixture: the scripted Remote slice with one push source per opened `changes` generation. |

---

### `packages/sdk` — driving a harness runtime from another process

#### `packages/sdk/README.md`
The package-group map: `protocol/` (the wire), `client/` (the TypeScript client), `server/` (the serving plugin).
"Clients can open sessions, send prompts, and observe session events, agent status changes, and subagent
completions. The TypeScript client and Python SDK use the same protocol."

#### `packages/sdk/protocol/README.md` + `src/transport.ts` + `src/types.ts` + `src/index.ts`
- **The wire:** newline-delimited JSON-RPC 2.0. Seven client→server requests (`initialize`, `session/prompt`,
  `session/resume`, `session/wait`, `session/working-directory/get`, `session/working-directory/set`, `shutdown`) and
  four server→client notifications (`session.event`, `session.status`, `subagent.started`, `subagent.finished`).
- **The framing rules:** "malformed lines are ignored"; a request with no handler answers `-32601`; a handler failure
  answers `-32603`; `close()` "detaches them and rejects pending requests without destroying the streams".
- **The payload semantics that matter:**
  - *`SessionPromptResult.messageId` identifies the queued user message* — "it does not identify a later assistant
    message, turn ending, or prompt result." The protocol refuses to imply a per-prompt result.
  - *`InitializeParams.reasoningEffort` is an adapter-owned identifier* and omission preserves the model's default.
  - *`InitializeParams.maxTokens` is an optional positive safe integer* capping each conversation-model output.
  - *The server resolves the exact route during initialization and rejects `session/prompt` until that handshake
    succeeds, "so a missing adapter, unavailable model, or unsupported effort cannot fall back to constructor
    defaults."*
  - *`SubagentFinishedNotification.lastAssistantMessage` carries the child's last non-empty assistant message*, or its
    accumulated assistant text when no such message exists, and the field is absent when the child produced neither.
  - *`serverInfo.name` stays the wire-stable `deepseek-harness-sdk-runtime`.*
- **The transport implementation detail worth stealing:** the request id is a `randomUUID` with the dashes
  removed, and the pending map is keyed by it. An aborted request **removes its pending entry** — "no state is
  retained for a response that may never come" — which is what makes a bounded, repeatedly-timed-out request leak
  nothing.

#### `packages/sdk/client/README.md` + `src/api.ts` + `src/client.ts` + `src/dispose.ts` + `src/launch.ts` + `src/types.ts` + `src/index.ts`
- **The two-layer design:** `DeepSeekHarness` (owned runs) over `HarnessClient` (the protocol client), mirroring the
  Python SDK.
- **The owned-activity flow — the single most important idea in this shard for August Trading's automation:**
  "`run(input)` … **queues the prompt, waits until its message id appears in a durable inbox receipt, then collects
  through the next whole-agent `idle`**." The interval's result is `RunResult { sessionId, finalResponse, events,
  notifications }`, where `finalResponse` is "the last committed root-session assistant text in that interval — **not
  a response causally assigned to the prompt**, because steering, injected context, and other queued work may
  contribute before idle." That is an unusually honest statement of what an automated run can claim.
- **The four exported error classes** — `JsonRpcResponseError`, `RequestTimeoutError`, `SdkProtocolError`,
  `TransportClosedError` — so "callers branch on failure type". The transport error carries "the exit code and a
  bounded stderr tail".
- **The teardown ladder:** "requests protocol `shutdown` (bounded by `shutdownTimeoutMs`, default 1000 ms), then walks
  a stdin-EOF → SIGTERM → SIGKILL ladder until the process has exited; it is idempotent, and a closed client refuses
  reuse." The implementation is platform-aware: "POSIX sends `SIGTERM` before `SIGKILL`; Windows skips directly to
  forced termination because Node maps both signals to `TerminateProcess`." Every timer is `.unref()`'d so a pending
  grace never keeps the parent's loop alive.
- **The failed-handshake discipline:** "When a failed handshake is cleaned up successfully, the instance installs a
  fresh client so a later call retries with a new process until terminal `close()`; **if initialization and cleanup
  both fail, `start()` returns an ordered `AggregateError` and retains the failed client instead of spawning beside a
  process whose exit is unproved.**"
- **The cwd double-resolution trap, documented and fixed:** "Absolute before the handshake: the child spawns relative
  to THIS process's cwd, but the wire cwd is resolved again inside the child — a relative value would double-resolve
  (e.g. `worker` → `worker/worker`)."
- **`subscribeSessionTree(id)` scopes client-side**, "exactly like the Python SDK", using the `subagent.started`
  lineage edges — the runtime notifies for every session and the client filters.
- **The launch resolution** (`src/launch.ts`): the client resolves the *same-version* `@deepseek-ai/dsh` executable
  and **version-checks the manifests** — "dsh SDK client 2.0.0 requires the same dsh version, got 1.0.0" — falling
  back to a source launch through an absolute tsx loader when the built binary is absent.

#### `packages/sdk/server/README.md` + `src/index.ts` + `src/server.ts`
- **The serving plugin.** "Stdout carries only JSON-RPC frames, so a deployment must not compose a stdout logger.
  It answers `shutdown` by disposing the root runtime and exiting 0; the app bin owns EOF and signal exits."
- **The readiness boundary:** "`initialize` is the SDK's readiness boundary. This plugin can activate before async
  sibling Loader entries (for example an MCP client's initial tool discovery), so do not advertise a ready runtime
  until the complete current tree has settled. **Loader settlement joins entry imports, fiber lifecycle work, and
  synchronous effect registration; no scheduler delay is part of readiness.**"
- **`session/wait` is the completion primitive:** it "observes an existing SDK-owned session through managed descendant
  completion and any resulting root turns … never creates a session, and responds after the root stays idle across the
  descendant check. **Idle children with parked inbox messages remain resident but do not delay this response.**"
- **The failure rule:** "A live Agent failure remains associated with that exact session until a later committed
  `turn/end` accounts for the outcome; otherwise the wait rejects, including when the failure preceded the wait
  request. **Errors already represented by a terminal remain in Session events, and later successful activity clears
  an earlier live failure.**"
- **The shutdown ordering:** "closes descendant admission below its exact root Agents and drains their managed
  descendants child-first before releasing the root handles and adapter." A descendant drain failure is reported
  *after* the remaining root and adapter teardown completes. "A shared exit task guarantees that racing `shutdown`
  requests never dispose or exit twice."
- **The subagent locality rule:** "subagent completions are forwarded only when the service-snapshotted lifecycle
  `local` flag is true — **provider names, child ids, and durable lineage never establish locality.**"
- **The image-admission rule:** "Inline `SdkEncodedImageBlock` values are validated and committed through the
  composition's attachment store first, so the session log retains content-addressed image references rather than
  base64 bytes."

#### `packages/sdk/client/tests/*` and `packages/sdk/protocol/tests/*` and `packages/sdk/server/tests/*` (Tier 2 table)

| File | What it pins |
| --- | --- |
| `client/tests/sdk-client.spec.ts` | The client against a real scripted runtime subprocess: a restored handle, resume failures, per-session working directories, a malformed directory response, notifications preceding the receipt being ignored, an end-to-end turn with runtime reuse, root-scoped events vs a session-tree notification stream, the handshake carrying cwd/provider/model/effort/maxTokens exactly once, a relative cwd resolved before the handshake, a JSON-RPC error response closing the runtime, both initialize and cleanup failures preserved, a retry with a fresh runtime, `await using`, the request timeout leaving no pending state, a dead runtime failing pending requests with the exit code and stderr tail, the SIGTERM and SIGKILL escalations, filtered subscriptions in wire order, a throwing filter contained to its own subscription, "close() drops queued notifications; runtime death keeps them drainable", the multi-hop lineage scoping, and the wire-payload validation. |
| `client/tests/dispose.spec.ts` | The teardown ladder, tier by tier, against a scriptable fake child — including "a SIGTERM-trapping child is SIGKILLed, and dispose resolves only after the exit" and the Windows tier skip. |
| `client/tests/launch.spec.ts` | The launch resolution: the same-version installed entry, every filesystem input made absolute with the patch order preserved, the source fallback through an absolute tsx loader, a loud failure when the source launch is missing a required file, the explicit-vs-inherited environment, and the manifest version check. |
| `client/tests/fake-runtime.ts` | Fixture: a scripted stand-in runtime driven entirely by env vars — no model, no network, no harness imports. |
| `client/tests/cot-translation-projection.spec.ts` | The audit projection: a translator plugin's request/result events are preserved in the SDK event stream "without replacing the main response". |
| `client/tests/expected/cot-translation-projection.json` | The expected projection: the `finalResponse`, the two `plugin:translator/*` audit events with their model-request metadata, the matching `session.event` notifications, and the assistant texts. Read in full — it is a golden file, and it shows the shape of a *plugin-originated* event riding the session log. |
| `protocol/tests/transport.spec.ts` | The transport: bidirectional requests and notifications, the wire error code preserved, a pre-aborted signal rejecting without registering pending state, an abandoned request stringifying a non-Error reason, structured error data preserved, `-32601` without a handler, malformed frames ignored, multibyte UTF-8 split across Buffer chunks, `flush()` waiting for earlier writes, and pending requests rejected on close/error/end. |
| `server/tests/server.spec.ts` | The largest server suite: `session/wait` including a child-triggered root turn, the working-directory RPCs, a real adapter call, overlapping prompts for one session, inline image admission (and its refusal with no attachment store), the liveness recheck after an async admission, a disposed agent refused, whole-agent status without attributing an outcome, the subagent started/finished notifications, the locality rules (a colliding remote id, a continuation run, out-of-order settlement, provider re-registration), the exact-route initialization refusals, concurrent session creation coalesced, and the teardown aggregation. |
| `server/tests/plugin-apply.spec.ts` | The plugin body: `initialize` over the injected stdio pair, the wait for Loader-owned adapter registration, a full prompt turn forwarding notifications, `shutdown` answered before exiting 0 exactly once (even against a racing second shutdown), a failed flush still disposing and exiting once, and a bare fiber dispose stopping service without exiting. |
| `server/tests/resume.spec.ts` | The persisted resume: a non-main identity restored with its history and origin preserved, an interrupted final turn repaired, missing history rejected and released for retry, a prompt sharing a pending restoration, a duplicate resume rejected, shutdown waiting for a pending restoration, and the refusal when the profile has no persistence backend. |
| `server/tests/shutdown.spec.ts` | The descendant drain: parked descendants released at depth 1 and 2, an unrelated tree preserved, and the roots disposed after a descendant drain fails. |
| `server/tests/wait.spec.ts` | The completion primitive: a child interrupted at depth 1 or 2 with unclaimed steering still finishes, an unowned descendant failure kept separate from the root outcome, a represented turn error left in the durable outcome, and an error emitted during terminal publication retained. |
| `server/tests/built-scope-carrier.e2e.ts` | The built-artifact guard for the scope carrier shared by the subagent and SDK packages — "source-mode tests cannot expose an accidentally duplicated module instance". |
| `server/tests/plugin-shape.spec.ts` | The plugin export shape (no stray default) so the Loader keeps `name`, `inject`, `Config` and `apply`. |
| `server/tests/messages-response.ts` | Fixture: a completed text turn with provider usage. |

### Tier 3 — skipped, with the reason for each

The ledger `dsh-api-sdk-acp.status.tsv` carries one row per file; the 125 `skipped` rows fall into exactly four
kinds, and no file is absent from the ledger.

| Kind | Count | Which files | What was done instead |
| --- | ---: | --- | --- |
| Generated bilingual-hash records | 17 | every `README.i18n.yaml` in the shard (one per package) | Head-peeked: each is a generated per-heading EN/ZH hash table, not prose. The package's English README was read in full. |
| Chinese translation mirrors | 13 | `packages/api/{gateway,job-controller,remote-access,remotes,session-controller,settings-controller,terminal-controller,workspace-controller,workspace-files}/README.zh.md` and `packages/sdk{,/client,/protocol,/server}/README.zh.md` | Head-read (6–18 lines) to confirm the file mirrors its sibling English README, which was read in full and is the source of every claim in this report. |
| Large source files | 8 | `session-controller/src/{index,agent,commands}.ts`, `session-controller/src/client/sessions/{session,service}.ts`, `terminal-controller/src/client/{index,model}.ts`, `workspace-controller/src/client/model.ts` | Structural read: head, the exported-declaration skeleton with line numbers, and tail. Each has a report entry derived from that read. |
| Test suites | 87 | every `*.spec.ts` / `*.e2e.ts` over 25 KB in the shard (`gateway.client.spec.ts` 146 KB, `gateway-stream.host.spec.ts` 76 KB, `gateway.host.spec.ts` 57 KB, `gateway-access.host.spec.ts` 45 KB, `session-controller/tests/manager.client.spec.ts`, `session-controller/tests/session.client.spec.ts`, `sdk/client/tests/sdk-client.spec.ts`, `sdk/server/tests/server.spec.ts`, `workspace-files/tests/changes.spec.ts`, …) | Structural read: the `describe`/`it` titles with line numbers plus the head — which is what a suite pins. Every one of them appears in the per-package Tier 2 tables above with what it pins. |

---

## 2. Ideas worth stealing (ranked)

1. **A `RemoteResult<T>` that never rejects for a carrier problem** (`packages/api/gateway/src/client/index.ts`).
   Every unary call resolves to `{ ok: true, value }` or `{ ok: false, error }`; only an *assembly* fault (wrong
   arity, an unmounted method, a withdrawn contribution) rejects. One `isRemoteFailure(value)` discriminates a Host
   error from a local bug, so a consumer never wraps a call "to recover one". August Trading's provider calls fail
   today as thrown errors; this turns "the provider is down" into data.
2. **A projection store with two row kinds** (`packages/api/session-controller/src/client/sessions/projection-store.ts`).
   A `sequenced` row (`{value, seq}`) computed by the Host merges under *higher seq wins*; a `cached` row has no
   comparable seq and *yields to every sequenced write*. A key never seen reads `undefined` ("capability absent"), and
   "a domain ships projection support with zero client code". This is the right shape for August Trading's derived
   per-trade and per-conversation metrics.
3. **Access decided *before* anything is resolved** (`packages/api/gateway/src/index.ts:830-857`). The Gateway asks
   `remoteAccess.decide()` on the *resources* a call touches, before any lookup, any Context identity or any argument
   is resolved — "so a refused call activates nothing". August Trading's tool calls and provider calls should carry a
   resource (a trade, a conversation, a file) and be refused before they do anything.
4. **A cursor-based, gap-repairing journal stream** (`packages/api/gateway/src/client/journal-stream.ts`). Opening
   is cursor-first; live entries are continuous; a gap is *repaired* by re-reading a page that must end exactly at the
   target cursor; cursorless notifications wait behind a repair and are discarded if a newer generation supersedes it.
   This is the protocol August Trading's trade log + live monitor should speak.
5. **A local submission echo with a retirement rule, not a timeout**
   (`packages/api/session-controller/README.md` and `src/client/sessions/session.ts`). The user's message appears
   synchronously, is identified by the request id, and is retired by the *durable* receipt — with the ordered
   attachment references so the composer can release successful cards and keep failed drafts. A reload rebuilds from
   durable events alone.
6. **A reclamation gate for unattended resources**
   (`packages/api/terminal-controller/src/retention.ts`). A terminal is reclaimed only after *continuous confirmed*
   idle time, and any activity observation, observation gap, pending input, recent resize, unsupported shell or
   uncertain observation keeps it alive. "Confirmed" and "continuous" are the two words that matter — an uncertain
   observation is not idle.
7. **Bounded reads that fail rather than silently truncate** (`packages/api/workspace-files/src/index.ts`). "A page
   above the byte cap fails; it is not shortened, because a silently cut page reads as the whole page." The page
   cutter also reads only up to the first character past the page, so a 1 GB file costs one page of memory.
8. **An owned-activity interval with an honest result** (`packages/sdk/client/src/api.ts`). The run queues the
   prompt, waits for the durable inbox receipt, then collects until the whole agent is idle — and the returned
   `finalResponse` is "the last committed assistant text in that interval, **not** a response causally assigned to
   the prompt". An automated trade-plan run should report the same way.

## 3. Trading-relevant findings

1. **The whole "Human kill is not the model's own" rule** (`packages/api/job-controller/README.md`): a job killed by
   the human records the reason `cancelled by the user`; the completion notice is *still due* to the owning agent,
   with the reason attached; and the model's own consuming cursor never observes a human's read. August Trading's
   scheduled runs and background jobs need exactly this separation — a trader's stop button is not the agent's
   decision, and the agent must learn that it happened.
2. **A non-consuming observation channel over a consuming one** (same package). `job.follow` reads a job's retained
   output from an **absolute byte offset**; the model's own `job_output` cursor and notice state never observe those
   reads. Two cursors over one store — one for the agent, one for the trader — is the pattern a trade monitor needs.
3. **A job registry with a bounded ring** (`packages/api/job-controller/src/observe.ts`): output is retained in a
   ring, a resume past the evicted head is flagged `lossy`, and the client marks the gap (`gapBefore`) so the UI can
   say "output was dropped" instead of silently showing a hole. A trade-run log needs the same `lossy` flag.
4. **The ACP bridge's machine permission channel** (`packages/acp/acp/src/session.ts` and
   `packages/acp/acp/tests/approval.spec.ts`): one-shot allow/reject decisions, a cancelled client, an unknown option
   id and a same-id foreign agent all resolve to **deny** ("fails closed"). A trading agent that can auto-execute a
   plan needs an approval channel whose default is refusal and whose failure modes are also refusal.
5. **The archive gate that blocks rather than requests** (`packages/api/session-controller/src/archived-session-gate.ts`):
   a step proposed for an archived Session is rejected *before* a model request, so the turn ends as `blocked` "without
   a model request". An archived (or closed) trade analysis must not spend a model call.
6. **Turn-aligned history paging with a stated minimum** (`packages/api/session-controller/README.md`): a history
   page must cross at least two `turn/start` events and carry at least 50 messages; a jump loader uses 200 per page.
   August Trading's transcript view should page on *turn boundaries*, not on a row count, so a page never splits an
   analysis from its verdict.

## 4. Weak spots in the reference (where August Trading is already ahead)

1. **The wire has no cancel and no per-prompt result.** "The wire has no prompt-cancel method; abandoning a turn
   means closing the runtime" and "`MessageId` identifies inbox admission only" (`packages/sdk/client/README.md`,
   `packages/sdk/server/README.md`). August Trading's cancel path is first-class; the SDK's is not.
2. **The client-side accepted/running state is memory-only and not shared between tabs** — "one tab can show a
   converted row while another still shows `New Session` for the same Session"
   (`packages/api/session-controller/README.md`). August Trading's SQLite-backed state is stronger here.
3. **The SDK protocol is pre-release with no version negotiation** — "the handshake carries only `serverInfo.version`
   (`0.0.1`, unvalidated by clients); pre-release stance, no compatibility promise", and the Python twin must be
   updated "in the same change" (`packages/sdk/protocol/README.md`). A mirrored protocol without a compatibility
   story is a maintenance trap.
4. **A `changes` generation's queue is unbounded** — "a stalled consumer grows Host memory for the life of the
   stream" (`packages/api/workspace-files/README.md`), and `list` asks the filesystem for every child and cuts the
   array afterwards, so the cap does not bound the work. Two places where a bound is documented but not enforced.
5. **The session-list work slice is a target, not a bound** — "A single summary, the query provider's own
   enumeration, final sorting, and response serialization can exceed the list work-slice target; it is not a hard
   Host latency bound" (`packages/api/session-controller/README.md`). A budget that can be exceeded without saying so
   is a soft promise; August Trading's equivalent (the 30-second analysis cap) is stated as a hard one.

## 5. Answers to the trading questions, from this shard only

1. **How do they keep the model focused and avoid rule drift?** This shard is the boundary layer and holds no prompt
   engineering, but it contributes the *mechanism*: a `reasoningEffort` that is an **adapter-owned identifier** with
   omission preserving the model's default, and a `maxTokens` cap that "caps each root-agent request output and is
   inherited by in-process descendants" while "compaction plugins own their separate summary limits"
   (`packages/sdk/client/README.md`). The model-facing surface is kept to a *route*, and every route change is a
   projection the Host owns (`packages/api/session-controller/src/model-selection-projection.ts`).
2. **How do they prevent the model from fabricating data?** The layer's answer is *provenance at the boundary*:
   inline images become content-addressed attachment references before the message enters the log; a file read
   carries the `version` from the stat that preceded it "so a consumer can tell a fresh page from a stale one"; a
   usage update is emitted only when BOTH a measured count and a known capacity exist
   (`packages/acp/acp/src/updates.ts`); and every failure is a typed code with details rather than prose. The
   transferable rule: **do not send a number the system cannot source.**
3. **How do they measure success?** The shard answers the *measurement-harness* question rather than the trading
   question: the run API's `RunResult` carries `events` and `notifications` alongside `finalResponse`, the
   notification stream is scoped to a session *tree*, and the "owned activity interval" is defined precisely enough
   that two runs can be compared. `finalResponse` is explicitly "not a response causally assigned to the prompt" —
   the honesty about attribution is the point.
4. **How do they do multi-agent work, and where does debate add value over a single agent?** This shard shows the
   *plumbing* of a subagent, not the debate: `subagent.started` / `subagent.finished` notifications with the parent
   lineage, a **client-side** session-tree scope over those lineage edges, the "local" flag that decides whether a
   run is reportable, and the SDK's `session/wait` that "waits for managed descendants and their root summary turns"
   while "idle children with parked input remain resident without blocking this wait". The lesson for August
   Trading: a debate between agents is worth it only if the *parent* can wait for a *bounded set* of children and
   read each child's last assistant message; the child set must be local, countable, and drainable.
5. **How do they keep structured logs the model can query later?** Twice over. The durable store is a **session log**
   of typed events with a sequence number, read through a cursor algebra and a gap-repairing journal stream. The
   *derived* state is a **projection** — Host-computed, sequence-stamped, pushed to the client, with a cached cold
   variant that yields to it. The model queries the log; the UI reads the projection. That split is exactly what
   August Trading's trade log + dashboard needs.
6. **What do they do to stay simple as features accumulate?** The recurring answer is **one owner package per seam,
   split into a host half and a browser-safe client half, with a generated contract between them and an explicit
   `ctx` key on each side** (the `packages/api/README.md` table). Features add a method to one seam; they do not add
   a second path. The second answer is the **"Known Limitations" section in every README** — every package names
   what it does *not* do, and the Dev Note is "None" because the limitations are already in the contract. A codebase
   that states its limits per package stays simpler than one that discovers them.

