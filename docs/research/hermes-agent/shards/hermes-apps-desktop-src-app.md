# hermes-agent :: hermes-apps-desktop-src-app

**Files in shard:** 1210 (read: 1210, skipped with reason: 0)
**What this shard covers:** the entire `apps/desktop/src/app/**` tree of the Hermes Agent
desktop client — a React + Electron front end for a Python-backed agent runtime. It is the
*surface* of the harness, not its brain: the shell (titlebar, statusbar, sidebar, command
palette), the chat surface and its composer (drafts, queue, attachments, voice, undo history,
@-completion, slash commands, status stack), the session lifecycle and its gateway event
protocol (`use-message-stream/gateway-event/*`), the cron scheduler UI, the capabilities
surface (skills, MCP servers, connectors, plugins, toolsets, a public catalog), the settings
surface, the right sidebar (files, review, terminals), a HUD overlay window, and a "starmap"
session-graph visualiser. 534 of the 1210 files are Vitest suites that pin the UI behaviour.

**Reading method (and its honesty about coverage).** Every file was opened. Files in the
"deep read" list below were read line by line and carry a full Tier-1 entry. For the rest,
the read was a *structured read*: the file's own leading doc-comment block plus its exported
symbol list (source), or its `describe`/`it` titles (tests). That is enough to write an honest
one-line entry, and in this codebase the doc-comments carry the design intent — but it is not
a line-by-line read, and the status ledger says so per file. Nothing was skipped, nothing was
invented, and no repo code was executed.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

#### `apps/desktop/src/app/cron/job-state.ts`
- **Purpose:** the single source of truth for how a scheduled job *looks* — its state pip colour, its human title, and whether its next-run slot is stale.
- **Key abstractions:** `STATE_DOT` (state → tailwind colour class), `jobState(job)`, `truncateText(value, max)`, `jobTitle(job)`, `NEXT_RUN_OVERDUE_GRACE_MS`, `nextRunOverdueMs(job, nowMs)`.
- **Data flow:** a raw `CronJob` from the API → `jobState` derives an effective state (explicit `state` wins; else `enabled === false` → `disabled`; else `scheduled`) → `jobTitle` picks name → prompt[:60] → script[:60] → id.
- **Non-obvious design decisions:**
  - `truncateText` uses `Intl.Segmenter` with `granularity: 'grapheme'` — not `Array.from` (code points) and not `slice` (UTF-16 units). Job names are raw user input and may be CJK / emoji / ZWJ (`job-state.ts:24-30`; the comment names the bug it prevents).
  - `nextRunOverdueMs` mirrors the Python scheduler's `_OVERDUE_GRACE_SECONDS` (15 min). A slot parked in the past is *the only user-visible trace of a dead scheduler* (#114309), so **no surface may present it as an upcoming "Next"**. It returns `null` for paused / completed / disabled / unparseable slots — "not expected to fire" is not "overdue".
- **Edge cases & failure handling:** `Date.parse` failure → `null` (never a `NaN` ms); a whitespace-only explicit `state` falls back to the enabled flag.
- **Surprising:** a 15-minute constant is duplicated in Python (`hermes_cli/cron.py`) and mirrored in TS with an explicit comment — a contract held by two files in two languages.

#### `apps/desktop/src/app/cron/cron-job-model.ts`
- **Purpose:** the pure model behind the cron editor — validation, model/provider encoding, delivery-target toggling, error-text summaries.
- **Key abstractions:** `jobIsScriptOnly`, `jobDescription`, `validateCronEditor`, `cronModelChoiceValue` / `parseCronModelChoiceValue`, `parseCronDeliveryTargets`, `toggleCronDeliveryTarget`, `lastErrorSummary`, `cronEditorUpdates`.
- **Data flow:** editor form state → `validateCronEditor` → `cronEditorUpdates` → API payload.
- **Non-obvious design decisions:**
  - **The provider/model pair is encoded as `JSON.stringify([provider, model])`** rather than `"provider:model"`, because provider slugs and model ids can both contain colons (`cron-job-model.ts:71-88`). A parse failure returns `null`, never a half-split pair.
  - `validateCronEditor` returns a *typed* error enum (`'prompt' | 'prompt_and_schedule' | 'schedule'`), and a script-only job may have an empty prompt — a **script-only cron job runs a shell script on schedule with no LLM prompt at all** (`no_agent` + `script`).
  - `cronEditorUpdates` writes **both** `model` and `provider` for agent jobs even when empty, so that resetting to "default" actually *clears* a previously pinned model (the backend normalises `null`/`''` to "no override"). For script-only jobs it deliberately leaves the stored model untouched, because the scheduler ignores it.
  - `lastErrorSummary` peels nested wrappers in a **loop until stable** (`[marker]` → emoji → `RuntimeError:`), because a scheduler error can be `"[cron] ⚠️ RuntimeError: ..."`. It then keeps the first *sentence* and caps at 200 graphemes; the full text stays reachable via a hover title.
- **Edge cases & failure handling:** `parseCronDeliveryTargets('')` → `['local']` (never empty — a cron with no target would deliver nowhere); `toggleCronDeliveryTarget` refuses to remove the **last** target.
- **Surprising:** `lastErrorSummary` compares `sentence.length` (UTF-16 units) but truncates via `truncateText(sentence, MAX - 1)` (graphemes) — mixing two length units on purpose, with a comment saying `slice()`'s UTF-16 limit could split an astral pair.

#### `apps/desktop/src/app/cron/cron-actions.ts`
- **Purpose:** the only place cron mutations + list refreshes happen, with **staleness fencing** so a profile switch cannot publish the old profile's job list.
- **Key abstractions:** `refreshCronJobs`, `mutateAndRefreshCronJobs`, `triggerAndRefreshCronJobs`, `CronTriggerRefreshResult` (`{ jobs, refreshError, stale }`).
- **Data flow:** caller → `beginCronJobsAction(scope)` token → mutate → `refreshCronJobs` → `commitCronJobsRequest(request, jobs)` → the shared `$cronJobs` atom.
- **Non-obvious design decisions:**
  - **The scope is `connection + '\0' + profile`** — a NUL separator so a connection named `"a\0b"` cannot collide. Scope changes invalidate in-flight requests.
  - **A refresh failure is reported separately from a mutation failure.** `triggerAndRefreshCronJobs` documents: "the trigger already succeeded and must not be shown as failed". The trigger response alone is *not* an authoritative list update, because a completed one-shot may have been deleted by the scheduler.
  - When a newer same-profile refresh supersedes the mutation's snapshot, the **mutation value is still preserved** (`stale: false, value`) so the caller can still settle its dialog/toast.
- **Edge cases & failure handling:** a mutation error is *swallowed* (returned as `stale: true`) when the scope changed — the error belongs to a profile the user has left.
- **Surprising:** the same "generation token" idea recurs in `use-message-stream`, the transcript backfill, `use-background-sync` and `single-flight-resume`. It is the house pattern for "an async result must not paint a state the user has moved on from".

#### `apps/desktop/src/app/cron/open-cron-run.ts`
- **Purpose:** decides whether a *cron run* session may be typed into — the human-in-the-loop gate between "autonomous scheduled work" and "interactive chat".
- **Key abstractions:** `isResumableCronRun`, `isCronRunRow`, `isCronRunSession`, `cronRunWriteGateApplies`, `openCronRun`, `reconcileCronRunVerdicts`, `refreshCronRunWriteGate`.
- **Data flow:** a `SessionInfo` row → `isResumableCronRun` → a **verdict recorded in the read-only-transcript store** → consulted by the send path before every message.
- **Non-obvious design decisions (the single most transferable idea in this shard):**
  - `isResumableCronRun` distinguishes **LIVE** from **ZOMBIE** using `scheduler_owned`, *not* `is_active`. `is_active` is a 300-second activity window; a live run sitting inside a long `terminal` / `execute_code` / `delegate_task` call writes no heartbeat and reads inactive exactly like a zombie. The comment names the trap.
  - A run with `ended_at == NULL` that the scheduler does not own **never got its `end_session`** — a zombie — and is **view-only**. A properly closed run (`ended_at` stamped) is writable again.
  - The verdict is **re-evaluated on every refresh and every send, never latched**; a zombie that later ticks becomes writable again and vice versa.
  - `refreshCronRunWriteGate` **fails closed**: an unreadable row keeps a known verdict, and an *unknown* run is refused — "a send into a possibly-dead cron session is exactly the misroute to prevent".
  - Legacy backends without `scheduler_owned` fall back to the 300 s activity window, and because the verdict is re-evaluated "it never latches" as a permanent block.
- **Edge cases & failure handling:** legacy cron run ids are matched by `^cron_.+_\d{8}_\d{6}$` for tabs restored before any list loaded its row.
- **Surprising:** `openCronRun` records the verdict **before** the route flips, so the very first send already sees it — an ordering detail that is easy to get wrong.

#### `apps/desktop/src/app/cron/blueprints.tsx`
- **Purpose:** rendering a **backend-defined automation blueprint** (a recipe with typed slots) in the cron create dialog.
- **Key abstractions:** `initialBlueprintValues`, `cleanBlueprintFieldError`, `blueprintSlotHelp`, `BlueprintSlotControl`.
- **Data flow:** `AutomationBlueprint` → seeded form values → typed slot controls → `instantiateAutomationBlueprint({blueprint, values})`.
- **Non-obvious design decisions:**
  - The blueprint catalog is **shared with the dashboard**, so its `deliver` slot defaults to `"origin"` — meaningless on desktop. The desktop rewrites `"origin"` (or empty) to `"local"` ("This desktop") rather than showing a slot that would deliver nowhere.
  - Backend slot errors arrive as `"422: <message>"`; `cleanBlueprintFieldError` strips the code for inline display.
  - `blueprintSlotHelp` **suppresses the help text for the `deliver` slot** because the backend's help is dashboard-centric and even contradicts desktop semantics ("local = save only").
- **Edge cases & failure handling:** `initialBlueprintValues` returns `{}` for a blueprint with no fields; an unknown field type falls back to a text input.
- **Surprising:** blueprints are a *plugin* extension point — a plugin registers an automation blueprint and the desktop lists and instantiates it with **no desktop code change** (`plugin-blueprints.test.tsx`).

#### `apps/desktop/src/app/cron/index.tsx` (55 KB — the Cron page)
- **Purpose:** the master/detail Cron overlay: list, search, create/edit/delete, pause/resume, trigger-now, run history, blueprint-driven creation.
- **Key abstractions:** `CronView`, `CronJobListRow`, `CronJobDetail`, `CronJobRuns`, `DeliverCheckboxes`, `CronEditorDialog`, `scheduleOptionForExpr`, `scheduleSummary`.
- **Data flow:** `$cronJobs` atom (shared with the sidebar) ← `refreshCronJobs(profile)`; mutations via `mutateAndRefreshCronJobs`; run history polls `getCronJobRuns(jobId)`.
- **Non-obvious design decisions:**
  - **Optimistic "queued run" feedback.** Clicking "trigger now" paints a queued row *immediately*, because the backend can take tens of seconds to materialise the session. The row settles when the run history observes a run started after the click (with a 2 s `PENDING_RUN_START_SLACK_MS`) or when a **bounded 90 s timeout** fires (`PENDING_RUN_TIMEOUT_MS`). A ref is written *before* the state set so the busy render and the controller guard share one instant — no untracked window.
  - **Poll cadence adapts to backend capability:** fast while a run is queued, `8 s` normally, `60 s` backstop when change events are available. `$cronChangeTick` triggers an immediate reload when the scheduler fires.
  - **The detail pane is never empty while jobs exist:** the selected job falls back to `visibleJobs[0]`.
  - **A model pin that has left the catalog is still shown.** If a pinned provider/model was removed, the option is re-rendered (monospace) so the stored pin stays visible and re-selectable instead of silently disappearing and rendering Radix's blank trigger.
  - The model/provider pair is a **single opaque Select value** (`JSON.stringify([provider, model])`) with a `__default__` sentinel, because Radix `<SelectItem>` rejects empty-string values.
  - `DeliverCheckboxes` **preserves selected targets missing from discovery**, so editing a job never drops a saved route.
  - The empty state distinguishes "no jobs at all" from "search matched nothing" — the comment says a "try a broader search query" hint confused people staring at a panel with zero jobs.
- **Edge cases & failure handling:** delete uses `ConfirmDialog`, which reports failures inline and stays open; every mutation separates `stale` (scope changed → silently drop) from `refreshError` (toast); the profile scope derives from `$profileScope`, and `'all'` collapses to `'all'` for reads but to `'default'` for writes ("'all' is not a writable target").
- **Surprising:** `handleTrigger` re-checks `cronProfileForScope($profileScope.get()) !== viewProfile` at settle time — the profile may have changed *while the trigger was in flight*.

#### `apps/desktop/src/app/chat/sidebar/cron-jobs-section.tsx`
- **Purpose:** the inline "Cron" block in the chat sidebar: a compact job list with a quick-peek of the last five runs.
- **Key abstractions:** `SidebarCronJobsSection`, `CronJobSidebarRow`, `CronJobSidebarRuns`.
- **Data flow:** `$cronJobs` → sorted by next run → rows; expanding a row polls `getCronJobRuns(jobId, PEEK_RUN_LIMIT)`; clicking a run calls `openCronRun(run, onOpenRun)`.
- **Non-obvious design decisions:**
  - **One clock for the whole section** (a 1 s `setInterval` updating a single `nowMs` state) so the countdown ticks without re-rendering the whole sidebar. It runs only while the section is expanded **and the pane is visible** (`usePaneVisible`).
  - The hidden pane **skips the peek entirely** — no initial load, no interval — and becoming visible re-runs the effect.
  - Jobs with **no next run sink to the bottom**, then alphabetical for stability.
  - Pause/resume and delete are **not threaded through the sidebar's prop chain**; they drive the shared `$cronJobs` atom directly, the same path the Cron overlay uses, so both surfaces update in place. The comment is explicit that this is deliberate.
  - Rows reuse the shared sidebar row chrome — "a cron job and a session sit in the same list, so they line up only if one place owns the geometry".
  - The countdown cell swaps to a hover action cluster (trigger / manage), and the overdue state renders as "overdue since <time>" rather than a stale "Next".
- **Edge cases & failure handling:** the run list degrades to `[]` on error rather than throwing; `visibleCount` grows in steps of 10 behind a "load more" row; `max` caps the section.
- **Surprising:** `INACTIVE_STATES` (completed/disabled/error/paused) replace the countdown with the state word — a disabled job must not advertise a next run.

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/types.ts`
- **Purpose:** the contract every gateway-event handler is written against — one `GatewayEventDeps` bundle and one `GatewayEventContext` preamble.
- **Key abstractions:** `GatewayEventDeps` (23 injectable callbacks/refs), `GatewayEventContext` (`deps`, `event`, `payload`, `sessionId`, `explicitSid`, `isActiveEvent`, `occurredAt`, `fromActiveSource()`, `scheduleConfigRefresh()`), `GatewayEventHandler = (ctx) => boolean`.
- **Non-obvious design decisions:** the routing preamble (which session an event belongs to, whether it is the visible one, whether it came from the active source) is computed **once per event** in `index.ts` and handed to every handler. Handlers therefore never re-derive routing, and cannot disagree about it. `fromActiveSource()` is a **function, not a boolean**, because the active connection/profile can change between the event's arrival and the handler's read.
- **Surprising:** the deps list is deliberately flat — no "context object" nesting — so each handler's needs are visible in one place and a new event family can be added without touching the others.

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/index.ts`
- **Purpose:** the gateway-event dispatcher — the desktop's equivalent of an event bus.
- **Key abstractions:** `useGatewayEventHandler(deps)`, `HANDLERS` (an ordered array of 12 family handlers), `admitExecutionEvent`, `DRAFT_SUPERSEDING_EVENT_TYPES`, `COMPACTION_RESUME_EVENT_TYPES`, `PROVIDER_WAIT_SUPERSEDING_EVENT_TYPES`.
- **Data flow:** a `GatewayEvent` → route to a session → execution-authority fence → late-straggler fence → build `ctx` → run handlers in order until one returns `true` → `finally` note the event as proof of life.
- **Non-obvious design decisions:**
  - **Ordered family handlers, each returning "did I consume it".** Dispatch stops at the first taker. A handler that does not recognise its event returns `false` and the next one tries.
  - **`fromActiveSource()` compares the composite `(connectionId, profile)` scope**, not the profile alone: "every registered connection exposes a 'default' profile, so a bare profile comparison attributes gateway B's 'default' events to gateway A's 'default'". This one line is why the app never paints another backend's events.
  - **Late stragglers are dropped**: an unscoped stream event attributed via the active-session fallback to a session with no live turn is discarded, so a delayed `thinking.delta` cannot land in a freshly opened chat.
  - **Any attributed event — including a heartbeat that changes nothing — proves the session is still producing.** Silence after the last one force-settles a dead turn.
  - **Coalesced config refresh**: `session.info` arrives in bursts; each burst used to fire its own `refreshHermesConfig` (two REST calls per event, per turn, including for background sessions). A 300 ms trailing timer turns the burst into one fetch, and background traffic schedules nothing.
  - **Unscoped streams are pinned per stream, not in one shared slot** — two chats streaming at once used to clobber each other's pin (#46194 / #62823).
- **Edge cases & failure handling:** the `finally` block runs even when a handler throws, so the session's liveness is always recorded; `retireTurnToolProgress` runs there because `message.complete` is consumed by an earlier handler.
- **Surprising:** the three "superseding event type" sets encode *negative* rules — a status claim ("drafting a tool", "waiting on the provider", "compacting") ends when **any other output from the session** proves it moved on, mirroring the TUI's transient-trail pruning.

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/lifecycle.ts`
- **Purpose:** gateway ready / setup ready / skin changed / change-watcher broadcasts / approval cancelled / session reclaimed / replay gap.
- **Key abstractions:** `handleLifecycleEvent(ctx)`, `handleReplayGapEvent(ctx)`, `onGatewayReady`.
- **Data flow:** event → live-sync tick or a targeted teardown (clear prompts, unbind tiles, invalidate caches) → `notifySessionsChanged()`.
- **Non-obvious design decisions:**
  - **`gateway.ready` seeds the theme registry WITHOUT applying it**, so a fresh connect never overrides the user's persisted desktop theme.
  - **`approval.cancelled`** clears parked approval cards by *request id*, not wholesale: "A request-id mismatch is a no-op in clear(), so a cancelled id can never wipe a newer prompt re-armed by a live turn on the same session." Without correlation ids it drops the session's prompts wholesale.
  - **`session.reclaimed` is a full teardown**, and the comment explains each step: mark the runtime gone, invalidate the context breakdown (the pre-compression figure is wrong by 5-10×), drop the cached state, **clear every prompt keyed to that runtime** (the runtime id rotates on every resume, so the new turn's cleanup can never remove a stale approval — #86577), and **unbind the tile** so its resume effect refires instead of rendering an empty transcript forever (#82620).
  - `session.replay_gap` asks for an **authoritative re-snapshot** of exactly the affected pane or tile, keeping owner scope and draft.
- **Edge cases & failure handling:** only the active source's change broadcasts apply; background profile sockets watch their own homes.
- **Surprising:** the module imports the theme provider by **leaf path** (`@/themes/backend-sync`, not the `@/themes` barrel) "to avoid pulling the ThemeProvider module graph into the gateway event hot path".

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/status.ts`
- **Purpose:** `status.update`, `btw.complete`, `review.summary`, `background.complete`, `notification.show` / `clear`, and `error`.
- **Key abstractions:** `handleStatusEvent(ctx)`, `isFallbackSwitchStatus(kind, text)`.
- **Data flow:** event → a persistent **system message** in the transcript (not a toast) → the session state store.
- **Non-obvious design decisions:**
  - **A status that a human must see is a transcript row, not a toast.** The self-improvement review summary says so explicitly: "it must not be a transient toast that can be missed", and it is typed with a `review:` marker so the renderer can paint it as the memory-write row instead of sniffing the backend's prose.
  - **Auto-compaction and manual `/compress` share one phase**, because the TUI has matched the pair since `createGatewayEventHandler.ts:904`; without `compressing` the desktop showed no progress for `/compress`.
  - **A deferred compress that finished with no live turn is announced explicitly** — otherwise "a deferred /compress finishes in silence" and the transcript changes under the user with no acknowledgement. The notice is appended *after* the hydrate resolves, because the hydrate replaces the transcript wholesale.
  - **A fallback model switch is durable and must be shown**: "Desktop used to swallow every non-compaction status.update, so the reply came from a different model with no indication."
  - **Errors are classified into an `ErrorSurface` with `retryable`.** `SESSION_NOT_OWNED` is deterministic ("only a new chat helps") and therefore **drops the Retry button**; `disk_full` is a machine problem; a provider-setup code routes to onboarding. The toast id is stable (`gateway-error:<message>`) so the same error from several blocked threads collapses into one.
  - A turn that errors out **also ends the turn**: the handler clears open prompts, the clarify card, the todo list and the compaction phase, so no approval overlay can outlive the failed turn.
- **Edge cases & failure handling:** the raw gateway text is kept as the toast's *detail* when a glossed card sentence is shown — "burying it under a generic 'couldn't finish' gloss would hide the one instruction the user needs."
- **Surprising:** `review.summary` strips leading non-alphanumerics (`^[^\p{L}\p{N}]+`) with the `/u` flag, so the backend's "💾 " prefix does not fight the renderer's own glyph.

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/tools.ts`
- **Purpose:** `todo.updated`, `tool.generating`, `tool.start`, `tool.complete`, `tool.progress` and the `subagent.*` family.
- **Key abstractions:** `handleToolEvent(ctx)`, `handleToolProgressEvent(ctx)`, `retireTurnToolProgress(eventType, sessionId)`, `recordToolPreview`, `noteToolOutcome`, `appliedLayout`.
- **Data flow:** tool event → `upsertToolCall(sessionId, payload, 'running' | 'complete')` → a tool row in the transcript, plus side effects (preview artifact re-offer, slash-command cache invalidation, workspace-change nudge).
- **Non-obvious design decisions:**
  - **`tool.generating` is a status, not a row.** It arrives while the model is still emitting the call's JSON — name only, no id, no args. Materialising a row from it "strands an argless placeholder whenever the bubble is sealed before the real `tool.start` arrives". It is therefore shown as a *drafting* status line, and the drafting claim ends when any other output from the session proves the model moved on.
  - **A duplicate or replayed completion may never re-offer a dismissed preview.** `pendingProduction` is computed *before* the upsert seals the part, from the tool-call owner's message id.
  - **A file-mutating tool nudge is event-driven, not polled**: `toolMayMutateFiles(payload)` fires the git-mirroring surfaces exactly when the agent touches the tree.
  - **A skill-creating tool invalidates the composer's cached `/` list**, so a new skill is offerable now rather than after the hour-long TTL.
  - **`tool.progress` is a row annotation, never a transcript mutation**, and is retired on `tool.complete` — and also by the dispatcher's `finally`, because a turn can end with the completion missing.
  - **A Stop interrupts the parent TURN, not the children.** Terminal subagent completions are accepted past the interrupt (a delegation can still be finishing), while live progress keeps the guard. Dropping them "leaves a permanently 'running' spinner" (#75505).
- **Edge cases & failure handling:** a tool can fail *without* ending the turn (the agent recovers and continues), so the failure is surfaced as a short activity beat rather than a turn-level error.
- **Surprising:** the module routes terminal/process tool completions to `refreshBackgroundProcesses` "even on an interrupted turn (idempotent re-sync)".

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/input-requests.ts`
- **Purpose:** the blocking-input family — connection consent, `approval.settled` / `clarify.settled`, and `request.cancel`.
- **Key abstractions:** `handleInputRequestEvent(ctx)`, `handlePromptSettledEvent(ctx)`, `cancelParkedCredentialRequest`, `clearParkedCard`.
- **Data flow:** a server request or event → a parked card in the matching store (`$clarifyRequests`, `$sudoRequests`, `$secretRequests`, `$vault*Requests`, `$connectionRequests`) → `needsInput: true` on the session state.
- **Non-obvious design decisions:**
  - **A shared prompt settles once, for every attached viewer.** `approval.settled` / `clarify.settled` carries the prompt id; only the parked card under that id comes down — "the answer itself reaches the transcript through the tool's own completion, so no 'skipped' projection".
  - **A cancel is request-correlated.** "A delayed cancel for an older prompt must not erase a newer one the same session raised."
  - **A timeout is explained in human terms with a route to the setting that controls the wait** — the Run/Reject bar vanishing is the only thing the user would otherwise see; the tool row then shows a model-facing "BLOCKED" result.
  - **The Bot Screen install password card belongs to the app, not to the chat that happened to be open** — so a chat switch does not orphan it.
  - An interrupted session's connection consent is **dropped, not parked**: the backend withdraws its request on the same boundary.
- **Edge cases & failure handling:** `preview.act` has no card — a timeout or interrupt still has to stop keystrokes already queued for it (`abortPreviewTyping`).
- **Surprising:** `request.cancel` falls through a *chain* of stores (sudo → secret → vault code → vault save-login → vault unlock → theme pick → setup beat), first match wins. That chain is the cost of a generic card system; see Weak spots.

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/server-requests.ts` (30 KB — read head + tail)
- **Purpose:** the server→client **request** rail: the agent asks the desktop something and blocks until a window answers.
- **Key abstractions:** `SERVER_REQUEST_HANDLERS` (16 methods), `handleServerRequest(request, deps, activeSessionId)`, `requestNamesActiveSession`, `windowHostsSession`, `windowReadClaimsSession`, `previewSessionRoute`, `WINDOW_OWNED_REQUESTS`.
- **Data flow:** a JSON-RPC request → `previewSessionRoute` decides *ignore* / *retry* / *run* → the handler answers with `request.respond(...)` or `request.decline(...)`.
- **Non-obvious design decisions:**
  - **Every attached window sees the request, but only the window that hosts the session may answer it.** The backend keeps the request open for the owner and settles only once every attached window *declined*, so a window not showing the chat declines instead of staying silent ("the agent is told now rather than after its whole deadline", #119333).
  - **`preview.act` / `preview.read` / `terminal.read` / `theme.apply` / `window.read` / `tour` are "window-owned"** — requests answered from *this window's* panes. A window that does not host the session has no pane for it, and its empty answer would win the race (#113348).
  - **`window.read` uses a tolerant claim** because the HUD shows the conversation without holding it active, and after a HUD hand-back the app window's active id may still name the pre-handoff runtime until a resume re-binds it.
  - **Session identity is compared through the stored id and then the lineage**, because the gateway stamps requests with the *runtime* id — which auto-compression rotates mid-conversation — while the pane holds the durable id.
  - The preview engine (~25 KB of page-injectable source) is **lazily imported** so it stays off the boot path, and in dev it is re-imported with a cache-busting query so edits reach the guest.
- **Edge cases & failure handling:** `decline` is a no-op against a backend that would take the first error as the answer — so the code paths that need it check first.
- **Surprising:** a `retry` route re-reads `activeSessionIdRef.current` inside a `setTimeout(…, 0)` rather than capturing it, because "session resume publishes its binding synchronously between this replay and the next turn".

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/deferred-pick.ts`
- **Purpose:** a model pick made *during* a turn ("applies from your next message") that resolves at the next turn boundary.
- **Key abstractions:** `handleDeferredPickEvent(ctx)`, `repaintCommitted`.
- **Data flow:** `session.updated` with `operation === 'model'` → `refused` (paint the committed model back + toast) or `confirmation_required` (open the shared guarded-switch dialog).
- **Non-obvious design decisions:**
  - **A refused pick repaints the committed model over the refused one** — but only for the active profile's own session, and only while the composer still shows that pick (a newer pick or a navigation wins).
  - **The guarded confirmation is the same dialog as an idle pick**, and it carries an `isStale()` predicate: "A newer pick replaced this one while the dialog was open: confirming it would undo that pick."
  - The confirmed resend sends **the whole selection the owner asked about (its reasoning level included)**, with the owner's token.
- **Edge cases & failure handling:** another profile's session can share an id (imports), so the outcome of a foreign session is not this composer's — the handler compares the source scope.

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/desktop-bridge.ts`
- **Purpose:** the agent's read/write bridge to desktop surfaces — terminal output, terminal close, tips, pane reveal, message reactions.
- **Key abstractions:** `DESKTOP_BRIDGE_HANDLERS` (5 entries), `handleDesktopBridgeEvent(ctx)`.
- **Data flow:** gateway event → a desktop-side store or DOM action.
- **Non-obvious design decisions:**
  - **`tip.show` is fire-and-forget**: "a tip is not a question, and blocking the turn on one would stall the sentence the agent is in the middle of." A tip with nothing to point at is dropped — it is "just a notification, and the app already has those".
  - **Active session only** for `tip.show` and `pane.reveal`: "a background turn must never paint on the user's screen (desktop AGENTS.md: offer, don't hijack)."
  - **`message.reaction` needs BOTH `isActiveEvent` and `fromActiveSource()`**: `isActiveEvent` proves the *runtime* id matches, not the *source* — "two connections can report the same session id, and a reaction from source B would mutate the transcript source A is showing."
  - The reaction handler handles **both the durable leg** (the message already has a `rowId`) and the **live leg** (an optimistic bubble with no row id yet, where it also stamps the now-known row id onto it).
- **Edge cases & failure handling:** a fresh `ChatMessage` object per change, because "the runtime repository caches normalized ThreadMessages in a WeakMap keyed by ChatMessage identity".

#### `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/free-tier.ts`, `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/onboarding.ts`, `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/session-control.ts`
Three one-purpose handlers, each with the same shape: recognise exactly one event type, act, return `true`. `free-tier.ts` runs a browser challenge for the *install's* identity ("Any source's challenge is worth running: it is the install's identity, not the focused session's"). `onboarding.ts` records that a first-run ended — every source's event counts. `session-control.ts` applies a session-control update and **claims malformed control events without replacing the last good state**.

#### `apps/desktop/src/app/session/hooks/use-prompt-actions/prepared-submissions.ts`
- **Purpose:** the **journal of uncertain sends** — the exactly-once machinery for "the user pressed Send and we do not know whether it landed".
- **Key abstractions:** `PreparedSubmission`, `preparedSubmissionKey`, `listPreparedImageDrafts`, `readPreparedSubmission`, `adoptPreparedSubmission`, `preparedSubmissionSlot`, `writePreparedSubmission`, `removePreparedSubmission`, `SPENT_PREFIX` / `LEGACY_SPENT_KEY`.
- **Data flow:** a send → `preparedSubmissionSlot(intent)` mints a journal key → `writePreparedSubmission(key, entry)` persists the intent → on acknowledgement `removePreparedSubmission(key, id)` retires it → on a crash the journal is replayed on the next boot.
- **Non-obvious design decisions:**
  - **"A journal, not an automatic outbox. Only an explicit retry may reuse an uncertain admission."** The journal records what *might* have been sent; it never re-sends.
  - **A tombstone is written BEFORE the journal removal.** The identity is *spent* durably in a separate store, so a failed removal can only leave a stale entry that every later read hides — never a reusable one. The tombstone store is keyed **one localStorage key per tombstone**, because a single blob let one window's read-modify-write drop another window's tombstone, and a reload then re-adopted that admitted input.
  - **The journal key is the full intent tuple**: `[scopeKey, target, text, attachment occurrence ids, displayKind, fromQueue, submissionId]` — and for a slash expansion the submission id is nulled, because "Slash expands once, then retries the prepared wire payload, not a new generated ID/expansion."
  - **Web Locks mark ownership**: an entry whose window is alive may only be retried by that window; a closed window's lock is freed, so its entry becomes adoptable after a reload.
  - **Native writes never fall back to browser storage** — "sending requires their ACK".
- **Edge cases & failure handling:** a tombstone write that itself fails (quota) leaves the in-memory mark and the removal still runs.
- **Surprising:** the file is named "prepared submissions" but implements a **distributed exactly-once send protocol** across windows, with per-key tombstones and Web-Lock ownership.

#### `apps/desktop/src/app/session/hooks/use-prompt-actions/resolve-target-session.ts`
- **Purpose:** resolve *which runtime session* a submit or slash command must target.
- **Key abstractions:** `resolveTargetSessionId(deps)`.
- **Data flow:** explicit runtime id → live runtime ref → routed/selected stored session (resumed on its **owning** profile) → only then a new session.
- **Non-obvious design decisions:**
  - **The ladder is highest-trust-rung-first, and a durable route outranks the live ref.** "When the URL names a conversation whose runtime binding the cache does not confirm, the ref is stale or cross-wired (often from the previous profile) and must not capture the command."
  - **A durable conversation whose runtime cannot be rebound returns `null`, never a new session.** "A targeted durable conversation whose runtime cannot be rebound must NOT fall through to `createSession()` — that is precisely the fork this resolver exists to prevent (#55578 class)." "A command that runs against the wrong session is worse than one that reports it could not run."
  - **The resume carries `omit_messages: true`**, because a deep compression lineage exceeds `max_resume_messages` and fails `assert_resume_safe`.
- **Edge cases & failure handling:** the resume is single-flighted (`singleFlightSessionResume`), and a runtime an aborted recovery already minted is reused rather than re-minted.
- **Surprising:** the doc comment names the exact bug this exists for: "`/goal <text>` then set a goal on the chat, and a following `/goal status` reported 'No active goal' because it was asking a session that had just been created."

#### `apps/desktop/src/app/session/hooks/use-prompt-actions/single-flight-resume.ts`
- **Purpose:** the single-flight guard for `session.resume`, plus the adopt-or-reuse cache for recovered runtimes.
- **Key abstractions:** `singleFlightSessionResume(storedId, run, opts)`, `registerRecoveredRuntime`, `takeRecoveredRuntime`, `clearSingleFlightSessionResumeState`.
- **Data flow:** N independent surfaces discover the same dead runtime → one `session.resume` → the others join the same promise.
- **Non-obvious design decisions:**
  - **The key is the CONNECTION, not the profile**: "a stored id is unique within one backend's state.db but two registry backends can hold the same id, so their flights must stay apart."
  - **Module-level, not per-hook**, so every call site in the window shares one in-flight promise no matter which hook instance it lives in. Without it, "the gateway happily mints a runtime per call and the losers become orphans for the reaper (#91276 storm)".
  - **A message-bearing caller cannot join an omitted-message flight**; it queues a follow-up behind it, which "preserves same-session ordering while still letting all later callers join the stronger queued snapshot".
  - `Promise.resolve().then(run)` tolerates a synchronous `run` that returns a bare value or throws synchronously — "a raw `run().finally()` would crash on a non-promise return."
  - **Take semantics on the recovered-runtime cache**: "the entry is removed so a dead cached id can only cost one bounded retry, never a loop."
- **Edge cases & failure handling:** `takeRecoveredRuntime(storedId, deadRuntimeId)` skips and drops the entry when the caller already knows that exact runtime is dead.

#### `apps/desktop/src/app/session/hooks/use-prompt-actions/submission-destination.ts`
- **Purpose:** capture **where** a send is going, before any preprocessing, so it cannot be re-routed mid-flight.
- **Key abstractions:** `SubmissionDestination` (`scopeKey`, `owner`, `requestGateway`), `captureSubmissionDestination`, `destinationAfterCreate`, `sameAuthorityPublishedOwner`.
- **Data flow:** composer → capture destination (owner + a guarded request) → preprocess → send on the captured owner.
- **Non-obvious design decisions:**
  - **The guard watches only transport/auth authority** (base URL, ws URL, token, connection id, mode, profile, auth mode). "Window visibility, logs and registry discovery replace this descriptor. Only transport/auth authority may invalidate an in-flight write."
  - **A changed authority rejects the write** with "Submission destination changed; retry from the original session" — rather than silently sending to the new socket.
  - **The owner is frozen** (`Object.freeze`) so a later mutation cannot redirect the write.
  - `destinationAfterCreate` handles the fresh-draft case: the create published the chat's exact owner, and a profile activation settling during that create moves the *ambient* authority, not this session.
- **Surprising:** the destination is memoised in a `WeakMap` keyed by the request function, so the same request object always resolves to the same destination.

#### `apps/desktop/src/app/session/hooks/use-prompt-actions/steering-session.ts`
- **Purpose:** pin a mid-turn correction to *its source*, not to the selection at retry time.
- **Key abstractions:** `captureSteeringSession(deps)`.
- **Data flow:** active runtime + selected stored id + routed stored id + runtime bindings → a `{sessionId, storedSessionId, requestGateway, resolveProfile, onRecovered}` bundle, or `null`.
- **Non-obvious design decisions:**
  - **Any disagreement refuses.** "Unlike an ordinary Send, a mid-turn correction must never resolve another target and interrupt it, so any disagreement refuses and the composer queues the text." Three disagreements are enumerated: route left selection, runtime unbound, runtime bound elsewhere.
  - **A compression rotation is a legitimate exception.** `$activeSessionStoredIdRotation` records the exact runtime and old/new stored ids, so it is "enough proof for that brief gap".
  - **A rebuilt runtime binds the tip while selection/route keep the root**, so the *proven* stored id is used for writes — reapplying the root would rotate it back.
  - `onRecovered` binds the runtime **before** the retry for both the visible redirect and the hidden steer, because "hidden steer has no optimistic row to establish it incidentally."
- **Edge cases & failure handling:** the recovered runtime id is adopted only if the active session, the selection and the route are all still what they were.

#### `apps/desktop/src/app/session/hooks/use-prompt-actions/queue-if-busy.ts`
- **Purpose:** park a backend-produced kickoff on the composer queue instead of dropping it.
- **Key abstractions:** `queueKickoffIfSessionBusy(input) → 'idle' | 'queued' | 'busy'`.
- **Data flow:** a slash kickoff (e.g. `/goal` already executed by the backend) → is the target busy? → enqueue with the queue key resolved from the *stored* id.
- **Non-obvious design decisions:**
  - **The backend has ALREADY executed the command**; `text` is only the prompt that tells the agent about it. "Losing it leaves the goal silently unheard (#63352)."
  - **The queue key is the stored session id**, resolved through `resolveComposerSessionKey`, so a queued prompt belongs to the conversation, not to the runtime that happened to be active.
  - `serverOwnsComposerQueue(sessionId)` short-circuits to `'idle'` — when the server owns the queue, the local queue must not also admit.

#### `apps/desktop/src/app/chat/transcript-window.ts`
- **Purpose:** bound what reaches the assistant-ui runtime at all.
- **Key abstractions:** `TRANSCRIPT_WINDOW_BUDGET` (1200 render-weight units), `TRANSCRIPT_WINDOW_MIN_MESSAGES` (30), `alignToBranchGroup`, `selectTranscriptWindow`, `TRANSCRIPT_WINDOW_SLACK`, `advanceTranscriptWindow`, `MAX_SESSION_WINDOWS`, `advanceSessionTranscriptWindow`, `SessionWindowMemo`.
- **Data flow:** the session's message array → a weight walk from the newest → a cut aligned to a branch-group boundary → the window handed to the runtime.
- **Non-obvious design decisions:**
  - **The budget is RENDER WEIGHT, not message count.** "A count cap gets this wrong in both directions — measured on a real 1,175-session store, a 400-message cap would disable itself on 37 sessions that are heavy but short (one was 133 messages / 1.05MB) while engaging on 92 long-but-light sessions that were never at risk."
  - **The cut never lands inside an assistant branch group.** `useRuntimeMessageRepository` records a group's fork point the first time it sees the group; a cut through the middle "silently re-parents" a branch.
  - **The cut is STICKY and anchored to a message id.** A fresh weight-walk per store flush moved the cut one message at a time (~30×/s), so every slide re-indexed the whole windowed transcript — "That — not the transcript's size — was the long-session collapse."
  - **Half a page of slack** (`TRANSCRIPT_WINDOW_SLACK`) means streaming causes one re-cut per ~half page of new content, not one per flush.
  - **A per-session memo holds the source array weakly** (`WeakRef`), so a warm re-entry reuses the *same slice by reference* (O(1) switch) while cold-session cleanup can still release the full transcript. **An unwindowed result is not memoized** — it would make the memo a second strong owner of the complete transcript.
  - The memo map is bounded to 12 sessions, oldest evicted.
- **Edge cases & failure handling:** the anchor vanishing (session swap, compression rewrite) or a pages change falls through to a fresh walk.
- **Surprising:** the module's own comment says the DOM budget in `thread/list.tsx` already bounds what *paints*, but every message is normalised into the repository first — "so a session only has to be heavy, not visible, to crash the window."

#### `apps/desktop/src/app/chat/transcript-retention.ts`
- **Purpose:** release paged-through history from the session store (the store keeps everything the window does not).
- **Key abstractions:** `TRANSCRIPT_RETAIN_BUDGET`, `TranscriptRetention`, `boundRetainedTranscript(messages, windowAnchorId)`, `serverRowCount`.
- **Data flow:** the live window's anchor id → a boundary walked back by one weight page → the retained slice; the caller rewinds the `transcript-tail` offset by the released **backend** rows.
- **Non-obvious design decisions:**
  - **Three invariants, all stated in the file header:** never cut inside the window; never split a branch group; **never drop a row without a durable `rowId`** — "an unpersisted row cannot be fetched back, so releasing it would lose content for good."
  - **A `pending` row blocks the release entirely** (it has no backend row yet).
  - **The released count is reported in two currencies**: `releasedRows` (messages) and `releasedServerRows` (backend rows), because the hydration fold merges a turn's tool rows into one message and the older-page offset is counted in backend rows.
  - **When there is nothing to release, the function reports `released: false` and does no work at all** (no weight walk, no row count) — "so a re-cut of an untouched transcript stays cheap."
- **Edge cases & failure handling:** re-hydration is the existing older-page backfill; the caller rewinds `transcript-tail` so `expandWindow` fetches the released rows again instead of treating the transcript as fully materialised.

#### `apps/desktop/src/app/chat/composer/status-stack/session-control-loop.tsx`, `apps/desktop/src/app/chat/composer/status-stack/session-control-heartbeat.tsx`, `apps/desktop/src/app/chat/composer/status-stack/session-control-utils.ts`
- **Purpose:** the two long-lived session controls — a **heartbeat** (a prompt fired on an interval) and a **loop** (a recurring self-paced or fixed-interval turn) — and the countdown clock that displays them.
- **Key abstractions:** `SessionControlLoopSection`, `SessionControlHeartbeatSection`, `useCountdownClock(active)`, `formatCountdown`, `formatInterval`, `formatHeartbeatInterval`, `useSessionValue`.
- **Data flow:** a `session.control.update` event → `$sessionControlBySession` → the status stack → a local 1 s clock for the countdown → `runSessionControlAction(sessionId, action)` for pause/resume/stop/clear.
- **Non-obvious design decisions:**
  - **The heartbeat/loop is a *server-side* object; the client only renders and commands it.** Actions are namespaced strings (`heartbeat.pause`, `loop.stop`, `heartbeat.clear`) sent through one `runSessionControlAction`.
  - **The countdown runs on the local clock, not on the server's `next_due_at`.** "The gateway re-publishes `next_due_at` when a wakeup fires and completes; between those the countdown runs on the local clock (it used to be computed once per render and sat frozen)."
  - **The clock only runs while the pane is visible** — "Keep-alive keeps every ever-active tab mounted, so it also stops for a hidden pane or window."
  - **"Due" and "next" are different words.** `nextRun` returns "due — waiting for idle" when the deadline has passed, because the agent cannot run while the session is busy. A loop can be `deferred_by_goal` or `awaiting_response` and shows a different label for each.
  - **Destructive actions are confirmed** (`ConfirmDialog`) and the menu is **the same set of items in a dropdown and a context menu**, rendered from one `renderMenuItems(isContext)` function.
  - Radix opens on `pointerdown`, so a keyboard or programmatic click (`event.detail === 0`) opens the menu manually — otherwise those clicks are silently ignored.
- **Edge cases & failure handling:** the loop's `last_stop_reason` and `paused_reason` are surfaced verbatim; a finished loop offers only "dismiss".
- **Surprising:** `formatCountdown` handles both seconds and milliseconds epochs (`targetTimestamp > 1e11 ? … : … * 1000`) because the backend and the client disagree about units.

#### `apps/desktop/src/app/capabilities/skills/skill-provenance.ts`
- **Purpose:** the provenance tiers that decide what a skill is and whether it may be edited.
- **Key abstractions:** `catalogSourceFor(provenance) → 'built-in' | 'hub' | 'external' | 'local'`, `isEditableProvenance(provenance)`.
- **Non-obvious design decisions:**
  - **Provenance is origin only, never mutability** for external mounts: "external skills stay editable in place (a refusal would just breed silent local duplicates — commit 8c8fc6c1ec / PR #17512)." The user pointed `skills.external_dirs` at them; they are theirs.
  - **Only learned/local skills and external mounts are editable**; bundled and hub skills are managed by their sources.
- **Surprising:** a 25-line file that decides whether the product will spawn duplicates of the user's own files.

#### `apps/desktop/src/app/learning/archive-skill-confirm-dialog.tsx`
- **Purpose:** the shared "archive this learned skill" confirmation, with an **optimistic** apply/rollback.
- **Key abstractions:** `ArchiveSkillConfirmDialog`, `archiveLearningSkill(id, profile)`, `ARCHIVE_SKILL_DESCRIPTION`, `notifySkillArchived`, `fireOptimistic(action, rollback, onFailure)`.
- **Data flow:** confirm → `onApply()` returns a rollback → the archive RPC runs → on failure the rollback runs and the failure is reported.
- **Non-obvious design decisions:**
  - **Archiving is not deleting.** The description says so in the dialog: "The skill is archived and can be restored with `hermes curator restore`." A destructive-looking action is reversible, and the dialog says how.
  - **The optimistic pattern is factored into one helper** (`fireOptimistic`) so every caller applies-then-rolls-back the same way.
  - The profile scope is an explicit prop: "archive against THIS profile's backend; undefined/null keeps the app-wide active profile."
- **Edge cases & failure handling:** a failed archive throws with the backend's message and the caller rolls back.

#### `apps/desktop/src/app/retirement-view.tsx`
- **Purpose:** the "your update channel has closed" notice inside the updates dialog.
- **Non-obvious design decisions:** "There is nothing to download or migrate — the user uninstalls", and **dismissal persists per retired-channel revision** so it does not nag on every check. A terminal state is given its own copy rather than being dressed up as a fixable error.

#### `apps/desktop/src/app/shell/hooks/use-context-breakdown.ts`
- **Purpose:** the context-window meter — how full the focused session's context window is.
- **Key abstractions:** `useContextBreakdown({busy, enabled, requestGateway, sessionId})`, `invalidateContextBreakdown(sessionId)`, `isZeroedBreakdown`, `RETRY_DELAYS_MS = [1s, 4s, 12s]`.
- **Data flow:** the statusbar gauge is on + the session is idle → `session.context_breakdown` → a per-session cached breakdown → the meter.
- **Non-obvious design decisions:**
  - **The backend only reports measured occupancy once a turn has run *in this process*, so a resumed session reports none.** `session.context_breakdown` estimates the same figure from the live system prompt + tools + transcript, and it is "a read-only chars/4 pass: no provider call, no prompt-cache impact."
  - **An untrustworthy answer is evicted rather than shown.** A zeroed breakdown (`context_max === 0`, the backend's `agent is None` branch) is not data. The hook retries on a bounded ladder (1 s / 4 s / 12 s) and, when the ladder is exhausted, **evicts the cached breakdown so the meter goes dark honestly** rather than showing numbers known to be stale.
  - **Two events change the transcript without a busy toggle** — compression (`/compress` runs outside any turn, and auto-compression commits mid-turn) and reclaim. A served pre-compression breakdown "is not merely stale, it is wrong by 5-10x (#94001)". Both call sites bump a **per-session invalidation generation**, which the hook subscribes to, forcing an immediate refetch.
  - **The fetch is suppressed while the session is busy** — mid-turn the gateway already streams measured usage, so an estimate would be both stale and wasteful.
  - **A session switch resets the retry state**, so a new session's first successful fetch is authoritative for it.
- **Edge cases & failure handling:** the last good breakdown stays on screen while the ladder is still running ("the meter ticking down beats flickering dark for a transient window"); once exhausted the cache is gone and the meter goes dark.

#### `apps/desktop/src/app/settings/fallback-models-field.tsx`
- **Purpose:** the structured editor for the `fallback_providers` chain — the ordered list of `{provider, model}` pairs tried when the default model fails.
- **Key abstractions:** `FallbackModelsField({value, onChange})`, `normalizeEntries`, `completeEntries`, `entriesEqual`.
- **Data flow:** raw config value → normalised editor rows → only *complete* pairs are emitted upward.
- **Non-obvious design decisions:**
  - **The editor edits only the two selects; every other key rides along untouched.** "an autosave would rewrite a local-gateway chain as bare provider/model pairs and route fallbacks to the public provider (#89184)." The row type is `Record<string, unknown>` precisely so unknown keys survive.
  - **Half-filled rows stay in local state and are never emitted**, so the autosave never persists a partial `{provider, model: ''}`.
  - **The commit echo is ignored**: `lastEmittedRef` holds the last complete chain, so a parent's echo of our own value does not wipe the user's half-typed row. A real external change (profile switch, config reload) resyncs.
  - **Legacy string entries (`"provider/model"`) are parsed defensively** so the editor never crashes on odd data.
- **Surprising:** this replaced a generic comma-string `list` input that "stringified the objects to '[object Object], [object Object]'".

#### `apps/desktop/src/app/settings/delegation-route-draft.ts`
- **Purpose:** the local draft for the **subagent delegation route** — which model/provider a delegated agent runs on.
- **Key abstractions:** `useDelegationRouteDraft(saved, providers)`, `INHERIT_VALUE`, `MODEL_ONLY_VALUE`, `DIRECT_VALUE`, `CUSTOM_PROVIDER_VALUE`, `providerItem`, `directEndpointActive`, `routeComplete`, `draftOutcome`.
- **Data flow:** the saved route → a mode (`inherit` / model-only / provider / direct endpoint / custom) → `draftOutcome` → a `DelegationModelProviderValue` written only when Apply is pressed.
- **Non-obvious design decisions:**
  - **Modes are namespaced values, not booleans**: provider items use a `provider:` prefix because "Provider item values have a separate namespace from editor actions."
  - **Native SDK providers ignore a direct URL** (`bedrock`, `vertex`, `google`, `google-genai`) — matching `tools/delegate_tool_config.py`.
  - **Apply is refused unless the route is complete**: a provider the catalog does not list and that is not a custom slug is not known; a model the catalog does not list is not known. "A catalog row may list ids a user could never type (MoA preset names carry spaces)."
  - **Switching provider clears the model**, and "Never reinterpret a model from the previous route as a completed switch."
  - **`resetDirectEndpoint` is an explicit flag**, so leaving the direct-endpoint mode clears the endpoint without touching the rest of the settings.
- **Edge cases & failure handling:** changing a provider resets `useParentModel`; `reset()` restores the saved route exactly.

---

### Tier 2 — bulk: a compact table, one row per file

Every file in the shard appears exactly once in the table below unless it has a Tier-1 entry
above. The one-liner for a source file is the file's own leading doc-comment (the design
intent the author wrote down); for a test file it is the suite's own first `describe`/`it`
title. These were read as *structured* reads (doc-comment + exported symbols; test titles),
not line by line — see the status ledger for the per-file note.

| `apps/desktop/src/app/agents/index.tsx` | Exports `AgentsView, SubagentRow`. *(read head 40)* |
| `apps/desktop/src/app/artifacts/artifact-utils.ts` | Exports `ArtifactKind, ArtifactFilter, ARTIFACT_FILTERS, ArtifactRecord, ArtifactLoadFailure, ArtifactLoadResult`. |
| `apps/desktop/src/app/artifacts/index.test.ts` | describe('collectArtifactsForSession', () => { — it('indexes plain https links from assistant text', () => { |
| `apps/desktop/src/app/artifacts/index.tsx` | Exports `ArtifactsView`. |
| `apps/desktop/src/app/artifacts/remote-open.test.tsx` | it('keeps discovered file paths and originating session scope intact through remote opening', async () => { |
| `apps/desktop/src/app/capabilities/catalog/catalog-alert.tsx` | A load failure above the catalog results that keeps what's already shown. |
| `apps/desktop/src/app/capabilities/catalog/catalog-arc.ts` | One sweep for every card's hover arc. * * Each hovered (or focused) card runs the arc rotation on the document timeline * with `startTime = 0`, so every card sits at the same angle at the s… |
| `apps/desktop/src/app/capabilities/catalog/catalog-bento.ts` | Exports `BENTO_COLUMNS, BentoTile, packBento`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-browser.test.tsx` | it('defaults to cards, with installed entries already switched on', () => { — it('installs from the card switch without opening its details', () => { |
| `apps/desktop/src/app/capabilities/catalog/catalog-browser.tsx` | Exports `CatalogBrowser`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-card.tsx` | Exports `catalogIcon, CatalogImage, CatalogCardVariant, CatalogCard`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-curation.ts` | Exports `curationOwnsArtwork, officialCatalogArtwork, curatedFeaturedRank, PluginTier, PLUGIN_TIER_ORDER, pluginTier`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-data.test.ts` | describe('public catalog data', () => { — it('preserves every source and distinct install identifier, including same-named skills', () => { |
| `apps/desktop/src/app/capabilities/catalog/catalog-data.ts` | Exports `CatalogKind, CatalogEntry, catalogImageUrl, catalogLabel, parseCatalog, fetchCatalog`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-detail-dialog.tsx` | Exports `CatalogDetailDialog`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-detail.tsx` | Exports `CatalogDetail`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-developer.tsx` | One banner for every catalog. The wing, copy and docs links are shared; the page supplies its own management actions. |
| `apps/desktop/src/app/capabilities/catalog/catalog-discovery.css` | /* Figma Frame 330's geometry, with the existing desktop card and theme surfaces. */ /* Reference 121:5782: full-card hard-light artwork, no alpha-mask strip. |
| `apps/desktop/src/app/capabilities/catalog/catalog-discovery.test.tsx` | describe('multi-category discovery', () => { — it('gives every picked category its own shelf, small ones included, with no tier shelves', () => { |
| `apps/desktop/src/app/capabilities/catalog/catalog-discovery.tsx` | Fewest cards a category needs for its own shelf; smaller ones share "More to explore". |
| `apps/desktop/src/app/capabilities/catalog/catalog-download.test.ts` | describe('catalog download liveness', () => { — it('reports a stalled body as a timeout, not user cancellation', async () => { |
| `apps/desktop/src/app/capabilities/catalog/catalog-featured-slider.tsx` | How long a slide holds before the hero advances on its own. |
| `apps/desktop/src/app/capabilities/catalog/catalog-filter-bar.test.tsx` | describe('tier chips', () => { — it('collapses to All when the last unselected tier is picked', () => { |
| `apps/desktop/src/app/capabilities/catalog/catalog-filter-bar.tsx` | Exports `CatalogFilterBar`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-filters.tsx` | Exports `FacetRow, CatalogFilters`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-install-switch.tsx` | Exports `CatalogInstallSwitch`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-list-row.tsx` | Exports `CatalogListRow`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-metadata.tsx` | Trust tiers read at a glance (same tones as the installed-plugin pill); the rest stay muted. |
| `apps/desktop/src/app/capabilities/catalog/catalog-pointer.ts` | Off for now: without it every card rests at its theme's gradient anchor. |
| `apps/desktop/src/app/capabilities/catalog/catalog-query.test.ts` | describe('plugin tier facet', () => { — it('lists the tiers present in trust order and folds installed-only values in', () => { |
| `apps/desktop/src/app/capabilities/catalog/catalog-query.ts` | Exports `CatalogSort, CatalogFacets, EMPTY_FACETS, facetSource, catalogSources, catalogCategories`. |
| `apps/desktop/src/app/capabilities/catalog/catalog-switch.tsx` | Visible action copy stays attached to the actual controlled switch. Both * labels share one grid cell so the control never shifts when it flips. |
| `apps/desktop/src/app/capabilities/catalog/catalog.css` | /* Registered so the gradient can glide instead of jump. Written per card by `trackCatalogPointer`: x/y is the pointer clamped to the card, near is 0–1. |
| `apps/desktop/src/app/capabilities/catalog/skill-catalog.tsx` | Exports `SkillCatalog`. |
| `apps/desktop/src/app/capabilities/catalog/store.ts` | // One browsing layout across Skills and Plugins; Installed keeps its own list. |
| `apps/desktop/src/app/capabilities/catalog/update-skills-button.tsx` | Exports `UpdateSkillsButton`. |
| `apps/desktop/src/app/capabilities/catalog/use-catalog-filters.ts` | Exports `useCatalogFilters`. |
| `apps/desktop/src/app/capabilities/connectors/accounts-section.test.tsx` | describe('AccountsSection rename', () => { — it('sends the account id and the new name, and shows the new name before the answer', async () => { |
| `apps/desktop/src/app/capabilities/connectors/accounts-section.tsx` | Exports `AccountEdit, AccountsSectionProps, AccountsSection`. |
| `apps/desktop/src/app/capabilities/connectors/add-dialog.tsx` | Exports `AddServerDialogProps, AddServerDialog`. |
| `apps/desktop/src/app/capabilities/connectors/add-server-draft.ts` | Exports `AddServerAuth, AddServerTransport, DraftValue, DraftPair, AddServerDraft, nextRowId`. |
| `apps/desktop/src/app/capabilities/connectors/add-server-form.tsx` | Exports `AddServerFormProps, AddServerForm`. |
| `apps/desktop/src/app/capabilities/connectors/catalog-mark.tsx` | Exports `CatalogMark`. |
| `apps/desktop/src/app/capabilities/connectors/category-picker.tsx` | Exports `CategoryPickerProps, CategoryPicker`. |
| `apps/desktop/src/app/capabilities/connectors/connect-element.test.tsx` | describe('ConnectElement Try again', () => { — it('stays disabled while its start is in flight, so two clicks cannot mint two sign-ins', () => { |
| `apps/desktop/src/app/capabilities/connectors/connect-element.tsx` | Exports `ConnectElementProps, ConnectElement`. |
| `apps/desktop/src/app/capabilities/connectors/connector-dialog.tsx` | Exports `ConnectorDialogProps, ConnectorDialog`. |
| `apps/desktop/src/app/capabilities/connectors/connector-kind.ts` | Exports `connectorKindWord, showsCatalogMark`. |
| `apps/desktop/src/app/capabilities/connectors/connector-row-card.tsx` | Exports `ConnectorRowCardProps, ConnectorRowCard`. |
| `apps/desktop/src/app/capabilities/connectors/connectors-directory.tsx` | Exports `ConnectorsDirectoryProps, ConnectorsDirectory`. |
| `apps/desktop/src/app/capabilities/connectors/connectors-tab.tsx` | Exports `ConnectorsTabProps, ConnectorsTab`. |
| `apps/desktop/src/app/capabilities/connectors/data/account-operations.test.ts` | describe('accountOperationFor', () => { — it('answers only with an operation started in the same profile scope', () => { |
| `apps/desktop/src/app/capabilities/connectors/data/account-operations.ts` | Exports `AccountOperationRequest, AccountOperation, abandonConnect, accountOperationFor, retryable, retryableAccount`. |
| `apps/desktop/src/app/capabilities/connectors/data/alias.ts` | The gateway's account-name format (`ConnectorAlias` in the connector contracts). |
| `apps/desktop/src/app/capabilities/connectors/data/connect-address.test.ts` | describe('reconnect addresses the account the user picked', () => { — it('names a named account by its id, so an unconfirmed rename cannot point the repair at another account', () => { |
| `apps/desktop/src/app/capabilities/connectors/data/deep-link.test.ts` | describe('the chat Rename link goes by account id', () => { — it('carries the id, not the name the account had then', () => { |
| `apps/desktop/src/app/capabilities/connectors/data/deep-link.ts` | Exports `accountRenameRoute, resumeAccountConnect, linkedScope, claimRouteLink, resetRouteLinksForTests`. |
| `apps/desktop/src/app/capabilities/connectors/data/hosted-actions.ts` | Exports `HostedActions, HostedActionOptions, useHostedActions`. |
| `apps/desktop/src/app/capabilities/connectors/data/join.test.ts` | describe('joinHostedConnectors with several accounts', () => { — it('keeps one row per account, the active one first, then the newest', () => { |
| `apps/desktop/src/app/capabilities/connectors/data/join.ts` | Exports `ConnectorPolicyTagRules, ConnectorPolicyRules, ConnectorPolicyView, EMPTY_POLICY, readPolicy, memberEnables`. |
| `apps/desktop/src/app/capabilities/connectors/data/keys.ts` | Exports `ConnectorRead, CONNECTORS_QUERY_ROOT, CONNECTOR_LIFETIMES, CONNECTOR_GC_TIME, connectorsListQueryKey, connectorsCatalogQueryKey`. |
| `apps/desktop/src/app/capabilities/connectors/data/mutations.ts` | Exports `WriteOutcome, ConnectorToolsSaver, useConnectorToolsSave, ConnectorSwitch, useConnectorSwitch, AccountDisconnect`. |
| `apps/desktop/src/app/capabilities/connectors/data/persist.ts` | Exports `PersistedRead, QuerySeed, seedOptions, startConnectorPersistence, storeLocalServers, seedLocalServers`. |
| `apps/desktop/src/app/capabilities/connectors/data/portal.ts` | Exports `openConnectorsAdmin`. |
| `apps/desktop/src/app/capabilities/connectors/data/prefetch.test.ts` | describe('prefetchConnectorTools', () => { — it('reads the tool list only for a card whose hosted account is connected', () => { |
| `apps/desktop/src/app/capabilities/connectors/data/prefetch.ts` | Exports `hasConnectedTools, prefetchConnectorTools, usePrefetchConnectedTools`. |
| `apps/desktop/src/app/capabilities/connectors/data/queries.ts` | Exports `HostedConnectorsView, useHostedConnectors, usePluginServers, connectorToolsQueryOptions, ConnectorToolsView, useConnectorTools`. |
| `apps/desktop/src/app/capabilities/connectors/data/rpc.ts` | Exports `ConnectorRpcError, asConnectorError, isConnectorReason, listConnectors, connectorCatalog, connectorAccounts`. |
| `apps/desktop/src/app/capabilities/connectors/derive-page.ts` | Exports `groupIdOf, cardMatchesQuery, showsAttentionFirst, derivePage`. |
| `apps/desktop/src/app/capabilities/connectors/derive-tools.ts` | Exports `UNCATEGORISED, TINY_CONNECTOR_MAX, EMPTY_TOOLS_FILTER, isTinyConnector, toolDisplayName, categoryLabel`. |
| `apps/desktop/src/app/capabilities/connectors/derive.ts` | Exports `EMPTY_CONNECTORS_FILTER, hostedWay, localWay, bundledWay, bothWaysOn, hostedStateWord`. |
| `apps/desktop/src/app/capabilities/connectors/dialog-menu.tsx` | Exports `ConnectorDialogMenuProps, ConnectorDialogMenu`. |
| `apps/desktop/src/app/capabilities/connectors/disconnect-confirm.tsx` | A remove scoped to one account, or the app-level disconnect of the account its summary speaks for. |
| `apps/desktop/src/app/capabilities/connectors/hint-vocabulary.ts` | Exports `VocabularyTone, VocabularyKey, VocabularyEntry, VocabularyTag, VocabularyCopy, VocabularyStrings`. |
| `apps/desktop/src/app/capabilities/connectors/hosted-dialog.tsx` | Exports `HostedConnectorDialogProps, PendingRename, renameLinkTarget, HostedAccountActions, HostedConnectorDialog`. |
| `apps/desktop/src/app/capabilities/connectors/hosted-notice.tsx` | Exports `HostedNotice`. |
| `apps/desktop/src/app/capabilities/connectors/local-dialog.tsx` | Exports `LocalConnectorDialogProps, LocalConnectorDialog, localCost`. |
| `apps/desktop/src/app/capabilities/connectors/local-server-control.tsx` | Exports `InstallField, LocalInstall`. |
| `apps/desktop/src/app/capabilities/connectors/local-slots.tsx` | Exports `LocalAdvancedProps, LocalAdvanced, RemoveServerConfirmProps, RemoveServerConfirm`. |
| `apps/desktop/src/app/capabilities/connectors/plugin-tools-panel.tsx` | Exports `PluginToolsPanelProps, PluginToolsPanel`. |
| `apps/desktop/src/app/capabilities/connectors/tool-row.tsx` | Exports `TOOL_ROW_HEIGHT, ToolRowProps, ToolRow`. |
| `apps/desktop/src/app/capabilities/connectors/tools-filter-bar.tsx` | Exports `ToolsFilterBarProps, ToolsFilterBar`. |
| `apps/desktop/src/app/capabilities/connectors/tools-list.tsx` | Exports `ToolsListProps, ToolsList`. |
| `apps/desktop/src/app/capabilities/connectors/tools-panel.tsx` | Exports `HostedToolsPanelProps, HostedToolsPanel, LocalToolsPanelProps, LocalToolsPanel, orgDisabledCount`. |
| `apps/desktop/src/app/capabilities/connectors/tools-status.tsx` | Exports `ToolsWash, ToolsStatusAction, ToolsStatusPhase, isToolsStatusPhase, ToolsStatus`. |
| `apps/desktop/src/app/capabilities/connectors/tools-summary.tsx` | Exports `openToolsList, resetOpenedTools, useShowAllTools, ToolsSummaryProps, ToolsSummary`. |
| `apps/desktop/src/app/capabilities/connectors/types.ts` | One hosted account; `disabled` marks an account a reconnect replaced. |
| `apps/desktop/src/app/capabilities/connectors/use-tools-editor.ts` | Exports `SaveResult, SaveOptions, UseToolsEditorOptions, ToolsEditor, useToolsEditor`. |
| `apps/desktop/src/app/capabilities/connectors/ways-section.tsx` | Exports `WayChoice, wayInUse, WaysSectionProps, WaysSection`. |
| `apps/desktop/src/app/capabilities/index.test.tsx` | describe('CapabilitiesView toolset management', { timeout: 60_000 }, () => { — it('renders a switch for each toolset and toggles it off', async () => { |
| `apps/desktop/src/app/capabilities/index.tsx` | // Skills Hub browsing lives inside the Skills tab. Legacy `?tab=hub` // links fall back to 'skills' via useRouteEnumParam. |
| `apps/desktop/src/app/capabilities/mcp/install-catalog-entry.ts` | Exports `installBundledEntry`. |
| `apps/desktop/src/app/capabilities/mcp/mcp-doc.ts` | // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- `isServerShape` is main's exported name; it is bound to a domain name here instead of renaming the export. |
| `apps/desktop/src/app/capabilities/mcp/mcp-editor.tsx` | Exports `McpJsonEditorProps, McpJsonEditor, McpLogPaneProps, McpLogPane, McpEditorPane`. |
| `apps/desktop/src/app/capabilities/mcp/mcp-logs.test.ts` | describe('filterStdioSections', () => { — it('splits mcp-stderr.log by server for stamped and older banner lines', () => { |
| `apps/desktop/src/app/capabilities/mcp/mcp-logs.tsx` | Exports `LOG_POLL_MS, filterStdioSections, McpLogSource, useMcpLogLines`. |
| `apps/desktop/src/app/capabilities/mcp/mcp-status.ts` | Exports `MCP_CATALOG_KEY, Probe, ServerStatus, okProbe, ServerCost, MCP_USAGE_TTL_MS`. |
| `apps/desktop/src/app/capabilities/mcp/use-mcp-draft.ts` | Exports `McpDraft, UseMcpDraftOptions, useMcpDraft`. |
| `apps/desktop/src/app/capabilities/mcp/use-mcp-probes.ts` | Exports `McpProbes, UseMcpProbesOptions, useMcpProbes`. |
| `apps/desktop/src/app/capabilities/mcp/use-mcp-servers.ts` | Exports `McpServersController, UseMcpServersOptions, useMcpServers`. |
| `apps/desktop/src/app/capabilities/plugins/plugin-packages.test.ts` | describe('mergePluginPackages', () => { — it('shows a unified package as ONE row with both halves, never two rows', () => { |
| `apps/desktop/src/app/capabilities/plugins/plugin-packages.ts` | One row per PACKAGE on the Plugins page. A package may have a desktop half * (loaded into this app, same for every profile), an agent half (installed in * the SELECTED profile's backend), o… |
| `apps/desktop/src/app/capabilities/plugins/plugin-settings-form.test.tsx` | describe('PluginSettingsForm (#46600, #87934)', () => { — it('renders one control per schema type from the table, secrets masked with no value echoed', () => { |
| `apps/desktop/src/app/capabilities/plugins/plugin-settings-form.tsx` | // A plugin manifest's `config_schema` rendered as a form. |
| `apps/desktop/src/app/capabilities/plugins/plugin-update.test.ts` | describe('runPluginUpdate scan override', () => { — it('shows a caution finding, and only "Update anyway" retries the update with force', async () => { |
| `apps/desktop/src/app/capabilities/plugins/plugin-update.ts` | Exports `scanFindingLines, runPluginUpdate`. |
| `apps/desktop/src/app/capabilities/plugins/plugins-page-header.test.tsx` | describe('Plugins Agent scope selector', () => { — it('preserves the exact selected profile through the compact value wrapper', async () => { |
| `apps/desktop/src/app/capabilities/plugins/plugins-tab.test.tsx` | describe('PluginsTab', () => { — it('opens a non-first installed deep-link target from Browse and keeps that selection after consuming the link', async () => { |
| `apps/desktop/src/app/capabilities/plugins/plugins-tab.tsx` | Exports `pluginElementId, PluginActions, PluginsTab`. |
| `apps/desktop/src/app/capabilities/primitives.tsx` | // The chrome the Skills and Tools tabs share: one inspector header, one empty // state and one sort control, so switching between them never jumps. |
| `apps/desktop/src/app/capabilities/scope-selector.tsx` | Exports `CapabilityScope, useCapabilityScope, CapabilityScopeSelector`. |
| `apps/desktop/src/app/capabilities/skills/frontmatter.test.ts` | describe('parseFrontmatter', () => { — it('splits the leading YAML block from the body', () => { |
| `apps/desktop/src/app/capabilities/skills/frontmatter.ts` | // Frontmatter parse for display: the YAML block between the leading `---` // fences, flattened to top-level `key: value` rows (nested blocks render as // their raw indented text). |
| `apps/desktop/src/app/capabilities/skills/official-skill-detail.tsx` | // Detail pane for a not-yet-installed catalog skill. |
| `apps/desktop/src/app/capabilities/skills/skill-detail.tsx` | Exports `SkillDetail`. |
| `apps/desktop/src/app/capabilities/skills/skill-provenance.test.ts` | describe('skill provenance tiers', () => { — describe('catalogSourceFor', () => { |
| `apps/desktop/src/app/capabilities/skills/skills-data.ts` | // Skills live in the RQ cache so switching tabs/pages paints the cached list // instantly (no reload flash) and mount only fires a deduped background // refetch. |
| `apps/desktop/src/app/capabilities/skills/skills-tab.tsx` | Exports `SkillsTab`. |
| `apps/desktop/src/app/capabilities/toolsets/tool-calls.ts` | // Per-tool call counts come from a 365-day message scan — heavy, and purely // cosmetic (Toolsets usage badges). |
| `apps/desktop/src/app/capabilities/toolsets/toolset-detail.tsx` | Exports `ToolsetDetail`. |
| `apps/desktop/src/app/capabilities/toolsets/toolsets-data.ts` | // Toolsets live in the RQ cache so switching tabs/pages paints the cached list // instantly (no reload flash) and mount only fires a deduped background // refetch. |
| `apps/desktop/src/app/capabilities/toolsets/toolsets-tab.tsx` | Exports `ToolsetsTab`. |
| `apps/desktop/src/app/capabilities/ui/capability-search.tsx` | The one search field every Capabilities tab uses: the boxed SearchField * with the tab's name as a scope badge and the tab's own actions (add, view * toggle, …) at the end. |
| `apps/desktop/src/app/capabilities/ui/catalog-surface.tsx` | Exports `CatalogSurfaceItem, CatalogSurfaceSection, CatalogSurface`. |
| `apps/desktop/src/app/capabilities/ui/page.css` | /* The one content column every Capabilities tab sits in: search, filters, sections and directory rows all share these edges. */ :root { /* Shared vertical rhythm, the same on every tab. |
| `apps/desktop/src/app/chat/browser-popout-handoff.test.tsx` | describe('browser pop-out content handoff', () => { — it('hands the persisted tab URL to a guest (pre-scoping single-array storage)', async () => { |
| `apps/desktop/src/app/chat/browser-popout-shell.tsx` | Dedicated shell for `?win=browser`: the in-app Browser, full-window, no * session sidebar or layout tree. Same webview + address bar the docked tab * uses — just in its own OS window. |
| `apps/desktop/src/app/chat/built-in-tour.ts` | The app's own tour — what `gui_tour` runs when it starts with no steps. * * The app owns the stops (stable `data-tour` handles) and their copy, so a * look around is one tool call. |
| `apps/desktop/src/app/chat/chat-drop-overlay.tsx` | Full-bleed affordance shown while files or a session are dragged over the chat * area. |
| `apps/desktop/src/app/chat/chat-surface-state.ts` | Exports `useShowChatBar, dropOverlayKind`. |
| `apps/desktop/src/app/chat/chat-swap-overlay.test.tsx` | describe('ChatSwapOverlay', () => { — it('keeps the last profile name through the fade-out, with the glyph frozen', () => { |
| `apps/desktop/src/app/chat/chat-swap-overlay.tsx` | // Shown over the conversation while the live gateway swaps to another profile's // backend (lazily spawned). Keeps the last profile name through the fade-out so // the label doesn't blank. |
| `apps/desktop/src/app/chat/close-tab.test.ts` | describe('closeActiveTab', () => { — it('leaves ⌘W to the zone rungs even with previews open', () => { |
| `apps/desktop/src/app/chat/close-tab.ts` | Close the MAIN tab. The workspace pane itself can't leave the tree, so * "closing" it means emptying it, and what fills the hole depends on what's * stacked beside it: * * - session tabs st… |
| `apps/desktop/src/app/chat/composer/at-folder-navigation.test.tsx` | describe('@ folder navigation', () => { — it('Tab on a folder walks into it and keeps the popover open', () => { |
| `apps/desktop/src/app/chat/composer/attachments.test.tsx` | describe('AttachmentList', () => { — it('does not crash when attachments array contains undefined entries', async () => { |
| `apps/desktop/src/app/chat/composer/attachments.tsx` | Exports `AttachmentList`. |
| `apps/desktop/src/app/chat/composer/busy-submit-state.ts` | Exports `ComposerBusyAction, BusySubmitInputs, BusySubmitState, deriveBusySubmitState`. |
| `apps/desktop/src/app/chat/composer/chat-bar-parts.tsx` | Radial dock-target glow shown while a popped-out composer is dragged. * Intensity tracks how close the composer is to the dock (1 = peak). |
| `apps/desktop/src/app/chat/composer/completion-drawer.tsx` | // A standalone glassy panel floating just off the composer edge, inset from the // left. Skin is the shared composerPanelCard (also used by the attach menu). |
| `apps/desktop/src/app/chat/composer/composer-text-guard.test.tsx` | describe('composer draft restore vs an unbound composer core (#49903)', () => { — it('swallows the unbound-core throw at startup instead of crashing the renderer', () => { |
| `apps/desktop/src/app/chat/composer/composer-utils-width.test.ts` | describe('composerInputWidthClass', () => { — it('fills the unstacked 1fr grid track instead of the 8rem inline floor', () => { |
| `apps/desktop/src/app/chat/composer/composer-utils.test.ts` | describe('shouldDisableComposerInput', () => { — it('fails closed when connection atoms disagree about an open gateway', () => { |
| `apps/desktop/src/app/chat/composer/composer-utils.ts` | Exports `COMPOSER_STACK_BREAKPOINT_PX, COMPOSER_COMPACT_PILL_PX, COMPOSER_FOLD_VOICE_PX, COMPOSER_MINIMAL_PX, COMPOSER_SINGLE_LINE_MAX_PX, COMPOSER_FADE_BACKGROUND`. |
| `apps/desktop/src/app/chat/composer/context-menu.tsx` | Exports `ContextMenu, ContextMenuItem`. |
| `apps/desktop/src/app/chat/composer/contrib.test.ts` | describe('runComposerMiddleware', () => { — it('passes the draft through untouched when nothing is registered', async () => { |
| `apps/desktop/src/app/chat/composer/contrib.ts` | Composer contribution surface — every seam of the composer is hook-into-able * through the SAME registry schema as every other surface (statusbar, titlebar, * panes, layouts): * * render ar… |
| `apps/desktop/src/app/chat/composer/control-classes.ts` | // Shared class names for the composer's control row, in a module of their own // so both the row (`controls.tsx`) and the menus it renders can wear them // without importing each other in … |
| `apps/desktop/src/app/chat/composer/controls.test.tsx` | describe('HUD mode', () => { — it('keeps the mic inline, fans the toggles on hover, and offers no exit in the docked composer', async () => { |
| `apps/desktop/src/app/chat/composer/controls.tsx` | // Re-exported: `context-menu.tsx` and other row neighbours have always reached // for these here, and the row is where they read as belonging. |
| `apps/desktop/src/app/chat/composer/directive-actions.test.tsx` | describe('ComposerDirectiveActions', () => { — it('offers an action for a hovered actionable chip', () => { |
| `apps/desktop/src/app/chat/composer/directive-actions.tsx` | Hover actions for directive chips in a composer. |
| `apps/desktop/src/app/chat/composer/directive-label.test.ts` | describe('one label per reference, on every surface', () => { — it('the popover row, the committed chip, and the sent chip all read the same', () => { |
| `apps/desktop/src/app/chat/composer/directive-scope.test.ts` | describe('directive scope is a browse mode, not text to maintain', () => { — it('Tab-descend carries the scope down instead of dropping to a bare path', () => { |
| `apps/desktop/src/app/chat/composer/discard-lost-prompt.test.ts` | test('Discard uses the queue owner socket and its lost generation, including an unbound runtime', async () => { — test('Discard refuses unresolved or unavailable owners instead of falling back to the… |
| `apps/desktop/src/app/chat/composer/discard-lost-prompt.ts` | Exports `discardLostPrompt, cancelQueuedPrompt, steerQueuedPrompt, replaceQueuedPrompt`. |
| `apps/desktop/src/app/chat/composer/drop-affordance.ts` | Exports `COMPOSER_DROP_FADE_CLASS, COMPOSER_DROP_ACTIVE_CLASS`. |
| `apps/desktop/src/app/chat/composer/empty-composer.test.ts` | describe('an emptied composer reads as empty', () => { — it('keeps the placeholder <br> so the contenteditable holds its height', () => { |
| `apps/desktop/src/app/chat/composer/enter-stale-ime-flag.test.tsx` | describe('composer Enter — stale IME composition flag recovery (#44135)', () => { — it('sends on Enter despite a wedged composing flag when the native event says not composing', async () => { |
| `apps/desktop/src/app/chat/composer/enter-submit-dom-race.test.tsx` | describe('composer Enter submit — live DOM vs stale composer state (#39630)', () => { — it('sends the just-typed text on Enter even when composer state has not synced', async () => { |
| `apps/desktop/src/app/chat/composer/floating-state.ts` | Exports `FloatingComposerOwner`. |
| `apps/desktop/src/app/chat/composer/floating-surface.test.tsx` | it('shares one visible composer while preserving each editor and draft across hover, focus and docking', () => { — it('hands the floating recipient to a visible tab when its old tab hides or closes',… |
| `apps/desktop/src/app/chat/composer/floating-surface.tsx` | Exports `FloatingComposerSurface`. |
| `apps/desktop/src/app/chat/composer/floating-target-editable-guard.test.ts` | describe('floating composer focus-follow vs a focused transcript text field', () => { — it('keeps the caret in a clarify answer box on programmatic focus and on pointermove', () => { |
| `apps/desktop/src/app/chat/composer/floating-target-floating-layer.test.ts` | describe('floating composer focus-follow vs an open floating layer', () => { — it('leaves focus inside a floating layer, but still follows the pointer otherwise', () => { |
| `apps/desktop/src/app/chat/composer/floating-target-selection-guard.test.ts` | describe('floating composer focus-follow vs transcript selection', () => { — it('never steals a non-collapsed transcript selection, on pointermove or focusin', () => { |
| `apps/desktop/src/app/chat/composer/floating-target.ts` | Exports `registerFloatingComposer, claimFloatingComposer, pinFloatingComposerCapture`. |
| `apps/desktop/src/app/chat/composer/focus-chord.test.ts` | describe('handleComposerFocusChord', () => { — it('focuses the active composer on the bare chord and swallows the key', async () => { |
| `apps/desktop/src/app/chat/composer/focus-chord.ts` | ⌘/Ctrl+L moves focus to the composer from anywhere. This matches the * address-bar muscle memory of a browser. |
| `apps/desktop/src/app/chat/composer/focus.test.ts` | describe('focusComposerInput', () => { — it('does not steal the caret from another live composer', () => { |
| `apps/desktop/src/app/chat/composer/focus.ts` | Composer focus + external-insert bus. * * Mutations from outside the composer (sidebar attach, drag drop, terminal * Cmd+L, preview console, etc.) dispatch through here. |
| `apps/desktop/src/app/chat/composer/help-hint.tsx` | Exports `HelpHint`. |
| `apps/desktop/src/app/chat/composer/hooks/completion-route.ts` | Where a composer completion RPC (`commands.catalog`, `complete.slash`, * `complete.path`) for `sessionId` goes: the session's OWNER, never the * window's ambient socket. |
| `apps/desktop/src/app/chat/composer/hooks/slash-localization.test.tsx` | describe('desktop slash description localization', () => { — it('uses the active catalog across aliases and help while preserving unknown descriptions and usage syntax', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-at-completions-contrib.test.tsx` | describe('contributed @ completion sources', () => { — it('merges contributed rows ahead of gateway path results', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-at-completions.test.ts` | describe('PERF: @ path completions are cached and skip the debounce', () => { — it('serves a repeated query with no round trip and no spinner', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-at-completions.ts` | Exports `useAtCompletions`. |
| `apps/desktop/src/app/chat/composer/hooks/use-auto-speak-replies.cross-window.test.tsx` | it('reads the final reply once, in the window that read the progress update, after that clip ends', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-auto-speak-replies.owner.test.tsx` | describe('useAutoSpeakReplies — owner-routed synthesis', () => { — it('synthesizes a Bot reply with the scope owner (connection, profile), not the active scope', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-auto-speak-replies.test.tsx` | describe('useAutoSpeakReplies — Edge TTS fallback chain (#93515)', () => { — it('does not re-speak the reply once playback goes idle after an id rewrite mid-fallback', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-auto-speak-replies.ts` | Exports `clearOwnedSpeechTurnsForTests, useAutoSpeakReplies`. |
| `apps/desktop/src/app/chat/composer/hooks/use-card-waiting-submit.ts` | In the onboarding chat typed text answers a waiting card through Send; an empty draft still offers Stop. |
| `apps/desktop/src/app/chat/composer/hooks/use-completions-owner-route.test.tsx` | describe('composer completions route to the session owner', () => { — it('serves / catalog and typed lookups from the owning profile, not the ambient socket', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-branch.ts` | Exports `useComposerBranch`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-draft.test.tsx` | describe('useComposerDraft — attachment scope stays coherent with the committed session on switch (#59305)', () => { — it('clears the outgoing session attachments by the layout phase right after swit… |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-draft.ts` | Exports `useComposerDraft`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-drop.ts` | Exports `useComposerDrop`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-esc-cancel.test.tsx` | describe('useComposerEscCancel', () => { — it('cancels the turn on Esc while busy with chat focus', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-esc-cancel.ts` | Exports `useComposerEscCancel`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-metrics.test.tsx` | describe('useComposerMetrics — published clearance survives an effect replay', () => { — it('republishes the dock height after StrictMode replays the cleanup', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-metrics.ts` | Exports `ComposerFit, useComposerMetrics`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-placeholder.ts` | Exports `useComposerPlaceholder`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-popout.test.tsx` | describe('useComposerPopout', () => { — it('removes the pop-out affordance when gestures are disabled', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-popout.ts` | Exports `useComposerPopout`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-queue.test.tsx` | describe('useComposerQueue park integration', () => { — it('admits native Queue through submit and retains an uncertain draft without a local replay', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-queue.ts` | Exports `useComposerQueue`. *(read head 70)* |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-screenshot.test.tsx` | describe('screenshot composer routing', () => { — it('attaches once to the active split composer even without document focus, preserving its draft', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-screenshot.ts` | Exports `useComposerScreenshot`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-submit.restore-scoping.test.tsx` | it('keeps a late rejected B submit out of A’s draft and next ordinary Send (#66661)', async () => { — it('restores text and attachments by the loaded draft owner, not an uncommitted navigation render… |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-submit.test.tsx` | describe('useComposerSubmit external request routing', () => { — it('routes a refused native steer through canonical queue admission', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-submit.ts` | Exports `useComposerSubmit`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-trigger.test.ts` | describe('useComposerTrigger — slash anywhere in the prompt', () => { — it('opens the completion list for a slash typed mid-message', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-trigger.ts` | Exports `triggerKeyUpHandler, rebuildAroundCaret, useComposerTrigger`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-undo.test.tsx` | describe('useComposerUndo', () => { — it('restores the pre-edit text, which is what a paste destroyed', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-undo.ts` | Exports `useComposerUndo`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-url-dialog.test.tsx` | describe('useComposerUrlDialog', () => { — it('drops an @url: directive into the draft when there is no host onAddUrl', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-url-dialog.ts` | Exports `useComposerUrlDialog`. |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-voice-shortcuts.test.tsx` | describe('composer voice shortcuts', () => { — it('dictates only on the active visible target and ignores a disabled target', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-voice.test.tsx` | describe('useComposerVoice voice submission', () => { — it('uses live busy state when a retained voice callback submits after barge-in', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-composer-voice.ts` | Exports `useComposerVoice`. |
| `apps/desktop/src/app/chat/composer/hooks/use-emoji-completions.ts` | `:shortcode:` completions for the composers, Slack-style (`:joy` → 😂). |
| `apps/desktop/src/app/chat/composer/hooks/use-live-completion-adapter.ts` | Exports `CompletionEntry, CompletionPayload, useLiveCompletionAdapter`. |
| `apps/desktop/src/app/chat/composer/hooks/use-mic-recorder.test.tsx` | describe('useMicRecorder level meter', () => { — it('waits for the previous take’s meter to finish closing before opening the next', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-mic-recorder.ts` | Exports `MicRecorderOptions, MicRecording, MicRecorderErrorCopy, micError, useMicRecorder`. |
| `apps/desktop/src/app/chat/composer/hooks/use-micro-actions.ts` | Resolve every registered micro-action provider for this session and publish * the result to `$composerActionsBySession`, which the pill strip renders. |
| `apps/desktop/src/app/chat/composer/hooks/use-middleware-submit.ts` | Exports `useMiddlewareSubmit`. |
| `apps/desktop/src/app/chat/composer/hooks/use-popout-drag.test.tsx` | describe('useComposerPopoutGestures', () => { — it('never peels the composer out when a text-selection drag starts in the rich editor', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-popout-drag.ts` | Exports `useComposerPopoutGestures`. |
| `apps/desktop/src/app/chat/composer/hooks/use-slash-completions.test.tsx` | describe('useSlashCompletions', () => { — it('serves the bare-slash catalog from cache instead of re-requesting it', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-slash-completions.ts` | Exports `useSlashCompletions`. |
| `apps/desktop/src/app/chat/composer/hooks/use-status-drawer.test.tsx` | it('keeps stored conversations independent from drafts and other conversations', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-status-drawer.ts` | Exports `useStatusDrawer`. |
| `apps/desktop/src/app/chat/composer/hooks/use-status-presence.test.ts` | describe('useSessionStatusPresence', () => { — it('returns false when session is null or empty', () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-status-presence.ts` | Structural view of the per-session feeds — they hold different item * types, and all this hook needs from each is "does this key have rows". |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-conversation-boundary.test.tsx` | it('speaks a sealed narration while busy and keeps the session open for the final reply', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-conversation-meter.test.tsx` | describe('useVoiceConversation with a failed level meter', () => { — it('sends the take to STT instead of dropping it when the meter dies mid-utterance', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-conversation-rearm.test.tsx` | describe('useVoiceConversation playback rearm', () => { — it('re-arms the microphone after normal streaming playback completes', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-conversation-stale-reply.test.tsx` | describe('useVoiceConversation stale reply on next turn', () => { — it('marks the previous reply spoken before submitting so it is not re-spoken while thinking', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-conversation-warmup.test.tsx` | describe('useVoiceConversation STT readiness barrier', () => { — it('waits for the listening warm-up before transcribing the captured utterance', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-conversation.test.tsx` | describe('useVoiceConversation full-duplex barge-in', () => { — it('arms the barge monitor during generation (before any reply audio exists)', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-conversation.ts` | Exports `ConversationStatus, useVoiceConversation`. |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-live-conversation.owner.test.tsx` | describe('useVoiceLiveConversation — owner-routed session', () => { — it('constructs the session with the composer scope owner (connection, profile)', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-live-conversation.test.ts` | describe('Voice-live toast copy', () => { — it('names our own close reasons in copy and passes server-sent reasons through verbatim', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-live-conversation.ts` | How long an accepted delegation may sit before the gateway shows the turn running. |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-recorder-warmup.test.tsx` | describe('useVoiceRecorder STT readiness barrier', () => { — it('does not submit the clip to transcription while the mic-open warm-up is still settling', async () => { |
| `apps/desktop/src/app/chat/composer/hooks/use-voice-recorder.ts` | Exports `useVoiceRecorder`. |
| `apps/desktop/src/app/chat/composer/index.tsx` | Exports `ChatBar, ChatBarFallback`. |
| `apps/desktop/src/app/chat/composer/inline-references.test.ts` | describe('the inline reference contract', () => { — it('marks any element as a reference of a given kind', () => { |
| `apps/desktop/src/app/chat/composer/inline-refs.ts` | Exports `InlineRefInput, SessionDragPayload, sessionLabel, sessionInlineRef, dragHasAttachments, droppedFileInlineRef`. |
| `apps/desktop/src/app/chat/composer/large-paste.test.ts` | describe('large paste policy', () => { — it('converts only pastes strictly past the threshold', () => { |
| `apps/desktop/src/app/chat/composer/large-paste.ts` | Large-paste-to-attachment policy. * * Pasting more than ~3k characters converts the content into a text * attachment instead of inserting it inline, keeping the composer clean and * prevent… |
| `apps/desktop/src/app/chat/composer/micro-actions.tsx` | Floating pill — the shared treatment for a control that sits over the * composer (`composerFloatingPill`), plus this strip's own width cap and * disabled state. |
| `apps/desktop/src/app/chat/composer/model-pill.test.tsx` | describe('ModelPill pinned-override badge', () => { — it('shows the pin dot on a draft running a manual pick', () => { |
| `apps/desktop/src/app/chat/composer/model-pill.tsx` | // `shrink` (not `shrink-0`) with a truncating label: the pill is the one // control in the row that can give width back continuously, so it absorbs the // squeeze between collapse stages i… |
| `apps/desktop/src/app/chat/composer/new-chat-first-send.test.tsx` | it('a new chat first send keeps its creation-time draft, queues on the new chat and leaves session A alone (#139190)', async () => { — it('a follow-up queued while session.create is in flight moves t… |
| `apps/desktop/src/app/chat/composer/paste-to-focus.test.ts` | describe('routeClipboardToComposer', () => { — it('routes pasted text to the composer as an insert', async () => { |
| `apps/desktop/src/app/chat/composer/paste-to-focus.ts` | Paste-to-focus: the paste twin of type-to-focus. |
| `apps/desktop/src/app/chat/composer/paste-url-is-text.test.tsx` | describe('a pasted URL survives the paste', () => { — it('keeps a GitHub PR-comment deep link in the composer and attaches nothing', () => { |
| `apps/desktop/src/app/chat/composer/path-refs.test.ts` | describe('pathifyRefs', () => { — it('promotes a Tab-descended folder token', () => { |
| `apps/desktop/src/app/chat/composer/path-refs.ts` | Bare-path recognition for the composer. Walking into a folder from the `@` * popover (Tab) re-types the token as a bare `@apps/desktop/` so the next * `complete.path` lists that folder's ch… |
| `apps/desktop/src/app/chat/composer/prepared-image-recovery.test.tsx` | test('reopened composer offers exact image occurrence only for its original destination', async () => { — test('recovery never overwrites a newer draft or offers an ambiguous legacy send', async () =… |
| `apps/desktop/src/app/chat/composer/prepared-image-recovery.tsx` | Exports `PreparedImageRecovery`. |
| `apps/desktop/src/app/chat/composer/queue-panel.test.tsx` | describe('QueuePanel expandable previews', () => { — it('offers expansion for long and multiline entries but not short ones', async () => { |
| `apps/desktop/src/app/chat/composer/queue-panel.tsx` | Exports `QueuePanel`. |
| `apps/desktop/src/app/chat/composer/queue-scope.test.tsx` | it('a new chat does not show the queue of the session just left (#139190)', async () => { |
| `apps/desktop/src/app/chat/composer/queue-slot.test.tsx` | it('Delete on a server-queued card cancels its admission at the authority', async () => { — it('a server-queued card shows the Steer and Edit its owner serves, and never Next (RT-35)', async () => { |
| `apps/desktop/src/app/chat/composer/queue-slot.tsx` | Exports `ComposerQueueSlotInputs, useComposerQueueScopeKey, renderComposerQueueSlot`. |
| `apps/desktop/src/app/chat/composer/reasoning-pill.test.tsx` | describe('ReasoningPill', () => { — it('shows a clamped pick as what the route sends, never as a distinct level (#61634)', () => { |
| `apps/desktop/src/app/chat/composer/reasoning-pill.tsx` | Exports `ReasoningPill`. |
| `apps/desktop/src/app/chat/composer/restored-draft-notice.tsx` | Exports `RestoredDraftNotice`. |
| `apps/desktop/src/app/chat/composer/rich-editor.test.ts` | describe('renderComposerContents', () => { — it('renders refs and raw text without interpreting user text as HTML', () => { |
| `apps/desktop/src/app/chat/composer/rich-editor.ts` | Helpers for the contenteditable composer surface: serialize refs to chip * HTML, walk the DOM back to plain `@kind:value` text, and place the caret. |
| `apps/desktop/src/app/chat/composer/scope.tsx` | COMPOSER SCOPE — which live composer a ChatBar instance IS. |
| `apps/desktop/src/app/chat/composer/send-click-stale-gate.test.tsx` | describe('composer Send button — pointerdown syncs the live draft (#52950)', () => { — it('opens the send gate synchronously on pointerdown when the DOM has text state has not synced', async () => { |
| `apps/desktop/src/app/chat/composer/slash-refs.test.ts` | describe('slashCommandMatches', () => { — it('recognizes a leading command and a skill named mid-prose', () => { |
| `apps/desktop/src/app/chat/composer/slash-refs.ts` | Slash-command recognition for text the composer did not watch being typed — * a paste, a restored draft, an undo step, a rebuilt line. |
| `apps/desktop/src/app/chat/composer/start-voice-button.tsx` | The primary "start voice conversation" button, with the engine picker one * click away when the layout shows the voice controls unfolded. |
| `apps/desktop/src/app/chat/composer/status-stack/coding-row.test.tsx` | describe('CodingStatusRow', () => { — it('opens the review pane from the branch and the diff counts, never the bar itself', () => { |
| `apps/desktop/src/app/chat/composer/status-stack/coding-row.tsx` | Exports `CodingStatusRow`. |
| `apps/desktop/src/app/chat/composer/status-stack/collapsed-indicator.test.tsx` | describe('ComposerStatusStack collapsed todo indicator', () => { — it('shows a running indicator next to the collapsed todo label', () => { |
| `apps/desktop/src/app/chat/composer/status-stack/default-collapse.test.tsx` | it('offers a collapsed read-only checklist from an idle session, without a running spinner', () => { — it('auto-expands only todos and keeps other groups closed as activity arrives', () => { |
| `apps/desktop/src/app/chat/composer/status-stack/drawer.css` | .status-drawer { display: grid; grid-template-rows: 1fr; /* Quick lift, then a soft landing. */ transition: grid-template-rows 260ms cubic-bezier(0.16, 1, 0.3, 1); |
| `apps/desktop/src/app/chat/composer/status-stack/drawer.tsx` | Exports `StatusDrawerContent, StatusDrawerToggle`. |
| `apps/desktop/src/app/chat/composer/status-stack/goal-indicator.test.tsx` | describe('ComposerStatusStack goal indicator', () => { — it('shows an active goal with its title', () => { |
| `apps/desktop/src/app/chat/composer/status-stack/hidden-pane-subagent-polls.test.tsx` | describe('hidden-pane subagent polls', () => { — it('hidden snapshot tile issues no subagent.list; reveal seeds once and polls every 5s; hiding again stops it', async () => { |
| `apps/desktop/src/app/chat/composer/status-stack/index.tsx` | Exports `ComposerStatusStack`. |
| `apps/desktop/src/app/chat/composer/status-stack/polling-guard.test.tsx` | describe('ComposerStatusStack dead-runtime remount', () => { — it('does not re-poll process.list after a remount once the session is latched gone', async () => { |
| `apps/desktop/src/app/chat/composer/status-stack/preview-order.test.tsx` | Test file (no top-level title found). |
| `apps/desktop/src/app/chat/composer/status-stack/preview-row.test.tsx` | describe('PreviewStatusRow', () => { — it('opens remote non-HTML file artifacts in the in-app preview instead of the local browser bridge', async () => { |
| `apps/desktop/src/app/chat/composer/status-stack/preview-row.tsx` | Exports `PreviewStatusRow`. |
| `apps/desktop/src/app/chat/composer/status-stack/session-control-goal.tsx` | Exports `SessionControlGoalSection`. |
| `apps/desktop/src/app/chat/composer/status-stack/session-control-heartbeat.test.tsx` | describe('SessionControlHeartbeatSection hidden-pane clock', () => { — it('a mounted card pauses while its pane is hidden and catches up the moment it is shown', async () => { |
| `apps/desktop/src/app/chat/composer/status-stack/session-control.test.tsx` | describe('ComposerStatusStack session-control UI', () => { — it('calls refreshSessionControl on mount and keeps legacy goal while capability is unknown/unsupported', () => { |
| `apps/desktop/src/app/chat/composer/status-stack/session-control.tsx` | Exports `SessionControlSectionsProps, SessionControlSections`. |
| `apps/desktop/src/app/chat/composer/status-stack/status-row.tsx` | Exports `StatusItemRow`. |
| `apps/desktop/src/app/chat/composer/status-stack/subagent-controls.test.tsx` | it('sends steer and stop to the child parent owner, never the active gateway or child transcript', async () => { — it('keeps rejected steer text and does not retarget when the owner is unknown', asyn… |
| `apps/desktop/src/app/chat/composer/status-stack/subagent-controls.tsx` | Exports `SubagentControls`. |
| `apps/desktop/src/app/chat/composer/status-stack/subagent-hydration.test.tsx` | it('hydrates the empty owner composer and exposes an extended owner-routed transcript without leaking on session change', async () => { — it('does not resurrect a child completed while the roster sna… |
| `apps/desktop/src/app/chat/composer/status-stack/subagent-lifecycle.test.tsx` | it('keeps each worker draft while inspecting siblings and removes settled selection', () => { — it('measures detail elapsed from worker start rather than first inspection', () => { |
| `apps/desktop/src/app/chat/composer/status-stack/subagent-section.test.tsx` | it('shows live work only from the composer session and keeps it hidden after collapse and progress', () => { — it('collapses a single worker and its selected detail using the caret, preserving the st… |
| `apps/desktop/src/app/chat/composer/status-stack/subagent-section.tsx` | Exports `SubagentSection`. |
| `apps/desktop/src/app/chat/composer/status-stack/subagent-transcript.tsx` | Exports `SubagentTranscript`. |
| `apps/desktop/src/app/chat/composer/status-stack/use-subagent-snapshot.ts` | Exports `rejectUnownedSubagentRequest, useSubagentSnapshot`. |
| `apps/desktop/src/app/chat/composer/test-utils.ts` | Collapse the selection to the end of the editor's contents. |
| `apps/desktop/src/app/chat/composer/text-utils.test.ts` | describe('detectTrigger', () => { — it('detects a bare slash trigger with an empty query', () => { |
| `apps/desktop/src/app/chat/composer/text-utils.ts` | True for a `/` typed mid-message — an inline skill/command reference in * prose rather than a command invocation. Arg completion doesn't apply. |
| `apps/desktop/src/app/chat/composer/trigger-popover-description.test.tsx` | it('reveals the complete slash description on hover without intercepting selection', async () => { |
| `apps/desktop/src/app/chat/composer/trigger-popover.test.tsx` | describe('ComposerTriggerPopover keyboard scrolling', () => { — it('keeps keyboard navigation visible and restores the group header on wrap', () => { |
| `apps/desktop/src/app/chat/composer/trigger-popover.tsx` | Exports `ComposerTriggerPopover`. |
| `apps/desktop/src/app/chat/composer/types.ts` | Exports `ContextSuggestion, QuickModelOption, ChatBarState, ChatBarProps, VoiceStatus, VoiceActivityState`. |
| `apps/desktop/src/app/chat/composer/undo-cut-drag.test.tsx` | describe('main composer undo — cut and drag coverage', () => { — it('undo restores text removed by a cut', async () => { |
| `apps/desktop/src/app/chat/composer/undo-history.test.ts` | describe('undo/redo shortcut recognition', () => { — it('claims Cmd+Z and Ctrl+Z as undo, but not with Shift or Alt', () => { |
| `apps/desktop/src/app/chat/composer/undo-history.ts` | The composer's own undo stack. * * The rich editor mutates its DOM through `Range` rather than the browser's * editing commands — `execCommand('insertText')` is ~O(n²) on large multiline * … |
| `apps/desktop/src/app/chat/composer/url-dialog.tsx` | Exports `UrlDialog`. |
| `apps/desktop/src/app/chat/composer/url-refs.test.ts` | describe('linkifyUrls', () => { — it('rewrites a bare link as a url directive', () => { |
| `apps/desktop/src/app/chat/composer/url-refs.ts` | Bare-link recognition for the composer. A link the user pastes or types is the * same thing the "+ → Add URL" dialog inserts, so it becomes an `@url:` * directive: a chip that truncates ins… |
| `apps/desktop/src/app/chat/composer/visibility.ts` | Editor visibility is narrower than chat visibility while a shared float is * active. Background queues and explicit session actions still belong to the pane. |
| `apps/desktop/src/app/chat/composer/voice-activity.test.tsx` | describe('VoiceActivity accessibility', () => { — it('keeps the dictation timer visible without announcing every tick', () => { |
| `apps/desktop/src/app/chat/composer/voice-activity.tsx` | Exports `VoiceActivity, VoicePlaybackActivity`. |
| `apps/desktop/src/app/chat/composer/voice-engine-rows.tsx` | Exports `VoiceEngineRows, useVoiceEngineName`. |
| `apps/desktop/src/app/chat/composer/voice-fan.tsx` | Exports `VoiceFanProps, VoiceFan`. |
| `apps/desktop/src/app/chat/composer/voice-menu.tsx` | Exports `VoiceMenuProps, VoiceMenu`. |
| `apps/desktop/src/app/chat/history-window.test.tsx` | describe('bounded direct history runtime', () => { — it('reads one around page and selects it without replacing the live store', async () => { |
| `apps/desktop/src/app/chat/history-window.ts` | Exports `HISTORY_WINDOW_LIMIT, HistoryWindowResponse, fetchHistoryWindow, useHistoryWindow`. |
| `apps/desktop/src/app/chat/hooks/use-composer-actions.test.ts` | describe('partitionDroppedFiles', () => { — it('routes File-bearing OS drops to osDrops and path-only in-app drags to inAppRefs', () => { |
| `apps/desktop/src/app/chat/hooks/use-composer-actions.ts` | Exports `isImagePath, attachmentPreviewDataUrl, resolveImageAttachmentPreview, DroppedFile, HERMES_PATHS_MIME, extractDroppedFiles`. |
| `apps/desktop/src/app/chat/hooks/use-file-drop-zone.ts` | `'session'` is set by callers from the pointer drag session's store — * native drags only ever resolve to `'files'` here (sessions left native * DnD; see session-drag.ts). |
| `apps/desktop/src/app/chat/index.test.tsx` | describe('ChatView render isolation', () => { — it('does not re-render chat history when an unrelated parent idle tick updates', () => { |
| `apps/desktop/src/app/chat/index.tsx` | Exports `ChatRuntimeBoundary, ChatView`. |
| `apps/desktop/src/app/chat/intro-visibility.test.ts` | describe('shouldShowIntro', () => { — it('shows on a fresh draft in the primary window', () => { |
| `apps/desktop/src/app/chat/intro-visibility.ts` | Whether the empty-chat intro splash renders. * * The splash is the full-height empty state of the primary chat: it belongs to * a fresh draft in the main window and nothing else. |
| `apps/desktop/src/app/chat/new-session-drag.test.ts` | describe('startNewSessionDrag', () => { — it('advertises the distinct NEW_SESSION_DRAG sentinel on engage', () => { |
| `apps/desktop/src/app/chat/new-session-drag.ts` | Sidebar "New session" drag — the NEW-session resolver over the shared * pointer drag session (pane-shell drag-session.ts). |
| `apps/desktop/src/app/chat/pane-mirror.ts` | Mirror a reactive list of "tiles" into layout-tree pane contributions: * register a pane per tile, refresh its title in place, and dispose panes whose * tile is gone. |
| `apps/desktop/src/app/chat/perf-probe.tsx` | Exports `PerfProbe`. |
| `apps/desktop/src/app/chat/pr-tag.tsx` | // GitHub's own colour language, mapped onto our tokens: open is the "go" green, // merged the purple everyone reads as landed, draft and closed muted since // neither is waiting on you. |
| `apps/desktop/src/app/chat/preview-error-close.test.tsx` | describe('a preview whose file is gone', () => { — it('offers Close in the error state, and it closes the tab', async () => { |
| `apps/desktop/src/app/chat/preview-session-focus.test.ts` | it('settles session-owned preview reveals in the same group without losing chat ownership', () => { |
| `apps/desktop/src/app/chat/preview-tab-pin-menu.test.tsx` | it('offers Unpin after a pin and Pin after an unpin, toggling the stored flag each time', () => { |
| `apps/desktop/src/app/chat/preview-tile-live-body.test.tsx` | it("keeps a hidden session's live Browser body alive and shows the same one on return", () => { |
| `apps/desktop/src/app/chat/preview-tile.test.ts` | describe('browserTabLabel', () => { — it('names the tab after the page', () => { |
| `apps/desktop/src/app/chat/preview-tile.tsx` | PREVIEW TILES — every open preview (a file, a URL, an artifact) rendered as a * layout-tree pane, the preview analog of session and route tiles. |
| `apps/desktop/src/app/chat/profile-tag.tsx` | Owning-profile chip: the shared {@link ProfileGlyph}, resolved against the * live profile colors and labelled with the full name. |
| `apps/desktop/src/app/chat/resume-exhausted-overlay.test.tsx` | describe('stranded resume overlay escape (#106217)', () => { — it('offers Start new session next to Retry instead of a retry-only dead end', async () => { |
| `apps/desktop/src/app/chat/resume-exhausted-overlay.tsx` | // Full-window fallback for a routed session whose resume exhausted every // retry (#106217 remainder). |
| `apps/desktop/src/app/chat/right-rail/index.ts` | e |
| `apps/desktop/src/app/chat/right-rail/preview-act.test.ts` | describe('actOnActivePreview (drive_preview tool)', () => { — it('tells the agent to open a page when no live pane is behind the tab', async () => { |
| `apps/desktop/src/app/chat/right-rail/preview-act.ts` | PREVIEW ACT — performs the agent's interactions inside the preview pane's * guest page, so `drive_preview` drives whatever web app is open in the in-app * browser. |
| `apps/desktop/src/app/chat/right-rail/preview-active-tab.ts` | THE PREVIEW AN AGENT TOOL ACTS ON — one resolution shared by read_preview * (preview-reader.ts), drive_preview (the nav / input / script-runner * registries) and the preview tour, so a read… |
| `apps/desktop/src/app/chat/right-rail/preview-annotate-card.test.tsx` | describe('placeAnnotateCard', () => { — it('sits to the right of the pin instead of past a full-width selection', () => { |
| `apps/desktop/src/app/chat/right-rail/preview-annotate-card.tsx` | Exports `placeAnnotateCard, PreviewAnnotateCard`. |
| `apps/desktop/src/app/chat/right-rail/preview-annotate-host.test.ts` | describe('preview annotate host', () => { — it('does not evaluate guest template interpolations while wrapping the overlay source', () => { |
| `apps/desktop/src/app/chat/right-rail/preview-annotate-host.ts` | Drive the guest overlay and crop capture from the preview pane. * Overlay I/O only — stack/pack/flush live in lib/preview-annotate. |
| `apps/desktop/src/app/chat/right-rail/preview-artifact.test.tsx` | describe('ArtifactPreview', () => { — it('renders html in a scripts-only sandboxed frame the parent app is unreachable from', async () => { |
| `apps/desktop/src/app/chat/right-rail/preview-artifact.tsx` | Exports `ArtifactPreview`. |
| `apps/desktop/src/app/chat/right-rail/preview-browser-bar.test.tsx` | describe('normalizePreviewAddress', () => { — it('passes through http and https URLs', () => { |
| `apps/desktop/src/app/chat/right-rail/preview-browser-bar.tsx` | BROWSER BAR: back / forward / reload / address / pop-out (or pop-in) for a * URL preview. |
| `apps/desktop/src/app/chat/right-rail/preview-console-state.test.ts` | describe('preview console retention', () => { — it('truncates one oversized message and source before retaining them', () => { |
| `apps/desktop/src/app/chat/right-rail/preview-console-state.ts` | Exports `PREVIEW_CONSOLE_MAX_ENTRIES, PREVIEW_CONSOLE_MAX_MESSAGE_CHARS, PREVIEW_CONSOLE_MAX_SOURCE_CHARS, PREVIEW_CONSOLE_MAX_TOTAL_CHARS, ConsoleEntry, ConsoleEntryInput`. |
| `apps/desktop/src/app/chat/right-rail/preview-console-store.ts` | Per-tab preview console stores. * * The console panel lives in the pane and its toggle lives in the pane's * browser bar, but the store has to outlive any one render and be addressable * by… |
| `apps/desktop/src/app/chat/right-rail/preview-console.tsx` | Exports `compactUrl, formatLogLine, formatConsoleEntries, isNearConsoleBottom, clampConsoleHeight, PreviewConsolePanel`. |
| `apps/desktop/src/app/chat/right-rail/preview-drive.ts` | PREVIEW DRIVE — the agent's hand on the mouse and keyboard. |
| `apps/desktop/src/app/chat/right-rail/preview-file-save-scope.test.tsx` | Test file (no top-level title found). |
| `apps/desktop/src/app/chat/right-rail/preview-file.test.tsx` | describe('MarkdownPreview', () => { — it('renders block and inline math through KaTeX', () => { |
| `apps/desktop/src/app/chat/right-rail/preview-file.tsx` | Exports `PreviewEmptyState, MarkdownPreview, PreviewModeSwitcher, SourceView, PreviewViewMode, LocalFilePreview`. |
| `apps/desktop/src/app/chat/right-rail/preview-guest-offscreen.ts` | A Browser guest that is mounted but OFF SCREEN — an inactive tab, a * collapsed side, or a hidden session's kept-alive page — must not act like * the page the user is on. |
| `apps/desktop/src/app/chat/right-rail/preview-input.test.ts` | describe('toWebviewInputSpace', () => { — it("scales pointer events by the guest zoom so the reporter's 500,310 target is hit at 90 %", () => { |
| `apps/desktop/src/app/chat/right-rail/preview-input.ts` | PREVIEW INPUT REGISTRY — real input into the preview pane's guest page, the * difference between the agent DRIVING the browser and merely poking its DOM. |
| `apps/desktop/src/app/chat/right-rail/preview-mind.ts` | IDLE PULSE — keeps the preview overlay alive while the model reasons. |
| `apps/desktop/src/app/chat/right-rail/preview-nav.test.ts` | describe('commandFocusedPreview', () => { — it('never routes host keyboard commands to a hidden guest with stale native focus', () => { |
| `apps/desktop/src/app/chat/right-rail/preview-nav.ts` | Browser gestures that land on the app's own chrome — ⌘R with the address bar * focused, a mouse's back/forward buttons over the pane's frame. |
| `apps/desktop/src/app/chat/right-rail/preview-nudge.ts` | OVERLAY NUDGE — the one way to say a stage to an overlay that is ALREADY on * the page. |
| `apps/desktop/src/app/chat/right-rail/preview-pane.test.tsx` | describe('PreviewPane console state', () => { — it('does not watch backend-only remote filesystem previews locally', async () => { |
| `apps/desktop/src/app/chat/right-rail/preview-pane.tsx` | // Side-effect import: watches the turn edge so the overlay keeps a pulse while // the model reasons. Lives here because the pane is what makes it reachable. |
| `apps/desktop/src/app/chat/right-rail/preview-popout-bridge.test.ts` | describe('preview pop-out bridge', () => { — it('reports a live surface when a script runner is registered', { timeout: 60_000 }, async () => { |
| `apps/desktop/src/app/chat/right-rail/preview-popout-bridge.ts` | Cross-window bridge for the popped-out Browser. |
| `apps/desktop/src/app/chat/right-rail/preview-reader.test.ts` | describe('readActivePreview (read_preview tool)', () => { — it('answers null when nothing is open, so the tool reports it cleanly', async () => { |
| `apps/desktop/src/app/chat/right-rail/preview-reader.ts` | PREVIEW READER — the read_preview tool's window into the preview pane, the * preview analog of the terminal's buffer registry (see right-sidebar/ * terminal/buffer.ts). |
| `apps/desktop/src/app/chat/right-rail/preview-script-runner.ts` | PREVIEW SCRIPT RUNNER REGISTRY — the one way anything in the app reaches into * the preview pane's guest page, the script analog of preview-nav's handle * registry. |
| `apps/desktop/src/app/chat/right-rail/preview-tour.ts` | PREVIEW TOUR — runs tour actions inside the preview pane's guest page, so a * tour can walk through ANY web app open in the in-app browser, not just * Hermes itself. |
| `apps/desktop/src/app/chat/right-rail/preview-typing-abort.ts` | PREVIEW TYPING ABORT — the keystroke loop outlives the tool that started it. * * `drive_preview` blocks on `preview.act` for 45s. |
| `apps/desktop/src/app/chat/right-rail/preview.tsx` | Exports `PreviewTilePane`. |
| `apps/desktop/src/app/chat/right-rail/real-profile-consent-dialog.test.tsx` | describe('shouldOfferRealProfilePrompt', () => { — it('offers the prompt for a local backend with the feature off', () => { |
| `apps/desktop/src/app/chat/right-rail/real-profile-consent-dialog.tsx` | Exports `shouldOfferRealProfilePrompt, RealProfileConsentDialog`. |
| `apps/desktop/src/app/chat/route-session-state.test.ts` | describe('isRouteSessionMismatch', () => { — it('keeps the composer mounted when auto-compression rotates root to tip', () => { |
| `apps/desktop/src/app/chat/route-session-state.ts` | Exports `isRouteSessionMismatch`. |
| `apps/desktop/src/app/chat/route-tile-reactivity.test.tsx` | describe('RouteTilePane route-contribution reactivity (#109063)', () => { — it('mounts a plugin page whose route registers after the pane', () => { |
| `apps/desktop/src/app/chat/route-tile-title.test.tsx` | it('refreshes the tile title when its route registers after the tile opened', () => { |
| `apps/desktop/src/app/chat/route-tile.tsx` | ROUTE (PAGE) TILES — a full-page view rendered as a layout-tree pane BESIDE * the main thread, the page analog of session tiles. |
| `apps/desktop/src/app/chat/runtime-backfill.test.tsx` | describe('runtime older-page expansion', () => { |
| `apps/desktop/src/app/chat/runtime-repository.test.ts` | describe('useRuntimeMessageRepository', () => { — it('emits each id once when the transcript repeats one', () => { |
| `apps/desktop/src/app/chat/runtime-repository.ts` | // The exact fallback status ExportedMessageRepository.fromBranchableArray uses. |
| `apps/desktop/src/app/chat/scroll-to-bottom-button.test.tsx` | describe('ScrollToBottomButton', () => { — it('isolates pre-runtime panes using their existing composer surface identity', () => { |
| `apps/desktop/src/app/chat/scroll-to-bottom-button.tsx` | Exports `ScrollToBottomButton`. |
| `apps/desktop/src/app/chat/session-draft-title.tsx` | The draft's composer key — a tile's stored session id, or null for the * new chat that has no session yet. |
| `apps/desktop/src/app/chat/session-drag.test.ts` | describe('session drop targeting across stacked tabs', () => { — it('links into the visible tab’s composer, not the tab kept alive behind it', () => { |
| `apps/desktop/src/app/chat/session-drag.ts` | Sidebar session drag — the session RESOLVER over the shared pointer drag * session (pane-shell drag-session.ts). |
| `apps/desktop/src/app/chat/session-status-dot.tsx` | // A pure lookup table: each state maps to its className, aria-label, and title. // No priority resolution here — $sessionDotStateById already picked one. |
| `apps/desktop/src/app/chat/session-tile-actions.test.ts` | describe('session tile optimistic owner metadata', () => { — it('never lists a bots-workspace tile — hidden relationship chats stay off the Sessions list (#113273)', () => { |
| `apps/desktop/src/app/chat/session-tile-actions.ts` | Prompt actions for a SESSION TILE — the same verbs the primary chat wires * (submit incl. |
| `apps/desktop/src/app/chat/session-tile-attachments.test.tsx` | describe('session tile attachment occurrence ownership', () => { — it('preserves a thumbnail that resolves before tile submit staging', async () => { |
| `apps/desktop/src/app/chat/session-tile-owner.test.ts` | describe('tileOwnerRoute', () => { — it('prefers the tile own explicit route', () => { |
| `apps/desktop/src/app/chat/session-tile-owner.ts` | The owner a session tile routes its own RPCs through — the tile's explicit * route first, then the session row's `(connection, profile)` tag, with * `knownSessionOwner` folding in the owner… |
| `apps/desktop/src/app/chat/session-tile-row.test.ts` | describe('listTileSessionRow', () => { — it("lists an unlisted ⌘T tab from the user's first message", () => { |
| `apps/desktop/src/app/chat/session-tile-slice-title.test.ts` | describe('tileStoredRow resolves across every sidebar slice', () => { — it('resolves a local recents row', () => { |
| `apps/desktop/src/app/chat/session-tile.test.ts` | describe('shouldResumeSessionTile', () => { — it('resumes an unbound tile once the gateway is open', () => { |
| `apps/desktop/src/app/chat/session-tile.tsx` | SESSION TILES — a stored session rendered as a layout-tree pane BESIDE the * main thread (multi-session tiling). |
| `apps/desktop/src/app/chat/session-view.test.ts` | describe('primary session view reads its own session slice', () => { — it('shows the active session transcript, not a background session still streaming', () => { |
| `apps/desktop/src/app/chat/session-view.tsx` | Exports `SessionView, reasoningEffortPending, PRIMARY_SESSION_VIEW, SessionViewProvider, useSessionView`. |
| `apps/desktop/src/app/chat/short-session-hang-repro.tsx` | const HEARTBEAT_INTERVAL_MS = 100 const PAINT_VALIDATION_TIMEOUT_MS = 5_000 interface HeartbeatSample { at: number |
| `apps/desktop/src/app/chat/sidebar/archive-copy.test.ts` | describe('archived-session instructions', () => { — it('advertises modifiers that archive rather than open a tab in every locale', () => { |
| `apps/desktop/src/app/chat/sidebar/chat-sidebar.integration.test.tsx` | describe('ChatSidebar navigation activity', () => { — it('keeps navigation and session activity coherent with the focused pane', () => { |
| `apps/desktop/src/app/chat/sidebar/chrome-section-add-button.test.tsx` | describe('SidebarSectionAddButton', () => { — it('keeps a sub-threshold press an ordinary new-session click', () => { |
| `apps/desktop/src/app/chat/sidebar/chrome.tsx` | Exports `SidebarSectionMeta, SidebarSectionAddButton, SidebarRowStack, SidebarRowNest, SidebarDateDivider, SidebarRowShell`. |
| `apps/desktop/src/app/chat/sidebar/connection-glyph.tsx` | // One glyph per connection kind — device, cloud, network, terminal — shared by // the statusbar switcher, its menu, the fleet profile rail and the Bots rail so // a gateway looks the same … |
| `apps/desktop/src/app/chat/sidebar/connection-switcher.test.tsx` | describe('ConnectionSwitcher', () => { — it('adds no source chrome for a local-only setup', () => { |
| `apps/desktop/src/app/chat/sidebar/connection-switcher.tsx` | Exports `ConnectionSwitcher`. |
| `apps/desktop/src/app/chat/sidebar/cron-jobs-section.test.tsx` | describe('SidebarCronJobsSection run rows', () => { — it('opens a run with the run ROW so the resume can pin its owning backend', async () => { |
| `apps/desktop/src/app/chat/sidebar/filter-menu.test.tsx` | it('translates the live filter menu while preserving selected values and the current grouping order', async () => { |
| `apps/desktop/src/app/chat/sidebar/filter-menu.tsx` | Exports `SidebarFilterMenu`. |
| `apps/desktop/src/app/chat/sidebar/fleet-gateway-menu-group.tsx` | Exports `FleetGatewayMenuGroup`. |
| `apps/desktop/src/app/chat/sidebar/fleet-rail.test.ts` | describe('buildRestGroups', () => { — it('lists every gateway except the active one, in switcher order, regardless of which is active', () => { |
| `apps/desktop/src/app/chat/sidebar/fleet-rail.ts` | // Pure grouping for the fleet profile rail: which gateways sit "at rest" // beside the active one, and which agents each of them carries. |
| `apps/desktop/src/app/chat/sidebar/gateway-group-model.test.ts` | describe('buildGatewaySessionGroups', () => { — it('keys groups by exact owner, so one profile name on two gateways stays two groups', () => { |
| `apps/desktop/src/app/chat/sidebar/gateway-group-model.ts` | One group per exact owner `[connectionId, profile]`. Group identity never * depends on a mutable label, URL, or the active gateway. |
| `apps/desktop/src/app/chat/sidebar/gateway-group-preferences.test.ts` | it('persists identity-scoped edits and reorders newly discovered groups without forgetting hidden groups', async () => { |
| `apps/desktop/src/app/chat/sidebar/gateway-group-preferences.ts` | Exports `renameGatewayGroup, reorderGatewayGroups, toggleGatewayGroup`. |
| `apps/desktop/src/app/chat/sidebar/gateway-groups-drag.test.tsx` | it('arms the reorder from a pointer press on the header label', async () => { — it('reorders gateway sections from the grabber by keyboard', async () => { |
| `apps/desktop/src/app/chat/sidebar/gateway-groups.test.tsx` | it('keeps equal profile names on separate gateways and routes section creation and row navigation to their owner', () => { |
| `apps/desktop/src/app/chat/sidebar/gateway-groups.tsx` | Exports `GatewayProfileGroups`. |
| `apps/desktop/src/app/chat/sidebar/index.tsx` | Exports `stripFtsMarkers, searchResultToSession, mergeSearchResults, ChatSidebar`. |
| `apps/desktop/src/app/chat/sidebar/load-more-row.test.tsx` | describe('SidebarLoadMoreRow', () => { — it('still fires onClick (Tip does not intercept the trigger interaction)', () => { |
| `apps/desktop/src/app/chat/sidebar/load-more-row.tsx` | Exports `SidebarLoadMoreRow`. |
| `apps/desktop/src/app/chat/sidebar/local-device-switch.tsx` | Resolve whether This device would install, without starting the installer. * Missing bridge fails closed: a click must not reach runBootstrap unseen. |
| `apps/desktop/src/app/chat/sidebar/order.test.ts` | describe('resolveManualSessionOrderIds', () => { — it('clears legacy auto-seeded order until the user manually reorders sessions', () => { |
| `apps/desktop/src/app/chat/sidebar/order.ts` | Fold ids absent from the persisted order back in, on the side they belong. |
| `apps/desktop/src/app/chat/sidebar/profile-dropdown-switcher.test.tsx` | it('switches profiles from the statusbar dropdown while the rail is hidden', async () => { |
| `apps/desktop/src/app/chat/sidebar/profile-dropdown-switcher.tsx` | Exports `ProfileSwitcher`. |
| `apps/desktop/src/app/chat/sidebar/profile-launch-menu.test.tsx` | it('opens the clicked canonical route without selecting it and saves only that route as default', async () => { — it('distinguishes the same profile on another source and reports a rejected default w… |
| `apps/desktop/src/app/chat/sidebar/profile-launch-menu.tsx` | Exports `ProfileLaunchMenuItems, ProfileLaunchContextMenu, ProfileLaunchMenuSection`. |
| `apps/desktop/src/app/chat/sidebar/profile-rail-connect.test.tsx` | describe('ProfileRail multi-gateway entry point', () => { — it('deep-links to the unified Settings → Gateways page from the rail', () => { |
| `apps/desktop/src/app/chat/sidebar/profile-rail-fleet.test.tsx` | describe('ProfileRail overflow', () => { — it('marks only clipped edges and leaves create/import outside the scrolling profiles', () => { |
| `apps/desktop/src/app/chat/sidebar/profile-rail-status.test.tsx` | describe('ProfileRail per-profile status (#91710)', () => { — it('marks an inactive profile square unread and names the count accessibly', () => { |
| `apps/desktop/src/app/chat/sidebar/profile-remote-override-dialog.test.tsx` | describe('ProfileRemoteOverrideDialog', () => { — it('walks the first-time connect through the risk confirmation before writing', async () => { |
| `apps/desktop/src/app/chat/sidebar/profile-remote-override-dialog.tsx` | Exports `ProfileRemoteOverrideDialog`. |
| `apps/desktop/src/app/chat/sidebar/profile-scope.test.ts` | describe('filterSessionsByProfileScope', () => { — it('keeps only rows from the selected profile', () => { |
| `apps/desktop/src/app/chat/sidebar/profile-scope.ts` | Sessions visible in one sidebar profile scope. |
| `apps/desktop/src/app/chat/sidebar/profile-switcher.tsx` | Exports `ProfileRail`. |
| `apps/desktop/src/app/chat/sidebar/project-dialog.test.tsx` | describe('ProjectDialog', () => { — it('creates from the folder basename and enters the created project when the name is empty', async () => { |
| `apps/desktop/src/app/chat/sidebar/project-dialog.tsx` | Exports `ProjectDialog`. |
| `apps/desktop/src/app/chat/sidebar/project-filter.test.ts` | describe('resolveLiveProjectFilter', () => { — it('returns the filter unchanged when it is empty', () => { |
| `apps/desktop/src/app/chat/sidebar/project-filter.ts` | Narrow the persisted sidebar project filter to ids the ACTIVE tree resolves. |
| `apps/desktop/src/app/chat/sidebar/projects/base-branch-picker.test.tsx` | describe('BaseBranchPicker loading', () => { — it('a list from the previous repo does not set the base of the next', async () => { |
| `apps/desktop/src/app/chat/sidebar/projects/base-branch-picker.tsx` | Exports `BaseBranchPicker`. |
| `apps/desktop/src/app/chat/sidebar/projects/entered-content.tsx` | Exports `EnteredProjectContent`. |
| `apps/desktop/src/app/chat/sidebar/projects/index.ts` | // Public surface of the project/worktree sidebar, consumed by the sidebar root. |
| `apps/desktop/src/app/chat/sidebar/projects/model.test.ts` | describe('orderProjectsByIds', () => { — it('leaves the deterministic sort alone when nothing has been dragged', () => { |
| `apps/desktop/src/app/chat/sidebar/projects/model.ts` | // Page size when revealing more already-loaded rows within a workspace group. |
| `apps/desktop/src/app/chat/sidebar/projects/overview-row.test.tsx` | describe('ProjectOverviewRow', () => { — it('does not render the disclosure toggle when there is nothing to preview', () => { |
| `apps/desktop/src/app/chat/sidebar/projects/overview-row.tsx` | Exports `projectIcon, ProjectBackRow, ProjectOverviewRow`. |
| `apps/desktop/src/app/chat/sidebar/projects/project-appearance.tsx` | // Curated codicons for a project glyph (tinted by the chosen color). |
| `apps/desktop/src/app/chat/sidebar/projects/project-menu.test.tsx` | describe('ProjectMenu', () => { — it('opens the appearance popover through the kebab trigger when anchorRef is absent', async () => { |
| `apps/desktop/src/app/chat/sidebar/projects/project-menu.tsx` | Exports `ProjectMenu, ProjectContextMenu`. |
| `apps/desktop/src/app/chat/sidebar/projects/workspace-group.tsx` | Exports `SidebarWorkspaceGroup`. |
| `apps/desktop/src/app/chat/sidebar/projects/workspace-groups.test.ts` | describe('baseName', () => { — it('returns the final path segment, ignoring trailing slashes and separators', () => { |
| `apps/desktop/src/app/chat/sidebar/projects/workspace-groups.ts` | // Session grouping is now computed authoritatively on the backend // (`tui_gateway/project_tree.py`, exposed via `projects.tree` / // `projects.project_sessions`). |
| `apps/desktop/src/app/chat/sidebar/projects/workspace-header.test.tsx` | describe('WorkspaceAddButton', () => { — it('still fires onClick', () => { |
| `apps/desktop/src/app/chat/sidebar/projects/workspace-header.tsx` | Exports `WorkspaceAddButton, WorkspaceShowMoreRow, WorkspaceShowMoreButton, WorkspaceMenu, WorkspaceContextMenu, StartWorkButton`. |
| `apps/desktop/src/app/chat/sidebar/projects/worktree-dialog.tsx` | Exports `WorktreeDialog`. |
| `apps/desktop/src/app/chat/sidebar/reorderable-list.tsx` | // Sidebar reordering is a strictly vertical list. |
| `apps/desktop/src/app/chat/sidebar/row-geometry.ts` | // The sidebar row's measurements, in one place. |
| `apps/desktop/src/app/chat/sidebar/search-result-to-session.test.ts` | describe('searchResultToSession', () => { — it('uses the backend-provided title for the synthesized row', () => { |
| `apps/desktop/src/app/chat/sidebar/search-results-order.test.ts` | describe('mergeSearchResults', () => { — it('keeps the exact-id server hit above newer client matches once the response lands', () => { |
| `apps/desktop/src/app/chat/sidebar/section-states.tsx` | // Stands in for session rows, so it borrows their chrome instead of copying // the grid — a placeholder on a different edge than the rows it resolves into // makes the list step sideways o… |
| `apps/desktop/src/app/chat/sidebar/session-actions-menu.test.ts` | describe('renameSessionPreferringRpc', () => { — it('renames the active branched session via the session.title RPC, not REST', async () => { |
| `apps/desktop/src/app/chat/sidebar/session-actions-menu.test.tsx` | describe('SessionActionsMenu', () => { — it('opens the dropdown on click', async () => { |
| `apps/desktop/src/app/chat/sidebar/session-actions-menu.tsx` | Exports `renameSessionPreferringRpc, SessionActionsMenu, SessionContextMenu`. |
| `apps/desktop/src/app/chat/sidebar/session-index.test.ts` | describe('buildSessionByAnyId', () => { — it('resolves a pin from every slice the sidebar fetches', () => { |
| `apps/desktop/src/app/chat/sidebar/session-index.ts` | Index sessions by every id a pin might be stored under. |
| `apps/desktop/src/app/chat/sidebar/session-row-actions.test.tsx` | describe('SidebarSessionRow actions', () => { — it('archives an Inbox card without also resuming it (#85163)', async () => { |
| `apps/desktop/src/app/chat/sidebar/session-row-details.test.ts` | describe('session row details', () => { — it('formats deterministic metadata without ambiguous call wording', () => { |
| `apps/desktop/src/app/chat/sidebar/session-row-details.ts` | Exports `SessionRowDetails, SessionRowFormatters, sessionRowEstimate, SESSION_CARD_ROW_ESTIMATE_PX, sessionRowDetails`. |
| `apps/desktop/src/app/chat/sidebar/session-row-gesture.test.ts` | describe('resolveSessionRowClick', () => { — it('resumes on a plain click', () => { |
| `apps/desktop/src/app/chat/sidebar/session-row-gesture.ts` | // Which action a left-click on a sidebar session row triggers, given the // modifier keys held. |
| `apps/desktop/src/app/chat/sidebar/session-row-rename-drag.test.tsx` | describe('SidebarSessionRow drag and the rename dialog (portal press)', () => { — it("ignores the dialog's own presses, so selecting the title cannot lift the row", async () => { |
| `apps/desktop/src/app/chat/sidebar/session-row-slots.tsx` | One row-decoration slot (leading / trailing) for `sessionId`. Mounts every * registration and lets each decide — it renders its decoration, or nothing at * all for rows it doesn't own. |
| `apps/desktop/src/app/chat/sidebar/session-row.test.tsx` | describe('SidebarSessionRow running arc', () => { — it('paints no arc for a settled session', () => { |
| `apps/desktop/src/app/chat/sidebar/session-row.tsx` | Exports `SidebarSessionRow`. |
| `apps/desktop/src/app/chat/sidebar/sessions-section-new-session-drag.test.tsx` | describe('Show all sessions', () => { — it('keeps the five-session page by default and renders every loaded workspace session when enabled', () => { |
| `apps/desktop/src/app/chat/sidebar/sessions-section.tsx` | Exports `VIRTUALIZE_THRESHOLD, SidebarSessionsSection`. |
| `apps/desktop/src/app/chat/sidebar/split-submenu.tsx` | Exports `SplitMenuKit, DROPDOWN_SPLIT_KIT, CONTEXT_SPLIT_KIT, SplitSubmenu`. |
| `apps/desktop/src/app/chat/sidebar/storage-corrupt-notice.test.tsx` | describe('SidebarStorageCorruptNotice', () => { — it('renders nothing while every store is healthy', () => { |
| `apps/desktop/src/app/chat/sidebar/strip-fts-markers.test.ts` | describe('stripFtsMarkers', () => { — it('strips highlight markers around the matched term', () => { |
| `apps/desktop/src/app/chat/sidebar/use-entered-project-sessions.test.ts` | it('refetches only when the entered project changes, and keeps an unchanged result', async () => { — it('ignores departed drill-ins and clears failure on retry', async () => { |
| `apps/desktop/src/app/chat/sidebar/use-entered-project-sessions.ts` | // The mounted drill-in owns its outcome. A global error flag lets a departed // project's slow failure overwrite the next project's successful load. |
| `apps/desktop/src/app/chat/sidebar/use-fleet-roster.test.tsx` | it('re-enumerates a roster that timed out while the local gateway was still booting', async () => { |
| `apps/desktop/src/app/chat/sidebar/use-fleet-roster.ts` | Keep the fleet roster fresh for the profile rail while more than one * gateway is registered: pull on mount, when the window regains focus or * visibility, immediately when the connection r… |
| `apps/desktop/src/app/chat/sidebar/use-profile-prewarm.test.ts` | describe('useProfilePrewarm (#100548 layout-only pointerenter)', () => { — it('does not spawn on pointerenter without a real pointer move (layout shift under a stationary cursor)', () => { |
| `apps/desktop/src/app/chat/sidebar/use-profile-prewarm.ts` | // Dwell before firing: long enough that sweeping the pointer across the rail // or a mixed-profile session list doesn't spawn a backend for every element // passed through, short enough to… |
| `apps/desktop/src/app/chat/sidebar/use-profile-rail-refresh-on-active.test.ts` | describe('useProfileRailRefreshOnActive', () => { — it('refreshes once on mount', () => { |
| `apps/desktop/src/app/chat/sidebar/use-profile-rail-refresh-on-active.ts` | Re-pull the running profile + list on mount, and again whenever the window * regains focus/visibility -- a profile created, deleted, or renamed by * another surface (Manage Profiles, anothe… |
| `apps/desktop/src/app/chat/sidebar/use-server-session-search.ts` | Exports `ServerSessionSearch, useServerSessionSearch`. |
| `apps/desktop/src/app/chat/sidebar/virtual-session-list.test.tsx` | describe('VirtualSessionList row measurement', () => { — it('re-measures when the density changes', () => { |
| `apps/desktop/src/app/chat/sidebar/virtual-session-list.tsx` | Exports `VirtualSessionListProps, VirtualSessionList`. |
| `apps/desktop/src/app/chat/surface-vars.test.ts` | describe('surface measured-height vars', () => { — it('publishes onto the owning surface, not the document root', () => { |
| `apps/desktop/src/app/chat/surface-vars.ts` | Measured-height CSS vars, scoped to one chat surface. |
| `apps/desktop/src/app/chat/thread-loading.test.ts` | describe('thread loading state', () => { — it('returns session when routed session is still hydrating', () => { |
| `apps/desktop/src/app/chat/thread-loading.ts` | Exports `ThreadLoadingState, lastVisibleMessageIsUser, threadLoadingState, composerStaysMounted, routedSessionIsLoading`. |
| `apps/desktop/src/app/chat/tile-zone-host.ts` | Zone eligibility for SESSION drops — the resolve-side half of the drop * contract shared with the zone overlay (hostsSessionDropTarget in * pane-shell/tree/store decides PAINT; this decides… |
| `apps/desktop/src/app/chat/tour-marker.ts` | `data-tour` handles for the chat surfaces — on the primary one only. * * A handle has to be UNIQUE in the document. |
| `apps/desktop/src/app/chat/transcript-backfill.test.ts` | describe('transcript tail bookkeeping', () => { — it('marks a full page as possibly truncated with the next offset', () => { |
| `apps/desktop/src/app/chat/transcript-backfill.tool-fold-graft.test.ts` | describe('refresh graft over a page that opens on a tool fold', () => { — it('is a fixed point when the window was hydrated from that same page', () => { |
| `apps/desktop/src/app/chat/transcript-backfill.ts` | ON-DEMAND OLDER-PAGE BACKFILL for the transcript window. * * Tail hydration (`getLatestSessionMessages`) loads only the newest page of a * session. *(read head 60)* |
| `apps/desktop/src/app/chat/transcript-fold-identity.test.ts` | it('keeps a cached fold when the fresh page represents only part of its sources', () => { — it('keeps unstored leading rows before the replacement fold', () => { |
| `apps/desktop/src/app/chat/transcript-retention.test.ts` | describe('boundRetainedTranscript', () => { — it('releases the persisted rows older than the window and its slack', () => { |
| `apps/desktop/src/app/chat/transcript-window-retention.test.ts` | describe('session transcript-window retention', () => { — it('weakly remembers a windowed source array without breaking warm slice reuse', () => { |
| `apps/desktop/src/app/chat/transcript-window.test.ts` | describe('selectTranscriptWindow', () => { — it('does not window a transcript that fits the budget', () => { |
| `apps/desktop/src/app/chat/use-chat-bar-state.ts` | Exports `useChatBarState`. |
| `apps/desktop/src/app/chat/use-transcript-retention.test.tsx` | describe('useTranscriptRetention — the store releases paged-through history', () => { — it('drops the rows older than the live window, then fetches them back on "Show earlier"', async () => { |
| `apps/desktop/src/app/chat/use-transcript-retention.ts` | Exports `useTranscriptRetention`. |
| `apps/desktop/src/app/command-center/delete-confirm.test.tsx` | describe('Command Center session delete confirmation (#99410)', () => { — it('does NOT delete on trash click alone — a confirm dialog appears instead', async () => { |
| `apps/desktop/src/app/command-center/index.tsx` | Exports `CommandCenterSection, CommandCenterView`. |
| `apps/desktop/src/app/command-center/maintenance.test.tsx` | describe('MaintenancePanel action tail', () => { — it('tails a second run of the same op', async () => { |
| `apps/desktop/src/app/command-center/maintenance.tsx` | Exports `MaintenancePanel`. |
| `apps/desktop/src/app/command-center/open-session.test.tsx` | describe('Command Center session open carries the row', () => { — it('passes the clicked ROW to onOpenSession, not a bare id', async () => { |
| `apps/desktop/src/app/command-palette/contrib.ts` | Command-palette contribution surface — `palette` data contributions become * rows in the ⌘K root list, same schema as every other area. |
| `apps/desktop/src/app/command-palette/highlight-watcher.test.tsx` | describe('HighlightWatcher', () => { — it('reports the highlight from the cmdk store in uncontrolled mode', () => { |
| `apps/desktop/src/app/command-palette/highlight-watcher.tsx` | Reports the cmdk highlight to the palette. * * cmdk calls the root `onValueChange` only in controlled mode (when the * `value` prop is set). |
| `apps/desktop/src/app/command-palette/index.tsx` | Exports `CommandPalette`. |
| `apps/desktop/src/app/command-palette/marketplace-theme-page.tsx` | Cmd-K "Install theme…" page. * * Browses the VS Code Marketplace for color themes: an empty query shows the * most-installed themes, typing runs a live (debounced) search against the * Mark… |
| `apps/desktop/src/app/command-palette/pet-palette-page.tsx` | Cmd-K "Pets…" page — browse the petdex gallery, adopt/switch, toggle off. * * A thin view over the `pet-gallery` store: it subscribes to the shared atoms * and calls the store's actions. |
| `apps/desktop/src/app/command-palette/status-row.tsx` | Centered loading / empty / error row for a Cmd-K page's result list. |
| `apps/desktop/src/app/context-menu/app-context-menu.test.tsx` | describe('resolveDomTarget', () => { — it('resolves an anchor and its href', () => { |
| `apps/desktop/src/app/context-menu/app-context-menu.tsx` | Exports `CONTEXT_MENU_SKIP_ATTR, AppContextMenu`. |
| `apps/desktop/src/app/context-menu/pane-context-menu.test.tsx` | it('the pane fallback serves clicked content without taking explicit or unrelated menus', async () => { |
| `apps/desktop/src/app/context-menu/shell-menu-items.tsx` | Bare right-click on app chrome: the window verbs (the old shell fallback). |
| `apps/desktop/src/app/context-menu/store.ts` | Spell-check facts for the open editable menu. |
| `apps/desktop/src/app/context-menu/target.ts` | What a right-click landed on, resolved from the DOM. * * One resolver so every surface agrees on ownership. |
| `apps/desktop/src/app/contrib/context.tsx` | The controller publishes its wired surfaces here; every registered pane * / chrome slot reads one back through `WiredPane`. |
| `apps/desktop/src/app/contrib/controller.tsx` | Exports `ContribController`. |
| `apps/desktop/src/app/contrib/dev/credits-notice-demo.ts` | // Dev-only: drive the credit-notice UX without a backend that can hit real // usage bands. |
| `apps/desktop/src/app/contrib/hooks/completed-reply-refresh.test.tsx` | it('keeps an idle Todo snapshot for review when post-turn history refresh clears the live panel', async () => { — it('retries an interrupted reconnect read once on idle, even before that read returns… |
| `apps/desktop/src/app/contrib/hooks/desktop-onboarding-metrics.test.ts` | describe('sign-in funnel from the offer', () => { — it('an offer the user signs in from and then cancels is a reach followed by a cancel', async () => { |
| `apps/desktop/src/app/contrib/hooks/desktop-onboarding-metrics.ts` | First-run funnel telemetry (hermes.desktop.onboarding). |
| `apps/desktop/src/app/contrib/hooks/folded-tool-turn-refresh.test.tsx` | it('keeps the settled live reply when the fold lacks one of its tool rounds', async () => { |
| `apps/desktop/src/app/contrib/hooks/live-status-reap.test.ts` | describe('rehydrateLiveSessionStatuses — reaping vanished runtimes', () => { — it('clears a working session that disappears from the live snapshot', () => { |
| `apps/desktop/src/app/contrib/hooks/live-status-spinner.test.ts` | describe('rehydrateLiveSessionStatuses — seeding a turn the renderer never saw start', () => { — it('shows the spinner for a turn that started with no stream events', () => { |
| `apps/desktop/src/app/contrib/hooks/notification-focus.test.tsx` | it('a native click reveals the existing remote Bot tab without changing its owner or duplicating main', () => { |
| `apps/desktop/src/app/contrib/hooks/remembered-session.test.ts` | describe('resolveRememberedSessionId', () => { — it('repairs a remembered delegate child to its parent', async () => { |
| `apps/desktop/src/app/contrib/hooks/remembered-session.ts` | Returns the session safe to remember/restore: a delegate child * (`source === 'subagent'`) is replaced by its parent, everything else keeps * its own id. |
| `apps/desktop/src/app/contrib/hooks/restore-late-plugin-route.test.tsx` | it('restores a remembered plugin page whose route registers after the session list arrived', () => { — it('still drops a remembered session route nobody owns once the disk scan has settled', () => { |
| `apps/desktop/src/app/contrib/hooks/use-background-sync.test.ts` | describe('resolveActiveTranscriptSession', () => { — it('uses a unique hidden owner hint for hydration and refresh scope', async () => { |
| `apps/desktop/src/app/contrib/hooks/use-background-sync.test.tsx` | describe('useBackgroundSync profile-scoped session refresh', () => { — it('coalesces change ticks while the live status request is pending', async () => { |
| `apps/desktop/src/app/contrib/hooks/use-background-sync.ts` | Exports `profileScopeForTranscriptSession, resolveActiveTranscriptSession, ActiveTranscriptRefreshDeps, reconcileTileTranscripts, hydrateStoredSessionTranscript, reconcileActiveTranscript`. |
| `apps/desktop/src/app/contrib/hooks/use-desktop-integrations.test.tsx` | describe('useDesktopIntegrations', () => { — describe('profile-ready gate', () => { |
| `apps/desktop/src/app/contrib/hooks/use-desktop-integrations.ts` | Exports `useDesktopIntegrations`. |
| `apps/desktop/src/app/contrib/hooks/use-desktop-metrics.ts` | Wires Desktop love/hate telemetry (store/desktop-metrics.ts) to the app's * existing state: the focused gateway + its collection switch, routes, open * overlays, workspace mode, user intera… |
| `apps/desktop/src/app/contrib/hooks/use-pet-bridge.test.ts` | describe('syncPetBusyFromSessions', () => { — it('marks the pet busy while any session is working, foreground or not', () => { |
| `apps/desktop/src/app/contrib/hooks/use-pet-bridge.ts` | Mirror "any open session is running the agent" into the pet's `busy` flag. |
| `apps/desktop/src/app/contrib/hooks/use-quick-entry-bridge.test.ts` | describe('quickEntrySubmitAck', () => { — it('reports a rejected prompt as failure instead of acknowledging success', () => { |
| `apps/desktop/src/app/contrib/hooks/use-quick-entry-bridge.ts` | Exports `quickEntrySubmitAck, useQuickEntryBridge`. |
| `apps/desktop/src/app/contrib/hooks/use-session-tile-delegate.test.ts` | describe('useSessionTileDelegate resumeTile', () => { — it('carries the owning profile into a cold tile resume so it cannot fork profiles', async () => { |
| `apps/desktop/src/app/contrib/hooks/use-session-tile-delegate.ts` | Exports `useSessionTileDelegate`. |
| `apps/desktop/src/app/contrib/index.ts` | // The contribution-driven shell package. `controller` registers panes / // layouts / chrome and mounts the app root; `wiring` is the data controller + // memoized pane surfaces; `panes` ho… |
| `apps/desktop/src/app/contrib/latest-actions.test.ts` | describe('latestActions adapters', () => { — it('forwards every present handler — an optional one the adapter forgets never reaches ChatView', () => { |
| `apps/desktop/src/app/contrib/latest-actions.ts` | Surfaces receive one stable `actions` object whose fields are mutated by the * wiring controller each render. |
| `apps/desktop/src/app/contrib/layout-presets.ts` | // --------------------------------------------------------------------------- // Layout presets — CHAT (main) always dominates. |
| `apps/desktop/src/app/contrib/layout-sides.ts` | Side toggles belong to panes, not physical edges. Derive the flip from the * tree so dragging sessions or choosing a mirrored preset remaps the buttons. |
| `apps/desktop/src/app/contrib/mcp-install-deeplink-dialog.tsx` | Exports `McpInstallDeepLinkDialog`. |
| `apps/desktop/src/app/contrib/panes.logs.test.tsx` | describe('LogsPane', () => { — it('opts the log tail into text selection', async () => { |
| `apps/desktop/src/app/contrib/panes.test.tsx` | describe('useStatusbarContributions', () => { — it('keeps a render-contribution mounted (state intact) across an unrelated host re-render', () => { |
| `apps/desktop/src/app/contrib/panes.tsx` | Real-data panes + composable bar items for the contrib root: * * - `PreviewRailPane` — the REAL ChatPreviewRail; files-pane clicks feed it. |
| `apps/desktop/src/app/contrib/session-rpc-dispatcher.test.ts` | describe('createSessionRpcDispatcher: fail closed', () => { — it('rejects with an explicit owner-resolution error instead of riding the ambient socket', async () => { |
| `apps/desktop/src/app/contrib/session-rpc-dispatcher.ts` | The window's ONE session-scoped RPC dispatcher, factored out of the contrib * wiring controller so the exact production routing (not a re-implementation) * can be driven by integration test… |
| `apps/desktop/src/app/contrib/sessions-pane-tab-title.test.tsx` | describe('the Sessions pane tab label', () => { — it('follows the live locale instead of the register-time title', () => { |
| `apps/desktop/src/app/contrib/surfaces.app-routes.test.tsx` | describe('ChatRoutesSurface and APP_ROUTES', () => { |
| `apps/desktop/src/app/contrib/surfaces.late-routes.test.tsx` | describe('ChatRoutesSurface late-registered plugin routes', () => { — it('renders a page whose route registers after mount', () => { |
| `apps/desktop/src/app/contrib/surfaces.test.tsx` | describe('ChatRoutesSurface', () => { — it('passes the live gateway after an open-to-open profile switch', () => { |
| `apps/desktop/src/app/contrib/surfaces.tsx` | Wiring surfaces — each pane is its own memoized component. |
| `apps/desktop/src/app/contrib/types.ts` | The ChatSidebar handlers the controller owns — forwarded verbatim. |
| `apps/desktop/src/app/contrib/wiring-background-queue-drain.test.tsx` | describe('ContribWiring background queue: independent remote owner', () => { |
| `apps/desktop/src/app/contrib/wiring-effects.ts` | Exports `useOpenKeybindsListener, useCreditsNoticeDemo, usePublishRestartPreviewServer, useFreshSessionRequest, useGatewayScopeRefresh`. |
| `apps/desktop/src/app/contrib/wiring-routing.test.ts` | describe('findStoredIdForRuntimeId', () => { — it('reverse-resolves a runtime id to its stored id', () => { |
| `apps/desktop/src/app/contrib/wiring-routing.ts` | Pure routing helpers for the contrib wiring controller. * * Kept out of wiring.tsx so they can be unit-tested without importing the whole * React/Electron controller module. |
| `apps/desktop/src/app/contrib/wiring.tsx` | Real-featureset wiring for the contrib (layout tree) root — the minimal * subset of DesktopController's hook chain that makes the REAL surfaces work: * gateway boot -> sessions list -> clic… |
| `apps/desktop/src/app/contrib/workspace-page-header.test.tsx` | describe('workspace page header host', () => { — it('projects a hosted control into the painted page header, not the pane body', () => { |
| `apps/desktop/src/app/contrib/workspace-page-header.tsx` | Page-owned header controls (#123597). A page route can render in the * workspace pane, whose zone paints `WORKSPACE_PAGE_HEADER_AREA` as the page * header, or in a route tile, where nothing… |
| `apps/desktop/src/app/cron/blueprints.test.ts` | describe('initialBlueprintValues', () => { — it('seeds each field from its default', () => { |
| `apps/desktop/src/app/cron/cron-actions.test.ts` | describe('triggerAndRefreshCronJobs', () => { — it('replaces the local cache with the authoritative list after a trigger', async () => { |
| `apps/desktop/src/app/cron/cron-job-model.test.ts` | describe('cron model choice values', () => { — it('round-trips provider and model colons without ambiguous pairs', () => { |
| `apps/desktop/src/app/cron/deliver-checkboxes.test.tsx` | describe('DeliverCheckboxes accessible name', () => { — it('exposes the Field label as the group name', () => { |
| `apps/desktop/src/app/cron/index.test.tsx` | describe('CronView queued trigger feedback (#70826)', () => { — it('paints the queued run row immediately and settles it when the run appears', async () => { |
| `apps/desktop/src/app/cron/job-state.test.ts` | describe('truncateText', () => { — it('truncates on Unicode code-point boundaries', () => { |
| `apps/desktop/src/app/cron/open-cron-run.test.ts` | describe('isResumableCronRun', () => { — it('keeps a scheduler-owned run live through a long tool call past the activity window', () => { |
| `apps/desktop/src/app/cron/plugin-blueprints.test.tsx` | describe('plugin-registered automation blueprints', () => { — it('lists the plugin blueprint with its plugin label and instantiates it into the scoped profile', async () => { |
| `apps/desktop/src/app/floating-hud.ts` | // Shared chrome for the top-center floating HUDs (command palette + session // switcher). |
| `apps/desktop/src/app/gateway/gateway-event-dedupe.test.ts` | describe('gateway event dedupe (#120005)', () => { — it('admits a frame once even when a second socket to the same backend delivers it again', () => { |
| `apps/desktop/src/app/gateway/gateway-event-dedupe.ts` | Cross-socket duplicate gate for backend events (#120005 / #120007). |
| `apps/desktop/src/app/gateway/hooks/canonical-owner-routing.test.tsx` | test('keeps canonical alpha events and questions on alpha while beta is foreground', async () => { |
| `apps/desktop/src/app/gateway/hooks/gateway-hmr-survivor.test.ts` | describe('gateway HMR survivor cache', () => { — it('is single-shot — a second take returns null', () => { |
| `apps/desktop/src/app/gateway/hooks/gateway-hmr-survivor.ts` | // Keep the live primary gateway socket alive across Vite HMR so editing UI never // drops the agent session. Stash on dispose, re-adopt on remount. |
| `apps/desktop/src/app/gateway/hooks/use-connections-registry.test.tsx` | describe('window-owned connection registry', () => { — it('waits for primary boot fetches before restoring the launch source', async () => { |
| `apps/desktop/src/app/gateway/hooks/use-connections-registry.ts` | Exports `useConnectionsRegistry`. |
| `apps/desktop/src/app/gateway/hooks/use-default-profile-preference.ts` | Exports `useDefaultProfilePreference`. |
| `apps/desktop/src/app/gateway/hooks/use-gateway-boot-initial-connect.test.ts` | describe('connectInitialGateway (initial-boot dial retry, #49645)', () => { — it('retries past transient transport failures and resolves once a connect succeeds', async () => { |
| `apps/desktop/src/app/gateway/hooks/use-gateway-boot-profile-pick.test.tsx` | it('a profile picked while boot is still connecting survives the primary adoption', async () => { |
| `apps/desktop/src/app/gateway/hooks/use-gateway-boot-update-hold.test.tsx` | it('a hold published after boot (a pool/profile backend) still reaches the blocked screen (R8 M6)', async () => { |
| `apps/desktop/src/app/gateway/hooks/use-gateway-boot.test.tsx` | describe('primaryRuntimeConnectionId', () => { — it('uses the registry identity when the primary connection has one', () => { |
| `apps/desktop/src/app/gateway/hooks/use-gateway-boot.ts` | Exports `primaryRuntimeConnectionId, connectInitialGateway, useGatewayBoot`. |
| `apps/desktop/src/app/gateway/hooks/use-gateway-request.test.ts` | describe('useGatewayRequest', () => { — it('exposes the live gateway on the first render, before effects run', () => { |
| `apps/desktop/src/app/gateway/hooks/use-gateway-request.ts` | Exports `useGatewayRequest`. |
| `apps/desktop/src/app/gateway/report-startup-latency.test.ts` | describe('reportStartupLatency', () => { — it('sends the metric once even when the renderer boots again (reload, reconnect, extra window)', async () => { |
| `apps/desktop/src/app/gateway/report-startup-latency.ts` | Exports `reportStartupLatency`. |
| `apps/desktop/src/app/hooks/use-config-record.test.tsx` | it('updates the write origin when a refetch replaces the displayed record', async () => { — it('does not share one config record across two gateways', async () => { |
| `apps/desktop/src/app/hooks/use-config-record.ts` | Exports `HERMES_CONFIG_KEY, hermesConfigKey, useHermesConfigRecord, setHermesConfigCache, hermesConfigCacheWriter, invalidateHermesConfig`. |
| `apps/desktop/src/app/hooks/use-debounced.ts` | Debounce a fast-changing value (search input, slider, …) so effects/queries * keyed on it only fire once the value settles. |
| `apps/desktop/src/app/hooks/use-keybinds-close-tab.test.tsx` | describe('close-tab chord over a focused terminal', () => { — it('leaves the default chord to an interactive terminal (word erase)', () => { |
| `apps/desktop/src/app/hooks/use-keybinds-right-side.test.ts` | describe('⌘J (view.toggleRightSidebar)', () => { — it('folds a Browser column on the right instead of toggling the terminal', () => { |
| `apps/desktop/src/app/hooks/use-keybinds-tab-slot.test.ts` | describe('⌘N over a tab strip is a tab switch, elsewhere a profile switch', () => { — it('activates the Nth tab of the hovered zone and leaves the profile alone', () => { |
| `apps/desktop/src/app/hooks/use-keybinds.ts` | Exports `KeybindRuntimeDeps, useKeybinds`. |
| `apps/desktop/src/app/hooks/use-on-profile-switch.test.tsx` | it('ignores StrictMode effect replay and reacts only to real profile changes', () => { |
| `apps/desktop/src/app/hooks/use-on-profile-switch.ts` | Run `onSwitch` when the active gateway profile changes — never on first * mount. |
| `apps/desktop/src/app/hooks/use-profile-switch-latch.test.ts` | describe('useProfileSwitchLatch', () => { — it('stays pending until the query stamp moves past the armed one', () => { |
| `apps/desktop/src/app/hooks/use-profile-switch-latch.ts` | Exports `useProfileSwitchLatch`. |
| `apps/desktop/src/app/hooks/use-refresh-hotkey.ts` | Binds the bare `r` key to a refresh action while the calling view is mounted. |
| `apps/desktop/src/app/hooks/use-route-enum-param.ts` | // Read/write an enum-shaped URL search param (e.g. ?tab=foo). Used to make // tabbed views survive a refresh. Always navigates with replace so tab clicks // don't pile up in history. |
| `apps/desktop/src/app/hooks/use-route-overlay-active.ts` | True while a full-screen route overlay (settings, agents, command-center, …) * is showing. * * A portaled Radix modal sits above the app shell, so it would cover such a * route. |
| `apps/desktop/src/app/hud/click-through.test.ts` | describe('hudIgnoresMouse', () => { — it('hands the mouse back over the scaffolding the HUD hangs in', () => { |
| `apps/desktop/src/app/hud/click-through.ts` | Whether the OS window should hand the mouse to whatever is behind it. |
| `apps/desktop/src/app/hud/composer-drag.test.ts` | describe('useHudComposerDrag', () => { — it('sends every move with the size snapshotted at press, so main can pin it', () => { |
| `apps/desktop/src/app/hud/composer-drag.ts` | Hold anywhere on the HUD composer before the bar becomes draggable. Short * enough to feel like grabbing it, long enough that a click still clicks. |
| `apps/desktop/src/app/hud/game-overlay.ts` | Whether a fullscreen app (a game) is under the HUD. |
| `apps/desktop/src/app/hud/glass.test.tsx` | describe('useHudGlass', () => { — it('leaves the window bare while a turn runs with the composer unfocused', () => { |
| `apps/desktop/src/app/hud/glass.ts` | Match native focus, including window deactivation. |
| `apps/desktop/src/app/hud/handoff.test.tsx` | it('puts the caret back in the app composer when the HUD closes', () => { |
| `apps/desktop/src/app/hud/handoff.ts` | HUD ⇄ app-window handoff. * * The gateway binds a session's event stream to exactly ONE socket — the last * one to submit or resume it (`session["transport"]`). |
| `apps/desktop/src/app/hud/hud-shell.tsx` | How long the transcript lingers at its glanceable opacity — after a turn * lands, or after you let go of the composer — before it goes. |
| `apps/desktop/src/app/hud/hud-shell.viewed-interval.test.tsx` | describe('HudShell edge poll', () => { — it('parks while the window is hidden and runs while it is viewed', async () => { |
| `apps/desktop/src/app/hud/layout.test.ts` | describe('hudTranscriptHeight', () => { — it('uses the resized window space for a non-empty transcript', () => { |
| `apps/desktop/src/app/hud/layout.ts` | Measured message rows, including the HUD sheet overhang. |
| `apps/desktop/src/app/hud/resize-frame.test.tsx` | describe('HudShell resize-frame engagement gates', () => { — it('an idle HUD carries none of the engagement gates the frame keys on', () => { |
| `apps/desktop/src/app/hud/resize-handle.test.ts` | describe('hudResizeBounds', () => { — it('resizes from every CanvasTTY edge and corner while preserving the opposite edges', () => { |
| `apps/desktop/src/app/hud/resize-handle.ts` | Clamp to the same mins the window was created with (spawnHudWindow). |
| `apps/desktop/src/app/hud/thread-focus.ts` | Exports `useHudThreadFocus`. |
| `apps/desktop/src/app/hud/transcript-band.test.tsx` | describe('useHudTranscriptBand', () => { — it('stops polling once the viewport mounts', () => { |
| `apps/desktop/src/app/hud/transcript-band.ts` | Breathing room the sheet keeps above the first row, so the fade has * somewhere to land. |
| `apps/desktop/src/app/index.tsx` | // The app root is the contribution-driven shell: panes, titlebar/statusbar // items, keybinds, palette commands, routes, and themes all register through // the contribution registry (src/c… |
| `apps/desktop/src/app/layout-constants.ts` | // Responsive horizontal gutter for primary content bodies (settings right side, // skills, artifacts, command center / sessions). |
| `apps/desktop/src/app/master-detail.tsx` | Exports `ToolChip, MASTER_DETAIL_WIDE_COLS, MasterDetail, ListColumn, DetailColumn, ICON_BUTTON`. |
| `apps/desktop/src/app/messaging/allowlist-field.tsx` | Exports `splitAllowlist, joinAllowlist, AllowlistFieldProps, AllowlistField`. |
| `apps/desktop/src/app/messaging/index.test.tsx` | describe('MessagingView profile scope', () => { — it('names the active profile explicitly instead of sending an unscoped request', async () => { |
| `apps/desktop/src/app/messaging/index.tsx` | Exports `MessagingView`. |
| `apps/desktop/src/app/messaging/platform-icon.tsx` | Exports `PlatformAvatar`. |
| `apps/desktop/src/app/messaging/telegram-qr-setup.tsx` | Exports `isTerminalTelegramOnboardingError, formatExpiry, TelegramQrSetupProps, TelegramQrSetup`. |
| `apps/desktop/src/app/model-picker-overlay.test.tsx` | it('reads the catalog from the backend profile but hands the Desktop alias to provider setup', async () => { |
| `apps/desktop/src/app/model-picker-overlay.tsx` | Exports `ModelPickerOverlay`. |
| `apps/desktop/src/app/model-visibility-overlay.tsx` | Exports `ModelVisibilityOverlay`. |
| `apps/desktop/src/app/open-session.test.ts` | describe('openSessionIntentFromModifiers', () => { — it('defaults to in-place', () => { |
| `apps/desktop/src/app/open-session.ts` | One door for "open this session" — every surface (sidebar, ⌘K, notifications, * session switcher, refs, cron/artifacts) goes through here so a chat that's * already a tile (or the main tab)… |
| `apps/desktop/src/app/overlays/overlay-breadcrumb-header.tsx` | Exports `OverlayBreadcrumbHeader`. |
| `apps/desktop/src/app/overlays/overlay-chrome.tsx` | Exports `OverlayIconButton`. |
| `apps/desktop/src/app/overlays/overlay-split-layout.test.tsx` | it('expands independently of navigation and reveals a newly selected child', () => { — it('fills only the current page when a third-level sub-page is open; its parent is named, not filled', () => { |
| `apps/desktop/src/app/overlays/overlay-split-layout.tsx` | // The wide rail and the narrow dropdown swap at exactly the width where // OverlaySplitLayout drops to a single column, so the rail never stacks. |
| `apps/desktop/src/app/overlays/overlay-view.tsx` | // Shared top clearance for overlay content that sits *beside* the floating // close button (which is absolute at `0.1875rem + titlebar/2`, -translate-y-1/2, // so it costs no layout space)… |
| `apps/desktop/src/app/overlays/panel.test.tsx` | describe('PanelRowMenu', () => { — it('opens its actions menu from the kebab without a tooltip', async () => { |
| `apps/desktop/src/app/overlays/panel.tsx` | // Overlay "panel" primitive — the centered, capped card + framed chrome lifted // straight from the trace / agents overlay so every non-settings overlay (cron, // profiles, …) speaks the s… |
| `apps/desktop/src/app/page-search-shell.tsx` | // Tabs are data, not nodes: the shell owns their presentation so every page // gets the same behavior — a centered TextTab row on wide viewports that // collapses into a dropdown when the … |
| `apps/desktop/src/app/pet-generate/components/draft-grid.tsx` | Exports `DraftGrid`. |
| `apps/desktop/src/app/pet-generate/components/empty-hint.tsx` | Exports `EmptyHint`. |
| `apps/desktop/src/app/pet-generate/components/generate-unavailable.tsx` | Exports `GenerateUnavailable`. |
| `apps/desktop/src/app/pet-generate/components/hatch-preview.tsx` | Exports `HatchPreview`. |
| `apps/desktop/src/app/pet-generate/components/hatching-view.tsx` | Exports `HatchingView`. |
| `apps/desktop/src/app/pet-generate/components/provider-picker.tsx` | // Image-backend picker for pet generation — the composer's model-pill pattern: // a quiet trigger + a dropdown of options. |
| `apps/desktop/src/app/pet-generate/components/reference-chip.tsx` | Exports `ReferenceChip`. |
| `apps/desktop/src/app/pet-generate/lib/frame-count.ts` | // Sprite row → the PetInfo frame-count key it resolves to (directional walks and // aliases collapse onto their base state). |
| `apps/desktop/src/app/pet-generate/lib/read-reference-image.ts` | Exports `readReferenceImage`. |
| `apps/desktop/src/app/pet-generate/pet-generate-content.tsx` | Exports `PetGenerateContent`. |
| `apps/desktop/src/app/pet-generate/pet-generate-overlay.tsx` | "Hatch a Pet" — a dedicated, Pokédex-style overlay for pet generation. * * Previously generation lived as a cramped nested page inside the Cmd-K command * palette (~34rem popover). |
| `apps/desktop/src/app/pet-overlay/overlay-root.tsx` | Boot the pet-overlay window. Loaded by the same bundle as the main app but * via `?win=overlay`, so it shares CSS/atoms while mounting a minimal, transparent * surface (no app shell, no gat… |
| `apps/desktop/src/app/pet-overlay/pet-overlay-app.tsx` | // Fallbacks mirror pet-sprite's defaults; the gateway normally sends real values. |
| `apps/desktop/src/app/profiles/create-profile-dialog.test.tsx` | Test file (no top-level title found). |
| `apps/desktop/src/app/profiles/create-profile-dialog.tsx` | Exports `isValidProfileName, CreateProfileDialog`. |
| `apps/desktop/src/app/profiles/delete-profile-dialog.tsx` | // Thin wrapper over ConfirmDialog: owns the deleteProfile call, inherits // Enter-to-confirm + busy/done/error from the shared dialog. |
| `apps/desktop/src/app/profiles/index.test.tsx` | describe('ProfilesView', () => { — it('shows missing-file guidance only until SOUL.md is saved, not for empty files or read errors', async () => { |
| `apps/desktop/src/app/profiles/index.tsx` | Exports `ProfilesView`. |
| `apps/desktop/src/app/profiles/rename-profile-dialog.test.tsx` | it('retires the old-name local gateways before issuing the rename', async () => { — it('does not retire gateways when validation rejects the submit', async () => { |
| `apps/desktop/src/app/profiles/rename-profile-dialog.tsx` | Exports `RenameProfileDialog`. |
| `apps/desktop/src/app/quick-entry/quick-entry-app.test.tsx` | describe('QuickEntryApp', () => { — it('paints every native target option with matching theme foreground and background tokens', () => { |
| `apps/desktop/src/app/quick-entry/quick-entry-app.tsx` | Exports `QuickEntryApp`. |
| `apps/desktop/src/app/quick-entry/quick-entry-root.tsx` | Boot the Quick Entry window. Loaded by the same bundle as the main app but via * `?win=quick`, so it shares CSS/theme tokens while mounting a minimal capture * surface (no app shell, no gat… |
| `apps/desktop/src/app/retirement-view.test.tsx` | test('discontinued retirement shows the uninstall notice and persists dismissal per revision', async (): Promise<void> => { |
| `apps/desktop/src/app/right-sidebar/file-actions.tsx` | Exports `isRenameShortcut, pickRevealLabel, FileEntryContextMenu, FileActionDialogs, InlineRenameInput`. |
| `apps/desktop/src/app/right-sidebar/files/dnd-manager.ts` | Exports `getFileTreeDndManager`. |
| `apps/desktop/src/app/right-sidebar/files/ipc.test.ts` | describe('readProjectDir', () => { — it('returns no-bridge when the desktop bridge is unavailable', async () => { |
| `apps/desktop/src/app/right-sidebar/files/ipc.ts` | Exports `ProjectTreeEntry, readProjectDir, clearProjectDirCache`. |
| `apps/desktop/src/app/right-sidebar/files/prefs.test.ts` | describe('files show-ignored preference', () => { — it('defaults to filtering and only opts in the root it was told about', () => { |
| `apps/desktop/src/app/right-sidebar/files/prefs.ts` | // "Show gitignored files" is a per-project preference: a repo that keeps a // second checkout, a build output or an env-specific folder out of git is // exactly the repo whose owner wants … |
| `apps/desktop/src/app/right-sidebar/files/remote-picker.test.tsx` | describe('RemoteFolderPicker', () => { — it('creates a folder on the backend under the current path and selects it', async () => { |
| `apps/desktop/src/app/right-sidebar/files/remote-picker.tsx` | Exports `RemoteFolderPicker`. |
| `apps/desktop/src/app/right-sidebar/files/tree-sizing.test.ts` | describe('projectTreeViewportSize', () => { — it('uses ResizeObserver contentRect without forcing another layout read', () => { |
| `apps/desktop/src/app/right-sidebar/files/tree.test.tsx` | describe('ProjectTree context-menu clicks', () => { — it('a context-menu item click does not also open the file preview (#101263)', async () => { |
| `apps/desktop/src/app/right-sidebar/files/tree.tsx` | Exports `ProjectTree, projectTreeViewportSize`. |
| `apps/desktop/src/app/right-sidebar/files/use-project-tree.test.ts` | describe('useProjectTree', () => { — it('starts empty when cwd is blank and skips IPC', async () => { |
| `apps/desktop/src/app/right-sidebar/files/use-project-tree.ts` | Absolute filesystem path. Doubles as react-arborist node id. |
| `apps/desktop/src/app/right-sidebar/index.test.tsx` | describe('RightSidebarPane', () => { — it('renders the tree whenever the session has a working dir (repo or not) — no picker', async () => { |
| `apps/desktop/src/app/right-sidebar/index.tsx` | Exports `RightSidebarPane, RightSidebarSectionHeader, PaneEmptyState, EmptyState`. |
| `apps/desktop/src/app/right-sidebar/review/churn-bar.tsx` | // Per-row "digital rain" churn bar: a right-anchored, clipped stream of // Matrix-ish glyphs whose width is the file's churn relative to the biggest // changed file. |
| `apps/desktop/src/app/right-sidebar/review/file-tree.test.tsx` | describe('ReviewFileTree', () => { — it('virtualizes heavy trees: only the visible window is mounted', () => { |
| `apps/desktop/src/app/right-sidebar/review/file-tree.tsx` | Exports `ReviewFileTree`. |
| `apps/desktop/src/app/right-sidebar/review/index.test.tsx` | describe('ReviewPane header gating', () => { — it('enables stage-all / revert-all under the uncommitted scope', () => { |
| `apps/desktop/src/app/right-sidebar/review/index.tsx` | Exports `ReviewPane`. |
| `apps/desktop/src/app/right-sidebar/review/scope-row.tsx` | Exports `ReviewScopeRow`. |
| `apps/desktop/src/app/right-sidebar/review/ship-bar.test.tsx` | describe('ReviewShipBar', () => { — it('renders the commit bar for the uncommitted scope', () => { |
| `apps/desktop/src/app/right-sidebar/review/ship-bar.tsx` | Exports `ReviewShipBar`. |
| `apps/desktop/src/app/right-sidebar/review/tree-data.test.ts` | describe('buildReviewTree', () => { — it('nests files under their folders and sorts dirs before files', () => { |
| `apps/desktop/src/app/right-sidebar/review/tree-data.ts` | // A node in the review changed-files tree. Directories aggregate their // descendants' +/- so a collapsed folder still shows its total churn (Codex's // folder hierarchy view). |
| `apps/desktop/src/app/right-sidebar/store.ts` | Exports `setTerminalTakeover, runInTerminal`. |
| `apps/desktop/src/app/right-sidebar/terminal/active-resize.test.ts` | describe('observeActiveTerminalResize', () => { — it('fits once on activation and coalesces later resize bursts', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/active-resize.ts` | Exports `observeActiveTerminalResize`. |
| `apps/desktop/src/app/right-sidebar/terminal/agent-terminal-stream.bound.test.ts` | describe('agent terminal retention is bounded', () => { — it('a finished process does not pin its backlog for the life of the renderer', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/agent-terminal-stream.ts` | // Live agent-terminal output, pushed from the backend as `agent.terminal.output` // events (see tui_gateway `_wire_agent_terminal_output`). |
| `apps/desktop/src/app/right-sidebar/terminal/buffer.ts` | // Serialized view of the in-app terminal, handed to the agent's `read_terminal` // tool. |
| `apps/desktop/src/app/right-sidebar/terminal/chrome.tsx` | Pane-side terminal chrome: the body slot (which the persistent overlay chases) * plus the always-on tab rail. |
| `apps/desktop/src/app/right-sidebar/terminal/clipboard.test.ts` | describe('terminalClipboardIntent', () => { — it('never claims a bare Ctrl+C with nothing selected, on either platform', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/clipboard.ts` | // Clipboard keybindings for the GUI terminal. // // xterm renders to a canvas, so its selection is not a DOM selection and the // platform's own copy command has nothing to grab. |
| `apps/desktop/src/app/right-sidebar/terminal/instance.test.tsx` | describe('background terminal input guidance (#108233)', () => { — it('explains the mirror and opens a separate interactive shell only when requested', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/instance.tsx` | // Absolute-stacked so inactive tabs keep layout size (a display:none host goes // 0×0 and renders garbled on re-show); visibility toggles which one is seen. |
| `apps/desktop/src/app/right-sidebar/terminal/links.test.ts` | describe('terminal links', () => { — it('opens a ⌘-clicked URL in the in-app browser, not the window.open Electron denies', async () => { |
| `apps/desktop/src/app/right-sidebar/terminal/links.ts` | // Both of xterm's link paths — the web-links addon (URLs it finds in the // buffer) and the core OSC 8 provider (hyperlinks a CLI emits explicitly) — // activate through `window.open()`, w… |
| `apps/desktop/src/app/right-sidebar/terminal/persistent.test.tsx` | describe('PersistentTerminal rect tracking', () => { — it('settles after rect changes instead of polling forever', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/persistent.tsx` | One xterm Terminal mounted at the layout root and CSS-overlayed onto * whichever `<TerminalSlot />` is active. |
| `apps/desktop/src/app/right-sidebar/terminal/rail.test.tsx` | describe('TerminalRail', () => { — it('⌘-click closes the tab; a plain click selects it', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/rail.tsx` | Exports `TerminalRail`. |
| `apps/desktop/src/app/right-sidebar/terminal/reveal-focus.test.ts` | describe('terminal reveal keyboard focus', () => { — it('takes focus from the keybind on reveal and keeps it when the composer steals it', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/reveal-focus.ts` | Exports `toggleTerminalPane, terminalPaletteToggle`. |
| `apps/desktop/src/app/right-sidebar/terminal/revive-buffer.test.ts` | describe('isIdlePromptOnly', () => { — it('is true for an empty or whitespace-only buffer', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/selection.test.ts` | describe('shouldOwnAddSelectionShortcut', () => { — it('only the active tab claims the add-selection shortcut when text is selected (#76116)', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/selection.ts` | // VS Code's default integrated-terminal palette (terminalColorRegistry.ts) — a // fixed table per theme type, not luminance-derived. |
| `apps/desktop/src/app/right-sidebar/terminal/terminal-context-menu.test.ts` | describe('terminalMenuHandleFor (production DOM shape)', () => { — it('finds the handle registered on the xterm host, not the scope div', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/terminal-context-menu.ts` | Verb registry for the GUI terminals. * * xterm paints to a canvas: a right-click inside it crosses no link, image, * editable, or DOM selection, so the app context menu would see a bare * s… |
| `apps/desktop/src/app/right-sidebar/terminal/terminal-font.test.ts` | describe('terminal font resolution', () => { — it('keeps the bundled stack when no preference is configured', () => { |
| `apps/desktop/src/app/right-sidebar/terminal/terminal-font.ts` | Exports `DEFAULT_TERMINAL_FONT_FAMILY, TERMINAL_FONT_SUGGESTIONS, normalizeTerminalFontFamily, resolveTerminalFontFamily, setTerminalFontFamilyFromConfig, warmTerminalFontFamily`. |
| `apps/desktop/src/app/right-sidebar/terminal/terminals.test.ts` | describe('terminal store persistence', () => { — it('restores user tabs, active tab, and history on module load', async () => { |
| `apps/desktop/src/app/right-sidebar/terminal/terminals.ts` | // xterm WebGL terminals that share one glyph atlas (same font/theme/DPR) keep // per-terminal render models over a SHARED texture. |
| `apps/desktop/src/app/right-sidebar/terminal/use-agent-terminal.test.tsx` | describe('useAgentTerminal', () => { — it('unmounts safely while initial font preparation is pending', async () => { |
| `apps/desktop/src/app/right-sidebar/terminal/use-agent-terminal.ts` | // Read-only terminal for an agent background process: a write-only xterm (no PTY, // no input) fed live by the backend output stream, keyed by process id. |
| `apps/desktop/src/app/right-sidebar/terminal/use-terminal-font.test.tsx` | describe('useTerminalFontController', () => { — it('repaints an already-mounted xterm when the profile font changes', async () => { |
| `apps/desktop/src/app/right-sidebar/terminal/use-terminal-font.ts` | Exports `useTerminalFontController`. |
| `apps/desktop/src/app/right-sidebar/terminal/use-terminal-session.ts` | Exports `cleanReviveSnapshot, isIdlePromptOnly, parseOscCwd, useTerminalSession`. |
| `apps/desktop/src/app/right-sidebar/terminal/workspace.tsx` | Exports `TerminalWorkspace`. |
| `apps/desktop/src/app/routes.test.ts` | describe('primaryRouteSelectedSessionId', () => { — it('prefers the routed session id over a stale/different store selection (#59305)', () => { |
| `apps/desktop/src/app/routes.titlebar-clusters.test.ts` | describe('hidesFixedTitlebarClusters', () => { — it('hides clusters on contributed full pages and overlays', () => { |
| `apps/desktop/src/app/routes.ts` | Exports `SESSION_ROUTE_PREFIX, NEW_CHAT_ROUTE, SETTINGS_ROUTE, COMMAND_CENTER_ROUTE, SESSION_IMPORT_ROUTE, CAPABILITIES_ROUTE`. |
| `apps/desktop/src/app/routes.workspace-reveal.test.ts` | describe('routePathname', () => { — it('keeps a bare path and drops a query or hash', () => { |
| `apps/desktop/src/app/session-import/api.ts` | Exports `ForeignSession, ForeignPage, ForeignPreview, ForeignImportResult, foreignRequest`. |
| `apps/desktop/src/app/session-import/index.test.tsx` | it('browses without importing, then retries a failed import on the captured owner before opening', async () => { — it('does not navigate when an import finishes after the view has closed', async () =… |
| `apps/desktop/src/app/session-import/index.tsx` | Exports `SessionImportView`. |
| `apps/desktop/src/app/session-picker-overlay.tsx` | Exports `SessionPickerOverlay`. |
| `apps/desktop/src/app/session-switcher.tsx` | // Compact session-switcher HUD — keyboard-driven from `use-keybinds`, rows // clickable via mousedown (Ctrl+click on macOS). No Dialog: Tab stays global. |
| `apps/desktop/src/app/session/hooks/branch-owner-routing.integration.test.ts` | describe('branch owner routing (real router, faked transport)', () => { — it('dials the parent connection and sends the create over that socket', async () => { |
| `apps/desktop/src/app/session/hooks/default-new-session.test.tsx` | describe('generic new session default routing', () => { — it('keeps a legacy profile peer separate from the app default and the active source', async () => { |
| `apps/desktop/src/app/session/hooks/model-pick-ledger.ts` | // Per-session ledger of in-flight model picks, shared by every surface that // mounts useModelControls. |
| `apps/desktop/src/app/session/hooks/new-session-first-message.test.tsx` | describe('submitTextToNewSession first message', () => { — it('shows the submitted text as the first user message once the route opens the new chat', async () => { |
| `apps/desktop/src/app/session/hooks/preview-open.test.tsx` | describe('preview routing', () => { — describe('open_preview', () => { |
| `apps/desktop/src/app/session/hooks/profile-rail-fresh-chat-owner.test.tsx` | describe('profile rail: a fresh Omar chat keeps its exact registry owner across turns (#94071)', () => { — it('an ordinary profile pick supersedes the legacy default pin on the active registry source… |
| `apps/desktop/src/app/session/hooks/resume-occurrences.test.tsx` | it('settles a retained idle error once across repeated resume and a changed error snapshot', async () => { |
| `apps/desktop/src/app/session/hooks/resume-route-commit.test.tsx` | it('binds the resumed session when the route commits onto it mid-resume', async () => { |
| `apps/desktop/src/app/session/hooks/session-context-drift.test.ts` | describe('routeTargetFromToken', () => { — it('maps a session route to its session id, a non-chat route to null, and the new-chat route to __new__', () => { |
| `apps/desktop/src/app/session/hooks/session-context-drift.ts` | The chat a route token points at: the stored/routed session id, `'__new__'` * for the new-chat route, or null for a route that isn't a chat (settings and * the other overlay routes). |
| `apps/desktop/src/app/session/hooks/switch-back-receipt-race.test.tsx` | it('paints the prompt and reply once when the receipt binds them while the switch-back page read is in flight', async () => { — it('keeps the receipt binding of a turn that completes while its sessio… |
| `apps/desktop/src/app/session/hooks/use-background-queue-drain.test.tsx` | describe('useBackgroundQueueDrain', () => { — it('drains an idle queued prompt for a non-selected background session', async () => { |
| `apps/desktop/src/app/session/hooks/use-background-queue-drain.ts` | Exports `useBackgroundQueueDrain`. |
| `apps/desktop/src/app/session/hooks/use-background-queue-preservation.test.tsx` | Test file (no top-level title found). |
| `apps/desktop/src/app/session/hooks/use-busy-input-mode.test.tsx` | it('canonical busy policy is session scoped even with a cached global mode', async () => { — it('recovers a transient busy policy read without reconnecting', async () => { |
| `apps/desktop/src/app/session/hooks/use-busy-input-mode.ts` | Exports `useBusyInputMode`. |
| `apps/desktop/src/app/session/hooks/use-context-suggestions.ts` | Exports `useContextSuggestions`. |
| `apps/desktop/src/app/session/hooks/use-cwd-actions.test.tsx` | describe('useCwdActions session target', () => { — it('re-homes the named tile, not the primary, and leaves the primary readout alone', async () => { |
| `apps/desktop/src/app/session/hooks/use-cwd-actions.ts` | Exports `useCwdActions`. |
| `apps/desktop/src/app/session/hooks/use-hermes-config.test.ts` | describe('useHermesConfig refreshHermesConfig', () => { — it('mirrors display.show_reasoning and resets a missing key to the default', async () => { |
| `apps/desktop/src/app/session/hooks/use-hermes-config.ts` | Exports `useHermesConfig`. |
| `apps/desktop/src/app/session/hooks/use-message-stream/agent-init-error.test.tsx` | describe('useMessageStream agent-init error surfacing (#63078)', () => { — it('renders an agent-init failure as a visible in-transcript error and keeps the optimistic first message', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/approval-mode-event.test.tsx` | describe('live session.info approval mode reconciliation', () => { — it('reconciles an active-session event under its source gateway profile', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/background-complete-event.test.tsx` | describe('background.complete event', () => { — it('appends the result to the originating session as a system message', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/background-review-interrupt.test.tsx` | describe('background-review interrupt must not paint stale bytes into the next turn (#119543)', () => { — it('drops a superseded-turn straggler queued before the new message.start', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/btw-complete-event.test.tsx` | describe('btw.complete event', () => { — it('appends the answer to the originating session as a system message', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/clarify-hydration.test.tsx` | describe('clarify request stream hydration', () => { — it('mounts an answerable clarify row when the tool.start row was missed', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/collapse-duplicate-final.ts` | The surviving bubble replaces the removed stream id at completion. |
| `apps/desktop/src/app/session/hooks/use-message-stream/compaction-event.test.tsx` | describe('useMessageStream compaction lifecycle', () => { — it('drives the compaction phase from the manual /compress spelling', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/completion-boundaries.test.tsx` | it('binds a late submit acknowledgement to its exact optimistic prompt without reviving the turn', async () => { — it('binds the sent prompt to the receipt row named by its submission', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/completion-projections.test.tsx` | Test file (no top-level title found). |
| `apps/desktop/src/app/session/hooks/use-message-stream/composer-model-event.test.tsx` | describe('session.info does not clobber composer model selection', () => { — it('keeps a sticky manual pick when a global session.info carries the profile default', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/delta-flush.test.tsx` | describe('useMessageStream delta flush scheduling', () => { — it('flushes streaming text on a bounded timer while the window is unfocused', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/duplicate-background-reply.test.tsx` | it('refreshes folded background replies without keeping their settled live copies', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/duplicate-completion.test.tsx` | it('settles identical tool-interim completion once while retaining every completed call', async () => { — it('keeps distinct segments, user boundaries, and failures on their own side of completion', … |
| `apps/desktop/src/app/session/hooks/use-message-stream/duplicate-delivery-120104.test.tsx` | it('renders one bubble when the duplicate interim lands after the first completion', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/execution-authority.test.tsx` | it('refreshes an idle shared queue and does not let a queued cancellation end a running turn', () => { — it('rejects stale snapshots and terminal frames across generations and owner epochs', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/folded-segment-refresh.test.tsx` | it('keeps a settled segment the refreshed fold does not carry yet', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/deferred-pick.test.ts` | describe('handleDeferredPickEvent', () => { — it('shows a refused next-turn pick by name and repaints the committed model', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/desktop-bridge.reaction.test.ts` | describe('message.reaction bridge session scope', () => { — it('a background session event never mutates the visible transcript or the overlay', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/desktop-bridge.test.ts` | describe('tip.show bridge (#117216)', () => { — it('a ✕-closed agent tip does not come back on the next tip.show of the same content', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/fallback-switch.test.ts` | describe('desktop fallback switch', () => { — it('shows a model fallback switch in the transcript', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/input-requests.approval-timeout.test.ts` | describe('approval request.cancel', () => { — it('timeout: tears the bar down and appends a plain system line with a Safety settings action', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/input-requests.settled.test.ts` | describe('canonical approval.settled', () => { — it('clears the bar a peer window answered and leaves other prompts alone', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/input-requests.test.ts` | describe('Bot Screen install password card', () => { — it('belongs to the app, not to the chat that happened to be open: it survives a chat switch and its cancel finds it', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/lifecycle.approval-cancelled.test.ts` | describe('approval.cancelled lifecycle event', () => { — it('clears the parked prompt for each named request id', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/lifecycle.test.ts` | describe('handleLifecycleEvent setup.ready', () => { — it('claims the event and triggers one free-tier refresh plus one readiness evaluation from the active source', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/message-stream.test.ts` | describe('handleMessageStreamEvent session-control integration', () => { — it('refreshes only after message.complete, through the store seam', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/message-stream.ts` | Exports `handleMessageStreamEvent`. |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/server-requests.test.ts` | describe('connection request routing', () => { — it('does not route connection operations through the server-request rail', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/server-requests.ts` | Exports `ServerRequestContext, requestNamesActiveSession, windowHostsSession, windowReadClaimsSession, previewSessionRoute, SERVER_REQUEST_HANDLERS`. *(read head 200 + tail 110)* |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/session-control.test.ts` | describe('handleControlEvent', () => { — it('does not claim non-control events', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/session-info.test.ts` | describe('handleSessionInfoEvent workspace ownership', () => { — it('ignores an unnamed broadcast from a session the pane is not bound to', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/session-info.ts` | Exports `handleSessionInfoEvent`. |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/status.test.ts` | describe('gateway `error` event → error card + toast', () => { — it('stamps SESSION_NOT_OWNED on a live-owner refusal so the card drops Retry', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/theme-requests.test.ts` | describe('set_theme requests', () => { — it('parks a picker card and answers it with the applied pick', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/tools-preview.test.ts` | it('reoffers a real later production, never a historical mount or duplicate completion', () => { — it('keeps dismissal when a missed completion arrives through the real reconnect replay path', async … |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/tools-progress.test.ts` | it('shows tool.progress on its running row and drops it when the call completes', () => { — it('keeps two chats reusing one call id apart, and a turn end sweeps only its own chat', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/tools-subagent-interrupt.test.ts` | describe('subagent events across an interrupted session', () => { — it('a terminal subagent.complete still lands after Stop instead of leaving the row running forever', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/heartbeat-complete-reorder.test.tsx` | it('#119569 V1: tool-heavy turn keeps the just-delivered reply across complete', async () => { — it('#119569 V2: interim-sealed tool turn keeps both segments across complete', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/index.ts` | Exports `useMessageStream`. *(read head 90)* |
| `apps/desktop/src/app/session/hooks/use-message-stream/interim-history.test.tsx` | describe('intermediate assistant text survives Desktop lifecycle boundaries', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/interim-redelivery-duplicate.test.tsx` | describe('a reply the turn re-streams after sealing it as an interim paints once', () => { — it('keeps one bubble when the sealed interim already carries the final reply', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/interim-redelivery.test.tsx` | describe('useMessageStream redelivered message.interim (#93926)', () => { — it('keeps one bubble when the same interim arrives twice back-to-back', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/interim-sealing.test.tsx` | describe('useMessageStream interim text sealing', () => { — it('preserves interim text that the final response does not include', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/interrupted-reply.test.tsx` | describe('Stop: the screen shows the partial the session saves (#121594)', () => { — it('late deltas after Stop reach the bubble through the interrupted completion', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/interrupted-reply.ts` | Exports `extendInterruptedReply`. |
| `apps/desktop/src/app/session/hooks/use-message-stream/interrupted-status-sync.test.tsx` | describe('interrupted turn still retires status rows (#81114)', () => { — it('a delegate_task tool.complete after Stop retires the fallback row', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/late-tool-events.test.tsx` | describe('tool events for a part that already exists on a sealed message', () => { — it('attaches a late completion to the sealed bubble that owns the call', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/moa-progress-event.test.tsx` | describe('useMessageStream moa.progress / moa.phase surfacing', () => { — it('shows refs k/n lines in the reasoning block as references complete', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/moa-reference-event.test.tsx` | describe('useMessageStream moa.reference accumulation (#64658)', () => { — it('keeps every reference model labelled block instead of only the latest one', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/peer-transcript-notify.test.tsx` | describe('completed turn notifies peer windows (#65047)', () => { — it('broadcasts the stored session when a turn completes', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/pet-tool-failure-event.test.tsx` | describe('pet tool-failure reaction', () => { — it('briefly shows failed when the active session has an isolated tool error', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/provider-wait-event.test.tsx` | describe('provider wait visibility', () => { — it('surfaces explained waits but ignores generic spinner rewrites', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/receipt-user-rows.ts` | Exports `bindReceiptUserRows`. |
| `apps/desktop/src/app/session/hooks/use-message-stream/replay-gap.test.tsx` | describe('session.replay_gap recovery', () => { — it('requests an authoritative resume for the affected active route without losing owner scope or its draft', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/response-occurrences.test.tsx` | Test file (no top-level title found). |
| `apps/desktop/src/app/session/hooks/use-message-stream/response-parts.ts` | One live bubble may hold several model responses when an equal interim * callback is suppressed. |
| `apps/desktop/src/app/session/hooks/use-message-stream/reused-final-after-tool.test.tsx` | it('a reused final whose deltas never reached this window still paints the reply', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/session-info-side-effects.test.tsx` | describe('session.info config refetch gating', () => { — it('coalesces active-session bursts into one trailing config fetch', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/session-reclaimed.test.tsx` | describe('session.reclaimed', () => { — it('leaves every other live session alone', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/stale-pending-settle.test.tsx` | describe('turn end without message.complete (session.info running=false)', () => { — it('settles a streaming bubble that kept text', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/steer-arrival-order.test.tsx` | describe('steer mid-turn keeps arrival order (user bubble never above prior output)', () => { — it('orders pre-steer output → steer → post-steer output → settled reply', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/stream-flush.test.tsx` | describe('stream delta delivery', () => { — it('delivers a delta while animation frames are parked', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/terminal-error-frame.test.tsx` | describe('terminal error message.complete frames', () => { — it('marks the bubble failed from the structured error field, not the text heuristic', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/test-harness.tsx` | Session-state map to mount with, for tests that seed state up front. |
| `apps/desktop/src/app/session/hooks/use-message-stream/timeline-events.test.tsx` | describe('live transcript timeline events', () => { — it('records commentary, tool, resumed text, and turn-stop boundaries', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/todo-cleanup.test.tsx` | describe('useMessageStream turn-end todo cleanup', () => { — it('drops a still-active task list when the turn completes', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/tool-drafting-event.test.tsx` | describe('drafting-tool label lifecycle', () => { — it('names the tool the model is drafting', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/transformed-final.test.tsx` | describe('useMessageStream response_transformed settlement', () => { — it('replaces the streamed bubble with transformed final text that shares no prefix', async () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/usage.test.tsx` | describe('useMessageStream status-bar usage scoping', () => { — it('merges a live session.usage tick from the focused session', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/utils.test.ts` | describe('completionErrorText', () => { — it('flags provider/HTTP/retry failures, ignores normal text', () => { |
| `apps/desktop/src/app/session/hooks/use-message-stream/utils.ts` | Exports `sessionInfoStatePatch, hasSessionInfoStatePatch, applySessionInfoStatePatch, STREAM_DELTA_FLUSH_MS, MAX_STREAM_FLUSH_GAP_MS, PRE_TURN_LIVE_SETTLE_GRACE_MS`. |
| `apps/desktop/src/app/session/hooks/use-model-controls-stale-pick.test.tsx` | describe('useModelControls stale pick ordering', () => { — it('does not roll a failed older pick back over a newer one that applied', async () => { |
| `apps/desktop/src/app/session/hooks/use-model-controls.test.tsx` | describe('useModelControls', () => { — it('writes optimistic selections only to the owning connection cache', async () => { |
| `apps/desktop/src/app/session/hooks/use-model-controls.ts` | Exports `useModelControls`. |
| `apps/desktop/src/app/session/hooks/use-preview-routing.ts` | Exports `usePreviewRouting`. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/browser-manage.test.tsx` | describe('usePromptActions /browser connect/disconnect', () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/index-test-utils.tsx` | // Shared fixtures for the usePromptActions suites (index.test.tsx and its // split siblings). Each test file keeps its own vi.mock calls. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/index.deep-cut.test.tsx` | describe('usePromptActions deep-cut confirm across a session switch (#133716)', () => { — it('drops a 4033 confirm answered after the user switched sessions (#133716)', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/index.sleep-wake.test.tsx` | describe('usePromptActions sleep/wake session recovery', () => { — it('resumes the stored session and retries once when prompt.submit reports "session not found"', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/index.test.tsx` | describe('durable submit acknowledgement', () => { — it('retires the native private-file journal only after a matching canonical receipt', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/index.ts` | Exports `uploadComposerAttachment, usePromptActions`. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/owner-forward.test.tsx` | describe('usePromptActions gateway-owner queue (#140385)', () => { — it('re-uploads the image of a draft restored after a SESSION_OWNER_BUSY refusal: serve dropped it (#140968)', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/prepared-submission-windows.test.tsx` | it('two windows sending the same text keep separate identities; only the writer retries its own', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/prepared-submissions-spent.test.ts` | test('an admitted identity whose journal removal failed stays spent across a reload', async () => { — test('two windows retiring different admitted entries keep both tombstones across a reload', asyn… |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/prepared-submissions.test.ts` | test('image recovery never offers expanded slash intent as an ordinary draft and leaves its exact journal intact', async () => { — test('native preparation waits for acknowledgement and never downgra… |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/prompt-actions-harness.tsx` | // Shared usePromptActions test harness (index.test.tsx and the topical siblings). |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/queue-if-busy.test.ts` | it('leaves canonical busy kickoff admission to the submit pipeline instead of the local queue', () => { — it('forwards kickoff identity to queue admission and leaves idle targets alone', () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/queued-first-input.test.tsx` | it('does not graft explicitly queued input onto the active turn', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/resolve-target-session.test.ts` | describe('resolveTargetSessionId', () => { — it('resumes the routed stored session instead of minting a new one when the runtime binding is gone', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/rewind.test.ts` | describe('appendMidTurnUserMessage', () => { — it('appends the mid-turn message after the live assistant output, sealed in place', () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/rewind.ts` | Shared rewind/interrupt core for the prompt verbs — the ONE implementation * of the submit primitive + the pure message math behind cancel / reload / * restore / edit / branch-visibility. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/single-flight-resume.test.ts` | describe('singleFlightSessionResume', () => { — it('two concurrent resume callers for the same stored id produce ONE session.resume RPC', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/slash-desktop-commands.test.tsx` | describe('desktop surfaces for /rollback /agents /config /history', () => { — it('routes each to a local action (never slash.exec, never "terminal only")', () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/slash-desktop-commands.ts` | // T11 (#134889): /rollback, /agents (/tasks), /config and /history on the session owner's existing // verbs. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/slash-session-commands.test.tsx` | describe('desktop surfaces for the canonical session commands', () => { — it('routes /undo, /retry, /steer (/s) and /queue (/q) to local actions, not slash.exec', () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/slash-session-commands.ts` | Exports `SessionCommandEnv, retryText, userTurnFromEnd, truncateRewoundMessages, sessionCommandHandlers`. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/slash-session-user-turns.test.ts` | describe('userTurnFromEnd', () => { — it('chooses only among live user turns', () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/slash.ts` | Exports `SESSION_COMPRESS_TIMEOUT_MS, useSlashCommand`. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/steering-recovery.test.tsx` | Test file (no top-level title found). |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/steering-undelivered-refusal.test.tsx` | it('redirectPrompt still surfaces a refusal that may have reached the turn', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/submission-destination.test.tsx` | describe('submission intent destinations', () => { — it('separate mounted composers submit identical text as distinct intents while an explicit retry retains its payload', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/submit-unknown-receipt.test.tsx` | it('an exact retry answered `unknown` keeps the bubble, retires the retry identity and never replays', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/submit-view-binding.test.ts` | it('moves the pane and carries the selected conversation into an empty resumed runtime', (): void => { — it('recognizes the same conversation after compression rotates its stored id', (): void => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/submit-voice-stopped.test.tsx` | it('a voice_stopped receipt settles the send with no turn, no error and no retained retry', async () => { — it('a voice_stopped receipt on the identityless legacy fallback settles the send too', asyn… |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/submit.ts` | Exports `ResumedRuntimeBindingDeps, rebindPaneToResumedRuntime, useSubmitPrompt`. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/upload-composer-attachment.test.ts` | describe('uploadComposerAttachment remote read failures', () => { — it('turns the raw 16MB IPC cap error into a friendly remote-gateway message', async () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/upload-server-image.ts` | Upload an image attachment over HTTP for a server-owned composer queue. * Pin HTTP to the same owner before the native byte read yields. |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/utils.test.ts` | describe('recent interrupt cooldown', () => { — it('is true within the cooldown and false after expiry', () => { |
| `apps/desktop/src/app/session/hooks/use-prompt-actions/utils.ts` | Exports `GatewayRequest, delay, isSessionIdCandidate, blobToDataUrl, isProviderSetupError, inlineErrorMessage`. |
| `apps/desktop/src/app/session/hooks/use-route-resume.test.tsx` | describe('useRouteResume', () => { — it('does not resume stale routed session A while the create guard holds selection on B (#66057)', () => { |
| `apps/desktop/src/app/session/hooks/use-route-resume.ts` | Exports `useRouteResume`. |
| `apps/desktop/src/app/session/hooks/use-session-actions.creating-session-hold.test.tsx` | describe('createBackendSessionForSend creatingSessionRef hold (#66057)', () => { — it('keeps creatingSessionRef true until routedSessionId catches up to the created stored id', async () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions.test.tsx` | describe('desktop branch creation idempotency', () => { — it('coalesces duplicate stored-session branch attempts onto one backend child', async () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/ambient-local-owner.test.tsx` | describe('untagged resume ambient owner', () => { — it('does not remember the foreground source for a session it could not resolve', async () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/branch-approval-owner.test.tsx` | describe('forkBranch approval-chip owner scoping', () => { — it("keeps the active profile's approval chip when branching a chat another profile owns", async () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/branch-boundary.test.ts` | test('branching from a folded assistant bubble keeps through its last durable row, not its first', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/branch-boundary.ts` | The durable row a message-level branch keeps through: the highest row id the selected bubble * shows. |
| `apps/desktop/src/app/session/hooks/use-session-actions/branch-create-key.ts` | Exports `branchCreateKey`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/create-overrides.ts` | Renderer-only handoff, fired at the stored-id assignment before navigation. |
| `apps/desktop/src/app/session/hooks/use-session-actions/created-this-run.ts` | // Stored ids created in THIS renderer run. |
| `apps/desktop/src/app/session/hooks/use-session-actions/credential-warning-onboarding.test.ts` | describe('applyRuntimeInfo credential warning while onboarding is open', () => { — it('drops the warning: onboarding owns the first run', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/display-hydration.ts` | Navigation revokes the view, not a read owned by an unchanged session. |
| `apps/desktop/src/app/session/hooks/use-session-actions/index.ts` | Exports `BranchLoadedSessionOptions, useSessionActions`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/live-turn-remainder.test.ts` | it('extends one response across arbitrary chunk cuts without changing its tool or text occurrences', () => { — it('settles a matching partial error without discarding richer local parts or distinct f… |
| `apps/desktop/src/app/session/hooks/use-session-actions/live-turn-remainder.ts` | Whitespace normalization is for comparison only; cuts always address the original text. |
| `apps/desktop/src/app/session/hooks/use-session-actions/pending-turn-identity.ts` | A hydrated bubble can contain several source rows, including the final reply. |
| `apps/desktop/src/app/session/hooks/use-session-actions/persisted-live-turn.ts` | Exports `reconcilePersistedLiveTurn`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/pinned-session-removal.test.tsx` | Test file (no top-level title found). |
| `apps/desktop/src/app/session/hooks/use-session-actions/provisional-transcript.ts` | Exports `transcriptRestScope, provisionalTranscriptPaint`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/remembered-owner.test.ts` | describe('rememberedOwnerForResume', () => { — it('keeps the hint of a session with no row (hidden Bot Chat)', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/remembered-owner.ts` | The persisted owner hint a pathname-driven resume may still trust, repairing a stale one in * the map so it cannot re-poison the next resume or a session-scoped RPC dispatch. |
| `apps/desktop/src/app/session/hooks/use-session-actions/remove-archived-session.test.tsx` | describe('removeSession × archived view store', () => { — it('evicts the row from $archivedSessions on successful delete', async () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/resolve-stored-session.test.ts` | describe('resolveStoredSession profile ownership', () => { — it('returns a cached row that carries an owning profile', async () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/restore-pending-approval.ts` | Re-park a resume snapshot's pending approval; true when one was restored. |
| `apps/desktop/src/app/session/hooks/use-session-actions/restore-pending-clarify.test.ts` | describe('restorePendingClarifyFromSnapshot', () => { — it('hands back the card the request handler already parked for a replayed open clarify request', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/restore-pending-clarify.ts` | Exports `PendingClarifyResumeState, restorePendingClarifyFromSnapshot, pendingClarifyToolPayload`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/restore-pending-connection.ts` | Exports `PendingConnectionResumeState, restorePendingConnectionFromSnapshot, connectionRequestToolPayload, projectPendingConnection`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/resume-empty-prose-pairing.test.ts` | describe('reconcileResumeMessages — empty-prose pairing', () => { — it('does not graft a later cached structure onto an earlier tool-only row with empty prose', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/resume-owner.ts` | Connection that supplied the current session list, captured before resume's * async metadata lookup. |
| `apps/desktop/src/app/session/hooks/use-session-actions/resume-structural-parts.test.ts` | describe('reconcileResumeMessages — structural parts on a mid-turn switch', () => { — it('keeps tool-call parts the authoritative text-only row cannot carry', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/resume-verdicts.ts` | // A "session genuinely doesn't exist" failure (deleted, or an id from a wiped / // rotated backend) — the REST transcript 404s with `Session not found`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/runtime-owner.test.ts` | describe('applyRuntimeInfo approval mode owner scoping', () => { — it('never lets another backend runtime set the active profile approval chip', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/runtime-owner.ts` | // Runtime-info ownership for applyRuntimeInfo: the status-bar approval chip // is keyed by the ACTIVE profile's name, so only the active gateway's runtime // may reconcile it. |
| `apps/desktop/src/app/session/hooks/use-session-actions/session-create-request.test.ts` | describe('createGatewaySession', () => { — it('resends once without cwd_explicit (cwd kept) when a pre-#122899 backend rejects the flag', async () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/session-create-request.ts` | Exports `createGatewaySession, desktopSessionCreateParams`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/streamed-reply-survives-sync.test.ts` | describe('preserveLocalPendingTurnMessages — settled reply over an empty tool shell (#123047)', () => { — it('keeps the streamed final reply when the stored turn hydrates as a text-less tool shell', … |
| `apps/desktop/src/app/session/hooks/use-session-actions/transcript-provenance.test.ts` | describe('transcript provenance', () => { — it('matches only the same connection, profile, stored id, and lineage', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/transcript-provenance.ts` | Exports `TranscriptProvenanceScope, createPersistedDisplayTranscriptProvenance, hasPersistedDisplayTranscriptProvenance, withoutTranscriptProvenance, invalidatePersistedDisplayTranscriptAuthority, TranscriptViewCutoff`. |
| `apps/desktop/src/app/session/hooks/use-session-actions/unarchive-session.test.tsx` | describe('unarchiveSession', () => { — it('restores an archived row: flips the RPC off, drops the view row, resurfaces it in the sidebar', async () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/utils.test.ts` | describe('applyRuntimeInfo approval mode', () => { — it('reconciles session.info against the gateway profile', () => { |
| `apps/desktop/src/app/session/hooks/use-session-actions/utils.ts` | Exports `isStrictAnswerTextExtension, chatPartsEquivalent, chatReactionsEquivalent, chatMessagesEquivalent, chatMessageArraysEquivalent, preserveEquivalentTranscript`. |
| `apps/desktop/src/app/session/hooks/use-session-list-actions.reactivation.test.tsx` | it('keeps the default-profile sidebar when the active route is re-activated mid-refresh', async () => { |
| `apps/desktop/src/app/session/hooks/use-session-list-actions.test.tsx` | describe('workspace-only sidebar refresh', () => { — describe('refreshSessions cold-start load error', () => { |
| `apps/desktop/src/app/session/hooks/use-session-list-actions.ts` | Exports `useSessionListActions`. |
| `apps/desktop/src/app/session/hooks/use-session-state-cache.test.tsx` | describe('useSessionStateCache — stored-id rotation provenance', () => { — it('emits the previous, next, and runtime ids and removes the stale reverse mapping', () => { |
| `apps/desktop/src/app/session/hooks/use-session-state-cache.ts` | Exports `useSessionStateCache`. |
| `apps/desktop/src/app/session/hooks/use-transcript-peer-sync.test.tsx` | describe('useTranscriptPeerSync (#65047)', () => { — it('re-pulls the transcript when a peer finishes a turn on the viewed session', async () => { |
| `apps/desktop/src/app/session/hooks/use-transcript-peer-sync.ts` | Exports `useTranscriptPeerSync`. |
| `apps/desktop/src/app/session/hooks/warm-resume-replay-barrier.test.tsx` | it('waits for reconnect replay before activating and reading warm history', async () => { — it('still settles a warm resume through session.activate when its replay socket is lost', async () => { |
| `apps/desktop/src/app/session/hooks/wrong-session-closeout.test.tsx` | it('a background chat’s delayed stored-id rotation never moves the user off the tile they are on', async () => { |
| `apps/desktop/src/app/session/new-session-route.ts` | Exports `defaultNewSessionTarget, prepareDefaultNewSession`. |
| `apps/desktop/src/app/session/session-state-cache.test.ts` | describe('SessionStateCache', () => { — it('bounds warm settled transcripts by LRU count and cleans ownership atomically', () => { |
| `apps/desktop/src/app/session/session-state-cache.ts` | Exports `DEFAULT_WARM_SESSION_TRANSCRIPT_COUNT, DEFAULT_WARM_SESSION_TRANSCRIPT_BYTES, SessionStateCache`. |
| `apps/desktop/src/app/session/workspace-session-target.test.ts` | describe('startWorkspaceSession', () => { — it('keeps a newer sidebar target when an older project lookup resolves', async () => { |
| `apps/desktop/src/app/session/workspace-session-target.ts` | Exports `startWorkspaceSession`. |
| `apps/desktop/src/app/settings/about-settings.test.tsx` | describe('AboutSettings', (): void => { — it('shows shared version details and refreshes each remote gateway independently', (): void => { |
| `apps/desktop/src/app/settings/about-settings.tsx` | Exports `AboutSettings`. |
| `apps/desktop/src/app/settings/appearance-contrib.test.tsx` | describe('AppearanceExtraSlot', () => { — it('renders nothing when empty, then mounts a late registration in place', () => { |
| `apps/desktop/src/app/settings/appearance-contrib.tsx` | Appearance settings' plugin seam — a render area at the END of the * Appearance page, so a plugin adds its own controls (session-colour rules, * theme extras) with the app's own primitives … |
| `apps/desktop/src/app/settings/appearance-settings.extra-slot.test.tsx` | describe('AppearanceSettings extra slot', () => { — it('mounts plugin extras on the top-level page only, not on deep-link subpages', () => { |
| `apps/desktop/src/app/settings/appearance-settings.tsx` | Exports `AppearanceSettings`. |
| `apps/desktop/src/app/settings/appearance-subpages.ts` | Exports `APPEARANCE_SUBPAGES, AppearanceSubpageId`. |
| `apps/desktop/src/app/settings/aux-task-rows.tsx` | // Built-in auxiliary tasks, in the order `_AUX_TASK_SLOTS` (hermes_cli/web_server_config.py) // serves them. |
| `apps/desktop/src/app/settings/billing/account-row-value.tsx` | Exports `RowValue`. |
| `apps/desktop/src/app/settings/billing/api.test.ts` | describe('createBillingApi', () => { — it('passes successful RPC results through as data', async () => { |
| `apps/desktop/src/app/settings/billing/api.ts` | Exports `BillingErrorKind, BillingRefusal, BillingResult, BillingChargeResult, UpdateAutoReloadInput, BillingRequestGateway`. |
| `apps/desktop/src/app/settings/billing/auto-reload-row.tsx` | Exports `AutoReloadRow`. |
| `apps/desktop/src/app/settings/billing/billing-amounts.ts` | Exports `clampAmount, parseAmount, formatAmountForRequest, initialAutoReloadAmount, validateAutoReloadInputs, validateBillingAmount`. |
| `apps/desktop/src/app/settings/billing/current-plan-card.tsx` | Exports `CurrentPlanCard`. |
| `apps/desktop/src/app/settings/billing/dev-fixtures.ts` | Exports `todayBillingState, todaySubscriptionState, postTrainBillingState, postTrainSubscriptionState, loggedOutBillingState, loggedOutSubscriptionState`. |
| `apps/desktop/src/app/settings/billing/errors.test.ts` | describe('resolveRefusal', () => { — it('maps every known refusal kind to copy and the expected action', () => { |
| `apps/desktop/src/app/settings/billing/errors.ts` | Exports `BillingRefusalPresentation, resolveRefusal`. |
| `apps/desktop/src/app/settings/billing/fixtures.test-util.ts` | Exports `okBilling, okSubscription, endpointUnavailableBilling, endpointUnavailableSubscription`. |
| `apps/desktop/src/app/settings/billing/index.test.tsx` | describe('BillingSettings', () => { — it('changes billing shell language without losing the credit amount or issuing a charge', async () => { |
| `apps/desktop/src/app/settings/billing/index.tsx` | Exports `BILLING_VIEWS, BillingSubView, BillingSettings`. |
| `apps/desktop/src/app/settings/billing/inline-feedback.tsx` | Exports `StepUpInlineAction, BillingRefusalInline`. |
| `apps/desktop/src/app/settings/billing/open-external.ts` | // Optional-arg convenience over the canonical opener — the billing rows pass // possibly-undefined URLs straight through from their view models. |
| `apps/desktop/src/app/settings/billing/plans-view.tsx` | Exports `BillingPlansView`. |
| `apps/desktop/src/app/settings/billing/simulated-api.test.ts` | describe('createSimulatedBillingApi', () => { — it('progresses the pending state through the whole loop: schedule sets it, resume clears it', async () => { |
| `apps/desktop/src/app/settings/billing/simulated-api.ts` | The shape of one `billingDevFixtures` entry — a canned billing + subscription pair. |
| `apps/desktop/src/app/settings/billing/tier-art.test.ts` | describe('resolveTierArt', () => { — it('keys art by lowercase tier name, case-insensitively', () => { |
| `apps/desktop/src/app/settings/billing/tier-art.tsx` | // Reproduces the portal's tier-card hero treatment at thumbnail size: each webp sits // over a solid Nous-blue well and blends into it. |
| `apps/desktop/src/app/settings/billing/types.ts` | Exports `BillingStateResponse`. |
| `apps/desktop/src/app/settings/billing/use-billing-state.test.ts` | describe('deriveBillingView', () => { — it('derives the deployed-today shape with fail-open disabled charge controls', () => { |
| `apps/desktop/src/app/settings/billing/use-billing-state.ts` | Exports `EMPTY_BILLING_VALUE, FALLBACK_PORTAL_BILLING_URL, FALLBACK_PORTAL_URL, BillingSummaryItemView, BillingNoticeView, BillingRowActionView`. |
| `apps/desktop/src/app/settings/billing/use-charge-poller.test.ts` | describe('pollChargeSettlement', () => { — it('settles after pending polls', async () => { |
| `apps/desktop/src/app/settings/billing/use-charge-poller.ts` | Exports `CHARGE_POLL_INTERVAL_MS, CHARGE_POLL_CAP_MS, ChargeFlowPhase, ChargeFlowOutcome, ChargePollClock, ChargePollOptions`. |
| `apps/desktop/src/app/settings/billing/use-step-up.test.tsx` | describe('useStepUpFlow', () => { — it('subscribes for verification, opens the verification URL, cleans up, and invalidates on completion', async () => { |
| `apps/desktop/src/app/settings/billing/use-step-up.ts` | Exports `StepUpPhase, StepUpVerification, StepUpMessage, useStepUpFlow`. |
| `apps/desktop/src/app/settings/billing/use-subscription-change.test.tsx` | describe('useDowngradeFlow', () => { — it('records a preview refusal as the previewFailed phase and re-runs on retry', async () => { |
| `apps/desktop/src/app/settings/billing/use-subscription-change.ts` | Exports `DowngradeTarget, DowngradePhase, ActiveDowngrade, useDowngradeFlow, useResumeFlow`. |
| `apps/desktop/src/app/settings/browser-real-profile-panel.test.tsx` | describe('BrowserRealProfilePanel', () => { — it('renders off for a config without the key and turns it on', async () => { |
| `apps/desktop/src/app/settings/browser-real-profile-panel.tsx` | Exports `readUseRealProfile, BrowserRealProfilePanel`. |
| `apps/desktop/src/app/settings/chat-font-setting.test.tsx` | describe('ChatFontSetting', () => { — it('publishes the live family and persists only desktop.font_family, keeping sibling keys', async () => { |
| `apps/desktop/src/app/settings/chat-font-setting.tsx` | Exports `ChatFontSetting`. |
| `apps/desktop/src/app/settings/cloud-team-change.ts` | // `org` values are the refs NAS echoes (`slug ?? id`) and are compared as // opaque strings. |
| `apps/desktop/src/app/settings/combobox-input.tsx` | // cmdk highlights its first row whenever nothing is selected, which would make // Enter swap free text for that row. |
| `apps/desktop/src/app/settings/computer-use-panel.tsx` | Exports `ComputerUsePanel`. |
| `apps/desktop/src/app/settings/config-field-voice-locale.test.tsx` | it('renders the translated Echo Transcripts copy without changing its toggle value', () => { — it('preserves distinct Unicode descriptions but suppresses label and schema-key repetitions', () => { |
| `apps/desktop/src/app/settings/config-field.test.ts` | describe('parseListFieldDraft', () => { — it('commits comma-separated list values after editing', () => { |
| `apps/desktop/src/app/settings/config-field.tsx` | Exports `parseListFieldDraft, ConfigField`. |
| `apps/desktop/src/app/settings/config-settings.test.tsx` | describe('ConfigSettings autosave', () => { — it('sends a later revert instead of diffing it away against the stale page-load baseline', async () => { |
| `apps/desktop/src/app/settings/config-settings.tsx` | Exports `ConfigSettings`. |
| `apps/desktop/src/app/settings/config-subpages.ts` | Exports `CONFIG_SUBPAGES, configSubpageForField`. |
| `apps/desktop/src/app/settings/connections-registry.test.tsx` | describe('ConnectionsRegistrySection', () => { — it('preserves, replaces and deletes stored headers through plaintext consent without selecting a source', async () => { |
| `apps/desktop/src/app/settings/connections-registry.tsx` | Exports `normalizeGatewayUrl, sshCompositeKey, findDuplicateConnection, sameBackendPeerLabel, ConnectionsRegistrySection`. |
| `apps/desktop/src/app/settings/constants.ts` | Exports `EMPTY_SELECT_VALUE, CONTROL_TEXT, PROVIDER_GROUPS, ENUM_OPTIONS, FREE_INPUT_KEYS, FIELD_LABELS`. |
| `apps/desktop/src/app/settings/credential-key-ui.tsx` | Matches Advanced / config field controls (ListRow + Input). |
| `apps/desktop/src/app/settings/custom-endpoints-settings.test.tsx` | describe('CustomEndpointsSettings', () => { — it('localizes endpoint editing on language changes without changing transport or draft identifiers', async () => { |
| `apps/desktop/src/app/settings/custom-endpoints-settings.tsx` | Exports `CustomEndpointsSettings`. |
| `apps/desktop/src/app/settings/delegation-model-provider-field.test.tsx` | describe('DelegationModelProviderField', () => { — it('renders "Inherit from main agent" by default when both fields are empty', async () => { |
| `apps/desktop/src/app/settings/delegation-model-provider-field.tsx` | Exports `DelegationModelProviderField`. |
| `apps/desktop/src/app/settings/delegation-route-regressions.test.tsx` | describe('delegation route regressions', () => { — it('requests the exact config owner', async () => { |
| `apps/desktop/src/app/settings/delegation-route-row.tsx` | `delegation.provider` renders inside the `delegation.model` row, which applies both at once. |
| `apps/desktop/src/app/settings/delegation-settings-integration.test.tsx` | describe('real settings route and autosave integration', () => { — it('active A/settings B reads and saves B, never autosaves an unfinished route', async () => { |
| `apps/desktop/src/app/settings/env-credentials.tsx` | // Shared filter used by every credential surface (Providers + Keys pages): // category gate first, then a free-text match across key name + description. |
| `apps/desktop/src/app/settings/env-var-actions-menu.tsx` | Exports `EnvVarActionsMenu, EnvVarContextMenu, EnvVarActionsTrigger`. |
| `apps/desktop/src/app/settings/fallback-models-field.test.tsx` | describe('FallbackModelsField', () => { — it('renders each {provider, model} entry as its own row (never "[object Object]")', async () => { |
| `apps/desktop/src/app/settings/field-copy.ts` | Exports `FieldCopyTree, schemaKeyToFieldCopyKey, fieldCopyForSchemaKey, defineFieldCopy`. |
| `apps/desktop/src/app/settings/file-browser-setting.test.tsx` | describe('File Browser setting', () => { — it('turns the file browser on and off, and persists the choice', () => { |
| `apps/desktop/src/app/settings/gateway-settings.test.ts` | describe('normalizeGatewaySettingsState', () => { — it('fills missing and undefined persisted fields with canonical defaults', () => { |
| `apps/desktop/src/app/settings/gateway-settings.test.tsx` | describe('GatewaySettings', () => { — it('releases a pending save after a late probe invalidates its response', async () => { |
| `apps/desktop/src/app/settings/gateway-settings.tsx` | Exports `GatewaySettingsState, normalizeGatewaySettingsState, savedCloudConnectionUrl, GatewaySettings`. |
| `apps/desktop/src/app/settings/helpers.test.ts` | describe('settings helpers', () => { — it('does not shadow the backend schema options for memory.provider', () => { |
| `apps/desktop/src/app/settings/helpers.ts` | // Canonical implementations live in @/lib/text; re-exported here so the many // settings/capabilities call sites keep their import path. |
| `apps/desktop/src/app/settings/hud-modifier-settings.test.tsx` | it('requires explicit opt-in and native readiness, with permission recovery and stale-read protection', async () => { — it('rereads after an unconfirmed write and keeps failed reads recoverable', asy… |
| `apps/desktop/src/app/settings/hud-modifier-settings.tsx` | Exports `HudModifierSettings`. |
| `apps/desktop/src/app/settings/index.tsx` | Exports `SettingsView`. |
| `apps/desktop/src/app/settings/keybind-settings.late-actions.test.tsx` | describe('KeybindSettings late-contributed actions', () => { — it('lists an action whose keybind registers after mount', () => { |
| `apps/desktop/src/app/settings/keybind-settings.tsx` | Exports `KeybindSettings`. |
| `apps/desktop/src/app/settings/keys-settings.test.tsx` | describe('KeysSettings', () => { — it('fetches env vars for the displayed profile (the concrete key, never null) when unscoped', async () => { |
| `apps/desktop/src/app/settings/keys-settings.tsx` | // Sub-views surfaced as sidebar subnav under Tools & Keys (see settings/index.tsx). |
| `apps/desktop/src/app/settings/local-model-download-progress.test.tsx` | describe('LocalModelDownloadActions', () => { — it('running download without explicit can_pause shows NO control (no guessing about old backends)', () => { |
| `apps/desktop/src/app/settings/local-model-download-progress.tsx` | Exports `ProgressBar, gbLabel, DownloadStatusCopy, DownloadEtaCopy, formatSpeed, formatEta`. |
| `apps/desktop/src/app/settings/local-models-actions.ts` | Exports `LocalModelsCopy, LocalModelsActionScope, useLocalModelsActionScope, isActiveStatus, runQuickstart, downloadCatalogModel`. |
| `apps/desktop/src/app/settings/local-models-browse.tsx` | Exports `LocalModelsBrowseSection`. |
| `apps/desktop/src/app/settings/local-models-hardware-section.tsx` | Exports `LocalModelsHardwareSectionProps, LocalModelsHardwareSection`. |
| `apps/desktop/src/app/settings/local-models-model-rows.tsx` | Exports `CatalogModelRowProps, CatalogModelRow, SideloadedModelRowProps, SideloadedModelRow`. |
| `apps/desktop/src/app/settings/local-models-models-section.tsx` | // Catalog display order: what runs well leads. Resident (all on GPU) // first, then spilled (works, slower), then doesn't-fit; catalog order // (recommended first) holds within each band. |
| `apps/desktop/src/app/settings/local-models-owner.ts` | // The pane remounts per owner and every request inside it must stay pinned to // the owner it mounted with; re-deriving from the live stores in a child // could retarget an in-flight actio… |
| `apps/desktop/src/app/settings/local-models-quickstart.tsx` | Exports `LocalModelsQuickstartProps, LocalModelsQuickstart`. |
| `apps/desktop/src/app/settings/local-models-runtime-section.tsx` | Exports `LocalModelsRuntimeSectionProps, LocalModelsRuntimeSection`. |
| `apps/desktop/src/app/settings/local-models-settings.test.tsx` | describe('LocalModelsSettings', () => { — it('keeps a failed explicit update visible with a direct retry and no staged models', async () => { |
| `apps/desktop/src/app/settings/local-models-settings.tsx` | Exports `LocalModelsSettings`. |
| `apps/desktop/src/app/settings/managed-updates-section.tsx` | Exports `ManagedUpdatesSection`. |
| `apps/desktop/src/app/settings/memory/connect.tsx` | Exports `MemoryConnect`. |
| `apps/desktop/src/app/settings/memory/field-control.tsx` | // Fade the placeholder well below set values so example text never reads as data. |
| `apps/desktop/src/app/settings/memory/provider-config-modal.test.tsx` | describe('ProviderConfigModal', () => { — it('renders every field grouped, including inline ones, with kind-specific controls', async () => { |
| `apps/desktop/src/app/settings/memory/provider-config-modal.tsx` | Exports `ProviderConfigModal`. |
| `apps/desktop/src/app/settings/memory/provider-config-panel.test.tsx` | describe('ProviderConfigPanel', () => { — it('hides fields that are not marked inline', async () => { |
| `apps/desktop/src/app/settings/memory/provider-config-panel.tsx` | // Inline fields only: the compact panel must never re-write modal-owned keys. |
| `apps/desktop/src/app/settings/minimize-to-tray-setting.test.tsx` | test('native truth drives both mounted settings rows and survives remount without renderer writes', async () => { — test('failed writes roll back visibly, and an older initial read cannot overwrite a… |
| `apps/desktop/src/app/settings/minimize-to-tray-setting.tsx` | Exports `MinimizeToTraySetting`. |
| `apps/desktop/src/app/settings/model-select.tsx` | // Radix <Select> renders a blank trigger when `value` matches no <SelectItem>. // A custom model (e.g. |
| `apps/desktop/src/app/settings/model-settings.test.tsx` | describe('ModelSettings profile scope', () => { — it('follows the active profile (undefined, never null) when unscoped', async () => { |
| `apps/desktop/src/app/settings/model-settings.tsx` | Exports `ModelSettingsSkeleton, moaSlotComplete, moaConfigComplete, staleAuxAssignments, ModelSettings`. |
| `apps/desktop/src/app/settings/moved-tabs.test.ts` | describe('movedSettingsTabRedirect', () => { — it('sends the retired Settings MCP tab to Capabilities, keeping the row selector', () => { |
| `apps/desktop/src/app/settings/moved-tabs.ts` | // `plugins` used to redirect here too; it is a live Settings view again // (Settings ▸ Plugins = each plugin's own settings pages). |
| `apps/desktop/src/app/settings/notifications-settings.tsx` | Exports `NotificationsSettings`. |
| `apps/desktop/src/app/settings/onboarding-settings.test.tsx` | describe('Settings > Run onboarding again', () => { — it('replays the whole first-run intro in a new chat', async () => { |
| `apps/desktop/src/app/settings/onboarding-settings.tsx` | Advanced → Run onboarding again. |
| `apps/desktop/src/app/settings/other-subpages.ts` | // Pages with separate tasks expose content-only subpages. |
| `apps/desktop/src/app/settings/pet-settings.tsx` | Exports `PetSettings`. |
| `apps/desktop/src/app/settings/plugin-install-details.tsx` | Exports `PinState, ProfileState, PluginInstallDetails`. |
| `apps/desktop/src/app/settings/plugin-install-modal.test.tsx` | describe('A reviewed catalog pick', () => { — it('shows only name, one line and Verified until Advanced reveals source, version and profile', async () => { |
| `apps/desktop/src/app/settings/plugin-install-modal.tsx` | Exports `PluginInstallModal`. |
| `apps/desktop/src/app/settings/plugin-install-run.ts` | Exports `ProbeResult, InstallModalCopy, InstallComponents, installComponents, desktopHalfFromPackage, InstallPlan`. |
| `apps/desktop/src/app/settings/plugin-settings-form.test.tsx` | describe('PluginSettingsForm (#46600, #87934)', () => { — it('renders one control per schema type from the table, secrets masked with no value echoed', () => { |
| `apps/desktop/src/app/settings/plugin-settings-form.tsx` | // A plugin manifest's `config_schema` rendered as a form. |
| `apps/desktop/src/app/settings/plugin-settings-ownership.test.tsx` | describe('Settings ▸ Plugins ownership (review of #133182)', () => { — it('drops the old profile’s draft on a profile switch and never saves it into the new profile', async () => { |
| `apps/desktop/src/app/settings/plugin-settings.test.tsx` | describe('Settings ▸ Plugins', () => { — it('lists every plugin with settings and walks into a sub-page, WoW-AddOns style', async () => { |
| `apps/desktop/src/app/settings/plugin-settings.tsx` | Exports `OpenPluginSettings, PLUGINS_NAV_ICON, PAGE_SCOPED_PARAMS, usePluginSettingsRoute, usePluginSettingsEntries, pluginSettingsNavChildren`. |
| `apps/desktop/src/app/settings/primitives.tsx` | // The settings shell owns page titles; embedded callers retain their headings. |
| `apps/desktop/src/app/settings/profile-scope.test.tsx` | describe('SettingsProfileScope', () => { — it('renders nothing with fewer than two profiles', () => { |
| `apps/desktop/src/app/settings/profile-scope.tsx` | Exports `settingsScopeLabel, ScopeChip, SettingsProfileScope, ActiveProfileNote`. |
| `apps/desktop/src/app/settings/providers-settings.terminal-disconnect.test.tsx` | describe('connected external provider row', () => { — it('runs the terminal control as disconnect instead of starting sign-in', async () => { |
| `apps/desktop/src/app/settings/providers-settings.test.tsx` | describe('ProvidersSettings', () => { — it('reads and saves API keys for the shared Settings target and reloads when it changes', async () => { |
| `apps/desktop/src/app/settings/providers-settings.tsx` | Exports `PROVIDER_VIEWS, ProviderView, ProvidersSettings`. |
| `apps/desktop/src/app/settings/quick-entry-settings.tsx` | Exports `QuickEntrySettings`. |
| `apps/desktop/src/app/settings/screenshot-settings.test.tsx` | describe('ScreenshotSettings', () => { — it('requires opt-in and explicit permission retry before claiming the shortcut is ready', async () => { |
| `apps/desktop/src/app/settings/screenshot-settings.tsx` | Exports `ScreenshotSettings`. |
| `apps/desktop/src/app/settings/searchable-select.test.tsx` | describe('rankSearchOption', () => { — it('ranks a final-segment match above a mid-path match', () => { |
| `apps/desktop/src/app/settings/searchable-select.tsx` | Exports `rankSearchOption, SearchableSelect`. |
| `apps/desktop/src/app/settings/sessions-settings.test.tsx` | describe('SessionsSettings unarchive', () => { — it('restores a messaging-source session into $messagingSessions, not $sessions', async () => { |
| `apps/desktop/src/app/settings/sessions-settings.tsx` | Exports `SessionsSettings`. |
| `apps/desktop/src/app/settings/settings-manifest.ts` | Exports `SettingDefinition, SETTINGS_MANIFEST, ManifestViewKey, manifestView, settingId, notificationKindSettingId`. |
| `apps/desktop/src/app/settings/settings-search.test.ts` | describe('settings search index', () => { — it('builds config results from renderable schema fields with exact deep links', () => { |
| `apps/desktop/src/app/settings/settings-search.ts` | Exports `CredentialSettingsView, SettingsSearchTarget, SettingsSearchEntry, credentialSettingsView, buildConfigSearchEntries, buildCredentialSearchEntries`. |
| `apps/desktop/src/app/settings/shared-metrics-settings.test.tsx` | describe('SharedMetricsSettings', () => { — it('is one switch: on shares (both opt-ins), off clears both', async () => { |
| `apps/desktop/src/app/settings/shared-metrics-settings.tsx` | Exports `SharedMetricsSettings`. |
| `apps/desktop/src/app/settings/ssh-host-selection.test.ts` | describe('selectSshHost', () => { — it('clears host-specific fields when the selected host changes', () => { |
| `apps/desktop/src/app/settings/ssh-host-selection.ts` | type SshHostState = { sshHost: string sshUser: string sshPort: number / null sshKeyPath: string |
| `apps/desktop/src/app/settings/stale-aux-dismissal.test.ts` | describe('staleAuxFingerprint', () => { — it('binds the acknowledgement to the main provider and the pinned slots', () => { |
| `apps/desktop/src/app/settings/stale-aux-dismissal.ts` | // Acknowledged stale-aux banner. The warning exists to catch a forgotten pin // silently billing a dead provider; a user with a deliberate cross-provider // pin (e.g. |
| `apps/desktop/src/app/settings/subagents-destination.test.ts` | describe('Subagents settings destination', () => { — it('distinguishes Subagents from Mixture of Agents in navigation', () => { |
| `apps/desktop/src/app/settings/subpage-navigation.tsx` | Exports `SettingsSubpageHeader`. |
| `apps/desktop/src/app/settings/subpages.test.ts` | describe('settings subpage routing', () => { — it('opens the first ordered child for parents and keeps explicit child destinations', () => { |
| `apps/desktop/src/app/settings/subpages.ts` | Exports `SettingsSubpage, settingsSubpageIcon, settingsSubpages, settingsSubpageForTarget, settingsSubpageForLegacyLink, resolveSettingsSubpage`. |
| `apps/desktop/src/app/settings/terminal-backend-panel.test.tsx` | describe('TerminalBackendPanel', () => { — it('reads and writes the profile currently selected by Capabilities', async () => { |
| `apps/desktop/src/app/settings/terminal-backend-panel.tsx` | Exports `TerminalBackendPanel`. |
| `apps/desktop/src/app/settings/terminal-font-setting.test.tsx` | describe('TerminalFontSetting', () => { — it('selects MesloLGS NF and persists only the terminal font field', async () => { |
| `apps/desktop/src/app/settings/terminal-font-setting.tsx` | Exports `TerminalFontSetting`. |
| `apps/desktop/src/app/settings/test-utils.ts` | An unset secret in `category`. The Keys tab and the settings search both * bucket by category and branch on `is_set`, so those are what tests vary. |
| `apps/desktop/src/app/settings/toolset-config-panel.test.tsx` | describe('ToolsetConfigPanel', () => { — it('renders inline voice/model fields for a TTS provider row carrying tts_provider', async () => { |
| `apps/desktop/src/app/settings/toolset-config-panel.tsx` | Exports `ToolsetConfigPanel`. |
| `apps/desktop/src/app/settings/types.ts` | Exports `SettingsView, EnvPatch, SettingsPageProps, ProviderGroup, DesktopConfigSection, EnvRowProps`. |
| `apps/desktop/src/app/settings/uninstall-section.test.tsx` | it('keeps owned-install removal modes and confirms the selected mode', async (): Promise<void> => { — it('shows native removal steps, data location, and Apps settings on a managed Windows install', a… |
| `apps/desktop/src/app/settings/uninstall-section.tsx` | Exports `UninstallSection`. |
| `apps/desktop/src/app/settings/update-channel-row.tsx` | Exports `UpdateChannelRow`. |
| `apps/desktop/src/app/settings/use-deep-link-highlight.ts` | Exports `useDeepLinkHighlight`. |
| `apps/desktop/src/app/settings/use-plugin-probe.ts` | Exports `usePluginProbe`. |
| `apps/desktop/src/app/settings/use-setting-deep-link.ts` | Land a palette hit (`?setting=<id>`) on a manifest row of this view: once * the row's subpage is showing, scroll to it and flash it. |
| `apps/desktop/src/app/settings/use-settings-search.ts` | An installed plugin row, deep-linkable as `/capabilities?tab=plugins&plugin=<id>`. |
| `apps/desktop/src/app/settings/vault-settings.owner.test.tsx` | it('a master-password draft is wiped on a profile switch and never submitted to the new owner', async () => { — it('a late list response from profile A never paints under profile B', async () => { |
| `apps/desktop/src/app/settings/vault-settings.test.tsx` | describe('VaultSettings', () => { — it('routes every vault RPC through the active connection, not a bare profile name', async () => { |
| `apps/desktop/src/app/settings/vault-settings.tsx` | Exports `vaultOwnerKey, VaultSourceName, VaultSource, VaultKind, VaultPrefill, VaultSettings`. |
| `apps/desktop/src/app/settings/voice-field-visible.test.ts` | describe('voiceFieldVisible', () => { — it('always shows top-level + non-provider keys', () => { |
| `apps/desktop/src/app/settings/voice-provider-fields.test.ts` | describe('voiceProviderKeys', () => { — it('covers every built-in TTS provider the Capabilities picker offers', () => { |
| `apps/desktop/src/app/settings/voice-provider-fields.tsx` | Exports `voiceProviderKeys, VoiceProviderFields`. |
| `apps/desktop/src/app/settings/with-active.test.ts` | describe('withActive', () => { — it('prepends a custom model missing from the curated list', () => { |
| `apps/desktop/src/app/shell/approval-mode-menu.test.tsx` | describe('approval mode statusbar item', () => { — it('writes the selected mode through the gateway and updates its shared trigger label', async () => { |
| `apps/desktop/src/app/shell/approval-mode-menu.tsx` | Exports `useApprovalModeStatusbarItem`. |
| `apps/desktop/src/app/shell/butterbar.css` | /* One tint drives the whole bar. A tone picks a palette token; a custom `color` sets --bb-tint inline. |
| `apps/desktop/src/app/shell/butterbar.tsx` | Exports `Butterbar`. |
| `apps/desktop/src/app/shell/context-usage-panel.test.tsx` | describe('useContextBreakdown', () => { — it('fetches for a session that has not run a turn yet', async () => { |
| `apps/desktop/src/app/shell/context-usage-panel.tsx` | Exports `ContextUsagePanel, ContextMeterDetail`. |
| `apps/desktop/src/app/shell/gateway-menu-panel.test.tsx` | describe('GatewayMenuPanel reconnect action', () => { — it('shows reconnect while disconnected and disables it in flight', async () => { |
| `apps/desktop/src/app/shell/gateway-menu-panel.tsx` | Exports `GatewayMenuPanel`. |
| `apps/desktop/src/app/shell/group-setter.ts` | // The `GroupSetter` shape pages take as an extension-point prop (CapabilitiesView, // MessagingView, ChatPreviewRail, …). |
| `apps/desktop/src/app/shell/hooks/use-change-workspace.ts` | Exports `useChangeWorkspaceItem`. |
| `apps/desktop/src/app/shell/hooks/use-context-breakdown.test.ts` | describe('useContextBreakdown (#94001)', () => { — it('caches a live breakdown keyed by session and serves it across busy toggles', async () => { |
| `apps/desktop/src/app/shell/hooks/use-focused-session-row.ts` | The focused session's stored row scalars: its cold/fallback start time and * cwd, and the gateway it runs on (a Connections-tagged row names its gateway; * an untagged one is the window's p… |
| `apps/desktop/src/app/shell/hooks/use-overlay-routing.ts` | Exports `useOverlayRouting`. |
| `apps/desktop/src/app/shell/hooks/use-status-snapshot.test.ts` | describe('useStatusSnapshot', () => { — it('drops the free-tier verdict on a profile or source switch, not on a gateway flap', async () => { |
| `apps/desktop/src/app/shell/hooks/use-status-snapshot.ts` | // Statusbar health is ambient chrome, not live data — nothing the user acts on // within seconds. |
| `apps/desktop/src/app/shell/hooks/use-statusbar-items.lifecycle.test.tsx` | describe('statusbar context usage lifecycle', () => { — it('keeps live usage at turn end until a fresh idle breakdown arrives', async () => { |
| `apps/desktop/src/app/shell/hooks/use-statusbar-items.test.tsx` | describe('statusbar update channel vocabulary', () => { — it('names a stable release update without presenting its commit distance', () => { |
| `apps/desktop/src/app/shell/hooks/use-statusbar-items.tsx` | Exports `useStatusbarItems`. |
| `apps/desktop/src/app/shell/hooks/use-window-controls-overlay-width.ts` | // Measure the EXACT width of the native window-controls overlay (min/max/close) // straight from the browser, instead of a hardcoded reservation. |
| `apps/desktop/src/app/shell/local-setup-menu-row.tsx` | "Run locally" at the top of the composer's model menu, for as long as this * machine qualifies and nothing is set up. |
| `apps/desktop/src/app/shell/model-catalog-menu.search-fold.test.tsx` | it('matches and highlights separator-equivalent queries without revealing unrelated models', async () => { |
| `apps/desktop/src/app/shell/model-catalog-menu.test.tsx` | describe('model menu row decorations (MODEL_MENU_ROW_AREA)', () => { — it('paints a contributed icon and badge in the row slots, skipping a throwing decorator', async () => { |
| `apps/desktop/src/app/shell/model-catalog-menu.tsx` | Exports `ModelMenuCloseContext, ModelChoice, ModelMenuController, ModelCatalogMenu`. |
| `apps/desktop/src/app/shell/model-edit-submenu.test.tsx` | describe('ModelEditSubmenu reports edits without performing them', () => { — it('param fast: reports the toggle', () => { |
| `apps/desktop/src/app/shell/model-edit-submenu.tsx` | Exports `FastControl, resolveFastControl, ModelEditSubmenu, ModelOptionsContent`. |
| `apps/desktop/src/app/shell/model-menu-panel.test.tsx` | describe('ModelMenuPanel MoA presets', () => { — it('selecting a MoA preset switches PERSISTENTLY via onSelectModel (not the one-shot dispatch)', async () => { |
| `apps/desktop/src/app/shell/model-menu-panel.tsx` | Exports `ModelMenuPanel`. |
| `apps/desktop/src/app/shell/model-menu-row-decorations.tsx` | Model menu row decorations — a plugin's per-model mark inside the native * model catalog menu (the composer's model pill menu and every other surface * that renders `ModelCatalogMenu`). |
| `apps/desktop/src/app/shell/reasoning-menu-panel.tsx` | The composer's reasoning menu: the same options rows the catalog shows per * model row (Thinking / Fast / Effort), opened directly for the ACTIVE model * from its own pill. |
| `apps/desktop/src/app/shell/sidebar-label.tsx` | Exports `SidebarPanelLabel`. |
| `apps/desktop/src/app/shell/statusbar-context-menu.test.tsx` | describe('statusbar context menu coordination', () => { — it('lets the statusbar Radix menu handle right-clicks instead of the app fallback (#89953)', async () => { |
| `apps/desktop/src/app/shell/statusbar-controls.tsx` | Exports `StatusbarMenuItem, StatusbarItem, StatusbarSelectModifiers, StatusbarItemSide, SetStatusbarItemGroup, StatusbarControls`. |
| `apps/desktop/src/app/shell/statusbar-visibility.test.tsx` | describe('statusbar item visibility', () => { — it('shows an item once the user enables it from the bar context menu', async () => { |
| `apps/desktop/src/app/shell/system-resources-statusbar.test.tsx` | describe('system-resources statusbar polling', () => { — it('does not poll while the document is hidden', async () => { |
| `apps/desktop/src/app/shell/system-resources-statusbar.tsx` | // Live host-resource readout for the bottom bar: GPU utilization + VRAM + // RAM, fed by /api/local-models/hardware. |
| `apps/desktop/src/app/shell/terms-butterbar.tsx` | Exports `TermsButterbar`. |
| `apps/desktop/src/app/shell/titlebar-controls.test.tsx` | describe('TitlebarControls fixed clusters', () => { — it('keeps the app clusters on a contributed page that mounts no titlebar chrome', () => { |
| `apps/desktop/src/app/shell/titlebar-controls.tsx` | Exports `TitlebarTool, TitlebarToolSide, SetTitlebarToolGroup, TitlebarControls`. |
| `apps/desktop/src/app/shell/titlebar-icon.tsx` | Titlebar-cluster glyph — 13.9px inline (see titlebarIconSizeCss). |
| `apps/desktop/src/app/shell/titlebar.test.ts` | describe('titlebarControlsPosition', () => { — it('offsets controls from visible traffic lights', () => { |
| `apps/desktop/src/app/shell/titlebar.ts` | Exports `TITLEBAR_HEIGHT, TITLEBAR_DRAG_HANDLE_WIDTH, MACOS_TRAFFIC_LIGHTS_HEIGHT, TITLEBAR_CONTROL_SIZE, TITLEBAR_ICON_SIZE, TITLEBAR_ICON_BADGE_SCALE`. |
| `apps/desktop/src/app/shell/use-model-menu-controller.ts` | Exports `ModelSelection, ModelMenuHostProps, useModelMenuController`. |
| `apps/desktop/src/app/shell/wslg-window-controls.test.tsx` | describe('WslgWindowControls', () => { — it('routes minimize, maximize and close through the desktop bridge', () => { |
| `apps/desktop/src/app/shell/wslg-window-controls.tsx` | Exports `WslgWindowControls`. |
| `apps/desktop/src/app/starmap/color.ts` | // Theme tokens come through `color-mix()`/oklch, so getComputedStyle returns a // non-rgb() string. |
| `apps/desktop/src/app/starmap/constants.ts` | // ── Disk geometry ──────────────────────────────────────────────────────────── |
| `apps/desktop/src/app/starmap/context-menu-handle.ts` | Registered context-menu ownership for the Star Map canvas. * * The app-wide menu listens on window during capture, before React's canvas * handler. |
| `apps/desktop/src/app/starmap/geometry.ts` | Exports `clamp, hash, nodeRadius, recencyInk, shapePath, fitViewport`. |
| `apps/desktop/src/app/starmap/index.tsx` | // Star map overlay: a top-down map of what Hermes has learned for a profile, // over a radial time axis. |
| `apps/desktop/src/app/starmap/node-context-menu.test.tsx` | describe('NodeContextMenu', () => { — it('keeps the destructive row functional through the shared menu', async () => { |
| `apps/desktop/src/app/starmap/node-context-menu.tsx` | Exports `NodeMenuTarget, NodeContextMenu`. |
| `apps/desktop/src/app/starmap/playback-hotkey.test.ts` | describe('shouldIgnorePlaybackHotkey', () => { — it('toggles on Space when nothing focusable owns the key', () => { |
| `apps/desktop/src/app/starmap/playback-hotkey.ts` | Decide whether a window-level Space keydown should be ignored by the Star * Map playback toggle. |
| `apps/desktop/src/app/starmap/render.ts` | Exports `Scene, DrawResult, drawScene, drawScramble`. |
| `apps/desktop/src/app/starmap/share-code.test.ts` | describe('share-code', () => { — it('preserves the visualization', () => { |
| `apps/desktop/src/app/starmap/share-code.ts` | // ── Star-map share code ─────────────────────────────────────────────────────── // // The body schema for a star map, riding the generic loadout codec (@/lib/loadout // owns the bitstream… |
| `apps/desktop/src/app/starmap/share-controls.test.tsx` | describe('ShareControls', () => { — it('opens its dialog when the trigger has a tooltip', async () => { |
| `apps/desktop/src/app/starmap/share-controls.tsx` | Exports `ShareControls`. |
| `apps/desktop/src/app/starmap/simulation.ts` | Exports `BuiltSim, buildSimulation`. |
| `apps/desktop/src/app/starmap/star-map-context-menu.test.tsx` | describe('StarMap context menu ownership', () => { — it('keeps the canvas gesture so a node can open its Edit/Delete menu', async () => { |
| `apps/desktop/src/app/starmap/star-map.tsx` | // How long a full play-through sweep takes (ms), reveal 0 → 1. Longer = the // build-up breathes; the eased middle no longer rushes past in a blink. |
| `apps/desktop/src/app/starmap/text.ts` | Exports `formatDate, metaBadges, countLabel, nodeFooter, wrapText, ellipsize`. |
| `apps/desktop/src/app/starmap/time-axis.ts` | // Empty lead-in: push the oldest node off 0 so the timeline opens on a beat of // emptiness (you watch the first node grow in). |
| `apps/desktop/src/app/starmap/timeline.tsx` | Exports `Timeline`. |
| `apps/desktop/src/app/starmap/types.ts` | Exports `MemoryCard, Shape, Viewport, Rgb, Rect, SimNode`. |
| `apps/desktop/src/app/types.ts` | Exports `ContextSuggestion, ImageAttachResponse, ImageDetachResponse, FileAttachResponse, SlashExecResponse, BrowserManageResponse`. |
| `apps/desktop/src/app/updates-overlay.channel.test.tsx` | it('offers Change only where Settings can switch; a custom branch or older runtime gets the label alone', async () => { |
| `apps/desktop/src/app/updates-overlay.manual.test.tsx` | it('shows manual recovery guidance without claiming the help command installs an update', async (): Promise<void> => { — it('titles a command-less backend refusal honestly and offers nothing to copy'… |
| `apps/desktop/src/app/updates-overlay.tsx` | Exports `UpdatesOverlay`. |
| `apps/desktop/src/app/wake-indicator/wake-indicator-app.tsx` | Exports `WakeIndicatorApp`. |
| `apps/desktop/src/app/wake-indicator/wake-indicator-root.tsx` | Exports `mountWakeIndicator`. |
| `apps/desktop/src/app/wake-indicator/wake-indicator.css` | .wake-indicator-surface { align-items: flex-start; background: transparent; display: flex; height: 100vh; |
| `apps/desktop/src/app/webhooks/index.test.tsx` | describe('WebhooksView profile ownership', () => { — it('drops the create draft when the backend profile changes under All profiles', async () => { |
| `apps/desktop/src/app/webhooks/index.tsx` | Exports `WebhooksView`. *(read head 55)* |


---

## 2. Ideas worth stealing

> Convergence note: this shard is one repo only. Every idea below is marked `UNIQUE`
> unless the pattern is a near-universal harness idiom. Confirm convergence against the
> `pi` and `deepseek-harness` shards before claiming it is a pattern the whole
> reference set shares.

1. **A scheduled run is a different kind of session, and the write gate says so.**
   `apps/desktop/src/app/cron/open-cron-run.ts:40-77` — `isResumableCronRun` tells a LIVE
   run from a ZOMBIE using the scheduler's own ownership flag, never an activity
   heuristic; a zombie is **view-only** and the verdict is re-evaluated on every poll
   and every send, never latched.
   *Why it transfers:* August Trading's scheduled automations produce sessions too. A
   "cron run" that the user opened to read must not be typed into as if it were a live
   chat, and a scheduler that dies mid-run must leave a *visible* trace rather than a
   half-open conversation. The same file also gives the vocabulary: `enabled`,
   `scheduled`, `running`, `paused`, `error`, `completed`, `disabled`.

2. **Fail closed on a write whose target you cannot prove.**
   `apps/desktop/src/app/cron/open-cron-run.ts:150-176` — an unreadable row keeps a
   known verdict; an *unknown* run is refused outright: "a send into a possibly-dead
   cron session is exactly the misroute to prevent."
   *Why it transfers:* August Trading writes trades. Every consequential write
   (log a trade, place an order, start an automation) should resolve its target
   through a resolver that returns "I cannot prove this target" rather than guessing.

3. **An optimistic "queued" row with a bounded lifetime.**
   `apps/desktop/src/app/cron/index.tsx` (`PENDING_RUN_START_SLACK_MS = 2000`,
   `PENDING_RUN_TIMEOUT_MS = 90_000`) — the UI paints the queued run from the click,
   not from the backend, and the row disappears when the run appears **or** when a
   bounded timeout fires. A ref is written before the state set so the busy render
   and the guard share one instant.
   *Why it transfers:* triggering a scheduled trade check can take seconds to
   materialise. The trader should see "accepted" immediately, and the row must not
   become a permanent lie if the scheduler never runs it.

4. **A generation token on every async read that can paint.**
   `apps/desktop/src/app/cron/cron-actions.ts:22-40` — the scope is
   `connection + '\0' + profile`; a request that completes after the scope changed
   is dropped as `stale` rather than painted. The same pattern appears in
   `use-message-stream`, `transcript-backfill`, `use-background-sync` and
   `single-flight-resume`.
   *Why it transfers:* any async result in August Trading can land after the user has
   moved to another symbol, another trade, another profile. One house pattern for
   "is this answer still about what the user is looking at" is cheaper than one
   ad-hoc check per call site.

5. **Bound the transcript by RENDER WEIGHT, and make the cut STICKY.**
   `apps/desktop/src/app/chat/transcript-window.ts:28-140` — the budget is measured in
   render-weight units, not message count (a 400-message cap would disable itself on
   37 heavy-but-short sessions and fire on 92 long-but-light ones); the cut is
   anchored to a message id and holds until the tail outgrows budget + half a page;
   a cut never lands inside an assistant branch group.
   *Why it transfers:* August Trading's chat keeps analysis, tool output and chart
   rows in one transcript. A weight budget plus a sticky anchor is the difference
   between a long session degrading and the renderer falling over.

6. **Release what the window no longer shows — but never an unsaved row.**
   `apps/desktop/src/app/chat/transcript-retention.ts:1-40` — keep the live window
   plus one weight page of slack; release everything older; **never drop a row without
   a durable id** (it could not be fetched back); report the release in two
   currencies (messages released, backend rows released) because the paging offset is
   counted in backend rows.
   *Why it transfers:* the same trade-off exists for a trade journal that is paged
   through — keep a bounded tail, release the rest, and never release a row that
   has not been persisted.

7. **A context meter that goes DARK rather than lie.**
   `apps/desktop/src/app/shell/hooks/use-context-breakdown.ts:1-40,140-175` — a
   zeroed or failed breakdown is retried on a bounded ladder (1 s / 4 s / 12 s) and
   then **evicted**: "A dark meter is honest; pre-compression numbers are a lie."
   The hook also refuses to estimate mid-turn, and two events that change the
   transcript *without* a busy toggle (compression, reclaim) bump a per-session
   invalidation generation that forces a refetch.
   *Why it transfers:* August Trading has a context-budget story (`compactForWire`,
   `resolveContextWindow`). Showing the budget is good; showing a *stale* budget is
   worse than showing nothing, and the invalidation hook is the mechanism that keeps
   it true.

8. **Exactly-once sends with a durable tombstone and per-key storage.**
   `apps/desktop/src/app/session/hooks/use-prompt-actions/prepared-submissions.ts:20-40,200-230`
   — an uncertain send is journaled; the identity is *spent* by a tombstone written
   **before** the journal removal; the tombstone lives in **one localStorage key per
   entry** because a single blob let one window's read-modify-write drop another
   window's tombstone; Web Locks mark which window may retry.
   *Why it transfers:* August Trading logs trades from a UI. A trade log write that
   is "maybe delivered" must never be re-delivered, and must never be *reused* as a
   new intent.

9. **Resolve the target by a trust ladder, and refuse rather than fork.**
   `apps/desktop/src/app/session/hooks/use-prompt-actions/resolve-target-session.ts:16-46`
   — explicit id → live runtime (unless a durable route disagrees) → resume on the
   session's **owning** profile → only then create. A durable conversation whose
   runtime cannot be rebound returns `null`: "A command that runs against the wrong
   session is worse than one that reports it could not run."
   *Why it transfers:* August Trading has multiple surfaces (chat dock, chart, learn,
   journal) that can all act on a trade. One resolver, one refusal path.

10. **A model fallback chain edited as structured rows, never as a string.**
    `apps/desktop/src/app/settings/fallback-models-field.tsx:22-45,96-120` — the
    editor edits only provider/model and **rides every other key along untouched**,
    because an autosave that rewrote a local-gateway chain as bare pairs "would route
    fallbacks to the public provider (#89184)"; half-filled rows are never emitted.
    *Why it transfers:* August Trading's provider config is runtime-configured; a
    fallback chain that survives an autosave is the difference between a resilient
    fallback and a silent one.

11. **The self-improvement review writes a PERSISTENT transcript row, not a toast.**
    `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/status.ts:150-200`
    — "it must not be a transient toast that can be missed", and it is typed with a
    `review:` marker so the renderer paints it as the memory-write row instead of
    sniffing the backend's prose.
    *Why it transfers:* August Trading's post-trade learning loop produces a lesson.
    The trader's future self should see that it happened, in the transcript, not in a
    toast that expired.

12. **Archive, don't delete — and say how to undo it in the dialog.**
    `apps/desktop/src/app/learning/archive-skill-confirm-dialog.tsx:9-12` — "The skill
    is archived and can be restored with `hermes curator restore`", and the
    apply/rollback pattern is factored into one `fireOptimistic` helper.
    *Why it transfers:* August Trading's rules/skills accumulate. Retirement must be
    reversible and must not look like data loss.

13. **Archive = removed from the live surface, still on disk.**
    `apps/desktop/src/app/capabilities/skills/skill-provenance.ts:13-24` — provenance
    decides *origin*; mutability is a separate question, and an external mount stays
    editable in place because "a refusal would just breed silent local duplicates".
    *Why it transfers:* a rule the trader learned into a notebook directory must not
    be silently copied into the app's own store.

14. **A live clock that pauses when the pane is hidden.**
    `apps/desktop/src/app/chat/composer/status-stack/session-control-utils.ts:25-50`
    — one `setInterval` for the whole section, gated on `usePaneVisible()`; "Keep-alive
    keeps every ever-active tab mounted, so it also stops for a hidden pane or window."
    The same gate appears in the sidebar cron peek, the HUD, the statusbar system
    resources and the subagent polls.
    *Why it transfers:* a desktop app with many surfaces can burn a surprising amount
    of CPU on timers nobody is looking at.

15. **One dispatch table for every agent event, with ordered family handlers.**
    `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/index.ts:90-104`
    — twelve handlers in an array; each consumes its own event types and reports
    whether it did; dispatch stops at the first taker; the routing preamble
    (which session, is it visible, is it from the active source) is computed once.
    *Why it transfers:* August Trading's turn lifecycle has the same needs — one place
    that knows how to route "an agent said something", so no surface re-derives it.

16. **"From the active profile" must mean "from the active SOURCE".**
    `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/index.ts:196-203`
    — "every registered connection exposes a 'default' profile, so a bare profile
    comparison attributes gateway B's 'default' events to gateway A's 'default'." The
    composite `(connectionId, profile)` is compared instead.
    *Why it transfers:* August Trading runs several backends (one local, one remote).
    A per-profile key that ignores the connection will cross-wire trades.

17. **A background turn must never paint on the user's screen.**
    `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/desktop-bridge.ts:40-60`
    — `tip.show` and `pane.reveal` are active-session only: "a background turn must
    never paint on the user's screen (desktop AGENTS.md: offer, don't hijack)."
    *Why it transfers:* August Trading's automations run turns in the background. A
    background analysis must not steal focus or repaint the visible trade.

18. **A duplicated completion may never re-offer a dismissed thing.**
    `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/tools.ts:48-62`
    — `pendingProduction` is computed *before* the upsert seals the part, from the
    tool-call owner's message id, so "a duplicate or replayed completion may never
    re-offer a dismissed target."
    *Why it transfers:* the same rule applies to an August Trading "open this chart"
    or "show this artifact" action.

19. **A queued answer can be edited, steered or deleted — by its owner.**
    `apps/desktop/src/app/chat/composer/hooks/use-composer-queue.ts`, `queue-slot.tsx`
    — the queue is a first-class surface: entries can be expanded, edited, steered or
    cancelled, and a server-queued card shows **only the verbs its owner serves**
    ("never Next (RT-35)"). A card from an owner without those verbs keeps only
    Delete.
    *Why it transfers:* August Trading's automations queue work; the trader needs to
    see and cancel what is pending, and the verbs offered must match what can
    actually be done.

20. **A skill that is learned is editable; a skill that is bundled is not.**
    `apps/desktop/src/app/capabilities/skills/skills-tab.tsx:79-140` — one
    controller, remounted on scope change (`key={profileScopeKey(profile)}`) "so an old
    profile's editor, confirmation or pending write cannot enter another"; the backend
    saves a **disabled-list** config value, so individual and bulk changes are
    serialised together.
    *Why it transfers:* August Trading has skills/rules with a similar lifecycle; the
    "remount on scope change" trick is a cheap way to guarantee no cross-profile
    write.

21. **One prompt-line grammar for the composer.**
    `apps/desktop/src/app/chat/composer/slash-refs.ts`, `text-utils.ts` — a
    slash-command or reference is recognised from text the composer *did not watch
    being typed* (a paste, a restored draft, an undo step, a rebuilt line), and the
    same `detectTrigger` grammar drives the completion popover.
    *Why it transfers:* August Trading's composer handles `/` and `@` references; the
    "recognise it in pasted or restored text too" case is where most such UIs break.

---

## 3. Trading-specific findings

**Long-lived monitoring & scheduled work.** This shard is the desktop surface of a
cron system whose scheduler lives in Python (`hermes_cli/cron.py`), but every
reliability rule is visible here:
- *Job state vocabulary* — `enabled | scheduled | running | paused | error | completed |
  disabled`, with one colour table shared by the sidebar and the page
  (`cron/job-state.ts:5-13`), so the two can never drift.
- *Missed-run visibility* — a `next_run_at` in the past beyond a **15-minute grace**
  is reported as "overdue since …", never as an upcoming "Next"; a parked slot is
  "the only user-visible trace of a dead scheduler" (`cron/job-state.ts:46-70`).
- *Catch-up / restart* — the desktop does not run the schedule; it *observes* it.
  Run history comes from the backend, and the write gate distinguishes a live run
  from one the scheduler never closed (`cron/open-cron-run.ts:40-77`).
- *Idempotency* — the trigger path never trusts its own response as the new list; it
  re-reads the authoritative list and reports refresh failure **separately** from
  trigger failure, because "a completed one-shot may have been deleted"
  (`cron/cron-actions.ts:70-86`).
- *A breaker* — none in the desktop layer; the closest analogue is the **bounded
  retry ladder** for context measurement (1 s / 4 s / 12 s, then the cached value is
  evicted) and the **bounded optimistic window** for a queued run (90 s).
- *Polling discipline* — polls are 8 s normally, 60 s when the backend pushes change
  events, 2 s only while a run is queued, and every poll is gated on document
  visibility (`cron/index.tsx`, `chat/sidebar/cron-jobs-section.tsx`).
- *Long-lived recurring work inside a session* — the **heartbeat** (a prompt on an
  interval) and the **loop** (a recurring self-paced or fixed-interval turn) are
  server-side objects the client only renders and commands; both expose
  pause/resume/stop, a fire count, a next-due countdown, a `deferred_by_goal` state
  and an `awaiting_response` state, and "due" is rendered differently from "next"
  because the agent cannot run while the session is busy
  (`composer/status-stack/session-control-loop.tsx`, `…-heartbeat.tsx`).

**Human-in-the-loop approval.** The desktop's approval surface is a **parked card**
plus a **request rail**, and the rules are strict:
- A request is answered by the window that *hosts* the session; other attached
  windows **decline** rather than stay silent, so the agent is told now instead of
  after its deadline (`gateway-event/server-requests.ts`, `previewSessionRoute`).
- `approval.settled` / `clarify.settled` carry a **prompt id**, so a shared prompt
  is torn down exactly once and only the card under that id comes down
  (`gateway-event/input-requests.ts`).
- `approval.cancelled` clears parked cards **by request id**, so a late cancel cannot
  erase a newer prompt (`gateway-event/lifecycle.ts`).
- A cancel caused by a **timeout** is explained in human words in the transcript and
  the toast offers a route to the setting that controls the wait
  (`gateway-event/input-requests.ts`).
- The approval **mode** is a first-class, per-profile status-bar chip reconciled only
  from the owning gateway (`session/hooks/use-session-actions/runtime-owner.ts`).
- The audit trail that survives a decision is the **transcript**: the tool row shows
  the model-facing `BLOCKED` result, and the system line says what happened.

**Post-mortem / reflection loops.** Two mechanisms are visible from the client side:
- The backend's **self-improvement review** emits a `review.summary` that the desktop
  renders as a **persistent system row** typed `review:` — "it must not be a transient
  toast that can be missed" (`gateway-event/status.ts:150-200`). The skill/memory
  write that caused it is therefore always visible in the transcript.
- The **skill lifecycle** is archive-based, not delete-based: a learned skill is
  archived (recoverable with `hermes curator restore`), and its provenance decides
  whether it is editable at all (`learning/archive-skill-confirm-dialog.tsx`,
  `capabilities/skills/skill-provenance.ts`). The *stop-accrual* mechanism is
  provenance + archive, plus a **cache invalidation** whenever a skill changes
  (`gateway-event/tools.ts` invalidates the composer's cached `/` list the moment
  `skill_manage` completes).

**Multi-agent.** This shard shows the **subagent** half of the design, and the split
is deliberate:
- Subagents are **server-side objects** surfaced as rows (`subagent.*` events), never
  as separate chat threads the trader has to babysit
  (`gateway-event/tools.ts`, `app/agents/index.tsx`).
- A subagent has its **own owner route**; steer/stop go to "the child parent owner,
  never the active gateway or child transcript" (`status-stack/subagent-controls.tsx`).
- A delegation gets its **own model route** (inherit / model-only / provider /
  direct endpoint), configured in one place with an explicit `Apply`
  (`settings/delegation-route-draft.ts`).
- The **Stop semantics** are explicit and asymmetric: "A Stop interrupts the parent
  TURN, not the children" — terminal subagent completions are still accepted, live
  progress is not (`gateway-event/tools.ts`).
- A **mixture-of-agents** ("MoA") run is visible in the transcript as multiple
  labelled reference blocks plus an aggregating marker, and the reference blocks are
  **accumulated, not replaced** (`moa.reference-event.test.tsx`,
  `moa-progress-event.test.tsx`).
- Where debate is *not* used: there is no per-turn multi-model debate in the desktop
  layer at all. The only multi-model surface is the **fallback chain** (try the next
  provider/model when the default fails) and the optional **MoA preset** in the model
  menu — both are routing, not argument.

**Structured logs the model can query.** The desktop keeps **no database** of its own.
The queryable record is the backend's `state.db`; the desktop's job is to *render* it
and to keep the paging honest:
- The transcript is paged from the backend by **older-page backfill** with
  `transcript-tail` bookkeeping that records whether a page was truncated and the
  next offset (`chat/transcript-backfill.ts`).
- The store releases paged-through history and **rewinds the offset** so the rows can
  be fetched again (`chat/transcript-retention.ts`).
- **Tool output, tool inputs, and per-row provenance** are attached to the message
  parts, so a row knows its backend row ids (`serverRowSpan`, `rowId`) and can be
  re-derived rather than re-rendered.
- The **session list** is a queryable index too: `searchSessions` returns
  server-side FTS hits with the snippet, and the client merges them with local
  matches (`chat/sidebar/search-results-order.test.ts`).

**Staying simple as features accumulate.** The repo's own answer is a **contribution
registry**: one schema (`COMPOSER_AREAS`, `PALETTE_AREA`, `APPEARANCE_AREAS`,
`MODEL_MENU_ROW_AREA`, `WIRE_AREA`-style) that every seam registers into — panes,
titlebar items, statusbar items, keybinds, palette commands, composer areas, model-menu
row decorations (`app/contrib/controller.tsx`, `app/contrib/surfaces.tsx`,
`app/contrib/contrib.ts`, `chat/composer/contrib.ts`). A feature that wants a slot
asks the registry for it instead of growing the surface's own props. The cost is that
the registry itself is the new complexity — see Weak spots.

---

## 4. Non-obvious decisions and gotchas

1. **`scheduler_owned` beats `is_active`.** A cron run inside a long tool call writes
   no heartbeat and reads inactive exactly like a zombie
   (`cron/open-cron-run.ts:40-58`). Any liveness heuristic based on "did it tick
   recently" will mis-classify long-running scheduled work.
2. **"Not expected to fire" is not "overdue".** `nextRunOverdueMs` returns `null` for
   paused / completed / disabled / unparseable slots (`cron/job-state.ts:54-70`).
3. **The grace period is duplicated across languages.** 15 minutes in
   `hermes_cli/cron.py` and in `cron/job-state.ts:44` — change one and the other lies.
4. **A trigger that succeeded must never be shown as failed.** The refresh is
   reported separately from the mutation (`cron/cron-actions.ts:70-86`).
5. **`JSON.stringify([provider, model])` for a select value.** Provider slugs and
   model ids can both contain colons (`cron/cron-model.ts:71-88`).
6. **`Intl.Segmenter` for user text, not `slice`.** Job names, error text and skill
   names are raw user input (`cron/job-state.ts:24-30`).
7. **The verdict is recorded before the route flips.** `openCronRun` records the
   read-only verdict *before* the open, so the first send already sees it
   (`cron/open-cron-run.ts:120-135`).
8. **`fromActiveSource()` is a function, not a value.** The active connection can
   change between an event's arrival and a handler's read
   (`gateway-event/types.ts:62`).
9. **Profile alone is not identity.** Every connection exposes a `'default'` profile;
   the scope key is `(connectionId, profile)` (`gateway-event/index.ts:196-203`).
10. **A status claim ends when *any other output* arrives.** The drafting / provider-wait
    / compaction sets are "superseding event types", not "closing event types"
    (`gateway-event/index.ts:47-88`).
11. **`tool.generating` is a status, not a row.** It has a name and nothing else;
    materialising a row from it strands an argless placeholder
    (`gateway-event/tools.ts:120-140`).
12. **The theme registry is seeded without applying on `gateway.ready`.** A fresh
    connect must not override the user's persisted theme
    (`gateway-event/lifecycle.ts:30-38`).
13. **Reclaim is a full teardown, and each step has a reason.** Clear prompts keyed to
    the *old* runtime id (the id rotates on every resume, so the new turn's cleanup
    can never remove a stale approval), unbind the tile, invalidate the context
    breakdown (`gateway-event/lifecycle.ts:120-185`).
14. **A pre-compression context number is wrong by 5-10×, not merely stale.** Hence
    the invalidation generation, and hence "evict rather than show"
    (`shell/hooks/use-context-breakdown.ts:20-45`).
15. **A zeroed context breakdown is not data.** `context_max === 0` means the backend's
    `agent is None` branch answered; it is retried, never cached
    (`use-context-breakdown.ts:47-52`).
16. **A render-weight budget, not a message count.** Measured on a real 1,175-session
    store (`transcript-window.ts:14-26`).
17. **A cut inside a branch group silently re-parents it**
    (`transcript-window.ts:41-58`).
18. **A row without a durable `rowId` cannot be released** — it could not be fetched
    back (`transcript-retention.ts:22-26`).
19. **The paging offset is counted in backend rows, not messages.** One assistant
    message can cover several backend rows (`transcript-retention.ts:48-58`).
20. **A tombstone must be written before the removal, and in its own key.** A single
    blob lets one window's read-modify-write drop another window's tombstone
    (`use-prompt-actions/prepared-submissions.ts:22-40`).
21. **A journal is not an outbox.** Only an explicit retry may reuse an uncertain
    admission (`prepared-submissions.ts:63-66`).
22. **A native write failure never falls back to browser storage.** "sending requires
    their ACK" (`prepared-submissions.ts:196-205`).
23. **A durable conversation that cannot be rebound must return `null`, not create a
    session** (`use-prompt-actions/resolve-target-session.ts:120-135`).
24. **`session.resume` is single-flighted per (connection, stored id)** — not per
    profile, because two registry backends can hold the same stored id
    (`use-prompt-actions/single-flight-resume.ts:16-30`).
25. **A message-bearing resume cannot join an omitted-message resume.** It queues
    behind it instead, preserving same-session ordering
    (`single-flight-resume.ts:55-70`).
26. **A write's destination is captured before preprocessing, and only transport/auth
    authority may invalidate it** (`use-prompt-actions/submission-destination.ts:30-70`).
27. **A mid-turn correction refuses to resolve another target.** Any disagreement
    between route, selection and runtime binding refuses, and the composer queues the
    text (`use-prompt-actions/steering-session.ts:60-100`).
28. **`tool.progress` is a row annotation, never a transcript mutation**, and is
    retired by the dispatcher's `finally` because a turn can end without the
    completion (`gateway-event/tools.ts:76-112`).
29. **A Stop interrupts the parent turn, not the children.** Terminal subagent
    completions are accepted past the interrupt (`gateway-event/tools.ts:205-240`).
30. **A duplicate completion may never re-offer a dismissed preview.** The check reads
    the state *before* the upsert seals the part (`gateway-event/tools.ts:48-62`).
31. **`approval.cancelled` clears by request id**, so a cancelled id can never wipe a
    newer prompt armed on the same session (`gateway-event/lifecycle.ts:85-115`).
32. **A window that does not host the session must decline, not stay silent.** The
    backend keeps the request open for the owner until every window has declined
    (`gateway-event/server-requests.ts`, `previewSessionRoute`).
33. **The runtime id rotates mid-conversation** (auto-compression), so a request's
    `session_id` and the pane's stored id are compared *through* the stored id and
    the lineage (`gateway-event/server-requests.ts:120-175`).
34. **A refused model pick repaints the committed model**, but only while the composer
    still shows that pick (`gateway-event/deferred-pick.ts:30-60`).
35. **A guarded confirmation carries an `isStale()` predicate** so confirming cannot
    undo a newer pick (`gateway-event/deferred-pick.ts:70-95`).
36. **"Inherit" vs "model only" vs "provider" vs "direct endpoint" vs "custom"** are
    separate sentinel values in the delegation route, because the provider namespace
    must not collide with editor actions (`settings/delegation-route-draft.ts:18-30`).
37. **Native SDK providers ignore a direct URL** (`bedrock`, `vertex`, `google`,
    `google-genai`) — matching the Python side (`delegation-route-draft.ts:26-32`).
38. **A fallback chain's other keys must ride along untouched**, or an autosave will
    rewrite a local-gateway chain into bare pairs and route fallbacks to the public
    provider (`settings/fallback-models-field.tsx:22-32`).
39. **A commit echo must not wipe a half-typed row** (`fallback-models-field.tsx:88-104`).
40. **A persisted skill that the user pointed at with `skills.external_dirs` stays
    editable**, because a refusal "would just breed silent local duplicates"
    (`capabilities/skills/skill-provenance.ts:13-24`).
41. **The profile scope is a remount key.** `key={profileScopeKey(props.profile)}` so
    "an old profile's editor, confirmation or pending write cannot enter another"
    (`capabilities/skills/skills-tab.tsx:44-48`).
42. **The backend saves a *disabled list*, so individual and bulk changes are
    serialised together** — not merely the members of a bulk action
    (`capabilities/skills/skills-tab.tsx:86-95`).
43. **The countdown is a local clock**, not the server's `next_due_at`, because the
    gateway only re-publishes it when a wakeup fires
    (`status-stack/session-control-loop.tsx:31-36`).
44. **"Due" ≠ "next".** A deadline that has passed renders "due — waiting for idle",
    because the agent cannot run while the session is busy
    (`session-control-loop.tsx:38-40`).
45. **Radix opens on `pointerdown`,** so a keyboard/programmatic click (`detail === 0`)
    must open the menu explicitly (`session-control-heartbeat.tsx:160-180`).
46. **An archive must say how to undo it** in the confirmation itself
    (`learning/archive-skill-confirm-dialog.tsx:9-11`).
47. **A background turn may not paint on the user's screen** — active session only for
    tips and pane reveals (`gateway-event/desktop-bridge.ts:40-60`).
48. **`isActiveEvent` is not the same as "from the active source"** — two connections
    can report the same session id (`gateway-event/desktop-bridge.ts:70-95`).
49. **A reaction on an optimistic bubble must also stamp the row id onto it**, or the
    event matches nothing and the reaction only appears after a reload
    (`gateway-event/desktop-bridge.ts:110-135`).
50. **The preview engine is lazy-loaded and re-imported with a cache-buster in dev**,
    so ~25 KB of page-injectable source stays off the boot path and still hot-reloads
    (`gateway-event/server-requests.ts:55-70`).

---

## 5. Weak spots

1. **The sheer size of the load-bearing files.** `session/hooks/use-session-actions/index.ts`
   is 149 KB, `use-session-actions/utils.ts` is 101 KB, `session/hooks/use-prompt-actions/submit.ts`
   is 62 KB, `use-prompt-actions/slash.ts` is 61 KB, `chat/composer/index.tsx` is 63 KB,
   `chat/sidebar/profile-switcher.tsx` is 63 KB, `chat/right-rail/preview-pane.tsx` is
   56 KB, `contrib/hooks/use-background-sync.ts` is 57 KB, `gateway/hooks/use-gateway-boot.ts`
   is 73 KB, `settings/model-settings.tsx` is 64 KB. A hundred behaviours share one
   module, and the "one implementation" discipline that keeps them honest also makes
   them impossible to review in one sitting. The repo's own defence is that each of
   these is split into pure helpers with their own test files — but the *surface* file
   is still the integration point for everything.

2. **The contribution registry has become a second framework.** Panes, titlebar items,
   statusbar items, keybinds, palette commands, composer areas, model-menu row
   decorations and page headers all register into one schema. That is genuinely the
   right answer to "stop the feature count from becoming the product" — but it means
   every feature ships a *registration*, a *contract*, and a contribution-area
   constant, and debugging "where does this control come from" now means reading the
   registry. `app/contrib/controller.tsx` (34 KB) and `app/contrib/wiring.tsx` (56 KB)
   are the price.

3. **The parked-card model is a chain of if/else over half a dozen stores.**
   `cancelParkedCredentialRequest` walks sudo → secret → vault code → vault save-login
   → vault unlock → theme pick → setup beat, first match wins
   (`gateway-event/input-requests.ts:210-250`). Every new blocking-input kind adds
   another store, another cancel path, and another "is this card still mine?" check.
   The set of card kinds is implicit — there is no registry that says "these are the
   kinds of thing that can be parked".

4. **Test files of 100-270 KB.** `use-prompt-actions/index.test.tsx` is 222 KB,
   `use-session-actions.test.tsx` is 269 KB, `use-session-actions/utils.test.ts` is
   100 KB, `use-gateway-boot.test.tsx` is 107 KB. These are unreadable as suites and
   probably unreadable as a whole, and a single-file-per-feature test layout has been
   outgrown. There is also no visible layering: the behavioural contract and the
   integration wiring live in the same file, so a regression's cause is hard to
   localise.

5. **Staleness is handled by hand, everywhere.** There is a generation token in
   `cron-actions`, another in `use-message-stream`, another in the transcript backfill,
   another in `single-flight-resume`, another in `use-model-controls`'s model-pick
   ledger, another in `use-context-breakdown`'s invalidation map. Each is correct and
   each is bespoke. A single "this answer is about X" primitive — keyed by scope plus
   a monotonic generation — would cover most of them, and the fact that there are six
   copies is itself the argument.

6. **The client is heavy.** The desktop bundle carries a catalog/marketplace, a pet
   generator, a starmap force simulation, an in-app browser with page-injection
   scripting, a full xterm terminal, a plugin runtime and a payment/billing surface —
   all of it front-end to an agent runtime. Not every feature is a trading feature,
   and in a domain app that much surface area is a maintenance tax with no revenue
   attached.

7. **The scope of a "session" is genuinely ambiguous** — a runtime id that rotates on
   compression, a stored id that rotates with lineage, a lineage root, a per-profile
   row, a per-connection row, a legacy id shape, a cron run id. The code handles this
   correctly, but it does so by *layering* identity (`storedSessionId`, `lineageAliases`,
   `idsShareLineage`, `runtimeIdByStoredSessionId`, `$activeSessionStoredIdRotation`,
   `serverRowSpan`, `sessionMatchesStoredId`) — seven notions of "the same
   conversation". Every new feature has to learn all seven.

8. **Two small correctness smells that will bite.** `lastErrorSummary` compares
   `sentence.length` (UTF-16) against a grapheme budget (`cron/cron-job-model.ts:135-140`),
   so a long astral string can be cut one character short of the stated cap — harmless,
   but the mixed units will confuse the next reader. And `catalog-pointer.ts` ships a
   feature flag set to `false` ("Off for now: without it every card rests at its theme's
   gradient anchor") that still imports and exports a live tracker — dead code that
   costs a `WeakMap` and a `requestAnimationFrame` loop's worth of reader attention.


