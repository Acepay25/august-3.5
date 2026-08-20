# Debate UI/UX — Simplicity-first proposal (from Hermes "Bot Mode" research)

Task: implement the backlog + research Hermes agent **bot mode** + suggest debate UI/UX
improvements, under the directive "**the stage doesn't matter — simplicity is the new
modern UI**". Date: 2026-08-20.

---

## 1. What Hermes "Bot Mode" actually is (verified)

**Bot Mode is a desktop multi-agent feature — not a headless/autonomous mode, not a
messaging-integration mode, and not the "YOLO" approval-bypass.** It turns each Hermes
*profile* into a named **Bot** (own role, model, memory, skills, avatar), and bots
deliberate together in **group-chat "rooms" (2–6 bots)** via `@mention` handoffs.

Authoritative sources:
- Official doc: <https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode>
- Plugin repo: <https://github.com/NousResearch/Hermes-Bot-Mode>
- Announcement: <https://x.com/NousResearch/status/2089429432612147572>

**How it works (the transferable mechanics):**
- **Turn-taking is serial, capped, self-terminating** — one message → up to **3 serial
  rounds**; `@mentioned` bots respond (all if none mentioned); each replies **briefly or
  passes**; the room **settles when a full round stays silent**.
- **"Pass" is first-class** — an explicit *intentional silence token* so a bot can say
  nothing instead of rambling.
- **Headless machinery, visible result** — bot-to-bot messages are real CLI handoffs that
  land in a persistent, attributed **"Agent Inbox"**; the user only sees the chat bubble.
- **Approval is the only human interrupt.**

**The key product insight:** Hermes itself de-emphasized its "sessions" UI in favor of a
**flat roster + one shared thread** — the exact "simplicity via one list + one shared
thread" direction this app is heading toward.

---

## 2. Recommended debate UI/UX (ranked by leverage ÷ effort, monochrome-safe)

1. **One flat roster, one shared thread — kill the avatar "stage".**
   The roster *is* the stage: participants as a name + one-line role in a slim rail; the
   debate is just chat bubbles. (Files: de-emphasize `DebateStage.tsx` / `DebateBotAvatar.tsx`;
   promote `DebateChat.tsx` + `EnsembleProgressChat.tsx`.)
2. **Bounded, serial rounds with a visible "pass".**
   Show "Round 1/3" as a tiny label; a skip renders as a muted "(passed)" line, not a card.
   (We already run serial rounds in `ensembleService.ts` — surface the cap + pass states.)
3. **`@mention` = the only targeting control.**
   `@modelname` in the composer selects participants; removes multi-select checkboxes.
4. **Attribution in the bubble, nothing else.**
   Each message shows only *who* said it; model/role/params live in the roster rail or a
   collapsed footer, not repeated on every bubble. (Files: `MessageItem.tsx`.)
5. **Honest minimal progress.**
   Replace animated avatars/spinners with a single muted "X of Y responding…" line + a
   per-name "…" suffix. (We now also show a per-avatar `N.Ns` timer and token readout.)
6. **One primary action: "Run debate → Verdict".**
   A single button starts the rounds; the moderator settles to one verdict card (the only
   bold block). (Files: `ChatInput.tsx` / `ChatArea.tsx` toolbar.)
7. **Persistent, attributed transcript.**
   The debate log persists and scrolls; secondary info (confidence, models used) collapses
   into a footer per verdict.
8. **Approval as the only inline interrupt.**
   A low-chrome "Approve / Deny" strip appears only when a destructive/high-stakes action
   is pending; never a modal for every consent.

---

## 3. Anti-patterns to avoid (from the research)

Animated avatars / elaborate stage · parallel/unbounded turns · per-message metadata bloat ·
multiple competing primary actions · fake/hidden progress · color-only semantics ·
non-terminating debates · modal-heavy approvals.

---

## 4. Implemented (code, verified green)

1. **Flat roster + shared thread as the default (kill the stage).** `EnsembleProgressChat.tsx`
   now renders every seat's transcript inline in one scrolling thread (`.debate-thread`) by
   default; the animated `DebateStage` is an opt-in "Stage" toggle. (Recommendation #1.)
2. **Honest minimal progress.** The header shows "X/Y responding" while seats stream
   (Recommendation #5), alongside the token readout.
3. **Token-breakdown tooltip.** The header's token readout exposes the prompt/completion split
   on hover (Hermes' context meter, hover-only — no popover chrome).
4. **Context hygiene — verified already handled, no change needed:** thinking is side-channeled
   (`openingFromResult` → `onAnalystReasoning`), never injected into follow-up model prompts;
   the reasoning corpus is stored only for the user's own training (`ThinkingStoreService`).
5. **Two-phase reveal — already present:** `ReasoningRow` streams thinking expanded, then
   collapses to a "· N.Ns" summary on settle.

**Dropped by design (per "stage doesn't matter / simplicity"):** gaze-toward-speaker,
randomized blink/wink, and the single morphing-disc — all stage decoration.

**Tests:** `tests/ensembleProgressChat.test.tsx` updated — stage-specific cases opt into the
stage via a `switchToStage()` helper; a new test asserts the thread is the default view.

---

## 5. Concrete change plan (file-level)

Done this turn: **#1** (flat thread default + Stage opt-in) and **#5** ("X/Y responding").

| # | Change | Files | Status |
|---|---|---|---|
| 1 | Roster rail + shared thread instead of avatar stage | `EnsembleProgressChat.tsx`, `DebateStage.tsx` (opt-in) | ✅ done |
| 2 | "Round X/3" + "(passed)" states | `EnsembleProgressChat.tsx`, `ensembleService.ts` | phase rail already shows rounds |
| 3 | `@mention` targeting | `ChatInput.tsx` | pending |
| 4 | Attribution-only bubbles | `MessageItem.tsx` | pending |
| 5 | "X of Y responding…" status line | `EnsembleProgressChat.tsx` | ✅ done |
| 6 | One primary action | `ChatArea.tsx`, `ChatInput.tsx` | pending |
| 7 | Persistent transcript | `DebateChat.tsx`, journal/DB | transcript persists in thread view |
| 8 | Inline approval strip | existing approval surfaces | pending |

---

## 6. Verification

- `npm run typecheck` — 0 errors.
- `npx vitest run` — **96 files passed, 1022 passed, 11 skipped, 0 failed.**
- `npm run build` — ✓ (only a pre-existing >500 kB chunk-size warning).

---

## Sources (primary)

- Hermes Bot Mode doc: <https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode>
- Hermes Bot Mode plugin: <https://github.com/NousResearch/Hermes-Bot-Mode>
- Announcement: <https://x.com/NousResearch/status/2089429432612147572>
- Writeup (rounds, Agent Inbox, CLI handoffs): <https://www.marktechpost.com/2026/08/17/nous-research-hermes-bot-mode/>
- Intentional silence tokens: <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/index.md>
- Full per-agent source lists: `.cluster/debate-ui-optimization/subagent_09_hermes_bot_mode.md` (+ 05–08).
