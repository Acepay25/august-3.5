# Implementation Plan: 10 App Improvements

## 1. Split App.tsx God Component

Extract three new hooks from App.tsx (~1826 lines → ~900 lines):

**`hooks/useAppInitialization.ts`**
- Move: `initializeApp` effect (line 756), `loadUserData` (line 628), `resetAppState` (line 527)
- Move: `existingUsernames` state, `activeUsername` state, `isLoading` gating
- Returns: `{ existingUsernames, activeUsername, isLoading, loadUserData, resetAppState, setActiveUsername }`

**`hooks/useAppSettings.ts`**
- Move: memory state (globalMemory, memoryConfig, memoryModel, isGlobalMemoryEnabled)
- Move: accuracy state (isAccuracyModeEnabled, accuracySubMode)
- Move: custom instructions state + Pure-AI toggles
- Move: summarization settings (activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, useAlgorithmicSummary, useAlgorithmicInsights)
- Move: lensConfig state
- Move: confidenceCalibration, insightKnowledgeBase
- Returns all state + setters as a single object

**`hooks/useJournalUI.ts`**
- Move: journalState, expanded/collapsed Record maps, selectedProbabilityMessageId, strategyToView, copiedMessageId, highlightedAnalysisId, postMortemCandidate
- Returns state + setters

App.tsx keeps: hook wiring, handlers, and JSX render.

## 2. Reduce Main Chunk Size

- Remove `external: ['protobufjs/minimal.js']` from vite.config.ts (unused)
- Convert eager service imports in App.tsx that are only needed post-login to dynamic imports where safe (e.g., `BackupService`, `DataIntegrityService`, `GlobalLearningService`)

## 3. Add Test Suite

New test files:
- `tests/providerConfigService.test.ts` — CRUD operations, defaults, merge logic
- `tests/analysisUtils.test.ts` — recalculateAnalysisMetrics
- `tests/conversationUtils.test.ts` — createNewConversation
- `tests/app.smoke.test.tsx` — renders App without crashing (mock heavy services)

## 4. Delete Stale Service Worker

- Delete `public/sw.js`
- Remove the entire SW registration block from `index.tsx` (lines 48-111: the `showUpdateNotification` state, `waitingWorker`, `setUpdateNotificationHandler`, `activateWaitingWorker`, and the registration code)
- Remove the `import { setUpdateNotificationHandler, activateWaitingWorker } from './index'` in App.tsx
- Remove the SW update notification effect in App.tsx

## 5. Add Splash Screen

Add inline HTML/CSS to `index.html` inside `<div id="root">`:
- Dark background matching the app theme (zinc-950)
- App name "August 3.5" + a CSS-only pulse animation
- Automatically removed when React renders (React replaces `#root` innerHTML)

## 6. Error Reporting (Diagnostics in Settings)

- Create `components/settings/DiagnosticsPanel.tsx`
- Reads `lastPromiseError` and `lastGlobalError` from localStorage
- Shows: timestamp, message, stack (collapsible)
- Add a "Diagnostics" section at the bottom of SettingsMenu
- Add a "Clear Errors" button

## 7. Clean Up Root Test Files

Delete from repo root:
- `test_text_truncation.ts`
- `test_truncation.ts`
- `test_truncation_standalone.ts`

## 8. Remove protobufjs External

- Remove `external: ['protobufjs/minimal.js']` from `vite.config.ts` build.rollupOptions (covered in #2)

## 9. Version Display in Settings

- In `SettingsMenu.tsx`, add a footer section showing the app version
- Use `window.electronAPI?.getVersion()` in Electron, fall back to a hardcoded version constant
- Create `constants/version.ts` exporting `APP_VERSION = '1.0.4'`
- Display: "August 3.5 v1.0.4" at the bottom of the settings panel

## 10. Bundle Fonts Locally (Offline Support)

- Download Inter (woff2, weights 400/500/600/700) and JetBrains Mono (woff2, weights 400/500/700) into `public/fonts/`
- Add `@font-face` rules in `index.css` with `font-display: swap`
- Remove the Google Fonts `<link>` tags and preconnect hints from `index.html`
- Update body/code font-family declarations to reference the local fonts

## Execution Order

1. Quick wins first: #7 (delete files), #8 (remove external), #4 (delete sw.js)
2. #10 (fonts), #5 (splash), #9 (version display)
3. #6 (diagnostics panel)
4. #1 (App.tsx split) — largest change, do carefully
5. #2 (chunk optimization)
6. #3 (tests) — last, so tests validate the final state
7. Final: `tsc --noEmit` + `vite build` + `vitest run` to verify everything