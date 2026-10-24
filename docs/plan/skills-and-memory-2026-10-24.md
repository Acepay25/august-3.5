# SKILL.md format + memory loop — the ported design (2026-10-24)

Owner decision 2026-10-24: port the design goals of a FastAPI/Tauri spec onto THIS
August (Electron/Capacitor, TypeScript, notebook store). Where the spec and the repo
disagree, the repo wins. No new stores, no vectors, no FTS, no migration numbering.
Human approval stays for skill creation/revision; autonomous evolution is OUT OF SCOPE
until its rails (reviewer, undo, shadow, cooldown) exist here — recorded below as a
later item, not built now.

## Ground truth inventory (verified 2026-10-24, file:line in this tree)

Already here, kept as-is: description-first skill index with bodies on demand;
`draftGates` + `propose_skill`/`revise_skill` approval; `remember`/`read_memory`/`forget`
desk tools; `memoryBudget`; `utils/untrusted.ts` choke point; `SkillCompatibility`
(requiresTools/requiresEnv/platforms) is PARSED and SERIALIZED
(`SkillMemoryService.ts:99`, `:696`, `:1318`) but enforced NOWHERE; `version` travels;
`name` (≤64) + `description` (≤1024) lead the portable face (`serializeSkill:1276`);
`SkillImportService.importSkillFiles` already takes multiple files with per-file
honest outcomes; import is user-confirmed in the UI (nothing auto-runs).

## The eight items

| # | Item | Status | What is actually new |
|---|---|---|---|
| 1 | SKILL.md parser tolerance + unknown-key preservation | **DONE** `f5a48976` | capture unknown frontmatter keys in `SkillMeta.unknownKeys`, re-emit them verbatim in `serializeSkill` (today a rewrite DROPS `metadata.hermes`, `author`, `license`…); validate name (lowercase-hyphen ≤64), description ≤1024, non-empty body; a bad skill is skipped with a logged reason (import already reports per-file reasons — extend `listSkills` to log-and-skip parse failures rather than silently filtering) |
| 2 | Bundled files per skill | **DONE** `9f76a065` (URL import deferred) — was (`references/` `templates/` `scripts/` `assets/`) | EXTEND | notebook folders hold them: one folder per bundled skill under `skills/`, support files as sibling markdown/text files; `skill_view` L2 reads them; import accepts a folder (many files at once — `readSkillFiles` already reads a FileList) | DEFERRED: URL/raw-SKILL.md-URL fetch import |
| 3 | `skill_view` desk tool (L0/L1/L2) | **DONE** `195c8119` — was L0 is the existing index; L1 returns the body + bundled-file list; L2 returns one bundled file; reject `..`/absolute paths; substitute `${SKILL_DIR}`, `${SESSION_ID}` (+ `${HERMES_SKILL_DIR}`/`${HERMES_SESSION_ID}` aliases) |
| 4 | Gating: `platforms`, `requires_*`/`fallback_for_*` | **DONE** `46a58069` (fallback_for_* deferred) — was filter the index/injection on `compatibility` (platform web/native via Capacitor; `requiresTools` against the desk's tool list); hidden skills leave the index | DEFERRED: `fallback_for_*` (needs a fallback-resolution pass; no writer emits it yet) |
| 5 | Memory writes with optimistic locking | **DONE** `57d2e8a4` — was `version` stamp on notebook memory writes via the desk path; `if_version` on edits; conflict returns current content for merge-and-retry |
| 6 | Listing-first memory recall | **DONE** `cae43973` — was compact subject index (slug + ≤150-char summary + aliases) injected ahead of full notes, inside `memoryBudget`; topics already carry slug+summary (`memoryTopics.ts`) — the index is built from them |
| 7 | Deterministic alias pre-read | **DONE** `5322d9d4` — was string-match the user message against memory topic aliases + skill names pre-turn; attach ≤2 one-line records / a `skill_view` hint; never pre-read sensitive records; never auto-load bodies; weak/local models only |
| 8 | Compact trigger block for the seat prompt | **DONE** `86e9853f` — was one short block in the seat prompt: view skills that match before acting; memory write triggers (stated durable facts, decisions, standing preferences, corrections, forget, passing mentions, explicit remember) and recall triggers (my/our, direct questions, "based on what you know", before saying "I don't know"); never write assistant advice/fetched content/hearsay/untrusted text; no narration |

Later (not now): autonomous skill evolution once reviewer/undo/shadow/cooldown rails
exist here. `fallback_for_*` gating once a writer can emit it.

## Rules this pass follows

Tests: additions to `scripts/check-contracts.cjs` only (pure logic, isolated temp
bundling, never live data). All desk-tool reads/writes already route the notebook's
async writers. No swallowed errors — every skip names a reason. Status of each item
lives in this table; updated per commit.
