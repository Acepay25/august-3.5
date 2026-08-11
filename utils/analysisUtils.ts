/**
 * Analysis utilities.
 *
 * sanitizeTradeAnalysis is a thin wrapper over the zod-based AI boundary
 * parser in schemas/tradeAnalysis.ts (lenient coercion + semantic fixups).
 * All shape validation and business rules (direction synonyms, probability/
 * confidence coupling, price cleaning, family fallback, legacy bridging)
 * live there and are covered by tests/tradeAnalysisSchema.test.ts.
 */

import { TradeAnalysis } from '../types';
import { parseTradeAnalysis } from '../schemas/tradeAnalysis';

// Shared cleaners, re-exported for consumers (autopilot, metrics).
export { cleanPriceField } from './sanitizers';

/**
 * Sanitize and normalize raw AI analysis output into a valid TradeAnalysis.
 * Never throws — total parse failure yields safe defaults.
 */
export const sanitizeTradeAnalysis = (raw: any): TradeAnalysis => parseTradeAnalysis(raw);

/**
 * Render a raw trade-plan JSON object as readable multi-line text.
 *
 * Used when a model ignores the requested output format and returns a
 * JSON trade plan instead — the card shows this readable summary rather than
 * the raw JSON blob.
 */
export const formatAnalysisForDisplay = (analysis: any): string => {
    if (!analysis || typeof analysis !== 'object') return '';
    const parts: string[] = [];
    if (analysis.coinName) parts.push(`**Coin:** ${analysis.coinName}`);
    if (analysis.direction) parts.push(`**Direction:** ${analysis.direction}`);
    const entries = Array.isArray(analysis.entryPoints)
        ? analysis.entryPoints.map((e: any) => e?.price).filter(Boolean).join(', ')
        : '';
    if (entries) parts.push(`**Entry:** ${entries}`);
    if (analysis.stopLoss) parts.push(`**Stop Loss:** ${analysis.stopLoss}`);
    const tps = Array.isArray(analysis.takeProfit)
        ? analysis.takeProfit.map((t: any) => t?.price).filter(Boolean).join(', ')
        : '';
    if (tps) parts.push(`**Take Profit:** ${tps}`);
    if (typeof analysis.probability === 'number' && !isNaN(analysis.probability)) {
        parts.push(`**Probability:** ${analysis.probability}%`);
    }
    if (analysis.confidence) parts.push(`**Confidence:** ${analysis.confidence}`);
    if (analysis.strategy) parts.push(`**Strategy:** ${analysis.strategy}`);
    if (analysis.keyLevels && typeof analysis.keyLevels === 'object') {
        const sup = Array.isArray(analysis.keyLevels.support) ? analysis.keyLevels.support.join(', ') : '';
        const res = Array.isArray(analysis.keyLevels.resistance) ? analysis.keyLevels.resistance.join(', ') : '';
        if (sup || res) parts.push(`**Key Levels:** Support ${sup || '—'} | Resistance ${res || '—'}`);
    }
    return parts.join('\n');
};

/**
 * Extract a numeric price from a string. Range entries ("3210 - 3220",
 * "3000 to 3050") resolve to their midpoint so entry-relative SL/zone math
 * uses one consistent value — range-unaware copies elsewhere used to differ
 * by import site, silently skewing SL-distance math. Whitespace is preserved
 * so a trailing annotation ("94500 4h") can't glue its digits onto the number
 * (→ 945004).
 */
export const parsePrice = (priceStr: string): number => {
    if (!priceStr) return NaN;
    // Remove commas (e.g. 69,000 -> 69000); whitespace stays intact.
    const cleanStr = priceStr.replace(/,/g, '');
    // The trailing lookahead stops a timeframe-annotated price with a dash
    // ("94500 - 4h") from matching as a range — greedy matching turned it
    // into the midpoint of 94500 and 4.
    const range = cleanStr.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)(?!\s*[a-zA-Z])/i);
    if (range) {
        return (parseFloat(range[1]) + parseFloat(range[2])) / 2;
    }
    // Optional leading minus: a signed value like "-100" must parse as -100,
    // not 100 (the old pattern dropped the sign). The minus only binds when
    // it immediately precedes the digits.
    const match = cleanStr.match(/(-?\d+(?:\.\d+)?)/);
    if (match) {
        return parseFloat(match[0]);
    }
    return NaN;
};

/**
 * Prose trade-plan rescue — parse the moderator's MARKDOWN VERDICT PROSE when
 * the structured <JSON_PLAN> fails to parse, so the card always carries the
 * coin name, direction, levels, and probability in the same markdown format
 * instead of a dead "Unknown Asset · Neutral" fallback. Regex-bounded and
 * conservative: only labeled fields are taken; anything unclear stays absent
 * (sanitizeTradeAnalysis fills safe defaults).
 */
export interface ProseTradePlan {
    coinName?: string;
    direction?: 'Long' | 'Short';
    entry?: string;
    stopLoss?: string;
    takeProfit?: string;
    probability?: number;
    confidence?: string;
}

export const parseProseTradePlan = (text: string): ProseTradePlan | null => {
    if (!text || typeof text !== 'string') return null;
    const out: ProseTradePlan = {};

    // Coin: first uppercase ticker (BTCUSDT / ETHUSD / SOLPERP). The greedy
    // base would swallow the suffix ("BTCUSDT" → "BTC" + "USDT"), so capture
    // the WHOLE token and normalize the quote suffix.
    const coin = text.match(/\b[A-Z]{2,10}(?:USDT|USD|PERP)\b/i);
    if (coin) out.coinName = `${coin[0].toUpperCase().replace(/(?:USDT|USD|PERP)$/i, '')}USDT`;

    // Direction: a direction/bias/verdict label followed closely by long/short.
    const dir = text.match(/\b(?:direction|bias|verdict|position|call)[^.\n]{0,30}?\b(long|short)\b/i);
    if (dir) out.direction = dir[1].toLowerCase() === 'long' ? 'Long' : 'Short';

    // Entry / SL / TP: labeled numbers (first labeled match wins).
    const entry = text.match(/\b(?:entry|entries|enter)\b[^0-9]{0,25}?(\d{1,7}(?:[.,]\d{1,4})?)/i);
    if (entry) out.entry = entry[1];
    const sl = text.match(/\b(?:stop\s*loss|stop-loss|SL)\b[^0-9]{0,25}?(\d{1,7}(?:[.,]\d{1,4})?)/i);
    if (sl) out.stopLoss = sl[1];
    const tp = text.match(/\b(?:take\s*profit|take-profit|TP1?|target)\b[^0-9]{0,25}?(\d{1,7}(?:[.,]\d{1,4})?)/i);
    if (tp) out.takeProfit = tp[1];

    // Probability: NN% near a probability word; clamped 0-100.
    const prob = text.match(/\b(?:probability|prob|chance|likelihood)\b[^0-9]{0,30}?(\d{1,3})\s*%/i);
    if (prob) out.probability = Math.min(100, Math.max(0, parseInt(prob[1], 10)));

    // Confidence grade: High/Medium/Low/Avoid near the word confidence.
    const conf = text.match(/\bconfidence\b[^.\n]{0,30}?\b(high|medium|low|avoid)\b/i);
    if (conf) out.confidence = conf[1].charAt(0).toUpperCase() + conf[1].slice(1);

    return Object.keys(out).length > 0 ? out : null;
};

/**
 * The full structured plan recovered from the moderator's markdown — every
 * field the old JSON schema carried, organized into TradeAnalysis-shaped
 * sections. `parseMarkdownTradePlan` fills what the labels provide; anything
 * absent stays undefined (sanitizeTradeAnalysis supplies safe defaults).
 */
export interface MarkdownTradePlan extends ProseTradePlan {
    grade?: string;
    patternFamily?: string;
    validityWindow?: string;
    historicalCorrelation?: string;
    strategy?: string;
    marketConditions?: {
        pattern?: string;
        candleBehavior?: string;
        timeframeAlignment?: string;
        rsi?: string;
        macd?: string;
        sentiment?: string;
        prices?: Record<string, string>;
    };
    detectedPatterns?: { name: string; timeframe?: string; type?: string; confidence?: string; description?: string }[];
    support?: string[];
    resistance?: string[];
    dualScenario?: {
        bullish?: { trigger?: string; confirmation?: string; target?: string; invalidation?: string };
        bearish?: { trigger?: string; confirmation?: string; target?: string; invalidation?: string };
        selected?: string;
        reasoning?: string;
        confidence?: number;
    };
    invalidations?: { level?: string; category?: string; condition?: string; note?: string }[];
    devilsAdvocate?: { bearCaseReasons?: string[]; failureScenarios?: string[]; crowdedTradeWarning?: string; riskScore?: number };
    slProbability?: number;
    tpProbabilities?: { level: number; probability: number }[];
    evidence?: { claim: string; state?: string; sources?: string[] }[];
}

/**
 * Parse the moderator's MARKDOWN trade plan (the ONLY output contract now —
 * no JSON anywhere). Labeled bullet lines ("- **Coin:** BTCUSDT" or
 * "Direction: Short") are extracted deterministically — the full field set
 * from the old JSON schema, organized in sections. When no labeled fields
 * are found, the free-form prose parser rescues the plan. The plan block
 * itself doubles as the card's strategy markdown.
 */
export const parseMarkdownTradePlan = (text: string): MarkdownTradePlan | null => {
    if (!text || typeof text !== 'string') return null;
    const out: MarkdownTradePlan = {};

    // Labeled-line extractor: "- **Label:** value" / "**Label:** value" /
    // "Label: value". Returns the first non-empty value for the label.
    const field = (labels: string[]): string | undefined => {
        for (const label of labels) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // "- **Coin:** value" / "**Coin:** value" / "Coin: value" —
            // the closing bold stars come AFTER the colon in **Coin:**, so
            // optional stars are allowed on both sides of it.
            const m = text.match(new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?\\*{0,2}${escaped}\\*{0,2}\\s*[:：]\\s*\\*{0,2}\\s*([^\\n]+)`, 'i'));
            if (m && m[1].trim()) return m[1].trim().replace(/^\*+\s*/, '');
        }
        return undefined;
    };
    // ALL matching lines for a numbered label ("Pattern 1", "Invalidation 2"…).
    const fields = (labels: string[]): string[] => {
        const outList: string[] = [];
        for (const label of labels) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?\\*{0,2}${escaped}\\*{0,2}\\s*[:：]\\s*\\*{0,2}\\s*([^\\n]+)`, 'gi');
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                if (m[1].trim()) outList.push(m[1].trim().replace(/^\*+\s*/, ''));
            }
        }
        return outList;
    };
    // First number in a value ("95000 — Support retest" → "95000").
    const num = (value: string | undefined): string | undefined => {
        if (!value) return undefined;
        const m = value.match(/(\d{1,7}(?:[.,]\d{1,4})?)/);
        return m ? m[1] : undefined;
    };
    const numOr = (value: string | undefined, fallback: number): number => {
        const n = parseFloat(num(value)?.replace(/,/g, '') ?? '');
        return Number.isFinite(n) ? n : fallback;
    };
    const splitList = (value: string | undefined): string[] | undefined => {
        if (!value) return undefined;
        return value.split(',').map(s => s.trim()).filter(Boolean);
    };

    // ── Setup ──
    const coin = field(['Coin', 'Asset', 'Symbol']);
    if (coin) out.coinName = `${coin.toUpperCase().replace(/(?:USDT|USD|PERP)$/i, '')}USDT`;
    const dir = field(['Direction', 'Bias']);
    if (dir && /long/i.test(dir)) out.direction = 'Long';
    else if (dir && /short/i.test(dir)) out.direction = 'Short';
    out.grade = field(['Grade']);
    out.patternFamily = field(['Pattern Family']);
    out.validityWindow = field(['Validity Window']);

    // ── Levels ──
    const entry = num(field(['Entry']));
    if (entry) out.entry = entry;
    const sl = num(field(['Stop Loss', 'Stop-Loss', 'SL']));
    if (sl) out.stopLoss = sl;
    const tp = num(field(['Take Profit 1', 'Take Profit', 'TP1', 'Target']));
    if (tp) out.takeProfit = tp;

    // ── Odds ──
    const prob = field(['Probability', 'Prob']);
    if (prob) {
        const m = prob.match(/(\d{1,3})/);
        if (m) out.probability = Math.min(100, Math.max(0, parseInt(m[1], 10)));
    }
    const conf = field(['Confidence']);
    if (conf && /high|medium|low|avoid/i.test(conf)) {
        out.confidence = conf.charAt(0).toUpperCase() + conf.slice(1).toLowerCase();
    }
    const slProb = numOr(field(['SL Probability']), NaN);
    if (Number.isFinite(slProb)) out.slProbability = Math.min(100, Math.max(0, slProb));
    const tpProbs: { level: number; probability: number }[] = [];
    (['TP1 Probability', 'TP2 Probability', 'TP3 Probability'] as const).forEach((label, i) => {
        const p = numOr(field([label]), NaN);
        if (Number.isFinite(p)) tpProbs.push({ level: i + 1, probability: Math.min(100, Math.max(0, p)) });
    });
    if (tpProbs.length > 0) out.tpProbabilities = tpProbs;

    // ── Strategy ──
    out.strategy = field(['Strategy']);
    out.historicalCorrelation = field(['Historical Correlation']);

    // ── Market Conditions ──
    const pattern = field(['Pattern']);
    const candleBehavior = field(['Candle Behavior']);
    const timeframeAlignment = field(['Timeframe Alignment']);
    const rsi = field(['RSI']);
    const macd = field(['MACD']);
    const sentiment = field(['Sentiment']);
    const pricesRaw = field(['Prices']);
    let prices: Record<string, string> | undefined;
    if (pricesRaw) {
        const parsed: Record<string, string> = {};
        pricesRaw.split('·').forEach(seg => {
            const m = seg.match(/(\d+[mh])\s+([\d,.]+)/i);
            if (m) parsed[m[1].toLowerCase()] = m[2];
        });
        if (Object.keys(parsed).length > 0) prices = parsed;
    }
    if (pattern || candleBehavior || timeframeAlignment || rsi || macd || sentiment || prices) {
        out.marketConditions = { pattern, candleBehavior, timeframeAlignment, rsi, macd, sentiment, prices };
    }

    // ── Detected Patterns ──
    const patternRows = fields(['Pattern 1', 'Pattern 2', 'Pattern 3', 'Pattern 4']);
    if (patternRows.length > 0) {
        out.detectedPatterns = patternRows.map(row => {
            const meta = row.match(/^([^(]+?)\s*\(([^)]*)\)\s*[—\-–]?\s*(.*)$/);
            if (!meta) return { name: row };
            const [name, inside, description] = [meta[1].trim(), meta[2], meta[3]?.trim()];
            const parts = inside.split(',').map(s => s.trim());
            return { name, timeframe: parts[0] || undefined, type: parts[1] || undefined, confidence: parts[2] || undefined, description };
        });
    }

    // ── Key Levels ──
    const support = splitList(field(['Support']));
    if (support) out.support = support;
    const resistance = splitList(field(['Resistance']));
    if (resistance) out.resistance = resistance;

    // ── Dual Scenario ──
    const bullishTrigger = field(['Bullish Trigger']);
    const bullishTarget = num(field(['Bullish Target']));
    const bullishInvalidation = num(field(['Bullish Invalidation']));
    const bearishTrigger = field(['Bearish Trigger']);
    const bearishTarget = num(field(['Bearish Target']));
    const bearishInvalidation = num(field(['Bearish Invalidation']));
    const selectedScenario = field(['Selected Scenario']);
    if (bullishTrigger || bullishTarget || bullishInvalidation || bearishTrigger || bearishTarget || bearishInvalidation || selectedScenario) {
        const selMatch = selectedScenario?.match(/^([^—\-–]+?)\s*[—\-–]\s*(.*)$/);
        out.dualScenario = {
            bullish: { trigger: num(bullishTrigger) ?? undefined, confirmation: bullishTrigger?.split('—')[1]?.trim() || bullishTrigger?.split('–')[1]?.trim(), target: bullishTarget, invalidation: bullishInvalidation },
            bearish: { trigger: num(bearishTrigger) ?? undefined, confirmation: bearishTrigger?.split('—')[1]?.trim() || bearishTrigger?.split('–')[1]?.trim(), target: bearishTarget, invalidation: bearishInvalidation },
            selected: selMatch ? selMatch[1].trim() : selectedScenario,
            reasoning: selMatch ? selMatch[2].trim() : undefined,
            confidence: Number.isFinite(numOr(field(['Scenario Confidence']), NaN)) ? numOr(field(['Scenario Confidence']), NaN) : undefined,
        };
    }

    // ── Invalidation Criteria ──
    const invalidationRows = fields(['Invalidation 1', 'Invalidation 2', 'Invalidation 3', 'Invalidation 4']);
    if (invalidationRows.length > 0) {
        out.invalidations = invalidationRows.map(row => {
            const parts = row.split('—').map(s => s.trim());
            const first = parts[0] ?? '';
            // '[\dhms]+' FIRST — the digit-only alternative would match "5" in
            // "5h30m" and, with the rest optional, never backtrack to the full
            // duration token.
            const levelMatch = first.match(/^([\dhms]+|[\d,.]+)\s*(?:\(([^)]*)\))?/);
            return {
                level: levelMatch?.[1] ?? first,
                category: levelMatch?.[2] || undefined,
                condition: parts[1] || undefined,
                note: parts[2] || undefined,
            };
        });
    }

    // ── Devil's Advocate ──
    const bearCase = splitList(field(['Bear Case']));
    const failureScenarios = splitList(field(['Failure Scenarios']));
    const crowdedTradeWarning = field(['Crowded Trade Warning']);
    const riskScore = numOr(field(['Risk Score']), NaN);
    if (bearCase || failureScenarios || crowdedTradeWarning || Number.isFinite(riskScore)) {
        out.devilsAdvocate = {
            bearCaseReasons: bearCase,
            failureScenarios,
            crowdedTradeWarning,
            riskScore: Number.isFinite(riskScore) ? Math.min(100, Math.max(0, riskScore)) : undefined,
        };
    }

    // ── Evidence ──
    const evidenceRows = fields(['Evidence 1', 'Evidence 2', 'Evidence 3', 'Evidence 4']);
    if (evidenceRows.length > 0) {
        out.evidence = evidenceRows.map(row => {
            const parts = row.split('—').map(s => s.trim());
            const sourcesMatch = parts.find(p => /^sources?:/i.test(p));
            return {
                claim: parts[0] ?? row,
                state: /^(observed|partial|unobserved|refuted)$/i.test(parts[1] ?? '') ? parts[1].toLowerCase() : undefined,
                sources: sourcesMatch ? sourcesMatch.replace(/^sources?:/i, '').split(',').map(s => s.trim()).filter(Boolean) : undefined,
            };
        });
    }

    // Nothing labeled (every value still undefined/empty) — rescue from
    // free-form prose. Object.keys is NOT enough: several fields are assigned
    // unconditionally with undefined values.
    const hasAnyValue = Object.values(out).some(v =>
        v !== undefined
        && !(Array.isArray(v) && v.length === 0)
        && !(typeof v === 'object' && v !== null && Object.keys(v).length === 0)
    );
    if (!hasAnyValue) return parseProseTradePlan(text);
    return out;
};

/**
 * Map a parsed markdown plan onto a TradeAnalysis-shaped object — every
 * field the old JSON schema carried, now sourced from the labeled markdown.
 * sanitizeTradeAnalysis (zod, lenient) fills safe defaults for anything
 * absent at the call site.
 */
export const tradePlanToAnalysis = (plan: MarkdownTradePlan): Record<string, unknown> => {
    // "4h" → 240 · "5h30m" → 330 · "330" → 330 (validity window in minutes).
    const validityMinutes = ((): number | undefined => {
        if (!plan.validityWindow) return undefined;
        const h = plan.validityWindow.match(/(\d+)\s*h/i);
        const m = plan.validityWindow.match(/(\d+)\s*m/i);
        const pure = plan.validityWindow.match(/^(\d+)$/);
        if (h || m) return (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
        if (pure) return parseInt(pure[1], 10);
        return undefined;
    })();

    const ds = plan.dualScenario;
    const selected = ds?.selected?.toLowerCase();
    return {
        coinName: plan.coinName,
        direction: plan.direction ?? 'Neutral',
        confidence: plan.confidence ?? 'Low',
        probability: plan.probability,
        grade: plan.grade,
        strategy: plan.strategy,
        historicalCorrelation: plan.historicalCorrelation,
        detectedPatternFamily: plan.patternFamily,
        validityDurationMinutes: validityMinutes,
        entryPoints: plan.entry ? [{ price: plan.entry }] : undefined,
        stopLoss: plan.stopLoss,
        takeProfit: plan.takeProfit ? [{ price: plan.takeProfit }] : undefined,
        marketConditions: plan.marketConditions
            ? {
                pattern: plan.marketConditions.pattern ?? '',
                candleBehavior: plan.marketConditions.candleBehavior ?? '',
                timeframeAlignment: plan.marketConditions.timeframeAlignment ?? '',
                rsi: plan.marketConditions.rsi ?? '',
                macd: plan.marketConditions.macd ?? '',
                sentiment: plan.marketConditions.sentiment ?? '',
                prices: plan.marketConditions.prices,
            }
            : undefined,
        detectedPatterns: plan.detectedPatterns ?? undefined,
        keyLevels: plan.support || plan.resistance
            ? { support: plan.support ?? [], resistance: plan.resistance ?? [] }
            : undefined,
        dualScenarioAnalysis: ds
            ? {
                bullish: { trigger: ds.bullish?.trigger ?? '', confirmation: ds.bullish?.confirmation ?? '', target: ds.bullish?.target ?? '', invalidation: ds.bullish?.invalidation ?? '' },
                bearish: { trigger: ds.bearish?.trigger ?? '', confirmation: ds.bearish?.confirmation ?? '', target: ds.bearish?.target ?? '', invalidation: ds.bearish?.invalidation ?? '' },
                selectedScenario: selected === 'bearish' ? 'bearish' : selected === 'neutral' ? 'neutral' : 'bullish',
                selectionReasoning: ds.reasoning ?? '',
                confidenceInSelection: ds.confidence ?? 0,
            }
            : undefined,
        levelProbabilities: plan.slProbability !== undefined || (plan.tpProbabilities?.length ?? 0) > 0
            ? {
                slProbability: plan.slProbability ?? 0,
                tpProbabilities: (plan.tpProbabilities ?? []).map(p => ({ level: p.level, probability: p.probability })),
            }
            : undefined,
        devilsAdvocate: plan.devilsAdvocate ?? undefined,
        evidence: plan.evidence ?? undefined,
        invalidationCriteria: plan.invalidations ?? undefined,
    };
};

/**
 * Strip the structured-plan scaffolding from a moderator's markdown response
 * (<JSON_PLAN>, </DEBATE_END>, error/clarification markers) so the prose can
 * render as the card's strategy text — the JSON schema never shows in chat.
 */
export const stripPlanTags = (text: string): string =>
    (text || '')
        .replace(/<JSON_PLAN>[\s\S]*?<\/JSON_PLAN>/gi, '')
        .replace(/<\/?DEBATE_END>/gi, '')
        .replace(/<MODERATOR_ERROR>[\s\S]*?<\/MODERATOR_ERROR>/gi, '')
        .replace(/<CLARIFICATION_[A-Z_]+>/gi, '')
        .replace(/<MODERATOR_RETRY>/gi, '')
        .trim();

export const recalculateAnalysisMetrics = (analysis: TradeAnalysis, leverage: number): TradeAnalysis => {
    if (!analysis) return sanitizeTradeAnalysis(null);

    const safeAnalysis = sanitizeTradeAnalysis(analysis);
    const newAnalysis = JSON.parse(JSON.stringify(safeAnalysis));

    // Get Base Entry Price
    const entryPriceStr = newAnalysis.entryPoints?.[0]?.price;
    const entryPrice = parsePrice(entryPriceStr);
    const isLong = newAnalysis.direction === 'Long';
    const isShort = newAnalysis.direction === 'Short';

    // Only calculate if we have a valid entry price and direction
    if (!isNaN(entryPrice) && entryPrice > 0 && (isLong || isShort)) {

        // 1. Recalculate Stop Loss Percentage
        const slPriceStr = newAnalysis.stopLoss;
        const slPrice = parsePrice(slPriceStr);

        if (!isNaN(slPrice)) {
            // An inverted SL (wrong side of entry) must not fabricate a
            // plausible-looking risk / R:R — it would sail through the
            // probability gate instead of being flagged. Zero the R:R so the
            // gate clamps down; keep the display percentage absolute.
            const slOnCorrectSide = isLong ? slPrice < entryPrice : slPrice > entryPrice;
            if (!slOnCorrectSide) {
                newAnalysis.rrRatio = 0;
            }
            const rawMove = Math.abs(entryPrice - slPrice) / entryPrice;
            const leveragedLoss = rawMove * leverage * 100;
            newAnalysis.stopLossPercentage = `-${leveragedLoss.toFixed(1)}%`;
        } else if (newAnalysis.originalStopLossPercentage) {
            const numericSL = parseFloat(newAnalysis.originalStopLossPercentage);
            if (!isNaN(numericSL)) {
                const leveragedSL = numericSL * leverage;
                newAnalysis.stopLossPercentage = `-${Math.abs(leveragedSL).toFixed(1)}%`;
            }
        }

        // 2. Recalculate Take Profit Percentages
        const validTakeProfits: number[] = [];

        if (Array.isArray(newAnalysis.takeProfit)) {
            newAnalysis.takeProfit = newAnalysis.takeProfit.map((tp: any) => {
                const newTp = { ...tp };
                const tpPrice = parsePrice(newTp.price);

                if (!isNaN(tpPrice)) {
                    validTakeProfits.push(tpPrice);
                    const rawMove = Math.abs(tpPrice - entryPrice) / entryPrice;
                    const leveragedProfit = rawMove * leverage * 100;
                    newTp.percentage = `+${leveragedProfit.toFixed(1)}%`;
                } else {
                    const originalTP = newTp.originalPercentage || newTp.percentage;
                    if (originalTP) {
                        if (!newTp.originalPercentage) {
                            newTp.originalPercentage = originalTP;
                        }
                        const numericTP = parseFloat(originalTP);
                        if (!isNaN(numericTP)) {
                            const leveragedTP = numericTP * leverage;
                            newTp.percentage = `+${Math.abs(leveragedTP).toFixed(1)}%`;
                        }
                    }
                }
                return newTp;
            });
        }

        // 3. Calculate Risk/Reward Ratio (R:R) — skipped when the SL was
        // flagged inverted above (rrRatio stays 0 so the gate clamps down).
        if (!isNaN(slPrice) && validTakeProfits.length > 0 && newAnalysis.rrRatio !== 0) {
            validTakeProfits.sort((a, b) => Math.abs(a - entryPrice) - Math.abs(b - entryPrice));

            const nearestTpPrice = validTakeProfits[0];
            const risk = Math.abs(entryPrice - slPrice);
            const reward = Math.abs(nearestTpPrice - entryPrice);

            if (risk > 0) {
                newAnalysis.rrRatio = parseFloat((reward / risk).toFixed(2));
            }
        }
    }

    return newAnalysis;
};

// Safe default: 4000 tokens (approx 16k chars) is generally safe for Groq/Llama inputs
export const truncateTextToTokens = (text: string, maxTokens: number = 4000): string => {
    if (!text) return "";
    const CHARS_PER_TOKEN = 4;
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    if (text.length <= maxChars) return text;

    console.warn(`Text exceeded ${maxTokens} tokens. Truncating to ${maxChars} chars...`);
    return text.slice(0, maxChars) + "\n...[Truncated to fit context memory]...";
};

/**
 * Truncate a JSON string safely without corrupting the structure.
 *
 * The naive `truncateTextToTokens` does a hard `text.slice(0, maxChars)` which
 * cuts JSON mid-token, producing unparseable output that the moderator cannot read.
 *
 * This function instead:
 * 1. Parses the JSON
 * 2. Truncates long string values (especially `thoughtProcess`)
 * 3. Drops trailing array elements if still over budget
 * 4. Re-serializes — always valid JSON
 *
 * If parsing fails (not JSON), falls back to safe text truncation.
 */
export const truncateJsonSafely = (jsonText: string, maxTokens: number = 4000): string => {
    if (!jsonText) return "";
    const CHARS_PER_TOKEN = 4;
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    if (jsonText.length <= maxChars) return jsonText;

    let parsed: any;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        // Not valid JSON — fall back to text truncation
        console.warn('[truncateJsonSafely] Input is not valid JSON, falling back to text truncation');
        return truncateTextToTokens(jsonText, maxTokens);
    }

    // Truncate long string values (especially thoughtProcess)
    const MAX_STRING_LEN = 2000;
    const truncateStrings = (obj: any): any => {
        if (typeof obj === 'string') {
            return obj.length > MAX_STRING_LEN
                ? obj.slice(0, MAX_STRING_LEN) + '...[truncated]'
                : obj;
        }
        if (Array.isArray(obj)) {
            // Drop trailing elements if we're still over budget
            let arr = obj.map(truncateStrings);
            const serialized = JSON.stringify(arr);
            if (serialized.length > maxChars && arr.length > 2) {
                // Keep first and last elements, drop middle
                const keepCount = Math.max(2, Math.floor(arr.length * 0.5));
                arr = [...arr.slice(0, keepCount), `...[${arr.length - keepCount} more items truncated]`];
            }
            return arr;
        }
        if (obj && typeof obj === 'object') {
            const result: any = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = truncateStrings(value);
            }
            return result;
        }
        return obj;
    };

    try {
        const truncated = truncateStrings(parsed);
        const result = JSON.stringify(truncated);
        if (result.length > maxChars) {
            // Still too long — truncate the final string safely at a JSON boundary
            console.warn(`[truncateJsonSafely] Still ${result.length} chars after structural truncation, doing final cut`);
            return truncateTextToTokens(result, maxTokens);
        }
        return result;
    } catch (e) {
        console.error('[truncateJsonSafely] Failed to re-serialize:', e);
        return truncateTextToTokens(jsonText, maxTokens);
    }
};

/**
 * Clamp a probability value to the Gate's confidence cap.
 *
 * The Gate produces a `confidenceCap` (0-1) based on data integrity, pattern memory,
 * HTF/LTF conflict, and volume context. The moderator can emit any probability,
 * but it should never exceed the gate cap — this enforces that in code.
 *
 * Also applies R:R grade thresholds as a secondary clamp.
 */
export const clampProbabilityToGate = (
    probability: number,
    confidenceCap: number, // 0-1 (e.g., 0.65 = 65%)
    rrRatio?: number
): { probability: number; wasClamped: boolean; reason?: string } => {
    let clamped = probability;
    let wasClamped = false;
    let reason: string | undefined;

    // 1. Gate cap
    const gateCapPercent = confidenceCap * 100;
    if (clamped > gateCapPercent) {
        clamped = gateCapPercent;
        wasClamped = true;
        reason = `Clamped to Gate cap (${gateCapPercent.toFixed(1)}%)`;
    }

    // 2. R:R grade thresholds (only clamp down, never up)
    if (rrRatio !== undefined) {
        if (rrRatio < 1.2 && clamped > 54) {
            clamped = 54;
            wasClamped = true;
            reason = `Clamped to R:R<1.2 threshold (54%)`;
        } else if (rrRatio < 1.5 && clamped > 69) {
            clamped = 69;
            wasClamped = true;
            reason = `Clamped to R:R<1.5 threshold (69%)`;
        }
    }

    return { probability: Math.round(clamped * 10) / 10, wasClamped, reason };
};
