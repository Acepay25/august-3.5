/**
 * ChatComposer — the dock's composer, extracted from TradeChatPanel.
 * Props-only: the draft, the effort choice and the two popover menus are
 * the SHELL's state (they keep their lifetime across session switches, as
 * before) — only their setters ride in as props. The model selector, the
 * + attach button (files + images + chart screenshot), the scan→skills
 * chip, Full analysis and the thinking-effort toggle all behave exactly as
 * they did inline; the send button doubles as Stop while a run is live.
 */

import React from 'react';
import {Brain, Camera, ChevronDown, FileText, Plus, TriangleAlert, SendIcon, StopIcon} from '../../shared/Icons';
import type { ProviderConfig } from '../../../types/provider';
import type { Attachment } from '../../../hooks/useChatAttachments';
import type { ReasoningEffort } from '../../../services/providers/reasoningControls';
import { formatModelDisplayName } from '../../../utils/providerUtils';
import { DISCLAIMER_SHORT } from '../../../constants/disclaimer';
import ModelPicker from '../../shared/ModelPicker';

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
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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
}) => (
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
                        <Plus className="h-4 w-4" />
                    </button>
                    {showAttachMenu && (
                        <>
                            <div className="fixed inset-0 z-20" aria-hidden onClick={() => setShowAttachMenu(false)} />
                            <div className="absolute bottom-9 left-0 z-30 w-48 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl" data-testid="attach-menu">
                                <button type="button" onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                                    <FileText className="h-3.5 w-3.5 text-zinc-500" /> Upload files &amp; images
                                </button>
                                <button type="button" onClick={() => { setShowAttachMenu(false); captureChart(); }}
                                    disabled={!onCaptureChart} title={onCaptureChart ? undefined : 'Chart not ready'}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40">
                                    <Camera className="h-3.5 w-3.5 text-zinc-500" /> Screenshot chart
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
                <div className="relative ml-auto flex items-center gap-1">
                    {!isPanel && (
                        <ModelPicker providers={providers} value={selectedChatModel} onChange={changeSoloModel} mode="provider-model" onRefreshModels={onRefreshModels} compact />
                    )}
                    <button type="button" onClick={() => setShowEffortMenu(v => !v)}
                        aria-label={`Thinking effort: ${effortChoiceOf(effort).label}`}
                        aria-expanded={showEffortMenu} aria-haspopup="menu"
                        title={`Thinking effort: ${effortChoiceOf(effort).label}`}
                        className="flex items-center gap-1.5 rounded-full border border-white/[0.07] px-2 py-1 text-ui-xs font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100">
                        <Brain className="h-3.5 w-3.5" />
                        {effortChoiceOf(effort).label}
                        <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-150 ease-[var(--ease-snappy)] ${showEffortMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showEffortMenu && (
                        <>
                            {/* The invisible-backdrop close the attach menu
                                already uses: a popover you can leave only by
                                picking an item is a trap. */}
                            <div className="fixed inset-0 z-20" aria-hidden onClick={() => setShowEffortMenu(false)} />
                            <div
                                className="absolute bottom-8 right-0 z-30 w-36 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl"
                                data-testid="effort-menu"
                                role="menu"
                                aria-label="Thinking effort"
                                onKeyDown={(e) => { if (e.key === 'Escape') setShowEffortMenu(false); }}
                            >
                                {EFFORT_CHOICES.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={effort === c.id}
                                        // Focus lands on the current choice — that
                                        // is what makes Escape and Tab reach the menu.
                                        autoFocus={effort === c.id}
                                        onClick={() => { changeEffort(c.id); setShowEffortMenu(false); }}
                                        className={`block w-full rounded-lg px-2 py-1.5 text-left text-ui-dense transition-colors hover:bg-white/[0.06] ${effort === c.id ? 'text-zinc-100' : 'text-zinc-500'}`}
                                    >
                                        {c.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => (busy ? chatStore.abortActive() : void send(draft))}
                    disabled={!ready && !busy}
                    aria-label={busy ? 'Stop' : 'Send'}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-900 transition-colors hover:bg-white disabled:opacity-40"
                >
                    {busy ? <StopIcon className="h-3 w-3" fill="currentColor" /> : <SendIcon className="h-4 w-4" />}
                </button>
            </div>
        </div>
        <p className="mt-2 px-2 text-ui-xs text-zinc-600">
            {DISCLAIMER_SHORT}
        </p>
    </div>
);

export default React.memo(ChatComposer);
