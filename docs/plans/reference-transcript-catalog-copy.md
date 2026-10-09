# Copy the reference transcript + catalog UI onto August — literally

Revised 2026-10-08 after a citation-by-citation review of the first draft against the
repo. **Sections marked ⟵ FIXED / ⟵ ADDED are the corrections**; every remaining
`file:line` was re-verified, not carried over. The draft's three blocking claims were
wrong and one stage shrank because of it.

Approved framing (unchanged): copy literally; expanders are never density-gated; no
system-telemetry HUD. A UI must not advertise a gesture that isn't wired, so each copied
control ships with its implementation in the same stage. Four copied controls have zero
backing repo-wide — `MediaRecorder`, `thumbsUp`, `feedbackRating`,
`webkitSpeechRecognition` return **zero matches** (re-checked: only `ThumbsUp`/`Mic`
icon exports in `components/shared/Icons.tsx:168,198`). Anything unbuildable renders
disabled with a tooltip naming the reason.

---

## Status (2026-10-09)

Stages 1-5 have SHIPPED: `c8c659c` (1), `ba30848` (2), `2064771` (3),
`6a49b3b` (4), `34077ea` (5.1, 5.2, 5.4, 5.5). Stage 5.3 (thumbs + the rating
store) was deliberately NOT built — it stayed flagged for review before build and
it stays flagged. Read-aloud is no longer "missing": `SpeakChip`
(`components/shared/chatChips.tsx:54-101`) exists now. The stage sections below
keep their original numbering; **C10-C15** record what a post-build review of this
plan found and how the remaining stages changed because of it. The Stage 6
section is a full rewrite — read C10 before reading it.

---

## Corrections applied to the original draft

**C1 — Stage 4's premise was false.** The draft said `MarkdownRenderer` overrides only
`pre` and `code`, so a model's table renders as a browser default. It does not:
`components/shared/MarkdownRenderer.tsx:136-150` already overrides `table`, `th`, `td`
**and** wraps them in a `my-3 overflow-x-auto overscroll-x-contain custom-scrollbar`
div with `w-max min-w-full`. Stage 4 is a **retune to screenshot 171126**, not an
addition. Writing the draft's rules would produce a duplicate override and a
render-probe that reports "no change" and passes vacuously.

**C2 — the draft inverted the two type tokens.** It asked for `text-ui-2xs` "the token
`index.css:232` already reserves for table headers." `index.css:232` reserves
**`--text-ui-xs`** ("axis ticks, table headers, counts"). `--text-ui-2xs` (`:250`) is
documented as a restricted decorative floor — "nothing new should reach for it without
a reason", "not a body-text size." The current `th` at `MarkdownRenderer.tsx:146`
already uses `text-ui-xs`, i.e. it was already correct and the draft would have moved
it to a smaller, contrast-riskier size.

**C3 — Stage 1.4 mapped a field nobody writes.** `runStats` exists
(`types/message.ts:269`) and `durationMs` at `:98`, but the only writers are
`hooks/useBotMailbox.ts:215` and `services/agents/botRoutine.ts:155` — the Chat rail.
`services/trade/chatTurnRunner.ts` never writes it, and `liveEntryFromMessage` is a
**one-way adoption from that rail** (`chatSessions.ts:305-311`). The "pipeline path"
would read a permanently-`undefined` field. Resolved in Stage 1 below: stamp it.

**C4 — Stage 8.4 fixed one of three byte-budget paths that delete a pinned chat.**
`trimForStorage` (`chatSessions.ts:199-201`) is real, but `fitToByteBudget` destroys
the same chats twice more: Pass 2 shaves every session's oldest entries down to 10
(`:257-263`) and Pass 3 shifts whole oldest sessions (`:266-269`). `fitToMaxSessions`
alone still lets both passes eat a pinned session's history. Pin-protection is now a
predicate **both** functions consult — see Stage 8.

**C5 — "Stage 2 is the only one writing new persistent bytes" was wrong.** Stage 5.3's
`answerFeedback` is a new store. Ordering still holds (Stage 5 lands later), but the
export discipline now applies to it in its own commit.

**C6 — `npm run typecheck:electron` was missing from verification**, and Stage 10.3
edits `electron/preload.cjs`. Per AGENTS.md, `tsconfig.json`'s include globs don't
match `.cjs`, so tsc cannot see that file: it is the exact class of break that passes
every static gate and only fails when a user launches the packaged app.

**C7 — Stage 6.3 would have written a second PDF renderer.**
`services/infrastructure/pdfTextExtractor.ts:44-56` already renders a page to canvas
with viewport scaling (`renderPageToDataUrl`, downscaled to ~1400px, `:46`). Extract
that instead of rewriting it.

**C8 — "Download all" needs its transport named.** No zip library is present
(`jszip|archiver|fflate|zip`: zero matches in `package.json`) — the draft's "check
before adding one" was correct, so it is sequential blob downloads. Chromium throttles
programmatic multi-downloads after a few files; state the limit rather than discovering
it in review.

**C9 — Stage 10.3's cost was unstated.** `GenericProviderService` implements three
wire formats — `chat_completions`, `messages`, `responses` — all text-only. Audio
neither fits nor smuggles cleanly through them. No configured provider has a
transcription shape today, so this is a **new wire format**, not a call reuse. It is
now explicitly flagged for review before build.

**C10 — Stage 6's data source does not exist.** This was the review's blocking
finding and it survives every re-check. The stage said "Data source is real, not
invented: `Message.toolActions` already persists each file creation with a human
`label` and a `review` destination." But `ToolAction` (`types/message.ts:398-413`)
is exactly `{ at, speaker, tool, ok, verb, label, review }` — **no bytes, no path,
no mime, no content, no filename**. It is a ledger entry describing that a
side-effect happened, not a file handle. And the trail is proposal-class only:
the writers (`useAnalysisPipeline.ts:1855,2311,2662`, `usePostMortem.ts`,
`notebookQuickSave.ts:70-74`, `verdictFinalizer.ts:543`) emit `forge_tool`
("DECLARATIVE — no code execution, ever"), `amend_memory`, `skill_draft`,
`skill_ingest`, `notebook_note` — none creates a PDF or a DOCX. Repo-wide, zero
PDF/DOCX generation exists (the only `application/pdf` hit is an `accept=`
attribute on a file input, `StrategiesManager.tsx:260`). So the column as written
builds cards whose thumbnails, `Document · PDF` subtitles, previews and downloads
have nothing behind them — a fabricated surface, i.e. the decorative-empty-state
defect this repo has already rejected once. **Stage 6 is rewritten below as a
review-destinations column.** The one honest file-like surface that does exist —
`notebook_note` labels like `lessons/reclaim-fades` whose bytes live in
`MemoryFilesService` — is the one card that opens real content, deep-linked by
name. The PDF/DOCX badges, the paged PDF preview and the file "Download all" are
**cut**, not deferred: they cannot be honestly built on data this app does not
have.

**C11 — `register` alone renders nothing.** Stage 7.1 said "register through the
existing `useRightPanel().register` contract". `register` (`useRightPanel.ts:130-132`)
only appends to the `docks` registry; the panel is rendered from `openIds`
(`RightPanel.tsx:62`; `open()` at `useRightPanel.ts:134-141`). A dock that is
registered but never opened mounts nothing — and every test would still pass.
Stage 7 now names both calls.

**C12 — the all-pinned byte ceiling was undefined.** Stage 8.4 protects a pinned
session from the three deletion paths, but nothing says what happens when every
session is pinned and the store is STILL over `MAX_STORED_CHARS`. `fitToByteBudget`
Pass 3 stops at `work.length > 1` (`chatSessions.ts:284-288`), so the natural
implementation of "never shift a pinned session" reaches a state where it cannot
trim anything, the save throws, and the transcript the user is looking at is the
one that gets lost. The stage now defines the last resort and the notice that
makes it visible.

**C13 — Stage 9's host surface was never named, and the gate follows the host.**
The stage listed `SkillsTab`, `LearnView` and `SkillDetail` without saying which
surface hosts the catalog, and render-probe's "every control is live" sweep covers
Learn and Journal only (`scripts/render-probe.cjs:1571,1611`). The reference
screenshots show the catalog under **Customize → Skills**, which in August is the
Skills settings tab (`components/settings/tabs/SkillsTab.tsx`). So the host is
named, and the probe gets a Skills sweep in the same commit — otherwise the
stage's central rule ("never an empty decorative group") is gated by nothing.

**C14 — Stage 10 bundled a capability with a fix.** 10.3 (dictation, flagged for
review, the most expensive item in the plan) and 10.4 (interrupted-run notice, a
small clear win reusing `retryOf`) shared a commit. The flagged product decision
dragged a fix behind it. They are separate stages now: 10.1+10.2+10.4 ship;
10.3 waits on the decision.

**C15 — the sticky payload write failure had no reader.** Stage 2.6 built
`getPayloadWriteFailure()` correctly modelled on `getNotebookWriteFailure()` — but
nothing reads it. The row-level "full result not kept · N chars" line
(`ToolActivityRow.tsx:119-122`) covers a CLIPPED result; a payload refused for
budget or quota leaves no id at all and degrades to the generic line, with the
quota/budget/streak record invisible. `memoryHealth.ts:281` is what makes the
notebook failure visible; the payload store now needs its equivalent — added as
Stage 2.11.

---

## What already exists (re-verified, so we reuse rather than rebuild)

| Reference element | August today |
|---|---|
| Collapsible activity block + elapsed time | `shared/AnalyzedRow.tsx` — `<details>`, auto-open while running, auto-collapse at settle |
| One hairline row per tool call | `shared/ToolActivityRow.tsx:30` `pairToolLines()` — pure, already exported |
| Raw tool payload | **Not discarded** — `services/analysis/toolArtifactStore.ts`: 40 artifacts / 400,000 chars (`:43`) / 30 min (`:46`), paged by `readToolArtifact(id, offset, limit ≤ 8000)` (`:153`) |
| Clip receipt embedded in what the seat sees | `utils/harnessMarks.ts:75` `clipReceipt`, read back by `findClipIn` (`:89`) |
| Resizable docked panel, tabs, hide-vs-close | `shell/RightPanel.tsx` + `hooks/useRightPanel.ts`; width published as `--panel-w` at `RightPanel.tsx:75` |
| Pinned + "Chats and tasks" + search + sort | `AgentsView.tsx:829` `rail-pinned`, `:850` the literal heading, `rail-search`, `:955` `conversations-show-more`; pins at `:151` `agent_pins_v1_<user>` |
| The conversation row itself | `AgentsView.tsx:223` `const Row` |
| Artifact/file identity | `Message.toolActions` (`types/message.ts:355`), appended via `utils/toolActions.ts:23`, capped at **50** (`:10`) |
| Relative time | `panels/ChatHistoryPalette.tsx:18` `relTime` (exported, shared with the dock header) |
| Segmented tabs, card grids | `Journal.tsx:290`, `TradeView.tsx:974`, `grid-cols-2` in `AgentsView.tsx:354` |
| Skill fields for a catalog | `SkillMeta`: `kind`, `family`, `coin`, `direction`, `regime`, `status`, `wins/losses/netR`, `enabled` via `skillEnabledFlag` |
| Blob download | `ExportService.ts:163` |
| PDF page → canvas | `infrastructure/pdfTextExtractor.ts:44-56` — private `renderPageToDataUrl`. **No PDF to feed it** (⟵ C10): kept for the upload/extract path only, NOT reused by Stage 6. |
| Icons | `Plus, Search, ArrowUpDown, Eye, Code, Download, Maximize2, FileText, FolderOpen, Mic, Copy, RotateCcw, Pencil, X, ThumbsUp, ThumbsDown` (`Icons.tsx:168,198`) |
| Honest-refusal row precedent | `ChatTranscriptList.tsx:130,138` — `imageOmitted` stub: "image not backed up (mime, KB)" |
| Hit-target floor | `index.css:351` `@utility hit-target` (24px min, enforced by render-probe) |

Genuinely missing: the expander, the aggregate line, duration-after-reload, the
always-visible action row, the Artifacts column, the paged PDF preview, voice/dictation,
read-aloud, a rating store, and a session list for Chart AI.

---

## Stage 1 — activity block: survives reload, names its work, always expandable

`services/trade/chatSessions.ts`, `services/trade/chatTurnRunner.ts`,
`components/shared/AnalyzedRow.tsx`, `components/trade/panels/ChatWorkTimeline.tsx`

1. Add `workedMs?: number` to `StoredChatEntry` (`:22`). Document the **asymmetry that
   makes this safe**: `sanitizeEntry` (`:145`) spreads `...e`, so a new **entry** field
   survives reload with no loader change — but `loadSessions` (`:179-193`) rebuilds each
   session field-by-field, so a new **session** field would be stripped on the next
   write. Put that sentence in the field's doc comment; it is the reason no loader
   change is needed and the next person will otherwise "fix" it.
2. Stamp it where the turn settles in `chatTurnRunner.ts`. **Name the site**: settle is
   not one line — `streaming: false` is written at `:668`, `:696`, `:709`, and again at
   `:908`, `:1063`, `:1175` (the last three are failure paths that patch the entry in
   place). Stamp `workedMs` in the same `patch` at each; the failure paths get it too,
   because a failed turn is exactly where the user most wants to see how long it ran.
3. `AnalyzedRow` takes an optional `settledSeconds`; precedence **live tick > frozen >
   persisted**. Never let a persisted number fight a running timer.
4. ⟵ **FIXED (C3)** — the mapping target now exists. `liveEntryFromMessage`
   (`:313`) maps `m.runStats.durationMs` → `workedMs`, which is real for Chat-rail rows
   written by `useBotMailbox.ts:215` / `botRoutine.ts:155`. For the **dock** path, Stage
   1.2 must additionally stamp `runStats` on the dock's own `Message` before the
   converter reads it — without that, the dock's block still has no duration after
   reload and 1.4 reads `undefined`. Verify with a dock-only reload test.
5. Title the block from real data: the human labels `pairToolLines` already yields
   (`order book`, `indicators`, `notebook recall`) plus whether a reasoning trace ran —
   `Read the chart, order book and notebook · 34s`. **No new model call.**
6. No density gate anywhere in this stage.

---

## Stage 2 — real payloads behind every tool row

`utils/harnessMarks.ts`, `services/analysis/DeskToolsService.ts`, new
`services/trade/toolPayloadStore.ts`, `services/trade/chatTurnRunner.ts`,
`components/shared/ToolActivityRow.tsx`, `services/infrastructure/ExportService.ts`

1. `utils/harnessMarks.ts`: add a receipt extractor beside `findClipIn` (`:89`)
   returning the `ta-…` id from `CLIP_RECEIPT_PREFIX` (`:129`). Never regex a marker in
   a component — `tests/harnessMarks.test.ts` fails on a hand-written marker.
2. At the results loop (`DeskToolsService.ts:~3474`, beside `digestToolResult` at
   `:3474`, matching `onToolEvent` at `:3419`) add an **optional** `onToolPayload`
   callback on the options interface at `:3187`. Do **not** widen `onToolEvent`
   (`:3164`): it also carries `calling…` (`:3419`), `already fetched` (`:3382`) and the
   guard line (`:3533`), none of which have a payload, and `deskToolStreamLoop` /
   `deskToolSelfHeal` tests bind the one-arg shape.
3. Payload = `{ id, name, label, ok, kept, total, text }`, `text = r.content` when the
   result was never clipped, else `''` — the id carries it.
4. Key on `r.toolCallId` (real: `:147`, `:2035`, `:2850`, `:3379`). **Never pair by
   index into `tools[]`**: `results` is `[...replays, ...extra, ...forged, ...core]`, so
   it diverges from the `calling` lines. Add `toolIds?: string[]` written in the *same*
   `patch` as `tools`, `''` for payload-less lines; renderer zips `ids[i] ?? ''`.
   ⟵ The draft cited `chatTurnRunner.ts:637` for the `tools` write; that line does not
   match. `tools: []` is initialized at `:831`, `:1011`, `:1150` — locate the real
   mutation site when writing the patch.
5. New `services/trade/toolPayloadStore.ts`, key `trade_tool_payloads_v1_<user>` — a
   **side store**, because `EXPORT_KEY_CAPS` caps `trade_chat_sessions_v1` at
   `EXPORT_RAW_KEY_CAP_BYTES = 512 * 1024` (`ExportService.ts:396`, applied `:412`) and
   sweeps the whole key when over; payloads inside entries would take the transcripts
   out of backups. 8,000 chars per payload (matching `readToolArtifact`'s page ceiling,
   `toolArtifactStore.ts:153`), 1,000,000 chars total.
6. **Refuse growth, never evict** — the `utils/memoryBudget.ts` rule. At high-water
   refuse the newest payload, keep every saved byte, and record a sticky
   `getPayloadWriteFailure()` modelled on
   `MemoryFilesService.getNotebookWriteFailure()`. A refused row reads
   `full result not kept · 41k chars`, the `ChatTranscriptList.tsx:130,138` precedent.
7. `ToolActivityRow`: a row becomes a `<details>` whenever a payload resolves — always
   available, never density-gated. Body matches the reference box: bordered,
   `max-h-40`, `overflow-y-auto`, `custom-scrollbar`, `font-mono`, `text-ui-dense`.
   **⟵ `max-h-40` will fight `.analyzed-row .reasoning-row-body { max-height: 22rem }`
   (`index.css:776`) on specificity** — scope the new rule so it wins deterministically
   rather than by source order. Label from `TOOL_LABELS`, never the raw name. For a
   clipped result: `readToolArtifact(id)` first, then the persisted copy, then the
   honest refusal line.
8. `ExportService.ts`: add `trade_tool_payloads_v1` to `RAW_LOCAL_STORAGE_PREFIXES`
   (`:299`) **and** `EXPORT_KEY_CAPS` (`:411`). Per the comment at `:483`, a raw owner
   missing from that list exports the wrong bytes, not merely failing to restore.
9. Most-feared failure, guarded explicitly: this store is written once per tool call
   inside a streaming loop, and a throwing `setItem` there is the exact
   silent-`console.warn` hole `saveSessions` still has. Catch, record, rethrow to the
   caller's existing handler; never let a payload write take down the transcript write.
10. ⟵ **ADDED** — put this store behind the same test env var as the rest:
    `NODE_OPTIONS=--no-experimental-webstorage` (see `HANDOFF_LEARNING_LOOP.md:281`),
    so the quota-refusal path is actually exercised rather than silently succeeding on
    a real `localStorage`.
11. ⟵ **ADDED (C15)** — **read** `getPayloadWriteFailure()` somewhere a trader sees,
    or the record is invisible and the guard is decoration. One honest line in the
    work timeline (`components/trade/panels/ChatWorkTimeline.tsx`) when a sticky
    failure exists: "Recent tool output was not kept — the store is full." A refused
    payload otherwise degrades to the generic "full result not kept" and nobody can
    tell a clip from a filled disk. Same commit as the store, not a follow-up.

### Stage 2R — the rollback story (closes the review's "missing" list)

The store is one new key, so there is no schema to migrate — but an UPGRADE into a
corrupt or over-quota store is a real path and it has to be defined, not
discovered:

1. **Corrupt payload store.** `readAll` (`toolPayloadStore.ts:81-95`) drops bad rows
   rather than throwing — keep that, and add a test that a hand-corrupted key (a
   string, an array of nulls, an array of objects without `toolCallId`) reads as
   empty and does NOT throw inside the streaming loop.
2. **Over-quota on first write.** The quota catch records and rethrows
   (`:159-170`). Verify the caller's handler (`chatTurnRunner`'s existing
   try/catch) survives a throwing `saveToolPayload` with the transcript write
   intact — the exact scenario 2.9 guards, pinned by test, not by assertion.
3. **The user-visible escape hatch.** Settings → Data already exports the key
   (`RAW_LOCAL_STORAGE_PREFIXES`, `EXPORT_KEY_CAPS`); state in the commit that the
   supported recovery is export → clear → import, and that `clearToolPayloads()`
   (`:184`) exists for it. Silence here is how a store becomes unfixable.

---

## Stage 3 — aggregate rows

`components/shared/ToolActivityRow.tsx` + the existing pairing suite in `tests/`

Fold consecutive same-label rows into one line — `order book ×4` — expanding to the
four payloads. **Consecutive-only**, so the fold never reorders what the seat actually
did. Note `pairToolLines` (`:30-59`) already groups by label into an `open` map and
already consumes consecutive pairs; the fold extends that grouping rather than
replacing it, and must not disturb the calling→done state flip at `:50-53`.
Test the fold as a pure unit before wiring it.

---

## Stage 4 — markdown fidelity ⟵ RE-SCOPED (C1, C2)

`components/shared/MarkdownRenderer.tsx` (`:136-150`), `index.css`

**This stage no longer adds table styling.** Tables already parse (`remark-gfm` at
`:102`) and already render with a header fill, hairline separators and a scroll
wrapper. It is a **retune to screenshot 171126**, and it must be reviewed against the
existing rule set, not written fresh:

- Keep `table`'s `w-max min-w-full` + scroll wrapper (`:137-142`) — that is the
  "many columns don't display" fix, documented in the comment at `:138-141`. Removing
  it to match a reference that only ever showed 3 columns would reintroduce the bug.
- Header row: keep `text-ui-xs` (⟵ **C2** — the correct reserved token,
  `index.css:232`). Only move to `text-ui-2xs` if the reference genuinely needs it,
  and if so say why in the commit, since `index.css:246-247` restricts that token.
  Match the reference's `zinc-800` fill against the current `bg-zinc-900/60`.
- Separators: reference uses `border-zinc-700`; current is `border-white/[0.04]`
  (`:149`) on `td` and `border-white/10` (`:146`) on `th`. Decide one hairline color
  and apply it to both.
- No outer box (current wrapper has `border border-white/[0.06]`, `:137`).
- Then audit the answer column's line-height/measure against the reference — the draft
  notes its body reads wider-set than August's `text-ui-caption leading-relaxed`.

Because this is now a tune, **state in the commit which pixels moved and why**, so the
render-probe's row counts are not mistaken for evidence about the table.

---

## Stage 5 — always-visible answer action row

`components/shared/chatChips.tsx`, `components/shared/ChatTranscriptRow.tsx`, new
`services/learning/answerFeedback.ts`, `services/trade/chatTurnRunner.ts`

Today the row is hover-released. ⟵ The opacity lives in the **chip primitives**
themselves — `chatChips.tsx:23` (`RetryChip`), `:34` (`CopyChip`), `:52` (the pin chip)
each carry `opacity-0 … group-hover/msg:opacity-100` — not only at
`ChatTranscriptRow.tsx:154`. Making the row permanent means editing those three class
strings; editing only the call site leaves the chips invisible.

Order per the reference: copy · read-aloud · thumbs up · thumbs down · regenerate ·
relative time.

1. Copy and regenerate exist (`CopyChip`, `RetryChip` + the `retryOf` re-dispatch,
   `chatTurnRunner.ts:759-771`).
2. **Read-aloud is a new capability**: `window.speechSynthesis` (Chromium/Electron).
   Toggle to stop; release the utterance on unmount. No new dependency.
3. **Thumbs are a new store**: `answerFeedback.ts` persisting
   `{ messageId, verdict, at }` per user. **Not decoration** — feed it to the existing
   `confidence_calibration` / `model_confidence_calibration` stores already in
   `RAW_LOCAL_STORAGE_PREFIXES` (`ExportService.ts:306-307`), so a rating changes what
   Health reports. ⟵ **C5** — add the new key to `RAW_LOCAL_STORAGE_PREFIXES` **and**
   `EXPORT_KEY_CAPS` in this same commit. If it can only be drawn and never read, it is
   a badge and should be cut instead.
4. Relative time: `relTime` at `panels/ChatHistoryPalette.tsx:18`.
5. Every button gets `@utility hit-target` (`index.css:351`; render-probe fails
   anything under the 24px floor, and the last audit left 13 offenders).

---

## Stage 6 — the review-destinations column ⟵ FULLY REWRITTEN (C10)

new `components/chat/ArtifactColumn.tsx`,
`services/trade/toolPayloadStore.ts` (one shared read path),
`services/learning/MemoryFilesService.ts` (read-only lookup),
`components/modals/ImageViewerModal.tsx` — **not used, dropped from this stage**

The reference screenshot shows an Artifacts column of file cards with `PDF` / `DOCX`
badges, thumbnail previews, a paged viewer and a **Download all**. **August cannot
build any of that honestly** — see C10: `ToolAction` carries label + review
destination, no bytes; nothing in this app creates a PDF or a DOCX; the only
`application/pdf` in the repo is a file-input filter. So this stage copies the
reference's *shape* and *density* over the trail that does exist. **The cut list is
part of the stage, not a deferral:** no PDF/DOCX badges, no thumbnail or first-page
preview, no `Page N / M` viewer, no file Download all. A badge over nothing is the
decorative-empty-state defect this repo has already rejected once.

1. **Data source (the real one).** `Message.toolActions` (`types/message.ts:355`) —
    aggregated across the active conversation's entries. Every field is real: `tool`,
    `verb`, `label`, `review`. The ledger is a partial trail by design
    (`MAX_TOOL_ACTIONS = 50` per message, `utils/toolActions.ts:10`); the empty state
    says so rather than implying a complete file list.
2. **Card, copied from the reference's geometry:** icon tile (tool class), bold human
    `label` on line one, `verb · review destination` on line two (real data — this is
    the "Document · PDF" subtitle's honest analogue), folder icon = "open where a
    human reviews this", selected state = tinted border + tile. Identity is the human
    label, never a path or a fake filename.
3. **The one card that opens real content.** A `notebook_note` action's label
    (`lessons/reclaim-fades`, `notebookQuickSave.ts:73`) names a real file in
    `MemoryFilesService`. Look it up by name and **open the actual notebook text** —
    this is the only surface in the column with bytes behind it, and it earns its
    preview honestly. If the file cannot be resolved (renamed, pruned), the card says
    so: "notebook file not found — review it in Settings → Memory". Never an empty
    box that looks like content.
4. **Tool rows re-use ONE read path.** `ToolActivityRow.resolvePayload` (payload →
    live artifact → honest refusal, `:107-123`) is module-private; **extract it to
    `services/trade/toolPayloadStore.ts` as `resolveToolPayload(toolCallId)`** and
    have both callers use it. A second resolution path is how the transcript and the
    column start disagreeing about what was kept.
5. **Download, only where bytes exist.** Per-card, and only for a resolved payload or
    notebook note: save the real text as `.txt`/`.md` via the existing blob pattern
    (`ExportService.ts:162-174`). The reference's "Download all" is cut — there is no
    set of files to download. If the per-card download cannot be wired honestly in
    this stage, cut it and let the card open the content instead; a download button
    that saves a fabricated file is worse than none.
6. **Proposal-class cards** (`forge_tool`, `amend_memory`, `skill_draft`) route to
    their `review` destination when that route exists (Settings → AI Models / Memory /
    Skills); where it does not, the destination text on the card IS the answer — a
    dead button is not.
7. Accessibility: the column is a listbox of cards; arrow keys move selection, Enter
    opens; focus order follows the reference's reading order; hit-target floor on
    every card (`index.css:351`).

---

## Stage 7 — docked detail panel with the reference toolbar

`components/shell/RightPanel.tsx` (callers), `hooks/useRightPanel.ts`, new
`components/shared/FileDetailView.tsx`, `components/skills/SkillDetail.tsx`,
`components/trade/TradeChatPanel.tsx`

1. ⟵ **FIXED (C11)** — register is not enough. `register` only adds the dock to the
   registry (`useRightPanel.ts:130-132`); the panel renders from `openIds`
   (`RightPanel.tsx:62`). This stage therefore calls **both**: `register(dock)` on
   mount and `open(dock.id)` when an artifact/notebook card is opened from Stage 6's
   column, plus `close()` on the column's deselect. No second overlay mechanism.
2. Toolbar: `[preview|source]` toggle · human-readable title · `Copy` · `Maximize2` ·
   `X`. Preview = `MarkdownRenderer` (it already owns the math/money rewriting);
   source = `<pre>`. Reuse `SkillDetail`'s body rendering where it exists.
3. ⟵ **FIXED (C12 geometry)** — the third column's space comes out of exactly one
   pane: **the chart**. The dock is `shrink-0` with `--panel-w` (`TradeView.tsx:1112`,
   `lg:min-w-[300px]`), so the detail panel joins it as the second `shrink-0` column
   (width from the same var family, clamped 320-480px), and the chart is the only
   flexible pane (`min-w-0`). **The floor is a test, not a hope:** with both panels
   open at `lg`, the chart keeps ≥ 320px and the document never scrolls sideways;
   below that the detail panel takes the shell's existing fullscreen presentation
   (`useRightPanel.ts:126-127`) rather than squeezing the chart to nothing.
   ⟵ `tests/dockExpandedLayout.test.ts:71,88,91` already pins this contract — keep it
   green rather than rewriting it, and add the two-panel floor case beside those.

---

## Stage 8 — conversation sidebar for Chart AI sessions

`components/agents/AgentsView.tsx`, new `components/shared/ConversationRow.tsx`,
`services/trade/chatSessions.ts`, `components/trade/panels/ChatHistoryPalette.tsx`

1. **Extract, don't rewrite**: lift `Row` (`AgentsView.tsx:223`) to
   `shared/ConversationRow.tsx` and use it verbatim in both places — two
   implementations of that row is how the surfaces drift.
2. List `ChatSession`s from the store's own subscription: `s.title`, preview = last
   entry's `text`, `relTime(s.updatedAt)`, working = any `streaming` entry.
3. Pin **without a schema change**: reuse `agent_pins_v1_<user>` (`AgentsView.tsx:151`,
   bare ids) — `s-…` ids slot in. A `ChatSession.pinned` field would be stripped by
   `loadSessions`' explicit rebuild (`:179-193`) on the next write. Verified since the
   review flagged it: the round-trip is a bare `JSON.parse`/`JSON.stringify`
   (`:153-155`, `:502`), so a foreign id survives untouched. What was NOT verified —
   and now must be, by test — is that the Agents rail tolerates the mixed list: its
   rows filter by their own roster today, so add a test rendering the rail with
   `['a-bot-id', 's-…', 'garbage']` in its pin list and assert every bot row still
   renders and no foreign id crashes the row menu. Prune dangling `s-…` ids on load.
4. ⟵ **FIXED (C4, C12)** — this was a one-of-three fix, not the fix. Two of the three
   deletion paths are in `fitToByteBudget` (`:233-271`), not `trimForStorage`:
   - `trimForStorage` (`:218-220`) `slice(-MAX_SESSIONS)` drops the oldest — after
     pinning, precisely the chats the user chose to keep. Replace with
     `fitToMaxSessions`: every pinned session plus the newest unpinned sessions up to
     `MAX_SESSIONS = 12` (`:118`).
   - Pass 2 (`:275-282`) shaves the oldest entries of **every** session down to 10.
   - Pass 3 (`:284-288`) shifts whole oldest sessions, stopping at `length > 1`.
   
   So pin-protection must be a **predicate both functions consult**, and the whole
   ceiling needs a defined order of sacrifice — because "never touch a pinned chat"
   without a last resort dead-ends at a throwing `setItem` that loses the live
   transcript:

   **Count.** The pinned set is capped at **10** — the derivation is `MAX_SESSIONS
   (12)` minus 2, so the newest two unpinned sessions always survive a pin spree. An
   11th pin is refused **in the rail** ("up to 10 pinned chats"), never silent.
   **Chars.** `MAX_STORED_CHARS = 3.5M` (`:239`) stays the real ceiling. Sacrifice
   order: (1) oldest screenshots of ANY session — an image can be re-taken, an
   argument cannot, which is Pass 1's existing doctrine (`:259-273`); (2) oldest
   entries of unpinned sessions; (3) whole oldest unpinned sessions; (4) **only when
   nothing unpinned remains**: the oldest entries of the OLDEST PINNED session — and
   the rail then says a pinned chat was trimmed to fit the cap. A pinned chat may be
   shaved, but never silently, and never wiped whole: Pass 3 keeps at least one
   session exactly as it does today.
   Test: pin a session, exceed the byte budget, assert the pinned session still has
   its entries; pin everything, exceed the budget, assert exactly one row appears
   naming the trim and the pinned session keeps its newest 10 entries.
5. Search matches `title` + `symbol`; sort reuses `sortByName`'s recency↔name semantics
   (`AgentsView.tsx:441,855`). No unread/archived affordances until those fields exist.

---

## Stage 9 — skills catalog, copied from the Customize screen

`components/settings/tabs/SkillsTab.tsx` (2.9 KB today — thin),
`components/learn/LearnView.tsx`, `components/skills/SkillDetail.tsx`,
`services/learning/SkillMemoryService.ts`, `scripts/render-probe.cjs`

⟵ **FIXED (C13) — the host surface is named: the Skills SETTINGS tab.** The
reference is the Customize → Skills screen, and August's only skills catalog is
`components/settings/tabs/SkillsTab.tsx`. `LearnView` hosts the *approval inbox*,
not the catalog — it must not become a second skill browser. And because the host
is Settings, **this stage must teach the gate to see it**: render-probe's
"every control is live" sweep covers Learn and Journal only
(`scripts/render-probe.cjs:1571,1611`), so add the matching Skills sweep
(`sweepSurface('Skills', n)`) and give the Skills nav entry a real `expect` root in
the same commit. Without that, the stage's central rule is ungated.

1. Layout per the 2026-10-09 references: big serif title + one-line subtitle · top row
   of search field, refresh, gear, filled `Add` pill · `Installed` section label on a
   hairline rule running to the right edge · two-column card grid · segmented
   collection tabs below that swap the grid (reference shows `Agentic-Trading` /
   `System`).
2. Card = icon tile, bold name, one-line description truncated with an ellipsis **and a
   real recourse** (the last audit counted 138 `truncate` sites against 272 `title=`),
   trailing checkmark.
3. Every field already exists: checkmark ← `enabled` via `skillEnabledFlag`
   (suspension is `enabled:false` + `meta.suspendedAt`, **not** a fourth `SkillStatus` —
   do not derive it a second way). Collection tabs ← `SkillMeta.family`
   (`SkillMemoryService.ts:93`). ⟵ **The empty-tab rule is now structural, not a
   promise**: tabs are COMPUTED from the family values actually present in the live
   roster, so an empty decorative group cannot be constructed. A family with one
   member is real data and still renders — the defect this avoids is a tab with
   ZERO skills, not a tab with one. Measure the roster first and say in the commit
   what the real family spread is.
4. Refresh reuses `hooks/useCatalogReconcile.ts:16`; gear routes to the existing Skills
   settings; `Add` opens the real skill-draft path that `skill-approval-probe` drives —
   it must not become a sixth place to approve a draft, the exact IA defect the
   2026-10-07 audit named.

---

## Stage 10 — composer pill, footer, interrupted-run notice ⟵ SPLIT (C14)

`components/trade/panels/ChatComposer.tsx`,
`components/shared/ChatTranscriptRow.tsx`, `services/trade/chatTurnRunner.ts`

1. Leading `+` exists as the attach menu (`:167`) — keep its two real items and match
   the reference's pill geometry (`rounded-bubble` 12px, hairline border, no shadow).
2. Footer line under the input: disclaimer left, model chip right. The composer
   already resolves its own label (`ChatComposer.tsx:110`, `provider.name ·
   formatModelDisplayName(provider.selectedModel)`) — do not compute a second
   one. The shell's bottom `StatusBar` was deleted (2026-10-10, the readouts were
   telemetry the user called noise), so nothing there can be reused.
3. Interrupted/failed run becomes an **in-flow** notice row — the reference's
   "Claude's response was interrupted." with `Edit prompt` / `Try again` — reusing the
   `retryOf` re-dispatch (`chatTurnRunner.ts:808-824`; the plan's old `:759-771`
   citation drifted as that file grew); `ChatTranscriptRow.tsx:130`'s post-mortem retry
   is the precedent. `Edit prompt` restores the last user message into the composer's
   draft (name the composer's real setter when writing it — if the composer has no
   draft API yet, that is this stage's work, not an assumption); `Try again` calls the
   same re-dispatch the hover `RetryChip` uses. The hover `RetryChip` stays for
   successful rows. This is a FIX, not a capability — it ships on its own commit and
   does not wait on anything below.

## Stage 10M — dictation ⟵ FLAGGED, NOT BUILDING (C9, C14)

`electron/preload.cjs`, `services/providers/GenericProviderService.ts`,
`components/trade/panels/ChatComposer.tsx`

**Held for a product decision.** In Electron `webkitSpeechRecognition` is unreliable
without Google endpoints, so dictation would be `MediaRecorder` capture → a
transcription call. The cost is stated plainly: `GenericProviderService` implements
three wire formats (`chat_completions`, `messages`, `responses`), all text. Audio has
no path through any of them, so this is a **new wire format** (multipart or base64
audio input), not a reuse — the most expensive item in this plan and the only one with
no local fallback. If and when it is approved: if the configured provider has no audio
path, the mic renders **disabled with a tooltip naming the reason** — a wired control
that explains itself, never a dead one — and `npm run typecheck:electron` is part of
the gate, because Stage 10M edits `preload.cjs` and tsc cannot see `.cjs`.

---

## Verification

- `npm run typecheck && npm run lint && npm run test`. ⟵ **C6** — add
  `npm run typecheck:electron` (`node --check` on `main.cjs`, `preload.cjs`,
  `sseParser.cjs`); Stage 10M edits `preload.cjs` and tsc cannot see `.cjs` files.
- New suites:
  - `tests/toolPayloadStore.test.ts` — budget refuses rather than evicts; the failure
    record survives a reload; `saveSessions`→`loadSessions` keeps `toolIds` and
    `workedMs`; and (⟵ 2.10) the refusal path under
    `NODE_OPTIONS=--no-experimental-webstorage`. ⟵ **2R adds**: a hand-corrupted key
    (string / nulls / missing `toolCallId`) reads empty without throwing, and a
    throwing `saveToolPayload` never takes the transcript write down.
  - a fold case in the existing `pairToolLines` suite that also asserts the calling→done
    state flip still holds (`ToolActivityRow.tsx:50-53`).
  - a receipt-extractor case in `tests/harnessMarks.test.ts`.
  - a `fitToMaxSessions` case proving **both** deletion paths respect a pin: a pinned
    session is neither the one dropped by count nor the one shaved/shifted by the byte
    budget, and it keeps its entries after a budget overflow (⟵ C4) — plus the
    all-pinned ceiling case (⟵ C12): every session pinned, still over budget, exactly
    one rail notice, the oldest pinned chat keeps its newest 10 entries.
  - a `resolveToolPayload` case (⟵ Stage 6.4): payload text wins, live artifact second,
    refusal line last — the SAME answers the transcript rows show, from one function.
  - a dock-path reload case proving `workedMs` survives with no `runStats` writer on the
    Chat rail (⟵ C3).
  - ⟵ **Stage 8.3**: the Agents rail renders with `['a-bot-id', 's-…', 'garbage']` in
    its pin list.
- `npm run render-probe` — the only gate that sees a rendered row. Counts rows per
  conversation, sweeps all six nav surfaces, asserts **every Learn and Journal control
  is live** (each press must change text, open an overlay, or route). ⟵ **C13** —
  Stage 9 adds the Skills sweep in the same commit. Stage 6's column is a new
  interactive surface on the Trade dock and must be swept the same way: select a
  card, assert the detail opens — a card that cannot open is the dead control the
  probe exists to catch. Run it **alone** on an idle machine. Stage 4 was a tune, so
  row counts are not evidence about the table — compare Stage 4 against its
  screenshot instead.
- **Accessibility pass (⟵ closes the review's "missing" list).** Stage 6's column,
  the tool-row expanders, Stage 7's detail panel and Stage 10's notice row are four
  new interactive surfaces. Each needs: a named control (`aria-label` naming what it
  does), keyboard operation (Enter/Space, arrow keys in the column's listbox), a
  focus-visible indicator that survives Tab focus, and screen-reader text that says
  what happened ("opened notebook note lessons/reclaim-fades"). render-probe already
  reads back the computed focus indicator on editable fields — extend the same read
  to the column's cards.
- Settings → Data backup/export/import runs inside render-probe, so Stage 2.8's new key
  is covered there — but do the payload-store round-trip by hand once too, since the
  probe asserts the export succeeded, not that a 900 KB payload store survived it.
  ⟵ Same for Stage 5.3's `answerFeedback` key (C5) if it is ever built.
- `npm run e2e` and `npm run skill-approval-probe` must stay green; Stage 9 touches the
  approval path the latter drives byte-for-byte.
- Manual in `npm run dev` with a real provider: run one desk-tool analysis, watch the
  block collapse at settle, **reload the page**, confirm the block is still there with
  its duration and that a tool row opens onto the actual payload. Then trigger a
  clipped result and confirm a receipt row pages through `readToolArtifact`. Open a
  `notebook_note` card and confirm it opens the REAL notebook text (or the honest
  "not found" line) — that is Stage 6's whole bar.
- One heavy gate at a time.
- Because this is a visual copy, static gates are not sufficient evidence. Each of
  Stages 6, 7, 9 ends with a screenshot of the real app compared against its
  reference, reporting which specific differences remain rather than declaring a match
  — and for Stage 6 that means reporting the **cut list as a difference**: no
  PDF/DOCX badges, no page previews, no file Download all, because there are no files.

---

## Commit shape

Stages 1-5 shipped as five commits (`c8c659c`, `ba30848`, `2064771`, `6a49b3b`,
`34077ea`). **Stage 5.3 was never built and stays flagged.** Remaining, one commit
each, gated on its changed files:

1. **2.11 + 2R** — the payload-failure line the trader can see, and the rollback
   story (corrupt key, quota rethrow, export→clear→import). Small; lands first so
   Stage 6 builds on a store whose failure mode is visible.
2. **6** — the reframed review-destinations column, `resolveToolPayload` extracted to
   the one read path, a11y contract, render-probe sweep, screenshot vs the reference
   with the cut list named.
3. **7** — the detail panel (register + open + the chart floor test).
4. **8** — `fitToMaxSessions` + the pin predicate in both byte passes + the mixed
   pin-list rail test.
5. **9** — the Skills settings catalog + the probe's Skills sweep.
6. **10** — composer pill, footer, interrupted-run notice.
7. **10M** — held. Not to be committed until the product decision on a new audio wire
   format is made.

Flagged for your review **before build**, because they are product decisions wearing UI
clothes:
- **Stage 5.3** — a rating store, and its linkage into confidence calibration.
- **Stage 10M** — a new audio wire format through `GenericProviderService` (⟵ C9).
