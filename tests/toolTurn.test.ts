/**
 * The turn executor in services/trade/toolTurn.ts.
 *
 * Four behaviours here each cost a bug to learn. They used to live inside the
 * dock's session machinery; they now live in ONE place, so they are pinned where
 * a future "simplification" would trip on them:
 *  - a Stop settles as interrupted BEFORE any repair, or a deliberate cancel
 *    reads as a failure for a turn the user chose to cut;
 *  - the settled answer is stripped of a text-protocol tool call;
 *  - the splitter only acts when something really peeled, so a clean answer that
 *    happens to open with "Verdict:" survives byte-for-byte;
 *  - a bounced malformed call repaints from empty instead of concatenating.
 *
 * streamChatWithDeskTools is the only mock: stripTextToolCalls and the thinking
 * splitter run for real, so this tests the composition, not a restatement of it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamChatWithDeskTools } from '../services/analysis/DeskToolsService';
import { runToolTurn, type ToolTurnEvents, type ToolTurnRequest } from '../services/trade/toolTurn';

vi.mock('../services/analysis/DeskToolsService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/DeskToolsService')>();
    return { ...actual, streamChatWithDeskTools: vi.fn() };
});

const mockStream = vi.mocked(streamChatWithDeskTools);

type Owned = {
    onReasoning?: (chunk: string) => void;
    onToolEvent?: (line: string) => void;
    onStreamReset?: () => void;
};

type Step = { text?: string; reasoning?: string; line?: string; reset?: boolean; abort?: boolean };

const script = (steps: Step[], controller?: AbortController): void => {
    mockStream.mockImplementation((async function* (_c: unknown, _m: unknown, opts: unknown) {
        const owned = opts as Owned;
        for (const s of steps) {
            if (s.reasoning !== undefined) owned.onReasoning?.(s.reasoning);
            if (s.line !== undefined) owned.onToolEvent?.(s.line);
            if (s.reset) owned.onStreamReset?.();
            if (s.abort) controller?.abort();
            if (s.text !== undefined) yield s.text;
        }
    }) as never);
};

const recorder = () => {
    const painted: string[] = [];
    const lines: string[] = [];
    const events: ToolTurnEvents = {
        setText: text => { painted.push(text); },
        addReasoning: vi.fn(),
        addToolLine: line => { lines.push(line); },
        attachPayload: vi.fn(),
        addAction: vi.fn(),
    };
    return { painted, lines, events };
};

const fixed = (): ToolTurnRequest => ({
    config: { id: 'p1', name: 'P1' } as never,
    messages: [{ role: 'user', content: 'go' }] as never,
    signal: new AbortController().signal,
    startedAt: Date.now() - 40,
    effort: 'low' as never,
    transport: { defaultSymbol: 'BTCUSDT', allowedTools: ['get_price_snapshot'] },
    events: recorder().events,
});

const base = (over: Partial<ToolTurnRequest> = {}): ToolTurnRequest => ({ ...fixed(), ...over });

beforeEach(() => mockStream.mockReset());

it('forwards the transport options and injects its own signal', async () => {
    const controller = new AbortController();
    script([{ text: 'ok' }]);
    await runToolTurn(base({ signal: controller.signal, events: recorder().events }));
    const passed = mockStream.mock.calls[0][2] as Record<string, unknown>;
    expect(passed.defaultSymbol).toBe('BTCUSDT');
    expect(passed.signal).toBe(controller.signal);
    expect(typeof passed.onReasoning).toBe('function');
    expect(typeof passed.onStreamReset).toBe('function');
});

describe('the settle paths', () => {
    it('leaves a clean answer untouched, even one opening with "Verdict:"', async () => {
        const answer = 'Verdict: Long BTCUSDT, targets at 115.';
        script([{ text: answer }]);
        const out = await runToolTurn(base({ events: recorder().events }));
        expect(out.text).toBe(answer);
        expect(out.leaked).toBe(false);
        expect(out.notice).toBeUndefined();
        expect(out.carry).toBe(answer);
    });

    it('moves a genuinely leaked chain of thought out of the answer', async () => {
        const cot = 'I checked funding and the order book first.';
        script([{ reasoning: cot }, { text: cot + '\n\nLong BTCUSDT at 100.' }]);
        const out = await runToolTurn(base({ events: recorder().events }));
        expect(out.text).toBe('Long BTCUSDT at 100.');
        expect(out.leaked).toBe(true);
        expect(out.reasoning).toContain(cot);
    });

    it('a Stop settles as interrupted, before any repair, with no failure notice', async () => {
        const controller = new AbortController();
        script([{ reasoning: 'thinking about it' }, { text: 'partial ' }, { abort: true }, { text: 'never shown' }], controller);
        const { painted, events } = recorder();
        const out = await runToolTurn(base({ signal: controller.signal, events }));
        expect(out.interrupted).toBe(true);
        expect(out.notice).toBeUndefined();
        expect(painted).toEqual(['partial ']);
    });

    it('a pure echo paints nothing and says why, while the room still carries it', async () => {
        const cot = 'Funding is negative and the tape is thin.';
        script([{ reasoning: cot }, { text: cot }]);
        const out = await runToolTurn(base({ events: recorder().events }));
        expect(out.text).toBe('');
        expect(out.notice).toContain('only its reasoning');
        expect(out.carry).toBe(cot);
    });

    it('a bounced malformed call repaints from empty instead of concatenating', async () => {
        script([{ text: 'garbage PROTOCOL_FRAGMENT' }, { reset: true }, { text: 'Answer after self-heal.' }]);
        const { painted, events } = recorder();
        const out = await runToolTurn(base({ events }));
        expect(painted[0]).toContain('garbage');
        expect(painted).toContain('');
        expect(out.text).toBe('Answer after self-heal.');
    });

    it('hides the accumulator from a seat that could still pass, then reveals it', async () => {
        script([{ text: 'MAYBE' }, { text: ' PASS' }]);
        const { painted, events } = recorder();
        await runToolTurn(base({ events, keepTextHidden: acc => !acc.includes('PASS') }));
        expect(painted).toEqual(['', 'MAYBE PASS']);
    });

    it('routes tool lines to the sink in transport order', async () => {
        script([{ line: 'calling get_price_snapshot' }, { text: 'done' }]);
        const { lines, events } = recorder();
        await runToolTurn(base({ events }));
        expect(lines).toEqual(['calling get_price_snapshot']);
    });

    // The literal is assembled so this file contains no closing tag of its own.
    const callTag = (body: string): string => '<tool_call name="x">' + body + '<' + '/tool_call>';

    it('settles on stripped text, so a text-protocol call never reaches the row', async () => {
        script([{ text: 'Answer here.' + callTag('{"entry":100}') }]);
        const out = await runToolTurn(base({ events: recorder().events }));
        expect(out.text).toBe('Answer here.');
        expect(out.text).not.toContain('tool_call');
    });

    // The defined fallback: with tools off the transport parses NOTHING, so a
    // seat emitting the protocol has asked for data it never got. Stripping the
    // markup hides that; the row has to say it.
    it('says so when a turn with tools OFF tried to call one anyway', async () => {
        script([{ text: 'I checked the tape.' + callTag('{"entry":100}') }]);
        const out = await runToolTurn(base({
            events: recorder().events,
            transport: { ...fixed().transport, enabled: false },
        }));
        expect(out.text).toBe('I checked the tape.');
        expect(out.notice).toMatch(/Desk tools are OFF/);
        expect(out.notice).toMatch(/nothing was looked up|no data came back/);
    });

    it('stays silent when tools are off and the seat simply answered', async () => {
        script([{ text: 'Levels sit at 100 and 115.' }]);
        const out = await runToolTurn(base({
            events: recorder().events,
            transport: { ...fixed().transport, enabled: false },
        }));
        expect(out.text).toBe('Levels sit at 100 and 115.');
        expect(out.notice).toBeUndefined();
    });
});
