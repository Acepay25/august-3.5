
import { UserProfile } from '../types';

export const isValidUserProfile = (obj: any): obj is UserProfile => {
    if (!obj || typeof obj !== 'object') return false;

    const hasBasicFields =
        typeof obj.username === 'string' &&
        Array.isArray(obj.conversations) &&
        Array.isArray(obj.tradeLog) &&
        Array.isArray(obj.savedAnalyses) &&
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
        const firstTrade = obj.tradeLog[0];
        if (!firstTrade || typeof firstTrade.id !== 'string' || typeof firstTrade.outcome !== 'string' || typeof firstTrade.analysis !== 'object') {
            return false;
        }
    }

    if (obj.savedAnalyses.length > 0) {
        const firstAnalysis = obj.savedAnalyses[0];
        if (!firstAnalysis || typeof firstAnalysis.id !== 'string' || typeof firstAnalysis.userPrompt !== 'string' || typeof firstAnalysis.analysis !== 'object') {
            return false;
        }
    }

    return true;
};
