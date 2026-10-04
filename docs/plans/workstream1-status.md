# Workstream 1 — status / handoff

Read first; don't re-explore what's recorded. Branch `workstream1-trade-review`
(from `6e81c50`), never pushed, commit by explicit paths. Tip green (measured at
`86ce021`+docs): full suite 475 files passed | 1 skipped, `tsc --noEmit` 0, eslint
0 errors (860 warnings, inside the ratchet), `vite build` 0, skill-approval probe
25/25.

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
**Next:** steps 9-11 — backup pre-flight + `trade_tf_bar_v1` registration → real
export/restore round trip with byte equality → agentsSurface flake rate → Step B
read-only audit into `docs/plans/`, then STOP for approval.
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
both apply paths. KNOWN SAME GAP, NOT FIXED: the shadow-promotion swap at
`SkillMemoryService.ts:1439` sets `meta.ifCondition` from `meta.shadow` and does
not sync the body line.

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
**Decision still owed by the user:** the eight `TRADING DATA — Decide: register
or delete` rows in that same map (`desk_tools_forged_v1`, `trade_drawings_v1_*`,
`trade_chat_sessions_v1_*`, `trade_chat_active_v1_*`, `trade_level_arms_v1_*`,
`trade_level_hits_v1_*`, `trade_watches_v1_*`, `trading_checklist_v1`). Register
= backed on mobile; delete = the surface goes. Not a call to make by reflex, per
AGENTS.md's "do not widen it for safety".

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
