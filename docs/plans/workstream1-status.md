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

## A7 pass 1b — DONE, 4 of 4 cases green in the app
`node scripts/probe-skill-approval.cjs` → **15/15 checks, exit 0**. Each case now
seeds its own prerequisite (`freshSession` clears localStorage, which is why 2-4
were red before). Verified: happy → `Skill saved` + file + draft consumed;
collision → `funding-exhaustion-long-2.md` written, no throw; duplicate →
`Already learned` and explicitly NOT `Skill saved`, no new file; forced write
failure → `Not saved` and **the draft survives in the inbox**.

Two findings worth keeping:
- **Deleting the skills folder cannot make the write fail.** `ingestCraftedSkill
  FromDraftUnlocked` calls `ensureHarnessFoldersUnlocked` first, which recreates
  it — so the `if (!folder) return` guard at `SkillMemoryService.ts:2191` is
  unreachable from this path (one of the "seven silent returns" is dead). Case 4
  now forces failure by throwing from `Storage.prototype.setItem` for
  `memory_files_v1*` via `addInitScript`.
- The app pre-seeds **12 `book-*.md`** skills, so assert on a new file NAME,
  never a count.
`deleteSkillsFolder` is left in the script unused, documented as the disproving
helper.

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
