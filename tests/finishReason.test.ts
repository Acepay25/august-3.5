import { describe, expect, it, beforeEach } from 'vitest';
import {
    beginTruncationWindow,
    consumeTruncations,
    extractFinishReason,
    normalizeFinishReason,
    peekTruncations,
    recordFinishReason,
    resetTruncationWindow,
    truncatesOutput,
} from '../utils/finishReason';

describe('normalizeFinishReason', () => {
    it('maps every format\'s token-ceiling signal onto "length"', () => {
        expect(normalizeFinishReason('length')).toBe('length');
        expect(normalizeFinishReason('max_tokens')).toBe('length');
        expect(normalizeFinishReason('max_output_tokens')).toBe('length');
        expect(normalizeFinishReason('MODEL_MAX_TOKENS')).toBe('length');
    });

    it('maps the clean-stop vocabulary', () => {
        expect(normalizeFinishReason('stop')).toBe('stop');
        expect(normalizeFinishReason('end_turn')).toBe('stop');
        expect(normalizeFinishReason('completed')).toBe('stop');
        expect(normalizeFinishReason('tool_calls')).toBe('tool_calls');
        expect(normalizeFinishReason('content_filter')).toBe('content_filter');
    });

    it('keeps an unrecognized provider vocabulary visible, never silently "stop"', () => {
        // The whole point: a gateway inventing a new value must show up in
        // telemetry as 'unknown' rather than being classified as complete.
        expect(normalizeFinishReason('brand_new_gateway_value')).toBe('unknown');
        expect(normalizeFinishReason(undefined)).toBe('unknown');
        expect(normalizeFinishReason(null)).toBe('unknown');
        expect(normalizeFinishReason('')).toBe('unknown');
        expect(normalizeFinishReason(42)).toBe('unknown');
    });

    it('only "length" counts as a truncation', () => {
        expect(truncatesOutput('length')).toBe(true);
        expect(truncatesOutput('stop')).toBe(false);
        expect(truncatesOutput('unknown')).toBe(false);
        // A failed call throws; it is not a silently-short answer.
        expect(truncatesOutput('error')).toBe(false);
    });
});

describe('extractFinishReason', () => {
    it('reads the chat_completions shape', () => {
        expect(extractFinishReason({ choices: [{ finish_reason: 'length' }] })).toBe('length');
        expect(extractFinishReason({ choices: [{ message: {}, finish_reason: 'stop' }] })).toBe('stop');
    });

    it('reads the Anthropic messages shape', () => {
        expect(extractFinishReason({ content: [{ type: 'text', text: 'x' }], stop_reason: 'max_tokens' }))
            .toBe('length');
        expect(extractFinishReason({ stop_reason: 'end_turn' })).toBe('stop');
    });

    it('treats a Responses "incomplete" 200 as a truncation, not a completion', () => {
        // This is the case that used to be invisible: status:'incomplete' is a
        // SUCCESS-shaped response, so every parser accepted the body as final.
        expect(extractFinishReason({ status: 'incomplete' })).toBe('length');
        expect(extractFinishReason({
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
        })).toBe('length');
        expect(extractFinishReason({ status: 'completed' })).toBe('stop');
        expect(extractFinishReason({ status: 'failed' })).toBe('error');
    });

    it('reads the Gemini per-candidate shape', () => {
        expect(extractFinishReason({ candidates: [{ content: {}, finishReason: 'MAX_TOKENS' }] })).toBe('length');
        expect(extractFinishReason({ candidates: [{ finishReason: 'STOP' }] })).toBe('stop');
        expect(extractFinishReason({ candidates: [{ finishReason: 'SAFETY' }] })).toBe('content_filter');
    });

    it('returns undefined — NOT "unknown" — when the provider sent no signal', () => {
        // A missing field must never be counted as a truncation, or every
        // gateway that omits it would poison the per-run tally.
        expect(extractFinishReason({ choices: [{ message: {} }] })).toBeUndefined();
        expect(extractFinishReason(null)).toBeUndefined();
        expect(extractFinishReason('junk')).toBeUndefined();
    });
});

describe('per-run truncation tally', () => {
    beforeEach(() => resetTruncationWindow());

    it('records nothing until a window opens', () => {
        recordFinishReason('length');
        expect(peekTruncations()).toEqual({ truncated: false, truncatedCalls: 0, callsObserved: 0 });
    });

    it('counts only ceiling hits inside the window', () => {
        beginTruncationWindow();
        recordFinishReason('stop');
        recordFinishReason('length');
        recordFinishReason('length');
        recordFinishReason(undefined);
        const summary = consumeTruncations();
        expect(summary.truncated).toBe(true);
        expect(summary.truncatedCalls).toBe(2);
        // undefined was not observed at all — the tally counts signals, not calls.
        expect(summary.callsObserved).toBe(3);
    });

    it('freezes the tally once the verdict has closed the window', () => {
        // Every provider response reports its stop signal through this
        // recorder, so an open window also collects a bot DM, a cron
        // automation and a consolidation pass that happen to run alongside the
        // debate — and the finalizer then blames the verdict's token budget.
        beginTruncationWindow();
        recordFinishReason('length');
        consumeTruncations();
        recordFinishReason('length');
        recordFinishReason('length');
        expect(peekTruncations()).toEqual({ truncated: true, truncatedCalls: 1, callsObserved: 1 });
    });

    it('keeps the closed figure readable by a finalizer that runs afterwards', () => {
        beginTruncationWindow();
        recordFinishReason('stop');
        recordFinishReason('length');
        consumeTruncations();
        expect(peekTruncations().truncated).toBe(true);
        // A fresh debate must not inherit the previous verdict's ceiling hit.
        beginTruncationWindow();
        expect(peekTruncations()).toEqual({ truncated: false, truncatedCalls: 0, callsObserved: 0 });
    });

    it('resets on consume so the next run starts clean', () => {
        beginTruncationWindow();
        recordFinishReason('length');
        expect(consumeTruncations().truncated).toBe(true);
        expect(consumeTruncations().truncated).toBe(false);
    });

    it('peek does not reset, so a verdict retry still sees the first attempt', () => {
        beginTruncationWindow();
        recordFinishReason('length');
        expect(peekTruncations().truncated).toBe(true);
        expect(peekTruncations().truncated).toBe(true);
        expect(consumeTruncations().truncated).toBe(true);
    });

    it('a whole clean run reports not-truncated', () => {
        beginTruncationWindow();
        for (let i = 0; i < 20; i++) recordFinishReason('stop');
        expect(consumeTruncations()).toEqual({ truncated: false, truncatedCalls: 0, callsObserved: 20 });
    });
});
