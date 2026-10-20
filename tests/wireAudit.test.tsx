/**
 * The wire audit — what the provider was actually asked.
 *
 * The transport has ALWAYS decided, per request, which capability route it
 * applied: an Anthropic thinking block, a Gemini thinking config, an OpenAI
 * effort knob — or none, with a reason. It emitted that decision on every
 * call (`onWireAudit`), and NOTHING collected it, so the transcript could not
 * answer the one question a trader asks about a missing trace:
 *
 *     did the model not think, or was it never asked to?
 *
 * Those were the same silence, and they are not the same fact. The transport
 * knows the difference; the row now carries it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { streamChatWithDeskTools } from '../services/analysis/DeskToolsService';
import { runChatSurfaceTurn } from '../services/trade/chatSurfaceTurn';
import ChatWorkTimeline from '../components/trade/panels/ChatWorkTimeline';
import WireAuditRow from '../components/shared/WireAuditRow';
import { MessageRole } from '../types/enums';
import type { Message } from '../types/message';
import type { WireAuditEntry } from '../types/provider';

vi.mock('../services/analysis/DeskToolsService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/DeskToolsService')>();
    return { ...actual, streamChatWithDeskTools: vi.fn() };
});
vi.mock('../services/trade/toolPayloadStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/trade/toolPayloadStore')>();
    return { ...actual, saveToolPayload: vi.fn(() => true) };
});

const mockStream = vi.mocked(streamChatWithDeskTools);

const audit = (over: Partial<WireAuditEntry> = {}): WireAuditEntry => ({
    route: 'none',
    effort: 'high',
    applied: false,
    reason: 'model id not recognized as thinking-capable (set the override in Settings)',
    ...over,
});

/** A stream that emits the given audit lines, then the answer. */
const script = (entries: WireAuditEntry[], text = 'holding 111k'): void => {
    mockStream.mockImplementation((async function* (_c: unknown, _m: unknown, o: unknown) {
        const owned = o as { onWireAudit?: (e: WireAuditEntry) => void };
        for (const e of entries) owned.onWireAudit?.(e);
        yield text;
    }) as never);
};

const aiRow = (): Message => ({
    id: 'ai-1', role: MessageRole.AI, text: '', createdAt: new Date().toISOString(),
});

const harness = () => {
    let row = aiRow();
    return {
        req: {
            config: { id: 'p1', name: 'P1', selectedModel: 'gpt-4o' } as never,
            history: [] as Message[],
            prompt: 'what is btc doing',
            trades: [] as never,
            signal: new AbortController().signal,
            startedAt: Date.now() - 100,
            symbol: 'BTCUSDT',
            interval: '15m',
            patch: (fn: (m: Message) => Message) => { row = fn(row); },
            paint: () => { },
        },
        get row() { return row; },
    };
};

beforeEach(() => { mockStream.mockReset(); });

describe('the turn collects what the wire decided', () => {
    it('the audit rides out on the turn\'s outcome', async () => {
        script([audit(), audit({ route: 'openai-effort', applied: true, reason: 'reasoning_effort=high' })]);
        const h = harness();
        const out = await runChatSurfaceTurn(h.req);
        expect(out.wireAudit).toHaveLength(2);
        // In call order: the answer's own call is the LAST one.
        expect(out.wireAudit?.[out.wireAudit.length - 1].route).toBe('openai-effort');
    });

    it('a turn that made no call reports no audit, rather than an empty one', async () => {
        script([]);
        const h = harness();
        const out = await runChatSurfaceTurn(h.req);
        expect(out.wireAudit).toBeUndefined();
    });
});

describe('the row says WHY a turn has no trace', () => {
    it('names the transport\'s own reason', () => {
        render(
            <WireAuditRow
                entries={[audit()]}
                noTrace
            />,
        );
        // The reason is the transport's, verbatim — not a guess about the model.
        expect(screen.getByTestId('wire-audit-row').textContent).toContain(
            'model id not recognized as thinking-capable',
        );
        expect(screen.getByTestId('wire-audit-row').textContent).toContain('No thinking trace');
    });

    it('a turn WITH a trace shows the route instead', () => {
        render(<WireAuditRow entries={[audit({ route: 'anthropic-thinking', applied: true, reason: 'thinking budget_tokens=8192' })]} noTrace={false} />);
        const row = screen.getByTestId('wire-audit-row');
        expect(row.textContent).toContain('Wire');
        expect(row.textContent).toContain('Anthropic thinking block');
        expect(row.textContent).not.toContain('No thinking trace');
    });

    it('lists every call the turn made', () => {
        render(<WireAuditRow entries={[audit(), audit({ route: 'openai-effort', applied: true })]} noTrace={false} />);
        const row = screen.getByTestId('wire-audit-row');
        expect(row.textContent).toContain('#1');
        expect(row.textContent).toContain('#2');
    });

    it('is a native disclosure, like every other expander in the app', () => {
        const { container } = render(<WireAuditRow entries={[audit()]} noTrace />);
        expect(container.querySelector('details')).toBeTruthy();
    });
});

describe('the work card carries it', () => {
    it('a settled turn with no trace and no route says so on its own line', () => {
        // The one case silence misleads: the trader is getting no thinking and
        // the transport's reason is the only thing that can tell them so.
        render(
            <ChatWorkTimeline
                entry={{
                    id: 'e1', tools: [], reasoning: '', wireAudit: [audit()],
                }}
            />,
        );
        expect(screen.getByTestId('wire-audit-row').textContent).toContain('No thinking trace');
    });

    it('a settled turn that DID work keeps the record inside the folded card', () => {
        render(
            <ChatWorkTimeline
                entry={{
                    id: 'e1', tools: ['calling order book…', 'order book · ok'],
                    reasoning: '', wireAudit: [audit()],
                }}
            />,
        );
        // The record exists, and it is inside the card that folds itself shut
        // when the answer lands.
        expect(screen.getByTestId('wire-audit-row')).toBeTruthy();
    });

    it('a turn with no wire record says nothing about the wire', () => {
        const { container } = render(
            <ChatWorkTimeline entry={{ id: 'e1', tools: [], reasoning: '' }} />,
        );
        expect(screen.queryByTestId('wire-audit-row')).toBeNull();
        expect(container.textContent).not.toContain('No thinking trace');
    });

    it('a STREAMING turn is never said to have no trace', () => {
        // The trace may still be on its way — claiming there is none would be a
        // lie the trader would act on.
        render(
            <ChatWorkTimeline
                entry={{
                    id: 'e1', tools: [], reasoning: '', streaming: true,
                    wireAudit: [audit()],
                }}
            />,
        );
        expect(screen.queryByTestId('wire-audit-row')).toBeNull();
    });
});

describe('the shape lives in the wire vocabulary', () => {
    it('the type is declared once, in types/provider.ts', () => {
        const provider = readFileSync('types/provider.ts', 'utf8');
        expect(provider).toMatch(/export interface WireAuditEntry/);
        expect(provider).toMatch(/export type WireAuditRoute/);
        // The service RE-EXPORTS it rather than declaring a second shape.
        const controls = readFileSync('services/providers/reasoningControls.ts', 'utf8');
        expect(controls).toMatch(/export type \{ WireAuditEntry, WireAuditRoute \} from '\.\.\/\.\.\/types\/provider';/);
        expect(controls).not.toMatch(/export interface WireAuditEntry/);
    });

    it('the row carries it, and both homes write it', () => {
        expect(readFileSync('types/message.ts', 'utf8')).toMatch(/wireAudit\?: WireAuditEntry\[\];/);
        expect(readFileSync('services/trade/chatTurnRunner.ts', 'utf8')).toMatch(/wireAudit: outcome\.wireAudit/);
        expect(readFileSync('hooks/useAnalysisPipeline.ts', 'utf8')).toMatch(/wireAudit: toolTurn\.wireAudit/);
    });
});
