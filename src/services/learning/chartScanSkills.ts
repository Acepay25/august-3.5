/**
 * chartScanSkills — "study the WHOLE chart, then teach me how it moves".
 *
 * The eighth skill-draft source. Every other learner sees a slice: the chart
 * AI's `get_chart_view` feeds 60 bars, `scan_setups` checks the last 5, and
 * the desk-tool scanners are live-only. This pulls the FULL candle history
 * the chart itself loads (1000 bars) and studies EVERY bar:
 *
 *   · `chartTapeStudy` buckets every bar by PHT hour (forward move, drift, up
 *     share, excursions), finds the ≥10% swing legs with the state before
 *     them, and describes the candle anatomy and run lengths;
 *   · the digest also carries regime segments, swing pivots, gap classes, RSI
 *     extremes, and every book detector aggregated across all history with
 *     first-touch win-rates from `scanHistorySetups`;
 *   · the session model turns that into 1–3 PATTERN-FIRST skills. The IF/THEN
 *     clause is the compact trigger summary, not the whole finding.
 *
 * Each candidate is evidence-scored against the same candles (detector hits
 * become synthetic closed trades through `buildSyntheticTrade`) and runs the
 * shared `gateEvidenceBackedDraft`; candidates without matching hits fall to
 * the deterministic tier. Under the 2026-10-29 ruling the scan writes
 * CANDIDATES DIRECTLY through `ingestCraftedSkillFromDraft` — no approval
 * queue; only the evidence fold promotes or retires them.
 */

import type { ProviderConfig } from '../../types/provider';
import type { LoggedTrade } from '../../types';
import type { CraftedSkill } from '../../schemas/learning';
import { parseCraftedSkill } from '../../schemas/learning';
import { getQuickResponse } from '../providers/GenericProviderService';
import { extractAndParseJson } from '../../utils/jsonUtils';
import { getHarnessSettings } from '../../utils/harnessSettings';
import { dataUnavailable } from '../../utils/harnessMarks';
import { getPrompt } from '../infrastructure/PromptOverrideService';
import { fetchKlines } from '../analysis/KlineService';
import { PREDICATE_GRAMMAR_HINT } from '../analysis/skillPredicate';
import {
    scanHistorySetups, classifyGaps, rsiSeries,
    type ScanCandle, type HistoricalSetupStat,
} from '../trade/setupScan';
import { buildTapeStudy, formatTapeStudy, type TapeStudy } from './chartTapeStudy';
import { baseOf } from '../../utils/symbol';
import { phtDayKey } from '../../utils/timezone';
import { getActiveUsername } from '../../utils/activeUser';
import { slugifyName } from './MemoryFilesService';
import { resolveMemoryConfig } from './MemoryModelService';
import {
    deterministicDraftGate, gateEvidenceBackedDraft, buildSyntheticTrade,
    type EvidenceGateResult,
} from './draftGates';

export interface ChartScanOutcome {
    name: string;
    action: 'created' | 'merged' | 'skipped';
    detail: string;
}

export interface ChartScanResult {
    symbol: string;
    interval: string;
    bars: number;
    candidates: number;
    created: number;
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

// Exported so `constants/promptRegistry.ts` can IMPORT the built-in default
// instead of restating it — the two copies were a silent-drift hazard.
export const CHART_SCAN_FALLBACK_PROMPT = `You are a trading-pattern researcher. You receive a machine-built study of an ENTIRE chart's candle history. The digest was computed over EVERY bar, not a sample: the time-of-day table samples each bar against a fixed forward horizon in the trader's clock (PHT, UTC+8); the BIG MOVES table lists swing legs of at least 10% (entry at the lowest/highest close in a 24-bar window) with the state BEFORE each leg; the anatomy/runs lines describe how the candles actually behave. Only the raw candle rows at the end are a subset — never claim to have read a bar that is not shown.

Your job is PATTERN-FIRST: work out how this coin on this timeframe moves and when a trader should have been in. Then create candidate skills that describe those patterns. A skill is not a generic IF/THEN rule; the IF/THEN clause is only the compact, checkable summary of a pattern the tape supports.

Rules:
- Ground every skill in the digest's numbers. Cite the observed counts, the hour(s) and the move sizes inside "when".
- Require repetition: do not build a rule from ONE leg. Use ≥3 similar events, or a stable hour bucket with a clear drift/up-share and enough samples. If the tape shows one spectacular move and nothing repeatable, say so and draft nothing for it.
- The big-move question is "if we could turn back time, what should we have been doing at that time": use the START time (PHT hour), the preceding return, volume ratio, range compression, gap and RSI. If the up legs cluster at an hour with compression and volume expansion beforehand, that is the pattern to describe; the mirror applies to down legs for shorts.
- "ifCondition" must state concrete checkable conditions (levels, candle anatomy, indicator state, time window, context). "thenAction" must be an executable entry/exit or an explicit avoid, with invalidation and the time window. "steps" must read as a procedure a trader can follow, not a mood.
- kind "repeat" = a pattern the tape shows working; kind "avoid" = a trap the tape shows losing.
- Name each skill specifically (coin + timeframe + pattern/time), never generically.
- Inventing a pattern the digest does not support is worse than drafting none. If nothing qualifies, return an empty array.
- Keep "description" as the activation key: what the skill does, then "Use this skill whenever <the concrete trigger phrases the tape supports>. Do NOT use for <one brief exclusion>."
- The digest is built from CLOSED candles, so also author a "predicate" where the IF clause reduces to candle math: ${PREDICATE_GRAMMAR_HINT} A predicate lets the desk re-check the trigger in code on every later run instead of trusting a seat to read prose; omit it when the clause cannot be reduced.`;

// ─── Digest ──────────────────────────────────────────────────────────────────

const pct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const px = (v: number): string => Number(v.toPrecision(5)).toString();
const day = (ms: number): string => phtDayKey(ms);

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

/** Prompt budget for the whole digest. The study sections (time of day, big
 *  moves, anatomy) are computed over EVERY bar and are never sampled; when the
 *  cap binds, later sections are dropped and the digest NAMES them. Measured
 *  on a real 1000-bar BTC 1h tape at ~7.6k chars; 14k leaves headroom for a
 *  noisier coin without letting the scan become a wall of raw bars. */
export const CHART_DIGEST_MAX_CHARS = 14_000;

export interface DigestSection { key: string; priority: number; text: string }

/** Assemble by priority until the cap; name what was dropped. Exported so the
 *  contract can prove the study survives a hostile tape while the tail yields. */
export const fitDigestSections = (sections: readonly DigestSection[], cap: number = CHART_DIGEST_MAX_CHARS): string => {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const section of [...sections].sort((a, b) => a.priority - b.priority)) {
        const next = [...kept, section.text].join('\n');
        if (next.length <= cap || kept.length === 0) kept.push(section.text);
        else dropped.push(section.key);
    }
    return dropped.length > 0
        ? `${kept.join('\n')}\nDROPPED for prompt budget (the full tape was still studied): ${dropped.join(', ')}`
        : kept.join('\n');
};

/** The token-lean story of the tape. Exported for tests. */
export const buildChartDigest = (
    candles: ScanCandle[],
    symbol: string,
    interval: string,
): { digest: string; stats: HistoricalSetupStat[]; study: TapeStudy } => {
    const n = candles.length;
    const closes = candles.map(c => c.close);
    const first = candles[0];
    const last = candles[n - 1];
    const net = first.close > 0 ? (last.close / first.close - 1) : 0;
    let atr = 0;
    for (let i = Math.max(1, n - 14); i < n; i += 1) atr += candles[i].high - candles[i].low;
    atr /= Math.min(14, n - 1);
    const stats = scanHistorySetups(candles);
    const study = buildTapeStudy(candles);
    const studyText = formatTapeStudy(study);
    const sections: DigestSection[] = [];

    sections.push({
        key: 'header',
        priority: 1,
        text: `${n} ${interval} candles of ${symbol} — ${day(first.time)} → ${day(last.time)} · net ${pct(net)} · ATR(14) ${px(atr)} (${last.close > 0 ? pct(atr / last.close) : '–'} of price) · last close ${px(last.close)}\n`
            + `EVERY candle was analysed for the time-of-day, big-move and anatomy studies below; only the ${Math.min(20, n)} raw rows at the end are a subset. Do not claim to have read bars that are not shown.`,
    });

    // ── The full-tape studies: never dropped, never sampled ────────────────
    sections.push({ key: 'time-of-day', priority: 2, text: studyText.timeOfDay });
    sections.push({ key: 'big-moves', priority: 3, text: studyText.bigMoves });
    sections.push({ key: 'candle-anatomy', priority: 4, text: studyText.anatomy });

    // ── Book-detector behaviour across all history ─────────────────────────
    const detectorLines: string[] = [
        'SETUP BEHAVIOR ACROSS ALL HISTORY (first-touch 1.5×ATR target vs 1×ATR stop, 12-bar horizon):',
    ];
    if (stats.length === 0) detectorLines.push('  (no book detector fired)');
    for (const s of stats.slice(0, 10)) {
        const wr = s.winRate === null ? 'no resolved outcomes' : `win ${(s.winRate * 100).toFixed(0)}% (${s.wins}W/${s.losses}L${s.open ? `, ${s.open} open` : ''})`;
        detectorLines.push(`  - ${s.title} [${s.side.toUpperCase()}] ×${s.hits} · ${wr} · avg MFE ${pct(s.avgMfe)} / MAE ${pct(s.avgMae)} · keywords: ${s.keywords.join(', ')}`);
    }
    sections.push({ key: 'detectors', priority: 5, text: detectorLines.join('\n') });

    // ── Regime, pivots, gaps, RSI ──────────────────────────────────────────
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
    sections.push({ key: 'regime', priority: 6, text: `REGIME segments (oldest→newest): ${segs.join(' | ')}` });

    sections.push({
        key: 'pivots',
        priority: 7,
        text: `SWING PIVOTS (oldest→newest): ${pivotList(candles).map(p => `${p.side}${px(p.price)}@${day(p.time)}`).join(' ') || 'none detected'}`,
    });

    const misc: string[] = [];
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
        misc.push(`GAPS: ${[...byKind.entries()].map(([k, e]) => `${e.total} ${k}${e.unfilled ? ` (${e.unfilled} unfilled)` : ''}`).join(', ')}`);
    }
    const rsi = rsiSeries(candles).filter(v => !Number.isNaN(v));
    if (rsi.length > 0) {
        misc.push(`RSI(14): now ${rsi[rsi.length - 1].toFixed(0)} · ${rsi.filter(v => v > 70).length} bars overbought / ${rsi.filter(v => v < 30).length} oversold of ${rsi.length}`);
    }
    if (misc.length) sections.push({ key: 'gaps-rsi', priority: 8, text: misc.join('\n') });

    const tail = candles.slice(-20);
    sections.push({
        key: 'last-20-raw-bars',
        priority: 9,
        text: `LAST ${tail.length} CANDLES (the only raw subset; oldest→newest, bar o/h/l/c):\n`
            + tail.map((c, i) => `  ${n - tail.length + i + 1} ${day(c.time)} ${px(c.open)}/${px(c.high)}/${px(c.low)}/${px(c.close)}`).join('\n'),
    });

    return { digest: fitDigestSections(sections), stats, study };
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
    // The trader's own switch, enforced AT THE ENTRY rather than only at the one
    // caller — so no future caller, and no seat that decides to call the desk
    // tool on its own, can draft without it. It returns before a single candle
    // is fetched: an off switch must cost nothing, not merely queue nothing.
    if (!getHarnessSettings().autoDraftingEnabled) {
        return {
            symbol: input.symbol, interval: input.interval, bars: 0,
            candidates: 0, created: 0, outcomes: [],
            receipt: 'DRAFTING IS SWITCHED OFF. "Draft playbooks on its own" '
                + '(Settings -> Session & limits) is not enabled, so no candles were read, '
                + 'no skill was drafted and no model call was made. Say where the switch is; '
                + 'do not call this tool again in this run.',
            error: 'auto-drafting is switched off',
        };
    }
    const username = input.username ?? getActiveUsername();
    const maxSkills = Math.min(Math.max(input.maxSkills ?? 3, 1), 5);
    const base = baseOf(input.symbol).toUpperCase();
    const empty = (bars: number, error?: string): ChartScanResult => ({
        symbol: input.symbol, interval: input.interval, bars,
        candidates: 0, created: 0, outcomes: [],
        receipt: error ?? 'CHART SKILL SCAN failed',
        error,
    });

    const klines = await fetchKlines(input.symbol, input.interval, input.bars ?? 1000);
    const candles: ScanCandle[] = klines.map(k => ({
        time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
    }));
    if (candles.length < 60) {
        return empty(candles.length,
            dataUnavailable(`${input.symbol} ${input.interval}`, `only ${candles.length} candles returned`, 'The source failed; do not infer an empty tape'));
    }

    const config = input.config ?? await resolveScanConfig(username);
    if (!config) return empty(candles.length, 'scan_chart_skills unavailable: no ready AI provider to run the scan.');

    const { digest, stats, study } = buildChartDigest(candles, input.symbol, input.interval);

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
    let created = 0;
    // Direct candidate write (owner ruling 2026-10-29): a scan creates
    // candidates, it does not queue an approval. The SAME ingest path the
    // chat's propose_skill takes, so both sources produce the same file shape.
    const { ingestCraftedSkillFromDraft } = await import('./SkillMemoryService');
    let lastCreateReason: string | undefined;
    const createCandidate = async (gated: CraftedSkill): Promise<boolean> => {
        lastCreateReason = undefined;
        const res = await ingestCraftedSkillFromDraft(
            gated,
            base,
            username,
            `chart scan ${input.symbol} ${input.interval} — candidate from the full-tape study`,
        );
        if (!res.created) lastCreateReason = res.reason ?? 'the ingest declined';
        return res.created;
    };
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
                    createCandidate,
                });
            } else {
                const det = deterministicDraftGate({ crafted, tradeId, username, coin: base });
                res = det.ok
                    ? (await createCandidate(det.crafted)
                        ? { action: 'created', crafted: det.crafted }
                        : { action: 'skipped', judged: false, reason: lastCreateReason ?? 'the candidate could not be stored, so nothing was created' })
                    : { action: 'skipped', judged: det.judged, reason: det.reason };
            }
        } catch (err) {
            res = { action: 'skipped', reason: err instanceof Error ? err.message : String(err) };
        }
        if (res.action === 'queued') {
            // The scan always supplies the direct sink; a queued result would
            // mean the sink was dropped. Reporting it as created would lie.
            res = { action: 'skipped', judged: false, reason: 'the direct candidate write did not run' };
        }
        if (res.action === 'created') created += 1;
        outcomes.push({
            name: crafted.name,
            action: res.action,
            detail: res.action === 'created'
                ? `${cluster.length > 0 ? `evidence: ${cluster.length} scored hit${cluster.length === 1 ? '' : 's'} · ` : 'no matching detector hits · '}candidate created directly (evidence sets its status)`
                : res.action === 'merged'
                    ? `folded into ${res.target}: ${res.reason}`
                    : res.reason,
        });
    }

    const activeHours = study.hours.filter(h => h.samples > 0).sort((a, b) => b.meanMove - a.meanMove);
    const bestHours = activeHours.slice(0, 3).map(h => `${String(h.hour).padStart(2, '0')}:00`).join(', ');
    const legs = `up legs ≥${(study.thresholdPct * 100).toFixed(0)}%: ${study.upMoves.length} · down legs ≥${(study.thresholdPct * 100).toFixed(0)}%: ${study.downMoves.length}`
        + (study.largestUp && study.upMoves.length === 0 ? ` (largest up ${(study.largestUp.movePct * 100).toFixed(1)}%)` : '')
        + (study.largestDown && study.downMoves.length === 0 ? ` (largest down ${(study.largestDown.movePct * 100).toFixed(1)}%)` : '');
    const receipt = [
        `CHART SKILL SCAN ${input.symbol} ${input.interval} — ${candles.length} candles, EVERY bar studied (${study.samples} forward samples across 24 PHT hours): ${legs}; most movement around ${bestHours || 'n/a'}.`,
        candidates.length === 0
            ? 'The model drafted no skill the digest supports (or the reply was unreadable). Tell the user nothing was created and why the tape did not qualify.'
            : `Model drafted ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}:`,
        ...outcomes.map(o => `- ${o.name} → ${o.action.toUpperCase()} — ${o.detail}`),
        stats.length > 0
            ? `If the user wants to ACT on a behavior rather than just learn it, arm a watch: call watch_price at a created skill's trigger level (the top hits' entry prices are in the digest) so the harness warns them when it fires again.`
            : '',
        'Skills are created DIRECTLY as candidates (no approval queue). They are hypotheses, not rules; only evidence changes their status. Tell the user what was created and which hours/legs the tape supports.',
    ].filter(Boolean).join('\n');

    return {
        symbol: input.symbol, interval: input.interval, bars: candles.length,
        candidates: candidates.length, created, outcomes, receipt,
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
            symbol: input.symbol, interval: '', bars: 0, candidates: 0, created: 0,
            outcomes: [], error: 'no intervals supplied', receipt: 'CHART SKILL SCAN — no intervals to scan.',
        };
    }
    const merged: ChartScanResult = {
        symbol: input.symbol, interval: intervals.join(','), bars: 0,
        candidates: 0, created: 0, outcomes: [], receipt: '',
    };
    const receipts: string[] = [];
    const failures: string[] = [];
    for (const interval of intervals) {
        const one = await scanChartForSkills({ ...input, interval });
        merged.bars += one.bars;
        merged.candidates += one.candidates;
        merged.created += one.created;
        merged.outcomes.push(...one.outcomes.map(o => ({ ...o, name: `${o.name} (${interval})` })));
        receipts.push(one.receipt);
        if (one.error) {
            merged.error = merged.error ?? one.error;
            failures.push(`- ${interval}: ${one.error}`);
        }
        if (input.signal?.aborted) break;
    }
    merged.receipt = intervals.length > 1
        ? [
            `CHART SKILL SCAN ${input.symbol} across ${intervals.join(', ')} — ${merged.created} candidate${merged.created === 1 ? '' : 's'} created from ${merged.candidates} drafted.`,
            // A failed interval contributes 0 candidates — without naming it,
            // "0 drafts from 0 candidates" reads as an empty tape when a
            // source actually died (violates the repo's DATA_UNAVAILABLE
            // doctrine: a failure is UNKNOWN, never absence of evidence).
            ...(failures.length > 0
                ? [`FAILED intervals — their tapes were NOT read (treat as UNKNOWN, not "found nothing"):`, ...failures]
                : []),
            merged.outcomes.map(o => `- ${o.name} → ${o.action.toUpperCase()} — ${o.detail}`).join('\n') || '(none)',
        ].join('\n')
        : receipts[0];
    return merged;
}
