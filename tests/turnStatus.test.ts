/**
 * turnStatus + toolKinds — the ONE grammar and the ONE map the turn's status
 * line and the tool rows below it both read.
 *
 * The promise these two modules keep: what the trader reads collapsed is
 * exactly what they get when they open it. A summary that names a tool the
 * rows do not show, or a row that shows a tool the summary does not name, is
 * a lie in one direction or the other — so the grammar lives in one place
 * (`utils/turnStatus.ts`) and the tool vocabulary in another
 * (`utils/toolKinds.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    parseToolLine,
    turnActivityLabel,
    turnKindSummary,
    turnWorkSummary,
    type ParsedToolLine,
} from '../utils/turnStatus';
import { toolKindOf } from '../utils/toolKinds';

describe('parseToolLine — the digest grammar, read once', () => {
    it('reads a call in flight', () => {
        const got: ParsedToolLine | null = parseToolLine('calling order book…');
        expect(got).toEqual({ label: 'order book', detail: '', state: 'calling' });
    });

    it('reads a result, keeping the coin and the detail out of the label', () => {
        const got = parseToolLine('order book · ETHUSDT · buy wall $1.2M @ 94.8k');
        expect(got?.label).toBe('order book');
        expect(got?.detail).toBe('ETHUSDT · buy wall $1.2M @ 94.8k');
        expect(got?.state).toBe('done');
    });

    it('reads a failure, and the detail does not carry the word "failed"', () => {
        const got = parseToolLine('order book · ETHUSDT · failed');
        expect(got?.state).toBe('failed');
        expect(got?.detail).toBe('ETHUSDT');
        // The label is still the tool, not the outcome.
        expect(got?.label).toBe('order book');
    });

    it('reads a bare label as a result with no detail', () => {
        expect(parseToolLine('indicators')).toEqual({ label: 'indicators', detail: '', state: 'done' });
    });

    it('has no answer for an empty line, and never throws on one', () => {
        expect(parseToolLine('')).toBeNull();
        expect(parseToolLine('   ')).toBeNull();
        expect(parseToolLine(undefined as unknown as string)).toBeNull();
    });

    it('peels the markdown markers a model line can carry', () => {
        // `stripTraceMarkers` is the presentation peel — model text never
        // leaks `**` into the transcript.
        expect(parseToolLine('**order book** · ok')?.label).toBe('order book');
    });
});

describe('turnActivityLabel — what the turn is doing RIGHT NOW', () => {
    it('names the LAST tool the desk ran, so the line changes as the work does', () => {
        const lines = ['calling chart view…', 'chart view · ok', 'calling order book…', 'order book · ok'];
        expect(turnActivityLabel(lines, false)).toBe('Reading the order book');
    });

    it('is an ACTIVITY, not the tool name', () => {
        expect(turnActivityLabel(['calling web search…'], false)).toBe('Searching the web');
        expect(turnActivityLabel(['calling screener…'], false)).toBe('Running the screener');
    });

    it('says "Thinking" when the model is reasoning and no tool has run yet', () => {
        expect(turnActivityLabel([], true)).toBe('Thinking');
    });

    it('has nothing to say when the turn has done nothing at all', () => {
        // The caller shows its own waiting state — a placeholder is honest
        // here; an invented phrase would not be.
        expect(turnActivityLabel([], false)).toBeNull();
    });

    it('keeps an unknown tool\'s own label rather than guessing a verb', () => {
        // A forged tool, or one added after the map was written. A wrong gerund
        // would be a lie about the model's work; the label is not.
        expect(turnActivityLabel(['calling my custom tool…'], false)).toBe('my custom tool');
    });
});

describe('turnWorkSummary — what the turn DID', () => {
    it('names the tools the rows below it show, deduped', () => {
        const got = turnWorkSummary(
            ['calling order book…', 'order book · ok', 'calling indicators…', 'indicators · ok'],
        );
        expect(got).toBe('order book, indicators');
    });

    it('caps the list and says how many were left out', () => {
        const got = turnWorkSummary(
            ['a · ok', 'b · ok', 'c · ok', 'd · ok', 'e · ok', 'f · ok'],
        );
        expect(got).toBe('a, b, c, d +2');
    });

    it('has nothing to say when the turn did nothing', () => {
        expect(turnWorkSummary([])).toBeNull();
        expect(turnWorkSummary(['', '  '])).toBeNull();
    });
});

describe('turnKindSummary — the counts, by KIND', () => {
    it('counts CALLS, not lines — the transcript holds two lines per call', () => {
        // One call = a `calling…` line and a result line. A summary that
        // counted lines would tell the trader the desk called a tool twice
        // for every call it made.
        expect(turnKindSummary(['calling order book…', 'order book · ok'])).toBe('1 read');
        expect(turnKindSummary([
            'calling order book…', 'order book · ok',
            'calling order book…', 'order book · ok',
        ])).toBe('2 reads');
    });

    it('counts each kind separately, in a fixed order', () => {
        const got = turnKindSummary([
            'calling web search…', 'web search · ok',
            'calling order book…', 'order book · ok',
            'calling indicators…', 'indicators · ok',
            'calling screener…', 'screener · ok',
        ]);
        expect(got).toBe('2 reads, 1 search, 1 calculation');
    });

    it('uses the singular for one', () => {
        expect(turnKindSummary(['calling chart draw…', 'chart draw · ok'])).toBe('1 draw');
    });

    it('has nothing to say when no tool was called', () => {
        expect(turnKindSummary([])).toBeNull();
        expect(turnKindSummary(['', '   '])).toBeNull();
    });

    it('counts a failed call too — the desk tried, and that is work', () => {
        expect(turnKindSummary(['calling order book…', 'order book · failed'])).toBe('1 read');
    });
});

describe('toolKinds — the vocabulary, keyed by the label the transcript carries', () => {
    it('maps the labels August\'s own tools produce', () => {
        expect(toolKindOf('order book').kind).toBe('read');
        expect(toolKindOf('web search').kind).toBe('search');
        expect(toolKindOf('monte carlo').kind).toBe('compute');
        expect(toolKindOf('chart draw').kind).toBe('draw');
        expect(toolKindOf('skill proposal').kind).toBe('write');
        expect(toolKindOf('present trade').kind).toBe('present');
    });

    it('is case-insensitive, because the transcript carries "BTC context"', () => {
        expect(toolKindOf('BTC context').kind).toBe('read');
        expect(toolKindOf('btc context').activity).toBe('Reading BTC context');
    });

    it('does NOT guess for a tool it does not know', () => {
        const got = toolKindOf('some forged tool');
        expect(got.kind).toBe('other');
        expect(got.activity).toBe('');
    });

    it('gives every known tool an activity phrase that reads as one', () => {
        // A phrase that is empty, or that is not a phrase, would put a
        // malformed word on the status line.
        for (const label of ['order book', 'web search', 'chart draw', 'skill proposal', 'present trade']) {
            const activity = toolKindOf(label).activity;
            expect(activity.length).toBeGreaterThan(0);
            expect(activity).toMatch(/^[A-Z]/);
        }
    });

    it('covers EVERY label the desk can put in a transcript', () => {
        // SOURCE CONTRACT, not a fixture. The desk service owns the tool
        // list; the transcript carries each tool's HUMAN label
        // (`digestToolResult` → `toolLabel`), and the map is keyed by that
        // label. A tool added to the desk without a map entry would fall
        // through to the bare label — a row that says "order book" where the
        // status line should say "Reading the order book". So the map is
        // measured against the desk's OWN list, here, every run.
        const src = readFileSync('services/analysis/DeskToolsService.ts', 'utf8');

        const names = new Set<string>();
        const nameRe = /name:\s*'([a-z0-9_]+)'/g;
        let m: RegExpExecArray | null;
        while ((m = nameRe.exec(src))) names.add(m[1]);

        const labels: Record<string, string> = {};
        const block = src.match(/const TOOL_LABELS[\s\S]*?\n};/);
        expect(block, 'the desk service must still declare TOOL_LABELS').not.toBeNull();
        const labelRe = /([a-z0-9_]+):\s*'([^']+)'/g;
        let lm: RegExpExecArray | null;
        while ((lm = labelRe.exec(block![0]))) labels[lm[1]] = lm[2];

        const emitted = [...new Set([...names].map(n => labels[n] ?? n.replace(/_/g, ' ')))]
            .map(l => l.toLowerCase())
            .sort();

        const uncovered = emitted.filter(l => toolKindOf(l).activity.length === 0);
        expect(
            uncovered,
            `these transcript labels have no activity phrase, so the status line would show a bare noun: ${uncovered.join(', ')}`,
        ).toEqual([]);
    });
});
