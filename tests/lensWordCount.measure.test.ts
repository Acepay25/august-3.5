/**
 * P3 MEASUREMENT SPEC — lens role-variant response word counts vs. the
 * "350 words maximum" cap stated in every lens role prompt.
 *
 * GATED: this file does NOTHING unless RUN_LENS_MEASUREMENT=1 AND a provider
 * config is available (P3_* env vars or .env.p3.json). Named *.measure.test.ts
 * only so vitest's include glob picks it up; without the env flag every test
 * is skipped, so normal `npm run test` / CI runs are unaffected.
 *
 * USAGE (after explicit go-ahead — spends provider quota):
 *   Option A — env vars (preferred; keys never touch the repo or chat):
 *     export P3_API_KEY=... P3_BASE_URL=https://api.openai.com/v1 P3_MODEL=gpt-4o \
 *            P3_API_FORMAT=chat_completions   # format optional, defaults to chat_completions
 *     RUN_LENS_MEASUREMENT=1 npx vitest run tests/lensWordCount.measure.test.ts
 *
 *   Option B — keys file: create .env.p3.json at the repo root (gitignored via
 *     `.env*`) with the same shape as the app's `provider_configs_v1`
 *     preference — an array of ProviderConfig objects, e.g.:
 *     [
 *       {
 *         "id": "gemini",
 *         "name": "Gemini",
 *         "apiKey": "<your-key>",
 *         "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
 *         "apiFormat": "chat_completions",
 *         "isEnabled": true,
 *         "isBuiltIn": true,
 *         "models": ["gemini-2.5-pro"],
 *         "selectedModel": "gemini-2.5-pro"
 *       }
 *     ]
 *     RUN_LENS_MEASUREMENT=1 npx vitest run tests/lensWordCount.measure.test.ts
 *
 * WHAT IT MEASURES (per variant, 3 identical calls = 27 calls total):
 *   - finalOutput word count (the "response" the 350-word cap applies to)
 *   - thoughtProcess word count (context only — not capped)
 *   - presence of required sections (R:R math, failure scenarios,
 *     candle-history citation, probability table) — regex flags
 *   - table density: number of lines containing '|' in the response
 *
 * Mirrors the real shipping path: useAnalysisPipeline → analyzeTradingView with
 * rolePrompt = getLensPromptForRole(role, style), standard mode (subMode
 * undefined), no images, identical representative market-data prompt for all
 * calls.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { ProviderConfig, ApiFormat } from '../types/provider';

// ─── Gate: refuse to run without the explicit env flag ──────────────────────
const GATE = process.env.RUN_LENS_MEASUREMENT === '1';
const KEYS_FILE = path.resolve(process.cwd(), '.env.p3.json');
const gated = GATE ? describe : describe.skip;
const gatedIt = GATE ? it : it.skip;

/** Build a ProviderConfig from P3_* env vars; null when not provisioned. */
function loadConfigFromEnv(): ProviderConfig | null {
  if (!process.env.P3_API_KEY) return null;
  const format = (process.env.P3_API_FORMAT || 'chat_completions') as ApiFormat;
  return {
    id: process.env.P3_ID || 'p3-measure',
    name: process.env.P3_NAME || 'P3 Measure',
    apiKey: process.env.P3_API_KEY,
    baseUrl: process.env.P3_BASE_URL || '',
    apiFormat: format,
    isEnabled: true,
    isBuiltIn: false,
    models: process.env.P3_MODEL ? [process.env.P3_MODEL] : [],
    selectedModel: process.env.P3_MODEL || '',
  };
}

/** Resolve the provider config: env vars first, then .env.p3.json fallback. */
function resolveProviderConfigs(): ProviderConfig[] {
  const fromEnv = loadConfigFromEnv();
  if (fromEnv) return [fromEnv];

  if (!fs.existsSync(KEYS_FILE)) {
    throw new Error(
      `No provider config found.\n` +
      `Either export P3_API_KEY + P3_BASE_URL + P3_MODEL (see header comment), or create ${KEYS_FILE} with your ProviderConfig[].`
    );
  }
  const parsed = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')) as ProviderConfig[];
  if (!Array.isArray(parsed)) {
    throw new Error(`${KEYS_FILE} must contain an array of ProviderConfig objects.`);
  }
  return parsed;
}

// ─── In-memory Preferences, seeded from the keys file (mirrors the
//     providerConfigService.test.ts mock pattern; avoids Capacitor) ──────────
let store: unknown = null;
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async () => store),
  setPreferenceObject: vi.fn(async (_key: string, value: unknown) => {
    store = value;
  }),
}));

import { loadProviderConfigs, getReadyProviders } from '../services/infrastructure/ProviderConfigService';
import { analyzeTradingView } from '../services/providers/GenericAnalysisService';
import { getLensPromptForRole } from '../services/ui/AnalystLensService';
import { AnalystRole } from '../types/enums';

const ROLES: { role: AnalystRole; label: string }[] = [
  { role: AnalystRole.MACRO_VOLATILITY, label: 'macro' },
  { role: AnalystRole.TECHNICAL_ANALYST, label: 'technical' },
  { role: AnalystRole.RISK_EXECUTION, label: 'risk' },
];
const STYLES: ('swing' | 'scalp' | 'position')[] = ['swing', 'scalp', 'position'];
const REPS = 3; // 3 live calls per variant → 9 × 3 = 27 calls

/**
 * Representative market-data prompt — same for every call. Mirrors the shape
 * the app produces (live telemetry + indicators per timeframe + key levels),
 * deliberately NOT an edge case.
 */
const MARKET_PROMPT = `Analyze BTCUSDT for a trade opportunity.

**LIVE MARKET DATA**
- Symbol: BTCUSDT (Binance Perpetual)
- Current Price: 97450.20
- 24h Change: +1.85%
- 24h Volume: 18.4B USDT (above 20-period average)
- Funding Rate: +0.008% (neutral)
- Long/Short Ratio: 1.12

**TECHNICAL INDICATORS**
4H: RSI 58.2, MACD +38.4 (rising), EMA20 96500, EMA50 95200, ADX 22.4, ATR 980
1H: RSI 55.1, MACD +12.6 (rising), EMA20 97050, EMA50 96800, ADX 18.9, ATR 420
15m: RSI 52.8, MACD +2.1 (flat), EMA20 97300, EMA50 97400, ATR 140
5m: RSI 50.4, MACD -0.8 (flat), EMA20 97410, EMA50 97420, ATR 60

**KEY LEVELS**
- Resistance: 98150 (4H equal highs), 98900 (4H order block)
- Support: 96800 (4H EMA20 + FVG), 96000 (4H order block)
- Structure: 4H HH/HL, 1H HH/HL, 15m LH/LL (minor pullback)
- Volume: rising on up-moves, flat on down-moves

**MARKET CONTEXT**
BTC ranging between 96000-98500 for 3 days after a strong trend up. Funding neutral. No major news events in next 12h. Session: New York morning.`;

interface VariantResult {
  variant: string;
  rep: number;
  finalWords: number;
  thoughtWords: number;
  overLimit: boolean;
  hasRR: boolean;
  hasFailureScenarios: boolean;
  hasCandleHistory: boolean;
  hasProbabilityTable: boolean;
  tableLines: number;
  finalOutputSnippet: string;
}

const results: VariantResult[] = [];

const wordCount = (text: string): number =>
  text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;

const SECTION_RE = {
  hasRR: /\bR\s*:\s*R\b|\bR\/R\b|Risk[-\s]?Reward/i,
  hasFailureScenarios: /failure scenario|fails because|failure prob/i,
  hasCandleHistory: /candle history|4h candle trend/i,
  hasProbabilityTable: /probability estimation|sl probability|tp probabilit|\|\s*(sl|tp[12]?)\s*\|\s*\d/i,
};

gated('P3: lens role-variant word counts (27 live calls)', () => {
  beforeAll(() => {
    store = resolveProviderConfigs();
  });

  gatedIt('has at least one ready provider configured in the keys file', async () => {
    const configs = await loadProviderConfigs();
    const ready = getReadyProviders(configs);
    expect(ready.length).toBeGreaterThan(0);
  });

  for (const { role, label } of ROLES) {
    for (const style of STYLES) {
      const variant = `${style}-${label}`;
      gatedIt(
        `${variant}: ${REPS} live calls, word count vs 350-word cap`,
        { timeout: 420_000 }, // 3 calls × up to 120s each + slack
        async () => {
          const configs = await loadProviderConfigs();
          const [provider] = getReadyProviders(configs);
          expect(provider).toBeDefined();

          const rolePrompt = getLensPromptForRole(role, style);

          for (let rep = 1; rep <= REPS; rep++) {
            const { thoughtProcess, finalOutput } = await analyzeTradingView(provider, {
              prompt: MARKET_PROMPT,
              images: [],
              imageSummaries: [],
              chatHistory: [],
              finalTradeSummary: null,
              recentInsights: null,
              activeFrameworks: ['Breakout Trading', 'SMC', 'Trend Following'],
              deepenAnalysis: false,
              subMode: undefined, // standard mode → lens path
              rolePrompt,
            });

            const finalWords = wordCount(finalOutput);
            const thoughtWords = wordCount(thoughtProcess);
            const combined = `${finalOutput}\n${thoughtProcess}`;

            results.push({
              variant,
              rep,
              finalWords,
              thoughtWords,
              overLimit: finalWords > 350,
              hasRR: SECTION_RE.hasRR.test(combined),
              hasFailureScenarios: SECTION_RE.hasFailureScenarios.test(combined),
              hasCandleHistory: SECTION_RE.hasCandleHistory.test(combined),
              hasProbabilityTable: SECTION_RE.hasProbabilityTable.test(combined),
              tableLines: finalOutput.split('\n').filter((l) => l.includes('|')).length,
              finalOutputSnippet: finalOutput.slice(0, 120).replace(/\s+/g, ' '),
            });
          }
        }
      );
    }
  }

  // Summary test — prints the report table; fails only if zero results.
  it('prints the aggregated word-count report', () => {
    expect(results.length).toBe(ROLES.length * STYLES.length * REPS);

    const byVariant = new Map<string, VariantResult[]>();
    for (const r of results) {
      const list = byVariant.get(r.variant) || [];
      list.push(r);
      byVariant.set(r.variant, list);
    }

    const rows = [...byVariant.entries()].map(([variant, reps]) => {
      const counts = reps.map((r) => r.finalWords);
      const median = [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)];
      return {
        variant,
        counts: counts.join('/'),
        median,
        overLimit: reps.some((r) => r.overLimit) ? 'YES' : 'no',
        rr: reps.every((r) => r.hasRR) ? '✓' : '✗',
        failures: reps.every((r) => r.hasFailureScenarios) ? '✓' : '✗',
        candle: reps.every((r) => r.hasCandleHistory) ? '✓' : '✗',
        probTable: reps.every((r) => r.hasProbabilityTable) ? '✓' : '✗',
        tableLines: reps.map((r) => r.tableLines).join('/'),
      };
    });

    // eslint-disable-next-line no-console
    console.table(rows);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), provider: 'first-ready', rows, details: results }, null, 2));
  });
});
