# August Trading — the complete flow

Every node names the file and line that implements it. Verified against the tree on
**2026-10-18** (after the post-mortem, 2D desk floor, saved-analyses and Roles-tab
deletions); if a line moves, fix the line rather than deleting the claim.

Dotted nodes exist in the code but are **never mounted** by the running app.

Companion docs: [learning-loop-map.md](learning-loop-map.md) covers section D in more
depth, [ui-doctrine.md](ui-doctrine.md) governs the shell in sections A and B.
Sections B, C and D move again in stages 19–20 of the debate deletion — see
[docs/plans/debate-deletion-status.md](plans/debate-deletion-status.md).

---

## A · Boot → shell → a surface

```mermaid
flowchart TD
    H["index.html"] --> I["index.tsx — error handlers first :23 :43"]
    I --> S["StrictMode › ErrorBoundary › ToastProvider › App :73-79"]
    S --> SP["splash leaves #root :86-92 — what e2e and boot-probe wait on"]
    SP --> APP["App :187 — surfaces render from :2152 down"]
    APP --> US["useSurface — august_surface_v1 :15, valid set :16"]
    US --> UR["useSurfaceRouter — openJournal :75, hash read :101, serialize :158-160"]
    UR --> HASH["utils/appHash.ts:10 — hash and state stay equal"]
    APP --> HD["Header band :2452 — only when surface !== 'agents' :2451"]
    HD --> SW["SurfaceSwitch :2152 — 4 destinations, list in SurfaceMenuList.tsx:42-51"]
    APP --> AV["AgentsView gets the same nodes as props :2589-2660"]
    SW --> T["Trade · trade-view · App:2480"]
    SW --> J["Journal · journal-view · App:2525"]
    SW --> C["Chat · agents-view · App:2589"]
    SW --> K["Knowledge · learn-view · App:2547"]
    K -.-> AP["Approvals is a TAB of Knowledge — components/learn/LearnView.tsx:64"]
    NR["NavRail — imported App:123, NEVER rendered (see correction 5); its AccountRow export IS, App:2659"]:::dead
    SM["SurfaceMenuList destination rows :116 — only mount passes hideSurfaces (App:2649; pinned by tests/deadControlsGuard.test.ts:147-150)"]:::dead
    classDef dead stroke-dasharray: 5 5,opacity:.5
```

Stored surface values `'chat'`, `'boards'`, `'skills'` all migrate to `'trade'`
([useSurface.ts:24](../hooks/useSurface.ts)). There is no `main.tsx`.

---

## B · One message — two chat homes, two decisions

```mermaid
flowchart TD
    subgraph CHAT["Chat surface (agents)"]
        CB["composer textarea — AgentsView.tsx:504 ref, Enter :1362"] --> D1{"send() :660 branches on what is SELECTED, branch :698"}
        D1 -->|a bot is selected| BOT["onSendBotTurn :698 → App:2602 → useBotMailbox → runBotTurn"]
        D1 -->|no bot| AN["onAnalyze(prompt, images) :688 → App:1700 handleRunAnalysisFromChat"]
    end
    subgraph DOCK["Chart AI dock — inside Trade, TradeView.tsx:1103"]
        DC["ChatComposer.tsx:146 :218"] --> D2{"chatTurnRunner.send :833 — branches on seats"}
        D2 -->|solo| SO["runSeatTurn called :978 → streamChatWithDeskTools :641"]
        D2 -->|panel, 2+ seats| PN["per-seat :1127 + createDebateMailbox :1055 + planPanelTurn :1067"]
        D2 -->|Full analysis button| FA["runFullAnalysis :1189 → the SAME App:1700 wrapper — it holds the session run slot and writes no row"]
    end
    BOT --> TR["streamQuickResponse — GenericAnalysisService.ts"]
    AN --> HSM["handleSendMessage — useAnalysisPipeline.ts:606"]
    FA --> HSM
    SO --> HSM2["streamChatRequest — GenericProviderService.ts"]
    PN --> HSM2
    HSM --> D3{"isChartAnalysisRequested :1474 AND runEnsembleEnabled, guard :1488"}
    D3 -->|true| ENS["ensemble analysis — section C"]
    D3 -->|false, casual :3153| CAS["streamQuickResponse :3197, prompt CASUAL_CHAT_SYSTEM_PROMPT constants/prompts/chatPrompts.ts:24"]
    CAS --> LW["live writer — applyCasualStreamUpdate streamThrottlers.ts:160, peel per frame; flush BEFORE the settle write :3238"]
    TR --> LW
    ENS --> MERGE
    LW --> MERGE["entriesForSession — chatSessions.ts:525, parameter literally named canonical"]
```

The dock's system prompt is assembled by `systemPromptFor`
([TradeChatPanel.tsx:453](../components/trade/TradeChatPanel.tsx)) from
`TRADE_CHAT_SYSTEM_PROMPT` + skills index + strategies + profile memory + persona.

**One entry, both homes.** `handleRunAnalysisFromChat` (App.tsx:1700) is the only
analysis wrapper: the dock passes it as `onRunAnalysis` (App:2508) and the Chat
surface as `onAnalyze` (App:2604). It was two, and `services/trade/analysisTurn.ts`
was deleted (2026-10-17) because a second writer keyed rows with ids no canonical
row could match — that is what made the two homes disagree.

The Chat surface's non-bot branch has **no desk tools wired** — that is the gap
stage 20 closes, by routing both homes through `chatTurnRunner`.

---

## C · The analysis pipeline, in call order

```mermaid
flowchart LR
    S1["1 data pull HybridIntelligenceService"] --> S2["2 gate scan GateKeeperService"]
    S2 --> S3["3 prompt assembly memoryContext.ts"]
    S3 --> S4["4 analyst openings + desk tools → tool stream → executeDeskTool"]
    S4 --> S5["5 debate, all-or-nothing seat gate → conductDebate / conductRealDebate"]
    S5 --> S6["6 moderator — ensembleService.ts, always a fresh sendChatRequest"]
    S6 --> S7["7 verdict → verdictFinalizer.ts, predicate ceiling"]
    S7 --> S8["8 result + Monte Carlo + backtest"]
    S8 --> JR["journal row — logTradeWithFeedback useTradeLogging.ts"]
    S4 -.->|a seat calls| PT["present_trade → parseTradeProposal proposedTrade.ts → TradeAnalysis outcome PENDING, so the autopilot already watches it"]
```

Stage line numbers are omitted deliberately: this section is deleted in stage 19 of
the debate removal, and re-measuring 8 anchors to document a week's life is not
worth it. The structure above is what to replace it with.

**The node that used to hang off stage 8 is gone.** `usePostMortem.ts` and
`GenericAnalysisService.conductPostMortem` were deleted (2026-10-18, `03fc0d5`);
nothing re-runs an analysis after a trade closes. That is the arrow section D used
to close on — and deleting the writer is not the same as deleting the route, which
section D states exactly.

---

## D · The learning loop — now open at the trade end

```mermaid
flowchart TD
    P["draft producers — sessionSkillReview · passMining · selfImprovement · bookSkillDrafts · chartScanSkills · botLearning · the propose_skill desk tool"] --> GT["two-tier evidence gate — draftGates.ts"]
    GT --> IN["skill drafts inbox — skillDrafts.ts"]
    IN --> HU{"HUMAN approval — approveSkillDraft skillApproval.ts, reads the library back"}
    HU --> NB["notebook — memory_files_v1_&lt;user&gt;, tiers memoryBudget.ts: refuse growth, never evict"]
    NB --> INJ["injected into the next prompt — resolveInvokedSkills useAnalysisPipeline"]
    INJ -->|closes the loop| C3["stage 3, prompt assembly"]
    HB["heartbeat 15 min + visibilitychange — useLearningHeartbeat, mounted App"] --> HYG["memory hygiene → memoryHygiene.ts"]
    HYG --> IDL["idle suspension — skillIdleLifecycle.ts, rides enabled not a 4th status"]
    BADGE["one number: approvalsWaiting App, shown on the Knowledge tab that holds the queues"]
    IN -.-> BADGE
```

**What changed here:** the entry node used to be `closed trade / post-mortem →
craftSkillFromPostMortem`. The post-mortem was the only writer of
`LoggedTrade.postMortem`, so deleting it **starved that route rather than deleting
it** — the distinction matters because the code still looks alive. Nothing writes
the field any more, but `craftSkillFromPostMortem`
([services/learning/SkillCraftService.ts:140](../services/learning/SkillCraftService.ts))
is still called from `botLearning.ts:234`, and its first guard is
`if (pm.length < 40) return null` on `trade.postMortem` (`:144`). So for every trade
closed after 2026-10-18 the craft leg can only return null; it still answers for a
row that carries a post-mortem from before then. `selfImprovement.ts:73-74`,
`SkillMemoryService` and `DoctrineConsolidationService` read the same dead field —
25 read accesses across 17 files outside the tests and the SQLite row mapping
(measured 2026-10-18). Deleting the writer was the owner's
explicit choice, with no replacement; clearing the readers is stage 21.

The chain from `draftGates` to the injected skill is unchanged and still runs; it
now starts at the review passes and at the chat's `propose_skill` tool, not at a
settled position.

Corollary that is easy to miss: `GlobalMemory.aiPatternMemory` and
`insightKnowledgeBase` are **frozen stores** (see G), and
`MistakePatternService` / `JobQueueService`, which warned about a recurring setup
before the next entry, no longer exist.

---

## E · Autonomy — routines, rooms, alerts

```mermaid
flowchart TD
    TK["automation tick / runNow / boot catch-up → runAutomation"] --> D{"forks on config.botId"}
    D -->|has a bot| BR["runBotRoutineTurn botRoutine.ts — prompt, history"]
    BR --> ST["injected stream = streamQuickResponse useAutomations — reuses the bot transport, NOT the debate"]
    D -->|no bot| PL["handleSendMessage with the automation option — reuses section C"]
    PL --> PRIV["runs into a private message list, not the open conversation — refs useAnalysisPipeline.ts:464-467, rationale :614-617"]
    GR["useAgentGroups.ts → groupRounds → streamQuickResponse"] --> GV["GroupChatView"]
```

An automation run always takes the ensemble path: `runEnsembleEnabled =
isAutomationRun || isEnsembleEnabled` (useAnalysisPipeline.ts:669). That is why
stage 19 has to give scheduled runs a new route, not just delete the branch.

---

## F · How a request leaves the app

```mermaid
flowchart LR
    GA["GenericAnalysisService — one service replacing nine"] --> GP["GenericProviderService — 4 formats types/provider.ts, dispatch"]
    GP --> PO["shared/providerRequestPolicy.cjs — thinking, budget, temperature, host rules, one redirect walker"]
    GP --> W1["renderer fetch"]
    GP --> W2["dev proxy /__provider_proxy → vite.config.ts"]
    GP --> W3["desktop IPC → main.cjs → sseParser → provider:chunk"]
    W1 --> RS["reasoning side channel — onReasoning, extractReasoning, deltaReasoning"]
    W2 --> RS
    W3 --> RS
    RS --> D1["dock: LiveEntry.reasoning chatTurnRunner.ts"]
    RS --> D2["pipeline: Message.thoughtProcesses useAnalysisPipeline.ts"]
    D1 --> TS["traces persist to their own IDB db — ThinkingStoreService.ts"]
    D2 --> TS
```

`electron/sseParser.cjs` mirrors only three dialects — `google` has no desktop SSE
parser. That is the one place "three formats" is true.

---

## G · Where everything is remembered

```mermaid
flowchart TD
    MSG["App messages — canonical, useConversations, cap 200"] --> MER["entriesForSession chatSessions.ts:525 — App rows, dock entries overwrite by id"]
    CS["chatStore singleton — survives unmount, owns AbortControllers"] --> MER
    MER --> PANE["agentThreads.ts read at AgentsView — drops room rows, keeps non-AI, drops only a POSITIVE botId claim"]
    CS --> LS["localStorage trade_chat_sessions_v1_&lt;user&gt; — debounced, streaming stripped"]
    MSG --> PP["useProfilePersistence → dbService"]
    PP --> IDB["web: IndexedDB FuturesAI-DB / userProfiles"]
    PP --> SQL["native: SQLite — one-way migration flag sqlite_migrated"]
    GM["GlobalMemory.aiPatternMemory · insightKnowledgeBase"]:::dead --> IDX["rendered by buildGlobalMemoryIndex — the only reader"]
    classDef dead stroke-dasharray: 5 5,opacity:.5
```

Both lesson stores are **frozen**: readers and the injected index stay, so a profile
keeps what it already carries, but nothing grows them (`03fc0d5`).

| What | Key |
|---|---|
| dock sessions · active id · tool payloads | `trade_chat_sessions_v1_` · `trade_chat_active_v1_` · `trade_tool_payloads_v1_` |
| notebook · queue · drafts · rules | `memory_files_v1_` · `learning_proposals_v1:` · `skill_drafts_v1:` · `approval_rules_v1:` |
| roster · automations · providers | `agents_bots_v1` · `automations_v1_` · `provider_configs_v1` (keys `enc:v1:` via safeStorage) |
| screenshots · reasoning traces | IDB store `images` (`services/infrastructure/messageImageStore.ts`) · own db (`services/infrastructure/ThinkingStoreService.ts`) |
| reduce-motion preference | `desk_idle_motion_v1_&lt;user&gt;` — the desk floor is deleted, the key is not, renaming it silently resets every profile |

`savedAnalyses` still travels through profile persistence, SQLite and backups, but
**has no writer** — the Journal's Saved tab and `SavedAnalyses.tsx` were deleted
(`591f735`), and clearing the store itself is stage 21.

---

## H · Every arrow

| # | from → to | what crosses |
|---|---|---|
| 1 | index.html → index.tsx | mount, error handlers first `:23 :43` |
| 2 | index.tsx → App | StrictMode › ErrorBoundary › ToastProvider `:73-79` |
| 3 | App → useSurfaceRouter | surface + journalTab + journalOpenNonce |
| 4 | useSurfaceRouter → useSurface | persisted value, key `august_surface_v1` `:15` |
| 5 | useSurfaceRouter → appHash | `#/journal\|market\|settings\|watch` ⇄ state `:101 :158` |
| 6 | App → Header | band, only when `surface !== 'agents'` `:2451` |
| 7 | App → 4 lazy surfaces | each behind `SurfaceSkeleton` `:2480 :2525 :2547 :2589` |
| 8 | Header → SurfaceSwitch | the destination set `:2152`, list `SurfaceMenuList.tsx:42-51` |
| 9 | App → AgentsView props | same switch + StatusCluster + AccountRow + SurfaceMenuList(hideSurfaces) `:2589-2660` |
| 10 | TradeView → TradeChatPanel | the dock, inside Trade `:1103` |
| 11 | AgentsView.send → bot branch | `activeBot` truthy `:698` |
| 12 | bot branch → useBotMailbox | `runUserBotTurn` → `runBotTurn` |
| 13 | AgentsView.send → analysis branch | `onAnalyze` `:688` → App `:1700` — the dock's `onRunAnalysis` reaches the SAME wrapper |
| 14 | dock Full analysis → the run slot | `runFullAnalysis :1189` → `beginRun`/`endRunOwned`; it writes **no row**, the pipeline's own messages are projected into the session |
| 15 | ChatComposer → chatTurnRunner.send | Enter `:146` / button `:218` → `:833` |
| 16 | solo → runSeatTurn | `:978` (definition `:604`) |
| 17 | runSeatTurn → streamChatWithDeskTools | `:641` → `DeskToolsService` → `streamChatRequest` |
| 18 | panel → per-seat + mailbox | `:1127` · `:1055` · `:1067` |
| 19 | systemPromptFor → prompt | `TRADE_CHAT_SYSTEM_PROMPT` + skills + strategies + profile + persona `TradeChatPanel.tsx:453` |
| 20 | every dock turn → chatStore | `mutate` · `beginRun` |
| 21 | handleSendMessage → the fork | `:1474`, guard `:1488`, else `:3153` |
| 22 | casual → streamQuickResponse | `:3197` → `GenericAnalysisService`, tier via `resolveComposerEffort` |
| 23 | casual frames → Message.text | `streamThrottlers.ts:160`; flush precedes the settle write `:3238` |
| 24 | ensemble → 8 stages | see C — anchors deliberately omitted |
| 25 | desk tools → what a caller can reach | `executeDeskTool DeskToolsService.ts` |
| 26 | panel tools → chart echo | `executePanelTool chatTurnRunner.ts` → `onToolAction` |
| 27 | automation tick → runAutomation | fork on `config.botId`; no-bot path reuses 21 with `automation` → private list `:464-467 :614-617` |
| 28 | bot routine → injected stream | `botRoutine.ts` ← `useAutomations` (reuses 22) |
| 29 | rooms → groupRounds | `useAgentGroups` → `streamQuickResponse` |
| 30 | review passes / propose_skill → draft → approval → skill | `draftGates.ts` → `skillApproval` — the post-mortem leg is starved, not deleted (see D) |
| 31 | approved skill → next prompt | `resolveInvokedSkills` — closes into 24's stage 3 |
| 32 | logged trade → memory + autopilot | `useTradeLogging` → `MemoryService`; `proposedTrade` leaves outcome PENDING so the autopilot watches it |
| 33 | App messages + dock entries → one thread | `chatSessions.ts:525` |
| 34 | chatStore → localStorage | `saveSessions` → debounced key |
| 35 | App → profile persistence → engine | `useProfilePersistence` → `dbService` or `SqliteService` |
| 36 | providers → Preferences, keys encrypted | `ProviderConfigService` |
| 37 | every provider call → the policy | `GenericProviderService` → `providerRequestPolicy.cjs` |
| 38 | dev calls → the proxy | `/__provider_proxy` → `vite.config.ts` |
| 39 | desktop calls → IPC → sseParser → chunks | `main.cjs` → `sseParser.cjs` |
| 40 | reasoning deltas → their own field | `chatTurnRunner` / `useAnalysisPipeline` → `ThinkingStoreService` |
| 41 | notebook writes → byte tiers | `MemoryFilesService` → `memoryBudget.ts` → `memoryHealth.ts` |
| 42 | heartbeat → hygiene + idle sweep | `useLearningHeartbeat` → `memoryHygiene.ts` → `skillIdleLifecycle.ts` |
| 43 | approval tray → badge | `collectApprovalItems` → `approvalsWaiting` → Knowledge tab only |
| 44 | the pane filters what it shows | `agentThreads.ts` read at `AgentsView.tsx` |

---

## Corrections this doc is guarding

1. There is **no `main.tsx`** — the entry is `index.tsx`.
2. There is **no `utils/deskThread.ts`** — `deskThread` is `utils/agentThreads.ts`.
3. The provider layer speaks **four** wire formats (`types/provider.ts`); "three"
   describes only `electron/sseParser.cjs`, which has no `google` dialect.
4. Approvals is a **tab** of the Knowledge surface, not a fifth destination. The live
   destination set is exactly `trade | journal | agents (labelled Chat) | learn
   (labelled Knowledge)`.
5. **`NavRail` is imported and NOT rendered — it is a dead node.** Verified four
   ways on 2026-10-18: `grep -c NavRail App.tsx` = 18 occurrences and **none is a
   JSX element**; `grep '<NavRail'` repo-wide matches only `components/shell/NavRail.tsx:140`
   (its own definition) and `tests/agentsSurface.test.tsx:390` (a test mounting it
   directly); ESLint reports `App.tsx:123:8 'NavRail' is defined but never used`; and
   the code says so out loud — `App.tsx:2430` and `:2435` are comments reading "The
   NavRail is GONE: its five destination rows were the tab strip this redesign was
   asked to remove". Only the `AccountRow` export is rendered, at `App.tsx:2659`.
   **An earlier pass of this doc asserted the opposite** ("rendered at App:2766") and
   the mechanism is worth keeping: `App.tsx:2468` passes `onExpandNavRail={…}` and the
   rail's expand state is very much alive at `:655-691`, so a grep for `NavRail` looks
   like a mounted component. An `on…` prop is not a render. Withdrawn.
6. **A doc line number is a claim, not a citation.** Every anchor above was
   re-measured with grep on 2026-10-18, and counts were taken with `grep -c` rather
   than a truncated `head` — the first version of correction 5 died by exactly that
   truncation. Numbers in section C are deliberately omitted: they are the lines stage
   19 deletes.
