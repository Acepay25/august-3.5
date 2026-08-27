import { isMeaningfulLabel } from './meaningfulLabel';

export interface IfThenClause {
    ifCondition: string;
    thenAction: string;
}

const clean = (value: string): string =>
    value.replace(/^[\s*•\-–:：]+/, '').replace(/\s+/g, ' ').trim();

/** Pull mechanical IF/THEN pairs from post-mortem or moderator text. */
export const parseIfThenClauses = (text: string): IfThenClause[] => {
    if (!text || text.length < 12) return [];
    const found: IfThenClause[] = [];
    const push = (rawIf: string, rawThen: string): void => {
        const ifCondition = clean(rawIf).slice(0, 240);
        const thenAction = clean(rawThen).slice(0, 240);
        if (ifCondition.length < 8 || thenAction.length < 8) return;
        // A clause whose whole side is a placeholder ("not applicable",
        // "unknown", …) carries no tradable claim — drop it.
        if (!isMeaningfulLabel(ifCondition) || !isMeaningfulLabel(thenAction)) return;
        if (found.some(x => x.ifCondition.toLowerCase() === ifCondition.toLowerCase())) return;
        found.push({ ifCondition, thenAction });
    };

    const ifThen = /(?:New\s+IF\/THEN\s+Rule\s*[:\-–]?\s*)?IF\s+(.+?)\s+THEN\s+(.+?)(?:[.!\n]|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = ifThen.exec(text)) !== null) {
        push(match[1], match[2]);
    }

    const whenThen = /When\s+([^,\n]{8,120}),?\s*(?:then|should|must)\s+([^\n.]{8,200})/gi;
    while ((match = whenThen.exec(text)) !== null) {
        push(match[1], match[2]);
    }

    return found.slice(0, 3);
};

export const formatSkillProcedure = (clause: IfThenClause): string =>
    [
        `**When:** ${clause.ifCondition}`,
        `**What I do:** ${clause.thenAction}`,
        '**Stands until:** the IF no longer holds, or the regime/family is different.',
    ].join('\n');

export const skillHitRate = (wins: number, losses: number): number | null => {
    const n = wins + losses;
    if (n <= 0) return null;
    return Math.round((wins / n) * 100);
};
