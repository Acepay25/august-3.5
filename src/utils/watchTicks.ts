import { TradeAnalysis } from '../types';
import { parsePrice } from './analysisUtils';

export const describeWatchTick = (
    analysis: TradeAnalysis,
    price: number,
    previousPrice?: number,
): { kind: 'price' | 'invalidation'; detail: string } | null => {
    if (!Number.isFinite(price) || price <= 0) return null;
    const px = Math.round(price * 100) / 100;
    const invalidationHit = (analysis.invalidationCriteria || []).some(c => {
        const level = parsePrice(c.level || '');
        if (!Number.isFinite(level) || level <= 0) return false;
        if (analysis.direction === 'Long') return price < level;
        if (analysis.direction === 'Short') return price > level;
        return Math.abs(price - level) / level < 0.001;
    });
    if (invalidationHit) {
        return { kind: 'invalidation', detail: `Price ${px} crossed an invalidation level` };
    }
    if (previousPrice && previousPrice > 0) {
        const move = Math.abs(price - previousPrice) / previousPrice;
        if (move < 0.0025) return null;
        const dir = price > previousPrice ? 'up' : 'down';
        return { kind: 'price', detail: `${px} (${dir} ${(move * 100).toFixed(2)}%)` };
    }
    return { kind: 'price', detail: `Mark ${px}` };
};
