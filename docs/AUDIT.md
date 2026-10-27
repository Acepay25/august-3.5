# Phase 0 audit — the August Trading harness

**Audited:** 2026-10-27, repository `C:/Dev/august-3.5`, remote `github.com/Acepay25/august-3.5`,
HEAD `8f2565e4` (`feat(ui): hue-free dark, a transcript that reverts without deleting, and an
export of every message`). App identity confirmed in the browser: `document.title === "August
Trading"`, and the driven dev server serves `/index.tsx` of this repo. This is the **trading**
harness, not August Proxy and not the training-model repo.

**Method and what the labels mean.** `docs/`, `docs/plan/`, the flow docs and prior reports were
treated as a map only; every claim below was re-read at HEAD. Two confidence levels are used and
they are not interchangeable:

| label | meaning |
|---|---|
| **PROVEN** | reproduced against the running app in Chromium (dev server + `scripts/mock-provider.cjs`), with the observed value recorded in §10 |
| **CODE** | verified by reading the source and its call chain; no runtime reproduction yet |

No real API key was used and no order was placed. All outbound hostnames except loopback were
aborted by the driver. `npm run typecheck`, `typecheck:scripts`, `typecheck:electron`,
`check:contracts` (138 passed), `check-flow-doc-anchors` (451 anchors, 20 reach controls),
`lint` (0 errors / 379 warnings, cap 379) and `build` (18.65s) all pass at HEAD, so **nothing below
is a compile failure** — every one is a behaviour or wiring defect the gates cannot see.

**Classification vocabulary** (the mission's): Working · Broken (does the wrong thing) · Hollow
(wired, reachable, produces nothing or a claim with no bytes behind it) · Dead (no caller) ·
Missing (not implemented).

---

## 0. Verdict

The harness is real: 41 desk tools plus 9 chart actions plus 2 mailbox tools dispatch through one
executor, one tool-driven turn path answers both conversation homes, the trader is remembered across
a reload, and a settled trade reaches the journal, the skill ledger and the weekly digest. It is not
yet a trustworthy harness, for one structural reason visible throughout this audit:

> **The write path and the promise path are separate code.** Where the app *does* a thing it is
> mostly correct; where it *reports* that it did the thing — to the model, to the transcript, to a
> toast, to the CSV — it frequently reports the intent rather than the outcome.

Nine of the twenty-three defects below are exactly that, and three (**A-1**, **A-3**, **M-1**) turn a
failed operation into a *false success that destroys the user's only copy*.

Highest blast radius, in the order Phase 1 must take them:

| # | defect | why it is first |
|---|---|---|
| **M-1** | A notebook write that fails leaves the bytes in the in-memory cache; the retry then reports "Already learned" and deletes the draft | destroys a learned skill silently, and the app's own cache goes on lying for the rest of the session |
| **L-1** | One HTTP 429 permanently blocks every Chat-surface send until reload | one bad minute from a provider bricks the main path for every conversation |
| **A-3** | A forged-tool proposal reports `proposed:true` when `localStorage` refused the write | the model is told an action succeeded that never happened |
| **L-3** | `onToolPayload` is never forwarded to the desk loop | the transcript's "open the real tool output" can never open anything, in any turn, on any provider |
| **T-1** | A tool deadline returns a receipt but cannot cancel the work | a timed-out lookup keeps mutating after the seat was told it failed |
| **T-2** | `digestToolResult` renders missing market data as `0`, `—` and `ok` | the seat's transcript line says the tape was read and empty, when it was never read |

---

## 1. App flow: launch → turn → persistence → shutdown

### Working

- **Launch and hydration** — **CODE**. `electron/main.cjs:1396` → `index.tsx:75` → `App`; providers
  from `ProviderConfigService`, profile from `useUserProfileLoader.ts:550`. The splash clears on
  animation frames, not on readiness (`index.tsx:90-96`), so a slow profile load shows an app that is
  not yet loaded — cosmetic, not a defect.
- **One executor for both homes** — **CODE**. Main Chat and Full-analysis both go
  `runChatSurfaceTurn` → `runToolTurn` (`services/trade/toolTurn.ts:136`) →
  `streamChatWithDeskTools` → `runDeskToolLoop`. The Chart AI dock goes
  `chatTurnRunner.runSeatTurn` → the same `runToolTurn`. Bots and group rounds stay plain chat by the
  stage-20 ruling (`hooks/useAnalysisPipeline.ts:1129-1153`), which is deliberate, not a gap.
- **Settlement shapes are honest** — **CODE**. An explicit Stop returns `interrupted:true` and keeps
  the partial text (`toolTurn.ts:223-225`); a reasoning-only reply says so
  (`toolTurn.ts:233-247`); tools-off plus an attempted protocol call stamps a notice
  (`toolTurn.ts:215-218`). A turn that called no market tool is told it grounded nothing
  (`chatSurfaceTurn.ts:471-473`).
- **Per-run usage and wire audit** — **CODE**. `runToolTurn` collects `onUsage`/`onWireAudit` per
  request with no shared bus (`toolTurn.ts:137-170`), so a detached run cannot bill its tokens to
  whoever was streaming beside it.
- **Canonical save** — **CODE**. `services/infrastructure/dbService.ts:227-263` serialises
  read/merge/write and awaits the transaction.

### Broken

**L-1 — a 429 locks the Chat surface permanently** — **CODE**, and it is the worst single defect in
the app. `hooks/useAnalysisPipeline.ts:1303-1316` sets the global `isRateLimited` (state lives in
`hooks/useUIState.ts:35,59`, shared through `App.tsx:238`) and schedules its only reset 60s later
**behind a guard that can never be true**:

```ts
window.setTimeout(() => {
    if (runsRef.current.get(requestRunKey)?.controller === rateLimitRunController) setIsRateLimited(false);
}, 60_000);
```

The `finally` at `:1367-1371` runs before that timer and does `runsRef.current.delete(requestRunKey)`
(`:1370`), so at +60s the map entry is `undefined`; if a newer run took the key, its controller
differs. Either way `setIsRateLimited(false)` never executes. The only other clear is `:708`, which
sits **after** the guard at `:648` that the flag trips:

```ts
if (loadingMessage || isSummarizing || (...) || isRateLimited) return { ok: false };
```

So the lock is self-sealing: every later send in every conversation returns `{ok:false}` at `:648`
without reaching `:708`. The comment at `:1306` claims "the old reset sat behind an early-return
guard" was fixed; the new reset sits behind one too. Consequences: the trader cannot send until
reload; the offline queue's replays return `ok:false` and die at `MAX_RETRIES`, so queued work is
**lost**, not deferred.

**L-2 — profile switch can persist incoming data under the outgoing username** — **CODE**.
`hooks/useUserProfileLoader.ts:288-505` applies conversations, trades and settings, and awaits
migrations and integrity checks *before* adopting the incoming username, without suspending saves at
load start. `hooks/useProfilePersistence.ts:132-206,252-281` has no readiness gate on the autosave
path. A switch that outlives the 1.5s debounce can therefore write profile B's rows into profile A's
store. The notebook store already learned this lesson and documents it
(`MemoryFilesService.ts:181-191`, "OWNER + BYTES SWAP TOGETHER"); the profile store has not.

**L-3 — the real tool output is never persisted** — **CODE**, and it makes a documented contract
false. `runToolTurn` passes `onToolPayload: payload => events.attachPayload(payload)` into the
transport options (`services/trade/toolTurn.ts:198`); `StreamWithDeskToolsOptions` declares it with a
comment promising "a payload can be persisted from the streaming loop too"
(`services/analysis/DeskToolsService.ts:4839`). The wrapper then calls `runDeskToolLoop` at
`:5102-5164` and passes `artifactOwner`, `onToolAction`, `onToolCall`, `speaker`, `onToolEvent` —
**and not `onToolPayload`**. The loop destructures it at `:4370` and its only emission site is guarded
at `:4722` (`if (onToolPayload)`), which is therefore always false in the only path that reaches a
model. Downstream, everything is correct and starves: `chatSurfaceTurn.ts:323-343` (save + stamp the
id), `chatTurnRunner.ts:674` (dock), `services/trade/toolPayloadStore.ts:110` (store, budget, failure
recording), `components/shared/ToolActivityRow.tsx:89` (the expander), and
`utils/reportExport.ts:335,421` (the `toolPayloads` CSV column, permanently empty).
`docs/app-flow.md:973-976` documents the write as live. AGENTS.md's canonical description of
`Message.toolEvents` + `Message.toolIds` — "the ids are what let a row open onto the REAL output the
tool returned" — is not true at HEAD.

**L-4 — a cancelled or failed seat row stays live** — **CODE**. Group cancellation bumps the nonce at
`hooks/useAgentGroups.ts:117-124`, and the reply cleanup is gated on that nonce (`:247,303-347`), so
cancelling disables its own row settlement. Panel abort skips settlement
(`services/trade/chatTurnRunner.ts:1225-1260`) and the pipeline's failure path settles without
flushing the pending RAF writer (`useAnalysisPipeline.ts:1209,1277-1292`), so a chunk can land after
the settle and re-write `isStreaming:true` onto a finished row — the failure
`useAnalysisPipeline.ts:1204-1209` was explicitly commented against, on the success path only.

**L-5 — the desktop transport swallows provider errors** — **CODE**, with a Node probe.
`electron/sseParser.cjs:43-153` was fed synthetic SSE `error` frames in all three modes: each returned
**no error** and `sawData:true`, and `electron/main.cjs:766-805` then treats that body as a successful
result. A rate limit, an over-length rejection or a quota error arriving as an SSE frame is therefore
delivered to the renderer as an answer. Renderer-side,
`services/providers/GenericProviderService.ts:1798-1807,1853-1867` slices the **raw** accumulator
using the **visible, think-filtered** character count, so a partial-then-retry stream can duplicate
text or reintroduce stripped markup.

**L-6 — interruption recovery is not durable** — **CODE**. The dock restarts a global 400ms debounce
and excludes streaming entries on every save (`services/trade/chatStore.ts:165-186`); quota failure is
console-only (`services/trade/chatSessions.ts:456-479`); the canonical heartbeat rides the *viewed*
conversation's activity (`useProfilePersistence.ts:222-247`), so a background turn writing into an idle
thread is not saved; `hooks/useSaveOnUnload.ts:52-96` fires an async save the window is free to
outlive, and `electron/main.cjs:1037` persists bounds, not an acknowledged flush. A reload also
restores `isStreaming:true` rows (`useUserProfileLoader.ts:389-400`), so a killed turn comes back
looking like it is still running.

**L-7 — cross-run interference, three separate global owners** — **CODE**. Truncation accounting is
module-global (`utils/finishReason.ts:115-157,188-200`), so overlapping runs reset each other's
counters and the "bracketed" tally is wrong for both. The shared RAF throttler holds one pending slot
(`hooks/analysisPipeline/streamThrottlers.ts:72-81` + `hooks/useRafThrottle.ts:23-40`), so two
conversations overwrite each other's pending paint. Harness events route to the *currently active*
session (`chatTurnRunner.ts:1301-1313`), so a level-watch that fires after the trader switched threads
runs in the wrong one.

### Hollow

**L-8 — most of the Chat-path context assembly is computed and discarded** — **CODE**, and it
contradicts what the code claims. `useAnalysisPipeline.ts:1023-1068` builds `enhancedPrompt` from the
notebook context, similar setups, the learning injection, the predicate-gate note and the
decision-reflection block, then logs its length at `:1068`. Both sends use `promptToSend`: the bot
branch at `:1136` and the desk branch at `:1164`. So **the trader's own closed-trade lessons, the skill
veto prose and the notebook body never reach the model on this path.** This is not a total memory loss
— the desk path independently injects the skills index, notebook *topics* index, strategy plans and the
profile-memory index (`services/trade/chatSurfaceTurn.ts:119-253`), and the deterministic pre-read
attaches up to two matched memory bodies (`DeskToolsService.ts:4939-4963`). What is discarded is the
retrieval-weighted layer. Note `:1058 const gateInjection = ''` — a dead variable standing beside an
`if` that can never run.

**L-9 — the advertised turn ceiling is advisory** — **CODE**. `DESK_TURN_BUDGET_MS = 180_000` and
`DESK_TURN_WRAPUP_AT = 0.8` (`DeskToolsService.ts:211-212`) only insert a "wrap up" instruction at 144s
(`:4786-4801`); nothing aborts. The real bound is the provider transport's 300s per request, re-armed
per phase on desktop (`GenericProviderService.ts:683-705`, `electron/main.cjs:255,694-705`). A seat that
keeps calling tools can legitimately run far past the number the docs name.

**L-10 — model routing is inconsistent between readiness definitions** — **CODE**.
`utils/providerUtils.ts:18-42`'s `isProviderReady` accepts a keyless local provider, but the
pipeline's own guard (`useAnalysisPipeline.ts:671-678`, via `enabledProviders`) rejects it, so a
local-only setup shows a configured provider and then says none are ready. An unavailable bot silently
degrades to an ordinary desk route (`:1081-1096`) rather than telling the trader that seat is not
runnable; panel resolution prefers the saved pair over the bot's current pair
(`chatTurnRunner.ts:1152-1157`) and accepts enabled-but-unready models (`TradeChatPanel.tsx:532-536`).

### Missing

**L-11 — `ask_user_input` does not exist** — **CODE** (searched exhaustively). No tool definition, no
dispatcher case, no inline question/options schema in the transcript row contract
(`components/shared/ChatTranscriptRow.tsx:39`), no suspended-run persistence, no resume channel, no
human-answer timeout, no cancel path. The 20s tool deadline and 180s turn budget
(`DeskToolsService.ts:211,223`) govern tool execution and are not a substitute: a seat that wants to ask
cannot ask, and a turn that would need an answer simply proceeds on assumptions. Phase 3's candidate is
genuinely new work, not a repair.

---

## 2. Memory

### Working

- **Notebook store** — **CODE**. Per-user Preferences manifest + shards
  (`MemoryFilesService.ts:175-277,400-476`); writes serialized by one lock; a failed write is recorded
  and rethrown (`:466-471`, `recordWriteFailure`), and `getNotebookWriteFailure()` surfaces it on the
  Health card — this matches the repo's standing rule. A corrupt blob is preserved and **never
  overwritten** (`:255-264`); a checksum mismatch loads anyway with a sidecar (`:210-213`).
- **Two homes, honestly separate** — **CODE**. Notebook files (`MemoryFilesService`) and the trader
  profile store (`profileMemory.ts:119-384`, upsert + version + cascading forget) are different stores
  for different audiences, and both have UI.
- **Human controls** — **CODE**. `components/learn/MemoryFilesManager.tsx:197-288` edits content,
  toggles `enabled`, deletes. `components/settings/ProfileMemoryCard.tsx:138-152` shows bodies and
  Forget.
- **Remembered across a session — PROVEN.** The live driver wrote a preference through the real
  `remember` executor (`{saved:true, created:true, version:1}`), reloaded the page, and read the body
  back through `read_memory`: `I trade 15m ETH scalps, with a 0.5% risk cap per trade.` The index line
  rides the next prompt (`chatSurfaceTurn.ts:155-162`). Recall reads the store writes go to. **Risk
  rules, style and recurring mistakes are covered; the watchlist is not a memory** — it lives on
  conversation messages (`utils/watchList.ts:17-53`), which do persist. The boot `profile/memory.md` is
  *regenerated* from trade stats (`MemoryFilesService.ts:1107-1158`), so it is a derived view, not an
  editable profile authority — see §9 for what that means for the "durable trader profile" candidate.

### Broken

**M-1 — a failed notebook write leaves a phantom row, and the retry destroys the draft** —
**PROVEN**. `createMemoryFileUnlocked` pushes the file into `memoryCache` *before* `persist()`
(`MemoryFilesService.ts:918-921`). When `persist` rejects (quota), the bytes are gone from storage but
the cache keeps the row for the rest of the session. `approveSkillDraft`'s read-back
(`skillApproval.ts:85-95`) asks the library, gets the phantom, and on the second press returns
`{created:false, reason:'duplicate'}` → the toast says **"Already learned"** and `takeSkillDraft`
(`:91`) **consumes the trader's only copy of the proposal**. Live measurement with a forced notebook
failure:

```
first  = {created:false, reason:"write-failed", error:"Audit notebook quota failure"}
retry  = {created:false, reason:"duplicate", slug:"audit-durable-skill.md"}
drafts = 0        cached = true        durable = false
```

`durable:false` means nothing matched in `localStorage` — a skill the app called already-learned was
never written. The first press is honest; it is the retry that lies, and lying is what deletes the
draft. Fix direction: a store whose write failed must not keep advertising the bytes it failed to
write — roll the cache mutation back inside the write lock.

**M-2 — automatic learning bypasses the sensitive-memory rule** — **CODE**. The `remember` tool
classifies sensitive content and honours the setting (`DeskToolsService.ts:2988-3008`); the trader
learner writes `source:'auto', tag:'observed'` with no classification and no setting check
(`services/learning/traderLearner.ts:113-127`), and consolidation persists its input directly
(`profileMemoryConsolidation.ts:123-126`). Index exclusion only tests the flag
(`profileMemory.ts:366`), so an unflagged sensitive fact is both stored and advertised to every seat.

**M-3 — the dock ignores the memory toggle and the index budget** — **CODE**.
`TradeChatPanel.tsx:449` gates the notebook topics on `memoryEnabled`, then at `:486` calls
`buildProfileMemoryIndex()` **unconditionally and with no budget argument**, while the Chat surface does
it correctly (`chatSurfaceTurn.ts:155-162`: gate + `budget.memory`). Two homes, one setting, two
answers. Separately `memoryTopics.ts:139-155` filters `autoManaged` and skills but never
`file.enabled`, so a note the trader switched off is still listed to the model.

**M-4 — amendments can be approved without being applied** — **CODE**.
`components/learn/AmendmentsInbox.tsx:45-57` marks the amendment approved *first* (`approveAmendment`),
then updates the file — and `if (file)` silently skips the whole application when the target was
deleted. A proposal whose file no longer exists becomes "approved" with nothing written.
`skillSupervisor.ts:673-678` calls `approveAmendment` on override, i.e. the status-only helper, never
the content. The store key is global, not per-profile (`memoryAmendments.ts:38-51`), so a second
profile sees the first's queue.

### Dead

**M-5 — the rules store has no reader** — **CODE**. `learning_rules_v2_<user>` is written and backed up
and is read by no prompt (the register's own **O-30**, re-checked at HEAD:
`services/learning/StorageService.ts:106-137` has no prompt importer). This is the "one system of
record" gap Phase 4 names.

**M-6 — citation attribution is disconnected** — **CODE**. `annotateVerdictCitations`
(`MemoryInjectionService.ts:187-211`) has no production caller, and the dock's `skill_view`
(`DeskToolsService.ts:2874-2922`) records no read. A skill outcome therefore cannot distinguish "cited"
from "unread", so the ledger's evidence credit is unearned.

---

## 3. Tools

### Inventory (measured in the running app, not counted from source)

`TOOLS={"desk":41,"chart":9,"mail":2,"definitionChars":46597,"mandateChars":2828}` —
`DESK_TOOL_DEFINITIONS` `DeskToolsService.ts:948-1747`, `CHART_ACTION_TOOL_DEFS` `:1756-1927`,
`DEBATE_MAIL_TOOLS` `DebateMailbox.ts:119,139`. Human-labelled by `utils/toolKinds.ts`. Forged
`custom_*` tools add dynamically once approved.

| bucket | tools | real vs mocked |
|---|---|---|
| market data | `get_market_packet` `get_all_timeframes` `get_derivatives` `get_order_book` `get_liquidations` `get_btc_context` `get_price_snapshot` `get_indicators` `get_key_levels` `get_chart_view` | **real** Binance futures reads (`MarketDataService.ts:1247-1373`), no synthetic data |
| screening/statistics | `run_screener` `scan_setups` `scan_chart_skills` `get_setup_history_stats` `project_future_price` `run_monte_carlo` | **real**; Monte Carlo in a worker pool |
| journal | `get_trade_log` `recall` `recall_chat` `get_session_context` | **real**, but `get_trade_log` is partial — T-4 |
| memory | `remember` `read_memory` `forget` `amend_memory` `write_memory_note` `get_notebook_map` | **real** |
| skills/strategy | `skill_view` `propose_skill` `revise_skill` `propose_strategy` | **real** |
| goals | `list_goals` `open_goal` `create_goal` `update_goal` `restore_goal` | **real** |
| self-modification | `list_self_changes` `propose_self_change` `revert_self_change` | **real**, human-gated |
| web | `web_search` | **real** (DDG instant JSON + HTML fallback, `DeskToolsService.ts:2012-2097`) |
| extensibility | `forge_tool` `read_tool_output` | **real**; forged tools are HTTPS-recipe only, GET/POST validated, private-IP and credential blocked, human-approved (`toolForge.ts:124-327`) |
| chart actions | `draw_on_chart` `draw_detected` `mark_trade_levels` `clear_chart_drawings` `present_trade` `decline_trade` `watch_price` `wake_me` `cancel_watch` | **real**, offered only where a canvas exists |
| mailbox | `send_message` `read_message` | **real**; live panel/group use, despite the `Debate*` name |

Nothing in the offered set is a mock or a stub. `liquidations` is the one honest *unavailable* source —
Binance retired the endpoint and the service says so with `available:false,
unavailableReason:'source_retired'` (`MarketDataService.ts:1602-1612`). The transcript then throws that
truth away (T-2).

### Broken

**T-1 — a tool deadline cannot cancel the tool** — **PROVEN**.
`withinToolDeadline` (`DeskToolsService.ts:255-288`) takes `work: () => Promise<DeskToolResult>`, never
creates a child `AbortController`, and on timeout just races: the receipt is returned while `work()`
keeps running. Live measurement (20ms deadline, 80ms work):
`{"signalProvided":false,"aborted":false,"lateEffect":true}` — the callback received **no** signal,
nothing was aborted, and the side effect happened after the seat was told the lookup failed. Call
sites: `:4021-4032` (batch, passes `context.signal` for the *parent*) and `:4664-4669` (forged).
Aggravating: `run_screener` (`:3813`) does not forward `context.signal` although `screener.ts:112`
accepts it; worker Monte Carlo calls get no signal at all; `runDerivatives` (`:2099`) explicitly
`void signal`.

**T-2 — missing data is digested as zero / "ok"** — **PROVEN**, three strings reproduced exactly.
`digestToolResult` (`:841-852`) branches on `ok` only, so a `DATA_UNAVAILABLE` body or an
`available:false` JSON is parsed as if it were data: `rawToolDigest` prints
`liquidations · 0 recent events · $0k`, `order book · buy wall — · sell wall —`, and a parse-missing
sentinel prints bare `web search · ok`. The seat's own transcript line — the thing it re-reads every
later round — says the tape was read and empty. `utils/harnessMarks.ts` already owns this vocabulary
(`isDataUnavailable`, `dataUnavailable`); the digest simply never calls it. A real zero on
`available:true` must keep printing a zero, or the fix becomes a lie in the other direction.

**T-3 — worker crash takes down the whole pool** — **PROVEN**.
`MonteCarloService.ts:822-833`'s `onerror` rejects *every* pending request and calls `dropPool()`, on a
comment that claims "pending ids are not tagged per worker". They have been tagged since `:787-793`
(`pending.worker`) and `ejectWorker` at `:851-862` already does the surgical version. Live reproduction
with two workers: the healthy worker's answered request rejected too —
`{"outcomes":["audit worker crash","audit worker crash"],"terminated":[true,true]}`. Blast radius is
every concurrent seat's simulation, not just the crashed one's.

**T-4 — `get_trade_log` promises a record and returns a summary** — **PROVEN**.
The definition (`:1586-1598`) promises the logged time and says `since` filters "trades logged at or
after it". The executor (`:3962-3985`) returns `brief.rows.map(r => r.line)` — strings. The row is built
from **decision** time (`utils/recentTradesBrief.ts:76-79,125-137`), so the fixture logged 2026-10-27 /
decided 2026-10-25 printed `2026-10-25T02:00:00Z` and `since:"2026-10-26"` returned `returned:0`.
Dropped: `id`, `planId`, `modelsUsed`, `outcomeResolvedAt`, MAE/MFE, raw analysis, notes — the whole
review payload.

**T-5 — a forged-tool proposal reports success it did not get** — **PROVEN**.
`toolForge.ts:363-366` swallows a `setItem` quota throw. Live injection of a quota failure for
`desk_tools_forged_v1` gave `{"ok":true,"content":"{\"proposed\":true,...}"} , persisted:null` — the
seat was told the candidate was stored, and nothing was stored. Same `save()` serves
approve/retire/delete/`recordForgedUse` (`:411-440`), and
`components/settings/ToolForgeManager.tsx:53-57` has no catch, so a human's Approve that failed
silently also renders as done. Note the ordering trap: `executeForgedTool` records the result *after* a
real network call (`:316-319`), so making `save` throw must not convert a telemetry-write failure into a
false "the request failed" for an action that already ran.

**T-6 — the cache/artifact split is right; the artifact store's own docs are not** — **CODE**.
`clearDeskToolCache` (`:500-505`) deliberately does not clear artifacts, and `streamChatWithDeskTools`
clears its own owner token at `:5181`. Correct. But `toolArtifactStore.ts:22-27` still claims the store
"is cleared at every debate start beside the result cache it mirrors" — the debate engine is deleted.
Comments describing a caller that no longer exists are how a future edit "restores" a bug.

### Hollow

**T-7 — dead vocabulary and a lying tool description.** `deskToolsMandateFor` (`:1943-1994`) still
speaks of "opening analysis, rebuttal, clarification, moderator verdict" and "Floor reply" for a
single-seat desk, names `run_monte_carlo` unconditionally, and says every market tool takes a `symbol`
when `run_screener` does not. `forge_tool`'s description (`:975-979`) promises `method`, `ttlMs` and
`paramMapping` that the offered schema (`name, description, urlTemplate, parameters_json, extractPath`)
does not carry, and its receipt (`:2838`) sends the human to **Settings → AI Models** while the manager
actually lives at **Settings → Skills → Forged tools** (`App.tsx:1358`); `toolActionFromResult` repeats
the wrong route (`:88-91`).

### Dead

**T-8** — `ARBITER_ALLOWED_TOOLS` (`:4041-4057`): definition plus one comment at `:2585`, no importer.

---

## 4. Skills

**Working — the catalogue is lazy** — **CODE**. Names/descriptions/IF–THEN ride the prompt
(`SkillMemoryService.ts:667-771`, `tradeChatContext.ts:272-380`); bodies come only from `skill_view`
(`DeskToolsService.ts:2874-2922`). Budget tiers scale by context window
(`utils/promptIndexBudget.ts:31-43`). Suspension is `enabled:false` + `meta.suspendedAt` through the
single `skillEnabledFlag` reader, as AGENTS.md requires.

**Working — the known proposal bug is substantially fixed** — **PROVEN by probe coverage**. The old
unconditional-success/`void`-write failure that `skillApproval.ts:1-20` documents is gone: approval now
reads the library back, names the refusal, leaves the draft on a failure, claims an unused slug on a
name collision instead of throwing (`SkillMemoryService.ts:3152-3162`), and stamps `approvedBy:'human'`
so a post-mortem Save actually injects (`:3136-3145`). `scripts/probe-skill-approval.cjs:375-444`
covers happy / collision / duplicate / forced-write-fail / rescope against the real app and asserts
notebook **bytes**, not toasts. Do not re-report the original bug.

**Broken** — the residue is M-1 (the retry-after-failure lie, PROVEN), plus these **CODE**-level gates
that disagree with each other:

- **S-1 duplicate approval does not activate.** `ingestCraftedSkillFromDraftUnlocked` treats *any*
  matching trigger as a duplicate regardless of `enabled`, `status` or retirement
  (`SkillMemoryService.ts:3116-3120`); `skillApproval.ts:40-43,92-94` consumes the draft and the toast
  says "already a live skill". A suspended or unapproved twin therefore swallows a human's Save while
  staying inert.
- **S-2 evolution loses the executable half.** Refinement and promotion carry prose but drop
  `predicate`/`description` (`SkillMemoryService.ts:1146-1154,1214-1222,2239-2243,2550-2560`), and
  version snapshots/revert omit them too, so a one-step undo can restore old text under new trigger
  logic. `skillPredicateGate.ts:193-201` evaluates `skill.predicate`, so this is operational, not
  cosmetic, schema drift. Withdrawal leaves `prior:'book'` (`:1051-1057,1115-1118`), which the injection
  gate still accepts.
- **S-3 shadow promotion claims a comparison it never makes.** Both versions get the same
  incumbent-matched outcomes (`:2211-2237`), yet the queued evidence reads "beat the live version's
  record" (`:2571-2594`).
- **S-4 eligibility is inconsistent.** Recurring-mistake suppression and avoid/repeat conflict detection
  admit unapproved skills (`MemoryRetrievalService.ts:226,645-653,678-687`) while ranked retrieval
  refuses them, so an inactive rule can silence a warning without offering guidance.
- **S-5 bundle import breaks on collision.** The head file is renamed with `uniqueName` while its support
  files keep the original slug (`SkillImportService.ts:151-166`), and `skill_view` validates bundle
  membership in the skill's folder but reads content by filename across all folders
  (`DeskToolsService.ts:2900-2917`) — so a second same-slug import, or a same-named support file
  elsewhere, reads the wrong bytes.
- **S-6 receipts without read-back.** `draftGates.ts:241-254` ignores a nullable queue result and
  reports `queued`; `skillDrafts.ts:84-88` (`takeSkillDraft`) ignores the failed write. Note
  `queueSkillDraft` *does* read back (`:77-81`) — the discipline exists, these two sites skip it.

**Hollow** — `recall` returns one matching line capped at 240 chars and `get_notebook_map` returns
blurbs (`MemoryFilesService.ts:722-740,1639-1665`), while the topics index promises the full note.
Model-authored notes are `autoManaged`, which excludes them from topic indexing *and* amendment
eligibility (`MemoryFilesService.ts:1571,1583`; `memoryAmendments.ts:99`) — a guard with a reason, but
the consequence is that the model cannot correct its own notes.

---

## 5. Multi-model handling

- **Routing** — **CODE, Working with one hole.** One model answers one turn
  (`useAnalysisPipeline.ts:1081-1096`); the picker is provider-qualified so duplicate model names cannot
  route silently. The hole is L-10's two definitions of "ready".
- **Ensemble / debate / moderator** — **DEAD, correctly.** The engine is gone; Full-analysis records
  `analystCount: 1` (`:1160-1184,1234`). Residual vocabulary — `ARBITER_ALLOWED_TOOLS` (T-8),
  `DebateMailbox.ts`'s name, `send_message`/`read_message`, `docs/plans/debate-deletion-status.md`,
  mandate prose (T-7) — is **live under a stale name**, not dead code: the mailbox serves panel
  cross-talk and group rounds (`chatPanel.ts:50-93`, `groupRounds.ts:14-15`). Rename, do not delete.
- **Fallback on failure** — **CODE, Hollow**. There is no cross-provider fallback. A 429 does not move
  to a second model; it trips L-1 and stops. Retries are per-request and uneven: localhost SSE retries
  opening failures but not midstream (`GenericProviderService.ts:1779-1874`), Electron streaming has no
  retry wrapper, buffered calls use bounded backoff (`:2077-2109`, `utils/apiErrorUtils.ts:195-235`).
- **Rate limit** — **CODE, Broken**: L-1.
- **Panel/group** — **CODE, Working**. Up to five deduplicated seats in serial, mentions reorder, last
  configured seat synthesises; groups run ≤3 rounds/12 turns with a real abort controller
  (`useAgentGroups.ts:117-231`). Both rebuild the room transcript per send, which is a policy choice
  worth knowing: earlier displayed exchanges are not history.

---

## 6. Trade lifecycle

| stage | verdict | evidence |
|---|---|---|
| plan → present | **Working** — CODE | `presentTradeTool.ts:78` parses, stamps `planId`, gates, draws; acceptance rechecks the gate and dedupes; `App.tsx:1506-1554` writes a **PENDING message**, not a journal row — correct for a plan that has not happened yet |
| gate refuses | **Working** — CODE | `proposalGate.ts:107` refuses on `netEdgeR`, arithmetic in `utils/netRiskReward.ts:283`, charged at write time (`useTradeLogging.ts:351-352`) — the register's O-07/O-19/O-20/O-22 are genuinely closed |
| track entry/TP/SL | **Broken** — CODE | `levelWatchService.ts:124-141,217-235` disarms the previous symbol when the chart symbol changes, and `useWatchAndAutopilot.ts:138-173` registers only the **active conversation's** pending messages, unregistering on switch. A plan made in thread A stops being tracked when the trader opens thread B |
| settle outcome | **Broken** — **PROVEN** | A-4 |
| journal write | **Working** — CODE | `useTradeLogging.ts:360-469`; `timestamp` = write time, `decidedAt` = analysis time, `planId` copied, `outcomeResolvedAt` = detector time (not the fill time), `pnlAmount`/`pnlPercent` kept as captured, MAE/MFE = raw excursion × settlement leverage, `realizedR` gross with `costR`/`netR` siblings |
| review → learning | **Working** — CODE | settlement → reflection (`:524-555`) → notebook diary/evidence/IF-THEN (`SkillMemoryService.ts:3852-3855`) → human-gated draft. Not logging-instead-of-acting |
| correct → relearn | **Broken** — CODE | `useTradeJournalActions.ts:337-409` patches selected fields with no recomputation, so flipping WIN→LOSS keeps positive `realizedR`/`netR` and the skill ledger keeps the old evidence; `useTradeLogging.ts:534-535` lets reflection overwrite a human edit with its whole-row snapshot |
| weekly digest | **Broken** — **PROVEN** | A-5 |
| exchange orders | **Missing by design** | no order placement anywhere; levels are advisory (`tradePlanLevels.ts:9-14,259`), consistent with the no-exchange-writes boundary |
| plan amendment | **Dead** — CODE | the update initiator is not returned from the hook and its modal has no opening caller (`useTradeLogging.ts:972-1021,1108-1140`); `priorAnalysis`/`priorMessageId` are passed and accepted but never read (`useAnalysisPipeline.ts:509`, `utils/trustSurface.ts:114`) |

**A-4 — a TP1→breakeven trade is halved twice** — **PROVEN**. The shared engine already blends the
exit: `resolveOutcomeFromScan` returns `(TP1 + breakeven)/2` (`outcomeEngine.ts:335-344`, and the header
at `:319-334` says this exists precisely because "without the blend a half-out trade … ~2× inflates
`realizedR`"). `OutcomeAutopilotService.buildWinResolution` then multiplies the *already blended* price
by `scaleOut = 0.5` again (`:523-539`, `computePnLFromPrice` `:484-495`). Measured on entry 100 / SL 90
/ TP1 110 / 10×: `exitPrice:105`, `pnlPercent:25`, `realizedR:0.5`. The same row therefore books 0.5R —
50% leveraged — and 25%. One of the two is wrong, and the R half is the one the skill ledger
accumulates, so the PnL column is the liar. Adjacent, **CODE**: the verifier passes `startIndex`
(`AutoCaptureService.ts:387`), which tells the engine entry was already established and bypasses the
same-candle ambiguity protection at `outcomeEngine.ts:179-197` — a Long with open 105 / high 111 / low
99 on entry 100 can credit TP110 on a candle whose high may precede the fill. And a TP1→BE result
returns the **TP** candle as `exitCandleIndex` (`:349-350`), so `computeTradeExcursions` (`:374-390`,
deliberately bounded to the held window) truncates the window before the actual breakeven exit and
understates MAE/MFE.

**A-5 — the weekly digest turns missing dollars into `$0`** — **PROVEN**. `buildWeekStats` sums
`t.pnlAmount ?? 0` (`weeklyReview.ts:84`) and both the prompt and the card print `Net $0` (`:96`,
`components/journal/WeeklyReviewCard.tsx:33`). Measured: percentage-only closes → `netPnlUsd:0`. A week
of percentage-only trades is reported as a zero-P&L week, and that fabricated number is what the coach
prompt is grounded in (`buildWeeklyImpulsePrompt:102-110`, "grounded in the numbers above"). **CODE**
additionally: `WeeklyReviewCard.tsx:15-19` loads once per username and never reloads when boot-time
generation finishes, so a digest computed during this session is invisible until remount.

**A-6 — provenance is dropped on two settlement paths** — **CODE**. The accepted-proposal message omits
`modelsUsed` and run identity (`services/trade/proposedTrade.ts:370-379`), and settlement copies the
absent fields (`useTradeLogging.ts:420-431`); the expired-entry path drops `planId` and
`outcomeResolvedAt` (`:775-787`). The capture-enabled branch omits detected PnL%, SL optimisation and
autopilot provenance from its candidate (`:878-899` vs `:709-715`).

**A-7 — malformed imports pass validation** — **PROVEN**. `isValidUserProfile` accepts
`typeof analysis === 'object'`, and `null` satisfies that; only `tradeLog[0]` is inspected
(`utils/profileUtils.ts:24-28`). Measured: `nullAnalysisAccepted:true`. The first CSV export after such
an import dereferences `t.analysis.coinName` (`utils/reportExport.ts:40`) and throws.

**A-8 — clocks disagree about which clock is the truth** — **CODE**. UTC+8 helpers exist
(`utils/timezone.ts:13-33`) but discipline analytics buckets **UTC** days
(`utils/disciplineAnalytics.ts:114-121`), the HTML report uses **host-local**
(`utils/reportExport.ts:88,124`), weekly selection uses **journal-write** time (`weeklyReview.ts:70-72`),
and analytics dollars are a synthetic `$10,000`/1% basis (`disciplineAnalytics.ts:90`). For a UTC+8
trader, "this week" is a different window in each surface.

---

## 7. Prompt and context budget

Measured from the wire on a real mock-provider desk turn (JSON content chars, **not** tokens):

```
background turn  system  540  user 2,485   tools —
DESK TURN        system 13,362  user 2,678  tools 40 schemas 37,379 chars
background turn  system  608   user 4,075   tools —
```

- **The tool schemas are the largest single cost per turn — 37.4 KB beside a 13.4 KB system prompt, i.e.
  ~2.8× the prose** — and they ride *every* round of *every* desk turn. 40 of the 52 definitions were
  offered; the narrowing that produced 40 is the allow-list plus the absence of a canvas. This is the
  register's **O-17**/E-30, live and measurable.
- Mandate prose alone: **2,828 chars** (`deskToolsMandateFor`) with self-modification off.
- Configured allowances, not measured totals: index caps 30/30/12/6 (≥200k), 20/16/8/4 (≥100k),
  10/8/4/3 (≥32k), else 4/4/2/1 (`promptIndexBudget.ts:31-43`) — with the dock's profile-memory call
  bypassing them (M-3). Output `DESK_ROUND_MAX_TOKENS = 8192` (`:244`), ≤8 rounds × ≤3 calls. Chart
  packet ≤10% of window capped at 6,000 estimated tokens (`tradeChatContext.ts:55-56,117-122`). Context
  window resolves override → provider-stated limit → discovered → **assumed 1,000,000**
  (`utils/contextWindow.ts:136-175`), made safe by the transport retry that records a rejected limit —
  do not "fix" the default smaller.
- **Low-value by measurement, not taste:** the 2,828-char mandate contains dead debate vocabulary (T-7)
  and `forge_tool`'s schema lies about three fields; `gateInjection` is an empty literal fed to an
  unreachable branch (L-8); ~1,245 lines of `constants/prompts/` exist and only `chatPrompts` plus the
  registry layers reach a model (O-17 re-verified).
- **Not verified:** exact token counts (no tokenizer ran), and whether compaction's repeated rescans
  (`contextCompact.ts:217-290`) cost anything at this history size. Profile before claiming.

---

## 8. Feature inventory — Keep / Fix / Remove / Merge

| family | verdict | why |
|---|---|---|
| Nav, four surfaces, shortcuts | **Fix** | all four mount and route; expansion affordance is offered outside Chat with no visible rail (`App.tsx:2397,2573`, `useSurfaceRouter.ts:99`) |
| Session/network status, offline replay | **Keep** | real queue, real awaited reconnect replay (`OfflineQueueService.ts:89`) — but its items die on L-1 |
| Profiles, storage info | **Fix** | switch/import/export are real; L-2 makes switching unsafe |
| Chart, timeframes, indicators, drawings, screenshot | **Keep** | live klines, real indicator/drawing mutation, PNG→chat works |
| Order book, screener, Live Market | **Fix** | feeds are real; the screener message lies (T-9), the book digests unavailability (T-2) |
| Solo chat, attachments, Full analysis, desk tools | **Fix** | the strongest part of the app; fix T-1/T-2/L-3 inside it |
| Transcript detail, vision viewer, versions/revert | **Keep** | the owner's 2026-10-27 versioning and export work is correct and must be preserved (`useConversations.ts:126`) |
| Bot roster + DMs | **Fix** | roster persists, requests run; Stop cancels the pipeline, not the mailbox request (`useBotMailbox.ts:199`, `App.tsx:2538`) |
| Group rooms + rounds | **Keep** | real runner, bounded rounds, wired cancellation |
| `ask_user_input` | **Missing** | L-11 — nothing to fix; Phase 3 builds it |
| Trade proposals, pins, logging, capture | **Fix** | advisory + journal only, which is correct; fix A-4/A-6 |
| Price watches, timed wakes | **Fix** | clock runs off-view (`watchService.ts:145-207`) but the only subscriber is the mounted Trade surface (`TradeView.tsx:719`), and `:183,196-204` **delete the watch before emitting** — an expiry with the dock elsewhere is dropped with no durable record |
| Journal CRUD, filters, insights | **Fix** | mutations real; A-8 correction semantics |
| Journal stats, equity, weekly/monthly | **Fix** | A-5 |
| CSV + printable report | **Fix** | CSV downloads; the HTML report opens a blob window Electron denies (`reportExport.ts:138`, `electron/main.cjs:1063`) |
| Providers, model discovery, test | **Fix** | real operations; tab switch silently discards unsaved provider drafts with no guard (`useProviderConfigs.ts:50`, `ProviderManager.tsx:152`, `SettingsMenu.tsx:278`) |
| Harness/motion/capture settings | **Keep** | controls write and persist |
| Prompt overrides, custom instructions | **Keep** | save/reset real |
| PDF playbooks, OCR, strategies | **Keep** | extraction, summarise, save, enable, delete all real; respects the master switch |
| Skill library, import, pin/retire/delete, Try | **Fix** | mutations real, Try inserts `/slug`; the import collision breaks bundles (S-5) |
| Named plans, forged tools | **Fix** | human gate real (network policy is good); T-5 durability |
| Coach drafts, approval, rewrites | **Fix** | the approval refactor is sound; M-1/S-1 are its residue |
| Autopilot approval inbox | **Fix** | Allow/Deny/Always/Never wired; "Show the trade" switches surface without locating the row (`App.tsx:2098,2145`) |
| Notebook, topics, profile memory, recovery | **Fix** | M-3, M-4, §4 hollow recall |
| Health, supervisor, diagnostics, usage | **Keep** | real readouts, real clearing, no fabricated dashboard values |
| Scheduled learning maintenance | **Keep** | heartbeat drives due-checked passes; it is **not** a general job scheduler and should not be advertised as one |
| Goals, focus, versions, tool policy | **Keep** | CRUD + optimistic version checks reach the notebook store |
| Self-modification + undo | **Keep** | proposals gated, revert implemented; unrestricted autonomy is not implied |
| Activity drawer (`JobsDrawer`) | **Merge** | reads completed skill evaluations once per open and titles the empty state **"Nothing running"** (`components/settings/JobsDrawer.tsx:34,68`) — a store of past verdicts is not a list of running jobs. Rename to *Recent skill audits* or fold into Health |
| Backups, restore, transcript export | **Keep** | create/import/export/restore/delete real (`BackupManager.tsx:52,132,283`) |
| Training JSONL export | **Fix** (not dead — see the correction below) | `SettingsMenu.tsx:566-571` omits `loggedTrades`, so `ActionsTab.tsx:19` defaults to `[]` and the button is disabled at that one mount; the label, `disabled` binding and export call are correct (`:41-51`) |
| Desktop updates | **Fix** | auto-download is disabled (`electron/main.cjs:1153`) and the only Download button is inside the orphaned default `NavRail` (`UpdateButton.tsx:119`); `UpdateOverlay.tsx:145` excludes `available`, so an available update has no reachable action |
| Compare / reanalysis / simulator overlays | **Remove** | sole openers have no consumers (`useCompareRuns.ts:19`, `useTradeLogging.ts:972`); conditional JSX cannot make them reachable. Keep the Monte Carlo service the tools call |
| Default `NavRail` component | **Remove after rehoming** | no rendered/default-import caller (`components/shell/NavRail.tsx:140`); `AccountRow` and constants beside it ARE live (`App.tsx:111`) — move the update download first (owner rule: "Remove X names a container") |
| Android `GallerySaver` bridge | **Remove or wire — owner call** | both halves exist, neither is called (`plugins/GallerySaver.ts:15`, `MainActivity.java:10`) |
| Duplicate launchers, skill browsing | **Merge** | Journal launchers share a destination; `SkillsCatalog` overlaps Studio browsing |
| Cosmetic status copy | **Fix** | hardcoded "Active only"/"Awaiting approval" badges misdescribe mixed lists (`SkillsLibrary.tsx:37`); "Learn → System" names a tab that does not exist (`SettingsMenu.tsx:413`) |

**Correction of one delegated claim, recorded because the mission says verify live.** The features agent
reported training export "permanently disabled". Read forward, the disabled button at that mount is
real, but it is a **missing prop at one call site** — a one-line Fix, not a dead feature. Fix it and
prove the button enabled with a row present.

**T-9 — the screener calls a successful empty scan a feed failure** — **CODE**.
`screener.ts:148-156`: `screenerToMarkdown([])` returns
`SCREENER — no rows (universe fetch failed; treat as UNKNOWN).` for *any* empty array, and the tool
path filters `setupsOnly` **after** a healthy scan (`DeskToolsService.ts:3814-3819`), so "nothing
matched" is reported to the model as "the universe fetch failed". The formatter's empty-string output
was reproduced live; the full scanned→filtered→tool chain needs a passing control before the fix ships.

---

## 9. Phase 3 candidates judged against Phase 0

| candidate | state today | honest next step |
|---|---|---|
| `get_trade_log` with full records + logged time | **Partial, and its description is false** (T-4, PROVEN) | keep the compact last-20 as the default view; add an explicit record mode bounded by the existing per-tool budget + spill paging (`get_trade_log` budget is 4,000; `toolArtifactStore` already pages the tail). Fix `since` to the field it names |
| Last-20 summary at session start | **Present but not injected** — `enhancedPrompt` is discarded (L-8); on-demand works | decide by wiring or deleting the dead assembly, not by adding a third path |
| Review on entry/TP/SL hit | **Partly real** — detection dispatches; tracking coverage is per-conversation (§6) and `outcomeResolvedAt` is detector time | widen registration to all accepted plans, then attach the review pass to a *settled* row with `planId` intact (A-6) |
| Complete trade data (planId, MAE/MFE, units, models) | **Schema exists, provenance leaks** (A-6) | stop dropping fields on two paths before proposing a richer record |
| Proposals + weekly digest | **Both real**; digest fabricates `$0` (A-5) | label unknown dollars as unknown |
| Clean training JSONL | **Export exists** (mount gap above; omits `decidedAt`, net/cost R, correction provenance, and puts post-hoc `followedPlan` under `decision`) | fix the mount, then the schema |
| OKX CSV / screenshot / PDF import | **Missing** — profile/backup JSON import only; screenshots reach chat vision, non-image attachments are read as **text**, and real PDF extraction exists only for strategy documents | genuinely new work; the CSV path is the only one that can carry stop moves and order modifications, and UTC+8 semantics (A-8) must be settled first |
| Durable trader profile injected when relevant | **Half-present** — style/risk/mistakes are profile memory with relevance pre-read; boot `profile/memory.md` is *regenerated*, not editable | promote the fields the trader must own into profile memory rather than adding a fourth store |
| Propose → approve → track to outcome | **Exists** end-to-end (`present_trade` → PENDING message → watch → settle → journal) | fix coverage and provenance rather than rebuilding the flow |
| `ask_user_input` | **Missing** (L-11) | new tool + inline option UI + suspend/resume + timeout + real cancel; T-1's deadline plumbing is a prerequisite, not a convenience |

---

## 10. What was reproduced live, and what was not

Reproduced in Chromium against the running app (dev server `:4331`, `scripts/mock-provider.cjs` `:9831`,
fresh profile "Mission Audit", all external hostnames aborted), zero page errors; the plain mock send,
reload persistence and memory read-back all passed:

| probe | observed |
|---|---|
| boot | `title:"August Trading"`, textarea present |
| inventory | desk 41, chart 9, mail 2, schemas 46,597 chars, mandate 2,828 |
| deadline | `signalProvided:false, aborted:false, lateEffect:true` |
| worker isolation | both requests rejected `"audit worker crash"`, both workers terminated |
| forged quota | `ok:true, proposed:true`, `localStorage` key `null` |
| skill retry | first `write-failed` → retry `duplicate`, drafts `0`, cached `true`, durable `false` |
| outcome math | `exitPrice:105`, `pnlPercent:25`, `realizedR:0.5`, `nullAnalysisAccepted:true`, `netPnlUsd:0` |
| trade log | row printed on decision date; `since:2026-10-26` returned `0` for a trade logged `2026-10-27` |
| unavailable digests | `liquidations · 0 recent events · $0k` / `order book · buy wall — · sell wall —` / `web search · ok` |
| memory | `remember` → `{saved:true,created:true,version:1}`; reload → `read_memory` returns the verbatim quote |
| wire | system 13,362 + user 2,678 + 40 tool schemas 37,379 chars |

**Not verified live, and therefore not claimed:** real providers and the other three API formats (only
`chat_completions` was exercised); the packaged Electron shell, `installer-smoke`, native safeStorage and
the auto-updater; Capacitor/mobile; real OKX/Binance responses and the retired liquidation endpoint's
live behaviour; actual token counts (no tokenizer ran — the figures above are JSON character lengths);
whether `web_search` is reachable from this host (CORS/egress blocked); the quadratic-compaction concern
(§7); and the Monte Carlo synchronous-fallback main-thread stall. Full `render-probe`, `boot-probe` and
`skill-approval-probe` were **not** run in this session; the baseline chain that was run is listed in the
header.

---

## 11. Decisions this audit cannot make

Recorded with the default Phase 1 will take if no answer arrives; none of them block.

1. **Which clock is authoritative** (A-8). Default: bucket by **UTC+8** everywhere the trader reads a day
   or a week, keep `timestamp` as the write time and print both labels.
2. **TP1→breakeven and multi-TP exit policy** (A-4). Default: keep the engine's blend as the single
   source and delete the autopilot's second `0.5`; the 50/50 blend and the 150 % zone stay policy, not
   measurement (the register's O-09/O-21).
3. **Correction semantics** (journal edit after settlement). Default: a corrected outcome triggers
   recomputation and *appends* correction evidence; it never silently keeps the old label beside the new
   R.
4. **Whether tracking covers every accepted plan or only the active conversation** (§6). Default: every
   accepted plan, persisted — the current behaviour is an accident of hook placement, not a ruling.
5. **Comprehensive candidate log (D-24 / O-14 / E-42b)** stays deferred as ruled; `decline_trade`'s
   bounded ledger is not that thing and should not be described as if it were.
6. **Removals** (compare/reanalysis/simulator overlays, default `NavRail`, `GallerySaver`) — all three are
   proven uncalled, but NavRail needs the update button rehomed first, and `GallerySaver` is a half-built
   feature the owner may want wired. Default: remove the two overlays, rehome-then-remove NavRail, leave
   `GallerySaver` with a STATUS note.
7. **Training JSONL schema** — adding fields is cheap, changing them later is not. Default: export a
   superset with `decidedAt`, `netR`, `costR` and correction provenance, and move `followedPlan` under
   `review`, where it belongs.
