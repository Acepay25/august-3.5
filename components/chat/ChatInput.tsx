
import React, { useState } from 'react';
import ImagePreview from '../shared/ImagePreview';
import { PlusIcon, LoadingIcon, SendIcon, StopIcon, ChevronDownIcon, ChevronUpIcon, BotIcon } from '../shared/Icons';
import { ImageMetadata, AnalystLensConfig, AnalystRole } from '../../types';
import { EnsembleModelSelection, ANALYST_ROLE_DEFINITIONS, getLensPromptForRole } from '../../services/ui/AnalystLensService';
import { RegimeProviderStatsMap } from '../../services/learning/SetupMemoryService';
import GlobalLearningService from '../../services/learning/GlobalLearningService';
import { MASTER_ANALYSIS_PROMPT } from '../../constants/prompts';
import PromptEditorModal from '../settings/PromptEditorModal';
import TeamModal from './TeamModal';
import ModelPicker from '../shared/ModelPicker';

import { ProviderConfig } from '../../types/provider';

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
    // Fresh-session layout: static centered input until the first message
    // exists, then it docks at the bottom.
    centered = false,
}) => {
    // showAISettings removed — ensemble is now a simple toggle
    const [showLensSettings, setShowLensSettings] = useState(false);
    // Two-step dropdown: 'choose' shows ONLY the mode chooser; the assignment
    // UI ('lenses' = roles, 'normal' = model picker) appears after the user
    // picks a mode.
    const [lensAssignStep, setLensAssignStep] = useState<'choose' | 'lenses' | 'normal'>('choose');
    const lensMenuRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setShowLensSettings(false);
            setIsLeverageDropdownOpen(false);
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [setIsLeverageDropdownOpen]);

    // Close the lenses dropdown when the user clicks anywhere outside it.
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (showLensSettings && lensMenuRef.current && !lensMenuRef.current.contains(event.target as Node)) {
                setShowLensSettings(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showLensSettings]);

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
    const ensembleSelectionCount = providers.reduce((total, provider) => {
        const selected = provider.ensembleModels?.filter(model => provider.models.includes(model))
            ?? (provider.selectedModel ? [provider.selectedModel] : []);
        return total + selected.length;
    }, 0);
    const selectedModelsForLens = (provider: typeof providers[number]): string[] => {
        // All of the provider's models, not just ensembleModels — an assigned
        // model outside ensembleModels used to render the dropdown blank even
        // though the pipeline still ran it.
        return isEnsembleEnabled
            ? (provider.models.length > 0 ? provider.models : (provider.selectedModel ? [provider.selectedModel] : []))
            : [];
    };
    const lensAssignmentValue = (role: string): string => {
        const assignment = lensConfig.assignments?.find(item => item.role === role);
        if (!assignment?.assignedProvider) return '';
        const provider = providers.find(item => item.id === assignment.assignedProvider);
        // A DISABLED / key-less provider must render as unassigned — the
        // dropdown options only list ready providers, so a non-empty value
        // with no matching option rendered a BLANK select while the footer
        // claimed "All roles assigned — ready to start the ensemble".
        if (!provider || !(provider.isEnabled && provider.apiKey.trim().length > 0)) return '';
        const availableModels = provider ? selectedModelsForLens(provider) : [];
        const model = assignment.assignedModel || provider?.selectedModel || '';
        return model && availableModels.includes(model) ? `${assignment.assignedProvider}::${model}` : '';
    };
    const updateLensAssignment = (role: string, value: string): void => {
        const separator = value.indexOf('::');
        const assignedProvider = separator >= 0 ? value.slice(0, separator) : value;
        const assignedModel = separator >= 0 ? value.slice(separator + 2) : undefined;
        const provider = providers.find(p => p.id === assignedProvider);
        // Mirror AnalystLensSettings semantics: a model that doesn't exist on
        // the chosen provider must not survive the assignment — keeping it
        // rendered a blank dropdown in the lens editor while the pipeline
        // still ran the stale model.
        const modelIsValid = !!assignedModel && !!provider && provider.models.includes(assignedModel);
        const assignments = [...(lensConfig.assignments || [])];
        const index = assignments.findIndex(item => item.role === role);
        const assignment = { assignedProvider: assignedProvider || null, ...(modelIsValid ? { assignedModel } : {}) };
        if (index >= 0) {
            assignments[index] = { ...assignments[index], ...assignment };
        }
        setLensConfig({ ...lensConfig, assignments });
    };
    const lensModelOptions = providers
        .filter(provider => provider.isEnabled && provider.apiKey.trim().length > 0)
        .flatMap(provider => selectedModelsForLens(provider).map(model => ({ value: `${provider.id}::${model}`, label: `${provider.name} · ${model}` })));
    const lensModelOptionsForRole = (role: string) => lensModelOptions.map(option => ({
        ...option,
        disabled: lensConfig.assignments?.some(assignment => {
            if (assignment.role === role || !assignment.assignedProvider) return false;
            const provider = providers.find(item => item.id === assignment.assignedProvider);
            const assignedModel = assignment.assignedModel || provider?.selectedModel || provider?.models[0] || '';
            return `${assignment.assignedProvider}::${assignedModel}` === option.value;
        }) ?? false,
    }));

    // --- ORDINARY "DEBATE MODELS" PICKER (Lenses OFF) ---
    // Mirrors the lens role dropdowns, but without roles: the three selected
    // models become the debate participants (source of truth for the cards).
    const ensembleSelectionValue = (slot: number): string => {
        const entry = ensembleModelSelection?.[slot];
        if (!entry) return '';
        const provider = providers.find(p => p.id === entry.providerId);
        if (!provider || !provider.models.includes(entry.model)) return '';
        return `${entry.providerId}::${entry.model}`;
    };
    const updateEnsembleSelection = (slot: number, value: string): void => {
        const separator = value.indexOf('::');
        const providerId = separator >= 0 ? value.slice(0, separator) : value;
        const model = separator >= 0 ? value.slice(separator + 2) : '';
        const next = [...(ensembleModelSelection || [])];
        if (value && providerId && model) {
            next[slot] = { providerId, model };
        } else {
            next.splice(slot, 1);
        }
        // A model may only occupy one slot; keep at most 3 picks.
        const seen = new Set<string>();
        const deduped = next
            .filter(e => {
                const key = `${e.providerId}::${e.model}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 3);
        setEnsembleModelSelection(deduped);
    };
    const isChosenInOtherSlot = (slot: number, value: string): boolean =>
        (ensembleModelSelection || []).some((e, i) => i !== slot && `${e.providerId}::${e.model}` === value);

    // --- PROMPT EDITOR (view / modify each mode's prompt) ---
    type PromptEditorTarget =
        | { kind: 'normal' }
        | { kind: 'lens'; role: AnalystRole; defaultPrompt: string }
        | null;
    const [promptEditor, setPromptEditor] = useState<PromptEditorTarget>(null);
    const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
    // ⑥: the composer team dropdown — quick roster + auto-assign, with the
    // modal one click away for full role editing.
    // isTeamDropdownOpen removed — Team button removed from chat input

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
            : 'absolute bottom-0 left-0 right-0 px-3 sm:px-4 lg:px-8 pointer-events-none z-20 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:pb-8 status-surface'}>
            <div className={centered ? 'w-full' : 'w-full lg:max-w-3xl lg:mx-auto pointer-events-auto'}>
                {/* Main Input Container — carded composer surface */}
                <div className="rounded-2xl border border-white/10 bg-[#202020]/95 shadow-[0_8px_32px_rgba(0,0,0,0.24)] p-2 sm:p-3 lg:p-4 transition-all">

                    {/* Image Preview */}
                    <ImagePreview images={images} onRemoveImage={removeImage} />

                    {/* Main Input Row */}
                    <div className="flex items-end gap-2">
                        <textarea
                            id="chat-composer"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            // Enter sends (Shift+Enter = newline); Ctrl/Cmd+Enter
                            // also sends as an alternative.
                            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (!e.shiftKey || e.ctrlKey || e.metaKey) ? (e.preventDefault(), handleSendMessage()) : null}
                            placeholder={images.length > 0 ? "Analyze charts..." : "Write a message..."}
                            className="flex-1 min-w-0 bg-transparent px-2 py-2 text-base text-white placeholder-zinc-500 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 transition-all min-h-[44px] lg:min-h-[48px] max-h-32 resize-none leading-relaxed"
                            rows={1}
                            // Always typeable — sending (not typing) is what
                            // requires a ready provider.
                            disabled={!!loadingMessage || isRateLimited}
                            style={{ overflow: 'hidden' }}
                        />
                    </div>
                    <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" disabled={uploadDisabled} />

                    {/* Bottom Toolbar — unified control row for all breakpoints */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 sm:pt-3 mt-2 border-t border-white/5 lg:flex-nowrap lg:border-none lg:mt-3 lg:pt-0">
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
                                className={`flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-1 sm:py-1.5 lg:py-2 rounded-full transition-all text-xs sm:text-sm ${isEnsembleEnabled ? 'bg-cyan-600 text-white shadow-[inset_0_0_10px_rgba(0,0,0,0.1)]' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                                title={isEnsembleEnabled ? 'Ensemble on — chart analysis enabled' : 'Enable ensemble mode for chart analysis'}
                                aria-pressed={isEnsembleEnabled}
                            >
                                <span className="font-medium">Ensemble</span>
                            </button>

                            {/* Lens Mode Split Button — only meaningful for ensemble analysis. */}
                            {isEnsembleEnabled && <>
                            <div ref={lensMenuRef} className={`relative group flex items-center shadow-sm rounded-full transition-all ${lensConfig.enabled ? 'bg-zinc-700' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                                {/* Main Toggle — label reflects the current mode */}
                                <button
                                    onClick={() => {
                                        setLensConfig({ ...lensConfig, enabled: !lensConfig.enabled });
                                        setLensAssignStep('choose');
                                    }}
                                    className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 lg:py-2 transition-all text-xs sm:text-sm border-r border-black/10 rounded-l-full ${lensConfig.enabled ? 'text-white shadow-[inset_0_0_10px_rgba(0,0,0,0.1)]' : 'text-zinc-400 hover:text-white'}`}
                                    aria-pressed={lensConfig.enabled}
                                    title={lensConfig.enabled ? 'Lenses mode — role-based prompts' : 'Normal mode — same prompt for all models'}
                                >
                                    
                                    <span className="font-medium inline">{lensConfig.enabled ? 'Lenses' : 'Normal'}</span>
                                </button>

                                {/* Dropdown Trigger */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (!showLensSettings) setLensAssignStep('choose');
                                        setShowLensSettings(!showLensSettings);
                                    }}
                                    className={`px-1.5 sm:px-2 py-1 sm:py-1.5 lg:py-2 transition-colors flex items-center justify-center rounded-r-full focus-visible:ring-2 focus-visible:ring-cyan-400 ${lensConfig.enabled ? 'text-white hover:bg-zinc-600' : 'text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                                    aria-label="Configure ensemble mode"
                                    aria-expanded={showLensSettings}
                                    aria-haspopup="dialog"
                                >
                                    <ChevronDownIcon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 transition-transform duration-200 ${showLensSettings ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Two-step dropdown: mode chooser first, then the
                                    assignment UI for the chosen mode. */}
                                {showLensSettings && (
                                    <div
                                        role="dialog"
                                        aria-label={lensAssignStep === 'lenses' ? 'Assign analysts' : lensAssignStep === 'normal' ? 'Debate models' : 'Debate mode'}
                                        className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-cyan-400/20 bg-zinc-950/95 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl animate-fade-in"
                                    >
                                        {lensAssignStep === 'choose' ? (
                                            <>
                                        <div className="border-b border-white/10 bg-gradient-to-br from-cyan-950/40 via-zinc-900 to-zinc-900 px-4 py-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Analysis mode</div>
                                            <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">Choose how the ensemble frames each analyst.</div>
                                        </div>
                                        <div className="space-y-2 p-2.5">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setLensConfig({ ...lensConfig, enabled: true });
                                                        setLensAssignStep('lenses');
                                                    }}
                                                    aria-pressed={lensConfig.enabled}
                                                    className={`group w-full rounded-xl border px-3 py-3 text-left transition-all ${lensConfig.enabled ? 'border-cyan-400/40 bg-cyan-500/10 shadow-[0_0_18px_rgba(100,141,198,0.14)]' : 'border-white/10 bg-zinc-950/70 hover:border-cyan-400/25 hover:bg-zinc-800/80'}`}
                                                >
                                                    <span className="flex items-center justify-between"><span className={`text-xs font-bold ${lensConfig.enabled ? 'text-cyan-200' : 'text-zinc-300'}`}>Lenses</span><span className={`h-2 w-2 rounded-full ${lensConfig.enabled ? 'bg-cyan-400 shadow-[0_0_8px_rgba(100,141,198,0.8)]' : 'bg-zinc-700 group-hover:bg-zinc-500'}`} /></span>
                                                    <span className="mt-1 block text-[10px] leading-tight text-zinc-500">Role-based prompts for Macro, Technical, and Risk.</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setLensConfig({ ...lensConfig, enabled: false });
                                                        setLensAssignStep('normal');
                                                    }}
                                                    aria-pressed={!lensConfig.enabled}
                                                    className={`group w-full rounded-xl border px-3 py-3 text-left transition-all ${!lensConfig.enabled ? 'border-cyan-400/40 bg-cyan-500/10 shadow-[0_0_18px_rgba(100,141,198,0.14)]' : 'border-white/10 bg-zinc-950/70 hover:border-cyan-400/25 hover:bg-zinc-800/80'}`}
                                                >
                                                    <span className="flex items-center justify-between"><span className={`text-xs font-bold ${!lensConfig.enabled ? 'text-cyan-200' : 'text-zinc-300'}`}>Normal</span><span className={`h-2 w-2 rounded-full ${!lensConfig.enabled ? 'bg-cyan-400 shadow-[0_0_8px_rgba(100,141,198,0.8)]' : 'bg-zinc-700 group-hover:bg-zinc-500'}`} /></span>
                                                    <span className="mt-1 block text-[10px] leading-tight text-zinc-500">Same prompt sent to each selected model.</span>
                                                </button>
                                        </div>
                                            </>
                                        ) : lensAssignStep === 'lenses' ? (
                                            <>
                                        <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-br from-cyan-950/35 via-zinc-900 to-zinc-900 px-4 py-3">
                                            <div><div className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300">Lenses</div><div className="mt-1 text-[10px] text-zinc-500">Assign one model to each role.</div></div>
                                            <button type="button" onClick={() => setLensAssignStep('choose')} className="rounded-lg px-2 py-1 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200">‹ Mode</button>
                                        </div>
                                        {/* Macro Analyst */}
                                        <div className="px-1.5 py-0.5">
                                            <div className="flex items-center justify-between mb-0">
                                                <span className="text-[10px] font-medium text-zinc-400">Macro & Volatility</span>
                                                <button type="button" onClick={() => openLensPromptEditor(AnalystRole.MACRO_VOLATILITY)} className="text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors" title="View / edit this role's prompt">✎ Prompt</button>
                                            </div>
                                            <ModelPicker
                                                providers={providers}
                                                value={lensAssignmentValue('macro_volatility')}
                                                onChange={(v) => updateLensAssignment('macro_volatility', v)}
                                                mode="provider-model"
                                                disabledValues={new Set(lensModelOptionsForRole('macro_volatility').filter(o => o.disabled).map(o => o.value))}
                                                compact
                                            />
                                            {lensAssignmentValue('macro_volatility') === '' && (
                                                <div className="mt-0.5 text-[9px] italic text-zinc-600">Unassigned — required to start the ensemble.</div>
                                            )}
                                        </div>

                                        {/* Technical Analyst */}
                                        <div className="px-1.5 py-0.5">
                                            <div className="flex items-center justify-between mb-0">
                                                <span className="text-[10px] font-medium text-zinc-400">Technical Analyst</span>
                                                <button type="button" onClick={() => openLensPromptEditor(AnalystRole.TECHNICAL_ANALYST)} className="text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors" title="View / edit this role's prompt">✎ Prompt</button>
                                            </div>
                                            <ModelPicker
                                                providers={providers}
                                                value={lensAssignmentValue('technical_analyst')}
                                                onChange={(v) => updateLensAssignment('technical_analyst', v)}
                                                mode="provider-model"
                                                disabledValues={new Set(lensModelOptionsForRole('technical_analyst').filter(o => o.disabled).map(o => o.value))}
                                                compact
                                            />
                                            {lensAssignmentValue('technical_analyst') === '' && (
                                                <div className="mt-0.5 text-[9px] italic text-zinc-600">Unassigned — required to start the ensemble.</div>
                                            )}
                                        </div>

                                        {/* Risk Manager */}
                                        <div className="px-1.5 py-0.5">
                                            <div className="flex items-center justify-between mb-0">
                                                <span className="text-[10px] font-medium text-zinc-400">Risk Manager</span>
                                                <button type="button" onClick={() => openLensPromptEditor(AnalystRole.RISK_EXECUTION)} className="text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors" title="View / edit this role's prompt">✎ Prompt</button>
                                            </div>
                                            <ModelPicker
                                                providers={providers}
                                                value={lensAssignmentValue('risk_execution')}
                                                onChange={(v) => updateLensAssignment('risk_execution', v)}
                                                mode="provider-model"
                                                disabledValues={new Set(lensModelOptionsForRole('risk_execution').filter(o => o.disabled).map(o => o.value))}
                                                compact
                                            />
                                            {lensAssignmentValue('risk_execution') === '' && (
                                                <div className="mt-0.5 text-[9px] italic text-zinc-600">Unassigned — required to start the ensemble.</div>
                                            )}
                                        </div>
                                        <div className="border-t border-white/10 px-3 py-2">
                                            <div className="text-[9px] leading-relaxed text-zinc-600">
                                                {(() => {
                                                    const missing = [
                                                        lensAssignmentValue('macro_volatility') ? null : 'Macro',
                                                        lensAssignmentValue('technical_analyst') ? null : 'Technical',
                                                        lensAssignmentValue('risk_execution') ? null : 'Risk',
                                                    ].filter(Boolean) as string[];
                                                    return missing.length > 0
                                                        ? `Missing: ${missing.join(', ')} — the ensemble can't start until every role has a model.`
                                                        : 'All roles assigned — ready to start the ensemble.';
                                                })()}
                                            </div>
                                        </div>
                                            </>
                                        ) : (
                                            <>
                                        <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-br from-cyan-950/35 via-zinc-900 to-zinc-900 px-4 py-3">
                                            <div><div className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300">Normal</div><div className="mt-1 text-[10px] text-zinc-500">Pick up to three debate models.</div></div>
                                            <div className="flex items-center gap-1"><button type="button" onClick={() => setPromptEditor({ kind: 'normal' })} className="rounded-lg px-2 py-1 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200" title="View / edit this mode's prompt">✎ Prompt</button><button type="button" onClick={() => setLensAssignStep('choose')} className="rounded-lg px-2 py-1 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200">‹ Mode</button></div>
                                        </div>
                                        <p className="px-3 py-1.5 text-[10px] text-zinc-500">Pick up to 3 models for the ensemble debate.</p>
                                        {[0, 1, 2].map(slot => (
                                            <div key={slot} className="px-1.5 py-0.5">
                                                <div className="flex items-center gap-2 mb-0">
                                                    <span className="text-[10px] font-medium text-zinc-400">Model {slot + 1}</span>
                                                </div>
                                                <ModelPicker
                                                    providers={providers}
                                                    value={ensembleSelectionValue(slot)}
                                                    onChange={(v) => updateEnsembleSelection(slot, v)}
                                                    mode="provider-model"
                                                    disabledValues={new Set(lensModelOptions.filter(o => isChosenInOtherSlot(slot, o.value)).map(o => o.value))}
                                                    compact
                                                />
                                            </div>
                                        ))}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                            </>}

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
                onClose={() => setIsTeamModalOpen(false)}
            />
        </div>
    );
};

export const ChatInput = React.memo(ChatInputInner);
