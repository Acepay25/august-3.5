# Final Sweep — Consolidated Report

**Date:** 2025-08 · **Tree state:** tsc ✓ · vitest **366 passed / 11 skipped** ✓ · vite build ✓ (entry 1298.1 kB / gzip 384.6 kB)
**Method:** 6 parallel read-only sweep agents (app+hooks / providers+debate / core services+infra / UI components / types+utils+tests / features cross-cut+electron) + main-session spot-check of every top claim against real code. Full UI detail list: `AUDIT_COMPONENTS_REPORT.md`.

---

## High

| # | Finding | Location | Verified | Fix |
|---|---------|----------|----------|-----|
| H1 | **Watch symbols never enter the price feed.** `connectWebSocket` / `startPolling` derive symbols **only from `this.alerts`**; `ensureFeed` calls `acquireMonitor()` + `subscribePrices()` but there is no symbol-registration API. A "watch this setup" on any symbol without a pre-existing price alert stays ARMED forever (fires only at creation if a cached price happens to exist). Same root cause silently disables the live-price refresh block (F5-1) for that same population. Untested — `setupWatch.test.ts` mocks the feed. | `PriceAlertService.ts:309, 361, 464` · `SetupWatchService.ts:172-185` | ✅ re-read | Add `trackSymbol(symbol)` / `untrackSymbol(symbol)` (a `Set<string>` merged into the WS stream list, the polling loop, and `emitPriceTick`); call from watch create/delete. |
| H2 | **Sanitizer italic regex defeats the digit-guard.** `/(\*)(.*?)\1/g` runs *before* the `(?<!\d)\*|\*(?!\d)` guard, so any math expression with `*` is corrupted in AI prose: `5*6*7` → `567`. | `utils/sanitizers.ts:17` (guard at `:27`) | ✅ re-read | Make the italic regex skip digit-adjacent asterisks: `/(?<!\d)\*([^*\n]*?)(?<!\d)\*/g` (or run the guard first with a non-digit italic pattern). |

## Medium

| # | Finding | Location | Verified | Fix |
|---|---------|----------|----------|-----|
| M1 | **Replacement-timeout desync → phantom analyst + wasted paid call.** Engine emits `<REPLACEMENT_TIMEOUT>` and moves on; consumer never handles the marker. `replacementChoiceRef` stays armed (cleared only at choice-handled / catch), so a late click on the still-visible banner resolves the suspended `requestReplacement` → full `cachedAnalyzeTradingView` call → phantom analyst pushed into `allFulfilledAnalysts` / consensus / runStats. | `ensembleService.ts:2603, 2758, 2945` · `useAnalysisPipeline.ts:397, 1496-1498, 2255` | ✅ re-read | In the pipeline's System-turn handling (both standard + accuracy loops), on text starting with `<REPLACEMENT_TIMEOUT>`: null `replacementChoiceRef.current`, clear `message.replacementOffer`, resolve pending with `null`. |
| M2 | **Reassessment aborts a streaming PM and clobbers it as "Post-Mortem Failed".** `startTodayReassessment` aborts the **shared** controller without bumping `postMortemRunIdRef`, so the streaming PM's catch sees `isRunStale` = false and writes the failure + `postMortemFailedCandidate` over its partial transcript. **Nuance:** the run-id bump must happen *before* capturing `myRunId` (or the reassessment self-discards at `:690`). | `usePostMortem.ts:642-647` vs `:543-564` | ✅ re-read | Bump `postMortemRunIdRef.current += 1` first, then capture `myRunId`, then abort. |
| M3 | **Stuck `todayReassessmentInFlight` after account/conversation switch.** `finally` skips clearing when stale; `invalidatePostMortemRuns` never clears → the button is disabled forever until reload. Also folds in F4-2: the flag is set *after* the market-data fetch, so a double-click window exists. | `usePostMortem.ts:681, 705` + `:127-131` | ✅ re-read | Clear the flag unconditionally in `finally`; set it before the fetch (right after the in-flight guard). |
| M4 | **Non-streaming chat_completions has no internal timeout when the caller omits a signal.** `withTimeoutSignal` is applied only in the `options?.signal` branch; the web path is then uncapped. Latent today (all `GenericAnalysisService` call sites pass a signal), but a single future call site reintroduces ~indefinite hangs; Electron path is separately capped (`:476`). | `GenericProviderService.ts:146, 154` | ✅ re-read | Always wrap: `{ signal: withTimeoutSignal(options?.signal) }` (both sites, incl. the jsonMode fallback). |
| M5 | `<JSON_PLAN>` accepted without a closing tag → truncated JSON skips the compact-prompt retry path. | `ensembleService.ts:3129` | agent-2 verified | Require the closing tag before compact-prompt retry. |
| M6 | Malformed `<ACCURACY_ADJUST>` leaks raw JSON into the chat bubble. | `ensembleService.ts:940-954` | agent-2 verified | Tighten tag parsing; render fallback text on malformed payload. |
| M7 | **AnalysisResult TDZ:** initial `checkEntry()` can hit `clearInterval(interval)` before `const interval` is declared → swallowed ReferenceError + one redundant 30s tick. **"+Add" misapplies:** shows when a strategy is missing from frameworks but applies `activeStrategies[0]`, which may already be active → no-op. | `AnalysisResult.tsx:263-274` · `:638-639` | ✅ re-read | Reorder (declare interval first / guard `wasActiveBeforeExpiry`); apply the first strategy **not** in `activeFrameworks`. |
| M8 | GATE prompt example teaches `confidencePenalties.total`, but the parser consumes `effectiveTotal` (with `rawTotal`). A model emitting the example shape loses its penalty. | `constants/schemas.ts:105` vs `schemas/tradeAnalysis.ts:132`, `GateKeeperService.ts:327` | ✅ re-read | Fix the example: `"rawTotal": 0.15, "effectiveTotal": 0.15`. |
| M9 | Legacy brand roles still hardcoded: "Gemini: Volatility… DeepSeek: Pattern… Groq: Continuation…" — providers are runtime-configured now; the names are fictional for the active roster. | `constants/prompts/analysisPrompts.ts:110-112, 216-218` | ✅ re-read | Generalize to roles ("One analyst owns volatility/macro, another structure, another trend") without brand names. |
| M10 | `watchInFlightRef` lags `isAnalysisInProgress` by one effect cycle; a fire in the window is dropped while `rearmWatch` already re-armed → watch stays TRIGGERED, fire-once lost, no re-debate. | `App.tsx:2028-2031` vs `:2033-2054` | ✅ re-read | Sync the ref synchronously where in-flight state flips, or read state in the handler with the dep added. |
| M11 | `analysisInFlightRef` never reset on the conversation-switch abort path. Latent (all switch paths cancel first), but the ref is the double-submit guard — a future direct switch leaves it stuck true. | `useAnalysisPipeline.ts:421-433` | ✅ re-read | Set `analysisInFlightRef.current = false` in the switch effect. |

## Low (agent-verified, not re-spot-checked)

- **F1-2** dead code `awaitReplacementFor` (`ensembleService.ts:2596-2613`). · **F1-3** replacement candidate filter allows `model: ''`.
- **F2-3** `saveWatches` fire-and-forget async writes can land out of order. · **F2-4** TRIGGERED persists if the app dies between fire and launch (intentional, fragile).
- **F4-4** reassessment panel gates on `message.postMortem` only; if SmoothText never completes, the button never appears — gate on `postMortem || text` (`TodayReassessmentPanel.tsx:35`).
- **Electron bridge abort race** in `GenericProviderService` (listener registered after the aborted check).
- **UI** (`AUDIT_COMPONENTS_REPORT.md`): ~20 LOW + 12 refuted; e.g. LiveStreamView auto-close hang (latent).
- **types/utils/tests (agent 5):** dashboard PnL ignores `pnlPercent`; stale `ProviderName` union; `buildProviderNameToId` "last wins" vs `buildModelIdToName` "first wins"; `entryTimingScore.suggestedEntry.price` typed `number` vs string-price convention; moderator prompt says "all 7 sections" vs 9.
- **hooks (agent 1):** PM debate turns read `messagesRef` before effect flush → ThinkingStore may miss turns; settings toggles re-arm full-profile save + `buildProfileSnapshot` localStorage parse every render.

## Refuted / deliberate (do not "fix")

- **`probability: 1` → 1%** (agent 2 M3): *correct as-is.* Prompt contract is explicitly "probability: Numeric percentage (0-100)" (`debatePrompts.ts:636`, `analysisPrompts.ts:241`); the `<= 1` behavior was deliberately removed (`schemas/tradeAnalysis.ts:546-549`) because it turned every bare `1` into 100%. A model on the 0-100 scale writes `100` for 100%.
- **Timeout severity (agent 2 H1):** real gap but **latent** — every current `GenericAnalysisService` call site passes a signal; only hypothetical future callers are uncapped.
- **12 UI suspects refuted** by agent 4 (MessageItem memo, SetupWatchControl snapshot stability, etc.).

## Coverage gap

- **Agent 3 (core services + infra: services/analysis|backtesting|learning|infrastructure + constants)** returned only its summary line (1 HIGH / 7 MED / 11 LOW, 64 files) — the details were lost to output truncation and the `task` tool became unavailable for a re-run. This scope is **not yet covered by confirmed findings**. The stale `final-sweep-report.md` at the repo root is from an older sweep (~104 tests) and must not be mistaken for this report.
- **Recommended:** fold a targeted main-session sweep of that scope into the implementation pass (priority: `services/learning/*`, `services/backtesting/*`, `MonteCarloService` + worker, `services/infrastructure/*`).

---

## Recommended next chunk

Fix **H1 + H2 + M1–M11** (all small and well-contained), add regression tests for H1 (`trackSymbol` feed) and H2 (sanitizer math), then run the trio. Follow with the core-services gap sweep.
