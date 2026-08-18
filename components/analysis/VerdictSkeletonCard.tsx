import React from 'react';

export interface VerdictPlanFields {
    coin?: string;
    direction?: string;
    entry?: string;
    stopLoss?: string;
    takeProfits?: string[];
    confidence?: string;
}

interface VerdictSkeletonCardProps {
    fields: VerdictPlanFields;
}

/**
 * Skeleton-fill verdict card — renders while the moderator is still writing
 * and the plan is not yet binding. Each labeled line fills in as it lands in
 * the stream; unfilled rows shimmer. Replaced by the real TradingSignalCard
 * the moment the plan becomes binding.
 */
const Row: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-b-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</span>
        {value ? (
            <span className="text-sm font-semibold text-zinc-100">{value}</span>
        ) : (
            <span className="verdict-skeleton-bar" aria-hidden="true" />
        )}
    </div>
);

const VerdictSkeletonCard: React.FC<VerdictSkeletonCardProps> = ({ fields }) => {
    const direction = fields.direction && fields.direction !== 'Neutral' ? fields.direction : undefined;
    return (
        <div className="rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-black tracking-wide text-zinc-100">
                    {fields.coin || <span className="verdict-skeleton-bar verdict-skeleton-bar-sm" aria-hidden="true" />}
                </span>
                {direction ? (
                    <span className="rounded border border-white/15 bg-zinc-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-200">
                        {direction}
                    </span>
                ) : (
                    <span className="verdict-skeleton-bar verdict-skeleton-bar-sm" aria-hidden="true" />
                )}
            </div>
            <Row label="Entry" value={fields.entry} />
            <Row label="Stop loss" value={fields.stopLoss} />
            <Row
                label="Targets"
                value={fields.takeProfits?.length ? fields.takeProfits.join(' · ') : undefined}
            />
            <Row label="Confidence" value={fields.confidence} />
        </div>
    );
};

export default VerdictSkeletonCard;
