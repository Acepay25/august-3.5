# Roadmap

The dependency order for the work. It is a sequence, not a status list: what remains open is
[open-items.md](open-items.md), and what already landed is [implementation-record.md](implementation-record.md).
Do not start a phase before the previous phase's gate is green.

> **Dated extraction (2026-10-19).** Figures and paths below are as measured then. Current gate
> names live in [docs/engineering/gates.md](../engineering/gates.md); current code paths are under
> `src/`. Item 2.6 (the docs restructure) was completed on 2026-10-29.

## The execution order

**Five phases. Each phase has a gate. Do not start a phase before the previous phase's gate is
green.** The phases are ordered by *dependency*, not by impact — the cheap wins come first, but
three of them are blocked behind a decision.

### Phase 0 — protect and re-anchor *(no code)*

| # | action | why | gate |
|---|---|---|---|
| 0.1 | **Let the in-flight work land.** It is deleting the analyst-role system and migrating stored profiles. | the cleanup manifest's HOLD list is waiting on it | — |
| 0.2 | **Re-anchor to the new HEAD and re-run the four sweeps** — import graph, export sweep, localStorage/Preferences census, dead-path comment scan. | the orphan set, the dead-export set and the store census all changed | diff the sweep output against the manifest's tables |
| 0.3 | ~~**Recover the previous audit's six reports** from the `archive/prior-audit-2026-10-18` branch.~~ **DROPPED (owner, 2026-10-23): the branch was deleted, so there is nothing to recover.** | they were the only record of the live-data findings (n = 0 outcomes, the 3 real plans, 100× leverage) — **no static audit can find those** | the figures survive only as register rows O-19/O-20/O-22, O-28, O-115, O-23/O-24 |
| 0.4 | **Decide the fee tier, the backup contract, the context policy and the click gate.** | four rulings unblock ~10 items | — |
| 0.5 | **Commit the lockfile fix** (1.0.30 → 1.3.0 + the `js-yaml` root block). | the only committed state that is wrong about the manifest | `npm ci` from a clean checkout |
| 0.6 | **Turn on `noUncheckedIndexedAccess`** — as a warning first. | the highest-value missing compiler option; every `arr[0]` silently lies today | `npm run typecheck` |

### Phase 1 — the cheap, safe correctness wins

| # | action | impact | gate |
|---|---|---|---|
| 1.1 | **Re-tighten the lint ratchet** — delete the 8 dead disable directives, then set `--max-warnings 674`. **Do this FIRST in the phase:** every dead import removed lowers the count, and the cap must be lowered in the same change. | the gate starts catching regressions again | `npm run lint:loose` → ≤ 674 · `npm run lint` → 0 |
| 1.2 | **Close the CSP's unused remote origins** — remove the three TradingView hosts from `script-src`/`frame-src`/`img-src` and fix the comment that says they are used. | the only remote-script hole, closed for free | `typecheck` · `lint` · **`build`** · **`boot-probe`** |
| 1.3 | **Surface the swallowed failures** — the auto-backup and the pattern-memory sync. | a silent backup failure is the worst kind | `typecheck` · `lint` |
| 1.4 | **One ticker, not 400** — the per-row intervals and the 1-second whole-surface clock. | speed | `typecheck` · `lint` · **`render-probe`** |
| 1.5 | **Validate the sender frame on every IPC handler.** | defence in depth for the only privileged surface | `typecheck` · `lint` · **`typecheck:electron`** |
| 1.6 | **Register the two un-recorded backup namespaces** (`trade_sidebar_open_v1`, `agent_threads_opened_v1`) — with the owner's eye on the shared WebView quota. | no silent native data loss | `render-probe` (drives Settings → Data back up / export / import; no gate reads the export manifest itself) |
| 1.7 | **Lower the bundle ratchet** — 2,600 kB → ~1,400 kB, plus a step that fails when the ceiling is stale. | the gate starts catching eager-import regressions | `build` |

### Phase 2 — the roadmap's own wave

| # | action | gate |
|---|---|---|
| 2.1 | **Write the test the roster deletion needed** — *"no test covered the seeding, so removing it turned nothing red."* | **`render-probe`** (the unit suite this assumed is gone) |
| 2.2 | **One R:R, one formula** — make `utils/riskReward.ts` the single owner; delete the three other copies. **Replay the stored trades and diff the old and new verdicts before merging.** | `typecheck` · `lint` · **`render-probe`** |
| 2.3 | **The cost model** — `netR` = gross R − a **user-set** fee and slippage. The fee tier must be the trader's setting, never a hardcoded exchange rate. | `typecheck` · `lint` |
| 2.4 | **The prompt contract test** — four tests, one per model-call path, asserting what is **sent**. *This is the gate that would have caught F-01, F-09, F-10 and E-09.* | `typecheck` · `lint` |
| 2.5 | **Re-home the position sizing** — wire `utils/ticketSize.ts` into the card and the journal. | `typecheck` · `lint` · **`render-probe`** |
| 2.6 | ~~**The docs restructure**~~ — **DONE 2026-10-29**: one reading path under `docs/`, line-number citations replaced by symbols, and `check:docs` watches both. | **`check:docs`** |

### Phase 3 — the behavioural corrections *(need the Phase 0.4 decisions)*

| # | action | depends on |
|---|---|---|
| 3.1 | **Raise the evidence floors** — `MIN_SAMPLE_FOR_VETO` 2 → ≥10, `MIN_CLUSTER_FOR_SKILL` 3 → ≥10, `MIN_SAMPLE_CONFIRMED` 5 → ≥20. | — |
| 3.2 | **Give presented plans a validity window** — so `ENTRY_NOT_HIT` is written and the denominator is honest. | — |
| 3.3 | **Fix the journal's date semantics** — `decidedAt` beside `timestamp`. | — |
| 3.4 | **Decide at `high` effort** — the one output that matters is produced at the lowest tier. | — |
| 3.5 | **Reconnect the deterministic skill enforcement** — `applyNotebookSkillsToAnalysis`, the predicate ceiling, the veto ledger. **Do not re-enable the hard veto before 3.1.** | 3.1 |
| 3.6 | **Fix the context — one recommendation, three parts:** **(1) inject the harness contract** (1,582 chars: the confidence ladder, the risk rules, and the `HARNESS_TURN_MARK` convention — it closes the contradiction where the mark is used in the user role and explained nowhere); **(2) cut the retrieved context by default**; **(3) flip `recordInjections` to default-false** so the ledger stops lying. **Inject and record together, or neither.** | 0.4 |
| 3.7 | **Make the outcome automatic** — resolve with a provenance flag and a correction path, first-writer-wins, after a shadow month. | 0.4, 3.1, 3.2 |

### Phase 4 — the big bets

| # | action | needs |
|---|---|---|
| 4.1 | **One plan object** — entry, stop, targets, invalidation, one ratio, the grade, the size suggestion; the card, the gate, the clamp, the watch and the journal all read it. | 2.2, 2.4 |
| 4.2 | **The replay harness** — headline use case: **the deterministic baseline.** *"Has anyone asked whether the model beats a fixed rule?"* | 2.2, 3.7 |
| 4.3 | **Behavioural coverage for `electron/main.cjs`** — 1,412 lines, currently zero runtime coverage. | 1.2, 1.5 |
| 4.4 | **The notebook's recovery affordance** — a version, a checksum, a `.corrupt.<ts>` sidecar. *The only item with a data-loss risk.* | 3.7 |
| 4.5 | **Shard the notebook out of one JSON blob.** | 4.4 |
| 4.5b | **The candidate log** — ✅ **DESIGN APPROVED (owner, 2026-10-20): a 365-day log under `userData/candidates/`, included in backup and export.** The *implementation* waits on 3.7. | 3.7, D-24 |
| 4.6 | **The new features** (Report 3) — the **[DATA-GATED]** ones wait for 3.7. | 3.7 |

---

