/**
 * Per-debate protocol isolation + consumer-abandonment cleanup.
 *
 * Covers the 2026-09-15 audit fixes in ensembleService:
 *  - the protocol lane is a PER-DEBATE local (seed consumed FIFO from the
 *    legacy side channel, or passed via opts.protocolSeed) and the legacy
 *    getLastDebateProtocol() global is published when a debate COMPLETES —
 *    concurrent debates can no longer cross-assign lanes / mislabel
 *    promptVersion attribution;
 *  - the seed is hashed from the setup identity ALONE — no epoch-time
 *    bucket, so the same setup never changes lanes an hour later;
 *  - a consumer breaking out of the debate's for-await loop mid-rebuttal
 *    aborts the still-running seat streams (verified via the signal handed
 *    to the transport).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { TradeAnalysis } from '../types';
import type { ProviderConfig } from '../types/provider';

// Mock the transport layer so the debate generator runs with scripted
// chunks and NO network/SDK calls (same seam as tests/debateFlow.test.ts).
const { streamMock, sendMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
    sendMock: vi.fn() as Mock<(...args: any[]) => Promise<any>>,
}));

vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: ((...args: any[]) => streamMock(...args)) as any,
    sendChatRequest: ((...args: any[]) => sendMock(...args)) as any,
    sendChatTurn: (async () => ({
        text: '',
        reasoning: '',
        toolCalls: [],
        assistantMessage: { role: 'assistant', content: '' },
    })) as any,
    warmProviderConnection: vi.fn(),
}));

import {
    conductRealDebate,
    assignDebateProtocol,
    setProtocolSeed,
    getLastDebateProtocol,
    type DebateProtocol,
    type RealDebateTurnEvent,
} from '../services/providers/ensembleService';

const config: ProviderConfig = {
    id: 'prov-a',
    name: 'Provider A',
    apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: true,
    models: ['model-a'],
    selectedModel: 'model-a',
};

const analysis: TradeAnalysis = {
    coinName: 'BTCUSDT',
    direction: 'Long',
    tradeType: 'swing',
    confidence: 'High',
    probability: 75,
    grade: 'B',
    strategy: 'Trend continuation',
    activeStrategies: ['Momentum Trading'],
    entryPoints: [{ description: 'Key support retest', price: '95000' }],
    stopLoss: '94500',
    takeProfit: [{ price: '96000', percentage: '2%' }, { price: '97000', percentage: '4%' }],
    marketConditions: {
        pattern: 'Bull Flag',
        candleBehavior: 'Higher lows forming',
        timeframeAlignment: '3 of 4 bullish',
        rsi: '55',
        macd: 'Bullish crossover',
        sentiment: 'Neutral',
        prices: { '5m': '95100', '15m': '95050', '1h': '95000', '4h': '94800' },
    },
    historicalCorrelation: 'Similar to previous winning setups',
    validityDurationMinutes: 330,
};

const MARKDOWN_PLAN = `**FINAL TRADE PLAN**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Entry:** 95000 — Support retest
- **Stop Loss:** 94500
- **Take Profit 1:** 96000 (2%)
- **Take Profit 2:** 97000 (4%)
- **Confidence:** Medium
- **Probability:** 60%
- **Strategy:** Trend continuation`;

const realAnalyst = (id: string, name: string, model: string) => ({
    provider: {
        config: { ...config, id, name, models: [model], selectedModel: model },
        name,
        model,
        thoughtsKey: `${id}:${model}`,
    },
    result: {
        thoughtProcess: `${name} internal thinking`,
        finalOutput: `${name} opening statement: long bias on breakout.`,
        analysis: name === 'Analyst Two' ? { ...analysis, confidence: 'Medium' as const } : analysis,
    },
});

const twoAnalysts = () => [realAnalyst('prov-a', 'Analyst One', 'model-a'), realAnalyst('prov-b', 'Analyst Two', 'model-b')];

const isFloorSeat = (system: string, name: string): boolean =>
    system.includes(`**FLOOR SEAT:** ${name}`);

/** Full-coverage transport mock (rebuttals, clarification, moderator
 *  charge + verdict) — same script branches as tests/debateFlow.test.ts. */
function mockStreams(seatSignals?: AbortSignal[]) {
    streamMock.mockImplementation(async function* (...args: any[]) {
        const messages = args[1] as { role: string; content: string }[];
        const system = messages[0].content;
        const user = messages[1].content;
        const options = args[2] as { signal?: AbortSignal } | undefined;
        const isRebuttal = user.includes('Respond now with your rebuttal');
        if (isRebuttal && seatSignals) seatSignals.push(options?.signal as AbortSignal);
        if (system.includes('CLARIFICATION ANSWER')) {
            yield `**${isFloorSeat(system, 'Analyst One') ? 'Analyst One' : 'Analyst Two'}:** exact clarification answer`;
        } else if (user.includes('CLARIFICATION JUDGMENT')) {
            yield '<CLARIFICATION_SATISFIED>';
        } else if (user.includes('CLARIFICATION ROUND')) {
            yield '<CLARIFICATION_DONE>';
        } else if (user.includes('Master Strategist routing a debate between analysts')) {
            // Moderator charge call — yields nothing (unrouted rebuttals).
        } else if (system.includes('debate moderator')) {
            yield 'Verdict: Long on breakout with tight stop.\n';
            yield '</DEBATE_END>\n';
            yield MARKDOWN_PLAN;
        } else if (isRebuttal) {
            // Every rebuttal carries a conviction line so the final-round
            // retry seam never fires and the drain stays deterministic.
            yield `rebuttal-${isFloorSeat(system, 'Analyst One') ? 'one' : 'two'} CONVICTION: ${isFloorSeat(system, 'Analyst One') ? 70 : 40}`;
            if (seatSignals) {
                // Stall until the abandon-guard aborts us; if nothing ever
                // aborts (regression), fail loudly instead of hanging.
                await new Promise<void>((resolve, reject) => {
                    const sig = options?.signal;
                    const onAbort = (): void => reject(new DOMException('The operation was aborted.', 'AbortError'));
                    if (sig?.aborted) { onAbort(); return; }
                    const timer = setTimeout(() => reject(new Error('seat stream was never aborted on abandon')), 5000);
                    sig?.addEventListener('abort', () => { clearTimeout(timer); onAbort(); }, { once: true });
                });
            }
        } else {
            yield 'ok';
        }
    });
}

/** conductRealDebate positional args with the trailing `opts` bag at 38. */
function debateArgs(analysts: ReturnType<typeof twoAnalysts>, opts?: Record<string, unknown>): any[] {
    const base: any[] = [analysts, 'Analyze BTCUSDT', null, config, 'model-a'];
    while (base.length < 37) base.push(undefined);
    base[37] = opts;
    return base;
}

/** Positional escape hatch: the real signature is a ~38-parameter chain;
 *  tests spread the padded tuple built by debateArgs(). */
const conduct = conductRealDebate as unknown as (
    ...args: any[]
) => AsyncGenerator<RealDebateTurnEvent, void, unknown>;

async function collectEvents(gen: AsyncGenerator<RealDebateTurnEvent>): Promise<RealDebateTurnEvent[]> {
    const events: RealDebateTurnEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
}

const laneOf = (seed: string): DebateProtocol => assignDebateProtocol(0.2, seed);

describe('debate protocol — seed derivation', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('is stable across repeated calls with the same setup identity', () => {
        const seed = 'BTCUSDT|Analyze this breakout|Provider A,Provider B';
        const first = laneOf(seed);
        for (let i = 0; i < 20; i++) expect(laneOf(seed)).toBe(first);
    });

    it('has NO time component — the same setup keeps its lane across epoch boundaries', () => {
        vi.useFakeTimers({ now: new Date('2026-09-15T10:00:00Z').getTime() });
        const seed = 'ETHUSDT|momentum|Provider A';
        const atStart = laneOf(seed);
        // The old hash mixed Math.floor(Date.now() / 1h): cross 24 hours and
        // the same setup would have flipped lanes. It must not anymore.
        vi.setSystemTime(new Date('2026-09-16T10:00:00Z').getTime());
        expect(laneOf(seed)).toBe(atStart);
        vi.setSystemTime(new Date('2027-01-01T00:00:00Z').getTime());
        expect(laneOf(seed)).toBe(atStart);
    });

    it('is deterministic but not constant — different setups spread across lanes', () => {
        const lanes = new Set<DebateProtocol>();
        for (let i = 0; i < 200; i++) lanes.add(laneOf(`setup-${i}|prompt|roster`));
        expect(lanes.size).toBeGreaterThan(1);
    });

    it('assigns the control lane when unseeded', () => {
        expect(assignDebateProtocol()).toBe('standard');
        expect(assignDebateProtocol(0.2, '')).toBe('standard');
    });
});

describe('debate protocol — per-debate isolation', () => {
    beforeEach(() => {
        streamMock.mockReset();
        sendMock.mockReset();
    });

    it('two debates created while the legacy seed channel is overwritten still run THEIR OWN lanes', async () => {
        mockStreams();
        // Pick two seeds that actually hash to DIFFERENT lanes — if they
        // matched, the assertion below would be vacuous.
        let seedA = '';
        let seedB = '';
        for (let i = 0; i < 500 && !(seedA && seedB); i++) {
            const cand = `setup-${i}|Analyze BTCUSDT|Analyst One,Analyst Two`;
            if (!seedA) { seedA = cand; continue; }
            if (laneOf(cand) !== laneOf(seedA)) seedB = cand;
        }
        expect(seedB).toBeTruthy();
        const laneA = laneOf(seedA);
        const laneB = laneOf(seedB);

        // Pipeline-A sets its seed and creates its generator; BEFORE A is
        // first iterated, pipeline-B sets its own seed. The old module-global
        // seed would make BOTH debates hash B's identity.
        setProtocolSeed(seedA);
        const genA = conduct(...debateArgs(twoAnalysts()));
        setProtocolSeed(seedB);
        const genB = conduct(...debateArgs(twoAnalysts()));

        await collectEvents(genA);
        // The legacy runStats read happens AFTER A's stream ends: it must
        // show A's lane, not whichever debate hashed last.
        expect(getLastDebateProtocol()).toBe(laneA);

        await collectEvents(genB);
        expect(getLastDebateProtocol()).toBe(laneB);
    });

    it('opts.protocolSeed is used per debate and does NOT consume the legacy pending seed', async () => {
        mockStreams();
        let seedX = '';
        let seedY = '';
        for (let i = 1000; i < 1500 && !(seedX && seedY); i++) {
            const cand = `opts-setup-${i}|Analyze ETHUSDT|Analyst One,Analyst Two`;
            if (!seedX) { seedX = cand; continue; }
            if (laneOf(cand) !== laneOf(seedX)) seedY = cand;
        }
        expect(seedY).toBeTruthy();

        setProtocolSeed(seedX); // legacy pending — must stay untouched
        const gen = conduct(...debateArgs(twoAnalysts(), { protocolSeed: seedY }));
        await collectEvents(gen);
        expect(getLastDebateProtocol()).toBe(laneOf(seedY));

        // The next unseeded-opts debate now gets the still-pending seedX.
        const gen2 = conduct(...debateArgs(twoAnalysts()));
        await collectEvents(gen2);
        expect(getLastDebateProtocol()).toBe(laneOf(seedX));
    });
});

describe('debate generator — consumer abandonment', () => {
    beforeEach(() => {
        streamMock.mockReset();
        sendMock.mockReset();
    });

    it('breaking out of the for-await loop aborts the running seat streams', async () => {
        const seatSignals: AbortSignal[] = [];
        mockStreams(seatSignals);
        const gen = conduct(...debateArgs(twoAnalysts()));
        let seen = 0;
        for await (const _event of gen) {
            seen++;
            if (seen >= 3) break; // mid-rebuttal abandonment, no abort signal
        }
        // The break awaited the generator's return() → the pump finally ran.
        expect(seatSignals.length).toBeGreaterThan(0);
        expect(seatSignals.every(s => s.aborted)).toBe(true);
    });

    it('an abandoned debate still publishes its own protocol lane (no cross-mislabel)', async () => {
        const seatSignals: AbortSignal[] = [];
        mockStreams(seatSignals);
        const seed = 'abandon-setup|Analyze BTCUSDT|Analyst One,Analyst Two';
        setProtocolSeed(seed);
        const gen = conduct(...debateArgs(twoAnalysts()));
        let seen = 0;
        for await (const _event of gen) {
            seen++;
            if (seen >= 3) break;
        }
        expect(getLastDebateProtocol()).toBe(laneOf(seed));
    });
});
