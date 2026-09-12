import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReasoningRow from '../components/shared/ReasoningRow';

vi.mock('../components/shared/Icons', () => ({
    ChevronDownIcon: ({ className }: { className?: string }) => <span data-testid="chevron" className={className} />,
}));

describe('ReasoningRow (Hermes reference style)', () => {
    it('renders nothing for empty thinking', () => {
        const { container } = render(<ReasoningRow thinking="   " />);
        expect(container.querySelector('.reasoning-row')).toBeNull();
    });

    it('starts collapsed with the Thought label and no duration meta', () => {
        render(<ReasoningRow thinking={'First thought.\nSecond thought.'} />);
        const details = screen.getByText('Thought').closest('details');
        expect(details).toBeDefined();
        expect(details?.open).toBe(false);
        expect(details?.getAttribute('data-state')).toBe('ok');
        // No duration meta on a settled row.
        expect(document.querySelector('.reasoning-row-meta')).toBeNull();
    });

    it('expands when clicked and shows the trace as clean bulleted lines', () => {
        render(<ReasoningRow thinking={'First thought.\nSecond thought.'} />);
        fireEvent.click(screen.getByText('Thought'));
        const details = screen.getByText('Thought').closest('details');
        expect(details?.open).toBe(true);
        // The full trace renders as marker-stripped bullet lines.
        expect(screen.getByText('Second thought.')).toBeTruthy();
    });

    it('shows a running state labeled with a rotating Tip — WITHOUT auto-expanding', () => {
        const { rerender } = render(<ReasoningRow thinking={'step one\nstep two\nstep three'} />);
        rerender(<ReasoningRow thinking={'step one\nstep two\nstep three'} running />);
        expect(document.querySelector('.reasoning-row')?.getAttribute('data-state')).toBe('running');
        // Live label is a trading TIP ("Tip: …") instead of the bare word,
        // plus the collapsed ticker surfaces the most recent line only…
        expect(document.querySelector('.reasoning-row-label')?.textContent).toMatch(/^Tip: /);
        expect(screen.getByText('step three')).toBeTruthy();
        // …the full trace stays in the body, and the row stays CLOSED.
        expect(document.querySelector('.reasoning-row')?.classList.contains('is-open')).toBe(false);
    });

    it('ticks a live seconds counter while streaming', async () => {
        const { container } = render(<ReasoningRow thinking="hard problem" running />);
        // The collapsed row shows a live duration ("0s", "1s", …) while streaming.
        await waitFor(() => {
            expect(container.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
        });
    });

    it('settle AUTO-OPENS the row into its read state (Thought, bullets visible)', async () => {
        const utils = render(<ReasoningRow thinking="thinking hard" running />);
        await waitFor(() => {
            expect(document.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
        });
        utils.rerender(<ReasoningRow thinking="thinking hard" />);
        const row = document.querySelector('.reasoning-row');
        // Settle OPENS the row — the trader shouldn't have to click to read it.
        expect(row?.classList.contains('is-open')).toBe(true);
        expect(screen.getByText('Thought')).toBeTruthy();
        expect(screen.getByText('thinking hard')).toBeTruthy();
    });

    it('a manual toggle during the run wins over the settle auto-open', () => {
        const { rerender } = render(<ReasoningRow thinking={'line one\nline two'} running />);
        fireEvent.click(screen.getByText(/^Tip: /).closest('summary') as Element); // user chose collapsed
        rerender(<ReasoningRow thinking={'line one\nline two'} />);
        const row = document.querySelector('.reasoning-row');
        expect(row?.classList.contains('is-open')).toBe(false);
        expect(screen.getByText('Thought')).toBeTruthy();
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
        expect(screen.getByText(/line number 80/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
        expect(screen.queryByText(/line number 80/)).toBeNull();
    });
});
