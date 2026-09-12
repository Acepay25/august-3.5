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
    fetchMarkIndex,
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
import type { ChartDrawing } from '../trade/chartDrawings';
import { DEBATE_MAIL_TOOLS, type DebateMailbox } from './DebateMailbox';

/**
 * Classify a desk-tool result into a persisted model side-effect:
 * proposal tools (forge_tool / amend_memory) and custom_ tools become
 * ToolAction rows the transcript renders Hermes-style. Data lookups stay
 * out — they're reads, not changes. ok = the proposal was accepted as a
 * pending candidate; the reject text of both proposal tools starts with
 * `<tool> rejected:`.
 */
export const toolActionFromResult = (name: string, ok: boolean, content: string, speaker: string): ToolAction | null => {
    const isProposal = name === 'forge_tool' || name === 'amend_memory' || name === 'propose_skill' || name === 'revise_skill' || name === 'write_memory_note'
        || name === 'remember' || name === 'forget';
    const isCustom = name.startsWith('custom_');
    if (!isProposal && !isCustom) return null;
    const at = new Date().toISOString();
    const verbFor = (tool: string): string => (tool === 'forge_tool' || tool === 'propose_skill' || tool === 'revise_skill' ? 'proposed' : tool === 'amend_memory' ? 'amended' : tool === 'forget' ? 'removed' : tool === 'remember' ? 'saved' : 'created');
    if (!ok) {
        return { at, speaker, tool: name, ok: false, verb: verbFor(name), label: 'rejected', review: '' };
    }
    let label: string;
    let review = '';
    let verb = verbFor(name);
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
        } else if (name === 'propose_skill') {
            label = String(parsed.skill ?? 'skill');
            review = 'the Coach inbox';
        } else if (name === 'revise_skill') {
            label = String(parsed.skill ?? 'skill');
            review = 'Settings → Skills';
        } else if (name === 'write_memory_note') {
            label = String(parsed.file ?? 'note');
            review = 'Settings → Memory';
        } else if (name === 'remember') {
            label = `${parsed.kind ?? 'memory'}/${parsed.slug ?? 'entry'}`;
            review = 'your memory index';
        } else if (name === 'forget') {
            label = String(parsed.slug ?? 'entry');
            review = 'your memory index';
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
    r.name === 'forge_tool' || r.name === 'amend_memory' || r.name === 'propose_skill' || r.name === 'revise_skill' || r.name === 'write_memory_note'
    || r.name === 'remember' || r.name === 'forget'
    || r.name.startsWith('custom_');

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

/** Machine-readable "the source failed" sentinel. A failed fetch must reach
 *  the model as UNKNOWN — prose like "no results" reads as evidence of
 *  absence ("there is no news"), which is a fabricated conclusion built on an
 *  outage. Never cache a sentinel; it would freeze an outage into the TTL. */
export const DATA_UNAVAILABLE_PREFIX = 'DATA_UNAVAILABLE:';
const dataUnavailable = (tool: string, reason: string): string =>
    `${DATA_UNAVAILABLE_PREFIX} ${tool} — ${reason}. The source FAILED; treat this as UNKNOWN, not as absence of evidence.`;
export const isDataUnavailable = (content: string): boolean => content.startsWith(DATA_UNAVAILABLE_PREFIX);

const toolCacheKey = (call: DeskToolCall): string =>
    `${call.name}:${JSON.stringify(call.arguments ?? {}, Object.keys(call.arguments ?? {}).sort())}`;

/** Stateful memory tools bypass the result cache: a `remember` must be
 *  visible to the next `read_memory`, and re-issuing a write must actually
 *  run (not replay a cached receipt). Scoped to the collaboration-memory
 *  trio; pre-existing tools keep their current caching. */
const NON_CACHEABLE_TOOLS = new Set(['remember', 'read_memory', 'forget']);

export const clearDeskToolCache = (): void => {
    toolCache.clear();
};

/** Hard cap on one tool result's injected size — tool output goes into every
 *  subsequent prompt, so a runaway payload compounds across the whole debate.
 *  Multi-timeframe compendiums get their own (larger) budgets. */
export const MAX_TOOL_CONTENT_CHARS = 2400;

/** Per-tool result budgets — the compendium tools legitimately carry more. */
const TOOL_BUDGETS: Record<string, number> = {
    get_market_packet: 6000,
    get_all_timeframes: 8000,
};

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
    const cap = TOOL_BUDGETS[name] ?? MAX_TOOL_CONTENT_CHARS;
    if (out.length > cap) {
        out = `${out.slice(0, cap)}\n…[truncated]`;
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
    get_market_packet: 'hybrid packet',
    get_all_timeframes: 'all-timeframe compendium',
    get_chart_view: 'chart view',
    draw_on_chart: 'chart draw',
    mark_trade_levels: 'level marks',
    clear_chart_drawings: 'chart clear',
    write_memory_note: 'memory note',
    get_notebook_map: 'notebook map',
    propose_skill: 'skill proposal',
    revise_skill: 'skill revision',
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
            name: 'write_memory_note',
            description:
                'Write or APPEND a durable lesson/knowledge note into your own Trader Notebook '
                + '(folder + file name you choose, markdown content). Use when the market just taught '
                + 'you something worth remembering across sessions — a repeatable pattern, a mistake to '
                + 'avoid, an invalidation rule. Never write into diary/distilled (harness-owned). '
                + 'This is a DIRECT write: it lands immediately in Settings → Memory.',
            parameters: {
                type: 'object',
                properties: {
                    folder: { type: 'string', description: 'Notebook folder, e.g. "lessons" or "market-conditions"' },
                    file_name: { type: 'string', description: 'File stem, e.g. "btc-funding-exhaustion" (no .md needed)' },
                    content: { type: 'string', description: 'Markdown content — a timeless statement, not a session log' },
                },
                required: ['folder', 'file_name', 'content'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_notebook_map',
            description:
                'Read the Trader Notebook map: every folder, every file with a short excerpt. Call this '
                + 'BEFORE writing or amending memory so you extend the right file instead of duplicating '
                + 'knowledge. Also lists existing skills with their status and hit-rate.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'remember',
            description:
                'Save a durable memory about THIS USER / the collaboration — the four kinds: "user" = who they are '
                + '(experience, risk appetite, instruments, routine); "feedback" = how they want you to work '
                + '(a correction or a confirmed approach — the body MUST end with **Why:** and **How to apply:**); '
                + '"project" = ongoing work/goals/constraints not derivable from the journal (use absolute dates); '
                + '"reference" = pointers (what "the vault" means, an external dashboard URL). One fact per entry. '
                + 'Check the memory index in your instructions FIRST: if a similar entry exists, pass its slug to '
                + 'UPDATE it rather than duplicating; do NOT store what the notebook/journal already records, and '
                + 'never store what only matters to this one conversation.',
            parameters: {
                type: 'object',
                properties: {
                    slug: { type: 'string', description: 'Existing entry slug to UPDATE, or omit to create (a kebab-case slug is derived from name).' },
                    name: { type: 'string', description: 'Short name for a new entry, e.g. "User runs 15m scalps".' },
                    kind: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'], description: 'Memory kind.' },
                    description: { type: 'string', description: 'One line (≤140 chars) stating WHEN this memory matters — it decides future relevance.' },
                    body: { type: 'string', description: 'The fact itself. feedback/project bodies end with **Why:** and **How to apply:** lines.' },
                },
                required: ['kind', 'description', 'body'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_memory',
            description:
                'Pull the FULL body of your user-memories by slug (the index only carries one-liners). Pass slug '
                + '"all" to list every entry with its body, or one or more slugs to read specific ones.',
            parameters: {
                type: 'object',
                properties: {
                    slugs: { type: 'array', items: { type: 'string' }, description: 'Entry slugs to read, or ["all"].' },
                },
                required: ['slugs'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'forget',
            description:
                'Delete a user-memory that turned out to be wrong or is no longer true. Stale memories are worse '
                + 'than none — delete, don\'t hedge.',
            parameters: {
                type: 'object',
                properties: {
                    slug: { type: 'string', description: 'The entry slug to delete.' },
                },
                required: ['slug'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'propose_skill',
            description:
                'Propose a NEW trading skill (an evidence-gated IF/THEN procedure). The proposal lands as a '
                + 'PENDING DRAFT a human approves in the Coach inbox — it does NOT enter the active skill '
                + 'library until approved. Use when you spot a repeatable edge the notebook has no skill for. '
                + 'Provide the full procedure: when it triggers, the steps, how to validate, the IF/THEN pair.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Short skill name, e.g. "Funding-exhaustions long"' },
                    kind: { type: 'string', enum: ['repeat', 'avoid'], description: 'repeat = an edge to take, avoid = a trap to dodge' },
                    coin: { type: 'string', description: 'Coin scope (e.g. BTC) or empty for any market' },
                    when: { type: 'string', description: 'The situation this skill triggers on (prose)' },
                    steps: { type: 'string', description: 'JSON array of the procedure steps' },
                    validate: { type: 'string', description: 'How to confirm the setup before acting' },
                    output: { type: 'string', description: 'What the skill produces (decision/level/size guidance)' },
                    approval: { type: 'string', description: 'What must be true for the skill to apply' },
                    if_condition: { type: 'string', description: 'The IF clause (one sentence, measurable)' },
                    then_action: { type: 'string', description: 'The THEN clause (one sentence, actionable)' },
                    reason: { type: 'string', description: 'Evidence from THIS session that motivates the skill' },
                },
                required: ['name', 'kind', 'when', 'steps', 'if_condition', 'then_action', 'reason'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'revise_skill',
            description:
                'Propose an IMPROVEMENT to an existing skill (narrow its trigger, sharpen its action, fix a '
                + 'wrong clause). The revision lands as a PENDING proposal a human approves — the live skill '
                + 'is untouched until then. Find skill slugs with get_notebook_map or the recall tool.',
            parameters: {
                type: 'object',
                properties: {
                    skill_slug: { type: 'string', description: 'The skill file slug, e.g. "btc-momentum-continuation"' },
                    if_condition: { type: 'string', description: 'The revised IF clause' },
                    then_action: { type: 'string', description: 'The revised THEN clause' },
                    reason: { type: 'string', description: 'Why the current clauses are wrong or blunted — cite evidence' },
                },
                required: ['skill_slug', 'reason'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'web_search',
            description:
                'Search the public web for crypto news, macro events (FOMC, CPI, NFP), exchange incidents, or coin-specific catalysts that could affect the trade. ' +
                'A result starting with DATA_UNAVAILABLE means the search itself failed — it is NOT evidence that no news exists.',
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
            name: 'get_market_packet',
            description:
                'Pull the FULL hybrid-intelligence packet for a symbol in one call: live price + 24h, code-calculated indicators across 15m/1h/4h/1d, regime + confluence, funding + derivatives sentiment, open interest, long/short + taker ratios, liquidation pressure, order-book walls, session, VWAP, Ichimoku, momentum, key levels, detected patterns and liquidity sweeps. Call it when you need everything the harness knows about a market at once instead of separate lookups.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Symbol to pull the packet for (default: the current chart symbol).' },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_all_timeframes',
            description:
                'The COMPLETE market compendium in one call — every timeframe at once plus the live microstructure: for 5m/15m/1h/4h/1d the last candles (OHLCV), trend vs EMA20/50, RSI, swing structure (HH/HL vs LH/LL) and named candle formations (engulfings, hammers, stars, dojis, inside bars, impulses); plus the order book (best bid/ask, spread, imbalance, walls), funding, open interest and recent liquidations. Call it when you want the full picture the user sees and more — every timeframe, every layer.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Symbol to pull (default: the current chart symbol).' },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_chart_view',
            description:
                'See everything displayed on the Trade chart RIGHT NOW: the chart timeframe, the last 60 candles (OHLCV, oldest→newest), the live mark price, the verdict levels drawn (Entry/Stop/TPs), the order book the user watches (best bid/ask, spread, depth walls) and any trendlines/zones the USER drew on the chart. Call it before answering "this chart", "this candle", "here", "my line" or "what do I see" questions.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Override symbol (default: the chart\'s current symbol).' },
                    interval: { type: 'string', description: 'Override timeframe, e.g. 15m or 1d (default: the chart\'s current interval).' },
                },
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
    {
        type: 'function',
        function: {
            name: 'scan_setups',
            description:
                'Run the strategy-book setup scanner against live candles: range breakouts/fades, pin bars, inside-bar resolutions, gap classes '
                + '(breakaway/runaway/exhaustion, filled or not), RSI divergences, Bollinger band plays, trend-pullback second entries and failed '
                + 'breakouts — each LIVE setup comes back with its evidence and the library skills that speak to it. Call this when the user asks '
                + 'whether anything is setting up, or before deciding a trade direction, so your read is grounded in what the tape actually shows.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Instrument (default: the chart symbol).' },
                    interval: { type: 'string', description: 'Timeframe, e.g. 15m (default: the chart\'s current interval).' },
                },
                additionalProperties: false,
            },
        },
    },
];

/**
 * Chart-action tools — everything the user can do on the trade chart, the
 * model can do too. These reach the model ONLY when the caller wires an
 * executor (executePanelTool): the Chart AI panel owns the live canvas, so
 * it dispatches the calls into TradeView's drawing state. Floor debates
 * without a chart never see them.
 */
export const CHART_ACTION_TOOL_DEFS: DeskToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'draw_on_chart',
            description:
                'Draw on the user\'s live chart — the same drawing tools the user has: horizontal line (level), trendline, ray, or supply/demand zone. Anchors are PRICES plus "bars ago" offsets from the newest candle (startBarsAgo is the OLDER anchor). The shape appears on the chart immediately and the user sees it.',
            parameters: {
                type: 'object',
                properties: {
                    kind: { type: 'string', description: 'hline | trend | ray | zone', enum: ['hline', 'trend', 'ray', 'zone'] },
                    prices: { type: 'array', items: { type: 'number' }, description: 'One price for hline; two prices (start→end) for trend/ray/zone.' },
                    startBarsAgo: { type: 'number', description: 'Bars back from now for the OLDER anchor (default 40).' },
                    endBarsAgo: { type: 'number', description: 'Bars back for the NEWER anchor (default 0 = now).' },
                    color: { type: 'string', description: 'emerald | rose | amber | sky | violet (default sky).', enum: ['emerald', 'rose', 'amber', 'sky', 'violet'] },
                    label: { type: 'string', description: 'Short label shown on the shape, e.g. "range high".' },
                },
                required: ['kind', 'prices'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'mark_trade_levels',
            description:
                'Mark a full trade plan on the chart: Entry (sky), Stop Loss (rose) and 1-5 Take Profits (amber) as labeled horizontal lines the user can see. Use this instead of three draw_on_chart calls when presenting a setup.',
            parameters: {
                type: 'object',
                properties: {
                    entry: { type: 'number', description: 'Entry price.' },
                    stopLoss: { type: 'number', description: 'Stop-loss price.' },
                    takeProfits: { type: 'array', items: { type: 'number' }, description: '1-5 TP prices, in order.' },
                },
                required: ['entry'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'clear_chart_drawings',
            description:
                'Clear drawings from the chart. scope "model" (default) removes only what the MODEL drew; scope "all" also wipes the USER\'S own drawings — only when the user explicitly asked to clear the chart.',
            parameters: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'model (default) | all', enum: ['model', 'all'] },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'present_trade',
            description:
                'Present a concrete, actionable trade to the user: draws the Entry/Stop/Targets on the chart AND shows a card with a "Log this trade" button. Use this when you have a specific setup you would put on — direction, entry, stop and at least one target are required. The user decides whether to log it; logging records it as an open trade that the harness later scores against the real outcome.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Instrument, e.g. BTCUSDT (default: the chart symbol).' },
                    direction: { type: 'string', enum: ['Long', 'Short'] },
                    entry: { type: 'number', description: 'Entry price.' },
                    stopLoss: { type: 'number', description: 'Stop-loss price (below entry for Long, above for Short).' },
                    takeProfits: { type: 'array', items: { type: 'number' }, description: '1-5 target prices, in order.' },
                    confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                    rationale: { type: 'string', description: 'One or two sentences: why this setup.' },
                    invalidation: { type: 'string', description: 'What would prove the idea wrong.' },
                },
                required: ['direction', 'entry', 'stopLoss', 'takeProfits'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'watch_price',
            description:
                'Arm a price WATCH on the harness: when the live mark price reaches the condition, the harness WAKES YOU with a [HARNESS TRIGGER] signal so you can re-read the chart live and alert the user whether it is ready to trade. Use whenever the user says "tell me when price hits X", "alert me on a reclaim of Y", or when YOU want to track a condition in real time instead of guessing it later. Fires once, then lapses.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Instrument, e.g. BTCUSDT (default: the chart symbol).' },
                    condition: { type: 'string', enum: ['above', 'below'], description: 'Trigger when the mark price is at/above (or at/below) the price.' },
                    price: { type: 'number', description: 'The watched price level.' },
                    note: { type: 'string', description: 'Why you armed it — quoted back in the fired signal ("breakout reclaim above range high").' },
                    expiresInMinutes: { type: 'number', description: 'Lapse deadline (default 720 = 12h).' },
                },
                required: ['condition', 'price'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'wake_me',
            description:
                'Schedule a TIME wake-up: the harness signals you at the set time so you can re-check the chart and report to the user ("check back in 30 minutes", "watch this breakout and update me at the session open"). Fires once at/after the deadline.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Instrument for the re-check context (default: the chart symbol).' },
                    inMinutes: { type: 'number', description: 'Wake in N minutes from now (≥1, max 7 days).' },
                    note: { type: 'string', description: 'What to check when you wake ("did the 5m breakout hold?").' },
                },
                required: ['inMinutes'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'cancel_watch',
            description:
                'Cancel armed price watches / wake-ups — by their ids (from the receipts and the [ARMED HARNESSES] context block), or all watches for the current symbol (omit ids). Use when the user says "stop watching that" or the reason changed.',
            parameters: {
                type: 'object',
                properties: {
                    ids: { type: 'array', items: { type: 'string' }, description: 'Watch ids to cancel.' },
                    allForSymbol: { type: 'boolean', description: 'true = cancel every watch armed on the given/current symbol.' },
                    symbol: { type: 'string', description: 'Symbol for allForSymbol (default: the chart symbol).' },
                },
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
        } else {
            lines.push(dataUnavailable('web_search:instant-answer', `HTTP ${res.status}`));
        }
    } catch (e) {
        lines.push(dataUnavailable('web_search:instant-answer', e instanceof Error ? e.message : String(e)));
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
            } else {
                lines.push(dataUnavailable('web_search:headlines', `HTTP ${res.status}`));
            }
        } catch (e) {
            lines.push(dataUnavailable('web_search:headlines', e instanceof Error ? e.message : String(e)));
        }
    }

    // Nothing but the query line survived (or every non-query line is itself
    // a failure sentinel) — collapse to ONE machine-readable sentinel rather
    // than a prose sentence a model can read as "there was no news".
    const substantive = lines.slice(1).filter(l => !isDataUnavailable(l));
    if (substantive.length === 0) {
        return dataUnavailable('web_search', `no reachable results for "${q}"`);
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

/** Timeframes the compendium covers, low → high. */
const ALL_TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'] as const;

/** Compact OHLCV row: "09-11 13:45 O77100 H77190 L77050 C77150 V312". */
const compactCandleRow = (k: { time: number; open: number; high: number; low: number; close: number; volume: number }): string => {
    const stamp = new Date(k.time).toISOString().slice(5, 16).replace('T', ' ');
    const r = (v: number): number => (v >= 1000 ? Math.round(v) : Number(v.toFixed(v >= 1 ? 2 : 4)));
    return `${stamp} O${r(k.open)} H${r(k.high)} L${r(k.low)} C${r(k.close)} V${Math.round(k.volume)}`;
};

/**
 * get_all_timeframes — the full compendium: per-timeframe candles, trend,
 * momentum, swing structure and named candle formations for 5m→1d, plus the
 * global microstructure layer (order book + spread, funding, OI,
 * liquidations). This is "everything the user can see and more" in one read.
 */
async function runAllTimeframes(symbol: string): Promise<string> {
    const { fetchKlines } = await import('./KlineService');
    const { calculateIndicators } = await import('./TechnicalAnalysisService');
    const { detectCandleFormations, describeMarketStructure } = await import('../trade/candleFormations');

    // Microstructure + derivatives once (they are timeframe-independent).
    const [book, mi, deriv, liq] = await Promise.all([
        fetchOrderBookDepth(symbol).catch(() => null),
        fetchMarkIndex(symbol).catch(() => null),
        fetchDerivativesData(symbol).catch(() => null),
        fetchRecentLiquidations(symbol).catch(() => null),
    ]);

    const head: string[] = [
        `ALL-TIMEFRAME COMPENDIUM — ${symbol} · fetched ${new Date().toISOString().slice(11, 19)} UTC`,
        mi && mi.available ? `Mark ${mi.markPrice} · Index ${mi.indexPrice} · Funding ${(mi.lastFundingRate * 100).toFixed(4)}%` : 'Mark/Index unavailable',
        deriv ? `Open interest $${Math.round((deriv.openInterestValue ?? 0) / 1e6)}M` : 'OI unavailable',
        liq && Array.isArray(liq.recentEvents) && liq.recentEvents.length > 0
            ? `Liquidations (${Math.min(liq.recentEvents.length, 5)} recent): ${(liq.recentEvents as Array<{ side?: string; price?: number; usdValue?: number }>).slice(0, 5).map(e => `${e.side ?? '?'} ${e.price ?? '?'}${
                e.usdValue ? `($${Math.round(e.usdValue / 1000)}k)` : ''
            }`).join(', ')}`
            : 'No recent liquidation events.',
    ];
    if (book) {
        head.push(`Order book: bid ${book.bestBid} / ask ${book.bestAsk} · spread ${book.spreadPercent.toFixed(3)}% · imbalance ${((book.depthImbalance ?? 0) * 100).toFixed(0)}% bid · dominant ${book.dominantSide}`);
        const wall = (w: { price: number; usdValue?: number } | undefined): string | null =>
            w ? `${w.price}${w.usdValue ? `($${Math.round(w.usdValue / 1000)}k)` : ''}` : null;
        const bw = wall(book.buyWalls?.[0]);
        const sw = wall(book.sellWalls?.[0]);
        if (bw || sw) head.push(`Walls — buy ${bw ?? '—'} vs sell ${sw ?? '—'}`);
    } else {
        head.push('Order book unavailable (the depth fetch failed).');
    }

    const tfBlocks: string[] = [];
    for (const tf of ALL_TIMEFRAMES) {
        try {
            const klines = await fetchKlines(symbol, tf, 60);
            if (klines.length === 0) {
                tfBlocks.push(`## ${tf}\n(no candles returned — source failed, treat as UNKNOWN)`);
                continue;
            }
            const candles = klines.map(k => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }));
            const ind = calculateIndicators(klines);
            const last = candles[candles.length - 1];
            const first = candles[0];
            const spanPct = first.open ? ((last.close - first.open) / first.open * 100).toFixed(2) : '0';
            const formations = detectCandleFormations(candles);
            tfBlocks.push([
                `## ${tf} — ${describeMarketStructure(candles)}`,
                `close ${last.close} (${spanPct}% over window) · EMA20 ${Number(ind.ema.ema20.toFixed(last.close >= 1000 ? 0 : 2))} / EMA50 ${Number(ind.ema.ema50.toFixed(last.close >= 1000 ? 0 : 2))} · RSI14 ${ind.rsi.rsi14.toFixed(1)} (${ind.rsiTrend}) · MACD ${ind.macd.trend}`,
                formations.length > 0 ? `formations: ${formations.join('; ')}` : 'formations: none named in the last 12 bars',
                'candles (last 8, oldest→newest):',
                ...candles.slice(-8).map(compactCandleRow),
            ].join('\n'));
        } catch {
            tfBlocks.push(`## ${tf}\n(source FAILED — treat this timeframe as UNKNOWN, not empty)`);
        }
    }

    return [...head, ...tfBlocks].join('\n\n');
}

/** What the desk-tool executor knows about the live surfaces: the chart
 *  the user is looking at (interval, verdict levels, their own drawings)
 *  plus the calling session's context (symbol fallback, abort, trade log). */
export interface DeskToolContext {
    defaultSymbol?: string | null;
    signal?: AbortSignal;
    trades?: LoggedTrade[];
    chartInterval?: string;
    chartLevels?: { label: string; price: number }[];
    /** Shapes the USER drew on the chart (services/trade/chartDrawings) —
     *  reported by get_chart_view so the model sees the user's annotations. */
    chartDrawings?: ChartDrawing[];
}

export async function executeDeskTool(
    call: DeskToolCall,
    context: DeskToolContext = {},
): Promise<DeskToolResult> {
    const fallback = context.defaultSymbol || 'BTCUSDT';
    // Repeat calls within the TTL (every seat asks the same desk) are served
    // from cache — identical market data, zero extra network round-trips.
    const cacheKey = toolCacheKey(call);
    const cacheable = !NON_CACHEABLE_TOOLS.has(call.name);
    const cached = cacheable ? toolCache.get(cacheKey) : undefined;
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
            case 'write_memory_note': {
                // Direct authoring into the model's own notebook folders —
                // writeModelNote enforces the harness-owned guards (diary,
                // distilled, skills/ are off-limits; append on name match).
                try {
                    const { writeModelNote } = await import('../learning/MemoryFilesService');
                    const { getActiveUsername } = await import('../../utils/activeUser');
                    const note = await writeModelNote(
                        {
                            folder: asString(call.arguments.folder, 'lessons'),
                            fileName: asString(call.arguments.file_name, 'note'),
                            content: asString(call.arguments.content),
                        },
                        getActiveUsername(),
                    );
                    content = JSON.stringify({ saved: true, file: note.name, note: 'The note is live in Settings → Memory now. Summarize what you wrote in your reply.' });
                } catch (err) {
                    content = `write_memory_note rejected: ${err instanceof Error ? err.message : String(err)}`;
                }
                break;
            }
            case 'get_notebook_map': {
                const { buildNotebookMapMarkdown } = await import('../learning/MemoryFilesService');
                content = buildNotebookMapMarkdown();
                break;
            }
            case 'remember': {
                // The collaboration memory (this environment's MEMORY.md analogue):
                // typed, one fact per entry, upsert by slug so updates beat
                // duplicates. The index rides every system prompt, so the model
                // already sees what exists before choosing slug vs new.
                try {
                    const { rememberProfileMemory, normalizeKind, slugify } = await import('../learning/profileMemory');
                    const { getActiveUsername } = await import('../../utils/activeUser');
                    const kind = normalizeKind(call.arguments.kind);
                    if (!kind) {
                        content = 'remember rejected: kind must be user | feedback | project | reference';
                        break;
                    }
                    const description = asString(call.arguments.description);
                    const body = asString(call.arguments.body);
                    if (!description || !body) {
                        content = 'remember rejected: description and body are both required';
                        break;
                    }
                    const slug = asString(call.arguments.slug) || slugify(asString(call.arguments.name) || description);
                    const { entry, created } = rememberProfileMemory(
                        { slug, description, kind, body },
                        getActiveUsername(),
                    );
                    content = JSON.stringify({
                        saved: true, slug: entry.slug, kind: entry.kind, created,
                        note: created ? 'New memory saved — its index line now rides every future prompt.' : `Existing memory "${entry.slug}" UPDATED in place (no duplicate created).`,
                    });
                } catch (err) {
                    content = `remember rejected: ${err instanceof Error ? err.message : String(err)}`;
                }
                break;
            }
            case 'read_memory': {
                const { listProfileMemories, getProfileMemory } = await import('../learning/profileMemory');
                const raw = call.arguments.slugs;
                const slugs: string[] = Array.isArray(raw) ? raw.map(String) : (raw ? [String(raw)] : []);
                const all = listProfileMemories();
                const picked = slugs.includes('all') || slugs.length === 0
                    ? all
                    : slugs.map(s => getProfileMemory(s)).filter((e): e is NonNullable<typeof e> => !!e);
                content = picked.length === 0
                    ? 'No matching memories. The index lists what exists; "all" returns every entry.'
                    : picked.map(e => `### [${e.kind}] ${e.slug}\n_${e.description}_\n\n${e.body}`).join('\n\n');
                break;
            }
            case 'forget': {
                const { forgetProfileMemory } = await import('../learning/profileMemory');
                const slug = asString(call.arguments.slug);
                const gone = slug ? forgetProfileMemory(slug) : false;
                content = gone
                    ? JSON.stringify({ removed: true, slug, note: 'The memory is deleted and gone from every future index.' })
                    : `forget rejected: no memory with slug "${slug}". Check the index for the exact slug.`;
                break;
            }
            case 'propose_skill': {
                // A model-authored skill proposal. PENDING draft only — the
                // human approves it in the Coach inbox (same surface as the
                // post-mortem crafts); the skill library is untouched until then.
                try {
                    const { parseCraftedSkill } = await import('../../schemas/learning');
                    const { queueSkillDraft } = await import('../../utils/skillDrafts');
                    const { getActiveUsername } = await import('../../utils/activeUser');
                    let steps: unknown = call.arguments.steps;
                    if (typeof steps === 'string') {
                        try { steps = JSON.parse(steps); } catch { steps = [steps]; }
                    }
                    if (!Array.isArray(steps)) steps = [String(steps)];
                    const crafted = parseCraftedSkill({
                        name: asString(call.arguments.name),
                        kind: call.arguments.kind === 'repeat' ? 'repeat' : 'avoid',
                        when: asString(call.arguments.when),
                        steps,
                        inputs: [],
                        validate: asString(call.arguments.validate, 'Confirm on the live chart before acting.'),
                        output: asString(call.arguments.output, 'A concrete actionable read of the setup.'),
                        approval: asString(call.arguments.approval, 'A human approves this draft in the Coach inbox before it is ever applied.'),
                        ifCondition: asString(call.arguments.if_condition),
                        thenAction: asString(call.arguments.then_action),
                    });
                    if (!crafted) {
                        content = 'propose_skill rejected: the proposal is missing required fields (name, when, steps, if_condition, then_action).';
                        break;
                    }
                    // The same quality bar every other draft source passes:
                    // tombstone cooldown, duplicate skip, live-skill coverage
                    // skip, IF/THEN sanity, and a falsifiable prediction.
                    const { deterministicDraftGate } = await import('../../services/learning/draftGates');
                    const username = getActiveUsername();
                    const tradeId = `chat-${Date.now()}`;
                    const gate = deterministicDraftGate({
                        crafted,
                        tradeId,
                        username,
                        coin: asString(call.arguments.coin) || undefined,
                    });
                    if (!gate.ok) {
                        content = `propose_skill rejected: ${gate.reason}.`
                            + (gate.reason.includes('existing skill') ? ' Use revise_skill to tighten the existing skill instead.' : '')
                            + ' Tell the user why no draft was queued.';
                        break;
                    }
                    const draft = queueSkillDraft(
                        { tradeId, coin: asString(call.arguments.coin) || undefined, crafted: gate.crafted },
                        username,
                    );
                    content = JSON.stringify({ proposed: true, id: draft.id, skill: crafted.name, note: 'Pending draft queued for human approval in the Coach inbox. The skill does nothing until a human allows it.' });
                } catch (err) {
                    content = `propose_skill rejected: ${err instanceof Error ? err.message : String(err)}`;
                }
                break;
            }
            case 'revise_skill': {
                // Revision proposals ride the learning queue (Settings →
                // Skills / Coach inbox review). Nothing is applied here.
                try {
                    const { listSkills } = await import('../learning/SkillMemoryService');
                    const { queueLearningProposal } = await import('../../utils/learningQueue');
                    const { getActiveUsername } = await import('../../utils/activeUser');
                    const slug = asString(call.arguments.skill_slug).toLowerCase().replace(/\.md$/, '');
                    const hit = listSkills().find(s => s.file.name.replace(/\.md$/i, '').toLowerCase() === slug);
                    if (!hit) {
                        content = `revise_skill rejected: no skill "${slug}". Call get_notebook_map or recall first for the exact slug.`;
                        break;
                    }
                    const proposal = queueLearningProposal({
                        kind: 'rescope',
                        text: asString(call.arguments.reason),
                        skillSlug: slug,
                        fingerprint: `model-revision:${slug}:${Date.now()}`,
                        payload: {
                            source: 'model:desk',
                            ifCondition: asString(call.arguments.if_condition) || undefined,
                            thenAction: asString(call.arguments.then_action) || undefined,
                        },
                    }, getActiveUsername());
                    content = proposal
                        ? JSON.stringify({ proposed: true, id: proposal.id, skill: slug, note: 'Revision proposal queued — a human approves it in Settings → Skills. The live skill is unchanged until then.' })
                        : 'revise_skill: an identical revision proposal is already pending.';
                } catch (err) {
                    content = `revise_skill rejected: ${err instanceof Error ? err.message : String(err)}`;
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
            case 'get_market_packet': {
                // The whole hybrid packet in one call — lazy-imported so the
                // desk-tool layer never statically depends on the intelligence
                // service (same cycle discipline as the eval scheduler).
                const sym = asSymbol(call.arguments.symbol, fallback);
                const { fetchHybridData, generateHybridPromptInjection } = await import('./HybridIntelligenceService');
                const packet = await fetchHybridData(sym);
                content = generateHybridPromptInjection(packet, { compact: true });
                break;
            }
            case 'get_chart_view': {
                const sym = asSymbol(call.arguments.symbol, fallback);
                const rawInterval = String(call.arguments.interval || context.chartInterval || '15m');
                const ivl = rawInterval.toLowerCase();
                const { fetchKlines } = await import('./KlineService');
                const [klines, mi, book] = await Promise.all([
                    fetchKlines(sym, ivl, 60),
                    fetchMarkIndex(sym),
                    fetchOrderBookDepth(sym).catch(() => null),
                ]);
                if (klines.length === 0) {
                    content = `DATA_UNAVAILABLE: get_chart_view — no candles returned for ${sym} ${ivl}. The source failed; do not infer an empty chart.`;
                    break;
                }
                const rows = klines.map(k =>
                    `${new Date(k.time).toISOString().slice(5, 16)} O${k.open} H${k.high} L${k.low} C${k.close} V${k.volume}`,
                ).join('\n');
                // The book column the user watches — condensed to the levels
                // they can actually see, not the raw 100-row ladder.
                const bookLines: string[] = [];
                if (book) {
                    bookLines.push(`Order book: best bid ${book.bestBid} · best ask ${book.bestAsk} · spread ${book.spreadPercent.toFixed(3)}% · dominant side ${book.dominantSide}`);
                    const fmtWall = (w: { price: number; usdValue?: number } | undefined): string | null =>
                        w ? `${w.price}${w.usdValue ? ` ($${Math.round(w.usdValue / 1000)}k)` : ''}` : null;
                    const buyWall = fmtWall(book.buyWalls?.[0]);
                    const sellWall = fmtWall(book.sellWalls?.[0]);
                    if (buyWall) bookLines.push(`Nearest buy wall: ${buyWall}`);
                    if (sellWall) bookLines.push(`Nearest sell wall: ${sellWall}`);
                } else {
                    bookLines.push('Order book unavailable (the depth fetch failed).');
                }
                const { describeDrawingsForModel } = await import('../trade/chartDrawings');
                content = [
                    `CHART VIEW — ${sym} · ${ivl} · last ${klines.length} candles (oldest→newest)`,
                    `Live mark price: ${mi.available ? mi.markPrice : 'unavailable'}`,
                    context.chartLevels && context.chartLevels.length > 0
                        ? `Levels drawn on the chart: ${context.chartLevels.map(l => `${l.label} ${l.price}`).join(' · ')}`
                        : 'No verdict levels are drawn on the chart right now.',
                    ...bookLines,
                    describeDrawingsForModel(context.chartDrawings ?? []) || 'The user has not drawn any shapes on the chart.',
                    rows,
                ].join('\n');
                break;
            }
            case 'get_all_timeframes': {
                content = await runAllTimeframes(asSymbol(call.arguments.symbol, fallback));
                break;
            }
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
            case 'scan_setups': {
                // The strategy-book scanner: live candles → the setup detectors
                // distilled from Pdf's Strategies, cross-referenced against the
                // skill library so the model can cite the matching playbooks.
                const sym = asSymbol(call.arguments.symbol, fallback);
                const ivl = asString(call.arguments.interval) || context.chartInterval || '15m';
                const { fetchKlines } = await import('./KlineService');
                const klines = await fetchKlines(sym, ivl, 60);
                if (klines.length < 25) {
                    content = `DATA_UNAVAILABLE: scan_setups — not enough candles returned for ${sym} ${ivl}. The source failed; do not infer an empty tape.`;
                    break;
                }
                const { scanSetups } = await import('../trade/setupScan');
                const setups = scanSetups(klines.map(k => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume })));
                let skillIndex: Array<{ slug: string; status?: string; ifCondition?: string }> = [];
                try {
                    const { listSkills } = await import('../learning/SkillMemoryService');
                    skillIndex = listSkills().map(({ file, meta }) => ({
                        slug: file.name.replace(/\.md$/i, ''),
                        status: meta.status,
                        ifCondition: meta.ifCondition,
                    })).filter(s => s.status !== 'retired');
                } catch { /* skill cross-ref is best-effort */ }
                if (setups.length === 0) {
                    content = `SETUP SCAN ${sym} ${ivl} — nothing live in the last 5 bars. No breakout, pin, inside-bar resolution, gap, divergence, band play, pullback or failed break is currently triggered. Do not invent a setup.`;
                    break;
                }
                content = [
                    `SETUP SCAN ${sym} ${ivl} — ${setups.length} live setup${setups.length === 1 ? '' : 's'} (trigger within the last 5 bars):`,
                    ...setups.map(s => {
                        const kw = s.keywords.map(k => k.toLowerCase());
                        const matched = skillIndex.filter(sk => {
                            const hay = `${sk.slug} ${sk.ifCondition ?? ''}`.toLowerCase();
                            return kw.some(k => hay.includes(k));
                        }).slice(0, 3);
                        return `- ${s.title} [${s.side.toUpperCase()}] (${s.barsAgo === 0 ? 'current bar' : `${s.barsAgo} bars ago`}) — ${s.evidence.join('; ')}${matched.length > 0 ? ` | skills: ${matched.map(m => `${m.slug} (${m.status ?? 'candidate'})`).join(', ')}` : ''}`;
                    }),
                    'Treat these as CODE-detected conditions with evidence, not advice — confirm against the packet and levels before acting.',
                ].join('\n');
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
        // A failure sentinel must not be cached — that would freeze an
        // outage into the TTL even after the source recovers. Stateful memory
        // tools never cache (see NON_CACHEABLE_TOOLS).
        if (cacheable && !isDataUnavailable(content)) {
            toolCache.set(cacheKey, { at: Date.now(), content });
        }
        return { toolCallId: call.id, name: call.name, ok: true, content };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            toolCallId: call.id,
            name: call.name,
            ok: false,
            content: dataUnavailable(call.name, message),
        };
    }
}

export async function executeDeskTools(
    calls: DeskToolCall[],
    context: DeskToolContext = {},
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
    /** True when the loop ran out of rounds right after EXECUTING tools —
     *  the model never got a word in after the results, so the caller owes
     *  one more (streamed) turn. False when the last round answered with
     *  no tool calls (that answer IS the reply — do not re-ask). */
    endedWithToolCalls: boolean;
}

/**
 * Bounded tool loop before the final streamed analysis reply.
 * chat_completions: native tools. Other formats: text-protocol tags.
 */
/**
 * One tool-loop round over a STREAMING turn: text deltas are forwarded to
 * `onTextDelta` as they land (the caller renders them live) while the full
 * ChatTurnResult contract of the non-streaming sendTurn is preserved —
 * native tool calls arrive via the stream's onStreamToolCalls callback at
 * end-of-stream, and the assistant tool_calls message is rebuilt here so the
 * native-tool loop can push results back exactly as before.
 */
const runStreamingTurn = async (
    streamTurn: NonNullable<Parameters<typeof runDeskToolLoop>['0']['streamTurn']>,
    config: import('../../types/provider').ProviderConfig,
    messages: import('../providers/GenericProviderService').ChatMessage[],
    options: import('../providers/GenericProviderService').ChatRequestOptions,
    onTextDelta?: (delta: string) => void,
): Promise<import('../providers/GenericProviderService').ChatTurnResult> => {
    let text = '';
    let reasoning = '';
    let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    const prevReasoning = options.onReasoning;
    const stream = streamTurn(config, messages, {
        ...options,
        onReasoning: chunk => {
            reasoning += chunk;
            prevReasoning?.(chunk);
        },
        onStreamToolCalls: calls => { toolCalls = calls; },
    });
    for await (const delta of stream) {
        text += delta;
        onTextDelta?.(delta);
    }
    return {
        text,
        reasoning,
        toolCalls,
        assistantMessage: toolCalls.length > 0
            ? {
                role: 'assistant',
                content: text || null,
                tool_calls: toolCalls.map(c => ({
                    id: c.id,
                    type: 'function' as const,
                    function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                })),
            }
            : undefined,
    };
};

export async function runDeskToolLoop(params: {
    config: import('../../types/provider').ProviderConfig;
    messages: import('../providers/GenericProviderService').ChatMessage[];
    sendTurn: (
        config: import('../../types/provider').ProviderConfig,
        messages: import('../providers/GenericProviderService').ChatMessage[],
        options?: import('../providers/GenericProviderService').ChatRequestOptions,
    ) => Promise<import('../providers/GenericProviderService').ChatTurnResult>;
    /** OPTIONAL streaming turn — when provided, EVERY loop round runs through
     *  it: text deltas stream to `onTextDelta` as they land (live rendering
     *  in the chat) and native tool calls come back via the stream's
     *  onStreamToolCalls callback, so a tool-using answer no longer waits
     *  for the whole loop to finish before the first word shows. */
    streamTurn?: (
        config: import('../../types/provider').ProviderConfig,
        messages: import('../providers/GenericProviderService').ChatMessage[],
        options?: import('../providers/GenericProviderService').ChatRequestOptions,
    ) => AsyncGenerator<string, void, unknown>;
    /** Receives streamed text deltas from `streamTurn` rounds. */
    onTextDelta?: (delta: string) => void;
    options?: import('../providers/GenericProviderService').ChatRequestOptions;
    defaultSymbol?: string | null;
    /** Trade-chart context so get_chart_view can report what the USER sees. */
    chartInterval?: string;
    chartLevels?: { label: string; price: number }[];
    /** The user's drawings on the live chart (get_chart_view). */
    chartDrawings?: ChartDrawing[];
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
    /** fires once per proposal/custom tool result so the caller can
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
        streamTurn,
        onTextDelta,
        options,
        defaultSymbol,
        chartInterval,
        chartLevels,
        chartDrawings,
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
        // A stop click must end the loop BETWEEN rounds — never fire one
        // more request on an already-dead signal.
        if (options?.signal?.aborted) {
            const abort = new Error('The turn was stopped.');
            abort.name = 'AbortError';
            throw abort;
        }
        const roundOptions: import('../providers/GenericProviderService').ChatRequestOptions = {
            ...options,
            tools: effectiveTools,
            // The FIRST round can force a tool call so a seat never argues
            // from zero data; later rounds stay 'auto' (the seat may stop).
            toolChoice: nativeTools
                ? (round === 0 && requireFirstToolRound && effectiveTools?.length ? 'required' : 'auto')
                : undefined,
            // Tool rounds stay shorter than the final analysis stream.
            maxTokens: Math.min(options?.maxTokens ?? 4096, 4096),
        };
        const turn = streamTurn
            ? await runStreamingTurn(streamTurn, config, messages, roundOptions, onTextDelta)
            : await sendTurn(config, messages, roundOptions);
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
                endedWithToolCalls: false,
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
                chartInterval,
                chartLevels,
                chartDrawings,
            })
            : [];
        const results = [...extraResults, ...forgedResults, ...coreResults];
        usedTools.push(...results.map(r => r.name));
        onToolEvent?.(results.map(r => digestToolResult(r.name, r.ok, r.content)).join(' · '));
        // persist proposal/custom tool side-effects (the transcript's
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

    return { messages, finalText: stripTextToolCalls(finalText), reasoning, usedTools, endedWithToolCalls: true };
}

export interface StreamWithDeskToolsOptions extends ChatRequestOptions {
    defaultSymbol?: string | null;
    /** Trade-chart context forwarded to get_chart_view (the model sees what
     *  the user sees: the panel's interval, drawn verdict levels, order book
     *  state and the user's OWN chart drawings). */
    chartInterval?: string;
    chartLevels?: { label: string; price: number }[];
    chartDrawings?: ChartDrawing[];
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
    /** fires once per proposal/custom tool result (forge_tool,
     *  amend_memory, custom_*) so the caller can persist ToolAction rows.
     *  Actions arrive with `speaker: ''` — stamp the seat name in the
     *  wrapper (streamChatWithDeskTools knows mailboxSeat / speaker). */
    onToolAction?: (action: ToolAction) => void;
    /** Panel-owned chart tools (draw_on_chart, mark_trade_levels,
     *  clear_chart_drawings). When provided, those definitions are offered
     *  to the model and its calls are dispatched here — the Chart AI panel
     *  routes them onto the live canvas. Return null to fall through. */
    executePanelTool?: (call: DeskToolCall) => Promise<DeskToolResult | null>;
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
        chartInterval,
        chartLevels,
        chartDrawings,
        onToolEvent,
        onToolAction,
        allowedTools,
        trades,
        mailbox,
        mailboxSeat,
        mailboxRound,
        onMailSent,
        requireFirstToolRound,
        executePanelTool,
        ...chatOptions
    } = options || {};

    // Debate mailbox: merge the floor-messaging tools into the
    // desk set so a seat's turn can carry real send_message/read_message
    // tool calls alongside market lookups. Dispatch is handled inside the
    // loop below (executeDeskTools stays pure market/memory).
    const seatName = mailboxSeat || '';
    const mailActive = Boolean(mailbox && seatName);
    // Chart-action tools ride the same extra-defs lane: offered only when
    // the caller owns a live canvas to draw on.
    const extraDefs = [
        ...(executePanelTool ? CHART_ACTION_TOOL_DEFS : []),
        ...(mailActive ? DEBATE_MAIL_TOOLS : []),
    ];
    const mergedAllowed = (mailActive || executePanelTool) && allowedTools && allowedTools.length > 0
        ? [
            ...allowedTools,
            ...extraDefs.map(t => t.function.name),
            // Confirmed forged tools execute through their own executor —
            // their names are dynamic, so the static allow-list can't
            // list them. Keep them offered.
            ...confirmedForgedToolDefinitions().map(d => d.function.name),
        ]
        : allowedTools;
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
    // LIVE PATH (chat_completions): every loop round streams through the
    // queue below, so the answer renders progressively in the chat while
    // tool rounds run — instead of appearing all at once after the loop.
    // Non-native formats keep the collect-then-stream shape (their wire
    // protocol needs the full text before tool tags can be parsed).
    const pending: string[] = [];
    let wake: (() => void) | null = null;
    let loopSettled = false;
    let streamedLive = false;
    const onTextDelta = (delta: string): void => {
        streamedLive = true;
        pending.push(delta);
        wake?.();
        wake = null;
    };
    const settle = (): void => {
        loopSettled = true;
        wake?.();
        wake = null;
    };
    const loopPromise = runDeskToolLoop({
        config,
        messages: enriched,
        sendTurn: sendChatTurn,
        streamTurn: nativeTools ? streamChatRequest : undefined,
        onTextDelta: nativeTools ? onTextDelta : undefined,
        options: chatOptions,
        defaultSymbol,
        chartInterval,
        chartLevels,
        chartDrawings,
        nativeTools,
        allowedTools: mergedAllowed,
        trades,
        requireFirstToolRound,
        extraToolDefs: extraDefs,
        executeExtraTool: async call => {
            // Panel-owned chart actions first (draw/levels/clear) — they
            // touch the live canvas and must not reach the market executor.
            if (executePanelTool) {
                const panelResult = await executePanelTool(call);
                if (panelResult) return panelResult;
            }
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
    loopPromise.then(settle, settle);

    // Drain streamed deltas as they arrive; stop when the loop settles.
    for (;;) {
        if (pending.length > 0) {
            yield pending.shift()!;
            continue;
        }
        if (loopSettled) break;
        await new Promise<void>(resolve => { wake = resolve; });
    }
    const loop = await loopPromise; // propagates the loop's error, if any

    if (loop.usedTools.length === 0 && loop.finalText.trim() && !streamedLive) {
        yield loop.finalText;
        return;
    }

    // A clean in-loop answer (last round had no tool calls) already streamed
    // to the user — running the continuation here would answer TWICE.
    if (streamedLive && !loop.endedWithToolCalls) return;

    const finalMessages = [...loop.messages];
    if (loop.usedTools.length > 0) {
        finalMessages.push({
            role: 'user',
            content: afterToolsNudge
                || 'Tool results are above. Continue your Floor turn now from the findings. No JSON, no tool tags.',
        });
    }
    if (options?.signal?.aborted) {
        const abort = new Error('The turn was stopped.');
        abort.name = 'AbortError';
        throw abort;
    }
    yield* streamChatRequest(config, finalMessages, chatOptions);
}
