# August Trading — Enhancement Proposals, ranked by impact

**Audit date:** 2026-10-21 · **Commit:** `b584d7ee1cbc2360bc1d90098c6a3191b221a1cf`
**Companion reports:** `2026-10-21-01-system-and-data-flow.md` (evidence), `-03-new-features.md`, `-04-cleanup-manifest.md`

**How to read the roadmap column.** The prior audit's registers live in `docs/plan/open-items.md` (`O-nn`, open items) and `docs/plan/audit/2026-10-19-0{2,3}-*.md` (`E-nn`, enhancements; `N-nn`, features). Each proposal below carries one of:

- **ALREADY COVERED** — an existing `E-nn`/`O-nn` item names this fix. Cite it; the work is planned, not new.
- **PARTIAL** — an existing item covers part of it. Cite it and say which half is missing.
- **NOT IN THE REGISTER** — a finding this audit produced that no roadmap item names. **These are the ones the trader has never been shown.**

Items are ordered by **trader-visible impact × confidence ÷ effort**, not by how easy they are. Effort is in *trader-days*; risk is the chance the change breaks something that currently works.

---

## Tier 1 — the deterministic layer the app is missing

### B-01 · Give the skill-evaluation surface an allow-list
**Impact: high · Effort: 0.5 d · Risk: low · Roadmap: NOT IN THE REGISTER**

`SkillEvalScheduler.ts:284-294` calls `analyzeTradingView(cfg, { prompt, images: [], …, temperature: 0.2 })` with **no `allowedTools`**. The executor's allow-list gate is `DeskToolsService.ts:2295`:

```ts
if (context.allowedTools && context.allowedTools.length > 0 && !context.allowedTools.includes(call.name)) {
    return rejectedResult(call, `${call.name} rejected: this tool is not available on this seat.`);
}
```

With `allowedTools` undefined the condition short-circuits and **nothing is refused**. `effectiveTools` then becomes the full pool (`DeskToolsService.ts:3524-3528`), and `deskToolsEnabled` defaults to **true** (`utils/harnessSettings.ts:110`).

The scheduler is fired **detached** from the trade-sync chain — `SkillMemoryService.ts:3798`: `void runDueSkillEvalWithDefaultRunner(…).catch(…)`, "Deliberately NOT awaited … up to a dozen provider calls must never stall the post-mortem chain."

**Consequence:** an unattended background evaluator can call `write_memory_note`, `remember`, `forget`, `amend_memory`, `propose_skill`, `revise_skill`, `propose_strategy`, `forge_tool` and `decline_trade` — **the exact eight tools the automation surface explicitly denies** (`automationTurn.ts:55-63`) — plus every confirmed forged `custom_*` HTTPS tool, whose endpoint the model itself authored.

The executor's own comment at `:2288-2294` names this exact threat ("the model can emit a tag for ANY desk tool — including ones its seat policy forbids"). The enforcement was built; the one seat that supplies no policy is the one that matters.

**Fix:** pass a read-only `allowedTools` subset from `SkillEvalScheduler.ts:284`, mirroring `AUTOMATION_UNATTENDED_DENY`. Add a test in the shape of `tests/automationToolTurn.test.ts:135-143` — assert the eval list contains no mutating tool **and** that each denied name still exists in the catalog, so a rename cannot silently un-deny it.

---

### B-02 · Make the small-context analysis path compose the same layer list
**Impact: high · Effort: 1 d · Risk: medium · Roadmap: NOT IN THE REGISTER**

`GenericAnalysisService.ts:358-370` composes **eleven** layers for a standard model:

```
contract · seat · job · vision · memory · override · playbook · strategies · desk_tools · risk · output
```

`:398-402` composes **two** for a small-context model:

```ts
const effectiveSystemPrompt = composePrompt([
    { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
    { id: 'job', text: getPrompt('analysis.compact', COMPACT_ANALYSIS_PROMPT) },
]);
```

**Dropped without warning:** `vision` (even when `hasImages` is true — a small-context *vision* model gets chart images and no instruction to read them), `memory`, `override` (**the trader's own custom instructions**), `playbook`, `strategies`, `desk_tools`, `risk`, `output`.

`promptRegistry.ts:73` advertises `analysis.risk_rules` with `usage: ['All analysis modes']`. It is not sent in one of the two analysis modes.

**Why it matters:** a trader who writes "always wait for the 1H close" in Settings gets it on a large model and not on a small one, with no indication. The R:R floor then arrives only as the clause "R:R must be >= 1.2" inside the compact prompt, without the "show the math" and "% to each target" rules.

**Fix:** build one layer list and drop only the payload-heavy layers for small context. Keep `override`, `risk` and `output` — they are short (237 + 375 chars) and they are the ones whose absence changes the answer.

---

### B-03 · Cut the tool-schema tax
**Impact: high · Effort: 3–5 d · Risk: medium · Roadmap: ALREADY COVERED — `E-30`, `O-58`, `O-59`**

Measured at HEAD (importing the real definitions, serialising exactly what the loop sends):

| surface | tools | schema | mandate | total | schema : mandate |
|---|---|---|---|---|---|
| Dock | 40 | 37,133 ch ≈ **9,284 tok** | 614 tok | **9,897 tok** | **15.1×** |
| Chat | 31 | 29,094 ch ≈ 7,274 tok | 649 tok | 7,922 tok | 11.2× |

**The prior audit's "~7,864 tokens" under-counts by ~18%** — it measured `DESK_TOOL_DEFINITIONS` (31) and treated the 9 chart-action tools in `CHART_ACTION_TOOL_DEFS` as a separate figure. The loop sends all 40 in one request. **Correct the number in the register.**

With `MAX_DESK_TOOL_ROUNDS = 8` and no prompt caching, one full dock turn re-sends **≈ 79,176 tokens** of schema+mandate. The compactor cannot help: `services/providers/contextCompact.ts:52-54` states it plainly — *"Tool schemas are NOT in the message array and cannot be counted here."*

**Three levers, cheapest first:**
1. **Split the schema array by surface** — the dock's 9 chart-action tools cost 1,938 tokens and are already dock-only; the chat's 31 could be cut to the market-read subset the surface actually uses.
2. **Trim the mandate to what a schema cannot say** — `run_monte_carlo`'s ~570-char parameter paragraph (`DeskToolsService.ts:1716`) restates the schema verbatim (`:1459,1463-1478`), and the ATR rule is stated twice in two phrasings. ~1,400 chars removable with no loss.
3. **Provider-side prompt caching**, where the provider supports it (`O-58`).

---

### B-04 · Wire the validation gate, or retire it
**Impact: high · Effort: 1 d (wire) or 0.5 d (retire) · Risk: medium · Roadmap: ALREADY COVERED — `O-10`, `E-02` (reframed)**

`services/validation/TradeValidationGate.ts` — 857 lines, `runValidationGate` at `:495`. Its only non-test reference in the tree is `tests/accuracyValidation.test.ts:3`. It scores confidence bands, R:R, leverage, liquidation distance, expected value and 20+ other dimensions, and **no production code calls it**.

It also holds the last surviving duplicate of the R:R formula: `:183` reads `analysis.takeProfit[0].price` where the live path (`utils/riskReward.ts`) uses the *nearest* target. The live path, the card, the journal and the clamp all agree; only the dead gate does not. **So `O-01`/`O-02` should be closed as "no longer reachable", not "fixed"** — a different statement than the register makes.

**Two honest options, and the trader should pick one:**
- **Wire it** — but then `O-06` ("the gate caps, it does not refuse"), `O-07` (`minEdge` refuse) and `E-43` become live scope, and the unwired gate's index-0 R:R must be fixed first.
- **Retire it** — delete 857 lines and the one test file, and close `O-01`, `O-02`, `O-04`, `O-10` as *not applicable*. Cheapest, and the register's own `E-02` reframe says the module it fixes is not wired.

**Recommendation: retire it.** The live `proposalGate` + the skill-predicate ceiling + the hard veto already cover the path that matters; adding a second, differently-calibrated scorer is how the two R:R definitions drifted in the first place.

---

### B-05 · Close the export/restore list asymmetry
**Impact: high (data loss) · Effort: 0.5 d · Risk: low · Roadmap: PARTIAL — `O-99` covers the mirror half; this half is NOT IN THE REGISTER**

`ExportService.ts` keeps two allow-lists — `RAW_LOCAL_STORAGE_PREFIXES` (`:298-407`) and `RESTORABLE_PREFERENCE_KEY_PREFIXES` (`:728-803`) — and they are **not the same set**.

| namespace | RAW | RESTORE | effect |
|---|---|---|---|
| `trade_tool_payloads` | ✅ | ❌ | exported, then **refused on import** |
| `supervisor_triaged_v1` | ✅ | ❌ | same |
| `learning_distill` | ❌ | ❌ | exported by the Preferences sweep, refused on import |
| `memory_hygiene` | ❌ | ❌ | same |
| `automation_plans` | ❌ | ❌ | same |
| `supervisor_last_run_v1` | ✅ | ✅ | **already fixed** |

`ExportService.ts:759-763` records that fix in as many words: *"the export sweep found it in localStorage and wrote it into every backup, then import dropped it as un-allow-listed — a key the app ships and refuses to take back. Harmless data, but it is the same shape of bug as the learning stores above: one list, not two."*

**The fix was applied to one key and not to the five siblings the comment names.** `O-99` recorded the opposite direction (five restore-listed but not raw-listed) and is still OPEN.

**Fix:** one test that asserts the symmetric difference of the two lists is empty, failing with the diff. That is what stops the class from growing — the one-off fix did not.

---

### B-06 · Charge the round trip
**Impact: high · Effort: 3 d · Risk: medium · Roadmap: ALREADY COVERED — `E-03`, `O-19`, `O-20`, `O-21`, `O-22`**

**There is no cost model anywhere in the app.** No fee, slippage or funding term is ever charged. Every R, win rate, calibration bucket, expectancy figure and skill verdict is **gross**.

This is upstream of almost every learning-quality claim in the app. The register already computed the damage: the permitted-floor trade nets ≈ 0 R once the round trip is charged (`O-20`), the breakeven win rate moves 45.5 % → 50.0 %, and a "win" at TP1-then-breakeven is **+0.30R gross and −0.23R net** (`O-22`).

`utils/netRiskReward.ts` already exports `netEdgeR` and `roundTripCostR`, and `services/trade/proposedTrade.ts:24` imports them — so the primitives exist. What does not exist is a **single place where cost is applied to a settled trade** and every downstream consumer reads the net figure.

**Why this is first in the tier despite being third in my list of impact:** every other learning claim in the app is measured against a metric that is known to be wrong. Fixing the metric first would mean re-tuning everything that was tuned on the wrong one.

---

### B-07 · Auto-settle outcomes
**Impact: high · Effort: 2 d · Risk: medium · Roadmap: ALREADY COVERED — `E-18`, `O-28`**

The autopilot detects the SL/TP touch and stores a resolution, but the **row is written only in `handleConfirmAutopilot`**, with `markProcessed` after the click. With `isAutoCapturing` defaulting off, the click is the only path.

**Every learning consumer is starved behind it** — skills, patterns, rules, insights, calibration, the veto ledger, the skill worth-gate. `O-29` (the evidence floors are tuned for a world with no outcomes) is a same-release dependency, not a follow-on: `MIN_SAMPLE_FOR_VETO = 2` means a two-trade sample can zero a real setup.

`E-18` landed the design ("make the outcome automatic, reversible and provenanced"). The implementation is the remaining work.

---

## Tier 2 — real defects with a clear fix

### B-08 · Wrap the panel-tool dispatch in a deadline and a try/catch
**Impact: medium-high · Effort: 0.5 d · Risk: low · Roadmap: NOT IN THE REGISTER**

`DeskToolsService.ts:3721-3730` calls `await executeExtraTool(call)` with **no `withinToolDeadline` wrapper** and **no try/catch** — unlike the core path (`:3131-3135`) and the forged path (`:3755-3760`).

Two consequences:
- The **9 panel tools** (`draw_on_chart`, `draw_detected`, `mark_trade_levels`, `clear_chart_drawings`, `present_trade`, `decline_trade`, `watch_price`, `wake_me`, `cancel_watch`) have **no 20-second timeout**. They are the only tools that do not.
- A **throw** inside a panel handler propagates out of `runDeskToolLoop` → out of `streamChatWithDeskTools` (`:4200 await loopPromise`) and **kills the whole turn** instead of becoming a tool receipt. `runPresentTrade` is synchronous and unwrapped (`presentTradeTool.ts:78-`), so a throw in `applyNotebookSkillsToAnalysis` or `VetoLedgerService.recordVeto` (`:118`) aborts the turn.

The core executor already guarantees *"a throwing tool never kills the turn"* (`:2318` → `:3113-3122`). The panel lane is the one path that does not.

---

### B-09 · Make the 180-second turn budget a cap
**Impact: medium-high · Effort: 0.5 d · Risk: low · Roadmap: NOT IN THE REGISTER**

`DESK_TURN_BUDGET_MS = 180_000` (`DeskToolsService.ts:207`) with `DESK_TURN_WRAPUP_AT = 0.8` (`:208`). At 80 % of it the loop appends one **advisory** notice (`:3872-3875`): *"TIME — this turn is near its 180s ceiling. Write your reply now…"*

**There is no `break`.** `DESK_TURN_BUDGET_MS` appears at `:207`, `:208`, `:3872`, `:3874` and nowhere else. The docstring at `:198-205` calls it a "ceiling"; it stops nothing.

Real worst case: 8 rounds × (provider round-trip + up to 20 s of tool time). The provider stream timeout is **300 s** (`GenericProviderService.ts:643`), so one tool turn can run for roughly **43 minutes**, not 180 s. The 8-round cap and the 20-second per-tool cap are the only real bounds.

**Fix:** on budget exhaustion, break and emit the wrap-up reply. The notice already exists — it just needs a `break` after it.

---

### B-10 · Attach the Gate's constraints to the analysis prompt
**Impact: medium · Effort: 1 d · Risk: low · Roadmap: NOT IN THE REGISTER**

`constants/prompts/analysisPrompts.ts:70`:

> *"You are Stage 2 on a crypto futures desk. **The Gate Scan already passed** — respect its allowedFamilies and confidenceCap when they are present."*

The only producer of `allowedFamilies` and `confidenceCap` is `getGateAnalysis()` (`services/validation/GateKeeperService.ts:456`), whose `promptPrefix` is built at `:478-490`. **A repo-wide grep for `getGateAnalysis` returns only its own definition and a doc-comment example at `:447`. It is never called.**

The Gate *does* run — `services/trade/proposalGate.ts:25` imports `runProgrammaticGate` — but it runs **after** the model has spoken, on the proposed-trade card.

So the model is told to obey a cap it was never given, and is told it is "Stage 2" of a pipeline that has one stage. The constraints are already computed; they are simply attached to the wrong end of the turn.

**Fix:** compute the gate *before* the analysis turn and pass its prefix into the composed prompt — the same place the card gets it today.

---

### B-11 · Compose the analysis mandate from the offered set
**Impact: medium (latent) · Effort: 0.5 d · Risk: low · Roadmap: NOT IN THE REGISTER**

Every surface composes its mandate from the tools it will actually offer: `deskToolsMandateFor(offeredToolNames)` (`DeskToolsService.ts:1681`), called with the offered set at `:4071` → `:3961`. The mandate writes *"there is NO CHART to read on this home"* when `get_chart_view` is absent (`:1695-1704`).

**One surface does not.** `GenericAnalysisService.ts:353` builds a **static** mandate:

```ts
const deskToolsBlock = deskToolsEnabled
    ? `${DESK_TOOLS_PROMPT}${deskToolsNative ? '' : TEXT_TOOL_FALLBACK_PROMPT}`
    : '';
```

`DESK_TOOLS_PROMPT = deskToolsMandateFor()` — the *unfiltered* variant (`DeskToolsService.ts:1723`).

Today the two agree only because the analysis surface passes no allow-list either. **The moment `B-01` is implemented, this becomes live** — the eval seat would be told to call tools it is forbidden to call, which is exactly the defect the composed mandate was written to prevent.

**Ship `B-01` and `B-11` together, or `B-11` first.**

---

### B-12 · Make `present_trade`'s schema surface-aware
**Impact: medium · Effort: 1 d · Risk: low · Roadmap: NOT IN THE REGISTER**

The schema the model reads (`DeskToolsService.ts:1570`):

> *"Present a concrete, actionable trade to the user: **draws the Entry/Stop/Targets on the chart** AND shows a card with a 'Log this trade' button."*

The Chat surface offers `present_trade` (`chatSurfaceTurn.ts:74`) and wires **no** drawing sink (`:304-311`: `drawnPrice: null, crossCanvas: false, watchable: false`). Its own mandate says the same thing (`constants/prompts/chatPrompts.ts:44`): *"NO CHART HERE … you must not claim to have done them."*

The schema is the same array on every surface, so the model is told by the schema it will draw and by the mandate it must not claim to have drawn. On the Chat surface and on every scheduled run, a model that believes the description writes *"I've drawn your entry at X"* in prose.

**Fix:** either make the description conditional, or give the tool a per-surface `description` when the defs are assembled at `:3521-3523` (the assembly point already differs per surface).

---

### B-13 · Fix the provider-fitness inversion
**Impact: medium · Effort: 0.5 d · Risk: low · Roadmap: ALREADY COVERED — `E-04`, `O-115`**

A provider with one loss scores **0.0 %** — the same as a provider with no trades at all — then the providers are sorted descending and the arbiter is told to favour the top one. **A single loss can brand a model as the worst performer; a single lucky win the best.**

`services/learning/providerFitness.ts` (176 lines) computes it. The module has **no production importer** — only `tests/decisionBiasClosure.test.ts`. So the inverted score is currently computed and discarded. **Fix it before it is wired**, or the same inversion arrives with a UI attached.

---

### B-14 · Fix the write-side size bounds
**Impact: medium (data loss) · Effort: 1 d · Risk: low · Roadmap: ALREADY COVERED — `O-96`, `O-97`**

`O-96` — the export side is byte-bounded (3,500,000) but the **write** side is not. `trade_chat_sessions_v1` bounds 12 × 60 entries and `MAX_IMAGE_CHARS` = 1,200,000, but nothing bounds what a *write* may carry. The register calls it *"the only genuine data-loss path found."* It is unchanged.

`O-97` — `trade_session_drawings_v1` keeps every coin; `desk_tools_forged_v1` and `trading_checklist_v1` have no count cap.

`utils/memoryBudget.ts` already has the right shape for this (soft/trigger/hard byte caps, one classifier). The three stores need the same discipline.

---

### B-15 · Re-tighten the lint ratchet with no code change
**Impact: medium · Effort: 0.5 d · Risk: low · Roadmap: ALREADY COVERED — `E-29`**

`package.json` caps eslint at `--max-warnings 659`. The measured count at HEAD is **657** — 436 `no-explicit-any` and 220 `no-unused-vars` across 170 files, with `GenericProviderService.ts` alone carrying 54.

**Two slots of headroom.** `E-29` proposes tightening the cap with no code change; the honest version is to set it to **657** and let the next change that adds a warning be a deliberate act. The 220 `no-unused-vars` are the cheap ones — most are imports left behind by the 42 source files deleted since the prior audit's pin.

---

## Tier 3 — polish, consistency, and the register's own backlog

| # | proposal | effort | roadmap |
|---|---|---|---|
| **B-16** | **Delete the six dead prompt blocks.** `ENTRY_NOT_HIT_ANALYSIS_PROMPT`, `ENTRY_NOT_HIT_ANALYSIS_QUESTIONS`, `EXTENDED_SL_ZONE_DEBATE_CONTEXT` (`constants/prompts/learningPrompts.ts:7,17,64`) and `DUAL_SCENARIO_JSON_SCHEMA`, `MASTER_TRADE_PLAN_MARKDOWN`, `GATE_SCAN_JSON_SCHEMA` (`constants/schemas.ts:9,26,95`) have no consumer. The three schema constants carry **fabricated trader facts** — `BTCUSDT`, entry `95000`, *"Pattern Memory shows 70% win rate in similar setups"*, trade id `TX-102` — and `constants/schemas.ts:4-6` claims *"These schemas are injected into system prompts"*, which is false. `constants/schemas.ts` is an orphan module with one test consumer. | 0.5 d | NOT IN THE REGISTER (closest: `E-10`) |
| **B-17** | **Collapse the three-way instruction triplication.** The same memory rule appears at `harnessContract.ts:17`, `memoryPrompts.ts:3` and `analysisPrompts.ts:84`; the output discipline at `harnessContract.ts:16`, `GenericAnalysisService.ts:349` and `analysisPrompts.ts:99`. The `output` layer is the **last** layer composed — and it is the weakest copy (it omits "no name prefix", which the contract has). ~600 chars. | 0.5 d | NOT IN THE REGISTER |
| **B-18** | **Record the decline's real source.** `DeskToolsService.ts:3049` hardcodes `source: 'desk'`; the type declares `'desk' \| 'automation'` (`declineLog.ts:27`) and `source: 'automation'` appears nowhere. The Automation surface *does* offer `decline_trade` — so every unattended decline is filed as a live desk decline. The ledger exists to answer *"did the harness skip a winner?"*; today it answers against a mis-attributed corpus. | 0.25 d | NOT IN THE REGISTER |
| **B-19** | **Delete or re-home `ARBITER_ALLOWED_TOOLS` and `toAnthropicTools`.** `DeskToolsService.ts:3145` and `:1726` — a 9-name seat policy for a moderator that no longer exists, and an Anthropic-schema converter whose only consumers are two test files (`messagesCall` sends no `tools` field at all). | 0.25 d | NOT IN THE REGISTER |
| **B-20** | **Delete the dead `analyzeTradingViewWithTransientRetry` wrapper** (`hooks/useAnalysisPipeline.ts:249-277`). Defined, never called — the ensemble/debate path that used it was deleted. Also make `runDeskToolLoop` module-private or give it its own `clearDeskToolCache()`; it is exported (`:3375`) and skips the invalidation the single production path performs. | 0.25 d | NOT IN THE REGISTER |
| **B-21** | **Drop the three retrieved-memory blocks that are assembled, paid for, and never sent.** `hooks/analysisPipeline/memoryContext.ts:151` (`rebuttalMemoryContext` — a full second notebook read per run), `:162` (`regimeWeightingContext`), `:171` (`lossPrimingRows` — re-reads and parses every post-mortem). Read by nothing but a shape-assertion test. | 0.5 d | NOT IN THE REGISTER |
| **B-22** | **Fix the type ramp in the UI doctrine.** `docs/ui-doctrine.md:64-65` says *"18/16/14/13/12/11/10/9px … `--ui-font-size` (14px)"*. `index.css:303` says `--ui-font-size: 16px`. **Every step of the documented ramp is 2 px wrong**, and five roles (`lede`, `price`, `display`, `hero`, `micro`) are missing. | 0.25 d | ALREADY COVERED — `O-87` |
| **B-23** | **Add the bundle ratchet to the release gate.** `guards.yml` holds the 1,400 kB ceiling, the probe parse check and the probe lint; a tag push runs none of them. See Report A §7.3. | 0.25 d | NOT IN THE REGISTER (closest: `O-107`, which covers different steps) |
| **B-24** | **Remove the dead `@fontsource/inter` dependency** and the `'Inter'` fallback family at `index.css:169`. `index.tsx:12-13` records the import removal (2026-09-16); the dependency and the fallback string both outlived it. | 0.25 d | NOT IN THE REGISTER |
| **B-25** | **Rename or re-document `get_btc_context`.** Its handler is `calculateCorrelationRisk` — correlation risk vs BTC for *any* symbol, not "BTC context" — and its description says *"Required before trading alts"*, hardcoding an instrument rule. `chatSurfaceTurn.ts:302` also falls back to `'BTCUSDT'` when no symbol is present, so a symbol-less Chat turn silently analyses BTC while the model is told to quote exact levels. | 0.5 d | NOT IN THE REGISTER |
| **B-26** | **Reconcile the two `getQuickResponse` functions.** `GenericAnalysisService.ts:555` (3rd param `Message[]`, 8,192 tokens, casual-chat system prompt) and `GenericProviderService.ts:2136` (3rd param `string \| any[]`, **2,048 tokens hard-coded**, no system prompt, no effort). Seven learning callers import the second — two of them **JSON-extraction** paths (`skillWorthGate`, `NotebookWriterService`) where a 2,048-token cap is a truncation risk. Same name, incompatible contracts. | 1 d | NOT IN THE REGISTER |
| **B-27** | **Give `analysis.risk_rules` a truthful `usage` chip.** `promptRegistry.ts:73` says `'All analysis modes'`; it is not sent in the compact mode. Fixed for free by `B-02`. | 0.25 d | PARTIAL — `B-02` |

---

## What I did **not** propose, and why

- **A light theme.** The `AGENTS.md` decision (2026-09-10) is explicit and the user reaffirmed it. `O-95` defers it.
- **A mobile layout.** `O-88` is real (100 of ~137 component files have no breakpoint class) but it is a *port* of the app, not an improvement to it, and the user has not asked for it. It stays on the register.
- **Per-agent win rates, settings value-search, updater rollback, multi-symbol sampling.** `O-95` — deferred by the owner.
- **Anything that adds a model call.** The tool-schema tax (9,284 tokens/request) makes every new tool-round proposal net-negative on cost until `B-03` lands. **This is the single most important sequencing constraint in the report.**
