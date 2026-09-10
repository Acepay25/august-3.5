/**
 * TradeChatPanel — Minara's right-hand AI column, August's honest version:
 * a chat docked beside the chart where EVERY message carries a freshly
 * fetched, code-calculated market packet (the chart in words — candles
 * state, indicators, funding, OI, book walls, liquidations, session) and the
 * model can pull even newer data itself through the desk tools — including
 * get_market_packet (the full hybrid pull) and get_chart_view (exactly what
 * the user is looking at: timeframe, last 60 candles, live mark, drawn
 * verdict levels). No order execution — this is the copilot read of the
 * tape, not a trade button.
 *
 * The panel supports parallel chat sessions (new / switch / delete) that
 * persist per user via services/trade/chatSessions; capped, validated, and
 * only committed to storage once the in-flight stream settles.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProviderConfig } from '../../types/provider';
import { ChatMessage } from '../../services/providers/GenericProviderService';
import { streamChatWithDeskTools } from '../../services/analysis/DeskToolsService';
import { fetchHybridData, generateHybridPromptInjection } from '../../services/analysis/HybridIntelligenceService';
import { buildTradeChatContext, TRADE_CHAT_SYSTEM_PROMPT } from '../../services/trade/tradeChatContext';
import {
    ChatSession, StoredChatEntry, createSession, loadSessions, saveSessions, titleFromMessage,
} from '../../services/trade/chatSessions';
import { getFirstReadyProvider, isProviderReady } from '../../utils/providerUtils';
import { TASK_BUDGETS } from '../../services/providers/taskBudgets';
import { effortForTask } from '../../services/providers/reasoningControls';
import ModelPicker from '../shared/ModelPicker';
import { SendIcon, StopIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';

/** Stored shape + the non-persisted streaming flag for the in-flight answer. */
type LiveEntry = StoredChatEntry & { streaming?: boolean };
type LiveSession = Omit<ChatSession, 'entries'> & { entries: LiveEntry[] };

interface TradeChatPanelProps {
    symbol: string;
    interval: string;
    providers: ProviderConfig[];
    selectedChatModel: string;
    onSelectChatModel: (modelId: string) => void;
    /** Websocket feed status label for the header hint only — the panel's
     *  context packet is fetched fresh per send regardless. */
    live?: boolean;
    /** Levels currently drawn on the chart (Entry/SL/TP) — forwarded to the
     *  desk tools so get_chart_view can report what the user sees. */
    chartLevels?: { label: string; price: number }[];
}

const TRADE_TOOLS = [
    'get_price_snapshot', 'get_order_book', 'get_derivatives',
    'get_liquidations', 'get_session_context', 'get_market_packet', 'get_chart_view',
    'web_search',
];

const QUICK_PROMPTS = ['Read this chart', 'Key levels?', 'What is the bias?', 'Order-flow pressure?'];

const TradeChatPanel: React.FC<TradeChatPanelProps> = ({ symbol, interval, providers, selectedChatModel, onSelectChatModel, live = false, chartLevels }) => {
    const [sessions, setSessions] = useState<LiveSession[]>(() => {
        const loaded = loadSessions();
        return loaded.length > 0 ? loaded : [createSession()];
    });
    const [activeId, setActiveId] = useState<string>(() => sessions[0].id);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [contextAt, setContextAt] = useState<number | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0];
    const entries = activeSession.entries;

    const provider = useMemo(() =>
        providers.find(c => isProviderReady(c) && (c.selectedModel === selectedChatModel || c.models.includes(selectedChatModel)))
        ?? getFirstReadyProvider(providers),
    [providers, selectedChatModel]);

    // Persist once streams settle (not per token), debounced. Streaming flags
    // are stripped so a half-finished answer never reaches storage.
    useEffect(() => {
        if (sessions.some(s => s.entries.some(e => e.streaming))) return;
        const id = window.setTimeout(() => saveSessions(sessions.map(s => ({
            ...s,
            entries: s.entries.map(({ streaming: _streaming, ...stored }) => stored),
        }))), 400);
        return () => window.clearTimeout(id);
    }, [sessions]);

    // Follow the bottom while the answer streams.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [entries]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const mutate = (id: string, fn: (s: LiveSession) => LiveSession): void => {
        setSessions(prev => prev.map(s => (s.id === id ? fn(s) : s)));
    };

    const send = useCallback(async (raw: string): Promise<void> => {
        const text = raw.trim();
        if (!text || busy) return;
        if (!provider) return;
        setDraft('');
        const sid = activeId;
        const session = sessions.find(s => s.id === sid);
        const history = session?.entries ?? [];
        const userEntry: LiveEntry = { id: `u-${Date.now()}`, role: 'user', text, tools: [] };
        const aiEntry: LiveEntry = { id: `a-${Date.now()}`, role: 'ai', text: '', tools: [], streaming: true };
        mutate(sid, s => ({
            ...s,
            title: s.entries.some(e => e.role === 'user') ? s.title : titleFromMessage(text),
            updatedAt: Date.now(),
            entries: [...s.entries, userEntry, aiEntry],
        }));
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

        const patch = (fn: (e: LiveEntry) => LiveEntry): void => {
            mutate(sid, s => ({ ...s, updatedAt: Date.now(), entries: s.entries.map(e => (e.id === aiEntry.id ? fn(e) : e)) }));
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
                    chartInterval: interval,
                    chartLevels,
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
    }, [busy, chartLevels, activeId, interval, provider, sessions, symbol]);

    const addSession = useCallback((): void => {
        abortRef.current?.abort();
        const fresh = createSession();
        setSessions(prev => [...prev, fresh]);
        setActiveId(fresh.id);
    }, []);

    const switchTo = useCallback((id: string): void => {
        if (id === activeId) return;
        abortRef.current?.abort();
        setActiveId(id);
    }, [activeId]);

    const removeSession = useCallback((id: string): void => {
        abortRef.current?.abort();
        const next = sessions.filter(s => s.id !== id);
        if (next.length === 0) {
            const fresh = createSession();
            setSessions([fresh]);
            setActiveId(fresh.id);
            return;
        }
        setSessions(next);
        if (id === activeId) setActiveId(next[next.length - 1].id);
    }, [sessions, activeId]);

    const ready = !!provider;

    return (
        <div className="flex h-full min-h-0 flex-col border-l border-white/[0.06] bg-zinc-900/40" data-testid="trade-chat-panel">
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'animate-pulse bg-cyan-400' : live ? 'bg-emerald-500' : 'bg-zinc-500'}`} aria-label={live ? 'live market feed connected' : 'market feed polling'} />
                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-300">Chart AI</span>
                <span className="truncate font-mono text-[10px] text-zinc-600" title={contextAt ? `Live packet fetched ${new Date(contextAt).toISOString()}` : 'No packet yet'}>
                    {contextAt ? `ctx ${new Date(contextAt).toLocaleTimeString()}` : `${symbol} · ${interval}`}
                </span>
                <div className="ml-auto">
                    <ModelPicker providers={providers} value={selectedChatModel} onChange={onSelectChatModel} mode="model-only" />
                </div>
            </div>

            {/* Session tabs: parallel chats about the tape, persisted per user. */}
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] px-2 py-1" data-testid="chat-sessions">
                <button type="button" onClick={addSession} aria-label="New chat session"
                    className="shrink-0 rounded-full border border-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100">
                    + New
                </button>
                {sessions.map(s => (
                    <span key={s.id}
                        className={`group flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                            s.id === activeId ? 'border-white/15 bg-zinc-700 text-zinc-100' : 'border-white/[0.07] text-zinc-500 hover:text-zinc-200'
                        }`}>
                        <button type="button" onClick={() => switchTo(s.id)} className="max-w-[110px] truncate" title={s.title}>
                            {s.title}
                        </button>
                        {sessions.length > 1 && (
                            <button type="button" onClick={() => removeSession(s.id)} aria-label={`Delete session ${s.title}`}
                                className="px-0.5 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-400">
                                ×
                            </button>
                        )}
                    </span>
                ))}
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto custom-scrollbar px-3 py-3">
                {entries.length === 0 && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
                        <p className="text-[11px] leading-5 text-zinc-500">
                            The model sees this chart live — a fresh code-calculated market packet rides every message, and it can pull the book, funding, liquidations, the full hybrid packet or the exact candles on screen itself.
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
