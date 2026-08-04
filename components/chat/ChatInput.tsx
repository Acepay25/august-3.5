
import React, { useState } from 'react';
import ImagePreview from '../shared/ImagePreview';
import { PlusIcon, LoadingIcon, SendIcon, StopIcon, ChevronDownIcon, ChevronUpIcon, BotIcon } from '../shared/Icons';
import { ImageMetadata, AnalystLensConfig, AnalystRole } from '../../types';
import { EnsembleModelSelection, ANALYST_ROLE_DEFINITIONS, getLensPromptForRole } from '../../services/ui/AnalystLensService';
import { MASTER_ANALYSIS_PROMPT } from '../../constants/prompts';
import PromptEditorModal from '../settings/PromptEditorModal';

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
    setSelectedChatModel,
    // Fresh-session layout: static centered input until the first message
    // exists, then it docks at the bottom.
    centered = false,
}) => {
    const [showAISettings, setShowAISettings] = useState(false);
    const [showLensSettings, setShowLensSettings] = useState(false);
    // Two-step dropdown: 'choose' shows ONLY the mode chooser; the assignment
    // UI ('lenses' = roles, 'normal' = model picker) appears after the user
    // picks a mode.
    const [lensAssignStep, setLensAssignStep] = useState<'choose' | 'lenses' | 'normal'>('choose');

    React.useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setShowAISettings(false);
            setShowLensSettings(false);
            setIsLeverageDropdownOpen(false);
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
        const availableModels = provider ? selectedModelsForLens(provider) : [];
        const model = assignment.assignedModel || provider?.selectedModel || '';
        return model && availableModels.includes(model) ? `${assignment.assignedProvider}::${model}` : '';
    };
    const updateLensAssignment = (role: string, value: string): void => {
        const separator = value.indexOf('::');
        const assignedProvider = separator >= 0 ? value.slice(0, separator) : value;
        const assignedModel = separator >= 0 ? value.slice(separator + 2) : undefined;
        const assignments = [...(lensConfig.assignments || [])];
        const index = assignments.findIndex(item => item.role === role);
        const assignment = { assignedProvider: assignedProvider || null, ...(assignedModel ? { assignedModel } : {}) };
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
            : 'absolute bottom-0 left-0 right-0 px-3 sm:px-4 lg:px-8 pointer-events-none z-20 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:pb-8'}>
            <div className={centered ? 'w-full' : 'w-full lg:max-w-3xl lg:mx-auto pointer-events-auto'}>
                {/* Main Input Container — carded composer surface */}
                <div className="rounded-2xl border border-white/10 bg-[#202020]/95 shadow-[0_8px_32px_rgba(0,0,0,0.24)] p-2 sm:p-3 lg:p-4 transition-all">

                    {/* Image Preview */}
                    <ImagePreview images={images} onRemoveImage={removeImage} />

                    {/* Main Input Row */}
                    <div className="flex items-end gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey ? (e.preventDefault(), handleSendMessage()) : null}
                            placeholder={images.length > 0 ? "Analyze charts..." : "Write a message..."}
                            className="flex-1 min-w-0 bg-transparent px-2 py-2 text-base text-white placeholder-zinc-500 focus:outline-none focus-visible:outline-none focus-visible:ring-0 transition-all min-h-[44px] lg:min-h-[48px] max-h-32 resize-none leading-relaxed"
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
                                <select
                                    value={effectiveChatModel}
                                    onChange={(e) => setSelectedChatModel(e.target.value)}
                                    className="max-w-[150px] sm:max-w-[190px] bg-zinc-800 border border-zinc-700 rounded-lg pl-2 pr-6 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 cursor-pointer appearance-none bg-no-repeat bg-[right_0.4rem_center] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')]"
                                    title="Casual chat model (ensemble off)"
                                    aria-label="Casual chat model"
                                >
                                    {chatModelOptions.map(opt => (
                                        <option key={`${opt.providerName}-${opt.modelId}`} value={opt.modelId}>
                                            {opt.modelId}
                                        </option>
                                    ))}
                                </select>
                            )}

                            {/* Ensemble split button: toggle ensemble mode /
                                configure providers. Clicking the main button
                                turns ensemble on/off AND opens the provider
                                list so you can pick which models participate. */}
                            <div className={`relative flex items-center shadow-sm rounded-full transition-all ${isEnsembleEnabled ? 'bg-cyan-600' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                                <button
                                    onClick={() => {
                                        setShowAISettings(true);
                                        setIsEnsembleEnabled(!isEnsembleEnabled);
                                    }}
                                    className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 lg:px-4 py-1 sm:py-1.5 lg:py-2 transition-all text-xs sm:text-sm border-r border-black/10 rounded-l-full ${isEnsembleEnabled ? 'text-white shadow-[inset_0_0_10px_rgba(0,0,0,0.1)]' : 'text-zinc-400 hover:text-white'}`}
                                    title={isEnsembleEnabled ? 'Ensemble on — chart analysis enabled' : 'Enable ensemble mode for chart analysis'}
                                    aria-pressed={isEnsembleEnabled}
                                >
                                    <span className="font-medium hidden xs:inline sm:inline">Ensemble</span>
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowAISettings(!showAISettings);
                                    }}
                                    className={`px-1.5 sm:px-2 py-1 sm:py-1.5 lg:py-2 transition-colors flex items-center justify-center rounded-r-full ${isEnsembleEnabled ? 'text-white hover:bg-cyan-700' : 'text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                                    title="Configure providers"
                                    aria-label="Configure providers"
                                    aria-expanded={showAISettings}
                                    aria-haspopup="dialog"
                                >
                                    <ChevronDownIcon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 transition-transform duration-200 ${showAISettings ? 'rotate-180' : ''}`} />
                                </button>
                            </div>

                            {/* Lens Mode Split Button — only meaningful for ensemble analysis. */}
                            {isEnsembleEnabled && <>
                            <div className={`relative group flex items-center shadow-sm rounded-full transition-all ${lensConfig.enabled ? 'bg-zinc-700' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
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
                                    <span className="text-xs sm:text-sm"></span>
                                    <span className="font-medium hidden xs:inline sm:inline">{lensConfig.enabled ? 'Lenses' : 'Normal'}</span>
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
                                        className="absolute bottom-full left-0 mb-2 w-64 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-50 animate-fade-in"
                                    >
                                        {lensAssignStep === 'choose' ? (
                                            <>
                                        {/* Step 1 — choose the debate mode. The picker
                                            only appears after a mode is selected. */}
                                        <div className="px-3 py-2 bg-zinc-800">
                                            <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1.5">Choose Debate Mode</div>
                                            <div className="grid grid-cols-2 gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setLensConfig({ ...lensConfig, enabled: true });
                                                        setLensAssignStep('lenses');
                                                    }}
                                                    aria-pressed={lensConfig.enabled}
                                                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${lensConfig.enabled ? 'bg-zinc-700 border-white/20' : 'bg-zinc-950 border-white/10 hover:bg-zinc-800'}`}
                                                >
                                                    <span className={`block text-xs font-semibold ${lensConfig.enabled ? 'text-white' : 'text-zinc-400'}`}>Lenses</span>
                                                    <span className="block text-[9px] text-zinc-500 leading-tight">Role-based prompts per analyst</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setLensConfig({ ...lensConfig, enabled: false });
                                                        setLensAssignStep('normal');
                                                    }}
                                                    aria-pressed={!lensConfig.enabled}
                                                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${!lensConfig.enabled ? 'bg-zinc-700 border-white/20' : 'bg-zinc-950 border-white/10 hover:bg-zinc-800'}`}
                                                >
                                                    <span className={`block text-xs font-semibold ${!lensConfig.enabled ? 'text-white' : 'text-zinc-400'}`}>Normal</span>
                                                    <span className="block text-[9px] text-zinc-500 leading-tight">Same prompt for all models</span>
                                                </button>
                                            </div>
                                        </div>
                                            </>
                                        ) : lensAssignStep === 'lenses' ? (
                                            <>
                                        <div className="px-3 py-2 bg-zinc-800 flex items-center justify-between">
                                            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Lenses · Assign Analysts</span>
                                            <button type="button" onClick={() => setLensAssignStep('choose')} className="text-[10px] text-zinc-500 hover:text-zinc-300">‹ Mode</button>
                                        </div>
                                        {/* Macro Analyst */}
                                        <div className="px-1.5 py-0.5">
                                            <div className="flex items-center justify-between mb-0">
                                                <span className="text-[10px] font-medium text-zinc-400">Macro & Volatility</span>
                                                <button type="button" onClick={() => openLensPromptEditor(AnalystRole.MACRO_VOLATILITY)} className="text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors" title="View / edit this role's prompt">✎ Prompt</button>
                                            </div>
                                            <select
                                                value={lensAssignmentValue('macro_volatility')}
                                                onChange={(e) => updateLensAssignment('macro_volatility', e.target.value)}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-0.5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                                            >
                                                <option value="">Select provider/model</option>
                                                {lensModelOptionsForRole('macro_volatility').map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? ' (assigned)' : ''}</option>)}
                                            </select>
                                        </div>

                                        {/* Technical Analyst */}
                                        <div className="px-1.5 py-0.5">
                                            <div className="flex items-center justify-between mb-0">
                                                <span className="text-[10px] font-medium text-zinc-400">Technical Analyst</span>
                                                <button type="button" onClick={() => openLensPromptEditor(AnalystRole.TECHNICAL_ANALYST)} className="text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors" title="View / edit this role's prompt">✎ Prompt</button>
                                            </div>
                                            <select
                                                value={lensAssignmentValue('technical_analyst')}
                                                onChange={(e) => updateLensAssignment('technical_analyst', e.target.value)}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-0.5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                                            >
                                                <option value="">Select provider/model</option>
                                                {lensModelOptionsForRole('technical_analyst').map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? ' (assigned)' : ''}</option>)}
                                            </select>
                                        </div>

                                        {/* Risk Manager */}
                                        <div className="px-1.5 py-0.5">
                                            <div className="flex items-center justify-between mb-0">
                                                <span className="text-[10px] font-medium text-zinc-400">Risk Manager</span>
                                                <button type="button" onClick={() => openLensPromptEditor(AnalystRole.RISK_EXECUTION)} className="text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors" title="View / edit this role's prompt">✎ Prompt</button>
                                            </div>
                                            <select
                                                value={lensAssignmentValue('risk_execution')}
                                                onChange={(e) => updateLensAssignment('risk_execution', e.target.value)}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-0.5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                                            >
                                                <option value="">Select provider/model</option>
                                                {lensModelOptionsForRole('risk_execution').map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? ' (assigned)' : ''}</option>)}
                                            </select>
                                        </div>
                                            </>
                                        ) : (
                                            <>
                                        <div className="px-3 py-2 bg-zinc-800 flex items-center justify-between">
                                            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Normal · Debate Models</span>
                                            <div className="flex items-center gap-2">
                                                <button type="button" onClick={() => setPromptEditor({ kind: 'normal' })} className="text-[10px] text-zinc-500 hover:text-zinc-300" title="View / edit this mode's prompt">✎ Prompt</button>
                                                <button type="button" onClick={() => setLensAssignStep('choose')} className="text-[10px] text-zinc-500 hover:text-zinc-300">‹ Mode</button>
                                            </div>
                                        </div>
                                        <p className="px-3 py-1.5 text-[10px] text-zinc-500">Pick up to 3 models for the ensemble debate.</p>
                                        {[0, 1, 2].map(slot => (
                                            <div key={slot} className="px-1.5 py-0.5">
                                                <div className="flex items-center gap-2 mb-0">
                                                    <span className="text-[10px] font-medium text-zinc-400">Model {slot + 1}</span>
                                                </div>
                                                <select
                                                    value={ensembleSelectionValue(slot)}
                                                    onChange={(e) => updateEnsembleSelection(slot, e.target.value)}
                                                    className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-0.5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                                                >
                                                    <option value="">Select provider/model</option>
                                                    {lensModelOptions.map(option => <option key={option.value} value={option.value} disabled={isChosenInOtherSlot(slot, option.value)}>{option.label}{isChosenInOtherSlot(slot, option.value) ? ' (assigned)' : ''}</option>)}
                                                </select>
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
                                    <span className="text-xs sm:text-sm"></span>
                                    <span className="font-medium">{leverageInput}x</span>
                                </button>
                                {isLeverageDropdownOpen && (
                                    <div role="menu" aria-label="Leverage presets" className="absolute bottom-full right-0 mb-2 w-28 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fade-in">
                                        {[25, 50, 75, 100, 125].map(preset => (
                                            <button
                                                key={preset}
                                                onClick={() => handlePresetLeverage(preset)}
                                                className={`w-full text-left px-4 py-2.5 text-sm font-mono transition-colors ${parseInt(leverageInput) === preset ? 'bg-cyan-500/20 text-cyan-300' : 'text-zinc-300 hover:bg-zinc-800'}`}
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
                                )}
                            </div>
                            <button
                                onClick={loadingMessage ? handleCancelAnalysis : handleSendMessage}
                                disabled={isSummarizing || (!loadingMessage && ((!input.trim() && images.length === 0) || isRateLimited || !isAnyProviderEnabled))}
                                className={`h-9 w-9 rounded-xl text-white transition-all flex items-center justify-center shrink-0 ${loadingMessage ? 'bg-rose-500/80 hover:bg-rose-500' : 'bg-cyan-500 hover:bg-cyan-400'} disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-zinc-800`}
                                title={loadingMessage ? 'Stop generating' : 'Send'}
                                aria-label={loadingMessage ? 'Stop generating' : 'Send message'}
                            >
                                {isSummarizing ? <LoadingIcon className="h-5 w-5" /> : loadingMessage ? <StopIcon className="h-4 w-4" fill="currentColor" /> : <SendIcon />}
                            </button>
                        </div>
                    </div>

                    {/* Ensemble Intelligence Panel - List Style */}
                    {showAISettings && (
                        <div role="dialog" aria-label="Provider settings" className="mt-4 bg-zinc-900 rounded-2xl border border-white/10 overflow-hidden animate-fade-in">
                            {/* AI Providers List — only providers ENABLED in
                                Settings participate in ensemble; enable/disable
                                happens in Settings → AI Models. */}
                            <div className="max-h-[300px] overflow-y-auto">
                                {providers.filter(p => p.isEnabled).length > 0 ? (
                                    providers.filter(p => p.isEnabled).map((provider, index) => (
                                        <div
                                            key={provider.id}
                                            className={`w-full flex items-center justify-between px-4 py-3 transition-all bg-cyan-500/10 ${index !== 0 ? 'border-t border-white/5' : ''
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                                    <line x1="12" y1="22.08" x2="12" y2="12" />
                                                </svg>
                                                <div className="text-left">
                                                    <div className="text-sm font-medium text-white">
                                                        {provider.name}
                                                    </div>
                                                    <div className="mt-2 space-y-1.5">
                                                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Ensemble models</div>
                                                        {provider.models.length > 0 ? provider.models.map(model => {
                                                            const selectedModels = provider.ensembleModels?.filter(item => provider.models.includes(item))
                                                                ?? (provider.selectedModel ? [provider.selectedModel] : []);
                                                            const checked = selectedModels.includes(model);
                                                            const atLimit = ensembleSelectionCount >= 3;
                                                            return (
                                                                <label key={model} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={checked}
                                                                        disabled={provider.apiKey.trim().length === 0 || (!checked && atLimit)}
                                                                        onChange={() => {
                                                                            if (!onUpdateProvider) return;
                                                                            const next = checked
                                                                                ? selectedModels.filter(item => item !== model)
                                                                                : [...selectedModels, model];
                                                                            if (next.length === 0 || next.length > 3) return;
                                                                            void onUpdateProvider(provider.id, { ensembleModels: next });
                                                                        }}
                                                                        className="h-3.5 w-3.5 accent-cyan-500"
                                                                        aria-label={`${provider.name} ${model} ensemble model`}
                                                                    />
                                                                    <span className="truncate font-mono">{model}</span>
                                                                </label>
                                                            );
                                                        }) : <span className="text-[10px] text-zinc-600">No models configured</span>}
                                                        {provider.apiKey.trim().length === 0 && <span className="block text-[10px] text-red-400 font-mono">No API key</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="px-4 py-6 text-center text-xs text-zinc-500">
                                        No enabled providers. Enable providers in Settings → AI Models.
                                    </div>
                                )}
                            </div>

                            <div className="px-4 py-2 border-t border-white/10 text-[11px] text-zinc-500">
                                Select up to <span className="text-zinc-300 font-medium">3 models total</span> for the ensemble ({ensembleSelectionCount}/3 selected).
                            </div>

                            {/* Vision Model Selector */}
                            <div className="px-4 py-3 border-t border-white/10 bg-zinc-800">
                                <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-2">Vision Model</div>
                                <select
                                    value={selectedVisionModel}
                                    onChange={(e) => setSelectedVisionModel(e.target.value)}
                                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus:border-cyan-500/50"
                                    aria-label="Vision model"
                                >
                                    {providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0).flatMap(p => p.models.map(m => ({ providerName: p.name, modelId: m }))).map(item => (
                                        <option key={`${item.providerName}-${item.modelId}`} value={item.modelId} className="bg-zinc-900">
                                            {item.providerName}: {item.modelId}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Warning if no providers ready */}
                            {providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0).length === 0 && (
                                <div className="px-4 py-3 text-[11px] text-red-400 bg-red-500/10 border-t border-red-500/20">
                                     Enable at least one AI provider (with an API key) to send messages
                                </div>
                            )}
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
        </div>
    );
};

export const ChatInput = React.memo(ChatInputInner);
