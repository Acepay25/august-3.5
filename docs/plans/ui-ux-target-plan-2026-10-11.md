# UI/UX target plan — 2026-10-11

> **Reconstruction note (2026-10-14):** the workspace was rolled back to a pre-session
> snapshot and the original file was lost. This document is rebuilt from the working
> record of the implementation that executed against it (Phase 0 and Phase 1 completed,
> Phase 2 in flight). Every claim below that cites a `file:line` or a defect behaviour
> was verified against the code; the four build decisions in §5 are recorded **as
> answered**. Where a row's status changed, it says so inline.

## 0. Which screenshots are which product

The reference set mixes two products. The August captures (`.probe-artifacts/shot-*.png`)
are cold, empty-profile sessions — enough to fill the "today" column below, but they
show no working transcript. The Claude Desktop captures were supplied separately
(2026-10-13) and close the two gaps §10 asked for: the **Artifacts panel** and the
**Memory as Topics + Areas** editor with its "Tell Claude what to change" box.

Reference patterns in play, from those captures: a `SKILL.md`-shaped right panel
(`Description` as its own labelled field, body below, `Save skill` / `Copy` in the
header), Settings → Memory as Topics + Areas (topic list with one-line summaries and
"Updated" stamps → detail view with Last updated / Summary / Details / Delete, and a
natural-language edit box at the foot), collapsible command rows with mono output, an
Artifacts panel of generated files with `Download all`, and a top-left mode pill
(💬 / `</>`) for the chat↔code switch.

## 1. Already built — do not pay for these twice

- **The right-panel shell.** `components/shell/RightPanel.tsx` + `hooks/useRightPanel.ts`:
  push/fullscreen presentations, drag-resize with a persisted width published as
  `--panel-w`, hide-vs-close geometry (hidden = out of flow, children stay mounted so a
  switched-away panel keeps its draft), and capsule strips drawn only when more than one
  dock is open. New panels are content-only.
- **The grouped model picker.** A two-column flyout (providers left, models right) with
  search, "Free models only", Refresh and a check on the active row. Verified in the
  2026-10-12 capture.
- **`utils/runStatus.ts`.** The one run-status vocabulary — colour, word, error
  classification, sanitised error text. Never hardcode a status colour in a component.
- **AGENTS.md conventions.** The canonical single-source modules (riskReward,
  finishReason, harnessMarks, providerRequestPolicy, memoryBudget, skillIdleLifecycle …),
  the dark Minara-derived theme tokens, the `ui-*` type scale, and the probe gates.

## 2. Gap table

| # | reference pattern | what August has today (file:line) | status | verdict | reason | cost |
|---|---|---|---|---|---|---|
| 1 | **Skill viewer**: rendered `SKILL.md` in a right panel — `Description` as its own labelled field, body below, `Save skill` / `Copy` in the header | a skill is edited as a raw notebook file in the memory manager; no rendered view | **CLOSED (Phase 1)** | **adopt** | this is the UI half of the retrieval fix: if `description` becomes the trigger, it must be the most visible field on the record | 1 panel in the existing `RightPanel` shell + 1 route from `SkillsCatalog` rows. No new state, no storage |
| 2 | **Memory as Topics + Areas**: list of named topics each with a one-line summary and an "Updated" stamp → detail view (Last updated / Summary / bulleted Details / Delete) | the notebook is folders and files (`components/learn/MemoryFilesManager.tsx`), so the user browses *storage*, not *content* | **IN FLIGHT (Phase 2)** | **adopt** | the single biggest legibility win in the whole reference set, and it is the UI for research item R3 (index + body). Deleting a belief should be one press on the belief, not one on a file | medium: a topic index derived from existing notebook files + a detail route. Reuses `MemoryFilesService`, no new store |
| 3 | **NL edit of a memory entry** ("Tell Claude what to change" at the foot of a topic) | none — edits are direct text edits of a file | **IN FLIGHT (Phase 2)** | **adopt** | it routes a change through the same approval queue the app already has, which is the one governance mechanism here that matches both reference products | needs the write-approval path; `memoryAmendments.ts` (queue) + `AmendmentsInbox` already prove the pattern |
| 4 | **Artifacts panel**: generated files as cards, per-file open, `Download all`, thumbnails of content | exports exist (report, CSV, training data, backup) but there is no place that *collects* what a run produced | absent | **adapt** — **decision recorded: FULL editor** (§5 Q3) | worth doing only as a list over existing export records — a parallel artifact store would be a second source of truth | medium; Phase 4 |
| 5 | **Grouped model picker**: provider submenus, tier badges (`MED`, `ULTRA`), Thinking toggle + Effort in one popover, `Add custom model…`, `Edit models…` | **already built** — a two-column flyout with search, "Free models only", Refresh and a check on the active row | partial | **adopt the remainder only** | what's genuinely missing versus the reference is the tier badge and putting Thinking/Effort inside the same popover; the shape is already better than Claude's | small (Phase 3) |
| 6 | **State tables** with explicit status words | some tables smuggle state through emoji | partial | **adopt** | `utils/runStatus.ts` is the one vocabulary; an emoji is invisible to a screen reader and to a colour-blind trader | small (Phase 3) |
| 7 | **Conversation rail grouping** (by symbol/strategy) | conversations list in time order | absent | **decision recorded: by VIEWING, one Artifacts view with tabs** (§5 Q2) | see §6 — the rail's grouping question was answered as part of the destination move | Phase 5 |

## 1b. Phase 0 — what the 2026-10-12 captures exposed

These are defects, not design preferences, and they are cheaper than anything above.
They went first. **All seven are CLOSED** (with tests that pin the fixed strings).

1. **The timestamp bug — the single most damaging thing in the capture.**
   `components/agents/AgentsView.tsx` — `relTime` computed a DURATION
   (`Date.now() - Date.parse(iso)`) and handed it to `relTimeMs`, which subtracted
   `Date.now()` again. Every row printed the epoch leaking through a double
   subtraction: an 8-day-old conversation read `20731d`. Fixed as one
   `durationLabel(ms)` with two entry points (`relTime` for ISO stamps, `relTimeMs`
   for epoch-ms); `tests/agentsSurface.test.tsx` pins `8d` / `now` / `45m` and the
   absence of any 5+ digit day count.
2. **The decision card renders twice in one turn.** The card appeared once under the
   analysis answer and again under the `DESK ·` row, with identical
   ENTRY/STOP/TARGET/PROBABILITY. The second carrier is the "Logged from Chart AI"
   receipt (`services/trade/proposedTrade.ts`), which carries a *copy* of the plan's
   analysis for the journal row and the autopilot. Fixed at ONE decision point:
   `chatRowFrom` gates the row model (`analysis: m.planId ? undefined : m.analysis`)
   and `InlineVerdict` reads the row, never the message.
3. **The prose repeats the card's numbers verbatim** ("Short BTCUSDT @ 85175, SL 85295,
   TP 85000 / 84875") directly above a card that labels those same four numbers.
   Pick one carrier: the receipt is now `Logged from Chart AI — Short BTCUSDT · plan
   btc-mutwj1s` — the numbers live on the answer's card and in the journal row.
4. **`AgentsView.tsx` read `Inspect debate audit & evidence` but its summary carried
   `uppercase tracking-wider text-ui-2xs`** — the exact texture removed from the rail
   headings, still on one row, so a sentence-case source shouted from the CSS. Now
   rail-heading texture (`text-ui-sm font-semibold text-zinc-500`).
5. **`MEDIUM` is an unlabelled value.** ENTRY/STOP/TARGET/PROBABILITY all carry labels;
   confidence sat right-aligned in mono gray with none. An affordance must say what it
   is — it now reads `confidence MEDIUM`.
6. **`plan btc-mutwj sy3`** — a slug rendered with a space in it: either the id contains
   a space or the row is breaking one; both are text-integrity bugs. The long receipt
   text that wrapped mid-id is gone with fix 3; the id rides its own clause.
7. **The read-aloud control has no label.** The action row renders `Copy` as text and
   the speaker as a bare glyph, so the row reads "Copy 20731d".
   `components/shared/chatChips.tsx` now prints `Read aloud` / `Stop` beside the icon
   (the aria-label alone left sighted users a symbol with no name).

## 3. Folded in from the memory/skills research

The UI items above are worth little unless the two engineering items behind them land,
because a skill viewer over a record whose `description` is never read is decoration:

- **R1 — make `description` the trigger.** `skillMatchesSetup`
  (`services/learning/SkillMemoryService.ts`) scores `coin +2, direction +2, family +2,
  regime +1` and returns `hits >= 2`; nothing compares the description to anything.
  Body reaches the model only at verdict, truncated to `SKILL_BLOCK_MAX = 400`
  (`MemoryRetrievalService.ts`); other stages get `skillIndexLine`.
  **CLOSED (Phase 1):** `services/learning/MemoryRetrievalService.ts` `descHit` now
  scores description words (stop-worded, exclusion-aware — "avoid X" never matches X);
  a description hit outranks a field-only hit so an entry that ANSWERS the setup wins;
  the budget accounts for the description band with the body bytes; retrieval cap
  unchanged at 6. Pinned by `tests/skillDescriptionTrigger.test.ts`.
- **R2 — settle the rules store.** `learning_rules_v2_<user>` has no reader (only
  `useProfilePersistence.ts` and `useUserProfileLoader.ts`); the type admits it at
  `types/learning.ts`. Wire it or delete it. Can land any time.
- **R3 — index + body for memory** (the storage shape that makes gap 2 honest).
  **CLOSED (Phase 2):** `services/learning/memoryTopics.ts` derives the topic index
  from the live notebook — `memoryTopicsFromStore` (filters, ordering),
  `topicParts` (summary = the WHOLE first prose line; details = everything after it, so
  the two blocks never print the same sentence), `relativeElapsed` (the ONE elapsed
  formatter for the surface). No second store.

Order: **R1 → 1 → 2 → R3 → 3 → R2**. R2 can land any time; it is a deletion or a block.

## 4. Sequenced phases

**Phase 0 — the defects in §1b.** The timestamp bug first: it is wrong on every row, it
is invisible to the suite, and it is the single most damaging thing in the capture. Then
the duplicate card, the duplicated numbers, the uppercase label, the unlabeled
confidence. **DONE.**

**Phase 1 — the skill becomes legible** (R1 + gap 1). Description-as-trigger in the
matcher, and a `SKILL.md`-shaped panel opened from a `SkillsCatalog` row showing
Description / body / outcome stats, with Save and Copy. Gate: the render-probe must
drive the open→read→close round trip, and a paraphrased verdict must cite the skill it
obeyed. **DONE** — `components/learn/SkillViewerPanel.tsx`, the catalog row route, the
probe's round trip (seeded skill file + open → read description/ledger → close), and
the probe's `aria-checked` switch-blind-spot fix.

**Phase 2 — memory as topics** (gaps 2 + 3, R3). A topic index over the existing
notebook, a detail view, per-topic Delete, and the NL-edit box feeding the existing
approval queue. **IN FLIGHT** — `memoryTopics.ts` + `memoryTopicEdits.ts` (the NL box's
rewrite goes to the memory model and lands PENDING in `memoryAmendments.ts`, where a
human approves in Learn → Queue) are landed and unit-tested; `MemoryTopicsCard` +
`MemoryTopicPanel` + the Learn wiring and their component tests are being restored.

**Phase 3 — the small honest fixes** (gaps 5, 6). Grouped picker with tier badges; state
tables via `runStatus` instead of emoji.

**Phase 4 — artifacts** (gap 4). Decision recorded: **FULL editor** (Topics + Areas,
NL edit, create/edit/delete, the "Tell Claude what to change" box, memory import).

**Phase 5 — the mode switch and the destination move** (§6–§8). Last on purpose:
emptying the rail is only safe once Journal, Learn, Skills and Approvals each have a
panel to live in, which phases 1–4 build. Doing it first would strand four destinations
and break the probe's surface checks for no gain. Rail decision recorded: **by VIEWING** —
one Artifacts view with Skills and Learn as tabs.

Nothing in phases 1–3 adds a store, a lifecycle, or a background job. Each phase ends
with `tsc`, the full suite, `render-probe`, and a re-run of the census so before/after
counts are measured rather than asserted.

## 5. Decisions I need before building — ANSWERED 2026-10-13

1. **Is the proxy app's shell a target too?** → **Interim shell.** The legacy app UX is
   interim, not final; the reference shape is the direction the surfaces grow into.
   Phase 1+ applies the reference layout to August's own surfaces.
2. **Rail grouping** — group conversations by symbol/strategy (gap 7), or keep time
   order? → **By viewing: one Artifacts view with two tabs** (Skills / Learn), not two
   rail rows. Phase 5.
3. **Artifacts scope** — a list of what a run produced (report/CSV/PDF/backup), or
   nothing? → **Full editor.** Phase 4.
4. **The HUD** — recorded as **skip** per your two prior rulings. → **Confirmed: build
   it.** A trade lock-in gets a second confirmation naming direction, size, levels and
   the irreversibility. August never places or signs a trade — it is analysis and
   journaling only.

## 6. Chat surface redesign — the build list

The reference's top-left pill (💬 / `</>`) is Claude's own chat↔Code switch. August has
nothing like it today: the header carries a text label of the current surface
(`components/shared/Header.tsx`) and the six destinations live in the left rail. So:

- **The mode pill**: a two-state control in the header for the Chat surface's two jobs
  (ask the desk / run analysis). Not a product-wide switch — a Chat-surface affordance.
- **CX-1 rail mood**: the rail's grouping follows the by-viewing decision (§5 Q2) —
  Knowledge (Skills + Learn) becomes one view with tabs; the rail loses two rows.
- **Destination move**: each of Journal, Learn, Skills and Approvals gets a right-panel
  home so the rail can shrink. This is why Phase 5 is last.
- **Chat layout fix**: the desk thread's rows are the conversation product; the rail's
  conversation rows carry previews and timestamps (the timestamp fix in Phase 0 is what
  makes those legible at all).
- **ADS-8 quote→reply**: quoting a message targets a reply rather than a new turn.

## 7. Where each current destination ends up

- **Trade** — unchanged centre; the dock keeps its own right panel.
- **Journal** — gains a right panel for the report/stats detail (so the rail row goes).
- **Skills** — becomes a tab of the Knowledge view (by-viewing decision).
- **Chat** — the desk pane, plus the mode pill; rail rows stay (they are conversations,
  not destinations).
- **Learn** — becomes a tab of the Knowledge view; its three sub-tabs and the right
  panel docks stay.
- **Approvals** — lands on the Learn inbox route it already uses, and gains a panel.

## 8. Gates this breaks, and what must change with it

- **The i18n/chip sweep and the render-probe are the two that fail first**: the probe
  asserts six nav-surface rows; the by-viewing move changes that count, and the
  round-trip gates added in Phases 1–2 extend it. The probe's surface list and the
  `NAV_RAIL_EXPANDED_PX` read need updating with the rail change, not after it.
- **Run the probe on an idle machine**: alongside a build or the full suite it reports
  blank surfaces the app was seconds from filling.
- **Overlays mount outside `<main>`** — measuring `<main>` after opening one re-reports
  the previous surface and passes vacuously; assert the overlay's own root. Both new
  panels (skill viewer, memory entry) live inside the Learn surface, so their round
  trips assert the panel's own testid, plus the shell's `data-hidden` state on close
  (hide ≠ close — the shell keeps the child mounted).
- **A check whose measurement is identical across two different states is measuring the
  wrong thing.** The Learn sweep learned this twice: a switch's own `aria-checked` flip
  is movement no text change can show (the sweep now reads it, so a genuinely dead
  switch still fails), and the skill gate waits for the catalog GRID, not the section
  testid that also exists in the loading and error states.
- **The seed is part of the gate**: the probe seeds a real skill file into
  `memory_files_v1_Probe User` WITH the default folder table (`isSkillFile` resolves a
  file's folder by id — a blob with `folders: []` leaves the seeded skill in no folder
  and the catalog lists nothing while the probe looks like a feature failure). The
  memory-topic gate uses the same store.
- **Hit targets**: every clickable control measures ≥24px on its short side at desktop
  width. Entering the Learn Memory tab surfaced two sub-24px controls (the skills search
  input and "New folder"); both were fixed, not waived.

## 9. Branch merge audit — measured 2026-10-12

In-flight work at the time: R1 (skill description matching) — landed and pinned.
Everything else on this plan was uncommitted work. The working tree was later rolled
back to a pre-session snapshot on 2026-10-14; Phases 0–1 were re-applied from the
implementation record and re-verified (tsc clean, full suite, lint under ratchet,
render-probe OK). **Lesson recorded: commit at phase boundaries** — the plan's gates
passed twice and were lost once.

## 10. What I still need from you

Both items are now **supplied** (2026-10-13 reference captures): the Artifacts panel
and the Memory Topics/Areas editor. Still outstanding, and blocking:

- **A working-session capture of the Chat desk thread** (the `.probe-artifacts/shot-*.png`
  captures are cold, empty-profile sessions). The Phase 0 transcript defects were
  verified against the code and pinned by tests; a live capture would confirm them from
  the outside, and is the only way to see the mode pill's future home with a real
  conversation behind it.
- **The HUD confirmation wording** (decision recorded: build it) — what the second
  confirmation must name: direction, size, levels, irreversibility, and what pressing
  confirm actually does (records intent in the journal; August never signs).
