# Workstream 1 — status / handoff

Read this first next pass. Do not re-explore what is written here.
Branch `workstream1-trade-review` (from `6e81c50`). Never pushed.

## Done (commits)
- `cae8293` carried-over three (typeRamp `text-[10px]`→`text-ui-xs`, systemIntelligenceUi mock)
- `38872eb` HTF bar state + MTF premium/discount + sweep reversals; **also** A4 stable keys + A3 queue guard (same file, no interactive `add -p`)
- `bbaae74` Phase 0: `approveSkillDraft` read-back guard + slug-collision fix
- `7ecefe3` A1: `skill_drafts_v1` + `learning_proposals_v1` registered; scan hole closed
- `9c679b8` A5 one `CLAUSE_MIN_LENGTH`; `121bd1d` A3 read-back + null / empty-slug reject
- `bdbf153` probe (WIP); this pass → **A7 pass 1: happy path GREEN in the real app**

## Verified in the app (not just unit)
Seeded draft → `Learn` rail → `learn-tab-coach` → "Save as skill" → toast
`Skill saved` → `funding-exhaustion-long.md` present in the notebook → draft gone
from `skill_drafts_v1:Probe User` → 0 uncaught page errors. Evidence:
`.probe-artifacts/skill-approval/1-happy-after-click.png` + `transcript.json`.
Run: `node scripts/probe-skill-approval.cjs` (vite :4189, mock-provider :8787).

## The ONE thing pass 1b must change
Cases 2-4 are red for a **probe** reason, not an app one: each case calls
`freshSession()`, which does `localStorage.clear()`, so case 2's precondition
(case 1's file) is gone — `-2.md` can never appear. Make each case seed its own
prerequisite notebook state inside itself (or run them as one accumulating
session). No app bug is implicated by 2-4 yet; none was observed.

## Probe gotchas, already paid for
- Coach tab: `data-testid="learn-tab-coach"`. Its textContent is `Coach1` (badge
  span, NO space) — text matching on `/^Coach(\s|$)/` silently never clicks.
- Notebook key: `memory_files_v1_Probe User`; shape IS `{version,folders,files}`
  but the key is recreated async after a clear → resolve it in-page per call.
- Profile must exist in IndexedDB `FuturesAI-DB/userProfiles` or the app sits on
  the workspace modal and nothing is ever written.
- The app seeds 12 `book-*.md` skills on first run — assert on a NEW file, not a count.
- Toasts: poll `document.body.innerText` for the string. `[role=status]` matches
  an empty live region and returns "" (that produced a false failure).
- Only uncaught exceptions count as page errors; resource loads are logged and ignored.

## Still UNIT-VERIFIED ONLY
A5 short-clause rejection and A3 failed-write path — both upstream of a seeded
draft. Needs the mock-provider tool-call extension (A7 pass 2): additive,
opt-in flag, off = identical behaviour, separate commit.

## Next, in order
A7 pass 1b (duplicate, collision, folder-removed) → A7 pass 2 (mock) → A2 →
backup pre-flight (open `trade_tf_bar_v1` first) → agentsSurface flake rate →
Step B (STOP at gate).
**A2 step 0:** read how `contradiction` proposals store payload; if same
mismatch as `rescope`, cover both + rewrite `coachThread.test.tsx:100` for both.
Deferred: reversal zone → `draw_detected` (option 3 taken; all three on backlog).
