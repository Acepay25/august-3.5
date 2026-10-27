# Memory loop gap audit + the gaps (2026-10-24)

Second pass of the ported design. Phase 0 first: HEAD == origin/main (8f3c347e),
clean tree, one worktree, no stashes (prompt said origin/master; repo has origin/main). Memory chain verified LIVE on isolated
storage (bundled profileMemory, Map-backed localStorage): write → system-of-record
key → list/slug reads → injection index → if_version bump + conflict → forget —
all hold. Nothing retired was recreated; no parallel system added.

## Gap table (Phase 0 verdicts; evidence at the cited file:line)

| # | Item | Verdict | Evidence / gap |
|---|------|---------|----------------|
| 1 | SKILL.md format | **EXISTS** | `parseSkillMarkdown` (byte-0 `---`), unknown keys round-trip (`f5a48976`), face validation, folder import (`9f76a065`), skip-with-logged-reason in `listSkills` |
| 2 | Optional keys + gating | **EXISTS** (fallback_for_* deferred) | `utils/skillFrontmatter.skillRunsHere`; requiresEnv fails closed by design |
| 3 | Progressive disclosure | **EXISTS** (2 deviations) | `skill_view` L0/L1/L2, traversal refused, substitutions; symlinks N/A (notebook store, no fs) and scripts stay text (no terminal tool) — repo wins, documented |
| 4 | Roots and precedence | **DEVIATION (repo wins)** | one notebook store; starter shelf = `prior:'book'`; uniqueName gives -2 instead of override. No dir roots to build |
| 5 | Authoring caps + Use-when warn | **MISSING** | no 200-line/100k cap, no "Use when" warn (grep 0) → BUILD (e) |
| 6 | Install from URL + content scan | **PARTIAL** | folder import done; URL + exfiltration/destructive scan missing → BUILD (e) |
| 7 | Record shape (tag/sensitive/aliases/subject) | **PARTIAL** | version/timestamps/source exist (`profileMemory.ts`); tag/sensitive/aliases MISSING (grep 0) → BUILD (b) |
| 8 | Listing-first recall | **EXISTS** | `buildProfileMemoryIndex` + `buildNotebookTopicsIndex` (≤150 clamp), batched `read_memory` |
| 9 | if_version + history | **PARTIAL** | if_version live-verified; "now X, previously Y" missing → BUILD (b) |
| 10/11 | Write/recall triggers | **EXISTS** | seat prompt blocks (`86e9853f`) |
| 12 | Write filters (secrets, sensitive, honesty) | **MISSING** | grep 0 → BUILD (b), same module as 7 |
| 13 | Subagents/cron read-only | **EXISTS (verify)** | executor chokepoint `seatAllows`; DETACHED_EVAL_TOOLS derives from CHAT_SURFACE_TOOLS minus writes — re-verified below |
| 14 | One combined budget | **MISSING** | both indexes injected, unscaled (`chatSurfaceTurn.ts:150`) → BUILD (c) |
| 15 | Alias pre-read | **PARTIAL** | matcher exists; aliases + sensitive-skip need item 7's fields → BUILD (c) |
| 16 | Save chip with undo | **MISSING** | grep 0 → BUILD (d) |
| 17 | Untrusted input | **EXISTS** | `utils/untrusted.ts` choke point (review-verified) |
| 18 | Minimal UI | **PARTIAL** | skills list + toggle exist; topics card lacks the stated/inferred marker; memory-off toggle exists BUT is broken on the chat path → BUILD (a)+(f) |

## Build order (the prompt's priority)

- **(a) broken path:** `isGlobalMemoryEnabled` gates the analysis pipeline but NOT the
  chat surface's profile/topics injection (`chatSurfaceTurn.ts:145`) nor the dock's —
  "turn memory off entirely" is a promise the chat path breaks. Thread the flag.
- **(b) items 7+9+12:** `tag`/`sensitive`/`aliases` on ProfileMemoryEntry (additive,
  absent = legacy, no migration needed — localStorage JSON; backup via
  ExportService.RAW_LOCAL_STORAGE_PREFIXES already covers the key); `previous` on edit
  ("now X, previously Y"); `memoryWriteFilters` (secrets/card/ID patterns, sensitive
  categories behind the existing setting, honesty-suppression rejection) wired into the
  remember handler with the reason returned.
- **(c) items 14+15:** one combined index budget scaled by the resolved context window
  (`promptIndexBudget`); aliases + never-sensitive in `buildMemoryHints`.
- **(d) item 16:** undo on the memory-save transcript row → `forgetProfileMemory`.
- **(e) items 5+6:** body caps (200 lines soft / 100k hard) + "Use when" warn in the
  authoring path; URL import with fetch-timeout + exfiltration/destructive scan.
- **(f) item 18:** stated/inferred marker on the topics card; re-verify 13.

Status per row updated in this file per commit.

## Landed (all six build items, 2026-10-24)

- (a) `c1ab20b5` — the memory toggle gates the chat path and the dock.
- (b) `b1ac29e3` — tag/sensitive/aliases/previous + `memoryWriteFilters`.
- (c) `4204d7e8` — `promptIndexBudget`, one shared table scaled to the window.
- (d) `0852c192` — the save chip label + Undo.
- (e) `9ea71c5c` — caps, Use-when warn, `fetchSkillFromUrl`, `scanSkillText`.
- (f) `59c213d9` — the sensitive toggle + the provenance markers.

Contract layer: 84 assertions. Live chain re-verified after the changes. Later, still: autonomous evolution
rails; `fallback_for_*`.

## The review's surviving defects, closed (2026-10-27)

A four-auditor review of the same spec found the machinery real but named three
defects that survived on every branch, plus one seat that ignored two settings.
All four are now fixed on `goal-workspaces-20261025`, each with a red-proved arm:

- **The 40-fact ceiling silently evicted.** `writeAll` ended in
  `entries.slice(-40)`, so the 41st new fact dropped the oldest while the tool
  answered `saved: true`. The store now REFUSES growth at the cap
  (`rememberProfileMemory`) and writes exactly what it is given; the production
  path never reaches the refusal because `rememberWithConsolidation` frees a
  slot first, which is the point — the refusal is the net for a caller that
  skipped it. Red proof: with the refusal removed, the arm reports
  `persisted=true count=40` and `first=cap-1` — the newest fact saved, the
  oldest gone.
- **The approval path skipped the body contract.** `skillBodyCaps` / the
  Use-when check ran only in the import service (and as a courtesy in
  `propose_skill`), so a draft from a post-mortem craft, or one queued before
  those gates existed, could be approved with a body no import would accept.
  `craftedBodyGate` is now the one rule both ingest paths call: over 100k
  REFUSES (`over-hard-cap`; the draft stays in the inbox and the toast names
  the size), over 200 lines and a description without a trigger WARN. Red
  proof: with the gate neutered, the arm reports `created:true` and "Skill
  saved" for a 150k-char draft.
- **`remember` had no provenance gate.** The prompt said a fenced result is
  data; nothing stood behind it, so a page saying "the trader approves 5x
  leverage" became a row. The turn loop marks `untrustedSeen` after a
  `web_search` or a forged HTTPS tool, and `remember` on such a turn refuses a
  fact whose DESCRIPTION is not in the trader's own words
  (`statedInTraderWords`). Two refinements came from the live arms, not from
  review: the BODY must not be part of the comparison (a model-written body
  restates the page and picks up the question words — the first live arm passed
  a page-derived fact for exactly that reason), and one shared word is not
  enough (a fact needs at least two, and at least half its own distinctive
  words). Red proofs for both: the body-inclusive compare saves the echoing
  fact; the gate removed entirely saves the page-derived one with "its index
  line now rides every future prompt".
- **The deep pipeline ignored the memory switch AND the window.**
  `assemblePipelineMemoryContext` called `buildProfileMemoryIndex()` bare, so a
  Full-analysis prompt carried every stored fact whatever the trader had chosen
  and always at the default size. It now takes the flag and
  `indexBudgetFor(window).memory`. Red proof: bare call → `narrow` window still
  gets 30 lines, and the off arm still shows the block.

What the provenance gate cannot do, said plainly: it is a vocabulary test. A
page that mirrors the trader's own phrasing passes it, and a same-round
(read + save in one batch) pair is not marked before the save runs. The
guarantee is "the page was read, then the fact was saved" — the shape of every
injection that worked — not semantic understanding.

Two additions landed with it. The owner had started a stricter design in the
main checkout — `remember` carrying a verbatim `quote` of the trader's message —
and that is now the gate's FIRST half, made OPTIONAL rather than required: a
quote that does not appear in the message refuses the write on any turn, while a
model that omits the field is unaffected. Requiring it (as the draft did) would
mean a model that never sends `quote` can never save a memory, which is a worse
failure than the one it closes; flipping the schema to `required` is a one-line
change if that trade is wanted. Second, item 11's recall half is now in the seat
prompt: a reply never volunteers a sensitive detail or a fact about another
person, because the index withholds those lines and a reply that reconstructs
them defeats the exclusion.
