# August 3.5 — Enhancement Plan

> Generated 2026-07-24 from a full codebase audit (51 components, 84 services, 13 utils).

---

## Phase 1 — Quick Wins (low effort, immediate impact)

### 1.1 Replace `alert()` / `confirm()` with Toast
- **Files:** `components/journal/LogTradeModal.tsx:28`, `components/settings/UserProfileManager.tsx:23,44,48`, `components/settings/SettingsMenu.tsx:175,409`, `App.tsx:836,1043,1107`
- **What:** Replace all 9 `window.alert()` / `window.confirm()` calls with the existing `ToastProvider` (`components/shared/Toast.tsx`). For the destructive `confirm()` calls in `App.tsx` and `SettingsMenu`, use a small `<ConfirmDialog>` built on the shared `<Modal>` primitive (2.7) rather than a non-blocking toast.
- **Why:** Native alerts block the UI thread, can't be styled, are inaccessible, and look broken in Android WebView. They also bypass the polished toast system that already exists.
- **Effort:** ~30 min (alerts) + ~1 hr (confirm → ConfirmDialog after 2.7)

### 1.2 Wire up the dead `apiErrorUtils.ts`
- **Files:** `utils/apiErrorUtils.ts` (exists, imported nowhere), all 9 provider services in `services/providers/`
- **What:** Replace ad-hoc error handling in each provider with the centralized `ParsedAPIError`, `shouldRetry()`, `getRetryDelay()` system already written in `apiErrorUtils.ts`. Standardize on the zhipu `withRetry()` pattern (4 attempts, exponential backoff, retry on 429 + empty responses).
- **Why:** Gemini, OpenAI, Groq, OpenRouter, and Grok services currently have **zero retry logic and no timeout**. A single transient 429 kills the entire analyst.
- **Effort:** ~2–3 hrs

### 1.3 Pass AbortSignal to actual API calls
- **Files:** `hooks/useAnalysisPipeline.ts`, all provider services
- **What:** The pipeline creates an `AbortController` but never passes `signal` to fetch/SDK calls. Cancellation only gates state updates after awaits — cancelled requests keep running and burning API quota. Pass `signal` through to every `client.chat.completions.create()` and `googleGenAI.models.generateContent()` call.
- **Why:** Users who cancel an analysis still consume tokens from every provider.
- **Effort:** ~2 hrs

### 1.4 Wrap SQLite writes in a transaction
- **Files:** `services/infrastructure/SqliteService.ts` (lines 367–440)
- **What:** `sqliteSaveUserProfile` issues individual `await db.run` INSERT OR REPLACE per entity (trades, conversations, summaries, analyses) with no transaction. Wrap the entire save in `BEGIN TRANSACTION ... COMMIT`.
- **Why:** 100 trades + 20 conversations = 120+ sequential native-bridge round trips per save. A transaction collapses this to 1 commit. Expected 10–50x speedup on saves.
- **Effort:** ~1 hr

### 1.5 Switch Tailwind CDN to build-time
- **Files:** `index.html` (remove CDN script tag), `vite.config.ts`, `package.json`
- **What:** `npm install tailwindcss @tailwindcss/vite`, add the Vite plugin, create a minimal CSS entry with `@import "tailwindcss"`. Remove the `<script src="https://cdn.tailwindcss.com">` tag and the dead `/index.css` reference (line 387).
- **Why:** CDN adds ~300KB payload, no tree-shaking, flash of unstyled content on slow connections. The TODO in `index.html` already flags this.
- **Effort:** ~1 hr

### 1.6 Merge duplicate Live views
- **Files:** `components/analysis/LiveAnalysisView.tsx`, `components/analysis/LivePostMortemView.tsx`
- **What:** These are near-identical (~10K each), differing only in loading-copy strings. Extract a shared `LiveStreamView` component parameterized by `variant: 'analysis' | 'postmortem'`.
- **Effort:** ~1 hr

### 1.7 Add `aria-label` to icon-only buttons
- **Files:** ~40 components with icon-only close/expand/scroll buttons
- **What:** Mechanical pass adding `aria-label` to every `<button>` that contains only an SVG/icon. Add `role="dialog"` + `aria-modal="true"` to all 8 modals.
- **Effort:** ~2 hrs

### 1.8 Stop the Header re-rendering every second
- **Files:** `components/shared/Header.tsx:70-79`
- **What:** `setInterval(updateSessions, 1000)` re-fetches session status every second and re-renders `Header` (not memoized) on every tick. Gate the interval on `document.visibilityState`, pause when the tab is hidden, and back off to 5–10s. Memoize `Header` or extract the clock into its own component so the rest of the header doesn't re-render.
- **Why:** A constantly-flashing top bar burns CPU/battery on mobile and invalidates memo on children that receive header-derived props.
- **Effort:** ~30 min

### 1.9 Fix `geminiAccuracyService` reading the wrong env var
- **Files:** `services/providers/accuracy/geminiAccuracyService.ts:12-15`
- **What:** Reads `process.env.API_KEY` instead of `process.env.GEMINI_API_KEY` (the variable documented in `.env.example`). Accuracy mode for Gemini silently uses the undocumented fallback or no key at all. Point it at `GEMINI_API_KEY`.
- **Why:** Silent provider failure in accuracy mode; diverges from every other Gemini service.
- **Effort:** ~15 min

### 1.10 Remove `user-scalable=no` from the viewport meta
- **Files:** `index.html:9`
- **What:** The viewport tag sets `maximum-scale=1.0, user-scalable=no`, blocking pinch-to-zoom — a WCAG 1.4.4 accessibility anti-pattern. Drop both attributes.
- **Why:** Low-vision users cannot zoom the trading UI on mobile/webview.
- **Effort:** ~10 min

### 1.11 Remove committed debug artifacts
- **Files:** `august-3.5-debug.apk`, `august.debug.apk`, `tsc_errors.txt`, `scan_results.txt`, `build-log.txt` (repo root)
- **What:** Two ~27 MB debug APKs and several build/log text files are committed. `.gitignore` now excludes `*.apk`, so these predate the rule. `git rm` them.
- **Why:** Bloats repo history and clone size; the TS-error log especially shouldn't ship as source.
- **Effort:** ~20 min

---

## Phase 2 — UX Polish (medium effort, high user-facing impact)

### 2.1 Accessibility: focus trapping + keyboard nav
- **Files:** All modals (`components/modals/*`), drawers (`ConversationHistory`, `SavedAnalyses`, `VisionDataViewer`), settings panels
- **What:**
  - Create `hooks/useFocusTrap.ts` — traps Tab cycling within an overlay, restores focus on close.
  - Create `hooks/useEscapeClose.ts` — closes on Escape key.
  - Apply to every modal and drawer.
  - Add `role="dialog"`, `aria-modal`, `aria-labelledby` to all overlays.
- **Why:** Currently zero focus management. Keyboard and switch users can tab behind overlays and get stuck.
- **Effort:** ~4–6 hrs

### 2.2 Standardize icon system
- **Files:** `components/shared/Icons.tsx` (~40 hand-rolled SVGs), `components/dashboards/VersionHistoryDashboard.tsx` (inline icon set), all consumers
- **What:** Adopt `lucide-react` (already a dependency) as the single icon library. Map each hand-rolled icon to its lucide equivalent. Delete `Icons.tsx` and the inline set in `VersionHistoryDashboard`. Remove emoji-as-icon usage.
- **Effort:** ~3–4 hrs

### 2.3 Unify design palette
- **Files:** `LogTradeModal.tsx`, `SavedAnalyses.tsx`, `PostTradeUploadModal.tsx` (older gray/green/red generation)
- **What:** Align older components to the newer zinc/cyan/emerald/rose palette used by `AnalysisResult`, `SettingsMenu`, `ProviderManager`. Ensure consistent glass-panel styling, border radii, and shadow tokens.
- **Effort:** ~3–4 hrs

### 2.4 Empty states & onboarding
- **Files:** `Journal.tsx`, `WinRateDashboard.tsx`, `ModelPerformanceDashboard.tsx`, `LearningDashboard.tsx`, `App.tsx`
- **What:**
  - First-run flow: detect no API keys configured → guided setup screen (reuse `ProviderManager`).
  - Journal with zero trades → "Log your first trade" CTA with illustration.
  - Analytics dashboards with <3 trades → meaningful "not enough data" cards with guidance on what's needed.
  - Chat area with no messages → prompt suggestions (partially exists via `QuickActionChips`, but hidden until first interaction).
- **Effort:** ~6–8 hrs

### 2.5 Lightweight routing
- **Files:** `App.tsx`, `package.json`
- **What:** Add `wouter` (~2KB) or a minimal hash-router. Map existing boolean flags to routes:
  - `#/` → chat
  - `#/journal` → journal
  - `#/market` → live market
  - `#/settings` → settings
  - `#/settings/providers` → provider config
- **Why:** Enables browser back button, deep-linking, and state recovery after Android WebView reload.
- **Effort:** ~6–8 hrs

### 2.6 Move Monte Carlo to a Web Worker
- **Files:** `services/analysis/MonteCarloService.ts`, `hooks/useAnalysisPipeline.ts`
- **What:** Monte Carlo runs 1000 GBM simulations × N analysts synchronously on the main thread, blocking UI before the debate renders. Move to `new Worker(new URL('./monteCarlo.worker.ts', import.meta.url))`.
- **Effort:** ~2–3 hrs

### 2.7 Shared `<Skeleton>` + `<EmptyState>` primitives
- **Files:** New `components/ui/Skeleton.tsx`, `components/ui/EmptyState.tsx`; ~21 consumers (`MessageItem.tsx`, `TradeLog.tsx`, `SavedAnalyses.tsx`, `ConversationHistory.tsx`, `WinRateDashboard.tsx`, `AdvancedAnalyticsSidePanel.tsx`, etc.)
- **What:** `animate-pulse` is reused as a faux-skeleton in ~21 files with ad-hoc gray blocks, and every empty list hand-rolls its own empty string. Extract a `<Skeleton variant="text|card|avatar">` (with `aria-hidden` + `prefers-reduced-motion` fallback) and an `<EmptyState icon title description action?>` primitive. Sweep consumers onto them.
- **Why:** Standardizes loading and empty UX; removes ~21 ad-hoc implementations; gives the whole app a consistent "thinking" state.
- **Effort:** ~3–4 hrs

### 2.8 Inline form validation + `aria-invalid`
- **Files:** `components/journal/LogTradeModal.tsx`, `components/journal/UpdateTradeModal.tsx`, `components/modals/DataCaptureModal.tsx`, `components/settings/UserProfileManager.tsx`, `components/settings/AnalystLensSettings.tsx`
- **What:** Validation today means `parseFloat(pnl)` + `alert()` on failure. No `required` attributes (used in 1 file only), no `aria-invalid`, no `setCustomValidity`, no inline error text. Add per-field inline error messaging with `aria-describedby` → error id, `aria-invalid={!!error}`, and a `useFormState` helper (no full library needed — or adopt `react-hook-form`). Sweep the highest-stakes forms (PnL entry, leverage, leverage clamps, custom instructions length).
- **Why:** Errors only surface as blocking `alert()`; users can't see what field is wrong while typing.
- **Effort:** ~4–6 hrs

### 2.9 Mobile-responsive modals
- **Files:** All `components/modals/*`, `components/settings/SettingsMenu.tsx`, `components/journal/PerformanceReview.tsx`
- **What:** `components/modals/` uses zero responsive breakpoints — every modal is fixed `max-w-md` / `max-w-2xl` and may overflow or cramp on phones. Convert to `max-w-md sm:max-w-md` with `max-h-[90vh] overflow-y-auto` panels, full-width bottom-sheet variant on `< sm`, and safe-area insets (`env(safe-area-inset-bottom)`) for native.
- **Why:** Modals currently clip or scroll poorly on small screens; native mobile users get the worst experience.
- **Effort:** ~2–3 hrs

### 2.10 Merge the three duplicate capture modals
- **Files:** `components/modals/DataCaptureModal.tsx`, `components/modals/EntryNotHitCaptureModal.tsx`, `components/journal/LogTradeModal.tsx`
- **What:** These share the identical `outcomeColors` map, PnL-input form, and `content` object (title/emoji/pnlLabel/advancedToggle), differing only in labels. Collapse into one parameterized `<CaptureForm variant="hit" | "entryNotHit" | "log">` driven by a `content` config.
- **Why:** DRY violation; any validation fix (2.8) has to be applied three times today.
- **Effort:** ~2–3 hrs

---

## Phase 3 — Architecture (high effort, structural improvement)

### 3.1 Break up the god component
- **Files:** `App.tsx` (1,759 lines), all hooks in `hooks/`
- **What:**
  - Convert the `ChatContextProps` plain-object bag (~40 fields) into a real `React.createContext`.
  - Split App-level state into domain context providers: `ChatProvider`, `JournalProvider`, `MarketProvider`, `SettingsProvider`.
  - Reduce prop counts: `ChatInput` (~45 props), `Journal` (~50), `Header` (~30), `MessageItem` (~40).
  - **Fix the stale-closure bug** in the memoized `chatContext` (`App.tsx:1310-1344`): the deps array omits `handleViewStrategyDetails` and `handleApplyStrategy`, which are bundled into the object at lines 1334-1335.
- **Why:** Every UI change currently requires touching App.tsx + hook + component. This is the #1 blocker to iteration speed.
- **Effort:** ~2–3 days

### 3.2 Decompose oversized components
- **Files:**
  - `AnalysisResult.tsx` (1,673 lines) → split into `AnalysisCard`, `BacktestPanel`, `PriceAlertSection`, `CalibrationWidget`, `ShareMenu`
  - `LiveMarket.tsx` (1,091 lines) → extract the 4-source CORS-proxy fetch chain into `services/analysis/KlineService.ts`
  - `SettingsMenu.tsx` (1,063 lines) → extract drill-down nav into a generic `DrillDownMenu` component, inline sub-components into separate files
  - `AdvancedAnalyticsSidePanel.tsx` (929 lines) → split into `MonteCarloPanel`, `BacktestResults`, `ProbabilityPanel`
- **Why:** Enables code-splitting / lazy loading, reduces initial bundle, improves maintainability.
- **Effort:** ~3–4 days

### 3.3 Complete the provider migration
- **Files:** `services/providers/` (9 legacy services + 10 accuracy duplicates ≈ 14K lines), `GenericProviderService.ts` (203 lines)
- **What:**
  - Wire `GenericProviderService` + `ProviderConfigService` into the main analysis pipeline.
  - Extract shared prompt templates from the 9 legacy services into `services/prompts/`.
  - Delete legacy per-provider services and accuracy duplicates once the generic path is validated.
  - **Define a shared `AIProviderService` interface** (`analyzeTradingView`, `conductPostMortem`, `getQuickResponse`, `summarizeChartImage`, `updateGlobalMemory`, `getStrategyDescription`). Each of the 9 legacy files independently declares `Promise<{ analysis: TradeAnalysis; thoughtProcess: string; sources: GroundingChunk[] }>` — a common interface would catch drift at the type level (e.g. a provider omitting `sources`).
- **Why:** Eliminates ~12K lines of near-identical code. New providers become a config entry instead of a 1000-line service file.
- **Effort:** ~3–5 days

### 3.4 Fix persistence layer
- **Files:** `App.tsx` (save effect, lines 721–751), `SqliteService.ts`, `StorageService.ts`, `PreferencesService.ts`, `GlobalLearningService.ts`
- **What:**
  - **Dirty-tracking saves:** Only persist the slices that changed instead of the entire profile on every state change.
  - **Extract images from conversation JSON:** Store base64 images as separate blob rows/records instead of inline in the messages JSON column. Currently every save re-serializes all images.
  - **Consolidate storage:** Merge the 4+ storage mechanisms (SQLite/IndexedDB, Preferences, raw localStorage, Capacitor Filesystem) into 2: `dbService` for domain data, `PreferencesService` for settings/keys.
  - **Add a granular read API.** `SqliteService.sqliteGetUserProfile` (`SqliteService.ts:237-362`) does 5 SELECTs and reassembles the entire profile (trades + conversations + summaries + analyses) on every call — there's no way to fetch a single trade, list conversations by date, or page summaries. Add `getTrade(id)`, `listConversations({limit, before})`, `listSummaries({limit})` so the UI can lazy-load instead of rehydrating the whole profile.
  - **Real migration framework.** Today `DB_VERSION = 4` with bare `ALTER TABLE ADD COLUMN` in try/catch that silently swallows "column already exists" errors (`SqliteService.ts:167-203`). Add a `schema_migrations` version table + up-migrations, and fail loudly on unknown versions rather than silently no-op.
- **Why:** The full-profile save is the single biggest performance bottleneck. A user with a large history experiences multi-second save delays.
- **Effort:** ~3–5 days

### 3.5 Security hardening
- **Files:** `PreferencesService.ts`, `types/provider.ts`, `vite.config.ts`, `SqliteService.ts`
- **What:**
  - **Encrypt API keys at rest.** The type comment claims "stored encrypted" — this is false. Use `@capacitor/preferences` with encryption or a secure storage plugin.
  - **Prevent key leakage in builds.** Legacy services read `process.env.X_API_KEY` which Vite inlines at build time. Ensure `.env.local` is never present during production builds, or remove the `define` block entirely in favor of runtime-only keys.
  - **Encrypt SQLite DB.** Currently opened with `'no-encryption'`. Use SQLCipher or the capacitor-community/sqlite encryption option.
  - **Sanitize error messages.** `GenericProviderService` (lines 79–81) and the pipeline (line 1192) throw raw API error text into user-visible messages. Map to user-friendly messages.
  - **Mask existing API keys.** `ProviderManager.tsx` line 213 renders existing keys in a `type="text"` input.
  - **Unify the three API-key paths.** Today keys live in three places: `process.env.*` (build-time, 9 debate providers), `PreferencesService.getApiKey()` (runtime, OpenAI/Grok moderator only), and `ProviderConfigService` (custom providers). Consolidate built-in providers onto the runtime path so keys can be rotated without a rebuild.
- **Effort:** ~2–3 days

### 3.6 Improve token estimation
- **Files:** `utils/tokenUtils.ts`
- **What:** Replace `chars / 4` with `gpt-tokenizer` (lightweight, no WASM) for OpenAI-compatible models. For Gemini, use the `countTokens` API or a heuristic tuned to Gemini's tokenizer.
- **Why:** Current estimation is ~30% off for JSON-heavy content, causing either over-truncation (lost context) or under-truncation (API errors).
- **Effort:** ~2–3 hrs

### 3.7 AI response caching
- **Files:** `hooks/useAnalysisPipeline.ts`, provider services
- **What:**
  - Cache the assembled context string per analysis session (currently rebuilt and uploaded N times, once per analyst).
  - Content-hash cache for identical chart images to skip re-OCR/re-upload.
  - Optional: cache full AI responses keyed by (image hash + prompt hash + model) for re-analysis of the same chart.
- **Effort:** ~1–2 days

### 3.8 Runtime schema validation at provider boundaries
- **Files:** New `schemas/tradeAnalysis.ts`; `services/providers/*`, `services/providers/ensembleService.ts`, `utils/jsonUtils.ts`, `services/providers/GenericProviderService.ts`
- **What:** No runtime validation library exists today. Provider responses are `JSON.parse`d and field-accessed as `any` (`openaiService.ts:721-731`, `GenericProviderService.ts:86-143`), then `as TradeAnalysis`-cast (`ensembleService.ts:1046-1063`). Add `zod` schemas for `TradeAnalysis`, `Strategy`, `PostMortemResult`, and the moderator's `<JSON_PLAN>` payload, and validate at every provider→pipeline boundary. Keep `sanitizeTradeAnalysis` as the coercion layer behind the schema.
- **Why:** A provider omitting or reshaping a field silently corrupts downstream state; TypeScript can't catch it because there's no common interface or runtime check. Financial app — wrong-shaped data has real cost.
- **Effort:** ~1 day

### 3.9 Structured logging & replace inline error markers
- **Files:** New `services/infrastructure/logger.ts`; `services/providers/ensembleService.ts:867-914` (and the UI consumer of `<MODERATOR_ERROR>`); all 9 provider services
- **What:** ~79 `console.*` calls in `services/providers/*.ts` with hand-prefixes (`[dbService]`, `[SqliteService]`, …). The moderator stream inlines errors as `<MODERATOR_ERROR>...</MODERATOR_ERROR>` text markers (`ensembleService.ts:874,909`) that the UI must string-match — a fragile contract. Introduce a tiny `logger` with levels + a request/correlation ID threaded through the ensemble (one ID per analysis run, tagged on every provider call). Replace the `<MODERATOR_ERROR>` text marker with a typed side-channel event on the async generator (or a `{ type: 'error', ... }` yielded object alongside token chunks).
- **Why:** No way to trace a failed analysis across providers today; errors are buried in streamed text the UI parses by substring.
- **Effort:** ~1 day

### 3.10 Unify streaming across analysts + moderator
- **Files:** `services/providers/*`, `services/providers/ensembleService.ts`, `hooks/useAnalysisPipeline.ts`
- **What:** Streaming is split today: the moderator streams tokens (`ensembleService.ts:847-914`, an `async function*`), but every analyst call (`openaiService.analyzeTradingView`, `geminiService.analyzeTradingView`, …) uses non-streaming `chat.completions.create` / `generateContent` and returns a complete `{ analysis, thoughtProcess, sources }`. JSON-mode is also mismatched (analysts use `response_format: { type: "json_object" }` / `responseSchema`; moderator streams raw text with an embedded `<JSON_PLAN>` the UI must parse out of the stream). Either stream analysts too (progressive JSON parse) or settle on JSON-mode for the moderator and drop the text-embedded plan.
- **Why:** Users wait for the full analyst batch with zero progress feedback; the mixed contract doubles the parsing surface.
- **Effort:** ~1–2 days

### 3.11 Collapse `useUIState` 35 booleans into a reducer
- **Files:** `hooks/useUIState.ts` (lines 10-43), consumers
- **What:** 35 separate `useState` booleans with no `useReducer` anywhere. Modal open/close transitions are auditable only by reading every callsite. Convert to a single `useReducer` with a discriminated `Action` union (e.g. `{ type: 'openModal', modal }`, `{ type: 'closeAll' }`), or grouped state slices (`ui.modals`, `ui.panels`, `ui.flags`).
- **Why:** Predictable transitions, one place to audit, enables "close all modals" / route-change reset for 2.5.
- **Effort:** ~3–4 hrs

---

## Phase 4 — Testing & Quality Infrastructure

### 4.1 Add a test framework
- **What:** Install Vitest + React Testing Library. Priority test targets:
  - `utils/jsonUtils.ts` (AI JSON repair — critical path)
  - `utils/sanitizers.ts` (XSS defense)
  - `services/validation/*` (trade validation gates)
  - `services/backtesting/*` (financial calculations)
  - `services/analysis/ProbabilityEngineService.ts`
- **Effort:** ~1 day setup + ongoing

### 4.2 Add linting & type checking
- **What:** ESLint with `@typescript-eslint`, run `tsc --noEmit` in CI. The AGENTS.md notes "no linting configured, no type checking configured" — this is a risk for a financial application.
- **Why:** TypeScript strict mode is currently **disabled** despite AGENTS.md claiming "strict type checking" — `tsconfig.json` has no `strict`, `noImplicitAny`, or `strictNullChecks`. A committed `tsc_errors.txt` proves real TS2339/TS2322 errors exist in `HybridDataPanel.tsx` and `Journal.tsx` but are invisible without a `tsc` script or CI gate. Enable `strict: true` (fix fallout incrementally), add a `typecheck` npm script, and fail CI on errors.
- **Effort:** ~4–6 hrs setup + fix existing errors

### 4.3 Remove dead code & vestigial artifacts
- **Files:**
  - `utils/apiErrorUtils.ts` (wire up in Phase 1, then no longer dead)
  - Import map in `index.html` (vestigial from online IDE migration — Vite handles resolution)
  - Dead `/index.css` reference in `index.html` line 387
  - Thread-level chat compression (Layer 2 memory — noted as "currently disabled")
- **Effort:** ~1 hr

---

## Phase 5 — Dependency & Build Hygiene

### 5.1 Resolve the Vite version conflict
- **Files:** `package.json`, `vite.config.ts`
- **What:** `package.json` lists Vite `^7.2.2` in `dependencies` and `^6.2.0` in `devDependencies` — a **major version conflict**. `@vitejs/plugin-react` is also duplicated (`^5.1.1` deps / `^5.0.0` devDeps). Vite is misclassified as a runtime dependency (it's a build tool). Pick one Vite major (recommend 7), move Vite + plugin-react to `devDependencies` only, remove the duplicate entries, and `npm dedupe`.
- **Why:** Conflicting versions can resolve either way depending on install order, causing hard-to-reproduce build failures.
- **Effort:** ~30 min

### 5.2 Add bundle splitting for heavy deps
- **Files:** `vite.config.ts`
- **What:** No `build.rollupOptions` or `manualChunks` is configured despite heavy deps — `ccxt` (~1–3 MB), `@google/genai`, `openai` SDK, `lightweight-charts`, `recharts`, `technicalindicators` all land in one chunk. Add `manualChunks` to split vendors (e.g. `vendor-ai`, `vendor-charts`, `vendor-crypto`), enable `build.sourcemap: true` for production debugging, and consider `vite-plugin-compression` for gzip/brotli.
- **Why:** Single-chunk bundle → long initial load, no caching benefit on update, no parallel download. Critical for the Android WebView cold start.
- **Effort:** ~1–2 hrs

### 5.3 Consolidate the 3 Groq providers into one with key rotation
- **Files:** `constants/models.ts` (lines 51-77), `types/enums.ts` (`AIProvider`), `services/providers/groqService.ts`, `groqNewService.ts`, `groqAlt2Service.ts`, accuracy duplicates
- **What:** `GROQ`, `GROQ_NEW`, `GROQ_ALT2` are three separate providers representing the **same model IDs** with different API keys — 36 duplicated model entries purely as a rate-limit workaround. Collapse into a single `GROQ` provider whose client maintains a small key pool with round-robin / least-recently-used selection on 429. Falls out naturally from 3.3 (provider migration).
- **Why:** 36 redundant model entries; three near-identical service files; the real need (rate-limit rotation) is better served by a key pool than by provider duplication.
- **Effort:** ~2 hrs (after 3.3) / ~4 hrs (standalone)

### 5.4 Fix `DebateTurn.speaker` hardcoded union
- **Files:** `types/message.ts`, `types/enums.ts`
- **What:** `DebateTurn.speaker` is a hardcoded string union (`'Gemini' | 'DeepSeek' | ... | 'Moderator'`) that can silently drift from the `AIProvider` enum — and already does (Zhipu/Grok variants aren't consistently included). Derive it from `AIProvider` plus the literal `'Moderator'`, e.g. `type Speaker = \`${AIProvider}\` | 'Moderator'`.
- **Why:** A new provider added to `AIProvider` won't appear in debate turns until someone remembers to update the union.
- **Effort:** ~30 min

### 5.5 Replace the AI Studio boilerplate README
- **Files:** `README.md`, `AGENTS.md`
- **What:** `README.md` is the default AI Studio template ("Run and deploy your AI Studio app") and doesn't reflect the actual multi-provider / Electron / Capacitor app. AGENTS.md describes a `src/` layout that doesn't exist (code is flat at repo root). Rewrite README with real setup (env vars, `npm run dev` / `electron:dev` / Capacitor build), and reconcile AGENTS.md paths with the flat structure.
- **Why:** Onboarding friction; the docs actively mislead a new contributor.
- **Effort:** ~1–2 hrs

---

## Priority Matrix

| Phase | Item | Effort | Impact | Risk if skipped |
|-------|------|--------|--------|-----------------|
| 1 | 1.2 Wire up apiErrorUtils | 2–3 hrs | 🔴 High | Unreliable AI calls |
| 1 | 1.3 Pass AbortSignal | 2 hrs | 🔴 High | Wasted API quota |
| 1 | 1.4 SQLite transactions | 1 hr | 🔴 High | Slow saves on device |
| 1 | 1.9 Fix gemini env var | 15 min | 🔴 High | Silent accuracy-mode failure |
| 1 | 1.1 Replace alert() | 30 min | 🟡 Med | Broken UX on Android |
| 1 | 1.5 Tailwind build-time | 1 hr | 🟡 Med | 300KB extra payload |
| 1 | 1.7 aria-labels | 2 hrs | 🟡 Med | Accessibility |
| 1 | 1.8 Header interval | 30 min | 🟡 Med | Constant re-renders |
| 1 | 1.10 viewport zoom | 10 min | 🟡 Med | A11y on mobile |
| 1 | 1.11 Remove debug artifacts | 20 min | 🟢 Low | Repo bloat |
| 2 | 2.1 Focus trap + Escape | 4–6 hrs | 🔴 High | Accessibility |
| 2 | 2.7 Skeleton + EmptyState | 3–4 hrs | 🟡 Med | Inconsistent loading UX |
| 2 | 2.8 Inline form validation | 4–6 hrs | 🟡 Med | Errors only via alert() |
| 2 | 2.6 Monte Carlo worker | 2–3 hrs | 🟡 Med | UI jank |
| 2 | 2.4 Empty states | 6–8 hrs | 🟡 Med | Confusing first run |
| 2 | 2.5 Routing | 6–8 hrs | 🟡 Med | No back button |
| 2 | 2.9 Mobile-responsive modals | 2–3 hrs | 🟡 Med | Cramped mobile UX |
| 2 | 2.10 Merge capture modals | 2–3 hrs | 🟢 Low | DRY violation |
| 3 | 3.1 Break up App.tsx | 2–3 days | 🔴 High | Dev velocity |
| 3 | 3.3 Provider migration | 3–5 days | 🔴 High | 14K lines duplication |
| 3 | 3.4 Persistence fix | 3–5 days | 🔴 High | Save performance |
| 3 | 3.5 Security hardening | 2–3 days | 🔴 High | Key exposure |
| 3 | 3.8 Zod boundary validation | 1 day | 🔴 High | Silent data corruption |
| 3 | 3.9 Structured logging | 1 day | 🟡 Med | Untraceable failures |
| 3 | 3.11 useUIState reducer | 3–4 hrs | 🟡 Med | Unauditable modal state |
| 4 | 4.1 Test framework | 1 day+ | 🟡 Med | Regression risk |
| 4 | 4.2 Linting + strict TS | 4–6 hrs | 🔴 High | Type errors ship unnoticed |
| 5 | 5.1 Vite version conflict | 30 min | 🔴 High | Reproducibility |
| 5 | 5.2 Bundle splitting | 1–2 hrs | 🟡 Med | Slow cold start |
| 5 | 5.3 Groq key rotation | 2–4 hrs | 🟢 Low | 36 duplicate model entries |
| 5 | 5.4 DebateTurn union | 30 min | 🟢 Low | Type drift |
| 5 | 5.5 Rewrite README | 1–2 hrs | 🟢 Low | Onboarding friction |

---

## Suggested Execution Order

```
Week 1:  Phase 1 (all quick wins) + Phase 5.1/5.4 (dep + type fixes)
Week 2:  Phase 2.1–2.3 (accessibility, icons, palette) + Phase 4.2 (lint + strict TS)
Week 3:  Phase 2.4–2.10 (empty states, routing, worker, validation, mobile)
Week 4+: Phase 3.1–3.2 (god component, decomposition)
Week 5+: Phase 3.3–3.5 (provider migration, persistence, security)
         Phase 3.8–3.11 (zod, logging, streaming, reducer) alongside 3.3
Week 6+: Phase 3.6–3.7 (token estimation, caching)
         Phase 5.2/5.3/5.5 (bundle, Groq, README)
Ongoing: Phase 4 (testing, linting)
```
