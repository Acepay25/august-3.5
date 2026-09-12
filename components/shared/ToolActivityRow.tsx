import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from './Icons';

export interface ToolActivityRowProps {
    /** Human-readable tool-event lines ("calling order book… · done 120ms"). */
    lines: string[];
    /** The answer this row belongs to is still streaming — live ticker. */
    running?: boolean;
    className?: string;
}

const latestLine = (lines: string[]): string => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const t = (lines[i] ?? '').trim();
        if (t) return t;
    }
    return '';
};

/**
 * Collapsible "Tool activity" section — the tool-call sibling of the
 * Thinking row. While the answer streams it shows as a live row ("Using
 * tools · Ns" + the newest event scrolling in the collapsed line); once the
 * answer settles it collapses to a bare `Tool activity · N calls` line, and
 * the full call/result log stays one click away. Built on the same
 * reasoning-row styling + a native <details> so disclosure behavior and
 * look match the Thinking row exactly.
 */
const ToolActivityRow: React.FC<ToolActivityRowProps> = ({ lines, running = false, className = '' }) => {
    const [open, setOpen] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);
    const clipRef = useRef<HTMLSpanElement>(null);
    const wasRunningRef = useRef(running);
    const startedAtRef = useRef<number | null>(running ? Date.now() : null);
    const [liveSeconds, setLiveSeconds] = useState<number | null>(
        running && startedAtRef.current !== null ? Math.round((Date.now() - startedAtRef.current) / 1000) : null,
    );
    const trimmed = lines.filter(l => l && l.trim());

    useEffect(() => {
        if (running && !wasRunningRef.current) startedAtRef.current = Date.now();
        if (wasRunningRef.current && !running) {
            setOpen(false);
            startedAtRef.current = null;
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

    // Collapsed + live: keep the newest event visible in the one-line window.
    useLayoutEffect(() => {
        if (!running || open) return;
        const clip = clipRef.current;
        if (clip) clip.scrollLeft = clip.scrollWidth;
    }, [lines, running, open]);

    // Expanded + live: follow the bottom of the log.
    useLayoutEffect(() => {
        if (!running || !open) return;
        const body = bodyRef.current;
        if (body) body.scrollTop = body.scrollHeight;
    }, [lines, running, open]);

    if (trimmed.length === 0) return null;

    const meta = running && liveSeconds !== null
        ? `${liveSeconds}s`
        : `${trimmed.length} call${trimmed.length === 1 ? '' : 's'}`;
    const label = running ? 'Using tools' : 'Tool activity';
    const showTicker = running && !open;

    return (
        <details
            className={`reasoning-row ${open ? 'is-open' : ''} ${className}`.trim()}
            data-state={running ? 'running' : 'ok'}
            data-testid="tool-activity"
            open={open}
            onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary className="reasoning-row-summary" aria-label={`${label} — ${open ? 'collapse' : 'expand'}`}>
                {!open && (
                    <svg viewBox="0 0 16 16" className="reasoning-row-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                )}
                <ChevronDownIcon className={`reasoning-row-chevron ${open ? 'is-open' : ''}`} />
                <span className="reasoning-row-label">{label}</span>
                <span className="reasoning-row-meta">· {meta}</span>
                {running && <span className="reasoning-row-dots" aria-hidden="true"><span /><span /><span /></span>}
                {showTicker && (
                    <span className="reasoning-row-clip" ref={clipRef}>
                        <span className="reasoning-row-line">{latestLine(trimmed)}</span>
                    </span>
                )}
            </summary>
            <div className="reasoning-row-body custom-scrollbar" ref={bodyRef}>
                <ul className="space-y-0.5">
                    {trimmed.map((t, i) => (
                        <li key={i} className="whitespace-pre-wrap font-mono text-[10px] leading-4 text-zinc-500">▸ {t}</li>
                    ))}
                </ul>
            </div>
        </details>
    );
};

export default React.memo(ToolActivityRow);
