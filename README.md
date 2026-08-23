# August 3.5

August 3.5 is a **local-first AI trading harness**: a React + TypeScript desktop/web
app where an ensemble of AI analysts debates a trade setup under an explicit
harness contract, a moderator issues the binding verdict, and every outcome feeds
a self-auditing memory loop (skills + doctrine) that is re-verified against the
trade journal.

Code lives at the repository root (no `src/` directory).

## How it works

```
user setup → Gate Scan (confidence cap / family pre-filter)
           → analyst ensemble (parallel, per-seat temperature sampling)
           → real debate (speculative rebuttal pump, devil's advocate rotation,
             sealed conviction auction, clarification cycles)
           → moderator verdict (+ seat-trust calibration block,
             uncited verdicts forced Neutral by code)
           → zod-validated plan → Monte Carlo → journal
           → post-mortem → skill evidence → auto A/B skill evals → doctrine
```

- **Harness contract** (`constants/prompts/harnessContract.ts`) is the single
  source of truth for output/plan rules; prompts compose through
  `utils/composePrompt.ts` so the contract appears exactly once.
- **Memory** is a trader notebook (`services/learning/MemoryRetrievalService`):
  one narrative voice (doctrine), everything else ranked data under hard
  per-stage char budgets; skills escalate from candidate → confirmed → retired
  on journal evidence with time/regime decay; injection telemetry records what
  actually reached prompts.
- **Desk tools** (`services/analysis/DeskToolsService.ts`) give debate seats +
  moderator bounded live tools (derivatives, order book, liquidations, BTC
  context, session, price snapshot, web search) plus `recall` — pull-based
  search over their own notebook.

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
npm run test            # vitest run
npm run lint            # eslint (errors only)
npm run electron:dev    # Vite dev server + Electron window
npm run electron:build  # Windows installer
```

CI runs `tsc`, `vitest`, `vite build`, then `electron-builder --publish always`
on `v*` tags (`.github/workflows/release.yml`).

## Layout

| Path | Contents |
|---|---|
| `App.tsx` | main application component |
| `components/` | UI, one flat dir per domain (`chat/`, `analysis/`, `dashboards/`, …) |
| `hooks/` | `useAnalysisPipeline` (the send/debate engine) + supporting hooks |
| `services/` | providers, learning (memory/skills), backtesting, infrastructure |
| `constants/prompts/` | all model-facing prompts; `promptRegistry.ts` makes them user-editable |
| `schemas/` | zod boundary schemas for AI JSON |
| `tests/` | Vitest suites (debate flow, financial math, schema coercion, harness memory) |
| `electron/` | desktop shell (safeStorage, auto-update) |

## Docs

- `AGENTS.md` — conventions for coding agents working in this repo
- `changelog.md` — plain-English log of change rounds (newest first)
- `DEBATE_FLOW_PLAN.md` — verified map of the debate engine + enhancement plan
- `PROMPTS.md` — verbatim inventory of prompts sent to models

## License

MIT.
