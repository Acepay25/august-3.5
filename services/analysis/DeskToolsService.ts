/**
 * Desk tools — live lookups analysts can call before writing the trade brief.
 * Uses existing market services + a keyless web search (DuckDuckGo).
 * Confirmed ToolForge tools (model-authored HTTP recipes, services/tools/
 * toolForge) merge into the same loop via their own hardened executor.
 */

import type { ProviderConfig } from '../../types/provider';
import { getHarnessSettings } from '../../utils/harnessSettings';
import { executeForgedTool, confirmedForgedToolDefinitions } from '../tools/toolForge';
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
import type { ToolAction } from '../../types/message';
import { DEBATE_MAIL_TOOLS, type DebateMailbox } from './DebateMailbox';

/**
 * Classify a desk-tool result into a persisted model side-effect (R54):
 * proposal tools (forge_tool / amend_memory) and custom_ tools become
 * ToolAction rows the transcript renders Hermes-style. Data lookups stay
 * out — they're reads, not changes. ok = the proposal was accepted as a
 * pending candidate; the reject text of both proposal tools starts with
 * `<tool> rejected:`.
 */
export const toolActionFromResult = (name: string, ok: boolean, content: string, speaker: string): ToolAction | null => {
    const isProposal = name === 'forge_tool' || name === 'amend_memory';
    const isCustom = name.startsWith('custom_');
    if (!isProposal && !isCustom) return null;
    const at = new Date().toISOString();
    if (!ok) {
        return { at, speaker, tool: name, ok: false, verb: name === 'forge_tool' ? 'proposed' : name === 'amend_memory' ? 'amended' : 'created', label: 'rejected', review: '' };
    }
    let label: string;
    let review = '';
    let verb = 'created';
    try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        if (name === 'forge_tool') {
            label = String(parsed.id ?? parsed.name ?? 'tool');
            review = 'Settings → AI Models';
            verb = 'proposed';
        } else if (name === 'amend_memory') {
            label = `notebook/${parsed.id ?? 'amendment'}`;
            review = 'Settings → Memory';
            verb = 'amended';
        } else {
            label = String(parsed.name ?? parsed.id ?? name);
        }
    } catch {
        // Non-JSON receipt — keep the generic label.
        label = name;
    }
    return { at, speaker, tool: name, ok: true, verb, label, review };
};

/** Proposals + custom tools, for the loop's per-result classification. */
const isActionableToolResult = (r: DeskToolResult): boolean =>
    r.name === 'forge_tool' || r.name === 'amend_memory' || r.name.startsWith('custom_');

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
    recall_chat: 'session search',
    send_message: 'direct message',
    read_message: 'read inbox',
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
    // recall_chat returns a plain-text digest, not JSON — summarize by length.
    if (name === 'recall_chat') {
        return content.startsWith('No matching') ? 'no past sessions matched' : `${Math.min(content.split('\n').length, 5)} past passages found`;
    }
    // Mail tools: receipts and inbox reads.
    if (name === 'send_message') {
        const to = content.match(/^Delivered to (.+?)\./)?.[1];
        return to ? `→ ${to}` : 'message not delivered';
    }
    if (name === 'read_message') {
        if (content.startsWith('Inbox empty')) return 'inbox empty';
        return `${content.split('From ').length - 1} direct message${content.split('From ').length - 1 === 1 ? '' : 's'} read`;
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
            name: 'amend_memory',
            description:
                'Propose a CORRECTION to an existing Trader Notebook file (not skills, not diary) when you know its content is wrong or outdated. ' +
                'Lands as a pending amendment a human must approve — the notebook does not change until then. ' +
                'Use write access sparingly; prefer this over writing a duplicate contradicting note.',
            parameters: {
                type: 'object',
                properties: {
                    file_name: { type: 'string', description: 'Exact notebook file name, e.g. "my-edge.md"' },
                    kind: { type: 'string', enum: ['edit', 'supersede'], description: 'edit = replace the whole file content; supersede = append a correcting section' },
                    proposed_content: { type: 'string', description: 'The corrected markdown content (edit) or the correcting section (supersede)' },
                    reason: { type: 'string', description: 'Why the current content is wrong — cite the evidence' },
                },
                required: ['file_name', 'kind', 'proposed_content', 'reason'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'forge_tool',
            description:
                'Propose a NEW desk tool for future debates when the tools you need do not exist. ' +
                'Declarative HTTP recipe only — never code. Provide: name (snake_case), description, ' +
                'parameters (name -> string|number|boolean), urlTemplate (https://, {param} slots), ' +
                'method (GET/POST), extractPath (dot path into the JSON response), ttlMs. ' +
                'The proposal lands as a CANDIDATE — a human must approve it before it can ever run.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'snake_case tool name, e.g. funding_history' },
                    description: { type: 'string', description: 'What it returns and when to use it' },
                    urlTemplate: { type: 'string', description: 'https:// URL template with {param} slots' },
                    parameters_json: { type: 'string', description: 'JSON object mapping param name -> "string"|"number"|"boolean"' },
                    extractPath: { type: 'string', description: 'Dot path to extract from the JSON response, e.g. data.result' },
                },
                required: ['name', 'description', 'urlTemplate', 'parameters_json'],
                additionalProperties: false,
            },
        },
    },
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
    {
        type: 'function',
        function: {
            name: 'recall_chat',
            description:
                'Search your past analysis sessions - prior debates, verdicts, and reasoning stored in this app. Use when the current setup resembles something discussed before ("we debated BTC shorts last week") or when prior conclusions could inform your stance. Returns matched excerpts with session titles and dates.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'What to look for, e.g. "BTC short fakeout", "funding squeeze ETH", "range high rejection".',
                    },
                },
                required: ['query'],
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
            case 'amend_memory': {
                // Model proposing a notebook correction. PENDING only — a
                // human approves in Settings → Memory; nothing is applied here.
                try {
                    const { proposeAmendment } = await import('../learning/memoryAmendments');
                    const { getMemoryFiles } = await import('../learning/MemoryFilesService');
                    const fileName = String(call.arguments.file_name ?? '').replace(/\.md$/i, '');
                    const target = getMemoryFiles().files.find(f => f.name.replace(/\.md$/i, '') === fileName) ?? null;
                    const amendment = proposeAmendment(
                        target?.id ?? '',
                        call.arguments.kind === 'supersede' ? 'supersede' : 'edit',
                        String(call.arguments.proposed_content ?? ''),
                        String(call.arguments.reason ?? ''),
                        'model:desk',
                        id => target && target.id === id ? target : null,
                    );
                    content = JSON.stringify({ proposed: true, id: amendment.id, status: amendment.status, note: 'Pending human approval in Settings → Memory. The notebook is unchanged until approved.' });
                } catch (err) {
                    content = `amend_memory rejected: ${err instanceof Error ? err.message : String(err)}`;
                }
                break;
            }
            case 'forge_tool': {
                // A model proposing a tool. Store as CANDIDATE — the proposal
                // never touches the network; approval is a human action.
                try {
                    const parsed = JSON.parse(String(call.arguments.parameters_json ?? '{}')) as Record<string, string>;
                    const { proposeForgedTool } = await import('../tools/toolForge');
                    const tool = proposeForgedTool({
                        name: String(call.arguments.name ?? ''),
                        description: String(call.arguments.description ?? ''),
                        urlTemplate: String(call.arguments.urlTemplate ?? ''),
                        parameters: Object.fromEntries(
                            Object.entries(parsed).map(([k, v]) => [k, (v === 'number' || v === 'boolean') ? v : 'string']),
                        ),
                        extractPath: call.arguments.extractPath ? String(call.arguments.extractPath) : undefined,
                    }, 'model:desk');
                    content = JSON.stringify({ proposed: true, id: tool.id, status: tool.status, note: 'Candidate stored. A human must approve it in Settings → AI Models before it can run.' });
                } catch (err) {
                    content = `forge_tool rejected: ${err instanceof Error ? err.message : String(err)}`;
                }
                break;
            }
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
            case 'recall_chat': {
                // Search past analysis sessions (stored conversations).
                const { searchChatHistory, formatChatHitsDigest } = await import('../infrastructure/sessionSearch');
                const query = asString(call.arguments.query);
                if (!query) {
                    content = JSON.stringify({ error: 'query is required' });
                    break;
                }
                const hits = await searchChatHistory(query, undefined, 5);
                content = formatChatHitsDigest(hits);
                break;
            }
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
 * Arbiter tool policy: the moderator's binding verdict is an
 * argument-quality decision, so its DEFAULT desk is memory + context only.
 * Order-book/derivatives data can outweigh argument quality and are opt-in
 * per call site; the clarification rounds inherit the same policy (W6).
 * Analysts keep their bot-role presets — this constrains the arbiter only.
 */
export const ARBITER_ALLOWED_TOOLS = [
    'recall',
    'recall_chat',
    'get_setup_history_stats',
    'get_session_context',
    'web_search',
    'forge_tool',
    'amend_memory',
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
    /** Additional tool definitions merged into the desk set (e.g. debate mail). */
    extraToolDefs?: DeskToolDefinition[];
    /** Dispatch for extra tools. Return null to fall through to executeDeskTools. */
    executeExtraTool?: (call: DeskToolCall) => Promise<DeskToolResult | null>;
    /** Deterministic instruction appended to the system prompt before turn 1
     *  (e.g. "you have unread direct messages — call read_message first"). */
    appendSystemNotice?: string;
    /** Round 0 forces `toolChoice:'required'` so the seat MUST
     *  ground itself with at least one real lookup before arguing — used by
     *  debates running WITHOUT live hybrid market data. */
    requireFirstToolRound?: boolean;
    /** R54: fires once per proposal/custom tool result so the caller can
     *  persist model side-effects (ToolAction rows) on the message. The
     *  action carries `speaker: ''` — the CALLER stamps the seat name
     *  (only the moderator path can default it here). */
    onToolAction?: (action: ToolAction) => void;
    /** Speaker label stamped on emitted ToolActions when the caller does
     *  not override (moderator path). Empty default — callers stamp. */
    speaker?: string;
}): Promise<DeskToolLoopResult> {
    const {
        config,
        sendTurn,
        options,
        defaultSymbol,
        onToolEvent,
        onToolAction,
        speaker = '',
        nativeTools = config.apiFormat === 'chat_completions',
        allowedTools,
        trades,
        extraToolDefs = [],
        executeExtraTool,
        appendSystemNotice,
        requireFirstToolRound = false,
    } = params;
    const messages = [...params.messages];
    // The inbox notice lands AFTER the desk-tools block inside the system
    // message — the last thing the seat reads before its turn.
    if (appendSystemNotice?.trim()) {
        const needle = appendSystemNotice.trim();
        const sysIdx = messages.findIndex(m => m.role === 'system');
        if (sysIdx >= 0) {
            const prev = messages[sysIdx].content;
            const prevText = typeof prev === 'string' ? prev : '';
            if (!prevText.includes(needle)) {
                messages[sysIdx] = { ...messages[sysIdx], content: `${prevText}\n\n${needle}` };
            }
        } else {
            messages.unshift({ role: 'system', content: needle });
        }
    }
    const usedTools: string[] = [];
    let finalText = '';
    let reasoning = '';

    for (let round = 0; round < MAX_DESK_TOOL_ROUNDS; round++) {
        const forgedDefs = confirmedForgedToolDefinitions();
        const allDefs = forgedDefs.length > 0
            ? (extraToolDefs.length > 0 ? [...DESK_TOOL_DEFINITIONS, ...forgedDefs, ...extraToolDefs] : [...DESK_TOOL_DEFINITIONS, ...forgedDefs])
            : (extraToolDefs.length > 0 ? [...DESK_TOOL_DEFINITIONS, ...extraToolDefs] : DESK_TOOL_DEFINITIONS);
        const effectiveTools = nativeTools
            ? (allowedTools && allowedTools.length > 0
                ? allDefs.filter(d => allowedTools.includes(d.function.name))
                : allDefs)
            : undefined;
        const turn = await sendTurn(config, messages, {
            ...options,
            tools: effectiveTools,
            // The FIRST round can force a tool call so a seat never argues
            // from zero data; later rounds stay 'auto' (the seat may stop).
            toolChoice: nativeTools
                ? (round === 0 && requireFirstToolRound && effectiveTools?.length ? 'required' : 'auto')
                : undefined,
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

        // Extra tools (debate mailbox) execute here — they touch orchestration
        // state and must not go through the pure market-data executor.
        const extraResults: DeskToolResult[] = [];
        const coreCalls: DeskToolCall[] = [];
        for (const call of calls) {
            if (executeExtraTool) {
                const handled = await executeExtraTool(call);
                if (handled) {
                    extraResults.push(handled);
                    continue;
                }
            }
            coreCalls.push(call);
        }
        onToolEvent?.(calls.map(c => `calling ${toolLabel(c.name)}…`).join(' · '));
        // Forged tools (model-authored recipes) execute through their own
        // hardened path BEFORE the built-in executor sees the calls.
        const forgedResults: DeskToolResult[] = [];
        const builtInCalls: DeskToolCall[] = [];
        for (const call of coreCalls) {
            if (!call.name.startsWith('custom_')) { builtInCalls.push(call); continue; }
            const forged = await executeForgedTool(call.name, call, options?.signal);
            if (forged) forgedResults.push(forged);
        }
        const coreResults = builtInCalls.length > 0
            ? await executeDeskTools(builtInCalls, {
                defaultSymbol,
                signal: options?.signal,
                trades,
            })
            : [];
        const results = [...extraResults, ...forgedResults, ...coreResults];
        usedTools.push(...results.map(r => r.name));
        onToolEvent?.(results.map(r => digestToolResult(r.name, r.ok, r.content)).join(' · '));
        // R54: persist proposal/custom tool side-effects (the transcript's
        // "Saved to memory"-style status rows). The loop does not know seat
        // names — the caller stamps them; the moderator path defaults here.
        if (onToolAction) {
            for (const r of results.filter(isActionableToolResult)) {
                const action = toolActionFromResult(r.name, r.ok, r.content, speaker);
                if (action) onToolAction(action);
            }
        }

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
    /** R54: fires once per proposal/custom tool result (forge_tool,
     *  amend_memory, custom_*) so the caller can persist ToolAction rows.
     *  Actions arrive with `speaker: ''` — stamp the seat name in the
     *  wrapper (streamChatWithDeskTools knows mailboxSeat / speaker). */
    onToolAction?: (action: ToolAction) => void;
    /** Debate mailbox: when present, the seat can send_message /
     *  read_message to other seats. The loop injects an inbox notice and
     *  reports deliveries back through `onMailSent`. */
    mailbox?: DebateMailbox;
    /** Display name of the seat whose turn this is (mailbox addressing). */
    mailboxSeat?: string;
    /** Current debate round (stamped on sent messages). */
    mailboxRound?: number;
    /** Fires once per successfully delivered message (for DM visibility lines). */
    onMailSent?: (info: { from: string; to: string; text: string; round: number }) => void;
    /** When true, round 0 forces one real tool lookup before
     *  the seat may speak — used for debates WITHOUT live hybrid market data
     *  so seats ground themselves in fresh data instead of arguing from zero. */
    requireFirstToolRound?: boolean;
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
        onToolAction,
        allowedTools,
        trades,
        mailbox,
        mailboxSeat,
        mailboxRound,
        onMailSent,
        requireFirstToolRound,
        ...chatOptions
    } = options || {};

    // Debate mailbox: merge the floor-messaging tools into the
    // desk set so a seat's turn can carry real send_message/read_message
    // tool calls alongside market lookups. Dispatch is handled inside the
    // loop below (executeDeskTools stays pure market/memory).
    const seatName = mailboxSeat || '';
    const mailActive = Boolean(mailbox && seatName);
    const mailToolDefs = mailActive ? DEBATE_MAIL_TOOLS : [];
    const mergedAllowed = mailActive && allowedTools && allowedTools.length > 0
        ? [...allowedTools, ...DEBATE_MAIL_TOOLS.map(t => t.function.name)]
        : undefined;
    // Discoverability: the capability block rides EVERY seat turn so models
    // learn they can DM; the inbox notice (unread count + read first)
    // appends only when mail is actually waiting.
    const appendSystemNotice = mailActive
        ? [
            '**FLOOR MESSAGING:** you can direct-message other seats with the send_message tool '
            + '(one recipient per message — use their exact seat name). '
            + 'Read waiting messages with read_message before speaking when told you have unread mail.',
            mailbox?.inboxNotice(seatName) || '',
        ].filter(Boolean).join('\n\n')
        : '';

    // Quiet until a real tool runs — a status banner via onReasoning made
    // empty-stream paths look non-empty and polluted Thinking cards.
    const loop = await runDeskToolLoop({
        config,
        messages: enriched,
        sendTurn: sendChatTurn,
        options: chatOptions,
        defaultSymbol,
        nativeTools,
        allowedTools: mergedAllowed,
        trades,
        requireFirstToolRound,
        extraToolDefs: mailToolDefs,
        executeExtraTool: async call => {
            if (!mailbox) return null;
            const name = call.name;
            const args = call.arguments || {};
            if (name === 'send_message') {
                // Deliver; the result text doubles as the model-visible receipt.
                const receipt = mailbox.send(seatName, mailboxRound ?? 0, {
                    to: args.to,
                    message: args.message,
                });
                const ok = !receipt.startsWith('send_message failed');
                if (ok) {
                    const toLabel = String(args.to ?? '').trim().replace(/^@/, '');
                    onMailSent?.({ from: seatName, to: toLabel, text: String(args.message ?? ''), round: mailboxRound ?? 0 });
                }
                return { toolCallId: call.id, name, ok, content: receipt };
            }
            if (name === 'read_message') {
                return { toolCallId: call.id, name, ok: true, content: mailbox.read(seatName) };
            }
            return null;
        },
        // Inbox + capability notice rides AFTER any desk-tools block so it is
        // always the most recent instruction the seat reads before its turn.
        appendSystemNotice,
        onToolAction,
        speaker: seatName,
        onToolEvent: line => {
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
