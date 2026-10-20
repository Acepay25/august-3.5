/**
 * turnStatus — the ONE answer to "what is this turn doing right now?".
 *
 * WHY A MODULE AND NOT A LABEL IN A COMPONENT. Two surfaces render a turn's
 * work — the Chart AI dock and the Chat surface — and they used to derive the
 * words separately: `ChatWorkTimeline` had its own regex to name the work
 * after the fact, and `ToolActivityRow` had another to pair a call with its
 * result. Two parsers of one grammar is how the summary and the rows stop
 * agreeing, and the summary is the promise the rows have to keep: what the
 * trader reads collapsed is exactly what they get when they open it.
 *
 * So the GRAMMAR lives here, once. `parseToolLine` reads one digest line;
 * `ToolActivityRow` pairs the lines with it, and `turnActivityLabel` and
 * `turnWorkSummary` name the turn with it. One parser, three consumers, and a
 * summary that cannot drift from the rows beneath it.
 *
 * The grammar the desk loop writes (`services/analysis/DeskToolsService.ts`,
 * `digestToolResult`):
 *
 *   `calling order book…`          — a call is in flight
 *   `order book · ETHUSDT · buy wall $1.2M @ 94.8k` — the result
 *   `order book · failed`          — the result, failed
 *
 * The label is the tool's HUMAN label, not its name — the transcript never
 * carries a name. `utils/toolKinds.ts` maps that label to a kind and an
 * activity phrase.
 */

import { stripTraceMarkers } from './traceText';
import { toolKindOf } from './toolKinds';

/** A tool row's state. Derived from the line's TEXT, never stored separately —
 *  the digest line is the only record of what happened. */
export type ToolRowState = 'calling' | 'done' | 'failed';

/** One digest line, read. */
export interface ParsedToolLine {
    /** The tool's human label ("order book"). */
    label: string;
    /** Everything after the label ("ETHUSDT · buy wall $1.2M @ 94.8k"). */
    detail: string;
    state: ToolRowState;
}

/**
 * Read one digest line. `null` for a line with nothing in it.
 *
 * The result line's label is the part before the FIRST ` · `, so
 * "order book · ETHUSDT · buy wall…" is the tool "order book" with the rest
 * as detail — the coin is part of the outcome, not part of the name.
 */
export const parseToolLine = (raw: string): ParsedToolLine | null => {
    const line = stripTraceMarkers(raw ?? '').trim();
    if (!line) return null;
    const calling = /^calling\s+(.+?)(…|$)/i.exec(line);
    if (calling) {
        const label = calling[1].trim();
        return label ? { label, detail: '', state: 'calling' } : null;
    }
    const sep = line.indexOf(' · ');
    const label = (sep > 0 ? line.slice(0, sep) : line).trim();
    if (!label) return null;
    const rest = sep > 0 ? line.slice(sep + 3).trim() : '';
    const failed = /(^| · )failed$/i.test(rest);
    return {
        label,
        detail: failed ? rest.replace(/ ·? failed$/i, '') : rest,
        state: failed ? 'failed' : 'done',
    };
};

/**
 * What the turn is doing RIGHT NOW — the status line's word.
 *
 * It is the LAST tool's activity, so the line changes as the work changes
 * ("Reading the chart" → "Reading the order book" → "Running the screener"),
 * which is the reference's behaviour. It is derived, never asked of the model:
 * the desk's own digest lines are the evidence, so this can only ever report
 * what the tools say.
 *
 * `null` when the turn has done nothing yet — the caller then shows its own
 * waiting state rather than an invented phrase.
 */
export const turnActivityLabel = (lines: string[], hasReasoning: boolean): string | null => {
    let last: ParsedToolLine | null = null;
    for (const raw of lines ?? []) {
        const parsed = parseToolLine(raw);
        if (parsed) last = parsed;
    }
    if (last) {
        // An unknown tool keeps its own label: a wrong gerund would be a lie
        // about the model's work, and the label is not.
        return toolKindOf(last.label).activity || last.label;
    }
    // No tool yet, but the model is reasoning — that IS an activity, and it
    // is the truth rather than a placeholder.
    return hasReasoning ? 'Thinking' : null;
};

/**
 * What the turn DID, named from the transcript it already produced — no model
 * call, no new store.
 *
 * The rows below show these labels, so the summary names the same strings:
 * what the trader reads collapsed is exactly what they get when they open it.
 * Duplicates are folded (four order-book calls are one mention), reasoning is
 * named once, and the list is capped so a tool-heavy turn does not become a
 * paragraph — and "+N" names how many were left out, not how many the loop
 * happened to reach.
 */
export const turnWorkSummary = (tools: string[], hasReasoning: boolean): string | null => {
    const parts: string[] = [];
    if (hasReasoning) parts.push('Read the chart');
    const seen = new Set<string>();
    for (const raw of tools ?? []) {
        const parsed = parseToolLine(raw);
        if (!parsed) continue;
        const head = parsed.label;
        if (!head) continue;
        const key = head.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(head);
    }
    if (parts.length === 0) return null;
    const shown = parts.slice(0, 4);
    const more = parts.length - shown.length;
    const label = shown.join(', ');
    return more > 0 ? `${label} +${more}` : label;
};
