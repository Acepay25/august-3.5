/**
 * CalibrationDriftNote — amber warning chip on an analysis card when the
 * AI's declared probability is materially out of line with the historical
 * win rate of its confidence bucket ("running hot" or "running cold").
 *
 * Renders nothing when calibration is accurate or has insufficient data —
 * the passive historical rate stays in the CalibrationWidget.
 */

import React from 'react';
import { ConfidenceCalibration } from '../../types';
import { AlertTriangleIcon } from '../shared/Icons';
import { getCalibrationDrift, ConfidenceLevel } from '../../services/validation/ConfidenceCalibrationService';

interface CalibrationDriftNoteProps {
    confidence: ConfidenceLevel;
    probability: number;
    confidenceCalibration?: ConfidenceCalibration;
}

const fmt = (n: number): string => `${Math.round(n)}%`;

const CalibrationDriftNote: React.FC<CalibrationDriftNoteProps> = ({
    confidence,
    probability,
    confidenceCalibration,
}) => {
    const drift = getCalibrationDrift(confidenceCalibration, confidence, probability);
    if (drift.status !== 'overconfident' && drift.status !== 'underconfident') return null;

    const isOver = drift.status === 'overconfident';
    const message = isOver
        ? `Overconfident — AI says ${fmt(drift.declared)} but "${confidence}" historically wins ${fmt(drift.actual!)} (n=${drift.sampleSize})`
        : `Underconfident — AI says ${fmt(drift.declared)} but "${confidence}" historically wins ${fmt(drift.actual!)} (n=${drift.sampleSize})`;

    return (
        <div
            className="mt-1.5 flex items-start gap-1.5 px-2 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-[9px] leading-snug max-w-[220px]"
            title={isOver
                ? `AI probability runs ${fmt(Math.abs(drift.delta!))} above reality for "${confidence}" trades — size/select down accordingly.`
                : `AI probability runs ${fmt(Math.abs(drift.delta!))} below reality for "${confidence}" trades — the setup may be better than rated.`}
        >
            <AlertTriangleIcon className="w-3 h-3 shrink-0 mt-px" />
            <span>{message}</span>
        </div>
    );
};

export default React.memo(CalibrationDriftNote);
