# hermes-agent :: hermes-contributors

**Files in shard:** 2112 (read: 2, skipped with reason: 2110)
**What this shard covers:** the repository's contributor-attribution substrate — the
data half of "who gets credited in the release notes". It is 1 protocol document
(`contributors/README.md`), 1 documentary provenance ledger
(`contributors/reattributed.tsv`), and 2,110 tiny files under
`contributors/emails/`, each of which maps one commit-author email address to
one GitHub login. There is no `source`-typed file in this shard: the shard is
pure data plus the contract that describes it. The *behaviour* that consumes
this data lives outside the shard (`scripts/releases/authors.py`,
`scripts/add_contributor.py`, `scripts/audit_pr_attribution.py`,
`scripts/contributor_audit.py`, `.github/workflows/contributor-check.yml`,
`scripts/ci/classify_changes.py`, `scripts/check-case-collisions.py`); those
files were read for context only, are cited with `path:line`, and are **not**
counted as this shard's coverage — they belong to other shards.

**PII handling (SHARD-BRIEF §0.5).** Every path under `contributors/emails/` is
a real person's email address, and the file bodies carry GitHub logins and
free-text provenance notes about identifiable people. Those addresses are
therefore **not reproduced in this report**. The per-file ledger for all 2,110
of them — one row per file, in the same order as the shard file list, with a
status and a note — is the status TSV
(`docs/research/hermes-agent/shards/hermes-contributors.status.tsv`), which is
the prescribed place for path-level coverage. No email address, login, or
provenance comment is quoted in the prose below.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

None. This shard contains no `source`-typed files; the shard's two readable
files are `docs` and `config` (Tier 2), and the remaining 2,110 are
`generated-vendored` (Tier 3).

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `contributors/README.md` | The contract for the whole directory, and the single most decision-dense file in the shard. Decides: one mapping per file, filename = exact commit-author email as `git log --format='%ae'` reports it, body = GitHub login on the first non-comment line, `#` lines are comments (used for the PR reference); the legacy `AUTHOR_MAP` dict is **frozen** and new entries must not go there; GitHub noreply addresses auto-resolve so no file is needed; the `Contributor Attribution Check` CI job fails any PR carrying an unmapped email, and the failure message prints the exact command to run. |
| `contributors/reattributed.tsv` | A documentary provenance ledger with **no program reader anywhere in the repo** (verified by an exhaustive text search over every tracked file, plus `git log --all`): 6 header comment lines + 194 data rows of `original_sha ⇥ author_date ⇥ subject`, spanning 2026-09-24 → 2026-09-26. Subject mix: 157 `fix`, 24 `test`, 5 `style`, 4 `chore`, 1 each of `ci`/`docs`/`refactor`/`revert`. It records commits whose author identity was an unverifiable repo-local machine identity, and documents that `main` cannot be rewritten, so each correction is a *separate attribution commit authored by the human at the original date*. |

#### `contributors/README.md` — the decisions it makes

- **Purpose:** replace "append to a shared dict" with "add a file", so that
  concurrent salvage PRs never collide.
- **What it decides (the load-bearing lines):**
  - `contributors/README.md:3-8` — the directory *replaces* appending entries to
    the `AUTHOR_MAP` dict; "every PR edited the same lines of the same file";
    "each mapping is its own file, and file additions never conflict".
  - `contributors/README.md:19-20` — the two-field format: **filename** = the
    exact commit-author email; **content** = the GitHub login on the first
    non-comment line; `#`-prefixed lines are comments, "use them for the PR
    reference".
  - `contributors/README.md:32-34` — the legacy dict is *frozen legacy data*;
    the release tooling merges it with this directory and **directory entries win
    on duplicates**.
  - `contributors/README.md:35-36` — GitHub noreply addresses
    (`<id>+<login>@…` and `<login>@…`) auto-resolve, so a file is not needed.
  - `contributors/README.md:37-39` — the CI job that fails a PR with an unmapped
    email, and the promise that the failure message prints the exact command to
    run.
- **Non-obvious:** the file is written as a *procedure for a future
  contributor*, with the command line for the tool, the by-hand equivalent, and
  the worked example. It is the only place in the repo that states the
  precedence rule (directory beats legacy) — the loader implements it at
  `scripts/releases/authors.py:48`, and the README is the human-readable
  mirror of that one line.
- **Surprising:** the README tells you *not* to edit the file the code
  actually imports for the legacy half
  (`scripts/releases/authors_legacy.py:1`, "Data only; never append"), which
  means a reader who greps for `AUTHOR_MAP` first will land on the wrong file.

#### `contributors/reattributed.tsv` — the decisions it makes

- **Purpose:** be the *immutable record of corrections that could not be
  applied to history*.
- **The decision (`contributors/reattributed.tsv:1-5`):** a repo-local git
  identity on one maintainer's machine stamped agent-assisted commits with an
  address no GitHub account can verify, so GitHub credited them to nobody;
  `main` cannot be rewritten; therefore **each row has a matching attribution
  commit, authored by the human at the original date, that names the original
  commit**. The ledger row and the commit are two halves of one repair.
- **Why it matters for a research reader:** this is the clearest example in the
  repo of an *append-only correction log* — you cannot edit the past, so you
  publish a row naming the original artefact and you leave the correction in
  the commit graph where it is auditable by anyone with `git log`.
- **Surprising:** nothing reads it. There is no checker, no CI job, no
  generator. It is maintained by hand, it is the *only* file in the shard with
  no consumer, and it can therefore drift silently from the commits it claims
  to describe.

### Tier 3 — skipped with a reason

All 2,110 files under `contributors/emails/` are typed `generated-vendored` by
the shard classifier, so under SHARD-BRIEF §3.2 they are Tier 3: confirmed
rather than read line by line. They were additionally skipped *on purpose*
because every one of them is a personal-data record (§0.5).

**What I did instead of a line-by-line read** (so the coverage claim is exact,
not a guess):

1. Listed the directory: 2,110 files, 47,686 bytes total, sizes 5–166 bytes
   (mean 22.6).
2. **Opened and machine-scanned every one of the 2,110 files** — extracting,
   for each, the number of non-empty lines, whether it carries a `#` comment,
   and the first non-comment line — and checked the first line against the
   repo's own login regex `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`
   (`scripts/add_contributor.py:32`). No file body is quoted anywhere.
3. Peeked at the head of a 6-file sample spread across the directory to
   confirm the format is uniform and that a "peek at the head" is representative
   of the whole set (it is: 2,108 of 2,109 mapping files parse as a valid
   login plus optional comments).
4. Read the *entire* protocol and the *entire* ledger (the two Tier-2 files),
   plus every consumer of the directory, so the set's semantics are known from
   its readers rather than guessed from its names.

**Per-file verdicts.** The one-row-per-file ledger is the status TSV
(`hermes-contributors.status.tsv`), in the same order as the shard file list —
2,112 rows for 2,112 files, each with `path`, `status`, and a note. It is
deliberately **not** duplicated here, because duplicating it would reproduce
2,109 contributor email addresses into this report, which §0.5 forbids. The
set-level structure that the ledger's rows all share:

| Class (of the 2,110) | Count | What each one is / what it pins |
| --- | --- | --- |
| Mapping file, login only (1 line, no comment) | 1,464 | The bare minimum: one commit-author email → one GitHub login. The comment is optional; the login is not. |
| Mapping file, login + one `#` comment | 639 | Adds the *why*: a PR number and a one-phrase justification (the dominant forms are 570 files citing a `PR #` and 390 mentioning a "salvage" — a salvaged branch's authorship repaired). |
| Mapping file, login + 2+ comments | 6 | The same, with a longer repair story than one line can carry. |
| Directory placeholder (`.gitkeep`) | 1 | Carries `_placeholder` plus a comment saying it is "not a real mapping". It is also the file that proves dotfiles are skipped at load time — the loader explicitly skips names starting with `.` (`scripts/releases/authors.py:34`), so a file whose first line is `_placeholder` never becomes a bogus key. |
| **Total** | **2,110** | 2,109 real mappings + 1 placeholder. |

**Statistics of the 2,109 real mappings** (computed over every file, no
addresses reproduced):

- 2,761 non-empty lines total; every file has ≥ 1 non-empty line; 645 files
  carry at least one comment.
- 1,905 distinct logins for 2,109 files — **161 logins are reachable from more
  than one address** (365 files involved). That is not duplication: it is one
  person committing under several identities (a work address, a personal
  address, a noreply address), and the mapping set is the only place that says
  so.
- **448 files are named `<…>@users.noreply.github.com`**, even though
  `contributors/README.md:35-36` says such addresses "auto-resolve — no file
  needed". These files exist to *override* the auto-resolution: the lookup
  consults the explicit map first (`scripts/releases/authors.py:54-56`) and only
  then the noreply regexes (`scripts/releases/authors.py:59-66`), so a file for
  a noreply address wins over the pattern. The pattern is a default; the file
  is the exception.
- 83 files are named with a `localhost` / `.local` / `.invalid` machine
  identity, and 5 with an `agent@…` placeholder — i.e. **~4% of the directory
  exists to repair commits authored by a machine that no account can verify**,
  which is exactly the condition `contributors/reattributed.tsv:1-5` documents
  at ledger level.
- **Data quality:** 2,108 of 2,109 first lines satisfy the repo's own login
  regex; **1 does not** — its login slot holds an email address rather than a
  login. `scripts/add_contributor.py:32` would have rejected it, so it was
  hand-written, and nothing validates it on the way back in
  (`scripts/releases/authors.py:40` takes the first non-comment line verbatim).
  The effect is a malformed `@`‑mention in release notes
  (`scripts/releases/authors.py:56`).
- One filename in the set is not a valid shell glob (`[email protected]`).
  Quoted paths (`[ -f … ]`, `path.is_file()`) handle it; an unquoted `for f in
  contributors/emails/*` would not.
- **One filename in the set is the literal GitHub noreply *template***
  (`{ID}+{username}@users.noreply.github.com`), tracked in git and holding a
  real login. It is a doc placeholder that was created as a key: it can never
  match a real commit address, so it is inert, and nothing in the loader or
  the CI gate objects to it. A "the key is a real address" invariant is
  assumed everywhere and enforced nowhere.

---

## 2. Ideas worth stealing

> **Convergence caveat:** this shard is hermes-agent only. Every item below is
> marked `UNIQUE` *as far as this read shows*; the `pi` and `deepseek-harness`
> shards must confirm or overturn each `CONVERGENT` claim before the
> research report asserts it.

1. **Store a growing key→value map as one file per key, not as one growing
   file.** — `contributors/README.md:3-8` (and the loader at
   `scripts/releases/authors.py:22-44`). *Why it transfers:* August Trading has
   several append-to-one-file registries that will collide the moment two
   windows/branches/skills are added at once — the skills notebook, the rules
   store, the bot roster, the per-bot memory files. One file per key makes
   additions conflict-free by construction, and the loader is 20 lines.
2. **Freeze the old registry and layer a new one over it, with a stated
   precedence.** — `contributors/README.md:32-34`,
   `scripts/releases/authors_legacy.py:1-13`, `scripts/releases/authors.py:48`
   (`{**LEGACY_AUTHOR_MAP, **_load_contributor_dir()}`). *Why it transfers:*
   the same "legacy data never append, new data in a directory, directory wins"
   shape works for a prompt registry or a schema-versioned store that August
   Trading may need to grow without rewriting history.
3. **Make an explicit record beat an inferred one — and encode that in the
   lookup order.** — `scripts/releases/authors.py:54-66`: the map is consulted
   *before* the noreply regexes, so a hand-written file overrides the pattern
   that would otherwise have auto-resolved the same address. 448 of the 2,109
   mappings exist purely to override a default. *Why it transfers:* wherever
   August Trading infers something (a model from a name, a symbol from a file
   path, a bot from a provider), the record store must be consulted first and
   the inference must be the fallback.
4. **Refuse to overwrite a conflicting key; make a same-key write idempotent.**
   — `scripts/add_contributor.py:105-117`: same login → prints `present`,
   exit 0; different login → refuses with exit 1 so "a typo can't silently
   reassign someone's commits" (`scripts/add_contributor.py:14-16`). *Why it
   transfers:* a rule/skill writer that silently overwrites an existing rule
   destroys the trader's history; this is a 10-line pattern with the right
   exit codes.
5. **A CI gate that fails the change and prints the exact remediation
   command.** — `.github/workflows/contributor-check.yml:49-70` (collects the
   offenders) and `:76-83` (prints `python3 scripts/add_contributor.py <email>
   <github-username>`, and the `gh api` lookup to find the login). *Why it
   transfers:* every August Trading gate (render-probe, boot-probe,
   skill-approval-probe) should end with the command that makes it green, not
   a symptom.
6. **Mirror the CI gate locally so you never discover it after pushing.**
   — `scripts/audit_pr_attribution.py:1-12`: "Mirrors the CI gate in
   `.github/workflows/contributor-check.yml` so salvage branches never bounce
   off the check-attribution job", with the same skip rules and the same
   resolution order. *Why it transfers:* run the *same* rule engine locally
   (`npm run render-probe` before pushing) rather than a second, weaker
   re-implementation of the rule.
7. **Automate the resolution, but keep the human eye on the uncertain case.**
   — `scripts/audit_pr_attribution.py:89-105` resolves a login from the
   address by API lookup, and `:126` prints "⚠ local part is user-controlled —
   confirm … really is the contributor … before pushing" for the one shape
   where the heuristic is *usually* right. The file is still written by the
   tool, but the commit is still the human's. *Why it transfers:* the exact
   shape August Trading needs wherever a model proposes a trade rule, a skill
   name, or a chart annotation it will be filed under.
8. **Emit the gate's verdict as machine-readable data, not just a log line.**
   — `.github/workflows/contributor-check.yml:88-96` writes a JSON
   `review_status` array to `$GITHUB_OUTPUT` and uploads it as an artifact
   (`:98-105`), so a reviewer bot (or an agent) can consume the verdict
   structurally. *Why it transfers:* the probe gates in August Trading should
   emit structured findings, so a future "why is the app unhappy" tool can read
   them without scraping prose.
9. **Treat a data-only diff as a different, cheaper CI lane.** —
   `scripts/ci/classify_changes.py:136` (`_CATALOG_DATA = ("plugin-catalog/",
   "contributors/emails/")`) and `:548-550`: a diff made only of catalog entry
   data runs the catalog tests *instead of* the 23k-test Python suite, "those
   files are data that a known set of tests reads, so a one-entry PR need not
   run 23k tests on three OSes". *Why it transfers:* a PR that only adds a
   learned rule or a notebook entry should not run the full 5,343-test suite.
10. **State the CI contract explicitly: fail open, never closed.** —
    `scripts/ci/classify_changes.py:60-62`: "We may run a lane we didn't need,
    but must never skip one a change could break" — with the slow lanes as the
    one deliberate exception, and the empty-diff / any-`.github/` case running
    everything. *Why it transfers:* the same sentence is the right rule for
    August Trading's probe gates, and it is the right thing to write down in
    `AGENTS.md` when a gate is *deliberately* skipped.
11. **Refuse a key that would collide on a case-insensitive filesystem.**
    — `scripts/add_contributor.py:58-74` and `:95-103`; repo-wide enforcement
    in `scripts/check-case-collisions.py:3-38`. Because the *filename is the
    key*, two keys differing only in case are one file on Windows/macOS and
    two on Linux — "the repo impossible to check out cleanly there … `git
    status` reports a phantom modification forever". *Why it transfers:* any
    August Trading store keyed by a user-supplied string (a skill name, a bot
    name, a notebook file) has this exact bug on Windows — the app's own
    filesystem. This is the single most transferable defect-class in the shard.
12. **When history cannot be rewritten, publish an append-only correction
    ledger that names the original artefact.** —
    `contributors/reattributed.tsv:1-6` + 194 rows. *Why it transfers:* a
    trade log entry that was settled with the wrong outcome, or a rule that was
    retired and later needed as evidence, cannot be edited in place if the
    trader has already seen it; a "corrections.tsv" naming the original id,
    the original timestamp and the correcting record is the same pattern.
13. **Keep an explicit denylist of machine authors, versioned by audit
    round.** — `scripts/contributor_audit.py:38-63` (`IGNORED_PATTERNS`, with
    "v0.20.0 audit additions" / "v0.21.0 audit additions" markers) and
    `:65-85` (`IGNORED_EMAILS`, listing AI-agent co-author trailers). *Why it
    transfers:* bot turns, subagent turns and automation rows must never be
    counted as the trader's own work in a summary or an accuracy statistic.
14. **A tiny writer script that is idempotent, validates, and refuses
    conflicts — with the human-facing error message as the contract.**
    — `scripts/add_contributor.py` in full: two regexes (`:27`, `:32`), a
    case-collision check (`:58`), an existing-value check (`:105`), a single
    write (`:123`). 138 lines for the whole feature. *Why it transfers:* the
    thing August Trading keeps over-engineering is usually this small.

---

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work:** not in this shard. This shard
  contains no scheduler, no cron, no run-history and no recovery logic. The
  nearest thing is a *ledger of runs that could not be applied retroactively*
  (`contributors/reattributed.tsv`), which is a monitoring-adjacent pattern
  (see §3 "Post-mortem" below), not a scheduler.
- **Human-in-the-loop approval:** this shard is a clean, small instance of the
  pattern. The consequential action — crediting a person's commits to a
  GitHub account — is gated by a CI check that **fails the PR**
  (`.github/workflows/contributor-check.yml:49-70`), and the repair is a
  commit a human authors and pushes (`contributors/README.md:37-39`,
  `scripts/audit_pr_attribution.py:136-140`: "remember to `git add contributors
  && git commit`"). The **approval record** is the file's own content: the
  login, plus the `#` comment naming the PR and the reason. The **audit trail
  that survives the decision** is the commit graph itself — one commit per
  mapping — plus the `reattributed.tsv` ledger for the cases that could not
  be fixed in place. The transfer to August Trading: a skill/rule approval
  should leave a *record whose reason travels with it* (here: the `# PR #12345
  salvage (…)` line, in 645 of 2,109 files), not just a boolean.
- **Post-mortem / reflection loops:** partially in this shard. The mapping
  comments are per-decision *reasons* (390 mention "salvage", 570 cite a PR),
  and `reattributed.tsv` is a *correction ledger*. What is **not** here is any
  value/worth gate, expiry, or retirement for accumulated rules — the 2,109
  mappings never expire and never consolidate (161 logins are reachable from
  more than one address and stay duplicated forever). So: the repo is a good
  model for *attaching the reason to the rule*, and a cautionary tale for
  *not retiring rules*.
- **Multi-agent:** not in this shard. The only multi-agent signal is
  *negative* and very relevant: this directory exists because agent-assisted
  commits were authored under an unverifiable machine identity
  (`contributors/reattributed.tsv:1-5`), and 88 of the 2,110 files repair
  machine or `localhost` identities. The denylist at
  `scripts/contributor_audit.py:38-85` keeps AI co-author trailers out of the
  human contributor list. Transfer: in August Trading, an AI row is claimed by
  identity, never by provider+model — the same principle this directory
  applies to commits.
- **Structured logs the model can query:** this shard is the cleanest example
  in the whole repo of "queryable log without a database". The store is a flat
  directory of 2,110 files; the reader is a 20-line loop
  (`scripts/releases/authors.py:22-44`); the query language is `grep`, `git
  grep`, and the model. 47 KB of data, no schema, no migration, no index, no
  database. Transfer: a trade/analysis ledger in August Trading could be
  one-file-per-record in a directory and still be greppable by the model —
  with the same rule that the **filename is the key** and therefore the
  filesystem's case-insensitivity becomes part of the schema.
- **Staying simple as features accumulate:** the entire feature is ~40 lines of
  loader (`scripts/releases/authors.py:22-48`) + 138 lines of writer
  (`scripts/add_contributor.py`) + 100 lines of local mirror
  (`scripts/audit_pr_attribution.py`) + one shell gate
  (`.github/workflows/contributor-check.yml`). It carries 2,109 records with no
  database, no schema migration, and no registry object. The counter-pressure
  is explicit and written down: the legacy dict is *frozen*
  (`scripts/releases/authors_legacy.py:1`) and the new path is *additive only*,
  so the feature grew without ever rewriting the old one.

---

## 4. Non-obvious decisions and gotchas

1. **The directory beats the pattern, because the lookup order says so.**
   `scripts/releases/authors.py:54-56` checks the map *before* the noreply
   regexes at `:59-66`. A file for a `<id>+<login>@users.noreply.github.com`
   address therefore overrides the auto-resolution that
   `contributors/README.md:35-36` says "needs no file" — which is why 448 such
   files exist and are not redundant. A reader who assumes the regex wins will
   mis-attribute 448 records.
2. **The CI gate checks that a file EXISTS, never that its content is
   valid.** `.github/workflows/contributor-check.yml:62-64` is `[ -f
   "contributors/emails/${email}" ]`. The login regex lives only in the
   *writer* (`scripts/add_contributor.py:32`). One hand-written file in 2,109
   has a non-login in the login slot, and it reaches release notes as a
   malformed `@`-mention. Validation is on the write path, never on the read
   path.
3. **An unmapped author degrades silently to the git name.**
   `scripts/releases/authors.py:68-69` falls back to `return name` — so a
   missing mapping produces a plausible-looking but wrong credit rather than a
   visible failure. The CI gate is the only thing standing between a typo and
   a wrong name in the release notes.
4. **The filename is the key, and the key is a case-insensitive file name.**
   `scripts/add_contributor.py:58-74` exists solely because of this. On
   Windows/macOS two addresses differing only in case are one file; on Linux
   they are two. The refusal message spells out the consequence: the repo
   "reports a phantom modification forever" (`scripts/add_contributor.py:93-94`).
5. **One filename in the directory is a shell glob.** The set contains a
   bracketed name; quoted paths and `pathlib` handle it, an unquoted
   `for f in contributors/emails/*` does not. Any future script that globs
   this directory (rather than iterating `Path.iterdir()`) will mis-handle it.
6. **Dotfiles are skipped at load — and one of them would otherwise be a
   bogus key.** `scripts/releases/authors.py:34` skips names starting with
   `.`; the placeholder file's first non-comment line is `_placeholder`, which
   would otherwise become a mapping key.
7. **`reattributed.tsv` has no reader.** Exhaustive text search over every
   tracked file finds no reference to it, and no CI job checks it. It is a
   hand-maintained ledger of 194 repairs that can silently drift from the
   commits it claims to describe — and, unlike the mapping files, nothing
   fails if it does.
8. **The mapping set is deliberately not deduplicated.** 161 logins are
   reachable from more than one address. That looks like drift and is not: it
   is the only record that one person committed under several identities.
   A "cleanup" pass that merged them would destroy information.
9. **One of the 2,109 files is keyed on a placeholder, not on an address.**
   The set contains a tracked file whose name is literally
   `{ID}+{username}@users.noreply.github.com` — the *template* from
   `contributors/README.md:35` — carrying a real login. It can never match a
   commit, so it is harmless, but it proves the invariant "the key is a real
   commit-author address" is assumed by every reader and enforced by none:
   `scripts/add_contributor.py:27` would reject the name as an email, and the
   CI gate's `[ -f … ]` test would happily accept it.

---

## 5. Weak spots

1. **The read path trusts the write path.** No validation on load
   (`scripts/releases/authors.py:40`), no content check in CI
   (`.github/workflows/contributor-check.yml:62-64`), and at least one file
   already holds a non-login in the login slot — producing a malformed
   `@`-mention. Another file is keyed on a *placeholder* address rather than a
   real one (§4.9). The invariant "the file body is a GitHub login and the
   file name is a real address" is enforced only at write time, and the
   directory is hand-editable.
2. **`reattributed.tsv` is a ledger with no reader and no checker.** 194 rows
   of provenance that nothing validates and no tool regenerates; it is the
   one file in the shard that can rot without any signal. (It is also the
   shard's most interesting file, which is a shame that it is unwatched.)
3. **A silent fallback masks missing data.** `scripts/releases/authors.py:68-69`
   returns the git name when the map misses, so an unmapped author is credited
   by display name with no signal. The "wrong credit" is exactly the failure
   mode a release-notes attribution check is supposed to prevent, and the
   fallback means the map is load-bearing only where CI runs.
4. **The feature is duplicated across three implementations** — the shell
   gate, the Python mirror, and the loader each encode the "is this email
   mapped?" rule separately
   (`.github/workflows/contributor-check.yml:46-70`,
   `scripts/audit_pr_attribution.py:65-80`, `scripts/releases/authors.py:51-69`),
   and the shell gate's skip list and the Python skip list
   (`scripts/audit_pr_attribution.py:41-47`) must be kept in sync by hand.
   The comment "kept in sync with contributor-check.yml"
   (`scripts/audit_pr_attribution.py:15`) is the only thing holding them
   together. A single Python resolver invoked by both would be strictly
   better.
