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

## Next: item 3 — drive the TRUE propose_skill chain in the app
`node scripts/probe-skill-approval.cjs` is the reusable harness (vite :4189, mock
:8787, profile in IndexedDB `FuturesAI-DB/userProfiles`, notebook key
`memory_files_v1_Probe User`). To do item 3:
1. Start the mock with `MOCK_TOOL_CALL=1` (or `--tool-call`). Payload override:
   `MOCK_SKILL_ARGS` (JSON) · tool name: `MOCK_TOOL_NAME`. One-shot guard: it
   only fires when the request has `tools` AND no `role:"tool"` message yet.
2. **Unexplored part:** sending a message through the Chart AI dock so the app
   actually issues a toolbed request, then reading the inbox. The dock needs a
   session (`New Conversation` is in the rail); `propose_skill` is allow-listed
   at `services/trade/chatTurnRunner.ts:110`.
3. Three cases to prove: normal proposal reaches the Coach inbox and saves;
   `if_condition` of 6 chars is **rejected** (A5); a forced queue-write failure
   surfaces honestly (A3) — force it by throwing from `Storage.prototype.setItem`
   for `skill_drafts_v1` via `addInitScript`.

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

## Still unit-verified only
A5 short-clause rejection and A3 failed-write at the **desk-tool** level (item 3
closes both). Everything downstream of the inbox is app-verified.

## Then
A2 (step 0: read how `contradiction` stores payload — if same mismatch as
`rescope`, cover both + rewrite `coachThread.test.tsx:100` for both; report
which BEFORE the red test) → backup registration pre-flight (open
`trade_tf_bar_v1` first) → agentsSurface flake rate → **Step B audit, then STOP**.
Deferred: reversal zone → `draw_detected` (option 3 taken; all three on backlog).
