/**
 * toolKinds — what each desk tool IS, in the words the transcript already
 * uses.
 *
 * WHY THIS EXISTS. The transcript never carries a tool NAME. The desk loop
 * writes a digest line built from the tool's HUMAN label
 * (`services/analysis/DeskToolsService.ts` — `digestToolResult` → `toolLabel`),
 * so the row the trader reads says "order book", never "get_order_book". A
 * map keyed by tool name would therefore never match anything the transcript
 * shows, and a second map keyed by label would drift from the first.
 *
 * So there is ONE map, keyed by the LABEL — the string the transcript
 * actually carries. A tool's kind is a property of the tool, but the only
 * handle the UI has is its label, so the label is the key. The name→label
 * relation already lives in one place (`TOOL_LABELS` in the desk service, via
 * the exported `toolLabel`), so nothing is duplicated here.
 *
 * `kind` is the coarse bucket the step rows will group by (Phase 3).
 * `activity` is the gerund the turn's status line shows while that tool
 * works — "Reading the order book", not "order book". It is the one thing
 * that turns a bare state ("Analyzing") into a claim about what the desk is
 * doing right now.
 *
 * A tool August does not know — a FORGED tool, or one added after this file
 * was written — has no entry. It is not guessed at: `toolKindOf` returns
 * `other` with an empty activity, and the caller falls back to the raw label.
 * A wrong gerund is a lie about the model's work; the bare label is not.
 */

/** The coarse bucket a tool falls into. */
export type ToolKind = 'read' | 'search' | 'compute' | 'draw' | 'write' | 'present' | 'other';

/** The order the kinds are named in — a fixed order so two turns that did the
 *  same work say it the same way. */
export const KIND_ORDER: readonly ToolKind[] = ['read', 'search', 'compute', 'draw', 'write', 'present', 'other'];

/** The noun a group sentence counts in ("4 reads", "1 search"). It belongs to
 *  the KIND, not to the tool, so it is one table rather than forty. */
const KIND_COUNT_NOUN: Record<ToolKind, { one: string; many: string }> = {
    read: { one: 'read', many: 'reads' },
    search: { one: 'search', many: 'searches' },
    compute: { one: 'calculation', many: 'calculations' },
    draw: { one: 'draw', many: 'draws' },
    write: { one: 'write', many: 'writes' },
    present: { one: 'plan', many: 'plans' },
    other: { one: 'step', many: 'steps' },
};

/** The kind's own name — what the row's glyph MEANS. The glyph carries it on
 *  screen; this carries it to a screen reader and a tooltip. */
const KIND_LABEL: Record<ToolKind, string> = {
    read: 'read',
    search: 'search',
    compute: 'compute',
    draw: 'draw',
    write: 'write',
    present: 'present',
    other: 'step',
};

/** The kind's name, in the word a trader would use. */
export const toolKindLabel = (kind: ToolKind): string => KIND_LABEL[kind] ?? KIND_LABEL.other;

/** "4 reads" / "1 read" — the count and the noun, together. */
export const toolKindCount = (kind: ToolKind, n: number): string => {
    const noun = KIND_COUNT_NOUN[kind] ?? KIND_COUNT_NOUN.other;
    return `${n} ${n === 1 ? noun.one : noun.many}`;
};

export interface ToolKindInfo {
    kind: ToolKind;
    /** The activity phrase the status line shows while this tool works. */
    activity: string;
}

/** Keyed by the transcript's human label, lower-cased. */
const BY_LABEL: Record<string, ToolKindInfo> = {
    // ── reads: the desk is looking something up ──────────────────────────
    'btc context': { kind: 'read', activity: 'Reading BTC context' },
    'all-timeframe compendium': { kind: 'read', activity: 'Reading every timeframe' },
    'chart view': { kind: 'read', activity: 'Reading the chart' },
    'derivatives': { kind: 'read', activity: 'Reading derivatives' },
    'hybrid packet': { kind: 'read', activity: 'Reading the market' },
    'indicators': { kind: 'read', activity: 'Reading indicators' },
    'key levels': { kind: 'read', activity: 'Reading key levels' },
    'liquidations': { kind: 'read', activity: 'Reading liquidations' },
    'notebook map': { kind: 'read', activity: 'Reading the notebook map' },
    'order book': { kind: 'read', activity: 'Reading the order book' },
    'price snapshot': { kind: 'read', activity: 'Reading the price' },
    'read memory': { kind: 'read', activity: 'Reading a memory' },
    'read inbox': { kind: 'read', activity: 'Reading the inbox' },
    'session': { kind: 'read', activity: 'Reading the session' },
    'setup history': { kind: 'read', activity: 'Reading setup history' },
    'stored result': { kind: 'read', activity: 'Reading a stored result' },
    'trade log': { kind: 'read', activity: 'Reading the trade log' },

    // ── searches: the desk is looking for something ──────────────────────
    'notebook recall': { kind: 'search', activity: 'Recalling the notebook' },
    'skill reader': { kind: 'read', activity: 'Reading a skill' },
    'scan chart skills': { kind: 'search', activity: 'Scanning the chart for skills' },
    'scan setups': { kind: 'search', activity: 'Scanning for setups' },
    'session search': { kind: 'search', activity: 'Searching the session' },
    'web search': { kind: 'search', activity: 'Searching the web' },

    // ── computes: the desk is working something out ───────────────────────
    'monte carlo': { kind: 'compute', activity: 'Running Monte Carlo' },
    'price projection': { kind: 'compute', activity: 'Projecting prices' },
    'screener': { kind: 'compute', activity: 'Running the screener' },

    // ── draws: the desk is changing the chart ────────────────────────────
    'chart clear': { kind: 'draw', activity: 'Clearing the chart' },
    'chart draw': { kind: 'draw', activity: 'Drawing on the chart' },
    'draw detected': { kind: 'draw', activity: 'Drawing the detected setup' },
    'level marks': { kind: 'draw', activity: 'Marking levels' },

    // ── writes: the desk is changing the notebook ────────────────────────
    'amend memory': { kind: 'write', activity: 'Amending memory' },
    'cancel watch': { kind: 'write', activity: 'Cancelling the price watch' },
    'direct message': { kind: 'write', activity: 'Messaging an agent' },
    'forge tool': { kind: 'write', activity: 'Forging a tool' },
    'forget': { kind: 'write', activity: 'Forgetting a memory' },
    'memory note': { kind: 'write', activity: 'Writing a memory note' },
    'remember': { kind: 'write', activity: 'Remembering something' },
    'skill proposal': { kind: 'write', activity: 'Proposing a skill' },
    'skill revision': { kind: 'write', activity: 'Revising a skill' },
    'watch price': { kind: 'write', activity: 'Setting a price watch' },

    // ── presents: the desk is putting a trade in front of the trader ─────
    'decline trade': { kind: 'present', activity: 'Declining the trade' },
    'present trade': { kind: 'present', activity: 'Presenting the trade' },
    'strategy plan': { kind: 'present', activity: 'Proposing a plan' },

    // ── other: the desk is doing something we have no phrase for ─────────
    'wake me': { kind: 'other', activity: 'Waking you' },
};

/** The kind + activity phrase for a transcript label. Never throws, and never
 *  guesses: an unknown label is `other` with an EMPTY activity, so the caller
 *  falls back to the label itself. */
export const toolKindOf = (label: string): ToolKindInfo => {
    const key = (label ?? '').trim().toLowerCase();
    return BY_LABEL[key] ?? { kind: 'other', activity: '' };
};

/**
 * The desk's tool NAMES, one list — the same names `chatTurnRunner`'s
 * TRADE_TOOLS allow-list carries and the skill `compatibility.requiresTools`
 * gate checks against. A skill may only require a tool the desk can actually
 * call, and both readers must agree on the spelling, so the list lives here
 * in the vocabulary module where neither imports the other.
 */
export const DESK_TOOL_NAMES: readonly string[] = [
    'get_price_snapshot', 'get_order_book', 'get_derivatives',
    'get_liquidations', 'get_session_context', 'get_market_packet', 'get_all_timeframes', 'get_chart_view',
    'get_key_levels',
    'get_btc_context', 'recall', 'get_setup_history_stats', 'web_search', 'scan_setups',
    'get_trade_log',
    'project_future_price',
    'get_indicators',
    'recall_chat',
    'run_screener', 'run_monte_carlo',
    'write_memory_note', 'get_notebook_map', 'propose_skill', 'revise_skill', 'propose_strategy',
    'amend_memory', 'forge_tool', 'scan_chart_skills',
    'skill_view',
    // The collaboration-memory trio the dock's own mandate already asks for.
    // They were refused at the executor because this list did not name them;
    // the chart copilot can now save/recall/forget like the Chat surface.
    'remember', 'read_memory', 'forget',
];
