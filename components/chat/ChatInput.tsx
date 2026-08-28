
import React, { useState } from 'react';
import ImagePreview from '../shared/ImagePreview';
import { PlusIcon, LoadingIcon, SendIcon, StopIcon, ChevronDownIcon } from '../shared/Icons';
import { ImageMetadata, AnalystLensConfig, AnalystRole } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { EnsembleModelSelection, ANALYST_ROLE_DEFINITIONS, getLensPromptForRole } from '../../services/ui/AnalystLensService';
import { RegimeProviderStatsMap } from '../../services/learning/SetupMemoryService';
import { MASTER_ANALYSIS_PROMPT } from '../../constants/prompts';
import PromptEditorModal from '../settings/PromptEditorModal';
import TeamModal from './TeamModal';
import TeamRosterMenu from './TeamRosterMenu';
import { LeverageSection } from './LeverageSection';
import ModelPicker from '../shared/ModelPicker';

import { parseComposerIntent } from '../../utils/composerMentions';
import { formatModelDisplayName } from '../../utils/providerUtils';

const LENS_ROSTER_ROLES: AnalystRole[] = [
    AnalystRole.MACRO_VOLATILITY,
    AnalystRole.TECHNICAL_ANALYST,
    AnalystRole.RISK_EXECUTION,
];

interface ChatInputProps {
    images: ImageMetadata[];
    removeImage: (index: number) => void;
    leverageInput: string;
    handleLeverageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleLeverageBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
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
    /** Open the per-agent chat slide-over. */
    onOpenAgentChat?: () => void;
    isAccuracyModeEnabled?: boolean;
    hybridConnectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    hybridData?: unknown;
    // Fresh-session layout: center the input until the first message exists.
    centered?: boolean;
}

const ChatInputInner: React.FC<ChatInputProps> = ({
    images,
    removeImage,
    leverageInput,
    handleLeverageChange,
    handleLeverageBlur,
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
    onOpenAgentChat,
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
        // "Try in chat" from a skill card — prepend the /slug
        // marker and focus the composer so the user can fire it immediately.
        const handleTrySkill = (event: Event) => {
            const slug = (event as CustomEvent<{ slug?: string }>).detail?.slug;
            if (!slug) return;
            const marker = `/${slug}`;
            if (!input.includes(marker)) {
                setInput(`${marker} ${parseComposerIntent(input).rest}`.trim());
            }
            document.getElementById('chat-composer')?.focus();
        };
        document.addEventListener('august:try-skill', handleTrySkill);
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.removeEventListener('keydown', handleSlash);
            document.removeEventListener('august:try-skill', handleTrySkill);
        };
    }, [isAnalysisInProgress, handleCancelAnalysis, mentionOpen, setInput, input]);
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
                    // Lens seats keep their role glyph (M/T/R) —
                    // role identity, not provider name.
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
                    // Fixed SEAT glyphs (1/2/3), never provider-name
                    // initials — three K-named providers used to spell an
                    // unfortunate word in the avatar stack.
                    initial: `${index + 1}`,
                    label: provider?.name || `Expert ${index + 1}`,
                    model: formatModelDisplayName(entry.model),
                };
            });
    }, [chatProviders, ensembleModelSelection, lensConfig]);

    // The injection-chip quick actions moved to the header `⋯` menu in
    // Phase 2 (composer simplification). The Settings menu now owns the
    // surfaces: notebook, strategies, lenses, live market.

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
                {/* Main Input Container — pill proportions:
                    ~16px radius, generous ~20px inner padding, solid #262626
                    fill, no border/shadow. */}
                <div className="rounded-2xl bg-zinc-800 p-3 sm:p-5 transition-colors">

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
                            className="flex-1 min-w-0 bg-transparent px-2 py-2 text-[15px] text-white placeholder-zinc-400 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 min-h-[24px] max-h-28 resize-none leading-6 placeholder:text-center focus:placeholder:text-left"
                            rows={1}
                            disabled={isRateLimited}
                            style={{ overflow: 'hidden' }}
                        />
                    </div>
                    {/* The Templates ▾ row is gone — the composer carries
                        nothing between input and controls.
                        Debate templates still parse from typed text, and skills
                        remain available via /slug in the message itself. */}
                    <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" disabled={uploadDisabled} />

                    {/* Bottom Toolbar — + left, model/mic/send right */}
                    <div className="flex items-center justify-between gap-2 px-1 pt-2">
                        {/* Left Side: upload + action pills */}
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 flex-wrap">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`h-8 w-8 rounded-full transition-all shrink-0 flex items-center justify-center ${uploadDisabled ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}
                                disabled={uploadDisabled}
                                title={isEnsembleEnabled ? 'Upload charts' : 'Open Team to analyze charts'}
                            >
                                <PlusIcon className="h-[18px] w-[18px]" />
                            </button>
                            {/* Talk-to selector — picks the chat target.
                                "Team" routes to the existing ensemble debate;
                                any single provider routes to a casual 1:1 chat
                                with that model. We use a real <select> so the
                                keyboard and screen-reader experience is
                                predictable (arrow keys, type-ahead). */}
                            <label
                                className="flex items-center gap-1.5 rounded-full bg-zinc-800/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-200"
                                data-testid="talk-to-selector"
                            >
                                <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                                    Talk to
                                </span>
                                <select
                                    aria-label="Talk to"
                                    value={isEnsembleEnabled ? '__team__' : (effectiveChatModel || '')}
                                    onChange={e => {
                                        const v = e.target.value;
                                        if (v === '__team__') {
                                            setIsEnsembleEnabled(true);
                                        } else {
                                            setIsEnsembleEnabled(false);
                                            setSelectedChatModel(v);
                                        }
                                    }}
                                    className="bg-transparent text-[12px] text-zinc-100 outline-none"
                                >
                                    <option value="__team__" className="bg-zinc-900 text-zinc-100">
                                        Team ({rosterSlots.length})
                                    </option>
                                    {chatModelOptions.map(opt => {
                                        const value = `${opt.providerName}::${opt.modelId}`;
                                        const selected = opt.modelId === effectiveChatModel;
                                        return (
                                            <option
                                                key={value}
                                                value={opt.modelId}
                                                className="bg-zinc-900 text-zinc-100"
                                            >
                                                {opt.providerName} · {formatModelDisplayName(opt.modelId)}
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>

                            {/* Per-agent chat — opens the slide-over with the
                                agent sidebar (one-by-one per the user's request). */}
                            <button
                                type="button"
                                onClick={onOpenAgentChat}
                                data-testid="open-agent-chat"
                                title="Open per-agent chat (one-by-one)"
                                className="rounded-full bg-zinc-800/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
                            >
                                Per-agent
                            </button>

                        </div>

                        {/* Right Side: send (+ leverage in Trade mode, model in
                            Chat mode) — the leverage control moved into the
                            Team menu so the composer bar reads
                            + modes … send only. */}
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                            {/* Casual chat model — bare selector */}
                            {!isEnsembleEnabled && chatModelOptions.length > 0 && (
                                <ModelPicker
                                    providers={providers}
                                    value={effectiveChatModel}
                                    onChange={setSelectedChatModel}
                                    mode="model-only"
                                />
                            )}
                            <button
                                onClick={isAnalysisInProgress ? handleCancelAnalysis : handleSendMessage}
                                disabled={isSummarizing || (!isAnalysisInProgress && ((!input.trim() && images.length === 0) || isRateLimited || !isAnyProviderEnabled))}
                                className={`h-8 w-8 rounded-full transition-all flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${isAnalysisInProgress ? 'status-surface bg-rose-500 hover:bg-rose-400 text-white' : 'bg-zinc-200 text-zinc-900 hover:bg-white shadow-sm'}`}
                                title={isAnalysisInProgress ? 'Stop generating' : 'Send'}
                                aria-label={isAnalysisInProgress ? 'Stop generating' : 'Send message'}
                            >
                                {isSummarizing ? <LoadingIcon className="h-4 w-4" /> : isAnalysisInProgress ? <StopIcon className="h-3.5 w-3.5" fill="currentColor" /> : <SendIcon className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    {/* Phase 2 composer simplification: the InjectionContextBar
                        chips above the input are gone. The same context lives
                        in the new "view injected" affordance inside the
                        SettingsMenu and in the desk overlay; surfacing it
                        again at the composer was redundant with the model
                        picker and the Team chip. */}
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
