# August 3.5 — Consolidated Audit & Improvement Report

**Date:** 2026-08-08 · **Scope:** 4 parallel agent scans (bugs/logic, UI/UX, debate flow, performance) over the full repo · **Baseline verified:** `tsc --noEmit` exit 0 · 312/312 tests pass (11 skipped intentionally)

The pre-existing errors in `tsc_errors.txt` are stale (referenced pre-move paths); `SLOptimization` and `Journal` are fixed in the live tree. Everything below is a **live-code** finding with a concrete fix.

---

## 1. Critical bugs (fix first — these cost money or lose data)

### 1.1 Cross-symbol hybrid-data contamination — HIGH
`hooks/useAnalysisPipeline.ts:617-622` — `currentHybridData` is fetched only when empty, so analyze BTC → then ETH and **ETH's analysis runs with BTC's prices/ATR/regime**, and the wrong snapshot is persisted onto the new card (`:1747`).
**Fix:** `!currentHybridData || currentHybridData.symbol !== detectedCoin` on the guard, and null it at run start.

### 1.2 100× price inflation from naive parsing — HIGH
`services/validation/TradeValidationGate.ts:536-538` and `services/infrastructure/SqliteService.ts:665-670` strip non-digits from AI prices with a regex: `"94500 4h"` → `945004`. Corrupts R:R validation, ATR-distance gates, and stored `entry`/`stopLoss` columns used by backtests and filters.
**Fix:** use the canonical `parsePrice` from `utils/analysisUtils.ts` at both sites.

### 1.3 Electron provider calls: no per-attempt timeout + timeout-retry storm — HIGH
`services/providers/GenericProviderService.ts:450-475` — the Electron `providerChat` path never applies `withTimeoutSignal`; `electron/main.cjs` wraps calls in a 300s timeout whose failure message ("This operation was aborted") is mapped to `type:'network'` and retried 3×. Worst case ~15 min hang with a misleading message.
**Fix:** wrap in `withTimeoutSignal(REQUEST_TIMEOUT_MS)`; map "aborted" → `type:'timeout'`, non-retryable.

### 1.4 Kelly criterion recommends sizing on losing systems — MEDIUM
`services/analysis/MonteCarloService.ts:379-387` — negative-EV systems fall back to hardcoded `avgWinPercent = 2`, so any winRate > 1/3 yields positive Kelly (up to 100% of account).
**Fix:** return 0 when `expectedValuePct <= 0`. Also derive "average loss" from the actual distribution, not the 5th-percentile tail (`:382-384`).

### 1.5 Startup data-loss window on native — MEDIUM
`services/infrastructure/dbService.ts:43-48` — `ensureDbReady()` returns false while init is in flight; early saves route to IndexedDB and are orphaned once SQLite migration completes.
**Fix:** await `dbReadyPromise` when set; queue writes until init settles.

### 1.6 Rate-limit flag cleared by stale timer — MEDIUM
`useAnalysisPipeline.ts` (429 path) — the early-return skips `failStep()` and schedules `setIsRateLimited(false)` at 60s; a rerun inside that window can have its flag cleared by the old timer.
**Fix:** capture a run generation in the closure and check before clearing.

### 1.7 Other verified bugs
- **[MED] `GenericProviderService.ts:604`** — non-`chat_completions` fallback `sendChatRequest` sits outside try/catch; errors bypass `toFriendlyProviderError`.
- **[MED] `GenericAnalysisService.ts:387-391`** — truncation inverted: capable models get *less* pattern memory (400 chars) than small-context ones (500). Swap branches.
- **[MED] `persistentCache.ts`** — a failed `openDb()` leaves the promise permanently rejected; every later access rejects forever. Null the cached promise in catch.
- **[MED] `vite.config.ts:97-107`** — mid-stream SSE failure writes a JSON error blob into an already-flushed `text/event-stream` response, corrupting the renderer parser. In the streaming branch, just `res.end()` on error.
- **[MED] `useAnalysisPipeline.ts:~2056`** — superseded runs' real errors are mislabeled "cancelled" and vanish from user-visible state/logs.
- **[LOW] `MonteCarloService`** — no hang timeout on the singleton worker; wedged worker spins forever. `Promise.race` with ~10s sync fallback.
- **[LOW] `SelfLearningService.ts:356`** — `getSetupSpecificStats` destructures `regime` but never applies it in the filter.
- **[LOW] `SelfLearningService.ts:275`** — `'UNKNOWN'` confidence cast to `ConfidenceLevel`, invalid downstream.
- **[LOW] `GlobalLearningService.ts:88`** — in-flight `loadLearningState()` can clobber `updateCalibration()` with stale disk state.
- **[LOW] `OutcomeAutopilotService.ts:134-144 vs 446-456`** — memory keeps 2000 ids, disk persists only 500; after restart old messages become re-detectable.
- **[LOW] `KlineService.ts:139`** — `symbol.replace('USDT', '-PHP')` mangles non-`*USDT` pairs (BTCBUSD, BTC/USDT, lowercase) → silent PDAX-tier failure.
- **[LOW] `GateKeeperService.ts:273`** — `volume1h.current / volume1h.average` → Infinity when average is 0 (fresh pair).
- **[LOW] `MarketDataService.ts:544`** — genuine zero funding rate forces a second API call on every cache miss.
- **[LOW] `DataIntegrityService.ts:41`** — flags legitimate trade deletions as "potential data loss".
- **[LOW] `ConfidenceCalibrationService.ts:153`** — negative `daysAgo` (clock skew) → weight > 1.
- **[LOW] `useMarketData.ts:128`** — 1s retry timer not tracked/cleared in cleanup.
- **[LOW] `useConversations.ts:44`** — 200-message cap trims from the **head**; your opening instruction silently vanishes after 200 messages.
- **[LOW] `useTradeLogging.ts:516`** — one insight timer not registered in `insightTimersRef`.
- **[LOW] `GenericProviderService.ts`** — jsonMode retry reuses a partially-consumed timeout signal; reasoning content double-accumulated.
- **[LOW] `GenericProviderService.ts:476`** — dev proxy check misses `127.0.0.1`; `:667` assigns a string `code` to numeric `status`.
- **[LOW] `SqliteService.ts:262`** — failed migrations marked applied (message-text check only).
- **[LOW] `ProviderConfigService`** — keyless local providers (Ollama) excluded from readiness; corrupt configs get a new `legacy-<ts>` id every load.

---

## 2. Debate pipeline — the biggest opportunity

### 2.1 Two of the "three modes" are dead code — HIGH
`conductTwoWayDebate` / `conductThreeWayDebate` (`services/providers/ensembleService.ts:1033,1531`) are referenced **only by tests**. Production routes purely `isAccuracyModeEnabled ? conductDebate : conductRealDebate`. Everything living only in the dead engines is off in production:
- **Bayesian per-provider calibration** (`getBayesianCalibratedConfidence`, `:1089`)
- **Pre-debate divergence / echo-chamber detection** (`analyzePreDebateDivergence`, `:1740`)

**Fix:** port both into `conductRealDebate`'s verdict context; delete or explicitly test-only the dead engines.

### 2.2 Autoplay transcripts parsed by hardcoded speaker regex — HIGH
`useAnalysisPipeline.ts:1440-1447`, `usePostMortem.ts:338` — a provider outside the list (`Gemini|DeepSeek|Zhipu|Groq|...|Moderator|Claude|GPT|Grok...`) renders **zero turns**; "GPT"-containing names misattribute text.
**Fix:** emit machine-readable `<SPEAKER name="...">` delimiters in prompts, or route accuracy through the real turn protocol.

### 2.3 The debate hides itself — HIGH (UX)
`components/chat/MessageItem.tsx:414-441` — the transcript collapses into a "Previous debate" toggle, **default-hidden**, the moment the card lands. The product centerpiece vanishes.
**Fix:** default-expand or show a verdict-recap bar (TL;DR + N key exchanges) with the transcript one click away.

### 2.4 No mid-debate recovery — MEDIUM
`useAnalysisPipeline.ts:1372-1382`, `MessageItem.tsx:342` — a failing analyst is dropped forever; the only affordance is re-running the whole analysis (all provider calls paid twice). No swap, no drop-and-continue.
**Fix:** "replace with [ready model]" / "continue with N−1" action dispatching a fresh analyst with the transcript so far.

### 2.5 Survivor accounting dishonest — MEDIUM
`runStats.analystCount` counts analysts at debate start; mid-debate dropouts never surface, so a card can claim "3 analysts" when 2 did the work.

### 2.6 Time/cycle transparency — MEDIUM
`ensembleService.ts:2389,2663-2701` — 8-min budget only checked between rounds; the clarification **judgment** call is invisible yet costs full provider calls (up to 3 cycles). Users see unexplained waits.
**Fix:** surface "Clarification round X of 3" + remaining budget; pass the deadline down as per-stream timeout.

### 2.7 Post-mortem parsing fragility — MEDIUM
`usePostMortem.ts:377-409` — three stacked fallback heuristics for `<FINAL_REPORT_START>`; a moderator skipping the marker produces garbage.
**Fix:** mirror the real-debate contract with a compact-prompt retry.

### 2.8 "Verified" claim when verification was skipped — LOW
`ensembleService.ts:859-862` — when `verifyAccuracyPlan` errors, the card still says "Plan verified by the accuracy pass".
**Fix:** return a distinct `skipped` verdict.

### Top 5 debate UX improvements (ranked)
1. **Never hide the debate** — persistent verdict recap + expandable transcript.
2. **Make consensus explainable** — per-analyst direction/entry/SL/TP/confidence vs verdict + divergence score + echo-chamber flag (wire the dead divergence code into the live path).
3. **Mid-debate intervention** — drop / swap / "make Model X rebut that".
4. **Surviving-analyst honesty** — live "Round 2/3 — 2 of 3 streaming" + drop-out reason on the card.
5. **Time/cycle transparency** — clarification progress + remaining budget.

---

## 3. UI/UX — theme scope, accessibility, interaction defects

### 3.1 Theme-scope violations (semantic colors render gray) — P1
The design system remaps all colors to gray, restoring real colors only inside `.analysis-card, .status-surface` (`index.css:117-174`). These surfaces are missing the scope and **silently lose meaning**:
- **[P1] Settings flow** (`components/settings/*`) — no `status-surface`: ProviderManager ready-dot `bg-emerald-400` → #b0b0b6, while missing-key `bg-amber-400` → **accent blue**. "Ready" reads duller than "incomplete"; hierarchy backwards.
- **[P1] SavedAnalyses** — "Clear All"/"Delete Selected" `bg-rose-600` → dark-gray-on-dark-gray; destructive actions invisible as destructive.
- **[P2]** SavedAnalysesGallery, StrategySearch (family colors), LiveStreamView (while EnsembleProgressChat uses inline hex and renders real colors — same feature, two treatments), UpdateOverlay ("ready to install" gray), ErrorBoundary (error screen gray), ImagePreview, CustomInstructionsEditor.
- **[P2] `green-*` never restored even inside status-surface** — ModelPerformanceDashboard HOT badge, LearningDashboard render gray while COOLING/DEMOTED render colored. Add `green` to the restore block or use `emerald-*`.
- **[P2] WinRateDashboard** — real-color stat cards + deliberately gray charts; worse, `rose: '#6b6b73'` and `orange: '#6b6b73'` are **the same hex** — Low- and Avoid-confidence bars are indistinguishable.

**Fix pattern:** the exact one `EquityCurveDashboard.tsx` documents (G1) — add `status-surface` to the root.

### 3.2 Accessibility — P1
- **[P1]** Chat composer (`ChatInput.tsx`) has **no visible focus indicator** (`outline-none focus-visible:outline-none`, no label). Keyboard users can't see where they type.
- **[P1]** `aria-modal="true"` dialogs **without focus traps** (Tab escapes to background): DataCaptureModal (imports `useFocusTrap` but never applies it!), Journal aside, LiveStreamView, ScenarioSimulator, UserProfileManager, PromptEditorModal, VersionHistoryDashboard (no role/aria at all), StrategySearch drawer.
- **[P1]** Off-screen surfaces stay in tab order — StrategySearch (`translate-x-full` only, always mounted), VisionDataViewer, AdvancedAnalyticsSidePanel (`md:hidden` gate).
- **[P2]** UserProfileManager has **no dismiss path at all** — no close button, no backdrop, no Esc, not in `OVERLAY_KEYS`. Only exits: take an action.
- **[P2]** Invisible-but-focusable: ProbabilityPanel Regenerate button (whitespace only), ModelPerformanceDashboard refresh spinner (empty `<span>`), PerformanceReview delete (`opacity-0 group-hover`), UserProfileManager rows (clickable `<div>`s).
- **[P2]** Unnamed icon buttons without `aria-label`: AnalysisResult action bar (mobile `hidden sm:inline`), EnsembleProgressChat retry, VersionHistory close, StrategySearch close, ScenarioSimulator steppers.
- **[P2]** Command palette lacks `aria-activedescendant`/`aria-selected` + scroll-into-view.

### 3.3 Interaction defects
- **[P1] Esc-gate gaps** (`App.tsx:822-836`) — missing `isAdvancedAnalyticsOpen`, `isVisionDataVisible`, `showMismatchModal`, `isMobileMenuOpen`, `isStrategySearchVisible`, `isVersionHistoryVisible`: Esc while Playbook/Version-History is open **cancels a running analysis**. ScenarioSimulator double-fires too (`:180-186`).
- **[P1] Trade Log clear-all is dead** — `onClearAllTrades` exists in props (`TradeLog.tsx:17`) and is destructured (`:334`) but **never invoked**. No way to clear all trades; delete flow has no confirmation.
- **[P2]** DebateChat transport 8+ controls at `text-[9px]` (tiny targets, exempted from the 44px mobile bump); Copy has no feedback (silent catch).
- **[P2]** LiveMarket: duplicate `id="live-market-insights"`, Esc closes the whole view over the alert popover, empty icon spans.
- **[P2]** AdvancedAnalyticsSidePanel: no desktop close button, no backdrop, no own Esc; static "Enable Hybrid" footer renders even with data.
- **[P2]** Two competing alert affordances (`AnalysisResult` + `PriceAlertToggle`), toggle silent, 0.5% hardcoded.
- **[P2]** Dead copy affordance — `copiedMessageId` wired through App but no copy button ever rendered (`useJournalUI.ts:21`).
- **[P2]** Header `saveStatus === 'ERROR'` renders **nothing** — failed saves are silent.
- **[P2]** Chat composer layout jump `h-72 → h-[40rem]`; docked chips don't track composer growth.
- **[P2] Dead animation classes** — `tailwindcss-animate` is **not installed**; `animate-in zoom-in-95` etc. are silent no-ops at ConfirmDialog, Header, AdvancedAnalyticsSidePanel, VersionHistoryDashboard (5 sites).
- **[P3]** Duplicate conflicting `overflow-hidden`+`overflow-y-auto` (AccuracyModeModal, DataCaptureModal); VersionHistoryDashboard single-option dead `<select>`; DecisionRecord "High → High" pass-through.

### 3.4 Dead code / dead UI
`hooks/useAppRouter.ts` (only `wouter` consumer → **no browser-back support**), `UpdateNotification.tsx`, `TradeLog.onClearAllTrades`, Header `isLoading`/`isRateLimited`, ~15 empty icon/emoji slots, `scrollbar-thin scrollbar-thumb-*` utilities (no plugin), `tailwindcss-animate` classes.

### 3.5 Tiny text & touch targets (cross-cutting)
`text-[8px]` ×15 in HybridDataPanel, `text-[9px]`/`text-[10px]` pervasive (DebateChat transport, TradeLog, dashboards, toasts). The mobile 44px bump **exempts these exact classes**, leaving ~24-28px targets on touch devices.

### 3.6 Patterns done right (standardize these)
`EquityCurveDashboard` status-surface opt-in (G1) · `ConfirmDialog` full trap + undo (G2) · `AccuracyModeModal` trap+esc (G3) · `ToggleSwitch` switch role (G4) · `Toast` alert/status live regions (G5) · `Spinner` role=status (G6) · `ReasoningDashboard` real buttons (G7) · SettingsMenu/ProviderManager trap+dirty-state (G8).

---

## 4. Performance & smoothness

### 4.1 P1 — the four that degrade every run
1. **Per-token analyst re-render storm** (`useAnalysisPipeline.ts:1145-1155`) — `onReasoning` calls `updateEnsembleProgress` (maps over all messages) on **every streamed token, unthrottled**; 20-100 tokens/s × N analysts. The debate loop and moderator stream are already RAF-throttled — this path was missed. **Fix:** accumulate in `reasoningMapRef`, flush via the existing `useRafThrottle`; target-index the placeholder update.
2. **`chatContext` memo broken by 3 handlers** (`App.tsx:2208-2241`) — `handleSaveAnalysis`/`handleConfirmAutopilot`/`handleReRunAnalysis` close over `messages` → new context per chunk → every MessageItem re-renders → unmemoized `MarkdownContent` re-parses react-markdown per chunk. **Fix:** read from `messagesRef` (stable callbacks) + `React.memo(MarkdownContent)`.
3. **Full-profile save churn** (`App.tsx:1185-1205`) — save effect deps include `buildProfileSnapshot` (new identity per data change) → debounce never fires during debates; `setSaveStatus('SAVING')` runs per chunk (extra full render); 15s heartbeat stringifies the **entire profile incl. base64 images** on the main thread. **Fix:** dirty-section/delta writes, images in a separate store, skip redundant SAVING, dedupe heartbeat snapshots.
4. **ChatArea memo defeated by inline handlers + App-level composer state** (`App.tsx:2573-2653`, `ChatArea.tsx:513`) — every keystroke re-renders ChatArea + Virtuoso. **Fix:** `useCallback` handlers; lift composer input state into `ChatInput`.

### 4.2 P2 — major surfaces
- **Journal/ModelPerformanceDashboard churn** (`App.tsx:2442-2443`, `ModelPerformanceDashboard.tsx:343-345`) — new `enabledProviders`/`selectedModels` per render break memo → full trade-log rescan (sort comparator **allocates a Date per comparison**), localStorage write, **uncancelled** 500ms refresh → stacked refreshes while journal is open. Fix: memoize derived props, stabilize `onClose`, guard + cancel the timeout.
- **Kline serial fallback chain** (`KlineService.ts`) — one flaky source adds its full 5-8s timeout; worst case 20-30s+ before analysis starts. Fix: `Promise.any` race with staggered 2s/3s timeouts, negative-cache dead sources.
- **Bundle** — main bundle 1378.7KB eager (`dist/assets/index-v-7CfAdp.js`): react-markdown + zod + virtuoso + all services. `vendor-charts` (362KB, recharts-only) is `modulepreload`ed at startup although recharts is only reachable via lazy Journal. Fix: lazy-load react-markdown (biggest single win), split zod, drop charts from preload.
- **Image decode spike** (`utils/imageProcessor.ts`) — 12MP screenshot decodes to ~48MB RGBA before downscale. Fix: `createImageBitmap(file, { resizeWidth: 1600, resizeQuality: 'high' })`.
- **Electron** — no `ready-to-show` → blank window flash (`electron/main.cjs:295`); the `providerChat` bridge is **non-streaming** → desktop streaming is a full text dump while web streams per token. Fix: expose a streaming IPC bridge.
- **persistentCache** — full IDB cursor scan + sort on **every put**; no TTL-aware reads; stale entries served silently. Fix: TTL-aware get, lazy prune, cap payload size.
- **Header not memoized** + 5s poll + re-render per App render (`Header.tsx:46,92`).
- **useTypingEffect 10ms/word** ≈ 100 renders/s in LiveStreamView during post-mortem (`:30-50ms` is imperceptible, 3-5× cheaper).
- **N pending cards × 30s kline polls** in autopilot check (`AnalysisResult.tsx:241`) — gate on visibility / newest card only.

### 4.3 P3 — cleanup
Dead deps: **`ccxt` and `@google/genai` imported nowhere in src/** (grep-verified) — remove from package.json + manualChunks; `openai` SDK (69KB eager) could be replaced by fetch; `tsc --noEmit` → `--incremental`; `console.log` on every hybrid fetch/MC config; MonteCarlo worker hang timeout; JobQueue/OfflineQueue lack backpressure + per-job timeout; djb2 image hashing over multi-MB base64; `latestHistoricalAnalysis` re-sorts per chunk.

### 4.4 Positive findings (keep)
Debate + moderator streaming RAF-throttled/ref-accumulated; `LiveMarket` direct-DOM price updates; Virtuoso in ChatArea + TradeLog; 200-message cap; SQLite schema v5 + dirty-section fingerprint skip; all intervals cleanly cleaned up (leak sweep clean); data-integrity + backup run async post-load.

### Top 10 performance wins
1. RAF-throttle `onReasoning` flush — ends per-token storm
2. Stabilize `chatContext` via `messagesRef` + memo MarkdownContent
3. Delta-based profile saves, images out of the blob
4. Stabilize ChatArea handlers / isolate composer state
5. Fix Journal + ModelPerformanceDashboard effect churn
6. Race Kline sources (30s → ~3s worst case)
7. Drop `vendor-charts` from startup preload (−362KB)
8. Electron `ready-to-show` + streaming bridge
9. `createImageBitmap` decode-time resize
10. TTL-aware persistentCache + lazy eviction

---

## 5. New features (from the debate/feature scan)

**If I had 1 month, I'd build these 3 first:**
1. **Consensus explainability panel** — per-analyst direction/entry/SL/TP/confidence vs verdict, divergence score, echo-chamber flag, moderator-citation trace. Highest trust ROI; reuses the dead `analyzePreDebateDivergence` + `EnhancedDebateService` work; moderate risk.
2. **Mid-debate analyst replacement** — swap a dropped/stuck analyst, resume from transcript; turns double-cost re-runs into 30-second fixes; the drop-out machinery already exists in `conductRealDebate`.
3. **Price-triggered re-debate ("watch this setup")** — arm a watch on `validityDurationMinutes`/`invalidationCriteria`; compact re-debate on price touch + push. The biggest differentiator — turns "ask once" into a trading copilot.

**The rest (9 total):** per-debate cost & latency ledger · model accuracy dashboard with drift alerts · debate transcript export (MD/JSON) · live price refresh between rounds · calibration drift alerts on cards ("confidence runs hot +12pt") · post-mortem "what would I do today" re-analysis · (+ the 3 above).

---

## 6. Suggested execution order

1. **Data-integrity bugs** (§1.1-1.5) — cross-symbol contamination, price inflation, Electron timeouts, Kelly, startup writes. ~half a day, highest risk reduction.
2. **Theme-scope sweep** (§3.1) — add `status-surface` to the 8 missing surfaces; restore `green`. One-class fixes, immediately restores intended semantics. ~half a day.
3. **Debate live-path port** (§2.1) — bring Bayesian calibration + divergence into `conductRealDebate`. ~1-2 days.
4. **A11y + interaction pass** (§3.2-3.3) — focus traps, Esc gate, dead controls, clear-all. ~1-2 days.
5. **Perf P1s** (§4.1) — throttle onReasoning, stabilize chatContext, delta saves, ChatArea handlers. ~2-3 days.
6. **Debate UX + feature picks** (§2.4-2.6, §5) — consensus panel, mid-debate replacement, watch-the-setup.

*Reports produced: `performance-audit-report.md`, `UI_UX_AUDIT_REPORT.md`, this file. Read-only audits — no code changed.*
