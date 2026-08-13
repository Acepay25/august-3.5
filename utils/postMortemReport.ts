/**
 * Pull the moderator's structured post-mortem report out of a debate stream.
 * The debate itself is the transcript; the journal stores this report.
 */
export function extractPostMortemFinalReport(fullDebateText: string): string {
    if (!fullDebateText) return '';

    const taggedStart = fullDebateText.match(/<FINAL_REPORT_START>/i);
    if (taggedStart) {
        const taggedEnd = fullDebateText.match(/<\/FINAL_REPORT_END>/i);
        return fullDebateText
            .slice(taggedStart.index! + taggedStart[0].length, taggedEnd ? taggedEnd.index : undefined)
            .trim();
    }

    const debateEnd = fullDebateText.match(/<\/DEBATE_END>/i);
    if (debateEnd) {
        const after = fullDebateText.slice(debateEnd.index! + debateEnd[0].length).trim();
        if (after) {
            return after.replace(/^(?:[-=_*]*\s*)?(?:2\.\s*)?FINAL REPORT(?:[-=_*]*\s*)?/i, '').trim();
        }
        const lastPart = fullDebateText.slice(-2000);
        const headingMatch = lastPart.match(/(?:^|\n)\s*(?:[*_#]*)\s*FINAL REPORT\s*(?:[*_#]*)/i);
        if (headingMatch) {
            return lastPart.slice(headingMatch.index! + headingMatch[0].length).trim();
        }
    }

    const headingMatch = fullDebateText.match(/(?:^|\n)\s*(?:[*_#]*)\s*FINAL REPORT\s*(?:[*_#]*)/i);
    if (headingMatch) {
        return fullDebateText.slice(headingMatch.index! + headingMatch[0].length).trim();
    }

    return '';
}
