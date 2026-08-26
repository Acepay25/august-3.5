import { describe, it, expect } from 'vitest';
import {
    createDebateMailbox,
    synthesizeReplyToLine,
    formatDmEventLine,
} from '../services/analysis/DebateMailbox';

describe('DebateMailbox (ROUND-38 tool-call messaging)', () => {
    it('delivers a message to exactly one seat', () => {
        const box = createDebateMailbox(['Macro Analyst', 'Risk Analyst', 'Moderator']);
        const receipt = box.send('Risk Analyst', 2, { to: 'Macro Analyst', message: 'Your 78.8k level is stale.' });
        expect(receipt).toContain('Delivered to Macro Analyst');
        expect(box.unreadCount('Macro Analyst')).toBe(1);
        expect(box.unreadCount('Risk Analyst')).toBe(0);
        expect(box.unreadCount('Moderator')).toBe(0);
    });

    it('rejects unknown recipients and empty messages with an error receipt', () => {
        const box = createDebateMailbox(['Macro Analyst']);
        expect(box.send('Macro Analyst', 1, { to: 'Nobody', message: 'hi' })).toMatch(/failed/);
        expect(box.send('Macro Analyst', 1, { to: 'Macro Analyst', message: '   ' })).toMatch(/failed/);
        // Tolerates a leading @ in the address.
        expect(box.send('Moderator', 1, { to: '@Macro Analyst', message: 'ok' })).toContain('Delivered');
    });

    it('read_message drains the inbox and marks everything read', () => {
        const box = createDebateMailbox(['A', 'B']);
        box.send('A', 1, { to: 'B', message: 'first note' });
        box.send('A', 2, { to: 'B', message: 'second note' });
        const read = box.read('B');
        expect(read).toContain('From A (Round 1)');
        expect(read).toContain('first note');
        expect(read).toContain('second note');
        expect(box.unreadCount('B')).toBe(0);
        expect(box.read('B')).toMatch(/Inbox empty/);
    });

    it('inbox notice fires only while mail is waiting, naming senders', () => {
        const box = createDebateMailbox(['A', 'B']);
        expect(box.inboxNotice('B')).toBe('');
        box.send('A', 1, { to: 'B', message: 'hello' });
        const notice = box.inboxNotice('B');
        expect(notice).toContain('DIRECT MESSAGES WAITING');
        expect(notice).toContain('read_message');
        expect(notice).toContain('A');
        // Reading clears it.
        box.read('B');
        expect(box.inboxNotice('B')).toBe('');
    });

    it('recipientsFor tracks who each seat messaged per round', () => {
        const box = createDebateMailbox(['A', 'B', 'Moderator']);
        box.send('A', 2, { to: 'B', message: 'x' });
        box.send('A', 2, { to: 'Moderator', message: 'y' });
        box.send('A', 3, { to: 'B', message: 'z' });
        expect(box.recipientsFor('A', 2)).toEqual(['B', 'Moderator']);
        expect(box.recipientsFor('A', 3)).toEqual(['B']);
        expect(box.recipientsFor('B', 2)).toEqual([]);
        expect(box.all()).toHaveLength(3);
    });

    it('synthesizeReplyToLine bridges tool sends into REPLY-TO routing', () => {
        expect(synthesizeReplyToLine('My point.', ['Risk Analyst'])).toBe('\n\nREPLY-TO: Risk Analyst\n');
        // Multiple recipients dedupe.
        expect(synthesizeReplyToLine('My point.', ['A', 'A', 'B'])).toContain('REPLY-TO: A, B');
        // Explicit routing in the turn text wins.
        expect(synthesizeReplyToLine('Point.\nREPLY-TO: Moderator', ['A'])).toBe('');
        // Nothing sent — nothing appended.
        expect(synthesizeReplyToLine('My point.', [])).toBe('');
    });

    it('formatDmEventLine truncates long bodies for transcript visibility lines', () => {
        const line = formatDmEventLine({ from: 'A', toKey: 'b', toLabel: 'B', text: 'short', round: 2 });
        expect(line).toBe('A → B (direct message): "short"');
        const long = formatDmEventLine({ from: 'A', toKey: 'b', toLabel: 'B', text: 'x'.repeat(400), round: 2 });
        expect(long.length).toBeLessThan(280);
        expect(long).toMatch(/…"/);
    });
});
