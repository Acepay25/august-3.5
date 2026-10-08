/**
 * MemoryHealthCard has to be able to say "I could not find out".
 *
 * It is the one surface whose entire job is reporting whether the trader's
 * learning is reaching disk, so a card that cannot report is worse than no card
 * at all. Two ways it used to fail silently, both pinned here:
 *
 *   - A read that THREW rendered the identical "Reading memory…" spinner as a
 *     read still in flight — `catch { setReport(null) }` made "failed" and
 *     "loading" one state — so it spun forever with no way to retry.
 *   - A hygiene pass that failed had `try/finally` and no `catch`: it rejected
 *     out of the click handler, the button went dead, and the previous report
 *     stayed on screen implying the pass had just run.
 *
 * The fixture builds a COMPLETE `MemoryHealthReport` rather than a partial
 * cast, so a field the card starts reading cannot silently be missing here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

import type { MemoryHealthReport } from '../services/learning/memoryHealth';

let reportError: Error | null = null;
let hygieneError: Error | null = null;
let reportReads = 0;
let hygieneRuns = 0;

const healthyReport = (): MemoryHealthReport => ({
    generatedAt: 1,
    folders: [{ name: 'lessons', files: 2, enabled: 2, chars: 900 }],
    skills: {
        total: 3, candidate: 1, confirmed: 1, retired: 1,
        unproven: 0, bookSeeds: 1, hurtsVerdict: 0, staleEvidence: 0, fromBots: 0,
    },
    notebook: {
        files: 2, enabled: 2, chars: 900, bytes: 1800,
        pressure: 'ok', writeFailure: null, suspended: 0, promptTokensWorstCase: 400,
    },
    unobserved: [],
    staleFiles: [],
    injectionLogWindowRuns: 20,
    beliefs: { settled: 0, invalidated: 0, challenged: 0 },
    queues: {
        drafts: 0, proposals: 0, amendments: 1, forgedTools: 0,
        supervisorPending: 0, graveyard: 1, needsRewrite: 0,
    },
    diary: { files: 1, entries: 4 },
    bots: [],
    gateThrottled: [],
    hygiene: [{ atMs: 1, text: 'Last pass: nothing to do.' }],
    flags: [],
});

vi.mock('../services/learning/memoryHealth', () => ({
    buildMemoryHealthReport: vi.fn(async () => {
        reportReads += 1;
        if (reportError) throw reportError;
        return healthyReport();
    }),
}));

vi.mock('../services/learning/memoryHygiene', () => ({
    isHygieneDue: vi.fn(async () => true),
    runMemoryHygiene: vi.fn(async () => {
        hygieneRuns += 1;
        if (hygieneError) throw hygieneError;
        return { atMs: 2, demotionsQueued: 0, proposalsQueued: 0 };
    }),
}));

vi.mock('../services/infrastructure/ProviderConfigService', () => ({
    loadProviderConfigs: vi.fn(async () => []),
}));

vi.mock('../services/learning/skillGraveyard', () => ({
    listTombstones: vi.fn(async () => []),
}));

import MemoryHealthCard from '../components/learn/MemoryHealthCard';

const USER = 'health-card-user';

beforeEach(() => {
    reportError = null;
    hygieneError = null;
    reportReads = 0;
    hygieneRuns = 0;
});

afterEach(() => { cleanup(); });

describe('when the report cannot be read', () => {
    it('says so and offers a retry, instead of spinning forever', async () => {
        reportError = new Error('notebook store unreachable');
        render(<MemoryHealthCard username={USER} />);

        const panel = await screen.findByTestId('memory-health-error');
        expect(panel).toBeTruthy();
        expect(panel.textContent).toMatch(/notebook store unreachable/);
        // The infinite spinner is the actual bug: "failed" rendered as
        // "loading", so the card looked like it was still working.
        expect(screen.queryByText(/Reading memory…/)).toBeNull();
        expect(screen.queryByTestId('memory-health-card')).toBeNull();
    });

    it('recovers on retry once the read succeeds', async () => {
        reportError = new Error('transient');
        render(<MemoryHealthCard username={USER} />);

        const retry = await screen.findByTestId('memory-health-retry');
        const readsBefore = reportReads;
        reportError = null;
        fireEvent.click(retry);

        await waitFor(() => expect(screen.getByTestId('memory-health-card')).toBeTruthy());
        expect(reportReads).toBe(readsBefore + 1);
        expect(screen.queryByTestId('memory-health-error')).toBeNull();
    });
});

describe('when the hygiene pass fails', () => {
    it('reports the failure and keeps the report it already had', async () => {
        render(<MemoryHealthCard username={USER} />);
        await screen.findByTestId('memory-health-card');

        hygieneError = new Error('provider unreachable');
        fireEvent.click(screen.getByRole('button', { name: /Run now/i }));

        const err = await screen.findByTestId('memory-hygiene-error');
        expect(err.textContent).toMatch(/provider unreachable/);
        expect(err.textContent).toMatch(/previous run/);
        // One failed sweep is not a reason to throw away the whole card.
        expect(screen.getByTestId('memory-health-card')).toBeTruthy();
        expect(hygieneRuns).toBe(1);
    });

    it('leaves no error behind when the pass succeeds', async () => {
        render(<MemoryHealthCard username={USER} />);
        await screen.findByTestId('memory-health-card');

        fireEvent.click(screen.getByRole('button', { name: /Run now/i }));

        await waitFor(() => expect(hygieneRuns).toBe(1));
        expect(screen.queryByTestId('memory-hygiene-error')).toBeNull();
    });

    it('re-enables the button after a failure, so a retry is possible', async () => {
        render(<MemoryHealthCard username={USER} />);
        await screen.findByTestId('memory-health-card');

        hygieneError = new Error('provider unreachable');
        const button = screen.getByRole('button', { name: /Run now/i });
        fireEvent.click(button);
        await screen.findByTestId('memory-hygiene-error');

        // The `finally` that used to be the whole handler still clears `running`
        // — but with no catch the promise rejected, and a dead button is the
        // part a user can actually notice.
        await waitFor(() => expect(screen.getByRole('button', { name: /Run now/i })).not.toBeDisabled());
    });
});
