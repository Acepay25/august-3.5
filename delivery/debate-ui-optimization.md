# Debate UI, Thinking Rendering & Debate-Flow Optimization — Delivery Report

Date: 2026-08-20 · Repo: `C:\Dev\august-3.5` (August 3.5, React + TypeScript)

## 1. What was asked vs. what was done

| Request | Outcome |
|---|---|
| Update the bot animation and the debating-UI stage | ✅ Polished (thinking pulse ring, speaking floor glow, live grid breathe, snappier timings) |
| Properly strip thinking + final output; show thinking in the bubble, final output in the chat area | ✅ Verified the pipeline strips correctly; kept the correct display path; reverted two changes that would have regressed it |
| Research Hermes + DeepSeek Harness for fast-feel UI/UX | ✅ Researched (see §5) — incl. an important correction about what deepseek-harness actually is |
| Suggest improvements for skills, tools, and a smoother debate flow | ✅ See §6 |
| "Three AIs output the same" → ensure no AI-response cache except tools | ✅ Root-caused + fixed; AI-response cache retired (see §4) |

## 2. Changed files

| File | Change | Why |
|---|---|---|
| `services/infrastructure/responseCache.ts` | Added a DEPRECATED/RETIRED header; module left as inert dead code | The AI-response cache had **zero production callers**; marking it retired prevents accidental reuse |
| `App.tsx` | Removed the `clearAllCaches` import + 2 call sites; replaced with a one-time `indexedDB.deleteDatabase('august-cache')` migration | No AI-response cache to clear anymore; deletes legacy rows only |
| `services/providers/GenericAnalysisService.ts` | `analyzeTradingView` now accepts `temperature?: number` (default 0.35) | Lets the ensemble pass a per-seat temperature |
| `hooks/useAnalysisPipeline.ts` | Added `seatTemperature()` (deterministic 0.55–0.85 per seat), a per-seat `temperature` in `buildAnalystParams`, stronger `independentSeatInstruction` with three `seatMandates`, and a **duplicate provider+model guard** in Normal mode | Fixes the "three identical outputs" symptom |
| `components/analysis/DebateBotAvatar.tsx` | Added a distinct **thinking pulse ring**; `ORBIT_DUR` 4.8s → 3.6s | Thinking state now has a ring (previously only speaking did); faster orbit |
| `components/analysis/DebateStage.tsx` | Root scene gets `is-live` class when `live` | Gates the live grid-breathe animation |
| `index.css` | Snappier keyframe durations (idle 3.2→2.6s, think 2→1.6s, speak 0.9→0.7s, sonar 1.6→1.2s, orbit 4.8→3.6s); thinking-ring styles; speaking floor-glow; live grid pulse | Perceived speed + legibility of thinking vs speaking |
| `components/chat/MessageItem.tsx` | `SmoothText` reveal ~55→~110 chars/s | Settled answers stop feeling laggy on load |

Reverted during review (restored original, because existing tests encode intentional behavior): the `ReasoningRow` settled-summary line, the verdict-prose live-gate removal, and the moderator-thinking union in `MessageItem.tsx`.

## 3. Root cause of "the three AIs output the same"

This was **not** an AI-response cache. The audit (`subagent_03.md`) found the AI-response cache already had zero production callers. The real causes, ranked:

1. **Duplicate provider+model could occupy multiple seats** in Normal (Lenses OFF) mode — identical model + identical prompt = identical output. `buildEnsembleAnalysts` *suffixed* duplicates (`#1`, `#2`) instead of blocking them.
2. **Identical system prompt when Lenses are OFF** — `rolePrompt` is `undefined`, so every seat got the same `MASTER_ANALYSIS_PROMPT`.
3. **Seat differentiation was only a soft user-prompt suffix** (`INDEPENDENT ANALYST SEAT N`).
4. **Temperature hardcoded 0.35** for all seats — determinism with near-identical prompts = near-identical text.

Fixes shipped: (4) per-seat temperature; (3) stronger distinct seat mandates; (1) hard block on duplicate provider+model with a toast. (2) system-level per-seat personas is recommended as a follow-up (§6).

## 4. Cache verdict — "no AI-response cache except tools"

- ✅ **No code path can serve a cached AI response.** `responseCache.ts` / `persistentCache.ts` are retired with zero production importers (repo-wide sweep confirmed; only the legacy test file references them). `GenericProviderService` / `GenericAnalysisService` / `ensembleService` contain no singleflight/dedup/caching.
- ✅ **The only caches that run are tool/data caches** (intended to stay): `DeskToolsService` (30s), `MarketDataService` (30s + in-flight dedup), `KlineService` (30s + coalescing), `CorrelationRiskService` (5m/1m), plus per-message OCR text. None dedupe model output.
- Note: the two cache files could not be deleted (a `Remove-Item` was denied by the safety guard), so they remain as inert, clearly-marked dead code.

## 5. Research findings (verified, with sources)

**DeepSeek Harness** — `deepseek-ai/deepseek-harness` is **not** an RL training harness; it is an open-source **agent harness** (`dsh`, "Everything is a plugin", Cordis-based, developer preview) with a coding-agent Web UI at `127.0.0.1:3080`. It does not contain consumer chat UX. Sources: [README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/README.md), [Web UI guide](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/guide/index.md).

**"Hermes agent"** — resolves to **Nous Research**: (a) [Hermes Agent](https://github.com/nousresearch/hermes-agent) (CLI/TUI agent framework), (b) the Hermes 4 model family's **hybrid `<think>`-tag reasoning** convention (most relevant to thinking display), (c) Nous Chat. Sources: [Hermes-4-70B card](https://huggingface.co/NousResearch/Hermes-4-70B), [technical report](https://nousresearch.com/wp-content/uploads/2025/08/Hermes_4_Technical_Report.pdf).

**Fast-feel patterns** (from `chat.deepseek.com` + DeepSeek API docs + LLM-UX practice; see `subagent_01.md`): stream deltas immediately; immediate pre-first-token feedback (caret/skeleton — attacks TTFT); stream then auto-collapse the thinking block to "Thought for Ns"; Stop button via `AbortController`; incremental markdown; throttle/batch token appends (~50ms/rAF); auto-scroll only when near bottom; memoize history / isolate the streaming node. The app already has `useRafThrottle` and a `ReasoningRow` that streams-then-collapses — the remaining wins are listed in §6.

**Thinking-display conventions** (`subagent_02.md`): o-series hides raw CoT (shows "Thought for Ns" + summary); Claude/DeepSeek/Qwen emit `thinking`/`reasoning_content`/`<think>` separately from the answer; Open WebUI/SillyTavern render a collapsible "Thought/Thinking" row. Best practice: stream the CoT live, auto-collapse on completion, render the answer pane tag-free, strip defensively (including QwQ's dangling `</think>` and mid-stream partial tags), and keep live CoT out of `aria-live` regions.

## 6. Improvement suggestions (skills, tools, debate flow)

**Already correct (keep):** 30s tool caches, rAF-throttled debate updates, stream-then-collapse thinking row, desk-tool cache cleared per debate.

**Recommended next (ranked by impact):**
1. **System-level per-seat personas in Normal mode.** Inject a distinct system `roleBlock` per seat (reuse the three `seatMandates`) instead of the shared `MASTER_ANALYSIS_PROMPT` when Lenses are OFF. System-prompt differentiation moves output far more than a trailing user sentence.
2. **Debate-round differentiation.** Rebuttals (0.35) and clarification (0.3) are seat-agnostic; seed the rebuttal system prompt with each seat's own opening position, or add a mild per-seat jitter, so matched openings don't re-converge.
3. **Pre-first-token feedback.** Show a blinking caret / skeleton assistant bubble immediately on send (already partly covered by `streaming-dots`); measure TTFT.
4. **Stop button.** Ensure `AbortController` abort maps to a benign "stopped" state in `GenericProviderService.toFriendlyProviderError` (not an error toast).
5. **Incremental markdown + memoized history.** Parse only the growing block; `React.memo` the settled messages so a token append only re-renders the streaming node.
6. **Thinking metadata.** Show "Thought for Ns · k tokens" in the `ReasoningRow` header when the provider reports reasoning duration/tokens.
7. **Skills (harness-native desk tools).** The desk-tool cache is the correct place for tool results; consider a per-run tool result digest surfaced as the stage `toolChip` (already wired via `liveToolEvents`).

## 7. Verification

- `npm run typecheck` → **0 errors** (exit 0).
- `npm run test` → **1022 passed · 11 skipped · 0 failed** (96 test files passed, 1 skipped).
- Independent code review (`review.md`): **Approve — no blocking defects**; 2 non-blocking risks on the (later-reverted) display changes were resolved by reverting to the original, test-encoded behavior.

## 8. How to verify in the app

1. `npm run dev` → run an ensemble debate with **three different models** in the Team picker.
2. Confirm the three seats produce visibly different analyses (per-seat temperature + distinct mandates).
3. Confirm trying to put the **same model in two slots** is blocked with "Distinct debate models required".
4. Confirm the Floor bots: thinking shows a pulse ring + orbit, speaking shows sonar rings + floor glow, and the grid breathes only while live.
5. Confirm moderator "Thinking" streams in the bubble and the final verdict renders under "Final output" once the plan binds.
