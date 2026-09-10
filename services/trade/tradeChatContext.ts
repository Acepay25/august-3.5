/**
 * tradeChatContext — the pure half of "the model sees the chart realtime":
 * wraps the freshly-fetched hybrid market packet (which already carries the
 * numeric chart state per timeframe, indicators, funding, OI, book walls,
 * liquidations and session) in a labeled, timestamped block the trade-panel
 * chat prepends to every outgoing message. Kept pure so the framing is
 * unit-testable without a provider or the network.
 */

export interface TradeChatContextInput {
    symbol: string;
    interval: string;
    /** generateHybridPromptInjection output (code-calculated packet markdown). */
    packetMarkdown: string;
    /** Epoch ms of the fetch — stamped so the model knows how fresh it is. */
    fetchedAtMs: number;
}

export const buildTradeChatContext = ({ symbol, interval, packetMarkdown, fetchedAtMs }: TradeChatContextInput): string => {
    const when = new Date(fetchedAtMs).toISOString().replace('T', ' ').slice(0, 19);
    const packet = (packetMarkdown || '').trim() || '(packet unavailable — the live fetch failed; say so and call the desk tools instead of guessing)';
    return [
        `[LIVE CHART CONTEXT — ${symbol} · ${interval} chart · fetched ${when} UTC — code-calculated, treat as ground truth]`,
        packet,
        'If you need data newer than this packet, CALL THE DESK TOOLS — get_chart_view (the exact candles, timeframe, live mark and verdict levels drawn on the user\'s chart), get_market_packet (the full hybrid pull: every timeframe, indicators, funding, OI, book walls, liquidations, session), or the granular ones (get_price_snapshot, get_order_book, get_derivatives, get_liquidations, get_session_context) — never invent a number the packet lacks.',
    ].join('\n\n');
};

export const TRADE_CHAT_SYSTEM_PROMPT = [
    'You are the live chart copilot docked beside a Binance perpetuals chart in the August Trading terminal.',
    'The user is looking at the chart right now; every message arrives with a fresh code-calculated market packet.',
    'Answer from the packet and desk tools only: cite exact levels, name the timeframe, and flag when evidence is thin.',
    'Analysis, not financial advice — never promise outcomes.',
].join(' ');
