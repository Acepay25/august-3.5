/**
 * TradeChatPanel — Minara's right-hand AI column, August's honest version:
 * a chat docked beside the chart where EVERY message carries a freshly
 * fetched, code-calculated market packet (the chart in words — candles
 * state, indicators, funding, OI, book walls, liquidations, session) and the
 * model can pull even newer data itself through the desk tools. No order
 * execution — this is the copilot read of the tape, not a trade button.
 *
 * Ephemeral by design (like BotManagerDrawer): the panel is a live
 * assistant, not a journal; the persistent record stays in the main chat.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProviderConfig } from '../../types/provider';
import { ChatMessage } from '../../services/providers/GenericProviderService';
import { streamChatWithDeskTools } from '../../services/analysis/DeskToolsService';
import { fetchHybridData, generateHybridPromptInjection } from '../../services/analysis/HybridIntelligenceService';
import { buildTradeChatContext, TRADE_CHAT_SYSTEM_PROMPT } from '../../services/trade/tradeChatContext';
import { getFirstReadyProvider, isProviderReady } from '../../utils/providerUtils';
import { TASK_BUDGETS } from '../../services/providers/taskBudgets';
import { effortForTask } from '../../services/providers/reasoningControls';
import ModelPicker from '../shared/ModelPicker';
import { SendIcon, StopIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';

interface ChatEntry {
    id: string;
    role: 'user' | 'ai';
    text: string;
    tools: string[];
    streaming?: boolean;
}

interface TradeChatPanelProps {
    symbol: string;
    interval: string;
    providers: ProviderConfig[];
    selectedChatModel: string;
    onSelectChatModel: (modelId: string) => void;
}

const TRADE_TOOLS = [
    'get_price_snapshot', 'get_order_book', 'get_derivatives',
    'get_liquidations', 'get_session_context', 'web_search',
];

const QUICK_PROMPTS = ['Read this chart', 'Key levels?', 'What is the bias?', 'Order-flow pressure?'];

const TradeChatPanel: React.FC<TradeChatPanelProps> = ({ symbol, interval, providers, selectedChatModel, onSelectChatModel }) => {
    const [entries, setEntries] = useState<ChatEntry[]>([]);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [contextAt, setContextAt] = useState<number | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    const provider = useMemo(() =>
        providers.find(c => isProviderReady(c) && (c.selectedModel === selectedChatModel || c.models.includes(selectedChatModel)))
        ?? getFirstReadyProvider(providers),
    [providers, selectedChatModel]);

    // Follow the bottom while the answer streams.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [entries]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const send = useCallback(async (raw: string): Promise<void> => {
        const text = raw.trim();
        if (!text || busy) return;
        if (!provider) return;
        setDraft('');
        const userEntry: ChatEntry = { id: `u-${Date.now()}`, role: 'user', text, tools: [] };
        const aiEntry: ChatEntry = { id: `a-${Date.now()}`, role: 'ai', text: '', tools: [], streaming: true };
        const history = entries;
        setEntries(prev => [...prev, userEntry, aiEntry]);
        setBusy(true);
        const controller = new AbortController();
        abortRef.current = controller;

        // The model "sees the chart": a fresh code-calculated packet fetched
        // NOW, attached to this turn only (history stays lean).
        let contextBlock: string;
        try {
            const packet = await fetchHybridData(symbol);
            const markdown = generateHybridPromptInjection(packet, { compact: true });
            contextBlock = buildTradeChatContext({ symbol, interval, packetMarkdown: markdown, fetchedAtMs: Date.now() });
            setContextAt(Date.now());
        } catch {
            contextBlock = buildTradeChatContext({ symbol, interval, packetMarkdown: '', fetchedAtMs: Date.now() });
        }

        const messages: ChatMessage[] = [
            { role: 'system', content: TRADE_CHAT_SYSTEM_PROMPT },
            ...history.slice(-10).flatMap(e =>
                e.text.trim() ? [{ role: e.role === 'user' ? 'user' : 'assistant', content: e.text } as ChatMessage] : []),
            { role: 'user', content: `${contextBlock}\n\n${text}` },
        ];

        const patch = (fn: (e: ChatEntry) => ChatEntry): void => {
            setEntries(prev => prev.map(e => (e.id === aiEntry.id ? fn(e) : e)));
        };
        try {
            const stream = streamChatWithDeskTools(
                { ...provider, selectedModel: provider.selectedModel === selectedChatModel ? provider.selectedModel : (provider.models.includes(selectedChatModel) ? selectedChatModel : provider.selectedModel) },
                messages,
                {
                    defaultSymbol: symbol,
                    allowedTools: TRADE_TOOLS,
                    signal: controller.signal,
                    maxTokens: TASK_BUDGETS.chat,
                    temperature: 0.4,
                    reasoningEffort: effortForTask('chat'),
                    onToolEvent: (line: string) => patch(e => ({ ...e, tools: [...e.tools, line] })),
                },
            );
            for await (const delta of stream) {
                if (controller.signal.aborted) break;
                patch(e => ({ ...e, text: e.text + delta }));
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            patch(entry => ({ ...entry, text: entry.text || `The chart copilot could not answer: ${message}` }));
        } finally {
            patch(e => ({ ...e, streaming: false }));
            setBusy(false);
            abortRef.current = null;
        }
    }, [busy, entries, interval, provider, symbol]);

    const ready = !!provider;

    return (
        <div className="flex h-full min-h-0 flex-col border-l border-white/[0.06] bg-zinc-900/40" data-testid="trade-chat-panel">
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'animate-pulse bg-cyan-400' : 'bg-emerald-500'}`} aria-hidden />
                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-300">Chart AI</span>
                <span className="truncate font-mono text-[10px] text-zinc-600" title={contextAt ? `Live packet fetched ${new Date(contextAt).toISOString()}` : 'No packet yet'}>
                    {contextAt ? `ctx ${new Date(contextAt).toLocaleTimeString()}` : `${symbol} · ${interval}`}
                </span>
                <div className="ml-auto">
                    <ModelPicker providers={providers} value={selectedChatModel} onChange={onSelectChatModel} mode="model-only" />
                </div>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto custom-scrollbar px-3 py-3">
                {entries.length === 0 && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
                        <p className="text-[11px] leading-5 text-zinc-500">
                            The model sees this chart live — a fresh code-calculated market packet rides every message, and it can pull the book, funding and liquidations itself.
                        </p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                            {QUICK_PROMPTS.map(q => (
                                <button key={q} type="button" disabled={!ready} onClick={() => void send(q)}
                                    className="rounded-full border border-white/[0.07] bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-white/15 hover:text-zinc-100 disabled:opacity-40">
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {entries.map(e => (
                    <div key={e.id} className={e.role === 'user' ? 'flex justify-end' : ''}>
                        {e.role === 'user' ? (
                            <p className="max-w-[85%] rounded-bubble bg-zinc-800 px-3 py-2 text-[12px] leading-5 text-zinc-100">{e.text}</p>
                        ) : (
                            <div className="space-y-1">
                                {e.tools.length > 0 && (
                                    <ul className="space-y-0.5">
                                        {e.tools.map((t, i) => (
                                            <li key={i} className="font-mono text-[10px] text-zinc-600">▸ {t}</li>
                                        ))}
                                    </ul>
                                )}
                                <div className="text-[12px] leading-5 text-zinc-200">
                                    {e.text
                                        ? <MarkdownContent content={e.text} className="!text-[12px] [&_p]:my-1 [&_li]:text-[12px]" />
                                        : e.streaming ? <span className="text-zinc-500">thinking…</span> : null}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="shrink-0 border-t border-white/[0.06] p-2">
                <div className="flex items-end gap-2 rounded-xl border border-white/[0.07] bg-zinc-800 px-2 py-1.5">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={draft}
                        disabled={!ready}
                        onChange={ev => setDraft(ev.target.value)}
                        onKeyDown={ev => {
                            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void send(draft); }
                        }}
                        placeholder={ready ? `Ask about ${symbol}…` : 'Configure a provider in Settings first'}
                        className="max-h-28 min-h-[24px] flex-1 resize-none bg-transparent text-[12px] leading-5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={() => (busy ? abortRef.current?.abort() : void send(draft))}
                        disabled={!ready && !busy}
                        aria-label={busy ? 'Stop' : 'Send'}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-900 transition-colors hover:bg-white disabled:opacity-40"
                    >
                        {busy ? <StopIcon className="h-3 w-3" fill="currentColor" /> : <SendIcon className="h-3.5 w-3.5" />}
                    </button>
                </div>
                <p className="mt-1.5 px-1 text-center text-[9px] uppercase tracking-wider text-zinc-700">
                    August may make mistakes · analysis, not financial advice
                </p>
            </div>
        </div>
    );
};

export default React.memo(TradeChatPanel);
