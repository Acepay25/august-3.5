/**
 * The reference's VOICE — the answer is prose, and the row does not shout.
 *
 * The reference (the Claude desktop chat) is a READING surface: the answer
 * is set in a serif, the human's bubble stays in the interface sans, and
 * nothing is stamped above a message. August had all three backwards — the
 * answer wore the UI sans, and every row wore an uppercase monospace stamp
 * with the time printed in it AND in the row's own chips.
 *
 * These are the claims that can be quietly false:
 *
 *  1. THE ANSWER IS PROSE. The trader's own words are interface; the model's
 *     answer is read.
 *  2. THE TIME IS PRINTED ONCE. The reference puts it under the answer.
 *  3. ONE HOME FOR THE VOICE. Two surfaces, one decision — a second home is
 *     how the two drifted apart in the first place.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import ChatTranscriptRow from '../components/shared/ChatTranscriptRow';
import AnalyzedRow from '../components/shared/AnalyzedRow';

describe('the answer is prose', () => {
    it('the model\'s answer wears the serif', () => {
        const { container } = render(
            <ChatTranscriptRow row={{ id: 'a1', role: 'ai', text: 'Bias long above 111k.' }} />,
        );
        expect(container.innerHTML).toContain('font-reading');
    });

    it('the trader\'s own words stay in the interface sans', () => {
        const { container } = render(
            <ChatTranscriptRow row={{ id: 'u1', role: 'user', text: 'what is the bias?' }} />,
        );
        // The human's bubble is interface, not prose: a serif there would put
        // the trader in the same voice as the model.
        expect(container.innerHTML).not.toContain('font-reading');
    });
});

describe('the row does not shout', () => {
    it('no uppercase monospace stamp above the row', () => {
        const { container } = render(
            <ChatTranscriptRow row={{ id: 'a1', role: 'ai', text: 'Bias long.', speaker: 'desk' }} />,
        );
        // The stamp was `font-mono … uppercase tracking-wider`: a log line in
        // a conversation.
        expect(container.innerHTML).not.toContain('uppercase');
        expect(container.innerHTML).not.toContain('font-mono');
    });

    it('the time is printed once', () => {
        const { container } = render(
            <ChatTranscriptRow
                row={{ id: 'a1', role: 'ai', text: 'Bias long.', speaker: 'desk', timeLabel: '5m' }}
            />,
        );
        // The reference puts the time under the answer, at the end of the
        // action row. It used to be printed there AND in the label above, so
        // every row said it twice.
        const occurrences = (container.textContent ?? '').split('5m').length - 1;
        expect(occurrences).toBe(1);
    });

    it('the seat is still named', () => {
        render(
            <ChatTranscriptRow row={{ id: 'a1', role: 'ai', text: 'Bias long.', speaker: 'Risk' }} />,
        );
        // Quiet is not nameless: August has to say which seat spoke.
        expect(screen.getByTestId('agent-message').textContent).toContain('Risk');
    });
});

describe('the work says it is running', () => {
    it('the running dots are warm, not grey', () => {
        const { container } = render(
            <AnalyzedRow running summary="3 reads" activity="Reading the order book">
                <span>work</span>
            </AnalyzedRow>,
        );
        // Grey said "something is happening". The app's running hue is amber,
        // and the reference's dots are warm.
        expect(container.innerHTML).toContain('bg-amber-500/80');
        expect(container.innerHTML).not.toContain('bg-zinc-500');
    });
});

describe('one home for the voice', () => {
    it('both surfaces mount the same component', () => {
        expect(readFileSync('components/shared/ChatTranscriptRow.tsx', 'utf8')).toMatch(/<AnswerBody/);
        expect(readFileSync('components/trade/panels/ChatTranscriptList.tsx', 'utf8')).toMatch(/<AnswerBody/);
    });

    it('the caller\'s class is added to the base rules, not swapped for them', () => {
        // A caller that says "this answer is serif" must not lose the size
        // and the paragraph rhythm every answer shares.
        const source = readFileSync('components/shared/chatChips.tsx', 'utf8');
        expect(source).toMatch(/\$\{className \?\? ''\}/);
    });
});
