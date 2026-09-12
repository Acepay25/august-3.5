import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from './Icons';
import { getActiveUsername } from '../../utils/activeUser';
import { nextTip } from '../../utils/tradingTips';
import { stripTraceMarkers, traceLines } from '../../utils/traceText';

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
 * disclosure semantics:
 *   · RUNNING = a one-line window: the rotating `Tip: …` label (every ~5s,
 *     every third slot a habit from the trader's own learned memory), a live
 *     duration tick and the newest trace line scrolling by — markdown
 *     markers stripped so the ticker reads as clean speech.
 *   · SETTLE = the row OPENS into its read state — a boxed `Thought` panel
 *     whose body is the trace as clean bulleted lines (one observation per
 *     bullet, emphasis markers peeled — the model's `**` never shows).
 *     A manual toggle during the run wins over the auto-open.
 *   · Expanded bodies truncate past 600 chars mid-line with their own
 *     Show more / Show less toggle — expansion previews the reasoning
 *     instead of dumping thousands of chars.
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
    // A manual summary click during the run opts out of the settle auto-open.
    const userToggledRef = useRef(false);
    // Clock starts at mount if the row is already streaming (live message).
    const startedAtRef = useRef<number | null>(running ? Date.now() : null);
    // Live seconds while streaming — ticks every second in the collapsed row.
    const [liveSeconds, setLiveSeconds] = useState<number | null>(
        running && startedAtRef.current !== null ? Math.round((Date.now() - startedAtRef.current) / 1000) : null,
    );
    const trimmed = thinking.trim();

    // When the stream starts we begin (or restart) the clock and arm a fresh
    // auto-open; when it settles the row OPENS into its read state — the
    // trader shouldn't have to click to read what the model was thinking.
    // A manual toggle during the run means the user already chose a state.
    useEffect(() => {
        if (running && !wasRunningRef.current) {
            startedAtRef.current = Date.now();
            setShowFullTrace(false);
            userToggledRef.current = false;
        }
        if (wasRunningRef.current && !running) {
            if (!userToggledRef.current) setOpen(true);
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
    // window into the stream.
    const showTicker = running && !open;

    const liveMeta = running && liveSeconds !== null ? `${liveSeconds}s` : null;
    const shownMeta = liveMeta;

    // Inner truncation applies to the SETTLED expanded body only — a live
    // stream shows everything (the user opened it deliberately mid-run).
    // The cut lands mid-line with an ellipsis riding the last bullet —
    // "Show more" reveals the whole trace.
    const needsTrim = !running && trimmed.length > EXPAND_PREVIEW_CHARS;
    const traceShown = needsTrim && !showFullTrace
        ? `${trimmed.slice(0, EXPAND_PREVIEW_CHARS).trimEnd()} …`
        : trimmed;

    // Row label: the reference distinguishes Thinking (live) from Thought
    // (settled). A CUSTOM label (e.g. "Moderator thinking", "Thinking · 3
    // traces") carries information, so it always shows as-is; only the
    // default label flips with the state.
    const tipSlot = Math.floor((liveSeconds ?? 0) / 5);
    const rawTip = running ? nextTip(getActiveUsername(), tipSlot) : null;
    const tipLabel = rawTip ? `Tip: ${rawTip.length > 80 ? `${rawTip.slice(0, 79)}…` : rawTip}` : null;
    const rowLabel = label !== 'Thinking' ? label : (running ? (tipLabel ?? 'Thinking') : 'Thought');

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
                onClick={() => { userToggledRef.current = true; }}
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
                        <span className="reasoning-row-line">{stripTraceMarkers(latestLine(trimmed))}</span>
                    </span>
                )}
            </summary>
            <div className="reasoning-row-body custom-scrollbar" ref={bodyRef}>
                {/* While running the body stays plain (marker-stripped) text —
                    re-parsing a growing trace into bullets every chunk is
                    waste for a panel that is usually collapsed mid-run. The
                    blinking caret makes the growth read as live speech. */}
                {running ? (
                    <div className="whitespace-pre-wrap break-words text-zinc-400">
                        {stripTraceMarkers(trimmed)}
                        <span className="reasoning-row-caret" aria-hidden="true" />
                    </div>
                ) : (
                    <>
                        <div className="space-y-1">
                            {traceLines(traceShown).map((line, i) => (
                                <div key={i} className="flex gap-2">
                                    <span aria-hidden="true" className="shrink-0 text-zinc-600">•</span>
                                    <span className="min-w-0 flex-1 break-words text-zinc-400">{line}</span>
                                </div>
                            ))}
                        </div>
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
