# Stage 3 — status (read this first, then `stage3-arrangement.md`)

**MERGED AND PUSHED 2026-10-06.** `stage3-ui-arrangement` fast-forwarded `main`
`c9b03ed → 2c42cfe`; `origin/main` = `2c42cfe`, zero divergence, no force used.
Phases A–E and F1–F4 (incl. F4b) are on main; **F4c dropped** and **G struck** per
user decision — both recorded in `stage3-arrangement.md`.

Gates were run in a clean worktree holding the merged `main` (not on the feature
branch): typecheck 0, `typecheck:electron` 0, vitest 484 files / 4641 tests 0
fail, eslint 0 errors, `vite build` ok, `render-probe` OK, `boot-probe` OK. The
worktree was created with `git worktree add ../wt-merge-main main`, deps by
junction, and removed junction-first; `node_modules` verified intact.

## Trial merges (throwaway worktrees, no refs moved)

| Target | Merge | typecheck | vitest |
|---|---|---|---|
| `main` | fast-forward, no conflicts | 0 errors | 483 files / 4633 pass |
| `workstream1-trade-review` | fast-forward, no conflicts | 0 errors | 483 files / 4633 pass |

`merge-base(main, stage3) = c9b03ed` = `workstream1-trade-review`'s tip, and
`stage3..main` is empty — both targets are ancestors of this branch, so the
merges cannot conflict and the gate runs are the only real information. Worktrees
were created at `../wt-trial-*` with `node_modules` junctions, removed junction-
first afterwards; the real `node_modules` was verified intact.

## Still open

1. **Live-journal counts (requested pre-merge, not obtained).** The rows are under
   the packaged app's `app://` IndexedDB origin (`%APPDATA%\august-trading\IndexedDB`),
   unreadable headlessly; the dev profile copy at `http://localhost:3000` held only
   `FuturesAI-DB → userProfiles (0)` and `august_offline_queue (0)`. Two exact
   routes: the DevTools snippet over the `trades` store, or a Settings → Data
   export file counted through the real `trainingRecordFor`.
2. **F4b — DONE in `2c42cfe`, not open.** The reason now lives in
   `computeChatModelFallback` (`utils/providerUtils.ts`) and the banner in the
   exported `ModelFallbackBanner` (`components/trade/panels/ChatComposer.tsx`);
   `AgentsView` takes a typed `modelFallback` prop from App and hides it while a
   bot is selected. render-probe asserts both states in the running app.
3. **F4c — DROPPED by the user 2026-10-06** (`planId` is plan-level, the Models tab is model-level). Never implemented, by decision.

## Facts paid for — do not rediscover

- Journal: embedded branch only (`isEmbedded` deleted); the overlay + the
  "your calls vs verdict" stat are gone (nothing writes `userPriorCall`).
- `VersionHistoryDashboard`: no props, no overlay, no tab strip; only mount is
  Learn → System. Hardcoded placeholder cards deleted.
- Settings → Journal routes through `openJournal`; `settingsInitialTab` and
  `isUpdateAutoCapturing` are deleted everywhere including `types/user.ts`.
  `isAutoCapturing` IS wired (`confirmAutopilotOutcome` → capture modal).
- `utils/recentTradesBrief.ts` owns explicit log-time ordering;
  `computeJournalStats` counts the trailing run of whatever order it is handed,
  so sort before calling it. Dollar and percent PnL never merge.
- **realizedR is the canonical outcome label**, computed by
  `realizedRFromPrices` (`services/backtesting/outcomeEngine.ts`) — used by BOTH
  the post-mortem's candle validation and the autopilot's
  `verifyHistoricalOutcome`. `rMultiple` is the older leveraged-percent figure.
- MAE/MFE scaled only by `toLeveragedExcursionPct` (same module). Rows carry
  `rSource` / `excursionSource` (`autopilot` | `postMortem`); first writer wins,
  the post-mortem will not clobber an autopilot measurement.
- Recent-form brief is AUDIENCE-SPLIT: analysts get neutral day-level rows
  (no win rate, no streak, no net PnL — ~1.2k chars, 20 rows); moderator and
  post-mortem get `tallyLine`. Both are fingerprinted into the injection record
  (`journal/recent-form`, `fingerprint`), reachable from a row's `sourceRunId`.
- `get_trade_log`: 4000-char budget (a 20-row read measures ~2.7k), deliberately
  NOT cached, not a MARKET_TOOL.
- Training JSONL: `utils/reportExport.ts`, `TRAINING_SCHEMA_VERSION = 1`, nests
  `decision` / `outcome` / `lesson` / `provenance`, `incomplete` + `missing[]`.
  Never derives dollars. Entry candles are reconstructed from
  `decision.symbol` + `decision.analysisCreatedAt` + entry via
  `fetchFuturesOHLCVFromTime` — not stored.
- The "Log this trade" dedupe keys on `LoggedTrade.planId` / `Message.planId`.
  The headline-text match is gone; pre-F3a rows carry no planId and can therefore
  be re-logged — accepted, and the only known data gap from this phase.
- `render-probe`: `sweepSurface(label, cap, tabs)` enters each tab; a newly
  revealed input/textarea counts as a live press. Journal tabs are reached by id
  (`#journal-tab-analytics`). Learn presses 16; floor `min(cap, 6)` — do not lower.
- SQLite needs NO migration for the new fields: save spreads everything non-column
  into the `meta` TEXT column, read spreads `...meta` back. Proven by
  `tests/sqliteService.test.ts` ("stage-3 trade fields round-trip"), which also
  asserts zero `ALTER TABLE trades` statements and that a legacy row's missing
  keys stay `undefined`.
