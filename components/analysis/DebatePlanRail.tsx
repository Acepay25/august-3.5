import React, { useMemo } from 'react';
import { Message } from '../../types';

interface DebatePlanRailProps {
    steps: Array<{ id: string; title: string; status: 'pending' | 'running' | 'done' | 'error' }>;
    activeSpeakers?: Record<string, number>;
}

export const DebatePlanRail: React.FC<DebatePlanRailProps> = ({ steps, activeSpeakers }) => {
    const liveSpeakers = useMemo(() => {
        if (!activeSpeakers) return [];
        return Object.entries(activeSpeakers)
            .filter(([, ts]) => Date.now() - ts < 90_000)
            .map(([name]) => name);
    }, [activeSpeakers]);

    if (steps.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[11px]">
            {steps.map((s, i) => (
                <React.Fragment key={s.id}>
                    {i > 0 && <span className="text-zinc-700">→</span>}
                    <span className={s.status === 'running' ? 'text-zinc-200' : s.status === 'done' ? 'text-zinc-400' : 'text-zinc-600'}>
                        {s.status === 'running' ? '●' : s.status === 'done' ? '✓' : '○'} {s.title}
                    </span>
                </React.Fragment>
            ))}
            {liveSpeakers.length > 0 && (
                <span className="ml-auto text-zinc-600">{liveSpeakers.join(', ')} responding</span>
            )}
        </div>
    );
};

export default DebatePlanRail;
