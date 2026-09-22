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
npm run typecheck:scripts   # tsc over scripts/** (tsconfig.scripts.json)
npm run typecheck:electron  # node --check electron/*.cjs — see caveat below
npm run test                # vitest run
npm run test:watch          # vitest watch mode
npm run test:coverage       # vitest run --coverage (CI has ratcheted thresholds)
npm run lint                # eslint WITH a max-warnings ratchet (see Code Style)
npm run lint:loose          # eslint without the cap, for a local cleanup pass
npm run e2e                 # playwright (5 smoke tests, drives `npm run dev`)
npm run boot-probe          # launch the built bundle in Chromium, fail on pageerror
npm run render-probe        # drive the running app in Chromium; assert rendered
                            #   ROW COUNTS per conversation (dock + Agents),
                            #   send order, reload persistence, that a settled
                            #   verdict + malformed persisted audit data drops no
                            #   row, that all six nav surfaces mount, that the
                            #   Learn and Journal surfaces have no INERT control
                            #   (each press must change text, open an overlay, or
                            #   route; already-selected controls and
                            #   browser-chrome actions like CSV export are
                            #   excluded), and that Settings → Data can back up /
                            #   export / import — plus zero pageerrors. Failures
                            #   leave a screenshot in .probe-artifacts/. Needs no
                            #   API key: it points the app at
                            #   scripts/mock-provider.cjs, a local loopback model
                            #   server. `boot-probe` asks "does it start"; this
                            #   asks "did every message actually appear, and does
                            #   every button do something".
npm run installer-smoke     # drive the PACKAGED exe; the strongest gate here
npm run electron:dev        # Vite dev server + Electron window
npm run electron:build      # Build + package Windows installer
npm run electron:release    # Build + publish GitHub release (via release.yml on tag push)
```

### What each gate does NOT catch

`tsconfig.json` excludes `electron/`, so **`npm run typecheck` never reads the
main process or preload** — a syntax break in `electron/main.cjs` passes tsc,
passes `vitest` (no test imports the shell), and only fails when a user launches
the packaged app. Run `npm run typecheck:electron` (wired into both CI and the
release gate) or `node --check` the file directly after editing it.

**Unit tests cannot see the transcript.** `tests/` mounts components in jsdom, so
a defect that only shows when a LIST of messages renders — a row dropped after
the second one, or a decorative panel throwing inside `messages.map()` and taking
every later message down with it — passes the whole suite green. Two finished
panels shipped unmounted for exactly this reason and no test noticed. Any change
to how a conversation renders must be checked with `npm run render-probe`, which
counts rendered rows in a real browser instead of asserting a component returned
the right thing. It now sweeps all six nav surfaces, the approvals inbox, the
Agents desk pane, and Settings → Data (back up / export / import), and asserts
zero pageerrors throughout. Two rules learned the hard way, both encoded in it:
**overlays mount outside `<main>`**, so measuring `<main>` after opening one
re-reports the previous surface and passes vacuously — assert the overlay's own
root; and **a check whose measurement is identical across two different states
is measuring the wrong thing.** Run it on an idle machine — alongside a build or
the full suite it reports blank surfaces that the app was seconds from filling.

CI (`.github/workflows/ci.yml`) runs `tsc`, `vitest`, `eslint`, the Playwright
smoke suite, `vite build`, `boot-probe` and `render-probe`. The release gate
(`.github/workflows/release.yml`) runs the same static + probe chain, adds
`installer-smoke` on the packaged exe, and only then builds and publishes —
`electron-builder --publish always` fires on a `v*` tag push. `render-probe` sits
in both because it is the only gate that can see a rendered row: unit tests
mount components in jsdom and cannot see a transcript drop one message out of a
list. Steps run sequentially, so it never measures a surface while a build is
competing for the machine.

## Project Structure

```
├── App.tsx                 # Main application component (large — split work welcome)
├── components/             # React UI components (flat, one dir per domain)
├── hooks/                  # Custom hooks (useAnalysisPipeline, useTradeLogging, …)
├── services/               # AI provider integration & business logic
│   ├── providers/          # GenericProviderService + GenericAnalysisService (the only
│   │                       #   provider clients — legacy per-provider services were removed),
│   │                       #   ensembleService (the debate engine)
│   ├── analysis/           # Technical analysis, Monte Carlo (+ web worker), desk tools
│   ├── backtesting/        # Backtesting, model performance, live backtest, outcomeEngine
│   ├── learning/           # Skills, pattern memory, rules, insights, global memory
│   ├── agents/             # Bot roster, seat personas, mailbox, routines, group rounds
│   ├── bots/               # Per-bot memory + system notes
│   ├── tools/              # toolForge (user/model-authored HTTPS tools)
│   ├── research/           # Fixed 4-stage web research plan
│   ├── trade/              # Trade journal actions + proposal parsing
│   ├── desk/               # Desk layout/roles only — no market data lives here
│   ├── automation/         # Scheduled automations (cron + run history)
│   ├── validation/         # Accuracy-mode validation, gate scoring
│   ├── ui/                 # Autopilot, debates, price alerts
│   └── infrastructure/     # SQLite, Preferences, ProviderConfigService, backups
├── constants/              # models, prompts (per-domain files), promptRegistry
├── schemas/                # zod boundary schemas (tradeAnalysis, learning)
├── shared/                 # providerRequestPolicy.cjs — the ONE wire policy,
│                           #   imported by renderer, vite dev proxy AND electron main
├── types/                  # analysis, trade, provider, progress, message, learning …
├── utils/                  # See "Canonical single-source modules" below
├── tests/                  # Vitest suites (370 files)
└── electron/               # main.cjs + preload.cjs (NOT covered by tsc)
```

### Canonical single-source modules

When you need one of these, use the existing module — a second implementation
is how the numbers drift apart:

- `utils/riskReward.ts` — the PLANNED risk:reward ratio (nearest target ÷ stop).
  The realized ratio in `BacktestingService` is a different question on purpose.
- `utils/runStatus.ts` — the run status vocabulary: one colour+word per state,
  error classification, and the error-text sanitizer. Never hardcode a status
  colour in a component.
- `utils/finishReason.ts` — normalizes the four providers' stop signals onto one
  `FinishReason`, and brackets a run's truncation tally. Read the ceiling with
  `peekTruncations()`; don't re-derive it from a missing regex match.
- `shared/providerRequestPolicy.cjs` — thinking gates, temperature, and
  provider URL host policy for all transports.
- `utils/harnessMarks.ts` — the one voice for text THIS app withholds from a
  model: the `DATA_UNAVAILABLE` sentinel, the clipping notes (which must name
  how much was kept vs existed), the spill receipt, and the fence legend built
  from those prefixes. Never hand-write a marker or describe one in a prompt —
  `tests/harnessMarks.test.ts` fails on either. It also owns `harnessTurn()`,
  which marks a harness-authored insertion that must travel in the `user` role:
  a seat cannot obey the split unless it can tell the trader's words from the
  harness's. Distinct from `finishReason.ts`, which answers the other question:
  "did the provider stop early?"
- `utils/composePrompt.ts` + `constants/promptRegistry.ts` — prompt layering.
- `utils/memoryBudget.ts` — the notebook's soft/trigger/hard byte caps and the
  one classifier for which tier applies. Pressure there REFUSES growth (new
  files at the trigger, all model notes at the hard cap); it never evicts,
  because nothing in that store is safe to evict. Don't add an eviction rule
  without first proving which bytes are regenerable.
- `services/learning/skillIdleLifecycle.ts` — the only clock that decides a
  skill stops being injected for silence. Suspension is `enabled: false` plus
  `meta.suspendedAt`, NOT a fourth `SkillStatus`: `skillEnabledFlag(meta)` is
  the one place `enabled` may be derived, and every write path must use it or
  an unrelated attribution write silently un-suspends the skill.
- `MemoryFilesService.getNotebookWriteFailure()` — the only place that knows a
  notebook write never reached disk. `setPreferenceObject` rejects on a full
  origin quota while the in-memory cache goes on serving the whole notebook, so
  every caller that catches-and-logs turns memory loss into an invisible state:
  the app, the notebook UI and the Health tab all read from that same cache.
  `persist` records the failure (quota vs error, bytes, streak), rethrows so no
  caller's handling changes, and clears on the next success. Never add a
  swallow-and-continue around a notebook write; surface it, like `memoryHealth`
  does.
- `ExportService.RAW_LOCAL_STORAGE_PREFIXES` — the key namespaces whose owners
  talk to `localStorage` directly (`profile_memory_v1_*`, `learning_rules_v2_*`,
  the `agents_*_v1_*` rosters, the calibration/performance/confluence stats).
  On web that IS the Preferences fallback; on NATIVE they are two different
  places, so reading them through `getPreferenceObject` exports nothing and
  restoring into Preferences writes where nothing reads. The one list drives
  both the export fallback read and the restore mirror — a new raw-localStorage
  store must be added there or it silently leaves no backup on mobile. Do not
  widen it "for safety": the WebView origin quota is shared, so shadow-copying
  Preferences-owned keys spends eviction-prone bytes on a copy nothing reads.
- `duplicateTextPairs` (`services/ui/EnsembleAnalystService.ts`) — the ONE
  gateway-echo detector (normalized character-trigram Jaccard ≥ 0.9, samples
  under 200 chars ignored). It answers by index so two callers can label the
  same fact differently: the transcript toast names models, the moderator block
  in `ensembleConsensus.ts` names seats and tells it not to count an echo twice.
  Do not write a third similarity function.

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
import { TradeView } from './components/trade/TradeView';

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
- Desk-tool results are cached within a run in
  `services/analysis/DeskToolsService.ts` (30s TTL, exported as
  `TOOL_CACHE_TTL_MS`; the cache write path itself is module-private).
  The only import surface is `clearDeskToolCache()`, called at each debate
  start. There is no generic AI-response cache (do not assume one exists)

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

- Vite 7 + Tailwind v4. Theme is **Minara-derived DARK** (user decision,
  2026-09-10; a light-theme experiment was tried the same day and REVERTED —
  the user wants black, matching Minara's actual trade screen. Do not
  re-flip to light). Warm near-black chrome
  (page `#0b0b0a`, panels `zinc-900 #141412`, raised surfaces `zinc-800 #1f1f1c`,
  hairlines `zinc-700 #2f2f2f`), warm ink ramp, and REAL semantic colors defined
  once in `index.css` `@theme` — emerald = gains/up (`#07b56a` family),
  rose/red = losses/down (`#f75d5f` family), yellow/amber = warnings (`#f08800`).
  Neutral utility names (`zinc-*`, `cyan-*`) were intentionally kept so components
  recolor through the token block; do not re-add gray remappings for color families.
- **Brand gradient**: `--color-brand-start #eb53ff → --color-brand-mid #ff538e →
  --color-brand-end #ff9a32` is reserved for the wordmark and the active-nav
  indicator only — never hero/body text, tables, or chart fills.
- `.status-surface` / `.analysis-card` were deleted from the JSX (2026-09-19).
  They matched no rule in `index.css` once the global theme became semantic, so
  they were dead tokens that made two component comments claim a behavior that
  no longer existed. Do not re-add them.
- Typography: **Geist Variable** for UI (`--font-sans`), **DM Serif Text** for
  display/serif (`--font-serif` — hero headings, brand moments), JetBrains Mono
  for data. All self-hosted via @fontsource.
- Radius/motion tokens: `rounded-bubble` (12px, chat bubbles), `rounded-control`
  (8px, inputs/buttons), `--ease-snappy` + `.12s` transitions (Minara's numbers).
- **An AI row is claimed by identity, never by provider+model.** `Message.botId`
  is stamped by the writers that answer *as* a bot (`useBotMailbox`,
  `botRoutine`), and `deskThread` drops only rows a bot positively owns.
  `threadForProvider` still falls back to the provider+model pair so pre-stamp
  history keeps rendering, but it excludes any row stamped for a different bot.
  Do not reintroduce a model-shaped claim: it deleted the trader's own answers
  from the one pane that shows them (they were claimed into a bot thread that
  never displayed them). `tests/deskThreadClaims.test.ts` pins both directions.
- React 19 strict mode; TypeScript strict
- Electron shell in `electron/` (custom `app://` protocol for production, safeStorage,
  auto-updater); Capacitor config for mobile