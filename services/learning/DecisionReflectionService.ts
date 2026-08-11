import { LoggedTrade, TradeOutcome } from '../../types';

/**
 * Decision-log reflection injection (the TradingAgents/Reflexion pattern —
 * the audit's #1 missing link for "the model actually learns").
 *
 * Closed trades + their one-line post-mortem lessons are fed back into the
 * NEXT run's analyst prompts: the same ticker's recent decisions first, then
 * the most recent cross-ticker lessons. The model reasons with the user's
 * ACTUAL outcomes instead of only generic extracted rules.
 */
export const buildDecisionReflectionContext = (
    trades: LoggedTrade[],
    symbol?: string | null
): string => {
    const closed = trades.filter(t =>
        t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );
    if (closed.length === 0) return '';

    const base = symbol
        ? symbol.replace(/USDT|USD|PERP/gi, '').toUpperCase()
        : null;
    const sameTicker = base
        ? closed.filter(t =>
            (t.analysis?.coinName ?? '')
                .replace(/USDT|USD|PERP/gi, '')
                .toUpperCase() === base
        )
        : [];

    const pick = (t: LoggedTrade): string => {
        const a = t.analysis;
        const dir = a?.direction ?? '?';
        const pnl = typeof t.pnlPercent === 'number'
            ? `${t.pnlPercent > 0 ? '+' : ''}${t.pnlPercent}%`
            : '';
        const date = new Date(t.timestamp).toLocaleDateString();
        const lesson = (t.postMortem ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 140);
        // Outcome weighting: the biggest lessons get flagged so the model
        // weighs them by impact (a -3R loss teaches more than a -0.3R one).
        const severity = typeof t.pnlPercent === 'number' && Math.abs(t.pnlPercent) >= 2
            ? (t.pnlPercent > 0 ? ' ✅ BIG WIN' : ' ⚠️ BIG LOSS')
            : '';
        return `- ${date} · ${a?.coinName ?? '?'} ${dir}${pnl ? ` (${pnl})` : ''}${severity}${lesson ? ` — ${lesson}` : ''}`;
    };

    const rows: string[] = [];
    sameTicker.slice(-3).forEach(t => rows.push(pick(t)));
    closed
        .filter(t => !sameTicker.includes(t))
        .slice(-3)
        .forEach(t => rows.push(pick(t)));

    if (rows.length === 0) return '';

    return `
 **RECENT TRADING DECISIONS (LEARN FROM THESE — the user's ACTUAL outcomes${base ? ` on ${base}` : ''}):**
${rows.join('\n')}

**INSTRUCTION:** Reference these outcomes when relevant (e.g. a past loss on this coin with the same setup). They are CONTEXT, not a veto — the current setup's own evidence always wins. Never fabricate outcomes that are not listed.`;
};
