# Harness Upgrade — Review Fix Plan (2026-08-31/09-01)

Scope: all uncommitted work on `main` since HEAD `0787668` (the ROUND-41→47
harness-upgrade batches, ~120 files) plus the fixes applied during this
session's audit. Three independent review passes (learning/memory,
debate/floor, UI/UX wiring) + direct verification. Every item below was
confirmed against source, not inferred from changelog claims.

Legend: P0 = breaks a core promise silently · P1 = feature dead/unreachable ·
P2 = minor/cosmetic · UX = wiring gap.

---

## Already fixed this session (verify gates, then done)

| # | Fix | Files |
|---|-----|-------|
| F1 | `annotateVerdictCitations` had zero callers → `cited` never written → OVERRIDDEN state dead. Now called at verdict commit (fire-and-forget). | `hooks/useAnalysisPipeline.ts` |
| F2 | passMining `splice(findIndex(...), 1)` deleted the LAST record when findIndex returned -1 (first resolution). Guarded upsert. | `services/learning/passMining.ts` |
| F3 | `runPassMiningSweep` never wired → wired into weekly boot pass; 8 regression tests incl. TP-first/SL-first, cluster→draft, no-draft-from-misses, splice guard. | `services/learning/weeklyReview.ts`, `tests/passMining.test.ts` |
| F4 | PreReadGate re-gated every old card → latest-only via `context.latestMessageId`. | `components/chat/TranscriptRow.tsx` |
| F5 | Chips/disclosure query window leaked later runs' injections into older cards → bound by `messageFinishedAt`. | `SkillCitationChips.tsx`, `ContextDisclosure.tsx`, `TranscriptRow.tsx` |
| F6 | Boot passes read stale `loggedTradesRef` before profile load → moved after trade load, pass `loadedTrades` directly. | `App.tsx` |
| F7 | WeeklyReviewCard never rendered `digest.metaCalibration` → added Brier/precision row. Journal never surfaced miss-cost → added `missCostLine` stat. | `WeeklyReviewCard.tsx`, `Journal.tsx` |
| — | Chip flag feedback (⚑ → ✓ flagged) since chat context has no toast. | `SkillCitationChips.tsx` |

---

## NEW findings from the 26h review — to fix

### P0-1 · Learning queue is write-only: 9 proposal kinds, zero readers
`utils/learningQueue.ts` — `listLearningProposals` has **no consumer anywhere**
(UI, inbox, roster, dashboard). Five subsystems queue into it every week:
displacement (cap), rescope ×3 (regime divergence, recurrence, distill),
demote, revival (graveyard twin), contradiction ×2 (pairwise sweep, belief
challenge). The doc-comment says "A human approves or dismisses each one in
Settings → Skills" — Settings → Skills (`SkillsGrid.tsx`) never mentions
proposals. The entire §4.6 loop-E "the inbox disposes" half is dead: the gate
proposes, nobody disposes. `dismissLearningProposal` also unused.

**Fix (10.1-style surface, minimal):** render a "Learning queue" section in
`SkillsGrid` (list proposals newest-first, grouped by kind, Apply/Dismiss
buttons where an apply path exists, Dismiss-only otherwise). Re-render on the
`august-learning-queue` window event (already dispatched by `write()`).
Apply paths:
- `displacement` → `applyDisplacementProposal(displacedSlug, username, challengerFromPayload)` (exists, SkillMemoryService:1852).
- `revival` → re-create from tombstone payload via existing create path; mark resolved.
- `demote` → `setSkillStatus(slug, 'candidate')` (or 'retired' per text) — reuse `applyReviewRecommendation`-style write.
- `rescope`/`contradiction` → Dismiss + "Open in chat" (trySkillInChat(slug)) — human edits the skill; no auto-apply is honest here.
Tests: queue→render→apply→proposal gone + skill mutated; dismiss removes; dedupe fingerprint respected.

### P0-2 · §8.3a adherence join window is inverted → every skill mislabeled CONTROL
`applySkillEvidenceUnlocked` (SkillMemoryService:732) computes
`sinceMs = now - trade.timestamp` and `skillAdherenceSince` keeps records with
`ts >= now - sinceMs` — i.e. injections AFTER the trade was logged. Production
order is: run at T0 (injection record ts=T0) → user logs trade at T1 > T0
(`timestamp: new Date().toISOString()` at log time). The run that shaped the
trade is BEFORE T1, so it's excluded; the window instead sweeps later,
unrelated runs. Verified by scratch probe: a followed skill returns
`'not-injected'` → routed to `controlIds` → **no skill ever earns FOLLOWED
credit; all matched skills rot as CONTROL**. Lift baselines are poisoned the
same way. (Existing tests pass only because their fixtures set
`trade.timestamp` AFTER the injection ts — backwards from production.)

**Fix:** the join must look BACKWARD from the trade's originating run, not
forward from log time. `LoggedTrade` has no run linkage; cheapest correct
anchor: window = `[trade.timestamp - LOOKBACK, trade.timestamp]` with
LOOKBACK ≈ 6h (a run cannot postdate the trade it produced; trades are logged
minutes after the verdict). Implement as `skillAdherenceUntil(username, file,
untilMs, lookbackMs)` (keep the old export for any other caller — there are
none) or add `untilMs`/`fromMs` params. Update `tests/skillHoldout.test.ts`
fixtures to production timing (injection ts BEFORE trade ts) so the test
actually pins the bug. Add regression test: injection at T0, trade logged at
T0+2min → 'followed'/'overridden'/'injected-unknown' per cited flag; a LATER
run's injection (T0+1d) must not count.

### P0-3 · §8.2a birth certificate never tested
`evaluateClaim` (utils/skillPrediction.ts:111) is imported into
SkillMemoryService (line 51) but **called nowhere**; `claimTestedEvidence` is
declared (line 127) but never written. The scheduler still asks generic
hurts/helps. Plan §8.2a: "The eval scheduler tests the skill against THIS
instead of a generic hurts/helps question; the ladder consumes the claim
verdict." Dead.

**Fix:** in the eval scheduler verdict path, when `meta.prediction` exists:
build `ClaimTestEvidence` from followed evidence (wins/losses since birth —
`tradeIds` counts are the available proxy), call `evaluateClaim`, record
`claimTestedEvidence = sample`, and fold the met/unmet/pending verdict into
the scheduler's recommendation (met → keep/promote signal; unmet → refine/
demote signal; pending → no-op). Skills without a prediction keep the generic
question. Unit tests for the wiring (met/unmet/pending × repeat/avoid).

### P1-4 · Coach thread (§10.1) not implemented
Changelog batch-13 claim overstates: drafts surface only in the modal Inbox;
there is no Coach bot in the roster, no coach thread, no message search.
**Fix (scoped):** add a `kind:'bot'` Coach entry to the roster (`services/
agents/agentRoster.ts` bot list) whose thread renders pending skill drafts +
learning-queue proposals as inline cards (reuse `InlineApprovalCard`/
draft-approve/deny handlers already in App). Unread badge = drafts+proposals
count (already computed for the bell). This is the one remaining PLAN item,
not a defect — confirm with user before building (it's a ~half-day surface).

### P1-5 · `skillInjectedSince` exported, zero callers
MemoryInjectionService defines it; nothing imports it. Either wire it (the
`injectedFileNames` option of `reviewSkillEffectiveness` wants exactly this)
or delete. **Fix:** wire into LearningDashboard's review call so the
"never-injected caveat" actually gets data; if the call site is awkward,
delete the export.

### P2-6 · Minor
- `runContradictionSweep` in weeklyReview boot is fire-and-forget with no
  await on the returned promise chain — fine, but the `queued` count is
  discarded; log it to the squawk feed like the other passes for parity.
- `dismissLearningProposal` unused until P0-1 lands (covered there).
- `distill` proposal kind declared in the union but never written — leave
  (forward-compat) but the P0-1 UI must render unknown kinds gracefully
  (generic card).

---

## Explicitly NOT defects (checked, leave alone)
- PreRead checklist + harness toggles use global (non-per-user) localStorage
  keys — consistent with the committed checklist pattern.
- ProviderManager amber sits inside `.status-surface` scope — sanctioned
  exception to monochrome.
- All new components monochrome-clean (grep for colored utilities: none
  outside status surfaces).
- `fullResponseText` at the F1 call site IS the moderator verdict (verified
  assignment chain), so citation stamping annotates the right text.
- Verdict-stage records exist (`memoryContext.ts:114` builds them with
  `stage:'verdict'`), so F1's stamp has targets.

## Order of implementation
1. P0-2 (join direction) — highest damage, small diff, test-first.
2. P0-1 (learning-queue UI + apply paths) — biggest dead surface.
3. P0-3 (claim test wiring).
4. P1-5, P2-6 cleanups.
5. Gates: `npm run typecheck && npm run test && npm run build`.
6. changelog ROUND-49 + plan §16 handoff update.
7. P1-4 Coach thread — only after user confirms scope.
