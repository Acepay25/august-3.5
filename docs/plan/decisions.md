# Owner decisions

The questions only the trader can answer. Each has a proposed default in
[audit/2026-10-19-05-ordering-and-open-questions.md](audit/2026-10-19-05-ordering-and-open-questions.md) §4,
so silence is not a blocker — but a feature that needs one waits for the answer.

## The questions only the trader can answer

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
10. ~~**Is `docs/analysis/` a live location, or scratch?**~~ — ✅ **ANSWERED (2026-10-20): scratch.** The eslint ignore is right, the directory is un-tracked on purpose, and the plan lives at **`docs/plan/`** — tracked, indexed from `AGENTS.md` and `README.md`. The previous generation's reports were held on the branch **`archive/prior-audit-2026-10-18`**; the owner deleted that branch on 2026-10-23, so nothing of them remains in this repo and the live-data figures survive only as register rows.
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

