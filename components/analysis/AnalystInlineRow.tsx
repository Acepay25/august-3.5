import React from 'react';
import { EnsembleAnalystProgressStatus } from '../../types';
import { ChevronRightIcon } from '../shared/Icons';

const ACCENTS = [
    { color: '#8aabd8', bg: 'rgba(138, 171, 216, 0.12)' },
    { color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)' },
    { color: '#fb7185', bg: 'rgba(251, 113, 133, 0.12)' },
];

const statusDot: Record<EnsembleAnalystProgressStatus, { color: string; label: string }> = {
    complete: { color: 'bg-emerald-400', label: 'done' },
    analyzing: { color: 'bg-cyan-400 animate-pulse', label: 'thinking' },
    waiting: { color: 'bg-zinc-600', label: 'waiting' },
    error: { color: 'bg-rose-500', label: 'failed' },
};

/**
 * Compact clickable row for one analyst in the chat — the "SubAgent ·
 * [role] · [model]" entry that opens the right-side panel on click.
 */
const AnalystInlineRow: React.FC<{
    index: number;
    displayName: string;
    modelName?: string;
    roleEmoji?: string;
    roleColor?: string;
    status: EnsembleAnalystProgressStatus;
    onClick?: () => void;
}> = ({ index, displayName, modelName, roleEmoji, roleColor, status, onClick }) => {
    const accent = ACCENTS[index % ACCENTS.length];
    const dot = statusDot[status];

    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-white/5 bg-zinc-900/50 hover:bg-zinc-800/70 hover:border-white/10 transition-all group text-left"
        >
            <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
                style={{ background: accent.bg, color: accent.color }}
                aria-hidden="true"
            >
                {roleEmoji || displayName.charAt(0)}
            </span>

            <div className="min-w-0 flex-1 flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-200 truncate">
                    {roleColor ? (
                        <span style={{ color: roleColor }}>{displayName}</span>
                    ) : displayName}
                </span>
                {modelName && <span className="text-[10px] text-zinc-500 truncate hidden sm:inline">{modelName}</span>}
            </div>

            <div className="flex items-center gap-2 shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full ${dot.color}`} title={dot.label} />
                <ChevronRightIcon className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </div>
        </button>
    );
};

export default React.memo(AnalystInlineRow);
