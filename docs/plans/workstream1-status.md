# Workstream 1 — status / handoff

Read this first next pass. Do not re-explore what is written here.
Branch `workstream1-trade-review` (from `6e81c50`). Never pushed. Tip is green:
typecheck 0 · build 0 · lint 0 · vitest 474 files passed / 1 skipped.

## Done (commits)
- `cae8293` carried-over three: typeRamp (`text-[10px]`→`text-ui-xs` ×5), systemIntelligenceUi mock
- `38872eb` HTF bar state + MTF premium/discount + sweep reversals; **also** A4 stable keys and the A3 queue guard (same file, no interactive `add -p`)
- `bbaae74` Phase 0: `approveSkillDraft` read-back guard + slug-collision fix (red→green proven)
- `7ecefe3` A1: `skill_drafts_v1` + `learning_proposals_v1` registered; scan hole closed
- `9c679b8` A5: one `CLAUSE_MIN_LENGTH = 12` for schema and gate
- `121bd1d` A3: `queueSkillDraft` read-back + null; `proposeStrategy` rejects an empty slug
- (this pass) `probe-skill-approval.cjs` — WIP, see blockers below

## Still UNIT-VERIFIED ONLY
Phase 0, A1, A3, A4, A5. Nothing has pressed "Save as skill" in the app yet.

## A7 pass 1 — where the probe stands
`node scripts/probe-skill-approval.cjs` (vite on 4189, playwright chromium).
Works: starts vite → seeds profile in IndexedDB `FuturesAI-DB/userProfiles` →
discovers notebook key **`memory_files_v1_Probe User`** → seeds
`skill_drafts_v1:Probe User` → asserts the draft is in the inbox. 7/16 checks pass.

Blockers to fix first:
1. **Coach tab not reachable.** No `<button>` whose text is exactly `Coach`.
   LearnView:75 renders it only when `renderCoach` is passed; the real switch is
   `Chat | Coach` **inside the Chart AI dock** (LearnView:7-8,45). Enter via the
   Trade surface → open the dock → that switch. Screenshot: `diag-*.png`.
2. **Case 4 crashed**: `store.folders` is null — the notebook JSON is NOT
   `{folders, files}` at the top level. Read the real shape from the page before
   mutating it.
3. 25 pageErrors were all failed resource loads (provider config points at
   127.0.0.1:8787 with no mock running). Spawn `scripts/mock-provider.cjs` the way
   render-probe.cjs:460 does to silence them.

## Useful facts
- Approve control: `data-testid="coach-draft-allow-<draftId>"`, label "Save as skill" (`CoachThreadPanel.tsx:181`); deny is `coach-draft-deny-<id>`
- Toast strings to assert: `Skill saved` / `Already learned` / `Not saved — still in your inbox` (`services/learning/skillApproval.ts`)
- `scripts/mock-provider.cjs` emits NO tool calls → `propose_skill` unreachable from a model turn. Ruling: extend it, additive + opt-in flag, off = identical behaviour, separate commit. That is A7 **pass 2**.
- `revise_skill` payload (`ifCondition/thenAction/predicate`) is never read by `applyProposalRewrite` (`skillSupervisor.ts:352`, reads `verdict.enhanced`). `APPLYABLE_PROPOSALS:340` DOES include rescope+contradiction, so the dead end is the two human panels (`LearningQueuePanel.tsx:42`, `CoachThreadPanel.tsx:248`).
- **A2 step 0**: read how `contradiction` proposals store payload; if same mismatch, cover both kinds and change the `coachThread.test.tsx:100` contract for both. Report which, before writing the red test.

## Order
A7 pass 1 → A7 pass 2 → A2 → backup pre-flight (open `trade_tf_bar_v1` first) → agentsSurface flake rate → Step B (STOP at gate).
Deferred: reversal zone → `draw_detected` (option 3 taken; all three options on the backlog).
