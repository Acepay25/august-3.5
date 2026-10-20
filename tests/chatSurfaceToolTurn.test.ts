/**
 * Stage 20b — the Chat surface runs the tool turn.
 *
 * Three claims, each with a way to be quietly false:
 *
 *  1. THE SURFACE ACTUALLY CALLS IT. A unit test of `runChatSurfaceTurn` proves
 *     nothing about the send path: the pipeline could build a perfect sink and
 *     still answer with `streamQuickResponse`. So the call site is read out of
 *     `useAnalysisPipeline.ts` and pinned beside the bot arm that must NOT move
 *     (stage 20 ruling: bots stay chat-only).
 *  2. THE ROW IT WRITES IS THE CANONICAL ONE. `Message` has no `tools`/`toolIds`,
 *     so a tool line lands in `liveToolEvents` (append order, capped), a
 *     side-effect goes through the ONE ledger helper, and the payload persists.
 *  3. THE TOOL LIST IS A LIST OF THINGS THAT EXIST. A name the registry does not
 *     have is a promise the executor breaks; a canvas tool offered to a seat with
 *     no canvas is the dead-affordance bug moved into the prompt. Both are
 *     checked against the registry's own source, with a floor on how many names
 *     the scan must find before its answer means anything.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessageRole } from '../types';
import type { Message } from '../types/message';
import { streamChatWithDeskTools } from '../services/analysis/DeskToolsService';
import { saveToolPayload } from '../services/trade/toolPayloadStore';
import {
    CHAT_SURFACE_TOOLS, chatSurfaceTurnMessages, runChatSurfaceTurn,
} from '../services/trade/chatSurfaceTurn';

vi.mock('../services/analysis/DeskToolsService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/DeskToolsService')>();
    return { ...actual, streamChatWithDeskTools: vi.fn() };
});
vi.mock('../services/trade/toolPayloadStore', () => ({ saveToolPayload: vi.fn(() => true) }));

const mockStream = vi.mocked(streamChatWithDeskTools);
const mockSave = vi.mocked(saveToolPayload);

type Owned = {
    onReasoning?: (chunk: string) => void;
    onToolEvent?: (line: string) => void;
    onToolPayload?: (payload: never) => void;
    onToolAction?: (action: never) => void;
};

type Step = { text?: string; reasoning?: string; line?: string };

const script = (steps: Step[], extra: { payload?: boolean; action?: boolean } = {}): void => {
    mockStream.mockImplementation((async function* (_c: unknown, _m: unknown, o: unknown) {
        const owned = o as Owned;
        for (const s of steps) {
            if (s.reasoning !== undefined) owned.onReasoning?.(s.reasoning);
            if (s.line !== undefined) owned.onToolEvent?.(s.line);
            if (s.line !== undefined && extra.payload) {
                owned.onToolPayload?.({
                    toolCallId: 'call-1', toolName: 'get_market_packet',
                    argsText: '{}', resultText: 'BTC 111,000', ok: true,
                } as never);
            }
            if (s.line !== undefined && extra.action) {
                owned.onToolAction?.({
                    id: 'a1', tool: 'write_memory_note', label: 'edge', verb: 'wrote',
                    ok: true, at: new Date().toISOString(), review: 'Settings → Memory', speaker: '',
                } as never);
            }
            if (s.text !== undefined) yield s.text;
        }
    }) as never);
};

const aiRow = (): Message => ({
    id: 'ai-1', role: MessageRole.AI, text: '', createdAt: new Date().toISOString(),
});

/** The turn wired to an in-memory row exactly the way the pipeline wires it to
 *  `updateMessages`: a patch that finds the row by id and replaces it. */
const harness = (initial: Message = aiRow()) => {
    let row = initial;
    const painted: Array<{ text: string; thinking: string }> = [];
    const req = {
        config: { id: 'p1', name: 'P1', selectedModel: 'gpt-4o' } as never,
        history: [] as Message[],
        prompt: 'what is btc doing',
        trades: [] as never,
        signal: new AbortController().signal,
        startedAt: Date.now() - 100,
        symbol: 'BTCUSDT',
        interval: '15m',
        patch: (fn: (m: Message) => Message) => { row = fn(row); },
        paint: (text: string, thinking: string) => { painted.push({ text, thinking }); },
    };
    return { req, painted, get row() { return row; } };
};

beforeEach(() => {
    mockStream.mockReset();
    mockSave.mockReset();
});

describe('runChatSurfaceTurn — the canonical row is written through the sink', () => {
    it('paints streamed text and reasoning through ONE coalesced writer, never into Message.tools', async () => {
        script([{ reasoning: 'thinking…', text: 'BTC is ' }, { text: 'holding 111k.' }]);
        const h = harness();
        const out = await runChatSurfaceTurn(h.req);
        expect(out.text).toBe('BTC is holding 111k.');
        // Every live paint carries BOTH accumulators: the casual writer owns
        // `thoughtProcesses`, so a sink writing reasoning on its own would
        // fight it frame by frame.
        expect(h.painted.every(p => typeof p.text === 'string' && typeof p.thinking === 'string')).toBe(true);
        expect(h.painted[h.painted.length - 1].thinking).toContain('thinking…');
        // The dock's row shape must not leak into the canonical one.
        expect((h.row as unknown as Record<string, unknown>).tools).toBeUndefined();
    });

    it('appends a tool line to liveToolEvents in dock order and caps the feed at 8', async () => {
        const steps = Array.from({ length: 11 }, (_, i) => ({ line: `get_market_packet calling… #${i}` }));
        script(steps);
        const h = harness();
        await runChatSurfaceTurn(h.req);
        const kept = (h.row.liveToolEvents?.desk ?? '').split('\n');
        expect(kept.length).toBe(8);
        // Append order, OLDEST first: `liveEntryFromMessage` feeds these into
        // the dock's `tools` array and one renderer reads both homes, so the
        // order has to be the dock's, not the debate feed's newest-first.
        expect(kept[kept.length - 1]).toContain('#10');
        expect(kept[0]).toContain('#3');
    });

    it('persists a tool payload and appends a side-effect through the ledger helper', async () => {
        script([{ line: 'write_memory_note · done' }], { payload: true, action: true });
        const h = harness();
        await runChatSurfaceTurn(h.req);
        expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'call-1' }));
        expect(h.row.toolActions?.map(a => a.tool)).toEqual(['write_memory_note']);
        expect(h.row.toolActions?.[0].speaker).toBe('desk');
    });

    it('records the TRAIL — one line per entry, uncapped', async () => {
        // The live feed is capped on purpose (a filling bubble must not become
        // a log), but the trail is the RECORD of what the desk ran, and the
        // work card draws it. A row that kept only the last 8 lines lost the
        // first ones for good.
        const steps = Array.from({ length: 11 }, (_, i) => ({ line: `get_market_packet calling… #${i}` }));
        script(steps);
        const h = harness();
        await runChatSurfaceTurn(h.req);
        const trail = h.row.toolEvents ?? [];
        expect(trail).toHaveLength(11);
        expect(trail[0]).toContain('#0');
        expect(trail[10]).toContain('#10');
    });

    it('records the payload id it already saves, so the row can open onto it', async () => {
        // The Chat surface's tool rows could never expand: the payload was
        // saved and nothing could find it again. The id belongs to the RESULT
        // line — the last one — and the trail's positions are the join.
        script([{ line: 'write_memory_note · done' }], { payload: true });
        const h = harness();
        await runChatSurfaceTurn(h.req);
        expect(h.row.toolIds?.[h.row.toolIds!.length - 1]).toBe('call-1');
        // One id per trail line, so the two arrays stay the same length.
        expect(h.row.toolIds?.length).toBe(h.row.toolEvents?.length);
    });

    it('carries the surface\'s own context to the transport: coin, timeframe, journal, tier, budget', async () => {
        script([{ text: 'ok' }]);
        const h = harness();
        await runChatSurfaceTurn({ ...h.req, effort: 'high' as never });
        const opts = mockStream.mock.calls[0]?.[2] as Record<string, unknown>;
        expect(opts.defaultSymbol).toBe('BTCUSDT');
        expect(opts.chartInterval).toBe('15m');
        expect(opts.reasoningEffort).toBe('high');
        expect(opts.trades).toEqual([]);
        expect(opts.allowedTools).toBe(CHAT_SURFACE_TOOLS);
        expect(opts.maxTokens as number).toBeGreaterThan(0);
        // No canvas is attached to this surface, so the transport must not claim
        // one: a frozen "live mark" borrowed from another surface is the
        // misreport the stamp exists to prevent.
        expect(opts.liveMarkPrice).toBeUndefined();
        expect(opts.chartDrawings).toBeUndefined();
        expect(opts.mailbox).toBeUndefined();
        // The one chart-action tool this seat may call is `present_trade`, and
        // the dispatch below refuses everything else — so `streamChatWithDeskTools`
        // offers only what the sink can actually honour.
        expect(typeof opts.executePanelTool).toBe('function');
    });

    it('settles a stopped turn as interrupted without inventing a failure', async () => {
        const controller = new AbortController();
        mockStream.mockImplementation((async function* (_c: unknown, _m: unknown, o: unknown) {
            (o as Owned).onToolEvent?.('get_market_packet calling…');
            yield 'BTC is ';
            controller.abort();
            yield ' never finished';
        }) as never);
        const h = harness();
        const out = await runChatSurfaceTurn({ ...h.req, signal: controller.signal });
        expect(out.interrupted).toBe(true);
        // What streamed survives, the post-abort delta does not: a Stop cuts
        // the answer, it does not erase it.
        expect(out.text).toContain('BTC is');
        expect(out.text).not.toContain('never finished');
        expect(out.workedMs).toBeGreaterThanOrEqual(0);
    });
});

describe('chatSurfaceTurnMessages — the prompt the desk sees', () => {
    const msg = (role: MessageRole, text: string): Message => ({ id: `${role}-1`, role, text, createdAt: '' });

    it('puts the system prompt first and maps history onto the wire roles', () => {
        const out = chatSurfaceTurnMessages([msg(MessageRole.USER, 'a'), msg(MessageRole.AI, 'b')], 'c', undefined, 'gpt-4o');
        expect(out[0].role).toBe('system');
        expect(typeof out[0].content).toBe('string');
        expect(out[1]).toEqual({ role: 'user', content: 'a' });
        expect(out[2]).toEqual({ role: 'assistant', content: 'b' });
        expect(out[3]).toEqual({ role: 'user', content: 'c' });
    });

    it('does not send the question twice when the history already ends with it', () => {
        // The pipeline appends the trader's row BEFORE the run, so `history`
        // already carries it — pushing it again asks the same thing twice.
        const out = chatSurfaceTurnMessages([msg(MessageRole.USER, 'c')], 'c', undefined, 'gpt-4o');
        expect(out.filter(m => m.content === 'c').length).toBe(1);
    });

    it('attaches this turn’s screenshot when the history already ends with the prompt', () => {
        // The ordinary shape: the pipeline appended the user row (with its
        // image) before the run, and the trailing-prompt guard skips the push.
        // The attachment must ride on that existing row, or the model answers a
        // screenshot it never received.
        const hist = [msg(MessageRole.USER, 'look at this')];
        hist[0].images = ['data:image/png;base64,AAA'];
        const out = chatSurfaceTurnMessages(hist, 'look at this', 'data:image/png;base64,AAA', 'gpt-4o');
        expect(out.filter(m => m.role === 'user').length).toBe(1);
        const parts = out[out.length - 1].content as Array<{ type: string }>;
        expect(Array.isArray(parts)).toBe(true);
        expect(parts.map(p => p.type)).toEqual(['text', 'image_url']);
        // Older rows keep travelling as text: the cost decision is unchanged.
        const older = chatSurfaceTurnMessages(
            [msg(MessageRole.USER, 'earlier'), hist[0]],
            'look at this', 'data:image/png;base64,AAA', 'gpt-4o',
        );
        expect(older[1].content).toBe('earlier');
    });

    it('sends an attached screenshot as a real image part, and tells a text-only seat it is there', () => {
        // Index 0 is the system message on this surface; the attached line is
        // the LAST one — that is the turn the user just sent.
        const withVision = chatSurfaceTurnMessages([], 'look at this', 'data:image/png;base64,AAA', 'gpt-4o');
        const parts = withVision[withVision.length - 1].content as Array<{ type: string }>;
        expect(Array.isArray(parts)).toBe(true);
        expect(parts.map(p => p.type)).toEqual(['text', 'image_url']);

        const textOnly = chatSurfaceTurnMessages([], 'look at this', 'data:image/png;base64,AAA', 'some-text-model');
        const last = textOnly[textOnly.length - 1].content;
        expect(typeof last).toBe('string');
        expect(last as string).toContain('cannot see images');
    });

    it('honours a persona override instead of the casual prompt', () => {
        const out = chatSurfaceTurnMessages([], 'q', undefined, 'gpt-4o', 'You are the desk coach.');
        expect(out[0].content).toBe('You are the desk coach.');
    });
});

describe('the tool list a Chat-surface seat is offered', () => {
    const deskSrc = readFileSync(resolve(process.cwd(), 'services/analysis/DeskToolsService.ts'), 'utf8');
    const registryNames = new Set(
        [...deskSrc.matchAll(/^\s+name: '([a-z_]+)',/gm)].map(m => m[1]),
    );

    /** FLOOR on the scan: if the regex stops matching the registry's shape, an
     *  empty `registryNames` would make every "exists" assertion below pass
     *  vacuously. */
    it('the source scan really reaches the desk registry', () => {
        expect(registryNames.size).toBeGreaterThanOrEqual(30);
        expect(registryNames.has('get_market_packet')).toBe(true);
    });

    it('every listed tool exists in the desk registry', () => {
        expect(CHAT_SURFACE_TOOLS.filter(name => !registryNames.has(name))).toEqual([]);
    });

    it('offers no canvas-bound tool except the plan the trader can log', () => {
        // Drawing needs a canvas, arming needs a chart, and a watch is a promise
        // this surface cannot keep. `present_trade` is the exception the stage-20
        // plan calls for: the verdict IS a tool call, and a card the trader can
        // log needs no chart — only an honest receipt, which `runPresentTrade`
        // gives this sink ("NO level-watch is armed and nothing was drawn").
        const chartBound = [
            'draw_on_chart', 'draw_detected', 'mark_trade_levels', 'clear_chart_drawings',
            'watch_price', 'wake_me', 'cancel_watch', 'get_chart_view', 'scan_chart_skills',
        ];
        expect(CHAT_SURFACE_TOOLS.filter(n => chartBound.includes(n))).toEqual([]);
        expect(CHAT_SURFACE_TOOLS).toContain('present_trade');
        // …and the market half of the dock's set really is offered, or this list
        // could pass by being empty.
        expect(CHAT_SURFACE_TOOLS.filter(n => n.startsWith('get_')).length).toBeGreaterThanOrEqual(6);
    });

    it('a sink call for a canvas tool falls through instead of faking a result', async () => {
        script([{ text: 'ok' }]);
        const h = harness();
        await runChatSurfaceTurn(h.req);
        const opts = mockStream.mock.calls[0]?.[2] as {
            executePanelTool: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<null | { ok: boolean; content: string }>;
        };
        expect(await opts.executePanelTool({ id: 'c0', name: 'draw_on_chart', arguments: { kind: 'hline', prices: [1] } })).toBeNull();
        // And `present_trade` lands a real card on the canonical row, with the
        // no-chart honesty in the receipt rather than a watch promise.
        const res = await opts.executePanelTool({
            id: 'c1', name: 'present_trade',
            arguments: { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] },
        });
        expect(res?.ok).toBe(true);
        expect(res?.content).toContain('NO level-watch is armed');
        expect(res?.content).not.toContain('The harness now watches');
        expect(h.row.proposal?.symbol).toBe('BTCUSDT');
        expect(h.row.proposal?.planId).toBeTruthy();
    });
});

describe('the Chat surface\'s desk send calls the tool turn (and a bot send does not)', () => {
    const src = readFileSync(resolve(process.cwd(), 'hooks/useAnalysisPipeline.ts'), 'utf8');
    const casual = src.slice(src.indexOf('// Casual chat: use the user-selected model'));

    it('the non-bot arm awaits runChatSurfaceTurn', () => {
        expect(src).toMatch(/import \{ runChatSurfaceTurn \} from '\.\.\/services\/trade\/chatSurfaceTurn';/);
        expect(casual).toMatch(/toolTurn = await runChatSurfaceTurn\(\{/);
    });

    it('the bot arm still answers over the plain transport (bots stay chat-only)', () => {
        const botArm = casual.slice(casual.indexOf('if (useBotThread && activeBot) {'));
        const untilElse = botArm.slice(0, botArm.indexOf('} else {'));
        expect(untilElse).toMatch(/responseText = await streamQuickResponse\(/);
        expect(untilElse).not.toMatch(/runChatSurfaceTurn/);
    });

    it('a stopped turn keeps its half-written answer instead of a clean-cut one', () => {
        expect(casual).toMatch(/text: toolTurn\?\.interrupted \? \(m\.text \|\| casualClean\) : casualClean/);
    });
});
