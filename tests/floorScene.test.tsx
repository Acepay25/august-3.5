import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { FloorScene } from '../components/floor/FloorScene';
import type { DebateStageActor } from '../components/analysis/DebateStage';
import type { ApprovalItem } from '../utils/approvalInbox';

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: () => {}, removeListener: () => {},
            addEventListener: () => {}, removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia;
    }
});

afterEach(() => cleanup());

const actor = (over: Partial<DebateStageActor>): DebateStageActor => ({
    id: over.id ?? 'a1',
    name: over.name ?? 'Macro Analyst',
    live: over.live ?? true,
    ...over,
});

const approval = (over: Partial<ApprovalItem>): ApprovalItem => ({
    id: over.id ?? 'ap1',
    kind: over.kind ?? 'autopilot',
    title: over.title ?? 'TP1 hit on NVDA',
    detail: over.detail ?? 'Confirm the WIN and log it',
    messageId: over.messageId ?? 'm1',
    coin: over.coin,
});

const base = {
    open: true,
    onClose: () => {},
    isDebating: false,
    actors: [] as DebateStageActor[],
    exchanges: [],
    convictions: [],
    gaugeStats: { tasks: 12, running: 0, shipped: 4, approvals: 0 },
    approvalItems: [] as ApprovalItem[],
    positions: [],
    squawk: [],
    tickers: [{ symbol: 'BTC' }, { symbol: 'ETH' }],
    staff: [{ id: 'p1', name: 'OpenAI' }],
};

describe('FloorScene', () => {
    it('renders the overlay with top-bar stats and staff count', () => {
        render(<FloorScene {...base} />);
        expect(screen.getByTestId('floor-scene')).toBeTruthy();
        expect(screen.getByTestId('floor-stat-staff').textContent).toContain('1');
        expect(screen.getByTestId('floor-stat-tasks').textContent).toContain('12');
        expect(screen.getByTestId('floor-stat-shipped').textContent).toContain('4');
        expect(screen.getByTestId('floor-clock').textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    it('shows LIVE while debating and Idle otherwise', () => {
        const { rerender } = render(<FloorScene {...base} isDebating={false} />);
        expect(screen.getByText('Idle')).toBeTruthy();
        rerender(<FloorScene {...base} isDebating phase="Round 2 of 3" />);
        expect(screen.getByTestId('floor-live-tag')).toBeTruthy();
        expect(screen.getByText('Round 2 of 3')).toBeTruthy();
    });

    it('shows the empty-floor notice when no actors are on stage', () => {
        render(<FloorScene {...base} />);
        expect(screen.getByText(/floor is empty/i)).toBeTruthy();
    });

    it('renders a desk per stage actor with speech on the spotlight seat', () => {
        const actors = [
            actor({ id: 'a1', name: 'Macro Analyst', speaking: true, speech: 'Funding is stretched long.' }),
            actor({ id: 'a2', name: 'Risk Analyst', live: true }),
        ];
        render(<FloorScene {...base} actors={actors} />);
        expect(screen.getByTestId('floor-desk-Macro Analyst')).toBeTruthy();
        expect(screen.getByTestId('floor-desk-Risk Analyst')).toBeTruthy();
        // The speaking seat's bubble text is on the floor.
        expect(screen.getByText(/Funding is stretched long/)).toBeTruthy();
    });

    it('renders the ticker strip with dash fallbacks when prices are unavailable', () => {
        render(<FloorScene {...base} />);
        const strip = screen.getByTestId('floor-ticker');
        expect(strip.textContent).toContain('BTC');
        expect(strip.textContent).toContain('ETH');
        // No network in jsdom → both rows show the em-dash fallback.
        expect(strip.textContent).toContain('—');
    });

    it('renders the pipeline lane from approvals, running state, and last print', () => {
        render(
            <FloorScene
                {...base}
                gaugeStats={{ tasks: 12, running: 1, shipped: 4, approvals: 2 }}
                approvalItems={[approval({ id: 'ap1', title: 'TP1 hit on NVDA' }), approval({ id: 'ap2', title: 'SL tightened' })]}
                phase="Round 3 of 3"
                squawk={[{ id: 's1', time: '09:38', text: 'PRINT NVDA · Long · High confidence' }]}
            />,
        );
        const lane = screen.getByTestId('floor-pipeline');
        expect(lane.textContent).toContain('2 in queue');
        expect(lane.textContent).toContain('TP1 hit on NVDA');
        expect(lane.textContent).toContain('routing 1');
        expect(lane.textContent).toContain('NVDA · Long · High confidence');
    });

    it('renders order-flow counters and positions with signed PnL', () => {
        render(
            <FloorScene
                {...base}
                gaugeStats={{ tasks: 12, running: 0, shipped: 4, approvals: 0 }}
                positions={[
                    { id: 't1', symbol: 'NVDA', direction: 'Long', pnl: 269.4 },
                    { id: 't2', symbol: 'MU', direction: 'Short', pnl: -788 },
                ]}
            />,
        );
        const flow = screen.getByTestId('floor-order-flow');
        expect(flow.textContent).toContain('Risk gate');
        expect(flow.textContent).toContain('Printed');
        const table = screen.getByTestId('floor-positions');
        expect(table.textContent).toContain('+$269');
        expect(table.textContent).toContain('−$788');
    });

    it('renders the squawk feed newest-first rows', () => {
        render(
            <FloorScene
                {...base}
                squawk={[
                    { id: 's2', time: '09:40', text: 'REVIEW post-mortem filed' },
                    { id: 's1', time: '09:38', text: 'PRINT NVDA · Long' },
                ]}
            />,
        );
        const squawk = screen.getByTestId('floor-squawk');
        expect(squawk.textContent).toContain('09:40');
        expect(squawk.textContent).toContain('REVIEW post-mortem filed');
        expect(squawk.textContent).toContain('PRINT NVDA · Long');
    });

    it('Escape and the close button both exit the floor', () => {
        const onClose = vi.fn();
        render(<FloorScene {...base} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('floor-close'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('renders nothing when open is false', () => {
        const { container } = render(<FloorScene {...base} open={false} />);
        expect(container.firstChild).toBeNull();
    });
});
