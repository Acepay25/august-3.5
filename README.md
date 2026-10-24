# August Trading

August Trading is a **local-first AI trading operator**: a React + TypeScript desktop/web
app that does the trader's work — prep, scan, plan, manage, journal, review, improve —
around a single AI seat that reasons over your notebook (skills + doctrine) and live
market data through a bounded set of tools. **The agent proposes; deterministic code
checks; the trader decides.** Closed trades feed a self-auditing memory loop that is
re-verified against the trade journal; settlement is human-confirmed today.

Code lives at the repository root (no `src/` directory).

## What it is not

August Trading **places no trades**. It has no exchange account access, no API
trading key, and no order-placement code path: every Binance call is a public
market-data endpoint. It reads, analyses, proposes, records and journals — a plan
is the model's reading of a chart, never an instruction to an exchange.
It is not financial advice.

Your journal, notebooks and drawings stay on your machine. When you send a
message, that message plus the market context for the instrument you are looking
at is sent to **the AI provider you configured**. See [PRIVACY.md](PRIVACY.md).

## How it works

```
trader sends → surface prompt (mandate + skills index + strategies + profile memory)
             → tool turn: the seat calls bounded desk tools (indicators, screener,
               market packet, chart view, journal, notebook recall, web search)
             → present_trade → zod-validated plan → deterministic gate
                (confidence cap, pattern memory, regime, volume)
             → the proposal card → THE TRADER DECIDES → R:R clamped at log time → journal
             → outcome engine detects the resolution; the trader confirms it
             → skill evidence → auto A/B skill evals → doctrine
```

- **Harness contract** (`constants/prompts/harnessContract.ts`) is the single
  source of truth for output/plan rules; prompts compose through
  `utils/composePrompt.ts` so the contract appears exactly once. It is composed
  on the analysis path and on every desk-tool chat turn, so the clause that
  explains a harness note reaches the surfaces that emit one.
- **Memory** is a trader notebook (`services/learning/MemoryRetrievalService`):
  one narrative voice (doctrine), everything else ranked data under hard
  per-stage char budgets; skills escalate from candidate → confirmed → retired
  on journal evidence with time/regime decay; injection telemetry records what
  the retrieval layer selected for each prompt.
- **Desk tools** (`services/analysis/DeskToolsService.ts`) give the seat bounded
  live tools (derivatives, order book, liquidations, BTC context, session,
  price snapshot, indicators, screener, Monte Carlo, web search) plus `recall` —
  pull-based search over the trader's own notebook.

## Providers

There are no hardcoded provider/model constants. Providers are configured at
runtime (Settings → Providers), stored in Preferences (`provider_configs_v1`,
encrypted at rest on desktop via Electron `safeStorage`), and every AI call goes
through `services/providers/GenericProviderService.ts` (chat_completions /
messages / responses wire formats, retry + timeout built in).

## Commands

```bash
npm run dev             # dev server on port 3000
npm run build           # tsc --noEmit && vite build
npm run typecheck       # tsc --noEmit
npm run lint            # eslint, warnings capped by a ratchet (--max-warnings 385)
npm run check:contracts # the six pure-logic contracts (R:R math, retries,
                        #   harness marks, notebook pressure, compaction,
                        #   AI-boundary coercion) — node only, no suite
npm run electron:dev    # Vite dev server + Electron window
npm run electron:build  # Windows installer
```

CI runs `tsc`, both tooling parses, the flow-doc anchor gate, the contract
checks, the three browser
probes, `lint` and `vite build`, then on `v*` tags
`.github/workflows/release.yml` builds once (`--publish never`), verifies the
installer, and only then uploads the signed bytes with `gh release upload`.

## Layout

| Path | Contents |
|---|---|
| `App.tsx` | main application component |
| `components/` | UI, one directory per domain (`chat/`, `analysis/`, `dashboards/`, `journal/`, `learn/`, `trade/`, …) |
| `hooks/` | `useAnalysisPipeline` (the send path) + supporting hooks |
| `services/` | providers, learning (memory/skills), backtesting, infrastructure |
| `constants/prompts/` | all model-facing prompts; `promptRegistry.ts` makes them user-editable |
| `schemas/` | zod boundary schemas for AI JSON |
| `electron/` | desktop shell (safeStorage, auto-update) |

## Docs

- **[`docs/plan/`](docs/plan/README.md) — the plan**: the working list of what is still not
  implemented, the execution order with gates, and the evidence behind every claim
- `AGENTS.md` — conventions for coding agents working in this repo
- `changelog.md` — plain-English log of change rounds (newest first)
- `docs/ui-doctrine.md` — the rules the interface actually obeys, as a checklist
  you can apply to a diff
- `docs/learning-loop-map.md` — how skills, rules, notebook memory and the
  supervisor get written, retrieved and injected
- `docs/app-flow.md` — the living flow doc (with `docs/app-flow.html` as its
  printable view), every line number machine-checked by
  `npm run check-flow-doc-anchors`
- `docs/research/` — the harness-research corpus: three reference-repo syntheses
  (93 shard reports with per-file ledgers), the August baseline, twelve
  improvement proposals, and the independent audit of the run
- `PRIVACY.md` — every path by which data leaves the machine

## License

MIT — see [`LICENSE`](LICENSE). Bundled third-party material (e.g. the committed
Gradle wrapper JAR) is credited in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
