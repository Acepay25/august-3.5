# August Trading — Cleanup Manifest

**Audit date:** 2026-10-21 · **Commit:** `b584d7ee1cbc2360bc1d90098c6a3191b221a1cf`
**Companion reports:** `2026-10-21-01-system-and-data-flow.md` (evidence), `-02-enhancements.md`, `-03-new-features.md`

**How the census was produced.** A reachability graph was built over **496 production source modules** from the real entry points (`index.tsx` + `App.tsx`), resolving relative imports, the `@/` alias, `new Worker(new URL(...))` and dynamic `import()`. Every orphan was then re-verified by a **direct importer grep** — because the graph is only a pointer, and it produced three false positives on the first pass (the `@/lib/utils` alias, the `scripts/` CLI entries, and the chart-action tools in a second definition array). **Every number below is measured at the audited commit.**

**The headline:** the register's orphan list (`O-129`) is **materially wrong at HEAD**. Seven of its thirteen named modules no longer exist, and six orphans it never listed are now dead. The real number is **12 orphans, of which 9 are genuinely dead** — 3,315 lines of production code.

---

## 1. Dead code

### 1.1 The orphan census, re-measured

| # | module | lines | non-test importers | covered by | verdict |
|---|---|---|---|---|---|
| 1 | `services/validation/TradeValidationGate.ts` | 857 | **none** | `tests/accuracyValidation.test.ts` | **DEAD** — `O-10` |
| 2 | `services/backtesting/BacktestingService.ts` | 1,414 | **none** | 3 test files | **DEAD** |
| 3 | `services/analysis/EntryTimingService.ts` | 509 | only `TradeValidationGate.ts` (itself dead) | `tests/planLevelLocation.test.ts` | **DEAD** (cluster of 1) |
| 4 | `services/learning/providerFitness.ts` | 176 | **none** | `tests/decisionBiasClosure.test.ts` | **DEAD** |
| 5 | `services/learning/MemoryConsolidationService.ts` | 114 | **none** | **none** | **DEAD + UNTESTED** 🆕 |
| 6 | `components/dashboards/learning/AvoidSetupsSection.tsx` | 29 | **none** | **none** | **DEAD + UNTESTED** 🆕 |
| 7 | `utils/messageDisplayText.ts` | 58 | **none** | **none** | **DEAD + UNTESTED** — the register's `Q7` |
| 8 | `constants/schemas.ts` | 103 | **none** | `tests/analysisUtils.test.ts` | **DEAD** 🆕 — see §3 |
| 9 | `components/analysis/ThinkingModal.tsx` | 55 | **none** | `tests/useFocusTrap.test.tsx` | **DEAD** — the register's `O-72` says it "belongs on the list" |
| 10 | `services/analysis/EntryTimingService.ts` → `services/validation/TradeValidationGate.ts` | — | — | — | (chain above) |
| 11 | `scripts/replay-plans.entry.ts` | — | CLI (`npm run replay:plans`) | — | **NOT DEAD** — a CLI entry point |
| 12 | `scripts/test-candle-history.ts` | — | CLI | — | **NOT DEAD** — a standalone script |
| 13 | `utils/planReplay.ts` | — | `scripts/replay-plans.entry.ts` | `tests/planE20Replay.test.ts` | **NOT DEAD** — CLI path |

**Nine dead modules, 3,315 lines.**

### 1.2 What the register got wrong

`docs/plan/open-items.md` row `O-129` records *"13 modules the app never loads"*, naming: `TradeValidationGate.ts`, `BacktestingService.ts`, `AnalysisProgress.tsx`, `EntryTimingService.ts`, `ProbabilityEngineService.ts`, `debatePods.ts`, `incrementalMarkdown.ts`, `seriesPalette.ts`, `preRead.ts`, `convictionDrift.ts`, `providerFitness.ts`, `ticketSize.ts`, `chartScanSkills.ts`.

**At `b584d7ee`, seven of those thirteen files no longer exist:**

| register entry | reality at HEAD |
|---|---|
| `AnalysisProgress.tsx` | **deleted** — the step-ladder component is gone |
| `ProbabilityEngineService.ts` | **deleted** |
| `incrementalMarkdown.ts` | **deleted** |
| `seriesPalette.ts` | **deleted** |
| `preRead.ts` | **deleted** |
| `convictionDrift.ts` | **deleted** |
| `debatePods.ts` | **deleted** (previously) |
| `ticketSize.ts` | **now reachable** — `services/trade/proposedTrade.ts:23`, `components/trade/panels/TradeProposalCard.tsx:19`, `hooks/useTradeLogging.ts:25` (`E-12` landed) |
| `chartScanSkills.ts` | **now reachable** — `constants/promptRegistry.ts:38`, `services/analysis/DeskToolsService.ts:2871` |

**And six orphans appeared that the register never listed:** `MemoryConsolidationService.ts`, `AvoidSetupsSection.tsx`, `constants/schemas.ts`, plus the dead exports in §1.3.

**Why this matters beyond bookkeeping:** the register's own rule is that a proposal cites the `file:line` that proves it is still open. `O-129`'s evidence no longer points at anything. A register whose rows cite deleted files is a register that will silently rot. **Every row should carry a re-measurable command, not a one-time observation.**

### 1.3 Dead exports inside *live* modules

Reachability analysis flags *modules*; it cannot see a dead function inside a live file. These four are found by reading:

| item | `file:line` | evidence | verdict |
|---|---|---|---|
| `ARBITER_ALLOWED_TOOLS` | `services/analysis/DeskToolsService.ts:3145-3161` | only `tests/evidencePack.test.ts:97-101` and `tests/tradeLogTool.test.ts:112` import it — a 9-name seat policy for a moderator that no longer exists | **DEAD** |
| `toAnthropicTools` | `services/analysis/DeskToolsService.ts:1726-1731` | only `tests/deskTools.test.ts:57` and `tests/getIndicatorsTool.test.ts:154`; `messagesCall` sends no `tools` field, so the converter has no consumer | **DEAD** |
| `analyzeTradingViewWithTransientRetry` | `hooks/useAnalysisPipeline.ts:249-277` | defined; **zero call sites** repo-wide — the ensemble/debate path it served was deleted | **DEAD** |
| `runDeskToolLoop` (export) | `services/analysis/DeskToolsService.ts:3375` | exported, but **skips `clearDeskToolCache()`** — the one production path clears it at `:4002`. A latent footgun: a future caller would silently widen the 30 s TTL across runs. | **LEAK** |

### 1.4 Dead *data* computed and discarded

| item | `file:line` | cost |
|---|---|---|
| `rebuttalMemoryContext` | `hooks/analysisPipeline/memoryContext.ts:151` | a **full second notebook read** per analysis run, up to 400 chars discarded |
| `regimeWeightingContext` | `hooks/analysisPipeline/memoryContext.ts:162` | computed, never sent |
| `lossPrimingRows` | `hooks/analysisPipeline/memoryContext.ts:171` | re-reads the closed-trade log and parses every post-mortem, never sent |
| `seatDirective` / `systemPromptOverride` | `services/providers/GenericAnalysisService.ts:252,261` | never assigned by any caller; the "INDEPENDENT SEAT DIRECTIVE" block is unreachable |
| `getGateAnalysis()` | `services/validation/GateKeeperService.ts:456` | never called; the gate constraints it produces are never sent to the model |

---

## 2. Duplicate data paths

| concept | homes | recommendation |
|---|---|---|
| learning rules | 3 — `learning_rules_v2_<user>`, notebook `rules/`, the live memory file | one owner; the other two become derived |
| chat sessions | 3 — `chat_sessions_v1`, `trade_chat_sessions_v1_<user>`, the conversation store | `O-100` says *"document the two chat stores, do not half-migrate them"* — and they are **still undocumented** |
| profile memory | 4 — `profile_memory_v1_<user>`, the notebook, the SQLite row, global memory | pick one; the other three read from it |
| calibration | 6 stores | one ledger; the rest are views |
| session identity | 4 mechanisms | one resolver (`utils/activeUser.ts` already looks like it) |
| `casual_chat_model` | written to **two** engines — `App.tsx:688`, `:689` | one write |
| the R:R formula | `utils/riskReward.ts` (canonical) vs `services/validation/TradeValidationGate.ts:183` (index-0) | the duplicate dies with the dead module |
| `getQuickResponse` | `GenericAnalysisService.ts:555` vs `GenericProviderService.ts:2136` — same name, different contracts | rename one; see `B-26` |

### 2.1 The two-list export defect

`ExportService.ts` keeps `RAW_LOCAL_STORAGE_PREFIXES` (`:298-407`) and `RESTORABLE_PREFERENCE_KEY_PREFIXES` (`:728-803`), and they disagree. Five namespaces are **exported and then refused on import**: `trade_tool_payloads`, `supervisor_triaged_v1`, `learning_distill`, `memory_hygiene`, `automation_plans`.

`ExportService.ts:759-763` shows the same bug already fixed once, for `supervisor_last_run_v1`, with the reason written down. **One test asserting the symmetric difference is empty closes the class.**

### 2.2 Five dead preference keys

Each appears **exactly once** in the whole source tree — its own declaration:

| key | `file:line` |
|---|---|
| `MEMORY_PROVIDER` | `services/infrastructure/PreferencesService.ts:24` |
| `HYBRID_PANEL_POSITION` | `services/infrastructure/PreferencesService.ts:28` |
| `QUIET_HOURS` | `services/infrastructure/PreferencesService.ts:37` |
| `INSIGHT_KNOWLEDGE_BASE` | `services/infrastructure/StorageService.ts:19` |
| `AUGUST_APP_SETTINGS` | `services/infrastructure/StorageService.ts:20` |

They are on the restore list, so an import **writes keys nothing will ever read**.

### 2.3 An unbounded key-per-item store

`supervisor_triaged_v1_<user>:<itemId>` writes **one localStorage key per triaged item**, with no eviction and no count cap. The WebView origin quota is shared, so this is the slow-motion version of the problem `utils/memoryBudget.ts` already solves for the notebook.

---

## 3. Dead prompts

The prompt registry is in **excellent** shape — 12 entries, every fallback **imported rather than restated** (`constants/promptRegistry.ts:10-20`), a test pinning the identity (`tests/planE08PromptRegistry.test.ts`), and the anchor gate reporting *"unreachable prompt entries (0/12, ceiling 0)"*. **`E-08` is landed.**

**The dead text is outside the registry:**

| item | `file:line` | note |
|---|---|---|
| `ENTRY_NOT_HIT_ANALYSIS_PROMPT` | `constants/prompts/learningPrompts.ts:7-14` | no consumer |
| `ENTRY_NOT_HIT_ANALYSIS_QUESTIONS` | `constants/prompts/learningPrompts.ts:17-…` | describes a mandatory questionnaire no caller runs |
| `EXTENDED_SL_ZONE_DEBATE_CONTEXT` | `constants/prompts/learningPrompts.ts:64-…` | still describes a **deleted debate engine** |
| `DUAL_SCENARIO_JSON_SCHEMA` | `constants/schemas.ts:9-17` | **fabricated trader facts**: `"trigger": "95500"`, *"Pattern Memory shows 70% win rate in similar setups"* |
| `MASTER_TRADE_PLAN_MARKDOWN` | `constants/schemas.ts:26-93` | `**Coin:** BTCUSDT`, `**Entry:** 95000`, `**SL Probability:** 25%` |
| `GATE_SCAN_JSON_SCHEMA` | `constants/schemas.ts:95-118` | `"similarTradeId": "TX-102"`, `"outcome": "LOSS"` |
| the `GATE SCAN` prompt prefix | `services/validation/GateKeeperService.ts:478-490` | unreachable — its only producer `getGateAnalysis()` is never called |

`constants/schemas.ts:4-6` claims *"These schemas are injected into system prompts"*. **That is false** — the only consumer of `MASTER_TRADE_PLAN_MARKDOWN` is `tests/analysisUtils.test.ts:270`. The whole module is an orphan (103 lines, one test consumer).

**Why deleting them matters more than 103 lines:** they are ready-made false facts about a specific trader's account, and `MASTER_TRADE_PLAN_MARKDOWN` is the only surviving description of the *"labeled markdown plan"* that the harness contract still references (`constants/prompts/harnessContract.ts:16`). **The contract points at a format nothing produces.**

### 3.1 Prompt text that contradicts itself

- **The desk mandate contradicts itself about candle rows** — `DeskToolsService.ts:1703` says a shape *"must come from `get_all_timeframes` … and you must say it came from the candles"*; `:1715`, the very next sentence, says *"eight printed rows are not a chart, and a shape described from them is invented, not read."* On any surface without `get_chart_view`, a shape is simultaneously required and forbidden.
- **The mandate names three turn types that no longer exist** — `:1711` offers *"opening analysis, rebuttal, clarification, or moderator verdict"*. `hooks/analysisPipeline/memoryContext.ts:138-140` states the moderator no longer exists; `utils/runContract.ts:5-10` records that the debate engine is deleted. `EFFORT_BY_TASK` still carries `rebuttal`, `moderatorVerdict` and `clarification` tiers (`services/providers/reasoningControls.ts:61-66`) with **no production caller**.
- **The harness contract is broadcast to four surfaces it does not describe** — `constants/prompts/harnessContract.ts:16-18` speaks of *"this coin"*, *"analysts"*, *"the moderator's last block"*. The Chat surface has no coin and no analysts; the scheduler has neither.
- **Three copies of one instruction** — the memory rule at `harnessContract.ts:17`, `memoryPrompts.ts:3` and `analysisPrompts.ts:84`; the output discipline at `harnessContract.ts:16`, `GenericAnalysisService.ts:349` and `analysisPrompts.ts:99`. The `output` layer is composed **last** and is the **weakest** copy (it omits "no name prefix", which the contract has).
- **A disclaimer contradiction** — the dock says *"Analysis, not financial advice"* (`services/trade/tradeChatContext.ts:207`); the analyst persona forbids exactly that phrase (`constants/prompts/analysisPrompts.ts:21-24`).

---

## 4. Test cleanup

### 4.1 Tests that exist only to cover dead code

| test file | lines | covers | action |
|---|---|---|---|
| `tests/accuracyValidation.test.ts` | 162 | `TradeValidationGate` only | **delete with the module** |
| `tests/backtestingOutcomes.test.ts` | 332 | `BacktestingService` only | **delete with the module** |
| `tests/validateTradeOutcome.test.ts` | 228 | `BacktestingService` only | **delete with the module** |
| `tests/backtestingKlineLadder.test.ts` | 107 | `BacktestingService` only | **delete with the module** |
| `tests/planLevelLocation.test.ts` | 138 | `EntryTimingService` only | **delete with the module** |
| `tests/decisionBiasClosure.test.ts` | 304 | `providerFitness` **+ live** cross-regime stamps and enforcement telemetry | **SPLIT, then delete the provider-fitness half** |

**967 lines** across 5 files are removable today with no behaviour change. The 6th needs a split: `tests/decisionBiasClosure.test.ts:73-80` imports `providerFitness`, but the same file also covers live cross-regime stamps and enforcement telemetry. **This is exactly the "keep-list" problem `E-50` names** — the register's proposal to remove "the tests that only cover code the app never loads" is right in principle, but the mixed file shows why it needs a per-file decision rather than a bulk delete.

### 4.2 Tests that must be **kept** despite touching an orphan

| test file | why it stays |
|---|---|
| `tests/useFocusTrap.test.tsx` (247) | covers `ThinkingModal` **and** 17 other dialogs — the focus-trap population gate |
| `tests/analysisUtils.test.ts` (694) | covers `constants/schemas.ts` **and** the whole analysis-utils surface |
| `tests/planE20Replay.test.ts` (84) | covers `planReplay`, which is **CLI-live** via `scripts/replay-plans.entry.ts` |
| `tests/modelMenu.test.tsx` (243) | `ModelMenu` is now **mounted** (`E-51` Phase 2) — it is no longer an orphan |

### 4.3 The suite's shape today

**495 files, 5,042 tests, 0 skipped, 229 s.** `AGENTS.md`'s census matches the tree exactly.

### 4.4 Test gaps worth naming

| gap | evidence |
|---|---|
| The **native** restore path with an image-bearing session is untested | `O-112` — the web round trip is tested; the native path, where every store defect in §2.1 lives, is not |
| The **drawn** Entry/Stop/Target line is un-asserted by any gate | `O-117` — the probe asserts no canvas overlay levels, so the one thing the trader drew can be wrong with nothing failing |
| The **provenance strip** is jsdom-only | `O-113` — it needs a real analysis run with a configured provider |
| The Agents-roster seeding had no test | `O-118` — *"that silence is evidence nothing was watching, not evidence the feature was inert"* |
| The queue strip's refusal line is unverified in the app | `O-111` — no probe presses **Apply** in the Learning queue |
| The **skill-eval allow-list** (new, `B-01`) | nothing asserts it — the automation deny-list *does* have such a test (`tests/automationToolTurn.test.ts:135-143`); the eval surface has no equivalent |

---

## 5. Dependencies, config and build

### 5.1 One dead dependency

**`@fontsource/inter`** — declared in `package.json`, imported **nowhere**. `index.tsx:12-13` records the removal: *"@fontsource/inter imports removed (2026-09-16): Inter sat only as a fallback family string behind Geist Variable."*

The fallback string outlived the import: `index.css:169` still reads `--font-sans: 'Geist Variable', 'Inter', system-ui, sans-serif;` — a family that can no longer resolve unless the user happens to have Inter installed.

**Every other dependency is genuinely used.** Verified: `katex` (via `rehype-katex` + `index.css`), `js-yaml` (config parsing), `rehype-katex`, `remark-gfm`, `@fontsource-variable/geist` / `dm-serif-text` / `jetbrains-mono` (imported in `index.tsx:15-19`), `@tailwindcss/typography` (`index.css:2`).

### 5.2 The lockfile is clean

`package-lock.json` is at **1.3.0**, matching `package.json`; `js-yaml` is at 4.3.1 and present; **every declared dependency resolves in the lock** (0 missing); `lockfileVersion: 3`. The plan's Phase 0.5 lockfile item is **done** — and `docs/plan/README.md`'s "1.0.30 → 1.3.0" description of that fix is **stale**.

### 5.3 The bundle ratchet does not gate a release

| workflow | triggers | bundle ceiling? |
|---|---|---|
| `ci.yml` | `push: main`, `pull_request` | ❌ |
| `guards.yml` | `push: main`, `pull_request` | ✅ **1,400 kB** — plus the probe `node --check` and the probe script lint |
| `release.yml` | `push: tags: v*`, `workflow_dispatch` | ❌ |

**A tag push runs neither `guards.yml` nor its three checks.** `release.yml` duplicates nine gates on purpose — its own header says *"release.yml can be dispatched manually (workflow_dispatch) without ever having passed CI, and publishing to every updater is irreversible"* — but the bundle ceiling is not among them.

Measured entry chunk: **1,368 KiB** against a 1,400 ceiling — **32 KiB (2.3 %) of headroom**, on a project whose own plan names eager imports as a recurring regression.

**Also:** the guard divides bytes by 1,024 and labels the result "kB". The true ceiling in vite's units is ~1,434 kB, so the gate does not measure what it says.

### 5.4 `AGENTS.md` never mentions `guards.yml`

`AGENTS.md` documents the ci-vs-release asymmetry in detail and prints the set-difference command — which compares only **two of three** workflows. The third exists, holds three gates, and gates no release. **This is a documentation gap and a release-path gap, and it is in neither register.**

### 5.5 A file in the tree that is neither source nor docs

`.workbuddy-ai/memory/2026-10-18.md` (1,629 bytes) sits in the working tree. It is **not** tracked by git and **not** in `.gitignore` — it is covered only by a broad ignore rule. Worth a named ignore entry so it cannot be committed by accident.

---

## 6. The batches

Ordered so that each batch is independently shippable and the riskiest behavioural change is isolated.

### BATCH 0 — PROTECT THE ARCHIVE (not a code change)
**What:** `archive/prior-audit-2026-10-18` holds one commit, `508b691a` *"untracked files on cline checkpoint"*, containing **1,135 binary `.bin` blobs (≈ 5.4 MB)**, 29 `.py` scripts, 5 `.cjs`, and a 62 KB `.pyc` — alongside the **8 `.md` reports** the branch exists to protect.

**The problem:** 5.4 MB of binary blobs are preserved so that ~30 KB of markdown cannot be pruned. The Python analysis toolkit is preserved along with them.

**Do:** extract the 8 `.md` files into `docs/archive/2026-10-18/` on `main`; then the branch can go, and 5.4 MB of blobs with it.

**Also:** `origin/test/provider-degrade-ladder` holds 1 unmerged commit (`49119b3a`, adding `tests/providerDegradeLadder.test.ts`). The file **exists on main** in a newer form, so the commit is superseded — but decide deliberately rather than leaving it dangling. `feat/stage19-tail`, `origin/refactor/calibration-split` and `origin/stage3-ui-arrangement` are **fully merged** (0 unmerged commits) and can be deleted.

### BATCH 1 — ONE-LINE FIXES (zero behavioural risk, ~1 day)
| # | action | where |
|---|---|---|
| 1 | Add the five missing namespaces to the restore allow-list | `services/infrastructure/ExportService.ts:728-803` |
| 2 | Add a test asserting the two allow-lists' symmetric difference is empty | new |
| 3 | Delete the five dead preference keys | `PreferencesService.ts:24,28,37`; `StorageService.ts:19,20` |
| 4 | Remove `'Inter'` from the `--font-sans` fallback and drop `@fontsource/inter` | `index.css:169`; `package.json` |
| 5 | Delete `ARBITER_ALLOWED_TOOLS` and `toAnthropicTools` + their 2 test-only importers | `DeskToolsService.ts:3145,1726` |
| 6 | Delete `analyzeTradingViewWithTransientRetry` | `hooks/useAnalysisPipeline.ts:249-277` |
| 7 | Delete the three dead memory blocks and the three dead `memoryContext` fields | `hooks/analysisPipeline/memoryContext.ts:151,162,171,197,200,201` |
| 8 | Tighten the lint cap to 657 | `package.json` (`--max-warnings 659` → `657`) |
| 9 | Add the bundle ratchet + probe checks to `release.yml`; name `guards.yml` in `AGENTS.md` | `.github/workflows/release.yml`; `AGENTS.md` |
| 10 | Fix the UI-doctrine type ramp (16 px base, five missing roles) | `docs/ui-doctrine.md:64-65` |
| 11 | Add `.workbuddy-ai/` to `.gitignore` | `.gitignore` |

**11 changes, all text or a one-line constant, and three of them close real defects.**

### BATCH 2 — DEAD PROMPTS AND SCHEMAS (~0.5 day)
Delete the three dead `learningPrompts.ts` blocks and all three `constants/schemas.ts` constants; correct the false claim at `constants/schemas.ts:4-6`; delete `constants/schemas.ts` and its test-only importer's two references.

**Do this before any future prompt author copies from them** — they carry fabricated trader facts (`BTCUSDT`, `95000`, *"70% win rate in similar setups"*, `TX-102`).

### BATCH 3 — DEAD MODULES (~2 days, and one decision)
**B3a — delete outright (safe):** `services/learning/MemoryConsolidationService.ts` (114), `components/dashboards/learning/AvoidSetupsSection.tsx` (29), `utils/messageDisplayText.ts` (58), `components/analysis/ThinkingModal.tsx` (55).

**B3b — delete with their tests:** `services/backtesting/BacktestingService.ts` (1,414) + 3 test files (667 lines); `services/analysis/EntryTimingService.ts` (509) + `tests/planLevelLocation.test.ts` (138); `services/learning/providerFitness.ts` (176) + the provider-fitness half of `tests/decisionBiasClosure.test.ts`.

**B3c — DECISION REQUIRED:** `services/validation/TradeValidationGate.ts` (857) + `tests/accuracyValidation.test.ts` (162). **Retire it or wire it** — see `B-04` in Report B. *Recommendation: retire.*

**B3d:** make `runDeskToolLoop` module-private, or give it its own `clearDeskToolCache()`.

### BATCH 4 — DEAD DATA PATHS (~1 day)
One owner for the learning rules; one for the chat sessions (and **document** them, per `O-100`); one for profile memory; one calibration ledger; one session-identity resolver; one write for `casual_chat_model`; one `getQuickResponse`.

**This is the behavioural batch.** Do it one concept at a time, each behind its own test, and re-run the full suite between.

### BATCH 5 — THE DEAD STORES (~1 day)
The five dead preference keys are in Batch 1. The remaining store work: `supervisor_triaged_v1`'s per-item keys get a count cap; `learning_distill` / `memory_hygiene` / `automation_plans` get explicit export + restore registration; `trade_tool_payloads` gets a restore entry.

### BATCH 6 — DEPENDENCIES, CONFIG AND BUILD (~0.5 day)
`@fontsource/inter` out; the lockfile verified clean; the bundle ratchet added to the release path; the `guards.yml` unit label corrected from "kB" to "KiB" (or the arithmetic changed to /1000 to match the label).

### BATCH 7 — DOCS (~2 days)
See §7 and §8.

---

## 7. The proposed target docs structure

**The principle:** one index, one living architecture doc, one decision log, one archive. Today the repo has **1,395,725 bytes (≈ 1.4 MB) of markdown under `docs/plan/`**, of which `docs/plan/full-audit.md` (643,119 bytes) is a *concatenation* of the six files in `docs/plan/audit/` (573,585 bytes) — **the same content stored twice.**

```
docs/
├── README.md                    ← the index: what this app is, what is true today, where to look
├── architecture.md              ← LIVING: the system + data flow (this audit's Report A, kept current)
├── decisions.md                 ← LIVING: the decision log — every owner ruling, with the date and the id
├── plan/                        ← the working plan: README, open-items, implementation-record
├── reference/                   ← stable reference: ui-doctrine, learning-loop-map
├── flow/                        ← app-flow.md + app-flow.html (machine-checked)
└── archive/
    ├── 2026-10-18/              ← the 8 reports from the archive branch, extracted
    └── 2026-10-19-audit/        ← the 6 prior audit files, as a frozen record
```

**Migration order:**
1. Extract the 8 `.md` files from `archive/prior-audit-2026-10-18` into `docs/archive/2026-10-18/`; then delete the branch (Batch 0). **5.4 MB freed.**
2. Move `docs/plan/audit/2026-10-19-*` → `docs/archive/2026-10-19-audit/` and add a one-line banner: *"A frozen record of the 2026-10-19 audit. Superseded by `docs/analysis/2026-10-21-*`."*
3. **Delete `docs/plan/full-audit.md`** — 643 KB of duplicate content. Keep the index (`docs/plan/audit/2026-10-19-00-index-and-method.md`) as the reader's way in.
4. Move `docs/plan/README.md`, `open-items.md`, `implementation-record.md`, `model-menu-redesign.md` → `docs/plan/` (already there) and add `docs/plan/README.md` → `docs/README.md` as the index.
5. `docs/plans/` (plural) → `docs/archive/`. `docs/plans/debate-deletion-status.md` is a **dated history ledger** — the anchor gate scans it and it names deleted files *on purpose*. **Do not "fix" it.** Move it; do not edit it.
6. `docs/plans/reference/*.png` (7 screenshots) → `docs/reference/screenshots/`, re-captured against the current build.
7. Fold this audit's four reports into `docs/architecture.md` (Report A) and `docs/plan/` (Reports B–D), or keep them in `docs/analysis/` as the dated generation and link them from the index. **Decide once, in writing, which `docs/analysis/` is — because `AGENTS.md` calls it untracked scratch and `.gitignore` does not ignore it.**

**One thing to fix in the same pass:** `scripts/check-flow-doc-anchors.cjs:45` scans exactly four documents —

```js
const DOCS = ['AGENTS.md', 'docs/app-flow.md', 'docs/app-flow.html', 'docs/plans/debate-deletion-status.md'];
```

**`docs/learning-loop-map.md` and `docs/ui-doctrine.md` are not scanned**, and `learning-loop-map.md` cites **four files that no longer exist** (§8). Either add them to the scan list or accept that two living docs are unverified — and say which, in writing.

---

## 8. Docs audit

Every tracked doc, re-checked against `b584d7ee`.

| # | file | bytes | purpose | accuracy at HEAD | verdict |
|---|---|---|---|---|---|
| 1 | `AGENTS.md` | 27,444 | the agent contract | **accurate** — the vitest census ("5042 tests in 495 files"), the test-file count, the smoke-test count and the step names all match the tree; the anchor gate reports *"0 AGENTS.md claim(s) disagree with the tree"*. **Omits `guards.yml` and the three gates it holds.** | **UPDATE** — add the third workflow; the rest is the model of how to do it |
| 2 | `README.md` | 5,335 | what the app is | product claims not re-verified line by line in this pass | **KEEP**, re-read at the next doc pass |
| 3 | `PRIVACY.md` | 5,309 | what leaves the machine | the app has **no telemetry sink**; outbound = providers, market data, update feed. The doc should say so plainly | **UPDATE** — state that no analytics or crash-reporting service exists |
| 4 | `THIRD_PARTY_NOTICES.md` | 4,294 | licences | not audited in this pass | **KEEP** |
| 5 | `changelog.md` | 132,766 | history | not audited line by line | **KEEP** — 133 KB for a 1,070-commit repo is a fair trade |
| 6 | `docs/app-flow.md` | 56,972 | the complete flow | **machine-checked** — 304 anchors, 0 unattributed | **KEEP** |
| 7 | `docs/app-flow.html` | 27,444 | the HTML mirror | **machine-checked** — the census rule confirms the mirror is visible to it | **KEEP** |
| 8 | `docs/learning-loop-map.md` | 16,220 | how learning flows | **STALE** — header says *"Anchors verified against the working tree on 2026-09-20"*; cites `services/learning/lensMemory.ts`, `services/ui/AnalystLensService.ts`, `ensembleService.ts` and `utils/harnessLessons.ts`, **all four deleted**; still uses deleted debate/ensemble vocabulary; **not in the anchor gate's scan list** | **UPDATE** — or fold into `architecture.md` |
| 9 | `docs/ui-doctrine.md` | 7,901 | the visual rules | **WRONG** — `:64-65` claims the ramp is *"18/16/14/13/12/11/10/9px … `--ui-font-size` (14px)"*; `index.css:303` says **16px**. Every step is 2 px off, and five roles (`lede`, `price`, `display`, `hero`, `micro`) are missing | **UPDATE** (`O-87`) |
| 10 | `docs/plans/debate-deletion-status.md` | 183,162 | a dated history ledger | names deleted files **on purpose**; scanned by the anchor gate | **MOVE** to `docs/archive/` — do not edit |
| 11 | `docs/plans/reference/*.png` (7) | — | before/after screenshots | dated 2026-10-18; the app has changed since | **RE-CAPTURE** or mark as historical |
| 12 | `docs/plan/README.md` | 18,654 | the plan index | **mostly accurate**; its *"set `--max-warnings 674"* is **stale** (the cap is 659) and its lockfile description (*"1.0.30 → 1.3.0"*) is **stale** (the lock is already at 1.3.0 and clean) | **UPDATE** |
| 13 | `docs/plan/open-items.md` | 68,124 | the open-items register | **partially stale** — `O-129`'s list is materially wrong (§1.2); `O-11`/`O-12`/`O-13` are closed but still marked OPEN; `O-17`'s corpus figure (1,245 lines) no longer matches (21,092 chars today) | **UPDATE** — re-measure the rows this audit touched |
| 14 | `docs/plan/implementation-record.md` | 58,014 | what landed, and how it was verified | accurate and exemplary; its own §9 warns that a register entry can be a claim about a tree that has moved — **this audit is the proof** | **KEEP** |
| 15 | `docs/plan/model-menu-redesign.md` | 34,229 | the E-51 design | accurate; Phases 1–2 landed in the two commits at the top of this audit | **KEEP** |
| 16 | `docs/plan/full-audit.md` | 643,119 | "a single reading copy" | **643 KB duplicating the 573 KB in `docs/plan/audit/`** | **DELETE** — keep the index |
| 17 | `docs/plan/audit/2026-10-19-00-index-and-method.md` | 27,844 | the prior method | a frozen record | **ARCHIVE** |
| 18 | `docs/plan/audit/2026-10-19-01-system-and-data-flow.md` | 185,624 | the prior system map | superseded by this audit's Report A | **ARCHIVE** |
| 19 | `docs/plan/audit/2026-10-19-02-enhancements.md` | 125,196 | the prior 51 enhancements | **partly superseded** — `E-01`…`E-24`, `E-35`, `E-37`…`E-44`, `E-48b`, `E-49`, `E-50` landed; `E-30`/`E-59`'s headline number is **understated** | **ARCHIVE** + cross-link to Report B |
| 20 | `docs/plan/audit/2026-10-19-03-new-features.md` | 35,482 | the prior 22 features | mostly still valid; `N-12` duplicates `N-03`; `N-08` is now partly built | **ARCHIVE** + cross-link to Report C |
| 21 | `docs/plan/audit/2026-10-19-04-cleanup-manifest.md` | 150,452 | the prior manifest | **materially stale** — its orphan list and several file lists no longer hold (§1.2) | **ARCHIVE** + cross-link to Report D |
| 22 | `docs/plan/audit/2026-10-19-05-ordering-and-open-questions.md` | 48,987 | the prior order and open questions | superseded by this audit's ordering | **ARCHIVE** |

**Totals:** 22 documents, **1,395,725 bytes** under `docs/plan/` alone, of which **643,119 bytes are pure duplication**. The target structure in §7 removes the duplicate and gives every doc a verdict.

---

## 9. Git history, branches and secrets

| item | state |
|---|---|
| commits | 1,070 |
| tags | 36 |
| stashes | 0 |
| branches | `main`, `feat/stage19-tail` (fully merged), `archive/prior-audit-2026-10-18` (1 orphan commit, 5.4 MB) |
| remotes | `origin/main`, `origin/refactor/calibration-split` (merged), `origin/stage3-ui-arrangement` (merged), `origin/test/provider-degrade-ladder` (1 superseded commit) |
| credentials in tracked files | **none found** — no `.env`, no key literals, no tokens |
| credentials in history | **not exhaustively verified** by this audit (the prior audit's sweep was read-only and partial); a targeted history grep for key-shaped literals is worth a dedicated pass |
| line endings | `.gitattributes` pins `* text=auto eol=lf` — **the repo is LF-only**, so a CRLF-flavoured edit will produce a whole-file diff. Preserve LF when editing. |
| working tree | **clean** at `b584d7ee`; the 9 files that were dirty at the start of this audit were committed as E-51 Phase 2 |

---

## 10. Coverage statement

**What was measured at `b584d7ee`:** `typecheck` ✅ · `typecheck:scripts` ✅ · `typecheck:electron` ✅ · `lint` ✅ (657/659) · `test` ✅ (495 files, 5,042 tests, 0 skipped) · `check-flow-doc-anchors` ✅ (304/0) · `build` ✅ (entry 1,368 KiB) · the reachability graph ✅ · the dependency sweep ✅ · the store inventory ✅ · the prompt and tool inventories ✅ · the security posture ✅ (read-by-code).

**What was NOT verified:** `render-probe`, `boot-probe`, `skill-approval-probe` and `installer-smoke` were **not run** — they need a browser, a packaged binary, or an idle machine, and the suite was running. **The rendered-row counts, the inert-control sweep and the keyboard-focus indicator are therefore unverified by this audit.** The native restore path, the live-journal row count and the end-to-end provider behaviour are likewise unverified. Every security claim is read-by-code, not attacked.

**What I did not do:** no source, doc, config, test or data file in `C:\Dev\august-3.5` was modified. The only files created are these four reports under `docs/analysis/`. The gates ran in a throwaway git worktree at `C:\Dev\august-audit-wt` with a throwaway `APPDATA`.

---

*Next: the ordering, the open questions, and the coverage statement are in the chat summary that accompanies this report.*
