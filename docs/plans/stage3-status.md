# Stage 3 — status (read this first, then `stage3-arrangement.md`)

Branch `stage3-ui-arrangement`. A–E, F1, F2, F3a, F3b, F4a committed.
Gates per commit: `typecheck` + `test` (4623 passing, 483 files) + `lint`
(0 errors) + `build`; `render-probe` green after E, F2 and (E+)Learn's tabbed
sweep; `boot-probe` green after E. **Nothing here is unverified in the app.**

Phases A–E: `2abdd22` `2089d28` `3d824ba` `a5a8319` `20b64cf`.
Phase F: `a9add1f` F1 · `f80adc2` F2 · `34079eb` F3a · `cddd52a` F3b · `78ad437` F4a.

## Remaining, with the exact resume point

1. **F4b — amber model-fallback warning on the Chat surface.** The warning
   already exists and is shared: `components/trade/panels/ChatComposer.tsx:104-111`
   (`data-testid="model-fallback-warning"`, driven by props `modelIssue` +
   `provider`). It is dock-only today because the Chat surface's composer is the
   separate one inside `components/agents/AgentsView.tsx` (~:529-547, where the
   paperclip was handled in Phase C). The work is plumbing `modelIssue`/`provider`
   to that composer — do NOT duplicate the JSX. Verify with `render-probe`
   (a press/absence check on the testid), not just unit tests.
2. **F4c — Journal → Models tab reading planId-linked rows.** `LoggedTrade.planId`
   now exists and is stamped; `ModelPerformanceDashboard` still groups only by
   `modelsUsed`. Decide the actual feature before coding (planId gives
   plan-level, not model-level, attribution — it may belong in the Stats tab).
3. **G (strikeable) — Playbooks merge.** `StrategiesManager` upload → Studio;
   Settings → Playbooks becomes a pointer card.
4. PnL unit unification (F3 item) was NOT implemented as "compute dollars at
   resolution": no margin/position size is captured anywhere
   (`investmentAmount: undefined` at `hooks/useTradeLogging.ts`), so a derived
   dollar would be indistinguishable from a captured one. `rowPnlUsd`
   (`services/validation/SessionGuardService.ts:70`) stays the single derivation,
   and rows/exports label the unit. Needs a product decision: capture margin in
   DataCaptureModal, or accept percent-only rows.

## Facts paid for — do not rediscover

- Journal: embedded branch only (`isEmbedded` prop deleted); overlay + the
  "your calls vs verdict" stat deleted (nothing writes `userPriorCall`; see the
  purge note at `hooks/useWatchAndAutopilot.ts:110`).
- `VersionHistoryDashboard`: no props, no overlay shell, no tab strip; only mount
  is Learn → System. Its Algorithm placeholders and the hardcoded "Schema Version
  v2.0.0"/"Rule Engine" cards are gone.
- Settings → Journal routes through `openJournal` (App's one `handleOpenJournal`);
  the `settingsInitialTab` chain is deleted. `isUpdateAutoCapturing` is deleted
  everywhere incl. `types/user.ts` — `UpdateTradeModal` has no auto trigger.
  `isAutoCapturing` IS wired (`confirmAutopilotOutcome` → capture modal).
- `utils/recentTradesBrief.ts` is the ONLY place the journal is read in explicit
  log-time order; `computeJournalStats` counts the trailing run of whatever order
  it is handed, so sort before calling it. Dollar/percent PnL stay separate.
- `get_trade_log`: budget 4000 (a 20-row window measures ~2.7k — pinned by
  `tests/tradeLogTool.test.ts`), NOT in `CACHEABLE_TOOLS` on purpose, and absent
  from `MARKET_TOOLS` (journal, not market).
- Only the recent-form **tally** is injected into prompts
  (`services/learning/MemoryRetrievalService.ts` `recentFormBlock`, pushed for all
  stages/audiences + provenance `journal/recent-form`). Twenty rows would spend
  the stage budget skills/rules compete for; the rows are a tool call away.
- MAE/MFE: measured in `verifyHistoricalOutcome` (only place tape+entry+exit index
  coexist), raw price %, scaled by the ONE helper
  `toLeveragedExcursionPct` (`services/backtesting/outcomeEngine.ts`) — the
  post-mortem's local copy was removed. Absent ≠ 0.
- `render-probe`: `sweepSurface(label, cap, tabs)` enters each tab; a newly
  revealed `input/textarea/[contenteditable]` counts as a live press. Learn
  presses 16; floor is `min(cap, 6)` — do not lower it. Journal tabs are reached
  by **id** (`#journal-tab-analytics`), not a testid.
- `trainingRecordFor` (`utils/reportExport.ts`): every key present on every line,
  null for unknown; never derives dollars it does not have; debate turns counted
  only.
