/**
 * Pass mining (§8.2c) — the learning loop used to see only closed trades:
 * skill creation required a closed-trade cluster, so SKIPPED trades (the
 * discipline the research says matters most) were invisible to it.
 *
 * This service resolves passes POST-HOC and deterministically: for a SKIPPED
 * trade with a reason and a preliminary plan (the analyst's entry/SL/TP,
 * already captured on the row), fetch klines after the skip timestamp and
 * check which level the would-be trade hit first:
 *   SL first  → CORRECT PASS  — the discipline worked; clusters of ≥3
 *               sharing a {coin|direction|family} fingerprint draft an
 *               avoid-skill through the existing approval-inbox path.
 *   TP first  → MISSED OPPORTUNITY — surfaced as a journal counter-metric
 *               ONLY. We do not teach the system to take more trades; §3's
 *               breakers own that side.
 *   neither   → still open / inconclusive — stays pending for a later sweep.
 *
 * Resolutions persist per user (bounded), so clusters accumulate across
 * sessions and each skip is fetched at most once.
 */

import type { LoggedTrade } from '../../types';
import { TradeOutcome } from '../../types/enums';
import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { scanTradeOutcome, resolveOutcomeFromScan } from '../backtesting/outcomeEngine';
import type { Kline } from '../../types/message';

/** Match MIN_CLUSTER_FOR_SKILL — three vindicated passes draft a skill. */
export const MIN_CLUSTER_FOR_CORRECT_PASSES = 3;
/** Cap on kline fetches per sweep (cost bound, like the eval budget). */
export const PASS_MINING_MAX_FETCHES_PER_SWEEP = 5;
/** Only consider skips newer than this — older paths need too much history. */
const PASS_MINING_LOOKBACK_DAYS = 30;
/** Kline window after the skip: 1h × 300 ≈ 12 days. */
const PASS_KLINE_INTERVAL = '1h';
const PASS_KLINE_LIMIT = 300;

export type PassResolution = 'CORRECT_PASS' | 'MISSED_OPPORTUNITY' | 'OPEN' | 'NO_PLAN';

export interface PassRecord {
    /** The skipped trade/message id. */
    tradeId: string;
    coin?: string;
    direction?: string;
    family?: string;
    regime?: string;
    skipReason: string;
    skippedAt: string;
    resolution: PassResolution;
    resolvedAt: string;
    /** True once a draft has been queued from this record's cluster. */
    drafted?: boolean;
}

const KEY_PREFIX = 'pass_mining_v1_';
const MAX_RECORDS = 300;

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

export const loadPassRecords = async (username: string): Promise<PassRecord[]> => {
    const recs = await getPreferenceObject<PassRecord[]>(keyFor(username));
    return Array.isArray(recs) ? recs : [];
};

const savePassRecords = async (username: string, recs: PassRecord[]): Promise<void> =>
    setPreferenceObject(keyFor(username), recs.slice(-MAX_RECORDS));

/**
 * Deterministic would-have-happened resolution over post-skip klines.
 * Reuses the production outcome engine (same limit-fill semantics as the
 * backtest engines): the would-be entry fills on first touch, then whichever
 * level is hit first decides. Pure — no fetching — so tests drive it with
 * synthetic candles.
 */
export const resolvePassOutcome = (
    klines: Kline[],
    skippedAtMs: number,
    entry: number,
    stopLoss: number,
    takeProfit: number,
    isLong: boolean,
): PassResolution => {
    if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)
        || entry <= 0 || stopLoss <= 0 || takeProfit <= 0) return 'NO_PLAN';
    const after = klines.filter(k => k.time >= skippedAtMs);
    if (after.length === 0) return 'OPEN';
    const scan = scanTradeOutcome(after, entry, stopLoss, [takeProfit], isLong);
    if (!scan.entryTriggered) return 'OPEN';
    const res = resolveOutcomeFromScan(scan);
    if (res.outcome === 'WIN') return 'MISSED_OPPORTUNITY';
    if (res.outcome === 'LOSS') return 'CORRECT_PASS';
    return 'OPEN';
};

/** The {coin|direction|family} fingerprint a correct-pass cluster shares. */
export const passClusterKey = (r: { coin?: string; direction?: string; family?: string }): string => {
    const coin = (r.coin || 'GEN').toUpperCase().replace(/USDT?$/, '');
    const dir = r.direction === 'Long' || r.direction === 'Short' ? r.direction : 'Neutral';
    const fam = r.family || 'any';
    return `${coin}|${dir}|${fam}`;
};

/** Group resolved CORRECT_PASS records into clusters of ≥N (draft-eligible). */
export const correctPassClusters = (
    records: PassRecord[],
    minCluster: number = MIN_CLUSTER_FOR_CORRECT_PASSES,
): Array<{ key: string; records: PassRecord[] }> => {
    const byKey = new Map<string, PassRecord[]>();
    for (const r of records) {
        if (r.resolution !== 'CORRECT_PASS') continue;
        const k = passClusterKey(r);
        const list = byKey.get(k) ?? [];
        list.push(r);
        byKey.set(k, list);
    }
    return [...byKey.entries()]
        .filter(([, list]) => list.length >= minCluster)
        .map(([key, records]) => ({ key, records }));
};

/** Missed-opportunity counter-metric for the journal (never a skill). */
export const missedOpportunityCount = (records: PassRecord[]): number =>
    records.filter(r => r.resolution === 'MISSED_OPPORTUNITY').length;

export const correctPassCount = (records: PassRecord[]): number =>
    records.filter(r => r.resolution === 'CORRECT_PASS').length;

/**
 * Extract the would-be plan from a skipped trade row. The preliminary plan
 * (entry/SL/TP) rides the analysis the same way the veto ledger reads it.
 */
const planOf = (t: LoggedTrade): { entry: number; sl: number; tp: number; isLong: boolean } | null => {
    const a = t.analysis;
    if (!a) return null;
    const num = (v: unknown): number => parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
    const entry = num(a.entryPoints?.[0]?.price) || num(t.correctedEntry);
    const sl = num(a.stopLoss);
    const tp = num(a.takeProfit?.[0]?.price);
    const isLong = a.direction === 'Long';
    if (!entry || !sl || !tp) return null;
    // Sanity: the levels must bracket the entry the right way for the side.
    if (isLong && !(sl < entry && tp > entry)) return null;
    if (!isLong && !(sl > entry && tp < entry)) return null;
    return { entry, sl, tp, isLong };
};

export interface PassMiningSweepResult {
    resolved: number;
    correctPasses: number;
    missed: number;
    /** Cluster keys a draft was queued for during this sweep. */
    draftedClusters: string[];
}

/**
 * One sweep: resolve up to PASS_MINING_MAX_FETCHES_PER_SWEEP recent
 * unresolved skips, persist the outcomes, and draft avoid-skills (through
 * the approval inbox — the human gate stays) for clusters of ≥3 correct
 * passes that have not already drafted one.
 *
 * `fetchKlines` is injectable so tests (and offline runs) never touch the
 * network; production passes the real KlineService fetcher.
 */
export const runPassMiningSweep = async (
    trades: LoggedTrade[],
    username: string,
    fetchKlines: (symbol: string, interval: string, limit: number) => Promise<Kline[]>,
): Promise<PassMiningSweepResult> => {
    const result: PassMiningSweepResult = { resolved: 0, correctPasses: 0, missed: 0, draftedClusters: [] };
    const records = await loadPassRecords(username);
    const known = new Map(records.map(r => [r.tradeId, r]));

    const cutoff = Date.now() - PASS_MINING_LOOKBACK_DAYS * 86_400_000;
    const candidates = trades.filter(t => {
        if (t.outcome !== TradeOutcome.SKIPPED) return false;
        if (!t.skipReason || !t.skipReason.trim()) return false;
        const ts = Date.parse(t.timestamp || '');
        if (!Number.isFinite(ts) || ts < cutoff) return false;
        const existing = known.get(t.id);
        if (existing && existing.resolution !== 'OPEN') return false;
        return planOf(t) !== null;
    });

    let fetches = 0;
    for (const t of candidates) {
        if (fetches >= PASS_MINING_MAX_FETCHES_PER_SWEEP) break;
        const plan = planOf(t);
        if (!plan) continue;
        const skippedAt = Date.parse(t.timestamp || '');
        let resolution: PassResolution;
        try {
            const symbol = (t.analysis?.coinName || '').toUpperCase();
            const klines = await fetchKlines(symbol.endsWith('USDT') ? symbol : `${symbol}USDT`, PASS_KLINE_INTERVAL, PASS_KLINE_LIMIT);
            fetches += 1;
            resolution = resolvePassOutcome(klines, skippedAt, plan.entry, plan.sl, plan.tp, plan.isLong);
        } catch {
            continue; // network failure — retry on a later sweep
        }
        const rec: PassRecord = {
            tradeId: t.id,
            coin: t.analysis?.coinName,
            direction: t.analysis?.direction === 'Long' || t.analysis?.direction === 'Short'
                ? t.analysis.direction : undefined,
            family: t.analysis?.detectedPatternFamily,
            regime: t.marketRegime,
            skipReason: t.skipReason!.trim(),
            skippedAt: t.timestamp,
            resolution,
            resolvedAt: new Date().toISOString(),
        };
        // Replace an existing OPEN record for this trade, or append. NOTE:
        // findIndex returns -1 for a first-time resolution — splice(-1, 1)
        // would delete the LAST record (JS negative-index semantics), so
        // only splice when the index is real.
        const idx = records.findIndex(r => r.tradeId === t.id);
        if (idx >= 0) records.splice(idx, 1);
        records.push(rec);
        known.set(t.id, rec);
        if (resolution !== 'OPEN') {
            result.resolved += 1;
            if (resolution === 'CORRECT_PASS') result.correctPasses += 1;
            if (resolution === 'MISSED_OPPORTUNITY') result.missed += 1;
        }
    }

    // Draft avoid-skills for fresh clusters — through the approval inbox,
    // provenance = the skip episode ids. Missed opportunities NEVER draft.
    for (const cluster of correctPassClusters(records)) {
        if (cluster.records.every(r => r.drafted)) continue;
        const sample = cluster.records[0];
        const coin = (sample.coin || 'GEN').toUpperCase().replace(/USDT?$/, '');
        const dir = sample.direction || 'the side';
        const fam = sample.family || 'this setup';
        const crafted = {
            name: `Avoid ${coin} ${dir} ${fam}`.slice(0, 80),
            kind: 'avoid' as const,
            when: `${coin} ${dir.toLowerCase()} setups in the ${fam} family.`,
            inputs: [coin, dir, fam].filter(Boolean),
            steps: [
                `Recognize the ${fam} setup on ${coin} ${dir.toLowerCase()}`,
                'Check the skip reasons that were right before',
                'Pass unless a new, stronger confirmation appears',
            ],
            validate: 'The pass cluster stays vindicated (price reaches the would-be stop).',
            output: 'Skip the setup',
            approval: 'Always — pass-mined skills are drafts until the user approves them.',
            ifCondition: `${coin} ${dir.toLowerCase()} setup in the ${fam} family without fresh confirmation`,
            thenAction: 'stand aside — passed setups like this reached the stop first in every logged case',
        };
        const { queueSkillDraft } = await import('../../utils/skillDrafts');
        queueSkillDraft({
            tradeId: `pass:${cluster.key}:${cluster.records.length}`,
            coin: sample.coin,
            crafted: {
                ...crafted,
                prediction: (await import('../../utils/skillPrediction')).defaultPrediction({
                    coin: sample.coin,
                    family: sample.family,
                    regime: sample.regime,
                }),
            },
        }, username);
        for (const r of cluster.records) r.drafted = true;
        result.draftedClusters.push(cluster.key);
    }

    await savePassRecords(username, records);
    return result;
};
