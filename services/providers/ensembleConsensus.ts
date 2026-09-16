import type { AnalystConsensus, TradeAnalysis } from '../../types';
import { parsePrice } from '../../utils/analysisUtils';

// =============================================================================
// PRE-DEBATE DIVERGENCE CHECK & ECHO CHAMBER PREVENTION
// =============================================================================

/**
 * Result of pre-debate divergence analysis
 */
export interface DivergenceAnalysis {
    score: number; // 0-100: 0 = complete agreement, 100 = total disagreement
    isEchoChamber: boolean; // True if all analysts agree too quickly
    divergenceType: 'none' | 'direction' | 'confidence' | 'entry' | 'multiple';
    details: string[];
    syntheticDissentRequired: boolean;
    dissentProtocol: string;
}

/**
 * Analyze analyst results before debate to detect echo chambers and calculate divergence.
 * Returns a divergence score and recommended actions for the moderator.
 */
export const analyzePreDebateDivergence = (
    analystsResults: { analysis: TradeAnalysis, thoughtProcess?: string, finalOutput?: string }[],
    _analystNames: string[]
): DivergenceAnalysis => {
    if (analystsResults.length < 2) {
        return {
            score: 0,
            isEchoChamber: false,
            divergenceType: 'none',
            details: [],
            syntheticDissentRequired: false,
            dissentProtocol: '',
        };
    }

    const details: string[] = [];
    let divergenceScore = 0;
    let divergenceType: DivergenceAnalysis['divergenceType'] = 'none';

    // Check 1: Direction Agreement
    const directions = analystsResults.map(r => r.analysis.direction?.toLowerCase() || 'unknown');
    const uniqueDirections = new Set(directions);
    if (uniqueDirections.size === 1) {
        details.push(`All analysts agree on direction: ${directions[0].toUpperCase()} `);
    } else {
        divergenceScore += 40;
        divergenceType = 'direction';
        details.push(`Direction disagreement: ${directions.join(' vs ')} `);
    }

    // Check 2: Confidence Level Agreement
    const confidences = analystsResults.map(r => r.analysis.confidence?.toLowerCase() || 'medium');
    const uniqueConfidences = new Set(confidences);
    if (uniqueConfidences.size === 1) {
        details.push(`All analysts have ${confidences[0]} confidence`);
    } else {
        divergenceScore += 20;
        if (divergenceType === 'none') divergenceType = 'confidence';
        else divergenceType = 'multiple';
        details.push(`Confidence spread: ${confidences.join(' vs ')} `);
    }

    // Check 3: Entry Price Divergence
    const entries = analystsResults
        .map(r => {
            const entry = r.analysis.entryPoints?.[0]?.price;
            return typeof entry === 'string' ? parsePrice(entry) : entry;
        })
        .filter(e => !isNaN(e)) as number[];

    if (entries.length >= 2) {
        const maxEntry = Math.max(...entries);
        const minEntry = Math.min(...entries);
        const entrySpread = maxEntry > 0 ? ((maxEntry - minEntry) / maxEntry) * 100 : 0;

        if (entrySpread > 2) {
            divergenceScore += 25;
            if (divergenceType === 'none') divergenceType = 'entry';
            else divergenceType = 'multiple';
            details.push(`Entry price divergence: ${entrySpread.toFixed(1)}% spread`);
        } else {
            details.push(`Entry prices aligned(within ${entrySpread.toFixed(1)} %)`);
        }
    }

    // Check 4: Probability/Confidence Score Divergence
    const probabilities = analystsResults
        .map(r => r.analysis.probability)
        .filter(p => typeof p === 'number' && !isNaN(p)) as number[];

    if (probabilities.length >= 2) {
        const maxProb = Math.max(...probabilities);
        const minProb = Math.min(...probabilities);
        const probSpread = maxProb - minProb;

        if (probSpread > 20) {
            divergenceScore += 15;
            details.push(`Probability spread: ${minProb}% - ${maxProb}% (${probSpread}pt gap)`);
        }
    }

    // Determine if echo chamber
    const isEchoChamber = divergenceScore < 15;
    const syntheticDissentRequired = isEchoChamber;

    // Generate dissent protocol if needed
    let dissentProtocol = '';
    if (syntheticDissentRequired) {
        const direction = directions[0];
        const oppositeDirection = direction === 'long' ? 'SHORT' : direction === 'short' ? 'LONG' : 'OPPOSITE';

        dissentProtocol = `
        **🚨 ECHO CHAMBER DETECTED - SYNTHETIC DISSENT PROTOCOL ACTIVATED **

            All analysts appear to agree on the trade setup.This is a high - risk scenario where groupthink can lead to blindspots.

** MANDATORY DEVIL'S ADVOCATE ROUND:**
Before proceeding to the final verdict, the moderator MUST:

    1. ** Force Failure Scenario Analysis **: Demand each analyst articulate the #1 reason this trade could FAIL.
2. ** Invert the Thesis **: Ask: "What would need to happen for a ${oppositeDirection} trade to be the correct call instead?"
    3. ** Historical Pattern Check **: Are there Pattern Memory entries where similar unanimous consensus led to losses ?
        4. ** Black Swan Scan **: What macro event(news, liquidation cascade, whale movement) could invalidate this setup in the next 24h ?

** If analysts cannot provide compelling counter - arguments, mark the trade as "HIGH CONVICTION BUT VERIFY" and recommend reduced position size.**
        `;
    }

    return {
        score: Math.min(divergenceScore, 100),
        isEchoChamber,
        divergenceType,
        details,
        syntheticDissentRequired,
        dissentProtocol,
    };
};

/**
 * Build the persisted consensus breakdown for the explainability panel:
 * each analyst's structured call (direction/entry/SL/TP/confidence/probability)
 * plus the pre-debate divergence analysis. Attached to the verdict analysis
 * by the pipeline (app-computed, never AI-generated) so the final call can be
 * audited against its own inputs — in the live card, history, and journal.
 */
/** Minimal analyst shape buildAnalystConsensus needs (RealDebateAnalyst
 *  satisfies it; tests may pass lighter fixtures). */
type ConsensusAnalyst = {
    provider: { config: { id: string }; name: string; thoughtsKey?: string };
    result: { analysis: TradeAnalysis };
};

export const buildAnalystConsensus = (
    analysts: ConsensusAnalyst[]
): AnalystConsensus | undefined => {
    if (analysts.length < 1) return undefined;
    const entries: AnalystConsensus['entries'] = analysts.map((a) => {
        const analysis = a.result.analysis;
        return {
            // thoughtsKey (provider::model) is the unique identity — two lens
            // roles on one provider previously collided under config.id, so
            // the panel showed the first role's call for both.
            providerId: a.provider.config.id,
            thoughtsKey: a.provider.thoughtsKey,
            displayName: a.provider.name,
            direction: analysis.direction,
            entry: analysis.entryPoints?.[0]?.price ? String(analysis.entryPoints[0].price) : undefined,
            stopLoss: analysis.stopLoss || undefined,
            takeProfit: analysis.takeProfit?.[0]?.price ? String(analysis.takeProfit[0].price) : undefined,
            confidence: analysis.confidence,
            probability: typeof analysis.probability === 'number' ? analysis.probability : undefined,
        };
    });
    const divergence = analyzePreDebateDivergence(
        analysts.map((a) => a.result),
        analysts.map((a) => a.provider.name),
    );
    return {
        entries,
        divergence: {
            score: divergence.score,
            isEchoChamber: divergence.isEchoChamber,
            divergenceType: divergence.divergenceType,
            details: divergence.details,
        },
    };
};

const noTrade = (direction?: string, confidence?: string): boolean =>
    confidence === 'Avoid' || direction === 'Neutral' || direction === 'Avoid';

export const attachVerdictCitations = (
    consensus: AnalystConsensus,
    verdict: TradeAnalysis,
): AnalystConsensus => {
    const citations = consensus.entries.map(entry => {
        const aligned = noTrade(verdict.direction, verdict.confidence)
            ? noTrade(entry.direction, entry.confidence)
            : (entry.direction || '').toLowerCase() === (verdict.direction || '').toLowerCase();
        return {
            displayName: entry.displayName,
            aligned,
            note: aligned
                ? `Tracked in verdict (${entry.direction || '—'})`
                : `Dissented ${entry.direction || '—'} vs ${verdict.direction}`,
        };
    });
    return { ...consensus, citations };
};

/** If nobody aligned with a directional call, the merge is an average — force Neutral.
 *  The override is quarantined (verdictReview): a measurement failure is not a
 *  neutral opinion, and the journal/UI must be able to tell them apart. */
export const enforceCitedVerdict = <T extends {
    direction?: string;
    confidence?: string;
    originalConfidence?: string;
    validationWarnings?: string[];
    verdictReview?: TradeAnalysis['verdictReview'];
}>(
    verdict: T,
    consensus?: AnalystConsensus | null,
    keptName?: string | null,
): T => {
    if (noTrade(verdict.direction, verdict.confidence)) return verdict;
    const named = (keptName || '').trim().toLowerCase();
    if (named) {
        const cited = consensus?.citations?.some(c => c.aligned && c.displayName.toLowerCase() === named);
        if (cited || !consensus?.citations?.length) return verdict;
    }
    if (consensus?.citations?.some(c => c.aligned)) return verdict;
    return {
        ...verdict,
        originalConfidence: verdict.originalConfidence ?? verdict.confidence,
        direction: 'Neutral',
        confidence: 'Avoid',
        verdictReview: {
            reason: 'uncited',
            from: verdict.direction === 'Long' || verdict.direction === 'Short' ? verdict.direction : undefined,
        },
        validationWarnings: [
            ...(verdict.validationWarnings ?? []),
            'Verdict had no cited analyst — forced Neutral (moderator must quote, not average).',
        ],
    };
};

/**
 * Generate a concise divergence summary for the moderator prompt.
 */
export const generateDivergenceContext = (
    analystsResults: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string }[],
    _analystNames: string[]
): string => {
    const analysis = analyzePreDebateDivergence(analystsResults, _analystNames);

    if (analysis.score === 0 && !analysis.isEchoChamber) {
        return '';
    }

    let context = `
        **🔍 PRE - DEBATE DIVERGENCE ANALYSIS **

            Divergence Score: ${analysis.score}/100 ${analysis.isEchoChamber ? ' LOW (Echo Chamber Risk)' : analysis.score > 50 ? ' HIGH' : ' MODERATE'}

${analysis.details.map(d => `- ${d}`).join('\n')}
    `;

    if (analysis.dissentProtocol) {
        context += '\n' + analysis.dissentProtocol;
    }

    return context.trim();
};
