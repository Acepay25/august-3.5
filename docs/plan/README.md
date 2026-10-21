# The August Trading plan

**This directory is `docs/plan/`.** It is tracked, indexed from `AGENTS.md` and `README.md`,
and it is the only durable home for the plan — `docs/analysis/` is scratch.

**This is the plan.** One place, tracked, indexed, and sequenced. Everything below is either the
plan itself or the evidence behind it.

- **Started:** 2026-10-19 · **Audit baseline:** `6a41a9f7` · **Plan corpus:** committed with the 2026-10-20 fix pass — findings that depend on the working tree are labelled *worktree-specific*.
- **Status:** most of it is a reviewed, sequenced proposal. Items already implemented are marked **DONE** (e.g. O-52); D-24 records a design approval, not an implementation.
- **Second implementation pass (2026-10-20):** the remaining Phase 1 items, all of Phase 3, and the data-independent Phase 4 items landed. `implementation-record.md` §7 is the authoritative list of what landed, where, and with which gate; the `O-nn` rows below remain the audit's snapshot rather than a row-by-row status rewrite. **The candidate log (E-42b) is the one planned item still gated** — D-24 waits for the shadow month.
- **Third pass (2026-10-20, owner-reported defect, not a plan id):** *"if the model executes too many tools or thinks too much it don't generate the final response."* `implementation-record.md` §8 is the ledger: the thinking-sized round budget, the one automatic re-ask when a round is cut off, automatic compaction of the outbound history, and the context window resolved from the trader's override → a limit the provider stated in a rejection → the window `/models` reported → the owner's new 1,000,000 default. It closes **O-74**, and it fixed a stored-data bug on the way: `loadProviderConfigs` was dropping `contextWindowTokens`, `thinkingCapable`, `jsonSchemaCapable` and both pricing rates on every app start.
- **Fourth pass (2026-10-21): E-51, E-52, E-53, E-54, E-55 and E-56.** Two owner-requested redesigns, one pipe, one face, one set of surfaces and one volume, each with its own proposal, its own owner rulings and its own phased commits: **E-51** the composer's model menu (`model-menu-redesign.md`, landed in `implementation-record.md` §10–§13), **E-52** the transcript (`transcript-redesign.md`, §15–§22) — the status line now names the activity, a step has a kind, the effort lands on the answer, the tool trail works in both homes, there is one way back to the newest row, the launch list says what each agent is for, and Settings carries the catalogue of the desk's forty tools — and **E-53** the wire audit (`wire-audit.md`, §23), which answers the one question the transcript could not: *did the model not think, or was it never asked to?* — and **E-54** the reference's voice (`reference-voice.md`, §24): the answer is prose and wears the serif, the row stopped shouting, and there is one home for the voice — and **E-55** the reference's other surfaces (`reference-surfaces.md`, §25): the work card, the skills catalogue, the memory surfaces, and the reading serif the answer was owed — and **E-56** the quiet pass (`quiet-voice.md`, §26): the rail, the dock and the chart area stop shouting, and the flat page the reference is built from. **E-52 closes O-131, E-53 closes O-132, E-54 closes O-133, E-55 closes O-134 and E-56 closes O-135.** Still open from E-52: **G-3**'s other half, **G-12** (a long bot turn is a wall) and **G-15** (per-provider thinking joined flat — it needs the seat identity carried on the trace AND on the tool calls). The file/artifact viewer stays deferred by ruling: August's tool output is text, and the expander already pages the full artifact back.
- **Owner:** the trader. 24 of the items are rulings only the trader can make — **three are now answered** (the fee tier, the `docs/analysis/` question, and the plan-document deletion). See §4.

---

## 1. What is here

| file | what it is | read it when |
|---|---|---|
| **[`open-items.md`](open-items.md)** | **THE PLAN'S WORKING LIST** — **128** item rows (O-01…O-136) + **23** owner-decision rows here (D-01…D-23; **D-24 is recorded in `full-audit.md:6756`**, not as a row in this file), each with the `file:line` that proves it is still open at HEAD, each mapped to the proposal that covers it. The two counts were re-measured with `grep -cE '^\| O-[0-9]+ \|'` / `'^\| D-[0-9]+ '` on 2026-10-21, because a hand-typed census is exactly how this line went stale twice. |
| **[`implementation-record.md`](implementation-record.md)** | **WHAT LANDED** — the 2026-10-20 fix pass, item by item: where each change is, which gate verified it, the measured figures with the tip they were taken at, and **what it does not close** |
| **[`model-menu-redesign.md`](model-menu-redesign.md)** | **E-51 — the proposer's new item.** The scan of the model dropdown as it stands (three controls, two designs, one untested), the gap against the DeepSeek Harness reference, the element-by-element mapping, **four owner rulings**, and four phased commits with their gates |
| **[`transcript-redesign.md`](transcript-redesign.md)** | **E-52 — the proposer's new item.** The scan of the transcript as it stands (the status line, the step kinds, the trail, the two homes, the surface around them — **eighteen gaps**), **five owner rulings**, and **eight phased commits** with their gates |
| **[`wire-audit.md`](wire-audit.md)** | **E-53 — the proposer's new item.** The scan of the one gap E-52 left open that the data already answered: the transport decided, per request, which capability route it applied, and said why — and nothing collected it. One pipe, not a feature |
| **[`reference-voice.md`](reference-voice.md)** | **E-54 — the proposer's new item.** The scan of the face of the thing: E-52 changed what the transcript SAYS and none of its eighteen gaps was about how it LOOKS. The answer is prose, the row does not shout, and there is one home for the voice |
| **[`reference-surfaces.md`](reference-surfaces.md)** | **E-55 — the proposer's new item.** The scan of the FURNITURE around the answer: the work card, the thinking block, the executed tools, the skills catalogue and the memory surfaces — and the reading serif the answer was owed |
| **[`quiet-voice.md`](quiet-voice.md)** | **E-56 — the proposer's new item.** The scan of the VOLUME: the rail, the dock and the chart area stop shouting, and the flat page the reference is built from |
| **[`closed-loop-fixes.md`](closed-loop-fixes.md)** | **E-57 — the verification pass.** Two external reviews claimed ~20 flaws; every claim was re-checked against HEAD before anything was built. Eight items: the starved post-mortem leg, the dead lesson readers, the process-global prompt lane, the dock's prose-then-failure turn, the risk checks that are computed but never enforced, the automation caveats that evaporate, the unasserted chart levels, and the two register rows that were false |
| **[`full-audit.md`](full-audit.md)** | **THE EVIDENCE** — all seven sources merged into one 551 KB document with a 66-entry section index | you want the reasoning behind a claim |
| [`audit/2026-10-19-00-index-and-method.md`](audit/2026-10-19-00-index-and-method.md) | the commit, the tree state, the tools, what could not be run, the coverage statement | you want to know how it was made and what it missed |
| [`audit/2026-10-19-01-system-and-data-flow.md`](audit/2026-10-19-01-system-and-data-flow.md) | the architecture, the persisted-store inventory, the prompt inventory, the tool surface, security, reliability, performance, UX, quality gates | you are changing the system and need the map |
| [`audit/2026-10-19-02-enhancements.md`](audit/2026-10-19-02-enhancements.md) | **48 enhancements**, each with problem + evidence, impact, effort, risk, verification and roadmap status | you are picking a change |
| [`audit/2026-10-19-03-new-features.md`](audit/2026-10-19-03-new-features.md) | **22 new features** by trader workflow (prep → scan → plan → manage → journal → review → improve) | you are adding capability |
| [`audit/2026-10-19-04-cleanup-manifest.md`](audit/2026-10-19-04-cleanup-manifest.md) | the cleanup manifest, 8 batches, the 34-row docs audit, and the **executed** plan-document cleanup | you are doing a cleanup batch |
| [`audit/2026-10-19-05-ordering-and-open-questions.md`](audit/2026-10-19-05-ordering-and-open-questions.md) | the interleaved order, go/no-go per batch, **14 open questions with proposed defaults**, and the coverage statement | you are deciding, not implementing |

### The one-line version

> **August Trading is a well-built app with a well-built memory system and a broken connection
> between them.** The context is assembled and thrown away; the injection ledger therefore records
> skills the model never saw; three different R:R formulas grade one plan; there is no cost model,
> so every number the trader sees is gross; and the 20-check validation gate has no production
> importer. The gates are excellent at proving the code they can see works — and the blind spot is
> exactly where the defects live.

---

## 2. The execution order

**Five phases. Each phase has a gate. Do not start a phase before the previous phase's gate is
green.** The phases are ordered by *dependency*, not by impact — the cheap wins come first, but
three of them are blocked behind a decision.

### Phase 0 — protect and re-anchor *(no code)*

| # | action | why | gate |
|---|---|---|---|
| 0.1 | **Let the in-flight work land.** It is deleting the analyst-role system and migrating stored profiles. | the cleanup manifest's HOLD list is waiting on it | — |
| 0.2 | **Re-anchor to the new HEAD and re-run the four sweeps** — import graph, export sweep, localStorage/Preferences census, dead-path comment scan. | the orphan set, the dead-export set and the store census all changed | diff the sweep output against the manifest's tables |
| 0.3 | **Recover the previous audit's six reports** from the `archive/prior-audit-2026-10-18` branch into a durable location. | they are the only record of the live-data findings (n = 0 outcomes, the 3 real plans, 100× leverage) — **no static audit can find those** | the branch exists and holds them |
| 0.4 | **Decide the fee tier, the backup contract, the context policy and the click gate.** | four rulings unblock ~10 items | — |
| 0.5 | **Commit the lockfile fix** (1.0.30 → 1.3.0 + the `js-yaml` root block). | the only committed state that is wrong about the manifest | `npm ci` from a clean checkout |
| 0.6 | **Turn on `noUncheckedIndexedAccess`** — as a warning first. | the highest-value missing compiler option; every `arr[0]` silently lies today | `npm run typecheck` |

### Phase 1 — the cheap, safe correctness wins

| # | action | impact | gate |
|---|---|---|---|
| 1.1 | **Re-tighten the lint ratchet** — delete the 8 dead disable directives, then set `--max-warnings 674`. **Do this FIRST in the phase:** every dead import removed lowers the count, and the cap must be lowered in the same change. | the gate starts catching regressions again | `npm run lint:loose` → ≤ 674 · `npm run lint` → 0 |
| 1.2 | **Close the CSP's unused remote origins** — remove the three TradingView hosts from `script-src`/`frame-src`/`img-src` and fix the comment that says they are used. | the only remote-script hole, closed for free | `typecheck` · `lint` · `test` · **`build`** · **`boot-probe`** |
| 1.3 | **Surface the swallowed failures** — the auto-backup and the pattern-memory sync. | a silent backup failure is the worst kind | `typecheck` · `lint` · `test` |
| 1.4 | **One ticker, not 400** — the per-row intervals and the 1-second whole-surface clock. | speed | `typecheck` · `lint` · `test` · **`render-probe`** |
| 1.5 | **Validate the sender frame on every IPC handler.** | defence in depth for the only privileged surface | `typecheck` · `lint` · `test` · **`typecheck:electron`** |
| 1.6 | **Register the two un-recorded backup namespaces** (`trade_sidebar_open_v1`, `agent_threads_opened_v1`) — with the owner's eye on the shared WebView quota. | no silent native data loss | `test` incl. the 5 export suites |
| 1.7 | **Lower the bundle ratchet** — 2,600 kB → ~1,400 kB, plus a step that fails when the ceiling is stale. | the gate starts catching eager-import regressions | `build` |

### Phase 2 — the roadmap's own wave

| # | action | gate |
|---|---|---|
| 2.1 | **Write the test the roster deletion needed** — *"no test covered the seeding, so removing it turned nothing red."* | `npm run test` |
| 2.2 | **One R:R, one formula** — make `utils/riskReward.ts` the single owner; delete the three other copies. **Replay the stored trades and diff the old and new verdicts before merging.** | `typecheck` · `lint` · `test` · `test:coverage` · **`render-probe`** |
| 2.3 | **The cost model** — `netR` = gross R − a **user-set** fee and slippage. The fee tier must be the trader's setting, never a hardcoded exchange rate. | `typecheck` · `lint` · `test` · `test:coverage` |
| 2.4 | **The prompt contract test** — four tests, one per model-call path, asserting what is **sent**. *This is the gate that would have caught F-01, F-09, F-10 and E-09.* | `typecheck` · `lint` · `test` |
| 2.5 | **Re-home the position sizing** — wire `utils/ticketSize.ts` into the card and the journal. | `typecheck` · `lint` · `test` · **`render-probe`** |
| 2.6 | **The docs restructure** — write the 8 documents, archive the rest, repair `docs/app-flow.md`'s anchors. | **`check-flow-doc-anchors`** |

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
| 4.3 | **Behavioural coverage for `electron/main.cjs`** — 1,362 lines, currently zero runtime coverage. | 1.2, 1.5 |
| 4.4 | **The notebook's recovery affordance** — a version, a checksum, a `.corrupt.<ts>` sidecar. *The only item with a data-loss risk.* | 3.7 |
| 4.5 | **Shard the notebook out of one JSON blob.** | 4.4 |
| 4.5b | **The candidate log** — ✅ **DESIGN APPROVED (owner, 2026-10-20): a 365-day log under `userData/candidates/`, included in backup and export.** The *implementation* waits on 3.7. | 3.7, D-24 |
| 4.6 | **The new features** (Report 3) — the **[DATA-GATED]** ones wait for 3.7. | 3.7 |

---

## 3. The rules for working this plan

1. **One item at a time, one commit each.** Every cleanup batch is small enough to be one
   reviewable commit with its gate listed in `audit/2026-10-19-04-cleanup-manifest.md` §9.
2. **Lower the lint cap in the same commit that removes warnings.** `eslint.config.js` forbids
   raising it. A batch that removes warnings without lowering the cap is a broken batch.
3. **A change to the prompt surface is a change to the model.** Run `skill-approval-probe` — it
   asserts the notebook **bytes** after a real click.
4. **A change to rendered text needs `render-probe`.** It is the only gate that can see a rendered
   row or a rendered string; jsdom mounts markup without resolving a stylesheet.
5. **A change to `ExportService` needs the five export suites** — a backup change is invisible to
   every other gate.
6. **Never raise a numeric ceiling to go green.** The lint cap, the bundle ceiling and the coverage
   floors all ratchet **down**.
7. **Do not widen the RAW localStorage list "for safety."** The WebView origin quota is shared;
   shadow-copying Preferences-owned keys spends eviction-prone bytes on a copy nothing reads.
8. **The app proposes; the trader decides.** No proposal in this plan places an order, writes to
   an exchange, routes on regime, revives the debate engine, or adds an LLM review call. Two of
   them **reduce** model calls.

---

## 4. The questions only the trader can answer

Each has a proposed default in `audit/2026-10-19-05-ordering-and-open-questions.md` §4, so silence
is not a blocker. In one line each. **Three are answered**; the rest stand, and this list
closes none of them.

1. **Does a trade outcome need a human click?** — *default: automatic, with provenance and a
   correction path, after a shadow month.* **This is the highest-leverage decision in the
   repository, and it is not a code change.**
2. **Send the assembled context, or delete the assembly?** — *default: inject the 1,582-char
   harness contract; cut the retrieved context; flip `recordInjections` to default-false.*
3. ~~**Your actual fee tier?**~~ — ✅ **ANSWERED (2026-10-20): 5 bps taker / 2 bps maker, zero slippage, with a visible "slippage not modeled" label.** The fee tier is a trader setting; the slippage line is labelled, never a silent zero.
4. **What belongs in a backup?** — *default: put the auto-apply policy and the five
   restore-only namespaces on the RAW list.*
5. **Is the Analyst Lens feature staying?** — *default: let the deletion land, then delete the
   leftovers in one pass.*
6. **Is the Android gallery feature wanted?** — *default: wire it — the chart already produces the
   PNG bytes — or delete both halves.*
7. **Where should the render-time `<think>` / `<JSON_PLAN>` strip live?** — *default: move it into
   the two row components.*
8. **Should old post-mortems stay readable?** — *default: yes.*
9. **How many minds answer "Full analysis"?** — *default: one, tool-driven.*
10. ~~**Is `docs/analysis/` a live location, or scratch?**~~ — ✅ **ANSWERED (2026-10-20): scratch.** The eslint ignore is right, the directory is un-tracked on purpose, and the plan lives at **`docs/plan/`** — tracked, indexed from `AGENTS.md` and `README.md`. The previous generation's reports are preserved on the branch **`archive/prior-audit-2026-10-18`**, so `git gc` can no longer prune them.
11. **Should the history be rewritten to drop the 52 MB of APKs?** — *default: not now; delete
    the merged branches first, then decide at the next major version boundary.*
12. **Is the 1-second trade-surface clock needed, and is the root's 60 Hz re-render
    acceptable?** — *default: move the clock to a leaf and the transcript off the root; measure
    before and after, and keep the code simple if the numbers say it does not matter.*
13. **Do the old pre-2026-10-18 trades count as evidence for the calibration ledger and the
    provider ranking?** — *default: count them for history, not for calibration.*
14. ~~**Which tracked documents may be deleted?**~~ — ✅ **ANSWERED AND EXECUTED (2026-10-20): 18 plan documents were DELETED, not archived**, and the deletions are **staged, not committed**. The dated history ledger was kept because the anchor gate scans it.

### Four more the code already poses

These are not in the ordering report's numbered list; they are real, and they are open.

15. **What replaces the analysis branch?** — *default: the tool turn, plus the contract.*
16. **The gate scan: inside `present_trade`, or its own tool?** — *default: its own tool.*
17. **The `reasoningEffort` side-channel?** — *default: keep it, and fix the default tier.*
18. **Which tools are meaningless without a chart?** — *default: the 8 chart tools stay dock-only.*

---

## 5. How this plan is kept honest

| mechanism | what it protects |
|---|---|
| **`npm run check-flow-doc-anchors`** | the line-number claims in `docs/app-flow.md` — 296 anchors verified, 0 unattributed. **It cannot see a citation that names no symbol**, which is exactly where the stale ones live; that class is repaired by hand (§14 of the cleanup manifest). |
| **`npm run render-probe`** | the rendered transcript. The only gate that can see a rendered row. |
| **`npm run skill-approval-probe`** | the human-actuation path. Asserts notebook **bytes** after a real click. |
| **the open-items register** (`open-items.md`) | every claim carries a `file:line` that proves it is open **at HEAD**. It is a *measurement*, not a transcription — which is why it corrected five rows from the previous audit rather than repeating them. |
| **the `archive/prior-audit-2026-10-18` branch** | the previous audit's six reports, which are the only record of the **live-data** findings. A branch makes the objects reachable, so `git gc` can no longer prune them. |
| **this file** | the order. If the order is wrong, fix it here first. |

**A note on the previous audit, because it is the most important thing in this plan's history:**
its five strongest findings — *no cost model*, *the learning loop is starved by one click*, *the
ensemble weighting is inverted*, *no size is ever produced*, *the default leverage is 100×* — came
from **decoding the trader's actual profile**, not from reading code. **No static audit can find
those.** They are reproduced in the register as O-19, O-28, O-115, O-23 and O-24, and the
mechanism that would let a future audit repeat them is item 3.7: *record the outcome, and the
corpus follows.*
