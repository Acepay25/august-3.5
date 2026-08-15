import { TradeAnalysis } from '../types';
import { citeLevel } from './levelEvidence';

/** Force Avoid when a directional ticket has an ungrounded Entry or SL. */
export const enforceUngroundedLevels = <T extends TradeAnalysis>(analysis: T): T => {
    if (analysis.confidence === 'Avoid' || analysis.direction === 'Neutral') return analysis;
    const entry = analysis.entryPoints?.[0]?.price;
    const sl = analysis.stopLoss;
    const entryCite = entry ? citeLevel('Entry', entry, analysis.evidence, analysis.levelCitations) : { source: 'ungrounded' };
    const slCite = sl ? citeLevel('Stop Loss', sl, analysis.evidence, analysis.levelCitations) : { source: 'ungrounded' };
    const missing: string[] = [];
    if (!entry || entryCite.source === 'ungrounded') missing.push('Entry');
    if (!sl || slCite.source === 'ungrounded') missing.push('SL');
    if (missing.length === 0) return analysis;
    return {
        ...analysis,
        originalConfidence: analysis.originalConfidence ?? analysis.confidence,
        direction: 'Neutral',
        confidence: 'Avoid',
        validationWarnings: [
            ...(analysis.validationWarnings ?? []),
            `Ungrounded ${missing.join(' / ')} — forced Neutral (cite hybrid/OCR or do not trade).`,
        ],
    };
};
