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
import { withSerializedPref } from '../infrastructure/serializedPrefs';
import { STRATEGY_FAMILIES, StrategyFamily } from '../../types/strategy';
import { classifyStrategyFamily } from '../../utils/strategyFamily';
import { LedgerRegime, resolveTradeRegime, type ResolvedRegime } from './regimeLedger';
import type { LoggedTrade } from '../../types';
import { TradeOutcome } from '../../types';
export interface MatrixCell {
    w: number;
    l: number;
    /** P0-2: settled trade ids already counted in this cell. Without this the
     *  double `syncClosedTradeToNotebook` per trade (log path + post-mortem
     *  path) counted every regime-carrying trade twice, reaching
     *  MATRIX_MIN_SAMPLES on half the real evidence. */
    tradeIds?: string[];
}

/** family → regime → tallies. Sparse: absent keys mean "no evidence". */
export type StrategyRegimeMatrix = Partial<Record<StrategyFamily, Partial<Record<LedgerRegime, MatrixCell>>>>;

const KEY_PREFIX = 'strategy_regime_matrix_v1_';
/** The regime vocabulary the matrix columns follow — exported so the Studio's
 *  heatmap strip and the accumulator can never drift apart. */
export const MATRIX_REGIMES: LedgerRegime[] = ['trending', 'ranging', 'volatile', 'compression'];

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

const isFamily = (v: unknown): v is StrategyFamily =>
    typeof v === 'string' && (STRATEGY_FAMILIES as readonly string[]).includes(v);

const isRegime = (v: unknown): v is LedgerRegime =>
    typeof v === 'string' && (MATRIX_REGIMES as string[]).includes(v);

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
            const c = cell as { w?: unknown; l?: unknown; tradeIds?: unknown };
            const w = typeof c.w === 'number' && Number.isFinite(c.w) && c.w >= 0 ? c.w : 0;
            const l = typeof c.l === 'number' && Number.isFinite(c.l) && c.l >= 0 ? c.l : 0;
            if (w + l > 0) famCell[reg] = {
                w,
                l,
                // P0-2: persisted alongside the tally so the idempotency guard
                // survives a reload. Capped — provenance, not history.
                ...(Array.isArray(c.tradeIds)
                    ? { tradeIds: c.tradeIds.filter((t): t is string => typeof t === 'string').slice(-40) }
                    : {}),
            };
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

/** One trade's regime, asked one way. Live settles and the boot rebuild must
 *  not disagree about what a trade's regime was, or the tally and the journal
 *  drift and nobody can tell which one is wrong. */
const regimeOfTrade = (trade: LoggedTrade): ResolvedRegime => resolveTradeRegime({
    coin: trade.analysis?.coinName,
    timestamp: trade.outcomeResolvedAt || trade.timestamp,
    marketRegime: trade.marketRegime,
    analysis: trade.analysis,
});

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
        const regime = regimeOfTrade(trade).regime;
        if (!family || !isRegime(regime)) return;
        // P0-2: the read-modify-write runs inside the per-key serialized queue.
        // This call is fire-and-forget from the settle path, so two settles
        // landing together used to both read the pre-write cell and the second
        // write silently dropped the first increment.
        await withSerializedPref(keyFor(username), async () => {
            const list = sanitizeMatrix(await getPreferenceObject<unknown>(keyFor(username)));
            const cell = list[family]?.[regime] ?? { w: 0, l: 0 };
            // P0-2: idempotent by trade id — a re-settled trade (log path then
            // post-mortem path) must not move the tally twice.
            if (cell.tradeIds?.includes(trade.id)) return;
            const nextIds = [...(cell.tradeIds ?? []), trade.id].slice(-40);
            const updated: StrategyRegimeMatrix = {
                ...list,
                [family]: {
                    ...list[family],
                    [regime]: trade.outcome === TradeOutcome.WIN
                        ? { w: cell.w + 1, l: cell.l, tradeIds: nextIds }
                        : { w: cell.w, l: cell.l + 1, tradeIds: nextIds },
                },
            };
            await setPreferenceObject(keyFor(username), updated);
            if (cacheUser === username) cache = updated;
        });
    } catch { /* best-effort telemetry */ }
};

/**
 * Recompute the whole matrix from the journal, in one write.
 *
 * Two reasons this exists and the per-settle accumulator cannot do the job:
 *  - Most historical closes carry no `marketRegime` (it was only written when a
 *    live hybrid packet existed), so `recordSettledTradeForMatrix` early-returns
 *    on them and the matrix — the thing that makes the regime gate a claim
 *    rather than a wish — has almost no rows to rank against. Each trade is
 *    resolved here through `resolveTradeRegime`, which reads the ledger.
 *  - The tally is REBUILT, not merged. Rebuilding from the journal cannot
 *    double-count a settle (the reason the id-guard exists at all), and it
 *    self-corrects when a trade is deleted or its outcome changes.
 *
 * Trades with no resolvable regime are skipped, not defaulted: 'ranging' is a
 * claim about the market, and an unobserved one is a gap.
 */
export interface MatrixRebuildResult {
    cells: number;
    samples: number;
    /** Settled trades that gained a regime only from the ledger or the text. */
    resolvedFromHistory: number;
    /** Settled trades still with no regime — the gap that remains. */
    unresolved: number;
}

export const rebuildMatrixFromJournal = async (
    trades: LoggedTrade[],
    username: string,
): Promise<MatrixRebuildResult> => {
    const empty: MatrixRebuildResult = { cells: 0, samples: 0, resolvedFromHistory: 0, unresolved: 0 };
    try {
        return await withSerializedPref(keyFor(username), async () => {
            const rebuilt: StrategyRegimeMatrix = {};
            const result: MatrixRebuildResult = { ...empty };
            for (const trade of trades || []) {
                if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) continue;
                const family = familyForTrade(trade);
                const resolved = regimeOfTrade(trade);
                if (!family || !resolved.regime) {
                    result.unresolved += 1;
                    continue;
                }
                if (resolved.source !== 'snapshot') result.resolvedFromHistory += 1;
                const cell = rebuilt[family]?.[resolved.regime] ?? { w: 0, l: 0, tradeIds: [] as string[] };
                const ids = [...(cell.tradeIds ?? []), trade.id].slice(-40);
                const next: MatrixCell = trade.outcome === TradeOutcome.WIN
                    ? { w: cell.w + 1, l: cell.l, tradeIds: ids }
                    : { w: cell.w, l: cell.l + 1, tradeIds: ids };
                rebuilt[family] = { ...rebuilt[family], [resolved.regime]: next };
            }
            for (const fam of Object.values(rebuilt)) {
                for (const cell of Object.values(fam ?? {})) {
                    if (!cell) continue;
                    result.cells += 1;
                    result.samples += cell.w + cell.l;
                }
            }
            await setPreferenceObject(keyFor(username), rebuilt);
            if (cacheUser === username) cache = rebuilt;
            return result;
        });
    } catch {
        return empty;
    }
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
