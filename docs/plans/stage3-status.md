# Stage 3 — status (read this first, then `stage3-arrangement.md`)

Branch `stage3-ui-arrangement`, HEAD `9021242`. A–E and F1–F4 committed.
Phase **G is struck** (user decision, recorded in `stage3-arrangement.md`).

Gates on this tree: typecheck 0, vitest 483 files / 4633 tests 0 fail, eslint 0
errors, `vite build` ok, `render-probe` ok (last run after F2), `boot-probe` ok.
**NOTHING IS MERGED** — merge awaits user confirmation.

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

## Still open in Phase F

1. **F4b — the amber model-fallback warning on the Chat surface composer.**
   Not done. The warning lives at `components/trade/panels/ChatComposer.tsx:104-111`
   and is fed by `modelIssue` computed in `components/trade/TradeChatPanel.tsx:493-502`
   from `selectedChatModel` + `providers`. The Chat surface composer is the one
   inlined in `components/agents/AgentsView.tsx` (~:1104-1150), which receives
   NEITHER `providers` NOR `selectedChatModel` today. Correct shape: extract the
   `modelIssue` computation into `utils/providerUtils.ts` (it already owns
   `resolveChatModelSelection` / `findChatModelOwner` / `chatModelIdOf`), thread
   the two props into AgentsView, render the shared banner component — do not
   copy the JSX. Verify with `render-probe` (stale-model fixture → the testid
   must appear), not unit tests alone.
2. **F4c — Journal → Models tab reading planId-linked rows.** Not done, and the
   premise needs a decision first: `planId` is plan-level, the Models tab is
   model-level, so planId adds no attribution there. What is actually missing is
   a plan-level view (per-plan: how the plan performed), which belongs in Stats.

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
