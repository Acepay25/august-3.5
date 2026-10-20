import { describe, it, expect, beforeEach } from 'vitest';

/**
 * E-13 — the truncation tally has to be REAL.
 *
 * `utils/finishReason.ts` normalises the four providers' stop signals onto one
 * `FinishReason` and brackets a run's truncation tally. The bracket had ZERO
 * production call sites, so `recordFinishReason` returned immediately and NO
 * run ever recorded a truncation — a provider that stopped at the token
 * ceiling was indistinguishable from one that finished, because a truncated
 * body is a SUCCESS-shaped response and nothing else in the transport
 * reports it.
 *
 * `AGENTS.md` says: "Read the ceiling with `peekTruncations()`; don't
 * re-derive it from a missing regex match." This file makes that sentence
 * true: the window can be opened, the tally records, and the run says so.
 */

import {
    beginTruncationWindow,
    consumeTruncations,
    peekTruncations,
    recordFinishReason,
    resetTruncationWindow,
    truncationNotice,
    withTruncationWindow,
} from '../utils/finishReason';

describe('E-13 — the window records what the provider did', () => {
    beforeEach(() => {
        resetTruncationWindow();
    });

    it('a finish reason outside a window records nothing (the old behaviour: every run reported complete)', () => {
        recordFinishReason('length');
        expect(peekTruncations().truncated).toBe(false);
        expect(peekTruncations().callsObserved).toBe(0);
    });

    it('a finish reason inside a window is counted', () => {
        beginTruncationWindow();
        recordFinishReason('stop');
        recordFinishReason('length');
        recordFinishReason('length');
        const summary = consumeTruncations();
        expect(summary.truncated).toBe(true);
        expect(summary.truncatedCalls).toBe(2);
        expect(summary.callsObserved).toBe(3);
    });

    it('withTruncationWindow brackets the turn and hands back its own reading', async () => {
        const { value, summary } = await withTruncationWindow(async () => {
            recordFinishReason('length');
            return 'answer';
        });
        expect(value).toBe('answer');
        expect(summary.truncated).toBe(true);
        expect(summary.truncatedCalls).toBe(1);
    });

    it('a turn that throws still CLOSES the window (a leaked window would steal the next run\'s tally)', async () => {
        await expect(withTruncationWindow(async () => {
            recordFinishReason('length');
            throw new Error('provider exploded');
        })).rejects.toThrow('provider exploded');
        // The window is CLOSED: the tally a reader sees is the last closed
        // window's, and a reason recorded now belongs to no run — so the
        // reading does not move. A leaked (still open) window would show the
        // live counter instead and the reading WOULD move.
        const before = peekTruncations();
        recordFinishReason('length');
        expect(peekTruncations()).toEqual(before);
    });

    it('a clean turn leaves the tally clean', async () => {
        const { summary } = await withTruncationWindow(async () => {
            recordFinishReason('stop');
        });
        expect(summary.truncated).toBe(false);
        expect(summary.truncatedCalls).toBe(0);
        expect(summary.callsObserved).toBe(1);
    });
});

describe('E-13 — the notice the run shows', () => {
    it('says nothing when nothing was cut off', () => {
        expect(truncationNotice({ truncated: false, truncatedCalls: 0, callsObserved: 1 })).toBe('');
    });

    it('says so, in words, when the provider stopped early', () => {
        const notice = truncationNotice({ truncated: true, truncatedCalls: 1, callsObserved: 2 });
        expect(notice).toMatch(/STOPPED EARLY/i);
        expect(notice).toMatch(/one answer/i);
        expect(notice).toMatch(/token ceiling/i);
    });

    it('counts the answers that were cut off', () => {
        const notice = truncationNotice({ truncated: true, truncatedCalls: 3, callsObserved: 3 });
        expect(notice).toMatch(/3 answers/i);
    });
});
