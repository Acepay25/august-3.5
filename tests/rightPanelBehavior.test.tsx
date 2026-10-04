/**
 * The shared right-panel contract (hooks/useRightPanel + shell/RightPanel).
 *
 * These are BEHAVIOUR tests, not source scans: the contract's whole value is
 * that panels stop re-implementing it, and a scan cannot tell whether the
 * shared version behaves. The geometry the Trade dock keeps for itself is
 * pinned separately in tests/dockExpandedLayout.test.ts.
 *
 * The headline case is the capsules. A tab strip that only renders for one
 * panel is invisible, and one that renders for one panel is furniture — so the
 * test drives TWO docks and asserts both that the strip appears and that
 * switching keeps both panels MOUNTED. Unmounting on switch is how the dock
 * already lost a composer's draft once; the whole point of the shared shell is
 * that it does not happen again.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { useRightPanel } from '../hooks/useRightPanel';
import RightPanel from '../components/shell/RightPanel';

const setViewport = (width: number): void => {
    Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
};

beforeEach(() => {
    window.localStorage.clear();
    setViewport(1440);
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useRightPanel — presentation', () => {
    const opts = { surface: 'trade', defaultWidth: 384, minWidth: 300, maxWidth: 820 };

    it('pushes beside the content when there is room', () => {
        setViewport(1440);
        const { result } = renderHook(() => useRightPanel(opts));
        expect(result.current.presentation).toBe('push');
    });

    it('forces fullscreen below 768px, because a pushed panel would squeeze the chart', () => {
        setViewport(600);
        const { result } = renderHook(() => useRightPanel(opts));
        expect(result.current.presentation).toBe('fullscreen');
    });

    it('honours a custom fullscreen threshold', () => {
        setViewport(900);
        const { result } = renderHook(() => useRightPanel({ ...opts, fullscreenBelow: 1024 }));
        expect(result.current.presentation).toBe('fullscreen');
    });
});

describe('useRightPanel — width is per surface and survives a reload', () => {
    const base = { defaultWidth: 384, minWidth: 300, maxWidth: 820 };

    it('persists under a surface-namespaced key', () => {
        const { result } = renderHook(() => useRightPanel({ ...base, surface: 'trade' }));
        act(() => result.current.setWidth(512));
        expect(window.localStorage.getItem('right_panel_width_v1_trade')).toBe('512');
    });

    it('two surfaces keep their own width', () => {
        const a = renderHook(() => useRightPanel({ ...base, surface: 'trade' }));
        const b = renderHook(() => useRightPanel({ ...base, surface: 'journal' }));
        act(() => a.result.current.setWidth(500));
        act(() => b.result.current.setWidth(700));
        expect(window.localStorage.getItem('right_panel_width_v1_trade')).toBe('500');
        expect(window.localStorage.getItem('right_panel_width_v1_journal')).toBe('700');
    });

    it('reads a saved width back on mount', () => {
        window.localStorage.setItem('right_panel_width_v1_trade', '610');
        const { result } = renderHook(() => useRightPanel({ ...base, surface: 'trade' }));
        expect(result.current.width).toBe(610);
    });

    it('clamps to the surface floor and ceiling rather than trusting the store', () => {
        window.localStorage.setItem('right_panel_width_v1_trade', '5000');
        const { result } = renderHook(() => useRightPanel({ ...base, surface: 'trade' }));
        act(() => result.current.setWidth(99));
        expect(result.current.width).toBe(300);
        act(() => result.current.setWidth(99_000));
        expect(result.current.width).toBe(820);
    });

    it('adopts a pre-contract width key once, so upgrading resets nobody’s dock', () => {
        window.localStorage.setItem('trade_dock_width_v1', '470');
        const { result } = renderHook(() => useRightPanel({
            ...base, surface: 'trade', legacyWidthKey: 'trade_dock_width_v1',
        }));
        expect(result.current.width).toBe(470);
        // Written forward immediately — the legacy key is consulted exactly once.
        expect(window.localStorage.getItem('right_panel_width_v1_trade')).toBe('470');
    });

    it('resetWidth returns to the default', () => {
        const { result } = renderHook(() => useRightPanel({ ...base, surface: 'trade' }));
        act(() => result.current.setWidth(700));
        act(() => result.current.resetWidth());
        expect(result.current.width).toBe(384);
    });
});

describe('useRightPanel — dock registry', () => {
    const base = { surface: 'trade', defaultWidth: 384, minWidth: 300, maxWidth: 820 };

    it('registers each dock once, however many times it is announced', () => {
        const { result } = renderHook(() => useRightPanel(base));
        act(() => result.current.register({ id: 'a', label: 'A' }));
        act(() => result.current.register({ id: 'a', label: 'A' }));
        act(() => result.current.register({ id: 'b', label: 'B' }));
        expect(result.current.docks.map(d => d.id)).toEqual(['a', 'b']);
    });

    it('re-opening an already-open dock brings it forward rather than doing nothing', () => {
        const { result } = renderHook(() => useRightPanel(base));
        act(() => { result.current.open('a'); result.current.open('b'); result.current.open('a'); });
        expect(result.current.openIds).toEqual(['b', 'a']);
        expect(result.current.activeId).toBe('a');
    });

    it('closing the visible dock falls back to the next one open, not to nothing', () => {
        const { result } = renderHook(() => useRightPanel(base));
        act(() => { result.current.open('a'); result.current.open('b'); });
        act(() => result.current.close('b'));
        expect(result.current.activeId).toBe('a');
        expect(result.current.isOpen).toBe(true);
    });

    it('reports nothing open when the last dock closes', () => {
        const { result } = renderHook(() => useRightPanel(base));
        act(() => result.current.open('a'));
        act(() => result.current.close('a'));
        expect(result.current.isOpen).toBe(false);
        expect(result.current.activeId).toBeNull();
    });
});

describe('RightPanel — the shell', () => {
    const base = {
        presentation: 'push' as const,
        isResizing: false,
        width: 384,
        isActive: true,
        isHidden: false,
        docks: [] as Array<{ id: string; label: string }>,
        openIds: [] as string[],
        activeId: null as string | null,
        onSelectDock: () => {},
        onCloseDock: () => {},
        onResizeStart: () => {},
        onResizeReset: () => {},
        label: 'Panels',
    };

    it('renders no tab strip for a single panel — a one-tab bar is furniture', () => {
        render(<RightPanel {...base} docks={[{ id: 'a', label: 'A' }]} openIds={['a']} activeId="a">
            <div>body</div>
        </RightPanel>);
        expect(screen.queryByTestId('right-panel-tabs')).toBeNull();
    });

    it('renders one capsule per open panel once there is more than one', () => {
        render(<RightPanel
            {...base}
            docks={[{ id: 'a', label: 'Chart AI' }, { id: 'b', label: 'Analytics' }]}
            openIds={['a', 'b']}
            activeId="b"
        >
            <div>body</div>
        </RightPanel>);
        const strip = screen.getByTestId('right-panel-tabs');
        expect(strip).toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(2);
        expect(screen.getByRole('tab', { name: 'Analytics' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Chart AI' })).toHaveAttribute('aria-selected', 'false');
    });

    it('does not offer a capsule for a panel that is not open', () => {
        render(<RightPanel
            {...base}
            docks={[{ id: 'a', label: 'Chart AI' }, { id: 'b', label: 'Analytics' }, { id: 'c', label: 'Closed' }]}
            openIds={['a', 'b']}
            activeId="a"
        >
            <div>body</div>
        </RightPanel>);
        expect(screen.queryByRole('tab', { name: 'Closed' })).toBeNull();
    });

    it('HIDES rather than closes: the children stay mounted and become inert', () => {
        render(<RightPanel {...base} isHidden>
            <div data-testid="expensive-panel">expensive state</div>
        </RightPanel>);
        // The whole point: still in the document, so its state was never thrown away.
        expect(screen.getByTestId('expensive-panel')).toBeInTheDocument();
        expect(screen.getByTestId('expensive-panel').closest('aside')).toHaveAttribute('data-hidden', 'true');
        expect(screen.getByTestId('expensive-panel').closest('aside')).toHaveAttribute('inert');
    });

    it('shows the drag handle only when open and pushing', () => {
        const { unmount } = render(<RightPanel {...base}><div /></RightPanel>);
        expect(screen.getByRole('separator')).toBeInTheDocument();
        unmount();

        render(<RightPanel {...base} isHidden><div /></RightPanel>);
        expect(screen.queryByRole('separator')).toBeNull();
    });

    it('drops the width transition while a resize is in flight', () => {
        const { rerender } = render(<RightPanel {...base}><div /></RightPanel>);
        expect(screen.getByLabelText('Panels').className).toContain('transition-[width]');
        rerender(<RightPanel {...base} isResizing><div /></RightPanel>);
        expect(screen.getByLabelText('Panels').className).not.toContain('transition-[width]');
    });
});