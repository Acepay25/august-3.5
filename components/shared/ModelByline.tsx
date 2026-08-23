import React from 'react';
import type { RunStats } from '../../types/message';

/**
 * ModelByline (ROUND-29): the quiet DeepSeek-style line under a settled AI
 * bubble — who sat on this desk and how long the whole thing took.
 * One text-[10px] row, zinc-600, no chrome. Renders nothing without data.
 */
const ModelByline: React.FC<{ runStats?: RunStats }> = ({ runStats }) => {
    if (!runStats) return null;
    const seats = (runStats.analysts ?? []).map(a => a.displayName).filter(Boolean);
    const bits: string[] = [];
    if (seats.length > 0) bits.push(seats.join(' · '));
    if (runStats.durationMs > 0) {
        const s = runStats.durationMs >= 100_000
            ? `${Math.round(runStats.durationMs / 60_000)}m`
            : `${Math.round(runStats.durationMs / 1000)}s`;
        bits.push(s);
    }
    if (bits.length === 0) return null;
    return (
        <p className="mt-1 text-[10px] tracking-wide text-zinc-600 select-none">
            {bits.join(' · ')}
        </p>
    );
};

export default ModelByline;
