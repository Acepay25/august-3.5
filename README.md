# August 3.5

React + TypeScript trading analysis app. Users attach chart screenshots (and optional notes); configured AI models produce a structured trade ticket. In **Team** mode, up to three analysts debate on a visible floor and a moderator writes the verdict.

There is **no `src/` directory** — application code lives at the repo root. Current app version is in `package.json` and `constants/version.ts` (keep those in sync).

## What it does

- **Team analysis (ensemble debate)** — Up to three models open, rebut, and answer clarification. A moderator chairs the floor (not a fourth Gantt row). Live UI: phase dots, moderator rail (`asking` / `posed` / `verdict`), three analyst lanes with latest thought. Finished card: **signal | board** (levels + each analyst Long/Neutral/Short + merge line), then a briefing with tabs `Openings | Rebuttals | Clarification | Verdict | All`. Trajectory / run log starts collapsed.
- **Casual chat** — Single-model chat when Team is off (`Settings` or the command palette).
- **Trading signal card** — Direction, confidence, **R:R** (from `rrRatio` or computed from entry / SL / first TP), levels table with hit odds, invalidation, contract. Semantic colors only inside `.status-surface` / `.analysis-card`.
- **Accuracy mode** — Locked routing with sub-modes (`original` / `pure_ai`). Pure AI can optionally keep playbook, families, and memory.
- **Analyst lenses** — Optional Macro / Technical / Risk roles on ensemble seats (`Settings → Roles`).
- **Hybrid intelligence** — Live Binance OHLCV + indicators on `15m / 1h / 4h / 1d` injected as tables (not a `5m` lane anymore).
- **Monte Carlo** — GBM paths in a Web Worker (`services/analysis/monteCarlo.worker.ts`) with a sync fallback.
- **Watch list** — Pin open setups; ticks and optional re-debate when price moves.
- **Compare runs** — Side-by-side stats (grade, gate, MC, tokens, estimated cost) vs the previous analysis in the thread.
- **Journal** — Analysis → log → outcome → post-mortem. Outcome autopilot can detect TP/SL hits. CSV / HTML export.
- **Learning / memory** — Pattern memory, confidence calibration, IF/THEN skills, notebook files (`Settings → Memory`), retrieval shown on the card (`memoryRetrieved`).
- **Playbooks & prompt registry** — Uploaded strategy books and editable prompt layers (`Settings → Playbooks` / `Registry`).
- **Session usage** — Token / cost estimates for the session (`Settings`, `utils/sessionUsage.ts`). Optional per-model USD/1k on the provider.
- **Live market** — Binance chart, pattern scan, price alerts.
- **Desktop / web / Android** — Electron (encrypted keys via `safeStorage`), Vite PWA, Capacitor.

## How analysis is wired (for other developers)

1. UI (`App.tsx`, `hooks/useAnalysisPipeline.ts`) builds the run: images, hybrid packet, memory retrieval, ensemble roster.
2. **All AI I/O** goes through `services/providers/GenericProviderService.ts` (formats: `chat_completions` / `messages` / `responses`; retry + 120s timeout) and `services/providers/GenericAnalysisService.ts`.
3. There are **no hardcoded provider clients**. Legacy per-provider services were removed. `AIProvider` ids are leftovers for old rows only.
4. Users add providers in **Settings → Providers**. Config is `provider_configs_v1` via `ProviderConfigService`. Resolve models with `utils/providerUtils.ts` (`getFirstReadyProvider`, `sortModelsFreeFirst`, `mergeDiscoveredModels`).
5. Analysis JSON is coerced in `schemas/tradeAnalysis.ts`, then sanitized (`sanitizeTradeAnalysis`). Persist `modelsUsed: Record<providerId, modelId>` — do not add new `geminiModelUsed`-style fields.
6. Debate turns stream into `message.debateTurns` / `ensembleProgress` / `activeDebateSpeakers`. The live strip is `EnsembleProgressChat`; the briefing is `DebateChat`; the ticket is `TradingSignalCard` + `DebateSummary` (board).

### Providers at runtime

| Piece | Where |
|--------|--------|
| CRUD + encrypt/decrypt | `services/infrastructure/ProviderConfigService.ts` |
| Electron `safeStorage` | `electron/preload.cjs` → main process |
| Dev CORS proxy + SSE usage | `vite.config.ts` (`stream_options.include_usage` on streams) |
| Vision / moderator / memory seats | Settings → Models (changing the provider list must **not** overwrite vision/moderator unless the user edits those seats) |

API keys are **not** read from `.env` at runtime. Desktop encrypts keys at rest; web/Capacitor store plaintext in Preferences.

## UI conventions

- Tailwind v4 monochrome zinc. Color tokens in `index.css` `@theme` are remapped to gray.
- **Exception:** `.status-surface` and `.analysis-card` restore real semantic colors (emerald WIN, rose LOSS, amber warning). Use that scope only when status meaning would be lost.
- Do not put cyan/blue rings on the trade signal. Jump-to-analysis must not paint a blue edge.

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI | React 19, TypeScript (`strict`), Tailwind CSS v4 |
| Charts | TradingView widget, lightweight-charts, recharts |
| AI | Generic client (OpenAI-compatible, Anthropic messages, Responses) |
| Market data | Binance REST / WebSocket |
| Storage | SQLite (Capacitor native), IndexedDB (web), Preferences |
| Build | Vite 7, Node **22+** (`engines.node`) |
| Desktop | Electron (`electron/main.cjs`, auto-update) |
| Mobile | Capacitor (Android) |
| Tests | Vitest (jsdom), Playwright (`e2e/`) |

## Getting started

```bash
npm install
npm run dev              # http://localhost:3000
```

Open **Settings → Providers**, add a base URL + key + model ids, enable the provider. Discover models hits `/models` (free ids sort first). Assign vision, moderator, and memory on **Settings → Models**.

No required env vars. Optional: `PORT` for `electron:dev` (default 3000).

```bash
npm run electron:dev     # Vite + Electron window
npm run typecheck        # tsc --noEmit
npm run typecheck:scripts
npm run test             # vitest run
npm run lint             # errors only; warnings are OK
npm run build            # tsc --noEmit && vite build
npm run preview
npm run e2e              # npx playwright install chromium first
```

## Releases

`.github/workflows/ci.yml` is the gate on every `main` push/PR (typecheck, scripts typecheck, tests, lint, Vite build).

`.github/workflows/release.yml` runs on a **`v*` tag push**. It assumes CI already passed: validate tag === `package.json` version, Vite build, Playwright smoke, then `electron-builder --win --publish always`. Do not retag to “fix CI” — fix `main` first.

The tag **must** equal `v` + `package.json` `version` (and `constants/version.ts` `APP_VERSION`). Example:

```bash
# after bumping package.json, package-lock.json, and constants/version.ts
git tag v1.0.14 && git push origin main v1.0.14
```

## Project structure

```
├── App.tsx                      # Shell: conversations, settings, pipeline wiring (large)
├── components/                  # One folder per domain
│   ├── analysis/                # Signal card, debate floor, live strip, compare, watch
│   ├── chat/                    # ChatArea, MessageItem, input, team modal
│   ├── dashboards/              # Win rate, model performance, learning
│   ├── journal/                 # Trade log, saved analyses
│   ├── market/                  # Live market
│   ├── settings/                # Providers, models, memory files, session usage
│   └── shared/                  # Header, ModelPicker, chrome
├── hooks/                       # useAnalysisPipeline, useCompareRuns, trade logging, …
├── services/
│   ├── providers/               # GenericProviderService + GenericAnalysisService only
│   ├── analysis/                # Hybrid data, TA, Monte Carlo worker
│   ├── backtesting/             # Backtests, scenario simulator
│   ├── learning/                # Skills, notebooks, retrieval
│   ├── ui/                      # Autopilot, alerts, share image, lenses
│   ├── validation/              # Gate, calibration
│   └── infrastructure/          # SQLite, Preferences, ProviderConfig, backups
├── constants/                   # Prompts, version
├── schemas/                     # zod at the AI boundary
├── types/                       # analysis, message, provider, trade, …
├── utils/                       # sanitizers, providerUtils, runUsage, runGantt
├── tests/                       # debate, schema, financial math, provider config
├── scripts/                     # Manual / CI scripts (must typecheck: HybridTimeframe is 15m/1h/4h/1d)
├── e2e/                         # Playwright
└── electron/                    # main.cjs, preload.cjs
```

## Tests worth knowing

| Suite | Why |
|-------|-----|
| `tests/debateFlow.test.ts` | Ensemble generators with a mocked transport |
| `tests/debateChat.test.tsx` / `ensembleProgressChat.test.tsx` | Floor + live strip |
| `tests/tradingSignalCard.test.tsx` | Ticket, R:R, hit odds |
| `tests/tradeAnalysisSchema.test.ts` | AI JSON coercion |
| `tests/financialMath.test.ts` | Leverage / probability clamps |
| `tests/providerConfigService.test.ts` | Provider CRUD (mocked Preferences) |
| `tests/outcomeAutopilot.test.ts` | TP/SL auto-detect |

When you change a feature, extend the matching suite, then `npm run typecheck && npm run test && npm run build`.

## Agent / contributor notes

Coding conventions for agents live in [`AGENTS.md`](./AGENTS.md). Prompt layers are documented in [`PROMPTS.md`](./PROMPTS.md).

Do not commit API keys. Do not reintroduce per-provider service files. Do not surface raw provider error bodies — map them in `toFriendlyProviderError`.
