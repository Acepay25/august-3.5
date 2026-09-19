# August — Learning-Loop Integrity, LLM Autonomy & Minimalist UI Plan

> **Purpose:** hand this document to subagents. Each workstream (WS) is
> independently assignable. Every WS lists: goal, verified current state (with
> file paths + line anchors), concrete tasks, acceptance criteria, and tests.
>
> **Ground rules (apply to EVERY subagent):**
> - Repo conventions: `AGENTS.md`. Strict TS (all fns have return types),
>   functional components, zod at AI boundaries, sanitizers on AI output.
> - Theme is Minara-derived DARK. Do NOT re-introduce light theme, gray
>   remaps, or new color families. Recolor through `index.css @theme` tokens.
> - Verify with `npm run typecheck && npm run test` before declaring done.
>   Add/extend Vitest suites for every behavioral change.
> - Never commit API keys. Providers are runtime-configured
>   (`ProviderConfigService`); all AI calls go through
>   `services/providers/GenericProviderService.ts` / `GenericAnalysisService.ts`.
> - AI autonomy changes must be fail-safe: any LLM failure degrades to the
>   deterministic path, never to a crash or a blocked queue.

---

## 0. Verified current state (audit summary — trust but re-verify)

### 0.1 The learning loop as it EXISTS today

```
trade logged (useTradeLogging.ts:339)
  → SkillMemoryService.syncClosedTradeToNotebook (SkillMemoryService.ts:2295)
      · diary entry (MemoryFilesService.ts:627), evidence clustering
      · eval kick lives here (SkillMemoryService.ts ~2430, detached try/catch)
post-mortem completes (hooks/usePostMortem.ts:655)
  → MemoryService.updateGlobalMemory → AlgorithmicMemoryService (deterministic)
  → SkillCraftService.craftSkillFromPostMortem → draftGates.gateEvidenceBackedDraft
      · evidence tier = LLM worth gate (skillWorthGate.evaluateSkillWorth, JSON
        schema'd, create/merge/skip, prediction REQUIRED, conf <0.55 ⇒ skip)
      · deterministic tier fallback when no provider (tombstone/dup/IF-THEN bar)
  → queueSkillDraft (utils/skillDrafts.ts, localStorage, 7-day reject tombstones)
LLM supervisor (services/learning/skillSupervisor.ts) — ALREADY EXISTS:
  "the LLM that sits where the human sat". Reviews skill drafts, forged tools,
  memory amendments, learning-queue proposals; approve/enhance →
  ingestCraftedSkillFromDraft (same landing as the human Save button);
  reject → tombstone. Auto-runs via event debounce (10s) installed by
  TradeChatPanel.tsx (`ensureSupervisorListeners()` in useEffect,
  `nudgeSupervisor` on send). Toggle persisted per user
  (supervisorStore AUTO_KEY `supervisor_auto_v1_<user>`, DEFAULT ON).
  Human override after the fact: overrideApproveSkill / overrideRejectSkill.
Auto evals: SkillEvalScheduler (1 skill per sync, A/B vs ε-holdout,
  budget 2/session) — verdict feeds deriveStatus (hurts ⇒ demote).
Lifecycle proposals: utils/learningQueue.ts (displacement/revival/demote
  auto-applyable; rescope/contradiction are human-edit prompts TODAY).
```

### 0.2 Memory surfaces (verified)

- **Notebook (primary):** `MemoryFilesService` (folders/files, per-user
  Preferences), retrieved per-stage by `MemoryRetrievalService.getMemoryFilesContext`
  with budgets + `MemoryInjectionService` attribution records (runId-joined).
- **Bot memory:** `services/bots/BotMemoryService.ts` — per-bot
  `bots-<id>/system.md` + `memory.md`, query-filtered. Chart pipeline merges
  ALL bots' memory into analyst context
  (`hooks/analysisPipeline/memoryContext.ts`, cap 1800 chars).
- **GlobalMemory:** written every post-mortem; read back ONLY via
  `utils/memoryUtils.buildGlobalMemoryIndex` → `constructOptimizedContext`
  (GenericAnalysisService.ts:335). `familyPerformance` is injected verbatim
  (pinned by tests/memoryIndexLayer.test.ts). No other consumer.
- **Bots (DM + routines) do NOT read notebook retrieval.**
  `useBotMailbox.runBotTurn` (~line 130) builds system = persona + notes +
  hybrid injection only. `services/agents/botRoutine.ts` same shape. Bots
  READ their own memory; bots NEVER WRITE learning (no lesson extraction, no
  evidence, no diary). This is the biggest connectivity gap.


### 0.3 Human-in-the-loop points that remain (the autonomy gaps)

1. `CoachThreadPanel` draft cards + `ApprovalInbox` — human Save/Discard
   still exists as a parallel path (keep as override, not primary).
2. `LearningQueuePanel` — rescope/contradiction proposals are "open the
   skill / dismiss" human prompts; the supervisor reviews proposals but the
   APPLY for these two kinds is human-only.
3. Supervisor visibility is buried: indicator inside the TradeChatPanel dock
   + a Settings card. User cannot see at a glance that the system
   self-governs.
4. If the Trade surface never mounts, `ensureSupervisorListeners` never runs
   → queue stalls. Move listener install to App level (WS-2.1).

### 0.4 UI inventory (122 files, 1.83 MB in components/)

Worst offenders by size: TradeChatPanel 151 KB, SettingsMenu 84 KB,
LearningDashboard 67 KB, TradingChart 60 KB, ProviderManager 57 KB,
TradeLog 54 KB, TradeView 53 KB. Learning UI is scattered across
LearningDashboard, VersionHistoryDashboard, StrategyStudio, SkillDetail,
LearningQueuePanel, SupervisorPanel, SupervisorCard, MemoryFilesManager,
HarnessLessonsBrowser, AmendmentsInbox, ProfileMemoryCard. Design tokens are
healthy (index.css @theme, StatusPill, EmptyState, seg-thumb,
rounded-control/bubble) but adoption is uneven.

---
---

## WS-1 — Prove the loop end-to-end (do this FIRST)

**Goal:** one failing-then-passing integration test that *is* the definition
of "connected and learning", plus fixes for anything it exposes.

**Tasks:**
1. New suite `tests/learningLoopE2E.test.ts` (model after
   `tests/learningLoopMachinery.test.ts`, `tests/skillHoldout.test.ts`):
   seed notebook → log a closed trade through `syncClosedTradeToNotebook` →
   run `craftSkillFromPostMortem` + `gateEvidenceBackedDraft` with a mocked
   provider (see tests/debateFlow.test.ts transport-mock pattern) → run one
   `runSupervisorPass` → assert skill file exists as `candidate` → inject via
   `getMemoryFilesContext` → assert `MemoryInjectionService` record with the
   same runId → apply outcome via `applySkillEvidence` → assert W/L tally
   moved → force `evaluateSkill` verdict 'hurts' → assert status demotes.
2. Assert the bot-side gap explicitly (documents WS-3's target): a bot DM
   turn currently produces NO learning writes — encode the post-WS-3
   expectation behind a feature-flagged block so the suite flips green when
   WS-3 lands.
3. Audit `updateGlobalMemory` → `buildGlobalMemoryIndex` round-trip: a
   post-mortem on a Family-A trade must change the next index's
   `familyPerformance` line. If a write-only field is confirmed anywhere,
   either wire it into `MemoryRetrievalService` or delete it — no write-only
   state.

**Acceptance:** suite green; `npm run typecheck` clean; a short
`docs/learning-loop-map.md` listing every writer and reader of each memory
surface, verified against code.

---

## WS-2 — Full LLM autonomy ("the model approves; the user can still delete")

**Goal:** zero REQUIRED human actions anywhere in the learning loop. Human
role = audit + override + delete. No behavior may depend on a surface being
mounted.

**Tasks:**
1. **App-level supervisor install.** Move `ensureSupervisorListeners()` from
   `TradeChatPanel` to App mount (a tiny `useSupervisorBootstrap` hook in
   App.tsx). Keep `nudgeSupervisor` on send. Add a startup sweep: on app load
   + user switch, if any queue is non-empty, schedule one pass (respect
   `autoEnabled` + abort semantics).
2. **Close the proposal gap.** Extend the supervisor verdict schema
   (`SupervisorVerdictSchema`, skillSupervisor.ts:71) with proposal actuation
   for `rescope` and `contradiction`: the model outputs either a concrete
   rewritten clause (fail-closed through the same `validateIfThen`/prediction
   gates as drafts) or dismiss-with-reason. Apply through the existing
   `applyDisplacementProposal`-style functions; anything unparseable stays
   queued for the human panel. Update `LearningQueuePanel` copy: items become
   "pending review" / "auto-resolved" instead of implying required human
   action.
3. **Keep human power, make it explicit.** User retains: delete any skill
   (existing `deleteMemoryFile` — verify reachable from SkillDetail AND the
   new WS-5 surface), supervisor pause toggle, per-event override
   (`overrideApproveSkill`/`overrideRejectSkill`). Add a "why" line on every
   auto-approved skill (supervisor reason persisted into skill frontmatter or
   a sidecar note) so auditability survives the session-scoped event log.
4. **Budget honesty.** Supervisor runs one call per item; add a per-session
   item cap (mirror `MAX_AUTO_EVALS_PER_SESSION` discipline) with a visible
   "N items waiting" state rather than silent deferral.

**Acceptance:** with a mocked provider and `autoEnabled=true`, queueing a
draft + proposals results in a fully drained queue with zero UI interaction;
toggling auto off leaves everything queued and human-reachable; user delete
works on auto-created skills; tests extend `tests/skillSupervisor.test.ts`
plus new proposal-actuation cases.

---

## WS-3 — Connect the bots (chart AI ↔ agent bots, both directions)

**Goal:** bots learn and are learned from. One shared memory substrate, one
shared gate, many authors.

**Tasks:**
1. **Bots read shared retrieval.** In `useBotMailbox.runBotTurn` and
   `botRoutine.runBotRoutineTurn`, build a `MemoryRetrievalQuery` (coin mined
   from the prompt via the existing coin regex / `minePatternFromPrompt` —
   reuse, don't fork) and inject a budgeted slice via
   `getMemoryFilesContext` (smallest existing stage tier; record injections
   with `recordInjections: true` and the turn id as runId so attribution
   works). Respect each bot's `memoryScope` ('isolated' ⇒ own files only).
2. **Bots write learning.** After a bot turn that references a logged/closed
   trade — or when an `OutcomeAutopilotService` resolution lands on a message
   whose `modelsUsed` pair belongs to a bot (join via
   `utils/agentThreads.threadForProvider` identity) — run the same write-back
   chain as post-mortem: `syncClosedTradeToNotebook` evidence path +
   `craftSkillFromPostMortem`/`gateEvidenceBackedDraft` (botContext = that
   bot's system+memory, which the worth gate already accepts) + a one-line
   lesson appended to the bot's `memory.md` via the MemoryFiles update path.
   Fail-safe: LLM failure ⇒ deterministic tier ⇒ human-visible queue.
3. **Provenance.** Skills/lessons originating from a bot carry `originBotId`
   (SkillMemoryService already has firstBotId plumbing — extend, don't
   duplicate). Retrieval labels such blocks "from @BotName" so analysts and
   the user can see cross-pollination.
4. **UI proof.** AgentRosterRail/BotManagerDrawer: per-bot learning stats
   (notes lines, skills authored, evidence count, last lesson date) + a
   "synced with notebook" affordance.

**Acceptance:** the WS-1 bot block passes; a simulated bot turn → outcome →
next chart analysis retrieval for the same coin surfaces the bot's lesson
(asserted in test); no prompt-budget regressions (verify with
memorySimplification/skillTiering suites).


---

## WS-4 — Memory coherence & hygiene

**Goal:** every memory surface has a verified writer AND reader, consolidation
runs on schedule, and the user can see memory health.

**Tasks:**
1. **Reader/writer matrix.** From WS-1.3's map, act on every asymmetry:
   - `GlobalMemory.aiPatternMemory`/`familyPerformance`: confirm the index
     layer is their only reader; either promote `familyPerformance` into
     `memoryContext.ts`'s analyst slice (a genuinely useful prior) or document
     the index as the canonical surface. No silent ledgers.
   - `SelfLearningService.generateLearningContext` (~480 lines, dead export
     per prior audit): delete or wire — prefer delete;
     `computeLearningProfile` stays (dashboard consumers).
   - `DecisionReflectionService` (single call site, useAnalysisPipeline.ts:1353):
     keep, but register it in the loop map.
2. **Scheduled hygiene.** Weekly (piggyback the `weeklyReview` due-check
   pattern): `MemoryConsolidationService`, `MemoryReviewService`, graveyard
   sweep, contradiction sweep (already queues proposals — auto-handled once
   WS-2 lands). Each writes a one-line health entry the UI can render.
3. **Memory health selector.** A small pure function over existing stores
   (MemoryFilesService + supervisorStore + skillDrafts/learningQueue): file
   counts by folder, stale files (no hits in N days), skills by status,
   contradicted settled beliefs, pending queue sizes. WS-5 renders it.

**Acceptance:** matrix committed to docs; hygiene pass covered by a test
(seed stale/contradicted state → run sweep → assert proposals/consolidations);
no service remains write-only without an explicit code comment saying why.

---

## WS-5 — Minimalist UI pass (component-by-component)

**Design doctrine (constraints, not suggestions):** page `#0b0b0a`, panels
zinc-900, raised zinc-800, hairlines zinc-700/800; emerald=gain, rose=loss,
amber=warning, cyan=info — NEVER introduce new hues; brand gradient ONLY on
wordmark + active-nav indicator; Geist for UI, DM Serif only for hero/display
moments, JetBrains Mono for data; `rounded-control` (8px) inputs/buttons,
`rounded-bubble` (12px) chat bubbles; reuse `StatusPill`, `EmptyState`,
`Tip`, `seg-thumb`, `SelectMenu`, `ConfirmDialog` instead of hand-rolling.


### 5.1 Consolidate learning UI into ONE surface
- New **"Learn" surface** (5th NavRail item, Alt+5) OR a Studio tab — pick
  one, document the choice. Merge: LearningDashboard (67 KB — split into
  cards), LearningQueuePanel, skill list/SkillDetail, graveyard view,
  supervisor activity (promote SupervisorPanel's event stream here),
  memory-health card (WS-4.3), HarnessLessonsBrowser, AmendmentsInbox.
- Information architecture: **Queue → Skills → Memory → Health**.
  Queue = what the model is deciding right now (supervisor stream + pending
  items, override buttons). Skills = filterable table (status, W/L, eval
  verdict, origin incl. bot, last-eval; delete + pause per row). Memory =
  notebook browser (thin wrapper over MemoryFilesManager). Health = the WS-4
  card + consolidation history.
- Settings keeps only provider/model + toggles; SupervisorCard becomes a link
  into the Learn surface.

### 5.2 Trade surface calm-down
- TradeChatPanel (151 KB) — extract: supervisor dock widget, skill-citation
  row, autopilot banner, tool-activity row into `components/trade/panels/*`
  (pure split, no behavior change; existing tests must still pass).
- One canonical "what the AI remembers" strip: unify `InjectionContextBar` +
  `SkillCitationChips` + memory sources (`listRetrievedMemorySources`) into a
  single hairline-divided row above the verdict; click → provenance popover.
- ApprovalInbox: merge into ONE drawer from the NavRail badge (items already
  typed in `utils/approvalInbox.ts`); most skill items show "auto-approved by
  supervisor — undo" instead of primary actions (WS-2).

### 5.3 Component-level minimalism sweep
For every component under `components/`: replace hand-rolled chip/pill/
empty-state markup with `StatusPill`/`EmptyState`; delete dead
`.status-surface`/`.analysis-card` remaps if any remain in class lists; every
numeric readout uses tabular-nums mono; micro-labels ≥10px stay on
`text-zinc-600` (AA already tuned — don't darken); ONE cyan accent per view;
hairline-only borders (`border-zinc-800/80`), no double borders
panel-in-panel. Priority files (biggest first): SettingsMenu, TradeLog,
TradeView, TradingChart, LiveMarket, DeskScene, AgentRosterRail,
WinRateDashboard, Sidebar.

### 5.4 Motion & density
- Transitions only via `--ease-snappy` 0.12–0.18s; no new keyframes except
  the existing tick-flash/beacon patterns. No layout shift on stream chunks.
- Density: dashboards default to one-line rows with disclosure, not stacked
  cards-of-cards. Tables over tiles where data is tabular (win rates, skills,
  trade log).

**Acceptance:** `npm run lint` clean (errors), typecheck clean, existing UI
tests updated; a short `docs/ui-doctrine.md` checklist derived from the rules
above; every merged surface keeps a jsdom smoke test (mocking pattern:
tests/systemIntelligenceUi.test.tsx).

---

---

## WS-6 — Agents surface → chat-first "agent messenger" (reference: attached Claude-style screenshot)

**Goal:** the Agents tab stops being a roster that bounces you to the Trade
surface (today: `AgentRosterRail` + a dead-end empty state at App.tsx:3161
— "Pick an agent to open it as a Chart AI session on the trade surface…")
and becomes a **self-contained chat area**: you talk to bots, groups and the
Chart AI itself in one pure-chat layout, styled on the attached reference
(left conversation rail + centered greeting + pill composer). The chart
connection is preserved — the same conversations power the Chart AI dock on
the Trade surface (threads are shared, not forked).

**Layout (mirror the reference image):**
1. **Left rail (~280–320px, zinc-900, hairline right border):**
   - Top row: `+ New` button (starts a fresh thread → default = Chart AI
     thread), search icon, collapse handle.
   - Section shortcuts = **Agents, Rooms, Coach** (New Bot / New Group entry
     points live here, not as a big bottom button).
   - **Pinned** section: Team room + user-pinned threads.
   - **"Chats and tasks"** list: every thread — bot DMs, group rooms, Chart
     AI sessions, coach — one row each (avatar dot, title, truncated preview),
     with search + sort icons in the section header. Reuse
     `utils/agentThreads.ts` (`threadForProvider`, `threadForGroup`,
     `previewTextFor`, `unreadCount`, `markThreadOpened`) as the data source;
     this REPLACES `AgentRosterRail`'s row model on this surface (the rail's
     routines disclosure and attention hints survive as row badges/menus).
   - Bottom: user chip (avatar initial, name, provider status dot) — mirrors
     the reference's bottom user row.
2. **Main pane (page-colored `#0b0b0a`, `.chat-hero-grid` background on empty
   state):**
   - Empty/new thread: centered brand asterisk (the existing brand mark, NOT
     a new gradient element) + DM Serif greeting ("Hello, night owl" pattern —
     time-aware, username from the active profile) + the pill composer.
   - Active thread: messages in the shared `.chat-column` 880px measure,
     `rounded-bubble` bubbles, bot avatar + name + mono timestamp per message
     group (GroupChatView's existing message rendering, restyled).
3. **Composer (the reference's pill):** large rounded-2xl input
   ("How can I help you today?" / "Message @BotName…"), bottom row inside the
   pill: `+` (attach image — reuse the Trade dock's image pipeline),
   **mode segmented control** (`seg-thumb` pattern): `Chat` | `Analyze` —
   `Chat` = quick bot/casual turn (`streamQuickResponse`, existing);
   `Analyze` = hands the SAME text to the full Chart AI pipeline
   (`useAnalysisPipeline` send path) so the ensemble debate + desk tools +
   memory run, with the verdict card rendered inline in the thread. Right
   side: model chip (current provider/model, opens ModelPicker), mic/icon
   affordances optional/deferred.
4. **Chart connection preserved (hard requirement):**
   - The Chart AI thread is a first-class row in the list; opening it here
     and on the Trade surface shows the SAME conversation (it already is one
     `messages` array — this WS only changes presentation).
   - `Analyze` runs write verdicts/autopilot/watch artifacts exactly as the
     Trade dock does (same handlers — do not fork the pipeline).
   - Trade surface keeps its dock; this is a second, chat-native window onto
     the same agent fabric, not a replacement.
   - Bot DMs/groups keep their current transports (`useBotMailbox`,
     `useAgentGroups`); WS-3's read/write learning wiring applies unchanged.
5. **Behavior details:**
   - Row context menu: pin/unpin, rename (bots), routines, delete (existing
     confirm dialogs).
   - Unread badges from `lastOpenedMap`; working-dot from `workingBotId` —
     same signals as today, rendered as the rail's subtle dot/pill language.
   - Keyboard: Alt+4 opens Agents; `/` focuses search; Enter sends.
   - Mobile: rail collapses to a drawer (the surface must work at <md, where
     today's empty-state pane is hidden anyway).

**Acceptance:** Agents surface renders the three-region layout with zero
dead-end states; sending in `Chat` mode round-trips a bot DM; `Analyze` mode
produces a real verdict card inline (reuse of pipeline, verified by mocking
the transport in a jsdom test modeled on tests/debateFlow.test.ts); the same
message appears in the Trade dock; roster management (New Bot/Group, edit,
delete, routines) fully reachable from the rail; typecheck + tests green.


## Sequencing & parallelization

```
WS-1 (prove loop) ──┬──> WS-2 (autonomy) ──> WS-5.1/5.2 (UI consolidation)
                    └──> WS-3 (bots)     ──> WS-5.3 (bot stats UI)
WS-4 (memory) runs parallel to WS-2/3; WS-5.3/5.4 parallel after 5.1 lands.
WS-6 (Agents chat surface) is presentation-first and can start ANY time, but
its Analyze-mode wiring must land after WS-3 (bot learning) to avoid double
integration; its rail supersedes part of AgentRosterRail that WS-5.3 touches
— sequence WS-6 after WS-5.3 or give one owner both.
```

Suggested subagent split: **A** = WS-1, **B** = WS-2, **C** = WS-3,
**D** = WS-4, **E** = WS-5.1–5.2, **F** = WS-5.3–5.4, **G** = WS-6. B and C
both touch bot-mailbox-adjacent code — sequence C after B's
supervisor-schema change. E touches TradeChatPanel; F rebases on E. G owns
the Agents surface; if F's bot-stats UI targets the roster rail, G absorbs
it into the new rail instead (avoid two owners on AgentRosterRail).

## Global acceptance checklist

- [x] `tests/learningLoopE2E.test.ts` green (loop provably closed, bots included)
- [x] Zero required human clicks from draft → skill → eval → promotion/demotion
      (needed a product fix: the 0W/0L injection ban deadlocked every new skill —
      see `SkillMeta.prior: 'gated'` and `docs/learning-loop-map.md`)
- [x] User can still: delete any skill, pause the supervisor, override any verdict
- [x] Every memory surface has a documented writer AND reader
      (`docs/learning-loop-map.md`; the diary is write-only BY DESIGN and now
      says so instead of claiming readers it doesn't have)
- [x] Bot turns read shared retrieval and write lessons back (test-proven:
      `tests/learningLoopE2E.test.ts`, `tests/botLearning.test.ts`,
      `tests/botWorthGateContext.test.ts`, `tests/botCraftLeg.test.ts`) —
      including the full draft chain, judged against the acting bot's own
      memory and crafted on its own model
- [x] Learn surface exists; Settings sheds its supervisor duplicate (WS-5.1:
      Alt+5 rail item, Queue → Skills → Memory → Health; SupervisorCard is now
      a link in)
- [x] Agents surface is chat-first (rail + greeting + pill composer), Chat and
      Analyze modes both round-trip, and threads stay shared with the Trade dock
- [x] Memory hygiene runs on a schedule + the WS-4.3 health selector
- [x] Trade surface calm-down (WS-5.2): `SupervisorStream`,
      `SupervisorIndicator` and `ToolActivityRow` are all out of the panel;
      `MemoryProvenanceStrip` is the one canonical memory row; the approvals
      drawer stays one drawer and now says why an item reached a human
- [x] `docs/ui-doctrine.md` + `docs/learning-loop-map.md`
- [x] `npm run typecheck && npm run test && npm run build` all green

## Still open

Deliberately left, each with the reason:

- **WS-5.1, second half — closed 2026-09-20** (see below). Settings no longer
  mounts the notebook browser or the amendments inbox; it keeps the switches and
  deep-links into Learn.
- **WS-5.3, breadth — mostly closed by the 2026-09-20 audit.** The sweep did the
  parts with signal: 40 dead `.status-surface`/`.analysis-card` tokens across 30
  files (they matched no CSS rule, and two comments cited them as if they still
  colored anything), TradeLog's outcome/verdict chips through `StatusPill`,
  LiveMarket's connection badge (a three-deep nested ternary), the remaining
  ~14 genuinely hand-rolled status chips across the dashboards, automation, desk
  and settings surfaces, seven hand-rolled empty states through `EmptyState`,
  and `tabular-nums` on the numeric readouts that were missing it.
  Deliberately NOT converted, with the reason: kind chips that need hues the
  five tones cannot express (sky/violet), one solid-fill badge, and every
  clickable control wearing semantic color — `StatusPill` renders a span, so
  converting a button would drop its click.
- **WS-4.1 follow-through — done, with two corrections.** Removed after
  verifying zero callers: `GenericAnalysisService.updateGlobalMemory` (+ its
  private schema), `memoryUtils.prepareTradeSummariesForGlobalMemory`,
  `harnessLessons.isWireRoutePinnedOff`, an unused `listHarnessLessons` import.
  Two items the audit had flagged as dead were **not** dead —
  `consolidateMemory` is imported by `AlgorithmicMemoryService`, and
  `lessonsForClass` is a tested accessor — so both were kept. The rotting
  top-level `insightKnowledgeBase` row and the duplicated
  `aiPatternMemory`/`insightKnowledgeBase` write are documented, not removed:
  the first is four files of state plumbing for no visible gain, the second is
  a retrieval-quality decision, not a deletion.
- **Health-tab false alarm — fixed, nothing left.** The selector had counted the
  curated book-seed corpus (12 skills, 0W/0L by design) as "untested" and
  "stale", so a healthy default workspace rendered an amber "13 skills with no
  counted evidence" flag. Seeds now have their own bucket and cannot raise a
  flag.
- **WS-3.4 placement — closed 2026-09-20** (see below). Stats render on the
  roster rail and the active bot's header.
- **WS-6 details — closed 2026-09-20** (see below). `/` focuses the rail search
  and the rail became a real drawer below `md`.
- **Unverified in a browser:** the provenance strip needs a real analysis run
  with a configured provider to render, so it is covered by jsdom only (6
  tests, including the next-run leak guard).

## Closed 2026-09-20

Three items the previous pass listed as deliberately left are now done. The
pass found real defects in the work — a stale premise, a broken mobile layout,
a deep link that overreached — all fixed here and recorded below.

- **WS-3.4 — per-bot learning stats on the rail.** `loadBotLearningStats()`
  (already committed) is now wired: App memoizes it on `[bots, memoryNonce]`,
  where `memoryNonce` bumps on any notebook write, so it reads the notebook on
  writes rather than once a price tick. A mono skills count badges each row; the
  active bot's header shows `lessons · skills · evidence` with the newest lesson
  date in its title. Learn → Health keeps the table version.
- **WS-6 — `/` focuses the rail search, and the rail is a drawer below `md`.**
  The plan skipped this because `/` was "already bound to the dock composer" —
  it is not: `id="chat-composer"` was deleted in 78bc027, and the app-wide
  clause in `useConversationHousekeeping` that looked it up is now deleted (it
  had been a permanent no-op for ~20 commits). Focus lands
  from an effect after the open commits; `rAF` and `flushSync` were both tried
  and both measured (at 531px) calling `focus()` while the subtree was still
  `visibility: hidden`, which silently drops it. A closed drawer is `invisible`
  rather than merely off-canvas, so it stays out of the tab order.
- **WS-5.1 — Settings keeps only the switches.** `MemoryFilesManager` and
  `AmendmentsInbox` are no longer mounted in Settings (Learn owns both), and
  Settings deep-links to a chosen Learn tab. `initialTab` follows the contract
  the Journal already uses: the caller clears it via
  `onInitialTabConsumed`, because a sticky prop re-applied on every remount and
  quietly overrode the tab the user last chose.
- **Defect: the rail was not a flex container below `md`.** The rewrite left
  `flex-col` with only `md:flex`, so on mobile the aside computed
  `display: block` and the list's `flex-1 min-h-0` was inert — the roster
  overflowed the viewport instead of scrolling. Verified fixed in the browser:
  the scroll pane now resolves `flex: 1 1 0%` inside a 550px panel.

Browser verification ran in a backgrounded tab, so computed styles and the
CSSOM were measured (including that `.md\:visible` sorts after `.invisible`,
which keeps the desktop column unaffected) but no screenshot was possible. The
live-provider end-to-end run remains the only unverified claim in this plan.

## Audit 2026-09-20 — every claim re-checked against code

The checkmarks above were verified against the code instead of trusted. Twelve
of them were wrong, thinner than stated, or resting on a premise that no longer
held. Each entry: what was claimed, what the code actually did.

1. **WS-1.1** the loop test's demotion step hand-fed `recordEvalVerdict` a
   verdict string. The producer — `evaluateSkill` — was never exercised by the
   suite that exists to prove the loop closes. It runs the real eval now, with
   only the analysis runner mocked.
2. **WS-2.2** this file says `SupervisorVerdictSchema` was extended for
   rescope/contradiction. It was not (checked against the commit); actuation
   reuses `enhance` plus a rewritten clause through the same `validateIfThen`
   and prediction gates. Behaviourally what was asked for, so the claim is
   corrected here rather than the schema churned for a name.
3. **WS-2.4** the budget was per-PASS only: 12 calls every 10-second debounce is
   not a budget. `MAX_ITEMS_PER_SESSION` (40) bounds the session now and
   announces itself when it stops a sweep; a human's Run bypasses it.
4. **WS-2.3** `whyAccepted` was persisted and rendered by zero components, so the
   audit trail still evaporated on reload — and nothing recorded WHO approved.
   `SkillMeta.approvedBy` is written per caller and shown on the skill with a
   two-step Undo approval.
5. **WS-3.1** bots retrieved on a forked coin regex (a strictly weaker query than
   the analyst seat beside them); `memoryScope` was hardcoded `'global'` at both
   turn sites because `AgentBot` had no such field; and retrieval recorded with
   `runId: undefined` while a second, uncapped source list logged files the
   budget had already dropped. All fixed, and bot reply rows now carry
   `runStats.runId` — the key `trade.sourceRunId` copies from — without which no
   bot trade could ever credit a skill. Side effect, stated plainly: bot turns
   are now subject to the ε-holdout.
6. **WS-3.2** a scheduled routine turn wrote nothing, and a trade logged from a
   bot's reply reached the notebook with no author. Both wired.
7. **WS-3.3** the `from @BotName` label was in the retrieval text but no test
   asserted it reached a prompt. One does.
8. **WS-3.4** the "synced with notebook" affordance existed in no form. There is
   a pill reading the bot's scope and newest lesson, the scope is settable in the
   bot dialog, and the empty state no longer tells an isolated bot it reads the
   shared book.
9. **WS-4** no graveyard sweep existed; the contradiction sweep reported to
   `console.log` so its outcome never reached the health log; two of the health
   selector's five signals were missing (a days-since-EDIT proxy stood in for
   days-since-HIT, and a standing-but-challenged belief was invisible). Closed,
   with one honest non-fix: consolidation stays per-write because the prune and
   aggregate provably run there.
10. **WS-5.1** Learn was not the one surface — the Journal still carried a tab
    labelled "Learn" rendering `LearningDashboard`, and the graveyard view named
    in the plan was a number. Both closed; `#/journal/learning` redirects.
11. **WS-5.2** one of four promised panel extractions existed; five more blocks
    are now modules and the file is 2,206 → 2,051 lines. The "autopilot banner"
    the plan names is not in that file at all (it lives in App +
    `OutcomeMismatchModal`); the proposal card that feeds the autopilot was
    treated as the intended target. "auto-approved by supervisor — undo" existed
    nowhere; the honest version sits on the skill, since the approvals drawer by
    design shows only what the model did NOT decide.
12. **WS-6** the rail spec was largely unimplemented: no collapse handle, no sort
    control, no Chart AI row — and that pane rendered a hard-coded empty array,
    so the plan's stated hard requirement that both surfaces show the same
    conversation was false — the Coach shortcut selected a thread the surface had
    no pane for, bots could not be renamed, the status dot was the string
    "desk online", and rooms could not be pinned. All closed; the composer's
    model chip now hosts the real picker instead of navigating to Settings.

13. **WS-2 acceptance was tested through the wrong door.** Every supervisor test
    called `runSupervisorPass(user, { manual: true })` — that is the "Run now"
    button, so the suite proved the mechanism while the plan's actual claim
    ("zero REQUIRED human actions") rode on triggers nothing exercised: the
    queue-event debounce and the boot sweep. `tests/supervisorAutonomy.test.tsx`
    now proves the drain with no hand on the button, and proves the other half
    of the acceptance line too — auto paused leaves everything queued *and*
    human-reachable.

## Still open after the audit

- **Attach-image in the Agents composer — closed.** The dock's reader was lifted
  out of `TradeChatPanel` into `hooks/useChatAttachments` and both composers use
  it; the paperclip is enabled in Analyze mode only, because a bot DM turn has
  no image transport and offering it there would drop the file silently.
- **WS-5.4 motion — closed.** Nine literal copies of `--ease-snappy` now
  reference the token, and 36 out-of-range durations came into 0.12–0.18s.
  Left alone deliberately: data-bar and progress fills and LiveMarket's 300ms
  price tick (three of which are strings assigned from the WebSocket handler and
  must stay byte-identical to the JSX default), and every keyframe. Two drawers
  (VisionDataViewer, StrategySearch) carried a bare `cubic-bezier(…)` inside
  `className` — never a utility, so they had been sliding on the default ease
  while looking tuned; both reference the token now. `LiveStreamView`'s card used
  `transition-all` while its text grows a chunk at a time, the exact layout
  shift this section forbids; it is colour-scoped now.
- **No right-click context menu** on rail rows: pin, rename, routines and delete
  are hover icons, which is what the rail this surface replaced always did.
- **Density.** `ModelPerformanceDashboard`'s model cards and the stat tiles in
  `ProbabilityPanel`/`ScenarioSimulator` are still tiles for tabular data. The
  skill library is a table now.
- **`LearningDashboard` is decomposed.** WS-5.1 said "LearningDashboard (67 KB —
  split into cards)". It now lives in `components/dashboards/learning/` as eleven
  modules: the five sections (Memory Graph, Harness, Notebook, Lessons, Skill
  Review), the profile branch's three blocks (header + meta-calibration, the
  13-card grid, setups + calibration), and `StatCard` / `CalibrationBar` /
  `shared.ts` (the regime list and the win-rate ramp). `LearningDashboard.tsx`
  is 208 lines of loading and derivation; each card owns its own filters and
  took the memos only it consumed. Rendering identity was proven, not assumed: a
  scratch A/B test mounted HEAD's monolith beside the split over a seeded
  notebook and six trades, and compared `container.innerHTML` for the default
  view, an expanded lesson, all three memory-graph tabs and a switched time
  window — equal in every case; renaming one card title made all three cases
  fail, so the check has teeth. The scratch pair is not committed;
  `tests/learningDashboard.test.tsx` remains the permanent smoke test.
- **File locations.** `MemoryFilesManager.tsx` and `AmendmentsInbox.tsx` still
  live under `components/settings/` although only Learn mounts them.
- **Unverified:** a live run against a configured provider — the only claim in
  this plan that jsdom cannot settle.

## Status (2026-09-20, post-audit)

All seven workstreams are implemented. `typecheck` clean, **3385 tests** green
(362 files), `lint` 0 errors, `build` clean. The Learn surface, the Agents rail
(collapse, sort, Chart AI row, rooms pinning, composer attach), the graveyard
view and the skills table were checked in a real browser; the skills TABLE itself
is covered by the Strategy Studio suites, not by eye, because the profile loaded
for that session had no playbooks to row.

What is left is listed under "Still open after the audit" and
"Still open", each with its reason. The only claim this plan cannot settle in
jsdom is the live provider run.

Five defects the loop test exposed, all fixed:
1. **Cold-start deadlock** — an approved skill could never earn evidence
   because evidence required injection and injection required evidence.
2. **Draft id collisions** — `sk-${Date.now()}` was not unique, so
   `takeSkillDraft` deleted every twin queued in the same millisecond
   unsupervised. Silent learning loss.
3. **Bot lesson write/read drift** — the writer derived `bots-<raw id>` while
   the reader derives `bots-<slugified id>`; any id differing under
   `slugifyName` wrote lessons the bot could never read back.
4. **Memory poisoning** — bot turns fed raw chat replies to
   `extractLessonFromPostMortem`, whose prose fallback turned any 20-char
   sentence (including refusals) into a permanent lesson re-injected into that
   bot's future prompts.
5. **Unbounded spend** — every bot turn re-folded the same closed trades, and
   the worth-gate leg of that fold is a live LLM call that re-fires whenever a
   cluster still has no matching skill.

