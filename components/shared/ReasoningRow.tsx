import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Brain, Lightbulb } from 'lucide-react';
import { getActiveUsername } from '../../utils/activeUser';
import { nextTip } from '../../utils/tradingTips';
import { stripTraceMarkers, traceLines } from '../../utils/traceText';

export interface ReasoningRowProps {
    /** Full thinking / chain-of-thought text. */
    thinking: string;
    /** Live stream in progress — shows the rotating tip + live duration. */
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
 *   · RUNNING + collapsed = a MiniMax-style tip line: a dim glyph, `Tip: …`
 *     rotating every ~5s (every third slot a habit from the trader's own
 *     learned memory), the text wrapping naturally, plus a live duration
 *     tick. No scrolling ticker — raw trace never previews (models lean on
 *     `**` markdown; it must never leak into the transcript).
 *   · SETTLED + collapsed = a bare ZCode-style `Thought · 14s` row — the
 *     frozen duration PERSISTS so the row still reads as a real step, and
 *     the row stays collapsed (no auto-open; a manual toggle always wins).
 *   · EXPANDED = the boxed trace: clean bulleted lines (one observation per
 *     bullet, emphasis markers peeled) truncated past 600 chars with their
 *     own Show more / Show less toggle.
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
    const meta = seconds !== null ? `${seconds}s` : null;

    // Inner truncation applies to the SETTLED expanded body only — a live
    // stream shows everything (the user opened it deliberately mid-run).
    // The cut lands mid-line with an ellipsis riding the last bullet —
    // "Show more" reveals the whole trace.
    const needsTrim = !running && trimmed.length > EXPAND_PREVIEW_CHARS;
    const traceShown = needsTrim && !showFullTrace
        ? `${trimmed.slice(0, EXPAND_PREVIEW_CHARS).trimEnd()} …`
        : trimmed;

    // The live default is the rotating trader tip; a CUSTOM label (e.g.
    // "Moderator thinking") carries information, so it always shows as-is,
    // and the settled row always reads `Thought` (ZCode reference).
    const tipSlot = Math.floor((liveSeconds ?? 0) / 5);
    const rawTip = running && label === 'Thinking' ? nextTip(getActiveUsername(), tipSlot) : null;
    const rowLabel = label !== 'Thinking' ? label : (running ? 'Thinking' : 'Thought');

    return (
        <details
            className={`reasoning-row ${open ? 'is-open' : ''} ${className}`.trim()}
            data-state={running ? 'running' : 'ok'}
            open={open}
            onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary
                className={`reasoning-row-summary ${running ? 'is-tip' : ''}`.trim()}
                aria-label={`${label} — ${open ? 'collapse' : 'expand'}`}
            >
                {running ? (
                    <Lightbulb className="reasoning-row-glyph" aria-hidden="true" />
                ) : (
                    <Brain className="reasoning-row-glyph" aria-hidden="true" />
                )}
                {rawTip ? (
                    // MiniMax-style tip: wraps naturally, never truncated.
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        Tip: {rawTip}
                    </span>
                ) : (
                    <span className="reasoning-row-label">{rowLabel}</span>
                )}
                {meta !== null && (
                    <span className="reasoning-row-meta" aria-label={`${meta} thinking`}>
                        · {meta}
                    </span>
                )}
            </summary>
            <div
                className="reasoning-row-body custom-scrollbar"
                ref={bodyRef}
                onScroll={() => {
                    const body = bodyRef.current;
                    if (!body) return;
                    bodyPinnedRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
                }}
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
