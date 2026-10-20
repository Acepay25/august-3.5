# August Trading — System & Data-Flow Deep Dive

**Audit date:** 2026-10-21
**Commit audited:** `b584d7ee1cbc2360bc1d90098c6a3191b221a1cf` — *"feat(models): E-51 Phase 2 - one model control, in the card, on both homes"*
**Branch:** `main` · **Tree at audit start:** 9 modified files (uncommitted E-51 Phase 2) · **Tree at audit end:** clean
**Method:** read-only. All measurement was done in a throwaway git worktree at the audited commit, with a throwaway `APPDATA`/`LOCALAPPDATA`, one gate at a time, on an otherwise idle machine.

> **The commit moved during the audit.** The session began at `3cf0dbf3` (*"E-51 Phase 1 - the merged model panel, unwired"*) with a dirty tree; `b584d7ee` (E-51 Phase 2) was committed at 00:35:32 while the gates were running, and the tree went clean. Every gate below was **re-run at `b584d7ee`**, and the reachability graph was re-measured there. The Phase 1 → Phase 2 delta touched `App.tsx`, `components/agents/AgentsView.tsx`, `components/shared/ModelChip.tsx`, `components/trade/panels/ChatComposer.tsx`, `scripts/chip-shot.cjs`, `scripts/render-probe.cjs`, two test files, `AGENTS.md` and the flow docs — it did not touch `services/`, `utils/`, `constants/`, `electron/` or `shared/`, so every store, prompt, tool and security finding below is unaffected by the move.

---

## 0. Executive summary

This is a **well-engineered, unusually disciplined codebase** whose weaknesses are now concentrated in one place: **the deterministic layer that is meant to govern the model is not fully wired, and the model's context is dominated by tool schemas rather than by the trader's own evidence.**

Six findings drive everything else:

1. **The tool-schema tax is 15× the mandate.** The dock sends **9,284 tokens of tool schemas** against a **614-token mandate** on every request. The prior audit put this at "~7,864 tokens" — it under-counted, because the 9 chart-action tools live in a *second* definition array (`CHART_ACTION_TOOL_DEFS`) and were measured separately. With `MAX_DESK_TOOL_ROUNDS = 8` and no prompt caching, one 8-round turn re-sends ~**79,176 tokens** of schema+mandate. → **E-30, O-58, O-59.**
2. **The validation gate is still not wired.** `runValidationGate` has **zero production importers** (`services/validation/TradeValidationGate.ts:495`). A 986-line module with 27+ scoring dimensions is dead code. → **O-10.**
3. **Five stores are exported but refused on import.** `ExportService.ts` keeps two allow-lists; five namespaces are on the raw list and absent from the restore list. The repo has already fixed this exact bug once, for `supervisor_last_run_v1`, with a comment explaining why. → **O-99 and its mirror.**
4. **The orphan census in the register is stale.** `O-129` lists 13 orphans; **7 of those files no longer exist** and **6 orphans the register never listed** are now dead. Re-measured: **12 orphans**, of which **9 are genuinely dead**. → **E-50.**
5. **The release gate does not run the bundle ratchet.** `.github/workflows/guards.yml` is a *third* workflow that `AGENTS.md` never mentions; it holds the 1,400 kB bundle ceiling, the probe parse check and the probe lint — and a tag push runs neither `guards.yml` nor those three checks. → **NEW, not in the register.**
6. **There is no cost model anywhere.** No fee, slippage or funding term is ever charged, so every R, win rate, calibration bucket and skill verdict is **gross**. This is upstream of almost every learning-quality claim in the app. → **E-03, O-19.**

**Confirmed good, and worth saying plainly:** the Electron shell is hardened (sandboxed renderer, sender-frame validation on every IPC channel, `frame-src 'none'` CSP, path-traversal-closed `app://` handler); the accessibility work has landed (focus traps, `aria-live` transcript, `aria-hidden` backdrops); the plan object is genuinely single-sourced; the test suite is fast, complete and green; and the prior audit's CSP finding is fixed.

---

## 1. Architecture

### 1.1 Shape of the tree

| | count |
|---|---|
| Tracked files | 1,131 |
| Production source modules (`.ts`/`.tsx`, non-test) | 495 |
| Test files | 499 |
| Service modules | 180 |
| React components | 147 |
| Utility modules | 90 |
| Hooks | 40 |
| Prompt files | 5 |
| Electron / shared `.cjs` | 22 |

### 1.2 Entry points

| Entry | file | role |
|---|---|---|
| Renderer | `index.tsx` (3,211 b) → `App.tsx` (146,715 b) | mounts the shell, owns surface routing |
| Electron main | `electron/main.cjs` | window, `app://` protocol, IPC, updater |
| Preload | `electron/preload.cjs` | the renderer's only privileged surface |
| CLI scripts | `scripts/*.cjs`, `scripts/*.entry.ts` | probes, gates, replay harness |
| Android | `android/` (57 tracked files) | Capacitor shell |

`App.tsx` is ~2,579 lines of application code (the register's `O-105` figure) and holds surface routing, the keyboard map, the composer, and the model-menu wiring. It is the single largest file and the most-cited one.

### 1.3 The four surfaces

Routing is a `surface` string (`App.tsx:1304`): **`trade` → `journal` → `agents` → `learn`**, with `settings` as a menu overlay rather than a surface. All four are wrapped in `React.lazy` + `Suspense` with a `<SurfaceSkeleton />` fallback (`App.tsx:2294, 2452, 2497, 2519, 2543, 2558`) and per-component `fallback={null}` boundaries for overlays.

`O-71` ("lazy surfaces without a skeleton — 20 `fallback={null}`") is **partially closed**: the four *surfaces* now have skeletons. The remaining `fallback={null}` boundaries are the **overlay** boundaries, which is the correct choice for a modal (a skeleton frame behind a dialog is worse than none). The register's 17-count should be re-measured against surface boundaries only.

### 1.4 The `app://` protocol

`electron/main.cjs:954` registers the handler; `:962` decodes the path; `:971` resolves it against the dist root; `:972` computes the relative path and refuses anything that escapes. `registerSchemesAsPrivileged` (`:138`) grants the scheme the standard privileges. **Path traversal is correctly closed.**

---

## 2. The data flow of one turn

### 2.1 The dock turn (the deepest path)

```
ChatComposer → chatTurnRunner (TRADE_TOOLS)
   → chatSurfaceTurn / analysisPipeline
   → services/providers/GenericProviderService  (stream + tool_calls)
   → runDeskToolLoop (MAX_DESK_TOOL_ROUNDS = 8, DESK_TURN_BUDGET_MS = 180_000)
       → executeDeskTool  (allow-list enforced at :2295 and :3747)
   → present_trade → presentTradeTool → buildTradePlan
   → useTradeLogging → journal row
```

### 2.2 The one plan object

`buildTradePlan` (`services/trade/proposedTrade.ts:166`) is the single source for the plan's numbers. Its callers are exactly the surfaces that should share it:

- `components/trade/panels/TradeProposalCard.tsx:43` — the card
- `services/trade/proposalGate.ts:92` — the gate
- `services/trade/presentTradeTool.ts:159` — the executor
- `utils/planReplay.ts:89` — the replay harness

**This is E-19 landed and working.** The card, the gate, the executor and the replay harness cannot disagree about the plan, because they all call the same function.

### 2.3 The deterministic layer, at the one place it runs

`services/trade/presentTradeTool.ts` is the **only** executor that presents a plan to a trader, and it is the one place the deterministic layer is wired:

- `:113` `applyNotebookSkillsToAnalysis(enforcementInput, { username, runId: planId })` — the hard `avoid` veto, the candidate cap, the confidence downgrade
- `:114` `if (enforced.riskVeto || enforced.direction === 'Neutral')` → refuse, and write the falsification ledger
- `:118` `VetoLedgerService.recordVeto({...})`
- `:144` `buildSkillGate(proposal, planId)` — the code-checked predicate ceiling, folded into the one stamp the card shows and the journal records
- `:151` `beginGateScan(...)` — the market gate, started but not awaited (the comment at `:145-149` explains why: awaiting it put a network fetch plus an OHLCV pull per timeframe in front of drawing the plan)

**`O-11`, `O-12` and `O-13` are CLOSED.** The register still records all three as OPEN with "ten test call sites and zero production call sites". At `b584d7ee` each has exactly one production call site, all three in `presentTradeTool.ts`.

### 2.4 The gate that is not wired

`services/validation/TradeValidationGate.ts` — 986 lines, exported `runValidationGate` at `:495`. Its **only** non-test reference in the entire tree is `tests/accuracyValidation.test.ts:3`. Two live comments still describe the module as a future intent (`services/analysis/EntryTimingService.ts:588`, `services/validation/StopLossOptimizerService.ts:332`).

**`O-10` is OPEN.** The module that scores confidence bands, R:R floors, leverage, liquidation distance, expected value and 20+ other dimensions is computed by nothing.

Its R:R is also the **last surviving duplicate** of the formula that `E-02` set out to unify: `TradeValidationGate.ts:183` reads `analysis.takeProfit[0].price` — index 0 — where the live path (`utils/riskReward.ts` → `nearestTargetPrice`) uses the *nearest* target. The live path, the card, the journal and the clamp agree; only the dead gate does not. **This is why `O-01`/`O-02` should be closed as "no longer reachable" rather than "fixed".**

### 2.5 The R:R floor, re-measured

`utils/riskReward.ts` is the canonical owner. Its consumers are `services/trade/proposedTrade.ts:21`, `services/validation/AccuracyValidationService.ts:20`, `services/trade/presentTradeTool.ts:190`, and `services/analysis/ScalpDetectionService.ts:165,241` (whose comments now explicitly say the old index-0 path was removed). `services/backtesting/BacktestingService.ts:939` deliberately does *not* use it — realized R:R is a different question, on purpose, as `AGENTS.md` states.

**`E-02` is landed for every live path.** The remaining duplicate is inside the unwired gate.

### 2.6 Settlement

The autopilot detects the SL/TP touch and stores a resolution; the row itself is written only in `handleConfirmAutopilot`, with `markProcessed` after the click. **This is `O-28`, and it is still OPEN** — with `isAutoCapturing` defaulting off, the click is the only path, and **every learning consumer is starved behind it.** `O-29` (the evidence floors are tuned for a world with no outcomes) is a same-release dependency of it, not a follow-on.

---

## 3. The persisted-store topology

> This section is the condensed form of a full store-by-store inventory (writers, readers, growth, backup registration for every localStorage key, Preferences key, SQLite table, IndexedDB database and on-disk file). The material findings are below; the full table is summarised in **Report D §2**.

### 3.1 The two-list defect

`services/infrastructure/ExportService.ts` keeps **two** allow-lists:

- `RAW_LOCAL_STORAGE_PREFIXES` (`:298-407`) — namespaces whose owners talk to `localStorage` directly
- `RESTORABLE_PREFERENCE_KEY_PREFIXES` (`:728-803`) — what an import will accept

They are **not the same set**, and the mismatch is not symmetric:

| namespace | on RAW | on RESTORE | consequence |
|---|---|---|---|
| `trade_tool_payloads` | ✅ | ❌ | exported, then refused on import |
| `supervisor_triaged_v1` | ✅ | ❌ | exported, then refused on import |
| `learning_distill` | ❌ | ❌ | exported by the Preferences sweep, refused on import |
| `memory_hygiene` | ❌ | ❌ | same |
| `automation_plans` | ❌ | ❌ | same |
| `supervisor_last_run_v1` | ✅ | ✅ | **fixed**, with the reason written down |

`ExportService.ts:759-763` records the fix for `supervisor_last_run_v1` in as many words: *"the export sweep found it in localStorage and wrote it into every backup, then import dropped it as un-allow-listed — a key the app ships and refuses to take back. Harmless data, but it is the same shape of bug as the learning stores above: one list, not two."*

**The fix was applied to one key and not to the five siblings it names.** `O-99` recorded the mirror-image gap (five namespaces restore-listed but not raw-listed) and is still OPEN; this is the other half of the same defect and is **not in the register**.

The one-line fix that closes both halves: a unit test asserting that every prefix on the raw list is also on the restore list and vice versa, failing with the symmetric difference. That test is what would have stopped this class from growing.

### 3.2 Five dead preference keys

Each of these appears **exactly once** in the entire source tree — its own declaration — and has **zero readers and zero writers**:

| key | declared at |
|---|---|
| `MEMORY_PROVIDER` | `services/infrastructure/PreferencesService.ts:24` |
| `HYBRID_PANEL_POSITION` | `services/infrastructure/PreferencesService.ts:28` |
| `QUIET_HOURS` | `services/infrastructure/PreferencesService.ts:37` |
| `INSIGHT_KNOWLEDGE_BASE` | `services/infrastructure/StorageService.ts:19` |
| `AUGUST_APP_SETTINGS` | `services/infrastructure/StorageService.ts:20` |

They are also on the restore list, so an import will *write* keys the app will never read.

### 3.3 An unbounded key-per-item store

`supervisor_triaged_v1_<user>:<itemId>` writes **one localStorage key per triaged item**, with no eviction and no count cap. The WebView origin quota is shared, so this is a slow-motion version of the quota problem the notebook already solves with `utils/memoryBudget.ts`.

### 3.4 Duplicated sources of truth

| concept | homes |
|---|---|
| learning rules | 3 — `learning_rules_v2_<user>`, notebook `rules/`, the live memory file |
| chat sessions | 3 — `chat_sessions_v1`, `trade_chat_sessions_v1_<user>`, the conversation store |
| profile memory | 4 — `profile_memory_v1_<user>`, the notebook, the SQLite row, global memory |
| calibration | 6 stores |
| session identity | 4 mechanisms |
| `casual_chat_model` | written to two engines (`App.tsx:688`, `:689`) |

---

## 4. The model-facing surface

### 4.1 Prompt corpus

`constants/prompts/` totals **21,092 characters** across 5 files:

| file | chars |
|---|---|
| `analysisPrompts.ts` | 8,640 |
| `learningPrompts.ts` | 5,138 |
| `chatPrompts.ts` | 5,083 |
| `harnessContract.ts` | 1,800 |
| `memoryPrompts.ts` | 293 |

The prompt registry (`constants/promptRegistry.ts`) holds **12 entries**, and every one of them is reachable — the anchor gate reports *"unreachable prompt entries (0/12, ceiling 0)"*.

**The registry is in excellent shape and should be read as the model of how to do this.** Every `fallback` is **imported, never restated**, and the header documents exactly why: three restated copies had drifted (`strategy.summarize_pdf` was 366 characters short and dropped the mandatory `Family` line; `notebook.note` and `notebook.chat_note` were each 107 characters short and missing the line forbidding writes into `skills/`). `tests/planE08PromptRegistry.test.ts` pins that identity. **E-08 is landed.**

`chatPrompts.ts` is correctly *not* in the registry — it is the live chat-surface mandate, not a user-editable prompt. The prior audit's `O-17` framing ("only `chatPrompts.ts` is on the live path") was true of the corpus and is still true, but the registry now makes the distinction explicit and correct rather than accidental.

### 4.2 The tool surface — measured

**This is the sharpest number in the report.**

The loop assembles its definitions from **two** arrays (`DeskToolsService.ts:3521-3523` and `:4043-4049`):

- `DESK_TOOL_DEFINITIONS` — 31 tools (`DeskToolsService.ts:871`)
- `CHART_ACTION_TOOL_DEFS` — 9 tools (`DeskToolsService.ts:1494`)

**40 distinct tools.** Measured at `b584d7ee` by importing the real definitions and serialising exactly what the loop sends:

| surface | tools | schema JSON | mandate | **total/request** | schema : mandate |
|---|---|---|---|---|---|
| **Dock** (`TRADE_TOOLS`) | 40 | 37,133 ch ≈ **9,284 tok** | 2,454 ch ≈ 614 tok | **≈ 9,897 tok** | **15.1×** |
| **Chat** (`CHAT_SURFACE_TOOLS`) | 31 | 29,094 ch ≈ 7,274 tok | 2,593 ch ≈ 649 tok | ≈ 7,922 tok | 11.2× |

Largest schemas: `propose_skill` 2,690 ch · `run_monte_carlo` 1,978 ch · `get_indicators` 1,722 ch · `propose_strategy` 1,667 ch · `draw_on_chart` 1,553 ch.

**The prior audit's "~7,864 tokens per request on the dock" (`O-59`) under-counts by ~18%.** It measured the 31-tool array and treated the 9 chart-action tools as a separate figure; the loop sends all 40 in one request. **The correct figure is ~9,284 tokens of schema against a 614-token mandate — the schema is 15.1× the mandate, not 7×.**

With `MAX_DESK_TOOL_ROUNDS = 8` (`DeskToolsService.ts:195`) and no prompt caching (`O-58`), a full 8-round dock turn re-sends **≈ 79,176 tokens** of schema+mandate.

Surface scoping is correct and by design:
- **dock-only (9):** `get_chart_view`, `scan_chart_skills`, `draw_on_chart`, `draw_detected`, `mark_trade_levels`, `clear_chart_drawings`, `watch_price`, `wake_me`, `cancel_watch` — 7,751 chars ≈ 1,938 tokens
- **chat-only:** none
- **shared:** 31

The chart-action tools are dock-only because the Chat surface has **no canvas, no live mark and no level-watch to arm**. The comment at `DeskToolsService.ts:4036-4042` states the rule precisely: *"an offered tool the executor would have to refuse is the dead-affordance bug moved one layer down into the prompt, where no test can see it."* **The prior audit's "chart tools are dock-only" claim is confirmed, and it is correct design, not a gap.**

`AUTOMATION_TOOLS` (`services/trade/automationTurn.ts:61`) is `CHAT_SURFACE_TOOLS` minus `AUTOMATION_UNATTENDED_DENY` — an unattended run may not, for instance, present a plan the trader is not watching.

`ARBITER_ALLOWED_TOOLS` (`DeskToolsService.ts:3145`) is a narrow 9-tool read-mostly set plus `forge_tool` and `amend_memory`.

### 4.3 Hard caps on the loop

| cap | value | where |
|---|---|---|
| tool rounds | 8 | `DeskToolsService.ts:195` |
| turn budget | 180,000 ms | `:207` |
| wrap-up at | 80 % of budget | `:208` |
| per-tool timeout | 20,000 ms | `:219` |
| per-round max tokens | 8,192 | `:240` |
| tool result cap | 2,400 chars | `:478` |
| read page | 2,000 chars | `:367` |
| desk tool cache TTL | 30,000 ms | `:362` |

`clearDeskToolCache()` is exported at `:468` and called at the single choke point every run passes — `streamChatWithDeskTools` — exactly as `AGENTS.md` describes. `tests/deskToolCache.test.ts` pins that wiring by source.

### 4.4 The harness contract

`constants/prompts/harnessContract.ts` is 1,800 characters. `utils/harnessMarks.ts` owns the vocabulary (`DATA_UNAVAILABLE`, the clipping notes, the spill receipt, the fence legend) and `harnessTurn()` marks a harness-authored insertion that must travel in the `user` role.

**`O-61` is OPEN** — the contract is the only text that defines `HARNESS_TURN_MARK`, and the desk does not receive it. The mark is used in the `user` role on every desk turn and explained nowhere on that path.

---

## 5. Reliability and data loss

### 5.1 The write-size asymmetry (the one genuine data-loss path)

`O-96` — the export side is byte-bounded (3,500,000) but the **write** side is not. `trade_chat_sessions_v1` bounds 12 × 60 entries and `MAX_IMAGE_CHARS` = 1,200,000, but nothing bounds what a *write* may carry. This remains the only genuine data-loss path in the app, and it is unchanged.

### 5.2 The three byte-cap risks

`O-97` — `trade_session_drawings_v1` keeps every coin; `desk_tools_forged_v1` and `trading_checklist_v1` have no count cap. Unchanged.

### 5.3 The notebook write rule — honoured

`AGENTS.md` says: *"Never add a swallow-and-continue around a notebook write; surface it, like `memoryHealth` does."* Verified:

- `services/learning/MemoryFilesService.ts:580` — `getNotebookWriteFailure()`, the only place that knows a notebook write never reached disk
- `services/learning/memoryHealth.ts:303` — the Health tab reads it
- `hooks/analysisPipeline/notebookQuickSave.ts:83-90` — the catch **surfaces** the failure into the transcript (`"📓 **Notebook write failed** — …"`) rather than swallowing it

**The rule is being followed.** A catch-block heuristic flags this site, and reading it proves the opposite.

### 5.4 Error handling shape

520 `console.*` calls and 84 `setInterval`/`setTimeout` sites in production source. The densest timer files: `hooks/useFuturesLiveFeed.ts` (5), `services/analysis/MarketDataService.ts` (5), `components/market/LiveMarket.tsx` (4), `hooks/useMarketData.ts` (4), `services/providers/GenericProviderService.ts` (4).

One deliberate swallow worth naming: `presentTradeTool.ts:128` — `void VetoLedgerService.recordVeto({...}).catch(() => { /* ledger is best-effort; the refusal stands */ })`. The refusal has already returned, so the trade is still refused; but **if the ledger write fails, the veto is not recorded and the trader never learns that a rule fired.** Low severity, worth a console warn.

### 5.5 The `O-115` inversion

The ensemble weighting scores a provider with one loss at **0.0 %** — the same as a provider with no trades at all — then sorts descending and tells the arbiter to favour the top one. A single loss can brand a model as the worst performer; a single lucky win the best. Unchanged, and it is cheap to fix.

---

## 6. Security and privacy

**This area is in good shape, and the prior audit's headline finding is fixed.**

### 6.1 The CSP — `O-21` / `E-21` is CLOSED

`index.html:26-27`:

```
default-src 'self' app:; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:;
connect-src 'self' app: https: wss: ws: blob: data:;
worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'
```

The prior audit recorded "three unused remote TradingView origins in `script-src`/`frame-src`/`img-src`". **There are none left.** `frame-src` is `'none'`, and the comment at `index.html:23-24` records the reasoning: *"It used to name TradingView's hosts; that permission had no iframe behind it."* The app runs its own WebSocket + REST transport instead of the TradingView embed (`TradingChart.tsx`, `LiveMarket.tsx`), so no remote script host is needed — and adding one "would hand that script the preload bridge".

One consequence worth stating: `connect-src` must carry bare `https:` because providers are runtime-configured to any OpenAI-compatible host, so the CSP **cannot** narrow it. The narrowing lives in `shared/providerRequestPolicy.cjs` (the one wire policy, imported by renderer, Vite dev proxy *and* Electron main — `electron/main.cjs:13`), with the host allowlist applied in the main process at `electron/main.cjs:201-210, 259`.

### 6.2 The Electron shell

`electron/main.cjs:1013-1021`:

```js
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  webSecurity: true,
  sandbox: true,
  preload: path.join(__dirname, 'preload.cjs')
}
```

- **Every** `ipcMain.handle` goes through the `trustedHandle` wrapper (`:186-189`), which refuses any frame that is not the app window. `update:quit-now` uses the same guard (`:1259-1261`).
- `setWindowOpenHandler` (`:1063-1068`) opens only `https://` externally and denies everything else — no `file:`, no `javascript:`, no arbitrary scheme.
- `will-navigate` (`:1069-1071`) allows only `http://localhost:` in dev and `app://` in production.
- Permissions are denied wholesale.

### 6.3 Secrets

`safeStorage` is used with an `enc:v1:` payload prefix (`electron/main.cjs:1326-1342`), with a graceful `null` return when `isEncryptionAvailable()` is false. The renderer never holds a key in plaintext on desktop; web/Capacitor keep plaintext, which `PRIVACY.md` must reflect.

### 6.4 What leaves the machine

Provider endpoints (runtime-configured, host-policy-checked), market-data endpoints and WebSocket price feeds, and the Electron update feed. The `app://` protocol is local. `O-89`'s sibling concern — an analytics or crash-reporting service — **does not exist**: there is no telemetry sink in the tree.

---

## 7. Performance

### 7.1 Bundle composition (measured from the production build at `b584d7ee`)

| chunk | size |
|---|---|
| `index` (entry) | **1,368 KiB** (vite reports 1,400.82 kB decimal) |
| `MarkdownRenderer` | 427 KiB |
| `StrategiesTab` | 338 KiB |
| `AreaChart` | 297 KiB |
| `vendor-react` | 188 KiB |
| `Journal` | 170 KiB |
| `SymbolPicker` | 102 KiB |

The guard in `.github/workflows/guards.yml` divides bytes by 1,024 and labels the result "kB". The ceiling is 1,400 and the measurement is 1,368 — **32 KiB of headroom, 2.3 %.** Two consequences:

1. The label is wrong: the gate computes **KiB** and calls it kB. The true ceiling in vite's units is ~1,434 kB, i.e. ~34 kB more slack than the label suggests. Low severity, but it is a gate that does not measure what it says.
2. 2.3 % of headroom is thin for a project whose own plan flags eager imports as a recurring regression.

### 7.2 The gates that matter

| gate | CI | release | guards |
|---|---|---|---|
| `typecheck` | ✅ | via `build` | — |
| `test:coverage` | ✅ | ✅ | — |
| `lint` | ✅ | ✅ | — |
| `typecheck:scripts` | ✅ | ✅ | — |
| `typecheck:electron` | ✅ | ✅ | — |
| `check-flow-doc-anchors` | ✅ | ❌ | — |
| `skill-approval-probe` | ✅ | ❌ | — |
| `build` | ✅ | ✅ | ✅ |
| `e2e` | ✅ | ✅ | — |
| `boot-probe` | ✅ | ✅ | — |
| `render-probe` | ✅ | ✅ | — |
| `installer-smoke` | ❌ | ✅ | — |
| **bundle-size ratchet (1,400 kB)** | ❌ | ❌ | ✅ |
| **probe `node --check`** | ❌ | ❌ | ✅ |
| **probe script lint** | ❌ | ❌ | ✅ |

### 7.3 The finding: a third workflow that gates nothing

`.github/workflows/guards.yml` triggers on `push: branches: [main]` and `pull_request`. `release.yml` triggers on `push: tags: v*` and `workflow_dispatch`.

**A tag push therefore runs neither `guards.yml` nor its three checks.** `release.yml` duplicates nine gates on purpose — its own header says *"release.yml can be dispatched manually (workflow_dispatch) without ever having passed CI, and publishing to every updater is irreversible"* — but the bundle-size ceiling, the probe parse check and the probe script lint are **not** among the duplicated nine.

So the release path can publish a bundle that exceeds the 1,400 kB ceiling, and the ceiling itself is the gate that exists precisely to catch eager-import regressions. `AGENTS.md` documents the ci-vs-release asymmetry in detail, and its own set-difference command compares only two of the three workflows:

```
comm -13 <(grep -ohE "npm run [a-z0-9:._-]+" .github/workflows/release.yml | sort -u) \
         <(grep -ohE "npm run [a-z0-9:._-]+" .github/workflows/ci.yml | sort -u)
```

**`guards.yml` is not mentioned anywhere in `AGENTS.md`.** This is a documentation gap *and* a release-path gap, and it is **not in the register**. `O-107` records the release's missing `check-flow-doc-anchors` and `skill-approval-probe` — real, and owner-accepted — but the bundle ratchet is a different animal: it is a **numeric ceiling on the artifact users download**, and it has never gated a release.

**The fix is small:** add the bundle-ratchet step to `release.yml` (it is three lines of `stat` + a comparison) and name the third workflow in `AGENTS.md`.

---

## 8. UX and accessibility

### 8.1 The measured census

| attribute | count |
|---|---|
| `aria-label` | 263 |
| `role=` | 97 |
| `aria-expanded` | 26 |
| `aria-modal` | 21 |
| `tabIndex` | 14 |
| `htmlFor` | 8 |
| `aria-live` | 6 |
| `aria-describedby` | **1** |

The app does the hard parts: every overlay backdrop carries `aria-hidden` (verified at `ModelMenu.tsx:343`, `ChatComposer.tsx:171`, `TimeframeBar.tsx:95,140`), the menus carry `role="menu"` with `role="menuitem"` children, the transcript has an `aria-live` region, and dialogs have focus traps and focus restore.

**`O-65`** (no `aria-live` near the streaming transcript) is **CLOSED** — 6 `aria-live` regions exist and the transcript is one of them. **`O-66`** (seven of eighteen dialogs without a focus trap) is **CLOSED** — `tests/useFocusTrap.test.tsx` now covers the dialog population, and the register itself records that the worst case (`AutomationEditorModal.tsx:291`) was fixed.

### 8.2 The two false positives worth recording

A naive sweep for `<div onClick>` and `<img>` without `alt` returns 18 and 2 hits respectively. **Every one is a false positive:**
- the `onClick` divs are all `aria-hidden` backdrops that close an overlay — not interactive controls;
- both `<img>` elements (`ImageViewerModal.tsx:56`, `ImagePreview.tsx:22`) carry `alt` on the following line.

**`O-67`** (composite roles advertising keyboard contracts they do not have) and **`O-68`** (four pickers unusable without sight) remain the live a11y items. `O-68` is partly answered by the Phase 2 commit: the composer's `ModelChip` and the Settings/seat `ModelPicker` were two implementations of one thing reading different preferences, and Phase 2 replaced the composer side with the single `ModelMenu` panel.

### 8.3 Density

`O-83` — 57 % of type at 11–13 px, ~520 white-alpha borders, 71 stock overlay shadows — is unchanged, and it is the register's own "the one place the app is not calm".

---

## 9. The quality gates, as they actually stand

All measured at `b584d7ee` in the throwaway worktree:

| gate | result |
|---|---|
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run typecheck:scripts` | **PASS** |
| `npm run typecheck:electron` | **PASS** (`node --check` on all three `.cjs`) |
| `npm run lint` | **PASS** — 657 warnings / 0 errors against a cap of **659** (2 slots of headroom) |
| `npm run test` | **PASS** — 495 files, **5,042 tests**, 0 skipped, 229 s |
| `npm run check-flow-doc-anchors` | **PASS** — 304 anchors, 0 unattributed, ceiling 0 |
| `npm run build` | **PASS** — entry 1,368 KiB |

The census in `AGENTS.md` — *"5042 tests in 495 files"* — **matches the tree exactly.** The anchor gate reports *"0 AGENTS.md claim(s) disagree with the tree"*.

The lint ratchet is the tightest thing here: **657 of 659**. The remaining 657 warnings are **436 `no-explicit-any`** and **220 `no-unused-vars`**, spread over 170 files. `GenericProviderService.ts` alone carries 54.

---

## 10. Confirmed good

Worth stating plainly, because an audit that only lists problems misrepresents the codebase:

- **The plan object is genuinely single-sourced** (`E-19`) — card, gate, executor and replay all call `buildTradePlan`.
- **The deterministic skill layer IS wired** at the one executor (`E-35`) — `O-11`, `O-12`, `O-13` are closed.
- **The prompt registry cannot drift** (`E-08`) — every fallback is imported, and a test pins the identity.
- **The Electron shell is hardened** — sandboxed renderer, `contextIsolation`, sender-frame validation on every IPC channel, `frame-src 'none'`, closed path traversal, `safeStorage` with a graceful fallback.
- **The CSP finding is fixed** (`E-21`) with the reasoning recorded next to the fix.
- **Accessibility foundations are in place** — focus traps, `aria-live` transcript, `aria-hidden` backdrops, real menu roles.
- **The tool surface is correctly scoped per surface**, with the "dead affordance" rule written down where the code is.
- **The gates are real** — 5,042 tests, 0 skipped, and a flow-doc anchor gate that re-measures its own census.
- **`AGENTS.md` is unusually accurate** — its counts match the tree, and its notes about load-bearing idioms (the ref-during-render rule, the `skillEnabledFlag` rule, the notebook-write rule) are all still true of the code.

---

## 11. What I could not verify

Stated plainly, because an audit that hides its edges is worse than one that draws them.

| claim I could not check | why | what it needs |
|---|---|---|
| Rendered row counts, inert controls, zero pageerrors | `render-probe` needs a browser and a free machine; the suite was running | run `npm run render-probe` on an idle box |
| The packaged installer path | `installer-smoke` needs a signed Windows build | `npm run installer-smoke` |
| The native restore path with an image-bearing session | `O-112` — the native path is untested by construction | a packaged run of Settings → Data restore |
| Real end-to-end provider behaviour | no API key is configured here | a live provider run |
| The live-journal row count | `O-49` — needs the packaged app's `app://` IndexedDB | a packaged run |
| The `app://` protocol under a hostile URL | verified by code reading, not by a live attack | a fuzz pass against the handler |
| Bundle size on the **release** build | the build I measured is the local Vite build, not the packaged Electron artifact | the `guards.yml` ratchet on a tag |
| Per-store byte sizes on a real profile | the audit ran against a throwaway profile with no trades | a populated profile |

---

*Next: **Report B** (enhancements, ranked) → **Report C** (new features, ranked) → **Report D** (cleanup manifest + docs audit).*
