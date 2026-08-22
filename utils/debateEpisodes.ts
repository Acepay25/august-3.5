/**
 * NAC-style debate episodes: committed round handoffs.
 *
 * The visible debate chat still streams full turns. Later model calls
 * (rebuttal, clarification, verdict) receive these episodes instead of the
 * raw transcript, so context rot does not accumulate across rounds.
 */

import { extractDebateLevels } from './debateLevels';
import { CLARIFICATION_MARKERS_RE } from '../constants/debateMarkers';

const CLAIM_CHARS = 220;
const MODERATOR_CHARS = 480;

const stripMarkers = (text: string): string =>
    text.replace(CLARIFICATION_MARKERS_RE, '').trim();

const firstSentences = (text: string, maxChars: number): string => {
    const cleaned = text
        .replace(/\*\*FINAL TRADE PLAN\*\*[\s\S]*$/i, '')
        .replace(/[#>*`|_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return '';
    const parts = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
    let out = '';
    for (const part of parts) {
        const next = out ? `${out} ${part}` : part;
        if (next.length > maxChars) {
            if (!out) return `${part.slice(0, maxChars - 1).trimEnd()}…`;
            break;
        }
        out = next;
        if (out.length >= maxChars * 0.7) break;
    }
    return out;
};

const labeled = (text: string, keys: string[]): string | null => {
    for (const key of keys) {
        const match = text.match(new RegExp(`\\*\\*${key}\\*\\*:?\\s*([^\\n*]+)`, 'i'))
            || text.match(new RegExp(`(?:^|\\n)\\s*${key}\\s*[:—-]\\s*([^\\n]+)`, 'i'));
        const value = match?.[1]?.trim();
        if (value) return value.replace(/\s+/g, ' ').slice(0, 80);
    }
    return null;
};

/**
 * Compact one speaker/round into a structured episode for later model context.
 */
export const compactDebateEpisode = (speaker: string, round: number, text: string): string => {
    const clean = stripMarkers(text || '');
    if (!clean) return `**${speaker} (R${round} episode):** (empty)`;

    if (speaker === 'Moderator' || speaker === 'System') {
        const claim = firstSentences(clean, MODERATOR_CHARS) || clean.slice(0, MODERATOR_CHARS);
        return `**${speaker} (R${round} episode):** ${claim}`;
    }

    const levels = extractDebateLevels(speaker, clean);
    const confidence = labeled(clean, ['Confidence', 'Conviction']);
    const probability = labeled(clean, ['Probability', 'Prob']);
    const invalidation = labeled(clean, ['Invalidation', 'Risk Veto', 'Veto']);
    const bits = [
        levels.direction !== '—' ? levels.direction : null,
        confidence,
        probability,
        levels.entry !== '—' ? `Entry ${levels.entry}` : null,
        levels.stopLoss !== '—' ? `SL ${levels.stopLoss}` : null,
        levels.tp1 !== '—' ? `TP1 ${levels.tp1}` : null,
    ].filter(Boolean);

    const claim = firstSentences(clean, CLAIM_CHARS);
    const parts = [`**${speaker} (R${round} episode):** ${bits.length > 0 ? bits.join(' · ') : 'position recorded'}`];
    if (claim) parts.push(`Claim: ${claim}`);
    if (invalidation) parts.push(`Open: ${invalidation}`);
    return parts.join(' | ');
};
