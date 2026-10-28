
import { UserProfile } from '../types';

export const isValidUserProfile = (obj: any): obj is UserProfile => {
    if (!obj || typeof obj !== 'object') return false;

    const hasBasicFields =
        typeof obj.username === 'string' &&
        Array.isArray(obj.conversations) &&
        Array.isArray(obj.tradeLog) &&
        typeof obj.settings === 'object' &&
        obj.settings !== null &&
        Array.isArray(obj.settings.activeFrameworks);

    if (!hasBasicFields) return false;

    if (obj.conversations.length > 0) {
        const firstConv = obj.conversations[0];
        if (!firstConv || typeof firstConv.id !== 'string' || !Array.isArray(firstConv.messages)) {
            return false;
        }
    }

    if (obj.tradeLog.length > 0) {
        // Every row, not just the first: one poisoned row is enough to break the
        // CSV export, and a validator that samples cannot promise the shape the
        // readers depend on. And `typeof x === 'object'` is TRUE for `null`, which
        // is how an imported profile with `analysis: null` passed and then threw at
        // `t.analysis.coinName` in reportExport (the 2026-10-27 audit A-7).
        for (const trade of obj.tradeLog) {
            if (!trade || typeof trade.id !== 'string' || typeof trade.outcome !== 'string') return false;
            if (!trade.analysis || typeof trade.analysis !== 'object') return false;
        }
    }


    return true;
};
