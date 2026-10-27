# STATUS — the August Trading harness build-out

**Owner mission:** make August Trading a trading *work* harness (analysis, planning, tracking,
review, learning), not a chat window. Phase 0 audit: [docs/AUDIT.md](AUDIT.md). Findings are cited
by their audit id (`M-1`, `L-3`, `T-2`, `A-4`, …) and each item records what changed, how it was
verified and what was deferred.

**Rules this pass works under:** verify live, not from docs; behaviour-preserving unless the change
is listed as intentional; simple beats clever; no SQLite for trade review; one commit per item; no
real API keys and no real orders in any test.

**Baseline at HEAD `8f2565e4`:** `typecheck`, `typecheck:scripts`, `typecheck:electron`,
`check:contracts` (138 passed), `check-flow-doc-anchors` (451 anchors + 20 reach controls),
`lint` (0 errors / 379 warnings, cap 379), `build` (18.65s) — all green. The gates are green **and**
the audit found 23 defects, which is the whole reason this list exists: none of these are compile
errors.

**Regression strategy.** There is no unit suite on this branch and `check:contracts` must not grow
into one. Each fix gets its check in the place that can actually see it: a browser probe for
behaviour the app renders or persists, and `check:contracts` only if the contract is pure logic
reachable without a DOM. Every fix is first proven **red** by reproducing the defect, then green.

---

## Phase 0 — audit (complete)

| item | what changed | how verified | deferred |
|---|---|---|---|
| **P0-1 audit** | `docs/AUDIT.md` written: eight domains, 23 defects with `file:line`, tool inventory measured in the running app (41 desk + 9 chart + 2 mail, 46,597 chars of schema), feature Keep/Fix/Remove/Merge matrix, Phase 3 candidate judgement, live-vs-static confidence labels | read at HEAD, not from docs; 9 defects reproduced in Chromium against the real app (dev server + `scripts/mock-provider.cjs`, external hosts aborted, zero page errors); the two delegated claims that did not survive are corrected in the doc (training export is a missing prop, not a dead feature; the old skill-proposal bug is genuinely fixed) | the `render-probe`, `boot-probe` and `skill-approval-probe` suites were not run this pass; real providers, the packaged shell, Capacitor and live OKX/Binance responses are unverified and claimed nowhere |

**Two delegated claims I corrected rather than propagated** — recorded because the mission says verify
live and because agents invent citations:

- *"Training export permanently disabled."* False as stated. `SettingsMenu.tsx:566-571` omits
  `loggedTrades`, so `ActionsTab.tsx:19` defaults to `[]` and the button is disabled **at that mount**;
  the label, `disabled` binding and export call are correct. One-line Fix (item **F-9**).
- *"The skill proposal tool is still broken."* The bug the owner reported is substantially fixed at
  HEAD — approval reads the library back, names refusals, leaves the draft on failure, claims an unused
  slug on collision, stamps `approvedBy:'human'`, and `scripts/probe-skill-approval.cjs:375-444` asserts
  notebook bytes. What is still broken is the **retry after a failed write** (**M-1**, item **F-1**),
  proven live.

---

## Phase 1 — fix, in order of blast radius

### Landed

**F-1 — a failed notebook write no longer leaves a phantom row** (audit **M-1**).
`services/learning/MemoryFilesService.ts:918-938` — `createMemoryFileUnlocked` pushed the new file
into `memoryCache` and then awaited `persist()`, which rejects on a full origin quota. The bytes
never reached storage, but the cache kept describing them for the rest of the session, and
`approveSkillDraft`'s read-back asks the *library* whether a trigger is present. So the retry of a
failed Save answered `{reason:'duplicate'}` → the toast read **"Already learned"** →
`takeSkillDraft` deleted the trader's only copy of the proposal, with nothing on disk. The fix rolls
the cache mutation back with the failure and re-measures, so the store can only assert what it holds.

*Verified:* red and green in the same session, same page, **no reload** (a reload would wipe the
cache and pass for the wrong reason). Before — `first: write-failed`, `retry: duplicate`,
`drafts: 0`, `cached: true`, `durable: false`. After — `first: write-failed`, a second press **while
storage is still full** also answers honestly and keeps the draft (`drafts: 1`, `cached: false`), and
once storage frees the same draft lands (`created: true`, `durable: true`, `drafts: 0`). Zero page
errors. `typecheck`, `typecheck:scripts`, `node --check` on the probe all 0; eslint reports 0
problems on both changed files, so the warning ratchet did not move.
*Regression added:* `scripts/probe-skill-approval.cjs` case 4 now retries after the injected failure
and asserts the STORED notebook bytes, not the toast (3 new checks). **Not yet run** — a leftover
`scripts/mock-provider.cjs` from another session holds this probe's hardcoded `:8787` with live
connections, and the probe's own boot would then be served by that stale process, which is
unattributable. It runs in the full gate pass once `:8787` is free; the browser proof above is what
stands behind "done" for now.
*Deferred:* the same class on the **delete** paths — `deleteMemoryFileUnlocked:996` and
`deleteMemoryFolderUnlocked:867` remove rows before persisting, so a quota-rejected delete leaves the
UI showing a note gone while disk keeps it (the inverse lie, and privacy-adjacent). Not swept into
this commit: a rollback needs a per-mutation snapshot, and the create path is the one that destroys
the user's work.

### Pending

Status legend: `pending` · `in-progress` · `done`.

| # | item | audit id | status |
|---|---|---|---|
| **F-1** | A failed notebook write must not leave the bytes in the cache, so a retried approval cannot report "Already learned" and delete the trader's draft | M-1 | **done** — see the record below |
| **F-2** | One 429 must not lock every Chat-surface send for the session; the reset must be keyed to the cooldown, not to a run registration the `finally` already deleted | L-1 | pending — CODE |
| **F-3** | Forward `onToolPayload` into the desk loop so the transcript can persist and open a tool's real output | L-3 | pending — CODE |
| **F-4** | Isolate a Monte Carlo worker crash to its own worker (`pending.worker` is already tagged; `ejectWorker` already exists) | T-3 | pending — PROVEN red |
| **F-5** | Profile switch must pause every save path and adopt identity + data atomically, so profile B is never written into profile A's store | L-2 | pending — CODE |
| **F-6** | Give `withinToolDeadline` a child `AbortController` and propagate it through every call site; forward `context.signal` to the screener | T-1 | pending — PROVEN red |
| **F-7** | A forged-tool proposal must report what storage actually did, and the manager UI must surface the failure without turning a telemetry-write error into a false "the request failed" | T-5 | pending — PROVEN red |
| **F-8** | `digestToolResult` must distinguish *unavailable* from *empty* (a real zero keeps printing zero) | T-2 | pending — PROVEN red |
| **F-9** | Pass `loggedTrades` into Settings → Data so training export is reachable, and prove the button enabled with a row present | §8 | pending — CODE |
| **F-10** | The screener must not call a successful empty scan a universe failure | T-9 | pending — CODE |
| **F-11** | Fix the double halving: the engine's blended exit is the single source, `buildWinResolution` drops its second `scaleOut` | A-4 | pending — PROVEN red |
| **F-12** | The weekly digest must print "dollars not captured", not `$0` | A-5 | pending — PROVEN red |
| **F-13** | Import validation must reject `analysis: null`, and the export must not deref it | A-7 | pending — PROVEN red |
| **F-14** | `get_trade_log`: honour the logged time it advertises, and add a bounded record mode | T-4 | pending — PROVEN red (semantics) |

**Second wave (same phase, after the sixteen above):** L-4 cancelled-row settlement · L-5 desktop SSE
errors and the raw/visible slice · L-6 durable interruption recovery · L-7 the three global run owners
· L-8 the discarded `enhancedPrompt` (wire or delete, do not leave it computed) · L-9 turn budget truth
· L-10 the two definitions of provider readiness · M-2 the learner's sensitive-memory bypass · M-3 the
dock's memory toggle + budget · M-4 amendments approved without being applied · S-1 duplicate approval
that does not activate · S-2 evolution losing `predicate`/`description` · S-5 bundle collision ·
S-6 receipts without read-back · A-6 settlement provenance · A-8 one clock.

## Phase 2 — remove (proven dead only, separate commits, function rehomed first)

| # | item | audit id | status |
|---|---|---|---|
| **R-1** | `ARBITER_ALLOWED_TOOLS` — zero importers | T-8 | pending |
| **R-2** | `gateInjection` empty literal + the `if` it feeds | L-8 | pending |
| **R-3** | Compare / reanalysis / simulator overlays — orphan openers; keep the Monte Carlo service | §8 | pending |
| **R-4** | Default `NavRail` — **after** rehoming the update download (a container is not a delete list) | §8 | pending |
| **R-5** | `learning_rules_v2_<user>`: written and backed up, read by no prompt — needs the reader or the removal, not a third state | M-5 | pending (owner call) |
| **R-6** | Dead debate vocabulary in `deskToolsMandateFor` and the `Debate*` names on live panel/group code — rename, do not delete | T-7, §5 | pending |

## Phase 3 — add what the audit shows is genuinely missing

| # | item | audit id | status |
|---|---|---|---|
| **N-1** | `ask_user_input`: 1–3 inline tappable questions, suspend/resume, timeout, real cancel. Nothing to repair — no tool, no schema, no lifecycle exists | L-11 | pending |
| **N-2** | OKX trade-history import (CSV carries stop moves and order modifications; UTC+8; screenshot/PDF are vision/text paths, not structured ingestion) | §9 | pending |
| **N-3** | Durable trader profile: promote the fields the trader must own into profile memory instead of adding a fourth store; the boot `profile/memory.md` is regenerated, so it cannot be the authority | §2, §9 | pending |
| **N-4** | Track every accepted plan, not only the active conversation's pending messages | §6 | pending |

Deliberately **not** added, because the audit shows they already exist: plan→approve→track-to-outcome,
proposals + weekly digest, training JSONL (once F-9 lands), `get_trade_log` with a last-20 view (once
F-14 lands).

## Phase 4/5 — memory/tools/skills done well, and UI polish

Consolidation follows the fixes, never precedes them: one memory system of record and one write path
(after M-1/M-3/M-4/R-5), tool naming and description truth (T-7), streaming progress for anything over
~2s, compact long sessions without losing the active plan or open trades, then the minimalist pass —
the `JobsDrawer` "Nothing running" merge, the hardcoded status badges, the phantom nav affordance, and
the unreachable update/download action.

---

## Owner decisions recorded, none blocking

1. **Clock** — default: UTC+8 for every day/week the trader reads; `timestamp` stays the write time.
2. **TP1→breakeven / multi-TP exit** — default: the engine's blend is the one source; delete the
   autopilot's second halving. The 50/50 blend and the 150 % zone remain policy, not measurement.
3. **Journal corrections** — default: recompute and append correction evidence; never keep an old label
   beside a new R.
4. **Tracking scope** — default: every accepted plan, persisted.
5. **Comprehensive candidate log (D-24 / O-14 / E-42b)** — stays deferred as ruled; `decline_trade`'s
   bounded ledger is not that thing.
6. **Removals** — default: remove the two orphan overlays; rehome-then-remove `NavRail`; leave
   `GallerySaver` alone (half-built, may be wanted).
7. **Training JSONL schema** — default: export the superset (`decidedAt`, `netR`, `costR`, correction
   provenance) and move `followedPlan` under `review`.

## Limits of this pass

Everything marked CODE is a source-and-call-chain proof, not a runtime one. Verified live means:
`chat_completions` against the local mock provider, in Chromium, on a seeded profile, with external
hosts blocked. Not verified live: real providers, the other three API formats, the packaged Electron
shell and `installer-smoke`, native key storage, Capacitor, live exchange responses, real token
counts, and whether `web_search` is reachable from this network.
