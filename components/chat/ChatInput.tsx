
import React, { useState } from 'react';
import ImagePreview from '../shared/ImagePreview';
import { PlusIcon, LoadingIcon, SendIcon, StopIcon, ChevronDownIcon } from '../shared/Icons';
import { ImageMetadata, AnalystLensConfig, AnalystRole } from '../../types';
import { EnsembleModelSelection, ANALYST_ROLE_DEFINITIONS, getLensPromptForRole } from '../../services/ui/AnalystLensService';
import { RegimeProviderStatsMap } from '../../services/learning/SetupMemoryService';
import { MASTER_ANALYSIS_PROMPT } from '../../constants/prompts';
import PromptEditorModal from '../settings/PromptEditorModal';
import TeamModal from './TeamModal';
import ModelPicker from '../shared/ModelPicker';

import { ProviderConfig } from '../../types/provider';

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
    // Fresh-session layout: static centered input until the first message
    // exists, then it docks at the bottom.
    centered = false,
}) => {
    const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
    React.useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setIsLeverageDropdownOpen(false);
            setIsTeamModalOpen(false);
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [setIsLeverageDropdownOpen]);

    // Charts can only be analyzed in ensemble mode.
    const uploadDisabled = isImageUploadDisabled || !isEnsembleEnabled;

    // Casual-chat model dropdown (ensemble off): every model of every ready
    // provider. Falls back to the first ready provider's model when the
    // stored selection is empty or no longer available.
    const chatProviders = providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0);
    const chatModelOptions = chatProviders.flatMap(p => p.models.map(m => ({ providerName: p.name, modelId: m })));
    const effectiveChatModel = selectedChatModel && chatModelOptions.some(o => o.modelId === selectedChatModel)
        ? selectedChatModel
        : (chatProviders[0]?.selectedModel || chatProviders[0]?.models[0] || '');
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
                    model: provider && model ? `${provider.name} · ${model}` : '',
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
                    model: entry.model,
                };
            });
    }, [chatProviders, ensembleModelSelection, lensConfig]);

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
            ? 'w-full status-surface'
            : 'absolute bottom-0 left-0 right-0 px-3 sm:px-4 lg:px-8 pointer-events-none z-20 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:pb-4 status-surface'}>
            <div className={centered ? 'w-full' : 'w-full lg:max-w-3xl lg:mx-auto pointer-events-auto'}>
                {/* Main Input Container — compact composer */}
                <div className="rounded-2xl border border-white/10 bg-[#202020]/95 shadow-[0_8px_32px_rgba(0,0,0,0.24)] p-2 transition-all">

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

                    {/* Main Input Row */}
                    <div className="flex items-end gap-2">
                        <textarea
                            id="chat-composer"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            // Enter sends (Shift+Enter = newline); Ctrl/Cmd+Enter
                            // also sends as an alternative.
                            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (!e.shiftKey || e.ctrlKey || e.metaKey) ? (e.preventDefault(), handleSendMessage()) : null}
                            placeholder={isAnalysisInProgress ? 'Add a note for the next debate step…' : images.length > 0 ? 'Analyze charts...' : 'Write a message...'}
                            className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-base text-white placeholder-zinc-500 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 min-h-[36px] max-h-24 resize-none leading-snug"
                            rows={1}
                            // Always typeable — sending (not typing) is what
                            // requires a ready provider.
                            disabled={isRateLimited}
                            style={{ overflow: 'hidden' }}
                        />
                    </div>
                    <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" disabled={uploadDisabled} />

                    {/* Bottom Toolbar — unified control row for all breakpoints */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 mt-1 border-t border-white/5 lg:flex-nowrap">
                        {/* Left Side: upload + action pills */}
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 flex-wrap">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`h-9 w-9 rounded-full transition-all shrink-0 flex items-center justify-center ${uploadDisabled ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-white'}`}
                                disabled={uploadDisabled}
                                title={isEnsembleEnabled ? "Upload charts" : "Enable Ensemble to analyze charts"}
                            >
                                <PlusIcon className="h-5 w-5" />
                            </button>
                            {/* Casual-chat model dropdown — only when ensemble
                                is off: pick which model answers casual chat. */}
                            {!isEnsembleEnabled && chatModelOptions.length > 0 && (
                                <ModelPicker
                                    providers={providers}
                                    value={effectiveChatModel}
                                    onChange={setSelectedChatModel}
                                    mode="model-only"
                                    compact
                                    className="max-w-[150px] sm:max-w-[190px]"
                                />
                            )}

                            {/* Ensemble toggle — simple on/off button */}
                            <button
                                onClick={() => setIsEnsembleEnabled(!isEnsembleEnabled)}
                                className={`flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1 rounded-full transition-all text-xs sm:text-sm ${isEnsembleEnabled ? 'bg-cyan-600 text-white shadow-[inset_0_0_10px_rgba(0,0,0,0.1)]' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                                title={isEnsembleEnabled ? 'Ensemble on — chart analysis enabled' : 'Enable ensemble mode for chart analysis'}
                                aria-pressed={isEnsembleEnabled}
                            >
                                <span className="font-medium">Ensemble</span>
                            </button>

                            {isEnsembleEnabled && (
                                <button
                                    type="button"
                                    onClick={() => setIsTeamModalOpen(true)}
                                    className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-2.5 py-1 text-xs sm:text-sm text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
                                    aria-haspopup="dialog"
                                    aria-expanded={isTeamModalOpen}
                                    title="Choose the analyst team"
                                >
                                    <span className="font-medium">Team</span>
                                    <span className="flex -space-x-1.5">
                                        {(rosterSlots.length > 0 ? rosterSlots : [{ initial: '?', label: 'Unassigned', model: '' }]).map((slot, index) => (
                                            <span
                                                key={`${slot.label}-${index}`}
                                                className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-900 bg-zinc-700 text-[9px] font-semibold text-zinc-200"
                                                title={slot.model ? `${slot.label} · ${slot.model}` : slot.label}
                                            >
                                                {slot.initial}
                                            </span>
                                        ))}
                                    </span>
                                    <ChevronDownIcon className="h-3 w-3 text-zinc-500" />
                                </button>
                            )}

                        </div>

                        {/* Right Side: leverage + send */}
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                            {/* Leverage Button */}
                            <div className="relative" ref={leverageRef}>
                                <button
                                    onClick={() => setIsLeverageDropdownOpen(!isLeverageDropdownOpen)}
                                    className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full transition-all text-xs sm:text-sm focus-visible:ring-2 focus-visible:ring-cyan-400 ${isLeverageDropdownOpen ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                                    aria-label={`Select leverage, currently ${leverageInput}x`}
                                    aria-expanded={isLeverageDropdownOpen}
                                    aria-haspopup="menu"
                                >
                                    
                                    <span className="font-medium">{leverageInput}x</span>
                                </button>
                                {isLeverageDropdownOpen && (
                                     <div role="menu" aria-label="Leverage presets" className="absolute bottom-full right-0 mb-2 w-36 overflow-hidden rounded-2xl border border-cyan-400/20 bg-zinc-950/95 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl animate-fade-in">
                                        <div className="border-b border-white/10 bg-gradient-to-br from-cyan-950/35 via-zinc-900 to-zinc-900 px-3 py-2.5"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300">Leverage</div><div className="mt-1 text-[10px] text-zinc-500">Choose a risk multiplier.</div></div>
                                        <div className="p-1.5">
                                        {[25, 50, 75, 100, 125].map(preset => (
                                            <button
                                                key={preset}
                                                onClick={() => handlePresetLeverage(preset)}
                                                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-mono transition-colors ${parseInt(leverageInput) === preset ? 'bg-cyan-500/15 text-cyan-200' : 'text-zinc-300 hover:bg-zinc-800'}`}
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
                                                className="w-full bg-zinc-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm font-mono text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus:border-cyan-500/50"
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
                            <button
                                onClick={isAnalysisInProgress ? handleCancelAnalysis : handleSendMessage}
                                disabled={isSummarizing || (!isAnalysisInProgress && ((!input.trim() && images.length === 0) || isRateLimited || !isAnyProviderEnabled))}
                                className={`h-9 w-9 rounded-xl text-white transition-all flex items-center justify-center shrink-0 ${isAnalysisInProgress ? 'bg-rose-500/80 hover:bg-rose-500' : 'bg-cyan-500 hover:bg-cyan-400'} disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-zinc-800`}
                                title={isAnalysisInProgress ? 'Stop generating' : 'Send'}
                                aria-label={isAnalysisInProgress ? 'Stop generating' : 'Send message'}
                            >
                                {isSummarizing ? <LoadingIcon className="h-5 w-5" /> : isAnalysisInProgress ? <StopIcon className="h-4 w-4" fill="currentColor" /> : <SendIcon />}
                            </button>
                        </div>
                    </div>

                    {isEnsembleEnabled && rosterSlots.length > 0 && (
                        <p className="mt-1 truncate px-1 text-[11px] text-zinc-500" title={rosterSlots.map(s => `${s.label} · ${s.model}`).join('   ')}>
                            {rosterSlots.map(slot => `${slot.label} · ${slot.model}`).join('   ')}
                        </p>
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
            />
        </div>
    );
};

export const ChatInput = React.memo(ChatInputInner);
