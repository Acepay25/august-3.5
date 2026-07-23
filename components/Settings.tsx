

import React, { useState, useEffect, useMemo } from 'react';
import { CloseIcon, ExportIcon, SwitchUserIcon, BookmarkIcon, SearchIcon, ChevronDownIcon, BrainIcon, EditIcon, CheckIcon, TrashIcon, ArchiveIcon } from './Icons';
import { AIProvider, AccuracySubMode, CustomInstructionsMap, CustomInstruction, AnalystLensConfig } from '../types';
import { MemoryProvider, MEMORY_PROVIDER_OPTIONS, MEMORY_MODELS, getDefaultModelForProvider } from '../services/MemoryService';
import { AnalystLensSettings } from './AnalystLensSettings';

interface Model {
    id: string;
    name: string;
    provider: AIProvider;
}

interface SettingsProps {
    isVisible: boolean;
    isLoading: boolean;
    onClose: () => void;
    onExportData: () => void;
    onSwitchUser: () => void;
    onOpenSavedAnalyses: () => void;
    onOpenStrategySearch: () => void;
    geminiModels: Model[];
    deepseekModels: Model[];
    zhipuModels: Model[];
    groqModels: Model[];
    groqNewModels: Model[];
    groqAlt2Models: Model[];

    openrouterModels: Model[];
    ocrModels: Model[];
    selectedGeminiModel: string;
    selectedDeepSeekModel: string;
    selectedZhipuModel: string;
    selectedGroqModel: string;
    selectedGroqNewModel: string;
    selectedGroqAlt2Model: string;

    selectedOpenrouterModel: string;
    selectedOcrModel: string;
    onSetGeminiModel: (id: string) => void;
    onSetDeepseekModel: (id: string) => void;
    onSetZhipuModel: (id: string) => void;
    onSetGroqModel: (id: string) => void;
    onSetGroqNewModel: (id: string) => void;
    onSetGroqAlt2Model: (id: string) => void;

    onSetOpenrouterModel: (id: string) => void;
    onSetOcrModel: (id: string) => void;
    isGeminiEnabled: boolean;
    isDeepSeekEnabled: boolean;
    isZhipuEnabled: boolean;
    isGroqEnabled: boolean;
    isGroqNewEnabled: boolean;
    isGroqAlt2Enabled: boolean;

    isOpenrouterEnabled: boolean;
    isOpenaiEnabled: boolean;
    openaiModels: Model[];
    selectedOpenaiModel: string;
    onSetOpenaiModel: (id: string) => void;
    grokModels: Model[];
    selectedGrokNativeModel: string;
    onSetGrokNativeModel: (id: string) => void;
    isGrokNativeEnabled: boolean;

    onToggleProvider: (provider: 'gemini' | 'deepseek' | 'zhipu' | 'groq' | 'groqNew' | 'groqAlt2' | 'openrouter' | 'openai' | 'grokNative') => void;
    quotaExceededModels: Set<string>;
    ocrModelIdToName: Record<string, string>;
    moderatorProvider: AIProvider;
    moderatorModel: string;
    onSetModeratorProvider: (provider: AIProvider) => void;
    onSetModeratorModel: (modelId: string) => void;
    isGlobalMemoryEnabled: boolean;
    setIsGlobalMemoryEnabled: (enabled: boolean) => void;
    isAccuracyModeEnabled: boolean;
    onToggleAccuracyMode: () => void;
    accuracySubMode: AccuracySubMode;
    setAccuracySubMode: (mode: AccuracySubMode) => void;
    customInstructions: CustomInstructionsMap;
    setCustomInstructions: (instructions: CustomInstructionsMap) => void;
    isPlaybookEnabledInPureAI: boolean;
    setIsPlaybookEnabledInPureAI: (enabled: boolean) => void;
    isFamiliesEnabledInPureAI: boolean;
    setIsFamiliesEnabledInPureAI: (enabled: boolean) => void;
    isMemoryEnabledInPureAI: boolean;
    setIsMemoryEnabledInPureAI: (enabled: boolean) => void;
    isHybridIntelligenceEnabled: boolean;
    setIsHybridIntelligenceEnabled: (enabled: boolean) => void;
    memoryProvider: MemoryProvider;
    setMemoryProvider: (provider: MemoryProvider) => void;
    memoryModel: string;
    setMemoryModel: (model: string) => void;
    lensConfig: AnalystLensConfig;
    onSetLensConfig: (config: AnalystLensConfig) => void;

}

type InstructionTab = 'general' | 'accuracyOriginal' | 'accuracyPure';

const InstructionCard: React.FC<{
    instruction: CustomInstruction;
    onUpdate: (id: string, updates: Partial<CustomInstruction>) => void;
    onDelete: (id: string) => void;
}> = ({ instruction, onUpdate, onDelete }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className={`rounded-xl border transition-all duration-300 ${instruction.isActive ? 'bg-zinc-900/80 border-cyan-500/30 shadow-[0_0_15px_-5px_rgba(6,182,212,0.1)]' : 'bg-zinc-900/30 border-white/5 opacity-80 hover:opacity-100'}`}>
            <div className="p-3 flex items-center justify-between gap-3">
                <div className="flex-1 flex items-center gap-3 min-w-0">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-1 rounded hover:bg-white/5 transition-colors text-zinc-500 hover:text-zinc-300"
                    >
                        <ChevronDownIcon className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    <div className="flex-1 min-w-0">
                        {isExpanded ? (
                            <input
                                type="text"
                                value={instruction.title}
                                onChange={(e) => onUpdate(instruction.id, { title: e.target.value })}
                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-white font-bold focus:border-cyan-500/50 outline-none"
                                placeholder="Instruction Title"
                            />
                        ) : (
                            <div className="flex items-center gap-2">
                                <span className={`text-xs font-bold truncate ${instruction.isActive ? 'text-cyan-100' : 'text-zinc-400'}`}>{instruction.title || 'Untitled'}</span>
                                {instruction.isActive && <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-500/20 uppercase tracking-wider font-bold">Active</span>}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <label className="relative inline-flex items-center cursor-pointer" title={instruction.isActive ? "Deactivate" : "Activate"}>
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={instruction.isActive}
                            onChange={(e) => onUpdate(instruction.id, { isActive: e.target.checked })}
                        />
                        <div className="w-8 h-4 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-cyan-600"></div>
                    </label>

                    <button
                        onClick={() => { if (confirm('Delete this instruction?')) onDelete(instruction.id); }}
                        className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete"
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>

            {isExpanded && (
                <div className="px-3 pb-3 animate-fade-in border-t border-white/5 pt-3">
                    <textarea
                        value={instruction.content}
                        onChange={(e) => onUpdate(instruction.id, { content: e.target.value })}
                        placeholder="Enter instruction content..."
                        className="w-full h-32 bg-zinc-950 border border-white/10 rounded-lg p-3 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500/30 resize-none leading-relaxed custom-scrollbar font-mono"
                    />
                    <div className="flex justify-end mt-2">
                        <span className="text-[10px] text-zinc-500">
                            {instruction.content.trim().split(/\s+/).filter(Boolean).length} words
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

const Settings: React.FC<SettingsProps> = ({
    isVisible,
    isLoading,
    onClose,
    onExportData,
    onSwitchUser,
    onOpenSavedAnalyses,
    onOpenStrategySearch,
    geminiModels,
    deepseekModels,
    zhipuModels,
    groqModels,
    groqNewModels,
    groqAlt2Models,

    openrouterModels,
    ocrModels,
    selectedGeminiModel,
    selectedDeepSeekModel,
    selectedZhipuModel,
    selectedGroqModel,
    selectedGroqNewModel,
    selectedGroqAlt2Model,

    selectedOpenrouterModel,
    selectedOcrModel,
    onSetGeminiModel,
    onSetDeepseekModel,
    onSetZhipuModel,
    onSetGroqModel,
    onSetGroqNewModel,
    onSetGroqAlt2Model,

    onSetOpenrouterModel,
    onSetOcrModel,
    isGeminiEnabled,
    isDeepSeekEnabled,
    isZhipuEnabled,
    isGroqEnabled,
    isGroqNewEnabled,
    isGroqAlt2Enabled,

    isOpenrouterEnabled,
    isOpenaiEnabled,
    openaiModels,
    selectedOpenaiModel,
    onSetOpenaiModel,
    grokModels,
    selectedGrokNativeModel,
    onSetGrokNativeModel,
    isGrokNativeEnabled,

    onToggleProvider,
    moderatorProvider,
    moderatorModel,
    onSetModeratorProvider,
    onSetModeratorModel,
    isGlobalMemoryEnabled,
    setIsGlobalMemoryEnabled,
    isAccuracyModeEnabled,
    onToggleAccuracyMode,
    accuracySubMode,
    setAccuracySubMode,
    customInstructions,
    setCustomInstructions,
    isPlaybookEnabledInPureAI,
    setIsPlaybookEnabledInPureAI,
    isFamiliesEnabledInPureAI,
    setIsFamiliesEnabledInPureAI,
    isMemoryEnabledInPureAI,
    setIsMemoryEnabledInPureAI,
    isHybridIntelligenceEnabled,
    setIsHybridIntelligenceEnabled,
    memoryProvider,
    setMemoryProvider,
    memoryModel,
    setMemoryModel,
    lensConfig,
    onSetLensConfig
}) => {
    const [isModelConfigVisible, setIsModelConfigVisible] = useState(true);
    const [isMemoryConfigVisible, setIsMemoryConfigVisible] = useState(true);
    const [isCustomBehaviorVisible, setIsCustomBehaviorVisible] = useState(true);
    const [activeInstructionTab, setActiveInstructionTab] = useState<InstructionTab>('general');

    const currentInstructions = useMemo(() => customInstructions[activeInstructionTab] || [], [customInstructions, activeInstructionTab]);

    const totalWordCount = useMemo(() => {
        return currentInstructions.reduce((sum, inst) => sum + (inst.content ? inst.content.trim().split(/\s+/).filter(Boolean).length : 0), 0);
    }, [currentInstructions]);

    const MAX_WORD_COUNT = 3000;
    const MAX_ITEMS = 5;

    const handleAddInstruction = () => {
        if (currentInstructions.length >= MAX_ITEMS) {
            alert(`Maximum of ${MAX_ITEMS} instructions allowed per mode.`);
            return;
        }

        const newInstruction: CustomInstruction = {
            id: `inst-${Date.now()}`,
            title: `New Instruction ${currentInstructions.length + 1}`,
            content: '',
            isActive: true
        };

        setCustomInstructions({
            ...customInstructions,
            [activeInstructionTab]: [...currentInstructions, newInstruction]
        });
    };

    const handleUpdateInstruction = (id: string, updates: Partial<CustomInstruction>) => {
        const updatedList = currentInstructions.map(inst => inst.id === id ? { ...inst, ...updates } : inst);
        setCustomInstructions({
            ...customInstructions,
            [activeInstructionTab]: updatedList
        });
    };

    const handleDeleteInstruction = (id: string) => {
        setCustomInstructions({
            ...customInstructions,
            [activeInstructionTab]: currentInstructions.filter(inst => inst.id !== id)
        });
    };

    const getProviderModels = (provider: AIProvider) => {
        switch (provider) {
            case AIProvider.GEMINI: return geminiModels || [];
            case AIProvider.DEEPSEEK: return deepseekModels || [];
            case AIProvider.ZHIPU: return zhipuModels || [];
            case AIProvider.GROQ: return groqModels || [];
            case AIProvider.GROQ_NEW: return groqNewModels || [];
            case AIProvider.GROQ_ALT2: return groqAlt2Models || [];
            case AIProvider.OPENROUTER: return openrouterModels || [];
            case AIProvider.OPENAI: return openaiModels || [];
            case AIProvider.GROK: return grokModels || [];
            default: return [];
        }
    };

    return (
        <>
            <div className={`fixed inset-0 bg-black/60 lg:bg-black/70 z-40 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose}></div>
            <aside className={`fixed top-0 right-0 h-full w-full sm:max-w-lg bg-zinc-900/95 lg:bg-zinc-950 backdrop-blur-xl lg:backdrop-blur-none border-l border-white/10 shadow-2xl z-50 transform transition-transform duration-300 cubic-bezier(0.16, 1, 0.3, 1) flex flex-col ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
                {/* Modern gradient accent bar */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500" />

                <header className="flex items-center justify-between p-5 pt-6 border-b border-white/5">
                    <div>
                        <h2 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Advanced Settings</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">Configure AI behavior & system options</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors">
                        <CloseIcon />
                    </button>
                </header>

                {/* Accuracy Mode Banner */}
                {isAccuracyModeEnabled && (
                    <div className="bg-cyan-900/20 border-cyan-500/20 border-b p-3 text-center">
                        <p className="text-[10px] font-bold uppercase tracking-widest animate-pulse text-cyan-400">
                            Accuracy Mode Active: {accuracySubMode === 'original' ? 'Strict Institutional' : 'Pure AI Reasoning'}
                        </p>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-5 space-y-8">

                    {/* Accuracy Mode Section */}
                    <section className="rounded-2xl border p-5 bg-gradient-to-br from-cyan-950/40 to-zinc-900/50 border-cyan-500/30 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <span className="text-sm font-black uppercase tracking-widest text-cyan-400">
                                    Accuracy Mode
                                </span>
                                <span className="text-xs text-zinc-500 block mt-1">
                                    {isAccuracyModeEnabled ? 'Enhanced Protocol Active' : 'Standard Analysis Speed'}
                                </span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" checked={isAccuracyModeEnabled} onChange={onToggleAccuracyMode} disabled={isLoading} />
                                <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                            </label>
                        </div>

                        {/* Sub-Mode Selector */}
                        {isAccuracyModeEnabled && (
                            <div className="mt-4 pt-4 border-t border-white/10 animate-fade-in">
                                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Operating Sub-Mode</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => setAccuracySubMode('original')}
                                        className={`p-3 rounded-lg border text-left transition-all ${accuracySubMode === 'original' ? 'bg-cyan-600/20 border-cyan-500 text-cyan-200 shadow-[0_0_15px_-5px_rgba(6,182,212,0.4)]' : 'bg-zinc-900 border-white/5 text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        <div className="font-bold text-xs uppercase mb-1">Original Mode</div>
                                        <div className="text-[10px] opacity-70 leading-tight">10-Layer Protocol, Families, Strict Rules.</div>
                                    </button>
                                    <button
                                        onClick={() => setAccuracySubMode('pure_ai')}
                                        className={`p-3 rounded-lg border text-left transition-all ${accuracySubMode === 'pure_ai' ? 'bg-cyan-600/20 border-cyan-500 text-cyan-200 shadow-[0_0_15px_-5px_rgba(6,182,212,0.4)]' : 'bg-zinc-900 border-white/5 text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        <div className="font-bold text-xs uppercase mb-1">Pure AI Mode</div>
                                        <div className="text-[10px] opacity-70 leading-tight">Unrestricted Reasoning, No Playbook Rules.</div>
                                    </button>
                                </div>

                                {/* Pure AI Toggles */}
                                {accuracySubMode === 'pure_ai' && (
                                    <div className="mt-4 space-y-2">
                                        <div className="flex items-center justify-between p-2 bg-cyan-900/20 rounded-lg border border-cyan-500/20">
                                            <span className="text-xs text-cyan-300 font-bold">Enable Strategy Playbook</span>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input type="checkbox" className="sr-only peer" checked={isPlaybookEnabledInPureAI} onChange={(e) => setIsPlaybookEnabledInPureAI(e.target.checked)} />
                                                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
                                            </label>
                                        </div>
                                        <div className="flex items-center justify-between p-2 bg-cyan-900/20 rounded-lg border border-cyan-500/20">
                                            <span className="text-xs text-cyan-300 font-bold">Enable Market Families</span>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input type="checkbox" className="sr-only peer" checked={isFamiliesEnabledInPureAI} onChange={(e) => setIsFamiliesEnabledInPureAI(e.target.checked)} />
                                                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
                                            </label>
                                        </div>
                                        <div className="flex items-center justify-between p-2 bg-cyan-900/20 rounded-lg border border-cyan-500/20">
                                            <span className="text-xs text-cyan-300 font-bold">Enable Pattern Memory</span>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input type="checkbox" className="sr-only peer" checked={isMemoryEnabledInPureAI} onChange={(e) => setIsMemoryEnabledInPureAI(e.target.checked)} />
                                                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>



                    {/* Hybrid Intelligence Section */}
                    <section className={`rounded-2xl border p-5 transition-all ${isHybridIntelligenceEnabled ? 'bg-gradient-to-br from-emerald-950/40 to-zinc-900/50 border-emerald-500/30 shadow-lg' : 'bg-zinc-900/50 border-white/5'}`}>
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <span className={`text-sm font-black uppercase tracking-widest ${isHybridIntelligenceEnabled ? 'text-emerald-400' : 'text-zinc-400'}`}>
                                    Hybrid Intelligence
                                </span>
                                <span className="text-xs text-zinc-500 block mt-1">
                                    {isHybridIntelligenceEnabled ? 'Real-Time Data Active' : 'Using OCR Data Only'}
                                </span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" checked={isHybridIntelligenceEnabled} onChange={(e) => setIsHybridIntelligenceEnabled(e.target.checked)} disabled={isLoading} />
                                <div className={`w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600`}></div>
                            </label>
                        </div>
                        <div className="text-[10px] text-zinc-600 leading-relaxed bg-black/20 p-3 rounded-lg border border-white/5">
                            <strong className={`uppercase block mb-1 ${isHybridIntelligenceEnabled ? 'text-emerald-500' : 'text-zinc-500'}`}>When Enabled:</strong>
                            Fetches real-time OHLCV from Binance, calculates RSI/MACD/EMAs/ATR via code, and injects verified data into AI prompts.
                        </div>
                    </section>

                    {/* Memory Provider Section */}
                    <section className="rounded-2xl border p-5 bg-gradient-to-br from-purple-950/40 to-zinc-900/50 border-purple-500/30 shadow-lg">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <span className="text-sm font-black uppercase tracking-widest text-purple-400">
                                    Memory Provider
                                </span>
                                <span className="text-xs text-zinc-500 block mt-1">
                                    AI for chat compression & memory updates
                                </span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <select
                                value={memoryProvider}
                                onChange={(e) => {
                                    const newProvider = e.target.value as MemoryProvider;
                                    setMemoryProvider(newProvider);
                                    setMemoryModel(getDefaultModelForProvider(newProvider));
                                }}
                                disabled={isLoading}
                                className="w-full px-3 py-2 bg-zinc-800 border border-purple-500/30 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                            >
                                {MEMORY_PROVIDER_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <select
                                value={memoryModel}
                                onChange={(e) => setMemoryModel(e.target.value)}
                                disabled={isLoading}
                                className="w-full px-3 py-2 bg-zinc-800 border border-purple-500/20 rounded-lg text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                            >
                                {MEMORY_MODELS[memoryProvider]?.map(model => (
                                    <option key={model.value} value={model.value}>{model.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="text-[10px] text-zinc-600 leading-relaxed bg-black/20 p-2 rounded-lg border border-white/5 mt-2">
                            Controls which AI handles chat history compression and global memory updates.
                        </div>
                    </section>

                    {/* Analyst Lenses Section */}
                    <section className="rounded-2xl border p-5 bg-gradient-to-br from-indigo-950/40 to-zinc-900/50 border-indigo-500/30 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg">🎭</span>
                            <span className="text-sm font-black uppercase tracking-widest text-indigo-400">
                                Analyst Lenses
                            </span>
                        </div>
                        <span className="text-xs text-zinc-500 block mb-3">
                            Assign specialized roles to AI providers for ensemble debates
                        </span>
                        <AnalystLensSettings
                            config={lensConfig}
                            enabledProviders={[
                                ...(isGeminiEnabled ? [AIProvider.GEMINI] : []),
                                ...(isDeepSeekEnabled ? [AIProvider.DEEPSEEK] : []),
                                ...(isZhipuEnabled ? [AIProvider.ZHIPU] : []),
                                ...(isGroqEnabled ? [AIProvider.GROQ] : []),
                                ...(isGroqNewEnabled ? [AIProvider.GROQ_NEW] : []),
                                ...(isGroqAlt2Enabled ? [AIProvider.GROQ_ALT2] : []),
                                ...(isOpenrouterEnabled ? [AIProvider.OPENROUTER] : []),
                                ...(isOpenaiEnabled ? [AIProvider.OPENAI] : []),
                                ...(isGrokNativeEnabled ? [AIProvider.GROK] : [])
                            ]}
                            onChange={onSetLensConfig}
                        />
                    </section>

                    <section>
                        <button
                            onClick={() => setIsCustomBehaviorVisible(!isCustomBehaviorVisible)}
                            className="w-full flex justify-between items-center text-left mb-3 group"
                            aria-expanded={isCustomBehaviorVisible}
                        >
                            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1 group-hover:text-zinc-300 transition-colors flex items-center gap-2"><EditIcon className="w-4 h-4" /> Custom AI Logic & Behavior</h3>
                            <ChevronDownIcon className={`w-4 h-4 text-zinc-600 transition-transform ${isCustomBehaviorVisible ? 'rotate-180' : ''}`} />
                        </button>

                        <div className={`collapsible-content ${isCustomBehaviorVisible ? 'expanded' : ''}`}>
                            <div className="bg-zinc-950/50 rounded-xl border border-white/5 p-4 space-y-4">
                                <p className="text-[10px] text-zinc-500 leading-relaxed">
                                    Define multiple custom instruction sets for how the AI should reason, behave, or filter trades.
                                    <strong> Select the mode below to manage its instructions.</strong>
                                </p>

                                {/* Tabs for Mode Selection */}
                                <div className="flex space-x-1 bg-zinc-900 p-1 rounded-lg">
                                    <button
                                        onClick={() => setActiveInstructionTab('general')}
                                        className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeInstructionTab === 'general' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        Standard
                                    </button>
                                    <button
                                        onClick={() => setActiveInstructionTab('accuracyOriginal')}
                                        className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeInstructionTab === 'accuracyOriginal' ? 'bg-cyan-900/40 text-cyan-200 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        Strict Mode
                                    </button>
                                    <button
                                        onClick={() => setActiveInstructionTab('accuracyPure')}
                                        className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeInstructionTab === 'accuracyPure' ? 'bg-cyan-900/40 text-cyan-200 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        Pure AI
                                    </button>
                                </div>

                                {/* Word Count Progress */}
                                <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                                    <div className="flex justify-between items-center text-[10px] font-mono mb-1.5">
                                        <span className="text-zinc-500 uppercase font-bold tracking-wider">Token Usage</span>
                                        <span className={`${totalWordCount > MAX_WORD_COUNT ? 'text-red-400 font-bold' : 'text-zinc-400'}`}>
                                            {totalWordCount} / {MAX_WORD_COUNT} words
                                        </span>
                                    </div>
                                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${totalWordCount > MAX_WORD_COUNT ? 'bg-red-500' : 'bg-cyan-600'}`}
                                            style={{ width: `${Math.min(100, (totalWordCount / MAX_WORD_COUNT) * 100)}%` }}
                                        ></div>
                                    </div>
                                </div>

                                {/* Instruction List */}
                                <div className="space-y-3">
                                    {currentInstructions.length === 0 ? (
                                        <div className="text-center py-6 border border-dashed border-white/10 rounded-lg">
                                            <p className="text-xs text-zinc-600 italic">No custom instructions yet.</p>
                                        </div>
                                    ) : (
                                        currentInstructions.map(inst => (
                                            <InstructionCard
                                                key={inst.id}
                                                instruction={inst}
                                                onUpdate={handleUpdateInstruction}
                                                onDelete={handleDeleteInstruction}
                                            />
                                        ))
                                    )}
                                </div>

                                {/* Add Button */}
                                <button
                                    onClick={handleAddInstruction}
                                    disabled={currentInstructions.length >= MAX_ITEMS}
                                    className="w-full py-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <EditIcon className="w-3 h-3" /> Add New Instruction ({currentInstructions.length}/{MAX_ITEMS})
                                </button>

                            </div>
                        </div>
                    </section>

                    {/* ... Rest of settings (Quick Actions, Memory, Ensemble) remains the same ... */}
                    <section className="rounded-2xl bg-zinc-900/50 border border-white/5 p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <span className="text-lg">⚡</span> Quick Actions
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={onOpenSavedAnalyses} className="p-4 rounded-2xl bg-zinc-800/50 border border-white/5 text-left hover:bg-white/5 hover:border-purple-500/30 transition-all group">
                                <BookmarkIcon className="text-purple-400 mb-2 group-hover:scale-110 transition-transform" />
                                <span className="block text-sm font-semibold text-zinc-200">Saved</span>
                                <span className="text-xs text-zinc-500">Review analyses</span>
                            </button>
                            <button onClick={onOpenStrategySearch} className="p-4 rounded-2xl bg-zinc-800/50 border border-white/5 text-left hover:bg-white/5 hover:border-emerald-500/30 transition-all group">
                                <SearchIcon className="text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
                                <span className="block text-sm font-semibold text-zinc-200">Playbook</span>
                                <span className="text-xs text-zinc-500">Manage strategies</span>
                            </button>
                            <button onClick={onSwitchUser} className="p-4 rounded-2xl bg-zinc-800/50 border border-white/5 text-left hover:bg-white/5 hover:border-blue-500/30 transition-all group">
                                <SwitchUserIcon className="text-blue-400 mb-2 group-hover:scale-110 transition-transform" />
                                <span className="block text-sm font-semibold text-zinc-200">Profile</span>
                                <span className="text-xs text-zinc-500">Switch user</span>
                            </button>
                            <button onClick={onExportData} className="p-4 rounded-2xl bg-zinc-800/50 border border-white/5 text-left hover:bg-white/5 hover:border-orange-500/30 transition-all group">
                                <ExportIcon className="text-orange-400 mb-2 group-hover:scale-110 transition-transform" />
                                <span className="block text-sm font-semibold text-zinc-200">Export</span>
                                <span className="text-xs text-zinc-500">Backup data</span>
                            </button>
                        </div>
                    </section>

                    <section className="rounded-2xl bg-zinc-900/50 border border-white/5 overflow-hidden">
                        <button
                            onClick={() => setIsMemoryConfigVisible(!isMemoryConfigVisible)}
                            className="w-full flex justify-between items-center text-left mb-3 group"
                            aria-expanded={isMemoryConfigVisible}
                        >
                            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1 group-hover:text-zinc-300 transition-colors flex items-center gap-2"><BrainIcon className="w-4 h-4" /> Memory Architecture</h3>
                            <ChevronDownIcon className={`w-4 h-4 text-zinc-600 transition-transform ${isMemoryConfigVisible ? 'rotate-180' : ''}`} />
                        </button>

                        <div className={`collapsible-content ${isMemoryConfigVisible ? 'expanded' : ''}`}>
                            <div className="bg-zinc-950/50 rounded-xl border border-white/5 p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <span className="text-sm font-bold text-zinc-200 block">Global Pattern Memory</span>
                                        <span className="text-xs text-zinc-500 block mt-1">Allow AI to learn from all conversations.</span>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" className="sr-only peer" checked={isGlobalMemoryEnabled} onChange={(e) => setIsGlobalMemoryEnabled(e.target.checked)} disabled={isLoading} />
                                        <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                                    </label>
                                </div>
                                <div className="text-[10px] text-zinc-600 leading-relaxed bg-black/20 p-3 rounded-lg border border-white/5">
                                    <strong className="text-zinc-500 uppercase block mb-1">Layer 1 & 2 (Always On):</strong> Isolated memory per chat thread.<br />
                                    <strong className={`uppercase block mb-1 mt-2 ${isGlobalMemoryEnabled ? 'text-cyan-500' : 'text-zinc-500'}`}>Layer 3 (Global):</strong> Synthesized learning from all trades.
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl bg-zinc-900/50 border border-white/5 overflow-hidden">
                        <button
                            onClick={() => setIsModelConfigVisible(!isModelConfigVisible)}
                            className="w-full flex justify-between items-center text-left p-5 border-b border-white/5 hover:bg-white/5 transition-all group"
                            aria-expanded={isModelConfigVisible}
                        >
                            <h3 className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                                <span className="text-lg">🤖</span> AI Models & Ensemble
                            </h3>
                            <ChevronDownIcon className={`w-5 h-5 text-zinc-500 transition-transform ${isModelConfigVisible ? 'rotate-180' : ''}`} />
                        </button>

                        <div className={`collapsible-content ${isModelConfigVisible ? 'expanded' : ''}`}>
                            <div className="p-4 space-y-3">
                                {/* Gemini */}
                                <div className={`bg-zinc-900/80 rounded-xl border border-white/5 p-3 flex items-center justify-between hover:border-blue-500/30 transition-all `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-blue-400 block mb-1.5 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                            Gemini
                                        </label>
                                        <select value={selectedGeminiModel} onChange={(e) => onSetGeminiModel(e.target.value)} className="w-full bg-zinc-950/80 backdrop-blur border border-white/10 rounded-lg text-sm p-2.5 text-zinc-300 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 focus:outline-none transition-all hover:border-white/20 cursor-pointer appearance-none" disabled={isLoading}>
                                            {(geminiModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isGeminiEnabled} onChange={() => onToggleProvider('gemini')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded-lg text-blue-600 focus:ring-blue-600/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>

                                {/* DeepSeek */}
                                <div className={`bg-zinc-900/80 rounded-xl border border-white/5 p-3 flex items-center justify-between hover:border-emerald-500/30 transition-all `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-emerald-400 block mb-1.5 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                            DeepSeek
                                        </label>
                                        <select value={selectedDeepSeekModel} onChange={(e) => onSetDeepseekModel(e.target.value)} className="w-full bg-zinc-950/80 backdrop-blur border border-white/10 rounded-lg text-sm p-2.5 text-zinc-300 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 focus:outline-none transition-all hover:border-white/20 cursor-pointer appearance-none" disabled={isLoading}>
                                            {(deepseekModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isDeepSeekEnabled} onChange={() => onToggleProvider('deepseek')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded-lg text-emerald-600 focus:ring-emerald-600/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>

                                {/* Zhipu */}
                                <div className={`bg-zinc-900/80 rounded-xl border border-white/5 p-3 flex items-center justify-between hover:border-orange-500/30 transition-all `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-orange-400 block mb-1.5 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                            Zhipu AI
                                        </label>
                                        <select value={selectedZhipuModel} onChange={(e) => onSetZhipuModel(e.target.value)} className="w-full bg-zinc-950/80 backdrop-blur border border-white/10 rounded-lg text-sm p-2.5 text-zinc-300 focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 focus:outline-none transition-all hover:border-white/20 cursor-pointer appearance-none" disabled={isLoading}>
                                            {(zhipuModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isZhipuEnabled} onChange={() => onToggleProvider('zhipu')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded-lg text-orange-600 focus:ring-orange-600/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>

                                {/* Groq */}
                                <div className={`bg-zinc-900/80 rounded-xl border border-white/5 p-3 flex items-center justify-between hover:border-yellow-500/30 transition-all `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-yellow-400 block mb-1.5 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                                            Groq
                                        </label>
                                        <select value={selectedGroqModel} onChange={(e) => onSetGroqModel(e.target.value)} className="w-full bg-zinc-950/80 backdrop-blur border border-white/10 rounded-lg text-sm p-2.5 text-zinc-300 focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500/50 focus:outline-none transition-all hover:border-white/20 cursor-pointer appearance-none" disabled={isLoading}>
                                            {(groqModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isGroqEnabled} onChange={() => onToggleProvider('groq')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded-lg text-yellow-600 focus:ring-yellow-600/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>

                                {/* Groq New (Alt) */}
                                <div className={`bg-zinc-900/80 rounded-xl border border-white/5 p-3 flex items-center justify-between hover:border-yellow-300/30 transition-all `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-yellow-200 block mb-1.5 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-yellow-300"></span>
                                            Groq (Alt)
                                        </label>
                                        <select value={selectedGroqNewModel} onChange={(e) => onSetGroqNewModel(e.target.value)} className="w-full bg-zinc-950/80 backdrop-blur border border-white/10 rounded-lg text-sm p-2.5 text-zinc-300 focus:ring-2 focus:ring-yellow-300/50 focus:border-yellow-300/50 focus:outline-none transition-all hover:border-white/20 cursor-pointer appearance-none" disabled={isLoading}>
                                            {(groqNewModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isGroqNewEnabled} onChange={() => onToggleProvider('groqNew')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded-lg text-yellow-300 focus:ring-yellow-300/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>

                                {/* Groq Alt 2 */}
                                <div className={`bg-zinc-900/80 rounded-xl border border-white/5 p-3 flex items-center justify-between hover:border-amber-500/30 transition-all `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-amber-400 block mb-1.5 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                            Groq (Alt 2)
                                        </label>
                                        <select value={selectedGroqAlt2Model} onChange={(e) => onSetGroqAlt2Model(e.target.value)} className="w-full bg-zinc-950/80 backdrop-blur border border-white/10 rounded-lg text-sm p-2.5 text-zinc-300 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 focus:outline-none transition-all hover:border-white/20 cursor-pointer appearance-none" disabled={isLoading}>
                                            {(groqAlt2Models || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isGroqAlt2Enabled} onChange={() => onToggleProvider('groqAlt2')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded-lg text-amber-400 focus:ring-amber-400/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>




                                {/* OpenRouter (Free API) */}
                                <div className={`bg-zinc-900 rounded-xl border border-green-500/20 p-3 flex items-center justify-between `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-green-400 block mb-1">OpenRouter (Free)</label>
                                        <select value={selectedOpenrouterModel} onChange={(e) => onSetOpenrouterModel(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded text-base sm:text-xs p-2 sm:p-1.5 text-zinc-300 focus:ring-1 focus:ring-green-500 focus:outline-none" disabled={isLoading}>
                                            {(openrouterModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isOpenrouterEnabled} onChange={() => onToggleProvider('openrouter')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded text-green-400 focus:ring-green-400/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>

                                {/* OpenAI (Native API) */}
                                <div className={`bg-zinc-900 rounded-xl border border-teal-500/20 p-3 flex items-center justify-between `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-teal-400 block mb-1">OpenAI (Native)</label>
                                        <select value={selectedOpenaiModel} onChange={(e) => onSetOpenaiModel(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded text-base sm:text-xs p-2 sm:p-1.5 text-zinc-300 focus:ring-1 focus:ring-teal-500 focus:outline-none" disabled={isLoading}>
                                            {(openaiModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isOpenaiEnabled} onChange={() => onToggleProvider('openai')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded text-teal-400 focus:ring-teal-400/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>

                                {/* Grok (xAI Native API) */}
                                <div className={`bg-zinc-900 rounded-xl border border-sky-500/20 p-3 flex items-center justify-between `}>
                                    <div className="flex-1 mr-3">
                                        <label className="text-xs font-bold text-sky-400 block mb-1">Grok (xAI)</label>
                                        <select value={selectedGrokNativeModel} onChange={(e) => onSetGrokNativeModel(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded text-base sm:text-xs p-2 sm:p-1.5 text-zinc-300 focus:ring-1 focus:ring-sky-500 focus:outline-none" disabled={isLoading}>
                                            {(grokModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <input type="checkbox" checked={isGrokNativeEnabled} onChange={() => onToggleProvider('grokNative')} className="w-5 h-5 bg-zinc-800 border-zinc-600 rounded text-sky-400 focus:ring-sky-400/50 cursor-pointer" disabled={isLoading} />
                                    </div>
                                </div>

                                <div className="h-px bg-white/5 my-2"></div>

                                {/* Moderator */}
                                <div className="bg-zinc-950/50 rounded-xl border border-white/5 p-3">
                                    <label className="text-xs font-bold text-zinc-400 block mb-2">Debate Moderator</label>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <select value={moderatorProvider} onChange={(e) => onSetModeratorProvider(e.target.value as AIProvider)} className="w-full sm:w-1/3 bg-zinc-900 border border-white/10 rounded text-base sm:text-xs p-2 sm:p-1.5 text-zinc-300 focus:outline-none">
                                            <option value={AIProvider.GEMINI}>Gemini</option>
                                            <option value={AIProvider.DEEPSEEK}>DeepSeek</option>
                                            <option value={AIProvider.ZHIPU}>Zhipu</option>
                                            <option value={AIProvider.GROQ}>Groq</option>
                                            <option value={AIProvider.GROQ_NEW}>Groq (Alt)</option>
                                            <option value={AIProvider.GROQ_ALT2}>Groq (Alt 2)</option>
                                            <option value={AIProvider.OPENROUTER}>OpenRouter</option>
                                            <option value={AIProvider.OPENAI}>OpenAI</option>
                                            <option value={AIProvider.GROK}>Grok (xAI)</option>
                                        </select>
                                        <select value={moderatorModel} onChange={(e) => onSetModeratorModel(e.target.value)} className="w-full sm:w-2/3 bg-zinc-900 border border-white/10 rounded text-base sm:text-xs p-2 sm:p-1.5 text-zinc-300 focus:outline-none">
                                            {getProviderModels(moderatorProvider).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* Vision */}
                                <div className="bg-zinc-950/50 rounded-xl border border-white/5 p-3">
                                    <label className="text-xs font-bold text-zinc-400 block mb-2">Primary Vision Model</label>
                                    <select value={selectedOcrModel} onChange={(e) => onSetOcrModel(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded text-base sm:text-xs p-2 sm:p-1.5 text-zinc-300 focus:outline-none">
                                        {(ocrModels || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </section>

                </div >
            </aside >
        </>
    );
};

export default React.memo(Settings);


