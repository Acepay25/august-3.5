import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DebateTurn } from '../../types/message';
import MarkdownContent from '../shared/MarkdownContent';
import StreamingMarkdown from '../shared/StreamingMarkdown';
import ReasoningRow from '../shared/ReasoningRow';
import { X as CloseIcon } from 'lucide-react';
import { ChevronDownIcon } from '../shared/Icons';
import { DebateBotAvatar } from './DebateBotAvatar';

export interface DebateSidePanelProps {
    open: boolean;
    onClose: () => void;
    turns: DebateTurn[];
    actorIds: string[];
    activeActor: string | null;
    onSelectActor: (id: string) => void;
    isLive?: boolean;
    /** Live desk-tool / routing chips per speaker (shown while debating). */
    liveToolEvents?: Record<string, string>;
    /** Full per-seat thinking traces — rendered in the panel, not the chat. */
    reasoningProcesses?: Record<string, string>;
}

/**
 * Right-hand transcript drawer (ROUND-34, rebuilt ROUND-36b): one tab per
 * debater, styled after the reference agentic runner's task panel —
 *   · "Worked for Xm Ys" runtime counter per seat,
 *   · Thought rows COLLAPSED by default; expanding shows a truncated
 *     preview with a Show more toggle for the full reasoning,
 *   · inter-model rebuttals render as tool-style rows ("A replied to B")
 *     that expand to a truncated body + Show full reply,
 *   · plain statements (openings, verdict) stay readable markdown.
 */

// ─── Helpers ───────────────────────────────────────────────────────────────

/** "3m 44s"-style elapsed label from milliseconds. */
const formatWorkedFor = (ms: number): string => {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
};

/** First-line snippet for collapsed headers ("Thought · prices swept the…"). */
const firstLineSnippet = (text: string, max = 64): string => {
    const line = text.split('\n').map(l => l.trim()).find(Boolean) || '';
    return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
};

/** Body shown when a row is expanded: truncated past `limit` until "more". */
const TRUNCATE_LIMIT = 320;

// ─── Truncated body with Show more ─────────────────────────────────────────

const TruncatedBody: React.FC<{ text: string; limit?: number; moreLabel?: string; live?: boolean }> = ({
    text,
    limit = TRUNCATE_LIMIT,
    moreLabel = 'Show more',
    live,
}) => {
    const [expanded, setExpanded] = useState(false);
    const trimmed = text.trim();
    if (!trimmed) return null;
    // Live streams render in full (they grow anyway) — truncation is for
    // settled history, where the point is skimmability.
    if (live) {
        return <StreamingMarkdown text={trimmed} live className="text-[12px] leading-5 text-zinc-400" />;
    }
    const needsTruncate = trimmed.length > limit;
    const shown = expanded || !needsTruncate
        ? trimmed
        : `${trimmed.slice(0, limit).trimEnd()}…`;
    return (
        <div>
            <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-zinc-400">{shown}</p>
            {needsTruncate && (
                <button
                    type="button"
                    onClick={() => setExpanded(prev => !prev)}
                    className="mt-1 text-[11px] font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-100"
                >
                    {expanded ? 'Show less' : moreLabel}
                </button>
            )}
        </div>
    );
};

// ─── Collapsible Thought row (collapsed by default) ────────────────────────

const ThoughtRow: React.FC<{ thinking: string; durationLabel?: string; live?: boolean }> = ({
    thinking,
    durationLabel,
    live,
}) => {
    const [open, setOpen] = useState(false);
    const trimmed = thinking.trim();
    if (!trimmed) return null;
    return (
        <div className="rounded-lg border border-white/5 bg-zinc-900/60">
            <button
                type="button"
                onClick={() => setOpen(prev => !prev)}
                aria-expanded={open}
                aria-label={open ? 'Collapse thought' : 'Expand thought'}
                title={open ? 'Collapse thought' : 'Expand thought'}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
            >
                {/* Lightbulb — matches the reference runner's Thought glyph. */}
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.17c.36.28.6.7.6 1.16v.67h4v-.67c0-.46.24-.88.6-1.16A4.5 4.5 0 0 0 8 1.5Z" />
                    <path d="M6.4 13.2h3.2M7 14.5h2" strokeLinecap="round" />
                </svg>
                <span className="shrink-0 text-[11px] font-medium text-zinc-400">{live ? 'Thinking' : 'Thought'}</span>
                {durationLabel && <span className="text-[10px] tabular-nums text-zinc-600">· {durationLabel}</span>}
                {!open && <span className="min-w-0 flex-1 truncate text-[11px] italic text-zinc-600">{firstLineSnippet(trimmed)}</span>}
                <ChevronDownIcon className={`ml-auto h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="border-t border-white/5 px-2.5 py-2">
                    <TruncatedBody text={trimmed} live={live} moreLabel="Show full reasoning" />
                </div>
            )}
        </div>
    );
};

// ─── Tool-style "replied to" row (inter-model rebuttals) ───────────────────

const ReplyToolRow: React.FC<{
    turn: DebateTurn;
    target?: string;
    live?: boolean;
}> = ({ turn, target, live }) => {
    const [open, setOpen] = useState(false);
    const text = (turn.text || '').trim();
    if (!text) return null;
    return (
        <div className="rounded-lg border border-white/5 bg-zinc-900/40">
            <button
                type="button"
                onClick={() => setOpen(prev => !prev)}
                aria-expanded={open}
                aria-label={open ? 'Collapse reply' : 'Expand reply'}
                title={open ? 'Collapse reply' : 'Expand reply'}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
            >
                {/* Reply glyph — reads like the reference's tool-call chips. */}
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M6.5 3.5 3 7l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 7h6a4 4 0 0 1 4 4v1.5" strokeLinecap="round" />
                </svg>
                <DebateBotAvatar name={turn.speaker} toneKey={turn.speaker} size={14} square live={live} />
                <span className="shrink-0 text-[11px] font-medium text-zinc-400">{turn.speaker}</span>
                <span className="shrink-0 text-[11px] text-zinc-600">{target ? `replied to ${target}` : 'replied'}</span>
                {!open && <span className="min-w-0 flex-1 truncate text-[11px] italic text-zinc-600">{firstLineSnippet(text)}</span>}
                <ChevronDownIcon className={`ml-auto h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="border-t border-white/5 px-2.5 py-2">
                    <TruncatedBody text={text} live={live} moreLabel="Show full reply" />
                    {turn.metrics && (turn.metrics.ttftMs !== undefined || turn.metrics.tokensPerSec !== undefined) && (
                        <p className="mt-1 text-[10px] tabular-nums text-zinc-600">
                            {turn.metrics.ttftMs !== undefined && `first token ${(turn.metrics.ttftMs / 1000).toFixed(1)}s`}
                            {turn.metrics.ttftMs !== undefined && turn.metrics.tokensPerSec !== undefined && ' · '}
                            {turn.metrics.tokensPerSec !== undefined && `${turn.metrics.tokensPerSec} tok/s`}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── Tool-event feed row (zcode-style) ─────────────────────────────────────

/**
 * ROUND-39 UI: per-TYPE tints (Zed reference). Each action class gets a muted
 * hue so long feeds scan by shape: violet = reasoning/thought traffic,
 * steel-blue = data lookups, zinc = everything else. Status colors (emerald/
 * rose) stay reserved for WIN/LOSS.
 */
const rowTintForLine = (line: string): { icon: string; label?: string } => {
    if (/direct message|→\s|read inbox|inbox/i.test(line)) return { icon: 'text-violet-300/80' };
    if (/^calling/i.test(line)) return { icon: 'text-violet-300/50' };
    return { icon: 'text-sky-300/70' }; // explore / lookup — Zed's blue
};

/** Pick the row glyph from the event line's shape (mail vs lookup vs pending). */
const ToolRowIcon: React.FC<{ line: string }> = ({ line }) => {
    const tint = rowTintForLine(line);
    const cls = `h-3 w-3 shrink-0 ${tint.icon}`;
    if (/^calling/i.test(line)) {
        // In-flight call — hourglass-style dot like the reference's running tools.
        return (
            <svg viewBox="0 0 16 16" className={`${cls} animate-pulse`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 2" strokeLinecap="round" />
            </svg>
        );
    }
    if (/direct message|→\s|read inbox|inbox/i.test(line)) {
        // Envelope — direct-message traffic.
        return (
            <svg viewBox="0 0 16 16" className={cls} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 5 5.5 4 5.5-4" strokeLinecap="round" />
            </svg>
        );
    }
    // Default: magnifier — data/notebook lookups ("Explore"-style).
    return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" strokeLinecap="round" />
        </svg>
    );
};

const ToolEventRow: React.FC<{ line: string }> = React.memo(({ line }) => {
    // Lines arrive as "HH:MM:SS · event" (stamped at capture — ROUND-39);
    // the stamp renders as a right-aligned tabular chip, reference-style.
    const m = line.match(/^(\d{1,2}:\d{2}:\d{2})\s·\s([\s\S]+)$/);
    const when = m?.[1];
    const body = m?.[2] ?? line;
    return (
        <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/40 px-2.5 py-1.5">
            <ToolRowIcon line={body} />
            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{body}</span>
            {when && <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{when}</span>}
        </div>
    );
});
ToolEventRow.displayName = 'ToolEventRow';

/**
 * ROUND-39 UI (Zed "Explore · 4 searches" pattern): consecutive same-kind
 * tool events collapse into ONE row with a count, so a busy seat reads as
 * "Lookups · 4" instead of four near-identical lines. Mixed kinds still
 * render individually. Counted groups expand on click.
 */
const ToolEventFeed: React.FC<{ events?: Record<string, string> }> = ({ events }) => {
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    if (!events) return null;
    // Newest-first feed → group consecutive entries of the same kind while
    // walking; each group keeps its newest line as the label + oldest time.
    type Group = { kind: 'mail' | 'call' | 'lookup'; lines: string[] };
    const kindOf = (line: string): Group['kind'] => {
        if (/direct message|→\s|read inbox|inbox/i.test(line)) return 'mail';
        if (/^calling/i.test(line)) return 'call';
        return 'lookup';
    };
    const allLines = Object.values(events).flatMap(v => v.split('\n')).filter(Boolean);
    const groups: Group[] = [];
    for (const line of allLines) {
        const kind = kindOf(line);
        const last = groups[groups.length - 1];
        if (last && last.kind === kind) last.lines.push(line);
        else groups.push({ kind, lines: [line] });
    }
    if (groups.length === 0) return null;
    const kindLabel: Record<Group['kind'], string> = { mail: 'Direct messages', call: 'Calls in flight', lookup: 'Lookups' };
    return (
        <div className="space-y-1">
            {groups.map((group, gi) => {
                const key = `${group.kind}-${gi}`;
                const isOpen = expandedGroup === key;
                const newest = group.lines[0];
                const m = newest.match(/^(\d{1,2}:\d{2}:\d{2})\s·\s([\s\S]+)$/);
                const when = m?.[1];
                const body = m?.[2] ?? newest;
                const counted = group.lines.length > 1;
                return (
                    <div key={key} className="rounded-lg border border-white/5 bg-zinc-900/40">
                        <button
                            type="button"
                            disabled={!counted}
                            onClick={() => setExpandedGroup(isOpen ? null : key)}
                            aria-expanded={counted ? isOpen : undefined}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.03] disabled:hover:bg-transparent"
                        >
                            <ToolRowIcon line={body} />
                            {counted
                                ? (
                                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">
                                        <span className="font-medium text-zinc-300">{kindLabel[group.kind]}</span>
                                        <span className="text-zinc-600"> · </span>
                                        <span className="tabular-nums">{group.lines.length}</span>
                                    </span>
                                )
                                : <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{body}</span>}
                            {counted && <ChevronDownIcon className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />}
                            {!counted && when && <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{when}</span>}
                        </button>
                        {isOpen && (
                            <div className="space-y-1 border-t border-white/5 px-2.5 py-2">
                                {group.lines.map((l, i) => <ToolEventRow key={`${key}-${i}`} line={l} />)}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// ─── Panel ──────────────────────────────────────────────────────────────────

export const DebateSidePanel: React.FC<DebateSidePanelProps> = ({
    open,
    onClose,
    turns,
    actorIds,
    activeActor,
    onSelectActor,
    isLive = false,
    liveToolEvents,
    reasoningProcesses,
}) => {
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const actorTurns = useMemo(() => turns.filter(t => t.speaker === activeActor), [turns, activeActor]);
    const turnCount = actorTurns.length;
    const lastTextLen = actorTurns.length > 0 ? (actorTurns[actorTurns.length - 1].text || '').length : 0;

    // Per-seat runtime counter ("Worked for Xm Ys"): first turn start →
    // last turn end (or NOW while the seat is still generating). A 1 Hz
    // tick keeps it counting up live, like the reference's task panel.
    const [nowTick, setNowTick] = useState(() => Date.now());
    useEffect(() => {
        if (!isLive) return;
        const id = window.setInterval(() => setNowTick(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [isLive]);

    const workedForLabel = useMemo(() => {
        const stamps = actorTurns.map(t => (t.createdAt ? Date.parse(t.createdAt) : NaN)).filter(n => Number.isFinite(n));
        if (stamps.length === 0) return '';
        const startedAt = Math.min(...stamps);
        const endedAt = stamps.length > 1 ? Math.max(...stamps) : NaN;
        const lastTurn = actorTurns[actorTurns.length - 1];
        // Review fix (ROUND-39): per-seat liveness — a seat is still working
        // only while the debate is live AND its last turn is the newest in
        // `turns`. A settled last turn stops ticking even when other seats
        // (or the verdict) are still streaming.
        const newestTurnTs = Math.max(...turns.map(t => (t.createdAt ? Date.parse(t.createdAt) : NaN)).filter(n => Number.isFinite(n)), NaN);
        const seatIsNewest = !Number.isFinite(newestTurnTs) || !lastTurn?.createdAt
            || Math.abs((Date.parse(lastTurn.createdAt) || 0) - newestTurnTs) < 1500;
        const stillWorking = Boolean(isLive) && lastTurn !== undefined && seatIsNewest;
        // A finished seat freezes at its last turn's timestamp (+5s minimum
        // display so sub-second turns don't read as "0s").
        const endMs = stillWorking
            ? nowTick
            : (Number.isFinite(endedAt) ? endedAt + 5000 : startedAt + 5000);
        return `Worked for ${formatWorkedFor(Math.max(1000, endMs - startedAt))}`;
    }, [actorTurns, isLive, nowTick, turns]);

    // Per-thought durations: a thought lasts until the NEXT turn starts.
    // While live AND this is the newest turn overall, it ticks toward now;
    // otherwise it falls back to a nominal 5s floor (review fix: no fake
    // "still running" for seats that already finished).
    const thoughtDurations = useMemo(() => {
        const map = new Map<number, string>();
        const newestTurnTs = Math.max(...turns.map(t => (t.createdAt ? Date.parse(t.createdAt) : NaN)).filter(n => Number.isFinite(n)), NaN);
        actorTurns.forEach((turn, i) => {
            if (!turn.reasoning || !turn.createdAt) return;
            const startedAt = Date.parse(turn.createdAt);
            if (!Number.isFinite(startedAt)) return;
            const next = actorTurns[i + 1];
            const nextAt = next?.createdAt ? Date.parse(next.createdAt) : NaN;
            const isSeatNewest = i === actorTurns.length - 1
                && (!Number.isFinite(newestTurnTs)
                    || Math.abs(startedAt - newestTurnTs) < 1500);
            const endMs = Number.isFinite(nextAt)
                ? nextAt
                : ((isLive && isSeatNewest) ? nowTick : startedAt + 5000);
            map.set(i, formatWorkedFor(Math.max(1000, endMs - startedAt)));
        });
        return map;
    }, [actorTurns, isLive, nowTick, turns]);

    // The seat's full chain-of-thought trace (keys are thoughtsKey / name).
    const actorThinking = (() => {
        if (!activeActor || !reasoningProcesses) return '';
        const needle = activeActor.trim().toLowerCase();
        for (const [key, content] of Object.entries(reasoningProcesses)) {
            const k = key.toLowerCase();
            if (needle === 'moderator' ? k.includes('moderator') : k.includes(needle)) {
                return content || '';
            }
        }
        return '';
    })();

    // Follow the stream while live.
    useEffect(() => {
        if (!isLive || !bodyRef.current) return;
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [turnCount, lastTextLen, isLive, activeActor]);

    if (!open || !activeActor) return null;

    return (
        <div className="fixed inset-y-0 right-0 z-40 flex w-[min(480px,94vw)] flex-col border-l border-white/10 bg-zinc-950 shadow-2xl animate-fade-in">
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 px-3 py-2 custom-scrollbar">
                {actorIds.map(id => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onSelectActor(id)}
                        className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                            id === activeActor ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                        }`}
                    >
                        <DebateBotAvatar name={id} toneKey={id} size={18} />
                        <span className="max-w-[110px] truncate">{id}</span>
                    </button>
                ))}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close debate panel"
                    className="ml-auto shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                >
                    <CloseIcon className="h-4 w-4" />
                </button>
            </div>
            <div ref={bodyRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
                {/* Runtime header — the reference task-panel convention. */}
                {workedForLabel && (
                    <p className="pb-2 text-xs font-medium text-zinc-400">{workedForLabel}</p>
                )}
                {/* Live tool feed (zcode-style): typed rows, consecutive
                    same-kind events grouped with a count (expandable). */}
                {isLive && activeActor && liveToolEvents?.[activeActor]?.trim() && (
                    <div className="mb-3">
                        <ToolEventFeed events={{ [activeActor]: liveToolEvents[activeActor] }} />
                    </div>
                )}
                {actorThinking && (
                    <div className="mb-4">
                        <ReasoningRow
                            thinking={actorThinking}
                            label="Thinking"
                            running={isLive}
                        />
                    </div>
                )}
                {turnCount === 0 ? (
                    <p className="py-10 text-center text-xs text-zinc-600">
                        {isLive ? 'Waiting for this debater to speak…' : 'No transcript for this debater.'}
                    </p>
                ) : (
                    actorTurns.map((turn, i) => {
                        // Inter-model addressing (ROUND-34): turns carrying a
                        // parsed `to` target render as tool-style reply rows;
                        // everything else stays readable markdown.
                        const target = turn.to && turn.to.length > 0 ? turn.to[0] : undefined;
                        return (
                            <div key={`${turn.createdAt ?? 'turn'}-${i}`} className="mb-3">
                                {turn.round ? (
                                    <p className="pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                                        Round {turn.round}
                                    </p>
                                ) : null}
                                {turn.reasoning && (
                                    <div className="mb-2">
                                        <ThoughtRow
                                            thinking={turn.reasoning}
                                            durationLabel={thoughtDurations.get(i)}
                                            live={Boolean(isLive && i === turnCount - 1)}
                                        />
                                    </div>
                                )}
                                {(turn.text || '').trim() ? (
                                    target ? (
                                        <ReplyToolRow turn={turn} target={target} live={Boolean(isLive && i === turnCount - 1)} />
                                    ) : (
                                        <MarkdownContent content={turn.text || '…'} className="text-[13px] leading-6" />
                                    )
                                ) : null}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default DebateSidePanel;
