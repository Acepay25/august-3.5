/**
 * TradeChatPanel — the harness level-watch turn. A queued [HARNESS SIGNAL]
 * runs as a model warning (notice row + streamed answer, never a user
 * bubble), a signal that lands while the session is busy stays queued in the
 * STORE and flushes on idle (not a component ref), and present_trade arms
 * the watch through onPlanPresented with a dock-generated plan id. Also
 * covers B2 (panel passes are invisible) and B5 (skills index refreshes when
 * a growth action lands).
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ProviderConfig } from '../types/provider';

const { streamMock, listSkillsMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
    listSkillsMock: vi.fn() as Mock<() => any[]>,
}));

vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: (...args: unknown[]) => streamMock(...args),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: (...args: unknown[]) => (listSkillsMock as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import TradeChatPanel, { __clearPacketCacheForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';
import * as levelWatch from '../services/trade/levelWatchService';
import * as watchService from '../services/trade/watchService';
import { parsePriceWatch } from '../services/trade/chartTriggers';
import { rememberProfileMemory, __clearProfileMemoriesForTests } from '../services/learning/profileMemory';
import type { WatchPlan } from '../services/trade/tradePlanLevels';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a', 'model-b'], selectedModel: 'model-a',
};

/** One scripted streaming turn: yield the text, then optional tool hooks. */
const script = (impl: (...args: any[]) => AsyncGenerator<string>) => {
    streamMock.mockReset();
    streamMock.mockImplementation(impl);
};

const yieldText = (text: string) => async function* (): AsyncGenerator<string> { yield text; };

const SIGNAL = '[HARNESS SIGNAL — price event, not the user] Plan btc-1: TP1 @ 110 HIT (mark 110.5, 14:31 UTC). Level id btc-1:TP1.';

beforeEach(() => {
    chatStore.__resetForTests();
    levelWatch.__resetForTests();
    watchService.__resetForTests();
    __clearPacketCacheForTests();
    __clearProfileMemoriesForTests();
    localStorage.clear();
    // The supervision hooks fire from send(); this suite is about the
    // harness turn, so they run disabled (each is independently toggleable).
    localStorage.setItem('trader_learning_v1:alice', '0');
    localStorage.setItem('supervisor_auto_v1:alice', '0');
    listSkillsMock.mockReset();
    listSkillsMock.mockReturnValue([]);
});

describe('harness signal → model warning turn', () => {
    it('queues a notice row + streamed warning and NO user bubble', async () => {
        script(yieldText('Watch out — TP1 printed; the rest of the plan holds above 90.'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => { chatStore.queueHarnessSignal(SIGNAL); });

        const notice = await screen.findByTestId('chat-notice');
        expect(notice.textContent).toContain('TP1 @ 110 HIT');
        expect(await screen.findByText(/Watch out — TP1 printed/)).toBeTruthy();
        // The signal is NOT rendered as a user message…
        expect(screen.queryAllByTestId('chat-entry-user').length).toBe(0);
        // …but it IS the user-role message the model saw, riding live context.
        const messages = streamMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
        const last = messages[messages.length - 1];
        expect(last.role).toBe('user');
        expect(last.content).toContain('[HARNESS SIGNAL — price event, not the user]');
        expect(last.content).toContain('[LIVE CHART CONTEXT');
        // The protocol (treat as ground truth, never re-announce) rides the
        // system prompt the warning turn ran under.
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toContain('NEVER re-announce');
    });

    it('a signal that lands mid-run stays QUEUED and flushes when idle', async () => {
        script(yieldText('late warning'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        const sid = chatStore.getActiveId();
        act(() => {
            chatStore.beginRun(sid, new AbortController());   // a run is busy
            chatStore.queueHarnessSignal(SIGNAL);
        });
        expect(screen.queryByTestId('chat-notice')).toBeNull();
        expect(streamMock).not.toHaveBeenCalled();
        act(() => { chatStore.endRun(sid); });
        await screen.findByTestId('chat-notice');
        expect(await screen.findByText(/late warning/)).toBeTruthy();
    });

    it('multiple queued signals coalesce into ONE warning turn', async () => {
        script(yieldText('both noted'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => {
            chatStore.queueHarnessSignal(SIGNAL);
            chatStore.queueHarnessSignal('[HARNESS SIGNAL — price event, not the user] Plan btc-1: SL @ 90 HIT (mark 89, 14:40 UTC).');
        });
        await waitFor(() => expect(streamMock).toHaveBeenCalledTimes(1));
        const messages = streamMock.mock.calls[0][1] as Array<{ content: string }>;
        expect(messages[messages.length - 1].content).toContain('TP1 @ 110 HIT');
        expect(messages[messages.length - 1].content).toContain('SL @ 90 HIT');
    });
});

describe('present_trade arms the level-watch', () => {
    it('calls onPlanPresented with a dock-generated stable plan id', async () => {
        const presented: WatchPlan[] = [];
        script(async function* (_c: unknown, _m: unknown, opts: { executePanelTool?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown> }) {
            yield 'Here is a setup.';
            await opts.executePanelTool?.({
                id: 'c1', name: 'present_trade',
                arguments: { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] },
            });
            yield ' Logged it on the card.';
        });
        render(
            <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
                onSelectChatModel={() => {}} onPlanPresented={p => presented.push(p)} />,
        );
        fireEvent.click(screen.getByText('Read this chart'));
        await screen.findByTestId('trade-proposal-card');
        expect(presented.length).toBe(1);
        expect(presented[0].planId).toMatch(/^btc-[0-9a-z]+$/);
        expect(presented[0]).toMatchObject({ symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] });
    });

    it('the armed plan flows into the next message as an [ARMED PLAN] block', async () => {
        levelWatch.arm({ planId: 'btc-9', symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] }, 105);
        script(yieldText('read'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => { chatStore.queueHarnessSignal(SIGNAL); });
        await screen.findByTestId('chat-notice');
        const messages = streamMock.mock.calls[0][1] as Array<{ content: string }>;
        expect(messages[messages.length - 1].content).toContain('[ARMED PLAN');
        expect(messages[messages.length - 1].content).toContain('plan btc-9');
        expect(messages[messages.length - 1].content).toContain('No level has fired yet');
    });
});

describe('panel seats that pass stay invisible (B2)', () => {
    it('a (pass) seat never takes a visible turn; the room keeps only real answers', async () => {
        let turn = 0;
        script(async function* () {
            turn += 1;
            yield turn === 1 ? '(pass)' : (turn === 2 ? 'M2 has the read.' : 'Synthesized answer.');
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => {
            chatStore.addSession({
                kind: 'panel',
                panelModels: [
                    { providerId: 'prov-a', modelId: 'model-a' },
                    { providerId: 'prov-a', modelId: 'model-b' },
                ],
            });
        });
        const box = await screen.findByPlaceholderText(/Ask anything/);
        fireEvent.change(box, { target: { value: 'read this tape' } });
        fireEvent.click(screen.getByLabelText('Send'));

        expect(await screen.findByText('M2 has the read.')).toBeTruthy();
        expect(await screen.findByText(/Synthesized answer/)).toBeTruthy();
        expect(screen.queryByText('(pass)')).toBeNull();
        const entries = chatStore.getSnapshot().sessions.find(s => s.id === chatStore.getActiveId())!.entries;
        expect(entries.filter(e => e.role === 'ai').map(e => e.text)).toEqual(['M2 has the read.', 'Synthesized answer.']);
    });
});

describe('skills index refresh when a growth action lands (B5)', () => {
    it('a propose_skill mid-session re-enters the prompt on the next turn', async () => {
        const action = {
            at: new Date().toISOString(), speaker: 'm', tool: 'propose_skill',
            ok: true, verb: 'proposed', label: 'pullback-break', review: 'Settings → Skills',
        };
        script(async function* (_c: unknown, _m: unknown, opts: { onToolAction?: (a: unknown) => void }) {
            yield 'Proposing a skill.';
            opts.onToolAction?.(action);
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText(/Proposing a skill/);

        // The library now shows the proposed skill (a human approved it).
        listSkillsMock.mockReturnValue([{ file: { name: 'pullback-break.md' }, meta: { status: 'candidate', ifCondition: 'reclaim', thenAction: 'long' } }]);
        script(yieldText('second read'));
        const box = await screen.findByPlaceholderText(/Ask anything/);
        fireEvent.change(box, { target: { value: 'and now?' } });
        fireEvent.click(screen.getByLabelText('Send'));
        await screen.findByText(/second read/);

        // script() resets the mock — the only recorded call is the SECOND send.
        const secondCall = streamMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
        expect(secondCall[0].role).toBe('system');
        expect(secondCall[0].content).toContain('pullback-break');
    });
});

describe('response quality: instant paint + thinking-strip repair', () => {
    it('a pure CoT echo (content === reasoning) never shows the scratchpad twice', async () => {
        const echo = 'The tape shows a reclaim. I will check the levels and size.';
        script(async function* (_c: unknown, _m: unknown, opts: { onReasoning?: (c: string) => void }) {
            opts.onReasoning?.(echo);
            yield echo; // the model echoed its reasoning into the answer verbatim
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await waitFor(() => {
            const entry = chatStore.getSnapshot().sessions.find(s => s.id === chatStore.getActiveId())!.entries.find(e => e.role === 'ai')!;
            expect(entry.streaming).toBe(false);
        });
        const entry = chatStore.getSnapshot().sessions.find(s => s.id === chatStore.getActiveId())!.entries.find(e => e.role === 'ai')!;
        // The answer bubble is NOT a second copy of the thought; a tool row says why.
        expect(entry.text).toBe('');
        expect(entry.reasoning).toContain('reclaim');
        expect(entry.tools.join(' ')).toContain('only its reasoning');
    });

    it('an echo followed by a real answer keeps only the answer', async () => {
        const r = 'Let me weigh the levels first.';
        script(async function* (_c: unknown, _m: unknown, opts: { onReasoning?: (c: string) => void }) {
            opts.onReasoning?.(r);
            yield r + ' Bias long above 111,400 only.';
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        expect(await screen.findByText(/Bias long above 111,400 only/)).toBeTruthy();
        const entry = chatStore.getSnapshot().sessions.find(s => s.id === chatStore.getActiveId())!.entries.find(e => e.role === 'ai')!;
        expect(entry.text).toBe('Bias long above 111,400 only.');
    });

    it('a failing panel seat shows the REAL error, not a bare "failed to answer"', async () => {
        script(async function* (_c: unknown, _m: unknown, opts: { mailboxSeat?: string }) {
            if (opts.mailboxSeat === 'Model B') throw new Error('429 rate limit from provider');
            yield 'A speaks.';
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => {
            chatStore.addSession({
                kind: 'panel',
                panelModels: [
                    { providerId: 'prov-a', modelId: 'model-a' },
                    { providerId: 'prov-a', modelId: 'model-b' },
                ],
            });
        });
        const box = await screen.findByPlaceholderText(/Ask anything/);
        fireEvent.change(box, { target: { value: 'read' } });
        fireEvent.click(screen.getByLabelText('Send'));
        // Seat A answers; seat B's bubble carries the reason (the synthesis
        // pass may fail it too — findAll, not find).
        expect(await screen.findByText('A speaks.')).toBeTruthy();
        const fails = await screen.findAllByText(/this seat failed to answer: 429 rate limit/);
        expect(fails.length).toBeGreaterThanOrEqual(1);
    });

    it('a seat whose provider vanished says "unavailable" instead of silently skipping', async () => {
        script(yieldText('live seat answers.'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => {
            chatStore.addSession({
                kind: 'panel',
                panelModels: [
                    { providerId: 'prov-a', modelId: 'model-a' },
                    { providerId: 'gone-provider', modelId: 'model-z' },
                ],
            });
        });
        const box = await screen.findByPlaceholderText(/Ask anything/);
        fireEvent.change(box, { target: { value: 'read' } });
        fireEvent.click(screen.getByLabelText('Send'));
        expect(await screen.findByTestId('chat-notice')).toBeTruthy();
        expect(screen.getByTestId('chat-notice').textContent).toContain('Seat unavailable');
    });

    it('paints the user bubble + Thinking placeholder BEFORE the packet fetch resolves', async () => {
        // Hold the hybrid fetch so the ONLY thing between send() and the model
        // call is the network — the transcript must already show the bubbles.
        let release: (v: unknown) => void = () => {};
        const held = new Promise(res => { release = res; });
        const hybrid = await import('../services/analysis/HybridIntelligenceService');
        vi.mocked(hybrid.fetchHybridData).mockReturnValueOnce(held as never);
        script(yieldText('late answer'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        // The user bubble + the streaming placeholder are on screen while the
        // fetch is still in flight (the old code waited for it first).
        expect(await screen.findByTestId('chat-entry-user')).toBeTruthy();
        expect(screen.getByTestId('thinking-placeholder')).toBeTruthy();
        expect(screen.queryByText('late answer')).toBeNull();
        release({});
        expect(await screen.findByText('late answer')).toBeTruthy();
    });

    it('peels header-style leaked thinking out of the answer at settle', async () => {
        script(async function* () {
            yield 'Thinking:\nI should check the reclaim level first.\n\nFINAL_OUTPUT:\nBias long above 111,400.';
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        const answer = await screen.findByText(/Bias long above 111,400/);
        expect(answer).toBeTruthy();
        // The scratchpad moved OUT of the answer entry's text into the Thought
        // row (it still renders, but inside the reasoning body — so assert on
        // the stored entry, not a global text query).
        const entry = chatStore.getSnapshot().sessions.find(s => s.id === chatStore.getActiveId())!.entries.find(e => e.role === 'ai')!;
        expect(entry.text).toBe('Bias long above 111,400.');
        expect(entry.reasoning).toContain('check the reclaim level');
    });

    it('leaves a clean answer (even one opening with "Verdict:") untouched', async () => {
        const clean = 'Verdict: BTC looks heavy under 112k; stay flat until the reclaim.';
        script(yieldText(clean));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText(/stay flat until the reclaim/);
        const entry = chatStore.getSnapshot().sessions.find(s => s.id === chatStore.getActiveId())!.entries.find(e => e.role === 'ai')!;
        expect(entry.text).toBe(clean);
    });

    it('the collaboration-memory index rides the system prompt every turn', async () => {        rememberProfileMemory({ name: 'Prefers BTC only', kind: 'user', description: 'When picking symbols.', body: 'User trades BTCUSDT only.' });
        script(yieldText('read'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText('read');
        const messages = streamMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toContain('[user] prefers-btc-only');
        expect(messages[0].content).toContain('When picking symbols.');
        // The discipline rule that makes it behave like this environment's memory.
        expect(messages[0].content).toContain('UPDATE an existing slug');
    });
});

describe('watch / schedule harness tools', () => {
    /** Drive executePanelTool through a scripted tool call and capture the receipt. */
    const callPanelTool = async (name: string, args: Record<string, unknown>) => {
        let result: { ok: boolean; content: string } | null | undefined = null;
        script(async function* (_c: unknown, _m: unknown, opts: {
            executePanelTool?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<{ ok: boolean; content: string } | null>;
        }) {
            yield 'x';
            result = await opts.executePanelTool?.({ id: 'c1', name, arguments: args });
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText('x');
        // give the awaited tool call a tick to resolve
        await waitFor(() => expect(result).toBeTruthy());
        return result as unknown as { ok: boolean; content: string };
    };

    it('watch_price arms a price watch and the receipt names the id', async () => {
        const receipt = await callPanelTool('watch_price', { condition: 'above', price: 112000, note: 'range break' });
        expect(receipt.ok).toBe(true);
        expect(receipt.content).toMatch(/Watch w-.* armed: BTCUSDT above 112000/);
        expect(watchService.list('BTCUSDT').length).toBe(1);
    });

    it('wake_me arms a scheduled wake-up', async () => {
        const receipt = await callPanelTool('wake_me', { inMinutes: 30, note: 're-check the breakout' });
        expect(receipt.ok).toBe(true);
        expect(receipt.content).toContain('Scheduled wake');
        expect(watchService.list().some(w => w.kind === 'time')).toBe(true);
    });

    it('an armed watch flows into the next message as an [ARMED HARNESSES] block', async () => {
        // Arm through the service directly (the routing itself is the test above).
        const { watch } = parsePriceWatch({ condition: 'above', price: 112000, note: 'range break' },
            { symbol: 'BTCUSDT', makeId: () => 'w-ctx', nowMs: Date.now() });
        watchService.arm(watch!);
        script(yieldText('second read'));
        const SIGNAL2 = '[HARNESS TRIGGER — scheduled watch fired, not the user] Watch w-1: BTCUSDT printed 112050.';
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => { chatStore.queueHarnessSignal(SIGNAL2); });
        await screen.findByTestId('chat-notice');
        const messages = streamMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
        expect(messages[messages.length - 1].content).toContain('[ARMED HARNESSES');
        expect(messages[messages.length - 1].content).toContain('above 112000');
    });

    it('a fired-trigger signal renders a stripped ⚡ notice (no raw bracket envelope)', async () => {
        script(yieldText('Your breakout is here — long looks ready.'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => { chatStore.queueHarnessSignal('[HARNESS TRIGGER — scheduled watch fired, not the user] Watch w-1: BTCUSDT above 112000. Tell the user.'); });
        const notice = await screen.findByTestId('chat-notice');
        expect(notice.textContent).toContain('⚡');
        expect(notice.textContent).not.toContain('HARNESS TRIGGER');
        expect(await screen.findByText(/breakout is here/)).toBeTruthy();
    });
});

describe('message UX: new session, seat editor, copy', () => {
    it('the + button starts a new chat and the history palette switches sessions', async () => {
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        const before = chatStore.getSnapshot().sessions.length;
        // Antigravity Agent header: + new chat, history palette, ⋯ menu, × collapse.
        fireEvent.click(screen.getByLabelText('New chat'));
        await waitFor(() => expect(chatStore.getSnapshot().sessions.length).toBe(before + 1));
        const firstId = chatStore.getSnapshot().activeId;
        fireEvent.click(screen.getByLabelText('New chat'));
        await waitFor(() => expect(chatStore.getSnapshot().activeId).not.toBe(firstId));
        // Past Conversations palette: search filter + keyboard nav (rows are
        // newest-first, so ↓↵ lands on the OLDER "New chat" = firstId).
        fireEvent.click(screen.getByLabelText('Past conversations'));
        const palette = await screen.findByTestId('chat-history');
        fireEvent.change(screen.getByLabelText('Search all conversations'), { target: { value: 'zzz-no-match' } });
        expect(palette.textContent).toContain('No conversations match');
        fireEvent.change(screen.getByLabelText('Search all conversations'), { target: { value: '' } });
        const search = screen.getByLabelText('Search all conversations');
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        fireEvent.keyDown(search, { key: 'Enter' });
        await waitFor(() => expect(chatStore.getSnapshot().activeId).toBe(firstId));
    });

    it('the panel header chip reopens the seat editor after Done', () => {
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        act(() => { chatStore.addSession({ kind: 'panel', panelModels: [{ providerId: 'prov-a', modelId: 'model-a' }] }); });
        // Open the editor via the header chip, add a model, dismiss with Done.
        const chip = screen.getByRole('button', { name: /panel · 1\/5/ });
        fireEvent.click(chip);
        expect(screen.getByTestId('panel-picker')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.queryByTestId('panel-picker')).toBeNull();
        // And it reopens from the same chip (the whole point).
        fireEvent.click(chip);
        expect(screen.getByTestId('panel-picker')).toBeTruthy();
    });

    it('user + model bubbles expose a copy chip that writes the clipboard', async () => {
        const writeText = vi.fn(async () => {});
        const prev = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        script(yieldText('the model answer'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        // A user message + a settled model answer.
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [
                { id: 'u1', role: 'user', text: 'read the tape', tools: [] },
                { id: 'a1', role: 'ai', text: 'the model answer', tools: [] },
            ],
        })); });
        const chips = await screen.findAllByLabelText('Copy message');
        expect(chips.length).toBeGreaterThanOrEqual(2);
        fireEvent.click(chips[0]);
        await waitFor(() => expect(writeText).toHaveBeenCalled());
        expect(writeText.mock.calls.flat()).toContain('read the tape');
        if (prev) Object.defineProperty(navigator, 'clipboard', { value: prev, configurable: true });
    });
});
