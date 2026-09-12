import React, { useEffect, useRef, useState } from 'react';
import { Brain } from 'lucide-react';

export interface AnalyzedRowProps {
    /** The turn is still working (streaming, no answer text yet) — the
     *  timeline stays OPEN live and the duration ticks. */
    running?: boolean;
    className?: string;
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
const AnalyzedRow: React.FC<AnalyzedRowProps> = ({ running = false, className = '', children }) => {
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

    useEffect(() => {
        if (!running) {
            setLiveSeconds(null);
            return;
        }
        const start = startedAtRef.current ?? Date.now();
        setLiveSeconds(Math.max(0, Math.round((Date.now() - start) / 1000)));
        const id = window.setInterval(
            () => setLiveSeconds(Math.max(0, Math.round((Date.now() - start) / 1000))),
            1000,
        );
        return () => window.clearInterval(id);
    }, [running]);

    const seconds = running ? liveSeconds : settledSeconds;
    const label = running ? 'Analyzing' : 'Analyzed';

    return (
        <details
            className={`reasoning-row analyzed-row ${open ? 'is-open' : ''} ${className}`.trim()}
            data-state={running ? 'running' : 'ok'}
            data-testid="analyzed-row"
            open={open}
            onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary className="reasoning-row-summary" aria-label={`${label} — ${open ? 'collapse' : 'expand'}`}>
                <Brain className="reasoning-row-glyph" aria-hidden="true" />
                <span className="reasoning-row-label">
                    {label}{seconds !== null ? ` for ${seconds}s` : ''}
                </span>
            </summary>
            <div className="reasoning-row-body analyzed-row-body">
                {children}
            </div>
        </details>
    );
};

export default React.memo(AnalyzedRow);
