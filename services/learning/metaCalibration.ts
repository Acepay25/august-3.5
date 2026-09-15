/**
 * Meta-calibration: the loop learns about the loop.
 *
 * Three deterministic ratios (no LLM), maintained by recorders at the exact
 * points that carry ground truth, and computed into a per-user preferences
 * blob:
 *
 *   worth-gate precision   — of gate-approved creations, the fraction that
 *                            later reached 'confirmed' (the gate promised a
 *                            falsifiable prediction; this measures delivery).
 * refinement recovery — of shadow refinements that settled, the
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
import { withSerializedPref } from '../infrastructure/serializedPrefs';
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

/** Coerce one raw blob field into a finite counter (junk → fallback). */
const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

/** Coerce one raw blob field into an array of non-empty strings (junk → []). */
const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

/**
 * Read + NORMALIZE the blob. getPreferenceObject is an unchecked cast, and a
 * corrupted/hand-edited store (string counters, non-array watch lists) used
 * to poison every `+=`/`.includes`/spread below — the recorders' blanket
 * catch then silently swallowed the resulting TypeError, losing the event.
 */
const read = async (username: string): Promise<MetaCalibrationData> => {
    try {
        const raw = await getPreferenceObject<Partial<MetaCalibrationData>>(keyFor(username));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty();
        return {
            worthGateApproved: num(raw.worthGateApproved, 0),
            worthGateConfirmed: num(raw.worthGateConfirmed, 0),
            pendingGateWatch: strArray(raw.pendingGateWatch),
            refinements: num(raw.refinements, 0),
            refinementsRecovered: num(raw.refinementsRecovered, 0),
            evalVerdicts: num(raw.evalVerdicts, 0),
            evalVerdictsAgreed: num(raw.evalVerdictsAgreed, 0),
            evalErasCounted: strArray(raw.evalErasCounted),
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : empty().updatedAt,
            ratios: raw.ratios && typeof raw.ratios === 'object' && !Array.isArray(raw.ratios)
                ? raw.ratios
                : undefined,
        };
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

/**
 * Every recorder below is a read→mutate→write on the per-user blob. They fire
 * concurrently (gate approvals, confirms, refinement settlements and eval
 * agreements from several trades/skills at once), and an unserialized pair
 * loses whichever write read before the other landed — silently dropping
 * counters and watch entries (the same lost-credit class as the injection
 * log, serialized in MemoryInjectionService).
 */
export const recordWorthGateApproval = async (username: string, ifCondition?: string): Promise<void> => {
    try {
        await withSerializedPref(keyFor(username), async () => {
            const d = await read(username);
            d.worthGateApproved += 1;
            const key = normCondition(ifCondition);
            if (key && !d.pendingGateWatch.includes(key)) {
                d.pendingGateWatch = [...d.pendingGateWatch, key].slice(-WATCH_CAP);
            }
            d.updatedAt = new Date().toISOString();
            await write(username, d);
        });
    } catch { /* ignore */ }
};

/** A gate-approved skill just reached 'confirmed' for the first time. */
export const recordWorthGateConfirm = async (username: string, ifCondition?: string): Promise<void> => {
    try {
        await withSerializedPref(keyFor(username), async () => {
            const d = await read(username);
            const key = normCondition(ifCondition);
            const idx = key ? d.pendingGateWatch.indexOf(key) : -1;
            if (idx >= 0) {
                d.pendingGateWatch.splice(idx, 1);
                d.worthGateConfirmed += 1;
                d.updatedAt = new Date().toISOString();
                await write(username, d);
            }
        });
    } catch { /* ignore */ }
};

/** A shadow refinement settled: recovered = it won the comparison. */
export const recordRefinementOutcome = async (username: string, recovered: boolean): Promise<void> => {
    try {
        await withSerializedPref(keyFor(username), async () => {
            const d = await read(username);
            d.refinements += 1;
            if (recovered) d.refinementsRecovered += 1;
            d.updatedAt = new Date().toISOString();
            await write(username, d);
        });
    } catch { /* ignore */ }
};

/** One followed outcome after a helps/hurts verdict era counted once per era. */
export const recordEvalAgreement = async (
    username: string,
    eraKey: string,
    agreed: boolean,
): Promise<void> => {
    try {
        await withSerializedPref(keyFor(username), async () => {
            const d = await read(username);
            if (!eraKey || d.evalErasCounted.includes(eraKey)) return;
            d.evalVerdicts += 1;
            if (agreed) d.evalVerdictsAgreed += 1;
            d.evalErasCounted = [...d.evalErasCounted, eraKey].slice(-ERA_CAP);
            d.updatedAt = new Date().toISOString();
            await write(username, d);
        });
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
    const ratios = await withSerializedPref(keyFor(username), async () => {
        const d = await read(username);
        const r = computeMetaCalibrationRatios(d);
        d.ratios = r;
        d.updatedAt = new Date().toISOString();
        await write(username, d);
        return r;
    });

    const d = await read(username);
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
