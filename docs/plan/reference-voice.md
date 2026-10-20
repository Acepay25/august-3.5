# E-54 — The reference's voice: the answer is prose, and the row stops shouting

**Status:** LANDED — **committed 2026-10-21** (`implementation-record.md` §24).
The §0 scan below describes the tree BEFORE this work and is kept as written,
because it is the measurement the plan was built on.
**Owner:** the trader. **Covers:** **O-133** — the owner's report that *"the
current UI is nowhere near similar to the reference image"*, after E-52's
eight behavioural phases had landed.
**Reference:** the Claude desktop chat (the reference set of 2026-10-20 —
eighteen screenshots, of which ten are the same app in the states a chat
takes), and the DeepSeek Harness transcript.
**Depends on:** E-52 (the transcript's behaviour). **Blocks:** nothing.
**Written:** 2026-10-21 · working tree at `e507e593`.

> Every `file:line` below was read at the tip named. The symbol is the durable
> anchor; the line is a snapshot.

---

## 0. The scan — E-52 changed what the transcript SAYS, not how it LOOKS

E-52 was a behavioural pass and it was the right one: the status line named
the activity, a step had a kind, the effort landed on the answer, the trail
worked in both homes. But the trader's report — *"the chart AI still looks the
same and even the chat surface"* — was true, and the reason is that **not one
of the eighteen gaps was about the face of the thing**. The rows still wore
the same chrome, and the answer still wore the interface's typeface.

Three deltas, each visible in a side-by-side of the reference and August:

| # | gap | what the reference does | evidence at `e507e593` |
|---|---|---|---|
| **V-1** | **The answer is prose and it is set in a SERIF.** Every answer in the reference set is a serif column — a reading face, not the interface's sans. The table inside it is serif too; the code block keeps its monospace. August set the answer in Geist, so the one surface in the app that is *read* rather than *operated* looked like another panel. | the reference's own answer, and August's own answer | `components/shared/chatChips.tsx:164` (`FadingText` → `MarkdownContent`, no face) |
| **V-2** | **Nothing is stamped above a message.** The reference identifies a turn by the turn. August stamped every row — user rows included — with an uppercase monospace label ("DESK · 5M"), and printed the time TWICE: once in the stamp and once in the row's own action row. | the reference's rows, and August's rows | `components/shared/ChatTranscriptRow.tsx:126` (`font-mono … uppercase tracking-wider`), `components/trade/panels/ChatTranscriptList.tsx:175` (the dock's copy) |
| **V-3** | **The work says it is RUNNING, in the app's running hue.** The reference's activity line is three warm dots; August's were grey, which says "something is happening" rather than "the desk is working right now". | the reference's activity line | `components/shared/AnalyzedRow.tsx:121` (`bg-zinc-500`) |

**And there was no ONE home for any of it.** The Chat surface and the Chart AI
dock each rendered their own row, so "the answer" was decided in two places —
which is how the two drifted apart in the first place.

---

## 1. What landed

1. **`components/shared/AnswerBody.tsx` (new) — the ONE home for the answer's
   voice.** Both conversation surfaces mount it. The model's answer is prose
   and wears the serif; the trader's own message stays in the UI sans (in the
   reference the human's bubble is interface, not prose).
2. **The row stopped shouting.** The seat is still named — August has to say
   which seat spoke — but as a quiet dot and a name, not a stamped log line.
   The time moved out of the label entirely: it was already in the action row,
   where the reference puts it ("5 minutes ago", at the end of the row).
3. **The running dots are warm.** The app's running hue is the amber one, and
   the reference's dots are warm too.
4. **`FadingText` now ADDS the caller's class to the base rules** instead of
   replacing them — a caller that says "this answer is serif" must not lose
   the size and the paragraph rhythm every answer shares.

**The doctrine amendment.** `docs/ui-doctrine.md` said DM Serif Text is for
"hero/display moments" only. The answer IS a display moment — it is the
product — and the doctrine now says so in those words, with the boundary
written down: the trader's words, the work card, the chips and the composer
stay in the UI sans.

---

## 2. What this does NOT close

- **The Chart AI dock's empty state** is still August's own: the centred
  "It can see this chart, the book and your drawings" and the suggestion
  pills. The reference set has no empty state to copy — every frame of it
  holds a conversation — so this one is a design decision, not a match.
- **The work card's interior** is still August's: the tool rows, the reasoning
  row and the wire row. The reference's card is a hairline-separated LIST of
  steps with a chevron on each expandable one; August's card holds the same
  facts in a different shape. The card's OUTER shape (a hairline border, a
  collapsible headline) is already the reference's.
- **G-12** (a long bot turn is a wall) — untouched; it is a live-card problem.
- **G-15** (per-provider thinking joined flat) — untouched; it is a row-model
  question.
- **A text serif.** The app's serif is DM Serif Text, a display face: it has
  one weight and no italic, so a bold level in the answer is a synthetic bold.
  A TEXT serif (a reading face with a weight range) would be the correct
  choice for a long analysis, and that is a font decision — a dependency and
  a doctrine change — not a styling tweak.
