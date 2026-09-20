/**
 * TradeChatPanel — the imperative scroll-to-entry bridge (audit 2026-09-15).
 * App's "Jump to latest analysis" and the saved-analyses gallery's Locate
 * were silent no-ops: the old virtuosoRef was never attached (the transcript
 * lives in this dock, a plain scroll container, not a Virtuoso). The dock now
 * hands App a scrollToMessage(id) function via `registerScrollToMessage`
 * (null on unmount); entries carry `data-entry-id` (chatStore entry id) and
 * `data-message-id` (the App-side analysis message id for ensemble answers,
 * falling back to the entry id). This covers the panel half;
 * tests/scrollToMessageWiring.test.ts asserts the App/TradeView wiring.
 *
 * The same App-side message id is what the Pin chip writes, so the Pinned
 * list's entry point is covered here too — it depends on exactly that stamp.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { ProviderConfig } from '../types/provider';

const { streamMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
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
    listSkills: () => [],
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import TradeChatPanel, { __clearPacketCacheForTests, __clearProposalStateForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

/** jsdom implements no scrollIntoView — capture calls with a prototype stub. */
const scrollSpy = vi.fn(function (this: Element, _opts?: ScrollIntoViewOptions): void { void this; });

beforeEach(() => {
    chatStore.__resetForTests();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline test'); }));
    __clearPacketCacheForTests();
    __clearProposalStateForTests();
    localStorage.clear();
    scrollSpy.mockClear();
    // Defined, not spied — jsdom's Element.prototype has no scrollIntoView.
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = scrollSpy;
});

type ScrollFn = (messageId: string) => void;

const renderDock = (extra?: Record<string, unknown>): { getRegistered: () => ScrollFn | null } => {
    let registered: ScrollFn | null = null;
    render(
        <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
            onSelectChatModel={() => {}} registerScrollToMessage={(fn: ScrollFn | null) => { registered = fn; }}
            {...extra} />,
    );
    return { getRegistered: () => registered };
};

describe('scroll-to-message bridge', () => {
    it('registers the scroll function on mount and passes null on unmount', () => {
        let registered: ScrollFn | null | undefined;
        const { unmount } = render(
            <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
                onSelectChatModel={() => {}}
                registerScrollToMessage={(fn: ScrollFn | null) => { registered = fn; }} />,
        );
        expect(typeof registered).toBe('function');
        unmount();
        expect(registered).toBeNull();
    });

    it('entries are stamped data-entry-id (default data-message-id = entry id)', async () => {
        renderDock();
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [
                { id: 'u1', role: 'user', text: 'read the tape', tools: [] },
                { id: 'a1', role: 'ai', text: 'the answer', tools: [] },
            ],
        })); });
        await screen.findByText('the answer');
        const wrappers = document.querySelectorAll('[data-entry-id]');
        expect(Array.from(wrappers).map(w => w.getAttribute('data-entry-id'))).toEqual(['u1', 'a1']);
        expect(wrappers[1].getAttribute('data-message-id')).toBe('a1');
    });

    it('calling the registered fn with an entry id smooth-scrolls THAT entry', async () => {
        const { getRegistered } = renderDock();
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [
                { id: 'u1', role: 'user', text: 'read the tape', tools: [] },
                { id: 'a1', role: 'ai', text: 'the answer', tools: [] },
            ],
        })); });
        await screen.findByText('the answer');
        getRegistered()!.call(null, 'a1');
        expect(scrollSpy).toHaveBeenCalledTimes(1);
        const target = scrollSpy.mock.instances[0] as Element;
        expect(target.getAttribute('data-entry-id')).toBe('a1');
        expect(scrollSpy.mock.calls[0][0]).toEqual({ block: 'center', behavior: 'smooth' });
    });

    it('an unknown id is a no-op (never scrolls the wrong entry)', async () => {
        const { getRegistered } = renderDock();
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [{ id: 'a1', role: 'ai', text: 'the answer', tools: [] }],
        })); });
        await screen.findByText('the answer');
        getRegistered()!.call(null, 'not-an-entry');
        expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('a coach session renders no transcript — the bridge cannot throw', () => {
        const { getRegistered } = renderDock();
        act(() => { chatStore.addSession({ kind: 'coach', title: 'Coach inbox' }); });
        expect(() => getRegistered()!.call(null, 'anything')).not.toThrow();
        expect(scrollSpy).not.toHaveBeenCalled();
    });

    it('an ensemble answer is stamped with its App-side messageId, and Locate scrolls to it', async () => {
        const onRunAnalysis = vi.fn(async (): Promise<string | { text: string; messageId?: string }> =>
            ({ text: 'Verdict: Long BTC — the answer.', messageId: 'msg-42' }));
        const { getRegistered } = renderDock({ onRunAnalysis });
        const box = await screen.findByPlaceholderText(/Ask anything/);
        fireEvent.change(box, { target: { value: 'give me a full read' } });
        fireEvent.click(screen.getByText('Full analysis'));
        const answer = await screen.findByText(/Verdict: Long BTC/);
        const wrapper = answer.closest('[data-entry-id]')!;
        // The entry id stays the primary key; the App message id rides
        // data-message-id so the gallery's Locate (which holds message ids)
        // finds this exact entry.
        expect(wrapper.getAttribute('data-message-id')).toBe('msg-42');
        scrollSpy.mockClear();
        getRegistered()!.call(null, 'msg-42');
        expect(scrollSpy).toHaveBeenCalledTimes(1);
        expect((scrollSpy.mock.instances[0] as Element).getAttribute('data-entry-id'))
            .toBe(wrapper.getAttribute('data-entry-id'));
        scrollSpy.mockClear();
        getRegistered()!.call(null, wrapper.getAttribute('data-entry-id') as string);
        expect(scrollSpy).toHaveBeenCalledTimes(1);
    });

    it('a plain-string onRunAnalysis result keeps the entry-id fallback stamp', async () => {
        const onRunAnalysis = vi.fn(async (): Promise<string | { text: string; messageId?: string }> => 'Just the verdict text.');
        renderDock({ onRunAnalysis });
        const box = await screen.findByPlaceholderText(/Ask anything/);
        fireEvent.change(box, { target: { value: 'full read' } });
        fireEvent.click(screen.getByText('Full analysis'));
        const answer = await screen.findByText(/Just the verdict text/);
        const wrapper = answer.closest('[data-entry-id]')!;
        expect(wrapper.getAttribute('data-message-id')).toBe(wrapper.getAttribute('data-entry-id'));
    });
});

describe('the Pinned list has an entry point', () => {
    /** Run a "Full analysis" so the answer carries an App message id — that id
     *  is the only thing a pin can attach to (the flag lives on the Message). */
    const pinFromVerdict = async (extra: Record<string, unknown>): Promise<void> => {
        const onRunAnalysis = vi.fn(async (): Promise<string | { text: string; messageId?: string }> =>
            ({ text: 'Verdict: Long BTC — the answer.', messageId: 'msg-42' }));
        renderDock({ onRunAnalysis, ...extra });
        const box = await screen.findByPlaceholderText(/Ask anything/);
        fireEvent.change(box, { target: { value: 'full read' } });
        fireEvent.click(screen.getByText('Full analysis'));
        await screen.findByText(/Verdict: Long BTC/);
    };

    it('a settled verdict offers Pin, and clicking it reports that message id', async () => {
        const onToggleWatch = vi.fn();
        await pinFromVerdict({ onToggleWatch, pinnedMessageIds: new Set<string>() });
        fireEvent.click(screen.getByLabelText('Pin this signal'));
        expect(onToggleWatch).toHaveBeenCalledWith('msg-42');
    });

    it('an already-pinned verdict says so without needing a hover', async () => {
        await pinFromVerdict({
            onToggleWatch: () => {},
            pinnedMessageIds: new Set(['msg-42']),
        });
        const chip = screen.getByLabelText('Unpin this signal');
        expect(chip.getAttribute('aria-pressed')).toBe('true');
        expect(chip.className).not.toMatch(/opacity-0/);
        expect(chip.textContent).toBe('Pinned');
    });

    it('a plain chat answer with no analysis message behind it offers no Pin', async () => {
        renderDock({ onToggleWatch: () => {}, pinnedMessageIds: new Set<string>() });
        act(() => { chatStore.mutate(chatStore.getActiveId(), s => ({
            ...s,
            entries: [
                { id: 'u1', role: 'user', text: 'what does this chart look like', tools: [] },
                { id: 'a1', role: 'ai', text: 'a solo answer', tools: [] },
            ],
        })); });
        await screen.findByText('a solo answer');
        expect(screen.queryByLabelText('Pin this signal')).toBeNull();
    });
});
