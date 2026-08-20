# Harness & learning implementations — final record

Goal: "implement all that can benefit August, especially so it learns to predict
high-quality traders in the long run."

## Implemented & verified (typecheck 0 errors · 1022 tests pass · build ✓)

### 1. Write-approval gate (trust — "no garbage learning")
Hermes `write_approval` pattern, opt-in and default OFF (existing behavior unchanged).
- `services/learning/WriteApprovalGate.ts` (new) — `isEnabled`/`setEnabled`, `stageRules`,
  `getPending`, `approve`, `reject`, `approveAll`, `rejectAll`. Staged rules dedupe against
  both the pending queue and the already-committed store; approval merges through the same
  `storeRule` dedupe/eviction path as live extraction.
- `services/infrastructure/PreferencesService.ts` — added `LEARNING_WRITE_APPROVAL` and
  `LEARNING_PENDING_RULES` keys.
- `services/infrastructure/JobQueueService.ts` — `handleExtractRules` stages new IF/THEN rules
  when the gate is ON; when OFF it runs the exact prior `saveLearningRules` path.
- `components/dashboards/LearningDashboard.tsx` — "🔒 Learning write-approval" section: toggle +
  pending list + per-rule Approve/Reject + Approve-all/Reject-all.

### 2. Memory Graph UI (All / Used / Learned)
- `components/dashboards/LearningDashboard.tsx` — "🧠 Memory Graph" panel over the existing
  `buildMemoryGraph()` data layer: node/edge counts by kind, and three tabs — **All** (nodes
  grouped by Profile/Skill/Rule/Note/Trade/Root cause/Setup), **Used** (rules with `useCount>0` +
  evidence-backed skills), **Learned** (outcome-derived rules + skills).

### 3. Per-seat track record in the debate
- `components/analysis/EnsembleProgressChat.tsx` — each seat header shows `NN% wr` (win rate from
  `loadPerformanceData()`, keyed by runtime provider id, threshold ≥3 closed trades).

## Investigated & resolved (no risky change needed)

### Legacy `AIProvider` keying — a NON-ISSUE
`types/enums.ts` defines `export type AIProvider = (typeof AIProvider)[keyof typeof AIProvider] | string`
— the type already accepts arbitrary dynamic provider-id strings. `AllModelPerformances =
Record<string, ModelPerformance>` and `ensureProviderEntry(data, provider: string)`; `trackTradeOutcome`
is fed `Object.keys(trade.modelsUsed)`. The performance/RL services are already keyed by runtime
provider id. No refactor warranted.

### Prefix-cache shared debate context — ALREADY satisfied for the default path
Opening seats flow through `GenericAnalysisService.analyzeTradingView`, which builds the system
prompt via `composePrompt([contract, role, job, vision, memory, override, playbook, strategies,
desk_tools, risk, output])`:
- **Lenses OFF (default 3-model debate):** `roleBlock = ''`, `basePrompt` is identical across seats,
  and the user prompt (symbol + market data + pattern memory + insights) is identical across seats.
  The only per-seat difference is the `temperature` request param, which is not prompt text. So the
  full system+user prompt is byte-identical across all seats → DeepSeek KV-prefix caching already
  applies (seats 2..N are full cache hits). No code change required.
- **Lenses ON:** the per-seat `roleBlock` sits in position 2, so the cacheable prefix is only the
  first `contract` block. Moving `role` to the end would extend the shared prefix but risk weakening
  persona adherence — a deliberate trade-off, documented rather than applied.

## Self-review note
- Memory Graph panel is null-safe: `getMemoryFiles()` returns an empty cache before
  `initMemoryFiles` resolves, and the `useMemo` is keyed on `[closedWindowed, notebook]` so it
  recomputes after files load.
- Track-record uses a one-time `loadPerformanceData()` snapshot (perf only changes when trades
  close, not mid-debate) — acceptable.
- Write-approval gate operations are async read-then-write on Preferences; a lost-update race is
  theoretically possible only if a background rule job and a manual approve interleave, which is
  low-risk for a single-user tool. Left as-is.

## Verification
- `npm run typecheck` — 0 errors.
- `npx vitest run` — 1022 passed, 11 skipped, 0 failed.
- `npm run build` — ✓.
