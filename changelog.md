# Changelog

Plain-English log of change rounds. Newest first.

---

## ROUND-54 extension 4 — reviewer follow-ups: dead code, per-file import, sweep backoff

Follow-ups from the R54 independent code review (all non-blocking
suggestions, now landed):

- **Merge artifacts deleted.** `TeamDialog.tsx` (unreferenced since the
  Team→Group merge) and `BotDetail.tsx` (unreferenced since bots open
  straight into chat) are gone from disk along with their now-dead
  component tests and the unused lazy import in App. The Team-UI
  behaviors they covered (role picker, Inherit, seat prompt editing)
  live on the NewBotDialog persona section — which now has its own test.
- **Skill import never sinks a batch on one bad file.** `readSkillFiles`
  returns per-file outcomes (`Promise.allSettled`): read failures carry
  a reason and surface as normal import-failure toasts while the
  readable rest of the batch still imports. Test covers a 2-file pick
  with one unreadable file.
- **Trigger-less skills dedupe on title.** Frontmatter without
  `ifCondition` previously bypassed dedupe entirely; the import key now
  falls back to the normalized first `# heading`, so the same skill
  can't be re-imported under shuffled file names.
- **Model catalog sweep retries sooner after a total failure.** A sweep
  where EVERY ready provider failed (e.g. booted offline) persists
  `lastSweepFailed`, shrinking the next window from 6h to 15min —
  stale model dropdowns no longer pin for six hours. Partial failures
  keep the normal 6h gap. Tests cover the total-failure retry and the
  partial-failure exclusion.

Gates: tsc 0 · **2013 passed / 11 skipped** · build clean · eslint 0
errors · dev boot 200.

---

## ROUND-54 extension 3 — bot failure visibility + reasoning-budget starvation fix

- **Why "(Raven could not reply — provider error)" appeared while models
  worked elsewhere.** Two distinct failure modes were both rendered as
  generic errors:
  1. The room/DM turns run through the STREAMING transport
     (`streamQuickResponse` → `streamViaProxy` on dev), which — unlike the
     non-streaming `sendChatRequest` — had NO retry: one 429/network blip
     killed the turn instantly, and the catch threw the real message away.
     Now `streamViaProxy` retries the stream OPEN via `withRetry` (3
     attempts, same backoff as non-streaming), and both `useAgentGroups`
     and `useBotMailbox` put the transport's user-safe reason INTO the
     bubble and the activity feed instead of "provider error".
  2. "I am sorry, I could not generate a response." was a lie: the stream
     completed cleanly (HTTP 200), but a reasoning model burned the whole
     chat budget (2048 max_tokens) inside its hidden chain of thought and
     never emitted visible text — gateways that ignore `reasoning_effort`
     make this routine. `streamQuickResponse` now detects exactly that
     (zero visible + reasoning seen + not aborted), retries ONCE with a
     doubled budget, and if it still lands empty the fallback says the
     model spent its budget on hidden reasoning instead of claiming it
     "could not generate".
- **Where the truth already lived:** Settings → Providers shows each
  provider's persisted `lastError` (ProviderHealthService) and the roster
  ⚠ tooltip classifies it — the new bubble text just surfaces it inline.

Gates: tsc 0 · **2013 passed / 11 skipped** (4 new regression tests) ·
build clean · eslint 0 errors.

---

## ROUND-54 extension 2 — group room: cancel, hybrid toggle, reference reply styling

- **Cancel a group request.** While a room round runs, the composer's
  New Thread button becomes **Stop** (and an inline Stop sits next to
  the "X is thinking…" line). Stopping aborts the in-flight stream, the
  round loop bails at the next member boundary, partial bubbles are
  finalized (kept when they have content, hidden when empty), and the
  activity feed records "Room passed (cancelled)". Implementation:
  `useAgentGroups` gains an `AbortController` per run + a public
  `cancelRun` (nonce bump + abort).
- **Toggleable Hybrid Intelligence for the room.** The group header has
  a **Hybrid** switch (shares the main hybrid setting). When ON, live
  market data is fetched ONCE per send and the enhanced packet
  injection is appended to EVERY member's system prompt — the whole
  room reasons over the same live read. Fetch failures fall back to
  plain prompts; the room never blocks on it.
- **Reference reply styling.** Member replies now render as Markdown on
  the canvas (bold headers/labels like the reference's BTC reads) with
  a hover **copy** icon at the row's right — matching the Hermes group
  screenshots. The title-links/`onOpenTeam` prop (a Team-era artifact)
  is gone with the Team merge.

Gates: tsc 0 · **2020 passed / 11 skipped** · build clean · eslint 0
errors · dev boot 200.

---

## ROUND-54 extension — Team→Group merge, group-tabs-only strip, member personas, skill import

- **Team and Group are now ONE concept — the Group.** The group UI
  (Activity timeline, reply-in-thread, member tabs, gear/trash) is kept
  as-is; Team's features merged into it; every Team surface removed:
  - `ThreadSelection` no longer has a `team` kind; defaults land on the
    Coach inbox instead. The Team tab is gone from `ThreadTabs` (strip =
    group tabs only, rendered only inside group threads).
  - The roster rail has no Team row and no New Team menu entry; groups
    gain a hover **gear** that opens the group editor (membership +
    member personas). TeamDialog is no longer imported by App (file kept,
    unreferenced); team state/handlers (`teams`, `activeTeamId`,
    `activateTeam`, `syncTeamToHarness`, dialog open state) deleted.
  - Debate personas now come from **group members**: each bot carries
    `role` + `instructions` (set via the New Bot dialog's Debate persona
    section or group editing); `useAnalysisPipeline` keys personas by
    provider+model across all groups — any group send debates with the
    room's member roles/instructions. Opening a group still re-arms the
    ensemble. (Team store code retained for data migration only.)
- **Skill import.** Settings → Skills gains **⬆ Import**: pick one or
  many `.md` files; each is validated (skill frontmatter required),
  deduped by trigger, name-unique (`-2`, `-3`… on collisions), and
  written into the harness skills folder — so imported skills are usable
  by the models in debates immediately. Outcomes surface as toasts:
  imported count, per-file failure reasons (nothing silently dropped),
  duplicates-skipped notice. New `SkillImportService` + 4 tests.

Gates: tsc 0 · **2010 passed / 11 skipped** · build clean · eslint 0
errors · dev boot 200.

---

## ROUND-54 — Bot Mode UI parity: unified sidebar panes, thread tabs, bot page, room actions

The six Hermes Bot Mode screenshots as the reference; the app's chat
surface rebuilt to match, in four slices:

- **Unified sidebar (SESSIONS | BOTS | TERMINAL).** The desktop sidebar
  and the old second-column roster rail merged into one column with
  underline tabs (persisted via `useSidebarPane`, same pattern as the
  chat/floor toggle). BOTS embeds the full roster rail
  (`variant="embedded"` — transparent, no docked footer); TERMINAL is
  the background-jobs status stack (`JobsPane`, extracted from
  JobsDrawer, which now shares the same body). Floor mode and the
  collapsed rail fall back to the classic sessions body; the mobile
  drawer is byte-identical to before.
- **Open-thread document tabs.** A tab strip above the chat — Team,
  Coach, one tab per bot, one per group — mirroring the reference's
  `• BOT CHAT / • NEW SESSION` docs. Hidden in floor mode.
- **Bot detail page.** Opening a fresh 1:1 shows the reference's bot
  page first: large avatar, `Bot · @handle` (mono), description,
  "This device" host chip, Open chat. Dismissed per bot for the
  session; a 1:1 with history skips straight to the conversation.
- **New Bot dialog: Upload tab.** Faces / Upload / Pixel; an uploaded
  image is downscaled to a 96px cover-cropped data URL (localStorage
  quota safe) and clipped to circle/square/blob. Dialog copy matches
  the reference ("own memory, skills, and chat… can message your other
  agents"); description textarea deepened.
- **Room UX.** Group header gains gear + trash (gear reuses the New
  Group dialog as Group Settings — membership edits update the room,
  transcript untouched; `updateGroup` added to the roster store). The
  title links to the Team transcript. "Reply in thread" opens an inline
  composer under a prompt and runs a direct @everyone round — members'
  incremental context carries the prior thread, so it continues in
  place (no derived-thread surgery).
- **Model side-effect status rows (Hermes transcript parity).** When a
  seat proposes a tool (`forge_tool`), amends memory (`amend_memory`),
  or runs a forged/custom tool, the desk-tool loop now persists a
  `ToolAction` ledger on the message (`toolActions`, capped at 50) and
  the analysis bubble renders Hermes-style status rows: "Memory
  amendment proposed — review in Settings → Memory", "Desk tools
  proposed — review in Settings → AI Models" with count chips and seat
  names, and a ⚠ "rejected — nothing stored" row for failed proposals.
  Data lookups stay out (reads, not changes). Wired through all three
  run phases: openings (per-seat `analyzeTradingView`), debate rounds +
  every moderator call (`conductRealDebate`/`conductDebate` opts bag),
  and reset per run.
- **Skills + notebook writes join the ledger.** The post-mortem flow's
  three model-driven writes now surface the same way on the
  post-mortem bubble: evidence-backed skills created by the IF/THEN
  auto-ingest ("Skill created from evidence — slug"), the LLM-crafted
  skill draft ("Skill draft queued — review with the Coach"), and the
  AI-authored notebook note ("Notebook created/appended —
  folder/file"). The chat quick-save ("save this to the notebook")
  carries its status row too. Ledger appends go through one shared
  helper (`utils/toolActions.ts`) so every writer caps and persists
  identically.
- **Thinking rows restyled to the reference.** Settled collapsed rows are
  now a bare quiet `Thought ›` line — no lightbulb icon, no duration, no
  first-line preview, no "Show full reasoning" affordance, no box —
  blending into the transcript exactly like the reference. While
  streaming the row reads `Thinking · Ns` with the live ticker and
  bouncing dots; expanded it becomes the boxed, scrollable trace with
  Show more/less (unchanged). Custom labels ("Moderator thinking",
  "Thinking · N traces") are preserved verbatim; only the default label
  flips Thinking ↔ Thought with state. Applies everywhere ReasoningRow
  renders (chat bubble, debate replay, side panel).

- **TERMINAL sidebar tab removed** (user call: useless — the same
  background-jobs status stack lives in the header's Jobs drawer). The
  sidebar is now SESSIONS | BOTS; a stale stored 'terminal' value
  migrates to sessions, `JobsPane` is folded back into `JobsDrawer`
  (single surface again).
- **Message presentation to the reference pattern.** User prompts are
  now full-width, left-aligned cards — subtle panel, "You · time"
  header (DM badge inline) — instead of right-aligned plain text /
  right bubbles; this was THE gap that made the chat not match the
  reference. AI replies stay flat on the canvas. Group threads use the
  same card with the Reply-in-thread link inside it. The floating
  Hybrid Intelligence widget no longer hovers over the fresh welcome
  canvas (it returns once the conversation has content).

- **Sessions removed from the sidebar.** The desktop sidebar is the BOTS
  roster, full stop — the SESSIONS tab is gone (conversation history
  stays reachable through the header's history affordances). Floor
  mode / mobile drawer / collapsed rail still fall back to the legacy
  sessions body so no surface goes empty.
- **Model catalogs stay fresh automatically.** New
  `useModelCatalogRefresh`: on boot (+ every 6h) each ready provider's
  /models endpoint is queried and newly discovered ids merge into the
  config via the same update path Settings uses — so the composer
  selector, New Bot dialog, team seats, and automation editor all show
  the provider's CURRENT models without visiting Settings. Merge-only
  (manual additions survive), failures silent (offline keeps the
  stored list authoritative), staggered per provider.
- **Team seats: role inheritance is explicit.** Picking a role for a
  seat keeps inheriting the built-in role prompt at runtime (unchanged
  behavior) AND gains an **Inherit** button that copies the role's full
  prompt into the instructions box as editable text — refine it freely;
  the seat runs role + instructions (instructions win on conflict).
  No Inherit on the general-analyst default (nothing to copy).

Tests: +47 net across the round. Gates: tsc 0 · 2013 passed /
11 skipped · build clean · eslint 0 errors (whole dirty tree).

---

## ROUND-53 — Learning flow: seat diversity, ToolForge, manual A/B eval, memory self-correction

Four upgrades to how the harness learns and what the models may build:

- **Unroled team seats now diverge.** A 4–10 seat team left on "General
  analyst" gave every seat the same default mandate — N seats produced
  near-identical reads. Unroled seats rotate a FOCUS DIMENSION
  (structure → entry mechanics → risk/invalidation → momentum/regime →
  liquidity/positioning → macro context), stable per seat index; roled
  seats are unchanged.
- **ToolForge — models can create tools.** Any seat (or the arbiter)
  can call `forge_tool` to propose a new desk tool as a DECLARATIVE
  HTTP RECIPE — URL template, param mapping, JSONPath extract. No code
  execution, ever. The harness hardens proposals (https-only, SSRF
  guards, header rules, response caps, per-tool cache TTL) and stores
  them as CANDIDATES; a human approves network access in
  Settings → Skills → Forged tools before a tool can run. Confirmed
  tools merge into every seat's tool loop (`custom_*` executor with
  size caps + failure counting); stats drive retire decisions.
- **Manual skill A/B eval.** Skill detail gains "Run A/B eval" — the
  same with-skill/without-skill comparison the auto-scheduler runs,
  on demand, writing the same verdict ledger (helps/hurts streaks can
  promote or demote). Requires a memory model.
- **Memory self-correction.** New `amend_memory` desk tool: models can
  PROPOSE corrections to non-auto notebook files (edit = replace body,
  supersede = append a provenance-stamped correction section).
  Proposals land in Settings → Memory's review inbox — auto-managed
  files are unamendable, identical content is rejected, approvals apply
  through the notebook write lock, rejections are tombstoned.

UX wiring: every proposal fires a toast the moment it lands ("approve
in Settings → …"), and the Settings nav shows pending counts on the
Skills (forged tools) and Memory (amendments) tabs — nothing waits in
silence. Tool calls themselves already render as live chips in the
transcript via `onToolEvent`. Seat personas are now VISIBLE: the run
ledger carries each seat's role short name (or, for unroled seats, the
focus dimension), rendered as a tag beside the seat name on the floor,
in the transcript's actor cards, and in the rail's team-row subtitle
("Macro · Technical · Risk"). The floor squawk also prints seat
activity from the debate run log (rounds, drops, charges) and per-turn
working/passed/replied lines — the desk reads alive, reference parity.

Tests: toolForge (13), memoryAmendments (5), seatPersonas (+dim),
stageActors role/focus tags, teamSlots roleTag, plus catalog updates.
Gates: tsc 0 · 1966 passed / 11 skipped · build clean.

---

## ROUND-52 — Teams: seat roles, the 3-provider cap removed, living defaults

The Standard-mode debate blocked at 3 providers even though teams seat
up to 10 — the stale cap now matches the Team menu (`TEAM_MAX_SEATS`,
with the same pod-tier engine handling 6+ seats that was already
wired). Before creating a team, each seat gets a **role** (Macro,
Technical, Risk — inheriting that role's built-in debate prompt) and
optional **trader instructions**; both are editable later. A seat with
no role and no instructions isn't empty — it defaults to a
general-analyst mandate: analyze the market across all dimensions, aim
for the strongest actionable signal, ground everything in real data
via desk tools and web search (`web_search` is a registered desk tool
every seat can already call). Personas ride the whole run: the seat
directive in the openings phase, a per-seat prefix in the rebuttal
rounds (`conductRealDebate` gained `seatPersonas`, keyed by seat
name), and role-scoped tool presets (`defaultToolsForRole`) on the
opening call. A mid-debate replacement steps INTO the dropped seat's
persona under its own name. Ad-hoc ensembles (no active team) keep the
legacy 3-rotation mandate — no behavior change there. Also fixed the
rail avatar stacks bleeding over team names (properly sized 52px/46px
containers; group rows likewise). New: `services/agents/seatPersonas.ts`;
tests in `tests/seatPersonas.test.ts` (7), `tests/teamDialog.test.tsx`
(+4), `tests/debateFlow.test.ts` (+1). Gates: tsc 0 · 1948 passed /
11 skipped · build clean · eslint 0 errors.

---

## ROUND-51 — Bot Mode G2–G5: rooms, attention badges, @mentions, bot Routines

Finished the port plan (`.hermes/plans/botmode-scan-and-plan.md`): group
rooms become real coordination, bots surface their own failure states,
the composer knows the roster, and a bot can own a schedule.

- **G2 room rounds — `services/agents/groupRounds.ts` (new, pure)** —
  the Hermes room engine: bounded round-robin rounds per user send,
  speakers chosen by a deterministic @mention parse (name/title/no-space
  forms, @everyone), replying exactly `(pass)` (or nothing/failing) is
  silence, and a round where everyone passed = settled. Per-member
  `lastSeenIndex` into the room log feeds each turn only what it hasn't
  seen (incremental context — what makes multi-round cheap).
  `hooks/useAgentGroups.ts` is rewritten onto the engine; `Message.hidden`
  + a GroupChatView filter keep passed turns out of the transcript while
  preserving thread attribution.
- **G3 needs-attention badges — `services/agents/botAttention.ts` (new,
  pure)** — `classifyBotAttention` over ProviderConfig +
  ProviderHealthService telemetry: no_provider / model_missing / no_key /
  disabled outrank transient auth / quota / benched. AgentRosterRail rows
  show a ⚠ badge with the one-line fix hint as tooltip (attentionMap
  computed in App).
- **G4 @mention autocomplete (ChatInput)** — mention chips now derive
  from the live roster via `botHandle()`; the old localStorage hack
  truncated "Risk Bot" to "@Risk", which no parser matched. Un-gated
  from ensemble mode — mentions work in every chat surface.
- **G5 bot-scoped Routines** — `AutomationConfig` gains optional
  `botId`: the run executes AS that bot instead of the ensemble
  pipeline. `services/agents/botRoutine.ts` (new, pure executor):
  persona via `buildBotSystemPrompt`, the bot's own provider/model over
  `streamQuickResponse`, reply persisted as an AI row attributed to the
  bot's identity pair (threadForProvider files it into the bot's 1:1),
  `[[dm:@…]]` markers stripped and delivered through the mailbox (one
  hop below a direct DM turn). Dangling bot / unconfigured provider /
  missing prompt = VISIBLE skipped runs (reason stored on the run +
  toast), never silent no-shows; ensemble automations are untouched.
  Editor gets a "Run as bot" SelectMenu (ensemble seats hidden and
  cleared while a bot is selected); the rail shows a Routines
  disclosure on a bot's row (schedule peek + Run now). App wires the
  automations hook to Bot Mode via a fire-time roster getter + mailbox
  DM delivery. AutomationRunCard renders bot-run cards properly: the
  persona reply in the bubble labeled "Bot reply" (was an empty
  "Neutral" card), skipped runs surface their reason in the body with
  it as the badge tooltip, outcome buttons stay analysis-gated.

Tests: `tests/groupRounds.test.ts` (12) + room tests in
`tests/agentGroups.test.tsx` (G2), `tests/botAttention.test.ts` (6, also
tsc-fixed), `tests/chatInputTalkTo.test.tsx` (+4, G4),
`tests/botRoutine.test.ts` (9) + `tests/automationBotRoutine.test.tsx`
(5) + `tests/botRoutinesUI.test.tsx` (9) — readiness/skip doctrine,
persona turn, marker strip + delivery, ensemble isolation, editor
gating, rail disclosure, run-card bot/skip/ensemble rendering. Gates:
tsc 0 · 1936 passed/11 skipped · build clean · eslint 0 errors on
touched files (new files fully clean).

---

## ROUND-50 — Bot Mode G1: teammate DMs (the Grok/Hermes heartbeat)

Deep-scanned Hermes Bot Mode at source level (plugin
`apps/desktop/src/plugins/hermes-bots/`, core `tools/bot_mode_probe.py`,
`bot_mode_dm.py`, `tools/bot_relay.py`, AGENTS.md §Bot Mode) and Grok Bot
(xAI's "AI teammates" that share a cloud computer and text each other).
Wrote the mechanism map + port plan to `.hermes/plans/botmode-scan-and-plan.md`
(G1–G5). Implemented **G1 — teammate DMs**, the headline behavior:

- **`services/agents/botMailbox.ts` (new, pure half)** — `[[dm:@handle]] text`
  marker grammar (line-scoped body so prose after a marker stays in the
  bubble), roster-handle resolution (exact / collapsed / title, Hermes
  parity), `validateDM` with visible refusals (unknown target, self-DM,
  unreachable provider, hop cap, TTL, rate budget, malformed — a lost DM
  is the bug class Hermes's #93091 fixed), the byte-stable teammate
  protocol section (roster as `- @handle — role` lines, "fire-and-forget
  like texting, never predict a teammate's answer"), and
  `buildBotSystemPrompt` (persona system.md + notes memory.md + protocol —
  also fixes the pre-existing gap where bot threads used the generic
  assistant prompt).
- **`hooks/useBotMailbox.ts` (new, async half)** — per-target serial queues
  (Hermes's per-profile lock, in-memory since august's bots are
  in-process), 15-min envelope TTL checked at drain, 12/min global budget,
  3-hop chain cap. A DM runs the target's turn with its persona over its
  own thread; the reply lands in the target thread AND wakes the sender's
  thread with a "↩ replied to your DM" notice — the completion-notification
  shape, never auto-running the sender.
- **Pipeline (casual branch)** — bot-thread sends run AS the bot: exact
  provider+model, persona system prompt, thread-scoped history
  (`threadForProvider`), and the settled reply is handed to the mailbox to
  strip markers + deliver. Outside bot threads behavior is byte-identical
  to before. Bridge via `getActiveBot`/`onBotReply` refs (roster state is
  declared below the pipeline hook).
- **Transcript** — DM rows badge as "DM · teammate" (never read as the
  trader speaking); notices are attributed system rows; the rail's
  working-pulse merges draining DM queues.

Tests: `tests/botMailbox.test.ts` (13: grammar, resolution, refusals,
hop cap, protocol byte-stability) + `tests/botMailboxAsync.test.ts` (7:
wake-up notice, marker strip + next hop, TTL expiry, idempotent dispatch,
provider-not-ready fallback). Gates: tsc 0 · 1889 passed/11 skipped ·
build clean · eslint 0 errors.

---

## ROUND-49 — Reference-parity UI pass + Coach thread (§10.1)

Target: the Hermes-style reference screenshot (flat dark rows, fill-hover
selection, checkmark on the current row, avatar+name+time+preview list,
status-icon vocabulary). Gates: tsc 0, **1869 passed / 11 skipped / 0
failed**, build clean, eslint 0 errors on touched files.

- **New `components/shared/SelectMenu.tsx`** — the reference-styled dropdown:
  bare trigger, portal listbox, 13px rows, selection by background fill,
  check glyph on the current row, right-aligned muted meta, section labels,
  full keyboard (arrows/Enter/Escape, focus wraps), viewport flip. Optional
  `triggerClassName` for boxed form usage.
- **Native `<select>` popups replaced** (their OS-white chrome broke the
  dark theme): ChatInput's Talk-to (now Team / Bots / Models sections with
  model meta instead of the `─── models ───` hack), NewBotDialog provider +
  model, TeamDialog seat provider/model ×N + moderator pair. Tests rewritten
  to drive the listbox via `data-option` (teamDialog's "invalid seat" case
  now points a seat at a model-less provider — menus can't select '').
- **Monochrome fixes:** ModelPicker's cyan "free only" checkbox → zinc;
  the roster's "is working" emerald pulse now sits inside a `status-surface`
  scope so it renders as intended; roster "+" menu glyphs (☻ ⚿ ⚔) → lucide
  Bot/Users/Swords icons.
- **§10.1 Coach thread — built.** `ThreadSelection` gains `kind:'coach'`;
  the roster rail gets a Coach row (GraduationCap avatar, unread badge =
  drafts + queue proposals waiting, "in sync" when zero, preview line);
  `components/chat/CoachThreadPanel` (lazy) renders the learning loop's
  inbox as cards in the reference vocabulary — drafts (If→then clauses,
  Save-as-skill / Discard routed through App's existing ingest + tombstone
  handlers, "View the trade" jumps back to the highlighted verdict card)
  and proposals (Apply for displacement/revival/demote via the ROUND-48
  actuation paths, Dismiss for the human-edit kinds). Live on the same
  `august-skill-drafts` / `august-learning-queue` events. 8 tests
  (tests/coachThread.test.tsx). The coach thread is exempt from the
  last-opened marking effect (its badge is a backlog count, not unread
  messages).
- **Learning/memory/skill loop wiring re-verified end-to-end:** verdict →
  citations (F1) → adherence (P0-2 runId join) → evidence ladder + birth
  claim (P0-3) → proposals → Coach thread + Settings→Skills queue panel
  (P0-1) → apply paths → notebook. Drafts → Inbox + Coach cards → ingest.
  Pass mining → weekly sweep → drafts → same approval surface. Every queue
  now has a human-visible, human-actionable exit.

---

## ROUND-48 — Post-batch audit + review fixes: the learning loop's silent breaks

Full review of the uncommitted ROUND-41→47 work (plan batches 5–14): every
changelog claim re-verified against source, UI/UX wiring audited component by
component, three deep logic reviews. Gates after: tsc 0, **1861 passed / 11
skipped / 0 failed**, build clean, eslint 0 errors on all touched files.

**Wiring fixes (features that existed but never fired):**
- `annotateVerdictCitations` had ZERO callers → the `cited` field was never
  written → OVERRIDDEN adherence was dead. Now called at verdict commit
  (hooks/useAnalysisPipeline.ts), scoped to the run's own record via runId +
  a short settle wait so a slow Preferences write can't stamp the previous run.
- `runPassMiningSweep` (§8.2c) had zero callers → wired into the weekly boot
  pass (fire-and-forget, ≤5 kline fetches/sweep) + 8 regression tests
  (tests/passMining.test.ts: TP-first vs SL-first resolution, cluster→draft,
  no draft from misses, the splice guard below).
- Journal now surfaces the miss-cost counter-metric (`missCostLine`);
  WeeklyReviewCard now renders `digest.metaCalibration` (Brier / gate
  precision / refinement recovery) — both computed but never displayed.
- Boot passes read `loggedTradesRef` BEFORE the profile's trades loaded →
  moved after the load, `loadedTrades` passed directly (App.tsx).

**Logic bugs:**
- passMining upsert: `splice(findIndex(...), 1)` with findIndex = −1 deleted
  the LAST record (JS negative-index semantics). Guarded.
- PreReadGate re-gated every old settled card → latest-only via
  `context.latestMessageId`.
- SkillCitationChips / ContextDisclosure queried injections by createdAt
  only → later runs' records leaked into older cards. Bound by the message's
  own `finishedAt`.
- **§8.3a adherence join was inverted** (the big one): the window looked at
  records AFTER `trade.timestamp` — but the run that shaped the trade
  PREDATES the log click, so every followed skill was mislabeled CONTROL and
  no skill ever earned FOLLOWED credit. Replaced with an EXACT runId join:
  runId (= triggering user message id) now persists on the injection record,
  `runStats.runId`, and `trade.sourceRunId`; `skillAdherenceForRun` joins on
  it. Legacy trades/records without linkage keep full credit (UNKNOWN).
  skillHoldout fixtures moved to production timing + 2 new regression tests
  (later run must not steal attribution; legacy trade = UNKNOWN).
- `runContradictionSweep`'s queued count was discarded → logged like the
  other passes.

**P0 — the learning queue was write-only (§4.6 loop E):**
`listLearningProposals` had ZERO consumers — five subsystems (cap
displacement, graveyard revival, zero-evidence demote, re-scope ×3,
contradiction ×2) queued proposals into localStorage every week and nobody
could ever see or act on them. New `components/settings/LearningQueuePanel`
mounted in Settings → Skills: newest-first list, kind badges, Apply where a
deterministic actuation exists, Open-in-chat / Dismiss otherwise, live on the
`august-learning-queue` event. New apply paths in SkillMemoryService:
`applyRevivalProposal` (archive → live, as candidate — never straight to
confirmed), `applyDemoteProposal` (confirmed → candidate), and
`applyDisplacementProposal` now actually INSTALLS the challenger the gate
compared (its docstring promised this; the body only retired the incumbent).
6 tests (tests/learningQueueApply.test.ts).

**P0 — §8.2a birth certificate was never tested:**
`evaluateClaim` existed, was imported, and was called nowhere;
`claimTestedEvidence` was declared but never serialized or written. Now:
deriveStatus consumes the claim directly (an UNMET claim at horizon blocks
promotion; met/pending defer to the ladder), recordEvalVerdict tests the
claim each pass (stamps `claimTestedEvidence`, appends MET/UNMET/pending to
evalDetail), and the eval-promotion path honors an unmet claim. 7 tests
(tests/skillBirthClaim.test.ts).

**Dead code:** `skillInjectedSince` (zero callers; the dashboard derives the
same set inline) removed.

**Remaining scope (not defects):** §10.1 Coach thread (roster bot rendering
drafts + queue proposals as inline cards) and message search were claimed in
batch 13 but never built — the drafts/queue now have real surfaces (Inbox +
LearningQueuePanel), so the Coach thread is a convenience layer, not a
functional gap. Deferred pending user go-ahead.

---

## ROUND-47 — §8.4a–d: graveyard + retirement taxonomy, contradiction sweep, settled-belief challenge

**§8.4a + §8.4b — `services/learning/skillGraveyard.ts`:**
- Tombstone index per user (cap 40, newest-first): one line per retired skill —
  "tried X, retired: <reason> after N=<n>, lift <±pts>" — written at the
  archive sweep (retirement time), and injected into the WORTH GATE's context
  (capped 40, dynamic import; never into debates).
- Retirement taxonomy: `insufficient-evidence | regime-shifted | superseded |
  eval-hurts | user-veto`, mapped from the ledger's transition reason. The
  retire-band transition now stamps `regime-shifted` when the §8.5d sentinel
  sees a regime mix divergence, else `insufficient-evidence`; manual retire
  stamps `user-veto` (history + tombstone, not just 'manual').
- Creation dedup against the ARCHIVE (exact + token-shuffled trigger
  normalization) at both creation paths (worth-gate fold, crafted ingest) —
  a retired twin queues a REVIVAL review card with its re-entry rule instead
  of a silent re-creation; live dedup untouched.
- **§8.4c — `utils/contradictionSweep.ts`:** live skill pairs with ≥2 shared
  condition tokens AND conflicting action (opposite kind / opposite direction)
  → one deduped merge/priority proposal per pair, fired weekly beside the
  review (no LLM).
- **§8.4d — `services/learning/beliefChallenge.ts`:** per-slug rolling
  30-day counter for WIN trades whose direction contradicts the settled
  belief's claim (context-matched); ≥3 flags a review proposal — NEVER
  auto-invalidated.
- Tests (+26): graveyard exact/token-twins, tombstone lines + cap, reason
  mapping + re-entry rules, revival dedupe; sweep pair detection + dedupe;
  claim extraction, flag threshold, context/direction guards, status stays
  settled.

**ROUND-48 — Batch 6: §4.6 self-improvement loop A→E**
- **A extractor** (`extractEpisodes`): post-hoc, read-only, outcome-linked
  episodes from closed post-mortems (rootCauseClass, key lesson, clause),
  180-day retention. **B fingerprints**: failure class + setup identity,
  normalized (ids/numbers/paths stripped); stable cause = mineable;
  unclassifiable → `unknown:<first-line>`; ≥2 occurrences ⇒ flagged.
- **C judge gate**: extract-only by DEFAULT (no drafting at all) until a judge
  precision ≥ 0.8 over ≥ 30 samples is recorded (`recordJudgePrecision`).
- **D distill + queue**: deterministic three-way classification (no cover →
  create-draft via the existing skill-draft inbox; shallow overlap →
  amend-trigger proposal; deep overlap → amend-body Pitfalls-only proposal);
  one draft per fingerprint/action/target (dedupe ledger); pruning: zero
  evidence AND zero injection hits in 30 days ⇒ demote SUGGESTION (kind
  `demote`) — never automatic. Human gate = the existing
  approval-inbox/skill-draft + learning-proposal queues.
- **E measurement loop**: fingerprint↔skill linking (re-linkable later),
  `recurrence_after_install` credited, zero recurrence in 30 days ⇒ resolved
  (+ skill credited), recurrence auto-drafts a REVISION proposal (never a
  silent rewrite); metrics via `loadLearningMetrics`.
- Wired into the weekly review pass (offline, add-only). Tests (9) incl. the
  plan's end-to-end seeded chain: inject failure → fingerprint → flagged →
  draft → approve → simulate recurrence → revision proposal appears.

Gates (both rounds): tsc exit 0, 1832 passed / 11 skipped / 0 failed,
vite build clean.

---

## ROUND-46 — §8.5d regime-mix drift sentinel (stale-by-regime, not stale-by-time)

Time-decay is the only staleness axis skill evidence had; a fast crypto
regime shift is invisible to a 30-day age constant. The sentinel compares the
mix during which a skill's evidence accumulated against the market's current
30-day mix, and downweights divergent skills in retrieval — the main way a
whole library goes quietly wrong at once now has a tripwire.

- `utils/regimeSentinel.ts` — `skillEvidenceMixWeights` (regimeStats counts →
  weights, raw keys mapped through the ledger's own `marketRegimeToLedger`);
  `currentRegimeMix` (regimeLedger sync cache, 30-day window); L1 distance
  with `REGIME_MIX_L1_THRESHOLD = 0.6` (strict >; boundary is NOT divergent);
  `STALE_BY_REGIME_DOWNWEIGHT = 0.6`.
- **Live-derived flag, no persisted state**: `regimeRankFactor` is computed
  on every retrieval read, so it auto-clears the moment fresh evidence in the
  current mix moves the skill's evidence weights back toward the market mix
  (no invalidation machinery to forget).
- Wired into the single ranking point (`rankedMatchedSkills` score =
  status × overlap × evidence-decay × regime factor) — the same score every
  consumer (opening slice, verdict extras, retrieval list) sees.
- Tests (`tests/regimeSentinel.test.ts`, 9): weight normalization, L1 math +
  threshold boundary, null safety, auto-clear, and a full-stack ledger-cache
  test (25 trending + 5 ranging days via `recordRegimeDay`) proving a
  cross-regime skill is flagged + downweighted (0.6×) while a dominant-regime
  skill is untouched, and unknown coins are silent.

Gates: tsc exit 0, 1806 passed / 11 skipped / 0 failed, vite build clean.
§8.5 a–d now complete.

---

## ROUND-45 — §8.5c context-budget economics (cost vs benefit of every injected skill)

Injection chars are the scarce resource; now the cost side is measured,
ranked, and audited on a cadence.

- **Per-source char telemetry** — `InjectedSource.chars` records the actual
  chars each block contributed to the prompt (retrieval's `push()` returns the
  sliced length; every source — skill, risk rules, mistake line, similar
  trades, identity — now logs it).
- **`utils/skillEconomics.ts`** — per-skill economics: cost = Σ injected chars
  (legacy records fall back to per-stage defaults: index line 120 / full-body
  retrofit 450 — the §4.7 economics price an index line AND a recall pull
  differently), benefit = lift pts × injection frequency, value = lift-per-char.
  `worstBudgetOffender` picks the smallest lift-per-char among measured
  skills (highest cost when no lift data exists).
- **Monthly scoreboard** — `buildMonthReport` (with optional injections)
  names the worst offender in the card's `needsAttention` short list
  ("costs ~N chars for ±Xpt lift — worst value per char…"), and
  `runMonthlyReport` feeds the injection log in. The library's cost side is
  now reviewed monthly, alongside adherence, mistakes, and Brier.
- Tests (`tests/skillEconomics.test.ts`, 6): cost/benefit math from fixture
  logs, best-first sorting, index-line vs recall pricing (defaults differ
  >2×), no-lift skills never outrank measured ones, cost-highest fallback,
  empty-log safety. Existing monthlyReport tests unchanged (param optional).

Gates: tsc exit 0, 1797 passed / 11 skipped / 0 failed, vite build clean.

---

## ROUND-44 — §8.5b meta-calibration (the loop learns about the loop)

Three deterministic ratios, maintained by recorders at ground-truth points
and computed weekly into a per-user Preferences blob; surfaced in the AI
Learning Profile header (LearningDashboard) and on the weekly digest.

- `services/learning/metaCalibration.ts` — counters + a pending watch for
  gate-approved triggers; `computeMetaCalibrationRatios` (null when no
  sample); `runWeeklyMetaCalibration` (called by the weekly review pass)
  persists the ratios and, when worth-gate precision < 40% at sample ≥ 10,
  emits a P7 harness-lesson (`worth-gate-precision-decay`) with a
  default-change proposal (raise `MIN_SAMPLE_CONFIRMED` / tighten the Wilson
  band) — a decayed gate gets a proposal, never a silent threshold tweak.
- **Worth-gate precision** — `recordWorthGateApproval` at the gate fold's
  create path (the only `maybeUpsertSkill` caller, when `preferredClause` was
  the gate's judged clause); `recordWorthGateConfirm` on the candidate→confirmed
  transition (matched via the pending watch, so only gate-approved skills count).
- **Refinement recovery** — `recordRefinementOutcome` at both shadow
  settlements (the inline evidence-path settle and `settleSkillShadow`).
- **Eval-verdict agreement** — the first FOLLOWED trade after a helps/hurts
  verdict era counts once per era: helps→WIN / hurts→LOSS agreed.
- **UI** — three-chip row under the LearningDashboard header (monochrome;
  ‘—’ when a ratio has no sample); `WeeklyReviewDigest.metaCalibration`.
- Tests (`tests/metaCalibration.test.ts`, 8): approval→confirm via the watch,
  no confirm without approval, pending stays pending, once-per-era counting,
  null ratios on empty data, decay lesson at sample ≥ floor + below floor
  sample, no lesson above the floor.

Gates: tsc exit 0, 1791 passed / 11 skipped / 0 failed, vite build clean.

---

## ROUND-43 — §8.5a permanent ε-holdout (the long-run honesty mechanism)

~10% of runs now withhold skill injection so the CONTROL group keeps growing
and counterfactual lift stays honest after year one. Seeded per run id and
reproducible; deliberately NOT configurable.

- `utils/skillHoldout.ts` — pure, platform-stable decision: FNV-1a of the run
  id, `hash % 100 < 10` (≈10%). Same id → same decision, always; no id ⇒ no
  holdout (conservative default, never misclassifies).
- Decided at the single retrieval entry point (`getMemoryFilesContext`): a
  holdout run injects NO skill blocks (primary + verdict extras) for BOTH the
  analyst-opening and moderator-verdict slices (same runId), and the injection
  record carries `holdout: true` with no skill source — so downstream
  `skillAdherenceSince` sees "not-injected" and the matched skill's outcomes
  accumulate in `controlIds` (the CONTROL evidence group) instead of W/L.
- Run id = the triggering user message id (the run's stable identity in
  `handleSendMessage`), threaded `useAnalysisPipeline` →
  `assemblePipelineMemoryContext(runId)` → `MemoryContextOptions.runId`.
- `RunStats.skillHoldout` mirrors the same seeded decision, so every
  downstream consumer (signal card, dashboards, audits) can see whether a run
  was a control run.
- Tests (`tests/skillHoldout.test.ts`, 8): determinism, ~10% rate over 1000
  ids, no-id default, both outcomes; integration — holdout run injects no
  skill + records holdout:true; normal run injects + records the source;
  holdout-run outcome → controlIds, counts untouched; normal-run outcome →
  full credit.

Gates: tsc exit 0, 1782 passed / 11 skipped / 0 failed (one full-suite load
flake in roomComponents.test.tsx — passes 10/10 isolated, same class as the
documented skillsGrid issue), vite build clean.

---

## ROUND-42 — Stabilize ROUND-41 tree: restore harnessSettings regression, fix §8.2a type errors, reconcile tests to §8.3c/§8.3d

ROUND-41's tree was NOT green: `tsc` exited 2 and 3 tests failed. A mid-flight
edits broke a foundational settings module and left the birth-certificate +
§8.3 work half-integrated. This round gets it green again (gates: tsc exit 0,
1775 passed / 0 failed, build clean) without disturbing the ROUND-41 feature
surface.

- **Restore `utils/harnessSettings.ts` (regression).** The §8.2b library-cap
  work rewrote the module from scratch, flattening the existing settings
  surface and deleting `getHarnessSettings` / `saveHarnessSettings` /
  `getSessionGuardConfig` (plus prompt-A/B, desk-tools, equity/risk, debate-cap
  fields) — breaking 11 consumers of the session-guard config and landing
  features. Reconstructed the full original module and extended it with
  `skillLibraryCap` + `DEFAULT_SKILL_LIBRARY_CAP` / `getSkillLibraryCap` /
  `setSkillLibraryCap`, so the §8.2b cap ships on top of the working settings
  instead of replacing them. `getSessionGuardConfig` (preset + per-field
  overrides) is back as the single static source.
- **Fix §8.2a type errors.** `SkillMemoryService` frontmatter parse now
  `parsePredictionLine(...) ?? undefined`, and `skillWorthGate` builds its
  `SkillWorthDecision` with `prediction ?? undefined` instead of conditionally
  spreading (the `| null` from `sanitizePrediction` no longer leaks as `| undefined`).
- **Reconcile 3 tests to the §8.3c/§8.3d contract.** `harnessMemory` seed never
  set a live `ifCondition`, so the shadow-semantics assertion (live trigger
  retained vs. refined version in `shadow`) saw `undefined`; the seed now
  carries `ifCondition`/`thenAction`. `skillLedgerInvariant` fixtures were pinned
  at N=5 where §8.3d's Wilson cold-start gate (N≥8, band excludes 50%) holds a
  skill at `candidate`; fixtures moved to 7W/1L (repeat) and 1W/7L (avoid) so the
  evidence-driven and worth-gate-merge transitions genuinely confirm.

---

## ROUND-41 — Debate pods + chat/floor observability (§9–§10), journal remainder (§4.5/§5a), memory index (§4.7), store unification (§8.1)

All uncommitted work in this tree, gated green (tsc exit 0, 1775 tests
passed, vite build clean).

**Batch 5 remainder:**
- Monthly report card (§4.5): `services/learning/monthlyReport.ts`
  (deterministic what-happened/learned/needs-attention assembly incl.
  grade-the-panel Brier per provider + ensemble line) rendered by
  `components/journal/MonthlyReportCard.tsx` in the Journal.
- Pre-read capture (§5a): opt-in gate (`components/chat/PreReadGate.tsx` +
  `utils/preRead.ts`) — commit direction + confidence BEFORE the verdict
  reveals, stored as `userPriorCall`; human-vs-verdict calibration line in
  the journal and session usage panel.
- Index-layer memory injection (§4.7): `buildGlobalMemoryIndex` replaces the
  JSON dump of GlobalMemory in `constructOptimizedContext` — one line per
  entry, ~900-char cap, `familyPerformance` stays injected verbatim; detail
  remains a `recall` tool pull.

**Batch 12 — seat tier + health read side:**
- Lens pods (§9.1): `services/providers/debatePods.ts` — 6–10 seats map to
  3 pods, one trust-chosen representative carries the pod position to the
  floor, every seat still seals its own conviction; verdict transcript cap
  scales 2400 + 400×(seats−5). Roster cap raised 5→10 (`MAX_ROSTER_SEATS`),
  team chips and composer steering cover 10 seats. debateFlow tests at 6
  seats + pod unit tests.
- Provider health view (§9.2): live last-error/latency/rate-limit read-out
  in Settings → Providers (the read side ProviderHealthService always
  promised).

**Batch 13 — chat + floor observability:**
- Unread thread badges on the roster rail + `markThreadOpened` on focus;
  message search over the flat thread array.
- Skill-citation chips on verdict messages (tap → skill card), per-message
  context disclosure ("what this seat saw"), harness-lessons browser in
  Settings.
- Floor mode: seat desks show thinking/effort/cooldown posture from the
  wire audit + health data, harness-lesson squawks, sealed-auction dot plot,
  guard state on the Big Board, pin-a-seat side pane.

**Batch 9 — store unification (§8.1):**
- The attributed-insight store moved into the trader notebook: new
  `distilled/` folder, one auto-managed file per lesson
  (`services/learning/distilledMemory.ts`), `distilled:<fingerprint>`
  provenance, cap 200 pruning lowest-quality-first, write-through sync cache
  so reads-after-writes stay consistent. Old `attributed_insights_kb`
  preference rows migrate once on boot, then the key is retired.
- `AttributedInsight` type moved to types/learning.ts; the store API in
  PatternMemorySynthesisService is unchanged for consumers — only the
  persistence backend moved. The mandatory-pattern gate verdicts are pinned
  by a snapshot test (`tests/storeUnification.test.ts`).
- Regex miner deleted (`InsightExtractionService.ts`, ~870 lines): regex
  mining rewarded fluent writing, not correct writing, and its prompt-
  injection layer was dead code. Severity + provider-attribution machinery
  moved to `services/learning/severityInsights.ts` (cyclic import with the
  synthesis service reduced to one documented safe edge); provider
  attribution now pulls lesson text via the notebook's own deterministic
  lesson extractor — one lesson per provider, not up to 5 regex hits.
- Fingerprint dedupe: two lessons with the same normalized shape merge into
  one fact (magnitudes/ids stripped), keeping the merged feedback counters —
  the §4.6 recurrence-counting substrate. `JobQueueService`'s
  EXTRACT_INSIGHTS job still records severity + provider lessons, minus the
  miner; the App-side per-profile insight-KB feed was removed.
- VersionHistoryDashboard's knowledge-base tab reads the notebook-backed
  store; insight feedback is awaited before reload.

---

## ROUND-40 — Audit-fix batch (plan §14), dead-code cleanup (§8.0), weekly review (§4.5)

**Batch 14 (all audit findings from the v5 plan review, fixed with
regression tests in tests/auditFixes.test.ts + tests/probeSelfHarm.test.ts):**
Kelly advisory sign bug (journal losses are negative — the advisory never
rendered in production; now normalized at both function and call site).
P5 wire audit now fires on the messages (Claude) and google (Gemini)
transports too — every apiFormat gets a budget line. The known-answer
probe no longer pins off a WORKING provider: 64→512 probe budget,
"200 + no OK" is inconclusive (no lesson), and the knob-rejection
heuristic requires rejection wording. P6 wire-shape assertions added to
debateFlow (rebuttals carry effort 'high', verdict 'max', audit sink on
every call). P7 loop closed: the clarification audit stream writes budget
lessons, and the moderator verdict now sees a capped HARNESS NOTES block.
Trade cap buckets by OPEN time (analysis.createdAt); realized P&L keeps
close time. Shared rowPnlUsd converter (margin = investmentAmount, else
risk base) now used by SessionGuard AND disciplineAnalytics. Guard config
is live: preset picker (tight/FTMO) + per-field overrides in Settings →
Harness, read by every assessSession call site. SMC block moved high in
the hybrid packet so the 2400-char head-slice can't truncate it first.
Cooldown in-memory scope + success-clears ruling documented; all-benched
moderator fallback now warns. Dead P2 tiers wired (post-mortem medium,
chat/OCR low). quietHours got its test suite; skillsGrid timeout raised.

**Batch 8 (§8.0):** deleted the six orphaned components and the ~980-line
conductTwoWayDebate/conductThreeWayDebate generators + their five test
blocks (error-path coverage already lives on conductRealDebate); stale
"dead generators" comments updated.

**Batch 5 partial (§4.3 + §4.5):** pre-trade checklist (utils/checklist.ts,
FTMO defaults, OFF by default, Settings toggle, checkboxes in the capture
modal, completion stored on the trade); weekly review service
(services/learning/weeklyReview.ts — deterministic week stats + ONE
improvement impulse from a provider call, 7-day + 3-trade gate, boot
trigger next to the rollup, WeeklyReviewCard on the Journal analytics
tab). Still open from batch 5: monthly report card, pre-read capture,
index-layer memory injection.

Gates: tsc 0, full suite 1715 passed / 0 failed, build clean.

---

## ROUND-39 — zcode/claude UI parity, debate hardening, learning-loop review fixes

**UI parity with the reference screenshots.** The whole app moved onto the
Claude-dark gray ramp (#111111 page / #1a1a1a panels / #262626 composer /
~#37373d active fills). Composer rebuilt as the borderless pill: centered
placeholder, bare Chat/Trade pills, seat-glyph avatars (1/2/3 — no more
accidental "KKK" from provider initials), leverage relocated into the Team
menu, Templates row removed (skills still fire via `/slug`, now with a
reference-native "Try in chat" button on every skill card). Sidebar became a
lighter-than-page rail with bullet rows and a footer account popover. Hero:
solo serif greeting ("Up late" from 22:00). Debate feed rows are typed and
tinted (violet DMs / blue lookups) with zcode-style count-grouping
("Lookups · 4"). Settled verdict cards carry a Replay · Run log · Audit tab
strip plus protocol/prompt-version provenance chips. Reasoning rows are
collapsed by default everywhere, truncate on line boundaries, and markdown
rendering tightened (paragraph rhythm, neutral inline code).

**Debate engine hardening.** Protocol lanes are deterministic (hashed from
the setup — same idea, same structure, no more flaky round counts); residual
clarification concerns surface in the verdict prompt; seats cut off by the
budget keep their last sealed conviction in the auction; rebuttal budget
raised and a missing CONVICTION line retries once; debates without live
hybrid data force one grounding tool call before any seat may speak;
moderator DM receipts carry real round numbers.

**Learning-loop review fixes** (post-implementation audit, all verified):
eval A/B arms rebuilt on the production context builder with skill exclusion
+ telemetry suppression (no more contaminated baselines or phantom
attribution credit); worth-gate create/merge restored behind the notebook
write lock; strict matcher extended to eval-trade selection and lift so the
audit measures what enforcement enforces; consolidation dedupes evidence
counts instead of double-counting; merge transitions ride the temporal
ledger; refine reports real change instead of always toasting success;
inline-approval memo deps fixed so cards track drafts.

Tests: 1147 passing across 122 files (new suites: debateMailbox,
debateSidePanel, protocolAndInlineApprovals, skillConsolidation). Lint 0
errors, typecheck clean, production build green.

---

## ROUND-36 — Conviction drift tracking + recall_chat session search

**D2.2: conviction drift.** New `services/analysis/convictionDrift.ts`:
extracts each seat's ordered sealed-conviction trajectory from stored debate
transcripts and measures whether rounds actually MOVE anyone. The moderator's
seat-trust record now says which seats are "movable" (changed stance in ≥40%
of debates) vs "rigid" (never moved), with the direction — so a movable
seat's FINAL conviction gets weighted over its first. The Learning
Dashboard's conviction card shows the same signal ("moves · avg Δ−18").

**U7: recall_chat desk tool.** New `services/infrastructure/sessionSearch.ts`
— unified search over stored conversations (term-frequency × role weight ×
recency, 1600-char bounded digest). Exposed as a 10th desk tool so seats can
search past debates mid-run ("did we discuss this before?"); the arbiter's
tool policy includes it. One backend, ready for future UI search too.

Tests: convictionDrift (extraction quoting-guard, trajectories,
movable/rigid profiles) + sessionSearch (rank, no-match, digest bounds).

---

## ROUND-35 — Debate-stage polish: inline steer input + cost tooltips

The two known-open polish items from ROUND-34:

**Inline steer input.** Clicking a seat's paper-plane no longer opens a
browser `window.prompt` — an inline row appears under the debate stage
("→ Macro · [note for Macro — only they see it] · Queue"). Enter queues,
Esc cancels. Monochrome, in keeping with the composer.

**Cost/latency tooltips.** Each stage actor's hover tooltip now carries the
quiet ledger line from `runStats.analysts` — "Macro — qwen3-1.7b · 41s ·
1.2k out" — so per-seat cost is visible without opening the side panel.

Tests: `tests/debateStageSteer.test.tsx` (inline queue flow, tooltip line,
stop button).

---

## ROUND-34 — Graph-scored ranking, temporal skill ledger, per-seat controls, jobs drawer

The four queued deep-scan items, implemented together:

**Graph-scored skill ranking (M3 reconciliation).** `rankedMatchedSkills`
now scores every matched skill as status weight (confirmed 2 / candidate 1)
× setup-dimension overlap × evidence-freshness decay (120-day constant,
same as MemoryGraph). The dashboard graph and production retrieval can no
longer disagree about what matters. The M3 conflict is resolved by design:
moderators keep seeing skills through audience filtering (index tier at
verdict), not exclusion.

**Zep-style temporal ledger.** Skills carry a `history:` frontmatter array —
every status transition stamps validFrom → invalidAt with a reason
(evidence / eval hurts N/M / manual). Demotions and retirements close the old
era instead of erasing it; `skillStatusAt(meta, timestamp)` answers "what did
I believe at this moment?" for replay audits. Wired into evidence-driven
status derivation, eval 'hurts' demotions, and manual retire/restore.

**U3: per-seat Steer/Stop.** Hover a live actor bubble on the debate stage:
the paper-plane queues a note that rides ONLY that seat's next prompt
("**USER STEERING — DIRECTED AT YOU**"), the square benches the seat at the
next round boundary (drop path reuses the tested transcript purge). Both flow
through new engine hooks (`getSeatSteeringNote`, `shouldDropSeat`) and the
pipeline exposes `handleSteerSeat` / `handleStopSeat`.

**U4: Jobs drawer.** Header "Jobs" button opens a right drawer (Hermes
status-stack pattern): live job queue rows (insight extraction etc., with
status + error) and the 20 most recent skill audits with their verdicts.
Background autonomy becomes visible instead of fire-and-forget toasts.

Also: lint error in ChatArea hero greeting fixed (useless assignment).
Tests: `tests/temporalLedger.test.ts` covers transition stamping, replay
queries, and frontmatter round-tripping.

---

## ROUND-32 — Root-cause failure patterns in the evidence pack (2026-08-23)

The first production payoff from the graph-engineering research (GraphRAG /
Zep / LightRAG): the memory system's root-cause classification — which until
now only fed the dashboard graph — surfaces as a **high-level failure-pattern
line** in the verdict evidence pack.

When a coin+direction cluster has ≥4 admitted technical losses and ≥50% of
them classify as SETUP_EDGE_FAILURE, both the moderator's prompt block and the
card's evidence panel now say so explicitly: *"Failure pattern: 3/4 of your
admitted BTC Short losses are SETUP_EDGE_FAILURE — the setups themselves, not
execution or macro shocks. Tighten entry criteria before trusting this class
again."* Execution errors and macro shocks never fire the line (they don't
admit edge lessons), small samples stay silent, and the card renders it in the
status-surface scope.

This is LightRAG's dual-level idea in miniature: seats reason at low level
(specific skills, similar trades); the arbiter now also gets one high-level
line summarizing what the cluster's cause nodes say — no new infrastructure,
just reading data that already existed.

---

## ROUND-31 — Memory honesty fixes + composer declutter (2026-08-23)

**Edge decay now actually reaches prompts (M1).** The 120-day exponential
decay documented in ROUND-26 lived only in the dashboard's memory graph —
`getMemoryFilesContext` fed prompts from raw similarity. `findRelevantTrades`
gains a `decayByAge` option and both prompt consumers (similar-trades block,
verdict evidence pack) now use it: old trades still appear with their lessons,
but at honest reduced weight, and can no longer crowd out fresh evidence.

**Bot memory respects the setup (M2).** `getBotMemoryContext` ignored its
query entirely (`void query`). Bot notes are now line-filtered to this
coin/regime: matching lines and general lessons pass, other-coin-specific
lines are dropped, persona blocks always pass. Multi-bot merges are capped at
1,800 chars total so N bots can't balloon the analyst prompt outside the
stage-budget discipline.

**Provenance counter (M4).** Skills serialize a monotonic `evidenceCount`
frontmatter field; the verdict block's "learned from N logged trade(s)" now
reads it instead of the tail-20 tradeIds list, which silently capped long-lived
skills at 20 forever.

**Composer declutter (from screenshot audit).** The nine-chip suggestion row
(@roles, debate templates, skill slugs) collapses behind one "Templates ▾"
toggle — the default composer is text + attach + Team + send, DeepSeek-minimal.
The duplicate footer "Team" chip is suppressed (the composer dropdown already
carries that control); overflow counting uses visible chips only.

Verified: typecheck, 1106 tests, lint, build all green. New suite
`tests/memoryHonesty.test.ts` pins decay math, bot-note filtering, and
evidence-count round-tripping.

---

## ROUND-29 — DeepSeek-parity chat polish (2026-08-23)

Component-by-component comparison against the DeepSeek harness UI (thinking
row, settled turn, composer) drove three polish items — all view-layer:

**Quiet model byline.** Every settled AI bubble now ends with a whisper line:
`Macro · Technical · Moderator · 41s` (seat roster from the run ledger +
wall-clock duration). This is the exact "DeepSeek-R1 · 12s" convention —
previously august buried model names inside a details table.

**One container language.** New shared `AuditPanel` wrapper; the run-contract
panel, evidence-pack card, and used-notes strip all render through it, so a
stack of audit surfaces reads as one grouped system instead of five competing
boxes. Same radius/border/background everywhere.

**Chip-bar overflow.** Past three active context chips above the composer,
the tail collapses into a single `Context · N ▸` summary with a hover/focus
popover listing the hidden chips. No second toolbar row, no portal, no deps.

Verified matches (no change needed): `ReasoningRow` already implements the
DeepSeek thinking row exactly — live expand while streaming, scroll-pinned
latest-line ticker, collapse to "Thought for Xs" on settle, plain-text body
while running and markdown on settle. Hover-copy affordance also matched.

---

## ROUND-28 — Arbiter evidence, setup-stats tool, run contract UI (2026-08-23)

**The moderator can finally see its own journal.** `getModeratorAnalysisStream`
now accepts the trade log, so the `recall` desk tool works at every moderator
surface (clarification questions, judgment, verdict, accuracy verification,
post-mortem debates) — previously only analysts had history and the arbiter
recalled nothing.

**Arbiter tool policy.** The moderator's default desk is now memory + context
(`recall`, `get_setup_history_stats`, session, web search). Order-book and
derivatives data no longer reach the binding verdict by default — argument
quality decides, not wall noise.

**New desk tool: `get_setup_history_stats`.** Any seat can check a claim like
"this setup usually fails" against the real journal: sample size, win rate,
average R, last outcome, worst lesson for a coin+direction cluster. Honest
"no logged trades" when the sample is empty.

**Verdict evidence pack.** Before the moderator writes the verdict, a compact
block is assembled automatically: this desk's record on the setup, top similar
closed trades, matched notebook skills, doctrine header. The binding decision
no longer depends on the moderator remembering to call recall.

**Run Contract panel.** Every debate card shows its stage ladder as a live
todo — Gate scan → openings → rebuttals → clarification → verdict — derived
from the existing run log. Skips are honest and labeled ("USD budget cap
reached", floor alignment), so a lopsided-floor verdict is visible instead of
silent. Frozen into the finished card for replay audits.

**Evidence pack card.** The settled verdict card shows what the arbiter's
evidence pack contained: journal record line, similar trades with lessons,
matched skills with freshness, doctrine header. Prompt-side block and UI card
show the same data.

**Chat surface color pass.** Post-mortem headers, live post-mortem stream and
the hybrid session panel dropped their purple/indigo accents back to the
charcoal + steel-blue theme; the strategy auto-discover button joins the accent
family properly.

Also: skill injection credit is scoped to each trade's time window (one old
injection no longer upgrades credit forever); the dead Bayesian calibration in
post-mortem debates is wired into the transcript; README rewritten to describe
this repo.

---

## ROUND-26 — Seat trust, provenance, edge decay (2026-08-22)

**Seat-trust weighting.** The moderator verdict prompt now includes each seat's historical record: Brier calibration score, overconfidence gap, and average sealed conviction from stored debates. Seats with proven accuracy are flagged trustworthy; overconfident seats get an explicit discount instruction when they dissent from better-calibrated peers. Data comes entirely from the existing trade log.

**Skill provenance.** Verdict-stage skill blocks now state what they were learned from ("learned from 7 logged trade(s)") alongside freshness, so the model knows both how old and how well-evidenced a rule is.

**Per-skill lift measurement.** New `MemoryProvenanceService` computes whether a skill actually improved outcomes: win rate on matching setups *after* the skill existed versus before it. Positive lift = the skill helps; negative = it misleads despite plausible evidence. Surfaced in the Learning Dashboard Skills card (`lift +12pp`) and folded into its color coding.

**Memory-graph edge decay.** `similarTo` edges now fade with trade age (~120-day exponential half-life). Old associations stop surfacing without deletion — the same decay philosophy applied to skill counts in ROUND-24m, extended to the graph.

**Settings: audience toggle.** Skill files in Settings → Memory files show an `audience:` button cycling all → analyst → moderator, controlling which debate audience may load them.

Also: changelog.md created (this file).

---

## ROUND-25c — Fully-automated skill self-evaluation (2026-08-22)

The harness audits its own knowledge with zero user action:

- After every trade-log sync, one due confirmed skill gets an A/B eval (re-analyze up to 6 of its matched historical trades with the skill on vs off).
- Due policy: enabled + confirmed, ≥3 matched trades, ≥10 closed trades since last eval, ≥24h cooldown. Max 2 auto-evals per session.
- Verdicts stamp into frontmatter (`evalVerdict: helps (3/3)`, `lastEvalAt`).
- **Causal override:** a `hurts` verdict demotes a confirmed skill to candidate on the next evidence pass. Injection-causation outranks outcome correlation.
- Doctrine staleness header: `(beliefs last consolidated around trade N)` injected above doctrine so models know how current their convictions are.

The loop is closed end-to-end without human intervention: write → count evidence → confirm → A/B verify → demote if harmful → re-verify later.

---

## ROUND-25 / 25b — Progressive disclosure + eval engine; IF/THEN removal (2026-08-22)

- **modified:** timestamps on every skill write; injection surfaces human-readable freshness ("evidence 12d old").
- **Tiered skill injection:** openings/rebuttals get a one-line index (`AVOID [confirmed · 1W/6L · …] IF…THEN…`); verdicts + recall serve full bodies.
- **audience frontmatter** (analyst/moderator/all) controls which debate seat may load a skill.
- **Dynamic context:** `${SYMBOL}`/`${REGIME}`/`${DIRECTION}` substituted live at assembly.
- **SkillEvalService**: with-skill vs without-skill benchmarking engine (deterministic flip scoring).
- **IF/THEN rules system removed** (ROUND-25b + completion): post-mortem lessons flow only through skills; validation-gate structured rules retired; CONFIDENCE_RULES safety rails kept as constants; legacy rule data migrates mechanically to candidate skills.

---

## ROUND-24m — Memory simplification (2026-08-22)

Fewer, truer memories:

- Hard stage budgets (opening 900 / rebuttal 400 / verdict 600 chars) with ranked fill order; doctrine has its own always-on slot.
- Diary = raw storage, never injected.
- Recurring-mistakes lines go quiet once a skill owns the cluster.
- Similar-trade history moved to verdict-only.
- Skill refinement slowed (3 consecutive losses spanning ≥48h); doctrine rewrite every 15 trades with ≥⅔ carry-forward.
- Evidence decay: counts halve when >30 days stale or earned in a different regime.
- IF/THEN rules retired from prompt injection (folded into skills).
- `recall` desk tool: debate seats pull their own memory on demand instead of receiving bigger prompts.

---

## Earlier rounds

See git history for rounds before ROUND-24m (Brier calibration summaries, skill effectiveness review, debate upgrades B1–B4, memory-as-own-knowledge voice work, UI surfacing).
