# Ensemble / Debate / Multi-Agent — research baseline

**Repo:** `C:\Dev\august-3.5` · **Tip at time of writing:** `2b4d4fa2` · **Date:** 2026-10-22
**Scope:** what ensemble / debate / moderator / clarification capability exists in code the app can
actually reach today; what was deleted, when and why; the multi-agent model as it now stands; and
the vestigial residue a cleanup should remove.

**Method (read-only).** Full read of `docs/plans/debate-deletion-status.md` (2,407 lines — the
record of the deletion), every file named in the brief, plus a case-insensitive sweep of
`ensemble` / `moderator` / `clarif` / `debate` over `hooks services utils components constants
types schemas scripts electron App.tsx index.tsx`, and `git log --diff-filter=D` plus `git show`
on the deletion commits. Every "does not exist" claim below names what was searched.

> **Headline.** The ensemble **debate engine does not exist**. What replaced it is a *single-model
> tool-calling turn* plus **three separate, live multi-agent surfaces** that are NOT a debate:
> the chart dock's multi-seat **panel**, the **Agents roster** (1:1 bot chats + teammate DMs), and
> **group rooms**. There is **no moderator turn**, **no judge/arbiter role**, and **no clarification
> cycle** — and there never was a *trader-facing* clarification cycle to lose (see §5). The
> multi-agent surface is substantial and genuinely works. The residue is in the *vocabulary*:
> a large amount of dead moderator/debate/arbiter scaffolding is still exported, still prompted to
> models, and still rendered.

---

## 1. FEATURE list

Verdicts: **REAL** = reachable from the running app and does something ·
**COSMETIC** = the code exists but no live producer / consumer, or it only ever renders legacy rows ·
**DELETED** = the capability is gone; the evidence is the absence plus the deletion commit.

| # | Feature | Verdict | Evidence |
|---|---|---|---|
| 1 | **Single-model tool turn** — one request, one model, desk-tool calling, no keyword routing | **REAL** | `services/trade/toolTurn.ts:131` (`runToolTurn`); `services/trade/chatSurfaceTurn.ts:57,308`; `services/trade/chatTurnRunner.ts:100,672`; `services/trade/automationTurn.ts:62,203`; routing comment `hooks/useAnalysisPipeline.ts:1218-1224` |
| 2 | **Scheduled-run tool turn** — third sink, own ration, own bad news | **REAL** | `services/trade/automationTurn.ts:214-276`; caps `services/trade/automationTurn.ts:81`, `services/automation/AutomationService.ts:113` |
| 3 | **Chart-dock multi-seat PANEL** — up to 5 models *or* roster agents answering one request together | **REAL** | UI: `components/trade/TradeChatPanel.tsx:1034-1035` ("New panel · up to 5 models"), seat picker `:1112-1138`; engine `services/trade/chatPanel.ts:81` (`planPanelTurn`), `:97` (`formatRoomTranscript`), `:107` (`parsePanelMentions`); runner `services/trade/chatTurnRunner.ts:1144-1300`; session kind `services/trade/chatSessions.ts:106,207` |
| 4 | **Panel closing synthesis seat** — the last seat summarises the panel | **REAL** (closest thing to a moderator that survives) | `services/trade/chatPanel.ts:87-91`; `services/trade/chatTurnRunner.ts:1199-1201` (the synthesis turn prompt) |
| 5 | **Panel cross-talk by @mention** — a seat can pull a peer in mid-round | **REAL** | `services/trade/chatPanel.ts:107-122`; `services/trade/chatTurnRunner.ts:1273-1276` |
| 6 | **Inter-seat direct messaging over real tool calls** (`send_message` / `read_message`) | **REAL** — but **only inside the dock panel** | `services/analysis/DebateMailbox.ts:48` (`createDebateMailbox`), `:115` (`DEBATE_MAIL_TOOLS`); live construction `services/trade/chatTurnRunner.ts:1162`; tool merge `services/analysis/DeskToolsService.ts:4255,4245`; dispatch `:4374-4388`; inbox notice `:4295-4300` |
| 7 | **Named agent roster** (bots: name, title, provider/model, notebook scope, instructions) | **REAL** | `services/agents/agentRoster.ts:20-45` (`AgentBot`), `:47-53` (`AgentGroup`), `:95` (`getBots`), `:117` (`getGroups`), `:138-152` (CRUD); migration that strips the deleted role/enabledTools `:95-115` |
| 8 | **Agent 1:1 threads as derived views over one flat message array** | **REAL** | `utils/agentThreads.ts:42` (`threadForProvider`), `:118` (`deskThread`), `:160` (`threadForGroup`), `:206` (`splitGroupThreads`), `:261` (`unreadCount`) |
| 9 | **Teammate DM mailbox** (`[[dm:@handle]]` markers, `[[constraints:…]]`, `[[expecting:…]]`) | **REAL** | `services/agents/botMailbox.ts:84` (`parseDmMarkers`), `:133` (`buildTeammateProtocolSection`), `:220` (`validateDM`); drain loop `hooks/useBotMailbox.ts:130,265,317`; caps `services/agents/botMailbox.ts:33-42` (TTL 15 min, 3 hops, fanout 2, 12/60 s rate) |
| 10 | **Group rooms** (`useAgentGroups`) — a prompt fans out to room members with an activity feed | **REAL** | `hooks/useAgentGroups.ts:126` (`runGroupThread`); room UI `components/chat/GroupChatView.tsx`; mounted `App.tsx:1232-1249` |
| 11 | **Group-round semantics** — bounded round-robin, deterministic @mention routing, `(pass)` = silence, per-member incremental context | **REAL** | `services/agents/groupRounds.ts:16-18` (`ROOM_ROUND_CAP=3`, `ROOM_TURN_CAP=12`), `:31-41` (pass token), `:49` (`parseRoomMentions`), `:70` (`buildRoomProtocolSection`), `:109` (`renderRoomTurn`); driver `hooks/useAgentGroups.ts:182-329` |
| 12 | **Bot memory isolation** (`memoryScope`: global / personal / isolated) | **REAL** | field `services/agents/agentRoster.ts:18,34`; toggle `components/chat/NewBotDialog.tsx:86`; per-bot notebook folder `services/bots/BotMemoryService.ts:13`; shared-retrieval gate `services/agents/botLearning.ts:87`; chart-AI merge filter `hooks/analysisPipeline/memoryContext.ts:111`; budgets `services/bots/botMemoryBudget.ts:15,23`; display `components/agents/AgentDetailCard.tsx:27-38` |
| 13 | **Bot learning loop** — lesson write-back to `memory.md`, skill craft + evidence gate, shared-evidence fold | **REAL** | `services/agents/botLearning.ts:169` (`lessonFromBotTurn`), `:225` (`craftAndGateBotTrade`), `:277` (`recordBotTurnOutcome`), `:342` (`botLessonCount`), `:362` (`loadBotLearningStats`); room flush `hooks/useAgentGroups.ts:330-348` |
| 14 | **Bot attention classification** (why a bot cannot answer, with a fix hint) | **REAL** | `services/agents/botAttention.ts:30` (`classifyBotAttention`); consumed `App.tsx:96,1185` |
| 15 | **Bot-scoped routines** (a scheduled run that executes *as* a bot) | **REAL** | `services/agents/botRoutine.ts:80` (`runBotRoutineTurn`), `:56` (`BOT_ROUTINE_HOP`), `:142` (`botRoutineMessageRow`); wired `hooks/useAutomations.ts:374,444-447` |
| 16 | **Seat personas** — a bot is its own instructions, else the general-analyst default | **REAL** | `services/agents/seatPersonas.ts:12` (`GENERAL_ANALYST_DEFAULT_PROMPT`), `:20` (`seatHasPersona`), `:24` (`seatPersonaPrompt`); assembled `services/agents/agentContext.ts:68` (`resolveAgentContext`) |
| 17 | **Unified agent-context loader** (persona + notes + model, one place) | **REAL** | `services/agents/agentContext.ts:68`; consumers `components/trade/TradeChatPanel.tsx:477`, `services/agents/botLearning.ts:259` |
| 18 | **Prompt registry** — 13 ids, zero `debate.*` | **REAL** | `constants/promptIds.ts:17-31`; `constants/promptRegistry.ts:57-164` |
| 19 | **MODERATOR TURN** (a separate LLM seat that synthesised a binding verdict) | **DELETED** | deleted `48c3ee81` (2026-10-18, "stage 19's second tranche — the debate engine is deleted") — `services/providers/ensembleService.ts` (3,638 lines) and `constants/prompts/debatePrompts.ts` (deleted `04aff79a`, 2026-10-19). The prompts `MODERATOR_SYSTEM_PROMPT_V2`, `PURE_AI_MODERATOR_PROMPT`, `MODERATOR_FINAL_VERDICT_PROMPT`, `MODERATOR_FINAL_AUTHORITY_PROTOCOL` no longer exist anywhere in the tree. |
| 20 | **ANALYST-ROLE SYSTEM** (Macro / Technical / Risk seats, lens prompts, per-role tool presets) | **DELETED** | deleted `6e1e09bb` (2026-10-19) — `services/ui/AnalystLensService.ts`, `services/ui/EnsembleAnalystService.ts`, `hooks/useLensAndEnsembleConfig.ts`, `utils/debateEnvelopes.ts`; role vocabulary gone (`services/agents/seatPersonas.ts:1-9` says so); `types/enums.ts` Analyst Lens enum deleted |
| 21 | **CLARIFICATION CYCLE** (moderator asks analysts targeted questions, analysts answer, moderator judges) | **DELETED** | `MAX_CLARIFICATION_CYCLES = 3` lived at `services/providers/ensembleService.ts:1152` (file deleted in `48c3ee81`); the three prompts (`MODERATOR_CLARIFICATION_QUESTIONS_PROMPT`, `ANALYST_CLARIFICATION_RESPONSE_PROMPT`, `MODERATOR_CLARIFICATION_JUDGMENT_PROMPT`) were in `constants/prompts/debatePrompts.ts` (deleted `04aff79a`) |
| 22 | **Consensus / conviction auction / seat trust / gate reconciliation / level-evidence extraction** | **DELETED** | `48c3ee81` — `services/providers/ensembleConsensus.ts` (311 lines), `utils/debateLevels.ts`, `utils/levelKeywords.ts`, `utils/levelEvidence.ts`, `utils/ungroundedGate.ts`, `services/learning/preflight.ts` |
| 23 | **Verdict finalizer** (the single place the verdict's probability/label/evidence/citations were stamped) | **DELETED** | `hooks/analysisPipeline/verdictFinalizer.ts` (709 lines) deleted in `48c3ee81`; its capabilities were re-homed one at a time (the scalp/swing label → `hooks/useTradeLogging.ts:369,777`; the completion notice → `hooks/useAnalysisPipeline.ts:1506-1513`; session usage → `utils/sessionUsage.ts:63`) |
| 24 | **2D debate floor** (DeskScene, PixelSeat, SpeechBubble, VerdictCard, DeskSteerInput) | **DELETED** | `854bd580` (2026-10-18) — 9 modules + 21 test files |
| 25 | **Global Moderator picker** (pick the model that moderates the debate) | **DELETED** | 2026-10-20 owner ruling, recorded in `docs/plans/debate-deletion-status.md:2407`; the surviving `moderatorConfig` is now only the *fallback provider* (`App.tsx:323-336`) |
| 26 | **Debate-derived journal history** (saved analyses, dissent tally, conviction auction card, live-stream view) | **DELETED** | `591f735` (2026-10-18) |
| 27 | **Post-mortems** (the closed-trade lesson chain the debate's analysts fed) | **DELETED** | `03fc0d5` (2026-10-17) — `usePostMortem`, `MistakePatternService`, `JobQueueService`. **Accepted consequence recorded in the status doc (`:3-8`): the closed-trade learning chain stops working with no replacement.** |
| 28 | **Debate prompt-registry entries** (12 `debate.*` ids) | **DELETED** | `04aff79a` (2026-10-19) — `constants/prompts/debatePrompts.ts` and its barrel line |
| 29 | **Debate-era `Message` fields** (`ensembleProgress`, `debateRunLog`, `debateCheckpoint`, `provisionalAnalysis`, `provisionalPlanFields`, `isDebating`, `activeDebateSpeakers`, `replacementOffer`) | **DELETED** | `1af3c6e7` (2026-10-18) + the 2026-10-19 passes recorded at `docs/plans/debate-deletion-status.md:1714-1728` |
| 30 | **`Message.debateTurns`** — legacy transcript field | **COSMETIC** — no producer; four legacy readers only | field `types/message.ts:184`; copies `hooks/useTradeLogging.ts:427`, `utils/watchList.ts:30`; readers `utils/analysisUtils.ts:903,940,969`, `utils/reportExport.ts:241`, `hooks/useWatchAndAutopilot.ts:105`, `services/learning/monthlyReport.ts:224` |
| 31 | **Debate marker sanitizers** (`<CLARIFICATION_*>`, `<MODERATOR_RETRY>`) | **REAL** (2 of 9 exports) | `constants/debateMarkers.ts:23,24` → `utils/analysisUtils.ts:18,859,860` |
| 32 | **`ARBITER_ALLOWED_TOOLS`** | **COSMETIC** — a dead policy | `services/analysis/DeskToolsService.ts:3364-3380`; **no production importer** — only `tests/evidencePack.test.ts:33` and `tests/tradeLogTool.test.ts:11` |
| 33 | **One-tap debate templates** (Scalp check / Swing thesis / Devil's advocate / Risk-only pass) | **COSMETIC** — extraction live, steering dead | `utils/debateTemplates.ts:18-44`; extraction `hooks/useAnalysisPipeline.ts:667-677`; **no UI produces a marker** (`debateTemplateMarker` has no production consumer); `template.steering` and `skipToVerdict` are read by nothing outside the module + `tests/debateTemplates.test.ts` |
| 34 | **Run-contract stage ladder** (gate → openings → rebuttals → clarification → verdict → journal) | **COSMETIC** — types only, legacy rows only | `utils/runContract.ts:1-20` (explicitly types-only); `components/analysis/RunContractPanel.tsx:32-37` still names the six deleted stages |
| 35 | **`Message.evidencePack`** ("what the moderator was actually shown") | **COSMETIC** — legacy rows only | type `types/message.ts:285`; renderer `components/analysis/VerdictAudit.tsx:58,100`; producer (`buildVerdictEvidencePack`) deleted with the finalizer |
| 36 | **Monthly report "ensemble line" + "legacy moderator" Brier cells** | **COSMETIC** — legacy rows only | `services/learning/monthlyReport.ts:131-138,186,224-228,252-253`; rendered `components/journal/MonthlyReportCard.tsx:64-67` |
| 37 | **Mid-run "steer a seat" / "stop a seat" / "replace an analyst"** | **DELETED capability, LIVE-but-dead handlers** | handlers exported `hooks/useAnalysisPipeline.ts:1778,1790-1797`; **zero consumers**; `seatSteeringRef` (`:353`) and `stoppedSeatsRef` (`:355`) are written and never read; `replacementChoiceRef` (`:361`) is never set to a pending resolver (only nulled at `:365,1536`), so `handleReplacementChoice` can never act |
| 38 | **Conversation-level steering queue** (words typed during a live run park and drain as a follow-up turn) | **REAL** | `hooks/useAnalysisPipeline.ts:617-630` (park), `:430-437` (store), `:1750-1757` (drain) |
| 39 | **Settings cleanup of the removed preference keys** | **REAL** | `services/infrastructure/legacySettings.ts:9-15` (`analyst_lens_config`, `ensemble_model_selection`, `custom_ensemble_prompt`, `custom_lens_prompts`, `last_moderator_pick_v1`), `:20` (`bots_v1_` prefix), `:22` (`stripRemovedAppSettings`) |
| 40 | **Stored-profile migration** (roster rows lose `role`/`enabledTools`; profiles lose `isEnsembleEnabled`; providers lose `ensembleModels`) | **REAL** | `services/agents/agentRoster.ts:95-115`; `hooks/useUserProfileLoader.ts:360-364`; `services/infrastructure/ProviderConfigService.ts:190-193` |

---

## 2. What was removed and why

### 2.1 The owner order (the reason, in the owner's words)

`docs/plans/debate-deletion-status.md:1-8`:

> Owner order (2026-10-17): remove the ensemble debate **and** its related features; keep Monte
> Carlo, key levels, watch list and price alerts as chat tools; delete post-mortems entirely;
> delete accuracy mode + the calibration ledger. **Accepted consequence: the closed-trade learning
> chain … stops working with no replacement.**

The replacement was then chosen by explicit ruling (`:110-116`):

> *"I want the number 1 but the model should be able to do all that using tool call not just when
> the keyword 'analyze this' it will trigger, we will focus on tool calling, skills, and memory."*

So the target was **one analyst pass reached by tool calling**, not a shrunken debate.

### 2.2 The deletion, in commits

| Date | Commit | What went |
|---|---|---|
| 2026-10-04 | `fe47606f` | dead debate floor: `DebateBotAvatar.tsx`, `DebateStage.tsx` |
| 2026-10-17 | `03fc0d5` | post-mortem + the lesson chain (`usePostMortem`, `MistakePatternService`, `JobQueueService`) — ~1,450 lines in survivors |
| 2026-10-18 | `854bd580` | the 2D debate floor: DeskScene, PixelSeat, SpeechBubble, VerdictCard, DeskSteerInput, floorLayout, roomLayout, roleOverrides, DeskSeatMappingEditor, `debateStageActors` + 21 test files |
| 2026-10-18 | `591f735` | debate-derived history: BotSeatOverridesDialog, SavedAnalyses, dissent tally, Conviction-auction card, LiveStreamView |
| 2026-10-18 | `cf1c6e68` | Settings: the `lenses` (Roles) tab, `AnalystLensSettings`, the "Team analysis" switch |
| 2026-10-18 | **`48c3ee81`** | **the engine island** — 62 files, **11,664 deletions**: `services/providers/ensembleService.ts` (3,638), `ensembleConsensus.ts` (311), `debateScience.ts` (286), `utils/debate*.ts` ×10, `hooks/analysisPipeline/verdictFinalizer.ts` (709), `services/analysis/analysisResultProcessor.ts` (352), `services/learning/preflight.ts` (106), `services/learning/lensMemoryRecord.ts` (140), `constants/prompts/archetypePrompts.ts`, `utils/runGantt.ts`, `utils/keptAnalyst.ts`, `utils/provisionalVerdict.ts`, `utils/recommendationContract.ts`, `utils/verdictSkillDraft.ts`, `utils/levelEvidence.ts`, `utils/levelKeywords.ts`, `utils/ungroundedGate.ts`, `utils/hybridChartDrift.ts`, `utils/analysisReport.ts`, `utils/analysisTrace.ts`, `CompletionNotifications` + 24 test files |
| 2026-10-18 | `1af3c6e7` | debate-era `Message` fields |
| 2026-10-19 | `04aff79a` | `constants/prompts/debatePrompts.ts` + 16 unreachable `debate.*` registry ids |
| 2026-10-19 | `6e1e09bb` | the analyst-role system: `services/ui/AnalystLensService.ts`, `services/ui/EnsembleAnalystService.ts`, `hooks/useLensAndEnsembleConfig.ts`, `utils/debateEnvelopes.ts` + stored-profile migration |
| 2026-10-20 | `8cae97c7` | `services/providers/debatePods.ts` (the last engine file) |
| 2026-10-20 | (status doc `:2407`) | the global Moderator picker |

### 2.3 What was LOST (the old engine's actual capabilities)

Recovered from `git show 48c3ee81^:services/providers/ensembleService.ts` (3,638 lines):

- **A moderator seat with its own provider/model** — `getModeratorAnalysisStream` (old `:287`),
  `MODERATOR_SYSTEM_PROMPT_V2`, `PURE_AI_MODERATOR_PROMPT`, `MODERATOR_FINAL_AUTHORITY_PROTOCOL`,
  `MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT`, `MODERATOR_FINAL_VERDICT_PROMPT[_COMPACT]`.
- **The clarification cycle** — `MAX_CLARIFICATION_CYCLES = 3` (old `:1152`); per cycle the
  moderator asked each analyst 1–2 targeted questions (exact TP2/TP3, hit-probabilities, R:R
  math), the analyst answered in 60–100 words, and the moderator judged `SATISFIED` /
  `UNSATISFIED`, repeating up to 3 times. Old `:2692-2811`.
- **A multi-round debate** — openings → rebuttals (`REAL_DEBATE_RESPONSE_ROUNDS = 2`) → clarification
  → verdict, with `DebateProtocol` lanes (`standard` / `extended` / `efficient`), a 8-minute
  wall-clock budget, and a divergence score that decided whether clarification was worth running
  (old `:1858`).
- **Consensus machinery** — `buildConvictionAuctionBlock` (old `:1328`), `buildSeatTrustBlock`
  (old `:1359`), `ensembleConsensus` weighted log-odds, `recalculateProbabilities` (old `:3549`).
- **Gate reconciliation** — `generateGateReconciliationContext` (old `:185`) and the
  `MODERATOR_MUST_ASK` / `GATE_CAP_CHALLENGE` / `GATE_CAP_CRITICAL` machinery, where the
  moderator had to justify exceeding the Gate's confidence cap.
- **Final verdict stamping** — `verdictFinalizer.ts`'s ~15 application sites: probability clamping
  to the gate, confidence-band derivation, banned-vocabulary flagging, recommendation contract,
  evidence pack, verdict citations, skill drafting, session usage, completion notification.
- **Two-way / three-way post-mortem debates** — `conductTwoWayPostMortemDebate` (old `:3482`),
  `conductThreeWayPostMortemDebate` (old `:3583`).

### 2.4 Was the replacement adequate?

**For the trading product: broadly yes.** Every verdict-producing capability was re-homed onto
the tool turn rather than lost:

- verdict → `present_trade` tool (`services/trade/presentTradeTool.ts`), plus trade-shaped prose
  → `services/trade/tradeShapedProse.ts`;
- levels → `mark_trade_levels`; Monte Carlo → `run_monte_carlo`; market data → `get_market_packet`
  / `get_price_snapshot` / `get_order_book` / `get_derivatives` / `get_liquidations`;
- memory → `recall` / `get_setup_history_stats`;
- the gate scan → inside `present_trade` (`services/validation/`);
- the chart's verdict line → `latestChartVerdict` (`services/trade/chartData.ts:95`).

**For the multi-agent product: the replacement was not a replacement — it was a *different
product*, and it survived.** The status doc is explicit (`:1754-1802`): "what is left under the same
name is a different product surface: a multi-agent room on the chart dock … shared machinery with
the `group` session kind that stays." The status doc's own framing (`:1796-1801`) is that this is
**not** a leftover and was therefore deliberately *not* deleted — "the 'they answer together'
feature, not a leftover of the debate."

**Where the replacement is NOT adequate — three named losses:**

1. **The closed-trade learning chain is dead** (status doc `:3-8`). `craftSkillFromPostMortem`
   (`services/learning/SkillCraftService.ts:140`) is still called from
   `services/agents/botLearning.ts:234`, but its guard `if (pm.length < 40) return null` (`:145`)
   makes it answer `null` for every trade closed after 2026-10-17, because nothing writes a
   post-mortem any more. The route was **starved, not deleted**.
2. **The moderator's judgement was replaced by *more data*, not by a judge.** The Gate Keeper
   scan, the pattern-memory enforcement block and the session-guard block are all now dead
   producers (see §6), so nothing weighs the model's answer against the trader's own history any
   more. `services/learning/PatternMemorySynthesisService.ts:1054-1070` still *writes* a
   "MODERATOR ENFORCEMENT / MANDATORY QUESTIONS" block — but nothing calls it.
3. **No multi-model synthesis in the Agents surface.** The panel's closing seat (feature #4) is the
   only place several models' opinions are reconciled today, and it lives on the *chart dock*,
   not on the Agents surface, where rooms run members **serially** with no synthesis seat at all.

---

## 3. The multi-agent model today

### 3.1 The three surfaces (two stores, one mirrored thread)

| Surface | Entry point | Runner | Fan-out | Synthesis seat? |
|---|---|---|---|---|
| **Chart dock panel** | `components/trade/TradeChatPanel.tsx:1034` | `services/trade/chatTurnRunner.ts:1144-1300` | up to 5 seats (models **or** roster agents) | **Yes** — last seat (`chatPanel.ts:87-91`) |
| **Agents 1:1 bot chat** | `hooks/useBotMailbox.ts:305` (`runUserBotTurn`) | `hooks/useBotMailbox.ts:130` (`runBotTurn`) | 1 | No |
| **Agents group room** | `hooks/useAgentGroups.ts:126` (`runGroupThread`) | same | N members, serial, ≤3 rounds / ≤12 model turns | **No** |

The Agents surface reads App's `messages`; the chart dock reads `services/trade/chatStore.ts`
(`components/agents/AgentsView.tsx:10-25` documents both writers). They are two row SHAPES
over one thread: `startEntryMirror` (`services/trade/chatTurnMirror.ts`) projects the dock's
live entry into the conversation under the same id, and `liveEntryFromMessage`
(`services/trade/chatSessions.ts:491`) carries `Message.isStreaming` back. (This section
originally read "the same persona over two different transcripts"; the merge and the mirror
made that false — corrected 2026-10-23.)

### 3.2 How a GROUP ROUND works — step by step

Source: `hooks/useAgentGroups.ts:126-348`, `services/agents/groupRounds.ts`.

1. **Seed** — the trimmed prompt is appended once as a `USER` row stamped `roomId: group.id`
   (`useAgentGroups.ts:144-150`); a `sent` activity entry is pushed.
2. **Round-1 speakers** — `parseRoomMentions(trimmed, members)` (`:140`) resolves `@handle`
   tokens against the live roster (exact handle, no-space collapse, title — `botMailbox.ts:61-70`).
   `@everyone` → all members. **No mention → every member speaks once** (`:141`), which is the
   single-pass fan-out parity.
3. **One live read for the room** — if Hybrid Intelligence is on, `tryFetchHybridDataFromPromptWithCalibration`
   runs **once** (`:163`) and the same injection is appended to **every** member's system prompt (`:210`).
4. **Per-member incremental context** — each member tracks `lastSeen` (`:173,200-205`). A member is
   fed **only** the room entries newer than what it last saw; its own lines render as "You"
   (`groupRounds.ts:109-111`). This is what makes multi-round cheap.
5. **System prompt** — `buildRoomSystemPrompt` (`groupRounds.ts:90-103`) = persona
   (`system.md`) + role block (only if the bot has its own instructions) + private notes
   (`memory.md`) + the room protocol (`groupRounds.ts:70-83`). The room protocol explicitly
   forbids the 1:1 `[[dm:@…]]` markers: **"@mentions are how this room routes."**
6. **Transport** — `streamQuickResponse` (`:228-246`), i.e. **chat-only, no desk tools**. The
   bot's provider/model is used (`:212`). Streaming is throttled to one patch per 120 ms.
7. **`(pass)` = silence** — `isPassReply` (`groupRounds.ts:33`); the bubble is left **empty and
   hidden** (`:261`) and **no room entry is added**. `couldStillBePass` holds the bubble empty while
   the stream could still collapse into a pure pass (`:239`).
8. **Routing for the next round** — `parseRoomMentions(finalText, members)` on the reply, self
   excluded, populates `nextSpeakers` (`:299-301`). A round in which nobody was addressed settles
   the room (`:327-328`).
9. **Bounds** — `ROOM_ROUND_CAP = 3` rounds and `ROOM_TURN_CAP = 12` model turns per send
   (`groupRounds.ts:16-18`, enforced `:182,186`). A non-ready provider becomes a visible
   "provider offline" activity entry (`:191-193`).
10. **Settlement / learning** — in the `finally` (`:330-348`), each participant that spoke earns
    **one** write-back (not one per reply — `:280-295`) via
    `recordBotTurnOutcome` → lesson line into its own `memory.md` + closed-trade fold into the
    shared evidence path.

### 3.3 How a bot's MEMORY is isolated

Three independent layers, all live:

1. **Notebook folder** — every bot owns a folder `bots-<slug(botId)>` holding `system.md` (persona)
   and `memory.md` (learned notes): `services/bots/BotMemoryService.ts:13`
   (`botMemoryFolderName`), `:22`/`:27` (the two readers). `getBotMemoryContext` (`:48-85`) reads
   both, filters `memory.md` by the setup query, and clips to a byte budget — and says so in the
   canonical clip dialect rather than head-slicing silently (`:70-81`).
2. **Scope** — `memoryScope: 'global' | 'personal' | 'isolated'`
   (`services/agents/agentRoster.ts:18,34`). Enforcement points:
   - shared-notebook retrieval returns `''` for a non-global bot —
     `services/agents/botLearning.ts:87`;
   - the chart-AI merge only folds in global bots' notes —
     `hooks/analysisPipeline/memoryContext.ts:111`;
   - the routine path passes the scope through — `hooks/useAutomations.ts:374`.
3. **Budgets** — `BOT_MEMORY_PER_AGENT_CHAR_BUDGET = 900`,
   `BOT_MEMORY_TOTAL_CHAR_BUDGET = 1800` (`services/bots/botMemoryBudget.ts:15,23`), with
   `SINGLE_AGENT_MEMORY_BUDGET` (`services/agents/agentContext.ts:84`) for a surface answering as
   one agent. A roster merge divides the total instead of first-come-first-served
   (`hooks/analysisPipeline/memoryContext.ts:113-116`).

---

## 4. Where is the "moderator" now?

### 4.1 Does a moderator exist? **No.**

Searched: `moderator|Moderator|MODERATOR` across `hooks services utils components constants types
schemas scripts electron App.tsx index.tsx` — 438 matches, of which **every one** is a comment, a
type member, a legacy data field, or the fallback-provider variable. There is **no moderator seat,
no moderator prompt, no moderator turn, and no moderator arbitration step.**

What survives, and what each actually is:

| Surviving name | Where | What it really is | Verdict |
|---|---|---|---|
| `moderatorConfig` | `App.tsx:323-336` | the **fallback provider** — first healthy ready provider, used behind vision/OCR (`App.tsx:351`), memory (`App.tsx:617`) and the strategy search (`App.tsx:2477`). The comment says so outright. | COSMETIC name |
| `moderatorConfig` / `moderatorModel` | `hooks/useAnalysisPipeline.ts:150-151,284,576-577` | the **schedule's answering seat**: `automationSeatFor(runModeratorConfig, runModeratorModel, …)` (`:1236-1241`). A scheduled run answers with the model its own automation names. | COSMETIC name, REAL behaviour |
| `AutomationConfig.moderatorModel` | `types/automation.ts:43-44`; editor `components/automation/AutomationEditorModal.tsx:168-169,244-264,511-512` | the per-schedule model pick. The editor's own comment says: *"seat — 'moderator' is the debate role that was deleted with the…"* | COSMETIC name, REAL behaviour |
| `Conversation.moderatorProviderId` / `moderatorModel` | `types/trade.ts:333-334`; `hooks/useConversations.ts:35-36`; `App.tsx:296,614-615` | **legacy persisted fields** — the deleted per-conversation moderator pick | COSMETIC (legacy data) |
| `LoggedTrade.moderatorProvider` / `moderatorModel` | `types/trade.ts:134-135`; written `hooks/useTradeLogging.ts:424-425`; rendered `components/journal/TradeLog.tsx:354` as **"Mod (legacy): …"** | legacy journal column | COSMETIC (legacy data) |
| `moderatorModel` on the monthly report | `services/learning/monthlyReport.ts:78,185-218,303`; `components/journal/MonthlyReportCard.tsx:64` | grades legacy rows, labelled *"moderator (legacy)"* (`monthlyReport.ts:210`) | COSMETIC (legacy data) |
| `EFFORT_BY_TASK.moderatorVerdict` / `.rebuttal` / `.clarification` | `services/providers/reasoningControls.ts:72-78` | schedule entries with **no production caller** (`effortForTask` is called with `'analysis'`, `'chat'`, `'postMortem'`, `'ocr'`, `'supervision'` only) | COSMETIC (dead schedule rows) |
| `TASK_BUDGETS.rebuttal` / `.clarification` | `services/providers/taskBudgets.ts:15-17` | same — no production consumer | COSMETIC (dead budget rows) |
| `skill` audience `'moderator'` | `services/learning/MemoryRetrievalService.ts:204,440,480-483,533,733,748,786,851`; `services/trade/tradeChatContext.ts:248`; `services/learning/SkillMemoryService.ts:390,818,3862,3901` | an **audience axis that survives only on legacy skill files** — `SkillMemoryService.ts:389` says so: *"so 'moderator' survives only on legacy files."* The analyst index **filters them out** (`:3906`). | COSMETIC (legacy axis) |
| `ThinkingRole = 'analyst' \| 'moderator' \| 'debate_turn'` | `types/thinking.ts:12`; branch `utils/thinkingSplit.ts:441` | the type union still admits three roles; nothing writes `'moderator'` or `'debate_turn'` any more (only tests do) | COSMETIC (dead type members) |
| `RolePreset` `'moderator'` (+ `risk`/`macro`/`technical`/`sentiment`) | `components/chat/pixelAvatars.ts:40-49,81` | **still reachable**: `components/chat/NewBotDialog.tsx:28-29` derives the picker's choices from `Object.keys(ROLE_ACCENTS)`, filtering only `'unknown'` and `'postmortem'` — so the live New Bot dialog offers "Moderator" (and the three analyst roles) as avatar presets, defaulting to `'macro'` (`:43`) | COSMETIC **and live in the UI** |
| `DebateSpeaker = string \| 'Moderator'` | `types/enums.ts:43` | the union still admits `'Moderator'` | COSMETIC (legacy type) |
| `PatternMemoryGateView.mandatoryQuestions` | `types/message.ts:388-389` — *"Questions the moderator was forced to address."* | the producer is alive (`services/learning/PatternMemorySynthesisService.ts:895-970`) but the **consumer** (`generatePatternMemoryEnforcementContext`, `:982`) has no production caller | COSMETIC (dead consumer) |
| `services/validation/calibrationPolicy.ts:753,758,808` — *"INSTRUCTION FOR MODERATOR: Weight X's analysis more heavily"* | live text | still injected into the hybrid packet that a **single** model reads (`services/analysis/HybridIntelligenceService.ts:1269-1276,1291`). It addresses a moderator that does not exist. | COSMETIC **and live in the prompt** |

### 4.2 Is there a judge / arbiter role?

**There is no arbiter seat.** The word survives in three places:

1. **`ARBITER_ALLOWED_TOOLS`** — `services/analysis/DeskToolsService.ts:3364-3380`:
   ```ts
   export const ARBITER_ALLOWED_TOOLS = [
       'recall', 'recall_chat', 'get_setup_history_stats',
       'get_trade_log', 'get_session_context', 'web_search',
       'read_tool_output', 'forge_tool', 'amend_memory',
   ] as const;
   ```
   Its own doc comment (`:3334-3340`) explains the policy: *"the moderator's binding verdict is an
   argument-quality decision, so its DEFAULT desk is memory + context only … the clarification
   rounds inherit the same policy (W6). Analysts keep their bot-role presets — this constrains the
   arbiter only."*
   **It is dead.** The only importers in the whole repo are two test files
   (`tests/evidencePack.test.ts:33,97-101` and `tests/tradeLogTool.test.ts:11,112`); the one
   production mention is a *comment* at `DeskToolsService.ts:2375` listing it as an example of a
   caller-supplied allow-list. No seat, no run, no prompt ever reads it.
   The tool allow-list it was meant to feed **is** live and enforced — but the live allow-lists
   are `TRADE_TOOLS` (`services/trade/chatTurnRunner.ts:100`), `CHAT_SURFACE_TOOLS`
   (`services/trade/chatSurfaceTurn.ts:57`) and `AUTOMATION_TOOLS`
   (`services/trade/automationTurn.ts:62`).
2. **`services/learning/harnessLessons.ts:14`** — a comment naming "the ensemble's arbiter".
3. **`services/learning/EvidencePackService.ts:2`** and **`components/analysis/EvidencePackCard.tsx:29`**
   — "the arbiter's proactive evidence" / "exactly what the arbiter saw". The *service* is live
   (the evidence pack is a tool result); the *arbiter* is not.

### 4.3 The one place a "judge" still exists — and it is not a moderator

The **panel's closing synthesis seat** (`services/trade/chatPanel.ts:87-91`,
`services/trade/chatTurnRunner.ts:1199-1201`):

> *"You are the LAST seat. Write ONE final answer for the user that synthesizes the whole panel
> above: agree where they agree, name where they disagree, and give the single actionable read of
> this chart."*

This is a **synthesis seat, not a judge**: it is one of the panel's own seats (usually the same
provider/model as another seat), it has the same desk tools, and it is chosen by position, not by
role. It does **not** get `ARBITER_ALLOWED_TOOLS` (which is dead anyway) and it does **not** have
a reduced tool desk.

---

## 5. Is there any "clarification cycle"?

### 5.1 The brief's phrasing ("the model asking the trader a question mid-turn") — **does not exist.**

Searched: `askUser|requestClarification|askForClarification|ask the trader|asking the trader|
awaiting (the )?(trader|user) answer|pendingQuestion|questionForTrader` across every `.ts`/`.tsx`
in the repo → **0 matches**. Searched `clarif|Clarif|CLARIF` → 41 matches, all resolved below.

The only *live* prompt that even mentions asking a question is the scheduled-run mandate, and it
says the opposite (`constants/prompts/chatPrompts.ts:63`):

> *"A SCHEDULED RUN, NOT A CONVERSATION: nobody is reading this live … **Do not ask a question you
> cannot have answered**; answer the best you can and mark what is missing."*

**There was never a trader-facing clarification.** The old clarification cycle was
**model→model**: the *moderator* asked the *analysts* questions and the analysts answered.
Recovered from `git show 04aff79a^:constants/prompts/debatePrompts.ts:457` (`MODERATOR_CLARIFICATION_QUESTIONS_PROMPT`):

> *"Before the final verdict **you may ask each analyst** a small number of TARGETED clarifying
> questions … Ask each analyst at most 1-2 questions … If any analyst has not named all three
> take-profits, ask for them."*

and from the analyst side (`:486`, `ANALYST_CLARIFICATION_RESPONSE_PROMPT`):

> *"The **Moderator** (Master Strategist) asked YOU the question below. The Moderator is a Floor
> speaker, **not the trader**."*

So the brief's mental model (a model asking *the trader*) never matched the product. **Verdict:
DELETED, and nothing was lost relative to the brief's expectation — the capability that existed
was model-to-model, and it is gone.**

### 5.2 The clarification residue that IS still in the tree

| Artefact | Where | Verdict |
|---|---|---|
| `CLARIFICATION_DONE_MARKER`, `CLARIFICATION_MARKERS_RE` | `constants/debateMarkers.ts:20,23` | `CLARIFICATION_MARKERS_RE` is **live** as a sanitizer (`utils/analysisUtils.ts:18,859`); `CLARIFICATION_DONE_MARKER` is **dead** (defined only) |
| `looksLikeClarificationDump` | `utils/analysisUtils.ts:866-871` | live, but only reachable through `debateTurns` readers → **never fires** on new data |
| `CLARIFICATION_LABEL_RE` (matches `Macro:`, `Technical:`, `Risk:` …) | `utils/analysisUtils.ts:863` | live-but-dead: only feeds `looksLikeClarificationDump` |
| `TASK_BUDGETS.clarification = 400` | `services/providers/taskBudgets.ts:17` | **dead** — no production consumer |
| `EFFORT_BY_TASK.clarification = 'low'` | `services/providers/reasoningControls.ts:76-78` | **dead** — no production caller |
| `services/learning/harnessLessons.ts:156-179` — a harness lesson written *for* clarification turns | live but unreachable | the lesson's own text says: *"a chat_completions seat with no verified reasoning route cannot be told to think less for fast tasks … clarifications burn reasoning budget"* — it is a **wire-audit lesson** about a shape, not a clarification feature; keep it, but it is only reachable if a clarification-labelled wire audit ever fires |
| `types/message.ts:14-16` — *"then clarification cycles (one question round + one answer round each), last = moderator verdict"* | a doc comment on `DebateTurn.round` | describes the deleted engine |

---

## 6. Vestigial code worth deleting

Each item: what it is, the evidence it is dead, and a suggested disposition.
"Dead" = **no production consumer** (proved by grep over `hooks services utils components constants
types schemas scripts electron App.tsx index.tsx`, excluding `tests/`).

### 6.1 Dead modules (whole files)

| # | Item | Evidence | Disposition |
|---|---|---|---|
| V1 | **`utils/messageDisplayText.ts`** (69 lines) | its only export contains `ensembleNote: string` (`:21`) and strips the literal `'The ensemble has concluded its debate.'` (`:58-59`). **Zero importers anywhere** — the status doc flagged this as *"zero references anywhere"* on 2026-10-18 (`:792-798`) and it is still unreferenced. | **Delete the file.** Nothing reads it; its header's claim that "the two chat row components share its strip chain" was already false when the doc noticed it. |
| V2 | **`constants/prompts/learningPrompts.ts`** (102 lines) | 3 exports (`ENTRY_NOT_HIT_ANALYSIS_PROMPT` `:7`, `ENTRY_NOT_HIT_ANALYSIS_QUESTIONS` `:17`, `EXTENDED_SL_ZONE_DEBATE_CONTEXT` `:64`); **zero consumers**, including in tests. Re-exported by the barrel `constants/prompts/index.ts:4`, so the grep hides it — the exact barrel trap the status doc warns about (`:2232-2236`). Contents are pure debate-era moderator prompts (`"MODERATOR RESPONSIBILITY"` ×2). | **Delete the file + the barrel line.** |
| V3 | **`constants/debateMarkers.ts`** — 7 of its 9 exports | `MODERATOR_RETRY_MARKER` (`:12`), `CONVICTION_RETRY_MARKER` (`:18`), `REPLACEMENT_TIMEOUT_MARKER` (`:19`), `CLARIFICATION_DONE_MARKER` (`:20`), `MODERATOR_ERROR_BLOCK_RE` (`:26`), `DEBATE_END_MARKERS_RE` (`:28`), `replacementTimeoutText` (`:31-32`) — **no consumer anywhere.** Only `CLARIFICATION_MARKERS_RE` (`:23`) and `MODERATOR_RETRY_RE` (`:24`) are live, at `utils/analysisUtils.ts:18,859-860`. | **Trim to the two live regexes** and rename the file to something honest (`protocolMarkers.ts`) — or keep the name and delete the seven dead exports. Note: `utils/analysisUtils.ts:857` already duplicates `DEBATE_END_MARKERS_RE` inline as `/<\/?DEBATE_END>/gi`, so the canonical constant is the dead copy. |
| V4 | **`utils/debateTemplates.ts`** (69 lines) | `debateTemplateMarker` (`:49`) has **no production consumer** — no chip inserts `[[Scalp check]]`. `DEBATE_TEMPLATES[].steering` and `.skipToVerdict` are read by nothing but the module itself and `tests/debateTemplates.test.ts`. The only live behaviour is `extractDebateTemplate` (`hooks/useAnalysisPipeline.ts:673-676`), which **strips the marker and discards the template** — the steering prose is never sent to any model. | **Delete** (and delete the extraction block at `useAnalysisPipeline.ts:667-677`), **or** rebuild it as real one-tap presets that inject the steering text into the prompt. Today it is a dead feature with a live shim. |

### 6.2 Dead exports inside live modules

| # | Item | Evidence | Disposition |
|---|---|---|---|
| V5 | **`ARBITER_ALLOWED_TOOLS`** | `services/analysis/DeskToolsService.ts:3364-3380`. Only importers: `tests/evidencePack.test.ts:33`, `tests/tradeLogTool.test.ts:11`. | **Delete** the constant and its 7-line doc comment; delete the two test arms. If an arbiter policy is wanted later, it must be re-derived from a live seat. |
| V6 | **`formatGuardContextBlock`** | `services/validation/SessionGuardService.ts:270-280` — *"Compact block injected into the debate context so the moderator can weigh it."* Only consumer: `tests/sessionGuard.test.ts:10,208-218`. | **Delete** (or keep `assessSession` and drop the prompt builder). |
| V7 | **`generatePatternMemoryEnforcementContext`** + `**generateSynthesizedPromptInjection`** | `services/learning/PatternMemorySynthesisService.ts:982`, `:589`. Only consumers: `tests/patternMemoryGate.test.ts`, `tests/storeUnification.test.ts`. The first builds the whole *"MODERATOR ENFORCEMENT / MANDATORY QUESTIONS / HALT / REDUCE_SIZE"* block (`:1040-1075`). | **Delete the prompt builder; keep `generateMandatoryPatternCheck`** (`:882`), which has live data consumers. |
| V8 | **`handleReplacementChoice`, `handleSteerSeat`, `handleStopSeat`, `steeringNotes`, `handleRemoveSteeringNote`** | `hooks/useAnalysisPipeline.ts:1778-1797`. **Zero consumers** outside the hook. `replacementChoiceRef` (`:361`) is never assigned a pending resolver (only nulled at `:365,1536`) → `handleReplacementChoice` always returns at `:364`. `seatSteeringRef` (`:353`) is written at `:794` and `:1791`, never read. `stoppedSeatsRef` (`:355`) likewise. | **Delete all five from the hook's return + the two refs + the reset at `:794-795`.** They are the deleted debate's mid-round controls. Keep the conversation-level steering queue (`:617-630`, `:1750-1757`), which is live. |
| V9 | **`threadPreview` / `AgentThreadPreview`** | `utils/agentThreads.ts:225-251`. Only consumer: `tests/agentThreads.test.ts:8,76-89`. `previewTextFor` (`:235`) *is* live (imported by `components/agents/AgentsView.tsx:63`). | **Delete `threadPreview` + `AgentThreadPreview`**; keep `previewTextFor`. |
| V10 | **`mailboxRosterHint`, `synthesizeReplyToLine`** | `services/analysis/DebateMailbox.ts:153-154`, `:162-169`. `mailboxRosterHint` — no consumer anywhere. `synthesizeReplyToLine` — only `tests/debateMailbox.test.ts:3,62-70`. | **Delete both.** The reply-to routing they supported is legacy (`utils/agentThreads.ts:95` still comments on it). |
| V11 | **`EFFORT_BY_TASK.rebuttal` / `.moderatorVerdict` / `.clarification`; `TASK_BUDGETS.rebuttal` / `.clarification`** | `services/providers/reasoningControls.ts:72-78`; `services/providers/taskBudgets.ts:15-17`. No production `effortForTask(...)`/`TASK_BUDGETS.*` call uses them (`effortForTask` is called with `analysis`, `chat`, `postMortem`, `ocr`, `supervision` only). | **Delete the five rows** and the test arms at `tests/reasoningControls.test.ts:34-36,54-58`. |
| V12 | **`requireFirstToolRound`** (the `toolChoice:'required'` round-0 forcing) | `services/analysis/DeskToolsService.ts:3658-3661` (*"used by debates running WITHOUT live hybrid market data"*), `:3761`. **No caller passes it.** | **Delete the option** (and its pass-through at `:4222,4339`). |
| V13 | **`onOpenTeam`** | `components/chat/GroupChatView.tsx:44` (declared), `:85` (destructured), and **never used in the render body**; `App.tsx:1232-1249` never passes it. Its comment: *"The debate harness is itself a room: the title links to the Team transcript."* | **Delete the prop.** The Team thread is gone as a debate backing. |

### 6.3 Dead data types / fields (legacy readers only)

| # | Item | Evidence | Disposition |
|---|---|---|---|
| V14 | **`Message.debateTurns`** + **`DebateTurn`** + **`DebateSpeaker`** | `types/message.ts:7-34,184`; `types/enums.ts:43`; `types/trade.ts:139`. **No producer**: the only writers are copies (`hooks/useTradeLogging.ts:427`, `utils/watchList.ts:30`) of a field nothing sets. Four readers: `utils/analysisUtils.ts:903,940,969` (→ `extractFinalVerdictText` `:968`, `resolveLevelHitOdds` `:938`, `extractSignalStrategyText` `:901`), `utils/reportExport.ts:241`, `hooks/useWatchAndAutopilot.ts:105`, `services/learning/monthlyReport.ts:224`. | **Owner decision, not a cleanup.** The status doc (`:1680-1712`, `:2062-2069`) explicitly parks this: *"a museum of pre-2026-10-18 runs that nothing new will ever join."* Deleting the field deletes the monthly report's ensemble line, the conviction-drift analysis, the follow-up ticket's openings and the export's count — for history the trader already has. |
| V15 | **`ThinkingRole` `'moderator'` / `'debate_turn'`** + the `debate_turn` branch | `types/thinking.ts:12,24,41`; `utils/thinkingSplit.ts:441`; `services/infrastructure/ThinkingStoreService.ts:71-72,150,165,253-254,278-279,617,722-723` (the live SQLite `debateTurnIndex` column, `services/infrastructure/SqliteService.ts:243`). | **Narrow the union to `'analyst'`** and keep the DB column (it is a sort key and legacy rows carry it). |
| V16 | **`PatternMemoryGateView.mandatoryQuestions`** + `Message.patternMemoryGate` / `LoggedTrade.patternMemoryGate` | `types/message.ts:230,384-399`; `types/trade.ts:32`. Producer alive (`services/learning/PatternMemorySynthesisService.ts:895-970`), consumer dead (V7). | **Follow V7**: the gate's data stays, the moderator-enforcement text goes. |
| V17 | **`Message.evidencePack`** + `EvidencePackCard` | `types/message.ts:285`; `components/analysis/EvidencePackCard.tsx`; `components/analysis/VerdictAudit.tsx:58,100`; `components/agents/AgentsView.tsx:1449`; `components/trade/panels/ChatTranscriptList.tsx:257,262`. Producer (`buildVerdictEvidencePack`) deleted with the finalizer. | **Cosmetic-by-design.** Keep the renderer — it renders legacy rows — but re-label the comment at `VerdictAudit.tsx:58` (*"what the moderator was actually shown"*) so it does not claim a live producer. |
| V18 | **`utils/runContract.ts`** (types only) + `RunContractPanel` | `utils/runContract.ts:1-20` says so explicitly; `components/analysis/RunContractPanel.tsx:32-37` still names the six deleted stages ("gate → openings → rebuttals → clarification → verdict → journal"). | **Keep** (it renders persisted legacy rows) but **fix the comment** at `RunContractPanel.tsx:34` and the `DebateReplay` reference at `:36` (that component was deleted in `33b5ee20`). |

### 6.4 Live-but-misleading text (reaches models or users)

| # | Item | Evidence | Disposition |
|---|---|---|---|
| V19 | **The desk-tools mandate names four deleted phases** | `services/analysis/DeskToolsService.ts:1781` — *"You can call live tools before you speak — **opening analysis, rebuttal, clarification, or moderator verdict**."* This string is sent to **every** model on every desk-tool turn. | **Rewrite** to the phases that exist ("before you answer, in any turn"). This is the single most-repeated piece of debate vocabulary still reaching a model. |
| V20 | **The harness contract names the moderator** | `constants/prompts/harnessContract.ts:16` — *"The **moderator's** last block is the labeled markdown plan only."* Live in every desk-tool system prompt (`DeskToolsService.ts:4188,4173`) and every analysis prompt (`GenericAnalysisService.ts:359,400`). | **Rewrite** clause 3 to describe the single answering model. |
| V21 | **"INSTRUCTION FOR MODERATOR" injected into the hybrid packet** | `services/validation/calibrationPolicy.ts:808` — *"INSTRUCTION FOR MODERATOR: Weight X's analysis more heavily (n% accuracy)."* Injected live at `services/analysis/HybridIntelligenceService.ts:1269-1276,1291` into a **single-model** packet. | **Rewrite** to *"INSTRUCTION: the most accurate provider's record…"* — the text currently addresses a seat that does not exist. |
| V22 | **The New Bot dialog still offers debate-role avatars** | `components/chat/NewBotDialog.tsx:28-29` derives choices from `Object.keys(ROLE_ACCENTS)` filtering only `'unknown'`/`'postmortem'` → **"Moderator"**, "Risk", "Macro", "Technical", "Sentiment" are offered; the default is `'macro'` (`:43`). `components/chat/pixelAvatars.ts:40-49,81` defines them. | **Rename the presets** to neutral ones (or keep the pixels but relabel). A trader today can name their bot's avatar "Moderator" and the app will imply a role that does not exist. |
| V23 | **Dangling doc comment on `ProviderConfig`** | `types/provider.ts:84` — `/** Models included when Ensemble mode is enabled (maximum three total). */` immediately followed by `/** Optional USD per 1k prompt tokens … */` for `inputUsdPer1k`. The `ensembleModels` field was deleted; the comment now annotates the wrong field. | **Delete the orphan comment.** |
| V24 | **Orphaned section header** | `types/enums.ts:45-48` — `// ANALYST LENS TYPES - Specialized roles for 3-analyst ensemble debates` followed by **nothing** (the file ends at `:48`). | **Delete the empty section.** |
| V25 | **Orphaned comments in `App.tsx`** | `App.tsx:841-843` (the lens auto-assign comment) and `:845-847` (*"injected into the debate context so the moderator weighs it when grading"* — the code beneath was deleted; V6 is its orphan). | **Delete both comment blocks** — they describe code that no longer exists and name a moderator. |
| V26 | **Six blank lines where prompt constants were removed** | `constants/prompts/analysisPrompts.ts:54-61` — the hole left by `STRESS_TEST_PROTOCOL` / `PROBABILITY_ESTIMATION_PROMPT` / `TRADING_FAMILIES_PROMPT` (deleted 2026-10-19 per the status doc `:2249-2253`). Also `MASTER_ANALYSIS_PROMPT:70` still says *"You are Stage 2 on a crypto futures desk."* | **Collapse the blank lines; fix "Stage 2"** — there is one stage now. |
| V27 | **`constants/models.ts:2`** — *"Analysis constants — frameworks, pattern-family UI data, **ensemble roles**."* | the file holds no roles any more. | **Fix the one-line header.** |
| V28 | **The `agents` "Team" thread selection** | `hooks/useAgentThreads.ts:51` (*"Boot surface = the main ensemble transcript ('team')"*), `utils/agentThreads.ts:25-33` (*"'team' = the main ensemble transcript"*), `utils/agentThreads.ts:108` (*"ENSEMBLE replies (multi-key modelsUsed, the debate verdict)"*). The Team thread is now just the Chat surface's own transcript. | **Rename/re-comment** — three places describe a boot surface that is no longer an "ensemble transcript". |
| V29 | **`services/agents/agentRoster.ts:12` imports `RolePreset`** | `components/chat/pixelAvatars.ts` — the avatar vocabulary the roles used to come from. | Harmless; leave with V22. |

---

## 7. Weak spots

1. **The vocabulary and the product have drifted apart, and the drift is in the *prompts*, not
   just the code.** A single model reading the desk-tools mandate
   (`DeskToolsService.ts:1781`) is told it may speak as "opening analysis, rebuttal, clarification,
   or moderator verdict"; the harness contract (`harnessContract.ts:16`) tells it "the moderator's
   last block is the labeled markdown plan only"; the hybrid packet
   (`calibrationPolicy.ts:808`) instructs a **MODERATOR** to weight providers. Three live prompts
   describe a three-role committee to a one-model committee. This is the most user-visible defect
   in this section and the cheapest to fix.

2. **The `judge` half of the old product has no replacement anywhere, and three of its builders
   are still in the tree with nothing calling them** — `ARBITER_ALLOWED_TOOLS`
   (`DeskToolsService.ts:3364`), `formatGuardContextBlock` (`SessionGuardService.ts:270`),
   `generatePatternMemoryEnforcementContext` (`PatternMemorySynthesisService.ts:982`). The
   pattern-memory gate still *computes* mandatory questions (`PatternMemorySynthesisService.ts:895-970`)
   and the session guard still *computes* a day-P&L/loss-streak block — **nothing injects either
   into any prompt any more.** The trader lost the "the model must answer these before I approve
   this" behaviour, and the code that used to provide it is still sitting there looking load-bearing.

3. **The multi-agent surface is split across two stores and two vocabularies, and the split is
   documented but not reconciled.** The Agents surface reads App's `messages`; the dock reads
   `services/trade/chatStore.ts` (`components/agents/AgentsView.tsx:10-25`). Consequently:
   - the **synthesis seat exists only in the dock panel** (`chatPanel.ts:87-91`); a **group room
     has no synthesis seat at all** (`groupRounds.ts` ends a room when nobody is addressed,
     `useAgentGroups.ts:327-328`), so a room's members can talk but never *conclude*;
   - the **teammate DM mailbox has two incompatible implementations** — the tool-call mailbox
     (`services/analysis/DebateMailbox.ts`, dock panel only) and the marker mailbox
     (`services/agents/botMailbox.ts`, Agents surface only). The room protocol even forbids the
     markers in rooms (`groupRounds.ts:79`), so a bot cannot DM a peer from inside a room.

4. **Two independent "multi-seat" mechanisms with different semantics, both live.**
   The dock panel allows a seat to `@mention` a peer mid-turn *and* to `send_message` it
   (`chatTurnRunner.ts:1202`, `DebateMailbox.ts:115`); the Agents room allows only `@mention`
   routing and forbids DMs. The panel caps at 5 seats with **no turn cap**; the room caps at 3
   rounds / 12 turns (`groupRounds.ts:16-18`). Two features that look like the same feature to a
   trader have different limits and different communication channels.

5. **The old engine's *capability* is gone but its *data* is still on disk and still rendered, and
   the two are not reconciled.** `Message.debateTurns` (V14), `Message.evidencePack` (V17),
   `Message.runContract` (V18), `LoggedTrade.moderatorModel` and the monthly report's
   "moderator (legacy)" / "ensemble line (legacy)" cells (`monthlyReport.ts:210,228`) are all
   **legacy-only reads**. The status doc's own standing decision (`:2062-2069`) leaves this with
   the owner; until then the app shows a *museum* next to live data, and the labels
   ("Ensemble (legacy)" at `components/journal/TradeLog.tsx:352`) are the only thing marking the
   difference.

6. **The "debate templates" feature is a live shim over a dead feature** (V4). The extraction runs
   on every send (`useAnalysisPipeline.ts:673-676`), but nothing can produce a marker and the
   template's steering text is thrown away. A trader who types `[[Scalp check]]` gets it silently
   deleted with no effect — a marker that *looks* like a control and does nothing.

7. **`useAnalysisPipeline` still carries the deleted debate's mid-round control surface** (V8):
   `handleSteerSeat` / `handleStopSeat` / `handleReplacementChoice` are exported, toasted
   (*"Queued for X — Applied at that seat's next turn"*, `:1792`) and **unreachable**. If any
   future surface wires them, they will do nothing: `seatSteeringRef` and `stoppedSeatsRef` are
   written and never read, and `replacementChoiceRef` is never given a resolver.

8. **The deletion was thorough about the engine and careless about the vocabulary.** 11,664 lines
   of engine went in one commit (`48c3ee81`) with an explicit reachability discipline
   (the status doc `:842-845`: *"a bulk delete must intersect the reachability walk and refuse any
   file reachable from App.tsx"*). But the *naming* was never revisited: 438 `moderator` hits, ~110
   `ensemble` hits and 41 `clarif` hits remain, the large majority of them in comments and prompt
   strings — i.e. in the places a reader (or a model) actually reads.

---

## Appendix — how the claims were checked

- **Repo-wide greps** (`grep -ri`, case-insensitive) over
  `hooks services utils components constants types schemas scripts electron App.tsx index.tsx`
  for `ensemble`, `moderator`, `clarif`, `debate`, `arbiter`, `ensemble`/`Moderator` combined, plus
  targeted greps for every symbol named in §6 (`ARBITER_ALLOWED_TOOLS`, `formatGuardContextBlock`,
  `generatePatternMemoryEnforcementContext`, `threadPreview`, `mailboxRosterHint`,
  `synthesizeReplyToLine`, `handleSteerSeat`, `handleStopSeat`, `handleReplacementChoice`,
  `onOpenTeam`, `requireFirstToolRound`, `debateTurns`, `resumeMessageId`, `replacementOffer`).
  Every "no consumer" claim is a grep result over **production** paths; test-only consumers are
  named explicitly.
- **Git archaeology** — `git log --oneline --diff-filter=D --name-only` over
  `*ensemble* *debate* *Debate* *Ensemble* *Analyst*`, plus
  `git show --stat` on each deletion commit and `git show <commit>^:<file>` to recover the old
  engine's exports and prompt bodies.
- **Full reads** of every file named in the brief, plus
  `components/agents/AgentDetailCard.tsx`, `components/agents/AgentsView.tsx` (1,664 lines),
  `components/agents/RowMenu.tsx`, `components/chat/GroupChatView.tsx`,
  `components/chat/NewBotDialog.tsx`, `components/chat/pixelAvatars.ts`,
  `services/trade/chatPanel.ts`, `services/trade/chatTurnRunner.ts` (panel arm),
  `services/analysis/DeskToolsService.ts` (mailbox + arbiter + mandate),
  `utils/analysisUtils.ts` (strip chain), `types/message.ts`, `types/enums.ts`,
  `types/provider.ts`, `types/thinking.ts`, `constants/promptRegistry.ts`, `constants/promptIds.ts`,
  `constants/prompts/*.ts`.
- **Not done** (read-only constraint): no build, no test run, no app launch, no provider call, no
  network access of any kind. Every verdict here is a static reading of the tree at `2b4d4fa2`
  plus the recorded history in `docs/plans/debate-deletion-status.md`.
