# Stage 1 — UI/UX Research & Design Spec

**Status:** APPROVED (2026-10-03) — D1–D6 taken at the recommended defaults; Stage 2 Phase 0 underway.
**Date:** 2026-10-03
**Scope:** trading harness, first launch → app update.
**Constraint (user):** UI refactor, not a logic change. Preserve behavior and data.

> **Screenshots:** none were attached in this session despite the request. Every
> reference claim below is traced to a repo/docs URL or marked **[not verified]**.
> If you drop screenshots into the workspace, I will fold them in and correct.

> **Verification stamp (2026-10-03):** before presentation, (1) all 28 Hermes /
> DeepSeek-harness claims were verified against fresh clones of both repos — two
> precision fixes applied below; (2) all 35 current-state audit citations were
> checked against this repo — six corrections applied below, the rest confirmed
> as written; (3) the chart-look reference research was added as **A5** and the
> chart visual spec as **C9**.

---

## Part A — Reference research (4 products)

### A1. Hermes desktop (NousResearch/hermes-agent)
*The product this repo already credits in `THIRD_PARTY_NOTICES.md:30,41-67`.*
Sources: `apps/desktop/DESIGN.md`, `apps/desktop/README.md`, hermes-agent.nousresearch.com/docs/user-guide/desktop.

- **Launch:** full-screen onboarding route on a unified overlay design system; first run offers "Connect to existing Hermes" (remote gateway, HTTP+WS connection test) or local installer; provider/model picker with "Choose provider later"; boot screen stays until the real conversation loads — *never fabricates progress or delays readiness for motion*; reduced motion → static BrandMark; boot failures get an in-app banner + `desktop.log`.
- **Layout/theme:** "Flat, not boxed" — no card-in-card, no divider borders inside a panel, group with whitespace + one hairline; borderless elevation via `shadow-nous` + `--stroke-nous`. All colors via CSS vars (`--ui-stroke-*`, `--ui-text-*`, `--theme-primary`), never raw hex. Light/dark (Shift+X); window glass 29% tint sidebar-only; VS Code Marketplace themes importable.
- **Type:** two independent dials — UI Scale (whole window, 90% default) and Chat Text Size (conversation + composer only, 110%); separate Chat Font and Terminal Font settings.
- **Sidebar:** Cmd/Ctrl+B toggle, Cmd/Ctrl+\ swaps side; `Sessions | Bots` tab strip; projects with repo discovery; archive + "Hide from sidebar"; search by id (Cmd/Ctrl+Shift+F); Cmd/Ctrl+N new session.
- **Right panel:** terminal, file browser, Git review (Cmd/Ctrl+G), browser, artifacts. **Hide vs Close** distinction: Hide keeps the pane mounted-but-inert (forms, timers, scroll, shell state preserved); Close releases it. Multiple terminals stack in a tab rail.
- **Settings:** OverlayView card (not a nav stack); `OverlayNav` subpages with breadcrumbs, shared disclosure carets, narrow-window dropdown collapse, **search resolves to the owning child and highlights it**; `ListRow` primitive (label/description/action, flat, flush-left, spacing over dividers); "Applies to" profile chip when ≥2 profiles.
- **Updates:** the packaged desktop app updates via electron-updater over a hosted
  (Cloudflare R2) feed; the GitHub-feed ladder (token → gh CLI → anonymous fallback,
  rate-limit surfaced) serves the CLI / source-checkout updater — don't conflate the
  two. One-click update; streams build output to `update.log` with an idle watchdog;
  per-artifact-owner install paths (MSIX/Store/electron-updater/checkout). Release-notes UI and rollback: **[not verified]**.
- **Icons:** **Tabler** for chrome, **Codicon** for editor/tool/status; curated aliases + `iconSize` scale from `src/lib/icons.ts` — feature code never imports icon packages directly; SVGs inherit `size-3.5` (`size-3` at xs), never re-set per site; never mix sets within one control group; `StatusDismissButton` owns the close glyph.
- **Micro:** canonical `ErrorState`/`ErrorIcon`, `EmptyState`/`PanelEmpty`, one `ConfirmDialog` (Enter/Esc, never `window.confirm`); `Tip` tooltips (200ms first open, 300ms re-open, 100ms exit); ~100ms functional transitions, spring `AnimatedInt` counts; **one Esc = one thing** (cancel active interaction XOR close topmost surface); composer status stack with a ridge drawer; hover 500ms grace on directive-chip action pills.
- **Verified addenda:** **tooltip anti-tax doctrine** — a tip exists only when hover
  teaches something new, never on menu triggers or close buttons, and native
  `title=` is lint-banned; **named z-index ladder tokens** (boot chain
  `--z-connecting → --z-onboarding → --z-setup → --z-crash`) so overlays never
  fight via ad-hoc z classes.

### A2. DeepSeek harness (deepseek-ai/deepseek-harness)
*Credited in `THIRD_PARTY_NOTICES.md:31`. Most directly transferable reference.*
Sources: repo READMEs (`ui-layout`, `ui-sidebar`, `ui-sidebar-right`, `ui-theme`, `ui-primitives`, `ui-chat`, `ui-settings-general`, `ui-shortcuts`, `apps/desktop`).

- **Launch:** packaged window loads a shared loading page offscreen first; startup failures retain the loading page + spinner (never a blank). Welcome window (first run/signed out): 600×700, macOS vibrancy / Windows acrylic 40% white (light) / 50% `rgb(24 25 28)` (dark), Montserrat Light bundled locally, 24px intro copy, 240px login buttons. API-key page: empty input `autocomplete="new-password"`, **Save and continue** / **Set up later** (re-checks next launch) / **Back to sign in**; buttons block competing actions while saving.
- **Layout:** three-column `AppFrame`. Sidebar 264–420px (default 280), collapses to a **56px rail**, auto-collapses <1024px. Right panel opens at 45% viewport, retains user's pixel width capped at 70%, protects 400px for center (shrink → 300px → close → compress center). Drag resize has **no transition delay**; handle hidden while closed/fullscreen. Layout resets on reload.
- **Theme/tokens:** light/dark/system resolved pre-plugin-load (first paint uses the chosen palette); content font size 10–22px (default 14) with headings one step under body; one `--dsw-*` token system (`base.css`, `corner-shape.css` superellipse, `focus.css`); **no literals, no Tailwind** — CSS Modules + clsx; 0.5px hairline `--dsw-elevation-stroke`; elevated surfaces use shadow tokens with `border: 0`; button md H36/R12, sm H28/R8; focus ring 2px `#4176E6` light / `#7AAAFF` dark, transparent in pointer modality except editable text.
- **Sidebar:** brand row + version badge, New Session (trailing keybinding text on hover), collapse control, Workspace/Session browser, bottom-pinned Settings. Sessions: 5 idle per workspace default, "Show more" pages 5; Last-updated (persisted) vs Manual drag order; pinned lead; archive-only mode; **no deletion** (archive + Undo). Search: title+workspace substring instantly, 250ms-debounced host content search with snippets, abort-per-query, cap 20, failure keeps metadata matches. Scrollbars: pointer-indirection (transparent until pointer enters, 2s persistence). Row states: `StateDot` (solid green done / amber warning / red error / grey idle / rotating ongoing), pending states replace the trailing time ("Waiting for approval", "Plan awaiting review", "Waiting for answer").
- **Right panel:** no separate header — controls ride the tab-strip chrome; two presentations (**push** vs **fullscreen**; <768px forces fullscreen); two horizontal panes with 20–80% clamped split; tab kinds: Files, Document, Browser, Terminal, built-in **guide** (muted compass, one capsule per entry; exactly one entry opens directly). File links and tool-row line references open as tabs (`dsh-resource://`, `#L24` reuse). "A column of the page, not a card over it" — takes the conversation's ground colour.
- **Settings:** modal panel portaled beside `#root`, shared 800×800 bounded by viewport, ≥24px margin; Esc closes and **restores focus to the invoking control**; Mod+/ opens the shortcut reference above Settings. Nav is a projection of contributed sections (General, Models, Plugins, Account, Keyboard shortcuts). Onboarding ledger mounts exactly one visible step at a time and `inert`s the root.
- **Updates:** fixed nightly feed, 10-min polling with ±20% jitter, backoff doubling to 1h; manual "Check for Updates…" joins in-flight checks; automatic checks never open dialogs. **Status carrier = the lower-left account row** (availability, spinner + download %, verification, readiness, persistent red retry with tooltip); collapsed sidebar shows the same as a brand-blue dot on the expand button. Apply: shell-owned restart confirmation that **warns when running agents/queued input/jobs would be interrupted** (API requests alone don't warn); Host locks new requests, drains, re-checks; drain timeout refuses install and unlocks. Windows: installer explains close/reopen/ don't-relaunch; `--updated` re-focuses the window. Failure: typed cause → guidance, "View technical details" collapsed by default (exit status, signal, deadline facts — not plugin stderr); 7-Zip extract failure writes a log + **Copy error details** button; same-path upgrade keeps the old dir until promotion; **downgrades disabled**; fatal failures offer Exit / Restart / **Disable third-party plugins** (renames the patch file) + restart.
- **Icons:** owned by `ui-primitives`; names end in `Regular` (1px artwork) or `Medium` (same geometry at **1.3px stroke**); both weights always exported so callers choose emphasis without a new API; glyphs are decorative (no labels); reuse-before-copy rule; feature packages cannot import each other's atoms. Plugin artworks fixed 36×36; file-type glyphs 28px. Menu icons consume `--dsw-alias-menu-icon`; destructive icons keep the error color.
- **Micro:** streaming markdown freezes completed blocks and re-parses only the tail (incl. unclosed fences + Shiki grammar resume); **`TextShimmer`** for running titles/reasoning/tool rows/retry line (300ms delay, 1s sweep, 500ms rest, 15° tilt, reduced-motion → static); completed-turn action footer starts 20px below prose, visible only on the latest turn (hover/focus on history, always on no-hover devices); tool rows 6px apart, group title 8px before content, assistant 12px from process rows; empty lists = centered glyph-over-text with named emptiness ("No archived sessions yet" + "View other sessions"); provider quota errors use neutral copy, not the provider message; terminal failures render an inline red-dot row (retries don't create rows); Esc Esc (500ms) stops a response; shortcut-reference dialog 480×600 with subsequence search, 42px rows, per-key recording drawer; **turn rail** (10px pitch marks, gradient fades, hidden once the transcript column's usable width drops below ~900px — column width, not viewport) + back-to-bottom button.
- **Verified addenda:** **focus rings are modality-aware** — hidden under pointer
  input except on editable controls, restored on keyboard use; **search is
  abort-ordered** — each new query aborts the previous request, and a failed
  content search keeps the metadata matches visible with no extra warning.

### A3. Claude Desktop (Anthropic)
*Consumer client; closed-source. Sources: support.claude.com, claude.com/download, academy.claude.com, teardowns.*

- **Launch:** download → open → Sign In (system browser → redirect back); same account syncs chats/projects/memory/preferences; **no in-app API-key field** in the normal chat UI (keys live in the Console) **[not verified for enterprise/Bedrock configs]**; Cowork first-run asks for a project folder (not home). Splash/onboarding tour: **[not verified]**.
- **Layout/theme:** three top tabs (Chat, Cowork, Code); collapsible left sidebar; centered chat column; optional right artifact panel. Light/Dark/Match-System in Settings → Appearance, plus chat font choice (Default/Match System/Dyslexic Friendly). Brand type: Styrene B + Tiempos; product now offers Anthropic Serif/Sans/System/Dyslexic. Brand palette (from a brand-guidelines mirror, not an app spec): `#141413`, `#faf9f5`, `#b0aea5`, `#e8e6dc`, accent `#d97757`. Exact spacing/radii/shadows: **[not verified]**.
- **Sidebar:** New chat (+, also Cmd/Ctrl+Shift+O), chat history, Projects, Artifacts tab, search, initials/account block lower-left (opens Settings). Collapse button top-right of the sidebar; "cannot be fully removed". Grouping by project documented for Claude Code desktop (filter by status/project/environment). Cmd/Ctrl+Shift+S toggles; Cmd/Ctrl+Shift+; focuses input; Cmd/Ctrl+Shift+C copies last response; Cmd/Ctrl+K palette; `/` slash commands; Cmd/Ctrl+/ shows all shortcuts.
- **Right panel (Artifacts):** opens automatically when the model produces an artifact (card in reply → split pane); Preview/Code tabs, Copy/Download/Publish/restart-preview, `|←` hide control; one artifact at a time per conversation, all browsable in the sidebar Artifacts tab; optional full-width mode. Drag-to-resize: **[not verified]** (feature requests for resizable panels in Code desktop imply fixed). A recent UX change removed the always-visible re-open button (user complaints) — lesson: keep a persistent affordance for a closed panel.
- **Settings:** initials → Settings; left category list: General (incl. global instructions), Appearance, Notifications, Privacy, Billing, Memory, Capabilities, Connectors, Extensions/Developer, Voices, Language, Cowork, Reflect, Time and focus. Settings search: **[not verified]**.
- **Updates:** "Claude" menu → Check for updates; background download; blue top banner / corner notification prompting restart; "Restart to update" applies; release notes in Help Center only (in-app "what's new" **[not verified]**); failure/rollback **[not verified]**.
- **Thinking:** "Thinking" indicator with a **live timer**, then an expandable Thinking section above the response; incomplete thinking says "the rest of Claude's thought process is not available."
- **Icons:** no published spec — **[not verified]**; visually small monochrome outline glyphs.

### A5. Chart look reference: LuxAlgo/Vela (+ lightweight-charts conventions)
*The chart reference the brief asked for. Identity verified: **LuxAlgo/Vela**
(Apache-2.0) — "the open-source charting library for the agentic era": headless
core, WebGL2 renderer (canvas2d fallback), workspace UI, plugin SDK, Pine-Script
engine. The "AI" is positioning plus host-facing annotation APIs — not a built-in
chat. Rejected name-shares: Vela Exchange (DeFi perps contracts, no chart UI),
Vela Trading Systems (proprietary vendor), go-vela (CI). All claims below are from
source, cited repo-relative.*

- **Theme** (`src/core/theme.ts`): dark background `#151619`, axis text `#b2b5be`,
  grid `#20222c`, border `#2a2b30`; candle hues are shared by both themes —
  "switching themes recolors surfaces, never the series."
- **One palette module** (`src/core/palette.ts`) — every fixed color lives once:
  BULLISH `#089981` / BEARISH `#f23645`; ACCENT `#2962ff` (active chrome) with
  drawing default `#38c0fd`; INFO `#5b9cf6` — "statistical overlays (regression,
  VWAP)… read as derived data"; WARNING `#ff9800` (second lines); NEUTRAL
  `#787b86` (levels, flat slope); VALID/INVALID deliberately brighter/cooler than
  BULLISH/BEARISH "so a validity wash never reads as direction"; a categorical
  list ordered for adjacent-hue contrast + stable hash for multi-series.
- **Candles** (`chartConfig.ts`, `candle-lod.ts`): body visible, **border off**,
  wick inherits the body color; body = floor(spacing·0.7), wick capped at half
  body width; 3-tier LOD (full → wick-only → aggregate) with device-pixel
  snapping so candles stay symmetric; hollow mode when the body drops.
- **Crosshair:** 1px **dashed**, opacity 0.4, neutral `#9aa0ad`, snapped to bar
  center, rendered on its own transparent canvas; axis chips on plate `#595959`
  with auto-contrast ink.
- **Last price** (`ChromeRenderer.ts`): dotted 1px line + axis chip **filled with
  the candle-direction color**; optional bar-close countdown merges into one
  stacked chip.
- **Axis/typography:** axis text 11px and deliberately recessive; chrome text
  `#d1d4dc` one step brighter than the axis.
- **Volume** (`VolumeRenderer.ts`): bottom-anchored columns on a canvas **behind**
  the data canvas, own scale (tallest visible bar = 96% of pane), never touches
  price autoscale; direction-colored; candle-body width; can move to its own pane.
- **Watermark** (`watermark.ts`): "SYMBOL · TF", ≤36px, **opacity 0.05**, price
  pane only.
- **Indicators** (`core/native-indicators/classics/`): an `overlay` flag decides
  over-price vs **own pane below** (26px collapsed strip, draggable separator).
  **Color is role-based, not per-indicator:** statistical/first line = INFO blue,
  second line (signal, %D) = WARNING orange, slope coloring = BULLISH/BEARISH,
  fixed levels = NEUTRAL gray dashed 1px; bands/fills 40–50% alpha; histograms
  per-bar direction-colored; line width 2 everywhere.
- **Legend** (`InputsUI.ts`): lives in its own pane; chip = translucent
  background wash at rest, solid when hovered/open; 12px/600 title; live values
  beside the title **in the plot's color**; ~24px controls; collapsible.
- **Drawings:** default `#38c0fd` 2px; `levelPalette.ts` pins Fibonacci ratio
  colors once so ~18 tools can't drift; highlighter = wide translucent `#ff5d00`.
- **AI annotations:** `chart.marks` bottom lane (colored glyphs, click panels),
  time-range highlights `rgba(120,130,160,0.10)`, ghost crosshair for synced
  charts — AI ink is kept separate from direction hues.
- **Converging conventions:** lightweight-charts' own candlestick defaults use
  one hue per direction with wick/border inheriting it (`#26a69a`/`#ef5350`); v5
  added native panes. Dark-chrome convention across references: near-black
  background (never pure black), grid barely lighter, recessive gray axis text,
  legend top-left with values in series color.

### A4. ChatGPT desktop (OpenAI)
*Closed-source (Electron + webview; Linux repackagers confirm). Sources: learn.chatgpt.com/docs, help.openai.com, community reports.*

- **Launch:** install → open → sign in → choose where to work → send first message; no consumer API-key entry; macOS app historically followed OS appearance only (in-app toggle on Windows: System/Light/Dark + optional Contrast). Splash is a logo (artwork/duration **[not verified]**).
- **Layout/theme:** top-left ChatGPT/Codex switcher + Chat/Work toggle; left icon rail + sidebar; main chat pane; right file-preview/artifact panel. OpenAI Sans (400 body / 500 labels / 600 display; Inter/system substitutes), sizes 13/14/16/17/18/22/28/48px, tracking −0.03em display. Dark moved toward near-pure black (user eye-strain complaints); light = pure-white surface, near-black type, ~12%-black hairlines, ~6px card radii. Spacing grid **[not verified]**.
- **Sidebar:** Recents (sortable Last-updated/Manual, filterable, pinnable), Projects, Activity bell, chat search (assignable shortcut), new-chat entries (⌘N, Quick ⌘⌥N, temporary ⇧⌘N), avatar → profile menu → Settings bottom. ⌘B toggles; wordmark reopens.
- **Right panel:** file/artifact preview (docs, slides, sheets, PDFs; HTML → rendered/source toggle); running-task sidebar can surface plan/sources/files/summary; built-in browser is a separate side surface with tabs, address bar (⌘⇧B), full/split/hidden layouts. Multi-item preview + resize: **[not verified]**.
- **Settings:** profile → Settings or ⌘,; areas: General (Appearance, Contrast), App hotkey, Voice, Personalization, Plugins (per-plugin "Allow low-risk actions"), Cloud browser, Privacy Center, Security history; Codex areas under Computers/Environments. Keyboard Shortcuts page is a **searchable table**; some shortcuts assignable only there. Free-text settings search: **[not verified]**.
- **Updates:** macOS "check for updates and restart" (no progress UI described); Windows via Microsoft Store; Linux native .deb/.rpm with signed APT repo; community update manager polls signed metadata, verifies SHA-256, waits for app exit, keeps the previous package for `rollback`. In-app release-notes/rollback UI: **[not verified]**.
- **Micro:** streaming fade-in (explicitly improved in release notes); inline message error + **Retry** (Mar 2025); sticky copy on code blocks; ⌘. stops streaming; ⌘F find-in-chat; ⌃⇧M model picker; large documented shortcut set (learn.chatgpt.com/docs/reference/commands).

### Cross-reference takeaways (what all four agree on)
1. **Tokens over literals** (Hermes, DSH) — the repo's `index.css @theme` already does this; the gap is the ~20 hand-rolled SVG/hex sites.
2. **Sidebar collapses to a rail, not away** (DSH 56px rail; Claude keep-open; ChatGPT icon rail) — current harness hides navigation behind a hamburger.
3. **Update status lives in a quiet, persistent place** (DSH account row + collapsed dot) with a full overlay only for download/ready — current harness has the overlay + header chip but no "up to date" feedback on manual check and `installing` renders null.
4. **One Esc = one thing** (Hermes); **focus returns to the invoking control** (DSH); **never fabricate progress** (Hermes boot, DSH loading page).
5. **Thinking indicators settle to a duration label** ("Thought for Ns", Claude timer) — the repo's `ReasoningRow` already does "Thought · 14s"; the live view and desk floor don't.
6. **Icon discipline**: one library, curated import layer, inherited sizes, one stroke weight (DSH Regular/Medium 1px/1.3px; Hermes Tabler `size-3.5`).
7. **Chart cosmetics converge too** (Vela + lightweight-charts, A5): one hue per direction with wick/border inherited, role-based indicator colors, recessive chrome. The structure is portable; the hues are not — C9 remaps everything onto our tokens.

---

## Part B — Current-state audit (with file paths)

### B1. Shell & navigation
- Root: `App.tsx:2794` — overlays mount **outside** `<main>` (correct per render-probe doctrine): `VersionHistoryDashboard`, `UpdateOverlay`, `LiveStreamView`, `UserProfileManager`, `AccuracyModeModal`, `LiveMarket`, capture modals, `SettingsMenu`, `VisionDataViewer`, `AutomationView` (`z-[75]`), `AutomationEditorModal` (`App.tsx:2794-3007`).
- **Five real surfaces** (AGENTS.md says six — it's five + the Approvals overlay): trade (`TradeView`), journal, studio, agents ("Chat"), learn — `App.tsx:3151-3340`, `hooks/useSurface.ts:11-30`, `components/shell/SurfaceMenuList.tsx:44-51`. render-probe's six-entry surface list (`scripts/render-probe.cjs:764-777`) is exactly these five + the Approvals overlay, so AGENTS.md's "six nav surfaces" counts the overlay.
- **No persistent left sidebar.** `SidebarContent` (`components/shared/Sidebar.tsx:130-659`) renders only inside the hamburger drawer (`Header.tsx:418-476`, portaled to `document.body` because the header's `backdrop-blur` clips fixed children — documented at `Header.tsx:410-417`). Keyboard: `Alt+1..5` (`App.tsx:1500-1508`), hash routing (`hooks/useSurfaceRouter.ts`).
- Right panel: per-surface only — Chart AI dock (`TradeChatPanel`, collapse/persist `TradeChatPanel.tsx:774-779`, drag-resize `TradeView.tsx:991-1001`), `AdvancedAnalyticsSidePanel` (right slide, `inert` at `:133`), Journal aside, `VisionDataViewer` drawer, fixed overlays for search/saved-analyses/live-market.
- Responsive: below `lg`, Trade becomes a single-pane Chart|AI|Book segmented control (`TradeView.tsx:356-366`, tablist `:909-943`); mobile viewport meta + safe-area insets (`index.html:9-10`, `index.css:1256-1263`); Electron floor is **minWidth 800 / minHeight 600** (`electron/main.cjs:953-954`; the `App.tsx:3342-3346` comment cites the width only).
- Z-ladder: splash `z-9999` → UpdateOverlay `z-[200]` → modals `z-[120]` → Confirm/Toast `z-[100]` → AutomationView `z-[75]` → drawers `z-50` → pipeline card `z-40` → header `z-20`.

### B2. Launch / onboarding
- Cold-start splash painted outside `#root` (`index.html:29-42`, `aria-label="August Trading is loading"`), faded and **removed** by `index.tsx:80-86` (removal is asserted by e2e/boot-probe).
- First run: `UserProfileManager` gate (`components/settings/UserProfileManager.tsx:87`, `canClose = !isFreshBlank && !isBusy` at `:25-29`) — workspace create/import, inline errors, `aria-invalid`/`aria-describedby`.
- No providers → Settings opens on **models** not general (`SettingsMenu.tsx:256-263,380-387`) with a "Connect an AI service to get started" callout (`ModelsTab.tsx:73-80`); composer placeholder degrades (`ChatComposer.tsx:138`).
- Empty states: shared `components/ui/EmptyState.tsx` (automations, conversations, search no-match, settings no-match).

### B3. Settings
`components/settings/SettingsMenu.tsx`: full-screen modal (`role="dialog" aria-modal`, `z-50`, blur backdrop), two-column grouped nav + search (`NAV_GROUPS` `:208-240`: Setup / Analysis / Knowledge / Account), search filters by label + keywords (`:274,296-300`), badges, `aria-current="page"`, unsaved-edits confirm (`:324-338`), Developer `<details>` + version at rail bottom (`:457-473`), lazy tab bodies with `TabFallback`, deep links via `settingsInitialTab`. Row pattern: icon tile + title + description + right-aligned control.

### B4. Update flow
- Main: `electron/main.cjs:1043-1216` — full state machine (`idle|checking|available|downloading|downloaded|installing|error`) with bytes/s + transferred/total telemetry, markdown-stripped release notes (4000-char cap), `autoDownload=false`, `autoInstallOnAppQuit=false`, `update:install` waits for the renderer's `quit-now` or 5s fallback.
- Preload: `electron/preload.cjs:15-22,46-51`. Renderer: `hooks/useAutoUpdate.ts:24-92` (Electron-only, no-ops on web).
- `UpdateButton` (header chip + drawer footer): idle `vX.Y.Z`, checking spinner, available + "Update", downloading `N%` pill, downloaded "Restart", error + "Retry", **installing renders null** (`UpdateButton.tsx:28-30`).
- `UpdateOverlay` (`z-[200]`, `aria-live="assertive"`): downloading = determinate bar + % + MB/s + ETA; downloaded = pop-in check + "What's new" collapsible (auto-open once per version) + "Install & Restart"; installing = cycling mono lines then `quitNow()` after 1.9s (300ms reduced-motion).

### B5. Icons
- One library: `lucide-react@^1.26.0`. Canonical re-export layer `components/shared/Icons.tsx:13-77` (legacy names) + `LoadingIcon` (`:84-86`).
- **Inconsistency:** 82 files import `lucide-react` directly (78 production, 4 test/e2e); `SurfaceMenuList.tsx:11-17` mixes both styles in one file.
- **~23 hand-rolled inline SVGs** aping lucide: `ProviderManager.tsx:47-91` (7 glyphs, mixed 1.8/2 stroke), `ChartToolRail.tsx:28,38,48`, `DebateStage.tsx:189,202`, `ImageViewerModal.tsx:44`, `MistakeWarningBanner.tsx:74`, `MemoryFilesManager.tsx:585,595`, `DeskScene.tsx:582,607`, `SpeechBubble.tsx:110`, `BotFace.tsx:97,121`, `SessionUsagePanel.tsx:68`, `ModelPerformanceDashboard.tsx:85` (donuts), `TradeView.tsx:268` (sparkline).
- Sizes in free-fall: `h-3 w-3`, `h-3.5 w-3.5`, `h-4 w-4`, `h-5 w-5`, `w-6 h-6`, `width="14" height="14"`. No `strokeWidth` overrides on lucide (default 2 everywhere); custom SVGs split 1.8 vs 2.
- **`⏱` emoji used as an icon** (`Sidebar.tsx:441`); plain `+` glyph (`Sidebar.tsx:431`).

### B6. Theming
- `index.css:12-199` `@theme`: page `#0b0b0a`, panels `#141412`, raised `#1f1f1c`, hairline `#2f2f2f`, ink ramp `#f6f6f1→#7e7e78` (zinc-600 bumped to `#7e7e78` for AA on 9–11px labels, `index.css:22-31,176-186`).
- Semantics: emerald `#07b56a` = gains/up/Long, rose `#f75d5f` = losses/down/Short, amber `#f08800` = warnings, cyan `#399ef7` = info. Brand gradient reserved for wordmark + active nav. Type: Geist Variable / DM Serif Text / JetBrains Mono; scalable `text-ui-*` ramp off one `--ui-font-size` dial.
- **Dark-only** (`index.html:28`; light experiment reverted by user decision 2026-09-10 — do not re-flip).
- Hardcoded hexes remain in chart palettes (`EquityCurveDashboard.tsx:69-73`, `WinRateDashboard.tsx:40-47,410-438`, `VersionHistoryDashboard.tsx:193-201`, `ModelPerformanceDashboard.tsx:54`), bot/avatar identity palettes (by design: `BotFace.tsx:14-23`, `pixelAvatars.ts:61-88`), two literal base-color surfaces (`LearnView.tsx:99`, `AgentsView.tsx:797`), one stray shadow hex (`AutomationView.tsx:46`).
- **Two color vocabularies:** semantic `rose/emerald/amber` in trading UI vs generic `red/green/yellow` (aliased to identical hexes in `index.css:88-95,121` — no visual drift, two conventions) in ~15 settings/error files; `getWinRateColor` (`components/dashboards/learning/shared.ts:12-16`) uses `yellow-400`/`red-400`.

### B7. Debate view — the headline finding
**`components/analysis/DebateStage.tsx` (the "messenger-style debate floor") is dead code** — rendered only in `tests/debateStageSteer.test.tsx:16,29,41`; imported in production only for types (`DeskScene.tsx:27-30`, `utils/debateStageActors.ts:16`). Comments at `App.tsx:1346-1350` and `DebateStage.tsx:55-60` describe components that don't exist. `App.tsx:1351-1352` declares `externalOpenActor`/`externalOpenActorNonce`, set from the desk scene (`App.tsx:3449-3456`) but **never read** — the "click a seat to open its full transcript" hand-off goes nowhere.
The debate actually surfaces through **four divergent implementations**:
1. **DeskScene** (opt-in 2D floor): `PixelSeat` per debater, status pip (amber speaking / cyan thinking / emerald live), per-seat italic `thinking…` line — **N thinking seats = N simultaneous typing rows** (`PixelSeat.tsx:148-155,183-188,247-251`).
2. **LiveStreamView** (post-mortem only): one `AnalystPanel` per provider, native `<details>` "Thinking" + "Final output" + "Complete" badge (`LiveStreamView.tsx:89-131`).
3. **Transcript rows**: `ChatTranscriptRow.tsx:99-123` (bubble + byline), dock `ChatTranscriptList.tsx:107-215` (timeline, copy/pin, provenance, `VerdictAudit`, `KeyLevelsCard`, `TradeProposalCard`).
4. **Journal "Think" tab**: `ReasoningPanel.tsx` — per-analyst cards grouped by lens, moderator synthesis, debate transcript `<details>` (200-char truncation).
- **Four different "typing" framings** (above) + `GroupChatView.tsx:384-386` bare `{name} is thinking…` with **no live-region role**.
- **Clarification cycle is invisible to the user**: moderator↔analyst Q/A runs fully internally (`constants/prompts/debatePrompts.ts:449-532`, `ensembleService.ts:2719-3040`); the only trace is the "Clarification" rung in the stage ladder (`RunContractPanel.tsx:34`).
- **Moderator signal card** = `VerdictCard.tsx`: direction pill (Long emerald / Short rose / Neutral zinc), confidence, grade, review/quarantine pill, "Conviction auction" (per-seat sealed 0–100 stakes, `CONVICTION_RE` extraction, tight/wide spread readout). In-transcript explanation via `VerdictAudit` (`WhyAvoidPanel`, `WaitForConfirmationBanner`, `EvidencePackCard`, `RunContractPanel`) wrapped in an error boundary so a decorative throw can't blank the transcript.

### B8. Team strip & Learning
- Roster = Agents surface conversation rail (`AgentsView.tsx:547-579` rows; active-bot strip `:817-861` with `lessons · skillsAuthored · evidence` + notebook pills). `Sidebar.tsx:112-116` documents that no roster slot exists in the sidebar.
- **Per-agent win rates do not exist** — `BotLearningStat` (`services/agents/botLearning.ts:329-340`) carries lessons/skills/evidence/lastLessonAt only. Win rates live in Learning/Studio dashboards (`HarnessSection.tsx:171-218` per-model×regime leaderboard, `WinRateDashboard.tsx`, `StrategyStudio.tsx:119-193` `RegimeMatrixStrip` — family×regime heatmap, live regime outlined in cyan, and the matrix "already drives retrieval ranking and the moderator's prompt").
- Similar-setup pool: `HarnessSection.tsx:115-169` (indexed setups, avg matches/query, cold-start, drawdown, evidence-coverage buckets); moderator's own evidence in `EvidencePackCard.tsx:62-76`.
- Stored reasoning: `ThinkingStoreService` → `ReasoningPanel` (filters by role analyst/moderator/debate_turn) → `ThinkingRecordCard`; in-chat via `ChatWorkTimeline` merging reasoning around `[Desk tools]` markers into `ReasoningRow`/`ToolActivityRow` inside one `AnalyzedRow` ("Analyzed for Ns").

### B9. Chat screen & trading data
- **Signal/trade cards:** `TradeProposalCard.tsx:25-53` (direction pill, symbol, confidence, Entry/SL/TP 3-col mono grid, rationale, Log/Cancel) — **does not show R:R even though `computeRrRatio` exists and `rrRatio` is built onto the logged analysis** (`services/trade/proposedTrade.ts:48-49,113`). `KeyLevelsCard.tsx` (Level·Price·Dist·Context table, live "last" divider, click-to-pin, chart toggle). Label formats vary across `WatchListPanel.tsx:112-120`, `SavedAnalysesGallery.tsx:113-115`, `CompareModal.tsx:34-36`, `SavedAnalyses.tsx:60-69`, `TradeLog.tsx:335-347`, `AutomationRunCard.tsx:68`.
- **Chart:** `lightweight-charts` (deliberately not the TradingView iframe), own Binance kline fetchers, TradingView-style drawings on a transparent overlay canvas, Entry/SL/TP lines via `verdictLevels()` (`services/trade/chartData.ts:58+`), `measured_move` annotates risk/reward on-canvas (`TradingChart.tsx:865-907`).
- **R:R has two colliding conventions** — reward-first `2.0:1` (`TradingChart.tsx:907`) and `2.00:1` (`utils/avoidReason.ts:78`) vs risk-first `R:R: 1:2` (`utils/tradeInsightBrief.ts:41`), plus the realized multiple `avg R 1.80` (`WeeklyReviewCard.tsx:33`, a different metric on purpose per AGENTS.md); **no `Intl.NumberFormat` anywhere**; `fmtPx` duplicated in `KeyLevelsCard.tsx:39`; % decimals vary 0–4 (win rate 0, PnL 1, spread 3–4, Brier 3); currency mixed (`$1.2K` `fmtUsd` vs `$0.003` costs vs bare prices).
- **Colors:** semantic tokens used consistently for Long/Short and P&L; `VOLUME_UP/DOWN` hand-rolled rgba matching the tokens (`services/trade/chartData.ts:26-27`); `KEY_LEVEL_COLORS` categorical by level kind.
- **Accessibility weakest spot:** the chart canvas and overlay have **no role/aria-label/text alternative** (`TradingChart.tsx:1181,1197,1204`); `KeyLevelsCard` is the de-facto text alternative; `Sparkline` is `aria-hidden`.

### B10. Dead UI / fake status
- No TODO/FIXME/"coming soon"/empty-onClick found. Commented-out dead block: memory-compression effect (`App.tsx:1028-1046`). Intentional no-op retained: `handleQuotaExceeded` (`App.tsx:1656-1661`) — modal call sites still pass it.
- **Cosmetic-only cyclers** (do not claim real progress but read as staged progress): splash "Loading modules / Restoring session / Connecting market data" (`index.html:37-41`), update "Preparing your session… / Relaunching…" (`UpdateOverlay.tsx:224-226`) — nothing in code labels either as decorative (the `index.css:348` comment describes only the cross-fade).
- `Sidebar.tsx:456` defensive no-op fallback (unreachable in practice).
- **"LIVE MARKET (BTC)" header label is hardcoded** (`Header.tsx:245`) — and the sampler itself hardcodes BTCUSDT (`hooks/useMarketData.ts:39,42`), so the label matches the data only by accident. Binding the label to the hook's actually-sampled symbol is the UI fix; multi-symbol sampling is logic work (out of scope).

### B11. Accessibility (strong patterns worth keeping)
Dialog semantics on all modals; Journal tablist with roving focus + arrow keys (`Journal.tsx:204-219,309-319`) — but the Trade mobile tablist has **no** arrow-key handler (`TradeView.tsx:892-924`); Toast `role="alert"`/`status`; UpdateOverlay `aria-live="assertive"` + progressbar values; focus traps in drawer/Settings; `inert` removes off-screen panels from the tab ring; Esc-gating (`App.tsx:1410-1442`); ⌘K palette, ⌘, settings; reduced-motion handling throughout; 4.82:1 contrast on micro-labels by design.

### B12. Ranked inconsistencies
1. DebateStage dead code + dead `externalOpenActor` state + stale comments (B7).
2. TradeProposalCard hides the computed R:R (B9).
3. R:R in two colliding conventions (reward-first vs risk-first); % decimals 0–4; `fmtPx` duplicate (B9).
4. Two icon import styles + ~20 hand-rolled SVGs + free-fall sizes + `⏱` emoji (B5).
5. Four divergent thinking indicators; GroupChatView's has no live region (B7).
6. No persistent sidebar — navigation hidden behind a hamburger (B1).
7. Two color vocabularies (semantic vs generic names, identical hexes) (B6).
8. Update flow: `installing` renders null; no "up to date" feedback on manual check (B4).
9. Chart has no text alternative (B9).
10. Clarification cycle invisible; per-agent win rates absent from roster (data gap — out of scope for a pure UI refactor) (B7/B8).

---

## Part C — Design spec

### C1. Design tokens

**Colors** — formalize the existing `@theme` block into named semantic tokens (same hexes, no visual change):

| Token | Value (dark) | Meaning |
|---|---|---|
| `--surface-page` | `#0b0b0a` | page |
| `--surface-panel` | `#141412` | panels |
| `--surface-raised` | `#1f1f1c` | raised surfaces |
| `--stroke-hairline` | `#2f2f2f` | hairlines (`border-zinc-800/80`) |
| `--ink-primary/secondary/tertiary` | `#f6f6f1` / `#a1a19b` / `#7e7e78` | text ramp (tertiary stays AA-tuned) |
| `--trade-up` | `#07b56a` family | gains, up, Long, WIN |
| `--trade-down` | `#f75d5f` family | losses, down, Short, LOSS |
| `--warn` | `#f08800` family | warnings, watch |
| `--info` | `#399ef7` | info / in-progress (one cyan accent per view) |
| `--brand-start/mid/end` | `#eb53ff→#ff538e→#ff9a32` | wordmark + active-nav indicator only |

**Light theme:** define the same semantic tokens mapped to a light palette (page `#faf9f5`, panel `#ffffff`, raised `#f4f3ef`, ink `#141413`/`#57564f`/`#8a897f`, same semantic hues darkened for AA). **Decision point D1:** ship dark-only now (per the recorded 2026-09-10 user decision) and keep the light mapping dormant, or activate it. Recommendation: dormant — the token work makes light a config change later, not a rewrite.

**Spacing:** 4px base scale — 4/8/12/16/24/32/48/64; panel padding 16; bubble gap 12; section gap 24. No `space-y` magic numbers outside the scale.

**Type:** keep the `text-ui-*` ramp and the `--ui-font-size` dial. **Resolve the 11px literals** (`index.css:536, :768, :794`): add a `text-ui-micro` step (base−3) and migrate those sites — one dial, one role. Geist Variable UI / DM Serif Text display-only / JetBrains Mono data. Every numeric readout `font-mono tabular-nums` (already doctrine).

**Radii:** `rounded-control` 8px (inputs/buttons), `rounded-bubble` 12px (chat bubbles). Nothing else. DSH's superellipse corners: reject (visual noise on a trading terminal).

**Shadows:** one elevation token for floating panels (dropdowns, popovers, toasts) — hairline border + soft shadow, per Hermes "flat, not boxed". No card-in-card, no double borders (already doctrine).

**Motion:** `--ease-snappy` 0.12–0.18s; name the property (`transition-colors`, `transition-transform`), never `transition-all`; durations >180ms only for data-value animation (progress bars) and documented. No new `@keyframes` beyond the existing tick-flash/beacon/streaming-dots.

**Z-ladder as tokens:** name the existing rungs (splash `z-9999` → update `z-[200]` → modals `z-[120]` → confirm/toast `z-[100]` → automation `z-[75]` → drawers `z-50` → pipeline `z-40` → header `z-20`, B1) as CSS variables — Hermes pattern — so overlays stop fighting via ad-hoc z classes.

**Focus rings are modality-aware:** hide `:focus-visible` rings under pointer input except on editable controls; keyboard focus styling resumes on keyboard use (DSH pattern).

**Tooltip tax rule:** `Tip` appears only when hover teaches something new — never on menu triggers or close buttons; native `title=` stays banned (Hermes doctrine; already matches `ui/Tip`'s `shortcut=` rule).

**Number format standard** (new, in `utils/formatters.ts`):
- prices: `fmtPrice` (canonical; delete the `fmtPx` duplicate in `KeyLevelsCard.tsx:39`)
- percents: new `fmtPercent(v, digits)` — win rates 0, P&L 1, spread 3, Brier 3; call sites declare digits explicitly
- R:R: **one shape everywhere: `2.4:1` (reward:risk)** — the majority convention already at `TradingChart.tsx:907` and `utils/avoidReason.ts:78`, and numerically the ratio `utils/riskReward.ts` computes (nearest target ÷ stop). Migrate `utils/tradeInsightBrief.ts:41` (risk-first). The realized "avg R" multiple (`WeeklyReviewCard.tsx:33`) is a deliberately different metric — keep it distinct, but format it through one helper.
- currency: `fmtUsd` for aggregate USD; costs `$0.003`; prices bare (no `$`)

### C2. Icon system

**Library: lucide-react (already the single library — keep it).** Standard:
- **Sizes:** `16px` default UI icon, `12px` dense/micro (inside pills, table rows), `20px` only for primary header actions. No other sizes. All lucide imports carry an explicit size class from the set `{h-3 w-3, h-4 w-4, h-5 w-5}`.
- **Stroke:** lucide default 2 everywhere; delete the 1.8 variants in hand-rolled SVGs.
- **Import discipline:** all feature code imports from `components/shared/Icons.tsx` (the existing re-export layer); direct `lucide-react` imports in the ~75 files migrate to it. `SurfaceMenuList.tsx` picks one style.
- **Identity graphics are not icons:** `BotFace`, `PixelSeat` avatars, `pixelAvatars`, sparklines, donut charts, the brand wordmark stay custom — they're data/identity, governed by their own palettes.

**Mapping (every non-lucide glyph → replacement):**

| Current | Location | Replacement |
|---|---|---|
| 7 hand-drawn provider glyphs | `ProviderManager.tsx:47,55,62,71,78,85,91` | lucide `Key`, `Server`, `Cpu`, `Globe`, `Wrench`, `Plug`, `ShieldCheck` (exact per-provider mapping at implementation) |
| Chart tool glyphs | `ChartToolRail.tsx:28,38,48` | lucide `PenLine`, `Minus`, `Square`/`SquareDashed`, `TrendUp`, `Fibonacci`-style via `Spline`, `MoveRight`, `ArrowUpRight`, `TextCursor`, `Ruler` |
| Debate glyphs | `DebateStage.tsx:189,202` | file deleted (dead code) |
| Image/eye glyph | `ImageViewerModal.tsx:44` | lucide `Image` / `Maximize2` |
| Mistake warning glyph | `MistakeWarningBanner.tsx:74` | lucide `TriangleAlert` |
| Memory file glyphs | `MemoryFilesManager.tsx:585,595` | lucide `FileText`, `Folder` |
| Desk glyphs | `DeskScene.tsx:582,607` | lucide `Monitor`, `LayoutGrid` |
| Speech bubble glyph | `SpeechBubble.tsx:110` | lucide `MessageSquare` |
| `⏱` emoji | `Sidebar.tsx:441` | lucide `Timer` (16px) |
| plain `+` glyph | `Sidebar.tsx:431` | lucide `Plus` |
| Donut/sparkline SVGs | `SessionUsagePanel.tsx:68`, `ModelPerformanceDashboard.tsx:85`, `TradeView.tsx:268` | keep (data viz, not icons) |

The exhaustive per-name mapping for the ~75 direct-import files is mechanical (grep + alias); I will produce the full table as the first action of Phase 1 and apply it in the same phase.

### C3. App shell

**Launch:**
- Keep the `index.html` splash (aria-labelled, removed-not-hidden at `index.tsx:80-86`). **Replace the fake staged cycler** ("Loading modules / Restoring session / Connecting market data") with a single static line + brand mark — per Hermes/DSH doctrine, a boot screen never fabricates progress.
- Keep `UserProfileManager` as the first-run gate; restyle onto the token set; add the DSH "Set up later" parallel for provider setup (already exists functionally as the Settings→Models redirect — surface it as an explicit button in the gate rather than only after closing).
- Loading states: `SurfaceSkeleton` for lazy surfaces (never `fallback={null}`) — already doctrine, keep.

**Left sidebar (new persistent rail + expandable panel):**
- Persistent **56px icon rail** (wordmark, 5 surface glyphs, new-chat, automations, spacer, account row) that expands to a **280px panel** on hover/click/toggle; collapses back to the rail; auto-collapses below 1024px (DSH numbers). Replaces the hamburger drawer — `SidebarContent` and `SurfaceMenuList` are reused as the panel's contents, so no navigation logic changes.
- Contents top→bottom: brand/wordmark · **New chat** (with trailing keybinding hint on hover, DSH pattern) · surface nav (the 5 surfaces) · conversation history (search box + list, from `SidebarContent`) · automations section · bottom-pinned **account row** carrying: profile, Settings entry, **update status** (DSH pattern: spinner + % while downloading, "Restart" when ready, red retry on failure, dot on the collapsed rail).
- Toggle: `Ctrl/Cmd+B`; surface shortcuts `Alt+1..5` unchanged. `Esc` closes an expanded panel (one Esc = one thing).
- **Decision point D2:** adopt the persistent sidebar (recommended — matches all four references; biggest visual change) or keep the hamburger drawer and only restyle it.

**Right panel (formalize per-surface docks into one system):**
- One right-panel contract: push (makes room) or fullscreen (below 768px forces fullscreen), drag-resize with **no transition delay**, width persisted per surface, handle hidden when closed, **close ≠ unmount for stateful panes** (Hermes Hide vs Close: the Chart AI dock stays mounted when hidden so scroll/composer state survives).
- Trade surface keeps the Chart AI dock as the first citizen; `AdvancedAnalyticsSidePanel` and the Journal aside migrate onto the same contract.
- Multiple simultaneous items: tab capsules in the panel's top strip when more than one dock is open (DSH pattern), each closable; the panel itself is one column of the page, not a card over it.

**Header:** keep contents; **bind the "LIVE MARKET (BTC)" label to the sampled symbol** (`Header.tsx:245` reads `liveMarketConditions` from `useMarketData` — display the real pair); keep the update chip as the overlay's compact twin.

**Responsive:** below `lg`, keep the single-pane Chart|AI|Book segmented control; add arrow-key support to that tablist (a11y gap, `TradeView.tsx:892-924`).

### C4. Debate / messenger view & signal card

**Decision point D3:** `DebateStage.tsx` is dead code. Recommendation: **delete it** (and its steer test, the dead `externalOpenActor`/`externalOpenActorNonce` state at `App.tsx:1351-1352,3449-3456`, and the stale comments at `App.tsx:1346-1350`, `DebateStage.tsx:55-60`) rather than resurrect a floor nobody can reach. The desk floor (`DeskScene`) remains the opt-in 2D view.

**One typing indicator, four current call sites → one component** (`components/chat/TypingIndicator.tsx`, new):
- Multi-seat: "N analysts thinking…" with per-seat chips (avatar + name) — replaces N simultaneous per-seat rows on the desk floor; single-seat: "{name} is thinking…".
- Pattern from the (dead but correct) DebateStage: **dots `aria-hidden="true"` + real text**, wrapped in `role="status"`/`aria-live="polite"` (fixes the GroupChatView gap at `GroupChatView.tsx:384`).
- Settles to **"Thought for Ns"** (DSH/Claude convention) — extends the existing `ReasoningRow` "Thought · 14s" pattern to the desk floor and live view.
- Reduced motion: static label, no dots/shimmer.

**Per-model expansion:** standardize on the `AnalyzedRow`/`ReasoningRow` `<details>` pattern everywhere (LiveStreamView's `AnalystPanel` already matches; ReasoningPanel's per-analyst cards keep their grouping but adopt the same summary line).

**Clarification cycle:** keep it internal (logic unchanged) but make it **readable after the fact**: the "Clarification" rung in `RunContractPanel`'s stage ladder becomes expandable, showing the stored moderator questions and analyst answers from the debate turns (`ReasoningPanel.tsx:105-123` already renders them — reuse that renderer).

**Moderator signal card:** keep `VerdictCard` (direction/confidence/grade/conviction auction); add **R:R** to the card when the analysis carries `rrRatio`; move the conviction auction behind a disclosure (it's a forensic detail, not the signal); keep `VerdictAudit`'s error boundary.

### C5. Settings IA
Keep the current grouped-nav + search modal (it already matches Claude/Hermes). Changes:
- Move Developer out of a `<details>` into the nav groups (Discoverability; keeps DiagnosticsPanel lazy).
- Add a **version + "Check for updates" row** in a new "General" section top (currently version lives only in the Developer details) — DSH pattern.
- Keep the unsaved-edits confirm, badges, deep links, and `aria-current="page"`.
- Add **focus-return-to-invoker** on close (DSH) if not already present (verify in Phase 4).
- No settings search field exists for values (only nav labels) — **not verified** whether references ship one; defer (low value vs. cost).

### C6. Update flow states
Keep the existing main-process state machine (it's already strong). Renderer contract:

| State | Header chip | Overlay | Account row (new sidebar) |
|---|---|---|---|
| idle | `vX.Y.Z` | — | version |
| checking | spinner "Checking…" | — | spinner |
| available | version + "Update" | — | "Update vX.Y.Z available" |
| downloading | `N%` pill | **determinate bar + % + MB/s + ETA** | spinner + % |
| downloaded | "Restart" | **pop-in + "What's new" (once per version) + Install & Restart** | "Restart to update" |
| installing | spinner (fix: currently renders null) | cycling lines → `quitNow()` | spinner |
| error | caption + "Retry" | dismissible error + Retry + "View technical details" (DSH) | red retry dot |
| up-to-date (manual check) | brief "Up to date" toast (new — DSH feedback) | — | — |

- Release notes: keep markdown-stripping (no `dangerouslySetInnerHTML`).
- Failure/rollback: electron-updater has no rollback — **state this plainly in the overlay's error state** ("Re-download the installer from the release page to revert") rather than implying a rollback exists. DSH's "disable third-party plugins + restart" recovery has no analogue here (no plugin system) — skip.
- Restart confirmation keeps its warning about running analyses/automations (DSH pattern; the wiring already exists via `update:install`'s drain).
- Keyboard: `Ctrl/Cmd+,` opens Settings; no update-specific shortcut (matches references).

### C7. Component inventory

**Keep (restyle only):** `ChatTranscriptRow`, `ChatTranscriptList`, `TradeProposalCard` (+R:R), `KeyLevelsCard`, `VerdictCard`, `VerdictAudit` + its panels, `ReasoningPanel`, `ThinkingRecordCard`, `ChatWorkTimeline`, `AnalyzedRow`, `ReasoningRow`, `TradeChatPanel`, `TradingChart` (+a11y + C9 visual retune), `TradingView` layout, `SettingsMenu` + tabs, `UpdateOverlay`/`UpdateButton` (+states), `UserProfileManager`, `SidebarContent`, `SurfaceMenuList`, `Header`, `StatusPill`, `EmptyState`, `Tip`, `SelectMenu`, `ConfirmDialog`, `Toast`, `DeskScene`/`PixelSeat`/`SpeechBubble`, `AgentsView` roster, `HarnessSection`, `RegimeMatrixStrip`, `WinRateDashboard`/`EquityCurveDashboard`/`VersionHistoryDashboard`/`ModelPerformanceDashboard` (re-token their hex palettes).

**Rewrite:** new `TypingIndicator` (unify 4 framings); new left `NavRail`/`NavPanel` shell (reusing `SidebarContent`); right-panel contract wrapper (wrap existing docks); `UpdateButton` installing state; chart accessibility layer (role/aria/text summary); splash cycler (simplify); `Icons.tsx` becomes the sole import surface.

**Delete:** `DebateStage.tsx` + `tests/debateStageSteer.test.tsx` (dead); `externalOpenActor`/`externalOpenActorNonce` + desk `onOpenActor` plumbing (dead); `fmtPx` in `KeyLevelsCard.tsx:39`; the `⏱`/`+` glyph hacks; the commented-out memory-compression block (`App.tsx:1028-1046`); `handleQuotaExceeded` no-op **only if** its prop plumbing can be removed without touching call-site behavior (else defer); stale comments describing non-existent components.

**Explicitly out of scope (logic/data, not UI):** per-agent win rates (needs `BotLearningStat` schema + computation — recommend a follow-up), the clarification cycle's internal orchestration, provider/model logic, SQLite/learning services.

### C8. Phased migration plan

Each phase: `npm run typecheck && npm run test && npm run build`, then `npm run render-probe` (updates expectations where nav structure changes), then a manual browser pass on the changed screens (doctrine: jsdom can't see an inflated pill). CI ratchets to respect: lint `--max-warnings 889`, `themeContrast.test.ts` (hue allowlist), `typeRamp.test.ts` (9/10px ban), `deadControlsGuard.test.ts`.

**Phase 0 — Dead code & standards (low risk, ~half a day)**
Delete DebateStage + dead state + stale comments + `fmtPx` dup; add `fmtPercent` and the single reward-first R:R shape (`2.4:1`) at `TradingChart.tsx:907` / `utils/avoidReason.ts:78` / `utils/tradeInsightBrief.ts:41`; replace `⏱`/`+` glyphs; fix the hardcoded "LIVE MARKET (BTC)" label by binding it to the symbol the hook actually samples.
*Verify:* typecheck, tests (delete the steer test), render-probe, Trade/Journal screens.
*Risk:* low. `debateStageActors.ts` type imports must be re-homed or deleted.

**Phase 1 — Tokens, type ramp, icon standard (low risk)**
Formalize semantic tokens in `index.css` (same hexes); add `text-ui-micro` (11px role) and migrate 11px literals; re-token the four dashboard hex palettes to `chartColor('--color-…', fallback)` (already the TradingChart pattern); complete the full icon mapping table and migrate the ~75 direct imports to `Icons.tsx`; replace the ~20 hand-rolled SVGs per the C2 table; enforce size classes.
*Verify:* `themeContrast.test.ts`, `typeRamp.test.ts`, lint, render-probe all six surfaces.
*Risk:* low-medium (volume of edits; keep each file's hue within the allowlist).

**Phase 2 — App shell: rail + right-panel system (highest risk)**
Build `NavRail`/`NavPanel` (reusing `SidebarContent`), retire the hamburger drawer, wire `Ctrl/Cmd+B`, account row with update status; right-panel contract (push/fullscreen, resize, persistence, hide-vs-close for `TradeChatPanel`); mobile behavior below `lg` unchanged.
*Verify:* render-probe (nav-surface counts, approvals inbox), `useSurface`/`useSurfaceRouter` tests, manual pass at 800px/1024px/1440px, `boot-probe`.
*Risk:* high — App.tsx is 3,500+ lines and render-probe asserts surface counts; update probe expectations first, in the same phase.

**Phase 3 — Debate/messenger unification (medium)**
New `TypingIndicator` (4 call sites, live-region fix, settle-to-duration); per-model expansion standardization; clarification rung disclosure; R:R on `TradeProposalCard` + `VerdictCard`; unify Entry/Stop/TP labels across the 6 inconsistent renderers.
*Verify:* debateFlow tests, render-probe (chat rows), manual debate run.
*Risk:* medium — streaming rows re-render often; watch for layout shift on stream chunks (doctrine).

**Phase 4 — Settings, update flow, chart, polish (low)**
Settings Developer→nav + version/update row + focus-return; UpdateButton installing state + up-to-date toast + error details; chart `role`/`aria-label` + text summary (top levels); **C9 chart visual retune** (candle/wick/border from the two trade hues, borderless bodies, dashed crosshair, direction-colored last-price chip, recessive axis/grid, watermark, role-based indicator colors — options + overlay-canvas changes only); Trade mobile tablist arrow keys; GroupChatView live region (if not folded into Phase 3).
*Verify:* full suite, `installer-smoke` (update flow touches the updater), manual update-state pass with `ELECTRON_DISABLE_SECURITY_WARNINGS` dev harness.
*Risk:* low; updater changes are renderer-only (main.cjs untouched).

**Deferred / couldn't verify (report at end of Stage 2):** per-agent win rates (needs data work); light theme activation (D1); settings value-search; release-notes rendering fidelity vs. GitHub markdown; rollback (not supported by electron-updater — documented, not built); exact reference-app spacing/radii values marked **[not verified]** in Part A.

### C9. Chart visual language & fast-market readability

**Visual language** — structure from A5 (Vela + lightweight-charts conventions), hues remapped to our tokens:

- **Candles: one hue per direction.** Body, wick (and border, when shown) all derive from `--trade-up`/`--trade-down` (`#07b56a`/`#f75d5f`); bodies render **borderless** (Vela/TV structure). Reference palettes differ only in hue value (theirs deeper/teal-leaning) — never mix reference hues into the chart.
- **Chrome recessive:** chart surface sits on the `zinc-900` panel; grid one step above the background (~`#1f1f1c`+8% class); axis text 11px recessive gray; chrome text one step brighter — mirrors our ink ramp, no new colors.
- **Crosshair:** 1px dashed, 0.4 opacity, neutral gray, snapped to bar center; axis chips on a `#595959`-class plate with auto-contrast ink.
- **Last-price line:** dotted, direction-colored, axis chip filled with the direction color — formalizes the existing 'mark'-line work.
- **Volume:** bottom-anchored behind candles, own scale, direction-colored, candle-body width (`chartData.ts` VOLUME colors already match; keep).
- **Watermark** "SYMBOL · TF" at 5% opacity, ≤36px, price pane only.
- **Indicator colors are role-based, not per-indicator:** derived/statistical overlays = `--info` cyan (absorbs Vela's INFO role; if the Trade view already spends its one cyan accent elsewhere, that one stops being cyan — doctrine rule); second line (signal/%D-class) = `--warn` amber; slope/direction coloring = the two trade hues; fixed levels = neutral gray dashed 1px; bands/fills ~40–50% alpha; 2px lines; per-bar direction-colored histograms. Any categorical auto-color list **drops bull/bear hues** — emerald/rose already mean direction here.
- **Legend chips:** translucent background wash at rest, solid on hover, live values in the plot's color, placed inside their pane, collapsible.
- **AI/model ink stays separate from direction hues:** marks lane + translucent time-range highlights (`rgba(120,130,160,0.10)`-class) + translucent highlighter — the same separation the key-levels cards already practice.
- **Scope note:** applied via lightweight-charts options and the existing overlay canvas — no renderer swap. Vela's WebGL2/Pine-Script machinery is explicitly **not** adopted; the chart stays lightweight-charts (deliberate, per repo history).

**Fast-market readability** (the trading-data presentation rules the brief asked for):

- **Fixed-decimal contract per metric** — prices via `fmtPrice`, percents via `fmtPercent(digits declared per call site)`, R:R as `2.4:1` — so digits change but glyph width never does; `font-mono tabular-nums`, numeric columns right-aligned, labels left, units live in the label not the cell. No layout jitter while ticks stream.
- **Value text never animates:** numbers snap; only color/state transitions animate (0.12s). Tick flash uses the existing tick-flash keyframe in the two trade hues — never a new hue for a new state.
- **Live-region announcements throttle** (≤1 per 5s per metric) while visual updates stay unthrottled.
- **Hit targets ≥24px** on dense pills/rows even when text is 10–11px.
- **Stale data is marked, never silent** — the harness-marks / POSSIBLY-STALE doctrine extends to every chart-side number.
- **Chart a11y (from B9):** canvas gets `role="img"` + an aria-label (symbol · interval · last · trend) plus a visually-hidden data summary; `KeyLevelsCard` remains the full text alternative.

---

## Decision points for approval

- **D1 — Light theme:** dormant tokens (recommended, honors the 2026-09-10 dark-only decision) vs. activate now.
- **D2 — Persistent sidebar rail** (recommended; all four references do it) vs. keep hamburger drawer.
- **D3 — Delete dead DebateStage** (recommended) vs. resurrect it as the messenger view.
- **D4 — R:R on TradeProposalCard/VerdictCard** (small presentation addition threading an already-computed value) — in or out?
- **D5 — Update overlay:** keep full-screen during download/ready (current) vs. demote to the account-row/toast pattern (DSH).
- **D6 — C9 chart visual retune** (recommended: Vela/lightweight-charts structure on our hues — borderless candles, dashed crosshair, direction-colored price chip, role-based indicator colors) vs. keep the current chart look unchanged.

**Approve the spec (with any D1–D6 rulings) and I start Stage 2, Phase 0.**
