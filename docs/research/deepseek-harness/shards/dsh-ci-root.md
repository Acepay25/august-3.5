# deepseek-harness :: dsh-ci-root

**Files in shard:** 194 (read: 179, skipped with reason: 15 — 11 generated i18n hash records, 2 SVG assets, the generated `uv.lock`, and the one 400 KB patch whose two minified bundle lines were truncated; see the status TSV for the per-file reasons)
**What this shard covers:** the repository's *governance and measurement* layer, not its runtime. It is four clusters: (1) `.github/` — the issue-policy engine, the weighted-approval / production-blame reviewer-weighting engine, issue templates, and 25 GitHub Actions workflows; (2) `benchmarks/` — a Vitest-bench harness for measuring agent-continuation, session-open, session-corpus, conversation-fold, terminal-IO and user-text costs, plus a runner-cost scaling report; (3) `patches/` — the `pnpm patch` diffs the repo pins against third-party packages; (4) `python/sdk` + `python/sdk-runtime` — the Python SDK client, its office helper, the bundled runtime bootstrap, and `website/` — the VitePress documentation site, its custom theme, and its specs. Nothing here is trading logic; the transferable value is **how a harness measures itself, gates itself, and writes down what it decided**.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

### `.github/issue-management/rules.mjs`
- **Purpose:** Pure (network-free) policy rules for Issue/PR metadata: which labels a PR may carry, which labels an Issue may *not* carry, how a PR body is parsed into resolving vs. informational Issue references, and what Project Status an event is allowed to move an Issue to.
- **Key abstractions:** `requiresPullRequestPolicy({isDraft, authorType, reviewRequestCount, reviewCount})`, `resolvingIssueStatusCommand(eventName, event)`, `nextResolvingIssueStatus(currentStatus, command, currentStatusActor)`, `projectDate(timestamp, timeZone)`, `parseReferences({body, repository})`, `retainIssueReferences(references, issues)`, `validateIssue(issue)`, `isInvalidIssueLabel(label)`, `validatePullRequest(input)`.
- **Data flow:** `config.json` → module-level constants → pure predicates → arrays of human-readable Chinese error strings. No I/O at all; the module is importable from tests without mocking.
- **Non-obvious design decisions:**
  - **Retired label aliases are RESERVED, not deleted** — `.github/issue-management/rules.mjs:28` keeps `kind/bug`, `bug-fix`, `doc`, `ci`, `cli`, `llm`, `web-search` etc. in a `LEGACY_LABELS` set with the comment "Retired label aliases stay reserved so they cannot be recreated". A rename in the label taxonomy therefore cannot silently resurrect an old vocabulary.
  - **The PR's own author is excluded from the label rule but the label sets are disjoint by design**: `kind/*` is for PRs only, `source/*` is for Issues only (`rules.mjs:315` — "`source/*` 仅用于 Issue"). Two namespaces, one rule each.
  - **Priority is only synchronised for RESOLVING references.** An informational `Refs #3624` establishes context and carries no cross-object constraint (`rules.mjs:322`); only `Fixes/Closes/Resolves` references pull in the Project Priority check. This is the single most transferable idea in the shard: *context references are cheap; commitments are checked.*
  - **Status transitions are monotonic through `ACTIVE_STATUS_ORDER`** and can only move forward, except a `changes-requested` that the *automation itself* last set (`rules.mjs:99`) — a human-owned `In review` cannot be knocked back to `In progress` by the bot. The `currentStatusActor` check compares against `config.lifecycleActor`.
  - **References inside HTML comments, code fences, or inline code do not count** (`rules.mjs:148` `stripIgnoredMarkdown`), and cross-repo references are ignored unless the explicit `owner/repo#N` matches.
- **Edge cases & failure handling:** module-load-time assertions throw if `config.statuses` lacks `In progress`/`In review`, or if `lifecycleActor`/`priorityField`/`startDateField`/`projectTimeZone` are unset (`rules.mjs:44-56`). `projectDate` throws on an invalid timestamp. `parseReferences` returns three sorted, de-duplicated arrays.
- **Surprising:** `parseReferences` is regex-based over the PR body and treats `#123` and `owner/repo#123` and `https://github.com/o/r/issues/123` as equivalent; a closing keyword only counts if the keyword is *immediately* followed by the reference.

### `.github/issue-management/github.mjs`
- **Purpose:** The only module that talks to GitHub — credential selection, REST/GraphQL transport, Issue+Project reads, and Project membership/field writes.
- **Key abstractions:** `api(path, options)`, `graphql(query, variables)`, `issueSnapshot(number, status?)`, `projectContext(number, includeStatusActor?, includeStartDate?)`, `ensureProjectItem(number, includeStartDate?)`, `initializeIssueStartDate(number, date)`, `updateStatus(context, status)`, `setStatus(number, status)`.
- **Data flow:** REST `GITHUB_TOKEN` for repository reads; a *separate* `PROJECT_TOKEN` (App token) for Project GraphQL reads (`github.mjs:17` `projectToken()` falls back to the repo token only if unset). A single GraphQL query fetches project fields, the issue's project items, and — optionally — the status-change timeline.
- **Non-obvious design decisions:**
  - **Two tokens, two permission scopes.** `api()` uses `token()`, `graphql()` overrides the Authorization header with `projectToken()`. The README calls this out as the reason an Issue reference can be "context" (repo token) while a *resolving* reference needs Project read (App token).
  - **The Project field is validated on every read, not trusted.** `projectContext` throws unless `Priority` exists, is `SINGLE_SELECT`, and is *not* an organisation-level Issue field (`github.mjs:186-196`); the same triple check applies to `Start Date` (`DATE`, project-local). A misconfigured Project fails the job instead of silently bypassing a Priority check.
  - **GraphQL errors are joined, not swallowed** — `graphql()` throws `error.messages.join('; ')` (`github.mjs:65`).
  - **Writes are conditional** — `updateStatus` reads the current value and returns without a mutation if it already matches (`github.mjs:263`); `initializeIssueStartDate` returns early if a Start Date already exists (`github.mjs:245`). Idempotency is built into the writer, not bolted on by the caller.
- **Edge cases & failure handling:** `api()` supports `allow404` (returns `null`) and returns `null` for HTTP 204. Non-OK responses throw with method, path, status and body. `ensureProjectItem` adds the Issue to the Project first and synthesises an empty item shape so callers need not branch.
- **Surprising:** `issueSnapshot` returns `null` (not an error) when the number identifies a **pull request** — `if (issue.pull_request) return null` (`github.mjs:78`). The distinction "Issue vs PR number" is a first-class, repeatedly re-checked fact across the whole module set.

### `.github/issue-management/pull-request.mjs`
- **Purpose:** Assembles read-only PR snapshots and implements the two entry points the workflow calls: `pr-preflight` (cheap eligibility) and `pr` (full validation).
- **Key abstractions:** `resolvingReferencesSnapshot(number, pull)`, `pullRequestSnapshot(number, includeProject = true)`, `lifecyclePullRequestSnapshot(number)`, `runPullRequestPreflight(event)`, `runPullRequestCheck(event)`.
- **Data flow:** REST `/pulls/N` → early-exit for draft/Bot/App → parallel `/requested_reviewers` + `/reviews` → `requiresPullRequestPolicy` gate → REST `/issues/N` for every referenced number → GraphQL `/graphql` **only for resolving Issues**.
- **Non-obvious design decisions:**
  - **The preflight is a credential-free gate, not a cached verdict.** `runPullRequestPreflight` calls `pullRequestSnapshot(number, false)` — the `includeProject=false` flag means it never touches Project data — and writes three workflow outputs: `eligible`, `exempt`, `needs-project` (`pull-request.mjs:103-110`). The full check re-reads live state independently. The README states the rule explicitly: "preflight is not a cached verdict or an exemption for metadata edits."
  - **The expensive call is only made when it can change the answer**: `needsProject = eligible && pull.references.resolving.length > 0`.
  - **Exempt PRs cost exactly three REST calls** (pull, requested_reviewers, reviews) — pinned by a test that asserts the request count for draft/Bot/App/not-reviewed (`policy.test.mjs`, "reads no Issue or Project for a currently exempt … PR").
- **Edge cases & failure handling:** every failed read rejects — the module never returns a partial snapshot. `runPullRequestCheck` writes `::error::<msg>` lines per violation and then throws with the count.
- **Surprising:** `pullRequestSnapshot` builds `references` from the *body only*; a PR that references an Issue only in a title is not covered.

### `.github/issue-management/lifecycle.mjs`
- **Purpose:** Event-driven mutation of Project state, Issue label repair, and audit comments.
- **Key abstractions:** `initializePullRequestStartDates(pull, action, initialize?)`, `repairIssueLabels(issue)`, `auditIssue(number, extraErrors?, status?)`, `runLifecycle(eventName, event)`.
- **Data flow:** event → `resolvingIssueStatusCommand` → `lifecyclePullRequestSnapshot` → `projectContext` → `nextResolvingIssueStatus` → `updateStatus` → `auditIssue` → `upsertAudit`.
- **Non-obvious design decisions:**
  - **The audit comment is a single, marker-identified, self-healing comment.** `AUDIT_MARKER = '<!-- dsh-issue-policy -->'` (`lifecycle.mjs:19`); `upsertAudit` finds the existing bot comment, PATCHes it when the body changed, POSTs a new one when absent, and **DELETEs it when the issue is now clean** (`lifecycle.mjs:40-46`). The audit trail is therefore always exactly one comment per Issue, and a resolved Issue has no leftover scolding.
  - **Repair-before-validate.** `auditIssue` calls `repairIssueLabels` (which DELETEs the offending labels) and then validates the *repaired* snapshot, so a deterministic violation is fixed rather than reported forever. The test "removes reserved labels from Issues before validation" pins the exact DELETE URLs.
  - **Irrelevant events perform zero requests** — `runLifecycle` returns early for `synchronize`, `labeled`, `unlabeled`, title-only edits, and approval/comment-only reviews.
  - **Start Date is initialised on `opened` only** and only for Issues already referenced at that moment; existing values are preserved.
- **Edge cases & failure handling:** `repairIssueLabels` uses `allow404` so a label deleted in the meantime does not fail the run. There is an explicit **known concurrency gap**: the TODO at `lifecycle.mjs:107` — "Replace this latest-state guard with per-Issue serialization or a conditional ProjectV2 update; GraphQL currently has no compare-and-swap." The README repeats it: "concurrent Project mutations have no atomic compare-and-swap."
- **Surprising:** `auditIssue` returns `[]` (no errors) when the number is a pull request, because `issueSnapshot` returns `null` for PRs.

### `.github/issue-management/policy.mjs`
- **Purpose:** 30-line CLI dispatcher — `pr-preflight | pr | lifecycle`.
- **Key abstractions:** `readEvent()` (reads `GITHUB_EVENT_PATH`), `main(argv)`.
- **Data flow:** env → JSON event file → the three `run*` functions → stdout + `process.exitCode`.
- **Non-obvious design decisions:** it is the *only* entry point and it holds **no logic of its own** — the README's "Module ownership" section is explicit that `policy.mjs` "only reads the event file, dispatches commands, and reports command failures". The same command name works under every workflow, so the workflow YAML never embeds logic.
- **Edge cases & failure handling:** unknown command → usage error. `import.meta.url === pathToFileURL(process.argv[1]).href` guard makes it import-safe.
- **Surprising:** errors are printed in Chinese, matching the whole policy module's message language.

### `.github/review-ownership/check-approval.mjs`
- **Purpose:** Computes a *weighted* approval score for a pull request and publishes it as a commit status, so a branch rule can require "2 approval points" instead of "1 approval".
- **Key abstractions:** `parseApprovalPolicy(source)`, `effectiveReviewDecisions(reviews)`, `createGitHubApi({token, apiUrl, fetchImpl})`, `listPullRequestReviews(api, repository, pullNumber)`, `evaluateApproval({event, policySource, api, getOwnership, getMergedCount})`, `runApprovalCheck({...})`, `publishApprovalPhase({...})`, `approvalEventFromWorkflowRun`, `approvalEventFromComment`, `approvalEventFromPullRequest`.
- **Data flow:** PR event → policy JSON → reviews + comments (paginated) → per-reviewer collaborator permission → optional `git blame` ownership → optional merged-PR history → points → `POST /statuses/<sha>`.
- **Non-obvious design decisions:**
  - **Only `write`/`admin` reviewers count**, resolved live per reviewer (`reviewerPermission`), and a 404 (former collaborator) silently means "no points" rather than an error (`check-approval.mjs:495`).
  - **Author credit is a bounded, separate currency**: `min(100, mergedPRs) × 11/1000` — max 1.1 points, and it "cannot approve alone" because the author's own review is excluded from `approvals` (`check-approval.mjs:283-289`). A long-time contributor nudges a PR over the line but is never an approver.
  - **Ownership weighting uses *old production lines* only**: a 1-point approval is scaled to `min(2, 1 + 4 × ownedLines/totalLines)`. New lines never enter the denominator, and an empty denominator gives no boost (`check-approval.mjs:296-311`). The reviewer who wrote the code being changed gets the credit.
  - **Cost is deferred until it can matter.** `getOwnership` is only called when `reviewerPoints + authorCredit < required` AND at least one approval carries the default weight; `getMergedCount` is only called when `reviewerPoints < required` and no blocker exists. Tests assert these calls are *not* made (`"does not fetch ownership when a change request blocks approval"`, `"does not fetch history when approvals already have two-point weights"`).
  - **A blocker beats the threshold.** A write-capable reviewer's effective `CHANGES_REQUESTED` keeps the status `pending` even when points reach 2 (`check-approval.mjs:317`).
  - **Float tolerance instead of rounding**: `points + 1e-12 >= requiredPoints`, and the *display* is rounded to 3 decimals while the decision uses the unrounded value — pinned by the test "a score just below the threshold remains pending even if its display rounds to two".
  - **Status is revoked before expensive work**: `publishApprovalPhase(phase='pending')` writes a pending status *before* Python setup / lexer install, so a failed setup cannot leave a stale `success` on the head. The README calls this out ("The publisher marks the head pending before Python setup").
  - **Failure publishes `error`, not silence.** A thrown evaluation writes `state: 'error'` then rethrows (`check-approval.mjs:352-356`).
- **Edge cases & failure handling:** reviews and comments are paginated with a hard 3,000-record ceiling that throws rather than scoring a partial history. `publishStatus` rejects a non-HTTPS run URL and a description over 140 chars. `pullRequestFromEvent` validates the login shape, the author node id, and the 40-hex head SHA before any API call.
- **Surprising:** the **delegation** machinery — a `/delegate @user` comment transfers the sender's points to the recipient's approval. It is implemented with the comment *editor* as an authorisation check (only the original author may edit a command into effect), dismissal of the sender's prior reviews via the GitHub dismissals API, and an explicit *conservation* rule: delegated points are not forwarded a second hop.

### `.github/review-ownership/author-weight.mjs`
- **Purpose:** Counts an author's merged PRs to award the bounded author-credit points.
- **Key abstractions:** `authorCreditPoints(mergedCount)`, `countMergedAuthorPulls(pull, api)`.
- **Data flow:** GraphQL paginated `pullRequests(states: MERGED)` → dedupe by PR number → count entries whose `author.id` equals the PR author's immutable `node_id`.
- **Non-obvious design decisions:**
  - **Identity is the immutable account id, not the login** — `pull.authorId` is the REST `node_id`; a renamed account keeps its credit, and a deleted account (`author: null`) is excluded but still counted in the scan.
  - **The credit cap short-circuits the scan**: `if (count === CAP_COUNT) return count` (`author-weight.mjs:42`) — the repo stops reading history at 100 matches.
  - **Incomplete history is an error, never a smaller number**: an invalid response shape throws "GitHub merged PR history is incomplete"; a repeated cursor throws "cursor did not advance" (loop protection).
- **Edge cases & failure handling:** the current PR is excluded by number. Deduplication by PR number handles overlapping pages.
- **Surprising:** the function counts *merged* PRs only, and the credit formula (`× 11/1000`) is deliberately small — it can never satisfy the two-point requirement alone.

### `.github/review-ownership/blame-ownership.mjs`
- **Purpose:** Measures how much of the changed *old production* code each reviewer wrote, using merge-base `git blame`.
- **Key abstractions:** `LOGIN` (exported), `resolveBlameAuthors(measurement, repository, api)`, `productionOwnership(pull, api)`.
- **Data flow:** `git fetch` of base-ref + head-sha into the runner → `blame-production.py <baseSha> <headSha>` → JSON `{mergeBase, files, totalLines, commitLines}` → GraphQL `object(oid:)` batch lookups (50 per query) → case-folded `reviewerLines`.
- **Non-obvious design decisions:**
  - **PR blobs are data, never programs** (the module's own header comment). The PR head is fetched as a Git object and measured by a *trusted* script; nothing from the PR is checked out or executed.
  - **The denominator never shrinks.** Unlinked commit authors (`author.user === null`) are *kept in the denominator* but contribute no points (`blame-ownership.mjs:47-49`). A reviewer therefore cannot gain by erasing attribution.
  - **The PR may not have moved under us**: `current.head?.sha !== pull.headSha` → throw "pull request changed or has no valid base branch".
  - **Shallow clones are repaired, not trusted**: the script detects `--is-shallow-repository` and adds `--unshallow`.
  - **Credentials live only in the Git child environment** — the `AUTHORIZATION` header is injected via `GIT_CONFIG_KEY_0`, never as an argument.
- **Edge cases & failure handling:** batched GraphQL in groups of 50; a failed or partial author lookup throws rather than lowering the denominator. Invalid measurement input throws before any network call.
- **Surprising:** `productionOwnership` shells out to `python3` — the whole ownership feature depends on a Python runtime in the CI job, and the README says the failure mode is an *error status*, not a degraded score.

### `.github/review-ownership/blame-production.py`
- **Purpose:** A trusted classifier that decides which changed lines count as "production" and attributes them to the commits that last touched them.
- **Key abstractions:** `production_path(path)`, `code_lines(path, source)`, `changed_files(repo, base, head)`, `measure(repo, base, head)`.
- **Data flow:** `git diff --raw -z --find-renames` → old blob → Pygments lex → eligible physical lines → `git diff --unified=0` hunk ranges → intersect → one `git blame --line-porcelain` per file → commit→line counts.
- **Non-obvious design decisions:**
  - **Only physical lines containing code count.** Pygments' lexer distinguishes comments, docstrings, and blank lines from code; a mixed code+comment line counts, and C preprocessor directives count (`blame-production.py:60-68`).
  - **Generated files are excluded by their header**, matched against `/auto-generated|automatically generated|generated by|do not edit/i` — if the file's *first* token is such a comment, the file contributes zero lines (`blame-production.py:57-61`).
  - **The classification uses the OLD path and the OLD content**, so renaming a file or adding a generated header in the PR cannot shrink the denominator.
  - **`git` is invoked with `--no-replace-objects`, `--no-ext-diff`, `--no-textconv`** — the diff is computed by Git's own plumbing, never by an external diff driver (a classic RCE vector on untrusted PRs).
  - **Incomplete blame is an error**: `if attributed != len(changed): raise ValueError('incomplete blame for …')`.
  - **Shallow history is refused outright**: `if git rev-parse --is-shallow-repository != b'false': raise ValueError('blame requires complete history')`.
- **Edge cases & failure handling:** a deleted file counts all its old eligible lines; a pure rename has no changed lines; `maxBuffer` is 16 MB on the Node side.
- **Surprising:** the `EXCLUDED` frozenset contains `support`, `examples`, `docs`, `snapshot`, `snapshots` — *directory-name* exclusion, so a production directory called `support` is silently excluded from ownership.

### `.github/issue-management/policy.test.mjs` (42 KB)
- **Purpose:** The keyless, offline test suite for the whole issue-policy engine — and, unusually, a **meta-test suite**: it pins the shape of the repository's own issue templates and pull-request template.
- **What it pins:** (a) the ISSUE_TEMPLATE directory contains exactly `bug.md`, `config.yml`, `feature.md`, `task.md`, each with exactly the frontmatter keys `about`, `name`, `type`, a `## ` heading, an HTML comment hint and **no `<details>`**; (b) `feature.md` has exactly `## Motivation` + `## Behavior`; (c) `bug.md` has exactly five fixed headings; (d) `task.md` has exactly two; (e) the PR template has exactly `## Motivation`, `## Changes`, `## Testing`, **no `###`**, and exactly one `<details>`/`<summary>Proof</summary>` pair; (f) the label taxonomy, the priority-inheritance rule, the "PR number is not an Issue reference" rule, the exempt-PR request counts, the Project field validation failures, the date conversion, and — by reading `../workflows/issue-policy.yml` as text — the *shape of the workflow itself* (4 steps, `ref: default_branch`, `persist-credentials: false`, no `pull_request_target`, the selective-preflight marker file, the `needs-project` gate).
- **Surprising / stealable:** the suite **asserts against the workflow YAML as a string**. It slices the job out of `issue-policy.yml` and checks that the preflight step contains no `secrets.`, no `PROJECT_TOKEN` and no `if:`, and that the check step is gated on `needs-project == 'true'`. A workflow that quietly mints a privileged token before eligibility is decided fails the test. It also **executes the workflow's inline bash rollout script** in a temp dir with a synthetic `GITHUB_EVENT_PATH`/`GITHUB_OUTPUT` (skipped on Windows) — the rollout selector is tested as a program, not as prose.
- **Non-obvious:** the test keeps an **independent oracle** for the legacy-label set (`policy.test.mjs`, "Keep an independent oracle rather than importing the implementation's reserved set") so a change to the implementation's set cannot silently change the test's expectation.

### `.github/review-ownership/check-approval.test.mjs` (53 KB)
- **Purpose:** Pins the whole weighted-approval engine: policy parsing, effective review decisions, delegation semantics, ownership weighting, status publication and failure modes.
- **What it pins:** policy validation errors; review-state precedence (`DISMISSED` clears, `COMMENTED`/`PENDING` do not); a 10-case table of `ownedLines/totalLines → points` (`[9,100]→1.36`, `[25,100]→2` capped, `[0,0]→1` no boost); that ownership/history are **not fetched** when they cannot change the verdict; that a blocker keeps the status pending; that author credit is capped at 1.1 and cannot approve alone; that drafts are pending without any API call; the `pending → error` status sequence on evaluation failure; the delegation conservation rules (one hop only, cycles produce no approvals, repeated commands do not multiply points, the recipient's dismissal revokes the points but keeps the delegation active, the sender's own later review reclaims the points, comment edits by a non-author are ignored, deleting the newest command restores an older one, a command must occupy the *entire* comment body); the `PUT .../dismissals` round-trip with a confirmation check; the idempotent review-request behaviour; the 3,000-record history ceiling; and that the reviewer list is sorted with `localeCompare(…, 'en')` for stable output.
- **Surprising:** the suite covers the **"edited command" authorisation** by asserting the GraphQL editor id equals the comment author's id — a command edited by anyone else is inert.

### `.github/review-ownership/author-weight.test.mjs`
- **Purpose:** Pins the merged-PR counting oracle.
- **What it pins:** only the same account counts; the current PR is excluded; deleted accounts (`author: null`) are excluded; overlapping pages are de-duplicated; the scan stops at exactly 100; an empty history returns 0; five malformed responses (`{}`, `errors:[…]`, `page([null])`, `page([{number:1}])`, `page([], true, null)`) all reject; a repeated cursor rejects rather than looping.

### `.github/review-ownership/blame-ownership.test.mjs`
- **Purpose:** Pins the blame-author resolution.
- **What it pins:** commit SHAs are combined per author and logins are **case-folded** (`Writer` + `writer` → `writer`); an unlinked author (`user: null`) stays in the denominator but adds no reviewer lines; lookups batch in groups of 50 (51 SHAs → 2 calls) and zero-line changes never query; invalid counts reject *before* any network call; a failed or partial lookup rejects rather than lowering the denominator.

### `.github/review-ownership/test_blame_production.py`
- **Purpose:** Python-level tests for the production-line classifier against real Git histories.
- **What it pins:** (read in batch below) — real repositories, renames, shallow-history rejection, generated headers, comment/blank-line exclusion.

### Tier 2 — bulk: a compact table, one row per file

| File | What it is / what it pins |
| --- | --- |
| `.github/AGENTS.md` | The rules of the CI layer: PR-only `ci.yml`, master-only `ci-master.yml`, Windows runners on native `pwsh`, Wine only on hosted Linux, self-hosted/blacksmith failover labels, and that the Desktop publish workflow must route each retained build back to *its original machine's* unique label. |
| `.github/ISSUE_TEMPLATE/bug.md` | Bug template: exactly five sections (Summary / Reproduction / Current behavior / Expected behavior / Environment), each a Chinese HTML-comment prompt. |
| `.github/ISSUE_TEMPLATE/config.yml` | `blank_issues_enabled: false` — no blank Issues; pinned byte-for-byte by the policy test. |
| `.github/ISSUE_TEMPLATE/feature.md` | Feature template: only Motivation + Behavior (deliberately no implementation plan). |
| `.github/ISSUE_TEMPLATE/task.md` | Task template: Summary + Deliverables. |
| `.github/dependabot.yml` | Three ecosystems (npm root, uv in `/python/sdk`, github-actions) on a `0 4 * * *` Asia/Shanghai cron with a 30-day cooldown and `kind/dependency` + `area/infra` labels; `vendor/**` is excluded because vendored Cordis follows its own README. |
| `.github/issue-management/README.md` | The **decision document** for the issue engine: context references vs resolving references, two tokens, event-driven (not reconciling) lifecycle, Project-custom `Priority` field, "no field migration or Priority synchronization". |
| `.github/issue-management/README.zh.md` | The Chinese mirror of the same decisions (bilingual pairs are hash-checked by `README.i18n.yaml`). |
| `.github/issue-management/config.json` | The single config: org/repo, project number + title, `lifecycleActor`, `priorityField`, `startDateField`, `projectTimeZone`, and the seven statuses `Inbox → Backlog → Ready → In progress → In review → Done / No action`. |
| `.github/issue-management/selective-preflight.json` | `{"version": 1}` — the *capability marker* that flips the workflow from legacy behaviour to selective preflight. Its presence is the whole rollout switch. |
| `.github/issue-management/README.i18n.yaml` | Generated bilingual-pairing hashes per heading section (16 pairs). Not read line by line (generated record). |
| `.github/preview-sizing/README.md` | **Decides** how a CI-runner-sizing experiment must be run to be worth anything: hold SHA/lockfile/Node/pnpm/build commands constant, measure *complete job cost* (not price per minute), include setup + cache restore + cleanup + failure overhead, and report GNU-time max RSS as a *process* maximum rather than tree aggregate. |
| `.github/preview-sizing/README.zh.md` | Chinese mirror of the same sizing protocol. |
| `.github/preview-sizing/README.i18n.yaml` | Generated bilingual-pairing hashes (6 pairs). |
| `.github/pull_request_template.md` | The PR contract: Motivation (one sentence, must cite `Fixes #NN` / `Related #NN`), Changes (observable behaviour), Testing (one bullet per method, each with a `<details><summary>Proof</summary>` block for reproducible evidence). Pinned by the policy test: exactly one `<details>`, no `###`. |
| `.github/review-ownership/README.md` | **The decision document for reviewer weighting**: two-point vs one-point reviewers, author credit formula and its cap, the ownership curve, the definition of "production source", the delegation protocol, and a Security section that states every action is SHA-pinned, the job checks out only the default branch, no PR code is executed, and "Approval policy changes take effect only after they merge into the default branch." |
| `.github/review-ownership/approval-policy.json` | `requiredPoints: 2`, `defaultPoints: 1`, and six named reviewers at 2 points. Parse errors are hard failures. |
| `.github/review-ownership/.gitignore` | `__pycache__/`. |
| `.github/review-ownership/requirements.txt` | `Pygments==2.21.0` — the single pinned dependency of the blame classifier. |

### `.github/workflows/*.yml` — 25 workflows (all read; one row each)

| File | What it is / what it pins |
| --- | --- |
| `.github/workflows/ci.yml` | The PR-only verdict (36 KB, 9 jobs). A single stable required check `all checks passed` aggregates `needs: [node-24, node-24-coverage, node-24-bench, node-24-consumers, node-compat, python-sdk, python-runtime, windows-build, windows-native-tests]` — so branch protection requires one stable name while the matrix legs churn. Fail-fast: `DSH_GATE_FAIL_FAST=1` aborts sibling gates on the first blocking failure so a red run stops burning enterprise runner minutes. Two repo *variables* (`DSH_CI_FAILOVER_LINUX` / `_WINDOWS`) retarget every Linux/Windows job between hosted, Blacksmith, and the in-house pool with **no merge required**. Coverage partitions are weighted by *measured* durations cached in `.coverage-times.json` (immutable per-run cache keys + a stable restore prefix). `node-compat` pins Node `22.19`, `24.9` (the last v1-loader 24.x) and `26` — a bare `24` would have retested the same v2 loader. |
| `.github/workflows/ci-master.yml` | Master-only lanes (21 KB): the Wine Windows gate, the **self-hosted hot-standby drills** (`serial-linux-selfhosted`, `serial-windows` — every master push re-proves the failover pool can take over a required lane), and two manual runner-sizing benchmarks (`larger-runner-benchmark`, `consolidated-runner-benchmark`) that sweep 4→96 cores on both platforms. The `serial-macos` job is disabled with a TODO explaining why. |
| `.github/workflows/issue-policy.yml` | The PR policy gate. Four steps: trusted checkout → **eligibility preflight** → *conditional* Project App token → full validation. The preflight is credential-free (`GITHUB_TOKEN` only, no `secrets.`); the Project token is minted **only** when `needs-project == 'true'`. A legacy inline-node fallback preserves the old behaviour when `selective-preflight.json` is absent. The comment "Re-read current state even after an exempt preflight; never replace a failure with an edit skip" is the policy's core rule. |
| `.github/workflows/issue-lifecycle.yml` | The Project mutation lane. A job-level `if:` allocates a runner **only** for `changes_requested` reviews or PR *body* edits (title edits excluded). A single concurrency group per Issue/PR with `cancel-in-progress: false` — lifecycle mutations are never cancelled mid-way. |
| `.github/workflows/weighted-approval.yml` | The approval-score publisher. Uses `pull_request_target` (safe *because* it only ever checks out the default branch and reads PR data as API data — the check-approval.mjs header says exactly this). `concurrency` is **per PR** with `cancel-in-progress: false` so a delegation dismissal is never interrupted. The revocation step (`check-approval.mjs pending`) runs **before** the Python setup step, so a failed setup cannot leave a stale success. A separate `failure()` step publishes `error`. |
| `.github/workflows/weighted-approval-review-event.yml` | A 2-minute, `permissions: {}` no-token workflow whose only job echoes a line; its *run title* (`weighted-approval-review-event:<PR number>`) is the payload the publisher parses. This is the standard trick for giving a `workflow_run` trigger a trusted, credential-free relay. |
| `.github/workflows/build-exe-for-python-sdk.yml` | The 23 KB native build matrix. A `plan` job converts a comma-separated `targets` input into a matrix (rejecting unknown targets with a clear error) because job-level `if:` cannot inspect a matrix. It rebuilds `node-pty` against manylinux 2.28 in a container and **verifies the binary's actual GLIBC ceiling** with `readelf` + `dpkg --compare-versions` rather than trusting the wheel tag. Installed-wheel black-box tests run in a clean venv with `PYTHONPATH` and `DSH_RUNTIME_MODE` **unset** (`env -u`), so the test cannot accidentally use the source tree. |
| `.github/workflows/python-release.yml` | Manual publication with a `publish` boolean. A four-part authorization gate before anything is published: publisher repository must match, `PUBLIC_PYPI_RELEASE_ENABLED` must be true, the ref must be the matching `python-v<version>` tag, and the publisher identity must be configured. It then diffs the **exact expected wheel set** against what is on disk and enforces PyPI's 100 MB limit per file. `attestations: false` because "Public attestations reveal the private publisher repository." The SDK publish is a **dependent job** so a failed SDK upload can be retried without touching the immutable runtime files. |
| `.github/workflows/release.yml` | Credential-free pack rehearsal on every PR/master push: dependency-layout verification, `release:verify --family dsh`, pack the dsh family **and** the vendored family **and** the Landlock entry, then `release:verify-packed-install` against all three — so a peer-dependency bump cannot land before the peer exists. |
| `.github/workflows/release-publish.yml` | Manual-only npm publication. The `publish` job has **no build step**: it downloads the tarballs the `pack` job produced and publishes those bytes. `pnpm install --ignore-scripts` in the publish job. Concurrency group `Release-publish`, `cancel-in-progress: false`. |
| `.github/workflows/release-vendor.yml` | The pack rehearsal for the vendored Cordis family (nine rescoped packages, each on its own version line) — credential-free, on every PR and master push, packing to `dist/npm-vendor` and verifying the packed install. |
| `.github/workflows/release-vendor-publish.yml` | The manual-only publish for the same family: `release:verify --family vendor`, a separate build (the vendored packages publish their own sources), a `npm-publish` environment, `--ignore-scripts` on install, and the pack-then-publish split. |
| `.github/workflows/build-preview-cloudflare.yml` | PR preview to Cloudflare Pages under a per-PR branch alias. Three things worth stealing: (a) sourcemaps are deleted before upload ("Sourcemaps carry complete sources and stay off the deployment platform"); (b) the protected-image check asserts HTTP 200 **and** no `content-encoding` **and** the gzip magic bytes `1f 8b` — three distinct failure meanings, documented inline; (c) the URL comment is **idempotent** via an HTML marker (`<!-- dsh-preview-url -->`), because a PR opened before the workflow existed never sees an `opened` event. |
| `.github/workflows/docs-pages.yml` | Manual-only Pages deployment, deliberately **not** a PR check. The comment block states the reasoning: "the site presents a released snapshot, so publication is an explicit act from a dsh-v* tag and must never appear as a PR check." `release:verify` rejects every other ref. |
| `.github/workflows/e2e.yml` | Real-API E2E with the fork/secret model spelled out at length: `pull_request` (never `pull_request_target`), the Dependabot test keyed on `pull_request.user.login` (not `github.actor`), and a **key preflight** that hard-fails when the secret is missing — because "the e2e suite would self-skip and report a false green". Nightly cron at `17 0 * * *` — "off the top-of-hour cron stampede". |
| `.github/workflows/pi-ai-provider-e2e.yml` | The same anti-false-green preflight for two external providers, with **no** automatic trigger at all (opt-in manual only, because it spends tokens). |
| `.github/workflows/sandbox.yml` | The real-kernel confinement proofs. Each OS×runner leg asserts **both** platform files actually ran (`Test Files  2 passed (2)`) — "a self-skip (runner missing on the very platform that exists to prove it) is a failure, not a pass". The Landlock leg additionally does a pack→install→confine rehearsal from the *packed* tarballs. A separate `unit-darwin` job exists because Seatbelt path canonicalisation (`/tmp` IS `/private/tmp`) is darwin-only. |
| `.github/workflows/node-addon-system.yml` | Per-platform native CI: build once on the platform of record, then run the *same bytes* under Node 20, 22, 24 and 26, including inside `node:XX-alpine` (no compiler) containers to prove the musl addon ships without a toolchain. `NALR_REQUIRE_LANDLOCK=1` turns a self-skip into a failure. |
| `.github/workflows/node-addon-system-release.yml` | The publish path for the native packages. The publish step says: "Publication is decided per package against the registry, so re-running this job over the same artifact skips what already landed instead of failing on it" — because npm permanently rejects a repeat of an existing version. |
| `.github/workflows/build-exe-for-ssh-helper.yml` | Native helper archives with **three** independent verifications per target: relocated executable + confinement, the packaged Landlock backend, and OpenSSH working on glibc 2.28 *without* Node. The target list is validated in a Node one-liner that rejects duplicates. |
| `.github/workflows/publish-ssh-helper.yml` | Publication requires the matching `dsh-v<version>` tag; the verify step requires the checksums to come from the *selected source commit*. |
| `.github/workflows/desktop-publish.yml` | The most interesting publishing workflow. It routes a retained package back to **the original machine's unique runner label** (`DESKTOP_PUBLISH_RUNNERS`), has a three-job shape (route → prepare → publish), uses **two separate approval environments** (`desktop-test` / `desktop-production`), and **retains a publication audit artifact for 30 days**. The `prepare` job verifies the package locally *without upload credentials* before the credentialed job runs. |
| `.github/workflows/windows-package.yml` / `macos-package.yml` | The desktop packaging workflows. Both carry a long inline validation that: production must be `master` or a `dsh-v*` tag; the checkout must *match* the tag's commit; a branch ref must be a branch (not a SHA or PR ref); and the source must contain `PACKAGE_VERSION_MODE` support ("select a newer release"). Both distinguish `signed`/`unsigned` and `skip_notarization` for internal debugging only. The Windows job resets the checkout directory *first* and refuses a checkout whose ancestors are reparse points. |
| `.github/workflows/expected-filenames.yml` | A tiny gate that fires only when a path matching `*golden*` changes, and runs `scripts/check-expected-filenames.sh` — a prohibition on golden/snapshot *filenames*. |
| `.github/workflows/windows-package.yml` (see above) | — |
| `.github/workflows/macos-package.yml` (see above) | — |

---

### Tier 1 (continued) — `benchmarks/`: the self-measurement harness

#### `benchmarks/AGENTS.md` — the rules of the performance tree
- **Purpose:** The contract every benchmark file in this tree obeys.
- **Key decisions it records (and these are the stealable ones):**
  - "Organize benchmarks by **measured user path**, one directory per path. Do not mirror the package tree."
  - "**Synthesize fixed inputs from reviewed constants. Never use recorded Sessions, user material, ambient repositories, or network services.**" — the fixture must be reproducible and must not leak or depend on a real user.
  - "Run process-level wall-clock and retained-memory samples in **fresh children with private `mkdtemp` roots**. … **Bound every child, await exit, and remove owned roots after failure as well as success.**"
  - "**Pass every budgeted wall-clock endpoint to `recordTimings` … before asserting it**, with a `BenchmarkCase` stating what it measures and which user scenario it affects."
  - "Record reference-machine expectations **separately** from the shared CI time scale and variance headroom. **Do not apply the time scale to memory or dimensionless ratios.**"
  - "**environment variables must not override performance budgets**" — a budget is a reviewed constant, not a knob.
  - "**Exercise production entry points. Do not copy product algorithms, add production exports solely for measurement**, or turn benchmark completion into duplicate semantic assertions."
  - "Keep scenario-specific support beside its benchmark. Move a helper into `benchmarks/support/` only after **at least two benchmark directories** require the same behavior."
  - `pnpm run test:bench:memory 4g|8g` reruns the listed files inside a swapless cgroup capped at 4 or 8 GiB **with unchanged budgets**.
- **Surprising:** "two animation frames prove a rendering opportunity, **not hardware presentation**" — the browser benchmarks deliberately do not claim GPU-present timing.

#### `benchmarks/support/calibration.ts` — one conversion from a reference machine to a CI budget
- **Purpose:** The single place a reference-machine duration becomes a CI budget.
- **Key abstractions:** `CI_TIME_SCALE = 2`, `PERFORMANCE_BUDGET_HEADROOM = 1.25`, `ciTimeBudget(expectedMs) = ceil(expectedMs × 2 × 1.25)`.
- **Non-obvious:** the scale and the headroom are **separate constants** so a reviewer can change one without silently re-tuning the other. Memory and ratios are deliberately outside this conversion.

#### `benchmarks/support/machine-profiles.ts` — the reviewed machine table
- **Purpose:** 17 reviewed machine profiles (2015 laptops → AWS/GCP/Azure/Alibaba → GitHub runners → an M4 Pro calibration reference), each with a PassMark single-thread score, a core count and a storage latency.
- **Key abstractions:** `MachineProfile`, `MACHINE_PROFILES`, `matchMachineProfile(cpuModel)`.
- **Non-obvious:** the header says plainly what the numbers are **not**: "PassMark ratings across ISAs, for burstable or shared vCPUs, and for hybrid efficiency cores, are **coarse**"; "memory size is **not modelled**". `cpuModelMatches` is a list of *substrings*, so an unknown CPU model falls back to a human choice in the report rather than a wrong automatic one.
- **Why it transfers:** August Trading could use the same shape to say "this budget was measured on a 2015 laptop, here is what it means on your cloud box".

#### `benchmarks/support/scaling-report.ts` — the JSONL report
- **Purpose:** Collects every budgeted endpoint into `benchmarks/.dsh-report/results.jsonl` and renders a **self-contained interactive HTML report** with no external resources.
- **Key abstractions:** `recordTimings(benchmarkCase, timings, budgetsMs)`, `recordPeakMemory(benchmarkCase, peaksMb)`, `setup()` (global setup — clears the report dir), `teardown()` (global teardown — renders even after a failing case), `renderReport(data)`, `BenchmarkCase {id, measures, affects}`, `Timing = {ms, cpuMs} | {ms, ioShare}`.
- **Non-obvious design decisions:**
  - **The scaling formula is documented in the file's own header**: `ms × ((1 − io) × cpuScore(measured)/cpuScore(target) × coreFactor + io × ioLatency(target)/ioLatency(measured))`, with `coreFactor = max(1, parallelism/target.cores) / max(1, parallelism/measured.cores)`. When the worker reports process CPU time, `io` is *measured* (`max(0, 1 − cpuMs/ms)`) and parallelism is *derived* (`max(1, cpuMs/ms)`); otherwise `io` is a **declared estimate** and the reader can override it per endpoint in the UI.
  - **Memory and dimensionless ratios are not scaled** — stated in three places (header, HTML note, table).
  - **Every record carries three human fields** (`benchmark`, `measures`, `affects`) so the table can explain *what* a number is, not just its value.
  - **The reader can override the storage-bound share** and the report says whether the default was "measured" or "declared" — the uncertainty is *shown*, not hidden.
- **Surprising:** the report is generated from a **JSONL file** (append-only, one record per line) and the HTML is written by a template literal — no build step, no dependency.

#### `benchmarks/support/built-worker.ts` — the isolation contract
- **Purpose:** Launches a **compiled** benchmark worker as a fresh plain-Node child.
- **Key abstractions:** `runBuiltBenchmarkWorker<Report>(options)`, `assertBuiltBenchmarkRuntime(moduleUrl, packageEntries)`, `BuiltBenchmarkWorkerRun {report, exitCode, signal, timedOut, stderr}`.
- **Non-obvious:**
  - **`assertBuiltBenchmarkRuntime` is a hard guard**: the worker must live under `benchmarks/.dsh-build/`, must NOT have a TypeScript loader in `process.execArgv`, and every measured package must resolve to `lib/*.js`. A benchmark that accidentally ran against source or through `tsx` fails loudly rather than measuring the wrong thing.
  - **`NODE_OPTIONS` and `TSX_TSCONFIG_PATH` are deleted from the child env** (`built-worker.ts:38-39`) — an inherited loader would invalidate the measurement.
  - The child may be launched with `--expose-gc`, `--max-old-space-size`, and a **fixed `--min-semi-space-size`/`--max-semi-space-size`** so "an allocation interval smaller than it runs without a scavenge".
  - **A timeout is a `SIGKILL` and is reported as `timedOut`, distinct from `signal` and `exitCode`** — the three are never conflated.
  - The report is the **last JSON line** of stdout (`findLast(candidate => candidate.startsWith('{'))`).

#### `benchmarks/agent-continuation/agent-continuation.bench.ts` — the calibration-by-construction pattern
- **Purpose:** Budgets for long-history requests, tool continuation and fork-child discovery.
- **Key abstractions:** four `BenchmarkCase`s (`request-history`, `tool-continuation`, `catalog`, `profile-continuation`); budgets `REQUEST_HISTORY_BUDGET_MS = 297`, `TOOL_CONTINUATION_BUDGET_MS = 1125`, `CATALOG_BUDGET_MS = 1125`, `BASELINE_REQUEST_BUDGET_MS = 750`.
- **Non-obvious:** **the recorded samples are asserted in the test itself.** Four `describe('… calibration')` blocks pin the exact median of the recorded hosted samples (e.g. `expect(recordedMedian).toBe(858.363927)`), assert that the *historical* budget would have failed (`expect(() => expectTotalWithinBudget(recordedMedian, 800)).toThrow()`), and assert the *current* budget passes. The budget is therefore a **reviewed constant with its own regression test** — a reviewer can see exactly why it is what it is, and a future change to the number breaks a test.
- **Stealable:** the same shape — "the recorded samples, the old budget that failed them, the new budget that passes them, and a synthetic regression that must still fail" — turns a magic number into a documented decision.

#### `benchmarks/agent-continuation/agent-continuation.worker.ts`
- **Purpose:** Plain-Node measurement of an active request history and a cold tool-heavy continuation, using the **real** `AgentLoop`, `JsonlSessionPersistence` (zstd) and tool pipeline, with a synthetic `LlmAdapter`.
- **Key abstractions:** `ContinuationReport {totalMs, resumeMs, turnsMs, flushMs, cpuUserMs, cpuSystemMs, retainedHeapMb, peakRssMb, requests, toolCalls, events}`; `SyntheticAdapter extends LlmAdapter`.
- **Non-obvious:**
  - **The worker counts its own work**: after the run it asserts `adapter.requests === requestTurns` and `toolCalls === expected`, i.e. "the benchmark did not complete every requested model/tool step" throws. A benchmark that silently did half the work cannot report a good number.
  - **The measured endpoint is retained** across the GC sample (`this.retained` in the session-open worker; here `beforeHeap`/`afterHeap` around the run) so the memory number is the memory of the *live* endpoint, not of an empty process.
  - `collectHeap()` does `gc(); await scheduler.yield(); gc()` — **two GCs with a yield between them**, because a single GC can leave the young generation uncollected.
  - **CPU time is measured with `process.cpuUsage()` over the same interval** as the wall clock, which is what lets the report compute the storage-vs-CPU split.

#### `benchmarks/agent-continuation/workload.ts`
- **Purpose:** The single source of the synthetic dimensions (`WORKLOAD`: 800 history turns, 4 tools per historical turn, 2,048-char results, 40 request turns, 20 continuation turns, 100 profile turns, 8 tools per live turn, 16 children × 80 turns).
- **Non-obvious:** the history is authored **through the production `Session.append` API and the production `AssistantStreamAccumulator`**, then re-timestamped, so the fixture is what the runtime actually writes. It also **reserves an empty system head in the first step** so a resumed prompt can *replace* that head without moving historical messages — a subtle session-surface invariant, pinned by `synthetic-history.bench.ts`.

#### `benchmarks/agent-continuation/child-catalog.worker.ts`
- **Purpose:** Measures discovering 16 inactive fork children with 80-turn inherited histories.
- **Non-obvious:** it subclasses `SessionQueryEngine` and **makes `searchSessions`/`searchEvents` reject** — the benchmark refuses to silently measure the wrong path. The `subagent/catalog` event carries `mode: 'continuable'`, and the parent is seeded with only catalog rows while each child carries the inherited history plus a `session/end-seed` marker, so the *catalog* read must not deserialise every child.

#### `benchmarks/agent-continuation/profile-continuation.worker.ts` + `profile-adapter.ts`
- **Purpose:** End-to-end continuation through the **shipped `sdk-minimal` profile** — a real `dsh` subprocess with a profile patch that disables the real provider and mounts a synthetic model, the file-system plugin and the string-replace editor.
- **Non-obvious:** the patch is written as a **YAML patch file** and passed to `DeepSeekHarness({patches: [patch]})`; the environment is a **private `HOME`/`USERPROFILE`** and `DSH_AGENTS_HOME`; the run is bounded by a 40 s deadline whose expiry *requests* cancellation while the awaited `close()` in `finally` still reports shutdown failures.
- **Stealable:** this is the closest thing here to a headless-SDK soak test: 100 turns × 8 real file reads through the shipped profile, with the assertion "the profile benchmark did not read the synthetic file" checking *content*, not just counts.

#### `benchmarks/session-open/session-open.bench.ts`
- **Purpose:** Budgets for cold Session preparation, first history and Agent resume, over a **127,400-event** synthetic Session (200 turns × 500 text + 125 reasoning deltas).
- **Non-obvious:**
  - **Two access kinds are benchmarked separately**: `first-open` (from a released V0 generation, which must *migrate*) and `post-upgrade-reopen` (the V0 file plus the current generation side by side). The reopen budget is 63 ms; the migration budget is 550 ms — **the upgrade path is priced separately from the steady-state path.**
  - **The migration is proved non-destructive**: the test reads the original V0 file before and after and asserts `await readFile(facts.path)` is byte-identical, and that the directory contains *both* generations after the upgrade.
  - **A constrained-heap variant runs the same workload under `--max-old-space-size=128`** — the budget does not change, but the run must *complete*.
  - The worker-failure path keeps the **exception headline and a bounded stderr tail**: the test asserts the headline and the last line survive but a middle stack frame does not ("`expect(() => requireReport(run, 'agent-resume')).not.toThrow('stack frame 15')`").
  - `FIRST_OPEN_AGENT_RESUME_BUDGET_MS = 562` is derived from `floor(450 × 1.25)` — the comment records the derivation.

#### `benchmarks/session-open/session-open.worker.ts`
- **Purpose:** The isolated worker for four scenarios: `phase-migrate`, `phase-steady`, `first-history`, `agent-resume`.
- **Key abstractions:** `SessionBenchmarkHost` (owns the Host, the measured endpoint and its disposal), `SessionOpenWorkerReport` with a `phases` breakdown (`openMs`, `readMs`, `sessionRestoreMs`, `projectionMs`) and a memory delta (`heapUsedMb`, `externalMb`, `arrayBuffersMb`, `rssMb`).
- **Non-obvious:** the measured phases are exactly the four the user feels — **file open, read, Session restore, projection** — and each is timed separately so a regression can be attributed. `interruptedTurnClosers(read.events)` is applied before the restore, so an interrupted turn is closed *before* the projection is built. The scenario's "retained endpoint" is held in `this.retained` and the worker throws if it is `undefined` — "the scenario did not retain its measured endpoint".

#### `benchmarks/session-open/synthetic-released-v0-session.ts` + `session-open.constants.ts`
- **Purpose:** Writes a **released-v0 Zstandard** Session log byte-for-byte in the historical layout (one body frame per row) so the "first open" path measures a *real* legacy file, not a re-serialised one.
- **Non-obvious:** it imports the production `compressZstdFrame` and `generationLogFilename`, and it emits the `system/message` head exactly where the old format put it. `ROWS_PER_FRAME = 1` is a named constant with the comment "One body frame per row preserves the historical many-frame workload deterministically."

#### `benchmarks/session-corpus/corpus-shape.ts`
- **Purpose:** The measured **quantile anchors** of 1,650 real local DSH Sessions (events, decompressed bytes, turns) at 22 upper quantiles.
- **Non-obvious:** "**Only counts and byte totals were extracted; no content, identity, or path.**" The synthetic corpus is then built so that **every quantile of the generated corpus is at least the measured one**, and the anchor is *shared* across dimensions, so "a long Session is long in every dimension."
- **Stealable:** this is the honest way to benchmark a store: measure the real distribution's shape (counts only), then synthesize a corpus that is provably at least as hard.

#### `benchmarks/session-corpus/synthetic-corpus.ts`
- **Purpose:** Authors the corpus: a Zipf-distributed text pool (`TextPool`), per-anchor event bodies, and a corpus writer that shares one compressed body between every Session of the same anchor.
- **Non-obvious:** the byte target is hit by a **secant iteration** on `bytesPerChar`/`bytesPerEvent` ("Start from the previous anchor's model, then take secant steps from below"), with a hard 8-attempt limit that throws rather than shipping a short body. Creation order is a **prime-stride permutation** of the length rank (`CREATION_STRIDE = 7_919`) so list order does not correlate with length, and `corpusHeader` throws if the corpus size is not coprime with the stride. Every sixth Session is a subagent child, mirroring the measured 288-of-1,650 share. `forEachConcurrently` bounds IO concurrency at 8 because "each pending compression owns a native Zstandard context".

#### `benchmarks/session-corpus/session-corpus.worker.ts`
- **Purpose:** Mounts the **shipped Web Host**'s Session list/search/fork dependencies over the synthetic corpus.
- **Non-obvious:** the content-search engine is mounted with `openAt: 'first-search'` — "Content search is opt-in; enabled deployments defer the in-memory index to the first search" — so the benchmark measures the *opt-in* deployment shape, and the README says "shipped profiles disable it". `prepareAnchors` waits for the **fire-and-forget** projection-cache write-back to become durable with a 120 s deadline ("the cache serves a record only after it is durable"). Seeding writes the projection records **directly** rather than through the domain's one-fsync-per-put chain — "the domain's one-fsync-per-put chain would dominate seeding".

#### `benchmarks/session-corpus/session-corpus.bench.ts`
- **Purpose:** The budgets: list 3,000 Sessions, search 1,000, fork 1,000.
- **Non-obvious:** it keeps **two** number sets — `RECORDED_CI_MS` (the higher recorded median of the EPYC 7763 and EPYC 9V74 runners) and `EXPECTED_CI_MS` (the rounded expectation above it) — and asserts `recorded ≤ expected ≤ budget`, with a synthetic `×1.26` regression that must fail. The fork case measures **ten length strata plus the measured p99 plus the longest Session**, each with its own budget (100 ms / 1,100 ms / 20,400 ms). The **whole file** has a five-minute wall-clock limit asserted as its last case.

#### `benchmarks/session-corpus/projection-list.bench.ts` + `projection-list.worker.ts`
- **Purpose:** Measures the Session-list endpoint's **queue responsiveness** — the delay other callbacks suffer while the list is being built.
- **Non-obvious:** the worker installs a `setImmediate` probe inside the wire-view callback and measures **how many views were produced before the callback ran** (`maxViewsPerBatch`) plus the **event-loop delay histogram** (`monitorEventLoopDelay`). It monkey-patches `scheduler.yield` to *count* the yields, and restores the original descriptor in a `finally`. Three workload shapes: 50 Sessions with 100 persisted rows, 300 Sessions with 1,000 rows, and 3,000 Sessions with 0 rows (the "cheap" case). The budget is on the **worst callback delay**, not just the total.
- **Stealable:** "does this endpoint monopolise the event loop?" is a question August Trading's UI layers should also ask.

#### `benchmarks/conversation-fold/conversation-fold.bench.client.ts` + `conversation-fold.worker.client.ts`
- **Purpose:** Budgets for the Client's history fold and for live tool-argument preparation.
- **Non-obvious:** the fold benchmark is a **scaling** test: two windows with **identical event and compact-record counts** but a 20× difference in streamed deltas. The budget asserts the fold time scales ≤ 2.5× (records-proportional) and explicitly contrasts that with "replaying every delta measures about 11× as the delta count grows 20×". The `preparing` case measures a **512 KiB streamed `write` argument** and a 128 KiB streamed `bash` command, asserting the published `progressKb` and `filePath` and the group's `runningDetail` — i.e. it checks that the *UI-visible* incremental state is correct while the stream runs.
- **Stealable:** the "same record count, 20× the deltas" pair is a precise way to distinguish *compact-record-proportional* work from *delta-proportional* work.

#### `benchmarks/user-text/user-text.bench.client.ts` + `user-text.worker.client.ts`
- **Purpose:** Time and **allocation** budgets for the sent-user-text evaluator with the credential matcher.
- **Non-obvious:** this is the most adversarial benchmark in the tree. It measures the credential matcher against (a) ordinary prose/code/base64/markdown/log/json/shell documents, (b) documents that *do* contain a credential of each shape, and (c) **ten adversarial inputs deliberately shaped against each format's prefix/length/separator rules** (`digitless-sk`, `jwt-header-runs`, `unterminated-key-blocks`, `colon-run`, `long-scheme-user`, `tokens-between-digitless-keys`, …), each at two sizes so the **doubling ratio** must stay ≤ 2 × 1.25.
- **The allocation budget is an explicit byte model**: `ALLOCATION_FLOOR_BYTES (16 KiB) + 256 bytes per credential + 64 bytes per masked line break + 2 bytes per masked character`, each derived from a measurement quoted in a comment. The worker measures young-generation growth with `getHeapSpaceStatistics()` and **fails if any GC ran inside the interval** ("enlarge the young generation").
- **The credential fixtures are assembled at run time**, not committed: "Samples are assembled at run time so the repository holds no literal in a credential format." — a security-conscious fixture design.
- **The baseline alternates order** (`evaluatePair` measures the baseline first on even indexes and the matcher first on odd ones) to cancel scheduler drift, and the reported number is the **minimum** of the pairs, with the *ratio* to the shipped rules reported separately with its own headroom (1.75×) because "observed unchanged-worker CI ratios reached 1.65× the reference expectation".

#### `benchmarks/active-stream-reconnect/reconnect.bench.client.ts` + `reconnect.worker.client.ts`
- **Purpose:** Rebuilding a 100,000-delta unfinished Assistant reply after a reconnect.
- **Non-obvious:** the worker calls the **production** `ClientAssistantStream.replace()` (bundled privately because the Client has no plain-Node export) and then asserts **the next dense live frame is still accepted** (`nextFrame === 'transient'`) — a performance benchmark that also pins a correctness invariant. The budget is 125 ms (50 ms reference × 2 × 1.25) and the retained heap is 30 MiB. The bench file also keeps **recorded hosted samples** as a calibration case that must pass the *current* budget and fail the *reference* one.

#### `benchmarks/terminal-io/terminal-io.bench.ts` + `terminal-io.worker.ts` + `session-adapter.ts`
- **Purpose:** "Bounded terminal output must not rescan a full retained window on every chunk."
- **Non-obvious:** the bench is a **ratio test**: ingest cost at a 4 MiB retained window must be ≤ 4× the cost at a 128 KiB window (`MAX_CAPACITY_RATIO = 4`) — the invariant is "overflow cost is bounded", not "the absolute time is small". Three extra modes cover the nasty cases: 16-byte chunks, OSC-filtered chunks (56 KiB of discarded escape sequence before an 8 KiB slice), and a 5 MiB send. `session-adapter.ts` is a one-line re-export of the production `LocalPtySession` — "PR blobs are data, never programs" in miniature.

#### `benchmarks/long-session-browser/long-session.bench.ts` + `synthetic-history.ts`
- **Purpose:** The Chromium benchmark: open a 240-turn Session, page back through every older page, open Trajectory, and type a draft **while a reply is streaming**.
- **Non-obvious:**
  - The **input-overlap witness** is installed *before* submission as a one-shot `input` listener that records `event.isTrusted`, whether the transcript contained `FIRST` but not `DONE`, the browser-clock timestamp and the focus. The test then asserts the first input event really did overlap an unfinished reply, and that **a keystroke after DONE must fail the same assertion**.
  - The paging timer **starts after the named control is attached and exactly one button is resolved** — "A replaced button fails instead of selecting a replacement" — and the test proves the timer excludes selector preparation with a `Promise.withResolvers` barrier and a `vi.spyOn` on the Locator.
  - **Two animation frames** end each measurement, and the file says why that is not a presentation timestamp.
  - **The diagnostic sub-tests use `page.setContent` with deliberately wrong markup** (a hidden marker, an unrelated table row, two `Load earlier` buttons) to prove the *readiness probes* cannot be fooled.
  - The transcript fixture contains **mixed-language prompts, 20 code fences, 40 synthetic tool results**, and every historical Assistant is built by the **production accumulator** from matching reasoning/text/tool/usage/finish chunks.

#### `benchmarks/tsdown.config.ts` + `benchmarks/package.json`
- **Purpose:** The build of the benchmark workers.
- **Non-obvious:** `deps.neverBundle: [/^@deepseek-ai\//]` — **workspace packages are never bundled**; they must resolve through their built `lib/` entries, which is exactly what `assertBuiltBenchmarkRuntime` checks. Each worker gets its own `outDir` under `.dsh-build/` and its own tsconfig (`tsconfig.host.json` for Node workers, `tsconfig.client.json` for Client workers).

### Tier 2 (continued) — `benchmarks/` bulk rows

| File | What it is / what it pins |
| --- | --- |
| `benchmarks/AGENTS.md` | The performance tree's contract (full entry above). |
| `benchmarks/active-stream-reconnect/README.md` | Decides the reconnect budget: 50 ms reference → 125 ms ceiling, 30 MiB retained heap, and that the *next* dense live frame must still be accepted. |
| `benchmarks/active-stream-reconnect/README.zh.md` | Chinese mirror (hash-checked by the i18n record). |
| `benchmarks/active-stream-reconnect/README.i18n.yaml` | Generated bilingual-pairing hashes (2 pairs). |
| `benchmarks/agent-continuation/README.md` | Decides the continuation budgets: 900 ms + 1.25× for catalog and tool continuation, a separately reviewed 297 ms for request history, reference-machine scaling for the SDK profile; and that a failed worker reports exit, signal, timeout and stderr with the temp root removed even on failure. |
| `benchmarks/agent-continuation/README.zh.md` | Chinese mirror. |
| `benchmarks/agent-continuation/README.i18n.yaml` | Generated bilingual-pairing hashes. |
| `benchmarks/long-session-browser/README.md` | The most precise benchmark spec in the repo: what is timed, what is a diagnostic, the three readiness rules (two animation frames = a rendering opportunity, not a presentation; paging waits for the *named* control and resolves exactly one button; a replaced button fails), and that heap/DOM counts are diagnostics, not leak budgets. |
| `benchmarks/long-session-browser/README.zh.md` | Chinese mirror. |
| `benchmarks/long-session-browser/README.i18n.yaml` | Generated bilingual-pairing hashes. |
| `benchmarks/session-corpus/README.md` | Decides the corpus method: every synthetic Session is at least as long as the same quantile of a measured local corpus; the list runs over 3,000 Sessions, search and fork over separate 1,000-Session corpora; seeding writes ~1.5 GB of Zstandard logs and removes the root on success or failure; the file fails if it exceeds five minutes. |
| `benchmarks/session-corpus/README.zh.md` | Chinese mirror. |
| `benchmarks/session-corpus/README.i18n.yaml` | Generated bilingual-pairing hashes. |
| `benchmarks/package.json` | The private `@deepseek-ai/dsh-benchmarks` workspace: 40+ workspace packages it may depend on, `playwright` and `@xterm/headless` as the only external dev dependencies. |
| `benchmarks/tsdown.config.ts` | The worker build (see entry above). |
| `benchmarks/support/built-worker.ts` | The isolation contract (full entry above). |
| `benchmarks/support/calibration.ts` | The one conversion from a reference machine to a CI budget (full entry above). |
| `benchmarks/support/machine-profiles.ts` | The reviewed machine table (full entry above). |
| `benchmarks/support/scaling-report.ts` | The JSONL → HTML report (full entry above). |
| `benchmarks/agent-continuation/workload.ts` | The synthetic dimensions and the event authoring (full entry above). |
| `benchmarks/agent-continuation/agent-continuation.bench.ts` | The budget-calibration-by-recorded-sample pattern (full entry above). |
| `benchmarks/agent-continuation/agent-continuation.worker.ts` | The request-history and tool-continuation worker (full entry above). |
| `benchmarks/agent-continuation/child-catalog.worker.ts` | The fork-child catalog worker (full entry above). |
| `benchmarks/agent-continuation/profile-adapter.ts` | The synthetic model plugin for the shipped `sdk-minimal` profile (full entry above). |
| `benchmarks/agent-continuation/profile-continuation.worker.ts` | The end-to-end SDK continuation worker (full entry above). |
| `benchmarks/agent-continuation/synthetic-history.bench.ts` | A *correctness* benchmark: the seeded head must survive a resumed prompt that replaces it, the derived messages must be unchanged below it, and every `tool/result` must still point at its `tool/call`. |
| `benchmarks/session-open/session-open.constants.ts` | The fixture's stable identity and released storage location. |
| `benchmarks/session-open/synthetic-released-v0-session.ts` | The byte-exact released-v0 Zstandard fixture (full entry above). |
| `benchmarks/session-open/session-open.worker.ts` | The four-scenario worker with the four user-visible phases (full entry above). |
| `benchmarks/session-open/session-open.bench.ts` | The first-open vs post-upgrade-reopen budgets (full entry above). |
| `benchmarks/session-corpus/corpus-shape.ts` | The measured quantile anchors (full entry above). |
| `benchmarks/session-corpus/synthetic-corpus.ts` | The corpus author (full entry above). |
| `benchmarks/session-corpus/session-corpus.worker.ts` | The list/search/fork worker (full entry above). |
| `benchmarks/session-corpus/session-corpus.bench.ts` | The corpus budgets and the five-minute file limit (full entry above). |
| `benchmarks/session-corpus/projection-list.bench.ts` | The queue-responsiveness budgets (full entry above). |
| `benchmarks/session-corpus/projection-list.worker.ts` | The event-loop-delay probe (full entry above). |
| `benchmarks/conversation-fold/conversation-fold.bench.client.ts` | The record-proportional fold budget and the delta-scaling ratio (full entry above). |
| `benchmarks/conversation-fold/conversation-fold.worker.client.ts` | The fold and preparing worker (full entry above). |
| `benchmarks/user-text/user-text.bench.client.ts` | The credential-matcher time and allocation budgets (full entry above). |
| `benchmarks/user-text/user-text.worker.client.ts` | The adversarial, allocation and ratio measurement worker (full entry above). |
| `benchmarks/active-stream-reconnect/reconnect.bench.client.ts` | The reconnect budget and the recorded-sample calibration (full entry above). |
| `benchmarks/active-stream-reconnect/reconnect.worker.client.ts` | The 100,000-delta production fold worker (full entry above). |
| `benchmarks/terminal-io/terminal-io.bench.ts` | The bounded-overflow ratio budget (full entry above). |
| `benchmarks/terminal-io/terminal-io.worker.ts` | The terminal ingest worker with its four modes (full entry above). |
| `benchmarks/terminal-io/session-adapter.ts` | One line: re-export the production `LocalPtySession` so the benchmark measures the shipped code. |
| `benchmarks/long-session-browser/long-session.bench.ts` | The Chromium open/page/trajectory/stream benchmark and its input-overlap witness (full entry above). |
| `benchmarks/long-session-browser/synthetic-history.ts` | The 240-turn mixed-language fixture with a production-built stream (full entry above). |

---

### Tier 1 (continued) — `patches/`: the pinned third-party fixes

#### `patches/@earendil-works__pi-ai@1.1.0.patch`
- **Purpose:** Removes the streaming `parseStreamingJson(partialJson)` call from **five** provider adapters (Anthropic messages, Bedrock Converse, Mistral conversations, OpenAI completions, OpenAI responses, Pi messages).
- **Why it matters (the stealable idea):** parsing a *partial* JSON argument string on every streamed delta is O(n²) over the argument's length and throws on every incomplete fragment. The patch leaves the partial string alone and lets the consumer parse once at the end. August Trading's provider layer should treat a streaming tool-argument as an opaque buffer until the call is closed — exactly the same defect class as its own `AssistantStreamAccumulator`.
- **Stealable:** a patch that touches **all five providers at once** rather than one — the fix is in the shared concept ("arguments are complete only at `toolcall_end`"), not in a provider.

#### `patches/@yao-pkg__pkg@6.21.0.patch` (400 KB — 134 lines; two of them are ~197 KB minified bundles)
- **Purpose:** Patches `prelude/sea-bootstrap.bundle.js` in the `pkg` single-file-executable packer.
- **What the readable hunks change (lines 4–133):**
  1. **Atomic addon writes.** `writeFileAtomic(dest, content)` writes to `dest.<pid>.<rand>.tmp` in the *same directory* and `renameSync`s it into place; on failure the temp file is unlinked and the error rethrown. The comment explains the exact failure it prevents: "A direct `writeFileSync` truncates a file another process may already have mapped (SIGBUS on Linux, 'Library not loaded' on macOS) and exposes the half-written bytes to that process's hash comparison."
  2. **`readdirSync(dirPath, options)` with `withFileTypes`.** The SEA provider previously returned bare name strings; the patch adds a `SEADirent` class with `isFile()/isDirectory()/isSymbolicLink()` and false for the rest, so code that walks a virtual filesystem with `withFileTypes` works inside a single-file executable.
  3. **`shared.patchChildProcess(entrypoint2)` removed** from the SEA bootstrap (the last hunk).
- **Read method:** the file is 400 KB but only 134 lines — two lines are ~197 KB minified bundles. I read lines 0–133 with the two huge lines truncated to 900 characters each and the diff hunks fully; the minified bundle bodies were not read line by line.

#### `patches/exceljs@4.4.0.patch` (35 KB)
- **Purpose:** Makes `exceljs` read OOXML workbooks *by relationship*, not by filename convention, and adds UTF-16 support.
- **The three substantive changes:**
  1. **Canonical XML names.** `new SaxesParser({xmlns: true})` plus a `prefixes` map that maps each namespace URI to a canonical prefix; `canonicalName(node)` rewrites both element and attribute names. "Xforms use canonical names; OOXML producers may choose different prefixes." `cdata` events are now surfaced as `text` events.
  2. **Relationship-driven part resolution.** The workbook is parsed by walking `_rels/*.rels` first, building a `partKey → entry name` map (case-folded; an ambiguous part throws "Ambiguous workbook part") and a `part → relationship type` map (a conflicting type throws "Conflicting workbook part"). Dispatch then switches on `partTypes.get(entryName)` instead of on the literal path `xl/worksheets/sheet1.xml`. `_resolvePart(owner, target)` resolves an internal OPC target against its owning part **without filesystem access** and throws "Relationship escapes package" on a `..` escape. External targets throw. A missing worksheet relationship now throws instead of `return`ing silently.
  3. **Encoding.** `_readXmlEntry` sniffs the BOM and decodes UTF-8/UTF-16LE/UTF-16BE with `new TextDecoder(encoding, {fatal: true})`; `cdata` comment support was added to `CommentXform`; the `browser` field was repointed from the minified bundle to `dist/exceljs.js`.
- **Stealable:** "**Relationship order and ZIP entry order do not determine part identity**" — resolve by the relationship graph, and *fail* on ambiguity rather than guessing.

#### `patches/@fortune-sheet__core@1.0.4.patch` and `patches/@fortune-sheet__react@1.0.4.patch`
- **Purpose:** Add a **read-only mode** to a spreadsheet widget library.
- **What they change:** `drawFreezeLine` returns early when `allowEdit === false`; a read-only trackpad pan path is added to `handleGlobalWheel` ("Read-only trackpad panning follows pixel deltas on both axes without a gesture lock"); `FxEditor` writes `textContent` instead of `innerHTML` in read-only mode (an XSS-shaped fix); `InputBox`'s layout effect is skipped unless `forceFormulaRef`; the sheet-tab scroll-button calculation accounts for the navigation space in read-only mode; and the selection save is *preserved* from the current sheet instead of being cleared.
- **Stealable:** the `textContent` vs `innerHTML` switch — a read-only view of untrusted content should never be an HTML sink.

#### `patches/@electron__osx-sign@1.3.3.patch`
- **Purpose:** `fs.stat` → `fs.lstat` while walking the signing directory, so a **symlink is not followed** when looking for `.cstemp` leftovers. Two files (cjs + esm).

#### `patches/app-builder-lib@26.17.0.patch`
- **Purpose:** Adds the `ULMO` DMG format to the type union and to `scheme.json`'s enum.

#### `patches/node-pty@1.2.0-beta.15.patch`
- **Purpose:** Two fixes. (a) The spawn helper is resolved in three steps: `DSH_NODE_PTY_SPAWN_HELPER` (absolute), then `process.execPath + '-spawn-helper'` as a sibling of the running executable, then the original in-package path. (b) On Windows, `this._conoutSocketWorker.dispose()` is called when the process exits **even when the exited process has no more output** — "Start draining even when the exited process has no more output."

### Tier 2 (continued) — `patches/` bulk rows

| File | What it is / what it pins |
| --- | --- |
| `patches/@earendil-works__pi-ai@1.1.0.patch` | Five provider adapters stop re-parsing partial streaming tool JSON. |
| `patches/@electron__osx-sign@1.3.3.patch` | `lstat` instead of `stat` so symlinks are not followed during signing cleanup. |
| `patches/@fortune-sheet__core@1.0.4.patch` | Read-only spreadsheet core: freeze-line guard, read-only wheel panning, `_.escape`. |
| `patches/@fortune-sheet__react@1.0.4.patch` | Read-only spreadsheet React layer: `textContent` sink, selection preservation, tab-scroll measurement. |
| `patches/@yao-pkg__pkg@6.21.0.patch` | Atomic SEA addon writes + `readdirSync(withFileTypes)` in the single-file-executable packer. |
| `patches/app-builder-lib@26.17.0.patch` | Adds `ULMO` to the macOS DMG format union. |
| `patches/exceljs@4.4.0.patch` | Relationship-driven OOXML part resolution, canonical XML prefixes, UTF-16 decoding. |
| `patches/node-pty@1.2.0-beta.15.patch` | Spawn-helper resolution order and the Windows conout drain fix. |

---

### Tier 1 (continued) — `python/`: the SDK, the runtime carrier, and their rules

#### `python/sdk/src/deepseek_harness/client.py`
- **Purpose:** A synchronous JSON-RPC-over-stdio client for the bundled `dsh` runtime.
- **Key abstractions:** `HarnessConfig`, `HarnessClient` (`start`, `close`, `initialize`, `session_prompt`, `resume_session`, `get/set_working_directory`, `request`, `notify`, `subscribe_notifications`, `subscribe_session_notifications`, `next_request`, `respond`, `respond_error`), `NotificationSubscription`.
- **Data flow:** a reader thread parses NDJSON lines from stdout; a second thread drains stderr into a 400-line deque; `request()` registers a per-request waiter queue under a lock, writes the frame under a *separate* write lock, and waits with a deadline.
- **Non-obvious design decisions:**
  - **A failing notification filter is contained to its own subscription** — the subscriber is removed and the exception is delivered to it; the other subscribers keep working and the global queue stays empty. A broken predicate cannot take down the client.
  - **Subagent ancestry is retained for the runtime process lifetime** (`_session_parents`), so a `subagent.started` edge discovered in one subscription is still known in a later one. `subscribe_session_notifications(session_id)` therefore delivers the *whole tree* (root + descendants), and `_session_is_descendant_of` walks the parent chain with a `visited` set so a cycle cannot loop.
  - **`RunResult.events` contains root-session events only** — descendant output cannot replace the root response (the SDK README states this as a contract).
  - **The close sequence is bounded and escalating**: a `shutdown` request with `shutdown_timeout_seconds`, then stdin close, then `wait`, then `terminate`, then `kill`. A failed shutdown is recorded in the stderr deque, not raised.
  - **Timeouts carry diagnostics.** `_runtime_diagnostics()` joins the exit code and the stderr tail; a `TimeoutError` message is `f"{method} timed out waiting for DeepSeek Harness runtime\n{diagnostics}"`, and the *profile name* is appended by `initialize`.
  - **A JSON-RPC error during `initialize` closes the runtime and re-raises with the diagnostics appended to the message.**
  - **Non-JSON stdout lines are skipped** — a Node warning does not kill the transport.
  - **The home is never implicit.** `_default_launch_args` raises `ValueError("HarnessConfig requires an explicit dsh_home or non-empty DSH_HOME; the Python SDK never uses ~/.dsh implicitly")`.
- **Surprising:** `next_request()` / `respond()` make the client a **server too** — the SDK can answer the runtime's own requests.

#### `python/sdk/src/deepseek_harness/api.py`
- **Purpose:** The high-level API: `DeepSeekHarness`, `DeepSeekHarnessConfig`, `Session`, `RunResult`.
- **Non-obvious:**
  - **`Session.run()` owns the activity interval**: it waits for the *inbox receipt* of its own message (`_is_inbox_receipt` matches the `agent/inbox/spliced` event containing the returned message id) and then for the session's `idle` status. The interval therefore starts at durable receipt, not at the prompt call.
  - **The turn's finish reason is the *last* `turn/end`'s `data.reason.kind`**, and a `turn/end` without a string kind raises `SdkProtocolError` — a malformed ending is a protocol violation, not a silent `None`.
  - **The final response is the last committed root-session assistant text** in the interval, read from the event stream rather than from a notification.
  - **`cwd` and `runtime_cwd` are separate and both become absolute** before launch; `base_url`/`api_key` override the child's `DEEPSEEK_BASE_URL`/`DEEPSEEK_API_KEY`.
  - `resume_session` **raises rather than creating a replacement** for a missing/unreadable/incompatible/occupied session.

#### `python/sdk/src/deepseek_harness/office.py`
- **Purpose:** Local Office operations (`convert`, `recalculate`, `render_images`) through the runtime wheel's `dsoffice` CLI — **no agent, no session, no model request, no API key, no Harness home**.
- **Non-obvious:**
  - **Strict, frozen pydantic models** (`ConfigDict(strict=True, frozen=True)`) with camelCase aliases; a malformed CLI result raises `SdkProtocolError`, a CLI failure raises `OfficeError(code, error, exit_code)` preserving the CLI's own code.
  - **`OfficeOptions` renders itself into CLI flags** field-by-field (`--timeout-ms`, `--font-directory`, `--initial-font-family`, `--font-fallbacks` as JSON).
  - **The documented limits are explicit about what is NOT verified**: "Recalculation does not verify business logic or Excel fidelity."

#### `python/sdk-runtime/src/deepseek_harness_runtime/__init__.py` and `python/sdk-runtime/src/deepseek_harness_runtime/_resources.py`
- **Purpose:** Locate and validate the bundled `dsh` executable; download the optional Office and authoring resources.
- **Non-obvious:**
  - **Two carriers coexist** and the choice is explicit: the production single-file exe, and a **dev-only** `runtime/node/` closure that is *never selected automatically*. "Automatic resolution finds the production exe ONLY — the dev-only node carrier must be selected explicitly so a production deployment can never silently ride on a source build."
  - **Missing artifacts raise with the acquisition routes** — the error message names both the build script and the wheel to install.
  - **`main()` refuses a missing or blank `DSH_HOME`** with exit code 2; on Windows it *waits* and forwards the exit status (the CRT `exec` does not replace the process), on POSIX it `execvpe`s.
  - **Downloads are atomic and idempotent**: a `mkdtemp` staging directory is populated, a `complete` marker file is written, and the directory is `rename`d into place; an `EEXIST`/`ENOTEMPTY`/`EPERM` is tolerated **only** when the existing `complete` marker holds the same identity hash.
  - **The cache identity is a 64-hex digest of the release's locked inputs**, and a mismatch is an error ("runtime cache identity mismatch").
  - **Downloads are explicit operations.** "Importing Python modules, starting SDK profiles, and processing Office files never download resources."
  - `_resources.run_office_process` handles the double-Ctrl+C case: on POSIX it kills the process group; on Windows it requires an **absolute** `SystemRoot` and runs `taskkill /PID <pid> /T /F`.

#### `python/sdk-runtime/hatch_build.py`
- **Purpose:** The wheel build hook that assigns the native platform tag and **rejects an incomplete or mixed-platform payload**.
- **Non-obvious:** the hook computes the *exact* expected file set (`<exe>`, `<exe>-rg`, `-spawn-helper` on macOS, the `<platform>-<arch>/` resources directory) and raises "runtime wheel <tag> payload must be <files>; found <files>" if the directory holds anything else. It also checks the executable bit and that the resources directory validates against `downloads.json`.

#### `python/sdk-runtime/runtime-bootstrap.mjs`
- **Purpose:** The private entry the Python single-file runtime packaging owns.
- **Non-obvious:** it uses Node's `registerHooks` to **resolve `@deepseek-ai/libreoffice-kit` against the sidecar's own `package.json`** (a real `parentURL` override, not a path hack); it selects among four modes by *consuming* the env var (`Reflect.deleteProperty(process.env, 'DSH_RUNTIME_DOWNLOAD')`) so the selection cannot be inherited by a child; and it installs the proxy from the environment for the duration of a download, disposing it in a `finally`.

#### `python/sdk-runtime/pyproject.toml` + `platforms.json` + `package.json`
- `python/sdk-runtime/pyproject.toml` — the wheel includes the injected executable and sidecars and **excludes `runtime/node`**; `core-metadata-version = "2.4"` because Twine 6.2.0 accepts metadata only through 2.4; `[project.scripts] dsh = "deepseek_harness_runtime:main"`.
- `python/sdk-runtime/platforms.json` — the single table of five platforms → wheel tag → executable name. **The wheel tag and payload must match exactly; no Windows arm64 wheel is published.**
- `python/sdk-runtime/package.json` — the `dsh-python-runtime-closure` manifest: ~150 workspace dependencies that define the *closed* Node dependency tree the runtime ships. It is "dependency-only" — no Python-specific Node application, and no checked-in default `cordis.yml`.

### Tier 2 (continued) — `python/` bulk rows

| File | What it is / what it pins |
| --- | --- |
| `python/README.md` | The two-package map (`deepseek-harness-sdk` / `deepseek-harness-runtime-bin`) and the rule that "Every launch requires an explicitly selected Harness home; Python never silently reads `~/.dsh`." |
| `python/README.zh.md` | Chinese mirror. |
| `python/README.i18n.yaml` | Generated bilingual-pairing hashes. |
| `python/development.md` | The contributor workflows — and the **snapshot contract**: `minimal/model-visible.json` pins the assembled system prompts, advertised tool schemas and model-visible messages; `authoring/model-visible.json` pins the Office catalog; `restart/` launches two SDK runtimes against one persistence root; `scheduler-recovery/` records a failed tool turn and a later completed one, preserving the original `UNKNOWN` error and `TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED` results. Also the rule that "**Comparison never rewrites committed recordings**." |
| `python/development.zh.md` | Chinese mirror. |
| `python/development.i18n.yaml` | Generated bilingual-pairing hashes. |
| `python/sdk/README.md` | The SDK reference: `DeepSeekHarness` config, `resume_session`, patches, `RunResult` semantics, the `sdk-minimal` vs `sdk` vs `web` profile split, and "Arbitrary argv replacement remains an internal fake-runtime test adapter, not public API." |
| `python/sdk/README.zh.md` | Chinese mirror. |
| `python/sdk/README.i18n.yaml` | Generated bilingual-pairing hashes. |
| `python/sdk/pyproject.toml` | `deepseek-harness-sdk`, `requires-python >=3.10`, pinned `deepseek-harness-runtime-bin==0.0.0.dev0`, test group `pytest>=8.0` + `Pillow==12.3.0`, `core-metadata-version = "2.4"`. |
| `python/sdk/src/deepseek_harness/__init__.py` | The public export surface: `DeepSeekHarness`, `DeepSeekHarnessConfig`, `Session`, `RunResult`, `HarnessClient`, `HarnessConfig`, `SdkProtocolError`, and the wire models. |
| `python/sdk/src/deepseek_harness/errors.py` | Four error types: `HarnessError` (base), `TransportClosedError`, `SdkProtocolError`, `JsonRpcError(code, message, data)`. |
| `python/sdk/src/deepseek_harness/models.py` | The wire vocabulary: `JsonObject`, `Notification`, `IncomingRequest`, `ServerInfo`, `InitializeResponse` (pydantic). |
| `python/sdk-runtime/README.md` | The runtime-carrier reference: wheel contents, the explicit-download model, the cache identity, `DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS`, the module API, and "Both carriers execute the same `dsh` grammar and shipped profiles." |
| `python/sdk-runtime/README.zh.md` | Chinese mirror. |
| `python/sdk-runtime/README.i18n.yaml` | Generated bilingual-pairing hashes. |
| `python/sdk-runtime/src/deepseek_harness_runtime/deepseek-harness-runtime.json` | The package metadata stub (`{"name":"deepseek-harness-runtime-bin","version":"0.0.0-dev"}`). |
| `python/sdk/examples/README.md` | The runnable example's contract: the `sdk-minimal` bundle exposes exactly three tools (persistent `bash`/`pwsh`, `read_image`, `working_directory`); "The persistent PTY can modify any path available to the runtime process, so use a disposable checkout or container." |
| `python/sdk/examples/README.zh.md` | Chinese mirror. |
| `python/sdk/examples/README.i18n.yaml` | Generated bilingual-pairing hashes. |
| `python/sdk/examples/minimal.py` | A 60-line CLI: refuses to start without `--dsh-home` or a non-empty `DSH_HOME` (`parser.error`). |
| `python/sdk/tests/expected/account-provider-signout.json` | The expected shape of a **cancelled turn**: `finish_reason: "aborted"` with a nested `reason.kind: "hook"` / `reason.reason: "deepseek-account/signed-out"`. |
| `python/sdk/tests/expected/cot-translation-projection.json` | The expected audit projection: the translator plugin's request/result events, their notification mirrors, and the main assistant text — plus the rule that the audit events carry **no** `surfaceOp` or `sourceEventSeqs` (they are ignorable). |
| `python/sdk/tests/fixtures/office_cli.py` | A fake Office peer that produces six distinct failure shapes: structured error, engine crash (exit 7), invalid JSON shape, invalid bytes, timeout with partial output, and a valid render manifest. |
| `python/sdk/tests/manual_sdk_agent_smoke.py` | A manual (not collected) smoke that drives the **repo-source** CLI under `tsx` against a local mock SSE server, and asserts the session log really is Zstandard (`bytes.fromhex("28b52ffd")`). |
| `python/sdk/tests/test_account_provider_snapshot.py` | Projects a recorded account cancellation through the real SDK and compares to the committed JSON. |
| `python/sdk/tests/test_bundled_runtime.py` | Keyless boot tests for both carriers; each **skips independently** when its artifact is absent; asserts the profile's bundles and that an unbundled plugin surfaces its own name in the error. |
| `python/sdk/tests/test_cot_translation_projection.py` | A fake runtime that emits the audit events; asserts the projection equals the committed file and that the audit events carry no surface op. |
| `python/sdk/tests/test_macos_deployment_target.py` | The `otool` parser takes the **newest** Mach-O slice's deployment target, requires one to exist, ignores unrelated version fields, and rejects a wheel tag that claims a newer macOS than the binary. |
| `python/sdk/tests/test_office.py` | The Office argv and JSON contract: literal paths, the exact flag list, exact sheet names, the three CLI failure codes, and that an invalid CLI result fails at the JSON reader. |
| `python/sdk/tests/test_office_interrupts.py` | The double-interrupt contract: POSIX waits for the whole process tree; Windows uses an **absolute** `taskkill /T /F`. |
| `python/sdk/tests/test_office_render.py` | Rejects unreadable Office output: white, transparent, left-right-swapped and text-free images; requires the native backend; retains only render evidence; and checks **every** format before reporting failures. |
| `python/sdk/tests/test_release_version.py` | The release rules: the root `package.json` version is authoritative, the tag must match it, PEP 440 spelling (`1.2.3-rc.1` → `1.2.3rc1`), the exact platform tags, the runtime payload's expected file set, and PyPI's 100 MB limit. |
| `python/sdk/tests/test_resume.py` | `resume_session` sends `session/resume` and propagates the failure; the request sequence is exactly `initialize`, `session/resume`, `shutdown`. |
| `python/sdk/tests/test_working_directory.py` | Two sessions have **independent** working directories; a relative path is preserved on the wire and resolved against the session's own directory; a malformed response raises `ValidationError`; and neither call runs a model turn. |
| `python/sdk/tests/test_runtime_resolution.py` | The runtime-resolution matrix: unknown mode fails loudly, an explicit mode beats the env var, the spawn helper is macOS-only, the ripgrep sidecar is required, the manifest and the authoring payload are validated (from a directory **and** from a zip), Windows is x64-only, the POSIX branch uses `execvpe` and the Windows branch waits, and the download decodes UTF-8 in an ASCII locale. |
| `python/sdk/tests/test_client.py` | The client contract in detail: the auto-review error projection, the PTC dispatch events, the notification callback order, the malformed `turn/end` rejection, relative-cwd absolutisation, the nested subagent tree without root pollution, unmatched notifications staying global, the late-idle wait, the filter failure containment, the timeout diagnostics, the close escalation, the initialize failure reaping the runtime, the public-signature audit (removed parameters must not come back), the idempotent close, the stderr tail in the closed error, concurrent-write serialisation, the default launch args, the explicit-home rejection, and the missing-dependency error. |
| `python/sdk/tests/test_smoke_model.py` | The live-smoke contract: the second turn must copy the **changed** content into a fresh receipt without modifying the source; the receipt must match byte-for-byte (no trailing newline); the snapshot normalisers (`{{system}}`, `{{messageId}}`, `{{id:1}}`, `{{cwd}}`, `{{sourceSessionFormatVersion}}`) and their *exceptions* (a deterministic tool-repair id is preserved, an opaque delivery qualifier is preserved); the "one Session generation across all roles" rule; and that a non-current writer is rejected. |
| `python/sdk/uv.lock` | Generated lockfile (87 KB) — the pinned Python dependency set with sha256 hashes. Not read line by line; head inspected (uv lock format v1, `requires-python >=3.10`, `deepseek-harness-runtime-bin` sourced as an editable local path). |

---

### Tier 1 (continued) — `website/`: the documentation adapter

#### `website/AGENTS.md`
- **Purpose:** The rules of the docs-site adapter.
- **Key decisions:**
  - "**Keep documentation content out of this tree.** `website/` owns only VitePress configuration, presentation assets, and the publication manifest. **This file is the only maintained Markdown file in this subtree.**" No locale/route/API copies.
  - **The build refuses to delete anything outside the site root.** `cleanDocSiteOutput` resolves the output path, requires it to be a *proper child* of the site root, resolves the **real path** of the nearest existing ancestor and requires that to stay inside the real root, and **unlinks a link-shaped output instead of traversing its target**. The AGENTS file states the consequence: "Raw-Markdown emission then treats files produced by that build as occupied and never overwrites them."
  - **Every route gets a raw-Markdown twin** (plus a parent-level alias for index routes) and a root `llms.txt`, so "a page's URL, minus any trailing slash, plus `.md` serves it as plain Markdown."
  - `pnpm docs:check` "rejects additional non-ignored Markdown under `website/`."
  - **One fullscreen modal and pan/zoom controller is shared** between Mermaid diagrams and standalone images; "Route, language, theme, and source replacement changes close the active view; theme disposal releases every observer, listener, and scroll lock."
  - "Native code groups keep their radio controls in separate forms so copied search excerpts cannot clear the page's selected platform."

#### `website/build.ts`
- **Purpose:** The production site build with a project-owned output preparation.
- **Non-obvious:** `onAfterConfigResolve` removes the output directory **after** VitePress resolves the configuration and **before** it writes files — and the removal is guarded by the three checks above. `docSiteBuildOptions(root, mpa)` is exported so the MPA build uses the same guard.

#### `website/docs.ts`
- **Purpose:** The canonical publication manifest.
- **Non-obvious:**
  - **One manifest drives both the sidebar, the nav bar and the `llms.txt` index** — "a new collection lands in both surfaces together."
  - **`pairedPages()` derives the Chinese path from the English one** (`foo.md` ↔ `foo.zh.md`), so a pair cannot drift into two hand-written lists; `mirroredPages()` handles the unpaired case.
  - **When a translation is absent, both routes project the available source** — "both routes intentionally project the available source instead of copying Markdown."
  - **`sectionSpec` throws** for an undeclared sidebar group: "Ranking by list membership alone would sort an undeclared group silently ahead of every declared one."
  - **`landingLink` is derived, not written down**: "a collection whose first page is renamed or reordered would otherwise leave the navigation bar pointing at a route the manifest no longer publishes."
  - The subsystem reference is **grouped by concern** into collapsed sections, because "One flat list of every subsystem pushed the rest of the reference sidebar below the fold."

#### `website/.vitepress/config.ts`
- **Purpose:** The VitePress configuration.
- **Non-obvious:**
  - **Vue interpolation is escaped in prose and inline code** (`escapeVueInterpolation` replaces `{{`/`}}` with entities) so a document that talks about templates does not get compiled.
  - **Code fences are cached in production** by content+info+markup+attrs, and the cache is explicitly build-local in development ("a dev renderer can survive many HMR updates").
  - Mermaid fences and snippet fences bypass the cache.
  - The wordmark is **inlined as SVG** rather than `<img>`: "An `<img>` would freeze the mark at the colors the file declares."
  - `editLink.pattern` **throws** when the projected frontmatter has no `editSource` — a missing provenance field is a build error, not a broken link.
  - The dev server re-projects the canonical docs on every change and serves the raw-Markdown twin and `llms.txt` through a middleware.

#### `website/.vitepress/theme/media-viewer.ts`
- **Purpose:** The shared modal, focus and pan/zoom controller for images and diagrams.
- **Non-obvious:**
  - **The shared content lives in a shadow root** — "so Mermaid copies cannot resolve their embedded styles and fragment IDs against the original diagram." The mermaid spec asserts the source SVG's `outerHTML` is unchanged and that only one `#diagram` exists in the document.
  - **Cleanup is idempotent and total**: it aborts the listener controller, disconnects the `ResizeObserver`, destroys panzoom, closes and removes the dialog, restores `body.style.overflow`, and **restores focus to the trigger** if it is still connected. It runs even when `showModal()` throws.
  - **Tab is trapped explicitly** over a fixed control list, in both directions, and arrow keys pan at `64 / scale` pixels — the pan distance stays constant on screen as you zoom in.
  - The `Original size (100%)` control exists **only for images** (`originalSize`), and its label carries the live scale ("currently 63%").

#### `website/.vitepress/theme/image-viewer.ts` and `website/.vitepress/theme/mermaid-viewer.ts`
- **Purpose:** Client-only enhancement of standalone content images and rendered Mermaid diagrams.
- **Non-obvious:**
  - **The source elements are never moved or replaced.** The image button is *appended* to the image's paragraph, the diagram trigger is *prepended* to the mermaid container; the image itself keeps its `src`, `alt` and position.
  - **An image qualifies only if** it is loaded (`complete && naturalWidth > 0`), has **non-empty alt text**, is the only content in its paragraph, and is not linked, inline, decorative (`role=presentation|none`, `aria-hidden`), inside a `.mermaid`, or marked `data-no-zoom`. The spec asserts the page's `innerHTML` is **byte-identical** for thirteen excluded shapes.
  - **A `MutationObserver` on `#VPContent` re-scans** on `childList`, `subtree` and a specific `attributeFilter` (`src`, `srcset`, `alt`, `role`, `aria-hidden`, `data-no-zoom`) — so a `src` change closes the stale view and re-offers the replacement.
  - **The Mermaid trigger waits for a usable SVG** (a `viewBox` with a positive width and height) before it is added.

#### `website/.vitepress/theme/page-markdown-actions.ts`
- **Purpose:** The per-page "copy this page as Markdown" / "view as Markdown" actions.
- **Non-obvious:**
  - **Before hydration the component renders a plain link** — SSR renders only the raw URL, so the page is useful without JavaScript; the client then upgrades it to a copy button plus a menu. The spec asserts the SSR snapshot has **no buttons at all**.
  - **`clipboard.write` is called *during the click gesture***, with the content as a **promise** (`new ClipboardItem({ 'text/plain': content })`) so the fetch resolves inside the gesture's permission window.
  - **The fetch is abortable and route-owned**: an `AbortController` is stored on the component, `onBeforeUnmount` aborts it, and the spec asserts that a route change, a locale change, or an unmount **cancels the old data and ignores its completion**.
  - **Two failure modes are distinguished**: `requestFailed` (the Markdown could not be loaded) and `clipboardFailed` (the API is missing or denied), each with a localized message that tells the trader to use the "View as Markdown" menu instead. The implementation-specific browser error text is deliberately not shown.
  - **Content type is checked**: only `text/markdown` and `text/plain` are accepted; `application/javascript`, `application/octet-stream` and a missing type are refused.
  - The menu is a real ARIA menu with `ArrowUp`/`ArrowDown`/`Home`/`End`, `Escape` restores focus to the toggle, and `onMousedown` is prevented so Safari's blur cannot steal focus.

#### `website/.vitepress/code-groups.ts` + `theme/code-group.css`
- **Purpose:** Keeps VitePress's native code-group radio inputs from colliding with the local search excerpt.
- **Non-obvious:** each tab strip is rewritten to its **own `<form>`**, so a copied excerpt with the same generated radio `name` cannot clear the page's selection — the spec asserts the page radio stays checked after the excerpt is re-rendered. In MPA output (no theme client handlers) a fallback stylesheet shows **every** command block and hides the controls, because tab switching is unavailable there.

#### `website/raw-markdown.ts`
- **Purpose:** The dev-server middleware for the raw-Markdown twin and `llms.txt`.
- **Non-obvious:** the **`sec-fetch-dest` header decides ownership**: a script/style/image request belongs to Vite even when it carries `?dsh-raw=1`; only `document` (or `empty` with the explicit flag) gets the Markdown. An unpublished route returns **404** for an explicit request and delegates otherwise. The spec covers seven delegating shapes and two unparseable targets.

### Tier 2 (continued) — `website/` bulk rows

| File | What it is / what it pins |
| --- | --- |
| `website/.gitignore` | `node_modules/`, `.cache/`, `.dist/`, `.generated/` — the disposable trees. |
| `website/package.json` | The docs-site workspace: VitePress 1.6, Vue 3.5, mermaid 11.17, `@panzoom/panzoom` 4.6, and a `build` script that runs `tsx build.ts`. |
| `website/.vitepress/theme/css.d.ts` | A one-line ambient module declaration for `*.css`. |
| `website/.vitepress/theme/index.ts` | The theme extension: lazy-loads the three client-only viewers on mount, re-scans them on route/language/theme change, and disposes them on unmount; renders `PageMarkdownActions` into `doc-before` only for a non-404 page with a `rawMarkdownPath`. |
| `website/.vitepress/theme/code-group.css` | The focus ring on code-group radios, plus "Search excerpts have no tab controls; every matching command stays visible." |
| `website/.vitepress/theme/media-viewer.css` | The viewer chrome: 44×44 controls, the bottom toolbar, the help panel, the mobile breakpoint, and the image container. |
| `website/.vitepress/theme/page-markdown-actions.css` | The actions' chrome, including the 18px-radius menu, the 36px icon wells, and the `aria-disabled` cursor. |
| `website/public/favicon.svg` | A 3-line SVG mark (50×50, `fill="#4D6BFE"`). Binary-ish asset: head inspected, not read line by line. |
| `website/public/wordmark.svg` | A 19-line `currentColor` wordmark, inlined into the nav bar by `config.ts`. Asset: head inspected, not read line by line. |
| `website/tests/code-groups.spec.ts` | JSDOM proof that a search excerpt cannot clear the page's code-group selection, and that the MPA fallback shows both commands. |
| `website/tests/raw-markdown.spec.ts` | The middleware's ownership rules: seven delegating shapes, the 404 for an unpublished explicit route, `llms.txt`, `HEAD` without a body, and a projection error that must not become a successful response. |
| `website/tests/image-viewer.spec.ts` | The image viewer's whole contract: delayed load, load failure, thirteen excluded shapes, the shadow-root clone, the scale, the focus cycle in both directions, replacing an active view, `src`/`srcset` invalidation, and disposal. |
| `website/tests/mermaid-viewer.spec.ts` | The diagram viewer's contract: the dialog name, the wait for usable dimensions, the shadow isolation of fragment IDs, the fit/zoom/pan wiring, the focus wrap, the help toggle, and the four release paths. |
| `website/tests/page-markdown-actions.spec.ts` | The clipboard contract: the SSR link, the keyboard menu, the dismissal paths, the Safari focus case, the in-gesture write, the failure taxonomy, the content-type check, the abort on route/locale/unmount, and the manual-copy fallback. |
| `website/tests/expected/image-viewer.en-US.html` | The file snapshot of the trigger, the open dialog and the enlarged clone in English. |
| `website/tests/expected/image-viewer.zh-CN.html` | The same snapshot in Chinese. |
| `website/tests/expected/page-markdown-actions.en-US.html` | The file snapshot of the mounted action bar (closed menu) in English. |
| `website/tests/expected/page-markdown-actions.zh-CN.html` | The same snapshot in Chinese. |
| `website/tests/expected/page-markdown-menu.en-US.html` | The file snapshot of the open menu in English. |
| `website/tests/expected/page-markdown-menu.zh-CN.html` | The same snapshot in Chinese. |
| `website/tests/expected/page-markdown-static.en-US.html` | The SSR snapshot (a plain link, no buttons) in English. |
| `website/tests/expected/page-markdown-static.zh-CN.html` | The SSR snapshot in Chinese. |

### Tier 3 — skipped with a reason

Fifteen files were confirmed by size, name and a head peek rather than read line by line. Every one of them is listed with its reason in `dsh-ci-root.status.tsv`; summarised:

- **11 generated bilingual-pairing hash records** (`*.i18n.yaml` under `.github/`, `benchmarks/`, `python/`): each holds a per-heading hash of the English and Chinese blocks of a README, with a header naming the regeneration command. Head-inspected; the paired READMEs themselves *were* read in full.
- **2 SVG assets** (`website/public/favicon.svg`, `website/public/wordmark.svg`): head-inspected; the wordmark's `currentColor` fill is what `config.ts` inlines into the nav bar.
- **`python/sdk/uv.lock`** (87 KB): a generated lockfile; head-inspected (uv lock format v1, `requires-python >=3.10`, the runtime wheel sourced as an editable local path, pinned sha256 hashes).
- **`patches/@yao-pkg__pkg@6.21.0.patch`** (400 KB): 134 lines, of which two are ~197 KB minified SEA bundles. Every line was read with those two truncated to 900 characters; the three diff hunks (atomic addon write, `readdirSync(withFileTypes)`, `patchChildProcess` removal) are described in full in the Tier-1 entry above; the minified bundle bodies were not read line by line.

---

## 2. Ideas worth stealing

1. **A credential-free preflight that gates the expensive check — and a *capability marker file* that flips the behaviour without a merge.** `.github/issue-management/pull-request.mjs:103` + `.github/workflows/issue-policy.yml:24`: the preflight answers only "is this PR in scope, and does it need the privileged token?"; the token is minted **only** when `needs-project == 'true'`; and `selective-preflight.json` is the rollout switch — its presence enables selective evaluation, its absence preserves legacy behaviour, and a *failed* preflight fails the job rather than falling back. **Why it transfers:** August Trading's `render-probe`/`boot-probe` gates could use the same three-way shape (skip / legacy / strict) with a marker file instead of an env var. **UNIQUE** to this shard.
2. **Context references are cheap; commitments are checked.** `.github/issue-management/rules.mjs:322`: an informational `Refs #3624` establishes context and carries no cross-object constraint; only a *resolving* `Fixes #123` reference pulls the Project Priority check and the privileged token. **Why it transfers:** August Trading's trade-plan proposals could be split the same way — a plan that merely *references* an analysis is context; a plan that *commits* to a trade is checked against the analysis's priority. **UNIQUE.**
3. **Make every magic number a documented decision with its own regression test.** `benchmarks/agent-continuation/agent-continuation.bench.ts` pins the exact recorded medians (`expect(recordedMedian).toBe(858.363927)`), asserts the *historical* budget would have failed them, asserts the *current* budget passes, and asserts a synthetic ×1.4 regression still fails. **Why it transfers:** August Trading's accuracy gates and R:R thresholds could each carry a "why this number" test. **UNIQUE.**
4. **A budget is a reviewed constant; environment variables must not override it.** `benchmarks/AGENTS.md`: "Enforce reviewed source constants; environment variables must not override performance budgets." **Why it transfers:** a perf or accuracy gate that can be relaxed by an env var is not a gate. **UNIQUE.**
5. **A self-measuring report that shows its own uncertainty.** `benchmarks/support/scaling-report.ts`: every endpoint records either a measured CPU share (`cpuMs/ms`) or a *declared* storage share, the report says which, the reader can override the share per endpoint, and memory and ratios are explicitly **not** scaled. **Why it transfers:** the same JSONL→HTML pattern could report August Trading's latency and accuracy numbers with their provenance visible. **UNIQUE.**
6. **Measure the real distribution's *shape* (counts only), then synthesize a corpus that is provably at least as hard.** `benchmarks/session-corpus/corpus-shape.ts` + `synthetic-corpus.ts`: "Only counts and byte totals were extracted; **no content, identity, or path**." **Why it transfers:** August Trading could benchmark its trade log and journal against a synthetic corpus with the same length distribution without touching a user's data. **UNIQUE.**
7. **Fail closed on a missing dependency, and say so in the error.** `python/sdk/src/deepseek_harness/client.py:127` and `python/sdk-runtime/src/deepseek_harness_runtime/__init__.py:44`: a missing runtime names *both* acquisition routes (build script and wheel). `python/sdk/src/deepseek_harness/client.py:441`: the SDK refuses to launch without an explicit `dsh_home` — "the Python SDK never uses `~/.dsh` implicitly." **Why it transfers:** August Trading's provider config should never silently fall back to a default key store. **UNIQUE.**
8. **The trust boundary is drawn at the checkout, not at the trigger.** `.github/review-ownership/check-approval.mjs` + `.github/workflows/weighted-approval.yml`: the status-writing job uses `pull_request_target` but checks out only the **default branch** and reads PR reviews and comments as **API data**; the repo README states "All actions in the status-writing job are pinned to commit SHAs" and "It does not check out or execute pull-request code." **Why it transfers:** any August Trading hook that reads user-supplied content must treat it as data. **CONVERGENT** with the `blame-production.py` "PR blobs are data, never programs" rule and with `git --no-ext-diff --no-textconv` (no external diff driver, ever).
9. **A contribution's points are weighted by how much of the changed *old production* code the reviewer wrote.** `.github/review-ownership/check-approval.mjs:296` + `blame-production.py`: new lines never enter the denominator, an empty denominator gives no boost, and **unlinked authors stay in the denominator without contributing**. **Why it transfers:** a direct analogue for August Trading: weight a reviewer's confidence by the share of the *existing* analysis code they own. **UNIQUE.**
10. **Never let a failure look like a success.** Repeated across the shard: the e2e key preflight ("the e2e suite would self-skip and report a false green"), the sandbox legs ("a self-skip … is a failure, not a pass"), the `NALR_REQUIRE_LANDLOCK` switch, and the approval publisher's "Revoke previous approval status" step *before* the expensive setup. **Why it transfers:** a gate that can silently skip is worse than no gate. **CONVERGENT.**
11. **One stable required check that aggregates a churning matrix.** `.github/workflows/ci.yml`: branch protection requires "all checks passed", a bookkeeping job with an explicit `needs:` list, and `if: !cancelled()` so an obsolete verdict never keeps a cancelled workflow alive. **Why it transfers:** August Trading's CI (if it ever grows) needs one stable name. **UNIQUE.**
12. **A single required-check verdict that fails on `skipped`, not just `failure`.** `ci.yml`: `contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped')`. **Why it transfers:** a skipped required job is a hole in the gate. **UNIQUE.**

## 3. Trading-specific findings

- **Long-lived monitoring & scheduled work — not in this shard.** This shard has cron-like *CI* schedules (the nightly e2e at `17 0 * * *`, "off the top-of-hour cron stampede"; Dependabot at `0 4 * * *` Asia/Shanghai with a 30-day cooldown) but no product-side monitoring, no entry/TP/SL detection and no catch-up-for-missed-runs logic. The closest transferable patterns are: (a) the **nightly cron is off the top of the hour** to avoid the stampede; (b) the e2e suite keeps **both** a nightly cron *and* push/dispatch triggers, because "scheduled triggers are auto-disabled after 60 days of repo inactivity" — a scheduled-only monitor silently dies; (c) the **event-driven, not reconciling** stance in `.github/issue-management/README.md` ("Lifecycle processing is event-driven, not a reconciler. Omitted events do not repair Project state") — August Trading's scheduled trade monitor needs the opposite: a *reconciler* that re-derives state from the durable log, because a missed cron must not mean a missed TP/SL.
- **Human-in-the-loop approval — partially in this shard, but for *contributions*, not trades.** The approval engine is the richest thing here: a two-point weighted threshold, a blocker (a write-capable `CHANGES_REQUESTED`) that beats the threshold, an author-credit currency capped at 1.1 that "cannot approve alone", and a **delegation** protocol with revocation. The audit trail is: the **commit status** (`context: 'weighted approval'`, `state: pending|success|error`, `target_url` = the run) plus the **run log**, plus a **30-day publication audit artifact**. For August Trading the transferable shape is: *a gate that publishes a machine-readable status (not just a boolean), a blocker that overrides a passing score, a contribution that can never satisfy the threshold alone, and an approval that can be delegated and then reclaimed by the delegator's own later action.*
- **Post-mortem / reflection loops — not in this shard.** The audit comment in `.github/issue-management/lifecycle.mjs` is the closest shape: **exactly one marker-identified comment per Issue**, PATCHed when the content changes and **DELETED when the Issue becomes clean** — "the audit trail is therefore always exactly one comment per Issue, and a resolved Issue has no leftover scolding." That is a good model for August Trading's reflection store: one living record per trade, not an append-only pile.
- **Multi-agent — the *outcome* of a subagent tree is visible in this shard.** `python/sdk/src/deepseek_harness/client.py` retains subagent ancestry for the process lifetime, `subscribe_session_notifications(session_id)` delivers the root **and every discovered descendant** in wire order, and `RunResult.events` contains **root-session events only** — "so descendant output cannot replace the root response." August Trading's bot/subagent plumbing should adopt the same split: *notifications are a tree; the answer is the root only.* The repo's own guidance (from `dsh-agent-skills`, a sibling shard) is that debate adds value only where the agents hold **different evidence**, and this shard shows the plumbing that makes a single agent the authoritative answer.
- **Structured logs the model can query — the shard contains the *format*, not the query layer.** The durable formats visible here: the **Zstandard JSONL session log** (`.jsonl.zstd`, header line + one body frame per row, with the magic bytes `28b52ffd` asserted in `manual_sdk_agent_smoke.py`), the **compressed "text-chunks" row** (`{type: 'text-chunks', seq0, time0, dt: [...], texts: [...]}` — a delta-encoded run of streamed text in ONE row), and the **session projection cache** (`{key, ver, seq, val}` rows keyed by session id, written every 200 events or every 5 s). That projection cache is the answer to "how do you query 3,000 sessions fast": a **separate, smaller, derived store** holding only what the list needs, written asynchronously, served from cache, and *bounded* by a "wait until durable" deadline. The repo's own numbers: a 1,000-Session corpus takes **144 s** to build the search index cold and **3.4 s** warm; listing 3,000 Sessions costs **2.3 s** to boot the Host and **3.2 s** for the first list.
- **Staying simple as features accumulate — the shard's answer is "the manifest has one owner and one derivation."** `website/docs.ts` derives both the nav bar and the `llms.txt` index from one `localeCollections` record, and derives a nav target from the collection's first page rather than writing the URL down — "a collection whose first page is renamed or reordered would otherwise leave the navigation bar pointing at a route the manifest no longer publishes." The same principle appears in the CI: one stable required check over a churning matrix; one `policy.mjs` dispatcher over three commands; one `ciTimeBudget()` conversion over every benchmark. The pattern is: **one place owns the fact; everything else derives from it.**

## 4. Non-obvious decisions and gotchas

1. **The issue-policy workflow uses `pull_request` (not `pull_request_target`) and a *trusted* checkout.** `issue-policy.yml` checks out `ref: ${{ github.event.repository.default_branch }}` with `persist-credentials: false` — the policy code never comes from the PR. The *approval* workflow uses `pull_request_target` but does the same trusted checkout. Reading either workflow without noticing the `ref:` will lead to the wrong conclusion about the trust boundary.
2. **`selective-preflight.json` is a marker, not a config.** Its content is `{"version": 1}`. Its *presence* selects the new behaviour; its absence preserves the legacy path; a preflight that runs and *fails* fails the job. There is no "fall back to legacy on failure".
3. **The `Issue policy` job is required even when it does nothing.** "The required job remains present for subscribed events." An exempt PR still runs the job and still passes — it just skips the token minting and the Project reads.
4. **`rules.mjs` throws at *import* time** if `config.json` is missing a status, a field name or a time zone. A misconfigured config fails the process, not a rule.
5. **`github.mjs`'s `projectContext()` validates the Project's field *shape* on every read**, including that `Priority` is a **Project custom** field and **not** an organisation-level Issue field. A Project that quietly promotes Priority to an org field fails the job.
6. **`issueSnapshot()` returns `null` for a pull-request number.** Every caller must distinguish "not an Issue" from "read failed", and the distinction is re-checked in `pull-request.mjs` and `policy.test.mjs`.
7. **The audit comment is deleted when the Issue becomes compliant** — and the deletion is asserted by request-URL, not by a mock.
8. **`check-approval.mjs` treats a *draft* as `pending` without reading any review**, and the status is `pending` (not `error`) for a draft.
9. **The weighted-approval status is revoked (`pending`) BEFORE the Python setup step.** Reading the workflow top-to-bottom, the setup looks like it runs first; it does not.
10. **A blocked change request wins over the score.** Two one-point approvals + one `CHANGES_REQUESTED` from a write-capable reviewer = `pending`, even though `points === requiredPoints`.
11. **Delegated points are not forwarded a second hop**, and a delegate can receive points from several senders but only ever their own.
12. **A command comment must occupy the *entire* body.** `> /delegate @writer`, a fenced block, or `/delegate @writer extra` all fail to match; leading/trailing whitespace is allowed.
13. **Editing a delegation command by anyone other than its author is inert**, and the verification uses GraphQL `lastEditedAt` + `editor.id` matched against the REST comment's author `node_id`.
14. **`blame-production.py` requires COMPLETE history** (a shallow clone raises) and refuses a *shallow* blame, and it computes the **merge base** of the live base ref and the exact reviewed head — so base-branch movement after the review does not change the answer.
15. **`blame-production.py` counts a C preprocessor directive as code** and a mixed code+comment line as code; only pure comment and blank lines are excluded.
16. **`benchmarks/support/built-worker.ts` deletes `NODE_OPTIONS` and `TSX_TSCONFIG_PATH` from the child**, and `assertBuiltBenchmarkRuntime` *fails* if a TypeScript loader is present in `process.execArgv`. A benchmark that ran against source instead of `lib/` is a hard error, not a silent wrong number.
17. **The benchmark workers' report is the LAST JSON line of stdout**, so a worker may print progress before it.
18. **`collectHeap()` does `gc(); yield(); gc()`** — one GC is not enough to measure a retained heap.
19. **The `user-text` benchmark alternates the baseline and the credential measurement order** and reports the *minimum* of the pairs, because a fixed order biases the result.
20. **`python/sdk`'s `Session.run()` starts its interval at the *inbox receipt*, not at the prompt call** — a message that is queued but not yet durable is not part of the run.
21. **`python/sdk`'s `close()` escalates**: request → close stdin → wait → terminate → kill, each bounded by `shutdown_timeout_seconds`.
22. **On Windows the Python runtime *waits* rather than `exec`s**, because the Windows CRT `exec` does not replace the process; on POSIX it `execvpe`s.
23. **`python/sdk-runtime`'s download publishes by `rename`**, and an `EEXIST` is tolerated **only** when the existing `complete` marker holds the same 64-hex identity.
24. **`website/build.ts` refuses to delete a symlinked output** — it `unlink`s it instead of traversing it, and it validates the **real path** of the nearest existing ancestor, not just the lexical path.
25. **`website/raw-markdown.ts` uses the `sec-fetch-dest` header, not the URL, to decide ownership** — a script import of a `.md` URL with `?dsh-raw=1` still belongs to Vite.
26. **`website/.vitepress/theme/index.ts` renders the page actions only when `frontmatter.rawMarkdownPath` is a string and the page is not a 404** — a missing `rawMarkdownPath` is not an error there, but `editLink.pattern` *throws* when `editSource` is missing.
27. **The Mermaid clone lives in a shadow root** so the copy's `url(#arrow)` markers and embedded styles cannot resolve against the original diagram. The spec asserts the original SVG's `outerHTML` is unchanged.
28. **`patches/exceljs@4.4.0.patch` switches OOXML dispatch from filenames to relationships** and *throws* on an ambiguous or conflicting part rather than guessing — the same "resolve by the graph, fail on ambiguity" rule the issue-policy engine uses for Issue-vs-PR numbers.

## 5. Weak spots

1. **The issue-policy engine has no reconciler.** Both the README and the code say so: "Lifecycle processing is event-driven, not a reconciler. Omitted events do not repair Project state, and concurrent Project mutations have no atomic compare-and-swap." A dropped webhook leaves a Project status permanently wrong, and the `TODO` at `lifecycle.mjs:107` names the fix ("per-Issue serialization or a conditional ProjectV2 update") without implementing it. This is exactly the shape August Trading's scheduler must avoid.
2. **The benchmark budgets are calibrated against *recorded medians on specific runner models*, and the corrections are visible in the code.** `agent-continuation.bench.ts` says the standard hosted catalog median is 858.364 ms but the historical budget was 800 ms — i.e. the budget had to be *raised* to fit reality, and the test now asserts both the old failure and the new pass. That is honest, but it also means the numbers are **tied to two EPYC runner models** and to a `CI_TIME_SCALE = 2` that is a reviewed constant, not a measurement. A slower runner class would silently fail the gate rather than rescale.
3. **The `benchmarks/` tree is enormous for what it measures** — 48 files, ~250 KB, and the `session-corpus` case alone writes ~1.5 GB of Zstandard logs and takes up to five minutes of CI. The `AGENTS.md` rules are excellent, but the *cost* of the harness is itself unbudgeted: no benchmark measures the benchmark suite.
4. **The weighted-approval delegation protocol is complex enough to need its own escape hatches.** Six distinct rules govern when a delegation is live (authorised edit, newest surviving command, sender's own review reclaiming, recipient dismissal, self-delegation restoring, deletion restoring an older command). The tests are thorough, but the surface area is large for a repository-internal convenience, and the `currentStatusActor` / `lifecycleActor` mechanism in `rules.mjs` has a similar shape: a small set of actors whose identity must be tracked to avoid the bot overwriting a human.
5. **`python/sdk-runtime` distributes five platform wheels with hard-coded platform assumptions** (manylinux 2.28, macOS 14, Windows x64 only) and every change to the supported set is a change to `platforms.json`, `hatch_build.py`, `build-exe-for-python-sdk.yml` and `python-release.yml` — four files that must agree, with no single source of truth for "which platforms exist" beyond the JSON file itself.
6. **The `patches/` tree patches four vendored dependencies with no recorded reason.** `patches/@fortune-sheet__core@1.0.4.patch` and `patches/@yao-pkg__pkg@6.21.0.patch` contain real engineering (read-only spreadsheet mode, atomic SEA addon writes) but the *why* lives only in a code comment inside the diff; there is no note file saying "we patched this because upstream X is wrong and we will re-apply it after the upgrade". After a dependency bump these patches will fail to apply and the reason will have to be re-derived from the diff.
