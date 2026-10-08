import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ToolActivityRow, { pairToolLines, foldConsecutiveToolRows } from '../components/shared/ToolActivityRow';

vi.mock('lucide-react', () => ({
    Wrench: () => <span data-testid="wrench-icon" />,
}));

describe('pairToolLines (call→result updates ONE row)', () => {
    it('merges a calling line with its result instead of stacking two rows', () => {
        const rows = pairToolLines(['calling chart view…', 'chart view · ok']);
        expect(rows).toEqual([{ label: 'chart view', detail: 'ok', state: 'done' }]);
    });

    it('pairs parallel same-tool calls FIFO (3× chart draw → 3 done rows)', () => {
        const rows = pairToolLines([
            'calling chart draw…', 'calling chart draw…', 'calling chart draw…',
            'chart draw · ok', 'chart draw · ok', 'chart draw · ok',
        ]);
        expect(rows).toHaveLength(3);
        expect(rows.every(r => r.label === 'chart draw' && r.state === 'done')).toBe(true);
    });

    it('keeps unmatched calls as still-calling (interrupted streams)', () => {
        const rows = pairToolLines(['calling scan setups…']);
        expect(rows).toEqual([{ label: 'scan setups', detail: '', state: 'calling' }]);
    });

    it('renders an orphan result standalone (old persisted grammars)', () => {
        expect(pairToolLines(['chart view · ok'])).toEqual([{ label: 'chart view', detail: 'ok', state: 'done' }]);
    });

    it('marks failures and keeps a foreign-coin detail', () => {
        const rows = pairToolLines(['calling order book…', 'order book · ETHUSDT · failed']);
        expect(rows).toEqual([{ label: 'order book', detail: 'ETHUSDT', state: 'failed' }]);
    });

    it('strips markdown markers from labels and details', () => {
        const rows = pairToolLines(['calling scan setups…', 'scan setups · **3 setups found**']);
        expect(rows).toEqual([{ label: 'scan setups', detail: '3 setups found', state: 'done' }]);
    });
});

describe('foldConsecutiveToolRows (the aggregate line)', () => {
    it('folds a run of the same tool into one line with a count', () => {
        const groups = foldConsecutiveToolRows([
            'calling order book…', 'order book · ok',
            'calling order book…', 'order book · ok',
            'calling order book…', 'order book · ok',
            'calling order book…', 'order book · ok',
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe('order book');
        expect(groups[0].count).toBe(4);
        expect(groups[0].states).toEqual(['done', 'done', 'done', 'done']);
    });

    it('does NOT fold across an intervening tool — order of work is the information', () => {
        const groups = foldConsecutiveToolRows([
            'calling chart draw…', 'chart draw · ok',
            'calling order book…', 'order book · ok',
            'calling chart draw…', 'chart draw · ok',
        ]);
        expect(groups).toHaveLength(3);
        expect(groups.map(g => g.label)).toEqual(['chart draw', 'order book', 'chart draw']);
        expect(groups.every(g => g.count === 1)).toBe(true);
    });

    it('leaves an unfolded row at count 1, so the ordinary path is unchanged', () => {
        const groups = foldConsecutiveToolRows(['calling watch price…', 'watch price · ok']);
        expect(groups).toHaveLength(1);
        expect(groups[0].count).toBe(1);
    });

    it('keeps every member detail and state in call order', () => {
        const groups = foldConsecutiveToolRows([
            'calling chart draw…', 'chart draw · first',
            'calling chart draw…', 'chart draw · ETHUSDT · failed',
        ]);
        expect(groups[0].details).toEqual(['first', 'ETHUSDT']);
        expect(groups[0].states).toEqual(['done', 'failed']);
    });

    it('maps each member to the payload id of ITS result line', () => {
        // The id is stamped on the RESULT line, while pairing merges that result
        // into the row the calling line opened. Without the source indices a
        // positional lookup lands on the calling line — which never has an id —
        // and the expander silently never appears. This is the Stage 2 defect
        // the index bookkeeping exists to fix.
        const lines = [
            'calling order book…', 'order book · ok',
            'calling order book…', 'order book · ok',
        ];
        const groups = foldConsecutiveToolRows(lines, ['', 'id-a', '', 'id-b']);
        expect(groups).toHaveLength(1);
        // ONE id per member, so payloadIds[i] always answers for details[i] —
        // a group with two members never carries four ids.
        expect(groups[0].payloadIds).toEqual(['id-a', 'id-b']);
    });

    it('tolerates a missing id list rather than inventing payloads', () => {
        const groups = foldConsecutiveToolRows(['calling order book…', 'order book · ok']);
        expect(groups[0].count).toBe(1);
        expect(groups[0].payloadIds).toEqual(['']);
    });
});

describe('ToolActivityRow (paired inline rows)', () => {
    it('renders the user-reported sequence, folding the consecutive chart draws', () => {
        render(<ToolActivityRow lines={[
            'calling all-timeframe compendium…',
            'all-timeframe compendium · ok',
            'calling chart draw…',
            'calling chart draw…',
            'calling chart draw…',
            'chart draw · ok',
            'chart draw · ok',
            'chart draw · ok',
            'calling watch price…',
            'watch price · ok',
        ]} />);
        // Stage 3: three CONSECUTIVE chart-draw calls fold into one line, so the
        // five distinct activities render as THREE rows. The fold is what the
        // reference draws, and the count on the row is the disclosure.
        expect(document.querySelectorAll('[data-testid="tool-activity"] > div')).toHaveLength(3);
        // Every call completed — no lingering "calling…" rows.
        expect(screen.queryByText('· calling…')).toBeNull();
        expect(screen.getByText('all-timeframe compendium')).toBeDefined();
        expect(screen.getByText('chart draw')).toBeDefined();
        // The folded row names how many calls it stands for.
        expect(screen.getByText('×3')).toBeDefined();
        expect(screen.getByText('watch price')).toBeDefined();
    });

    it('splits old joined calling lines into per-call rows', () => {
        render(<ToolActivityRow lines={['calling a… · calling b…', 'a · ok', 'b · ok']} />);
        const rows = document.querySelectorAll('[data-testid="tool-activity"] > div');
        expect(rows).toHaveLength(2);
        expect(screen.queryByText('· calling…')).toBeNull();
    });

    it('does NOT fold a same-label run that is interrupted by another tool', () => {
        // THE SAFETY PROPERTY. Consecutive-only means the fold never reorders
        // what the seat actually did: chart-draw, order-book, chart-draw is three
        // rows, because the order of the work is the information.
        render(<ToolActivityRow lines={[
            'calling chart draw…', 'chart draw · ok',
            'calling order book…', 'order book · ok',
            'calling chart draw…', 'chart draw · ok',
        ]} />);
        expect(document.querySelectorAll('[data-testid="tool-activity"] > div')).toHaveLength(3);
        expect(screen.queryByText('×2')).toBeNull();
        expect(screen.getAllByText('chart draw')).toHaveLength(2);
    });

    it('shows the calling state for a live in-flight call', () => {
        render(<ToolActivityRow lines={['calling order book…']} running />);
        expect(screen.getByText('· calling…')).toBeDefined();
        expect(document.querySelector('[data-testid="tool-activity"]')?.getAttribute('data-state')).toBe('running');
    });

    it('renders nothing without lines', () => {
        const { container } = render(<ToolActivityRow lines={[]} />);
        expect(container.querySelector('[data-testid="tool-activity"]')).toBeNull();
    });
});
