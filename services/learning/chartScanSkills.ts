/**
 * chartScanSkills — "study the WHOLE chart, then teach me how it moves".
 *
 * The eighth skill-draft source. Every other learner sees a slice: the chart
 * AI's `get_chart_view` feeds 60 bars, `scan_setups` checks the last 5, and
 * the desk-tool scanners are live-only. This pulls the FULL candle history
 * the chart itself loads (1000 bars), turns it into a token-lean digest —
 * regime segments, swing pivots, gap classes, RSI extremes, and every book
 * detector aggregated across all history with first-touch win-rates from
 * `scanHistorySetups` — and hands it to the session model with one job:
 * craft 1–3 mechanical IF/THEN skills grounded in what THIS coin on THIS
 * timeframe actually did.
 *
 * Nothing bypasses the quality bar. Each candidate is evidence-scored against
 * the same candles (the detector hits become synthetic closed trades through
 * `buildSyntheticTrade`) and runs the shared `gateEvidenceBackedDraft`;
 * candidates without matching hits fall to the deterministic tier. Everything
 * lands in the draft inbox (LLM supervisor + human approve) — the skill
 * library is untouched until then, like every other source.
 */

import type { ProviderConfig } from '../../types/provider';
import type { LoggedTrade } from '../../types';
import type { CraftedSkill } from '../../schemas/learning';
import { parseCraftedSkill } from '../../schemas/learning';
import { getQuickResponse } from '../providers/GenericProviderService';
import { extractAndParseJson } from '../../utils/jsonUtils';
import { getPrompt } from '../infrastructure/PromptOverrideService';
import { fetchKlines } from '../analysis/KlineService';
import {
    scanHistorySetups, classifyGaps, rsiSeries,
    type ScanCandle, type HistoricalSetupStat,
} from '../trade/setupScan';
import { baseOf } from '../../utils/symbol';
import { getActiveUsername } from '../../utils/activeUser';
import { slugifyName } from './MemoryFilesService';
import { queueSkillDraft } from '../../utils/skillDrafts';
import { resolveMemoryConfig } from './MemoryModelService';
import {
    deterministicDraftGate, gateEvidenceBackedDraft, buildSyntheticTrade,
    type EvidenceGateResult,
} from './draftGates';

export interface ChartScanOutcome {
    name: string;
    action: 'queued' | 'merged' | 'skipped';
    detail: string;
}

export interface ChartScanResult {
    symbol: string;
    interval: string;
    bars: number;
    candidates: number;
    queued: number;
    outcomes: ChartScanOutcome[];
    receipt: string;
    error?: string;
}

export interface ChartScanInput {
    symbol: string;
    interval: string;
    username?: string;
    /** The crafting model. Omit to use the current chat session's model,
     *  else the memory provider (the same ladder the supervisor follows). */
    config?: ProviderConfig;
    /** Max candidates to ask the model for (default 3, hard cap 5). */
    maxSkills?: number;
    /** Candles to pull — the chart's own HISTORY_BARS is 1000. */
    bars?: number;
    signal?: AbortSignal;
}

const CHART_SCAN_FALLBACK_PROMPT = `You are a trading-pattern researcher. You receive a machine-built digest of an ENTIRE chart's candle history: regime segments, swing pivots, gap classes, RSI extremes, and every strategy-book setup detector aggregated across the whole tape with first-touch win-rates (1.5×ATR target vs 1×ATR stop, 12-bar horizon). Study how THIS chart actually moves and draft reusable IF/THEN trading skills for this coin and timeframe.

Rules:
- Ground every skill in the digest's numbers. Prefer detectors with enough hits and a win rate that is clearly not a coin flip; cite the observed count and rate inside "when".
- A skill is a mechanical procedure, not a mood. "ifCondition" must state concrete checkable conditions (levels, candle anatomy, indicator state, context). "thenAction" must be an executable entry/exit or an explicit avoid, with invalidation.
- kind "repeat" = a setup the tape shows working; kind "avoid" = a trap the tape shows losing (fading a band walk, chasing a failed break, and similar).
- Name each skill specifically (coin + timeframe + pattern), never generically.
- Inventing a pattern the digest does not support is worse than drafting none. If nothing qualifies, return an empty array.
- Keep "description" as the activation key: what the skill does and WHEN to reach for it.`;

// ─── Digest ──────────────────────────────────────────────────────────────────

const pct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const px = (v: number): string => Number(v.toPrecision(5)).toString();
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Zigzag pivots: a bar whose extreme beats all bars within ±k. Newest-last,
 *  capped — the model sees the skeleton of how the chart moved, not every bar. */
const pivotList = (candles: ScanCandle[], k = 5, cap = 14): { index: number; time: number; price: number; side: 'H' | 'L' }[] => {
    const out: { index: number; time: number; price: number; side: 'H' | 'L' }[] = [];
    for (let i = k; i < candles.length - k; i += 1) {
        let isHigh = true;
        let isLow = true;
        for (let j = i - k; j <= i + k; j += 1) {
            if (j === i) continue;
            if (candles[j].high >= candles[i].high) isHigh = false;
            if (candles[j].low <= candles[i].low) isLow = false;
        }
        if (isHigh) out.push({ index: i, time: candles[i].time, price: candles[i].high, side: 'H' });
        else if (isLow) out.push({ index: i, time: candles[i].time, price: candles[i].low, side: 'L' });
    }
    return out.slice(-cap);
};

/** The token-lean story of the tape. Exported for tests. */
export const buildChartDigest = (
    candles: ScanCandle[],
    symbol: string,
    interval: string,
): { digest: string; stats: HistoricalSetupStat[] } => {
    const n = candles.length;
    const closes = candles.map(c => c.close);
    const first = candles[0];
    const last = candles[n - 1];
    const net = first.close > 0 ? (last.close / first.close - 1) : 0;
    let atr = 0;
    for (let i = Math.max(1, n - 14); i < n; i += 1) atr += candles[i].high - candles[i].low;
    atr /= Math.min(14, n - 1);
    const stats = scanHistorySetups(candles);

    const lines: string[] = [];
    lines.push(`${n} ${interval} candles of ${symbol} — ${day(first.time)} → ${day(last.time)} · net ${pct(net)} · ATR(14) ${px(atr)} (${last.close > 0 ? pct(atr / last.close) : '–'} of price) · last close ${px(last.close)}`);

    // Regime: split the tape into ≤8 equal segments.
    const segCount = Math.max(1, Math.min(8, Math.floor(n / 100)));
    const segSize = Math.ceil(n / segCount);
    const segs: string[] = [];
    for (let s0 = 0; s0 < n; s0 += segSize) {
        const a = candles[s0];
        const bIdx = Math.min(n - 1, s0 + segSize - 1);
        const b = candles[bIdx];
        const hi = Math.max(...closes.slice(s0, bIdx + 1));
        const lo = Math.min(...closes.slice(s0, bIdx + 1));
        const chg = a.close > 0 ? b.close / a.close - 1 : 0;
        const label = chg > 0.02 ? 'up' : chg < -0.02 ? 'down' : 'range';
        segs.push(`${day(a.time)} ${pct(chg)} ${label} rng ${lo > 0 ? pct((hi - lo) / lo) : '–'}`);
    }
    lines.push(`REGIME segments (oldest→newest): ${segs.join(' | ')}`);

    lines.push(`SWING PIVOTS (oldest→newest): ${pivotList(candles).map(p => `${p.side}${px(p.price)}@${day(p.time)}`).join(' ') || 'none detected'}`);

    const gaps = classifyGaps(candles);
    if (gaps.length > 0) {
        const byKind = new Map<string, { total: number; unfilled: number }>();
        for (const g of gaps) {
            const k = `${g.kind} ${g.side}`;
            const e = byKind.get(k) ?? { total: 0, unfilled: 0 };
            e.total += 1;
            if (!g.filled) e.unfilled += 1;
            byKind.set(k, e);
        }
        lines.push(`GAPS: ${[...byKind.entries()].map(([k, e]) => `${e.total} ${k}${e.unfilled ? ` (${e.unfilled} unfilled)` : ''}`).join(', ')}`);
    }

    const rsi = rsiSeries(candles).filter(v => !Number.isNaN(v));
    if (rsi.length > 0) {
        lines.push(`RSI(14): now ${rsi[rsi.length - 1].toFixed(0)} · ${rsi.filter(v => v > 70).length} bars overbought / ${rsi.filter(v => v < 30).length} oversold of ${rsi.length}`);
    }

    lines.push(`SETUP BEHAVIOR ACROSS ALL HISTORY (first-touch 1.5×ATR target vs 1×ATR stop, 12-bar horizon):`);
    if (stats.length === 0) lines.push('  (no book detector fired)');
    for (const s of stats.slice(0, 10)) {
        const wr = s.winRate === null ? 'no resolved outcomes' : `win ${(s.winRate * 100).toFixed(0)}% (${s.wins}W/${s.losses}L${s.open ? `, ${s.open} open` : ''})`;
        lines.push(`  - ${s.title} [${s.side.toUpperCase()}] ×${s.hits} · ${wr} · avg MFE ${pct(s.avgMfe)} / MAE ${pct(s.avgMae)} · keywords: ${s.keywords.join(', ')}`);
    }

    const tail = candles.slice(-40);
    lines.push(`LAST ${tail.length} CANDLES (oldest→newest, bar o/h/l/c):`);
    tail.forEach((c, i) => {
        lines.push(`  ${n - tail.length + i + 1} ${day(c.time)} ${px(c.open)}/${px(c.high)}/${px(c.low)}/${px(c.close)}`);
    });

    return { digest: lines.join('\n'), stats };
};

// ─── Evidence: detector hits → synthetic closed trades ──────────────────────

/** Which aggregated detector does this craft describe? Keyword overlap between
 *  the model's IF clause and the detector's keywords/id. */
const matchStat = (crafted: CraftedSkill, stats: HistoricalSetupStat[]): HistoricalSetupStat | null => {
    const hay = `${crafted.name} ${crafted.when} ${crafted.description ?? ''} ${crafted.ifCondition}`.toLowerCase();
    let best: HistoricalSetupStat | null = null;
    let bestScore = 0;
    for (const s of stats) {
        const score = s.keywords.filter(k => hay.includes(k.toLowerCase())).length
            + (hay.includes(s.id.replace(/-/g, ' ')) ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = s; }
    }
    return bestScore > 0 ? best : null;
};

const evidenceCluster = (
    stat: HistoricalSetupStat,
    symbol: string,
    interval: string,
): LoggedTrade[] => stat.examples
    .filter(h => h.outcome === 'win' || h.outcome === 'loss')
    .map(h => buildSyntheticTrade({
        id: `scan-${stat.id}-${h.index}`,
        coin: baseOf(symbol).toUpperCase(),
        direction: stat.side === 'short' ? 'Short' : 'Long',
        family: stat.id,
        outcome: h.outcome as 'win' | 'loss',
        thesis: `${stat.title} [${stat.side}] on ${symbol} ${interval} at ${day(h.time)} — first-touch ${h.outcome} (MFE ${pct(h.mfe)}, MAE ${pct(h.mae)})`,
        atMs: h.time,
    }));

// ─── Craft + gate pipeline ──────────────────────────────────────────────────

const resolveScanConfig = async (username: string): Promise<ProviderConfig | null> => {
    try {
        const { getSessionModel } = await import('./skillSupervisor');
        const session = getSessionModel();
        if (session) return session;
    } catch { /* fall through to the memory ladder */ }
    return await resolveMemoryConfig(username);
};

const parseCandidates = (raw: string, maxSkills: number): CraftedSkill[] => {
    let parsed: unknown;
    try { parsed = extractAndParseJson(raw); } catch { return []; }
    let items: unknown = parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        items = obj.skills ?? obj.candidates ?? obj.result ?? obj;
    }
    // A single object is still a valid one-candidate answer.
    const list: unknown[] = Array.isArray(items)
        ? items
        : (items && typeof items === 'object' ? [items] : []);
    const out: CraftedSkill[] = [];
    for (const item of list) {
        const crafted = parseCraftedSkill(item);
        if (crafted) out.push(crafted);
        if (out.length >= maxSkills) break;
    }
    return out;
};

export async function scanChartForSkills(input: ChartScanInput): Promise<ChartScanResult> {
    const username = input.username ?? getActiveUsername();
    const maxSkills = Math.min(Math.max(input.maxSkills ?? 3, 1), 5);
    const base = baseOf(input.symbol).toUpperCase();
    const empty = (bars: number, error?: string): ChartScanResult => ({
        symbol: input.symbol, interval: input.interval, bars,
        candidates: 0, queued: 0, outcomes: [],
        receipt: error ?? 'CHART SKILL SCAN failed',
        error,
    });

    const klines = await fetchKlines(input.symbol, input.interval, input.bars ?? 1000);
    const candles: ScanCandle[] = klines.map(k => ({
        time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
    }));
    if (candles.length < 60) {
        return empty(candles.length,
            `DATA_UNAVAILABLE: ${input.symbol} ${input.interval} — only ${candles.length} candles returned. The source failed; do not infer an empty tape.`);
    }

    const config = input.config ?? await resolveScanConfig(username);
    if (!config) return empty(candles.length, 'scan_chart_skills unavailable: no ready AI provider to run the scan.');

    const { digest, stats } = buildChartDigest(candles, input.symbol, input.interval);

    let raw: string;
    try {
        raw = await getQuickResponse(
            config,
            `Chart: ${input.symbol} · ${input.interval}. Draft at most ${maxSkills} skills from the digest below.\n\n${digest}`,
            getPrompt('learning.chart_scan', CHART_SCAN_FALLBACK_PROMPT),
            { maxTokens: 4096, signal: input.signal },
        );
    } catch (err) {
        return empty(candles.length, `scan_chart_skills failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const candidates = parseCandidates(raw, maxSkills);
    const outcomes: ChartScanOutcome[] = [];
    let queued = 0;
    for (const raw of candidates) {
        // Provenance stamp: the timeframe this pattern was earned on and the
        // learner that minted it ride through the draft into the skill meta.
        const crafted: CraftedSkill = { ...raw, timeframe: input.interval, source: 'scan' };
        const stat = matchStat(crafted, stats);
        const cluster = stat ? evidenceCluster(stat, input.symbol, input.interval) : [];
        const tradeId = `scan:${base}:${input.interval}:${slugifyName(crafted.name)}`;
        let res: EvidenceGateResult;
        try {
            if (cluster.length > 0) {
                res = await gateEvidenceBackedDraft({
                    crafted, tradeId, cluster, username, config,
                    coin: base,
                    family: stat?.id,
                    botContext: `Chart-scan digest evidence: ${stat?.title} fired ${stat?.hits}× across the tape${stat?.winRate !== undefined && stat?.winRate !== null ? ` with a ${(stat.winRate * 100).toFixed(0)}% first-touch win rate` : ''}.`,
                });
            } else {
                const det = deterministicDraftGate({ crafted, tradeId, username, coin: base });
                if (det.ok) {
                    queueSkillDraft({ tradeId, coin: base, crafted: det.crafted }, username);
                    res = { action: 'queued', crafted: det.crafted };
                } else {
                    res = { action: 'skipped', reason: det.reason };
                }
            }
        } catch (err) {
            res = { action: 'skipped', reason: err instanceof Error ? err.message : String(err) };
        }
        if (res.action === 'queued') queued += 1;
        outcomes.push({
            name: crafted.name,
            action: res.action,
            detail: res.action === 'queued'
                ? `${cluster.length > 0 ? `evidence: ${cluster.length} scored hit${cluster.length === 1 ? '' : 's'} · ` : 'no matching detector hits · '}pending approval in the inbox`
                : res.action === 'merged'
                    ? `folded into ${res.target}: ${res.reason}`
                    : res.reason,
        });
    }

    const receipt = [
        `CHART SKILL SCAN ${input.symbol} ${input.interval} — ${candles.length} candles, ${stats.length} distinct detector behaviors analyzed.`,
        candidates.length === 0
            ? 'The model drafted no skill the digest supports (or the reply was unreadable). Tell the user nothing was queued and why the tape did not qualify.'
            : `Model drafted ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}:`,
        ...outcomes.map(o => `- ${o.name} → ${o.action.toUpperCase()} — ${o.detail}`),
        stats.length > 0
            ? `If the user wants to ACT on a behavior rather than just learn it, arm a watch: call watch_price at a queued skill's trigger level (the top hits' entry prices are in the digest) so the harness warns them when it fires again.`
            : '',
        'Drafts change NOTHING until a human or the supervisor approves them in the Inbox; skills then earn their place through the normal win/loss evidence ladder.',
    ].filter(Boolean).join('\n');

    return {
        symbol: input.symbol, interval: input.interval, bars: candles.length,
        candidates: candidates.length, queued, outcomes, receipt,
    };
}

/**
 * Multi-timeframe scan: run the whole pipeline across a list of intervals and
 * merge the results. Each interval contributes its own provenance-stamped
 * drafts (the timeframe rides through), so a 15m momentum skill and a 4h
 * range skill from the same tape are distinct. Draft-trigger dedupe still
 * applies, so a pattern that reads the same at both edges queues once.
 */
export interface MultiIntervalScanInput extends Omit<ChartScanInput, 'interval'> {
    intervals: string[];
}

export async function scanChartAcrossIntervals(
    input: MultiIntervalScanInput,
): Promise<ChartScanResult> {
    const intervals = [...new Set(input.intervals)].filter(Boolean).slice(0, 6);
    if (intervals.length === 0) {
        return {
            symbol: input.symbol, interval: '', bars: 0, candidates: 0, queued: 0,
            outcomes: [], error: 'no intervals supplied', receipt: 'CHART SKILL SCAN — no intervals to scan.',
        };
    }
    const merged: ChartScanResult = {
        symbol: input.symbol, interval: intervals.join(','), bars: 0,
        candidates: 0, queued: 0, outcomes: [], receipt: '',
    };
    const receipts: string[] = [];
    for (const interval of intervals) {
        const one = await scanChartForSkills({ ...input, interval });
        merged.bars += one.bars;
        merged.candidates += one.candidates;
        merged.queued += one.queued;
        merged.outcomes.push(...one.outcomes.map(o => ({ ...o, name: `${o.name} (${interval})` })));
        receipts.push(one.receipt);
        if (one.error) { merged.error = merged.error ?? one.error; }
        if (input.signal?.aborted) break;
    }
    merged.receipt = intervals.length > 1
        ? `CHART SKILL SCAN ${input.symbol} across ${intervals.join(', ')} — ${merged.queued} draft${merged.queued === 1 ? '' : 's'} from ${merged.candidates} candidate${merged.candidates === 1 ? '' : 's'}.\n${merged.outcomes.map(o => `- ${o.name} → ${o.action.toUpperCase()} — ${o.detail}`).join('\n') || '(none)'}`
        : receipts[0];
    return merged;
}
