import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DebateStage, { DebateStageActor } from '../components/analysis/DebateStage';

const actor = (over: Partial<DebateStageActor> = {}): DebateStageActor => ({
    id: 'Macro',
    name: 'Macro',
    live: true,
    ...over,
});

describe('DebateStage inline steer (ROUND-35 polish)', () => {
    it('queues a seat note via the inline input (no window.prompt)', () => {
        const onSteerSeat = vi.fn();
        const { container } = render(
            <DebateStage actors={[actor()]} live onSteerSeat={onSteerSeat} />,
        );
        // Hover control opens the inline row.
        fireEvent.click(screen.getByTitle('Steer Macro: a note only they see'));
        const input = screen.getByPlaceholderText('Note for Macro — only they see it');
        fireEvent.change(input, { target: { value: 'Focus on funding rates' } });
        fireEvent.click(screen.getByText('Queue'));
        expect(onSteerSeat).toHaveBeenCalledWith('Macro', 'Focus on funding rates');
        expect(container.querySelector('input')).toBeNull(); // row closed
    });

    it('shows the cost/latency tooltip line when meta is present', () => {
        render(
            <DebateStage
                actors={[actor({ meta: 'Macro · qwen3-1.7b · 41s · 1.2k out' })]}
                live
            />,
        );
        expect(
            screen.getByTitle('Macro — Macro · qwen3-1.7b · 41s · 1.2k out'),
        ).toBeInTheDocument();
    });

    it('stop button calls onStopSeat', () => {
        const onStopSeat = vi.fn();
        render(<DebateStage actors={[actor()]} live onStopSeat={onStopSeat} />);
        fireEvent.click(screen.getByTitle('Stop Macro: they leave at the next round'));
        expect(onStopSeat).toHaveBeenCalledWith('Macro');
    });
});
