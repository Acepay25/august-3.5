import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReasoningRow from '../components/shared/ReasoningRow';

vi.mock('../components/shared/MarkdownContent', () => ({
    default: ({ content }: { content?: string }) => <div data-testid="md">{content}</div>,
}));
vi.mock('../components/shared/Icons', () => ({
    ChevronDownIcon: ({ className }: { className?: string }) => <span data-testid="chevron" className={className} />,
}));

describe('ReasoningRow', () => {
    it('renders nothing for empty thinking', () => {
        const { container } = render(<ReasoningRow thinking="   " />);
        expect(container.querySelector('.reasoning-row')).toBeNull();
    });

    it('is a native disclosure that keeps the trace in the DOM when collapsed', () => {
        render(<ReasoningRow thinking="Weighed the sweep." />);
        const details = screen.getByText('Weighed the sweep.').closest('details');
        expect(details).toBeDefined();
        expect(details?.open).toBe(false);
        expect(details?.getAttribute('data-state')).toBe('ok');
    });

    it('expands when the Thinking label is clicked', () => {
        render(<ReasoningRow thinking="Weighed the sweep." />);
        fireEvent.click(screen.getByText('Thinking'));
        expect(screen.getByText('Weighed the sweep.').closest('details')?.open).toBe(true);
    });

    it('shows a running state with a live ticker of the latest line', () => {
        render(<ReasoningRow thinking={'step one\nstep two\nstep three'} running />);
        expect(document.querySelector('.reasoning-row')?.getAttribute('data-state')).toBe('running');
        // The collapsed ticker surfaces the most recent line only.
        expect(screen.getByText('step three')).toBeDefined();
        expect(screen.queryByText('step one')).toBeDefined(); // still in the trace body
    });

    it('auto-collapses when the stream settles', () => {
        const { rerender } = render(<ReasoningRow thinking="thinking hard" running defaultOpen />);
        expect(document.querySelector('.reasoning-row')?.classList.contains('is-open')).toBe(true);
        rerender(<ReasoningRow thinking="thinking hard" defaultOpen />);
        expect(document.querySelector('.reasoning-row')?.classList.contains('is-open')).toBe(false);
    });

    it('auto-expands when the stream starts so the thinking is seen generating', () => {
        const { rerender } = render(<ReasoningRow thinking="thinking hard" />);
        expect(document.querySelector('.reasoning-row')?.classList.contains('is-open')).toBe(false);
        rerender(<ReasoningRow thinking="thinking hard" running />);
        expect(document.querySelector('.reasoning-row')?.classList.contains('is-open')).toBe(true);
    });

    it('shows talking dots and a caret while running', () => {
        render(<ReasoningRow thinking="live trace" running defaultOpen />);
        expect(document.querySelector('.reasoning-row-dots')).toBeDefined();
        expect(document.querySelector('.reasoning-row-caret')).toBeDefined();
    });

    it('starts expanded with defaultOpen', () => {
        render(<ReasoningRow thinking="open trace" defaultOpen />);
        expect(document.querySelector('.reasoning-row')?.classList.contains('is-open')).toBe(true);
    });
});
