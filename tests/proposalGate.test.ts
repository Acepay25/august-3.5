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
import { ensureStamp, beginGateScan, cancelGateScan, isStampFresh, runGateScan, gateReceiptLine, GATE_FETCH_TIMEOUT_MS, GATE_STAMP_STALE_MS } from '../services/trade/proposalGate';
import { buildProposedTradeAnalysis } from '../services/trade/proposedTrade';
import { saveHarnessSettings } from '../utils/harnessSettings';

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

    it('REFUSES a plan whose net edge at its own probability is at or below the floor (E-43)', async () => {
        // 44 % at 0.5R on a 1 % stop: −0.44R after the round trip.
        const p = proposal({ entry: 100, stopLoss: 99, takeProfits: [100.5], confidence: 'Low' });
        const gate = await runGateScan(p, []);
        expect(gate.refusal).toMatch(/net expectancy -0\.44R/);
        expect(gate.netEdgeR).toBeCloseTo(-0.44, 2);
        expect(gate.minEdgeThresholdR).toBe(0);
        expect(gateReceiptLine(gate)).toMatch(/REFUSED/);
        const row = buildProposedTradeAnalysis({ ...p, gate });
        expect(row.validationWarnings?.join(' ')).toMatch(/REFUSED by the gate/);
    });

    it('does NOT refuse a positive-edge plan', async () => {
        const gate = await runGateScan(proposal(), []);
        expect(gate.refusal).toBeUndefined();
        expect(gate.netEdgeR).toBeGreaterThan(0);
    });

    it('honours the TRADER floor, and names it in the refusal', async () => {
        saveHarnessSettings({ minEdgeR: 2 });
        try {
            const gate = await runGateScan(proposal(), []);
            expect(gate.refusal).toMatch(/your 2\.00R floor/);
            expect(gate.minEdgeThresholdR).toBe(2);
        } finally {
            saveHarnessSettings({ minEdgeR: 0 });
        }
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

    // E-57 §5. These bands have lived in `validateRiskReward` for months and
    // nothing outside `TradeValidationGate` — a module with no importer — ever
    // called them, so a plan was graded against a floor nobody enforced and the
    // trader never saw it. The owner's ruling splits them: a stop distance is
    // the trader's judgement, so the bands WARN; only a plan whose levels
    // contradict each other refuses, because there is nothing to judge.
    describe('the plan shape the gate now answers for', () => {
        it('WARNS on a sub-floor R:R and keeps the plan loggable', async () => {
            // Medium floor is 1.5 (`ValidationConstants.MIN_RATIO_BY_CONFIDENCE`);
            // risk 5 against a 6-point target is 1.2.
            const p = proposal({ entry: 100, stopLoss: 95, takeProfits: [106], confidence: 'Medium' });
            const gate = await runGateScan(p, []);
            expect(gate.status).toBe('evaluated');
            expect(gate.refusal).toBeUndefined();
            expect(gate.warnings?.join(' '))
                .toMatch(/R:R ratio \(1\.20\) below required minimum \(1\.5\) for Medium confidence/);
            // The caution is on the RECORD, not only on the card: after the
            // trader logs it, the row says what the gate thought.
            const row = buildProposedTradeAnalysis({ ...p, gate });
            expect(row.validationWarnings?.join(' ')).toContain('below required minimum (1.5)');
        });

        it('measures the stop against the 1h ATR the gate already scores on', async () => {
            mockFetch.mockResolvedValue({ indicators: { '1h': { atr: 10 } } } as unknown as GateInput);
            // risk 2 against a 10 ATR: inside 1×, so the noise band fires. The
            // ratio (15.0) is nowhere near the floor, so this is the ATR alone.
            const gate = await runGateScan(proposal({ entry: 100, stopLoss: 98, takeProfits: [130] }), []);
            expect(gate.refusal).toBeUndefined();
            expect(gate.warnings?.join(' ')).toMatch(/tighter than 1x ATR \(10\.00\)/);
        });

        it('falls back through the frames when the 1h set carries no ATR', async () => {
            mockFetch.mockResolvedValue({ indicators: { '1h': null, '4h': { atr: 4 } } } as unknown as GateInput);
            const gate = await runGateScan(proposal({ entry: 100, stopLoss: 98, takeProfits: [130] }), []);
            expect(gate.warnings?.join(' ')).toMatch(/tighter than 1x ATR \(4\.00\)/);
        });

        it('control: a well-shaped plan gets no caution, with or without an ATR', async () => {
            // `{} as GateInput` is a scan that answered with no indicators at
            // all, which is the case the old code printed "Infinityx ATR" for on
            // EVERY plan. Without this arm the cases above would pass on a
            // gate that warned about everything.
            const gate = await runGateScan(proposal(), []);
            expect(gate.status).toBe('evaluated');
            expect(gate.warnings).toBeUndefined();
            expect(gate.refusal).toBeUndefined();
        });

        it('REFUSES an inverted plan, and the shape refusal wins over the edge floor', async () => {
            // A Long whose stop is ABOVE the entry and whose target is BELOW it.
            // Its net edge is also negative here, and the edge refusal must NOT
            // be the one quoted: grading an expectancy on levels that point the
            // wrong way is a claim about arithmetic that does not exist.
            const p = proposal({ entry: 100, stopLoss: 105, takeProfits: [90] });
            const gate = await runGateScan(p, []);
            expect(gate.refusal).toMatch(/levels are inverted for a Long plan/);
            expect(gate.refusal).not.toMatch(/net expectancy/);
            // Not the ordering module's repair strings either — nothing mirrored.
            expect(gate.refusal).not.toMatch(/mirrored/);
            const row = buildProposedTradeAnalysis({ ...p, gate });
            expect(row.validationWarnings?.join(' ')).toMatch(/REFUSED by the gate: levels are inverted/);
        });

        it('refuses an inverted plan even when the market fetch failed', async () => {
            // The shape is plan-local. An unavailable tape is a reason to stand
            // the bands down, never a reason to present levels that contradict
            // each other.
            mockFetch.mockResolvedValue(null);
            const gate = await runGateScan(proposal({ entry: 100, stopLoss: 105, takeProfits: [110] }), []);
            expect(gate.status).toBe('unavailable');
            expect(gate.refusal).toMatch(/levels are inverted for a Long plan/);
        });

        it('refuses an inverted Short for the mirrored reason', async () => {
            const gate = await runGateScan(proposal({ direction: 'Short', entry: 100, stopLoss: 95, takeProfits: [110] }), []);
            expect(gate.refusal).toMatch(/levels are inverted for a Short plan — a Short risks with the stop above the entry/);
        });
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
