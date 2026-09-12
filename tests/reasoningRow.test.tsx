import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReasoningRow from '../components/shared/ReasoningRow';

vi.mock('lucide-react', () => ({
    Brain: () => <span data-testid="brain-icon" />,
    Lightbulb: () => <span data-testid="lightbulb-icon" />,
}));

describe('ReasoningRow (ZCode/MiniMax reference style)', () => {
    it('renders nothing for empty thinking', () => {
        const { container } = render(<ReasoningRow thinking="   " />);
        expect(container.querySelector('.reasoning-row')).toBeNull();
    });

    it('mounted settled row: bare Thought + brain icon, collapsed, no clock meta', () => {
        render(<ReasoningRow thinking={'First thought.\nSecond thought.'} />);
        const details = screen.getByText('Thought').closest('details');
        expect(details).toBeDefined();
        expect(details?.open).toBe(false);
        expect(details?.getAttribute('data-state')).toBe('ok');
        expect(screen.getByTestId('brain-icon')).toBeDefined();
        // Restored history has no clock — no duration meta.
        expect(document.querySelector('.reasoning-row-meta')).toBeNull();
    });

    it('expands on click into clean bulleted lines with markdown markers stripped', () => {
        render(<ReasoningRow thinking={'**ADX 9.2** (ranging regime)\n- **scan setups** ok\n15m RSI 50.3 (neutral)'} />);
        fireEvent.click(screen.getByText('Thought'));
        const details = screen.getByText('Thought').closest('details');
        expect(details?.open).toBe(true);
        // One observation per bullet, `**` / leading `-` peeled.
        expect(screen.getByText('ADX 9.2 (ranging regime)')).toBeDefined();
        expect(screen.getByText('scan setups ok')).toBeDefined();
        expect(screen.getByText('15m RSI 50.3 (neutral)')).toBeDefined();
        expect(document.querySelector('.reasoning-row')?.textContent).not.toContain('**');
    });

    it('running: wrapping Tip line (MiniMax style) + live duration, NO ticker, stays closed', async () => {
        const { container } = render(<ReasoningRow thinking={'step one\nstep two\nstep three'} running />);
        const row = container.querySelector('.reasoning-row');
        expect(row?.getAttribute('data-state')).toBe('running');
        // The label is the rotating trader tip with a lightbulb glyph…
        expect(screen.getByTestId('lightbulb-icon')).toBeDefined();
        expect(screen.getByText(/^Tip: /)).toBeDefined();
        // …NO scrolling ticker preview — raw trace never leaks into the row.
        expect(container.querySelector('.reasoning-row-clip')).toBeNull();
        expect(container.querySelector('.reasoning-row-line')).toBeNull();
        // The row stays closed until clicked; a live duration ticks.
        expect(row?.classList.contains('is-open')).toBe(false);
        await waitFor(() => {
            expect(document.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
        });
    });

    it('running + expanded shows the marker-stripped live trace', () => {
        render(<ReasoningRow thinking={'**mid-run** observation'} running />);
        fireEvent.click(screen.getByText(/^Tip: /));
        expect(document.querySelector('.reasoning-row')?.textContent).toContain('mid-run observation');
        expect(document.querySelector('.reasoning-row')?.textContent).not.toContain('**');
    });

    it('settle: flips to Thought, KEEPS the frozen duration, stays collapsed (no auto-open)', async () => {
        const utils = render(<ReasoningRow thinking="thinking hard" running />);
        await waitFor(() => {
            expect(document.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
        });
        utils.rerender(<ReasoningRow thinking="thinking hard" />);
        const row = document.querySelector('.reasoning-row');
        // No auto-open — the reference keeps settled rows collapsed.
        expect(row?.classList.contains('is-open')).toBe(false);
        // Label flips to Thought; the elapsed duration PERSISTS.
        expect(screen.getByText('Thought')).toBeDefined();
        expect(document.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
    });

    it('stays toggleable after settle — click re-opens the bullets', async () => {
        const utils = render(<ReasoningRow thinking="settled trace" running />);
        await waitFor(() => {
            expect(document.querySelector('.reasoning-row-meta')?.textContent).toMatch(/\d+s/);
        });
        utils.rerender(<ReasoningRow thinking="settled trace" />);
        fireEvent.click(screen.getByText('Thought'));
        expect(screen.getByText('settled trace')).toBeDefined();
        fireEvent.click(screen.getByText('Thought'));
        const details = screen.getByText('Thought').closest('details');
        expect(details?.open).toBe(false);
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
        fireEvent.click(screen.getByText('Thought'));
        // Expanded but truncated past the preview limit.
        expect(screen.queryByText(/line number 80/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
        expect(screen.getByText(/line number 80/)).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
        expect(screen.queryByText(/line number 80/)).toBeNull();
    });
});
