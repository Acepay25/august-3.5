# Redesign master spec v2: Claude / ChatGPT / Haze patterns → August Trading — ALL surfaces

**Baseline date:** 2026-10-10, working tree at `1e40d4a` + uncommitted learning work.
**Coverage:** shell, header, toast, Chat surface, Chart AI dock, Trade, Journal, Learn
(+ the Approvals inbox inside it), Studio/Skills, Settings, every modal, every native
select, and the shared kit. No surface is deferred.
**Method:** the reference screenshots (19 total) were read for *pattern* only — none
are of this app. Every August claim below is a `file:line` a mapper opened or a grep
count; screenshots live in `.probe-artifacts/surface-{trade,journal,learn,chat,skills,
settings}.png` (captured by `scripts/surface-shots.cjs`, seeded like render-probe).
**v2 note:** v1 of this spec was written from a partial map. Three of its claims were
wrong and are corrected inline: the grouped tool-step card **already exists** (§2.2),
the interruption card **already exists** (§2.2), and Settings is **already** the Haze
two-pane (§2.8). The "Add skill never renders" defect was half wrong: `onAddSkill` IS
wired (`App.tsx:2734`); only the gear is deliberately unwired and the memory switch
defect is real (`LearnView.tsx:181`).

**The references in one line each.**
- **Claude desktop (14 shots incl. the 7 attached to the brief):** ~280px sidebar
  (New / Projects / Artifacts / Customize, Pinned, "Chats and tasks" with search +
  filter, footer account chip); a centered ~760–880px conversation column; user's
  message in a dark rounded bubble; model reply as **plain body-size text on the
  canvas**; tool calls folded into one bordered card of collapsible rows under a
  status line ("Fixing two flowchart diagrams… · 25s", "Ran 4 commands, read a file ›");
  an interruption card with **Edit prompt / Try again**; a right side panel hosting
  artifacts (SKILL.md: eye/code toggle, Save skill / Copy, serif headings, labeled
  rows) and PDFs (title + type tag, download / expand / close, page pill); a composer
  pill ("+ Write a message…", mic, send) with disclaimer bottom-left, model picker
  bottom-right.
- **ChatGPT Skills:** two-column card grid; search; one high-contrast `Add` button as
  the only loud element.
- **Haze:** settings modal — left category column drives one right panel; theme
  swatches; segmented Mode; a *real* density control the user owns.

**Common thread: loud content, quiet chrome.** August inverts this — quiet content
(9–13px everywhere), loud chrome (gradients, borders, big serif headers on list
surfaces while the terminal has zero headings).

---

## Part 0 · The diagnosis

### 0.1 Why the recent changes "didn't show"

Not caching — the dev server serves edits fresh. The working-tree UI diffs
(`LearnView.tsx`, `TradeView.tsx` removing the `density === 'detail'` gate;
`SessionUsagePanel.tsx` rewording one tooltip) contain **no visual change** — they
un-hide panels, they don't restyle anything, and they partially revert the density
system shipped at `78f99bd` that `scripts/render-probe.cjs:1019-1040` gates.
**Decision: those three diffs revert; the learning-service work in the same tree
stays.**

### 0.2 What the browser showed

- **Live at 1440** (`.probe-artifacts/ui-1440-dock-collapsed.png`): a genuinely good
  terminal — candles, price axis, depth ladder, funding countdown. The problem is not
  features.
- **Cold at 1440** (`.probe-artifacts/ui-1440.png`): chart canvas empty, order book a
  plain-text `Loading book…`, all four stats `—`, and a green "Activity / Memory
  reviewed" toast **physically overlapping** the Chart AI panel's `New chat` label.
- **Brief:** make the cold start read as intentional, and lower the chrome so the live
  state gets the credit it deserves.

### 0.3 The measured scale problem (grep-verified per surface)

| surface | dominant sizes | reading-size sites | headings |
|---|---|---|---|
| Trade (`components/trade/`) | dense 44 · xs 41 · 2xs 17 · sm 13 | **~96% at 9–12px** | **0** (only Screener modal `h2`, `ScreenerPanel.tsx:265`) |
| Chat kit (`ChatTranscriptRow` et al.) | caption 13px ceiling, `text-ui-base` **0 uses** | chat never reaches body size | 0 |
| Learn + Approvals | dense 30 of ~50 tokens | densest, quietest surface | 1 (`ActionApprovals.tsx:45`) |
| Journal | xs 33 · sm 21 · base 20 | healthiest mix | yes, but `text-3xl` serif (`Journal.tsx:249`) |
| Studio + StrategySearch | dense 19 · sm 22 · base 20 · **lg 7** | StrategySearch is the lone loud-scale outlier | yes (`StrategyStudio.tsx:452`) |
| Settings (rendered census) | 38 of 114 leaves ≤11px | — | title is `sr-only` (`SettingsMenu.tsx:404`) |

Global: **703 of ~1,500 type sites sit on the two smallest steps** (`text-ui-xs` 397 +
`text-ui-dense` 306). The whole ramp is offset-based off one dial
(`--text-ui-*` at `index.css:200-251`, `--ui-font-size` at `index.css:304`), so one
number moves all 703. Radius: 650 off-token vs 110 on-token sites globally — though
Trade itself is mostly on-token (`rounded-full` 30, `rounded-control` 26); the drift
is the raw `rounded-lg/xl/2xl` trio elsewhere.

**Gate defect to fix first:** `scripts/surface-census.cjs` reports `leafCount: 0` for
trade/journal/skills/chat (`.probe-artifacts/census-1440.json`) — its leaf selector
only matched `[learn-view]`. Fix the selector before the census can gate the dial.

---

## Part 1 · The reference design language (what we're adopting)

| token | reference value | August today | adoption |
|---|---|---|---|
| Rail width | ~280px dense with value | 280px with 5 rows (`NavRail.tsx:36`) | narrow to 240px, densify rows (§2.1) |
| Conversation column | ~760–880px centered | `.chat-column` 880px (`index.css:1241-1247`) | **keep** |
| Chat text | body-size (~15–16px) | 13px caption ceiling | chat rows jump to `text-ui-base` + dial 14→16 |
| Secondary text | ~13px | 11–12px | dial covers it |
| Labels/meta | ~12px muted | 9–10px (`2xs`/`xs`) | dial + ban `2xs` outside data-dense tables |
| User bubble | filled dark rounded chip, right-aligned | same (`ChatTranscriptRow.tsx:129`) | **keep**, unify dock's 12px variant to match |
| AI reply | plain text on canvas, no bubble | same (`:133-140`) | **keep** |
| Tool steps | ONE bordered rounded card, collapsible rows, "Ran 4 commands ›" summary | **exists**: `ChatWorkTimeline` + `AnalyzedRow` ("Analyzed for Ns") — restyle to the Claude card | §2.2 |
| Interruption | inline card, reason left, Edit prompt / Try again right | **exists** (`ChatTranscriptRow.tsx:187-207`), duplicated in dock (`ChatTranscriptList.tsx:170-192`) | restyle + dedupe |
| Right panel | artifacts/skills/PDF host with own header actions | `RightPanel.tsx` exists, hosts only the dock | host skill bodies + verdicts there (§2.7) |
| Loud accent | exactly one (send button / Add) | cyan vs amber split, gradients reserved | pick **one** accent per rule below |
| Settings | two-pane, segmented controls, density owned | **already two-pane** (`SettingsMenu.tsx:371-379`) | row grammar + selects + real title |

---

## Part 1B · Reference coverage matrix — every element in the attached images

**Audit rule:** every element visible in the reference screenshots is in exactly one
bucket: (a) already present in August and **kept**, (b) present and **redesigned** by
a named section, or (c) **deliberately not adopted** (list at the end). Nothing is
skipped, and the catch-all at the bottom extends the token pass to every remaining
file under `components/` — no component ships unrestyled.

### Sidebar (Claude's left rail)

| reference element | August today | verdict |
|---|---|---|
| "+ New" item | "+ New" pill + portal menu, `AgentsView.tsx:812-827` | keep (§2.2) |
| Projects / Artifacts / Customize rows | the 5 surface rows, `SurfaceMenuList.tsx:48-59` | redesign §2.1 (240px, densified rows) |
| **Pinned** section | Pinned section `AgentsView.tsx:830-846` | keep |
| "Chats and tasks" + search + filter icons | search with `/` hint `:793-810`; sections `:848-963` | keep |
| Chat list rows, active highlight, truncation | `Row` `:224-324` (active `bg-zinc-800/70`) | keep; retype via dial |
| "View all" link | Show-all `:955-961` | keep |
| Footer account chip (avatar · name · plan) | `nav-account` `NavRail.tsx:100-131` | keep |
| Top toolbar: hamburger, panel toggle, back/fwd, search, code | rail collapse `NavRail.tsx:196-206`; header rail-expand `Header.tsx:150` | keep (§2.1) |

### Top bar

| conversation title + dropdown chevron | surface label `Header.tsx:171-176` + gradient wordmark `:180` | redesign §2.1 (label primary, wordmark demoted) |
| FPS/GPU/CPU overlay (shot 1 top-right) | third-party monitor overlay, not Claude UI | not adopted |

### Conversation

| PDF / DOCX attachment chip above the bubble | attachment chips `AgentsView.tsx:1121-1136`; dock strip `ChatComposer.tsx:135-140` | keep; retone to one chip grammar |
| Right-aligned dark rounded user bubble | `ChatTranscriptRow.tsx:129` | keep; body-size §2.2 |
| Plain body-size AI text on the canvas | `:133-140` at 13px ceiling | redesign §2.2 (body-size jump) |
| Live status line "verb-ing… · 25s" with animated dots | running state of `AnalyzedRow` (`AnalyzedRow.tsx:29-95`, auto-open while streaming) | redesign §2.2 (Claude card treatment) |
| Grouped collapsible steps card — "Ran a command ⌄", collapsed "Ran 4 commands, read a file ›" | exists: `ChatWorkTimeline.tsx:145-163` + `ToolActivityRow.tsx:131-179` | redesign §2.2 (restyle to the bordered rounded card) |
| Mono command output with syntax tint, scrollable body | `tool-row-output` CSS `index.css:789-814` | inherits the card restyle |
| Hover actions on the user bubble (edit ✎, copy, "just now") | action chips `ChatTranscriptRow.tsx:209-229`; dock copy broken `ChatTranscriptList.tsx:199` | fix + unify §2.3 |
| Trailing relative timestamp | rel-time `:226-228` | keep |

### Interruption & retry

| ⓘ "response was interrupted" card, Edit prompt + Try again right | exists `ChatTranscriptRow.tsx:187-207`; duplicated `ChatTranscriptList.tsx:170-192` | redesign §2.2/§2.3 (restyle + dedupe) |
| Post-run retry chips | RetryChip `chatChips.tsx:20-28` | keep |

### Right panel (SKILL.md / PDF viewer)

| Panel header: eye/code view toggle, filename, primary Save skill, Copy, expand, ✕ | `RightPanel.tsx` shell (tab capsules, drag separator `:145-153`) — hosts only the dock today | redesign §2.7 (host skill bodies + verdicts) |
| Labeled rows (Description, License), serif headings, highlighted code | markdown rendering `MarkdownContent.tsx` / `MarkdownRenderer.tsx` | host anatomy §2.7 |
| "Page 1 / 6" pill, download action | — | part of host anatomy §2.7 |

### Composer

| Rounded pill card: + attach left, placeholder, send right | Chat pill `AgentsView.tsx:1117-1166`; dock card `ChatComposer.tsx:141-258` | keep; body size §2.2/§2.3 |
| Mic icon | no voice input in August | not adopted |
| Disclaimer line under the composer | `DISCLAIMER_SHORT` `AgentsView.tsx:1162-1165`, `ChatComposer.tsx:261-263` | keep |
| **Model + effort chip bottom-right ("Sonnet 5.5 · High")** | TWO different controls today: model-picker slot `AgentsView.tsx:1154` (625-line `ModelPicker.tsx` flyout) vs dock `ModelPicker` + separate effort menu `ChatComposer.tsx:205-248`, both inside the pill | **redesign §2.2 decision 5 — new**: one chip below the composer, right-aligned, opening ONE dropdown with model + effort rows |

### Settings patterns (ChatGPT Skills + Haze shots)

| Two-column card grid + search + one loud `Add` | Studio grid `StrategyStudio.tsx:536-768`; SkillsCatalog roster `:233-262` | redesign §2.7 (restyle; Import becomes the loud button) |
| Settings: left category column drives one right panel | already built `SettingsMenu.tsx:371-379, 390-465` | finish-work §2.8 |
| Segmented Mode control | `SegmentedControl` already in `tabs/shared.tsx` | adopt across tabs §2.8 |
| Label-left / value-pill rows | `SettingsRow` exists | extend; migrate 13 native selects §2.8 |
| User-owned density control | dial exists in code, no findable home | expose in Settings → Analysis §2.8 |
| Theme swatches | theme is fixed dark by doctrine | not adopted |

### Global type & spacing (the "text, spacing, everything" clause)

| Body ~15–16px chat, ~13px secondary, ~12px labels | 9–13px today; chat never reaches body size | dial 14→16 + chat body-size jump (Part 3.1) |
| Even rhythm: ~32px sidebar rows, consistent message gaps, padded composer card | ad-hoc `p-3`/`gap-3` mixes per surface | **spacing pass — Part 3.8 (new)**: applied per-surface in steps 5/7/9/10, not a blind global sweep |

**Deliberately not adopted:** mic/voice input; the FPS/GPU stats overlay; Claude's
Projects/Artifacts as *new* concepts (August's surfaces already cover those jobs);
a light theme; a separate Customize surface (Settings covers it).

**Catch-all:** every other overlay, drawer, dialog, and panel not named above —
`UpdateOverlay`, `UpdateButton`, `JobsDrawer`, `SymbolPicker`, `ScreenerPanel`,
`ConfirmDialog`, `ScenarioSimulator`, `AutomationEditorModal`, `StrategySearch`,
the history palette, error boundaries, skeletons — keeps its structure and inherits
the token pass (Part 3): **no file under `components/` ships unrestyled.**

---

## Part 2 · Per-surface anatomy and redesign decisions

"Keep" = already matches the reference; don't rebuild it.

### 2.1 Shell — NavRail, Header, Toast, z-ladder

**NavRail** (`components/shell/NavRail.tsx`): 280px expanded (`NAV_RAIL_EXPANDED_PX
:36`; auto-collapse 1024 at `:41`); settings gear `:88`/`:123`; account chip `:100-131`;
update dot `:84`; overlay backdrop `z-drawer` `:163-170`. Rows via
`SurfaceMenuList.tsx` — `SURFACE_ITEMS` **:48-59** (Trade, Journal, Skills, Chat,
Learn), active gradient bar `:122-127`, badge pill `:75-84`, Approvals row `:157-180`.
The wordmark is NOT here — it's in the header (`Header.tsx:180`).

**Header** (`components/shared/Header.tsx:143`): sticky `z-20` `bg-zinc-900/85`
backdrop-blur; rail-expand `:150`; uppercase surface label `:171-176`; gradient serif
wordmark `:180`; session chip + popover with live market conditions `:185-292`
(popover at stray `z-50`, `:204`); save-status `:300-319`; Activity tray `:330-343`;
post-mortem eye `:345-354`.

**Toast** (`components/shared/Toast.tsx`): no portal, sibling of children
(`:80-84`); `fixed top-4 right-4 z-confirm max-w-sm` (`:96`); 4-visible cap, tinted
cards, slide-in. **This is the overlap defect** — it covers the dock header's
`New chat` because dock chrome and toast share the top-right corner.

**z-ladder** (`index.css:321-342`): splash 9999 · update 200 · modal 120 · confirm
100 · automation 75 · drawer 50 · pipeline 40 · header 20. Stray literals:
`index.css:367` (9999), `index.css:1124` (60), `Header.tsx:204` (z-50 popover), and
seven legacy `z-50` overlays (`WatchListPanel.tsx:54`, `LiveMarket.tsx:279`,
`EntryNotHitCaptureModal.tsx:33`, `UpdateTradeModal.tsx:70`, `OutcomeMismatchModal.tsx:36`,
`PostTradeUploadModal.tsx:89`, `LiveStreamView.tsx:190`).

**Decisions.**
- Keep collapse/hide mechanics and the account chip. Narrow 280 → 240px, tighten row
  padding. Do **not** move chat lists into the global rail — August keeps chats
  per-surface (Chat has its own rail, §2.2), duplicating them globally makes a second
  source of truth.
- Header: demote the gradient wordmark (surface label becomes primary; wordmark lives
  in the rail or shrinks). Session popover stays — it's August's market-context home.
- **Toast (P0):** move to `bottom-4 right-4` (Claude never covers panel headers) or
  reserve the row below the header; add the rule to the z-ladder comment: a toast may
  never overlap a panel's own header controls.
- Modal pattern: **no shared Modal primitive exists** — every overlay hand-rolls
  `fixed inset-0 z-* bg-black/60..90` + `role="dialog"` around `useFocusTrap` +
  `useEscapeClose` (dominant examples: `SettingsMenu.tsx:371-379`,
  `ConfirmDialog.tsx:139-144`, `AccuracyModeModal.tsx:23`, `DataCaptureModal.tsx:155`,
  `NewGroupDialog.tsx:108`, `BotSeatOverridesDialog.tsx:76`). Keep the hooks pattern,
  sweep the stray `z-50` literals onto the ladder, and register any new rung in
  `index.css:321-342`.

### 2.2 Chat surface — the main chat (`components/agents/AgentsView.tsx`)

**Today.**
- Thread rail = **already Claude's sidebar**: mobile drawer `z-40 w-72` (`:787-792`),
  desktop `md:w-[min(20rem,42vw)]` (`:789`); search with `/` hint (`:793-810`); "+ New"
  pill + portal menu (`:812-827`); **Pinned** section (`:830-846`); **"Chats and
  tasks"** (`:848-906`); App Conversations + Show-all (`:908-963`); provider footer
  (`:984-988`). Row: title `text-ui-sm font-semibold` (`:270`), preview `text-ui-dense`.
- Main pane `bg-surface-page` (`:992`); instrument strip (title `:1021-1029`,
  SymbolPicker `:1053-1057`, TimeframeBar `:1058-1064`, "Open in Chart AI" `:1065-1070`).
- Transcript: `.chat-column` 880px centered (`:1088`); hero empty state with 24px grid
  bg + serif greeting (`:1075-1086`) — **keep, it's the Claude hero**.
- Rows (`components/shared/ChatTranscriptRow.tsx`): speaker eyebrow mono `2xs`
  (`:114-117`); user bubble `max-w-[85%] rounded-bubble bg-zinc-800 px-3 py-2
  text-ui-caption` (`:129`); AI plain `text-ui-caption leading-relaxed` (`:133-140`)
  with `ChatWorkTimeline` at `:134` and verdict slot `:138` (`InlineVerdict`
  `AgentsView.tsx:335-378`); action chips always-on (`:209-229`, classes in
  `chatChips.tsx:20-120`); **interruption card already has Edit prompt / Try again**
  (`:187-207`).
- **The grouped tool card already exists**: `ChatWorkTimeline.tsx:145-163` folds a
  turn's reasoning + tool rows into one `AnalyzedRow` (`components/shared/
  AnalyzedRow.tsx:29-95`) — auto-opens while running, auto-collapses to "Analyzed for
  Ns · Read the chart, order book". Left-rail container `border-l border-white/[0.08]
  pl-3` (`ChatWorkTimeline.tsx:146`). Row primitives: `ToolActivityRow.tsx` (per-call
  `<details class="tool-row">`, CSS `index.css:789-814`) and `ReasoningRow.tsx`
  (collapsed `<details class="reasoning-row">`, CSS `index.css:650-781`).
- Composer pill (`:1117`): `chat-column rounded-2xl border bg-zinc-900/90 shadow-xl
  p-2.5 focus-within:border-zinc-500`; textarea rows=2 `text-ui-caption` (`:1137-1143`);
  attach `:1145-1153`; modelPicker `:1154`; send `h-7 w-7 rounded-full bg-zinc-100
  text-zinc-900` (`:1155-1159`); disclaimer + `DISCLAIMER_SHORT` (`:1162-1165`).
- `FadingText` overrides streamed markdown to `!text-ui-sm` 12px (`chatChips.tsx:130-134`).

**Decisions.** The skeleton already IS Claude's. The failures are scale + polish:
1. **Body-size chat (P0, rides the dial):** user bubble and AI text go
   `text-ui-caption` → `text-ui-base`; update `FadingText`'s override in the same
   commit or markdown lags at 12px.
2. **Restyle the existing work-group to the Claude card (P1):** give
   `ChatWorkTimeline`'s container the rounded border + hairline row dividers +
   collapsed-summary treatment ("Analyzed for 14s · Read the chart, order book ›").
   No new wrapper — `AnalyzedRow` already does the folding.
3. **Interruption card (P1):** keep the existing one; restyle to Claude's
   (reason left, two buttons right); verify "Edit prompt" focuses the composer with
   the failed prompt.
4. **Model + effort become one bottom-right chip (P1, both chats):** Claude keeps the
   picker OUT of the pill — a quiet chip under the composer's right edge
   ("Sonnet 5.5 · High") opening one dropdown. August has two divergent controls: the
   model-picker slot `AgentsView.tsx:1154` / `ModelPicker.tsx` and the dock's
   ModelPicker + separate thinking-effort menu (`ChatComposer.tsx:205-248`). Move the
   chip below the composer card, right-aligned, and fold effort into the same
   dropdown as labeled rows — one component, both surfaces.
5. Keep hero, rail anatomy, composer pill, disclaimer placement, verdict card.

### 2.3 Trading chat — the Chart AI dock (`components/trade/TradeChatPanel.tsx` + `panels/`)

**Today.**
- Header (`:835-990`): status dot, "Chart AI" wordmark `:841`, session title,
  `answered {reltime}` gated on dock width (`:850-853`), SupervisorIndicator `:855`,
  desk-scene toggle `:858-873`, segmented New+History `:875-885`, ⋯ menu `:886-978`
  (Re-run last question, Expand over chart, Open in Chat, New panel/agent/room, Coach
  inbox, bot rows), collapse ✕ `:983-988`. History palette `:995-1010`. Collapsed rail
  `ChartAiDockRail :243-270` (`lg:w-10` strip). The dock shell is the shared
  `RightPanel.tsx` (drag separator `:145-153`, width var min 300 / default 384 /
  max 820, hide-not-close) mounted at `TradeView.tsx:1082-1118`.
- Transcript `:1072-1102`; empty state + 5 quick prompts `:1073-1088` (chips
  `rounded-full border bg-zinc-800 text-ui-dense`); BiasChips above (`BiasChips.tsx:60-68`).
- `ChatComposer.tsx`: card `rounded-2xl border bg-surface-raised` (`:141`), textarea
  rows=1 `text-ui-caption` (`:142-154`), + attach menu `:166-188`, "Scan → skills"
  `:193-197`, "Full analysis" `:198-204`, ModelPicker `:205-208`, effort menu
  `:209-248`, send `h-8 w-8 rounded-full bg-zinc-200` (`:250-258`), disclaimer `:261-263`.
- `ChatTranscriptList.tsx`: user bubble `rounded-bubble bg-zinc-800 text-ui-sm`
  (**12px** — one step smaller than the main chat's 13px, `:149`); AI text
  `text-ui-sm` (`:193-197`); duplicated interruption card `:170-192`; **defect:** the
  copy/retry action row is `opacity-0 group-hover/msg:opacity-100` (`:199`) but no
  ancestor carries `group/msg` (only `ChatTranscriptRow.tsx:112` does) — the dock's
  chips are mouse-invisible (keyboard `focus-within` only).

**Decisions.** Keep the header cluster, ⋯ menu, collapsed rail, composer. Then:
1. Both chats share the fixes in §2.2 where the components are shared; the dock's own
   `ChatTranscriptList` gets: bubble size unified to the main chat, AI text to
   `text-ui-base`, its duplicated interruption card **deleted in favor of the shared
   one**, and the hover-gating bug fixed (either add `group/msg` to the entry wrapper
   or drop the gating — decide once, both surfaces same answer).
2. Quick prompts get the quiet-chip treatment (outline, body-size, hover raise).

### 2.4 Trade surface (`components/trade/TradeView.tsx` + children)

**Today** (file census + regions):
- Root column `:836`. Row 1 market header `:840-924` (book toggle 847-861,
  SymbolPicker 863, 48-bar Sparkline 864, Screener 865-873, Pinned-signals 874-890,
  feed beacon 894-902; hero price `text-ui-price` 22px `:905-911`, delta + "24h ·
  MARK" `:912-922`). Row 2 metrics strip `:929-956` (Oracle / 24h Vol / OI / Funding
  countdown + depleting bar; `Stat` cell `:165-170` `text-ui-2xs` label over
  `text-ui-sm` mono value). Mobile tablist `:962-1001`.
- Content row `:1007-1119`: chart pane `:1016-1039` (`TradingChart` +
  `LevelAccuracyBadge`); TimeframeBar (`TimeframeBar.tsx:50-69` + customizer);
  ChartToolRail (`ChartToolRail.tsx:120-219`, 12 tools + color swatches); order book
  BETWEEN chart and dock `:1056-1065` (`OrderBookPanel.tsx:154-194` — kicker header,
  column grid, 12+12 ladder, spread band; **cold state is plain-text "Loading book…"**
  `:191-193`); dock `:1082-1118` (§2.3); Screener modal (`ScreenerPanel.tsx:255-300`).
- Typography: 96% at 9–12px (census §0.3); radius on-token dominant; **hardcoded hex
  only as canvas-lib fallbacks** (`chartColor('--token','#…')`: TradeView.tsx:261-262,
  TradingChart.tsx:92-93/327/559/573) — legitimate, not drift; 3 arbitrary text sizes
  in `KeyLevelsCard.tsx:168-170`; **zero headings** on surface chrome.

**Reference.** None of the references is a terminal — adopt the *pattern*: quiet
chrome, honest content size, intentional empty states.

**Decisions.**
- **Skeleton states (P0):** order book renders 24 skeleton rows at real ladder
  geometry instead of "Loading book…"; chart pane renders a frame (axis ticks, grid)
  while loading. Hero/sparkline/strip keep their `—` placeholders but get shimmer so
  "empty" reads as "loading".
- **Heading ladder (P1):** "Order Book" kicker (`OrderBookPanel.tsx:156`), strip
  labels, and section titles become real heading tags; extend `tests/typeRamp.test.ts`
  to ban raw Tailwind sizes on headings.
- Dial raises the strip and ladder type; expected breakage is ladder row wrap — fix
  with row height, never by re-shrinking text.
- Merge/soften Rows 1+2 chrome: replace bordered `Stat` cells with quieter label/value
  pairs (Claude's stat treatment), keep the hero price as the surface's one loud number.

### 2.5 Journal (`components/journal/`)

**Today.** Page shell `bg-zinc-950` (`Journal.tsx:246`); serif `h2` "Journal" +
count + ExportTray (CSV/Report) `:247-262`; pill tab strip History/Stats/Saved with
arrow-key roving `:264-288`; content switch `:187-239`.
- History: `max-w-4xl` centered ledger, Virtuoso list in one `rounded-xl` container
  (`TradeLog.tsx:805-821`); rows = checkbox + icon + coin.md + OutcomeBadge + meta
  (`:505-543`); type/scope/outcome filter chips `:675-710`; bulk actions incl. typed
  CLEAR confirm `:716-764`; drill-down detail page `:120-462` (leverage presets,
  outcome + class segmented buttons, PnL inputs, post-mortem card, `ReasoningPanel`,
  `ThinkingRecordCard` with "View full thinking" modal).
- Stats: single scroll column `p-6 sm:p-8 space-y-8` (`Journal.tsx:205-216`) stacking
  WeeklyReviewCard / MonthlyReportCard / JournalAnalyticsSummary / LastTwentyCard /
  EquityCurveDashboard / WinRateDashboard; stat grid `:329-348`.
- Saved: search + direction chips + expandable rows (`SavedAnalyses.tsx:172-217`).
- Empty states use the shared `EmptyState` (TradeLog `:773-803`, `:148-156`,
  Journal `:230-235`, Saved `:222-226`).

**Decisions.** **Low-touch; tables stay tables** — doctrine bans card-grid conversion
for tabular data. The dial moves its type; the Last-20 card and ledger rows get the
expected row-height fix. Adopt the shared SurfaceHeader/ChipFilterRow components when
they land (Part 3) — Journal's header (`text-3xl`) and chips (`TradeLog.tsx:675-710`)
are two of the four variants being unified. Background joins `bg-surface-page`.

### 2.6 Learn + the Approvals inbox (`components/learn/`)

**Today.** Shell `bg-surface-page` (`LearnView.tsx:125`); underline tabs
Approvals/Memory/Health `:126-148` (amber count badge `:140-144`); single-column
content: Approvals `max-w-3xl` `:157-167`, Memory `max-w-4xl` `:169-184`, Health
`max-w-3xl` `:186-220` (SupervisorStream in fixed `h-[46vh]` card `:202-204`).
- **The Approvals inbox is Learn's coach tab**, fed by three sources with three row
  grammars: `ActionApprovals.tsx:39-114` (section card + `divide-y` rows: Allow once /
  Deny / Always / Never, "Show the trade"); `CoachThreadPanel.tsx:43-50, 256-300`
  (`CardShell` decision cards: Prove on history / Discard / Save as skill; empty state
  `:267-275`); `AmendmentsInbox.tsx:94-137` (amber-bordered cards + resolved
  `<details>`). Routing: `openApprovalsInLearn` (`App.tsx:2158-2161`) sets
  `learnTab='coach'` + `surface='learn'`; entries from NavRail (`NavRail.tsx:214`),
  dock (`App.tsx:2651`), SkillsCatalog Add (`App.tsx:2734`).
- Memory tab: `PatternMemoryCard`, `SkillsCatalog` (search/gear/Add/collection tabs,
  `:166-215`, two-column roster `:233-262`), `MemoryFilesManager` (notebook browser,
  "Run review" `:250-268`).
- **Wiring defects (verified):** `LearnView.tsx:181` mounts `MemoryFilesManager` with
  only `username`+`memoryConfig`, so the global-memory switch gated at
  `MemoryFilesManager.tsx:294` **never renders**. `onOpenSkillsSettings` is
  deliberately unwired (`App.tsx:2730` comment — gear hidden on the draft path;
  `onAddSkill` IS wired to `openApprovalsInLearn`, `App.tsx:2734` — v1 claimed
  neither was wired; only the switch is a true defect).
- Coach header is a `<p class="text-ui-lede">`, not a heading (`CoachThreadPanel.tsx:258-262`).

**Decisions.**
- **Wire the memory switch** (pass the two props through `LearnView.tsx:181`) — P1
  defect fix.
- Converge the three decision-card grammars on one **InboxCard** anatomy (kicker,
  title, detail, action row) — same visual language as Claude's interruption card.
- Keep the single-column quiet layout (it already reads like Claude's centered
  thread); the dial does the rest.

### 2.7 Studio / Skills (`components/dashboards/StrategyStudio.tsx`, `components/skills/SkillDetail.tsx`, `components/shared/StrategySearch.tsx`)

**Today.** Studio (`:449` shell): serif-ish `h2` "Skills" + count + Import /
Strategies / Back to Trade (`:450-493`); filter bar with search + status/family chips
+ sort segments (`:499-524`); RegimeMatrixStrip heatmap `:177-230, :529`; **card grid
`grid gap-3 sm:grid-cols-2 xl:grid-cols-3` (`:536-768`) — borderless tiles, hover
raise, 40px icon tile, name+claim, StatusPill badges, evidence footer, action bar.
This already IS the ChatGPT-Skills card shape** (rationale comment `:19-29`). Detail
swap → `SkillDetail` page (`:430-446` → `SkillDetail.tsx:236-441`: meta grid, active
toggle, two-step delete, Prove on history, Run A/B eval). `StrategySearch` = legacy
480px right drawer, sole opener Studio (`App.tsx:2705`, mounted `:2553`).
- **Outliers:** Studio grid empty states are hand-rolled `<p>` (`:537-542`) not
  `EmptyState`; `StrategySearch` still uses the old loud scale (`text-ui-lg` ×7,
  cyan-everywhere, `:186-385`); raw `text-3xl` off-token headings in
  `MemoryFilesManager.tsx:274`.

**Decisions.**
- Keep the card grid — restyle, don't rebuild. One loud `Add skill`-class button on
  the surface (Studio's Import is the candidate for the high-contrast slot).
- Retone `StrategySearch` onto the token ramp (kill the `lg` body copy, drop the
  cyan-everywhere) or retire it once Studio's filter bar fully covers discovery.
- Skill detail: host the skill body in the **right side panel** (`RightPanel.tsx`)
  with Claude's SKILL.md anatomy — title + type tag, Save/Copy actions, serif
  headings, mono blocks. August already renders markdown
  (`MarkdownContent.tsx`); this is a host, not a renderer. Same host later takes the
  analysis verdict card.

### 2.8 Settings (`components/settings/SettingsMenu.tsx` + `tabs/`)

**Today — already the Haze two-pane (v1 correction).** Not a portal: mounted at
`App.tsx:2388`, leaves the DOM when closed (`:364`). Wrapper `fixed inset-0 z-modal
flex items-center justify-center` (`:371`), backdrop `bg-black/60 backdrop-blur-sm`
click-to-close (`:372`), panel `role="dialog" aria-modal` focus-trapped,
`h-[min(860px,94vh)] w-[min(1180px,97vw)] rounded-2xl bg-zinc-900` (`:373-379`),
Escape + X (`:380-387`) via `requestClose` with unsaved-edit guard (`:317-328`).
Sidebar `md:w-64 bg-black/20` (`:390`) with **"Search settings"** box (`:392-402`) and
grouped categories `NAV_GROUPS :201-239`: Setup(AI setup) · Analysis(Analysis, Roles,
Prompts, Instructions) · Knowledge(Tool approvals, Memory, Playbooks) ·
Account(Profile, Journal, Data); badges (memory/skills/journal counts) `:294-299`;
Developer collapsible + version `:438-451`. Content: right workspace with three
measures (`:459-465`, full-bleed for prompts/memory/instructions/strategies/skills),
per-tab lazy chunks + Suspense `:468-628`, landing heuristic `:255-258`. Entry: Ctrl+,
(`App.tsx:1432-1435`), `nav-settings` (`NavRail.tsx:88/:123`); closed by surface
router (`useSurfaceRouter.ts:82,120,126,131`) and profile ops (`useUserProfiles.ts:114`).
Row helpers **already exist**: `tabs/shared.tsx` — `SettingsGroup` / `SettingsRow` /
`SettingsPageHeader` / `SegmentedControl` (93 lines). Panels: 11 tab hosts + 18
legacy managers (full inventory in the mapper report; largest `ProviderManager.tsx`
872 lines with its own sub-layout).

**The 13 native `<select>`s (all break the dark theme; replacement exists —
`components/shared/SelectMenu.tsx:9`):** `AutomationEditorModal.tsx:358,367,376`;
`VersionHistoryDashboard.tsx:219,266`; `DeskSteerInput.tsx:44`;
`LiveMarket.tsx:337,354`; `ScenarioSimulator.tsx:380`;
`DeskSeatMappingEditor.tsx:182`; `SessionUsagePanel.tsx:229,241,268`;
`ProviderManager.tsx:613,705,727`.

**Decisions.** The structure stays. The work is finish-work:
1. Extend `tabs/shared.tsx` first (label-left/value-pill row, any new control) — one
   grammar every tab adopts.
2. Migrate the 13 selects to `SelectMenu`, starting with the in-Settings ones.
3. Give the modal a real (non-`sr-only`) title row; polish `NavTabButton` groups.
4. Expose the existing Trade density dial in Settings → Analysis as Haze's Mode-style
   segmented control (it exists in code; it needs a findable home).
5. Full-bleed manager tabs (ProviderManager et al.) visually merge into the single
   right panel.

### 2.9 Shared kit (`components/ui/` + `components/shared/`)

Inventory: ui/ = `EmptyState`, `Spinner`, `StatusPill`, `Tip`, `collapsible`,
`task`; shared/ = `SelectMenu`, `ModelPicker`, `ConfirmDialog`, `Toast`,
`ToggleSwitch`, `flyoutLayout`, `Header`, `Icons`, `ErrorBoundary`, `ImagePreview`,
`MarkdownContent`/`MarkdownRenderer`, `MistakeWarningBanner`, `chatChips`,
`AnalyzedRow`, `ReasoningRow`, `ToolActivityRow`, `ChatTranscriptRow`, `AuditPanel`,
`StrategySearch`, `UpdateButton`, `UpdateOverlay`.

**Decisions.** No new primitives except: (a) restyle the existing
`ChatWorkTimeline`/`AnalyzedRow` group to the Claude card (§2.2), (b) shared
**InboxCard** for the three Approvals grammars (§2.6), (c) skeleton components for
book/chart (§2.4), (d) the Part 3 surface components (header/tabs/chips). Everything
else is restyle-through-tokens. `EmptyState` adoption sweep: Studio `:537-542` and
SkillsCatalog `:225-231` hand-roll theirs.

---

## Part 3 · Global system moves (apply everywhere at once)

1. **Type dial 14→16** (`--ui-font-size`, `index.css:304`) + **chat body-size jump**
   (`text-ui-caption` → `text-ui-base` on both transcript rows; update
   `chatChips.tsx:130-134` `FadingText` override in the same commit). Expected
   breakage: order-book rows, metrics strip, Last-20 card, ledger rows — fix with row
   height, **never** by re-shrinking text; fallback is 15px, not a partial revert.
   Gate: census re-run (selector fixed first, §0.3) + `ui-inspect` no overflow at
   800/1024/1440.
2. **Unify the page background** on `bg-surface-page` — kill per-surface `bg-zinc-950`
   (`Journal.tsx:246`, `StrategyStudio.tsx:432,449`, `TradeLog.tsx:121,671`,
   `MemoryFilesManager.tsx:265`).
3. **One accent rule:** brand gradient stays wordmark + active-nav only (doctrine);
   cyan vs amber split resolved — **amber = attention/approvals** (it already owns
   `LearnView.tsx:141`, `AmendmentsInbox.tsx:95`, fallback banners), **cyan = live/
   data** (feed beacon, session indicator); cyan leaves decorative chrome
   (`StrategySearch.tsx:186-244`, `SavedAnalyses.tsx:37,188-189`,
   `ThinkingRecordCard.tsx:18`, `SkillDetail.tsx:268`).
4. **Shared surface components** (new, one place each): `SurfaceHeader` (kills the
   text-3xl / text-ui-xl / lede-`<p>` drift across `Journal.tsx:247-262`,
   `StrategyStudio.tsx:450-458`, `MemoryFilesManager.tsx:272-280`,
   `CoachThreadPanel.tsx:256-263`), `TabStrip` (unifies pill `Journal.tsx:264-288` +
   underline `LearnView.tsx:126-148`), `ChipFilterRow` (collapses four hand-rolled
   variants: `TradeLog.tsx:675-710`, `SavedAnalyses.tsx:182-194`,
   `StrategyStudio.tsx:507-518` + CHIP constants `:136-138`,
   `SkillsCatalog.tsx:196-215`), `InboxCard` (§2.6).
5. **Radius gate, then sweep:** add the test banning NEW off-token radii, then
   mechanically sweep `rounded-lg/xl/2xl` → `rounded-control`/`rounded-bubble`
   (650 vs 110 today). KeyLevelsCard's three px sizes (`:168-170`) go with it.
6. **Z-ladder sweep:** move the seven legacy `z-50` overlays + `Header.tsx:204` onto
   the documented ladder; fix the two stray `index.css` literals (`:367`, `:1124`).
7. **Animation inventory:** 38 `@keyframes` against a doctrine exception list of 2 —
   gate, then prune.
8. **Spacing pass (per-surface, not a blind sweep):** standardize the vertical rhythm
   onto the existing 4px grid — nav/sidebar row height (~32px, matching Claude's list
   rows), consistent message-list gaps (`space-y-4` transcript, §2.2), composer card
   padding, and section gaps on list surfaces. Applied inside steps 5/7/9/10 where
   each surface is already open; never a repo-wide find-replace of padding classes.

---

## Part 4 · What this redesign deliberately does NOT do

- **No new surfaces, no literal copying of Claude's shell.** August's rail +
  per-surface chat lists stay; width, padding, hierarchy change. The Chat surface
  rail is already Claude-shaped — it keeps its Pinned/"Chats and tasks" sections.
- **No copy-reduction pass** (1,185 chars on all of Trade; nothing to cut).
- **Journal stays tables.** Studio stays cards. Doctrine decides both.
- **No shared Modal primitive** — the hooks-based hand-rolled pattern is consistent
  enough; only the z-ladder gets enforced.
- **No re-flip of the dark theme, no gray remappings** (AGENTS.md doctrine).

---

## Part 5 · Order of execution (each step gated)

| # | work | gate |
|---|---|---|
| 1 | revert the 3 UI diffs (§0.1); fix `surface-census.cjs` leaf selector; fix stale probe assertions (`ui-inspect.cjs:215` expects 7 nav rows, app has 5 + approvals) | `npm run test`, render-probe |
| 2 | P0 dial 14→16 + chat body-size jump + FadingText (Part 3.1) | census + ui-inspect no overflow |
| 3 | P0 skeletons: order book + chart frame (§2.4) | render-probe, visual |
| 4 | P0 toast collision fix (§2.1) | visual, ui-inspect |
| 5 | P1 chat polish: Claude card on existing work-group; dedupe interruption card; dock hover-gate fix + bubble unification; unified model/effort chip (§2.2/§2.3) | render-probe row counts |
| 6 | P1 heading ladder on Trade + typeRamp gate extension (§2.4) | `typeRamp.test` |
| 7 | P1 rail 280→240 + row padding (§2.1) | ui-inspect row assertions |
| 8 | P1 wire memory switch (§2.6) | render-probe non-inert |
| 9 | P1 shared SurfaceHeader/TabStrip/ChipFilterRow/InboxCard + bg unification + accent rule + spacing pass (Part 3.2-4, 3.8) | render-probe + suites |
| 10 | P1 side-panel host: skill detail (§2.7); settings finish-work + 13 selects + density home (§2.8) | probe sweep + manual |
| 11 | P2 radius gate+sweep; z-ladder sweep; animation inventory (Part 3.5-7) | new gates, then lint |

**Nothing here adds state, storage, or prompt tokens.** Additions: shared surface
components, skeleton components, InboxCard, two prop wirings, one side-panel host,
settings finish-work, and gate/test files.
