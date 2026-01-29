
import { Kline } from '../types';

export interface DetectedPattern {
    name: string;
    type: 'bullish' | 'bearish' | 'neutral';
    confidence: number; // 0 to 1
    description: string;
    significance: string;
}

export interface KeyZones {
    support: number[];
    resistance: number[];
}

// Helper to find local pivots (highs and lows)
// A pivot high is a bar higher than 'n' bars to the left and 'n' bars to the right
const findPivots = (klines: Kline[], leftBars: number = 5, rightBars: number = 2) => {
    const highs: { price: number; index: number }[] = [];
    const lows: { price: number; index: number }[] = [];

    for (let i = leftBars; i < klines.length - rightBars; i++) {
        const current = klines[i];
        
        // Check High
        let isHigh = true;
        for (let j = 1; j <= leftBars; j++) if (klines[i - j].high > current.high) isHigh = false;
        for (let j = 1; j <= rightBars; j++) if (klines[i + j].high > current.high) isHigh = false;
        if (isHigh) highs.push({ price: current.high, index: i });

        // Check Low
        let isLow = true;
        for (let j = 1; j <= leftBars; j++) if (klines[i - j].low < current.low) isLow = false;
        for (let j = 1; j <= rightBars; j++) if (klines[i + j].low < current.low) isLow = false;
        if (isLow) lows.push({ price: current.low, index: i });
    }
    return { highs, lows };
};

export const detectKeyZones = (klines: Kline[]): KeyZones => {
    const { highs, lows } = findPivots(klines, 10, 5); // Use wider pivots for zones
    const currentPrice = klines[klines.length - 1].close;
    
    // Cluster Logic: Group pivots that are close to each other (within 0.5%)
    const clusterLevels = (levels: number[]) => {
        if (levels.length === 0) return [];
        const sorted = levels.sort((a, b) => a - b);
        const clusters: number[] = [];
        let currentCluster: number[] = [sorted[0]];
        
        for (let i = 1; i < sorted.length; i++) {
            const prev = currentCluster[currentCluster.length - 1];
            const diff = (sorted[i] - prev) / prev;
            
            if (diff < 0.005) { // 0.5% tolerance
                currentCluster.push(sorted[i]);
            } else {
                // Push average of previous cluster
                const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
                clusters.push(parseFloat(avg.toFixed(2)));
                currentCluster = [sorted[i]];
            }
        }
        // Push last cluster
        const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
        clusters.push(parseFloat(avg.toFixed(2)));
        
        return clusters;
    };

    const resistanceRaw = highs.map(h => h.price).filter(p => p >= currentPrice * 0.99); // Relevant resistance
    const supportRaw = lows.map(l => l.price).filter(p => p <= currentPrice * 1.01); // Relevant support

    return {
        resistance: clusterLevels(resistanceRaw).slice(-5), // Top 5
        support: clusterLevels(supportRaw).slice(-5) // Top 5
    };
};

export const detectChartPatterns = (klines: Kline[]): DetectedPattern[] => {
    const patterns: DetectedPattern[] = [];
    const { highs, lows } = findPivots(klines, 5, 3); // Tuned for 15m/1h charts
    const recentHighs = highs.slice(-5); // Look at last 5 pivot highs
    const recentLows = lows.slice(-5);   // Look at last 5 pivot lows

    if (klines.length < 50) return patterns;

    const currentPrice = klines[klines.length - 1].close;

    // 1. DETECT HEAD AND SHOULDERS (Bearish)
    // Logic: Left Shoulder (LS), Head (H), Right Shoulder (RS). H > LS, H > RS. LS ~= RS.
    if (recentHighs.length >= 3) {
        const [ls, head, rs] = recentHighs.slice(-3);
        
        const isHeadHighest = head.price > ls.price && head.price > rs.price;
        const shouldersLevel = Math.abs(ls.price - rs.price) / ls.price < 0.03; // Within 3%
        const notTooFar = (klines.length - rs.index) < 20; // Pattern is recent

        if (isHeadHighest && shouldersLevel && notTooFar) {
            patterns.push({
                name: 'Head and Shoulders',
                type: 'bearish',
                confidence: 0.85,
                description: `Shoulders at ~${ls.price.toFixed(2)}, Head at ${head.price.toFixed(2)}`,
                significance: 'Major Bearish Reversal'
            });
        }
    }

    // 2. DETECT INVERSE HEAD AND SHOULDERS (Bullish)
    if (recentLows.length >= 3) {
        const [ls, head, rs] = recentLows.slice(-3);
        
        const isHeadLowest = head.price < ls.price && head.price < rs.price;
        const shouldersLevel = Math.abs(ls.price - rs.price) / ls.price < 0.03;
        const notTooFar = (klines.length - rs.index) < 20;

        if (isHeadLowest && shouldersLevel && notTooFar) {
            patterns.push({
                name: 'Inverse Head & Shoulders',
                type: 'bullish',
                confidence: 0.85,
                description: `Shoulders at ~${ls.price.toFixed(2)}, Head at ${head.price.toFixed(2)}`,
                significance: 'Major Bullish Reversal'
            });
        }
    }

    // 3. DETECT DOUBLE TOP (Bearish)
    // Logic: Two recent highs at similar price levels.
    if (recentHighs.length >= 2) {
        const [peak1, peak2] = recentHighs.slice(-2);
        const priceDiff = Math.abs(peak1.price - peak2.price) / peak1.price;
        const timeDiff = peak2.index - peak1.index;
        const notTooFar = (klines.length - peak2.index) < 15;

        if (priceDiff < 0.015 && timeDiff > 5 && notTooFar) { // Within 1.5%
            patterns.push({
                name: 'Double Top',
                type: 'bearish',
                confidence: 0.8,
                description: `Resistance zone detected at ~${peak1.price.toFixed(2)}`,
                significance: 'Bearish Reversal'
            });
        }
    }

    // 4. DETECT DOUBLE BOTTOM (Bullish)
    if (recentLows.length >= 2) {
        const [trough1, trough2] = recentLows.slice(-2);
        const priceDiff = Math.abs(trough1.price - trough2.price) / trough1.price;
        const timeDiff = trough2.index - trough1.index;
        const notTooFar = (klines.length - trough2.index) < 15;

        if (priceDiff < 0.015 && timeDiff > 5 && notTooFar) {
            patterns.push({
                name: 'Double Bottom',
                type: 'bullish',
                confidence: 0.8,
                description: `Support zone detected at ~${trough1.price.toFixed(2)}`,
                significance: 'Bullish Reversal'
            });
        }
    }

    // 5. DETECT TRIANGLES (Ascending/Descending)
    // Simplified logic: Analyze slope of recent 3 highs and recent 3 lows
    if (recentHighs.length >= 3 && recentLows.length >= 3) {
        // Slopes
        const h1 = recentHighs[recentHighs.length-3].price;
        const h2 = recentHighs[recentHighs.length-2].price;
        const h3 = recentHighs[recentHighs.length-1].price;
        
        const l1 = recentLows[recentLows.length-3].price;
        const l2 = recentLows[recentLows.length-2].price;
        const l3 = recentLows[recentLows.length-1].price;

        // Check for Lower Highs (Bearish Trendline)
        const lowerHighs = h2 < h1 * 0.998 && h3 < h2 * 0.998;
        // Check for Flat Highs (Resistance)
        const flatHighs = Math.abs(h1 - h2) / h1 < 0.005 && Math.abs(h2 - h3) / h2 < 0.005;

        // Check for Higher Lows (Bullish Trendline)
        const higherLows = l2 > l1 * 1.002 && l3 > l2 * 1.002;
        // Check for Flat Lows (Support)
        const flatLows = Math.abs(l1 - l2) / l1 < 0.005 && Math.abs(l2 - l3) / l2 < 0.005;

        if (flatHighs && higherLows) {
            patterns.push({
                name: 'Ascending Triangle',
                type: 'bullish',
                confidence: 0.75,
                description: 'Flat resistance with higher lows.',
                significance: 'Bullish Continuation'
            });
        } else if (lowerHighs && flatLows) {
            patterns.push({
                name: 'Descending Triangle',
                type: 'bearish',
                confidence: 0.75,
                description: 'Flat support with lower highs.',
                significance: 'Bearish Continuation'
            });
        } else if (lowerHighs && higherLows) {
             patterns.push({
                name: 'Symmetrical Triangle',
                type: 'neutral',
                confidence: 0.7,
                description: 'Price coiling with lower highs and higher lows.',
                significance: 'Breakout Imminent'
            });
        }
    }

    return patterns;
};
