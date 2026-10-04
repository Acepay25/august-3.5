# Workstream 1 — status / handoff

Read first; don't re-explore what's recorded. Branch `workstream1-trade-review`
(from `6e81c50`), never pushed, commit by explicit paths. Tip green: full suite
474 files passed, typecheck 0, lint 0 errors.

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

## A2 — remaining work, in order (NOT started)
1. RED: rewrite `tests/coachThread.test.tsx:100` ("rescope/contradiction get Dismiss
   only") to expect Apply for `rescope`. Name the contract change in the commit.
2. `applyRescopeProposal(slug, clauses, username)` beside `applyDemoteProposal:2766`
   (same `withNotebookWriteLock` idiom): `validateIfThen` fail-closed, find by slug,
   set clauses, REPLACE predicate (drop it if the rewrite carries none — a stale one
   fires the pre-revision trigger), then **read back** and return true only if the
   parsed file matches. Drafted once and reverted for want of a test.
3. `LearningQueuePanel.tsx:42` + `CoachThreadPanel.tsx:248`: add `rescope`; `apply()`
   branch reads `p.payload`. 4. `applyProposalRewrite`: prefer `proposal.payload`.
5. GREEN: full path `revise_skill → queue → approve → skill updated`.
6. Short real-app rescope check + screenshot.

## Then
Backup pre-flight + registration (open `trade_tf_bar_v1` first; per key: owner
never touches Preferences, typical/worst-case size vs the shared origin quota, a
REAL key in a test incl. the double-underscore ones) → real export/restore round
trip with byte equality → agentsSurface flake rate (10 solo + 1 under load) →
**Step B audit, then STOP for approval.** Dock chain (below) only if room remains.

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
