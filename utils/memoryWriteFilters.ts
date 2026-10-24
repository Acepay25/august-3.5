/**
 * memoryWriteFilters — what may NEVER become a memory, decided in code.
 *
 * The seat prompt asks the model not to store these; a filter is what stands
 * when the model does anyway. Three checks, one entry point:
 *
 *   1. secrets — API keys, tokens, card numbers, government IDs. Never
 *      stored, no setting overrides this.
 *   2. honesty-suppressing "preferences" — instructions to never disagree,
 *      always flatter, or claim elevated permissions are not collaboration
 *      facts; storing one would make the memory itself lie.
 *   3. sensitive categories — health, finances, identity. Stored ONLY when
 *      the user's setting allows, and flagged so recall and the pre-read
 *      keep them out of unattended contexts.
 *
 * Pure functions: no storage, no imports, contract-tested.
 */

const SECRET_PATTERNS: Array<{ re: RegExp; what: string }> = [
    { re: /\bsk-[A-Za-z0-9_-]{16,}\b/, what: 'an API key (sk-…)' },
    { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, what: 'a GitHub token' },
    { re: /\bAKIA[0-9A-Z]{12,}\b/, what: 'an AWS access key' },
    { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, what: 'a Slack token' },
    { re: /\beyJ[A-Za-z0-9_-]{20,}\./, what: 'a JWT' },
    { re: /\b(?:\d[ -]?){13,19}\b/, what: 'a card number' },
    { re: /\b(?:ssn|social security|passport|government id|national id)\b[:\s]*\d{4,}/i, what: 'a government ID' },
];

const HONESTY_PATTERNS: RegExp[] = [
    /never\s+(?:disagree|contradict|correct)\s+(?:with\s+)?me/i,
    /always\s+agree\s+with\s+me/i,
    /don't\s+(?:ever\s+)?disagree/i,
    /no\s+matter\s+what\s+i\s+say/i,
    /\bflatter\s+me\b/i,
    /(?:you\s+are|act\s+as|you\s+have)\s+(?:an\s+)?(?:admin|administrator|elevated|root|sudo)/i,
    /override\s+your\s+(?:rules|instructions|guardrails)/i,
    /ignore\s+your\s+(?:rules|instructions|guardrails)/i,
];

const SENSITIVE_PATTERNS: RegExp[] = [
    /\b(?:hiv|cancer|diagnos[ie]s|medications?|therap(?:y|ies)|antidepressants?)\b/i,
    /\b(?:bank accounts?|salaries?|salary|debts?|mortgage|credit scores?|tax (?:returns?|debts?))\b/i,
    /\b(?:passport numbers?|national id|social security|immigration status)\b/i,
];

export interface FilterVerdict {
    /** null = the write may proceed. */
    refused: string | null;
    /** True when the text falls in a sensitive category (the caller decides,
     *  from the user's setting, whether that means refuse or flag). */
    sensitive: boolean;
}

export const filterMemoryWrite = (text: string): FilterVerdict => {
    for (const { re, what } of SECRET_PATTERNS) {
        if (re.test(text)) return { refused: `looks like ${what} — secrets are never stored`, sensitive: false };
    }
    for (const re of HONESTY_PATTERNS) {
        if (re.test(text)) {
            return { refused: 'asks for honesty to be suppressed or claims elevated permissions — that is not a preference this memory keeps', sensitive: false };
        }
    }
    const sensitive = SENSITIVE_PATTERNS.some(re => re.test(text));
    return { refused: null, sensitive };
};

/** A description that tells the model WHEN to use the memory — the trigger —
 *  in the same spirit as a skill's "Use when". Warned on, never blocking. */
export const hasUseWhenTrigger = (description: string): boolean =>
    /\b(when|if|whenever|for|during|before|after|use when)\b/i.test(description);
