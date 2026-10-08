import React, { useMemo, useState } from 'react';
import { Wrench } from './Icons';
import { stripTraceMarkers } from '../../utils/traceText';
import { readToolPayload } from '../../services/trade/toolPayloadStore';
import { readToolArtifact } from '../../services/analysis/toolArtifactStore';
import { findArtifactIdIn } from '../../utils/harnessMarks';

export interface ToolActivityRowProps {
    /** Human-readable tool-event lines ("calling order book…", "order book · buy wall …"). */
    lines: string[];
    /** The answer this row belongs to is still streaming. */
    running?: boolean;
    className?: string;
    /** One payload id per entry in `lines`, same order. A row whose id resolves
     *  becomes a `<details>` that opens onto the REAL output the tool returned —
     *  always available, never gated behind a density toggle. '' / missing means
     *  the line has no payload and stays a plain row. */
    payloadIds?: string[];
}

export type ToolRowState = 'calling' | 'done' | 'failed';

export interface PairedToolRow {
    label: string;
    detail: string;
    state: ToolRowState;
}

/** A row AFTER the consecutive-fold: one or more same-label calls rendered as a
 *  single line. `count` is 1 for an unfolded row.
 *
 *  Folding is CONSECUTIVE-ONLY, which is the whole safety property: the fold
 *  never reorders what the seat actually did, it only collapses a run of the
 *  same tool that happened back to back. A `chart draw`, then an `order book`,
 *  then another `chart draw` stays three rows — because the order of the work is
 *  the information. */
export interface ToolRowGroup {
    label: string;
    /** How many same-label calls this line stands for. */
    count: number;
    /** Each member's detail, in call order. */
    details: string[];
    /** Each member's state, in call order. */
    states: ToolRowState[];
    /** Each member's payload id, in call order. '' means that call kept none. */
    payloadIds: string[];
}

/** Pairing, index-aware. Same FIFO label matching as {@link pairToolLines}, but
 *  each row remembers which entries of the ORIGINAL line list produced it — the
 *  `calling…` line and/or its result line.
 *
 *  That bookkeeping is load-bearing, not decoration: a payload id is stamped on
 *  the RESULT line, while `pairToolLines` merges that result into the row the
 *  calling line opened. Without the source indices the id cannot be found again
 *  — a positional lookup lands on the calling line, which never has one, and the
 *  expander silently never appears. */
const pairToolRows = (
    lines: string[],
): Array<PairedToolRow & { sources: number[] }> => {
    const rows: Array<PairedToolRow & { sources: number[] }> = [];
    const open = new Map<string, Array<PairedToolRow & { sources: number[] }>>();
    lines.forEach((raw, index) => {
        const line = stripTraceMarkers(raw ?? '').trim();
        if (!line) return;
        const calling = line.match(/^calling\s+(.+?)(…|$)/i);
        if (calling) {
            const row = { label: calling[1].trim(), detail: '', state: 'calling' as ToolRowState, sources: [index] };
            const queue = open.get(row.label) ?? [];
            queue.push(row);
            open.set(row.label, queue);
            rows.push(row);
            return;
        }
        const sep = line.indexOf(' · ');
        const label = (sep > 0 ? line.slice(0, sep) : line).trim();
        const rest = sep > 0 ? line.slice(sep + 3).trim() : '';
        const failed = /(^| · )failed$/i.test(rest);
        const queue = open.get(label);
        if (queue && queue.length > 0) {
            const row = queue.shift()!;
            row.state = failed ? 'failed' : 'done';
            row.detail = failed ? rest.replace(/ ·? failed$/i, '') : rest;
            row.sources.push(index);
        } else {
            rows.push({ label, detail: failed ? rest.replace(/ ·? failed$/i, '') : rest, state: failed ? 'failed' : 'done', sources: [index] });
        }
    });
    return rows;
};

/** What one expandable row shows when opened, resolved once per row.
 *
 *  Two sources, in honest order: the persisted payload store (the call's real
 *  output, kept after a reload), and for a result clipped THIS turn the live
 *  artifact store may still hold the bytes paged under a `ta-…` id. Only when
 *  neither has them does the row say so — it never opens onto an empty box that
 *  looks like output, because a blank panel claiming to be a result is the
 *  decorative-empty-state defect the `imageOmitted` row already avoids. */
interface PayloadBody {
    /** The text to render, or null when nothing was kept. */
    text: string | null;
    /** Why nothing was kept, when it wasn't. */
    refused: string | null;
}

const resolvePayload = (toolCallId: string): PayloadBody => {
    const persisted = readToolPayload(toolCallId);
    if (persisted && persisted.text) return { text: persisted.text, refused: null };
    const artifactId = persisted?.artifact;
    if (artifactId) {
        const page = readToolArtifact(artifactId, 0, 8000);
        // A miss is a `DATA_UNAVAILABLE` string, not an empty result — only an
        // `ok` page with content counts as bytes actually recovered.
        if (page.ok && page.content) return { text: page.content, refused: null };
    }
    const kept = persisted?.kept;
    const total = persisted?.total;
    if (typeof kept === 'number' && typeof total === 'number' && total > kept) {
        return { text: null, refused: `full result not kept · ${(total - kept).toLocaleString()} chars` };
    }
    return { text: null, refused: 'full result not kept' };
};

/** One folded line: `order book ×4`, expanding to each member's real output.
 *
 *  A group with one member is the ordinary case and renders exactly as the
 *  single-row path did. When it folds, the count is the disclosure: the row says
 *  how many calls it stands for, and opening it lists every member's payload
 *  rather than picking one. */
const ToolRowGroupView: React.FC<{ group: ToolRowGroup; running: boolean }> = ({ group, running }) => {
    const [open, setOpen] = useState(false);
    const expandable = group.payloadIds.some(id => !!id);
    const anyCalling = group.states.some(s => s === 'calling') && running;
    const anyFailed = group.states.some(s => s === 'failed');
    // The folded line shows the LAST member's detail — the most recent outcome —
    // with the count beside it naming how many calls the line stands for.
    const detail = group.details[group.details.length - 1] ?? '';

    const line = (
        <div className="flex items-center gap-1.5 text-ui-xs leading-4 text-zinc-500">
            <Wrench className={`h-3 w-3 shrink-0 ${anyFailed ? 'text-rose-400/70' : 'text-zinc-600'}`} aria-hidden="true" />
            <span className={`shrink-0 ${anyCalling ? 'text-zinc-500' : anyFailed ? 'text-rose-300' : 'text-zinc-400'}`}>
                {group.label}
            </span>
            {group.count > 1 && (
                <span className="shrink-0 tabular-nums text-zinc-500">×{group.count}</span>
            )}
            {anyCalling ? (
                <span className="min-w-0 truncate">· calling…</span>
            ) : detail ? (
                <span className="min-w-0 truncate">· {detail}</span>
            ) : anyFailed ? (
                <span className="min-w-0 truncate text-rose-300/80">· failed</span>
            ) : null}
        </div>
    );

    if (!expandable) return line;

    return (
        <details
            className="tool-row"
            data-testid="tool-row"
            data-fold-count={group.count}
            open={open}
            onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary className="tool-row-summary" aria-label={`${group.label}${group.count > 1 ? ` ×${group.count}` : ''} — ${open ? 'collapse' : 'expand'}`}>
                {line}
            </summary>
            <div className="tool-row-body" role="region" aria-label={`${group.label} output`}>
                {group.payloadIds.map((id, i) => (
                    <PayloadForKey key={`${id}-${i}`} toolCallId={id} />
                ))}
            </div>
        </details>
    );
};

/** One member of a folded group, resolved only while open. A member with no id
 *  contributes nothing rather than an empty box. */
const PayloadForKey: React.FC<{ toolCallId: string }> = ({ toolCallId }) => {
    const body = useMemo(() => (toolCallId ? resolvePayload(toolCallId) : null), [toolCallId]);
    if (!body) return null;
    return body.text ? (
        <pre className="tool-row-output">{body.text}</pre>
    ) : (
        <p className="tool-row-refused">{body.refused ?? 'full result not kept'}</p>
    );
};

/**
 * One row per CALL, not per event: a `calling X…` line OPENS a row and the
 * matching result line (`X · detail` / `X · failed`) UPDATES it in place — the
 * transcript never shows the call and the outcome as two separate
 * lines. Matching is by human label in FIFO order (parallel calls of the
 * same tool pair up in issue order). Old persisted grammars degrade
 * gracefully: an unmatched result renders standalone, an unmatched
 * `calling` stays a calling row.
 */
export const pairToolLines = (lines: string[]): PairedToolRow[] =>
    pairToolRows(lines).map(({ sources: _sources, ...row }) => row);

/** Fold CONSECUTIVE same-label rows into one line — `order book ×4`.
 *
 *  Consecutive-only is the safety property: a fold never reorders what the seat
 *  actually did. `chart draw`, `order book`, `chart draw` stays three rows,
 *  because the order of the work is the information; four `order book` calls in
 *  a row collapse to one line that expands back to four.
 *
 *  `payloadIds` is indexed by position in the ORIGINAL line list. Each paired row
 *  consumed one or two source lines (its `calling…` line and its result), and the
 *  id lives on the RESULT line — so a group holds exactly ONE id per member,
 *  keeping `payloadIds[i]` answerable for `details[i]`. */
export const foldConsecutiveToolRows = (lines: string[], payloadIds: string[] = []): ToolRowGroup[] => {
    const rows = pairToolRows(lines);
    const groups: ToolRowGroup[] = [];
    for (const row of rows) {
        // A row's own payload id: the id stamped on the line that CARRIED the
        // bytes. Looking it up positionally across the whole line list lands on
        // the calling line, which never has one.
        const id = row.sources.map(s => payloadIds[s] ?? '').find(v => !!v) ?? '';
        const prev = groups[groups.length - 1];
        if (prev && prev.label === row.label) {
            prev.count += 1;
            prev.details.push(row.detail);
            prev.states.push(row.state);
            prev.payloadIds.push(id);
            continue;
        }
        groups.push({
            label: row.label,
            count: 1,
            details: [row.detail],
            states: [row.state],
            payloadIds: [id],
        });
    }
    return groups;
};

/** Old runs joined parallel calls into one line ("calling a… · calling b…");
 *  split those into one row per call. Joined DIGEST lines carry real detail
 *  in the middle, so only split when EVERY segment is a call. */
const expandLine = (raw: string): string[] => {
    const line = stripTraceMarkers(raw ?? '').trim();
    if (!line) return [];
    const segments = line.split(' · ').map(s => s.trim());
    if (segments.length > 1 && segments.every(s => /^calling /i.test(s))) return segments;
    return [line];
};

/**
 * ZCode-style tool transcript: every desk-tool call renders as ONE compact
 * row whose state UPDATES in place — `⚒ chart view · calling…` flips to
 * `⚒ chart view · ok` (or `⚒ order book · ETHUSDT · buy wall …`) without
 * ever appending a second line. Markdown markers are stripped — model text
 * never leaks `**` into the transcript.
 */
const ToolActivityRow: React.FC<ToolActivityRowProps> = ({ lines, running = false, className = '', payloadIds }) => {
    const expanded = lines.flatMap(expandLine);
    const groups = foldConsecutiveToolRows(expanded, payloadIds ?? []);
    if (groups.length === 0) return null;
    return (
        <div
            className={`space-y-0.5 ${className}`.trim()}
            data-testid="tool-activity"
            data-state={running ? 'running' : 'ok'}
        >
            {groups.map((group, i) => (
                <ToolRowGroupView key={`${group.label}-${i}`} group={group} running={running} />
            ))}
        </div>
    );
};

export default React.memo(ToolActivityRow);
