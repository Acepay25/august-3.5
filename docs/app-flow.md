# August Trading — the complete flow

Every node names the file and line that implements it. Verified against the tree on
**2026-10-18** (after the post-mortem, 2D desk floor, saved-analyses and Roles-tab
deletions **and stages 20a/20a2/20g/20b/20b-B/20t/20c/20s/20d/20f/20r of the debate
removal**, which moved
both chat homes and the scheduler onto one turn executor); if a line moves, fix the
line rather than deleting the claim.

Dotted nodes exist in the code but are **never mounted** by the running app.

Companion docs: [learning-loop-map.md](learning-loop-map.md) covers section D in more
depth, [ui-doctrine.md](ui-doctrine.md) governs the shell in sections A and B.
The stage ledger is [docs/plans/debate-deletion-status.md](plans/debate-deletion-status.md);
sections B and C moved again when stage 19 deleted the engine.

---

## A · Boot → shell → a surface

```mermaid
flowchart TD
    H["index.html"] --> I["index.tsx — error handlers first :23 :43"]
    I --> S["StrictMode › ErrorBoundary › ToastProvider › App :73-79"]
    S --> SP["splash leaves #root :86-92 — what e2e and boot-probe wait on"]
    SP --> APP["App :188 — surfaces render from :2504 down"]
    APP --> US["useSurface — august_surface_v1 :15, valid set :16"]
    US --> UR["useSurfaceRouter — openJournal :75, hash read :101, serialize :158-160"]
    UR --> HASH["utils/appHash.ts:10 — hash and state stay equal"]
    APP --> HD["Header band :2476 — only when surface !== 'agents' :2475"]
    HD --> SW["SurfaceSwitch :2176 — 4 destinations, list in SurfaceMenuList.tsx:42-51"]
    APP --> AV["AgentsView gets the same nodes as props :2613-2684"]
    SW --> T["Trade · trade-view · App:2504"]
    SW --> J["Journal · journal-view · App:2547"]
    SW --> C["Chat · agents-view · App:2613"]
    SW --> K["Knowledge · learn-view · App:2571"]
    K -.-> AP["Approvals is a TAB of Knowledge — components/learn/LearnView.tsx:64"]
    NR["NavRail — imported App:124, NEVER rendered (see correction 5); its AccountRow export IS, App:2684"]:::dead
    SM["SurfaceMenuList destination rows :116 — only mount passes hideSurfaces (App:2679; pinned by tests/deadControlsGuard.test.ts:147-150)"]:::dead
    classDef dead stroke-dasharray: 5 5,opacity:.5
```

Stored surface values `'chat'`, `'boards'`, `'skills'` all migrate to `'trade'`
([useSurface.ts:24](../hooks/useSurface.ts)). There is no `main.tsx`.

---

## B · One message — two chat homes, ONE turn executor

```mermaid
flowchart TD
    subgraph CHAT["Chat surface (agents)"]
        CB["composer textarea — AgentsView.tsx:541 ref, Enter :1474"] --> D1{"send() :697 branches on what is SELECTED"}
        D1 -->|a bot is selected| BOT["onSendBotTurn :735 → App:2626 → useBotMailbox → runBotTurn"]
        D1 -->|no bot| AN["onAnalyze(prompt, images) :725 → App:1720 handleRunAnalysisFromChat"]
    end
    subgraph DOCK["Chart AI dock — inside Trade, TradeView.tsx:1115"]
        DC["ChatComposer.tsx:146 :218"] --> D2{"chatTurnRunner.send chatTurnRunner.ts:774 — branches on seats"}
        D2 -->|solo| SO["runSeatTurn called :919, defined :592"]
        D2 -->|panel, 2+ seats| PN["per-seat :1068 + createDebateMailbox :996 + planPanelTurn :1008"]
        D2 -->|Full analysis button| FA["runFullAnalysis :1130 → the SAME App:1720 wrapper — it holds the session run slot and writes no row"]
    end
    SO --> TT["runToolTurn — services/trade/toolTurn.ts:89"]
    PN --> TT
    TT --> SCDT["streamChatWithDeskTools — toolTurn.ts:95 → DeskToolsService"]
    BOT --> TR["streamQuickResponse — GenericAnalysisService.ts (bots stay chat-only)"]
    AN --> HSM["handleSendMessage — useAnalysisPipeline.ts:504"]
    FA --> HSM
    HSM --> D3{"the debate branch is GONE (19): a send answers through the tool turn :1475. runEnsembleEnabled :584 survives only as a gate on the hybrid pull :1022 — a schedule is claimed earlier, by its own arm :827"}
    D3 -->|true| ENS["ensemble branch — section C (ENGINE DELETED; the branch still gates and still refuses)"]
    D3 -->|false, casual :1469| SPLIT{"a bot thread? :1449"}
    SPLIT -->|yes| TR
    SPLIT -->|no — the desk, with its tools| CST["runChatSurfaceTurn — chatSurfaceTurn.ts:229, tools from CHAT_SURFACE_TOOLS :54, prompt chatSurfaceSystemPrompt :146"]
    CST --> TT
    TR --> LW["live writer — applyCasualStreamUpdate hooks/analysisPipeline/streamThrottlers.ts:160, peel per frame; flush BEFORE the settle write useAnalysisPipeline.ts:1478"]
    CST --> LW
    ENS --> MERGE
    LW --> MERGE["entriesForSession — chatSessions.ts:531, parameter literally named canonical :533"]
    SCDT --> PT["present_trade → runPresentTrade presentTradeTool.ts:75 → the row's card, in EITHER home"]
```

The dock's system prompt is assembled by `systemPromptFor`
([TradeChatPanel.tsx:453](../components/trade/TradeChatPanel.tsx)) from
`TRADE_CHAT_SYSTEM_PROMPT` + skills index + strategies + profile memory + persona.
The Chat surface's prompt is its own now (stage 20s): `chatSurfaceSystemPrompt`
([services/trade/chatSurfaceTurn.ts:146](../services/trade/chatSurfaceTurn.ts))
leads with `CHAT_SURFACE_SYSTEM_PROMPT`
([chatPrompts.ts:40](../constants/prompts/chatPrompts.ts)) — which is
`CASUAL_CHAT_SYSTEM_PROMPT` with a calling mandate and an explicit "no chart
here" bolted on, so the output discipline that fixed the
"Here's a thinking process:" replies survives — then appends the skills index,
the active strategy plans and the profile memory index, each read FRESH per turn
the way the dock reads them. Its skills heading says *what the trader asks
about*, not *this chart*: `buildSkillsIndexForPrompt` took a `where` argument so
the dock's default stays byte-identical. The slugs that actually travelled are
recorded on the row (`Message.injectedSkills`, `types/message.ts:368`), bounded
to the 30 the index prints — a row naming skills the model never saw would be an
audit defect, not an audit trail.

**One entry, both homes.** `handleRunAnalysisFromChat` (App.tsx:1720) is the only
analysis wrapper: the dock passes it as `onRunAnalysis` (App:2532) and the Chat
surface as `onAnalyze` (App:2628). It was two, and `services/trade/analysisTurn.ts`
was deleted (2026-10-17) because a second writer keyed rows with ids no canonical
row could match — that is what made the two homes disagree.

**One executor, two row shapes.** `runToolTurn`
([services/trade/toolTurn.ts:89](../services/trade/toolTurn.ts)) owns the stream,
the tool rounds, the abort-before-repair order, the text-protocol strip and the
reasoning peel. The ROW stays with the caller, because the two shapes do not share
those fields: the dock writes a `chatStore` `LiveEntry` (`tools`/`toolIds`), the
Chat surface writes a canonical `Message` (`liveToolEvents`, `toolActions`,
`thoughtProcesses`). That is why the executor takes an event SINK and not a shared
state object — and why the Chat surface stopped answering live-data questions from
the model's training data (stage 20b, `chatSurfaceTurn.ts`).

A desk seat on the Chat surface may call the canvas-free half of the dock's tools
plus `present_trade`; the other seven `CHART_ACTION_TOOL_DEFS` are not offered at
all, because `streamChatWithDeskTools` lists a chart-action definition only when a
caller dispatches it **and** the seat's allow-list names it. Bots are the exception
by ruling: a bot thread keeps the plain transport, and `useBotMailbox`,
`botRoutine` and `groupRounds` are not on the tool turn.

The card a presented plan draws lives on whichever row presented it — the dock's
entry or `Message.proposal` — and the logged/dismissed disposition is one module
map for both ([proposalDisposition.ts:22](../services/trade/proposalDisposition.ts)),
keyed by the row id `entriesForSession` already shares.

**The wording gate is gone (stage 20c).** `isChartAnalysisRequested` used to test
the prompt for `LIVE MARKET` / `STRATEGY` / `ANALYZE` / `CHART` / `SETUP` — plus the
image and update facts — and `useAnalysisPipeline.ts` branched on it. It was already
a dead decision for a human send: the predicate was ANDed with `runEnsembleEnabled`
and `isEnsembleEnabled` appeared on both sides, so with the toggle on every send
ran the pipeline whatever it said and with it off no wording could make one. The
one route words controlled was a scheduled run's, contradicting the flag's own
comment that automations always run the pipeline: the same automation answered
casually when its prompt read "outlook" and fully when it read "setup". The guard
is now the mode alone — and stage 20r finished what that sentence implies: the
flag no longer has an automation clause either, so the mode decides for a human
send and a schedule has its own arm above the fork (section E). Consequences
worth knowing: a screenshot attached to a toggle-off send is still casual chat (it
always was), and the structured verdict,
the levels and the journal row reach a normal send only as TOOLS the seat calls —
which is why 20b and 20b-B had to land first.

**A plan the seat only *said* still gets the card (stage 20d).** A tool is only as
good as the model's choice to call it, and the ledger's whole problem is rows that
never arrive. So a Chat row whose prose carries a labelled entry, stop and target
offers the same decision the card offers: `planFromProse` extracts the numbers and
hands them to `parseTradeProposal` — there is no second validator, which is why a
long whose stop sits above its entry grows no chip — and the chip mints the plan id
through `mintPlanId`, the one shape `present_trade` uses, so the two paths dedupe
against each other. It requires a coin, one direction (a reply that hedges "long
above X, short below Y" is not one plan), and it stays out of the way of a row that
already has a proposal.

---

## C · The analysis pipeline, in call order

Stage 19 deleted the debate from this path. What one send actually does now:

```mermaid
flowchart LR
    S1["1 data pull HybridIntelligenceService — still gated on runEnsembleEnabled :1022"] --> S3["3 prompt assembly memoryContext.ts"]
    S3 --> S4["4 one turn: runChatSurfaceTurn :1475 → executeDeskTool"]
    S4 -->|a seat calls| PT["present_trade → runPresentTrade → plan + gate stamp"]
    PT --> JR["journal row — logTradeWithFeedback useTradeLogging.ts"]
    S4 --> ANS["the answer is the prose beside the card"]
```

**Stages 2, 5, 6, 7 and 8 of the old list are gone from the call path**: the gate
scan (`GateKeeperService`) — the gate now runs inside `present_trade` (20a2); the
analyst openings and the debate (`conductDebate` / `conductRealDebate`); the
moderator pass; the finalizer (its file and suite are now DELETED); the
pipeline-side Monte Carlo and backtest. The engine FILES are now deleted too: stage 19's second tranche removed
`ensembleService`, `ensembleConsensus`, `debateScience`, `debateResume`,
`provisionalVerdict`, `analysisResultProcessor`, `CompletionNotifications` and
22 more, with their suites — 26 production files gone. The three reachable modules
that still imported debate helpers were cut by INLINING the slice each one used
(`streamThrottlers` keeps only `throttledCasualStream`; the watch follow-up groups
round-1 turns itself; `monthlyReport` computes the log-odds mean itself), so no
displayed number changed. `runEnsembleEnabled` (:575) survives as a switch with
far fewer things to switch between, and `Message.debateTurns` stays as a read-only
legacy field for rows written before the cut — the same rule `modelsUsed` follows.



Why the deletion is safe rather than a loss: the thing section C existed to produce
— a grounded verdict with a journal row — is what a tool-bearing turn produces now
(section B). A `TradeAnalysis` row is no longer written by a send, so the journal's
verdict-shaped rows come from `proposal` cards, and the surviving readers were
re-pointed in 20b-B and 20r rather than left reading a field nothing writes.

**One known residue, not a bug I hid.** The hybrid data pull at `:1022` still runs
for a human send with the toggle on, and its packet reaches no model any more — the
turn fetches the tape through tools. Deleting it is the next tranche's first job,
and `beginPromptLane` now has zero callers while the `finally` still calls
`endPromptLane()`, so the prompt A/B lane is starved rather than deleted; whether it
should be re-wired onto the tool turn or removed is an owner decision.

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
`if (pm.length < 40) return null` on `trade.postMortem` (`:145`). So for every
trade closed after 2026-10-18 the craft leg can only return null; it still answers
for a row that carries a post-mortem from before then. `selfImprovement.ts:73-74`,
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
    TK["automation tick / runNow / boot catch-up → runAutomation useAutomations.ts:411"] --> D{"forks on config.botId :431"}
    D -->|has a bot| BR["runBotRoutineTurn useAutomations.ts:343 → botRoutine.ts:80 — prompt, history"]
    BR --> ST["injected stream = streamQuickResponse useAutomations — reuses the bot transport, NOT the debate"]
    D -->|no bot| AT["automation arm BEFORE the mode fork useAnalysisPipeline.ts:1296 → runAutomationTurn automationTurn.ts:160"]
    AT --> PRIV["runs into a private message list, not the open conversation — automationMessagesRef useAnalysisPipeline.ts:383, its notices (a failed tool, a turn that called nothing, a refused plan)"]
    AT --> CAP["plan rationed: MAX_PLANS_PER_RUN :68 · MAX_PLANS_PER_DAY AutomationService.ts:113"]
    AT --> FAIL["failed tool + refused plan + no-lookup land in notices → row text and a WARNING toast useAutomations.ts:531"]
    GR["useAgentGroups.ts → groupRounds → streamQuickResponse"] --> GV["GroupChatView"]
```

A scheduled run no longer takes the debate path: `runEnsembleEnabled =
isEnsembleEnabled` (useAnalysisPipeline.ts:575) and the automation arm sits
ABOVE every remaining flag-gated block (:1022), so one config has one behaviour whatever the
trader's toggle says. That is what lets stage 19 delete the engine without
taking the scheduler down with it.

What the schedule keeps, and what it gained, are written down rather than
assumed. `tests/automationRouteCharacterization.test.tsx` pins the private
`automation-<id>` thread, the config's own model pick, the continuity read (now
the last three DELIVERED runs — `MAX_HISTORY_RUNS` useAutomations.ts:199, because
the old row-count read spent half its budget on `appendRun`'s 'running' stubs),
and the verdict row. `tests/automationToolTurn.test.ts` pins the two rules a run
with nobody watching needs: a plan refused past the cap answers with an
`ok: false` receipt, and a tool that came back with nothing — or a turn that
called nothing — is stated in the row and changes the toast from success to
warning. Its tool list is the Chat surface's minus the notebook-writers
(`AUTOMATION_UNATTENDED_DENY` automationTurn.ts:54): a recurring job that edits
the trader's memory changes what every later turn sees, with nobody in the loop.

---

## F · How a request leaves the app

```mermaid
flowchart LR
    GA["GenericAnalysisService — one of the two provider clients; the per-provider services are gone"] --> GP["GenericProviderService — 4 formats types/provider.ts, dispatch"]
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
    MSG["App messages — canonical, useConversations, cap 200"] --> MER["entriesForSession chatSessions.ts:531 — App rows, dock entries overwrite by id"]
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

A presented plan is remembered on its row, not in a store of its own: the dock keeps
`proposal` on the runtime `LiveEntry` only, the Chat surface on `Message.proposal`
(persisted with the conversation), and the logged/dismissed decision in
`proposalDisposition` — module scope, bounded, deliberately not persisted, because a
card that forgets it was clicked offers a second journal row.

---

## H · Every arrow

| # | from → to | what crosses |
|---|---|---|
| 1 | index.html → index.tsx | mount, error handlers first `:23 :43` |
| 2 | index.tsx → App | StrictMode › ErrorBoundary › ToastProvider `:73-79` |
| 3 | App → useSurfaceRouter | surface + journalTab + journalOpenNonce |
| 4 | useSurfaceRouter → useSurface | persisted value, key `august_surface_v1` `:15` |
| 5 | useSurfaceRouter → appHash | `#/journal\|market\|settings\|watch` ⇄ state `:101 :158` |
| 6 | App → Header | band, only when `surface !== 'agents'` `:2475` |
| 7 | App → 4 lazy surfaces | each behind `SurfaceSkeleton` `:2504 :2547 :2571 :2613` |
| 8 | Header → SurfaceSwitch | the destination set `:2176`, list `SurfaceMenuList.tsx:42-51` |
| 9 | App → AgentsView props | same switch + StatusCluster + AccountRow + SurfaceMenuList(hideSurfaces) `:2613-2684` |
| 10 | TradeView → TradeChatPanel | the dock, inside Trade `:1115` |
| 11 | AgentsView.send → bot branch | `activeBot` truthy `:735` |
| 12 | bot branch → useBotMailbox | `runUserBotTurn` → `runBotTurn` |
| 13 | AgentsView.send → analysis branch | `onAnalyze` `:725` → App `:1720` — the dock's `onRunAnalysis` reaches the SAME wrapper |
| 14 | dock Full analysis → the run slot | `runFullAnalysis :1130` → `beginRun`/`endRunOwned`; it writes **no row**, the pipeline's own messages are projected into the session |
| 15 | ChatComposer → chatTurnRunner.send | Enter `:146` / button `:218` → `:774` |
| 16 | solo → runSeatTurn | `:919` (definition `:592`) |
| 17 | runSeatTurn → the ONE turn executor | `runToolTurn toolTurn.ts:89` → `streamChatWithDeskTools :95` → `DeskToolsService` → `streamChatRequest` |
| 18 | panel → per-seat + mailbox | `:1068` · `:996` · `:1008` |
| 19 | systemPromptFor → prompt | `TRADE_CHAT_SYSTEM_PROMPT` + skills + strategies + profile + persona `TradeChatPanel.tsx:453`, assembled `:475` |
| 20 | every dock turn → chatStore | `mutate` · `beginRun` |
| 21 | handleSendMessage → what answers | the fork is gone (19): a bot thread streams `useAnalysisPipeline.ts:1406`, anything else runs the tool turn `:1475`; the mode flag `:584` now only gates the hybrid pull `:1022` |
| 22 | the casual arms | a bot thread → `streamQuickResponse useAnalysisPipeline.ts:1406` (plain transport); the desk → `runChatSurfaceTurn chatSurfaceTurn.ts:229` → arrow 17. Tier on both via `resolveComposerEffort`; a Full-analysis send also sets `requireTools` |
| 23 | casual frames → Message.text | `hooks/analysisPipeline/streamThrottlers.ts:160`; flush precedes the settle write useAnalysisPipeline.ts:1478 |
| 24 | ensemble → 8 stages | see C — anchors deliberately omitted |
| 25 | desk tools → what a caller can reach | `executeDeskTool DeskToolsService.ts` (its allow-list is enforced at execution, not only at offer time) |
| 26 | panel tools → chart echo | `executePanelTool chatTurnRunner.ts` → `onToolAction` |
| 27 | automation tick → runAutomation | `useAutomations.ts:411`, forks on `config.botId` `:431`; the no-bot path takes the pipeline's OWN schedule arm `useAnalysisPipeline.ts:1296` → `runAutomationTurn automationTurn.ts:160`, writing the private list automationMessagesRef useAnalysisPipeline.ts:383, its `notices` (a tool that came back failed, a turn that called nothing, a refused plan) and settling through `onMessage` `useAutomations.ts:531`. Characterized in `tests/automationRouteCharacterization.test.tsx` |
| 28 | bot routine → injected stream | `botRoutine.ts` ← `useAutomations` (reuses 22's bot arm) |
| 29 | rooms → groupRounds | `useAgentGroups` → `streamQuickResponse` |
| 30 | review passes / propose_skill → draft → approval → skill | `draftGates.ts` → `skillApproval` — the post-mortem leg is starved, not deleted (see D) |
| 31 | approved skill → next prompt | `resolveInvokedSkills` — closes into 24's stage 3 |
| 32 | logged trade → memory + autopilot | `useTradeLogging` → `MemoryService`; `proposedTrade` leaves outcome PENDING so the autopilot watches it |
| 33 | App messages + dock entries → one thread | `chatSessions.ts:531` |
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
| 45 | `present_trade` → a card in either home | `runPresentTrade presentTradeTool.ts:75` ← dock sink `chatTurnRunner.ts` / desk sink `chatSurfaceTurn.ts`; gate scan starts there, the cap binds at log time (`ensureStamp`) |
| 46 | `chatSurfaceSystemPrompt` → the desk arm's prompt | `chatSurfaceTurn.ts:146` — mandate (`chatPrompts.ts:40`) + skills index + active strategies + memory index, read FRESH per turn; the 30 slugs printed are the 30 recorded on the row (`types/message.ts:368`) |
| 47 | prose that never called the tool → the same decision | `planFromProse` (`services/trade/tradeShapedProse.ts`) reads the labelled entry/stop/target out of the row, `parseTradeProposal` decides whether that is a plan, and the chip mints the ONE plan-id shape (`mintPlanId`) before calling `onLogProposedTrade` — so a spoken plan reaches the journal the same way a presented one does |
| 48 | a scheduled run → a rationed plan | `MAX_PLANS_PER_RUN` (`automationTurn.ts:68`) counts inside the turn; `MAX_PLANS_PER_DAY` (`AutomationService.ts:113`) is a local-calendar-day ledger keyed per automation (`:130` read, `:143` spend). Past either, `present_trade` gets an `ok: false` receipt naming the limit — a refusal the MODEL reads, not a card that quietly never appears |
| 49 | a schedule's failure → the row and the toast | the turn's `notices` (`automationTurn.ts:160`) — a tool that came back `ok: false` (from `onToolPayload`, which already carries it), a turn that called nothing, a refused plan — are written into the stored text at `useAnalysisPipeline.ts:1296` and handed to `useAutomations.ts:531`, which downgrades the toast from success to warning. Nobody is watching a schedule live; a success toast over a failed lookup is how an unattended run manufactures confidence |
| 50 | a journal row gets its scalp/swing class | `withDetectedTradeType` (`services/analysis/ScalpDetectionService.ts`) is called at the two row-minting sites in `hooks/useTradeLogging.ts` — label-only, so no `validityDurationMinutes` appears and the autopilot expiry window never widens. The filter reads it at `components/journal/TradeLog.tsx:532` |
| 51 | a run records its measured cost | `recordToolTurnUsage` (`utils/sessionUsage.ts`) is called by all three turn owners — desk arm `chatSurfaceTurn.ts`, schedule arm `automationTurn.ts`, dock seats `chatTurnRunner.ts` — from the `usage` the wire reported per request. `Knowledge → Session Usage` reads that ledger; stage 19 left it with a reader and no writer. `usageCalls` distinguishes a zero-cost run from a provider that sent no usage frame |
| 52 | a finished analysis says so | `notify()` (`services/infrastructure/notify.ts`) fires when a Full-analysis send settles un-stopped (`hooks/useAnalysisPipeline.ts:1515`). Before stage 19 this came from the verdict finalizer; `CompletionNotifications` was a native-only copy of the same thing and now has no caller, so the app speaks through one notifier |
| 53 | the chart gets its Entry/Stop/Target lines | `latestChartVerdict(messages)` (`services/trade/chartData.ts`) is what App hands `TradeView` as `verdict` — the newest row carrying `Message.proposal` (what `present_trade` stamps; `useAnalysisPipeline.ts:1326`), with `Message.analysis` as the fallback for pre-debate history. Red-proved: the old selector keyed on `ensembleProgress` / >1 `modelsUsed` / `debateTurns` and returned null for every tool-turn row. render-probe PASSED on 2026-10-18 after this change (zero pageerrors, every row rendered), but the probe asserts no canvas overlay levels, so the drawn Entry/Stop/Target line is still un-asserted by any gate

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
   directly); ESLint reports `App.tsx:124:8 'NavRail' is defined but never used`; and
   the code says so out loud — `App.tsx:2454` and `:2459` are comments reading "The
   NavRail is GONE: its five destination rows were the tab strip this redesign was
   asked to remove". Only the `AccountRow` export is rendered, at `App.tsx:2684`.
   **An earlier pass of this doc asserted the opposite** ("rendered at App:2766") and
   the mechanism is worth keeping: `App.tsx:2492` passes `onExpandNavRail={…}` and
   the rail's expand state is very much alive at `:679-692`, so a grep for `NavRail`
   looks like a mounted component. An `on…` prop is not a render. Withdrawn.
6. **A doc line number is a claim, not a citation.** Every anchor above was
   re-measured on 2026-10-18 by locating the SYMBOL each one names (a scripted
   grep per symbol, not a `head`), and counts were taken with `grep -c` rather than
   a truncated listing — the first version of correction 5 died by exactly that
   truncation. Numbers in section C are deliberately omitted: they are the lines stage
   19 deletes.
7. **"The Chat surface has no tools wired" was true, and stopped being true on
   2026-10-18.** Both homes now run `runToolTurn`; what still differs is the row
   each writes and which tools that row can honour (a Chat seat gets no canvas
   tools, and its `present_trade` receipt says so rather than promising a level-watch
   that cannot exist there). If a future pass restores the old sentence, it is
   describing a bug it just reintroduced.

8. **"Automations always run the ensemble pipeline" was a code comment, and it is
   now false.** It was true up to stage 20r (2026-10-18), and stage 20c had even
   made it MORE true by deleting the wording that let one schedule answer casually.
   A scheduled run now takes its own arm — one tool turn, its own model pick, no
   canvas, a rationed plan and visible failures — so the ensemble flag answers only
   the question the trader's switch asks. If the sentence comes back, whoever
   restores it has also made stage 19 undeletable and given every schedule a debate
   nobody is watching.

## Measured after stage 19: what the deletion did NOT remove

The engine files are gone; the pipeline's ensemble BRANCH is only partly gone. `runEnsembleEnabled` (`hooks/useAnalysisPipeline.ts:575`) still gates three refusals that no longer protect a real debate — no moderator (`:731`), incomplete lens roles or two seats on one model (`:761`), and the `TEAM_MAX_SEATS` ceiling (`:794`) — so a send with the toggle ON can be refused for a debate that cannot happen. The staged placeholder is now REMOVED: `isStagedEnsemble` minted an extra AI row with `text: ''` and an `ensembleProgress` field nobody rendered, while the tool turn writes its own row (`streamingMessageId`), so every staged send left an empty bubble beside the answer with no settle path. `runOutcome`'s cancel branch keyed on that field, so it went with it — an interrupted staged run now settles the answer row and nothing else. `isDebating: true` now has NO writer at all — its only one was the resume branch, and `options.resumeMessageId` has no caller anywhere in the tree, so removing it took unreachable plumbing with it.

The user-visible consequence, now FIXED: `App.tsx:1249` selects `verdictMessage` by the DEBATE shapes (`ensembleProgress`, >1 `modelsUsed`, `debateTurns`) and passes `verdict={verdictMessage?.analysis}` to the chart (`App.tsx:2526`) — while nothing writes `Message.analysis` for a new run any more. `verdictFinalizer` was the writer; a tool turn answers with a `TradeProposal` in the tool payload (`services/trade/presentTradeTool.ts`, `proposedTrade.ts`, `tradeShapedProse.ts`). Reader without a writer, the third time in this stage (session usage, the completion notice). Fixed by `latestChartVerdict` in `services/trade/chartData.ts`: it keys on the settled proposal through the existing `buildProposedTradeAnalysis` and keeps `analysis` as the fallback for old rows; `tests/chartVerdictSource.test.ts` pins the proposal path, the fallback, the preference when a row carries both, the symbol match through `verdictLevels`, and the App wiring. render-probe PASSED on 2026-10-18 after this change (zero pageerrors, every row rendered), but the probe asserts no canvas overlay levels, so the drawn Entry/Stop/Target line is still un-asserted by any gate
