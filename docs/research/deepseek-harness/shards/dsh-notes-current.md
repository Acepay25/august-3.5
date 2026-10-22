# deepseek-harness :: dsh-notes-current

**Files in shard:** 154 (read: 103, skipped with reason: 51)
**What this shard covers:** the **active** `.agents/notes/` tree of the DeepSeek Harness (DSH) monorepo — the
repository's "Agent Note" system. An Agent Note is the repo's decision-record format: a durable proposal or
decision that records the *why* and *what we gave up*, the parts code cannot carry
(`.agents/notes/README.md:5`). Every note ships as a **triplet**: an English `.md` (the decision record), a
Chinese `.zh.md` that mirrors it section-for-section, and a generated `.i18n.yaml` sidecar holding a per-heading
hash of both sides so a pairing gate can prove they still agree
(`.agents/notes/README.i18n.yaml:1-4`). The shard covers `proposed/` and `rejected/` lifecycles only — the
`implemented/` and `archived/` trees are elsewhere. Substantively the notes cover: session-log architecture and
projections, a domain-KV storage seam, cancellation propagation, the composer/approval chain, structured
"Task Surface" UI, recallable compaction, desktop update policy, Pi extension bridging, and a long tail of
`simplification` and `rejected` proposals that document what was deliberately **not** built.

> **How to read this report.** 154 files is a *set*, not 154 independent documents: every decision appears three
> times (EN / ZH / hash sidecar). The 52 English decision records get full entries below (Tier 1). The 51 Chinese
> counterparts get one line each in the Tier-2 table — the pairing gate proves they mirror the English
> section-for-section, so a line naming the decision is the right granularity for a translation. The 51 generated
> hash sidecars are Tier 3: confirmed by inspection, not read line by line.

---

## 1. File-by-file

### Tier 1 — load-bearing source: full entry

_(This shard contains no `source`-typed files; the tier-1 entries below are the **English Agent Notes**, which are
the load-bearing content of this shard. The Chinese mirrors and the hash sidecars appear in the Tier-2/Tier-3
tables below.)_

---

### `.agents/notes/README.md`
- **Purpose:** the normative spec for the Agent Note system — where notes live, when to write one, and the exact in-file format.
- **Key abstractions:** the two path-encoded axes — *lifecycle* (`proposed/` → `implemented/` → `rejected/`, and a separate frozen `archived/` tree) and *class* (`feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`), a closed set enforced by `scripts/agent-note-tree.ts`. Body skeleton per lifecycle: proposed = `## Problem / ## Proposal / … / ## Alternatives considered / ## Acceptance criteria / ## Risks`; implemented = `## Problem / ## Decision / … / ## Alternatives considered / ## Consequences`; rejected = frozen proposal with the verdict on the `Status:` line.
- **Data flow:** the note IS the record — there is no generator. A machine gate (`pnpm run verify-agent-note-format`, part of `doc-sync`) enforces the header block, the `Status:`↔folder agreement, and the forbidden proposal-era headings in implemented notes.
- **Non-obvious design decisions:**
  - **`## Alternatives considered` is mandatory.** "A decision recorded without what it beat invites re-litigation — the failure Agent Notes exist to prevent" (`README.md:109`). Pre-format notes may carry a literal escape comment `<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->`.
  - **No central `INDEX.md`.** "Do not add a centralized `INDEX.md`: it duplicates path metadata and makes unrelated note changes contend on one generated file" (`README.md:19`). The folder tree *is* the index; browse or search it.
  - **`refactor` is deliberately absent as a class** because it overlaps `simplification`, whose discriminator is "does observable behavior change?" (`README.md:56`).
  - **Archival is a content-preserving move.** Only the `Status:` line and an inserted `Archived: YYYY-MM-DD` line may change; the triplet moves together; `verify-archived-agent-notes` enforces a closed class tree, complete triplets, and an append-only frozen-content manifest.
  - **Consolidation rules are asymmetric.** A feature-addition note may be folded into its own removal note only if the feature is absent from production code, config, schemas, durable/wire formats, migration, and compatibility behavior, and no test exercises it as supported. Removing *one* transport, default, or presentation is only *partial* supersession — keep both notes cross-linked.
  - **The `Status:` value carries no dates or parentheticals.** The filename holds the first-proposed date; git holds the rest.
- **Edge cases & failure handling:** every new note triggers a supersession check (see `AGENTS.md`); links are relative markdown so they survive folder moves and are mechanically checkable; the format gate skips `.zh.md` files (the pairing gate checks them instead).
- **Surprising:** the *implemented* note must be **kept current with what actually shipped** — when code later moves a file or renames a package, the note is updated in the same change (facts only, not the decision). A decision record that drifts from the code is itself a defect.

### `.agents/notes/AGENTS.md`
- **Purpose:** the rules binding for anyone (human or agent) adding a note under `.agents/notes/`.
- **Key abstractions:** "Agent Notes are effectively RFCs written by agents"; follow `../../docs/AGENTS.md` plus the note rules in `README.md`.
- **Data flow:** n/a — a 5-line standing order.
- **Non-obvious design decisions:** **every new Agent Note triggers a supersession check** (`AGENTS.md:5`) — search the active tree for older notes covering the same decision, classify full/partial supersession with the `dsh-archive-agent-notes` skill, and archive every qualifying implemented triplet **in the same PR**. Partial supersessions stay active and cross-linked. Archived files are frozen historical snapshots: never edit them, never treat them as current authority.
- **Edge cases & failure handling:** archive-vs-keep is decided by the calibrated skill, not by word count, age, or a quota (the policy note says so explicitly).
- **Surprising:** the mechanical cost of the system is deliberately low — you edit **one** file, but you must search the tree first.

---

#### `proposed/architecture/` — session, storage, and runtime structure

### `.agents/notes/proposed/architecture/2026-07-19-required-cancellation-through-tool-capability-seams.md`
- **Purpose:** close the transitive hole where a tool body has a required `AbortSignal` but the capability calls it awaits still accept an optional one.
- **Key abstractions:** the "tool-reachable capability seam" set; derived signals linked to an upstream signal for the delegated lifetime; the explicit **detached-ownership handoff** boundary.
- **Data flow:** inventory every first-party `ToolDefinition.execute()` → the capability calls it awaits → change each coherent Service Definition / Service Provider / Consumer seam together (interface, implementation, direct consumer, test helper, example, generated API docs) in one PR.
- **Non-obvious design decisions:**
  - **Required parameters beat lint rules.** "Required interface parameters express the contract where TypeScript can check every caller" (`:35`) — lint cannot identify ownership, derived signals, or correct quiescent settlement.
  - **Ambient async-local cancellation is rejected** because hidden propagation makes ownership and detached handoff unauditable and lets calls bind to the wrong lifetime (`:39`).
  - **Never-abort defaults are rejected** — a default erases the missing owner instead of exposing it at compile time (`:41`).
  - **A single scalar `ToolRunContext` is rejected**: capabilities need cancellation, not tool identity or agent state; passing the bigger context couples services to the tool registry (`:33`).
  - **Detached work is scoped precisely**: once a task/workflow/worker/child agent is published to a new owner, that owner governs the lifetime; but the *start* operation still requires the caller signal until the handoff commits (`:27`).
- **Edge cases & failure handling:** the boundary is explicit — synchronous registry lookups, availability checks, schema rendering and argument classification are excluded; runtime validation is added only at a genuinely untyped boundary, never to restate a typed field.
- **Surprising:** the risks section admits that a required parameter proves *availability*, not *cooperation* — "Mechanical compliance without cooperation" is called out as its own risk (`:63`).

### `.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md`
- **Purpose:** introduce a domain-KV storage capability seam (`ctx.storage`) with two backends, plus a real **workspace entity** — because the host's only persistence surface was the per-session event log.
- **Key abstractions:** `ctx.storage` hub = `BackendRegistry` + data-form mounting (`StorageForms`); a **medium owner** exposing **data-shape facets** (`kv` this phase, `log` later); `DomainSpec` / `defineDomain` / `domainTable`; `DomainFacility.open(spec)`; `KvTable` with `get/entries/keys/put/delete/update`; `StorageError` codes `backend-not-found | form-not-mounted | duplicate-backend | duplicate-mount | version-mismatch | malformed-medium | closed`; `DomainError` codes `already-open | facet-unsupported | invalid-record | missing-key | closed`.
- **Data flow:** domain spec → `kv.open(descriptor)` → `loadAll()` → every record `valueSchema.parse`d → `Domain` built; writes queue on **one promise chain per domain** so `update(key, fn)` is atomic; after each write's durability resolves, emit `domain/changed` (put/deleted discriminated union, no old value).
- **Non-obvious design decisions:**
  - **The backend does not promise write ordering** — "the caller serializes; the backend only guarantees each single call is atomic" (`:49`). Ordering is a domain-layer concern.
  - **Version mismatch fails loud** — `StorageError('version-mismatch')`, "no migration, no rebuild" (`:47`); the data is not regenerable and the repo is pre-release.
  - **JSON backend = memory authoritative, disk is its projection.** Every write = full serialization → temp write + fsync → atomic rename; the file is the current net state in readable JSON ("that legibility is this backend's reason to exist"). SQLite uses document-per-row so a single-key change does not rewrite the whole domain.
  - **Multiple backends stay mounted side by side**; routing is `dsh-domain` config (`{ backend, routes: { workspace: 'sqlite' } }`), never a global either-or.
  - **No "active record"** — no mutable object that auto-persists, because persist timing would be uncontrollable and conflicts with whole-unit atomic rewrite.
  - **Recursive delete is bottom-up** — "a mid-way crash leaves only 'half the subtree deleted, ancestors intact'; re-running the same delete converges, and no dangling parent exists at any moment" (`:190`). Non-recursive delete refuses non-leaves by default.
  - **Workspace key is a uuid, not the path** — normalization rewrites paths, and reference anchors must be stable. Path canon is `fs.realpath`; uniqueness is string equality *after* normalization, so a symlink to the same dir is a collision. Ownership is never derived from cwd (cwd cannot express ordering and would create two sources of truth).
  - **The consistency doctrine** (4 rows): a ledger id with no session on disk is filtered and pruned, not an error; a session whose cwd matches but is not in the ledger is an *orphan* (never auto-adopted); one session in two ledgers is structurally blocked on write and throws at load (hand-edited data is never masked); a missing workspace directory leaves the record and returns `status() === 'missing-dir'`.
- **Edge cases & failure handling:** the JSON backend tolerates a missing file as an empty unit materialized on first write; a malformed header/tables → `malformed-medium`; `close` is idempotent and any operation after close → `closed`; the facility drains in-flight writes during unmount so `domain/changed` still fires while the name is still resolvable.
- **Surprising:** the note explicitly carves a **reuse audit table** distinguishing "pure medium" logic (atomic publish, fsync, permissions, Windows variant — copied by `dsh-storage-json`) from "log shape" and "session semantics" (coordinator, per-id write chain, crash repair — *never* sinks). The proposal refuses to promise an extraction it has not done.

### `.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md`
- **Purpose:** give every domain ONE way to surface log-derived state to the client, and make slash-command outcomes durable.
- **Key abstractions:** `dsh-session-projection` package; `ProjectionDefinition { key, stateSchema, persist?, init(), apply(state,event), wire?, stateVersion }`; `SessionProjectionStateMap` (host fold state) vs `SessionProjectionMap` (client DTO); the `session/projection` mux frame; `useProjection` React seat; two log-only events `command/run` and `command/done`.
- **Data flow:** every committed session event passes through every registered unit's `apply`; an unchanged state reference (`Object.is`) produces no downstream work. The history **tail page** carries `projections: { asOfSeq, values }`; the client keeps one generic per-session value store `key → { value, seq }` updated by push frames.
- **Non-obvious design decisions:**
  - **Whole-value event rule**: "A state-carrying log event MUST carry the complete post-change state, never a bare delta" (`:23`). This buys out-of-order immunity by seq comparison and self-healing (a missed update is corrected by the next).
  - **Higher seq wins** is the single client rule (`:92`) — a replayed baseline cannot roll back a newer frame; a lost frame costs staleness, never wrongness. All the per-domain fences (plan's three-layer fence, goal's write-revision fence) dissolve into this one rule.
  - **The host is the only computation site.** Clients never fold domain events; a domain ships projection support with **zero client code**.
  - **No new RPC.** "Every moment the client needs a fresh baseline (open, reconnect resync, gap repair) already pulls the tail page, and the only path that never needs one (loadOlder) is the only path that passes `beforeSeq`" — so the client has no independent refetch decision at all (`:77`).
  - **`asOfSeq` is the last event's seq** (`session.seq - 1`; `-1` for an empty log), so a first post-baseline frame always compares strictly greater.
  - **State is always computed, never logged** — the log holds events; the unit's state lives in a per-session watermark cache `{state, observedSeq}` and later in a persisted cache of `(sessionId, key, ver, seq, val)`. "A row is never wrong, only possibly stale — its `seq` says exactly how stale."
  - **Command lifecycle in the log** — `command/run {commandId, name, args?, source}` before the handler and `command/done {commandId, kind, text?}` at settlement, model-invisible, presentation never enters the log. `command.execute` degrades to **admission** (`{ matched, commandId? }`).
  - **Plan mode as the worked example**: the user's *request* is logged as a `command/run`, so "pending" becomes a pure replay quantity — host restarts recover it, other tabs fold the same events (cross-tab pending for free).
- **Edge cases & failure handling:** registration is an effect — an unloaded plugin's key simply disappears and the client reads it as capability absence ("HMR semantics for free"); duplicate keys throw; a unit never throws (absence is the signal); live registry churn is an accepted dev-only staleness window.
- **Surprising:** the note names the exact anti-pattern it kills — "the same fold written twice, evolving separately" — and the note's own delivery plan re-targets three in-flight PRs onto the new base.

### `.agents/notes/proposed/architecture/2026-07-28-storage-root-and-derived-medium-recovery.md`
- **Purpose:** fix two gaps the projection cache exposed on the domain-KV stack — where the files actually live, and what happens when the medium is damaged.
- **Key abstractions:** `recovery?: 'reject' | 'reset'` on `DomainSpec`; `KvFacet.destroy(descriptor)`; the closed damage-class list.
- **Data flow:** the Web overlay now anchors `storage-json.root` to `$DSH_HOME/storages` via `dshHomePath('storages')` (same `!!js` expression the session root uses); the JSON backend still needs to resolve its configured root **once at construction** so a later `process.cwd()` change cannot split one backend across roots.
- **Non-obvious design decisions:**
  - **Authority is a per-domain declaration, not a global behavior.** `workspace.json` is authoritative (fail loud is correct); `session_projcache.json` is derived (rebuild from logs). "The missing concept is a per-domain declaration of authority" (`:17`).
  - **Reset fires only on the three deterministic parse-time codes** (`version-mismatch`, `malformed-medium`, `invalid-record`). ENOENT is already "empty unit"; every I/O error (EACCES, EIO) propagates loudly. "Auto-delete on a misclassified error destroys a healthy file" is the named risk.
  - **The retry is single-shot** — a second failure propagates, so a persistently failing medium cannot loop.
  - **Delete, not rename-aside**, for a derived medium's damaged bytes: "the logs are the source of truth" and litter accumulates unbounded. Rename-aside remains correct if a future *authoritative* domain wants reset semantics.
  - **Per-row config beats a launcher patch + profile key** (user decision); per-row overrides ride the personal `~/.dsh/config.yaml` patch layer.
- **Edge cases & failure handling:** the note is explicit that the cache's own stated stance ("a stale or unreadable cache costs a longer tail replay, never a wrong value") was an aspiration, not the implementation — a truncated cache file could brick the whole boot.
- **Surprising:** the note admits its own proposal is **partially superseded** (the per-session cache files note removed the global cache domain) and says so inline rather than leaving a stale proposal.

### `.agents/notes/proposed/architecture/2026-07-29-durable-last-activity-index.md`
- **Purpose:** make "when did the user last prompt here" exact for cold (unattached) sessions, instead of approximated by artifact mtime or a fail-soft cache.
- **Key abstractions:** `SessionSummary.updatedAt`; the event predicate `user/message` with `source.kind === 'user'`; the session index as the storage location.
- **Data flow:** the coordinator computes the value (it sees every append); backends persist it; `summarizeCold()` serves it without opening the log or depending on a cache checkpoint.
- **Non-obvious design decisions:**
  - **mtime answers a different question.** Every durable write refreshes it — including a truncate-repair of a torn tail, synthetic closers that balance an interrupted turn, and the `session/end-seed` boundary appended during pickup. "That approximation promoted a Session merely because it was opened."
  - **A per-append header field would violate an asserted durability invariant** (`jsonl.spec.ts` pins that committed bytes are never rewritten), not merely complicate the writer. So the JSONL shape to compare against is a **per-session sidecar**.
  - **The note deliberately leaves three questions open** (`:23`): who owns the shared predicate, how pre-field logs behave, and whether a JSONL sidecar is acceptable at all (it "reintroduces a second file per session that can disagree with the log").
- **Edge cases & failure handling:** the failure mode is conservative — a missing/delayed cache row makes a recently prompted session sort *too old*, never too new.
- **Surprising:** the note's own Risks section says the honest answer might be "keep the cache fallback", in which case "this note's outcome may be documenting that decision rather than implementing a field."

### `.agents/notes/proposed/architecture/2026-08-08-semantic-composer-chain-phases.md`
- **Purpose:** fix a composer-election bug where a read-only subagent composer (priority `-10`) could win over a pending question (`0`) or approval (`1`).
- **Key abstractions:** an ordered **phase tuple** per chain (`conversation.composer` declares `['interaction', 'restriction']`); `SlotMap` (compile-time) vs `SlotSpec` (runtime sorting authority).
- **Data flow:** `SlotCore` sorts by declared phase index, then local `priority`, then stable registration order. Registration fails immediately when a phased-chain entry omits its phase or names one outside the declaration; unphased chains keep numeric behaviour.
- **Non-obvious design decisions:**
  - **The defect is not one wrong number** — "The chain currently uses the same scalar for two different decisions: whether a candidate resolves an existing interaction or restricts starting new work, and the local preference between candidates of the same semantic kind" (`:11`). A numeric repair would preserve the coupling and let the next registrant recreate the bug.
  - **The domain rule is precise**: "an interaction resolves a live Host wait that already exists; a restriction prevents the user from initiating work through the ordinary composer."
  - **Phase vocabulary belongs to the declaring slot**, not to the slot framework — other chains acquire no composer terminology and need no migration.
  - **The exact phase tuple is repeated in the runtime declaration specifically to make drift mechanically rejectable** (a conditional type field could otherwise compile in one face and fail at runtime).
- **Edge cases & failure handling:** disposal, HMR re-registration and reconnect replay must not leave a stale elected phase — election stays a pure function of current owner props and current registrations.
- **Surprising:** the acceptance criteria require that the browser-only change produces **no token cost and no KV-cache invalidation** — the model request header is compared before and after.

### `.agents/notes/proposed/architecture/2026-09-06-logical-session-storage-rebuild.md`
- **Purpose:** decouple the *logical* session from every physical implementation, in stacked stages, without changing observable behaviour.
- **Key abstractions:** `LogicalSession` (abstract: header, inheritedEventCount, firstLiveSeq, seq, surface, append, eventAt, snapshotEvents, ownEvents, requestHeader, requestContext, deriveMessages) + `SessionService` (create/open/enter/announce/get/list/fork/flush/registerProjectionPort) + `SessionStorage` (the private physical provider protocol).
- **Data flow:** consumers → `LogicalSession`; `SessionService` selects and coordinates the physical provider; each provider depends inward on the protocol it implements. A mermaid dependency diagram in the capability-protocols note makes the direction explicit.
- **Non-obvious design decisions:**
  - **Five substages, each with one claim** (1.1 model → 1.2 interface + switchable gate → 1.3 detached factories → 1.4 consumer migration → 1.5 tests + compatibility) so each review has a single claim.
  - **A switchable enforcement gate.** `verify-logical-session-access` reports production bindings of the concrete `Session` class; the checked-in default is `warn` (prints findings, emits GitHub `::warning` annotations, exits 0) so in-flight branches merge while they migrate; `DSH_LOGICAL_SESSION_ACCESS=enforce` flips it for one run (`:94`).
  - **The Stage-1 invariant list is explicit**: `append` stays synchronous (validate → contiguous seq → freeze → contain observer failures after commit); `session/created` remains a synchronous publication veto; the store returns *the same object* it registered ("No wrapper may replace that identity"); detached construction never enters the live registry; JSONL bytes, format versions, migrations, crash repair, batching and writer-lease behaviour are unchanged.
  - **Ownership table**: `LogicalSession` owns one session's log/header/projections/lifecycle; `SessionService` owns construction, publication, enumeration, fork, flush, disposal; a `SessionStorage` provider owns bytes/revisions/layout/migration/repair/batching/lease; `SessionQuery` owns exact reads, filters, traces, full text, stats.
- **Edge cases & failure handling:** the Risks section names the classic abstraction failure — "A thin abstraction can preserve type safety while hiding lifecycle gaps"; alternate logical-session implementations cannot participate until `SessionService` owns publication and attachment, and a synchronous disposer must not start an unowned asynchronous close.
- **Surprising:** the proposal is explicitly *staged*, and each later stage names its own **required compatibility boundary** (event order, seed persistence, close timing; stored bytes, revisions, migrations, leases; writer/listener failure precedence; fork identity and publication interleave).

### `.agents/notes/proposed/architecture/2026-09-10-session-capability-protocols.md`
- **Purpose:** the target protocol layer for the session system — five orthogonal capabilities plus a dependency rule.
- **Key abstractions:** `LogicalSession`; `SessionService`; `SessionStorage`; `SessionProjectionPort`; `SessionQuery`.
- **Data flow:** a mermaid flowchart shows Consumers → Service → Logical → Projection, Service → Storage, Query → Service/Projection, and Composition → (Session | Storage | Query) providers.
- **Non-obvious design decisions:**
  - **Keeping the legacy `Session` name does not make implementations replaceable** — the Problem statement says so outright: if storage/query/projection/frontend assume the concrete class, JSONL paths, or a concrete index schema, "physical implementation still leaks across the system."
  - **Only composition sees both abstractions and concrete providers.** "Reverse imports and provider-name branches are forbidden." A dependency gate enforces the concrete-`Session` half of this inside production sources.
  - **`SessionProjectionPort` is not a second Session and never owns writes**; every projection can rebuild from the durable log.
  - **No `SessionSearch` and no `SessionStats`** — `SessionQuery` already covers exact reads, filters, traces, full text, list metadata and statistics; two more public services would split the entry point.
  - **Detached factories are for detached work only**: "Product features must not use detached factories to bypass service lifecycle."
  - **The developer-convention section is a migration contract**, not prose: repository production code types sessions as `LogicalSession`; external integrations may keep the deprecated `Session` temporarily; new code must not add a `Session` import "merely because compatibility exists."
- **Edge cases & failure handling:** the note admits the signatures are *targets* and "not all implemented in Stage 3", and says "this note must not present unshipped behavior as current."
- **Surprising:** the note is careful about a subtle failure — a remote session implementation may expose real limits in *synchronous* `append` and lifecycle substitution, and the note says the evidence should then revise the protocol.

### `.agents/notes/proposed/architecture/2026-09-10-session-data-compatibility.md`
- **Purpose:** promise users that old conversations still open after the refactor — no disk-byte change, no manual session moves.
- **Key abstractions:** `SESSION_FORMAT_VERSION` as writer authority; the released v0→v1→v2→v3 catalog and its dedicated V2→V3 stage.
- **Data flow:** a current runtime opens released older formats through the catalog and publishes a new current generation; old committed generations are retained for inspection and recovery.
- **Non-obvious design decisions:**
  - **Do not overwrite old generations or auto-downgrade.** "A current runtime can open released older formats through the catalog; an older runtime is not promised to read V3."
  - **"V3" is overloaded** and the note refuses the ambiguity: Session V3 (the durable log format) is *not* a projection-cache version. "Treat every component version named V3 as Session V3" is rejected.
  - **Stages 1–3 change code ownership only** — ordinary users need no migration step and no configuration change. Large logs use streaming stages to avoid whole-artifact memory peaks.
  - **Derived data is rebuildable and cannot become recovery authority** — query indexes and caches regenerate; users do not migrate them.
- **Edge cases & failure handling:** "If open fails, preserve the full session generation and error text instead of deleting old files"; future providers must distinguish unsupported-future-version, corruption, ownership conflict, and migration failure.
- **Surprising:** the note separates **native V3 validation** and **incoming historical migration** into two responsibilities — a distinction most format work collapses.

### `.agents/notes/proposed/architecture/2026-09-10-session-developer-transition.md`
- **Purpose:** tell contributors, per branch stage, what API is legitimate to write code against.
- **Key abstractions:** one mental model — obtain `LogicalSession` through `SessionService`, use its members for the logical session, let only providers and composition know the physical implementation.
- **Data flow:** a **stage → development rule** table (current master → after Stage 1 → after Stage 2 → after Stage 3 → after Stages 4–5 → long term) plus a "common operation migrations" pseudocode block (Types, Create/open, Live lookup/list, Identity/header, Events, Model-visible history, Write, Projection, Titles/statistics, Fork, Durability).
- **Non-obvious design decisions:**
  - **Stage-scoped rules, not one rule.** "Do not edit an earlier stage after reading only the final stage diff."
  - **Docs and tests must label current / completed-stage / target / compatibility behaviour** — "They do not present draft PRs as released."
  - **New providers must register explicitly at composition**; core code does not branch on provider names or scan packages.
  - **A contributor-start recipe**: read the overview → protocols + current subsystem docs → progress in stage order → pick **one migration with an explicit caller** → record current/target/gap/next-removal-condition/branch-commit at handoff.
- **Edge cases & failure handling:** different stack layers expose different APIs — a contributor must not backport Stage-3 APIs into a lower stage; `LogicalSession` must not absorb search, statistics or I/O and become a new large object.
- **Surprising:** the note bans "Keep old names permanently" — dual entry points would permanently split docs and types.

### `.agents/notes/proposed/architecture/2026-09-10-session-refactor-faq.md`
- **Purpose:** short answers that distinguish temporary naming, long-term responsibility, and current stack state.
- **Key abstractions:** eight Q&A sections — why `LogicalSession`; is concrete `Session` forbidden immediately; service vs storage; where projection fits; why no `SessionSearch`/`SessionStats`; must users migrate; what is complete; how to contribute.
- **Data flow:** each answer links to one normative owner instead of copying protocols.
- **Non-obvious design decisions:**
  - **`LogicalSession` is a *transitional* name.** It avoids a collision with the existing concrete class during migration; "After compatibility removal, maintainers can debate renaming `LogicalSession` back to `Session`."
  - **`SessionRuntime` was rejected as a name** because the repo's naming table reserves `Runtime` for a component that runs live work and owns dispatch/cancellation/operation lifecycle — the interface holds one session's identity and log and runs nothing.
  - **The FAQ is not put inside the protocol document** — quick naming answers would obscure protocol obligations.
- **Edge cases & failure handling:** "The FAQ can become stale as the stack advances. Every stage that updates overview status must review this page."
- **Surprising:** the note is explicit that drafts exist for the first three stages but **Stages 4–5 and in-memory provider extraction are not complete** — a rare piece of public honesty about partial state.

### `.agents/notes/proposed/architecture/2026-09-14-composer-model-and-draft-editor.md`
- **Purpose:** let one Session's draft and pending attachments be edited from multiple views, without the Session Controller understanding carets, IME or DOM.
- **Key abstractions:** `DraftEditor` (draft-editing area only) vs `Composer` (writing area incl. attachments and submit); the split into `input/editor/runtime.ts`, `input/editor/DraftEditor.tsx`, `input/editor/view-binding.ts`, `contract/draft-editor.ts`, `ui-attachment/.../drop-events.ts`.
- **Data flow:** two independent PRs. Stage one is **mechanical extraction only** (five extractions, no behaviour change); stage two implements the shared draft and multiple editors.
- **Non-obvious design decisions:**
  - **The two-stage rule is the whole point.** Stage two "must not move existing files or directories, perform pure renames or helper/class/component extractions, reorder existing tests, or clean up formatting". "Copying old code into a new file and deleting its original does not evade this restriction."
  - **A table of what isolation stage one does NOT achieve** — independent editors within one Session, independent selection/IME/Undo origins, and multi-view picker/focus/drop routing are all explicitly *not* implemented by stage one (`:51`).
  - **Shared content is semantic, not Lexical**: draft content represents text, newlines and atomic references with complete `ReferenceInsert` info independent of Lexical; shared reference identity must not depend on one editor's NodeKey (each instance maps privately).
  - **Keeping the system prompt byte-identical** is what preserves the provider prefix cache over inherited history (from the sibling side-session note).
  - **Undo/Redo must operate on one logical draft** — "rather than letting two Lexical histories restore stale whole documents over each other."
  - **Programmatic insertion / focus restoration need the initiating view's temporary identity**; closing that view must not redirect late UI actions into another view of the same Session.
- **Edge cases & failure handling:** IME preedit belongs to the local instance and another view's edits must not disrupt text under composition; stale-revision callbacks from a prior model lifetime or unmounted view must not overwrite current content.
- **Surprising:** even stateless JSX extraction can alter ref/effect timing — the note keeps hooks and refs in their host and adds no DOM wrapper.

### `.agents/notes/proposed/architecture/2026-09-20-unified-typert-remote-metadata.md`
- **Purpose:** deliver method descriptions, named-input parsers, tool JSON Schemas and result metadata to CLI help, MCP discovery and typed consumers — without runtime TypeScript analysis or a live Host.
- **Key abstractions:** Host `./typert` (`TYPERT`), Host-for-consumer `./remote` (`TYPERT_REMOTE`), Client `./client/typert`; `TypertRemoteInfo`; `TypertRemoteMethodSpec`; `TypertRemoteValue<Input>` with `input(options?: { strict?: boolean })`.
- **Data flow:** the emitter writes one static spec per endpoint; `createTypertRemoteInfo({package, methods}, z)` returns a lazy class instance; the first `descriptors`/`methods` read builds and caches one shared index; `methods[endpoint]` aliases the exact descriptor object.
- **Non-obvious design decisions:**
  - **Ordinary artifacts, not committed generated source.** "Separate Host and Client Programs require generated cross-face declarations, not committed generated source. An explicit prebuild is acceptable when exact schemas are needed."
  - **Input strictness is consumer-owned.** `{ strict: true }` recursively rejects undeclared fields; `{ strict: false }` (the default) accepts and strips them. Both named-argument envelopes reject extra arguments; explicit JSON and dictionary keys stay open. Host dispatch behaviour is unchanged.
  - **A withdrawn strict descriptor must refuse invocation rather than downgrade to fallback** — "Once a strict local descriptor has been observed, its withdrawal must refuse invocation rather than downgrade to fallback."
  - **Optional projections fail independently.** Each unsupported input variant or result projection records its own `jsonSchemaError` while preserving parsers; "only the dedicated projection error is caught." Native `dsh-tools` registration additionally requires `output.schema` — a parser alone does not satisfy it.
  - **The pure protocol leaf has no runtime module dependencies** (only Zod type imports); the protocol root re-exports the factory and imports Cordis without adding Zod to every consumer's static module graph.
- **Edge cases & failure handling:** "Imports and metadata/schema access never invoke the network"; `hasSeen()` does not protect an endpoint before its first registration; a Host requiring strict validation must await local registration before serving calls.
- **Surprising:** the note replaces a *previously shipped* delivery mechanism (`emitSourceDef` + committed `./remote-source` + freshness rules) — "This note replaces that delivery mechanism."

### `.agents/notes/proposed/architecture/2026-09-29-session-migration-follow-redirect.md`
- **Purpose:** show a real migration phase while a historical session's format conversion runs, without contaminating the model log.
- **Key abstractions:** a typed business redirect (a "302" that is *not* an HTTP redirect and accepts no arbitrary URL) returned from a single-session history `page`/`follow`; the migration reference the client then follows.
- **Data flow:** page/follow returns a migration reference → the Client follows that migration for its current phase and subsequent progress → on success it returns to the original history read; a valid snapshot then establishes history readiness.
- **Non-obvious design decisions:**
  - **Progress must not enter the Session log nor `session.control`** for this flow — putting progress in history events "would contaminate the model log and change journal sequence semantics."
  - **Migration ownership stays with the persistence-preparation owner**; multiple waiters share the work and a late joiner receives the current state immediately; closing one view releases only its waiter.
  - **Only recoverable history reads are covered.** "Commands with committed effects cannot be replayed safely" — so there is deliberately no general command-retry platform.
- **Edge cases & failure handling:** "Unknown totals produce no fabricated percentages"; failure keeps its cause and a retry action, with no automatic retry loop; cancellation never rolls back a published generation.
- **Surprising:** the note flags an **open completion milestone**: read-open currently produces validated in-memory history while write-open encodes, verifies and publishes a generation — the redirect must choose which one it waits for, and the implementation may not use an ambiguous "done" state for both.

### `.agents/notes/proposed/architecture/2026-10-09-cordis-cleanup-dependency-lifetimes.md`
- **Purpose:** fix a lifecycle violation class — a disposer awaiting its consumers while a *sibling* disposer has already removed the listener or closed the resource those consumers need.
- **Key abstractions:** the cleanup-dependency rule ("Make each required resource's owner retain it through the consumers' complete asynchronous cleanup", `:15`); five P0 findings, each with named owners, evidence and a correction.
- **Data flow:** the findings trace real production paths: Session persistence dropping events emitted during cleanup; Storage closing before Schedule commits accepted delivery; Authorization losing an observed credential commit (`NOT_COMMITTED` after a *successful* write); SSH disabling cleanup requests before dependent process cleanup finishes; the Windows sandbox releasing temporary process resources during consumer cleanup.
- **Non-obvious design decisions:**
  - **"Awaiting a provider's final disposal promise therefore does not establish resource survival."** Cordis starts sibling disposers concurrently (`Fiber._unload`); `ReflectService.provide` waits for dependent fibers only inside its own disposer; service injection cannot prevent sibling resource closure.
  - **Injection order and reverse disposer order are both rejected** — "reverse invocation still starts sibling async cleanup concurrently."
  - **Crash repair is not a substitute for graceful completion**: "Suppressing errors cannot recover an unrouted result or a failed task commit, and can report a successful credential write as failed."
  - **Explicit composition, not global serialization**: serializing every disposer "would change unrelated lifetimes, risk dependency deadlocks, and obscure which operations require each resource."
- **Edge cases & failure handling:** acceptance criteria demand a **controlled-promise regression** per finding — pause the real consumer before its last dependency use, start provider disposal, release the pause, await both — and compare *live vs restored history*, not merely that `close()` ran.
- **Surprising:** the note is honest that the experiments reproduce the *mechanism* ("This establishes provider release timing; the concrete PTC dependency is source-traced") and that native Windows restricted-token access was never exercised. It also records what was **excluded** from the audit, so a future reader knows the boundaries.

---

#### `proposed/feature/` — user- and model-facing capability

### `.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.md`
- **Purpose:** design a faithful bridge for Claude Code's `PreToolUse.updatedInput` without letting a hook mutate a protected tool execution.
- **Key abstractions:** the "**three readers of pre-execution arguments**" (`:11`) — `assistant/message` (model history), `tool/call` (durable audit), and human-facing presentation (`presentCall`/`presentResult`, and `dsh-tool-bash` deriving card title/rawInput/cwd/terminal-vs-background from them).
- **Data flow:** the effective value must be chosen **before** the registry constructs its immutable `ToolExecution`, and reflected in all three readers atomically; then the ordinary allow/deny/ask and tool pipeline runs unchanged.
- **Non-obvious design decisions:**
  - **A rewrite is a pre-identity consistency transaction.** The registry structured-clones and deep-freezes `arguments` and makes execution identity non-writable; "The rewrite design must preserve that protected-identity boundary rather than weaken it."
  - **The original arguments are kept in a sidecar field on `tool/call`** — "a hook changed the call, and both the original and the effective arguments are facts worth keeping."
  - **Extending `PreToolDecision` at its current firing point is insufficient** — both durable records already exist by then.
  - **The bridge degrades honestly in the meantime**: until the transaction exists, the CC/Codex bridge "logs and warns about `updatedInput` rather than claiming it was honored," anchored by a `TODO(pre-tool-input-rewrite)` at the dispatch site.
- **Edge cases & failure handling:** the Risks section flags the genuinely unsettled question — whether rewriting the `assistant/message` tool-call block corrupts any provider's expectation on replay. "Whether any provider rejects that on replay is the open question that must be settled empirically before the decision shape freezes."
- **Surprising:** the note refuses the tempting local fix ("mutate `exec.arguments`") precisely because it would leave model history, audit and presentation inconsistent — the failure would show the UI running a different command than the one executed.

### `.agents/notes/proposed/feature/2026-07-06-recallable-compaction.md`
- **Purpose:** make compaction reversible to the model, and make the request prefix cache-friendly.
- **Key abstractions:** **frozen index checkpoints** (immutable "index stubs", ~100–200 tokens each, with a code-composed footer `[checkpoint c<summarySeq>: shadows conversation span #<start>–#<end>; originals retrievable via history_read]`) vs **one mutable state checkpoint** (the model's working memory); the `dsh-compact-recallable` backend on the existing `ctx.compaction` seam; two model-facing tools `history_read(checkpoint, offset?)` and `history_search(query, checkpoint?, limit?)`.
- **Data flow:** stale history is chunked deterministically (`chunkTokens`, tool-pairing-balanced edges, turn boundaries); chunks are compacted concurrently and buffered off-surface; regions then commit **strictly left to right**, chunks first and the trailing slice last, so the state checkpoint lands after every stub. The prefix after a pass is `[system][stubs…][state][tail]`.
- **Non-obvious design decisions:**
  - **Split the checkpoint because one artifact was playing two conflicting roles.** "An *index* wants to be frozen, chronological, and cheap; the model's *working memory* wants a global view, re-prioritization, and mutability. A single summary can be neither well."
  - **Pointers are code-composed, never model-written** — "pointers must be exact; deterministic assembly is." The model never writes the footer; the summarizer writes only the two or three narrative lines and the keyword anchor line.
  - **A committed stub is never rewritten and never re-enters a later compaction region.** Stubs are byte-stable across passes, so the prompt-cache miss begins at the token replacing the previous state checkpoint instead of at position zero.
  - **The inflation guard**: "if the post-compaction size is not strictly below the pre-compaction size, nothing commits and the turn proceeds" (`:33`) — one metric on both sides, provider-reported usage falling back to the character estimator.
  - **A slice that is recalled content is stubbed by code alone** (a pointer line, no LLM call); a failed stub call degrades the same way, making the state rewrite the only hard LLM dependency in a pass.
  - **Recall stays a pure function of the log.** No sidecar index, no FTS, no embeddings — "an LLM or embedding call there breaks keyless replay determinism."
  - **The superseded state checkpoint folds into the next pass as ordinary history**: no tombstone, no new primitive. `history_read` renders it labelled `[prior state checkpoint]`, so it stays reachable through the two-hop chain.
- **Edge cases & failure handling:** a crash in the summarize phase commits nothing; a crash mid-commit leaves a left-to-right prefix, and the resumed pass reads its merge base from the log's latest state-class `compaction/summary` event and commits the remaining regions **unconditionally** — "restoring `[stubs…][state][tail]` outranks shrinking." A legacy session's existing head checkpoint is adopted as state-class.
- **Surprising:** the note is unusually candid that **recall is a learned behaviour** — untrained models will under-use the tool, so the bench report tracks the gap until training closes it. It also names its own cost (per-pass summarize input ≈ 2× baseline) and says the design "pays off with session length."

### `.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.md`
- **Purpose:** let a user explore a question from a live session without changing its main context, and record the conclusion in the parent.
- **Key abstractions:** the **side session** — an ordinary live session forked at the source's last completed turn, attached to its own agent, framed as a read-only advisor, able to merge back one condensed note.
- **Data flow:** fork with the parent's balanced completed-turn prefix + `parentSession` + `meta.isSeeded: true` + the exact sibling `inheritedEventCount` → inject one plugin-sourced `context/message` advisor framing → ask the child for a length-capped handback → inject one plugin-sourced `context/message` into the parent (source `plugin: sidechat`).
- **Non-obvious design decisions:**
  - **Advisor framing is a message, not a system-prompt change** — "Keeping the system prompt byte-identical preserves the provider prefix cache over inherited history." Changing the prompt would invalidate the cache from token zero.
  - **Merge-back needs no new session event** — a sourced `context/message` already records content, producer and replay input durably; "A dedicated event is justified only by a client that needs distinct rendering."
  - **The subagent seam is explicitly rejected** — side sessions are user-driven, client-visible and may outlive a parent turn; subagents are model-driven runs returning one tool result.
- **Edge cases & failure handling:** read-only behaviour is advisory until a `tools/pre-execute` deny gate enforces it; a compacted source forks its compacted view, so a bound UI should disclose that the child inherits summaries rather than replaced turns; repeated handbacks consume parent context (bounded by a per-merge length cap).
- **Surprising:** the fork carries the *exact* `inheritedEventCount`, so the child's inherited-event cut is identical to the parent's — the reference is a number in the log, not a recomputation.

### `.agents/notes/proposed/feature/2026-08-04-task-surface.md`
- **Purpose:** let the model ask the Web client to render a **bounded, replayable structured form** — without adding a permanent product component per task shape and without generating executable client code.
- **Key abstractions:** `TaskSurfaceModelV1` (JSON: `title`, `description?`, `sections[]`, `fields?`, `submit.label`); block kinds `markdown | metrics | table | diff | notice`; field kinds `text | choice | multi-choice | toggle | order`; `TaskSurfaceId` / `TaskSurfaceSubmissionId` / `TaskSurfaceDismissalId` (branded); `TaskSurfacePresentationMeta { kind: 'dsh/task-surface', version: 1, surfaceId, model }`; the `show_task_surface` tool; `TaskSurfaceDock` (the only actionable mount) and a keyed read-only transcript row.
- **Data flow:** the Host parses and normalizes the model, rejects the call if the session already has an open surface, mints a `surfaceId`, and returns canonical `{ surfaceId, model }`; `presentationMeta` persists `value.model` so the projector and executor cannot disagree about normalization; the tool then calls `exec.concludeTurn()` (`:82`). On submit, the Host revalidates values against the persisted model and admits a **user-role message** carrying a `TaskSurfaceCorrelation`; a matching durable `user/message` closes the projection.
- **Non-obvious design decisions:**
  - **The model owns copy, data and component choice; the product owns validation, placement, interaction mechanics and submission.** "Product code should define one admitted component vocabulary and placement policy."
  - **The durable artifact is the user's conclusion, not the panel.** Submitted values live in the accepted user message; unsubmitted drafts stay in a bounded per-session browser store that never enters the log, prompt or long-term memory.
  - **The Dock is independent of transcript pagination**, so an active surface stays actionable even when its `ToolResultNode` is outside the loaded history window; the transcript row is strictly read-only so one surface cannot acquire two draft/submission owners.
  - **Version 1 deliberately omits** conditional fields, client-side data fetching, charts, uploads and arbitrary event handlers — "A new block or field kind is a protocol change with a parser, renderer, accessibility behavior, fallback, and replay fixture in the same change."
  - **`MarkdownText` gains a `remoteImages: 'render' | 'alt-only'` policy**, and Task Surface always passes `alt-only` — image syntax renders as alt text, raw HTML and embedded media are omitted, and no model-supplied URL is dereferenced without explicit user activation.
  - **Transactional submission at the client boundary**: acceptance returns the exact `messageId` in phase `queued`; the Dock disables mutation through `queued` and `claiming`; double clicks and transport retries reuse `submissionId` and return the first result; another submission ID gets `submission-pending`.
  - **`session.updateQueue` rejects `edit` and `steer`** for a Task-Surface row (editing would separate formatted content from its structured values; steering would persist a message that does not satisfy the submission lifecycle); `remove` is allowed only while queued.
  - **Tool identity is preserved by omission** — the tool definition omits `isConcurrencySafe`, so under the existing registry contract every call is an exclusive ordering barrier without introducing a new `ToolDefinition` field.
- **Edge cases & failure handling:** the service holds one single-flight pending record until commit or discard; every admission exit must produce either the matching `user/message` or an explicit discard, "otherwise a reconnect could retain a disabled Dock indefinitely." Unsupported versions, malformed metadata and absent client capability fall back to readable tool-result content.
- **Surprising:** the pending record is **process-local coordination state, not a second durable authority** — after a Host restart an uncommitted claim is absent and the still-open logged surface becomes editable again.

### `.agents/notes/proposed/feature/2026-09-08-desktop-mandatory-update-api.md`
- **Purpose:** a self-contained guest-accessible policy protocol so Desktop can be forced to update even when its business server is local and the user is not signed in.
- **Key abstractions:** `GET /api/v0/check_client_update`; required headers `x-client-platform | x-client-version | x-client-bundle-id | x-client-locale | x-client-timezone-offset | x-client-arch | x-client-update-channel | x-client-bundled-dsh-version`; body code `40005` for mandatory, `code: 0` for no-force.
- **Data flow:** the server evaluates current client conditions on every query; the response carries `data.show_content.{title,detail}` and `data.desktop_app_link`.
- **Non-obvious design decisions:**
  - **The query must return the complete mandatory response** — "do not rely on intercepting unrelated business APIs."
  - **Desktop gets mandatory policy only** — not ordinary-update prompts, installer metadata, updater target versions, device IDs, installation IDs, or per-installation rollout assignments. Artifact discovery stays in the updater.
  - **`40005` is a response-body code, not an HTTP status**, and the client performs no additional mandatory-target version check from this API.
  - **Query parameters cannot change the decision.** "Changing or omitting either query must not change the decision for otherwise identical client conditions." `region` is sent only when trustworthy.
  - **Service failures must not masquerade as success** — "because success may remove an existing block."
  - **SemVer matching, not lexical sorting**, with truncated prerelease values forbidden.
  - **No revoked-version list, no pre-install artifact-revocation query**: "The mandatory API decides whether upgrading is required, not which updater artifact to install or invalidate."
  - **`Cache-Control: no-store`** preferred; a gateway must not share responses across client versions/platforms/architectures/channels based only on URL.
- **Edge cases & failure handling:** a required header may still carry an empty value (as `x-client-bundle-id` does); invalid SemVer and unsupported platform/arch/channel combos return explicit parameter errors, not no-force success.
- **Surprising:** the policy *publication* ordering is specified — "Publish and verify a higher release that resolves the mandatory requirement **before** enabling its policy", and clients with in-app mandatory updating must get the resolving version in their updater feed first.

### `.agents/notes/proposed/feature/2026-09-08-desktop-update-extensions.md`
- **Purpose:** hold the *deferred* desktop update capabilities (independent revisions, channel switching, auto-install, next-launch install) apart from the initial release.
- **Key abstractions:** the reserved `.dsk.N` version form with full SemVer ordering `0.1.3-rc.2 < 0.1.3-rc.2.dsk.1 < 0.1.3-rc.2.dsk.2 < 0.1.3-rc.3`; the `Stable | Nightly` feed table; the automatic-installation setting matrix; the updater-dependency qualification table.
- **Data flow:** each candidate is described with the behaviour it would imply and the platform qualification it would need.
- **Non-obvious design decisions:**
  - **`0.1.3-dsk.1` must NOT be used to patch a stable `0.1.3`** — SemVer orders it *below* the stable release. Stable fixes need a higher shared version such as `0.1.4`. Independent prerelease revisions are "an exceptional release path, not a routine per-build counter."
  - **Never infer the channel from the installed version** — persist the user's selection; preserve `allowDowngrade = false`.
  - **Next-launch installation targets a complete process launch**, not reopening a window or reloading the renderer; a cached ZIP is not proof of completed native preparation.
  - **Never simulate native staging cancellation** by deleting staging directories; "Native installer handoff may prevent cancellation or retargeting."
  - **Only one effective download/install target is owned at a time**; "temporary files do not promise an older installable fallback."
- **Edge cases & failure handling:** "A channel change does not clear mandatory blocking without a valid policy response for the new conditions"; "A fresh no-force response can clear the UI block but does not select, replace, or invalidate an updater package."
- **Surprising:** the qualification table is honest that **none of it has been exercised locally** — "this proposal does not claim they have been exercised locally", and "none is a verified product capability merely because it appears in this proposal."

### `.agents/notes/proposed/feature/2026-09-08-desktop-update-policy-and-installation.md`
- **Purpose:** the outstanding release/backend/CDN/product decisions for desktop updates, split explicitly from the API fields and the deferred extensions.
- **Key abstractions:** a three-document ownership table (this note / mandatory-update API / deferred extensions); a CDN-and-capacity qualification checklist.
- **Data flow:** release owners qualify signed Windows x64 and macOS x64/arm64 upgrades end to end — discovery, download, hash and signature checks, task-safe shutdown, installation, restart, new-version Host startup, profile reconciliation.
- **Non-obvious design decisions:**
  - **Publish immutable packages and blockmaps before the mutable Nightly feed.**
  - **Automatic package predownload is rejected** (it consumes bandwidth before the user asks) but automatic *discovery* is kept; every initial transfer and retry requires user action.
  - **Automatic restart or installation on ordinary quit is rejected** — it bypasses explicit task-impact approval.
  - **Mandatory policy and ordinary artifact discovery stay separate** — "One remote API controlling all updates" is rejected; only the installation coordinator is reused when qualified.
  - **A quantified capacity model**: at evenly distributed ten-minute polling, 100,000 online clients average ~167 checks/second and 1,000,000 average ~1,667. "CDN caching reduces origin load, not client download traffic charges; a functional probe is not a load test."
- **Edge cases & failure handling:** "Persisting a mandatory block across a same-version offline restart requires product confirmation"; "never silently turn approval for A into installation of C."
- **Surprising:** the note distinguishes *node TTL* from *client `Cache-Control`* and requires verifying that updater-added query parameters do not fragment the cache key.

### `.agents/notes/proposed/feature/2026-10-03-pi-extensions-bridge.md`
- **Purpose:** run unmodified Pi 1.0.0 extension sources inside DSH, served from existing DSH extension points, and publish a compatibility page listing every difference.
- **Key abstractions:** `@deepseek-ai/dsh-experimental-pi-extensions` (Host, `ctx.piExtensions`) + `@deepseek-ai/dsh-experimental-client-ui-pi-extensions` (Web); the Pi→DSH API mapping table; the **15-row core-gap table** (per-request input rewrite, tool-argument rewrite, session tree, awaited step-end hooks, tool progress, per-tool exposure, input admission, logged model call, plugin-owned durable records, compaction customization, lifecycle reasons, host-plugin GUI display, command capabilities, provider request hooks, fault isolation) each with a tracking issue.
- **Data flow:** a `cordis.yml` row names one extension source and its flags; row order is Pi's load order *and* its handler dispatch order; `jiti` imports the source so TypeScript loads in a built installation; the bridge resolves Pi's own imports to its own dependencies.
- **Non-obvious design decisions:**
  - **The bridge is a capability demonstration, not an emulator.** "It runs extensions as written where an existing DSH mechanism carries the behavior, leaves the rest unserved, and lists every difference on a compatibility page."
  - **Where Pi fails closed, the bridge does too.** A `tool_call` handler that edits `event.input` gets the call **denied with a reason**, "because the logged call would otherwise differ from the executed one."
  - **Built-in tool calls are translated to Pi's names and argument names** (`bash`, `read`, `edit`, `write`, `grep`, and Pi's `find` = DSH's `glob`) — a Pi safety extension reads `event.input.path` or `event.input.command`, so DSH's `file_path` would make it throw. A test fails when a mapped parameter is renamed or removed, or a tool gains an unclassified parameter.
  - **One ordered queue per session** for all Pi handlers: "A notification never overtakes an earlier one, and an awaited hook such as `tool_call` runs after every notification queued before it."
  - **Extension state lives in the Session log** (ignorable `plugin:`-prefixed records) so it follows resume and fork.
  - **The module is evaluated once per row, the factory once per session** — matching Pi, so an extension may rely on module state surviving a session switch. The consequence is honestly stated: "Extensions that keep per-Session state at module scope mix the state of concurrent Sessions."
- **Edge cases & failure handling:** an event DSH cannot raise is *accepted at registration and never raised*, named in a load warning; a `pi`/`ctx` member DSH cannot serve throws an error naming the member; an extension importing a helper the bridge does not implement fails to load rather than degrading.
- **Surprising:** the note's gap table is the real deliverable — "each core gap is closed by a separate change", and the bridge deliberately does *not* declare `pi/*` session events (that would make them required-on-read persistence types).

### `.agents/notes/proposed/feature/2026-10-03-pi-plugins-compatibility.md`
- **Purpose:** decide how much of Pi's *plugin* mechanism (Chord facets) is worth supporting — and record the mapping so the decision does not have to be re-derived.
- **Key abstractions:** **six support levels (0–5)**, each naming what a plugin author gets, the upstream trigger, and the DSH work; the Pi→DSH service mapping table (`AgentController`, `Models`, `SessionPlugins`, `Transcript`, `SlashCommands`, `PresentationUI`).
- **Data flow:** a Chord host per Agent; built-in facets serve Pi's session services on the DSH Host; `tui` facets run in a second Chord host bound in-process; `Transcript` requires a projection from DSH session events to pi-durable's `ConversationView`.
- **Non-obvious design decisions:**
  - **DSH stays at level 0 until a higher level's trigger occurs.** Two upstream reasons are cited from Pi itself: the plugin API runs only under `PI_EXPERIMENTAL=1` and is "not a stable public API contract yet"; and a plugin can do *less* than an extension because the session worker builds its own tool/hook/prompt registry without exposing it as a service.
  - **The level ladder is a *trigger* ladder**, not a plan: level 1 triggers on Pi shipping the API in its npm package or dropping the experimental flag; level 4 on Chord committing to browser support; level 5 on Pi exposing its tool/hook registry to facets.
  - **Pi's `AgentController.compact` refuses non-null `customInstructions`** because DSH compaction takes none — a mapping difference, not an oversight.
  - **`waitForPrompt` becomes a fold** over session events from the queued message to its `turn/end` — "DSH does not link a prompt to its answer; the fold does."
  - **A compatibility page must list each difference from Pi**, and the package README must state that plugin code runs in the Host with full authority.
- **Edge cases & failure handling:** "The loader is not a sandbox: plugin code runs with the process's full authority." Levels 1–4 therefore share DSH's fault isolation — an uncaught error stops every session; only level 5 removes that difference.
- **Surprising:** the note's *value* is framed as the investigation result, not the code: "Deferring the work without a record loses two results of the investigation: the mapping from Pi's plugin services onto DSH services ... and the DSH runtime properties that differ from Chord's."

---

#### `proposed/bug-fix/`, `proposed/process/`, `proposed/simplification/`, `proposed/testing/`

### `.agents/notes/proposed/bug-fix/2026-08-20-attachment-read-quarantine.md`
- **Purpose:** keep a session usable after a historical image attachment becomes unreadable.
- **Key abstractions:** `ATTACHMENT_NOT_FOUND | ATTACHMENT_CORRUPT | ATTACHMENT_READ_FAILED`; the `attachment/quarantine` and `attachment/recovered` session events.
- **Data flow:** a session-backed image-request projection records the unreadable reference *before* provider dispatch; the projection replaces each quarantined image with deterministic text (display name when present, attachment-id prefix, failure class); later requests derive the same replacement from the log and skip `readImage()`.
- **Non-obvious design decisions:**
  - **The original image block stays in the append-only history** — deleting or rewriting it "loses evidence, violates append-only history, and prevents a repaired content-addressed object from restoring the original request."
  - **Missing or corrupt bytes are never overwritten automatically** — the reference names verified immutable content; substituting different bytes under that identity "would defeat integrity checking."
  - **A request that discovers a quarantine re-projects before calling the provider**, so a failed read does not become a terminal model-request attempt.
  - **Cancellation and unclassified failures do not quarantine data.** `ATTACHMENT_READ_FAILED` gets one cancellation-aware read retry first, then the same event with a retryable reason.
- **Edge cases & failure handling:** recovery calls `readImage()` and appends `attachment/recovered` **only after digest and metadata verification succeeds**; "clearing quarantine without verification is invalid." Concurrent requests must produce one effective transition.
- **Surprising:** the policy owner is a single shared request-projection consumer — "provider adapters do not invent independent placeholders or recovery state" — because an unlogged placeholder would make replay depend on which adapter and storage state happened to be present.

### `.agents/notes/proposed/process/2026-06-11-api-extractor-reports.md`
- **Purpose:** make public-API changes an explicit, reviewable diff line.
- **Key abstractions:** a checked-in `etc/<pkg>.api.md` per package; CI fails when regeneration differs.
- **Data flow:** api-extractor (or `tsc --emitDeclarationOnly` + a normalized dump) generates the report; the committed copy is the comparison baseline.
- **Non-obvious design decisions:** the note is *explicitly deferred* and says why — "low value for an internal monorepo where reviewers already see the source diff, and a heavy, finicky dependency. Revisit if the packages are ever published externally."
- **Edge cases & failure handling:** the report format churns with compiler upgrades, "adding a maintenance burden that buys little while the packages stay unpublished."
- **Surprising:** the note is a *rejected-in-practice* proposal that still sits in `proposed/` — the doc-block-typechecking and event-taxonomy parts shipped; only the API-report part remains.

### `.agents/notes/proposed/process/2026-06-11-supply-chain-and-vendor-drift.md`
- **Purpose:** verify the *claims* the vendor manifest makes, and monitor the handful of real npm dependencies.
- **Key abstractions:** a nightly **vendor drift check** (clone upstream at the manifest SHAs, copy package sources, diff against `vendor/*/src`, and require the diff to match the logged local modifications kept as checked-in patch files); an advisory job; a license inventory; Renovate-style update PRs.
- **Data flow:** the drift job's patch files turn "log entries" into verifiable artefacts — "the log entries become verifiable artifacts rather than prose."
- **Non-obvious design decisions:** the manifest is currently enforced only in the *forward* direction (vendored change ⇒ manifest update); nothing verifies the manifest's claims. The license inventory mixes vendored MIT with the repo's own BSD-3.
- **Edge cases & failure handling:** vendored packages are excluded from dependency-update tooling, because their updates follow the manifest sync procedure (fetch upstream, re-apply patches, run gates, open the PR with the manifest table updated).
- **Surprising:** the note offers a fallback — if private upstream mirrors block the CI job, "run it as a local scheduled agent task instead of CI."

### `.agents/notes/proposed/process/2026-06-20-discover-package-inventory.md`
- **Purpose:** stop hand-maintaining package/gate inventories that merely restate manifest data or layout facts.
- **Key abstractions:** `packages/<group>/<pkg>` hierarchy + package manifests as the single canonical source; the `gen-module-graph` / `gen-cordis-catalog` generate-and-`--check` pattern.
- **Data flow:** a generator writes the aggregate configs' `references` and the module graph; a `--check` mode in `hygiene`/`doc-sync` fails on a stale committed copy.
- **Non-obvious design decisions:**
  - **Static lists are appropriate when they encode *policy*; they are needless friction when they duplicate facts that already exist.** TypeScript's project `references` must be an explicit array (no wildcard), which is the remaining hard case.
  - **The hierarchy should encode the broad maintenance policy** — core/product, integrations, capability seams, support/test/example — "so they do not all require a hand-maintained exception list before scripts can tell them apart."
  - **The note records a reversal:** a single `@deepseek-ai/dsh-*` wildcard in `paths` was tried and **reverted** to one explicit alias per package, "because resolving a wildcard's candidates in order dominated source-launch boot."
- **Edge cases & failure handling:** "Discovery scripts can become too clever. The implementation should stay boring: read manifests, filter on explicit fields, print the resolved list, and fail loud."
- **Surprising:** the note ends with the literal pre-format escape comment `<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->` — the format gate accepts it for pre-2026-07-05 notes.

### `.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md`
- **Purpose:** keep the `dsh-code-review` skill current from *adopted* human review feedback, without checklist bloat and without promoting feedback the final code may not implement.
- **Key abstractions:** the acquisition contract, the **adoption-evidence** contract, dual-reviewer classification (`human-authored | forwarded-automation | unclear` × `adopted | rejected | unclear`), the reviewer-adapter protocol, and the promotion contract.
- **Data flow:** a private out-of-repo tool runs on a clean checkout at refreshed `origin/master`; it lists PRs merged in an overlapping window, collects pre-merge `User` feedback and final PR evidence, has two reviewers verify authorship+adoption, two reviewers classify against the current skill, drafts a candidate, then both review the same skill diff in a bounded revision loop; the only repository file changed is `.agents/skills/dsh-code-review/SKILL.md`, and the tool never commits, pushes, opens or merges.
- **Non-obvious design decisions:**
  - **Merge-commit reachability is the sole eligibility check** — a stacked PR is admitted whenever its base has since reached master.
  - **Adoption is proven by two PR-specific patch snapshots, not by diffing against the merge.** With baseline `B`, target parent `T` and merge `M`: the feedback-time snapshot is `merge-base(B,T) → B`; the final snapshot is `T → M`. "A target-only change therefore appears in neither PR patch, while a change added to the PR after feedback appears only in the final snapshot." Diffing `B` against `M` directly would include unrelated target-branch changes.
  - **Merge status, a resolved thread, an author's "fixed" reply, or a same-file edit are context, not adoption proof.**
  - **The two reviewers must be independently configured**; the tool refuses to run if the two reviewer commands resolve to byte-identical executables, and refuses to treat a *human account forwarding automated findings* as human-authored.
  - **Untrusted feedback is wrapped in a nonce-tagged `<untrusted-feedback nonce="…">` block** that every prompt instructs the model to treat as data — "the 128-bit nonce prevents an untrusted body from forging the closing tag." Reviewer subprocesses get a scrubbed environment and a private run directory as cwd.
  - **A batch whose adapter output fails schema or id validation fails closed at the batch level** — every item in it is marked unclear and routed to excluded, rather than aborting the whole run; a missing valid result for any nonempty batch exits non-zero instead of reporting "no candidate."
  - **An overlapping time-window scan replaces a processed-PR cursor** — cheap, naturally idempotent against the current skill, and it avoids cursor recovery/missed-event problems.
- **Edge cases & failure handling:** the promote helper refuses to apply a candidate when the current skill blob differs from the bundle's recorded source blob; writes and the failure rollback use best-effort compare-and-swap, and the rollback also unstages the target so an adapter- or gate-staged candidate cannot survive a failed run.
- **Surprising:** the acceptance criteria record **real observed numbers** from a live run — "Observed on 2026-07-15: 62 merged PRs scanned, 5 skipped, 426 human feedback items considered, **0 candidates surfaced**" — and the mechanism itself lives on one maintainer's machine, a single-maintainer bus factor the Risks section names.

### `.agents/notes/proposed/process/2026-07-26-remove-packed-session-fixture-migrator.md`
- **Purpose:** remove a temporary migration CLI once the branch-convergence window closes.
- **Key abstractions:** the permanent canonical-layout gate (`scripts/session-fixture-layout.ts` + its snapshot check) vs the temporary branch-facing writer (`scripts/migrate-packed-session-fixtures.ts`).
- **Data flow:** the read-only gate discovers future fixtures, decodes mixed physical records and compares them with the canonical packed representation; the writer rewrote them.
- **Non-obvious design decisions:** **removal depends on live pull-request evidence, not elapsed time** — "An incomplete open-branch inventory could strand a contributor with a large unpacked fixture conflict after the command disappears." The canonicalization module is *not* transition residue and must be retained (it is the enforcement).
- **Edge cases & failure handling:** "Closed or superseded branches require no migration"; branches merge current `master`, run the migrator once, commit the fixture-only rewrite separately, then verify the repository-wide snapshot check.
- **Surprising:** the framing is about *maintenance-path count*, not lines: "Keeping a mutation command after its transition ends adds a second apparent maintenance path beside the permanent read-only snapshot check."

### `.agents/notes/proposed/process/2026-08-20-audience-first-documentation-quality.md`
- **Purpose:** define "brief, intuitive, friendly" as reviewable outcomes, and fix four concrete documentation defects that pass every existing gate.
- **Key abstractions:** five definitions — **Brief / Intuitive / Friendly / Accurate / Agent-readable** (`:43`); a **criteria-by-document-job** table (product quick start, user task guide, contributor tutorial, architecture overview, package/subsystem reference, generated reference, agent instruction or skill, proposed/implemented Agent Note); the **entry layer vs detail layer** split for generated references.
- **Data flow:** the `dsh-doc` skill owns the first executable version; the `session-persistence-jsonl` README pair is the reference example; `pnpm run test:docs` enforces metadata, pairing and quick-documentation checks.
- **Non-obvious design decisions:**
  - **Semantic correctness can pass without a current owner.** The former `dsh-doc-site-sync` skill told authors to reuse a nonexistent `en-docs` sidebar and to add sections to a removed `sectionOrder`. "High-impact prose therefore needs a named source or a focused check that consumes the source; a second hand-written copy is not a freshness mechanism."
  - **The budget gate checks the ceiling, not the target.** `docs/AGENTS.md` states a 1,800-word target and 5% headroom; the manifest allows 2,400 and the file holds 1,313 — "The budget gate passes because it checks the manifest ceiling, not the target or ratchet rule."
  - **Generated accuracy and retrieval quality are conflated.** 19 generated files hold 49,611 words; 44 of 47 subsystem pages contain generated regions contributing 34,622 of the tier's 100,759 words. "A blanket word limit would delete value." The fix is a compact entry layer (scope, lookup, grouping/index, conceptual links, generator/check command) in front of exhaustive detail.
  - **Reader success must be reviewable**: starting state, desired outcome, shortest successful path, likely failure, next useful page.
  - **Package README frontmatter carries a `description` and a mechanically derived `kind`** (four kinds → four templates); tags are banned until a governed taxonomy proves value.
  - **The standard must not become the problem**: "The standing documentation file is 1,320 words against a 1,320-word ceiling" — adding rules to it "would deepen the problem the standard is meant to prevent," so the canonical quality reference is extracted and `docs/AGENTS.md` keeps only standing orders.
- **Edge cases & failure handling:** a review threshold is behavioural, not word-based — "A page crosses a review threshold when one lookup requires scanning unrelated groups or when one page dominates agent context."
- **Surprising:** the note ships slices 1–3 and leaves 4–5 open, and states that the audit "uses repository structure, gates, and representative pages rather than user research" — real reader validation is still required before broad rollout.

### `.agents/notes/proposed/simplification/2026-09-17-defer-office-background-scheduling.md`
- **Purpose:** remove Office conversion priority/promotion/demotion/background-concurrency machinery that no production caller uses.
- **Key abstractions:** `OfficeToPdfPriority`, request `priority`, config `maxBackgroundConversions`, reader/job priority fields, foreground reader reservation, background counter.
- **Data flow:** after removal, the queue admits the oldest queued job whose source reservation fits whenever capacity is available, and rejects a new distinct job when the metadata queue is full; joining an existing source job subject to the shared reader limit is unchanged.
- **Non-obvious design decisions:**
  - **The removal is gated on a *specific consumer*, not on absence.** "The open delivery prewarming PR #4064 already provides a concrete prewarming consumer … Removing scheduling must first be reconciled with that consumer; **absence from master is insufficient evidence to proceed.**"
  - **The search that justifies it is named**: `officeToPdf`, `OfficeToPdfRequest`, `OfficeToPdfPriority`, `maxBackgroundConversions` — all found only in queue/Remote/cache tests.
  - **Scope is admission policy, not ownership.** "This proposal changes admission policy, not conversion ownership or engine selection."
- **Edge cases & failure handling:** out-of-tree callers of the exposed pre-stable API must update; "this proposal offers no compatibility alias."
- **Surprising:** the note distinguishes *removing a capability* from *removing the whole provider* — the bounded-conversion decision stays active because its cache, authorization and lifetime rationale still apply.

### `.agents/notes/proposed/simplification/2026-09-19-config-only-hmr.md`
- **Purpose:** cut DSH's HMR subsystem down to live profile-config refresh, dropping live JavaScript module replacement.
- **Key abstractions:** retained — `watchConfig`, `runExclusive`, exact profile/home patch and manifest watches, readiness coordination, serialized refresh, disposal drainage. Removed — module watcher/dispatch, dependency-graph analysis, module-cache/fiber replacement and restoration, module-only state, `baseDir`, `getOuterStack`, `getLinked`, `hmr/change`/`hmr/reload`, the import-error formatter.
- **Data flow:** profile/home patch and bundle-list changes still refresh live; source-module, arbitrary Include and framework-dependency changes require a process restart.
- **Non-obvious design decisions:**
  - **The proposal explicitly refuses to call the code unreachable**: "That opt-in is real supported behavior … This proposal trades developer continuity for a smaller maintained subsystem; it does not classify the code as unreachable."
  - **Partial removal is rejected** — removing only rollback "can leave cached modules and live fibers from different generations."
  - **Removed source options get an explicit migration/configuration error** rather than being silently ignored, and shipped `root: []` rows are updated.
  - The size estimate is split honestly: "Roughly 400 identified source lines and 372 dedicated test lines belong to the removable module paths; retained configuration code and mixed tests must be counted separately in implementation."
- **Edge cases & failure handling:** "Custom profiles and installed plugins lose live server-code replacement and its failure restoration. Restarting can interrupt long-lived development work."
- **Surprising:** the note is careful that the non-transactional Loader decision "motivates avoiding duplicated rollback but does not already authorize withdrawing source HMR."

### `.agents/notes/proposed/simplification/2026-09-19-provider-only-instruction-reads.md`
- **Purpose:** delete the direct-Node I/O path from instruction discovery, leaving only the filesystem-provider path.
- **Key abstractions:** `FileSystem` provider; `streamText` for bounded reads; `findProjectRoot`; `discoverBaselineInstructionFiles` / `loadBaselineInstructions`.
- **Data flow:** provider discovery supplies required targets; bounded reads consume them; the plugin's missing-provider no-op and the pure `renderAgentInstructions` API are preserved.
- **Non-obvious design decisions:**
  - **Every production caller already supplies a provider** (the plugin reads `ctx.get('fs')`; reconciliation *requires* `FileSystem`); direct-Node consumers are tests. "Maintaining both paths therefore adds separate error and cancellation coverage without serving a shipped product path."
  - **"Unavailable candidates cannot imply removal, while root-marker failures remain errors"** — the distinction is preserved exactly.
  - **The separate `skill-filesystem` owner retains its existing providerless behaviour** — the simplification is scoped to one owner.
- **Edge cases & failure handling:** symlink following, byte budgets, cancellation, resume, nested-touch and compaction-restoration behaviours all keep their tests; external callers omitting the provider face an intentional pre-stable API change.
- **Surprising:** the note rejects "construct a local provider implicitly" because "hiding filesystem selection and lifecycle ownership" is worse than the missing argument.

### `.agents/notes/proposed/simplification/2026-09-19-prune-stream-visibility-helpers.md`
- **Purpose:** delete five exported stream-visibility queries with no production caller.
- **Key abstractions:** removed — `isVisibleChunk`, `chunkHasVisibleText`, `runFirstVisibleTime`, `assistantStreamHasVisibleContent`, `assistantStreamHasVisibleText`, plus `hasNonWhitespace` and `blockIsVisible`. Retained — first-token, raw-chunk, text-joining and assembly readers, the accumulator, validating expansion.
- **Data flow:** ~77 source lines deleted; retained readers still avoid materializing per-member expansions while durable input keeps validating expansion.
- **Non-obvious design decisions:**
  - **The retained first-token reader has different timing requirements** (Session Stats and Trajectory) "do not require the separate whitespace-sensitive visibility classification" — so it stays while the visibility family goes.
  - **No replacement machinery is added**: "There is no production caller to migrate. Adding replacements would retain an unused API and introduce the allocations the record readers avoid."
  - **The contract is public** — the package root and the published `./assistant-stream` entry expose the functions, so "this search cannot establish" external usage.
- **Edge cases & failure handling:** "This deliberately contracts exported pre-stable APIs"; "Refresh consumer evidence before implementation and assess any identified external requirement explicitly; do not claim ecosystem-wide non-use."
- **Surprising:** a note proposing *less* code still requires bilingual README and subsystem-page updates — the bilingual pairing is enforced even for removals.

### `.agents/notes/proposed/simplification/2026-09-19-python-sdk-directional-client.md`
- **Purpose:** remove the Python SDK's unused reverse RPC direction.
- **Key abstractions:** removed — `next_request`, `respond`, `respond_error`, `notify`, `_requests`, `IncomingRequest`. Retained — client requests, response validation, incoming notification subscriptions, shutdown.
- **Data flow:** the SDK server receives requests and emits notifications but declares no server-originated request or client-notification handler, so `IncomingRequest` "has no supported runtime producer".
- **Non-obvious design decisions:**
  - **An explicit guard survives the removal**: a frame carrying both `id` and `method` is rejected before response matching, "so a server request cannot settle an unrelated pending client request."
  - **The shared TypeScript transport stays bidirectional** because the Codex wire adapter uses requests and notifications in both directions — the narrowing is scoped to the Python client only.
  - **Prompt submission still returns only the durable enqueue receipt**: "no per-prompt completion promise or response-based turn result is introduced."
- **Edge cases & failure handling:** tests that used client notifications purely to trigger fixture behaviour switch to a request+response; notification filtering, sibling delivery, final draining, malformed-frame handling, serialized writes and shutdown keep their tests.
- **Surprising:** the note records the deliberate trade — "Ignoring an unsupported request does not fulfill a hypothetical server's response expectation; this is deliberate withdrawal of that direction, not protocol parity."

### `.agents/notes/proposed/simplification/2026-09-19-retire-app-bin-boot-helpers.md`
- **Purpose:** delete `resolveConfigPath` and `loadEnv` from app-boot's production export — they now serve only test fixtures.
- **Key abstractions:** retained — `boot`, `loadLayeredEnv`, shipped profile composition, snapshot replay selection.
- **Data flow:** eight fixture drivers switch to Node's `path.resolve`; the one fixture needing a local `.env` keeps that handling locally.
- **Non-obvious design decisions:**
  - **"Replace every use with `loadLayeredEnv`" is rejected** — layered discovery, filtering and precedence differ from reading one fixture-local `.env`; "Sharing a name does not establish equivalent behavior."
  - **The removal is classified as partial supersession** — `boot` and fail-loud handling still have owners; the archived shared-app-bin record stays frozen.
  - **"Add no compatibility aliases or second replay selector"** is an explicit acceptance line.
- **Edge cases & failure handling:** the fixture's missing-file, present-file and warning behaviour must survive; "Accidentally switching the fixture to layered environment discovery would change its test inputs; preserve that distinction explicitly."
- **Surprising:** the note quantifies the removal (39 production source/JSDoc lines, ~73 dedicated test lines) and explicitly says "the estimate is not an implemented diff."

### `.agents/notes/proposed/simplification/2026-09-19-retire-prompt-registry-change-event.md`
- **Purpose:** retire the `system-prompt/change` event — a public extension with no executing product listener.
- **Key abstractions:** `SystemPrompt`'s registry-change emitter; `ScopedLayers`' optional constructor notification callback.
- **Data flow:** removal of the declaration, emitter, current documentation, generated discovery entries and notification-specific tests; `ScopedLayers`' callback becomes optional (no no-op callback is supplied).
- **Non-obvious design decisions:**
  - **The note amends, rather than archives, the owning decision.** The Remote event delivery reference "explicitly retains this extension despite having no shipped consumer"; the implementation change must state that this proposal supersedes *only* that promise, and "Do not rewrite or archive that entire decision."
  - **"Per-step assembly" is explicitly *not* proof of compatibility** — "model-input reconstruction and registry notifications are different behaviors."
  - **The change is scoped to one event** — `tools/change` with its production consumers, shared effects, action rollback and undo ordering are all preserved.
- **Edge cases & failure handling:** installed plugins may depend on notifications *or* on listener exceptions rejecting registration; "They lose both behaviors; repository searches cannot establish their absence."
- **Surprising:** the note admits "Source savings are small" — the value is retiring a public notification obligation, not the lines.

### `.agents/notes/proposed/simplification/2026-09-19-shell-env-key-declarations.md`
- **Purpose:** reduce the shell-environment registry from "keys with descriptions and enumeration" to "keys with ownership".
- **Key abstractions:** removed — description objects, `BashEnvVariable`, `BashEnvVariableInfo`, `list()`, description-only validation, the exhaustive-catalog TODO. Retained — `register`, `collect`, reserved keys, ownership conflicts, undeclared-output refusal, deterministic output, effect disposal.
- **Data flow:** a contributor declares an explicit readonly key collection; Bash and PowerShell receive equivalent environment maps (including the Web URL and session identity).
- **Non-obvious design decisions:**
  - **"Finishing the diagnostics catalog" is rejected** — that would add built-in metadata and a capability "without an identified current product requirement."
  - **Keeping descriptions after deleting `list()` is rejected** — "they would have no remaining reader while still burdening every contributor."
  - **This is an explicit API contraction, not unreachable-code removal**, because `list()` is discoverable through the Cordis inspection provider.
- **Edge cases & failure handling:** duplicate names, reserved keys, cross-contributor conflicts, undeclared outputs and disposal keep their behaviour; no secret-handling or ambient-environment policy changes.
- **Surprising:** the archived origin record had anticipated diagnostics and future prompt/UI consumers — the proposal declines to build for a future that has no owner.

### `.agents/notes/proposed/simplification/2026-09-19-trim-session-query-convenience-api.md`
- **Purpose:** remove four `SessionQueryEngine` convenience methods with no first-party product caller.
- **Key abstractions:** removed — `readSession`, `readTitle`, `readTitleSnapshot`, `listEvents`, the `SessionLogSnapshot` result type, and `eventRecords`. Retained — `filterEvents`/`_filterEvents` and their semantic helpers, `observeSession`, `readTitleSnapshots`, `readSurface`, `readEvent`, listing, search, tracing.
- **Data flow:** removing the methods also removes their replay-validation and result-copying paths, wrappers, public types and endpoint-specific tests; the type-equivalence manifest entry and the catalog generator's `LINK_MAP` entry are removed and discovery metadata regenerated.
- **Non-obvious design decisions:**
  - **`filterEvents` is retained deliberately** — its provider-independent literal substring scan differs from FTS token matching, and the SQLite query documentation explicitly recommends it.
  - **The historical unified-query decision stays active** — "This proposal removes selected convenience operations, not that topology."
  - **Assertions move rather than vanish** — "Move relevant assertions from removed-method tests instead of deleting their shared guarantees; account for `readSession`'s additional replay validation."
- **Edge cases & failure handling:** live-source precedence, corruption refusal, cancellation, detached results, cold reads and batch-title behaviour are preserved through the retained endpoints.
- **Surprising:** the note treats the *generated catalog* as a first-class consumer to update — a method advertised to plugin authors but never executed is still an API obligation.

### `.agents/notes/proposed/testing/2026-06-11-deterministic-and-stress-testing.md`
- **Purpose:** kill flakiness debt, make the replay invariant universal, and re-verify the inbox wakeup race continuously.
- **Key abstractions:** three measures — (1) **no wall-clock sleeps in tests** (a lint rule banning `setTimeout` in `packages/*/tests` outside an allowlisted helper); (2) a **universal replay fixture** (`:18`) that after every test replays the agent's session log into a fresh Session and asserts `deriveMessages()` equality; (3) a **nightly race stress** job (`vitest --repeat=200 --shuffle`).
- **Data flow:** the shared harness wraps the loop; the invariant is checked hundreds of times per CI run "across every scenario the suite produces, not twice."
- **Non-obvious design decisions:**
  - **Event-driven waits are preferred over fake timers** — "Fake timers interact subtly with Promise scheduling in the loop … reserve fake timers for timer-service behavior itself."
  - **A flake found by the stress job is a bug to fix, never a retry** — it is triaged as a bug.
  - **Ordering:** land 1 and 2 together (same helpers), add the nightly job after the suite is sleep-free "so repeats are fast."
- **Edge cases & failure handling:** the lint rule is scoped with an allowlisted helper module so a legitimate timer primitive can still live.
- **Surprising:** the note positions 100%-coverage-style pressure as an *execution-without-assertion* risk — the motivation for the replay fixture is that coverage alone cannot prove the log→history derivation holds.

### `.agents/notes/proposed/testing/2026-06-11-mutation-testing.md`
- **Purpose:** measure whether the suite *kills* deliberately injected bugs, because per-file 100% coverage proves only that lines execute.
- **Key abstractions:** Stryker (`@stryker-mutator/vitest-runner`) over `packages/*/src`; PR-scoped incremental runs as a CI job; nightly full runs with a tracked, ratcheting mutation score.
- **Data flow:** surviving mutants become work items (an agent picks a survivor, writes the killing test, repeats); provably equivalent mutants get annotated exclusions with reasons, mirroring the `/* v8 ignore */` policy.
- **Non-obvious design decisions:** the ratchet only ever tightens — "start by recording, then set the threshold at the observed baseline and ratchet upward (same policy as coverage: thresholds only ever tighten)"; equivalent-mutant exclusions must carry *reasons*.
- **Edge cases & failure handling:** if PR-scoped runs stay too slow, "keep them nightly-only and rely on the score ratchet" — and the note says that outcome should be recorded in the note itself.
- **Surprising:** the note frames mutation testing as the counterweight to agent-written tests: "Under agent-written tests, coverage pressure can produce execution-without-assertion."

---

#### `rejected/` — proposals declined, kept for their rationale

### `.agents/notes/rejected/architecture/2026-06-16-typed-event-schemas.md`
- **Purpose:** decide whether the event vocabulary should move from compile-time merge-extensible maps to a runtime schema registry (Zod/schemastery).
- **Key abstractions:** `SessionEventMap`, `ContentBlockMap`, `MessageSourceMap`, `FinishReasonMap`, `TurnTriggerMap`, `TurnEndReasonMap`; the `defineTool` `InferArgs` DSL; `assertNever` exhaustiveness.
- **Data flow:** today the types vanish at runtime — persistence `JSON.stringify`/`JSON.parse`s each event verbatim and the only runtime guard is `isJsonValue` (round-trip serializability), not structural validation (`:13`).
- **Non-obvious design decisions:**
  - **The blast radius is measured, not asserted**: ~370 LOC of core types across six maps, ~10 `declare module` augmentation sites, 16 `session.append` call sites, ~7 switch-consumers, plus the `defineTool` DSL and the architecture docs.
  - **A plugin cannot declaration-merge a Zod schema** — declaration merging is compile-time; a Zod schema is a runtime value, so Option C needs a runtime registry and becomes a core-vocabulary redesign, "not a persistence implementation detail."
  - **The rejection reason is threefold**: Option C's blast radius; Zod is only a transitive dependency while the repo's chosen schema library is **schemastery**; and `assertNever` static exhaustiveness weakens because runtime variants are not statically exhaustive.
  - **The proportionate step is Option B** — schemastery on genuinely *closed* shapes (the JSONL `isHeaderLine` guard), leaving the merge-extensible maps untouched.
- **Edge cases & failure handling:** the accepted cost is stated: "a malformed-but-JSON datum is caught late, by a consumer's `switch` — the status-quo cost, accepted deliberately."
- **Surprising:** the `Status:` line carries the full verdict in one line ("runtime event-schema registry declined; event maps stay compile-time, Zod validates projection state, migrations validate durable payloads") because "The rejection reason is the one status with content, because a rejected Agent Note's verdict is the fact readers come for."

### `.agents/notes/rejected/simplification/2026-06-20-drop-durable-step-boundaries.md`
- **Purpose:** propose removing `step/start`/`step/end` from the durable log (turn becomes the only durable boundary).
- **Key abstractions:** the `{ turn, step }` field already carried by every step-scoped event; `deriveMessages()`; crash repair.
- **Data flow:** step groups would be inferred from contiguous events sharing `(turn, step)`; crash repair would stop synthesizing `step/end`.
- **Non-obvious design decisions:** the rejection turns on one fact — **`step/end` is concrete information**: "a reader can tell whether a model request finished, crashed, or is being repaired without deriving that state from the next event." A bare `step/start` also records "a model request that began but produced no chunks before failing."
- **Edge cases & failure handling:** the "What we give up" section names the loss: the log would no longer record "a model request started but produced no event before the process died."
- **Surprising:** the note argues against its own proposal's elegance — boundary events look ceremonial, and the argument for keeping them is that *crash repair and transcript inspection get clearer*, not that they add information a consumer needs today.

### `.agents/notes/rejected/simplification/2026-06-20-fold-session-persistence-interface.md`
- **Purpose:** propose moving `SessionPersistence` into `dsh-session`, deleting one package.
- **Key abstractions:** `SessionPersistence`, the shared write coordinator, persistence contract helpers; the JSONL and SQLite backends.
- **Data flow:** providers would depend on `dsh-session` directly; `agent-loop` resume would use the session-owned service key.
- **Non-obvious design decisions:** **the capability-seam split made sense when persistence was a new swappable backend design**; after the mutable summary was removed, the Service Definition package "mostly wraps the session log's own storage concern."
- **Edge cases & failure handling:** the trade is named — `dsh-session` becomes heavier, owning both the in-memory log and the persistence service definition.
- **Surprising:** the rejection reason turns on ecosystem timing, not design quality: "If third-party persistence backends were already a public ecosystem, the separate Service Definition package would be a cleaner SDK boundary; **pre-release, the extra package looks like abstraction before there is an external Consumer.**"

### `.agents/notes/rejected/simplification/2026-06-20-truncate-interrupted-turns.md`
- **Purpose:** propose truncating an interrupted final turn on load (keep only the last completed turn).
- **Key abstractions:** `interruptedTurnClosers()` — the synthetic repair that appends error `tool/result` events, a `step/end`, and `turn/end { kind: 'interrupted' }`.
- **Data flow:** under the proposal, a torn final record is still truncated, but any event after the previous `turn/end` is dropped; the `interrupted` turn-end reason disappears.
- **Non-obvious design decisions:** the proposal's own motivation is honest about its cost — "It also invents events that never happened. A synthetic tool result is useful because it makes provider history valid, but it also means the resumed log contains model-visible text that no tool produced."
- **Edge cases & failure handling:** the rejection's reason is the counterweight: "a single turn can contain substantial real work, including many steps and large tool output."
- **Surprising:** the note argues that partial-crash recovery should be "an explicit user-facing recovery view, not as synthetic events silently inserted into the canonical transcript" — the *idea* survives, the *mechanism* does not.

### `.agents/notes/rejected/simplification/2026-07-12-prune-unused-skill-registry-api.md`
- **Purpose:** propose removing `ctx.skills.register()` and several unused skill-contract fields.
- **Key abstractions:** `SkillRegistry.register()`, `SkillRegistration`, the `runtime` pseudo-provider, `providerRevision`, `SkillSummary.whenToUse`, `SkillCandidate.path`, `SkillDefinition.path`.
- **Data flow:** the proposal keeps one provider-backed path and keys completed catalogs by **cwd alone**, using `providerRevision` only as an in-flight discovery epoch ("every provider mutation synchronously clears the cache, and the post-await revision comparison already prevents inserting stale work").
- **Non-obvious design decisions:**
  - **The rejection is about a deliberate extension point**: "Direct runtime skill registration is an intentional extension path for third-party plugins."
  - **A field with no reader is still a contract**: the shipped model catalog renders name/description only; resource loading uses `resourceBase`; providers own their locator. `metadata`, `disableModelInvocation`, `source`, `provider`, `locator` and `resourceBase` are retained as either deliberate extension vocabulary or production-consumed fields.
  - **The note carefully refuses to generalize from absence**: agent-scoped system-prompt sections, tool providers and variables are *explicitly outside* the proposal, because the agent-scope contributor contract intentionally allows registration during `setup(agentCtx)` — "absence of a fixed in-repo scoped registration is not evidence of non-consumption."
- **Edge cases & failure handling:** external programmatic `list()`/`get()` consumers lose `whenToUse` routing hints and the `path` fields — "the shipped model catalog never renders them, and resource resolution keeps its explicit `resourceBase` plus provider-owned opaque locator, but those fields are not observationally identical."
- **Surprising:** it distinguishes **a path field on a candidate** from **a provider's locator** — one is a copied convenience, the other is the authority.

### `.agents/notes/rejected/simplification/2026-07-19-fold-compaction-package-split.md`
- **Purpose:** propose folding `dsh-compaction-basic` into `dsh-compaction`.
- **Key abstractions:** `ctx.compaction`, `CompactionResult`, the shared transcript and tool-pairing helpers, `summarize()` as a protected hook.
- **Data flow:** one package would own the configuration, plugin class, algorithm, types, events and shared helpers.
- **Non-obvious design decisions:** **the capability-seam rule requires a real interface, implementation *and* consumer** — "the split adds a package manifest, README, project boundary, dependency edge, abstract forwarding class, generated catalog entries, and composition wiring without demonstrating backend substitution."
- **Edge cases & failure handling:** a deployment-specific summarizer can subclass or intercept the existing LLM call without a second capability package; a separate Service Definition package returns only "when a second complete backend and an independent Consumer need substitution."
- **Surprising:** the rejection names the *upcoming* evidence: "More compaction backends are planned" — the split is kept because the second consumer is expected, and the note says acceptance should be revisited "if a second backend lands first."

### `.agents/notes/rejected/simplification/2026-07-26-builtin-timer-promises-for-hand-rolled-sleeps.md`
- **Purpose:** replace three hand-rolled cancellable sleeps with `node:timers/promises`.
- **Key abstractions:** `cancellableDelay()` (~14 lines), the workflow `sleep()` (~7 lines), terminal `delay()` (~4 lines).
- **Data flow:** the builtin covers all three call sites exactly, including `ref: false` semantics and abort rejection.
- **Non-obvious design decisions:** **the proposal was implemented and the parity premise falsified.** The `Status:` line records it: "implementation (PR #679) falsified the parity premise: **vitest's fake clock does not intercept `node:timers/promises`**, so the swap costs deterministic fast tests for ~10 deleted lines."
- **Edge cases & failure handling:** the note had already flagged "Fake timers interact subtly with Promise scheduling" — in the sibling testing note — and this is the concrete instance of that hazard.
- **Surprising:** a cleanup proposal rejected for **test determinism** rather than for runtime behaviour; it is the clearest example in this shard of a "delete 10 lines" trade being refused.

### `.agents/notes/rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.md`
- **Purpose:** freeze the negative verdicts of a repository-wide Not-Invented-Here audit so the survey is not re-run from scratch.
- **Key abstractions:** ~30 named candidate swaps across protocol/parsing, retry/timers/async, data/validation, filesystem/subprocess/terminal, servers/HTTP, SQLite/storage and repo tooling.
- **Data flow:** each verdict names the load-bearing hand-rolled shape, with the line counts that would be deleted — e.g. `vscode-jsonrpc` for LSP framing (~255 of ~1,800 src lines, but it cannot express `maxMessageBytes` and inverts cancel-grace teardown); `p-retry` for `llm-retry` (wrong execution model — the plugin is a decision-returning waterfall listener and the loop owns re-execution from the durable log); `write-file-atomic` (the packages lack the 0700 staging dir, Win32 DACL copy/`ReplaceFileW`, AbortSignal support and parent-dir fsync); `strip-ansi` (the pty sanitizer is a streaming state machine with OSC `133;D` prompt-marker extraction, and `stripVTControlCharacters` demonstrably leaks unterminated-OSC payloads the title normalizer must strip).
- **Non-obvious design decisions:**
  - **The net-simplification bar is evidence-based**: "a future proposal for any item must beat its recorded reason, not just re-cite the policy."
  - **One note, not ~30**: "One rejected note per item — rejected: ~30 files of ceremony for verdicts that share one evidence standard and one fate; per-item notes are warranted only if an item is re-proposed with new evidence."
  - **Where an owning note already rejected the alternative, this note cites rather than duplicates it.**
  - **Security beats brevity**: `shell-quote` is rejected because "a safety boundary is the wrong place to save one line"; the Landlock launcher is kept because a single-maintainer LGPL Rust binary set "is a larger audit surface".
- **Edge cases & failure handling:** `node:zlib`'s builtin zstd already does compression, but `scanZstdFrames` locates RFC 8878 frame boundaries *without decompressing* for torn-tail repair — no package exposes that.
- **Surprising:** the YAML consolidation verdict is *forced* by an asymmetry — js-yaml cannot replace `yaml` (sdk-helper needs the Document API), and migrating the js-yaml sites cannot retire the library either, so "Deletable: ~20–25 lines of duplicate tag definitions."

---

### Tier 2 — bulk: a compact table, one row per file

All 51 remaining `docs`-typed files in this shard are the **Chinese counterparts** of the English notes catalogued in Tier 1.
Under the i18n contract they mirror the English sibling's structure section-for-section
(`.agents/notes/README.md:125`); the header tokens `# Agent Note: ` and the `Status:` line stay English verbatim.
Read depth for each: the header block, the full heading list, and the `## Problem` section — which is where the
decision's motivation lives. One line per file below.

| File | What it decides |
| --- | --- |
| `.agents/notes/README.zh.md` | 中文 counterpart of the note-system spec: lifecycle/class path encoding, 分类 (classification table), 归档与删除 (archival/deletion rules incl. the "三文件组" triplet rule), 文件格式 (header block + per-lifecycle skeletons + mandatory 曾考虑的替代方案), and the "中文对侧文件" pairing contract. |
| `.agents/notes/proposed/architecture/2026-07-19-required-cancellation-through-tool-capability-seams.zh.md` | 工具可达能力 seam 中的必填取消 — every tool-reachable async capability must take a required `AbortSignal`; omitted signals must fail compilation; detached work after an ownership handoff is out of scope. |
| `.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md` | 领域 KV 存储能力 seam 与 workspace 实体 — the `ctx.storage` hub, json/sqlite backends, the `domain` data form, the workspace registry entity, the session-delete design (settled, future work), the reuse/migration outlook and the 不做清单. |
| `.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.zh.md` | 会话投影与命令生命周期日志记录 — the whole-value event rule, the host projection registry, the projections block on the history tail page, the generic client value store, `useProjection`, and the `command/run`/`command/done` log events. |
| `.agents/notes/proposed/architecture/2026-07-28-storage-root-and-derived-medium-recovery.zh.md` | 存储根目录落点与派生介质恢复 — anchor `storage-json.root` to `$DSH_HOME/storages`, resolve a relative root once at construction, and add `recovery?: 'reject' \| 'reset'` so a *derived* medium is reset on damage while an authoritative one fails loud. |
| `.agents/notes/proposed/architecture/2026-07-29-durable-last-activity-index.zh.md` | 在会话索引中记录最后活动 — store the last human-prompt time where the listing already reads; mtime answers the wrong question; the JSONL header may not be rewritten; three questions left open. |
| `.agents/notes/proposed/architecture/2026-08-08-semantic-composer-chain-phases.zh.md` | composer 链选举的语义阶段 — replace the single global `priority` scalar with declared phases `['interaction','restriction']`; phase index dominates local priority; the defect is two decisions sharing one number. |
| `.agents/notes/proposed/architecture/2026-09-06-logical-session-storage-rebuild.zh.md` | 逻辑会话与存储重建 — `LogicalSession` + `SessionService` + `SessionStorage` in five substages, the switchable `verify-logical-session-access` gate, the Stage-1 invariant list, and the ownership table. |
| `.agents/notes/proposed/architecture/2026-09-10-session-capability-protocols.zh.md` | Session 能力协议 — five orthogonal capabilities (logical session, service, storage, projection port, query) and the rule that only composition sees concrete providers (note: this file keeps its section headings in English). |
| `.agents/notes/proposed/architecture/2026-09-10-session-data-compatibility.zh.md` | Session 历史数据兼容 — V3 is the writer authority; never overwrite old generations or auto-downgrade; stages 1–3 change no disk bytes; derived data is rebuildable and cannot become recovery authority. |
| `.agents/notes/proposed/architecture/2026-09-10-session-developer-transition.zh.md` | Session 开发者迁移规则 — a stage → development-rule table, maintenance rules, common operation migrations as pseudocode, and a four-step recipe for a new contributor. |
| `.agents/notes/proposed/architecture/2026-09-10-session-refactor-faq.zh.md` | Session 重构常见问题 — why `LogicalSession`, why concrete `Session` is not banned today, service vs storage, where projection fits, why no `SessionSearch`/`SessionStats`, what is complete, how to contribute. |
| `.agents/notes/proposed/architecture/2026-09-14-composer-model-and-draft-editor.zh.md` | Composer 与 DraftEditor 隔离的两阶段重构 — five mechanical extractions in stage one, behaviour-only changes in stage two, plus an explicit table of what isolation stage one does *not* achieve. |
| `.agents/notes/proposed/architecture/2026-09-20-unified-typert-remote-metadata.zh.md` | 统一 Typert/Remote 元数据 — ordinary artifacts replace committed generated source; consumer-selected strict input; independently lazy, cached projections; a withdrawn strict descriptor refuses invocation. |
| `.agents/notes/proposed/architecture/2026-09-29-session-migration-follow-redirect.zh.md` | 单会话迁移通过 follow 重定向呈现 — a typed business redirect (not HTTP 302) carries the migration phase to the client; progress never enters the session log; the read-vs-write completion milestone stays open. |
| `.agents/notes/proposed/architecture/2026-10-09-cordis-cleanup-dependency-lifetimes.zh.md` | 在消费者清理完成前保持清理依赖可用 — awaiting a provider's disposal promise does not establish resource survival; five P0 findings with controlled-promise regressions; explicit composition instead of global serialization. |
| `.agents/notes/proposed/bug-fix/2026-08-20-attachment-read-quarantine.zh.md` | 隔离无法读取的历史附件 — quarantine unreadable image references in a durable event, replace them with deterministic text in the projection, and allow recovery only after digest + metadata verification. |
| `.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.zh.md` | 工具执行前输入重写——一致性设计 — a rewrite must be resolved before the execution identity exists and reflected in all three readers (model history, durable audit, presentation) atomically. |
| `.agents/notes/proposed/feature/2026-07-06-recallable-compaction.zh.md` | 可回溯压缩：索引检查点、状态检查点与会话内历史回溯 — frozen index stubs + one mutable state checkpoint, the inflation guard, `history_read`/`history_search`, and the left-to-right commit that restores `[stubs…][state][tail]`. |
| `.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.zh.md` | 交互式侧会话与合并回写 — a side session is a normal live session forked at the last completed turn, framed as a read-only advisor by a plugin-sourced message (byte-identical system prompt preserved for prefix cache), merging back one length-capped note. |
| `.agents/notes/proposed/feature/2026-08-04-task-surface.zh.md` | 用于结构化会话交互的 Task Surface — the versioned declarative model, `show_task_surface` ending the turn, the Dock as the only actionable mount, transactional submission (`queued`/`claiming`), and the rejection of `edit`/`steer` on a correlated queue row. |
| `.agents/notes/proposed/feature/2026-09-08-desktop-mandatory-update-api.zh.md` | Desktop 强制更新接口 — the guest-accessible `check_client_update` endpoint, the required client headers, the `40005` body code, the no-force response, and the rule that service failures must not masquerade as success. |
| `.agents/notes/proposed/feature/2026-09-08-desktop-update-extensions.zh.md` | Desktop 更新后续扩展 — the reserved `.dsk.N` ordering, the Stable/Nightly feeds, the automatic-install setting matrix, next-launch installation, and the updater-dependency qualification table. |
| `.agents/notes/proposed/feature/2026-09-08-desktop-update-policy-and-installation.zh.md` | Desktop 更新策略与安装 — release/backend qualification, the open product choices, and the CDN-and-capacity checklist (node TTL vs client Cache-Control, the ~167 checks/second per 100k clients model). |
| `.agents/notes/proposed/feature/2026-10-03-pi-extensions-bridge.zh.md` | Pi 扩展桥接 — load unmodified Pi extensions, serve Pi's `ExtensionAPI` from DSH extension points, translate the six shared built-in tool names/arguments, and publish the 15-row core-gap table. |
| `.agents/notes/proposed/feature/2026-10-03-pi-plugins-compatibility.zh.md` | Pi 插件兼容——分级支持 — six levels with upstream triggers and DSH cost, the Pi→DSH service mapping, the runtime-differences table, and four Chord mechanisms worth evaluating for DSH independently. |
| `.agents/notes/proposed/process/2026-06-11-api-extractor-reports.zh.md` | API extractor 报告 — a checked-in `etc/<pkg>.api.md` per package, CI failing on drift; deferred because the packages are unpublished. |
| `.agents/notes/proposed/process/2026-06-11-supply-chain-and-vendor-drift.zh.md` | 供应链检查与 vendor 漂移验证 — nightly vendor drift reconstruction from manifest SHAs + checked-in patch files, advisory scanning, a license inventory, and dependency-update PRs excluding vendored packages. |
| `.agents/notes/proposed/process/2026-06-20-discover-package-inventory.zh.md` | 通过发现机制获取包清单，而非维护静态列表 — generate aggregate `references` and the module graph from the package hierarchy, with a `--check` gate; static lists are fine only when they encode policy. |
| `.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.zh.md` | dsh-code-review 的定期人工评审维护 — merge-commit reachability as the eligibility check, two PR-specific patch snapshots as adoption evidence, dual independent reviewers, nonce-tagged untrusted-feedback blocks, and batch-level fail-closed. |
| `.agents/notes/proposed/process/2026-07-26-remove-packed-session-fixture-migrator.zh.md` | 移除打包会话 fixture 分支迁移器 — remove the temporary writer once live PR evidence says the window closed; keep the permanent canonical-layout gate. |
| `.agents/notes/proposed/process/2026-08-20-audience-first-documentation-quality.zh.md` | 以受众为先的文档质量标准 — Brief/Intuitive/Friendly/Accurate/Agent-readable, criteria by document job, the entry-layer/detail-layer split for generated references, and the four defects that pass today's gates. |
| `.agents/notes/proposed/simplification/2026-09-17-defer-office-background-scheduling.zh.md` | 待调用方需要时再引入 Office 后台调度 — remove priority/promotion/background scheduling, but only after the named prewarming consumer is reconciled; absence from master is not sufficient evidence. |
| `.agents/notes/proposed/simplification/2026-09-19-config-only-hmr.zh.md` | 将 DSH HMR 限定为实时 profile 配置更新 — keep config refresh, drop module replacement and its rollback; removed options get an explicit migration error. |
| `.agents/notes/proposed/simplification/2026-09-19-provider-only-instruction-reads.zh.md` | 仅通过文件系统提供方读取指令文件 — require `FileSystem` throughout discovery and loading; delete the direct-Node path; keep the plugin's missing-provider no-op. |
| `.agents/notes/proposed/simplification/2026-09-19-prune-stream-visibility-helpers.zh.md` | 精简未使用的流可见性辅助函数 — delete five visibility queries and their private helpers, keep the first-token/assembly readers, and update both READMEs and the subsystem page. |
| `.agents/notes/proposed/simplification/2026-09-19-python-sdk-directional-client.zh.md` | 删除 Python SDK 未使用的反向 RPC — remove the reverse queue and four methods, keep an explicit guard against a server frame settling an unrelated pending request; the shared TS transport stays bidirectional. |
| `.agents/notes/proposed/simplification/2026-09-19-retire-app-bin-boot-helpers.zh.md` | 删除仅供 fixture 使用的 app-boot 辅助函数 — delete `resolveConfigPath` and `loadEnv`; keep `boot`/`loadLayeredEnv`; do not substitute layered env discovery for the fixture-local `.env`. |
| `.agents/notes/proposed/simplification/2026-09-19-retire-prompt-registry-change-event.zh.md` | 停用提示词注册表变更事件 — retire `system-prompt/change`, make `ScopedLayers`' notification callback optional, and amend (not archive) the owning Remote-delivery decision. |
| `.agents/notes/proposed/simplification/2026-09-19-shell-env-key-declarations.zh.md` | 让 shell 环境声明只负责键所有权 — declarations become a readonly key collection; descriptions, `list()` and the diagnostics catalog go. |
| `.agents/notes/proposed/simplification/2026-09-19-trim-session-query-convenience-api.zh.md` | 精简未使用的 SessionQuery 便利方法 — remove four methods, the `SessionLogSnapshot` type and `eventRecords`; keep the literal-substring `filterEvents` because it differs from FTS token matching. |
| `.agents/notes/proposed/testing/2026-06-11-deterministic-and-stress-testing.zh.md` | 确定性测试、回放不变式 fixture 与竞态压力测试 — ban wall-clock sleeps via lint, replay every test's log and assert `deriveMessages()` equality, and run a nightly `--repeat --shuffle` stress job. |
| `.agents/notes/proposed/testing/2026-06-11-mutation-testing.zh.md` | 变异测试作为覆盖率的制衡手段 — Stryker over `packages/*/src`, PR-scoped incremental plus a nightly ratcheting score, surviving mutants as work items, equivalent mutants annotated with reasons. |
| `.agents/notes/rejected/architecture/2026-06-16-typed-event-schemas.zh.md` | 事件词汇的运行时 schema — declined: a runtime registry's blast radius (six maps, ~10 augmentation sites, 16 append sites, ~7 switch consumers), Zod vs schemastery, and the weakened `assertNever` guarantee. |
| `.agents/notes/rejected/simplification/2026-06-20-drop-durable-step-boundaries.zh.md` | 移除持久化的步骤边界事件 — declined: `step/end` is the durable indication a model step finished, making crash repair, invariants and transcript inspection clearer. |
| `.agents/notes/rejected/simplification/2026-06-20-fold-session-persistence-interface.zh.md` | 将持久化接口合并进 dsh-session — declined: the Service Definition package is the intended role split; folding it in trades a cleaner backend boundary for one fewer package. |
| `.agents/notes/rejected/simplification/2026-06-20-truncate-interrupted-turns.zh.md` | 加载时截断被中断的最终轮次 — declined: one turn can hold substantial real work; preserving the interrupted tail beats silently dropping it. |
| `.agents/notes/rejected/simplification/2026-07-12-prune-unused-skill-registry-api.zh.md` | 裁剪 skill 注册表中未使用的接口 — declined: direct runtime skill registration is a deliberate third-party extension path. |
| `.agents/notes/rejected/simplification/2026-07-19-fold-compaction-package-split.zh.md` | 将唯一的压缩后端并入服务包 — declined: more compaction backends are planned, so the Service Definition and provider packages stay separate. |
| `.agents/notes/rejected/simplification/2026-07-26-builtin-timer-promises-for-hand-rolled-sleeps.zh.md` | 用 node:timers/promises 替代手写的可取消休眠 — declined: PR #679 showed vitest's fake clock does not intercept the builtin, costing deterministic fast tests for ~10 deleted lines. |
| `.agents/notes/rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.zh.md` | 2026-07 NIH 审计否决的依赖替换 — the frozen negative verdicts for ~30 dependency swaps, each naming the load-bearing hand-rolled shape; a future proposal must beat the recorded reason. |

### Tier 3 — skipped with a reason

All 51 `generated-vendored`-typed files are the **bilingual-pair consistency sidecars**. Confirmed by inspection
(head + tail of every file): each is a small YAML document (16–55 lines) whose header reads
`# Bilingual-pair consistency record for <file>.md (docs/i18n/README.md): per heading section, a hash of its
English and Chinese blocks outside code blocks and generated regions`, followed by a `/heading-path:` mapping with
an `en:` and a `zh:` 16-hex-digit hash per heading section. They contain **no prose and no decision content** —
they exist so `pnpm run verify-translation-pairing` can prove the English and Chinese halves of a note still
correspond section-for-section after an edit.

Not read line by line; each was opened to confirm its format, its owning English file, its line count, and its
first and last entries.

| File | Why not read line by line |
| --- | --- |
| `.agents/notes/README.i18n.yaml` | Generated hash sidecar (46 lines); format confirmed from head and tail. |
| `.agents/notes/proposed/architecture/2026-07-19-required-cancellation-through-tool-capability-seams.i18n.yaml` | Generated hash sidecar (25 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.i18n.yaml` | Generated hash sidecar (49 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.i18n.yaml` | Generated hash sidecar (49 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-07-28-storage-root-and-derived-medium-recovery.i18n.yaml` | Generated hash sidecar (28 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-07-29-durable-last-activity-index.i18n.yaml` | Generated hash sidecar (25 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-08-08-semantic-composer-chain-phases.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-09-06-logical-session-storage-rebuild.i18n.yaml` | Generated hash sidecar (55 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-09-10-session-capability-protocols.i18n.yaml` | Generated hash sidecar (46 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-09-10-session-data-compatibility.i18n.yaml` | Generated hash sidecar (31 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-09-10-session-developer-transition.i18n.yaml` | Generated hash sidecar (31 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-09-10-session-refactor-faq.i18n.yaml` | Generated hash sidecar (46 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-09-14-composer-model-and-draft-editor.i18n.yaml` | Generated hash sidecar (40 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-09-20-unified-typert-remote-metadata.i18n.yaml` | Generated hash sidecar (34 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-09-29-session-migration-follow-redirect.i18n.yaml` | Generated hash sidecar (25 lines); format confirmed. |
| `.agents/notes/proposed/architecture/2026-10-09-cordis-cleanup-dependency-lifetimes.i18n.yaml` | Generated hash sidecar (43 lines); format confirmed. |
| `.agents/notes/proposed/bug-fix/2026-08-20-attachment-read-quarantine.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.i18n.yaml` | Generated hash sidecar (31 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-07-06-recallable-compaction.i18n.yaml` | Generated hash sidecar (46 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-08-04-task-surface.i18n.yaml` | Generated hash sidecar (40 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-09-08-desktop-mandatory-update-api.i18n.yaml` | Generated hash sidecar (43 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-09-08-desktop-update-extensions.i18n.yaml` | Generated hash sidecar (43 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-09-08-desktop-update-policy-and-installation.i18n.yaml` | Generated hash sidecar (31 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-10-03-pi-extensions-bridge.i18n.yaml` | Generated hash sidecar (43 lines); format confirmed. |
| `.agents/notes/proposed/feature/2026-10-03-pi-plugins-compatibility.i18n.yaml` | Generated hash sidecar (46 lines); format confirmed. |
| `.agents/notes/proposed/process/2026-06-11-api-extractor-reports.i18n.yaml` | Generated hash sidecar (25 lines); format confirmed. |
| `.agents/notes/proposed/process/2026-06-11-supply-chain-and-vendor-drift.i18n.yaml` | Generated hash sidecar (25 lines); format confirmed. |
| `.agents/notes/proposed/process/2026-06-20-discover-package-inventory.i18n.yaml` | Generated hash sidecar (19 lines); format confirmed. |
| `.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.i18n.yaml` | Generated hash sidecar (40 lines); format confirmed. |
| `.agents/notes/proposed/process/2026-07-26-remove-packed-session-fixture-migrator.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/process/2026-08-20-audience-first-documentation-quality.i18n.yaml` | Generated hash sidecar (52 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-17-defer-office-background-scheduling.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-19-config-only-hmr.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-19-provider-only-instruction-reads.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-19-prune-stream-visibility-helpers.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-19-python-sdk-directional-client.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-19-retire-app-bin-boot-helpers.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-19-retire-prompt-registry-change-event.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-19-shell-env-key-declarations.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/simplification/2026-09-19-trim-session-query-convenience-api.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/testing/2026-06-11-deterministic-and-stress-testing.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/proposed/testing/2026-06-11-mutation-testing.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/rejected/architecture/2026-06-16-typed-event-schemas.i18n.yaml` | Generated hash sidecar (40 lines); format confirmed. |
| `.agents/notes/rejected/simplification/2026-06-20-drop-durable-step-boundaries.i18n.yaml` | Generated hash sidecar (19 lines); format confirmed. |
| `.agents/notes/rejected/simplification/2026-06-20-fold-session-persistence-interface.i18n.yaml` | Generated hash sidecar (19 lines); format confirmed. |
| `.agents/notes/rejected/simplification/2026-06-20-truncate-interrupted-turns.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/rejected/simplification/2026-07-12-prune-unused-skill-registry-api.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/rejected/simplification/2026-07-19-fold-compaction-package-split.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/rejected/simplification/2026-07-26-builtin-timer-promises-for-hand-rolled-sleeps.i18n.yaml` | Generated hash sidecar (22 lines); format confirmed. |
| `.agents/notes/rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.i18n.yaml` | Generated hash sidecar (16 lines); format confirmed. |

---

## 2. Ideas worth stealing

1. **The whole-value event rule — one event type, one meaning, one client rule.**
   *What:* every state-carrying log event carries the complete post-change state, never a delta; the client keeps a
   generic `key → {value, seq}` store under a single **higher-seq-wins** rule.
   *Where:* `.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md:23` and `:92`.
   *Why it transfers to August Trading:* August Trading's transcript has per-domain fences — the answer's own
   `Message.isStreaming` projection, the two-home live-sync fence, the dock/Agents surfaces each keeping their own
   view of a turn. One generic seq-guarded store with one "latest whole value wins" rule would replace the
   per-domain fences and make "a missed update is corrected by the next one" true by construction.
   `UNIQUE` to this repo in this shard (the other two repos are not covered by this shard).

2. **Durable command lifecycle — log the invocation and the verdict, not a transient toast.**
   *What:* two log-only events (`command/run`, `command/done`) make every slash command's outcome survive a
   refresh, a second tab, a resume and a fork; the RPC degrades to *admission* (`{matched, commandId?}`).
   *Where:* `.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md` ("Command
   lifecycle in the log").
   *Why it transfers:* August Trading has slash-style surfaces (automation schedules, `/compact`-like commands,
   the learn/apply flow) whose outcomes currently live in ephemeral UI notices. Logging the invocation *and* the
   verdict would make "what did the agent actually do when I asked" answerable after the fact — which is exactly
   what a trade log needs.
   `UNIQUE` in this shard.

3. **Declarative derived media: `recovery: 'reject' | 'reset'` per domain.**
   *What:* a domain declares whether its medium is authoritative or derived. A derived medium that is damaged
   (`version-mismatch`, `malformed-medium`, `invalid-record`) is reset and rebuilt; an authoritative one fails
   loud. The reset fires only on a closed list of parse-time codes and is single-shot.
   *Where:* `.agents/notes/proposed/architecture/2026-07-28-storage-root-and-derived-medium-recovery.md:27`.
   *Why it transfers:* August Trading has exactly this shape — the notebook and the learning stores are derived
   from trades, while the trade log itself is authoritative. Today a corrupt derived store can block the app
   (or, worse, silently serve a stale in-memory copy). A per-store authority declaration with a reset path is
   directly applicable.
   `UNIQUE` in this shard.

4. **Authority is a per-domain declaration, not a global policy.**
   *What:* the same note rejects a blanket auto-reset: "`workspace.json` is authoritative user data; silently
   resetting it on a version bump would destroy workspaces. Authority is a property of the domain and must be
   declared by its owner."
   *Where:* `.agents/notes/proposed/architecture/2026-07-28-storage-root-and-derived-medium-recovery.md`
   (Alternatives considered).
   *Why it transfers:* August Trading's `MemoryFilesService.getNotebookWriteFailure()` and the
   `ExportService.RAW_LOCAL_STORAGE_PREFIXES` list show the same instinct — but the *decision* of
   authoritative-vs-derived is currently implicit per store. Making it explicit per store is cheap and prevents
   the worst possible bug (silently wiping a trade journal).
   `UNIQUE` in this shard.

5. **Recallable compaction — frozen index stubs + one mutable state checkpoint + model-readable recall tools.**
   *What:* split the checkpoint into an immutable *index* (byte-stable stubs, so the prompt cache is preserved) and
   a mutable *state* document (the model's working memory); expose the shadowed history back to the model through
   `history_read` / `history_search` as a pure function of the log; guard the pass with an inflation check that
   commits nothing if the result is not smaller.
   *Where:* `.agents/notes/proposed/feature/2026-07-06-recallable-compaction.md:25` (footer), `:33` (inflation
   guard), and the "The recall tools" section.
   *Why it transfers:* August Trading's context management compacts transcripts and loses the shadowed span
   permanently. The *three* transferable pieces are: (a) the deterministic, code-composed pointer footer so the
   model can see what it is missing; (b) a recall tool that reads the log rather than a summary; (c) the
   "commit nothing unless it got smaller" guard, which prevents a compaction that grows the prompt.
   `UNIQUE` in this shard.

6. **A declarative, versioned "Task Surface" — structured UI as a data model, not code.**
   *What:* the model publishes a JSON model (`TaskSurfaceModelV1`) that a normal client plugin renders; the call
   ends the turn; the user's submission becomes an ordinary visible user message with structured correlation;
   the product owns validation and placement, the agent owns copy and data.
   *Where:* `.agents/notes/proposed/feature/2026-08-04-task-surface.md:82` and the submission contract.
   *Why it transfers:* August Trading's trade-plan validation and proposal cards are exactly the "compare options,
   fill a few fields, submit a conclusion" shape. The transferable design decisions are: bounded byte/count limits
   as schema-backed config; `alt-only` image rendering and no model-supplied URL dereference; the Dock being
   independent of transcript pagination so the panel survives paging; and **the submitted conclusion being the
   durable artefact, not the panel**.
   `UNIQUE` in this shard.

7. **Cleanup-dependency lifetimes: awaiting a provider's disposal promise does not keep the resource alive.**
   *What:* a resource's owner must retain it through its consumers' complete asynchronous cleanup; the
   alternative (catch the closed-resource error) hides a real failure — here it silently reported a *successful*
   credential write as `NOT_COMMITTED`.
   *Where:* `.agents/notes/proposed/architecture/2026-10-09-cordis-cleanup-dependency-lifetimes.md:15` and the five
   P0 findings.
   *Why it transfers:* August Trading runs background work (auto-capture, outcome autopilot, automations, the
   Electron shell). The pattern "the storage closed while the flusher was still writing" is the same race. The
   transferable discipline is the **controlled-promise regression**: pause the real consumer before its last
   dependency use, start the provider's disposal, release the pause, and assert the *live vs restored* result —
   not merely that `close()` ran.
   `UNIQUE` in this shard.

8. **Phased chains instead of a single global priority number.**
   *What:* when one numeric `priority` is doing two different jobs, split it into declared, domain-owned phases
   (`['interaction','restriction']`); phase index dominates local priority; the runtime repeats the phase tuple so
   drift is mechanically rejectable.
   *Where:* `.agents/notes/proposed/architecture/2026-08-08-semantic-composer-chain-phases.md:11` and `:15`.
   *Why it transfers:* August Trading's composer has multiple takeover kinds (question, approval, the answer
   surface, the learn/apply flow). One scalar priority means the same class of bug DSH just hit: a low-priority
   surface can win over a pending interaction. The rule to steal is *"one number, two decisions is a defect"* —
   and the fix is a declared phase tuple, not a bigger number.
   `UNIQUE` in this shard.

9. **A switchable enforcement gate with a warn→enforce ratchet.**
   *What:* a gate reports every binding of the deprecated class; the checked-in default is `warn` (prints, emits
   `::warning` annotations, exits 0) so in-flight branches merge; flipping the default to `enforce` after the
   migration completes makes it reject.
   *Where:* `.agents/notes/proposed/architecture/2026-09-06-logical-session-storage-rebuild.md:94`.
   *Why it transfers:* August Trading's `AGENTS.md` already documents several "single source of truth" modules that
   are aspirational for some call sites. This is the mechanism for making "use the one module" true without
   blocking anyone's branch: ship the detector in warn mode, publish the count, then flip it.
   `UNIQUE` in this shard.

10. **The Agent Note system itself — a decision record per decision, with a mandatory Alternatives section and a
    supersession check on every new note.**
    *What:* path-encoded lifecycle (proposed/implemented/rejected/archived) × class; a fixed in-file skeleton per
    lifecycle; `## Alternatives considered` is mandatory ("a decision recorded without what it beat invites
    re-litigation"); every new note triggers a supersession check; rejected notes are deleted once their rationale
    stops preventing a plausible mistake.
    *Where:* `.agents/notes/README.md:19`, `:126`; `.agents/notes/AGENTS.md:5`.
    *Why it transfers:* August Trading has `docs/plan/` with an open-items list and an implementation record, but
    no *rejection* record and no per-decision rationale. The rejected-note discipline is the missing half: a
    rejected proposal that is deleted loses the "someone already tried this" fact, and DSH deliberately keeps
    those files for exactly the reason a future contributor needs.
    `CONVERGENT`-adjacent: the *idea* of a durable decision record appears in all three repos' doc trees, but the
    lifecycle + mandatory-alternatives + supersession machinery is DSH's own.

---

## 3. Trading-specific findings

**Long-lived monitoring & scheduled work — not in this shard.** No note in `.agents/notes/proposed/` or
`rejected/` describes a cron-style scheduler, a price/TP/SL watcher, or a periodic digest. The closest material is
adjacent and quoted by the shard rather than contained in it:
- **The Office conversion queue** (`.agents/notes/proposed/simplification/2026-09-17-defer-office-background-scheduling.md:11`)
  is the repo's only worked example of a *prioritised background worker with bounded capacity*: foreground
  promotion, a reserved foreground reader allowance, eviction of queued background work, independent background
  concurrency accounting. The note's conclusion is that all of it should be **deleted** because no production
  caller uses it — which is the answer to "how do you keep scheduled work honest": *delete the scheduler features
  no consumer needs.* The capacity mechanics themselves (source reservation, shared reader limit, delayed capacity
  release) are the transferable part.
- **Scheduled delivery and its restart semantics** are described in the cleanup note
  (`.agents/notes/proposed/architecture/2026-10-09-cordis-cleanup-dependency-lifetimes.md:29`, "Storage closes before
  Schedule commits accepted delivery"): the accepted delivery flushes the session *before* retiring or advancing
  the task, and the crash window between session persistence and task commit means **a reminder already persisted
  in the inbox can be delivered again after restart** (`:33`) — i.e. the system is explicitly at-least-once, and the
  note's acceptance criterion is "restarting does not redeliver that completed occurrence" while keeping the
  separately-documented abrupt-crash duplication policy. That is the honest shape of a scheduler's idempotency
  story, and it is a direct caution for August Trading's automation runner.

**Human-in-the-loop approval — the repository has an approval *chain* and an audit record, but no approval *ledger*.**
- The composer's `interaction` phase is where question and approval live
  (`.agents/notes/proposed/architecture/2026-08-08-semantic-composer-chain-phases.md:17`), and the domain rule is
  precise: "an interaction resolves a live Host wait that already exists; a restriction prevents the user from
  initiating work through the ordinary composer." That distinction — *answering an existing wait* vs *starting new
  work* — is the same distinction August Trading needs between "the trader approved this proposal" and "the trader
  opened a new chat".
- The **audit trail** for a consequential action is the session log: `tool/call` is "the durable AUDIT record,
  appended before `ctx.tools.execute()`"
  (`.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.md:16`), and a rewritten call keeps the
  *original* arguments in a sidecar field — "a hook changed the call, and both the original and the effective
  arguments are facts worth keeping."
- What DSH **does not** have, and what August Trading should notice: there is no note anywhere in this shard that
  records *who approved what, when, and what changed afterwards* as a durable approval record. The approval is a
  message in the transcript; the decision's *effect* is a log event. For trading, where an approval gates a real
  order-shaped action, the ledger needs to survive compaction, resume and export as a first-class record.

**Post-mortem / reflection loops — one note is a reflection loop, and it is deliberately narrow.**
`.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:9` is the only reflection mechanism in
the shard, and its *anti-accumulation* rules are the valuable part:
- **Only adopted, human-authored feedback becomes a rule.** Two independent reviewers must both confirm the
  feedback was human-authored *and* adopted; a merge, a resolved thread, or an author's "fixed" reply is context,
  not proof.
- **Recurrence is not required** — a singleton may qualify — but the *classification* is what prevents bloat:
  candidate / already covered / implementation-specific / not feedback. "Treating every comment as a lesson
  produces checklist bloat." (`:9`)
- **Disagreement is bounded, not escalated**: one bounded re-evaluation, then the item stays visible in run
  artefacts as unresolved (`:41`).
- The mechanism's own cost is named: a single-maintainer bus factor, and "the tool first needs a track record of
  useful periodic output" before it may open or merge anything automatically.

**Multi-agent — DSH's multi-agent story is "fork the session, not debate the answer".**
`.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.md` is the clearest statement of where a
second agent earns its cost: a side session is a *user-driven* fork with an advisor framing, whose conclusion
merges back as one length-capped note; the subagent seam is explicitly rejected for this because "subagents are
model-driven runs returning one tool result" (`.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.md:24`). The Pi bridge note adds the honest cost of the alternative:
"Levels 1 to 4 run plugin code in the Host process, where one uncaught error stops every Session"
  (`.agents/notes/proposed/feature/2026-10-03-pi-extensions-bridge.md:137`) and "An extension bug stops one Pi process"
  (`:95`) vs DSH's "an uncaught exception in the Host disposes the application for every Session."
So: debate is not modelled anywhere in this shard; **fan-out with a merge-back artefact** is.

**Structured logs the model can query — the session event log plus a projection cache, no database.**
The answer is the `dsh-session-projection` design
(`.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md`): events are the durable
truth, derived state is a *projection* over them, and the projection is persisted as rows of
`(sessionId, key, ver, seq, val)` in a domain-KV store with a watermark
  (`.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md:59`). The query surface is `SessionQuery`
(exact reads, filters, traces, full-text, list metadata, statistics) over rebuildable indexes — "Search indexes
and statistics aggregations are projections/providers behind query"
  (`.agents/notes/proposed/architecture/2026-09-10-session-capability-protocols.md:56`). Storage is JSONL (one file per session) plus
optional SQLite, with `node:sqlite` and STRICT tables, `PRAGMA user_version` for the layout version, and
document-per-row so a single-key change does not rewrite the domain
(`.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md:79-83`).
The key property for a trading log: **a derived index is never the recovery authority** — "Search/statistics caches
are derived data that can rebuild from canonical Session content and cannot become recovery authority"
(`.agents/notes/proposed/architecture/2026-09-10-session-data-compatibility.md:27`).

**Staying simple as features accumulate — the corpus itself is the warning.**
The `simplification` class and the whole `rejected/` tree exist to keep the *record* of what was declined. The
mechanisms that keep the count down:
- **A closed class set** (`feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`) with a gate
  rejecting other folders (`.agents/notes/README.md:34`) — and `refactor` deliberately folded into `simplification`.
- **Deletion rules**: an implemented note describing only small UI adjustments or purely mechanical changes is
  *deleted* (with its triplet), not archived (`.agents/notes/README.md:14`); a rejected note is deleted once its rationale no longer prevents a
  plausible mistake. The archive exists for "historical decision value but little future guidance", not as a
  dumping ground.
- **"Absence of a fixed in-repo registration is not evidence of non-consumption"** is stated as an explicit
  constraint on simplification proposals
  (`.agents/notes/rejected/simplification/2026-07-12-prune-unused-skill-registry-api.md:15`) — the note *rejected* a
  simplification partly because a scoped registration could legitimately live elsewhere.
- The corpus measurement in the audience-first doc note is the metric: 1,042 English Markdown files, 1,106,138
  English words; active Agent Notes alone are 580 files / 637,850 words
  (`.agents/notes/proposed/process/2026-08-20-audience-first-documentation-quality.md:35`). The proposal's answer to "the standard has
  no room for its next rule" is to *extract* the rules into one canonical reference and shrink the standing file
  below its target (`:29`), rather than appending.

---

## 4. Non-obvious decisions and gotchas

1. **A note's `Status:` line and its folder must agree, and the rejection reason lives there.** A machine gate
   cross-checks them (`.agents/notes/README.md:70-74`). The rejected status is the *only* status with content,
   because "a rejected Agent Note's verdict is the fact readers come for."
2. **The `.zh.md` counterpart's `Status:` line stays in English verbatim** — including the rejection reason —
   so the pairing gate can compare it byte-wise (`.agents/notes/README.md:125`). Some Chinese files also keep
   English section headings (`2026-09-10-session-capability-protocols.zh.md` uses `## Problem`, `## Proposal`,
   `## Acceptance criteria`), so the machine-checked tokens are not the only English residue.
3. **The i18n sidecar hashes *sections*, not files.** The YAML key path is the heading path
   (`/agent-notes/the-file-format/the-header-block:`), and the hash covers the block *outside code blocks and
   generated regions* — so a code block can differ between the two languages without breaking the pairing gate.
   That is the escape hatch for translated code samples.
4. **A proposed note may speak in the future tense; an implemented note may not.** `## Proposal`, `## Plan`,
   `## Migration plan` and `## Acceptance criteria` are *rejected* in an implemented note — "the slop checklist
   names why" (`.agents/notes/README.md:103`).
5. **An implemented note must be updated when the code moves.** "when the code later moves a file, renames a
   package, or changes a key/default, the Agent Note is updated in the same change to match (facts only — paths,
   names, structure — not the decision itself)."
6. **"Supersession" is not "deletion".** A feature note may be folded into its own removal note only under a
   strict absence test (production code, configuration, schemas, durable/wire formats, migration, compatibility
   behaviour, documentation, tests). Removing one transport, default or presentation is *partial* supersession —
   both notes stay, cross-linked. This is the most reusable rule in the shard.
7. **The `.agents/notes/archived/` tree is frozen.** "Once sealed, every archived triplet is permanently frozen.
   Do not edit, translate, reformat, update, move, or delete it, and do not treat it as authority for current
   behavior." Documentation gates skip archived sources including their outbound links.
8. **`Status: rejected` notes are kept only while their rationale prevents a *meaningful* mistake** — and deleted
   otherwise, together with the Chinese sidecar and the sidecar record. The English/Chinese/sidecar triplet moves
   as one unit, always.
9. **Several notes in this shard are proposals to *remove* something, and the removal is gated on evidence rather
   than on taste** — "absence from master is insufficient evidence to proceed"
   (`2026-09-17-defer-office-background-scheduling.md:11`), "Refresh consumer evidence before implementation …
   do not claim ecosystem-wide non-use" (`2026-09-19-prune-stream-visibility-helpers.md`), and the recorded
   acceptance line "no production caller gains an expansion or replacement visibility query."
10. **The `rejected/` tree carries the load-bearing negative knowledge.** The NIH dependency note (~30 refusals)
    and the typed-event-schemas note (a whole-vocabulary redesign declined with a measured blast radius) are more
    useful to a future contributor than several `proposed/` notes.

---

## 5. Weak spots

1. **`proposed/` is a large, undated backlog.** The shard contains 51 active proposals spanning
   2026-06-11 → 2026-10-09, and nothing in the format says which is live, which is blocked, or which is waiting
   on what. The README's answer — "The active lifecycle tree is the working inventory: browse its lifecycle/class
   folders or search the repository" (`:19`) — plus a ban on `INDEX.md` — trades a stale index for a slow search.
   For a team, that is a real tax; there is no status field, no owner, and no priority beyond the filename date.
2. **The notes are long, and the length is not itself policed.** The audience-first doc note measures the corpus
   at 1.1M English words with 637,850 of them in Agent Notes — larger than the `docs/` tier it is supposed to
   support. The proposed fixes are "extract the canonical reference" and "one canonical quality reference", but
   the note-per-decision format has no word budget, and a decision record with a full Alternatives section plus
   Risks and Acceptance criteria is inherently verbose.
3. **Several proposals are honest drafts, not decisions, and their acceptance criteria are partly aspirational.**
   `2026-09-08-desktop-update-extensions.md` states plainly that none of its platform claims "have been exercised
   locally"; `2026-09-10-session-capability-protocols.md` says its signatures "are targets and are not all
   implemented in Stage 3"; `2026-09-20-unified-typert-remote-metadata.md` says "the generated metadata is not
   evidence that every #4111 operation or CLI/MCP application has migrated." A reader must check each note's status
   prose rather than trusting its structure — the structure looks equally finished in all three cases.
4. **The bilingual duplication is a large, machine-enforced maintenance surface.** 51 notes × 2 languages × 1
   hash sidecar, with the pairing gate requiring the two sides to change together. For a repo that wants to move
   fast, every English edit becomes two edits plus a sidecar re-record — and the sidecar's per-heading hashing
   means a single restructured section invalidates that section's hash on both sides.
5. **Two shards of this tree are near-duplicates of each other by construction.** The `proposed/` and `rejected/`
   trees contain overlapping subjects (persistence, compaction, session interfaces, skill registry) with the same
   prose scaffolding, which makes the *set* expensive to read even though any single note is good. A reader wanting
   "what did we decide about compaction" must read both a proposed note and a rejected one — the README's
   cross-linking requirement is the only thing making that tractable.
