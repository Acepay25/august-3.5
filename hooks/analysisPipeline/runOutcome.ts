/**
 * Pipeline stage module — run-outcome catch-path helpers.
 *
 * Extracted from useAnalysisPipeline's catch block: the pure, testable
 * pieces of the cancel-vs-error treatment. The ORCHESTRATION stays in the
 * hook's catch — only it can read the run's own abort-controller ref, mark
 * steps failed, arm the rate-limit reset timer, re-queue an OFFLINE send
 * (tests/offlineQueueCompletion.test.ts pins that enqueue site by source
 * contract), append the final error bubble (it closes over `userMessage` +
 * `casualErrorAttribution`) and decide the ChatRunOutcome. These helpers
 * take explicit parameters or a deps object — no module-level mutable state.
 */

import { Message } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { isQuotaError } from '../../utils/errorUtils';
import { buildModelIdToName } from '../../utils/providerUtils';
import type { EnsembleAnalystEntry } from '../../services/ui/EnsembleAnalystService';

/**
 * Map the conversation through a run's cancel/error: a live-streaming casual
 * bubble must settle (keep whatever text already arrived, drop the streaming
 * flag), an untouched ensemble placeholder is rewritten to explain the debate
 * never started, and an interrupted debate PRESERVES its transcript — never
 * wipe a debate that already produced turns; a bare placeholder (no turns
 * yet) is still removed. Verbatim from the catch block's message sweep.
 */
export const mapRunFailureMessages = (prev: Message[], ctx: {
    cancelled: boolean;
    /** The live-streaming casual-chat bubble id, if one was open. */
    casualMessageId?: string | null;
    /** The ensemble placeholder row, if the debate never started. */
    ensemblePlaceholder?: Message | null;
}): Message[] => prev.map(m => {
    // A live-streaming casual bubble must settle on cancel/error —
    // keep whatever text already arrived, drop the streaming flag.
    if (ctx.casualMessageId && m.id === ctx.casualMessageId) {
        if (!m.text.trim()) return null;
        return { ...m, isStreaming: false };
    }
    if (m.id === ctx.ensemblePlaceholder?.id && m.ensembleProgress) {
        return {
            ...m,
            isDebating: false,
            activeDebateSpeakers: {},
            liveToolEvents: undefined,
            text: ctx.cancelled ? 'The analysis was cancelled.' : 'The ensemble could not continue before the debate started.',
            ensembleProgress: {
                ...m.ensembleProgress,
                moderator: { status: 'error', error: ctx.cancelled ? 'Cancelled by user.' : 'The ensemble could not continue before the debate started.' },
            },
        };
    }
    if (!m.isDebating) return m;
    if ((m.debateTurns?.length ?? 0) === 0) return null;
    return {
        ...m,
        isDebating: false,
        activeDebateSpeakers: {},
        liveToolEvents: undefined,
        replacementOffer: undefined,
        // An interrupted verdict may be incomplete — never leave a
        // provisional card standing in for a final one.
        provisionalAnalysis: undefined,
        provisionalPlanFields: undefined,
        text: ctx.cancelled ? 'The analysis was cancelled.' : 'The debate was interrupted by an error before the moderator could issue a final verdict.',
    };
}).filter((m): m is Message => m !== null);

/** How the catch path treats a run failure, after the cancel check. */
export type RunFailureKind = 'rate-limit' | 'quota' | 'generic';

/**
 * Classify a caught run error. Rate limits are checked FIRST —
 * isQuotaError also claims status === 429, so the dedicated rate-limit
 * path below was previously unreachable.
 */
export const classifyRunFailure = (error: { status?: number; message?: string }): RunFailureKind => {
    if (error.status === 429 || (error.message && error.message.includes('Too Many Requests'))) return 'rate-limit';
    if (isQuotaError(error)) return 'quota';
    return 'generic';
};

/**
 * Which enabled model a quota error is about: match the error text against
 * each enabled provider's display name, or the error's model field against
 * its model id, and surface the human model name.
 */
export const resolveQuotaFlaggedModel = (
    error: { message: string; model?: string },
    providerConfigs: ProviderConfig[],
    enabledProviders: EnsembleAnalystEntry[],
): string => {
    const quotaModelNames = buildModelIdToName(providerConfigs);
    let flaggedModel = '';
    enabledProviders.forEach(p => {
        if (error.message.toLowerCase().includes(p.name.toLowerCase()) || error.model === p.model) {
            flaggedModel = quotaModelNames[p.model] || p.model;
        }
    });
    return flaggedModel;
};

/**
 * Sanitize the fallback: never leak long key-like tokens (API keys)
 * and cap length so internal SDK errors stay readable but bounded.
 */
export const sanitizeFallbackErrorMessage = (rawMessage: string): string =>
    rawMessage.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '***').slice(0, 500);
