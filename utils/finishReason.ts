/**
 * Finish-reason plumbing.
 *
 * Every wire format reports *why* a model stopped, under four different names
 * and value sets. Before this module nothing in production read any of them,
 * so an answer cut off at the token ceiling was indistinguishable from a
 * complete one — the verdict parser, the CONVICTION probe and the skill
 * evidence ledger all consumed truncated text as if it were the whole answer.
 *
 * Two surfaces:
 *   · pure normalization, so a caller can branch on one closed set of values;
 *   · a per-run truncation accumulator, because the ensemble call path threads
 *     40+ positional parameters and could not carry a flag without a rewrite.
 *     A run brackets itself with beginTruncationWindow()/consumeTruncations().
 */

/** The closed set every format's stop signal normalizes onto. */
export type FinishReason =
    | 'stop'
    | 'length'
    | 'tool_calls'
    | 'content_filter'
    | 'refusal'
    | 'error'
    | 'unknown';

/**
 * The token ceiling was reached, so the answer is incomplete. `error` is not
 * included — a failed call already throws; this is specifically the silent
 * case where a call *succeeds* with a cut-off body.
 */
export const truncatesOutput = (reason: FinishReason): boolean => reason === 'length';

const TRUNCATION_TOKENS = new Set([
    'length',
    'max_tokens',
    'max_output_tokens',
    'token_limit',
    'model_max_tokens',
]);

const STOP_TOKENS = new Set([
    'stop', 'end_turn', 'stop_sequence', 'complete', 'completed',
    'eos', 'max_length_reached_no', 'response',
]);

const TOOL_TOKENS = new Set(['tool_calls', 'tool_use', 'function_call', 'mcp_call']);
const FILTER_TOKENS = new Set(['content_filter', 'safety', 'recitation', 'prohibited_content']);
const REFUSAL_TOKENS = new Set(['refusal']);
const ERROR_TOKENS = new Set(['error', 'api_error', 'server_error', 'model_context_window_exceeded']);

/** Map a provider's raw stop signal onto `FinishReason`. Unrecognized values
 *  return 'unknown' — deliberately not 'stop', so a new provider vocabulary is
 *  visible in telemetry instead of being silently classified as complete. */
export const normalizeFinishReason = (raw: unknown): FinishReason => {
    if (typeof raw !== 'string') return 'unknown';
    const token = raw.trim().toLowerCase();
    if (!token) return 'unknown';
    if (TRUNCATION_TOKENS.has(token)) return 'length';
    if (STOP_TOKENS.has(token)) return 'stop';
    if (TOOL_TOKENS.has(token)) return 'tool_calls';
    if (FILTER_TOKENS.has(token)) return 'content_filter';
    if (REFUSAL_TOKENS.has(token)) return 'refusal';
    // `model_context_window_exceeded` and friends arrive as longer phrases.
    if (token.includes('context') || token.includes('error')) return 'error';
    if (token.includes('max_token') || token.includes('length')) return 'length';
    return 'unknown';
};

type Body = Record<string, any>;

const read = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;

/**
 * Pull the stop signal out of any of the four response shapes. Returns
 * `undefined` when the provider sent none, which is NOT the same as 'unknown':
 * a missing signal must never be counted as a truncation, or every gateway that
 * omits the field would poison the run's truncation tally.
 */
export const extractFinishReason = (data: unknown): FinishReason | undefined => {
    if (!data || typeof data !== 'object') return undefined;
    const body = data as Body;

    // chat_completions: choices[].finish_reason
    const chat = read(body.choices?.[0]?.finish_reason);
    if (chat) return normalizeFinishReason(chat);

    // Anthropic messages: stop_reason (absent on content_start-only bodies)
    const anthropic = read(body.stop_reason);
    if (anthropic) return normalizeFinishReason(anthropic);

    // OpenAI Responses: status + incomplete_details.reason. `incomplete` is
    // a SUCCESS-shaped response, which is precisely why it was being missed.
    const status = read(body.status);
    if (status) {
        if (status.toLowerCase() === 'incomplete') {
            const why = read(body.incomplete_details?.reason);
            return why ? normalizeFinishReason(why) : 'length';
        }
        if (status.toLowerCase() === 'failed') return 'error';
        if (status.toLowerCase() === 'cancelled') return 'error';
        return normalizeFinishReason(status);
    }

    // Google generateContent: candidates[].finishReason
    const gemini = read(body.candidates?.[0]?.finishReason);
    if (gemini) return normalizeFinishReason(gemini);

    return undefined;
};

// ─── Per-run truncation tally ───────────────────────────────────────────────

let windowOpen = false;
let truncatedCalls = 0;
let callsObserved = 0;
/** What the last CLOSED window reported. `peekTruncations` falls back to this
 *  so the run that consumed the window can still read it afterwards, while
 *  nothing that happens later can be counted into it. */
let closedSummary: TruncationSummary = { truncated: false, truncatedCalls: 0, callsObserved: 0 };

export interface TruncationSummary {
    /** True only when a call inside the window actually hit the token ceiling. */
    truncated: boolean;
    truncatedCalls: number;
    callsObserved: number;
}

/** Open a tally window. Idempotent-safe: nested begins do not double-count. */
export const beginTruncationWindow = (): void => {
    windowOpen = true;
    truncatedCalls = 0;
    callsObserved = 0;
    closedSummary = { truncated: false, truncatedCalls: 0, callsObserved: 0 };
};

/** Record one normalized finish reason. Cheap to call from any transport. */
export const recordFinishReason = (reason: FinishReason | undefined): void => {
    if (!windowOpen || reason === undefined) return;
    callsObserved += 1;
    if (truncatesOutput(reason)) truncatedCalls += 1;
};

/** Close the window and report what happened inside it. Recording stops here:
 *  a later call from anywhere else in the app belongs to a different run. The
 *  closed figure stays readable through `peekTruncations` until the next
 *  `beginTruncationWindow`, because the verdict finalizer runs after the
 *  generator that owns the window has already finished. */
export const consumeTruncations = (): TruncationSummary => {
    const summary = { truncated: truncatedCalls > 0, truncatedCalls, callsObserved };
    windowOpen = false;
    truncatedCalls = 0;
    callsObserved = 0;
    closedSummary = summary;
    return summary;
};

/** Read the tally: live while a window is open, otherwise whatever the last
 *  closed one found. Never zero-and-meaningless, so a caller cannot mistake
 *  "no window was open" for "nothing was truncated". */
export const peekTruncations = (): TruncationSummary => (
    windowOpen
        ? { truncated: truncatedCalls > 0, truncatedCalls, callsObserved }
        : closedSummary
);

/** Test/seam helper: a fresh module state per case. */
export const resetTruncationWindow = (): void => {
    windowOpen = false;
    truncatedCalls = 0;
    callsObserved = 0;
    closedSummary = { truncated: false, truncatedCalls: 0, callsObserved: 0 };
};
