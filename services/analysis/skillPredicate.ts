/**
 * skillPredicate — a machine-checkable trigger condition on a skill.
 *
 * A skill's `ifCondition` is prose, so a seat can read it loosely or ignore it.
 * A predicate states the same claim in a language code can evaluate against the
 * tape, which turns "this setup is live right now" into a fact rather than an
 * opinion.
 *
 * The grammar is deliberately tiny and the parser is hand-written:
 *
 *     or   := and (('or' | '||') and)*
 *     and  := not (('and' | '&&') not)*
 *     not  := ('not' | '!') not | atom
 *     atom := '(' or ')' | comparison
 *     cmp  := value (('>' | '>=' | '<' | '<=') value)?
 *     val  := FIELD | NUMBER
 *
 * There is no `eval`, no `new Function`, and no property access driven by the
 * expression — a model-authored predicate is data checked against a whitelist,
 * never code. Unknown fields, non-comparisons, malformed syntax and nesting
 * past MAX_DEPTH are all rejected at parse time, so a bad predicate can only
 * ever mean "not evaluated", never "evaluated to true".
 */

import { rsiSeries, bollinger, smaSeries, type ScanCandle } from '../trade/setupScan';

/** Maximum source length — a predicate is a clause, not an essay. */
export const PREDICATE_MAX_LENGTH = 240;

/**
 * The one-line grammar brief every AUTHOR of a predicate gets: the desk tools
 * (`propose_skill`/`revise_skill`), the craft prompts and the skill editor all
 * quote this constant, so a model can never be asked for a clause the
 * evaluator would reject for syntax it was never told about.
 *
 * Field list mirrors FIELD_ALIASES below — candles-derived only, deliberately
 * no funding/OI/book term, because a condition with no historical series
 * cannot be back-tested and so cannot earn authority.
 */
export const PREDICATE_GRAMMAR_HINT =
    'Machine-checkable trigger, evaluated on the LAST CLOSED candle of the '
    + `timeframe the skill was earned on. Max ${PREDICATE_MAX_LENGTH} chars. `
    + 'Comparisons use > >= < <=, joined with and / or / not, grouped with ( ). '
    + 'Fields: close, open, high, low, volume, rsi14, ema20, ema50, sma20, '
    + 'volumeSma20, atr14, bbUpper, bbMiddle, bbLower, bodyPct, rangePct, '
    + 'volumeRatio (numbers are absolute prices/units, not percentages). '
    + 'Example: "rsi14 > 70 and close > bbUpper". '
    + 'A clause that fails to parse is stored as nothing — it never reads as a match.';

/** Bounds both recursion depth and the work an adversarial string can demand. */
const MAX_DEPTH = 12;
const MAX_TERMS = 64;

export type PredicateField =
    | 'close' | 'open' | 'high' | 'low' | 'volume'
    | 'rsi14'
    | 'ema20' | 'ema50'
    | 'sma20' | 'volumeSma20'
    | 'atr14'
    | 'bbUpper' | 'bbMiddle' | 'bbLower'
    | 'bodyPct' | 'rangePct' | 'volumeRatio';

/**
 * Accepted spellings, resolved after normalization so `rsi_14`, `RSI14` and
 * `rsi-14` all land on `rsi14`. Only names computed from OHLCV appear here —
 * notably no funding rate, open interest or book field, because the repo keeps
 * no historical series for those and a condition that cannot be replayed
 * against past candles is not a condition anyone should act on.
 */
const FIELD_ALIASES: Record<string, PredicateField> = {
    close: 'close',
    open: 'open',
    high: 'high',
    low: 'low',
    volume: 'volume',
    rsi14: 'rsi14',
    rsi: 'rsi14',
    ema20: 'ema20',
    ema50: 'ema50',
    sma20: 'sma20',
    closesma20: 'sma20',
    volumesma20: 'volumeSma20',
    averagevolume20: 'volumeSma20',
    volumeavg20: 'volumeSma20',
    volumeaverage: 'volumeSma20',
    atr14: 'atr14',
    atr: 'atr14',
    bbupper: 'bbUpper',
    upperband: 'bbUpper',
    bbmiddle: 'bbMiddle',
    bblower: 'bbLower',
    lowerband: 'bbLower',
    bodypct: 'bodyPct',
    rangepct: 'rangePct',
    volumeratio: 'volumeRatio',
    volumevsaverage: 'volumeRatio',
};

/** `rsi_14` / `RSI-14` / `rsi 14` → `rsi14`. */
const normalizeToken = (raw: string): string => raw.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Own-property lookup only. A plain `FIELD_ALIASES[key]` would resolve
 * `constructor`, `toString` and `__proto__` through Object.prototype and hand
 * back a truthy non-field — which is exactly how a whitelist stops being one.
 */
export const resolveField = (raw: string): PredicateField | undefined => {
    const key = normalizeToken(raw);
    return Object.prototype.hasOwnProperty.call(FIELD_ALIASES, key)
        ? FIELD_ALIASES[key]
        : undefined;
};

type Operand = { kind: 'num'; value: number } | { kind: 'field'; field: PredicateField };
export type PredicateNode =
    | { kind: 'and'; parts: PredicateNode[] }
    | { kind: 'or'; parts: PredicateNode[] }
    | { kind: 'not'; node: PredicateNode }
    | { kind: 'cmp'; op: '>' | '>=' | '<' | '<='; left: Operand; right: Operand };

export type PredicateParseResult =
    | { ok: true; ast: PredicateNode }
    | { ok: false; error: string };

// ─── tokenizer ──────────────────────────────────────────────────────────────

type Token =
    | { t: 'num'; v: number }
    | { t: 'field'; v: string }
    | { t: 'op'; v: '>' | '>=' | '<' | '<=' }
    | { t: 'and' } | { t: 'or' } | { t: 'not' }
    | { t: 'lp' } | { t: 'rp' };

/** Returns the token stream, or a human-readable error string. */
const tokenize = (src: string): Token[] | string => {
    const out: Token[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i += 1; continue; }
        if (c === '(') { out.push({ t: 'lp' }); i += 1; continue; }
        if (c === ')') { out.push({ t: 'rp' }); i += 1; continue; }
        if (c === '&' && src[i + 1] === '&') { out.push({ t: 'and' }); i += 2; continue; }
        if (c === '|' && src[i + 1] === '|') { out.push({ t: 'or' }); i += 2; continue; }
        if (c === '!') { out.push({ t: 'not' }); i += 1; continue; }
        if (c === '>' || c === '<') {
            const eq = src[i + 1] === '=';
            out.push({ t: 'op', v: (c + (eq ? '=' : '')) as '>' | '>=' | '<' | '<=' });
            i += eq ? 2 : 1;
            continue;
        }
        if (c === '=') return 'unsupported operator "=" — a condition needs ">", ">=", "<" or "<="';
        if (/[0-9.]/.test(c)) {
            const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i));
            if (!m) return `malformed number at position ${i}`;
            const v = Number(m[0]);
            if (!Number.isFinite(v)) return `malformed number "${m[0]}"`;
            out.push({ t: 'num', v });
            i += m[0].length;
            continue;
        }
        // Hyphens belong inside a field name: `rsi-14` must land on `rsi14` the
        // same way `rsi_14` does, exactly as FIELD_ALIASES promises above.
        // Safe because this grammar has no subtraction and no negative literal
        // (numbers never start with a sign), so `-` can only ever be noise in
        // a name — and a stray one is still a hard error below.
        const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
        if (id) {
            const word = id[0].toLowerCase();
            if (word === 'and') out.push({ t: 'and' });
            else if (word === 'or') out.push({ t: 'or' });
            else if (word === 'not') out.push({ t: 'not' });
            else out.push({ t: 'field', v: id[0] });
            i += id[0].length;
            continue;
        }
        // Anything else — a stray hyphen, a quote, an emoji — is a hard error
        // rather than something to guess at.
        return `unexpected character "${c}" at position ${i}`;
    }
    return out;
};

// ─── parser ─────────────────────────────────────────────────────────────────

class PredicateSyntaxError extends Error {}

export const parsePredicate = (src: string): PredicateParseResult => {
    const trimmed = (src ?? '').trim();
    if (!trimmed) return { ok: false, error: 'empty predicate' };
    if (trimmed.length > PREDICATE_MAX_LENGTH) {
        return { ok: false, error: `predicate longer than ${PREDICATE_MAX_LENGTH} characters` };
    }
    const tokens = tokenize(trimmed);
    if (typeof tokens === 'string') return { ok: false, error: tokens };

    // Declared as a function (not an arrow const) so TypeScript lets its
    // `never` return narrow the call sites that check for a missing token.
    function fail(message: string): never {
        throw new PredicateSyntaxError(message);
    }

    let pos = 0;
    let terms = 0;
    const peek = (): Token | undefined => tokens[pos];
    const next = (): Token | undefined => tokens[pos++];

    const parseValue = (): Operand => {
        const tok = next();
        if (!tok) fail('expression ends with a dangling operator');
        if (tok.t === 'num') return { kind: 'num', value: tok.v };
        if (tok.t === 'field') {
            const field = resolveField(tok.v);
            if (!field) fail(`unknown field "${tok.v}" — no candle-derived value by that name`);
            return { kind: 'field', field };
        }
        return fail('expected a field name or a number');
    };

    const parseComparison = (): PredicateNode => {
        const left = parseValue();
        const tok = peek();
        if (!tok || tok.t !== 'op') {
            return fail('every condition must compare two values, e.g. `rsi14 > 70`');
        }
        next();
        const right = parseValue();
        return { kind: 'cmp', op: tok.v, left, right };
    };

    const parseAtom = (depth: number): PredicateNode => {
        const tok = peek();
        if (!tok) fail('expression ends unexpectedly');
        if (tok.t === 'lp') {
            next();
            const inner = parseOr(depth + 1);
            const close = next();
            if (!close || close.t !== 'rp') fail('missing closing parenthesis');
            return inner;
        }
        if (tok.t === 'rp') fail('unexpected ")"');
        return parseComparison();
    };

    function parseOr(depth: number): PredicateNode {
        if (depth > MAX_DEPTH) fail(`nesting deeper than ${MAX_DEPTH}`);
        const parts = [parseAnd(depth)];
        while (peek()?.t === 'or') {
            next();
            parts.push(parseAnd(depth));
            if (++terms > MAX_TERMS) fail(`more than ${MAX_TERMS} conditions`);
        }
        return parts.length === 1 ? parts[0] : { kind: 'or', parts };
    }

    function parseAnd(depth: number): PredicateNode {
        if (depth > MAX_DEPTH) fail(`nesting deeper than ${MAX_DEPTH}`);
        const parts = [parseNot(depth)];
        while (peek()?.t === 'and') {
            next();
            parts.push(parseNot(depth));
            if (++terms > MAX_TERMS) fail(`more than ${MAX_TERMS} conditions`);
        }
        return parts.length === 1 ? parts[0] : { kind: 'and', parts };
    }

    function parseNot(depth: number): PredicateNode {
        if (depth > MAX_DEPTH) fail(`nesting deeper than ${MAX_DEPTH}`);
        if (peek()?.t === 'not') {
            next();
            return { kind: 'not', node: parseNot(depth + 1) };
        }
        return parseAtom(depth);
    }

    try {
        const ast = parseOr(0);
        if (pos < tokens.length) fail('unexpected tokens after a complete expression');
        return { ok: true, ast };
    } catch (err) {
        if (err instanceof PredicateSyntaxError) return { ok: false, error: err.message };
        throw err;
    }
};

/** Public alias: the name the AI boundary calls, to make intent legible there. */
export const validatePredicate = parsePredicate;

/**
 * Normalize a predicate arriving from a model or an editor. Anything that does
 * not parse is dropped rather than stored, so a malformed clause degrades to
 * "no code gate, prose only" — never to a match, and never to a rejection of
 * the whole skill.
 */
export const sanitizePredicate = (raw: string | undefined): string | undefined => {
    const s = (raw ?? '').trim();
    if (!s) return undefined;
    return parsePredicate(s).ok ? s : undefined;
};

// ─── indicator series ───────────────────────────────────────────────────────

/** EMA seeded from the first full SMA window; NaN before that. */
const emaSeries = (values: number[], period: number): number[] => {
    const out: number[] = values.map(() => NaN);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i += 1) {
        const v = values[i] ?? NaN;
        prev = v * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
};

/** Wilder ATR(true range), aligned to the candles; NaN before the seed fills. */
const atrSeries = (candles: ScanCandle[], period = 14): number[] => {
    const out: number[] = candles.map(() => NaN);
    if (candles.length <= period) return out;
    const tr = (i: number): number => {
        const c = candles[i];
        const prevClose = candles[i - 1]?.close ?? NaN;
        if (!c) return NaN;
        return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    };
    let prev = 0;
    for (let i = 1; i <= period; i += 1) prev += tr(i);
    prev /= period;
    out[period] = prev;
    for (let i = period + 1; i < candles.length; i += 1) {
        prev = (prev * (period - 1) + tr(i)) / period;
        out[i] = prev;
    }
    return out;
};

/** Every whitelisted field as a candle-aligned series. NaN marks a bar where
 *  the indicator has not warmed up — never a zero. */
export interface PredicateSeries {
    length: number;
    fields: Record<PredicateField, number[]>;
}

export const buildPredicateSeries = (candles: ScanCandle[]): PredicateSeries => {
    const closes = candles.map(c => c.close);
    // `ScanCandle.volume` is optional (some feeds omit it), so a missing bar
    // becomes NaN — which the evaluator then reports as "unknown" rather than
    // silently reading as zero volume and satisfying a `volume < …` test.
    const volumes = candles.map(c => (typeof c.volume === 'number' && Number.isFinite(c.volume) ? c.volume : NaN));
    const bb = bollinger(candles);
    const volumeSma = smaSeries(volumes, 20);
    const volumeRatio = candles.map((_, i) => {
        const v = volumes[i];
        const avg = volumeSma[i];
        return typeof v === 'number' && typeof avg === 'number' && avg > 0 ? v / avg : NaN;
    });
    const pct = (delta: number, base: number): number => (base > 0 && Number.isFinite(delta) ? (delta / base) * 100 : NaN);
    return {
        length: candles.length,
        fields: {
            close: closes,
            open: candles.map(c => c.open),
            high: candles.map(c => c.high),
            low: candles.map(c => c.low),
            volume: volumes,
            rsi14: rsiSeries(candles),
            ema20: emaSeries(closes, 20),
            ema50: emaSeries(closes, 50),
            sma20: smaSeries(closes, 20),
            volumeSma20: volumeSma,
            atr14: atrSeries(candles),
            bbUpper: bb.upper,
            bbMiddle: bb.mid,
            bbLower: bb.lower,
            bodyPct: candles.map(c => pct(Math.abs(c.close - c.open), c.open)),
            rangePct: candles.map(c => pct(c.high - c.low, c.open)),
            volumeRatio,
        },
    };
};

// ─── evaluator (three-valued) ───────────────────────────────────────────────

export type PredicateOutcome =
    | { status: 'fired' }
    | { status: 'quiet' }
    /** A referenced indicator had not warmed up on that bar. Absence of data
     *  is reported as such so no caller can read it as "condition not met". */
    | { status: 'unknown'; missing: PredicateField[] };

/** Reads one operand; null means the field had no value on this bar. */
const readOperand = (
    o: Operand,
    fields: PredicateSeries['fields'],
    i: number,
    missing: PredicateField[],
): number | null => {
    if (o.kind === 'num') return o.value;
    const v = fields[o.field]?.[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
        missing.push(o.field);
        return null;
    }
    return v;
};

/** Three-valued evaluation: true, false, or null for "cannot tell yet". */
const evalNode = (node: PredicateNode, s: PredicateSeries, i: number, missing: PredicateField[]): boolean | null => {
    switch (node.kind) {
        case 'and': {
            const parts = node.parts.map(p => evalNode(p, s, i, missing));
            if (parts.some(p => p === false)) return false;
            return parts.some(p => p === null) ? null : true;
        }
        case 'or': {
            const parts = node.parts.map(p => evalNode(p, s, i, missing));
            if (parts.some(p => p === true)) return true;
            return parts.some(p => p === null) ? null : false;
        }
        case 'not': {
            const v = evalNode(node.node, s, i, missing);
            return v === null ? null : !v;
        }
        case 'cmp': {
            const l = readOperand(node.left, s.fields, i, missing);
            const r = readOperand(node.right, s.fields, i, missing);
            if (l === null || r === null) return null;
            switch (node.op) {
                case '>': return l > r;
                case '>=': return l >= r;
                case '<': return l < r;
                default: return l <= r;
            }
        }
    }
};

/** Evaluate a parsed predicate at one bar. */
export const evaluatePredicateAt = (
    ast: PredicateNode,
    series: PredicateSeries,
    index: number,
): PredicateOutcome => {
    if (!Number.isInteger(index) || index < 0 || index >= series.length) {
        return { status: 'unknown', missing: [] };
    }
    const missing: PredicateField[] = [];
    const v = evalNode(ast, series, index, missing);
    if (v === null) return { status: 'unknown', missing: [...new Set(missing)] };
    return v ? { status: 'fired' } : { status: 'quiet' };
};

/**
 * Parse-and-evaluate in one step, distinguishing an INVALID predicate (a
 * stored string that no longer parses — reported with its error so a UI can
 * show why) from an unevaluable bar.
 */
export const evaluatePredicateSource = (
    src: string,
    series: PredicateSeries,
    index: number,
): PredicateOutcome | { status: 'invalid'; error: string } => {
    const parsed = parsePredicate(src);
    if (!parsed.ok) return { status: 'invalid', error: parsed.error };
    return evaluatePredicateAt(parsed.ast, series, index);
};

/** The most recent bar a predicate may be judged on. */
export const lastClosedIndex = (series: PredicateSeries): number => series.length - 1;

/** Short human rendering of a predicate's fields, for evidence lines. */
export const predicateFields = (src: string): PredicateField[] => {
    const parsed = parsePredicate(src);
    if (!parsed.ok) return [];
    const found = new Set<PredicateField>();
    const walk = (n: PredicateNode): void => {
        if (n.kind === 'and' || n.kind === 'or') n.parts.forEach(walk);
        else if (n.kind === 'not') walk(n.node);
        else {
            if (n.left.kind === 'field') found.add(n.left.field);
            if (n.right.kind === 'field') found.add(n.right.field);
        }
    };
    walk(parsed.ast);
    return [...found];
};
