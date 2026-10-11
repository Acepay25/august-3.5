import React from 'react';
import { Pencil, RotateCcw } from './Icons';

/**
 * InterruptedRunNotice — the "Run stopped" card, shared by the Chat surface
 * row (ChatTranscriptRow) and the Chart AI dock list (ChatTranscriptList),
 * which used to carry two drifting copies of the same furniture.
 *
 * Rendered only with at least ONE handler: a "Run stopped" label with no
 * button beside it is a dead notice — it names a problem and offers no way
 * out, which is worse than saying nothing.
 */
export const InterruptedRunNotice: React.FC<{
    onEditPrompt?: () => void;
    onTryAgain?: () => void;
}> = ({ onEditPrompt, onTryAgain }) => {
    if (!onEditPrompt && !onTryAgain) return null;
    return (
        <div className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="interrupted-run-notice">
            <span className="text-ui-xs text-zinc-500">Run stopped</span>
            {onEditPrompt && (
                <button type="button"
                    onClick={onEditPrompt}
                    className="flex items-center hit-target gap-1 rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    <span>Edit prompt</span>
                </button>
            )}
            {onTryAgain && (
                <button type="button"
                    onClick={onTryAgain}
                    className="flex items-center hit-target gap-1 rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    <span>Try again</span>
                </button>
            )}
        </div>
    );
};
