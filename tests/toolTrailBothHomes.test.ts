/**
 * The tool trail works in BOTH homes.
 *
 * The dock's rows have always carried a trail: the lines the desk wrote, and
 * the payload id for each, so a row could open onto the REAL output the tool
 * returned. The Chat surface had neither — its tool lines arrived as ONE
 * newline-joined string, so a reader that took them for a list drew a single
 * giant row, the call/result pairing never happened, and the expander could
 * never appear: the payload was saved and nothing could find it again.
 *
 * So the row model carries the trail as a LIST (`Message.toolEvents`) and the
 * ids beside it (`Message.toolIds`), and the live feed stays what it is: the
 * capped, joined feed a filling bubble shows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { liveEntryFromMessage } from '../services/trade/chatSessions';
import { MessageRole } from '../types/enums';
import type { Message } from '../types/message';

const msg = (over: Partial<Message> = {}): Message => ({
    id: 'm1',
    role: MessageRole.AI,
    text: 'answer',
    createdAt: '2026-10-21T00:00:00.000Z',
    ...over,
} as Message);

describe('the trail reaches the dock’s projection of a Chat row', () => {
    it('splits the joined live feed into ONE line per entry', () => {
        // The blob was the defect: `liveToolEvents` is newline-JOINED, so a
        // reader that took it for a list got one row holding every line.
        const entry = liveEntryFromMessage(msg({
            liveToolEvents: { desk: 'calling order book…\norder book · ok' },
        }));
        expect(entry.tools).toEqual(['calling order book…', 'order book · ok']);
    });

    it('prefers the settled trail over the capped live feed', () => {
        // The live feed keeps the LAST eight lines; the trail keeps all of
        // them. A settled row must show the whole record.
        const entry = liveEntryFromMessage(msg({
            toolEvents: ['a', 'b', 'c'],
            liveToolEvents: { desk: 'b\nc' },
        }));
        expect(entry.tools).toEqual(['a', 'b', 'c']);
    });

    it('carries the payload ids beside the lines', () => {
        const entry = liveEntryFromMessage(msg({
            toolEvents: ['calling order book…', 'order book · ok'],
            toolIds: ['', 'call-1'],
        }));
        expect(entry.toolIds).toEqual(['', 'call-1']);
    });

    it('falls back to the live feed for a row written before the trail existed', () => {
        const entry = liveEntryFromMessage(msg({
            liveToolEvents: { desk: 'calling indicators…' },
        }));
        expect(entry.tools).toEqual(['calling indicators…']);
    });
});

describe('the Chat surface reads the same trail', () => {
    it('passes the trail and the ids to the row', () => {
        const src = readFileSync('components/agents/AgentsView.tsx', 'utf8');
        expect(src).toMatch(/toolLines: trail,/);
        expect(src).toMatch(/toolIds: m\.toolIds,/);
    });

    it('splits the joined live feed there too', () => {
        // One reader of the blob, not two: the dock's projection and the Chat
        // row must not disagree about how many lines a turn had.
        const src = readFileSync('components/agents/AgentsView.tsx', 'utf8');
        expect(src).toMatch(/flatMap\(feed => feed\.split\('\\n'\)\)/);
        const sessions = readFileSync('services/trade/chatSessions.ts', 'utf8');
        expect(sessions).toMatch(/flatMap\(feed => feed\.split\('\\n'\)\)/);
    });

    it('the row model carries the ids to the work card', () => {
        const row = readFileSync('components/shared/ChatTranscriptRow.tsx', 'utf8');
        expect(row).toMatch(/toolIds: row\.toolIds,/);
    });
});
