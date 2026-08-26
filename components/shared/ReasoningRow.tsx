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

/** First non-empty line — the collapsed, settled row previews the START of
 *  the trace (where the reasoning began), truncated with "Show full reasoning". */
const firstLine = (text: string): string => {
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (t) return t;
    }
    return '';
};

/**
 * Collapsible thinking row, built on a native `<details>` so it keeps
 * disclosure semantics. Behavior:
 *   · COLLAPSED BY DEFAULT — always. While streaming the collapsed summary
 *     shows a LIVE DURATION ("Thinking · 7s") plus the latest-line ticker,
 *     so progress is visible without yanking the pane open.
 *   · Settled collapsed rows show the first-line preview + "Show full
 *     reasoning" affordance and a "Thought for Ns" duration.
 *   · Expanded bodies render near-white readable text (not dim gray) and
 *     TRUNCATE past 600 chars with their own Show more / Show less toggle —
 *     expansion previews the reasoning instead of dumping thousands of chars.
 * Running state keeps the gradient light-sweep; the caret marks growth.
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
    // Clock starts at mount if the row is already streaming (live message), so
    // the settle can still report a "Thought for Ns" duration.
    const startedAtRef = useRef<number | null>(running ? Date.now() : null);
    const [durationMs, setDurationMs] = useState<number | null>(null);
    // Live seconds while streaming — ticks every second in the collapsed row.
    const [liveSeconds, setLiveSeconds] = useState<number | null>(
        running && startedAtRef.current !== null ? Math.round((Date.now() - startedAtRef.current) / 1000) : null,
    );
    const trimmed = thinking.trim();

    // Follow the live state WITHOUT opening: when the stream starts we begin
    // (or restart) the clock; when it settles we snap shut (no-op if already
    // collapsed — the rule is collapsed-by-default) and record the
    // total thinking time for the "Thought for Ns" meta.
    useEffect(() => {
        if (running && !wasRunningRef.current) {
            startedAtRef.current = Date.now();
            setDurationMs(null);
            setShowFullTrace(false);
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
    // window into the stream. Once settled, the collapsed row instead shows a
    // truncated preview of the trace's first line ending in a "Show full
    // reasoning" affordance (the whole summary still toggles open/closed).
    const showTicker = running && !open;
    const showPreview = !running && !open;

    // Inner truncation applies to the SETTLED expanded body only — a live
    // stream shows everything (the user opened it deliberately mid-run).
    // The cut lands on a LINE boundary (never mid-fence/mid-table)
    // and "Show full reasoning" reveals the WHOLE trace — no second truncated
    // view behind a toggle.
    const needsTrim = !running && trimmed.length > EXPAND_PREVIEW_CHARS;
    const traceShown = needsTrim && !showFullTrace
        ? `${trimmed.slice(0, trimmed.lastIndexOf('\n', EXPAND_PREVIEW_CHARS) > 0 ? trimmed.lastIndexOf('\n', EXPAND_PREVIEW_CHARS) : EXPAND_PREVIEW_CHARS).trimEnd()}\n…`
        : trimmed;
    const liveMeta = running && liveSeconds !== null ? `${liveSeconds}s` : null;
    const shownMeta = durationMs !== null
        ? `${(durationMs / 1000).toFixed(1)}s`
        : liveMeta;

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
                {(shownMeta !== null || tokens != null) && (
                    <span className="reasoning-row-meta" aria-label={shownMeta ? `${shownMeta} thinking` : undefined}>
                        {shownMeta !== null && <>· {shownMeta}</>}
                        {shownMeta !== null && tokens != null && tokens > 0 && ' ·'}
                        {tokens != null && tokens > 0 && ` ${tokens.toLocaleString()} tok`}
                        {running && <span className="reasoning-row-dots" aria-hidden="true"><span /><span /><span /></span>}
                    </span>
                )}
                {showTicker && (
                    <span className="reasoning-row-clip" ref={clipRef}>
                        <span className="reasoning-row-line">{latestLine(trimmed)}</span>
                    </span>
                )}
                {showPreview && (
                    <>
                        <span className="reasoning-row-preview">{firstLine(trimmed)}</span>
                        <span className="reasoning-row-more">Show full reasoning</span>
                    </>
                )}
                <ChevronDownIcon className={`reasoning-row-chevron ${open ? 'is-open' : ''}`} />
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
