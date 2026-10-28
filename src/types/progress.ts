// Run-status vocabulary shared by the engine and its surfaces.

export type AnalysisStepStatus = 'pending' | 'running' | 'complete' | 'error' | 'stopped';

/** Closed set of machine-readable failure causes. Rendered as a word next to
 *  the colour, never as a colour alone. */
export type StepErrorKind =
    | 'provider_rate_limit'
    | 'provider_timeout'
    | 'provider_auth'
    | 'provider_error'
    | 'data_unavailable'
    | 'parse_failed'
    | 'cancelled'
    | 'unknown';
