// Analysis pipeline progress types - Task UI step tracking

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

export interface AnalysisSubStep {
  label: string;
  detail?: string;
  filename?: string;  // Rendered via TaskItemFile (basename only)
}

export interface AnalysisStep {
  id: string;
  title: string;
  status: AnalysisStepStatus;
  subSteps?: AnalysisSubStep[];
  startTime?: number;
  endTime?: number;
  /** Why this step failed, as one readable sentence.
   *
   *  This field did not exist, so the UI could only paint a red ✕ with no
   *  reason and a thrown run fell through to rendering raw provider text in
   *  the chat. Any step that can fail must carry the reason with it. */
  errorText?: string;
  /** Machine-readable cause, so colour + word + an expandable detail can all
   *  come from one place instead of being re-guessed at each render site. */
  errorKind?: StepErrorKind;
}
