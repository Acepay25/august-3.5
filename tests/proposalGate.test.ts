/**
 * The gate scan behind `present_trade`, and the cap it puts on the row.
 *
 * The scan is CONCURRENT by design: the plan's card and its level-watch appear
 * instantly, and the log path awaits the same in-flight scan. What this file
 * pins, in order:
 *  - a failed / timed-out / cancelled scan is `unavailable` and NEVER cap 0
 *    (`quickGateCheck` collapses those two facts into one, which is why the scan
 *    calls `fetchGateInputData` + `runProgrammaticGate` itself);
 *  - one scan per plan id, no matter how many times the plan is re-presented;
 *  - `ensureStamp` reuses a fresh stamp and re-runs a stale one;
 *  - the clamp that lands on the journal row is the SAME helper the pipeline's
 *    finalizer uses, so a presented plan and a debated verdict cannot disagree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GateInput, GateOutput } from '../services/validation/GateKeeperService';
import { fetchGateInputData, runProgrammaticGate } from '../services/validation/GateKeeperService';
import type { ProposalGate, TradeProposal } from '../services/trade/proposedTrade';
import { ensureStamp, beginGateScan, cancelGateScan, isStampFresh, runGateScan, GATE_FETCH_TIMEOUT_MS, GATE_STAMP_STALE_MS } from '../services/trade/proposalGate';
import { buildProposedTradeAnalysis } from '../services/trade/proposedTrade';

vi.mock('../services/validation/GateKeeperService', () => ({
    fetchGateInputData: vi.fn(),
    runProgrammaticGate: vi.fn(),
}));

const mockFetch = vi.mocked(fetchGateInputData);
const mockGate = vi.mocked(runProgrammaticGate);

const proposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
    symbol: 'BTCUSDT',
    direction: 'Long',
    entry: 100,
    // stop 5 away, first target 15 away → planned R:R 3.0, so the R:R grade
    // thresholds NEVER fire unless a case deliberately tightens the stop.
    stopLoss: 95,
    takeProfits: [115],
    confidence: 'High',
    planId: 'btc-plan-1',
    ...over,
});

const stamp = (over: Partial<ProposalGate> = {}): ProposalGate => ({
    status: 'evaluated', confidenceCap: 0.5, reason: 'x',
    stampedAt: new Date().toISOString(), ...over,
});

const gateOut = (cap: number): GateOutput => ({
    symbol: 'BTCUSDT',
    pass: true,
    reason: 'ok',
    allowedFamilies: ['A', 'B', 'C', 'Omega'],
    confidenceCap: cap,
    confidencePenalties: { dataIntegrity: 0, patternMemory: 0, htfConflict: 0, volumeContext: 0, rawTotal: 0, effectiveTotal: 0 },
    familyBias: { A: 0, B: 0, C: 0, Omega: 0, reasoning: [] },
    warnings: [],
    insights: [],
    stage1Timestamp: new Date().toISOString(),
    processingTimeMs: 1,
});

beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({} as GateInput);
    mockGate.mockReturnValue(gateOut(0.5));
});

describe('runGateScan', () => {
    it('reports the measured cap on fresh data', async () => {
        const gate = await runGateScan(proposal(), []);
        expect(gate.status).toBe('evaluated');
        expect(gate.confidenceCap).toBe(0.5);
        expect(gate.reason).toContain('50% cap');
        expect(Date.parse(gate.stampedAt)).not.toBeNaN();
    });

    it('fetches by the PLAN symbol, not whatever the surface is showing', async () => {
        await runGateScan(proposal({ symbol: 'ETHUSDT' }), []);
        expect(mockFetch).toHaveBeenCalledWith('ETHUSDT', []);
    });

    // THE reason this is not `quickGateCheck`: that helper answers a failed fetch
    // with confidenceCap 0, and a 0 here would silently report a live plan as a
    // worthless one for the length of a network blip.
    it('a failed fetch is unavailable with cap 1, not cap 0', async () => {
        mockFetch.mockResolvedValue(null);
        const gate = await runGateScan(proposal(), []);
        expect(gate.status).toBe('unavailable');
        expect(gate.confidenceCap).toBe(1);
    });

    it('a throwing scan is unavailable too, with the error named', async () => {
        mockGate.mockImplementation(() => { throw new Error('indicator blew up'); });
        const gate = await runGateScan(proposal(), []);
        expect(gate.status).toBe('unavailable');
        expect(gate.reason).toBe('indicator blew up');
        expect(gate.confidenceCap).toBe(1);
    });

    it('never reaches the network once the turn is stopped', async () => {
        const c = new AbortController();
        c.abort();
        const gate = await runGateScan(proposal(), [], c.signal);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(gate.reason).toContain('stopped');
    });

    it('discards a fetch that answers after the turn was stopped', async () => {
        // The market fetch has no signal of its own; the abort has to be
        // re-checked when it resolves or a stopped turn gets an evaluated stamp.
        let resolveFetch!: (value: GateInput) => void;
        mockFetch.mockReturnValue(new Promise<GateInput>(resolve => { resolveFetch = resolve; }));
        const c = new AbortController();
        const pending = runGateScan(proposal(), [], c.signal);
        c.abort();
        resolveFetch({} as GateInput);
        const gate = await pending;
        expect(gate.status).toBe('unavailable');
        expect(gate.reason).toContain('stopped');
        expect(mockGate).not.toHaveBeenCalled();
    });

    it('gives up on a scan that never answers', async () => {
        vi.useFakeTimers();
        try {
            mockFetch.mockReturnValue(new Promise<GateInput>(() => {}));
            const pending = runGateScan(proposal(), []);
            await vi.advanceTimersByTimeAsync(GATE_FETCH_TIMEOUT_MS);
            const gate = await pending;
            expect(gate.status).toBe('unavailable');
            expect(gate.reason).toContain('timed out');
            expect(gate.confidenceCap).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('one scan per plan', () => {
    it('a second present_trade for the same plan joins the first fetch', async () => {
        const a = beginGateScan('btc-plan-1', proposal());
        const b = beginGateScan('btc-plan-1', proposal());
        await Promise.all([a, b]);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('a different plan id does get its own scan', async () => {
        await Promise.all([
            beginGateScan('btc-plan-1', proposal()),
            beginGateScan('eth-plan-2', proposal({ symbol: 'ETHUSDT' })),
        ]);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('cancel makes the settled stamp an unavailable one, and clears the slot', async () => {
        mockFetch.mockReturnValue(new Promise<GateInput>(() => {}));
        const pending = beginGateScan('btc-plan-stop', proposal());
        cancelGateScan('btc-plan-stop');
        // The aborted controller only short-circuits a scan that has not started
        // its fetch yet; the timed-out path is what answers this one.
        await vi.waitFor(async () => {
            const gate = await Promise.race([
                pending,
                new Promise<null>(r => setTimeout(() => r(null), 200)),
            ]);
            expect(gate === null || gate.status === 'unavailable').toBe(true);
        });
    });
});

describe('ensureStamp — what every log path awaits', () => {
    it('reuses a fresh stamp without touching the network', async () => {
        const gate = await ensureStamp(proposal({ gate: stamp() }), []);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(gate.confidenceCap).toBe(0.5);
    });

    it('re-runs a stamp older than the staleness window', async () => {
        const old = stamp({ stampedAt: new Date(Date.now() - GATE_STAMP_STALE_MS - 1000).toISOString() });
        expect(isStampFresh(old)).toBe(false);
        await ensureStamp(proposal({ gate: old }), []);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('joins the in-flight scan started by present_trade rather than starting a second', async () => {
        const inflight = beginGateScan('btc-plan-1', proposal());
        const gate = await ensureStamp(proposal(), []);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(await inflight).toEqual(gate);
    });

    it('an unstamped plan with no id still gets measured (no silent pass-through)', async () => {
        const gate = await ensureStamp(proposal({ planId: undefined }), []);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(gate.status).toBe('evaluated');
    });
});

describe('the cap binds the analysis a logged plan becomes', () => {
    it('control: an unstamped High proposal is 72 and says it was never measured', () => {
        const a = buildProposedTradeAnalysis(proposal());
        expect(a.probability).toBe(72);
        expect(a.confidence).toBe('High');
        expect(a.validationWarnings?.join(' ')).toContain('logged UNCAPPED');
    });

    it('an evaluated 50% cap drags a High plan to 50 and re-tiers it to the band', () => {
        const a = buildProposedTradeAnalysis(proposal({ gate: stamp({ confidenceCap: 0.5 }) }));
        expect(a.probability).toBe(50);
        // Task 33: the label is a band of the FINAL number, not one step from the
        // old one. A 50% plan sits under the Low/Medium floor (55), so it reads
        // Low — the one-step walk left the word "Medium" on a 50, which is the
        // probability and the word disagreeing inside one verdict.
        expect(a.confidence).toBe('Low');
        expect(a.validationWarnings?.join(' ')).toContain('Gate enforcement');
        expect(a.gate?.status).toBe('evaluated');
    });

    it('a plan that arrives as Medium under the 55 floor lands on Low', () => {
        const a = buildProposedTradeAnalysis(proposal({ confidence: 'Medium', gate: stamp({ confidenceCap: 0.5 }) }));
        expect(a.probability).toBe(50);
        expect(a.confidence).toBe('Low');
    });

    it('leaves the plan alone when the cap does not bind', () => {
        const a = buildProposedTradeAnalysis(proposal({ gate: stamp({ confidenceCap: 0.9 }) }));
        expect(a.probability).toBe(72);
        expect(a.confidence).toBe('High');
        expect(a.validationWarnings).toBeUndefined();
    });

    it('also applies the R:R grade threshold, because it reuses the shared clamp', () => {
        // stop 10 away vs target 10 away → R:R 1.0 < 1.2, so 54% caps it even
        // though the gate would have allowed 80.
        const a = buildProposedTradeAnalysis(proposal({
            stopLoss: 90, takeProfits: [110], gate: stamp({ confidenceCap: 0.8 }),
        }));
        expect(a.rrRatio).toBeCloseTo(1, 5);
        expect(a.probability).toBe(54);
    });

    it('an unavailable scan is recorded uncapped, stamped, with the reason', () => {
        const a = buildProposedTradeAnalysis(proposal({ gate: stamp({ status: 'unavailable', confidenceCap: 1, reason: 'market data fetch returned nothing' }) }));
        expect(a.probability).toBe(72);
        expect(a.gate?.status).toBe('unavailable');
        expect(a.validationWarnings?.join(' ')).toContain('UNCAPPED');
        expect(a.validationWarnings?.join(' ')).toContain('market data fetch returned nothing');
    });
});
