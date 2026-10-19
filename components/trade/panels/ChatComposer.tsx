/**
 * ChatComposer — the dock's composer, extracted from TradeChatPanel.
 * Props-only: the draft and the attach menu are the SHELL's state (they keep
 * their lifetime across session switches, as before) — only their setters ride
 * in as props. The model selector and the thinking-effort dial are shared
 * controls (components/shared/ModelChip, EffortChip) that own their own open
 * state, so this file passes a value and a writer and nothing else. The +
 * attach button (files + images + chart screenshot), the scan→skills chip and
 * Full analysis behave exactly as they did inline; the send button doubles as
 * Stop while a run is live.
 */

import React from 'react';
import {Camera, FileText, Plus, TriangleAlert, SendIcon, StopIcon} from '../../shared/Icons';
import type { ProviderConfig } from '../../../types/provider';
import type { Attachment } from '../../../hooks/useChatAttachments';
import type { ReasoningEffort } from '../../../services/providers/reasoningControls';
import { formatModelDisplayName } from '../../../utils/providerUtils';
import { DISCLAIMER_SHORT } from '../../../constants/disclaimer';

import EffortChip from '../../shared/EffortChip';
import ModelChip from '../../shared/ModelChip';
import ChatAttachmentStrip from './ChatAttachmentStrip';
import ComposerWorkspaceRow from './ComposerWorkspaceRow';
import * as chatStore from '../../../services/trade/chatStore';

/** Composer chip + the empty-state "Scan chart → skills" prompt: the model
 *  reads the WHOLE tape via the scan_chart_skills desk tool and drafts skills
 *  that wait for approval in the Inbox. Exported because the shell's
 *  screener-prefill listener drops the same prompt into the draft. */
export const SCAN_SKILLS_PROMPT = 'Scan the full candle history of this chart with scan_chart_skills: study how the price actually moved (regimes, swings, gaps) and which entries have historically worked, then draft your best IF/THEN skill candidates from what the tape proves. Tell me what you found and what is waiting in the Inbox.';

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
    /** Absent ⇒ the Full-analysis option is hidden (no pipeline attached). The
     *  button itself calls `runFullAnalysis`; this is read only for whether a
     *  pipeline exists at all. */
    onRunAnalysis?: (prompt: string, images: Array<{ name: string; dataURL: string }>) => Promise<void>;
    /** Stop the running pipeline as well as the chat turn. Aborting ONLY the
     *  chat controller (what this button used to do) left a Full analysis
     *  streaming — and spending — under a bubble that said it had stopped,
     *  because the pipeline never reads that controller. Absent ⇒ Stop keeps
     *  its old chat-only meaning. */
    onStopRun?: () => void;
    effort: ReasoningEffort;
    /** Writes the tier onto the active chat session — the row the Chat surface
     *  renders too, so one pick is both homes' pick. */
    changeEffort: (next: ReasoningEffort) => void;
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
        <div className="mb-1.5 flex items-start gap-1.5 rounded-control border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-ui-dense leading-4 text-amber-300" data-testid="model-fallback-warning" role="status">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
                {modelIssue} Answering with <strong className="font-semibold">{provider.name} · {formatModelDisplayName(provider.selectedModel)}</strong> — re-pick a model in the dropdown.
            </span>
        </div>
    ) : null
);

const ChatComposer: React.FC<ChatComposerProps> = ({
    symbol, interval, isPanel, ready, busy, draft, setDraft, send, runFullAnalysis, onRunAnalysis, onStopRun,
    effort, changeEffort, modelIssue, provider, selectedChatModel,
    changeSoloModel, providers, onRefreshModels, attachments, removeAttachment, fileInputRef,
    attachFiles, showAttachMenu, setShowAttachMenu, captureChart, onCaptureChart, composerRef,
    panelCount, pickerOpen, onTogglePicker, botName, contextAt,
}) => {
    // The model chip is the shared ModelChip (components/shared/ModelChip.tsx) —
    // the same control the Chat surface now renders, so the menu contract
    // (ready providers only, grouped, searchable, starred first) is owned once.
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
        <div className="rounded-bubble border border-white/[0.08] bg-surface-raised px-3 py-2.5">
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
                            <div className="absolute bottom-9 left-0 z-30 w-48 rounded-bubble border border-white/10 bg-zinc-900 p-1 shadow-xl" data-testid="attach-menu">
                                <button type="button" onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                                    className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                                    <FileText className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" /> Upload files &amp; images
                                </button>
                                <button type="button" onClick={() => { setShowAttachMenu(false); captureChart(); }}
                                    disabled={!onCaptureChart} title={onCaptureChart ? undefined : 'Chart not ready'}
                                    className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-ui-dense text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40">
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
                        title="Run the full analysis (live market data + tools + trade plan) on this request"
                        className="shrink-0 whitespace-nowrap rounded-full border border-white/[0.07] px-2 py-1 text-ui-xs font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 disabled:opacity-40">
                    Full analysis
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => {
                        if (!busy) { void send(draft); return; }
                        // Both, and in this order: the chat controller settles
                        // the bubble as a deliberate stop, the pipeline cancel
                        // actually ends the run. Either alone leaves half the
                        // job done — that is the defect this order fixes.
                        onStopRun?.();
                        chatStore.abortActive();
                    }}
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
            line below. Both chips are the shared controls the Chat surface
            renders too, so neither home can have a dial the other lacks. */}
        <div className="mt-1.5 flex items-center justify-end gap-1.5 px-2">
            {!isPanel && (
                <ModelChip providers={providers} value={selectedChatModel} onChange={changeSoloModel}
                    onRefreshModels={onRefreshModels} issue={modelIssue} fallbackLabel={provider?.name} />
            )}
            {!isPanel && <EffortChip value={effort} onChange={changeEffort} />}
        </div>
        <p className="mt-1.5 px-2 text-ui-xs text-zinc-600">
            {DISCLAIMER_SHORT}
        </p>
    </div>
    );
};

export default React.memo(ChatComposer);
