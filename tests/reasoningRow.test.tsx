import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReasoningRow from '../components/shared/ReasoningRow';

vi.mock('../components/shared/MarkdownContent', () => ({
    default: ({ content }: { content?: string }) => <div data-testid="md">{content}</div>,
}));
vi.mock('../components/shared/Icons', () => ({
    ChevronDownIcon: ({ className }: { className?: string }) => <span data-testid="chevron" className={className} />,
}));

describe('ReasoningRow (ROUND-39: collapsed by default)', () => {
    it('renders nothing for empty thinking', () => {
        const { container } = render(<ReasoningRow thinking="   " />);
        expect(container.querySelector('.reasoning-row')).toBeNull();
    });

    it('is a native disclosure that keeps the trace in the DOM when collapsed', () => {
        render(<ReasoningRow thinking="Weighed the sweep." />);
        const details = screen.getAllByText('Weighed the sweep.')[0].closest('details');
        expect(details).toBeDefined();
        expect(details?.open).toBe(false);
        expect(details?.getAttribute('data-state')).toBe('ok');
    });

    it('previews the first line with a Show full reasoning affordance when settled', () => {
        render(<ReasoningRow thinking={'First thought.\nSecond thought.'} />);
        expect(screen.getByText('First thought.')).toBeDefined();
        expect(screen.getByText('Show full reasoning')).toBeDefined();
        expect(screen.getByTestId('md').textContent).toContain('Second thought.');
    });

    it('expands when the Thinking label is clicked', () => {
        render(<ReasoningRow thinking="Weighed the sweep." />);
        fireEvent.click(screen.getByText('Thinking'));
        expect(screen.getAllByText('Weighed the sweep.')[0].closest('details')?.open).toBe(true);
    });

    it('shows a running state with a live ticker of the latest line — WITHOUT auto-expanding', () => {
        const { rerender } = render(<ReasoningRow thinking={'step one\nstep two\nstep three'} />);
        rerender(<ReasoningRow thinking={'step one\nstep two\nstep three'} running />);
        expect(document.querySelector('.reasoning-row')?.getAttribute('data-state')).toBe('running');
        // The collapsed ticker surfaces the most recent line only…
        expect(screen.getByText('step three')).toBeDefined();
        // …the full trace stays in the body, and the row stays CLOSED.
        expect(screen.queryByText('step one')).toBeDefined();
        expect(document.querySelector('.reasoning-row')?.classList.contains('is-open')).toBe(false);
    });

    it('ticks a live seconds counter while streaming', async () => {
        const { container } = render(<ReasoningRow thinking="hard problem" running />);
        // The collapsed row shows a live duration ("0s", "1s", …) while streaming.
        await waitFor(() => {
            expect(container.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
        });
    });

    it('auto-collapses when the stream settles and reports Thought-for duration', async () => {
        const utils = render(<ReasoningRow thinking="thinking hard" running />);
        await waitFor(() => {
            expect(document.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
        });
        utils.rerender(<ReasoningRow thinking="thinking hard" />);
        const row = document.querySelector('.reasoning-row');
        expect(row?.classList.contains('is-open')).toBe(false);
        expect(row?.textContent).toMatch(/\d+\.\ds/);
    });

    it('ignores defaultOpen — rows always start collapsed', () => {
        render(<ReasoningRow thinking="open trace" defaultOpen />);
        expect(document.querySelector('.reasoning-row')?.classList.contains('is-open')).toBe(false);
    });

    it('truncates long expanded traces with Show more / Show less', () => {
        // Fixture must exceed EXPAND_PREVIEW_CHARS (600).
        const long = Array.from({ length: 80 }, (_, i) => `reasoning line number ${i + 1} with some padding text`).join('\n');
        expect(long.length).toBeGreaterThan(600);
        render(<ReasoningRow thinking={long} />);
        // Collapsed first…
        fireEvent.click(screen.getByText('Thinking'));
        // Expanded but truncated past the preview limit.
        expect(screen.queryByText(/line number 80/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
        expect(screen.getByText(/line number 80/)).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
        expect(screen.queryByText(/line number 80/)).toBeNull();
    });
});
