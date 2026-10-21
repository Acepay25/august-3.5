# E-55 — The reference's other four surfaces: the work card, the skills, the memory, and the tools

**Status:** IN FLIGHT — the chat surface's work card, the thinking block and the
executed tools have landed; the skills catalogue and the memory surfaces are
landing with it. The §0 scan below describes the tree BEFORE this work and is
kept as written, because it is the measurement the plan was built on.
**Owner:** the trader. **Covers:** **O-134** — the owner's second reference
set (2026-10-21), *"you can take a look to see how should the skills, memory,
thinking block and executed tools and more should be render, the chat surface
and more"*.
**Reference:** the Claude desktop app — nineteen new frames (2026-10-20/21):
the **Customize → Skills** panel, the **Settings → Memory** list and detail,
and ten frames of the chat surface with the work card, the terminal output, the
interrupted notice and the artifact cards.
**Depends on:** E-52 (the transcript's behaviour), E-54 (the reference's
voice). **Written:** 2026-10-21 · working tree at `bef3b31c`.

> Every `file:line` below was read at the tip named. The symbol is the durable
> anchor; the line is a snapshot.

---

## 0. The scan — E-54 fixed the FACE of the answer; this fixes the FURNITURE around it

E-54 was the owner's *"the current UI is nowhere near similar to the reference
image"* — and it answered the half of that sentence about the ANSWER: the
answer is prose, it wears the serif, the row stopped shouting. The second
reference set is the other half: the owner sent the **skills panel, the memory
panel, and ten frames of a chat surface doing real work** — the work card
open, a terminal output inside it, an interrupted run, a file handed back. Those
frames are where August's transcript still looks like August.

The deltas, each visible by putting the two side by side:

| # | gap | what the reference does | evidence at `bef3b31c` |
|---|---|---|---|
| **W-1** | **The work is a BARE LINE with the card BELOW it.** "Ran 4 commands, read a file ⌄" sits on the page with nothing around it; the card is the OPEN BODY, holding hairline-separated steps. August had the card AROUND the line, so a collapsed turn was a little box with a sentence in it, and the steps inside it were boxes inside a box. | every work frame | `components/trade/panels/ChatWorkTimeline.tsx:168` (the wrapper's own border), `index.css` (`.reasoning-row.is-open` carried the border) |
| **W-2** | **Every step that opens carries a CHEVRON.** "Ran a command ⌄", "Ran 4 commands, read a file ⌄". August's summaries had no marker at all — a collapsed line only hinted that it opened. | the work card, the terminal frames | `components/shared/AnalyzedRow.tsx:118`, `components/shared/ToolActivityRow.tsx:125` |
| **W-3** | **An interrupted run is a CARD with the two ways out as raised chips.** The reference draws "Claude's response was interrupted." inside a bordered card with "Edit prompt" and "Try again" on the right. August had a bare row of ghost buttons — a caption on the answer, not the place the run stopped. | the interrupted frame | `components/shared/InterruptedRunNotice.tsx:19` |
| **S-1** | **Skills are a GRID of cards**, each with an icon tile, a name, a one-line description and a mark; grouped under a heading, with a category badge. August drew skills as rows of a list. | the Skills panel | `components/learn/SkillsCatalog.tsx` |
| **M-1** | **Memory is a LIST of three columns** — label, description, when it was last written — hairline-separated, the selected row on a raised panel with its edit and delete beside it; and the DETAIL is a labelled read ("Last updated", "Summary", "Details") with a bullet list. | the Memory panel, ×3 frames | `components/learn/MemoryFilesManager.tsx`, `components/learn/MemoryTopicPanel.tsx` |

**And the shape of the work was in three places at once.** The thinking block
and the executed tools were each drawn by their own component, and the work
card was a third wrapper around them — so the reference's one shape (a line, a
card, hairline-separated steps) had to be built once, in one place, or the
three would drift apart again.

---

## 1. What landed

### 1.1 The work card (W-1, W-2, W-3)

1. **The work is a bare line with the card below it.** The border and the fill
   moved from the wrapper around the activity line to the line's **open body**
   — which is where the reference draws the card. A collapsed turn is now one
   quiet sentence on the page; the card appears under it when the work opens.
   The steps inside are **rows**: hairline-separated, flush, and no longer
   boxes inside a box. The side-effect rows (a skill drafted, a note written)
   keep their own card, because in the reference a "Presented 2 files" card is
   a SEPARATE card below the work, not part of it.
2. **Every step that opens carries a chevron** — the work line and the tool
   rows. A collapsed line otherwise only hints that it opens.
3. **An interrupted run is a card** with the mark, the words, and the two ways
   out as raised chips — the same furniture the reference uses for a file it
   hands back. August had a bare row of ghost buttons, which read as a
   caption on the answer rather than as the place the run stopped.

### 1.2 The skills catalogue (S-1)

The reference's **Customize → Skills** panel is a catalogue: a title and a
one-line subtitle, a header row (search, refresh, settings, Add), an
"Installed" label on a hairline over a **two-column grid of cards**, and a
category row carrying a raised pill. August's catalogue now draws that shape:
each card is a coloured rounded icon tile, the name in medium weight, a
one-line muted description truncated with an ellipsis, and the availability
mark at the right edge.

**The mark is the honest part.** The reference's checkmark means ONE thing —
this skill is available. August has three honest answers to that question, so
it has three marks: **check** (reaching a seat), **pause** (suspended by the
idle sweep), **ban** (switched off, or retired). A check on a suspended rule
would be a lie the trader cannot see through. The state is derived from
`skillEnabledFlag` — the one place `enabled` may be derived — and never
re-derived.

**The colour follows the state, not the kind.** The tile used to be coloured
by the rule's kind, which painted a rule that never traded in rose — and rose
means LOSS in this theme. The tile now carries the state colour (emerald =
reaching a seat, amber = suspended, zinc = not in play) and the glyph carries
the kind.

**What was deliberately NOT matched:** the reference lists the same skill under
"Installed" AND under the plugin that provides it. August has no plugins, so
the shipped starter shelf (`prior: 'book'`) gets the reference's "System" badge
on its OWN category row — an exclusive partition, nothing printed twice. The
gear is hidden because August has no skills settings screen to open; a gear
would promise settings that do not exist. The verdict words and tones now live
in ONE place (the catalogue) and the reader panel imports them, instead of the
two keeping a second copy each.

### 1.3 The memory surfaces (M-1)

The reference's **Settings → Memory** is two surfaces: a LIST and a DETAIL.

**The list** is three columns — a label, a description, and when it was last
written — hairline-separated, grouped under section headings, with the SELECTED
row raised and carrying the pencil and the trash beside it. August's memory
list was a grid of cards with a date badge in the corner. It is now the
reference's grammar: label · what it says · when it was written. The pencil
edits the entry **in place**, through the notebook's only write path; the trash
really deletes, behind a confirm. The date column is ONE formatter, and it
never invents a timestamp for a file that has none.

**The detail** is a read: a "← Memory" back link, the title, the Delete action
on a raised chip, and then three labelled fields — "Last updated", "Summary"
and "Details" — with the details a real bullet list. August's detail was a
form.

**The reference sets the summary and the details in the UI sans. August sets
them in the reading serif**, through `components/shared/AnswerBody` — the ONE
home for the model's voice — because a memory summary is content the trader
READS, and it is the model's own prose about their market. Everything around
it stays in the interface sans. This is a deliberate deviation, and it is one
prop if the trader disagrees.

**The notebook browser, the Settings → Memory tab and the assistant-memory
card** were moved onto the same three-column grammar, so the memory area has
one row shape rather than three.

### 1.4 The reading serif (the face, corrected)

E-54 set the answer in DM Serif Text — the app's only serif — and that was
right about the FACE and wrong about the TYPE. DM Serif Text is a display
face: **one weight**, no italic. A model that writes "**Inputs:**" in a long
analysis got a *synthetic* bold — a smear the browser fakes by thickening the
stems — and a smeared long paragraph is not readable prose. The reference's
answer face is a TEXT serif.

So the app now has **two serifs, two jobs**: DM Serif Text stays the hero and
brand face (`font-serif`), and **Newsreader** (`font-reading`) is the reading
face the answer is set in. Both are self-hosted through `@fontsource`, as the
other three are.

---

## 2. What this does NOT close

- **The action row's icons.** The reference's row is `⧉ 🔊 👍 👎 ↻` and a time —
  icons only. August's is labelled ("Copy", "Read aloud") and carries the
  thinking tier, which is a fact the reference has no place for. Labels are
  clearer and the tier has to stay visible, so this stands as a difference.
- **The inline code chip.** The reference draws inline code in a coloured
  chip; August's is the neutral zinc pill the doctrine asks for.
- **A "Presented 2 files" card.** The reference hands back files it wrote,
  each on a card with an icon tile and a Download. August has no produced-file
  surface to draw that on — a feature, not a styling match.
- **A web-search results card.** The reference draws its search results in a
  bordered card with a favicon and a domain. August has no such surface.
- **The empty chat state.** The reference opens a new chat with a large serif
  greeting above the composer. August's is empty, and what it should SAY is a
  copy decision, not a styling one.
- **The reference's duplicated skill list, its per-skill colours and its
  plugin category** — August has no plugins, and the catalogue says so rather
  than inventing one.
- **The two live skill surfaces still disagree** with each other: the Studio's
  tiles are neutral and carry no right-edge mark, and they show a humanized
  name where the catalogue shows the file slug. Both live in
  `components/dashboards/StrategyStudio.tsx`, which was out of scope here.
- **The reference-shaped catalogue lives in Learn → Memory** while Learn →
  Skills shows the Studio, so the tab named "Skills" does not show the
  reference's page. Moving it is an `App.tsx` / `LearnView.tsx` decision.
- **`memoryUpdatedLabel` lives in `MemoryTopicsCard.tsx`** because the module
  that owns that vocabulary (`services/learning/memoryTopics.ts`) was out of
  scope. It should move there the next time that file is touched.
- **E-52's G-12 and G-15** are untouched: a long bot turn is still a wall, and
  per-provider thinking is still joined flat.

