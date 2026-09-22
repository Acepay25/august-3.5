import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AnalysisProgress from '../components/analysis/AnalysisProgress';
import type { AnalysisStep } from '../types/progress';

/**
 * A STOPPED step also carries an `errorText` — the pipeline writes what it had
 * reached at `useAnalysisPipeline.ts:594` — but two gates swallowed it: the
 * summary line said only "You ended this run", and the per-step reason checked
 * `status === 'error'`. So the one person who definitely wants to know what the
 * run had already got was shown a word and nothing else.
 *
 * The summary is the important half: a stopped run's step ladder is collapsed by
 * design, so the header line is the only thing there without a click.
 */

const step = (over: Partial<AnalysisStep>): AnalysisStep => ({
    id: 's1',
    title: 'Ensemble debate',
    status: 'stopped',
    startTime: 1_000,
    endTime: 2_000,
    ...over,
} as AnalysisStep);

const renderSteps = (steps: AnalysisStep[]) =>
    render(<AnalysisProgress steps={steps} isActive={false} onCancel={vi.fn()} />);

describe('a stopped run says what it had reached', () => {
    it('shows the stopped step’s reason on the summary line, unopened', () => {
        renderSteps([step({ errorText: 'Stopped after 2 of 5 seats finished.' })]);

        expect(screen.getAllByText(/Stopped after 2 of 5 seats finished/)
            .length).toBeGreaterThan(0);
    });

    it('falls back to the plain wording when there is nothing to report', () => {
        renderSteps([step({})]);
        expect(screen.getByText('You ended this run')).toBeTruthy();
        expect(screen.queryByRole('status')).toBeNull();
    });

    /** Opened, the reason belongs to the step that carries it — and in the
     *  stop's colour. A cancel is not a loss, which is what `runStatus` exists
     *  to encode; the old code hardcoded rose next to it. */
    it('renders the reason inside the ladder, in the stop colour', () => {
        renderSteps([step({ errorText: 'Stopped after 2 of 5 seats finished.' })]);
        fireEvent.click(screen.getByRole('button'));

        const note = screen.getByRole('status');
        expect(note.textContent).toContain('Stopped after 2 of 5 seats finished.');
        expect(note.className).toContain('text-zinc-400');
        expect(note.className).not.toContain('text-rose-300');
    });

    it('still shows a failure reason in the failure colour', () => {
        renderSteps([step({ status: 'error', errorText: 'Every provider timed out.' })]);
        // A failure opens itself — that behaviour is the point of the branch.
        const note = screen.getByRole('status');
        expect(note.textContent).toContain('Every provider timed out.');
        expect(note.className).toContain('text-rose-300');
    });

    it('does not surface a stale reason on a step that completed', () => {
        renderSteps([step({ status: 'complete', errorText: 'Left over from an earlier attempt.' })]);
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByText(/Left over from an earlier attempt/)).toBeNull();
    });
});
