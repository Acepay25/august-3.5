/**
 * Desk tools — live lookups analysts can call before writing the trade brief.
 * Uses existing market services + a keyless web search (DuckDuckGo).
 */

import type { ProviderConfig } from '../../types/provider';
import { getHarnessSettings } from '../../utils/harnessSettings';
import type { ChatMessage, ChatRequestOptions } from '../providers/GenericProviderService';
import { sendChatTurn, streamChatRequest } from '../providers/GenericProviderService';
import { calculateCorrelationRisk } from './CorrelationRiskService';
import {
    extractSymbolFromPrompt,
    fetchDerivativesData,
    fetchFundingRate,
    fetchMarketData,
    fetchOHLCV,
    fetchOrderBookDepth,
    fetchRecentLiquidations,
    normalizeSymbol,
} from './MarketDataService';
import { getSessionContext } from '../infrastructure/SessionService';
import { handleRecallTool } from '../learning/MemoryRetrievalService';
import { computeSetupClusterStats } from '../learning/EvidencePackService';
import type { LoggedTrade } from '../../types';

export interface DeskToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, unknown>;
            required?: string[];
            additionalProperties?: boolean;
        };
    };
}

export interface DeskToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface DeskToolResult {
    toolCallId: string;
    name: string;
    ok: boolean;
    content: string;
}

export const MAX_DESK_TOOL_ROUNDS = 3;

/**
 * Per-run tool cache — every Floor seat gets the same desk tools, so a debate
 * can call get_price_snapshot / get_derivatives once per seat per turn. Market
 * data this fresh is identical for 30s; serve repeat calls from cache instead
 * of re-hitting the exchange (zero extra network calls, faster tool rounds).
 */
export const TOOL_CACHE_TTL_MS = 30_000;
const toolCache = new Map<string, { at: number; content: string }>();

const toolCacheKey = (call: DeskToolCall): string =>
    `${call.name}:${JSON.stringify(call.arguments ?? {}, Object.keys(call.arguments ?? {}).sort())}`;

export const clearDeskToolCache = (): void => {
    toolCache.clear();
};

/** Hard cap on one tool result's injected size — tool output goes into every
 *  subsequent prompt, so a runaway payload compounds across the whole debate. */
export const MAX_TOOL_CONTENT_CHARS = 2400;

/**
 * Tool-result budget: shrink the array fields models actually skim (walls,
 * liquidation events) to their top entries by size, then hard-cap the total.
 * Keeps the JSON shape intact so prompts that reference fields stay valid.
 */
export const budgetToolContent = (name: string, content: string): string => {
    let out = content;
    if (name === 'get_order_book' || name === 'get_liquidations') {
        try {
            const parsed = JSON.parse(out) as Record<string, unknown>;
            const topByUsd = (arr: unknown, n: number): unknown =>
                Array.isArray(arr)
                    ? [...arr]
                        .sort((a, b) => (Number((b as { usdValue?: unknown })?.usdValue) || 0) - (Number((a as { usdValue?: unknown })?.usdValue) || 0))
                        .slice(0, n)
                    : arr;
            if (name === 'get_order_book') {
                parsed.buyWalls = topByUsd(parsed.buyWalls, 5);
                parsed.sellWalls = topByUsd(parsed.sellWalls, 5);
            } else {
                parsed.recentEvents = Array.isArray(parsed.recentEvents) ? parsed.recentEvents.slice(0, 10) : parsed.recentEvents;
            }
            out = JSON.stringify(parsed, null, 2);
        } catch {
            // Not JSON (error text) — fall through to the char cap.
        }
    }
    if (out.length > MAX_TOOL_CONTENT_CHARS) {
        out = `${out.slice(0, MAX_TOOL_CONTENT_CHARS)}\n…[truncated]`;
    }
    return out;
};

/** Human-friendly tool labels for the live Floor chips. */
const TOOL_LABELS: Record<string, string> = {
    web_search: 'web search',
    get_derivatives: 'derivatives',
    get_order_book: 'order book',
    get_liquidations: 'liquidations',
    get_btc_context: 'BTC context',
    get_session_context: 'session',
    get_price_snapshot: 'price snapshot',
    recall: 'notebook recall',
    get_setup_history_stats: 'setup history',
};

export const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name.replace(/_/g, ' ');

/** One-line digest of a tool result for the Floor chip's done state. */
export const digestToolResult = (name: string, ok: boolean, content: string): string => {
    if (!ok) return `${toolLabel(name)} failed`;
    try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        if (name === 'get_order_book') {
            const top = (arr: unknown): { price?: unknown; usdValue?: unknown } | null =>
                Array.isArray(arr) && arr.length > 0
                    ? [...arr].sort((a, b) => (Number((b as { usdValue?: unknown })?.usdValue) || 0) - (Number((a as { usdValue?: unknown })?.usdValue) || 0))[0] as { price?: unknown; usdValue?: unknown }
                    : null;
            const buy = top(parsed.buyWalls);
            const sell = top(parsed.sellWalls);
            const fmt = (w: { price?: unknown; usdValue?: unknown } | null): string =>
                w ? `$${Math.round(Number(w.usdValue) / 1000)}k @ ${Number(w.price).toLocaleString()}` : '—';
            return `buy wall ${fmt(buy)} · sell wall ${fmt(sell)}`;
        }
        if (name === 'get_liquidations') {
            const events = Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [];
            const totalUsd = events.reduce((s, e) => s + (Number((e as { usdValue?: unknown })?.usdValue) || 0), 0);
            return `${events.length} recent events · $${Math.round(totalUsd / 1000)}k`;
        }
        if (name === 'get_derivatives') {
            const funding = parsed.fundingRate ?? parsed.funding;
            const oi = parsed.openInterest ?? parsed.openInterestUsd;
            const bits = [
                funding != null ? `funding ${Number(funding).toFixed(4)}` : '',
                oi != null ? `OI $${Math.round(Number(oi) / 1e6)}M` : '',
            ].filter(Boolean);
            return bits.length > 0 ? bits.join(' · ') : `${toolLabel(name)} ok`;
        }
        if (name === 'get_price_snapshot') {
            const price = parsed.lastPrice ?? parsed.price ?? parsed.close;
            return price != null ? `price ${Number(price).toLocaleString()}` : `${toolLabel(name)} ok`;
        }
        if (name === 'get_setup_history_stats') {
            const sample = typeof parsed.sample === 'number' ? parsed.sample : 0;
            if (sample <= 0) return 'setup history: no logged trades';
            const wr = typeof parsed.winRate === 'number' ? `${Math.round(parsed.winRate * 100)}% win` : '';
            return `setup history: ${parsed.wins}W/${parsed.losses}L${wr ? ` (${wr})` : ''}`;
        }
    } catch {
        // Not JSON — fall through to the generic line.
    }
    return `${toolLabel(name)} ok`;
};

const asString = (value: unknown, fallback = ''): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;

const asSymbol = (value: unknown, fallback: string): string => {
    const raw = asString(value, fallback) || fallback || 'BTCUSDT';
    try {
        return normalizeSymbol(raw);
    } catch {
        return raw.toUpperCase().endsWith('USDT') ? raw.toUpperCase() : `${raw.toUpperCase()}USDT`;
    }
};

export const DESK_TOOL_DEFINITIONS: DeskToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description:
                'Search the public web for crypto news, macro events (FOMC, CPI, NFP), exchange incidents, or coin-specific catalysts that could affect the trade.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Focused search query, e.g. "BTC ETF flows today" or "FOMC calendar this week".',
                    },
                },
                required: ['query'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_derivatives',
            description:
                'Live perpetual derivatives: funding rate, open interest, long/short ratios, taker buy/sell. Use before sizing or calling crowded trades.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Futures symbol, e.g. BTCUSDT or ETH.' },
                },
                required: ['symbol'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_order_book',
            description:
                'Order-book depth: bid/ask walls and liquidity imbalance near price. Use for entry/stop placement and sweep risk.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Futures symbol, e.g. BTCUSDT.' },
                },
                required: ['symbol'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_liquidations',
            description:
                'Recent forced liquidations for the symbol. Use to judge cascade risk / stop hunts.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Futures symbol, e.g. BTCUSDT.' },
                },
                required: ['symbol'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_btc_context',
            description:
                'BTC dominance, dominance trend, and whether BTC sits on a major level. Required before trading alts.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Alt symbol being traded (BTC itself returns dominance only).' },
                },
                required: ['symbol'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_session_context',
            description:
                'Current trading session, kill zones, weekend/weekly-close flags, and timing warnings. Call when session risk matters.',
            parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_price_snapshot',
            description:
                'Spot price + recent OHLCV summary for one timeframe. Use when hybrid data is missing a TF or you need a fresh print.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Futures symbol, e.g. BTCUSDT.' },
                    interval: {
                        type: 'string',
                        enum: ['15m', '1h', '4h', '1d'],
                        description: 'Candle interval. Default 1h.',
                    },
                },
                required: ['symbol'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_setup_history_stats',
            description:
                'Your own logged track record for a setup type: sample size, win rate, average R, last outcome, worst lesson. Use to check a claim like "this setup usually fails" against the journal before asserting it.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Futures symbol, e.g. BTCUSDT or ETH.' },
                    direction: { type: 'string', enum: ['Long', 'Short', 'Neutral'], description: 'Trade direction to filter by.' },
                },
                required: ['symbol'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'recall',
            description:
                'Search your own trading notebook - lessons learned, IF/THEN rules, similar past trades, and your doctrine for a setup. Use when you suspect prior experience with this coin/setup or need your own loss history before arguing a stance.',
            parameters: {
                type: 'object',
                properties: {
                    topic: {
                        type: 'string',
                        description: 'Setup topic, e.g. "BTC long", "ETH short liquidity sweep".',
                    },
                },
                required: ['topic'],
                additionalProperties: false,
            },
        },
    },
];

export const DESK_TOOLS_PROMPT = `
**DESK TOOLS (available anytime on this turn)**
You can call live tools before you speak — opening analysis, rebuttal, clarification, or moderator verdict.
Use them for: news/macro catalysts, funding/OI crowding, order-book walls, liquidations, BTC context on alts, session timing, or a fresh price print.
Your own trading memory is one of these tools: the recall tool searches your notebook (doctrine, rules, similar past trades) - call it when prior experience with this setup could change your stance.
Do not call tools you do not need. Prefer 0–2 calls. After tool results arrive, write your Floor reply from the findings — no JSON, no restated tool schemas.
`;

/** Anthropic Messages API tool schema (from OpenAI-style defs). */
export const toAnthropicTools = (tools: DeskToolDefinition[] = DESK_TOOL_DEFINITIONS): unknown[] =>
    tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
    }));

const stripHtml = (html: string): string =>
    html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

async function runWebSearch(query: string, signal?: AbortSignal): Promise<string> {
    const q = query.trim();
    if (!q) return 'web_search error: empty query';

    const lines: string[] = [`Query: ${q}`];

    // Instant Answer API (keyless) — Abstract / RelatedTopics when present.
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
        const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
        if (res.ok) {
            const data = await res.json() as {
                AbstractText?: string;
                AbstractURL?: string;
                Heading?: string;
                RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
            };
            if (data.AbstractText) {
                lines.push(`Summary: ${data.AbstractText}`);
                if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
            }
            const related: string[] = [];
            for (const item of data.RelatedTopics || []) {
                if ('Text' in item && item.Text) {
                    related.push(`- ${item.Text}${item.FirstURL ? ` (${item.FirstURL})` : ''}`);
                } else if ('Topics' in item && Array.isArray(item.Topics)) {
                    for (const sub of item.Topics.slice(0, 3)) {
                        if (sub.Text) related.push(`- ${sub.Text}${sub.FirstURL ? ` (${sub.FirstURL})` : ''}`);
                    }
                }
                if (related.length >= 6) break;
            }
            if (related.length) {
                lines.push('Related:');
                lines.push(...related.slice(0, 6));
            }
        }
    } catch (e) {
        lines.push(`Instant Answer unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }

    // HTML lite scrape for headline-style results when Instant Answer is thin.
    if (lines.length < 3) {
        try {
            const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
            const res = await fetch(htmlUrl, {
                signal,
                headers: { Accept: 'text/html', 'User-Agent': 'AugustDesk/1.0' },
            });
            if (res.ok) {
                const html = await res.text();
                const results: string[] = [];
                const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
                let match: RegExpExecArray | null;
                while ((match = re.exec(html)) && results.length < 5) {
                    const href = match[1];
                    const title = stripHtml(match[2]);
                    if (title) results.push(`- ${title}${href ? ` | ${href}` : ''}`);
                }
                if (results.length) {
                    lines.push('Headlines:');
                    lines.push(...results);
                }
            }
        } catch (e) {
            lines.push(`Headline search unavailable: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (lines.length <= 1) {
        lines.push('No useful results. Proceed with chart data and note the search gap.');
    }
    return lines.join('\n');
}

async function runDerivatives(symbol: string, signal?: AbortSignal): Promise<string> {
    void signal;
    const [market, funding, derivatives] = await Promise.all([
        fetchMarketData(symbol),
        fetchFundingRate(symbol),
        fetchDerivativesData(symbol),
    ]);
    return JSON.stringify({
        symbol,
        price: market.currentPrice,
        change24hPct: market.priceChangePercent24h,
        fundingRate: funding,
        openInterest: derivatives.openInterest,
        openInterestValue: derivatives.openInterestValue,
        longShortRatio: derivatives.longShortRatio,
        topTraderRatio: derivatives.topTraderRatio,
        takerBuySell: derivatives.takerBuySell,
        overallSentiment: derivatives.overallSentiment,
        sentimentScore: derivatives.sentimentScore,
        checkedAt: new Date().toISOString(),
    }, null, 2);
}

async function runOrderBook(symbol: string): Promise<string> {
    const book = await fetchOrderBookDepth(symbol);
    return JSON.stringify(book, null, 2);
}

async function runLiquidations(symbol: string): Promise<string> {
    const liq = await fetchRecentLiquidations(symbol);
    return JSON.stringify(liq, null, 2);
}

async function runBtcContext(symbol: string): Promise<string> {
    const risk = await calculateCorrelationRisk(symbol);
    return JSON.stringify(risk, null, 2);
}

function runSession(): string {
    return JSON.stringify(getSessionContext(), null, 2);
}

async function runPriceSnapshot(symbol: string, interval: string): Promise<string> {
    const tf = (['15m', '1h', '4h', '1d'].includes(interval) ? interval : '1h') as '15m' | '1h' | '4h' | '1d';
    const [market, klines] = await Promise.all([
        fetchMarketData(symbol),
        fetchOHLCV(symbol, tf, 24),
    ]);
    const last = klines[klines.length - 1];
    const first = klines[0];
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    return JSON.stringify({
        symbol,
        interval: tf,
        price: market.currentPrice,
        change24hPct: market.priceChangePercent24h,
        window: {
            bars: klines.length,
            open: first?.open,
            close: last?.close,
            high: Math.max(...highs),
            low: Math.min(...lows),
            lastVolume: last?.volume,
        },
        checkedAt: new Date().toISOString(),
    }, null, 2);
}

export async function executeDeskTool(
    call: DeskToolCall,
    context: { defaultSymbol?: string | null; signal?: AbortSignal; trades?: LoggedTrade[] } = {},
): Promise<DeskToolResult> {
    const fallback = context.defaultSymbol || 'BTCUSDT';
    // Repeat calls within the TTL (every seat asks the same desk) are served
    // from cache — identical market data, zero extra network round-trips.
    const cacheKey = toolCacheKey(call);
    const cached = toolCache.get(cacheKey);
    if (cached && Date.now() - cached.at < TOOL_CACHE_TTL_MS) {
        return { toolCallId: call.id, name: call.name, ok: true, content: cached.content };
    }
    try {
        let content: string;
        switch (call.name) {
            case 'web_search':
                content = await runWebSearch(asString(call.arguments.query), context.signal);
                break;
            case 'get_derivatives':
                content = await runDerivatives(asSymbol(call.arguments.symbol, fallback), context.signal);
                break;
            case 'get_order_book':
                content = await runOrderBook(asSymbol(call.arguments.symbol, fallback));
                break;
            case 'get_liquidations':
                content = await runLiquidations(asSymbol(call.arguments.symbol, fallback));
                break;
            case 'get_btc_context':
                content = await runBtcContext(asSymbol(call.arguments.symbol, fallback));
                break;
            case 'get_session_context':
                content = runSession();
                break;
            case 'get_price_snapshot':
                content = await runPriceSnapshot(
                    asSymbol(call.arguments.symbol, fallback),
                    asString(call.arguments.interval, '1h'),
                );
                break;
            case 'recall':
                content = handleRecallTool(
                    { topic: asString(call.arguments.topic) },
                    context.trades,
                );
                break;
            case 'get_setup_history_stats': {
                const symRaw = asSymbol(call.arguments.symbol, fallback);
                const coin = symRaw.replace(/USDT?$/, '');
                const dirArg = asString(call.arguments.direction).toUpperCase();
                const direction: 'Long' | 'Short' | undefined = dirArg === 'LONG' ? 'Long' : dirArg === 'SHORT' ? 'Short' : undefined;
                const stats = computeSetupClusterStats(coin, direction, undefined, context.trades || []);
                content = JSON.stringify(stats
                    ? {
                        coin,
                        direction: direction ?? 'any',
                        sample: stats.sample,
                        wins: stats.wins,
                        losses: stats.losses,
                        winRate: stats.winRate !== null ? Math.round(stats.winRate * 100) / 100 : null,
                        avgR: stats.avgR !== null ? Math.round(stats.avgR * 100) / 100 : null,
                        lastOutcome: stats.lastOutcome,
                        lastDate: stats.lastDate ? stats.lastDate.slice(0, 10) : null,
                        worstLesson: stats.worstLesson,
                    }
                    : { coin, direction: direction ?? 'any', sample: 0, note: `No closed trades logged for ${coin}${direction ? ` ${direction}` : ''}.` }, null, 2);
                break;
            }
            default:
                content = `Unknown tool: ${call.name}`;
                return { toolCallId: call.id, name: call.name, ok: false, content };
        }
        content = budgetToolContent(call.name, content);
        toolCache.set(cacheKey, { at: Date.now(), content });
        return { toolCallId: call.id, name: call.name, ok: true, content };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            toolCallId: call.id,
            name: call.name,
            ok: false,
            content: `Tool ${call.name} failed: ${message}`,
        };
    }
}

export async function executeDeskTools(
    calls: DeskToolCall[],
    context: { defaultSymbol?: string | null; signal?: AbortSignal; trades?: LoggedTrade[] } = {},
): Promise<DeskToolResult[]> {
    return Promise.all(calls.map(call => executeDeskTool(call, context)));
}

/**
 * Arbiter tool policy (ROUND-28/D0.2): the moderator's binding verdict is an
 * argument-quality decision, so its DEFAULT desk is memory + context only.
 * Order-book/derivatives data can outweigh argument quality and are opt-in
 * per call site; the clarification rounds inherit the same policy (W6).
 * Analysts keep their bot-role presets — this constrains the arbiter only.
 */
export const ARBITER_ALLOWED_TOOLS = [
    'recall',
    'get_setup_history_stats',
    'get_session_context',
    'web_search',
] as const;

/** Parse OpenAI-style tool_calls from a chat message. */
export function parseOpenAIToolCalls(message: unknown): DeskToolCall[] {
    const msg = message as { tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } | null;
    if (!msg?.tool_calls?.length) return [];
    return msg.tool_calls.map((tc, i) => {
        let args: Record<string, unknown>;
        try {
            args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
            args = { raw: tc.function?.arguments || '' };
        }
        return {
            id: tc.id || `call_${i}`,
            name: tc.function?.name || '',
            arguments: args && typeof args === 'object' ? args : {},
        };
    }).filter(c => c.name);
}

/** Parse Anthropic tool_use content blocks. */
export function parseAnthropicToolCalls(content: unknown): DeskToolCall[] {
    if (!Array.isArray(content)) return [];
    return content
        .filter((block: any) => block?.type === 'tool_use' && typeof block?.name === 'string')
        .map((block: any, i: number) => ({
            id: typeof block.id === 'string' ? block.id : `toolu_${i}`,
            name: block.name as string,
            arguments: block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {},
        }));
}

/**
 * Text-protocol fallback for formats without native tools.
 * `<tool_call name="web_search">{"query":"..."}</tool_call>`
 */
export function parseTextToolCalls(text: string): DeskToolCall[] {
    if (!text) return [];
    const calls: DeskToolCall[] = [];
    const re = /<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/gi;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = re.exec(text)) && calls.length < 4) {
        let args: Record<string, unknown>;
        const raw = match[2].trim();
        try {
            args = raw ? JSON.parse(raw) : {};
        } catch {
            args = { query: raw };
        }
        calls.push({
            id: `text_${i++}`,
            name: match[1],
            arguments: args && typeof args === 'object' ? args : {},
        });
    }
    return calls;
}

export function stripTextToolCalls(text: string): string {
    return text.replace(/<tool_call\s+name=["'][^"']+["']\s*>[\s\S]*?<\/tool_call>/gi, '').trim();
}

export function formatToolResultsForModel(results: DeskToolResult[]): string {
    return results.map(r =>
        `### TOOL RESULT: ${r.name} (${r.ok ? 'ok' : 'error'})\n${r.content}`
    ).join('\n\n');
}

export const resolveDefaultSymbol = (...texts: Array<string | null | undefined>): string | null => {
    for (const text of texts) {
        if (!text) continue;
        const hit = extractSymbolFromPrompt(text);
        if (hit) return hit;
    }
    return null;
};

export const TEXT_TOOL_FALLBACK_PROMPT = `
If native function calling is unavailable, request a tool by emitting exactly:
<tool_call name="TOOL_NAME">{"arg":"value"}</tool_call>
Then wait for TOOL RESULT blocks before the public reply. Never invent tool results.
`;

export interface DeskToolLoopResult {
    messages: import('../providers/GenericProviderService').ChatMessage[];
    finalText: string;
    reasoning: string;
    usedTools: string[];
}

/**
 * Bounded tool loop before the final streamed analysis reply.
 * chat_completions: native tools. Other formats: text-protocol tags.
 */
export async function runDeskToolLoop(params: {
    config: import('../../types/provider').ProviderConfig;
    messages: import('../providers/GenericProviderService').ChatMessage[];
    sendTurn: (
        config: import('../../types/provider').ProviderConfig,
        messages: import('../providers/GenericProviderService').ChatMessage[],
        options?: import('../providers/GenericProviderService').ChatRequestOptions,
    ) => Promise<import('../providers/GenericProviderService').ChatTurnResult>;
    options?: import('../providers/GenericProviderService').ChatRequestOptions;
    defaultSymbol?: string | null;
    onToolEvent?: (line: string) => void;
    nativeTools?: boolean;
    allowedTools?: string[];
    trades?: LoggedTrade[];
}): Promise<DeskToolLoopResult> {
    const {
        config,
        sendTurn,
        options,
        defaultSymbol,
        onToolEvent,
        nativeTools = config.apiFormat === 'chat_completions',
        allowedTools,
        trades,
    } = params;
    const messages = [...params.messages];
    const usedTools: string[] = [];
    let finalText = '';
    let reasoning = '';

    for (let round = 0; round < MAX_DESK_TOOL_ROUNDS; round++) {
        const effectiveTools = nativeTools
            ? (allowedTools && allowedTools.length > 0
                ? DESK_TOOL_DEFINITIONS.filter(d => allowedTools.includes(d.function.name))
                : DESK_TOOL_DEFINITIONS)
            : undefined;
        const turn = await sendTurn(config, messages, {
            ...options,
            tools: effectiveTools,
            toolChoice: nativeTools ? 'auto' : undefined,
            // Tool rounds stay shorter than the final analysis stream.
            maxTokens: Math.min(options?.maxTokens ?? 4096, 4096),
        });
        reasoning = [reasoning, turn.reasoning].filter(Boolean).join('\n');
        finalText = turn.text || '';

        let calls = turn.toolCalls.length
            ? turn.toolCalls.map(c => ({
                id: c.id,
                name: c.name,
                arguments: c.arguments,
            }))
            : parseTextToolCalls(turn.text);

        if (!calls.length) {
            return {
                messages,
                finalText: stripTextToolCalls(finalText),
                reasoning,
                usedTools,
            };
        }

        // Cap parallel tools per round.
        calls = calls.slice(0, 3);
        onToolEvent?.(calls.map(c => `calling ${toolLabel(c.name)}…`).join(' · '));
        const results = await executeDeskTools(calls, {
            defaultSymbol,
            signal: options?.signal,
            trades,
        });
        usedTools.push(...results.map(r => r.name));
        onToolEvent?.(results.map(r => digestToolResult(r.name, r.ok, r.content)).join(' · '));

        if (nativeTools && turn.assistantMessage?.tool_calls?.length) {
            messages.push(turn.assistantMessage);
            for (const result of results) {
                messages.push({
                    role: 'tool',
                    tool_call_id: result.toolCallId,
                    content: result.content,
                });
            }
        } else {
            // Text protocol: keep the assistant text (minus tags) and inject results as user context.
            const cleaned = stripTextToolCalls(turn.text);
            if (cleaned) messages.push({ role: 'assistant', content: cleaned });
            messages.push({
                role: 'user',
                content: `${formatToolResultsForModel(results)}\n\nContinue. If you have enough, write the public Floor reply now.`,
            });
        }
    }

    return { messages, finalText: stripTextToolCalls(finalText), reasoning, usedTools };
}

export interface StreamWithDeskToolsOptions extends ChatRequestOptions {
    defaultSymbol?: string | null;
    /** Override harness setting. Default: follow Settings → Desk Tools. */
    enabled?: boolean;
    /** Final-turn nudge after tools ran. */
    afterToolsNudge?: string;
    /** Live tool-call visibility (Floor chips) — fires before and after each
     *  tool round with a short human-readable line. */
    onToolEvent?: (line: string) => void;
    allowedTools?: string[];
    /** Closed-trade log for the `recall` notebook tool. */
    trades?: LoggedTrade[];
}

function withDeskToolsSystemPrompt(messages: ChatMessage[], nativeTools: boolean): ChatMessage[] {
    const block = `${DESK_TOOLS_PROMPT}${nativeTools ? '' : TEXT_TOOL_FALLBACK_PROMPT}`;
    const out = messages.map(m => ({ ...m }));
    const sysIdx = out.findIndex(m => m.role === 'system');
    if (sysIdx >= 0) {
        const prev = out[sysIdx].content;
        const prevText = typeof prev === 'string' ? prev : '';
        if (!prevText.includes('DESK TOOLS')) {
            out[sysIdx] = {
                ...out[sysIdx],
                content: `${prevText}\n\n${block}`.trim(),
            };
        }
        return out;
    }
    return [{ role: 'system', content: block }, ...out];
}

/**
 * Stream a chat reply with an optional bounded desk-tool loop first.
 * Used by analysis, debate rebuttals/clarifications, and moderator turns
 * so every seat can look up live data anytime Desk Tools is enabled.
 */
export async function* streamChatWithDeskTools(
    config: ProviderConfig,
    messages: ChatMessage[],
    options?: StreamWithDeskToolsOptions,
): AsyncGenerator<string, void, unknown> {
    const enabled = options?.enabled !== false && getHarnessSettings().deskToolsEnabled;
    if (!enabled) {
        yield* streamChatRequest(config, messages, options);
        return;
    }

    const nativeTools = config.apiFormat === 'chat_completions';
    const enriched = withDeskToolsSystemPrompt(messages, nativeTools);
    const {
        defaultSymbol,
        afterToolsNudge,
        enabled: _enabled,
        onToolEvent,
        allowedTools,
        trades,
        ...chatOptions
    } = options || {};

    // Quiet until a real tool runs — a status banner via onReasoning made
    // empty-stream paths look non-empty and polluted Thinking cards.
    const loop = await runDeskToolLoop({
        config,
        messages: enriched,
        sendTurn: sendChatTurn,
        options: chatOptions,
        defaultSymbol,
        nativeTools,
        allowedTools,
        trades,
        onToolEvent: (line) => {
            onToolEvent?.(line);
            options?.onReasoning?.(`\n[Desk tools] ${line}\n`);
        },
    });

    if (loop.usedTools.length === 0 && loop.finalText.trim()) {
        yield loop.finalText;
        return;
    }

    const finalMessages = [...loop.messages];
    if (loop.usedTools.length > 0) {
        finalMessages.push({
            role: 'user',
            content: afterToolsNudge
                || 'Tool results are above. Continue your Floor turn now from the findings. No JSON, no tool tags.',
        });
    }
    yield* streamChatRequest(config, finalMessages, chatOptions);
}
