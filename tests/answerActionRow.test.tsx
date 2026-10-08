import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SpeakChip } from '../components/shared/chatChips';

/**
 * The action row is ALWAYS VISIBLE, and read-aloud is a real capability rather
 * than chrome.
 *
 * Both are gated by `render-probe`, which fails any inert control on the Learn
 * and Journal surfaces — but those are not the surfaces a transcript row lives
 * on, so the property is pinned here instead. jsdom has no `speechSynthesis`,
 * which also makes it the natural place to prove the control degrades honestly.
 */

const stubSpeech = (): {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    listeners: Set<string>;
    dispatch: (type: string) => void;
} => {
    const handlers = new Map<string, Set<() => void>>();
    const listeners = new Set<string>();
    const speak = vi.fn();
    const cancel = vi.fn();
    Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
            speak,
            cancel,
            addEventListener: (type: string, fn: () => void) => {
                listeners.add(type);
                const set = handlers.get(type) ?? new Set();
                set.add(fn);
                handlers.set(type, set);
            },
            removeEventListener: (type: string, fn: () => void) => {
                listeners.delete(type);
                handlers.get(type)?.delete(fn);
            },
        },
    });
    // jsdom ships `speechSynthesis` without the utterance CLASS — the exact
    // half-present shape the chip has to survive — so the stub supplies it.
    (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance =
        class { text: string; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(text: string) { this.text = text; } };
    return {
        speak,
        cancel,
        listeners,
        dispatch: (type: string) => handlers.get(type)?.forEach(fn => fn()),
    };
};

describe('SpeakChip', () => {
    beforeEach(() => {
        // Reset both halves of the API so each case controls what is present.
        delete (window as unknown as Record<string, unknown>).speechSynthesis;
        delete (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
    });

    it('is NOT drawn where the API is absent — no dead control', () => {
        // THE HONESTY RULE. jsdom has no speechSynthesis; a button rendered here
        // would look live and do nothing. The reference's rule is that anything
        // that cannot be honestly built renders disabled with a reason, or not at
        // all. Returning null is the correct half of that.
        const { container } = render(<SpeakChip text="close above 69000" />);
        expect(container.firstChild).toBeNull();
    });

    it('reads the answer aloud when pressed, and stops when pressed again', () => {
        const { speak, cancel, dispatch } = stubSpeech();
        render(<SpeakChip text="close above 69000" />);
        // `act` around the press: without it React batches the setSpeaking update
        // and the next query still sees the idle label.
        act(() => { screen.getByRole('button', { name: 'Read this answer aloud' }).click(); });
        expect(speak).toHaveBeenCalledTimes(1);
        expect(speak.mock.calls[0][0].text).toBe('close above 69000');

        // Toggle to stop — the same control cancels rather than queueing a second
        // utterance on top of the first.
        expect(screen.getByRole('button', { name: 'Stop reading aloud' })).toBeDefined();
        act(() => { screen.getByRole('button', { name: 'Stop reading aloud' }).click(); });
        expect(cancel).toHaveBeenCalled();
        expect(speak).toHaveBeenCalledTimes(1);

        // And the utterance ENDING returns the chip to idle on its own — the
        // state is driven by the speech event, not only by this control.
        act(() => { screen.getByRole('button', { name: 'Read this answer aloud' }).click(); });
        expect(speak).toHaveBeenCalledTimes(2);
        act(() => { dispatch('end'); });
        expect(screen.getByRole('button', { name: 'Read this answer aloud' })).toBeDefined();
    });

    it('cancels on unmount so leaving the row does not leave a voice running', () => {
        // Navigating away mid-sentence must not keep reading a row the user is no
        // longer looking at.
        const { speak, cancel } = stubSpeech();
        const { unmount } = render(<SpeakChip text="long answer" />);
        act(() => { screen.getByRole('button').click(); });
        unmount();
        expect(speak).toHaveBeenCalled();
        expect(cancel).toHaveBeenCalled();
    });

    it('unsubscribes its end/error listeners on unmount', () => {
        // The listener set is the leak check: a chip that adds without removing
        // keeps a setState path alive after every answer it ever read.
        const { listeners } = stubSpeech();
        const { unmount } = render(<SpeakChip text="x" />);
        expect(listeners.size).toBe(2);
        unmount();
        expect(listeners.size).toBe(0);
    });

    it('names itself for a screen reader, and is not a bare icon', () => {
        stubSpeech();
        render(<SpeakChip text="x" />);
        expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Read this answer aloud');
        expect(screen.getByRole('button').getAttribute('title')).toBe('Read this answer aloud');
    });
});
