
import React from 'react';

// Progress bar for calibration
export const CalibrationBar: React.FC<{ label: string; actual: number; expected: number; count: number }> = ({
    label, actual, expected, count
}) => {
    const diff = actual - expected;
    const color = diff >= 5 ? 'bg-emerald-500' : diff <= -10 ? 'bg-red-500' : 'bg-yellow-500';
    const status = diff >= 5 ? 'Underconfident' : diff <= -10 ? 'Overconfident' : 'Calibrated';

    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs">
                <span className="text-zinc-400">{label}</span>
                <span className="text-zinc-500">n={count}</span>
            </div>
            <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                    className={`absolute h-full ${color} rounded-full transition-[width] duration-[150ms] ease-[var(--ease-snappy)]`}
                    style={{ width: `${Math.min(100, actual)}%` }}
                />
                {/* Expected marker */}
                <div
                    className="absolute h-full w-0.5 bg-zinc-600"
                    style={{ left: `${expected}%` }}
                />
            </div>
            <div className="flex justify-between text-[10px]">
                <span className={diff >= 5 ? 'text-emerald-400' : diff <= -10 ? 'text-red-400' : 'text-yellow-400'}>
                    {status}
                </span>
                <span className="text-zinc-500">
                    Actual: {actual}% | Expected: ~{expected}%
                </span>
            </div>
        </div>
    );
};

export default CalibrationBar;
