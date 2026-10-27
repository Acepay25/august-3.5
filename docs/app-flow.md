# August Trading — the complete flow

Every node names the file and line that implements it. Verified against the tree on
**2026-10-25** (the anchor gate re-measured every citation here and in the stage ledger:
**458 unique anchors verified, 0 unattributed** — plus two quality ceilings, both now
ZERO: 0 citations that land on a comment line (and 5 more cite a comment because the
comment IS the claim, which the gate lists rather than hides) and 0 whose named symbol is not on the cited line (the check’s stated target, now the ceiling) (16 before the arrow list's symbols were paired with the citation on the next line), which
count only what the rule can *see* and therefore under-report: both rules exempt a line
carrying more than one citation, and a sentence that wraps puts its number out of reach of
its symbol, so four copies of one wrong number were fixed by hand after the gate called it
zero. This pass re-checked every multi-citation line against the source by hand and moved 56
citation numbers, 40 of them on a line the gate cannot see. A doubt about a wrapped citation
gets re-measured, not waved at the ceiling);
this pass deleted the scheduled-automation feature (section E): the Automations surface, its
card feed, the editor modal, the cron tick, the boot catch-up planner, the failure breaker, the
plan ration and the bot-scoped routine executor, plus the pipeline’s private `automation` run
mode. It also took out accuracy mode with the calibration
dashboards and the settings store that fed it (#17), the `savedAnalyses` store (#21), and
`isDebating` / `activeDebateSpeakers` with the run-failure branch that read them. It follows
the post-mortem, 2D desk floor, Saved-tab and Roles-tab deletions and
stages 20a/20a2/20g/20b/20b-B/20t/20c/20s/20d/20f/20r of the debate
removal, which moved
both chat homes onto one turn executor; if a line moves, fix the
line rather than deleting the claim.

Dotted nodes exist in the code but are **never mounted** by the running app.

Companion docs: [learning-loop-map.md](learning-loop-map.md) covers section D in more
depth, [ui-doctrine.md](ui-doctrine.md) governs the shell in sections A and B.
The stage ledger is [docs/plans/debate-deletion-status.md](plans/debate-deletion-status.md);
sections B and C moved again when stage 19 deleted the engine.

**Latest pass (2026-10-21).** E-52 added the activity status line, the answer's
tier, one disclosure, the settled tool trail, the one jump control and the agent
detail reader; E-53 made the wire audit visible; E-54 gave the answer its reading
voice; E-55 moved the work card, skills catalogue and memory surfaces onto the
reference's grammar and added the reading serif (that FACE is gone — the owner's
ruling of 2026-10-22 kept the reading ROLE and pointed it at the UI stack). The same period added one
context window resolved once, automatic compaction with the last user turn
pinned, a per-window output budget and an honest refusal when nothing fits, the
provider's real cause chain, and a failure row in both homes. Section G is the
new detailed inventory of memory, skills, tools and the learning loop; the stage
19 history below is kept as history, not as the current call path.

---

## A · Boot → shell → a surface

```mermaid
flowchart TD
    H["index.html"] --> I["index.tsx — error handlers first :28 :48"]
    I --> S["StrictMode › ErrorBoundary › ToastProvider › App :73-79"]
    S --> SP["splash leaves #root index.tsx:91-96 — boot-probe.cjs:119 waits for it gone"]
    SP --> APP["App.tsx:215 — surfaces render from App.tsx:2397 down"]
    APP --> US["useSurface hooks/useSurface.ts:15 key, :16 valid set"]
    US --> UR["useSurfaceRouter hooks/useSurfaceRouter.ts:75 openJournal, :101 hash read, :159 serialize"]
    UR --> HASH["utils/appHash.ts:10 — hash and state stay equal"]
    APP --> HD["Header band App.tsx:2397 — guard surface !== 'agents' :2392"]
    HD --> SW["SurfaceSwitch App.tsx:2163 — 4 destinations, list in SurfaceMenuList.tsx:44"]
    APP --> AV["AgentsView gets the same nodes as props App.tsx:2522-2614"]
    SW --> T["Trade · trade-view · App:2536"]
    SW --> J["Journal · journal-view · App:2505"]
    SW --> C["Chat · agents-view · App:2418"]
    SW --> K["Knowledge · learn-view · App:2376"]
    K -.-> AP["Approvals is a TAB of Knowledge — components/learn/LearnView.tsx:64"]
    NR["NavRail — imported App:119, NEVER rendered (see correction 5); its AccountRow export IS, App:2584; NAV_RAIL_AUTO_COLLAPSE_PX and NAV_RAIL_EXPANDED_PX are live too"]:::dead
    SM["SurfaceMenuList components/shell/SurfaceMenuList.tsx:135 destination rows — only mount passes hideSurfaces (App:2462)"]:::dead
    classDef dead stroke-dasharray: 5 5,opacity:.5
```

Stored surface values `'chat'`, `'boards'`, `'skills'` all migrate to `'trade'`
([useSurface.ts:24](../hooks/useSurface.ts)). There is no `main.tsx`.

---

## B · One message — two chat homes, ONE turn executor

```mermaid
flowchart TD
    subgraph CHAT["Chat surface (agents)"]
        CB["composer textarea — AgentsView.tsx:593 ref, Enter :1522"] --> D1{"send() :754 branches on what is SELECTED"}
        D1 -->|a bot is selected| BOT["onSendBotTurn components/agents/AgentsView.tsx:812 → App:2534 → useBotMailbox → runBotTurn"]
        D1 -->|no bot| AN["onAnalyze(prompt, images) components/agents/AgentsView.tsx:802 → App:1586 handleRunAnalysisFromChat"]
    end
    subgraph DOCK["Chart AI dock — inside Trade, TradeView.tsx:1140"]
        DC["ChatComposer.tsx:156 :226"] --> D2{"chatTurnRunner.send chatTurnRunner.ts:860 — branches on seats"}
        D2 -->|solo| SO["runSeatTurn called services/trade/chatTurnRunner.ts:1039, defined :616"]
        D2 -->|panel, 2+ seats| PN["per-seat services/trade/chatTurnRunner.ts:1229 + createDebateMailbox :1156 + planPanelTurn :1167"]
        D2 -->|Full analysis button| FA["runFullAnalysis components/trade/TradeChatPanel.tsx:586 → the SAME App:1586 wrapper — it holds the session run slot and writes no row"]
    end
    SO --> TT["runToolTurn — services/trade/toolTurn.ts:136"]
    PN --> TT
    TT --> SCDT["streamChatWithDeskTools — toolTurn.ts:174 → DeskToolsService"]
    BOT --> TR["streamQuickResponse — GenericAnalysisService.ts (bots stay chat-only)"]
    AN --> HSM["handleSendMessage — useAnalysisPipeline.ts:507"]
    FA --> HSM
    HSM --> D3{"the debate branch is GONE (19): a send answers through the tool turn hooks/useAnalysisPipeline.ts:1161. the ensemble mode and the seat roster it fed were deleted by owner ruling (2026-10-19); the scheduler's own arm was deleted on 2026-10-24"}
    D3 -->|true| ENS["ensemble branch — section C (ENGINE DELETED; the branch answers with ONE tool turn and no longer refuses over seats)"]
    D3 -->|false: the desk else-arm hooks/useAnalysisPipeline.ts:1161| SPLIT{"a bot thread? :1083"}
    SPLIT -->|yes| TR
    SPLIT -->|no — the desk, with its tools| CST["runChatSurfaceTurn — chatSurfaceTurn.ts:301, tools from CHAT_SURFACE_TOOLS :63, prompt chatSurfaceSystemPrompt :223"]
    CST --> TT
    TR --> LW["live writer — applyCasualStreamUpdate hooks/analysisPipeline/streamThrottlers.ts:28, peel per frame; flush BEFORE the settle write useAnalysisPipeline.ts"]
    CST --> LW
    ENS --> MERGE
    LW --> MERGE["entriesForSession — chatSessions.ts:593, parameter literally named canonical :595"]
    SCDT --> PT["present_trade → runPresentTrade presentTradeTool.ts:78 → the row's card, in EITHER home"]
```

The dock's system prompt is assembled by `systemPromptFor`
([TradeChatPanel.tsx:438](../components/trade/TradeChatPanel.tsx)) from
`TRADE_CHAT_SYSTEM_PROMPT` + skills index + strategies + profile memory + persona.
The Chat surface's prompt is its own now (stage 20s): `chatSurfaceSystemPrompt`
([services/trade/chatSurfaceTurn.ts:204](../services/trade/chatSurfaceTurn.ts))
leads with `CHAT_SURFACE_SYSTEM_PROMPT`
([chatPrompts.ts:40](../constants/prompts/chatPrompts.ts)) — which is
`CASUAL_CHAT_SYSTEM_PROMPT` with a calling mandate and an explicit "no chart
here" bolted on, so the output discipline that fixed the
"Here's a thinking process:" replies survives — then appends the skills index,
the active strategy plans and the profile memory index, each read FRESH per turn
the way the dock reads them. Its skills heading says *what the trader asks
about*, not *this chart*: `buildSkillsIndexForPrompt` took a `where` argument so
the dock's default stays byte-identical. The slugs that actually travelled are
recorded on the row (`Message.injectedSkills`, `types/message.ts:326`), bounded
to the 30 the index prints — a row naming skills the model never saw would be an
audit defect, not an audit trail.

**One entry, both homes.** `handleRunAnalysisFromChat` (App.tsx:1586) is the only
analysis wrapper: the dock passes it as `onRunAnalysis` (App:2427) and the Chat
surface as `onAnalyze` (App:2523). It was two, and `services/trade/analysisTurn.ts`
was deleted (2026-10-17) because a second writer keyed rows with ids no canonical
row could match — that is what made the two homes disagree.

**One executor, two row shapes.** `runToolTurn`
([services/trade/toolTurn.ts:136](../services/trade/toolTurn.ts)) owns the stream,
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
by ruling: a bot thread keeps the plain transport, and `useBotMailbox` and
`groupRounds` are not on the tool turn (the third name here, `botRoutine`, was the routine
executor and went with the automations on 2026-10-24).

The card a presented plan draws lives on whichever row presented it — the dock's
entry or `Message.proposal` — and the logged/dismissed disposition is one module
map for both ([proposalDisposition.ts:22](../services/trade/proposalDisposition.ts)),
keyed by the row id `entriesForSession` already shares.
**One thread, GENERATING in both homes.** A turn started on either surface is
visibly running on the other, and switching mid-answer does not restart,
duplicate or hide it.

- Chat → dock: `liveEntryFromMessage` (`services/trade/chatSessions.ts:498`)
  carries `Message.isStreaming` onto the projected row, so a Chat-surface run
  keeps its activity line, its open work card and its live text after the trader
  hops to the chart. Without that one field the dock showed a FINISHED answer
  that the next token then rewrote under the trader's eyes.
- dock → Chat: `startEntryMirror`
  ([chatTurnMirror.ts:88](../services/trade/chatTurnMirror.ts)) copies the
  dock's live entry into the conversation under the SAME id the pane is already
  painting, throttled on a TIMER and flushed on stop. Never
  `requestAnimationFrame`: the generating surface is the one that is HIDDEN
  while the trader reads the other, and a rAF writer fires zero times there —
  the same defect `FadingText` records.
- The thread exists before the first write. A solo dock turn resolves its
  conversation at send (`turnConversationId`, `services/trade/chatTurnRunner.ts:889`)
  through `ensureDockTurnConversation` (`App.tsx:1740`), handed to the runner as
  `onSyncConversation`, which adopts the unused blank conversation or mints one
  and makes it active — a session that never had a thread used to keep its
  transcript entirely to itself.
- Either home can stop it. The dock registers its controller under the
  CONVERSATION id as well as its session id, `cancelRunAt`
  (`hooks/useAnalysisPipeline.ts:493`) falls back to that registry when it owns
  no pipeline run, and `AgentsView` folds `snap.conversationRunning` into its
  busy flag (`components/agents/AgentsView.tsx:525`) so the composer never
  offers Send over an answer that is arriving. The dock does the same with
  `conversationBusy` (`components/trade/TradeChatPanel.tsx:405`).


### B.1 The row, the work, the wire and the control

The two homes render one conversation furniture. `ChatTranscriptRow` is the Chat
surface's row; `ChatTranscriptList` is the dock's; both mount
`ChatWorkTimeline`, which draws the work as one expandable line plus rows:
`AnalyzedRow` is the live activity line (`turnActivityLabel`) and the settled
command count — `Ran N commands`, counted by `pairToolRows` so the headline and
the rows beneath it cannot disagree about how many calls the turn ran —
`ToolActivityRow`/`pairToolRows` renders one paired call→result row per call
(never two lines per call), and `Disclosure` is
the ONE native `<details>` used by the thinking row, tool output and Settings'
Advanced section. The answer itself is `AnswerBody` — its own
reading role, `font-reading` — while the trader's own bubble stays in the
interface chrome. The role is not a face any more: since the owner's ruling of
2026-10-22 no serif ships, and `--font-reading` and `--font-serif` both resolve
to the UI stack.

The transcript data has two shapes on purpose. `Message.toolEvents` + `toolIds`
are the settled trail and the payload ids for each line; `liveToolEvents` is the
capped, newline-joined live feed a filling bubble shows. The Chat surface writes
the former through `streamChatWithDeskTools`; `liveEntryFromMessage` projects a
Message onto the dock's `LiveEntry` without losing the trail. A failed turn is
not an answer: `ChatFailureRow` renders `Message.error` in both homes, and a
turn's `wireAudit` says what route the transport applied — or why it applied
none — through `WireAuditRow`. `JumpToLatestFab` is the one return control, at
the one `JUMP_AWAY_PX` threshold; it shows an indeterminate ring while a turn
runs, never a percentage.

The model control is likewise one control: `ModelChip`'s trigger names
`Provider · Model · tier`, `ModelMenu` is the one panel (provider, model, effort
slider, stars, free-only, discovery refresh), and `effortScale` is the one
six-stop ladder. `Ctrl/Cmd+Shift+E` steps the active session's tier through
`nextEffortTier`; `effortDial` is the refcount that keeps the chord legal only
while a composer is actually showing the dial. The resolved tier and the wire
audit ride out of the executor on the outcome (`ToolTurnOutcome.effort` /
`wireAudit`) and are recorded on the row (`RunStats.effort`,
`Message.wireAudit`), so the request, the stored entry and the row cannot claim
different facts.

**The wording gate is gone (stage 20c).** `isChartAnalysisRequested` used to test
the prompt for `LIVE MARKET` / `STRATEGY` / `ANALYZE` / `CHART` / `SETUP` — plus the
image and update facts — and `useAnalysisPipeline.ts` branched on it. It was already
a dead decision for a human send: the predicate was ANDed with `runEnsembleEnabled`
and `isEnsembleEnabled` appeared on both sides, so with the toggle on every send
ran the pipeline whatever it said and with it off no wording could make one. The
one route words controlled was the scheduler's, contradicting the flag's own
comment that automations always run the pipeline: the same schedule answered
casually when its prompt read "outlook" and fully when it read "setup". That arm
is gone — the scheduled-automation feature was deleted on 2026-10-24 (section E) —
so the mode alone decides what a human send does, and nothing answers a model
without a person pressing send. Consequences
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
    S1["1 preset packet only — options.presetHybridData hooks/useAnalysisPipeline.ts:870; a seat pulls the tape on demand through its desk tools"] --> S3["3 prompt assembly assemblePipelineMemoryContext hooks/useAnalysisPipeline.ts:939"]
    S3 --> S4["4 one turn: runChatSurfaceTurn services/trade/chatSurfaceTurn.ts:301 → executeDeskTool"]
    S4 -->|a seat calls| PT["present_trade → runPresentTrade → plan + gate stamp"]
    PT --> JR["journal row — logTradeWithFeedback useTradeLogging.ts"]
    S4 --> ANS["the answer is the prose beside the card"]
```

### C.1 What the turn does now: context, compaction, retries, transcript

The request is assembled once: the surface's mandate, the persona/skills index,
active strategies, the profile/global/pattern memory slices, the conversation
history and the current line. Before it goes on the wire:

1. `resolveContextWindow` (`utils/contextWindow.ts:136`) picks the window from
   the user override, a provider-stated limit measured from a previous
   rejection, the model's discovered window, or the 1,000,000 default
. `outputTokenBudget` and `promptTokenCeiling` size
   the response and the prompt against that one number.
2. `compactForWire` (`services/providers/contextCompact.ts:343`) fits the array:
   old tool payloads first, then old prose, then whole tool rounds; a
   `tool_calls` block always stays with its replies, and the last user turn is
   pinned by `compactMessages`. The notice says what was cut, including
   `CONTEXT FULL` when nothing could be cut.
3. `runDeskToolLoop` (`services/analysis/DeskToolsService.ts:4405`) bounds the
   turn: at most `MAX_DESK_TOOL_ROUNDS`, each round at
   `DESK_ROUND_MAX_TOKENS` and under `DESK_TURN_BUDGET_MS`;
   `budgetToolContent` clips one result, and `clearDeskToolCache`
 makes the cache per-turn.
4. A round cut off by its own thinking is re-asked once at a stepped-down tier
   (`stepEffortDown`); a turn that produced nothing gets the same step-down.
   `withTruncationWindow` (`utils/finishReason.ts:188`) records the wire's own
   stop signal and `truncationNotice` says the answer may be cut.
5. The transport retries transient failures with backoff, caps each attempt at
   its timeout, and recovers once from a context-length rejection: it reads the
   provider's stated limit, compacts to it, remembers it as measured, and retries
   (`sendChatRequest`/`contextRecoveryMessages`,
   `sendChatRequest` at `services/providers/GenericProviderService.ts:1375`,
   `contextRecoveryMessages` at `GenericProviderService.ts:1406`, `streamChatRequest` at
   `GenericProviderService.ts:1884`). The provider's real cause chain is what
   `toFriendlyProviderError` preserves; a failed turn becomes
   `Message.error` and a `ChatFailureRow`, not an answer.
6. The wire's per-call decision is `WireAuditEntry` — route, effort, applied and
   reason — collected by `runToolTurn` and rendered by `WireAuditRow`. It is how
   the row distinguishes "the model did not think" from "the model was never
   asked to".

The answer is the prose beside the work card; `present_trade`
(`services/trade/presentTradeTool.ts:78`) writes the plan and starts the gate
scan, and the journal write is `logTradeWithFeedback`
(`hooks/useTradeLogging.ts:274`). A model that presents a plan without a market
read is still a plan — the Full-analysis notice and the journal guard say so
rather than silently treating the card as checked.

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
displayed number changed. the ensemble flag and the seat roster it fed are gone (owner ruling, 2026-10-19); the
mode fork they switched was already deleted, so there is no switch left to describe, and `Message.debateTurns` stays as a read-only
legacy field for rows written before the cut — the same rule `modelsUsed` follows.



Why the deletion is safe rather than a loss: the thing section C existed to produce
— a grounded verdict with a journal row — is what a tool-bearing turn produces now
(section B). A `TradeAnalysis` row is no longer written by a send, so the journal's
verdict-shaped rows come from `proposal` cards, and the surviving readers were
re-pointed in 20b-B and 20r rather than left reading a field nothing writes.

**The residue is closed, not restated.** With Hybrid Intelligence on, a human send
does not fetch real-time data — the seat calls `get_market_packet` when it needs
the tape. The only packet this path still accepts is one an upstream capture already
fetched (`presetHybridData hooks/useAnalysisPipeline.ts:870`), and it reaches the
prompt through `freshHybridData` into
`assemblePipelineMemoryContext hooks/useAnalysisPipeline.ts:939`. The dead
`hybridDataInjection` string — built, then read only by a `devLog` — went with the
scheduled run that was its only producer. It is
never handed to the turn, because the analyst and moderator prompts it used to ride
are the files stage 19 deleted. The packet object does still have one consumer:
`hooks/useAnalysisPipeline.ts:939` passes it into
`assemblePipelineMemoryContext` (the packet argument `freshHybridData` at `hooks/useAnalysisPipeline.ts:950`),
which is where the learning coin and the notebook
slice come from, so dropping the fetch is NOT a byte-preserving cleanup — that is
why it is an owner decision rather than something I removed silently. The loading
state at `hooks/useAnalysisPipeline.ts:873` still flips for a send whose result
only the coin picker reads. Separately, the prompt A/B lane is a **per-run value**:
`beginPromptLane` (`services/infrastructure/PromptOverrideService.ts:34`) returns
`'live' | 'control'` and the caller threads it into `getPrompt` and
`promptCorpusVersion` — E-57 §3 deleted the `let controlLane` singleton and the
`endPromptLane()` in the `finally`, because two runs deciding at once each answered
with the other's lane and a run that threw reset the flag out from under a run still
using it. What is still open, and registered: **no live turn path resolves an
override at all.** Every `getPrompt` call site sits on the analysis/skill-craft
surfaces reachable from `SkillEvalScheduler`, and the desk turn that answers this
surface calls none — so the pair currently differs in what it RECORDS, not in what
it SENDS. Wiring it changes the bytes a trader's model sees; deleting the dial
removes a control that has never done what it names. Either is an owner call, and
neither is a deletion of the lane bookkeeping.

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
it** — the distinction matters because the code still looks alive. Nothing wrote
the field for a trade closed after 2026-10-18, while `craftSkillFromPostMortem`
([services/learning/SkillCraftService.ts:140](../services/learning/SkillCraftService.ts))
was still called from `botLearning.ts:234`, and its first guard is
`if (pm.length < 40) return null` on `trade.postMortem` (`services/learning/SkillCraftService.ts:145`). So for every
trade closed after 2026-10-18 the craft leg could only return null; it still answered
for a row that carries a post-mortem from before then. `selfImprovement.ts:73-74`,
`SkillMemoryService` and `DoctrineConsolidationService` read the same empty field.
**E-57 §1 gave the leg its writer back** — `services/learning/settlementReflection.ts`
runs ONE bounded call (`TASK_BUDGETS.postMortem`, tier `postMortem`, called from
`hooks/useTradeLogging.ts:549` and awaited BEFORE `syncClosedTradeToNotebook`, because
that function marks the trade settled and then folds the diary entry and the IF/THEN
draft out of the row's post-mortem text), and it writes nothing on a failure, a decline
or a malformed answer, so a gap stays a gap and never becomes an invented lesson. A
trader's own note always wins; the row now also says which model wrote the note
(`types/trade.ts:97`).
**Sizing that by grep is a trap, so the recipe is part of the number — and the word
boundary is load-bearing.** Counting the TOKEN, `grep -rE "postMortem" --include="*.ts"
--include="*.tsx" .`, measures **91 lines in 29 files**; counting the field reads needs
`grep -rE "\.postMortem\b" …` and measures **39 lines in 23 files**. Drop the `\b` and the
second figure silently becomes **43**, because four of those lines are a DIFFERENT field:
`postMortemCreatedAt`, the timestamp twin (read at
`hooks/analysisPipeline/memoryContext.ts:186` and
`services/learning/DecisionReflectionService.ts:24`, and gated at
`services/ui/AlgorithmicSummaryService.ts:57` on `postMortemCreatedAt`), and the new `postMortemModel`, the
provenance twin. A census without the boundary sweeps a live
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
(`types/trade.ts:214`), which names that after-close pass and is still written. A bulk
deletion keyed on the word would remove the validator. Re-measured 2026-10-19; the reader
list and the two decisions that pass has to make up front are in
[the stage ledger](plans/debate-deletion-status.md). Deleting the writer was the owner's
explicit choice, with no replacement. Clearing the readers is NOT simply scheduled work:
the stored-history readers answer only for rows written before 2026-10-18, so whether
that museum stays readable is the owner's open call (#21), and deleting the fields deletes
the history with it.

The chain from `draftGates` to the injected skill is unchanged and still runs; it
starts at the review passes, at the chat's `propose_skill` tool, and since E-57 §1
at a settled position again — the reflection's IF/THEN line is what
`ingestIfThenFromTrade` turns into a draft awaiting the trader's approval.

Corollary that is easy to miss: `GlobalMemory.aiPatternMemory` and
`insightKnowledgeBase` are **frozen stores** (see G), and
`MistakePatternService` / `JobQueueService`, which warned about a recurring setup
before the next entry, no longer exist.

---

## E · Autonomy — rooms, alerts, one detached evaluator

```mermaid
flowchart TD
    EVAL["due skill eval — buildDefaultRunner services/learning/SkillEvalScheduler.ts:180"] --> VERD["verdict on the skill file + the Activity drawer's audit row"]
    GR["useAgentGroups.ts → groupRounds → streamQuickResponse"] --> GV["GroupChatView"]
```

**The scheduled-automation feature is deleted (owner request, 2026-10-24).** Out
went the Automations surface and its card feed, the editor modal, the cron tick and
boot catch-up, the per-run and per-day plan ration, the three-failure breaker, the
bot-scoped routine executor, and the pipeline's private-message `automation` run
mode. Nothing in the app now answers a model on a timer: every turn begins with a
person pressing send, a bot mailbox delivery, or a room round.

What survives is the one unattended caller that is not a conversation — the
detached skill evaluator, reached from the trade-sync path
(`runDueSkillEvalWithDefaultRunner services/learning/SkillMemoryService.ts:4082`)
and from the skill detail's own run. Because nobody is watching it, it runs on
`DETACHED_EVAL_TOOLS` (`services/trade/unattendedTools.ts:27`): the Chat surface's
set minus every notebook-writer and minus `present_trade` / `decline_trade`, so a detached
judgement can read the tape and cannot act on the journal. The deny list
in that module is the single owner of "not without a human".

Stored automation data was left alone deliberately: `automations_v1_`,
`automation_runs_v1_` and `automation_last_seen_v1_` stay allow-listed for restore
(`services/infrastructure/ExportService.ts:775`) so a backup taken before the
removal still comes back without dropping keys it names.

**The Agents surface is a launch list, not a roster form.** A row says what the
agent is for (its title, or the first line of its description); `AgentDetailCard`
is the read-only detail — model, notebook scope, standing instructions and the
last trace — mounted through the one `DetailModal`, while editing stays in the
roster dialog. The list is ordered with the built-in shelf first and the user's
own agents after it; nothing is seeded.

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

### F.1 The window, the compactor and the error

The provider layer is four formats (`types/provider.ts`) behind one policy
(`shared/providerRequestPolicy.cjs`): thinking gates, temperature, host rules and
the redirect walker are shared by the renderer, the Vite dev proxy and Electron
main. `GenericProviderService` is the one transport: `sendChatRequest`
(`GenericProviderService.ts:1563`), `sendChatTurn` (`:1563`) and
`streamChatRequest` all use the same retry/timeout wrapper. A
context-length rejection is the one error that teaches the app a fact: the
provider states its limit, `contextRecoveryMessages` compacts to that
limit and retries once, and `recordMeasuredContextWindow`
(`utils/contextWindow.ts:107`) remembers it for the next turn. On the tool path, a request that
cannot hold the prompt plus a reply is refused before it is sent, with the
measured reason, rather than sent as an impossible `max_tokens`.

`finishReason` (`utils/finishReason.ts:81`) normalizes the four providers' stop
signals; `withTruncationWindow` is the per-run bracket, and
`truncationNotice` is the sentence a cut-off answer carries. The
reasoning route is decided by `buildReasoningPatch`
(`services/providers/reasoningControls.ts:271`) from the resolved tier
(`resolveComposerEffort`,), and the answer's row can show that decision via
`WireAuditEntry` (B.1). The model's context window is not re-derived from its
name: `resolveContextWindow` is the one resolution, and the Settings provider
editor prints the source that won (user, measured, model-reported or assumed).

---

## G · Memory, skills, tools, and the learning loop

```mermaid
flowchart TD
    MSG["App messages — canonical, useConversations, no cap (owner ruling 2026-10-27)"] --> MER["entriesForSession chatSessions.ts:593 — App rows, dock entries overwrite by id"]
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

### G.1 The notebook is the memory

The notebook is one per-user blob at `memory_files_v1_<user>`
(`services/learning/MemoryFilesService.ts:31`). Its folders are fixed by
`DEFAULT_FOLDERS` (`services/learning/MemoryFilesService.ts:113`): `profile`, `trader-diary`,
`market-conditions`, `rules`, `skills`, `bots`, `settled-beliefs`, `distilled`
and `strategies`. The folder is the write scope, not the model's choice:

| folder | owner / writer | what the next prompt may see |
|---|---|---|
| `profile` | `syncProfileMemoryUnlocked` (`MemoryFilesService.ts:1107`) from the saved profile | the profile memory index (`buildProfileMemoryIndex`, `profileMemory.ts:361`) |
| `trader-diary` | the trader and diary appends | free prose; not a generated index |
| `rules` | the seed `risk-rules.md` plus trader edits | `riskRulesBlock`; the model treats each line as binding |
| `skills` | approved skill files | the skills index / recall tool (G.3) |
| `bots` | `botLearning` / the bot's own scope | bot memory, isolated or shared |
| `settled-beliefs` | doctrine/consolidation | `settledBeliefsBlock` (`settledBeliefs.ts:227`) |
| `distilled` | distillation passes | `loadDistilledFacts` (`distilledMemory.ts:202`) |
| `strategies` | `StrategyStore` and the `propose_strategy` tool | the active strategy block — and the uploaded BOOKS ride the same section (`activeStrategiesBlock`) |

A model note is appended through `writeModelNote` (`MemoryFilesService.ts:1621`),
which rejects any file the harness regenerates wholesale — a model append there
would be silently clobbered by the next rebuild. User edits and model amendments
go through the notebook UI / amendment inbox instead (`MemoryTopicsCard`,
`MemoryFilesManager`, `proposeTopicEdit`), so a model cannot quietly rewrite the
trader's source text.

**Injection is a bounded slice, not the notebook.** `getMemoryFilesContext`
(`MemoryRetrievalService.ts:848`) assembles the blocks for a turn; its stage
budgets come from `stageBudgetChars` (`MemoryRetrievalService.ts:87`) and the
`SKILL_INDEX_LINE_MAX`/`SKILL_BLOCK_MAX` limits. The notebook
is the source; the prompt receives the subset the retrieval stage selects. The
recall tool (`handleRecallTool`, `MemoryRetrievalService.ts:1033`) is the
on-demand path when the slice was not enough.

**The notebook can refuse growth.** `utils/memoryBudget.ts:38` is the 2 MiB hard
limit, the 1.5 MiB cleanup trigger and the 1 MiB soft limit. `notebookPressureAllows`
(`MemoryFilesService.ts:657`) refuses new files at the trigger and all growth at
the hard cap; it never evicts, because nothing in that store is regenerable. A
failed write is not swallowed: `getNotebookWriteFailure`
(`MemoryFilesService.ts:588`) records quota vs error, bytes and streak, and the
Health tab reads it. Backup/export carries the notebook with the profile
(`createBackup`, `BackupService.ts:116`; export namespaces in
`ExportService.ts:299`).

### G.2 Profile, global and pattern memory

Three derived memories sit beside the notebook:

- **Profile memory** — `syncProfileMemory` copies the saved profile into the
  `profile` folder, and `buildProfileMemoryIndex` (`profileMemory.ts:361`) renders
  the index injected into a turn.
- **Global memory** — `buildGlobalMemoryIndex` (`utils/memoryUtils.ts:19`) renders
  `familyPerformance`, `userPreferences`, `globalCorrections` and the frozen
  `aiPatternMemory`/`insightKnowledgeBase`. The two frozen fields keep their
  readers and bytes; nothing grows them since `03fc0d5`.
- **Pattern memory** — `findRelevantTrades` (`PatternMemorySynthesisService.ts:301`)
  is live at three sites (`services/learning/EvidencePackService.ts:264`,
  `services/learning/MemoryGraph.ts:202`,
  `services/learning/MemoryRetrievalService.ts:695`).
  `calculatePnlR` (`PatternMemorySynthesisService.ts:249`) uses the
  canonical nearest target with a corrected exit before estimating.
  **The gate half is dead on every trade path.**
  `generateSynthesizedPromptInjection` (`PatternMemorySynthesisService.ts:589`) has
  **no caller at all**. `generateMandatoryPatternCheck`
  (`PatternMemorySynthesisService.ts:882`) is called only by
  `generatePatternMemoryEnforcementContext` (`PatternMemorySynthesisService.ts:982`),
  whose only consumers were its own tests (gone with the suite), and
  `synthesizePatternMemory` (`PatternMemorySynthesisService.ts:500`) only by those
  two. So nothing refuses a setup for want of evidence; the live pre-trade gate is
  `services/trade/proposalGate.ts:152` (`assessPlanShape`).
  `addAttributedInsight` is the one writer of the attributed ledger.

`utils/netRiskReward.ts` is the cost model behind the ledger's `netR`; the skill
metadata keeps `grossR`, `netR`, `netRKnown` and `rSampled` separately, because a
gross sum read under a net label is a lie, and a missing cost is never stored as
zero.

**The memory loop, ported 2026-10-24** (the SKILL.md/memory design; the repo won
where the spec and the code disagreed):

- **Forget deletes the line and anything derived SOLELY from it** —
  `forgetProfileMemory services/learning/profileMemory.ts:291` returns
  `{ gone, removed, carried }`, not a boolean, because the honest answer can be
  "more than the one you named". A row goes with the forgotten slug only when its
  `derivedFrom` list resolves entirely to slugs this delete already dooms, and the
  rule is a loop rather than one test: C derived from B derived from A must all
  fall. A merge survivor keeps its facts (it was built from more than one line)
  and keeps its absorbed history, because that list is provenance, not a live
  dependency. What makes `derivedFrom` exist is the consolidation merge
  (`profileMemoryConsolidation.ts:214`), which records the inputs it absorbed
  before retiring them — and retires them through
  `retireMergedMemory services/learning/profileMemory.ts:329`, NOT through the
  trader-facing forget: the survivor's list names those very slugs, so cascading
  there would delete the merged row moments after writing it. The desk tool's
  receipt prints `alsoRemoved` / `itAlsoCarried`, and the Settings memory list
  (`ProfileMemoryCard.tsx:56`) says the same in a `role="status"` line, so a
  delete that took two rows never looks like a delete that took one.
- **Record shape** — the entry interface
  (`ProfileMemoryEntry services/learning/profileMemory.ts:30`)
  carries, besides its slug, description, kind and body: `version` (the
  optimistic lock, absent on legacy rows reads 1), the provenance tag (stated =
  the trader said it — the only tag the save tool writes; observed and inferred
  come from system paths, and the trader learner stamps observed), the
  sensitive flag, aliases (at most 8 extra match words), `previous` — the row as
  it read before the edit, stamped only when the body actually changed
  ("now X, previously Y") — and two more the memory loop needed:

  `subject` is whose or what the claim concerns (profile, preference, topic,
  area, person) — a different question from which kind wrote it, and derived
  from that kind for rows that predate the field, so no record is about nothing:
  `subjectOf services/learning/profileMemory.ts:110`

  `sourceSession` is the conversation the fact was heard in — a fact the trader
  cannot place is a fact they cannot audit.
  `rememberProfileMemory services/learning/profileMemory.ts:178`
  takes `if_version` and refuses a mismatched write by returning the row that IS
  stored, so the seat merges and retries in the same turn.
- **Write filters** — `filterMemoryWrite` (`utils/memoryWriteFilters.ts:71`)
  is the code the prompt's "never store" list stands on. The secret table
  (`SECRET_PATTERNS utils/memoryWriteFilters.ts:19`) refuses sk-/ghp_/AKIA/xox/JWT,
  a 13–19-digit card run, a bare `###-##-####` SSN shape with no label to give it
  away, a contiguous IBAN, and a long identifier that follows an account/routing/
  sort-code/SWIFT **label** — the label is what separates an account number from
  a position size, and the filter refuses identifiers, not numbers.
  Honesty-suppressing or elevated-permission "preferences" are refused with the
  reason; sensitive categories (health/finances/identity) are detected, REFUSED
  while the Settings switch `sensitiveMemoryEnabled` is off (the default), and
  flagged so the pre-read and unattended seats never surface them.
- **A bulk read is not an invitation** — `read_memory` with "all" (or no slugs)
  holds every `sensitive` row back for EVERY seat and answers with the count
  instead (`case 'read_memory' services/analysis/DeskToolsService.ts:3048`). The
  store's own index never advertises a sensitive slug, so a row that comes back
  was named by the trader; that is the distinction the bulk read cannot make on
  its own, and it is why the rule sits in the tool rather than in the prompt.
- **The memory off-switch actually gates every path** — the analysis
  pipeline always honoured it; since 2026-10-24 the flag threads
  App → `runChatSurfaceTurn` (`chatSurfaceTurn.ts:160`) and App → TradeView →
  the dock, and off strips BOTH memory blocks (profile and notebook topics)
  from the seat prompt. Skills are procedures, not memory, and stay.
  The DEEP pipeline honoured nothing: `assemblePipelineMemoryContext` called
  `buildProfileMemoryIndex()` bare, so a Full-analysis prompt carried the
  profile index whatever the switch said, sized by the default rather than the
  seat's window. It now takes the flag and `indexBudgetFor`'s memory line
  (`hooks/analysisPipeline/memoryContext.ts:152`) — the same table every other
  seat reads.
  Its ONE writer is the `Global memory` toggle in the notebook manager
  (`MemoryFilesManager.tsx:366`), on the Learn surface — Settings → Memory shows
  the LIST, not the switch, which is why a probe that looks for it there finds
  nothing. It is a per-profile setting
  (`useProfilePersistence.ts:108` writes `settings.isGlobalMemoryEnabled`,
  `useUserProfileLoader.ts:177` reads it with `?? true`), and the shipped default
  is ON: item 18 frames this control as turning memory OFF, which presupposes it
  was running, and item 8 injects the profile, preferences and index every turn.
  It read `?? false` until 2026-10-26, so every profile that never found the
  switch — including the one this repo ships — ran with no memory at all, and no
  live arm could catch it because the probe's own seed set the flag to `true` by
  hand. With the seed silent, five arms measure it through the UI: the pristine
  profile shows the switch on and gets the index plus the pre-read; one press
  reads back off and strips both from the next turn and stores no `remember` row;
  pressing again restores it. The seat cannot move the switch itself —
  `openKnobNames()` never names it, so a self-change cannot reach it.
- **The strategies switch gates one section built in one place** —
  `activeStrategiesBlock services/learning/strategyStore.ts:226` composes BOTH
  strategy sources: the ACTIVE plans from the notebook folder and the enabled
  uploads from `getEnabledStrategiesText`
  (`services/infrastructure/StrategyService.ts:103`), and it returns '' for the
  whole section on an explicit `enabled: false`. Both seat homes call that one
  function — the Chat surface through
  `surfacePromptWith services/trade/chatSurfaceTurn.ts:124` and the dock through
  `strategiesForPrompt components/trade/TradeChatPanel.tsx:472` — so the switch
  cannot be honoured by one surface and missed by the other. It used to be
  honoured by neither: the books function had no caller at all, the flag was read
  only by its own "On — enabled books are used" label, and the dock's prompt
  callback listed `[symbol, trades]` as its only deps, so a mid-session flag
  change could not have propagated even if something read it. Default ON
  (`useUserProfileLoader.ts:182`), a stored false still honoured; the seat cannot
  move it, because `openKnobNames()` never names it.
- **The 40-fact ceiling refuses; it never evicts** — the store used to write
  `entries.slice(-40)`, so the 41st NEW fact silently dropped the oldest one
  while the tool answered `saved: true`: a fact the trader was told was kept,
  gone with no receipt. `rememberProfileMemory`
  (`services/learning/profileMemory.ts:178`) now refuses a new row at the cap
  and `writeAll` writes exactly what it is given. The production path never
  reaches that refusal — `rememberWithConsolidation` frees a slot first by
  merging the two oldest non-sensitive rows, and refuses out loud when it
  cannot — so the ceiling only fires for a caller that skipped consolidation,
  which is exactly the hole it closes. An edit in place still lands at the cap.
- **The approval path enforces the body contract** — `skillBodyCaps` and the
  Use-when check ran only inside `SkillImportService` (and, as a courtesy
  message, in `propose_skill`), so a draft queued by a post-mortem craft — or
  one written before those gates existed — could be approved with a body no
  import would accept. `craftedBodyGate services/learning/SkillMemoryService.ts:2995`
  is the one rule both ingest paths call: over the 100k hard cap REFUSES
  (`over-hard-cap`, the draft stays in the inbox and the toast names the size),
  over the 200-line soft cap and a description with no trigger WARN, exactly as
  an import does.
- **A fact read off a page is not the trader's memory** — the seat prompt
  already says a fenced result is data; the executor now stands behind that.
  The turn loop marks a turn `untrustedSeen` (`DeskToolsService.ts:4907`) once
  a `web_search` or a forged HTTPS tool returns, and `remember` on such a turn
  refuses a fact whose DESCRIPTION is not in the trader's own message
  (`statedInTraderWords utils/memoryWriteFilters.ts:140`) — at least two shared
  distinctive words, at least half the description's, plurals folded; the body
  is deliberately not the signal, because a model-written body restates the page
  and picks the trader's question words up on the way (the first live arm passed
  a page-derived fact for exactly that reason); an absent message does not gate,
  because a detached run has no trader. A second, optional half rides beside it:
  `remember` may carry a verbatim `quote` of the trader's message, and a quote
  that does not appear there refuses the write on its own — a fabricated
  provenance claim is refused on any turn, not just a page-reading one. The
  quote is optional rather than required on purpose: making it required would
  mean a model that omits the field can never save a memory, which is a worse
  failure than the one it closes. Without it, a page saying "the trader
  approves 5x leverage" became a stored row on the model's say-so, with one
  prompt line in the way. A same-round pair (read + save in one batch) is not
  marked before the save runs; the guarantee is "the page was read, then the
  fact was saved", which is the shape of every injection that worked, and a page
  that mirrors the trader's own phrasing is out of reach of a vocabulary test —
  the gate catches content foreign to the conversation, not a clever echo.
- **Listing-first recall, one budget** — the profile index and the notebook
  topics index (`buildNotebookTopicsIndex`, `memoryTopics.ts:243`) ride the
  seat prompt beside the skills catalogue, and all three draw their line caps
  from ONE table, `indexBudgetFor` (`utils/promptIndexBudget.ts:35`), scaled
  to the seat's resolved context window (30/30/12 lines at ≥200k tokens down
  to 4/4/2 below 32k) — the same table in both homes, so a small local model
  gets small indexes everywhere. Each line also carries the record's aliases
  (`~bun, package manager`) when it has them, because a slug is the store's
  naming and the trader's word is the one that decides relevance; the
  description gives up exactly what the aliases take
  (`INDEX_ALIAS_MAX services/learning/profileMemory.ts:348`), so the row count
  and the line cap keep their measured cost. The recall-side half of the same
  rule is in the prompt: a reply never volunteers a sensitive detail (health,
  money, identity) or a fact about another person unless the trader is asking
  about exactly that — the index withholds those lines, so a reply that
  reconstructs them would defeat the exclusion.
- **The deterministic pre-read, on every model** — `buildMemoryHints`
  (`utils/memoryHints.ts:69`) string-matches the trader's message against the
  memory index (slug words and aliases) and the skill slugs. On a hit the harness
  attaches the matched record's own body — at most
  `MEMORY_PRE_READ_MAX utils/memoryHints.ts:57` records, each clipped to
  `MEMORY_PRE_READ_CHARS utils/memoryHints.ts:58` — inside its own HARNESS NOTE
  marker, and never a `sensitive` row. A skill is only NAMED for `skill_view`,
  never injected. The model-shape gate that used to sit here is gone: forgetting
  is not a weakness only small models have, and the cost is bounded by the match,
  so a message that names nothing still adds zero bytes. Both halves are live —
  a seat pointed at a non-loopback URL with a frontier-looking model id arrives
  with the fact attached, and arrives without the sensitive row.
- **The save chip with undo** — a `remember` receipt renders as
  "Memory saved — slug" (`ToolActionsRow.tsx`), and the row carries the one
  undo the chip style allows: a button that forgets the slug, fires the
  `august-profile-memory` refresh event, and flips to Undone.

### G.3 Skills are files with a lifecycle

A skill is a markdown file in `skills/`, parsed by `parseSkillMarkdown`
(`SkillMemoryService.ts:660`) into `SkillMeta` (`:117`): status, kind, scope,
evidence counts, `netR`/`grossR`, r-sample and provenance. `listSkills` is the one roster. `skillEnabledFlag` is the one place
`enabled` is derived — suspension is `enabled: false` plus `meta.suspendedAt`,
never a fourth status.

**The SKILL.md port, 2026-10-24** (same design pass as G.2's memory loop):

- **Third-party frontmatter survives every rewrite.** `captureUnknownFrontmatter`
  (`utils/skillFrontmatter.ts:46`) captures every key the app has no semantics
  for — `author`, `license`, `metadata.hermes.*`, `required_environment_variables`
  — verbatim at parse, and `serializeSkill` re-emits them verbatim, because a
  rewrite that eats a key the importer's author wrote is data loss the next
  round-trip turns into an unexplainable diff. One vocabulary module
  (`utils/skillFrontmatter.ts`) is shared by parser and serializer so a key can
  never be known to one and unknown to the other.
- **Compatibility is ENFORCED, not just carried.** `skillRunsHere`
  (`utils/skillFrontmatter.ts:260`) maps `platforms` onto the three runtimes
  the app actually has (browser / Electron desktop / Capacitor mobile),
  requires `requiresTools` to be a subset of the desk's list, and fails closed
  on `requiresEnv` — a renderer cannot honestly verify an env var. It also reads
  the INVERSE gate: `fallbackForTools` means the skill exists to cover tools the
  desk lacks, so it leaves the index as soon as one of them is available — a
  procedure duplicating a live tool would tax every prompt for nothing.
  `fallbackForToolsets` round-trips and gates nothing, because August names no
  toolsets; guessing a set out of tool names would hide a skill for a reason no
  author wrote. A skill this runtime cannot run leaves the index entirely, and
  `skill_view` refuses to open it with that reason.
- **Two vocabularies, one gate.** That gate used to read ONE shape — the
  `compatibility:` blob this app writes. An imported file declares the same
  thing as frontmatter keys (`requires_tools`, `fallback_for_tools`,
  `platforms`, flat or nested under `metadata:` / `hermes:`), and
  `declaredCompatibility` (`utils/skillFrontmatter.ts`) reads all three forms
  (dash list, inline `[a, b]`, inline JSON) so a declaration a reader cannot see
  stops being a constraint nobody enforces. The blob wins a key both spell; the
  declaration fills the rest. Reading is not owning — the author's own lines stay
  in `unknownFrontmatter` and re-emit verbatim, and a key August cannot honour
  (`requires_toolsets`, `fallback_for_toolsets` — it names no toolsets) is
  announced at import by `inertDeclaredKeys` rather than ignored in silence.
- **`skill_view` — progressive disclosure on the desk.** L0 is the skills index
  every seat already carries; the tool (`DeskToolsService.ts:2866`) is L1 (the
  full body plus the bundled-file list) and L2 (one bundled file by flat name —
  path separators and `..` are refused). `${SKILL_DIR}` and `${SESSION_ID}`
  substitute inside bodies, with `${HERMES_SKILL_DIR}`/`${HERMES_SESSION_ID}`
  accepted as aliases.
- **Import: folder, URL, scanned.** A picked folder imports whole — the
  `SKILL.md` claims its sibling files as bundled files name-spaced
  `<slug>__<subpath>`, exactly what L2 addresses (`bundledName`,
  `SkillImportService.ts:124`); the LEAF keeps its own extension, because a
  bundled name is the address a body hands a model, not a title.
  A URL brings the same shape rather than a second pipeline:
  `fetchSkillFromUrl` (`SkillImportService.ts:311`) fetches the raw SKILL.md
  (https only, 15s, 400kB cap), `skillSupportRefs`
  (`utils/skillFrontmatter.ts:365`) reads the body for its `references/`,
  `templates/`, `scripts/` and `assets/` siblings, and `resolveSiblingUrl`
  (`utils/skillFrontmatter.ts:401`) refuses any that is not https, is not on
  the skill's own host, or does not resolve under the SKILL.md's own folder —
  which is the load-bearing check, because the URL parser reads `\` as `/`
  and a body's `references\..\..\x.md` slips past every textual rule
  (measured in `.verify/url-ref-probe.cjs`, pinned by `check:contracts`).
  ≤12 siblings, 200kB each, 600kB per batch, one 20s deadline shared by the
  concurrent fetches; every refusal is named in the receipt, never dropped,
  and an over-cap body is refused on its CONTENT (a NUL or an undecodable
  byte), not on its extension. EVERY imported byte runs `scanSkillText`
  (`utils/skillFrontmatter.ts:333`): destructive filesystem
  commands, fork bombs, piped shell downloads, credential-file reads and
  credential-carrying URLs REFUSE the import with the finding named. Nothing
  auto-runs — scripts are stored text, and this repo has no execution path
  for them.
- **Authoring caps** — `skillBodyCaps` (`utils/skillFrontmatter.ts:297`):
  200-line soft warn (move material into `references/`), 100k-char hard
  refuse; a description with no "Use when" trigger is warned on at import,
  because the description is the activation key and a vague one rarely
  activates.
- **The trader keeps the hard controls.** Each library row (`SkillsCatalog.tsx`,
  `SkillDetail.tsx:126`) carries the enable toggle derived by
  `skillEnabledFlag` — the ONE place `enabled` may be read — and
  `requestRowDelete` (`StrategyStudio.tsx:391`) arms ONE row and no other, so a
  second click on that same row is the only thing that erases it.
  `deleteSkillFile` (`SkillDetail.tsx:87`) takes the head AND every `<slug>__…`
  bundled sibling in the same folder, inside one notebook write lock: a skill
  that arrived as a folder owns files nothing else addresses, so a head-only
  delete would leave bytes in the library that no row, no L1 list and no reader
  can reach.

The lifecycle has four stages:

1. **Draft** — review passes and tools queue candidates:
   `runSessionSkillReview` (`sessionSkillReview.ts:207`), `runWeeklyReviewIfDue`
   (`weeklyReview.ts:161`), `runMonthlyReportIfDue` (`monthlyReport.ts:337`),
   `passMining`, `chartScanSkills`, `selfImprovement`, `botLearning`, and the
   `propose_skill` desk tool. `queueSkillDraft` (`utils/skillDrafts.ts:65`) and
   `queueLearningProposal` (`utils/learningQueue.ts:145`) write the inbox.
2. **Gate** — `deterministicDraftGate` (`draftGates.ts:85`) rejects duplicates and
   malformed clauses; `gateEvidenceBackedDraft` requires evidence before
   a draft can reach a human.
3. **Human approval** — `approveSkillDraft` (`skillApproval.ts:55`) is the only
   writer that turns a draft into a skill file; it reads the library back, and a
   failed write leaves the draft in the inbox. `collectApprovalItems`
   (`utils/approvalInbox.ts:57`) is the one badge/list source for every queue.
4. **Retrieval and decay** — `rankSkillIndexRows`
   (`services/trade/tradeChatContext.ts:335`) ranks the 30-slot index;
   `buildSkillsIndexForPrompt` renders it; `resolveInvokedSkills`
   (`SkillMemoryService.ts:629`) returns the rows the model actually saw, and
   `applySkillEvidence` updates the ledger from closed outcomes.
   `runSkillIdleSweep` (`skillIdleLifecycle.ts:264`) suspends a silent skill
   after 90 days and archives it after 180; `buildMemoryHealthReport`
   (`memoryHealth.ts:187`) counts the buckets, ghosts and queue sizes.

The Skills surface is the read side: `SkillsCatalog` (the E-55 two-column grid,
with the availability mark derived from `skillEnabledFlag`), `SkillViewerPanel`,
`SkillsLibrary`, `StrategyStudio` and the approval inbox. `deskToolCatalogue`
documents the tool half of the same vocabulary (G.4).

The card's **name** is the human label (`humanizeSkillName`, `utils/skillNames.ts`):
the slug remains the identity in the tooltip, the accessible name and every write
path, while the visible name is the phrase a person recognises. Search matches
both, so typing what is on screen finds the skill even when the slug is different.

**Closed by E-57:** the store carried two readers with no caller —
`formatHarnessNotesBlock`, whose subject was the ensemble's arbiter, and
`lessonsForClass`, called only by its own tests. Both are deleted, and the module
header no longer claims a prompt reader. What is NOT dead is the store's one live
read: the wire-audit pin checker (`registerWireRoutePins`) asks this store whether
a provider class is pinned to thinking-off, and the module header records
that fact beside the commit that cut the phantom readers, so the next
cleanup cannot delete the store on the theory that nothing reads it. Settings
still lists the lessons, for a person.

### G.4 The desk tools are one catalogue with surface allow-lists

The catalogue is `DESK_TOOL_DEFINITIONS`
(`DeskToolsService.ts:1000`), plus `CHART_ACTION_TOOL_DEFS` (`:1795`) and the
mailbox tools. The surface decides what is offered:

- the dock uses `TRADE_TOOLS` (`chatTurnRunner.ts:118`), which is
  `DESK_TOOL_NAMES` (`utils/toolKinds.ts`) **plus the seven
  `CHART_ACTION_TOOL_DEFS` names**: the desk half comes from the ONE tool-name
  list, so the seat allow-list and the skill `compatibility.requiresTools` gate
  can never disagree on a spelling, and the chart half has to be named here
  because `streamChatWithDeskTools` lists a chart action only when the caller
  owns a canvas AND the allow-list names it — a list built from
  `DESK_TOOL_NAMES` alone emptied the chart set at that filter, and the widening
  step after it had nothing left to add, which is how a seat answering over a
  live chart told the trader there was no canvas to draw on (2026-10-28);
- the Chat surface uses `CHAT_SURFACE_TOOLS` (`chatSurfaceTurn.ts:63`), which has
  no canvas tools but includes `present_trade`, `decline_trade`,
  `read_tool_output` and `skill_view` — the progressive-disclosure reader
  (L1 body + bundled-file list, L2 one bundled file) that the skills index
  header points every seat at — plus the goal environment tools and the change
  ledger tools (see G.9);
- a detached skill eval uses `DETACHED_EVAL_TOOLS` (`services/trade/unattendedTools.ts:27`),
  the Chat set minus the notebook-writers and the two journal-acting tools;
- a panel seat adds the chart-action definitions only when its own allow-list
  names them.

`streamChatWithDeskTools` (`DeskToolsService.ts:5130`) composes the mandate from
the tools the turn can actually call (`deskToolsMandateFor`) filters
the definitions, and then runs `runDeskToolLoop`. `executeDeskTool`
re-checks the allow-list at execution, so a prompt that names a
non-offered tool still cannot run it.

The loop is bounded on every axis:

- `MAX_DESK_TOOL_ROUNDS` (`DeskToolsService.ts:199`), 8,192 output tokens per round and a 180s turn budget;
- `budgetToolContent` with `MAX_TOOL_CONTENT_CHARS` clips one
  result; the per-tool budgets and the read-back page (`READ_PAGE_CHARS`) keep a large payload addressable;
- `clearDeskToolCache` runs at the start of every tool turn; the cache
  TTL is `TOOL_CACHE_TTL_MS`;
- a spilled result goes to `storeToolArtifact` (`toolArtifactStore.ts:88`) under
  the turn's owner token; `read_tool_output` pages it back through
  `readToolArtifact`. The UI payload copy is separate
  (`saveToolPayload`, `toolPayloadStore.ts:110`; `readToolPayload`, `:174`).

Forged tools are human-gated: `validateProposal` (`toolForge.ts:124`),
`approveForgedTool` and `executeForgedTool` never run a
candidate before approval. The chart actions (`draw_on_chart`,
`mark_trade_levels`, `clear_chart_drawings`) are offered only when the caller owns
a canvas; the Chat surface's `present_trade` receipt says the card exists but no
level-watch is armed. The Settings `DeskToolCatalogue` is a reader of the same
`DESK_TOOL_DEFINITIONS`/`toolLabel` vocabulary, grouped by `toolKinds`; it has no
per-tool switch because the allow-lists are code, not preferences.
`get_key_levels` is the Key Levels card's feeder: it computes
support/resistance, pivots, Fibonacci, psychological levels and VWAP for the
asked symbol/timeframe and returns the exact fenced `key-levels` block the model
publishes; `parseKeyLevels` (`services/trade/keyLevels.ts`) renders the card and
`KeyLevelsCard` owns the chart toggle. The toggle's input covers its VISIBLE
label, so focusing it cannot scroll the transcript's ancestor — the defect that
moved the whole app shell out of view and left a black screen.

The transcript side of a tool call is one paired row, not two lines:
`digestToolResult` (`DeskToolsService.ts:891`) writes the human label and detail,
`toolLabel` is the one name map, `utils/turnStatus.ts` pairs the call
with its result and counts calls, and `ChatWorkTimeline`/`ToolActivityRow` draw
the trail. `Message.toolEvents`/`toolIds` are the settled list; `liveToolEvents`
is the capped live feed. A failed call is a row, a failed turn is a
`ChatFailureRow`, and a truncation is `finishReason` (G.5).

### G.5 The learning loop, end to end

```mermaid
flowchart TD
    T["trade closes — useTradeLogging.logTradeWithFeedback useTradeLogging.ts:274"] --> J["journal row + memory note + realizedR/netR"]
    J --> A["OutcomeAutopilotService.register / subscribe"]
    A --> S["settlementActionFor outcomeSettlement.ts:47 — automatic · shadow · confirm"]
    S --> E["applySkillEvidence SkillMemoryService.ts:2426 · calculatePnlR PatternMemorySynthesisService.ts:249"]
    E --> R["review passes — runSessionSkillReview · runWeeklyReviewIfDue · runMonthlyReportIfDue · passMining · chartScanSkills"]
    R --> D["drafts — queueSkillDraft · queueLearningProposal"]
    D --> G{"draft gates — deterministicDraftGate · gateEvidenceBackedDraft"}
    G --> H{"HUMAN — approveSkillDraft"}
    H --> N["notebook skills/ — one file per skill"]
    N --> I["resolveInvokedSkills → buildSkillsIndexForPrompt → next prompt"]
    I --> T
    X["heartbeat useLearningHeartbeat.ts:42"] --> Y["runMemoryHygiene memoryHygiene.ts:151 → runSkillIdleSweep services/learning/skillIdleLifecycle.ts:264"]
    Y --> N
```

The loop is deliberately split between **records** and **beliefs**: the journal
stores what happened (`logTradeWithFeedback` writes the row, the memory note and
the measured `realizedR`/`netR`), the autopilot detects the outcome, and the
settlement policy decides whether it is recorded automatically, shown in shadow,
or waits for a confirmation (`settlementActionFor`, with the 15-second undo
window in `useWatchSideEffects`). The skill ledger and pattern memory read the
measured R, never a plus/minus stand-in. The review passes and the `propose_skill`
tool create drafts; the gates and the human approval decide what becomes a
belief; the next prompt receives only the ranked selection. The heartbeat's
hygiene and idle sweep keep the store bounded.

What the loop does **not** do is equally important: a closed trade no longer
writes a post-mortem (the writer was deleted), so `craftSkillFromPostMortem` is a
reader for old rows only; the harness-lesson store has no prompt reader; and the
prompt A/B lane is decided per run at
`services/infrastructure/PromptOverrideService.ts:34` but resolves no override on
any path that answers the trader. `promptCorpusVersion`
(`services/infrastructure/PromptOverrideService.ts:97`) is recorded on the run and
now filters to registered ids (`services/infrastructure/PromptOverrideService.ts:104`),
so a stored edit for a prompt that no longer exists cannot split the A/B group;
`getPrompt` (`services/infrastructure/PromptOverrideService.ts:69`) is the resolver
that lane governs wherever a lane is passed. These are named here because a learning
loop that hides a dead leg is worse than one that says which leg is dead.

### G.6 Known gaps

- **Prompt A/B lane** — decided per run and threaded as a value (E-57 §3), and the
  corpus fingerprint counts only overrides for prompts that still exist; what
  remains is that the desk turn resolves no override at all, so the two lanes
  currently send the same bytes and record different labels. The “Reset all (N)”
  count now ignores the ghosts too (`components/settings/PromptManager.tsx:83`).
- **Harness lessons** — recorded and listed in Settings, and read live by the
  wire-audit pin checker. There is no prompt reader, and E-57 deleted the two
  functions that pretended there was one (see G.5), so this is a stated limit
  rather than a gap: a wire lesson is evidence for a human and for a pin, not a
  instruction to a seat.
- **Partial-text failures** — a turn that streamed some prose and then failed is
  left as a partial answer; `Message.error` is stamped only when the turn
  produced no text.
- **Tool catalogue scope** — Settings → Analysis lists
  `DESK_TOOL_DEFINITIONS`; chart-action and mailbox tools are surface-gated and
  are not rows there.
- **Output clamp coverage** — the per-window output budget and the refusal are
  applied in the desk loop; plain analysis transport still relies on the
  context-length rejection recovery.

### G.7 Persistence, backup and export

| What | Key |
|---|---|
| dock sessions · active id · tool payloads | `trade_chat_sessions_v1_` · `trade_chat_active_v1_` · `trade_tool_payloads_v1_` |
| notebook · queue · drafts · rules | `memory_files_v1_` · `learning_proposals_v1:` · `skill_drafts_v1:` · `approval_rules_v1:` |
| roster · providers · legacy automations | `agents_bots_v1` · `provider_configs_v1` (keys `enc:v1:` via safeStorage) · `automations_v1_` (legacy: nothing writes it since 2026-10-24, still restorable) |
| profile memory (the collaboration facts) | `profile_memory_v1_<user>` — raw localStorage by design (`ExportService.RAW_LOCAL_STORAGE_PREFIXES`, `ExportService.ts:299`), exported/restored through the prefix list, not Preferences |
| learning rules · calibration stats · harness lessons | `learning_rules_v2_` · `model_confidence_calibration`/`confidence_calibration` · `august_harness_lessons_v1_` — the rest of the raw-localStorage family the export fallback reads |
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


### G.8 Boundaries that keep the stores honest

**Provider secrets** never ride in the notebook: `ProviderConfigService` encrypts
each key with Electron `safeStorage` on desktop and fails closed to a not-ready
provider when decryption fails; `shared/providerRequestPolicy.cjs` is the one host
policy shared by the renderer, the dev proxy and Electron main. AI output is
sanitized and zod-validated at the boundary (`schemas/tradeAnalysis.ts`), never
rendered as raw provider JSON.

**A write that cannot land is reported.** The notebook records quota vs error,
bytes and streak in `getNotebookWriteFailure` (`MemoryFilesService.ts:588`) and
refuses growth at the hard cap; a corrupt notebook gets a sidecar copy before the
in-memory view is replaced. The tool payload store records its own refusal
(`toolPayloadStore.ts:54`), and the transcript says the full result was not kept
rather than opening an empty box. Artifacts are owner-scoped so two concurrent
turns cannot page or delete each other's bytes.

**Backups are namespaced, not assumed.** `BackupService.createBackup`
(`BackupService.ts:116`) carries the profile/notebook/trades;
`RAW_LOCAL_STORAGE_PREFIXES` (`ExportService.ts:299`) names the raw-localStorage prefixes for stores that
bypass Preferences, because on native Preferences and the WebView origin are two
different places. There is no generic AI-response cache — only the desk-tool
result cache with its 30-second TTL — so a "refresh" cannot silently serve an
old answer.

### G.9 Goal environments and the change ledger — the two things a seat may edit mid-task

Both are **work state the agent shapes while it works**, and both live in the
notebook rather than in a new store: a goal is `goals/<slug>.json`
(`MemoryFilesService.ts:125`) and a self-change is `self-changes/<id>.json`
(`MemoryFilesService.ts:129`), so backup, export, the write lock and the byte
budget already cover them.

**A goal is an environment, not a title.** `createGoal
services/goals/GoalService.ts:131` makes one and `updateGoal
services/goals/GoalService.ts:164` patches it; every patch appends the previous
snapshot to `history` under an optimistic `if_version`, so a stale edit returns
the current goal and the seat merges and retries in the same turn instead of
overwriting a concurrent one.
`restoreGoal services/goals/GoalService.ts:202`
brings a snapshot back as a NEW revision, and exactly one goal is focused:
`focusedGoal services/goals/GoalService.ts:72`
The focused goal's `policy.allowedTools` is intersected with the seat's own list
at the transport — `goalAllowedTools services/trade/chatSurfaceTurn.ts:357`
› `effectiveAllowed services/analysis/DeskToolsService.ts:5132`, and the rule
itself is `intersectGoalPolicy utils/toolKinds.ts:187`
so a goal can only NARROW what a seat may call, and no goal text can widen a
policy. The intersection has one hard case: a goal authored on the Chat surface
can name tools the trade seat's `TRADE_TOOLS` never had, and an EMPTY list does
not mean "nothing" anywhere in this file — `seatAllows` reads it as
unrestricted — so an empty intersection returns
`NO_TOOLS_ALLOWED utils/toolKinds.ts:206`, which matches no definition and
refuses every call. Passing `[]` there would have handed the seat the whole desk
it was told to give up; `check:contracts` pins it because no probe can reach a
cross-surface goal. The index that rides the shared prompt budget is
`buildGoalsIndex services/goals/GoalService.ts:243`
and the deterministic pre-read that resurfaces a goal from the trader's own words
is `goalMatchesMessage services/goals/GoalService.ts:278`, called from the seat
prompt builder at
`chatSurfaceTurn services/trade/chatSurfaceTurn.ts:181`
— a substring match with no model call, which appends ONE hint line naming the
goal and stops there. It shipped for a week as a function nobody called, which
made this sentence a claim about a label rather than a behavior; the live probe
and six `node-goals` arms now hold both arms of it — the hint on a match, nothing
on a non-match, and no focus change from either. An unattended run passes no
`matchText`, because a tool output or a fetched page must never be what points the
seat at an environment.
`UNATTENDED_DENY services/trade/unattendedTools.ts:16` keeps a detached evaluator
able to read goals and unable to write them.

**A self-change is a harness edit with an undo already written.** The trader
chooses how far it goes with one setting — `off`, `config`, `shadow` — and the
resolver fails to `off` on anything else (`harnessSettings.ts:158`), including a
value the agent itself tried to store. Two surfaces are open, because two
surfaces actually change how this app behaves:

- `config`: the knobs the harness reads on every call, `responseEffort` and
  `skillLibraryCap`, both declared in
  `KNOBS services/selfMod/SelfModificationService.ts:100`
  A change applies now, is written to the ledger with the value it replaced, and
  reverts itself when its 24-hour window closes —
  `expireSelfChanges services/selfMod/SelfModificationService.ts:419`
  A knob cannot be re-changed inside the cooldown, and only a bounded number of
  changes may be in force at once —
  `churnCheck services/selfMod/SelfModificationService.ts:220`
- `shadow`: one registered prompt, applied through
  `proposePromptOverride services/selfMod/SelfModificationService.ts:305`
  It is refused unless the app's own prompt A/B is armed, because the built-in
  text keeps the control lane and
  `promptCorpusVersion services/infrastructure/PromptOverrideService.ts:97`
  stamps the edited corpus onto every closed trade.
  `settleSelfChanges services/selfMod/SelfModificationService.ts:452` then
  compares the two on those trades, on the same 5-per-side, 8-point bar declared
  in `SHADOW_MIN_TRADES_PER_SIDE services/selfMod/SelfModificationService.ts:61`
  and in `maybePinWinningPromptLane utils/promptVersionStats.ts:45` — and
  promotes, leaves in shadow, or auto-reverts. It runs from the learning pass
  beside `maybePinWinningPromptLane services/learning/SkillMemoryService.ts:4082`
  so a self-edit is judged by outcomes, not by the model's opinion of its own
  edit.

What is **not** open, named in the table the contract gate pins
(`BLOCKED_KNOB_REASONS services/selfMod/SelfModificationService.ts:137`): equity,
risk, leverage, the edge floor, the session guard, outcome settlement, the skill
veto, the starter shelf, auto-drafting, sensitive memory, desk tools, the A/B
rate and lane pin, and the mode itself — an agent that could pin a lane could
make its own shadow unfalsifiable. Skills keep the route they already had: the
human approval inbox plus `meta.shadow` and `settleShadow`, so a self-change
never becomes a second way past the gate, and the prompt that carries the risk
rules is refused by name in
`BLOCKED_PROMPT_IDS services/selfMod/SelfModificationService.ts:68`
The seat is told about the capability only when the trader turned it on, in
`deskToolsMandateFor services/analysis/DeskToolsService.ts:1957`
a detached run reads the ledger and cannot write it, because the executor's own
allow-list check refuses it: `seatAllows services/analysis/DeskToolsService.ts:2865`
Pulling the switch off reverts every change the agent made, promoted ones
included: `setSelfModMode services/selfMod/SelfModificationService.ts:166`
and the toggle sits beside the knobs it governs, in the Harness block at
`Self-modification components/settings/SessionUsagePanel.tsx:281`

**Where the trader sees it.** The Chat rail's third tab is the audit and the
undo for both kinds of state —
`GoalRailPanel components/agents/GoalRailPanel.tsx:333`
lists every goal with its focus control, its status, its history restores and a
delete that asks once before it commits, and under it the changes still in force
with one Undo each
(`rail-self-changes components/agents/GoalRailPanel.tsx:476`).
The panel mounts where the roster and the conversations do, on the same tab row
(`railTab components/agents/AgentsView.tsx:1090`). The header names the goal the
seat is inside and its × releases it —
`ActiveGoalChip components/agents/ActiveGoalChip.tsx:27`
— because a focused goal changes which tools the NEXT turn is offered, so a
trader who could not see it was being shaped by a state they never chose. A
goal-only control gets no coverage from the inert-control sweep (it walks the
Learn and Journal surfaces), so the presses are proven live instead.

The same tab is the human's editor. `GoalEditor components/agents/GoalRailPanel.tsx:45`
opens in place over the row it edits and writes the fields the desk also writes —
objective, next step, the phrases that resurface it, and the tool policy — through
`saveGoal components/agents/GoalRailPanel.tsx:375`, which carries the SAME
`ifVersion` lock the desk uses: if the model changed the goal mid-edit the press
names the revision that won, the editor stays open with the trader's text intact,
and nothing is overwritten. Two rules the editor keeps: `mergeTriggers
components/agents/GoalRailPanel.tsx:183` replaces only the message trigger, so a
price trigger's watch id survives a prose edit, and the policy chips list only
tools this seat can reach, because a narrowing the seat cannot honour would strip
it to `NO_TOOLS_ALLOWED` rather than grant anything.

## H · Every arrow

| # | from → to | what crosses |
|---|---|---|
| 1 | index.html → index.tsx | mount, error handlers first `unhandledrejection index.tsx:28` › `error index.tsx:48` |
| 2 | index.tsx → App | `StrictMode index.tsx:78` › `ErrorBoundary index.tsx:79` › `ToastProvider index.tsx:80` |
| 3 | App → useSurfaceRouter | surface + journalTab + journalOpenNonce, `useSurfaceRouter hooks/useSurfaceRouter.ts:54` |
| 4 | useSurfaceRouter → useSurface | persisted value, key `august_surface_v1 hooks/useSurface.ts:15`, valid set `:16` |
| 5 | useSurfaceRouter → appHash | `#/journal\|market\|settings\|watch` ⇄ state `parseAppHash hooks/useSurfaceRouter.ts:101`, serialize `serializeAppHash hooks/useSurfaceRouter.ts:159` |
| 6 | App → Header | band `App.tsx:2380`, guard `surface App.tsx:2384` (the header's own switch) |
| 7 | App → 4 lazy surfaces | each wrapped in `SurfaceSkeleton` — `SurfaceSkeleton App.tsx:151` TradeView, `SurfaceSkeleton App.tsx:151` Journal, `SurfaceSkeleton App.tsx:151` LearnView, `SurfaceSkeleton App.tsx:151` StrategyStudio |
| 8 | Header → SurfaceSwitch | the destination set `App.tsx:2163`, list `SURFACE_ITEMS components/shell/SurfaceMenuList.tsx:44` |
| 9 | App → AgentsView props | same switch + StatusCluster + AccountRow + SurfaceMenuList(hideSurfaces) on `AgentsView App.tsx:2522`, props `App.tsx:2522-2614` |
| 10 | TradeView → TradeChatPanel | the dock, inside Trade `TradeChatPanel components/trade/TradeView.tsx:1140` |
| 11 | AgentsView.send → bot branch | the selected bot answered at `onSendBotTurn components/agents/AgentsView.tsx:812` |
| 12 | bot branch → useBotMailbox | `runUserBotTurn hooks/useBotMailbox.ts:305` → `runBotTurn hooks/useBotMailbox.ts:130` |
| 13 | AgentsView.send → analysis branch | `onAnalyze components/agents/AgentsView.tsx:802` → `handleRunAnalysisFromChat App.tsx:2427` — the dock's `onRunAnalysis` reaches the SAME wrapper |
| 14 | dock Full analysis → the run slot | `runFullAnalysis components/trade/TradeChatPanel.tsx:586` → `beginRun`/`endRunOwned`; it writes **no row**, the pipeline's own messages are projected into the session |
| 15 | ChatComposer → chatTurnRunner.send | key `Enter components/trade/panels/ChatComposer.tsx:156` / button `:226` → `services/trade/chatTurnRunner.ts:860` |
| 16 | solo → runSeatTurn | `services/trade/chatTurnRunner.ts:1039` (definition `runSeatTurn services/trade/chatTurnRunner.ts:619`) |
| 17 | runSeatTurn → the ONE turn executor | `runToolTurn toolTurn.ts:136` → `streamChatWithDeskTools :174` → `DeskToolsService` → `streamChatRequest` |
| 18 | panel → per-seat + mailbox | `runSeatTurn services/trade/chatTurnRunner.ts:1232` · `createDebateMailbox :1156` · `planPanelTurn :1167` |
| 19 | systemPromptFor → prompt | `TRADE_CHAT_SYSTEM_PROMPT` + skills + strategies + profile + persona `systemPromptFor components/trade/TradeChatPanel.tsx:520` = the blocks below, assembled at `TRADE_CHAT_SYSTEM_PROMPT components/trade/TradeChatPanel.tsx:520` |
| 20 | every dock turn → chatStore | `mutate services/trade/chatStore.ts:400` · `beginRun services/trade/chatStore.ts:551` |
| 21 | handleSendMessage → what answers | the fork is gone (19): a bot thread streams `useBotThread hooks/useAnalysisPipeline.ts:1098`, anything else runs the tool turn `:1174`; the ensemble flag and the roster it fed are gone (2026-10-19) |
| 22 | the casual arms | a bot thread → `streamQuickResponse useAnalysisPipeline.ts:1147` (plain transport); the desk → `runChatSurfaceTurn chatSurfaceTurn.ts:321` → arrow 17. Tier on both via `resolveComposerEffort`; a Full-analysis send also sets `requireTools` |
| 23 | casual frames → Message.text | `applyCasualStreamUpdate hooks/analysisPipeline/streamThrottlers.ts:28`; flush precedes the settle write useAnalysisPipeline.ts |
| 24 | ensemble → the stages that survive | see C — five of the old eight are gone from the call path, and no stage is named in the code, so no line number is claimed |
| 25 | desk tools → what a caller can reach | `executeDeskTool services/analysis/DeskToolsService.ts:2798` (its allow-list is enforced at execution, not only at offer time) |
| 26 | panel tools → chart echo | `executePanelTool services/trade/chatTurnRunner.ts:350` is what echoes the result back into the panel |
| 27 | ~~automation tick → runAutomation~~ | DELETED (2026-10-24, owner request): the surface, the scheduler, the ration, the breaker and the bot-scoped routine executor are gone — see E |
| 29 | rooms → groupRounds | `useAgentGroups hooks/useAgentGroups.ts:75` → `streamQuickResponse services/providers/GenericAnalysisService.ts:605` |
| 30 | review passes / propose_skill → draft → approval → skill | `draftGates.ts` → `approveSkillDraft services/learning/skillApproval.ts:55` — the post-mortem leg is starved, not deleted (see D) |
| 31 | approved skill → next prompt | `resolveInvokedSkills services/learning/SkillMemoryService.ts:629` — closes into 24's stage 3 |
| 32 | logged trade → memory + autopilot | `useTradeLogging hooks/useTradeLogging.ts:100` writes the journal row and the memory note → MemoryService; proposedTrade leaves outcome PENDING so the autopilot watches it |
| 33 | App messages + dock entries → one thread | `entriesForSession services/trade/chatSessions.ts:593` |
| 34 | chatStore → localStorage | `saveSessions services/trade/chatSessions.ts:456` → debounced key |
| 35 | App → profile persistence → engine | `useProfilePersistence hooks/useProfilePersistence.ts:82` → `dbService` or `SqliteService` |
| 36 | providers → Preferences, keys encrypted | `saveProviderConfigs services/infrastructure/ProviderConfigService.ts:202` writes the whole roster and encrypts each key at rest on desktop |
| 37 | every provider call → the policy | GenericProviderService is configured by `providerRequestPolicy services/providers/GenericProviderService.ts:29` — the same shared module the vite dev proxy and electron main import |
| 38 | dev calls → the proxy | the dev proxy mounts `__provider_proxy vite.config.ts:73` |
| 39 | desktop calls → IPC → sseParser → chunks | `trustedHandle electron/main.cjs:186` → `consumeProviderStream :645` → `createSseParser electron/sseParser.cjs:30` |
| 40 | reasoning deltas → their own field | the trace rides ON THE ROW: `thoughtProcesses types/message.ts:174` is what the Thinking row draws. The thinking STORE is written when a trade is logged (`useTradeLogging hooks/useTradeLogging.ts:100`); `saveThinkingBatch services/infrastructure/ThinkingStoreService.ts:130` is the RESTORE/migration path (`BackupService`, `SqliteService`), not a per-delta write |
| 41 | notebook writes → byte tiers | a write asks `notebookPressureAllows services/learning/MemoryFilesService.ts:657` before the notebook may grow; the tiers come from utils/memoryBudget.ts and Settings Health reads memoryHealth.ts |
| 42 | heartbeat → hygiene + idle sweep | `useLearningHeartbeat hooks/useLearningHeartbeat.ts:42` → `memoryHygiene.ts` → `skillIdleLifecycle.ts` |
| 43 | approval tray → badge | `collectApprovalItems utils/approvalInbox.ts:57` → `approvalsWaiting App.tsx:1872` → Knowledge tab only |
| 44 | the pane filters what it shows | `deskThread utils/agentThreads.ts:118` read at `AgentsView.tsx` |
| 45 | `present_trade` → a card in either home | `runPresentTrade presentTradeTool.ts:78` ← dock sink `chatTurnRunner.ts` / desk sink `chatSurfaceTurn.ts`; gate scan starts there, the cap binds at log time (`ensureStamp services/trade/proposalGate.ts:317`), and the same stamp answers for the shape of the plan — `assessPlanShape services/trade/proposalGate.ts:152` refuses an inverted one and warns on a sub-floor ratio or an out-of-band stop, per ruling (c) of E-57 §5 |
| 46 | `chatSurfaceSystemPrompt` → the desk arm's prompt | `chatSurfaceSystemPrompt services/trade/chatSurfaceTurn.ts:223` — mandate (`CHAT_SURFACE_SYSTEM_PROMPT constants/prompts/chatPrompts.ts:40`) + skills index + active strategies and uploaded books + memory index, read FRESH per turn; the 30 slugs printed are the 30 recorded on the row (`types/message.ts:345`) |
| 47 | prose that never called the tool → the same decision | `planFromProse services/trade/tradeShapedProse.ts:51` reads the labelled entry/stop/target out of the row, parseTradeProposal decides whether that is a plan, and the chip mints the ONE plan-id shape (mintPlanId) before calling onLogProposedTrade — so a spoken plan reaches the journal the same way a presented one does |
| 48 | ~~a scheduled run → a rationed plan~~ | DELETED with the feature; the two live turn owners still ration nothing |
| 49 | ~~a schedule's failure → the row and the toast~~ | DELETED with the feature. The rule it carried still binds anything unattended: a run that called nothing must not settle as a clean answer |
| 50 | a journal row gets its scalp/swing class | `withDetectedTradeType` (`services/analysis/ScalpDetectionService.ts`) is called at the two row-minting sites `withDetectedTradeType hooks/useTradeLogging.ts:369` and `withDetectedTradeType hooks/useTradeLogging.ts:777` — label-only, so no `validityDurationMinutes` appears and the autopilot expiry window never widens. The filter reads it at `components/journal/TradeLog.tsx:540` |
| 51 | a run records its measured cost | `recordToolTurnUsage utils/sessionUsage.ts:63` is called by both turn owners — desk arm chatSurfaceTurn.ts, dock seats chatTurnRunner.ts — from the usage the wire reported per request. Knowledge → Session Usage reads that ledger; stage 19 left it with a reader and no writer. usageCalls distinguishes a zero-cost run from a provider that sent no usage frame |
| 52 | a finished analysis says so | `notify()` (`services/infrastructure/notify.ts`) fires when a Full-analysis send settles un-stopped (`notify hooks/useAnalysisPipeline.ts:1276`). Before stage 19 this came from the verdict finalizer; the old channel name CompletionNotifications was a native-only copy of the same thing, and its FILE is gone with stage 19's tranche — the only surviving mention is a comment in `services/infrastructure/notify.ts` — so the app speaks through one notifier |
| 53 | the chart gets its Entry/Stop/Target lines | `latestChartVerdict(messages)` `latestChartVerdict services/trade/chartData.ts:95` is what App hands `TradeView` as `verdict` — the newest row carrying `Message.proposal` (what `present_trade` stamps; `proposal services/trade/chatSurfaceTurn.ts:406`), with `Message.analysis` as the fallback for pre-debate history. Red-proved: the old selector keyed on `ensembleProgress` / >1 `modelsUsed` / `debateTurns` and returned null for every tool-turn row. render-probe PASSED on 2026-10-18 after this change (zero pageerrors, every row rendered), but the probe asserts no canvas overlay levels, so the drawn Entry/Stop/Target line is still un-asserted by any gate |
| 54 | request → context window | `resolveContextWindow utils/contextWindow.ts:136` resolves user → measured → model → assumed; `outputTokenBudget utils/contextWindow.ts:187` and `promptTokenCeiling utils/contextWindow.ts:169` size the two halves of one request |
| 55 | array → compaction | `compactForWire services/providers/contextCompact.ts:343` → `compactMessages :217`; oldest payloads, then prose, then whole rounds; `tool_calls` stay paired and the last user turn is pinned |
| 56 | tool round → bounded loop | `runDeskToolLoop services/analysis/DeskToolsService.ts:4405`; `MAX_DESK_TOOL_ROUNDS :199` · `DESK_ROUND_MAX_TOKENS :244` · `DESK_TURN_BUDGET_MS :211` |
| 57 | tool result → artifact + payload | `storeToolArtifact services/analysis/toolArtifactStore.ts:88` (owner-scoped; `readToolArtifact :144`) and `saveToolPayload services/trade/toolPayloadStore.ts:110` (`readToolPayload :174`) |
| 58 | tool event → transcript trail | `digestToolResult services/analysis/DeskToolsService.ts:891` → `Message.toolEvents` + `toolIds` → `ToolActivityRow`/`ChatWorkTimeline` |
| 59 | wire decision → audit row | `buildReasoningPatch services/providers/reasoningControls.ts:271` → `WireAuditEntry` → `WireAuditRow`; the route, tier, applied and reason are recorded per call |
| 60 | trade close → journal + autopilot | `logTradeWithFeedback hooks/useTradeLogging.ts:274` writes the row/memory note and the measured R; `register services/ui/OutcomeAutopilotService.ts:189` watches it |
| 61 | autopilot → settlement | `subscribe services/ui/OutcomeAutopilotService.ts:288` → `settlementActionFor utils/outcomeSettlement.ts:47` (automatic · shadow · confirm; 15s undo) |
| 62 | outcome → skill ledger + pattern memory | `applySkillEvidence services/learning/SkillMemoryService.ts:2382` and `calculatePnlR services/learning/PatternMemorySynthesisService.ts:249` consume the measured outcome, never a ±1 stand-in |
| 63 | review → draft | `runSessionSkillReview services/learning/sessionSkillReview.ts:207` · `runWeeklyReviewIfDue services/learning/weeklyReview.ts:181` · `runMonthlyReportIfDue services/learning/monthlyReport.ts:337` → `queueSkillDraft utils/skillDrafts.ts:65` |
| 64 | draft → gate → human | `deterministicDraftGate services/learning/draftGates.ts:85` / `gateEvidenceBackedDraft :199` → `approveSkillDraft services/learning/skillApproval.ts:55` |
| 65 | approved skill → notebook → prompt | `approveSkillDraft services/learning/skillApproval.ts:55` writes the file; `resolveInvokedSkills services/learning/SkillMemoryService.ts:629` returns the rows the next prompt may name |
| 66 | heartbeat → hygiene + idle | `useLearningHeartbeat hooks/useLearningHeartbeat.ts:42` → `runMemoryHygiene services/learning/memoryHygiene.ts:151` → `runSkillIdleSweep services/learning/skillIdleLifecycle.ts:264` |
| 67 | failure → failure row | `toFriendlyProviderError services/providers/GenericProviderService.ts:1221` preserves the cause chain → `Message.error` → `ChatFailureRow`, in both homes |
| 68 | model control → tier | `ModelChip`/`ModelMenu`; `nextEffortTier components/shared/effortScale.ts:50`; `effortDialUp components/shared/effortDial.ts:27` guards the chord |
| 69 | run → prompt lane + corpus version | `beginPromptLane services/infrastructure/PromptOverrideService.ts:34` → `promptCorpusVersion :97` → `runStats.promptLane`/`promptVersion` |
| 70 | Settings → tool catalogue | `DESK_TOOL_DEFINITIONS services/analysis/DeskToolsService.ts:1000` + `toolLabel :834` → `DeskToolCatalogue`, grouped by `toolKinds` |
| 71 | skills index → skill_view → the body or one bundled file | `case 'skill_view' services/analysis/DeskToolsService.ts:2866` — L1 body + bundled list, L2 one flat-named file (`..` refused); `${SKILL_DIR}`/`${SESSION_ID}` substitute, Hermes aliases accepted |
| 72 | message → focused goal → a narrower toolset | `focusedGoal services/goals/GoalService.ts:72` · `goalMatchesMessage :278` → `goalAllowedTools services/trade/chatSurfaceTurn.ts:377` → `intersectGoalPolicy utils/toolKinds.ts:187` › `effectiveAllowed services/analysis/DeskToolsService.ts:5271`, an intersection — a goal may only narrow the seat, and narrowing to nothing leaves it `NO_TOOLS_ALLOWED utils/toolKinds.ts:170` rather than the whole desk |
| 73 | seat → goal edit → snapshot → undo | `case 'update_goal' services/analysis/DeskToolsService.ts:3319` → `updateGoal services/goals/GoalService.ts:164` keeps the previous snapshot → `case 'restore_goal' services/analysis/DeskToolsService.ts:3363` → `restoreGoal services/goals/GoalService.ts:202` |
| 74 | seat → self-change → ledger → outcomes | `case 'propose_self_change' services/analysis/DeskToolsService.ts:3254` → `proposeKnobChange services/selfMod/SelfModificationService.ts:259` / `proposePromptOverride services/selfMod/SelfModificationService.ts:305` → `writeSelfChange services/selfMod/SelfChangeLedger.ts:100` → `settleSelfChanges services/selfMod/SelfModificationService.ts:452`, run from `settleSelfChanges services/learning/SkillMemoryService.ts:4045` |
| 75 | rail Goals tab → focus / undo → the header chip | `focusGoal services/goals/GoalService.ts:230` and `revertSelfChange services/selfMod/SelfModificationService.ts:378` pressed from `GoalRailPanel components/agents/GoalRailPanel.tsx:333` → `ActiveGoalChip components/agents/ActiveGoalChip.tsx:27` names it, and its own press releases it |

---

## Corrections this doc is guarding

1. There is **no `main.tsx`** — the entry is `index.tsx`.
2. There is **no `utils/deskThread.ts`** — `deskThread` is `utils/agentThreads.ts`.
3. The provider layer speaks **four** wire formats (`types/provider.ts`); "three"
   describes only `electron/sseParser.cjs`, which has no `google` dialect.
4. Approvals is a **tab** of the Knowledge surface, not a fifth destination. The live
   destination set is exactly `trade | journal | agents (labelled Chat) | learn
   (labelled Knowledge)`.
5. **`NavRail` is DELETED (2026-10-28).** The component had no rendered caller; the only
   thing it alone hosted was the update download, which had no other entry point anywhere in
   the app. The download moved to the header (`components/shared/Header.tsx` mounts
   `UpdateButton`), and the two live pieces of the file moved with it: the layout constants
   (`NAV_RAIL_COLLAPSED_PX`, `NAV_RAIL_EXPANDED_PX`, `NAV_RAIL_AUTO_COLLAPSE_PX`) and
   `AccountRow` now live in `components/shell/shellChrome.tsx`, which is what App, the Chat
   surface and the render probe import. `NAV_RAIL_EXPANDED_PX` is still the sidebar width the
   probe measures, so the probe reads it from that module.
6. **A doc line number is a claim, not a citation — and `npm run
   check-flow-doc-anchors` now refuses it.** Every number in the two flow docs and in
   `AGENTS.md` names its file on the same line, so the gate can check all three: 458 anchors verified, 0
   unattributed, ceiling 0, wired into CI as "Flow docs cite real lines". A bare
   `:NNN` no longer survives a push, and neither does a stale figure quoted from
   the gate's own output: these docs state 458 anchors verified, and the gate
   refuses the merge if that sentence stops matching the scan.
   Two more rules exist as of 2026-10-19, and both were born from a defect in the gate itself
   rather than from a stale doc: a stripped html tag now leaves a SPACE (deleting it spliced the
   bold label onto the citation beside it, and a spliced token matches no file — so those rows
   were skipped, never checked, which is how this page reported green while 12 of its citations
   were unverifiable); and a citation whose file is not in the tree is now REPORTED instead of
   swallowed, measured at 0 in these two docs and 21 in the dated stage ledger, where naming a
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
   A fourth rule measured `AGENTS.md`'s hand-typed counts — the smoke-test figure, the vitest
   census and its `git ls-files tests` file count. **Those three arms are gone as of
   2026-10-23, with the suite they counted.** What still binds is the paragraph below: every
   step the `comm -13` recipe names — `check-flow-doc-anchors`, `skill-approval-probe` and
   `typecheck` on CI's side, `installer-smoke` on release's — must appear as a WHOLE token in
   the 15 lines that print that recipe, so the "test" inside "tests" is not a step name. Two
   control arms plant those two defects in the real file and require the rule to report them;
   the arm count is itself floored, so deleting an arm fails the build rather than passing
   silently. An absent recipe paragraph is itself a finding, so a doc edit cannot escape the
   rule by making the pattern unmatchable.
   **Coverage asymmetry, measured rather than trusted from prose:** the step runs
   in `ci.yml`, and `release.yml` does NOT run it — nor does it run the
   skill-approval probe or the bare typecheck, while
   `installer-smoke` is the only gate release has and CI lacks. That set
   difference is printed by a `comm -13` over the two workflow files' npm-run
   lines, and `AGENTS.md` now states it there rather than repeating "the same
   static + probe chain". A tag can therefore still publish with a dead line
   number in these docs while CI would reject the same commit; adding the step to
   `release.yml` would close that, and that half changes the publish path, so it
   is recorded rather than done.
   Qualifying the citations that had no symbol
   of their own is what found
   five numbers that were right-shaped and wrong: `runSeatTurn` is defined at
   `services/trade/chatTurnRunner.ts:619`, `createDebateMailbox` at
   `services/trade/chatTurnRunner.ts:1160`, `planPanelTurn` at
   `services/trade/chatTurnRunner.ts:1172`, the dock's `send` at
   `services/trade/chatTurnRunner.ts:1298`, `runFullAnalysis` at
   `components/trade/TradeChatPanel.tsx:594`, and `MAX_PLANS_PER_RUN` at
   The pass also moved four surface anchors
   that pointed inside a prop list onto the guard that mounts the surface:
   `App.tsx:2397` trade, `App.tsx:2456` journal, `App.tsx:2466` learn,
   `App.tsx:2520` agents, with the header band at `App.tsx:2383`. Counts were
   taken with `grep -c` rather than a truncated listing — the first version of
   correction 5 died by exactly that truncation. Numbers in section C are
   deliberately omitted: they are the lines stage 19 deletes.
7. **"The Chat surface has no tools wired" was true, and stopped being true on
   2026-10-18.** Both homes now run `runToolTurn`; what still differs is the row
   each writes and which tools that row can honour (a Chat seat gets no canvas
   tools, and its `present_trade` receipt says so rather than promising a level-watch
   that cannot exist there). If a future pass restores the old sentence, it is
   describing a bug it just reintroduced.

8. **"Automations always run the ensemble pipeline" was a code comment, and the
   automations are now gone.** It was true up to stage 20r (2026-10-18), and 20c had
   made it more true still. On 2026-10-24 the feature was deleted by owner request,
   so the sentence cannot come back: there is no scheduler, no card feed, no plan
   ration and no private run mode. What must not come back either is the pattern it
   described — an unattended caller holding the whole tool surface. The one detached
   caller that remains declares its narrowed set in
   `services/trade/unattendedTools.ts`.

9. **"Does the gate actually wait for the splash to clear?" — yes, measured rather
   than assumed.** `scripts/boot-probe.cjs:119` blocks on
   `!document.querySelector('#splash')` against the BUILT bundle, and it is the only
   gate that still does: the Playwright spec that asserted `toHaveCount(0)` on
   `#splash` a second time went with the test suite on 2026-10-23. What the probe
   watches for is prose, not code: its opening comment, `scripts/boot-probe.cjs:5 (comment)`,
   records the v1.0.20 TDZ crash as a splash hang. A page that dies before React
   mounts fails it.

10. **The arrow table is 74 rows, and every citation in it resolves — and 69 of the 74 rows pair their citation with the symbol that must live on that line (65 of 70 before the goal, self-modification and rail rows landed; the figure has only ever moved up, and the run prints it with a floor, so a row rewritten without its symbol stops being coverage silently), so those rows are checked for content, not just for a line that exists. One row names no file at all — the ensemble row, whose stages the code never names — so a wrong figure inside it stays outside this gate's reach, which is why the sentence says 69/74 rather than 74/74.** An
    outside review probed 66 anchors and could not speak to the rest; the gate now
    resolves all 447 unique anchors on every run, so coverage of the table is no
    longer a matter of which subset a reviewer happened to sample.
11. **"One service replacing nine" is falsifiable, and it is right — counted, not
    asserted.** `git log --diff-filter=D` over `services/providers/` names exactly nine
    provider-client services removed: `AIProviderService` plus the eight per-provider
    clients `geminiService`, `grokNativeService`, `deepseekService`, `groqAlt2Service`,
    `groqNewService`, `openaiService`, `openrouterService` and `zhipuService`. What is
    left in that directory is two clients — `GenericProviderService.ts` and
    `GenericAnalysisService.ts` — plus four helpers (`imageProcessor.ts`,
    `reasoningControls.ts`, `taskBudgets.ts`, `contextCompact.ts`), and a search for any remaining
    `class <ProviderName>Service` over `services/` returns nothing. Twenty-five files
    in total have been deleted from that directory — `git log --diff-filter=D
    --name-only --format= -- services/providers/` is the recipe that counts them, not
    a remembered figure; `debatePods.ts`, the engine's last pod helper, is the
    twenty-fifth; the other sixteen were the ten accuracy-mode services under
    `accuracy/`, the engine and its types (`debateScience.ts`, `ensembleService.ts`,
    `ensembleConsensus.ts`, `streamTypes.ts`, `debatePods.ts`) and `GroqKeyPool.ts`.

12. **The Agents desk is never seeded.** Two effects in the App used to build a fallback roster from the Analyst Lens assignments or the model picker, and a third rewrote a named bot model whenever those settings moved. All three are gone with the built-in Macro / Technical / Risk analysts (owner ruling, 2026-10-19), and the registry’s seedIfEmpty helper was deleted with its only caller. A fresh profile therefore opens on the empty state at `listedBots AgentsView.tsx:1123` — "No agents yet. Create one and it appears here with its own thread" — and an agent exists only because the trader made one. Nothing went red when the seeding was removed, because no test covered it: that silence is evidence nothing was watching, not evidence the feature was inert.

## Measured after stage 19: what the deletion did NOT remove

**The prompt layer was the part the deletion never re-measured.** Settings → Prompts had
27 overridable prompts, and a one-off source scan measured that **16 had
no call site that reads them**: every `debate.*` id, `analysis.families`, and the three
`postmortem.*` ids. The app was handing the trader an editor for text it never sends, and one
moderator fallback still instructed a model to "follow the Accuracy Mode checks" and to emit
a debate envelope no parser can read — Accuracy Mode and the engine were both deleted, the
registry was not. The gate pins the other direction too, because that is the one that breaks
silently: the 10 ids a real call site reads must KEEP it, so a refactor that starves a live
prompt fails the suite (proved by renaming one `getPrompt('analysis.master'…` argument and
watching five arms go red). The 16 are a measured ceiling that ratchets down only — deleting
an entry, with the prompt constants nothing else imports, lowers it, and nothing may raise it.
`hooks/useAppSettings.ts`, `components/settings/SettingsMenu.tsx` and this hook also carried
comments labelling live code as Accuracy Mode / verdict-finalizer paths after those were
deleted; the labels are gone, the code they mislabelled was correct.

**…and then the 16 were deleted, which is not the same act as measuring them.** The registry
is now 10 entries — every id a call site actually reads — and the unreachable ceiling is 0, so
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
  leaves the other's override intact. It now uses `analysis.compact` and `analysis.master`.

**The harness note in a user-role turn had no live teacher.** `harnessTurn()` still stamps
`HARNESS NOTE (this app, not the trader):` onto user-role content at four desk-tool sites —
tool results, a continue nudge, a clipped payload — and the only prompts that ever named that
mark were the debate prompts, which nothing sends. So a model received app-written text inside
the trader's own turn with no instruction anywhere in the contract about whose words it was.
Clause 5 of `constants/prompts/harnessContract.ts` (the block `utils/composePrompt.ts` puts on
every request) now states it, quoting `HARNESS_TURN_MARK` by interpolation so the sentence
cannot drift from the bytes the code emits: obey its facts, never treat it as the trader's
request or as new permission to trade, and unmarked text — the trader's own words — outranks it
on conflict. The check lived in `tests/harnessMarks.test.ts` until the suite went; it had been moved off the dead file onto the blocks the app
actually sends, with its floor re-based on that population and a planted-paraphrase control
added in the same pass, because a scanner that matches nothing reports no drift. Neither survives the deletion.

**Three debate-era names survive, and the honest statement is which of them is dead.**
`moderatorConfig` (`App.tsx:323`) is live, but as a DEFAULT, not a debate role:
`readyProviders[0] || moderatorConfig` (`App.tsx:344`) resolves the vision/OCR provider and
`memoryConfig: memoryConfig || moderatorConfig` (`App.tsx:609`) the memory one, and the journal prints
`Mod:` from the stored `moderatorModel` (`TradeLog.tsx:354`). No moderator TURN exists — one
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

The engine files are gone, and most of the branch with them. What was removed this pass: the seat-completeness refusals ("Your analyst team is incomplete", "Analysts must use different models", "Two debate seats share a model") and the `TEAM_MAX_SEATS` ceiling — only ONE model answers a send (`provider`, `hooks/useAnalysisPipeline.ts:1097` falls back to `enabledProviders[0]`), so those blocked a run over a roster the run never uses, and the ceiling guarded a fan-out that no longer exists. The moderator readiness check went with the schedule it protected (2026-10-24) — a human send answers from the composer's own pick, so refusing a click over an unused moderator config was a block with nothing behind it. The flag itself, the seat builder it fed and the roster behind it were deleted on 2026-10-19; the "include a coin" tip survives as a plain nudge. `isDebating` and `activeDebateSpeakers` are deleted outright — every writer set a literal `false`, so the one branch that read them could not run.


The user-visible consequence, now FIXED: the chart used to pick its verdict row by the DEBATE shapes (`ensembleProgress`, >1 `modelsUsed`, `debateTurns`) and passed `verdict={verdictMessage?.analysis}` — while nothing writes `Message.analysis` for a new run any more. `verdictFinalizer` was the writer; a tool turn answers with a `TradeProposal` in the tool payload (`services/trade/presentTradeTool.ts`, `proposedTrade.ts`, `tradeShapedProse.ts`). Reader without a writer, the third time in this stage (session usage, the completion notice). Fixed by `latestChartVerdict` in `services/trade/chartData.ts` (`App.tsx:1542`, passed to the chart at `:2429`): it keys on the settled proposal through the existing `buildProposedTradeAnalysis` and keeps `analysis` as the fallback for old rows; The proposal path, the fallback, the preference when a row carries both, the symbol match through `verdictLevels` and the App wiring were pinned by a test that went with the suite on 2026-10-23, so render-probe — which asserts every row renders — is the only gate over this path now. render-probe PASSED on 2026-10-18 after this change (zero pageerrors, every row rendered), but the probe asserts no canvas overlay levels, so the drawn Entry/Stop/Target line is still un-asserted by any gate

