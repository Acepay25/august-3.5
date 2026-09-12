import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ToolActivityRow, { pairToolLines } from '../components/shared/ToolActivityRow';

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

describe('ToolActivityRow (paired inline rows)', () => {
    it('renders the user-reported sequence as FIVE rows, none stuck calling', () => {
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
        expect(document.querySelectorAll('[data-testid="tool-activity"] > div')).toHaveLength(5);
        // Every call completed — no lingering "calling…" rows.
        expect(screen.queryByText('· calling…')).toBeNull();
        expect(screen.getByText('all-timeframe compendium')).toBeDefined();
        expect(screen.getAllByText('chart draw')).toHaveLength(3);
        expect(screen.getByText('watch price')).toBeDefined();
    });

    it('splits old joined calling lines into per-call rows', () => {
        render(<ToolActivityRow lines={['calling a… · calling b…', 'a · ok', 'b · ok']} />);
        const rows = document.querySelectorAll('[data-testid="tool-activity"] > div');
        expect(rows).toHaveLength(2);
        expect(screen.queryByText('· calling…')).toBeNull();
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
