
import React from 'react';
import { ConfidenceCalibration } from '../../types';
import { getCalibratedWinRate, getSampleSize, ConfidenceLevel } from '../../services/validation/ConfidenceCalibrationService';

interface CalibrationWidgetProps {
    confidence: 'High' | 'Medium' | 'Low' | 'Avoid';
    confidenceCalibration?: ConfidenceCalibration;
}

/**
 * Displays the historical (calibrated) win rate for the current confidence level.
 * Shows a "Need N more trades to calibrate" hint when sample size is insufficient.
 */
const CalibrationWidget: React.FC<CalibrationWidgetProps> = ({
    confidence,
    confidenceCalibration
}) => {
    const calibratedRate = getCalibratedWinRate(confidenceCalibration, confidence as ConfidenceLevel);
    const sampleSize = getSampleSize(confidenceCalibration, confidence as ConfidenceLevel);

    if (calibratedRate !== null) {
        return (
            <div className="mt-1 flex items-center gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500">Historical:</span>
                <span className={`text-xs font-bold ${calibratedRate >= 65 ? 'text-emerald-400' : calibratedRate >= 50 ? 'text-yellow-400' : 'text-rose-400'}`}>
                    {calibratedRate}% win
                </span>
                <span className="text-[8px] text-zinc-600">({sampleSize} trades)</span>
            </div>
        );
    }

    return sampleSize > 0 ? (
        <div className="mt-1 text-[9px] text-zinc-600 italic">Need {3 - sampleSize} more trades to calibrate</div>
    ) : null;
};

export default React.memo(CalibrationWidget);
