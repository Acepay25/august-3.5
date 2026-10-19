/**
 * A stopped turn must not get a gate stamp after the fact. `cancelGateScan`
 * deletes the in-flight entry, but the promise `present_trade` started still
 * resolves; the sink guard is the last line of defence.
 */

import { describe, expect, it, vi } from 'vitest';
import type { DeskToolCall } from '../services/analysis/DeskToolsService';
import type { ProposalGate } from '../services/trade/proposedTrade';
import { runPresentTrade, type PresentTradeSink } from '../services/trade/presentTradeTool';
import { beginGateScan, cancelGateScan } from '../services/trade/proposalGate';

vi.mock('../services/trade/proposalGate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/trade/proposalGate')>();
    return { ...actual, beginGateScan: vi.fn(), cancelGateScan: vi.fn() };
});

const call = (): DeskToolCall => ({
    id: 'call-1',
    name: 'present_trade',
    arguments: { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 95, takeProfits: [110] },
});

const ctx = () => ({
    call: call(),
    symbol: 'BTCUSDT',
    trades: [],
    drawnPrice: null,
    crossCanvas: false,
    watchable: false,
    canvasNote: '',
});

const gate = (): ProposalGate => ({
    status: 'evaluated', confidenceCap: 0.5, reason: 'ok', stampedAt: new Date().toISOString(),
});

describe('present_trade and a stopped turn', () => {
    it('drops the late stamp and cancels the scan', async () => {
        let resolveGate!: (value: ProposalGate) => void;
        const pending = new Promise<ProposalGate>(resolve => { resolveGate = resolve; });
        vi.mocked(beginGateScan).mockReturnValue(pending);

        let onAbort: (() => void) | null = null;
        const sink: PresentTradeSink = {
            setProposal: vi.fn(),
            setGate: vi.fn(),
            onAbort: fn => { onAbort = fn; },
        };

        runPresentTrade(ctx(), sink);
        expect(beginGateScan).toHaveBeenCalledTimes(1);
        expect(onAbort).not.toBeNull();
        onAbort!();
        expect(cancelGateScan).toHaveBeenCalledTimes(1);

        resolveGate(gate());
        await Promise.resolve();
        await Promise.resolve();
        expect(sink.setGate).not.toHaveBeenCalled();
    });
});
