# Bot Mode Deep Scan → August Implementation Plan

Sources scanned (all local, verified against source):
- `~AppData/Local/hermes/hermes-agent/apps/desktop/src/plugins/hermes-bots/` (~40 files, the desktop Bot Mode plugin)
- `hermes-agent/tools/bot_mode_probe.py`, `bot_mode_dm.py`, `bot_relay.py`, `bot_failure_reasons.py` (core side)
- `hermes-agent/AGENTS.md` §"Bot Mode" (the settled identity contract), `hermes_cli/config_defaults.py` (`bot_mode` block)
- Grok Bot: Wikipedia "Grok (chatbot)" §Grok Bot (beta Aug 11 2026) + the reference screenshot (which IS the Hermes desktop Bots UI, already copied into august's GroupChatView)

---

## 1. How Hermes Bot Mode actually works

### The layer cake

```
Desktop plugin (UI + router)          Core agent (identity + tool + protocol)      File plumbing (transport)
─────────────────────────────         ──────────────────────────────────────       ────────────────────────
roster pane / bot-row                 bot_mode_probe.py                            bot_relay/
  one row per profile                   injects "## Messaging other agents"          roster.json  (union roster
canonical-chat.ts                         ONLY into (profile, "Bot Chat")             outbox/      (queued DMs)
  identity = NAME, never pointer          session's system prompt                      replies/     (async answers)
group-rounds/turns                     bot_mode_dm.py
  bounded round-robin, "(pass)"          message_agent tool (injected, not
  silence is a choice                      registered globally; title-gated
cron.tsx (Routines)                      twice at dispatch)
relay.ts (cross-connection)
```

### The five load-bearing design decisions

1. **One bot = ONE canonical forever-chat, identified by NAME.**
   `(profile, session titled exactly "Bot Chat")` — the state DB's
   UNIQUE(title) index makes it an exact registry. AGENTS.md records five
   incident waves (#88690…#92042) caused by the previous design (a stored
   session-id pointer in `ui_meta`): pointers dangle, get stolen by
   `rows[0]`, weld onto wrong sessions. Name-as-identity removes the whole
   failure class. Canonical chats are hidden from the Sessions sidebar —
   the bot row is the ONLY door.

2. **The roster is derived, never duplicated.** A bot IS an agent profile.
   `profiles.list` carries `canonical_session` (preview + id) resolved
   server-side, so row preview and click target are the same row by
   construction. Bot metadata (avatar shape/color/eyes, title, description,
   pin, groups) lives in `ui_meta['hermes-bots']` — presentation only.

3. **Agent-to-agent messaging is a real tool, fire-and-forget, with the
   reply arriving as a wake-up.** `message_agent(target, message)`:
   - validates target against the live roster (no shellout quoting traps),
   - prefixes sender attribution server-side,
   - returns a delivery ack immediately — "like texting": send, finish
     your turn, the reply lands later as a background-process completion
     notification that wakes the sender's NEXT turn,
   - containment: schema injected ONLY into canonical Bot Chats on
     bot-managed installs; dispatch re-gates on session title at execution
     (defense in depth); never in CLI/cron/subagent/group-member sessions.
   - busy targets: per-profile cross-process file lock serializes turns;
     `turn_wait_seconds` (120s) then structured `target_busy`; envelope
     TTL (900s) kills zombie DMs that sat in the outbox while the Desktop
     was closed; `EnvelopeRefusedError` fails fast when the target is
     definitively offline (stale roster = 600s freshness bound).

4. **The protocol is prompt-injected, not file-appended.** The old design
   wrote the teammate protocol into each profile's SOUL.md; the probe now
   injects it at prompt-build time (byte-stable per process — compression
   rebuilds produce identical bytes), stays silent if SOUL.md already
   carries the heading (dedupe), and renders the live roster as
   `- @handle — title — description` lines so every bot knows WHO to
   message for which job. Toggle: `agent.bot_mode_protocol` (default on).

5. **Group rooms are deterministic, bounded, and silence is a first-class
   outcome.** One ordered room log owned by the plugin. A user send triggers
   ≤ MAX_ROUNDS serial round-robin rounds; speakers chosen by a
   deterministic @mention parse (mentioned members, else everyone;
   @everyone/@all; case-insensitive name/title/no-space forms; cross-
   connection @name-device handles). A member "speaks" only if it has
   something to say — replying exactly `(pass)` (or nothing, or failing)
   is silence. A round where everyone passed = the conversation settled.
   Each member runs in its OWN persistent per-group session and is fed
   only room messages NEW since it last saw the room (incremental context,
   cheap). Activity feed (working/replied/passed/sent) is runtime-only,
   epoch-tagged, bounded to 50 — the transcript is the only durable record.
   No LLM router anywhere in the coordination.

6. **Cross-machine: the Desktop IS the relay.** Connections are the peer
   set. Two loops: roster loop pushes each gateway the union roster of the
   OTHER connections (`bot_relay.roster.sync`); drain loop collects
   envelopes, delivers on the target's socket, posts replies back. The
   gateway never holds another connection's credentials; everything on the
   gateway side is plain file plumbing. Client deadlines are mirrors of
   backend budgets with a test that fails if they drift.

### Routines (the Grok "teammate" texture)
Right tile = Hermes cron jobs scoped to the bot you're chatting with
(follows the live gateway profile). A bot that runs its own schedule is a
coworker, not a chatbot.

---

## 2. Grok Bot (the inspiration) — what maps and what doesn't

Grok Bot (xAI, beta Aug 11 2026): "AI teammates" that **share a cloud
computer**, sign into apps/tools/websites, run **several at once**, and
**message each other**. User-facing surface is X: DM the bot, add it to
group chats, it acts on your behalf and reports back asynchronously.

The transferable ideas:
- **Persistent named teammates** with personas + their own conversation,
  not ephemeral chat windows.
- **Asynchronous, texting-like collaboration** — delegate, walk away,
  get woken with the result.
- **Bot↔bot messaging** as the coordination primitive (a team, not N
  independent chats).
- **Shared workspace** where the team's output lands (for august: the
  journal/trade log IS the shared workspace).

NOT transferable: the cloud computer + X-native identity/DM plumbing —
august is a local single-process app; its "computer" is the analysis
pipeline and its "X" is the transcript.

---

## 3. August today — what already exists (verified)

| Hermes concept | August equivalent | State |
|---|---|---|
| Bot = profile with identity | `AgentBot` (services/agents/agentRoster.ts): name, providerId+modelId, face, title, description | ✅ |
| Roster rail + rows + unread badges | `AgentRosterRail.tsx` (+ ROUND-49 Coach row) | ✅ |
| Canonical chat per bot | thread = `threadForProvider(messages, providerId, modelId)` — derived by identity pair, no pointer | ✅ (name-as-identity already the shape) |
| Group room + activity feed | `GroupChatView.tsx` + `useAgentGroups.ts` (sent/working/replied/passed) | ⚠️ single-pass fan-out only |
| Bot persona/memory | `BotMemoryService.ts`: per-bot system.md + memory.md + bot-scoped skills | ✅ |
| Routines | `hooks/useAutomations.ts` + `services/automation/` (global, not bot-scoped) | ⚠️ |
| message_agent (bot↔bot DM) | **nothing** | ❌ G1 |
| Multi-round room + "(pass)" + incremental room context | **nothing** (one pass, no room log per member) | ❌ G2 |
| Needs-attention badge (auth/quota/blocked) | unread counts only | ❌ G3 |
| @mention autocomplete in composer | roster search only | ❌ G4 |

Key architectural difference: august's bots are **in-process** — same app,
same message array, same provider configs. Hermes needed a cross-connection
relay because its bots are separate gateway processes. August needs no
relay, no file outbox, no sockets — just an **async in-memory mailbox +
dispatcher**. That makes G1 dramatically simpler than Hermes's version.

---

## 4. Implementation plan (ranked)

### G1 — Teammate DMs: `message_teammate` + the bot mailbox  (P0, the headline feature)
- **New `services/agents/botMailbox.ts`**: `deliverDM({fromBotId, toBotId, text})`
  → appends a user-role message into the target bot's thread, attributed
  `@senderName: text` (server-side prefix, Hermes-style), then schedules
  the target's turn. Per-target serialization via a busy-set (a second DM
  to a busy bot queues behind the first, with a TTL — Hermes's
  envelope-TTL/target_busy semantics in ~30 lines).
- **New `hooks/useBotTurnRunner.ts`** (or extend useAgentGroups): runs one
  bot's turn with its persona (BotMemoryService system.md + memory.md +
  scoped skills) + the DM text; on completion, appends the reply AND
  wakes the sender: a synthetic system notice in the SENDER's thread
  ("↩ @target replied: …") + roster attention pulse. Fire-and-forget from
  the UI's perspective — exactly the texting shape.
- **Bot-initiated sends**: when a bot's casual-chat turn is run, append to
  its prompt a "## Messaging teammates" section (the probe pattern:
  roster lines `- @name — title — description`, "reply with
  `[[dm:@target]] text` to hand off") + parse that marker from the reply
  → deliverDM. A marker protocol beats a real tool loop here: august's
  casual chat is single-shot streaming with no tool surface, and the
  marker keeps prompt caching intact. (Upgrade path to a real tool call
  later if a tool loop lands.)
- **Containment (Hermes's contract)**: the protocol section is injected
  ONLY into bot threads (never Team debates, never Coach, never post-
  mortems); dispatch re-validates the target against the live roster;
  unknown target → visible "(undeliverable: @x is not on the roster)"
  instead of silent loss.
- Tests: delivery lands in target thread with attribution; busy queue +
  TTL; wake-up notice on sender; unknown-target refusal; protocol section
  absent from non-bot sessions.

### G2 — Real room coordination (P1)
- Upgrade `useAgentGroups.runGroupThread` to Hermes's bounded loop:
  ≤3 rounds, ≤12 messages per send; deterministic mention parse (fix the
  current single-`@` regex → name/title/no-space forms + @everyone);
  "(pass)" = silence; a round where all pass = settled.
- Incremental context: per-member `lastSeenIndex` into the room log —
  each turn is fed only messages newer than what it saw (this is also
  what makes multi-round cheap).
- Activity feed already matches the reference vocabulary — keep.

### G3 — Needs-attention badges (P2)
- Classify bot-turn failures (provider auth / quota / model-missing) into
  an `AttentionClass` on the roster row (tooltip = the fix hint, Hermes's
  BOT_ATTENTION_HINTS pattern). August already has provider health
  (ROUND-44) — reuse `getProviderHealth`.

### G4 — @mention autocomplete in the composer (P2)
- Typing `@` in ChatInput offers roster handles (the popover already
  exists for /skills — same surface, different source).

### G5 — Routines scoped to the focused bot (P3)
- Automations gain an optional `botId`; the rail shows a "Routines"
  disclosure for the open bot. Deferred until G1/G2 land.

### Explicitly NOT porting
- The cross-connection relay (no multi-process peers in august).
- Session-id pins of any kind (august's derived-thread model is already
  the post-incident design Hermes converged on — keep it).
- Per-bot session browsers (Hermes removed theirs by decree).

## Sequencing
G1 is the feature the user sees ("my analysts can talk to each other —
the Macro bot DMs the Risk bot when its thesis breaks"). G2 makes group
chats feel like a team instead of a broadcast. G3/G4 are polish on the
same rails. Each is its own gated batch (tsc + vitest + build).
