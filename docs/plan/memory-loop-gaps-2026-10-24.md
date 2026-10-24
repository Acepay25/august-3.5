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
