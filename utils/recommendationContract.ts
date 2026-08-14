import { RecommendationContract, TradeAnalysis } from '../types';

export const buildRecommendationContract = (analysis: TradeAnalysis): RecommendationContract => {
    const avoid = analysis.confidence === 'Avoid' || analysis.direction === 'Neutral';
    const action: RecommendationContract['action'] = avoid
        ? 'avoid'
        : analysis.direction === 'Long'
            ? 'long'
            : analysis.direction === 'Short'
                ? 'short'
                : 'wait';
    const sl = (analysis.stopLoss || '').trim();
    const riskBoundary = avoid
        ? 'No position — skip this setup'
        : sl
            ? `Hard stop ${sl}${analysis.stopLossPercentage ? ` (${analysis.stopLossPercentage})` : ''}`
            : 'Stop not defined — not tradeable';
    const coin = (analysis.coinName || '').trim();
    const thesis = avoid
        ? `No trade${coin ? ` on ${coin}` : ''}`
        : `${analysis.direction} ${coin}`.trim();
    return {
        action,
        riskBoundary,
        invalidation: analysis.invalidationCriteria || [],
        validityMinutes: analysis.validityDurationMinutes,
        thesis,
    };
};
