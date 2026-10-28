import { TradeAnalysis } from '../types/analysis';
import { TradeOutcome } from '../types/enums';

export type SetupLifecycleStage = 'draft' | 'watching' | 'active' | 'modified' | 'resolved' | 'expired' | 'skipped';

export interface SetupLifecycleState {
    stage: SetupLifecycleStage;
    label: string;
    summary: string;
    nextAction: string;
    isTerminal: boolean;
    expiresAt?: string;
}

/**
 * Derive the user-facing lifecycle from the existing analysis/trade fields.
 * This is intentionally advisory: it never implies exchange execution.
 */
export const getSetupLifecycle = (
    analysis: TradeAnalysis,
    outcome?: TradeOutcome,
    now: number = Date.now(),
    triggeredEntryIndices?: number[]
): SetupLifecycleState => {
    const createdAt = analysis.createdAt ? new Date(analysis.createdAt).getTime() : NaN;
    const validity = analysis.validityDurationMinutes;
    const expiresAt = Number.isFinite(createdAt) && validity && validity > 0
        ? new Date(createdAt + validity * 60_000).toISOString()
        : undefined;
    const expired = expiresAt ? now >= new Date(expiresAt).getTime() : false;

    if (outcome === TradeOutcome.WIN || outcome === TradeOutcome.LOSS) {
        return { stage: 'resolved', label: 'Resolved', summary: `Outcome recorded: ${outcome === TradeOutcome.WIN ? 'win' : 'loss'}.`, nextAction: 'Review the result and capture the lesson.', isTerminal: true, expiresAt };
    }
    if (outcome === TradeOutcome.ENTRY_NOT_HIT || expired) {
        return { stage: 'expired', label: 'Expired', summary: 'The entry was not confirmed before the setup window closed.', nextAction: 'Review or archive this setup before acting on it.', isTerminal: true, expiresAt };
    }
    if (outcome === TradeOutcome.SKIPPED) {
        return { stage: 'skipped', label: 'Skipped', summary: 'This setup was intentionally not taken.', nextAction: 'Keep it for review or remove it from your active journal.', isTerminal: true, expiresAt };
    }
    if (outcome === TradeOutcome.PENDING) {
        if (triggeredEntryIndices && triggeredEntryIndices.length > 0) {
            return { stage: 'active', label: 'Active', summary: 'An entry has been marked as triggered.', nextAction: 'Monitor invalidation and manage the planned levels manually.', isTerminal: false, expiresAt };
        }
        if (analysis.isUpdate) {
            return { stage: 'modified', label: 'Modified', summary: 'The setup was updated after the original analysis.', nextAction: 'Confirm the revised levels and keep monitoring.', isTerminal: false, expiresAt };
        }
        return { stage: 'watching', label: 'Watching entry', summary: 'Waiting for the planned entry condition.', nextAction: 'Wait for entry confirmation; do not treat this as execution.', isTerminal: false, expiresAt };
    }

    return { stage: 'draft', label: 'Draft', summary: 'Analysis is available but has not been logged as a trade.', nextAction: 'Review the plan, then log or skip it.', isTerminal: false, expiresAt };
};
