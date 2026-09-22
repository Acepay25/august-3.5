/**
 * One status vocabulary for the whole run.
 *
 * Before this, "running", "failed" and "cancelled" were painted
 * independently at each render site, so a red ✕ could mean a rate limit, a
 * parse failure or a dead data feed and the user had no way to tell — and a
 * user-initiated Stop was coloured the same as a provider failure.
 *
 * Two rules this enforces:
 *   · status is never carried by colour alone — every state has a word;
 *   · `stopped` is NEUTRAL and only `errored` is destructive. Cancelling your
 *     own run is not a loss.
 */

import type { AnalysisStepStatus, StepErrorKind } from '../types/progress';

export interface RunStatusPresentation {
    /** Dot/swatch classes. */
    dot: string;
    /** Label text classes. */
    text: string;
    /** The word shown next to the colour. */
    label: string;
    /** Screen-reader text, kept separate from the visible word. */
    srLabel: string;
}

export const RUN_STATUS_PRESENTATION: Record<AnalysisStepStatus, RunStatusPresentation> = {
    pending: {
        dot: 'bg-zinc-600',
        text: 'text-zinc-500',
        label: 'Queued',
        srLabel: 'Queued, not started',
    },
    running: {
        dot: 'bg-cyan-400',
        text: 'text-cyan-300',
        label: 'Running',
        srLabel: 'Running',
    },
    complete: {
        dot: 'bg-zinc-400',
        text: 'text-zinc-300',
        label: 'Done',
        srLabel: 'Completed',
    },
    // A cancel is NOT a failure: neutral chrome, deliberately not rose.
    stopped: {
        dot: 'bg-zinc-500',
        text: 'text-zinc-400',
        label: 'Stopped',
        srLabel: 'Stopped by you',
    },
    error: {
        dot: 'bg-rose-500',
        text: 'text-rose-300',
        label: 'Failed',
        srLabel: 'Failed',
    },
};

export const runStatusPresentation = (status: AnalysisStepStatus): RunStatusPresentation =>
    RUN_STATUS_PRESENTATION[status] ?? RUN_STATUS_PRESENTATION.pending;

/** Human word for a machine-readable failure cause. */
export const STEP_ERROR_LABEL: Record<StepErrorKind, string> = {
    provider_rate_limit: 'Rate limited',
    provider_timeout: 'Timed out',
    provider_auth: 'Key rejected',
    provider_error: 'Provider error',
    data_unavailable: 'Market data missing',
    parse_failed: 'Answer unparseable',
    cancelled: 'Stopped',
    unknown: 'Failed',
};

/** One actionable sentence per cause. The raw provider body is never shown —
 *  it can carry URLs and request dumps. */
const STEP_ERROR_HINT: Record<StepErrorKind, string> = {
    provider_rate_limit: 'The provider rate-limited this request. Wait for the backoff to clear, or lower the seat count.',
    provider_timeout: 'The provider did not answer within the request window.',
    provider_auth: 'The API key for this provider was rejected. Check Settings → Providers.',
    provider_error: 'The provider returned an error for this request.',
    data_unavailable: 'Market data needed for this step was unavailable, so it could not complete.',
    parse_failed: 'The model answered, but not in a form the app could read.',
    cancelled: 'You stopped this run.',
    unknown: 'This step failed.',
};

export const stepErrorLabel = (kind: StepErrorKind | undefined): string =>
    STEP_ERROR_LABEL[kind ?? 'unknown'];

/** Strip anything shaped like a credential and cap the length before an error
 *  string reaches the UI. Mirrors the pipeline's own fallback sanitizer so
 *  both paths behave identically. */
export const sanitizeErrorText = (raw: unknown, maxLen = 300): string => {
    const message = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '';
    return message
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '***')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLen);
};

/** Full readable reason: the cause's own hint plus the sanitized provider
 *  message when there is one. Never empty — a failed step must always say why. */
export const describeStepError = (
    kind: StepErrorKind | undefined,
    detail?: string,
): string => {
    const hint = STEP_ERROR_HINT[kind ?? 'unknown'];
    const extra = detail?.trim();
    return extra ? `${hint} ${extra}` : hint;
};

interface StatusBearing {
    status?: unknown;
    name?: unknown;
    code?: unknown;
    message?: unknown;
}

/**
 * Classify a thrown error into the closed StepErrorKind set.
 *
 * Reads numeric fields only. Never branches on error TEXT to decide a
 * classification — provider wording varies by gateway and a substring test on
 * a message is how a 401 gets labelled "unknown".
 */
export const classifyStepError = (error: unknown): { kind: StepErrorKind; text: string } => {
    const err = (error ?? {}) as StatusBearing;
    const name = typeof err.name === 'string' ? err.name : '';
    // A `TimeoutError` is never the trader. Only AbortSignal.timeout produces
    // that name — the request and stream windows in GenericProviderService —
    // and a Stop from the UI raises `AbortError` on its own controller, which
    // survives AbortSignal.any. Folding the two together told the user they
    // cancelled a run that the provider had actually stalled, and left
    // `provider_timeout` with no path to ever render its own sentence.
    if (name === 'TimeoutError') {
        return { kind: 'provider_timeout', text: STEP_ERROR_HINT.provider_timeout };
    }
    if (name === 'AbortError') {
        return { kind: 'cancelled', text: STEP_ERROR_HINT.cancelled };
    }

    const status = typeof err.status === 'number' ? err.status : NaN;
    let kind: StepErrorKind = 'unknown';
    if (status === 429) kind = 'provider_rate_limit';
    else if (status === 401 || status === 403) kind = 'provider_auth';
    else if (status >= 500 && status < 600) kind = 'provider_error';
    else if (Number.isFinite(status) && status >= 400 && status < 500) kind = 'provider_error';

    const detail = sanitizeErrorText(err.message ?? error);
    return { kind, text: describeStepError(kind, detail) };
};
