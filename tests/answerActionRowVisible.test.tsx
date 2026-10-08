import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatTranscriptRow, { type ChatRowView } from '../components/shared/ChatTranscriptRow';

/**
 * The action row is ALWAYS VISIBLE.
 *
 * This is the property `render-probe` cannot see for a transcript row — it
 * asserts Learn and Journal controls are live, and a dock row is on neither
 * surface. The old row was `opacity-0 group-hover/msg:opacity-100`, which hid
 * copy from anyone who did not know to hover-hunt, and which jsdom renders as
 * invisible-but-present — so a unit test asserting the button EXISTS passes
 * either way. The assertion has to be on the wrapper's opacity, which is the
 * thing that actually changed.
 */

const base: ChatRowView = {
    id: 'm1',
    role: 'ai',
    text: 'long above 69000, stop 67500',
    timeLabel: '5m ago',
};

describe('the answer action row', () => {
    it('is always visible — the wrapper carries no hover-only opacity', () => {
        const { container } = render(<ChatTranscriptRow row={base} />);
        // The action row is the last flex row in the bubble; find it by its
        // children rather than a class that is not a contract.
        const copy = screen.getByRole('button', { name: 'Copy message' });
        const row = copy.parentElement as HTMLElement;
        expect(row.className).not.toMatch(/opacity-0/);
        expect(row.className).not.toMatch(/group-hover/);
        expect(container).toBeDefined();
    });

    it('renders the trailing relative time the reference shows', () => {
        render(<ChatTranscriptRow row={base} />);
        expect(screen.getByText('5m ago')).toBeDefined();
    });

    it('omits the time when the caller has none, rather than showing "now"', () => {
        // A row with no timestamp must not invent a recency it cannot know.
        render(<ChatTranscriptRow row={{ ...base, timeLabel: undefined }} />);
        expect(screen.queryByText('now')).toBeNull();
    });

    it('does NOT render thumbs — cut this pass as a product decision', () => {
        // Deliberately absent, not shipped-disabled. A control that can be drawn
        // but never read back is a badge, and the decision was to cut it.
        render(<ChatTranscriptRow row={base} />);
        expect(screen.queryByLabelText(/thumbs?/i)).toBeNull();
        expect(screen.queryByTitle(/thumbs?/i)).toBeNull();
    });

    it('keeps copy on an answer, which is what the hover-reveal used to hide', () => {
        render(<ChatTranscriptRow row={base} />);
        expect(screen.getByRole('button', { name: 'Copy message' })).toBeDefined();
    });

    it('keeps read-aloud on an answer only — never on the user\'s own turn', () => {
        // jsdom has no speechSynthesis, so the chip renders nothing there; this
        // pins the ROLE guard instead, which is the part that can regress.
        const { container } = render(<ChatTranscriptRow row={{ ...base, role: 'user' }} />);
        expect(container.querySelector('[aria-label="Read this answer aloud"]')).toBeNull();
    });
});
