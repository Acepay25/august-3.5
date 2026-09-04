import React from 'react';
import JobsPane from './JobsPane';

/**
 * JobsDrawer: the slide-out "status stack" of background work — every
 * background learning job (insight extraction, skill evals) visible in one
 * place instead of fire-and-forget toasts. Autonomy you can see.
 *
 * The pane body lives in JobsPane (shared with the sidebar's TERMINAL
 * tab); this component is the drawer frame + header around it. JobsPane
 * mounts fresh on each open (subscription lives only while visible).
 */

const JobsDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-white/10 bg-zinc-950 shadow-2xl shadow-black/60 animate-fade-in">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Background jobs</p>
                <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-200" aria-label="Close background jobs">✕</button>
            </div>
            <JobsPane />
        </div>
    );
};

export default JobsDrawer;
