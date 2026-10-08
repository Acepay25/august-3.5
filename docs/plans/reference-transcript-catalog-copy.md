# Copy the reference transcript + catalog UI onto August — literally

Revised 2026-10-08 after a citation-by-citation review of the first draft against the
repo. **Sections marked ⟵ FIXED / ⟵ ADDED are the corrections**; every remaining
`file:line` was re-verified, not carried over. The draft's three blocking claims were
wrong and one stage shrank because of it.

Approved framing (unchanged): copy literally; expanders are never density-gated; no
system-telemetry HUD. A UI must not advertise a gesture that isn't wired, so each copied
control ships with its implementation in the same stage. Four copied controls have zero
backing repo-wide — `speechSynthesis`, `MediaRecorder`, `thumbsUp`, `feedbackRating`,
`webkitSpeechRecognition` return **zero matches** (re-checked: only `ThumbsUp`/`Mic`
icon exports in `components/shared/Icons.tsx:168,198`). Anything unbuildable renders
disabled with a tooltip naming the reason.

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
| Blob download | `ExportService.ts:162-174` |
| PDF page → canvas | `infrastructure/pdfTextExtractor.ts:44-56` (⟵ reused, not rewritten) |
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

## Stage 6 — Artifacts column, Content tiles, paged PDF preview, Download all

new `components/shell/ArtifactColumn.tsx`,
`components/modals/ImageViewerModal.tsx` (reuse),
`services/infrastructure/ExportService.ts`, `pdfjs-dist`

1. Data source is real, not invented: `Message.toolActions` (`types/message.ts:355`)
   persists each file creation with a human `label` and a `review` destination; notebook
   writes and `forge_tool`/`amend_memory` land there. ⟵ It is capped at
   `MAX_TOOL_ACTIONS = 50` per message (`utils/toolActions.ts:10`, applied `:23`), so
   **the column is a partial trail by design** — say that in its empty state rather than
   implying it lists every file ever made.
2. Artifact card per screenshot 171126: thumbnail tile, two-line label with a
   `Document · PDF` subtitle, folder icon, selected state (tinted border + tile).
   Subtitle from the file's real kind; identity is the human label, never the path.
3. Content tiles: square card, rendered first-page preview, bottom-left badge chip
   (`PDF` / `DOCX` / `MD`). ⟵ **C7** — **extract** `renderPageToDataUrl`
   (`pdfTextExtractor.ts:44-56`) into a shared helper rather than writing a second
   renderer; two PDF page renderers is how the two drift. Reuse its existing
   downscale-to-1400px (`:46`) so tiles and OCR pages render identically. Add the
   `Page N / M` badge and the full-height viewer from batch-one screenshots 6-7.
4. **Download all** is a real action. ⟵ **C8** — no zip library is present
   (`package.json`: no `jszip`/`archiver`/`fflate`/`zip`), and the draft correctly
   forbade adding one without checking. So: **sequential blob downloads** off the
   existing pattern at `ExportService.ts:162-174`. Chromium throttles programmatic
   multi-downloads after a handful of files — cap the batch, name the cap in the
   tooltip, and don't pretend 40 files will save in one gesture. Rendered in both places
   the reference shows it: column header and transcript.
5. DOCX gets an honest tile (icon + badge + size), not a fake preview — August cannot
   render a Word page, and a blank preview claiming to be one is the
   decorative-empty-state defect already rejected once.

---

## Stage 7 — docked detail panel with the reference toolbar

`components/shell/RightPanel.tsx` (callers), `hooks/useRightPanel.ts`, new
`components/shared/FileDetailView.tsx`, `components/skills/SkillDetail.tsx`,
`components/trade/TradeChatPanel.tsx`

1. Register through the existing `useRightPanel().register` contract; no second overlay
   mechanism.
2. Toolbar: `[preview|source]` toggle · human-readable title · `Copy` · `Maximize2` ·
   `X`. Preview = `MarkdownRenderer` (it already owns the math/money rewriting);
   source = `<pre>`. Reuse `SkillDetail`'s body rendering where it exists.
3. A third column is sanctioned: chart · conversation · detail, sized off `--panel-w`
   (`RightPanel.tsx:75`) and the `dockExpanded → lg:!w-1/2 xl:!w-7/12` rung at
   `TradeView.tsx:1112`. Below `lg` it degrades to the fullscreen presentation the
   shell already implements, so mobile never gets a third column it cannot fit.
   ⟵ `tests/dockExpandedLayout.test.ts:71,88,91` already pins this contract — keep it
   green rather than rewriting it.

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
   `loadSessions`' explicit rebuild (`:179-193`) on the next write. Prune dangling ids,
   and confirm the Agents rail tolerates foreign `s-…` ids in its own pin list rather
   than choking on them (it filters by its own roster today).
4. ⟵ **FIXED (C4)** — this was a one-of-three fix, not the fix. Two of the three
   deletion paths are in `fitToByteBudget` (`:233-271`), not `trimForStorage`:
   - `trimForStorage` (`:199-201`) `slice(-MAX_SESSIONS)` drops the oldest — after
     pinning, precisely the chats the user chose to keep. Replace with
     `fitToMaxSessions`: every pinned session plus the newest unpinned to 12, the
     pinned set itself capped at 10 so `MAX_STORED_CHARS` stays the real ceiling, and
     a pin that cannot be honoured **says so in the rail** rather than silently
     deleting a chat.
   - Pass 2 (`:257-263`) shaves the oldest entries of **every** session down to 10.
   - Pass 3 (`:266-269`) shifts whole oldest sessions.
   
   So pin-protection must be a **predicate both functions consult**: a pinned session
   is never the one Pass 2 shaves and never the one Pass 3 shifts. `fitToMaxSessions`
   alone still lets a pinned chat lose its history. Test: pin a session, exceed the
   byte budget, assert the pinned session still has its entries.
5. Search matches `title` + `symbol`; sort reuses `sortByName`'s recency↔name semantics
   (`AgentsView.tsx:441,855`). No unread/archived affordances until those fields exist.

---

## Stage 9 — skills catalog, copied from the Customize screen

`components/settings/tabs/SkillsTab.tsx` (2.9 KB today — thin),
`components/learn/LearnView.tsx`, `components/skills/SkillDetail.tsx`,
`services/learning/SkillMemoryService.ts`

1. Layout per screenshots 171304/171311: category column with a search icon · big serif
   title + one-line subtitle · top row of search field, refresh, gear, filled `Add`
   pill · `Installed` section label on a hairline rule running to the right edge ·
   two-column card grid · segmented collection tabs below that swap the grid.
2. Card = icon tile, bold name, one-line description truncated with an ellipsis **and a
   real recourse** (the last audit counted 138 `truncate` sites against 272 `title=`),
   trailing checkmark.
3. Every field already exists: checkmark ← `enabled` via `skillEnabledFlag`
   (suspension is `enabled:false` + `meta.suspendedAt`, **not** a fourth `SkillStatus` —
   do not derive it a second way). Collection tabs ← `SkillMeta.family` (or `kind`) as
   a real partition of the roster, so a tab is never an empty decorative group.
4. Refresh reuses `hooks/useCatalogReconcile.ts:16`; gear routes to the existing Skills
   settings; `Add` opens the real skill-draft path that `skill-approval-probe` drives —
   it must not become a sixth place to approve a draft, the exact IA defect the
   2026-10-07 audit named.

---

## Stage 10 — composer pill, dictation, interrupted notice

`components/trade/panels/ChatComposer.tsx`, `electron/preload.cjs`,
`services/providers/GenericProviderService.ts`,
`components/shared/ChatTranscriptRow.tsx`

1. Leading `+` exists as the attach menu (`:167`) — keep its two real items and match
   the reference's pill geometry (`rounded-bubble` 12px, hairline border, no shadow).
2. Footer line under the input: disclaimer left, model chip right. `StatusBar` already
   resolves the label — do not compute a second one.
3. **Mic needs a real decision at build time.** In Electron `webkitSpeechRecognition` is
   unreliable without Google endpoints, so dictation is `MediaRecorder` capture → a
   transcription call through `GenericProviderService`. ⟵ **C9** — **state the cost
   honestly**: that service implements three wire formats (`chat_completions`,
   `messages`, `responses`), all text. Audio has no path through any of them, so this
   is a **new wire format** (multipart or base64 audio input), not a reuse of an
   existing call, and no configured provider has a transcription shape today. It is the
   most expensive item in the plan and the only one with no local fallback. If the
   configured provider has no audio path, the mic renders **disabled with a tooltip
   naming the reason** — a wired control that explains itself, never a dead one.
4. Interrupted/failed run becomes an **in-flow** notice row with `Edit prompt` and
   `Try again`, reusing the `retryOf` re-dispatch (`chatTurnRunner.ts:759-771`);
   `ChatTranscriptRow.tsx:130`'s post-mortem retry is the precedent. The hover
   `RetryChip` stays for successful rows.

---

## Verification

- `npm run typecheck && npm run lint && npm run test`. ⟵ **C6** — add
  `npm run typecheck:electron` (`node --check` on `main.cjs`, `preload.cjs`,
  `sseParser.cjs`); Stage 10.3 edits `preload.cjs` and tsc cannot see `.cjs` files.
- New suites:
  - `tests/toolPayloadStore.test.ts` — budget refuses rather than evicts; the failure
    record survives a reload; `saveSessions`→`loadSessions` keeps `toolIds` and
    `workedMs`; and (⟵ 2.10) the refusal path under
    `NODE_OPTIONS=--no-experimental-webstorage`.
  - a fold case in the existing `pairToolLines` suite that also asserts the calling→done
    state flip still holds (`ToolActivityRow.tsx:50-53`).
  - a receipt-extractor case in `tests/harnessMarks.test.ts`.
  - a `fitToMaxSessions` case proving **both** deletion paths respect a pin: a pinned
    session is neither the one dropped by count nor the one shaved/shifted by the byte
    budget, and it keeps its entries after a budget overflow (⟵ C4).
  - a dock-path reload case proving `workedMs` survives with no `runStats` writer on the
    Chat rail (⟵ C3).
- `npm run render-probe` — the only gate that sees a rendered row. Counts rows per
  conversation, sweeps all six nav surfaces, asserts **every Learn and Journal control
  is live** (each press must change text, open an overlay, or route), so Stage 9's cards
  and Stage 5's action row are directly gated by it. Run it **alone** on an idle
  machine. ⟵ Stage 4 is now a tune, so row counts are not evidence about the table —
  compare Stage 4 against its screenshot instead.
- Settings → Data backup/export/import runs inside render-probe, so Stage 2.8's new key
  is covered there — but do the payload-store round-trip by hand once too, since the
  probe asserts the export succeeded, not that a 900 KB payload store survived it.
  ⟵ Same for Stage 5.3's `answerFeedback` key (C5).
- `npm run e2e` and `npm run skill-approval-probe` must stay green; Stage 9 touches the
  approval path the latter drives byte-for-byte.
- Manual in `npm run dev` with a real provider: run one desk-tool analysis, watch the
  block collapse at settle, **reload the page**, confirm the block is still there with
  its duration and that a tool row opens onto the actual payload. Then trigger a
  clipped result and confirm a receipt row pages through `readToolArtifact`. Open an
  artifact from the column and check the PDF preview's `Page N / M` against the real
  page count.
- One heavy gate at a time.
- Because this is a visual copy, static gates are not sufficient evidence. Each of
  Stages 4, 6, 7, 9 ends with a screenshot of the real app compared against its
  reference, reporting which specific differences remain rather than declaring a match.

---

## Commit shape

Ten commits, one per stage, each gated on its changed files before it lands. Stage 2 is
the first writing new persistent bytes, so it lands alone with the export round-trip
proven before Stage 3 starts. **Stage 5.3 is the second** (⟵ C5) and gets the same
export-discipline treatment in its own commit.

Flagged for your review **before build**, because they are product decisions wearing UI
clothes:
- **Stage 5.3** — a rating store, and its linkage into confidence calibration.
- **Stage 10.3** — a new audio wire format through `GenericProviderService` (⟵ C9).
