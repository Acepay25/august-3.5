/**
 * tradeShapedProse — a seat that DESCRIBES a trade instead of calling
 * `present_trade`.
 *
 * Stage 20 moved the verdict out of the pipeline and into a tool, and a tool is
 * only as good as the model's choice to call it. When it answers in prose —
 * "Long BTC from 111,000, stop 109,500, target 115,000" — the trader gets a
 * sentence, the plan never reaches the journal, and the outcome ledger starves
 * exactly the way `the deleted stage ledger` says it does today.
 * This turns that sentence back into the arguments the tool wanted, so the row
 * can offer the same card the tool would have drawn.
 *
 * The extraction is deliberately narrow, and the VALIDATION is not here at all:
 * the numbers go to `parseTradeProposal`, which already refuses a long whose stop
 * sits above its entry, a plan with no target, and a direction it cannot name.
 * A row with no labelled triple yields null — prose that merely mentions a price
 * must not grow a "log this?" chip, because a chip the trader dismisses forty
 * times teaches them to click anything in the transcript.
 */

import { parseTradeProposal, type TradeProposal } from './proposedTrade';

/** A labelled price. Written as LITERALS, not built from a shared string: the
 *  constructed form (`new RegExp('\\D{0,12}' + PRICE)`) matched "entry 90" and
 *  silently refused "entry 111,000", and a detector whose two shapes disagree is
 *  the bug — literals are what the test suite can read.
 *
 *  `\d[\d,.]*` deliberately over-grabs ("115,000." takes the sentence's final
 *  dot) and `toNumber` trims it, so a price at the end of a sentence still parses. */
const ENTRY = /\b(?:entry|entries|buy\s+(?:at|from)|long\s+from|short\s+from)\D{0,12}(\d[\d,.]*)/i;
const STOP = /\b(?:stop\s*-?\s*loss|stop|sl|invalidation)\D{0,12}(\d[\d,.]*)/i;
const TARGET = /\b(?:targets?|take\s*profits?|tp\s*\d?)\D{0,12}(\d[\d,.]*)/gi;

const toNumber = (raw: string): number => Number(raw.replace(/,/g, '').replace(/[.,]+$/, ''));

/** Long and Short words, counted rather than first-matched: a reply that hedges
 *  both ways ("long above 112k, short below 109k") is not ONE plan, and guessing
 *  a direction the model never committed to would put a wrong-signed trade in the
 *  journal. */
const directionOf = (text: string): 'Long' | 'Short' | null => {
    const longs = (text.match(/\b(long|bullish|buy)\b/gi) ?? []).length;
    const shorts = (text.match(/\b(short|bearish|sell)\b/gi) ?? []).length;
    if (longs > 0 && shorts === 0) return 'Long';
    if (shorts > 0 && longs === 0) return 'Short';
    return null;
};

/** The plan a turn's prose describes, or null when it does not describe one.
 *  `symbolHint` is the coin the turn was about — the row knows it, the prose
 *  usually does not. */
export const planFromProse = (text: string, symbolHint?: string | null): TradeProposal | null => {
    if (!text || text.length < 24) return null;
    const direction = directionOf(text);
    if (!direction) return null;
    const entry = text.match(ENTRY)?.[1];
    const stopLoss = text.match(STOP)?.[1];
    if (!entry || !stopLoss) return null;
    const takeProfits: number[] = [];
    for (const m of text.matchAll(TARGET)) {
        const n = toNumber(m[1]);
        if (Number.isFinite(n) && !takeProfits.includes(n)) takeProfits.push(n);
        if (takeProfits.length === 5) break;
    }
    if (takeProfits.length === 0) return null;
    const symbol = (symbolHint || text.match(/\b([A-Z]{2,6}USDT?)\b/)?.[1] || '').toUpperCase();
    if (!symbol) return null;
    const parsed = parseTradeProposal({
        direction, symbol, entry: toNumber(entry), stopLoss: toNumber(stopLoss), takeProfits,
        rationale: text.slice(0, 500),
    });
    // The one parser this app has already said no — geometry, a target on the
    // wrong side, a number that is not a price. Nothing here overrides it.
    return parsed.proposal ?? null;
};

/** True when this row already carries a presented plan. The chip must not
 *  shadow the card the tool drew — one plan, one affordance. */
export const proseNeedsAChip = (row: { text?: string; proposal?: unknown }, symbolHint?: string | null): boolean =>
    !row.proposal && planFromProse(row.text ?? '', symbolHint) !== null;
