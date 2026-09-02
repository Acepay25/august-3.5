import React from 'react';

// Per-message context disclosure (Batch 13, plan §10.1): "what this seat
// saw". InjectionContextBar shows what the NEXT send will include; this is
// its retrospective twin — the memory injections that ACTUALLY went into
// this run, from the MemoryInjectionService log (stage, audience, sources
// per injection). The trust surface for the learning system itself: a bad
// answer should be answerable by inspection, not faith.

import { getRecentMemoryInjections, MemoryInjectionRecord } from '../../services/learning/MemoryInjectionService';
import { getActiveUsername } from '../../utils/activeUser';

interface ContextDisclosureProps {
    /** ISO timestamp of the message's creation — records at/after the
     *  run's start window are attributed to it. */
    messageCreatedAt?: string;
    /** Upper bound of the run's window (runStats.finishedAt) — without it,
     *  a LATER run's injections fall inside [createdAt, now] and leak into
     *  this card's disclosure. */
    messageFinishedAt?: string;
    /** True while the run was streaming (records land async). */
    isDebating?: boolean;
}

/** Records whose ts falls inside [start, end] — the run's send window. */
const inWindow = (
    recs: MemoryInjectionRecord[],
    startMs: number,
    endMs: number,
): MemoryInjectionRecord[] => recs.filter(r => {
    const t = Date.parse(r.ts);
    return Number.isFinite(t) && t >= startMs && t <= endMs;
});

export const ContextDisclosure: React.FC<ContextDisclosureProps> = ({ messageCreatedAt, messageFinishedAt, isDebating }) => {
    const [open, setOpen] = React.useState(false);
    const [records, setRecords] = React.useState<MemoryInjectionRecord[] | null>(null);

    React.useEffect(() => {
        if (!open || !messageCreatedAt) return;
        let cancelled = false;
        const startMs = Date.parse(messageCreatedAt);
        // Bounded window: [createdAt, finishedAt]. The run's injections all
        // land inside it; a later run's do not. No finishedAt (live run)
        // keeps the open-ended "now" bound.
        const endMs = messageFinishedAt ? Date.parse(messageFinishedAt) : Date.now();
        void getRecentMemoryInjections(getActiveUsername()).then(recs => {
            if (!cancelled) setRecords(inWindow(recs, startMs - 1000, endMs + 1000));
        });
        return () => { cancelled = true; };
    }, [open, messageCreatedAt, messageFinishedAt]);

    if (!messageCreatedAt) return null;

    return (
        <div className="mb-2">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                title="What memory/skills were actually injected into this run"
            >
                {open ? '▾ What this run saw' : '▸ What this run saw'}
            </button>
            {open && (
                <div className="mt-1.5 rounded-lg border border-white/10 bg-zinc-900/60 p-2.5 animate-fade-in">
                    {isDebating && records === null ? (
                        <p className="text-[11px] text-zinc-500">Run in progress — injections appear as they are sent.</p>
                    ) : records === null ? (
                        <p className="text-[11px] text-zinc-500">Loading…</p>
                    ) : records.length === 0 ? (
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                            No memory injections were logged for this run — the prompts went out
                            with the base system text only (memory off, nothing matched, or the
                            run predates injection telemetry).
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {records.map((r, i) => (
                                <li key={`${r.ts}-${i}`} className="text-[11px] leading-snug">
                                    <p className="font-semibold text-zinc-300">
                                        {r.stage}
                                        <span className="ml-2 font-normal text-zinc-500">→ {r.audience}</span>
                                        {r.coin ? <span className="ml-2 font-normal text-zinc-500">· {r.coin}</span> : null}
                                    </p>
                                    {r.sources.length === 0 ? (
                                        <p className="text-zinc-500">no sources</p>
                                    ) : (
                                        <ul className="mt-0.5 space-y-0.5 pl-3">
                                            {r.sources.map(s => (
                                                <li key={`${s.path}`} className="font-mono text-[10px] text-zinc-400 break-all">
                                                    {s.kind} · {s.path}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};
