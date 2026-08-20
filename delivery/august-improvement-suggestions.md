# August 3.5 — New improvement suggestions (DeepSeek + Hermes feature deep-research)

Researched 2026-08-20 from primary sources (official docs/repos). Every claim cited; items
flagged `[UNVERIFIED]` where the source didn't confirm it. This synthesizes two deep-research
passes (DeepSeek features + Hermes features) into one de-duplicated, ranked list for August.

---

## 1. The highest-leverage themes

Two themes dominate the findings: **context cost control** (ensemble debates burn tokens
across many models — DeepSeek's prefix-caching + Hermes' auto-compression attack exactly
this) and **trusted learning** (both products gate what the agent auto-remembers). The rest
is cost-tier routing, structured output, and a few UX wins.

---

## 2. Ranked improvement suggestions

| # | Suggestion | Why it matters | How / where |
|---|---|---|---|
| 1 | **Prefix-cache the shared debate context** | Multi-seat debates send the same system prompt + rules + symbol block to every model; ordering it first and byte-identical makes seats 2..N cache hits (DeepSeek: up to ~90% input savings, on by default). | `constants/prompts` (debate builders), `services/providers/GenericProviderService.ts` |
| 2 | **Write-approval gate on learned rules/pattern memory** | Kills the "agent silently saved a wrong assumption" failure mode. Hermes gates ALL memory/skill writes behind approve/reject. | `services/learning/`, `Preferences` (a flag + pending-approval queue) |
| 3 | **Learning Graph UI (All / Used / Learned)** | Makes August's trade-log learning visible: which learned rules actually fired later vs. dead weight, with prune. | `services/learning/` + new `components/learning/MemoryGraph.tsx` |
| 4 | **Live context/token meter + auto-compression for debates** | Context is the #1 hidden cost of ensemble debates. Auto-summarize middle turns (keep first N + last N) at a threshold. | `components/chat/ChatArea.tsx`, `services/infrastructure/` context manager |
| 5 | **Two-tier model routing (cheap workers + frontier moderator)** | Bull/bear/technical seats on cheap models (e.g. `deepseek-v4-flash`), moderator verdict on a frontier/reasoning model. | `services/ui/debates.ts`, `services/providers/GenericAnalysisService.ts` |
| 6 | **Pre-debate agenda approval (Plan Mode)** | A cheap planner emits the agenda (models, data slices, verdict criteria) → user approves → execute. Cuts wasted expensive multi-model calls. | `services/ui/debates.ts`, `hooks/useAnalysisPipeline.ts` |
| 7 | **Capture `reasoning_content` as a first-class artifact** | Per-seat chain-of-thought becomes auditable/diffable — a trust differentiator. | `types/`, `GenericAnalysisService.ts`, debate components |
| 8 | **Moderator tool round (or Mixture-of-Agents)** | Moderator re-queries price/indicator before settling → grounded verdicts (not hallucinated levels). | `services/ui/debates.ts`, `services/analysis` |
| 9 | **Strict function-calling / JSON mode for the trade schema** | Reduces parse-failure retries (zod boundary already exists; strict schema needs all-required fields). | `schemas/tradeAnalysis.ts`, `GenericAnalysisService.ts` |
| 10 | **Turn analysis rules/playbooks into versioned, on-demand "skills"** | Progressive-disclosure SKILL.md-style docs, conditionally loaded (e.g. scalping playbook only when timeframe ≤15m) instead of always-in-prompt. | `services/learning/rules.ts` → `constants/prompts/` |
| 11 | **Isolated-context parallel analysis branches** | Spawn analysis/backtest branches with fresh context; only the summary re-enters. (`delegate_task` pattern.) | `hooks/useAnalysisPipeline.ts`, new `services/analysis/orchestrator.ts` |
| 12 | **Interrupt-and-redirect mid-analysis** | Stop a running Monte Carlo/backtest and redirect ("ignore WMT, focus NVDA") without losing work. | `services/analysis/monteCarlo.worker.ts`, progress surfaces |
| 13 | **Append-only, replayable trade/debate log** | Fork a scenario, replay a debate (harness's forkable append-only log). | `services/infrastructure` (SQLite), `services/learning` |
| 14 | **OCR/vision import for broker statements & charts** | DeepSeek-OCR ~10× token compression vs raw text; preserves tables. | `services/analysis`, trade-log import |
| 15 | **Scheduled routines (daily scan / nightly backtest)** | Natural-language cron delivering results to chat. | new `services/infrastructure/scheduler.ts`, `electron/main.cjs` |
| 16 | **`/learn`-style "distill a playbook from this session"** | One action turns a successful session into a reusable rule. | `services/learning/`, trade-log components |

---

## 3. Already implemented this session (context for what's left)

- Debate UI simplicity: flat thread view default (stage opt-in), "X/Y responding", "Round N/3",
  token-breakdown tooltip, "Thought for Ns" + per-avatar timer, reasoning collapse.
- Reasoning streaming ("Thought for Ns") is done → suggestion #7 is now "persist the CoT
  artifact", not "stream it".
- Attribution-only bubbles already satisfied (Run ledger collapsed).

---

## 4. Anti-patterns to avoid (consolidated)

- **No auto-persist learning without a gate** (Hermes' own docs call it a bug class).
- **No YOLO/auto-approve for anything near real orders** — autopilot stays confirm-not-execute.
- **Don't surface raw CoT verbatim** (R1 CoT is chaotic; show a summarized "thinking").
- **Don't assume the API can "deep search"** — wire your own market-data tool.
- **Don't copy the full plugin runtime / Bot Mode social layer** — copy the ideas, not the framework.
- **Don't overuse reasoning mode per seat** (CoT billed as output tokens).
- **Context-meter "theater" vs. mechanism** — ship threshold auto-compression, not the glyph grid.

---

## 5. Sources (primary)

DeepSeek: <https://api-docs.deepseek.com/guides/kv_cache/> (prefix caching), <https://api-docs.deepseek.com/guides/thinking_mode/>, <https://github.com/deepseek-ai/deepseek-harness> (plan+approve, plugin runtime), <https://api-docs.deepseek.com/guides/tool_calls/> + <https://api-docs.deepseek.com/guides/json_mode/>, <https://huggingface.co/deepseek-ai/DeepSeek-OCR>, <https://api-docs.deepseek.com/quick_start/pricing/>.

Hermes: <https://hermes-agent.nousresearch.com/docs/user-guide/features/memory> (memory + write_approval + session_search), <https://hermes-agent.nousresearch.com/docs/user-guide/features/skills>, <https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation>, <https://hermes-agent.nousresearch.com/docs/user-guide/features/mixture-of-agents>, <https://hermes-agent.nousresearch.com/docs/user-guide/cli> (context meter + compression), <https://hermes-agent.nousresearch.com/docs/user-guide/desktop> (Memory Graph).

Full per-agent source lists: `.cluster/debate-ui-optimization/subagent_10_deepseek_features.md`, `.cluster/debate-ui-optimization/subagent_11_hermes_features.md`.
