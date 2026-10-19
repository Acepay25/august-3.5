# August Trading — the complete flow

Every node names the file and line that implements it. Verified against the tree on
**2026-10-19** (the anchor gate re-measured every citation here and in the stage ledger:
**281 unique anchors verified, 0 unattributed** — plus two quality ceilings, both now
ZERO: 0 citations that land on a comment line (and 3 more cite a comment because the
comment IS the claim, which the gate lists rather than hides) and 0 whose named symbol is not on the cited line (the check’s stated target, now the ceiling) (16 before the arrow list's symbols were paired with the citation on the next line), which
count only what the rule can *see* and therefore under-report: both rules exempt a line
carrying more than one citation, and a sentence that wraps puts its number out of reach of
its symbol, so four copies of one wrong number were fixed by hand after the gate called it
zero. A doubt about a wrapped citation gets re-measured, not waved at the ceiling);
this pass took out accuracy mode with the calibration
dashboards and the settings store that fed it (#17), the `savedAnalyses` store (#21), and
`isDebating` / `activeDebateSpeakers` with the run-failure branch that read them. It follows
the post-mortem, 2D desk floor, Saved-tab and Roles-tab deletions and
stages 20a/20a2/20g/20b/20b-B/20t/20c/20s/20d/20f/20r of the debate
removal, which moved
both chat homes and the scheduler onto one turn executor; if a line moves, fix the
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
    S --> SP["splash leaves #root index.tsx:86-92 — boot-probe.cjs:119 waits for it gone, smoke.spec.ts:54 :140 assert count 0"]
    SP --> APP["App.tsx:189 — surfaces render from App.tsx:2493 down"]
    APP --> US["useSurface hooks/useSurface.ts:15 key, :16 valid set"]
    US --> UR["useSurfaceRouter hooks/useSurfaceRouter.ts:75 openJournal, :101 hash read, :159 serialize"]
    UR --> HASH["utils/appHash.ts:10 — hash and state stay equal"]
    APP --> HD["Header band App.tsx:2467 — guard surface !== 'agents' :2466"]
    HD --> SW["SurfaceSwitch App.tsx:2163 — 4 destinations, list in SurfaceMenuList.tsx:42"]
    APP --> AV["AgentsView gets the same nodes as props App.tsx:2604-2697"]
    SW --> T["Trade · trade-view · App:2493"]
    SW --> J["Journal · journal-view · App:2538"]
    SW --> C["Chat · agents-view · App:2602"]
    SW --> K["Knowledge · learn-view · App:2560"]
    K -.-> AP["Approvals is a TAB of Knowledge — components/learn/LearnView.tsx:64"]
    NR["NavRail — imported App:125, NEVER rendered (see correction 5); its AccountRow export IS, App:2675"]:::dead
    SM["SurfaceMenuList components/shell/SurfaceMenuList.tsx:116 destination rows — only mount passes hideSurfaces (App:2638; pinned by tests/deadControlsGuard.test.ts:147-150)"]:::dead
    classDef dead stroke-dasharray: 5 5,opacity:.5
```

Stored surface values `'chat'`, `'boards'`, `'skills'` all migrate to `'trade'`
([useSurface.ts:24](../hooks/useSurface.ts)). There is no `main.tsx`.

---

## B · One message — two chat homes, ONE turn executor

```mermaid
flowchart TD
    subgraph CHAT["Chat surface (agents)"]
        CB["composer textarea — AgentsView.tsx:538 ref, Enter :1474"] --> D1{"send() :697 branches on what is SELECTED"}
        D1 -->|a bot is selected| BOT["onSendBotTurn components/agents/AgentsView.tsx:732 → App:2617 → useBotMailbox → runBotTurn"]
        D1 -->|no bot| AN["onAnalyze(prompt, images) components/agents/AgentsView.tsx:725 → App:1691 handleRunAnalysisFromChat"]
    end
    subgraph DOCK["Chart AI dock — inside Trade, TradeView.tsx:1115"]
        DC["ChatComposer.tsx:146 :218"] --> D2{"chatTurnRunner.send chatTurnRunner.ts:784 — branches on seats"}
        D2 -->|solo| SO["runSeatTurn called services/trade/chatTurnRunner.ts:929, defined :593"]
        D2 -->|panel, 2+ seats| PN["per-seat services/trade/chatTurnRunner.ts:1078 + createDebateMailbox :1006 + planPanelTurn :1018"]
        D2 -->|Full analysis button| FA["runFullAnalysis components/trade/TradeChatPanel.tsx:547 → the SAME App:1691 wrapper — it holds the session run slot and writes no row"]
    end
    SO --> TT["runToolTurn — services/trade/toolTurn.ts:109"]
    PN --> TT
    TT --> SCDT["streamChatWithDeskTools — toolTurn.ts:133 → DeskToolsService"]
    BOT --> TR["streamQuickResponse — GenericAnalysisService.ts (bots stay chat-only)"]
    AN --> HSM["handleSendMessage — useAnalysisPipeline.ts:495"]
    FA --> HSM
    HSM --> D3{"the debate branch is GONE (19): a send answers through the tool turn hooks/useAnalysisPipeline.ts:1360. runEnsembleEnabled hooks/useAnalysisPipeline.ts:544 survives only as a gate on the hybrid pull :860 — a schedule is claimed earlier, by its own arm hooks/useAnalysisPipeline.ts:750"}
    D3 -->|true| ENS["ensemble branch — section C (ENGINE DELETED; the branch answers with ONE tool turn and no longer refuses over seats)"]
    D3 -->|false: the desk else-arm hooks/useAnalysisPipeline.ts:1377| SPLIT{"a bot thread? :1345"}
    SPLIT -->|yes| TR
    SPLIT -->|no — the desk, with its tools| CST["runChatSurfaceTurn — chatSurfaceTurn.ts:230, tools from CHAT_SURFACE_TOOLS :55, prompt chatSurfaceSystemPrompt :147"]
    CST --> TT
    TR --> LW["live writer — applyCasualStreamUpdate hooks/analysisPipeline/streamThrottlers.ts:28, peel per frame; flush BEFORE the settle write useAnalysisPipeline.ts"]
    CST --> LW
    ENS --> MERGE
    LW --> MERGE["entriesForSession — chatSessions.ts:531, parameter literally named canonical :533"]
    SCDT --> PT["present_trade → runPresentTrade presentTradeTool.ts:75 → the row's card, in EITHER home"]
```

The dock's system prompt is assembled by `systemPromptFor`
([TradeChatPanel.tsx:453](../components/trade/TradeChatPanel.tsx)) from
`TRADE_CHAT_SYSTEM_PROMPT` + skills index + strategies + profile memory + persona.
The Chat surface's prompt is its own now (stage 20s): `chatSurfaceSystemPrompt`
([services/trade/chatSurfaceTurn.ts:147](../services/trade/chatSurfaceTurn.ts))
leads with `CHAT_SURFACE_SYSTEM_PROMPT`
([chatPrompts.ts:40](../constants/prompts/chatPrompts.ts)) — which is
`CASUAL_CHAT_SYSTEM_PROMPT` with a calling mandate and an explicit "no chart
here" bolted on, so the output discipline that fixed the
"Here's a thinking process:" replies survives — then appends the skills index,
the active strategy plans and the profile memory index, each read FRESH per turn
the way the dock reads them. Its skills heading says *what the trader asks
about*, not *this chart*: `buildSkillsIndexForPrompt` took a `where` argument so
the dock's default stays byte-identical. The slugs that actually travelled are
recorded on the row (`Message.injectedSkills`, `types/message.ts:280`), bounded
to the 30 the index prints — a row naming skills the model never saw would be an
audit defect, not an audit trail.

**One entry, both homes.** `handleRunAnalysisFromChat` (App.tsx:1691) is the only
analysis wrapper: the dock passes it as `onRunAnalysis` (App:2485) and the Chat
surface as `onAnalyze` (App:2581). It was two, and `services/trade/analysisTurn.ts`
was deleted (2026-10-17) because a second writer keyed rows with ids no canonical
row could match — that is what made the two homes disagree.

**One executor, two row shapes.** `runToolTurn`
([services/trade/toolTurn.ts:109](../services/trade/toolTurn.ts)) owns the stream,
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
    S1["1 data pull HybridIntelligenceService — still gated on runEnsembleEnabled at hooks/useAnalysisPipeline.ts:940, prefetch gate :860"] --> S3["3 prompt assembly assemblePipelineMemoryContext hooks/useAnalysisPipeline.ts:1021"]
    S3 --> S4["4 one turn: runChatSurfaceTurn services/trade/chatSurfaceTurn.ts:230 → executeDeskTool"]
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
displayed number changed. `runEnsembleEnabled` (hooks/useAnalysisPipeline.ts:544) survives as a switch with
far fewer things to switch between, and `Message.debateTurns` stays as a read-only
legacy field for rows written before the cut — the same rule `modelsUsed` follows.



Why the deletion is safe rather than a loss: the thing section C existed to produce
— a grounded verdict with a journal row — is what a tool-bearing turn produces now
(section B). A `TradeAnalysis` row is no longer written by a send, so the journal's
verdict-shaped rows come from `proposal` cards, and the surviving readers were
re-pointed in 20b-B and 20r rather than left reading a field nothing writes.

**One known residue, stated as measured.** With Hybrid Intelligence on, a human
send still fetches real-time data: the gate is `hooks/useAnalysisPipeline.ts:940`.
What no longer happens is the part that made it worth the round trip — the
injection string it builds (`hooks/useAnalysisPipeline.ts:953`, or `:994` for
preset data) is read afterwards only by `devLog` at
`hooks/useAnalysisPipeline.ts:978`, `:979` and `:1166`. It is
never handed to the turn, because the analyst and moderator prompts it used to ride
are the files stage 19 deleted. The packet object does still have one consumer:
`hooks/useAnalysisPipeline.ts:1021` passes it into
`assemblePipelineMemoryContext` (the packet argument `freshHybridData` at `hooks/useAnalysisPipeline.ts:1024`),
which is where the learning coin and the notebook
slice come from, so dropping the fetch is NOT a byte-preserving cleanup — that is
why it is an owner decision rather than something I removed silently. The loading
state at `hooks/useAnalysisPipeline.ts:863` still flips for a send whose result
only the coin picker reads. Separately, `beginPromptLane` now has zero callers
while the `finally` still calls `endPromptLane()`, so the prompt A/B lane is
starved rather than deleted; re-wiring it onto the tool turn or removing it is
likewise the owner's call.

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
`if (pm.length < 40) return null` on `trade.postMortem` (`services/learning/SkillCraftService.ts:145`). So for every
trade closed after 2026-10-18 the craft leg can only return null; it still answers
for a row that carries a post-mortem from before then. `selfImprovement.ts:73-74`,
`SkillMemoryService` and `DoctrineConsolidationService` read the same dead field.
**Sizing that by grep is a trap, so the recipe is part of the number — and the word
boundary is load-bearing.** Counting the TOKEN, `grep -rE "postMortem" --include="*.ts"
--include="*.tsx" .`, measures **122 lines in 50 files**; counting the field reads needs
`grep -rE "\.postMortem\b" …` and measures **34 lines in 23 files**. Drop the `\b` and the
second figure silently becomes **38**, because four of those lines are a DIFFERENT field:
`postMortemCreatedAt`, the timestamp twin, which is read at
`hooks/analysisPipeline/memoryContext.ts:183` and
`services/learning/DecisionReflectionService.ts:24` and gated on at
`services/ui/AlgorithmicSummaryService.ts:50`. A census without the boundary sweeps a live
name into the dead list, which is the mistake this page keeps re-recording. Earlier drafts of this page asserted
189/57 and 105/~35 — true the day they were taken, untrue from the stage that deleted readers
onward, and unreproducible without the filter, which is how a census becomes a claim nobody can
check. The rest
is a name collision with two live things: the outcome-validation engine
(`PostMortemTPHit` and the `[PostMortemValidation]` log prefixes in
`services/backtesting/BacktestingService.ts`, `PostMortemDataSummary` /
`logPostMortemDataVerification` in `services/ui/AutoCaptureService.ts`), which replays
candles to decide whether a TP or SL really got hit; and the enum member
`'autopilot' | 'postMortem'` on `LoggedTrade.rSource` / `excursionSource`
(`types/trade.ts:185-186`), which names that after-close pass and is still written. A bulk
deletion keyed on the word would remove the validator. Re-measured 2026-10-19; the reader
list and the two decisions that pass has to make up front are in
[the stage ledger](plans/debate-deletion-status.md). Deleting the writer was the owner's
explicit choice, with no replacement. Clearing the readers is NOT simply scheduled work:
the stored-history readers answer only for rows written before 2026-10-18, so whether
that museum stays readable is the owner's open call (#21), and deleting the fields deletes
the history with it.

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
    D -->|has a bot| BR["runBotRoutineTurn useAutomations.ts:346 → botRoutine.ts:80 — prompt, history"]
    BR --> ST["injected stream = streamQuickResponse useAutomations — reuses the bot transport, NOT the debate"]
    D -->|no bot| AT["automation arm BEFORE the mode fork useAnalysisPipeline.ts:1247 → runAutomationTurn automationTurn.ts:161"]
    AT --> PRIV["runs into a private message list, not the open conversation — automationMessagesRef useAnalysisPipeline.ts:352, its notices (a failed tool, a turn that called nothing, a refused plan)"]
    AT --> CAP["plan rationed: MAX_PLANS_PER_RUN services/trade/automationTurn.ts:69 · MAX_PLANS_PER_DAY AutomationService.ts:113"]
    AT --> FAIL["failed tool + refused plan + no-lookup land in notices → row text and a WARNING toast useAutomations.ts:531"]
    GR["useAgentGroups.ts → groupRounds → streamQuickResponse"] --> GV["GroupChatView"]
```

A scheduled run no longer takes the debate path: `runEnsembleEnabled =
isEnsembleEnabled` (useAnalysisPipeline.ts:544) and every remaining flag-gated block also tests `!isAutomationRun`
(`hooks/useAnalysisPipeline.ts:719` gates ON the run, the ensemble-only tip `:783` gates OFF it), so one config has one behaviour whatever the
trader's toggle says. That is what lets stage 19 delete the engine without
taking the scheduler down with it.

What the schedule keeps, and what it gained, are written down rather than
assumed. `tests/automationRouteCharacterization.test.tsx` pins the private
`automation-<id>` thread, the config's own model pick, the continuity read (now
the last three DELIVERED runs — `MAX_HISTORY_RUNS` useAutomations.ts:191, because
the old row-count read spent half its budget on `appendRun`'s 'running' stubs),
and the verdict row. `tests/automationToolTurn.test.ts` pins the two rules a run
with nobody watching needs: a plan refused past the cap answers with an
`ok: false` receipt, and a tool that came back with nothing — or a turn that
called nothing — is stated in the row and changes the toast from success to
warning. Its tool list is the Chat surface's minus the notebook-writers
(`AUTOMATION_UNATTENDED_DENY` automationTurn.ts:55): a recurring job that edits
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

`savedAnalyses` is deleted outright (stage 21): the `UserProfile` field, its state, the
SQLite column read and write section, the backup validation and the `savedAnalysesCount`
preview. The Journal's Saved tab and `SavedAnalyses.tsx` had already gone (`591f735`), and
nothing had written the field since. The `saved_analyses` **table** is still created and
still holds whatever rows history wrote — dropping a table is a migration on the owner's
live journal, which is a different act from deleting the code that read it.

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
| 2 | index.tsx → App | `StrictMode index.tsx:73` › `ErrorBoundary index.tsx:74` › `ToastProvider index.tsx:75` |
| 3 | App → useSurfaceRouter | surface + journalTab + journalOpenNonce |
| 4 | useSurfaceRouter → useSurface | persisted value, key `august_surface_v1 hooks/useSurface.ts:15`, valid set `:16` |
| 5 | useSurfaceRouter → appHash | `#/journal\|market\|settings\|watch` ⇄ state `parseAppHash hooks/useSurfaceRouter.ts:101`, serialize `serializeAppHash hooks/useSurfaceRouter.ts:159` |
| 6 | App → Header | band `App.tsx:2467`, guard `surface App.tsx:2428` (surface !== 'agents') |
| 7 | App → 4 lazy surfaces + the automation modal | each wrapped in `SurfaceSkeleton` — `SurfaceSkeleton App.tsx:2456` TradeView, `SurfaceSkeleton App.tsx:2501` Journal, `SurfaceSkeleton App.tsx:2523` LearnView, `SurfaceSkeleton App.tsx:2539` StrategyStudio, `SurfaceSkeleton App.tsx:2298` AutomationView |
| 8 | Header → SurfaceSwitch | the destination set `App.tsx:2163`, list `SURFACE_ITEMS components/shell/SurfaceMenuList.tsx:42` |
| 9 | App → AgentsView props | same switch + StatusCluster + AccountRow + SurfaceMenuList(hideSurfaces) on `AgentsView App.tsx:2566`, props `App.tsx:2604-2697` |
| 10 | TradeView → TradeChatPanel | the dock, inside Trade `TradeChatPanel components/trade/TradeView.tsx:1115` |
| 11 | AgentsView.send → bot branch | the selected bot answered at `onSendBotTurn components/agents/AgentsView.tsx:732` |
| 12 | bot branch → useBotMailbox | `runUserBotTurn` → `runBotTurn` |
| 13 | AgentsView.send → analysis branch | `onAnalyze components/agents/AgentsView.tsx:722` → `handleRunAnalysisFromChat App.tsx:1691` — the dock's `onRunAnalysis` reaches the SAME wrapper |
| 14 | dock Full analysis → the run slot | `runFullAnalysis components/trade/TradeChatPanel.tsx:547` → `beginRun`/`endRunOwned`; it writes **no row**, the pipeline's own messages are projected into the session |
| 15 | ChatComposer → chatTurnRunner.send | key `Enter components/trade/panels/ChatComposer.tsx:146` / button `:201` → `services/trade/chatTurnRunner.ts:784` |
| 16 | solo → runSeatTurn | `services/trade/chatTurnRunner.ts:929` (definition `runSeatTurn services/trade/chatTurnRunner.ts:593`) |
| 17 | runSeatTurn → the ONE turn executor | `runToolTurn toolTurn.ts:109` → `streamChatWithDeskTools :133` → `DeskToolsService` → `streamChatRequest` |
| 18 | panel → per-seat + mailbox | `runSeatTurn services/trade/chatTurnRunner.ts:1078` · `:1006` · `:1018` |
| 19 | systemPromptFor → prompt | `TRADE_CHAT_SYSTEM_PROMPT` + skills + strategies + profile + persona `systemPromptFor components/trade/TradeChatPanel.tsx:453` = the blocks below, assembled at `TRADE_CHAT_SYSTEM_PROMPT components/trade/TradeChatPanel.tsx:475` |
| 20 | every dock turn → chatStore | `mutate` · `beginRun` |
| 21 | handleSendMessage → what answers | the fork is gone (19): a bot thread streams `useBotThread hooks/useAnalysisPipeline.ts:1329`, anything else runs the tool turn `:1376`; the mode flag `:544` now only gates the hybrid pull `:860` |
| 22 | the casual arms | a bot thread → `streamQuickResponse useAnalysisPipeline.ts:1334` (plain transport); the desk → `runChatSurfaceTurn chatSurfaceTurn.ts:230` → arrow 17. Tier on both via `resolveComposerEffort`; a Full-analysis send also sets `requireTools` |
| 23 | casual frames → Message.text | `applyCasualStreamUpdate hooks/analysisPipeline/streamThrottlers.ts:28`; flush precedes the settle write useAnalysisPipeline.ts |
| 24 | ensemble → the stages that survive | see C — five of the old eight are gone from the call path, and no stage is named in the code, so no line number is claimed |
| 25 | desk tools → what a caller can reach | `executeDeskTool DeskToolsService.ts` (its allow-list is enforced at execution, not only at offer time) |
| 26 | panel tools → chart echo | `executePanelTool chatTurnRunner.ts` → `onToolAction` |
| 27 | automation tick → runAutomation | `runAutomation hooks/useAutomations.ts:403`, forks on `config.botId hooks/useAutomations.ts:423`; the no-bot path takes the pipeline's OWN schedule arm `useAnalysisPipeline.ts:1247` → `runAutomationTurn automationTurn.ts:161`, writing the private list automationMessagesRef useAnalysisPipeline.ts:352, its `notices` (a tool that came back failed, a turn that called nothing, a refused plan) and settling through `onMessage` `useAutomations.ts:531`. Characterized in `tests/automationRouteCharacterization.test.tsx` |
| 28 | bot routine → injected stream | `botRoutine.ts` ← `useAutomations` (reuses 22's bot arm) |
| 29 | rooms → groupRounds | `useAgentGroups` → `streamQuickResponse` |
| 30 | review passes / propose_skill → draft → approval → skill | `draftGates.ts` → `skillApproval` — the post-mortem leg is starved, not deleted (see D) |
| 31 | approved skill → next prompt | `resolveInvokedSkills` — closes into 24's stage 3 |
| 32 | logged trade → memory + autopilot | `useTradeLogging` → `MemoryService`; `proposedTrade` leaves outcome PENDING so the autopilot watches it |
| 33 | App messages + dock entries → one thread | `entriesForSession services/trade/chatSessions.ts:531` |
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
| 46 | `chatSurfaceSystemPrompt` → the desk arm's prompt | `chatSurfaceSystemPrompt services/trade/chatSurfaceTurn.ts:147` — mandate (`CHAT_SURFACE_SYSTEM_PROMPT constants/prompts/chatPrompts.ts:40`) + skills index + active strategies + memory index, read FRESH per turn; the 30 slugs printed are the 30 recorded on the row (`types/message.ts:280`) |
| 47 | prose that never called the tool → the same decision | `planFromProse` (`services/trade/tradeShapedProse.ts`) reads the labelled entry/stop/target out of the row, `parseTradeProposal` decides whether that is a plan, and the chip mints the ONE plan-id shape (`mintPlanId`) before calling `onLogProposedTrade` — so a spoken plan reaches the journal the same way a presented one does |
| 48 | a scheduled run → a rationed plan | `MAX_PLANS_PER_RUN` `MAX_PLANS_PER_RUN services/trade/automationTurn.ts:69` counts inside the turn; `MAX_PLANS_PER_DAY` `MAX_PLANS_PER_DAY services/automation/AutomationService.ts:113` is a local-calendar-day ledger keyed per automation (`:130` read, `:143` spend). Past either, `present_trade` gets an `ok: false` receipt naming the limit — a refusal the MODEL reads, not a card that quietly never appears |
| 49 | a schedule's failure → the row and the toast | the turn's `notices` `notices services/trade/automationTurn.ts:155` — a tool that came back `ok: false` (from `onToolPayload`, which already carries it), a turn that called nothing, a refused plan — are written into the stored text at `useAnalysisPipeline.ts:1247` and handed to `useAutomations.ts:531`, which downgrades the toast from success to warning. Nobody is watching a schedule live; a success toast over a failed lookup is how an unattended run manufactures confidence |
| 50 | a journal row gets its scalp/swing class | `withDetectedTradeType` (`services/analysis/ScalpDetectionService.ts`) is called at the two row-minting sites `withDetectedTradeType hooks/useTradeLogging.ts:305` and `withDetectedTradeType hooks/useTradeLogging.ts:665` — label-only, so no `validityDurationMinutes` appears and the autopilot expiry window never widens. The filter reads it at `components/journal/TradeLog.tsx:535` |
| 51 | a run records its measured cost | `recordToolTurnUsage` (`utils/sessionUsage.ts`) is called by all three turn owners — desk arm `chatSurfaceTurn.ts`, schedule arm `automationTurn.ts`, dock seats `chatTurnRunner.ts` — from the `usage` the wire reported per request. `Knowledge → Session Usage` reads that ledger; stage 19 left it with a reader and no writer. `usageCalls` distinguishes a zero-cost run from a provider that sent no usage frame |
| 52 | a finished analysis says so | `notify()` (`services/infrastructure/notify.ts`) fires when a Full-analysis send settles un-stopped (`notify hooks/useAnalysisPipeline.ts:1443`). Before stage 19 this came from the verdict finalizer; the old channel name CompletionNotifications was a native-only copy of the same thing, and its FILE is gone with stage 19's tranche — the only surviving mention is a comment in `services/infrastructure/notify.ts` — so the app speaks through one notifier |
| 53 | the chart gets its Entry/Stop/Target lines | `latestChartVerdict(messages)` `latestChartVerdict services/trade/chartData.ts:91` is what App hands `TradeView` as `verdict` — the newest row carrying `Message.proposal` (what `present_trade` stamps; `proposal hooks/useAnalysisPipeline.ts:1254`), with `Message.analysis` as the fallback for pre-debate history. Red-proved: the old selector keyed on `ensembleProgress` / >1 `modelsUsed` / `debateTurns` and returned null for every tool-turn row. render-probe PASSED on 2026-10-18 after this change (zero pageerrors, every row rendered), but the probe asserts no canvas overlay levels, so the drawn Entry/Stop/Target line is still un-asserted by any gate

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
   directly); ESLint reports `App.tsx:125:8 'NavRail' is defined but never used`; and
   the code says so out loud — `App.tsx:2445` is the comment reading "The
   NavRail is GONE: its five destination rows were the tab strip this redesign was
   asked to remove". Only the `AccountRow` export is rendered, at `App.tsx:2637`.
   **An earlier pass of this doc asserted the opposite** ("rendered at App.tsx line 2766") and
   the mechanism is worth keeping: `App.tsx:2483` passes `onExpandNavRail={…}` and
   the rail's expand state is very much alive at `App.tsx:657` and `:680-692`, so a grep for `NavRail`
   looks like a mounted component. An `on…` prop is not a render. Withdrawn.
6. **A doc line number is a claim, not a citation — and `npm run
   check-flow-doc-anchors` now refuses it.** Every number in the two flow docs and in
   `AGENTS.md` names its file on the same line, so the gate can check all three: 281 anchors verified, 0
   unattributed, ceiling 0, wired into CI as "Flow docs cite real lines". A bare
   `:NNN` no longer survives a push, and neither does a stale figure quoted from
   the gate's own output: these docs state 281 anchors verified, and the gate
   refuses the merge if that sentence stops matching the scan.
   Two more rules exist as of 2026-10-19, and both were born from a defect in the gate itself
   rather than from a stale doc: a stripped html tag now leaves a SPACE (deleting it spliced the
   bold label onto the citation beside it, and a spliced token matches no file — so those rows
   were skipped, never checked, which is how this page reported green while 12 of its citations
   were unverifiable); and a citation whose file is not in the tree is now REPORTED instead of
   swallowed, measured at 0 in these two docs and 3 in the dated stage ledger, where naming a
   deleted file is history and pointing at its line number is not a live claim.
   A third rule polices the numbers these docs quote from a RECIPE rather than from this
   gate's own output: the two grep censuses in section D, the size of the table in section
   C and the provider-directory deletion list are each re-measured here by running the
   recipe the doc itself names, so a sentence that keeps a stale figure is contradicted by
   the figure its own recipe can no longer produce. That is what the outside review meant
   by "unfalsifiable" — the deletion list is now checked name by name against git, and the
   word "nine" in its sentence has to equal the number of files the doc actually lists.
   Scope and two caveats, all measured on this tree: the rule reads the two flow docs only
   (the stage ledger is dated history, as above); the provider sentences bind only their
   FIRST match each, so a duplicated copy of one of those claims would go unchecked until
   those are widened to match every occurrence; and the history-dependent half prints
   SKIPPED rather than passing on a shallow clone, because CI's checkout is depth 1 and a
   gate that cannot see git history must say so instead of reporting zero findings.
   A fourth rule measures `AGENTS.md` itself, because that file is the first thing an agent
   reads and its counts were still hand-typed. Three sentences are bound. The smoke-test
   figure is counted from the Playwright file it describes (5, from the test declarations in
   `e2e/smoke.spec.ts`). The vitest census line must be internally consistent — 4730 pass +
   11 skip = 4741 tests, 478 passing files + 1 skipped file = 479 files — and its file count
   must equal what `git ls-files tests` actually lists (479). And every step named by the
   `comm -13` asymmetry — `check-flow-doc-anchors`, `skill-approval-probe`, `test`,
   `typecheck`, and `installer-smoke` on the other side — must appear as a WHOLE token in the
   15 lines that print that recipe, so the "test" inside "tests" no longer counts as naming
   the test step. Six control arms plant each of those defects in the real file and require
   the rule to report it — the run prints `0 of 6 control arms failed`, and the arm count
   itself is floored, so deleting an arm from the list fails the build rather than passing
   silently. An absent recipe paragraph, an absent census sentence or an empty git listing
   is itself a finding, so a doc edit cannot escape the census by making the pattern
   unmatchable. What this rule cannot check is the pass/skip split itself: 4730
   and 11 come from vitest's own summary block, and the gate only proves they agree with each
   other and with git's file count — so a suite that changes size still needs `npm run test`
   re-run and the line restated by hand.
   **Coverage asymmetry, measured rather than trusted from prose:** the step runs
   in `ci.yml`, and `release.yml` does NOT run it — nor does it run the
   skill-approval probe, the bare typecheck, or CI's second suite job, while
   `installer-smoke` is the only gate release has and CI lacks. That set
   difference is printed by a `comm -13` over the two workflow files' npm-run
   lines, and `AGENTS.md` now states it there rather than repeating "the same
   static + probe chain". A tag can therefore still publish with a dead line
   number in these docs while CI would reject the same commit; adding the step to
   `release.yml` would close that, and that half changes the publish path, so it
   is recorded rather than done.
   Qualifying the citations that had no symbol
   of their own is what found
   six numbers that were right-shaped and wrong: `runSeatTurn` is called at
   `services/trade/chatTurnRunner.ts:929`, `createDebateMailbox` at
   `services/trade/chatTurnRunner.ts:1006`, `planPanelTurn` at
   `services/trade/chatTurnRunner.ts:1018`, the dock's `send` at
   `services/trade/chatTurnRunner.ts:784`, `runFullAnalysis` at
   `components/trade/TradeChatPanel.tsx:547`, and `MAX_PLANS_PER_RUN` at
   `services/trade/automationTurn.ts:69`. The pass also moved four surface anchors
   that pointed inside a prop list onto the guard that mounts the surface:
   `App.tsx:2493` trade, `App.tsx:2538` journal, `App.tsx:2560` learn,
   `App.tsx:2602` agents, with the header band at `App.tsx:2467`. Counts were
   taken with `grep -c` rather than a truncated listing — the first version of
   correction 5 died by exactly that truncation. Numbers in section C are
   deliberately omitted: they are the lines stage 19 deletes.
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

9. **"Does either gate actually wait for the splash to clear?" — yes, both, measured
   rather than assumed.** `e2e/smoke.spec.ts:54` puts it in the shared `boot()` helper
   and `e2e/smoke.spec.ts:140` asserts it again as "no white screen", both as
   `toHaveCount(0)` on `#splash`; `scripts/boot-probe.cjs:119` blocks on
   `!document.querySelector('#splash')` against the BUILT bundle. What they watch for
   is prose, not code: the boot probe's opening comment, `scripts/boot-probe.cjs:5`,
   records the v1.0.20 TDZ crash as a splash hang. A page that dies before React
   mounts fails both gates, not just one.

10. **The arrow table is 53 rows, and every citation in it resolves — but every one of the 28 rows that cite a file also names the symbol it cites (23 became 28 in this pass), so no cited row is left content-unchecked. The run prints the figure and floors it, so a row rewritten without its symbol stops being coverage silently. The other 25 rows name no file at all — storage keys, wire formats, prose — and a wrong number in one of those is still outside this gate's reach, which is why the sentence says 28/53 rather than 53/53.** An
    outside review probed 66 anchors and could not speak to the rest; the gate now
    resolves all 255 unique anchors on every run, so coverage of the table is no
    longer a matter of which subset a reviewer happened to sample.
11. **"One service replacing nine" is falsifiable, and it is right — counted, not
    asserted.** `git log --diff-filter=D` over `services/providers/` names exactly nine
    provider-client services removed: `AIProviderService` plus the eight per-provider
    clients `geminiService`, `grokNativeService`, `deepseekService`, `groqAlt2Service`,
    `groqNewService`, `openaiService`, `openrouterService` and `zhipuService`. What is
    left in that directory is two clients — `GenericProviderService.ts` and
    `GenericAnalysisService.ts` — plus four helpers, and a search for any remaining
    `class <ProviderName>Service` over `services/` returns nothing. Twenty-four files
    in total have been deleted from that directory; the other fifteen were the
    accuracy-mode services, the debate engine and its types.

## Measured after stage 19: what the deletion did NOT remove

**The prompt layer was the part the deletion never re-measured.** Settings → Prompts had
27 overridable prompts, and `tests/promptsAreWired.test.ts` measured that **16 had
no call site that reads them**: every `debate.*` id, `analysis.families`, and the three
`postmortem.*` ids. The app was handing the trader an editor for text it never sends, and one
moderator fallback still instructed a model to "follow the Accuracy Mode checks" and to emit
a debate envelope no parser can read — Accuracy Mode and the engine were both deleted, the
registry was not. The gate pins the other direction too, because that is the one that breaks
silently: the 11 ids a real call site reads must KEEP it, so a refactor that starves a live
prompt fails the suite (proved by renaming one `getPrompt('analysis.master'…` argument and
watching five arms go red). The 16 are a measured ceiling that ratchets down only — deleting
an entry, with the prompt constants nothing else imports, lowers it, and nothing may raise it.
`hooks/useAppSettings.ts`, `components/settings/SettingsMenu.tsx` and this hook also carried
comments labelling live code as Accuracy Mode / verdict-finalizer paths after those were
deleted; the labels are gone, the code they mislabelled was correct.

**…and then the 16 were deleted, which is not the same act as measuring them.** The registry
is now 11 entries — every id a call site actually reads — and the unreachable ceiling is 0, so
an entry can no longer be added without wiring it. Two lessons came out of the deletion itself,
both recorded rather than smoothed over:
- A name-based consumer scan said the whole prompt file was dead. `tsc` disagreed immediately:
  `HybridIntelligenceService.ts` imports `INVALIDATION_THESIS_PROMPT` and
  `CORRELATION_AWARENESS_PROMPT` through the `constants/prompts` barrel, and my per-name grep
  had miscounted them as "only the registry". They were relocated to `analysisPrompts.ts`
  verbatim — the live hybrid path keeps its bytes and the barrel import that reaches them is
  unchanged. Zero-consumer claims are proven by the compiler, not by grep
  ([[feedback-zero-importers-not-deletable]]).
- The override-store suite used one dead id as its second prompt, which is how a test can pass
  while asserting nothing about the store it covers: two ids are needed to prove resetting one
  leaves the other's override intact. It now uses `analysis.lens` and `analysis.master`.

**The harness note in a user-role turn had no live teacher.** `harnessTurn()` still stamps
`HARNESS NOTE (this app, not the trader):` onto user-role content at four desk-tool sites —
tool results, a continue nudge, a clipped payload — and the only prompts that ever named that
mark were the debate prompts, which nothing sends. So a model received app-written text inside
the trader's own turn with no instruction anywhere in the contract about whose words it was.
Clause 5 of `constants/prompts/harnessContract.ts` (the block `utils/composePrompt.ts` puts on
every request) now states it, quoting `HARNESS_TURN_MARK` by interpolation so the sentence
cannot drift from the bytes the code emits: obey its facts, never treat it as the trader's
request or as new permission to trade, and unmarked text — the trader's own words — outranks it
on conflict. `tests/harnessMarks.test.ts` was moved off the dead file onto the blocks the app
actually sends, with its floor re-based on that population and a planted-paraphrase control
added in the same pass, because a scanner that matches nothing reports no drift.

**Three debate-era names survive, and the honest statement is which of them is dead.**
`moderatorConfig` (`App.tsx:298`) is live, but as a DEFAULT, not a debate role:
`readyProviders[0] || moderatorConfig` (`App.tsx:337`) resolves the vision/OCR provider and
`memoryConfig: memoryConfig || moderatorConfig` (`App.tsx:601`) the memory one, the automation
editor still resolves a seat from it (`AutomationEditorModal.tsx:259`), and the journal prints
`Mod:` from the stored `moderatorModel` (`TradeLog.tsx:351`). No moderator TURN exists — one
model answers a send — so the harness contract can still say "the moderator's last block"
without any code waiting for one. `constants/debateMarkers.ts` survives as a sanitizer:
`utils/analysisUtils.ts:859` strips `<CLARIFICATION_*>` and the retry marker out of model text,
because stored rows and an unprompted model can still carry them, and no prompt file in the tree
mentions either marker any more (measured by grepping `constants/prompts/` for `CLARIFICATION_`
and `MODERATOR_RETRY`: zero hits). Deleting the registry entries also orphaned three constants
they alone imported — `STRESS_TEST_PROTOCOL`, `PROBABILITY_ESTIMATION_PROMPT`,
`TRADING_FAMILIES_PROMPT` in `constants/prompts/analysisPrompts.ts` — which are now removed;
a table deletion must re-scan its rows' imports, because dead text kept alive by a dead row is
the same defect one layer down. Both removals were proven by `tsc` and `vite build`, not by the
name grep that had already misled me once on this pass.

The engine files are gone, and most of the branch with them. What was removed this pass: the seat-completeness refusals ("Your analyst team is incomplete", "Analysts must use different models", "Two debate seats share a model") and the `TEAM_MAX_SEATS` ceiling — only ONE model answers a send (`provider`, `hooks/useAnalysisPipeline.ts:1296` falls back to `enabledProviders[0]`), so those blocked a run over a roster the run never uses, and the ceiling guarded a fan-out that no longer exists. The moderator readiness check survives but now applies only to a scheduled run (`:737`), because a schedule really does take its seat from that config; the human-send version of it refused a click over an unused pick. `runEnsembleEnabled` (`:567`) is now down to `buildEnsembleAnalysts` and the "include a coin" tip; `isDebating` and `activeDebateSpeakers` are deleted outright — every writer set a literal `false`, so the one branch that read the flag could not run.


The user-visible consequence, now FIXED: the chart used to pick its verdict row by the DEBATE shapes (`ensembleProgress`, >1 `modelsUsed`, `debateTurns`) and passed `verdict={verdictMessage?.analysis}` — while nothing writes `Message.analysis` for a new run any more. `verdictFinalizer` was the writer; a tool turn answers with a `TradeProposal` in the tool payload (`services/trade/presentTradeTool.ts`, `proposedTrade.ts`, `tradeShapedProse.ts`). Reader without a writer, the third time in this stage (session usage, the completion notice). Fixed by `latestChartVerdict` in `services/trade/chartData.ts` (`App.tsx:1251`, passed to the chart at `:2517`): it keys on the settled proposal through the existing `buildProposedTradeAnalysis` and keeps `analysis` as the fallback for old rows; `tests/chartVerdictSource.test.ts` pins the proposal path, the fallback, the preference when a row carries both, the symbol match through `verdictLevels`, and the App wiring. render-probe PASSED on 2026-10-18 after this change (zero pageerrors, every row rendered), but the probe asserts no canvas overlay levels, so the drawn Entry/Stop/Target line is still un-asserted by any gate

