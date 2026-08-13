import { describe, it, expect } from 'vitest';
import { extractPostMortemFinalReport } from '../utils/postMortemReport';

describe('extractPostMortemFinalReport', () => {
    it('reads the tagged final report after the debate', () => {
        const text = `<DEBATE_START>
Moderator: root cause is a tight stop.
</DEBATE_END>
<FINAL_REPORT_START>
## Outcome
LOSS — stop was too tight.
</FINAL_REPORT_END>`;
        expect(extractPostMortemFinalReport(text)).toContain('LOSS — stop was too tight');
        expect(extractPostMortemFinalReport(text)).not.toContain('DEBATE_START');
    });

    it('falls back to text after </DEBATE_END> when tags are missing', () => {
        const text = `<DEBATE_START>talk</DEBATE_END>\n\n## Root cause\nEntry was late.`;
        expect(extractPostMortemFinalReport(text)).toContain('Entry was late');
    });

    it('returns empty when there is no report', () => {
        expect(extractPostMortemFinalReport('<DEBATE_START>only debate')).toBe('');
    });
});
