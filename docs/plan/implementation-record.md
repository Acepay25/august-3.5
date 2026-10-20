# Implementation record — the 2026-10-20 fix pass

**What this file is.** The register (`open-items.md`) says what is *open*. This file says
what *landed*, where it landed, and how it was verified. It is not a second register: an
item appears here only when there is a `file:line` to point at and a gate that was run.

**The rule it follows.** Every claim here was re-measured against the tree, not copied
from a commit message. Where a figure moved while the pass was running, the figure and
the tip it was taken at are both given, because a number without its tip is how a
document starts lying.

**Scope.** This is the *roadmap thread's* record, not a complete account of the pass —
six other threads were landing code in the same tree at the same time. Anything this file
does not mention is not claimed to be done.

---

## 1. The plan's items that landed in this pass

| item | what landed | where | how it was verified |
|---|---|---|---|
| **E-11** | **The prompt contract test.** A new suite that asserts what is **sent** on the four model-call paths, not what is built. | `tests/promptContract.test.ts` (new) | `npx vitest run tests/promptContract.test.ts` → **16 tests, 16 pass** (2026-10-20). |
| **E-60** | **The "one place to look" rule**, in one line, in `AGENTS.md`. | `AGENTS.md` § *The Plan* | Read back; the line names the working list, the evidence file, and the id a proposal must cite. |
| **E-01a** (prompts thread) | **The harness contract reaches every live surface exactly once.** It is injected at the transport — `withDeskToolsSystemPrompt` (`services/analysis/DeskToolsService.ts:3759`, called from `:3804`) — not at each surface's composer. | `services/analysis/DeskToolsService.ts` | **Verified by outcome, not by diff:** `tests/promptContract.test.ts` asserts `HARNESS CONTRACT` appears exactly once in the sent system prompt on all four paths, and that the evaluation path — which composes the contract itself — does not get a second one at the transport. |
| **E-09** (prompts thread) | **`analysis.lens` is gone from the registry.** The editor entry the trader could edit but the model never saw is deleted; the registry now holds **12** ids. | `constants/promptRegistry.ts:54-162` | **Verified by reading the file** (no `analysis.lens` entry) **and by the new gate**: `tests/promptContract.test.ts` now asserts that the three registry ids the registry itself says reach `analyzeTradingView` — `analysis.master`, `analysis.risk_rules`, `analysis.memory_enforcement` — actually appear **in the sent system prompt**. That is E-09's own verification, done the way the plan asked for it: not "a `getPrompt()` call site exists" but "the prompt reaches a sent request". |
| **3.6 (docs restructure)** | **The plan corpus landed in `docs/plan/`** — `README.md`, `open-items.md`, `full-audit.md` and `audit/` (seven sources). `docs/plans/` now holds **one** file: `debate-deletion-status.md`, the dated history ledger the anchor gate scans. | `docs/plan/`; `docs/plans/debate-deletion-status.md` | **Verified by listing the tree** at `40443692`: `docs/plans/` = 1 file, `docs/plan/` = 4 entries + 7 audit sources. |
| **Q14 (answered and executed)** | **18 plan documents deleted, not archived.** | `docs/plans/` | **Verified by listing `docs/plans/`**: only the dated ledger survives, as the anchor gate's scan list (`scripts/check-flow-doc-anchors.cjs:44`) requires. |
| **Q10 (answered)** | **`docs/analysis/` is scratch, and the previous audit cannot be pruned.** The directory is untracked on purpose; the six previous reports are preserved on a branch. | commit `56639b4b`; branch `archive/prior-audit-2026-10-18` | **Verified**: the branch resolves (`508b691a`) and carries **1 182** `docs/analysis/` entries — the six `.md` reports **including `06-independent-review-2026-10-18.md`**, plus the `data/` folder. Nothing in the other three checkpoint commits is missing from it, so `git gc --prune=now` can no longer destroy the only written record of the live-data findings. |

### The analyst-role system (the 2026-10-19/20 wave)

Not a plan item, but the largest change in the tree, and the reason several plan items
changed shape. Recorded here so the next reader does not re-derive it.

| commit | what |
|---|---|
| `6e1e09bb` | **the analyst-role system deleted**, and stored profiles migrated. |
| `69c4aa33` | the last role/lens vocabulary residue removed. |
| `2157999f` / `658ae762` | the moderator is a **seat pick**, not a debate role; the global Moderator model picker is gone. |
| `40443692` | the orphaned progress tracker deleted. |

---

## 2. Measured figures

Every number here was taken with the command named, on the tip named.

| figure | value | how it was measured | tip |
|---|---|---|---|
| **`App.tsx` unused declarations** | **11 locals + 6 imports = 17** | `npx eslint App.tsx -f json` → 17 `@typescript-eslint/no-unused-vars` messages | 2026-10-20, working tree |
| the six unused **imports** | `Conversation`, `AIProvider`, `ChevronDownIcon`, `CloseIcon`, `ModelPicker`, `NavRail` | same | same |
| the eleven unused **locals** | `providerCooldownRemainingMs`, `updateActiveConversation`, `newlyAddedInsightIds`, `leverageInput`, `isNavOverlay`, `closeNavOverlay`, `input`, `images`, `setLoadingMessage`, `openBotInTrade`, `openGroupInTrade` | same | same |
| **the cost model's `netR` is no longer gross** | `meta.netR` is now net of the fee tier | `tests/skillStatisticsGate.test.ts:202,214` still assert the **pre-fee** figures (`-0.8`, `3`) and now read `-0.82` / `2.98` | 2026-10-20 |
| **vitest census** | see `AGENTS.md`'s tree map | vitest's own summary block | see `AGENTS.md` |
| the previous audit's preservation | **1 182** `docs/analysis/` entries on `archive/prior-audit-2026-10-18` | `git ls-tree -r --name-only archive/prior-audit-2026-10-18 -- docs/analysis` | 2026-10-20 |

**A note on the `App.tsx` figure, because the plan quotes several.** The "28 unused LOCAL
declarations" number is **not in `AGENTS.md`** at this tip — the `AGENTS.md` rewrite
removed it. The number was re-measured rather than patched, because a figure that lives
in three places and is measured in a fourth is a figure that will be wrong in one of them.
**17 is the count of eslint messages; 11 is the count of unused local declarations; 6 is
the count of unused imports.** The `cleanup` thread's 13 was measured at an earlier tip.

**A note on the `netR` figure, because it is the cost model showing up in a test.**
Q3 was answered — 5 bps taker / 2 bps maker — and the cost model landed with it, so
`meta.netR` is now **net**. `tests/skillStatisticsGate.test.ts:202,214` still assert the
**gross** figures the app used to produce (`-0.8` and `3`), and now read `-0.82` and
`2.98`: the 0.02 is the fee. **Those assertions are the cost model's first red test, and
they belong to the thread that landed it — this record does not change them.** They are
the honest proof that Q3 was acted on rather than merely recorded.

---

## 3. What the prompt contract test asserts, and why it is not a copy

The test is the plan's E-11, and its whole value is that it can **fail on the code**. Three
design decisions make that true:

1. **It captures at the transport boundary, and applies the REAL enrichment.**
   `streamChatWithDeskTools` adds the harness contract and the DESK TOOLS block *inside*
   itself (`:3804`). A test that mocked that function would assert a prompt the app never
   sends. So the test captures the message array the turn hands the transport, then applies
   the real `withDeskToolsSystemPrompt` to it — and **source-pins** that the transport
   really does call it, so the file cannot pass on a transport that stopped enriching.
2. **The dock's composer is a `useCallback` inside a component**, so it cannot be called
   from a unit test. The test asserts the contract over the two **exported** blocks the
   panel concatenates (`TRADE_CHAT_SYSTEM_PROMPT`, `buildSkillsIndexForPrompt`) and
   source-pins the concatenation. A copy of the composition inside the test would be the
   second implementation this repo keeps paying for.
3. **The debate-vocabulary check is an exact equation, not a ban.** Two shared blocks still
   carry a residue of the debate deletion — the harness contract's *"The moderator's last
   block…"* and the DESK TOOLS catalogue's *"…or moderator verdict"*. A blanket ban would
   have failed on the shared blocks and taught the next reader nothing. The test instead
   measures what the shared blocks contribute (from the real function) and requires the
   surface's own text to add **nothing**: the wire prompt's count must equal the surface's
   own count plus the shared blocks' contribution. A surface that reintroduces the word
   breaks the balance.

**It is not vacuous.** It went red seven times while it was being written — every one of
them a real mismatch between the assertion and the code — and it is green now against the
tree as it stands. The plan's own verification for E-11 is *"remove a block from one
surface's prompt and watch exactly one test go red"*; the seven reds are that evidence,
and the assertions are exact counts, so a removed block cannot pass.

### What it covers, per path

| path | the real function it drives | what it proves |
|---|---|---|
| **P1 chat** | `runChatSurfaceTurn` (`services/trade/chatSurfaceTurn.ts`) | the contract once, the DESK TOOLS block once, the mandate present, only offered tools named, the allow-list is exactly `CHAT_SURFACE_TOOLS`, a skill NAMED once |
| **P2 dock** | the exported `TRADE_CHAT_SYSTEM_PROMPT` + `buildSkillsIndexForPrompt` (`services/trade/tradeChatContext.ts`), source-pinned to the panel's composer | the same, plus the mailbox tools are never named |
| **P3 automation** | `runAutomationTurn` (`services/trade/automationTurn.ts`) | the same, plus the allow-list is exactly the Chat surface's minus the denied eight, and no notebook-writing tool is named |
| **P4 evaluation** | `analyzeTradingView` (`services/providers/GenericAnalysisService.ts`) — the skill-evaluation path, called from `services/learning/SkillEvalScheduler.ts:284` | the contract is composed once and not doubled, the retrieved context rides in the **user** turn and not the system prompt, and the registry prompts that claim the path really reach the wire |

---

## 4. Decisions taken differently from the plan's default

**The plan is a proposal; this section is where it and the code part company.** Each of
these is a place where the plan said one thing and the implementation had to do another,
with the reason.

| the plan says | what was done | why |
|---|---|---|
| E-11: *"for each of the four model-call paths (P1 chat, P2 dock, P3 automation, **P4 bot**)"* | **P4 is the evaluation path** — `analyzeTradingView` (`services/providers/GenericAnalysisService.ts`), which the plan's own tool table (`audit/2026-10-19-01-system-and-data-flow.md:904`) calls *"P5 evaluation"*, and which is what the skill-evaluation scheduler actually calls (`services/learning/SkillEvalScheduler.ts:284`). | The plan's prose and the plan's own table disagree about the fourth path, and the table's version is the one a unit test can drive end to end. The bot path is a `streamQuickResponse` turn and carries no separate system prompt to audit. |
| E-11: *"build the **real** system prompt through the real function"* | **The dock's composer is a `useCallback` inside a component** (`components/trade/TradeChatPanel.tsx:453`), so the test asserts the contract over the two **exported** blocks the panel concatenates and **source-pins the concatenation**. | A copy of the composition inside the test would be the second implementation this repo keeps paying for — and the source pin is what stops the test from passing on a panel that stopped using those blocks. |
| E-11: *"assert … the tool list matches the surface's allow-list"* | **The check is made on the surface's OWN text, never on the enriched prompt**, and the shared DESK TOOLS catalogue — which names every tool the executor has — is measured separately. | Reading the catalogue as the surface's vocabulary would make the check vacuous: every surface would "name" every tool. The measured split is what lets the check mean something. |
| E-11: *"no `debate`/`moderator` vocabulary may appear on a live surface"* | **An exact equation, not a ban.** Two shared blocks still carry the residue of the debate deletion — the harness contract's *"The moderator's last block…"* and the DESK TOOLS catalogue's *"…or moderator verdict"*. The wire prompt's count must equal the surface's own count plus the shared blocks' measured contribution. | A blanket ban fails on the shared blocks and teaches the next reader nothing. The equation fails when a **surface** reintroduces the word, and it fails when a shared block's copy disappears — so the residue cannot hide a new one. |
| E-11: *"four tests, one per surface"* | **Sixteen tests across the four paths**, because each path is checked on four axes (present / absent / tools / skills) and the axes are the contract. | One test per surface would have to assert all four axes in one breath, and the first failure would hide the other three. |
| §3E's **E-49** — rank and filter the 30-slot skill index by trigger, status, audience and evidence | **NOT implemented here.** The contract test pins the index's **section vocabulary** and the "named once" property, and deliberately does **not** pin its order. | E-49 is not in this thread's items. The test was written so that E-49's re-ranking will not break it — the index is still "one line per skill, in the recognised heading", and which skills occupy the slots is E-49's business. **Worth knowing before E-49 lands:** `SkillIndexAudience = 'analyst' \| 'moderator'` still exists at `services/trade/tradeChatContext.ts:214` while `buildSkillsIndexForPrompt` takes no `audience` argument, and `MemoryRetrievalService` filters by audience for *retrieval* but the *index* does not. That is exactly the gap E-49 names. |
| §3E's **E-48b** — the three-verdict review job for malformed skills | **NOT implemented here.** | Not in this thread's items. The contract test does not touch it. |

---

## 5. What this record does NOT close

- **No owner question is closed by this file.** Three are answered (Q3, Q10, Q14) and the
  rest stand.
- **The registry-to-wire check covers one path.** `analysis.compact`, `strategy.summarize_pdf`,
  `notebook.note`, `notebook.chat_note`, `strategy.ocr_page`, `learning.skill_craft`,
  `learning.skill_refine`, `learning.skill_worth` and `learning.chart_scan` are sent by
  six other services, none of which a unit test drives end to end here. **The gate is
  real for the path it covers and silent for the rest** — the same shape of blind spot the
  plan keeps naming, and the same shape the anchor gate has.
- **The F-01 shape is asserted for the surfaces, not for the pipeline.** The pipeline's
  `enhancedPrompt` is assembled in `hooks/useAnalysisPipeline.ts:1088-1131` and is the
  subject of E-01; the contract test asserts that the four surfaces do not carry a
  retrieved blob, and that the evaluation path's retrieval rides in the user turn. **It
  does not assert what the pipeline sends** — that path was not driven here.
- **The measured figures move.** Six other threads were landing code in the same tree.
  Every number in §2 carries its tip for that reason.

---

## 6. How to keep this honest

- A new implementation record line needs a `file:line` **and** a gate that was run.
- A figure that moved must be re-measured, not patched — and the old tip is worth keeping
  next to the new one.
- An item that landed *differently* from the plan's default says so here, with the reason.
  **The plan is a proposal; this file is the record of what the trader actually accepted.**

---

## 7. The Phase 3 / Phase 4 pass (2026-10-20)

This is a second pass over the plan, after the one recorded in §1. It closed the
remaining Phase 1 items, all of Phase 3, and the Phase 4 items that do not wait
on real data. **One item is deliberately not built: the candidate log** — D-24
approves its shape but gates its implementation waves on the shadow month that
E-18 now makes possible. The decline half of E-42 is built; the log half is not.

| item | what landed | where | how it was verified |
|---|---|---|---|
| **E-37** | Evidence floors raised: cluster 3→10, confirmed 5→20, veto 2→10. `MIN_SAMPLE_RETIRE` deliberately unchanged. | `services/learning/SkillMemoryService.ts` (constants) | Existing suites updated on purpose (fixtures raised to the new floors); **4918/4918** vitest tests green. |
| **E-38** | A presented plan now carries a validity window from the app's own detector (scalp 20 min, swing 330 min), so `ENTRY_NOT_HIT` is writable at expiry. It also records the stop-distance percentage the detector reads. | `services/trade/proposedTrade.ts` (`buildTradePlan`, `applyTradeTypeToAnalysis`) | `tests/proposedTrade.test.ts` asserts both classes and windows. |
| **E-40** | `decidedAt` beside the write `timestamp`; `decidedAtOf()` is the one fallback for legacy rows. Dashboards, learning sections and the recent-form brief order by decision time; the brief shows it. | `types/trade.ts`, `hooks/useTradeLogging.ts`, `utils/journalAnalytics.ts`, `utils/recentTradesBrief.ts`, the dashboard/learning sections | `tests/recentTradesBrief.test.ts` (decided Monday / logged Friday) + typecheck. |
| **E-39** | `tradingDecision: high` for the two plan-capable chat homes and `automatedTradingDecision: max` for schedules; a composer pick still wins. `effectiveTemperature()` is the published format × thinking table, tested. | `services/providers/reasoningControls.ts`, `chatSurfaceTurn.ts`, `chatTurnRunner.ts`, `automationTurn.ts`, `shared/providerRequestPolicy.cjs` | `tests/reasoningControls.test.ts`, `tests/providerRequestPolicy.test.ts`, `tests/chatEffortDial.test.tsx`. |
| **E-26b / E-14** | The Q4 default: `approval_rules_v1` and the five restore-only namespaces are on the RAW list; `trade_chat_active_v1` and `trade_declines_v1` too. A raw-string envelope carries plain values (usernames, session ids, flags) without quoting them. | `services/infrastructure/ExportService.ts` | Export suites incl. a native-shaped round trip of a plain username and a session id. |
| **E-06** | Bundle ceiling 2,600 → **1,400 kB**, plus a stale-ceiling floor at 90 % so the ratchet must be lowered when the build shrinks. Measured entry: **1,389.30 kB**. | `.github/workflows/guards.yml` | Build + the ratchet shell logic run locally (`RATCHET_OK`). |
| **W3.1** | The roster-deletion test: a clean store stays empty and a brand-new profile shows no Macro/Technical/Risk seats. | `tests/agentRosterService.test.ts`, `tests/agentsSurface.test.tsx` | Both suites green. |
| **E-35** | The deterministic layer is wired at the ONE `present_trade` executor: a confirmed AVOID refuses the plan and writes `VetoLedgerService.recordVeto`; a candidate AVOID caps the tier; a fired predicate's `ceiling` is folded into the same gate stamp the journal records. | `services/trade/presentTradeTool.ts`, `services/trade/proposalGate.ts`, `types/analysis.ts` | `tests/planE35Enforcement.test.ts` drives the real presenter (6 tests) and proves the ledger write, the refusal, the candidate cap and the stamped ceiling. |
| **E-43** | `netEdgeR` (net expectancy at the plan's own capped probability), a trader floor setting (default 0), a gate refusal, and a card that disables Log and quotes the number. The gate and the card read the SAME `buildTradePlan`. | `utils/netRiskReward.ts`, `services/trade/proposalGate.ts`, `services/trade/proposedTrade.ts`, `components/trade/panels/TradeProposalCard.tsx`, `App.tsx`, Settings → Analysis | `tests/planE03.test.ts`, `tests/proposalGate.test.ts`, `tests/proposalCard.test.tsx`. |
| **E-41** | New-session default leverage is the trader's setting, **10×** out of the box; `LEGACY_LEVERAGE = 100` is used only for historical rows. The proposal card shows the isolated-liquidation buffer beside the stop. | `utils/harnessSettings.ts`, `utils/conversationUtils.ts`, `components/trade/panels/TradeProposalCard.tsx`, Settings → Analysis | `tests/harnessControlsSettings.test.tsx` + card test (5 % buffer at 10×, "past liquidation" at 100×). |
| **E-18** | Automatic settlement with a 15 s Undo window; `shadow` (show, never record — the DEFAULT, per the plan's first month) and `confirm` modes; per-coin `deny`/`always` still win. Rows carry `resolutionSource`; a human correction stamps `correctedFrom`/`correctedAt` and `resolutionSource: correction`. | `utils/outcomeSettlement.ts`, `hooks/useWatchSideEffects.ts`, `hooks/useTradeLogging.ts`, `hooks/useTradeJournalActions.ts`, `types/trade.ts`, Settings → Analysis | `tests/planE18Settlement.test.ts` (table + real hook with fake timers), `tests/useTradeJournalActions.test.tsx`, `tests/harnessControlsSettings.test.tsx` (default = shadow). |
| **E-42(a)** | `decline_trade`: a HOLD object with the reason, side and rejected levels, offered on Chat, the dock and schedules, bounded at 500, backed up. | `services/trade/declineLog.ts`, `services/analysis/DeskToolsService.ts`, the three allow-lists, `ExportService.ts` | `tests/planE42Decline.test.ts` (5 tests, incl. the allow-list refusal). |
| **E-19** | ONE `TradePlan` object (`buildTradePlan`) produces the ratio, model claim, capped probability/band, cost, net edge and warnings. The card, the journal builder, the watch/drawings and the minEdge gate read it. | `services/trade/proposedTrade.ts`, `presentTradeTool.ts`, `TradeProposalCard.tsx` | `tests/planE19OnePlan.test.ts` asserts card/row/gate equality. |
| **E-20** | A read-only replay harness: `utils/planReplay.ts` + `npm run replay:plans --input <export>`. It re-derives today's verdict through the real builder and reports drift; an unstamped row is counted as unstamped, not accused. The deterministic baseline is labelled as requiring the candidate log. | `utils/planReplay.ts`, `scripts/replay-plans.entry.ts`, `scripts/replay-plans.cjs` | Unit tests + a real sample run produced a report (`1/1 compared, 1 drifted`). |
| **E-24** | Behavioural coverage for `electron/main.cjs`: protocol containment (real path, encoded traversal, foreign host, bad encoding), navigation/window-open policy, and the shell's hardening options. | `tests/planE24ElectronBehaviour.test.ts` | 7 tests against the real main process with Electron mocked. |
| **E-23** | Version + checksum + a preserved sidecar on a corrupt or checksum-failing notebook; a list/restore API; a "Restore this copy" banner in the notebook UI. The main key is never overwritten. | `services/learning/MemoryFilesService.ts`, `components/learn/MemoryFilesManager.tsx`, `ExportService.ts` | `tests/memoryFilesService.test.ts` (sidecar, restore, refusal, checksum). |
| **E-44** | The notebook is a v2 manifest plus per-category shards for `skills` and `trader-diary`; the v1 key becomes the manifest and migration source. The manifest is written LAST, so one full shard cannot take the whole notebook down. Every entry survives byte-identically across migration. | `services/learning/MemoryFilesService.ts`, `scripts/probe-skill-approval.cjs` (reads the shard), `ExportService.ts` | Sharding + migration tests; the full suite and the skill-approval probe (25/25) both pass. |

### The gates this pass ran, with their own figures

| gate | result |
|---|---|
| `npm run typecheck` / `typecheck:scripts` | 0 errors |
| `npm run lint` | 0 errors, **659** warnings (the ratchet cap binds exactly) |
| `npm run test` | **491 files / 4918 tests passed** |
| `npm run build` | ok, entry **1,389.30 kB** |
| `npm run boot-probe` | ok, zero pageerrors |
| `npm run render-probe` | ok, zero pageerrors |
| `npm run e2e` | 5 passed |
| `npm run skill-approval-probe` | **25/25**, `pageErrors=2` (its known quota signature) |
| `npm run check-flow-doc-anchors` | **299 anchors verified, 0 unattributed**; re-anchored from the HEAD source lines after the code moved |

### What this pass does NOT close

- **The candidate log (E-42b)** is not built: D-24 approves its shape but gates
  the implementation waves on the shadow month. The decline object is the half
  that can be built now.
- **The register's UX/accessibility, cleanup and infrastructure rows** (the
  `O-nn` items outside the five-phase order) are untouched. The five-phase order
  in `README.md` is what this pass completed, not the whole 121-row register.
- **The `minEdge` default is 0.** A trader who wants a margin raises it in
  Settings → Analysis; the default only refuses plans whose edge is non-positive.
- **Outcome settlement ships in `shadow`, not `automatic`.** The plan's first
  month is resolve-and-show-never-record; the trader flips it to automatic after
  comparing the detector with their own calls. The mechanism (provenance,
  correction, first-writer-wins, the 15 s Undo) is built and tested; the flip is
  the owner's, not the app's.
- **The replay baseline** needs the candidate log to answer "does the model beat
  a fixed rule?"; the drift harness is the part that can run today.
- **`noUncheckedIndexedAccess` (Phase 0.6) is not on.** Measured on this tip: `npx tsc --noEmit --noUncheckedIndexedAccess` reports **2,833 errors** across the analytics/tooling surface (`taLibrary.ts` 153, `setupScan.ts` 116, `smcStructure.ts` 111, …). TypeScript has no warning tier for it, so "on as a warning first" cannot be done without a compiler fork or a blanket suppression — both worse than leaving it off. The measurement is the deliverable; turning it on is a separate, large pass.

## 8. The context-window pass (2026-10-20)

Not a plan id. The owner reported a behaviour, in product terms: **when the model
runs many tools or thinks hard, no final answer arrives**, and the row instead
carries `THE PROVIDER STOPPED EARLY: one answer in this run hit the token
ceiling…`. The plan's `O-74`/E-13 made that line truthful; this pass made the
answer arrive. Three causes were found in the code, and one of them turned out to
be a stored-data bug the line was hiding.

| Cause, in the code | What landed | Verified by |
| --- | --- | --- |
| A tool round's output budget was `Math.min(caller, 4096)`, and thinking counts **inside** `max_tokens` on the DeepSeek, GLM, Anthropic and o-family routes. A seat told to decide at `high` (the E-39 default for `tradingDecision`) could spend the whole 4096 mid-thought and return a message with no call and no text; the loop read that as "chose not to call a tool" and ended the turn empty. | `DESK_ROUND_MAX_TOKENS = 8192` (`DeskToolsService.ts:240`), the same room `TASK_BUDGETS.chat` gives the answer, still clamped by a smaller caller budget. | `tests/deskToolThinkingCut.test.ts` — and measured red: setting the constant back to 4096 fails 3 checks |
| Nothing re-asked. An empty round returned `endedWithToolCalls: false` with `finalText: ''`, and the continuation went out at the tier that had just failed. | One re-ask per turn at a stepped-down tier (`stepEffortDown`, now exported from `reasoningControls.ts`), triggered on the wire's own stop signal — `truncated` **or** `finishReason === 'unknown'`, because a gateway that sends no signal has not said it finished. If the whole turn produced nothing, the continuation gets the same step-down plus a harness turn asking for prose. | `tests/deskToolThinkingCut.test.ts` (4 cases) — measured red: disabling the repair fails all four |
| Nothing bounded the outbound array. The desk loop grew its own request every round, and `chatSurfaceTurnMessages` mapped the **whole** stored conversation onto every send. | `services/providers/contextCompact.ts` — fit the array to the resolved window: oldest tool payloads to a marked head slice, then old prose, then whole tool rounds (never splitting a `tool_calls` block from its replies, which is what 400s the transcript). Applied at every round and at the continuation, and reported in the transcript through the tool-line channel — including the case where **nothing could be cut** (`CONTEXT FULL: … over a N-token ceiling`), because silence there reads as a healthy request right up to the provider refusal. | `tests/contextCompact.test.ts` (26 cases), `tests/deskToolThinkingCut.test.ts` (4) |
| The window itself was a single optional field the trader could type, defaulting to 65,536 — and `loadProviderConfigs` **dropped it on every app start** while the save path kept writing it. `thinkingCapable`, `jsonSchemaCapable` and both pricing rates were dropped with it. | `utils/contextWindow.ts`: user override → a limit the provider stated in a rejection → the window `/models` reported for that model id → the owner's new **1,000,000** default. Discovery now captures per-model windows (`discoverProviderModelCatalog`, stored in `ProviderConfig.modelContextWindows`); the loader preserves every optional field with coercion; `Settings → Providers` shows the number in use and says which evidence produced it. | `tests/contextWindow.test.ts`, `tests/providerConfigService.test.ts` (5 new), `tests/modelCatalogRefresh.test.tsx` (2 new) |
| An optimistic default is only safe if a wrong guess is survivable. | The transport (`sendChatRequest`, `sendChatTurn`, `streamChatRequest`) reads the limit out of a context-length rejection, records it as `measured`, compacts to it and retries **once** — never after a delta has been painted, and not at all when compaction has nothing to cut. A non-window 400 is not retried. | `tests/desktopProviderParity.test.ts` (4 new, over the Electron bridge) |

**Why the default could move to 1M without inflating a prompt.** Every injection
budget is `min(cap, window × fraction)` and both caps already bound at 65,536
(memory 2 %/900 tokens, market packet 10 %/6,000), so the change moves no
injected byte. `tests/contextWindow.test.ts` pins that as a control arm rather
than leaving it as an argument.

### The gates this pass ran, with their own figures

| Gate | Result |
| --- | --- |
| `npm run typecheck` | ok, 0 errors |
| `npm run typecheck:scripts` | ok, 0 errors |
| `npm run lint` | **0 errors / 659 warnings** (cap 659 — the new modules and tests add 0 net) |
| `npm run test` | **4992 tests in 494 files** passed, 0 skipped (184 s idle, 294 s with the dev server up — both green) |
| `npm run build` | ok, entry **1,398.63 kB** — the 1,400 kB ratchet now has **1.37 kB of headroom** |
| `npm run boot-probe` | ok, zero pageerrors, against a `dist/` built in the same sitting |
| `npm run render-probe` | **113 checks, 0 failures**, zero pageerrors |
| `npm run e2e` | 5 passed |
| `npm run skill-approval-probe` | **25/25**, `pageErrors=2` (its known quota signature) |
| `npm run check-flow-doc-anchors` | **299 anchors verified, 0 unattributed**; re-anchored `DeskToolsService.ts` 2159→2232, 3836→3929, 2935→3041, 3123→3222, and the provider-directory census (3 helpers → 4, 5 files → 6) |

### Verified in the running app, not only in jsdom

Driven against `localhost:3000` with the loopback mock provider, which now reports
`context_length: 131072` for its model — the shape OpenRouter, Together, llama.cpp
and vLLM use:

- A provider created in Settings → Providers, discovered, and reloaded shows
  `In use now: 131,072 tokens (reported for this model · 131,072 tokens)`.
  Discovery → storage → resolution → UI, in one path, in the packaged renderer.
- Typing `65536` flips it to `your override · 65,536 … Your entry overrides the
  131,072 it reported`, and **a full page reload still says so**. Before this pass
  the reload lost both fields, because `loadProviderConfigs` rebuilt the row
  without them — that is the stored-data bug, and this is the measurement that
  closes it.
- Clearing the override returns the line to the discovered 131,072, so the
  resolution order is not a unit-test artifact.
- With the window set to `2000`, a third dock question produced
  `CONTEXT FULL: even after compaction this request is 4,067 estimated tokens over
  a 1,024-token ceiling…` in the transcript — and the seat answered anyway. The
  honest report does not eat the turn.
- `npm run render-probe` (113 checks) re-runs the dock tool round against the same
  mock, so the transport change is covered without a live reasoning provider.

### What this pass does NOT close

- **The 1M default is an assumption, not a measurement.** It is correct for the
  models this owner runs and wrong for a 128K one — which is why the measured
  path exists. A seat that has never reported a window and has never been
  rejected still starts at 1M and learns its real limit on the first overflow,
  at the cost of one retried turn.
- **The estimated token count is an estimate.** `utils/tokenEstimate.ts` biases
  high and cannot see the provider's chat template or the tool schemas; that is
  what `WIRE_FRAMING_SAFETY_TOKENS = 4096` is for, and it is a constant, not a
  measurement.
- **Discovery reports a window for some gateways only.** OpenRouter, Together,
  Groq, llama.cpp, vLLM, NVIDIA NIM and Gemini do; OpenAI, DeepSeek and
  Anthropic answer `/models` with ids alone. A `max_tokens` field is
  deliberately not read — that is a request cap, and treating it as a window
  would compact a 128K model into amnesia.
- **No compaction happens while the assumed window holds.** With a 1M default an
  ordinary turn never reaches the ceiling, so the trader sees nothing. That is
  the honest consequence of an optimistic default, and `tests/contextCompact.test.ts`
  pins it so nobody "fixes" it by compacting eagerly.
- **A turn that still cannot fit says so instead of failing quietly**
  (`CONTEXT FULL: … over a N-token ceiling`), but the app does not then summarize
  the dropped history into a digest. Semantic summarization of compacted turns is
  a separate feature and is not built here.
