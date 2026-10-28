# AGENTS.md

This file contains guidelines and commands for agentic coding agents working in this repository.

## The Plan

**`docs/plan/` is the plan, and it is the place to look before proposing work.** It holds:

- `docs/plan/README.md` — the index, the five-phase execution order with the gate for every
  step, the owner questions with proposed defaults (three answered), and the rules for working it
- `docs/plan/open-items.md` — the working list: every open item the deleted plan corpus
  named, each with the `file:line` that proves it is still open, each mapped to the
  proposal that covers it
- `docs/plan/implementation-record.md` — what has already landed in a pass, where it landed,
  and which gate verified it
- `docs/plan/full-audit.md` — the evidence, all seven sources merged, with a section index
- `docs/plan/audit/` — the seven sources, individually

Two things to know before you touch it. **The plan is a proposal, not a decision** — 23 of its
items are rulings the trader must make, and the plan says which way it would recommend. And
**the `docs/analysis/` directory is scratch, not a home for anything durable** — it is
ignored by the lint config, and the four dated 2026-10-21 reports it still held were
removed from the index on 2026-10-23 (owner ruling D-10: the directory is untracked on
purpose). A plan that must survive belongs in `docs/plan/`.

**One place to look, one way to propose.** `docs/plan/` is the working list and
`docs/plan/full-audit.md` is the evidence behind it; a proposal must cite the id it
covers — the `O-nn` item in `docs/plan/open-items.md`, or the `E-nn` / `N-nn` proposal in
`docs/plan/audit/` — so the plan and the code cannot drift apart silently.
`docs/plan/implementation-record.md` says what has already landed, and how it was verified.

The previous audit's six reports lived on an `archive/prior-audit-2026-10-18` branch; the owner
deleted that branch on 2026-10-23. It could never have been merged — its one commit was a root
carrying nothing but `docs/`, so a merge would have restored the whole deleted `docs/analysis/`
tree — and rather than keep a second copy of a tree this repo has ruled untracked, it is gone.
The **live-data** findings it alone recorded survive as register rows: O-19/O-20/O-22 (the cost
model), O-28 (the click gate), O-115 (inverted weighting), O-23/O-24 (size and leverage).

## Project Overview

August Trading is a React + TypeScript trading analysis application that uses multiple AI
providers to deliver trading insights, pattern recognition, and post-trade analysis.
The app features single-seat, tool-driven analysis, trade-plan validation, hybrid intelligence with
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
npm run lint                # eslint WITH a max-warnings ratchet (see Code Style)
npm run lint:loose          # eslint without the cap, for a local cleanup pass
npm run boot-probe          # launch the built bundle in Chromium, fail on pageerror
npm run render-probe        # drive the running app in Chromium; assert rendered
                            #   ROW COUNTS per conversation (dock + Agents),
                            #   send order, reload persistence, that a settled
                            #   verdict + malformed persisted audit data drops no
                            #   row, that all four nav surfaces mount, that the
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
npm run skill-approval-probe  # drive the HUMAN ACTUATION path in Chromium: the
                            #   four skill-draft outcomes and the learning queue's
                            #   Apply, asserting the notebook BYTES after each click.
                            #   Nothing else proves a pressed "Save as skill" wrote a
                            #   file, that a name collision produced `-2.md` instead of
                            #   an unhandled rejection, or that a failed write leaves
                            #   the draft in the inbox. CI runs it after render-probe.
npm run installer-smoke     # drive the PACKAGED exe; the strongest gate here
npm run electron:dev        # Vite dev server + Electron window
npm run electron:build      # Build + package Windows installer
npm run electron:release    # REFUSES locally and explains how to release. CI-only
                            # on purpose: a local --publish skips every gate
                            # and ships the artifact users install. See
                            # release.yml — it builds, verifies, then publishes
                            # the signed bytes itself.
```

### What each gate does NOT catch

`tsconfig.json` lists only `**/*.ts` and `**/*.tsx` in `include`, so
**`npm run typecheck` does not read the main process or preload** — a syntax
break in `electron/main.cjs` passes tsc and only fails when a user launches
the packaged app. (`electron/` is not in `exclude`; it is out only because the
include globs don't match `.cjs`, and the one `.ts` file that used to pull
`electron/sseParser.cjs` into the program went with the test suite on
2026-10-23, so all three are unchecked now.) Run `npm run typecheck:electron`
(wired into both CI and the release gate) or `node --check` the file directly
after editing it.

**`npm run render-probe` is the only gate that can see a rendered row.** It
drives the built app in Chromium and counts what actually appeared, because a
compiler cannot see a component that returned clean and rendered nothing — two
finished panels shipped unmounted for exactly that reason. It sweeps all four nav
surfaces, the approvals inbox, the Agents desk pane and Settings → Data (back up /
export / import), Tab-focuses editable fields and reads back the computed focus
indicator (no other gate resolves `index.css`), and asserts zero pageerrors. Two
rules learned the hard way, both encoded in it: **overlays mount outside
`<main>`**, so measuring `<main>` after opening one re-reports the previous
surface and passes vacuously — assert the overlay's own root; and **a check whose
measurement is identical across two different states is measuring the wrong
thing.** Run it on an idle machine — alongside a build it reports blank surfaces
that the app was seconds from filling.

CI (`.github/workflows/ci.yml`) runs `tsc`, `typecheck:scripts`,
`typecheck:electron`, the flow-doc anchor gate, `check:contracts`, `eslint`,
`vite build`, `boot-probe`, `render-probe` and `skill-approval-probe`. The
release gate
(`.github/workflows/release.yml`) runs the same chain MINUS two of its steps —
no `check-flow-doc-anchors`, no `skill-approval-probe` — and adds
`installer-smoke` on the packaged exe plus the signing, source-map, signature
and updater-manifest checks, and only then builds and publishes. So a doc edit
that breaks the flow docs' line numbers fails CI but not the tag push. The same gate
re-measures the step names in this paragraph against the two workflow files, so a stale
figure here fails CI too.
Measured, not assumed — this set-difference prints the whole asymmetry:
`comm -13 <(grep -ohE "npm run [a-z0-9:._-]+" .github/workflows/release.yml | sort -u)`
`<(grep -ohE "npm run [a-z0-9:._-]+" .github/workflows/ci.yml | sort -u)`
→ `check-flow-doc-anchors`, `skill-approval-probe`, `typecheck`;
flip `comm -23` → `installer-smoke` is the only command release has and CI
lacks. `lint`, `typecheck:scripts`, `typecheck:electron`,
`build`, `boot-probe` and `render-probe` are in both. Release has no
bare `typecheck` step because `npm run build` starts with `tsc --noEmit`
A `v*` tag push runs `release.yml`, which builds ONCE with
`--publish never`, verifies the installer, and only then uploads the
manifest-named bytes with `gh release upload --clobber` (one build, one
publish, `GH_TOKEN` blanked during the signing gate). `render-probe` sits
in both because it is the only gate that can see a rendered row. Steps run sequentially, so it never measures a surface while a build is
competing for the machine.

## Project Structure

```
├── App.tsx                 # Main application component (large — split work welcome)
├── components/             # React UI components (one directory per domain)
├── hooks/                  # Custom hooks (useAnalysisPipeline, useTradeLogging, …)
├── services/               # AI provider integration & business logic
│   ├── providers/          # GenericProviderService + GenericAnalysisService (the only
│   │                       #   provider clients — legacy per-provider services and the
│   │                       #   debate engine were removed)
│   ├── analysis/           # Technical analysis, Monte Carlo (+ web worker), desk tools
│   ├── backtesting/        # Backtesting, model performance, live backtest, outcomeEngine
│   ├── learning/           # Skills, pattern memory, rules, insights, global memory
│   ├── agents/             # Bot roster, mailbox, group rounds
│   ├── bots/               # Per-bot memory + system notes
│   ├── tools/              # toolForge (user/model-authored HTTPS tools)
│   ├── trade/              # Trade journal actions + proposal parsing
│   ├── desk/               # The reduce-motion preference only — the 2D desk floor
│   │                       #   view and its seat layout were deleted (2026-10-18).
│   │                       #   No market data lives here.
│   ├── validation/         # Trade-plan validation + gate scoring (the service
│   │                       #   keeps its Accuracy* name; the Accuracy Mode toggle is gone)
│   ├── ui/                 # Outcome autopilot, auto-capture,
│   │                         #   algorithmic summaries, price alerts, veto ledger
│   └── infrastructure/     # SQLite, Preferences, ProviderConfigService, backups
├── constants/              # models, prompts (per-domain files), promptRegistry
├── schemas/                # zod boundary schemas (tradeAnalysis, learning)
├── shared/                 # providerRequestPolicy.cjs — the ONE wire policy,
│                           #   imported by renderer, vite dev proxy AND electron main
├── types/                  # analysis, trade, provider, progress, message, learning …
├── utils/                  # See "Canonical single-source modules" below
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
- `utils/turnStatus.ts` + `utils/toolKinds.ts` — what a turn is DOING, and the
  vocabulary the desk's tools are named in. `parseToolLine` is the ONE reader
  of the digest grammar the desk writes ("calling order book…" / "order book ·
  detail"), and `pairToolRows` is the ONE pairing of a call with its result —
  ONE PAIRED ROW IS ONE CALL, because the transcript holds two lines per call
  and a line count doubles every number the trader is told. `turnActivityLabel`
  names the live activity ("Reading the order book"), `turnKindSummary` counts
  the work by kind ("3 reads, 1 search") and `turnWorkSummary` names it. The
  map is keyed by the tool's HUMAN LABEL, not its name — the transcript never
  carries a name — so a new tool needs its label in the same change that adds
  it, checked against the desk service's own tool list. An unknown tool keeps
  its own label: never guess a verb for it.
- `components/shared/Disclosure.tsx` — the ONE expandable panel, and it is a
  native `<details>`: a toggle without JavaScript, keyboard-operable for free,
  and what the transcript's CSS and screen-reader behaviour were written
  against. The thinking row, the tool-output expander and the Settings'
  "Advanced" section all use it — the automation card's reasoning used to be a
  `<button>` plus a grid-collapse `<div>`, a second mechanism for the same kind
  of thing (that card is deleted, 2026-10-24). It owns the SHAPE and nothing about what goes inside:
  the summary, the body, the classes and the ref are the caller's.
- `components/shared/toolKindIcons.tsx` — the ONE mark for each kind of tool,
  beside the vocabulary it belongs to (`utils/toolKinds.ts`). A kind with two
  spellings is two kinds: the transcript's row and the Settings catalogue
  would draw different-looking marks for the same work.
- `Message.toolEvents` + `Message.toolIds` — the tool TRAIL and the payload ids
  beside it, one entry per line, in the order the desk called the tools. They
  are the settled record the work card draws, and the ids are what let a row
  open onto the REAL output the tool returned. `Message.liveToolEvents` is
  something else: the capped, newline-JOINED LIVE feed a filling bubble shows
  — read it as a list and you get ONE row holding every line, which is how the
  Agents surface's tool rows never paired a call with its result.
- `utils/finishReason.ts` — normalizes the four providers' stop signals onto one
  `FinishReason`, and brackets a run's truncation tally. Read the ceiling with
  `peekTruncations()`; don't re-derive it from a missing regex match.
- `utils/contextWindow.ts` + `services/providers/contextCompact.ts` — the model's
  context window and the automatic compaction that respects it. Resolve the
  window with `resolveContextWindow()` (user override → a limit the provider
  stated in a rejection → the window `/models` reported for that model id → the
  1,000,000 default) and never re-derive it from a model name. Size outbound
  history with `compactForWire()` before sending: it shortens old tool payloads
  first, then prose, then drops whole tool rounds, keeps every `tool_calls` block
  with its replies (a split pair 400s the transcript at every OpenAI-compatible
  gateway), and returns the notice to show the trader. The transport retries once
  on a context-length rejection and records the limit it stated — that is what
  makes an optimistic default safe, so do not add a smaller default to "fix" an
  overflow.
- `shared/providerRequestPolicy.cjs` — thinking gates, temperature, and
  provider URL host policy for all transports.
- `components/shared/effortScale.ts` + `components/shared/effortDial.ts` — the
  thinking tier has ONE ladder (`EFFORT_CHOICES`, `effortChoiceOf`,
  `nextEffortTier` — which wraps, so the chord is repeatable) and ONE record of
  whether a dial is on screen. `Ctrl/Cmd+Shift+E` asks `effortDialUp()` before it
  writes: a panel session and a bot turn render no dial, so they must not answer
  to the key, and the hint printed beside the `EFFORT` label is the same string
  the handler binds. Don't add a second tier list or bind the chord unguarded.
  The ladder also LABELS the answer's tier chip, so the composer's panel and the
  row that reports what the turn ran under cannot spell the same tier two ways.
- `types/provider.ts` — the wire vocabulary, including `ReasoningEffort`, the
  one union for the thinking tier, and `WireAuditEntry`, the ONE record of
  what a request was actually asked. It lives in `types/` because a `Message`
  and a stored chat entry both carry the tier that produced them, and neither
  may depend on a service; `services/providers/reasoningControls.ts` owns the
  SCHEDULE and the resolution and re-exports the type. The tier a turn ran
  under is resolved ONCE (`resolveComposerEffort`) and rides out of the
  executor on the outcome — never re-derived at a write site.
  **`WireAuditEntry` is the same shape of fact**: the transport decides, per
  request, which capability route it applied, and says why when it applied
  none. The decision rides out on the outcome beside the tier, so the answer's
  row can say whether the model DID NOT THINK or was NEVER ASKED TO — which
  were the same silence until this. `components/shared/WireAuditRow.tsx` draws
  it.
- `components/shared/ModelMenu.tsx` — the one model menu. `ModelChip` (both
  composers) and `ModelPicker` (Settings, its only remaining host) mount it, so
  the star list and the free-only preference follow the trader everywhere; a new
  picker takes the panel, it does not grow a second flyout. `ModelPicker` keeps
  only the trigger and the value shape its `mode` speaks.
- `components/shared/JumpToLatestFab.tsx` — the ONE way back to the newest row,
  mounted by both conversation homes (the Agents surface and the Chart AI dock).
  It appears when the trader has scrolled away, and while a turn runs it shows
  an INDETERMINATE ring: a desk turn has no denominator anyone could honestly
  draw, so a "60% done" arc would be a number the app invented. `JUMP_AWAY_PX`
  is the ONE distance at which the transcript stops following — both homes read
  it, because one home must not yank a reader the other one offered a button
  for.
- `components/shared/DetailModal.tsx` — the ONE full-detail reader: a focus
  trap, an `aria-modal`, Escape and a backdrop click, and a body the caller
  supplies. It was `components/analysis/ThinkingModal.tsx` and had NO importer
  — a modal with a test and a trap that nobody had ever opened, reading as if
  the app had one. The agents surface mounts it for the agent's card, so it
  lives in `shared/`. It is VIEW-ONLY on purpose: it shows what a thing IS, and
  editing stays where the editor already is — a reader that also edits is two
  editors, and the two would drift.
- `utils/harnessMarks.ts` — the one voice for text THIS app withholds from a
  model: the `DATA_UNAVAILABLE` sentinel, the clipping notes (which must name
  how much was kept vs existed), the spill receipt, and the fence legend built
  from those prefixes. Never hand-write a marker or describe one in a prompt.
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
- `utils/messageVersions.ts` — the ONE arithmetic of reverting and versioning a
  transcript. A conversation has two homes (the dock's `StoredChatEntry` and the
  pipeline's `Message`) that do not share field names, so no function can read
  both — but they MUST agree on which generation is live, how a step moves, and
  where a parked tail goes. This module owns the counting and the list surgery
  and knows nothing about either row's shape; each host adapts its own fields to
  `TurnSnapshot`. `splitAt` RETURNS the tail it cuts — a caller that ignores the
  second half of that pair is deleting the trader's turns, which is the defect
  the module exists to make awkward. A revert changes the transcript and NOTHING
  else: memory, skills, logged trades and price watches a parked turn produced
  stay exactly as they were (owner ruling, 2026-10-27), and there is no undo for
  those writes — say how many side effects a parked tail made rather than
  pretending to reverse them.
- **A conversation keeps every turn** (owner ruling, 2026-10-27: "store
  everything, no cap"). The 200-message-per-conversation trim, the dock's
  60-entries-per-chat cap and the **4000-character cut on stored reasoning** are
  all gone — that last one silently truncated the thing the trader opens a row to
  read. What remains by design: `MAX_SESSIONS` (a bound on how many chats, not on
  what a turn stores) and `MAX_STORED_CHARS`, because this store IS
  `localStorage` on web against a shared ~5 MB quota, and a throwing write there
  loses more than a trim does. Do not re-add a content cap to "fix" save latency.
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
  `services/providers/GenericAnalysisService.ts` (analysis, vision, memory).
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
  The only import surface is `clearDeskToolCache()`, called at the start of every
  tool turn from inside `streamChatWithDeskTools` — not by its callers. It used to
  be called at each debate start; when the engine was deleted the call site went
  with it and nothing warned, so the clear now lives at the one choke point every
  run passes.
  There is no generic AI-response cache (do not assume one exists)

### Security Best Practices
- Never commit API keys; `.env.local` is gitignored (and no longer read at runtime —
  keys are user-configured in-app)
- Sanitize AI responses before rendering
- Validate data from external sources (zod at boundaries)

## Verification

**There are no unit tests on this branch.** The Vitest suite and the Playwright
smoke suite were removed on 2026-10-23, with their scripts and CI steps, and
nothing in the tree imports a test helper. One deliberate survivor followed
(2026-10-24): `npm run check:contracts`, a single node script pinning the six
PURE-LOGIC contracts no browser probe can reach — planned R:R math, provider
retry classification, the harness mark dialect, notebook pressure tiers,
tool-pair compaction, and AI-boundary coercion. It is not a suite and must not
grow into one; a seventh contract needs the reason the six could not cover it.
What verifies a change now, in order:
`npm run typecheck`, `typecheck:scripts` and `typecheck:electron`, then
`npm run lint` (the warning ratchet binds), `npm run build`,
`npm run check-flow-doc-anchors`, `npm run check:contracts`, and the three
browser probes — `boot-probe`
(does the built bundle start), `render-probe` (rendered rows, inert controls,
zero pageerrors) and `skill-approval-probe` (the human-actuation path). Then run
`npm run dev` and exercise the change by hand: that is the only check left for
behaviour none of the above asserts.

## Environment Variables

No API keys are required at build or runtime — providers are configured in-app
(Settings → Providers) and stored in Preferences (encrypted on desktop).

Optional build-time variables:
- `PORT` — dev server port for `electron:dev` (default 3000)

## Development Notes

- Vite 7 + Tailwind v4. Theme is **hue-free neutral DARK** (dark is still the
  2026-09-10 decision — a light-theme experiment was tried that day and REVERTED,
  and `[data-theme='light']` in `index.css` stays deliberately dormant. Do not
  re-flip to light). The 2026-10-27 re-style took the tint OUT of the neutrals:
  page `#0a0a0a`, panels `zinc-900 #141414`, raised surfaces `zinc-800 #1d1d1d`,
  hairline `zinc-700 #262626`, ink ramp `#f4f4f4 → #858585`. Semantic colors are
  still defined once in `index.css` `@theme` — emerald = gains/up (`#0bc67a`
  family), rose/red = losses/down (`#f6465d` family), yellow/amber = warnings
  (`#f08800`, deliberately NOT re-hued). Neutral utility names (`zinc-*`,
  `cyan-*`) were intentionally kept so components recolor through the token
  block — that is why this re-style was a token edit and not 881 class edits —
  and do not re-add gray remappings for color families.
  The faint steps are MEASURED, not eyeballed: `#858585` is 5.37:1 on the page /
  4.99:1 on a panel / 4.57:1 on a raised surface, and the obvious quieter gray
  (`#6f6f6f`) is 3.94:1 — under AA for the 10–12px micro-labels this app runs.
  Any new faint text step has to be measured the same way before it ships.
- **Brand gradient: DELETED** (owner ruling, 2026-10-27). Nothing in the chrome is
  magenta/pink/orange any more. `--color-brand-start/mid/end` are gone from
  `@theme` rather than re-pointed at white — three aliases resolving to one ink
  step would just be a second name for `zinc-100`. Their six former readers each
  moved on their own: the A-mark's SVG lost its `<defs>` and fills with ink, the
  active tab marker is an `h-0.5 bg-zinc-100` hairline, the sidebar's active bar
  dropped its gradient *and* its hardcoded magenta glow, the update dot is
  `bg-zinc-100`, the splash wordmark shimmers graphite, and one dashboard series
  that had been borrowing `--color-brand-end` (and therefore would have turned
  white) now reads `--color-pink-500`. Do not re-add a brand ramp: **colour means
  data** (green/red/amber/blue on a number or a series) and chrome stays neutral.
- `.status-surface` / `.analysis-card` were deleted from the JSX (2026-09-19).
  They matched no rule in `index.css` once the global theme became semantic, so
  they were dead tokens that made two component comments claim a behavior that
  no longer existed. Do not re-add them.
- Typography: **Geist Variable** for UI (`--font-sans`) and JetBrains Mono for
  data, all self-hosted via @fontsource. **No serif face ships** (owner ruling,
  2026-10-22): `--font-serif` and `--font-reading` stay as ROLES the JSX names —
  four headings and the model's answer — but both resolve to the UI stack, and
  the splash wordmark inherits it. Do not re-add a serif, and do not delete the
  two tokens either: Tailwind's own `font-serif` default would then silently put
  Georgia back on any screen that names the role.
- Radius/motion tokens: `rounded-bubble` (20px, chat bubbles), `rounded-control`
  (10px, inputs/buttons), `--ease-snappy` + `.12s` transitions. Both radii are
  `@theme` steps (12px/8px before the 2026-10-27 re-style), so 694 `rounded-*`
  class sites moved with the two values and no component was edited.
- **An AI row is claimed by identity, never by provider+model.** `Message.botId`
  is stamped by the writers that answer *as* a bot (`useBotMailbox`,
  `botRoutine`), and `deskThread` drops only rows a bot positively owns.
  `threadForProvider` still falls back to the provider+model pair so pre-stamp
  history keeps rendering, but it excludes any row stamped for a different bot.
  Do not reintroduce a model-shaped claim: it deleted the trader's own answers
  from the one pane that shows them (they were claimed into a bot thread that
  never displayed them).
- **Writing a ref during render is a load-bearing idiom here, not a mistake.**
  `ref.current = value` on its own line inside a component body is deliberate
  and appears in many hooks (`composerModeRef`, `tradesRef`, `activeUsernameRef`).
  It exists because an effect runs too late: a hook called LATER in the same
  render, or a callback that fires before the next effect pass, must already see
  the new value. The alternative — a `useEffect` — publishes it one commit late.
  Two rules make it safe:
  - **Never write a ref during render to something a concurrent render could
    tear.** These are all derived from committed state or `sessionStorage`, not
    from props mid-transition. A ref written from props is a React "don't do
    this" — it will not survive concurrent features.
  - **Two writers to one ref is sometimes correct and always needs a comment.**
    `App.tsx`'s `activeUsernameRef` is written twice on purpose: once from
    `sessionStorage` at declaration (the only value available before
    `activeUsername` is destructured) and once from the canonical state later.
    Each serves a different set of readers. Before
    "de-duplicating" one, check what is CALLED between the two lines.
- React 19 strict mode; TypeScript strict
- Electron shell in `electron/` (custom `app://` protocol for production, safeStorage,
  auto-updater); Capacitor config for mobile