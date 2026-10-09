# UI redesign deep dive — measured baseline, 2026-10-10

Stage 1: **analysis only. No code changed on this pass.** Everything below is either a
`file:line` I opened in the working tree at `78f99bd`, or a number a headless Chromium
counted in the rendered DOM (`.probe-artifacts/census-1280.json`, `census-430.json`,
script `.probe-artifacts/census.cjs`). Provenance is marked per row.

Brief being served: "modern, clean, minimal, yet powerful", on top of `docs/ui-doctrine.md`.

## 0. What the measurements say about the brief

The app is **not verbose** and **not cluttered**. It is **sub-scale and flat**:

| measured | value | source |
|---|---|---|
| Text leaves on Trade at 1280 | 125 | census |
| …of those under 11px | 91 (73%) | census |
| …at 11px | 29 → **120/125 (96%) are ≤11px** | census |
| Heading elements on Trade | **0** | census |
| Strings longer than 60 chars, any surface | 1–4 per screen | census |
| Total characters rendered by the whole Trade screen | 1,185 | census |
| Ramp roles that exist but go unused | `xl` 2, `lede` 9, `display` 1, `hero` 1, `price` 1 | grep |
| Off-ramp Tailwind size classes | 103 (`text-lg` 40, `text-xl` 27, `text-3xl` 21, `text-2xl` 15) | grep |
| Ramp uses total | 1,485 | grep |
| Radius sites on the token vs off it | `rounded-control` 108 + `rounded-bubble` 2 vs 545 stock + 103 bare `rounded` | grep |
| `@keyframes` in `index.css` | 38 (doctrine sanctions 2) | grep |
| `transition-all` as a class | 0 — clean | grep |
| Clickables under 24px, both widths | 0 — the gate holds | census |

**Consequence for the brief:** a copy-reduction pass has almost nothing to win (the screens
are already short). The redesign work is *optical*: promote the reading size, give the surfaces
a heading ladder, collapse the radius sprawl to tokens, and retire animation inventory nobody
can account for. "Powerful" comes from hierarchy and legibility, not from more elements.

## 1. Gap table

Verdict key: **adopt** = do it, **adapt** = do it differently than proposed, **skip** = leave it.
`plan overlap` = the in-flight plan each finding collides with, so nothing gets built twice.

| # | pattern | what exists today (file:line) | status | verdict | reason | cost | plan overlap |
|---|---|---|---|---|---|---|---|
| 1 | One reading size | Trade renders 96% of its type at ≤11px; `text-ui-xs` is the app's default voice (401 uses) | broken | **adopt** | 10px is a micro-label role; using it as body text is why the screen reads as dense, not clean | 0 new UI. Per-surface role re-mapping, ~15–25 edits in `components/trade/**`; must re-measure with census after | 2026-10-07 audit proposal 5 (untouched) |
| 2 | Heading ladder | Trade: 0 heading elements at 1280. Repo: 5 h1 / 26 h2 / 38 h3 / 33 h4 / 1 h5 | broken | **adopt** | No screen has a scannable top; h4≈h3 means depth without order | 0 new UI; wrap existing titles in real heading tags, 1 line each | proposal 4 (untouched) |
| 3 | Display roles unused | `display`/`hero`/`lede` exist in the ramp and are used 1–9×; 103 sites use `text-lg…3xl` instead | partial | **adopt** | Off-ramp display cannot scale with the a11y dial; `typeRamp.test.ts` bans only `text-[Npx]` so it passes blind | 0 new UI; swap class + extend the gate to ban Tailwind size steps on headings | proposal 4 |
| 4 | Radius tokens | 650 sites off-token (241 `lg`, 183 `xl`, 68 `md`, 51 `2xl`, 103 bare) vs 110 on-token | broken | **adapt** | Doctrine says nothing else invents a radius; **no test gates it at all** (`grep -rln "rounded-control\|borderRadius" tests/` → 0) | Gate first (~40 lines in `tests/`), then a mechanical sweep. Borderline: `rounded-full` 132 uses are legitimate pills — exclude, do not churn | new; no plan covers it |
| 5 | Nested frames | `components/analysis/SetupLifecycleCard.tsx:34` has an `embedded ? border-t : rounded-2xl border` branch; its only caller `components/journal/TradeLog.tsx:177` omits `embedded`, inside a `rounded-xl` container at `:175` | broken | **adopt** | Panel-in-panel with a second frame and a third radius value — the exact rule in doctrine "Shape and borders" | 1 prop at 1 call site | proposal 3 (hit targets) adjacent |
| 6 | Animation inventory | 38 `@keyframes` in `index.css` vs a doctrine exception list of 2 | broken | **adapt** | Not a visual defect, an accountability one: name which are load-bearing, retire the rest. Deleting blind would remove real liveness signals | 0 new UI; deletion pass, census before/after | new |
| 7 | Tooltip truth | 4 `<Tip ` call sites vs 277 `title=` occurrences (110 of them dynamic `title={`) | broken | **adopt** | Native `title` has no `shortcut=` and is not in the accessible name, so keyboard hints are invisible to AT | Migrate the ~30 controls that carry a shortcut hint first; leave decorative `title` alone | proposal 6 (truncation honesty, untouched) |
| 8 | Native form controls | 22 `<select>` in 12 files vs `SelectMenu` in 4 | broken | **adopt** | OS-rendered white popups break the dark theme (`components/ui/SelectMenu.tsx:9` says so) | 12 files touched, no new state | new |
| 9 | Chat measure | `.chat-column` used 2×; `max-w-3xl` 8× | partial | **adapt** | Two thread widths in one product (768 vs 880). Pick one, keep the token | ~8 edits | `chat-dock-reference.md` |
| 10 | Motion escapes its own gate | `components/settings/AnalystLensSettings.tsx:268` `transition: all 0.2s ease` as **inline** CSS; `components/desk/SpeechBubble.tsx:78` `animate-[bubble-pop_220ms_ease-out]` | broken | **adopt** | The class-based scan cannot see either, so "no transition-all" is clean by measurement gap | Gate fix (scan inline styles) + 2 edits | new |
| 11 | Empty states with no next action | 17 `<EmptyState` sites, **0 pass `action=`** (verified multiline); `components/journal/Journal.tsx:272` still titles itself "Saved analyses are not wired"; `components/desk/DeskScene.tsx:614` "No analyst seats yet" with nothing to press | broken | **adopt** | Doctrine "No dead-end state" is unmet everywhere; this is the single cheapest "powerful" win | 0 new UI; add handlers to existing routes | proposal 1 (one skills home) |
| 12 | Buttons that never render | `components/learn/LearnView.tsx:96,98` declare `onAddSkill`/`onOpenSkillsSettings` and forward them at `:182`, but App's only `<LearnView>` mount (`App.tsx:2727-2739`) passes **neither** → the catalog's Add button and settings gear never appear in the real app | broken | **adopt** | A tested UI that production cannot show; the draft path exists and is routed elsewhere | 2 props wired in App | proposal 1 |
| 13 | Switch that never renders | `components/learn/MemoryFilesManager.tsx:294` gates the global-memory switch on `setIsGlobalMemoryEnabled`; mounted at `LearnView.tsx:183` with `username`+`memoryConfig` only | broken | **adopt** | Same class of defect as #12 | 1 prop | new |
| 14 | Lazy surfaces without a skeleton | 20 `fallback={null}` in App+components | partial | **adapt** | Doctrine bans it for heavy surfaces; some of the 20 are modals where blank-on-open is correct. Gate the 4 pinned surfaces already; audit the rest | 0 new UI | new |
| 15 | Dead file | `components/dashboards/analyticsShared.tsx` — 3 components, 0 importers (verified grep) | absent | **adopt** | Finish or delete; doctrine says do not duplicate | deletion | proposal 2 (dead gallery already deleted) |
| 16 | Rail row that duplicates a surface | `components/shell/SurfaceMenuList.tsx:157-166` Approvals row → `App.tsx:2167 openApprovalsInLearn()` = `setLearnTab('coach'); setSurface('learn')` | partial | **skip** | It is a shortcut into Learn, not a second screen. Rename would cost the muscle memory of Alt-keys for no measured gain | 0 | proposal 1 |
| 17 | Rich output cards / hosted pages / inline widgets | — | absent | **skip** | Default verdict; nothing in the brief asks for more surface, and the census says the app's problem is scale, not poverty | 0 | — |
| 18 | Density setting after the bar | `hooks/useViewDensity.ts`; Focus/Detail now written by Alt+D, Learn `learn-show-detail`, `learn-rest-telemetry`, Journal `journal-show-detail`, `journal-rest-telemetry` | complete | **adopt** (keep) | Verified in the browser this session: probe lines `Detail opens it again` / `Rest these closes it again` both ok | 0 (shipped) | new |

## 2. Bugs found inside in-flight plans (not part of the adoption plan)

1. `components/dashboards/WinRateDashboard.tsx:47-59` — a getter named `cyan` returns
   `--color-teal-500`; `orange` returns `--color-brand-end`; `blue` is the literal
   `#42a1ff`. The file self-documents it as plan item **C9 / Phase 4**, so it is a known
   divergence — but it breaks the hue gate *by name*, and `tests/themeContrast.test.ts:100`
   has `HUE_ALLOWLIST = {}`, so it excuses nothing while also not seeing token reads.
2. `components/shared/UpdateButton.tsx:55` puts the brand gradient on a status dot with a
   comment declaring itself a brand moment. The doctrine's exception list does not include
   it. Either the doctrine gains the exception or the dot loses the gradient.
3. `docs/plans/reference-transcript-catalog-copy.md:547` told the next agent that `StatusBar`
   resolves the model label. The file was deleted at `78f99bd`; I corrected that line in the
   same commit. Expect other plan docs to still describe the bar.

## 3. Removal list for approval (borderline flagged)

Nothing here is data the app computes for the user's benefit — each is a duplicate or an
unheld promise. ⚠ = borderline, needs your call.

| remove | file:line | why | flagged |
|---|---|---|---|
| Bottom-bar readouts (model, context %, supervisor, approvals chip, Focus/Detail) | deleted `78f99bd` | shipped already, this session | — |
| Trade screen's ≤11px micro-label mass, once roles move | ~91 leaves census-counted | shrink by promoting, not deleting | ⚠ this is the whole screen's current texture; do it as one visible step, not a trickle |
| `Saved analyses are not wired` panel title | `components/journal/Journal.tsx:272` | an ad for an unbuilt feature | ⚠ the panel itself is live; only the wording is a lie |
| Duplicate timeframe chip row | `1m/5m/15m/1h/4h` at 25px tall on Trade **and** Chat (census small-examples) | same control, two surfaces, two widths | ⚠ they may drive different clocks; verify before merging |
| 35 unsanctioned `@keyframes` | `index.css` | inventory nobody can account for | ⚠ tick-flash, beacon, and the seat liveness set are load-bearing — name each before deleting |

## 4. Copy-reduction pass

Measured, and the honest answer is that there is almost nothing to cut: 1–4 strings over
60 characters per surface, Trade's entire screen text = 1,185 characters. The wording is
already minimal. What should change instead is *voice-honesty*, not length:

| today | shortest honest wording | site |
|---|---|---|
| "Saved analyses are not wired" | "Saved analyses" + an action that opens them | `Journal.tsx:272` |
| "No analyst seats yet" (no action) | "Add a seat" on the same panel | `DeskScene.tsx:614` |
| `Nothing matches "…"` (no action) | add "Clear search" | `components/settings/SettingsMenu.tsx:425` |

## 5. Ranked plan

**Quick wins** (no new UI, no state, mostly 1-line each)
1. Wire the two unwired props (#12, #13) — buttons and a switch appear that tests already cover.
2. Empty states get an action (#11) — 0/17 today.
3. `SetupLifecycleCard` gets `embedded` at `TradeLog.tsx:177` (#5).
4. Delete `analyticsShared.tsx` (#15).
5. Fix `SpeechBubble` duration/easing and the inline `transition: all` (#10).

**Medium** (need a decision from you first)
6. Reading size + heading ladder on Trade, then the other surfaces (#1, #2, #3) — do them
   together; promoting size without a ladder just moves the flatness up a step.
7. Radius: write the gate, then sweep to tokens (#4). Gate before sweep, or it drifts back.
8. `SelectMenu` migration for 22 native selects (#8).
9. Tooltip pass on the ~30 controls that carry a shortcut hint (#7).

**Large**
10. Animation inventory reduction (#6) — needs a per-keyframe verdict, and it is the one item
    where a mistake removes real feedback.

**Dependencies on in-flight work:** #1–#3 overlap the 2026-10-07 audit's proposals 4–6, which
are recorded untouched; doing them here closes those. #11 and #12 overlap proposal 1 (one skills
home) — wire #12 first, it is a prerequisite for a single skills inbox. §2.1 waits on plan item
C9. Nothing here should start before proposal 1's known blocker (the coach panel rendering its
own draft rows) is settled.

**Additions to the ledger:** the only item that adds anything is #4's test (~40 lines, no UI, no
storage) and #10's possible ramp step. Nothing in this plan adds state, storage or prompt tokens.

## 6. How to read these numbers

- Census seeds a provider but **no journal and no bots**, so Journal/Learn/Approvals report
  their empty states (19 and 10 leaves). Read those rows as "chrome", not "working screen".
- Learn and Approvals returned *identical* census rows. Approvals is a route into Learn
  (`App.tsx:2167`), so that is expected in kind — but two identical measurements is exactly the
  identical-readings trap, so I am not claiming the coach tab was measured. Re-measure per tab
  before using those two rows for anything.
- One delegated audit returned citations that failed verification (it asserted the deleted
  status bar still existed, placed a `text-[10px]` comment at `index.css:528` which is flex
  CSS, and named two motion violations that do not exist). Its report is discarded.
- Another overstated three counts (selects 16/8 files → actually 22/12; `max-w-3xl` 4 → 8;
  EmptyState actions 1/17 → 0/17). I used my own measurements throughout.
