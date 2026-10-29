import { isMeaningfulLabel } from './meaningfulLabel';

/**
 * A journal lesson in the ONE shape the app stores: a trigger and an action.
 * This replaced the IF/THEN clause pair on 2026-10-30. The parser still reads
 * the old prose because post-mortems written before that date are stored text;
 * everything it RETURNS is the new shape.
 */
export interface LessonClause {
    when: string;
    action: string;
}

const clean = (value: string): string =>
    value.replace(/^[\s*•\-–:：]+/, '').replace(/\s+/g, ' ').trim();

/** Pull lesson pairs from post-mortem or moderator text.
 *
 *  Current shape first — `When <trigger>, do <action>.` — then the legacy
 *  `IF <trigger> THEN <action>` and `When <trigger>, then <action>` forms, so a
 *  note written before 2026-10-30 still yields its lesson instead of going
 *  silent. Each side is sliced at 240 (the stored clause cap) and a placeholder
 *  side ("not applicable", "unknown", …) is dropped because it carries no claim.
 */
export const parseLessonClauses = (text: string): LessonClause[] => {
    if (!text || text.length < 12) return [];
    const found: LessonClause[] = [];
    const push = (rawWhen: string, rawAction: string): void => {
        const when = clean(rawWhen).slice(0, 240);
        const action = clean(rawAction).slice(0, 240);
        if (when.length < 8 || action.length < 8) return;
        if (!isMeaningfulLabel(when) || !isMeaningfulLabel(action)) return;
        if (found.some(x => x.when.toLowerCase() === when.toLowerCase())) return;
        found.push({ when, action });
    };

    // Current: "When <trigger>, do <action>."
    const whenDo = /When\s+([^,\n]{8,160}),?\s+do\s+([^\n.]{8,200})/gi;
    let match: RegExpExecArray | null;
    while ((match = whenDo.exec(text)) !== null) push(match[1], match[2]);

    // Legacy: "IF <trigger> THEN <action>." — stored notes only.
    const ifThen = /(?:New\s+IF\/THEN\s+Rule\s*[:\-–]?\s*)?IF\s+(.+?)\s+THEN\s+(.+?)(?:[.!\n]|$)/gi;
    while ((match = ifThen.exec(text)) !== null) push(match[1], match[2]);

    // Legacy: "When <trigger>, then|should|must <action>."
    const whenThen = /When\s+([^,\n]{8,120}),?\s*(?:then|should|must)\s+([^\n.]{8,200})/gi;
    while ((match = whenThen.exec(text)) !== null) push(match[1], match[2]);

    return found.slice(0, 3);
};

export const formatSkillProcedure = (clause: LessonClause): string =>
    [
        `**When:** ${clause.when}`,
        `**What I do:** ${clause.action}`,
        '**Stands until:** the trigger no longer holds, or the regime/family is different.',
    ].join('\n');

export const skillHitRate = (wins: number, losses: number): number | null => {
    const n = wins + losses;
    if (n <= 0) return null;
    return Math.round((wins / n) * 100);
};
