/**
 * §8.5b — Meta-calibration: the loop learns about the loop (plan §8.5b).
 *
 * Three deterministic ratios (no LLM), maintained by recorders at the exact
 * points that carry ground truth, and computed into a per-user preferences
 * blob:
 *
 *   worth-gate precision   — of gate-approved creations, the fraction that
 *                            later reached 'confirmed' (the gate promised a
 *                            falsifiable prediction; this measures delivery).
 *   refinement recovery    — of shadow refinements (§8.3c) that settled, the
 *                            fraction the incumbent was promoted (i.e. the
 *                            refinement beat the live version).
 *   eval-verdict agreement — of helps/hurts verdict eras that produced at
 *                            least one FOLLOWED trade, the fraction where the
 *                            first followed outcome agreed with the verdict
 *                            (helps→WIN, hurts→LOSS). One sample per era.
 *
 * These are lessons about the HARNESS — keyed on the gate, not on any
 * provider. The weekly pass (runWeeklyMetaCalibration, called from the
 * weekly review) computes + persists the ratios and, when the worth-gate
 * precision decays below the floor at a meaningful sample, emits a P7
 * harness-lesson with a default-change proposal instead of letting a
 * silently-tightened/thrown-away gate rotate.
 *
 * All recorders are fire-and-forget safe: they never throw and never block
 * the skill/evidence paths.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { recordHarnessLesson } from './harnessLessons';

const KEY_PREFIX = 'meta_calibration_v1_';
/** Weekly change-proposal floor: precision below this at sample≥GATE_SAMPLE_MIN. */
export const META_PRECISION_FLOOR = 0.4;
export const META_GATE_SAMPLE_MIN = 10;
const WATCH_CAP = 50;
const ERA_CAP = 200;

export interface MetaCalibrationRatios {
    /** Fraction 0-1, or null when the sample is empty. */
    worthGatePrecision: number | null;
    refinementRecovery: number | null;
    evalAgreement: number | null;
}

export interface MetaCalibrationData {
    worthGateApproved: number;
    worthGateConfirmed: number;
    /** Normalized ifConditions of gate-approved skills still awaiting their
     *  first 'confirmed' transition (the pending half of the precision). */
    pendingGateWatch: string[];
    refinements: number;
    refinementsRecovered: number;
    evalVerdicts: number;
    evalVerdictsAgreed: number;
    /** `${slug}|${lastEvalAt}` samples already counted — one per verdict era. */
    evalErasCounted: string[];
    updatedAt: string;
    ratios?: MetaCalibrationRatios;
}

const empty = (): MetaCalibrationData => ({
    worthGateApproved: 0,
    worthGateConfirmed: 0,
    pendingGateWatch: [],
    refinements: 0,
    refinementsRecovered: 0,
    evalVerdicts: 0,
    evalVerdictsAgreed: 0,
    evalErasCounted: [],
    updatedAt: new Date(0).toISOString(),
});

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

const read = async (username: string): Promise<MetaCalibrationData> => {
    try {
        const raw = await getPreferenceObject<MetaCalibrationData>(keyFor(username));
        return raw && typeof raw === 'object'
            ? { ...empty(), ...raw }
            : empty();
    } catch {
        return empty();
    }
};

const write = async (username: string, data: MetaCalibrationData): Promise<void> => {
    try {
        await setPreferenceObject(keyFor(username), data);
    } catch { /* meta-calibration must never break its callers */ }
};

/** Normalize a trigger for watch matching (same shape as draftTriggerKey's IF part). */
const normCondition = (ifCondition: string | undefined): string =>
    (ifCondition || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const recordWorthGateApproval = async (username: string, ifCondition?: string): Promise<void> => {
    try {
        const d = await read(username);
        d.worthGateApproved += 1;
        const key = normCondition(ifCondition);
        if (key && !d.pendingGateWatch.includes(key)) {
            d.pendingGateWatch = [...d.pendingGateWatch, key].slice(-WATCH_CAP);
        }
        d.updatedAt = new Date().toISOString();
        await write(username, d);
    } catch { /* ignore */ }
};

/** A gate-approved skill just reached 'confirmed' for the first time. */
export const recordWorthGateConfirm = async (username: string, ifCondition?: string): Promise<void> => {
    try {
        const d = await read(username);
        const key = normCondition(ifCondition);
        const idx = key ? d.pendingGateWatch.indexOf(key) : -1;
        if (idx >= 0) {
            d.pendingGateWatch.splice(idx, 1);
            d.worthGateConfirmed += 1;
            d.updatedAt = new Date().toISOString();
            await write(username, d);
        }
    } catch { /* ignore */ }
};

/** A shadow refinement (§8.3c) settled: recovered = it won the comparison. */
export const recordRefinementOutcome = async (username: string, recovered: boolean): Promise<void> => {
    try {
        const d = await read(username);
        d.refinements += 1;
        if (recovered) d.refinementsRecovered += 1;
        d.updatedAt = new Date().toISOString();
        await write(username, d);
    } catch { /* ignore */ }
};

/** One followed outcome after a helps/hurts verdict era counted once per era. */
export const recordEvalAgreement = async (
    username: string,
    eraKey: string,
    agreed: boolean,
): Promise<void> => {
    try {
        const d = await read(username);
        if (!eraKey || d.evalErasCounted.includes(eraKey)) return;
        d.evalVerdicts += 1;
        if (agreed) d.evalVerdictsAgreed += 1;
        d.evalErasCounted = [...d.evalErasCounted, eraKey].slice(-ERA_CAP);
        d.updatedAt = new Date().toISOString();
        await write(username, d);
    } catch { /* ignore */ }
};

export const computeMetaCalibrationRatios = (d: MetaCalibrationData): MetaCalibrationRatios => ({
    worthGatePrecision: d.worthGateApproved > 0 ? d.worthGateConfirmed / d.worthGateApproved : null,
    refinementRecovery: d.refinements > 0 ? d.refinementsRecovered / d.refinements : null,
    evalAgreement: d.evalVerdicts > 0 ? d.evalVerdictsAgreed / d.evalVerdicts : null,
});

export const loadMetaCalibration = async (username: string): Promise<MetaCalibrationData> =>
    read(username);

/**
 * Weekly (deterministic): persist the current ratios + emit the decay
 * harness-lesson. Called from the weekly review, so a pass happens at most
 * once per week per user; the lesson is deduped by the lesson store's
 * scope+kind+pattern matching.
 */
export const runWeeklyMetaCalibration = async (username: string): Promise<MetaCalibrationRatios> => {
    const d = await read(username);
    const ratios = computeMetaCalibrationRatios(d);
    d.ratios = ratios;
    d.updatedAt = new Date().toISOString();
    await write(username, d);

    const precision = ratios.worthGatePrecision;
    if (precision !== null && d.worthGateApproved >= META_GATE_SAMPLE_MIN && precision < META_PRECISION_FLOOR) {
        recordHarnessLesson({
            kind: 'injection',
            scope: 'skillGuidance',
            pattern: 'worth-gate-precision-decay',
            lesson: `Worth-gate precision fell to ${Math.round(precision * 100)}% over ${d.worthGateApproved} gate-approved creations — the gate is approving skills that don't confirm. Proposed default change: raise MIN_SAMPLE_CONFIRMED (currently 5) and/or tighten the Wilson cold-start band; approve before it takes effect.`,
            evidenceId: username,
        });
    }
    return ratios;
};
