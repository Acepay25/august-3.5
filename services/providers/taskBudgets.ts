/**
 * Per-task output-token budgets — the single source of truth for maxTokens
 * at every provider call site. Previously each call site picked its own
 * number (OCR was 1024 and truncated mid-field; chat was 1024; analysis was
 * always 8192 with no rhyme), making token cost and truncation behavior
 * unpredictable across tasks.
 */
export const TASK_BUDGETS = {
  /** Full chart analysis (multi-timeframe + ensemble + accuracy modes). */
  analysis: 8192,
  /** Per-analyst rebuttal round in the real debate. Raised
   *  from 1536 — later rounds stack duties (devil's-advocate case, evidence
   *  citation, name-addressed counters, the mandatory CONVICTION line), and
   *  a truncated seat silently lost its sealed conviction from the auction. */
  rebuttal: 2560,
  /** Clarification answers (60-100 words). */
  clarification: 400,
  /** Vision/OCR structured report — 6 sections; 1024 truncated mid-field. */
  ocr: 2560,
  /** Casual chat reply. */
  chat: 2048,
  /** Post-mortem report (WIN/LOSS/ENTRY_NOT_HIT sections + IF/THEN rule). */
  postMortem: 8192,
} as const;
