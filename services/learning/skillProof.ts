/**
 * skillProof — "prove this skill on history" on demand.
 *
 * A skill's live record only starts accumulating once approved trades touch
 * it, so a freshly-minted (or chat-authored) skill reads unproven for weeks.
 * This closes that gap the same way the chart scan scores its candidates:
 * pull the coin's real candle history, run the strategy-book detectors over
 * the WHOLE tape (scanHistorySetups), match the skill's own IF/THEN clauses
 * to the detector they describe, and report what that behavior WOULD have
 * done (first-touch 1.5×ATR vs 1×ATR win-rate + excursions).
 *
 * Pure code + klines — NO model call, so it's cheap and deterministic. The
 * number is a historical readout, not a claim written to the ledger; the
 * skill's real W/L ladder still governs promotion.
 */

import { fetchKlines } from '../analysis/KlineService';
import { scanHistorySetups, type HistoricalSetupStat, type ScanCandle } from '../trade/setupScan';

export interface SkillProof {
    symbol: string;
    timeframe: string;
    bars: number;
    detectorId: string;
    title: string;
    hits: number;
    wins: number;
    losses: number;
    /** wins/(wins+losses); null when nothing resolved inside the horizon. */
    winRate: number | null;
    avgMfe: number;
    avgMae: number;
}

export type SkillProofResult =
    | { status: 'ok'; proof: SkillProof }
    | { status: 'no-data'; message: string }
    | { status: 'no-match'; message: string };

/** Normalize a skill coin (may be 'BTC' or 'BTCUSDT') to a fetch symbol. */
const toSymbol = (coin: string): string => {
    const c = coin.trim().toUpperCase();
    return c.endsWith('USDT') || c.endsWith('USD') ? c : `${c}USDT`;
};

/** The detector whose keywords/id best overlap the skill's clauses. Mirrors
 *  the chart-scan matcher so a skill proves against the same behavior it was
 *  drafted from. */
export const matchDetector = (text: string, stats: HistoricalSetupStat[]): HistoricalSetupStat | null => {
    const hay = text.toLowerCase();
    let best: HistoricalSetupStat | null = null;
    let bestScore = 0;
    for (const s of stats) {
        const score = s.keywords.filter(k => hay.includes(k.toLowerCase())).length
            + (hay.includes(s.id.replace(/-/g, ' ')) ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = s; }
    }
    return bestScore > 0 ? best : null;
};

/** A skill's searchable text: the clauses + activation key + family. */
export const skillProofText = (parts: {
    ifCondition?: string; thenAction?: string; description?: string; family?: string; title?: string;
}): string => [parts.title, parts.description, parts.family, parts.ifCondition, parts.thenAction]
    .filter(Boolean).join(' ');

export async function proofSkillOnHistory(args: {
    coin: string;
    timeframe: string;
    text: string;
    bars?: number;
    signal?: AbortSignal;
}): Promise<SkillProofResult> {
    const symbol = toSymbol(args.coin);
    const timeframe = args.timeframe || '1h';
    const klines = await fetchKlines(symbol, timeframe, args.bars ?? 1000);
    if (args.signal?.aborted) return { status: 'no-data', message: 'cancelled' };
    const candles: ScanCandle[] = klines.map(k => ({
        time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
    }));
    if (candles.length < 40) {
        return { status: 'no-data', message: `Not enough history for ${symbol} ${timeframe} (${candles.length} bars).` };
    }
    const stats = scanHistorySetups(candles);
    const stat = matchDetector(args.text, stats);
    if (!stat) {
        return { status: 'no-match', message: `No book detector matches this skill on ${symbol} ${timeframe} — it encodes a pattern the strategy detectors don't track, so it can't be mechanically proven here.` };
    }
    return {
        status: 'ok',
        proof: {
            symbol, timeframe, bars: candles.length,
            detectorId: stat.id, title: stat.title,
            hits: stat.hits, wins: stat.wins, losses: stat.losses,
            winRate: stat.winRate, avgMfe: stat.avgMfe, avgMae: stat.avgMae,
        },
    };
}
