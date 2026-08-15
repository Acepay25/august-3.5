import { DebateLevelRow, extractDebateLevels } from './debateLevels';

const fieldDiff = (own: DebateLevelRow, other: DebateLevelRow): string[] => {
    const bits: string[] = [];
    if (other.direction !== own.direction && other.direction !== '—') bits.push(`dir ${other.direction}`);
    if (other.entry !== own.entry && other.entry !== '—') bits.push(`entry ${other.entry}`);
    if (other.stopLoss !== own.stopLoss && other.stopLoss !== '—') bits.push(`SL ${other.stopLoss}`);
    if (other.tp1 !== own.tp1 && other.tp1 !== '—') bits.push(`TP1 ${other.tp1}`);
    return bits;
};

/** Compact disagreement packet — rebuttals do not re-send full openings. */
export const buildRebuttalDiffPacket = (ownName: string, ownText: string, others: Array<{ name: string; text: string }>): string => {
    const own = extractDebateLevels(ownName, ownText);
    const lines = others.map(({ name, text }) => {
        const row = extractDebateLevels(name, text);
        const diffs = fieldDiff(own, row);
        return diffs.length > 0
            ? `- ${name}: disagrees (${diffs.join(', ')})`
            : `- ${name}: aligned on ${row.direction} / ${row.entry}`;
    });
    return [
        `**YOUR LEVELS:** ${own.direction} · ${own.entry} / SL ${own.stopLoss} / TP1 ${own.tp1}`,
        '**DIFFS:**',
        ...(lines.length > 0 ? lines : ['- No other openings to diff.']),
        'Reply with Concede / Challenge / Levels only. Do not restate your opening thesis.',
    ].join('\n');
};
