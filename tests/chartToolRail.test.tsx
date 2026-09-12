/**
 * ChartToolRail — the TradingView-style left drawing rail: tool selection
 * with active highlighting, the trend group's flyout of alternates, the
 * hide-all eye, undo/clear availability and the color palette popover.
 * Pure presentation — every action is a prop callback.
 */

import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChartToolRail } from '../components/trade/ChartToolRail';
import type { DrawTool } from '../services/trade/chartDrawings';

let events: string[] = [];

const Harness: React.FC<{ initialTool?: DrawTool; canUndo?: boolean }> = ({ initialTool = 'cursor', canUndo = false }) => {
    const [tool, setTool] = useState<DrawTool>(initialTool);
    const [color, setColor] = useState('#07b56a');
    const [hidden, setHidden] = useState(false);
    return (
        <ChartToolRail
            tool={tool}
            onSelectTool={t => { events.push(`tool:${t}`); setTool(t); }}
            color={color}
            onColorChange={c => { events.push(`color:${c}`); setColor(c); }}
            canUndo={canUndo}
            onUndo={() => events.push('undo')}
            onClear={() => events.push('clear')}
            hidden={hidden}
            onToggleHidden={() => { events.push('hidden'); setHidden(v => !v); }}
        />
    );
};

describe('ChartToolRail', () => {
    it('arms a tool, highlights it, and re-clicking returns to the cursor', () => {
        events = [];
        render(<Harness />);
        const trend = screen.getByTitle('Trendline — click start, click end');
        expect(trend.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(trend);
        expect(events).toEqual(['tool:trend']);
        expect(screen.getByTitle('Trendline — click start, click end').getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByTitle('Trendline — click start, click end'));
        expect(events).toEqual(['tool:trend', 'tool:cursor']);
    });

    it('opens the trend group flyout and picks the ray from it', () => {
        events = [];
        render(<Harness />);
        expect(screen.queryByTestId('trend-flyout')).toBeNull();
        fireEvent.click(screen.getByTitle('More line tools'));
        const flyout = screen.getByTestId('trend-flyout');
        expect(flyout).toBeTruthy();
        fireEvent.click(screen.getByTitle('Ray — click start, click direction (extends right)'));
        expect(events).toEqual(['tool:ray']);
    });

    it('every TradingView tool has a labelled button on the rail', () => {
        render(<Harness />);
        for (const title of [
            'Cursor — pan & zoom the chart',
            'Horizontal line — click a price',
            'Zone — click corner to corner',
            'Fib retracement — click swing low, click swing high',
            'Text note — click a spot, type the note',
            'Freehand — drag to draw',
            'Eraser — click a shape to remove it',
        ]) {
            expect(screen.getByTitle(title)).toBeTruthy();
        }
    });

    it('the eye toggles hide-all and the palette picks a color', () => {
        events = [];
        render(<Harness />);
        fireEvent.click(screen.getByTitle('Hide all drawings'));
        expect(events).toContain('hidden');
        expect(screen.getByTitle('Show all drawings')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Drawing color'));
        const swatch = screen.getByLabelText('Draw with #f08800');
        fireEvent.click(swatch);
        expect(events).toContain('color:#f08800');
    });

    it('undo/clear are disabled until drawings exist', () => {
        const { rerender } = render(<Harness canUndo={false} />);
        expect((screen.getByTitle('Undo last drawing') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTitle('Clear all drawings') as HTMLButtonElement).disabled).toBe(true);
        rerender(<Harness canUndo />);
        expect((screen.getByTitle('Undo last drawing') as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByTitle('Clear all drawings') as HTMLButtonElement).disabled).toBe(false);
    });
});
