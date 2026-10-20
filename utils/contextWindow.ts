/**
 * contextWindow — what the app believes about a model's context window, and
 * what that belief may be used for.
 *
 * Two different questions were being answered with one number. `ProviderConfig
 * .contextWindowTokens` (Settings → Providers) sized how much retrieved memory
 * to INJECT, and `utils/tokenEstimate.ts` fell back to 65,536 when it was unset.
 * Nothing anywhere asked the other question — "how much history may I put on
 * the wire before the provider refuses?" — so a long Chat conversation or a
 * tool-heavy desk turn sent an ever-growing message array and the failure
 * surfaced as an error, or as an answer that never arrives.
 *
 * So this module resolves ONE window from four sources, best evidence first,
 * and says which one won:
 *
 *   1. `user`     — the number typed in Settings → Providers. An override is an
 *                   override: it beats everything, including a provider that
 *                   says otherwise, because the trader may be routing through a
 *                   gateway that truncates the window on purpose.
 *   2. `measured` — a limit this app read out of the provider's OWN rejection of
 *                   a previous request (see `contextLengthLimitFromError`). The
 *                   strongest evidence there is: the wire said the number.
 *   3. `model`    — what `/models` reported for this model id, captured at
 *                   discovery (`ProviderConfig.modelContextWindows`).
 *   4. `default`  — 1,000,000 (owner ruling, 2026-10-20).
 *
 * ## Why the default may be optimistic now
 *
 * 65,536 was conservative, and conservatism was load-bearing for INJECTION
 * sizing only: every injection budget is `min(cap, window × fraction)`, and both
 * caps already bind at 65,536 (`memoryWindowBudget` 2 %/900 tokens, market
 * packet 10 %/6,000 tokens). Raising the default therefore changes no injected
 * byte — `tests/contextWindow.test.ts` pins that. What the default is now used
 * for is the OUTBOUND ceiling, and an optimistic ceiling is only safe because
 * two things back it up: automatic compaction
 * (`services/providers/contextCompact.ts`) keeps the prompt inside the resolved
 * window, and a provider that refuses anyway is read for its stated limit,
 * remembered as `measured`, and the turn retried once. A wrong guess is
 * self-correcting instead of fatal — which is the whole reason 1M is affordable
 * here when it would not have been as an injection assumption.
 */

import type { ProviderConfig } from '../types/provider';

/** The owner's assumed window when nothing better is known (2026-10-20). */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000;

/**
 * Room kept back from the window for things the estimator cannot see: the
 * provider's own chat template, tool schemas (which are NOT part of the message
 * array and so are never counted by `estimateMessagesTokens`), and the small
 * per-request framing the estimator already adds per message but not per tool.
 */
export const WIRE_FRAMING_SAFETY_TOKENS = 4_096;

/** The output budget the transport puts on the wire when a caller names none
 *  (`max_tokens ?? 4096` in all four request builders). A ceiling must reserve
 *  the number the request will actually claim, so an absent or unusable reserve
 *  falls back to THIS rather than to zero: reserving nothing buys prompt room
 *  the answer then cannot use, which is the failure this module exists to
 *  prevent. */
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 4_096;

/** How many recent turns compaction must never collapse, whatever the budget.
 *  The current question, the seat's answer to it and the tool results it is
 *  reasoning over are the minimum a turn needs to stay on-topic. */
export const MIN_KEEP_MESSAGES = 6;

export type ContextWindowSource = 'user' | 'measured' | 'model' | 'default';

export interface ResolvedContextWindow {
    tokens: number;
    source: ContextWindowSource;
    /** One line for the trader: where this number came from. A window that
     *  decides how much of their history survives must never be presented as
     *  though it were measured when it was assumed. */
    label: string;
}

/** The keys `resolveContextWindow` needs, so a caller may pass a subset. */
export type ContextWindowInput = Pick<
    ProviderConfig,
    'contextWindowTokens' | 'modelContextWindows' | 'selectedModel'
> & { id?: string; name?: string };

const positiveInt = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    return Math.floor(v);
};

// ─── Measured limits (learned from a rejection) ─────────────────────────────

/** providerId + modelId → the limit that provider stated. Session-scoped on
 *  purpose: a gateway's window is a property of the deployment, and a restart
 *  that forgets it re-learns it from the first rejection at the cost of one
 *  retried turn — which is cheaper than storing a number a provider may have
 *  changed behind our back. */
const measuredWindows = new Map<string, number>();

const measurementKey = (providerId: string, modelId: string): string =>
    `${providerId}::${modelId}`;

/** Record a window the provider itself stated, so the next turn believes it.
 *  Clamped to the same plausible band as `contextLengthLimitFromError`: a
 *  misread number persists, and a 4-token window would compact every later turn
 *  into nothing — worse than not remembering at all. */
export const recordMeasuredContextWindow = (
    providerId: string,
    modelId: string,
    tokens: number,
): void => {
    if (!modelId || !Number.isFinite(tokens)) return;
    const n = Math.floor(tokens);
    if (n < 512 || n > 100_000_000) return;
    measuredWindows.set(measurementKey(providerId || '', modelId), n);
};

export const measuredContextWindow = (providerId: string, modelId: string): number | null => {
    if (!modelId) return null;
    return measuredWindows.get(measurementKey(providerId || '', modelId)) ?? null;
};

/** Test seam. */
export const resetMeasuredContextWindows = (): void => { measuredWindows.clear(); };

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * The window to hold this call to, and the evidence that earned it.
 *
 * Order: user override → measured limit → the model's own reported window →
 * the 1M default. Each step is a strictly weaker claim about THIS model, and
 * the source is returned rather than discarded because the UI has to say which
 * one it is relying on.
 */
export const resolveContextWindow = (config: ContextWindowInput): ResolvedContextWindow => {
    const override = positiveInt(config.contextWindowTokens);
    if (override) {
        return { tokens: override, source: 'user', label: `your override · ${override.toLocaleString()} tokens` };
    }
    const measured = measuredContextWindow(config.id ?? '', config.selectedModel);
    if (measured) {
        return {
            tokens: measured,
            source: 'measured',
            label: `stated by ${config.name ?? 'the provider'} in a rejected request · ${measured.toLocaleString()} tokens`,
        };
    }
    const reported = positiveInt(config.modelContextWindows?.[config.selectedModel]);
    if (reported) {
        return { tokens: reported, source: 'model', label: `reported for this model · ${reported.toLocaleString()} tokens` };
    }
    return {
        tokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
        source: 'default',
        label: `assumed · ${DEFAULT_CONTEXT_WINDOW_TOKENS.toLocaleString()} tokens (this model has not stated one)`,
    };
};

/**
 * The largest prompt this call may carry.
 *
 * `window − output reserve − framing`, floored at 1,024 tokens: a call with a
 * window too small to hold a reply still has to send *something*, and a zero or
 * negative ceiling would ask the compactor to delete the turn it is answering.
 * The reserve is the request's own output budget — thinking counts inside it,
 * which is exactly why a heavy-thinking model truncates rather than overflows.
 */
export const promptTokenCeiling = (
    windowTokens: number,
    outputReserveTokens: number,
): number => {
    const w = positiveInt(windowTokens) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    const r = positiveInt(outputReserveTokens) ?? DEFAULT_OUTPUT_RESERVE_TOKENS;
    return Math.max(1_024, w - r - WIRE_FRAMING_SAFETY_TOKENS);
};

// ─── Reading a provider's own limit out of a rejection ──────────────────────

/**
 * Context-window rejections are the one error class where the provider states
 * the number we needed, in its message text. The phrasings below are the ones
 * these four wire families actually emit; each captures the LIMIT, not the
 * prompt size, because "200000 tokens > 128000 maximum" contains two numbers
 * and the smaller is the window.
 */
const LIMIT_PATTERNS: RegExp[] = [
    // OpenAI / most OpenAI-compatible gateways.
    /maximum context length is\s*\(?([\d,]+)\)?\s*tokens?/i,
    /max(?:imum)? context length of\s*\(?([\d,]+)\)?\s*tokens?/i,
    /context length is\s*\(?([\d,]+)\)?\s*tokens?/i,
    // "prompt is too long: 210000 tokens > 200000 maximum" (Anthropic).
    />\s*([\d,]+)\s*maximum/i,
    /prompt is too long[^0-9]*([\d,]+)\s*(?:tokens?|characters?).*?max/i,
    // llama.cpp / vLLM / Ollama / Gemini shapes. `[\s_]` because the same
    // quantity is spelled `context_size` by one server and `context size` by
    // another, and `\D{0,12}` is the "is / = / length (" gap between them.
    /(?:n_ctx|context[\s_]+(?:size|window|length)|max[\s_]+context[\s_]+length|model[\s_]+context[\s_]+window|max[\s_]+model[\s_]+len|input[\s_]+token[\s_]+limit)\D{0,12}([\d,]+)/i,
    /(?:context window|context of)\D{0,20}([\d,]+)\s*tokens?/i,
    /\b(?:exceeds?|over|beyond)\b[^0-9]{0,30}?(?:context|input|token)[^0-9]{0,20}([\d,]+)/i,
];

const toNumber = (raw: string): number => Number(raw.replace(/,/g, ''));

/**
 * The window a provider's error text states, or null.
 *
 * Clamped to a plausible band: `1` and `0` show up in these messages as the
 * prompt size or the token count of an empty message, and a window of 4 tokens
 * would make every later request compact to nothing — a wrong-but-bounded
 * reading is worse than no reading, because it persists.
 */
export const contextLengthLimitFromError = (message: string | null | undefined): number | null => {
    const text = (message || '').toString();
    if (!text) return null;
    if (!isContextLengthError(text)) return null;
    for (const pattern of LIMIT_PATTERNS) {
        const m = pattern.exec(text);
        const n = m ? toNumber(m[1]) : NaN;
        if (Number.isFinite(n) && n >= 512 && n <= 100_000_000) return Math.floor(n);
    }
    return null;
};

/** Does this provider error say "your prompt does not fit the window"?
 *  Deliberately narrow: rate limits and payload-size rejections also say
 *  "too long", and compacting history does nothing for either. */
export const isContextLengthError = (message: string | null | undefined): boolean =>
    /context[\s_]+(?:length|size|window|token)|maximum context|prompt is too long|too many tokens|token count|context overflow|input is too long|request payload too large|invalid_request.{0,80}token/i
        .test((message || '').toString());
