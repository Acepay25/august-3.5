/**
 * EvidencePackService — the arbiter's proactive evidence (ROUND-28, D0.3/D1.2).
 *
 * Before the verdict call, assemble a compact block so the binding decision is
 * grounded in the journal WITHOUT depending on the moderator remembering to
 * call `recall`: top similar closed trades, matched-skill index lines, and the
 * coin+direction+family cluster stats. Every section is budget-capped and the
 * pack degrades to '' cleanly when there is no history.
 *
 * The same data renders in the UI as the verdict card's evidence-pack card
 * (EvidencePackCard), so the user can audit what the moderator saw.
 */

import type { LoggedTrade } from '../../types';
import type { RootCauseClass } from '../../types';
import { getMemoryFiles } from './MemoryFilesService';
import { parseSkillMarkdown, isSkillFile, skillMatchesSetup } from './SkillMemoryService';
import { findRelevantTrades, calculatePnlR } from './PatternMemorySynthesisService';
import { evidenceFreshness } from './MemoryRetrievalService';
import type { MemoryRetrievalQuery } from './MemoryRetrievalService';
import { readDoctrineForInjection } from './DoctrineConsolidationService';
import { rootCauseForTrade, shouldAdmitTechnicalStrategyRule } from '../../utils/rootCause';
import { COMMON_WORDS } from '../../constants/commonWords';

/** Hard cap for the whole prompt-side pack — the verdict prompt is already large. */
export const EVIDENCE_PACK_MAX_CHARS = 1200;
/** Similar closed trades surfaced (matches the retrieval layer's verdict depth). */
const MAX_SIMILAR = 3;
/** Matched-skill index lines surfaced. */
const MAX_SKILLS = 3;
/** Below this sample the cluster stats line is omitted (honest no-sample). */
const MIN_SAMPLE_FOR_STATS = 3;
/** Minimum admitted technical losses before a root-cause pattern line fires. */
const MIN_CAUSE_SAMPLE = 4;

export interface SetupClusterStats {
    sample: number;
    wins: number;
    losses: number;
    winRate: number | null;
    avgR: number | null;
    lastOutcome: 'WIN' | 'LOSS' | null;
    lastDate: string | null;
    worstLesson: string | null;
}

const coinOf = (t: LoggedTrade): string =>
    (t.analysis?.coinName || '').toUpperCase().replace(/USDT?$/, '');

/**
 * Cluster stats over the trade log: coin + direction + family + regime.
 * Pure given its inputs — no storage access.
 */
export const computeSetupClusterStats = (
    coin: string | undefined,
    direction: string | undefined,
    family: string | undefined,
    trades: LoggedTrade[],
): SetupClusterStats | null => {
    if (!coin || !trades || trades.length === 0) return null;
    const wantCoin = coin.toUpperCase().replace(/USDT?$/, '');
    let wins = 0;
    let losses = 0;
    let rSum = 0;
    let rCount = 0;
    let lastOutcome: 'WIN' | 'LOSS' | null = null;
    let lastDate: string | null = null;
    let worstLesson: string | null = null;

    const matched = trades.filter(t => {
        if (t.outcome !== 'WIN' && t.outcome !== 'LOSS') return false;
        if (coinOf(t) !== wantCoin) return false;
        if ((direction === 'Long' || direction === 'Short') && t.analysis?.direction !== direction) return false;
        if (family && !(t.analysis?.detectedPatternFamily || '').toLowerCase().includes(family.toLowerCase())) return false;
        return true;
    });

    for (const t of matched) {
        if (t.outcome === 'WIN') wins += 1; else losses += 1;
        const r = calculatePnlR(t);
        if (typeof r === 'number') { rSum += r; rCount += 1; }
        const ts = t.timestamp || '';
        if (!lastDate || ts > lastDate) {
            lastDate = ts || null;
            lastOutcome = (t.outcome as 'WIN' | 'LOSS') ?? null;
            worstLesson = (t.postMortem || '').match(/\*\*Key Lesson:\*\*\s*([^\n]+)/i)?.[1]?.trim() || null;
        }
    }

    const sample = wins + losses;
    if (sample === 0) return null;
    return {
        sample,
        wins,
        losses,
        winRate: wins / sample,
        avgR: rCount > 0 ? rSum / rCount : null,
        lastOutcome,
        lastDate,
        worstLesson,
    };
};

/**
 * One-line cluster stats for the verdict prompt. Honest "no sample" below
 * MIN_SAMPLE_FOR_STATS — the stress-test protocol becomes evidence, not ritual.
 */
export const buildSetupStatsLine = (
    coin: string | undefined,
    direction: string | undefined,
    family: string | undefined,
    trades: LoggedTrade[],
): string => {
    const stats = computeSetupClusterStats(coin, direction, family, trades);
    if (!stats) return '';
    if (stats.sample < MIN_SAMPLE_FOR_STATS) {
        return `**Setup history:** only ${stats.sample} logged trade(s) for ${coin}${direction ? ` ${direction}` : ''} — too thin to lean on.`;
    }
    const wr = stats.winRate !== null ? `${Math.round(stats.winRate * 100)}%` : '—';
    const r = stats.avgR !== null ? ` ${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(1)}R avg` : '';
    const last = stats.lastOutcome && stats.lastDate
        ? ` · last: ${stats.lastOutcome} ${stats.lastDate.slice(0, 10)}`
        : '';
    const lesson = stats.worstLesson ? ` · worst lesson: ${stats.worstLesson}` : '';
    return `**This desk's record on ${coin}${direction ? ` ${direction}` : ''}${family ? ` ${family}` : ''}:** ${stats.sample} trades · ${stats.wins}W/${stats.losses}L (${wr})${r}${last}${lesson}`;
};

/** Matched-skill one-liners (index tier — the verdict block shows full bodies separately). */
export const buildEvidenceSkillLines = (
    query: MemoryRetrievalQuery | undefined,
    max = MAX_SKILLS,
): string[] => {
    if (!query) return [];
    const setup = {
        coin: query.coin,
        direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
        family: query.family,
        pattern: query.pattern,
        regime: typeof query.regime === 'string' ? query.regime : undefined,
    };
    if (!setup.coin && !setup.family && !setup.pattern && !setup.regime) return [];
    const out: string[] = [];
    for (const file of getMemoryFiles().files) {
        if (!file.enabled || !isSkillFile(file)) continue;
        const meta = parseSkillMarkdown(file.content);
        if (!meta || meta.status === 'retired') continue;
        if (!skillMatchesSetup(meta, setup)) continue;
        const rule = meta.ifCondition
            ? `IF ${meta.ifCondition} THEN ${meta.thenAction}`
            : meta.body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').slice(0, 100) || file.name;
        out.push(`- ${meta.kind === 'avoid' ? 'AVOID' : 'REPEAT'} [skills/${file.name} · ${meta.status} · ${Math.round(meta.wins)}W/${Math.round(meta.losses)}L · ${evidenceFreshness(meta)}] ${rule}`);
        if (out.length >= max) break;
    }
    return out;
};

export interface EvidencePack {
    /** Compact markdown block injected into the verdict prompt ('' when empty). */
    promptBlock: string;
    /** Structured view for the UI card (null sections when absent). */
    ui: {
        statsLine: string;
        causePattern: string;
        similar: Array<{ outcome: string; coin: string; direction: string; date: string; lesson: string; similarity: number }>;
        skills: string[];
        doctrineHeader: string;
    };
}

const doctrineHeader = (): string => {
    try {
        const d = readDoctrineForInjection();
        if (!d) return '';
        return d.split('\n').filter(l => l.trim()).slice(0, 2).join(' ');
    } catch {
        return '';
    }
};

/**
 * Root-cause cluster line (ROUND-32, LightRAG-style high-level summary):
 * classify this coin+direction cluster's admitted technical losses by root
 * cause and surface the dominant pattern. The graph's cause nodes exist for
 * exactly this — one line turns "check your history" into a named failure
 * mode. Returns '' below MIN_CAUSE_SAMPLE (honest no-pattern).
 */
export const buildRootCausePatternLine = (
    coin: string | undefined,
    direction: string | undefined,
    trades: LoggedTrade[],
): string => {
    if (!coin || !trades || trades.length === 0) return '';
    const wantCoin = coin.toUpperCase().replace(/USDT?$/, '');
    const causes = new Map<RootCauseClass, number>();
    let total = 0;
    for (const t of trades) {
        if (t.outcome !== 'LOSS') continue;
        if ((t.analysis?.coinName || '').toUpperCase().replace(/USDT?$/, '') !== wantCoin) continue;
        if ((direction === 'Long' || direction === 'Short') && t.analysis?.direction !== direction) continue;
        // Only losses that admit a technical lesson inform an edge pattern.
        const cause = rootCauseForTrade(t);
        if (!shouldAdmitTechnicalStrategyRule(cause)) continue;
        causes.set(cause, (causes.get(cause) ?? 0) + 1);
        total += 1;
    }
    if (total < MIN_CAUSE_SAMPLE) return '';
    let best: { cause: RootCauseClass; n: number } | null = null;
    for (const [cause, n] of causes) {
        if (!best || n > best.n) best = { cause, n };
    }
    if (!best || best.cause !== 'SETUP_EDGE_FAILURE' || best.n / total < 0.5) return '';
    return `**Failure pattern:** ${best.n}/${total} of your admitted ${coin}${direction ? ` ${direction}` : ''} losses are SETUP_EDGE_FAILURE — the setups themselves, not execution or macro shocks. Tighten entry criteria before trusting this class again.`;
};

/**
 * Derive the setup query from the raw user prompt (coin / direction / family
 * keywords) — the same mining the pipeline does at send time, exposed here so
 * engine-side callers (real-debate verdict) can build an evidence pack without
 * importing from hooks/.
 */
export const deriveSetupQueryFromPrompt = (prompt: string): MemoryRetrievalQuery => {
    const upper = (prompt || '').toUpperCase();
    const coinRaw = (prompt || '').match(/\b([A-Z]{2,10})(?:USDT?)?\b/)?.[1]?.toUpperCase();
    const coin = coinRaw && !COMMON_WORDS.includes(coinRaw) ? coinRaw : undefined;
    const lower = (prompt || '').toLowerCase();
    const direction = lower.includes('long') ? 'Long' : lower.includes('short') ? 'Short' : 'Neutral';
    let family: string | undefined;
    if (upper.includes('FAMILY A') || upper.includes('EXHAUSTION') || upper.includes('TRAP') || upper.includes('FAKEOUT')) family = 'Family A';
    else if (upper.includes('FAMILY B') || upper.includes('REVERSAL')) family = 'Family B';
    else if (upper.includes('FAMILY C') || upper.includes('CONTINUATION')) family = 'Family C';
    else if (upper.includes('OMEGA') || upper.includes('MOMENTUM')) family = 'Family Omega';
    return { coin, direction, family, pattern: family };
};

/**
 * Build the verdict evidence pack. Reads the doctrine via the active user's
 * notebook; everything else is pure over (query, trades). Never throws.
 */
export const buildVerdictEvidencePack = (
    query: MemoryRetrievalQuery | undefined,
    trades: LoggedTrade[] | undefined,
): EvidencePack => {
    const ui = {
        statsLine: '',
        causePattern: '',
        similar: [] as EvidencePack['ui']['similar'],
        skills: [] as string[],
        doctrineHeader: '',
    };
    try {
        ui.statsLine = buildSetupStatsLine(query?.coin, query?.direction, query?.family, trades || []);
        ui.causePattern = buildRootCausePatternLine(query?.coin, query?.direction, trades || []);
        ui.skills = buildEvidenceSkillLines(query);

        if (trades && trades.length > 0 && query?.coin) {
            const relevant = findRelevantTrades({
                coin: query.coin,
                direction: query.direction === 'Long' || query.direction === 'Short' ? query.direction : undefined,
                pattern: query.pattern,
                family: query.family,
                regime: query.regime as 'trending' | 'ranging' | 'volatile' | 'compression' | undefined,
            }, trades, { decayByAge: true }).slice(0, MAX_SIMILAR);
            ui.similar = relevant.map(t => ({
                outcome: t.outcome,
                coin: t.coin,
                direction: t.direction,
                date: (t.date || '').slice(0, 10),
                lesson: (t.keyLesson || '').slice(0, 110),
                similarity: t.similarity,
            }));
        }

        ui.doctrineHeader = doctrineHeader();

        const sections: string[] = [];
        if (ui.statsLine) sections.push(ui.statsLine);
        if (ui.causePattern) sections.push(ui.causePattern);
        if (ui.similar.length > 0) {
            sections.push(
                '**Similar closed trades:**\n' + ui.similar
                    .map(s => `- ${s.date} ${s.coin} ${s.direction} ${s.outcome} (${s.similarity}% similar)${s.lesson ? ` — ${s.lesson}` : ''}`)
                    .join('\n')
            );
        }
        if (ui.skills.length > 0) sections.push(`**Matched notebook skills:**\n${ui.skills.join('\n')}`);
        if (ui.doctrineHeader) sections.push(`**Doctrine (settled beliefs):** ${ui.doctrineHeader}`);

        const block = sections.join('\n\n');
        return {
            promptBlock: block.length > EVIDENCE_PACK_MAX_CHARS ? `${block.slice(0, EVIDENCE_PACK_MAX_CHARS).trimEnd()}\n…` : block,
            ui,
        };
    } catch {
        return { promptBlock: '', ui };
    }
};
