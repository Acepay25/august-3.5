# AGENTS.md

This file contains guidelines and commands for agentic coding agents working in this repository.

## Project Overview

August Trading is a React + TypeScript trading analysis application that uses multiple AI
providers to deliver trading insights, pattern recognition, and post-trade analysis.
The app features ensemble AI debates, accuracy mode validation, hybrid intelligence with
real-time market data, comprehensive trade logging with learning capabilities, and an
Electron desktop shell (with Capacitor for mobile). Code lives at the repository root
(no `src/` directory).

## Build Commands

```bash
npm run dev                 # Start development server on port 3000
npm run build               # tsc --noEmit && vite build (production)
npm run preview             # Preview production build locally
npm run typecheck           # tsc --noEmit
npm run test                # vitest run
npm run test:watch          # vitest watch mode
npm run lint                # eslint (errors only; warnings are tolerated)
npm run electron:dev        # Vite dev server + Electron window
npm run electron:build      # Build + package Windows installer
npm run electron:release    # Build + publish GitHub release (via release.yml on tag push)
```

CI (`.github/workflows/release.yml`) runs `tsc`, `vitest`, `vite build`, then
`electron-builder --publish always` whenever a `v*` tag is pushed.

## Project Structure

```
├── App.tsx                 # Main application component (large — split work welcome)
├── components/             # React UI components (flat, one dir per domain)
├── hooks/                  # Custom hooks (useAnalysisPipeline, useTradeLogging, …)
├── services/               # AI provider integration & business logic
│   ├── providers/          # GenericProviderService + GenericAnalysisService (the only
│   │                       #   provider clients — legacy per-provider services were removed)
│   ├── analysis/           # Technical analysis, Monte Carlo (+ web worker), backtest data
│   ├── backtesting/        # Backtesting, model performance, live backtest
│   ├── learning/           # Pattern memory, rules, insights, global memory
│   ├── ui/                 # Autopilot, debates, price alerts, share-image generation
│   └── infrastructure/     # SQLite, Preferences, ProviderConfigService, backups
├── constants/              # models, prompts (per-domain files)
├── schemas/                # zod boundary schemas (tradeAnalysis, learning)
├── types/                  # TypeScript types (analysis, trade, provider, message, …)
├── utils/                  # analysisUtils, sanitizers, jsonUtils, providerUtils, …
├── tests/                  # Vitest suites (incl. debate pipeline + financial math)
└── electron/               # main.cjs + preload.cjs (desktop shell, safeStorage, auto-update)
```

## Providers are runtime-configured (dynamic migration)

There are NO hardcoded provider/model constants anymore. Providers are configured at
runtime by the user (Settings → Providers) and stored in Preferences
(`provider_configs_v1`) via `services/infrastructure/ProviderConfigService.ts`:

- `ProviderConfig.id` is a string (`'gemini'`, `'custom-1720000000'`, …). `AIProvider`
  is kept only as a legacy const object of built-in ids.
- Everything resolves through `utils/providerUtils.ts` (`getFirstReadyProvider`,
  `buildModelIdToName`, `buildProviderNameToId`) and `ProviderConfigService.getReadyProviders`.
- All AI calls go through `services/providers/GenericProviderService.ts` (3 API formats:
  chat_completions / messages / responses; retry + 120s timeout built in) and
  `services/providers/GenericAnalysisService.ts` (analysis, post-mortem, vision, memory).
- Analysis/journal data carries `modelsUsed: Record<providerId, modelId>`; legacy
  per-provider fields (`geminiModelUsed`, …) are READ-ONLY fallbacks for historical rows.
- On desktop, API keys are encrypted at rest via Electron `safeStorage` (bridge in
  `electron/preload.cjs` → `ProviderConfigService` encrypts on save, decrypts on load;
  web/Capacitor keep plaintext).

## Code Style Guidelines

### TypeScript & Types
- `strict: true` — all functions must have return types
- Import types from `types/` — don't redefine common types
- Interfaces for object shapes, unions for simple string constants
- zod schemas in `schemas/` for AI-boundary validation (lenient coercion +
  semantic fixups live in `schemas/tradeAnalysis.ts`)

### Import Organization
```typescript
// 1. React & UI libraries
import React, { useState, useEffect } from 'react';

// 2. Internal types (always first)
import { Message, TradeAnalysis } from './types';

// 3. Internal services (alphabetical)
import * as dbService from './services/dbService';
import { ProviderConfigService } from './services/infrastructure/ProviderConfigService';

// 4. Internal components (alphabetical)
import { ChatArea } from './components/chat/ChatArea';

// 5. Utilities (alphabetical)
import { sanitizeAIResponse } from './utils/sanitizers';
```

### Component Patterns
- Functional components with hooks; `interface ComponentProps { … }`
- Extract complex logic into custom hooks (`hooks/`) or services
- `React.memo` for performance-critical components

### State Management
- `useState` for simple local state; `useCallback` for event handlers
- `useMemo` for expensive computations; refs for non-render values

### Error Handling
- Wrap async operations in try/catch; log with context
- Return fallback values for non-critical failures
- Provider errors are mapped to user-safe messages in `GenericProviderService`
  (`toFriendlyProviderError`) — never surface raw API error bodies

### Service Layer Architecture
- `GenericAnalysisService` is the single analysis service (parameterized by `ProviderConfig`)
- Sanitize all AI responses: `sanitizeAIResponse()`, `sanitizeTradeAnalysis()`
- Validate AI JSON at boundaries with `schemas/tradeAnalysis.ts`

### Database & Persistence
- SQLite via Capacitor for native, IndexedDB for web (through `SqliteService`)
- Preferences (`@capacitor/preferences`, localStorage fallback) for settings/keys
- Backups before major data operations (`BackupService`)

### Naming Conventions
- Components: PascalCase; functions/variables: camelCase; constants: UPPER_SNAKE_CASE
- Files: camelCase for services/utils, PascalCase for components

### Performance Guidelines
- Lazy-load heavy components with `React.lazy()` (see App.tsx imports)
- Virtualize long lists (react-virtuoso)
- Monte Carlo runs in a Web Worker (`services/analysis/monteCarlo.worker.ts`) with
  synchronous fallback (`runMonteCarloForSetupAsync`)
- Cache AI responses (`services/infrastructure/responseCache`)

### Security Best Practices
- Never commit API keys; `.env.local` is gitignored (and no longer read at runtime —
  keys are user-configured in-app)
- Sanitize AI responses before rendering
- Validate data from external sources (zod at boundaries)

## Testing Notes

`npm run test` (Vitest, jsdom). Key suites:
- `tests/debateFlow.test.ts` — ensemble debate generators with a mocked transport
- `tests/financialMath.test.ts` — leverage math, probability clamping
- `tests/tradeAnalysisSchema.test.ts` — AI-boundary schema coercion
- `tests/outcomeAutopilot.test.ts` — TP/SL auto-detection
- `tests/providerConfigService.test.ts` — provider CRUD (mocked Preferences)

When adding features: add/extend tests, verify in dev mode (`npm run dev`), then
`npm run typecheck && npm run test && npm run build`.

## Environment Variables

No API keys are required at build or runtime — providers are configured in-app
(Settings → Providers) and stored in Preferences (encrypted on desktop).

Optional build-time variables:
- `PORT` — dev server port for `electron:dev` (default 3000)

## Development Notes

- Vite 7 + Tailwind v4. Theme is **Minara-derived** (user decision, 2026-09-10 —
  this SUPERSEDES the earlier "monochrome zinc" doctrine): warm near-black chrome
  (page `#0b0b0a`, panels `zinc-900 #141412`, raised surfaces `zinc-800 #1f1f1c`,
  hairlines `zinc-700 #2f2f2f`), warm ink ramp, and REAL semantic colors defined
  once in `index.css` `@theme` — emerald = gains/up (`#07b56a` family),
  rose/red = losses/down (`#f75d5f` family), yellow/amber = warnings (`#f08800`).
  Neutral utility names (`zinc-*`, `cyan-*`) were intentionally kept so components
  recolor through the token block; do not re-add gray remappings for color families.
- **Brand gradient**: `--color-brand-start #eb53ff → --color-brand-mid #ff538e →
  --color-brand-end #ff9a32` is reserved for the wordmark, the active-nav indicator,
  and hero display type only — never for body text, tables, or chart fills.
- `.status-surface` / `.analysis-card` classes remain in JSX for compatibility but
  no longer remap colors (the global theme IS semantic now).
- Typography: **Geist Variable** for UI (`--font-sans`), **DM Serif Text** for
  display/serif (`--font-serif` — hero headings, brand moments), JetBrains Mono
  for data. All self-hosted via @fontsource.
- Radius/motion tokens: `rounded-bubble` (12px, chat bubbles), `rounded-control`
  (8px, inputs/buttons), `--ease-snappy` + `.12s` transitions (Minara's numbers).
- React 19 strict mode; TypeScript strict
- Electron shell in `electron/` (custom `app://` protocol for production, safeStorage,
  auto-updater); Capacitor config for mobile