# Enhancement Roadmap — DeepSeek Harness & Hermes inspired, modern-simple UI

Date: 2026-08-20 · App: August 3.5 (React + TypeScript, monochrome zinc theme)

Source research: `.cluster/debate-ui-optimization/subagent_01.md` (DeepSeek Harness + fast-feel), `subagent_02.md` (Hermes + thinking display), `subagent_04.md` (UI review).

---

## A. What deepseek-harness actually gives us (the borrowable idea)

`deepseek-ai/deepseek-harness` is an **agent harness** ("Everything is a plugin", Cordis), not a chat app. Its one transferable UX idea is **visible plan + approval gating**:

1. **Live step tracker for the debate pipeline.** A compact step list (Openings → Rebuttals → Verdict) with per-step status (done / in-progress / pending), elapsed time, and the active seat. Converts an opaque 1–3 min run into visible progress. *Effort: medium — the app already streams `DebateRunEvent`; render a step rail instead of only the run log.*
2. **Approval gating for expensive/irreversible actions.** Ask before high-cost ops (full backtest sweep, heavy Monte Carlo, strategy writes) rather than firing silently — mirrors the harness's "asks before operations requiring approval." *Effort: low — wrap the existing `confirmDialog`.*
3. **Hot config** (Settings → Models without restart) — already present.

## B. Hermes / DeepSeek thinking & streaming enhancements

1. **"Thought for N seconds · k tokens" header.** The `ReasoningRow` already streams then auto-collapses; add duration + token metadata to the header (o1/Open WebUI convention). *Effort: low — measure `t0` on first reasoning delta.*
2. **Pre-first-token caret / skeleton bubble.** The #1 TTFT lever: show a blinking caret or shimmer assistant bubble immediately on send. *Effort: low — `streaming-dots` exists; add a skeleton variant before first token.*
3. **Stop button.** `AbortController` → keep partial text, map `AbortError` to a benign "stopped" state (not an error toast) in `GenericProviderService`. *Effort: medium.*
4. **Stream `reasoning_content` separately; don't persist CoT into follow-up context** unless a tool call happened (DeepSeek explicitly ignores it otherwise; persisting it bloats context and hurts later TTFT). *Effort: medium — context-hygiene change.*
5. **Incremental markdown + memoized history.** Parse only the growing block; `React.memo` settled messages so a token append only re-renders the streaming node (critical at ~320 tok/s). *Effort: medium-high.*
6. **Auto-scroll only when near bottom** (pin scroll + "jump to latest" chip). *Effort: low.*

## C. Modern, simple UI direction (the "look")

The app is already monochrome (good — that's the right foundation). To get the DeepSeek/Hermes "calm, modern" feel:

1. **Less chrome, more whitespace.** Reduce boxed borders and hairline separators; use spacing + type weight instead of lines to separate sections. Secondary panels (memory gate, run log, replay) start collapsed.
2. **Typography hierarchy, not decorations.** One sans family, clear weight steps (11px overline label → 15px body → 18–20px verdict), generous `leading`. Remove competing uppercase/label noise.
3. **One primary action per card.** Move Compare / Re-run / Watch / Replay behind a "⋯" overflow menu; keep Log trade + Retry as the visible primary.
4. **Motion only for state, and faster.** Keep the reduced-motion discipline; the snappier keyframes from this sprint make streaming feel alive, not busy.
5. **Answer-first layout.** Thinking collapses to a one-line summary; the verdict/plan is the visual peak; provenance (models used, tokens, timing) is de-emphasized into a footer strip.
6. **Status color stays scoped.** Keep WIN/LOSS/amber only inside `.status-surface`; everything else stays gray — this restraint *is* the modern look.

## D. Priority order (what to build first)

1. Live debate step tracker (biggest perceived-productivity win).
2. Pre-first-token skeleton + "Thought for Ns" metadata (cheap, visible polish).
3. Stop button + AbortError handling.
4. Chrome-reduction pass on the analysis card (the modernization).
5. Context hygiene for `reasoning_content`.

Items 1–2 can land in a single focused sprint without touching the analysis engine.
