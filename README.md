# August 3.5

Advanced AI-powered cryptocurrency trading analysis terminal. August 3.5 orchestrates multiple AI providers in ensemble debates to deliver high-confidence trade setups, post-trade forensics, and a persistent learning system that improves over time.

## Features

- **Multi-AI Ensemble Analysis** — Any number of configured AI providers (Gemini, DeepSeek, Zhipu, Groq, OpenRouter, OpenAI, Grok, custom OpenAI-compatible endpoints) analyze charts simultaneously, then a moderator synthesizes a final verdict via a streamed debate with challenge rounds.
- **Accuracy Mode** — Locked model configurations for higher-accuracy analysis with sub-modes (original / pure AI).
- **Analyst Lens System** — Assign specialized roles (Macro, Technical, Risk) to ensemble members.
- **Hybrid Intelligence** — Real-time Binance market data + technical indicators injected into AI prompts.
- **Monte Carlo Validation** — 1000-path GBM simulations stress-test every trade setup (runs in a Web Worker, non-blocking).
- **Trade Journal** — Full lifecycle tracking: analysis → entry → outcome → post-mortem → insight extraction, with outcome autopilot (automatic TP/SL detection) and CSV / printable HTML report export.
- **Learning System** — Multi-layered memory: pattern recognition, confidence calibration, mistake detection, IF/THEN rule extraction, and cross-session learning.
- **Live Market** — Real-time Binance candlestick chart (TradingView), pattern detection, and price alerts.
- **Multi-Platform** — Web (PWA), Desktop (Electron), Mobile (Capacitor/Android).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 19, TypeScript, Tailwind CSS v4 (monochrome zinc theme) |
| Charts | TradingView widget, lightweight-charts, recharts |
| AI | OpenAI-compatible chat completions / Anthropic messages / Responses API via a single generic client |
| Market Data | Binance REST/WebSocket |
| Storage | SQLite (native via Capacitor), IndexedDB (web), Preferences (encrypted API keys on desktop via Electron safeStorage) |
| Build | Vite 7 |
| Desktop | Electron |
| Mobile | Capacitor (Android) |

## Getting Started

### Prerequisites

- Node.js 18+
- API keys for at least one AI provider (configured in-app — no env vars needed)

### Setup

```bash
npm install
npm run dev        # Web on http://localhost:3000
```

Then open **Settings → Providers**, add a provider (name, base URL, API key, model IDs) and enable it. The first-ready provider becomes the default for vision, moderation and memory.

> Note: there are no required environment variables. API keys are stored in-app (encrypted on the Electron desktop build). A `.env.local` file is not needed.

### Development

```bash
npm run dev             # Web (port 3000)
npm run electron:dev    # Desktop (Electron + Vite)
npm run test            # Vitest suite
npm run typecheck       # tsc --noEmit
npm run lint            # ESLint (errors only)
```

### Production Builds

```bash
npm run build                 # Web build (dist/)
npm run preview               # Preview production build locally
npm run electron:build        # Desktop installer (Windows NSIS)
npm run e2e                   # Playwright smoke tests (npx playwright install chromium first)
npx cap sync android && npx cap open android   # Android (via Capacitor)
```

### Releases

Tagging a `v*` tag and pushing triggers `.github/workflows/release.yml`: typecheck → tests → build → `electron-builder --publish always` (Windows installer published to a GitHub Release).

```bash
git tag v1.0.7 && git push origin main v1.0.7
```

## Project Structure

```
├── App.tsx                    # Main application component
├── index.tsx                  # Entry point
├── index.html                 # HTML shell
├── index.css                  # Tailwind v4 + monochrome @theme tokens
├── components/
│   ├── analysis/              # Analysis results, debate view, live streams
│   ├── chat/                  # Chat input, messages, conversation history
│   ├── dashboards/            # Analytics, win rate, model performance, learning
│   ├── journal/               # Trade log, performance review, saved analyses
│   ├── market/                # Live market, charts, probability widgets
│   ├── modals/                # Scenario simulator, data capture, trade modals
│   ├── settings/              # Settings menu, provider manager, lens config
│   └── shared/                # Header, icons, toast, error boundary
├── services/
│   ├── providers/             # GenericProviderService + GenericAnalysisService (single AI client)
│   ├── analysis/              # Market data, TA, Monte Carlo (+ web worker), confluence
│   ├── backtesting/           # Backtesting, model performance, SL optimizer
│   ├── learning/              # Memory, insights, rules, reinforcement
│   ├── ui/                    # Outcome autopilot, price alerts, trade sharing, lens
│   ├── validation/            # Gate keeper, calibration, data integrity
│   └── infrastructure/        # SQLite, Preferences, ProviderConfigService, backups
├── hooks/                     # Custom React hooks
├── constants/                 # Frameworks, family data, prompts
├── schemas/                   # zod boundary schemas (AI response validation)
├── utils/                     # JSON repair, sanitizers, provider utils, report export
├── tests/                     # Vitest suites
├── e2e/                       # Playwright smoke tests
└── electron/                  # Electron main + preload (safeStorage, auto-update)
```
