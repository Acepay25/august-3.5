import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DebateTurn, DebateRunEvent, ReplacementOffer } from '../../types/message';
import { TradeAnalysis } from '../../types';
import MarkdownContent from '../shared/MarkdownContent';
import StreamingMarkdown from '../shared/StreamingMarkdown';
import ReasoningRow from '../shared/ReasoningRow';
import {
    X as CloseIcon,
    MoreVertical as MoreVerticalIcon,
    Copy as CopyIcon,
    Check as CheckIcon,
    Download as DownloadIcon,
    GitFork as GitForkIcon,
} from 'lucide-react';
import { ChevronDownIcon } from '../shared/Icons';
import { DebateBotAvatar } from './DebateBotAvatar';
import ReplacementOfferCard from './ReplacementOfferCard';
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText';
import {
    buildTranscriptMarkdown,
    buildTranscriptJson,
    buildTranscriptFilename,
    downloadTextFile,
} from '../../utils/transcriptExport';

// ─── Docked split view ─────────────────────────────────────────────────────
// On wide screens the transcript sits BESIDE the chat instead of covering it:
// the open panel toggles a body class that index.css turns into a right inset
// on the main column (the same dock the analysis-progress panel uses). A
// module-level count keeps multiple mounted panels from un-docking each other.
let debateDockCount = 0;
const setDebateDock = (on: boolean): void => {
    if (typeof document === 'undefined') return;
    debateDockCount = Math.max(0, debateDockCount + (on ? 1 : -1));
    document.body.classList.toggle('debate-panel-docked', debateDockCount > 0);
};

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
    /** Run log — the source of special-round labels (devil / evidence /
     *  conviction / moderator routing). */
    runLog?: DebateRunEvent[];
    /** Trade the debate belongs to — header for transcript exports. */
    analysis?: TradeAnalysis | null;
    /** Message id of the debate — required for fork. */
    messageId?: string;
    /** Fork a fresh debate replaying rounds 1..N (settled debates only). */
    onForkDebate?: (messageId: string, round: number) => void;
    /** Mid-debate replacement offer — rendered at the top of the panel so the
     *  suspended wait is visible wherever the user is watching. */
    replacementOffer?: ReplacementOffer;
    onReplacementChoice?: (providerId: string | null) => void;
}

/**
 * Right-hand transcript drawer: one tab per
 * debater, laid out like an agentic runner's task panel —
 *   · "Worked for Xm Ys" runtime counter per seat,
 *   · Thought rows COLLAPSED by default; expanding shows a truncated
 *     preview with a Show more toggle for the full reasoning,
 *   · inter-model rebuttals render as tool-style rows ("A replied to B")
 *     with every addressee as a clickable @chip — click jumps to their tab;
 *     consecutive replies to the SAME seat collapse into one thread,
 *   · plain statements (openings, verdict) stay readable markdown,
 *   · tabs carry an unread dot when a seat spoke while you watched another.
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

/**
 * Strip the speaker's own name prefix from a turn body — models often open
 * with "**Name:**" or a literal "{{NAME}}:" template remnant even though the
 * row header already says who is talking.
 */
export const cleanSpeakerPrefix = (text: string, speaker: string): string => {
    const escaped = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text
        .replace(/^\s*(?:\*{0,2})\s*\{\{\s*NAME\s*\}\}\s*:?\s*(?:\*{0,2})\s*/i, '')
        .replace(new RegExp(`^\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?:\\s*`, 'i'), '')
        .replace(/^\s*\*+\s*/, '')
        .trim();
};

/** Body shown when a row is expanded: truncated past `limit` until "more". */
const TRUNCATE_LIMIT = 320;

// ─── Sealed conviction ──────────────────────────────────────────────────────

const CONVICTION_LINE_RE = /^\s*CONVICTION:\s*(\d{1,3})\b[^\n]*$/im;

/** Extract the sealed CONVICTION value from a turn, if present. */
const convictionOf = (text: string): number | null => {
    const m = text.match(CONVICTION_LINE_RE);
    if (!m) return null;
    return Math.min(100, Math.max(0, parseInt(m[1], 10)));
};

/** The turn body without the raw CONVICTION line (it renders as a chip). */
const bodyWithoutConviction = (text: string): string =>
    text.replace(CONVICTION_LINE_RE, '').trim();

const ConvictionChip: React.FC<{ value: number }> = ({ value }) => (
    <span
        className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-zinc-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300"
        title="Sealed conviction — this seat's private 0-100 confidence in its own stance. Only the Moderator sees all convictions together."
    >
        <span className="text-[9px] uppercase tracking-widest text-zinc-500">Conviction</span>
        <span className="tabular-nums">{value}</span>
        <span className="h-1 w-10 overflow-hidden rounded-full bg-zinc-800">
            <span className="block h-full rounded-full bg-zinc-400" style={{ width: `${value}%` }} />
        </span>
    </span>
);

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

// ─── Plain-statement body with smooth live reveal ───────────────────────────

/**
 * Statement body that eases in while live — a sudden full-text dump (opening
 * statements land in one paint) is replaced by the same smooth reveal the
 * chat bubble uses. Settled history renders immediately.
 */
const StreamedTurnBody: React.FC<{ text: string; live?: boolean }> = ({ text, live = false }) => {
    const shown = useSmoothStreamText(text, live);
    if (!shown.trim()) return null;
    if (live) {
        return <StreamingMarkdown text={shown} live className="text-[13px] leading-6" />;
    }
    return <MarkdownContent content={shown} className="text-[13px] leading-6" />;
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
                {/* Lightbulb — the Thought glyph. */}
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.17c.36.6.7.6.7 1.16v.67h4v-.67c0-.56.34-.56.7-1.16A4.5 4.5 0 0 0 8 1.5Z" />
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

// ─── @chips — every addressee, clickable ────────────────────────────────────

const AddressChips: React.FC<{ targets: string[]; onJump: (name: string) => void }> = ({ targets, onJump }) => (
    <span className="inline-flex flex-wrap items-center gap-1">
            {targets.map(t => (
            <button
                key={t}
                type="button"
                aria-label={`Jump to ${t}'s transcript`}
                title={`Jump to ${t}'s transcript`}
                onClick={e => { e.stopPropagation(); onJump(t); }}
                className="rounded border border-white/10 bg-zinc-950/70 px-1 py-px text-[10px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            >
                @{t}
            </button>
        ))}
    </span>
);

// ─── Tool-style "replied to" row (inter-model rebuttals) ───────────────────

const ReplyToolRow: React.FC<{
    turn: DebateTurn;
    targets?: string[];
    live?: boolean;
    onJump: (name: string) => void;
}> = ({ turn, targets, live, onJump }) => {
    const [open, setOpen] = useState(false);
    const conviction = convictionOf(turn.text || '');
    const rawBody = conviction !== null ? bodyWithoutConviction(turn.text || '') : (turn.text || '').trim();
    const text = cleanSpeakerPrefix(rawBody, turn.speaker);
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
                {/* Reply glyph — tool-call chip style. */}
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M6.5 3.5 3 7l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 7h6a4 4 0 0 1 4 4v1.5" strokeLinecap="round" />
                </svg>
                <DebateBotAvatar name={turn.speaker} toneKey={turn.speaker} size={14} square live={live} />
                <span className="shrink-0 text-[11px] font-medium text-zinc-400">{turn.speaker}</span>
                <span className="shrink-0 text-[11px] text-zinc-600">{targets && targets.length > 0 ? 'replied to' : 'replied'}</span>
                {targets && targets.length > 0 && <AddressChips targets={targets} onJump={onJump} />}
                {!open && <span className="min-w-0 flex-1 truncate text-[11px] italic text-zinc-600">{firstLineSnippet(text)}</span>}
                <ChevronDownIcon className={`ml-auto h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="border-t border-white/5 px-2.5 py-2">
                    {conviction !== null && <span className="mb-1.5 block"><ConvictionChip value={conviction} /></span>}
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

// ─── Thread: consecutive replies to the SAME seat ──────────────────────────

const ThreadBlock: React.FC<{
    target: string;
    entries: Array<{ turn: DebateTurn; index: number }>;
    live?: boolean;
    onJump: (name: string) => void;
}> = ({ target, entries, live, onJump }) => {
    const [open, setOpen] = useState(false);
    const newest = entries[entries.length - 1]?.turn;
    if (!newest) return null;
    return (
        <div className="rounded-lg border border-white/10 bg-zinc-900/60">
            <button
                type="button"
                onClick={() => setOpen(prev => !prev)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
                title={open ? 'Collapse thread' : 'Expand thread'}
            >
                {/* Thread glyph. */}
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="M2.5 4.5h11M2.5 8h8M2.5 11.5h5" strokeLinecap="round" />
                </svg>
                <span className="shrink-0 text-[11px] font-medium text-zinc-300">Thread</span>
                <span className="shrink-0 text-[11px] text-zinc-600">with</span>
                <AddressChips targets={[target]} onJump={onJump} />
                <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">· {entries.length} turns</span>
                {!open && <span className="min-w-0 flex-1 truncate text-[11px] italic text-zinc-600">{firstLineSnippet(newest.text || '')}</span>}
                <ChevronDownIcon className={`ml-auto h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="space-y-2 border-t border-white/5 px-2.5 py-2">
                    {entries.map(({ turn, index }) => (
                        <ReplyToolRow
                            key={`${turn.createdAt ?? 'thread'}-${index}`}
                            turn={turn}
                            targets={turn.to}
                            live={Boolean(live && index === entries.length - 1)}
                            onJump={onJump}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Tool-event feed row ───────────────────────────────────────────────────

/**
 * Per-TYPE tints: each action class gets a muted
 * hue so long feeds scan by shape: violet = reasoning/thought traffic,
 * steel-blue = data lookups, zinc = everything else. Status colors (emerald/
 * rose) stay reserved for WIN/LOSS.
 */
const rowTintForLine = (line: string): { icon: string; label?: string } => {
    if (/direct message|→\s|read inbox|inbox/i.test(line)) return { icon: 'text-violet-300/80' };
    if (/^calling/i.test(line)) return { icon: 'text-violet-300/50' };
    return { icon: 'text-sky-300/70' }; // explore / lookup — muted blue
};

/** Pick the row glyph from the event line's shape (mail vs lookup vs pending). */
const ToolRowIcon: React.FC<{ line: string }> = ({ line }) => {
    const tint = rowTintForLine(line);
    const cls = `h-3 w-3 shrink-0 ${tint.icon}`;
    if (/^calling/i.test(line)) {
        // In-flight call — hourglass-style dot for running tools.
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
    // Lines arrive as "HH:MM:SS · event" (stamped at capture);
    // the stamp renders as a right-aligned tabular chip.
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
 * Consecutive same-kind tool events collapse into ONE row with a count
 * ("Lookups · 4" style), so a busy seat reads as one line instead of four
 * near-identical ones. Mixed kinds still render individually. Counted
 * groups expand on click.
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
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.03] disabled:hover:transparent"
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
    runLog,
    analysis,
    messageId,
    onForkDebate,
    replacementOffer,
    onReplacementChoice,
}) => {
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const actorTurns = useMemo(() => turns.filter(t => t.speaker === activeActor), [turns, activeActor]);
    const turnCount = actorTurns.length;
    const lastTextLen = actorTurns.length > 0 ? (actorTurns[actorTurns.length - 1].text || '').length : 0;

    // ─── Header actions menu: copy / export transcript, fork debate ────────
    const [menuOpen, setMenuOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    // Forkable rounds — the distinct round numbers present in the transcript.
    const availableRounds = useMemo(
        () => Array.from(new Set(
            turns.map(t => t.round).filter((r): r is number => typeof r === 'number'),
        )).sort((a, b) => a - b),
        [turns],
    );
    const canFork = Boolean(onForkDebate && messageId && !isLive && availableRounds.length > 0);
    const hasActions = turns.length > 0 || canFork;

    const copyTranscript = async (): Promise<void> => {
        const text = turns
            .map(t => `**${t.speaker}**${t.round !== undefined ? ` (Round ${t.round})` : ''}:\n${t.text}`)
            .join('\n\n');
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard unavailable (permissions / non-secure context).
        }
    };

    const exportTranscript = (format: 'md' | 'json'): void => {
        const content = format === 'md'
            ? buildTranscriptMarkdown(turns, analysis)
            : buildTranscriptJson(turns, analysis);
        downloadTextFile(
            buildTranscriptFilename(analysis, format),
            content,
            format === 'md' ? 'text/markdown' : 'application/json',
        );
    };

    // Per-seat turn counts + seen-markers for the unread dots: a tab shows
    // a dot while its seat spoke more than the watcher has seen.
    const turnCountByActor = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const id of actorIds) counts[id] = 0;
        for (const t of turns) {
            if (counts[t.speaker] !== undefined) counts[t.speaker] += 1;
        }
        return counts;
    }, [turns, actorIds]);
    const [seenCounts, setSeenCounts] = useState<Record<string, number>>({});
    useEffect(() => {
        if (!open || !activeActor) return;
        const current = turnCountByActor[activeActor] ?? 0;
        setSeenCounts(prev => (prev[activeActor] === current ? prev : { ...prev, [activeActor]: current }));
    }, [open, activeActor, turnCountByActor]);

    // Special-round labels from the run log (devil's advocate / evidence /
    // sealed conviction / moderator routing) — the engine emits one 'round'
    // event per marker, so the panel never guesses from round numbers alone.
    const roundLabels = useMemo(() => {
        const map = new Map<number, string[]>();
        if (!runLog) return map;
        for (const e of runLog) {
            if (e.kind !== 'round' || typeof e.round !== 'number') continue;
            const label = /^devil/i.test(e.detail) ? "Devil's advocate"
                : /^evidence/i.test(e.detail) ? 'Evidence round'
                    : /conviction/i.test(e.detail) ? 'Sealed conviction'
                        : /^moderator routed/i.test(e.detail) ? 'Moderator routing'
                            : null;
            if (!label) continue;
            const arr = map.get(e.round) ?? [];
            if (!arr.includes(label)) arr.push(label);
            map.set(e.round, arr);
        }
        return map;
    }, [runLog]);

    // Threaded exchanges: consecutive addressed turns to the SAME target
    // collapse into one collapsible thread (Grok-style "keep the main
    // transcript focused"); single replies stay plain reply rows.
    type PanelItem =
        | { kind: 'turn'; turn: DebateTurn; index: number }
        | { kind: 'thread'; target: string; entries: Array<{ turn: DebateTurn; index: number }> };
    const panelItems = useMemo(() => {
        const items: PanelItem[] = [];
        actorTurns.forEach((turn, i) => {
            const target = turn.to && turn.to.length > 0 ? turn.to[0] : undefined;
            if (target) {
                const last = items[items.length - 1];
                if (last && last.kind === 'thread' && last.target === target) {
                    last.entries.push({ turn, index: i });
                    return;
                }
                items.push({ kind: 'thread', target, entries: [{ turn, index: i }] });
            } else {
                items.push({ kind: 'turn', turn, index: i });
            }
        });
        return items;
    }, [actorTurns]);

    // Jump to an addressee's tab (clickable @chips).
    const jumpToActor = (name: string): void => {
        const match = actorIds.find(id => id.toLowerCase() === name.trim().toLowerCase());
        if (match) onSelectActor(match);
    };

    // Per-seat runtime counter ("Worked for Xm Ys"): first turn start →
    // last turn end (or NOW while the seat is still generating). A 1 Hz
    // tick keeps it counting up live.
    const [nowTick, setNowTick] = useState(() => Date.now());
    useEffect(() => {
        if (!isLive) return;
        const id = window.setInterval(() => setNowTick(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [isLive]);

    // Per-seat liveness — a seat is still working only while the debate is
    // live AND its last turn is the newest in `turns`. A settled last turn
    // stops ticking even when other seats (or the verdict) are still
    // streaming. Shared by the worked-for counter and the per-row live flags.
    const seatIsNewest = useMemo(() => {
        const lastTurn = actorTurns[actorTurns.length - 1];
        if (!lastTurn?.createdAt) return true;
        const newestTurnTs = Math.max(...turns.map(t => (t.createdAt ? Date.parse(t.createdAt) : NaN)).filter(n => Number.isFinite(n)), NaN);
        return !Number.isFinite(newestTurnTs)
            || Math.abs((Date.parse(lastTurn.createdAt) || 0) - newestTurnTs) < 1500;
    }, [actorTurns, turns]);

    const workedForLabel = useMemo(() => {
        const stamps = actorTurns.map(t => (t.createdAt ? Date.parse(t.createdAt) : NaN)).filter(n => Number.isFinite(n));
        if (stamps.length === 0) return '';
        const startedAt = Math.min(...stamps);
        const endedAt = stamps.length > 1 ? Math.max(...stamps) : NaN;
        const lastTurn = actorTurns[actorTurns.length - 1];
        const stillWorking = Boolean(isLive) && lastTurn !== undefined && seatIsNewest;
        // A finished seat freezes at its last turn's timestamp (+5s minimum
        // display so sub-second turns don't read as "0s").
        const endMs = stillWorking
            ? nowTick
            : (Number.isFinite(endedAt) ? endedAt + 5000 : startedAt + 5000);
        return `Worked for ${formatWorkedFor(Math.max(1000, endMs - startedAt))}`;
    }, [actorTurns, isLive, nowTick, seatIsNewest]);

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

    // ─── Live follow + back-to-live ────────────────────────────────────────
    // The reader starts pinned to the stream. Scrolling up breaks follow so
    // incoming turns don't yank them back; a pill below offers the jump home.
    const [following, setFollowing] = useState(true);
    useEffect(() => {
        if (open) setFollowing(true);
    }, [open, activeActor]);

    const handleBodyScroll = (): void => {
        const el = bodyRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        setFollowing(atBottom);
    };

    // Follow the stream while live — only while the reader is still pinned.
    useEffect(() => {
        if (!isLive || !following || !bodyRef.current) return;
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [turnCount, lastTextLen, isLive, activeActor, following]);

    const jumpToLive = (): void => {
        const el = bodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        setFollowing(true);
    };

    // ─── Keyboard shortcuts: Esc closes, ←/→ switch seats ─────────────────
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent): void => {
            const target = e.target as HTMLElement | null;
            // Never hijack keys while the user is typing in a field.
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                if (menuOpen) setMenuOpen(false);
                else onClose();
                return;
            }
            if (actorIds.length > 1 && activeActor) {
                const idx = actorIds.indexOf(activeActor);
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    onSelectActor(actorIds[(idx + 1) % actorIds.length]);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    onSelectActor(actorIds[(idx - 1 + actorIds.length) % actorIds.length]);
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, menuOpen, onClose, actorIds, activeActor, onSelectActor]);

    // Docked split view: reserve the panel's width beside the chat on wide
    // screens (body class → index.css inset). Cleaned up on close/unmount.
    useEffect(() => {
        if (!open) return;
        setDebateDock(true);
        return () => setDebateDock(false);
    }, [open]);

    if (!open || !activeActor) return null;

    return (
        <div className="fixed inset-y-0 right-0 z-40 flex w-[min(480px,94vw)] flex-col border-l border-white/10 bg-zinc-950 shadow-2xl animate-fade-in">
            <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-3 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto custom-scrollbar">
                    {actorIds.map(id => {
                        const unread = id !== activeActor
                            && (turnCountByActor[id] ?? 0) > (seenCounts[id] ?? 0);
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => onSelectActor(id)}
                                title={unread ? `${id} has new turns` : id}
                                className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                                    id === activeActor ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                                }`}
                            >
                                <DebateBotAvatar name={id} toneKey={id} size={18} />
                                <span className="max-w-[110px] truncate">{id}</span>
                                {unread && (
                                    <span
                                        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-zinc-200"
                                        aria-label={`${id} has unread turns`}
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
                <div className="relative flex shrink-0 items-center">
                    {hasActions && (
                        <button
                            type="button"
                            onClick={() => setMenuOpen(o => !o)}
                            aria-label="Transcript actions"
                            aria-expanded={menuOpen}
                            title="Copy / export transcript, fork debate"
                            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                        >
                            <MoreVerticalIcon className="h-4 w-4" />
                        </button>
                    )}
                    {hasActions && menuOpen && (
                        <>
                            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
                            <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-lg border border-white/10 bg-zinc-900 py-1 shadow-xl">
                                <button
                                    type="button"
                                    disabled={turns.length === 0}
                                    onClick={() => { void copyTranscript(); }}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:text-zinc-600 disabled:hover:bg-transparent"
                                >
                                    {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                                    {copied ? 'Copied' : 'Copy transcript'}
                                </button>
                                <button
                                    type="button"
                                    disabled={turns.length === 0}
                                    onClick={() => { exportTranscript('md'); setMenuOpen(false); }}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:text-zinc-600 disabled:hover:bg-transparent"
                                >
                                    <DownloadIcon className="h-3.5 w-3.5" />
                                    Export Markdown
                                </button>
                                <button
                                    type="button"
                                    disabled={turns.length === 0}
                                    onClick={() => { exportTranscript('json'); setMenuOpen(false); }}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:text-zinc-600 disabled:hover:bg-transparent"
                                >
                                    <DownloadIcon className="h-3.5 w-3.5" />
                                    Export JSON
                                </button>
                                {canFork && (
                                    <>
                                        <div className="my-1 border-t border-white/5" />
                                        <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                                            Fork debate
                                        </p>
                                        {availableRounds.map(round => (
                                            <button
                                                key={round}
                                                type="button"
                                                title={`Start a fresh debate that replays rounds 1–${round}`}
                                                onClick={() => {
                                                    if (!messageId || !onForkDebate) return;
                                                    setMenuOpen(false);
                                                    onClose();
                                                    onForkDebate(messageId, round);
                                                }}
                                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100"
                                            >
                                                <GitForkIcon className="h-3.5 w-3.5" />
                                                Fork from round {round}
                                            </button>
                                        ))}
                                    </>
                                )}
                            </div>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close debate panel"
                        className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                    >
                        <CloseIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <div ref={bodyRef} onScroll={handleBodyScroll} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
                {/* Mid-debate replacement choice — mirrored from the chat
                    bubble so the suspended wait is visible in the panel. */}
                {replacementOffer && onReplacementChoice && (
                    <div className="mb-3">
                        <ReplacementOfferCard offer={replacementOffer} onChoice={onReplacementChoice} />
                    </div>
                )}
                {/* Runtime header — task-panel convention. */}
                {workedForLabel && (
                    <p className="pb-2 text-xs font-medium text-zinc-400">{workedForLabel}</p>
                )}
                {/* Live tool feed: typed rows, consecutive
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
                    panelItems.map((item, ii) => {
                        if (item.kind === 'thread') {
                            const single = item.entries.length === 1;
                            const entry = item.entries[0];
                            if (single) {
                                const live = Boolean(isLive && entry.index === turnCount - 1 && seatIsNewest);
                                return (
                                    <div key={`thread-${ii}`} className="mb-3">
                                        {entry.turn.round ? (
                                            <p className="flex flex-wrap items-center gap-1.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                                                Round {entry.turn.round}
                                                {(roundLabels.get(entry.turn.round) ?? []).map(l => (
                                                    <span key={l} className="rounded border border-white/10 bg-zinc-900 px-1 py-px text-[9px] font-medium normal-case tracking-normal text-zinc-500">{l}</span>
                                                ))}
                                            </p>
                                        ) : null}
                                        {entry.turn.reasoning && (
                                            <div className="mb-2">
                                                <ThoughtRow
                                                    thinking={entry.turn.reasoning}
                                                    durationLabel={thoughtDurations.get(entry.index)}
                                                    live={live}
                                                />
                                            </div>
                                        )}
                                        <ReplyToolRow turn={entry.turn} targets={entry.turn.to} live={live} onJump={jumpToActor} />
                                    </div>
                                );
                            }
                            return (
                                <div key={`thread-${ii}`} className="mb-3">
                                    {item.entries[0].turn.round ? (
                                        <p className="flex flex-wrap items-center gap-1.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                                            Round {item.entries[0].turn.round}
                                            {(roundLabels.get(item.entries[0].turn.round) ?? []).map(l => (
                                                <span key={l} className="rounded border border-white/10 bg-zinc-900 px-1 py-px text-[9px] font-medium normal-case tracking-normal text-zinc-500">{l}</span>
                                            ))}
                                        </p>
                                    ) : null}
                                    <ThreadBlock
                                        target={item.target}
                                        entries={item.entries}
                                        live={isLive}
                                        onJump={jumpToActor}
                                    />
                                </div>
                            );
                        }
                        const turn = item.turn;
                        const i = item.index;
                        // Inter-model addressing: turns carrying a parsed
                        // `to` target render as tool-style reply rows;
                        // everything else stays readable markdown.
                        const targets = turn.to && turn.to.length > 0 ? turn.to : undefined;
                        const conviction = convictionOf(turn.text || '');
                        const withoutConviction = conviction !== null ? bodyWithoutConviction(turn.text || '') : (turn.text || '');
                        const plainBody = cleanSpeakerPrefix(withoutConviction, turn.speaker);
                        return (
                            <div key={`${turn.createdAt ?? 'turn'}-${i}`} className="mb-3">
                                {turn.round ? (
                                    <p className="flex flex-wrap items-center gap-1.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                                        Round {turn.round}
                                        {(roundLabels.get(turn.round) ?? []).map(l => (
                                            <span key={l} className="rounded border border-white/10 bg-zinc-900 px-1 py-px text-[9px] font-medium normal-case tracking-normal text-zinc-500">{l}</span>
                                        ))}
                                    </p>
                                ) : null}
                                {turn.reasoning && (
                                    <div className="mb-2">
                                        <ThoughtRow
                                            thinking={turn.reasoning}
                                            durationLabel={thoughtDurations.get(i)}
                                            live={Boolean(isLive && i === turnCount - 1 && seatIsNewest)}
                                        />
                                    </div>
                                )}
                                {conviction !== null && (
                                    <span className="mb-1.5 block"><ConvictionChip value={conviction} /></span>
                                )}
                                {plainBody.trim() ? (
                                    targets ? (
                                        <ReplyToolRow turn={{ ...turn, text: plainBody }} targets={targets} live={Boolean(isLive && i === turnCount - 1 && seatIsNewest)} onJump={jumpToActor} />
                                    ) : (
                                        <StreamedTurnBody text={plainBody} live={Boolean(isLive && i === turnCount - 1 && seatIsNewest)} />
                                    )
                                ) : null}
                            </div>
                        );
                    })
                )}
            </div>
            {/* Back-to-live: shown while live once the reader scrolls away. */}
            {isLive && !following && (
                <button
                    type="button"
                    onClick={jumpToLive}
                    className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/95 px-3 py-1.5 text-[11px] font-medium text-zinc-200 shadow-xl backdrop-blur transition-colors hover:bg-zinc-800"
                >
                    <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M8 3v10M4 9l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back to live
                </button>
            )}
        </div>
    );
};

export default DebateSidePanel;
