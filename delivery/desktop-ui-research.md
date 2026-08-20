# Debate UI — Desktop Hermes & DeepSeek research + implemented enhancements

Task: "continue" the debate-UI optimization and research the **desktop (GUI)** versions of
Hermes and DeepSeek (explicitly *not* the CLI). Date: 2026-08-20.

---

## 1. Headline findings (all sources verified by research agents)

| Question | Answer |
|---|---|
| Does Hermes have a **desktop** app? | **Yes** — "Hermes Desktop", a native **Electron + React** GUI over the Python agent core (Hermes Agent v0.15.2, MIT, macOS/Windows/Linux, public preview June 2 2026). Transcript is built on `@assistant-ui/react`. |
| Does DeepSeek have a **desktop** app? | **No** — official clients are the web GUI (chat.deepseek.com) + iOS/Android. Every "DeepSeek desktop app" is a third-party wrapper. |
| What is "the Grok bot in Hermes"? | **Not a mascot.** "Grok" in Hermes = xAI Grok as a *model provider* (OAuth device-code login → Responses API, auto reasoning on Grok 4). The "bot" is the agent itself; Grok is its brain. No upstream Grok animation exists to copy. |
| Where does "Thought for N seconds" come from? | **DeepSeek's** signature reasoning display (web/mobile), not Hermes. |

---

## 2. Implemented this turn (code — verified green)

1. **"Thought for N seconds"** — `components/shared/ReasoningRow.tsx`
   Times the live thinking span (clock starts at mount-if-running and on running-start,
   freezes on settle) and renders a `· N.Ns` meta next to the label — the DeepSeek "timer
   stops when the answer starts" convention. CSS: `.reasoning-row-meta` (tabular-nums).

2. **Token-usage status** — `components/analysis/EnsembleProgressChat.tsx`
   Floor header now shows `N seats · ~X tok` from `runStats.promptTokens +
   completionTokens` (Hermes Desktop's clickable context/`/usage` meter, reduced to a
   glanceable readout).

3. **Idle "pulsing orb" breathing** — `index.css`
   `debate-bot-idle` gains a slow scale 1 → 1.03 (Grok's praised "pulsing orb" idle,
   replacing a translate-only bob).

4. **Squash-not-rotate thinking eyes** — `index.css`
   `debate-bot-scan` now squashes the eyes (`scaleY .72/.55`) with a subtle glance instead
   of wide rigid rotation — the exact Grok-fan correction ("left eye *rotates* instead of
   *squishing*").

5. **Per-avatar "Thought for Ns" live timer** — `components/analysis/DebateBotAvatar.tsx` + `index.css`
   A tiny monospace `N.Ns` readout ticks under each bot while it's thinking and stops the
   instant the answer starts streaming (Grok's "timer stops when the answer starts").
   Decorative only — the accessible frozen duration stays in the ReasoningRow.

Already present (verified, no change needed): the live step tracker (phase rail
Openings · Rebuttals · Verdict) and the Stop button (Send/Stop toggle + Esc).

---

## 3. Hermes Desktop — what to borrow (verified from `apps/desktop/` README, DESIGN.md, AGENTS.md, official docs)

**Layout**: chat-first window · left sidebar (Chat/Skills/Messaging/Artifacts/Projects) ·
right rail (live preview pane + file browser + persistent terminal) · bottom status bar ·
session tabs · `Ctrl/Cmd+J` preview toggle.

**Most transferable ideas** (ranked by leverage ÷ effort):

1. **Structured tool-call chips, not raw JSON** — compact mono chip (icon + one-line status
   + live "…") that streams updates; we already have a `toolChip` on the stage to extend.
2. **"Motion follows state, never delays state"** — animate an avatar only while that model
   streams; static when idle; gate behind `prefers-reduced-motion`. (Already our model.)
3. **Bottom status bar with a live "% full" context meter** — click for token breakdown by
   category. We added the token readout (step 2); the clickable breakdown is the next increment.
4. **Conversation timeline rail** — slim edge markers per turn; hover → list, click → jump.
   Cheap and high-value for long multi-turn debates.
5. **Right-hand preview rail** — renders a debater's tool output (chart/market data) live
   while the transcript streams ("their signature feature").
6. **Never literal "Loading…"** — animated math/ascii glyph instead (our streaming dots
   already comply; no literal "Loading…" text exists in the debate/shared surface).
7. **Flat, no card-in-card; one hairline + whitespace** — stop nesting rounded boxes around
   each bot card.
8. **No focus-steal on tool completion** — update a badge, never yank scroll or auto-open a pane.
9. **Staggered exits with delayed outer fade** for stage/round transitions.

**Anti-patterns to keep avoiding**: YOLO (approval-bypass) toggle, native `title=` on buttons,
`transition-all` on hot paths, auto-opening panes, card-in-card, hidden hold-to-drag gestures.

---

## 4. DeepSeek — what to borrow (verified from api-docs + GUI sources)

- **"Thought for N seconds"** collapsed line + **streamed chain-of-thought** in a
  *visually subordinate* style (grey) — the answer/verdict stays bright. (Implemented in
  step 1; the dim-reasoning/bright-verdict contrast is already our ReasoningRow styling.)
- **Two-phase reveal**: reasoning counter completes → reasoning collapses/greys → final
  answer streams in. High-value next step for our "thinking → verdict" transition.
- **DeepThink / Search toggle chips** in the compose row → could mirror as "per-model
  think" pills next to the debate input.
- **Single restrained accent** (DeepSeek blue `#4D6BFE`) strictly for "thinking" state —
  a *policy* decision, not code; our `.status-surface` scope is the natural home.
- **Per-avatar "Thought for Ns"** under each bot (maps DeepSeek's single-thread idiom to N
  avatars) — **now implemented** (step 5).

**Anti-patterns**: unbounded reasoning walls-of-text, "thinking on" as always-better,
raw CoT as primary content, unreliable mode toggles, citation overload.

---

## 5. Prioritized next steps (backlog)

1. **Two-phase thinking→verdict reveal** in the reasoning row (DeepSeek idea 4/5).
2. **Clickable token-breakdown** in the Floor status readout (Hermes context meter).
3. **Structured tool-call chip** upgrade + **conversation timeline rail** (Hermes ideas 1 & 4).
4. **Gaze toward the active speaker** and **randomized blink/wink** on the avatars (Grok ideas 5/6).
5. **Single morphing-disc** (one SVG whose eyes/ring/slash morph between states) — the biggest premium-feel upgrade.
6. Chrome-reduction pass on the analysis card; context hygiene for `reasoning_content`
   (remaining roadmap items).

---

## 6. Verification

- `npm run typecheck` — 0 errors.
- `npx vitest run` — **96 files passed, 1022 passed, 11 skipped, 0 failed.**
- `npm run build` — ✓ built in ~15.8s (only a pre-existing >500 kB chunk-size warning).

---

## Sources (primary, actually searched/opened)

- Hermes Desktop docs: <https://hermes-agent.nousresearch.com/docs/user-guide/desktop>
- Hermes Desktop stack + boundaries: <https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/README.md>
- Hermes Desktop design system: <https://raw.githubusercontent.com/NousResearch/hermes-agent/main/apps/desktop/DESIGN.md>
- Hermes Desktop AGENTS.md (state authority, no focus-steal): <https://raw.githubusercontent.com/NousResearch/hermes-agent/main/apps/desktop/AGENTS.md>
- Hermes launch coverage: <https://www.marktechpost.com/2026/06/03/nous-research-releases-hermes-desktop-a-native-cross-platform-front-end-for-hermes-agent-v0-15-2-with-streaming-tool-output/>
- DeepSeek app announcement (web + mobile only): <https://api-docs.deepseek.com/news/news250115/>
- DeepSeek Thinking Mode: <https://api-docs.deepseek.com/guides/thinking_mode/>
- DeepSeek "DeepThink" toggle: <https://api-docs.deepseek.com/news/news250821/>
- Grok bot "made in code, morphs smoothly" (xAI designer Benji Taylor): <https://x.com/benjitaylor/status/2087227155076046995>
- xAI "Grok inside Hermes Agent": <https://x.ai/news/grok-hermes>
- Full per-agent source lists: `.cluster/debate-ui-optimization/subagent_05_grok.md`, `subagent_06_hermes.md`, `subagent_07_hermes_desktop.md`, `subagent_08_deepseek_desktop.md`
