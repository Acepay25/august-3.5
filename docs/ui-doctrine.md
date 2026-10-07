# UI doctrine

The rules this app's interface actually obeys, written as a checklist you can
apply to a diff. Derived from the theme decisions in `AGENTS.md` and the code
that survived — every item below is enforced by an existing token or component,
not by taste.

When a change violates two rules, the theme wins over the component.

## Color

- [ ] Page is `#0b0b0a`, panels `zinc-900`, raised surfaces `zinc-800`,
      hairlines `zinc-700`/`zinc-800`.
- [ ] Semantic hues come from `index.css @theme` and mean one thing everywhere:
      **emerald** = gain/up, **rose/red** = loss/down, **amber/yellow** =
      warning, **cyan** = info. Never introduce a new hue for a new state.
      Enforced: `tests/themeContrast.test.ts` scans every file under
      `components/` for a hue outside that ramp, so a new one fails CI rather
      than surviving review. An exception needs a reason the file is not UI
      chrome, added to that test's allowlist.
- [ ] Exactly **one cyan accent per view**. If you're adding a second cyan,
      something else in that view should stop being cyan.
- [ ] The brand gradient (`--color-brand-start → mid → end`) is on the wordmark
      and the active-nav indicator. Nowhere else — not hero text, not tables,
      not chart fills, not a tab underline.
- [ ] No gray remappings for a color family. Neutral utility names (`zinc-*`)
      are kept deliberately so the whole app recolors from the token block.
- [ ] Micro-labels at ≥10px stay on `text-zinc-600`. Contrast is already tuned;
      darkening it to "make it readable" breaks AA.
- [ ] `.status-surface` / `.analysis-card` are deleted, not re-added. They match
      no rule in `index.css` since the theme went semantic globally.

## Shape and borders

- [ ] `rounded-control` (8px) for inputs and buttons; `rounded-bubble` (12px)
      for chat bubbles. Nothing else invents a radius.
- [ ] Borders are hairlines: `border-zinc-800/80`. No double borders — a panel
      inside a panel does not get a second frame.
- [ ] Dividers inside one surface are `border-t border-zinc-800/80`, not a
      boxed sub-card.

## Reuse — do not hand-roll these

| You need | Use |
|---|---|
| a state chip / pill | `components/ui/StatusPill` (`tone: up \| down \| warn \| info \| neutral`, `kicker` for micro-caps) |
| an empty view | `components/ui/EmptyState` |
| a tooltip | `components/ui/Tip` (it carries `shortcut=`; the key hint must be in the accessible name too) |
| a dropdown | `SelectMenu` |
| a destructive confirm | `ConfirmDialog` / `useConfirmDialog` |
| a segmented control | the pressed-state button pattern; **not** `.seg-thumb` on a container |
| a chat measure | `.chat-column` (880px) |
| an empty-state backdrop | `.chat-hero-grid` |
| a keyboard focus indicator | nothing at all — `index.css` outlines every focusable element on `:focus-visible`. Two things switch an editable field's outline off, and both are correct: the field declares its own ring (`focus-visible:ring-*` in its own class list), or focus did **not** arrive from the keyboard (`utils/navModality.ts` sets `html[data-nav-modality]`, because a browser matches `:focus-visible` on a text field after a mouse click too — a clicked composer must show no box) |

`.seg-thumb` is the absolutely-positioned sliding **sibling** in a segmented
control. Put it on the container and it resolves against the nearest positioned
ancestor and inflates to fill the surface.

## Type and numbers

- [ ] **Sizes come from the `text-ui-*` ramp, never a `text-[Npx]` literal.**
      The ramp is `--text-ui-{xl,lg,base,caption,sm,dense,xs,2xs}` in `index.css`
      (= 18/16/14/13/12/11/10/9px at the default dial), every step an offset from
      one dial, `--ui-font-size` (14px). Roles, not sizes: `text-ui-xs` says
      "micro-label", `text-[10px]` says nothing and cannot be scaled — moving the
      dial leaves a hard-coded literal exactly where it was. **Status: every step
      the ramp can express is migrated — 9, 10, 11, 12 and 13px are all banned by
      `tests/typeRamp.test.ts` and none appears in the source** (`dense` was the
      step 11px needed; `sm`/`caption` took 12/13px with no pixel movement). The
      literals that remain are the sizes with NO role: 8px (under the `2xs`
      floor) and 15px (between `base` and `lg`). Convert as you touch them, and
      do not add new ones. `2xs` (9px) is the dense-data exception and should not
      be reached for without a reason.
- [ ] Geist Variable for UI, DM Serif Text **only** for hero/display moments,
      JetBrains Mono for data.
- [ ] Every numeric readout is `font-mono tabular-nums`. A price, P&L or R that
      changes width every tick is a layout shift you can see.
- [ ] Tables over tiles whenever the data is tabular — win rates, skills, the
      trade log.

## Motion and density

- [ ] Transitions only via `--ease-snappy` at 0.12–0.18s.
- [ ] No `transition-all` — it animates geometry as well as paint, which is how
      a disclosure or a growing stream chunk slides the layout. Name the
      property: `transition-colors`, `transition-transform`,
      `transition-[width]`. Enforced repo-wide by `tests/themeContrast.test.ts`.
      A duration longer than 180ms is allowed only where it animates a data
      value (a progress bar's width, the tick-flash read), and it says so.
- [ ] No new `@keyframes`. The existing tick-flash and beacon patterns are the
    sanctioned exceptions.
- [ ] **No layout shift on stream chunks.** Text grows in place; nothing below
      it jumps.
- [ ] Dashboards default to one-line rows with disclosure, not cards stacked
      inside cards.

## Structure

- [ ] A surface's information architecture follows the thing it models. Learn is
      Queue → Memory → Health → Coach → System (`components/learn/LearnView.tsx`)
      because that is the order the learning loop runs in: a proposal arrives, it
      lands in the notebook, the notebook's health is checked, the coach talks you
      through what was learned, and the knobs governing all four come last.
- [ ] One home per concern. If a component appears in two surfaces, one of them
      mounts the other's component — nobody reimplements a table.
- [ ] No dead-end state. A surface with nothing selected says something true and
      offers the next action; it does not point at another surface.
- [ ] An affordance must do what its label says. "— toggle panel" only on a
      surface that has a panel.
- [ ] Heavy surfaces are `React.lazy` with `SurfaceSkeleton`, never
    `fallback={null}` — a blank screen reads as a crash.

## Verification

- [ ] `npm run lint` — errors are zero and warnings are capped by a ratchet
      (`--max-warnings 889`); adding a warning fails the gate.
- [ ] `npm run typecheck && npm run test && npm run build`.
- [ ] **Look at it in a browser.** jsdom cannot see an inflated pill, a clipped
      column, or a layout that only breaks at 800px — the Electron floor. Every
      UI workstream in this repo has caught real defects at this step that the
      suite passed.
- [ ] New/merged surface ⇒ a jsdom smoke test (pattern:
      `tests/learnSurface.test.tsx`, `tests/agentsSurface.test.tsx`).
- [ ] Anything that touches `index.css` focus or theme rules ⇒ `npm run
      render-probe`. jsdom mounts markup and never resolves a stylesheet, so a
      rule that silently removes an outline (or repaints a surface) passes the
      whole suite; the probe Tab-focuses real fields in a browser and reads the
      computed indicator back in both states.
