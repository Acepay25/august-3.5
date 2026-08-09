# Component Audit Report — August 3.5

**Scope:** every `.ts/.tsx` file under `components/` (95 files), all 19 hooks in `hooks/`, plus targeted verification reads of `App.tsx`, `types/analysis.ts`, and `services/ui/SetupWatchService.ts` to validate prop-threading and snapshot-stability claims.

**Method:** full-file reads (no line limits except where noted), inline severity tags, and CodeQL-style verification of every suspicious finding against the actual types/services before reporting. No code changes were made — this is a findings-only audit.

---

## Severity Summary

| Severity | Count | Nature |
|---|---|---|
| HIGH | 0 | — |
| MEDIUM | 5 | Wrong behavior in real flows (mislabels, wrong strategy applied, invisible control) |
| LOW | ~20 | Dead props/controls, perf, a11y, stale-state edges |
| Refuted | 12 | Suspects verified against code/types and cleared |

---

## MEDIUM Findings

### M1. `AnalysisResult.tsx:273-274` — `clearInterval(interval)` referenced before `interval` is declared (TDZ)
```ts
checkEntry();                                   // line 273 — runs synchronously first
const interval = setInterval(checkEntry, 30000); // line 274
```
Inside `checkEntry` (`AnalysisResult.tsx:217`), the early-exit branch at line 226-229 runs **synchronously before the first `await`**:
```ts
if (autoEntryStatus?.wasActiveBeforeExpiry) {
    clearInterval(interval);  // line 227 — TDZ ReferenceError
    return;
}
```
When the effect re-runs because its own `setStatus` flipped `wasActiveBeforeExpiry` to `true` (the exact state that means "entry hit — stop polling"), `checkEntry()` hits the TDZ before line 274 executes. The `ReferenceError` is swallowed by the try/catch at line 268, a **new** interval is created at line 274, and polling continues one extra 30s tick before the interval callback's own `clearInterval` (now legal) stops it.

**Impact:** one redundant kline API call per entry-hit transition; an exception is silently swallowed. Not an infinite loop (the summary's earlier hypothesis) — it self-corrects after one extra tick — but the "stop polling immediately" intent is defeated and the error path is invisible.

**Fix:** declare `const interval = setInterval(...)` **above** `checkEntry()`, or only clear from inside the interval callback.

---

### M2. `AnalysisResult.tsx:638-640` — "+ Add" strategy button applies the wrong strategy
```tsx
{activeStrategies.some(s => !activeFrameworks.includes(s)) && (
    <button onClick={() => onApplyStrategy(activeStrategies[0])} ...>+ Add</button>
)}
```
The guard checks whether **any** strategy is missing, but the handler applies `activeStrategies[0]` unconditionally. If `activeStrategies[0]` is already in `activeFrameworks` while a later entry isn't, the button is shown but clicking it is a no-op (`handleApplyStrategy` in App.tsx:1781 checks `includes` and returns).

**Fix:** apply the first non-active strategy:
```ts
onClick={() => onApplyStrategy(activeStrategies.find(s => !activeFrameworks.includes(s))!)}
```

---

### M3. `OutcomeMismatchModal.tsx:83` — hardcoded "TP before SL" sentence rendered for every mismatch
```tsx
<p className="text-xs text-yellow-500/80 ...">
    The Take Profit was reached <strong>BEFORE</strong> the Stop Loss.
</p>
```
This renders unconditionally, but the modal is shown for **both** mismatch polarities. When the user logged WIN while price data shows SL touched first and no TP hit (the SL-first case), the bullet list correctly shows only "SL Touched" (lines 76-79, `tpFirstTime` is `null`), while the summary sentence still claims "The Take Profit was reached BEFORE the Stop Loss" — actively wrong.

**Fix:** derive the sentence from `priceValidation`:
```ts
const tpHitFirst = tpFirstTime && (!slTouchTime || tpFirstTime < slTouchTime);
// tpHitFirst ? "TP was reached BEFORE the SL." : "The SL was touched BEFORE any TP."
```

---

### M4. `ProbabilityPanel.tsx:72-79` — Regenerate button renders with no visible content
```tsx
<button
    onClick={() => onRegenerateProbabilities?.(probMode, selectedMessageId!)}
    disabled={isCalculating || !selectedMessageId}
    className={`p-1 rounded hover:bg-zinc-700 ...`}
    title="Regenerate Probability Analysis"
>
    {/* empty — no icon, no text */}
</button>
```
The button has no children (the refresh icon was evidently stripped when lucide icons were removed). It is clickable, takes layout space, and has a `title` tooltip, but renders as an invisible empty square. The regenerate feature is functionally unreachable.

**Fix:** add an icon/character (e.g. `↻`) or remove the control.

---

### M5. `LiveStreamView.tsx:61-65, 165-172` — auto-close can hang on an analyst with a `null` output (downgraded from earlier MED)
```ts
useEffect(() => {
    if (isFinished && output !== null) { onTypingComplete(); }
}, [isFinished, output, onTypingComplete]);
...
if (isVisible && activeAnalysts.length > 0 && activeAnalysts.every(analyst => completedTyping.has(analyst))) { ... onAllTypingComplete() }
```
An analyst whose `output` stays `null` (provider error, no report produced) never fires `onTypingComplete`, so `completedTyping` never contains it and the auto-close timer never fires.

**Mitigation found during verification:** the parent `usePostMortem` finally block (`usePostMortem.ts:565-577`) always calls `setIsLivePostMortemVisible(false)`, so the overlay is closed regardless — this path is redundant, not fatal. Remains a latent trap if the parent's fail-safe is ever removed, and the overlay *does* stay visible until the parent's async run fully settles (which can be long after the last successful panel finished).

---

## LOW Findings

| # | File:Line | Finding |
|---|---|---|
| L1 | `components/analysis/BacktestPanel.tsx:45,59-61` | `const { entryPoints = [] } = analysis || {}` — the `= []` default is unreachable per type (`types/analysis.ts:80` declares `entryPoints: EntryPoint[]` required), but if runtime data ever violates the type (undefined `analysis` or `entryPoints`), the fresh default array identity re-fires the `[entryPoints]` effect → `setSelectedBacktestEntries(map(...))` → **infinite render loop**. Defensive default without defensive identity = hazard. Also leftover debug: `console.log('Backtest Result Debug:', ...)` at lines 70-75. |
| L2 | `components/analysis/PriceAlertToggle.tsx` | Local `alertEnabled` state initialized once from `PriceAlertService.getAlertForTrade(messageId)` — stale if the same card slot rebinds a new messageId. Also hardcodes `createAlert(messageId, analysis, 0.5)` TP multiplier instead of reading the analysis. |
| L3 | `components/analysis/ShareMenu.tsx` | Dead prop `messageId: string` (declared, never destructured); `setTimeout(..., 2000)` reset of `shareSuccess` never cleared on unmount (harmless setState-on-unmounted risk is real). |
| L4 | `components/analysis/VisionDataViewer.tsx` | Early `if (!isVisible) return null` makes the `translate-x-full` exit transition unplayable (dead CSS); unlike every other modal, no Escape handler and no focus trap. |
| L5 | `components/market/LiveMarket.tsx` | `const [interval, setInterval] = useState('15m')` shadows the global `setInterval` — currently safe (all call sites use `window.setInterval`, e.g. line 492), but any future bare `setInterval` call throws `TypeError: setInterval is not a function`. Duplicate `id="live-market-insights"` on the loading placeholder and the expanded content (invalid HTML / duplicate DOM ids). |
| L6 | `components/settings/SettingsMenu.tsx` | `readyConfigProviders = (providerConfigs ?? []).filter(...)` creates a new array every render and sits in the deps of the OCR-heal effect (~line 257) → effect body runs every render (cheap, no loop). Moderator model isn't cleared when switching to a provider with no models → stale model id renders a blank model select. |
| L7 | `components/settings/ProviderManager.tsx` | `onRemoveProvider(selected.id)` not awaited before `remaining` is computed — works because `remaining` derives from the pre-delete `configs` prop, but is fire-and-forget. |
| L8 | `components/journal/TradeLog.tsx:69,73,475` | `ocrModelIdToName` is threaded through `TradeLogRowProps` → destructured → passed down, but **never read** in the rendered body — dead prop through three layers. `localLeverage` state initialized from the `leverage` prop but never re-synced if the prop changes externally. |
| L9 | `components/journal/UpdateTradeModal.tsx`, `components/modals/PostTradeUploadModal.tsx` | Image cap edge: `setImages(prev => [...prev, ...placeholders].slice(0, 5))` combined with `processImagesForSummarization(newFiles, images.length, ...)` using the **stale closure** `images.length` — if ≥4 images are already staged, new uploads are processed at indices past the 5-cap but never displayed. |
| L10 | `components/modals/ScenarioSimulator.tsx` | Inner 50ms Monte-Carlo timer is only cleared when the *next* debounced `runFullAnalysis` begins (~300ms later), not on input change — a stale simulation can briefly overwrite a fresh one. Also no focus trap (unlike sibling modals). |
| L11 | `components/chat/ChatArea.tsx` | `chatInputProps` object literal recreated every `ChatAreaInner` render defeats the memoized `ChatInput` (LOW perf). (The analogous `MessageItem` concern via `chatContext` is **refuted** — see R1.) |
| L12 | `components/analysis/AnalysisResult.tsx` | Extended-SL direction check uses raw `direction === 'Long'` while line 319 defensively computes `safeDirectionString` for the `'Neutral'`-as-object edge — inconsistent long/short handling. Also local `alertsSet` state persists when the same card slot renders a re-run analysis, potentially showing "✓ Alerts set" for a setup with no alerts. |
| L13 | `components/settings/AnalystLensSettings.tsx` | Embeds a `<style>` tag with generic global class names (`.role-card`, `.style-button`) — collision risk if the classes are reused elsewhere. |
| L14 | `components/journal/PerformanceReview.tsx` | If the `summarizationProvider` config is deleted, the model list is empty → blank model select (same family as the SettingsMenu stale-model issue, L6). |
| L15 | `components/settings/PromptEditorModal.tsx` | No Escape-to-close (every other modal has it). |
| L16 | `components/dashboards/VersionHistoryDashboard.tsx` | No Escape close (backdrop click only); `selectedVersionId` is dead state (dropdown has a single option, line 378); `selectedRuleIndex`/`selectedInsightIndex` are not clamped when the `rules`/`insights` arrays shrink between 5s polls. |
| L17 | `components/dashboards/LearningDashboard.tsx:80` | `loadLearningRules()` in `useMemo(..., [])` — new rules learned while the tab is open never appear until remount (tab-switch dependent). |
| L18 | `components/analysis/HybridDataPanel.tsx`, `CalibrationWidget.tsx` | Dead props: `onClose?: () => void` (HybridDataPanel — panel has its own collapse control) and `coinName: string` (CalibrationWidget — never destructured). |
| L19 | `components/analysis/SetupWatchControl.tsx` | `fmtPrice(currentPrice) || 'fetching…'` is a dead branch (`fmtPrice` returns `'—'` for invalid input, never `''`); popover lacks Escape handling. |

---

## Refuted / Verified Non-Issues

| # | Suspect | Verdict |
|---|---|---|
| R1 | `MessageItem` memo defeated by `chatContext` identity churn | **Refuted.** `chatContext` is built with `useMemo` and an explicit dep list (`App.tsx:2345-2382`); all handlers are `useCallback` (App.tsx:1777-1782 documents the fix). Streaming chunks do not change any dep, so `MessageItem` stays memoized during streams. |
| R2 | `SetupWatchControl` `useSyncExternalStore` infinite loop | **Refuted.** `getWatchForMessage` (`SetupWatchService.ts:128-130`) returns the **stored** `SetupWatch` object reference via `Array.from(...).find()` — identity is stable until the map actually mutates, so the snapshot only changes on real changes. |
| R3 | `OutcomeMismatchModal` unconditional `useEscapeClose(true, ...)` when hidden | **Refuted.** The modal is mounted only when visible (`App.tsx:2626`: `{showMismatchModal && mismatchData && ...}`), so the listener is removed on unmount. The `isVisible` guard inside is dead but harmless. |
| R4 | `BacktestPanel` infinite render loop | **Downgraded to L1** — `entryPoints` is a required field (`types/analysis.ts:80`), so the loop only fires if runtime data violates the type. |
| R5 | `SetupLifecycleCard` calls `getSetupLifecycle(analysis, outcome, Date.now(), ...)` per render | Non-issue — no timer; `Date.now()` is a one-shot snapshot, purely static render. |
| R6 | `LiveMarket` `showNotification` used before declaration (line 574 vs 408) | Safe — effect runs post-render; closure resolves to the initialized const. |
| R7 | `QuickActionChips` docked layout ignores `disableNewAnalysis` | Unreachable — docked mode only renders when messages exist. |
| R8 | `StrategySearch` double-checks `status === 429` | Redundant, benign. |
| R9 | `ProviderManager` delete not awaited | Correct — `remaining` is computed from the pre-delete prop list. |
| R10 | `VersionHistoryDashboard` `loadData` used in effect before declaration | Safe — same closure pattern as R6. |
| R11 | `WinRateDashboard` early return (`tradesWithOutcomes.length < 3`) | All hooks run before the early return — hook order is consistent, memoized props fine. |
| R12 | `useAnalysisPipeline`/`usePostMortem`/`useTradeLogging` hygiene | Verified clean: run-id + AbortController guards for account switches, `Promise.allSettled` with index-aligned attribution (no re-indexed `results` array), cached analysis wrapper with full mode fingerprint, RAF-throttled stream updates with `flush()`. |

---

## Positive Patterns (worth preserving)

- **`AnalysisResult.tsx`** — module-level 60s countdown ticker fanned out to PENDING cards (single `setInterval`), guarded `setStatus` that avoids pointless re-renders.
- **`useRafThrottle`** — per-frame coalescing of stream updates + synchronous `flush()` at stream end; used correctly in the debate and reasoning loops.
- **Response cache** (`useAnalysisPipeline` `cachedAnalyzeTradingView`) — keyed on image hashes + prompt + model + a hashed mode-context (submode, role prompts, instructions, learning flags, bounded history fingerprint, provider id), with reasoning replay on hits. Message ids deliberately excluded so same-chart repeats can hit.
- **Account-switch safety** (`usePostMortem` P0-2) — run-id bump + abort, with `isRunStale` re-checks after every await before any state write; memory/learning steps are best-effort so a report is never turned into "Failed".
- **`useConversations`** — 200-message cap with first-message preservation (the anchor request that re-analyses reference).
- **`useSaveOnUnload`** — synchronous flush on `pagehide`/`beforeunload`/`visibilitychange` with reentrancy guard and dirty-tracking; covers the mobile Capacitor gap.
- **Modal convention** — `useEscapeClose` + `useFocusTrap` pair on nearly all modals, with focus restore; `ConfirmDialog` + undo-toast replacing `window.confirm`.
- **`ThinkingStore`** — outcome correlation (`updateThinkingOutcome`), trade-id canonicalization, dedupe by message id, JSONL export for fine-tuning.
- **Sanitization discipline** — `sanitizeTradeAnalysis`/`sanitizeAIResponse` at every AI boundary; error-message scrubbing (long key-like tokens → `***`) before rendering (useAnalysisPipeline:2315-2319).

---

## Recommended Priority

1. **M1, M2, M3** — small, surgical, directly user-visible correctness bugs (fixable in minutes each).
2. **M4** — restore the regenerate icon or remove the control.
3. **L1** (BacktestPanel) — remove the debug `console.log`; consider guarding `analysis` presence at the call site and dropping the `= []` default or memoizing it.
4. **L5** (LiveMarket `interval` shadow) — rename the state variable; the duplicate `id` is a one-line fix.
5. Rest are backlog hygiene items.
