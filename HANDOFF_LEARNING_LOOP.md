# Handoff — August Trading learning-loop work (from the "Final Deep Dive" plan)

Repo: `C:\Dev\august-3.5` · branch `main` · **the work below is now committed on `main`**
(P0 batch, P1 batch, the Tier-1 deletes, and the recall-card wiring that followed). What is
left in §4 and §5 is still not started.

> **STATUS UPDATE (second pass):** IMPLEMENT-1, 2, 3, 4, 5, 6 are **all done**, and the Tier-1
> deletes are **done** (with three corrections — see §3). Verified: `tsc --noEmit` 0 errors;
> full suite **488 files / 4686 tests passed**; `npm run lint` passes at 838/889 warnings.
> What remains is **Tier-2 product decisions** (§4) and the **Improve list** (§5) — both need a
> human call, not more code. See §0 for the required test flag.

Read this with the original plan (attached: *Final Deep Dive: Memory / Learning Loop / Coach / Hermes*).
Section numbers below (`IMPLEMENT-n`, `Tier-n`, `Improve n`) match that plan.

---

## 0. FIRST: the test runner is broken on this machine (read before anything)

This box runs **Node v26.7.0**. Node 26 ships an experimental global `localStorage` that is
`undefined` and **shadows jsdom's**, so every test that touches `localStorage` directly dies with:

```
TypeError: Cannot read properties of undefined (reading 'clear')
```

This is **pre-existing on clean HEAD** (verified by stashing all changes and re-running) and is
**not** caused by any change in this handoff. The project pins `node 22.23.3` via volta, but no
Node 22 is installed here.

**Workaround — use it for every test command:**

```bash
cd C:/Dev/august-3.5
NODE_OPTIONS=--no-experimental-webstorage npm test
```

Without the flag you will get ~1,000 phantom failures and will waste an hour.

**Verified with the flag:** full suite `487 passed | 1 skipped (488)`, `4668 passed | 11 skipped (4679)`,
232s. `npx tsc --noEmit` exits 0. `npx eslint` on touched files: 0 errors.

---

## 1. DONE — already implemented and verified (do not redo)

### IMPLEMENT-1 — trade-backed approval (P0) ✅

The bug: `approveSkillDraft` had two branches. The draft path passed `approvedBy: 'human'`; the
**trade-backed** path called `ingestCraftedSkill` with no approval marker, so post-mortem drafts
(which always carry `tradeId === closed.id`) produced skills that failed `isApprovedSkill` and
silently never injected — while the UI card read "Active".

| File | Change |
|---|---|
| `services/learning/skillApproval.ts:65` | `ingestCraftedSkill(trade, draft.crafted, user, 'human')` |
| `services/learning/SkillMemoryService.ts` `ingestCraftedSkillUnlocked` | new optional `approvedBy?: 'human'` param; spreads `{ approvedBy, approvedAt }` into the `SkillMeta` row only when supplied (auto-ingest callers stay fail-closed) |
| `services/learning/SkillMemoryService.ts` `ingestCraftedSkill` | threads the param through `withNotebookWriteLock` |
| `tests/skillApprovalRoundTrip.test.ts` | new test `P0-1: approving a CLOSED-trade draft stamps human approval so the skill activates` — asserts `meta.approvedBy === 'human'`, `isApprovedSkill === true`, `tradeIds` contains the closed id |

Note the implementation choice: rather than rerouting the trade branch through
`ingestCraftedSkillFromDraft` (as the plan suggested), the approval marker was added to the
existing trade path. That keeps the trade's own W/L seed + `tradeIds` provenance intact, which
rerouting would have had to re-derive.

### IMPLEMENT-2 — idempotent settle + matrix guard (P0/P1) — **DONE** ✅

| File | Change |
|---|---|
| `services/learning/SkillMemoryService.ts` | module-level `settledTradeIds: Set<string>` guard at the top of `syncClosedTradeToNotebook`. **Keyed on `username:tradeId`**, not bare id — two profiles legitimately hold trades with the same id, and a bare id would let one profile's settlement silently swallow the other's. Marks *before* awaiting; caps at 2000 entries (session-bounded). Exported `__resetSettledTradesForTests()` test hook. |
| `services/learning/strategyRegimeMatrix.ts` | `MatrixCell` gained `tradeIds?: string[]`; `recordSettledTradeForMatrix` returns early when the cell already lists the id; `sanitizeMatrix` persists the ids (capped `slice(-40)`). **The whole read-modify-write now runs inside `withSerializedPref(keyFor(username), …)`** — the plan's remaining item; the call is fire-and-forget from the settle path, so unserialized concurrent settles dropped increments. |
| `tests/strategyRegimeMatrix.test.ts` | three new tests: re-settled trade counts once; the guard survives a reload (persisted, not in-memory); **five concurrent settles all land** (this one fails on the unserialized code — verified by temporarily reverting the wrapper). |
| `tests/botWorthGateContext.test.ts` | `__resetSettledTradesForTests()` in `beforeEach` |

**Nothing left in IMPLEMENT-2.**

### IMPLEMENT-3 — `bots_v1` via registry (P0 native) — **DONE** ✅

The bug: two call sites read `localStorage.getItem('bots_v1_<user>')` directly. On native,
`PreferencesService` is Capacitor Preferences — a **different store** from `localStorage` — so the
read returned nothing on device.

| File | Change |
|---|---|
| `hooks/analysisPipeline/memoryContext.ts` | `assemblePipelineMemoryContext` is now **`async`** (returns `Promise<PipelineMemoryContext>`) and reads `await BotRegistry.list()`. Imports switched from `getActiveUsername`/`BotMemoryScope` to `BotRegistry`. |
| `hooks/useAnalysisPipeline.ts:1294` | `await assemblePipelineMemoryContext(...)` |
| `services/learning/SkillMemoryService.ts` | roster-head fallback now `origin?.botId ?? await (async () => { const bots = await BotRegistry.list(); ... })()`. **Careful:** the original draft used `||` with an async IIFE, which assigned a *Promise* (truthy) instead of the id — that bug was caught by `botWorthGateContext.test.ts` and fixed with `??` + `await`. Do not reintroduce `||` here. |
| `services/agents/botRoutine.ts:70` | `isProviderReady(c)` replaces `c.isEnabled && c.apiKey.trim().length > 0` |
| `tests/analysisPipelineStages.test.ts`, `tests/memoryWindowBudget.test.ts`, `tests/learningLoopE2E.test.ts`, `tests/botWorthGateContext.test.ts` | all call sites awaited; bot seeding moved from `localStorage.setItem('bots_v1_…')` to a mocked `BotRegistry.list()` (`mockBots` array, hoisted, reset per test) |

**Still to do in IMPLEMENT-3:**

1. ~~`services/agents/botRoutine.ts:~109-111`~~ — **DONE.** The `validateDM` readiness callback now
   uses `isProviderReady(c)`. Both halves of the plan's "`botRoutine.ts:66,106`" are complete.
2. **Left alone deliberately, needs a decision:** `services/agents/agentRoster.ts` reads/writes the
   *other* registry, `agents_bots_v1_` (raw `localStorage`), and `botOriginForMessage`
   (`services/agents/botLearning.ts:138`) uses `getBots()` from it. `render-probe.cjs:306` seeds
   `agents_bots_v1_` too. Unifying the two registries is **Tier-2 item 5** — don't half-do it here.

---

## 2. IMPLEMENT-4/5/6 — **ALL DONE** ✅

### IMPLEMENT-4 — worth-gate backoff (P1, cost) — DONE

`utils/skillDrafts.ts` gained a worth-gate attempt ledger:
`WorthGateAttempt { key, lastAt, attempts, tradeIds }`, persisted at
`skill_drafts_v1_gate_attempts:<user>` (bounded to 50). Exports:
`shouldAttemptWorthGate(key, clusterTradeIds, username, force?)`, `recordWorthGateAttempt`,
`readWorthGateAttempt`, `listWorthGateAttempts`, `clearWorthGateAttempt`.

`services/learning/SkillMemoryService.ts` — the gate branch now resolves config ONLY when the
throttle opens (`shouldAttemptWorthGate(key, clusterIds, username) ? await resolveMemoryConfig(...) : null`),
stamps the attempt **before** the LLM call (a gate that throws still consumed a provider round trip),
and clears the record once a verdict is reached. A retry happens only when the cluster gains a trade
the gate has not judged. `readWorthGateAttempt` in the else-branch distinguishes "throttled" from
"no provider" in the log.

`services/learning/memoryHealth.ts` — new `gateThrottled` report field + a `flags[]` line, so a
throttled loop is visible instead of looking like "nothing to learn".
`components/learn/MemoryHealthCard.tsx` — a "Worth-gate held back (N)" section.

Tests: `tests/worthGateThrottle.test.ts` (10 cases — first attempt always allowed, retry throttled,
new evidence re-opens, human override, per-user scoping, bounded ledger, survives reload) plus an
end-to-end case in `tests/botWorthGateContext.test.ts` that counts real `evaluateSkillWorth`
invocations through `syncClosedTradeToNotebook`.

**Note on the plan's "Try now" button:** `shouldAttemptWorthGate(…, force = true)` is implemented and
tested as the human-override entry point, but no UI button was added — there is no natural card to
hang it on (the throttled cluster has no draft yet; that is the point). If you want the button, the
place is the new "Worth-gate held back" section in `MemoryHealthCard`, calling the gate for one key.

### IMPLEMENT-5 — citation by slug (P1, correctness) — DONE

New `utils/followedSkills.ts`: `FOLLOWED_SKILLS_LABEL`, `parseFollowedSkills(text): string[] | null`
(`null` = line absent → fall back; `[]` = explicit `none` → do not fall back) and
`normalizeSkillSlug` (strips `skills/`, `.md`, quotes; lowercases).

`constants/prompts/debatePrompts.ts` — both moderator prompts (`MODERATOR_SYSTEM_PROMPT_V2` item 10,
`MODERATOR_FINAL_VERDICT_PROMPT_COMPACT` step 1) now require a `followed-skills: name, name` line,
following the existing `KEPT:` precedent.

`services/learning/MemoryInjectionService.ts` — `cites()` checks the declared line FIRST and returns
its answer outright; word overlap is reached only when the line is absent. **The 10×100 ms poll is
gone**, replaced by `awaitInjectionRecord(username, runId, stage)`, which awaits the exact in-flight
`recordMemoryInjection` write for that (user, run, stage) via a new `pendingWrites` handoff map, with
a bounded 5×50 ms re-check only for the case where the write has not started yet.

Tests: `tests/annotateVerdictCitations.test.ts` — four new cases (named skill cites with zero word
overlap; an explicit `none` does NOT fall back; an absent line DOES fall back; all the slug shapes a
model writes resolve). The five pre-existing word-overlap cases still pass unchanged.

### IMPLEMENT-6 — single applier (P1) — DONE

`utils/learningQueue.ts` gained `applyProposalCard(p, username)`, `decideRewriteCard(p, decision, username)`
and `applyFailureMessage(result)`. The `SkillMemoryService` imports are dynamic on purpose —
`learningQueue` is imported BY `SkillMemoryService`, so a static import back would close a runtime cycle.

`components/chat/CoachThreadPanel.tsx` and `components/skills/LearningQueuePanel.tsx` both now call
the shared appliers; their duplicated dispatcher/try-catch/message-formatting blocks are gone
(~35 lines removed across the two).

Tests: `tests/coachThread.test.tsx`, `tests/learningQueuePanel.test.tsx`,
`tests/learningQueueApply.test.ts` — 27 passing. **`npm run render-probe` was run** (AGENTS.md
mandate for UI work).

---

## 3. Tier-1 deletes — **EXECUTED** ✅ (with corrections)

All Tier-1 items below were verified against the tree and then applied. **Four of the plan's claims
were wrong** — those were NOT deleted, see the second table.

### Deleted / changed

| Item | What was done |
|---|---|
| `MemoryGraph.walkMemoryNeighbors` | Function deleted. `tests/memoryGraph.test.ts` no longer calls it — the assertion now reads `getMemoryFilesContext` (the reader production actually uses), so the test can no longer pass while the shipped path differs. |
| `kindForHit` | Deleted, along with the now-unused `WalkedMemoryHit` import. |
| `lensMemoryDoctrineLine` | Deleted + its three test call-sites removed. |
| `UnderperformerFeedbackService` | **Whole file deleted** — it has ZERO importers, so `getUnderperformerStatus` (which the plan said to keep if a dashboard used it) was dead too. `tests/coldStreakSingleSource.test.ts` lost the case that read this file as text; the invariant it policed is still enforced by that file's *other* test, which scans every module under `services/` for a redeclaration. Comment in `ModelPerformanceService.ts:130` updated. |
| `LearningQueuePanel.refreshKey` | Prop + `useEffect` dep removed (never passed; sole mount is `components/learn/LearnView.tsx:148`). `MemoryHealthCard`'s own `refreshKey` is *used* — left alone. |
| `CoachThreadPanel.onOpenTrade` | Prop removed from the panel and `DraftCard`, and the "View the trade" button branch deleted (never passed; sole mount `App.tsx:2139`). |
| `agentRowLabel` | Deleted; `tests/agentContext.test.ts` now asserts `resolveAgentContext(BOT).name` directly. |
| `MemoryConsolidationService.consolidateMemory` | Deleted, plus the orphan `tests/test-memory-consolidation.ts` (not in the vitest include glob). `pruneOutdatedInsights`/`aggregateSimilarInsights` are LIVE (`AlgorithmicMemoryService.ts:142-143`) and were kept. |
| Duplicate `if (!isApprovedSkill(meta)) continue` | Already fixed in the first pass. |
| Stale count in `draftGates.ts:3` | "Six sources" → "Seven sources". |
| `getBotMemoryContext` import + dead `botMemoryContext` local in `hooks/useAnalysisPipeline.ts` | Import and the unused destructured binding both removed. |
| 6 definition-only `PREF_KEYS` | `PROVIDER_PAIR_STATS`, `INVALIDATION_RULES`, `POST_MORTEM_INSIGHTS`, `LEARNING_WRITE_APPROVAL`, `LEARNING_PENDING_RULES`, `PRICE_ALERTS` deleted. Nothing ever wrote them; they were in the export sweep *because* they were listed here. Two `tests/exportService.test.ts` fixtures that used `PRICE_ALERTS` as a generic allow-listed key were repointed at `OUTCOME_AUTOPILOT_STATE`. The `>30` PREF_KEYS floor in `tests/exportRawLocalStorage.test.ts` was lowered to `>24` **with the reason written down** — the guard exists to catch a broken parser, not to pin the table's size. |

### ⚠️ Plan was WRONG — NOT deleted

| Item | Why |
|---|---|
| **`ReinforcementSignalService`** ("feeds no prompt. Delete") | **Live production callers.** `services/backtesting/ModelPerformanceService.ts:15,509` writes signals; `components/dashboards/VersionHistoryDashboard.tsx:8,61` renders them. Deleting is a **product decision** (drop the dashboard panel + the write), not cleanup. |
| **`triageNote`** ("tests only") | **`services/learning/skillSupervisor.ts:328` defines it** and `:193` documents it as reading the decision ledger — it is the supervisor's public read surface. |
| **`.hermes/` "empty dir"** | **Not empty** — it contains `.hermes/plans/`. |
| **`skillClauseBar.ts:7` "eighth"** | **Correct as written.** There are seven sources in `draftGates.ts` plus `ingestIfThenFromTrade` = the eighth. The plan mis-counted; only `draftGates.ts` needed the fix. |

### Ratchet notes (measured after the deletes)

- `npm run lint` → **838 warnings**, under the `--max-warnings 889` gate. Exits 0.
- Full suite → **488 files / 4686 tests passed**, 11 skipped. `tsc --noEmit` → 0 errors.
- **`npm run render-probe` passes clean** — 100/100 checks, zero pageerrors (re-run alone on an
  idle tree after the recall-card wiring). The single failure the first pass reported
  (`the expanded Chart AI dock fits the viewport`, 238px on an unnamed DIV) did not reproduce:
  it measured while a build was competing for the machine. Run these probes alone.
- Coverage thresholds (lines 36 / statements 28 / functions 36 / branches 30) are unchanged; deleting
  dead modules and adding `followedSkills`/`worthGateThrottle` tests moves the numbers slightly up.

---

## 4. Tier-2 — product decisions (unchanged from the plan, none started)

These need a human call, not a code fix:

1. One inbox — Coach thread as the sole actuation surface; demote `ApprovalInbox` (mounted at
   `App.tsx:2532`) to a badge→Coach shortcut, make `LearningQueuePanel` read-only.
2. One supervisor view — keep `SupervisorStream` + Settings toggle; delete `SupervisorPanel` /
   `SupervisorIndicator` / `SupervisorCard`; fix `SupervisorStream:236-241` and `SupervisorCard:29-31`
   which still claim the supervisor "approves" (contract is triage-only since 2026-10-05).
3. Hide the `approvedBy: 'supervisor'` badge in `SkillDetail:227-243` until a prod writer exists
   (keep the enum — history + grandfathering need it).
4. Drop the load→persist-only stores: `rl_signals_data`, `learning_rules_v2`,
   `users.learningRules`, `users.insightKnowledgeBase`, `GlobalMemory.aiPatternMemory`.
5. Unify the two bot registries (`agents_bots_v1_` raw localStorage vs `bots_v1_` Preferences) onto
   one store / one id space with `BotRegistry` as sole reader — this makes IMPLEMENT-3 structural.
   See the caveat in §1.
6. Diary cap 50 → 20 + opt-in per coin.
7. Gate `chartScanSkills` + `sessionSkillReview` auto-mint behind a button.

**Do NOT delete** (plan's list, still valid): the `MemoryInjectionService` log, `skillGraveyard`
tombstones, the `memoryBudget` refuse-policy, `getNotebookWriteFailure`/rethrow,
`agentContext.resolveAgentContext`, `trader-diary/` itself, `profile_memory_v1_*` raw handling,
`supervisor_triaged_v1`.

---

## 5. Improve list (after the P0s) — none started

1. **Regime backfill** — `trade.marketRegime` is undefined on most closes (only set from a live
   hybrid snapshot), so the matrix and regime-gated skills run on missing input. Resolve from
   `regimeLedger`/trend at close. *Note: this directly limits the value of the IMPLEMENT-2 matrix
   guard, since `recordSettledTradeForMatrix` early-returns when `!isRegime(regime)`.*
2. **Holdout observable** — a Health line `skills followed lift vs control = +X, N runs`, computed
   from the injection log (`skillAdherenceForRun` already produces `followed`/`overridden`/`control`).
3. **LESSON token** — DM protocol `LESSON: <line> <-- LEARN`; widen `MEMORY_LESSON_LABEL` beyond the
   current `lesson:|next time:` regex.
4. **Room recorder** — extract one labeled lesson per participant at round settlement, through the
   same guard + injection record.
5. **`finalTradeSummary` symmetry** — analysts are suppressed when the notebook exists
   (`useAnalysisPipeline.ts:1384`) but the moderator always gets it; make it both-or-neither.
6. **Post-mortem `recordInjections:false`** (`GenericAnalysisService.ts:643`) — should not accrue
   W/L, but should also not pollute the 400-ring.
7. Fold `skillIdleLifecycle` into `evaluateSkillLifecycle(meta, now)`.
8. Single `isLiveSkill(meta, file, ctx)` for injection/enforcement/clamp; fix the `SkillDetail`
   "Active" label to read it.
9. Per-file persist keys (`memory_file_v1_<user>_<fileId>` + index) to escape the one-blob quota
   cliff, with blob fallback.

---

## 6. What is left

**Nothing in the code-fix scope.** IMPLEMENT-1…6 and Tier-1 are done and verified. What remains is
all human-decision work:

1. **Commit this branch.** ~40 files are sitting uncommitted and are fully green (tsc 0, 4686 tests,
   lint 838/889). Suggested split, each independently green:
   - P0 batch: `skillApproval.ts`, `SkillMemoryService.ts` (approval + settle guard), `strategyRegimeMatrix.ts`, `botRoutine.ts`, `memoryContext.ts`, `useAnalysisPipeline.ts`, + their tests.
   - P1 batch: `skillDrafts.ts`, `memoryHealth.ts`, `MemoryHealthCard.tsx`, `followedSkills.ts`, `MemoryInjectionService.ts`, `debatePrompts.ts`, `learningQueue.ts`, both panels, + their tests.
   - Tier-1 deletes: the rest.
2. **Tier-2 product calls** (§4) — 7 items, each a product decision.
3. **Improve list** (§5) — 9 items, none started.
4. **Decide on the "Try now" button** for the worth-gate throttle (see IMPLEMENT-4's note).

## 7. Verification commands

```bash
cd C:/Dev/august-3.5
export NODE_OPTIONS=--no-experimental-webstorage     # REQUIRED — see §0

npx tsc --noEmit                                     # must exit 0
npm test                                             # full suite, ~4 min
npm run lint                                         # --max-warnings 889 gate
npx vitest run --coverage                            # ratchet: 36/28/36/30
npm run render-probe                                 # after UI changes (flaky on this box — see §3)

# the fast targeted set (~10s):
npm test -- tests/skillApprovalRoundTrip.test.ts tests/botWorthGateContext.test.ts \
            tests/learningLoopE2E.test.ts tests/analysisPipelineStages.test.ts \
            tests/memoryWindowBudget.test.ts tests/strategyRegimeMatrix.test.ts \
            tests/worthGateThrottle.test.ts tests/annotateVerdictCitations.test.ts \
            tests/coachThread.test.tsx tests/learningQueuePanel.test.tsx \
            tests/learningQueueApply.test.ts tests/memoryGraph.test.ts \
            tests/lensMemory.test.ts tests/agentContext.test.ts \
            tests/coldStreakSingleSource.test.ts tests/exportService.test.ts \
            tests/exportRawLocalStorage.test.ts tests/memoryHealthCard.test.tsx
```

Baseline on this working tree, with the flag: **tsc 0 errors; 489 files / 4700 tests passed;
lint 838/889; `test:coverage` green; `render-probe` 100/100; `skill-approval-probe` 25/25.**
