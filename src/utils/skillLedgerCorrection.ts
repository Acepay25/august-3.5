/**
 * The pure arithmetic of correcting ONE settled outcome in a skill's ledger.
 *
 * A correction flips a settled outcome's CLASS (WIN ↔ LOSS). The trade's R and
 * net R do not move with it — the journal corrects the classification and the
 * PnL separately — so the cost accumulators (`netR`, `grossR`, `rSampled`) are
 * deliberately untouched. What does move: the win/loss counters, the recent
 * outcomes tail, the consecutive-loss streak, the per-regime split, and, for a
 * control trade, the control counters. This module owns those deltas so the
 * correction path cannot invent a second opinion about what one outcome is
 * worth.
 *
 * Counters clamp at zero. A correction is a repair; a repair that would push a
 * record negative is evidence the record was already wrong, and a negative
 * sample is worse than a floored one.
 */

export type CorrectionOutcome = 'WIN' | 'LOSS';

export interface CorrectableLedger {
    wins: number;
    losses: number;
    consecutiveLosses: number;
    recentOutcomes?: string;
    regimeStats?: Record<string, { w: number; l: number }>;
    controlWins?: number;
    controlLosses?: number;
}

export interface OutcomeCorrection {
    /** A FOLLOWED trade moves the skill's record; a CONTROL trade was matched
     *  but not injected, and only ever moved the control counters. */
    kind: 'followed' | 'control';
    from: CorrectionOutcome;
    to: CorrectionOutcome;
    /** 1 = the newest followed trade. Above the tail length the outcome sits
     *  outside `recentOutcomes`, so only the lifetime counters move. */
    indexFromEnd: number;
    /** The regime the trade was counted under, when the fold split it. */
    regime?: string;
}

export interface OutcomeCorrectionResult {
    /** True when the tail slot was inside `recentOutcomes` and was rewritten. */
    tailUpdated: boolean;
}

const isWin = (outcome: CorrectionOutcome): boolean => outcome === 'WIN';

export const applyOutcomeCorrection = (
    ledger: CorrectableLedger,
    correction: OutcomeCorrection,
): OutcomeCorrectionResult => {
    const { from, to, kind } = correction;
    if (from === to) return { tailUpdated: false };

    const winDelta = (isWin(to) ? 1 : 0) - (isWin(from) ? 1 : 0);
    const lossDelta = (isWin(to) ? 0 : 1) - (isWin(from) ? 0 : 1);

    if (kind === 'control') {
        ledger.controlWins = Math.max(0, (ledger.controlWins ?? 0) + winDelta);
        ledger.controlLosses = Math.max(0, (ledger.controlLosses ?? 0) + lossDelta);
        return { tailUpdated: false };
    }

    ledger.wins = Math.max(0, ledger.wins + winDelta);
    ledger.losses = Math.max(0, ledger.losses + lossDelta);

    const tail = ledger.recentOutcomes ?? '';
    const slot = tail.length - correction.indexFromEnd;
    let tailUpdated = false;
    if (slot >= 0 && slot < tail.length) {
        const chars = tail.split('');
        chars[slot] = isWin(to) ? 'W' : 'L';
        ledger.recentOutcomes = chars.join('');
        // The streak is the trailing L run in the window. Only a rewrite inside
        // the window can change it; a trade outside the window cannot touch the
        // CURRENT run. A streak longer than the 12-outcome window is read from
        // that window — the same cap the alpha-decay already uses.
        ledger.consecutiveLosses = (ledger.recentOutcomes.match(/L+$/) ?? [''])[0].length;
        tailUpdated = true;
    }

    if (correction.regime) {
        const stats = ledger.regimeStats?.[correction.regime];
        if (stats) {
            stats.w = Math.max(0, stats.w + winDelta);
            stats.l = Math.max(0, stats.l + lossDelta);
        }
    }
    return { tailUpdated };
};
