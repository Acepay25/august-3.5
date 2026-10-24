# UI shell, surfaces, streaming & progress feedback, and the minimalist-UI doctrine

**Section baseline for the August Trading repo (`C:\Dev\august-3.5`).**
Method: static reading only (`git`/file inspection, no build, no run, no network, no keys).
Every claim below carries a `file:line`. Where the code and a comment disagree, the
comment is quoted and the discrepancy is called out rather than resolved by guesswork.

Date of pass: 2026-10-22. Tree under inspection: working copy at `C:\Dev\august-3.5`
(`App.tsx` 2823 lines; `index.css` 1769; `components/agents/AgentsView.tsx` 1664;
`components/trade/TradeChatPanel.tsx` 1289; `components/trade/TradeView.tsx` 1201).
All line counts in §10 are true file line counts.

**Tree state note.** The working tree was already dirty when this pass began: `git status`
reports six modified source files (`components/agents/AgentsView.tsx`,
`components/shared/AnalyzedRow.tsx`, `components/shared/ChatTranscriptRow.tsx`,
`components/shared/ReasoningRow.tsx`, `components/trade/panels/ChatWorkTimeline.tsx`,
`tests/tradeChatTimeline.test.tsx`, +60/−9) and an untracked
`docs/research/REVERTED-unintended-edits.patch` that records the same diff. Those edits add
a `startedAt` / `at` work-clock field to the transcript rows so a surface switch does not
restart a running turn's clock. **This pass is against the WORKING TREE (those edits
included), not against HEAD**, and **this pass made no source change of any kind** — the
only file written is this report. None of the findings below depend on which of the two
states the tree is in.

---

## 1. FEATURE LIST

Legend: **REAL** = the control/feature does what its label says, in the running app.
**COSMETIC** = rendered or declared but not wired, not mounted, or a dead prop.
**MIXED** = the mechanism is real, but the instance named is not (or is only half).

### 1.1 The shell / routing

| # | Feature | One-sentence | Verdict | Evidence |
|---|---|---|---|---|
| 1 | **Surface router** | One hook owns the current surface, the Journal deep-link tab, and the two hash effects that keep the URL and the screen in agreement (apply-from-URL and write-back-to-URL, with a ref between them so they do not thrash). | REAL | `hooks/useSurfaceRouter.ts:54-171`; the ref discipline at `:71,102,137,145`; `serializeAppHash` write-back at `:159-162` |
| 2 | **Surface persistence** | The surface is persisted in `localStorage` under `august_surface_v1`; the retired ids `'chat'`, `'boards'`, `'skills'` all migrate to `'trade'`. | REAL | `hooks/useSurface.ts:15-31` (migration at `:24`) |
| 3 | **Title-bar surface switch** | The one navigation control: four icon buttons, `aria-current="page"` on the live one, `Alt+1/2/4/5` chords, live badge counts riding the glyph. | REAL | `components/shell/SurfaceSwitch.tsx:33-79`; built once in `App.tsx:2242-2260`; handed to the band (`App.tsx:2543`) and to the Chat surface (`App.tsx:2733`); chords `App.tsx:1343-1349` |
| 4 | **Nav rail** | The persistent left column (`NavRail.tsx`, 242 lines) — expand/collapse, destination rows, update button, account row. | **COSMETIC** | The component is **never rendered by the app**. `App.tsx:2507-2515` says so in the source; `tests/deadControlsGuard.test.ts:145` pins `expect(appSrc).not.toMatch(/<NavRail/)`. Only two exports are live: `AccountRow` and `NAV_RAIL_AUTO_COLLAPSE_PX` (`App.tsx:129`). Its own collapse button (`NavRail.tsx:202-212`) and its `UpdateButton` (`NavRail.tsx:228`) are unreachable. The plan keeps it on purpose pending E-50 (`docs/plan/open-items.md:182`), and `tests/agentsSurface.test.tsx:401` still mounts it — so the file is alive in the suite and dead in the app. |
| 5 | **Surface menu list** | `SurfaceMenuList.tsx` — the "five surfaces" row list, the brand-gradient active bar, the "a conversation is still running" busy badge. | **COSMETIC** | Its only mount is `App.tsx:2725-2731` with `hideSurfaces` set, so `!hideSurfaces && SURFACE_ITEMS.map(...)` (`SurfaceMenuList.tsx:135`) never evaluates. The only live row is "Customize" (`:207-223`). Consequences: the brand-gradient active-nav bar (`:165-170`) and the busy badge (`:142, :188`) are dead. `tests/deadControlsGuard.test.ts:147-150` pins the *shape* of this but not the consequence. |
| 6 | **Customize row** | The one live destination row: opens the Knowledge surface's Skills tab (the Strategy Studio). | REAL | `components/shell/SurfaceMenuList.tsx:207-223` → `App.tsx:477-480`; probe asserts it lands on the Skills tab: `scripts/render-probe.cjs:1892-1904` |
| 7 | **Status cluster** | Save state, offline state, and the single opener for the Activity drawer. | REAL | `components/shell/StatusCluster.tsx:27-78`; built once `App.tsx:2261-2268` |
| 8 | **Activity drawer** | Background jobs, automations, skill audits — one drawer for everything the app does on its own. | REAL | `App.tsx:2496-2504`; `components/settings/JobsDrawer.tsx` |
| 9 | **Right-panel contract** | One geometry/lifecycle contract for every right-hand panel: `push` vs `fullscreen`, hide ≠ close, per-surface persisted width, capsule strip only when >1 panel is open. | REAL | `hooks/useRightPanel.ts:82-207`; `components/shell/RightPanel.tsx:56-166`; mounted by the dock (`components/trade/TradeView.tsx:1151`) and by Learn (`components/learn/LearnView.tsx:325`) |
| 10 | **Header band** | The rail-less surfaces' title bar: switch, session pill, Settings gear, status cluster. | REAL | `components/shared/Header.tsx:60-341`; mounted `App.tsx:2528-2547` (guarded off the Chat surface) |
| 11 | **Header's `isAnalysisInProgress` / `currentVisionData` / `pendingQueueCount`** | Three props the band declares and App computes, and the band never reads. | **COSMETIC** | Declared `components/shared/Header.tsx:12,13,20`; the destructure list at `:61-74` omits all three; App passes them at `App.tsx:2531,2532,2535`. `pendingQueueCount` is a live state (`App.tsx:527`, set at `:924` and `:964`) whose only consumer is a prop nobody reads. This is the same defect class `tests/deadControlsGuard.test.ts:232-251` exists to catch — for `SettingsMenu`, not for `Header`. |
| 12 | **App's `isNavOverlay` / `closeNavOverlay`** | Two locals declared for the narrow-viewport rail overlay, used nowhere. | **COSMETIC** | `App.tsx:687` and `App.tsx:702`; repo-wide grep finds no other reference |
| 13 | **Session pill (Header)** | A disclosure in the band: the current trading session, the four session rows, live-market volatility/liquidation chips, warnings, and two links ("Live market view", "Vision data"). | REAL (with a naming caveat) | `components/shared/Header.tsx:194-305`; the two links open real overlays (`App.tsx:2305-2307`, `:2390`). Caveat: the button's accessible name is the bare session abbreviation ("NY", "Ldn/NY", "Off") with no `aria-label` (`:196-212`) — a screen reader hears "NY, button". |

### 1.2 The shared furniture

| # | Feature | One-sentence | Verdict | Evidence |
|---|---|---|---|---|
| 14 | **Disclosure (the one expander)** | A native `<details>`: the transcript's thinking row, the tool-output expander, the wire audit, the automation card's reasoning and Settings' "Advanced". | REAL (for those five) / **MIXED** (a second mechanism survives) | `components/shared/Disclosure.tsx:73-88`. A second mechanism still exists — `.collapsible-content` (`index.css:1455-1468`), a `<button>` + grid-collapse `<div>`, used at `components/shared/StrategySearch.tsx:269,325` and `components/dashboards/learning/LessonsSection.tsx:81`. That is the exact mechanism `Disclosure.tsx:4-15` says was retired ("the automation card's 'Reasoning (N)' was a `<button>` plus a grid-collapse `<div>`"). |
| 15 | **DetailModal (the one reader)** | Focus trap, `aria-modal`, Escape, backdrop click, view-only body. | REAL | `components/shared/DetailModal.tsx:43-93`; mounted for the agent card `components/agents/AgentsView.tsx:1643-1659`; probe/pins in `tests/rightPanelContract.test.tsx` family |
| 16 | **Jump-to-latest FAB** | The one return-to-newest control, at the one `JUMP_AWAY_PX` threshold; shows an **indeterminate** ring while a turn runs — never a percentage. | REAL | `components/shared/JumpToLatestFab.tsx:51` (threshold), `:66-79` (ring); mounted by both homes: `components/agents/AgentsView.tsx:1531-1537` and `components/trade/TradeChatPanel.tsx:1216-1220` |
| 17 | **Model menu (the one picker)** | `ModelMenu` + `ModelChip` + `ModelPicker`; the composer's trigger names Provider · Model · tier and one panel edits all three. | REAL | `components/shared/ModelMenu.tsx` (533 lines), `ModelChip.tsx`, `ModelPicker.tsx`; the composer's chip `App.tsx:208-223` |
| 18 | **Effort ladder + dial refcount** | One six-stop ladder, and one refcount of "is a dial on screen right now", so `Ctrl/Cmd+Shift+E` only fires where the tier it edits is visible. | REAL | `components/shared/effortScale.ts:21-58`; `components/shared/effortDial.ts:18-30`; the chord's guard `App.tsx:1337-1340` |
| 19 | **Tool-kind marks** | One glyph per tool kind, shared by the transcript row and the Settings catalogue. | REAL | `components/shared/toolKindIcons.tsx:15-23`; used at `components/shared/ToolActivityRow.tsx:122-128` and `components/settings/tabs/DeskToolCatalogue.tsx` |
| 20 | **Wire-audit row** | Says which capability route the transport applied, or **why it applied none**. | REAL (mostly hidden by design) | `components/shared/WireAuditRow.tsx:47-75`; mounted only inside the work card, or alone when the turn settled with no trace AND the wire applied no route: `components/trade/panels/ChatWorkTimeline.tsx:96, 201-210` |
| 21 | **Chat row furniture** | `ChatTranscriptRow` is the shared row: markdown body, thinking row, tool rows, side-effect rows, copy/speak/pin/tier chips, key-levels card, verdict card. | **MIXED** | The component is real and shared (`components/shared/ChatTranscriptRow.tsx:107-253`), but the **Chat surface mounts it with only `row`** (`components/agents/AgentsView.tsx:1438-1441`). Therefore, in the Chat surface, `onRetry`, `onEditPrompt`, `onTogglePin`, `symbol` and `getMark` are all `undefined`, and the row therefore omits: the **Retry chip** (`:229`), the **Pin chip** (`:236-238`), the **Key Levels card** (`:189-199`), and the **"Run stopped"** card (`:219-226`). The dock has all four: `components/trade/panels/ChatTranscriptList.tsx:146,163` (retry), `:235-238` (pin), `:267-275` (key levels), `:204-216` (run stopped) — plus the memory-provenance strip the shared row has no prop for (`:245-251`). (The analysis-based **"Log this trade"** at `ChatTranscriptRow.tsx:239-244` is absent from **both** homes; the dock uses the proposal card instead, `ChatTranscriptList.tsx:276-311`.) |
| 22 | **Memory provenance strip** | "What did the AI actually remember for this answer?" — one hairline that opens the injected paths. | REAL, **dock-only** | `components/chat/MemoryProvenanceStrip.tsx:1-178`; mounted at `components/trade/panels/ChatTranscriptList.tsx:245-251`; **not** imported or mounted anywhere in `components/agents/AgentsView.tsx` |
| 23 | **Failure row** | A failed turn is drawn as a failure, in the provider's own words, in **both** homes. | REAL | `components/shared/ChatFailureRow.tsx:16-26`; Chat surface `components/shared/ChatTranscriptRow.tsx:173-178`; dock `components/trade/panels/ChatTranscriptList.tsx:174-183` |
| 24 | **"Run stopped" card** | The in-flow recovery for an interrupted turn (Edit prompt / Try again), rendered only with at least one handler. | REAL in the dock, **unreachable in the Chat surface** | `components/shared/InterruptedRunNotice.tsx:26-61`; dock `ChatTranscriptList.tsx:204-216`; Chat surface needs `row.interrupted` (`ChatTranscriptRow.tsx:219`), but `chatRowFrom` (`components/agents/AgentsView.tsx:246-294`) never sets it and `types/message.ts` has no `interrupted` field (the flag is on the persisted `StoredChatEntry`, `services/trade/chatSessions.ts:103`, inherited by `chatStore.LiveEntry` at `chatStore.ts:48`) |
| 25 | **Run busy badge** | "A conversation is still running" — a pulse on the Chat nav row. | **COSMETIC** | `components/chat/RunBusyBadge.tsx:46-66`; its only mount is `components/shell/SurfaceMenuList.tsx:188`, inside the unmounted branch (see #5) |
| 26 | **Chat surface (`AgentsView`)** | The conversation rail (Chats/Bots tabs, search, sort, conversation list, rooms, roster) plus a thread and a pill composer. | REAL | `components/agents/AgentsView.tsx:959-1659`; rail `:972-1306`; thread `:1402-1538`; composer `:1541-1635` |
| 27 | **Chart AI dock (`TradeChatPanel`)** | The trade surface's right-hand conversation: sessions, transcript, composer, chart tools, key levels. | REAL | `components/trade/TradeChatPanel.tsx` (1289 lines); mounted `components/trade/TradeView.tsx:1170-1184` |
| 28 | **Work card (`ChatWorkTimeline` + `AnalyzedRow`)** | One expandable line that folds the whole turn's work: the live activity label, the tool rows, the wire audit, the side-effect rows. | REAL | `components/trade/panels/ChatWorkTimeline.tsx:72-213`; `components/shared/AnalyzedRow.tsx:45-152` |
| 29 | **Tool rows (`ToolActivityRow`)** | One row per **CALL** (never two lines per call); consecutive same-label calls fold into `label ×N`; a row with a payload id opens onto the real tool output. | REAL | `components/shared/ToolActivityRow.tsx:277-292`; the pairing rule `utils/turnStatus.ts:161-186`; the fold `:232-257`; the payload resolution `:88-104` |
| 30 | **Turn-status vocabulary** | One grammar, one pairing, one set of names for "what is this turn doing" — read by the rows, the status line and the summary. | REAL | `utils/turnStatus.ts:83-101` (grammar), `:115-130` (activity label), `:161-186` (pairing), `:197-212` (kind counts), `:228-247` (work names); the tool vocabulary `utils/toolKinds.ts:77-134` |

### 1.3 The ONE conversation home

| # | Feature | One-sentence | Verdict | Evidence |
|---|---|---|---|---|
| 31 | **`deskThread()`** | The desk pane's row filter: **every** row except a room row, and except an AI row a roster bot **positively** owns (`botId` in the roster). | REAL | `utils/agentThreads.ts:118-138`; the "only a POSITIVE claim removes a row" rule at `:126-137`; the "do not infer by model" rule at `:130-135` |
| 32 | **`threadForProvider()`** | A bot's 1:1 thread, derived as a view over the same flat message array; a row stamped for another bot is never claimed. | REAL | `utils/agentThreads.ts:42-104`; the stamp-beats-inference rule at `:58, 68-71, 86-89` |
| 33 | **`entriesForSession()`** | THE ONE MERGE: canonical rows first, then each local row **replaces** the canonical row of the same id, and a local row with no counterpart joins at the end. | REAL | `services/trade/chatSessions.ts:586-599`; the merge contract `:552-585` |
| 34 | **`liveEntryFromMessage()`** | The one projection of a canonical `Message` onto the dock's `LiveEntry`, carrying `Message.isStreaming` so a Chat-surface run still reads as generating in the dock. | REAL | `services/trade/chatSessions.ts:491-550`; the `isStreaming` carry at `:507-517` |
| 35 | **`startEntryMirror()`** | The dock→Chat mirror: copies the dock's live entry into the conversation under the **same id**, throttled on a 200 ms **timer** (never `requestAnimationFrame`) and always flushed on stop. | REAL | `services/trade/chatTurnMirror.ts:88-161`; the timer-not-rAF rule at `:22-30`; the flush at `:146-159` |
| 36 | **`ensureDockTurnConversation()`** | Adopts (or mints) the conversation a dock solo turn speaks into and makes it active, so the two homes show one thread. | REAL | `App.tsx:1819-1848`; the "a blank thread may still be answering" guard at `:1825-1830` |
| 37 | **`commitSoloChatTurn()`** | Writes a dock solo turn into the conversation **under the entry's own id** (upsert, never replace) so one turn is one row in both homes. | REAL | `App.tsx:1770-1807`; the id-is-the-contract note `:1761-1766`; the upsert `:1799-1805` |
| 38 | **`commitDockBotTurn()`** | Writes a dock **bot** turn into the conversation (question and answer as two rows), stamped `botId` + `modelsUsed` so `threadForProvider` claims it and `deskThread` excludes it. | REAL | `App.tsx:1738-1757`; the one-stamp-both-behaviours note `:1727-1732` |
| 39 | **Proposal disposition store** | One module map, keyed by the row id both homes share, so logging a plan on the chart marks it logged in Chat. | REAL | `services/trade/proposalDisposition.ts`; used `components/trade/panels/ChatTranscriptList.tsx:276-312` and `components/agents/AgentsView.tsx:1455-1482` |
| 40 | **Conversation housekeeping** | Create/reuse/load/delete conversations and edit a sent message; a switch moves the **view**, never the run. | REAL | `hooks/useConversationHousekeeping.ts:43-197`; the "switching threads does not kill the run" note `:123-137` |

### 1.4 The dead controls the guard already pins

| # | Feature | One-sentence | Verdict | Evidence |
|---|---|---|---|---|
| 41 | **`tests/deadControlsGuard.test.ts`** | A **source-contract** test, not a render test: it pins the *absence* of things (`BotManagerDrawer`, `Sidebar.tsx`, `NotebookSection.tsx`, the command palette, 18 vestigial `SettingsMenu` journal props) and the *presence* of one-of-each wiring. | REAL (as a source guard) | `tests/deadControlsGuard.test.ts:1-344`; 21 `it()` cases; it reads source with `readFileSync` (`:14-23`) and never mounts a component |

---

## 2. SURFACES

The app has **four** surfaces plus a set of overlays. `AppSurface` is
`'chat' | 'trade' | 'journal' | 'agents' | 'learn'`, but only `['trade','journal','agents','learn']`
are valid at runtime; `'chat'` is in the type union yet rejected by the store
(`hooks/useSurface.ts:13,16`) — a type that admits a value the runtime never returns.

| Surface | Job | Owner component | Honest? |
|---|---|---|---|
| **Trade** (`trade`) | The chart, the order book, the model-drawn levels, and the **Chart AI dock** — the conversation that has a chart next to it. | `components/trade/TradeView.tsx` (1201 lines), dock = `components/trade/TradeChatPanel.tsx` | **Yes.** Every dock control has a handler: `onToggleCollapsed`/`onToggleExpanded` (`TradeView.tsx:1172-1174`), `onOpenCoach` (`:1176`), `onNewGroup` (`:1175`). The order-book toggle is gated on its handler (`TradeView.tsx` market row, pinned by `tests/deadControlsGuard.test.ts:186-192`). |
| **Journal** (`journal`) | The trade ledger and the stats over it. Two tabs: History, Stats. | `components/journal/Journal.tsx` (383 lines) → `TradeLog.tsx` (743) + `WinRateDashboard`/`EquityCurveDashboard` | **Yes.** `onOpenJournal` from Settings routes to the surface (`App.tsx:1863-1865`). Two tabs, both real (`Journal.tsx:68-71`). |
| **Chat** (`agents`) | The conversation surface: rail of chats/agents/rooms + a thread + a pill composer. The surface id is `agents` and every testid still says `agents` — a deliberate compatibility choice, documented at `components/shell/SurfaceMenuList.tsx:56-63`. | `components/agents/AgentsView.tsx` (1664 lines) | **Mostly.** Every rail control is wired (New chat `:1012-1028`, Coach inbox `:1029-1044`, Chats/Bots tabs `:1062-1074`, search `:1075-1081`, sort `:1082-1089`, conversation rows `:1228-1267`, room rows `:1186-1210`). **But** the transcript row loses five affordances relative to the dock — see #21. |
| **Knowledge** (`learn`) | Approvals → Memory → Health → Skills: everything the system believes and the decisions waiting on the human. | `components/learn/LearnView.tsx` (364 lines) + the tab bodies | **Yes.** All four tabs are real (`LearnView.tsx:60-70`); the Approvals tab hosts the action-approvals, the Coach inbox and the amendments inbox (`:234-244`); the right panel is guarded against an empty box (`:355-357`, "Nothing selected to read."). |
| *(overlays)* | **Settings** (`components/settings/SettingsMenu.tsx`, 9 tabs, lazy bodies), **Activity drawer** (`JobsDrawer`), **Live Market**, **Vision Data**, **Data-capture / Update-trade / Scenario modals**, **Strategy Search**. | mounted `App.tsx:2305-2504` | **Mostly.** Settings' "Journal" tab (`SettingsMenu.tsx:207`) is a pure launcher (two cards that route to the Journal surface and the Learn surface — `components/settings/tabs/JournalTab.tsx:37-86`), i.e. a second, thinner way into a surface the title-bar switch already carries. |

### 2.1 How the router works

1. `useSurface` owns the surface **value** and persists it (`hooks/useSurface.ts:18-31`).
2. `useSurfaceRouter` owns the routing cluster: the surface, the Journal's deep-link tab, a
   monotonic `journalOpenNonce` (so re-opening the *same* tab still applies —
   `hooks/useSurfaceRouter.ts:66-70`), and the two hash effects.
3. Two effects, one ref between them (`hooks/useSurfaceRouter.ts:99-163`):
   - **apply**: read `window.location.hash`, write state, set `applyingHashRef = true`;
   - **write-back**: read state, serialize to a hash, `history.replaceState` — skipped while
     `applyingHashRef` is set.
   The ref is cleared in a **microtask** (`:137`) because the state writes above are not
   visible to the current render; clearing it synchronously would let the write-back effect
   see the pre-apply values and undo them.
4. Overlay precedence in the write-back (`:149-157`): Settings → Live Market → Watch list →
   Journal (with its tab) → Chat. So the **topmost visible overlay owns the URL**.
5. `handleSurfaceSelect` (`:91-97`) is a plain route — **no slide, no resize tween** (the
   hop used to carry a direction flag; the owner asked for the plain swap and the flag was
   removed, and the comment at `:86-90` explicitly forbids it coming back).

### 2.2 Is the navigation honest?

**Mostly yes, with one structural lie.**

- Every switch row goes somewhere real: `trade` → `TradeView`, `journal` → `Journal`,
  `agents` → `AgentsView`, `learn` → `LearnView` (`App.tsx:2555-2759`). The probe asserts
  all four mount (`scripts/render-probe.cjs:1203-1222, 1431-1432`).
- The surface **labels** are honest but the **ids** are not: the switch says "Chat" for the
  `agents` surface, and the Chat surface's own rail carries a row called "Chart AI"
  (`components/agents/AgentsView.tsx:1119`, `testId="chart-ai-row"`) for the **desk thread**
  — `onClick={() => selectThread({ kind: 'team' })}` (`:1122`). So a row named after the
  *other* surface's dock opens this surface's own thread, and the **same thread** is called
  "Chart AI" in the rail and **"Desk"** in the surface's own header
  (`components/agents/AgentsView.tsx:1365, 1372`: `activeSession?.title?.trim() || 'Desk'`).
  The render-probe clicks the "Chart AI" text to open the desk thread
  (`scripts/render-probe.cjs:1155-1160`), so the name is load-bearing in a test too.
  The code's own comment admits the split: "the dock row above keeps the 'Chart AI' name"
  (`:1364`, `:1371`).
- **The lie:** `SurfaceMenuList` is documented as "the five surfaces"
  (`components/shell/SurfaceMenuList.tsx:2`) and carries five `SURFACE_ITEMS` (`:44-70`),
  but in the running app it is mounted only with `hideSurfaces` — so the five-surface list
  is **never shown**. `SURFACE_ITEMS` is still the single source of truth for the switch
  (`components/shell/SurfaceSwitch.tsx:22, 39`), so the data is live; the *list UI* is not.
  The dead branch also carries the **only** live place the brand gradient marks the active
  nav (`SurfaceMenuList.tsx:165-170`) — so the doctrine's "brand gradient on the active-nav
  indicator" has no implementation in the running app, and the wordmark it was also
  reserved for is gone (`components/shared/Header.tsx:188-192`).

---

## 3. THE ONE CONVERSATION HOME

### 3.1 The contract of `deskThread()`

`utils/agentThreads.ts:118-138`:

```
deskThread(messages, bots) = messages.filter(m => {
    if (m.roomId) return false;          // a room row lives in its room
    if (m.role !== AI)  return true;      // human prompts, system rows: always in
    return !m.botId || !owned.has(m.botId); // AI rows: dropped ONLY on a positive claim
})
```

Three rules, all load-bearing:

1. **Only a positive claim removes a row.** The inference-by-provider+model was deliberately
   removed (`:130-135`): it once dropped the trader's own answer *outright* — the row
   existed and rendered nowhere. The cost of the current rule is a fixed historical set of
   pre-`botId` bot rows that can surface in the desk pane, which the comment calls "the
   cosmetic direction of failure". That trade is explicit and documented.
2. **A room row never leaks into the desk** (`:124`); a group room has its own thread
   selector (`threadForGroup`, `:160-197`), scoped by `roomId` so a recreated room starts
   empty.
3. **The claim is keyed on `botId`, not on provider+model** — a stamp is a fact, an
   inference is a guess, and the fact wins (`utils/agentThreads.ts:130-137`; pinned by
   `tests/deskThreadClaims.test.ts` per `AGENTS.md`).

`deskThread` is the **desk pane's** filter. It is *not* the conversation home — it is the
view of the conversation home that excludes other people's DMs.

### 3.2 How a turn started in one surface appears in the other

**The store picture.** There are two writers and one merge:

- `useConversations` holds `conversationHistory` — the canonical, App-side record
  (`hooks/useConversations.ts:11-81`). The Journal, the analyses gallery and the learning
  loop read it. It is capped at 200 messages per conversation, keeping message 0 as the
  anchor (`:47-49`).
- `services/trade/chatStore.ts` holds the **dock's** live sessions — a module singleton that
  survives unmount so a running stream is not aborted by a surface switch
  (`components/agents/AgentsView.tsx:18-20`).

**Chat surface → dock.** `liveEntryFromMessage` projects each canonical `Message` onto the
dock's `LiveEntry` (`services/trade/chatSessions.ts:491-550`). The critical field is
`streaming: !!m.isStreaming` (`:517`) — without it, a Chat-surface run showed as a *finished*
reply in the dock, with no work card, no live text and no Stop, and the next token then
rewrote it under the trader's eyes (`:507-517`). `entriesForSession` then merges: canonical
rows first, and a local dock row **replaces** the canonical row of the same id
(`:586-599`).

**Dock → Chat surface.** `startEntryMirror` subscribes to the store and copies the dock's
live entry into the conversation **under the same id** (`services/trade/chatTurnMirror.ts:88-161`),
throttled on a **timer** (`:72, 129-138`) and always flushed on stop (`:146-159`). The timer
is not `requestAnimationFrame` because the generating surface is the one that is *hidden*
while the trader reads the other, and a rAF writer fires zero times in a hidden tab
(`:22-30`). The commit lands through `commitSoloChatTurn` (`App.tsx:1770-1807`), which
**upserts** — it never replaces the row, so a field another writer owns (the analysis, the
planId receipt, an attached image) survives the next 200 ms patch (`App.tsx:1799-1805`).

**The thread exists before the first write.** A solo dock turn resolves its conversation at
send time (`ensureDockTurnConversation`, `App.tsx:1819-1848`): the session's own binding if
it still exists, else the unused blank conversation housekeeping reuses, else a fresh one —
and it is made **active**, so the thread the trader is typing in is the thread the other
home shows. A blank thread is only reusable if nothing is answering in it (`:1825-1830`).

**Either home can stop the other.** The dock registers its controller under the
**conversation** id as well as its session id; `cancelRunAt`
(`hooks/useAnalysisPipeline.ts:489`) falls back to that registry; the Chat surface folds
`snap.conversationRunning` into its busy flag (`components/agents/AgentsView.tsx:500-510`)
so the composer never offers Send over an answer that is arriving.

**The hop between the two surfaces.** Chat → Trade is a **route, not a mode**:
`openChartAi` (`App.tsx:415-418`) binds the chat store to the active conversation and
switches; the switch's own handler intercepts Chat → Trade for the same reason
(`App.tsx:2246-2255`). Arriving on either home shows the thread that is *answering*
(`App.tsx:428-445`).

**The agent's own claim about this was stale, and is now fixed (2026-10-23).**
`components/agents/AgentsView.tsx:10-25` used to open with "⚠️ THE TWO SURFACES DO NOT
SHARE A STORE TODAY" and said the Chat surface reads
App's `messages` while the dock reads `chatStore` — a true statement about the *writers*,
contradicted by the mirror and the merge that make them one transcript. The comment's
own cited evidence (`render-probe.cjs:488-492`) had moved. The banner now states the
contract: two row shapes, one thread.

### 3.3 Where the "one home" leaks

- **The row furniture differs.** See #21: the Chat surface's `ChatTranscriptRow` is mounted
  with only `row`, so the Chat surface has **no** Key Levels card, **no** Retry chip, **no**
  Pin chip and **no** "Run stopped" card, while the dock has all four, plus the
  memory-provenance strip. The Chat surface does render the verdict card and the proposal
  card (`AgentsView.tsx:1448-1524`) and compensates for the missing "Log this trade" with a
  separate `prose-plan-chip` (`:1490-1522`). The header of `ChatTranscriptRow.tsx:5-7`
  claims "both now render this over their own row model"; they do not render the *same* row.
- **The memory provenance strip is dock-only** (#22) — the "what did the AI actually
  remember" question is answerable on one surface only.
- **The `interrupted` flag has no canonical carrier** (#24): it lives on the dock's
  `LiveEntry` (`services/trade/chatSessions.ts:96-103`) and on `ToolTurnOutcome`
  (`services/trade/toolTurn.ts:67`), but not on `Message`. A turn started and stopped in the
  Chat surface is written to the conversation with its half-answer and **no** marker
  (`hooks/useAnalysisPipeline.ts:1455-1496` — `runStats` is omitted when
  `toolTurn.interrupted`, and nothing else marks the row).

---

## 4. STREAMING AND PROGRESS FEEDBACK

The states a turn passes through, and what the trader sees in each. Every row cites the
component that draws it.

| # | State | What the trader sees | Evidence |
|---|---|---|---|
| 1 | **Queued / pre-flight** | Nothing on the row. The **composer** changes: the send button becomes a **Stop** (rose), and it is disabled while there is nothing to send. | `components/agents/AgentsView.tsx:1606-1618` (`running ? StopIcon : ArrowUp`, `disabled={!running && !text.trim()}`) |
| 2 | **Running, nothing produced yet** | The **waiting tip**: a lightbulb glyph and "Tip: {trading tip}" — the one moment a tip is the right thing (`ChatWorkTimeline.tsx:117-127`). | `components/trade/panels/ChatWorkTimeline.tsx:121-126`; the tip's single home, per `components/shared/ReasoningRow.tsx:41-49` |
| 3 | **Running, with a trace** | The **Thinking** row: a pulsing lightbulb glyph, the word "Thinking", and a live seconds counter (`Thinking · 14s`). Collapsed by default; the body is a plain marker-stripped live stream with a blinking caret. | `components/shared/ReasoningRow.tsx:141-183`; the "row labels the TRACE, not the turn" contract `:133-139` |
| 4 | **Running, with tool work** | The **activity line** (`AnalyzedRow`): three pulsing amber dots, the **activity label** ("Reading the order book", "Running Monte Carlo"), and `· Ns`. The label is *derived* from the turn's own tool lines, so it can only report what the tools did. | `components/shared/AnalyzedRow.tsx:126-153`; the label source `utils/turnStatus.ts:115-130`; the activity phrases `utils/toolKinds.ts:77-134` |
| 5 | **Running, the turn is long and the trader scrolled away** | The **indeterminate ring** on the jump FAB — a dashed spinning circle, deliberately **not** a percentage, because a desk turn has no denominator anyone could honestly draw. | `components/shared/JumpToLatestFab.tsx:14-24, 66-79`; the same threshold both homes read (`JUMP_AWAY_PX = 240`, `:51`) |
| 6 | **Running, in the *other* surface** | The other home shows the same turn as still generating: the Chat surface folds `snap.conversationRunning` into its busy flag; the dock projects `Message.isStreaming` onto the row. | `components/agents/AgentsView.tsx:500-510`; `services/trade/chatSessions.ts:507-517` |
| 7 | **A tool call, BEFORE its result** | A row that reads **`⚒ order book · calling…`** — the label, the kind glyph, and the literal `calling…` in place of a detail. The state is derived from the *text* of the digest line, never stored separately. | `components/shared/ToolActivityRow.tsx:115-141` (the `anyCalling` branch at `:135-137`); the grammar `utils/turnStatus.ts:86-90` |
| 8 | **The tool's result** | The **same row updates in place** — `⚒ order book · ETHUSDT · buy wall $1.2M @ 94.8k`. The transcript never shows a call and its outcome as two lines. A failed call flips the glyph rose and prints `· failed`. | `components/shared/ToolActivityRow.tsx:126-141`; the in-place pairing `utils/turnStatus.ts:161-186`; the documented contract `components/shared/ToolActivityRow.tsx:209-217` |
| 9 | **The tool's real output** | A row with a payload id becomes a `<details>`: opening it shows the **actual bytes** the tool returned, with a chip saying whether the payload is `JSON` or `text` (derived from the bytes, never asserted by the tool). A payload that was not kept says so and says **how much was missing** — it never opens onto an empty box that looks like output. | `components/shared/ToolActivityRow.tsx:88-104, 147-166, 190-207` |
| 10 | **Several calls in a row** | Consecutive same-label calls **fold** into one line — `order book ×4` — which expands back to every member's real output. Folding is consecutive-only, so `chart draw → order book → chart draw` stays three rows. | `components/shared/ToolActivityRow.tsx:47-54, 221-257` |
| 11 | **The work card folds shut** | The moment the answer lands, `AnalyzedRow` collapses to one quiet sentence — `Ran 4 commands · read the chart, order book` (the count is of **calls**, never of transcript lines, because the desk writes two lines per call). The card is re-openable. | `components/shared/AnalyzedRow.tsx:56-69, 109-124`; the call count `components/trade/panels/ChatWorkTimeline.tsx:110-116`; the kind counts `utils/turnStatus.ts:197-212` |
| 12 | **The answer arrives** | Prose in the **reading role** (`AnswerBody` → `font-reading`), the answer's thinking tier as a muted chip on the action row, then the action row itself: Copy, Read aloud, and — **in the dock only** — Pin and "Log this trade", plus the relative time. | `components/shared/AnswerBody.tsx`; `components/shared/ChatTranscriptRow.tsx:228-252`; the tier chip `components/shared/chatChips.tsx:141-154`; the dock's own chip row `components/trade/panels/ChatTranscriptList.tsx:228-240` |
| 13 | **A turn that FAILED** | A **failure row**, in rose, in **both** homes: the uppercase micro-label "REQUEST FAILED" and the provider's **own words** underneath. It is not an answer and it is not the app's error hint. | `components/shared/ChatFailureRow.tsx:16-26`; Chat surface `components/shared/ChatTranscriptRow.tsx:173-178`; dock `components/trade/panels/ChatTranscriptList.tsx:174-183`; the error bubble is written with `error:` set and `text` mirroring it, so the row renders the error and not the text (`hooks/useAnalysisPipeline.ts:1591-1603`) |
| 14 | **A turn that was STOPPED (interrupted)** | The **"Run stopped" card** with two ways out — "Edit prompt" (prefills the composer) and "Try again" (re-dispatches the same prompt) — plus the cause line in rose when there is one. It renders **only with at least one handler**, because a "Run stopped" label with no button is a dead notice. | `components/shared/InterruptedRunNotice.tsx:26-61`; dock `components/trade/panels/ChatTranscriptList.tsx:204-216`; **unreachable in the Chat surface** (#24) |
| 15 | **A turn that produced prose and THEN failed** | It is **not** collapsed into the failure row: it keeps what arrived, and the reason rides inside the "Run stopped" card. Collapsing it would throw away the half of the analysis the trader still has to read. | `components/trade/panels/ChatTranscriptList.tsx:174-183` (the comment is explicit) |
| 16 | **A run that never started** | A **toast**, not a row: the pipeline's pre-flight failures ("already running", "no providers configured") have no transcript row to carry them, so they are reported by `onAnalysisError` → `toast.error`. | `components/agents/AgentsView.tsx:100-111, 798-800`; `App.tsx:2684` |
| 17 | **The turn settles and the work clock** | The clock freezes at settle and is persisted (`runStats.durationMs`), so a reloaded turn still reads "Analyzed for 14s" instead of restarting at 0s. | `components/shared/AnalyzedRow.tsx:86-92`; the persist `hooks/useAnalysisPipeline.ts:1463-1481` |
| 18 | **A turn running in a thread you are not looking at** | The nav's busy affordance — **but it is not rendered** (#5, #25). The remaining honest signals are the composer becoming Stop and the `aria-busy` on the transcript. | intended: `components/shell/SurfaceMenuList.tsx:108-118, 142, 188`; the `aria-busy` that does work: `components/agents/AgentsView.tsx:1432` |

**Summary of the streaming story:** it is genuinely well-built. One grammar
(`utils/turnStatus.ts`) is read by the activity line, the tool rows and the summary, so the
collapsed headline cannot disagree with the rows beneath it. The call→result pairing is
index-aware, so a payload id stays attached to the result line. The work card folds itself
shut on settle and reopens on demand. The indeterminate ring is an explicit refusal to
invent a denominator. The failure row is shared by both homes.

**The two leaks are: (a) the interrupted-run card is unreachable in the Chat surface, and
(b) the "a conversation is still running" affordance is rendered in an unmounted branch.**

---

## 5. THE MINIMALIST-UI DOCTRINE

### 5.1 What `docs/ui-doctrine.md` says

`docs/ui-doctrine.md` (151 lines) is a checklist, not an essay, and it opens with the rule
that decides conflicts: *"When a change violates two rules, the theme wins over the
component"* (`:8`). Its sections:

- **Color** (`:10-31`): page `#0b0b0a`, panels `zinc-900`, hairlines `zinc-700/800`;
  semantic hues from `index.css @theme` meaning one thing everywhere (emerald = gain,
  rose = loss, amber = warning, cyan = info); exactly **one cyan accent per view**;
  the brand gradient is on the wordmark and the active-nav indicator **nowhere else**;
  no gray remappings; micro-labels at ≥10px stay `text-zinc-600`; `.status-surface` /
  `.analysis-card` are deleted, not re-added.
- **Shape and borders** (`:33-40`): `rounded-control` (8px) for inputs/buttons,
  `rounded-bubble` (12px) for chat bubbles, nothing else invents a radius; hairlines
  `border-zinc-800/80`; no double borders; dividers are `border-t`, not boxed sub-cards.
- **Reuse — do not hand-roll these** (`:42-58`): a table of seven — state pill, empty view,
  tooltip, dropdown (`SelectMenu`), destructive confirm, segmented control (pressed-state
  buttons, **not** `.seg-thumb` on a container), chat measure (`.chat-column` 880px), empty
  backdrop (`.chat-hero-grid`), and a keyboard focus indicator (index.css outlines every
  focusable element on `:focus-visible`).
- **Type and numbers** (`:60-99`): sizes come from the `text-ui-*` ramp, **never** a
  `text-[Npx]` literal; Geist Variable for UI and JetBrains Mono for data; **no serif face
  ships** (`--font-serif`/`--font-reading` survive as *roles* resolving to the UI stack);
  the model's answer is prose with its own reading role; "a role is not a size"; every
  numeric readout is `font-mono tabular-nums`; tables over tiles.
- **Motion and density** (`:101-115`): transitions only via `--ease-snappy` at
  0.12–0.18 s; **no `transition-all`**; **no new `@keyframes`** — the existing tick-flash
  and beacon patterns are the sanctioned exceptions; no layout shift on stream chunks;
  dashboards default to one-line rows with disclosure, not cards inside cards.
- **Structure** (`:117-131`): a surface's IA follows the thing it models; **one home per
  concern** — "If a component appears in two surfaces, one of them mounts the other's
  component — nobody reimplements a table"; **no dead-end state**; **an affordance must do
  what its label says**; heavy surfaces are `React.lazy` with `SurfaceSkeleton`, never
  `fallback={null}`.
- **Verification** (`:133-151`): lint with a warnings ratchet; typecheck + test + build;
  **look at it in a browser** ("jsdom cannot see an inflated pill, a clipped column, or a
  layout that only breaks at 800px — the Electron floor"); a jsdom smoke test per new
  surface; and `npm run render-probe` for anything touching `index.css` focus or theme rules.

### 5.2 Does the code follow it?

**Yes, and unusually well, on most of it.** The following are honoured and enforced:

| Doctrine rule | How it is honoured | Evidence |
|---|---|---|
| Semantic hues from `@theme` | one token block; `tests/themeContrast.test.ts` scans every file under `components/` for a hue outside the ramp | `index.css:125-140`; `docs/ui-doctrine.md:14-20` |
| No `transition-all` | repo-wide ban with a test | `tests/themeContrast.test.ts:161-184` |
| No `text-[Npx]` literal | `tests/typeRamp.test.ts` bans 9/10/11/12/13 px and a pixel literal on any heading tag | `docs/ui-doctrine.md:62-78` |
| No serif face ships | `--font-serif` and `--font-reading` both resolve to `var(--font-sans)` | `index.css:175-178` |
| Heavy surfaces are lazy with a skeleton | `SurfaceSkeleton` at `App.tsx:161-166`; every surface wrapped in `<React.Suspense fallback={<SurfaceSkeleton />}>` | `App.tsx:2556, 2602, 2624, 2666` |
| One home per concern | `Disclosure`, `DetailModal`, `JumpToLatestFab`, `ModelMenu`, `toolKindIcons`, `effortScale`, `turnStatus` are each owned once | `AGENTS.md` "Canonical single-source modules"; `docs/ui-doctrine.md:42-58` |
| No dead-end state | the Learn right panel says "Nothing selected to read." rather than rendering an empty box | `components/learn/LearnView.tsx:352-357` |
| An affordance does what its label says | the `onToggleExpanded` row is gated on its handler; the Coach inbox is a route, not a counter; the account row is a **readout**, not a control | `tests/deadControlsGuard.test.ts:74-77`; `components/agents/AgentsView.tsx:1029-1044`; `components/shell/NavRail.tsx:70-76` |
| No layout shift on stream chunks | the work card is a disclosure that grows in place; the dock's panel is `hide`-not-`close` so the interior never reflows | `components/shell/RightPanel.tsx:74-92` |

**Where it does not.** Specific, citable violations:

1. **"No new `@keyframes`. The existing tick-flash and beacon patterns are the sanctioned
   exceptions."** (`docs/ui-doctrine.md:110-111`) — `index.css` carries **28** `@keyframes`
   rules, of which only `tick-flash-up`, `tick-flash-down` and `beacon-ping` are named as
   sanctioned. The other 25 include `splash-shimmer`, `splash-candle`, `splash-slide`,
   `splash-status-cycle`, `update-check-pop`, `stream-fade`, `chat-fade-in`,
   `reasoning-live-edge`, `reasoning-dots-bounce`, `streaming-caret-blink`,
   `reasoning-caret-blink`, `botface-blink`, `verdict-skeleton-shimmer`, `fadeIn`,
   `msg-arrive`, `msg-fade-only`, `shimmer-sweep`, `slideDown`, `slideInLeft`, `slideUp`,
   `slideLeft`, `shimmer`, `bounceSlow`, `details-enter`, `panel-slide-in`.
   Evidence: `index.css:434, 476, 501, 528, 601, 641, 651, 680, 741, 772, 780, 785, 1007,
   1099, 1128, 1132, 1226, 1248, 1263, 1287, 1321, 1337, 1352, 1369, 1386, 1400, 1473, 1482`.
   *(The rule is a "no NEW keyframes" rule, so the count alone is not a violation; what is
   a violation is that the stylesheet has grown past the two named exception families with
   no list of the sanctioned set — the doctrine's "existing" is now unreviewable.)*

2. **13 of those animation classes are dead.** No `.tsx`/`.ts`/`.html` file references
   `streaming-dots`, `animate-slide-down`, `animate-slide-in-left`, `animate-slide-up`,
   `animate-slide-left`, `animate-bounce-slow`, `shimmer-text`, `msg-arriving`,
   `details-enter`, `panel-slide-in`, `verdict-skeleton-bar`, `streaming-caret`,
   `splash-bar`/`splash-status` (the latter two appear only inside `index.css` itself).
   Evidence: `index.css:741 (streaming-dots), 1321, 1337, 1352, 1369, 1400, 1287, 1248, 1263,
   1473, 1482, 1007, 772, 501, 528`; zero source references repo-wide.

3. **Dead CSS for a deleted feature.** `.floor-lean`, `.floor-lean-label`,
   `.floor-lean-bar`, `.floor-lean-fill`, `.floor-lean-fill-long`, `.floor-lean-fill-short`,
   `.floor-lean-value` (`index.css:950-995`) are the 2D desk floor's seat-lean bars. The
   2D desk floor was deleted (`AGENTS.md`, "services/desk/ — the 2D desk floor view and its
   seat layout were deleted (2026-10-18)"), and the repo's own plan already calls this
   "dead CSS for a [deleted feature]" and marks the removal SAFE
   (`docs/plan/audit/2026-10-19-04-cleanup-manifest.md:675`, `docs/plan/full-audit.md:4822`).
   It is still in the stylesheet.

4. **"Transitions only via `--ease-snappy` at 0.12–0.18 s"** (`:103`) is broken in three
   places: `transition: opacity 0.22s var(--ease-snappy)` on the splash
   (`index.css:389`, 220 ms > 180 ms and not a data value); `transition: grid-template-rows
   0.3s cubic-bezier(0.4, 0, 0.2, 1)` on `.collapsible-content` (`index.css:1458`, wrong
   duration **and** a different easing function); `transition: border-color 0.15s ease` on
   `select` (`index.css:1731`, right duration, wrong easing function). The two legal
   long transitions are the update bar's `width` (`index.css:567`, a data value) and
   `.floor-lean-fill`'s `width` (`index.css:976`, a data value but in dead CSS).

5. **A second disclosure mechanism** survives the "one home per concern" rule: the
   `<button>` + grid-collapse `<div>` pair that `components/shared/Disclosure.tsx:4-15`
   says was retired still exists at `components/shared/StrategySearch.tsx:269, 325` and
   `components/dashboards/learning/LessonsSection.tsx:81`, backed by
   `.collapsible-content` (`index.css:1455-1468`). A `<div>` that collapses is **not
   keyboard-operable** the way a `<details>` is, so this is the accessibility half of the
   rule too.

6. **The brand gradient has no live home.** It is reserved for "the wordmark and the
   active-nav indicator" (`:25`), but the wordmark was removed
   (`components/shared/Header.tsx:188-192`) and the only active-nav indicator lives in the
   unmounted `SurfaceMenuList` branch (`components/shell/SurfaceMenuList.tsx:165-170`). The
   gradient's only surviving live use is the update-available dot
   (`components/shared/UpdateButton.tsx:55`) — neither the wordmark nor a nav indicator.

7. **The "one home per concern" rule is violated at the transcript row.** The Chat surface
   and the Chart AI dock render the *same conversation* but not the *same row*: the Chat
   surface omits the Key Levels card, the Retry chip, the Pin chip and the "Run stopped"
   card, and the memory-provenance strip is dock-only (#21, #22, #24). One of the two
   surfaces mounts the other's component for the verdict card and the proposal card, but
   not for the rest.

---

## 6. COSMETIC UI — the concrete list

Every entry below is a control, a panel, a readout or a declaration that is **rendered,
clickable or computed, but does not do what it appears to do** — or is not rendered at all
while reading as if it were.

### C1. The whole `NavRail` component — never mounted by the app
`components/shell/NavRail.tsx:140-240` (242 lines). The collapse button
(`:202-212`), the `SurfaceMenuList` mount (`:216-222`) and the `UpdateButton` (`:228`) are
all unreachable. The file reads as the app's navigation; it is not.
`App.tsx:2507-2515` documents this; `tests/deadControlsGuard.test.ts:145` pins the absence.
**Verdict: COSMETIC (whole file).** Only `AccountRow` (`:79-138`) and
`NAV_RAIL_AUTO_COLLAPSE_PX` (`:43`) are live. The repo's plan keeps the module on purpose
pending the E-50 decision (`docs/plan/open-items.md:182`) and `tests/agentsSurface.test.tsx:401`
still mounts it — so it is exercised by the suite and unreachable by the user.

### C2. The five-surface list in `SurfaceMenuList` — mounted but gated off
`components/shell/SurfaceMenuList.tsx:135-200`. Its only mount passes `hideSurfaces`
(`App.tsx:2725-2731`), so the destination rows, the brand-gradient active bar
(`:165-170`), the badge count (`:89-98, 184`) and the **"A conversation is still running"**
busy badge (`:142, 188`) never render. `RunBusyBadge` is imported *only* here
(`components/chat/RunBusyBadge.tsx:46-66`) — so the badge component is dead too.
**Verdict: COSMETIC.** The file's own header calls itself "the five surfaces" (`:2`) and
`SURFACE_ITEMS` still holds four live ids used by the switch — the data is alive, the UI is
not.

### C3. `Header`'s three dead props
`components/shared/Header.tsx:12` (`isAnalysisInProgress`), `:13` (`currentVisionData`),
`:20` (`pendingQueueCount`) are declared, are computed by App, and are passed
(`App.tsx:2531, 2532, 2535`) — and are **not destructured** by the component (`:61-74`).
`pendingQueueCount` in particular is a live `useState` with two writers
(`App.tsx:527, 924, 964`) whose only consumer is a prop nobody reads.
**Verdict: COSMETIC.** This is the same class of defect `tests/deadControlsGuard.test.ts:232-251`
removes from `SettingsMenu`, left in `Header`.

### C4. `App`'s two dead locals
`isNavOverlay` (`App.tsx:687`) and `closeNavOverlay` (`App.tsx:702`) are declared and never
referenced. They are the residue of the narrow-viewport rail overlay that the `NavRail`
deletion orphaned.
**Verdict: COSMETIC.**

### C5. The interrupted-run card in the Chat surface — a control that cannot appear
`components/shared/InterruptedRunNotice.tsx:26-61` is real and correct, but the Chat
surface's row never sets `row.interrupted` (`components/agents/AgentsView.tsx:246-294`) and
`types/message.ts` has no `interrupted` field, so
`components/shared/ChatTranscriptRow.tsx:219-226` is dead code **in the Chat surface**. A
turn stopped from the Chat surface is a half-written answer with no "Edit prompt", no
"Try again" and no marker that it stopped.
**Verdict: COSMETIC in the Chat surface; REAL in the dock.**

### C6. The Chat surface's missing row controls — four affordances that exist on one home only
`components/agents/AgentsView.tsx:1438-1441` mounts `ChatTranscriptRow` with `row` alone.
Therefore, in the Chat surface: the **Retry chip** (`ChatTranscriptRow.tsx:229`), the
**Pin chip** (`:236-238`), the **Key Levels card** (`:189-199`) and the **"Run stopped"**
card (`:219-226`) are all absent. The dock has all four
(`components/trade/panels/ChatTranscriptList.tsx:146,163, 204-216, 235-238, 267-275`).
**Verdict: COSMETIC (by omission) in the Chat surface.** Note the Chat surface *does* show
the composer symbol picker, so the trader can pick a coin whose key levels the answer
names — and the levels never render. (The analysis-based "Log this trade"
(`ChatTranscriptRow.tsx:239-244`) is absent from **both** homes; the dock uses the
proposal card instead.)

### C7. The memory-provenance strip — dock-only
`components/chat/MemoryProvenanceStrip.tsx` is the app's answer to "what did the AI actually
remember for this answer?" and is mounted **only** by the dock
(`components/trade/panels/ChatTranscriptList.tsx:245-251`). The Chat surface, which is the
surface where you *ask* a question, cannot answer it.
**Verdict: COSMETIC on the Chat surface.**

### C8. The "Chart AI" row in the Chat surface's rail — a label for another surface's dock
`components/agents/AgentsView.tsx:1119-1122` — the rail's first row is titled "Chart AI"
(`testId="chart-ai-row"`) and selects the **desk thread** (`{ kind: 'team' }`) in *this*
surface. The same thread is called **"Desk"** in the surface's own header
(`components/agents/AgentsView.tsx:1365, 1372`). The doctrine: "An affordance must do what
its label says" (`docs/ui-doctrine.md:128-129`) — a row named after the Chart AI dock opens
a thread that is not the dock.
**Verdict: COSMETIC / misleading label — a naming lie, not a broken control.**

### C9. Settings → Journal is a launcher, not a surface
`components/settings/SettingsMenu.tsx:207` offers a "Journal" tab in the Account group; its
body is two cards that route away (`components/settings/tabs/JournalTab.tsx:37-86`) plus
the summary toggles (`:94-141`). The Journal surface is one click away in the title-bar
switch.
**Verdict: a duplicated entry point.** The toggle rows inside it are real.

### C10. Dead CSS for a deleted feature
`.floor-lean*` (`index.css:950-995`) — the 2D desk floor's bars. Already flagged SAFE for
removal in the repo's own plan (`docs/plan/full-audit.md:4822`).
**Verdict: COSMETIC (dead stylesheet).**

### C11. Dead animation classes
`streaming-dots`, `animate-slide-down`, `animate-slide-in-left`, `animate-slide-up`,
`animate-slide-left`, `animate-bounce-slow`, `shimmer-text`, `msg-arriving`,
`details-enter`, `panel-slide-in`, `verdict-skeleton-bar`, `streaming-caret` — defined in
`index.css` and referenced by **no** source file.
**Verdict: COSMETIC (dead stylesheet).**

### C12. A second disclosure mechanism
`components/shared/StrategySearch.tsx:269, 325` and
`components/dashboards/learning/LessonsSection.tsx:81` use `.collapsible-content`
(`index.css:1455-1468`) — a `<button>` + grid-collapse `<div>`, not the native
`<details>` that `components/shared/Disclosure.tsx:1-23` exists to be the single owner of.
**Verdict: COSMETIC (a duplicate mechanism, and a non-keyboard-operable one).**

### C13. Decorative stats in the Chat surface's header
`components/agents/AgentsView.tsx:1387-1393` — a `font-mono text-ui-xs text-zinc-600`
line reading `N lessons · N skills · N evidence` for the selected agent, hidden below
`xl`. It is a readout of three counters with no action attached, next to the agent's name
and a one-word scope pill. The same numbers are available in the agent's own card
(`components/agents/AgentDetailCard.tsx:39-41` — "Skills: N authored") and in the row
badge (`AgentsView.tsx:367-372`).
**Verdict: borderline decorative stat — the number is real, but it is displayed three
times in the same surface for one agent and the header copy is the copy nobody asked for.**

### C14. The `AgentDetailCard`'s "Skills: N authored" row
`components/agents/AgentDetailCard.tsx:39-41` duplicates the rail's per-row skills badge
(`components/agents/AgentsView.tsx:367-372`) and the header's stats line (`:1387-1393`).
Three surfaces, one number.
**Verdict: duplicated panel/readout.**

### C15. The `Header`'s session pill has no accessible name
`components/shared/Header.tsx:196-212` — the button's only text is the session
abbreviation ("NY", "London", "Asia", "Ldn/NY", "Off") and it carries no `aria-label`. The
popover it opens is a market-conditions sheet, which the abbreviation does not hint at.
**Verdict: an affordance that does not say what it does.**

### C16. `AGENTS.md`'s "no decorative meter" rule is honoured, but one decorative gradient remains
`components/shared/ModelMenu.tsx:515` draws a `from-emerald-500 to-cyan-400` bar
(`transition-[width]`) in the model menu. The dead-controls guard explicitly bans an
"effort-meter" (`tests/deadControlsGuard.test.ts:101-104`) — this is a different bar, and
its width is not obviously tied to a data value. It is the only place in the model menu
where a gradient stands in for a number.
**Verdict: possible decorative stat; flagged, not proven.**

### C17. The Chat surface's "Attach image" button is disabled whenever a bot is selected
`components/agents/AgentsView.tsx:1573-1581` — the button renders, is `disabled`, and the
title says why. This is the **honest** version of a dead control (the label tells you
what to do instead) and is listed here only so the distinction is explicit.
**Verdict: borderline; acceptable as written.**

### What is NOT cosmetic (checked and cleared)
- Every `ToggleSwitch` in Settings → Analysis is wired: Hybrid Intelligence
  (`components/settings/tabs/GeneralTab.tsx:60-70`), Desk Tools (`:74-89`, persisted via
  `saveHarnessSettings`), Reduce motion (`:90-101`, via `services/desk/idleMotion`), the
  capture prompts (`:139-156`), the algorithmic summary/insights
  (`components/settings/tabs/JournalTab.tsx:98-121`).
- `ToggleSwitch` itself is one primitive with `role="switch"` + `aria-checked`
  (`components/shared/ToggleSwitch.tsx:15-33`) — the render-probe's flip detector depends on
  that (`scripts/render-probe.cjs:2153, 2183-2191`).
- The SkillsCatalog's "Skill settings" gear is **hidden** when there is no handler
  (`components/learn/SkillsCatalog.tsx:601-606`), which is the correct pattern: App
  deliberately does not pass `onOpenSkillsSettings` (`App.tsx:2656-2661`).
- The Learn right panel is guarded against an empty box
  (`components/learn/LearnView.tsx:352-357`).
- The Header's session-popover links both open real overlays
  (`App.tsx:2305-2307`, `:2390`).
- The `JumpToLatestFab` is mounted by **both** homes at the **one** threshold.

### 6.1 What `tests/deadControlsGuard.test.ts` already guards — and what it misses

**Guarded (21 cases, `tests/deadControlsGuard.test.ts:1-344`):** the bot-roster drawer
chain is gone; `Header` declares no `onOpenBotManager`; `components/shared/Sidebar.tsx`
does not exist; no per-seat override editor; `StrategyStudio` mounts no second
`LearningQueuePanel`; `SessionUsagePanel` mounts no second `HarnessLessonsBrowser`;
`components/dashboards/learning/NotebookSection.tsx` does not exist; the skill deep link
exports both ends and the dock consumes the parked token; the "expand over chart" row is
gated on its handler; the dock is handed the **real** conversation handlers
(`onBotTurnCommit`, `onSoloTurnCommit`, `conversationRows`, `onLogProposedTrade`); Learn
does not mount `StrategyStudio` a second time; the effort dropdown carries no decorative
meter; the command palette stays deleted; `SurfaceSwitch` exists and App mounts it exactly
once; `App` does not render `<NavRail`; `hideSurfaces` is present and gated on; no surface
grows a second destination list; Settings is reachable from the surfaces that lost the
account row; profile switching has one home; the order-book toggle has a handler; the
Coach inbox has one host and Learn mounts the one `CoachThreadPanel`; `SettingsMenu` has
no vestigial journal interface (18 names); `.form-checkbox` has a real rule; the
harness-lesson store names only real readers.

**Not guarded — the gaps this section found:**
1. The Chat surface's row handlers (`onRetry`, `onEditPrompt`, `onTogglePin`, `onLogTrade`,
   `symbol`) — nothing stops a future edit from dropping the Key Levels card, the retry
   chip or the pin chip from the Chat surface without any gate failing.
2. `row.interrupted` / `Message.interrupted` — the "Run stopped" card's carrier does not
   exist in the canonical row model, and nothing pins that it should.
3. `Header`'s dead props — the guard has an 18-name ban list for `SettingsMenu` and
   nothing for `Header`.
4. The `App` dead locals `isNavOverlay` / `closeNavOverlay`.
5. The dead CSS (`.floor-lean*`) and the 13 dead animation classes.
6. The second disclosure mechanism (`.collapsible-content`).
7. `RunBusyBadge`'s only mount being inside an unmounted branch.

**A gap in the guard's own method:** it is a **source-contract** test — it reads files with
`readFileSync` (`:14-23`) and never mounts a component. It can prove a *name* is absent
from a file. It cannot prove a control is *reachable*, and it cannot see a control that
renders with no handler at all, because that requires a render.

---

## 7. THE PROBE SCRIPTS

`scripts/` holds 20 files. The three gates this section is about:

### 7.1 `boot-probe` — "does it start?"
`scripts/boot-probe.cjs` (165 lines). Serves the **production** bundle with
`vite preview` (`:85`), seeds a profile into IndexedDB `FuturesAI-DB` (`:49-74`), then
asserts: the splash clears within 20 s (`:119`), `[data-testid="trade-view"]` mounts
within 20 s (`:122`), after a 3 s double-sample the trade surface is still there and the
Chart AI dock rendered (`:127-128, 137-144`), and **zero `pageerror`s** (`:132-136`).
Exits non-zero on any failure (`:157`); the spawned preview is reaped in a `finally` so
the port is never orphaned (`:154-156`).

**What it CANNOT see:**
- **Only the Trade surface.** It never navigates. Chat, Journal and Knowledge are never
  mounted, so a lazy-chunk failure in any of them passes.
- **No message is ever sent.** No transcript, no tool row, no thinking row, no failure row
  and no work card is ever rendered.
- **No panel or overlay is opened** — no Settings, no Activity drawer, no right panel.
- It runs against `dist/`, so it proves the *production* build boots; it cannot see a
  dev-only behaviour and it cannot see a code path that needs a seeded conversation.

### 7.2 `render-probe` — "did every message actually appear, and does every button do something?"
`scripts/render-probe.cjs` (2654 lines) drives the running app in Chromium against
`scripts/mock-provider.cjs` (a loopback model server, so **no API key**).

**What it asserts (the `check(...)` calls, 106 of them):**
- Row counts per conversation in the **dock** and the **Agents** surface: "dock starts
  empty" (`:592`), "first exchange renders" (`:596`), "SECOND exchange renders AND the
  first survives it" (`:601`), "third exchange renders and all earlier rows persist"
  (`:607`), "Agents transcript shows all 6 rows (3 prompts + 3 replies)" (`:1115`),
  "every Agents reply rendered" (`:1118`), "rows are in send order, oldest first"
  (`:1123`).
- Send order and the **send order of the tool trail**: "a tool round is projected as a
  tool line, not only as prose" (`:664`), "the tool line names the call the model actually
  made" (`:674`), "the tool line survives a reload" (`:689`).
- **Reload persistence**: "the conversation survives a reload" (`:1146`).
- **A settled verdict + malformed persisted audit data drops no row**: "all 4 seeded rows
  render — nothing dropped after the malformed verdict" (`:1159`), plus the verdict card,
  the audit block, the run-contract ladder (`:1162-1166`).
- **All four nav surfaces mount** (`:1179-1198`) and "every surface is reachable from the
  title-bar switch with no menu to open" (`:1407`).
- **Cross-surface liveness**: "the Chat surface shows the dock's turn as still running"
  (`:984`), "the answer keeps growing on the Chat surface" (`:991`), "the turn that crossed
  the hop settles complete, not truncated" (`:1007`), "the hop carries the conversation
  into the dock" (`:1338`), "the dock draws the same decision cards as the thread" (`:1341`).
- **The Learn and Journal surfaces have no INERT control** (`:2031-2193`, invoked at
  `:2198` for Knowledge with 18 rounds and `:2338` for Journal with 12).
- **Settings → Data can back up / export / import** (`:1906-1937`).
- **Focus indicators**: Tab-focuses editable fields and reads back the computed keyboard
  focus indicator — the only gate that can see `index.css` (`:2500-2536`).
- **Zero pageerrors** across the whole run (`:2622`).

**What it CANNOT see — and this is the important part:**
1. **It never sweeps the Chat surface or the Trade surface for inert controls.**
   `sweepSurface` is called exactly twice — `Knowledge` (`:2198`) and `Journal` (`:2338`).
   The two surfaces with the most interactive furniture (the composer, the model menu, the
   effort dial, the proposal cards, the verdict cards, the dock's tool rows) are **not**
   covered by the inert-control sweep. This is where C5, C6 and C7 would have been caught.
2. **It can only press controls that are present, enabled and visible.** The picker skips
   `b.disabled` (`:2074`) and `b.offsetParent === null` (`:2074`) — so a control that is
   *rendered but permanently disabled* is never judged, and a control inside a **closed
   `<details>`** has no layout box and is skipped too.
3. **"Moved" is measured as a change in `<main>`'s innerText, the number of editable
   fields, the URL hash, or the appearance of an overlay** (`:2105-2121`, `:2146-2174`).
   A control whose effect is none of those four reads as inert. The one escape hatch is
   an `aria-checked` flip (`:2129, 2159-2167`), and it only covers `role="switch"`-style
   controls — a control driven by any other mechanism that changes nothing visible is
   called dead.
4. **Overlays mount outside `<main>`**, so the sweep had to be taught to look for them
   (`:2112-2120`) — the same trap the doctrine names.
5. **Browser-chrome actions are excluded by name** — `/export|import|download|copy|save|print/i`
   are reported as "not judgeable" rather than as failures (`:2177-2179`).
6. **A sweep that exercised almost nothing must not report a clean bill of health** —
   the vacuity guard (`:2187-2188`) requires at least `min(cap, 6)` distinct controls
   pressed.
7. It is a **single browser, single window, one machine**; it says nothing about
   multi-monitor, high-DPI or the Electron floor, and it must be run on an idle machine
   (the file's own note).

### 7.3 `skill-approval-probe` — "did the pressed button write the bytes?"
`scripts/probe-skill-approval.cjs` (532 lines) drives the **human actuation** path in
Chromium: the four skill-draft outcomes plus a rescope, asserting the **notebook bytes**
after each click.
- 1-happy: the tab and the approve control are reachable (`:374`), the toast says "Skill
  saved" (`:375`), a new skill file is in the notebook (`:376`), the draft is consumed
  (`:378`).
- 2-collision: the second file is `funding-exhaustion-long-2.md` (`:388`) and the collision
  did not throw (`:390`).
- 3-duplicate: the toast says "Already learned" and specifically **not** "Skill saved"
  (`:402-403`), no new file (`:404`), and the prerequisite really was live (`:407`).
- 4-writefail: the toast says "Not saved" (`:439`) and **the draft survives** the failed
  write (`:441`).
- 5-rescope: the Coach thread offered **Apply** (`:470`), the notebook now carries the
  proposed clause (`:473`), the old clause is gone from the file including its prose line
  (`:475`), there is one skill and not a second file (`:477`), the proposal row was
  consumed (`:479`).
- 5b-refusal: Apply is reachable for a below-bar rescope (`:493`), the row **names why it
  refused** — "below the bar" (`:506`), the refused proposal is still queued (`:507`), and
  the skill bytes did not change (`:509`).
- No uncaught page errors during the run (`:518`).

**What it CANNOT see:**
- **It never exercises a model turn.** The mock provider emits **no tool calls**, so
  `propose_skill` cannot be reached from a turn at all; the draft is **seeded** with the
  exact bytes `utils/skillDrafts.ts` writes (`:9-12, 64-82`). The probe therefore tests
  everything *downstream* of the inbox and **nothing** about how a draft is produced.
- It asserts **nothing** about the shell, the nav, the surfaces, the transcript, the
  streaming feedback or any control's inertness. It is a single-purpose writing gate.
- It is **not in the release gate** — `AGENTS.md`: "The release gate runs the same chain
  MINUS two of its steps — no `check-flow-doc-anchors`, no `skill-approval-probe`."

### 7.4 The AGENTS.md limitation, quoted

> **Unit tests cannot see the transcript.** `tests/` mounts components in jsdom, so a
> defect that only shows when a LIST of messages renders — a row dropped after the second
> one, or a decorative panel throwing inside `messages.map()` and taking every later
> message down with it — passes the whole suite green. Two finished panels shipped
> unmounted for exactly this reason and no test noticed. Any change to how a conversation
> renders must be checked with `npm run render-probe`, which counts rendered rows in a
> real browser instead of asserting a component returned the right thing.
> — `AGENTS.md`, "What each gate does NOT catch"

The same section adds two rules the probe encodes:

> **overlays mount outside `<main>`**, so measuring `<main>` after opening one
> re-reports the previous surface and passes vacuously — assert the overlay's own root;
> and **a check whose measurement is identical across two different states is measuring
> the wrong thing.**
> — `AGENTS.md`

And the reason the probes exist at all:

> Two finished panels shipped unmounted for exactly this reason and no test noticed.
> — `AGENTS.md`

**The limit that matters for this section:** the render-probe's inert-control sweep covers
**two of the four surfaces**, and the jsdom suite cannot see a *list* at all. So the class
of defect this baseline documents — a surface whose row furniture is present in one home
and missing in the other (C5, C6, C7) — is invisible to both gates today. It is also
invisible to `tests/deadControlsGuard.test.ts`, because that test reads source text and
would need to assert the *presence* of a prop at a call site, which is a fragile thing to
pin — but not impossible: `tests/deadControlsGuard.test.ts:84-89` already does exactly
that for the dock's handlers (`expect(appSrc).toMatch(/onBotTurnCommit=\{commitDockBotTurn\}/)`).
The same pattern would work for the Chat surface's `ChatTranscriptRow` call.

---

## 8. WEAK SPOTS

1. **The Chat surface and the Chart AI dock are not the same row.** The dock has the Key
   Levels card, the Retry chip, the Pin chip, the memory-provenance strip and the
   "Run stopped" card; the Chat surface has **none** of them
   (`components/agents/AgentsView.tsx:1438-1441` vs
   `components/trade/panels/ChatTranscriptList.tsx:146,163, 204-216, 235-238, 245-251,
   267-275`). The app's own doctrine is "One home per concern" and the row component's own
   header says both homes render it. *(`components/shared/ChatTranscriptRow.tsx:5-7`)* This
   is the single largest inconsistency in the shell, and it is invisible to every gate
   today.

2. **The "Run stopped" recovery card is unreachable on the surface where a turn is
   started.** `row.interrupted` has no canonical carrier: `types/message.ts` has no such
   field and `chatRowFrom` (`components/agents/AgentsView.tsx:246-294`) never sets it
   (`components/shared/ChatTranscriptRow.tsx:219-226`). A turn stopped from the Chat
   surface leaves a half-written answer with no way forward.

3. **The nav's "a conversation is still running" affordance does not exist.** The busy
   badge and the whole five-surface row list live in a branch that is mounted with
   `hideSurfaces` (`components/shell/SurfaceMenuList.tsx:135, 188`; `App.tsx:2725-2731`),
   so a run in a thread you are not looking at reads as a hang — the exact failure
   `RunBusyBadge.tsx:5-12` was written for. The same branch holds the only
   brand-gradient active-nav indicator, so the doctrine's brand rule has no live
   implementation either.

4. **The inert-control sweep covers two of four surfaces.** `sweepSurface` runs for
   Knowledge and Journal only (`scripts/render-probe.cjs:2222, 2362`). The Trade and Chat
   surfaces — where the composer, the model menu, the effort dial, the proposal cards and
   the verdict cards live — are never swept for dead controls. The probe's own reason for
   existing ("Mounting a surface proves the surface renders, not that its buttons work",
   `:2032-2034`) is not applied to the two surfaces that need it most.

5. **`NavRail.tsx` is a 242-line component that no user can reach**, and the file reads
   as the app's navigation. The repo's own plan tracks it: `docs/plan/open-items.md:182`
   (O-92) is marked "**CLOSED (the import half)** 2026-10-20; the module half moves to
   O-129", and says the component "stays exported and un-mounted **on purpose**", with
   the open question being the E-50 one — "whether to delete the component and the test
   that mounts it (`tests/agentsSurface.test.tsx:401`)". So the file is deliberately kept
   alive by a test while the app cannot reach it — 242 lines of plausible-looking
   navigation that a reader of `components/shell/` will assume is live.

6. **The doctrine is not self-auditing.** `index.css` carries 28 `@keyframes` against a
   rule that sanctions two families; 13 animation classes and the whole `.floor-lean*`
   block are referenced by nothing; and `Header` has three props the band never reads.
   `docs/ui-doctrine.md` is a checklist *for a diff*, and there is no gate that runs it
   against the tree.

7. **The dock is a wide, dense surface with no coverage for its own row furniture.** The
   dock carries the tool rows, the payload expanders, the proposal cards and the verdict
   audit — the densest interactive surface in the app — and the render-probe asserts its
   *row counts* (`:592-610`) but never its *controls*.

8. **The `AgentsView` header comment is now false.** "⚠️ THE TWO SURFACES DO NOT SHARE A
   STORE TODAY" (`components/agents/AgentsView.tsx:10-33`) was true of the writers and is
   false of the transcript; the mirror and the merge make them one thread. The next
   reader of that file is told the opposite of the truth, and the file's own cited
   evidence (`render-probe.cjs:488-492`) has moved.

---

## 9. WHAT IS ALREADY GOOD

1. **One grammar for "what is this turn doing".** `utils/turnStatus.ts` owns the digest
   grammar, the call→result pairing, the activity label, the kind counts and the work
   names — and `components/shared/ToolActivityRow.tsx`, `components/trade/panels/ChatWorkTimeline.tsx`
   and the summary are all readers of it. The collapsed headline cannot disagree with the
   rows beneath it, because they are the same parser
   (`utils/turnStatus.ts:1-16, 161-186`).

2. **The indexing discipline in the pairing is load-bearing and documented.** The payload
   id lives on the *result* line while the `calling…` line never has one, so the pairing
   carries its source indices (`utils/turnStatus.ts:132-145`;
   `components/shared/ToolActivityRow.tsx:228-239`). Without them the expander silently
   never appears.

3. **The indeterminate ring is an honest refusal.** `JumpToLatestFab` shows a dashed
   spinning circle rather than a percentage, with the reason written down: a desk turn
   has no denominator anyone could honestly draw
   (`components/shared/JumpToLatestFab.tsx:14-24, 66-79`). And the threshold is ONE number
   both homes read (`JUMP_AWAY_PX = 240`, `:51`; `components/agents/AgentsView.tsx:577`;
   `components/trade/TradeChatPanel.tsx:668, 726`) so one home cannot yank a reader the
   other offered a button for.

4. **The failure row is shared, and the provider's own words are used.** The same
   component renders the failure in both homes, in rose, with the error in the `error`
   field and not in the answer text (`components/shared/ChatFailureRow.tsx:16-26`;
   `hooks/useAnalysisPipeline.ts:1591-1603`). A failed turn is never drawn as though the
   seat had said it.

5. **The "one home per concern" work is real and mostly finished.** `Disclosure`,
   `DetailModal`, `JumpToLatestFab`, `ModelMenu`, `toolKindIcons`, `effortScale`,
   `effortDial`, `turnStatus`, `toolKinds`, `runStatus`, `useRightPanel` — each has one
   owner, and the ones that were orphaned were given a second caller
   (`DetailModal` is now mounted by the Chat surface for the agent card,
   `components/agents/AgentsView.tsx:1643-1659`).

6. **The right-panel contract is excellent.** Hide ≠ close (the interior never reflows,
   so a composer draft and an in-flight turn survive a collapse —
   `components/shell/RightPanel.tsx:74-92`), width persisted **per surface**
   (`hooks/useRightPanel.ts:89-105`; `widthKey` at `:89`, read at `:91-105`, commit at
   `:112-116`), no transition while dragging
   (`components/shell/RightPanel.tsx:93-99`), and
   the capsule strip only when there is more than one panel
   (`components/shell/RightPanel.tsx:63`).

7. **The nav is honest about the Chat ⇄ Trade hop.** It is a **route**, not a mode
   (`App.tsx:415-418, 2246-2255`), it carries the conversation with it
   (`chatStore.bindConversation(activeConversationId)`), and the partner surface is warmed
   at idle so the hop does not wait on a chunk (measured 1680 ms → 789 ms —
   `App.tsx:447-472`).

8. **Arriving on either home shows the thread that is answering.** The hop effect
   (`App.tsx:428-445`) is keyed on the *run registries* rather than on a guess, in both
   directions, so a surface switch does not land on a different thread than the one still
   generating.

9. **The live-sync contract is documented end to end.** `services/trade/chatTurnMirror.ts`
   states the three things it must not get wrong: never `requestAnimationFrame`, always
   flush, commit by id and only for its own entry (`:22-34`). The `isStreaming` carry
   (`services/trade/chatSessions.ts:507-517`) is the field that makes the two homes agree
   about what is running.

10. **The doctrine has enforcement behind most of its rules.** `tests/themeContrast.test.ts`
    (hues + `transition-all`), `tests/typeRamp.test.ts` (the size ramp), and
    `tests/deadControlsGuard.test.ts` (21 source contracts) are real gates, not prose.

11. **The probes are unusually honest about their own limits.** `render-probe.cjs`
    documents *why* each check is shaped the way it is — the vacuity guard
    (`:2185-2188`), the overlay-outside-`<main>` trap (`:2112-2120`), the
    "measurement identical across two states is measuring the wrong thing" rule
    (`AGENTS.md`), and the already-selected control exclusion (`:2076-2096`).

12. **The learning loop's own map is honest about its own asymmetries.**
    `docs/learning-loop-map.md:134-223` names ten asymmetries — including the
    write-only `trader-diary/` and the carried-but-unused top-level
    `insightKnowledgeBase` — rather than claiming closure. That is the standard the rest
    of the shell should be measured against, and it is a high one.

---

## 10. FILE INVENTORY (true file line counts)

**`components/shell/`** — `NavRail.tsx` 242, `SurfaceMenuList.tsx` 231, `RightPanel.tsx` 168,
`SurfaceSwitch.tsx` 81, `StatusCluster.tsx` 80, `NavExpandButton.tsx` 41.

**`components/chat/`** — `GroupChatView.tsx` 478, `NewBotDialog.tsx` 406,
`CoachThreadPanel.tsx` 342, `pixelAvatars.ts` 325, `ToolActionsRow.tsx` 218,
`MemoryProvenanceStrip.tsx` 178, `NewGroupDialog.tsx` 144, `BotFace.tsx` 141,
`BotAvatar.tsx` 85, `RunBusyBadge.tsx` 68, `skillDeepLink.ts` 46.

**`components/shared/`** — `ModelMenu.tsx` 533, `StrategySearch.tsx` 388, `Header.tsx` 341,
`SelectMenu.tsx` 305, `ToolActivityRow.tsx` 294, `ChatTranscriptRow.tsx` 257,
`UpdateOverlay.tsx` 246, `ConfirmDialog.tsx` 237, `Icons.tsx` 225, `ModelPicker.tsx` 216,
`ReasoningRow.tsx` 209, `UpdateButton.tsx` 208, `Toast.tsx` 200, `MarkdownRenderer.tsx` 187,
`chatChips.tsx` 172, `AnalyzedRow.tsx` 161, `ErrorBoundary.tsx` 146, `ModelChip.tsx` 127,
`DetailModal.tsx` 95, `Disclosure.tsx` 90, `JumpToLatestFab.tsx` 84, `WireAuditRow.tsx` 78,
`InterruptedRunNotice.tsx` 62, `effortScale.ts` 58, `ImagePreview.tsx` 53, `AnswerBody.tsx` 43,
`ToggleSwitch.tsx` 35, `MarkdownContent.tsx` 35, `effortDial.ts` 31, `ChatFailureRow.tsx` 28,
`toolKindIcons.tsx` 23, `flyoutLayout.ts` 22, `AuditPanel.tsx` 20.

**`components/agents/`** — `AgentsView.tsx` 1664, `AgentDetailCard.tsx` 79, `RowMenu.tsx` 72.

**`components/trade/`** (and `components/trade/panels/`) — `TradeChatPanel.tsx` 1289,
`TradingChart.tsx` 1212, `TradeView.tsx` 1201, `ScreenerPanel.tsx` 352,
`panels/ChatTranscriptList.tsx` 322, `OrderBookPanel.tsx` 258, `panels/ChatComposer.tsx` 246,
`panels/TradeProposalCard.tsx` 231, `ChartToolRail.tsx` 230, `panels/ChatWorkTimeline.tsx` 220,
`KeyLevelsCard.tsx` 193, `SymbolPicker.tsx` 183, `TimeframeBar.tsx` 179, `drawingGeometry.ts` 154,
`panels/ChatHistoryPalette.tsx` 107, `LevelAccuracyBadge.tsx` 77, `BiasChips.tsx` 72,
`panels/ComposerWorkspaceRow.tsx` 56, `panels/SupervisorIndicator.tsx` 52,
`panels/ChatAttachmentStrip.tsx` 34, `SupervisorPanel.tsx` 21.

**`components/journal/`** — `TradeLog.tsx` 793, `Journal.tsx` 383, `UpdateTradeModal.tsx` 177,
`MonthlyReportCard.tsx` 74, `WeeklyReviewCard.tsx` 52.

**`components/learn/`** — `SkillsCatalog.tsx` 743, `MemoryFilesManager.tsx` 702,
`LearnView.tsx` 364, `MemoryHealthCard.tsx` 327, `SkillViewerPanel.tsx` 287,
`MemoryTopicsCard.tsx` 283, `SupervisorStream.tsx` 249, `MemoryTopicPanel.tsx` 225,
`AmendmentsInbox.tsx` 143, `ActionApprovals.tsx` 119, `PatternMemoryCard.tsx` 88.

**`components/skills/`** — `SkillDetail.tsx` 441, `SkillsLibrary.tsx` 63.

**`components/settings/`** (+ `tabs/`) — `ProviderManager.tsx` 929, `SettingsMenu.tsx` 581,
`PromptManager.tsx` 482, `SessionUsagePanel.tsx` 393, `StrategiesManager.tsx` 376,
`BackupManager.tsx` 289, `CustomInstructionsEditor.tsx` 222, `UserProfileManager.tsx` 207,
`tabs/ProfileTab.tsx` 173, `tabs/GeneralTab.tsx` 162, `JobsDrawer.tsx` 149,
`tabs/JournalTab.tsx` 146, `DiagnosticsPanel.tsx` 141, `tabs/ModelsTab.tsx` 139,
`StrategyPlans.tsx` 135, `ToolForgeManager.tsx` 128, `ProfileMemoryCard.tsx` 121,
`tabs/DeskToolCatalogue.tsx` 109, `tabs/shared.tsx` 93, `AutoJournalRulesCard.tsx` 92,
`StorageLocationCard.tsx` 87, `tabs/MemoryTab.tsx` 81, `HarnessLessonsBrowser.tsx` 62,
`tabs/ActionsTab.tsx` 62, `tabs/PromptsTab.tsx` 54, `tabs/StrategiesTab.tsx` 53,
`tabs/types.ts` 41.

**Hooks read** — `useSurfaceRouter.ts` 171, `useSurface.ts` 32, `useRightPanel.ts` 207,
`useConversations.ts` 82, `useConversationHousekeeping.ts` 198, `useUIState.ts` 131.

**Utils read** — `agentThreads.ts` 325 (the `deskThread` selector at `:118-138`),
`turnStatus.ts` 247, `toolKinds.ts` 142.

**Docs** — `docs/ui-doctrine.md` 151, `docs/app-flow.md` 1125, `docs/learning-loop-map.md` 223.

**`index.css`** 1769 (the `@theme` token block at `:125-272`; motion rules scattered through
`:378-1760`).

**`scripts/`** — `render-probe.cjs` 2654 lines (156 KB), `probe-skill-approval.cjs` 532
(29 KB), `boot-probe.cjs` 165 (7 KB), `mock-provider.cjs` 13 KB, plus
`check-flow-doc-anchors.cjs`, `check-update-manifest.cjs`, `check-workflow-shells.cjs`,
`chip-shot.cjs`, `eslint.config.mjs`, `flake-hunt.cjs`, `installer-smoke.cjs`,
`release-is-ci-only.cjs`, `replay-plans.cjs`, `replay-plans.entry.ts`, `surface-census.cjs`,
`surface-shots.cjs`, `test-candle-history.ts`, `trade-shot.cjs`, `ui-inspect.cjs`,
`verify-release-signature.cjs`.

**Tests read** — `tests/deadControlsGuard.test.ts` 344 (21 cases).

---

*Read-only pass. No file in the repository was modified except this report, which was
created at `docs/research/baseline/ui-shell-and-surfaces.md`. No build, no `npm install`, no
app execution, no network call, no exchange key, no order. The six dirty source files
listed in the header were already dirty before this pass and were not touched by it.*
