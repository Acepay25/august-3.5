/**
 * MemoryProvenanceService (ROUND-26) — closes the last measurement loop:
 * "did THIS injected memory change THIS outcome?"
 *
 * Every skill already records the tradeIds that shaped it. This service
 * computes per-skill LIFT: how did trades made AFTER a skill started
 * influencing analyses perform on setups it covers, versus before? A skill
 * whose post-influence win rate is worse than its pre-influence baseline is
 * actively misleading despite plausible-looking evidence.
 *
 * Pure functions over the trade log — no LLM, no new storage. The dashboard
 * and reviewSkillEffectiveness consume these numbers directly.
 */

import type { LoggedTrade } from '../../types';
import { TradeOutcome } from '../../types';
import { getMemoryFiles } from './MemoryFilesService';
import {
    parseSkillMarkdown,
    skillMatchesSetup,
    isSkillFile,
} from './SkillMemoryService';

export interface SkillLiftResult {
    fileId: string;
    name: string;
    /** Trades whose id appears in the skill's tradeIds (evidence window). */
    influencedTrades: number;
    /** Win rate of trades logged AFTER the skill had accumulated >=1 evidence entry. */
    postWinRate: number | null;
    /** Win rate of the matching trades BEFORE any influence existed (baseline). */
    preWinRate: number | null;
    /** post − pre, percentage points. Positive = the skill helps. */
    lift: number | null;
    verdict: 'positive' | 'neutral' | 'negative' | 'insufficient-data';
}

const WIN = TradeOutcome.WIN;
const LOSS = TradeOutcome.LOSS;

export const computeSkillLift = (
    fileId: string,
    trades: LoggedTrade[],
): SkillLiftResult => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const meta = file ? parseSkillMarkdown(file.content) : null;
    const empty: SkillLiftResult = {
        fileId, name: file?.name ?? fileId,
        influencedTrades: 0, postWinRate: null, preWinRate: null,
        lift: null, verdict: 'insufficient-data',
    };
    if (!file || !meta) return empty;

    const setup = {
        coin: meta.coin,
        direction: meta.direction === 'Long' || meta.direction === 'Short' ? meta.direction : undefined,
        family: meta.family,
        pattern: undefined,
    };

    // Matching closed trades sorted oldest → newest.
    const matched = trades
        .filter(t => (t.outcome === WIN || t.outcome === LOSS) && t.analysis)
        .filter(t => skillMatchesSetup(meta, {
            coin: t.analysis?.coinName,
            direction: t.analysis?.direction === 'Long' || t.analysis?.direction === 'Short'
                ? t.analysis.direction : undefined,
            family: t.analysis?.detectedPatternFamily,
        }))
        .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    if (matched.length === 0) return empty;

    // Influence timeline: find the first timestamp at which the skill's
    // recorded tradeIds intersect the log — that's when it started shaping
    // decisions.
    const known = new Set(meta.tradeIds);
    let influenceStart: string | null = null;
    for (const t of matched) {
        if (known.has(t.id)) {
            influenceStart = t.timestamp || null;
            break;
        }
    }
    // Fallback: createdAt of the skill file approximates influence start.
    if (!influenceStart && file.createdAt) {
        const t = typeof file.createdAt === 'number' ? new Date(file.createdAt).toISOString() : file.createdAt;
        influenceStart = t;
    }

    const influencedTrades = matched.filter(t => known.has(t.id)).length;

    let preWins = 0, preTotal = 0, postWins = 0, postTotal = 0;
    for (const t of matched) {
        const isPost = influenceStart !== null && (t.timestamp || '') >= influenceStart;
        if (isPost) { postTotal += 1; if (t.outcome === WIN) postWins += 1; }
        else { preTotal += 1; if (t.outcome === WIN) preWins += 1; }
    }

    const rate = (w: number, n: number): number | null => (n > 0 ? w / n : null);
    const postWinRate = rate(postWins, postTotal);
    const preWinRate = rate(preWins, preTotal);

    let lift: number | null = null;
    if (postWinRate !== null && preWinRate !== null) lift = postWinRate - preWinRate;
    else if (postWinRate !== null && postTotal >= 3) lift = postWinRate - 0.5; // vs coin-flip baseline

    let verdict: SkillLiftResult['verdict'] = 'insufficient-data';
    if (lift !== null) {
        if (lift > 0.1) verdict = 'positive';
        else if (lift < -0.1) verdict = 'negative';
        else verdict = 'neutral';
    }

    return {
        fileId: file.id,
        name: file.name,
        influencedTrades,
        postWinRate,
        preWinRate,
        lift,
        verdict,
    };
};

/** Lift for every enabled skill, worst first (the ones to look at). */
export const computeAllSkillLifts = (trades: LoggedTrade[]): SkillLiftResult[] => {
    const out: SkillLiftResult[] = [];
    for (const f of getMemoryFiles().files) {
        if (!isSkillFile(f) || !f.enabled) continue;
        out.push(computeSkillLift(f.id, trades));
    }
    return out.sort((a, b) => (a.lift ?? 0) - (b.lift ?? 0));
};
