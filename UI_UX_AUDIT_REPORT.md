# UI/UX Audit — August 3.5 Trading Terminal

**Scope:** Full pass over `App.tsx`, `index.css`, and ~60 component/hook files. Every finding cites concrete JSX/CSS.
**Severity:** **P1** = breaks meaning/usable state · **P2** = significant defect · **P3** = polish/consistency.

---

## A. Theme-scope violations — semantic colors silently render as monochrome gray

The design system (`index.css:8-109`) remaps every color family to cool grays, restoring real colors only inside `.analysis-card, .status-surface` (`index.css:117-174`). Any `emerald/rose/amber/yellow/red/blue/purple/…` class rendered *outside* those scopes silently loses its meaning. These are real defects, not aesthetic choices.

### A1. [P1] Settings flow has NO `status-surface` — status hierarchy is inverted
`components/settings/*` — `SettingsMenu.tsx` dialog root and every settings view (ProviderManager, AlertManager, BackupManager) lack `status-surface`.

- ProviderManager status dots: ready `bg-emerald-400` → **#b0b0b6 (light gray)**, missing-key `bg-amber-400` → **#8aabd8 (accent blue — because amber globally maps to blue, `index.css:70`)**, disabled `bg-zinc-600`. Result: **"ready" reads duller than "incomplete"**, and "incomplete" is the only item that gets the app's accent color. Visual hierarchy is exactly backwards.
- "Enabled" pill `bg-emerald-500 text-zinc-950` → flat gray.
- AlertManager / BackupManager success (`emerald`) and error (`rose`) feedback → indistinguishable grays.

**Fix:** add `status-surface` to the SettingsMenu dialog surface (the exact pattern EquityCurveDashboard documents, see G1).

### A2. [P1] Saved analyses (journal aside) — destructive buttons lose red
`components/journal/SavedAnalyses.tsx` — no `status-surface`. "Clear All Saved" / "Delete Selected" `bg-rose-600 hover:bg-rose-700 text-white` render as **dark-gray-on-dark-gray** (`rose-600` → #3a3a40). Destructive actions are supposed to be opted into color; here they're invisible as such.

### A3. [P2] SavedAnalysesGallery — direction colors gray
`components/dashboards/SavedAnalysesGallery.tsx` — no `status-surface`; Long/Short `text-emerald-400`/`text-rose-400` render gray. Also uses `backdrop-blur-sm` (inconsistent with the "glassmorphism removed" note in `index.css`).

### A4. [P2] StrategySearch — the entire family/color identity layer is gray
`components/shared/StrategySearch.tsx` — the slide-in aside has no `status-surface`.
- `getFamilyColorClasses` (lines 142-150) maps red/emerald/blue/purple families → all gray. Market-classification family cards lose their distinguishing colors.
- "Auto-Discover" button `bg-purple-600/20 text-purple-300` (line 190) → gray.
- Error box `text-red-300` (line 201), win-rate badges `text-yellow-300` (line 254) → gray.

### A5. [P2] LiveStreamView vs EnsembleProgressChat — same concept, opposite treatment
- `components/analysis/LiveStreamView.tsx:189` — `role="dialog"` root has **no** `status-surface`; its class-based per-provider palette remaps to gray.
- `components/analysis/EnsembleProgressChat.tsx` — ACCENTS use **inline hex styles** (`style={{ borderColor, color }}`), which bypass the Tailwind remap entirely → analyst avatars render in real `#34d399`/`#fb7185`/`#8aabd8`.

Same per-provider identity feature renders colored in one surface and gray in the other. Pick one (ideally: give both `status-surface`).

### A6. [P2] `green-*` is never restored — even inside status-surface
`components/dashboards/ModelPerformanceDashboard.tsx:128-131, 214` (HOT badge `bg-green-500/20 text-green-400`, "consecutive wins" `text-green-400`) and `LearningDashboard.tsx:44,65` (CalibrationBar). The restore block (`index.css:117-174`) lists emerald/rose/yellow/amber/orange/blue/purple/violet/indigo/red — **not** `green`. Inside Journal (which has `status-surface`), COOLING (yellow) and DEMOTED (red) render real colors while HOT renders gray. Either use `emerald-*` or add `green` to the restore block.

### A7. [P2] UpdateOverlay — full-screen "ready to install" state is gray
`components/shared/UpdateOverlay.tsx:71-85` — the full-screen download overlay (mounted at App root, outside any `status-surface`) uses `bg-emerald-500/10 text-emerald-400` (line 71) and the Install button `bg-emerald-600` (line 80) → gray. The "green = safe to proceed" signal of a system-level update screen is exactly the status meaning that should be restored.

### A8. [P2] ErrorBoundary crash screen — error semantics gray
`components/shared/ErrorBoundary.tsx:77,92` — "Something went wrong" `text-rose-400` and detail `text-rose-300` render gray on the one screen whose entire job is to say "error". Also contains an empty `<div className="text-6xl mb-4"></div>` icon slot (line 74) and no `role="alert"`.

### A9. [P3] ImagePreview remove chip — destructive red lost
`components/shared/ImagePreview.tsx:29` — `bg-red-600` remove button (chat composer) renders dark gray.

### A10. [P3] CustomInstructionsEditor — over-limit / delete signals gray
`components/settings/CustomInstructionsEditor.tsx:74,188,194` — delete hover `hover:text-red-400`, word-count overflow `text-red-400`/`bg-red-500` → gray in the settings scope.

### A11. [P2] WinRateDashboard — colored stat cards + deliberately gray charts (mixed semantics)
`components/dashboards/WinRateDashboard.tsx`:
- Stat cards use real Tailwind classes `text-emerald-400`/`text-rose-400`/`text-yellow-400` (lines 215, 232, 240) — rendered inside Journal's `status-surface` → **real colors**.
- Charts use a hardcoded pre-grayed palette (lines 34-57: `cyan: '#b0b0b6'`, `emerald: '#d2d2d6'`, …) → **monochrome**.
- Worse: `rose: '#6b6b73'` and `orange: '#6b6b73'` are **the same hex** (lines 37-39) → Low- and Avoid-confidence bars/legend entries are indistinguishable (lines 291, 304).

One dashboard, two semantics: the number above the chart is green/red while the chart showing the same data is gray. And two distinct categories share a color.

### Verified-OK (for the record)
Header HAS `status-surface` (`Header.tsx:160`) → UpdateButton's emerald badge is fine. ProbabilityWidget/ProbabilityPanel/MonteCarloPanel inherit status-surface via LiveMarket/AdvancedAnalyticsSidePanel roots. ScenarioSimulator's purple is fine (purple is in the restore block, `ScenarioSimulator.tsx:211`).

---

## B. Accessibility

### B1. [P1] Primary composer has no visible focus indicator
`components/chat/ChatInput.tsx` — textarea `outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0`, no `<label>`. Keyboard users cannot see where they are typing. Global CSS strips `outline` on inputs (`index.css`), so nothing replaces it.

### B2. [P1] `aria-modal="true"` dialogs without focus traps (Tab escapes to background)
Confirmed via grep/read — the trap hook exists (`hooks/useFocusTrap.ts`) and several modals apply it correctly (see G2), but these do not:
- `DataCaptureModal.tsx` — **imports `useFocusTrap` but never applies the ref**; `role="dialog" aria-modal="true"` with only `autoFocus` on the PnL input.
- `Journal.tsx` — `aria-modal="true"` aside, only `useEscapeClose`.
- `LiveStreamView.tsx:189` — `role="dialog" aria-modal="true"`, no trap.
- `ScenarioSimulator.tsx:211` — `role="dialog" aria-modal="true"`, no trap; Esc is a bare `window` listener (lines 180-186) that does **not** stopPropagation → it can fire the App-level Esc gate simultaneously (see C2).
- `UserProfileManager.tsx:60` — `role="dialog" aria-modal="true"`, no trap.
- `PromptEditorModal.tsx:43` — `role="dialog" aria-modal="true"`, no trap, no Esc (Esc bubbles to SettingsMenu's handler and closes the whole settings menu).
- `VersionHistoryDashboard.tsx:346` — full-screen modal with **no `role="dialog"`, no `aria-modal`, no trap, no Esc** at all.
- `StrategySearch.tsx:159` — slide-in drawer: no `role="dialog"`, no trap, no Esc.

### B3. [P1] Off-screen surfaces stay in the tab order
- `StrategySearch.tsx:159` — always mounted at `App.tsx:2481`; when closed it is only `translate-x-full` (no `invisible`/`pointer-events-none`/`aria-hidden`) → Tab focuses invisible controls behind the app.
- `VisionDataViewer.tsx` — same pattern (drawer always in DOM).
- `AdvancedAnalyticsSidePanel.tsx` — desktop side panel is `md:hidden`-gated on mobile but focusable elements remain reachable.

### B4. [P2] UserProfileManager — no dismiss path, dead-end modal
`components/settings/UserProfileManager.tsx` — the modal has **no close button, no backdrop click, no Esc, no cancel**. The only exits are: select an existing user, create a user, or delete a user. Once opened, a user cannot leave without taking an action. (Also: `isUserModalOpen` is missing from `OVERLAY_KEYS` in `useUIState.ts`, so `CLOSE_ALL_OVERLAYS` doesn't close it either.)

### B5. [P2] Invisible-but-focusable & non-keyboard controls
- `PerformanceReview.tsx` — selection "checkbox" is a plain `<div>` (not keyboard operable); delete button `opacity-0 group-hover:opacity-100` is Tab-focusable while invisible and unusable on touch.
- `UserProfileManager.tsx:80-92` — existing-user rows are clickable `<div>`s (`cursor-pointer` + onClick, no `role="button"`/`tabIndex`); delete is `opacity-0 group-hover:opacity-100` with `title` only.
- `ModelPerformanceDashboard.tsx:368` — refresh spinner is an **empty `<span className="animate-spin"></span>`** → the "Refreshing…" state shows an invisible spinner.
- `ProbabilityPanel.tsx:72-79` — the Regenerate button contains **only whitespace** (no icon) → invisible but focusable; when `isCalculating` it becomes `animate-spin opacity-50` on empty content.
- `ErrorBoundary.tsx` — crash screen has no `role="alert"` and no focus management; focus is left on a destroyed element.

### B6. [P2] Unnamed icon buttons
- `AnalysisResult.tsx` — action-bar buttons (Share/Think/Update/Save) hide their text on mobile (`hidden sm:inline`) with **no `aria-label`** → unnamed icon-only buttons.
- `EnsembleProgressChat.tsx` — retry `↺` has `title` only, no `aria-label`.
- `VersionHistoryDashboard.tsx:385-390` — close button icon-only, no `aria-label`.
- `StrategySearch.tsx:163` — close button icon-only, no `aria-label`.
- `ScenarioSimulator.tsx:288-367` — `-`/`+` steppers are icon-only text buttons with no `aria-label` (name will be "-" / "+").

### B7. [P2] Command palette
`components/shared/CommandPalette.tsx` — no `aria-activedescendant`/`aria-selected` on list items; no scroll-into-view for the active item in the `max-h-72` list.

### B8. [P2] Focus details
- `TradeLog.tsx` — leverage input `outline-none` with no ring/border change → invisible focus.
- `Header.tsx` — mobile drawer: focus is not returned to the hamburger trigger on close.
- `ToggleSwitch.tsx` — no `focus-visible` ring (relies on the browser's default button outline, unlike the app-wide `ring-2 ring-cyan-400` pattern).
- `ConfirmDialog.tsx:129` — on open, focus lands on the **first button in the dialog, which is the header X close button** (odd initial focus; the confirm action would be better).
- `ConfirmDialog.tsx:193` — Undo toast has no `role="status"`/`aria-live` → screen readers don't announce "Action completed".

### B9. [P3] Tiny text compounding a11y
8–11px text is pervasive (see Section F); `text-[8px]` appears in HybridDataPanel (~15×), `ScenarioSimulator.tsx:511`, `ProbabilityPanel.tsx:176/200/220`, `MonteCarloPanel.tsx:78-99`, `WinRateDashboard.tsx:331`.

---

## C. Functional / interaction defects

### C1. [P1] Esc-gate gaps — Esc cancels analysis behind open surfaces
`App.tsx:822-836` — the global Esc handler cancels an in-progress analysis only when *none* of a hardcoded list of overlays is open. Missing from the list: `isAdvancedAnalyticsOpen`, `isVisionDataVisible`, `showMismatchModal`, `isMobileMenuOpen`, `isStrategySearchVisible`, `isVersionHistoryVisible`. Consequences:
- Esc while the Playbook drawer or Version History modal is open → **cancels a running analysis** (those surfaces have no Esc of their own, so Esc does nothing visible to them).
- AdvancedAnalyticsSidePanel / VisionDataViewer have no own Esc → Esc cancels analysis instead of closing the panel (only modals with their own capture-phase `useEscapeClose` are safe).

### C2. [P2] ScenarioSimulator double-fire
`ScenarioSimulator.tsx:180-186` registers a **bubble-phase `window` keydown** without `stopPropagation`, and `simulatorCandidate` isn't in the App gate → pressing Esc can close the simulator **and** cancel the analysis behind it.

### C3. [P1] Trade Log: dead clear-all + no delete confirmation
`components/journal/TradeLog.tsx` — `onClearAllTrades` exists in the props interface (line 17) and is destructured (line 334) but **never invoked anywhere** (grep-verified) → there is no way to clear all trades from the Trade Log tab. The delete-selected flow has no confirmation.

### C4. [P2] Trade Log affordances
Rows are expandable via `cursor-pointer` with **no chevron/affordance**; no search box (Virtuoso list, filter-by-type only).

### C5. [P2] DebateChat consensus strip
`components/analysis/DebateChat.tsx` — 8+ controls (Copy transcript, Replay, Pause/Step/Speed/Jump-round/Exit) are all `text-[9px]` (tiny touch targets, exempt from the mobile 44px bump, see F2). Copy has **no success/failure feedback** (silent `catch`). The thinking popover has no Esc handling (outside-pointerdown only).

### C6. [P2] LiveMarket
`components/market/LiveMarket.tsx` —
- Duplicate `id="live-market-insights"` on two nodes (invalid HTML, ambiguous anchors).
- App-level Esc **closes the entire LiveMarket view even when the alert-setup popover is open** (innermost should close first).
- Alert popover is a non-dialog absolute panel (no trap, no role).
- Two empty `<span>` icon slots (lines ~907, ~952).

### C7. [P2] AdvancedAnalyticsSidePanel desktop flow
`components/dashboards/AdvancedAnalyticsSidePanel.tsx` — **no close button in the desktop header, no desktop backdrop** (`md:hidden`), no own Esc → the only desktop close path is re-clicking the external toggle, and Esc cancels the analysis instead. The static footer "Enable Hybrid Intelligence to see live results" renders even when data is present. `icon=""` passed to SectionCard in every panel (empty icon slots). `scrollbar-thin scrollbar-thumb-zinc-700` classes have no matching utilities (no scrollbar plugin in `package.json`; the global `::-webkit-scrollbar` rule in `index.css:229-247` already styles scrollbars — the classes are no-ops).

### C8. [P2] Two competing alert affordances + silent toggle
`AnalysisResult.tsx` + `PriceAlertToggle.tsx` — both offer price-alert entry with different UIs; `PriceAlertToggle` gives no feedback on toggle and hardcodes a 0.5% threshold with no explanation.

### C9. [P2] Dead copy affordance
`useJournalUI.ts:21` — `copiedMessageId` state is wired through App but **no copy button is ever rendered** (confirmed: `handleCopy` exists, no button calls it).

### C10. [P2] Header save-status gap
`Header.tsx` — `saveStatus === 'ERROR'` renders **nothing** (user gets no error signal for a failed save); `isLoading`/`isRateLimited` are destructured but never referenced in JSX.

### C11. [P2] Chat composer layout jumps
`ChatArea.tsx` — placeholder area jumps `h-72` → `h-[40rem]` when loading; docked quick-action chips are fixed at `bottom-[140px] lg:bottom-[180px]` and don't track the composer growing (multi-line input overlaps chips).

### C12. [P2] Dead animation classes — `tailwindcss-animate` is NOT installed
`package.json` has no `tailwindcss-animate`; `index.css` defines no `animate-in`/`zoom-in`/`slide-in-from-*`. These classes are **silent no-ops**:
- `ConfirmDialog.tsx:148` `animate-in fade-in zoom-in-95 duration-200` (dialog open animation missing)
- `ConfirmDialog.tsx:193` `animate-in slide-in-from-bottom-4 duration-300` (undo toast)
- `Header.tsx:201` session popover `animate-in fade-in zoom-in-95`
- `AdvancedAnalyticsSidePanel.tsx:191` `animate-in slide-in-from-top-2`
- `VersionHistoryDashboard.tsx:145,266,319` `animate-in fade-in slide-in-from-bottom-4`

(The app's own `animate-fade-in`/`animate-slide-in-right` are defined in `index.css:263,279` and work.)

### C13. [P3] Duplicate conflicting overflow classes
`AccuracyModeModal.tsx:23` and `DataCaptureModal.tsx` — same element gets `overflow-hidden` + `overflow-y-auto` (one silently wins; also `max-h-[90vh]` + `overflow-hidden` can clip content).

### C14. [P3] DecisionRecord redundancy
`DecisionRecord.tsx` — "High → High" style pass-through of confidence into outcome label adds no information.

### C15. [P3] BacktestPanel close button
`BacktestPanel.tsx` — close control is `text-[10px]` with an `animate-pulse` status that can pulse indefinitely.

### C16. [P3] VersionHistoryDashboard single-option dropdown
`VersionHistoryDashboard.tsx:372-383` — version `<select>` has exactly one option ("Version 6.0 (Current)") and `selectedVersionId` is never used (comment says v4/v5 were removed) → dead control.

---

## D. Dead code / unused modules

| Finding | Evidence |
|---|---|
| **`hooks/useAppRouter.ts` is dead** — the only file importing `wouter`. No hash router anywhere → **no browser-back support in the app**; overlay navigation is boolean-flag only. | `App.tsx` never imports it; `useAppRouter.ts` is the sole `wouter` consumer |
| **`UpdateNotification.tsx` is dead** — the legacy colored update banner is never imported. | grep: only self-reference |
| **`TradeLog.onClearAllTrades`** dead prop (see C3) | interface line 17 + destructure line 334 only |
| **Header `isLoading` / `isRateLimited`** unused | destructured, never in JSX |
| **Empty icon/emoji slots** (rendered whitespace): EntryNotHitCaptureModal, DataCaptureModal, MemorySettings, ScenarioSimulator:218, ProbabilityWidget:71, ProbabilityPanel:254, MonteCarloPanel:157, ModelPerformanceDashboard:352, CustomInstructionsEditor:204, ErrorBoundary:74, AnalystLensSettings:85 (`lens-icon`), AnalystLensSettings `TRADING_STYLES` — all four `emoji: ''` values render empty spans | read/grep |
| **`scrollbar-thin scrollbar-thumb-*`** — no `tailwind-scrollbar` plugin in `package.json`; likely undefined utilities | AdvancedAnalyticsSidePanel, VersionHistoryDashboard:199,242,305 |
| **`tailwindcss-animate` class no-ops** | see C12 |

---

## E. Visual design / consistency

### E1. [P2] AnalystLensSettings — inline `<style>` island
`components/settings/AnalystLensSettings.tsx:213-441` — embeds a raw `<style>` block with a hardcoded rgba palette (`#1e1e28`, `#282837`, `#8a8a92`, `#b0b0b6`). This surface does not participate in the Tailwind theme at all: different radii, different grays, and `:focus { outline: none; border-color: #8a8a92 }` (a gray focus border — no ring). Empty `.lens-icon` and four empty `.style-emoji` spans. Convert to theme utilities or at least align focus treatment.

### E2. [P2] WinRateDashboard mixed semantics + duplicate chart colors
See A11 (colored numbers + gray charts; Low/Avoid same color).

### E3. [P2] Glassmorphism inconsistency
`SavedAnalysesGallery.tsx` still uses `backdrop-blur-sm`; `index.css` removed the glass aesthetic elsewhere ("glassmorphism removed" note in theme). `glass`/`glass-panel` classes exist in CSS (`index.css:421,435`) and are used in Header/others — the gallery's blur is the outlier.

### E4. [P3] Empty-state placeholders use blank icon divs
`ProbabilityPanel.tsx:254`, `MonteCarloPanel.tsx:157`, `ErrorBoundary.tsx:74` etc. — `text-2xl`/`text-6xl` empty divs where an icon belongs (see D table).

### E5. [P3] DataCaptureModal / AccuracyModeModal overflow class conflicts
See C13.

### E6. [P3] ConfirmDialog initial focus on the X button
See B8.

---

## F. Tiny text & touch targets (cross-cutting)

- **`text-[8px]`**: HybridDataPanel (~15 uses), ScenarioSimulator:511, MonteCarloPanel:78-99, ProbabilityPanel:176/200/220, WinRateDashboard:331, StrategySearch:261.
- **`text-[9px]` / `text-[10px]`**: pervasive — DebateChat consensus strip, TradeLog, LiveMarketDataView, ProbabilityWidget, ModelPerformanceDashboard, ReasoningDashboard labels, CustomInstructionsEditor tabs, WinRateDashboard date presets, Toast "+N more", OnboardingCard hints.
- **Mobile 44px bump exemption**: the mobile media query in `index.css` enforces 44px min touch targets but **exempts buttons carrying `text-[9px]`/`text-[10px]`** — exactly the dense controls above, which stay ~24-28px tall on touch devices (e.g. WinRateDashboard presets `py-1.5 text-[9px]`, ScenarioSimulator steppers, DebateChat transport).
- These tiny controls are simultaneously a legibility problem and a touch-target problem; the exemption in `index.css` should be removed or the classes migrated.

---

## G. Patterns done right (worth standardizing)

- **G1.** `EquityCurveDashboard.tsx` — opts into `status-surface` with an explicit doc comment ("P&L meaning would be lost in the monochrome remap"). **This is the fix pattern for every A-section finding.**
- **G2.** `ConfirmDialog.tsx` — full manual focus trap (Tab cycle, Esc, backdrop cancel), `aria-modal` + `aria-labelledby`, destructive color inside `status-surface`, undo grace period.
- **G3.** `AccuracyModeModal.tsx` — `useFocusTrap` + `useEscapeClose` + `aria-label` (minus the overflow conflict, C13).
- **G4.** `ToggleSwitch.tsx` — proper `role="switch"`, `aria-checked`, `aria-label`, disabled state.
- **G5.** `Toast.tsx` — `status-surface`, `role="alert"` for errors / `role="status"` otherwise, `aria-live`, labeled dismiss, "+N more" cap.
- **G6.** `Spinner.tsx` — `role="status"` + `aria-label` (unlike the empty spinner spans in ModelPerformanceDashboard/ProbabilityPanel).
- **G7.** `ReasoningDashboard.tsx` — real `<button>`s, `aria-label` on export, status-surface-legal outcome pills, cancellation-safe effects.
- **G8.** `SettingsMenu.tsx` / `ProviderManager.tsx` — own trap, confirm dialogs, dirty-state tracking, validation.
- **G9.** `index.css` — safe-area insets, `prefers-reduced-motion` handling, global 6px scrollbar, app-level `overflow: hidden`.

---

## Suggested priority order

1. **A1/A2** (settings + SavedAnalyses status scopes) — one-class fixes that restore intended color semantics; also fixes A3/A5/A7/A8 in the same sweep.
2. **B2/B3** (traps on the six untrapped dialogs; hidden-surfaces focusability) + **B4** (UserProfileManager dismiss path) + **C1** (Esc gate).
3. **C3** (Trade Log clear-all) + **C12** (dead animations — remove the no-op classes or add the plugin).
4. **A6/A11** (green-* never restored; WinRateDashboard palette/duplicate colors).
5. **E1** (AnalystLensSettings style island), **B1** (composer focus), **F** (tiny-text/touch-target cleanup).

*Line numbers reflect the current tree at audit time; class names are grep-stable.*
