import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Brain, Lightbulb } from './Icons';
import { formatElapsed } from './elapsed';
import { stripTraceMarkers, traceLines } from '../../utils/traceText';
import { subscribeSharedTicker } from '../../hooks/useSharedTicker';
import Disclosure from './Disclosure';

export interface ReasoningRowProps {
    /** Full thinking / chain-of-thought text. */
    thinking: string;
    /** Live stream in progress — shows the live duration. */
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

/**
 * Collapsible thinking row, built on a native `<details>` so it stays a
 * toggle in EVERY state — clicking always expands/collapses the thinking.
 *   · RUNNING + collapsed = a dim glyph, the word `Thinking`, and a live
 *     duration tick. No scrolling ticker — raw trace never previews (models
 *     lean on `**` markdown; it must never leak into the transcript).
 *   · SETTLED + collapsed = a bare ZCode-style `Thought · 14s` row — the
 *     frozen duration PERSISTS so the row still reads as a real step, and
 *     the row stays collapsed (no auto-open; a manual toggle always wins).
 *   · EXPANDED = the boxed trace: clean bulleted lines (one observation per
 *     bullet, emphasis markers peeled) truncated past 600 chars with their
 *     own Show more / Show less toggle.
 * The trace body stays in the DOM when collapsed.
 *
 * **This row labels the TRACE, not the turn.** What the turn is doing right
 * now is the status line one level up (`AnalyzedRow`): it names the activity
 * — "Reading the order book" — and this row answers the other question,
 * "is there a trace, and how long is it". They used to compete: the running
 * row showed a rotating trader tip while the status line said only
 * "Analyzing", so the trader read a generic tip where a real answer was
 * available. The tip has one home now — the waiting placeholder in
 * `ChatWorkTimeline`, which is the one moment a tip is the right thing.
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
    const bodyRef = useRef<HTMLDivElement>(null);
    const wasRunningRef = useRef(running);
    // Clock starts at mount if the row is already streaming (live message).
    const startedAtRef = useRef<number | null>(running ? Date.now() : null);
    // Live seconds while streaming; FROZEN into settledSeconds at settle so
    // the duration survives on the collapsed row.
    const [liveSeconds, setLiveSeconds] = useState<number | null>(
        running && startedAtRef.current !== null ? Math.round((Date.now() - startedAtRef.current) / 1000) : null,
    );
    const [settledSeconds, setSettledSeconds] = useState<number | null>(null);
    // The live body only follows the stream's bottom while the reader IS at
    // the bottom — scrolling up to re-read must win over the auto-follow.
    const bodyPinnedRef = useRef(true);
    const trimmed = thinking.trim();

    // Run start arms a fresh clock (and a fresh body pin); settle freezes the
    // elapsed time into the row's permanent `Thought · Ns` meta.
    useEffect(() => {
        if (running && !wasRunningRef.current) {
            startedAtRef.current = Date.now();
            setShowFullTrace(false);
            bodyPinnedRef.current = true;
        }
        if (wasRunningRef.current && !running) {
            const start = startedAtRef.current;
            setSettledSeconds(start !== null ? Math.max(0, Math.round((Date.now() - start) / 1000)) : null);
            startedAtRef.current = null;
        }
        wasRunningRef.current = running;
    }, [running]);

    // Tick the visible duration once per second while the trace streams.
    // This row used to run its OWN setInterval — one per row, so a
    // 200-message conversation held up to 400 live timers. It now subscribes
    // to the ONE shared ticker (hooks/useSharedTicker.ts); the per-row API is
    // unchanged.
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

    // While expanded and live, follow the bottom of the trace ONLY while the
    // reader is pinned there (layout-phase so the pin happens before paint).
    // Scrolling up inside the trace unpins until they return to the bottom.
    useLayoutEffect(() => {
        if (!running || !open || !bodyPinnedRef.current) return;
        const body = bodyRef.current;
        if (body) body.scrollTop = body.scrollHeight;
    }, [thinking, running, open, showFullTrace]);

    if (!trimmed) return null;

    const seconds = running ? liveSeconds : settledSeconds;
    const meta = seconds !== null ? formatElapsed(seconds) : null;

    // Inner truncation applies to the SETTLED expanded body only — a live
    // stream shows everything (the user opened it deliberately mid-run).
    // The cut lands mid-line with an ellipsis riding the last bullet —
    // "Show more" reveals the whole trace.
    const needsTrim = !running && trimmed.length > EXPAND_PREVIEW_CHARS;
    const traceShown = needsTrim && !showFullTrace
        ? `${trimmed.slice(0, EXPAND_PREVIEW_CHARS).trimEnd()} …`
        : trimmed;

    // The row labels the TRACE, never the turn. The turn's status line lives
    // one level up (`AnalyzedRow`): it names what the desk is doing right now
    // — "Reading the order book" — and this row answers a different question,
    // "is there a trace, and how long is it". Two rows, two claims; neither
    // competes with the other. A custom label (e.g. "Moderator thinking")
    // carries information, so it always shows as-is.
    const rowLabel = label !== 'Thinking' ? label : (running ? 'Thinking' : 'Thought');

    return (
        <Disclosure
            className={`reasoning-row ${open ? 'is-open' : ''} ${className}`.trim()}
            summaryClassName="reasoning-row-summary"
            bodyClassName="reasoning-row-body custom-scrollbar"
            state={running ? 'running' : 'ok'}
            open={open}
            onToggle={setOpen}
            label={`${label} — ${open ? 'collapse' : 'expand'}`}
            bodyRef={bodyRef}
            onBodyScroll={() => {
                const body = bodyRef.current;
                if (!body) return;
                bodyPinnedRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
            }}
            summary={(
                <>
                    {running ? (
                        <Lightbulb className="reasoning-row-glyph animate-pulse" aria-hidden="true" />
                    ) : (
                        <Brain className="reasoning-row-glyph" aria-hidden="true" />
                    )}
                    <span className="reasoning-row-label">{rowLabel}</span>
                    {meta !== null && (
                        // Settled reads as a sentence ("Thought for 14s"); live
                        // keeps the dot separator so the ticking number doesn't
                        // look like part of the label.
                        <span className="reasoning-row-meta" aria-label={`${meta} of thinking`}>
                            {running ? `· ${meta}` : `for ${meta}`}
                        </span>
                    )}
                </>
            )}
        >
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
                            className="mt-1 text-ui-dense font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-100"
                        >
                            {showFullTrace ? 'Show less' : 'Show more'}
                        </button>
                    )}
                </>
            )}
        </Disclosure>
    );
};

export default React.memo(ReasoningRow);
