/**
 * The one "what the AI remembered" row (WS-5.2).
 *
 * The behaviour that matters is the window: an answer's sources are the
 * injections that landed BETWEEN its entry's stamp and the next entry's. Get
 * the upper bound wrong and every later run leaks its skills onto an older
 * answer — which is precisely why the previous chips component could never be
 * mounted and the row is only trustworthy now that entries carry a timestamp.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const recs: MemoryInjectionRecord[] = [];
vi.mock('../services/learning/MemoryInjectionService', () => ({
    getRecentMemoryInjections: vi.fn(async () => recs),
}));
const recordLesson = vi.fn();
vi.mock('../services/learning/harnessLessons', () => ({
    recordHarnessLesson: (...args: unknown[]) => recordLesson(...args),
}));

import MemoryProvenanceStrip, { groupInjections } from '../components/chat/MemoryProvenanceStrip';
import type { MemoryInjectionRecord } from '../services/learning/MemoryInjectionService';

const rec = (ts: number, path: string, kind: string, extra: Partial<MemoryInjectionRecord> = {}): MemoryInjectionRecord => ({
    ts: new Date(ts).toISOString(), stage: 'verdict', audience: 'analyst',
    sources: [{ path, kind }], ...extra,
});

const T0 = 1_700_000_000_000;

beforeEach(() => { recs.length = 0; recordLesson.mockClear(); });

describe('groupInjections', () => {
    it('splits skills from the rest, dedupes by path, and reports a holdout', () => {
        const g = groupInjections([
            rec(T0, 'skills/btc-sweep.md', 'skill'),
            rec(T0 + 1, 'skills/btc-sweep.md', 'skill'),
            rec(T0 + 2, 'profile/doctrine', 'identity'),
            rec(T0 + 3, 'rules/risk-rules', 'rules'),
            { ...rec(T0 + 4, 'skills/eth.md', 'skill'), holdout: true },
        ]);
        expect(g.skills).toEqual(['btc-sweep', 'eth']);
        expect(g.others.map(o => o.path)).toEqual(['profile/doctrine', 'rules/risk-rules']);
        expect(g.heldOut).toBe(true);
    });
});

describe('MemoryProvenanceStrip', () => {
    const mount = (props: { startedAt?: number; nextAt?: number } = {}): void => {
        render(<MemoryProvenanceStrip startedAt={props.startedAt} nextAt={props.nextAt} messageId="a1" />);
    };

    it('renders nothing when the answer remembered nothing', async () => {
        recs.push(rec(T0 + 5000, 'skills/btc-sweep.md', 'skill'));
        // The injection is AFTER the answer's window entirely.
        mount({ startedAt: T0, nextAt: T0 + 1000 });
        // Mount the positive case alongside so "absent" is proven against a
        // loader that demonstrably resolves, not against a pending promise.
        render(<MemoryProvenanceStrip startedAt={T0} nextAt={T0 + 9000} messageId="a2" />);
        await waitFor(() => expect(screen.getByTestId('memory-provenance-strip')).toBeTruthy());
        expect(screen.queryAllByTestId('memory-provenance-strip')).toHaveLength(1);
    });

    it('summarises the sources in one row', async () => {
        recs.push(
            rec(T0 + 100, 'skills/btc-sweep.md', 'skill'),
            rec(T0 + 200, 'skills/eth-fade.md', 'skill'),
            rec(T0 + 300, 'profile/doctrine', 'identity'),
        );
        mount({ startedAt: T0, nextAt: T0 + 5000 });
        await waitFor(() => expect(screen.getByTestId('memory-provenance-strip')).toBeTruthy());
        expect(screen.getByTestId('memory-provenance-strip').textContent).toMatch(/2 skills/);
        expect(screen.getByTestId('memory-provenance-strip').textContent).toMatch(/who you are/);
    });

    it('excludes a LATER run’s skills — the upper bound is the next entry', async () => {
        recs.push(
            rec(T0 + 100, 'skills/in-window.md', 'skill'),
            rec(T0 + 9000, 'skills/next-run-leak.md', 'skill'),
        );
        mount({ startedAt: T0, nextAt: T0 + 5000 });
        await waitFor(() => expect(screen.getByTestId('memory-provenance-strip')).toBeTruthy());
        fireEvent.click(screen.getByTestId('memory-provenance-strip').querySelector('button') as Element);
        const text = screen.getByTestId('memory-provenance-strip').textContent ?? '';
        expect(text).toContain('in-window');
        expect(text).not.toContain('next-run-leak');
    });

    it('flags a skill as wrong-here against the lesson store', async () => {
        recs.push(rec(T0 + 100, 'skills/bad-rule.md', 'skill'));
        mount({ startedAt: T0, nextAt: T0 + 5000 });
        await waitFor(() => expect(screen.getByTestId('memory-provenance-strip')).toBeTruthy());
        fireEvent.click(screen.getByTestId('memory-provenance-strip').querySelector('button') as Element);
        fireEvent.click(screen.getByLabelText('Flag bad-rule as wrong in this answer'));
        expect(recordLesson).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'injection',
            pattern: 'skill:bad-rule',
            evidenceId: 'message:a1',
        }));
    });

    it('says so when the run was held out of skills', async () => {
        recs.push(rec(T0 + 100, 'profile/doctrine', 'identity', { holdout: true }));
        mount({ startedAt: T0, nextAt: T0 + 5000 });
        await waitFor(() => expect(screen.getByTestId('memory-provenance-strip')).toBeTruthy());
        expect(screen.getByText('held out')).toBeTruthy();
    });
});
