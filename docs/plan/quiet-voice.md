# E-56 — The quiet pass: the rail, the dock and the chart area stop shouting

**Status:** LANDED — **committed 2026-10-21** (`implementation-record.md` §26).
The §0 scan below describes the tree BEFORE this work and is kept as written,
because it is the measurement the plan was built on.
**Owner:** the trader. **Covers:** **O-135** — the owner's *"make the chart
surface and the sidebar in the chat surface look similar to the reference
images"*, and *"how the current skills being formatted? also the memory too?"*.
**Reference:** the Claude desktop app's rail (the Skills page and the chat
frames) and its chat column.
**Depends on:** E-52 (the transcript's behaviour), E-54 (the reference's
voice), E-55 (the other four surfaces). **Written:** 2026-10-21 · working tree
at `8e863522`.

> Every `file:line` below was read at the tip named. The symbol is the durable
> anchor; the line is a snapshot.

---

## 0. The scan — the app had been shouting where the reference whispers

The owner's report was precise: the **chart surface** and the **sidebar in the
chat surface** still did not look like the reference. Looking at the two side
by side in a browser (the frames in `.probe-artifacts/`), the gap was not
layout or colour. It was **volume**.

| # | gap | what the reference does | evidence at `8e863522` |
|---|---|---|---|
| **Q-1** | **The rail's section headings are sentence case, small and muted.** "Pinned", "Chats and tasks". August's shouted: `uppercase tracking-widest` on every heading, and the tab strip too. | the reference's rail, in every frame | `components/agents/AgentsView.tsx:1096` (the Pinned heading), `:1200` (Conversations) |
| **Q-2** | **A conversation's title is NOT a headline.** The reference lists them in a regular weight; August bolded every one, so a list of things to go to read as a list of headlines. | the reference's chat list | `components/agents/AgentsView.tsx:1222` |
| **Q-3** | **A row's glyph is a plain mark, not a medallion.** The reference draws a small chat glyph; August ringed every row in a circle. | the reference's chat list | `components/agents/AgentsView.tsx:345` (the Row's glyph) |
| **Q-4** | **The dock's prose labels are quiet.** August printed a whole sentence — *"Panel seats (1/3) — pick up to 3 models or agents; they answer together and talk to each other"* — in uppercase, letter-spaced. | the reference's panels | `components/trade/TradeChatPanel.tsx:1035` |
| **Q-5** | **The dock's own name is not a headline.** | the reference's title bar, where a conversation's title is regular weight | `components/trade/TradeChatPanel.tsx:865` |

**The rule the reference teaches, in one line: a label that is DATA may shout
(letterspaced, monospaced, uppercase — the app's own rule, and a good one); a
label that is a LABEL is quiet.** August had let the data rule leak into the
prose, and the rail was the worst of it: a sidebar whose every heading is
uppercase is a sidebar that cannot be read quickly.

---

## 1. What landed

### 1.1 The rail stops shouting (Q-1, Q-2, Q-3)

- The section headings — **Pinned**, **Rooms**, **Conversations** — are
  sentence case, small and muted, the way the reference's "Pinned" and "Chats
  and tasks" are. They were `uppercase tracking-widest` and semibold.
- The **Chats | Bots** tab strip is quiet too.
- A conversation's title is **not a headline**: the reference lists them in a
  regular weight, and a list of bold titles reads as a list of headlines.
- A row's glyph is the reference's **plain mark**, not a ring around every
  row. The state still reads — the working row's mark is amber, the active
  row's is bright.
- The dock's own prose labels were quietened the same way: the panel-seats
  paragraph was a whole **sentence** in uppercase letter-spacing, and the
  dock's name was set as a headline.

### 1.2 The chart area is a flat page (the chrome pass)

The reference's window is a **flat page**: sections are separated by
hairlines, the controls are flat, and a control's state is its colour rather
than a frame around it. August's chart area had a fill and a border on every
surface. Now:

- The market row is a **title bar** (the instrument is the reference's title
  and caret), the readout strip is hairlines only, the order book is a
  **section** of the page with one `border-l`, and the drawing rail is the
  page colour.
- The book toggle, Screener, Pinned, ƒSMA and the symbol trigger are **flat
  controls**; the icon row is one size (14px).
- The section and chip labels are sentence case; the **raised** chip is kept
  exactly where the reference has one (the active timeframe, the segmented
  control's selected tab).
- The seam between the chart and the dock is a **hairline**, not a filled
  gutter — the shell's `RightPanel` drag handle had a fill and a border on
  both sides, which no longer matched the flat half beside it.
- The level-accuracy badge's percentage gained `tabular-nums`: every numeric
  readout in this app is mono tabular, and that one was not.

**The judgement call, and why it is not a compromise.** The readout row's
UPPERCASE labels — "ORACLE", "24H VOLUME", "OPEN INTEREST" — **stay
uppercase**. That is this app's deliberate data-density rule, not drift: the
order book's own PRICE/SIZE/TOTAL header is the same family, and the type ramp
names `text-ui-2xs` a dense-**data** floor. The reference's sentence-case
labels are *prose* headings — a different role from a figure's caption. So the
line was drawn **by role**: navigation, section and chip labels are sentence
case; data-readout labels keep the app's rule. Both halves are pinned in the
new test, so a future "make it all sentence case" sweep cannot half-apply it.

### 1.3 The memory vocabulary came home

The memory list's date column and its section headings are **vocabulary**,
and they were living in a component — with the Settings card importing them
**from that component**. They now live in `services/learning/memoryTopics.ts`,
beside the derivation they belong to, and both surfaces read them from there.
A vocabulary two components import is two vocabularies the moment one of them
edits it.

---

## 2. What this does NOT close

- **The `ScreenerPanel` still has the old chrome.** It is a full-screen modal
  rather than the chart area, and the reference set has no analogue for it.
- **The readout row's uppercase data labels** — deliberate, above.
- **The rail's "Rooms" section and the Chats | Bots tabs** are August's own
  vocabulary; the reference has neither, and both are features rather than
  styling.
- **The pinned item keeps its preview line** (the last message). The
  reference's pinned row has only a title, but the preview is what tells the
  trader which thread is which.

