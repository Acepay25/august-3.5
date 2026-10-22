# deepseek-harness :: dsh-notes-impl-rest

**Files in shard:** 350 (read: 234, skipped with reason: 116)
**What this shard covers:** The complete `.agents/notes/implemented/` corpus of the DeepSeek Harness
repository — 116 shipped "Agent Notes" (each shipped as an English `.md`, a Chinese `.zh.md`
mirror, and a generated `.i18n.yaml` bilingual-pair hash record), plus the two index files. These
notes are the harness's *decision log*: every shipped behaviour that needed a judgement call is
written as Problem → Decision → Alternatives considered → Consequences → Verification. They are
documentation, not code, but they are unusually high-signal because the house style forbids editing
a shipped note to change its decision — a reversal requires a new note and a cross-link, so a
note's "Alternatives" section records what was actually rejected and why, permanently.

This shard therefore contains the reference implementation's *reasoning*, and that is what is mined
here. No `source` file appears in this shard, so there is no Tier-1 code to walk; every file is a
`docs` (Tier 2) or `generated-vendored` (Tier 3) artifact.

**Read method:** all 116 English notes were read in full. The 116 Chinese mirrors were read in
batches for their title, section structure and the opening of the Decision section, and each was
confirmed to be a faithful translation of its English sibling (the same section headings in the same
order, the same decision). The 116 `.i18n.yaml` files are machine-written bilingual-pair hash
records; each one's header and structure were confirmed, and they were not read line by line.

---

## 1. File-by-file

### Tier 1 — load-bearing source: none in this shard

No `source` files are listed. This shard is 100% documentation and generated metadata.

### Tier 2 — bulk: one row per file

`bug-fix/` — 11 notes, 22 files.

| File | What it is / what it pins |
| --- | --- |
| `bug-fix/2026-09-06-packed-install-private-npm-cache.md` | The packed-install verifier owns its npm cache: it passes `--cache <consumerRoot>/.npm-cache` so a release rehearsal cannot grow the shared runner user cache and fail unrelated CI jobs. `finally` removes the cache with the consumer on success, install failure, or executable failure. Alternative — deleting the shared cache — is rejected because other jobs own it. |
| `bug-fix/2026-09-15-authenticated-browser-host-preferences.md` | Browser-token authentication, **not page locality**, selects the preference store. One `settings.describe` mirror and one `settings.mutate` path serve every authenticated browser, so a remote or public deployment stops losing Appearance/Language/busy-Enter/welcome on reload. The one remaining locality-dependent UI element is the **Open configuration file** action (loopback only) — a *presentation* choice, not a persistence rule. |
| `bug-fix/2026-09-15-client-session-blank-reconciliation.md` | A `session.list` refresh must not undo the "accepted" conversion of a Session row. The Manager keeps a private per-Session-id set of accepted/running observations; rows read `summary.blank && !engagedSessions.has(id)`. Explicitly: engagement is **display memory**, not proof a turn started, that work is queued, or that a message reached durable storage. Late acceptance cannot recreate a removed row; a baseline predating removal cannot restore the observation. |
| `bug-fix/2026-09-20-session-open-read-coordination.md` | Session opening: a cold read's cache is keyed by a **service-owned `Symbol('sessionPersistence')` identity plus `stat().revision`**, not by object identity (Cordis returns different proxies for the same service). Auxiliary RPCs (`skills/list`, `commands/list`, `goals/get`, `fileReferences/list`, `sessionReferenceResolver/candidates`) wait on `sessions.using()` → `reference.ready` at the *call site*, not in warm hooks. The main conversation uses `follow` (its snapshot already carries the projection baseline); catalog branches keep explicit reads. Known gap: a missing header root catalog is not fetched. |
| `bug-fix/2026-09-27-pwsh-prompt-tail-grace.md` | A new validated config field `promptTailGraceMs` (default `0`, zero is a *documented value*) extends only the "marker seen but printable tail not yet arrived" bound by `idleSilenceMs + handoffGraceMs + promptTailGraceMs`. Zero reproduces the previous bound bit-for-bit, so no deployment changes. The tolerance applies only after a marker was seen — a lost prompt still fails. |
| `bug-fix/2026-09-28-pty-bundled-console-host.md` | Windows PTYs use node-pty's **bundled OpenConsole** (`useConptyDll: true`, win32 only) instead of the OS console host, because the OS host replays the prompt as `\ndsh>\x1b[1C` — a leading newline, no trailing space, a cursor-forward escape — which never satisfies the tail prefix. The fix is *not* to teach the sanitizer one host's quirk. node-pty's experimental flag means a version bump can change it, so a unit test pins the option per platform. |
| `bug-fix/2026-09-29-reused-blank-runs-requested-preset.md` | A reused blank Session runs the **requested** preset, not the preset its log recorded. `session.create` verifies the candidate (not started, right directory, right Workspace, not owned by another writer) under the writer it acquires, then resolves the *requested* preset. The stale-blank failure mode (`agent-preset/not-found`) is fixed by passing the preset explicitly rather than by client-side retry. |
| `bug-fix/2026-09-30-job-session-lifecycle.md` | Background job lifecycle facts are persisted: the local provider captures `job/registered` and `job/settled` with epoch-ms timestamps, owner, producer kind, label, and creating tool call. `producerReported` distinguishes a producer's fulfilment from forced bookkeeping. Facts are appended **synchronously at the registry commit** so causal order survives; a failed journal append warns independently and never blocks cleanup. |
| `bug-fix/2026-09-30-session-list-host-fairness.md` | Time-sliced Session-list work: one monotonic deadline, yield only after `listWorkSliceMs` (default 16 ms) of work, then reset the deadline. Every row stays synchronous; cancellation is checked per row, after each yield, and before returning; **no partial list is returned**. Includes a full benchmark table (sync vs per-row yield vs 16 ms slices) and the CI ceilings (queue-delay and throughput allowances). |
| `bug-fix/2026-10-10-background-shell-command-display.md` | A background Shell launch card reuses the ordinary terminal command presentation but becomes a **static command-only display** after the launch acknowledgement: no run-state dot, no exit code, no empty-output placeholder, no running animation. `background=true && running=true` means "the launch call is in progress", not "the job is running". No job subscription, no callId↔jobId index, no derived state. |
| `bug-fix/2026-10-11-process-specific-prompt-values-in-runtime-context.md` | The checkout path and the Web GUI URL move out of the system prompt into **runtime context**, because changing them rewrote the prompt head and broke Anthropic thinking-block signatures (400 `Invalid signature`). The system prompt keeps value-free guidance. An earlier-format Session keeps its logged paragraphs verbatim, via a `harnessDevLegacyPrompt` session projection that matches the old template exactly. |
| `bug-fix/2026-09-06-packed-install-private-npm-cache.zh.md` | 中文镜像 — same decision: the packed-install verifier owns its npm cache. |
| `bug-fix/2026-09-15-authenticated-browser-host-preferences.zh.md` | 中文镜像 — same decision: browser authentication, not page locality, selects the preference store. |
| `bug-fix/2026-09-15-client-session-blank-reconciliation.zh.md` | 中文镜像 — same decision: keep accepted Session presentation across list refreshes. |
| `bug-fix/2026-09-20-session-open-read-coordination.zh.md` | 中文镜像 — same decision: cache-producer identity by service-owned Symbol, plus auxiliary-RPC read ordering. |
| `bug-fix/2026-09-27-pwsh-prompt-tail-grace.zh.md` | 中文镜像 — same decision: a seen prompt marker keeps its own tail grace (`promptTailGraceMs`, default 0). |
| `bug-fix/2026-09-28-pty-bundled-console-host.zh.md` | 中文镜像 — same decision: Windows persistent PTYs use node-pty's bundled console host. |
| `bug-fix/2026-09-29-reused-blank-runs-requested-preset.zh.md` | 中文镜像 — same decision: a reused blank Session runs the requested preset. |
| `bug-fix/2026-09-30-job-session-lifecycle.zh.md` | 中文镜像 — same decision: persist owned job lifecycle facts (`job/registered` / `job/settled`). |
| `bug-fix/2026-09-30-session-list-host-fairness.zh.md` | 中文镜像 — same decision: time-sliced Session-list work with a 16 ms default slice. |
| `bug-fix/2026-10-10-background-shell-command-display.zh.md` | 中文镜像 — same decision: background Shell command display is separate from job state. |
| `bug-fix/2026-10-11-process-specific-prompt-values-in-runtime-context.zh.md` | 中文镜像 — same decision: process-specific checkout path and Web URL move to runtime context. |

`feature/` — 40 notes, 80 files.

| File | What it is / what it pins |
| --- | --- |
| `feature/2026-06-15-ptc.md` | **PTC mode** — the model writes TypeScript against a generated SDK instead of emitting one tool call per step. Presentation is a first-class `ToolRuntime` mode (`native` \| `ptc`); execution is a capability seam (`ctx.ptcRuntime`) with a swappable Node backend. The registry contributes only `run_code`; `run_code` sits *outside* the filterable capability layers so restrictions cannot remove PTC's only entry point. A persistent REPL kernel is rejected because cross-call state would be invisible to the log and break request reconstructability. |
| `feature/2026-07-06-approval-seam.md` | **The approval seam**: one package owns a closed outcome vocabulary (`allowed-once` \| `rejected` \| `cancelled` \| `unavailable`); policy and answerers live outside it as `approval/request` waterfall listeners. Zero listeners = fail closed to `unavailable`; `policy: 'never'` rejects *inside* the service before any answerer can run (unbypassable). Audit is a durable, model-invisible `approval/asked` / `approval/decided` pair. `allow_always` is deliberately **not advertised** until grant storage, scope, and revocation are designed. The note carries an unusually candid "Costs and accepted limits" section (sibling listener order is not deterministic; ownership keys on `Agent` object identity). |
| `feature/2026-07-10-parallel-tool-call-execution.md` | Parallel tool execution by a **unary, synchronous, pure** `isConcurrencySafe(args)` classifier: only an explicit `true` opts in; anything else (missing, throwing, invalid args) is exclusive. Consecutive parallel calls form a group; an exclusive call is a barrier. Only *dispatch* overlaps — `tools/pre-execute` / `tools/post-execute` run in model order because middleware may hold ordered state. Results are committed in model order by a commit cursor regardless of completion order. The contract is deliberately unary so relational safety ("safe only if paths differ") stays unsupported and fails closed. |
| `feature/2026-07-12-subagent-persona-tool-filter-and-depth.md` | Subagent persona / tool filter / depth. Persona is a **scoped shadow** of a named prompt section; tool filtering is **one live global-view rule** applied to schemas, lookup, execution, and SDK generation together (so the model cannot call a tool the prompt says does not exist); `maxDepth` is an absolute tree cap enforced at *every* start against the max of durable header depth and runtime depth. The note is blunt: **visibility is not authority** — the filter is not a security boundary and does not guarantee a child is a subset of its parent. |
| `feature/2026-07-16-persistent-pty-sessions.md` | Persistent PTY sessions. Six model-facing tools, agent-owned sessions, a three-tier readiness ladder (`stdin_read` exact via `/proc` syscall inspection on Linux; `inferred_idle` after silence; `timeout`), and a deliberate honesty contract: the result states *how* readiness was inferred. `handoffGraceMs` and `promptTailGraceMs` are described as "a scheduling bet, not a solvable race". Process-tree teardown uses a Linux user-systemd scope (fallback: PID-identity-fenced descendant walk) and explicitly refuses SID-wide signalling. |
| `feature/2026-07-19-model-facing-goal-tools.md` | Model-facing goal tools (`get_goal` / `create_goal` / `update_goal`) where **authority is execution-time, not prompt text**: the caller must be the exact running agent, the current driver initiator, with an open turn and an accepted direct-human message in the current turn. Direct-human authority is a *host attestation* (`Agent.followup()` requires an explicit source). Autonomous goal rounds may only `complete` or `blocked`, never redefine the objective; `blocked` requires `blockedAfterConsecutiveRounds` (default 3) admitted rounds. Strict-schema providers' zero/empty fillers are treated as omitted. |
| `feature/2026-07-20-ptc-typed-tool-returns.md` | Typed tool returns in PTC mode: the program's binding resolves to the canonical `JsonValue`, failures reject with a real `ToolCallError`, and only the *outer* result is budgeted (`maxOutputBytes`, 64 MiB). Intermediate values are uncapped because they never enter model context. The worker encodes values as a flat pre-order token stream with bounded transport nesting, and captures its realm's intrinsics at init so model code cannot swap `Object.keys`/`Array.isArray`/`Buffer.byteLength` and change validation or byte accounting. |
| `feature/2026-07-28-continuable-subagent-conversations.md` | **Continuable subagents**: one durable Session, at most one process-local *Activation*, and the **Agent inbox as the only turn FIFO** (no second queue, no Task). A local Activation directly owns its `AgentHandle`; child-first disposal is guaranteed by an activation-owner scope whose structural disposer is registered *before* the drain disposer (so reverse unwind drains first). Cold resume never goes through the original provider. The note is candid that inbox-accepted-but-unlogged messages are **not** replayed after a crash. |
| `feature/2026-08-05-agent-teams.md` | **Agent Teams**: the Lead is the implicit root, the roster is flat and durable, tasks are complete snapshots with monotonic revisions and `expectedRevision` compare-and-set. `wait_agent` blocks on an edge registered *after* the call, discouraging model polling. Task ownership and `writeScopes` are explicitly **not locks** — "false mutual exclusion is more dangerous than an explicit warning". The shared checkout boundary is documented, not solved. |
| `feature/2026-08-05-context-form-vocabulary.md` | **Context forms**: `MessageSource.kind` answers *who* produced a non-user message; a new `form` answers *what shape* it is (`instructions` \| `catalog` \| `snapshot` \| `notice` \| `relay` \| `recall`). The vocabulary is semantic, never visual. Catalog identity moves off the model-facing prose onto the durable entries, so a reworded catalog is not mistaken for a changed one. Readers are **all-or-nothing**: one unreadable entry disqualifies the record rather than producing a confident but incomplete account of what the model read. |
| `feature/2026-08-08-windows-acl-restricted-token-sandbox.md` | Windows sandbox rung: `CreateRestrictedToken` with `WRITE_RESTRICTED` + `DISABLE_MAX_PRIVILEGE` + `LUA_TOKEN`, per-workspace and per-session-temp capability SIDs, Low integrity, and a world-SID `FILE_DELETE_CHILD` deny. Enforces the two file-effect modes only (`read-only`, `workspace-write`); reads, network, and process visibility stay outside the vocabulary. The note is explicit that enforcement is **structurally partial** (hard-link aliases, AppContainer-stamped trees) and reports `enforcement: 'partial'` rather than hiding it. |
| `feature/2026-08-15-product-subagent-noninteractive-permissions.md` | Product subagents (Claude Code, Codex) use a Profile-level non-interactive `permissionMode` fixed by the provider — the tool schema contains no permission field, so a model cannot raise its own authority. Failures produce a **sanitized bounded diagnostic** (4096 UTF-8 bytes) carrying only mode, request category, decision, and a fixed safe reason — never raw stderr, tool inputs, or the product transcript. |
| `feature/2026-08-24-user-authorized-subagent-model-routes.md` | User-authorized subagent model routes: an explicit `enabled` switch plus an exact `{provider, model}` allowlist in a Host-owned settings section. A new top-level Session **snapshots** the route list into a log event; children inherit the snapshot; resumed Sessions use the recorded event, not current settings. The allowlist consumes no parent-request tokens; only a `list_subagent_models` result enters the transcript. The executor re-checks the route even if the model guesses one. |
| `feature/2026-08-26-generic-file-upload.md` | Generic file upload: content-addressed storage under `DSH_HOME`, one FIFO background-upload queue, files projected into the prompt as a **path handle** rather than injected bytes ("no provider receives file bytes; the model reads the stored copy with existing file tools on demand"). Commands must declare attachment acceptance; a rejected command preserves the draft and every card. No size limit and no GC — stated as an accepted consequence. |
| `feature/2026-08-28-auto-review.md` | **Experimental Auto review**: every native call and every started PTC inner call gets one LLM review against a fixed allow / soft-deny / hard-deny policy over the action's *actual effects*. The reviewer request has five fixed partitions and a strictly parsed result (`low+allow`, `medium+allow/deny`, `high+deny`). Authority comes from existing Session facts (human `source.kind === 'user'`, direct-parent `senderSessionId` match). History can establish that an object was session-created but cannot authorize medium work or lift a high-risk prohibition. Explicitly not a deterministic security boundary. |
| `feature/2026-08-31-cross-process-session-write-lease.md` | Cross-process session write ownership via a **kernel** lock: POSIX `flock(2)` (prebuilt addon) and a Windows named semaphore (count 1). Contention maps to `SessionAlreadyOwnedError`; the kernel releases on process death, so a crashed holder never blocks a successor and there is no expiry bookkeeping. The note records the rejected alternatives in detail — a TTL-with-renewal lease (implemented first, replaced in review), `proper-lockfile`, Windows byte-range locks (ripgrep died with os error 33), and exclusive-open sharing mode (temp-root cleanup failed with EBUSY). |
| `feature/2026-09-02-in-history-system-prompt-replacement.md` | **In-history system prompt replacement**: a route capability lets the loop *append* a new `system/message` node instead of rewriting node 0, so the provider prefix cache stays warm. A four-row decision table maps (capability × prefix state) to (replace / append / consolidate / clear). The projection runs *after* the `agent/pre-step` waterfall so it sees a compaction performed inside it. Empty rendering clears **all** active versions. The note pins the cost honestly: the appended node costs its own tokens on every request in the series. |
| `feature/2026-09-04-right-sidebar-docking-infrastructure.md` | Right-Sidebar docking infrastructure: a normalized recursive split tree with branded ids minted only by a `Mint`, `applyOp(state, op)` returning the state *and* its undo, and a `Sequencer` of intents (one gesture = one history entry). The kit is a zero-dependency static library; the product supplies what the kit refuses to know. Six docking libraries were evaluated and rejected; the note explains why each failed on **state ownership**. |
| `feature/2026-09-07-deepseek-messages-adapter.md` | DeepSeek through the Anthropic **Messages** protocol. Thinking, signatures, tool calls, cumulative usage, and fragmented tool arguments are translated rather than flattened. A versioned `ReplayEnvelope` stores only the protocol format, model identity, aligned block kinds, and signatures absent from the blocks; unusable metadata degrades (omit with a warning) rather than being invented. |
| `feature/2026-09-08-present-workspace-source-files.md` | `present` declares workspace source files **without reading or copying contents**; the Host opens the current file in the default application. The declaration is not a snapshot — deletion or movement makes it unavailable, and file-content preservation is deferred until a persistence design owns it. |
| `feature/2026-09-09-web-sidebar-terminal.md` | Web sidebar terminals: `api-terminal-controller` owns user terminals by Session; the client persists only the *selected shell path*. Close-and-replace saves the unfinished close request in a terminal-scoped `localStorage` key so cleanup survives reload. Terminal output creates **no model input, no Agent tool result, and no Session event**. |
| `feature/2026-09-13-explicit-worktree-creation.md` | Explicit worktree creation as an *operation*, not an automatic consequence of delegation: a new branch from a pinned local commit, entered through the shared working-directory service. The pool (`.agents/worktrees`) is self-ignoring. The service owns no checkout registry, cleanup schedule, or merge policy. |
| `feature/2026-09-14-desktop-primary-runtime.md` | Desktop ships Python, Node, pnpm, and Office libraries as one release-bound payload with a `runtime.json` identity (version + distribution map + **locked-input digest**); the digest covers payload bytes, so a change that alters bytes without changing locked inputs requires an explicit format bump. Windows signing is one supervised request per file (a multi-file SignTool request keeps signing after a failure). |
| `feature/2026-09-14-unattended-browser-terminal-reclamation.md` | **Two-hour reclamation** of unattended browser terminals: reclaimed only when no window holds it *and* the Host continuously confirms idle for two hours. Running or *unknown* activity cancels the deadline; when work finishes a fresh full grace period starts. Silent builds, sleeping jobs and input-waiting shells are protected by positive lifecycle evidence, not by silence. |
| `feature/2026-09-16-browser-excel-preview.md` | Browser Excel preview: XLSX/XLS/CSV/TSV read in the browser, read-only, retaining **formula text alongside saved results** and never recalculating (so an unsupported function cannot replace a valid saved result with an error). CSV/TSV keep literal strings (no type inference that would discard leading zeros). Unsupported drawings are stripped from a temporary ZIP so they cannot block a readable sheet. |
| `feature/2026-09-16-sidebar-browser.md` | Sandboxed Sidebar browser: an iframe (Web) or a retained webview (Desktop) with four navigation states (`empty` / `loading` / `known` / `unknown`). The `unknown` state exists because a cross-origin iframe exposes no `canGoBack` — the UI refuses to claim a capability the platform does not give it. A per-tab, **non-persistent** sandbox toggle with a visible warning; no Host-side URL probe (that would be an SSRF path). |
| `feature/2026-09-17-sidebar-file-and-directory-auto-refresh.md` | On-demand OS watching for Sidebar previews and file trees: one watch per *explicitly opened* target, metadata-only notifications, and a directory-node tree whose collapse releases that subtree's watches. Establish the watch *before* sending ready, then stat/list; a directory has at most one active list, and further invalidation marks a pending reread rather than building a queue of refresh jobs. |
| `feature/2026-09-19-windows-acl-mandatory-integrity-confinement.md` | Windows **delete confinement**: the parent directory's `FILE_DELETE_CHILD` right escapes a restricting-SID intersection, so every grant now applies three edits in one call (capability allow ACE + world-SID delete deny + Low integrity mandatory label) and the token is lowered to match. Each piece is load-bearing and the note says which; the deny uses container-only inheritance because `0x40` is a member of `FILE_ALL_ACCESS` and a file-level deny broke every `GENERIC_ALL` open. |
| `feature/2026-09-20-config-schema-dump-validation-policy.md` | Config schema dump policy: a **partial projection exits 1** (the exit code answers "can this replace native validation", not "was output produced"); discovery is declaration-oriented and includes disabled rows; and where native resolution mutates its input the projection **widens** instead of emulating the mutation (transform callbacks are plugin code the dump must not execute). |
| `feature/2026-09-20-desktop-browser-webview.md` | Retained Desktop browser webviews: a guest's page lifetime is independent of visibility and layout, and storage ownership is keyed by the **canonical CWD** (not the Workspace UUID), so related pages in one folder share a login while unrelated ones stay isolated. The main process *replaces* renderer-supplied preferences outright (no Node integration, no guest preload, no nested webviews, no dialogs). |
| `feature/2026-09-20-spawn-agent-preset-selection.md` | Independent spawn preset selection: an explicitly named preset id resolves the *currently registered* definition (even if equal to the parent's); omission joins the parent's exact live revision. Independent selection is identified on cold restore by the **ordering** of the existing `agent-preset/selected` event before the first `subagent/descriptor` — no new descriptor field, no new event type. |
| `feature/2026-09-21-archive-stops-running-session-work.md` | **Archiving a Session with running work.** The registry owns the rule and declares two capability seams (`workspace/session-activity` waterfall, `workspace/session-stop` parallel) so it knows no agent/job/schedule vocabulary. Archive **refuses by default** when anything is running; `stopActivity: true` writes the archive *first*, then issues (never awaits) the stops — so every wake the stops induce is already blocked. A `agent/pre-step` gate makes "archived" mean *no model step at all*. The note compares six peer products' archive semantics. |
| `feature/2026-09-22-archive-admission-reads-stored-tasks.md` | Archive admission must read the **stored** Host task rows, not a fold of the live Session log, because a stored task outlives its Session's Agent — otherwise a cold Session with armed reminders archives silently. The stop deletes rows inside one slot of the same serialized queue (re-entering it would deadlock). |
| `feature/2026-09-24-auto-review-user-approval-fallback.md` | Auto review denial returns the tools pipeline's existing `ask` decision when the Session's approval policy is `ask`, so a person can override a misjudged denial; a delegated child pinned to `never` keeps the final denial. A *reviewer failure* is reported with its own distinct message and never converted into a policy question. |
| `feature/2026-09-24-session-inspector.md` | Session Inspector: an experimental Sidebar page over the existing loaded window and pagination — no second Session stream, no new persistence format. WeakMap references and lazy field reads in pages of 50 keep a cyclic runtime object graph navigable; getters never run automatically. The note's "Alternatives" explain why it deliberately does *not* add a generic Conversation-View resource protocol. |
| `feature/2026-10-02-plugin-market-discover.md` | Plugin market **Discover**: a separate Host service so market configuration never reaches `plugin-manager` (which must not remount during an install); `indexes` is a **volatile** config field. The Host filters, orders, and pages on the Host side (indexes can reach 128 MiB; clients never receive one) and the search is multilingual (CJK indexed as overlapping character pairs). `plugin_market` is read-only and needs no approval; installation keeps `plugin_manager`'s. |
| `feature/2026-10-02-plugin-market-index-format.md` | The plugin market **index format**: a JSON document carrying everything a list page displays (localized title/description, icon, author, versions, compatibility, publish time) so a list page issues no per-row requests. Every listed version declares `engines.dsh`; install arguments are built from a structured `source` (npm spec or `git+url#commit&path:`) so pinning is verifiable. Readers **reject the whole index** on a rule violation rather than dropping entries silently — "dropping entries silently would hide it". |
| `feature/2026-10-14-built-in-plugin-feature-previews.md` | Built-in plugin feature previews as a hardcoded `{en, zh}` map inside Plugin Manager, embedded as data URLs by the client build preset. Deliberately **not** a manifest field: one official bundle has artwork, which does not justify a public format for every plugin author. Cost recorded: the badge skill images add ~207 KB to the client bundle. |
| `feature/2026-10-14-host-release-change-refresh-prompt.md` | A page applies Host graphs **only while the connected Host serves the release the page booted from** (version + optional commit). A cross-release Host is never hot-replaced; a modal offers "Reload to load the new version" or "Not now". The comparison happens *before* the graph is parsed, so a release the page cannot read still counts as a change. The decision is kept in page memory, never `localStorage`. |
| `feature/2026-10-15-deepseek-search-fetch-api.md` | Direct DeepSeek Search/Fetch APIs behind the existing `web_search` / `web_fetch` tools, selectable as a pair by one switch. Direct Search removes an auxiliary model request per query (the generated answer was discarded anyway). Fetch returns Markdown with no separate summary request. The note records the real cost: one Messages search through a gateway consumed 8,154 input / 828 output tokens for a single query, and the Search API sends up to 128 characters of the user's prompt to the search service. |
| `feature/2026-06-15-ptc.zh.md` | 中文镜像 — same decision: PTC mode, the model writes TypeScript against the tool registry. |
| `feature/2026-07-06-approval-seam.zh.md` | 中文镜像 — same decision: one-shot permission decisions over a waterfall of answerers. |
| `feature/2026-07-10-parallel-tool-call-execution.zh.md` | 中文镜像 — same decision: parallel tool-call execution by per-call safety. |
| `feature/2026-07-12-subagent-persona-tool-filter-and-depth.zh.md` | 中文镜像 — same decision: configure subagent persona, tool visibility, and depth. |
| `feature/2026-07-16-persistent-pty-sessions.zh.md` | 中文镜像 — same decision: persistent, agent-owned PTY sessions with a tiered readiness ladder. |
| `feature/2026-07-19-model-facing-goal-tools.zh.md` | 中文镜像 — same decision: model-facing same-session goal tools with execution-time authority. |
| `feature/2026-07-20-ptc-typed-tool-returns.zh.md` | 中文镜像 — same decision: typed tool returns in PTC mode. |
| `feature/2026-07-28-continuable-subagent-conversations.zh.md` | 中文镜像 — same decision: continuable subagents over one Activation and one inbox. |
| `feature/2026-08-05-agent-teams.zh.md` | 中文镜像 — same decision: durable Agent Teams over continuable children. |
| `feature/2026-08-05-context-form-vocabulary.zh.md` | 中文镜像 — same decision: producer-declared context forms. |
| `feature/2026-08-08-windows-acl-restricted-token-sandbox.zh.md` | 中文镜像 — same decision: the Windows raw-ACL restricted-token sandbox rung. |
| `feature/2026-08-15-product-subagent-noninteractive-permissions.zh.md` | 中文镜像 — same decision: product subagents use Profile-selected non-interactive permissions. |
| `feature/2026-08-24-user-authorized-subagent-model-routes.zh.md` | 中文镜像 — same decision: user-authorized subagent model routes. |
| `feature/2026-08-26-generic-file-upload.zh.md` | 中文镜像 — same decision: generic file upload with content-addressed storage and path handles. |
| `feature/2026-08-28-auto-review.zh.md` | 中文镜像 — same decision: experimental Auto review before each tool call. |
| `feature/2026-08-31-cross-process-session-write-lease.zh.md` | 中文镜像 — same decision: the cross-process session write lease. |
| `feature/2026-09-02-in-history-system-prompt-replacement.zh.md` | 中文镜像 — same decision: in-history system prompt replacement for cache-stable prompt changes. |
| `feature/2026-09-04-right-sidebar-docking-infrastructure.zh.md` | 中文镜像 — same decision: right Sidebar docking infrastructure. |
| `feature/2026-09-07-deepseek-messages-adapter.zh.md` | 中文镜像 — same decision: DeepSeek over the Anthropic Messages protocol. |
| `feature/2026-09-08-present-workspace-source-files.zh.md` | 中文镜像 — same decision: present declares workspace source files. |
| `feature/2026-09-09-web-sidebar-terminal.zh.md` | 中文镜像 — same decision: Web sidebar terminals. |
| `feature/2026-09-13-explicit-worktree-creation.zh.md` | 中文镜像 — same decision: explicit worktree creation. |
| `feature/2026-09-14-desktop-primary-runtime.zh.md` | 中文镜像 — same decision: the Desktop primary runtime payload. |
| `feature/2026-09-14-unattended-browser-terminal-reclamation.zh.md` | 中文镜像 — same decision: two-hour reclamation of unattended browser terminals. |
| `feature/2026-09-16-browser-excel-preview.zh.md` | 中文镜像 — same decision: browser Excel preview with saved formula results. |
| `feature/2026-09-16-sidebar-browser.zh.md` | 中文镜像 — same decision: the sandboxed Sidebar browser. |
| `feature/2026-09-17-sidebar-file-and-directory-auto-refresh.zh.md` | 中文镜像 — same decision: on-demand watching and automatic refresh for previews and file trees. |
| `feature/2026-09-19-windows-acl-mandatory-integrity-confinement.zh.md` | 中文镜像 — same decision: Windows delete confinement via mandatory integrity plus an ambient-delete deny. |
| `feature/2026-09-20-config-schema-dump-validation-policy.zh.md` | 中文镜像 — same decision: the config schema dump validation policy. |
| `feature/2026-09-20-desktop-browser-webview.zh.md` | 中文镜像 — same decision: retained Desktop browser webviews. |
| `feature/2026-09-20-spawn-agent-preset-selection.zh.md` | 中文镜像 — same decision: independent spawn preset selection and restoration. |
| `feature/2026-09-21-archive-stops-running-session-work.zh.md` | 中文镜像 — same decision: archiving a Session with running work. |
| `feature/2026-09-22-archive-admission-reads-stored-tasks.zh.md` | 中文镜像 — same decision: archive admission reads the stored tasks. |
| `feature/2026-09-24-auto-review-user-approval-fallback.zh.md` | 中文镜像 — same decision: Auto review asks the user after a denial. |
| `feature/2026-09-24-session-inspector.zh.md` | 中文镜像 — same decision: Session Inspector data ownership and navigation. |
| `feature/2026-10-02-plugin-market-discover.zh.md` | 中文镜像 — same decision: the plugin market Discover page and index reader. |
| `feature/2026-10-02-plugin-market-index-format.zh.md` | 中文镜像 — same decision: the plugin market index format. |
| `feature/2026-10-14-built-in-plugin-feature-previews.zh.md` | 中文镜像 — same decision: built-in plugin feature previews. |
| `feature/2026-10-14-host-release-change-refresh-prompt.zh.md` | 中文镜像 — same decision: prompt to reload when the Host release changes. |
| `feature/2026-10-15-deepseek-search-fetch-api.zh.md` | 中文镜像 — same decision: direct DeepSeek Search and Fetch APIs. |

`process/` — 34 notes, 68 files.

| File | What it is / what it pins |
| --- | --- |
| `process/2026-07-06-node-engine-floor.md` | The Node engine floor is `^22.19.0 \|\| >=24.0.0`, and the reason is spelled out to the minor version: `node:sqlite` unflagged at 22.13, native type-stripping default at 22.18, and the installed Pi adapter dependency requiring `>=22.19.0`. The range excludes Node 23 as EOL. `@types/node` is pinned to the 22.x line so a Node 24+ API fails `tsc` everywhere rather than compiling clean and failing at runtime. |
| `process/2026-07-21-serial-cross-platform-ci-reference.md` | A serial, unsharded, complete `check:ci` aggregate per platform is the *independent completeness oracle* for the concurrent blocking jobs. Timeouts are deliberately **not** encoded as `timeout-minutes` — a correct gate must not be cancelled at a latency target. Platform ownership is explicit inside the aggregate (`terminal-bash` owns POSIX; Windows does not claim a backend it cannot load). |
| `process/2026-07-26-ci-failover-runbook.md` | Two independent repository-variable switches (`DSH_CI_FAILOVER_LINUX`, `DSH_CI_FAILOVER_WINDOWS`) let any writer recover a hosted-pool outage in ~1 minute **without a merge** — because the outage is exactly the state in which no PR can merge. A platform switch does not retarget the other platform. The Dependabot exclusion is deliberate and explained. The trust model (write access ⇒ secret access) is stated plainly rather than glossed. |
| `process/2026-07-26-dependencies-over-hand-rolling.md` | Introducing an external dependency is a legitimate simplification, not a policy exception. The bar: **net deletion** of owned code+tests+docs, **health**, **fit at the boundary**, and **not a settled seam**. This note exists because an unstated "avoid new dependencies" reflex had accreted hand-rolled SSE parsers, protocol framers, retry loops and glob matchers — a Not-Invented-Here fallacy operating by default. |
| `process/2026-07-26-frozen-agent-note-archive.md` | A retention boundary for the decision log itself: a note is archived (content-sealed, SHA-256 manifest, append-only) when it is unlikely to guide future work but still has historical value; foundational boundaries, durable/wire semantics, security rules and "recurring design temptations" stay active regardless of age. Archival edits are limited to relocation, an `Archived:` line, the sidecar re-record and link repair — nothing else, so a later documentation rule can never force history to be rewritten. |
| `process/2026-07-27-worktree-local-lefthook.md` | Hook installation is worktree-scoped (`extensions.worktreeConfig` + an absolute per-worktree `core.hooksPath`), because linked worktrees otherwise share one hooks directory and one worktree's install rewrites every other worktree's hooks and pinned binary path. The installer refuses rather than guesses (direct `core.bare`, dormant worktree configs, non-regular config files) and a dead lock requires manual recovery rather than automatic breaking. |
| `process/2026-07-30-generated-third-party-notices.md` | `THIRD_PARTY_NOTICES.md` is generated from the workspace manifests and **asserted fresh inside a test the test lane already runs** (no extra gate process, no scheduler slot). Tiering follows *distribution*, not manifest section: browser build inputs count as runtime; test-support `dependencies` do not. Under-disclosure is the costly direction, so the runtime tier covers every mountable plugin. A non-permissive runtime license is a hard error, and the Claude SDK exception keys only one exact identity. |
| `process/2026-08-02-native-github-stacks-and-optional-rebases.md` | Dependent PR chains use GitHub's official stack object; "land the stack" merges the complete official stack, and a partial landing needs an explicit boundary PR. Merge-forward *and* rebase are both allowed refresh histories, but any rewritten push triggers a live re-audit of heads, review threads, approvals, mergeability and checks, because earlier commit OIDs and inline anchors may be outdated. |
| `process/2026-08-08-native-windows-pull-request-ci.md` | Wine is master-only diagnostics; real native Windows jobs are blocking for build and targeted process checks, with coverage and observational diagnostics deliberately **outside** the aggregate `needs` so they stay visibly red without delaying the verdict. The 16-core allocation is a *measured* capacity point with the six-worker and 32-core experiments quoted. The 8.3-path/`realpath` watcher bug and the `TEMP` alias mismatch are documented as the real defects the native lane found. |
| `process/2026-08-08-unified-github-label-taxonomy.md` | One canonical `kind/*` label (closed, mutually exclusive set) plus at least one `area/*` label, with the *removed* alias names explicitly reserved so an obsolete synonym cannot be recreated as an "operational" label. Areas name durable subjects, not paths or initiatives, and the set is deliberately extensible by any agent with a stated rationale. |
| `process/2026-08-10-event-directed-pr-review-status.md` | Review webhooks are treated as **commands**, not as a monotonic projection: `review_requested` → `In review`; a `changes_requested` submission → `In progress`. The single backward transition is guarded by "the latest status actor for the target Project must be the configured lifecycle actor", so automation cannot overwrite a human-owned status. The note states plainly that ProjectV2 offers no atomic compare-and-swap. |
| `process/2026-08-10-npm-release-sequences.md` | Three **independent** publication sequences (dsh / vendor / native) with separate version lines, tags and workflows, so a product release does not republish the framework or the native binaries. Publication is decided by the *registry state* — absent, or present with matching `dist.integrity` (skip), or present with differing integrity (**fail**: code changed without a version bump). The note also records that an optional dependency must never be statically imported at module scope, with a dedicated gate for it. |
| `process/2026-08-26-ban-ambiguous-origin-label.md` | One ten-letter token that had accumulated eight unrelated meanings is banned from all maintained text, identifiers and filenames; each use is replaced with the exact local concept. The rule is enforced by a case-insensitive scan after NFKC normalization, with narrow exemptions for frozen historical schemas. "Passing the gate proves absence of the token, not that the replacement is precise." |
| `process/2026-08-26-published-dependency-faces.md` | The published dependency graph is classified by *artifact ownership* (Client build input vs Host runtime import) rather than source-directory coupling, with an explicit reviewable policy file, an export-level table for shared-identity values, and a metadata-only npm-resolution benchmark used to rank the next candidate. The note is careful that a value import alone does not make an edge ordinary — `instanceof`, private symbols and module-local registries require peers. |
| `process/2026-09-06-python-runtime-windows-hosted.md` | A migration of the Windows Python runtime lane onto the self-hosted pool was reverted after the shared pool reproduced the same silent installed-wheel child death twice in one day while the migration's throughput criteria stayed unmeasured. The lesson recorded: a correctness lane must not be routed through an unrelated pool-outage switch, and a future attempt must re-validate throughput and failure reproducibility first. |
| `process/2026-09-09-blacksmith-failover-leg.md` | A third failover value (`blacksmith`) is added for elastic capacity, with an explicit per-job list of what participates and what does not (credential-holding jobs, release-shaped chains and capability-specific legs stay hosted). The Blacksmith branches carry **no Dependabot exclusion**, because those runners are ephemeral — a small, deliberate difference from the self-hosted leg. |
| `process/2026-09-09-parallel-macos-notarization.md` | Two notarization lanes run in parallel from **independent `ditto` copies** of one App, because stapling mutates the App and a DMG reader overlapping `stapler` writes would produce a nondeterministic bundle. Each lane verifies its own update configuration, and only two successful lanes allow promotion of the DMG, ZIP, blockmap and channel metadata. Measured: 490.78 s parallel vs 751.33 s serial. |
| `process/2026-09-11-persistence-type-history.md` | A normalized, transitive, per-root **type history** with explicit acknowledgements: a digest detects a difference but cannot explain it, so the repository stores the after-schema of each accepted transition and a per-root compatibility judgement. Automatic classification permits optional body additions, required→optional changes and ordinary event additions within one version; anything else needs an explicit same-version decision or a version bump. Verification is *local* — no Git history, no remote services. |
| `process/2026-09-12-default-product-experimental-isolation.md` | Experimental packages are kept out of the default product by *five independent* checks (source graph, effective composition, build-input graphs, installed dependency graph, runtime registry), because direct manifest checks miss aliases, transitive paths and config-loaded plugins. A disabled row is still checked; the launcher names one declared exception (`OPTIONAL_BUNDLES`). |
| `process/2026-09-14-generated-cli-help-reference.md` | The CLI reference is generated by capturing the real `--help` of the launcher, the plugin forwarder and each shipped profile, then recursively discovering the subcommands each page lists. A second command inventory would duplicate the parser's definitions. |
| `process/2026-09-15-shipped-optional-bundles.md` | Official optional bundles ship *with* the installation (downloaded, switchable, never removable) but stay outside the default dependency graph, so default-product isolation keeps its rules with one declared exception. The list lives in code beside the profile templates rather than in a manifest, so it is typed, read once and shared by the manager and the gates. |
| `process/2026-09-17-persistence-schema-review.md` | Structural fingerprints are joined by *declared* compatibility metadata (binding, policy version, literal discriminator, unknown-kind preservation promise, qualified attribution kinds) that itself participates in the fingerprint. Policy-bearing graphs use a separate fingerprint domain. A `@persistenceReserved` marker keeps an optional-never property from silently becoming an additive optional field. |
| `process/2026-09-17-windows-runtime-signature-cache.md` | Complete signed runtime files are cached by (content, certificate, SignTool bytes, script bytes, format) and restored only after checking the input record, digest, Windows trust, timestamp and certificate — invalid entries fail without hardware fallback. The cache is account-local. Measured: 379 → 17 hardware calls, 37:03 → 13:45. The note keeps a "no automatic capacity eviction" rule and reports cache verification time separately from signing time. |
| `process/2026-09-17-windows-signature-completion.md` | Hardware signing and public timestamping are **separate operations**: sign once without a timestamp, release the hardware interlock only after Windows verification, then timestamp fresh copies of the frozen signed bytes (at most three attempts, with backoff). A combined SignTool command reports a timestamp failure as a signing failure, which would wrongly re-touch the hardware token. |
| `process/2026-09-19-no-unknown-casts.md` | New assertions to `unknown` are prohibited, enforced by a **TypeScript-AST** check against an exact baseline keyed by path + a SHA-256 of the assertion's syntax tokens + occurrence count. The baseline may only shrink. A file-wide allowance or a count budget would let a new cast replace a removed one, which is the debt the rule exists to stop. |
| `process/2026-09-28-dual-release-install-layout-work-budget.md` | A wall-clock timeout is replaced by a **work budget** (`dshPackagesPerVersion × checkedDshEdges ≤ 875_000`) because the same graph resolved in 137–205 s on an idle host and 288 s on CI — a slow runner and a bigger graph were indistinguishable. The profile shows 152.7 s of 153.8 s is npm's own peer-placement analysis. The hang guard is derived from the budget so the two cannot drift. |
| `process/2026-10-05-pr-artifact-typechecks.md` | PR artifact builds compile every project reference with one serial `tsc -b` and then run the ordinary stages; only the *benchmark* helper selects `tsc -b --noCheck`, because benchmarks consume JavaScript and Typert runtime metadata and never publish declarations. The note keeps a full table of which error class each command reports, and a negative control for each. |
| `process/2026-10-05-product-package-classification.md` | Every non-experimental package must have **effective product use** (traced through shipped profiles, preset children, runtime source imports and explicit dynamic mounts, with disabled state preserved through groups and Includes) or an explicit, reviewed policy entry. Manifest dependencies and type-only references do not create runtime use. |
| `process/2026-10-08-session-reader-compatibility-review.md` | The version criterion is **reader behaviour**, not schema shape: a same-version change is allowed when older readers resume correctly, safely ignore optional features while preserving their records, or refuse required features before execution, mutation or tail repair. A schema classifier only *flags* a change for review; it never declares a change safe. A reused logged value with a different meaning is the canonical bump trigger. |
| `process/2026-10-11-build-artifacts-check-split.md` | `build:artifacts` (produce), `build:check` (type-check the two aggregate root programs) and `build` (both, concurrent) become three commands, with an explicit dependency graph and a caller table. The completeness claim is backed by byte-identical `lib/` output (11,584 files) and `tsc -b --dry` reports. The intentional trade-offs are listed: some commands skip the aggregate checks, `build:check` does not check freshness, and concurrency raises the RSS peak by ~1.4 GiB. |
| `process/2026-10-11-lossless-build-speedups.md` | Eight build speed-ups, each with a **losslessness argument** (identical output bytes, identical diagnostics) or an explicit intended difference. The clearest: 65 duplicate `@types/react` link locations made TypeScript scan 5.6 M `paths` entries per build; hoisting the declaration to the root manifest cut the Client test aggregate Check from 59.1 s to 26.3 s. The note refuses a `globalThis` manifest index as "process-global state without an owner". |
| `process/2026-10-12-local-gate-speedups.md` | Eight local-speed decisions, each again with a losslessness argument: the pre-commit hook stops regenerating the third-party notices (freshness moves to the test lane), local parallelism is capped at 12/48 rather than the host's CPU count, one Git object listing replaces ~26,000 prefix lookups (166.8 s → 15.7 s), each document is parsed once by the documentation gates, and the slowest test file runs against an in-memory workspace (316 s → 15 s). |
| `process/2026-10-14-experimental-dependency-policy.md` | Experimental packages follow the *same* dependency-declaration rules as release packages — "experimental status does not relax engineering requirements". The verifier also scans each package's own worker and child-process entries, read from the package's `tsdown.config.ts` under both build faces, rather than guessing from source patterns. The trade-off (importing 127 configs runs their side effects in the gate process) is stated. |
| `process/2026-10-14-no-top-level-await-in-packages.md` | Package sources must not use top-level await, enforced by a TypeScript-AST gate over `packages/*/*/src/**`, with only `bin` entries exempt (a process runs a bin directly; nothing imports it). The rule exists because top-level await makes module evaluation asynchronous, so an importer waits on it and an entry failure becomes a module-loading failure. A corpus guard fails the gate if the scan set is empty. |
| `process/2026-07-06-node-engine-floor.zh.md` | 中文镜像 — same decision: the Node LTS engine floor is 22.19, with the reason traced to the Pi adapter dependency. |
| `process/2026-07-21-serial-cross-platform-ci-reference.zh.md` | 中文镜像 — same decision: the serial cross-platform CI reference aggregate. |
| `process/2026-07-26-ci-failover-runbook.zh.md` | 中文镜像 — same decision: the CI failover runbook with two independent switches. |
| `process/2026-07-26-dependencies-over-hand-rolling.zh.md` | 中文镜像 — same decision: prefer maintained dependencies over hand-rolling. |
| `process/2026-07-26-frozen-agent-note-archive.zh.md` | 中文镜像 — same decision: freeze low-future-value Agent Notes outside the active corpus. |
| `process/2026-07-27-worktree-local-lefthook.zh.md` | 中文镜像 — same decision: worktree-local Lefthook installation. |
| `process/2026-07-30-generated-third-party-notices.zh.md` | 中文镜像 — same decision: generated third-party notices, freshness asserted in the test lane. |
| `process/2026-08-02-native-github-stacks-and-optional-rebases.zh.md` | 中文镜像 — same decision: native GitHub stacks and optional PR rebases. |
| `process/2026-08-08-native-windows-pull-request-ci.zh.md` | 中文镜像 — same decision: Wine plus native Windows CI. |
| `process/2026-08-08-unified-github-label-taxonomy.zh.md` | 中文镜像 — same decision: the unified GitHub label taxonomy. |
| `process/2026-08-10-event-directed-pr-review-status.zh.md` | 中文镜像 — same decision: event-directed PR review status commands. |
| `process/2026-08-10-npm-release-sequences.zh.md` | 中文镜像 — same decision: three independent npm publication sequences. |
| `process/2026-08-26-ban-ambiguous-origin-label.zh.md` | 中文镜像 — same decision: ban the ambiguous origin label. |
| `process/2026-08-26-published-dependency-faces.zh.md` | 中文镜像 — same decision: published dependency faces and bounded peer relays. |
| `process/2026-09-06-python-runtime-windows-hosted.zh.md` | 中文镜像 — same decision: Windows Python runtime CI stays on GitHub-hosted Windows. |
| `process/2026-09-09-blacksmith-failover-leg.zh.md` | 中文镜像 — same decision: Blacksmith as a CI pool failover leg. |
| `process/2026-09-09-parallel-macos-notarization.zh.md` | 中文镜像 — same decision: parallel macOS notarization from isolated App copies. |
| `process/2026-09-11-persistence-type-history.zh.md` | 中文镜像 — same decision: the in-tree persistence-type history. |
| `process/2026-09-12-default-product-experimental-isolation.zh.md` | 中文镜像 — same decision: keep experimental packages outside the default product. |
| `process/2026-09-14-generated-cli-help-reference.zh.md` | 中文镜像 — same decision: generate the CLI reference from command help. |
| `process/2026-09-15-shipped-optional-bundles.zh.md` | 中文镜像 — same decision: ship optional bundles with the installation. |
| `process/2026-09-17-persistence-schema-review.zh.md` | 中文镜像 — same decision: the persistence schema policy and review. |
| `process/2026-09-17-windows-runtime-signature-cache.zh.md` | 中文镜像 — same decision: the Windows runtime signature cache. |
| `process/2026-09-17-windows-signature-completion.zh.md` | 中文镜像 — same decision: separate Windows hardware signing from timestamp completion. |
| `process/2026-09-19-no-unknown-casts.zh.md` | 中文镜像 — same decision: prohibit new assertions to `unknown`. |
| `process/2026-09-28-dual-release-install-layout-work-budget.zh.md` | 中文镜像 — same decision: the dual-release install layout work budget. |
| `process/2026-10-05-pr-artifact-typechecks.zh.md` | 中文镜像 — same decision: PR artifact builds and aggregate TypeScript checks. |
| `process/2026-10-05-product-package-classification.zh.md` | 中文镜像 — same decision: require product use or an explicit package classification. |
| `process/2026-10-08-session-reader-compatibility-review.zh.md` | 中文镜像 — same decision: Session versions follow reader compatibility. |
| `process/2026-10-11-build-artifacts-check-split.zh.md` | 中文镜像 — same decision: split `build:artifacts` and `build:check`, with `build` running both concurrently. |
| `process/2026-10-11-lossless-build-speedups.zh.md` | 中文镜像 — same decision: build speed-ups that keep outputs unchanged. |
| `process/2026-10-12-local-gate-speedups.zh.md` | 中文镜像 — same decision: local gate, hook and test speed-ups. |
| `process/2026-10-14-experimental-dependency-policy.zh.md` | 中文镜像 — same decision: experimental packages follow the same dependency declaration rules. |
| `process/2026-10-14-no-top-level-await-in-packages.zh.md` | 中文镜像 — same decision: package sources must not use top-level await. |

`simplification/` — 13 notes, 26 files.

| File | What it is / what it pins |
| --- | --- |
| `simplification/2026-06-20-unify-agent-and-session-id.md` | An agent's registry id **equals** its session id; `Session.id` derives from `header.id`. The note's argument is that a second identity would not represent separate liveness, rollback or quiescence — it would only add translation state around the same transaction. The configuration label stays as display metadata, and the combined per-run id owns routing and persistence. |
| `simplification/2026-07-17-one-send-one-turn.md` | Each successful `send()` is one independent FIFO item and, if it runs, the **only** ordinary message in its turn. Implicit batching is removed because it made turn boundaries depend on scheduling rather than caller intent, and because B could otherwise enter A's model request before seeing A's closed result. The price is stated: more model requests, more checkpoints, and a busier queue. |
| `simplification/2026-07-23-acp-automation-only-protocol.md` | ACP is reduced to an **automation transport** (session lifecycle, one in-flight prompt, model configuration, MCP mounting, committed semantic updates, cancellation, one-shot permission requests). All editor-UI translation is removed. Image capability is advertised only when a durable store exists *and* the configured route accepts image input — "unknown capability is false at initialization". The snapshot suite is kept, minus the scenarios driven by deleted UI methods. |
| `simplification/2026-07-28-remove-synthetic-log-only-turns.md` | A title update no longer opens a synthetic `turn/start`/`turn/end` pair. Synthetic turns inflated turn counts, produced execution outcomes for work that never ran the model, and let a late metadata write consume the next turn number. A plugin that promises durability awaits `ctx.sessions.flush()` explicitly. "One turn represents one model-loop execution." |
| `simplification/2026-08-09-explicit-schedule-time-zone.md` | The browser time zone is **request-local source data**, not a persisted Session default: no Session header, no JSONL field, no SQLite column, no create/resume/fork conflict rule. Schedule accepts only a strict offset-bearing RFC 3339 string or an exact `{ date, time, time_zone }`, and stores only canonical UTC. The structured form requires its zone even when time-context just showed the model one. |
| `simplification/2026-08-30-jsonl-only-session-persistence.md` | JSONL becomes the **sole first-party** `ctx.sessionPersistence` implementation; the SQLite provider, its schema, tests and Windows differential lane are removed. A disposable derived index (the SQLite FTS query provider) is explicitly *not* an alternative authoritative store. The note names the compatibility cost (retained opt-in databases are not migrated). |
| `simplification/2026-09-09-nontransactional-loader.md` | Loader mutations are reverted to **non-transactional**: a failed plugin activation can leave the new options and a failed fiber in place, and no previous plugin or configuration is restored. The note's argument is that transactional reload requires Loader to own candidate imports, lifecycle settlement, rollback and option identity — making the vendored implementation substantially different from its pinned sources. Application consumers own their own completion checks. |
| `simplification/2026-09-11-remove-e2b-providers.md` | The E2B sandbox/filesystem/subprocess providers are removed. The decisive reason is transport-shaped: PTC's bidirectional control channel cannot ride a SDK that only exposes standard streams and retains complete stdout/stderr, and building the bridge would have become "a separate remote transport project". Reintroduction conditions are written down. |
| `simplification/2026-09-17-unified-subagent-activations.md` | `startActivation()` becomes the single consumer entry point for every provider, exposing child identity, a result promise and disposal of that exact activation. The model-facing tool always returns a background child id and promises a completion notice — no foreground switch, no Job integration. "An answer already sent through the tool can appear twice; accepting that duplication avoids making result delivery depend on model compliance." |
| `simplification/2026-09-19-remove-desktop-profile-core-cleanup.md` | The Desktop production profile cleanup is deleted: production launches no longer write into the profile's `node_modules`, manifest, overrides or lockfile. The note explains that the residue it served is no longer produced, and that the old cleanup "fought the next pnpm operation". Reintroduction conditions are written down. |
| `simplification/2026-09-26-team-direct-inbox.md` | Team sends go through the **target Agent inbox** and return the accepted `MessageId`; the Team outbox, its acknowledgements, its retry ordering and its durable intent are gone. Acceptance is not a model-processing confirmation and not a synchronous flush. Historical mailbox records stay decodable so old Lead logs replay, but are never delivered. |
| `simplification/2026-10-05-native-or-ptc-presentation.md` | One tool invocation form per agent: `native` or `ptc`, and the registry **rejects** `both` in configuration rather than silently mapping it. Mixed presentation would duplicate the advertised capability information and preserve a third admission case. |
| `simplification/2026-10-09-preset-owned-subagent-composition.md` | New subagent requests select an Agent Preset; persona and tools come from its plugin list. Per-request `persona` and `toolFilter` keys are **rejected at load** (deleting Schemastery fields alone would not reject unknown configuration). Released child descriptors keep their historical fields and cold-resume semantics — new-request simplification does not authorize rewriting released Session data. |
| `simplification/2026-06-20-unify-agent-and-session-id.zh.md` | 中文镜像 — same decision: unify the agent id and the session id. |
| `simplification/2026-07-17-one-send-one-turn.zh.md` | 中文镜像 — same decision: remove implicit batching from ordinary sends. |
| `simplification/2026-07-23-acp-automation-only-protocol.zh.md` | 中文镜像 — same decision: ACP as an automation-only protocol. |
| `simplification/2026-07-28-remove-synthetic-log-only-turns.zh.md` | 中文镜像 — same decision: remove synthetic turns for log-only events. |
| `simplification/2026-08-09-explicit-schedule-time-zone.zh.md` | 中文镜像 — same decision: the explicit Schedule time-zone boundary. |
| `simplification/2026-08-30-jsonl-only-session-persistence.zh.md` | 中文镜像 — same decision: JSONL-only first-party Session persistence. |
| `simplification/2026-09-09-nontransactional-loader.zh.md` | 中文镜像 — same decision: keep Loader mutations non-transactional. |
| `simplification/2026-09-11-remove-e2b-providers.zh.md` | 中文镜像 — same decision: remove the E2B execution providers. |
| `simplification/2026-09-17-unified-subagent-activations.zh.md` | 中文镜像 — same decision: unified subagent activations. |
| `simplification/2026-09-19-remove-desktop-profile-core-cleanup.zh.md` | 中文镜像 — same decision: remove the Desktop production profile core-package cleanup. |
| `simplification/2026-09-26-team-direct-inbox.zh.md` | 中文镜像 — same decision: Team messages use the target inbox. |
| `simplification/2026-10-05-native-or-ptc-presentation.zh.md` | 中文镜像 — same decision: one tool invocation form per agent. |
| `simplification/2026-10-09-preset-owned-subagent-composition.zh.md` | 中文镜像 — same decision: preset-owned subagent composition. |

`testing/` — 18 notes, 36 files.

| File | What it is / what it pins |
| --- | --- |
| `testing/2026-06-19-real-api-e2e-ci.md` | Real-API e2e runs in a **separate secret-bearing workflow** (forkable, keyless `ci.yml` stays untouched), with a preflight that turns a missing secret into a loud failure instead of a false green. The threat model is written out: fork PRs cannot reach the key; same-repo write access always can; `pull_request_target` is forbidden with a comment; logs become world-readable on a public flip. |
| `testing/2026-07-24-web-gui-browser-e2e-lane.md` | A **keyless, deterministic browser e2e lane** that replays recorded session logs through the real chromium → SSE → apiproxy → loop → tools → persistence chain. The determinism rules are the valuable part: a barrier stack of `agent.whenIdle()` then a settled browser poll; polling persistence files as a completion barrier is banned; `networkidle` is banned outright; no single-shot transient-DOM assertions; every scenario fails on any pageerror *and* on connection-loss console warnings, because the reconnect machine would otherwise self-heal a dead wire and certify it. |
| `testing/2026-08-03-opt-in-reasoning-chunk-browser-stress.md` | Live chunk publication is bounded by the browser's **paint rate** (`requestAnimationFrame` coalescing), not by React's batching — because each `yield` in an async stream can create a microtask boundary, which degrades microtask batching into one render per chunk. The opt-in stress lane drives 100,000 reasoning deltas and measures one bounded ingestion/render interval rather than socket backlog. |
| `testing/2026-08-23-installed-python-wheel-black-box-ci.md` | The installed artifact is the boundary: every native target installs the SDK wheel and runtime wheel into a fresh venv, and the harness **rejects** a non-venv process, a repo-relative working directory, a source import, unequal distribution versions, or an executable outside the installed runtime package — before the first agent request, so a behaviour pass cannot conceal that the wrong code ran. |
| `testing/2026-08-24-session-log-snapshot-corpus.md` | The snapshot corpus reserves `snapshots/` and `*.snapshot.ts` for scenarios that own recorded session JSONL; the recorded session is both replay input *and* expected output. Invariants include: at most ten selected historical roles, current roles outnumber them, mutating scenarios verify their final workspace externally, and a scenario-owned HTTP fixture binds loopback port `0` so concurrent jobs cannot race a reserved port. |
| `testing/2026-09-04-session-open-performance-gate.md` | A required CI gate with **per-endpoint budgets** (open, read, restore, projection, first history, Agent resume, retained heap, Client-fold scaling, a 128 MB constrained-heap completion check) calibrated against a fixed synthetic 127,400-event workload. Positive and negative controls are quoted: the known regression measured 4,197 ms and exhausted its heap while the pre-stack reference took 249 ms. Budgets are reviewed source constants with no environment override. |
| `testing/2026-09-06-backend-continuation-performance.md` | Baseline-only performance measurement for tool-heavy continuation: 800 completed two-step turns, four tool calls per turn, 13,600 events. The note refuses to apply an optimization and its desired budget in the same change, and records that one CI attempt failed every budget on one runner and passed on another with a different Node version — so neither the budgets nor the scale were changed on that evidence. |
| `testing/2026-09-06-frontend-performance-budgets.md` | Browser-side budgets for a 240-turn conversation: browser open, slowest older page, first Trajectory, first reply, main-thread task duration, draft typing, complete response, and reconnect replacement. The note isolates **observer cost** from product latency (scoping queries to the composer and the latest Assistant), replaces Playwright's selector backoff with frame-based readiness, and records that one hosted run failed the input-overlap assertion only under CPU throttling. |
| `testing/2026-09-10-desktop-local-updater-qualification.md` | Desktop update downloads are qualified against a **loopback server** with real `ElectronHttpExecutor` and `NsisUpdater`, using request barriers instead of sleeps. The note also pins the invisible failure modes: Electron 44 emits `close` before response headers, so that event cannot signal HTTP completion; and a hidden/occluded renderer can suspend frame callbacks even when DOM queries complete. |
| `testing/2026-09-14-desktop-installed-update-journal.md` | An opt-in JSONL journal directory survives an update (which replaces application files and kills the observing process). Field **whitelisting**, not secret redaction, is the privacy mechanism: raw errors, URLs, request headers and chat content are omitted, and known error tokens map to fixed classifications. |
| `testing/2026-09-14-desktop-installed-update-materials.md` | Installed-update materials are isolated from real releases and user data: a random test identity and distribution namespace, private runtime copies, a validated bootstrap, and separate external journals per version. The note's most useful line is a diagnostic: "object access and bucket configuration have separate permissions" — a denied bucket-config query is not evidence of an upload failure. |
| `testing/2026-09-27-observation-waits-on-observed-state.md` | Two self-hosted cases observed state through a **wall-clock window** instead of the state they asserted on. The fix anchors the bounded wait on the hand-over, and the settle-reason assertion now carries a full per-send readiness timeline (every pty chunk, every foreground poll, every input write, each settle reason and elapsed time) so a failure names the state instead of inferring it from wall time. |
| `testing/2026-09-27-plugin-manager-git-child-environment.md` | A credential-shaped-name env scrub removed `GIT_CONFIG_KEY_0` but kept `GIT_CONFIG_COUNT`, so every Git child died with "missing config key". The two specs now delete the whole command-line config group before spawning Git, and the product-side fix is deliberately deferred to its own PR — with the branch name recorded. |
| `testing/2026-09-27-spreadsheet-selection-by-keyboard-before-reflow.md` | A browser flake caused by a **deferred React updater** resolving a cell from stale geometry: the same click executed four times, twice before and twice after the sidebar was resized, and the committed selection became `B1`. The fix selects by keyboard (committed state) instead of by pointer (geometry-bound updater), and the note names exactly when a pointer click remains valid in this lane. |
| `testing/2026-09-28-session-corpus-performance.md` | A heavy-tailed corpus benchmark: 22 upper-quantile anchors sampled from 1,650 real Sessions' *aggregate counts only* (no content, identity or path left that machine), with all dimensions sharing a rank so a long Session is long in every dimension. The projection cache is part of the list endpoint on purpose. Budgets use hosted expectations because the hosted-to-reference ratio (2.4–3.4) exceeds the shared scale. |
| `testing/2026-10-07-memory-limited-benchmarks.md` | Benchmarks are re-run inside a cgroup v2 with `memory.max` 4 or 8 GiB and swap disabled, because neither hosted runners (16 GB) nor developer machines show how the Host, Chromium and page cache share a small budget. The alternatives are quantified: a `--max-old-space-size` flag does not model the machine (100 MB heap vs 0.7–1.2 GB resident) and `RLIMIT_AS` fails because V8 reserves address space. |
| `testing/2026-10-07-scaled-benchmark-report.md` | Every `test:bench` run writes a self-contained HTML report that scales each measured median to 2015/2019/2023/2026 laptops, mainstream cloud instances and the hosted runners, using PassMark single-thread ratings and a modelled storage share — because "a passing or failing number does not convey user impact". Memory peaks are shown as a share of 4 GB and 8 GB. |
| `testing/2026-10-11-user-text-credential-matching.md` | Credential matching in user text is **linear by construction**: a literal-only alternation finds format starts (no quantifier, so no backtracking), an `Int32Array` memo measures each character at most once per class, and the cost is proportional to the number and length of credentials rather than to the number of queries. The benchmark asserts absolute budgets, doubling ratios, and an allocation floor, with a regex implementation kept as an **equivalence oracle**. |
| `testing/2026-06-19-real-api-e2e-ci.zh.md` | 中文镜像 — same decision: real-API e2e in CI against the external DeepSeek API, in its own secret-bearing workflow. |
| `testing/2026-07-24-web-gui-browser-e2e-lane.zh.md` | 中文镜像 — same decision: the keyless browser e2e lane for the web GUI. |
| `testing/2026-08-03-opt-in-reasoning-chunk-browser-stress.zh.md` | 中文镜像 — same decision: frame-coalesced reasoning-chunk publication and browser stress validation. |
| `testing/2026-08-23-installed-python-wheel-black-box-ci.zh.md` | 中文镜像 — same decision: installed-wheel Python runtime pull-request validation. |
| `testing/2026-08-24-session-log-snapshot-corpus.zh.md` | 中文镜像 — same decision: the session-log snapshot corpus. |
| `testing/2026-09-04-session-open-performance-gate.zh.md` | 中文镜像 — same decision: the required CI performance gate for opening large Sessions. |
| `testing/2026-09-06-backend-continuation-performance.zh.md` | 中文镜像 — same decision: performance baselines for tool-heavy backend continuation. |
| `testing/2026-09-06-frontend-performance-budgets.zh.md` | 中文镜像 — same decision: frontend large-session performance budgets. |
| `testing/2026-09-10-desktop-local-updater-qualification.zh.md` | 中文镜像 — same decision: qualify Desktop update downloads with an isolated local server. |
| `testing/2026-09-14-desktop-installed-update-journal.zh.md` | 中文镜像 — same decision: preserve installed Desktop update evidence across restarts. |
| `testing/2026-09-14-desktop-installed-update-materials.zh.md` | 中文镜像 — same decision: isolate installed-update materials from releases and user data. |
| `testing/2026-09-27-observation-waits-on-observed-state.zh.md` | 中文镜像 — same decision: Windows-lane observations wait on the state they read. |
| `testing/2026-09-27-plugin-manager-git-child-environment.zh.md` | 中文镜像 — same decision: plugin-manager Git children isolate the host's command-line configuration. |
| `testing/2026-09-27-spreadsheet-selection-by-keyboard-before-reflow.zh.md` | 中文镜像 — same decision: the web lane moves spreadsheet selections by keyboard before reflow assertions. |
| `testing/2026-09-28-session-corpus-performance.zh.md` | 中文镜像 — same decision: performance baselines for large Session corpora. |
| `testing/2026-10-07-memory-limited-benchmarks.zh.md` | 中文镜像 — same decision: memory-limited benchmark reruns. |
| `testing/2026-10-07-scaled-benchmark-report.zh.md` | 中文镜像 — same decision: the scaled machine and memory-pressure benchmark report. |
| `testing/2026-10-11-user-text-credential-matching.zh.md` | 中文镜像 — same decision: linear credential matching and performance gates for user text. |

`index/` — 2 files.

| File | What it is / what it pins |
| --- | --- |
| `.agents/notes/implemented/AGENTS.md` | The maintenance rule for shipped notes: keep paths/symbols/defaults current **in the same change** that alters them; rewrite stale facts in place, never append change history; archive a note wholesale through `dsh-archive-agent-notes` rather than maintaining a useless one; a *reversal of the decision* requires a new Agent Note plus a cross-link, and a fully superseded note may be deleted only under the consolidation rule. |
| `.agents/notes/implemented/CLAUDE.md` | A one-line pointer file whose entire body is `AGENTS.md` — a Claude-Code convention that the same rules apply. |

### Tier 3 — skipped with a reason

All 116 `.i18n.yaml` files are **generated bilingual-pair consistency records**: a machine-written
file (produced by `pnpm run verify-translation-pairing --write <note>.md`) holding, per heading
section, a hash of that section's English block and Chinese block, outside code blocks and
generated regions. They contain no prose and no decision. Each one's header and structure were
confirmed by reading its first lines; none was read line by line.

| File | Why skipped |
| --- | --- |
| `bug-fix/2026-09-06-packed-install-private-npm-cache.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-09-15-authenticated-browser-host-preferences.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-09-15-client-session-blank-reconciliation.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-09-20-session-open-read-coordination.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-09-27-pwsh-prompt-tail-grace.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-09-28-pty-bundled-console-host.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-09-29-reused-blank-runs-requested-preset.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-09-30-job-session-lifecycle.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-09-30-session-list-host-fairness.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-10-10-background-shell-command-display.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `bug-fix/2026-10-11-process-specific-prompt-values-in-runtime-context.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-06-15-ptc.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-07-06-approval-seam.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-07-10-parallel-tool-call-execution.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-07-12-subagent-persona-tool-filter-and-depth.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-07-16-persistent-pty-sessions.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-07-19-model-facing-goal-tools.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-07-20-ptc-typed-tool-returns.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-07-28-continuable-subagent-conversations.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-08-05-agent-teams.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-08-05-context-form-vocabulary.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-08-08-windows-acl-restricted-token-sandbox.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-08-15-product-subagent-noninteractive-permissions.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-08-24-user-authorized-subagent-model-routes.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-08-26-generic-file-upload.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-08-28-auto-review.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-08-31-cross-process-session-write-lease.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-02-in-history-system-prompt-replacement.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-04-right-sidebar-docking-infrastructure.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-07-deepseek-messages-adapter.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-08-present-workspace-source-files.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-09-web-sidebar-terminal.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-13-explicit-worktree-creation.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-14-desktop-primary-runtime.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-14-unattended-browser-terminal-reclamation.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-16-browser-excel-preview.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-16-sidebar-browser.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-17-sidebar-file-and-directory-auto-refresh.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-19-windows-acl-mandatory-integrity-confinement.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-20-config-schema-dump-validation-policy.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-20-desktop-browser-webview.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-20-spawn-agent-preset-selection.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-21-archive-stops-running-session-work.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-22-archive-admission-reads-stored-tasks.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-24-auto-review-user-approval-fallback.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-09-24-session-inspector.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-10-02-plugin-market-discover.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-10-02-plugin-market-index-format.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-10-14-built-in-plugin-feature-previews.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-10-14-host-release-change-refresh-prompt.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `feature/2026-10-15-deepseek-search-fetch-api.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-07-06-node-engine-floor.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-07-21-serial-cross-platform-ci-reference.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-07-26-ci-failover-runbook.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-07-26-dependencies-over-hand-rolling.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-07-26-frozen-agent-note-archive.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-07-27-worktree-local-lefthook.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-07-30-generated-third-party-notices.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-08-02-native-github-stacks-and-optional-rebases.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-08-08-native-windows-pull-request-ci.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-08-08-unified-github-label-taxonomy.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-08-10-event-directed-pr-review-status.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-08-10-npm-release-sequences.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-08-26-ban-ambiguous-origin-label.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-08-26-published-dependency-faces.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-06-python-runtime-windows-hosted.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-09-blacksmith-failover-leg.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-09-parallel-macos-notarization.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-11-persistence-type-history.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-12-default-product-experimental-isolation.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-14-generated-cli-help-reference.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-15-shipped-optional-bundles.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-17-persistence-schema-review.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-17-windows-runtime-signature-cache.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-17-windows-signature-completion.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-19-no-unknown-casts.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-09-28-dual-release-install-layout-work-budget.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-10-05-pr-artifact-typechecks.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-10-05-product-package-classification.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-10-08-session-reader-compatibility-review.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-10-11-build-artifacts-check-split.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-10-11-lossless-build-speedups.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-10-12-local-gate-speedups.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-10-14-experimental-dependency-policy.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `process/2026-10-14-no-top-level-await-in-packages.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-06-20-unify-agent-and-session-id.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-07-17-one-send-one-turn.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-07-23-acp-automation-only-protocol.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-07-28-remove-synthetic-log-only-turns.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-08-09-explicit-schedule-time-zone.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-08-30-jsonl-only-session-persistence.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-09-09-nontransactional-loader.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-09-11-remove-e2b-providers.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-09-17-unified-subagent-activations.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-09-19-remove-desktop-profile-core-cleanup.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-09-26-team-direct-inbox.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-10-05-native-or-ptc-presentation.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `simplification/2026-10-09-preset-owned-subagent-composition.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-06-19-real-api-e2e-ci.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-07-24-web-gui-browser-e2e-lane.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-08-03-opt-in-reasoning-chunk-browser-stress.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-08-23-installed-python-wheel-black-box-ci.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-08-24-session-log-snapshot-corpus.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-04-session-open-performance-gate.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-06-backend-continuation-performance.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-06-frontend-performance-budgets.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-10-desktop-local-updater-qualification.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-14-desktop-installed-update-journal.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-14-desktop-installed-update-materials.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-27-observation-waits-on-observed-state.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-27-plugin-manager-git-child-environment.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-27-spreadsheet-selection-by-keyboard-before-reflow.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-09-28-session-corpus-performance.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-10-07-memory-limited-benchmarks.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-10-07-scaled-benchmark-report.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |
| `testing/2026-10-11-user-text-credential-matching.i18n.yaml` | Generated bilingual-pair hash record; header + structure confirmed. |

---

## 2. Ideas worth stealing

Marker meanings: **UNIQUE** = distinctive to this repository's shard; **CONVERGENT** = two or more
independent mechanisms *within* this repository already do the same thing (a strong signal on its
own); where a convergence with the other two reference repos is likely but could not be verified
from this shard alone, the item says so.

1. **A decision log that cannot be quietly rewritten.** — `AGENTS.md` (shipped-note maintenance
   rule) + `process/2026-07-26-frozen-agent-note-archive.md`. *What:* a shipped decision is a file
   whose factual realization is edited in place, but whose **decision** may only change via a new
   note plus a cross-link; low-value notes move to a content-sealed archive with an append-only
   SHA-256 manifest. *Why it transfers:* August Trading's `docs/plan/` is the same artefact at a
   different maturity — this pattern gives it a mechanical rule for "when is this a fact update vs
   a reversal", plus a retirement path that does not delete the reasoning.
   *Where:* `.agents/notes/implemented/AGENTS.md:7-19`;
   `process/2026-07-26-frozen-agent-note-archive.md` §Decision. **UNIQUE.**
2. **One approval vocabulary, fail-closed, with a durable audit pair.** — `feature/2026-07-06-approval-seam.md`.
   *What:* a single package owns a closed outcome set (`allowed-once | rejected | cancelled |
   unavailable`); answerers are waterfall listeners; zero listeners ⇒ `unavailable`; the
   per-session `'never'` policy rejects *inside* the service so no listener can bypass it; every
   request appends a model-invisible `approval/asked` / `approval/decided` pair; `allow_always` is
   **not advertised** until grant storage, scope and revocation are designed. *Why it transfers:*
   August Trading's trade-plan validation and any approval-gated action currently have no single
   closed outcome vocabulary and no durable "who approved what" trail. *Where:*
   `feature/2026-07-06-approval-seam.md` §"The seam: mechanism and policy split" and §Deferred.
   **CONVERGENT** with the Auto-review fallback note (a *second, independent* approval path in the
   same repo that reuses the same `ask` decision rather than inventing a second vocabulary).
3. **"Visibility is not authority" stated as a first-class rule.** —
   `feature/2026-07-12-subagent-persona-tool-filter-and-depth.md` §"Visibility is not authority";
   `feature/2026-08-28-auto-review.md` §Risks. *What:* a tool filter changes what the model can
   *see and *call*, but explicitly does not create a parent→child grant lattice, does not require
   a child to be a subset of its parent, and does not stop another in-process caller. *Why it
   transfers:* August Trading's bot roster, trade-log actions and skill filters all read as if they
   were boundaries; this note is the model for saying exactly what they are not.
   *Where:* `feature/2026-07-12-subagent-persona-tool-filter-and-depth.md` §"Visibility is not
   authority". **UNIQUE.**
4. **Execution-time authority instead of prompt-level authority.** —
   `feature/2026-07-19-model-facing-goal-tools.md` §"Execution authority". *What:* a state-changing
   tool verifies, at execution time, that the caller is the exact running agent, the current driver
   initiator, with an open turn and an accepted **direct-human** message in the current turn; the
   host *attests* human provenance (`Agent.followup()` requires an explicit source), and the
   recorded source fields cannot be used as authority. *Why it transfers:* August Trading's
   "log this trade", "apply skill", "start automation" actions are all currently model-arg-driven;
   this is the pattern for making them human-authorised. *Where:*
   `feature/2026-07-19-model-facing-goal-tools.md` §"Execution authority". **UNIQUE.**
5. **A ratchet instead of a budget: the baseline can only shrink.** —
   `process/2026-09-19-no-unknown-casts.md`; also `process/2026-09-28-dual-release-install-layout-work-budget.md`.
   *What:* instead of a lint rule with a warning budget, the repository keeps an exact baseline
   (path + a SHA-256 of the offending syntax tokens + occurrence count) that may only be edited to
   delete entries or reduce counts; a file-wide allowance would let a new violation replace a
   removed one. The same shape appears as a *work budget* (`packages × edges ≤ 875_000`) that
   replaces a wall-clock timeout, because a slow runner and a bigger graph were indistinguishable.
   *Why it transfers:* this is the answer to "how do you stop bad rules accumulating" for
   August Trading's trade-journal and learning systems: a counted, fingerprinted, monotonically
   shrinking baseline. *Where:* `process/2026-09-19-no-unknown-casts.md` §Decision.
   **CONVERGENT** (the same ratchet shape appears independently in the work-budget note).
6. **Prompt-cache stability as a first-class design goal.** —
   `feature/2026-09-02-in-history-system-prompt-replacement.md`; also
   `bug-fix/2026-10-11-process-specific-prompt-values-in-runtime-context.md`. *What:* a route
   capability lets the loop *append* a new `system/message` node instead of rewriting node 0, so
   the provider prefix cache survives; a four-row table maps (capability × prefix state) to
   replace/append/consolidate/clear; and **process-specific values** (the checkout path, the Web
   URL) are moved out of the system prompt entirely into runtime-context snapshots, because
   changing them rewrote the head and broke provider thinking-block signatures. *Why it transfers:*
   August Trading's system prompt is assembled from many services; any per-session value in it
   (a strategy id, a risk mode, a session title) destroys the cache. *Where:*
   `feature/2026-09-02-in-history-system-prompt-replacement.md` §"The decision rule";
   `bug-fix/2026-10-11-process-specific-prompt-values-in-runtime-context.md` §Decision.
   **UNIQUE.**
7. **"Archive must not hide running work."** —
   `feature/2026-09-21-archive-stops-running-session-work.md`. *What:* archiving refuses by default
   when anything is still running; the confirmation dialog is built from the **Host's own answer**
   rather than a client-side mirror; the archive write happens *before* the stops are issued, so
   every wake the stops induce is already blocked by a `pre-step` gate; and the stop is the user's
   ordinary cancel path, so the log ends regularly. The note compares six peer products' semantics
   in a table. *Why it transfers:* this is the pattern for August Trading's "close a trade" /
   "archive a session" / "stop an automation" actions, where the obvious implementation (hide the
   row) silently keeps spending tokens. *Where:* `feature/2026-09-21-archive-stops-running-session-work.md`
   §Decision. **CONVERGENT** with `feature/2026-09-22-archive-admission-reads-stored-tasks.md`
   (the admission answer must come from the *stored* rows, not a live fold — otherwise a cold
   session with an armed reminder archives silently).
8. **A derived index is not an authoritative store.** —
   `simplification/2026-08-30-jsonl-only-session-persistence.md`. *What:* the repository keeps
   exactly **one** first-party physical Session format (JSONL) and deletes the second; the SQLite
   FTS provider survives explicitly as a *disposable projection* that observes persistence through
   the service and can be rebuilt. *Why it transfers:* August Trading's SQLite storage + the
   IndexedDB web fallback are two authorities for the same trade log; this note says which one
   wins and what the other becomes. *Where:*
   `simplification/2026-08-30-jsonl-only-session-persistence.md` §Decision. **UNIQUE.**
9. **Durable, queryable job facts with an honest "incomplete" state.** —
   `bug-fix/2026-09-30-job-session-lifecycle.md`. *What:* `job/registered` / `job/settled` facts
   (epoch-ms timestamps, owner, producer kind, label, creating tool call) are appended
   **synchronously at the registry commit** so causal order survives; `producerReported`
   distinguishes a producer's fulfilment from forced teardown bookkeeping; a missing terminal
   record stays *incomplete* and is never reconstructed from a later read. *Why it transfers:*
   this is exactly the shape a trading backtest/scheduled-scan job log needs. *Where:*
   `bug-fix/2026-09-30-job-session-lifecycle.md` §Decision. **UNIQUE.**
10. **Time-slice host work on a work budget, and never return a partial list.** —
    `bug-fix/2026-09-30-session-list-host-fairness.md`. *What:* one monotonic deadline; yield only
    after `listWorkSliceMs` of work; every row stays synchronous; cancellation is checked per row,
    after each yield and before returning; **no partial list is returned**. The note publishes the
    full benchmark (sync vs per-row yield vs 16 ms slices) rather than asserting a win. *Why it
    transfers:* August Trading's trade list and chart data assembly are the same shape. *Where:*
    `bug-fix/2026-09-30-session-list-host-fairness.md` §Decision + §Measurement. **UNIQUE.**
11. **One decision vocabulary for injected context.** —
    `feature/2026-08-05-context-form-vocabulary.md`. *What:* `kind` answers *who* produced a
    non-user message; a new `form` answers *what shape* it is (`instructions | catalog | snapshot |
    notice | relay | recall`); the vocabulary is semantic, never visual; and readers are
    **all-or-nothing** — one unreadable entry disqualifies the record rather than producing a
    confident but incomplete account of what the model read. *Why it transfers:* August Trading's
    injected context (strategy notes, skill catalog, account snapshot, run policy) is currently a
    wall of escaped JSON. *Where:* `feature/2026-08-05-context-form-vocabulary.md` §Decision.
    **CONVERGENT** with `bug-fix/2026-10-10-background-shell-command-display.md`, which applies
    the same "one shape, one presentation" discipline to tool cards.
12. **Record-once/replay-forever for the UI, with a determinism rulebook.** —
    `testing/2026-07-24-web-gui-browser-e2e-lane.md`. *What:* recorded session logs replay through
    the *real* assembled chain (browser → SSE → apiproxy → loop → tools → persistence); the
    barrier stack is `agent.whenIdle()` then a settled browser poll; polling persistence files as
    a completion barrier is banned; `networkidle` is banned outright; no single-shot transient-DOM
    assertions; every scenario fails on any pageerror **and** on connection-loss console warnings,
    because the reconnect machine would otherwise self-heal a dead wire and certify it. *Why it
    transfers:* August Trading's `render-probe` is the ancestor of this idea but has no recorded
    replay corpus. *Where:* `testing/2026-07-24-web-gui-browser-e2e-lane.md` §"Determinism rules".
    **UNIQUE.**
13. **Prefer maintained dependencies over hand-rolling — stated as a policy, with a bar.** —
    `process/2026-07-26-dependencies-over-hand-rolling.md`. *What:* a dependency swap must show
    *net deletion* of owned code+tests+docs, be healthy, fit the boundary, and not reopen a
    settled seam; a util package whose whole job a maintained package does better is replaced
    rather than preserved for its "zero-dependency" charter. *Why it transfers:* August Trading
    hand-rolls SSE parsing, zod schemas, retry, and job scheduling. *Where:*
    `process/2026-07-26-dependencies-over-hand-rolling.md` §Decision. **UNIQUE.**
14. **An explicit "one invocation form" rule that rejects the mixed mode.** —
    `simplification/2026-10-05-native-or-ptc-presentation.md`. *What:* each agent picks `native` or
    `ptc`; the registry **rejects** `both` rather than silently mapping it, and an upgrade guide
    states what was lost. *Why it transfers:* a small, transferable discipline for August Trading
    whenever two ways of doing the same thing appear. *Where:*
    `simplification/2026-10-05-native-or-ptc-presentation.md` §Decision. **UNIQUE.**

## 3. Trading-specific findings

Answering the brief's six questions **for this shard**; where a question belongs to another
shard, that is stated.

- **Long-lived monitoring & scheduled work.** This shard contains the *governance* of scheduled
  work, not the scheduler itself. Three mechanisms are visible and directly transferable:
  (1) a scheduled item is **stored state that outlives its session's agent**, and admission must
  read the stored rows — "an idle or cold Session whose stored rows are armed refuses the
  archive" (`feature/2026-09-22-archive-admission-reads-stored-tasks.md:§Decision`); a live
  reminder must not be inferred from liveness. (2) Reclamation is gated by **positive evidence of
  idleness** plus a full grace period, and *unknown* activity cancels the deadline — a silent
  build or a shell waiting for input is protected (`feature/2026-09-14-unattended-browser-terminal-reclamation.md:§Decision`).
  (3) A background job's execution interval is recorded durably at registration and settlement,
  including the forced-teardown case, and a missing terminal record is honestly "incomplete"
  (`bug-fix/2026-09-30-job-session-lifecycle.md:§Decision`). **Breakers**: the closest thing here
  is the Auto-review denial path returning to a human `ask`, and the "three consecutive rounds"
  blocking threshold in the goal tools (`feature/2026-07-19-model-facing-goal-tools.md:§Blocking
  threshold`) — a mechanical lower bound on repeated failure, with the caveat that the runtime
  cannot prove the *same* condition recurred.
- **Human-in-the-loop approval.** The richest material in the whole shard. The approval seam
  (`feature/2026-07-06-approval-seam.md`) gives a closed outcome vocabulary, a fail-closed default
  with no configuration, a per-session `'never'` tier enforced *inside* the service so no
  listener can bypass it, a durable model-invisible audit pair, and a deliberate refusal to
  advertise a grant the harness cannot honour (`allow_always` is deferred until scope, storage and
  revocation are designed). The Auto-review pair adds a machine reviewer with a strict effect
  taxonomy and a **fallback to the human** when the policy is `ask`
  (`feature/2026-08-28-auto-review.md`, `feature/2026-09-24-auto-review-user-approval-fallback.md`).
  Product subagents use the products' own native non-interactive permission modes, fixed by the
  provider and **absent from the tool schema**, so a model cannot raise its own authority
  (`feature/2026-08-15-product-subagent-noninteractive-permissions.md`). For a trading app, the
  transferable shape is: one outcome vocabulary, one audit pair, one fail-closed default, and no
  "remember my answer" until scope and revocation exist.
- **Post-mortem / reflection loops.** This shard does **not** contain the harness's learning or
  reflection loop; it contains the *anti-accumulation* machinery that a reflection loop needs.
  Three ratchets: the fingerprinted, monotonically shrinking baseline
  (`process/2026-09-19-no-unknown-casts.md`); the work budget that must be re-raised with a new
  measurement (`process/2026-09-28-dual-release-install-layout-work-budget.md`); and the
  persistence-type history, where **every structural difference needs an acknowledgement** and
  the acknowledgement is bound to the *after schema* of that root
  (`process/2026-09-11-persistence-type-history.md`, `process/2026-09-17-persistence-schema-review.md`).
  The rule that would transfer most directly to August Trading's learning/rule system: a rule
  needs a per-item acknowledgement, a "was this material?" verdict, and an explicit
  required-feature/optional-feature distinction — and a change that reuses a logged value with a
  different meaning is always a version bump (`process/2026-10-08-session-reader-compatibility-review.md`).
- **Multi-agent.** Substantial. Subagents are **continuable**: one durable Session, at most one
  process-local Activation, and the Agent inbox as the *only* turn FIFO — explicitly no second
  queue and no Job, because two FIFOs have no single ordering authority
  (`feature/2026-07-28-continuable-subagent-conversations.md`). Local and external providers
  share one `startActivation()` entry point
  (`simplification/2026-09-17-unified-subagent-activations.md`). Agent Teams add a durable flat
  roster, compare-and-set task snapshots with `expectedRevision`, and a `wait_agent` that blocks
  on an edge registered *after* the call to stop the model polling
  (`feature/2026-08-05-agent-teams.md`). **Where debate is wasted:** the notes do not implement
  debate at all — and they say why the debate-shaped alternative was rejected. "One Activation per
  `next-turn`" was rejected because it needs a manager FIFO beside the Agent inbox; a second
  Team outbox was rejected because it duplicates inbox ownership with separate identities,
  acknowledgements, checkpoints and retry ordering
  (`simplification/2026-09-26-team-direct-inbox.md`). The transferable lesson for a trading
  multi-agent setup: *one queue per destination*, and let the message bus be the queue.
- **Structured logs the model can query.** The storage decision is explicit: **one** first-party
  physical Session format (JSONL), with SQLite retained only as a disposable rebuildable FTS
  projection (`simplification/2026-08-30-jsonl-only-session-persistence.md`). Cross-process
  ownership of that log is a **kernel** lease — `flock` on POSIX, a named semaphore on Windows —
  because a TTL-with-renewal lease still allowed bounded dual-writer overlap; a crashed holder
  never blocks a successor and there is no expiry bookkeeping
  (`feature/2026-08-31-cross-process-session-write-lease.md`). The queryable-log discipline that
  transfers: the model-visible projection (`tool/result`, `approval/asked/decided`, `job/settled`,
  `fs/observed`) is separate from the durable event stream, and each has its own owner.
  Also relevant to a trade log: the installed-artifact / version-compatibility discipline —
  "Session versions follow reader compatibility", not schema shape
  (`process/2026-10-08-session-reader-compatibility-review.md`).
- **Staying simple as features accumulate.** This shard is a catalogue of the removals. Two
  rules recur. (a) *One mechanism per concept, and delete the second*: the Agent inbox is the only
  turn FIFO; the Team outbox is gone; the Session store has no synthetic-turn helper; one
  `startActivation()` entry point; one tool invocation form per agent; one first-party Session
  persistence format; one approval vocabulary. (b) *A rule is not a licence to defer the
  decision*: the note must name what is being given up, and must record the **reintroduction
  conditions** — e.g. the E2B removal ("a remote provider needs a concrete execution use case and
  evidence for shared file/process coordinates, policy enforcement, bounded transport retention,
  independent control progress, precise channel closure and managed cancellation"), the Desktop
  profile cleanup, and the frozen-note archive. That reintroduction-conditions paragraph is the
  single most transferable artefact in the shard: it is how you delete a feature without losing
  the reason it might be needed.

## 4. Non-obvious decisions and gotchas

- **A note's "Alternatives considered" section is the real content.** The Decision sections are
  mostly restatements of what shipped; the Alternatives sections record *why the obvious
  alternative lost*, and they are the part that transfers. Examples that would mislead a skim
  reader: the auto-review policy looks like "a model reviews tool calls", but the note's real
  point is that history can establish a session-created object yet cannot authorize medium work
  (`feature/2026-08-28-auto-review.md`).
- **`get_goal` / `update_goal` and the approval seam use the *same* shape of authority, twice.**
  Goal tools require "an accepted user message or user steering event in the current turn of a
  runtime-root agent"; the approval seam requires the asking agent to be the exact live object
  owned by the session map. Both are *execution-time* checks that a prompt injection cannot
  bypass (`feature/2026-07-19-model-facing-goal-tools.md`, `feature/2026-07-06-approval-seam.md`).
- **The Agent inbox is the only queue — including for agent-to-agent messages.** A subagent's
  follow-ups, a Team message and a steer all land in the same inbox, and the Team decision
  deliberately deleted its own outbox (`simplification/2026-09-26-team-direct-inbox.md`). A
  reader looking for a "mailbox" service will not find one.
- **`isConcurrencySafe` is unary on purpose.** The scheduler does not compare sibling calls, so
  "safe only when the paths differ" is *not expressible* and such calls stay exclusive
  (`feature/2026-07-10-parallel-tool-call-execution.md`). Also: only the **dispatch** overlaps;
  `tools/pre-execute`/`tools/post-execute` stay in model order because middleware may hold
  ordered state — which means a "parallel" tool still pays serial middleware cost.
- **The Windows sandbox is partial by construction and says so.** `enforcement: 'partial'`
  appears in the product output because NTFS hard-link aliases cannot be path-confined by a
  restricted token, and a Low-integrity token cannot read a tree another sandbox stamped with an
  AppContainer package SID (`feature/2026-08-08-windows-acl-restricted-token-sandbox.md`).
- **The `unknown`-cast baseline is fingerprinted per occurrence, not per file.** Changing one
  identifier inside a cast invalidates the baseline entry even though runtime behaviour is
  unchanged (`process/2026-09-19-no-unknown-casts.md`).
- **A partial projection exits 1 even when stdout holds a valid schema.** The exit code answers
  "can this document replace native validation", not "was output produced"
  (`process/2026-09-20-config-schema-dump-validation-policy.md`).
- **The `promptTailGraceMs` default of `0` is a *documented value*, and `validateConfig` accepts
  zero for it specifically** — the one numeric bound where zero is meaningful
  (`bug-fix/2026-09-27-pwsh-prompt-tail-grace.md`).
- **The `job/settled` record distinguishes "the producer said it finished" from "we forced
  teardown"** via `producerReported`, and it reports fulfilment, *not* independently confirmed
  resource release (`bug-fix/2026-09-30-job-session-lifecycle.md`).
- **A writer in another process gets a kernel lock, and the lock file is deliberately never
  deleted on release** — because a later locker verifies the inode it locked is still the file at
  the lock path. Deleting the file on POSIX forfeits exclusion by design
  (`feature/2026-08-31-cross-process-session-write-lease.md`).
- **The approval seam's `policy: 'never'` is enforced *before* any answerer runs**, so no
  listener — including a hostile one — can grant under it
  (`feature/2026-07-06-approval-seam.md`).
- **Auto-review's reviewer sees a filtered history, and the filter is itself a policy surface.**
  The main agent's system message, assistant text and tool results are excluded; the current
  call must belong to the open step recorded by `step/start`, and missing step ownership fails
  closed (`feature/2026-08-28-auto-review.md`).
- **Two independent "the same bug, two surfaces" bugs in this shard are the same class:** the
  plugin-manager Git children broke because the credential scrub removed `GIT_CONFIG_KEY_0` but
  kept `GIT_CONFIG_COUNT` (`testing/2026-09-27-plugin-manager-git-child-environment.md`), and the
  spreadsheet flake was a deferred React updater resolving a cell from stale geometry
  (`testing/2026-09-27-spreadsheet-selection-by-keyboard-before-reflow.md`). Both are "the
  environment/UI changed under an operation that assumed a snapshot".

## 5. Weak spots

- **The corpus is documentation, and its honesty is the point — but it also means the shard
  contains no code, so none of these ideas can be assessed for implementation cost here.** The
  report's `path:line` references are to the notes, not to the implementation; the notes name the
  implementation paths, and those paths are outside this shard.
- **Some notes are candidly "not done".** The session-open coordination note states there is "no
  gate, behavior-test, or assembled Web snapshot verification result" and lists four known
  verification gaps (`bug-fix/2026-09-20-session-open-read-coordination.md`); the desktop webview
  note says "this implementation is not evidence that the complete browser security policy is
  ready for release"; the session-list fairness note concedes a "single row, provider
  enumeration, GC, final sorting and serialization can exceed the target". A reader who takes
  these as settled designs will over-trust them.
- **The notes are internally inconsistent about the archive boundary**, by design: a note may
  say a decision is "superseded" while a sibling note in the same corpus still states the older
  behaviour as current. Several notes (the `2026-09-30-session-list-host-fairness` note and the
  `2026-10-02-plugin-market-discover` note, among others) explicitly say which record owns which
  fact, but a reader who does not follow the cross-links will read a superseded rule as current.
- **The refusal to advertise `allow_always` is principled but creates a real product gap**: an
  interactive user who approves the same action twice is asked twice, and the note offers no
  interim design. The approval seam's "Costs and accepted limits" section admits the answerer
  race ("sibling registration order is not deterministic") and the object-identity ownership
  coupling — both are live sharp edges.
- **The size of the corpus is itself a liability the project knows about**: the frozen-archive
  decision, the `dsh-archive-agent-notes` skill and the "keep an implemented note current with
  what actually shipped" rule all exist to keep a 116-note corpus maintainable, and the
  `2026-07-26-frozen-agent-note-archive` note admits that archival edits are limited to
  relocation and a metadata line — so archived notes still rot in place and can still be linked
  as if current.

---

*Report written for the `deepseek-harness` shard `dsh-notes-impl-rest`. Files read in full:
all 116 English Agent Notes and the 2 index files. Files read in batches for structure and
decision (each confirmed a faithful translation of its English sibling): all 116 `.zh.md`
mirrors. Files skipped: all 116 `.i18n.yaml` files — generated bilingual-pair hash records whose
header and structure were confirmed and which contain no prose.*
