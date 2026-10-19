# Report 1 — How August Trading actually works today

**Pinned commit:** `6a41a9f7e3b3986236c3000862d326f1e95dfad1` (branch `main`)
**Date:** 2026-10-19
**Part A of the brief** — architecture, persisted stores, prompts, trading logic, tool surface,
security, reliability, performance, UX, quality gates.

Labelling: **[Verified live]** = measured; **[Verified by code reading]** = `file:line`;
**[Unverified — needs X]** = what would settle it. See `2026-10-19-00-index-and-method.md` §0.6.

---

## 1. Architecture map

### 1.1 Entry points

| entry | file | what it does |
|---|---|---|
| Browser / WebView root | `index.html` | owns the `#splash` element, loads `/index.tsx` |
| Renderer mount | `index.tsx` (92 lines) | mounts `<App/>` under `ErrorBoundary` → `ToastProvider` → `React.StrictMode` (`index.tsx:71-80`) |
| Application root | `App.tsx` (2,499 lines) | the whole shell: surface router, 41 hooks, the chat composer, the settings surface |
| Electron main | `electron/main.cjs` (1,362 lines) | `app://` protocol handler, provider egress, `safeStorage`, auto-updater, window state |
| Electron preload | `electron/preload.cjs` (52 lines) | the **only** privileged surface: one `contextBridge.exposeInMainWorld('electronAPI', …)` |
| Electron SSE parser | `electron/sseParser.cjs` | the provider stream parser, shared by main |
| Shared wire policy | `shared/providerRequestPolicy.cjs` (466 lines) | the ONE request policy, imported by the renderer, the Vite dev proxy **and** the Electron main |
| Capacitor config | `capacitor.config.ts` | `appId com.august35.tradingapp`, `webDir dist`, https scheme, cleartext off |
| Android host | `android/` (57 tracked files) | **no application source** — the Capacitor Gradle host plus one custom plugin |
| E2E | `e2e/smoke.spec.ts` | one Playwright spec |
| Operational | `scripts/` (18 files) | probes, gates, release helpers — not app code |

**[Verified by code reading]** `android/app/src/main/java/com/august35/tradingapp/` contains only
`MainActivity.java` and `GallerySaverPlugin.java`; all application logic is the shared renderer.

### 1.2 Process boundaries

```
╔═ ELECTRON MAIN (electron/main.cjs) ══════════════════════════════════════════════╗
║ app:// protocol handler  :912                                              ║
║ provider:chat (net.fetch, safe-redirect policy)  :1240                     ║
║ crypto:encrypt / crypto:decrypt (safeStorage)  :1279 / :1289              ║
║ update:check / :download / :install / :quit-now / :get-status  :1149-1217  ║
║ userData/window-state.json  :88, :92, :125                                  ║
║ legacy "August 3.5" → "August Trading" migration  :49-79                    ║
║ shared/providerRequestPolicy.cjs  ← the ONE wire policy                      ║
╚════════╤═════════════════════╤═════════════════════╤═════════════════════════╝
         │ app:// (renderer)   │ ipcRenderer.invoke  │ ipcRenderer.on
╔════════╧═════════════════════╧═════════════════════╧═════════════════════════╗
║ PRELOAD electron/preload.cjs — exposeInMainWorld('electronAPI')            ║
║ 15 methods: getVersion, isElectron, platform, checkForUpdates,             ║
║ downloadUpdate, installUpdate, quitNow(send), getUpdateStatus,             ║
║ encryptSecret, decryptSecret, providerChat, cancelProviderChat,             ║
║ discoverModels, onProviderChunk, onUpdateStatus                             ║
╚════════╤═════════════════════╧═════════════════════════╧═════════════════════╝
         │
╔════════╧═════════════════════════════════════════════════════════════════════╗
║ RENDERER — index.tsx → App.tsx (2,499)                                       ║
║  41 hooks  ·  184 services  ·  1 React context (ToastContext)              ║
║  module singletons: chatStore · MemoryFilesService · GlobalLearningService  ║
║                     OutcomeAutopilotService · SqliteService.db              ║
║  WEB WORKER: services/analysis/monteCarlo.worker.ts (59 lines)             ║
║  PERSISTENCE — 5 backends: localStorage │ Capacitor Preferences │ IndexedDB  ║
║               │ Capacitor SQLite │ Capacitor Filesystem                    ║
╚════════╤═════════════════════════════════════════════════════════════════════╝
         │  the SAME renderer code, different storage backends
╔════════╧═════════════════════════════════════════════════════════════════════╗
║ ANDROID WEBVIEW (Capacitor host, https scheme, cleartext disabled)          ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**The consequential boundary is the Capacitor one, not the Electron one.** On desktop, localStorage
and Capacitor Preferences are the same store. On Android they are **two different places** (the
WebView origin vs SharedPreferences/UserDefaults), and that single fact is the mechanical cause of
the whole "mobile backup loses data" class of bugs in §2.6.

**[Verified live]** `grep createContext` across the whole repository returns **one** hit
(`components/shared/Toast.tsx:30`). There is no redux, no zustand, no jotai, no recoil.

### 1.3 The IPC surface — complete

**[Verified by code reading]** `electron/preload.cjs` + `electron/main.cjs`:

| # | preload method (file:line) | channel | main handler (file:line) | what it can do |
|---|---|---|---|---|
| 1 | `getVersion` `preload:11` | `app:get-version` | `main:1219` | read the app version |
| 2 | `isElectron` `preload:12` | — | — | (local constant) |
| 3 | `platform` `preload:13` | — | — | (local constant) |
| 4 | `checkForUpdates` `preload:16` | `update:check` | `main:1149` | network to the update feed |
| 5 | `downloadUpdate` `preload:17` | `update:download` | `main:1161` | writes into `userData/pending` |
| 6 | `installUpdate` `preload:18` | `update:install` | `main:1173` | **relaunches the app** |
| 7 | `quitNow` `preload:21` (**`send`**, fire-and-forget) | `update:quit-now` | `main:1213` (`ipcMain.on`) | quits |
| 8 | `getUpdateStatus` `preload:22` | `update:get-status` | `main:1217` | read status |
| 9 | `encryptSecret` `preload:26` | `crypto:encrypt` | `main:1279` | `safeStorage.encryptString` |
| 10 | `decryptSecret` `preload:27` | `crypto:decrypt` | `main:1289` | `safeStorage.decryptString` |
| 11 | `providerChat` `preload:31` | `provider:chat` | `main:1240` | **the provider request, from the main process** |
| 12 | `cancelProviderChat` `preload:32` | `provider:cancel` | `main:1263` | aborts an in-flight request |
| 13 | `discoverModels` `preload:33` | `provider:discover` | `main:1221` | fetches the model list from a provider |
| 14 | `onProviderChunk` `preload:39-43` | `provider:chunk` (main → renderer) | main stream path | streamed deltas |
| 15 | `onUpdateStatus` `preload:46-51` | `update-status` (main → renderer) | `main:1082` | update progress |

Totals: **11 `ipcMain.handle` + 1 `ipcMain.on` + 1 `contextBridge` + 12 `ipcRenderer.invoke` +
1 `ipcRenderer.send` + 2 `ipcRenderer.on`.**

**There is no filesystem, no SQLite and no Node bridge in the renderer.** The renderer cannot read
a file. Secrets are encrypted *in the main process* and the plaintext is decrypted back into the
renderer on demand — which is the correct shape, but it does mean the plaintext key exists in the
renderer while a request is in flight (see §6.2).

**There is a third provider transport that is not IPC:** the Vite dev proxy.
`GenericProviderService.ts:1306` → `vite.config.ts:73` (`/__provider_proxy`). It exists so the
browser can reach a provider that does not send CORS headers. In production on desktop the
Electron bridge is used; on web the raw `fetch` path is used.

### 1.4 State: where the canonical truth lives

| kind | where | notes |
|---|---|---|
| React context | `components/shared/Toast.tsx:30` (`ToastContext`) | **the only one** |
| Module singletons | `chatStore` (`services/trade/chatStore.ts:210/216`), `AnalystLensService._lensConfigCache` (`:140`), `GlobalLearningService` (`:135`), `OutcomeAutopilotService` (`:673`), `MemoryFilesService` (`:31/250/460`), `proposalGate` in-flight map (`:85`), `SqliteService.db`, `dbService.dbPromise` | the real state layer of this app |
| Private module caches | `DeskToolsService` tool cache (30 s TTL, `TOOL_CACHE_TTL_MS` at `DeskToolsService.ts:311`) | the only import surface is `clearDeskToolCache()`, called at the top of every tool turn inside `streamChatWithDeskTools` (`DeskToolsService.ts:3772`) — verified |
| Component state | `App.tsx` and 148 components | |
| **Persisted** | SQLite/IndexedDB (profile, trades, conversations, thinking) + Preferences/localStorage (settings) + the notebook blob (skills/rules/notes) | §2 |

**There is no generic AI-response cache.** `AGENTS.md` says so, and the code agrees: the only
caches in the request path are the 30 s desk-tool cache and the provider-health cooldown.

### 1.5 Services and hooks inventory

**[Verified live]** `services/` = 184 files, `hooks/` = 41 files.

| domain | files | notable |
|---|---|---|
| `services/learning/` | 66 | the notebook, skills, retrieval, evidence, hygiene, reviews |
| `services/trade/` | 29 | the chat turn runner, the proposal gate, the journal write path |
| `services/analysis/` | 23 | desk tools, TA, market data, Monte Carlo, hybrid packet |
| `services/infrastructure/` | 20 | SQLite, Preferences, backups, export, provider config |
| `services/validation/` | 10 | the gate, calibration, session guard |
| `services/agents/` | 8 | roster, mailbox, routines, group rounds, seat personas |
| `services/ui/` | 8 | outcome autopilot, lens, auto-capture, alerts, veto ledger |
| `services/providers/` | 6 | the one provider client, analysis, reasoning controls |
| `services/backtesting/` | 6 | backtest, model performance, live backtest, outcome engine, scenario sim, stop optimiser |
| `services/automation/` | 3 | cron, the service, the catch-up planner |
| `services/bots/` | 3 | registry, per-bot memory, memory budget |
| `services/tools/` | 1 | `toolForge` (user/model-authored HTTPS tools) |
| `services/desk/` | **1** | `idleMotion.ts` (70 lines) — a per-user "reduce motion" boolean. `AGENTS.md` is right that the 2D desk floor and its seat layout are gone and no market data lives here. |

**`services/research/` does not exist at the pin** — `git ls-tree -d --name-only HEAD services/`
returns 13 directories and `research` is not among them. `AGENTS.md`'s project-structure tree
lists `services/research/  # Fixed 4-stage web research plan`. **That line is stale.** (Report 4,
docs audit, `AGENTS.md`.)

**Four of the 41 "hooks" are not hooks.** `hooks/analysisPipeline/{memoryContext, notebookQuickSave,
runOutcome, streamThrottlers}.ts` call no React primitive — they are plain modules in a `hooks/`
directory. Harmless, but it inflates the "41 hooks" figure and it is where `memoryContext.ts` —
a 160-line retrieval assembler — hides.

### 1.6 The actual request-sending function

**`sendChatRequest(config, messages, options)` — `services/providers/GenericProviderService.ts:1237`.**

It is the **only** place a provider request is issued. Structure:

```
sendChatRequest                     GenericProviderService.ts:1237
 └─ withRetry(…, 3)                            :1251-1392   (retry + backoff)
 └─ transport selection
    ├─ Electron:  electronAPI.providerChat     :1273  → IPC provider:chat → main.cjs:1240
    │                                              → net.fetch via policy.fetchFollowingSafeRedirects (main.cjs:230)
    ├─ Vite proxy: fetch('/__provider_proxy')   :1306  (dev only)
    └─ direct fetch by apiFormat                :1374-1387
       ├─ chatCompletionsCall  :736  → fetch :888
       ├─ messagesCall         :833  → fetch :888
       ├─ responsesCall        :947  → fetch :961
       └─ googleCall          :1016  → fetch :1063
```

Streaming entry point: **`sendChatTurn` — `GenericProviderService.ts:1407`**; desktop streams over
the bridge (`streamViaElectronBridge` `:1628`, chunk subscription `:1644`, invoke `:1663`), web
fetches directly (`:1474`), the dev proxy streams (`:1900`).

**One policy, three transports.** `shared/providerRequestPolicy.cjs` owns the thinking gates, the
temperature and the provider-URL host policy, and is imported by the renderer, the Vite dev proxy
*and* the Electron main — which is why the renderer and the main process cannot drift on what a
legal request looks like. `tests/sharedPolicyEsmExports.test.ts` pins the renderer's import
surface against the shared module.

### 1.7 The full data flow, end to end

```
TRADER PRESSES SEND
 └─ App.tsx → hooks/useAnalysisPipeline.ts:477  handleSendMessage
    │
    ├─ [A] AUTOMATION BRANCH            :1176
    │     └─ runAutomationTurn           services/trade/automationTurn.ts:161
    │           └─ automationSeatFor     :94   (picks the seat model)
    │           └─ tool turn (same desk tools as the chat surface)
    │
    ├─ [B] BOT 1:1 BRANCH               :1316
    │     └─ streamQuickResponse        services/providers/GenericAnalysisService.ts:613
    │
    └─ [C] THE DESK (the live chat path) :1347
          └─ runChatSurfaceTurn         services/trade/chatSurfaceTurn.ts:230
                ├─ chatSurfaceSystemPrompt   :147  → surfacePromptWith :105
                │     └─ [mandate + skills index (30) + active strategies + profile-memory index]
                └─ runToolTurn            services/trade/toolTurn.ts:109
                      └─ streamChatWithDeskTools   services/analysis/DeskToolsService.ts:3754
                            └─ clearDeskToolCache()      :3772
                            └─ GenericProviderService.streamChatTurn :1407
                                  └─ sendChatRequest :1237 → fetch / IPC
```

**The tool branch — how a plan is actually born:**

```
MODEL CALLS present_trade
 └─ runPresentTrade                    services/trade/presentTradeTool.ts:75
     ├─ parseTradeProposal             services/trade/proposedTrade.ts:72   [MODEL input, D parsing]
     ├─ computeRrRatio                 proposedTrade.ts:60
     │    └─ utils/riskReward.plannedRiskReward   utils/riskReward.ts:48  [D — nearest target]
     ├─ mintPlanId                     proposedTrade.ts:67                   [D]
     ├─ beginGateScan  (NOT awaited)   services/trade/proposalGate.ts:88     [D]
     │    └─ GateKeeperService.runProgrammaticGate    :70  → {pass, confidenceCap, warnings}
     ├─ drawingsFromLevelTool          services/trade/chartDrawings.ts:370
     └─ sink.armPlan                   services/trade/levelWatchService.ts:217
 └─ sink.setProposal  → the "Log this trade" card
```

**The journal branch — the one write path:**

```
TRADER PRESSES "LOG THIS TRADE"
 └─ ensureStamp                        services/trade/proposalGate.ts:122
 └─ logTradeWithFeedback               hooks/useTradeLogging.ts:270        ← THE ONE PATH
     ├─ withDetectedTradeType          :305
     ├─ computeRMultiple               :362
     ├─ chatStore.addOpenTrade         :413
     ├─ syncClosedTradeToNotebook      services/learning/SkillMemoryService.ts:3288
     ├─ updateThinkingOutcome          :458
     ├─ GlobalLearningService.updateCalibration   :484
     ├─ trackConfluenceOutcome         :511
     ├─ autoLearnFromOutcome           :141
     └─ autoAddRecentInsight           :210
```

**The resolution branch:**

```
services/backtesting/outcomeEngine.ts:107  scanTradeOutcome
 └─ entry trigger → SL-first same-candle rule → 150 % zone → TP1 (scale out, stop → breakeven)
    → TP2/TP3 → later breakeven → OPEN
```

**Persistence:** `services/infrastructure/dbService.ts` (web / IndexedDB) and
`SqliteService.ts` (native / Capacitor SQLite) — tables `users`, `trades`, `conversations`,
`trade_summaries`, `saved_analyses`, `thinking_records`, `schema_migrations`.

### 1.8 Prompt layering

`utils/composePrompt.ts:36` is the **only** compositor. It puts the harness contract first and
strips any nested copy of that contract from the parts it composes (`stripHarnessContract`,
`composePrompt.ts:17`) — so a contract cannot appear twice in one request.

`constants/promptRegistry.ts` (236 lines) is the **user-overridable** registry, surfaced by
`components/settings/PromptManager.tsx`.

**The layers, in the order they reach the wire:**

| layer | source | note |
|---|---|---|
| harness contract | `constants/prompts/harnessContract.ts` | always first; names the `HARNESS_TURN_MARK` by interpolation so the sentence cannot drift from the bytes |
| surface mandate | `constants/prompts/chatPrompts.ts` (`CHAT_SURFACE_SYSTEM_PROMPT`) | the desk's role |
| skills index | `utils/tradeChatContext.buildSkillsIndexForPrompt` | up to 30 rows: slug, status, kind, description, if/then |
| active strategies | `services/learning/strategyStore.activeStrategiesBlock` | |
| profile memory index | `services/learning/profileMemory.buildProfileMemoryIndex` | |
| tool schemas | `services/analysis/DeskToolsService` | the desk tools |
| history | the conversation, trimmed per surface | the desk re-sends its last ten; the Chat surface passes the whole conversation |
| the trader's turn | `promptToSend` | `useAnalysisPipeline.ts:779` |

**And one layer that is assembled and never sent** — see §7.3, finding **F-01**.

---

## 2. Persisted stores — the full inventory

### 2.1 Method

A static scan script (written outside the repository) resolved the first argument of every
`localStorage.{getItem,setItem,removeItem}` call through the file's own constants, through
`PREF_KEYS.X`, and through one-level template builders, then compared the result against
`ExportService.RAW_LOCAL_STORAGE_PREFIXES` and the restore allow-lists.

**[Verified live]** 159 `localStorage` call sites; 61 distinct key shapes. The scan's known limits:
it cannot follow a key whose namespace is a runtime parameter
(`services/agents/agentRoster.ts:100` builds `agents_${ns}_v1_${user}`), and it does not resolve
constants across modules beyond `PREF_KEYS`. 21 of the 159 call sites resolved to `*`; the five
that mattered were hand-resolved and are marked in the table.

### 2.2 The localStorage key space

| group | keys | owner | in backup? |
|---|---|---|---|
| **Notebook** | `memory_files_v1_<user>` — the whole notebook (skills, rules, doctrine, diary, notes) as **one JSON blob of `.md` entries** | `services/learning/MemoryFilesService.ts:250` (prefix `:31`) | **yes** — first RESTORE prefix (`ExportService.ts:685`); deliberately **uncapped** (`EXPORT_RAW_KEY_CAP_BYTES` scoped away, `:398-402`); up to 2 MB, the largest key in the app |
| **Learning** | `learning_rules_v2_<user>`, `profile_memory_v1_<user>`, `memory_injections_v1_<user>`, `global_learning_state_<user>`, `rl_signals_data`, `session_review_{counter_v1,drafted_v1,open_theses_v1,resolver_v1}:<user>`, `trader_learning_v1:<user>`, `trader_learner_counter_v1:<user>`, `supervisor_{auto_v1,last_run_v1}_<user>`, `supervisor_triaged_v1_<user>:<id>`, `memory_amendments_v1`, `august_harness_lessons_v1`, `approvals_grandfathered_v1_<user>`, `book_drafts_seeded_v1`, `skill_drafts_v1[:<user>]` + `_rejected:` + `_gate_attempts:`, `learning_proposals_v1:<user>`, `attributed_insights_kb` | `StorageService.ts:137`, `profileMemory.ts:80`, `MemoryInjectionService.ts:87`, `GlobalLearningService.ts:148/162`, `ReinforcementSignalService.ts:121`, `sessionSkillReview.ts:97-361`, `traderLearner.ts:43-55`, `supervisorStore.ts:192`, `skillSupervisor.ts:317-606`, `memoryAmendments.ts:75`, `harnessLessons.ts:80`, `approvalMigration.ts:80`, `bookSkillDrafts.ts:185`, `skillDrafts.ts:54-244`, `learningQueue.ts:123` | all registered (RAW `:300-318`, `:320`, `:342-348`, `:386`, `:390`) |
| **Agent / bot** | `bots_v1_<user>` (**Preferences**, `services/bots/BotRegistry.ts:37`), `agents_bots_v1_<user>`, `agents_groups_v1_<user>` (`services/agents/agentRoster.ts:100` — the prefix is a runtime parameter), `agent_threads_opened_v1_<user>` (`utils/agentThreads.ts:323`), `agent_pins_v1_<user>` (`components/agents/AgentsView.tsx:580`) | see left | `bots_v1_` RESTORE `:740`; `agents_*` RAW `:302-303`; `agent_threads_opened_v1` RESTORE-only `:743`; `agent_pins_v1` **no** (exempt) |
| **Trading surface** | `trade_chat_sessions_v1_<user>` (`services/trade/chatSessions.ts:427`), `trade_chat_active_v1_<user>` (`services/trade/chatStore.ts:161`), `trade_tool_payloads_v1_<user>` (`services/trade/toolPayloadStore.ts:98`), `trade_watches_v1_<user>` (`services/trade/watchService.ts:61`), `trade_level_arms_v1_<user>` (`services/trade/levelWatchService.ts:140`), `trade_level_hits_v1_<user>` (`:167`), `trade_drawings_v1_<user>_<sym>` (`services/trade/chartDrawings.ts:121`), `trade_session_drawings_v1_<user>_<sess>` (`:187`), `trade_session_model_v1` (`:210`), `trade_tf_bar_v1_<user>` (`components/trade/TradingChart.tsx:112`), `trading_checklist_v1` (`utils/checklist.ts:51`) | see left | RAW `:362-366`, `:372`, `:377`, `:379-380`; caps: chat 512 KB, tool payloads 256 KB, session drawings 1 MB, checklist 64 KB (`:418-427`); an over-cap key is **omitted with a notice, never truncated** (`:536-542`) |
| **UI furniture** | `nav_rail_width_v1` (`App.tsx:659`), `right_panel_width_v1_<surface>` (`hooks/useRightPanel.ts:115`), `trade_sidebar_open_v1` (`App.tsx:475`), `august_surface_v1` (`hooks/useSurface.ts:29`), `august_trade_mode_v1_<user>` (`components/trade/TradeView.tsx:238`), `learn_tab_v1` (`components/learn/LearnView.tsx:150`), `august_update_notes_seen_v1` (`components/shared/UpdateOverlay.tsx:107`), `august_model_picker_free_only_v1` (`utils/providerUtils.ts:277`), `skills_grid_pins_v1` (`components/dashboards/StrategyStudio.tsx:285`), `desk_idle_motion_v1_<user>` (`services/desk/idleMotion.ts:34`) | see left | RAW: `nav_rail_width_v1` `:325`, `right_panel_width_v1` `:331`. **RESTORE-only, not RAW**: `trade_sidebar_open_v1` `:737`, `desk_idle_motion_v1` `:745`. **Not backed up**: `august_surface_v1` (a plain string, `:669-673`), `august_trade_mode_v1`, `learn_tab_v1`, `august_update_notes_seen_v1`, `august_model_picker_free_only_v1`, `agent_pins_v1`, `skills_grid_pins_v1` (the exempt table) |
| **Preferences (`PREF_KEYS`, 24)** | `provider_configs_v1`, `memory_provider`, `analyst_lens_config`, `ensemble_model_selection`, `last_moderator_pick_v1`, `custom_ensemble_prompt`, `custom_lens_prompts`, `casual_chat_model`, `hybrid_panel_position`, `model_performance_data`, `rolling_window_data`, `confidence_calibration`, `confluence_historical_stats`, `attributed_insights_kb`, `outcome_autopilot_state`, `quiet_hours_v1`, `bots_v1`, `last_trade_count`, `last_session`, `data_version`, `data_integrity_log`, `lastCrashError`, `lastPromiseError`, `lastGlobalError`, `sqlite_migrated` | `services/infrastructure/PreferencesService.ts:19-58` | exported by the `PREF_KEYS` loop (`ExportService.ts:600-609`); **API keys are redacted on export** and grafted on import only when the endpoint is identical (`mergeProviderConfigsForImport` `:802-881`) |
| **Dual-written (Preferences + raw)** | `analyst_lens_config` (`services/ui/AnalystLensService.ts:171` + `:181`), `ensemble_model_selection` (`:256` + `:264`), `last_moderator_pick_v1` (`:247` + `:249`), `casual_chat_model` (`App.tsx:715` + `:716`) | see left | **not a loss** — both copies are current and a boot sync re-mirrors Preferences → localStorage. Verified clean. |
| **Telemetry** | `thinking_leak_bin_v1` (`utils/thinkingLeakBin.ts:39`), `lastPromiseError` (`index.tsx:36`), `lastGlobalError` (`index.tsx:55`), `lastCrashError` (`components/shared/ErrorBoundary.tsx:46`), `last_active_user` (`hooks/useUserProfileLoader.ts:501`, `services/learning/PatternMemorySynthesisService.ts:677`) | see left | `thinking_leak_bin_v1` RESTORE exact `:679` only; `last_active_user` RESTORE `:750` only; the three breadcrumbs are `PREF_KEYS` |
| **Gates (auto-apply policy)** | `approval_rules_v1:<user>` (`utils/approvalInbox.ts:46`), legacy unscoped `approval_rules_v1` (read-only, `:30`) | `utils/approvalInbox.ts` | **neither list** — see finding **F-04** |

### 2.3 The other four backends

**IndexedDB (5 databases).**

| database | version / store | owner | notes |
|---|---|---|---|
| `FuturesAI-DB` | v1 / `userProfiles` (keyPath `username`) | `services/infrastructure/dbService.ts:63-66` | on web it holds users + trades + conversations + summaries |
| `AugustBackups` | v1 / `backups` (keyPath `id`, indexes `username`, `timestamp`) | `services/infrastructure/BackupService.ts:57-67` | **web only**; on native the same backup goes to the Filesystem plugin |
| `ThinkingStore` | `ThinkingStoreService.ts:36-39` (keyPath `id`) | the reasoning corpus | deliberately **not** inside `UserProfile`, hence the separate `.thinking.json` sidecar |
| `OfflineQueue` | `services/infrastructure/OfflineQueueService.ts:61-76` | queued sends while offline |
| `MessageImages` | v1, keyPath `key` (`services/infrastructure/messageImageStore.ts:116-120`) | pasted screenshots |

**Capacitor Preferences** — one abstraction, `services/infrastructure/PreferencesService.ts`:
native → `@capacitor/preferences` (`:70/:81/:93/:154/:166`); **web → localStorage** (`:72/:84/:95`,
`Object.keys` `:157`, `.clear()` `:168`).

**Files on disk.**

| what | where | owner |
|---|---|---|
| `window-state.json` | Electron `userData` | `electron/main.cjs:88` (written `:125`, read `:92`) |
| `.migrated-to-august-trading` stamp | Electron `userData` | `main.cjs:64-75` (packaged builds only, `main.cjs:59`) |
| `AugustBackups/<user>_<id>.{json,meta.json,prefs.json,thinking.json}` | `Directory.Documents` | `services/infrastructure/BackupService.ts:169-192` |
| global learning state | `Directory.Data` | `services/learning/GlobalLearningService.ts:148` |
| exports | `Directory.Cache` → `Directory.ExternalStorage` | `services/infrastructure/ExportService.ts:67-70`, `:117-120` |

**There is no JSONL store anywhere in the app.** And — worth stating because it surprises people —
**the skill `.md` files are not files.** They are entries inside the single `memory_files_v1_<user>`
JSON blob (`MemoryFilesService.ts:31`, the name is built at `:673`, and a name collision dedupes to
`-2.md` at `:1364`).

**SQLite (native only)** — `services/infrastructure/SqliteService.ts`: tables `users` (`:142-155`),
`trades` (`:158-178`), `conversations` (`:186-194`), `trade_summaries` (`:200-206`),
`saved_analyses` (`:212-220`), `thinking_records` (`:230-252`), `schema_migrations` (`:265-270`),
plus 12 indexes. Migrations v2 `:311-315`, v3 `:318-323`, v4 `:326-331`, v5 `:336-343`,
v6 `:348-353`, v7 `:358-363` — **all seven are additive** (`ADD COLUMN` / `CREATE INDEX`); there is
no `DROP` and no destructive backfill. `runMigrations` records a version **only if every statement
applied** (`:296-308`) — an earlier unconditional record was a real bug and is fixed.

**Electron `userData`** — `window-state.json` plus Chromium's own `Cache/`, `GPUCache/`,
`Code Cache/`, `Local Storage/`, `IndexedDB/`, `Session Storage/`, `Network/`, `Service Worker/`,
`blob_storage/`, `Partitions/`, plus `electron-updater`'s `pending/` and `app-<version>/`.
**[Unverified — needs a live `userData` listing]** the Chromium and updater parts come from the
documented layout, not from measurement.

### 2.4 Retention and rollup

| store | rollup | cap |
|---|---|---|
| the notebook | `utils/memoryBudget.ts` — soft / trigger / hard byte caps; **pressure REFUSES growth, it never evicts** (new files refused at the trigger tier, all model notes refused at the hard cap, `MemoryFilesService.ts:1310`, gate `notebookPressureAllows` `:443`) | see `memoryBudget.ts` |
| skills | `services/learning/skillIdleLifecycle.ts` — the only clock that decides a skill stops being injected: 90 days idle ⇒ suspend (`enabled: false` + `meta.suspendedAt`); 180 days ⇒ archive + an `idle` graveyard tombstone | 90 d / 180 d |
| graveyard | `services/learning/skillGraveyard.ts` — retention only, it revives nothing | weekly sweep |
| chat sessions | `hooks/useConversationHousekeeping.ts` | — |
| tool payloads | `services/trade/toolPayloadStore.ts` | 256 KB |
| session drawings | `services/trade/chartDrawings.ts` | 1 MB |
| trade chat sessions | `services/trade/chatSessions.ts` | 512 KB |
| checklist | `utils/checklist.ts` | 64 KB |
| injection records | `services/learning/MemoryInjectionService.ts` | — |
| backup files | `services/infrastructure/BackupService.ts` | — |

**[Verified by code reading]** The design choice — *refuse growth rather than evict* — is stated
in `AGENTS.md` and honoured: `utils/memoryBudget.ts` is the one classifier for which tier applies,
and nothing in that store is safe to evict without first proving which bytes are regenerable.

### 2.5 Backup / export / import registration

**[Verified live]** `RAW_LOCAL_STORAGE_PREFIXES` (`services/infrastructure/ExportService.ts:299-391`)
has **38 entries**. The repository's own gate is a **source scan**, not a list check:
`tests/exportRawLocalStorage.test.ts` (423 lines, CI-wired) fails when a new `localStorage.*Item`
write site lands in neither the RAW list nor the restore allow-list. That is a genuinely good
mechanism — it is the only reason the paragraph above the list can stay true as stores are added.

**Verification of the list itself:** all 38 prefixes resolve to a real call site. Five had no
resolvable site in the static scan and all five were hand-verified **correct**:
`learning_rules_v2` → `StorageService.ts:137`; `agents_bots_v1` / `agents_groups_v1` →
`agentRoster.ts:100` (runtime-parameter prefix; the test judges that file by whether it declares
an allow-listed namespace, `:336-339`); `trader_learner_counter_v1` → `traderLearner.ts:55`;
`trade_session_drawings_v1` → `chartDrawings.ts:187`. **No prefix on the list is spurious.**

The CI backlog is pinned at 8 entries with `>5` and `<17` bounds (`:403-404`), so it can only
shrink. `supervisor_auto_v1` is registered because its default is **on**
(`supervisorStore.ts:84`) — a restore that missed it would silently re-enable an LLM pass the user
switched off (`ExportService.ts:280-281`).

### 2.6 The store defects

| ID | sev | finding |
|---|---|---|
| **F-02** | **Med** | **Three stores are on the RESTORE list but not the RAW list, and their owner reads `localStorage` directly — so on native they are neither exported nor restored.** `readSweptValue` (`ExportService.ts:497-505`) falls through to `getPreferenceObject` for a non-RAW key; on native the Preferences copy was never written, so the value is `null` and the key is **not exported**. On restore, `setPreferenceObject` writes Preferences and `mirrorToLocalStorage` returns early because `isRawLocalStorageKey` is false (`:511`) — **the owner never sees it.** Affected: `desk_idle_motion_v1_<user>` (`services/desk/idleMotion.ts:34` writes, `:26` reads; RESTORE `:745`), `thinking_leak_bin_v1` (`utils/thinkingLeakBin.ts:39`/`:12`; RESTORE `:679`), `trade_sidebar_open_v1` (`App.tsx:475`/`:454`; RESTORE `:737`). |
| **F-03** | **Med** | **`agent_threads_opened_v1_<user>`** has the same shape (write `utils/agentThreads.ts:323`, read `:313`; RESTORE `:743`; not RAW). **[Unverified — needs a native round-trip]** whether the file-scoped `ownerUsesPreferences` heuristic lets it escape CI (see F-06). |
| **F-04** | **Med-High** | **`approval_rules_v1:<user>` is on neither list.** Written `utils/approvalInbox.ts:46`, read `:29`/`:38`/`:51`. On **web** the sweep exports it (localStorage *is* the Preferences fallback) but the import **skips** it (`isRestorablePreferenceKey` `:758-760`); on **native** it is neither exported nor restored. This store **gates every auto-apply** — the per-coin "always journal" vs "ask" policy. The repository already knows: `tests/exportRawLocalStorage.test.ts:97` — *"NOT backed up: the inbox rules gate every auto-apply — worth a decision"*. **The decision was never taken.** |
| **F-05** | Med | **`bots_v1_<user>` restore depends on `last_active_user`**, which is itself restore-listed-but-not-raw (`:750`, not in RAW) — so on native the roster can be restored under the wrong user key. `BotRegistry.botKey()` reads `last_active_user` from **raw** localStorage (`services/bots/BotRegistry.ts:15`). **[Unverified — needs a native round-trip]** the observed outcome. |
| **F-06** | Low | **The CI gate's `ownerUsesPreferences` check is file-scoped**, so a file that touches Preferences *anywhere* is exempt for *every* key it owns — which is exactly how `trade_sidebar_open_v1` escapes F-02. A **key-scoped** check would close it. |
| **F-07** | Info | **`approval_rules_v1` (the legacy unscoped key) is read but never written** (`utils/approvalInbox.ts:30` reads; `:46` writes only the scoped key) **and is never deleted** — a legacy value can shadow the scoped one indefinitely. |
| **F-08** | Info | **No SQLite migration can lose data.** All seven are additive, and the version is recorded only on full success (`:296-308`). The genuinely risky migration is the **one-time** `migrateLocalStorageToPreferences` sweep (`services/infrastructure/PreferencesService.ts:226-241`), which copies **every** localStorage key into Preferences and thereby creates a **stale second copy** of every raw-owned key. `readSweptValue` prefers the raw store for RAW-listed keys precisely to undo this (`ExportService.ts:482-506`). **This sweep is the mechanical cause of F-02, F-03, F-04 and F-05.** |
| **F-09** | Info | **No write-only store in the localStorage/Preferences layer** — every resolved key shape with a writer has a matching reader. The closest is `lastCrashError` (write-and-clear only, `components/shared/ErrorBoundary.tsx:46`/`:68`). |

### 2.7 The one write-only *capability* in the app

`formatHarnessNotesBlock` — `services/learning/harnessLessons.ts:184` — is exported and has **no
caller anywhere**, in source or in tests. Its own doc comment says *"Harness-lesson read path for
the moderator"*, and the moderator died with the debate engine.

**The store itself is not dead.** The harness-lessons store reaches the wire by a different route:
`registerWireRoutePins` → `isRoutePinned` (`services/providers/reasoningControls.ts:193-206`), which
makes a recorded wire lesson outrank name-based route detection. So the precise finding is:
**the prompt-injection reader is orphaned; the store is live for a different reason.** The
`docs/learning-loop-map.md:114` row claims "Closed? yes — `formatHarnessNotesBlock` → `ensembleService.ts`"
and is wrong on both the reader and the file (`ensembleService.ts` does not exist; the file is
`services/ui/EnsembleAnalystService.ts`). See Report 4, docs audit.

---

## 3. The prompt inventory

### 3.1 Method and a caveat about "size"

**Sizes below are runtime-measured**, not estimated: the repository's own
`node_modules/esbuild` transpiles a TS module to a temporary `.cjs` **outside** the repository,
Node 24 `require`s it with browser and `@capacitor/*` stubs, and the exported string's `.length` is
read. Token figures are `chars / 4` and are labelled as estimates.

### 3.2 The four live model-call paths

| # | path | system prompt actually sent | tools |
|---|---|---|---|
| **P1** | **Chat surface** (and the app's "Full analysis" button) — `services/trade/chatSurfaceTurn.ts:230` | `CHAT_SURFACE_SYSTEM_PROMPT` (1,480) + skills index + strategies + profile-memory index + `DESK_TOOLS_PROMPT` (2,446) [+ a text fallback 221] [+ "FULL ANALYSIS REQUESTED" ~320] | `CHAT_SURFACE_TOOLS` (31) |
| **P2** | **Chart AI dock** (solo + panel) — `services/trade/chatTurnRunner.ts` | `TRADE_CHAT_SYSTEM_PROMPT` (4,299) + skills + strategies + memory + agent notes (≤1,800) + persona + `DESK_TOOLS_PROMPT` (2,446) | `TRADE_TOOLS` (39) |
| **P3** | **Automation** (cron) — `services/trade/automationTurn.ts:161` | `AUTOMATION_SYSTEM_PROMPT` (2,313) + skills + strategies + memory + "LOOK IT UP" + `DESK_TOOLS_PROMPT` (2,446) | `AUTOMATION_TOOLS` (31) |
| **P4** | **Bot turns** (thread / DM / room / routine) | `buildBotSystemPrompt` (`services/agents/botMailbox.ts:167`) = `system.md` + `memory.md` + teammate protocol; else `CASUAL_CHAT_SYSTEM_PROMPT` (355) | **none — deliberately** |
| **P5** | **Skill A/B evaluation** — `services/learning/SkillEvalScheduler.ts:284` | **the only place `composePrompt` runs**: contract 1,582 + master 4,636 + memory 236 + risk 243 + output 368 + desk tools 2,446 | all 31 core, no allow-list |

**None of P1, P2 or P3 honours a `getPrompt()` override** — none of them uses a registry id.
**P5 is the only path that does.**

### 3.3 The full prompt inventory

| # | prompt / surface | file:line | chars | ≈tok | read by | registered? | user-editable? | note |
|---|---|---|---|---|---|---|---|---|
| 1 | `HARNESS_CONTRACT_PROMPT` | `constants/prompts/harnessContract.ts:7` | 1,582 | 396 | **P5 only** | ✗ | ✗ | clause 5 defines `HARNESS_TURN_MARK`; **never reaches P1/P2/P3** |
| 2 | `ANALYST_PERSONA_PROMPT` | `constants/prompts/analysisPrompts.ts:11` | 1,950 | 488 | **P5 only** | ✗ | ✗ | |
| 3 | `MASTER_ANALYSIS_PROMPT` | `constants/prompts/analysisPrompts.ts:67` | 4,636 | 1,159 | **P5 only** | ✓ `analysis.master` | ✓ | registry ≡ call site (byte-identical) |
| 4 | `LENS_MODE_BASE_PROMPT` | `constants/prompts/analysisPrompts.ts:108` | 2,854 | 714 | **nobody** | ✓ `analysis.lens` | ✓ → **no effect** | **DEAD — see F-10** |
| 5 | `COMPACT_ANALYSIS_PROMPT` | `constants/prompts/analysisPrompts.ts:127` | 2,524 | 631 | P5, small-CTX model only | ✓ `analysis.compact` | ✓ | |
| 6 | `RISK_MANAGEMENT_RULES` | `constants/prompts/analysisPrompts.ts:48` | 243 | 61 | **P5 only** | ✓ `analysis.risk_rules` | ✓ | "R:R < 1.2 is Avoid" |
| 7 | `AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT` | `constants/prompts/memoryPrompts.ts:1` | 236 | 59 | **P5 only** | ✓ `analysis.memory_enforcement` | ✓ | |
| 8 | `CASUAL_CHAT_SYSTEM_PROMPT` | `constants/prompts/chatPrompts.ts:24` | 355 | 89 | P4 without a persona | ✗ | ✗ | |
| 9 | `CHAT_SURFACE_SYSTEM_PROMPT` | `constants/prompts/chatPrompts.ts:40` | 1,480 | 370 | P1 | ✗ | ✗ | |
| 10 | `AUTOMATION_SYSTEM_PROMPT` | `constants/prompts/chatPrompts.ts:61` | 2,313 | 578 | P3 | ✗ | ✗ | contains a **false** claim (C-3) |
| 11 | `TRADE_CHAT_SYSTEM_PROMPT` | `services/trade/tradeChatContext.ts:166` | 4,299 | 1,075 | P2 | ✗ | ✗ | the largest shipped prompt |
| 12 | `DESK_TOOLS_PROMPT` | `services/analysis/DeskToolsService.ts:1594` | 2,446 | 612 | **P1+P2+P3** | ✗ | ✗ | names tools some surfaces lack (C-2) |
| 13 | `TEXT_TOOL_FALLBACK_PROMPT` | `services/analysis/DeskToolsService.ts:3130` | 221 | 55 | P1/P2/P3 (non-`chat_completions` only) | ✗ | ✗ | |
| 14 | `GENERAL_ANALYST_DEFAULT_PROMPT` | `services/agents/seatPersonas.ts:28` | 719 | 180 | team seats, bots | ✗ | ✗ | survives the in-flight change |
| 15 | `GENERAL_DIMENSION_MANDATES` + `generalSeatMandate` | `services/agents/seatPersonas.ts:42`, `:62` | 459 + ~180 | ~160 | team seats | ✗ | ✗ | **being removed in the in-flight tree** |
| 16 | `LENS_SWING_PROMPTS` (3) | `constants/prompts/lensRolePrompts.ts:16` | 4,926 | 1,232 | live at the pin via `AnalystLensService.ts:46,54,62` | ✗ | ✗ | **orphaned the moment the in-flight change lands** |
| 17 | `LENS_SCALP_PROMPTS` (3) | `constants/prompts/lensRolePrompts.ts:73` | 3,309 | 827 | **no production caller** | ✗ | ✗ | **DEAD** |
| 18 | `LENS_POSITION_PROMPTS` (3) | `constants/prompts/lensRolePrompts.ts:111` | 3,245 | 811 | **no production caller** | ✗ | ✗ | **DEAD** |
| 19 | `DESK_RULES` (the shared tail of the nine lens prompts) | `constants/prompts/lensRolePrompts.ts:8` | ~900 (static) | ~225 | via #16 | ✗ | ✗ | |
| 20 | `INVALIDATION_THESIS_PROMPT` | `constants/prompts/analysisPrompts.ts:140` | 1,059 | 265 | `services/analysis/HybridIntelligenceService.ts:1289` | ✗ | ✗ | |
| 21 | `CORRELATION_AWARENESS_PROMPT` | `constants/prompts/analysisPrompts.ts:163` | 945 | 236 | `services/analysis/HybridIntelligenceService.ts:1287` | ✗ | ✗ | |
| 22 | `ENTRY_NOT_HIT_ANALYSIS_PROMPT` | `constants/prompts/learningPrompts.ts:7` | 572 | 143 | **nobody** | ✗ | ✗ | **DEAD** |
| 23 | `ENTRY_NOT_HIT_ANALYSIS_QUESTIONS` | `constants/prompts/learningPrompts.ts:17` | 1,710 | 428 | **nobody** | ✗ | ✗ | **DEAD** |
| 24 | `EXTENDED_SL_ZONE_DEBATE_CONTEXT` | `constants/prompts/learningPrompts.ts:64` | 2,180 | 545 | **nobody** | ✗ | ✗ | **DEAD** |
| 25 | `SKILL_CRAFT_FALLBACK` | `services/learning/SkillCraftService.ts:11` | 4,008 | 1,002 | skill draft | ✓ `learning.skill_craft` | ✓ | registry ≡ call site |
| 26 | `SKILL_REFINE_FALLBACK` | `services/learning/SkillCraftService.ts:171` | 2,310 | 578 | skill refine | ✗ — `learning.skill_refine` is **not a registry id** | ✗ | |
| 27 | `SKILL_WORTH_FALLBACK` | `services/learning/skillWorthGate.ts:29` | 1,597 | 399 | worth gate | ✗ — `learning.skill_worth` is **not a registry id** | ✗ | |
| 28 | `CHART_SCAN_FALLBACK_PROMPT` | `services/learning/chartScanSkills.ts:79` | 2,233 | 558 | chart scan | ✓ `learning.chart_scan` | ✓ | registry ≡ call site |
| 29 | `NOTEBOOK_NOTE_FALLBACK` | `services/learning/NotebookWriterService.ts:23` | 1,718 | 430 | notebook writer | ✓ `notebook.note` | ✓ | **registry copy is 107 chars short — DRIFTED** |
| 30 | `CHAT_NOTE_FALLBACK` | `services/learning/NotebookWriterService.ts:47` | 1,557 | 389 | chat quick-save | ✓ `notebook.chat_note` | ✓ | **registry copy is 107 chars short — DRIFTED** |
| 31 | `DEFAULT_SUMMARIZE_PROMPT` | `services/learning/strategySummarizer.ts:24` | 1,358 | 340 | PDF upload | ✓ `strategy.summarize_pdf` | ✓ | **registry copy is 992 — a different, older prompt** |
| 32 | `DEFAULT_OCR_PAGE_PROMPT` | `services/learning/pdfOcrService.ts:20` | 329 | 82 | PDF OCR | ✓ `strategy.ocr_page` | ✓ | registry ≡ call site |
| 33 | `SUPERVISOR_SYSTEM` | `services/learning/skillSupervisor.ts:101` | 605 | 151 | the skill supervisor | ✗ | ✗ | |
| 34 | `buildBotSystemPrompt` | `services/agents/botMailbox.ts:167` | persona + notes (≤1,800) + ~700 | ~2,500 | P4 | ✗ | per-bot `system.md` | budget `services/bots/botMemoryBudget.ts:15,23` |
| 35 | `outputContract` | `services/providers/GenericAnalysisService.ts:354` | 368 | 92 | P5 | ✗ | ✗ | |
| 36 | `marketDataOverride` | `services/providers/GenericAnalysisService.ts:306` | 459 | 115 | P5 | ✗ | ✗ | |
| 37 | `visionDeepDive` | `services/providers/GenericAnalysisService.ts:332` | ~700 (static) | ~175 | P5 | ✗ | ✗ | |
| 38 | doctrine-consolidation prompt | `services/learning/DoctrineConsolidationService.ts` (builder ~2,555 source chars) | ~1,600 (static) | ~400 | the doctrine rewriter | ✗ | ✗ | sent as a **user** message, `:181` |
| 39 | `aiTrendlineSystem` | `services/analysis/AITrendlineService.ts:231` | 86 | 22 | AI trendline | ✗ | ✗ | |
| 40 | "FULL ANALYSIS REQUESTED…" | `services/trade/chatSurfaceTurn.ts:315` | ~320 | 80 | P1 only | ✗ | ✗ | |
| 41 | "LOOK IT UP…" | `services/trade/automationTurn.ts:247` | ~230 | 58 | P3 | ✗ | ✗ | |

**Dead-prompt total: 13,870 chars ≈ 3,468 tokens** (#4 2,854 + #17 3,309 + #18 3,245 + #22 572 +
#23 1,710 + #24 2,180). **Shipped but never reaching a trader-facing model: 7,639 chars**
(#3, #5, #6, #7 — skill-eval only).

### 3.4 The prompt registry — 11 entries, and the defect in the *other* direction

**[Verified live]** 11 of 11 registry ids have a `getPrompt()` consumer
(`UNREACHABLE_CEILING = 0`, pinned by `tests/promptsAreWired.test.ts`).

**But the reverse defect exists**, and it is the one that bites: two call sites use ids that are
**not** registry entries — `learning.skill_refine`
(`services/learning/SkillCraftService.ts:228`) and `learning.skill_worth`
(`services/learning/skillWorthGate.ts:112`). **The Settings prompt editor cannot reach them.**

| id | call site | registry chars | call-site chars | identical? | reaches a model? |
|---|---|---|---|---|---|
| `analysis.master` | `GenericAnalysisService.ts:364` | 4,636 | 4,636 | ✅ | skill-eval only |
| `analysis.lens` | `:363` | 2,854 | 2,854 | ✅ | **NEVER** |
| `analysis.compact` | `:409` | 2,524 | 2,524 | ✅ | skill-eval only |
| `analysis.risk_rules` | `:376` | 243 | 243 | ✅ | skill-eval only |
| `analysis.memory_enforcement` | `:371` | 236 | 236 | ✅ | skill-eval only |
| `strategy.summarize_pdf` | `strategySummarizer.ts:66` | **992** | **1,358** | ❌ **DRIFTED** | live |
| `notebook.note` | `NotebookWriterService.ts:132` | **1,611** | **1,718** | ❌ **DRIFTED** | live |
| `notebook.chat_note` | `NotebookWriterService.ts:81` | **1,450** | **1,557** | ❌ **DRIFTED** | live |
| `strategy.ocr_page` | `pdfOcrService.ts:40` | 329 | 329 | ✅ | live |
| `learning.skill_craft` | `SkillCraftService.ts:155` | 4,008 | 4,008 | ✅ | live |
| `learning.chart_scan` | `chartScanSkills.ts:294` | 2,233 | 2,233 | ✅ | live |

**The drifted copies are live and user-reachable, and "Reset to default" installs the stale one:**

- **`notebook.note` / `notebook.chat_note`** — the registry copies are **107 characters short**: they
  lack *"Never write to skills/ — the harness creates skills only after a cluster of similar trades
  has evidence."* (divergence at chars 889 / 813). "Reset to default" therefore installs an override
  that **removes the prohibition on writing into `skills/`**.
- **`strategy.summarize_pdf`** — the registry copy (992) is an **older, non-template** prompt. The
  real default (1,358) demands `**Strategy: <name>**` plus
  `Family/Signals/Invalidation/Exits/Filters/Horizon/Sizing`, and "Family is mandatory — pick the
  closest of the eight". Resetting installs the old shape, so strategy files parse with **no
  `strategyFamily`** (`services/learning/strategyStore.ts:90` `parseStrategyMarkdown`) — and the
  strategy×regime matrix and the skill attribution both read that field. **Live, user-reachable,
  silent.**

### 3.6 Six contradictions between prompts on the *same* surface

| id | contradiction | where |
|---|---|---|
| **C-1** | `DESK_TOOLS_PROMPT`: *"Naming `draw_on_chart` or `mark_trade_levels` is how a level becomes something the trader can see"* **vs** `CHAT_SURFACE_SYSTEM_PROMPT`: *"Drawing, marking levels and arming a price watch are not offered here and you must not claim to have done them."* — **both in the Chat surface's system message** | `DeskToolsService.ts:1600` vs `chatPrompts.ts:44` |
| **C-2** | `DESK_TOOLS_PROMPT` requires `get_chart_view` before naming a shape — but `get_chart_view` is **not** in `CHAT_SURFACE_TOOLS` or `AUTOMATION_TOOLS`. The seat is told to call a tool its allow-list refuses. | `DeskToolsService.ts:1600` vs `chatSurfaceTurn.ts:55-76` |
| **C-3** | `AUTOMATION_SYSTEM_PROMPT`: *"forged tools are not offered here"* — **FALSE.** `AUTOMATION_UNATTENDED_DENY` cannot name dynamic `custom_*` ids, and `streamChatWithDeskTools:3821-3830` **adds every confirmed forged tool to the allowed list** whenever the caller supplies `executePanelTool` (the automation does, `automationTurn.ts:202`). **A cron can call a forged POST — a write on a third-party endpoint.** | `chatPrompts.ts:67` vs `automationTurn.ts:55-63` + `DeskToolsService.ts:3821-3830` |
| **C-4** | `ANALYST_PERSONA_PROMPT` forbids "this is not financial advice"; `TRADE_CHAT_SYSTEM_PROMPT` ends *"Analysis, not financial advice"* | `analysisPrompts.ts:22-24` vs `tradeChatContext.ts:178` |
| **C-5** | `HARNESS_CONTRACT_PROMPT` clause 5: an **unmarked** user-role turn "IS the trader's own words". The dock prepends harness-authored packet / on-screen / plans / drawings / file text to the trader's turn **without** `harnessTurn()`. | `harnessContract.ts:18` vs `chatTurnRunner.ts:873-881` |
| **C-6** | `RISK_MANAGEMENT_RULES` says "R:R < 1.2 is Avoid"; P1/P2/P3 have **no** R:R floor and no confidence ladder (the ladder lives in the contract they never receive). | `analysisPrompts.ts:51` |

### 3.7 Hardcoded claims vs deterministic enforcement

| prompt claim | enforcement |
|---|---|
| "Avoid means Neutral — never emit Long/Short with Avoid" (`analysisPrompts.ts:25-27`) | **ENFORCED on the structured path only** — `schemas/tradeAnalysis.ts:730-732`; `SkillMemoryService.ts:3612-3616`. On P1/P2/P3 there is no structured analysis, and the prompt is not sent there either |
| "requires `get_chart_view` on this turn" (`DeskToolsService.ts:1600`) | **UNENFORCED and partly FALSE** (C-2) |
| "Prefer 0–2 calls" (`DeskToolsService.ts:1602`) | **UNENFORCED** — up to 8 rounds × 3 calls = 24; a 180 s turn budget (`:192`, `:204`, `:3449`) |
| "forged tools are not offered here" (automation) | **FALSE** (C-3) |
| "at most one plan … and the app caps how many a day" (automation) | **ENFORCED** — `automationTurn.ts:205` (`MAX_PLANS_PER_RUN = 1`, `MAX_PLANS_PER_DAY`) |
| "not offered here" (chat surface drawing / watching) | **ENFORCED** — the executor allow-list `DeskToolsService.ts:2171` |
| "LOOK UP, DON'T REMEMBER" (`chatPrompts.ts:42`) | **UNENFORCED** for an ordinary chat turn; only a Full-analysis turn gets a post-hoc notice (`chatSurfaceTurn.ts:339-347`) |
| "the harness warns only — it does not place, close or resolve trades" (`tradeChatContext.ts:175`) | **ENFORCED** |
| "NEVER re-announce a level already marked fired" (`tradeChatContext.ts:175`) | **UNENFORCED** |
| "every message arrives with a **fresh** packet" (`tradeChatContext.ts:168`) | **PARTLY** — an 8 s cache (`chatTurnRunner.ts:173`); a failed fetch substitutes "packet unavailable" (`tradeChatContext.ts:83`) |
| "An id from an earlier run is gone" (`read_tool_output`) | **ENFORCED** — `clearDeskToolCache` clears the artifact store (`:417-423`, `:3772`) |
| "Never write into diary/distilled" (`write_memory_note`) | **ENFORCED** — `MemoryFilesService.ts:1300/1394` |
| "Restate the predicate whenever you change if_condition" (`revise_skill`) | **UNENFORCED** — the file says "This is display only — a human still applies it" (`:1038-1042`) |
| "No probability above 85% without two matching historical wins" (`analysisPrompts.ts:105`) | **UNENFORCED** |
| "Missing data is 'Unavailable' — never invent a price" (`analysisPrompts.ts:94`) | **ENFORCED** via `dataUnavailable()` — **except** `services/analysis/HybridIntelligenceService.ts:892`, which emits the prefix constant **without** the helper, so the line lacks the "treat this as UNKNOWN" guidance and does not match the shape the legend describes |
| "NEVER say 'I am an AI'" | **UNENFORCED** — no output sanitizer checks disclaimers |
| `web_search` description: "A result starting with DATA_UNAVAILABLE means the search itself failed" | enforced in effect, but the marker is **hand-written in a model-facing string** — `AGENTS.md` forbids exactly that, and `tests/harnessMarks.test.ts:272` only scans for the literal *with a colon*, so it slips past |

### 3.8 Settings that are editable but do nothing

| flag | UI | read by | effect |
|---|---|---|---|
| **`promptAbRate`** ("Prompt A/B (control lane)" — Off / 10 % / 50 %) | `components/settings/SessionUsagePanel.tsx:228-242` | `services/infrastructure/PromptOverrideService.ts:24-38` `beginPromptLane` | **NONE.** `beginPromptLane` has **zero call sites repo-wide** (only an *import* at `hooks/useAnalysisPipeline.ts:69`). `controlLane` is permanently `false`, so `getPrompt` always returns the user's override — **the control lane is unreachable** |
| **`pinnedPromptLane`** | not user-editable; written by `utils/promptVersionStats.ts:45-57` | same | **NONE.** `maybePinWinningPromptLane` reads `trade.promptLane` ← `message.runStats?.promptLane` (`hooks/useTradeLogging.ts:351`) — and **`runStats.promptLane` is never assigned anywhere**: the `runStats` literals at `useAnalysisPipeline.ts:1242,1403`, `App.tsx:1727,1754` and `botRoutine.ts:155` set only `runId` / `startedAt` / `finishedAt` / `durationMs`. `summarizePromptLanes` therefore always reports 0/0, so the "Prompt lanes" dashboard card is **inert**. `runStats.promptVersion` is likewise never assigned |
| `deskToolsEnabled` | Settings | `DeskToolsService.ts:3759`, `toolTurn.ts:161`, `GenericAnalysisService.ts:355` | **LIVE** |
| `skillEnforcementEnabled` | `SessionUsagePanel.tsx:218` | `SkillMemoryService.ts:3556` / `:3656` | **LIVE** |
| `starterLibraryEnabled` | `:176` | `SkillMemoryService.ts:812` | **LIVE** |
| `autoDraftingEnabled` | `:198` | `chartScanSkills.ts:254`, `sessionSkillReview.ts:216`, `botLearning.ts:305`, `DeskToolsService.ts:2730`, `chatTurnRunner.ts:773` | **LIVE** |
| `responseEffort` | `:246` | `services/providers/reasoningControls.ts:96` | **LIVE** |
| `skillLibraryCap` | `:264` | `utils/harnessSettings.ts:166` → `SkillMemoryService.ts:2993` | **LIVE** |

### 3.9 `harnessMarks.ts` and `finishReason.ts` — two holes

**`harnessMarks` — mostly right, two holes.**

- `dataUnavailable` / `DATA_UNAVAILABLE` is emitted at `DeskToolsService.ts:238,1657,1660,1686,1689,1698,2545,2687,2767,2777,2962`, `toolArtifactStore.ts:144`, `chartScanSkills.ts:281`. **Hole 1:** `HybridIntelligenceService.ts:892` emits the prefix without the helper.
- `clipNote` — 13 emit sites; `clipReceipt` — 2; `MINIMAL_CLIP_NOTE` — 1. ✅
- `harnessTurn()` — 4 writers, **all inside the desk-tool loop** (`DeskToolsService.ts:299, 3412, 3643, 3985`). **Hole 2: the only text that explains the mark is `HARNESS_CONTRACT_PROMPT` clause 5, which is composed ONLY in `analyzeTradingView`** (`GenericAnalysisService.ts:366/408`) — the skill-eval path. **P1/P2/P3 receive `HARNESS NOTE (this app, not the trader): …` in the user role with no instruction anywhere about what it is.**
- `harnessNoteLegend()` at `DeskToolsService.ts:3116` (the untrusted fence) is built from the real prefixes ✅ — but it lives in the tool-result fence, not in any system prompt.
- `neutralizeHarnessNotes()` at ingestion for `web_search` (`DeskToolsService.ts:1638,1644,1647,1679`) and for forged tools (`services/tools/toolForge.ts:310`) ✅.

**`finishReason` — the tally is DEAD in production.** `normalizeFinishReason` / `extractFinishReason`
are used correctly on the wire (`GenericProviderService.ts:187,197,790,1296,1455,1709,1993,2019`)
and `truncatesOutput` is read at `DeskToolsService.ts:3203` ✅. But **`beginTruncationWindow()`,
`consumeTruncations()` and `peekTruncations()` have zero production call sites** — only
`utils/finishReason.ts` and `tests/finishReason.test.ts`. So `recordFinishReason` returns
immediately (`!windowOpen`) and **the per-run truncation tally records nothing in the app**.
`AGENTS.md`'s "Read the ceiling with `peekTruncations()`" has no reader.

### 3.10 Injected context — what a request actually costs

| block | cap in code | typical | share of a typical request |
|---|---|---|---|
| market packet | 10 % of the window, `PACKET_TOKEN_CAP = 6,000` tok (`services/trade/tradeChatContext.ts:52-53`), clipped with a `clipNote` naming kept-vs-total | 3,000–8,000 chars | **P2: the largest block, 50–70 % of the user message** |
| on-screen + drawings + armed plans | none | 1,500–4,000 | 10–25 % of the P2 user message |
| **attached file text** | `MAX_FILE_CHARS = 200_000` (`services/trade/chatTurnRunner.ts:168`, `:841-843`) | 0 or huge | **can be 50,000 tokens in one turn** |
| skills index | 30 rows, each ≤620 (`services/learning/MemoryRetrievalService.ts:141`) | 2,000–6,000 | 10–30 % of the system message |
| active strategies | uncapped | 0–3,000 | 0–15 % |
| profile-memory index | body ≤2,000, description ≤160 (`services/learning/profileMemory.ts:48-49`) | 300–2,500 | 0–12 % |
| **retrieved notebook / matched skill body** | `stageBudgetChars` = max(floor, min(2 % of window, 900 tok) × stage share); skill body ≤400, rules ≤300, mistake line ≤200, doctrine 800 | 1,000–3,600 | **assembled and then DISCARDED on the trader's path — see F-01**; live in P5 and reachable via `recall` / `get_notebook_map` |
| bot notes | 900 per agent, 1,800 total (`services/bots/botMemoryBudget.ts:15,23`) | 0–1,800 | P4 only |
| calibration stats | uncapped — 150 (no data) / 420 (per model) / grows | 150–1,500 | **also DISCARDED** (F-01) |

**Fixed harness prose per surface:** P1 4,147 chars (the desk-tools block is 59 % of it);
P2 6,745 (the mandate 64 %, the desk tools 36 %); P3 4,759 (desk tools 51 %);
P5 ≈9,521 (the analyst persona is 41 % of the master prompt).

**Fixed schema tax per request:** the dock 31,455 chars ≈ 7,864 tokens;
chat and automation 25,535 ≈ 6,384 tokens.

---

## 4. Trading logic, end to end

Legend: **[D]** deterministic · **[M]** model-output-dependent · **[D|M]** a deterministic gate
applied to model output.

### 4.1 Production — how a plan is actually born

The live path is **the model calls the `present_trade` desk tool** →
`runPresentTrade` (`services/trade/presentTradeTool.ts:75`).

The plan's schema is `TradeProposal` (`services/trade/proposedTrade.ts:72`). Its levels are **[M]**
(the model's tool arguments) but are then parsed and range-checked deterministically
(`services/trade/tradePlanLevels.ts:68` `priceArgError`, `:88` `usablePrice`). The card's
`TradeAnalysis` is built by `buildProposedTradeAnalysis` (`proposedTrade.ts:126`) and its `rrRatio`
is **recomputed** from the levels via `plannedRiskReward` (`:165`) — **the app does not trust the
model's ratio.**

`analyzeTradingView` (`services/providers/GenericAnalysisService.ts:289`) still exists and still
produces a full `TradeAnalysis` from prose or JSON — but its only production caller is
`services/learning/SkillEvalScheduler.ts:284`. See F-10.

**Boundary schema:** `schemas/tradeAnalysis.ts` (918 lines) — a lenient zod pipeline
(`SanitizedTradeAnalysisSchema` `:10-11`) with `sanitizeLevelOrdering` (`:16`) for SL/TP repair.

### 4.2 Validation — the gates

**(a) The desk-tool gate — this is the one that binds the live path**
(`services/trade/proposalGate.ts` → `services/validation/GateKeeperService.ts`):

| step | file:line | what it bounds |
|---|---|---|
| `fetchGateInputData(symbol, history)` | `GateKeeperService.ts:365` | — |
| 10 s timeout | `proposalGate.ts:30`, `:67` | a slow scan yields an `unavailable` stamp with `confidenceCap: 1` — deliberately **not** a 0 % cap (`:18-22`: *"0 is a measurement, not an absence"*) |
| `runProgrammaticGate(input)` | `GateKeeperService.ts:70` | → `{pass, confidenceCap, warnings, reason}` |
| `unavailable(reason)` | `proposalGate.ts:54-56`, `:79` | nothing is refused; the plan falls to an explicit confirm and is recorded **UNCAPPED** (`:135`) |
| `isStampFresh` | `proposalGate.ts:113` | 120 s (`GATE_STAMP_STALE_MS` `:38`) — a stale stamp re-scans |
| `ensureStamp` | `proposalGate.ts:122-130` | the ONE call every log path makes |
| `beginGateScan` | `proposalGate.ts:88-102` | one in-flight scan per plan id |
| `cancelGateScan` | `proposalGate.ts:106-111` | a Stop cancels; a late answer cannot resurrect a cancelled card |
| `arm()` refusal | `levelWatchService.ts:217` + `staleLevelsAtArm` (`tradePlanLevels.ts:244`) | refuses a plan already through its SL/target at the live mark — **the watch is refused, not the plan**, and the receipt says so (`presentTradeTool.ts:133`) |

**(b) The full validation gate** — `services/validation/TradeValidationGate.ts:495`
`runValidationGate`. The **only** hard error source is `validateAnalysisOutput` (`:150-201`):
direction ∈ {Long, Short, Neutral}; confidence ∈ {High, Medium, Low, Avoid}; ≥1 entry point with a
price; a stop loss; ≥1 TP with a price; probability ∈ [0,100]; a coin name.

| # | gate | file:line | what it does |
|---|---|---|---|
| 1 | pattern-memory match | `:227-327` | downgrade at similarity ≥80 (`ValidationConstants.ts:14-17`); `normalizedSimilarity = (score/90)*100` `:302` |
| 2 | crowded trade | `:329-382` | funding ≥0.0005 warn / ≥0.001 downgrade; L/S >2.0 or <0.5 (`ValidationConstants.ts:24-33`) |
| 3 | session risk | `:384-436` | "closing soon" within 15 min (`:67`) |
| 4 | timeframe alignment | `:438-481` | High=3 / Medium=2 / Low=1 aligned TFs (`:84-90`); >3 conflicts caps High (`:92`) |
| 5 | multi-TF confluence | called `:602` | pushes **errors** + warnings; may downgrade (`:610-612`) |
| 6 | MTF alignment, 2nd pass | `:615-629` | zero aligned TFs used to be computed and **thrown away**, so it came out "PASSED" (`:619-626`); now a warning |
| 7 | **`validateRiskReward`** | `AccuracyValidationService.ts:196-278`, called `:642` | score 80/30 (`ValidationConstants.ts:57-60`); rejects an **inverted plan** (direction-aware `sanitizeLevelOrdering` `:206-210`, `:243-247`); `ratio < min` (High 2.0 / Med 1.5 / Low 1.2 / Avoid 1.0, `:231-241`); **stop tighter than 1×ATR** `:253-256`; warns >3×ATR `:259`, >5 % of entry `:264` |
| 8 | confidence downgrade on R:R fail | `:646-656` | High→Med→Low; **only** <1:1 (or non-finite) reaches `Avoid` (`:650-655`) |
| 9 | volume confirmation | `:662-679` | errors + warnings; **hard rule**: low volume + High ⇒ cap Medium (`:672-675`) |
| 10 | market regime | `:687` | score + confidence |
| 11 | Devil's Advocate | `:696-710` | risk ≥70 ⇒ force Low; ≥50 ⇒ cap Medium (`ValidationConstants.ts:40-43`) |
| 12 | candle confirmation | `:713` | stale-candle warning |
| 13 | dangerous combinations | `:842` | calibration-bucket combinations |
| 14 | streak / session state | `:858-859` | — |
| 15 | calibration penalty | `:821`, applied `:836` | — |
| 16 | entry timing | `:767-775`; threshold `ValidationConstants.ts:50` | score <35 caps High |
| 17 | SL optimisation warning | `:789` | — |
| 18 | **scalp / swing validation** | `:889`, `:899` → `services/analysis/ScalpDetectionService.ts:150`, `:218` | inverted levels `:171-176`; scalp R:R <1:1 `:179-182`; off-hours `:188-191`; weekend `:193-196`; High + stop >0.8 % `:201-206`; swing R:R <1.5:1 `:237-239` |
| 19 | `quickValidate` | `:983` | field-presence subset only |
| 20 | **the result** | `:543-544`, `:943` | `isValid: errors.length === 0` — *"blocking errors only; a scored-criterion FAILURE is a warning + a confidence downgrade, never a silent pass"* |

**The hard-refusal list is short**: `validateAnalysisOutput` (7 checks) plus whatever confluence
and volume push into `errors`. Everything else is a score, a warning or a downgrade.

**Probability clamp** — `utils/analysisUtils.ts:1399-1443` `clampProbabilityToGate(prob, cap, rrRatio)`:
floor 0 / cap 100 (`:1411-1419`) → cap at the gate cap (`:1422-1427`) → **R:R grade bands**:
`<1.2` ⇒ ≤54 %, `<1.5` ⇒ ≤69 % (`:1430-1440`); then `retierConfidenceForClamp` (`:1445+`) re-tiers
the confidence **word** on the same thresholds, so the number and the label cannot contradict.

### 4.3 Sizing — where the numbers come from

The canonical planned R:R is `utils/riskReward.ts` (102 lines):
`plannedRiskReward` `:48` = **nearest-to-entry** target distance ÷ `|entry − stop|`, 2 dp, returns
**0** (never NaN or negative) when not computable (`:44-47`); `firstTargetDistance` `:24`;
`riskRewardDistances` `:63`; `fmtRiskReward` `:91` (`2.4:1`, reward first); `fmtRMultiple` `:101`
(realized, deliberately no `:1`).

**Position sizing has no single module.** risk % of equity from `utils/harnessSettings.ts`;
`rMultiple` from `utils/disciplineAnalytics.computeRMultiple` (`hooks/useTradeLogging.ts:362`);
leveraged MAE/MFE from `services/backtesting/outcomeEngine.ts:293-294`; risk/reward % and USD from
`services/backtesting/ScenarioSimulatorService.ts:103-124`; "the ticket" from `utils/ticketSize.ts`;
an ATR-based stop *suggestion* (`AccuracyValidationService.ts:228`, never applied); and the model's
own size (**[M]**).

**The one place a model's number becomes a number the app computes with** is
`services/trade/proposedTrade.ts:126-165`: the model's entry/SL/TP become the row's levels, and the
app **recomputes** the ratio from them. The model does not supply the ratio.

### 4.4 Logging — one write path

**The single journal write path is `logTradeWithFeedback` — `hooks/useTradeLogging.ts:270`.**
Every route reaches it: the presented plan, a prose chip, a manual log, the auto-capture modal
(`:572`, `:600`) and the autopilot banner (`:778`).

**Trade identity.** `id: message.id` (`:297`) — the trade id **is** the conversation Message id
(`present_trade` reuses it, `:398-399`); `planId` (`:310`) — the id the level-watch armed on;
`sourceRunId` (`:352`) from `runStats.runId`; the ThinkingStore correlation uses a **different
canonical** key, `getThinkingTradeId(analysis.createdAt, trade.id)` (`:453`), with the message id
passed alongside so the outcome lands even when the timestamp key diverges (`:454-457`).

**Dedupe.** `isDuplicate` by id (`:377`); the accumulating side-effects return early (`:390`) while
the idempotent message chrome always applies (`:388-390`) — the ref is advanced **here** because the
effect sync lags one commit, exactly the window a double-confirm fires in (`:370-376`).

**Row contents** (`:296-368`): `analysis` via `withDetectedTradeType` (`:305`), `outcome`,
`timestamp`, `planId`, `outcomeResolvedAt` (`:314` — *when the outcome became known*), `leverage`,
`pnlAmount`/`pnlPercent`, `benchmark`, `correctedStopLoss`/`correctedTakeProfit`,
`triggeredEntryIndices`, `marketSnapshot`, `marketRegime` + `marketRegimeSource` (`:328`),
`slOptimizationData`, `maxAdverseExcursion`/`maxFavorableExcursion` + `excursionSource` (`:337` —
*"provenance, not decoration"*), `realizedR` + `rSource` (`:338-340`), `modelsUsed`,
`thoughtProcesses`, `debateTurns`, `patternMemoryGate`, `promptVersion`, `promptLane`,
`sourceRunId`, `userPriorCall`, `journalTags`, `rMultiple`.

### 4.5 Resolution — one engine

`services/backtesting/outcomeEngine.ts` (441 lines). Its header (`:1-34`) records that three paths
each had their own scan loop and drifted — the same trade resolved "WIN @ TP3" in the backtest panel
and "WIN @ TP1 + breakeven" in the post-mortem. `scanTradeOutcome` (`:107-`):

| rule | line |
|---|---|
| the entry trigger is the first candle touching entry | `:14` |
| **SL-first on the same candle** ⇒ a candle realizing both is a **LOSS** | `:15-17` |
| an initial SL touch does **not** end the scan (recovery inside the 150 % zone is allowed) | `:18-19` |
| a 150 % zone breach before TP1 ⇒ a hard-stop LOSS (`extendedSlPrice` `:119-121`) | `:20` |
| TP1 ⇒ scale out, stop → **breakeven**, 150 % zone **disarmed** | `:21-24` |
| a later breakeven touch ⇒ the remainder exits **flat**; TP2/TP3 only before it | `:22-24` |
| priority: TP(s) → zone breach → SL touch → OPEN | `:25` |
| **inverted plans are NEVER scored** (`planInvalid` + reason) via `sanitizeLevelOrdering` | `:26-29`, `:135-140` |
| `excludeFormingCandle` drops the still-forming candle | `:31-33` |
| a TP1→breakeven exit blends as `(TP1+breakeven)/2` | `:69-71` |

**Outcome autopilot** — `services/ui/OutcomeAutopilotService.ts` (673 lines), a class singleton at
`:673`, `CHECK_INTERVAL_MS = 20_000` `:85`, `MAX_TRACKED_IDS = 2000` `:113`.
**[Unverified — needs a read of the class body]** the price source, the expiry rule and the hand-off
to the log path were not read. The contract that was read: it exports `AutopilotResolution`,
consumed by `utils/approvalInbox.ts:2`.

### 4.6 Learning from the outcome

`hooks/useTradeLogging.ts:434` → `syncClosedTradeToNotebook`
(`services/learning/SkillMemoryService.ts:3288`): a `settledTradeIds` guard marked **before any
await** (`:3298-3302`, capped at 2000 `:3305-3308`) → `appendDiaryEntry` → `syncRecurringMistakes`
→ `applySkillEvidence` → `ingestIfThenFromTrade` (`:3312` → `:2781` → `:2664`) →
`recordSettledTradeForMatrix` (fire-and-forget, `:3315-3317`) → `evaluateSkillWorth` +
`validateCraftedSkill` (`:3319-3337`), where a cluster of ≥`MIN_CLUSTER_FOR_SKILL` similar settled
trades can CREATE a skill.

| store | module | holds | written by | read by |
|---|---|---|---|---|
| **skills** | `SkillMemoryService.ts` (3,915) — `skills/*.md` **inside the notebook blob** | evidence-gated procedures + an `enabled` flag | `ingestIfThenFromTrade` `:2664`, `skillGeneralization.ts:126`, `SkillImportService.ts:30` | `MemoryRetrievalService`, `skillPredicate.ts`, prompt assembly |
| **pattern memory** | `PatternMemorySynthesisService.ts` (949) — now notebook-backed under `distilled/` (`:661-688`) | one file per attributed fact | `distilledMemory.ts:208+` | `PatternMemorySynthesisService.ts:692` |
| **rules** | `StorageService.ts:106-137` (`learning_rules_v2_<user>`) | the rules store | **no longer written from outcomes** (`useTradeLogging.ts:189-194`) — **read-only history** for `applyOutcomeToRules` | attribution only |
| **insights** | `AlgorithmicSummaryService.ts` (128), `utils/tradeInsightBrief.ts` (61), `MemoryService.summarizeTrade` | per-trade summaries | `autoAddRecentInsight` (`useTradeLogging.ts:210`) | the Journal's Recent Insights |
| **global memory** | `GlobalLearningService.ts` (245) — `global_learning_state_<user>` | the confidence-calibration aggregate (Brier buckets) | `updateCalibration` (`useTradeLogging.ts:484`) | `calibrationPolicy.ts`, `calibrationPrompts.ts` |

**Two deliberate non-writes** **[Verified by code reading]**: the parallel rules store is no longer
written from outcomes (skills are the single representation); and **`levelsCorrected` plans are
excluded from model training** (`useTradeLogging.ts:169-170`, and again for the Brier ledger at
`:476`) — a mirrored plan's outcome says nothing about the model's reading, and the mirror hides
the error.

**The notebook refuses growth rather than evicting** — `notebookPressureAllows`
(`MemoryFilesService.ts:443`); new files are refused at the trigger tier, all model notes at the
hard cap (`:1310`).

### 4.7 Deterministic vs model-dependent — the whole chain

| step | kind | where |
|---|---|---|
| market-data fetch | **[D]** | `services/analysis/MarketDataService.ts` |
| TA / candle patterns | **[D]** | `TechnicalAnalysisService.ts`, `CandlePatternDetector.ts`, `taLibrary.ts` |
| hybrid packet assembly | **[D]** | `HybridIntelligenceService.ts` |
| prompt layering | **[D]** over **[M]** content | `utils/composePrompt.ts:36` |
| the model's answer | **[M]** | `sendChatRequest` `:1237` / `streamChatTurn` `:1407` |
| the model's tool arguments (entry/SL/TP) | **[M]** | `present_trade` args → `parseTradeProposal` `proposedTrade.ts:72` |
| level parsing / range checks | **[D]** | `tradePlanLevels.ts:68`, `:88` |
| plan-id minting | **[D]** | `proposedTrade.ts:67` |
| **planned R:R — the card / journal** | **[D]** over **[M]** | `utils/riskReward.ts:48` |
| **planned R:R — the gate** | **[D]** over **[M]**, **a different formula (index 0)** | `AccuracyValidationService.ts:196` ← **F-11** |
| **scalp/swing R:R — the gate's second number** | **[D]** over **[M]**, **a third formula** | `ScalpDetectionService.ts:178`, `:236` ← **F-12** |
| the gate scan (the cap) | **[D]** over market data | `GateKeeperService.runProgrammaticGate` `:70` |
| the full validation gate | **[D]** over **[M]** analysis + **[D]** market data | `TradeValidationGate.ts:495` |
| field-presence validation | **[D]** over **[M]** | `TradeValidationGate.ts:150` |
| zod boundary coercion + level-order repair | **[D]** over **[M]** | `schemas/tradeAnalysis.ts` |
| probability clamp | **[D]** over **[M]** probability | `utils/analysisUtils.ts:1399` |
| the outcome scan | **[D]** over market data | `outcomeEngine.ts:107` |
| realized R multiple | **[D]** | `utils/disciplineAnalytics.computeRMultiple` |
| the journal row | **[D]** assembly over **[M]** analysis + **[D]** outcome | `useTradeLogging.ts:296-368` |
| the learning write | **[D]** pipeline over **[M]**-derived text | `SkillMemoryService.ts:3288` |
| `ingestIfThenFromTrade` rule text | **[M]** text, **[D]** admission gate | `SkillMemoryService.ts:2664`; the gate at `:3330` |
| `evaluateSkillWorth` | **[D]** | `SkillMemoryService.ts:3319` |

### 4.8 Model output reaching a calculation without validation

| # | site | what the model's output does | validation | assessment |
|---|---|---|---|---|
| 1 | `proposedTrade.ts:126-165` | the model's entry/SL/TP become the row's levels; the ratio is **recomputed** from them (`:165`) | `usablePrice` / `priceArgError`; `sanitizeLevelOrdering`; the gate scan | **Acceptable** — the app does not trust the model's ratio |
| 2 | **`AccuracyValidationService.ts:196`** | the model's **index-0** target decides a **confidence downgrade** (`:646-656`) and, via `analysis.rrRatio`, a **probability clamp** (`analysisUtils.ts:1430`) | `parsePrice`; direction-aware ordering (`:206-210`) | **F-11** — the formula differs from the card's; a 1:1 plan can be gated as 2:1 |
| 3 | **`ScalpDetectionService.ts:178`, `:236`** | the model's index-0 target decides a **second** R:R that downgrades confidence (`:176`, `:181`) | direction-signed risk/reward; inverted-level refusal (`:171-176`) | **F-12** |
| 4 | `utils/analysisUtils.ts:1399` | the model's **own** probability % becomes the displayed number | clamped to [0,100], the gate cap and the R:R bands | **Acceptable** — but the band uses the *card's* ratio, so it and the gate disagree (F-11) |
| 5 | `services/trade/tradeShapedProse.ts:51` `planFromProse` | the model's **prose** is parsed into a `TradeProposal` — a plan stated in a sentence rather than a tool call | `parseTradeProposal` + level checks; `proseNeedsAChip` (`:78`) | **[Unverified — needs X]** whether prose-parsed plans reach the log path *without* the gate scan. `proposalGate.ts:4-8` says the gate must bind "that path too", which implies it does; the call site was not traced |
| 6 | `TradeValidationGate.ts:589` `parsePrice` | the model's price **strings** become numbers | `parsePrice` handles annotations ("94500 4h" → 94500) — `:584-586` records that a naive digit-strip regex produced 945004 (a 100× inflation corrupting R:R and ATR math) | **Acceptable — a good catch by the repo** |
| 7 | `outcomeEngine.ts:107` | the model's entry/SL/TP decide the scan geometry | `sanitizeLevelOrdering` refusal (`:135-140`) | **Acceptable** |
| 8 | `useTradeLogging.ts:305` `withDetectedTradeType` | the model's analysis is re-labelled scalp/swing | `withDetectedTradeType` | **[Unverified — needs X]** the body was not read; if it reads model-authored text it is an unvalidated input |
| 9 | `SkillMemoryService.ts:2664` `ingestIfThenFromTrade` | the **model writes the if/then rule text** into the notebook | the **worth gate** `:3319` + `validateCraftedSkill` + the cluster threshold `MIN_CLUSTER_FOR_SKILL` `:3330` | **Acceptable in shape** — the *text* is model-authored, the *admission* is evidence-gated. This is the intended hybrid design |
| 10 | `services/validation/calibrationPolicy.ts` / `calibrationPrompts.ts` | the model grades calibration | the policy is deterministic | **[Unverified — needs X]** |

---

## 5. The tool surface

**39 static tools (31 core + 8 chart) + 2 mailbox + an unbounded forged set.** Schema size is the
per-request tax: the description plus the JSON parameters.

### 5.1 The 31 core tools

| tool | def line | schema chars | ≈tok | reads | writes (and where) | timeout | error behaviour | offered on |
|---|---|---|---|---|---|---|---|---|
| `amend_memory` | 824 | 892 | 223 | the notebook | **proposal only** → pending, a human approves | 20 s | `rejected:` | all (automation denies) |
| `forge_tool` | 845 | 1,016 | 254 | — | **proposal only** → candidate | 20 s | `rejected:` | all (automation denies) |
| `write_memory_note` | 869 | 806 | 202 | — | **DIRECT WRITE** → `memory_files_v1_<user>` | 20 s | `rejected:` | all (automation denies) |
| `get_notebook_map` | 891 | 304 | 76 | the notebook | — | 20 s | `DATA_UNAVAILABLE` | all |
| `remember` | 902 | 1,421 | 355 | profile memory | **DIRECT WRITE** | 20 s | `rejected:` | all (automation denies) |
| `read_memory` | 929 | 364 | 91 | profile memory | — | 20 s | `DATA_UNAVAILABLE` | all |
| `forget` | 946 | 276 | 69 | profile memory | **DIRECT DELETE** | 20 s | `rejected:` | all (automation denies) |
| `propose_skill` | 963 | 2,160 | 540 | skills | **PENDING DRAFT** → the Coach inbox | 20 s | `rejected:` | all (automation denies) |
| `propose_strategy` | 996 | 1,609 | 402 | strategies | **DRAFT file** | 20 s | `rejected:` | all (automation denies) |
| `revise_skill` | 1027 | 891 | 223 | skills | **PENDING proposal** | 20 s | `rejected:` | all (automation denies) |
| `read_tool_output` | 1054 | 789 | 197 | the artifact store | — | 20 s | `DATA_UNAVAILABLE` | all |
| `web_search` | 1072 | 465 | 116 | **DuckDuckGo** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_derivatives` | 1092 | 383 | 96 | **Binance fapi** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_order_book` | 1107 | 487 | 122 | **Binance depth** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_liquidations` | 1122 | 329 | 82 | **Binance** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_btc_context` | 1137 | 314 | 79 | **CoinGecko** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_market_packet` | 1152 | 629 | 157 | **Binance** ×4 TFs | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_all_timeframes` | 1167 | 649 | 162 | **Binance** ×5 TFs | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_chart_view` | 1182 | 686 | 172 | **Binance** klines + mark + book | — | 20 s | `DATA_UNAVAILABLE` | **dock only** |
| `get_session_context` | 1198 | 179 | 45 | the local clock | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_price_snapshot` | 1211 | 467 | 117 | **Binance** | — | 20 s | `DATA_UNAVAILABLE` | all — **never cached** (`:379-382`) |
| `get_indicators` | 1231 | 1,660 | 415 | **Binance** → local TA | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_setup_history_stats` | 1257 | 483 | 121 | the local journal | — | 20 s | `DATA_UNAVAILABLE` | all |
| `get_trade_log` | 1273 | 1,095 | 274 | the local journal | — | 20 s | `DATA_UNAVAILABLE` | all |
| `recall` | 1292 | 419 | 105 | the notebook + skills | — | 20 s | `DATA_UNAVAILABLE` | all |
| `recall_chat` | 1311 | 524 | 131 | past sessions | — | 20 s | `DATA_UNAVAILABLE` | all |
| `scan_setups` | 1330 | 861 | 215 | **Binance** + the strategy book | — | 20 s | `DATA_UNAVAILABLE` | all |
| `scan_chart_skills` | 1349 | 1,301 | 325 | **Binance**, ≤1000 bars | **PENDING skill drafts** | 20 s | `DATA_UNAVAILABLE` | **dock only** |
| `project_future_price` | 1372 | 853 | 213 | **Binance** | — | 20 s | `DATA_UNAVAILABLE` | all |
| `run_screener` | 1389 | 843 | 211 | the **Binance** universe | — | 20 s | `DATA_UNAVAILABLE` | all |
| `run_monte_carlo` | 1406 | 1,921 | 480 | **none — local MC** | — | 20 s | argument rejections | all |
| | | **25,076** | **6,269** | | | | | |

### 5.2 The 8 chart tools (dock only)

| tool | def line | schema chars | ≈tok | writes (and where) |
|---|---|---|---|---|
| `draw_on_chart` | 1447 | 1,496 | 374 | **live canvas shapes** |
| `draw_detected` | 1468 | 653 | 163 | **live canvas shapes** (from the detector's geometry) |
| `mark_trade_levels` | 1484 | 509 | 127 | **live canvas Entry/SL/TP** |
| `clear_chart_drawings` | 1502 | 341 | 85 | **deletes canvas shapes** |
| `present_trade` | 1517 | 1,145 | 286 | **the proposal card + the level-watch** |
| `watch_price` | 1540 | 1,026 | 257 | **arms a price watch** |
| `wake_me` | 1560 | 625 | 156 | **arms a timed wake-up** |
| `cancel_watch` | 1578 | 584 | 146 | **cancels watches** |
| | | **6,379** | **1,595** | |

Plus two mailbox tools — `send_message` / `read_message`
(`services/analysis/DebateMailbox.ts:119/139`) — reachable only from the dock's multi-seat panel
(`services/trade/chatTurnRunner.ts:1083-1084` → `:654-656` → `DeskToolsService.ts:3819`). **Live.**

Plus `custom_*` — the **forged** tools (`services/tools/toolForge.ts:176`): an https host the model
itself wrote, **GET or POST**.

### 5.3 Which surface gets which tools

| | P5 evaluation | P1 chat | P2 dock | P3 automation |
|---|---|---|---|---|
| core (31) | **all 31**, no allow-list | 30 (no `get_chart_view`) | **31** | 30 (no `get_chart_view`) |
| chart (8) | none (no `executePanelTool`) | 1 (`present_trade`) | **8** | 1 (`present_trade`, plan-capped) |
| mailbox (2) | none | none | panel only ✅ live | none |
| forged `custom_*` | yes | yes | yes | **yes — NOT denied** ⚠️ (C-3) |

**Both enforcement points are real and both work.** The offer-time filter
(`DeskToolsService.ts:3354-3358`, native `chat_completions` only) **and** the transport-agnostic
executor allow-list (`:2171-2173`), which is also applied to forged tools *before* the forge
executor (`:3532-3535`, with a comment recording that the gate "used to live only in the core
executor, and `custom_*` routed around it").

### 5.4 Defined-but-not-exposed

- **`ARBITER_ALLOWED_TOOLS`** (`DeskToolsService.ts:2988-3004`, 9 tools) — **DEAD**. Only
  `tests/evidencePack.test.ts:97-101` and `tests/tradeLogTool.test.ts:112` reference it.
- `analysis.lens`, `LENS_SCALP_PROMPTS` / `LENS_POSITION_PROMPTS`, the three `learningPrompts`
  constants, `analyzeTradingViewWithTransientRetry`, `getLensPromptForStyle`,
  `appendLensMemoryToPrompt` — all dead (§3.3).

**No tool is exposed whose implementation is missing**: all 31 core names have a `case` in
`executeDeskTool` (`:2201-2937`), and the default is `Unknown tool: <name>` (`:2934`).

**No tool throws to the model**: `executeDeskTool` try/catch → `ok:false` + `dataUnavailable()`
(`:2956-2965`), and `withinToolDeadline` (`:227-260`) converts a timeout, an abort or a throw into
a `DATA_UNAVAILABLE:` receipt, so an assistant `tool_calls` turn is always answered (providers
return 400 otherwise). That is a genuinely good design.

### 5.5 The tool cache — correct, with one gap

`toolCache` (`:317`), `TOOL_CACHE_TTL_MS = 30_000` (`:311`), `TOOL_CACHE_MAX = 200` with
oldest-first eviction (`:321-328`), key = `name@scope:JSON(sorted args)` (`:339-340`).
Only `CACHEABLE_TOOLS` cache (`:373-389`): `get_market_packet`, `get_all_timeframes`,
`get_derivatives`, `get_order_book`, `get_liquidations`, `get_session_context`,
`get_setup_history_stats`, `project_future_price`, `run_screener`, `scan_setups`, `web_search` and
`custom_*`. **`get_price_snapshot` is deliberately excluded** (`:379-382`). Failure sentinels are
never cached (`:2951`).

**`clearDeskToolCache()` is called at exactly one place — `:3772`, the top of
`streamChatWithDeskTools`**, the single generator every tool turn passes through. It also clears
the artifact store, so a `read_tool_output` id from an earlier run is genuinely gone.
`tests/deskToolCache.test.ts:209-227` pins that.

**The gap:** `runDeskToolLoop` is exported and callable *without* the clear. The invariant is
enforced by a **source-shape test**, not a runtime guard — so a new caller can silently break it.

### 5.6 The tool-output cost, and the worst case

Default per-result cap **2,400 chars ≈ 600 tokens** (`:428`), with overrides (`:431-451`):
`get_market_packet` 6,000 · `get_all_timeframes` 8,000 · `get_chart_view` 8,000 · `run_screener`
4,000 · `get_trade_log` 4,000. **3 calls per round** (`:3449`), **8 rounds** (`:192`), a **180 s
turn** (`:204`, wrap-up at 80 % `:205`), **20 s per call** (`:216`).

**Worst case per turn: 8 × 3 × 8,000 = 192,000 chars ≈ 48,000 tokens.** A typical round is 2–3 calls
≈ 3,000–7,000 chars ≈ 750–1,750 tokens. **The whole message array is re-sent each round**, so it
compounds. Read-back pages at 2,000 (`:316`), and the spill receipt is only offered when the seat
can redeem it (`:470`) ✅.

### 5.7 What the tools send off the machine

| tool | host(s) | what is sent |
|---|---|---|
| `web_search` | `api.duckduckgo.com` + `html.duckduckgo.com` (`:1624`, `:1666`) | **the model's query verbatim** |
| 12 market tools | `api.binance.com`, `fapi.binance.com` (+ fapi1/2, api1/2/3, `data-api.binance.vision`) — `MarketDataService.ts:249-266`, `KlineService.ts:152-179` | **the trading symbol and interval** |
| `get_btc_context` | `api.coingecko.com/api/v3/global` (`services/analysis/CorrelationRiskService.ts:38,147`) | nothing user-specific |
| `custom_*` | **any https host the model wrote** — `assertSafeForgedUrl` (`:98`): https only, no credentials, port 22 blocked, private/loopback/link-local/multicast blocked, host-position `{param}` slots rejected at save time; same-host redirect policy (`:207-238`); GET-only caching; `MAX_RESPONSE_CHARS = 2,400`; TTL clamped to [5 s, 10 min] | the URL and its parameters, **GET or POST** |
| `run_monte_carlo` | none | — |

**No tool sends an API key, an account id or a credential to a third party.** But on the **web
build** the degraded kline fallback routes the whole Binance request through **three third-party
CORS proxies** — `api.allorigins.win`, `corsproxy.io`, `api.codetabs.com`
(`services/analysis/KlineService.ts:176-178`) — so the symbol and the request URL are visible to
three unrelated operators. That is a real, if low-severity, egress surface, and it is not named in
`PRIVACY.md`.

---

## 6. Security and privacy

### 6.1 Electron hardening — **[Verified by code reading]** this is genuinely good

| control | state | where |
|---|---|---|
| `nodeIntegration` | **false** | `electron/main.cjs:972` |
| `contextIsolation` | **true** | `:973` |
| `webSecurity` | **true** | `:974` |
| `sandbox` | **true** | `:977` — the renderer is fully sandboxed; the preload bridge is its only privileged surface |
| `setWindowOpenHandler` | **denies everything** | `:1021-1025` |
| `will-navigate` | allows only `http://localhost/` (dev) or `app://` (prod) | `:1027-1029` |
| `setPermissionRequestHandler` | **denies every permission** — media, geolocation, clipboard | `:1324-1329` |
| `registerSchemesAsPrivileged` | the `app:` scheme is registered at boot | `:138` |
| `app://` path traversal | **protected** — `path.relative` + `..` + absolute checks, 403 otherwise | `:929-937` |
| the renderer bridge | **no filesystem, no SQLite, no Node** — 15 methods, all of them either version info, updater control, `safeStorage`, or provider egress | `electron/preload.cjs` |

**The `app://` handler is the part most Electron apps get wrong, and this one does not**: it
resolves the path, then checks `relativePath === '..'`, `relativePath.startsWith('..' + sep)` and
`path.isAbsolute(relativePath)` before serving. A `../../` escape is refused with a 403.

### 6.2 The Content-Security-Policy

**[Verified by code reading]** `index.html`:

```
default-src 'self' app:;
script-src 'self' https://s3.tradingview.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://s3.tradingview.com https://www.tradingview.com;
font-src 'self' data:;
connect-src 'self' app: https: wss: ws: blob: data:;
worker-src 'self' blob:;
frame-src https://s3.tradingview.com https://www.tradingview.com https://tradingview.com;
object-src 'none';
base-uri 'self'
```

**Good:** `default-src` is narrow; `object-src 'none'`; `base-uri 'self'`; no `unsafe-eval`
anywhere; no `*`.

**Three things to note, in descending order of interest:**

1. **`script-src` allows a remote origin** — `https://s3.tradingview.com`. It is there for the
   TradingView widget, but it means a compromised bucket, or a MITM against that one origin,
   becomes arbitrary script in the app. There is no SRI-style integrity control on it.
2. **`connect-src` allows `https:` and `wss:`/`ws:` universally.** That is a deliberate trade-off —
   the provider URL is user-configurable, so it cannot be pinned — but it also permits the three
   CORS proxies in §5.7, and `ws:` (plaintext) alongside `wss:`.
3. **No `frame-ancestors`, no `form-action`.** Minor for a desktop app with no frames of its own
   except TradingView.

### 6.3 Secrets

- **Desktop:** API keys are encrypted at rest through Electron `safeStorage`
  (`electron/main.cjs:1279` `crypto:encrypt`, `:1289` `crypto:decrypt`), bridged by
  `electron/preload.cjs:26-27`, and `services/infrastructure/ProviderConfigService.ts` encrypts on
  save and decrypts on load. **The plaintext is returned into the renderer** on demand, so it exists
  in renderer memory while a request is in flight. That is the correct shape for a renderer that
  must sign a request, but it means "encrypted at rest" is the honest claim, not "never in the
  renderer".
- **Web / Capacitor:** the keys stay **plaintext** in Preferences. That is documented.
- **Never committed:** **[Verified live]** a working-tree scan for `sk-…`, `AIza…`, `ghp_…`,
  `AKIA…`, `-----BEGIN … PRIVATE KEY-----` and `xox…` across every tracked text file returns
  **zero** hits. A history scan across the **520 most recent revisions** returns hits in exactly
  one file — `tests/runStatus.test.tsx:90,94,98,100` — and those are **deliberate fake keys in a
  sanitizer test fixture** (the test asserts the error-text sanitizer strips them). The 120
  earliest revisions (including `9afc42d1`, whose subject is *"Initial commit (secrets removed)"*)
  return **zero** hits. **No secret was found in the tree or in the scanned history.**
- **Logging:** the repository has `utils/runStatus.ts`'s error-text sanitizer, and the test above
  proves it is applied. `AGENTS.md` and `services/providers/GenericProviderService.ts`'s
  `toFriendlyProviderError` establish the rule that raw API error bodies are never surfaced.

### 6.4 The no-order-placement guarantee — **verified, and enforced by a test**

**[Verified by code reading]** a repository-wide search for exchange order endpoints
(`/api/v3/order`, `/fapi/v1/order`, `createOrder`, `placeOrder`, `submitOrder`, `new_order`)
returns **only public market-data paths**: `klines`, `ticker/price`, `premiumIndex`, `depth`.

**And the guarantee is pinned by a test**, which is the right way to keep it:
`services/analysis/../constants/disclaimer.ts` is asserted by `tests/disclaimer.test.ts` to say
the app *"never places or signs a trade"* and that the first-run notice says *"no exchange account
access"*; `PRIVACY.md` is asserted to contain the real market-data endpoints and to say *"no API
key, no signature"*; and the test also asserts `PRIVACY.md` mentions `X-MBX-APIKEY` (i.e. that the
header the app *does not* send is named, so the omission is explicit).

**Conclusion: the product framing's central promise holds at the pin, and is defended by a gate
rather than by a comment.** That is the strongest single piece of engineering hygiene in the
repository.

### 6.5 What leaves the machine, and when

| destination | what | when |
|---|---|---|
| the user's configured provider endpoint(s) | the whole conversation, the system prompt, the tool schemas, the trader's text, the retrieved context, the tool results | every model call |
| `api.binance.com`, `fapi.binance.com` (+ mirrors), `data-api.binance.vision` | symbol + interval | every market-data read |
| `api.coingecko.com` | nothing user-specific | the BTC-context tool |
| `api.duckduckgo.com` / `html.duckduckgo.com` | **the model's query verbatim** | the `web_search` tool |
| `api.allorigins.win`, `corsproxy.io`, `api.codetabs.com` | the whole Binance request URL, via the degraded kline fallback | **web build only**, when the direct path fails |
| `s3.tradingview.com`, `www.tradingview.com` | the widget's own traffic | the TradingView integration |
| the update feed (`electron-updater`) | the app version and platform | on a scheduled check and on demand |
| `sentry`-like telemetry | **none** — no telemetry host appears in the source | — |

**No portfolio, no P&L, no journal row and no credential is ever sent to a market-data or search
host.** The only place trade data goes is the provider the trader configured — which is the
product's whole premise, and is disclosed in `PRIVACY.md` and in the first-run notice.

**The CORS-proxy fallback is the one item `PRIVACY.md` does not name.** Low severity (a symbol and
a URL are not private), but it is a third-party relay and the doc's own test asserts the doc names
"the real market-data endpoints".

---

## 7. Reliability

### 7.1 What is handled well

These are not filler; they are the reason the app is shippable at all, and they should not be
lost in a cleanup.

| behaviour | where |
|---|---|
| **no tool throws to the model** — a timeout, an abort or a throw becomes a `DATA_UNAVAILABLE:` receipt, so an assistant `tool_calls` turn is always answered (providers 400 otherwise) | `services/analysis/DeskToolsService.ts:227-260`, `:2956-2965` |
| **the notebook refuses growth rather than evicting** — a soft/trigger/hard byte ladder, and a classifier that decides the tier | `utils/memoryBudget.ts`; `MemoryFilesService.ts:443`, `:1310` |
| **a notebook write that never reached disk is surfaced, not swallowed** — `persist` records the failure (quota vs error, bytes, streak), rethrows so no caller's handling changes, and clears on the next success | `MemoryFilesService.getNotebookWriteFailure()` |
| **the gate is fail-open with a cap, never fail-silent** — an unavailable scan yields `confidenceCap: 1` and a recorded **UNCAPPED** plan, not a 0 % and not a refusal | `services/trade/proposalGate.ts:18-22`, `:54-56`, `:135` |
| **the outcome engine is conservative in the right direction** — SL-first on the same candle is a loss; an inverted plan is never scored; the still-forming candle is excluded | `services/backtesting/outcomeEngine.ts:15-17`, `:26-29`, `:31-33`, `:135-140` |
| **`levelsCorrected` plans are excluded from model training** and from the Brier ledger | `hooks/useTradeLogging.ts:169-170`, `:476` |
| **the settled-trade guard is marked before any `await`**, so a double-fire cannot double-write | `services/learning/SkillMemoryService.ts:3298-3302` |
| **the provider is the single place errors are made user-safe** | `GenericProviderService.toFriendlyProviderError` |
| **the migration layer cannot lose data** — all seven SQLite migrations are additive, and a version is recorded only if every statement applied | `services/infrastructure/SqliteService.ts:296-308`, `:311-363` |
| **one request-sending function, one wire policy, three transports** — the renderer and the Electron main cannot drift | `GenericProviderService.ts:1237`; `shared/providerRequestPolicy.cjs` |
| **`clearDeskToolCache()` has exactly one call site** and it is the choke point every tool turn passes through, pinned by a test | `DeskToolsService.ts:3772`; `tests/deskToolCache.test.ts:209-227` |

### 7.2 Weaknesses

| ID | sev | finding | evidence |
|---|---|---|---|
| **F-01** | **HIGH** | **The assembled context is computed and then DISCARDED.** `enhancedPrompt` and `hybridDataInjection` in `hooks/useAnalysisPipeline.ts` are built and only `devLog`ged; the request sends `promptToSend`. The trader's turn gets **no** retrieved notebook, no matched-skill body, no skill-trigger note, no similar-setups, no reflections, no recent insights, no market packet. | `useAnalysisPipeline.ts:1003-1154`; sends at `:1214`, `:1323`, `:1350` |
| **F-01b** | **HIGH** | **The injection ledger therefore records skills the model never received.** `getMemoryFilesContext` **records an injection** by default (`MemoryRetrievalService.ts:976-981`); `assemblePipelineMemoryContext` calls it without `recordInjections: false` (`hooks/analysisPipeline/memoryContext.ts:150`); and the result is thrown away. `skillAdherenceForRun` (`MemoryInjectionService.ts:189`) is the join `applySkillEvidence` (`SkillMemoryService.ts:1617`) uses to grant **FOLLOWED** credit. The documented cold-start contract — *"evidence accrues only on the FOLLOWED branch… a skill the run was not shown goes to `controlIds`, never to W/L"* (`docs/learning-loop-map.md:80-91`) — is therefore **violated in the app's favour**: skills earn credit for outcomes they did not influence. | see left |
| **F-01c** | **HIGH** | **The gate injection is a hard-coded empty string.** `const gateInjection = '';` at `useAnalysisPipeline.ts:1138` — the whole "GATE KEEPER: Two-Stage Gate Scan" block (`:1113-1150`) computes nothing, and the `devLog('[GateKeeper] Gate constraints injected into prompt')` at `:1148` can never fire. | `useAnalysisPipeline.ts:1138` |
| **F-03** | **Med-High** | **`approval_rules_v1:<user>` is on neither allow-list** — on web it is exported and then refused on import; on native it is neither exported nor restored. It gates **every auto-apply**. The repo's own test says *"worth a decision"*; the decision was never taken. | §2.6 F-04; `utils/approvalInbox.ts:46`; `ExportService.ts:758-760` |
| **F-10** | **Med-High** | **The analysis prompt never reaches a trader-facing answer.** `analyzeTradingView` has exactly one production caller — the skill-eval scheduler. `analyzeTradingViewWithTransientRetry` has zero. The harness contract, the analyst persona, the R:R rules and the memory-enforcement prompt reach a model **only in the skill-eval harness**. | `GenericAnalysisService.ts:289`; `SkillEvalScheduler.ts:284`; `useAnalysisPipeline.ts:228-254` |
| **F-11** | **HIGH** | **The validation gate computes R:R from `takeProfit[0]`** while the card, the journal and the probability clamp use the **nearest** target. On an out-of-order target list a 1:1 plan can be **gated as 2:1** while the clamp applies the 1:1 band. This is exactly the drift `utils/riskReward.ts` was written to end, and the gate was never migrated. | `TradeValidationGate.ts:589` → `AccuracyValidationService.ts:196-222` vs `utils/riskReward.ts:48` → `utils/analysisUtils.ts:1272-1278` |
| **F-12** | **Med** | **A second R:R implementation inside the same gate run** — `services/analysis/ScalpDetectionService.ts:178` and `:236`, both index-0, called at `TradeValidationGate.ts:889` and `:899`. The file's own "never wired in" comment (`:160`) is stale. | see left |
| **F-13** | **Med-High** | **There is no cost model anywhere.** A repository-wide search for `slippage|takerFee|makerFee|commission|costBps|feeRate` finds only a *warning string* (`ScalpDetectionService.ts:189`), a *comment* (`ReinforcementSignalService.ts:50`) and the `netR` accumulator in `SkillMemoryService.ts`. **Every R in the journal, every win rate, every calibration bucket and the whole skill ledger is gross.** Note that `netR` is a misleading name: it is the **sum of realized R multiples**, not net of costs. | §7.4 below |
| **F-14** | **HIGH** | **The roster store was read but never written at the pin.** `bots_v1_<user>` is written only by `BotRegistry.upsert` and `BotRegistry.seedIfEmpty`; `395f73db` removed the second, and there is **no production caller of `upsert`**. `BotRegistry.list()` therefore always returned `[]`, which silently killed (a) the bot-memory merge into the prompt context (`hooks/analysisPipeline/memoryContext.ts:98-99`) and (b) the skill-worth gate's authoring-bot context (`SkillMemoryService.ts:3365-3380` — it fell back to `trade.id` every time, defeating the exact failure the code comment says it exists to prevent). **Fixed by the concurrent session's in-flight work.** | `services/bots/BotRegistry.ts:14-75` |
| **F-15** | **Med** | **`buildHybridEnvelope` is imported and never called.** `hooks/useAnalysisPipeline.ts:66` imports it; a repository-wide search returns exactly two hits — the import and the definition. | `useAnalysisPipeline.ts:66`; `utils/debateEnvelopes.ts` |
| **F-16** | **Med** | **The truncation tally records nothing.** `beginTruncationWindow()`, `consumeTruncations()` and `peekTruncations()` have zero production call sites, so `recordFinishReason` returns immediately (`!windowOpen`). `AGENTS.md` tells a future reader to "read the ceiling with `peekTruncations()`" — there is no reader. | `utils/finishReason.ts` |
| **F-17** | **Med** | **The "Prompt A/B (control lane)" control does nothing.** `beginPromptLane` has zero call sites, and `runStats.promptLane` is never assigned — so the "Prompt lanes" dashboard card is inert. | `PromptOverrideService.ts:24-38`; `useAnalysisPipeline.ts:1242,1403`; `App.tsx:1727,1754` |
| **F-18** | **Med** | **The in-flight `getBots()` is a getter with a destructive write-on-read migration that runs during React render.** The first read of a profile permanently strips `role`/`enabledTools` from every stored bot row, and the write path calls `notify()`, which can land a `setState` during render. **[Unverified — needs `npm run render-probe`]** whether it warns or loops. *This is a review point on the concurrent session's work, not a proposal.* | `services/agents/agentRoster.ts` (in-flight); `hooks/useAgentThreads.ts:63` |
| **F-19** | **Med** | **`app.getVersion()` and the in-app version can disagree.** `constants/version.ts:6` falls back to the literal `'1.0.28'` when `import.meta.env.PACKAGE_VERSION` is absent (the Vite `define` supplies it in builds, `vite.config.ts:443`), while `package.json` says `1.3.0` and the comment claims the literal is "kept synced with package.json". It is five minor versions behind. | `constants/version.ts:6`; `package.json` |
| **F-20** | **Med** | **The committed lockfile does not match the committed manifest.** `package-lock.json` says `1.0.30`; `package.json` says `1.3.0`; and the lockfile's root `devDependencies` block lacks `js-yaml` (which `package.json` lists and `scripts/check-workflow-shells.cjs:32` imports). The fix is sitting uncommitted in the working tree. | `package.json`; `package-lock.json`; `scripts/check-workflow-shells.cjs:32` |
| **F-21** | **Info** | **The legacy `approval_rules_v1` (unscoped) is read but never written and never deleted** — it can shadow the scoped key indefinitely. | `utils/approvalInbox.ts:30` vs `:46` |

### 7.3 F-01 in detail — the single most important finding

This deserves its own section because it is the one finding that changes what the app *is*.

**What is assembled, per send, in `hooks/useAnalysisPipeline.handleSendMessage`:**

| assembled | pin line | fate |
|---|---|---|
| `hybridDataInjection` — the entire hybrid market packet | `:940` / `:981` | only `devLog`ged at `:965` and `:1153` — **never in a prompt** |
| `memoryFilesContext` — the retrieved notebook, the **matched skill body**, the risk rules, the recurring-mistake line, the recent-form block, similar trades, the family×regime matrix, the doctrine, the settled beliefs | `:1005` | → `contextParts` `:1106` → `enhancedPrompt` `:1110` → **never read again** |
| `similarSetupsContext` | `:1006` | → `:1107` → discarded |
| `learningInjection` — the weighted-voting block | `:1080` | → `:1108` → discarded |
| `predicateGate.note` — the **code-checked** skill trigger | `:1030-1049` | → `:1109` → discarded |
| `buildDecisionReflectionContext(loggedTrades, finalSymbol)` — the Reflexion loop over the trader's own closed trades | `:1130` | prepended at `:1132` → discarded |
| `recentInsightsString` | `:1098` | only `devLog`ged `:1099` |
| `gateInjection` | **hard-coded `''`** `:1138` | never anything |
| `enhancedPrompt` | `:1103`, mutated `:1110`/`:1132`/`:1147` | `devLog`ged `:1152` — **never read again** |

**What is sent instead: `promptToSend`** (`:779`) — at `:1214` (automation), `:1323` (the bot quick
response) and `:1350` (the desk, `runChatSurfaceTurn` at `:1347`).

**So the trader's own turn reaches the model with:**
- the system prompt: the surface mandate + a **skills index** (slug, status, kind, description,
  if/then — up to 30 rows) + active strategies + the profile-memory index + the desk-tools block;
- the trader's own text.

**And it does not reach the model with:** the retrieved notebook, the **body of the skill that
matched**, the code-checked skill trigger, the similar setups, the trader's own closed-trade
reflections, the recent insights, the calibration block, the hybrid market packet, or the gate
constraints.

**This is not a broken retrieval.** `getMemoryFilesContext` works, the budgets work, the injection
records work, the skill-evidence join works. The output is simply routed to a variable that
nothing sends. It is the classic "assembled, then dropped" shape — and it is exactly the kind of
defect that **unit tests cannot see**, because every one of them asserts that a function *returns*
the right thing, and none of them asserts that the right thing is *sent*.

**The live desk path has its own, narrower, deliberate context assembly**
(`services/trade/chatSurfaceTurn.ts:105-139` `surfacePromptWith`): mandate + skills index +
strategies + profile memory, each read fresh per turn, each block separately guarded so an
unreadable notebook costs the prompt some text rather than the answer. The design is defensible —
a *pull* model, where the model reaches deeper with `recall` / `get_notebook_map` / `read_memory`.
**But the pull model is not what the code is wired for**: the push model is fully built, fully
budgeted, fully instrumented, and disconnected.

**Three consequences, in increasing severity:**

1. **Cost and latency.** Every send pays for a retrieval it does not use — including a
   `getMemoryFilesContext` call that does similarity search and writes an injection record.
2. **The learning loop's evidence chain is corrupted (F-01b).** The app records "this run saw
   skill X"; the model did not see skill X; the outcome is credited to skill X. The documented
   cold-start contract is violated in the app's favour, and the effect is a **skill ledger that
   rewards skills the trader did not act on**. The prior audit's independent reading of the same
   code (2026-10-18) reached the same conclusion from the other end.
3. **The "hybrid intelligence" the app is named for is not in the prompt.** `hybridDataInjection` —
   the packet built from `services/analysis/HybridIntelligenceService.ts` — is computed and
   devLogged.

### 7.4 The prior audit's claims, re-verified against the pin

The previous audit (`docs/analysis/05-lead-findings.md`, dangling commit `508b691a`, authored against
HEAD `04b4d25`, 162 commits before the pin) was read in full and **every material claim was
re-checked**. Results:

| prior claim | verdict at the pin `6a41a9f7` |
|---|---|
| **No cost model anywhere** — "every R in the journal, every win rate, every calibration bucket and the entire skill ledger are gross" | **STANDS.** A repository-wide search for `slippage|takerFee|makerFee|commission|costBps|feeRate` returns three files: a warning string (`ScalpDetectionService.ts:189`), a comment (`ReinforcementSignalService.ts:50`) and the `netR` accumulator (`SkillMemoryService.ts:1431`). `netR` is the **sum of realized R multiples** (`meta.netR = round(((meta.netR ?? 0) + r) * 100) / 100`), not net of costs — so the name is misleading and the claim is correct. |
| **The ensemble weighting is inverted** — `winRate: perf.overallStats.total >= 3 ? perf.overallStats.winRate : 0`, so a provider with one loss scores 0.0 % and a provider with no trades also scores 0.0 %; the gate only requires *some* provider to have ≥5 trades | **STANDS, verbatim.** `services/backtesting/ModelPerformanceService.ts:649` — identical at the pin. The sort is at `:657`, best/worst at `:669-670`, and the moderator is told to favour the top one. **A single loss can brand a model as the worst performer, and a single lucky win the best.** |
| **The feedback loop is starved: n = 0 resolved trades** | **NOT RE-VERIFIABLE BY US** — that was measured from the owner's live profile on 2026-10-18, and the brief forbids touching a live profile. The *mechanism* is confirmed in code: confirmation is a human click (`hooks/useWatchAndAutopilot.ts:178` → `App.tsx:2372` → `confirmAutopilotOutcome`), and `markProcessed` is reached only **after** that click (`OutcomeAutopilotService.ts:650` ← `useWatchAndAutopilot.ts:201`). The downstream consumers that need closed rows (auto-learn `useTradeLogging.ts:122`, the loss-similarity penalty, the skill A/B `SkillEvalService.ts:53`, `weeklyReview.ts:135` with `MIN_CLOSED_TRADES_FOR_REVIEW = 3`, the Brier calibration, `calibrationPolicy.ts:800` with `MIN_TRADES_FOR_CALIBRATION = 10`) are all correctly written and all starved of data. **Whether n is still 0 is a question only the owner can answer — see the open questions.** |
| **`finalizeVerdict` has zero production importers** | **RESOLVED.** `git grep finalizeVerdict 6a41a9f7` returns **nothing** — the function is gone. |
| **`computeContractSize` / `utils/ticketSize.ts` is test-only — "the correct, grade-tiered, fail-closed sizing module does not size anything in the running app"** | **STANDS.** `git grep computeContractSize 6a41a9f7` returns only `tests/financialMath.test.ts:10,327,336,346` and `tests/ticketMathTiers.test.ts:6,80,91,103,109,182`. **Zero production call sites.** |
| **`utils/analysisReport.ts` is test-only** | **RESOLVED** — the file no longer exists at the pin. |
| **`services/analysis/analysisResultProcessor.ts` has no production caller** | **RESOLVED** — the file no longer exists; only two comments mention it (`schemas/tradeAnalysis.ts:503`, `utils/analysisUtils.ts:1176`). |
| **`enhancedPrompt` is built and never passed to a model** | **STANDS** and is now the headline finding — see F-01. |

**One latent split-store bug the prior audit could not see, and the concurrent session fixes:**
at the pin, `hooks/analysisPipeline/memoryContext.ts:98` assembled the pipeline's bot-memory context
from `BotRegistry.list()` → the **Preferences** key `bots_v1_<user>`, while the roster the UI
actually writes lives in the **raw localStorage** key `agents_bots_v1_<user>`
(`services/agents/agentRoster.ts:73`). Two different keys in two different stores — so the bot
memory injected into the analysis context was **empty in practice** even before F-14 closed the
reader.

---

## 8. Performance

### 8.1 Startup and the bundle

**[Verified live]** the existing `dist/` build (written 2026-10-19 16:58, i.e. from the tree as it
stood shortly before the pin) measures:

| asset | size | note |
|---|---|---|
| `index-*.js` (the entry chunk) | **1,352.6 kB** | the startup chunk |
| `pdf.worker.min-*.mjs` | **1,343.6 kB** | `pdfjs-dist`'s worker — **never on the startup path**, but it is a third of the total |
| `MarkdownRenderer-*.js` | 426.8 kB | `react-markdown` + `remark-*` + `rehype-katex` + `katex` |
| `StrategiesTab-*.js` | 340.9 kB | |
| `AreaChart-*.js` | 297.0 kB | `recharts` |
| `index-*.css` | 198.1 kB | |
| `vendor-react-*.js` | 188.4 kB | |
| `Journal-*.js` | 178.2 kB | |
| `vendor-ai-*.js` | 69.2 kB | |
| **total `dist/assets`** | **6,742.4 kB** | |
| plus KaTeX fonts | ~500 kB across TTF + WOFF | shipped, for a feature most users never touch |

**[Verified live]** `dist/` is **gitignored** and **not tracked** — correct.

**Two observations.**

1. **The ratchet has drifted loose.** `.github/workflows/guards.yml` fails the build if the entry
   chunk exceeds **2,600 kB**, and its comment says *"the last measured entry chunk was ~1956 kB"*.
   The measured entry chunk is **1,352.6 kB** — roughly **48 % below** the ceiling and **31 % below**
   the figure the ratchet was calibrated against. The ratchet can no longer catch the regression
   class it exists for. *(This is the same failure mode as the lint ratchet in §10.)*
2. **The startup chunk is 1.35 MB and the app is 2,672 lines of `App.tsx`.** The code-splitting is
   good — `App.tsx` has **26 `React.lazy()` boundaries** (Automation, Settings, Journal, TradeView,
   Learn, Agents, the modals), and the comment at `App.tsx:49-53` records the previous state
   ("Previously the entire app was one ~1.73 MB chunk"). The remaining 1.35 MB is React, the
   providers, `react-markdown`/`katex`, and the eagerly-imported surfaces.

### 8.2 The eager-import hazard is real and unguarded at the source level

The `guards.yml` ratchet is the only thing standing between the repo and the regression class
`vite.config.ts` documents: *"a 363KB static chart import pulled into the eager startup graph by
one top-level import."* A **ratchet on the output** catches it only after the fact and only if
the CI job runs; it does not stop the next import. There is no import-boundary lint.

**[Verified by code reading]** the source-level guard that does exist is a **test**:
`tests/oneFactOnePlace.test.ts` and `tests/mountedAuditPanels.test.ts` cover shape, not the
eager-import graph. A `tests/noEagerHeavyImports.test.ts` that asserts "no top-level import of
`recharts` / `lightweight-charts` / `pdfjs-dist` in `App.tsx` or `index.tsx`" would be ~20 lines and
would catch the class at the point it is introduced.

### 8.3 Polling and timers — **[Verified by code reading]**

Every timer in the app, at the pin:

| interval | where | what it does |
|---|---|---|
| **1,000 ms** | `components/trade/TradeView.tsx:666` | a clock tick (`setNowMs`) |
| **2,000 ms** | `services/analysis/MarketDataService.ts:17` (`LIVE_MARK_TTL`) | the live mark cache TTL |
| **2,000 ms** | `hooks/useFuturesLiveFeed.ts:69` (`POLL_ARM_MS`) | arms the futures poll |
| **5,000 ms** | `services/analysis/MarketDataService.ts:25` (`POINT_IN_TIME_TTL`) | the point-in-time cache TTL |
| **5,000 ms** | `hooks/useFuturesLiveFeed.ts:59` (`POLL_INTERVAL_MS`) | the futures live feed |
| **5,000 ms** | `services/trade/levelWatchService.ts:91` (`PRICE_POLL_INTERVAL_MS`) | the armed price watch |
| **5,000 ms** | `components/shared/Header.tsx:93` | session refresh |
| **5,000 ms** | `components/settings/ProviderManager.tsx:88` | a tick |
| **5,000 ms** | `components/settings/SettingsMenu.tsx:254` | a sync |
| **5,000 ms** | `components/shared/AnalyzedRow.tsx:58`, `components/shared/ReasoningRow.tsx:90` | row ticks |
| **5,000 ms** | `components/trade/BiasChips.tsx:52` (`REFRESH_MS`) | the bias chips refresh |
| **10,000 ms** | `services/learning/skillSupervisor.ts:596` (`EVENT_DEBOUNCE_MS`) | the supervisor's event debounce |
| **15,000 ms** | `components/trade/TradeView.tsx:590` and `:608` | two polls |
| **20,000 ms** | `services/ui/OutcomeAutopilotService.ts:85` (`CHECK_INTERVAL_MS`) | the outcome autopilot |
| **30,000 ms** | `services/analysis/DeskToolsService.ts:311` (`TOOL_CACHE_TTL_MS`), `services/analysis/KlineService.ts:28`, `services/analysis/MarketDataService.ts:12` | cache TTLs |
| **30,000 ms** | `components/dashboards/VersionHistoryDashboard.tsx:53` | a metrics refresh |
| **60,000 ms** | `hooks/useMarketData.ts:90`, `:164`, `:171` | the market conditions poll and two connection checks |
| **90,000 ms** | `services/learning/skillSupervisor.ts:597` (`SEND_THROTTLE_MS`) | the supervisor's send throttle |
| **300,000 ms** | `services/analysis/CorrelationRiskService.ts:18` (`DOMINANCE_CACHE_TTL`) | a cache TTL |
| **600,000 ms** | `services/analysis/CorrelationRiskService.ts:22` (`LEVELS_CACHE_TTL`) | a cache TTL |
| **10 minutes** | `services/learning/sessionSkillReview.ts:306` (`RESOLVER_THROTTLE_MS`) | a throttle |
| **15 minutes** | `hooks/useLearningHeartbeat.ts:70` (`LEARNING_HEARTBEAT_MS`) | the learning sweep |
| **30 minutes** | `services/infrastructure/BackupService.ts:34` (`AUTO_BACKUP_INTERVAL_MS`) | the auto backup |
| **1 hour** | `services/agents/botMailbox.ts:33` (`DM_ENVELOPE_TTL_MS` = 15 min) | envelope expiry |
| **6 hours** | `hooks/useModelCatalogRefresh.ts:26` (`SWEEP_INTERVAL_MS = 6 * 3_600_000`) | the model-catalog sweep |
| **7 days** | `services/learning/weeklyRollup.ts:36` (`ROLLUP_INTERVAL_MS`) | the weekly rollup |
| **14 days** | `services/learning/sessionSkillReview.ts:308` (`OPEN_THESIS_TTL_MS`) | thesis expiry |
| **30 minutes** | `services/analysis/toolArtifactStore.ts:46` (`ARTIFACT_TTL_MS`) | the artifact store |

**Two things stand out.**

- **The 1-second clock in `TradeView.tsx:666` re-renders the whole trade surface every second.**
  A `setNowMs(Date.now())` in a component with a 1,100-line body (and a chart, and an order book,
  and a transcript) is a full re-render per second, for the lifetime of the surface. It is very
  likely the single largest avoidable render cost in the app. **[Unverified — needs a React
  DevTools profiler run]** whether the components below it are memoised.
- **Every timer is inside a `useEffect` with a cleanup**, which is the correct pattern and is
  applied consistently across the ~22 sites. No leaks were found by reading. **[Unverified — needs a
  runtime check]** that every path returns its handle.

### 8.4 Network call volume

Per turn, the desk path issues: 1 provider request per round, up to 8 rounds; plus 3 tool calls
per round, each of which may hit Binance. **The tools are cached for 30 s** (the 11 cacheable
tools), so a burst of turns does not multiply market-data traffic — but `get_price_snapshot` is
**deliberately not cached** (`:379-382`), so it hits Binance every time.

The provider request **re-sends the whole message array each round** (§5.6). That is inherent to the
API shape, but it means the cost of a long tool loop is quadratic in the number of rounds.

### 8.5 Memory growth

The caches that grow with use, and their bounds:

| cache | bound | where |
|---|---|---|
| the desk tool cache | 200 entries, oldest-first eviction | `DeskToolsService.ts:321-328` |
| the tool artifact store | 30-minute TTL | `toolArtifactStore.ts:46` |
| the in-flight gate scans | one per plan id | `proposalGate.ts:88-102` |
| the settled-trade guard | 2,000 ids | `SkillMemoryService.ts:3305-3308` |
| the autopilot's tracked ids | 2,000 | `OutcomeAutopilotService.ts:113` |
| the correlation caches | 5 min / 1 min TTLs | `CorrelationRiskService.ts:18,22` |

**All of them are bounded.** That is a deliberate and well-executed part of the design. The
**unbounded** growth is on disk, and it is handled by the notebook's refusal-to-grow policy
(§2.4) and by the export caps.

---

## 9. UX and accessibility

### 9.1 The shell

The app is **four surfaces** — `useSurface.ts`'s `VALID` array is `['trade', 'journal', 'agents',
'learn']` — chosen from a rail (`components/shell/NavRail.tsx`) with a title-bar switch
(`components/shell/SurfaceSwitch.tsx`) and keyboard shortcuts `Alt+1..5` (`SURFACE_ITEMS`).

**[Verified by code reading]** `hooks/useSurface.ts` declares
`export type AppSurface = 'chat' | 'trade' | 'journal' | 'agents' | 'learn';` but the `VALID` array
has only four members. **`'chat'` is in the type union and can never be a valid stored value** — it
is a migration case only (the old Chart AI dock). The type should not carry it.

`components/shell/SurfaceSwitch.tsx` reads `SURFACE_ITEMS` from `SurfaceMenuList` rather than
declaring its own list — "the drift this repo keeps hitting is a second copy of the destination
set." Correct, and worth keeping.

### 9.2 The doctrine is written down, and the code largely follows it

`docs/ui-doctrine.md` (7,901 bytes) exists and is specific: no sliding `.seg-thumb`, no `z-50`
outside a ladder, one `SurfaceHeader` grammar, `EmptyState` with an `action`, radius tokens,
`bg-surface-page`, amber = attention and cyan = live/data, and a brand gradient reserved for the
wordmark.

**[Verified by code reading]** the doctrine is followed where it is explicit — the brand gradient
is used for the wordmark and the active-nav indicator; the surface switch uses a pressed state
rather than a sliding thumb, with the reason written down in the file.

**But the roadmap's own audit says the doctrine is not enforced** — and the roadmap items
`R-035` ("radius tokens — write the gate first, then sweep 650 sites"; *"no test gates it at
all"*), `R-042` (*"17 `EmptyState`, **0 pass `action=`**"* — *"the single cheapest 'powerful'
win"*), `R-043` (*"buttons that never render"*), `R-045` (*"20 `fallback={null}`"*) and `R-056`
(*"7 legacy `z-50`"*) are all **still needed** at the pin. **A doctrine without a gate is a
suggestion.** This is the largest single UX cluster in the roadmap and it is not covered by the
cleanup in Report 4.

### 9.3 Accessibility: what is there and what is not

**[Verified by code reading]**

**Present and good:**

- `role="group"` + `aria-label="Screens"` on the surface switch; `aria-current="page"` on the
  active surface; an `aria-label` that carries the badge, the detail and the shortcut.
- `hooks/useFocusTrap.ts` and `hooks/useEscapeClose.ts` exist as first-class hooks — focus
  management is a deliberate concern, not an afterthought.
- `components/shared/ErrorBoundary.tsx` exists, and the crash breadcrumb is persisted.
- `role="status"` on the typing indicator (`components/chat/GroupChatView.tsx:384`).
- `aria-label` on the chart-related controls.

**Absent or partial — and these are the roadmap's own findings, re-verified at the pin:**

| gap | evidence | roadmap id |
|---|---|---|
| **No `EmptyState` offers a next action** | 17 `EmptyState` call sites, **0** pass `action=` | R-042 |
| **Focus restore after a modal closes is missing** | — | R-026 |
| **The chart has no `role="img"`, no `aria-label`, no hidden summary** | deferred | R-028 |
| **Native `<select>` survives in 22 places across 12 files** instead of `SelectMenu` | — | R-039 |
| **~30 controls carry shortcut hints on a raw `title=`** instead of the `Tip` component (which is used in 3 files) | — | R-038 |
| **Modal keyboard behaviour is untested** | the `render-probe` Tab-focuses editable fields and reads back the computed focus indicator, but the unit suite cannot see a stylesheet | R-018 (shipped), the *restore* half is R-026 |

**[Unverified — needs `npm run render-probe`]** the actual computed focus indicator. The
`render-probe` is described in `AGENTS.md` as the only gate that can see `index.css`, because jsdom
mounts markup without resolving a stylesheet. That gate was **not run** in this audit.

### 9.4 Copy that promises what the code no longer does

**[Verified by code reading]** — see Report 4 §4 for the full list. The most user-visible:

- `constants/prompts/lensRolePrompts.ts:20,38,57,111,115,116` still tells the Lens seats to
  *"Consume Macro and Technical"* and describes a **three-analyst desk**. The three-analyst desk is
  gone; the Lens feature is not. These prompts are **live at the pin** and are orphaned the moment
  the concurrent change lands.
- `services/agents/seatPersonas.ts` — the general analyst is told to *"use your desk tools … and
  web search before reasoning"*, but the bot surface **has no tools at all** (P4 in §3.2 is
  deliberately tool-less, `useAnalysisPipeline.ts:1317-1320`). **The seat is told to use tools it
  does not have.**
- `AGENTS.md`'s project tree lists `services/research/` — which does not exist.
- `constants/version.ts`'s comment says the fallback literal is "kept synced with package.json" —
  it is five minor versions behind (F-19).

### 9.5 Mobile

`android/` is the Capacitor host; the renderer is the same code. `capacitor.config.ts` sets
`https` and cleartext off, and the app uses the SQLite and Filesystem plugins natively. There is
**no separate mobile layout** — the phone gets the desktop layout in a phone-sized viewport.
`electron/main.cjs:953-954` sets `minWidth: 800, minHeight: 600` for the desktop window, so the
desktop app cannot be resized into the degraded state the comment describes — but that constraint
does not exist on Android.

---

## 10. Quality gates

### 10.1 What the gates are, and what they actually enforce

| gate | command | what it enforces |
|---|---|---|
| type check | `npm run typecheck` | `tsc --noEmit` over `**/*.ts` and `**/*.tsx` |
| type check (scripts) | `npm run typecheck:scripts` | `tsc -p tsconfig.scripts.json` — **`scripts/**/*.ts` only, which is ONE file** (`scripts/test-candle-history.ts`) |
| type check (Electron) | `npm run typecheck:electron` | `node --check` on `electron/{main,preload,sseParser}.cjs` |
| flow-doc anchors | `npm run check-flow-doc-anchors` | the doc line-number gate, 58 KB of CJS |
| tests | `npm run test` | vitest, 479 files |
| tests + coverage | `npm run test:coverage` | the same, with the four ratchet floors |
| lint | `npm run lint` | `eslint . --max-warnings 889` |
| e2e smoke | `npm run e2e` | Playwright, 1 spec |
| build | `npm run build` | `tsc --noEmit && vite build` |
| boot probe | `npm run boot-probe` | the production bundle boots, zero pageerror |
| render probe | `npm run render-probe` | **rendered row counts, inert controls, zero pageerrors** |
| skill-approval probe | `npm run skill-approval-probe` | **real clicks, notebook bytes after each** |
| installer smoke | `npm run installer-smoke` | the packaged exe, release-only |
| release signature | `node scripts/verify-release-signature.cjs` | release-only, **not exposed as an npm script** |

CI (`.github/workflows/ci.yml`) runs: typecheck → typecheck:scripts → check-flow-doc-anchors →
typecheck:electron → test:coverage → lint → e2e → build → boot-probe → render-probe →
skill-approval-probe, plus a **non-blocking** `teardown-race-hunt` diagnostic job.

`guards.yml` runs the deterministic gates CI does not: `node --check` on every `scripts/*.cjs` and
`electron/*.cjs`, a separate narrow lint config for the probe scripts, a shell-declaration check
for the workflows, and the **entry-chunk size ratchet**.

`release.yml` runs the same chain **minus `check-flow-doc-anchors` and `skill-approval-probe`**,
plus `installer-smoke`, the signature check, the update-manifest check, and the publishing.

**[Verified live]** the ci-vs-release set difference is exactly
`{installer-smoke}` in release only and `{check-flow-doc-anchors, skill-approval-probe, test, typecheck}`
in ci only. **`AGENTS.md`'s claim is accurate.**

### 10.2 The measured state of the gates

| measurement | value | how |
|---|---|---|
| **lint warnings** | **682** (0 errors) | `npm run lint:loose` in a throwaway copy |
| **the lint ratchet** | `--max-warnings 889` | `package.json` |
| **the ratchet's slack** | **207 warnings** | 889 − 682 |
| **eslint suppressions in source** | **3**, all `eslint-disable-next-line` | a repo-wide grep of every non-test `.ts`/`.tsx` |
| **vitest** | **479 files, 0 failed; 4,741 tests: 4,730 passed, 11 skipped** | `npm run test` in a throwaway copy (456 s) |
| **the 2 file failures in a copy without `.git`** | **artefacts** — `tests/noSparkles.test.ts` (3 tests) and `tests/sharedPolicyEsmExports.test.ts` (4 tests) shell out to `git ls-files`, which fails outside a git repository; `noSparkles` dies at import and contributes 0, `sharedPolicyEsmExports` contributes 1 failure. **Measured directly:** in a `git init`-ed copy of the pin, `noSparkles` collects **3** tests and `sharedPolicyEsmExports` **4**, all passing | the error text is `fatal: not a git repository` |
| **the 11 skips** | all in `tests/lensWordCount.measure.test.ts`, which is gated behind an env flag by design (`tests/lensWordCount.measure.test.ts:7-8`) | read |
| **the skip/only markers in the suite** | **8** | a repo-wide grep for `.skip(`, `it.only(`, `describe.only(`, `xit(` |
| **`AGENTS.md`'s "4741 tests in 479 files"** | **stale by 3** — the measured figure is **4,738** | see above |
| **the coverage floors** | lines 36 / statements 28 / functions 36 / branches 30 | `vitest.config.ts:81-86` |

### 10.3 The two ratchets that no longer bind

This is the most important quality-gate finding, and it is the same shape twice.

**The lint ratchet.** `eslint.config.js:111-133` documents the history honestly: *"the cap sat at
1020 while the tree stood at 949, so 71 warnings could be added and CI would still pass. That is
why `tests/hookDestructureHygiene.test.ts` had to exist — the repo was hand-rolling a
dead-binding guard because the installed AST rule that already does the job was gated by a cap
with slack in it. The guard was removed when the cap was corrected."* It was corrected to 889.

**The tree now stands at 682.** So the cap has **207 warnings of slack** — a *new* warning cannot
fail CI, exactly as before. The corrective cycle has to be repeated. The file's own instruction —
*"Re-measure on a clean checkout after touching this file, and LOWER the number when you pay
warnings down; never raise it to go green"* — is the procedure, and it has not been run since.

**The bundle-size ratchet.** `guards.yml` fails the build if the entry chunk exceeds 2,600 kB,
with the comment that the last measured entry chunk was ~1,956 kB. The measured chunk is
**1,352.6 kB** — 31 % below the calibration point and 48 % below the ceiling. The ratchet can no
longer catch the 363 KB-eager-import regression it was written for.

**The pattern:** two numeric ceilings, both set from a measurement, both left behind by the
measurements, neither auto-lowering. A ratchet that only goes down by hand is a ratchet that
eventually stops binding. **The fix is mechanical: re-measure, lower the number, and add a CI step
that fails when the measured value is *below* the recorded ceiling by more than a threshold** —
i.e. a ratchet that ratchets itself.

### 10.4 TypeScript strictness

`tsconfig.json`:

| option | value | note |
|---|---|---|
| `strict` | **true** | |
| `noImplicitAny` | true | implied |
| `strictNullChecks` | true | implied |
| `noUnusedLocals` | **false** | **this is why dead imports are invisible to `tsc`** |
| `noUnusedParameters` | **false** | |
| `noUncheckedIndexedAccess` | not set | off |
| `exactOptionalPropertyTypes` | not set | off |
| `noImplicitReturns` | not set | off |
| `noFallthroughCasesInSwitch` | not set | off |
| `skipLibCheck` | true | standard |
| `allowJs` | true | this is how `tests/sseParser.test.ts` reaches `electron/sseParser.cjs` |
| `include` | `**/*.ts`, `**/*.tsx` | **does not match `.cjs`** — the main process and preload are outside `tsc` |

**`noUnusedLocals: false` is the single most consequential line in the file for this audit.** The
dead import at `hooks/useAnalysisPipeline.ts:14` (`defaultToolsForRole`) survives CI because of it,
and so does the import-but-never-called `buildHybridEnvelope` at `:66`. Turning it on is a
one-line change with a predictable error list; that error list is, in effect, the dead-code
manifest this report had to build by hand.

**The `electron/` gap is real and is documented.** `AGENTS.md` says it plainly: *"`npm run typecheck`
does not read the main process or preload — a syntax break in `electron/main.cjs` passes tsc, passes
vitest, and only fails when a user launches the packaged app."* The compensating gate
(`npm run typecheck:electron`, wired into CI and the release gate) is `node --check`, which is
**syntax only** — it cannot catch a typo in an IPC channel name, a missing handler, or a wrong
argument shape. The repo compensates further with `tests/electronIpcContract.test.ts` and
`tests/desktopUsageBridge.test.ts` (cited in `guards.yml`'s header).

### 10.5 What the tests cover, and what they cannot

**479 test files, 4,738 tests, 79,154 lines of test code against 134,247 lines of source.** That
is a genuinely thorough suite, and the depth is real: the gate, the outcome engine, the schema
coercion, the notebook's memory budget and write-failure path, the backup/import round trip, the
prompt-wiring census, the export/localStorage allow-list, the CI/release script-set difference,
and the workflow-shell check all have dedicated suites.

**The structural limits, which the repository itself documents and which this audit confirms:**

1. **jsdom cannot see a transcript.** A defect that only shows when a *list* of messages renders
   passes the whole suite green. `AGENTS.md` names two panels that shipped unmounted for exactly
   this reason. `npm run render-probe` is the only gate that counts rendered rows.
2. **jsdom cannot see a stylesheet.** The computed focus indicator, the theme tokens and the
   contrast are invisible to the unit suite. `render-probe` is the only gate that can read them.
3. **A source-shape gate is not a reachability gate.** `tests/promptsAreWired.test.ts` proves every
   registry id has a `getPrompt()` call site. It does **not** prove the prompt is ever *sent* — and
   F-10 and F-01 are exactly that gap: prompts that are wired to a call site which is itself only
   reachable from the skill-eval harness, and context that is assembled and dropped.
4. **The dead-code class is invisible.** `noUnusedLocals: false` plus a warn-only lint rule under a
   slack cap means an unused import, an unused export and an orphaned module are all silent.

### 10.6 Critical paths with no test

| path | status |
|---|---|
| `electron/main.cjs` (1,362 lines) | **no type checking**; `node --check` only. Partial coverage via `tests/electronIpcContract.test.ts` and `tests/desktopUsageBridge.test.ts` |
| `electron/preload.cjs` (52 lines) | the bridge is contract-tested; the 15 methods are not individually tested |
| `scripts/*.cjs` (~6,200 lines) | **no type checking**; `node --check` + a narrow lint config in `guards.yml`. Only `tests/workflowShells.test.ts` and `tests/releaseIsCiOnly.test.ts` reach them |
| `services/infrastructure/Preferences.ts` | `tests/serializedPrefs.test.ts` exists; the native/web split is not covered |
| backup → export → import round trip | `tests/infrastructure/backupImportRoundTrip.test.tsx` and `tests/exportService.test.ts` exist ✅ |
| the migration layer | `SqliteService.runMigrations` is not directly tested for the "version recorded only on full success" behaviour |
| the notebook write-failure path | `tests/memoryNotebookWriteFailure.test.ts` exists ✅ |
| **"the Agents roster is NOT seeded"** (the behaviour `395f73db` introduced) | **no test** — `tests/teamRoster.test.ts` was deleted in the in-flight tree and nothing replaced it |
| the surface that the trader actually uses | the chat surface's prompt assembly (`chatSurfaceTurn.ts:105-139`) has no test that the *blocks* are present in the sent system prompt |

---

---

## 11. Supplement — the security, reliability and performance detail

A second pass (a separate read-only thread) went deeper into `electron/`, the retry layer, the
notebook's write path and the render path. Everything below is additional to §6–§10, not a
restatement. **All citations are at the pin.**

### 11.1 Security — the CSP permits an origin the code deliberately does not use

**[Verified by code reading]** `index.html:21-22` is the **only** CSP (there is no header, and the
`app://` handler cannot add one — it returns `net.fetch(file://)` verbatim). The policy allows
`https://s3.tradingview.com` in `script-src` and `https://s3.tradingview.com`,
`https://www.tradingview.com`, `https://tradingview.com` in `frame-src` and `img-src`.

**But the code does not use the widget.** `components/trade/TradingChart.tsx:4` says *"Deliberately
NOT the embed widget: an iframe from s.tradingview.com is…"*, and `components/market/LiveMarket.tsx:6`
says it runs its **own** WS/REST transport. Meanwhile `index.html:14-15` says *"plus the TradingView
widget loader (Live Market / Trade chart)"* and `:19` says *"frame-src: TradingView's chart iframe"* —
**the comment claims the opposite of the code.**

**⇒ Removing `s3.tradingview.com` / `www.tradingview.com` / `tradingview.com` from `script-src`,
`frame-src` and `img-src` is a free, zero-functional-cost fix** that closes the only remote-script
hole *and* makes the CSP and `PRIVACY.md` truthful. It is the single cheapest security improvement
in this report. See Report 2 §E-21.

### 11.2 Security — the IPC surface has no sender-frame validation

**[Verified by code reading]** all 11 IPC channels were enumerated with their validation status:

| channel | handler | sender frame validated? | args validated? |
|---|---|---|---|
| `update:check` | `main.cjs:1149` | **no** | n/a |
| `update:download` | `:1161` | **no** | n/a |
| `update:install` | `:1173` | **no** | guarded by `status === 'downloaded'` |
| `update:get-status` | `:1217` | **no** | n/a |
| `app:get-version` | `:1219` | **no** | n/a |
| `provider:discover` | `:1221` | **no** | ✅ URL policy |
| `provider:chat` | `:1240` | **no** | ✅ URL policy, messages coerced, model non-empty, unknown format throws |
| `provider:cancel` | `:1263` | **no** | ✅ `typeof requestId === 'string'` |
| `crypto:encrypt` | `:1279` | **no** | ✅ string + `isEncryptionAvailable()` |
| `crypto:decrypt` | `:1289` | **no** | ✅ `enc:v1:` prefix |
| `update:quit-now` (`on`) | `:1213` | **no** | guarded |

**⇒ not one handler validates `event.senderFrame`.** Practical exposure today is low (one window,
a local origin, `will-navigate` blocks off-origin navigation), but a one-line
`event.senderFrame !== mainWindow.webContents.mainFrame` guard per handler closes it — **and it
matters precisely because §11.1 leaves a remote iframe origin permitted.**

**Two things that are right and should not be broken:**

- **There is no filesystem IPC at all, and no `path.join` with user input anywhere in `main.cjs`.**
  Every `path.join` uses a fixed name (`window-state.json`, `LEGACY_PRODUCT_NAME`,
  `.migrated-to-august-trading`, `preload.cjs`, `favicon.ico`). **A compromised renderer cannot
  read or write arbitrary files, and cannot escape `dist/` via the `app://` handler.** The
  traversal check is sound **including the Windows `%5c` bypass**: `path.relative` yields `..\..\`,
  which `startsWith('..' + path.sep)` catches → 403 (`main.cjs:929-937`).
- **The shared SSRF / redirect policy is real:** `shared/providerRequestPolicy.cjs:413-447`
  `fetchFollowingSafeRedirects`, max 3 hops, **every hop re-validated**, used identically by the
  renderer, the Vite dev proxy and `main.cjs:230`.

**Three smaller items:**

- **The provider URL policy allows the link-local range `169.254.0.0/16`**
  (`providerRequestPolicy.cjs:255,271`) — **that is the cloud-metadata range** — while
  `PRIVACY.md:84-87` says cloud-metadata hosts are refused. That is true for `toolForge` and false
  for the provider policy.
- **The preload bridge hands the renderer the decrypted key** (`decryptSecret` is a general
  decryptor; the key then travels over IPC inside `provider:chat`). Inherent to the design, but it
  means "encrypted at rest" does not protect against a renderer-side XSS — **which is why §11.1
  matters.**
- **No API key, token, password or credential is EVER logged.** A grep for
  `console.*(apiKey|secret|token|credential)` returns one hit, a false positive
  (`utils/analysisUtils.ts:1305` matches "tokens" in a truncation message). Provider error paths log
  **name / format / status only** (`main.cjs:1228-1232`, `:1247-1253`;
  `GenericProviderService.ts:1216`), and `:1205-1210` explicitly sanitises raw SDK error text
  because it "may echo the user's prompt". **✅**

### 11.3 Reliability — two silent data-loss swallows

**[Verified by code reading]**

- **`App.tsx:2000` — `void createBackup(activeUsernameRef.current).catch(() => {})`.** A failed
  **auto-backup** (`services/infrastructure/BackupService.ts:34`, every 30 minutes, `:644-649`)
  produces **no signal at all**. The trader believes they have a backup cadence and learns the
  truth only when they need it. **One-line fix.**
- **`hooks/useTradeJournalActions.ts:93, 135, 379` — `void syncPatternMemory(null, …).catch(() => {})`.**
  The pattern-memory synthesis is silently lost, at three call sites.

**These are the same class as the notebook's write-failure path — which the repo handles *well***
(`MemoryFilesService.persist` records the failure, rethrows, and clears on the next success; the
failure is owned by `memoryHealth` and read by `App.tsx:28`). **The pattern is right; two
call-sites outside it do not follow it.**

### 11.4 Reliability — the retry layer is well engineered, with two honest gaps

**[Verified by code reading]** `withRetry` (`utils/apiErrorUtils.ts:195-236`):

- **max 3 attempts at every call site** (`GenericProviderService.ts:1390`, `:1419+`, `:1931`); the
  default of 4 (`:198`) is never used.
- retryable = `rate_limit` / `network` / `server` only; **`timeout` is deliberately NOT retryable**
  (`:116-120`) — this replaced a 3 × 300 s ≈ **15-minute** desktop hang.
- backoff `min(2000 · 2^n, 30000)` with **equal jitter**; the `Retry-After` branch is capped at a
  30 s base plus up to +50 % jitter (≤45 s). **Jitter is always on** — parallel seats must not wake
  in lockstep.
- the SDK's own `maxRetries: 0` (`GenericProviderService.ts:515`) prevents a 3 × 3 multiplication.
- the degrade ladder advances only on 400/422, so a healthy gateway issues **exactly one** request.
- **worst case per logical call ≈ 450 s** (3 × 120 s + 2 × 45 s).
- **mid-stream failures are NOT retried** (only the stream *open* is) — replaying a partially-painted
  answer would duplicate transcript text. **✅ correct.**

**Two gaps:** (a) **a retry is not idempotent** — a network failure *after* the provider accepted
the request re-bills, and there is no idempotency key. (But a retry **cannot** duplicate a journal
write: the write is downstream of the resolved promise.) (b) `parseAPIError` classifies any message
containing "exceeded" as a quota problem (`apiErrorUtils.ts:44`) → non-retryable **and** a misleading
*"quota exceeded, switch provider"* message for, say, a length error.

### 11.5 Reliability — six `fetch` calls with no client-side timeout

**[Verified by code reading]** the other 12 product fetches all carry 120 s / 300 s / 15 s caps.
These six do not: `services/providers/GenericProviderService.ts:1306` and `:1474` (the dev proxy),
`services/infrastructure/ProviderConfigService.ts:488` (the dev proxy),
`services/ui/PriceAlertService.ts:424` (live Binance),
`services/trade/markPricePoll.ts:19` (live), and
`services/analysis/DeskToolsService.ts:1667` (the DuckDuckGo HTML fallback).

### 11.6 Reliability — `getPreferenceObject` conflates "missing" with "corrupt"

**[Verified by code reading]** `services/infrastructure/PreferencesService.ts:109-117` returns
`null` for both a missing key and an unparseable one. **Any caller that treats `null` as "empty"
and writes a default destroys a corrupt-but-recoverable blob.** Only
`services/learning/MemoryFilesService.ts:145-176` defends (a raw read, and *"leave the stored
blob UNTOUCHED"*). **Every other caller has no guard.**

### 11.7 Reliability — the notebook's pressure classifier has two dead branches

**[Verified by code reading]** `services/learning/MemoryFilesService.ts:443-448` defines three
kinds for `notebookPressureAllows` — `'newFiles'`, `'appends'`, `'all'` — but **the only call site
(`:690`) passes `'newFiles'`.** So `'appends'` and `'all'` are **dead branches**: **at the hard
cap the notebook still accepts appends and updates**, and `utils/memoryBudget.ts:40-43` ("appends
still land") contradicts the module's own doc at `:439-442` (*"`all` refuses every model write"*).

**⇒ the hard cap does not do what the docs say it does.** This is the repo's own *"reader without
a writer"* pattern, now in the docs.

### 11.8 Reliability — the notebook is one replace-in-place blob with no recovery affordance

**[Verified by code reading]** `services/learning/MemoryFilesService.ts:250`. A corrupt blob serves
an **empty notebook** with only a `console.warn` (`:173`). There is no version, no checksum and no
recovery affordance — **a `.corrupt.<ts>` sidecar or a backup/restore path would convert an
unrecoverable-looking loss into a recoverable one.**

Related: **only the notebook has a byte budget.** The raw `localStorage` stores
(`profile_memory_v1_*`, `learning_rules_v2_*`, `agents_*_v1_*`, the calibration/performance/confluence
stats) have **no size cap** and **share the same origin quota** — one of them can starve the
notebook's 2 MiB budget.

**✅ What is right:** **SQLite writes ARE atomic** (`SqliteService.ts:557` `BEGIN`, `:668` commit,
`:676-682` `ROLLBACK` guarded by `transactionOpen`; `SqliteServiceHelpers.ts:34-39` funnels every
transactional writer through one chain so one flow's `ROLLBACK` cannot undo another's uncommitted
writes). IndexedDB uses `db.transaction(...)` throughout. The legacy `userData` rename is careful
(`main.cjs:49-77`: packaged-only, never clobbers, `renameSync`→`cpSync` fallback, a one-time stamp,
a boot-safe catch).

### 11.9 Performance — the root re-renders once per animation frame during a stream

**[Verified by code reading]** `App.tsx` uses `chatStore` through `useSyncExternalStore`
(`App.tsx:2`), and `hooks/analysisPipeline/streamThrottlers.ts:72` throttles the deltas to one
update **per frame** — but a **2,672-line root re-rendering at 60 Hz**. The leaves are memo'd
(`AgentsView:1550`, `Journal:383`, `TradeLogContent:772`, `StrategyStudio:782`,
`WinRateDashboard:603`) — but the **root** is in the hot path. A memo'd transcript subscribing to
the store directly would take the root out of it.

**Two smaller render costs:** the root holds **100+ state values** and all 75 memos re-check on
every change; `approvalItems` (`App.tsx:1840`) is **O(trades) per trade change**; `botStats`
(`:1861`) is a synchronous computation inside a `useMemo`.

### 11.10 Performance — up to 400 live intervals in one conversation

**[Verified by code reading]** `components/shared/AnalyzedRow.tsx:58` and
`components/shared/ReasoningRow.tsx:90` each run their **own** `setInterval` **per row** — so a
200-message conversation holds **up to 400 live intervals**, each re-rendering its own row. **They
need one shared ticker.**

**And the 1-second clock** (`components/trade/TradeView.tsx:666`) re-renders the whole trade
surface every second (Report 2 §E-16).

**And `backgroundThrottling: false`** (`electron/main.cjs:970`, deliberate and correct for price
feeds) also keeps every **UI** clock running at full rate in a hidden window. **The price feeds
need to run in the background; the UI clocks do not.**

### 11.11 Performance — every notebook write serialises the blob twice

**[Verified by code reading]** `services/learning/MemoryFilesService.ts:250` (`JSON.stringify` for
the write) **and** `:405` (`bytesOf(JSON.stringify(memoryCache))` for the size), and the index is
rebuilt at `:243` → `:567-599`. **At the 1.5 MiB trigger tier, a 5-file post-mortem burst means 10
full serialisations of a multi-megabyte object on the main thread.** The measurement can reuse the
string the write just built.

**✅ What is right:** the notebook is read **once** into a module-global cache
(`MemoryFilesService.ts:151-161`); later reads are in-memory (`:194`). **No per-keystroke and no
per-render network calls anywhere.** Steady state is ≈ 20–30 requests/minute of public market data.

### 11.12 Quality gates — three more measured facts

**[Verified live]**

- **`electron/main.cjs` (1,362 lines) has ZERO behavioural test coverage.** The largest untested
  surface in the app. `tests/electronIpcContract.test.ts` is **pure string analysis** (`:26-37`
  `readFileSync` + regex); `tests/providerRequestPolicy.test.ts:263-274` asserts that `main.cjs`
  *contains the string* `require(...)`; `tests/reasoningSideChannelParity.test.ts:17` and
  `tests/desktopUsageBridge.test.ts:19` read `main.cjs` **as text**.
  `tests/sseParser.test.ts` is the **only** file that executes electron code. **The `app://`
  traversal check, the navigation rules, the permission-denial handler, the `safeStorage`
  round-trip, the `provider:chat` body construction and the degrade chain are all untested at
  runtime** — the file is outside `tsc` (`tsconfig.json:31`) and outside coverage
  (`vitest.config.ts:91`), and the only gate is `node --check`, which **parses and proves nothing**.
- **There are ZERO snapshot tests** — no `.snap` file, no `toMatchSnapshot`, no
  `toMatchInlineSnapshot` anywhere. **No brittle snapshots. ✅**
- **The eslint suppression profile is very clean:** 23 `eslint-disable` directives in total, of
  which **only 3 are in product code** (2 `no-control-regex` in `utils/sanitizers.ts`, 1
  `no-require-imports` in `hooks/useAnalysisPipeline.ts`); by rule: 13 `no-explicit-any`, 4
  `no-console`, 3 `no-require-imports`, 2 `no-control-regex`, 1 `no-useless-assignment`.

**Two corrections to claims this audit had itself made:**

- **`eslint.config.js:124`'s "28 unused LOCAL declarations remain there [in `App.tsx`]" is stale —
  it is 13**, across 11 statements (plus 5 unused imports: `Conversation` `:8`, `ChevronDownIcon`
  `:47`, `CloseIcon` `:47`, `ModelPicker` `:82`, `NavRail` `:122`). The claim's *reasoning* holds —
  each is a real `useMemo`/`useCallback`/`useState`/destructured binding — but **the number is wrong
  by 15.** **`App.tsx` is now `any`-free**: all 449 `no-explicit-any` warnings are elsewhere.
- **The 682 warnings break down as:** 449 `no-explicit-any` (65.8 %), 225 `no-unused-vars` (33.0 %),
  and **8 "unused eslint-disable directive"** warnings (4 `no-console`, 3 `no-explicit-any`, 1
  `no-useless-assignment`). **⇒ deleting those 8 dead directives gives 674, and the cap can be set
  to 674.** The 449 `any` are the real backlog, but **re-tightening the ratchet needs no code
  change at all.**

**Three more `tsconfig` facts:** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are
**absent** — `noUncheckedIndexedAccess` is the highest-value missing option, because every
`arr[0]` silently lies. `paths` (`:18-22`) is declared but **never used** — dead config.
`forceConsistentCasingInFileNames` is off, and
`services/infrastructure/ProviderConfigService.ts:10` imports
`'../../shared/providerRequestPolicy.cjs'`, which resolves only on case-insensitive filesystems —
**a latent portability break** on a Windows-only target.

### 11.13 Quality gates — ~17 test files exercise code the app never loads

**[Verified by code reading]** a module-level import graph over 529 source files and 480 test
files found **39 orphan modules** (after fixing a first-pass false positive that missed
`React.lazy(() => import(...))`).

- **7 files import only orphan modules → 5 test genuinely dead app code:**
  `tests/probabilityEngine.test.ts` and `tests/lazySurfaceSkeletons.test.ts` →
  `services/analysis/ProbabilityEngineService.ts`; `tests/ticketMathTiers.test.ts` →
  `utils/ticketSize.ts`; `tests/seriesPalette.test.ts` → `utils/seriesPalette.ts`;
  `tests/incrementalMarkdown.test.ts` → `utils/incrementalMarkdown.ts`. (The other two,
  `verifyReleaseSignature` and `workflowShells`, target script entry points — legitimate orphans.)
- **12 more import at least one orphan:** `accuracyValidation` → `TradeValidationGate`;
  `backtestingKlineLadder` / `backtestingOutcomes` / `validateTradeOutcome` → `BacktestingService`;
  `convictionDrift` → `services/analysis/convictionDrift.ts`; `preRead` → `utils/preRead.ts`;
  `runStatus` / `stoppedStepReason` → `components/analysis/AnalysisProgress.tsx`; `analysisUtils` →
  `constants/schemas.ts`; `auditFixes` / `financialMath` → `utils/ticketSize.ts`; `teamRoster` →
  `utils/teamRoster.ts`.
- **Orphans with no test at all:** `services/learning/MemoryConsolidationService.ts`,
  `utils/messageDisplayText.ts`, `components/dashboards/learning/AvoidSetupsSection.tsx`,
  `lib/utils.ts`, `plugins/GallerySaver.ts`.

**⇒ And the dead code is documented as if it were live.** `AGENTS.md` describes
`services/validation/` (the TradeValidationGate) and cites `BacktestingService` as the realized-R:R
source; `utils/riskReward.ts:7,16,96` references it three times; `utils/analysisUtils.ts:409` lists
`ticketSize`; `components/journal/ThinkingRecordCard.tsx:16` points at `utils/seriesPalette`;
`services/analysis/EntryTimingService.ts:588` and
`services/backtesting/StopLossOptimizerService.ts:332` both say *"Generate a compact warning for
TradeValidationGate"*. **This is the repo's own *"reader without a writer"* pattern, now in the
documentation.** See Report 4 §4.1.

### 11.14 The security/reliability/performance findings in one list

| ID | sev | finding |
|---|---|---|
| **F-21** | **High** | The CSP permits `script-src`/`frame-src`/`img-src` origins the code deliberately does not use, **while its own comment claims it does** — a free fix that closes the only remote-script hole |
| **F-22** | **High** | No IPC handler validates the sender frame |
| **F-23** | **High** | The auto-backup failure and the pattern-memory sync failure are both swallowed silently (`App.tsx:2000`; `hooks/useTradeJournalActions.ts:93,135,379`) |
| **F-24** | **High** | The notebook is one replace-in-place blob with no version, checksum or recovery affordance |
| **F-25** | **Med-High** | `getPreferenceObject` conflates "missing" with "corrupt" — a caller that treats `null` as "empty" destroys a recoverable blob |
| **F-26** | **Med** | `notebookPressureAllows('appends')` and `('all')` are **dead branches** — the hard cap still accepts appends, contradicting `utils/memoryBudget.ts`'s own doc |
| **F-27** | **Med** | The root re-renders at 60 Hz during a stream; up to 400 per-row `setInterval`s; a 1-second whole-surface clock; `backgroundThrottling: false` keeps UI clocks alive in a hidden window |
| **F-28** | **Med** | Every notebook write serialises the whole blob **twice** and rebuilds the index |
| **F-29** | **Med** | Six `fetch` calls with no client-side timeout; a retry is not idempotent; "exceeded" is misclassified as a quota error |
| **F-30** | **Med** | The provider URL policy allows the `169.254.0.0/16` cloud-metadata range |
| **F-31** | **Med** | `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are off; `paths` is dead config; `forceConsistentCasingInFileNames` off is a latent portability break |
| **F-32** | **Med** | `electron/main.cjs` (1,362 lines) has **zero** behavioural coverage |
| **F-33** | **Low** | `setPermissionCheckHandler` is not set (sync permission checks stay permissive); the dev proxy is unauthenticated and CORS-reachable |
| **F-34** | **Low** | The raw provider error body's first 200 chars are embedded in a persisted error message (`GenericProviderService.ts:1335`, `:1503`) |
| **F-35** | **Low** | `warmProviderConnection` HEADs the provider origin from the renderer — revealing which provider is in use |
| **F-36** | **Info** | 1,465 kB of KaTeX fonts ship with no preload hint; the 1.3 MB pdfjs worker has no progress indication |
| **F-37** | **Info** | `migrateLocalStorageToPreferences`'s second pass has no allow-list (unlike `ExportService`'s restore allow-list) and copies *every* localStorage key |
| **F-38** | **Info** | `window-state.json` is written non-atomically (harmless) |
| **F-39** | **Info** | `playwright.config.ts` sets `reuseExistingServer: true` — a stale dev server on :3000 would be silently reused (a possible false green) |
| **F-40** | **✅ positive** | **No filesystem IPC, no `path.join` with user input, a sound `app://` traversal check (including the Windows `%5c` bypass), a real shared SSRF/redirect policy with per-hop re-validation, no credential ever logged, atomic SQLite writes, a read-once notebook cache, zero snapshot tests, and a 3-of-23 eslint suppression profile.** |
