import React, { useEffect, useRef, useState } from 'react';
import { Brain } from './Icons';
import { subscribeSharedTicker } from '../../hooks/useSharedTicker';

export interface AnalyzedRowProps {
    /** The turn is still working (streaming, no answer text yet) — the
     *  timeline stays OPEN live and the duration ticks. */
    running?: boolean;
    className?: string;
    toolsCount?: number;
    /** The turn's frozen work time in ms, persisted at settle. Used ONLY when
     *  the clock is not ticking: precedence is live tick > this > nothing.
     *  A reloaded turn has no live clock, so this is what keeps its
     *  "Analyzed for Ns" on screen. */
    persistedMs?: number;
    /** What the work was, named from real data — "Read the chart, order book
     *  and notebook". Rendered after the duration; omitted when unknown. */
    title?: string;
    /** What the turn is doing RIGHT NOW — "Reading the order book". This is
     *  the RUNNING label, and it replaces the bare "Analyzing": a state says
     *  the desk is busy, an activity says what it is busy with. Derived from
     *  the turn's own tool lines (`utils/turnStatus.ts`), so it can only
     *  report what the tools did. Absent ⇒ the bare "Analyzing". */
    activity?: string | null;
    children: React.ReactNode;
}

/**
 * "Analyzed for 14s" — the ZCode `Worked for 7m 15s` wrapper. The WHOLE
 * work timeline (interleaved Thought rows + tool rounds) folds into this
 * ONE collapsible: it stays open while the work streams and collapses to a
 * single summary row the moment the answer lands (re-openable). The clock
 * covers the pre-answer work phase only — it starts at turn start and
 * freezes when the answer text begins.
 */
const AnalyzedRow: React.FC<AnalyzedRowProps> = ({ running = false, className = '', toolsCount, persistedMs, title, activity, children }) => {
    const [open, setOpen] = useState(running);
    const wasRunningRef = useRef(running);
    const startedAtRef = useRef<number | null>(running ? Date.now() : null);
    const [liveSeconds, setLiveSeconds] = useState<number | null>(running ? 0 : null);
    const [settledSeconds, setSettledSeconds] = useState<number | null>(null);

    useEffect(() => {
        if (running && !wasRunningRef.current) {
            startedAtRef.current = Date.now();
            setOpen(true);
        }
        if (wasRunningRef.current && !running) {
            const start = startedAtRef.current;
            setSettledSeconds(start !== null ? Math.max(0, Math.round((Date.now() - start) / 1000)) : null);
            startedAtRef.current = null;
            // The answer arrived — fold the work into the single row.
            setOpen(false);
        }
        wasRunningRef.current = running;
    }, [running]);

    // The live clock. This row used to run its OWN setInterval, so a
    // 200-message conversation held up to 400 live timers — one per row —
    // each re-rendering its own row. It now subscribes to the ONE shared
    // ticker (hooks/useSharedTicker.ts); the per-row API is unchanged.
    useEffect(() => {
        if (!running) {
            setLiveSeconds(null);
            return;
        }
        const start = startedAtRef.current ?? Date.now();
        const elapsed = (): number => Math.max(0, Math.round((Date.now() - start) / 1000));
        setLiveSeconds(elapsed());
        return subscribeSharedTicker(() => setLiveSeconds(elapsed()));
    }, [running]);

    // Precedence is deliberate: a LIVE tick outranks everything, then the clock
    // this component froze when the turn settled, and only then the persisted
    // value a reloaded turn carries. A persisted number must never fight a
    // running timer, and a missing one must never print "0s".
    const seconds = running
        ? liveSeconds
        : settledSeconds ?? (typeof persistedMs === 'number' ? Math.max(0, Math.round(persistedMs / 1000)) : null);
    // The reference's two states: running = the "••• verb-ing · 25s" status
    // line; settled with tools = "Ran 4 commands, read a file". Duration only
    // stands alone when there is no action count to lead with.
    const ranTools = toolsCount !== undefined && toolsCount > 0;
    // The RUNNING label is the ACTIVITY, not the state: "Reading the order
    // book" says what the desk is doing, "Analyzing" only says it is busy.
    // The separator follows the same rule as the settled form — a detail
    // takes " · Ns", a bare state keeps " for Ns".
    const runningActivity = (activity ?? '').trim();
    const label = running
        ? (runningActivity || 'Analyzing')
        : ranTools
            ? `Ran ${toolsCount} ${toolsCount === 1 ? 'command' : 'commands'}`
            : 'Analyzed';
    const detail = running
        ? (seconds !== null ? (runningActivity ? ` · ${seconds}s` : ` for ${seconds}s`) : '')
        : ranTools
            ? (title ? `, ${title.charAt(0).toLowerCase()}${title.slice(1)}` : '') + (seconds !== null ? ` · ${seconds}s` : '')
            : (seconds !== null ? ` for ${seconds}s` : '') + (title ? ` · ${title.charAt(0).toLowerCase()}${title.slice(1)}` : '');

    return (
        <details
            className={`reasoning-row analyzed-row ${open ? 'is-open' : ''} ${className}`.trim()}
            data-state={running ? 'running' : 'ok'}
            data-testid="analyzed-row"
            open={open}
            onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary className="reasoning-row-summary" aria-label={`${label}${detail} — ${open ? 'collapse' : 'expand'}`}>
                {running && (
                    <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
                        {[0, 1, 2].map(i => (
                            <span key={i} className="h-1 w-1 animate-pulse rounded-full bg-zinc-500 motion-reduce:animate-none" style={{ animationDelay: `${i * 150}ms` }} />
                        ))}
                    </span>
                )}
                {!running && <Brain className="reasoning-row-glyph" aria-hidden="true" />}
                <span className="reasoning-row-label">
                    {label}{detail}
                </span>
            </summary>
            <div className="reasoning-row-body analyzed-row-body">
                {children}
            </div>
        </details>
    );
};

export default React.memo(AnalyzedRow);
