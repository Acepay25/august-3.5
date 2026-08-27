/**
 * Phase 4 — Preflight gate (DATA / SOURCE / FALSIFICATION).
 *
 * Every lens prompt includes a fixed preflight block before any other
 * instruction. The lens must produce the three lines itself, or its
 * response is rejected. Rejection rules, in order:
 *
 *   1. Response missing one of DATA:, SOURCE:, FALSIFICATION:
 *      (case-insensitive) → no_preflight.
 *   2. DATA: line is junk (placeholder like N/A, none, —) → junk_data.
 *   3. DATA: line lacks a number, level keyword, or pattern keyword
 *      → non_specific_data.
 *   4. FALSIFICATION: line is < 8 chars → thin_falsification.
 *
 * On rejection, the caller replaces the seat's output with
 * `NO CLAIM — preflight failed (<reason>)` and logs to MemoryInjectionService
 * as a synthetic source for telemetry.
 *
 * The preflight failure is **synchronous** (string match) — no I/O on the
 * hot path. Preflight is advisory in spirit: rejected seats still produce
 * text, but the harness substitutes the placeholder so the debate can
 * continue without a hallucinated call.
 */

import { isMeaningfulLabel } from '../../utils/meaningfulLabel';
import { isSpecificData } from '../../utils/levelKeywords';

export type PreflightFailureReason =
    | 'no_preflight' | 'junk_data' | 'non_specific_data' | 'thin_falsification';

export type PreflightResult =
    | { pass: true }
    | { pass: false; reason: PreflightFailureReason };

const RE_LINE = /^\s*(DATA|SOURCE|FALSIFICATION)\s*[:\-–]\s*(.+)$/im;

const captureLine = (text: string, label: 'DATA' | 'SOURCE' | 'FALSIFICATION'): string | null => {
    // Match the FIRST line that starts with the label, case-insensitive.
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const m = line.match(new RegExp(`^\\s*${label}\\s*[:\\-–]\\s*(.+)$`, 'i'));
        if (m && m[1] && m[1].trim()) return m[1].trim();
    }
    return null;
};

const THIN_FALSIFICATION_MIN = 8;

/** Validate a lens response. Returns `pass: true` only when all three
 *  preflight lines are present, the DATA line is meaningful + specific,
 *  and the FALSIFICATION line is long enough to be a real falsifier. */
export const validateLensResponse = (text: string | undefined | null): PreflightResult => {
    if (!text || typeof text !== 'string') {
        return { pass: false, reason: 'no_preflight' };
    }
    const data = captureLine(text, 'DATA');
    const source = captureLine(text, 'SOURCE');
    const falsification = captureLine(text, 'FALSIFICATION');
    if (!data || !source || !falsification) {
        return { pass: false, reason: 'no_preflight' };
    }
    if (!isMeaningfulLabel(data)) {
        return { pass: false, reason: 'junk_data' };
    }
    if (!isSpecificData(data)) {
        return { pass: false, reason: 'non_specific_data' };
    }
    if (falsification.length < THIN_FALSIFICATION_MIN) {
        return { pass: false, reason: 'thin_falsification' };
    }
    return { pass: true };
};

const REASON_TEXT: Record<PreflightFailureReason, string> = {
    no_preflight: 'no preflight (DATA / SOURCE / FALSIFICATION missing)',
    junk_data: 'junk DATA line (placeholder)',
    non_specific_data: 'DATA line lacks number, level, or pattern keyword',
    thin_falsification: 'FALSIFICATION line is too short to be a real falsifier',
};

/** The user-visible rejection line. */
export const preflightFailureLine = (reason: PreflightFailureReason): string =>
    `NO CLAIM — preflight failed (${REASON_TEXT[reason]})`;

/** Apply the gate to a seat's opening: validate, and on failure return the
 *  NO CLAIM substitute plus the reason for telemetry. Callers record
 *  `passed` per provider (providerFitness.recordPreflightResult) and use
 *  `output` in place of the seat's text only when `passed` is false. */
export const applyPreflightGate = (
    text: string | undefined | null,
): { output: string; passed: boolean; reason?: PreflightFailureReason } => {
    const result = validateLensResponse(text);
    if (result.pass) return { output: text ?? '', passed: true };
    return { output: preflightFailureLine(result.reason), passed: false, reason: result.reason };
};

/** Build the preflight block the lens sees at the top of its prompt. The
 *  block is a fixed template, not a directive — the lens must produce the
 *  three lines itself. */
export const buildPreflightBlock = (): string => `**PREFLIGHT (mandatory — your response is rejected without these three lines):**
DATA: <one specific observation: a number, level, or named pattern/bar>
SOURCE: <where the data came from: chart bar, hybrid snapshot, desk lookup>
FALSIFICATION: <the single observation that, if it occurred, would invalidate this>`;

/** Re-export the regex sets for callers that want to expose them. */
export { LEVEL_OR_VALUE, PATTERN } from '../../utils/levelKeywords';
