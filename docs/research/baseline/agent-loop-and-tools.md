# The agent loop, the turn lifecycle, and the desk tool registry

Research baseline section — August Trading (`C:\Dev\august-3.5`).
Read-only static inspection + `git` only. No app run, no build, no API keys, no orders.

**Headline:** there is exactly **one** agent loop (`runDeskToolLoop`), **one** turn executor
(`runToolTurn`) and **one** tool registry (`DESK_TOOL_DEFINITIONS` + `CHART_ACTION_TOOL_DEFS`).
Three surfaces (Chat, Chart AI dock, automation) share the loop and differ only in which row
they write. The loop is unusually well-guarded (per-call deadline, wall-clock budget,
repeat-call gate, self-heal bounce, thinking-cut re-ask, executor-level allow-list, a
mandate composed from the tools a turn can actually call).

Two defects dominate the rest:

1. **The prompt-assembly half of `useAnalysisPipeline` is computed and thrown away.**
   `enhancedPrompt` — the memory slice, similar setups, weighted-voting learning context,
   the code-checked skill-trigger note and the decision reflections — is built
   (`hooks/useAnalysisPipeline.ts:1168-1209`) and read only by a `devLog` (`:1213`). All three
   sends use `promptToSend` (`:1258`, `:1384`, `:1411`). Nothing of it reaches a model.
2. **The `propose_skill` path has a required argument with no destination**, and the same
   growth tool is reachable from an **unattended background job** that carries no seat
   allow-list at all. Full detail in §5.

---

## 1. Numbered feature list

### The loop

| # | Feature | Verdict | Evidence |
|---|---|---|---|
| 1 | **The desk tool loop** — a bounded `for` over up to 8 rounds, each round = one provider call → parse tool calls → execute → re-prompt. | **REAL** | `services/analysis/DeskToolsService.ts:3715` (the round loop), `:196` (`MAX_DESK_TOOL_ROUNDS = 8`) |
| 2 | **`streamChatWithDeskTools`** — the one streaming transport every tool-bearing turn goes through; it owns the cache clear, the system-prompt enrichment, the live-delta queue and the final continuation. | **REAL** | `services/analysis/DeskToolsService.ts:4181-4467`; the loop is launched at `:4319`, awaited at `:4397` |
| 3 | **`runToolTurn`** — the ONE turn executor (echo repair, reasoning peel, abort-first settle, token accounting, effort + wire-audit ride-out). Shared by dock, Chat and automation. | **REAL** | `services/trade/toolTurn.ts:131-166` (wrapper), `:168-253` (inner); callers `services/trade/chatSurfaceTurn.ts:378`, `services/trade/chatTurnRunner.ts:743`, `services/trade/automationTurn.ts:256` |
| 4 | **The abort-first settle** — an explicit Stop is settled before every other branch, so a stopped turn reads as *interrupted*, never as a failure. | **REAL** | `services/trade/toolTurn.ts:216-218`; pinned by `tests/toolTurn.test.ts:115-133` |
| 5 | **The reasoning peel / pure-echo repair** — native chain-of-thought echoed into the content channel is split off; a turn that streamed *only* reasoning says so instead of showing the scratchpad twice. | **REAL** | `services/trade/toolTurn.ts:220-241` (`splitThinkingFromOutput`, the `echoNotice`) |
| 6 | **The Chat-surface turn** — writes the canonical `Message` row (the record the rail, the Journal and the learning loop read). | **REAL** | `services/trade/chatSurfaceTurn.ts:253-420` |
| 7 | **The dock turn** — writes a `chatStore` `LiveEntry` (the row with `tools`/`toolIds`), and can dispatch canvas tools. | **REAL** | `services/trade/chatTurnRunner.ts:631-798` (`runSeatTurn`), transport at `:670-696` |
| 8 | **The dock PANEL loop** — up to 5 seats, cross-talk mailbox, @mention routing, a synthesis seat; a `(pass)` seat's bubble is removed entirely. | **REAL** | `services/trade/chatTurnRunner.ts:1144-1288`; the pass-drop at `:1267-1272` |
| 9 | **The automation turn** — a *third* sink: nothing paints, the row is written once at the end from the accumulated outcome. | **REAL** | `services/trade/automationTurn.ts:162-306`; the no-op display channels at `:174-177` |
| 10 | **The bot path is deliberately tool-free** — a bot's 1:1 thread answers with `streamQuickResponse` (no tools), and `useBotMailbox` / `botRoutine` / `groupRounds` are deliberately not moved onto the tool turn. | **REAL** (deliberate) | `hooks/useAnalysisPipeline.ts:1377-1401`; the ruling is stated at `services/trade/chatSurfaceTurn.ts:24-28` |
| 11 | **The Full-analysis instruction** — the trader pressing the button is an *instruction*, and the turn is then CHECKED for having obeyed it. | **REAL** | `services/trade/chatSurfaceTurn.ts:359-361` (the mandate), `:410-418` (the check); pinned by `tests/fullAnalysisRequiredTools.test.ts:73-145` |
| 12 | **The wall-clock turn budget** (180 s) with a one-shot wrap-up notice at 80 %. | **REAL** | `services/analysis/DeskToolsService.ts:208-209`, enforced `:4069-4072` |
| 13 | **The per-tool-call deadline** (20 s) — a hung lookup cannot hold the round, and the call comes back as a `DATA_UNAVAILABLE:` receipt rather than an exception. | **REAL** | `services/analysis/DeskToolsService.ts:220`, `:252-285` (`withinToolDeadline`), applied per call at `:3327-3331` |
| 14 | **The repeat-call guard** — a second identical call inside the TTL is answered with a pointer to the result the seat already holds, not a replay. | **REAL** | `services/analysis/DeskToolsService.ts:3873-3904`; the gate rule at `:485-492` |
| 15 | **The stall detector** — three identical calls, or an alternating pair seen twice, ends the turn with a "REPEAT" notice. | **REAL** | `services/analysis/DeskToolsService.ts:293-306`, used `:4067`, `:4073-4080` |
| 16 | **The self-heal bounce** — a malformed text-protocol tool call is bounced back to the model as a syntax error; a *truncated* call gets a different repair ("make it fit") than a malformed one. | **REAL** | `services/analysis/DeskToolsService.ts:3771-3798`; the two predicates `:3421-3442` |
| 17 | **The thinking-cut re-ask** — a round that returned no words because the wire hit its own token ceiling is re-asked **once** with the tier stepped down, and the step-down persists for the rest of the turn. | **REAL** | `services/analysis/DeskToolsService.ts:3814-3834` (`thinkingRepairSent`, `repairEffort`, `stepEffortDown`); the round budget was raised to 8192 for the same reason at `:222-241` |
| 18 | **The "produced nothing" continuation** — a turn that returned no words and ran no tool gets one final prose-only request at a stepped-down tier. | **REAL** | `services/analysis/DeskToolsService.ts:4441-4451` |
| 19 | **The after-tools continuation** — after tool rounds, one more streamed request carries the results and asks for the reply. | **REAL** | `services/analysis/DeskToolsService.ts:4427-4466` |
| 20 | **The per-conversation run registry** — a run belongs to a conversation; a conversation switch moves the view and does not kill the run. | **REAL** | `hooks/useAnalysisPipeline.ts:389` (`runsRef`), `:799-833` (`updateRequestMessages` / `assertCurrentRequest`), `:473-479` (the switch effect) |
| 21 | **The queued-send drain** — text typed while a run is live parks and then runs as ONE follow-up turn when the run ends, however it ended. | **REAL** | `hooks/useAnalysisPipeline.ts:617-633` (park), `:1743-1757` (drain) |
| 22 | **The prompt A/B lane** — a per-run `live`/`control` label stamped on `runStats.promptLane` + `promptVersion`. | **COSMETIC** — it is a *record*, not a wire change: `services/trade/**` contains **zero** `getPrompt` calls, so a "control" run and a "live" run send the same bytes. (Repo's own O-140.) | stamped `hooks/useAnalysisPipeline.ts:965-969`, written `:1296-1297` / `:1466`; the missing resolution `docs/plan/open-items.md:425` (O-140) |
| 23 | **The Settings → Prompts registry** (`constants/promptRegistry.ts`) — user-editable prompts with imported fallbacks. | **COSMETIC for the four `analysis.*` prompts on the trader-facing path** (they reach a model only through the skill-eval harness); **REAL** for the other eight (`learning.chart_scan` via the `scan_chart_skills` tool, `notebook.chat_note` via the quick-save send, `notebook.note` / `learning.skill_craft` / `learning.skill_refine` / `learning.skill_worth` / `learning.settlement_reflection` in the learning loop, `strategy.summarize_pdf` / `strategy.ocr_page` in Settings) | registry `constants/promptRegistry.ts:55-175`; `getPrompt` call sites: `services/providers/GenericAnalysisService.ts:357, 363, 368, 401`, `services/learning/chartScanSkills.ts:296`, `services/learning/NotebookWriterService.ts:86, 137`, `services/learning/SkillCraftService.ts:155, 228`, `services/learning/skillWorthGate.ts:115`, `services/learning/settlementReflection.ts:295`, `services/learning/pdfOcrService.ts:42`, `services/learning/strategySummarizer.ts:70` — **none** under `services/trade/**` |
| 24 | **`analyzeTradingViewWithTransientRetry`** — the wrapper the analysis prompts live behind. | **DEAD / COSMETIC** — defined, zero callers | `hooks/useAnalysisPipeline.ts:249-275`; `docs/analysis/2026-10-21-04-cleanup-manifest.md:64` |
| 25 | **`enhancedPrompt`** — the memory slice + similar setups + weighted-voting learning context + the code-checked skill-trigger note + decision reflections. | **COSMETIC** — computed every send and **never sent**. See §4. | built `hooks/useAnalysisPipeline.ts:1168-1209`, read only at `:1213`; the three sends use `promptToSend` at `:1258`, `:1384`, `:1411` |
| 26 | **The hybrid market-packet injection string** (`hybridDataInjection`). | **COSMETIC** — fetched by the scheduler, built, and read only by `devLog` | built `hooks/useAnalysisPipeline.ts:1008` / `:1048`, read only `:1214`; the repo's own flow doc says the same: `docs/app-flow.html:178` |
| 27 | **The gate-keeper injection** (`gateInjection`). | **COSMETIC** — a literal `''` with a comment around it | `hooks/useAnalysisPipeline.ts:1203-1210` |

### The tool registry

| # | Feature | Verdict | Evidence |
|---|---|---|---|
| 28 | **`DESK_TOOL_DEFINITIONS`** — the single catalogue: 31 core tools with OpenAI-shaped schemas. | **REAL** | `services/analysis/DeskToolsService.ts:909-1543`; the order is pinned by `tests/deskTools.test.ts:18-59` |
| 29 | **`CHART_ACTION_TOOL_DEFS`** — 8 canvas tools, offered **only** when the caller wires an executor *and* the seat's allow-list names them. | **REAL** | `services/analysis/DeskToolsService.ts:1552-1723`; the gate `:4240-4242` |
| 30 | **The offer-time filter** — the definitions handed to the provider are filtered by the seat's allow-list. | **REAL** | `services/analysis/DeskToolsService.ts:3720-3724` (`effectiveTools`) |
| 31 | **The executor-level allow-list** — `executeDeskTool` refuses an off-list name *before* the cache and before the switch, on every transport (a text-protocol seat can emit a tag for any tool). | **REAL** | `services/analysis/DeskToolsService.ts:2478-2487`; the refusal shape `:2426-2438`; pinned by `tests/deskTools.test.ts:119-158` |
| 32 | **The forged-tool gate** — a `custom_*` recipe is refused if the seat's list does not carry it, before the forge executor is reached. | **REAL** | `services/analysis/DeskToolsService.ts:3940-3959` (esp. `:3944-3947`) |
| 33 | **The desk mandate, composed from the offer set** — `deskToolsMandateFor(offered)` writes the shape rule and the drawing rule from the tools *this* turn can call: no chart-view ⇒ "there is NO CHART to read on this home"; no market read ⇒ "name none of them". | **REAL** | `services/analysis/DeskToolsService.ts:1739-1784`; built from `mergedAllowed` at `:4261-4268`; pinned by `tests/deskSystemPrompt.test.ts:62-117` |
| 34 | **The harness contract + mandate injection** — `withDeskToolsSystemPrompt` adds the contract once (only if the caller's prompt has none) and appends the mandate + the text-protocol fallback. | **REAL** | `services/analysis/DeskToolsService.ts:4153-4174`; pinned by `tests/deskSystemPrompt.test.ts:33-53` |
| 35 | **`ARBITER_ALLOWED_TOOLS`** — a 9-name seat policy for the moderator. | **DEAD / COSMETIC** — the moderator seat was deleted; only two test files import it | `services/analysis/DeskToolsService.ts:3341-3357`; importers `tests/evidencePack.test.ts:33`, `tests/tradeLogTool.test.ts:11`; `docs/analysis/2026-10-21-04-cleanup-manifest.md:62` |
| 36 | **`toAnthropicTools`** — the Anthropic-schema converter. | **DEAD / COSMETIC** — no production caller (the Anthropic transport sends no `tools` field) | `services/analysis/DeskToolsService.ts:1791-1796`; `docs/analysis/2026-10-21-02-enhancements.md:268` (B-19) |
| 37 | **`requireFirstToolRound`** (round 0 forced to `toolChoice:'required'`). | **COSMETIC / unreachable** — no production caller ever sets it; the debate that needed it is deleted | declared `services/analysis/DeskToolsService.ts:3638`, `:4139`; used `:3737-3739`; no assignment outside the module |
| 38 | **`AUTOMATION_UNATTENDED_DENY`** — a scheduled run may not write the trader's notebook; the deny list is derived from `CHAT_SURFACE_TOOLS` so a rename cannot silently un-deny it. | **REAL** | `services/trade/automationTurn.ts:56-64`; the derivation `:62-64`; pinned by `tests/automationToolTurn.test.ts:135-143` |
| 39 | **The skill-evaluation path has NO seat allow-list** — an unattended background runner reaches the same loop with `allowedTools` undefined, i.e. unrestricted. | **REAL (a hole)** — see §5.2 | `services/learning/SkillEvalScheduler.ts:284-294` (no `allowedTools`), `services/providers/GenericAnalysisService.ts:449-452` (`allowedTools: params.allowedTools`), `services/analysis/DeskToolsService.ts:2485` (no refusal when undefined) |
| 40 | **`get_trade_log`** — the journal as rows, oldest-first, each row's PnL in the unit it was captured in; never cached. | **REAL** | definition `services/analysis/DeskToolsService.ts:1379-1397`; handler `:3262-3286`; pinned by `tests/tradeLogTool.test.ts:46-131` |
| 41 | **`propose_skill`** — a PENDING draft in the Coach inbox; nothing reaches the skill library without a human. | **REAL, with a defect** — the required `reason` has no destination. See §5.1 | definition `services/analysis/DeskToolsService.ts:1049-1081`; handler `:2645-2717`; the round trip pinned by `tests/skillApprovalRoundTrip.test.ts:225-258` |
| 42 | **`revise_skill`** — a PENDING rescope proposal with a *content* fingerprint, so a repeat queues once. | **REAL** | `services/analysis/DeskToolsService.ts:1113-1139` (definition), `:2761-2814` (handler); the fingerprint `:2800-2804` |
| 43 | **`propose_strategy`** — a draft trade plan written into `strategies/`, refused when it has no invalidation. | **REAL** | `services/analysis/DeskToolsService.ts:1082-1112`, `:2718-2760` |
| 44 | **`forge_tool`** — a declarative HTTPS recipe stored as a CANDIDATE; it never touches the network until a human approves it. | **REAL** | `services/analysis/DeskToolsService.ts:931-954`, `:2537-2557` |
| 45 | **`amend_memory`** — a PENDING correction to a notebook file; nothing is applied at call time. | **REAL** | `services/analysis/DeskToolsService.ts:910-930`, `:2515-2536` |
| 46 | **`write_memory_note`** — a DIRECT write into the model's own notebook folders (the only growth tool that writes immediately). | **REAL** | `services/analysis/DeskToolsService.ts:955-976`, `:2558-2582` |
| 47 | **`present_trade` / `decline_trade`** — the verdict IS a tool call; a skip is a decision and is recorded. | **REAL** | definitions `:1623-1667`; the dock sink `services/trade/chatTurnRunner.ts:444-474`; the decline handler `services/analysis/DeskToolsService.ts:3231-3260` |
| 48 | **`read_tool_output`** — pages a clipped result back by its `ta-…` id; the receipt is only offered to a seat that can actually call it. | **REAL** | definition `:1140-1157`; handler `:2921-2961`; the honesty gate `:550-551` |
| 49 | **The tool cache** — a 30 s per-run TTL over an *allow-list* of pure network reads (the policy was inverted from a deny-list so a write is never replayed). | **REAL** | `services/analysis/DeskToolsService.ts:450-472`, `:494-499`; the clear at the one choke point `:4199`; the failure sentinel is never cached `:3304-3306` |
| 50 | **The per-tool result budget** — 2400 chars default, per-tool overrides, order-book/liquidation down-sampling, JSON-preserving shaping, and a clip note that names what was lost. | **REAL** | `services/analysis/DeskToolsService.ts:504-531` (budgets), `:565-639` (`clipWithinBudget`), `:641-759` (`budgetToolContent`) |
| 51 | **The spill receipt** — a clipped result names an artifact id the seat can page, so "MISSING, not absent" is actionable. | **REAL** | `services/analysis/DeskToolsService.ts:749-757`; the artifact store `services/analysis/toolArtifactStore.ts`; the reader `:2921-2961` |
| 52 | **The untrusted-data fence** — every tool result is fenced as third-party data, with the harness-note allowance *generated from the real markers* rather than hand-written. | **REAL** | `services/analysis/DeskToolsService.ts:3463-3472`; the legend `utils/harnessMarks.ts:188-191`; the ingestion neutraliser `:172-183` |
| 53 | **The tool-label table** — the transcript carries a tool's *human label*, never its name; `toolLabel` is the single source. | **REAL** | `services/analysis/DeskToolsService.ts:761-795`; the digest `:802-813` |
| 54 | **The wire-audit record** — what the transport was actually asked, per request, carried out on the outcome. | **REAL** | collected `services/trade/toolTurn.ts:136-152`, ridden out `:96`, `:164`; written onto the row `services/trade/chatTurnRunner.ts:782` / `hooks/useAnalysisPipeline.ts:1495` |

### The transcript — the two homes

| # | Feature | Verdict | Evidence |
|---|---|---|---|
| 55 | **The TRAIL** — `Message.toolEvents` (one line per entry, uncapped) plus `Message.toolIds` (the payload id beside each line). The settled record the work card draws. | **REAL** | written `services/trade/chatSurfaceTurn.ts:268-276` (Chat) and `services/trade/chatTurnRunner.ts:706-726` (dock); projected `services/trade/chatSessions.ts:491-544`; pinned by `tests/toolTrailBothHomes.test.ts:29-63` |
| 56 | **The LIVE FEED** — `Message.liveToolEvents`, the capped (8) newline-JOINED feed a filling bubble shows. | **REAL** | `services/trade/chatSurfaceTurn.ts:270-274`; the cap `:178`; the projection that splits it `services/trade/chatSessions.ts:498-501` |
| 57 | **The digest grammar** — `parseToolLine` is the ONE reader of `calling X…` / `X · detail` / `X · failed`. | **REAL** | `utils/turnStatus.ts:83-101`; pinned by `tests/turnStatus.test.ts:23-59` |
| 58 | **`pairToolRows`** — ONE paired row = ONE call (the transcript holds two lines per call, so counting lines doubles every number the trader is told). | **REAL** | `utils/turnStatus.ts:161-186`; consumed `components/trade/panels/ChatWorkTimeline.tsx:106`, `components/shared/ToolActivityRow.tsx:219, 233` |
| 59 | **`turnActivityLabel` / `turnKindSummary` / `turnWorkSummary`** — the status line's word, the counts by kind, and the named work. | **REAL** | `utils/turnStatus.ts:115-130`, `:197-212`, `:228-247`; pinned by `tests/turnStatus.test.ts:61-191` |
| 60 | **The harness-notice exclusion** — compaction receipts, repairs, the repeat guard and the truncation warning share the tool channel but are never counted as calls. | **REAL** | `utils/turnStatus.ts:44-61`; pinned by `tests/turnStatus.test.ts:88-106`, `:176-190` |
| 61 | **The tool-kind vocabulary** — one map keyed by the *label* the transcript carries; an unknown label keeps its own label (never a guessed verb). | **REAL** | `utils/toolKinds.ts:77-142`; the coverage gate is a SOURCE contract against the desk service's own list: `tests/turnStatus.test.ts:228-266` |
| 62 | **The truncation tally** — a per-run window that reports "THE PROVIDER STOPPED EARLY" instead of letting a cut-off body look complete. | **REAL** | `utils/finishReason.ts:113-217`; opened around the turn `services/trade/chatSurfaceTurn.ts:378`, `services/trade/chatTurnRunner.ts:743` |
| 63 | **`runStatus`** — one status vocabulary (colour + word) and the canonical error sanitizer. | **REAL** for `runStatusPresentation` (used by `components/chat/RunBusyBadge.tsx:56`) and `sanitizeErrorText` (used by `services/trade/chatTurnRunner.ts:1056`); **COSMETIC** for `classifyStepError` / `describeStepError` / `STEP_ERROR_LABEL` — no production caller (the pipeline classifies with `hooks/analysisPipeline/runOutcome.ts` instead) | `utils/runStatus.ts:28-63`, `:96-104`, `:131-156`; importers above |

### Context, errors, aborts

| # | Feature | Verdict | Evidence |
|---|---|---|---|
| 64 | **The context window resolution** — user override → measured → model's own → 1 M default, with the source returned so the UI can say which one it is. | **REAL** | `utils/contextWindow.ts:136-158`; the default `:46` and its rationale `:27-41` |
| 65 | **Automatic compaction** — old tool payloads first, then prose, then whole turns dropped as atomic groups (a `tool_calls` block and its replies live or die together). | **REAL** | `services/providers/contextCompact.ts:217-308`; the group rule `:122-145` |
| 66 | **The output budget is half the request** — `max_tokens` is sized against the same window, and a request that cannot hold even a short reply fails loudly instead of being sent. | **REAL** | `utils/contextWindow.ts:187-196`; `services/analysis/DeskToolsService.ts:359-377` |
| 67 | **The context-length rejection recovery** — the provider states its own limit; the app records it and retries the turn once, compacted to that limit. | **REAL** | `services/providers/GenericProviderService.ts:1324-1341`; the three retry sites `:1301-1303`, `:1521-1523`, `:1866-1868`; the reader `utils/contextWindow.ts:233-243` |
| 68 | **The compaction notice** — the trader is told what was cut, in numbers, on the tool-event channel. | **REAL** | `services/providers/contextCompact.ts:300-307`, `:313-324`; surfaced `services/analysis/DeskToolsService.ts:345-357` |
| 69 | **Provider failure → a real error on the row** — the provider's own text leads, the canned sentence is only the fallback, and the cause chain under "fetch failed" is preserved. | **REAL** | `services/providers/GenericProviderService.ts:1175-1229`; the row write `services/trade/chatTurnRunner.ts:1046-1082`; the Chat surface's SYSTEM row `hooks/useAnalysisPipeline.ts:1603`; pinned by `tests/realProviderError.test.tsx:218-231` |
| 70 | **A tool that throws → a `DATA_UNAVAILABLE:` receipt**, not an exception; the turn continues and the model is told the source FAILED (unknown, not absence). | **REAL** | `services/analysis/DeskToolsService.ts:3309-3318`; the sentinel `utils/harnessMarks.ts:25-38` |
| 71 | **A hung run** — a 20 s per-call deadline plus a 180 s turn budget plus an 8-round cap plus a repeat gate plus a stall detector: five independent brakes. | **REAL** | `services/analysis/DeskToolsService.ts:220`, `:208`, `:196`, `:3873-3904`, `:4073-4080` |
| 72 | **A Stop is never a failure** — `AbortError` propagates; the dock keeps the half-written answer and stamps `interrupted`; the Chat surface settles `isStreaming: false`. | **REAL** | `services/trade/toolTurn.ts:216-218`; `services/trade/chatTurnRunner.ts:783-787`; `hooks/useAnalysisPipeline.ts:1533-1544` |
| 73 | **A stale run cannot write into a new trader's data** — the owner check is in the write path, not in the cancel path. | **REAL** | `hooks/useAnalysisPipeline.ts:806-817`; the profile-switch backstop `:1687-1692` |
| 74 | **The `mutate` miss is loud** — a write into a session the store no longer holds warns instead of silently dropping the row. | **REAL** | `services/trade/chatStore.ts:361-378` (the `console.warn`) |
| 75 | **The learning hooks are fire-and-forget** — a failed lesson write must never turn a delivered answer into a failed turn. | **COSMETIC by design** — the failures are swallowed with `.catch(() => { })` and never surface | `services/trade/chatTurnRunner.ts:817`, `:830`, `:836`, `:839` |
| 76 | **A payload-store write failure is swallowed** — deliberately, so it cannot take down the transcript write it rides inside. | **COSMETIC by design** | `services/trade/chatSurfaceTurn.ts:277-283`; `services/trade/chatTurnRunner.ts:711-716` |

---

## 2. Data flow — one turn, end to end

The Chat surface's desk turn (the most-used path; the dock and the schedule differ only in
the sink and the allow-list).

```
USER TYPES "what is BTC doing?"
  hooks/useAnalysisPipeline.ts:523  handleSendMessage
     · pre-flight: provider ready? :718  · rate limit? :695  · notebook quick-save? :744
     · run owned by the conversation :785  · controller armed :792
     · promptToSend = the trader's words (hiddenContext + "User Input") :843
     · ╳ enhancedPrompt (memory · similar setups · learning · predicate note · reflections)
          is BUILT at :1168-1209 and NEVER SENT  ← the defect, §4
  ─────────────────────────────────────────────────────────────────────────────
  ARM  services/trade/chatSurfaceTurn.ts:253  runChatSurfaceTurn
     · prompt  = chatSurfaceSystemPrompt()  = mandate + skills index + strategies + memory
                 :110-158 (fresh per turn)   ·  + "FULL ANALYSIS REQUESTED" when asked :359
     · messages = chatSurfaceTurnMessages(history, prompt, image, model, systemText) :195-216
     · allow-list = CHAT_SURFACE_TOOLS :57-81   ·  transport :306-346
  ─────────────────────────────────────────────────────────────────────────────
  EXECUTE  services/trade/toolTurn.ts:131  runToolTurn
     → services/analysis/DeskToolsService.ts:4181  streamChatWithDeskTools
        · clearDeskToolCache()  :4199          ← the ONE cache invalidation point
        · mandate composed from the offer set  :4261-4268 → withDeskToolsSystemPrompt :4153
        · round loop :3715
             ├ compactOutbound  :345  → services/providers/contextCompact.ts:343  compactForWire
             ├ provider call (streamChatRequest / sendChatTurn)
             ├ tool calls?  native :3757  |  text-protocol :3763  (≤3 :3858)
             │    └ repeat gate :3873 → executeDeskTools :3960 → executeDeskTool :2473
             │         · allow-list :2485   · cache read :2498   · handler switch :2514
             │         · budgetToolContent :3299 → clipWithinBudget :565
             │         · digest line "order book · ETHUSDT · buy wall $1.2M" :3998
             │         · payload {toolCallId, text, artifact} :4007
             ├ re-prompt :4028-4058  (native tool messages | text-protocol user turn)
             ├ guard: stall :4067 · wrap-up :4069 · thinking-cut re-ask :3814
             └ (8 rounds max, or the seat answers with no tool call)
        · after the loop: continuation with the results + a prose nudge :4427-4466
  ─────────────────────────────────────────────────────────────────────────────
  SINK  services/trade/toolTurn.ts:195-253
     · setText / addReasoning / addToolLine / addToolCall / attachPayload / addAction
     · settle: aborted → interrupted; pure echo → split; else text + reasoning
  ─────────────────────────────────────────────────────────────────────────────
  ROW  hooks/useAnalysisPipeline.ts:1408-1496
     · the trail  Message.toolEvents  +  Message.toolIds      (chatSurfaceTurn.ts:268-299)
     · the live feed  Message.liveToolEvents (8 lines, joined) (chatSurfaceTurn.ts:270-274)
     · runStats { effort, usage, cost, duration, promptLane, promptVersion } :1464-1481
     · the wire audit :1495   · the truncation notice :403-409
  ─────────────────────────────────────────────────────────────────────────────
  PERSIST
     · Chat surface → the conversation store (App's updateMessages, bound to the
       conversation the run started in :816)
     · Dock        → services/trade/chatStore.ts (debounced, streaming rows EXCLUDED :170-192)
     · Schedule    → a private message list (automationMessagesRef) :970-972, :800-804
```

The dock's solo turn is the same shape with a different sink
(`services/trade/chatTurnRunner.ts:846-1142` → `runSeatTurn` at `:631`, `LiveEntry` at `:698-736`),
plus the chart-context block (`buildContextBlock` at `:589-628`) prepended to the question.
The panel loop runs the same seat turn once per seat (`:1173-1283`). The scheduled run runs
the same executor with a third sink (`services/trade/automationTurn.ts:162-306`).

---

## 3. Non-obvious decisions

**One loop, three sinks.** The app used to have a debate engine, a panel engine and a
"quick response" path. What survives is a single loop (`runDeskToolLoop`) and a single
executor (`runToolTurn`), with the three surfaces differing only in the *row* they write.
The executor deliberately owns the *transition* and not the row shape: `Message` has no
`tools`/`toolIds` fields at all, which is why the sink is an event interface
(`ToolTurnEvents`) and not one shared state object (`services/trade/toolTurn.ts:9-26`).

**The transcript never carries a tool NAME — only a human label.** `digestToolResult`
(`services/analysis/DeskToolsService.ts:802-813`) writes `order book · ETHUSDT · buy wall …`,
never `get_order_book`. So the whole UI vocabulary is keyed by the *label*
(`utils/toolKinds.ts:6-27`), and the coverage test is a source contract against the desk
service's own table (`tests/turnStatus.test.ts:228-266`): a new tool without a map entry
falls through to its bare label rather than a guessed gerund.

**One paired row = one call.** The transcript holds two lines per call (the call and its
result), so a summary counting lines would double every number the trader is told
(`utils/turnStatus.ts:154-159`). `pairToolRows` is the single pairing, and the payload id
is stamped on the RESULT line — which is why the pairing keeps *source indices*
(`utils/turnStatus.ts:132-145`): without them a positional lookup lands on the calling line
and the expander silently never appears.

**The mandate is composed, not appended.** `deskToolsMandateFor(offered)` writes the shape
rule and the drawing rule from the tools the turn can *actually* call
(`services/analysis/DeskToolsService.ts:1725-1784`). A static mandate was a duty the
executor would refuse — which reads to the model as an obligation, not an absence
(`tests/deskSystemPrompt.test.ts:55-61`).

**A refusal is a FAILED call, not a receipt.** `rejectedResult` sets `ok:false`
(`services/analysis/DeskToolsService.ts:2426-2438`) so the transcript header, the
"rejected" chip and the panel narration all agree — and so a refusal cannot ride into the
result cache and be replayed as if it had succeeded.

**The cache policy was inverted, not extended.** The old deny-list covered only the
collaboration-memory trio, so `write_memory_note` → `get_notebook_map` replayed the
PRE-WRITE cached map, the model retracted writes that had landed and duplicated them
(`services/analysis/DeskToolsService.ts:440-449`). The cache is now an *allow-list* of pure
network reads; every local read and every write runs every time.

**`get_price_snapshot` deliberately does NOT cache.** Its whole job is the "did price
actually move?" check the prompt asks the model to run, so replaying a 30 s-old read would
make the verification step actively misleading (`services/analysis/DeskToolsService.ts:456-459`).

**Two tools are stamped, the rest are not.** `get_market_packet` and `get_all_timeframes`
cache a *pre-stamp* body and re-append this call's live mark, so a cache hit can never
replay the previous call's "this is now" (`services/analysis/DeskToolsService.ts:467-469`,
`:2499-2506`). `get_order_book` is the opposite case: its stamp is deliberately NOT
re-stamped, because "the book is 35 s old" is the honest fact
(`services/analysis/DeskToolsService.ts:1917-1931`).

**The cache is cleared at one choke point**, inside `streamChatWithDeskTools`, not by the
callers — because the call site went with the deleted debate engine and nothing warned
(`services/analysis/DeskToolsService.ts:4192-4199`). Artifacts are deliberately NOT cleared
there: a concurrent turn would lose the payloads its model is paging through (`:494-499`).

**The turn's clock starts when the bubble is painted**, not when the provider is called, so
a Stop, a failure and a clean finish all report the same "worked for Ns"
(`services/trade/chatTurnRunner.ts:193-202`, `:662`).

**The harness contract is composed exactly once per turn.** `withDeskToolsSystemPrompt`
adds it only if the caller's prompt does not already carry it
(`services/analysis/DeskToolsService.ts:4164-4173`) — the analysis prompt composes it
itself (`services/providers/GenericAnalysisService.ts:358-370`), and the desk path must not
double it.

**Harness-authored user turns are MARKED.** `harnessTurn()` prefixes app-written text in
the `user` role so a seat can tell the trader's words from the app's
(`utils/harnessMarks.ts:114-134`); six writers inside the desk loop use it
(`services/analysis/DeskToolsService.ts:324, 3786, 3827, 4056, 4431, 4445`).

**A "calling…" line is emitted before the call runs, one per call**, so the transcript
shows a call in flight rather than only its result (`services/analysis/DeskToolsService.ts:3930-3933`).

**The tool-round budget is 8, not 3.** The comment says why: at 3 a seat that looked at the
chart and then wanted a second frame to compare against was cut off mid-investigation
(`services/analysis/DeskToolsService.ts:187-196`). The round's *output* budget was raised to
8192 for the same reason — thinking counts against `max_tokens`, so a 4096 ceiling produced
a round with no call and no text, which the loop read as "the seat chose not to call a
tool" (`:222-241`).

---

## 4. Weak spots

### 4.1 The prompt-assembly half of the pipeline is computed and discarded — **HIGH**

`hooks/useAnalysisPipeline.ts` assembles a rich `enhancedPrompt` and then sends
`promptToSend`.

| what is built | where | where it goes |
|---|---|---|
| notebook slices, bot memory, similar-setups record, regime weighting, loss priming | `:1066-1084` (`assemblePipelineMemoryContext`) | into `enhancedPrompt` `:1171` |
| similar-setups context | `:1073` | into `enhancedPrompt` `:1172` |
| weighted-voting learning context (per-provider historical accuracy) | `:1137-1155` | into `enhancedPrompt` `:1173` |
| the CODE-CHECKED SKILL TRIGGER note (`evaluateSkillPredicates`) | `:1095-1116` | into `enhancedPrompt` `:1174` |
| decision reflections from closed trades | `:1194-1201` | prepended to `enhancedPrompt` `:1197-1199` |
| gate-keeper injection | `:1203` — **a literal `''`** | prepended `:1208` |

`enhancedPrompt` is then read at exactly one place: `devLog('[Hybrid Intelligence] Enhanced
prompt length:', enhancedPrompt.length)` (`:1213`). The three sends use `promptToSend`:
the automation arm `:1258`, the bot arm `:1384`, the desk arm `:1411`.

**Blast radius.** Every trader-facing turn loses its automatic memory context: the
retrieved notebook rules, the similar closed trades, the provider-accuracy weighting, the
"CODE-CHECKED TRIGGERS" note and the reflections. The model still *can* reach the notebook —
by calling `recall` / `get_notebook_map` — but nothing tells it to, except the mandate's
one sentence ("Your own trading memory is one of these tools…", `services/analysis/DeskToolsService.ts:1779`).

**A second-order effect that the repo has already closed.** The injection ledger is
**opt-in**, not opt-out: `getMemoryFilesContext` writes a record only when
`options?.recordInjections === true` (`services/learning/MemoryRetrievalService.ts:967`),
and the comment says exactly why — *"a record grants a skill credit for the run, so it may
only be written for a block that was ACTUALLY SENT — and the pipeline assembles this whole
retrieval into a prompt it never sends"* (`:958-966`). The pipeline does **not** opt in
(`hooks/analysisPipeline/memoryContext.ts:143`, `:151`), so the FOLLOWED-credit join
(`services/learning/MemoryInjectionService.ts:189`) is not poisoned by the discarded
context. The F-01b concern in `docs/plan/full-audit.md:1673` is therefore **closed** —
but it is closed by a single `=== true` on one line, and a future call site that opts in
would reopen it silently.

### 4.2 The `propose_skill` path — the defect in full — **HIGH**

**The defect.** The `propose_skill` tool schema **requires** a `reason` argument —
"Evidence from THIS session that motivates the skill"
(`services/analysis/DeskToolsService.ts:1074`, listed in `required` at `:1077`) — and the
handler **never reads it**. The whole `case 'propose_skill'` block is
`services/analysis/DeskToolsService.ts:2645-2717`, and `call.arguments.reason` does not
appear in it. It appears in three *other* handlers — `amend_memory` (`:2527`), `revise_skill`
(`:2793`), `decline_trade` (`:3240`) — which is what makes the omission a defect and not a
design.

There is also **no slot for it downstream**. `CraftedSkillSchema`
(`schemas/learning.ts:121-209`) has no `reason` / `whyProposed` / `evidence` field, so the
value could not be stored even if the handler forwarded it; and the receipt
(`:2712` — `{proposed, id, skill, note}`) does not carry it either, so the transcript's
action chip cannot show it either.

**What the trader sees.** The Coach inbox holds a draft whose entire content is the
craft's clauses. The human pressing "Save" is being asked to approve a rule with no
statement of *why the model thought it was worth approving* — and the model was explicitly
required to write that statement and it went nowhere.

**Blast radius.**
- Every `propose_skill` call spends model tokens on an argument the app discards.
  Native tool-calling providers enforce `required`, so the model *must* produce it.
- The approval gate is the weakest link in the whole growth loop (a human is asked to
  rubber-stamp a machine-authored rule) and it is the one field that would have given the
  human something to check.
- It is a *silent* loss: no log, no notice, no error. The model is told "Pending draft
  queued for human approval" (`:2712`) and reasonably concludes its evidence was queued too.

**Two smaller defects on the same path.**
- `services/analysis/DeskToolsService.ts:2657` — `if (!Array.isArray(steps)) steps = [String(steps)];`
  coerces a *missing* `steps` into the literal one-element array `["undefined"]`, which
  satisfies `z.array(z.string()).min(1)` and is written into the draft as a real step.
  The rejection message at `:2673` then lists `steps` as a possible missing field — a field
  the coercion makes impossible to be missing.
- The `propose_skill` receipt's `skill` field is `crafted.name` (`:2712`) — the display
  name, not the slug the file will get. That is correct here (`ingestCraftedSkillFromDraft`
  derives its own slug, `services/learning/SkillMemoryService.ts:2941-2951`), but it means
  the action chip and the eventual file name are different strings.

**Git history.** The previously-known class of this bug — a proposal write that failed
still reporting success — **was** fixed: commit `121bd1df` *"fix(learning): a proposal write
that failed now fails, instead of returning a success shape"* added the read-back inside
`queueSkillDraft` (`utils/skillDrafts.ts:75-82`) and the handler's "the draft could not be
stored" branch (`services/analysis/DeskToolsService.ts:2708-2711`). `git log -S "propose_skill"`
shows the handler's last change was `2f0467c4` (adding `description` as the activation
key). **The `reason` drop is not mentioned in either.** The one earlier draft-id defect
(`chat-${Date.now()}` making the dedupe unreachable) is fixed and documented at `:2681-2689`.

### 4.3 An unattended background job can write to the trader's notebook — **HIGH**

The automation surface deliberately denies eight growth tools from unattended runs
(`services/trade/automationTurn.ts:56-64`). The **skill-evaluation scheduler** — also
unattended, also detached — reaches the *same* loop with **no allow-list at all**:

- `services/learning/SkillEvalScheduler.ts:284-294` calls `analyzeTradingView(cfg, {…})`
  **without** `allowedTools`;
- `services/providers/GenericAnalysisService.ts:449-452` forwards `allowedTools:
  params.allowedTools` — `undefined`;
- `services/analysis/DeskToolsService.ts:2485` refuses only when the list is non-empty, and
  `:3720-3724` offers **every** definition when it is empty;
- `utils/harnessSettings.ts:110` — `deskToolsEnabled` defaults to **true**, so
  `services/providers/GenericAnalysisService.ts:350-354` turns the desk loop on for this path;
- the runner is fired detached from the trade-sync chain
  (`services/learning/SkillMemoryService.ts:3797-3798`: `void runDueSkillEvalWithDefaultRunner(…)`).

So an unattended job can call `propose_skill`, `write_memory_note`, `remember`, `forget`,
`amend_memory`, `forge_tool`, `revise_skill`, `propose_strategy`, `decline_trade` — **the
exact eight the automation surface denies** — plus every confirmed forged `custom_*` HTTPS
recipe, whose endpoint the model itself wrote (a forged POST performs a write;
`services/analysis/DeskToolsService.ts:485-492` notes this and gates the *cache*, not the call).

The safeguard today is the *model's judgement*, not the app's: the analysis prompt does not
mention any growth tool (`constants/prompts/analysisPrompts.ts` — zero matches for
`propose_skill|write_memory_note|remember|forge_tool|amend_memory`), but the growth tools'
full schemas are in the request, so the model can see and call them. The repo's own
analysis says the same: `docs/analysis/2026-10-21-02-enhancements.md:33`.

### 4.4 The allow-list mechanism has four entry points and three policies — **MED**

`services/analysis/DeskToolsService.ts` enforces `allowedTools` in three places
(`:2485` core, `:3944` forged, `:3721` the offer filter) and the app sets it in exactly
three places: `CHAT_SURFACE_TOOLS` (`services/trade/chatSurfaceTurn.ts:308`), `TRADE_TOOLS`
(`services/trade/chatTurnRunner.ts:672`) and `AUTOMATION_TOOLS`
(`services/trade/automationTurn.ts:203`). The fourth desk-loop entry point — the
skill-evaluation path — has none (§4.3). `AnalyzeTradingViewParams.allowedTools` exists
(`services/providers/GenericAnalysisService.ts:270`) and the local `AnalysisRequestParams`
in the pipeline still declares one (`hooks/useAnalysisPipeline.ts:319`) — **neither
interface is ever populated**, so the parameter is a promise the code does not keep.

### 4.5 The prompt A/B lane records a difference that does not exist — **MED**

`beginPromptLane()` is called per run and stamped on `runStats.promptLane` /
`promptVersion` (`hooks/useAnalysisPipeline.ts:965-969`, written `:1296-1297` and `:1466`).
The ledger then groups journal rows by it (`utils/promptVersionStats.ts:27`) and the
profile card presents it as a measurement (`components/dashboards/learning/TraderProfileCards.tsx:45`,
`utils/reportExport.ts:238`). But **no prompt on the trader-facing path resolves an
override** — `services/trade/**` contains zero `getPrompt` calls — so a `control` run and a
`live` run send identical bytes and record different labels. (Repo's own O-140,
`docs/plan/open-items.md:425`.)

### 4.6 The four `analysis.*` prompts are unreachable from the trader — **MED**

`constants/promptRegistry.ts` presents 12 user-editable prompts in Settings → Prompts.
**None** of them is resolved on the trader-facing chat/dock/automation turn path —
`services/trade/**` contains zero `getPrompt` calls.

To be precise about which ones are affected: the four `analysis.*` prompts — the ones
that would shape a trading answer — reach a model **only** through `analyzeTradingView`
(`services/providers/GenericAnalysisService.ts:357, 363, 368, 401`), whose **only**
production caller is the skill-evaluation scheduler
(`services/learning/SkillEvalScheduler.ts:284`); the trader-facing wrapper
`analyzeTradingViewWithTransientRetry` has zero callers (§1 #24). The other eight are
reachable and genuinely live: `learning.chart_scan` runs inside the `scan_chart_skills`
desk tool (`services/learning/chartScanSkills.ts:296`), `notebook.chat_note` runs inside
the "save this to the notebook" send (`services/learning/NotebookWriterService.ts:86`),
and the rest run in the learning loop or in Settings.

So a trader who edits "Master Analysis Prompt" changes the skill-eval harness and
`analysis.risk_rules` never shapes a trader-facing answer — while "Chart-history skill
scan" does. The Settings UI presents the twelve as one list, so the distinction is not
visible from the editor.

### 4.7 The round budget and the turn budget are enforced, but a *stalled* model can still spend the whole wall clock — **LOW/MED**

The wrap-up notice fires once at 80 % of the 180 s budget
(`services/analysis/DeskToolsService.ts:4069-4072`) but does not stop the turn; the round
cap (8) and the per-call deadline (20 s) are the hard stops. A seat that answers every round
with a fresh call can therefore burn ~160 s of a 180 s turn. That is the intended shape
(the budget is a hang guard, not a ration) but the trader sees a long silence with only a
"Thinking…" placeholder.

### 4.8 `onStreamReset` semantics are subtle and only one consumer honours them — **LOW**

`streamChatWithDeskTools` re-yields the authoritative text after a wipe **only if** the
consumer implements the wipe channel
(`services/analysis/DeskToolsService.ts:4411-4420`: *"Gated on an observing consumer (one
that clears its bubble on wipes): without the wipe channel the re-yield would DUPLICATE the
answer instead of replacing residue."*). `toolTurn` does implement it
(`services/trade/toolTurn.ts:182-187`), so the two production sinks are fine — but any
third sink that calls `streamChatWithDeskTools` without `onStreamReset` will double the
answer after a self-heal.

### 4.9 The `requireFirstToolRound` / `toolChoice:'required'` lever is dead code — **LOW**

`services/analysis/DeskToolsService.ts:3638`, `:4139`, `:3737-3739`. It was the "force the
seat to ground itself before arguing" rule for debates running without live hybrid data.
The debate engine is gone; no production caller sets it. It is harmless, but it is a
*reader's* false signal that a turn can force a lookup.

### 4.10 The tool catalogue is a large fixed per-request tax — **LOW/MED**

31 core definitions + 8 chart definitions + every confirmed forged tool are filtered and
sent on **every** round of **every** turn. `propose_skill`'s schema alone is ~2.7 k chars
(`docs/analysis/2026-10-21-01-system-and-data-flow.md:221`), `run_monte_carlo` ~2.0 k, and
the Chat surface carries 30 of the 31 core tools. The loop re-sends the *definitions* on
every round (`:3716-3724`), and compaction only shrinks the *messages*
(`services/providers/contextCompact.ts:217-308`) — the schema tax is not part of the
compacted array and is not counted by `estimateMessagesTokens` (it is covered by the flat
`WIRE_FRAMING_SAFETY_TOKENS` reserve, `utils/contextWindow.ts:47-54`).

### 4.11 The learning hooks and the payload-store write are swallowed — **LOW, by design**

`services/trade/chatTurnRunner.ts:817, 830, 836, 839` — `.catch(() => { /* best-effort */ })`.
`services/trade/chatSurfaceTurn.ts:277-283` and `services/trade/chatTurnRunner.ts:711-716`
— an empty `catch` around `saveToolPayload`. Both are deliberate and defensible (a failed
lesson write must not turn a delivered answer into a failed turn; a payload write must not
take down the transcript write it rides inside) — but they mean a trader is never told that
a skill/memory lesson failed to save.

---

## 5. What is ALREADY GOOD

Do not re-do any of this.

**One loop, one executor, one registry.** The three surfaces share `runToolTurn`
(`services/trade/toolTurn.ts:131`) and `runDeskToolLoop`
(`services/analysis/DeskToolsService.ts:3571`); the differences are the sink and the
allow-list, not the machinery. The panel, the Chat surface and the schedule cannot drift
about how a turn behaves because there is nothing to drift.

**The allow-list is enforced at the chokepoint, on every transport.**
`executeDeskTool` refuses an off-list name *before* the cache and before the switch
(`services/analysis/DeskToolsService.ts:2478-2487`), because a text-protocol seat can emit
a tag for any tool. The forged-tool path is gated separately (`:3944-3947`) for the same
reason. This is the right place and it is pinned by a test
(`tests/deskTools.test.ts:119-158`).

**The mandate is composed from the tools the turn can actually call.**
`deskToolsMandateFor(offered)` (`services/analysis/DeskToolsService.ts:1739-1784`) and the
invariant test that every tool the mandate *names* is a tool the turn can *call*
(`tests/deskSystemPrompt.test.ts:62-80`).

**The refusal is a failure, not a receipt** (`services/analysis/DeskToolsService.ts:2426-2438`),
so a rejection cannot be cached and replayed as a success.

**The context compaction is atomic where it must be.** A `tool_calls` block and its `tool`
replies live or die together (`services/providers/contextCompact.ts:122-145`), because a
split pair 400s the transcript at every OpenAI-compatible gateway — and the compactor
never touches the system block or the trailing `keepAtLeast` messages
(`:209-211`, `:259-288`).

**The context window is learned, not guessed.** The provider's own rejection is the best
evidence and it is recorded (`utils/contextWindow.ts:107-121`;
`services/providers/GenericProviderService.ts:1324-1341`), which is what makes the
optimistic 1 M default safe (`utils/contextWindow.ts:27-41`).

**The output budget is sized against the same window** (`utils/contextWindow.ts:187-196`;
`services/analysis/DeskToolsService.ts:359-377`) — the half of the request that is easy to
forget and that 4 k/8 k local models cannot honour.

**Every failure mode has a named, visible shape.** A timeout says "did not answer within
20s"; a throw says "the lookup threw before it returned"; a stop says "the turn was stopped
while this lookup ran" (`services/analysis/DeskToolsService.ts:259-284`). A failed source
says `DATA_UNAVAILABLE:` — the model is told *unknown*, never *absence*
(`utils/harnessMarks.ts:25-38`).

**The tool-round budget was reasoned about, not guessed.** 8 rounds, with the reasoning
written down and the failure it prevents named (`services/analysis/DeskToolsService.ts:187-196`),
and the round output budget raised to 8192 with the reason spelled out (`:222-241`).

**The thinking-cut re-ask and the "produced nothing" continuation** are two small,
surgical repairs for the two ways a reasoning model produces an empty turn
(`services/analysis/DeskToolsService.ts:3814-3834`, `:4441-4451`).

**The self-heal distinguishes a truncated call from a malformed one** — telling a model to
re-emit a call that was cut off reproduces the cut
(`services/analysis/DeskToolsService.ts:3430-3442`, `:3775-3797`).

**The transcript grammar is written down once and both homes read it.**
`utils/turnStatus.ts` + `utils/toolKinds.ts` + `tests/turnStatus.test.ts` — and the
coverage test is a *source contract* against the desk service's own table, so a new tool
cannot slip through unlabelled (`tests/turnStatus.test.ts:228-266`).

**The two homes' tool trail is correct.** `Message.toolEvents` + `Message.toolIds` for the
settled record, `Message.liveToolEvents` for the capped live feed, and one projection that
splits the joined feed so the dock and the Chat surface cannot disagree about how many
lines a turn had (`services/trade/chatSessions.ts:491-501`;
`tests/toolTrailBothHomes.test.ts`).

**The harness-note dialect is generated from the markers, not described from memory**
(`utils/harnessMarks.ts:136-152`, `:188-191`) — and third-party text is neutralised **at
ingestion**, so a web page cannot speak in the app's privileged voice
(`utils/harnessMarks.ts:172-183`).

**The clipper preserves JSON** rather than handing the model syntactically broken JSON,
and records what it shed inside the payload (`_omitted` / `_clip`)
(`services/analysis/DeskToolsService.ts:565-639`).

**A clipped result can be read back**, and the receipt is only offered to a seat that can
redeem it (`services/analysis/DeskToolsService.ts:550-551`, `:749-757`, `:2921-2961`).

**The cache policy is an allow-list**, and the failure sentinel is never cached
(`services/analysis/DeskToolsService.ts:450-472`, `:3304-3306`).

**The cache is invalidated at the one choke point every run passes**
(`services/analysis/DeskToolsService.ts:4192-4199`).

**A Stop is a first-class outcome**, checked before anything else, and the two homes agree
about it (`services/trade/toolTurn.ts:213-218`).

**The truncation tally is a real measurement**, not a regex guess
(`utils/finishReason.ts:113-217`).

**The effort tier and the wire audit are carried OUT of the executor on the one return
every path shares**, so a row and the wire cannot claim different things about one turn
(`services/trade/toolTurn.ts:79-96`, `:155-165`).

**A failure is stamped on the row whether or not prose arrived** — a half-written plan
that streamed "Long BTC above 65,000, stop 64,200, target…" and then failed used to read as
finished advice (`services/trade/chatTurnRunner.ts:1062-1082`; repo O-137, closed).

**The "nothing was looked up" check uses an explicit market-read set**, so a memory read, a
skill edit, a presented plan or a decline cannot silence it
(`services/analysis/DeskToolsService.ts:2403-2419`;
`services/trade/chatSurfaceTurn.ts:362-371`; `tests/fullAnalysisRequiredTools.test.ts:92-137`).

**A plan is rationed for scheduled runs** — one per run and a daily cap — with a refusal
receipt that tells the model to put the idea in prose instead
(`services/trade/automationTurn.ts:66-70`, `:209-248`).

**A failed scheduled run cannot hide.** The notices ("NOTHING WAS LOOKED UP", "TOOL
FAILURE(S)", "PLAN CAP REACHED") are computed from the tool payload's own `ok` flag and
written into the stored row (`services/trade/automationTurn.ts:279-293`).

**The injection ledger is opt-in, and it knows why.**
`getMemoryFilesContext` writes an injection record only when
`options?.recordInjections === true` (`services/learning/MemoryRetrievalService.ts:967`),
and the comment states the rule: *"a record grants a skill credit for the run, so it may
only be written for a block that was ACTUALLY SENT"* (`:958-966`). The pipeline does not
opt in, so the discarded retrieval (§4.1) cannot poison the FOLLOWED-credit join.

**A stale run cannot write across a profile change** — the owner check is in the write
path (`hooks/useAnalysisPipeline.ts:806-817`).

**The run registry makes "a conversation switch moves the view, not the run" explicit**
(`hooks/useAnalysisPipeline.ts:373-395`, `:473-479`).

---

## 6. Method and limits

- Static reading only. No app was run, no build was made, no provider was called, no API
  key was read. `git log`/`git log -S`/`git log -L` were used for the history claims.
- `npm run typecheck` was **not** run: every symbol cited here was read in its own file or
  in a test that exercises it.
- Counts quoted from the repo's own docs (`docs/plan/full-audit.md:1396-1431`) were taken
  from the source where it mattered (the catalogue length is the array literal at
  `services/analysis/DeskToolsService.ts:909-1543`).
- Files read in full: `hooks/useAnalysisPipeline.ts` (1799 lines),
  `services/analysis/DeskToolsService.ts` (4467 lines), `services/trade/chatTurnRunner.ts`
  (1380), `services/trade/chatSurfaceTurn.ts` (420), `services/trade/toolTurn.ts` (254),
  `services/trade/automationTurn.ts` (306), `services/trade/chatStore.ts` (600),
  `services/trade/tradeChatContext.ts` (374), `utils/turnStatus.ts`,
  `utils/toolKinds.ts`, `utils/runStatus.ts`, `utils/harnessMarks.ts`,
  `utils/contextWindow.ts`, `utils/finishReason.ts`,
  `services/providers/contextCompact.ts`, `constants/prompts/harnessContract.ts`,
  `constants/promptRegistry.ts`, `utils/composePrompt.ts`,
  `services/analysis/skillPredicate.ts` (486), and the six named test files.
- `services/analysis/skillPredicate.ts` was read in full because it was named. Note that it
  is **not** about tool visibility: it is the machine-checkable trigger on a *skill* —
  a hand-written parser + a three-valued evaluator over candle-derived series
  (`services/analysis/skillPredicate.ts:188-284`, `:408-451`). Its predicate is offered to
  the model through `propose_skill` / `revise_skill`
  (`services/analysis/DeskToolsService.ts:1075`, `:1132`) and stored through
  `sanitizePredicate` (`services/learning/SkillMemoryService.ts:2806`, `:2937`). What makes
  a *tool* visible to a turn is the allow-list + the mandate (§1 #30-#34).
- Files read in part (cited by line, not by assertion): `services/providers/GenericProviderService.ts`
  (the request/retry/error paths), `services/providers/GenericAnalysisService.ts`
  (the analysis prompt), `services/learning/SkillEvalScheduler.ts`,
  `services/learning/SkillMemoryService.ts`, `services/learning/draftGates.ts`,
  `services/learning/skillApproval.ts`, `utils/skillDrafts.ts`, `schemas/learning.ts`,
  `services/trade/chatSessions.ts`, `App.tsx`.
- **Not found after searching**: any second tool registry, any second tool-call parser, any
  place that renders the tool trail outside `utils/turnStatus.ts` +
  `components/shared/ToolActivityRow.tsx` + `components/trade/panels/ChatWorkTimeline.tsx`,
  and any consumer of `requireFirstToolRound` outside the desk module itself.
