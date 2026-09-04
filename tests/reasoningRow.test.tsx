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

describe('ReasoningRow (Hermes reference style)', () => {
    it('renders nothing for empty thinking', () => {
        const { container } = render(<ReasoningRow thinking="   " />);
        expect(container.querySelector('.reasoning-row')).toBeNull();
    });

    it('settled + collapsed is a bare Thought row — no duration, no preview, no affordance', () => {
        render(<ReasoningRow thinking={'First thought.\nSecond thought.'} />);
        const details = screen.getByText('Thought').closest('details');
        expect(details).toBeDefined();
        expect(details?.open).toBe(false);
        expect(details?.getAttribute('data-state')).toBe('ok');
        // No duration meta, no first-line preview, no "Show full reasoning".
        expect(document.querySelector('.reasoning-row-meta')).toBeNull();
        expect(screen.queryByText('First thought.')).toBeNull();
        expect(screen.queryByText('Show full reasoning')).toBeNull();
    });

    it('expands when clicked and shows the full trace (Thought ↔ Thinking states)', () => {
        render(<ReasoningRow thinking={'First thought.\nSecond thought.'} />);
        fireEvent.click(screen.getByText('Thought'));
        const details = screen.getByText('Thought').closest('details');
        expect(details?.open).toBe(true);
        // Full trace is in the body once expanded.
        expect(screen.getByTestId('md').textContent).toContain('Second thought.');
    });

    it('shows a running state labeled Thinking with a live ticker — WITHOUT auto-expanding', () => {
        const { rerender } = render(<ReasoningRow thinking={'step one\nstep two\nstep three'} />);
        rerender(<ReasoningRow thinking={'step one\nstep two\nstep three'} running />);
        expect(document.querySelector('.reasoning-row')?.getAttribute('data-state')).toBe('running');
        // Live label + the collapsed ticker surfaces the most recent line only…
        expect(screen.getByText('Thinking')).toBeDefined();
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

    it('auto-collapses when the stream settles back to a bare Thought row', async () => {
        const utils = render(<ReasoningRow thinking="thinking hard" running />);
        await waitFor(() => {
            expect(document.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
        });
        utils.rerender(<ReasoningRow thinking="thinking hard" />);
        const row = document.querySelector('.reasoning-row');
        expect(row?.classList.contains('is-open')).toBe(false);
        // Settled: label flips to Thought and the duration disappears.
        expect(screen.getByText('Thought')).toBeDefined();
        expect(document.querySelector('.reasoning-row-meta')).toBeNull();
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
        fireEvent.click(screen.getByText('Thought'));
        // Expanded but truncated past the preview limit.
        expect(screen.queryByText(/line number 80/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
        expect(screen.getByText(/line number 80/)).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
        expect(screen.queryByText(/line number 80/)).toBeNull();
    });
});
