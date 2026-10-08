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

/** One row: a hairline line that expands into the real output when a payload
 *  resolves. The body reuses the reasoning row's type ramp and adds the bordered
 *  monospace box the reference draws. */
const ToolRow: React.FC<{ row: PairedToolRow; payloadId: string }> = ({ row, payloadId }) => {
    const [open, setOpen] = useState(false);
    const body = useMemo(() => (open && payloadId ? resolvePayload(payloadId) : null), [open, payloadId]);

    const line = (
        <div className="flex items-center gap-1.5 text-ui-xs leading-4 text-zinc-500">
            <Wrench className={`h-3 w-3 shrink-0 ${row.state === 'failed' ? 'text-rose-400/70' : 'text-zinc-600'}`} aria-hidden="true" />
            <span className={`shrink-0 ${row.state === 'calling' ? 'text-zinc-500' : row.state === 'failed' ? 'text-rose-300' : 'text-zinc-400'}`}>
                {row.label}
            </span>
            {row.state === 'calling' ? (
                <span className="min-w-0 truncate">· calling…</span>
            ) : row.detail ? (
                <span className="min-w-0 truncate">· {row.detail}</span>
            ) : row.state === 'failed' ? (
                <span className="min-w-0 truncate text-rose-300/80">· failed</span>
            ) : null}
        </div>
    );

    if (!payloadId) return line;

    return (
        <details
            className="tool-row"
            data-testid="tool-row"
            open={open}
            onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary className="tool-row-summary" aria-label={`${row.label} — ${open ? 'collapse' : 'expand'}`}>
                {line}
            </summary>
            <div className="tool-row-body" role="region" aria-label={`${row.label} output`}>
                {body?.text ? (
                    <pre className="tool-row-output">{body.text}</pre>
                ) : (
                    <p className="tool-row-refused">{body?.refused ?? 'full result not kept'}</p>
                )}
            </div>
        </details>
    );
};

/**
 * One row per CALL, not per event: a `calling X…` line OPENS a row and the
 * matching result line (`X · detail` / `X · failed`) UPDATES it in place —
 * the transcript never shows the call and the outcome as two separate
 * lines. Matching is by human label in FIFO order (parallel calls of the
 * same tool pair up in issue order). Old persisted grammars degrade
 * gracefully: an unmatched result renders standalone, an unmatched
 * `calling` stays a calling row.
 */
export const pairToolLines = (lines: string[]): PairedToolRow[] => {
    const rows: PairedToolRow[] = [];
    const open = new Map<string, PairedToolRow[]>();
    for (const raw of lines) {
        const line = stripTraceMarkers(raw ?? '').trim();
        if (!line) continue;
        const calling = line.match(/^calling\s+(.+?)(…|$)/i);
        if (calling) {
            const row: PairedToolRow = { label: calling[1].trim(), detail: '', state: 'calling' };
            const queue = open.get(row.label) ?? [];
            queue.push(row);
            open.set(row.label, queue);
            rows.push(row);
            continue;
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
        } else {
            rows.push({ label, detail: failed ? rest.replace(/ ·? failed$/i, '') : rest, state: failed ? 'failed' : 'done' });
        }
    }
    return rows;
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
    const rows = pairToolLines(lines.flatMap(expandLine));
    if (rows.length === 0) return null;
    return (
        <div
            className={`space-y-0.5 ${className}`.trim()}
            data-testid="tool-activity"
            data-state={running ? 'running' : 'ok'}
        >
            {rows.map((row, i) => (
                <ToolRow key={i} row={row} payloadId={payloadIds?.[i] ?? ''} />
            ))}
        </div>
    );
};

export default React.memo(ToolActivityRow);
