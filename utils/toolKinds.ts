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
    'liquidations': { kind: 'read', activity: 'Reading liquidations' },
    'notebook map': { kind: 'read', activity: 'Reading the notebook map' },
    'order book': { kind: 'read', activity: 'Reading the order book' },
    'price snapshot': { kind: 'read', activity: 'Reading the price' },
    'read memory': { kind: 'read', activity: 'Reading a memory' },
    'session': { kind: 'read', activity: 'Reading the session' },
    'setup history': { kind: 'read', activity: 'Reading setup history' },
    'stored result': { kind: 'read', activity: 'Reading a stored result' },
    'trade log': { kind: 'read', activity: 'Reading the trade log' },

    // ── searches: the desk is looking for something ──────────────────────
    'notebook recall': { kind: 'search', activity: 'Recalling the notebook' },
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
