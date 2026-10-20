# E-52 — The transcript redesign: what the desk is doing, in the open

**Status:** LANDED — **all eight phases committed 2026-10-21**
(`implementation-record.md` §15–§22). The §0 scan below describes the tree
BEFORE this work and is kept as written, because it is the measurement the
plan was built on: `utils/turnStatus.ts` and `utils/toolKinds.ts` did not
exist, `Message.toolEvents` did not exist, and the Chat surface's tool rows
never paired a call with its result. See §3 for what this pass did **not**
close, and §15–§22 of the record for the landing, phase by phase.
**Owner:** the trader. **Covers:** **O-131** (the transcript says that work
happened, not what work), and the doctrine's *one home per concern* rule.
**Adjacent to, and deliberately not fixing:** **O-56 / E-39** — the *default*
tier for a trade decision is `low`. This proposal does not change that
default; it makes the tier **visible on the answer**, which is the half of
E-39 a UI can honestly do. The other half is the schedule in
`services/providers/reasoningControls.ts`, and that is a separate ruling.
**Reference:** the DeepSeek Harness transcript and the Cursor/Claude chat
surfaces (fifteen screenshots, 2026-10-20).
**Depends on:** nothing. **Blocks:** nothing.
**Written:** 2026-10-21 · working tree at `e6174ec1`.

> Every `file:line` below was read at the tip named (`e6174ec1`, the commit
> before the first phase). Where a claim is a claim about a *file* rather than
> a behaviour, the line is the one that proves it.
>
> **The symbol is the durable anchor; the line is a snapshot.** The tree moves
> while a plan is written, and this corpus was written across a whole day of
> concurrent work. Every claim in §2 names a symbol as well as a line, and
> each phase re-measures `docs/app-flow.md` against the tree as it stands then
> (`npm run check-flow-doc-anchors`).

---

## 0. The scan — what August's transcript says today

**Eighteen gaps, in five families.** The reference's transcript is not
prettier than August's; it is more *honest* about what the desk is doing.

### 0.1 The status line says that work happened, not what work

| # | gap | evidence at `e6174ec1` |
|---|---|---|
| **G-1** | The running label says nothing about the activity: a turn reads "Analyzing · 25s" whatever the desk is doing. | `components/shared/AnalyzedRow.tsx:78` (`const label = running ? 'Analyzing'`) |
| **G-2** | The running row's rotating trader tip competes with the activity for the same line — the one place that could say what is happening says a platitude instead. | `components/shared/ReasoningRow.tsx:126` (`nextTip(getActiveUsername(), tipSlot)`), `:148` (`Tip: {rawTip}`) |
| **G-3** | "Didn't think" and "not shown" are indistinguishable: a row that has no trace and a row whose trace is hidden look the same. | `components/shared/ReasoningRow.tsx:65` (a blank trace renders as an empty row) |

### 0.2 The tier never reaches the answer

| # | gap | evidence at `e6174ec1` |
|---|---|---|
| **G-4** | The effort a turn ran under is resolved, used, and then **thrown away**: the executor's outcome carried usage and usage calls, never the tier, so no row could say which tier produced it. | `services/trade/toolTurn.ts:107` (`type InnerOutcome = Omit<ToolTurnOutcome, 'usage' \| 'usageCalls'>`) |
| **G-5** | `onWireAudit` is declared and never supplied — the one hook that could report what actually went on the wire. | `hooks/useAnalysisPipeline.ts:328` (`onWireAudit?: (entry: WireAuditEntry) => void;`) |
| **G-17** | `Message.reasoningProcesses` is a lane nothing writes: the debate engine that filled it is gone, and the type still promised it. | `types/message.ts:163` (`reasoningProcesses?: Record<string, string>;`) |

### 0.3 A step has no kind, and its output is a bare block

| # | gap | evidence at `e6174ec1` |
|---|---|---|
| **G-6** | Every step in the transcript wore the same wrench, so a READ and a WRITE looked identical — a trader could not tell what the desk had **done**, only that it had done something. The kinds existed nowhere: the tool vocabulary was 40 labels in one service's private map. | `services/analysis/DeskToolsService.ts:732` (`const TOOL_LABELS: Record<string, string>`) |
| **G-7** | The tool output opened onto a bare `<pre>` — no header, no hint of what the bytes are. | `components/shared/ToolActivityRow.tsx:187` (`<pre className="tool-row-output">`) |
| **G-14** | A **second** disclosure mechanism: the automation card's reasoning was a `<button>` plus a grid-collapse `<div>`, while the transcript's rows were native `<details>`. Two mechanisms, two keyboard behaviours, two looks — and the card's was the older one. | `components/automation/AutomationRunCard.tsx:138` (the button), `:141` (`<div className={`collapsible-content …`) |

### 0.4 The trail does not work in both homes

| # | gap | evidence at `e6174ec1` |
|---|---|---|
| **G-8** | The tool expander was dock-only: the Chat surface recorded the tool lines but **not the payload id**, so its rows could never open onto the real output. | `components/shared/ChatTranscriptRow.tsx:17` ("`toolLines` is live-only") |
| **G-9** | The Chat surface kept only the last **8** tool lines — a turn's trail, truncated to a tail. | `services/trade/chatSurfaceTurn.ts:177` (`export const MAX_LIVE_TOOL_LINES = 8;`) |
| **G-10** | The comment that said "live-only" cited `verdictFinalizer.ts` — a file deleted with the debate engine. The claim was false twice over: the field is not nulled, and the trail was never complete. | `components/shared/ChatTranscriptRow.tsx:18` ("turn settles (`verdictFinalizer.ts`)") |
| **G-18** | `docs/app-flow.md` claimed the reasoning deltas go to `saveThinkingBatch`. Neither `chatTurnRunner` nor `useAnalysisPipeline` does: the trace rides on the row, and `saveThinkingBatch` is the restore/migration path. | `docs/app-flow.md:440` (the stale row) |

### 0.5 The surface around the transcript

| # | gap | evidence at `e6174ec1` |
|---|---|---|
| **G-11** | The Chart AI dock had **no** jump-to-latest at all: a trader reading up the transcript had no way back to the answer that was still arriving, while the Chat surface had a pill. | `components/trade/TradeChatPanel.tsx:1073` (the dock's scroller — no control) |
| **G-12** | A long bot turn is a wall of transcript: every thinking row, every tool row and every side-effect row in one column. | `components/agents/AgentsView.tsx` (the thread renders every row inline) |
| **G-13** | `ThinkingModal` was an **orphan**: a focus trap, an `aria-modal`, a test — and no importer anywhere in the app. A modal nobody had ever opened, reading as if the app had one. | `components/analysis/ThinkingModal.tsx:16` (the component), and no importer anywhere |
| **G-15** | Per-provider thinking is joined flat: the traces of several seats are one blob, and which seat thought what is unreadable. | `types/message.ts:162` (`thoughtProcesses?: Record<string, string>;`) |
| **G-16** | No catalogue of the desk's tools: Settings named **six** of the forty ("web search, funding/OI, order book, liquidations, BTC context, session timing"), and the ones nobody names are the ones that write. | `components/settings/tabs/GeneralTab.tsx:74` (`title="Desk Tools"`) |

---

## 1. The five owner rulings

The plan was approved with five questions put to the trader. All five are
answered, and the answers are the shape of the work.

| # | question | ruling |
|---|---|---|
| **R-A** | The status line's activity label — derived from what the desk is actually doing, or a model call that names it? | **Derived.** No model call, no prompt change: the desk already writes a digest line per call, and the label is read off it. A model call to describe a line the app already wrote would be a second source of truth for the same fact. |
| **R-B** | Should the effort tier land on the answer? | **Yes.** The tier a turn ran under is a fact about the answer, and the answer's own row is where a trader looks for it. |
| **R-C** | Build the agent launch list? | **Yes — and it is the LAST phase**, because it needs the step kinds (Phase 3) and the status line (Phase 1) to be worth anything. |
| **R-D** | The reference's file/artifact viewer — build it? | **No, defer.** August's tool output is **text**, not files: a `read_tool_output` returns a string the transcript already renders. A viewer for files August does not have would be a viewer for nothing. |
| **R-E** | The FAB's progress ring — a real percentage, or indeterminate? | **Indeterminate.** A desk turn has no denominator anyone could honestly draw: the model may call three tools or forty. A ring that claimed "60 % done" would be a number the app invented. |

---

## 2. The eight phases

Each phase is one commit, each with its gate, and the phases that can be
independent are.

| # | phase | lands | gate |
|---|---|---|---|
| **1** | The status line names the activity | `utils/turnStatus.ts` + `utils/toolKinds.ts` (new), the running row, the thinking row | vitest, tsc, lint, build, render-probe, anchors |
| **2** | The tier lands on the answer | `types/provider.ts` owns `ReasoningEffort`; the outcome carries the tier; the answer's row carries a tier chip | vitest, tsc, lint, build, render-probe, anchors |
| **3** | A step has a kind, and there is one disclosure | the kind map, the kind sentence, `components/shared/Disclosure.tsx` (new) | vitest, tsc, lint, build, render-probe, anchors |
| **4** | The trail works in both homes | `Message.toolEvents` + `Message.toolIds`; the Chat surface records the id it already saved | vitest, tsc, lint, build, render-probe, anchors |
| **5** | One way back to the newest row | `components/shared/JumpToLatestFab.tsx` (new), mounted by both homes | vitest, tsc, lint, build, render-probe, anchors |
| **6** | The launch list and the read-only agent card | `components/shared/DetailModal.tsx` (new, moved from the orphan) | vitest, tsc, lint, build, render-probe, anchors |
| **7** | The catalogue of what the desk can call | `components/settings/tabs/DeskToolCatalogue.tsx` (new) | vitest, tsc, lint, build, render-probe, anchors |
| **8** | The plan corpus | this file, `O-131`, the index, the record | anchors, lint |

**Phase 6 depends on 1 and 3; phase 7 depends on 3; phase 8 depends on all.**

---

## 3. What this pass does NOT close

Stated here so the register is not read as more than it is.

- **G-3** ("didn't think" vs "not shown") is **partly** closed: the thinking row
  now names the *trace* rather than the turn, so a row that is closed is
  visibly closed. But a row that has **no** trace and a row whose trace the
  model withheld are still the same shape. The honest fix needs a marker the
  provider sends, not a UI decision.
- **G-5** (`onWireAudit` never supplied) is **not** closed. The hook is still
  declared and still unsupplied: it is the seam for a wire-audit panel, and
  building that panel is a separate proposal.
- **G-12** (a long bot turn is a wall) is **not** closed. The kinds and the
  one disclosure make the wall legible; they do not shorten it. Folding a long
  turn is a behaviour change with its own trade-offs, and it did not earn its
  risk in this pass.
- **G-15** (per-provider thinking joined flat) is **not** closed. The trace is
  now read through one seam (`utils/traceText.ts`) instead of two, which is
  the precondition; the per-seat separation is the next step.
- **R-D** (the file/artifact viewer) is **deferred by ruling**, not closed.
- **O-56 / E-39** — the *default* tier for a trade decision — is untouched.
