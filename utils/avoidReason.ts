import { TradeAnalysis } from '../types';
import { ConfidenceCalibration } from '../types';
import { MIN_TRADES_FOR_CALIBRATION } from '../constants/calibrationConstants';
import { formatModelDisplayName } from './providerUtils';

/**
 * Decision-quality helpers: explain WHY a setup became Avoid, distinguish
 * hard blockers (untradeable on its own) from confidence downgrades (still a
 * valid watch), and derive the trigger that would make the setup valid.
 * All pure — the pipeline, the card, and the tests share these.
 */

export interface AvoidReasonItem {
    text: string;
    tone: 'blocked' | 'warning';
}

export interface AvoidBasis {
    /** The setup is untradeable on its own (gate fail, ungrounded levels, …). */
    hard: AvoidReasonItem[];
    /** The setup is still a valid Low/Medium watch, just discounted. */
    downgrades: AvoidReasonItem[];
}

/** Hard blockers are deterministic risk rules — not opinion. */
const HARD_WARNING_PATTERN = /HARD VALIDATION|GATE VETO|HARD BLOCK|UNGROUNDED|insufficient data|below 1:1|below required minimum|no measurable risk/i;

const cleanWarning = (text: string): string =>
    text.replace(/^\s+/, '').replace(/^⚠️\s*/u, '').replace(/^🚫\s*/u, '').trim();

/** R:R from the declared value, falling back to entry/SL/TP1 when unset. */
const resolveRatio = (analysis: Pick<TradeAnalysis, 'rrRatio' | 'entryPoints' | 'stopLoss' | 'takeProfit'>): number | undefined => {
    if (typeof analysis.rrRatio === 'number' && Number.isFinite(analysis.rrRatio)) return analysis.rrRatio;
    const parse = (value?: string): number | undefined => {
        const n = Number(String(value ?? '').replace(/[$,\s]/g, ''));
        return Number.isFinite(n) ? n : undefined;
    };
    const entry = parse(analysis.entryPoints?.[0]?.price);
    const sl = parse(analysis.stopLoss);
    const tp = parse(analysis.takeProfit?.[0]?.price);
    if (entry === undefined || sl === undefined || tp === undefined) return undefined;
    const risk = Math.abs(entry - sl);
    if (risk <= 0) return undefined;
    return Math.abs(tp - entry) / risk;
};

export const classifyAvoidBasis = (
    analysis: Pick<TradeAnalysis, 'riskVeto' | 'validationWarnings' | 'gateResult' | 'rrRatio' | 'entryPoints' | 'stopLoss' | 'takeProfit'>,
): AvoidBasis => {
    const hard: AvoidReasonItem[] = [];
    const downgrades: AvoidReasonItem[] = [];

    if (analysis.riskVeto) hard.push({ text: analysis.riskVeto, tone: 'blocked' });
    const gateFailed = analysis.gateResult && analysis.gateResult.passed === false;
    if (gateFailed && !analysis.riskVeto) {
        hard.push({ text: 'Validation gate blocked this setup (insufficient or contradictory data).', tone: 'blocked' });
    }

    for (const warning of analysis.validationWarnings ?? []) {
        const item: AvoidReasonItem = { text: cleanWarning(warning), tone: 'blocked' };
        if (HARD_WARNING_PATTERN.test(warning)) hard.push(item);
        else downgrades.push({ ...item, tone: 'warning' });
    }

    const rr = resolveRatio(analysis);
    if (typeof rr === 'number' && rr < 1) {
        hard.push({ text: `R:R ${rr.toFixed(2)}:1 is below the 1:1 viability floor.`, tone: 'blocked' });
    }

    const gate = analysis.gateResult;
    if (gate && gate.passed !== false) {
        if (typeof gate.confidenceCap === 'number' && gate.confidenceCap < 1) {
            downgrades.push({ text: `Pattern gate capped conviction at ${Math.round(gate.confidenceCap * 100)}%.`, tone: 'warning' });
        }
        const penalties = gate.penalties;
        if (penalties) {
            if (penalties.htfConflict > 0) downgrades.push({ text: 'Higher-timeframe conflict penalty.', tone: 'warning' });
            if (penalties.dataIntegrity > 0) downgrades.push({ text: 'Incomplete or conflicting market data penalty.', tone: 'warning' });
            if (penalties.volumeContext > 0) downgrades.push({ text: 'Weak volume context penalty.', tone: 'warning' });
            if (penalties.patternMemory > 0) downgrades.push({ text: 'Similar losing setups in pattern memory.', tone: 'warning' });
        }
    }

    // De-duplicate without dropping the order (hard first, then downgrades).
    const seen = new Set<string>();
    const unique = (items: AvoidReasonItem[]): AvoidReasonItem[] =>
        items.filter(item => {
            if (seen.has(item.text)) return false;
            seen.add(item.text);
            return true;
        });
    return { hard: unique(hard), downgrades: unique(downgrades) };
};

export interface RescueSoftAvoidOptions {
    /** Direction captured before the pipeline forced Neutral onto an Avoid verdict. */
    directionBefore?: string;
    /** True when the model itself declared Avoid and no pipeline rule produced it. */
    modelDeclaredAvoid?: boolean;
}

/**
 * One weak rule (e.g. a single calibration warning) must not collapse a
 * valid Low/Medium setup into Avoid. Floor soft Avoids back to Low and
 * restore the direction that the pipeline neutralized. Model-declared Avoids
 * and hard blockers (gate fail, ungrounded levels, R:R < 1:1, hard
 * validation) stay Avoid. Returns true when the verdict was rescued.
 */
export const rescueSoftAvoid = (analysis: TradeAnalysis, options: RescueSoftAvoidOptions = {}): boolean => {
    if (analysis.confidence !== 'Avoid') return false;
    if (options.modelDeclaredAvoid) return false;
    if (classifyAvoidBasis(analysis).hard.length > 0) return false;

    analysis.confidence = 'Low';
    if (analysis.direction === 'Neutral' && options.directionBefore && options.directionBefore !== 'Neutral') {
        analysis.direction = options.directionBefore as TradeAnalysis['direction'];
    }
    if (!analysis.originalConfidence) analysis.originalConfidence = 'Avoid';
    if (!analysis.validationWarnings) analysis.validationWarnings = [];
    analysis.validationWarnings.push('SOFT AVOID RESCINDED: no hard blocker — kept as a Low-confidence watch.');
    return true;
};

export interface ConfidenceStep {
    label: string;
    value: string;
    tone: 'neutral' | 'warning' | 'blocked' | 'good';
}

const STEP_LIMIT = 6;

const stepTone = (text: string): ConfidenceStep['tone'] =>
    HARD_WARNING_PATTERN.test(text) ? 'blocked' : 'warning';

const stepLabel = (warning: string): string => {
    const clean = cleanWarning(warning);
    const beforeColon = clean.split(':')[0]?.trim() ?? '';
    if (beforeColon && beforeColon.length <= 28 && /[A-Z]/.test(beforeColon)) return beforeColon;
    return `${clean.slice(0, 22)}${clean.length > 22 ? '…' : ''}`;
};

/** Ordered confidence-change steps: initial → gate cap → rules → final. */
export const buildConfidenceTimeline = (
    analysis: Pick<TradeAnalysis, 'confidence' | 'originalConfidence' | 'gateResult' | 'validationWarnings'>,
): ConfidenceStep[] => {
    const steps: ConfidenceStep[] = [];
    // An "Initial" step is only meaningful when the verdict actually moved —
    // a plain model verdict has nothing to walk through.
    const start = analysis.originalConfidence;
    if (start && start !== analysis.confidence) {
        steps.push({ label: 'Initial', value: start, tone: 'neutral' });
    }

    const gate = analysis.gateResult;
    if (gate && typeof gate.confidenceCap === 'number' && gate.confidenceCap < 1) {
        steps.push({ label: 'Gate cap', value: `${Math.round(gate.confidenceCap * 100)}% ceiling`, tone: 'warning' });
    }

    const warnings = (analysis.validationWarnings ?? []).filter(w => w.trim());
    const shown = warnings.slice(0, STEP_LIMIT);
    for (const warning of shown) {
        steps.push({ label: stepLabel(warning), value: cleanWarning(warning), tone: stepTone(warning) });
    }
    if (warnings.length > shown.length) {
        steps.push({ label: 'More rules', value: `+${warnings.length - shown.length} further warning${warnings.length - shown.length === 1 ? '' : 's'}`, tone: 'neutral' });
    }

    if (analysis.confidence) {
        steps.push({
            label: 'Final',
            value: analysis.confidence,
            tone: analysis.confidence === 'Avoid' ? 'blocked' : analysis.confidence === 'Low' ? 'warning' : 'good',
        });
    }
    return steps;
};

export interface ConfirmationTrigger {
    text: string;
    level?: string;
}

export interface ConfirmationTriggerOptions {
    /**
     * The card already renders the invalidation line right below the panel —
     * skip that source so the banner never echoes it a second time.
     */
    skipInvalidationSource?: boolean;
}

/**
 * The concrete condition that would make this setup valid — used by the
 * "wait for confirmation" banner instead of treating every uncertain setup
 * as an Avoid. Priority: suggested entry trigger, invalidation contract,
 * gate insight, then a wait-related validation warning.
 */
export const confirmationTrigger = (
    analysis: Pick<TradeAnalysis, 'entryTimingScore' | 'invalidationCriteria' | 'gateResult' | 'validationWarnings'>,
    options: ConfirmationTriggerOptions = {},
): ConfirmationTrigger | null => {
    const timing = analysis.entryTimingScore?.suggestedEntry;
    if (timing?.reason?.trim()) {
        return { text: timing.reason.trim(), level: timing.price !== undefined ? `${timing.price}` : undefined };
    }
    const invalidation = analysis.invalidationCriteria?.[0];
    if (!options.skipInvalidationSource && invalidation) {
        const condition = (invalidation.condition || invalidation.note || '').trim();
        if (condition) return { text: condition, level: invalidation.level };
    }
    const gateInsight = (analysis.gateResult?.insights ?? []).find(insight => /\b(when|once|until|wait|after|confirm)\b/i.test(insight));
    if (gateInsight?.trim()) return { text: gateInsight.trim() };
    const warning = (analysis.validationWarnings ?? []).find(w => /\b(wait|confirmation|confirm)\b/i.test(w));
    if (warning?.trim()) return { text: cleanWarning(warning).replace(/^[^:]*:\s*/, '') };
    return null;
};

/** Per-model realized accuracy lines for the calibration section. */
export const describeModelCalibration = (
    calibration: ConfidenceCalibration | undefined,
    modelsUsed: Record<string, string> | undefined,
): string[] => {
    const entries = Object.entries(modelsUsed ?? {});
    if (entries.length === 0) return [];
    const lines: string[] = [];
    for (const [providerId, modelId] of entries) {
        const stats = calibration?.granular?.byProvider?.[providerId];
        if (!stats || stats.total === 0) continue;
        const name = formatModelDisplayName(modelId) || providerId;
        if (stats.total >= MIN_TRADES_FOR_CALIBRATION) {
            lines.push(`${name}: ${Math.round((stats.wins / stats.total) * 100)}% realized (n=${stats.total})`);
        } else {
            lines.push(`${name}: ${stats.total} logged trade${stats.total === 1 ? '' : 's'} — calibration pending`);
        }
    }
    return lines;
};
