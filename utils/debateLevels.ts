/**
 * Compact level snapshot so debate rounds cannot invent a new tape.
 */

import { parseMarkdownTradePlan, parseProseTradePlan } from './analysisUtils';

export interface DebateLevelRow {
    speaker: string;
    direction: string;
    entry: string;
    stopLoss: string;
    tp1: string;
    tp2: string;
    tp3: string;
}

const dash = (v?: string): string => (v && v.trim() ? v.trim() : '—');

export const extractDebateLevels = (speaker: string, text: string): DebateLevelRow => {
    const md = text ? parseMarkdownTradePlan(text) : null;
    const hasLabeled = Boolean(md && (md.entry || md.stopLoss || md.takeProfit || (md.takeProfits && md.takeProfits.length > 0)));
    const src = hasLabeled ? md : (text ? parseProseTradePlan(text) : null) || md;
    const tps = (hasLabeled && md?.takeProfits) ? md.takeProfits : [];
    return {
        speaker,
        direction: dash(src?.direction),
        entry: dash(src?.entry),
        stopLoss: dash(src?.stopLoss),
        tp1: dash(tps[0]?.price || src?.takeProfit),
        tp2: dash(tps[1]?.price),
        tp3: dash(tps[2]?.price),
    };
};

export const formatDebateLevelsTable = (rows: DebateLevelRow[]): string => {
    if (rows.length === 0) return '';
    const lines = [
        '| Speaker | Dir | Entry | SL | TP1 | TP2 | TP3 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows.map(r => `| ${r.speaker} | ${r.direction} | ${r.entry} | ${r.stopLoss} | ${r.tp1} | ${r.tp2} | ${r.tp3} |`),
        '',
        'Revise a price only if you say so explicitly. Do not invent a parallel tape.',
    ];
    return lines.join('\n');
};

export interface FinalPositionRow {
    speaker: string;
    direction: string;
    entry: string;
    stopLoss: string;
}

export interface FinalPositionsSummary {
    rows: FinalPositionRow[];
    /** All declared seats (≥2) agree on one direction. */
    convergedDirection: boolean;
    /** Max entry spread across declared entries, % of median — null when
     *  fewer than two numeric entries exist. */
    entrySpreadPct: number | null;
    /** Prompt-ready block describing where each seat landed. */
    block: string;
}

/**
 * Where the floor stands NOW: each analyst's LATEST transcript turn parsed
 * into direction/entry/SL. Powers the smarter clarification skip (floor
 * converged during rebuttals → nothing left to ask) and the verdict-prompt
 * divergence summary (the moderator sees final stances, not just openings).
 */
export const summarizeFinalPositions = (
    roundTexts: Record<string, string[]>,
    speakers: string[],
): FinalPositionsSummary => {
    const rows: FinalPositionRow[] = [];
    for (const speaker of speakers) {
        if (speaker === 'Moderator' || speaker === 'System') continue;
        const rounds = roundTexts[speaker] ?? [];
        let latest = '';
        for (let i = rounds.length - 1; i >= 0; i--) {
            const text = (rounds[i] || '').trim();
            if (text) { latest = text; break; }
        }
        if (!latest) continue;
        const row = extractDebateLevels(speaker, latest);
        rows.push({ speaker, direction: row.direction, entry: row.entry, stopLoss: row.stopLoss });
    }
    const declared = rows.filter(r => r.direction === 'Long' || r.direction === 'Short');
    const convergedDirection = declared.length >= 2 && declared.every(r => r.direction === declared[0].direction);
    const entries = rows
        .map(r => Number((r.entry || '').replace(/[$,\s]/g, '')))
        .filter(n => Number.isFinite(n) && n > 0);
    let entrySpreadPct: number | null = null;
    if (entries.length >= 2) {
        const sorted = [...entries].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (median > 0) entrySpreadPct = ((sorted[sorted.length - 1] - sorted[0]) / median) * 100;
    }
    const lines = rows.map(r => `- ${r.speaker}: ${r.direction} · entry ${r.entry} · SL ${r.stopLoss}`);
    const bits: string[] = [];
    if (convergedDirection) bits.push(`all declared seats agree on ${declared[0].direction}`);
    if (entrySpreadPct !== null) bits.push(`entry spread ${entrySpreadPct.toFixed(2)}%`);
    const block = [
        "**FINAL FLOOR POSITIONS (each seat's latest stance after the debate):**",
        ...lines,
        bits.length > 0 ? `Convergence: ${bits.join(' · ')}.` : '',
        'The verdict must reconcile these final positions — do not resurrect an abandoned stance without saying why.',
    ].filter(Boolean).join('\n');
    return { rows, convergedDirection, entrySpreadPct, block };
};
