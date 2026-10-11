/**
 * ChatComposer — the dock's composer, extracted from TradeChatPanel.
 * Props-only: the draft, the effort choice and the two popover menus are
 * the SHELL's state (they keep their lifetime across session switches, as
 * before) — only their setters ride in as props. The model selector, the
 * + attach button (files + images + chart screenshot), the scan→skills
 * chip, Full analysis and the thinking-effort toggle all behave exactly as
 * they did inline; the send button doubles as Stop while a run is live.
 */

import React, { useState } from 'react';
import {Camera, Check, ChevronDown, FileText, Plus, StarIcon, TriangleAlert, SendIcon, StopIcon} from '../../shared/Icons';
import type { ProviderConfig } from '../../../types/provider';
import type { Attachment } from '../../../hooks/useChatAttachments';
import type { ReasoningEffort } from '../../../services/providers/reasoningControls';
import { formatModelDisplayName, isFreeModelId, isProviderReady } from '../../../utils/providerUtils';
import { DISCLAIMER_SHORT } from '../../../constants/disclaimer';

import ChatAttachmentStrip from './ChatAttachmentStrip';
import ComposerWorkspaceRow from './ComposerWorkspaceRow';
import * as chatStore from '../../../services/trade/chatStore';

/** Composer chip + the empty-state "Scan chart → skills" prompt: the model
 *  reads the WHOLE tape via the scan_chart_skills desk tool and drafts skills
 *  that wait for approval in the Inbox. Exported because the shell's
 *  screener-prefill listener drops the same prompt into the draft. */
export const SCAN_SKILLS_PROMPT = 'Scan the full candle history of this chart with scan_chart_skills: study how the price actually moved (regimes, swings, gaps) and which entries have historically worked, then draft your best IF/THEN skill candidates from what the tape proves. Tell me what you found and what is waiting in the Inbox.';

/** Thinking-budget levels. The words are the whole readout: `auto` is not a
 *  budget but "pick per task", so it stays a peer of the tiers, not a bar
 *  count between Off and Low. */
const EFFORT_CHOICES: { id: ReasoningEffort | 'auto'; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'auto', label: 'Auto' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'max', label: 'Max' },
];

/** The trigger and the open menu show the same read for the same id — one
 *  lookup keeps them from drifting. */
const effortChoiceOf = (id: ReasoningEffort | 'auto'): typeof EFFORT_CHOICES[number] =>
    EFFORT_CHOICES.find(c => c.id === id) ?? EFFORT_CHOICES[1];

interface ChatComposerProps {
    /** The chart the chat talks about (workspace row + model picker). */
    symbol: string;
    interval: string;
    isPanel: boolean;
    /** A send needs a ready provider (panels: at least 2 seats). */
    ready: boolean;
    /** A run is live — the send button is a Stop. */
    busy: boolean;
    draft: string;
    setDraft: React.Dispatch<React.SetStateAction<string>>;
    /** The runner's send — Enter, the scan chip and the send button. */
    send: (raw: string, retryOf?: string) => Promise<void>;
    runFullAnalysis: () => Promise<void>;
    /** Absent ⇒ the Full-analysis option is hidden (no pipeline attached). */
    onRunAnalysis?: (prompt: string, images: Array<{ name: string; dataURL: string }>) =>
        Promise<string | { text: string; messageId?: string }>;
    effort: ReasoningEffort | 'auto';
    /** Persists the choice to the session store AND the shell state. */
    changeEffort: (next: ReasoningEffort | 'auto') => void;
    showEffortMenu: boolean;
    setShowEffortMenu: React.Dispatch<React.SetStateAction<boolean>>;
    /** Visible explanation when the stored model pick went stale. */
    modelIssue: string | null;
    provider: ProviderConfig | null;
    selectedChatModel: string;
    /** Keeps the app-wide default AND binds the active session. */
    changeSoloModel: (value: string) => void;
    providers: ProviderConfig[];
    onRefreshModels?: () => Promise<void>;
    attachments: Attachment[];
    removeAttachment: (id: string) => void;
    fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
    attachFiles: (files: FileList | null) => void;
    showAttachMenu: boolean;
    setShowAttachMenu: React.Dispatch<React.SetStateAction<boolean>>;
    /** Captures the chart as the one image that never came off the picker. */
    captureChart: () => void;
    onCaptureChart?: () => string | null;
    /** So a "Try in chat" skill chip can drop its /slug in and refocus. */
    composerRef: React.RefObject<HTMLTextAreaElement | null>;
    /** Workspace-row readouts (panel seats + picker state). */
    panelCount: number;
    pickerOpen: boolean;
    onTogglePicker: () => void;
    botName: string | null;
    contextAt: number | null;
}

/**
 * The amber "your pick is not answering" banner. Exported because the Chat
 * surface composer is a different component and must say the same thing in the
 * same words when the same stored model goes stale — one surface warning and
 * one silently answering from another model is the bug this splits.
 */
export const ModelFallbackBanner: React.FC<{
    modelIssue: string | null;
    provider: ProviderConfig | null;
}> = ({ modelIssue, provider }) => (
    modelIssue && provider ? (
        <div className="mb-1.5 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-ui-dense leading-4 text-amber-300" data-testid="model-fallback-warning" role="status">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
                {modelIssue} Answering with <strong className="font-semibold">{provider.name} · {formatModelDisplayName(provider.selectedModel)}</strong> — re-pick a model in the dropdown.
            </span>
        </div>
    ) : null
);

const ChatComposer: React.FC<ChatComposerProps> = ({
    symbol, interval, isPanel, ready, busy, draft, setDraft, send, runFullAnalysis, onRunAnalysis,
    effort, changeEffort, showEffortMenu, setShowEffortMenu, modelIssue, provider, selectedChatModel,
    changeSoloModel, providers, onRefreshModels, attachments, removeAttachment, fileInputRef,
    attachFiles, showAttachMenu, setShowAttachMenu, captureChart, onCaptureChart, composerRef,
    panelCount, pickerOpen, onTogglePicker, botName, contextAt,
}) => {
    // The ONE chip under the card: model + effort as a single quiet control
    // (the reference's "Sonnet 5.5 · High"). The model section inherits
    // ModelPicker's CONTRACT, not its flyout: only ready providers (the
    // shared isProviderReady predicate), grouped per provider, searchable,
    // and a list that SCROLLS instead of overflowing the viewport.
    const [modelQuery, setModelQuery] = useState('');
    const [showModelMenu, setShowModelMenu] = useState(false);
    // Starred models — the harness picker's favorites. Persisted raw in
    // localStorage (a tiny per-browser preference, not user data).
    const [starred, setStarred] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem('august_starred_models_v1') ?? '[]') as string[]; }
        catch { return []; }
    });
    const toggleStar = (value: string): void => {
        setStarred(prev => {
            const next = prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value];
            try { localStorage.setItem('august_starred_models_v1', JSON.stringify(next)); }
            catch { /* private mode — stars just do not persist */ }
            return next;
        });
    };
    const readyProviders = providers.filter(isProviderReady);
    const q = modelQuery.trim().toLowerCase();
    const modelSections = readyProviders
        .map(p => ({
            provider: p,
            models: p.models
                .filter(m => !q || m.toLowerCase().includes(q))
                .map(m => ({ value: `${p.id}::${m}`, label: formatModelDisplayName(m), free: isFreeModelId(m) }))
                .sort((a, b) => Number(starred.includes(b.value)) - Number(starred.includes(a.value))),
        }))
        .filter(s => s.models.length > 0);
    const readyModelCount = readyProviders.reduce((n, p) => n + p.models.length, 0);
    const selectedModelLabel = readyProviders
        .flatMap(p => p.models.map(m => ({ v: `${p.id}::${m}`, label: `${p.name} · ${formatModelDisplayName(m)}` })))
        .find(o => o.v === selectedChatModel)?.label
        ?? provider?.name ?? 'Select model';
    return (
    <div className="shrink-0 px-3 pb-3 pt-1">
        <ModelFallbackBanner modelIssue={modelIssue} provider={provider} />
        <ComposerWorkspaceRow
            symbol={symbol}
            interval={interval}
            isPanel={isPanel}
            panelCount={panelCount}
            pickerOpen={pickerOpen}
            onTogglePicker={onTogglePicker}
            botName={botName}
            contextAt={contextAt}
        />
        {attachments.length > 0 && (
            <ChatAttachmentStrip
                attachments={attachments}
                onRemove={removeAttachment}
            />
        )}
        <div className="rounded-2xl border border-white/[0.08] bg-surface-raised px-3 py-2.5">
            <textarea
                ref={composerRef}
                data-testid="composer-input"
                rows={1}
                value={draft}
                disabled={!ready}
                onChange={ev => setDraft(ev.target.value)}
                onKeyDown={ev => {
                    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void send(draft); }
                }}
                placeholder={ready ? 'Ask anything…' : isPanel ? 'Add at least 2 panel models above' : 'Configure a provider in Settings first'}
                className="max-h-28 min-h-[24px] w-full resize-none bg-transparent text-ui-caption leading-5 text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {/* `flex-wrap` + nowrap chips: the toolbar was ALWAYS over-
                    tight at the dock's 384px default — before, that showed up
                    as a chip breaking across two lines ("Scan —/skills"), and
                    once the chips were nowrap it showed up as 6px of page
                    overflow (render-probe caught it). Wrapping BETWEEN chips is
                    the honest middle: a label stays whole, and nothing overflows. */}
                <input type="file" multiple accept="image/*,.md,.txt,.csv,.json" ref={fileInputRef} className="hidden"
                    onChange={ev => { attachFiles(ev.target.files); ev.target.value = ''; }} />
                {/* Reference layout: ONE + button opens everything that
                    can ride the message — uploads AND the chart shot. */}
                <div className="relative">
                    <button type="button" onClick={() => setShowAttachMenu(v => !v)} disabled={!ready}
                        title="Attach to this message" aria-label="Attach to this message" aria-expanded={showAttachMenu}
                        className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-40">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {showAttachMenu && (
                        <>
                            <div className="fixed inset-0 z-20" aria-hidden onClick={() => setShowAttachMenu(false)} />
                            <div className="absolute bottom-9 left-0 z-30 w-48 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl" data-testid="attach-menu">
                                <button type="button" onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                                    <FileText className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" /> Upload files &amp; images
                                </button>
                                <button type="button" onClick={() => { setShowAttachMenu(false); captureChart(); }}
                                    disabled={!onCaptureChart} title={onCaptureChart ? undefined : 'Chart not ready'}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40">
                                    <Camera className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" /> Screenshot chart
                                </button>
                            </div>
                        </>
                    )}
                </div>
                {/* Always-available growth chip: study the whole tape
                    and draft skills (they wait for approval in the
                    Inbox). Kept out of the + menu so the action is
                    discoverable, like Full analysis. */}
                <button type="button" onClick={() => void send(SCAN_SKILLS_PROMPT)} disabled={!ready || busy}
                    title="Study every candle in this chart and draft IF/THEN skills from what actually worked — drafts wait for your approval in the Inbox"
                    className="shrink-0 whitespace-nowrap rounded-full border border-white/[0.07] px-2 py-1 text-ui-xs font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 disabled:opacity-40">
                Scan → skills
                </button>
                {onRunAnalysis && draft.trim() && !isPanel && (
                    <button type="button" onClick={() => void runFullAnalysis()} disabled={busy}
                        title="Run the full ensemble analysis (hybrid data + debate + verdict) on this request"
                        className="shrink-0 whitespace-nowrap rounded-full border border-white/[0.07] px-2 py-1 text-ui-xs font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 disabled:opacity-40">
                    Full analysis
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => (busy ? chatStore.abortActive() : void send(draft))}
                    disabled={!ready && !busy}
                    aria-label={busy ? 'Stop' : 'Send'}
                    /* ml-auto: right-aligned in the toolbar row AND on its own
                       row when the narrow dock wraps — the reference keeps the
                       send at the composer's bottom-right, never bottom-left. */
                    className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-900 transition-colors hover:bg-white disabled:opacity-40"
                >
                    {busy ? <StopIcon className="h-3 w-3" fill="currentColor" /> : <SendIcon className="h-4 w-4" aria-hidden="true" />}
                </button>
            </div>
        </div>
        {/* The reference footer, harness-style: model chip + effort chip on
            one row under the card's right edge, the disclaimer on its own
            line below. The model popover carries the picker's contract —
            ready providers only, grouped, searchable, star-able — and both
            popovers scroll or fit, never overflow. */}
        <div className="mt-1.5 flex items-center justify-end gap-1.5 px-2">
            {!isPanel && (
                <div className="relative">
                    <button type="button" onClick={() => { setShowModelMenu(v => !v); setShowEffortMenu(false); }}
                        aria-label={`Model: ${selectedModelLabel}`}
                        aria-expanded={showModelMenu} aria-haspopup="menu"
                        title={modelIssue ? 'Model fallback active — re-pick a model' : 'Model'}
                        data-testid="composer-model-chip"
                        className="flex max-w-[13rem] items-center gap-1.5 rounded-full border border-white/[0.08] bg-zinc-900/60 px-2.5 py-1 text-ui-dense text-zinc-400 transition-colors hover:border-white/[0.16] hover:text-zinc-200">
                        <span className="min-w-0 truncate" title={selectedModelLabel}>{selectedModelLabel}</span>
                        <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ease-[var(--ease-snappy)] ${showModelMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showModelMenu && (
                        <>
                            {/* The invisible-backdrop close the attach menu
                                already uses: a popover you can leave only by
                                picking an item is a trap. */}
                            <div className="fixed inset-0 z-20" aria-hidden onClick={() => { setShowModelMenu(false); setModelQuery(''); }} />
                            <div
                                className="absolute bottom-8 right-0 z-30 w-64 rounded-xl border border-white/10 bg-zinc-900 shadow-xl"
                                data-testid="composer-model-menu"
                                role="menu"
                                aria-label="Model"
                                onKeyDown={(e) => {
                                    // Contain Escape: unhandled, it bubbles to
                                    // the app-level shortcut that CANCELS a
                                    // running analysis (App.tsx) while merely
                                    // closing this menu.
                                    e.stopPropagation();
                                    if (e.key === 'Escape') setShowModelMenu(false);
                                }}
                            >
                                {readyModelCount > 7 && (
                                    <div className="p-2 pb-1">
                                        <input
                                            value={modelQuery}
                                            onChange={ev => setModelQuery(ev.target.value)}
                                            onKeyDown={e => {
                                                // stopPropagation keeps composer/app
                                                // shortcuts from firing while typing;
                                                // Escape must still close — handled
                                                // HERE, or the input swallows it and
                                                // the open menu blocks the dock.
                                                e.stopPropagation();
                                                if (e.key === 'Escape') {
                                                    setShowModelMenu(false);
                                                    setModelQuery('');
                                                }
                                            }}
                                            placeholder="Search models…"
                                            aria-label="Search models"
                                            className="w-full rounded-control border border-white/10 bg-zinc-800/60 px-2 py-1 text-ui-dense text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                                        />
                                    </div>
                                )}
                                <div className="custom-scrollbar max-h-[min(45vh,20rem)] overflow-y-auto px-1 pb-1">
                                    {modelSections.map(section => (
                                        <div key={section.provider.id}>
                                            <p className="sticky top-0 z-10 bg-zinc-900 px-2 pb-1 pt-2 text-ui-2xs uppercase tracking-widest text-zinc-600">{section.provider.name}</p>
                                            {section.models.map(o => (
                                                <div key={o.value} className={`flex items-center gap-1 rounded-lg pr-1.5 transition-colors hover:bg-white/[0.06] ${o.value === selectedChatModel ? 'bg-white/[0.04]' : ''}`}>
                                                    <button type="button"
                                                        onClick={() => toggleStar(o.value)}
                                                        aria-label={starred.includes(o.value) ? `Unstar ${o.label}` : `Star ${o.label}`}
                                                        aria-pressed={starred.includes(o.value)}
                                                        title={starred.includes(o.value) ? 'Unstar' : 'Star'}
                                                        className={`shrink-0 rounded-full p-1 transition-colors hover:text-amber-300 ${starred.includes(o.value) ? 'text-amber-300' : 'text-zinc-600'}`}>
                                                        <StarIcon className="h-3 w-3" fill={starred.includes(o.value) ? 'currentColor' : 'none'} aria-hidden="true" />
                                                    </button>
                                                    <button type="button"
                                                        role="menuitemradio"
                                                        aria-checked={o.value === selectedChatModel}
                                                        onClick={() => { changeSoloModel(o.value); setShowModelMenu(false); setModelQuery(''); }}
                                                        title={o.label}
                                                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-1 text-left text-ui-dense transition-colors hover:bg-white/[0.04]">
                                                        <Check className={`h-3 w-3 shrink-0 ${o.value === selectedChatModel ? 'text-emerald-400' : 'opacity-0'}`} aria-hidden="true" />
                                                        <span className="min-w-0 truncate" title={o.label}>{o.label}</span>
                                                    </button>
                                                    {o.free && (
                                                        <span className="shrink-0 rounded-full border border-emerald-500/30 px-1.5 py-px text-ui-2xs uppercase tracking-wider text-emerald-400">free</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                    {modelSections.length === 0 && (
                                        <p className="px-2 py-3 text-ui-dense text-zinc-600">No models match “{modelQuery}”.</p>
                                    )}
                                    {onRefreshModels && (
                                        <button type="button" role="menuitem"
                                            onClick={() => { void onRefreshModels(); setShowModelMenu(false); }}
                                            className="mt-1 block w-full rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200">
                                            Refresh model list
                                        </button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
            {!isPanel && (
                <div className="relative">
                    <button type="button" onClick={() => { setShowEffortMenu(v => !v); setShowModelMenu(false); }}
                        aria-label={`Thinking effort: ${effortChoiceOf(effort).label}`}
                        aria-expanded={showEffortMenu} aria-haspopup="menu"
                        title={`Thinking effort: ${effortChoiceOf(effort).label}`}
                        data-testid="composer-effort-chip"
                        className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-zinc-900/60 px-2.5 py-1 text-ui-dense text-zinc-400 transition-colors hover:border-white/[0.16] hover:text-zinc-200">
                        <span className="whitespace-nowrap">{effortChoiceOf(effort).label}</span>
                        <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ease-[var(--ease-snappy)] ${showEffortMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showEffortMenu && (
                        <>
                            <div className="fixed inset-0 z-20" aria-hidden onClick={() => setShowEffortMenu(false)} />
                            <div
                                className="absolute bottom-8 right-0 z-30 w-40 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl"
                                data-testid="effort-menu"
                                role="menu"
                                aria-label="Thinking effort"
                                onKeyDown={(e) => {
                                    // Same containment as the model menu —
                                    // Escape here must not cancel a run.
                                    e.stopPropagation();
                                    if (e.key === 'Escape') setShowEffortMenu(false);
                                }}
                            >
                                {EFFORT_CHOICES.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={effort === c.id}
                                        autoFocus={effort === c.id}
                                        onClick={() => { changeEffort(c.id); setShowEffortMenu(false); }}
                                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-dense transition-colors hover:bg-white/[0.06] ${effort === c.id ? 'text-zinc-100' : 'text-zinc-500'}`}
                                    >
                                        <Check className={`h-3 w-3 shrink-0 ${effort === c.id ? 'text-emerald-400' : 'opacity-0'}`} aria-hidden="true" />
                                        {c.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
        <p className="mt-1.5 px-2 text-ui-xs text-zinc-600">
            {DISCLAIMER_SHORT}
        </p>
    </div>
    );
};

export default React.memo(ChatComposer);
