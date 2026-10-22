# Trading harness — improvement proposals

**Evidence-based proposals for the August Trading harness, mined from three reference
harnesses.**

- Ground truth for what August Trading does today: **`docs/research/trading-baseline.md`**
  (343 features, each marked REAL or COSMETIC, with `file:line`).
- Reference material: `docs/research/<repo>/shards/*.md` and
  `docs/research/<repo>/ARCHITECTURE.md` for `pi`, `deepseek-harness`, `hermes-agent`.
- The reference repos are **read-only references**, not templates. A proposal is only
  worth making if it is *better for this product*, not merely present in a reference.

## The rules this document obeys

1. **Never propose what is already REAL.** The baseline's §9 list is the guard rail.
2. **Prefer removal and merging to addition.** The harness is already too complicated.
   Anything with a net complexity increase has to earn it.
3. **The review system stays file-based.** No SQLite for review/learning.
4. **Minimalist UI.** Less text, no new panels, no decorative displays.
5. **Every proposal carries a real test** — a behavioural assertion, not a source-shape
   assertion. Where a UI change is involved, that means a browser probe.
6. **Prioritise the known weak spots**: the skill-proposal tool bug, review-loop
   quality, trade-log access, model handling, hanging and silent failures.

## Reading the verdicts

| Verdict | Meaning |
| --- | --- |
| **ADOPT** | Do it as described. The evidence supports it and it fits the product. |
| **ADAPT** | Do it, but differently — the reference's version does not fit August Trading. The adaptation is stated. |
| **SKIP** | Do not do it. Either the reference idea does not transfer, or August Trading already has it. |

---

# P1 — Send one small journal block; delete the rest of the context assembler

**Verdict: ADAPT**
**Effort: M**
**Source: the August baseline §0 (August's own defect). Reference: `deepseek-harness`
`docs/agent-lifecycle.md` (the `system-prompt/assemble` waterfall is *sent*);
`pi` `packages/durable/README.md` §"System Prompt" (sections are rendered before each
request); `pi` `packages/ai/src/types.ts:544-570` + `packages/ai/src/utils/transcript.ts:73-120`
(the system prompt and the tool list live *in the transcript*, so a later turn can patch a
named section instead of rebuilding the prompt).**

### What August Trading does today

`hooks/useAnalysisPipeline.ts:1168` builds `enhancedPrompt`. It is written at `:1175`
(memory files, similar setups, weighted-voting learning, the code-checked skill trigger
note), `:1197` (decision reflections) and `:1208` (gate injection), and it is **read
exactly once** — `:1213`, a `devLog` that prints its length. All three sends use
`promptToSend`: `:1258` (scheduled run), `:1384` (bot), `:1411` (desk / Chat surface).
A repo-wide grep for `enhancedPrompt` returns 7 hits and no second reader.

The context that is therefore computed and thrown away includes:

| Lost context | Built at |
| --- | --- |
| the retrieved notebook memory (tier-2 bodies) | `hooks/analysisPipeline/memoryContext.ts:143` |
| the similar-setups journal track record | `memoryContext.ts:156` |
| the loss-priming rows (this setup's recent closed trades) | `memoryContext.ts:171` |
| the decision reflections | `useAnalysisPipeline.ts:1194-1201` |
| the weighted-voting learning context | `useAnalysisPipeline.ts:1137-1155` |
| the **last-20 brief** | `services/learning/MemoryRetrievalService.ts:923-935` |
| the pattern-memory synthesis injection | `PatternMemorySynthesisService.ts:589-669` (0 production callers) |

A **different** module *is* live and sent: `surfacePromptWith`
(`services/trade/chatSurfaceTurn.ts:110`) composes the surface mandate + **skills index**
+ active strategy plans + profile-memory index. So the Chat surface and the dock *do*
get the skills index and the mandate — they just never get the trader's journal.

The code is a fossil of the deleted debate engine. `memoryContext.ts:138-140` says the
verdict slice *"was built for a moderator that no longer exists"*, and `:144-147` is
about *"rebuttal rounds"*. The assembly has analyst / moderator / rebuttal / bot-memory
seams for a single-model, single-seat product.

### The proposed change

**Do not send `enhancedPrompt` as it stands — it is too much, and most of it is
multi-seat debris. Delete the assembler, and send exactly one small block.**

1. **Delete** the dead `enhancedPrompt` construction
   (`useAnalysisPipeline.ts:1168-1213`) and the `const gateInjection = ''`
   (`:1203`). A variable that is written four times and read by a log is a defect
   with a zero-cost fix: delete it, and the compiler stops letting the next person
   believe the context is sent.
2. **Delete** the multi-seat seams in `hooks/analysisPipeline/memoryContext.ts` that
   only the dead path used: `rebuttalMemoryContext` (`:151`), `regimeWeightingContext`
   (`:162-165`), `botMemoryContext` (`:111-137`) and the analyst/moderator audience
   split in `MemoryRetrievalService.ts`. Keep the *one* live retrieval
   (`memoryFilesContext`, `:143`) but stop routing it through the dead variable.
3. **Add one block** to `surfacePromptWith` (`services/trade/chatSurfaceTurn.ts:110`):
   the trader's **last-20 brief** (`utils/recentTradesBrief.ts`) plus the
   **similar-setup stats** for the symbol in hand — the two things the trader would
   be angry to lose, and small enough to cost nothing. Both already exist as
   functions; the work is wiring, not building.
4. **Keep everything else behind the tools.** `recall`, `get_trade_log` and
   `get_setup_history_stats` are already on the Chat surface's allow-list
   (`chatSurfaceTurn.ts:63`). Opt-in retrieval is the right shape for a long notebook;
   auto-injecting it on every turn is what the references do *not* do.

### Concrete files touched

| File | Change |
| --- | --- |
| `hooks/useAnalysisPipeline.ts` | delete `:1168-1213` (the dead `enhancedPrompt` and `gateInjection`) |
| `hooks/analysisPipeline/memoryContext.ts` | delete the rebuttal / regime-weighting / bot-memory seams |
| `services/trade/chatSurfaceTurn.ts` | add the one journal block to `surfacePromptWith` |
| `services/learning/MemoryRetrievalService.ts` | drop the analyst/moderator audience split |
| `services/learning/PatternMemorySynthesisService.ts` | delete `generateSynthesizedPromptInjection` (`:589-669`, 0 callers) |
| `utils/recentTradesBrief.ts` | reuse as-is |

### Benefit

The model stops pretending it remembers the trader's journal, and the trader stops
paying for a retrieval the model never sees. This is the single defect that makes the
app's memory system look real and behave hollow — and it is the *cause* of the
"last-20 brief never reaches a model" finding in the baseline.

It also carries a second, less obvious benefit: **the chat path would regain its
deterministic skill enforcement.** The code-checked trigger is already evaluated at
`hooks/useAnalysisPipeline.ts:1102` and its note is dropped with the rest of
`enhancedPrompt`. The plan path already applies the same machinery — a fired AVOID
**refuses** the presentation (`services/trade/presentTradeTool.ts:114-133`) and the
predicate ceiling is folded into the stamp the card shows and the journal records
(`presentTradeTool.ts:140-144`). So the chat path is not missing a mechanism; it is
missing the wire.

### Risk

**Low-medium.** The retrieval that now reaches the model was previously computed and
discarded, so nothing that reaches a model *regresses*; what changes is that a small
block is now sent. The risk is prompt bloat: cap the block (the last-20 brief is ~20
lines) and measure it.

### How to verify with a real test

- A **unit** test on the request builder: assert the outbound request body contains
  the last-20 summary for the trader's own closed trades, and that the byte count is
  bounded.
- A **behavioural** test with the mock provider (`scripts/mock-provider.cjs`): send
  *"how have my last 10 BTC trades gone?"* and assert the outbound prompt contains
  the trader's own W/L — not merely that the model *could* call `get_trade_log`.
- Assert the outbound prompt does **not** contain the removed seams (no
  "moderator", no bot-memory block).

### Complexity delta

**Negative.** Removed: one dead variable and its four writes, one dead constant, three
multi-seat context seams, one 80-line orphan function, and the "analyst vs moderator"
audience split — every one of which the deletion of the debate engine orphaned.
Added: one call inside an existing prompt builder, and one shared formatter that
already exists (`utils/recentTradesBrief.ts`).

---

# P2 — Fix the `propose_skill` contract

**Verdict: ADOPT**
**Effort: S**
**Source: the August baseline §2. Reference: `hermes-agent` `tools/skill_manager_tool.py`
(the reason is a first-class field), `tools/skill_ledger.py` (every mutation appends a
before/after manifest to a JSONL ledger; `rollback_entry` **fails closed** when its
safety capture fails, while every other public write path swallows and logs).**

### What August Trading does today

`propose_skill` is **REAL but defective** in three separate ways, and it is the tool
the whole learning loop depends on:

1. **The required evidence is dropped.** The schema makes `reason` **required**
   (`services/analysis/DeskToolsService.ts:1074`, in `required` at `:1077`). The
   handler never reads it (`:2645-2717`; `call.arguments.reason` appears in
   `amend_memory:2527`, `revise_skill:2793`, `decline_trade:3240` — not here).
   `CraftedSkillSchema` (`schemas/learning.ts:121-209`) has no slot for it and the
   receipt (`:2712`) omits it. So the model must supply the evidence and the human
   never sees it — **the approval gate is reviewing a bare IF/THEN**. The sibling
   `revise_skill` *does* keep its reason (`:2793`).
2. **The schema is lossy in two more places.** `additionalProperties: false` (`:1078`)
   with `timeframe`/`source` missing from the schema means the model's timeframe is
   silently lost (proof replay is always 1h) or the call is hard-rejected. And
   `:2657` coerces a missing `steps` into the literal `["undefined"]`, while the
   rejection text at `:2673` lists `steps` as missable although it cannot be.
3. **The proposal queue reports success on a failed write.**
   `utils/learningQueue.ts:121-149` swallows write failures and still reports
   `proposed: true`. This is exactly the silent-success class that `121bd1df` fixed
   for *drafts* — and was never applied to the proposal queue.

Git: the write-half fixes landed (`121bd1df`, `bbaae74a`, `724882a6`, `97317a5b`); the
content half is in **no** commit. And `npm run skill-approval-probe` cannot catch it:
`scripts/probe-skill-approval.cjs:7-11` seeds the draft bytes directly and the mock
starts **without** `MOCK_TOOL_CALL` (`:327-329`), so the segment between the tool call
and the inbox is ungated.

### The proposed change

1. **Carry the reason.** Add `reason` to `CraftedSkillSchema`
   (`schemas/learning.ts:121-209`), read it in the handler
   (`DeskToolsService.ts:2645-2717`), and put it on the draft. Show it on the Coach
   card (`components/agents/CoachThreadPanel.tsx:133-145`) — the human is approving a
   rule, and the rule's evidence is the whole point of asking.
2. **Close the schema.** Either add `timeframe` and `source` to the tool schema, or
   remove `additionalProperties: false`. Pick one and say so in a comment; today the
   schema promises a closed set and the parser accepts an open one.
3. **Stop coercing a missing `steps` into `["undefined"]`** (`:2657`) and fix the
   rejection text (`:2673`) so the list matches reality.
4. **Make the queue honest.** `utils/learningQueue.ts:121-149` must report a failed
   write as a failed write — the same rule `utils/skillDrafts.ts:75-82` already
   follows.

### Concrete files touched

`services/analysis/DeskToolsService.ts` (`:1049-1081` schema, `:2645-2717` handler),
`schemas/learning.ts` (`CraftedSkillSchema`), `utils/learningQueue.ts`,
`components/agents/CoachThreadPanel.tsx`.

### Benefit

The human approval gate becomes a real gate. Right now the trader is asked to approve
a rule whose stated evidence was thrown away by the tool that produced it — which is
also the fastest way to stop a trader trusting the learning system at all.

### Risk

**Low.** The change is contained to one tool, one schema and one card. The risk is
rejecting calls the model used to make successfully (the schema gets stricter about
`timeframe`/`source`) — mitigate by accepting both shapes.

### How to verify with a real test

- Extend `npm run skill-approval-probe` so the mock **emits a `propose_skill` tool
  call** (rather than seeding draft bytes) and the probe asserts the draft bytes on
  disk contain the model's `reason` and its `timeframe`. This closes the ungated
  segment the current probe cannot see.
- A unit test on the handler: a `propose_skill` with a `reason` produces a draft
  whose file contains that reason; a `propose_skill` whose write fails returns
  `ok: false`, not `proposed: true`.

### Complexity delta

**Near zero.** One schema field, one handler read, one card line, one truthfulness
fix. It removes a silent failure and adds no new machinery.

---

# P3 — An unattended run may not do what a human must approve

**Verdict: ADOPT**
**Effort: S**
**Source: the August baseline §2. Reference: `hermes-agent` `cron/AGENTS.md` —
*"Headless ticks refuse, never spawn… instead of letting `run_canonical_job →
connect_gateway → ensure_gateway_runtime` spawn an unmanaged daemon. Same policy as
approvals (headless/cron = refuse)."* `pi` `packages/durable/README.md` §"Extensions"
(approval is a `beforeTool` **hook** on the tool, not a separate mode:
`hook(ToolTask, { beforeTool: (call) => (isDangerous(call) ? { block: "Needs approval" } : undefined) })`).**

### What August Trading does today

`SkillEvalScheduler.ts:284-294` calls `analyzeTradingView` with **no**
`allowedTools`. That reaches `GenericAnalysisService.ts:449-452` →
`DeskToolsService.ts:2485/3720-3724`, where an **empty list means unrestricted**, and
the run is fired detached at `SkillMemoryService.ts:3797-3798`, with
`deskToolsEnabled` defaulting true (`utils/harnessSettings.ts:110`).

So an unattended, detached job can call `propose_skill`, `decline_trade`, every
forged `custom_*` tool (which may POST), and the exact eight tools the automation
surface deliberately denies (`services/trade/automationTurn.ts:56-64`). The
`propose_skill` bug in P2 makes that worse: a detached job can put a rule into the
trader's approval inbox, and the reason that would explain it is dropped.

The application's own denial list already exists and is correct
(`automationTurn.ts:56-64`); the scheduler simply does not use it.

### The proposed change

1. **Give the unattended path the automation deny-list.** `SkillEvalScheduler.ts:284`
   should pass the same allow-list the automation surface uses, not an empty one.
2. **Make the consequential tools refuse an unattended context** — the same shape as
   Hermes' "headless = refuse". `present_trade`, `decline_trade`, `forge_tool` and
   `propose_skill` should return a refusal naming the reason ("this run is
   unattended; a human must approve this") rather than acting or silently
   succeeding.
3. **One allow-list, one owner.** `automationTurn.ts:56-64` is the list; the
   scheduler and the desk should read it rather than each keeping their own.

### Concrete files touched

`services/learning/SkillEvalScheduler.ts` (`:284-294`), `services/analysis/DeskToolsService.ts`
(the tool handlers, to read the unattended flag), `services/trade/automationTurn.ts`
(the list becomes the shared owner).

### Benefit

Removes an unattended-job blast radius that includes "may POST" (a forged
`custom_*` tool). It also makes the learning loop's behaviour legible: an evaluator
that proposes a rule into the trader's inbox at 3 a.m. is a different thing from one
that reports its findings.

### Risk

**Low.** The evaluator is a background job whose job is to *evaluate* skills, not to
act. Narrowing its tools changes nothing it is supposed to do.

### How to verify with a real test

- A unit test: run the evaluator with a mock provider that emits
  `propose_skill` and `forge_tool`; assert both are refused and that the refusal
  names the unattended reason.
- A test that the scheduler's effective allow-list is a subset of the automation
  deny-list — a cheap invariant test that fails the moment someone adds a tool.

### Complexity delta

**Negative.** One list instead of two behaviours; one refusal instead of a silent
capability.

---

# P4 — Delete the dead subsystems, and fix the documents that describe them as live

**Verdict: ADOPT**
**Effort: M (mechanical, but wide)**
**Source: the August baseline §5, §6, §7. Reference: `deepseek-harness`'s own deletion
of the debate engine — 62 files and 11,664 deletions in `48c3ee81` — and
`docs/defensive-patterns/README.md`: *"Extend through the registered seam. A new
capability registers; an existing carrier stops taking new logic instead of growing a
branch inside it."* `pi` `packages/durable/README.md` §"Persist and Resume" (the
deprecated `compat` surface is quarantined behind a second, explicitly temporary
entrypoint rather than deleted on day one: `packages/ai/src/index.ts:4-8`,
`packages/ai/src/compat.ts:10-11`).**

### What August Trading does today

61 of 343 features are dead or cosmetic, and several are *large*. The list, with the
evidence, is in the baseline. The ones that cost the most to keep:

| Dead thing | Size | Evidence |
| --- | --- | --- |
| `TradeValidationGate` | 41 KB, **zero importers** | `services/validation/TradeValidationGate.ts`; `runValidationGate:495-973`; its twelve steps never run |
| `patternMemoryGate` | test-only | `PatternMemorySynthesisService.ts:882-1081`; `Message.patternMemoryGate` is never assigned, so the journal HALT chip (`TradeLog.tsx:359-386`) can never render |
| `SessionGuardService` — the **guard half** | daily-loss / trade-cap / streak / cooldown never fire | `SessionGuardService.ts:157-268` (`assessSession` + `formatGuardContextBlock`) is called only from tests. The module itself is **not** dead: `rowPnlUsd` and `utcDayStart` are imported by `services/learning/monthlyReport.ts:23`, `services/validation/calibrationPolicy.ts:63`, `utils/disciplineAnalytics.ts:18` and `utils/harnessSettings.ts:7` |
| `providerFitness` | names a consumer (`autoAssignLenses`) **that does not exist** | `services/learning/providerFitness.ts:7-9` |
| `learning_rules_v2` | a write-only store with a backup | `StorageService.ts:105`; no prompt reader |
| `NavRail.tsx` | 242 lines, **never rendered** | `App.tsx:2507-2515`; `tests/deadControlsGuard.test.ts:145` pins the absence |
| `SurfaceMenuList`'s surface list | mounted with `hideSurfaces`, so the brand bar, the badge and `RunBusyBadge` are all dead | `App.tsx:2725-2731` |
| `ARBITER_ALLOWED_TOOLS` | only test importers | `DeskToolsService.ts:3341-3357` |
| ~~`applyNotebookSkillsToAnalysis`~~ | **CORRECTED — it is LIVE.** The baseline recorded it as dead; re-opening the source shows the E-35 fix landed: `services/trade/presentTradeTool.ts:113` calls it and a fired AVOID **refuses the presentation** (`:114-133`). Not a deletion target |
| `MemoryConsolidationService.ts` | an orphan module | — |
| the debate residue | 29 vestigial items | baseline §7 |

Two things make this worse than ordinary dead code:

- **The documentation lies.** `docs/app-flow.md:610-611` tells the reader the
  pattern-memory gate is *"the pre-trade gate that refuses a setup with no
  evidence"*. It is test-only. `AgentsView.tsx:10-33` opens with *"⚠️ THE TWO
  SURFACES DO NOT SHARE A STORE TODAY"* — false since the one-home merge.
  `docs/plans/debate-deletion-status.md:3-8` records that *"the closed-trade
  learning chain stops working with no replacement"*, and the code confirms it
  (`SkillCraftService.ts:145`).
- **Live prompts still describe a committee that no longer exists**
  (`DeskToolsService.ts:1776`, `constants/prompts/harnessContract.ts:16`,
  `calibrationPolicy.ts:808` — the last is injected into a single model's packet at
  `HybridIntelligenceService.ts:1269-1291`).

### The proposed change

**Delete, in one pass, with the documents updated in the same commit.**

1. **Delete the dead modules and exports** listed above, and the 29 vestigial
   debate items in baseline §7.
2. **Quarantine, do not delete, the legacy *data*** — `Message.debateTurns`,
   `ThinkingRole 'moderator'`, the `debateTurnIndex` column, `Message.evidencePack`,
   `PatternMemoryGateView.mandatoryQuestions` — exactly as the owner already decided
   in `docs/plans/debate-deletion-status.md:1680-1712/2062-2069`. Data is not code.
3. **Fix the documents in the same commit** — `docs/app-flow.md:610-611`,
   `AgentsView.tsx:10-33`, and the three committee-shaped prompt strings.
4. **Decide, explicitly, the two subsystems that are dead but *should* be alive** —
   see P5 and P6 below. Deleting `SessionGuardService` and `TradeValidationGate`
   outright is right if P5/P6 are rejected, and wrong if they are adopted. **Do not
   delete and re-add in the same pass.**

### Concrete files touched

The 12 modules named above, plus `docs/app-flow.md`,
`constants/prompts/harnessContract.ts`, `services/analysis/DeskToolsService.ts:1776`,
`services/validation/calibrationPolicy.ts:753/758/808`,
`components/agents/AgentsView.tsx:10-33`.

### Benefit

Roughly 15–20 KB of source, ~2,000 lines, and one large false claim in the flow
document. The app stops carrying a debate engine's ghost, and the flow document
becomes trustworthy again — which matters more than the lines, because the flow
document is what a future reader (or agent) treats as ground truth.

### Risk

**Medium** — but only because the deletion is wide. Mitigation: delete in **three
commits** (modules, then exports, then documents), with `npm run typecheck &&
npm run test` green between each. The `tests/deadControlsGuard.test.ts` source
contract test already pins the *absence* of the biggest items; extend it to pin the
rest.

### How to verify with a real test

- `npm run typecheck && npm run test` green after each deletion commit.
- **A new assertion in `tests/deadControlsGuard.test.ts`** that the deleted module
  paths are not imported anywhere in production — the same shape as the existing
  `:145` NavRail pin. This is the test that stops the dead code coming back.
- `npm run render-probe` — it sweeps the surfaces and would catch a panel that
  silently stopped rendering.

### Complexity delta

**Strongly negative.** This is the single largest simplification available: it
removes a 41 KB orchestrator, a 242-line unmounted component, a write-only store, an
orphan module, ~20 dead exports and the false documentation that made them look
load-bearing.

---

# P5 — A stopped turn and a failed turn are different things

**Verdict: ADOPT**
**Effort: S**
**Source: the August baseline §4 and §6. Reference: `pi`
`packages/agent/src/agent-loop.ts:254` — `if (message.stopReason === "error" ||
message.stopReason === "aborted")` ends the turn, calls `finishTurn`, and emits
`turn_end` + `agent_end`; and `packages/ai/src/types.ts:389-397` — *"A stream that
returns is not the same as a stream that succeeded."* `deepseek-harness`
`docs/agent-lifecycle.md` — `agent/status` is `running` then `idle`, and a
`turn/end` carries an `aborted` reason distinct from `error`.**

### What August Trading does today

- A Stopped turn on the **Chat surface** is unmarked. `types/message.ts` has no
  `interrupted` field; the flag lives only on the dock's `LiveEntry`
  (`services/trade/chatSessions.ts:96-103`). `chatRowFrom`
  (`components/agents/AgentsView.tsx:246-294`) never sets it, so
  `ChatTranscriptRow.tsx:219` can never render the "Run stopped" card — the
  recovery affordance (Edit prompt / Try again) is unreachable on the surface where
  turns are started.
- The Chat surface also mounts `ChatTranscriptRow` with **only** `row`
  (`AgentsView.tsx:1438-1441`), so it loses the dock's Key Levels card, Retry chip
  and Pin chip. The memory-provenance strip is dock-only
  (`ChatTranscriptList.tsx:245-251`).
- The dev-proxy transport has **no timeout** (`GenericProviderService.ts:1411-1427`),
  so a dev turn can hang indefinitely.

### The proposed change

1. **Give `Message` an `interrupted` flag** and set it wherever the dock's
   `LiveEntry` already sets its own. One carrier, two homes. This is the same
   "one owner" discipline the codebase already applies to `Message.toolEvents`,
   `Message.toolIds` and `Message.botId`.
2. **Give the Chat surface the same row furniture the dock has** by passing the
   same view model the dock passes — one row contract, two renderers.
3. **Add the dev-proxy timeout** to match the other two transports (120 s).

### Benefit

A trader who presses Stop sees that the answer was cut, and can retry — instead of
reading a half-answer as a complete one. This is a *correctness* fix on the surface
where the trader actually talks to the harness.

### Risk

**Low.** `Message` gains one optional field; both homes read it; no stored shape
breaks (the field is absent on old rows, which is exactly "not interrupted").

### How to verify with a real test

- A **browser** test: start a turn, press Stop, and assert the Chat surface renders
  the "Run stopped" card. `npm run render-probe` already asserts cross-surface
  liveness, so this is the same harness with one more assertion.
  **Note:** `render-probe`'s inert-control sweep covers **Knowledge and Journal
  only** (`:2198, 2338`) — the Trade and Chat surfaces are never swept. Extending
  the sweep to the Chat surface is a prerequisite for this and for P4's UI claims.
- A unit test that a persisted `Message` with `interrupted: true` renders the card
  and that one without it does not.

### Complexity delta

**Slightly negative.** One field replaces a per-home divergence, and one row contract
replaces two.

---

# P6 — Decide whether the session guardrails are a feature

**Verdict: ADOPT (as a decision, not as code)**
**Effort: S if the answer is "delete"; M if the answer is "wire"**
**Source: the August baseline §5. Reference: `hermes-agent` `cron/AGENTS.md` —
the **inactivity watchdog**: *"default 600s idle, `HERMES_CRON_TIMEOUT` overrides, `0`
= unlimited. It is idle time, not wall-clock — a stalled session is hard-interrupted
so it cannot monopolise the scheduler, while a long-but-active job is never cut off."*
`pi` `packages/durable/README.md` §"Failures and Recovery" — the **crash-loop
limit**: `settings.restartLimit` (default 5) parks a task with the reason
`restart_limit`, `wake()` stops counting it as active, and `onReport` delivers
`task_parked` **once**; *"A host can feed `task_faulted` reports of one kind to its
own breaker."***

### What August Trading does today

`SessionGuardService.ts:157-268` computes realised day P&L in USD, trades opened
today, the consecutive-loss streak and a 4-hour post-loss cooldown, and grades them
`clear | notice | warning | standdown` against a 2 % daily-loss budget
(`:44-51`). `formatGuardContextBlock` (`:271-280`) would inject it into the prompt.

**It is called only from tests.** So the trader's 2 % daily-loss budget, their
2-trades-a-day cap, the streak pause and the post-loss cooldown have never once
fired. The daily loss limit is the kind of guard a trading product is trusted on.

At the same time, the *chat* path has no deterministic gate at all
(baseline §5, Chain B): `useAnalysisPipeline.ts:1203` reduces the gate injection to
`''`, and the calibration penalty, the provider-accuracy note, the similar-setups
and regime weighting all reach the model as prose only. The deterministic half of
the guard system is dead ON THE CHAT PATH — `applyNotebookSkillsToAnalysis` is live on the plan path (`services/trade/presentTradeTool.ts:113`), and the
the predicate gate's confidence ceiling is computed and dropped.

### The proposed change

**Make a decision and write it down. Two acceptable outcomes; one is not.**

- **Option A (delete, and say so).** Delete `SessionGuardService` and
  `TradeValidationGate` (P4) and record in `docs/plan/` that August Trading is a
  *decision-support* tool: it advises, it does not enforce trading limits. The
  trader's discipline is the trader's. This is honest, and it is the lower-complexity
  answer.
- **Option B (wire the one that matters).** Keep `assessSession` and put it where
  the only binding gate is: `present_trade` (which already refuses, at
  `services/trade/presentTradeTool.ts:113-133`) and the log boundary
  (`App.tsx:1577-1595`). A guard that *refuses* is worth having; a guard that
  *advises* is a sentence in a prompt.

**Recommendation: Option A.** The product goal is *"helping the user do their
trading work"* — a harness for review, journaling, intake, analysis and learning.
A refusal that blocks a trade because of a P&L number the harness computed is a
new product decision with a new UX surface (a "you are stood down" screen), and the
trader is the one who should decide their limits. Delete it, and say so plainly.

If Option B is chosen instead, the *reference* tells you how to build it well: an
**idle** watchdog rather than a wall-clock one, a limit that **parks** with a
**reason**, and a report that fires **once**.

### Concrete files touched

`services/validation/SessionGuardService.ts` (delete, Option A),
`services/validation/TradeValidationGate.ts` (delete — P4),
`docs/plan/` (the decision), `docs/app-flow.md` (the claims).

### Benefit

Either the trader gets a guard that actually fires, or the app stops pretending it
has one. Today it has neither: the code says "we guard your daily loss" and the
guard never runs.

### Risk

**Low** for Option A. For Option B, the risk is a new refusal path the trader
cannot work around — which is why Option A is the recommendation.

### How to verify with a real test

- Option A: `tests/deadControlsGuard.test.ts` gains a pin that `assessSession`
  and `formatGuardContextBlock` have no production call site; `docs/app-flow.md` no
  longer claims a guard. The two pure helpers the rest of the app imports
  (`rowPnlUsd`, `utcDayStart`) stay — or move to a two-function module — so the
  deletion is of the **guard**, not of the file.
- Option B: a unit test that three losing trades in a day make `assessSession`
  return `standdown`, and a test that `present_trade` then refuses — plus a browser
  test that the refusal is visible.

### Complexity delta

Option A: **strongly negative** (one 12 KB module and one 41 KB orchestrator gone).
Option B: **negative** (a dead module becomes a live one, no new module) but it
adds a refusal path to the UI.

---

# P7 — The model's view of the journal: one block, one clock, one query path

**Verdict: ADOPT**
**Effort: M**
**Source: the August baseline §8. Reference: `pi` `packages/ai/src/providers/data/*.json`
+ `packages/ai/scripts/model-data.ts:214-301` — the *"no heavy database"* answer:
**file-per-record JSON, a manifest, and a validator**; and
`packages/ai/src/scripts/hydrate-model-catalog.ts:66-80` — atomic publication
(stage in a temp dir, validate, then rename). `hermes-agent`
`tools/skill_ledger.py` — a JSONL ledger, not the state DB: *"durable, greppable,
survives DB resets."* `deepseek-harness`
`packages/spill/spill-local/src/index.ts:149-157` — the **spill** half: when a
payload is too big for the context it is written to a private session-scoped file
and the model gets **a path plus a retrieval hint** (*"Use read with offset/limit,
or grep this path to search within it"*), so the queryable log needs no database.
**August already has this pattern** — `services/analysis/toolArtifactStore.ts` plus
the `read_tool_output` tool — and should extend it rather than invent one.**

### What August Trading does today

- **One store, two backends.** The SQLite `trades` table
  (`services/infrastructure/SqliteService.ts:159-183/718-742/756-774`) and the
  IndexedDB profile blob (`services/infrastructure/dbService.ts:227-263`), keyed by
  `LoggedTrade.id` (= the Message id). `BackupService` carries `tradeLog`
  (`:116-156`); **`ExportService` does not** — only `BackupService` does, so on web
  a trade log is in the backup but not in the export.
- **The two surfaces use different clocks.** `get_trade_log`'s description says
  "the ISO time it was logged" but the code prints `decidedAt`
  (`utils/recentTradesBrief.ts:136`), while the Journal prints `loggedAt`
  (`components/journal/Journal.tsx:350`).
- **The tool's description is stale.** `MemoryRetrievalService.ts:7-11` still claims
  "the model … never the journal" — now false twice.
- **The training export omits fields**: `costR` / `netR` (the app's own canonical
  net-R, `types/trade.ts:228-235`), the benchmark alpha, `userPriorCall`,
  `postMortemModel` (`utils/reportExport.ts:171-255`).
- **There is no trade-history import of any kind.** CSV, pasted text, image and PDF
  are all *prompt text*; PDF is wired to the strategy book only
  (`components/settings/StrategiesManager.tsx:94/106`); an image is real *as
  analysis* but never becomes a journal row. Only the app's own capture funnel
  writes a row.

### The proposed change

1. **One clock, named.** Decide whether a journal row's "when" is when it was
   **logged** or when it was **decided**, and use that one in both places. The
   `LoggedTrade` shape can keep both fields; the *display* and the *tool* must
   agree. Then fix the tool's description to say which one it returns.
2. **Put `tradeLog` into `ExportService`.** The export is the trader's portable
   copy; the backup is a local safety net. The trade log is the product's data.
   `ExportService.RAW_LOCAL_STORAGE_PREFIXES` already exists as the one list of
   store owners; the trade log's owner is added there or the export silently omits
   it — the same trap `AGENTS.md` already documents for the other stores.
3. **Complete the training export** with `costR` / `netR` and the model that wrote
   the post-mortem. This is the one place the harness feeds the training pipeline,
   and it is the *only* place the out-of-scope part of the product is touched.
4. **A CSV importer, or none.** If the trader wants their broker history in the
   journal, that is a real feature and it belongs in the Journal surface. If it is
   not wanted, delete the CSV *prompt* path so the app stops implying it can.
   Do not leave a half-feature.

### Concrete files touched

`services/infrastructure/ExportService.ts`,
`services/infrastructure/BackupService.ts` (the reference),
`utils/recentTradesBrief.ts`, `components/journal/Journal.tsx`,
`utils/reportExport.ts`, `services/analysis/DeskToolsService.ts` (the tool
description), `services/learning/MemoryRetrievalService.ts` (the stale claim).

### Benefit

The trader's journal becomes portable, consistent and complete. The model's view of
it stops disagreeing with the trader's view of it.

### Risk

**Low-medium.** Item 2 changes what an export contains — the export/import round
trip is already tested (`tests/exportService.test.ts`), which is the right place to
extend it.

### How to verify with a real test

- `tests/exportService.test.ts`: a run with a trade log survives export → wipe →
  import, and the restored trade log is byte-equal.
- A unit test that the `get_trade_log` receipt's timestamp equals the Journal card's
  timestamp for the same trade — one assertion, two surfaces, one fact.
- A test that the training JSONL contains `netR` for a row that has one.

### Complexity delta

**Near zero to slightly positive.** Item 2 is a one-line addition to an existing
list. Item 1 removes a disagreement. Item 4 either adds a real feature (and its
cost is honest) or removes a misleading half-feature.

---

# P8 — Scheduled runs: at-most-once, an idle watchdog, and a breaker that names its reason

**Verdict: ADOPT**
**Effort: M**
**Source: the August baseline §4. Reference: `hermes-agent` `cron/AGENTS.md` —
*"Every recurring occurrence is accounted for: `tick()` advances `next_run_at`
**BEFORE** dispatch (at-most-once across a mid-run crash) and stamps `pending_slot`
in the same save; a scan that finds the stamp with a dead owner restores the instant
ONCE, the executions ledger's `scheduled_instant` blocks a second fire, and
`cron.catch_up_missed: false` skips past-grace misses **with a logged reason**.
Never drop a slot silently."* And the catch-up window: *"half the period, clamped to
120 s–2 h; 120 s grace for missed one-shots."* `deepseek-harness`
`packages/goal/goal-round-driver/src/index.ts:111/150/176` + `packages/goal/goal/src/fold.ts:325-330`
— the round allowance is a **durable admitted-round count derived from the log**, not
an in-memory counter, so it survives a restart; the driver fires only at whole-agent
idle, only for an *armed* goal, only after a fail-closed durability checkpoint, and
only once the agent's descendants have settled; at the cap it exits with a **stable
code** (`round-limit`) and there is **no auto-restart after a cancellation**. `pi`
`packages/durable/README.md` §"Persist and Resume" — *"A retried submission with the
same `requestId` returns the existing submission instead of submitting twice"* —
and §"Failures and Recovery" — the crash-loop `restartLimit` and the one-shot
`task_parked` report.**

### What August Trading does today

August Trading has a real automation surface
(`services/automation/AutomationService.ts`, `cronParser.ts`, `catchUpPlanner.ts`,
`hooks/useAutomations.ts`, and the E-57 §6 work: *"three empty runs stop the
schedule"*). What it lacks:

- **The breaker counts only error/skipped rows.** An automation run that is
  *empty but complete* does not trip it (baseline §4), so a schedule that has
  quietly stopped producing anything keeps its place.
- **There is no per-kind counting and no reason.** The breaker is a counter.
- **There is no at-most-once guarantee across a mid-run crash.**
- **There is no idle watchdog** at the job level: the provider timeouts
  (120 s / 300 s) bound the *request*, not the *job*.

### The proposed change

1. **Advance the slot before dispatch.** The scheduler should record the occurrence
   it is about to run **before** the run starts, so a crash mid-run cannot cause a
   second run. August's run history already has the row; it needs to be written
   first, not last.
2. **Derive the breaker's count from the run history, not from memory.** The DSH
   goal-round driver counts *admitted rounds* from the log
   (`packages/goal/goal/src/fold.ts:325-330`), so the count survives a restart. August's
   3-in-a-row breaker should count **rows in the run history**, so an app restart
   does not hand a broken schedule a fresh budget — and so the count is
   reconstructible when the trader asks "why did this stop?".
3. **Give the breaker a reason and a kind.** Count failures **per kind** (provider
   error / no-ready-provider / empty-but-complete / breaker-tripped) and show the
   reason on the card. A trader reading "this schedule stopped because it produced
   nothing three times" can fix it; "this schedule stopped" cannot. Use a **stable
   code** (the DSH `round-limit` pattern) so the reason is machine-readable.
4. **An idle watchdog for scheduled runs**, not just a request timeout: a run that
   has made no progress for N minutes is interrupted and recorded as interrupted.
   Hermes' rule is the one to copy: **idle, not wall-clock** — a long-but-active job
   is never cut off. And **no auto-restart after a cancellation**, so a cancelled
   schedule does not come back on its own.
5. **An idempotency key** on a scheduled run so a retried occurrence cannot present
   two plans. `utils/recentTradesBrief.ts` and the proposal-disposition store
   (`services/trade/proposalDisposition.ts:22-32`) already solve the analogous
   problem for the manual path; the scheduled path has no equivalent.

### Concrete files touched

`services/automation/AutomationService.ts`, `hooks/useAutomations.ts`,
`services/trade/automationTurn.ts`, the automation card
(`components/automation/`).

### Benefit

A scheduled run is the one thing in this app that acts **without the trader present**.
Right now, if it half-runs, it can half-run again; if it silently produces nothing,
nothing says so. This proposal makes the unattended path as auditable as the manual
one — and the product is explicitly a *review-and-journal* tool where the unattended
path should be conservative.

### Risk

**Medium** — the scheduler is the most delicate code in the app. Mitigation: the
occurrences are already persisted, so the change is a reordering plus a new field on
an existing row, and the existing E-57 §6 tests
(`tests/automationSettlement.test.tsx`) cover the breaker's current behaviour.

### How to verify with a real test

- A test that a run which dies mid-flight does **not** present two plans on the next
  tick (drive it with the mock provider failing after the first tool call).
- A test that an empty-but-complete run trips the breaker with the reason
  "produced nothing" and shows it on the card.
- A test that an idle run is interrupted and recorded as interrupted, while a
  long-but-active run is not.

### Complexity delta

**Slightly positive** — this adds fields and a watchdog. It is justified because the
unattended path is the one place the trader is not watching; the alternative is
accepting that a schedule can half-run forever.

---

# P9 — A provider that fails should cost one retry, not the turn

**Verdict: ADOPT**
**Effort: S**
**Source: the August baseline §4. Reference: `pi`
`packages/ai/src/utils/provider-retry.ts:99-128` + `packages/ai/src/utils/retry.ts:7-31,205-255`
— **two-layer retry**: an interruptible transport retry and a message-level retry
with an explicit non-retryable list; and `packages/ai/src/utils/overflow.ts:38-176`
— a table-driven overflow classifier with a **non-overflow exclusion list**, because
*"a Bedrock throttle reads 'Too many tokens' and would match the generic overflow
pattern without the exclusion list"*. `deepseek-harness` `docs/agent-lifecycle.md` —
`llm/retry`, `llm/retry-started` and `agent/request-error` are first-class events.**

### What August Trading does today

**There is no runtime provider/model fallback on the chat, dock, analysis or
automation path.** A provider 500/429/401 ends the turn
(`GenericProviderService.ts:1501-1506/1722-1727`,
`useAnalysisPipeline.ts:1338-1344`, `automationTurn.ts:95-116`). No second provider
is tried and there is no "answered by another model" notice.

What *does* exist:

- A **resolution-time** fallback for a stale pick — real, with an amber banner in
  both composers (`utils/providerUtils.ts:119-134`, `tests/modelFallbackBanner.test.tsx`).
  That is a different thing, and the banner says "stale pick", not "the provider
  failed".
- **Within-provider resilience**: 3 attempts with jittered backoff and `Retry-After`
  honoured, and timeout/401/quota deliberately not retried
  (`utils/apiErrorUtils.ts:65-76/116-156`); a 400/422 degrade ladder
  (`GenericProviderService.ts:585-633`); context compaction and one retry
  (`:1324-1341`).
- A **provider health ledger and a 10-minute cooldown bench**
  (`ProviderHealthService.ts:41-43/104-122`) that is read in only three places, none
  of them the turn path (`App.tsx:328-336`, `botAttention.ts:55`). **A benched
  provider keeps answering the trader.**
- The one real cross-provider fallback — `AITrendlineService.analyzeWithAI`
  (`services/analysis/AITrendlineService.ts:46-60/225-243`) — **fails silently** to a
  hard-coded "AI analysis unavailable" with only a `console.error`.

### The proposed change

1. **One fallback, once.** When a turn's provider fails with a *retryable* class
   (5xx, 429, a network error) and the trader has another ready provider, try it
   **once**, and say so: the answer's row records which provider answered, and the
   turn is marked as having been answered by a fallback. Do not retry a 401 or a
   quota error — those are the trader's to fix, and the references are explicit
   that quota is not retryable.
2. **Consult the cooldown bench on the turn path.** A provider the health ledger
   has benched should not be picked for a chat turn. This is a two-line change and
   it uses a ledger that already exists.
3. **Never fail silently.** The `AITrendlineService` fallback must surface its
   failure through the same path the rest of the app uses, not a `console.error`.
4. **One overflow predicate.** If a provider's error text is matched for "context
   overflow", the matcher must exclude quota and throttle text — otherwise a 429
   is compacted and retried forever. August's compaction already keys on the
   provider's *stated* limit (`utils/contextWindow.ts:233-250`), which is the right
   shape; the classifier around it should follow the reference's exclusion-list
   rule.

### Concrete files touched

`services/providers/GenericProviderService.ts`,
`services/infrastructure/ProviderHealthService.ts`, `utils/providerUtils.ts`,
`services/analysis/AITrendlineService.ts`, `types/provider.ts` (the `WireAuditEntry`
already has the shape to record "answered by a fallback").

### Benefit

A transient provider failure no longer costs the trader the turn. The cooldown
bench stops recommending a provider the app already knows is unhealthy. And the one
silent failure in the app stops being silent.

### Risk

**Low-medium.** The retry policy already exists and is tested
(`tests/providerDegradeLadder.test.ts`); this extends it one layer. The risk is a
fallback that answers with a *different* model's judgement without saying so — which
is why the fallback must be recorded on the answer's row, not just in a log.

### How to verify with a real test

- With the mock provider: make the primary provider return 500, and assert the turn
  is answered by the fallback, that the answer's row names the provider that
  answered, and that the trader is told.
- With the mock provider: return 429 and assert there is **no** fallback and a clear
  message.
- A test that the `AITrendlineService` total failure surfaces a message rather than
  a `console.error`.

### Complexity delta

**Slightly positive** (one fallback path, one health-bench consult). It is paid for
by removing the silent failure in (3), which is a simplification in its own right.

---

# P10 — The skill index and the injection must use the same filter

**Verdict: ADOPT**
**Effort: S**
**Source: the August baseline §3. Reference: `hermes-agent`
`tools/skill_manager_tool.py` — `created_by: agent` is an **explicit marker**, *"never
inferred from location"*; `tools/skill_usage.py` — usage telemetry lives in a
**sidecar** `.usage.json`, *"never frontmatter — keeps telemetry out of user-authored
SKILL.md and off bundled/hub skills"*; `tools/skill_provenance.py` — a
**write-origin** ContextVar separating a background review's writes from a
foreground, user-directed one. `deepseek-harness`
`packages/goal/tool-goal/src/authority.ts:100/111` — a **two-tier authority**
(`direct-human` for edit/pause/resume; `direct-human` *or* `goal-round` for
complete/blocked), with **the session log as the audit trail**: *"every mutation is a
`goal/change` event with the full post-mutation snapshot, and the fold can prove
that a recorded change was legal"* (`packages/goal/goal/src/fold.ts:200`) — *"There
is no separate approval table; the log IS the audit trail"* — and
`packages/goal/tool-goal/src/index.ts:270`, where **the model cannot resume a
durably paused goal**: the human owns that transition.**

### What August Trading does today

The skill system is August's strongest area: 18 of 22 guards genuinely bite, human
approval is the only writer, and the activation gate `isApprovedSkill`
(`SkillMemoryService.ts:991`) is enforced at `MemoryRetrievalService.ts:226`.

But **the index filter and the injection filter disagree**:

- The injection path checks approval (`MemoryRetrievalService.ts:226`).
- The index path does **not** (`services/trade/tradeChatContext.ts:265`).

So an **unapproved** skill is **named** to the model and never **given** to it. The
model is told a rule exists and is then not allowed to use it — which reads to the
model as a broken promise and to the trader as a flaky system.

Two related facts from the same area:

- The IF/THEN auto-ingest writes a file with `prior: 'gated'` and **no
  `approvedBy`** (`SkillMemoryService.ts:2996/3085`), so `isApprovedSkill` blocks it
  — yet the index still names it.
- The **hard avoid veto is live, but only on the plan path.**
  `applyNotebookSkillsToAnalysis` (`SkillMemoryService.ts:3819`) is called at
  `services/trade/presentTradeTool.ts:113`, and a fired AVOID **refuses the
  presentation** and writes the falsification ledger (`:114-133`). On the **chat**
  path there is no deterministic skill enforcement at all: the code-checked trigger's
  note is computed at `hooks/useAnalysisPipeline.ts:1102` and then dropped with the
  rest of `enhancedPrompt` (see P1).

### The proposed change

1. **One filter, one owner.** Move the index's filter onto the same predicate the
   injection uses, so a skill is either visible or not, everywhere. This is a
   one-line change with a visible effect.
2. **Mark the auto-ingested file so it is honestly named.** Either give it an
   `approvedBy` (it is a *gated* draft, so it should not be) or exclude gated
   drafts from the index. The current state — named but unusable — is the bug.
3. **Give the chat path the same deterministic enforcement the plan path has.**
   The plan path already refuses a vetoed setup (`presentTradeTool.ts:114-133`) and
   folds the predicate ceiling into the stamp it records
   (`presentTradeTool.ts:140-144`). The chat path computes the same
   code-checked trigger (`hooks/useAnalysisPipeline.ts:1102`) and then drops it with
   the rest of `enhancedPrompt`. This is not a new mechanism — it is the existing
   one, wired to the other surface. (It is also the second reason P1 matters.)
4. **Make the recorded fact the only thing both readers use.** The reference's
   two-tier authority is worth copying in shape: an approval is a *fact about a
   skill* (`approved` / `gated` / `retired`) that the record holds, and the code can
   prove a recorded approval was legal — rather than a separate table that can
   disagree with the notebook. August already writes that fact (`approvedBy`); the
   change is to make it the **only** thing the index and the injection read, which
   is item 1.

### Concrete files touched

`services/trade/tradeChatContext.ts:265`,
`services/learning/MemoryRetrievalService.ts:226`,
`services/learning/SkillMemoryService.ts` (`:2996/3085`, `:3819`),
`components/agents/CoachThreadPanel.tsx`.

### Benefit

The model stops being told about rules it may not use, and the trader's approval
gate becomes the *only* gate — which is the design the system already has.

### Risk

**Low.** The change narrows what the index shows, so a rule that is currently named
stops being named. That is the intent, and the index is already filtered by
`isApprovedSkill` on the injection side, so nothing new becomes usable.

### How to verify with a real test

- A unit test: a skill with `prior: 'gated'` and no `approvedBy` appears in
  **neither** the index nor the injected body; a skill with `approvedBy` appears in
  both.
- A test that the index's filter and the injection's filter are the **same
  function** — a source-level assertion, like the ones
  `tests/deadControlsGuard.test.ts` already makes. This is the only way the two
  cannot drift again.

### Complexity delta

**Slightly negative** — one filter instead of two, which is the "keep one source of
truth" rule the codebase already states in `AGENTS.md`.

---

# P11 — A generated, validated catalogue of the desk's tools

**Verdict: ADOPT**
**Effort: M**
**Source: reference `deepseek-harness` `docs/tool-catalog.md` — the generator
**boots each tool plugin on a real context** and reads `ctx.tools.schemas()`,
*"because a tool schema is not statically knowable (runtime-spread enums,
concatenated descriptions, config-driven names, raw-JSON-Schema MCP tools)"*, and a
**completeness guard** *"fails if any package is missing from the generator's boot
manifest, so a new tool cannot be silently undocumented."* Also `pi`
`packages/ai/scripts/model-data.ts:214-301` — a manifest with a schema version, a
structure hash and per-file SHA-256, plus a build gate that refuses stale data;
and `packages/ai/src/scripts/hydrate-model-catalog.ts:66-80` — atomic publication
(stage, validate, rename).**

### What August Trading does today

August already has a *partial* version of this idea, and it is good:
`utils/toolKinds.ts` is the ONE tool-kind vocabulary, and
`tests/turnStatus.test.ts:228-266` measures it **against the desk service's own
tool list**, so a new tool cannot slip through unlabelled. `AGENTS.md` records the
same discipline for `utils/turnStatus.ts` and `utils/toolKinds.ts`.

What it does not have is the **schema** side. `DESK_TOOL_DEFINITIONS`
(`services/analysis/DeskToolsService.ts:909-1543`) is a hand-maintained table, and
the **model-facing** description, the JSON Schema and the human label live in
several places. The result is exactly the P2 bug: the schema says `reason` is
required and the handler ignores it — a drift that no test can see, because the
test only measures *names*.

### The proposed change

1. **Generate the tool catalogue from the live registry**, the way DSH does: boot
   the desk's own tool table and read the schemas it would actually send.
2. **Add a completeness guard** that fails the build if a tool in the registry is
   missing from the catalogue, and a **staleness check** (a hash) so the catalogue
   cannot silently drift.
3. **Publish it as a one-line entry per tool** and hang the existing
   `tests/turnStatus.test.ts` vocabulary check off it, so the human label, the
   model-facing name, the schema and the kind all come from one place.
4. **Then, and only then, add a contract test** that every tool's JSON Schema
   matches what the handler reads — which is what would have caught P2 on the day it
   was written.

### Concrete files touched

`services/analysis/DeskToolsService.ts` (the definitions table),
`utils/toolKinds.ts`, `tests/turnStatus.test.ts`, a new
`scripts/gen-tool-catalog.ts` and a new `docs/` page, plus a CI step.

### Benefit

One place where a tool's name, label, schema and kind are defined. The next
`propose_skill`-class defect becomes a **build failure** instead of a report from a
trader.

### Risk

**Medium.** A generator is new machinery, and the task's rule is to prefer removal
to addition. The mitigation is that the catalogue is *generated*, not maintained —
it adds no ongoing work — and it replaces the hand-written schema strings the tool
table already carries.

### How to verify with a real test

- The generator's output is **committed**, and CI fails if regenerating produces a
  different file (a staleness gate).
- A test that fails when a tool is added to the registry and not to the catalogue.

### Complexity delta

**Neutral to slightly positive.** It adds a generator and a CI step, and it removes
the hand-maintained schema text. Justified only because it is the mechanism that
makes P2's class of defect impossible — and because the codebase already has half
of it (`toolKinds.ts` + the vocabulary test).

---

# P12 — What the model actually saw

**Verdict: ADAPT (small)**
**Effort: S**
**Source: reference `pi` `packages/ai/src/telemetry.ts:39-104` — a telemetry schema
declared as data, with content never recorded, but **block sizes and
time-to-first-chunk always recorded**; `packages/ai/src/types.ts:257-260` — session
affinity as a first-class request concept, so the upstream routes related requests
to the same replica and the prompt cache hits. `hermes-agent`
`tools/skill_provenance.py` — a write-origin ContextVar.**

### What August Trading does today

August already has the shape of this: `WireAuditEntry` (`types/provider.ts:38-67`)
records what the wire was actually asked, and `components/shared/WireAuditRow.tsx`
says which capability route the transport applied — or **why it applied none**.
It distinguishes *"did not think"* from *"never asked to"*.

What it does not record is the **context**: which skills were in the prompt, which
memory was retrieved, which tools were offered. `Message.memoryRetrieved` exists in
the type and has **no producer** (baseline §8) — a field the codebase already
promised and never filled.

### The proposed change

**Fill in the one field that already exists.** `Message.memoryRetrieved` becomes
real: the list of retrieval sources that went into the turn, recorded on the
message. `MemoryRetrievalService.listRetrievedMemorySources` already returns it
(`MemoryRetrievalService.ts:152`); it is simply dropped.

Do **not** build a new telemetry subsystem. The reference's telemetry idea is right
in shape (content never recorded, sizes and timings always) but August's needs are
smaller: the trader wants to know *"what did the AI actually remember for this
answer?"*, and the app already has a strip for it
(`components/chat/MemoryProvenanceStrip.tsx:1-178`) that is **dock-only**.

### Concrete files touched

`types/message.ts`, `services/learning/MemoryRetrievalService.ts`,
`components/chat/MemoryProvenanceStrip.tsx` (mount it on the Chat surface too —
`components/agents/AgentsView.tsx`).

### Benefit

The trader can see what the model was given. Today the strip is dock-only and the
field behind it has no writer.

### Risk

**Low.**

### How to verify with a real test

- A unit test: a turn that retrieved two memory sources records both on the
  message.
- A browser test: the provenance strip on the Chat surface opens and lists the
  sources of the turn above it.

### Complexity delta

**Slightly negative** — it fills an existing field and mounts an existing component
on the second surface.

---

# Considered and rejected

| Idea | Source | Why not |
| --- | --- | --- |
| **Reintroduce a moderator / multi-seat debate** | `hermes-agent`'s gateway and panels; August's own deleted `ensembleService.ts` | The owner ruling is recorded (`docs/plans/debate-deletion-status.md:3-8`, `:110-116`): one analyst pass reached by tool calling. A proposal that reintroduces a committee must argue against the *current* product, and the current product is a review-and-journal harness, not a consensus engine. **Rejected.** |
| **Auto-inject the whole retrieved notebook every turn** | `pi` durable §"System Prompt"; `hermes-agent` memory | The reference repos send a *small, structured* system prompt; they do not pour a long notebook into every turn. August has `recall` for the rest. Sending everything would also make P1 an *addition* rather than a simplification. **Rejected in favour of P1's one small block.** |
| **A SQLite database for the review/learning system** | — | Explicitly ruled out by the task and by `AGENTS.md` (the notebook is files; `utils/memoryBudget.ts` refuses growth rather than evicting). Hermes' answer — a JSONL ledger plus file-per-record and a validator — is the shape to borrow, and it is files. **Rejected.** |
| **A "personalised" model catalogue showing only what one key may use** | `pi` `packages/ai/src/providers/openrouter.ts:24-60` | Attractive, but August's providers are runtime-configured and the trader picks the model (`components/shared/ModelMenu.tsx`). The catalogue exists; the *filter* is a small UI nicety, not a harness improvement. **Rejected as out of scope.** |
| **A task-graph panel for the trader** | `pi` durable §"Task Graph" | The graph is for a host application with many concurrent tasks. August has automations, a bot roster and a room — but a graph *panel* is a new surface, which the minimalist direction forbids, and the app's own "Activity drawer" already covers the one case. **Rejected.** |
| **Per-model capability flags to replace provider branches** | `pi` `packages/ai/src/providers/compat-schema.ts:188-538` | Genuinely good, but August's provider branches are in a single 113 KB service that already works, and the reference's own version is ~90 boolean flags with a silent-typo hazard (`additionalProperties: true` everywhere) — a complexity *increase* August does not need. **Deferred, not rejected** — worth doing if the provider surface grows again. |
| **Compaction as a script with a journal** (pi codemode) | `pi` durable §"Code Mode" | Impressive, and it is exactly the kind of thing that would let the model run a multi-step pipeline in one turn. But it is a whole new execution model, a sandbox, and a replay journal — a large net complexity increase for a harness whose product goal is review and journaling. **Rejected on complexity.** |
| **Rewriting the Chat surface to match the dock's row furniture** | — (August's own gap) | *Partly adopted*, as P5: the fix is one shared row contract, not a rewrite. The full rewrite is rejected. |
| **A `last20` steering column that changes model routing** | `ModelPerformanceService.ts:531-629/1041-1138` (dead) | Tempting — the code to demote a cold model already exists. But the code is **dead** and the live weighted-voting context ranks by all-time win rate (`:649`). Wiring model routing to a 20-trade window is a product decision about model selection, and it would need a *ledger* of provider fitness — which is exactly the dead `providerFitness.ts` with its non-existent consumer. **Rejected as a product decision; the dead code should be deleted (P4), not wired.** |
| **Crypto-style per-provider "reasoning" pricing tables** | `pi` `packages/ai/src/models.ts:1236-1256` | August already records `modelsUsed` on analysis and journal rows, so the *data* is there; a price table is a product feature for a cost dashboard, not a harness improvement. **Rejected as out of scope.** |
| **A durable write-ahead log for turns** | `pi` durable §"Persist and Resume" | Genuinely the strongest reference idea for the *scheduled* path (P8). For the interactive path it is a large new storage subsystem for a desktop app that already persists its transcript. **Adopted in part (P8); rejected for the interactive path.** |

---

# The ranked top five

**Recommendation: do these five, in this order. Do not start anything else until
they are done and green.** Each one is either a removal or a small addition that
closes a hole the trader can actually feel. Together they take the harness from
*343 features, 61 of them dead* to a smaller, honest, working system.

### 1. P4 — Delete the dead subsystems and fix the documents that describe them as live

**Why first:** it is the largest single simplification available — a 41 KB
orchestrator with zero importers, a 242-line unmounted component, a write-only
store, ~20 dead exports, and a flow document that tells the reader a test-only gate
is a live pre-trade refusal. It is also the precondition for almost everything else:
until the dead code is gone, nobody can tell which of two similar mechanisms is the
real one, and the proposals below will each be harder to land.

**Do it in three commits** (modules → exports → documents), `typecheck` and `test`
green between each, and extend `tests/deadControlsGuard.test.ts` to pin the
absence of what is deleted — that test is the only thing that stops it coming back.

*Do P6's decision first (delete or wire the session guardrails), because P4 deletes
`TradeValidationGate` and `SessionGuardService` and P6 is the decision about them.*

### 2. P1 — Send one small journal block; delete the rest of the context assembler

**Why second:** it is the defect that makes the app's whole memory system look real
and behave hollow, and it is the *cause* of the baseline's "last-20 brief never
reaches a model" finding. The trader is trading against a model that does not know
their track record unless it thinks to ask.

**The complex half is a deletion**, which is why it belongs early: four writes and
one devLog read of a variable nobody sends, plus three multi-seat context seams
left over from the deleted debate engine. The additive half is one small block in
an existing prompt builder.

### 3. P2 — Fix the `propose_skill` contract

**Why third:** the human approval gate is the trust anchor of the whole learning
system, and right now the tool throws away the evidence the human is supposed to
judge — the schema *requires* a `reason` and the handler never reads it. The
sibling `revise_skill` keeps its reason, so the fix is a known, small, local change.

**It is also the cheapest of the five** (S), and it closes a gate that no probe
currently covers: `skill-approval-probe` seeds the draft bytes, so the segment
between the tool call and the inbox is untested. Extending that probe is part of
the work.

### 4. P10 — One filter for the skill index and the skill injection

**Why fourth:** a one-line change with a visible effect. Today an unapproved skill
is **named** to the model and never **given** to it, which reads to the model as a
broken promise and to the trader as a flaky system. It also fixes the related
"gated draft is named but unusable" case.

**Do it right after P2**, because both are about the same subsystem and the same
notebook, and a learner who fixes one and not the other will meet the other.

### 5. P3 — An unattended run may not do what a human must approve

**Why fifth:** the unattended skill evaluator currently has **no tool allow-list at
all**, so a detached job can call `propose_skill`, `decline_trade`, and every
forged `custom_*` tool — which may POST. That is a real blast radius, and it is
one of the two reasons P2 matters. It is small: reuse the list that
`services/trade/automationTurn.ts:56-64` already owns, and make the consequential
tools refuse an unattended context, the way Hermes refuses a headless tick.

**It goes fifth because it is the least trader-visible** — it is a safety property,
not a feature. It should not be delayed, but it should not displace the four above.

---

**Deliberately not in the top five, and why:**

- **P8 (scheduled-run reliability)** is the strongest *reference* story here —
  Hermes' at-most-once slot accounting and Pi's crash-loop park are both directly
  applicable — and the unattended path is the one place the trader is not watching.
  It is fifth-instead of sixth rather than ignored: if the trader agrees that
  unattended runs are a priority, promote it above P3.
- **P9 (provider fallback)** is a real improvement to a felt failure ("the model
  said no"), but it adds a path rather than removing one, and the current
  within-provider resilience is already good.
- **P11 (generated tool catalogue)** is the mechanism that would make P2's class of
  defect impossible, but it is new machinery in a codebase that should be getting
  *smaller*. Do it if a second `propose_skill`-class defect appears.
- **P5 (stopped turns)** is a correctness fix on the Chat surface and should be
  done — but it needs `render-probe`'s inert-control sweep extended to the Chat
  surface first, which is itself a change to the probe.
