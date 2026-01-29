
import { robustJsonParse } from './jsonUtils';

export interface ParsedMarketData {
    prices: Record<string, string>;
    patterns: { name: string; type: string; timeframe: string; confidence?: string; description?: string }[];
    keyZones: { support: string[]; resistance: string[] };
}

export const parseLiveMarketData = (text: string): ParsedMarketData | null => {
    // 1. Try JSON Extraction (High Fidelity)
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        try {
            const data = robustJsonParse(jsonMatch[1]);
            
            // Check if this is the expected Live Market structure
            if (data.timeframes) {
                const prices: Record<string, string> = {};
                const patterns: any[] = [];
                const supports: Set<string> = new Set();
                const resistances: Set<string> = new Set();

                // Flatten the nested timeframe structure
                Object.entries(data.timeframes).forEach(([tf, tfData]: [string, any]) => {
                    // Extract Price
                    if (tfData.price !== undefined && tfData.price !== null) {
                        prices[tf] = String(tfData.price);
                    }
                    
                    // Extract Patterns
                    if (tfData.structural_analysis?.detected_patterns) {
                        tfData.structural_analysis.detected_patterns.forEach((p: any) => {
                            patterns.push({
                                name: p.name,
                                type: p.type,
                                timeframe: tf,
                                confidence: p.confidence ? `${(p.confidence * 100).toFixed(0)}%` : undefined,
                                description: p.description
                            });
                        });
                    }

                    // Extract Key Zones with Timeframe Labels
                    if (tfData.structural_analysis?.key_zones) {
                        if (Array.isArray(tfData.structural_analysis.key_zones.support)) {
                            tfData.structural_analysis.key_zones.support.forEach((s: number) => supports.add(`${s} (${tf})`));
                        }
                        if (Array.isArray(tfData.structural_analysis.key_zones.resistance)) {
                            tfData.structural_analysis.key_zones.resistance.forEach((r: number) => resistances.add(`${r} (${tf})`));
                        }
                    }
                });

                return {
                    prices,
                    patterns,
                    keyZones: {
                        support: Array.from(supports),
                        resistance: Array.from(resistances)
                    }
                };
            }
        } catch (e) {
            console.warn("JSON block found but failed to parse as Market Data", e);
        }
    }

    // 2. Regex Extraction (Fallback for Human-Readable Text or Partial Data)
    const prices: Record<string, string> = {};
    
    // Extract Price: Matches "Price: 3025.59"
    // We try to associate it with a timeframe if possible, otherwise just capture it.
    const priceRegex = /Price:\s*([\d.]+)/gi;
    const timeframeRegex = /(5m|15m|1h|4h)/i;
    
    // Attempt to extract specific timeframe prices if the text is structured
    const tfBlocks = text.split(/\n\s*\n/); // Split by empty lines to isolate blocks
    let globalPrice = "0";

    tfBlocks.forEach(block => {
        const tfMatch = block.match(timeframeRegex);
        const pMatch = block.match(priceRegex);
        if (pMatch && pMatch[1]) {
             // If we found a price
             const priceVal = pMatch[1]; // Captured group from /Price:\s*([\d.]+)/
             // If we found a timeframe in this block
             if (tfMatch) {
                 prices[tfMatch[1].toLowerCase()] = priceVal;
             } else {
                 // Fallback: if we have "Price: X" but no timeframe, maybe it's a general price
                 globalPrice = priceVal;
             }
        }
    });
    
    // If specific timeframe extraction failed but we found a price, populate all
    if (Object.keys(prices).length === 0 && globalPrice !== "0") {
        prices['5m'] = globalPrice;
        prices['15m'] = globalPrice;
        prices['1h'] = globalPrice;
        prices['4h'] = globalPrice;
    } else {
        // Just regex scan the whole text for prices if block splitting failed
        const simplePriceMatch = text.match(/Price:\s*([\d.]+)/i);
        if (simplePriceMatch && Object.keys(prices).length === 0) {
             const p = simplePriceMatch[1];
             prices['5m'] = p; prices['15m'] = p; prices['1h'] = p; prices['4h'] = p;
        }
    }

    // Extract Patterns
    const patterns: any[] = [];
    const patternRegex = /(Head and Shoulders|Inverse Head & Shoulders|Double Bottom|Double Top|Ascending Triangle|Descending Triangle|Symmetrical Triangle|Bearish Engulfing|Bullish Engulfing|Major Bullish Reversal|Major Bearish Reversal)/gi;
    
    let patMatch;
    // We scan the full text
    while ((patMatch = patternRegex.exec(text)) !== null) {
        const name = patMatch[1];
        // Try to infer type from context (next few words)
        const context = text.substring(patMatch.index, patMatch.index + 50).toLowerCase();
        let type = 'neutral';
        if (context.includes('bullish')) type = 'bullish';
        else if (context.includes('bearish')) type = 'bearish';
        else if (name.includes('Bullish')) type = 'bullish';
        else if (name.includes('Bearish')) type = 'bearish';
        else if (name.includes('Bottom')) type = 'bullish';
        else if (name.includes('Top')) type = 'bearish';

        patterns.push({
            name: name,
            type: type,
            timeframe: "Detected", 
            confidence: "High",
            description: "Extracted from text input"
        });
    }

    // Extract Key Zones
    const supportRegex = /Support zone detected at ~([\d.]+)/gi;
    const resistanceRegex = /Resistance zone detected at ~([\d.]+)/gi;
    const supports = new Set<string>();
    const resistances = new Set<string>();

    let sMatch, rMatch;
    while ((sMatch = supportRegex.exec(text)) !== null) supports.add(`${sMatch[1]} (Detected)`);
    while ((rMatch = resistanceRegex.exec(text)) !== null) resistances.add(`${rMatch[1]} (Detected)`);

    if (Object.keys(prices).length > 0 || patterns.length > 0 || supports.size > 0 || resistances.size > 0) {
        return {
            prices,
            patterns,
            keyZones: {
                support: Array.from(supports),
                resistance: Array.from(resistances)
            }
        };
    }

    return null;
};
