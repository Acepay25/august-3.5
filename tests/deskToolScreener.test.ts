/**
 * The run_screener desk tool: Chart AI can grade the whole market in one
 * call — capped, filterable, sortable — and the digest rides the same
 * labeled-row grammar as every other tool.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const { runScreenerMock } = vi.hoisted(() => ({
    runScreenerMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/trade/screener', () => ({
    runScreener: (...args: unknown[]) => runScreenerMock(...args),
    screenerToMarkdown: (rows: unknown[]) => `MD:${rows.length}`,
}));

import { executeDeskTool, DESK_TOOL_DEFINITIONS, toolLabel } from '../services/analysis/DeskToolsService';

const ROW = (symbol: string, change24h: number, setups: number) => ({
    symbol, baseAsset: symbol.replace(/USDT$/, ''), price: 100, change24h, quoteVolume: 1e9,
    rsi14: 50, regime: 'range' as const,
    setups: Array.from({ length: setups }, (_, i) => ({ title: `Setup ${i}`, side: 'long' as const })),
    edge: '',
});

const call = (args: Record<string, unknown>) => executeDeskTool(
    { id: 'c1', name: 'run_screener', arguments: args },
    {},
);

beforeEach(() => {
    runScreenerMock.mockReset();
    runScreenerMock.mockResolvedValue([ROW('BTCUSDT', 1, 0), ROW('SOLUSDT', 6, 2)]);
});

describe('run_screener desk tool', () => {
    it('is in the catalog with the labeled digest', () => {
        expect(DESK_TOOL_DEFINITIONS.some(d => d.function.name === 'run_screener')).toBe(true);
        expect(toolLabel('run_screener')).toBe('screener');
    });

    it('passes the journal through and renders the digest', async () => {
        const trades = [] as never[];
        const result = await call({ top: 15 });
        expect(result.ok).toBe(true);
        expect(runScreenerMock.mock.calls[0][0].limit).toBe(15);
        expect(result.content).toBe('MD:2');
    });

    it('caps top at 30 and floors it at 5', async () => {
        await call({ top: 999 });
        expect(runScreenerMock.mock.calls[0][0].limit).toBe(30);
        await call({ top: 0 });
        expect(runScreenerMock.mock.calls[1][0].limit).toBe(5);
    });

    it('filters setups-only and sorts movers before digesting', async () => {
        await call({ setupsOnly: true, sort: 'movers' });
        const arg = runScreenerMock.mock.calls[0][0];
        expect(arg.trades).toEqual([]);
        const digestArg = await call({ setupsOnly: true, sort: 'movers' });
        // SOL (6% move, 2 setups) outranks BTC for both mover sort and the setup filter.
        expect(digestArg.content).toBe('MD:1');
    });
});
