# Workstream 1 — status / handoff

Read first; don't re-explore what's recorded. Branch `workstream1-trade-review`
(from `6e81c50`), never pushed, commit by explicit paths. Tip green (measured from
the committed tip `26cccaa`, runner output not a notification): full suite
**exit 0, 475 files passed | 1 skipped (476)**, `tsc --noEmit` 0, eslint 0 errors,
`vite build` 0, skill-approval probe 25/25.
**Remaining in order: step 10** agentsSurface flake rate (10 solo + 1 under load)
→ **step 11** Step B read-only audit into `docs/plans/` + STOP. Both were reached
out of room this run, not blocked. Also open: a test for the
`ChatTranscriptList` "image not backed up" branch (untested, noted above).

## Done
| commit | item |
|---|---|
| `cae8293` | carried-over three (typeRamp `text-[10px]`→`text-ui-xs`; systemIntelligenceUi mock) |
| `38872eb` | HTF bar state, MTF premium/discount, sweep reversals (+A4 keys, +A3 queue guard, same file) |
| `bbaae74` | Phase 0 `approveSkillDraft` read-back + slug-collision fix |
| `7ecefe3` | A1 `skill_drafts_v1` + `learning_proposals_v1` registered; scan hole closed |
| `9c679b8` / `121bd1d` | A5 one `CLAUSE_MIN_LENGTH=12` / A3 read-back+null, empty-slug reject |
| `a6e007e`,`e62051a` | A7 pass 1+1b: **4 of 4 approval cases green in the app** (15/15) |
| `724882a` | mock emits a scripted `propose_skill`, opt-in; flag-off proven on both probes |
| `ce637f9` | named `no-skills-folder` result (guard was live, not dead) |
| `03a3bfe` | supervisor override no longer reports "approved" when nothing wrote |

## A2 step 0 — ANSWERED: contradiction is NOT the same bug
`beliefChallenge.ts:119` stores `{slug, contradictions}`; `contradictionSweep.ts:116`
stores `{pair:[a,b]}` — **no clause text**, nothing mechanical to apply (matches the
comment at `tests/skillSupervisor.test.ts:213`). So **A2 is rescope-only**; leave
`contradiction` Dismiss-only. `revise_skill` is the only clause-payload writer
(`DeskToolsService` → `payload:{source:'model:desk',ifCondition,thenAction,predicate}`)
and `applyProposalRewrite` (`skillSupervisor.ts:352`) reads only `verdict.enhanced`,
so those clauses are dropped on every path today.

## A2 — SLICED, committing each green slice with its caller in the same commit
**Slice 1 DONE** (`e2dd23d`): `applyRescopeProposal(slug, clauses, username)` in
SkillMemoryService (validateIfThen fail-closed, find by slug, replace predicate —
dropped when the rewrite carries none — then READ BACK the parsed file), wired into
`LearningQueuePanel` (APPLYABLE + payload branch). Red first: 2 new tests failed on
"no Apply button", the 4 existing passed; green after. `coachThread.test.tsx:100`
still passes untouched because CoachThreadPanel is not yet wired — the contract
rewrite moves to slice 2 with that panel, so every commit is independently green.
**Slice 4 DONE** (`9f1ec9e`): `SupervisorStream` now consumes
`overrideApproveSkill`'s return and shows the named refusal on the row
(`supervisor-override-note-<id>`), including the `null` = no draft snapshot case.
Copy lives in `skillApproval.skillIngestOverrideNote` beside `skillApprovalToast`.
New file `tests/supervisorOverrideFeedback.test.tsx` (no existing suite rendered
`SupervisorStream`). Panels were done in slice 2.

**Slice 5 DONE** (`86ce021`): `scripts/probe-skill-approval.cjs` gained case 5
in the REAL app — seed the live skill through the Coach thread, seed the exact
`revise_skill` proposal row, press `coach-proposal-apply-<id>`, then assert the
skill FILE BYTES (1023 → 1063: new clause in, old clause and its prose line out,
one file not two, row consumed). Case 5b presses a below-bar re-scope and asserts
`/below the bar/` in `document.body.innerText`, the row STILL queued, bytes
unchanged. 25/25 checks, 2 pageErrors — both the probe's own case-4 sabotage.
**Probe fact paid for:** `page.addInitScript` lives for the whole page, so case 4's
blanket `setItem` block silently broke case 5's prerequisite write (it "failed"
because the probe had destroyed its own setup). It is now gated on a
`probe_block_notebook` flag that case 4 sets and clears.
**Next:** step 9 = the mechanical registration + export/restore byte equality
(pre-flight ALREADY measured, see the table below — the one decision it needs is
`trade_chat_sessions_v1`) → step 10 agentsSurface flake rate (10 solo + 1 under
load) → step 11 Step B read-only audit into `docs/plans/`, then STOP for approval.
Contradiction stays Dismiss-only: `beliefChallenge.ts:119` stores `{slug,
contradictions}`, `contradictionSweep.ts:116` stores `{pair:[a,b]}` — no clauses.

## Harness notes — copy these, do not re-explore
- **Panel tests** (`learningQueuePanel.test.tsx`, `coachThread.test.tsx`): mock
  `../services/learning/SkillMemoryService` wholesale with `vi.mock` +
  `vi.hoisted` fns returning `{ applied: true }`; seed through the REAL
  `queueLearningProposal(..., USER)` and pin the active user with
  `localStorage.setItem(LAST_ACTIVE_USER_KEY, USER)` (both panels read
  `getActiveUsername()`, not a prop). Assert via `data-testid`
  (`coach-proposal-apply-<id>`, `coach-proposal-error-<id>`,
  `proposal-review-state`). A press that fails is async: `await
  vi.waitFor(() => screen.getByTestId(...))` BEFORE reading the row, or you assert
  on the still-rendered "Applying…" state.
- **Real notebook tests** (`skillApprovalRoundTrip.test.ts`,
  `learningQueueApply.test.ts`): mock ONLY
  `../services/infrastructure/PreferencesService` onto an in-memory `store`
  object + `await initMemoryFiles(USER)` in `beforeEach`. Force a declined ingest
  by emptying harness folders: `getMemoryFiles().folders = [{id:'custom',
  name:'my-notes'}]` → `no-skills-folder`.
- **Component that consumes a service return** (`supervisorOverrideFeedback.test.tsx`):
  also mock `../services/providers/GenericProviderService` (3 fns) or the
  supervisor import drags the transport in; build rows with
  `supervisorStore.pushEvent({phase:'deciding', itemKind:'skill', itemId,
  draftSnapshot}) + setDecision(id, {verdict:'rejected', reason, atMs})` and
  `supervisorStore.__resetForTests()` per test.
- **Targeted runs**: `npx vitest run tests/<a> tests/<b>` (NO `--reporter=basic` —
  this vitest has no such reporter and it fails at startup).
  Slice suites: `coachThread learningQueuePanel learningQueueApply
  skillApprovalRoundTrip skillSupervisor supervisorOverrideFeedback`.

**Slice 2 DONE** (`cd43b0d`): CoachThreadPanel wired for rescope + **contract
rewritten** in `coachThread.test.tsx` (old line 100 asserted "rescope gets
Dismiss only" — inverted for rescope, kept for contradiction). The four appliers
now return `ProposalApplyResult` (`{applied:true}` | `{applied:false,reason,error?}`)
instead of `boolean`, so a refusal names WHOSE reason it is: `utils/learningQueue.ts`
owns the union, the copy (`proposalApplyFailureMessage`) and
`APPLYABLE_PROPOSAL_KINDS` — both panels read that one list (two local sets is how
slice 1 left one panel wired and the other not). `skillSupervisor.ts:429-431`
gates on `.applied`. Reasons: `no-target`/`unreadable`/`no-clauses`/`below-bar`/
`challenger-blocked`/`not-written`/`write-failed`. Red first: 4 new/rewritten
tests failed (3 coach + 1 queue), 11 existing passed.

**Slice 3 DONE** (`22adc60`): `applyProposalRewrite` now takes the clauses the
PROPOSER stored FIRST (delegating to `applyRescopeProposal`, the same call the
human's Apply makes, so the two surfaces cannot land different wordings of one
proposal) and falls back to `verdict.enhanced` only when the row carries none.
An `approve` verdict on a clause-carrying rescope now applies (it used to be
meaningless); the judge's prompt line changed to say so, because telling it
"'approve" does nothing here, enhance with your own wording" made it write a
re-wording this path then ignored. Red first: 2 supervisor tests failed (stored
clauses ignored), 22 passed. Full path
`revise_skill → queue → approve → skill updated` is in
`skillApprovalRoundTrip.test.ts` against the real notebook, asserting FILE BYTES.
**Bug that test caught:** a re-scope moved the front matter and left the body's
`**My rule:** when <IF>, I <THEN>` line (`SkillCraftService.ts:79`) reciting the
OLD trigger — the file claimed two triggers, and the prose is what a seat reads
back. `syncSkillRuleLine(meta)` (SkillMemoryService) now moves it, called from
both apply paths. SWEEP RESULT FOR THE OTHER TRIGGER WRITERS — see decision 3
below: none of them goes around the prose line.

## RUN RULES (user-set, this branch)
- Red first for every behavior change: run the new/rewritten test, confirm it
  fails FOR THE RIGHT REASON, quote the counts. Keep the export and its caller in
  ONE commit so every tip is independently green.
- Commit by explicit paths, one commit per item, message names the CONTRACT change
  when a test's meaning is inverted. Never push.
- Targeted suites per slice; ONE full suite + lint + build at the end of a run,
  reported from the runner (exit code + summary line), measured from a committed
  tip.
- Context economy: grep over whole files, no screenshots unless a check fails, no
  re-exploring what this file records. Harness notes stay current.
- Hard stops: a feature-shape question is the user's; a silent swallow of a failed
  write is never acceptable; if a criterion cannot be met, report it unmet with the
  measurement. Step B audit ends in a STOP for approval.

## DECISIONS (user, 2026-10-05)
1. `trade_chat_sessions_v1` — back it up WHOLE, WITHOUT image bytes. Export emits a
   placeholder object per image (exists + size + type); text, order and metadata
   stay intact. The transform touches the EXPORT COPY ONLY, never the live key.
   Restore must render normally and show "image not backed up" where an image was —
   no crash, no broken `<img>`. Fail visibly: if the key is still over a set byte
   cap after stripping, SKIP it and show a notice in the export result; no silent
   truncation. Cap recorded below. Test with a real session carrying a large image:
   export, restore, text identical, placeholder present, export under cap, live key
   byte-untouched. Do NOT change `trimForStorage` or the write path this pass —
   "bound trade_chat_sessions bytes at write time" goes to the backlog.
2. `harness_settings_v1` — NOT in the raw list (its owner touches Preferences, so a
   raw copy is a shadow copy). Must be CONFIRMED covered by the Preferences backup
   path with a real export/restore round trip; if it is not covered that is a bug to
   fix or report. Marked "covered via Preferences" in the table with a test.
3. The shadow-promotion stale-body gap (`SkillMemoryService.ts:1439`) — FIX it, same
   class as the re-scope one: reuse `syncSkillRuleLine`, red test first, own commit.
   Also sweep for any OTHER writer that changes a skill's trigger and goes around it.
   **SWEEP DONE — the shadow site was a false alarm, and there is no other gap.**
   `SkillMemoryService.ts:1441` sets `meta.body = meta.shadow.body`, and the shadow's
   body is built from the shadow's OWN clauses when it is created
   (`:1744` and `:1861`, both `formatCraftedSkillBody(refined)`), so a promotion
   already moves prose and clause together. Every other writer that can change a
   trigger was checked and each rebuilds the body from the same source: the
   worth-gate craft update `:2117` + `meta.body = formatCraftedSkillBody(crafted)`
   at `:2131`; `skillGeneralization.ts:153-156` (clauses AND body from `richest.meta`);
   the consolidation merge `:2510` (grouping is by identical IF-claim, so all
   members state the same trigger); `applyReviewRecommendationUnlocked:3270` and
   `skillIdleLifecycle`/`SkillEvalService` serialize status/metrics only;
   `MemoryFilesManager.tsx:192/203/413` toggle `enabled`/`disabledByUser`/`audience`
   and the editor otherwise writes the whole file text by hand. The two paths that
   DID move a clause without the prose were exactly the two slice 3 fixed. What was
   added instead: a parity test (`craftedSkillStrategy.test.ts`) asserting
   `syncSkillRuleLine` emits the BYTE-IDENTICAL line `formatCraftedSkillBody` does —
   the class-level risk is two producers of one sentence, not a third stale writer.
   BACKLOG (not done, needs the evidence-window harness): a test that drives a real
   shadow to settlement and asserts the promoted file's prose line, since nothing
   currently exercises that path end-to-end (`skillRefinement.test.ts` only pins
   serialization and the lock split).

## Step 9 — DONE (`26cccaa`)
Registered in `RAW_LOCAL_STORAGE_PREFIXES`: `trade_watches_v1`,
`trade_level_arms_v1`, `trade_level_hits_v1`, `trade_drawings_v1`,
`trade_session_drawings_v1`, `trade_chat_sessions_v1`, `desk_tools_forged_v1`,
`trading_checklist_v1`, `trade_tf_bar_v1`, `harness_settings_v1`.
**Cap: `EXPORT_RAW_KEY_CAP_BYTES = 512 * 1024`**, applied to
`trade_chat_sessions_v1` ONLY — a blanket cap would start skipping
`memory_files_v1_<user>`, which `memoryBudget.ts` legitimately lets reach 2 MB, so
the guard would have become the data-loss bug. Over the cap → key LEFT OUT +
`backup._backup_notices` names it (restore reports it as an un-allow-listed key, so
the omission is visible at both ends).
`trade_chat_sessions_v1` exports whole minus image bytes: `stripChatSessionImages`
replaces `image` with `imageOmitted:{bytes,mime}` on the EXPORT COPY ONLY (live key
asserted byte-identical after export); text/order/metadata verbatim. Render side:
`ChatTranscriptList.tsx` shows "image not backed up (mime, N KB)" when `image` is
absent and `imageOmitted` present — `sanitizeEntry` spreads the entry so the stub
survives the read path. **NOT YET EXERCISED: that JSX branch has no test** (needs a
`ChatTranscriptList` render harness); `unit-verified only` until then.
**Decision 2's premise was false and is reported, not applied:**
`utils/harnessSettings.ts:79` writes `localStorage` directly and never imports
PreferencesService, so it was NOT covered by the Preferences backup path — with an
empty Preferences store the old code put no `harness_settings_v1` key in the backup
at all. The round trip in `exportLearningStores.test.ts` proves both halves.
**`trade_chat_active_v1` deliberately NOT registered:** `chatStore.ts:160` writes a
PLAIN session-id string, which the sweep cannot `JSON.parse` (exports nothing) and
which mirroring would restore as `"s-1"` where the owner reads `s-1` — registering
it would corrupt the pointer. Needs a raw-string envelope in the backup format;
backlog.
Round trip (`write → export → clear → import → byte equality`) now covers all ten
plus `skill_drafts_v1:alice` and `learning_proposals_v1:alice`, with
`skippedKeys`/`failedKeys` empty. Backlog floor in `exportRawLocalStorage.test.ts`
now asserts BOTH directions (came down from 17, still > 5).
**BACKLOG added (decision 1):** bound `trade_chat_sessions_v1` bytes AT WRITE TIME —
`trimForStorage` bounds counts (12 × 60) not bytes, and `MAX_IMAGE_CHARS` is
1,200,000 per entry, which is what forced the export-side strip.

## Step 9 follow-ups — decisions 1-4 DONE
| commit | item | result |
|---|---|---|
| `46d375a` | 2 — restore must not destroy on-device images | **The risk was real.** `importPreferencesData` mirrored the backup's stripped value over the live key, so restoring deleted screenshots that were still on the device. Now reconciled per session id (a live session carrying image bytes keeps them; missing sessions are added; a live copy WITHOUT images accepts the backup's text), merged once and written to both stores. Not trimmed to `MAX_SESSIONS` after merging — that would be the same subtraction. Live-empty case: the stub + text restore normally. Red first: 1 failed / 15 passed. |
| `95555e4` | 3 — notices must be visible | They were internal to the sidecar file only. `BackupMetadata.notices` now carries `_backup_notices` up and Settings → Data renders "Backup created, but LEFT OUT: …" in a new amber `warn` state. Tested at both ends (the panel renders whatever the service returns, so the extraction is pinned in `backupService.test.ts` too). Red first: 2 failed on the missing status element. |
| `157bb60` | 4 — the stub branch had no test | `tests/chatTranscriptImageStub.test.tsx` mounts `ChatTranscriptList` (smallest renderer of the stub): stub → notice with mime+size and no src-less `<img>`; real data-URL → image, no notice; plain entry → neither; neighbouring text rows still render. Coverage only, nothing was red. |
| `7ea41e8` | 1 — pointer-missing fallback | Falls back cleanly (never a crash, never an empty dock) BUT it opened the OLDEST session — `sessions[0]` while new sessions append. Now by each row's `updatedAt`/`createdAt`. Pointer honoured when it matches; a pointer to a deleted row falls back; corrupt sessions row tolerated. `trade_chat_active_v1` stays OUT of backups for the plain-string reason (quoted `"s-1"` vs bare `s-1` on mirror). Red first: 2 of 5 failed. |
| `7ea41e8` | 1 — recorded | The reason the key is unbacked is in this file AND in `chatActivePointerFallback.test.ts`'s header, so the next run does not re-derive it. |

## Then
Backup pre-flight + registration → real export/restore round trip with byte
equality → agentsSurface flake rate (10 solo + 1 under load) → **Step B audit,
then STOP for approval.** Dock chain (below) only if room remains.

**`trade_tf_bar_v1` — ANSWERED, it needs the RAW list.** Its owner is
`TradingChart.tsx:100/112` (`readTfBarSelection`/`writeTfBarSelection`), which
talk to `localStorage` DIRECTLY and never to Preferences — and it is already in
`RESTORABLE_PREFERENCE_KEY_PREFIXES` (`ExportService.ts:544`) but NOT in
`RAW_LOCAL_STORAGE_PREFIXES` (the 293-356 block), so on NATIVE an import would
restore it into a place nothing reads. Size is trivial (a JSON array of
timeframe strings, ≤ ~90 bytes worst case), so it costs the shared origin quota
nothing. `tests/exportRawLocalStorage.test.ts:167` still lists it as awaiting a
decision, and that test FAILS when an awaiting entry gets registered — the
registration must move the row out of `AWAITING_BACKUP_DECISION` in the same
commit, with a real key asserted.
**Step 9 pre-flight — MEASURED, verified in code (all owners write `localStorage`
directly; none imports PreferencesService — re-checked, 9 `setItem` sites):**

| key shape | owner write | size bound | safe to bundle? |
|---|---|---|---|
| `trade_watches_v1_<user>` | `watchService.ts:61` | `MAX_WATCHES=10` slice | yes |
| `trade_level_arms_v1_<user>` | `levelWatchService.ts:140` | `MAX_ARMS=10` | yes |
| `trade_level_hits_v1_<user>` | `levelWatchService.ts:167` | `MAX_LATCHED=200` | yes |
| `trade_drawings_v1_<user>_<SYMBOL>` | `chartDrawings.ts:121` | 40 drawings ×200 pts | yes |
| `trade_session_drawings_v1_<user>_<sessionId>` | `chartDrawings.ts:187` | per-coin capped, **coin count unbounded** (:179 "keep EVERY coin") | one key grows with symbols traded |
| `trade_chat_active_v1_<user>` | `chatStore.ts:160` | a plain string id | yes — but a plain string NEVER round-trips `getPreferenceObject`, so the restore mirror must write it raw |
| `desk_tools_forged_v1` (no user suffix) | `toolForge.ts:365` | **unbounded** count; already redacted on export (`ExportService.ts:225`) | yes, redaction path exists |
| `trading_checklist_v1` (no user suffix) | `checklist.ts:51` | **unbounded** `items` | yes, small in practice |
| `trade_chat_sessions_v1_<user>` | `chatSessions.ts:199` | 12 sessions × 60 entries by COUNT, but `MAX_IMAGE_CHARS=1_200_000` per entry → **worst case hundreds of MB, and `trimForStorage` slices counts not bytes** | **NO — decision needed** |
| `harness_settings_v1` | `harnessSettings.ts:79` | fixed-shape flat object | the doc itself says it likely belongs in Preferences, not here |

Not registered yet because the run ran out of room, and `trade_chat_sessions_v1`
should not go in as it stands: the export would read the whole base64-image blob
into one JSON payload against a SHARED origin quota (AGENTS.md). Decide: back it
without images / back it whole / leave it unbacked. The other nine are mechanical:
add to `RAW_LOCAL_STORAGE_PREFIXES` (`ExportService.ts:293-356`), move the row out
of `AWAITING_BACKUP_DECISION` (`tests/exportRawLocalStorage.test.ts:152` — that
test FAILS if an awaiting entry is registered without being removed from the map),
assert a REAL key each (incl. the two-underscore `trade_drawings_v1_<user>_BTCUSDT`
shape), then the export→restore byte-equality round trip.

## Probe facts — paid for
Coach tab `data-testid="learn-tab-coach"` (textContent is `Coach1`, badge span, so
text matching fails); approve `coach-draft-allow-<id>`. Poll `document.body.innerText`
for toasts (`[role=status]` matches an empty region → false failure). Notebook key
`memory_files_v1_Probe User` is recreated async after a clear → resolve in-page.
App pre-seeds **12 `book-*.md`** skills → assert new file NAMES, never counts.
Removing the skills folder can't fail a write (`ensureHarnessFoldersUnlocked`
recreates it when any `DEFAULT_FOLDERS` name exists — `MemoryFilesService.ts:200`).
Filter the probe's own `/probe: quota exceeded/` out of the page-error check.
Harness: `node scripts/probe-skill-approval.cjs` (vite :4189, mock :8787, profile in
IndexedDB `FuturesAI-DB/userProfiles`). Mock: `MOCK_TOOL_CALL=1`, `MOCK_SKILL_ARGS`,
`MOCK_TOOL_NAME`, one-shot (needs `tools` and no `role:"tool"` yet).

## Unit-verified only (accepted for now)
A5 short-clause rejection + A3 failed-write at the **desk-tool** level. Closing
them needs the unexplored step: send a message through the Chart AI dock so the app
issues a toolbed request (`propose_skill` allow-listed at `chatTurnRunner.ts:110`;
rail has `New Conversation`), then assert a 6-char `if_condition` is rejected and a
queue-write failure (`Storage.prototype.setItem` on `skill_drafts_v1`) surfaces.
Everything downstream of the inbox IS app-verified. Deferred: reversal zone →
`draw_detected` (option 3 taken; all three on the backlog).
