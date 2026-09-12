/**
 * tradeChatContext — the pure half of "the model sees the chart realtime":
 * wraps the freshly-fetched hybrid market packet (which already carries the
 * numeric chart state per timeframe, indicators, funding, OI, book walls,
 * liquidations and session) plus the user's chart drawings in a labeled,
 * timestamped block the trade-panel chat prepends to every outgoing message.
 * Kept pure so the framing is unit-testable without a provider or the network.
 */

import { phtFullStamp, phtStamp } from '../../utils/timezone';

export interface TradeChatContextInput {
    symbol: string;
    interval: string;
    /** generateHybridPromptInjection output (code-calculated packet markdown). */
    packetMarkdown: string;
    /** Epoch ms of the fetch — stamped so the model knows how fresh it is. */
    fetchedAtMs: number;
    /** The user's drawings on this chart (shape list; '' text when none). */
    drawingsDescription?: string;
    /** What the canvas literally displays right now (last bars + mark +
     *  levels), from TradingChart's imperative snapshot. Distinct from the
     *  packet: the packet is fetched data, this is what got PAINTED. */
    onScreenDescription?: string;
    /** The harness level-watch's armed plans for this symbol (one
     *  describePlanForModel block per plan, joined) — the model always
     *  knows the live plan and which levels already fired, even without a
     *  fresh signal. */
    plansDescription?: string;
}

export const buildTradeChatContext = ({ symbol, interval, packetMarkdown, fetchedAtMs, drawingsDescription, onScreenDescription, plansDescription }: TradeChatContextInput): string => {
    const when = phtFullStamp(fetchedAtMs);
    const packet = (packetMarkdown || '').trim() || '(packet unavailable — the live fetch failed; say so and call the desk tools instead of guessing)';
    return [
        `[LIVE CHART CONTEXT — ${symbol} · ${interval} chart · fetched ${when} PHT (UTC+8) — code-calculated, treat as ground truth]`,
        packet,
        (onScreenDescription || '').trim(),
        (plansDescription || '').trim(),
        (drawingsDescription || '').trim(),
        'If you need data newer than this packet, CALL THE DESK TOOLS — get_chart_view (everything on screen: candles, timeframe, live mark, verdict levels, order book and the user\'s own drawings), get_all_timeframes (every timeframe at once: candles, structure, formations per TF + book/spread/funding/OI/liquidations), get_market_packet (the full hybrid pull: every timeframe, indicators, funding, OI, book walls, liquidations, session), scan_setups (the strategy-book scanner: live breakouts, pin bars, inside-bar resolutions, gaps, divergences, band plays, pullbacks and failed breaks with evidence + matching skills), or the granular ones (get_price_snapshot, get_order_book, get_liquidations, get_session_context) — never invent a number the packet lacks.',
        'You can also GROW with this desk: write_memory_note saves a durable lesson straight into the trader notebook, get_notebook_map shows what you already know before you write, propose_skill / revise_skill / amend_memory / forge_tool queue improvements (skills, memory corrections, new tools) that a human then approves — propose them when this session taught you something that will matter on the next chart. And you can DRAW on this chart like the user does: mark_trade_levels lays an Entry/Stop/TP plan as labeled lines, draw_on_chart adds a trendline/ray/zone, get_all_timeframes pulls every timeframe plus the book at once.',
    ].filter(Boolean).join('\n\n');
};

/** The on-screen read for the model: the last painted candles + live mark +
 *  drawn levels, straight from the canvas snapshot (what the user ACTUALLY
 *  sees, not a fresh network fetch). Structural input so it stays pure. */
export const describeChartSnapshotForModel = (snap: {
    candles: { time: number; open: number; high: number; low: number; close: number }[];
    markPrice: number | null;
    levels: { label: string; price: number }[];
    capturedAt: number;
}): string => {
    if (!snap || snap.candles.length === 0) return '';
    // Candle stamps in Philippine time — the model quotes the clock the user
    // sees, never UTC to convert.
    const rows = snap.candles.map(c =>
        `${phtStamp(c.time * 1000)} O${c.open} H${c.high} L${c.low} C${c.close}`,
    ).join('\n');
    const head = [
        `[ON SCREEN — what the canvas is literally displaying right now]`,
        `Live mark shown on the chart: ${snap.markPrice ?? '—'}`,
        snap.levels.length > 0
            ? `Level lines drawn: ${snap.levels.map(l => `${l.label} ${l.price}`).join(' · ')}`
            : 'No verdict level lines are drawn on the chart right now.',
        `Last ${snap.candles.length} painted candles (oldest→newest, times in Philippine time UTC+8):`,
        rows,
    ].join('\n');
    return head;
};

export const TRADE_CHAT_SYSTEM_PROMPT = [
    'You are the live chart copilot docked beside a Binance perpetuals chart in the August Trading terminal.',
    'The user is looking at the chart right now; every message arrives with a fresh code-calculated market packet.',
    'ALWAYS ground market claims in evidence: call the desk tools when the answer touches price, the order book, funding, open interest or anything time-sensitive — get_chart_view (everything on screen), get_market_packet (the full hybrid pull) or the granular lookups. Cite exact levels, name the timeframe, and never invent a number the packet lacks.',
    'ALWAYS consult the skills library — the index below and the recall / get_notebook_map tools — and APPLY the skills and strategies that match the current setup. A matching skill outranks improvisation; name the skill you applied and its edge. If no skill matches, say so.',
    'GROW the desk whenever this chat earns it: write_memory_note for durable lessons, revise_skill to improve an existing skill, propose_skill for a new strategy, amend_memory to correct the notebook, forge_tool for a missing capability. Proposals wait for human approval — label them clearly.',
    'MAINTAIN your memory about the USER like a good assistant keeps notes: when you learn something durable about them (who they are, a correction about how they want you to work, an ongoing goal, a reference they use), save it with remember — one fact per entry, a description that says WHEN it matters, and check your memory index first so you UPDATE an existing slug instead of duplicating. feedback/project entries must end with **Why:** and **How to apply:** lines. Pull full bodies with read_memory when an index line is relevant, and forget entries that turn out wrong. Never save trading lessons (those belong to the notebook), provider keys, or anything that only matters to this one conversation.',
    'You can also DRAW on the user\'s live chart exactly like they do: mark_trade_levels lays an Entry/Stop/TP plan as labeled lines, draw_on_chart adds a trendline/ray/zone/level, and clear_chart_drawings removes your marks. Use them when you give a concrete setup so the plan is visible on the screen, and only clear or overwrite when the user asks.',
    'When you present a concrete trade, call present_trade — it draws the plan AND arms the harness level-watch. Messages beginning [HARNESS SIGNAL] are machine price events from that watch, not the user: treat the price data as ground truth, warn the user what hit (name the level id and price), say whether the rest of the plan holds, and NEVER re-announce a level already marked fired. The harness warns only — it does not place, close or resolve trades.',
    'WATCH the chart in real time: call watch_price to arm a price trigger ("above 112,000") or wake_me to re-check at a set time — the harness WAKES YOU with a [HARNESS TRIGGER] message when the condition holds, and you then pull a fresh read and tell the user whether it is ready to trade. Use them whenever the user says "alert me when", "tell me if price hits", or "check back in N minutes" — and confirm the watch id you armed. Never invent a trigger firing: if you have not been woken, the condition has not hit.',
    'Analysis, not financial advice — never promise outcomes.',
].join(' ');

/** One row of the skills index the panel injects into the system prompt. */
export interface SkillIndexRow {
    slug: string;
    status?: string;
    kind?: string;
    /** What the skill is + when it applies — the activation key. Per the
     *  Agent-Skills guidance, a specific "what + when" line is what lets the
     *  model decide to USE a skill; the IF/THEN is the rule once activated. */
    description?: string;
    ifCondition?: string;
    thenAction?: string;
}

/**
 * Compact skills-library index for the chat system prompt: the model must
 * reach for existing skills and strategies BEFORE free-styling, so it needs
 * to know what exists AND when each one applies. Pure — the panel loads the
 * library and passes rows in (kept out of this module so the prompt builder
 * stays network-free). Each line leads with the activation description
 * (what/when), then the IF/THEN rule.
 */
export const buildSkillsIndexForPrompt = (rows: SkillIndexRow[], max = 30): string => {
    if (rows.length === 0) return '';
    const lines = rows.slice(0, max).map(r => {
        const rule = [
            r.ifCondition ? `IF ${r.ifCondition}` : '',
            r.thenAction ? `THEN ${r.thenAction}` : '',
        ].filter(Boolean).join(' → ');
        const desc = (r.description || '').trim();
        const kindTag = r.kind ? `${r.kind === 'avoid' ? 'avoid' : 'repeat'} · ` : '';
        return `- ${r.slug}${r.status ? ` [${r.status}]` : ''} — ${kindTag}${desc || rule || '(see recall)'}${desc && rule ? ` · ${rule}` : ''}`;
    });
    return [
        `## Skills library — ${rows.length} skill${rows.length === 1 ? '' : 's'}. Each line is WHEN to use it; the IF/THEN is the rule. APPLY any that match this chart before answering; cite the slug you used, and pull its full body with recall/get_notebook_map when you act on it.`,
        ...lines,
        rows.length > max ? `…and ${rows.length - max} more — get_notebook_map or recall lists the full library.` : '',
    ].filter(Boolean).join('\n');
};
