# Stage 2 — UI/UX Refactor Implementation Plan

**Status:** DRAFT — awaiting user approval of the Stage 1 spec.
**Companion doc:** [stage1-ui-ux-spec.md](./stage1-ui-ux-spec.md) (research + audit + design spec — all load-bearing claims fact-checked).
**Rule:** UI refactor, not a logic change. Preserve existing behavior and data.
Reuse the current stack (React 19, Tailwind v4 token block, lightweight-charts,
lucide-react, electron-updater) unless the spec justifies otherwise.

---

## Stage 1 readiness summary (what was verified before this plan)

- **Reference research: 28/28 claims verified** against fresh clones of
  NousResearch/hermes-agent and deepseek-ai/deepseek-harness (2 precision fixes
  applied; 4 missed patterns adopted: tooltip anti-tax, named z-ladder tokens,
  modality-aware focus rings, abort-ordered search).
- **Current-state audit: all 35 file:line citations checked, 6 corrected, rest
  confirmed.** Headline findings held: `DebateStage.tsx` is dead code; the
  update chip renders null while `installing`; R:R has two colliding conventions
  (reward-first vs risk-first); ~23 hand-rolled SVGs + 82 direct lucide imports
  bypass the icon layer; the "LIVE MARKET (BTC)" label AND the
  `useMarketData` sampler are both hardcoded to BTC.
- **Vela = LuxAlgo/Vela** (Apache-2.0), cited from source → spec A5 + C9.
  Its WebGL2/Pine machinery is NOT adopted; the chart stays lightweight-charts.
- **Honest gaps (flagged in the spec, carried here):** Claude Desktop /
  ChatGPT Desktop sections are docs-sourced (closed source) with **[not
  verified]** marks; the audit is code-level — visual acceptance happens
  per-phase below via render-probe + manual passes.

## Decision defaults (D1–D6)

Applied as listed if the user approves "as recommended"; each is reversible
until its phase starts.

| | Decision | Default |
|---|---|---|
| D1 | Light theme | **Dormant** token mapping; ship dark-only (honors the 2026-09-10 decision) |
| D2 | Sidebar | **Persistent 56px rail → 280px panel**, replaces the hamburger drawer |
| D3 | Dead DebateStage | **Delete** (component + steer test + unreachable seat-click plumbing) |
| D4 | R:R on trade/verdict cards | **Add**, one display shape `2.4:1` |
| D5 | Update flow | **Keep full-screen overlay** for download/ready; account row mirrors status |
| D6 | Chart retune | **Apply C9** (borderless candles, dashed crosshair, direction-colored price chip, role-based indicator colors) on existing hue tokens |

---

## Gates — run for every phase

```bash
npm run typecheck && npm run test && npm run build
npm run render-probe        # on an IDLE machine (doctrine: competing builds report blank surfaces)
npx eslint <changed files>  # errors fail CI; the --max-warnings 889 ratchet must not grow
```

- `npm run boot-probe` additionally whenever the shell, splash, or
  `electron/` is touched. `npm run installer-smoke` in Phase 4 (updater).
- Guard tests that constrain this work: `tests/themeContrast.test.ts` (hue
  allowlist), `tests/typeRamp.test.ts` (9/10px ban), `tests/deadControlsGuard.test.ts`.
- Render-probe expectations are updated **in the same phase** when nav
  structure changes (it asserts six entries: five surfaces + the Approvals
  overlay, `scripts/render-probe.cjs:764-777`).
- Staging discipline: explicit `git add <paths>` only — never `git add -A`
  (concurrent-agent landmine, per AGENTS.md history).
- After each phase, report: what changed, command results, which screens were
  verified by hand, anything deferred.

---

## Phase 0 — Dead code & standards (low risk, ~half a day)

**Tasks**
1. Delete `components/analysis/DebateStage.tsx`, `tests/debateStageSteer.test.tsx`;
   re-home or delete the type-only imports (`DeskScene.tsx:28-30`,
   `utils/debateStageActors.ts:16`).
2. Remove the dead `externalOpenActor` / `externalOpenActorNonce` state
   (`App.tsx:1351-1352`, set at `:3455-3456`, never read) and the stale comments
   describing the non-existent integration (`App.tsx:1346-1350`,
   `DebateStage.tsx:55-60`).
3. Delete the `fmtPx` duplicate (`KeyLevelsCard.tsx:39`) → canonical `fmtPrice`
   (`utils/formatters.ts:34-40`).
4. Add `fmtPercent(value, digits)` to `utils/formatters.ts`; call sites declare
   digits (win rates 0, P&L 1, spread/Brier 3).
5. Canonical R:R shape `2.4:1` at `TradingChart.tsx:907`,
   `utils/avoidReason.ts:78`, `utils/tradeInsightBrief.ts:41`. The realized
   "avg R" (`WeeklyReviewCard.tsx:33`) stays a distinct metric but formats
   through one helper.
6. Replace the `⏱` emoji (`Sidebar.tsx:441` → lucide `Timer`) and the plain
   `+` glyph (`Sidebar.tsx:431` → lucide `Plus`).
7. Bind the header market label to the symbol actually sampled
   (`Header.tsx:245`; expose the symbol from `useMarketData` — the sampler
   itself stays BTC-only; multi-symbol is logic, out of scope).

**Verify:** gates above + manual Trade & Journal pass.
**Risk:** low; `debateStageActors` re-homing is the only fiddly bit.

## Phase 1 — Tokens, type ramp, icon standard (low-medium)

**Tasks**
1. Formalize semantic token aliases in `index.css` (`--surface-*`, `--ink-*`,
   `--trade-up/down`, `--warn`, `--info`, z-ladder tokens) — same hexes, no
   visual change; light-theme mapping dormant (D1).
2. Add `text-ui-micro` and migrate the 11px literals (`index.css:536, :768, :794`).
3. Re-token hardcoded chart/dashboard palettes via the existing `chartColor()`
   pattern: `EquityCurveDashboard.tsx:69-73`, `WinRateDashboard.tsx:40-50,410-438`,
   `VersionHistoryDashboard.tsx:193-201`, `ModelPerformanceDashboard.tsx:54`,
   `LearnView.tsx:99`, `AgentsView.tsx:797`, `AutomationView.tsx:46`;
   `getWinRateColor` (`components/dashboards/learning/shared.ts:12-17`).
4. `components/shared/Icons.tsx` becomes the sole import surface: migrate the
   78 production direct `lucide-react` imports; replace the ~23 hand-rolled
   SVGs per the C2 mapping table; enforce the size set `{h-3, h-4, h-5}` and
   default stroke 2; `SurfaceMenuList.tsx:11-17` picks one style.
5. Collapse the second color vocabulary (generic `red/green/yellow` classes →
   semantic `rose/emerald/amber` names, identical hexes today).

**Verify:** `themeContrast`, `typeRamp`, lint ratchet, render-probe on all six
probe surfaces.
**Risk:** low-medium — edit volume; keep every hue inside the allowlist.

## Phase 2 — App shell: rail + right-panel system (highest risk)

**Tasks**
1. Build `NavRail` (persistent 56px) + `NavPanel` (280px, D2) reusing
   `SidebarContent` and `SurfaceMenuList` as-is; retire the hamburger drawer
   (`Header.tsx:418-476` portal); wire `Ctrl/Cmd+B`; auto-collapse below 1024px.
2. Bottom-pinned account row carrying profile, Settings entry, and update
   status (spinner + % while downloading, "Restart" when ready, red retry dot
   on failure; brand dot on the collapsed rail).
3. Right-panel contract: push vs fullscreen (below 768px forces fullscreen),
   drag-resize with no transition delay, width persisted per surface, handle
   hidden when closed, hide-vs-close for `TradeChatPanel` (stays mounted so
   scroll/composer state survives); tab capsules when multiple docks open.
4. Z-ladder tokens + modality-aware focus rings (C1).
5. Update render-probe expectations FIRST, in the same commit.

**Verify:** render-probe (surface counts, approvals inbox), `useSurface` /
`useSurfaceRouter` tests, `boot-probe`, manual pass at 800 / 1024 / 1440px
window widths (Electron floor is minWidth 800 / minHeight 600,
`electron/main.cjs:953-954`).
**Risk:** high — App.tsx is 3,500+ lines and the probe asserts counts; the
same-phase probe update is mandatory.

## Phase 3 — Debate/messenger unification (medium)

**Tasks**
1. New `TypingIndicator` unifying the four framings (desk floor per-seat rows,
   LiveStreamView panels, transcript, GroupChatView): multi-seat "N analysts
   thinking…" with per-seat chips; `role="status"` + `aria-live="polite"`;
   settles to "Thought for Ns"; reduced-motion static.
2. Per-model expansion standardized on the `AnalyzedRow`/`ReasoningRow`
   `<details>` pattern (LiveStreamView already matches; `ReasoningPanel` cards
   adopt the summary line, keep grouping).
3. Make the clarification cycle readable after the fact: expandable
   "Clarification" rung in `RunContractPanel`, reusing `ReasoningPanel`'s
   stored-turn renderer (orchestration logic untouched).
4. R:R on `TradeProposalCard` + `VerdictCard` (D4; `rrRatio` already computed,
   `services/trade/proposedTrade.ts:113`); conviction auction behind a disclosure.
5. Unify Entry/Stop/TP label formats across the six inconsistent renderers.

**Verify:** `debateFlow` tests, render-probe chat rows, manual debate run.
**Risk:** medium — streaming rows re-render often; watch for layout shift on
stream chunks.

## Phase 4 — Settings, update flow, chart, polish (low)

**Tasks**
1. Settings: Developer out of the `<details>` into the nav groups; new General
   section with version + "Check for updates"; focus-return-to-invoker on close.
2. Update flow: `UpdateButton` installing state (currently renders null,
   `UpdateButton.tsx:28-30`); "Up to date" toast on manual check; error state
   with "View technical details" collapsed + plain statement that electron-updater
   has no rollback (re-download from the release page); account-row mirror from
   Phase 2.
3. Chart a11y: `role="img"` + aria-label (symbol · interval · last · trend) +
   visually-hidden summary; `KeyLevelsCard` remains the full text alternative.
4. C9 chart visual retune (D6): borderless candles, one hue per direction for
   body/wick, dashed 0.4-opacity crosshair, direction-colored last-price chip,
   recessive axis/grid, 5% watermark, role-based indicator colors
   (cyan=derived, amber=second line, trade hues=slope, gray dashed=levels) —
   via lightweight-charts options + the existing overlay canvas only.
5. Trade mobile tablist arrow keys (`TradeView.tsx:909-943`); GroupChatView
   live region (`GroupChatView.tsx:384-386`, if not folded into Phase 3).

**Verify:** full suite + `installer-smoke` (updater renderer changed) + manual
update-state pass. Renderer-only — `electron/main.cjs` untouched.
**Risk:** low.

---

## Out of scope / deferred (reported again at end of Stage 2)

- Per-agent win rates on the roster (needs `BotLearningStat` schema + computation — data work, recommend as follow-up).
- Clarification-cycle orchestration, provider/model logic, SQLite/learning services (logic, not UI).
- Light-theme activation (D1 dormant tokens only), settings value-search.
- Real updater rollback (electron-updater doesn't support it — documented, not built).
- Multi-symbol market sampling (sampler logic; Phase 0 binds only the label).
- Exact spacing/radii values for the closed-source references (marked [not verified] in Part A).
