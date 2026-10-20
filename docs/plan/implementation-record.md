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

## 9. The register sweep (2026-10-20)

No new plan id. This pass does two things the plan asked for and nobody had
done: it **closes the rows whose defect was still open in the code**, and it
**re-measures the rows whose evidence had gone stale**, including several that
were already fixed by an earlier commit and left marked OPEN. Every closure names
the `file:line` that proves the fix is in the tree at this commit, and every
correction says which figure was wrong and what the measurement was.

**A rule this pass followed, stated because it changed outcomes:** a register row
is a claim about the tree, not a claim about history. Three rows were already
closed by commits that predate them (`O-54` by `c311dd32`, `O-90`/`O-91` by
`91b09eb4`/`8682019d`); two rows' `file:line`s had moved while the statement did
not (`O-75`, `O-59`); and one row was **false in the pessimistic direction**
(`O-72`: the step ladder is not "muted", it has no importer at all, and neither
does the thought reader). Checking before implementing is what kept this pass from
re-building a cost cap the app had already stopped shipping.

### What landed, and where

| Row | The defect | What landed | Verified by |
| --- | --- | --- | --- |
| **O-55**, **O-47** | The A/B lane and the prompt fingerprint had three readers and no writer, so the profile card's control/live split and every `promptVersion` on a journal row were `undefined`. | `hooks/useAnalysisPipeline.ts:951` opens the lane per run and `:955` stamps the corpus; both `runStats` builders persist the pair (`:1278-1279`, `:1443-1444`), which is what `hooks/useTradeLogging.ts:428-429` copies onto the trade. The fingerprint is `promptCorpusVersion()` in `services/infrastructure/PromptOverrideService.ts` — it hashes the EDITED-corpus state, so it is stable across builds and moves the moment the trader edits a prompt. It deliberately does NOT hash `PROMPT_REGISTRY`: importing the registry into the run path grew the entry chunk by 18.7 kB and the bundle ratchet is not a thing to loosen. | `tests/promptOverrideService.test.ts`: the lane's three branches, the fingerprint's stability and variation, and two source pins that the writers are still called from the pipeline |
| **O-60** | The desk mandate ordered the seat to call `get_chart_view`, and the Chat surface's allow-list refuses it — a duty the executor would not honour, which reads to the model as an obligation rather than an absence. | The mandate is composed from the offer set: `deskToolsMandateFor(offered)` (`services/analysis/DeskToolsService.ts:1681`), `withDeskToolsSystemPrompt(…, offeredTools)` (`:3956`), the offer list built at `:4064` from `mergedAllowed` before falling back to the definitions. A home with no chart is told there is NO CHART to read here and must cite the candles; a home with no market read at all is told to name no shape. | `tests/deskSystemPrompt.test.ts` — the invariant that every tool the mandate NAMES is a tool this turn can call — plus the updated source assertion in `tests/promptContract.test.ts` |
| **O-62** | The prompt promised a *fresh* packet; the code served an 8-second cache and, on a failed fetch, a bare "packet unavailable". | The fence stamps its own age — `packetAgeNote()` at `services/trade/tradeChatContext.ts:90` says `Ns old`, and past a minute `… — STALE: this snapshot predates the last N minute(s); call get_market_packet or get_chart_view for a newer read before you state a price` (into the header at `:128`). A failed fetch writes the `DATA_UNAVAILABLE` sentinel (`:102`) whose text says the state is UNKNOWN rather than missing. The system prompt now claims an age-stamped packet, not a fresh one. | `tests/tradeChatContext.test.ts` (the age, the sentinel, and the prompt's own sentence about it) |
| **O-65** | Nothing near a streaming transcript was a live region, so an arriving answer was never announced. | `role="log" aria-live="polite" aria-busy=…` on both homes' scroll containers — `components/trade/TradeChatPanel.tsx:1080`, `components/agents/AgentsView.tsx:1346` — each with an `aria-label` naming the conversation. Per-row live regions were rejected deliberately: one per message re-announces the whole transcript on every token. | `tests/tradeChatPanelHarness.test.tsx`, the surface-switch case in `tests/surfaceSwitch.test.tsx` |
| **O-66** | Seven of eighteen dialogs rendered `role="dialog"` with no trap, no `aria-modal`, no restore. | Five modals now trap and are proven by mounting each one and asserting focus lands inside — `AutomationEditorModal`, `ThinkingModal`, `ImageViewerModal`, `NewBotDialog`, `NewGroupDialog` — plus the two the audit missed: the full-screen `LiveMarket` overlay (`components/market/LiveMarket.tsx:81`, and NOT when it is the embedded panel) and the update overlay's decidable phase (`components/shared/UpdateOverlay.tsx:140`, because `downloading` and `installing` contain nothing focusable and a trap there swallows Tab for minutes). The header's session popover stays a disclosure on purpose — `components/shared/Header.tsx:217` writes no `aria-modal` and Escape/outside-click dismiss it — and now carries `aria-controls` on its trigger. | `tests/useFocusTrap.test.tsx`: the five mounts, and a **population** gate that lexes every `.tsx` under `components/` plus `App.tsx` with the shared `jsxScan` and refuses any element that writes `aria-modal` without carrying the `useFocusTrap()` ref on that same tag. Reach is floored at the 18 measured sites, six named members must be in the set, two planted defects prove both finding branches fire, and a disclosure-only fixture proves it does not over-refuse. |
| **O-53** | Four user-visible strings still named the deleted engine. | The editor's validation error is "Pick the model this run answers with." under a plain "Model" label (`components/automation/AutomationEditorModal.tsx:247`, `:508`); the journal's pre-merge badge reads `Ensemble (legacy)` (`components/journal/TradeLog.tsx:352`); the monthly card header says "Grade the panel — legacy debate rows only" (`components/journal/MonthlyReportCard.tsx:62`) and `services/learning/monthlyReport.ts` labels those columns legacy; `moderator` is out of the Settings search keywords. | grep over `components/**.tsx` — the two words survive only as code identifiers, in comments, and on these legacy-labelled rows |
| **O-73** | "The desk home, which runs the longest jobs, has no Stop." | It has one, on both homes: `aria-label={busy ? 'Stop' : 'Send'}` at `components/trade/panels/ChatComposer.tsx:213` and the `(busy \|\| analysisRunning)` form at `components/agents/AgentsView.tsx:1515`. Recorded as verified rather than newly built — the row's premise is retired, and `ChatComposer.tsx:51-54` documents that a Stop which aborts only the chat turn is a lie. | read at the two cited lines |
| **O-54**, **O-90**, **O-91**, **O-92** | Rows the code had already out-fixed. | The cost-cap setting is deleted at both ends (`debateCostCapUsd` has no declaration and no reader; the panel says so at `components/settings/SessionUsagePanel.tsx:132`); `surface-census.cjs` measures each surface at its own `ROOTS` entry (`:215`) and Settings at its dialog root; `ui-inspect.cjs` contains no `7` at all and reads the live switch population; the dead default `NavRail` import is gone (`App.tsx:128` imports only `AccountRow` and the collapse constant, both used). | grep, plus `tests/deadControlsGuard.test.ts:145`, which pins that no `<NavRail` is ever rendered |

### Corrections to the register (the numbers were the point)

- **O-69** — "17 call sites, 0 pass `action=`" was wrong on both halves. Measured
  today: **14** sites, and **1** passes `action=` (the journal's "Nothing is
  classified yet" offers "Show all trades" — `components/journal/TradeLog.tsx:724`).
  The prop exists and renders (`components/ui/EmptyState.tsx:14`, `:93-101`); what
  is missing is 13 decisions about what each empty state's next action actually
  IS, which is the trader's call, not a sweep.
- **O-71** — 20 `fallback={null}` is now **17**, measured.
- **O-72** — the ladder is not "imported but not mounted". `AnalysisProgress.tsx`
  and `ThinkingModal.tsx` both have **zero** production importers. Recorded as
  worse than the register said, and folded into **E-50**'s orphan census.
- **O-129** — `debatePods.ts` comes off the list (deleted; it is one of the 25
  files `git log --diff-filter=D` names under `services/providers/`) and
  `ThinkingModal.tsx` goes on it. Every figure in the row predates the debate
  deletion, the roster deletion and the context-window pass, so the graph must be
  re-run before the E-50 batches are cut.
- **O-75** — `'Logging in 15s'` moved from `:55` to
  `hooks/useWatchSideEffects.ts:70`, and `tests/planE18Settlement.test.ts:101`
  pins that exact copy, so the countdown is a tested behavior rather than an
  accident. Still the trader's number to choose.
- **O-59** — the definitions array is now `services/analysis/DeskToolsService.ts:871`,
  spanning `:871-1485`, and carries **35** `name:` fields, not 39 (measured by
  brace depth over that span). The ~7,864-token figure is the audit's own estimate
  and has not been re-derived here.
- **`docs/app-flow.md`** — the provider-directory census said "twenty-four files…
  the other fifteen". `git log --diff-filter=D --name-only --format= --
  services/providers/` names **25**, of which 9 were provider clients, so the
  sentence now says twenty-five and sixteen and enumerates the sixteen. The
  anchor gate's own census rule caught it; the paragraph is now the recipe's
  output rather than a remembered number.

### The gates this sweep ran, with their own figures

Every exit code below is read from the log's own `*_EXIT=` marker, not from a
pipeline. The first column is the run that measured the sweep tree; the
combined-tree re-run (sweep + E-51 Phase 1) is in §10.

| Gate | Result |
| --- | --- |
| `npm run typecheck` | `TYPECHECK_EXIT=0`, no diagnostics |
| `npm run lint` | **0 errors / 657 warnings** (the ratchet cap is 659, so the pass had to *lower* the count — it went from 659 to 657) |
| `npm run test` | **5028 tests in 494 files**, 0 failed (298 s idle) |
| `npm run check-flow-doc-anchors` | **303 anchors verified, 0 unattributed**; cited-line quality 0/0; providers census **0 findings — git names 25 deleted files, 6 remain** |
| `npm run build` | ok, entry **1367 KiB** by the guard's own `bytes/1024` measurement (ceiling 1400) |
| `npm run boot-probe` | ok, prod bundle boots, trade surface + dock render, zero pageerrors |
| `npm run render-probe` | **113 checks, 0 failures**, zero pageerrors |

Not re-run here, and saying so instead of implying it: `skill-approval-probe`
(drives the approvals inbox, which this sweep does not touch) and
`installer-smoke`. §8 records their last measurements.

## 10. E-51 Phase 1 — the merged model panel, unwired (2026-10-20)

`docs/plan/model-menu-redesign.md` is **untracked work the owner wrote** on
2026-10-20 (all four rulings answered, nothing implemented). This is Phase 1 of
its four, whose whole point is that the panel is extracted and tested with
**no surface wired to it** — the composer, the Chat surface and `ModelPicker`
keep their present controls until Phases 2 and 3 replace them.

| File | What it is |
| --- | --- |
| `components/shared/ModelMenu.tsx` | new: the portaled panel. Provider row with the constant `API` badge (ruling D-C) that opens a right-hand provider panel on click **and** hover; the active provider's models only, ready providers only; `Vision` from `isVisionModel`, `free` from `isFreeModelId`, the star toggle, the shared free-only pref, one `Manage providers` row (not the reference's two names for one destination); a six-stop `role="slider"` whose `aria-valuetext` is the tier LABEL, never the index; Escape contained to the innermost panel; roving arrow-key focus with Home/End; focus returns to the trigger. |
| `components/shared/effortScale.ts` | new: the ladder moved out of `EffortChip` (`EFFORT_CHOICES`, `effortChoiceOf`, plus `effortIndexOf` / `effortAtIndex` for the slider), re-exported from `EffortChip` so every existing importer is unchanged. One owner, because the trigger will print the tier and the slider will edit it. |
| `utils/providerUtils.ts` | `STARRED_MODELS_KEY`, `readStarredModels`, `writeStarredModels` beside the free-only pref — the star list was a `localStorage` literal copied into two components. Same key, same bytes; a ModelChip star still sorts the panel's list. |
| `components/shared/ModelChip.tsx` | the star read/write now goes through that owner. No behaviour change. |
| `App.tsx` | unchanged. The dead `import ModelPicker` (O-130's G-7, one occurrence, nothing renders it) is **still there on purpose**: `App.tsx` is the file the flow docs cite by line number more than any other, and deleting one line near the top invalidates every one of them at once. Phase 2 rewrites this file's composer wiring anyway and re-anchors `docs/app-flow.md` as part of its own gate list, so the import goes out with the pass that can pay for the re-measurement. Verified: removing it here turned `App.tsx:2014` into a comment line and the anchor gate said so. |
| `tests/modelMenu.test.tsx` | new: 15 tests, mounting the panel only. |

### The two gates that bound this work, and what they caught

`radiusRamp` and `themeContrast`'s clipped-text rule both went red on the new
file, and both were **right**:

- two `API` badges were written `rounded` — an off-token radius, and that gate
  holds its floor **by name** (`FLOOR_INVENTORY`), so a new entry fails the
  inventory even if the count somehow fit. Now `rounded-control`.
- three `truncate` spans clipped text whose full value was only reachable by
  the ancestor's `title`. The rule wants the clipped element itself to name the
  text. Each span now carries its own `title`.

The ceilings were not moved. `BASELINE = 9` and the clipped-text ceiling of `0`
are both still what they were before this file existed.

### Correctness notes found by reading, not by a red gate

- **The layout effect must not depend on the `anchor` object.** A parent that
  builds its own `DOMRect` each render would re-run the measure every render,
  and `setPos(freshObject)` is an identity change, so it would be an infinite
  loop, not a reposition. The deps are the anchor's three numbers now, and the
  setter returns `prev` unless a coordinate actually moved. The test suite
  cannot see this (it passes a module-level constant), which is exactly why it
  is written down here.
- **`ArrowLeft` was unreachable** behind the `if (providersOpen) return` guard —
  the inner panel could be opened but not backed out of by keyboard. The guard
  now handles Left before returning.
- **The Escape-containment test can fail.** Proved by deleting
  `e.stopPropagation()` from the panel's key handler: the planted document-level
  listener then fires and the test goes red (`1 failed | 14 passed`), and it
  passes again when the line is restored. A containment assertion that cannot
  fail would be documenting nothing.

### Gates

All measured on the final tree (sweep + Phase 1), each read from its own
`*_EXIT=` marker:

| Gate | Result |
| --- | --- |
| `npm run typecheck` | ok, 0 errors |
| `npm run typecheck:scripts` / `typecheck:electron` | ok, 0 errors |
| `npm run lint` | **0 errors / 657 warnings** (cap 659) |
| `npm run test` | **5043 tests in 495 files**, 0 failed, 0 skipped (384 s) |
| `npm run build` | ok, entry **1367 KiB** — unchanged, because nothing imports `ModelMenu` yet, so it is not in the startup graph |
| `npm run boot-probe` | ok, zero pageerrors |
| `npm run render-probe` | **113 checks, 0 failures** — run against the combined tree, and it is the gate that would have caught a composer regression had Phase 1 accidentally touched one |
| `npm run e2e` | 5 passed |
| `npm run check-flow-doc-anchors` | **303 anchors verified, 0 unattributed**; cited-line quality 0/0 |

**What Phase 1 does NOT do:** no surface changed. `ModelChip`, `EffortChip` and
`ModelPicker` still render where they render today, so the trader sees nothing
different, and `O-130`/`O-68` are **not** closed — the panel is one
implementation until Phase 3 makes `ModelPicker` mount it too.

## 11. E-51 Phase 2 — the composers mount the merged control (2026-10-21)

This is the first commit of the pass that changes what the trader sees. Rulings
D-A (the trigger moves INTO the composer card), D-C (a constant `API` badge) and
D-D (the tier printed on the trigger) land here; D-B's shortcut stays scheduled
for Phase 4 so the key hint is never shown before the chord exists.

| File | What changed |
| --- | --- |
| `components/shared/ModelChip.tsx` | rewritten: it is now the trigger AND the anchor. The label reads `Provider · Model · High` (D-D) and the accessible name reads the same three things; the panel body is `ModelMenu`, portaled and anchored to the trigger's rect. The compact form (dock, 384px) truncates; the wide form (Chat surface) does not. |
| `components/shared/EffortChip.tsx` | **deleted** (`git rm`). The tier is set on the slider in the model panel; keeping a second control for one value is the defect the proposal names (G-3). Its ladder had already moved to `effortScale.ts`, so nothing else moved with it. |
| `components/trade/panels/ChatComposer.tsx` | the footer row under the card is gone; the control sits in the toolbar row inside `data-testid="composer-model-and-send"`, left of send, and `ml-auto` moved from the send button to that pair so send stays bottom-right when the row wraps. The disclaimer keeps its own line. |
| `components/agents/AgentsView.tsx` | same move, and the bot rule now travels WITH the control: `modelPicker` is a render prop receiving `{ showEffort }`, because "a bot turn has no Effort section" needs `activeBot`, which only this surface has. `effortPicker` is deleted. |
| `App.tsx` | `SessionEffortChip` became `SessionModelChip` (still module-scope, still the only thing that touches `chatStore` on that surface's mount — the latch bug in its comment is why), the injection passes `showEffort` through, and the Chat surface's inline `setSelectedChatModel(v); chatStore.setActiveSoloModel(v)` pair became one `changeChatSoloModel` callback — the two writes the dock's own callback performs, spelled once. |
| `tests/chatEffortDial.test.tsx` | rewritten rather than deleted: the chip's radio-menu tests go (the panel's slider tests live in `tests/modelMenu.test.tsx`), and the five wiring pins that named `EffortChip`/`effortPicker`/`SessionEffortChip` now name the merged control — including `expect(fs.existsSync('components/shared/EffortChip.tsx')).toBe(false)`, so the deletion cannot be quietly undone. The transport pins (three wires, one shared rule) are untouched. |
| `tests/agentsSurface.test.tsx` | the injected-picker test now renders through the render prop and asserts the picker lands INSIDE the send pair, and that `showEffort` arrives as a real boolean. |
| `scripts/chip-shot.cjs` | rewritten for the new testids, and it now asserts behaviour rather than only pixels: the trigger must END in a tier word (D-D), starring must move a row to first, and the slider must expose `aria-valuemax=5` and a non-empty `aria-valuetext`. |
| `scripts/render-probe.cjs` | new checks for the move (below). |

### What the new probe checks learned on the way

Two of my own first drafts were **false green**, and both are the bug class this
repo has been bitten by before, so they are written down rather than fixed
silently:

- Every narrowed-width measurement reported `row 0px … send right 0 of card 0`
  and PASSED. Below its breakpoint the Trade surface does not lay the dock out
  at all, so the numbers were a zero-size rectangle, not a fit. A
  `found: false` guard now refuses to grade an unlaid-out composer and says so in
  the detail.
- A "both states measured" check passed while reporting `wrapped + wrapped`,
  because a hidden `display:none` file input contributed a third distinct `top`
  and made the single-line row read as wrapped. Line detection now counts
  VISIBLE children only.
- The plan asked for the claim in "both the wrapped and the unwrapped state", and
  **the unwrapped state is UNMET, not assumed**: the dock's toolbar measures the
  same ~333px at 1100px and 1280px viewports (the column is a chart fraction, not
  a viewport fraction), and a 208px trigger plus a 32px send cannot fit beside
  `+` and `Scan → skills`, so the row always wraps in the dock. The probe asserts
  the two properties that hold in whichever state exists — no horizontal overflow,
  and send right-most AND bottom-most — at the run width and at three narrower
  ones, prints a `NOTE` that the unwrapped state is unmeasurable, and does not
  claim otherwise. (If the dock is ever made genuinely wider, the sweep starts
  reporting a single line on its own.)

### Gates, measured on this tree

| Gate | Result |
| --- | --- |
| `npm run typecheck` / `typecheck:scripts` | ok, 0 errors |
| `npm run lint` | **0 errors / 657 warnings** (cap 659) |
| `npm run test` | **5042 tests in 495 files**, 0 failed, 0 skipped |
| `npm run build` | ok, entry **1374 KiB** (ceiling 1400, stale below 1260) — **+7 KiB, which is the honest cost of Phase 2**: `ModelMenu` was unreachable in Phase 1 and therefore not in the startup graph at all, and now every composer imports it. The ratchet still binds with 26 KiB of headroom, and it was NOT raised. |
| `npm run boot-probe` | ok, zero pageerrors |
| `npm run render-probe` | **115 checks, 0 failures**, zero pageerrors (was 113; the two new ones are the composer row at the run width and at 1100px) |
| `npm run probe:chip` | ok against a dev server on :4193 — `trigger label: "B.AI · Auto"`, `model popover top=380 bottom=800 viewport=900 FITS`, `after starring, first row: Kimi k3`, `effort slider stops=5 valuetext=Auto` |
| `npm run check-flow-doc-anchors` | **304 anchors verified, 0 unattributed**; cited-line quality 0/0 |

The anchor count moved 303 → 305 → **304** during this pass, and both moves were
measurements, not drift: Phase 2 shifted `App.tsx` by ~16 lines, so the tool
re-resolved 36 citations; re-pointing the html's `:2365` onto the existing
`{surface === 'trade' && (` anchor merged two distinct numbers into one, dropping
the unique count by 1. Two citations that the gate CANNOT see were corrected while
in there: `App.tsx:1217` claimed to be `latestChartVerdict(messages)` and is a
group-edit line (the real one is `:1229`), and `:303` claimed to be
`moderatorConfig` (the real one is `:310`). A citation the gate cannot check is
still a claim, and this one was false.

### What Phase 2 does NOT close

`O-130` moves to **in progress**, not closed: `ModelPicker` is still a second
implementation (Settings, the automation editor, the seat picker), so the shared
free-only/star preferences still do not follow the trader everywhere, and `O-68`
keeps its `ModelPicker`/`SymbolPicker`/`SelectMenu` half. The dead
`import ModelPicker` in `App.tsx` is still there for the same reason as in Phase 1
— it costs a doc re-anchor, and Phase 3 rewrites that file's picker anyway.
`O-56`/`E-39`'s *default* tier is untouched: this makes the tier visible and
settable beside the model, which is the UI half the proposal claims.

## 12. E-51 Phase 3 — one implementation: the picker mounts the same panel (2026-10-21)

`ModelPicker` is now a trigger. Its two-column hover flyout, its own free-only
checkbox, its own positioner and its own portal are gone; the body is the same
`ModelMenu` the composers mount, so there is one model menu in the app (G-4).
The 625-line file is 200.

What the picker had that the panel did not, and so had to be inherited rather
than merely deleted:

- **The flat cross-provider search.** `ModelMenu` listed only the selected
  provider's models, which is right for a composer and wrong for a box that
  implies "find it wherever it lives". The rows are now keyed by the
  `provider::model` PAIR (`data-testid="model-row-alpha::gpt-4o"`) because the
  same slug on two providers is two choices, and a search hit names its provider
  in WORDS — the old flyout printed the raw provider id there, which is not
  something a trader can read off a list.
- **`disabledValues`.** The panel seat picker greys a model that already holds a
  seat; the row renders `disabled`, and the click is refused rather than silently
  ignored.
- **The discovery feedback word.** `ModelMenu` had an icon-only refresh;
  `ModelPicker` had 'Refreshing…' / 'Updated!'. The panel now takes a
  `refreshState` prop and prints the word while it is not idle, so the icon
  stays quiet in the composer and a Settings user still sees that discovery ran.
- **`mode`.** `provider-model` writes `"p::m"`; `model-only` opens on the
  provider that owns the stored id and writes the bare `"m"` back.
  `provider-only` — declared, never rendered anywhere — is deleted (G-7).
- **One `Manage providers` row**, only when the host can route to Settings. A row
  with no handler is the dead affordance this repo's probes keep catching.
- **`onMouseDownCapture`/`onPointerDownCapture` stopPropagation moved WITH the
  flyout into `ModelMenu`.** This is not cosmetic: the picker sits inside
  `AutomationEditorModal`, whose host closes on any document-level
  outside-mousedown, and the panel is portaled to `document.body` — without the
  guard the modal tears itself down mid-pick.
- **Close on scroll and resize**, ignoring a scroll inside the panel's own list.
  A `fixed` panel that stays put while the page moves under it is detached
  chrome.

**A behaviour deliberately NOT "fixed" while passing through.** The old picker
flagged a stale pick as `· unavailable` when its PROVIDER was not ready, and
said nothing when a qualified pair named a model the catalog did not list. That
asymmetry looks like an oversight and is not: a user-typed custom model id is a
real selection that answers even when `/models` never listed it, so marking it
unavailable would refuse to run a model that works. A test pins the direction
(`does NOT flag a model id the catalog omits but the provider can still serve`)
so the next reader does not "tidy" it into a false alarm.

**A latent bug the rewrite removed.** The old refresh effect returned a cleanup
closure from the `august:model-refresh-end` HANDLER, where nothing reads it, so
the 2 s 'Updated!' timer was never cleared and could flip state on an unmounted
picker. The new effect owns the timer and clears it on unmount.

### Retargeted source guards

Two repo-wide source pins named `ModelPicker` for behaviour that now lives in
`ModelMenu`; both were moved rather than deleted, and one was loosened in the
direction of the property it defends:

- `tests/flyoutMarginSingleSource.test.ts` walks `ModelMenu.tsx` + `SelectMenu.tsx`
  now. Its "neither declares its own" arm asserted the exact alias line
  `const VIEWPORT_MARGIN = FLYOUT_VIEWPORT_MARGIN;`, which is a SPELLING, not the
  rule; it now refuses a local NUMBER and separately requires each file to
  subtract the shared constant, so an import nobody uses still fails.
- `tests/dockChatParity.test.tsx` reads the `text-left` search pin from
  `ModelMenu.tsx`.
- `components/shared/flyoutLayout.ts`'s own docblock named `ModelPicker` as one of
  the two positioners; it says `ModelMenu` now. A stale name lies after a move.

### Gates, measured on this tree

| Gate | Result |
| --- | --- |
| `npm run typecheck` / `typecheck:scripts` | ok, 0 errors |
| `npm run lint` | **0 errors / 656 warnings** (cap 659; deleting the flyout removed one warning) |
| `npm run test` | **5053 tests in 495 files**, 0 failed, 0 skipped |
| `npm run build` | ok, entry **1376 KiB** (ceiling 1400) — +2 KiB over Phase 2 |
| `npm run boot-probe` | ok, zero pageerrors |
| `npm run render-probe` | **115 checks, 0 failures**, zero pageerrors |

`tests/modelPicker.test.tsx` went 13 → 21 tests: the readiness parity guard is
unchanged in intent (it still asserts against
`providerUtils.isProviderReady`, not a snapshot of its rule), and the added
coverage is exactly what the merge promised — one panel, no second portal, no
second copy of the preferences, and the two value shapes.

## 13. E-51 Phase 4 — the chord, the hint, and the last dead import (2026-10-21)

Ruling D-B asked for `Ctrl+Shift+E` "later", with the hint in the SAME commit as
the binding so a key the trader was told about was never a key nobody bound.
This is that commit, and it closes E-51's four phases.

**What the chord does.** It steps the ACTIVE CHAT SESSION's thinking tier —
`chatStore.setActiveEffort(nextEffortTier(chatStore.getActiveEffort()))`, the
same stored row the slider writes, so the trigger's label moves the instant the
key is pressed and the value the next turn sends cannot disagree with what is on
screen. The ladder wraps (`max → off`), because a one-way ramp would strand the
dial at the top with no way back except opening the panel.

**Why it is guarded, and what the guard is.** `components/shared/effortDial.ts`
is a refcount that `ModelChip` raises for as long as it SHOWS the tier, and the
App-level handler asks it before acting. Not a boolean, because both chat homes
can be mounted with one hidden — the surface that unmounts must not switch the
key off for the one still on screen. A panel session never registers (`isPanel`
hides the chip) and a bot turn never registers (`showEffort: false`), so the
chord cannot write a tier that nothing reads back. That is the same class of lie
as an unbound hint, approached from the other side.

**The hint travels with the platform.** `effortShortcutHint(platform)` prints
`⌘⇧E` on macOS and `Ctrl+Shift+E` elsewhere, beside the `EFFORT` label and inside
the slider's accessible name (`docs/ui-doctrine.md:48` asks for the second, not
just the first), so a screen-reader user hears the chord that the sighted user
reads off a keycap.

**G-7, at last.** The dead `import ModelPicker` at `App.tsx:82` is gone. It was
deferred out of Phases 1–3 for the reason in §10 and §12 — one line near the top
of `App.tsx` invalidates every line-anchored citation the flow docs hold against
that file — and this phase pays for it deliberately, because Phase 4's own gate
list is the doc re-anchor. 28 tokens re-resolved from the gate's report, cited-line
quality back to 0 comment landings and 0 symbol misses, and the unique-anchor
count holds at **304**.

### What the gates can and cannot see

The chord is App-level keyboard handling, and mounting `App` in jsdom is not on
offer, so the pinned evidence is:

- `tests/chatEffortDial.test.tsx` — 7 new tests. `nextEffortTier` walks the
  ladder and wraps; `effortShortcutHint` names the right keycap per platform;
  the hint is rendered beside the label AND inside `aria-label`; the refcount
  rises while a dial is on screen, stays down for a bot turn, and falls back to
  zero on unmount (twice, because a double release must not sink the count).
- The same file pins the BINDING and its GUARD as one condition in `App.tsx`
  (`… && e.shiftKey && !e.altKey && effortDialUp() && e.key.toLowerCase() === 'e'`)
  and the write as one call into `chatStore`. A chord bound but unguarded, or
  guarded but unbound, fails that pin.
- `npm run render-probe` presses the real key in a real browser and requires the
  dock's trigger label to move — `"Mock · Auto" -> "Mock · Low"` — and then
  presses it six times and requires the label to be back where it started, which
  is the wrap, not a ramp. That is the only gate that walks the whole path
  (keydown → guard → store → subscription → label).

### Gates, measured on this tree

| Gate | Result |
| --- | --- |
| `npm run typecheck` / `typecheck:scripts` / `typecheck:electron` | ok, 0 errors |
| `npm run lint` | **0 errors / 655 warnings** (cap 659; the deleted dead import took one with it) |
| `npm run test` | **5060 tests in 495 files**, 0 failed, 0 skipped |
| `npm run build` | ok, entry **1376 KiB** — unchanged from Phase 3 |
| `npm run boot-probe` | ok, zero pageerrors |
| `npm run render-probe` | **117 checks, 0 failures**, zero pageerrors (was 115: the chord and its wrap) |
| `npm run e2e` | 5 passed |
| `npm run check-flow-doc-anchors` | **304 anchors verified, 0 unattributed**, cited-line quality 0/0 |

**Honest limit:** nothing exercises the chord against a bot turn or a panel
session in a browser. Those states are covered by the registration rule (no
chip, no count, no chord) and by the `showEffort: false` unit test, not by a
keystroke.

## 14. The R:R and cost rows — 12 closed, 2 copies actually fixed (2026-10-21)

The owner asked to keep implementing. The next cluster on the plan's own order is
Phase 2.2 (one R:R) and 2.3 (the cost model). **Verifying before building turned
that into a different job than the register advertised**, and the difference is
the point of this section.

**`O-01`, `O-02`, `O-05`, `O-07`, `O-19`, `O-20`, `O-22`, `O-27` were already
fixed** — E-02 and E-03 landed in an earlier pass with their own suites
(`tests/planE02.test.ts`, `tests/planE03.test.ts`, `tests/proposalGate.test.ts`)
and the rows simply never moved. `O-19`'s own grep recipe
(`takerFee|makerFee|feeRate|commission|costBps`) returned **0 files** when the
row was written and returns `utils/netRiskReward.ts` now. Had I implemented
"the cost model" from the register instead of checking, this pass would have
built a second one — the exact defect class the plan's §Phase 0.2 warns about.

**Two copies were genuinely live, and they are fixed:**

- `O-03` — the canvas `measured_move` label printed its own `reward/risk`.
  It now measures with `plannedRiskReward` and prints through `fmtRiskReward`
  (`services/trade/chartDrawings.ts:619`), so a drawn level and the card cannot
  quote different ratios for one ticket once a ladder is out of order.
- `O-04` — the pattern memory estimated a win from `analysis.takeProfit[0]`,
  which is **array order**. It now prefers a corrected exit (what filled) and
  otherwise takes `nearestTargetPrice`
  (`services/learning/PatternMemorySynthesisService.ts:275`). Four new tests,
  one of which is a parity pin against `plannedRiskReward` for the same plan.

**A second defect fell out of the `O-04` fix, and it is the better find.** The
old code accepted a target sitting exactly ON the entry as a real reward, so a
"win" with `takeProfit[0] === entry` booked **+0.00R** — a win that earned
nothing entered the pattern memory as a flat outcome. The canonical rule refuses
a zero-distance target as "no reward", so the estimate now falls through to the
1.5R default like any plan with nothing to measure. That behaviour is pinned by
its own test (`falls back to the 1.5R estimate only when no target is usable`),
which goes red on the old code — as do the other three, proved by reverting the
one line in the tree (`expected 3 to be 1.4`).

**Two rows are re-scoped rather than closed, and the reason is recorded.**
`O-06` ("make the gate refuse, not just cap") is half-true now: a refusal was
built, but in `proposalGate` — the path a presented trade actually takes — while
`runValidationGate` still has zero production importers. Asking for THE gate to
refuse is the E-02a/E-02b ruling, not a cleanup. `O-21` keeps its 150 %
extended-stop rule as the unvalidated policy it is; what E-03 changed is that
any breakeven quoted against it must now be computed net, so the row's 59.3 %
figure is stale arithmetic rather than a live bug.

### Gates

Every one measured on this tree, read from its own `*_EXIT=` marker:

| Gate | Result |
| --- | --- |
| `npm run typecheck` | ok, 0 errors |
| `npm run lint` | **0 errors / 655 warnings** — unchanged from Phase 4, so the two fixes added no debt |
| `npm run test` | **5065 tests in 495 files**, 0 failed, 0 skipped (5 more than Phase 4: the four `calculatePnlR` cases and the drawing-label case) |
| `npm run build` | ok, entry **1376 KiB** — unchanged; `chartDrawings` reached `utils/riskReward` through a module already in the graph |
| `npm run boot-probe` | ok, zero pageerrors |
| `npm run render-probe` | **117 checks, 0 failures**, zero pageerrors |
| `npm run check-flow-doc-anchors` | ok, 304 anchors verified, 0 unattributed, cited-line quality 0/0 |
