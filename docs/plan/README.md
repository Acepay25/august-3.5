# The plan

**The working list is [open-items.md](open-items.md).** It is a measurement, not a transcription:
every row carries the code that proves it is still open and the proposal that covers it. Start
there, then use [roadmap.md](roadmap.md) for order and [decisions.md](decisions.md) for the calls
only the trader can make.

| file | what it is | read it when |
|---|---|---|
| **[open-items.md](open-items.md)** | **THE WORKING LIST** — the `O-nn` rows (what is still missing) and `D-nn` rows (owner decisions), each with the evidence and the proposal that covers it | picking work |
| [roadmap.md](roadmap.md) | the five-phase dependency order, with the gate for each phase | ordering work |
| [decisions.md](decisions.md) | the questions only the trader can answer, with proposed defaults | a feature needs an owner call |
| [implementation-record.md](implementation-record.md) | what has already landed, where, and with which gate | checking whether something exists |
| [full-audit.md](full-audit.md) + [audit/](audit/) | the evidence: all seven sources merged, plus each source | you need the reasoning behind a claim |
| the dated design docs (`model-menu-redesign.md`, `transcript-redesign.md`, `wire-audit.md`, `reference-voice.md`, `reference-surfaces.md`, `quiet-voice.md`, `closed-loop-fixes.md`, `goal-workspaces-2026-10-25.md`, `skills-and-memory-2026-10-24.md`, `memory-loop-gaps-2026-10-24.md`) | one proposal each, with its owner rulings and phased commits | you are implementing that design |

## Status

Most of the 2026-10-19 audit's plan has landed; the register's open rows are the remainder.
The one thing that has not moved is the highest-leverage item: **settlement is still
human-confirmed**, so the outcome corpus stays small and every downstream learning leg is idle by
data, not by bug ([decisions](decisions.md) Q1, roadmap 3.7).

Two things the audit said that still frame everything:

> **August Trading is a well-built app with a well-built memory system and a broken connection
> between them.** The context is assembled and thrown away; the injection ledger records skills the
> model never saw; three different R:R formulas graded one plan; there is no cost model, so every
> number the trader sees is gross; and the 20-check validation gate had no production importer.

The gates are excellent at proving the code they can see works — and the blind spot is exactly where
the defects live. That is why every row is measured against live code, and why a change to a
rendered surface or a notebook byte has a browser gate behind it.

## Start here

1. Read [open-items.md](open-items.md) and pick a row whose phase the roadmap says is unlocked.
2. If the row needs an owner ruling, read [decisions.md](decisions.md) — do not invent the answer.
3. One item, one commit. The item's gate is named in the roadmap or its proposal; the gate ladder is
   [docs/engineering/gates.md](../engineering/gates.md).
4. Update the register only with a measurement made at the new HEAD — never with a transcription.

## Rules for working this plan

1. **One item at a time, one commit each.** A batch small enough to review is small enough to one
   commit.
2. **Lower the lint cap in the same commit that removes warnings.** `eslint.config.js` forbids
   raising it; a batch that removes warnings without lowering the cap is a broken batch.
3. **A change to the prompt surface is a change to the model.** Run `skill-approval-probe` — it
   asserts the notebook **bytes** after a real click.
4. **A change to rendered text needs `render-probe`.** It is the only gate that can see a rendered
   row or a rendered string.
5. **A change to `ExportService` has no automated gate.** Exercise export → wipe → import by hand.
6. **Never raise a numeric ceiling to go green.** The lint cap and the bundle ceiling ratchet
   **down**.
7. **Do not widen the RAW localStorage list "for safety."** The WebView origin quota is shared;
   shadow-copying Preferences-owned keys spends eviction-prone bytes on a copy nothing reads.
8. **The app proposes; the trader decides.** No proposal here places an order, writes to an
   exchange, routes on regime, revives the debate engine, or adds an LLM review call. Two of them
   **reduce** model calls.

## How the plan is kept honest

| mechanism | what it protects |
|---|---|
| `npm run check:docs` | every relative link resolves, every `path` › `symbol` citation names a symbol that exists, and every gate named in `AGENTS.md` exists |
| `npm run render-probe` | the rendered transcript — the only gate that can see a rendered row |
| `npm run skill-approval-probe` | the human-actuation path — asserts notebook bytes after a real click |
| the open-items register | every row carries the code that proves it is open **at the pinned HEAD** |
| `implementation-record.md` | what landed, where, with which gate, and what it did **not** close |

A test citation in the register or the record is **history, not a live gate**: the `tests/` tree was
removed on 2026-10-23, so a row without a code citation carries no live witness.
