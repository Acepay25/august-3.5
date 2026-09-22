/**
 * The repeat-call guard: a seat that re-asks for a payload it already has gets
 * a pointer instead of the bytes, so it spends its remaining rounds thinking
 * rather than re-fetching.
 *
 * The scope is deliberately narrow, and these tests exist to hold that scope:
 *   - only tools the RESULT CACHE already declares byte-stable inside its TTL
 *     take part, because for anything else a second call can legitimately
 *     return different data;
 *   - a STAMPED tool is excluded even though it caches, because its replay
 *     re-appends THIS call's live price — replacing it with a pointer would hide
 *     a price move, which is the one thing a seat re-checks for;
 *   - every tool_call still gets a reply, because a provider 400s the whole seat
 *     on a call with no matching result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderConfig } from '../types/provider';

// The transport is mocked even though this suite injects its own `sendTurn`:
// importing the real `GenericProviderService` at module load is what stalls the
// vitest worker before a single test runs.
vi.mock('../services/providers/GenericProviderService', () => ({
    streamChatRequest: vi.fn(),
    sendChatRequest: vi.fn(),
    sendChatTurn: vi.fn(),
}));

// Network/memory backends behind the desk tools — canned, no I/O.
vi.mock('../services/analysis/MarketDataService', () => ({
    extractSymbolFromPrompt: vi.fn(() => 'BTCUSDT'),
    normalizeSymbol: vi.fn((s: unknown) => (typeof s === 'string' && s ? s : 'BTCUSDT')),
    fetchMarketData: vi.fn(async () => ({ symbol: 'BTCUSDT', currentPrice: 100.5 })),
    fetchMarkIndex: vi.fn(async () => ({ markPrice: 100.4, indexPrice: 100.3, lastFundingRate: 0.0001, nextFundingTime: Date.now() + 3_600_000, available: true })),
    fetchFundingRate: vi.fn(async () => ({ fundingRate: 0.0001, nextFundingTime: Date.now() + 3_600_000, available: true })),
    fetchDerivativesData: vi.fn(async () => ({ openInterestValue: 2.9e8, available: true })),
    fetchOHLCV: vi.fn(async () => []),
    fetchOrderBookDepth: vi.fn(async () => ({
        bestBid: 100.4, bestAsk: 100.6, spread: 0.2, spreadPercent: 0.199,
        bids: [{ price: 100.4, qty: 10 }], asks: [{ price: 100.6, qty: 7 }],
        bidDepth: 1000, askDepth: 700, depthImbalance: 0.1,
        buyWalls: [], sellWalls: [], dominantSide: 'balanced', wallDistance: {}, available: true,
    })),
    fetchRecentLiquidations: vi.fn(async () => ({ recentEvents: [], available: true })),
    fetchPriceSnapshot: vi.fn(async () => ({ markPrice: 100.4, available: true })),
}));
vi.mock('../services/infrastructure/SessionService', () => ({
    getSessionContext: vi.fn(async () => 'Session: 12 closed trades, 3 open, day P&L -1.2%.'),
}));
vi.mock('../services/learning/MemoryRetrievalService', () => ({ handleRecallTool: vi.fn(async () => 'No relevant notebook memory.') }));
vi.mock('../services/learning/EvidencePackService', () => ({ computeSetupClusterStats: vi.fn(async () => null) }));
vi.mock('../services/analysis/CorrelationRiskService', () => ({ calculateCorrelationRisk: vi.fn(async () => 'n/a') }));
vi.mock('../services/tools/toolForge', () => ({
    executeForgedTool: vi.fn(async () => null),
    confirmedForgedToolDefinitions: vi.fn(() => []),
}));
// `get_market_packet` enriches through the hybrid feed (a dynamic import),
// which otherwise sits on a real network timeout and turns a 30ms case into a
// 15s one.
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(async () => ''),
}));

import { runDeskToolLoop, clearDeskToolCache, isRepeatGatedTool, MAX_DESK_TOOL_ROUNDS, TOOL_CACHE_TTL_MS } from '../services/analysis/DeskToolsService';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

interface Call { name: string; arguments: Record<string, unknown> }

/**
 * A seat that emits the given calls on each of its first rounds, then answers.
 *
 * The `assistantMessage` matters: the loop only pushes `role: 'tool'` replies
 * on the NATIVE path, and it pairs them against
 * `turn.assistantMessage.tool_calls` — a scripted turn without it silently drops
 * into the text-protocol shape and the test stops measuring what a real
 * provider sends.
 */
const scripted = (callsPerRound: Call[][], onRound?: (round: number) => void) => {
    let round = 0;
    return vi.fn(async () => {
        onRound?.(round);
        const calls = callsPerRound[round] ?? [];
        round += 1;
        const toolCalls = calls.map((c, i) => ({
            id: `call-${round}-${i}`, name: c.name, arguments: c.arguments,
        }));
        return {
            text: calls.length ? '' : 'Done — I have what I need.',
            reasoning: '',
            finishReason: 'stop' as const,
            truncated: false,
            toolCalls,
            assistantMessage: calls.length === 0 ? undefined : {
                role: 'assistant' as const,
                content: null,
                tool_calls: toolCalls.map(c => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                })),
            },
        };
    });
};

/**
 * Drive one loop. Returns the LOOP'S messages — `runDeskToolLoop` builds and
 * returns its own array rather than mutating the one passed in, so asserting on
 * the input is asserting on nothing.
 */
const runLoop = async (callsPerRound: Call[][], onRound?: (round: number) => void): Promise<{
    tool: string[]; asked: string[]; answered: string[]; text: string;
}> => {
    const result = await runDeskToolLoop({
        config,
        messages: [{ role: 'user', content: 'answer me' }],
        nativeTools: true,
        sendTurn: scripted(callsPerRound, onRound),
    });
    const messages = result.messages as unknown as Array<{
        role: string; content?: unknown; tool_call_id?: string;
        tool_calls?: Array<{ id: string }>;
    }>;
    const tool = messages
        .filter(m => m.role === 'tool')
        .map(m => String(m.content));
    return {
        tool,
        asked: messages.flatMap(m => (m.tool_calls ?? []).map(c => c.id)),
        answered: messages.filter(m => m.role === 'tool').map(m => String(m.tool_call_id)),
        text: result.finalText,
    };
};

/** A cached, un-stamped tool: a repeat is provably the same bytes. */const session = (extra: Record<string, unknown> = {}): Call =>
    ({ name: 'get_session_context', arguments: { ...extra } });
/** The harness's derivatives feed returns nothing usable, so this tool answers
 *  `DATA_UNAVAILABLE:` — which is exactly what the retry test needs. */
const broken = (): Call => ({ name: 'get_derivatives', arguments: { symbol: 'BTCUSDT' } });

describe('repeat-call guard', () => {
    it('gates only tools whose repeat is provably the same answer', () => {
        expect(isRepeatGatedTool('get_session_context')).toBe(true);
        // Cached, but every call re-appends THIS call's live mark price.
        expect(isRepeatGatedTool('get_market_packet')).toBe(false);
        expect(isRepeatGatedTool('get_all_timeframes')).toBe(false);
        // Its whole job is the did-it-move check.
        expect(isRepeatGatedTool('get_price_snapshot')).toBe(false);
        // Local state and writes must run every time, per the cache policy.
        expect(isRepeatGatedTool('read_memory')).toBe(false);
        expect(isRepeatGatedTool('mark_trade_levels')).toBe(false);
        // A model-authored recipe may be a POST. Its own cache is GET-only for
        // exactly that reason, and this gate runs before that cache is reached,
        // so gating it would hand back a success receipt for a write that never
        // happened. Re-running a read is the cheaper mistake.
        expect(isRepeatGatedTool('custom_rsi_div')).toBe(false);
    });

    it('answers a re-asked cacheable call with a pointer, not the payload', async () => {
        const { tool, text } = await runLoop([[session()], [session()]]);

        expect(tool).toHaveLength(2);
        // The first is the payload itself (the canned session feed renders as
        // `{}` here — what matters is that it is data, not the guard's note).
        expect(tool[0]).not.toMatch(/^ALREADY FETCHED/);
        expect(tool[1]).toMatch(/^ALREADY FETCHED/);
        // The pointer says what to do with the earlier result rather than
        // merely withholding, and it must not read as a failure — an error here
        // is what makes a seat try a third time.
        expect(tool[1]).toMatch(/not a failure/i);
        expect(tool[1]).toMatch(/get_session_context/);
        expect(text).toContain('Done');
    });

    it('names the age of what it replays', async () => {
        const { tool } = await runLoop([[session()], [session()]]);
        expect(tool[1]).toMatch(/ALREADY FETCHED[^\n]*\d+s ago/);
    });

    it('releases the gate once the cached bytes have expired', async () => {
        // The gate was scoped to the TURN while promising the CACHE's
        // guarantee. A multi-round debate outlives 30s, so a seat re-asking at
        // t=35s was told the data had not changed about a book that had since
        // expired — and it never reached the cache path that carries the age.
        const start = Date.now();
        let elapsed = 0;
        const now = vi.spyOn(Date, 'now').mockImplementation(() => start + elapsed);
        try {
            const { tool } = await runLoop(
                [[session()], [session()]],
                round => { if (round === 1) elapsed = TOOL_CACHE_TTL_MS + 5_000; },
            );
            expect(tool).toHaveLength(2);
            expect(tool[0]).not.toMatch(/^ALREADY FETCHED/);
            expect(tool[1]).not.toMatch(/^ALREADY FETCHED/);
        } finally {
            now.mockRestore();
        }
    });

    it('replies to every tool_call id it was asked for', async () => {
        const { asked, answered } = await runLoop([[session()], [session()]]);
        expect(asked.length).toBeGreaterThan(0);
        expect(answered).toEqual(asked);
    });

    /** A failed call is the case the guard must NOT catch: `DATA_UNAVAILABLE`
     *  usually means the exchange blinked for a second, and re-asking is the
     *  seat's only recovery path. Gating it would turn one bad second into a
     *  whole turn argued from nothing. */
    it('lets a failed call be retried', async () => {
        const { tool } = await runLoop([[broken()], [broken()]]);
        expect(tool[0]).toContain('DATA_UNAVAILABLE');
        expect(tool.some(t => /^ALREADY FETCHED/.test(t))).toBe(false);
    });

    it('treats different arguments as different calls', async () => {
        const { tool } = await runLoop([[session({ a: 1 })], [session({ a: 2 })]]);
        expect(tool.some(t => /^ALREADY FETCHED/.test(t))).toBe(false);
    });

    it('gates the repeats inside ONE round, not only across rounds', async () => {
        // Three identical calls in a single reply is the same waste, and the
        // seat gets one payload plus two pointers.
        const { tool } = await runLoop([[session(), session(), session()]]);
        expect(tool.filter(t => /^ALREADY FETCHED/.test(t))).toHaveLength(2);
        expect(tool.filter(t => !/^ALREADY FETCHED/.test(t))).toHaveLength(1);
    });

    it('does not carry the guard into a later turn', async () => {
        // A new turn's context does not contain the previous turn's payload, so
        // pointing at it would send the model looking for bytes it never got.
        const first = await runLoop([[session()]]);
        const second = await runLoop([[session()]]);
        expect(first.tool[0]).not.toMatch(/ALREADY FETCHED/);
        expect(second.tool[0]).not.toMatch(/ALREADY FETCHED/);
    });

    it('stays inside the round and per-round budgets', async () => {
        const many = Array.from({ length: 6 }, () => session());
        const { tool } = await runLoop([many, many, many, many]);
        expect(tool.length).toBeLessThanOrEqual(MAX_DESK_TOOL_ROUNDS * 3);
    });
});

beforeEach(() => {
    clearDeskToolCache();
});

