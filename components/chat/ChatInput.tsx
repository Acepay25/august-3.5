
import React, { useState } from 'react';
import ImagePreview from '../shared/ImagePreview';
import { PlusIcon, LoadingIcon, SendIcon, StopIcon, ChevronDownIcon, CheckIcon } from '../shared/Icons';
import { ImageMetadata, AnalystLensConfig, AnalystRole } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { EnsembleModelSelection, ANALYST_ROLE_DEFINITIONS, getLensPromptForRole } from '../../services/ui/AnalystLensService';
import { RegimeProviderStatsMap } from '../../services/learning/SetupMemoryService';
import { MASTER_ANALYSIS_PROMPT } from '../../constants/prompts';
import PromptEditorModal from '../settings/PromptEditorModal';
import TeamModal from './TeamModal';
import ModelPicker from '../shared/ModelPicker';
import InjectionContextBar, { InjectionChipKind } from './InjectionContextBar';

import { parseComposerIntent } from '../../utils/composerMentions';
import { DEBATE_TEMPLATES, debateTemplateMarker } from '../../utils/debateTemplates';
import { formatModelDisplayName } from '../../utils/providerUtils';
import { listSkillSlugs } from '../../services/learning/SkillMemoryService';

const LENS_ROSTER_ROLES: AnalystRole[] = [
    AnalystRole.MACRO_VOLATILITY,
    AnalystRole.TECHNICAL_ANALYST,
    AnalystRole.RISK_EXECUTION,
];

interface ChatInputProps {
    images: ImageMetadata[];
    removeImage: (index: number) => void;
    leverageRef: React.RefObject<HTMLDivElement | null>;
    setIsLeverageDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
    leverageInput: string;
    handleLeverageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleLeverageBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
    isLeverageDropdownOpen: boolean;
    handlePresetLeverage: (value: number) => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    isImageUploadDisabled: boolean;
    handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
    input: string;
    setInput: (value: string) => void;
    handleSendMessage: () => void;
    handleCancelAnalysis: () => void;
    loadingMessage: string | null;
    isSummarizing: boolean;
    // True while ANY phase of the analysis run is active (incl. the debate,
    // when loadingMessage is null) — drives the Send↔Stop toggle so the user
    // can always cancel, even mid-debate.
    isAnalysisInProgress: boolean;
    steeringNotes?: string[];
    onRemoveSteeringNote?: (index: number) => void;
    isRateLimited: boolean;
    isAnyProviderEnabled: boolean;
    // Ensemble Intelligence Configuration — dynamic provider list
    providers: ProviderConfig[];
    onUpdateProvider?: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    // Vision Model Selection
    selectedVisionModel: string;
    setSelectedVisionModel: (modelId: string) => void;
    // Lens Config
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
    // Ordinary ensemble model selection (Lenses off): the three models chosen
    // here drive the live cards and the debate.
    ensembleModelSelection: EnsembleModelSelection;
    setEnsembleModelSelection: (selection: EnsembleModelSelection) => void;
    // Custom prompt overrides (prompt editor).
    customEnsemblePrompt: string | null;
    setCustomEnsemblePrompt: (prompt: string | null) => void;
    customLensPrompts: Record<string, string>;
    setCustomLensPrompts: (prompts: Record<string, string>) => void;
    // Ensemble mode: off = casual chat with the selected model (chart
    // upload/analysis disabled); on = full analysis pipeline.
    isEnsembleEnabled: boolean;
    setIsEnsembleEnabled: (v: boolean) => void;
    // Casual-chat model: which model answers when ensemble is off.
    // Stored app-wide (Preferences); falls back to the first ready model.
    selectedChatModel: string;
    setSelectedChatModel: (modelId: string) => void;
    /** Debate moderator — picked in the Team modal alongside the analysts. */
    moderatorProviderId?: string;
    moderatorModel?: string;
    onSetModeratorProvider?: (providerId: string) => void;
    onSetModeratorModel?: (modelId: string) => void;
    /**
     * Regime-matched provider win rates for the CURRENT market regime —
     * feeds the lens auto-assign so routing prefers who wins in THIS
     * regime, not blended all-time.
     */
    regimeProviderStats?: RegimeProviderStatsMap;
    onOpenSettings?: (tab?: string) => void;
    onOpenLiveMarket?: () => void;
    isAccuracyModeEnabled?: boolean;
    hybridConnectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    hybridData?: unknown;
    // Fresh-session layout: center the input until the first message exists.
    centered?: boolean;
}

const ChatInputInner: React.FC<ChatInputProps> = ({
    images,
    removeImage,
    leverageRef,
    setIsLeverageDropdownOpen,
    leverageInput,
    handleLeverageChange,
    handleLeverageBlur,
    isLeverageDropdownOpen,
    handlePresetLeverage,
    fileInputRef,
    isImageUploadDisabled,
    handleImageUpload,
    input,
    setInput,
    handleSendMessage,
    handleCancelAnalysis,
    loadingMessage,
    isSummarizing,
    isAnalysisInProgress,
    steeringNotes = [],
    onRemoveSteeringNote,
    isRateLimited,
    isAnyProviderEnabled,
    providers,
    onUpdateProvider,
    selectedVisionModel,
    setSelectedVisionModel,
    lensConfig,
    setLensConfig,
    ensembleModelSelection,
    setEnsembleModelSelection,
    customEnsemblePrompt,
    setCustomEnsemblePrompt,
    customLensPrompts,
    setCustomLensPrompts,
    isEnsembleEnabled,
    setIsEnsembleEnabled,
    selectedChatModel,
    regimeProviderStats,
    setSelectedChatModel,
    moderatorProviderId,
    moderatorModel,
    onSetModeratorProvider,
    onSetModeratorModel,
    onOpenSettings,
    onOpenLiveMarket,
    isAccuracyModeEnabled = false,
    hybridConnectionStatus,
    hybridData,
    // Fresh-session layout: static centered input until the first message
    // exists, then it docks at the bottom.
    centered = false,
}) => {
    const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
    const [isTeamMenuOpen, setIsTeamMenuOpen] = useState(false);
    const [mentionOpen, setMentionOpen] = useState(false);
    const [botMentionNames, setBotMentionNames] = useState<string[]>([]);
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const key = (typeof localStorage !== 'undefined' ? localStorage.getItem('last_active_user') : null) || 'default';
                const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`bots_v1_${key}`) : null;
                if (!raw) { if (!cancelled) setBotMentionNames([]); return; }
                const data = JSON.parse(raw) as { bots?: Array<{ name?: string; hidden?: boolean }> };
                const bots = Array.isArray(data?.bots) ? data.bots : [];
                const names = bots.filter(b => b.name && !(b as { hidden?: boolean }).hidden).map(b => `@${String(b.name).trim().split(/\s+/)[0]}`).filter(Boolean).slice(0, 6);
                if (!cancelled) setBotMentionNames(names);
            } catch { if (!cancelled) setBotMentionNames([]); }
        })();
        return () => { cancelled = true; };
    }, [isTeamModalOpen, mentionOpen]);
    const mentionCandidates = React.useMemo(() => {
        if (!isEnsembleEnabled) return [] as string[];
        if (botMentionNames.length > 0) return botMentionNames;
        if (lensConfig.enabled) {
            const map: Record<string, string> = {
                [AnalystRole.MACRO_VOLATILITY]: '@Macro',
                [AnalystRole.TECHNICAL_ANALYST]: '@Technical',
                [AnalystRole.RISK_EXECUTION]: '@Risk',
            };
            return LENS_ROSTER_ROLES.map(r => map[r]).filter(Boolean);
        }
        return (ensembleModelSelection || []).slice(0, 3).map((_, i) => ['@Macro', '@Technical', '@Risk'][i]).filter(Boolean) as string[];
    }, [isEnsembleEnabled, lensConfig.enabled, ensembleModelSelection, botMentionNames]);
    React.useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (mentionOpen) { setMentionOpen(false); return; }
            setIsLeverageDropdownOpen(false);
            setIsTeamModalOpen(false);
            if (isAnalysisInProgress) handleCancelAnalysis();
        };
        const handleSlash = (event: KeyboardEvent) => {
            if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
            event.preventDefault();
            document.getElementById('chat-composer')?.focus();
        };
        document.addEventListener('keydown', handleEscape);
        document.addEventListener('keydown', handleSlash);
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.removeEventListener('keydown', handleSlash);
        };
    }, [setIsLeverageDropdownOpen, isAnalysisInProgress, handleCancelAnalysis, mentionOpen]);
    React.useEffect(() => {
        if (!isEnsembleEnabled || isAnalysisInProgress) setMentionOpen(false);
        else if (input.includes('@') && mentionCandidates.length > 0) setMentionOpen(true);
        else setMentionOpen(false);
    }, [input, isEnsembleEnabled, isAnalysisInProgress, mentionCandidates.length]);

    // Charts can only be analyzed in ensemble mode.
    const uploadDisabled = isImageUploadDisabled || !isEnsembleEnabled;

    // Casual-chat model dropdown (ensemble off): every model of every ready
    // provider. Falls back to the first ready provider's model when the
    // stored selection is empty or no longer available.
    const chatProviders = providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0);
    const chatModelOptions = chatProviders.flatMap(p => p.models.map(m => ({ providerName: p.name, modelId: m })));
    const effectiveChatModel = selectedChatModel
        || chatProviders[0]?.selectedModel
        || chatProviders[0]?.models[0]
        || '';
    const rosterSlots = React.useMemo(() => {
        if (lensConfig.enabled) {
            return LENS_ROSTER_ROLES.map(role => {
                const def = ANALYST_ROLE_DEFINITIONS[role];
                const assignment = lensConfig.assignments?.find(item => item.role === role);
                const provider = chatProviders.find(item => item.id === assignment?.assignedProvider);
                const model = assignment?.assignedModel || provider?.models[0] || '';
                return {
                    initial: def.shortName.charAt(0).toUpperCase(),
                    label: def.shortName,
                    model: provider && model ? `${provider.name} · ${formatModelDisplayName(model)}` : '',
                };
            }).filter(slot => slot.model);
        }
        return (ensembleModelSelection || [])
            .filter(entry => entry?.providerId && entry.model)
            .slice(0, 3)
            .map((entry, index) => {
                const provider = chatProviders.find(item => item.id === entry.providerId);
                return {
                    initial: (provider?.name || 'E').charAt(0).toUpperCase(),
                    label: provider?.name || `Expert ${index + 1}`,
                    model: formatModelDisplayName(entry.model),
                };
            });
    }, [chatProviders, ensembleModelSelection, lensConfig]);

    const handleInjectionChip = (kind: InjectionChipKind): void => {
        if (kind === 'team') {
            setIsEnsembleEnabled(true);
            setIsTeamModalOpen(true);
            return;
        }
        if (kind === 'notebook') {
            onOpenSettings?.('memory');
            return;
        }
        if (kind === 'strategies') {
            onOpenSettings?.('strategies');
            return;
        }
        if (kind === 'accuracy') {
            onOpenSettings?.('lenses');
            return;
        }
        if (kind === 'hybrid' || kind === 'regime') {
            onOpenLiveMarket?.();
        }
    };

    // --- PROMPT EDITOR (view / modify each mode's prompt) ---
    type PromptEditorTarget =
        | { kind: 'normal' }
        | { kind: 'lens'; role: AnalystRole; defaultPrompt: string }
        | null;
    const [promptEditor, setPromptEditor] = useState<PromptEditorTarget>(null);

    const openLensPromptEditor = (role: AnalystRole) => {
        const style = (lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle) as 'position' | 'swing' | 'scalp';
        setPromptEditor({ kind: 'lens', role, defaultPrompt: getLensPromptForRole(role, style) });
    };

    const promptEditorProps = promptEditor
        ? promptEditor.kind === 'lens'
            ? {
                title: `Lenses · ${ANALYST_ROLE_DEFINITIONS[promptEditor.role].name} Prompt`,
                subtitle: 'Sent to the analyst assigned to this role (custom overrides win)',
                defaultPrompt: promptEditor.defaultPrompt,
                value: customLensPrompts[promptEditor.role] || '',
            }
            : {
                title: 'Normal Mode Prompt',
                subtitle: 'Base prompt every analyst receives in Normal mode (same for all models)',
                defaultPrompt: MASTER_ANALYSIS_PROMPT,
                value: customEnsemblePrompt || '',
            }
        : null;

    return (
        <div className={centered
            ? 'w-full'
            : 'absolute bottom-0 left-0 right-0 px-3 sm:px-4 lg:px-8 pointer-events-none z-20 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:pb-4 status-surface'}>
            <div className={centered ? 'w-full' : 'chat-column pointer-events-auto'}>
                {/* Main Input Container — ChatGPT pill */}
                <div className="rounded-[28px] border border-white/[0.04] bg-zinc-800 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all">

                    {/* Image Preview */}
                    <ImagePreview images={images} onRemoveImage={removeImage} />

                    {isAnalysisInProgress && (
                        <div className="mb-1.5 px-2">
                            <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                                {steeringNotes.length > 0 ? `${steeringNotes.length} note${steeringNotes.length === 1 ? '' : 's'} queued for the next debate step` : 'Type a note and send — it queues until the next debate step'}
                            </p>
                            {steeringNotes.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {steeringNotes.map((note, i) => (
                                        <button
                                            key={`${i}-${note.slice(0, 12)}`}
                                            type="button"
                                            onClick={() => onRemoveSteeringNote?.(i)}
                                            className="max-w-full truncate rounded-md border border-white/10 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-rose-500/40 hover:text-zinc-100"
                                            title="Remove queued note"
                                        >
                                            {note}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {mentionOpen && mentionCandidates.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1 rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5">
                            <span className="mr-1 text-[10px] uppercase tracking-widest text-zinc-500">Mention</span>
                            {mentionCandidates.map(tag => (
                                <button
                                    key={tag}
                                    type="button"
                                    className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
                                    onClick={() => {
                                        const atIdx = input.lastIndexOf('@');
                                        const before = atIdx >= 0 ? input.slice(0, atIdx) : input;
                                        const after = atIdx >= 0 ? input.slice(atIdx).replace(/^@\w*/, '') : '';
                                        setInput(`${before}${tag} ${after}`.replace(/\s+/g, ' ').trimStart());
                                        setMentionOpen(false);
                                        document.getElementById('chat-composer')?.focus();
                                    }}
                                >
                                    {tag}
                                </button>
                            ))}
                            <button type="button" className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300" onClick={() => setMentionOpen(false)}>Dismiss</button>
                        </div>
                    )}
                    {/* Main Input Row */}
                    <div className="flex items-end gap-2 px-1">
                        <textarea
                            id="chat-composer"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (!e.shiftKey || e.ctrlKey || e.metaKey) ? (e.preventDefault(), handleSendMessage()) : undefined}
                            placeholder={isAnalysisInProgress ? 'Add a note for the next debate step…' : images.length > 0 ? 'Analyze charts...' : isEnsembleEnabled ? 'Describe the setup or upload charts…' : 'How can I help you today?'}
                            className="flex-1 min-w-0 bg-transparent px-2 py-2 text-[15px] text-white placeholder-zinc-400 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 min-h-[24px] max-h-28 resize-none leading-6"
                            rows={1}
                            disabled={isRateLimited}
                            style={{ overflow: 'hidden' }}
                        />
                    </div>
                    {/* ROUND-31 composer declutter (DeepSeek-minimal): the
                        suggestion row collapses behind a single "Templates ▾"
                        toggle. Nothing renders unless the user asks — the
                        empty-state composer shows text, + , Team, send. */}
                    {isEnsembleEnabled && (
                        <div className="px-2 pb-1">
                            <details className="group/templates">
                                <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 transition-colors hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
                                    <ChevronDownIcon className="h-3 w-3 transition-transform group-open/templates:rotate-180" />
                                    Templates
                                </summary>
                                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                                    {isEnsembleEnabled ? ['@Macro', '@Technical', '@Risk'].map(tag => (
                                        <button
                                            key={tag}
                                            type="button"
                                            className="rounded-md px-1 py-0.5 text-[10px] text-zinc-600 transition-colors hover:text-zinc-300"
                                            onClick={() => setInput(input.includes(tag) ? input : `${tag} ${input}`.trim())}
                                        >
                                            {tag}
                                        </button>
                                    )) : null}
                                    {isEnsembleEnabled ? DEBATE_TEMPLATES.map(template => {
                                        const marker = debateTemplateMarker(template.id);
                                        const active = input.includes(marker);
                                        return (
                                            <button
                                                key={template.id}
                                                type="button"
                                                title={template.hint}
                                                className={`rounded-md px-1 py-0.5 text-[10px] transition-colors ${
                                                    active
                                                        ? 'bg-zinc-800 text-zinc-200'
                                                        : 'text-zinc-600 hover:text-zinc-300'
                                                }`}
                                                onClick={() => setInput(active
                                                    ? input.split(marker).join('').replace(/\s+/g, ' ').trim()
                                                    : `${marker} ${input}`.trim())}
                                            >
                                                {template.label}
                                            </button>
                                        );
                                    }) : null}
                                    {listSkillSlugs().slice(0, 4).map(slug => (
                                        <button
                                            key={slug}
                                            type="button"
                                            title={`Apply the /${slug} skill veto to this run`}
                                            className="rounded-md px-1 py-0.5 text-[10px] text-zinc-600 transition-colors hover:text-zinc-300"
                                            onClick={() => setInput(`/${slug} ${parseComposerIntent(input).rest}`.trim())}
                                        >
                                            /{slug}
                                        </button>
                                    ))}
                                </div>
                            </details>
                        </div>
                    )}
                     <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" disabled={uploadDisabled} />

                    {/* Bottom Toolbar — ChatGPT style: + left, model/mic/send right */}
                    <div className="flex items-center justify-between gap-2 px-1 pt-2">
                        {/* Left Side: upload + action pills */}
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 flex-wrap">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`h-8 w-8 rounded-full border transition-all shrink-0 flex items-center justify-center ${uploadDisabled ? 'border-white/5 text-zinc-600 cursor-not-allowed' : 'border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 hover:border-white/15'}`}
                                disabled={uploadDisabled}
                                title={isEnsembleEnabled ? 'Upload charts' : 'Open Team to analyze charts'}
                            >
                                <PlusIcon className="h-4 w-4" />
                            </button>
                            {/* Chat | Trade — Claude-desktop-style mode switcher
                                (ROUND-33): Chat = casual single-model chat;
                                Trade = the full ensemble pipeline. Replaces the
                                old implicit toggle (Team button enabled the
                                ensemble as a side effect). */}
                            <div
                                role="tablist"
                                aria-label="Composer mode"
                                className="flex items-center rounded-full border border-white/10 bg-zinc-950 p-0.5"
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={!isEnsembleEnabled}
                                    onClick={() => setIsEnsembleEnabled(false)}
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                        !isEnsembleEnabled ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    Chat
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={isEnsembleEnabled}
                                    onClick={() => setIsEnsembleEnabled(true)}
                                    title="Analyst team debates and issues a verdict"
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                        isEnsembleEnabled ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    Trade
                                </button>
                            </div>

                            {isEnsembleEnabled && (
                                /* ROUND-34: the team opens as a clean dropdown
                                   (model-selector style), not a modal. */
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setIsTeamMenuOpen(o => !o)}
                                        className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                                        aria-haspopup="menu"
                                        aria-expanded={isTeamMenuOpen}
                                        title="Choose the analyst team"
                                    >
                                        <span className="font-medium">Team</span>
                                        <span className="flex -space-x-1.5">
                                            {(rosterSlots.length > 0 ? rosterSlots : [{ initial: '?', label: 'Unassigned', model: '' }]).map((slot, index) => (
                                                <span
                                                    key={`${slot.label}-${index}`}
                                                    className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-950 bg-zinc-700 text-[9px] font-semibold text-zinc-200"
                                                    title={slot.model ? `${slot.label} · ${slot.model}` : slot.label}
                                                >
                                                    {slot.initial}
                                                </span>
                                            ))}
                                        </span>
                                        <ChevronDownIcon className={`h-3 w-3 text-zinc-500 transition-transform ${isTeamMenuOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                    {isTeamMenuOpen && (
                                        <>
                                            <div className="fixed inset-0 z-30" onClick={() => setIsTeamMenuOpen(false)} aria-hidden="true" />
                                            <div className="absolute bottom-full left-0 z-40 mb-2 w-72 rounded-xl border border-white/10 bg-zinc-900 p-1.5 shadow-2xl animate-fade-in">
                                                {rosterSlots.map(slot => (
                                                    <div key={slot.label} className="flex items-center justify-between rounded-lg px-2.5 py-2 hover:bg-zinc-800">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-[13px] font-medium text-zinc-100">{slot.label}</p>
                                                            <p className="truncate text-[11px] text-zinc-500">{slot.model}</p>
                                                        </div>
                                                        <CheckIcon className="h-4 w-4 shrink-0 text-zinc-300" />
                                                    </div>
                                                ))}
                                                <div className="flex items-center justify-between rounded-lg px-2.5 py-2 hover:bg-zinc-800">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-[13px] font-medium text-zinc-100">Moderator</p>
                                                        <p className="truncate text-[11px] text-zinc-500">{moderatorModel ? formatModelDisplayName(moderatorModel) : 'first ready model'}</p>
                                                    </div>
                                                    <CheckIcon className="h-4 w-4 shrink-0 text-zinc-300" />
                                                </div>
                                                <div className="mt-1 border-t border-white/5 pt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setIsTeamMenuOpen(false); setIsTeamModalOpen(true); }}
                                                        className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                                                    >
                                                        Customize team…
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                        </div>

                        {/* Right Side: model (chat) / leverage (trade) + send */}
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                            {/* Casual chat model — reference-style bare selector */}
                            {!isEnsembleEnabled && chatModelOptions.length > 0 && (
                                <ModelPicker
                                    providers={providers}
                                    value={effectiveChatModel}
                                    onChange={setSelectedChatModel}
                                    mode="model-only"
                                />
                            )}
                            {/* Leverage Button — Trade mode only */}
                            {isEnsembleEnabled && (
                            <div className="relative" ref={leverageRef}>
                                <button
                                    onClick={() => setIsLeverageDropdownOpen(!isLeverageDropdownOpen)}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-zinc-500 ${isLeverageDropdownOpen ? 'bg-zinc-700 text-white' : 'bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700 hover:text-white'}`}
                                    aria-label={`Select leverage, currently ${leverageInput}x`}
                                    aria-expanded={isLeverageDropdownOpen}
                                    aria-haspopup="menu"
                                >
                                    
                                    <span className="font-medium">{leverageInput}x</span>
                                </button>
                                {isLeverageDropdownOpen && (
                                     <div role="menu" aria-label="Leverage presets" className="absolute bottom-full right-0 mb-2 w-36 overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-2xl animate-fade-in">
                                        <div className="border-b border-white/10 px-3 py-2.5">
                                            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Leverage</div>
                                            <div className="mt-1 text-[10px] text-zinc-600">Risk multiplier</div>
                                        </div>
                                        <div className="p-1.5">
                                        {[25, 50, 75, 100, 125].map(preset => (
                                            <button
                                                key={preset}
                                                onClick={() => handlePresetLeverage(preset)}
                                                className={`w-full rounded-md px-3 py-2 text-left text-sm font-mono transition-colors ${parseInt(leverageInput) === preset ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'}`}
                                            >
                                                {preset}x
                                            </button>
                                        ))}
                                        <div className="px-3 py-2 border-t border-white/10">
                                            <input
                                                type="number"
                                                value={leverageInput}
                                                onChange={handleLeverageChange}
                                                onBlur={handleLeverageBlur}
                                                className="w-full bg-zinc-900 border border-white/10 rounded-md px-2 py-1.5 text-sm font-mono text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                                                aria-label="Custom leverage"
                                                min="1"
                                                max="125"
                                                placeholder="Custom"
                                            />
                                        </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            )}
                            <button
                                onClick={isAnalysisInProgress ? handleCancelAnalysis : handleSendMessage}
                                disabled={isSummarizing || (!isAnalysisInProgress && ((!input.trim() && images.length === 0) || isRateLimited || !isAnyProviderEnabled))}
                                className={`h-8 w-8 rounded-full transition-all flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${isAnalysisInProgress ? 'status-surface bg-rose-500 hover:bg-rose-400 text-white' : 'bg-white text-zinc-900 hover:bg-zinc-100 shadow-sm'}`}
                                title={isAnalysisInProgress ? 'Stop generating' : 'Send'}
                                aria-label={isAnalysisInProgress ? 'Stop generating' : 'Send message'}
                            >
                                {isSummarizing ? <LoadingIcon className="h-4 w-4" /> : isAnalysisInProgress ? <StopIcon className="h-3.5 w-3.5" fill="currentColor" /> : <SendIcon className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    {isEnsembleEnabled && (
                        <div className="mt-1.5 flex flex-col items-end gap-1 px-1">
                            <InjectionContextBar
                                providers={providers}
                                isEnsembleEnabled={isEnsembleEnabled}
                                isAccuracyModeEnabled={isAccuracyModeEnabled}
                                hybridConnectionStatus={hybridConnectionStatus}
                                hybridData={hybridData}
                                onChip={handleInjectionChip}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Prompt editor modal — view/modify the prompt of the current mode. */}
            <PromptEditorModal
                isOpen={promptEditor !== null}
                title={promptEditorProps?.title ?? ''}
                subtitle={promptEditorProps?.subtitle}
                defaultPrompt={promptEditorProps?.defaultPrompt ?? ''}
                value={promptEditorProps?.value ?? ''}
                onSave={(prompt) => {
                    if (!promptEditor) return;
                    if (promptEditor.kind === 'lens') {
                        const next = { ...customLensPrompts };
                        if (prompt) {
                            next[promptEditor.role] = prompt;
                        } else {
                            delete next[promptEditor.role];
                        }
                        setCustomLensPrompts(next);
                    } else {
                        setCustomEnsemblePrompt(prompt);
                    }
                    setPromptEditor(null);
                }}
                onClose={() => setPromptEditor(null)}
            />

            {/* Team launch modal */}
            <TeamModal
                isOpen={isTeamModalOpen}
                providers={providers}
                isEnsembleEnabled={isEnsembleEnabled}
                setIsEnsembleEnabled={setIsEnsembleEnabled}
                lensConfig={lensConfig}
                setLensConfig={setLensConfig}
                regimeProviderStats={regimeProviderStats}
                ensembleModelSelection={ensembleModelSelection}
                setEnsembleModelSelection={setEnsembleModelSelection}
                moderatorProviderId={moderatorProviderId}
                moderatorModel={moderatorModel}
                onSetModeratorProvider={onSetModeratorProvider}
                onSetModeratorModel={onSetModeratorModel}
                onClose={() => setIsTeamModalOpen(false)}
                onEditLensPrompt={openLensPromptEditor}
                onEditNormalPrompt={() => setPromptEditor({ kind: 'normal' })}
                onOpenSettings={onOpenSettings}
            />
        </div>
    );
};

export const ChatInput = React.memo(ChatInputInner);
