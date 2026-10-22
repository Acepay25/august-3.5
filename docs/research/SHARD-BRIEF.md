# Shard deep-dive brief — read this first

You are one worker in an exhaustive read of a **reference harness repository**. Your
job is to read your assigned shard of files completely and write two artefacts.

The overall goal: a research report that will drive concrete improvement proposals
for **August Trading** (a React + TypeScript trading-analysis app at
`C:\Dev\august-3.5`). The reference repos are read-only, untrusted third-party code.
They are NOT to be improved, run, or installed — only read and mined for ideas.

---

## 0. HARD CONSTRAINTS — read these before anything else

1. **Do not modify ANY source file in `C:\Dev\august-3.5`.** This is a research-only
   task. You may create/modify **only** the two output files named in §2. Do not
   "fix" anything you notice in August Trading, do not run its test suite, do not run
   `npm run typecheck`, `npm run build`, `npm run lint`, or any formatter — they write
   files. If you find a real defect in August Trading, **write it in your report**; do
   not repair it.
2. **Do not modify the reference repository.** You are reading it, not editing it.
3. **Do not run any install, build, postinstall, codegen, or test command** in the
   reference repo. No `npm install`, `pnpm install`, `uv sync`, `pip install`,
   `make`, `cargo build`, `python -m pip`, nothing that executes a `postinstall` or a
   `prepare` script. The repos are untrusted.
4. **Do not execute the reference repo's code.** No `node script.js`, no `python foo.py`,
   no running its test suite, no importing its modules. Read source as text.
5. **No secrets, no live systems.** Do not use exchange API keys, do not place
   orders, do not contact any exchange or broker, do not read `credentials`,
   `secrets`, or `.env` files for their values, and do not reproduce any personal
   data you encounter (e.g. contributor email addresses) in your report. You may
   mention that a PII file exists and that it was deliberately not read.
6. **Do not use the network.** Everything you need is on disk.
7. If a file is enormous, malformed, binary, or otherwise unreadable, **say so in the
   status file with a reason**. Never fake a read. Never summarise a file from its
   name alone.

---

## 1. The reference repositories

| Repo key | Local path (read-only) | Language |
| --- | --- | --- |
| `pi` | `C:/Users/rober/AppData/Local/Temp/harness-research/pi` | TypeScript |
| `deepseek-harness` | `C:/Users/rober/AppData/Local/Temp/harness-research/deepseek-harness` | TypeScript (monorepo, pnpm) |
| `hermes-agent` | `C:/Users/rober/AppData/Local/Temp/harness-research/hermes-agent` | Python + TypeScript |

Each repo is a git checkout. `git -C <path> ls-files` lists the tracked files; you
may use `git -C <path> log`, `git show`, and `git blame` to recover intent, but do
not write to the repo.

---

## 2. Your two output files

Let `<repo>` be your repo key and `<shard>` be your shard name.

**A. The report** — `C:\Dev\august-3.5\docs\research\<repo>\shards\<shard>.md`

**B. The status ledger** — `C:\Dev\august-3.5\docs\research\<repo>\shards\<shard>.status.tsv`

Format: a header line `path\tstatus\tnote`, then one row per file in your shard,
TAB-separated, in the same order as your file list. `status` is exactly one of:

| status | meaning |
| --- | --- |
| `read` | you opened the file and its content is reflected in your report |
| `skipped` | you did NOT read it line by line — the `note` must say why, and what you did instead (e.g. "binary asset, size confirmed on disk"; "generated lockfile"; "bulk tier: catalogued via directory listing and the module's index file, not read line by line") |

**No silent skips.** Every file in your list must appear in the status TSV with a
status. A missing row is a gate failure.

Write the status TSV **last**, after the report, so the notes can reflect what you
actually did.

---

## 3. Your shard

Your file list is at:
`C:\Dev\august-3.5\docs\research\<repo>\shards\<shard>.files.txt`

Format: `# <repo> :: <shard> :: N files :: SIZE KB` then `# size_bytes\ttype\tpath`
then one row per file: `size_bytes<TAB>type<TAB>path`.

### 3.1 HOW TO READ — batch, do not read one file per call

**This is the difference between finishing and not finishing.** One `read` call per
file is far too slow for shards of this size. Read in batches instead.

Use the **shell tool** (`pwsh` on this machine) to print many files in one call, for
example:

```powershell
$root='C:/Users/rober/AppData/Local/Temp/harness-research/pi'
$files = @('packages/ai/src/a.ts','packages/ai/src/b.ts', ...)   # 15-30 paths
foreach ($f in $files) { "===== FILE: $f ====="; Get-Content (Join-Path $root $f) -Raw }
```

`Get-Content -Raw` on a path list is a **read**, not an execution — it does not run
the repo's code, does not trigger a postinstall, and does not touch the network. It
is exactly the same bytes the `read` tool would show you. Use it.

Rules for batching:

- **15–30 files per shell call.** Above ~30 the output is truncated and you will
  silently lose the tail, which is worse than being slow.
- Print a `===== FILE: <path> =====` header before each file, so you can attribute
  what you see.
- Take the paths from your `.files.txt` list; do not guess or glob the whole repo.
- Never run a build, a test, an install, a codegen, or any repo script. Never run
  `node`, `python`, `npm`, `pnpm`, `pip`, `uv`, `make`, `cargo` on a repo file.
  `Get-Content`, `Select-String`, `Get-ChildItem` and `git` are all fine.
- If a file is huge (> 120 KB), read it alone, or read its head and tail with
  `Get-Content -TotalCount 400` and `Get-Content -Tail 200`, and say so in the note.
- For very large shards, **read in batches and write the report as you go** —
  append a section per batch. Do not hold 300 files in your head and write once at
  the end.

### 3.2 How much to read — three tiers

The `type` column is the pre-computed classification: `source`, `config`, `docs`,
`tests`, `examples`, `build-CI`, `assets`, `generated-vendored`.

| Tier | Types | What you must do | Status you record |
| --- | --- | --- | --- |
| **1 — the load-bearing code** | `source` files that implement behaviour | Read the file **fully**. Per-file entry with purpose, abstractions, data flow, non-obvious decisions, edge cases, surprises. | `read` |
| **2 — the bulk** | `tests`, `docs`, `examples`, `config`, `build-CI` | Read them in batches. You still open every file, but a **one-line entry per file** is enough for a test file or a config file: what it pins or configures. For `docs`, one line on what the document *decides* is usually the most valuable thing in it. | `read` |
| **3 — not read line by line** | `generated-vendored`, `assets` | Confirm what it is (size, name, and a peek at the head for a non-binary), then say so. Do not read a 1.4 MB JSON schema line by line. | `skipped` + reason |

**Never fabricate a read.** If a file is unreadable, truncated by your own batching,
or unclear, mark it `skipped` with a reason that says exactly what happened. If a
batch output was cut off, re-read the tail of that batch — a silently dropped tail is
the single worst failure mode here, because it makes the ledger claim coverage it
does not have.

A `skipped` row is not a failure. A **missing** row is.

### 3.3 The file list may be huge

Some shards hold 1,500–2,100 files, most of them small. That is fine: 70 files per
shell call is 25–30 calls. Keep going until the list is exhausted. Do not stop
early, and do not silently sample.

For shards that are overwhelmingly one kind of file (e.g. 1,700 test files, or 900
markdown design notes), the **set** is the unit of understanding. Write a section
that says what the set does as a whole, then a **compact table with one row per
file**. The table is the ledger: every file named, every file with a verdict.


---

## 4. The report structure

Write for an engineer who has never seen the repo and wants to **steal ideas**.
Every claim must carry a `path:line` reference.

```markdown
# <repo> :: <shard>

**Files in shard:** N (read: X, skipped with reason: Y)
**What this shard covers:** one paragraph.

## 1. File-by-file

For EACH file in the shard, an entry.

### Tier 1 — load-bearing source: full entry

### `path/to/file.ext`
- **Purpose:** one sentence.
- **Key abstractions:** the exported names / classes / functions that matter.
- **Data flow:** how data enters, is transformed, and leaves.
- **Non-obvious design decisions:** the choice a reader would not guess, and *why* it looks deliberate.
- **Edge cases & failure handling:** what happens on empty input, error, timeout, partial write, concurrent access.
- **Surprising:** anything that contradicts the obvious reading, or is dead / vestigial.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `path/to/file.test.ts` | one line: what behaviour this test actually pins |

Every file in the shard must appear exactly once, in a Tier-1 entry or a Tier-2
table row. The table is not a summary — it is the ledger.

### Tier 3 — skipped with a reason

One line each: the file and why it was not read line by line.

## 2. Ideas worth stealing

A numbered list. For each: **what** (one sentence), **where** (`path:line`),
**why it transfers** to August Trading. Mark each as:
- `CONVERGENT` — two or more of the three reference repos do the same thing
  (a convergence is a strong signal, say so), or
- `UNIQUE` — only this repo does it.

## 3. Trading-specific findings

Answer, for this shard, whichever of these apply. Say "not in this shard" where a
question belongs to a different shard — do not guess.

- **Long-lived monitoring & scheduled work:** how does the repo run monitoring /
  cron-style work (detecting entry/TP/SL hits, periodic digests, scheduled jobs)?
  What keeps it reliable — persistence, recovery on restart, catch-up for missed
  runs, idempotency, a breaker after repeated empty runs?
- **Human-in-the-loop approval:** how are consequential actions gated? What is the
  approval record, and what audit trail survives a decision?
- **Post-mortem / reflection loops:** how do outcomes become new rules, and what
  stops bad rules from accumulating (worth gates, expiry, retirement, consolidation)?
- **Multi-agent:** subagents vs debate — where does debate actually add value over
  one agent, and where is it wasted effort?
- **Structured logs the model can query:** how is a queryable log kept without a
  heavy database (file-per-record, JSONL, SQLite, FTS)?
- **Staying simple as features accumulate:** what does the repo do to stop the
  feature count from becoming the product?

## 4. Non-obvious decisions and gotchas

The handful of things a reader would get wrong. Be specific.

## 5. Weak spots

Where this shard's code is fragile, over-engineered, or inconsistent. Be fair —
these repos are references, not saints.
```

---

## 5. Lenses to apply to every shard

- **Agent loop and turn lifecycle** — what is a "turn", who owns it, where does it end.
- **Tool design and validation** — declaration, schema/validation, dispatch, result shaping.
- **Memory and learning loops** — what is remembered, when, and how it changes behaviour.
- **Skill / rule lifecycle** — creation, approval, expiry, retirement, versioning.
- **Session storage and compaction** — what is persisted, how a transcript is compacted.
- **Context management** — what is in the prompt, how it is budgeted, what is dropped.
- **Model routing and fallbacks** — provider selection, retry, degradation.
- **Prompt size and caching** — prompt assembly, caching, prompt size discipline.
- **Error, timeout, and abort handling** — what is surfaced, what is swallowed.
- **UI/UX streaming and progress feedback** — what the user sees while work happens.
- **Minimalism** — what was deliberately left out.
- **Testing and evals** — what is pinned, and what the tests actually prove.

## 6. Trading-specific questions (repeated for emphasis)

1. How do they run long-lived monitoring and scheduled work (detecting entry/TP/SL
   hits, periodic digests, cron-style tasks) reliably?
2. How do they handle human-in-the-loop approval for consequential actions, and
   audit trails for every decision?
3. How do they structure post-mortems or reflection loops that turn outcomes into
   new rules, and how do they stop bad rules from accumulating?
4. How do they do multi-agent work (subagents vs debate), and where does debate add
   value over a single agent?
5. How do they keep structured logs the model can query later (their equivalent of
   a trade log), and what storage do they use without heavy databases?
6. What do they do to stay simple as features accumulate?

## 7. Return value

Your final chat response must be **compact** — the lead reads many of these and the
context budget is finite. Return a summary object with:

- `shard`: the shard name
- `filesTotal`, `filesRead`, `filesSkipped`
- `topIdeas`: up to 8 one-line "ideas worth stealing" (the highest-value ones)
- `tradingFindings`: up to 6 one-line findings relevant to trading
- `weakSpots`: up to 5 one-line weak spots
- `reportPath`: the absolute path you wrote

The full detail belongs in the report file, not in your reply.
