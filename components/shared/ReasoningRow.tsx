import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import MarkdownContent from './MarkdownContent';
import { ChevronDownIcon } from './Icons';

export interface ReasoningRowProps {
    /** Full thinking / chain-of-thought text. */
    thinking: string;
    /** Live stream in progress — shows a ticker + light sweep. */
    running?: boolean;
    /** Kept for API compatibility — rows ALWAYS start collapsed. */
    defaultOpen?: boolean;
    /** Row label. */
    label?: string;
    className?: string;
    tokens?: number;
}

/** Expanded traces longer than this truncate with an inline Show-more toggle
 *  (truncation applies inside the expanded state too). */
const EXPAND_PREVIEW_CHARS = 600;

const latestLine = (text: string): string => {
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const t = lines[i].trim();
        if (t) return t;
    }
    return '';
};

/**
 * Collapsible thinking row, built on a native `<details>` so it keeps
 * disclosure semantics — styled to the Hermes reference:
 *   · COLLAPSED + SETTLED = a bare quiet `Thought ›` line — no icon, no
 *     duration, no preview. Blends into the transcript like the
 *     reference's per-step Thought rows.
 *   · RUNNING = `Thinking · Ns` with a live duration tick and the
 *     latest-line ticker, so progress is visible without opening.
 *   · Expanded bodies render near-white readable text (not dim gray) and
 *     TRUNCATE past 600 chars with their own Show more / Show less toggle —
 *     expansion previews the reasoning instead of dumping thousands of chars.
 * The trace body stays in the DOM when collapsed.
 */
const ReasoningRow: React.FC<ReasoningRowProps> = ({
    thinking,
    running = false,
    defaultOpen: _defaultOpen = false,
    label = 'Thinking',
    className = '',
    tokens,
}) => {
    const [open, setOpen] = useState(false);
    // Inner truncation state — independent from the disclosure itself.
    const [showFullTrace, setShowFullTrace] = useState(false);
    const clipRef = useRef<HTMLSpanElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const wasRunningRef = useRef(running);
    // Clock starts at mount if the row is already streaming (live message).
    const startedAtRef = useRef<number | null>(running ? Date.now() : null);
    // Live seconds while streaming — ticks every second in the collapsed row.
    const [liveSeconds, setLiveSeconds] = useState<number | null>(
        running && startedAtRef.current !== null ? Math.round((Date.now() - startedAtRef.current) / 1000) : null,
    );
    const trimmed = thinking.trim();

    // Follow the live state WITHOUT opening: when the stream starts we begin
    // (or restart) the clock; when it settles we snap shut (no-op if already
    // collapsed — the rule is collapsed-by-default). Settled rows show no
    // duration — the reference's Thought rows are bare.
    useEffect(() => {
        if (running && !wasRunningRef.current) {
            startedAtRef.current = Date.now();
            setShowFullTrace(false);
        }
        if (wasRunningRef.current && !running) {
            setOpen(false);
            startedAtRef.current = null;
        }
        wasRunningRef.current = running;
    }, [running]);

    // Tick the visible duration once per second while the trace streams.
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
    }, [thinking, running, open, showFullTrace]);

    if (!trimmed) return null;
    // The ticker renders only while running AND collapsed — a live one-line
    // window into the stream. Settled collapsed rows are bare (no preview —
    // the reference's Thought rows carry nothing but the label).
    const showTicker = running && !open;

    const liveMeta = running && liveSeconds !== null ? `${liveSeconds}s` : null;
    const shownMeta = liveMeta;

    // Inner truncation applies to the SETTLED expanded body only — a live
    // stream shows everything (the user opened it deliberately mid-run).
    // The cut lands on a LINE boundary and "Show more" reveals the whole trace.
    const needsTrim = !running && trimmed.length > EXPAND_PREVIEW_CHARS;
    const traceShown = needsTrim && !showFullTrace
        ? `${trimmed.slice(0, trimmed.lastIndexOf('\n', EXPAND_PREVIEW_CHARS) > 0 ? trimmed.lastIndexOf('\n', EXPAND_PREVIEW_CHARS) : EXPAND_PREVIEW_CHARS).trimEnd()}\n…`
        : trimmed;

    // Row label: the reference distinguishes Thinking (live) from Thought
    // (settled). A CUSTOM label (e.g. "Moderator thinking", "Thinking · 3
    // traces") carries information, so it always shows as-is; only the
    // default label flips with the state.
    const rowLabel = label !== 'Thinking' ? label : (running ? 'Thinking' : 'Thought');

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
                {!open && (
                    <svg viewBox="0 0 16 16" className="reasoning-row-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                )}
                <ChevronDownIcon className={`reasoning-row-chevron ${open ? 'is-open' : ''}`} />
                <span className="reasoning-row-label">{rowLabel}</span>
                {shownMeta !== null && (
                    <span className="reasoning-row-meta" aria-label={`${shownMeta} thinking`}>
                        · {shownMeta}
                    </span>
                )}
                {running && <span className="reasoning-row-dots" aria-hidden="true"><span /><span /><span /></span>}
                {showTicker && (
                    <span className="reasoning-row-clip" ref={clipRef}>
                        <span className="reasoning-row-line">{latestLine(trimmed)}</span>
                    </span>
                )}
            </summary>
            <div className="reasoning-row-body custom-scrollbar" ref={bodyRef}>
                {/* While running the body stays plain text — re-parsing a
                    growing markdown trace every chunk is O(n²) for a panel
                    that is usually collapsed. Markdown lands on settle. The
                    blinking caret makes the growth read as live speech. */}
                {running ? (
                    <div className="whitespace-pre-wrap break-words text-zinc-400">
                        {trimmed}
                        <span className="reasoning-row-caret" aria-hidden="true" />
                    </div>
                ) : (
                    <>
                        <MarkdownContent content={traceShown} className="text-zinc-400" />
                        {needsTrim && (
                            <button
                                type="button"
                                onClick={() => setShowFullTrace(prev => !prev)}
                                className="mt-1 text-[11px] font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-100"
                            >
                                {showFullTrace ? 'Show less' : 'Show more'}
                            </button>
                        )}
                    </>
                )}
            </div>
        </details>
    );
};

export default React.memo(ReasoningRow);
