# Trade log, `get_trade_log`, the last-20 brief, and trade-history intake

Research baseline section — August Trading (`C:\Dev\august-3.5`).
Read-only static inspection + `git` only. No app run, no build, no API keys, no orders.

**Headline:** the journal is a real, single, well-engineered store, and the model can read
it on demand through `get_trade_log` — but the *last-20 brief* (the thing that was supposed to
put recent form in front of every seat) is **computed on every send and thrown away**: it never
reaches a wire. And there is **no trade-history import of any kind** — CSV, image and PDF all
land somewhere other than the journal.

---

## 1. Numbered feature list

| # | Feature | Verdict | Evidence |
|---|---|---|---|
| 1 | **The trade record** — `LoggedTrade`: analysis, outcome, PnL in two units, price-measured R, excursions, discipline tags, provenance. | **REAL** | `types/trade.ts:28-293` |
| 2 | **The trade store** — one logical store, two physical backends: SQLite table `trades` (native) / IndexedDB `userProfiles` blob (web). Key = `LoggedTrade.id` (= the Message id) + `username`. | **REAL** | `services/infrastructure/SqliteService.ts:159-183` (schema), `:718-742` (row write), `:756-774` (row read); `services/infrastructure/dbService.ts:32-34, 61-82, 227-263` (web) |
| 3 | **Section-diffing persistence** — a save rewrites only the changed sections, in one transaction, and deletes rows absent from the profile (so deletions and imports do not resurrect). | **REAL** | `services/infrastructure/SqliteService.ts:546-609` (`tradesJson` fingerprint → `sqliteSaveTrade` loop → `deleteAbsentRows`); `hooks/useProfilePersistence.ts:104, 156` |
| 4 | **Schema-free column layout** — 18 core columns; every newer field is JSON in the `meta` TEXT column and spread back on read. No migration needed for new fields. | **REAL** | `services/infrastructure/SqliteService.ts:159-183, 711-742, 756-774`; asserted in `tests/sqliteService.test.ts` ("stage-3 trade fields round-trip") |
| 5 | **The `get_trade_log` desk tool** — the model's on-demand read of the journal as rows. | **REAL** | `services/analysis/DeskToolsService.ts:1384-1402` (definition), `:3285-3309` (handler) |
| 6 | **The last-20 brief module** — one builder, two renderings (tape for analysts, tally for the moderator), explicit log-time ordering, dollar/percent units never merged. | **REAL** (as a module) | `utils/recentTradesBrief.ts:20, 97-123, 140-184, 195-210, 232-253, 256-258` |
| 7 | **The last-20 CARD in the Journal** — "Last 20 logged trades" with a W/L · win-rate · avg-R · net-$ · streak header and one row per trade. | **REAL** (trader-facing) | `components/journal/Journal.tsx:323-380` (`data-testid="journal-last-20"`), wired at `:13, 324, 336` |
| 8 | **The last-20 INJECTION into a model turn** (`recentFormBlock` → `getMemoryFilesContext` → `enhancedPrompt`). | **COSMETIC** — computed every send, **never sent**. See §3. | `services/learning/MemoryRetrievalService.ts:730-751, 923-935`; `hooks/analysisPipeline/memoryContext.ts:143`; `hooks/useAnalysisPipeline.ts:1168-1213` vs. the three sends at `:1258, 1384, 1411` |
| 9 | **The Journal and the model read the SAME builder** — `buildTradeLogBrief` vs `buildRecentTradesBrief`+`selectRecentTrades`. They cannot disagree on the arithmetic. | **REAL** | `components/journal/Journal.tsx:324`; `services/analysis/DeskToolsService.ts:3296-3297`; shared module `utils/recentTradesBrief.ts:226-227` |
| 10 | **The tool's enforce-at-the-executor allow-list** — an off-list tool name is refused before the cache and before the switch, on every transport (text-protocol seats included). | **REAL** | `services/analysis/DeskToolsService.ts:2483-2492`; refusals are `ok:false` (`:2431-2443`) |
| 11 | **`get_trade_log` is deliberately NOT cached** — a trade logged during the turn that reads the log is visible immediately. | **REAL** | `services/analysis/DeskToolsService.ts:440-472` (`CACHEABLE_TOOLS` omits it), `:3327-3329`; pinned by `tests/tradeLogTool.test.ts:115-123` |
| 12 | **`get_trade_log` is NOT a "market read"** — so it cannot satisfy the Full-analysis "you looked something up" check. | **REAL** (deliberate) | `services/analysis/DeskToolsService.ts:2408-2424`; consumed at `services/trade/chatSurfaceTurn.ts:345-354` |
| 13 | **Trade-history intake: CSV file** — attached to a chat message. | **COSMETIC** for history: it becomes prompt text, never a trade row or a draft. | `components/trade/panels/ChatComposer.tsx:159`; `hooks/useChatAttachments.ts:64-65` (readAsText); `services/trade/chatTurnRunner.ts:922-925, 982` |
| 14 | **Trade-history intake: pasted text** — the trader's own message. | **COSMETIC** for history: prompt text only. | `services/trade/chatTurnRunner.ts:982` |
| 15 | **Trade-history intake: screenshot / image** — a real image part for a vision seat; an explicit "this model cannot see images" for a text-only seat. | **REAL** as analysis input; **COSMETIC** as journal intake (it produces a new AI message, not a row). | `hooks/useChatAttachments.ts:64`; `services/providers/imageProcessor.ts:43-103, 105-165`; `services/trade/chatTurnRunner.ts:160-173`; `services/trade/chatSurfaceTurn.ts:178-199`; `hooks/useAnalysisPipeline.ts:1415`; `hooks/useTradeLogging.ts:988-1024` |
| 16 | **Trade-history intake: PDF** — text layer via pdfjs, scanned pages via vision OCR. | **COSMETIC** for the journal: it is wired to the **strategy book**, not to trades. There is **no PDF path into the journal at all**. | `services/infrastructure/pdfTextExtractor.ts:57-88`; `services/learning/pdfOcrService.ts:34-64`; sole callers `components/settings/StrategiesManager.tsx:4, 6, 94, 106` (accept `.pdf` at `:260`) |
| 17 | **Trade-history IMPORT** (CSV → rows, broker statement → rows). | **ABSENT** — no importer exists anywhere. | `grep` for `importTrades|importCSV|parseCsv` → 0 hits; the only CSV code is the exporter `utils/reportExport.ts:31-54` |
| 18 | **Training-data export (JSONL)** — one model-ready record per trade. | **REAL and mostly complete** (see §5 for the fields it omits). | `utils/reportExport.ts:142, 171-244, 252-255`; button `components/settings/tabs/ActionsTab.tsx:33-52`; fed from `components/settings/SettingsMenu.tsx:442, 488` → `components/settings/tabs/types.ts:20` |
| 19 | **CSV export (14 columns)** and **print-to-PDF HTML report** from the Journal. | **REAL** (one-way) | `utils/reportExport.ts:31-54, 74-140`; buttons `components/journal/Journal.tsx:83, 94` |
| 20 | **Backup / restore** — a backup is the whole profile JSON (so the trade log rides it) plus a preferences sidecar and a thinking sidecar. Import validates `tradeLog` and previews the count. | **REAL** | `services/infrastructure/BackupService.ts:116-156, 666-706, 711-726, 765-779, 823+` |
| 21 | **`ExportService` (Settings → Data export)** — **does NOT carry the trade log**; it is a Preferences-only surface. | **REAL but blind to the journal** | `services/infrastructure/ExportService.ts:638, 939, 1006`; `RAW_LOCAL_STORAGE_PREFIXES` at `:299`; nothing reads `tradeLog` |
| 22 | **Outcome autopilot** — automatic settlement: kline-verified SL/TP, MAE/MFE, realized R, cost/net R, suggested size, resolution source. | **REAL** | `services/ui/OutcomeAutopilotService.ts:27-53, 514-592, 629-673`; `services/backtesting/outcomeEngine.ts:394-470` |
| 23 | **Settlement reflection** — the ONE bounded model call at settlement; it is the only writer of `trade.postMortem`. | **REAL** | `services/learning/settlementReflection.ts:239-327`; called at `hooks/useTradeLogging.ts:524-555` |
| 24 | **The decline ledger** (`decline_trade`) — a recorded skip. | **REAL as a record, deliberately NOT a journal row**: "no journal row exists; the skip is now auditable." It never reaches `get_trade_log` or the training export. | `services/analysis/DeskToolsService.ts:3254-3283`; `services/trade/declineLog.ts:10-17, 33, 62` |
| 25 | **The arbiter allow-list** (`ARBITER_ALLOWED_TOOLS`) — the seat policy that put `get_trade_log` on the "seat that judges the record". | **DEAD** — the arbiter/moderator seat was deleted; its only importers were two test files, removed with the suite on 2026-10-23. | `services/analysis/DeskToolsService.ts:3364-3380` |
| 26 | **`Message.evidencePack`** ("what the moderator was actually shown") and **`Message.memoryRetrieved`** ("notebook files retrieved for this run"). | **DEAD fields** — no writer anywhere in the app. | `types/message.ts:281, 285-291`; `grep memoryRetrieved:` → 1 hit, a type; `grep evidencePack` → only readers + test fixtures |
| 27 | **`LoggedTrade.postMortemImages`** — the Journal renders it. | **DEAD field** — no writer anywhere. | `types/trade.ts:79`; `components/journal/TradeLog.tsx:71`; `grep postMortemImages\s*[:=]` → 1 hit, a test fixture |

---

## 2. "One trade, end to end"

A trade from a `present_trade` card to a training record.

```
CAPTURE
  model calls present_trade
    services/trade/presentTradeTool.ts:78-218  → parseTradeProposal, skill veto (:113-133),
                              gate scan started (:151), ONE plan object (:159),
                              receipt states what the trader will see (:213-218)
    → sink.setProposal(proposal)   → Message.proposal   (types/message.ts:316)
  trader presses "Log this trade"
    App.tsx:1577-1625  handleLogProposedTrade
      → ensureStamp(proposal, loggedTrades)   — the gate cap is known BEFORE the row exists (:1578)
      → refusal ⇒ no row (:1580-1586); gate unavailable ⇒ explicit confirm (:1587-1595)
      → "nothing looked up" ⇒ explicit confirm (:1599-1610)
      → planId dedupe against LoggedTrade.planId (:1617-1621)
      → buildProposedTradeMessage(stamped, id)   services/trade/proposedTrade.ts:370
  a PENDING message is appended → the autopilot registers it
    services/ui/OutcomeAutopilotService.ts (60s loop, kline verification)

SETTLE
  price crosses SL/TP → verifyHistoricalOutcome → buildWinResolution / buildLossResolution
    services/ui/OutcomeAutopilotService.ts:514-592
      → pnlPercent (leveraged), excursions {mae,mfe}, realizedR, slOptimizationData
      → services/backtesting/outcomeEngine.ts:394-426 (MAE/MFE, candle-bounded)
                                :459-470 (realizedRFromPrices — price levels only)
  the trader's confirm → logTradeWithFeedback(message, outcome, feedback)
    hooks/useTradeLogging.ts:275-447
      row built at :360-447 — id = message.id (:361), decidedAt (:375), planId (:378),
        outcomeResolvedAt + resolutionSource (:382-385), pnlAmount / pnlPercent (:388-389),
        benchmark (:393), MAE/MFE scaled once (:298-299, 403-408), realizedR+rSource (:409-411),
        costR / netR / slippageModeled (:412-414), suggested size + model-stated size (:323-334),
        modelsUsed/thoughtProcesses (:420-421), debateTurns (:427), promptVersion/promptLane/
        sourceRunId (:429-431), discipline tags (:437), rMultiple (:441-446)
      in-memory: setLoggedTrades (:460) — this exact array is the Journal's AND the model's
      side effects: harness line + openTrades ledger (:480-505)
      settlement reflection (fire-and-forget, ordered BEFORE the notebook sync) (:524-555)
        services/learning/settlementReflection.ts:239-327  → trade.postMortem + postMortemModel
      → syncClosedTradeToNotebook (:549-554)  → diary + IF/THEN skill DRAFT (human-gated)

STORE
  hooks/useProfilePersistence.ts:104,156 → dbService.saveUserProfile(username, { tradeLog })
    services/infrastructure/dbService.ts:308-342
      native → sqliteSaveUserProfile → services/infrastructure/SqliteService.ts:546-609
          trades section fingerprinted (:593) → sqliteSaveTrade per row (:596-598)
          → services/infrastructure/SqliteService.ts:718-742  (17 core cols + meta JSON)
          → deleteAbsentRows so deletions/imports do not resurrect (:603-607)
      web    → IndexedDB `FuturesAI-DB` / `userProfiles` (dbService.ts:61-82, 227-263)

SURFACE TO THE TRADER
  components/journal/Journal.tsx:323-380  — "Last 20 logged trades" card
    header  W/L · win rate · avg realized R · net $ · streak        (:338-344)
    rows    log time · symbol · direction · outcome · pnl · R · strategy · tags (:347-377)
  components/journal/TradeLog.tsx        — the full trade list
  Settings → Data → Training data        — the JSONL export (§5)
  Settings → Journal → CSV / HTML report — utils/reportExport.ts:31-140

SURFACE TO THE MODEL  (on demand, never pushed)
  the same `loggedTrades` array travels as DeskToolContext.trades
    App.tsx:2582 (dock) → services/trade/chatTurnRunner.ts:691
    App.tsx:1475 → hooks/useAnalysisPipeline.ts:1418 → services/trade/chatSurfaceTurn.ts:296
    services/trade/automationTurn.ts:219 (scheduled run)
  the seat calls get_trade_log
    services/analysis/DeskToolsService.ts:3285-3309
      selectRecentTrades(context.trades, {…filter, limit})  (:3273)
        utils/recentTradesBrief.ts:97-123   filter → sort by decidedAt ASC → last N
      buildRecentTradesBrief(rows)                           (:3274)
        utils/recentTradesBrief.ts:140-184   rows + header stats
      JSON out: {…filter, limit, returned, tally, rows[]}     (:3275-3284)
      budgeted to 4 000 chars (:526), spill receipt if clipped (:700-757)
      NOT cached (:450-466) → a trade logged mid-turn is visible
  ⇒ the model's window is 1-50 rows of 7 fields — a PROJECTION of the journal, not the journal.

EXPORT
  Settings → Data → "Export N trades (JSONL)"
    components/settings/tabs/ActionsTab.tsx:33-52 → utils/reportExport.ts:252-255
      trainingRecordFor(t) per row (:171-244) → one JSON object per line
  Journal → "Download trade log as CSV"   utils/reportExport.ts:31-54
  Journal → print-to-PDF report            utils/reportExport.ts:74-140
  Settings → Data → Backups                services/infrastructure/BackupService.ts:116-156
    (profile JSON ⇒ tradeLog; + preferences sidecar; + thinking sidecar)
```

---

## 3. The model's view of the journal

### 3.1 It gets

`get_trade_log` (`services/analysis/DeskToolsService.ts:1384-1402`, `:3285-3309`).

**Params** (`additionalProperties: false`, `:1385-1395`):

| param | type | meaning |
|---|---|---|
| `limit` | integer | most recent rows, **1-50**, default 20 (`:3264-3266`) |
| `coin` | string | base coin, e.g. `BTC` or `BTCUSDT`; matches on the base (`utils/recentTradesBrief.ts:104-108`) |
| `outcome` | enum | `WIN` \| `LOSS` \| `PENDING` \| `ENTRY_NOT_HIT` \| `SKIPPED` |
| `strategy` | string | substring of the strategy named at analysis time, **or** an exact `strategyFamily` (`:110-114`) |
| `since` | string | ISO date/datetime; rows **decided** at or after it (`:115`) |

**Returns** (`:3275-3284`): a JSON object — the echoed filter, `limit`, `returned`, a `tally`
line, and `rows`: one compact string per trade,

```
<decidedAt> <symbol> <direction> <outcome> · $<pnl|±%> · ±X.XXR · <strategy> · [tag,tag]
```
(`utils/recentTradesBrief.ts:125-137`)

`rows` are **oldest-first** (the tool description says so, `:1384`), because the brief sorts
by decision time ascending (`:121`).

**Limits / truncation**

- 50-row hard cap (`:3264-3266`).
- 4 000-char budget (`:526`) — deliberately raised from the 2 400 default because 20 rows
  measure ~2.7k and the default would have cut 3 rows *silently* (the comment at `:520-525`
  names this exact failure).
- When it still overflows, `clipWithinBudget` (`:565-639`) sheds whole JSON fields, records
  `_omitted` / `_clip`, and — for a non-reshapable payload — falls back to a line-boundary
  cut with a `clipNote` trailer.
- A `read_tool_output` spill receipt is offered when the payload was clipped (`:749-757`),
  gated by `spillReceiptAllowed` (`:550-551`).
- No cache: `CACHEABLE_TOOLS` (`:450-466`) does not list it, so a trade logged during the
  turn that reads the log is visible (`tests/tradeLogTool.test.ts:115-123`).
- Empty result is stated honestly: "No journal row matches that filter. That is not evidence
  of inactivity — only of no match." (`:3281-3283`, pinned by `tests/tradeLogTool.test.ts:84-88`).

### 3.2 It does **not** get

The row carries only: decision time, symbol, direction, outcome, **one** PnL unit, price-measured
R, strategy name, mistake tags + root-cause class. Everything else on the record is invisible
to the tool:

- entry / stop / target prices, the plan text, the confidence, the probability
- the post-mortem and the extracted **lesson** (`postMortem`, `rootCauseClass`)
- which model answered (`modelsUsed`), the moderator, `promptVersion` / `promptLane`
- `sourceRunId`, `planId`, the checklist, `followedPlan`, `planDeviationNote`
- `emotionalState`, `skipReason`
- the **benchmark alpha** (skill vs buy-and-hold)
- MAE / MFE, `costR`, `netR`, `slippageModeled`
- `debateTurns`, the reasoning, the screenshots
- the Journal's aggregate dashboards: per-strategy win rate, the calibration ledger, the
  family×regime matrix, the pass ledger

It also cannot: page (one call, one window), ask for a date **range** (only `since`), ask for a
row by id, or see anything the trader has not logged as a trade (declines live in a separate
ledger, `services/trade/declineLog.ts:10-11`; the chat transcript is a different tool,
`recall_chat` → `services/infrastructure/sessionSearch.ts:115-163`).

### 3.3 Is there a documented "what the model cannot see" boundary?

**No.** There is no disclosure surface, no field list, and no switch:

- The tool's own description (`:1384`) is the **only** place the model learns the journal is
  readable. The desk mandate mentions `recall` but never `get_trade_log` (`:1779`).
- The trader can see that the desk can read the journal: Settings → General → "What the desk
  can call" lists `trade log` / `get_trade_log` with the description's first sentence
  (`components/settings/tabs/DeskToolCatalogue.tsx:41-51, 92-99`). But it is a **reader** —
  "the allow-lists are code, not preferences" (`:14-16`) — so there is no per-tool switch,
  and nothing states *which fields* leave the machine.
- The one place in the repo that talks about this says the **opposite**:
  `services/learning/MemoryRetrievalService.ts:7-11` — *"The model sees the conclusions
  (doctrine, settled beliefs, skills), never the journal."* That is now false twice over: the
  recent-form block injects journal rows (`:742-750`), and `get_trade_log` hands over the rows
  on request.
- The Journal itself never tells the trader that the model reads their rows.

### 3.4 The last-20 summary — computed and dropped

**Where it is computed**

- `utils/recentTradesBrief.ts`
  - `selectRecentTrades` (`:97-123`) — filter → sort by `decidedAtOf` **ascending** → keep the
    most recent *N*. The module header is explicit that array order is NOT log order
    (`:6-8`).
  - `buildRecentTradesBrief` (`:140-184`) — one `TradeLogRow` per trade + header stats
    (decided/wins/losses/unresolved/winRate/avgRealizedR/netPnLDollars/netPnLPercent/streak).
  - `neutralRowsText` (`:195-210`) — the **analyst** rendering: day-level rows, no win rate, no
    streak, no net PnL. The comment is the design rationale: handing every opening prompt
    "you are three losses deep" is priming dressed as evidence (`:186-194`).
  - `tallyLine` (`:232-253`) — the **moderator/post-mortem** rendering: the framing whose job
    it is to weigh recent form.
  - `renderRecentTradesBrief` (`:256-258`), `buildTradeLogBrief` (`:226-227`),
    `briefFingerprint` (`:215-224` — an 8-hex FNV fingerprint so "which brief did this
    decision see" is answerable from stored data).

**Where it is injected into a turn**

- `services/learning/MemoryRetrievalService.ts:730-751` — `recentFormBlock(trades, asOfMs, audience)`.
- Pushed into the retrieval context at `:923-935` inside `getMemoryFilesContext` (`:848`),
  fingerprinted into the injection record as `journal/recent-form`.
- Reached from `hooks/analysisPipeline/memoryContext.ts:143` — `assemblePipelineMemoryContext`
  → `memoryFilesContext`.

**Is the injection real on the outbound prompt path? NO — it is computed and dropped.** The
proof, in order:

1. `hooks/useAnalysisPipeline.ts:1066-1084` destructures `memoryFilesContext` out of
   `assemblePipelineMemoryContext(...)`.
2. `:1169-1176` folds it into `enhancedPrompt` (with `similarSetupsContext`,
   `learningInjection`, `predicateGate.note`).
3. `:1197-1199` prepends the decision-reflection block; `:1208` prepends `gateInjection` — which
   is a **hard-coded empty string** at `:1203`; `:1213` only `devLog`s the length.
4. `enhancedPrompt` appears at exactly six lines in the whole repository — `:1168, 1175, 1197,
   1199, 1208, 1213` — and nowhere else (`grep enhancedPrompt` returns only this file plus
   `docs/plan/**`).
5. Every send uses `promptToSend`:
   - scheduled run → `runAutomationTurn({ prompt: promptToSend })` at **`:1258`**
   - bot thread → `streamQuickResponse(..., promptToSend, ...)` at **`:1384`**
   - the desk/tool turn → `runChatSurfaceTurn({ prompt: promptToSend, ... })` at **`:1411`**

So the notebook slice — matched skill body, doctrine, risk rules, similar trades, the
family×regime matrix, the decision reflections, **and the last-20 tape** — never reaches a
provider. `docs/plan/full-audit.md:1763` still records this as "**STANDS**", and
`docs/plan/implementation-record.md:144-148` confirms the contract test asserts only that the
four *surfaces* carry no retrieved blob, never that the pipeline sends one.

**Two further dead ends for the same block**

- The bot path calls `getMemoryFilesContext(query, undefined, 'analyst', 'opening', …)` —
  `services/agents/botLearning.ts:94-100` — with `trades = undefined`, and `recentFormBlock`
  returns `''` for undefined (`:735`). So the bot's shared-memory context can never carry the
  tape.
- The skill-eval harness passes `[]` (`services/learning/SkillEvalScheduler.ts:212`).

**And the source list is dropped too**: `listRetrievedMemorySources` (`:783-801`) returns
`journal/recent-form` among the sources, but `useAnalysisPipeline.ts:1066-1072` does **not**
destructure `memoryRetrieved` — and `Message.memoryRetrieved` (`types/message.ts:281`) has no
writer anywhere. So the trader's "which notebook files did this run see" surface is empty.

**Where it IS shown to a human** — `components/journal/Journal.tsx:323-380`. The
"Last 20 logged trades" card: a header (`wins/losses · win rate · avg realized R · net $ ·
streak`, `:338-344`) and one row per trade (`:347-377`). It reads the **same** array and the
**same** builder as the model, so the arithmetic cannot disagree — but the two surfaces use
different clocks (see §6.4).

**Verdict on the last-20 feature: REAL in the Journal, DEAD as a model feature.** Its unit
tests (`tests/recentFormInjection.test.ts`, `tests/recentTradesBrief.test.ts`) pass against a
function that no prompt calls.

---

## 4. Intake matrix

| Format | Can the trader get it IN? | End to end | Where it lands | Verdict | Evidence |
|---|---|---|---|---|---|
| **CSV file** | Yes — the chat composer accepts `.csv` | `useChatAttachments.attachFiles` → `reader.readAsText(file)` → the dock's `fileBlocks` → `[ATTACHED FILE — x.csv]\n<text>` appended to the user's message | **Prompt text only.** Not a trade row, not a draft, not parsed. | **COSMETIC** for history | `components/trade/panels/ChatComposer.tsx:159`; `hooks/useChatAttachments.ts:48-67`; `services/trade/chatTurnRunner.ts:922-925, 982` |
| **CSV file → journal** | **No. There is no importer.** | — | — | **ABSENT** | `grep -rn "importTrades\|importCSV\|parseCsv\|readAsText.*csv"` → no importer; the only CSV code is the exporter `utils/reportExport.ts:31-54` |
| **Pasted text** | Yes — the composer | becomes the user message | Prompt text only | **COSMETIC** for history | `services/trade/chatTurnRunner.ts:982` |
| **Screenshot / image (chat)** | Yes — `accept="image/*"` | data URL → `userContentWithImage` → a real `image_url` part for a vision seat; for a text-only seat an explicit "this model cannot see images" (`chatTurnRunner.ts:172`). The Chat surface does the same (`chatSurfaceTurn.ts:178-199`, `useAnalysisPipeline.ts:1415`). | **A new AI analysis message.** Not a journal row. | **REAL** for analysis, **COSMETIC** for history | `hooks/useChatAttachments.ts:64`; `services/providers/imageProcessor.ts:43-165`; `services/trade/chatTurnRunner.ts:160-173` |
| **Screenshot / image (Journal "update trade")** | Yes — the modal accepts `image/*` | `handleConfirmUpdateTrade(text, images)` → `handleSendMessage(text, metaImages, context, {isUpdate:true, …})` | **A new analysis message with the image.** It does **not** amend the logged row, and `LoggedTrade.postMortemImages` has no writer anywhere. | **COSMETIC** as a journal update | `components/journal/UpdateTradeModal.tsx:153`; `hooks/useTradeLogging.ts:988-1024`; `types/trade.ts:79`; `grep postMortemImages\s*[:=]` → one test fixture |
| **PDF** | Only in Settings → Strategies (`accept=".pdf"`) | `extractPdfText` (pdfjs text layer; scanned pages rendered to PNG) → `ocrPdfPages` (vision OCR) → summarised into a **strategy** | **A strategy in the strategy book.** There is no PDF path into the journal. | **COSMETIC** for the journal | `services/infrastructure/pdfTextExtractor.ts:57-88`; `services/learning/pdfOcrService.ts:34-64`; sole callers `components/settings/StrategiesManager.tsx:4, 6, 94, 106, 260` |
| **Broker statement (CSV/PDF) → rows** | **No.** | — | — | **ABSENT** | as above |
| **The app's own capture** (the one real way in) | Yes — "Log this trade" on a `present_trade` card, the capture modal, or the autopilot's settlement | §2 | **A real `LoggedTrade`** in the `trades` table | **REAL** | `App.tsx:1577-1625`; `hooks/useTradeLogging.ts:275-447`; `services/ui/OutcomeAutopilotService.ts:514-592` |

**The one-line answer:** the trader can get text, images and PDFs *into a conversation*; none
of them can get a trade *into the journal*. The only writer of a journal row is the app's own
capture funnel.

---

## 5. Training-data export

**Where.** `utils/reportExport.ts`:

- `TRAINING_SCHEMA_VERSION = 1` — `:142`
- `trainingRecordFor(t: LoggedTrade): Record<string, unknown>` — `:171-244`
- `exportTrainingDataJSONL(trades)` — `:252-255` — one JSON object per line, downloaded
  locally; nothing leaves the machine.

**The button.** Settings → Data → "Export N trades (JSONL)"
(`components/settings/tabs/ActionsTab.tsx:33-52`), fed from `props.loggedTrades`
(`components/settings/SettingsMenu.tsx:442, 488` → `components/settings/tabs/types.ts:20` →
`App.tsx:1475`).

**Format.** JSONL, `schemaVersion: 1` on every record, with three nests plus provenance.

| nest | fields | note |
|---|---|---|
| `decision` | symbol, direction, strategy, strategyFamily, verdictProbability, entry, stopLoss, takeProfits, leverage, tradeType, marketRegime, **analysisCreatedAt**, planId, checklist, followedPlan | what the model knew **at entry** |
| `outcome` | outcome, resolved, outcomeResolvedAt, pnlAmount, pnlPercent, **realizedR**, rMultiple, rSource, maxAdverseExcursion, maxFavorableExcursion, excursionSource, extendedSLZoneBreach | what the market said later |
| `lesson` | mistakeTags, emotionalState, planDeviationNote, rootCauseClass, postMortem | the post-hoc reading |
| `provenance` | modelsUsed, moderator, sourceRunId, promptVersion, promptLane, debateTurnCount | which model, which run |

Plus `incomplete: boolean` and `missing: string[]` (`:216-229`).

**Is it complete? — On the four things asked: yes, with two caveats.**

- **Outcome** — present, and the two PnL units are kept strictly apart (`pnlAmount` = captured
  dollars, `pnlPercent` = leveraged position percent; nothing converts one into the other,
  `:190-206`). `outcomeResolvedAt` travels with it, so "when the result became known" is not
  lost.
- **R** — present, and the *canonical* one: `realizedR` (price-measured) is the headline and
  `rMultiple` (the older leveraged-percent derivation) is kept beside it for history, with
  `rSource` naming the writer (`:199-201`). **But `costR` / `netR` / `slippageModeled` /
  `costUnknown` are absent** — and `types/trade.ts:228-235` says explicitly that "the ledgers
  that grade a strategy should read **this one**" (`netR`). The canonical net-R never leaves
  the machine.
- **Lesson** — present: tags, emotional state, plan deviation, root cause, post-mortem. But
  `postMortemModel` (which model wrote the lesson) is **not** exported, so a corpus cannot
  tell an app-authored lesson from a trader's own note — the distinction the app itself
  insists on (`types/trade.ts:87-97`).
- **Model** — present: `modelsUsed`, the moderator, `sourceRunId`, `promptVersion`,
  `promptLane`.

**Other gaps, fairly stated**

- `benchmark` (the skill-vs-tide alpha) is not exported.
- `slOptimizationData` (`slWasTouched`, `missedWinDueToTightSL`) is not exported.
- `userPriorCall` (the trader's pre-read prior) is not exported — the calibration signal the
  app collects never reaches the corpus.
- `debateTurns` are **counted, not carried** (`:239-241`) — deliberate size discipline, but it
  means the export is not a self-contained corpus: the transcript lives in the thinking store.
- No filter: the export is the whole live array, so there is no "resolved only", no date
  range, no "drop the incomplete rows". (The schema *flags* incompleteness, which is the right
  call, but the trader cannot act on the flag at export time.)
- Entry-time candles are reconstructable rather than stored (`:164-169`) — correct, and
  `decision.symbol` + `decision.analysisCreatedAt` + `decision.entry` are enough to rebuild
  them via `fetchFuturesOHLCVFromTime`.

**The design choices that are genuinely right** (and worth preserving): the three nests stop
the outcome leaking into the input; unresolved and metric-less rows are **included and
flagged** rather than dropped (`:216-229`), which stops the corpus from being biased toward
trades that happened to settle; the units are never merged; a missing R stays `null` instead
of `0`.

**Assessment:** this is the best-engineered part of the section — honest, self-describing,
leak-aware, and it is the one place the harness can feed a training pipeline. It is *not*
complete: it omits the app's own canonical net-R, the benchmark alpha, the trader's prior,
and the post-mortem's author.

---

## 6. Weak spots

### 6.1 The last-20 brief never reaches a model *(highest impact)*

The feature's entire purpose — put recent form in front of the seat — is not happening. The
brief is assembled on every send (`hooks/useAnalysisPipeline.ts:1073`), folded into
`enhancedPrompt` (`:1175`), and every send ships `promptToSend` (`:1258, 1384, 1411`).
`enhancedPrompt` has six occurrences in the repo and no consumer (`grep enhancedPrompt`).
The model therefore learns the trader's recent form **only** if it thinks to call
`get_trade_log` — which no prompt, mandate or catalogue row encourages (the desk mandate
names `recall` at `DeskToolsService.ts:1784` and never `get_trade_log`).

**Cost of leaving it:** the journar's most valuable signal (form, streak, R) is one
model-initiated tool call away from every answer, and the desk's own prompt never points
there.

### 6.2 The repo's own description of the model's journal access is false

`services/learning/MemoryRetrievalService.ts:7-11` — *"Diary is RAW STORAGE — never injected,
deliberately. The model sees the conclusions (doctrine, settled beliefs, skills), never the
journal."* The same file injects journal rows at `:742-750`. A future reader who trusts the
header will build the wrong thing.

### 6.3 The tool's description misstates one field

`DeskToolsService.ts:1389` promises "the ISO time it **was logged**". The code prints
`row.decidedAt` (`utils/recentTradesBrief.ts:136`) — the **decision** time, per the brief's own
field docs (`:33-36`: *"The log time … (provenance)"* / *"The decision time — the clock this
brief orders and shows"*). The Journal card prints the **log** time
(`components/journal/Journal.tsx:350` → `r.loggedAt`).

**Consequence:** a plan decided Monday, confirmed and logged Friday is **Friday** in the
Journal and **Monday** to the model. `decidedAt` exists precisely to stop that
(`types/trade.ts:44-50`), and the two surfaces resolve it in opposite directions.

### 6.4 No disclosure of what the model can read

The Settings catalogue names `get_trade_log` (`DeskToolCatalogue.tsx:41-51`), so the trader is
not wholly in the dark — but there is no field list, no per-tool switch (the allow-lists are
code, `:14-16`), and no journal-side notice. The only prose in the repo about the model's
journal access says the opposite (§6.2).

### 6.5 No import of any kind

A trader with 400 trades in a broker CSV, 200 trade screenshots, or a monthly statement PDF
has **no path in**. The composer's `accept="image/*,.md,.txt,.csv,.json"`
(`ChatComposer.tsx:159`) accepts a CSV and turns it into prompt text — the UI invites a
history file and silently does nothing journal-shaped with it. The PDF machinery
(`pdfTextExtractor`, `pdfOcrService`) is fully built and is wired only to the **strategy
book**. This is the single largest gap in the section: the journal is a write-only-from-
inside-the-app ledger.

### 6.6 The training export omits the app's canonical net-R

`types/trade.ts:228-235` says the strategy ledgers should read `netR`, and the app computes
it (`hooks/useTradeLogging.ts:412-414`). `trainingRecordFor` does not carry it
(`utils/reportExport.ts:190-206`), so the corpus contains the **gross** R only. The same
applies to the benchmark alpha and to `postMortemModel`.

### 6.7 The aggregate and the rows can disagree inside one turn

`get_setup_history_stats` **is** cached (`DeskToolsService.ts:461`) for 30 s;
`get_trade_log` is not (`:450-466` excludes it — deliberately). A seat that asks for the
aggregate and the rows in the same turn can read numbers from two different moments, with
nothing in either result saying so. The cache policy is right for the rows and questionable
for the aggregate.

### 6.8 Dead seats, dead fields, dead records

- `ARBITER_ALLOWED_TOOLS` (`:3341-3357`) — the seat policy that gave the journal to "the seat
  that judges the record" — has **no importers at all**: its two were test files, removed
  with the suite on 2026-10-23, and the moderator itself was deleted.
- `Message.evidencePack` ("what the moderator was actually shown") and
  `Message.memoryRetrieved` ("notebook files retrieved for this run") have **no writer**;
  the Journal's "Retrieved sources" surface and the verdict-audit card are fed by nothing.
- `LoggedTrade.postMortemImages` is rendered by the Journal (`TradeLog.tsx:71`) and written
  by nothing. `settlementReflection.ts:8` still names "a screenshot upload path" as a
  post-mortem writer — that path does not exist.
- `decline_trade` records a skip and states plainly "no journal row exists"
  (`DeskToolsService.ts:3278`), so passes never enter `get_trade_log`, never enter the
  training export, and are visible only through the Journal's separate "Passes" stat
  (`Journal.tsx:305-311`) reading `services/trade/declineLog.ts`.

### 6.9 The coin filter is a prefix match

`utils/recentTradesBrief.ts:104-108` — `symbol.startsWith(coin)`. `"BTC"` matches `BTCUSDT`
(correct) **and** `BTCUSD`, `BTCDOMUSDT` (wrong). A one-line narrowing to an exact base match
would fix it.

### 6.10 The "last 20" in the Journal is a window, not a count

`buildTradeLogBrief(trades)` (`Journal.tsx:324`) takes the most recent 20 **by decision
time** (`recentTradesBrief.ts:121`). A trader who logged 30 trades today and 3 last month
sees today's 20 — the card is honest about the window but its title ("Last 20 logged
trades") reads as "the last 20 things I logged". Same window, same ordering, same builder —
so at least the two surfaces agree.

---

## 7. What is ALREADY GOOD

1. **One store, honestly designed.** One logical journal, two physical backends, and the
   section-diffing write (`SqliteService.ts:593-609`) with an explicit delete-absent pass so a
   deleted trade or an import-over cannot resurrect on the next load. `meta` JSON means new
   fields need no migration (`SqliteService.ts:711-742`).
2. **Units are never merged.** Dollars (`pnlAmount`) and leveraged percent (`pnlPercent`) are
   kept apart everywhere — brief (`recentTradesBrief.ts:126-130`), stats
   (`journalAnalytics.ts:42`), export (`reportExport.ts:195-196`). A $150 win is never read
   as 150R.
3. **A missing fact is a gap, never a zero.** Unmeasured MAE/MFE stay `undefined`
   (`useTradeLogging.ts:401-404`), an unmeasurable R stays absent
   (`outcomeEngine.ts:456-457`), an unreadable regime stays `undefined` and the row names its
   source (`useTradeLogging.ts:276-291, 399`). `slippageModeled: false` is stored so "no
   slippage model" is visible rather than an unlabelled zero (`types/trade.ts:238-243`).
4. **Provenance everywhere.** Who resolved the outcome (`resolutionSource`), who measured the
   R and the excursions (`rSource`, `excursionSource`, first-writer-wins), when the decision
   was made vs. when the row was written (`decidedAt` vs `timestamp` vs
   `outcomeResolvedAt`), which run and which prompt lane (`sourceRunId`, `promptVersion`,
   `promptLane`), and which model wrote the lesson (`postMortemModel`).
5. **The tool is honest about what it does not know.** "No journal row matches that filter.
   That is not evidence of inactivity — only of no match." (`DeskToolsService.ts:3304-3306`).
   The budget comment at `:520-525` names the exact silent-loss failure it prevents, and
   `tests/tradeLogTool.test.ts:90-109` pins that 20 rows arrive whole.
6. **The right read is the wrong read.** `get_trade_log` is deliberately **not** cached, so a
   trade logged during the turn that reads the log is visible (`tests/tradeLogTool.test.ts:115`).
   It is also deliberately **not** a "market read", so it cannot be used to fake the
   "I looked at the tape" check (`DeskToolsService.ts:2408-2424`).
7. **The refusal machinery is transport-agnostic.** The allow-list is enforced in the
   executor, not at offer time, so a text-protocol seat that emits a tag for a forbidden tool
   is refused rather than served (`:2478-2487`).
8. **The analyst/moderator audience split is a good idea and is tested.** An analyst seat
   gets the tape without the framing; the moderator gets the tally
   (`recentTradesBrief.ts:186-210`, `MemoryRetrievalService.ts:730-751`). The rationale —
   "a nudge delivered by the system into every opening prompt is not evidence, it is
   priming" — is written down and pinned (`tests/recentFormInjection.test.ts:37-54`).
9. **The one bounded settlement call is well-guarded.** `settlementReflection.ts` writes
   nothing on a decline, a malformed answer, a transport failure, a missing provider or a
   re-fire; a trader's own note of ≥40 chars always wins; the packet is the row and nothing
   else, with every absent fact printed as absent (`:175-201, 239-327`).
10. **The training export is honest about what it cannot carry.** `incomplete` + `missing[]`
    on every record, three nests so the outcome is never an input, unresolved rows included
    rather than dropped, and the entry-time candles reconstructable instead of megabytes
    embedded (`reportExport.ts:142-244`).
11. **The Journal card and the model read the same builder.** `buildTradeLogBrief` /
    `buildRecentTradesBrief` are one implementation, so the arithmetic cannot drift
    (`Journal.tsx:320-324`; `DeskToolsService.ts:3296-3297`).
12. **The archive is real.** The trade log rides the profile JSON into every backup, and
    import validates and previews the count (`BackupService.ts:116-156, 666-726`).

---

## 8. One-line answers

- **Where a trade lives:** one logical store — SQLite `trades` on native
  (`SqliteService.ts:159-183`), the profile blob in IndexedDB on web (`dbService.ts:227-263`)
  — keyed by `LoggedTrade.id` (= the Message id); backed up inside the profile JSON
  (`BackupService.ts:116-156`); **not** carried by `ExportService` (Preferences only).
- **Is the model's view the same store?** Yes — the same `loggedTrades` array
  (`App.tsx:2582, 2609`) — but a **projection**: ≤50 rows × 7 fields, capped at 4 000 chars,
  and on a different clock (decision time vs. the Journal's log time).
- **Is the last-20 injection real?** No. `recentFormBlock` → `getMemoryFilesContext` →
  `enhancedPrompt` (`MemoryRetrievalService.ts:923-935`, `useAnalysisPipeline.ts:1169-1176`)
  and every send ships `promptToSend` instead (`:1258, 1384, 1411`). It lives only in the
  Journal card (`Journal.tsx:323-380`).
- **What can the trader get IN?** Text, images and PDFs — into a *conversation*. **Nothing**
  can get a trade into the journal except the app's own capture funnel.
