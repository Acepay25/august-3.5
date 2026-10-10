# How memory and skills should be stored — Claude, Hermes, and what August actually does

Research + read-only audit, 2026-10-10. **No code changed on this pass.**
Everything about August is a `file:line` verified in the working tree at `ed1a56f`;
everything about the other two products carries its source, and the two figures I
could not re-verify myself are marked as such.

## 0. Your suspicion is correct, and it is worse than you framed it

There are two stores in this repo. **The one called "rules" is dead, and the one
called "skills" is what your rules actually are.**

1. `learning_rules_v2_<user>` has **no reader**. `loadLearningRules` is called from
   exactly two places: the backup sweep (`hooks/useProfilePersistence.ts:129`) and
   profile restore (`hooks/useUserProfileLoader.ts:507`). No prompt ever reads it.
   The type says so out loud — `types/learning.ts:117`: *"never incremented on
   injection (and this store has no reader at all — only the backup sweeps it)."*
   So post-mortems keep writing rules into a store that only exists to be exported.
2. A "skill" is a **scoped rule, not a loaded procedure**. The matcher is
   `skillMatchesSetup` (`services/learning/SkillMemoryService.ts:1072`):

   ```
   coin +2, direction +2, family +2, regime +1  →  return hits >= 2
   ```

   Field equality only. **`description` is never compared to anything** — it is
   rendered, not matched. In both reference products the description *is* the
   trigger; here it is decoration.
3. And even when a skill matches, the model usually does not get the procedure.
   `skillIndexLine` (`MemoryRetrievalService.ts:350`) is what goes into the opening
   and rebuttal turns (`:384`) — a one-line index entry. Only the verdict stage
   gets the body, and it is truncated to `SKILL_BLOCK_MAX = 400` characters
   (`:105`, applied `:394`). A 400-char truncation of a procedure is a rule.
4. There is a machine `predicate` on `SkillMeta` and it is evaluated against the
   tape (`skillPredicateGate.ts:151,189`) — but it drives veto and confidence
   ceilings, **not** which skill is selected. So nothing in the system ever asks
   "does this skill apply to the situation in front of us?" in terms of meaning.

## 1. The four-layer contract both reference products use

| layer | Claude | Hermes | August today |
|---|---|---|---|
| Identity | CLAUDE.md hierarchy; `SOUL.md`-equivalent is user scope | `SOUL.md` global identity | `identityBlock` (300 chars, unconditional) |
| Standing rules | CLAUDE.md content, loaded at launch | **context files**: `.hermes.md` → `AGENTS.override.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`, first match wins | `riskRulesBlock` (300, unconditional) + a doctrine slot that **explicitly does not count against the budget** |
| Procedures | `SKILL.md`, pulled by the model | `SKILL.md`, agentskills.io-compatible, pulled on `skill_view` | markdown files pushed as a 400-char block at verdict only |
| Notes | auto memory: `MEMORY.md` index + one file per topic, `type` frontmatter | `MEMORY.md` (2,200 chars) + `USER.md` (1,375) in `~/.hermes/memories/`, SQLite FTS5 history | notebook `memory_files_v1_<user>` (one JSON blob) + per-bot `memory.md` (4,000-char tail cap) |

The structural point: **the always-loaded layer is small and the big layer is
pulled.** Claude's docs put the always-loaded budget at ~100 tokens per skill and
recommend a `SKILL.md` body under 5,000 tokens / 500 lines and a memory file under
200 lines; the spec's required frontmatter is exactly two fields, `name` (≤64
chars) and `description` (≤1024), where the description must state *what it does
and when to use it*. Verified against the spec directly.

August inverts it: the always-pushed set is identity + risk rules + doctrine +
settled beliefs + recent form + merged bot memory, and the pulled set is empty.

## 2. How each product creates one, and who approves it

- **Claude Code**: two channels, deliberately separated. `CLAUDE.md` is
  human-authored and loads at launch; auto memory is model-authored into
  `~/.claude/projects/<p>/memory/` as `MEMORY.md` (one line per entry, loaded every
  session) plus a topic file each, with `type: user|feedback|project|reference` and
  a `modified` stamp. It is told to skip anything derivable from the codebase or
  already in CLAUDE.md. `/memory` opens them; `/context` shows what loaded. The
  legacy `#` quick-add is **not in the current public docs** — the documented path
  is natural language.
- **Claude skills**: created by writing a directory; the model matches the request
  against the description; two flags make invocation control *data on the artifact*
  — `disable-model-invocation: true` (human-only, for side effects) and
  `user-invocable: false` (background knowledge only the model reads).
- **Hermes**: `/learn <source>` over a directory, URL, "the workflow I just did", or
  pasted notes; a Skills Hub with `hermes://skill/install` deep links; hand-edit; or
  the agent's own `skill_manage` tool. A **background review** after a turn proposes
  memory entries and skill patches, and writes are gated: `memory.write_approval` /
  `skills.write_approval` stage them for `/memory pending|approve|reject` and
  `/skills pending|diff|approve|reject`. A **Curator** ages agent-created skills
  `active → stale → archived`, never auto-deletes, supports pin, dry-run, rollback
  and an audit ledger. Memory is injected as a **frozen snapshot at session start**
  so the provider prefix cache survives; mid-session writes hit disk but only appear
  next session.
- **August**: model-authored (`ingestIfThenFromTrade`, `SkillCraftService`,
  `chartScanSkills`, `botLearning` lesson lines), human-approved through the queue
  (`approveSkillDraft`, `skillApproval.ts:53`), plus `ensureSeedSkills` at boot.

**This part you already do as well as either of them** — arguably better: the
approval gate exists, and skills carry evidence that is actually consumed
(`skillAdherenceForRun` → `applySkillEvidence`, ε-holdout controls,
`deriveStatus`, surfaced in `LearningDashboard`). Neither reference product tracks
whether a skill paid for itself. The gap is not governance; it is the retrieval
contract.

## 3. Where the divergence hurts

1. **`SkillMeta` has ~35 fields** (`SkillMemoryService.ts:72-260`): wins, losses,
   netR, regimeStats, shadow, prior, birthEvidence, ifCondition/thenAction,
   strategyFamily, signals, invalidation, horizon, sizing… The Agent Skills spec has
   **no lifecycle or outcome fields at all** (confirmed: "not in this document"), and
   its only extension point is a string→string `metadata` map. Our skill file is a
   database row wearing markdown — which is why it cannot be shared, imported, or
   reasoned about as a procedure.
2. **Skills and strategies duplicate a template**: `strategyFamily/signals/
   invalidation/horizon/sizing` on `SkillMeta` mirror `StrategyMeta`. Same fact, two
   stores.
3. **Skills and `rules/risk-rules.md` can express the same sentence** — "never chase
   the open" — one gated by field equality, one by nothing. Two injection sites, no
   dedup between them (skills ↔ recurring-mistakes *is* dedup'd by contract at
   `MemoryRetrievalService.ts:455-458`, which proves the pattern was understood and
   just not applied here).
4. **A budget exception that hides itself**: the doctrine slot is documented in code
   as an "always-on slot … does not count against the budget". An unaccounted
   always-on layer is how a memory system silently crowds out the chart.
5. **Nothing is pulled.** The model has no way to ask for more of a skill it was
   told exists. Both reference products are built on exactly that ability, and
   Anthropic's memory-tool docs name the reason: just-in-time retrieval keeps active
   context small in long sessions.

## 4. What I would change, ranked

**STATUS 2026-10-10 (execution pass):** #1 is **implemented and verified**
(see the table below). #5 is **partially** done — the doctrine slot is now
covered by a test that pins the budget above it, but it is still structurally
outside the budget (a one-line change: `stageBudgetChars` would need
`+ DOCTRINE_SLOT_CHARS`, which would silently raise every stage's budget and
must be decided, not drifted into). #2–#4, #6, #7 are unchanged.

| # | change | why it is the one that matters | cost | status |
|---|---|---|---|---|
| 1 | **Make `description` the trigger.** Score the skill's description against the live setup (coin/interval + the trader's own words) and load the body on a hit, at every stage — not a 400-char block at verdict | turns the store into skills without touching storage | one matcher + the stage budget; no new state | **DONE** — `descriptionOverlap` + a 0.2 Jaccard floor as a second candidacy path in `rankedMatchedSkills` (`MemoryRetrievalService.ts:216`), and a bounded `(1 + descScore * 1.5)` rank multiplier (`:254`). 5 new tests in `tests/skillDescriptionTrigger.test.ts`; guard proven by reverting the gate (2 fail) and restoring. Full suite 500 files / 4848 tests, lint back at the 94/838 baseline |
| 2 | **Decide what a rule is, once.** Either give `learning_rules_v2` a reader or delete the store and make `rules/risk-rules.md` the single rules home. Today it is a write-only backup | the repo's own ruling is wire-when-the-rest-ships / delete-when-only-the-surface-is-missing; here only the *reader* is missing | deletion is ~4 call sites; wiring is one block | open — **corrected finding**: the store is not wholly dead. `changelog.md:2175` records "IF/THEN rules system removed … post-mortem lessons flow only through skills", and `HANDOFF_LEARNING_LOOP.md:224` already lists it as a Tier-2 delete candidate. The comment in `types/learning.ts:117` is the honest description; the remaining work is the deletion itself, which the handoff owns |
| 3 | **Split the file**: SKILL.md-shaped instructions (2 required fields, portable) + a sidecar the loader owns for outcome stats | stops inventing a non-spec format; makes a skill shareable and reviewable as text | format change + migration | **DONE.** `serializeSkill` now writes ONE frontmatter block with two faces split by `<!-- august:skill-ledger -->` (`SkillMemoryService.ts:432`): a PORTABLE face leading with the spec's two required fields (`name` ≤64, `description` ≤1024) plus the keys that describe the procedure's behaviour (kind/coin/direction/family/regime/ifCondition/thenAction/predicate/timeframe/source/audience/lensScope and the WHO-approved-it provenance), and a LEDGER face carrying every outcome/lifecycle key (status/wins/losses/netR/control*/recentOutcomes/eval*/history/shadow/prediction/birthEvidence/tradeIds…). The parser reads straight through the marker, so there is NO migration and no rewrite — existing files parse identically and a spec-only file with just `name`+`description` loads as an unproven candidate (test proves it). Also fixed in the same pass: `skillBody()` no longer repeats the `# Title` heading, which every injected procedure was duplicating after the skill's own header line already named it. 7 tests in `tests/skillFileSplit.test.ts`; one pre-existing assertion in `skillTiering.test.ts:159` was updated because it pinned that duplication. Full suite 503 files / 4863 tests, lint back at 94/838 |
| 4 | **Index + body for memory too**: one line per entry always on, bodies pulled | this is the L1/L2 model that makes an unbounded store affordable | reuses #1's machinery | open |
| 5 | **Account for the doctrine slot** in the stage budget, or drop it | an invisible always-on layer is the thing that surprises you later | small | **DONE (accounted, deliberately NOT moved into the budget).** Two always-on slots ride outside `stageBudgetChars`: doctrine (800) and settled beliefs (350, rendered *above* doctrine). The concrete defect found and fixed: `estimateMemoryTokensPerRun` — the per-run prompt-cost figure the Health tab shows the trader — counted the doctrine slot and **silently omitted the settled-beliefs slot**, under-reporting every run's always-on cost by 350 chars / ~88 tokens. Both terms now counted (`MemoryRetrievalService.ts:366`), and the total is derivable from exported constants (`800 + SETTLED_BELIEFS_BLOCK_MAX = 1150`). The layer was deliberately left OUTSIDE the stage budget: folding +1150 chars into every stage is a real prompt-cost change that needs a decision, not a drift — a test pins that the historical 900:400:600 proportions did not move. Note the live budget is window-derived (65K default ⇒ 3600 chars opening; a 300-token minimum allowance means the 900 stage floor is never actually reached). 6 tests in `tests/alwaysOnLayerAccounting.test.ts`; guard proven by reverting the beliefs term (accounting test fails) and restoring. Full suite 504 files / 4869 tests, lint back at 94/838 |
| 6 | **Side-effect skills are human-invoked only** (Claude's `disable-model-invocation` as data on the artifact) | this app journals trades; a self-firing skill that implies an action is the one place autonomy is wrong | a field + a gate | **DONE, REFRAMED.** The original threat has no attack surface here — I verified the actuation boundary: skills reach a model only as prompt TEXT (`rankedMatchedSkills`, `/slug`), no desk tool places a trade, `present_trade` ends in a human "Log this trade" click (`TradeView.tsx:93`), and `services/trade/tradeChatContext.ts:175` states the harness never places, closes or resolves trades. So the shipped version is the honest gap Claude's mechanism fills HERE: `SkillMeta.manualOnly` = background knowledge readable with `/slug` but never auto-injected. Gated in `MemoryRetrievalService.ts:222` AND `EvidencePackService.ts:150` (the verdict prompt block — the one other auto-injection path, without which the gate is trivially bypassed). `resolveInvokedSkills` deliberately does NOT read the gate: that path IS the human asking. Absent = injects, so legacy rows are byte-identical. 5 tests in `tests/skillManualOnly.test.ts`; guard proven by reverting both gates (injection test fails) and restoring. Still no UI toggle — a hand-edit of `manualOnly: true` sets it, same as `audience:`/`lensScope:` today |
| 7 | **Per-category context visibility on Learn → Health**, not a bottom bar: what loaded, from which store, how many bytes | Hermes and Claude Code both ship this; you banned the always-on version, so put it where the user pulls it | one panel, reuses the injection records already written | open |

**Also shipped — a trading defect found while verifying §0's claim #3, not in the original ranked list.** The verdict stage — the only stage that produces a *binding decision* — was served the skill procedure by a naive `slice(0, SKILL_BLOCK_MAX)`, i.e. the first 400 chars of whatever prose arrived first. The craft writes the verbose trigger (`**When:**`) first, so a long skill handed the deciding seat 400 chars of situation description and never reached a single step — while the `recall` tool, which the model must *ask* for, already projected the procedure in priority order. `MemoryRetrievalService.ts:482` now runs the verdict body through the same `projectSkillCard` the recall tool uses (rule → trigger → when-NOT → pitfall → verification → ticket → numbered procedure), keeps `SKILL_BLOCK_MAX`, and names a clip through `clipNote` in the app's one marker voice instead of a bare `…` the model would read as the skill simply ending. 3 tests in `tests/verdictProcedure.test.ts`; guard proven by reverting to the slice (3 fail) and restoring. Short skills are unaffected — the projector serves a body that already fits unchanged.

Skip: Anthropic's irreversible memory verbs (off = permanently delete everything;
deleting a chat leaves its derived memories), and the per-surface zip-upload
distribution model — both are accumulation without garbage collection, which is the
one failure mode this app already has tooling against.

## 5. Provenance

Verified by me directly: the Agent Skills spec figures (64/1024/500 chars, ~100
tokens, <5,000 tokens, under 500 lines, no lifecycle fields), the skills engineering
post (frontmatter `name`+`description`, three tiers, model invokes via a tool,
complements MCP), `skillMatchesSetup` at `SkillMemoryService.ts:1072`, the
`SKILL_BLOCK_MAX`/`skillIndexLine` split, the dead `learning_rules_v2` reader set, and
the `types/learning.ts:117` comment.

Doc-sourced, **not** re-verified by the earlier pass (my fetches were rate-limited; the URLs
resolve): Hermes' 2,200/1,375-char memory caps, the four `SKILL.md` section names,
`write_approval` flags, Curator lifecycle, and the frozen-snapshot-at-session-start
behaviour. Claude's per-scope CLAUDE.md paths, the 4-hop import limit, the 200-line
guidance, and the auto-memory `type` frontmatter.

**Re-verified directly on the execution pass (2026-10-10):** the Hermes
[skills page](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
(2,200/1,375 char caps confirmed verbatim, `§`-delimited frozen snapshot at
session start, L0 `skills_list` ~3k tokens / L1 `skill_view` / L2 reference
files, `skills.write_approval` → `/skills pending|diff|approve`, Curator
active→stale→archived never-auto-delete) and the
[memory page](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
(one agent per Hermes home, memory does not auto-compact — a write past the
cap is refused and the agent consolidates itself, substring-match
replace/remove, no `read` action because injection covers it). The Claude
figures above remain doc-sourced only.

One agent citation corrected here: `skillMatchesSetup` was attributed to
`MemoryRetrievalService.ts:1072`; it is defined in `SkillMemoryService.ts:1072` and
imported at `MemoryRetrievalService.ts:49`.

Sources:
- [Agent Skills specification](https://agentskills.io/specification)
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Claude Code — how Claude remembers your project](https://code.claude.com/docs/en/memory)
- [Claude memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Claude chat search and memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)
- [Hermes Agent — skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- [Hermes Agent — persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
- [Hermes Agent — desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop)
