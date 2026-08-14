import { DebateTurn, TradeAnalysis } from '../types';
import { parseMarkdownTradePlan, tradePlanToAnalysis, sanitizeTradeAnalysis } from './analysisUtils';

export const debateTurnsToRoundTexts = (turns: DebateTurn[]): Record<string, string[]> => {
    const out: Record<string, string[]> = { Moderator: [] };
    for (const turn of turns) {
        if (!turn.text || turn.speaker === 'System') continue;
        if (!out[turn.speaker]) out[turn.speaker] = [];
        const round = turn.round || 1;
        out[turn.speaker][round] = (out[turn.speaker][round] || '') + turn.text;
    }
    return out;
};

export const lastCompletedRound = (turns: DebateTurn[]): number =>
    Math.max(0, ...turns.map(t => t.round || 0));

export interface ResumeAnalystSeed {
    name: string;
    opening: string;
    analysis: TradeAnalysis;
}

export const reconstructOpenings = (turns: DebateTurn[]): ResumeAnalystSeed[] => {
    const bySpeaker = new Map<string, string>();
    for (const turn of turns) {
        if (!turn.text || turn.speaker === 'System' || turn.speaker === 'Moderator') continue;
        if ((turn.round || 1) !== 1) continue;
        bySpeaker.set(turn.speaker, (bySpeaker.get(turn.speaker) || '') + turn.text);
    }
    return [...bySpeaker.entries()].map(([name, opening]) => {
        const plan = parseMarkdownTradePlan(opening);
        const analysis = plan
            ? sanitizeTradeAnalysis(tradePlanToAnalysis(plan))
            : sanitizeTradeAnalysis({
                direction: 'Neutral',
                confidence: 'Low',
                probability: 50,
                strategy: opening.slice(0, 400),
            });
        return { name, opening, analysis };
    });
};
