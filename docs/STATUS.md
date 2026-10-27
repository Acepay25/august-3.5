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

**F-2a — a streaming provider failure keeps its HTTP status** (audit **L-1b**).
`services/providers/GenericProviderService.ts:2101-2116` — the thrown error copied `status` only when
the provider's JSON body had a top-level `status` field. An OpenAI-compatible 429 body is
`{error:{message,type,code}}`, so `error.status` was never set and the message became
`Provider stream failed (429).`, which `classifyRunFailure`
(`hooks/analysisPipeline/runOutcome.ts:48`) matches against neither `status === 429` nor "Too Many
Requests". Every streaming 429 was filed as a generic failure: the 60s backoff and the queue's
"transient, retry with backoff" contract could not run on the path every desk turn uses.
`withRetry` rethrows the original error untouched (`utils/apiErrorUtils.ts:222`), which is how the
loss was isolated to the throw site rather than the wrapper.

*Verified:* **PROVEN red before the fix** — three consecutive Chat-surface turns each ended
`REQUEST FAILED / Mock: Provider stream failed (429).` and the next two sends went straight to the
provider ~2s later and were answered, i.e. no backoff existed. A passing control (a plain send
answered 0→1 reply rows) rules out the probe itself. Zero page errors.
*Deferred:* the fix makes the classification correct; it does not add a `Retry-After` read, so the
cooldown is still a flat 60s rather than the interval the provider asked for.

**F-2b — the 429 cooldown belongs to the flag, not to the run that tripped it** (audit **L-1**).
`hooks/useAnalysisPipeline.ts:330-345,1303-1316` — the reset timer's guard
(`runsRef.get(key)?.controller === theRunThatFailed`) can never pass, because the run's own `finally`
deletes the registration first, and a newer run holds a different controller. Since the send guard
returns on `isRateLimited` **before** the `setIsRateLimited(false)` further down, an armed flag would
block every conversation until reload. Replaced with a monotonic epoch, which preserves the protection
the original comment wanted (a stale timer cannot clear a cooldown it did not arm) without depending on
run lifetime. The 60s is now named `RATE_LIMIT_COOLDOWN_MS`.

*Verified:* `npm run typecheck` 0; eslint unchanged per file (51 and 23 problems at HEAD and in the
tree — the ratchet is at its 379 cap, so this was measured, not assumed).
**Honest limit:** I could not reproduce the permanent lock live, because L-1b meant no streaming 429
ever armed the flag; after F-2a the Chat-surface sends still went through (measured: the send ~2s
after a triple-429 turn reached the provider and was answered), so this path does not arm it either.
The defect is airtight by reading and the fix is small, but it ships **unproven in the browser** —
recorded rather than claimed as verified. The follow-up that would close it is a probe that arms the
flag on a path which classifies a rate limit at all (the buffered `sendChatRequest` route), which needs
a mock that answers the buffered analysis call with a `status`-bearing 429 body.
*Decision recorded:* the cooldown is global, not per provider/model — one 429 from one provider backs
off every conversation. Narrowing it is an owner call (decision 8), so the behaviour is preserved.

**F-3 — the desk loop receives the payload sink** (audit **L-3**).
`services/analysis/DeskToolsService.ts:4966-4992,5162` — the wrapper's option destructure never named
`onToolPayload`, so it landed in the `...chatOptions` rest-spread and was forwarded to the loop inside
`options`, while the loop reads it off its **own** parameters (`:4370`). Its single emission site is
guarded by `if (onToolPayload)` (`:4722`), so the guard was false on every real turn: the store, the
failure recording, the transcript id, the row expander and the CSV column were all correct and starved.
Now destructured and passed at the loop's top level, with a comment naming the rest-spread trap.

*Verified:* **red and green with the same driver, the same turn, and one line changed.** As shipped:
`PAYLOAD_STORE present:false rows:0`, persisted `toolIds: ["",""]` (no id, so the row cannot open).
After: `present:true rows:1` (`get_market_packet`, 124 chars kept) and
`toolIds: ["","call_mvqvtxif"]`. The turn itself was identical across both runs (settled, one reply,
16 provider calls, zero page errors), which is what makes the pair a measurement of the sink rather
than of the network. A market read that was refused by the blocked egress still counts: the defect was
that *no* result was ever persisted.
*Deferred:* the durable browser assertion. This repo's tool-bearing probe is `render-probe`, and
`:8787` is currently held by another session's leftover mock — running it now would be served by that
stale process, which is unattributable (see the project probe-hygiene note). The step goes in with the
consolidated gate pass; the scratch driver at
`%TEMP%/august-payload-probe.cjs` is what stands behind "done" for now.

**F-4 — one crashed Monte Carlo worker no longer cancels everyone's simulation** (audit **T-3**).
`services/analysis/MonteCarloService.ts:810-829` — `onerror` rejected **every** entry in
`pendingRequests` and called `dropPool()`, justified by a comment claiming "pending ids are not tagged
per worker". They have been tagged since `:787-793` (`pending.worker`), and `ejectWorker` (`:851`)
already implemented the surgical version for the timeout path; this handler simply never moved. Now it
rejects only the entries belonging to the worker that died and ejects that worker. `dropPool` was left
with no caller by the change, so it is deleted in the same commit rather than shipped as a new warning
against a ratchet that is exactly full.

*Verified:* red measured at HEAD (`outcomes: ["audit worker crash","audit worker crash"],
terminated: [true,true]` — a request the healthy worker had already answered was rejected, and a live
worker was terminated), green after (`["audit worker crash","fulfilled"], [true,false]`), same mock-
Worker driver, zero page errors. `typecheck` 0; eslint unchanged (1 pre-existing `any` warning at
`:788`, same at HEAD and in the tree).
*Deferred:* the synchronous fallback on a timed-out worker still runs on the main thread; its stall
cost was never measured, so it is recorded as unmeasured in the audit rather than "fixed".

**F-8 — the transcript line now says when nothing was read** (audit **T-2**).
`services/analysis/DeskToolsService.ts:836-882` — `digestToolResult` branched on `ok` only. A market
service that cannot reach the exchange returns a *shape* with `available:false` and `ok:true`
(deliberately — "the desk is broken" is the belief that makes a seat retry a retired endpoint for the
rest of a run), and `web_search` returns a `DATA_UNAVAILABLE:` sentinel inside an `ok:true` result. Both
fell through to the numeric digest and printed what an empty read looks like. Now an explicit
unavailability check runs before any number is derived, with the store's machine reason tokens mapped
to words (`source_retired` → "the exchange retired this endpoint") because a transcript row must never
print an identifier as its label.

*Verified:* red at HEAD — `liquidations · 0 recent events · $0k`, `order book · buy wall — · sell wall
—`, `web search · ok`. Green — `liquidations · unavailable — the exchange retired this endpoint`,
`order book · unavailable — not read`, `web search · unavailable — not read`. **Controls in the same
run**, because a fix that only ever says "unavailable" has moved the lie rather than removed it:
`available:true` with no events still prints `0 recent events · $0k`, and a real wall still prints
`buy wall $1200k @ 94,800`. Zero page errors. `typecheck` 0, `check:contracts` 138 passed, eslint
unchanged.
*Deferred:* the row's *colour*. A `· failed` line renders rose; an unavailable line renders neutral
with the words, which is the honest minimum. Adding a fourth visual state is a UI decision, not a fix.

**F-9 / F-11 / F-12 / F-13 — four small, measured fixes** (audits §8, **A-4**, **A-5**, **A-7**),
landed as four commits so each reverts alone.

| item | change | measurement |
|---|---|---|
| **F-9** | `components/settings/SettingsMenu.tsx:568-575` now passes `loggedTrades`, which is what `ActionsTab` uses to decide the button is live | the audit's delegated claim "permanently disabled" was wrong as stated: the label, the `disabled` binding and the export call are correct, only the prop was missing at this mount |
| **F-11** | `services/ui/OutcomeAutopilotService.ts:484-495,521-534` — the second `0.5` factor and the duplicated TP-midpoint blend are deleted; `resolution.exitPrice` is the engine's blend and stays the only one | entry 100 / SL 90 / TP1 110 at 10×: **25 % → 50 %**, `realizedR` still 0.5, so the row no longer books two money figures for one exit |
| **F-12** | `services/learning/weeklyReview.ts:50-53,84-108` records `dollarRows` and exports one derivation (`weekPnlCaptured`/`weekPnlText`) used by both the coach prompt and `WeeklyReviewCard` | percent-only closes: `captured:false`, text `not captured` (was `Net $0`); control with `pnlAmount:42` → `$42` |
| **F-13** | `utils/profileUtils.ts:24-33` checks every row and requires a non-null `analysis`; `utils/reportExport.ts:38-60` falls back to empty plan cells instead of deref'ing | `nullAnalysisRejected:true` where HEAD answered `nullAnalysisAccepted:true`; a legacy row still exports rather than throwing |

*Gates for the batch:* `typecheck` 0, `check:contracts` 138 passed, `npm run lint` 0 errors /
**379** warnings — exactly the baseline cap, so nothing was spent. Zero page errors in the live run
that produced the numbers above.

*Deferred:* F-11's neighbours stay open and are **not** silently fixed here — the verifier still passes
`startIndex` and so bypasses the engine's same-candle entry-ambiguity guard
(`AutoCaptureService.ts:387` vs `outcomeEngine.ts:179-197`), and a TP1→breakeven result still reports
the TP candle as `exitCandleIndex`, which truncates the MAE/MFE window. Both need the fill-policy
decision (decision 2) before a change is defensible. The monthly report has its own `$0` sum and was
left alone rather than swept into F-12's commit.

**F-10 / R-1 / R-2 — one false message and two deletions.**

- **F-10** `services/trade/screener.ts:147-155` — the digest for an empty row list
  claimed "universe fetch failed; treat as UNKNOWN". The tool path already checks
  `scan.universeFailed` and says UNKNOWN before this formatter is ever reached, and
  `screenerToMarkdown` has exactly one caller (the desk tool, verified by grep), so an
  empty array here can only mean a healthy scan that filtered to nothing. Measured:
  `SCREENER — 0 rows: the scan completed and nothing met this filter…`.
- **R-1** `services/analysis/DeskToolsService.ts` — `ARBITER_ALLOWED_TOOLS` deleted
  (re-grepped at delete time: the definition and one comment, no importer; the arbiter
  it configured went with the debate engine). The comment that named it as an allow-list
  source now names only the lists that still exist, because a stale name in a doc comment
  reads as a live caller.
- **R-2** `hooks/useAnalysisPipeline.ts:1080-1087` — `const gateInjection = ''` and the
  `if (gateInjection)` branch it fed deleted: a literal the compiler can prove empty,
  standing beside a `devLog` line claiming constraints were injected.

*Gates:* `typecheck` 0, `npm run lint` exit 0 with 0 errors / **379** warnings (its real
exit taken unpiped — a piped exit code would have been tail's, not lint's), live audit
re-run with zero page errors and the tool inventory unchanged at 41 desk + 9 chart + 2
mailbox, which is the control that says R-1 removed nothing the desk offers.

### Pending
Status legend: `pending` · `in-progress` · `done`.

| # | item | audit id | status |
|---|---|---|---|
| **F-1** | A failed notebook write must not leave the bytes in the cache, so a retried approval cannot report "Already learned" and delete the trader's draft | M-1 | **done** — see the record below |
| **F-2a** | A streaming provider failure must carry its HTTP status, or a real 429 is filed as a generic error and no backoff ever arms | L-1b | **done** — PROVEN |
| **F-2b** | One armed 429 must not lock every Chat-surface send for the session; the reset is keyed to a cooldown epoch, not to a run registration the `finally` already deleted | L-1 | **done** — CODE-certain, live lock not reproducible (see record) |
| **F-3** | Forward `onToolPayload` into the desk loop so the transcript can persist and open a tool's real output | L-3 | **done** — PROVEN red and green |
| **F-4** | Isolate a Monte Carlo worker crash to its own worker (`pending.worker` is already tagged; `ejectWorker` already exists) | T-3 | **done** — PROVEN red and green |
| **F-5** | Profile switch must pause every save path and adopt identity + data atomically, so profile B is never written into profile A's store | L-2 | **done** |
| **F-6** | Give `withinToolDeadline` a child `AbortController` and propagate it through every call site; forward `context.signal` to the screener | T-1 | **done — PROVEN red and green** |
| **F-7** | A forged-tool proposal must report what storage actually did, and the manager UI must surface the failure without turning a telemetry-write error into a false "the request failed" | T-5 | **done — PROVEN red and green** |
| **F-8** | `digestToolResult` must distinguish *unavailable* from *empty* (a real zero keeps printing zero) | T-2 | **done** — PROVEN red and green, with controls |
| **F-9** | Pass `loggedTrades` into Settings → Data so training export is reachable, and prove the button enabled with a row present | §8 | **done** |
| **F-10** | The screener must not call a successful empty scan a universe failure | T-9 | **done** |
| **F-11** | Fix the double halving: the engine's blended exit is the single source, `buildWinResolution` drops its second `scaleOut` | A-4 | **done** — PROVEN red and green |
| **F-12** | The weekly digest must print "dollars not captured", not `$0` | A-5 | **done** — PROVEN red and green, with control |
| **F-13** | Import validation must reject `analysis: null`, and the export must not deref it | A-7 | **done** — PROVEN red and green |
| **F-14** | `get_trade_log`: honour the logged time it advertises, and add a bounded record mode | T-4 | **done — PROVEN red and green** |

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
| **R-1** | `ARBITER_ALLOWED_TOOLS` — zero importers | T-8 | **done** |
| **R-2** | `gateInjection` empty literal + the `if` it feeds | L-8 | **done** |
| **R-3** | Compare / reanalysis / simulator overlays — orphan openers; keep the Monte Carlo service | §8 | pending |
| **R-4** | Default `NavRail` — **after** rehoming the update download (a container is not a delete list) | §8 | pending |
| **R-5** | `learning_rules_v2_<user>`: written and backed up, read by no prompt — needs the reader or the removal, not a third state | M-5 | pending (owner call) |
| **R-6** | Dead debate vocabulary in `deskToolsMandateFor` and the `Debate*` names on live panel/group code — rename, do not delete | T-7, §5 | pending |

## Phase 3 — add what the audit shows is genuinely missing

| # | item | audit id | status |
|---|---|---|---|
| **N-1** | `ask_user_input`: 1–3 inline tappable questions, suspend/resume, timeout, real cancel. Nothing to repair — no tool, no schema, no lifecycle exists | L-11 | **done — PROVEN end to end** |
| **N-2** | OKX trade-history import (CSV carries stop moves and order modifications; UTC+8; screenshot/PDF are vision/text paths, not structured ingestion) | §9 | pending |
| **N-3** | Durable trader profile: promote the fields the trader must own into profile memory instead of adding a fourth store; the boot `profile/memory.md` is regenerated, so it cannot be the authority | §2, §9 | pending |
| **N-4** | Track every accepted plan, not only the active conversation's pending messages | §6 | **done** |

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
8. **Rate-limit scope** — the 60s cooldown is global, so one provider's 429 backs off every
   conversation. Default: preserved (F-2b changed only when it releases, not what it covers). Narrowing
   it to provider+model, and honouring a `Retry-After` the provider sends, are both trader-visible
   changes.

## Session 4 — the last Phase-1 hole, Phase 2 removals, and the first Phase-4 items

| item | change | proof |
|---|---|---|
| **L-7 (routing)** | a watch records the dock session that armed it; the queue keeps it per signal; the panel drains only the signals for the session on screen and switches to the owner when the queued wakes belong to another chat. Unbound signals (a level hit from a conversation, an older watch) drain to the active session exactly as before | CODE — the one-transcript model is preserved: the answer lands in the right thread instead of the visible one |
| **R-4** | `NavRail` deleted. Its live half (three layout constants + `AccountRow`) moved verbatim to `components/shell/shellChrome.tsx`; the update download — which *only* its dead JSX hosted — is now mounted in the header beside the status cluster; `render-probe` reads the sidebar width from the new module | anchors repaired from the gate's findings; typecheck/lint/build green |
| **R-6** | `DebateMailbox` → `PanelMailbox` (file, interface, factory, tool list), with the old name recorded in the header. The mailbox is live — panel cross-talk and group rounds use it — and a name that implies a deleted caller reads as "safe to delete" | grep: 7 references, all updated; anchors green |
| **Update-trade flow** | deleted with its modal, state, both handlers, its capture-busy flag and the two bindings only it used: both openers had zero callers, so the overlay and its write path were unreachable | lint fell 376 → 375 |
| **Phase 4 — tool progress** | every tool call that outlives `SLOW_CALL_NOTICE_MS` (2 s) emits ONE "still working" line through the loop's existing tool channel; deadline, receipt and digest untouched | **PROVEN live**: a 3-second call under a 5-second deadline fired the notice exactly once and still returned ok |
| **Phase 4 — full-body recall** | a notebook note whose NAME matches the topic is served whole (bounded at 4k with the clipping note), so the topics index finally has a reader that can show the second paragraph | **PROVEN live**: `recall('funding note')` returned the body including its second paragraph (190 chars) |
| **Phase 5 — activity drawer** | "Nothing running" renamed to what the list actually is — completed skill audits — with the distinction in the header and the empty state | CODE |

### Phase 4 audit against the mission's list

- **Memory**: one notebook + one profile store, both with a write path that records and rethrows
  failures, a recall path (now includes full note bodies), a topics→detail UI with edit and delete
  (profile editor added in N-3), duplicate/conflict handling (`rememberWithConsolidation`, the
  notebook hygiene pass), and injection under `promptIndexBudget` in both homes.
- **Tools**: one naming vocabulary (`toolKinds`), one digest grammar, hard per-call deadlines with
  real cancellation, structured errors the model can act on, and progress for anything over 2 s.
- **Skills**: lazy catalogue (names + descriptions only), a trigger description that is the
  retrieval key, human-gated creation with a byte-checked approval, self-review via the supervisor,
  and one-step undo that now restores the predicate as well as the prose.
- **Context**: compaction keeps the system prompt, the newest user turn (which carries the desk
  context block: the active plan, open trades and the rules), and repairs split `tool_calls` pairs.
  Nothing else is pinned — a second pinning mechanism over the same block would be machinery
  without a job.

### Gate state — all green

`typecheck` 0 · `typecheck:scripts` 0 · `typecheck:electron` 0 · `check:contracts` 138 ·
`lint` 0 errors / **375** warnings (4 below the cap) · `build` 19.23 s · `check-flow-doc-anchors`
**OK, 458 anchors** · live driver: deadline, forge, worker isolation, journal clocks, digests,
skill retry, ask-input, note recall and the slow-call notice all green, zero page errors.

### Still open

**Phase 2:** R-5 is resolved as a KEEP (the learned-rules store now has a prompt reader, landed in
session 3). R-4's `render-probe` run itself has not been executed in this session (the port pair is
contended); the module move is gated by typecheck + the probe's own read-back pattern.
**Phase 5:** the remaining polish is the owner's restyle territory — nothing in the audit is proven
broken there beyond the drawer copy, which is fixed.

## Session 3 — the rest of the second wave, Phase 2, and the anchor gate

| item | change | proof |
|---|---|---|
| **L-4** | group rooms bumped the run nonce before aborting, so cancelling skipped its own row settlement; panel seats settled only when not aborted; the pipeline's failure path settled without flushing its pending RAF chunk | CODE, three sites, one shape — a stopped row now settles in every owner |
| **L-5** | the desktop SSE parser recognises `{error:…}`, `{type:'error'}` and `{type:'response.failed'}` in all three formats; main throws with the provider's words and status; the Electron tail is appended only when the painted text is a real prefix of the raw text | **PROVEN** by a Node probe: one synthetic frame per format, all three yield an error event and end the stream |
| **L-6** | hiding/unloading the tab writes the in-flight turn's partial text as an interrupted row; the loader settles any stored `isStreaming:true` row | CODE — the two halves of "a killed turn reloads into nothing" |
| **L-7** | the truncation tally moved from a process-wide slot to a per-run frame carried to the transport as a callback; the paint throttle coalesces per conversation+row instead of one global pending slot | CODE — no reset to race, no overwrite between threads |
| **L-9** | past the 180s budget no new lookup runs (forged or built-in): each pending call gets a receipt, the seat is told, and the round loop ends | CODE |
| **S-3 / S-4 / S-5 / S-6** | shadow evidence states whose record it is; suppression and conflict share ranked retrieval's approval gate; a renamed import keeps its bundle and a bundle read stays in its folder; both draft receipts read storage back | CODE |
| **M-5** | the journal's learned rules finally reach a seat, in BOTH homes, budgeted and behind the memory switch | CODE |
| **M-6** | the never-called verdict annotator and its orphans are deleted; attribution runs through `Message.injectedSkills` → settlement reflection | CODE |
| **T-7** | mandate and `forge_tool` stop describing a debate desk and a schema they cannot honour; the forged-tool route matches the app's real one | CODE |
| **A-6 / A-8** | plan provenance and `planId` survive both settlement paths; discipline buckets and report dates use the Philippines day key | CODE |
| **R-3** | the compare modal and the scenario simulator are deleted with their exclusive files — both proven unreachable by grep, not by appearance | CODE |
| **N-3** | profile memory rows are editable through the store's optimistic lock, stamped `stated` | CODE |
| **Anchor gate** | 70 comment-landing citations, 26 symbol misses and 7 stale anchors repaired from the gate's own findings; genuinely wrong numbers (restore_goal, LearnView, settleSelfChanges) corrected; self-quota restated last | **GATE GREEN**: 462 anchors verified, 0 unattributed, 0 comment, 0 symbol miss, 0 stale |

### Gate state — all green

`typecheck` 0 · `typecheck:scripts` 0 · `typecheck:electron` 0 · `check:contracts` 138 passed ·
`npm run lint` exit 0, 0 errors / **376** warnings (three BELOW the 379 cap, because removals took
warnings with them) · `build` 24.62s · `check-flow-doc-anchors` **OK, 462 anchors** · final live audit
run: every probe green, zero page errors.

### Still open

**Phase 1:** L-10's remaining routing hole is closed but the harness-event routing in L-7 (a watch
that fires after a thread switch runs in the active session) is still as before — the watch carries no
session binding. L-5's Electron path is proven in Node, not in a packaged app.
**Phase 2:** R-4 (`NavRail` after rehoming the update download — a UI move, not a delete), R-5 (the
rules store now HAS a reader, so it is a keep rather than a removal), R-6 (the `DebateMailbox` name on
live panel/group code — rename, no behaviour change), and the update-trade overlay whose openers are
equally dead but whose modal is wired into settlement helpers (a judgement, not a file delete).
**Phase 3:** N-2 (OKX import) — excluded on request.
**Phases 4–5:** not started. Phase 4 is memory/tools/skills made *good*; Phase 5 is minimalist UI
polish.

## (Historical) Gate state at the end of session 2 — one gate was RED, and it was mine

| gate | result |
|---|---|
| `typecheck` / `typecheck:scripts` / `typecheck:electron` | 0 |
| `check:contracts` | 138 passed |
| `npm run lint` | exit 0, 0 errors / **379** warnings (the baseline cap, spent by nothing I added — measured per file, HEAD vs tree) |
| `npm run build` | 0, built in 32.02s |
| live audit driver (Chromium, mock provider, egress blocked) | all probes as recorded above, `PAGE_ERRORS=[]` |
| **`check-flow-doc-anchors`** | **FAIL — 24 citations land on a comment line (ceiling 0)** |

**Why.** Almost every fix in this pass inserted or deleted lines *above* lines the flow docs cite —
the digest block adds ~40 lines over `DESK_TOOL_DEFINITIONS`, the arbiter deletion takes 25 away below
it, the gate deletion moves the pipeline by thirteen, and my own explanatory comments push code down
without changing its meaning. The gate compares a `file:line` citation against the bytes on that line
today, so a citation that was true at `8f2565e4` lands on one of my comments. Three citations I did
re-anchor (the `assemblePipelineMemoryContext` trio) plus ten symbol citations were moved by hand and
the census restated 451 → 454; that part is committed and holds.

**What is NOT the cause.** Seven further `STALE` anchors name `services/trade/chatTurnRunner.ts`,
which another session has uncommitted edits in. They are absent from a clean worktree at my HEAD, so
they belong to that work, not this one.

**Attempted and reverted, recorded so the next pass does not repeat it.** A content-match re-anchorer
(`%TEMP%/august-reanchor.cjs`) was written and run twice: unique-global match moved 22 citations and
the comment count went **up** (24 → 26, with 3 new symbol misses), and nearest-forward match reached 22
but kept 3 symbol misses. Both runs were reverted rather than committed, because a citation that jumps
to an unrelated identical `};` somewhere else in a 5,000-line file is worse than the stale one it
replaced, and a half-applied doc repair is worse than an honestly red gate. A Python variant of the
same idea crashed on this box's cp1252 console encoding mid-write and had to be rolled back too — the
script must be Node with explicit utf-8, as the surviving one is.

**The repair, for the next sitting.** For each citation the gate can see: read the doc's named symbol,
search the cited file for the *declaration or call site* of that symbol (not for the base line's raw
text — punctuation lines like `};` and `try {` match dozens of times), and rewrite only when exactly
one candidate is plausible. Iterate the gate after each batch; the census number is restated LAST,
because the gate polices its own quoted count. This is mechanical and does not need judgement about
the fixes — none of the 24 is a defect in the code.

## Limits of this pass

Everything marked CODE is a source-and-call-chain proof, not a runtime one. Verified live means:
`chat_completions` against the local mock provider, in Chromium, on a seeded profile, with external
hosts blocked. Not verified live: real providers, the other three API formats, the packaged Electron
shell and `installer-smoke`, native key storage, Capacitor, live exchange responses, real token
counts, and whether `web_search` is reachable from this network.

---

## Session 2 — the rest of Phase 1 through the first Phase-3 item

Landed since the pass above, each with the proof that stands behind it.

| item | change | measurement |
|---|---|---|
| **F-5** L-2 | readiness is lowered before a profile swap and raised only when data and identity agree; all four writers (data debounce, settings debounce, run heartbeat, unload flush) consult one predicate, at effect-body time **and** inside every timed write | CODE — the guard that only ever rose is now symmetric; no live switch-race reproduction (a delayed-migration harness is the follow-up) |
| **F-6** T-1 | every tool call gets a child `AbortController`; the signal reaches the executor; the screener finally receives `context.signal` | **PROVEN**: `signalProvided true, aborted true, lateEffect false` (was `false / false / true`) |
| **F-7** T-5 | `save()` returns whether the bytes landed; a refused proposal throws into the executor's failure path; approve/retire return undefined and delete false on refusal; the manager shows an error | **PROVEN**: `ok:true, proposed:true` with an empty store → `ok:false, "the proposal could not be stored … nothing was saved"` |
| **F-14** T-4 | the tool reads the clock it promises (`by:'logged'`), the window header states that clock, and `records:true` returns the review payload bounded to 5 by default | **PROVEN**: row prints `2026-10-27` (was the 25th's decision date) and `since:2026-10-26` returns the row (was 0); a record carries `planId`, `outcomeResolvedAt`, `netR`, excursions |
| **L-8** | the discarded `enhancedPrompt` block now rides the turn's system prompt under its own heading, capped at 6k with a visible truncation notice | CODE — same parts, one destination instead of none |
| **M-3** | the dock gates the profile index on the memory switch and uses the scaled budget; the topics index skips `enabled:false` notes | CODE — both homes now read one flag and one budget |
| **M-2** | the trader learner runs `filterMemoryWrite` and the sensitive setting before writing | CODE — same gate as `remember`, on the path nobody presses |
| **M-4** | one applier (`applyAmendmentContent`); the inbox writes then approves; the supervisor applies before approving; the queue is per profile | CODE — three ways to "approve" now share one write |
| **S-1** | a human Save on a trigger that already exists but is not live ACTIVATES that skill instead of reporting "already learned" and consuming the draft | CODE — one writer, under the notebook lock |
| **S-2** | the version snapshot carries `predicate` and `description`, and a revert restores them (clearing a predicate the old version did not have) | CODE — undo no longer restores prose under newer logic |
| **S-6** | both draft receipts read storage back: an unqueued draft reports a skip with the reason, a draft whose removal failed is not reported taken | CODE |
| **L-10** | `readyProviderModels` filters with `isProviderReady` and falls back to the first model | CODE — a keyless local provider is no longer "configured but not ready" |
| **N-4** | every conversation's accepted plans are armed with their own thread's leverage; the active thread reads live messages; a row leaving PENDING unregisters | CODE — a plan made in one thread is no longer forgotten on a switch |
| **N-1** L-11 | `ask_user_input`, the suspend/resume channel: 1–3 questions with tappable options, a card above the composer in both homes, 4-minute window, real cancel, and a `DATA_UNAVAILABLE` receipt on every non-answer so a cancelled question cannot become a fabricated premise | **PROVEN end to end**: card rendered with its labels, an option answered `q1: Long` and removed the card, Cancel → `cancelled`, 250 ms window → `timeout`, nothing left pending; tool inventory 41 → 42 |

### Gate state

`typecheck`, `typecheck:scripts`, `typecheck:electron` 0 · `check:contracts` 138 passed ·
`npm run lint` exit 0, 0 errors / **379** warnings (its cap, spent by nothing new — one orphaned
binding my own change created was deleted to keep it there) · `build` 31.24s ·
live driver zero page errors, all probes above as recorded.

**`check-flow-doc-anchors` is RED and is the one gate this pass did not leave green:** 52 citations
land on a comment line (ceiling 0), 13 miss the symbol their own line names, 11 are stale. Cause: this
much line-shifting work invalidates `file:line` citations by construction. Two re-anchorer attempts
(nearest-match, then symbol-search) were run and **reverted**: the first improved the comment count
but added symbol misses, the second did the same, and a citation that jumps to an unrelated identical
line is worse than a stale one. The repair needs per-citation judgement — read the doc's named symbol,
move to its declaration — not a batch heuristic.

### Still open

**Phase 1 second wave:** L-4 (cancelled/failed rows stay live), L-5 (desktop SSE error frames, the
raw/visible slice), L-6 (durable interruption recovery), L-7 (three global run owners), L-9 (the 180s
budget is still advisory), S-3 (shadow promotion claims a comparison it does not make), S-4 (skill
eligibility differs between retrieval and warning paths), S-5 (bundle import collision), M-5 (rules
store with no reader), M-6 (citation attribution disconnected), T-6 (stale artifact-store comments),
T-7 (dead debate vocabulary in the mandate, `forge_tool`'s schema and route), A-6 (settlement
provenance), A-8 (one clock).

**Phase 2:** R-3 (orphan compare/reanalysis/simulator overlays), R-4 (`NavRail` after rehoming the
update download), R-5 (rules store — reader or removal, owner call), R-6 (rename the live-but-stale
debate vocabulary).

**Phase 3:** N-3 (durable trader profile — the privacy half landed with M-2; an editable profile with
its own fields is still a design question), N-2 (OKX import — deliberately excluded from this pass).

**Phases 4 and 5:** not started. Phase 4 is memory/tools/skills made *good* (one system of record with
one write and one recall path, a topics→detail UI that edits and deletes, conflict and duplicate
handling, a token-budgeted injection, one tool naming/description/result/error convention with
progress over ~2s, a lazy skill catalogue with real triggers, self-reviewing evolution with one-step
undo, and compaction that keeps the active plan, open trades and user rules). Phase 5 is minimalist UI
polish — less text, no unneeded data, smooth streaming, progress on every tool call, no hangs.
