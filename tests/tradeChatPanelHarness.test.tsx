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
vi.mock('../services/analysis/KlineService', () => ({
    // BiasChips pulls klines for the dock's regime row — keep the suite offline.
    fetchKlines: vi.fn(async () => []),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: (...args: unknown[]) => (listSkillsMock as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import TradeChatPanel, { __clearPacketCacheForTests, __clearProposalStateForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';
import * as levelWatch from '../services/trade/levelWatchService';
import * as watchService from '../services/trade/watchService';
import { parsePriceWatch } from '../services/trade/chartTriggers';
import { rememberProfileMemory, __clearProfileMemoriesForTests } from '../services/learning/profileMemory';
import type { WatchPlan } from '../services/trade/tradePlanLevels';
import type { TradeProposal } from '../services/trade/proposedTrade';

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
    // watchService's REST-poll clock (Tier-0 #6) runs every second while any
    // price watch is armed — this suite arms real watches through the panel,
    // so the mark-price endpoint must never reach the network (a live print
    // crossing an armed level would queue a second harness signal mid-test).
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline test'); }));
    __clearPacketCacheForTests();
    __clearProposalStateForTests();
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
    // Handle to the dock rendered by callPanelTool so a second call in the
    // SAME test (arm → cancel) can tear the first one down first — two live
    // docks would double-match the suggestion chips.
    let lastPanel: { unmount: () => void } | null = null;
    const callPanelTool = async (name: string, args: Record<string, unknown>) => {
        let result: { ok: boolean; content: string } | null | undefined = null;
        script(async function* (_c: unknown, _m: unknown, opts: {
            executePanelTool?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<{ ok: boolean; content: string } | null>;
        }) {
            yield 'x';
            result = await opts.executePanelTool?.({ id: 'c1', name, arguments: args });
        });
        lastPanel = render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText('x');
        // give the awaited tool call a tick to resolve
        await waitFor(() => expect(result).toBeTruthy());
        return result as unknown as { ok: boolean; content: string };
    };
    // RTL auto-cleanup unmounts between tests — drop the stale handle so the
    // next call never re-unmounts a dead container.
    beforeEach(() => { lastPanel = null; });
    /** Let the scripted generator finish its run, tear the dock down and wipe
     *  the (shared) transcript, so a second callPanelTool in the same test
     *  starts clean — the first send's 'Key levels?' user bubble would
     *  otherwise double-match the chip. Armed watches live in watchService,
     *  a different store, and survive. */
    const settleAndUnmount = async (): Promise<void> => {
        const sid = chatStore.getActiveId();
        await waitFor(() => expect(chatStore.getSnapshot().running[sid]).toBeFalsy());
        if (lastPanel) { lastPanel.unmount(); lastPanel = null; }
        chatStore.__resetForTests();
    };

    it('watch_price arms a price watch and the receipt names the id', async () => {
        const receipt = await callPanelTool('watch_price', { condition: 'above', price: 112000, note: 'range break' });
        expect(receipt.ok).toBe(true);
        expect(receipt.content).toMatch(/Watch w-.* armed: BTCUSDT above 112000/);
        expect(watchService.list('BTCUSDT').length).toBe(1);
    });

    it('cancel_watch with a bare base cancels plans armed under the normalized full form', async () => {
        // The model arms with 'BTC' — chartTriggers canonicalizes it to
        // 'BTCUSDT' (baseOf+quoteOf). A cancel back with the SAME bare 'BTC'
        // must hit it: the old raw toUpperCase() target could not, leaving the
        // watch armed while the receipt claimed "Nothing to cancel".
        const armed = await callPanelTool('watch_price', { condition: 'above', price: 112000, note: 'range break', symbol: 'BTC' });
        expect(armed.ok).toBe(true);
        expect(watchService.list('BTCUSDT').length).toBe(1);
        await settleAndUnmount();
        const receipt = await callPanelTool('cancel_watch', { allForSymbol: true, symbol: 'BTC' });
        expect(receipt.ok).toBe(true);
        expect(receipt.content).toContain('Cancelled 1 watch');
        expect(receipt.content).not.toContain('Nothing to cancel');
        await settleAndUnmount();
        expect(watchService.list().length).toBe(0);
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

describe('send() double-run guards (deep-dive 2026-09-15, chat wave 3)', () => {
    it('two clicks in the SAME tick start only ONE run (fresh store read, not the render snapshot)', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>(r => { release = r; });
        script(async function* () { yield 'answer'; await gate; });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        const box = await screen.findByPlaceholderText(/Ask anything/);
        fireEvent.change(box, { target: { value: 'twice please' } });
        // The whole race in one act(): no React re-render between the clicks,
        // so the closure's `busy` snapshot is still false for the second send.
        act(() => {
            fireEvent.click(screen.getByLabelText('Send'));
            fireEvent.click(screen.getByLabelText('Send'));
        });
        await act(async () => { release(); });
        await screen.findByText('answer');
        expect(streamMock).toHaveBeenCalledTimes(1);
        const session = chatStore.getSnapshot().sessions.find(s => s.id === chatStore.getActiveId())!;
        expect(session.entries.filter(e => e.role === 'user')).toHaveLength(1);
    });

    it('a finishing run never deletes a NEWER run slot — Stop stays aimed at the live run', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>(r => { release = r; });
        script(async function* () { yield 'first'; await gate; });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText('first');
        const sid = chatStore.getActiveId();
        // A newer beginRun replaces the store's controller for this session
        // (a harness flush racing the user send). The OLD run finishing must
        // NOT delete that entry — that is what made Stop target nothing.
        const newer = new AbortController();
        act(() => { chatStore.beginRun(sid, newer); });
        await act(async () => { release(); });
        expect(chatStore.getController(sid)).toBe(newer);
        expect(chatStore.getSnapshot().running[sid]).toBe(true);
        act(() => { chatStore.abortActive(); });
        expect(newer.signal.aborted).toBe(true);
    });
});

describe('per-turn identity: background turns write to THEIR session', () => {
    it('a present_trade from a turn the user switched away from still lands in ITS OWN entry', async () => {
        let callTool: ((call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown>) | null = null;
        script(async function* (_c: unknown, _m: unknown, opts: {
            executePanelTool?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
        }) {
            yield 'holding';
            callTool = opts.executePanelTool ?? null;
            await new Promise<void>(r => setTimeout(r, 0));
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await waitFor(() => expect(callTool).toBeTruthy());
        const before = chatStore.getSnapshot();
        const sidA = before.activeId;
        const entryAId = before.sessions.find(s => s.id === sidA)!.entries.find(e => e.role === 'ai')!.id;
        // The user switches to a NEW session while the first turn is still running.
        let sidB = '';
        act(() => { sidB = chatStore.addSession(); });
        expect(chatStore.getSnapshot().activeId).toBe(sidB);
        await act(async () => {
            await callTool!({
                id: 'c1', name: 'present_trade',
                arguments: { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] },
            });
        });
        const after = chatStore.getSnapshot();
        const a = after.sessions.find(s => s.id === sidA)!;
        const b = after.sessions.find(s => s.id === sidB)!;
        // The proposal rode the RUNNING turn's sid/entryId — not the viewed
        // session the user switched to.
        expect(a.entries.find(e => e.id === entryAId)?.proposal).toBeTruthy();
        expect(b.entries.some(e => !!e.proposal)).toBe(false);
    });
});

describe('explicit Stop is never narrated as a failure', () => {
    it('stopping a mid-stream turn shows neither "could not answer" nor the pure-echo note', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>(r => { release = r; });
        script(async function* (_c: unknown, _m: unknown, opts: { signal?: AbortSignal; onReasoning?: (c: string) => void }) {
            opts.onReasoning?.('the model thought this through');
            yield 'the model thought this through'; // a pure echo of the reasoning
            await gate;
            // The transport dies exactly as the real stream does after Stop.
            const err = new Error('The turn was stopped.');
            err.name = 'AbortError';
            throw err;
        });
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText('the model thought this through');
        const sid = chatStore.getActiveId();
        act(() => { chatStore.abortActive(); release(); });
        await waitFor(() => {
            const entry = chatStore.getSnapshot().sessions.find(s => s.id === sid)!.entries.find(e => e.role === 'ai')!;
            expect(entry.streaming).toBe(false);
        });
        const entry = chatStore.getSnapshot().sessions.find(s => s.id === sid)!.entries.find(e => e.role === 'ai')!;
        expect(entry.text).toBe('the model thought this through');
        expect(entry.tools.join(' ')).not.toContain('only its reasoning');
        expect(entry.text).not.toContain('could not answer');
        expect(screen.queryByText(/could not answer/)).toBeNull();
    });
});

describe('harness drain only into chat-kind sessions', () => {
    it('signals HOLD while a coach session is selected and drain when a chat returns', async () => {
        script(yieldText('warned now'));
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        const soloId = chatStore.getActiveId();
        act(() => { chatStore.addSession({ kind: 'coach', title: 'Coach inbox' }); });
        act(() => { chatStore.queueHarnessSignal(SIGNAL); });
        // Held: the queue was NOT consumed, and no model turn ran into the
        // coach transcript the dock never renders.
        await waitFor(() => expect(chatStore.getSnapshot().signals.length).toBe(1));
        expect(streamMock).not.toHaveBeenCalled();
        expect(screen.queryByTestId('chat-notice')).toBeNull();
        // Switching back to the chat session re-fires the drain effect.
        act(() => { chatStore.setActiveId(soloId); });
        await screen.findByTestId('chat-notice');
        expect(await screen.findByText(/warned now/)).toBeTruthy();
        expect(chatStore.getSnapshot().signals.length).toBe(0);
    });
});

describe('present_trade reports the arm() disposition honestly', () => {
    it('a plan already through its target gets a REFUSED warning, not a fake watch promise', async () => {
        let receipt: { ok: boolean; content: string } | null = null;
        script(async function* (_c: unknown, _m: unknown, opts: {
            executePanelTool?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<{ ok: boolean; content: string } | null>;
        }) {
            yield 'x';
            receipt = await opts.executePanelTool?.({
                id: 'c1', name: 'present_trade',
                arguments: { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] },
            }) ?? null;
        });
        // Live mark 111 is already THROUGH TP1 (110) — arm() will refuse this.
        const snapshot = { markPrice: 111, candles: [] } as never;
        render(
            <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
                onSelectChatModel={() => {}} getChartSnapshot={() => snapshot} />,
        );
        fireEvent.click(screen.getByText('Key levels?'));
        await waitFor(() => expect(receipt).toBeTruthy());
        expect(receipt!.ok).toBe(true);
        expect(receipt!.content).toContain('REFUSED');
        expect(receipt!.content).not.toContain('The harness now watches');
    });

    it('a live plan ahead of price still gets the watch promise', async () => {
        let receipt: { ok: boolean; content: string } | null = null;
        script(async function* (_c: unknown, _m: unknown, opts: {
            executePanelTool?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<{ ok: boolean; content: string } | null>;
        }) {
            yield 'x';
            receipt = await opts.executePanelTool?.({
                id: 'c1', name: 'present_trade',
                arguments: { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] },
            }) ?? null;
        });
        const snapshot = { markPrice: 105, candles: [] } as never;
        render(
            <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
                onSelectChatModel={() => {}} getChartSnapshot={() => snapshot} />,
        );
        fireEvent.click(screen.getByText('Key levels?'));
        await waitFor(() => expect(receipt).toBeTruthy());
        expect(receipt!.content).toContain('The harness now watches');
        expect(receipt!.content).not.toContain('REFUSED');
    });
});

describe('cross-symbol canvas honesty (per-turn identity residual)', () => {
    /** Drive a stamped panel tool with the canvas showing a DIFFERENT coin
     *  than the running turn — the mid-turn instrument switch the per-turn
     *  refactor left un-annotated. The receipt must say the stamp came off
     *  the viewed canvas instead of silently passing its prices off as the
     *  turn's coin's live mark. */
    const callStampedTool = async (
        snapshot: unknown,
        name: string,
        args: Record<string, unknown>,
    ) => {
        let receipt: { ok: boolean; content: string } | null = null;
        script(async function* (_c: unknown, _m: unknown, opts: {
            executePanelTool?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<{ ok: boolean; content: string } | null>;
        }) {
            yield 'x';
            receipt = await opts.executePanelTool?.({ id: 'c1', name, arguments: args }) ?? null;
        });
        render(
            <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
                onSelectChatModel={() => {}} getChartSnapshot={() => snapshot as never}
                addModelDrawings={() => {}} />,
        );
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText('x');
        await waitFor(() => expect(receipt).toBeTruthy());
        return receipt as unknown as { ok: boolean; content: string };
    };

    const canvasOn = (symbol: string, markPrice: number) => ({
        symbol, interval: '15m', candles: [{ time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5 }],
        markPrice, levels: [], drawings: [], modelDrawings: [], capturedAt: Date.now(),
    });

    it('draw_on_chart stamps from another coin\'s canvas → the receipt labels it stale', async () => {
        const receipt = await callStampedTool(canvasOn('ETHUSDT', 3000), 'draw_on_chart',
            { kind: 'hline', prices: [100], label: 'range top' });
        expect(receipt.ok).toBe(true);
        expect(receipt.content).toContain('NOTE: the canvas shows ETHUSDT');
        expect(receipt.content).toContain('turn was on BTCUSDT');
        expect(receipt.content).toContain('stale');
    });

    it('mark_trade_levels gets the same honesty note', async () => {
        const receipt = await callStampedTool(canvasOn('ETHUSDT', 3000), 'mark_trade_levels',
            { entry: 100, stopLoss: 90, takeProfits: [110] });
        expect(receipt.content).toContain('NOTE: the canvas shows ETHUSDT');
    });

    it('present_trade cross-canvas: the receipt PROMISES the watch (arm gets a null anchor off-view)', async () => {
        // ETH canvas print 111 would REFUSE the BTC plan — but TradeView arms
        // off-view plans with a NULL anchor (never the viewed coin's price),
        // so the receipt must mirror that reality: promise the watch and keep
        // the canvas-stale note, instead of lying about a REFUSED watch.
        const receipt = await callStampedTool(canvasOn('ETHUSDT', 111), 'present_trade',
            { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] });
        expect(receipt.content).not.toContain('REFUSED');
        expect(receipt.content).toContain('The harness now watches');
        expect(receipt.content).toContain('NOTE: the canvas shows ETHUSDT');
    });

    it('present_trade on the VIEWED canvas still refuses a plan through its levels', async () => {
        // Same-coin mark 111 is the turn's live price — the stale gate applies
        // and the REFUSED honesty must survive the cross-canvas fix.
        const receipt = await callStampedTool(canvasOn('BTCUSDT', 111), 'present_trade',
            { direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] });
        expect(receipt.content).toContain('REFUSED');
        expect(receipt.content).not.toContain('The harness now watches');
    });

    it('a SAME-coin canvas stays byte-identical — no note, no noise', async () => {
        const receipt = await callStampedTool(canvasOn('BTCUSDT', 105), 'mark_trade_levels',
            { entry: 100, stopLoss: 90, takeProfits: [110] });
        expect(receipt.content).toContain('Marked on the chart:');
        expect(receipt.content).not.toContain('NOTE:');
    });
});

describe('composer badge, proposal double-log, mid-turn retry chips', () => {
    it('the ctx packet-age badge clears on a symbol switch (no previous coin\u2019s fetch time)', async () => {
        script(yieldText('answer'));
        const props = (sym: string) => ({
            symbol: sym, interval: '15m', providers: [config], selectedChatModel: 'model-a',
            onSelectChatModel: () => {},
        });
        const { rerender } = render(<TradeChatPanel {...props('BTCUSDT')} />);
        fireEvent.click(screen.getByText('Key levels?'));
        await screen.findByText('answer');
        await waitFor(() => expect(document.body.textContent).toContain('ctx '));
        rerender(<TradeChatPanel {...props('ETHUSDT')} />);
        await waitFor(() => expect(screen.getByText('ETHUSDT · 15m')).toBeTruthy());
        expect(document.body.textContent).not.toContain('ctx ');
    });

    const seededProposal: TradeProposal = {
        symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110],
        confidence: 'Medium', rationale: 'reclaim',
    };
    const seedProposalEntry = (): void => {
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [{ id: 'a-proposal', role: 'ai', text: 'a plan', tools: [], proposal: seededProposal }],
        })); });
    };

    it('"logged" survives a dock unmount — the card cannot double-log the same plan', async () => {
        const logged: TradeProposal[] = [];
        const dock = (): React.ReactElement => (
            <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
                onSelectChatModel={() => {}} onLogProposedTrade={p => logged.push(p)} />
        );
        const first = render(dock());
        seedProposalEntry();
        fireEvent.click(await screen.findByText('Log this trade'));
        expect(logged).toHaveLength(1);
        // The user leaves the trade surface (the dock unmounts — component
        // state would die with it) and comes back: the STORE-side disposition
        // persists, so the card shows ✓ Logged with NO second Log button —
        // and even if the click somehow landed twice, only one log happens.
        first.unmount();
        render(dock());
        expect(screen.queryByText('Log this trade')).toBeNull();
        expect(screen.getByText(/✓ Logged as an open trade/)).toBeTruthy();
        expect(logged).toHaveLength(1);
    });

    it('retry chips stay hidden while ANY later seat of the turn is still streaming', async () => {
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
        const sid = chatStore.getActiveId();
        act(() => { chatStore.mutate(sid, s => ({
            ...s,
            entries: [
                { id: 'u1', role: 'user', text: 'read', tools: [] },
                { id: 'a1', role: 'ai', text: 'seat one settled', tools: [] },
                { id: 'a2', role: 'ai', text: 'seat two live', tools: [], streaming: true },
            ],
        })); });
        // Seat 1 settled — but seat 2 is still streaming: NO chip yet.
        expect(screen.queryByLabelText('Retry this message')).toBeNull();
        act(() => { chatStore.mutate(sid, s => ({
            ...s,
            entries: s.entries.map(e => (e.id === 'a2' ? { ...e, streaming: false } : e)),
        })); });
        expect(await screen.findByLabelText('Retry this message')).toBeTruthy();
    });
});
