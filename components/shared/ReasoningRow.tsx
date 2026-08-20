import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import MarkdownContent from './MarkdownContent';
import { ChevronDownIcon } from './Icons';

export interface ReasoningRowProps {
    /** Full thinking / chain-of-thought text. */
    thinking: string;
    /** Live stream in progress — shows a ticker + light sweep. */
    running?: boolean;
    /** Start expanded (e.g. seat transcripts auto-open while live). */
    defaultOpen?: boolean;
    /** Row label. */
    label?: string;
    className?: string;
}

const latestLine = (text: string): string => {
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const t = lines[i].trim();
        if (t) return t;
    }
    return '';
};

/**
 * DeepSeek-style collapsible thinking row, built on a native `<details>` so
 * it keeps disclosure semantics (and the suite's `.closest('details')/.open`
 * assertions). The summary doubles as a one-line ticker: the latest line
 * while running (auto-followed to the right edge), the first-line summary
 * when done. Running state is a gradient light sweep, not a pulsing dot —
 * motion follows state. The trace body stays in the DOM when collapsed.
 */
const ReasoningRow: React.FC<ReasoningRowProps> = ({
    thinking,
    running = false,
    defaultOpen = false,
    label = 'Thinking',
    className = '',
}) => {
    const [open, setOpen] = useState(defaultOpen);
    const clipRef = useRef<HTMLSpanElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const wasRunningRef = useRef(running);
    // Clock starts at mount if the row is already streaming (live message), so
    // the settle can still report a "Thought for Ns" duration.
    const startedAtRef = useRef<number | null>(running ? Date.now() : null);
    const [durationMs, setDurationMs] = useState<number | null>(null);
    const trimmed = thinking.trim();

    // Follow the live state: expand when the stream starts (the thinking must
    // be SEEN generating), snap back to the collapsed one-line summary when it
    // settles — the expanded trace is for watching the run, not history. Also
    // time the thinking span so the collapsed row can show "Thought for Ns"
    // (the DeepSeek / o-series convention).
    useEffect(() => {
        if (running && !wasRunningRef.current) {
            setOpen(true);
            startedAtRef.current = Date.now();
            setDurationMs(null);
        }
        if (wasRunningRef.current && !running) {
            setOpen(false);
            if (startedAtRef.current !== null) {
                setDurationMs(Date.now() - startedAtRef.current);
                startedAtRef.current = null;
            }
        }
        wasRunningRef.current = running;
    }, [running]);

    // Keep the collapsed ticker pinned to the NEWEST text while running.
    // Native scrollLeft (not a transform) — reliable in every layout, so the
    // latest words are always visible and the row reads as live speech.
    useLayoutEffect(() => {
        if (!running || open) return;
        const clip = clipRef.current;
        if (!clip) return;
        clip.scrollLeft = clip.scrollWidth;
    }, [thinking, running, open]);

    // While expanded and live, follow the bottom of the trace (layout-phase
    // so the pin happens before paint — no visible lag behind the stream).
    useLayoutEffect(() => {
        if (!running || !open) return;
        const body = bodyRef.current;
        if (body) body.scrollTop = body.scrollHeight;
    }, [thinking, running, open]);

    if (!trimmed) return null;
    // The ticker renders only while running AND collapsed — a live one-line
    // window into the stream. It never duplicates the trace body text when
    // the row is settled or expanded (keeps the thinking queryable once).
    const showTicker = running && !open;

    return (
        <details
            className={`reasoning-row ${open ? 'is-open' : ''} ${className}`.trim()}
            data-state={running ? 'running' : 'ok'}
            open={open}
            onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary
                className="reasoning-row-summary"
                aria-label={`${label} — ${open ? 'collapse' : 'expand'}`}
            >
                <svg viewBox="0 0 16 16" className="reasoning-row-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.17c.36.28.6.7.6 1.16v.67h4v-.67c0-.46.24-.88.6-1.16A4.5 4.5 0 0 0 8 1.5Z" />
                    <path d="M6.4 13.2h3.2M7 14.5h2" strokeLinecap="round" />
                </svg>
                <span className="reasoning-row-label">{label}</span>
                {durationMs !== null && (
                    <span className="reasoning-row-meta" aria-label={`${(durationMs / 1000).toFixed(1)} seconds`}>
                        · {(durationMs / 1000).toFixed(1)}s
                    </span>
                )}
                {running && (
                    <span className="reasoning-row-dots" aria-hidden="true">
                        <span /><span /><span />
                    </span>
                )}
                {showTicker && (
                    <span className="reasoning-row-clip" ref={clipRef}>
                        <span className="reasoning-row-line">{latestLine(trimmed)}</span>
                    </span>
                )}
                <ChevronDownIcon className={`reasoning-row-chevron ${open ? 'is-open' : ''}`} />
            </summary>
            <div className="reasoning-row-body custom-scrollbar" ref={bodyRef}>
                {/* While running the body stays plain text — re-parsing a
                    growing markdown trace every chunk is O(n²) for a panel
                    that is usually collapsed. Markdown lands on settle. The
                    blinking caret makes the growth read as live speech. */}
                {running ? (
                    <div className="whitespace-pre-wrap break-words text-zinc-500">
                        {trimmed}
                        <span className="reasoning-row-caret" aria-hidden="true" />
                    </div>
                ) : (
                    <MarkdownContent content={trimmed} className="text-zinc-500" />
                )}
            </div>
        </details>
    );
};

export default React.memo(ReasoningRow);
