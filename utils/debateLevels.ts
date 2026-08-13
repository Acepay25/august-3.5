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
