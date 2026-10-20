/**
 * Status vocabulary and step-level failure reasons.
 *
 * The step type had no error field, so a failed pipeline step could only be
 * drawn as a red ✕ with no reason — and a user-initiated Stop was coloured
 * identically to a provider failure. These assert the two invariants that
 * fix it, plus that raw provider text can never reach the UI.
 */

import { describe, it, expect } from 'vitest';
import type { AnalysisStepStatus } from '../types';
import {
    RUN_STATUS_PRESENTATION,
    classifyStepError,
    describeStepError,
    runStatusPresentation,
    sanitizeErrorText,
    stepErrorLabel,
} from '../utils/runStatus';

const STATUSES: AnalysisStepStatus[] = ['pending', 'running', 'complete', 'stopped', 'error'];

describe('status vocabulary', () => {
    it('gives every status a word, so state is never carried by colour alone', () => {
        for (const status of STATUSES) {
            const p = runStatusPresentation(status);
            expect(p.label.trim().length).toBeGreaterThan(0);
            expect(p.srLabel.trim().length).toBeGreaterThan(0);
            expect(p.dot).toMatch(/^bg-/);
            expect(p.text).toMatch(/^text-/);
        }
    });

    it('draws a user Stop as neutral, not as a failure', () => {
        // The distinction the old UI could not make.
        expect(RUN_STATUS_PRESENTATION.stopped.text).not.toContain('rose');
        expect(RUN_STATUS_PRESENTATION.stopped.dot).not.toContain('rose');
        expect(RUN_STATUS_PRESENTATION.error.text).toContain('rose');
    });

    it('falls back to a real presentation for an unrecognized status', () => {
        expect(runStatusPresentation('nonsense' as AnalysisStepStatus).label).toBe('Queued');
    });
});

describe('classifyStepError', () => {
    it('labels a 429 as a rate limit', () => {
        const err = Object.assign(new Error('Too Many Requests'), { status: 429 });
        expect(classifyStepError(err).kind).toBe('provider_rate_limit');
    });

    it('labels 401 and 403 as a rejected key', () => {
        expect(classifyStepError(Object.assign(new Error('nope'), { status: 401 })).kind).toBe('provider_auth');
        expect(classifyStepError(Object.assign(new Error('nope'), { status: 403 })).kind).toBe('provider_auth');
    });

    it('separates a server error from a client error from no error at all', () => {
        expect(classifyStepError(Object.assign(new Error('boom'), { status: 503 })).kind).toBe('provider_error');
        expect(classifyStepError(new Error('something odd with no status')).kind).toBe('unknown');
        expect(classifyStepError(undefined).kind).toBe('unknown');
    });

    it('treats an abort as a cancel, not a failure', () => {
        const abort = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
        expect(classifyStepError(abort).kind).toBe('cancelled');
    });

    it('calls a stalled provider a stall, not the trader pressing Stop', () => {
        // Only AbortSignal.timeout yields this name; a UI Stop raises
        // AbortError. Folding them told the user they cancelled their own run.
        const stalled = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
        const kind = classifyStepError(stalled);
        expect(kind.kind).toBe('provider_timeout');
        expect(kind.text).toMatch(/did not answer within the request window/);
        expect(kind.text).not.toMatch(/You stopped/);
    });

    it('classifies on NUMERIC status, never by matching provider wording', () => {
        // Provider message text varies by gateway; a 429 whose body says
        // something whimsical must still classify as a rate limit.
        const err = Object.assign(new Error('We said no.'), { status: 429 });
        expect(classifyStepError(err).kind).toBe('provider_rate_limit');
    });
});

describe('sanitizeErrorText', () => {
    it('removes a credential carried inside a URL', () => {
        const raw = 'failed calling https://api.example.com/v1/chat?token=sk-abcDEF1234567890ABCDEF1234567890 upstream 500';
        const out = sanitizeErrorText(new Error(raw));
        expect(out).not.toContain('https://');
        expect(out).toContain('[url]');
        expect(out).not.toContain('sk-abcDEF1234567890ABCDEF1234567890');
    });

    it('masks a standalone key-shaped token', () => {
        const out = sanitizeErrorText('bad key sk-abcDEF1234567890ABCDEF1234567890 rejected');
        expect(out).toContain('***');
        expect(out).not.toContain('sk-abcDEF1234567890ABCDEF1234567890');
    });

    it('caps length so a dumped request body cannot fill the panel', () => {
        const out = sanitizeErrorText('x'.repeat(5000), 300);
        expect(out.length).toBeLessThanOrEqual(300);
    });

    it('returns empty for non-errors rather than throwing', () => {
        expect(sanitizeErrorText(null)).toBe('');
        expect(sanitizeErrorText(42)).toBe('');
    });
});

describe('describeStepError', () => {
    it('always produces a non-empty reason, even with no detail', () => {
        expect(describeStepError('unknown').length).toBeGreaterThan(0);
        expect(describeStepError(undefined).length).toBeGreaterThan(0);
    });

    it('appends provider detail when there is any', () => {
        expect(describeStepError('provider_auth', 'invalid x-api-key')).toContain('invalid x-api-key');
    });
});

describe('stepErrorLabel', () => {
    it('has a word for every kind in the closed set', () => {
        for (const kind of ['provider_rate_limit', 'provider_timeout', 'provider_auth', 'provider_error',
            'data_unavailable', 'parse_failed', 'cancelled', 'unknown'] as const) {
            expect(stepErrorLabel(kind)).toBeTruthy();
        }
        expect(stepErrorLabel(undefined)).toBe('Failed');
    });
});
