/**
 * keyLevels — the protocol for "the model found key levels": Chart AI ends
 * an analysis with a fenced `key-levels` block (one level per line:
 * `LABEL | PRICE | CONTEXT`); the dock parses it out of the answer, renders
 * it as the prototype's Key Levels card, and the card's chart toggle pushes
 * the levels to the canvas as price lines (master switch = show all, row
 * click = pin — pinned lines survive the switch turning off, row hover =
 * transient preview). This module is the single source of truth for both
 * surfaces (table rows and chart lines are derived from the same parse), and
 * it is PURE — no React, no chart, no network — so the parser and the
 * visibility rules are unit-testable.
 */

export type KeyLevelKind = 'resistance' | 'support' | 'vwap' | 'level';

/** One level as the model expressed it. */
export interface ModelKeyLevel {
    /** Stable within one message: `kl0`, `kl1`, … by display order. */
    id: string;
    label: string;
    price: number;
    context: string;
    kind: KeyLevelKind;
    /** CSS color (theme palette) the line + row chip carry. */
    color: string;
}

/** How a level line should look on the canvas right now:
 *  hidden  → no line at all
 *  shown   → the default dimmed dashed line (master switch on)
 *  pinned  → the user clicked the row; stays on even with the switch off
 *  preview → the user is hovering the row; full strength until they leave  */
export type KeyLevelState = 'hidden' | 'shown' | 'pinned' | 'preview';

export interface ChartLevelLine {
    id: string;
    label: string;
    price: number;
    color: string;
    state: KeyLevelState;
}

/** One message's level set, stamped with the coin it belongs to — the chart
 *  ignores a payload drawn for another instrument (BTC levels never paint on
 *  an ETH chart), mirroring the model-drawings coin guard. */
export interface MessageLevelLines {
    symbol: string;
    lines: ChartLevelLine[];
}

/** Theme colors (index.css semantics): rose = overhead, emerald = floor,
 *  violet = VWAP, amber = unlabeled structure. */
export const KEY_LEVEL_COLORS: Record<KeyLevelKind, string> = {
    resistance: '#f75d5f',
    support: '#07b56a',
    vwap: '#c084fc',
    level: '#f08800',
};

const MAX_LEVELS = 12;
const MAX_LABEL = 24;
const MAX_CONTEXT = 140;

/** Closed fenced blocks + (for stripping) an OPEN block — a `key-levels`
 *  fence with no closer is mid-stream: its partial body must never flash in
 *  the transcript, so `clean` cuts from the opening fence to the end. */
const OPEN_FENCE_RE = /```[ \t]*(?:august-)?key-levels[^\n]*\n?/i;

const parsePrice = (raw: string): number | null => {
    const n = parseFloat(raw.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
};

/** Classify from the label first (R1/S2/VWAP), then the context. */
export const kindForLevel = (label: string, context: string): KeyLevelKind => {
    const l = label.toLowerCase();
    const c = context.toLowerCase();
    if (l.includes('vwap')) return 'vwap';
    if (/^r\d/.test(l) || /\b(resistance|supply|ceiling|rejection|reject)\b/.test(l + ' ' + c)) return 'resistance';
    if (/^s\d/.test(l) || /\b(support|demand|floor)\b/.test(l + ' ' + c)) return 'support';
    return 'level';
};

const parseLine = (line: string, index: number): ModelKeyLevel | null => {
    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length < 2) return null;
    const [label, priceRaw, context = ''] = cells;
    const price = parsePrice(priceRaw);
    if (price === null || !label) return null;
    const kind = kindForLevel(label, context);
    return {
        id: `kl${index}`,
        label: label.slice(0, MAX_LABEL),
        price,
        context: context.slice(0, MAX_CONTEXT),
        kind,
        color: KEY_LEVEL_COLORS[kind],
    };
};

export interface ParsedKeyLevels {
    /** The answer with the block(s) removed — this is what renders. */
    clean: string;
    /** Closed-block levels, high price first (the prototype's order). */
    levels: ModelKeyLevel[];
    /** True when ANY fence (closed or still-open) was cut out. */
    hadBlock: boolean;
}

/** Pull every `key-levels` block out of a model answer. Tolerant by design:
 *  junk lines are skipped, caps clamp the rest, and an unterminated block
 *  (streaming) is stripped from the display text without yielding levels —
 *  the card only ever renders from a CLOSED block. */
export const parseKeyLevels = (text: string): ParsedKeyLevels => {
    if (!text || !/```[ \t]*(?:august-)?key-levels/i.test(text)) return { clean: text, levels: [], hadBlock: false };
    // Levels: only ever from CLOSED blocks.
    const levels: ModelKeyLevel[] = [];
    const closedRe = /```[ \t]*(?:august-)?key-levels[^\n]*\n([\s\S]*?)```[ \t]*/gi;
    let m: RegExpExecArray | null;
    while ((m = closedRe.exec(text)) !== null && levels.length < MAX_LEVELS) {
        for (const rawLine of m[1].split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue; // allow comments
            const lvl = parseLine(line, levels.length);
            if (lvl) levels.push(lvl);
            if (levels.length >= MAX_LEVELS) break;
        }
    }
    levels.sort((a, b) => b.price - a.price);
    // Re-id after sorting so ids stay positional (kl0 = top row = top line).
    levels.forEach((l, i) => { l.id = `kl${i}`; });
    // Display text: drop closed blocks, then — if a still-OPEN fence remains
    // (mid-stream) — cut it and everything after it, so the partial body
    // never flashes in the transcript.
    let clean = text.replace(/```[ \t]*(?:august-)?key-levels[^\n]*\n[\s\S]*?```[ \t]*\n?/gi, '');
    const open = OPEN_FENCE_RE.exec(clean);
    if (open) clean = clean.slice(0, open.index);
    clean = clean.replace(/\n{3,}/g, '\n\n').trimEnd();
    return { clean, levels, hadBlock: true };
};

/**
 * The chart visibility model (mirrors the prototype's CSS exactly):
 * master ON  → every level is drawn (dim), pinned/hovered at full strength;
 * master OFF → only PINNED levels stay drawn (hover does nothing while off);
 * hover previews only a level that is currently drawn.
 */
export const deriveChartLines = (
    levels: ModelKeyLevel[],
    opts: { allOn: boolean; pinned: ReadonlySet<string>; hoverId?: string | null },
): ChartLevelLine[] => {
    const { allOn, pinned, hoverId } = opts;
    return levels.map(l => {
        const isPinned = pinned.has(l.id);
        const visible = allOn || isPinned;
        let state: KeyLevelState = isPinned ? 'pinned' : 'shown';
        if (!visible) state = 'hidden';
        else if (hoverId === l.id) state = 'preview';
        return { id: l.id, label: l.label, price: l.price, color: l.color, state };
    });
};

/** "+0.28%" / "−0.26%" distance from the mark — the prototype's Dist column. */
export const formatDist = (price: number, mark: number | null): string => {
    if (mark === null || !Number.isFinite(mark) || mark <= 0) return '—';
    const pct = ((price - mark) / mark) * 100;
    const sign = pct >= 0 ? '+' : '−';
    return `${sign}${Math.abs(pct).toFixed(2)}%`;
};
