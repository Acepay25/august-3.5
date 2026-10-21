/**
 * The chat rail's VOICE — quiet, the way the reference's rail is.
 *
 * The reference's sidebar names its sections in sentence case ("Pinned",
 * "Chats and tasks") and lists conversations in a regular weight. August's rail
 * shouted: every heading was UPPERCASE and letter-spaced, and every
 * conversation title was bold. A rail is a list of things to go to, and a list
 * of headlines is not a list.
 *
 * These are SOURCE claims on purpose: the rail's labels are class strings, and
 * jsdom does not read a stylesheet, so asserting the rendered text would pass
 * while the class still shouted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const RAIL = readFileSync('components/agents/AgentsView.tsx', 'utf8');

describe('the chat rail keeps the reference\'s quiet voice', () => {
    it('no section heading is uppercase and letter-spaced', () => {
        // The reference's headings are sentence case, muted and small.
        expect(RAIL).not.toMatch(/uppercase tracking-widest/);
    });

    it('no conversation title is bold', () => {
        // A list of bold titles reads as a list of headlines.
        const title = RAIL.match(/<span className="block truncate text-ui-sm[^"]*"[^>]*>\{r\.title\}<\/span>/);
        expect(title).not.toBeNull();
        expect(title![0]).not.toContain('font-semibold');
    });

    it('the tabs are quiet too', () => {
        const tabs = RAIL.match(/data-testid=\{`rail-tab-\$\{id\}`\}[\s\S]{0,600}?\{label\}/);
        expect(tabs).not.toBeNull();
        expect(tabs![0]).not.toContain('uppercase');
    });

    it('the conversation glyph is the reference\'s plain mark, not a circled badge', () => {
        // The reference draws a small chat glyph; a ring around every row made
        // a list of medallions.
        const row = RAIL.match(/data-testid="conversation-row"[\s\S]{0,2000}?\{r\.title\}/);
        expect(row).not.toBeNull();
        expect(row![0]).not.toContain('rounded-full');
    });
});
