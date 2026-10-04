# Workstream 1 — status / handoff

Read this first. Do not re-explore what is recorded here.
Branch `workstream1-trade-review` (from `6e81c50`). Never pushed. Commit by explicit paths.

## Done
| commit | item | result |
|---|---|---|
| `cae8293` | carried-over three | typeRamp + systemIntelligenceUi green |
| `38872eb` | HTF bar state, MTF premium/discount, sweep reversals (+A4 keys, +A3 queue guard in the same file) | 117 tests |
| `bbaae74` | Phase 0 `approveSkillDraft` read-back + slug fix | red→green |
| `7ecefe3` | A1 `skill_drafts_v1` + `learning_proposals_v1` registered, scan hole closed | 7 checks |
| `9c679b8` | A5 one `CLAUSE_MIN_LENGTH=12` | green |
| `121bd1d` | A3 read-back + null / empty-slug reject | green |
| `a6e007e`,`e62051a` | A7 pass 1 + 1b: **4 of 4 approval cases green in the real app** | 15/15, exit 0 |
| `724882a` | A7 pass 2 step 1: mock emits a scripted `propose_skill` call, opt-in | flag-off: boot-probe 0, approval probe 15/15 |
| `ce637f9` | named `no-skills-folder` result from the ingest (guard was live, not dead) | red→green |
| (this) | `overrideApproveSkill` reads the result; no phantom "approved by you" | red→green, TC/lint 0 |

## Reordered backlog (this run)
1 done → **2 A2** (contradiction check first) → 3 backup registration + real
export/restore round trip → 4 agentsSurface flake rate → 5 **Step B audit, STOP**.
Item "true propose_skill chain via the dock" moved to LAST, after the audit; its
two upstream legs (A5 short clause, A3 desk-tool failure) are unit-verified only,
accepted as such for now.

## A2 step 0 — ANSWERED: contradiction is NOT the same bug
`contradiction` payloads carry no clause text: `beliefChallenge.ts:119` stores
`{slug, contradictions}` and `contradictionSweep.ts:116` stores `{pair:[a,b]}`.
There is nothing mechanical to apply, which is what the comment at
`tests/skillSupervisor.test.ts:213` already asserts. So **A2 is rescope-only**;
the contract rewrite covers `rescope` and leaves `contradiction` Dismiss-only.
`revise_skill` is the only writer of clause payloads
(`DeskToolsService.ts` → `payload:{source:'model:desk', ifCondition, thenAction,
predicate}`), and `applyProposalRewrite` (`skillSupervisor.ts:352`) reads only
`verdict.enhanced` — so those stored clauses are dropped on every path today.

## A2 — the remaining work, in order (not started)
1. RED: rewrite `tests/coachThread.test.tsx:100` ("non-applyable kinds
   (rescope/contradiction) get Dismiss only") to expect an Apply control for
   `rescope`. Name the contract change in the commit message.
2. `applyRescopeProposal(slug, clauses, username)` in `SkillMemoryService.ts`
   beside `applyDemoteProposal:2766` (same `withNotebookWriteLock` idiom):
   `validateIfThen` fail-closed, find skill by slug, set ifCondition/thenAction,
   REPLACE predicate (drop it when the rewrite carries none — a stale predicate
   fires the pre-revision trigger), then **read back** the parsed file and return
   true only if the clauses match. Was drafted and reverted for want of a test.
3. `LearningQueuePanel.tsx:42` + `CoachThreadPanel.tsx:248`: add `rescope` to the
   APPLYABLE set; panel `apply()` branch reads `p.payload` clauses.
4. `applyProposalRewrite`: prefer `proposal.payload` over `verdict.enhanced`.
5. GREEN: full path test `revise_skill → queue → approve → skill updated`
   (drive `executeDeskTool`, then the applier, then re-read the skill).
6. Short real-app check of a rescope apply + screenshot.

## Probe facts (paid for — do not rediscover)
- Coach tab: `data-testid="learn-tab-coach"`; its textContent is `Coach1` (badge
  span, no space) so text matching fails. Approve button: `coach-draft-allow-<id>`.
- Read toasts by polling `document.body.innerText`; `[role=status]` matches an
  empty live region and returns "" → false failure.
- Notebook key is recreated async after a `localStorage.clear()` → resolve in-page.
- The app pre-seeds **12 `book-*.md`** skills: assert new file NAMES, never counts.
- Removing the skills FOLDER does NOT fail a write in the probe's notebook,
  because `ensureHarnessFoldersUnlocked` recreates it. **My earlier claim that
  the guard was dead was wrong**: that function adds folders only when at least
  one `DEFAULT_FOLDERS` name already exists (`MemoryFilesService.ts:200`), so a
  notebook with none of them (an import with custom folders) reaches
  `if (!folder) return` for real. It now returns
  `{created:false, reason:'no-skills-folder'}` and `approveSkillDraft` surfaces
  it. Case 4 sabotages `window.Storage.prototype.setItem` instead.
- Only uncaught exceptions count as page errors; filter the probe's own sabotage
  (`/probe: quota exceeded/`) out of that check.

## Deferred to last: the true propose_skill chain via the dock
Harness: `node scripts/probe-skill-approval.cjs` (vite :4189, mock :8787, profile
in IndexedDB `FuturesAI-DB/userProfiles`, notebook key `memory_files_v1_Probe
User`). Mock: `MOCK_TOOL_CALL=1`, payload `MOCK_SKILL_ARGS`, name
`MOCK_TOOL_NAME`, one-shot (fires only when the request has `tools` and no
`role:"tool"` message yet). Unexplored: sending a message through the Chart AI
dock so the app issues a toolbed request (`propose_skill` is allow-listed at
`chatTurnRunner.ts:110`; the rail has `New Conversation`). Cases: proposal
reaches the inbox and saves; 6-char `if_condition` rejected (A5); forced
queue-write failure surfaces (A3) — sabotage `window.Storage.prototype.setItem`
for `skill_drafts_v1` via `addInitScript`.

## Still unit-verified only (accepted for now)
A5 short-clause rejection and A3 failed-write at the desk-tool level; the dock
chain above closes both. Everything downstream of the inbox is app-verified
(4 of 4 approval cases, `e62051a`).


## Then
A2 (step 0: read how `contradiction` stores payload — if same mismatch as
`rescope`, cover both + rewrite `coachThread.test.tsx:100` for both; report
which BEFORE the red test) → backup registration pre-flight (open
`trade_tf_bar_v1` first) → agentsSurface flake rate → **Step B audit, then STOP**.
Deferred: reversal zone → `draw_detected` (option 3 taken; all three on backlog).
