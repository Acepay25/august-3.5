# Performance / smoothness audit — August 3.5

Scope: user-visible performance, app flow, and edge cases that break the experience (streaming, re-render storms, persistence, bundle, workers, native). Verified against `dist/` build output and current source. Severities: **P1** = actively degrades every analysis run / daily use; **P2** = degrades a major surface or edge case; **P3** = cleanup / efficiency.

---

## A. AI streaming pipeline — `hooks/useAnalysisPipeline.ts`

- **[P1] `useAnalysisPipeline.ts:1145-1155`** — the analyst `onReasoning` callback calls `updateEnsembleProgress` (defined at `:607-612`) on **every streamed reasoning token**, unthrottled. Each call maps over **all messages** and writes a new message object, so App state changes at 20–100 tokens/sec × N concurrent analysts. **Impact:** the whole chat re-renders many times per second during the analyst phase — visible stutter on every debate, CPU fan on. **Fix:** accumulate `reasoningMapRef` deltas and flush through the existing `useRafThrottle` (same pattern as the debate loop at `:323`), and/or diff only the affected analyst in the `map` rather than rebuilding every message.

- **[P2] `useAnalysisPipeline.ts:609-611`** — even one update per frame walks the whole `prev` message array (`prev.map(...)` with spread per element) under the 200-message cap → ~200 object spreads per update. **Impact:** adds to per-token cost above. **Fix:** write the placeholder message update via index-targeted splice or keep the placeholder message id stable and update it in a ref-draft.

- **[OK] Debate loop** (`:323` `throttledDebateUpdate` + final `flush`) is correctly RAF-throttled. **Moderator stream** (`:1361-1366`, `:1401-1406`) accumulates into refs and only commits at the end — no per-token re-render. **Casual chat** (`getQuickResponse`, `:2030-2049`) appends one message at completion, no streaming storm. These are the good paths to copy.

---

## B. Memo boundaries — `App.tsx` / `ChatArea.tsx` / `MessageItem.tsx` / `MarkdownContent.tsx`

- **[P1] `App.tsx:2208-2241`** — the `chatContext` useMemo deps include `handleSaveAnalysis` (`:1985-1988`, closes over `messages.findIndex`), `handleConfirmAutopilot` (`:2176-2178`, `messages.find`), and `handleReRunAnalysis` (`:1956-1958`, `messages.findIndex`). All three change identity on **every message mutation**, so `chatContext` is recreated on every stream chunk → ChatArea re-renders → every `MessageItem` re-renders (`MessageItem.tsx:118` memo compares `{message, context}` and loses) → `MarkdownContent` (unmemoized) **re-parses react-markdown per chunk**. **Impact:** the single biggest source of streaming jank; long analyses get slower as the transcript grows. **Fix:** make the three handlers read from `messagesRef` (stable callback, current data), wrap `MarkdownContent` in `React.memo`.

- **[P1] `App.tsx:2573-2653`** — ChatArea receives inline arrows (`onSelectMessageForProbability` `:2577`, `onOpenJournal/onOpenLiveMarket/onOpenAnalytics` `:2646-2648`, `onInteract` `:2650`) plus plain handlers (`handleCycleAnalysisUp`, `handleScrollToBottom`, `handleSendMessage`, `handleImageUpload`, `handleLeverageChange/Blur`, `handlePresetLeverage`, `removeImage`, `handleDeleteMessages`, `handleCancelAnalysis`) that are recreated per App render. ChatArea is `React.memo`'d (`ChatArea.tsx:513`) but these props defeat it on **every App render — including every keystroke** (chat `input` is App-level state). **Impact:** typing costs a full ChatArea + Virtuoso re-render per keypress. **Fix:** wrap handlers in `useCallback` (or settler/ref pattern) and lift the composer `input` state down into `ChatInput`.

- **[P2] `App.tsx:2442-2443` + `Journal.tsx:466`** — `enabledProviders={readyProviders.map(...)}` and `selectedModels={Object.fromEntries(...)}` create new array/object every App render, plus inline `onClose` (`:2436`) → `React.memo(Journal)` never short-circuits while the journal is open. Worse, `ModelPerformanceDashboard.tsx:343-345` re-fires its refresh effect on every App render (new `enabledProviders` identity) → `refreshData` (`:307-341`) runs `syncRollingWindowFromTradeLog` (ModelPerformanceService.ts:1188-1233: full trade-log scan, sort comparator **allocating a `Date` per comparison** at `:1195`, and a **localStorage write** at `:1231`) and schedules a 500ms refresh that is **never cancelled in the effect cleanup** → stacked refreshes + spinner flicker. **Impact:** performance tab visibly churns during background streaming/typing; repeated localStorage writes on a 1000-trade journal. **Fix:** memoize both derived props in App, stabilize `onClose`, and add a `useEffect` guard + cancelled timeout in the dashboard.

- **[P2] `components/shared/Header.tsx:46,92`** — Header is not memoized and re-renders itself every 5s (`setSessionContext`/`setAllSessions` return new objects) plus on every App render (streaming, keystrokes) because props change. **Impact:** unnecessary subtree work during runs; on mobile the slide-out sidebar (conversation list) re-renders with it. **Fix:** `React.memo(Header)` and only set state when the derived display (session name / kill-zone flag) actually changes; keep the tab-hidden pause (already present — good).

- **[P3] `App.tsx:2247-2251`** — `activeEnsembleRun` does `[...messages].reverse().find(...)` per recompute; it is memoized on `messages`, so it's only a per-chunk O(n) — cheap but avoidable with an index lookup.

---

## C. Persistence — `App.tsx` / `dbService.ts` / `SqliteService.ts`

- **[P1] `App.tsx:1185-1205`** — the DATA save effect's deps include `buildProfileSnapshot` (`:1154`, a `useCallback` whose identity changes whenever `conversationHistory`/`loggedTrades`/etc. change). Every stream chunk re-arms the effect → the 1500ms debounce **never fires during a debate**, and the synchronous `setSaveStatus('SAVING')` at `:1188` runs on **every re-arm** (an extra full App render per chunk, on top of A-1/B-1). The 15s heartbeat (`:1252-1264`, correct idea) then writes the **entire profile** — conversations including base64 chart images + trade log + summaries — as one JSON stringify + IndexedDB write on the main thread, every 15s mid-run. **Impact:** frame drops every 15s during long debates; multi-MB stringify of image blobs. **Fix:** dirty-section/delta writes (only the mutated conversation), store images in a separate store keyed by id, skip `setSaveStatus` when status is already SAVING, and dedupe the heartbeat snapshot (skip when nothing changed since `lastSavedSnapshotRef`).

- **[P3] `SqliteService.ts`** — whole `conversations.messages` JSON blob is rewritten per save; with delta writes from C-1 this shrinks too. Indexes + dirty-section fingerprint skip + single-transaction saves are already good.

---

## D. Bundle & build — `vite.config.ts` / `dist/`

- **[P2] `dist/index.html`** — statically `modulepreload`s `vendor-charts` (362.6KB = recharts **only**), `vendor-ai` (openai SDK, 69KB), `vendor-react`, `vendor-crypto` even though recharts is reachable only through the lazy `Journal` chunk (89.5KB). **Impact:** wasted network + parse on every startup for a chart library the user may never open. **Fix:** drop `vendor-charts` from the preload list (it loads with Journal); recharts was already correctly excluded from the main bundle.

- **[P2] `dist/assets/index-v-7CfAdp.js` (1378.7KB, eager)** — contains react-markdown + zod + react-virtuoso + App + all services. **Impact:** slow first paint on web; cold start in Electron. **Fix (ranked):** lazy-load react-markdown (only needed when an AI message renders — biggest single win), split zod via a `vendor-parsing` chunk, and confirm virtuoso's tree-shake (it's core to chat, so keep).

- **[P3] Dead dependencies** — `ccxt` and `@google/genai` are imported **nowhere** in `src/` (verified by grep); `vendor-crypto` (technicalindicators only) is fine but its config entry exists. Remove ccxt/genai from `package.json` + `manualChunks`. `openai` SDK (69.2KB, eager via `GenericProviderService.ts:17`) could be replaced by `fetch()` against the chat_completions endpoint to save the SDK entirely.

- **[P3] `npm run build` = `tsc --noEmit && vite build`** — full typecheck on every build/CI run. `tsc --noEmit --incremental` (with `.tsbuildinfo` gitignored) cuts the typecheck phase substantially.

---

## E. Live market data

- **[P2] `services/analysis/KlineService.ts`** — serial fallback chain (PDAX → Coins.ph → Binance → 3 proxies, 5s/8s timeouts): a single flaky source adds its full timeout to the chain, worst case 20–30s+ per timeframe. `MarketDataService.ts:1081-1086` correctly fetches the 4 timeframes in parallel, but each is subject to the serial chain, and the hybrid packet (`HybridIntelligenceService.ts:839-845`) awaits all of it before any analyst prompt is built. **Impact:** chart/hybrid data can stall the start of every analysis on a slow day. **Fix:** race the sources (`Promise.any` with staggered 2s/3s timeouts), prefer parallel attempts, and negative-cache dead sources.

- **[OK]** `LiveMarket.tsx` price path is exemplary: refs + RAF direct DOM writes, `setConnectionState` returns the same ref (no-op), 2s REST fallback, cleanup present. `useMarketData` 60s poll is a sane cadence.

- **[P3] `HybridIntelligenceService.ts:273` / `MarketDataService.ts:1073` / `HybridIntelligenceService.ts:943`** — `console.log` on every hybrid fetch and every Monte Carlo config build; trim or gate behind a debug flag.

---

## F. Image processing — `utils/imageProcessor.ts`

- **[P2] `utils/imageProcessor.ts`** — flow is FileReader dataURL → **full-size decode** → canvas downscale to 1600px/0.85 → re-encode. A 12MP phone screenshot decodes to ~48MB RGBA before being discarded. **Impact:** memory spike / GC pause on upload, worst on mobile (Capacitor). **Fix:** `createImageBitmap(file, { resizeWidth: 1600, resizeQuality: 'high' })` — resize happens at decode time, no full-size buffer. Also keep the existing "scale ≥ 1 → skip" path.

- **[P3] `responseCache`** — image hash = djb2 over the full base64 dataURL string per analysis call; hashing multi-MB strings repeatedly is avoidable CPU. Hash a downsampled window or cache the digest per upload.

---

## G. Caching — `services/infrastructure/persistentCache.ts`

- **[P2] `persistentCache.ts`** — eviction does a full IDB cursor scan + sort on **every put**; no TTL pruning for stale-but-not-full stores; reads serve entries without freshness/error-state awareness. **Impact:** with 200 large analysis payloads, writes degrade; stale cached market answers can be served silently. **Fix:** TTL-aware get, lazy prune (only on put when over cap), cap payload size at write time.

- **[OK]** `responseCache` (3 layers, TTLs, MAX 50 in-memory, djb2 of full prompt) is fine at this scale.

---

## H. Concurrency & workers

- **[P3] `JobQueueService.ts` / `OfflineQueueService.ts`** — FIFO, no persistence (JobQueue), no backpressure, and a single long LLM job blocks the queue (both). Offline queue has good exp-backoff + persistence. **Fix:** per-job timeout/cancel + concurrency slot for non-LLM jobs so a stuck model call doesn't strand everything.

- **[P3] `MonteCarloService.ts:538`** — singleton worker handles crash-drop-reject, but there is **no hang timeout**; a wedged worker leaves the run spinner forever. **Fix:** `Promise.race` with ~10s reject that falls back to the sync path. Results copy is structured-clone (fine for 1000 sims).

---

## I. Electron / native — `electron/main.cjs`, `electron/preload.cjs`

- **[P2] `electron/main.cjs` createWindow (~L295)** — no `show:false` + `ready-to-show` pair → white/blank window flash on every launch. **Fix:** create hidden, `win.once('ready-to-show', ...)` then show.

- **[P2] `electron/preload.cjs`** — `providerChat` bridge is non-streaming, so desktop streaming is fake (full text dump at end) while web streams token-by-token. **Impact:** the flagship streaming UX is degraded on the desktop shell. **Fix:** expose a streaming IPC bridge (chunk events over the same channel) or drive Electron via the web transport.

---

## J. Misc re-render / polling

- **[P3] `useTypingEffect.ts`** — 10ms/word-batch ⇒ up to ~100 renders/s in `LiveStreamView` during post-mortem typing; each render re-parses the visible lines. 30–50ms is imperceptible for text and 3–5× cheaper.

- **[P3] `AnalysisResult.tsx:241`** — every pending card with autopilot runs its own 30s kline poll (`checkEntry`); N pending cards = N polls. Gate on document visibility / only the newest card.

- **[P3] `App.tsx` `latestHistoricalAnalysis` memo** — re-sorts historical analyses per chunk; O(n log n) each time, wasteful but small. Cache the sorted array keyed by content length or sort lazily.

- **[OK] Memory-leak sweep** — all `setInterval`/`addEventListener` call sites verified with cleanups (Header, ProviderManager `:790-806` incl. visibility-gated interval, AnalysisResult, HybridDataPanel drag/loader, all modals, ChatArea media-query). Startup `checkDataIntegrity` (`App.tsx:1083`) + auto-backup run async after load and don't block first paint.

---

## Positive findings (verified, keep as-is)

- Debate updates RAF-throttled with final flush; moderator + casual chat don't re-render per token.
- `LiveMarket` direct-DOM price updates; `useRafThrottle` correct; Virtuoso used in ChatArea and TradeLog (`TradeLog.tsx:461`, memoized rows).
- 200-message conversation cap (`useConversations`); DATA/SETTINGS save split already in place; heartbeat via render-synced ref.
- SqliteService: schema v5, indexes on username, dirty-section fingerprint skip, single-transaction saves.
- All intervals pause on tab-hidden where it matters (Header, ProviderManager); no leaked listeners found.

---

## Top 10 performance wins (ranked by user impact)

1. **RAF-throttle the analyst `onReasoning` flush** (`useAnalysisPipeline.ts:1145`) — ends per-token re-render storm during every debate.
2. **Stabilize `chatContext` callbacks via `messagesRef`** (`App.tsx:2208`) — stops full-chat re-render + react-markdown re-parse per chunk.
3. **Delta-based profile saves + images out of the profile blob** (`App.tsx:1185,1252`) — kills 15s multi-MB main-thread stringify during runs.
4. **Stabilize ChatArea's handler props / isolate composer state** (`App.tsx:2573`) — kills per-keystroke ChatArea re-renders.
5. **Fix Journal/ModelPerformanceDashboard effect churn** (`App.tsx:2442`, `ModelPerformanceDashboard.tsx:343`) — ends refresh-spinner storm + localStorage writes while journal is open.
6. **Race Kline sources with short timeouts** (`KlineService.ts`) — cuts worst-case hybrid/chart latency from 30s to ~3s.
7. **Remove `vendor-charts` from startup preload** (`dist/index.html`) — saves 362KB of wasted startup fetch/parse.
8. **Electron `ready-to-show`** (`electron/main.cjs:295`) — removes blank-window flash; stream the desktop `providerChat` bridge.
9. **`createImageBitmap` decode-time resize** (`utils/imageProcessor.ts`) — removes full-size decode memory spikes.
10. **TTL-aware persistentCache + lazy eviction** (`persistentCache.ts`) — bounded store cost and no stale silent hits.

---

## Validation status

Read-only audit — no code changed. Bundle claims verified against current `dist/` (note: `scan_results.txt` is stale UTF-16; it references the deleted 2.5MB `index-CjUP5bn6.js` — the real main bundle is `index-v-7CfAdp.js`, 1378.7KB).
