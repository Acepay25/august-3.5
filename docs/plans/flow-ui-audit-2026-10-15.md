# August Trading — Flow & UI/UX audit (2026-10-15)

Six parallel read-only audits over the shipping tree, measured against the user's
attached Claude Desktop / ChatGPT dark-UI references and against the repo's own
doctrine (`AGENTS.md`, `docs/ui-doctrine.md`). Every claim carries a `file:line`
anchor from the source; the highest-impact claims were re-verified by hand before
this document was written (see "Verification notes" §9).

Scope covered: the Trade flow and analysis pipeline; Learn / Journal / Agents and
the learning loop; the design system and app shell; the conversation UI
(transcript, composer, tools, model picker, artifacts); dense data views (charts,
tables, dashboards, forms); and cross-cutting accessibility, motion and responsive
behaviour.

Nothing was modified when this audit was written. **Phase 0 of the roadmap has
since landed** - §10 records the eight changes with their anchors, the gates
that ran, and the one gate still outstanding.

---

## 1. Headline — the seven things that matter

1. **The flagship run is a black box.** The four-step progress ladder is
   deliberately muted for the dock's "Full analysis" run, and **Stop does not stop
   it.** The app's most important, longest, most expensive action has no visible
   progress and no working cancel.
2. **Four places where the UI states something untrue.** A dead market feed is
   painted as a green success with a checkmark; a trade is toasted as "logged" when
   nothing was written; a quarantined plan renders as a confident verdict; a
   truncated answer reads as complete. Trust defects are the cheapest wins here.
3. **The semantic layer is dead vocabulary.** Nine semantic aliases
   (`bg-surface-panel`, `border-hairline`, `text-ink-*`, `text-trade-up/down`)
   have **zero** component uses — measured, not inferred. The app speaks `zinc-900`
   and `border-white/10` instead.
4. **One fact, several homes.** Skills live in Learn *and* Settings under the same
   name; approvals live at four addresses; the same number is formatted four ways;
   the same event shows in local time in five panels and PHT in the rest.
5. **The "why" never closes.** The Journal says what the trader did but never what
   it taught the app; a learned skill shows a 4W–1L tally but not which four trades
   did it. The join exists in the data and is simply not rendered.
6. **Composite widgets advertise roles they don't implement.** Four `tablist`s,
   a `radiogroup`, and five menus promise keyboard contracts (arrow keys, roving
   tabindex) they don't have; the transcript is not a live region, so an arriving
   answer is never announced.
7. **Density is the one place the app is not calm.** 57% of all type sits at
   11–13px, there are ~520 white-alpha borders standing in for one hairline, and 71
   stock overlay shadows. The reference is calmer because it has fewer distinct
   values, not because it has less content.

---

## 2. Tier 1 — correctness & trust (fix first; mostly S)

| # | Defect | Evidence | Fix |
|---|---|---|---|
| T1 | **A failed market-data fetch is a green success toast with a checkmark.** Thrown at `LiveMarket.tsx:255`, rendered via `showNotification` (`:264`) into `bg-emerald-500/90` + `CheckIcon` (`:582`). | `LiveMarket.tsx:255,264,582` | One `tone` on that toast; route through `runStatusPresentation` + `StatusPill` vocabulary. **S** |
| T2 | **Stop does not stop a Full analysis.** Stop calls `chatStore.abortActive()` (`ChatComposer.tsx:244`), the only caller in the tree; that aborts the per-session chat controller, not the pipeline. | `ChatComposer.tsx:244`; `services/trade/chatStore.ts:415-419`; `services/trade/analysisTurn.ts:82-101` | Point Stop at the pipeline cancel already used by the progress card (`App.tsx:2955`). **S** |
| T3 | **"Trade logged" is toasted when nothing was logged**, and Cancel loses the outcome.** With auto-capture on, `confirmAutopilotOutcome` returns early (`useTradeLogging.ts:796-809`) but the caller still calls `markProcessed` + `toast.success` (`useWatchAndAutopilot.ts:189-195`). | `useTradeLogging.ts:796-809`; `useWatchAndAutopilot.ts:189-195`; `App.tsx:2419-2429` | Move the toast/`markProcessed` behind the actual write; re-pend on Cancel. **S** |
| T4 | **A quarantined verdict is invisible on the trade surface.** `truncated-plan` / `incomplete-plan` / `uncited` / `ungrounded` render as a confident Neutral card; only the Journal shows the REVIEW badge. | stamped `verdictFinalizer.ts:343`; read at `TradeLog.tsx:521-529`; absent from `InlineVerdict.tsx` / `VerdictAudit.tsx` | Render the badge in the shared verdict component (not a branch), preserving the dock/thread parity the probe checks. **S–M** |
| T5 | **Switching provider silently discards unsaved settings.** `ProviderManager.tsx:571` loads the new provider over the draft; the reset effect at `:198-217` has no dirty guard although the component already tracks dirty state for close. | `ProviderManager.tsx:198-217,571` | Reuse the existing close-guard on switch. **S** |
| T6 | **The automation editor discards edits from backdrop, Escape and Cancel** with no guard, while `ProviderManager` guards the same situation. | `AutomationEditorModal.tsx:198,215-253,256` | One shared "unsaved changes" confirm for all three exits. **S** |
| T7 | **An answer cut off at the token ceiling is silent in every chat home.** `finishReason`'s tally is read only by the pipeline's finalizer; no transcript component reads it, and the chat path never opens a truncation window. | `verdictFinalizer.ts:323`; `utils/finishReason.ts`; `chatTurnRunner.ts` | Bracket the chat turn, render one honest line at settle. **M** |
| T8 | **Toast contradicts itself:** `role="alert"` plus an explicit `aria-live="polite"`, so errors announce politely — the opposite of the comment above it. Auto-dismiss can't be paused. | `Toast.tsx:120-127,150-157` | Drop the explicit `aria-live`; pause the timer on hover/focus. **S** |

## 3. Tier 2 — flow: make the run legible and the loop closable

### 3a. The run itself

- **F-a — the step ladder never renders for the run users actually trigger.**
  The dock's run carries `automationId: 'trade-chat'` (`App.tsx:1858`), so
  `isAutomationRun` is true (`useAnalysisPipeline.ts:665`),
  `automationSilentRef = true` (`:1132`), and `initAnalysisSteps`/`startStep`
  early-return (`:541-554`). `setIsAnalysisInProgress(true)` still fires
  (`:1603`, `:3047`), so the card renders — always the empty fallback
  (`App.tsx:2961-2974`). **`AnalysisProgress` is dead in production.** Fix:
  distinguish background automations (cron/bot) from the user-initiated
  `trade-chat` run and let the latter populate steps. **M**
- **F-b — the ensemble entry is hidden until you type.** The "Full analysis" chip
  appears only on a non-empty draft (`ChatComposer.tsx:235`), while `Enter` runs a
  single model (`:187`). The placeholder gives them equal weight. Always show the
  chip and label the plain send as a quick/solo answer. **S**
- **F-c — the running row doesn't say what it is doing, and it auto-expands.**
  `AnalyzedRow`'s running branch prints "Analyzing for Ns" and ignores the `title`
  it is handed (`AnalyzedRow.tsx:76-85`); the label exists (`workSummaryLabel`,
  `ChatWorkTimeline.tsx:33-57`) and the card forces itself open while running
  (`AnalyzedRow.tsx:30,37-47`). Use the label, stop forcing open. **S**
- **F-d — the desk home, which runs the longest jobs, has no Stop.** Send is
  disabled while busy (`AgentsView.tsx:1150`) and nothing there calls
  `abortActive`. **S**
- **F-e — interruption recovery exists in one home only.** `InterruptedRunNotice`
  is rendered by both shared row components, but only the dock can trigger it;
  the desk's `chatRowFrom` never sets `interrupted` (`AgentsView.tsx:205-237`) and
  `Message` has no such field; group chat cancels silently. **M**
- **F-f — errors are not a message type; they are assistant prose.** Rate limit,
  rejected key and model refusal all read as the model talking
  (`chatTurnRunner.ts:985,1154`; `runOutcome.ts:66`), even though `runStatus.ts`
  owns the words. **M**
- **F-g — reading history is fought by auto-scroll.** The desk
  (`AgentsView.tsx:580-583`) and group chat (`GroupChatView.tsx:113-116`) jump to
  the bottom on every length change; the dock respects a pin but has no
  "↓ Latest". Reuse the dock's `stickToBottomRef` pattern in both and lift one
  "↓ Latest" into the shared transcript container. **S**
- **F-h — background autopilot logs a pinned setup 15s after detection** with only
  a transient toast as recourse (`useWatchSideEffects.ts:50-62`;
  `useWatchAndAutopilot.ts:189`). Require confirmation, or show the pending timer
  as a cancellable row. **S–M**
- **F-i — a trade logged from a proposal card has no outcome home** — the
  proposal path never marks the setup watched (`App.tsx:1797-1811`), and the
  WatchList (gated on `watched`) is the only Win/Loss UI. Its empty copy is also
  stale ("Hover a settled verdict … tap Pin") while the chip is always visible. **M**
- **F-j — the debate is not visible on the trade surface**; the floor is behind an
  unlabelled grid icon gated on a prior debate message
  (`TradeChatPanel.tsx:863-878`). Give it a word. **S**
- **F-k — the collapsed pipeline pill has no Stop and its status is hardcoded
  cyan**, contradicting the comment that promises a Stop there
  (`App.tsx:2366-2371,2903-2914,2923-2926`). **S**

### 3b. Closing the learning loop

- **L-a — the skill record never shows the trades that earned it.** `SkillMeta.tradeIds`
  is populated; the viewer shows only the tally and an opaque `origin trade <uuid>`
  (`SkillViewerPanel.tsx:46-56,176-180`). List the counted trades with routes to
  their Journal rows. This is the single biggest "why" hole. **M**
- **L-b — the Journal never says what a trade taught the app.** The trade detail
  carries post-mortem, excursions, memory gate and dissent (`TradeLog.tsx:64-463`)
  but not the skill/draft/mistake the run produced. Add one "What this run taught"
  line linking to it. **M**
- **L-c — two homes called "Skills" over one store.** Learn→Memory mounts
  `SkillsCatalog` (`LearnView.tsx:250`) and Settings→Skills mounts `StrategyStudio`
  (`settings/tabs/SkillsTab.tsx:33-35`), both over `listSkills()`. Rename
  ("Learned skills" vs "Strategy library") and wire the catalog gear
  (`App.tsx:2812-2817`) whose stated reason is now false. **S**
- **L-d — Weekly/Monthly review cards return `null` with no placeholder**, so
  "pending", "failed" and "never ran" all look identical
  (`WeeklyReviewCard.tsx:20`; `MonthlyReportCard.tsx:20`). A quiet line naming the
  next pass. **S**
- **L-e — the forged-tool queue count has no destination.** Health reports the
  count (`MemoryHealthCard.tsx:166`) but approval lives in Settings→Skills. Link
  it, or move tools into the one inbox. **S/M**
- **L-f — Agents shows `N lessons · N skills · N evidence`** (`AgentsView.tsx:1029-1035`)
  that cannot be opened. Link the count to that bot's memory topic. **M**
- **L-g — the notebook renders twice on one screen** (`MemoryTopicsCard` rows are
  notebook files, above `MemoryFilesManager`'s folder tree). Label one as the raw
  source view or fold it behind a disclosure. **M**
- **L-h — seed content isn't labelled as seed** (`SkillsCatalog.tsx:237-274`),
  unlike Health which distinguishes curated priors. **S**
- **L-i — `docs/learning-loop-map.md:113` names a file that no longer exists** and
  contradicts `learningQueue.ts:30-32` on how many proposal kinds are actuable.
  Correct the doc. **XS**

## 4. Tier 3 — design system: fewer values, one vocabulary

Ordered by payoff over risk. Nothing here changes a pixel if done as a codemod.

1. **Adopt the semantic aliases and make the hairline a token.** Measured today:
   `bg-surface-page` used 6×, `bg-surface-panel` 0×, `border-hairline` 0×,
   `text-ink-*` 0×, `text-trade-up/down` 0× — against `border-white/10` 231×,
   `border-white/5` 135×, `border-zinc-800` 93×. One mechanical swap turns the
   alias block from decoration into the vocabulary and makes a future re-step of
   `zinc-900` safe. **L, low risk.**
2. **One page-title treatment and one Settings page wrapper.** The surface name is
   set four ways (`AgentsView.tsx:1050` `text-3xl` serif, `MemoryFilesManager.tsx:274`
   `text-3xl` sans, `StrategyStudio.tsx:452` `text-ui-xl` serif, `shared.tsx:58`
   `text-lg`), and `FULL_BLEED_TABS` (`SettingsMenu.tsx:46`) splits the sheet into
   two padding conventions. Introduce `SurfaceTitle` + `SettingsPage`, add
   `text-3xl|2xl` to `tests/typeRamp.test.ts`'s ban list. **M**
3. **Introduce `Button` and `SectionLabel`.** There is no button primitive; 52
   `bg-cyan-500/600` sites, an `ACTION_BTN`/`CHIP` pair, and 25 `aria-pressed`
   groups stand in. Cyan is doing both "primary" and "info". **M**
4. **De-noise the class lists and finish the z-ladder.** `duration-[150ms]` (69)
   is Tailwind's default written arbitrarily; `ease-[var(--ease-snappy)]` (85) is
   already the default (`index.css:263`); 53 raw `z-<n>` remain against 40 named
   rungs, with two unnamed rungs (`z-[80]`, `z-[90]`) and one `z-[101]`. **S** —
   and it makes every future diff readable.
5. **One overlay shadow token, one tint recipe.** 71 stock `shadow-2xl` on
   overlays; `Toast.tsx:129-134` tints at `-900` while every other tinted surface
   uses `-950`. **S**
6. **Consolidate formatters and time.** Four or more sites per concern bypass
   `utils/formatters.ts` / `utils/timezone.ts`; two facts (`fmtQty`, `fmtCost`)
   have no canonical home at all, and cost is hand-formatted identically twice
   (`SessionUsagePanel.tsx:49`, `CompareModal.tsx:50`). Five panels show local time
   where the app speaks PHT (`CompareModal.tsx:52,118`;
   `LessonsSection.tsx:117-118`; `EquityCurveDashboard.tsx:43`;
   `StrategyStudio.tsx:118-123`; `AutomationEditorModal.tsx:412`). Raw model
   figures print unformatted (`TradeProposalCard.tsx:44,48,52`;
   `WatchListPanel.tsx:112,116,120`). **M**
7. **Canvas labels should use the data face.** `'9px ui-monospace, monospace'` at
   `TradingChart.tsx:756,800` and `drawingGeometry.ts:109`, not JetBrains Mono. **S**
8. **Tooltips: 3 vs 394.** Doctrine says `Tip`, but it is used in three files while
   `title=` appears 394 times in 105 — the shell abandoned `Tip` because its label
   measured 370px (`ChatModePill.tsx:59-63`). Clamp `Tip`, then either adopt or
   retire it deliberately. **M**
9. **Toast tints and `--color-warn/info`** are declared but unused; either wire
   them or delete them so no token implies a contract it doesn't have. Outside
   `index.css:280-294` (a dormant, correct-to-keep light block) the values are
   fine. **S**

## 5. Tier 4 — accessibility and reference-pattern adoption

### 5a. Accessibility (verified, reachable)

- **Composite roles are advertised but not implemented:** right-panel capsules
  (`RightPanel.tsx:105-137`), Skills collections (`SkillsCatalog.tsx:201-218`),
  `SegmentedControl` (`tabs/shared.tsx:73-90`), `RowMenu` (`RowMenu.tsx:55-66`),
  composer menus (`ChatComposer.tsx:282-291,379-386`). The correct pattern already
  exists in `Journal.tsx:170-183,264-297` and `TradeView.tsx:969-1008` — reuse it.
  **S–M**
- **Four pickers/menus are unusable without sight:** `ModelPicker` has no roles
  and reveals its model column by hover (`ModelPicker.tsx:501-520`);
  `SymbolPicker` moves a highlight nothing announces (`SymbolPicker.tsx:109-147`);
  `SelectMenu` never exposes the active option (`SelectMenu.tsx:219-297`, ~20 call
  sites). **M**
- **Overlays with `aria-modal="true"` but no focus trap:** `LiveMarket.tsx:280`,
  `UpdateOverlay.tsx:142-147`, `ThinkingModal.tsx:36-37`; the 2-D desk view has
  neither Escape nor a trap (`DeskScene.tsx:403-408`; `App.tsx:1396-1399` refuses
  to close it); the narrow-width nav drawer is an unfocused overlay
  (`NavRail.tsx:170-200`). Every other overlay already pairs `useFocusTrap` +
  `useEscapeClose`. **S**
- **The transcript is not a live region** (`TradeChatPanel.tsx:1089`), so an
  arriving or streaming answer is never announced. `role="log"` + `aria-busy` on
  the streaming row. **S**
- **Reduced motion has exactly one hole:** `LiveStreamView` types word-by-word via
  `setTimeout` (`LiveStreamView.tsx:63`; `useTypingEffect.ts`), which the CSS block
  cannot reach. Everything else is CSS-driven and correctly neutralised
  (`index.css:1715-1734`) plus `PixelSeat`'s own `matchMedia` gate. **S**
- **Contrast:** every ink step passes on page and panel; the single miss is
  `zinc-600` on the *raised* surface at **4.05:1** (`index.css:22-26` audited page
  and panel but not raised). Two reachable instances
  (`MemoryTopicPanel.tsx:156`, `ChatComposer.tsx:312`), both behind a label. Raise
  the step or ban `zinc-600` on `bg-zinc-800`. The faint hairline/raised-vs-page
  contrast (1.19–1.47) is the deliberate look and costs only unfocused-binding
  cues; the focus ring itself is 6.51:1 — do not spend a redesign on it. **S**

### 5b. Reference patterns worth adopting (each with its cost)

| Reference behaviour | August today | Verdict |
|---|---|---|
| A run folds under **one third-person line with a duration**, steps expand on demand | `AnalyzedRow` has the shape (settled) but auto-opens and says "Analyzing" while running | **Adopt** — F-c, already computed. |
| Persistent **right-hand panel** for the artifact/document, primary surface never replaced | No artifact panel; `ToolActivityLog` output lives in an inline `<details>`; `TradeLog.tsx:620-633` and `StrategyStudio.tsx:432-445` replace the whole screen | **Adopt** — L. The shell (`RightPanel`) already exists and is unused for it; `WatchListPanel.tsx:54-56` is the in-repo exemplar. Keep the list mounted so the probe's row counts hold. |
| **One rail**: New → groups → Pinned → "Chats and tasks" header with search + filter → View all → account row | Two rails: `NavRail` (4 surfaces) + the Chat rail inside `AgentsView.tsx:759-961`, with two collapse affordances and two backdrops | **Needs a ruling** — L. The stage-3 split is documented and deliberate. |
| **One Settings sheet** with a grouped nav and dense rows | Matches better than most of the app; the per-tab header/padding split is what breaks the illusion | **Adopt** — T3-2. |
| Running spinner is the **brand mark** | Grey bouncing dots (`AnalyzedRow.tsx:96-101`) | **Needs a ruling.** AGENTS.md reserves the brand gradient for the wordmark + active-nav; this needs a token decision, not a free win. |
| Hover-revealed message actions | Deliberately always-visible (`chatChips.tsx:6-11`), documented | **Keep August's choice** — it is better for touch and for discoverability. |
| Approval queue: one primary action per row, quiet secondaries | `CoachThreadPanel` matches; the Approvals tab is three unstyled stacks (`LearnView.tsx:222-232`) and the nav Approvals row is a fourth tray | **Adopt the headers** — S. |

---

## 6. What to leave alone (already right)

This matters as much as the findings — do not "fix" these.

- **The token *layer*** (`index.css` @theme), the z-ladder and type-ramp
  declarations, `--ui-font-size` dial, and the cluster of real guards in
  `tests/typeRamp.test.ts` / `tests/themeContrast.test.ts`. Zero `text-[Npx]`,
  zero `bg-[#…]`, zero arbitrary radii across 154 components.
- **Focus/motion base:** one `:focus-visible` rule (`index.css:1676`), the
  class-list-driven editable opt-out (`:1707`), `html[data-nav-modality]`,
  reduced-motion (`:1715`) plus the user's idle-motion switch — and the probe
  already reads the computed outline in both states.
- **Genuinely single-source primitives:** `ToggleSwitch`, `SelectMenu`'s listbox +
  typeahead + global `data-menu-open` Escape arbitration, `useFocusTrap`,
  `useEscapeClose`, `ConfirmDialog`, `hit-target`, `chartColor`.
- **`RightPanel`'s geometry contract** (push/fullscreen, hide ≠ close, strip only
  when >1 dock) and **`NavRail`'s collapse model** (0px + `invisible` + `inert`,
  header-mounted expand, <1024 overlay, choice not written back).
- **Tool rows, reasoning rows, and `harnessMarks` discipline:** one-line
  call→result pairs with honest "full result not kept · N chars"; reasoning
  collapsed by default and never leaking raw provider text; no component
  hand-writes a withheld-data marker or re-derives truncation.
- **The dock's streaming pin** (`TradeChatPanel.tsx:645-657`) — the pattern the
  desk and group chat should copy, not replace.
- **Identity by `botId` stamp**, not model shape (`AgentsView.tsx:575`,
  `chatRowFrom:214`).
- **`ScreenerPanel`** (the best table in the repo: `aria-sort`, sticky header,
  memoised rows, distinct failure-vs-empty states), `OrderBookPanel`, `BiasChips`
  (colour **and** text), `TradingChart` (DPR-correct, data-space drawings, undo,
  skeleton + unavailable states), `VerdictAudit`'s error boundary, `TradeLog`'s
  Virtuoso + typed-confirm gates, `ProviderManager`'s master/detail + dirty guard.
- **Doctrine items with reasons:** memory budget refuses growth rather than
  evicting; suspension is `enabled:false` + `meta.suspendedAt`; the dock's store is
  a singleton so a stream survives a surface switch — **document the two chat
  stores (F9/L), do not half-migrate them.**

---

## 7. Suggested sequence

| Phase | Contents | Est. | Gate |
|---|---|---|---|
| **0 — Tell the truth** | T1 green-failure toast · T2 Stop · T3 phantom "Trade logged" · T4 quarantine badge · T5/T6 unsaved drafts · T8 toast semantics | ~1 day | `typecheck`, `test`, `render-probe` (T4 touches verdict rendering) |
| **1 — Make the run legible** | F-a step ladder · F-b always-visible ensemble entry · F-c running label + fold · F-d desk Stop · F-g scroll pin + ↓ Latest · F-j label the debate · F-k pill Stop + status vocabulary | ~2–3 days | `render-probe` row-count parity, `boot-probe` |
| **2 — Close the loop** | L-a skill evidence trades · L-b "what this run taught" · L-c Skills rename + gear · L-d review placeholder · L-e queue route · L-i doc fix | ~2–3 days | `render-probe` Learn/Journal inert-control sweep |
| **3 — Recover hidden errors** | T7 silent truncation · F-e interruption in desk/group · F-f errors as a type · F-h autopilot confirm/cancel · F-i pending-outcome home | ~3–4 days | `test` + probe |
| **4 — Fewer values** | T3-1 aliases + hairline codemod · T3-2 one title + Settings page · T3-4 duration/z literals · T3-5 shadow + tint · T3-7 canvas font · T3-6 formatters + PHT | ~1 week | `tsc`, `vitest`, `render-probe` (it is the only gate that can see a token change) |
| **5 — Contracts & structure** | Composite-role keyboard · pickers' combobox wiring · overlay focus traps + desk Escape · transcript live region · reduced-motion hole · the probe extensions in §8 | ~1 week | extended probe |
| **6 — Structure (needs rulings)** | Right-hand artifact/detail panel · merge the two rails · brand-mark spinner | — | user decision first |

Sequencing rationale: Phase 0 is spent before anything else because four of its six
items make the UI state something false. Phase 1 exists because the app's headline
feature currently reports nothing and cannot be stopped. Phases 4–5 are the
"minimalist and modern" work, and they are cheap precisely because they remove
duplicate values instead of adding screens.

---

## 8. Verification: extend `render-probe`, don't trust jsdom

Unit tests mount components in jsdom and cannot see a transcript drop a row. These
five assertions are written so the two states they compare produce *different*
numbers — the vacuous-measurement trap the probe already documents.

1. **Focus indicator for non-editable controls** — repeat the existing `readFocus`
   read over `button,[role="tab"],[role="switch"],[role="radio"],[role="option"]`
   on each of the five surfaces. Today's check is restricted to editable fields,
   which is exactly where K1–K5 live. Assert a non-zero sample per surface, and
   re-read in pointer modality expecting a difference.
2. **Composite-role keyboard contracts** — for each mounted `[role="tablist"]`,
   `[role="radiogroup"]`, `[role="menu"]`: focus the first item, press
   `ArrowRight`/`ArrowDown`, assert the active element *and* the
   `aria-selected`/`aria-checked` state both moved. Include one known-good control
   (Journal tabs) as the harness self-test, so a broken harness cannot pass.
3. **Overlay focus-scope invariant** — for Settings, LiveMarket, the desk view,
   Thinking and Update: open via the overlay's *own* trigger, assert on the
   overlay's *own* root (never `<main>`), Tab from the last focusable and assert
   focus stays inside, then Escape and assert it closed. This is what proves the
   desk Escape defect (O1) and reports the offending element by name.
4. **Second-focus-indicator check** — Tab to a button that declares
   `focus-visible:ring-*` and read both `outline*` and `boxShadow`; assert
   `outline===false && shadow===true`, then the inverse on a plain button. The two
   states must differ.
5. **Reduced-motion emulation** — with `emulateMedia({ reducedMotion:'reduce' })`,
   open the live-stream view and assert the rendered text after 400ms equals the
   full answer (no word-by-word withholding), and assert a CSS-animated element's
   `animationName === 'none'`. One assertion for the JS hole, one proving the CSS
   block still holds.

---

## 9. Verification notes

Hand-verified before writing (the rest carries the audits' `file:line` evidence):

- `automationSilentRef` early-returns at `useAnalysisPipeline.ts:542,547,552,565,576,583`;
  `isAutomationRun = !!options?.automation` at `:665`; `initAnalysisSteps` defined
  at `:541` and called once at `:1172`. F-a confirmed.
- `chatStore.abortActive` has exactly one production caller
  (`components/trade/panels/ChatComposer.tsx:244`). T2 confirmed.
- `onManageModels` appears only twice, both inside `components/shared/ModelPicker.tsx`
  (`:91`, `:114`) — declared, destructured, never rendered or passed. Confirmed.
- `LiveMarket.tsx:264` routes the fetch-failure message into the same
  `showNotification`, rendered at `:582` with `bg-emerald-500/90` + `CheckIcon`.
  T1 confirmed.
- Measured semantic-alias usage across `components/`, `hooks/`, `App.tsx`:
  `bg-surface-panel`, `bg-surface-raised`, `bg-surface-page` (6),
  `border-hairline`, `text-ink-primary/secondary/tertiary`,
  `text-trade-up`, `text-trade-down` — all **0** in components. Tier 3-1 confirmed.

Caveats: the audits' §"leave alone" lists and the audits of Learn/Journal/Agents
restate some anchors from earlier reads in the same session rather than re-reading
every line; re-verify a specific anchor before acting on it. Whether users actually
return to the Journal (L-b) and whether the first-run seed reads as "learned"
(L-h) are product questions the code cannot answer — the code shows the affordance
is absent, not that it is unused.

---

## 10. Phase 0 landed (same day, later)

Seven fixes, in the working tree and uncommitted. (The numbering skips T7 - that
item is Phase 1's composer work, not Phase 0.) Each line is the anchor a reviewer
should read; the intent is stated only where the anchor does not carry it.

- **T1 - a dead feed no longer reports success.** The one-shot notice carries a
  tone (default `'error'`, which is its only producer today), renders rose with
  `AlertCircle` and `role="alert"`, and the failure text goes through
  `sanitizeErrorText` rather than `(error as Error).message` - a transport
  failure can carry a request URL. `LiveMarket.tsx:87,230,273,593`.
- **T2 - Stop stops the run.** `onStopRun` threads App -> `TradeView` ->
  `TradeChatPanel` -> `ChatComposer`, and the Stop button calls it *before*
  `chatStore.abortActive()` (`ChatComposer.tsx:256`); App wires it to
  `handleCancelAnalysis` (`App.tsx:2748`). Stop used to abort only the chat
  controller, which the pipeline never reads, so the run kept streaming and
  spending under a bubble that said it had stopped.
- **T3 - "Trade logged" is toasted only when a row exists.**
  `confirmAutopilotOutcome` returns whether it wrote (`false` = handed to the
  capture modal; `useTradeLogging.ts:812,832`) and `handleConfirmAutopilot` gates
  `markProcessed`, the resolution delete and the toast behind it
  (`useWatchAndAutopilot.ts:189-200`). Cancelling the capture modal now leaves the
  setup pending and re-confirmable instead of consuming the outcome silently.
- **T4 - a quarantined plan says so on the trade surface too.** The badge is ONE
  component, `VerdictReviewPill` (`StatusPill.tsx:63`), drawn by the
  conversation's verdict card (`InlineVerdict.tsx:54`) and the Journal's row
  (`TradeLog.tsx:522`) - each carried a hand-copied twin before, which is how one
  plan read two ways. Pinned by `tests/verdictReviewBadge.test.tsx`, including a
  source scan asserting the sentence is written once.
- **T5 - switching provider rows asks before discarding a staged draft.**
  `ProviderManager.tsx:261` (`selectProvider`), the same confirm and the same
  words as the close path. Declared after `isDirty` on purpose: a `useCallback`
  deps array is evaluated where it is written, so hoisting it is a TDZ crash.
- **T6 - the automation editor has one guarded exit.** Cancel, the cross, Escape
  and a backdrop click all route through `requestClose`
  (`AutomationEditorModal.tsx:195,204`), which asks only when the mount-time
  fingerprint moved.
- **T8 - toasts announce by role and stop vanishing mid-read.** The explicit
  `aria-live="polite"` was overriding `role="alert"` on every error; the roles now
  carry the politeness, and the dismiss timer pauses on hover and focus
  (`Toast.tsx:124,157,164`).

Gates. `npm run typecheck` reports no error in any touched file. `npx vitest run`
leaves 4 failures, all inside the in-flight Learn/surface refactor (`LearnView`
still matches `/'skills'/`, `SurfaceMenuList` has no `nav-approvals`, a dead
control in Learn, one surface missing from the menu); the 12 suites around these
edits (100 tests) and the 7 around the autopilot/toast/composer paths (97 tests)
are green.

Deferred by hand. `useWatchSideEffects` still toasts "Logging in 15s / Confirm
now" when auto-capture is on, where the capture modal opens instead of a
15-second log. Same class of untruth as T3, but closing it means threading
`isAutoCapturing` into that hook - wider than Phase 0's "ask the writer" fix, so
it is recorded rather than patched.

**Outstanding gate.** `npm run render-probe` - the only check that can see a
rendered verdict card - could not complete. While it ran, `App.tsx` was
mid-refactor with a TDZ crash (`strategyStudioPanel`, created near line 430,
reading `loggedTrades`, `activeUsername` and `currentHybridData` before their
declarations), so the app could not mount and the probe had nothing to count.
Re-run it once that refactor settles: the verdict-card badge is the change it must
confirm, and §8's five extensions are still unbuilt.
