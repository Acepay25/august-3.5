# E-51 — The composer's model menu: one control for provider, model and effort

**Status:** LANDED — **all four rulings ANSWERED (owner, 2026-10-20)** and
**all four phases committed 2026-10-21** (`implementation-record.md` §10–§13):
the panel (§10), both composers mounting it in the card (§11), `ModelPicker`
mounting the same panel (§12), and the chord with its hint (§13). The §0 scan
below describes the tree BEFORE this work and is kept as written, because it is
the measurement the plan was built on: `EffortChip.tsx` is deleted, `ModelChip`
and `ModelPicker` both mount the one `ModelMenu`, and both composers carry a
single control in the card. See §3 for what each answer commits, §11 of the
record for the one criterion this pass could NOT measure (the unwrapped dock
row), and §13 for what no gate presses.
**Owner:** the trader. **Covers:** **O-68** (the pickers are unusable without sight) and
the doctrine's *one home per concern* rule.
**Adjacent to, and deliberately not fixing:** **O-56 / E-39** — the *default* tier for a
trade decision is `low`. This proposal does not change that default; it makes the tier
**visible and settable in the same panel as the model**, which is the half of E-39 a UI
can honestly do. The other half is the schedule in
`services/providers/reasoningControls.ts:57`, and that is a separate ruling.
**Reference:** the DeepSeek Harness model picker (three screenshots, 2026-10-20 21:02).
**Depends on:** nothing. **Blocks:** nothing.
**Written:** 2026-10-20 · working tree at `8cae97c7` plus a concurrent thread's
in-flight edits.

> Every `file:line` below was read at the tip named. Where a claim is a claim about
> a *file* rather than a behaviour, the line is the one that proves it.
>
> **The tree is moving.** Other threads are landing work in `App.tsx`,
> `components/agents/AgentsView.tsx` and `components/automation/AutomationEditorModal.tsx`
> right now, and the line numbers below shifted **once while this document was being
> written** — the first pass verified 77 citations clean, and a second pass a few
> minutes later found 13 of them already stale. So: **the symbol is the durable
> anchor; the line is a snapshot.** Every claim in §7 names a symbol as well as a
> line, and Phase 4 re-measures `docs/app-flow.md` against the tree as it stands then.
> This is the same discipline the open-items register uses — a `file:line` is a
> *measurement*, not a transcription.

---

## 0. The scan — what August has today

**Three controls, two menu designs, nine render sites, and one of the three is
untested.**

| # | Control | File | What it is | Menu design | Keyboard |
|---|---|---|---|---|---|
| 1 | `ModelChip` | `components/shared/ModelChip.tsx` | the **composer's** model control — provider + model in ONE flat, grouped list | inline `absolute` panel, `w-64`, `bottom-8 right-0` (`:90`), an invisible `fixed inset-0` backdrop (`:88`) | Escape only, and it is *contained* so it does not cancel a running analysis (`:94-100`) |
| 2 | `ModelPicker` | `components/shared/ModelPicker.tsx` | the **Settings / automation / seat** picker | portaled `fixed z-flyout` two-column flyout (`:412`, `:619`) — provider column + model column | document-level Escape only (`:270-284`) |
| 3 | `EffortChip` | `components/shared/EffortChip.tsx` | the composer's thinking tier | inline radio menu, 6 tiers (`:21`, `:62`) | Escape only (`:64-69`) |

**Where each renders**

| Site | File:line | Control |
|---|---|---|
| Chart AI dock composer (footer, under the card) | `components/trade/panels/ChatComposer.tsx:229` | `ModelChip` |
| Chart AI dock composer (footer, under the card) | `components/trade/panels/ChatComposer.tsx:232` | `EffortChip` |
| Chat surface composer (the Agents surface) | `App.tsx:2581` → `components/agents/AgentsView.tsx:1544` | `ModelChip` (injected as a prop) |
| Chat surface composer | `App.tsx:2593` → `components/agents/AgentsView.tsx:1545` | `EffortChip` (as `SessionEffortChip`) |
| Settings → AI setup → **Vision Model** | `components/settings/tabs/ModelsTab.tsx:80` | `ModelPicker`, `mode="model-only"` |
| Settings → AI setup → **Memory Model** | `components/settings/tabs/ModelsTab.tsx:96` | `ModelPicker`, `mode="provider-model"` |
| Automation editor → Model | `components/automation/AutomationEditorModal.tsx:508` | `ModelPicker`, `mode="provider-model"` |
| Panel seat picker ("+ add model") | `components/trade/TradeChatPanel.tsx:1028` | `ModelPicker`, `mode="provider-model"`, `compact` |
| New-bot dialog → Provider + Model | `components/chat/NewBotDialog.tsx:356`, `:367` | **`SelectMenu`** — a third control, not either of the two above |

`ModelPickerMode` declares a `'provider-only'` mode (`components/shared/ModelPicker.tsx:73`)
that **no component renders** — dead vocabulary.

**The state, and who owns it**

- **Model pick** — `providerId::modelId`. Owned by `App.tsx:669`
  (`selectedChatModel`), persisted to `PREF_KEYS.CASUAL_CHAT_MODEL` = `casual_chat_model`
  (`services/infrastructure/PreferencesService.ts:27`) *and* mirrored into
  `localStorage` (`App.tsx:685-694`). A legacy bare id is migrated to the qualified
  form at `App.tsx:702-712`.
- **Session binding** — `changeSoloModel` (`components/trade/TradeChatPanel.tsx:632`)
  writes the app-wide value *and* `chatStore.setActiveSoloModel` onto the active
  session row. The Chat surface **re-implements the same two writes inline**
  (`App.tsx:2582`) instead of calling it — the same pair of writes, two code paths.
- **Effort tier** — a field on the chat session row (`sess.effort`), read by
  `SessionEffortChip` through `useSyncExternalStore` (`App.tsx:202-204`). The ladder
  is `ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max' | 'auto'`
  (`services/providers/reasoningControls.ts:54`); the wire value comes from
  `resolveComposerEffort` (`:124`).
- **Staleness** — `computeChatModelFallback` (`utils/providerUtils.ts:119`) produces the
  reason; `ModelFallbackBanner` (`components/trade/panels/ChatComposer.tsx:94-106`)
  says it above the composer.

**Two features that exist today and are NOT in the reference**

| Feature | Where | Note |
|---|---|---|
| **Star a model** | `components/shared/ModelChip.tsx:21` (`august_starred_models_v1`), toggle at `:128-135`, starred models sort first at `:62` | a real preference, raw localStorage, device-local |
| **"Free models only"** | `utils/providerUtils.ts:310` (`august_model_picker_free_only_v1`), read/written by `ModelPicker` only (`:121`, `:372`) | device-local; deliberately not backed up (`tests/exportRawLocalStorage.test.ts:92`) |

**Two facts that make this proposal necessary, not cosmetic**

1. **`ModelChip`'s contract is pinned by no unit test.** No file under `tests/` renders
   it. Its testids are driven only by two **npm-scripted** Playwright screenshot
   harnesses — `npm run probe:chip` (`scripts/chip-shot.cjs:58-79`) and
   `npm run probe:surfaces` (`scripts/surface-shots.cjs:248`). So the provider grouping,
   the star toggle and its persistence, the ">7 models ⇒ show the search box" threshold
   (`:102`), the `free` badge, the refresh row and the Escape containment are all
   **unpinned by the unit suite** — and the two harnesses that do drive them are
   screenshot scripts, which assert pixels, not behaviour.
2. **The two menus disagree about what a model menu is.** `ModelChip` groups by
   provider with stars and no free-filter; `ModelPicker` is a two-column flyout with a
   free-filter and no stars. They read the same `providers` array and share
   `isProviderReady` (`utils/providerUtils.ts:18`) — and the shared free-only
   preference does **not** follow the trader between them, because only `ModelPicker`
   reads it. `utils/providerUtils.ts:306-307` still describes a "team roster menu"
   that no longer exists.

---

## 1. The reference, and the gap

**What the three screenshots show** (DSH composer, dark theme, model popover open):

1. The trigger is a **"Select model"** button in the composer's bottom row, immediately
   left of a round **up-arrow send** button. The popover is anchored **above** it and
   aligned to its right edge.
2. The popover's **first row is the provider**, not a model: a cube glyph, the provider
   name, an **`API` badge**, and a **`›` chevron** at the right. The chevron opens a
   **second panel to the right** — the provider list.
3. A **`Models`** section, then the models of the *current* provider, one per row, with
   optional capability badges (**`Vision`**) and a **check** on the selected one.
4. An **`Effort`** section: the label on the left, the current value next to it
   (`Max` / `On`), a **`Ctrl+T`** key hint on the right, and a **gradient slider**
   underneath.
5. The provider panel lists every provider with an `API` badge, a **check on the active
   one**, a **`New provider`** row, and a **`Manage models`** footer.

**The gap, item by item**

| # | Gap | Evidence in August |
|---|---|---|
| G-1 | **Provider and model compete in one list.** August puts every model of every provider in a single scrolling list, grouped by a sticky header. The reference makes the provider a *header with a submenu*, so the model list only ever holds one provider's models. | `components/shared/ModelChip.tsx:123-151` |
| G-2 | **No capability badges.** Nothing tells the trader that a model takes images. | `utils/modelUtils.ts:8` (`isVisionModel`) exists and is unused by any menu |
| G-3 | **The thinking tier is a separate control with its own menu.** The reference sets model *and* effort in one gesture, in one panel. | `components/shared/EffortChip.tsx`; `ChatComposer.tsx:232`; `App.tsx:2593` |
| G-4 | **The two menus are different designs** (inline vs portaled; grouped+stars vs two-column+free-toggle) and they read different preferences. | `ModelChip.tsx:90` vs `ModelPicker.tsx:412`; `utils/providerUtils.ts:310` |
| G-5 | **No keyboard model beyond Escape** — no arrow keys, no Enter-to-pick, no roving focus. O-68 names `ModelPicker` as one of four pickers "unusable without sight". | `docs/plan/open-items.md:158` |
| G-6 | **The composer cannot reach provider management.** Adding or fixing a provider means leaving the composer. | the reference's `New provider` / `Manage models` rows |
| G-7 | **A dead import and a dead mode.** | `App.tsx:82` imports `ModelPicker` and never renders it; `ModelPicker.tsx:73`'s `provider-only` has no render site |
| G-8 | **The trigger is not in the composer.** August's model and effort chips sit on a row *under* the card, so the card's own bottom row has no model control at all; the reference puts it immediately left of the send button. | `components/trade/panels/ChatComposer.tsx:227-233` (the footer row under the card); `components/agents/AgentsView.tsx:1536-1547` (the same row on the Chat surface) |

---

## 2. The target

**One component, one value, one place to read it.**

```
┌ ModelMenu (portaled, 320px, opens upward) ────┐  ┌ Provider panel (220px) ─────────┐
│ [◧] Ollama              API  ›                 │  │ Opencode GO         API         │
├───────────────────────────────────────────────┤  │ Opencode ZEN        API         │
│ MODELS                    [free only] [↻]     │  │ KiloCode            API      ✓  │
│  minimax-m3.1-flash:cloud  Vision        ★  ✓ │  │ Qwen                API         │
│  tencent/hy3:free                 free      ★  │  │ New provider                     │
├───────────────────────────────────────────────┤  ├──────────────────────────────────┤
│ EFFORT                          High  [Ctrl+T]│  │ Manage providers                 │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░ │  └──────────────────────────────────┘
└───────────────────────────────────────────────┘
```

**DSH → August, element by element**

| Reference element | August implementation | Source of truth |
|---|---|---|
| Cube glyph | `Box` from `components/shared/Icons.tsx:120`; `Server` when the base URL is local | `isLocalBaseUrl` (`shared/providerRequestPolicy.cjs`) |
| `API` badge | a **constant `API` badge**, exactly as the reference shows it (ruling **D-C**). Every August provider *is* an HTTP API of some kind — a local Ollama server is an HTTP API on `localhost` — so the badge is true here, and it is the reference's own vocabulary. The apiFormat is not lost: it rides the provider row's `title` (invisible chrome, not a second badge). | `types/provider.ts:13`, `:80` |
| `›` on the provider row | opens the provider panel (click **and** hover) | — |
| `MODELS` section | the **active** provider's models only, ready providers only | `isProviderReady` (`utils/providerUtils.ts:18`) |
| `Vision` badge | `StatusPill tone="info" kicker` when `isVisionModel(modelId)` | `utils/modelUtils.ts:8` |
| — (August-only) `free` badge | kept | `utils/providerUtils.ts:249` |
| — (August-only) ★ | kept, on the right of the row | `ModelChip.tsx:21` |
| check on the selected model | `CheckIcon`, emerald-400 (the app's existing "this is the current one" colour) | — |
| `EFFORT` + value | the **existing** ladder `off → auto → low → medium → high → max`, six stops | `components/shared/EffortChip.tsx:21` (moves) |
| `Ctrl+T` hint | **a decision — see D-B** | `components/ui/Tip.tsx:6` carries a `shortcut` |
| gradient slider | **emerald → cyan only.** The reference's green→cyan→blue is *forbidden here*: `tests/themeContrast.test.ts:98` bans `blue-`, `sky-`, `teal-`, `green-`, `orange-`, `lime-`, `pink-`, `purple-`, `violet-`, `indigo-`, `fuchsia-` in `from-`/`via-`/`to-` stops across `components/`. | `index.css` `@theme` |
| `New provider` / `Manage models` | **one** row, `Manage providers` → Settings → AI setup. Two rows would be the same destination twice — an affordance that lies. | `components/settings/tabs/ModelsTab.tsx` |
| — (August-only) `Free models only` | kept, in the `MODELS` header row, reading the **shared** pref so it follows the trader between every model menu | `utils/providerUtils.ts:310` |
| — (August-only) `Refresh model list` | kept, as a small icon button in the `MODELS` header row | `ModelChip.tsx:155-161` |

**The effort ladder on a slider.** Six stops, snapped, never continuous — a slider
implies a continuum and `ReasoningEffort` is a six-value union. The printed value is
the tier's own label (`Off` / `Auto` / `Low` / `Medium` / `High` / `Max`), and the
control must expose that **label**, not an index, to assistive technology
(`aria-valuetext`). The slider writes the **same stored value** the chip writes today
(`sess.effort` on the active chat session), so the label and the request can never
disagree.

**The bot-turn rule.** Today the effort chip is hidden for a bot turn
(`components/agents/AgentsView.tsx:1545` — `{!activeBot && effortPicker}`), because a
bot turn answers on the bot's own config through a transport that never reads the
dial. In the merged panel this becomes "**the Effort section is absent for a bot
turn**", not "a chip is missing" — the rule moves with the control.

**Where the trigger sits (D-A — owner ruling: *like the reference*).** The merged
control moves **into the composer's card, on the bottom row, immediately left of the
send button** — the reference's exact position. It leaves the footer row under the card
altogether, and that footer row disappears with it (it held nothing else but the two
chips). Two surfaces, one control, two widths:

| Surface | The row | The button |
|---|---|---|
| **Chat surface** (`components/agents/AgentsView.tsx:1458-1551`, an 880px `.chat-column`) | the toolbar row that already holds the send button (`:1505-1514`) | a **wide** button in the reference's shape — `Select model` when nothing is picked, the provider + model when something is — sitting immediately left of the round up-arrow send |
| **Chart AI dock** (`components/trade/panels/ChatComposer.tsx:137-221`, **384px**) | the same toolbar row, which is `flex-wrap` (`:151`) | the **same component, compact**: the label truncates to fit. The reference's 260px button cannot fit beside `+`, `Scan → skills` and `Full analysis` at 384px, so the label is what gives |

**What the dock's wrap means.** The dock's toolbar row already wraps *between* chips on
purpose — "a label stays whole, and nothing overflows" (`ChatComposer.tsx:151-157`). A
fourth control therefore lands on its own line, still right-aligned against the send
button, and the send button stays the **bottom-right** element in both states. This is
the one claim in the plan that jsdom cannot see and no unit test can make, so
`npm run render-probe` gains an explicit assertion for it (§4, Phase 2).

**The trigger's label (D-D — owner ruling: *show it*).** The merged trigger reads
**`Provider · Model · High`** — the tier last, muted, always visible. One value, one
writer, and the tier is never hidden behind a click. The wide Chat-surface button and
the compact dock button are the same label at two widths.

**Placement of the panel.** The panel is **portaled to `document.body`** and positioned
`fixed`, the way `ModelPicker` (`:412`) and `SelectMenu` (`components/shared/SelectMenu.tsx:244`)
already are, and clamped with the shared margin
(`components/shared/flyoutLayout.ts:21`). The trigger now sits at the bottom of the
composer's card, so the panel opens **upward**; the provider panel opens to the **right**
of the main panel, and the pair is flipped to the left when the main panel would
overflow the viewport.

**A11y (this is the O-68 half of the proposal).**

- Trigger: `aria-haspopup="menu"`, `aria-expanded`, an accessible name that reads the
  provider, the model **and** the tier.
- Main panel: `role="menu"`; model rows are `role="menuitemradio"` with
  `aria-checked`; the provider row is a `role="menuitem"` with `aria-haspopup="menu"`
  and `aria-expanded`.
- Provider panel: `role="menu"`, provider rows `role="menuitemradio"`.
- **Arrow keys** move the active row; **Enter/Space** pick; **Home/End** jump;
  **Right** opens the provider panel, **Left** closes it; **Escape** closes the
  innermost panel and is *contained* (it must not reach the app-level handler that
  cancels a running analysis — `App.tsx:1212-1237`).
- **Focus enters the panel on open and returns to the trigger on close.** The repo
  already has the focus-restore idiom (`hooks/useFocusTrap.ts:81`) and the
  focus-indicator rules (`docs/ui-doctrine.md:54`).
- The **effort slider** is a real `role="slider"` with `aria-valuemin` / `aria-valuemax`
  / `aria-valuenow` / `aria-valuetext` = the tier label, and it takes ←/→.

**What this deliberately does NOT copy.** The reference's `Ctrl+T` cannot be bound
verbatim in a web build (a browser owns Ctrl+T and will not surrender it) — see D-B.
The reference's green→cyan→blue slider gradient is banned by the hue lockout. The
reference's `New provider` and `Manage models` are two names for one destination, and
August has one.

---

## 3. The four rulings — ANSWERED (owner, 2026-10-20)

Each had a proposed default, so silence was never a blocker. All four are now
answered, and each answer is written into §2 above.

| # | Question | **The ruling** | What it commits |
|---|---|---|---|
| **D-A** | Where does the merged trigger sit? | **Move it into the composer card, like the reference** — the bottom row, immediately left of the send button. | Phase 2 gains a **layout move** in both composers; the footer row under the card disappears; the dock's button is the compact form of the same control. `render-probe` gains an assertion for the dock's wrap. |
| **D-B** | The `Ctrl+T` key hint. | **Drop it now, add `Ctrl/Cmd+Shift+E` later.** | Phase 2 ships the Effort section with no hint; Phase 4 binds the chord and shows the hint **in the same commit**, so the hint is never a lie. `Ctrl+T` is not bound at all — Chrome owns it. |
| **D-C** | What does the provider's `API` badge say? | **A constant `API` badge, like the reference.** | The badge is the reference's own vocabulary. Every August provider is an HTTP API of some kind — a local Ollama server is an HTTP API on `localhost` — so it is true. The apiFormat rides the row's `title` instead of a second badge. |
| **D-D** | Is the thinking tier visible without opening the panel? | **Yes — show it on the trigger too.** | The trigger reads `Provider · Model · High`; the panel's Effort section is the editor. One value, one writer, always readable. The Effort section still disappears for a bot turn. |

---

## 4. The phases

Four commits. One item each, per the plan's rules (`docs/plan/README.md` §3).

### Phase 1 — `ModelMenu`: the panel, extracted, with nothing wired to it

**Write scope:** `components/shared/ModelMenu.tsx` (new),
`components/shared/effortScale.ts` (new), `tests/modelMenu.test.tsx` (new).

- The panel, the provider panel, the effort slider, the keyboard model, the aria.
- `EFFORT_CHOICES` / `effortChoiceOf` **move out of** `components/shared/EffortChip.tsx`
  into the shared place and are re-exported from there, so the ladder has one owner
  (the repo's "canonical single-source modules" rule, `AGENTS.md`).
- The new test pins: the provider header, the models of the active provider only, the
  `Vision` and `free` badges, the check, the star toggle and its persistence, the
  free-only toggle, the provider panel opening, the six slider stops and their
  `aria-valuetext`, Escape containment, arrow-key navigation, focus return, and
  "no Effort section for a bot turn".
- **No surface changes.** The panel is not mounted anywhere yet.

**Gates:** `typecheck` · `lint` · `test` · `build`.
**Does not close:** anything yet. **Opens:** the census (a new test file).

### Phase 2 — the composers mount the panel, and the trigger moves into the card

**Write scope:** `components/shared/ModelChip.tsx`, `components/shared/EffortChip.tsx`
(deleted), `components/trade/panels/ChatComposer.tsx`, `App.tsx`,
`components/agents/AgentsView.tsx`, `tests/chatEffortDial.test.tsx` (rewritten),
`tests/agentsSurface.test.tsx`, `scripts/render-probe.cjs`,
`scripts/chip-shot.cjs`, `scripts/surface-shots.cjs`.

- `ModelChip` becomes the **trigger and the anchor**; the menu body is `ModelMenu`.
- `EffortChip` is **deleted**; the tier is set in the panel. The `effortPicker` prop
  and `SessionEffortChip` go with it.
- **D-A — the layout move.** The merged control leaves the footer row under the card
  and lands **in the card's bottom row, immediately left of the send button**, in both
  composers. The footer row that held the two chips
  (`components/trade/panels/ChatComposer.tsx:227-233`) is **deleted**, and the
  disclaimer line (`:234-236`) moves up into its place. On the Chat surface the
  equivalent footer row (`components/agents/AgentsView.tsx:1536-1547`) keeps only the
  context note, left-aligned, and the disclaimer line (`:1538-1540`) follows it.
  The dock's button is the **compact** form of the same control; the Chat surface's is
  the **wide** reference-shaped one (§2, "Where the trigger sits").
- **D-D — the trigger label** carries the tier: `Provider · Model · High`, the tier
  muted and last.
- Both composers mount **one** control. The Chat surface's inline
  `setSelectedChatModel` + `chatStore.setActiveSoloModel` pair (`App.tsx:2582`) is
  replaced by the same `changeSoloModel` the dock uses — one pair of writes, one code path.
- `App.tsx:82`'s dead `ModelPicker` import is removed (**G-7**).
- The bot-turn rule moves from "hide a chip" to "no Effort section" (§2).

**`scripts/render-probe.cjs` gains one assertion** (this is the part jsdom cannot see
and no unit test can make): in the **dock's** composer, after the trigger moves in —
(a) the toolbar row does not overflow its container horizontally, and (b) the send
button is still the **right-most** element of the card, in both the wrapped and the
unwrapped state. The probe already measures the four nav surfaces and the focus
indicator (`docs/ui-doctrine.md:130`); this adds the one claim the move makes.

**Gates:** `typecheck` · `lint` · `test` · `build` · **`render-probe`** ·
**`probe:chip`** · **`probe:surfaces`** · **`check-flow-doc-anchors`**.
**`render-probe` is mandatory** — the composer changed and the probe is the only gate
that can see a rendered panel or a focus indicator (`AGENTS.md`; `docs/ui-doctrine.md:130`).
**`probe:chip` and `probe:surfaces` are mandatory** — they drive the chip's testids
(`scripts/chip-shot.cjs:58-79`, `scripts/surface-shots.cjs:248`), so they are the two
gates that would go red if the trigger's contract moved.
**`check-flow-doc-anchors` is mandatory** — `docs/app-flow.md:69` and `:415` cite
`components/trade/panels/ChatComposer.tsx:146`, `:201` and `:218` **by line number**,
and all three move.

### Phase 3 — one implementation: `ModelPicker` mounts the same panel

**Write scope:** `components/shared/ModelPicker.tsx`,
`components/settings/tabs/ModelsTab.tsx`, `components/trade/TradeChatPanel.tsx`,
`components/automation/AutomationEditorModal.tsx`, `tests/modelPicker.test.tsx`,
`tests/dockChatParity.test.tsx`.

- The Settings / automation / seat flyout loses its own two-column body and mounts
  `ModelMenu`. The `mode` prop collapses to one meaning: **`provider-model`** — with
  `model-only` becoming "the panel opens with the owning provider preselected", and
  the dead `provider-only` mode deleted (**G-7**).
- `ModelChip` and `ModelPicker` stop being two implementations of one thing (**G-4**).
  The shared free-only preference then genuinely follows the trader everywhere
  (**G-4**).

**Gates:** `typecheck` · `lint` · `test` · `build` · **`render-probe`**.
**Risk:** the highest of the four. `ModelPicker` is used in three places with three
different triggers, one of them inside a modal (`AutomationEditorModal`) whose
overlay can out-rank a portaled flyout — `components/shared/SelectMenu.tsx:246-248`
documents exactly that (`z-flyout`, not `z-confirm`).

### Phase 4 — the shortcut, the docs, the census

**Write scope:** `App.tsx` (the `Ctrl/Cmd+Shift+E` binding), `docs/app-flow.md`,
`AGENTS.md`, `docs/plan/open-items.md`, `docs/plan/README.md`,
`docs/plan/implementation-record.md`.

- The **D-B** shortcut, with the key hint rendered next to the `EFFORT` label — and
  the hint in the accessible name too (`docs/ui-doctrine.md:48`).
- `docs/app-flow.md`'s ChatComposer anchors re-measured.
- `AGENTS.md`'s vitest census re-stated (**4992 tests in 494 files** today) — the
  anchor gate re-measures `git ls-files tests` and fails on a stale figure
  (`scripts/check-flow-doc-anchors.cjs:716-728`).
- `docs/plan/open-items.md`: **O-130** added, pointing at this proposal.
- `docs/plan/implementation-record.md`: the landing record, with the gate that
  verified each phase.

**Gates:** `typecheck` · `lint` · `test` · `build` · **`check-flow-doc-anchors`** ·
**`render-probe`**.

---

## 5. The gates that bind this work

| Gate | Why it binds |
|---|---|
| `npm run lint` | the cap is **659** (`package.json:27`); a new warning fails it |
| `npm run test` | the new test file, and the rewritten `chatEffortDial` |
| `npm run build` | `tsc --noEmit` + the bundle |
| `npm run render-probe` | the only gate that can see a rendered panel, a clipped row, or a focus indicator |
| `npm run probe:chip` · `npm run probe:surfaces` | the two gates that drive the chip's testids (`scripts/chip-shot.cjs:58-79`, `scripts/surface-shots.cjs:248`) — they go red if the trigger's contract moves |
| `npm run check-flow-doc-anchors` | `docs/app-flow.md` cites `ChatComposer.tsx` by line; `AGENTS.md`'s census is re-measured |
| `tests/themeContrast.test.ts:98` | the hue lockout — the slider gradient must stay inside emerald/cyan |
| `tests/radiusRamp.test.ts:54` | only `rounded-control` / `rounded-bubble` / `rounded-full` are legal — a bare `rounded` on the key hint fails |
| `tests/typeRamp.test.ts` | sizes come from `text-ui-*`; no `text-[Npx]` |
| `docs/ui-doctrine.md` | the binding design rules: one home per concern, semantic hues only, `--ease-snappy` at 0.12–0.18s, no `transition-all`, no new `@keyframes` |

---

## 6. The risk register

| risk | why it is real | the mitigation |
|---|---|---|
| **The narrow dock (384px), and the trigger now lives inside it.** | D-A moved the control into the card's bottom row, which already holds `+`, `Scan → skills`, `Full analysis` and the send button. The row is `flex-wrap` by design (`components/trade/panels/ChatComposer.tsx:151-157`) because it once overflowed by 6px. A fourth control is exactly the pressure that caused it. | The dock's button is the **compact** form of the same control, and the label truncates. `render-probe` gains an explicit assertion: no horizontal overflow, and the send button still right-most, wrapped and unwrapped. |
| **The panel is portaled, so it can out-rank a modal.** | `AutomationEditorModal` and Settings both render overlays; a `fixed z-flyout` panel can paint over or under them. | `z-flyout`, per `components/shared/SelectMenu.tsx:246-248`; Phase 3 verifies the automation editor specifically. |
| **The panel is wider than the dock.** | the panel is 320px and the provider panel 220px — together 540px, against a 384px dock. | portaled to `document.body`, so it is not clipped by the dock; it is clamped to the viewport and the provider panel flips to the left when it would overflow. |
| **A constant `API` badge on a local server.** | D-C chose the reference's constant badge. An Ollama server is an HTTP API on `localhost`, so the badge is not false — but a trader who reads it as "cloud" would be wrong. | the apiFormat rides the provider row's `title`, so the information is reachable without a second visible badge. |
| **Losing the visible tier.** | the reference hides it; a hidden tier is a tier left on `low` (E-39). | **D-D — the trigger carries a muted tier label.** |
| **A second implementation appears.** | the repo's own history: two chips that look similar and do different things is the shape of defect it keeps being asked to remove (`components/shared/ModelChip.tsx:5-10`). | Phases 1–3 end with **one** `ModelMenu`, and Phase 3 deletes the duplicate rather than adding a third. |
| **The census goes stale.** | a new test file changes `git ls-files tests`; the gate fails on a stale figure. | Phase 4 restates the census in the same commit. |
| **The screenshot harnesses rot.** | `scripts/chip-shot.cjs` and `scripts/surface-shots.cjs` drive the chip's testids and are wired to `npm run probe:chip` and `npm run probe:surfaces`. | Phase 2 updates their selectors in the same commit, and both scripts are listed as Phase 2's gates. |

---

## 7. The evidence table

| claim | evidence |
|---|---|
| the composer's model control is an inline absolute panel | `components/shared/ModelChip.tsx:90` |
| the search box appears only above 7 models | `components/shared/ModelChip.tsx:102` |
| the starred-model preference is raw localStorage | `components/shared/ModelChip.tsx:21` |
| Escape is contained so it cannot cancel a run | `components/shared/ModelChip.tsx:94-100` |
| the Settings picker portals to `document.body` | `components/shared/ModelPicker.tsx:412`, `:619` |
| the `provider-only` mode has no render site | `components/shared/ModelPicker.tsx:73` |
| the free-only preference is read only by `ModelPicker` | `components/shared/ModelPicker.tsx:121`, `:372`; `utils/providerUtils.ts:310` |
| the effort ladder is six values | `components/shared/EffortChip.tsx:21`; `services/providers/reasoningControls.ts:54` |
| the dock mounts the model chip and the effort chip | `components/trade/panels/ChatComposer.tsx:229`, `:232` |
| the chips sit on a footer row **under** the card | `components/trade/panels/ChatComposer.tsx:227-233`; the disclaimer line below it at `:234-236` |
| the Chat surface's equivalent footer row | `components/agents/AgentsView.tsx:1536-1547`; the disclaimer line at `:1538-1540` |
| the send button lives in the card's bottom toolbar row | `components/trade/panels/ChatComposer.tsx:201-220`; `components/agents/AgentsView.tsx:1515-1524` |
| the Chat surface's composer card | `components/agents/AgentsView.tsx:1458-1551` |
| the Chat surface mounts both, injected as props | `App.tsx:2581`, `:2586`; `components/agents/AgentsView.tsx:1544`, `:1535` |
| a bot turn hides the effort control | `components/agents/AgentsView.tsx:1545` |
| the Chat surface writes the model pick twice, inline | `App.tsx:2582` |
| `App.tsx` imports `ModelPicker` and never renders it | `App.tsx:82` |
| the model pick is `providerId::modelId`, persisted | `App.tsx:669`, `:678-687`; `services/infrastructure/PreferencesService.ts:27` |
| the pick is migrated to the qualified form | `App.tsx:702-712` |
| the staleness sentence is computed in one place | `utils/providerUtils.ts:119`; `components/trade/panels/ChatComposer.tsx:94-106` |
| vision capability is a heuristic that exists | `utils/modelUtils.ts:8` |
| the apiFormat is a four-value union | `types/provider.ts:13`, `:80` |
| the pickers are unusable without sight (O-68) | `docs/plan/open-items.md:158` |
| the hue lockout forbids the reference's blue | `tests/themeContrast.test.ts:98` |
| only three radii are legal | `tests/radiusRamp.test.ts:54`; `docs/ui-doctrine.md:35-36` |
| the reference footer cites ChatComposer by line | `docs/app-flow.md:69`, `:415` |
| the chip's testids are driven by two npm-scripted harnesses | `scripts/chip-shot.cjs:58-79` (`npm run probe:chip`); `scripts/surface-shots.cjs:248` (`npm run probe:surfaces`); `package.json:24`, `:26` |
| the lint cap is 659 | `package.json:27` |
| the census is 4992 tests in 494 files, and the gate re-measures it | `AGENTS.md:185`; `scripts/check-flow-doc-anchors.cjs:716-728` |
