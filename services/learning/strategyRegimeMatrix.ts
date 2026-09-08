/**
 * Strategy-family × market-regime win-rate matrix.
 *
 * The "151 Trading Strategies" thesis this harness operationalizes: every
 * strategy family behaves differently per regime — trend-following bleeds in
 * chop, mean-reversion bleeds in a breakout. The harness already knows each
 * closed trade's regime (LoggedTrade.marketRegime, from the hybrid packet)
 * and, since the family vocabulary landed, its strategy family
 * (TradeAnalysis.strategyFamily). This module accumulates the cross of the
 * two into one tally per user, persisted in Preferences
 * (strategy_regime_matrix_v1_<user>).
 *
 * Two consumers:
 *  - Retrieval ranking (MemoryRetrievalService): familyEdgeFactor nudges a
 *    skill's score by how its family has been performing IN THE CURRENT
 *    REGIME — the book's regime-gating, expressed as evidence, not dogma.
 *  - Prompt context: matrixSummaryBlock hands the moderator the compact
 *    "family × regime" scoreboard so the verdict sees which playbook the
 *    tape currently favors.
 *
 * Like regimeLedger, a module-level cache mirrors the last hydrated user so
 * prompt-side readers stay synchronous; hydrate runs at boot and every write
 * keeps the cache warm. Best-effort throughout — telemetry must never break
 * the settlement path.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { STRATEGY_FAMILIES, StrategyFamily } from '../../types/strategy';
import { classifyStrategyFamily } from '../../utils/strategyFamily';
import { LedgerRegime } from './regimeLedger';
import type { LoggedTrade } from '../../types';
import { TradeOutcome } from '../../types';
export interface MatrixCell {
    w: number;
    l: number;
}

/** family → regime → tallies. Sparse: absent keys mean "no evidence". */
export type StrategyRegimeMatrix = Partial<Record<StrategyFamily, Partial<Record<LedgerRegime, MatrixCell>>>>;

const KEY_PREFIX = 'strategy_regime_matrix_v1_';
const REGIMES: LedgerRegime[] = ['trending', 'ranging', 'volatile', 'compression'];

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

const isFamily = (v: unknown): v is StrategyFamily =>
    typeof v === 'string' && (STRATEGY_FAMILIES as readonly string[]).includes(v);

const isRegime = (v: unknown): v is LedgerRegime =>
    typeof v === 'string' && (REGIMES as string[]).includes(v);

// ── Module cache (sync reads for ranking + prompt assembly) ───────────
let cache: StrategyRegimeMatrix = {};
let cacheUser: string | null = null;

const sanitizeMatrix = (raw: unknown): StrategyRegimeMatrix => {
    const out: StrategyRegimeMatrix = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [fam, regimes] of Object.entries(raw as Record<string, unknown>)) {
        if (!isFamily(fam) || !regimes || typeof regimes !== 'object' || Array.isArray(regimes)) continue;
        const famCell: Partial<Record<LedgerRegime, MatrixCell>> = {};
        for (const [reg, cell] of Object.entries(regimes as Record<string, unknown>)) {
            if (!isRegime(reg) || !cell || typeof cell !== 'object') continue;
            const c = cell as { w?: unknown; l?: unknown };
            const w = typeof c.w === 'number' && Number.isFinite(c.w) && c.w >= 0 ? c.w : 0;
            const l = typeof c.l === 'number' && Number.isFinite(c.l) && c.l >= 0 ? c.l : 0;
            if (w + l > 0) famCell[reg] = { w, l };
        }
        if (Object.keys(famCell).length > 0) out[fam] = famCell;
    }
    return out;
};

/** Load one user's matrix into the sync cache. Best-effort. */
export const hydrateStrategyRegimeMatrix = async (username: string): Promise<void> => {
    try {
        cache = sanitizeMatrix(await getPreferenceObject<unknown>(keyFor(username)));
    } catch {
        cache = {};
    }
    cacheUser = username;
};

/** The family a closed trade belongs to: the analysis's explicit
 *  strategyFamily when present, else a keyword classification of its
 *  free-text strategy. Undefined = no family signal, nothing recorded. */
export const familyForTrade = (trade: LoggedTrade): StrategyFamily | undefined => {
    const explicit = trade.analysis?.strategyFamily;
    if (isFamily(explicit)) return explicit;
    return classifyStrategyFamily(trade.analysis?.strategy);
};

/**
 * Accumulate one settled WIN/LOSS trade into the matrix. Called from the
 * closed-trade notebook sync (same path as skill evidence). Pending /
 * skipped / unknown-regime trades contribute nothing.
 */
export const recordSettledTradeForMatrix = async (
    trade: LoggedTrade,
    username: string,
): Promise<void> => {
    try {
        if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
        const family = familyForTrade(trade);
        const regime = trade.marketRegime;
        if (!family || !isRegime(regime)) return;
        const list = sanitizeMatrix(await getPreferenceObject<unknown>(keyFor(username)));
        const cell = list[family]?.[regime] ?? { w: 0, l: 0 };
        const updated: StrategyRegimeMatrix = {
            ...list,
            [family]: {
                ...list[family],
                [regime]: trade.outcome === TradeOutcome.WIN
                    ? { w: cell.w + 1, l: cell.l }
                    : { w: cell.w, l: cell.l + 1 },
            },
        };
        await setPreferenceObject(keyFor(username), updated);
        if (cacheUser === username) cache = updated;
    } catch { /* best-effort telemetry */ }
};

/** Tally for one family × regime from the sync cache. Null = no evidence. */
export const familyRegimeEdge = (
    family: string | undefined,
    regime: string | undefined,
): { winRate: number; samples: number } | null => {
    if (!isFamily(family) || !isRegime(regime)) return null;
    const cell = cache[family]?.[regime];
    if (!cell) return null;
    const samples = cell.w + cell.l;
    if (samples === 0) return null;
    return { winRate: cell.w / samples, samples };
};

/** Minimum settled samples before the matrix may move a skill's rank. */
export const MATRIX_MIN_SAMPLES = 8;
/** Multiplicative rank factors — a soft tilt, never a hard veto: retrieval
 *  already excludes retired/zero-evidence skills, and one regime's edge can
 *  die next month. */
export const MATRIX_FAVOR_FACTOR = 1.25;
export const MATRIX_AGAINST_FACTOR = 0.6;

/**
 * Ranking factor for a skill whose family has proven edge (or decay) in the
 * CURRENT regime: >1 favors, <1 disfavors, 1 neutral. Requires
 * MATRIX_MIN_SAMPLES; the 60/40 bands mirror the skill ladder's own
 * confirmation/retirement thresholds so the two never disagree about what
 * "edge" means.
 */
export const familyEdgeFactor = (family: string | undefined, regime: string | undefined): number => {
    const edge = familyRegimeEdge(family, regime);
    if (!edge || edge.samples < MATRIX_MIN_SAMPLES) return 1;
    if (edge.winRate >= 0.6) return MATRIX_FAVOR_FACTOR;
    if (edge.winRate <= 0.4) return MATRIX_AGAINST_FACTOR;
    return 1;
};

/**
 * Compact scoreboard for the verdict prompt: each family's record in the
 * given regime, strongest edges first, capped. '' when the regime has no
 * evidence yet — the moderator sees nothing rather than a blank table.
 */
export const matrixSummaryBlock = (regime: string | undefined, max = 260): string => {
    if (!isRegime(regime)) return '';
    const rows = STRATEGY_FAMILIES
        .map(f => ({ family: f, edge: familyRegimeEdge(f, regime) }))
        .filter((r): r is { family: StrategyFamily; edge: { winRate: number; samples: number } } =>
            Boolean(r.edge && r.edge.samples >= 3))
        .sort((a, b) => b.edge.samples - a.edge.samples || b.edge.winRate - a.edge.winRate)
        .slice(0, 4)
        .map(r => `${r.family.replace(/_/g, ' ')} ${Math.round(r.edge.winRate * 100)}% (${r.edge.samples})`);
    if (rows.length === 0) return '';
    const line = `STRATEGY-FAMILY EDGE in ${regime} (win-rate, settled trades): ${rows.join(' · ')}`;
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** Test/boot helper: current cache shape (copy). */
export const getStrategyRegimeMatrixSnapshot = (): StrategyRegimeMatrix =>
    JSON.parse(JSON.stringify(cache)) as StrategyRegimeMatrix;
