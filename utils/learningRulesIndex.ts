import type { LearningRule } from '../types/learning';

/**
 * The learned-rule index, for the prompt.
 *
 * `learning_rules_v2_<user>` was written at boot, mirrored into the profile, and
 * swept by backups — and read by NO prompt, so thousands of distilled IF/THEN
 * rules the app had earned never reached a seat (docs/AUDIT.md M-5). This is its
 * reader: a compact, budgeted block beside the skills and topics indexes.
 *
 * Rows are rules the trader's own journal produced, so they are stated as rules,
 * not as advice, and the source outcome rides along: a rule learned from a loss
 * and one learned from a win are read differently.
 */
export const buildLearningRulesIndex = (rules: readonly LearningRule[] | undefined, limit: number): string => {
    if (!rules || rules.length === 0 || limit <= 0) return '';
    const rows = rules
        .filter(r => r.status !== 'retired')
        .filter(r => (r.ifCondition ?? '').trim() && (r.thenAction ?? '').trim())
        // Newest first: the store appends, and the oldest rule must not hold a
        // prompt slot forever while this week's lessons wait behind it.
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
        .slice(0, Math.floor(limit))
        .map(r => {
            const coin = r.coin ? `${r.coin} · ` : '';
            const source = r.outcome === 'LOSS' ? ' · learned from a loss' : ' · learned from a win';
            return `- ${coin}IF ${r.ifCondition.trim()} → ${r.thenAction.trim()}${source}`;
        });
    if (rows.length === 0) return '';
    return `## Rules learned from this journal\n${rows.join('\n')}`;
};
