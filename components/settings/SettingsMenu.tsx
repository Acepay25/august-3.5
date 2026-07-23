/**
 * SettingsMenu - Modern ChatGPT/Gemini-style Settings Panel
 * 
 * Features:
 * - Drill-down navigation for Advanced settings
 * - AI Models configuration inline
 * - Analyst Lenses integration
 * - Custom Instructions editor
 */

import React, { useState } from 'react';
import { AIProvider, AccuracySubMode, CustomInstructionsMap, CustomInstruction, AnalystLensConfig } from '../../../types';
import { MemoryProvider, MEMORY_PROVIDER_OPTIONS, MEMORY_MODELS } from '../../services/learning/MemoryService';
import { AnalystLensSettings } from './AnalystLensSettings';

// Icons
const CloseIcon = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const BackIcon = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
);

const ChevronRightIcon = () => (
    <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
);

// Toggle Switch
const ToggleSwitch: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}> = ({ checked, onChange, disabled = false }) => (
    <label className="relative inline-flex items-center cursor-pointer">
        <input
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
        />
        <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600 peer-disabled:opacity-50"></div>
    </label>
);

// Setting Item
const SettingItem: React.FC<{
    icon: React.ReactNode;
    title: string;
    description?: string;
    rightElement?: React.ReactNode;
    onClick?: () => void;
    active?: boolean;
}> = ({ icon, title, description, rightElement, onClick, active = false }) => {
    const Wrapper = onClick ? 'button' : 'div';
    return (
        <Wrapper
            onClick={onClick}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${onClick ? 'hover:bg-white/5 active:bg-white/10 cursor-pointer' : ''
                } ${active ? 'bg-cyan-500/10 border border-cyan-500/30' : 'bg-zinc-900/50 border border-white/5'}`}
        >
            <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${active ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-800 text-zinc-400'
                }`}>
                {icon}
            </div>
            <div className="flex-1 text-left min-w-0">
                <div className={`font-semibold text-sm ${active ? 'text-cyan-100' : 'text-zinc-200'}`}>{title}</div>
                {description && <div className="text-xs text-zinc-500 mt-0.5 truncate">{description}</div>}
            </div>
            {rightElement && <div className="flex-shrink-0">{rightElement}</div>}
            {onClick && !rightElement && <ChevronRightIcon />}
        </Wrapper>
    );
};

// Section Header
const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 px-1">{title}</h3>
);

// Model Item
const ModelItem: React.FC<{
    name: string;
    color: string;
    models: { id: string; name: string }[];
    selectedModel: string;
    onSetModel: (id: string) => void;
    isEnabled: boolean;
    onToggle: () => void;
}> = ({ name, color, models, selectedModel, onSetModel, isEnabled, onToggle }) => (
    <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isEnabled ? `border-${color}-500/30` : 'border-white/5'}`}>
        <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full bg-${color}-500`}></span>
                <span className={`text-sm font-bold ${isEnabled ? `text-${color}-400` : 'text-zinc-500'}`}>{name}</span>
            </div>
            <ToggleSwitch checked={isEnabled} onChange={onToggle} />
        </div>
        {isEnabled && (
            <select
                value={selectedModel}
                onChange={(e) => onSetModel(e.target.value)}
                className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-cyan-500/50 focus:outline-none"
            >
                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
        )}
    </div>
);

// View types
type ViewType = 'main' | 'models' | 'lenses' | 'instructions';

// Props interface
interface SettingsMenuProps {
    isVisible: boolean;
    onClose: () => void;
    isLoading: boolean;
    // Quick Actions
    onOpenSavedAnalyses: () => void;
    onOpenStrategySearch: () => void;
    onSwitchUser: () => void;
    onExportData: () => void;
    // Accuracy Mode
    isAccuracyModeEnabled: boolean;
    onToggleAccuracyMode: () => void;
    accuracySubMode: AccuracySubMode;
    setAccuracySubMode: (mode: AccuracySubMode) => void;
    // Hybrid Intelligence
    isHybridIntelligenceEnabled: boolean;
    setIsHybridIntelligenceEnabled: (enabled: boolean) => void;
    // Memory
    isGlobalMemoryEnabled: boolean;
    setIsGlobalMemoryEnabled: (enabled: boolean) => void;
    memoryProvider: MemoryProvider;
    setMemoryProvider: (provider: MemoryProvider) => void;
    memoryModel: string;
    setMemoryModel: (model: string) => void;
    // Pure AI toggles
    isPlaybookEnabledInPureAI: boolean;
    setIsPlaybookEnabledInPureAI: (enabled: boolean) => void;
    isFamiliesEnabledInPureAI: boolean;
    setIsFamiliesEnabledInPureAI: (enabled: boolean) => void;
    isMemoryEnabledInPureAI: boolean;
    setIsMemoryEnabledInPureAI: (enabled: boolean) => void;
    // Custom Instructions
    customInstructions: CustomInstructionsMap;
    setCustomInstructions: (instructions: CustomInstructionsMap) => void;
    // Lens Config
    lensConfig: AnalystLensConfig;
    onSetLensConfig: (config: AnalystLensConfig) => void;
    // Model Configuration - All Providers
    geminiModels?: { id: string; name: string }[];
    deepseekModels?: { id: string; name: string }[];
    zhipuModels?: { id: string; name: string }[];
    groqModels?: { id: string; name: string }[];
    groqNewModels?: { id: string; name: string }[];
    groqAlt2Models?: { id: string; name: string }[];
    openrouterModels?: { id: string; name: string }[];
    openaiModels?: { id: string; name: string }[];
    grokNativeModels?: { id: string; name: string }[];

    // Selected Models
    selectedGeminiModel?: string;
    selectedDeepSeekModel?: string;
    selectedZhipuModel?: string;
    selectedGroqModel?: string;
    selectedGroqNewModel?: string;
    selectedGroqAlt2Model?: string;
    selectedOpenrouterModel?: string;
    selectedOpenaiModel?: string;
    selectedGrokNativeModel?: string;

    // Set Model Functions
    onSetGeminiModel?: (id: string) => void;
    onSetDeepseekModel?: (id: string) => void;
    onSetZhipuModel?: (id: string) => void;
    onSetGroqModel?: (id: string) => void;
    onSetGroqNewModel?: (id: string) => void;
    onSetGroqAlt2Model?: (id: string) => void;
    onSetOpenrouterModel?: (id: string) => void;
    onSetOpenaiModel?: (id: string) => void;
    onSetGrokNativeModel?: (id: string) => void;

    // Provider Enable Flags
    isGeminiEnabled?: boolean;
    isDeepSeekEnabled?: boolean;
    isZhipuEnabled?: boolean;
    isGroqEnabled?: boolean;
    isGroqNewEnabled?: boolean;
    isGroqAlt2Enabled?: boolean;
    isOpenrouterEnabled?: boolean;
    isOpenaiEnabled?: boolean;
    isGrokNativeEnabled?: boolean;

    onToggleProvider?: (provider: 'gemini' | 'deepseek' | 'zhipu' | 'groq' | 'groqNew' | 'groqAlt2' | 'openrouter' | 'openai' | 'grokNative') => void;
    // OCR/Vision Model
    ocrModels?: { id: string; name: string }[];
    selectedOcrModel?: string;
    onSetOcrModel?: (id: string) => void;
    // Moderator Configuration
    moderatorProvider?: AIProvider;
    moderatorModel?: string;
    onSetModeratorProvider?: (provider: AIProvider) => void;
    onSetModeratorModel?: (modelId: string) => void;
    // Fallback to full settings
    onOpenFullSettings: () => void;
}

const SettingsMenu: React.FC<SettingsMenuProps> = (props) => {
    const {
        isVisible,
        onClose,
        onOpenSavedAnalyses,
        onOpenStrategySearch,
        onSwitchUser,
        onExportData,
        isAccuracyModeEnabled,
        onToggleAccuracyMode,
        accuracySubMode,
        setAccuracySubMode,
        isHybridIntelligenceEnabled,
        setIsHybridIntelligenceEnabled,
        isGlobalMemoryEnabled,
        setIsGlobalMemoryEnabled,
        isPlaybookEnabledInPureAI,
        setIsPlaybookEnabledInPureAI,
        isFamiliesEnabledInPureAI,
        setIsFamiliesEnabledInPureAI,
        isMemoryEnabledInPureAI,
        setIsMemoryEnabledInPureAI,
        customInstructions,
        setCustomInstructions,
        lensConfig,
        onSetLensConfig,
        // Model arrays
        geminiModels = [],
        deepseekModels = [],
        zhipuModels = [],
        groqModels = [],
        groqNewModels = [],
        groqAlt2Models = [],
        openrouterModels = [],
        openaiModels = [],
        grokNativeModels = [],

        // Selected models
        selectedGeminiModel = '',
        selectedDeepSeekModel = '',
        selectedZhipuModel = '',
        selectedGroqModel = '',
        selectedGroqNewModel = '',
        selectedGroqAlt2Model = '',
        selectedOpenrouterModel = '',
        selectedOpenaiModel = '',
        selectedGrokNativeModel = '',

        // Set model functions
        onSetGeminiModel,
        onSetDeepseekModel,
        onSetZhipuModel,
        onSetGroqModel,
        onSetGroqNewModel,
        onSetGroqAlt2Model,
        onSetOpenrouterModel,
        onSetOpenaiModel,
        onSetGrokNativeModel,

        // Provider enable flags
        isGeminiEnabled = false,
        isDeepSeekEnabled = false,
        isZhipuEnabled = false,
        isGroqEnabled = false,
        isGroqNewEnabled = false,
        isGroqAlt2Enabled = false,
        isOpenrouterEnabled = false,
        isOpenaiEnabled = false,
        isGrokNativeEnabled = false,

        onToggleProvider,
        // OCR
        ocrModels = [],
        selectedOcrModel = '',
        onSetOcrModel,
        // Moderator
        moderatorProvider,
        moderatorModel,
        onSetModeratorProvider,
        onSetModeratorModel,
        // Memory
        memoryProvider,
        setMemoryProvider,
        memoryModel,
        setMemoryModel,
        onOpenFullSettings,
    } = props;

    const [currentView, setCurrentView] = useState<ViewType>('main');
    const [editingInstruction, setEditingInstruction] = useState<string | null>(null);

    if (!isVisible) return null;

    // Header with back button for sub-views
    const renderHeader = (title: string, showBack: boolean = false) => (
        <header className="shrink-0 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500" />

            <div className="flex items-center gap-3 px-5 pt-6 pb-4">
                {showBack && (
                    <button
                        onClick={() => setCurrentView('main')}
                        className="p-2 -ml-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
                </div>
                <button
                    onClick={onClose}
                    className="p-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all"
                >
                    <CloseIcon />
                </button>
            </div>
        </header>
    );

    // Main Settings View
    const renderMainView = () => (
        <>
            {renderHeader('Settings')}
            <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-6 custom-scrollbar">
                {/* Analysis Mode Section */}
                <section>
                    <SectionHeader title="Analysis Mode" />
                    <div className="space-y-3">
                        <SettingItem
                            icon={<span className="text-xl">🎯</span>}
                            title="Accuracy Mode"
                            description={isAccuracyModeEnabled
                                ? (accuracySubMode === 'original' ? 'Strict Protocol' : 'Pure AI')
                                : 'Standard speed'
                            }
                            rightElement={<ToggleSwitch checked={isAccuracyModeEnabled} onChange={onToggleAccuracyMode} />}
                            active={isAccuracyModeEnabled}
                        />

                        {isAccuracyModeEnabled && (
                            <div className="ml-14 flex gap-2 animate-fade-in">
                                <button
                                    onClick={() => setAccuracySubMode('original')}
                                    className={`flex-1 p-3 rounded-xl text-center transition-all ${accuracySubMode === 'original'
                                        ? 'bg-cyan-500/20 border-2 border-cyan-500 text-cyan-100'
                                        : 'bg-zinc-800/50 border border-white/10 text-zinc-400'
                                        }`}
                                >
                                    <div className="text-xs font-bold">Strict</div>
                                    <div className="text-[10px] opacity-60 mt-0.5">10-Layer</div>
                                </button>
                                <button
                                    onClick={() => setAccuracySubMode('pure_ai')}
                                    className={`flex-1 p-3 rounded-xl text-center transition-all ${accuracySubMode === 'pure_ai'
                                        ? 'bg-cyan-500/20 border-2 border-cyan-500 text-cyan-100'
                                        : 'bg-zinc-800/50 border border-white/10 text-zinc-400'
                                        }`}
                                >
                                    <div className="text-xs font-bold">Pure AI</div>
                                    <div className="text-[10px] opacity-60 mt-0.5">Free-form</div>
                                </button>
                            </div>
                        )}

                        <SettingItem
                            icon={<span className="text-xl">⚡</span>}
                            title="Hybrid Intelligence"
                            description={isHybridIntelligenceEnabled ? 'Real-time data' : 'OCR only'}
                            rightElement={<ToggleSwitch checked={isHybridIntelligenceEnabled} onChange={setIsHybridIntelligenceEnabled} />}
                            active={isHybridIntelligenceEnabled}
                        />

                        <SettingItem
                            icon={<span className="text-xl">🧠</span>}
                            title="Global Memory"
                            description={isGlobalMemoryEnabled ? 'Learning enabled' : 'Disabled'}
                            rightElement={<ToggleSwitch checked={isGlobalMemoryEnabled} onChange={setIsGlobalMemoryEnabled} />}
                            active={isGlobalMemoryEnabled}
                        />
                    </div>
                </section>

                {/* Pure AI Context */}
                {isAccuracyModeEnabled && accuracySubMode === 'pure_ai' && (
                    <section className="animate-fade-in">
                        <SectionHeader title="Pure AI Context" />
                        <div className="space-y-3">
                            <SettingItem
                                icon={<span className="text-lg">📖</span>}
                                title="Strategy Playbook"
                                rightElement={<ToggleSwitch checked={isPlaybookEnabledInPureAI} onChange={setIsPlaybookEnabledInPureAI} />}
                            />
                            <SettingItem
                                icon={<span className="text-lg">👨‍👩‍👧‍👦</span>}
                                title="Market Families"
                                rightElement={<ToggleSwitch checked={isFamiliesEnabledInPureAI} onChange={setIsFamiliesEnabledInPureAI} />}
                            />
                            <SettingItem
                                icon={<span className="text-lg">💭</span>}
                                title="Pattern Memory"
                                rightElement={<ToggleSwitch checked={isMemoryEnabledInPureAI} onChange={setIsMemoryEnabledInPureAI} />}
                            />
                        </div>
                    </section>
                )}

                {/* Quick Actions */}
                <section>
                    <SectionHeader title="Quick Actions" />
                    <div className="grid grid-cols-4 gap-3">
                        <button onClick={onOpenSavedAnalyses} className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-zinc-900/50 border border-white/5 hover:bg-white/5 transition-all active:scale-95">
                            <span className="text-2xl">📋</span>
                            <span className="text-[10px] font-medium text-zinc-400">Saved</span>
                        </button>
                        <button onClick={onOpenStrategySearch} className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-zinc-900/50 border border-white/5 hover:bg-white/5 transition-all active:scale-95">
                            <span className="text-2xl">📖</span>
                            <span className="text-[10px] font-medium text-zinc-400">Playbook</span>
                        </button>
                        <button onClick={onSwitchUser} className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-zinc-900/50 border border-white/5 hover:bg-white/5 transition-all active:scale-95">
                            <span className="text-2xl">👤</span>
                            <span className="text-[10px] font-medium text-zinc-400">Profile</span>
                        </button>
                        <button onClick={onExportData} className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-zinc-900/50 border border-white/5 hover:bg-white/5 transition-all active:scale-95">
                            <span className="text-2xl">💾</span>
                            <span className="text-[10px] font-medium text-zinc-400">Export</span>
                        </button>
                    </div>
                </section>

                {/* Advanced Settings */}
                <section>
                    <SectionHeader title="Advanced" />
                    <div className="space-y-3">
                        <SettingItem
                            icon={<span className="text-xl">🤖</span>}
                            title="AI Models & Providers"
                            description="Configure ensemble intelligence"
                            onClick={() => setCurrentView('models')}
                        />
                        <SettingItem
                            icon={<span className="text-xl">🎭</span>}
                            title="Analyst Lenses"
                            description="Role-based analysis personas"
                            onClick={() => setCurrentView('lenses')}
                        />
                        <SettingItem
                            icon={<span className="text-xl">📝</span>}
                            title="Custom Instructions"
                            description="AI behavior & personality"
                            onClick={() => setCurrentView('instructions')}
                        />
                    </div>
                </section>
            </div>

            {/* Footer Status */}
            {isAccuracyModeEnabled && (
                <footer className="shrink-0 px-5 py-3 border-t border-white/5 bg-cyan-500/5">
                    <div className="flex items-center justify-center gap-2 text-xs text-cyan-400">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                        <span className="font-medium">
                            Accuracy Mode: {accuracySubMode === 'original' ? 'Strict Protocol' : 'Pure AI'}
                        </span>
                    </div>
                </footer>
            )}
        </>
    );

    // Models View
    const renderModelsView = () => (
        <>
            {renderHeader('AI Models & Providers', true)}
            <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-4 custom-scrollbar">
                <p className="text-xs text-zinc-500 mb-4">
                    Enable/disable AI providers for ensemble analysis. Each provider contributes to the final assessment.
                </p>

                {/* Gemini */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isGeminiEnabled ? 'border-blue-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            <span className={`text-sm font-bold ${isGeminiEnabled ? 'text-blue-400' : 'text-zinc-500'}`}>Gemini</span>
                        </div>
                        <ToggleSwitch checked={isGeminiEnabled} onChange={() => onToggleProvider?.('gemini')} />
                    </div>
                    {isGeminiEnabled && geminiModels.length > 0 && (
                        <select
                            value={selectedGeminiModel}
                            onChange={(e) => onSetGeminiModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-blue-500/50 focus:outline-none"
                        >
                            {geminiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>

                {/* DeepSeek */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isDeepSeekEnabled ? 'border-emerald-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span className={`text-sm font-bold ${isDeepSeekEnabled ? 'text-emerald-400' : 'text-zinc-500'}`}>DeepSeek</span>
                        </div>
                        <ToggleSwitch checked={isDeepSeekEnabled} onChange={() => onToggleProvider?.('deepseek')} />
                    </div>
                    {isDeepSeekEnabled && deepseekModels.length > 0 && (
                        <select
                            value={selectedDeepSeekModel}
                            onChange={(e) => onSetDeepseekModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-emerald-500/50 focus:outline-none"
                        >
                            {deepseekModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>

                {/* Zhipu */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isZhipuEnabled ? 'border-orange-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                            <span className={`text-sm font-bold ${isZhipuEnabled ? 'text-orange-400' : 'text-zinc-500'}`}>Zhipu AI</span>
                        </div>
                        <ToggleSwitch checked={isZhipuEnabled} onChange={() => onToggleProvider?.('zhipu')} />
                    </div>
                    {isZhipuEnabled && zhipuModels.length > 0 && (
                        <select
                            value={selectedZhipuModel}
                            onChange={(e) => onSetZhipuModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-orange-500/50 focus:outline-none"
                        >
                            {zhipuModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>

                {/* Groq */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isGroqEnabled ? 'border-yellow-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                            <span className={`text-sm font-bold ${isGroqEnabled ? 'text-yellow-400' : 'text-zinc-500'}`}>Groq</span>
                        </div>
                        <ToggleSwitch checked={isGroqEnabled} onChange={() => onToggleProvider?.('groq')} />
                    </div>
                    {isGroqEnabled && groqModels.length > 0 && (
                        <select
                            value={selectedGroqModel}
                            onChange={(e) => onSetGroqModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-yellow-500/50 focus:outline-none"
                        >
                            {groqModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>

                {/* Groq Alt */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isGroqNewEnabled ? 'border-amber-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                            <span className={`text-sm font-bold ${isGroqNewEnabled ? 'text-amber-400' : 'text-zinc-500'}`}>Groq (Alt)</span>
                        </div>
                        <ToggleSwitch checked={isGroqNewEnabled} onChange={() => onToggleProvider?.('groqNew')} />
                    </div>
                    {isGroqNewEnabled && groqNewModels.length > 0 && (
                        <select
                            value={selectedGroqNewModel}
                            onChange={(e) => onSetGroqNewModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
                        >
                            {groqNewModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>

                {/* Groq Alt 2 */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isGroqAlt2Enabled ? 'border-lime-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-lime-500"></span>
                            <span className={`text-sm font-bold ${isGroqAlt2Enabled ? 'text-lime-400' : 'text-zinc-500'}`}>Groq (Alt 2)</span>
                        </div>
                        <ToggleSwitch checked={isGroqAlt2Enabled} onChange={() => onToggleProvider?.('groqAlt2')} />
                    </div>
                    {isGroqAlt2Enabled && groqAlt2Models.length > 0 && (
                        <select
                            value={selectedGroqAlt2Model}
                            onChange={(e) => onSetGroqAlt2Model?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-lime-500/50 focus:outline-none"
                        >
                            {groqAlt2Models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>

                {/* OpenRouter */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isOpenrouterEnabled ? 'border-pink-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-pink-500"></span>
                            <span className={`text-sm font-bold ${isOpenrouterEnabled ? 'text-pink-400' : 'text-zinc-500'}`}>OpenRouter</span>
                        </div>
                        <ToggleSwitch checked={isOpenrouterEnabled} onChange={() => onToggleProvider?.('openrouter')} />
                    </div>
                    {isOpenrouterEnabled && openrouterModels.length > 0 && (
                        <select
                            value={selectedOpenrouterModel}
                            onChange={(e) => onSetOpenrouterModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-pink-500/50 focus:outline-none"
                        >
                            {openrouterModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>

                {/* OpenAI */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isOpenaiEnabled ? 'border-teal-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                            <span className={`text-sm font-bold ${isOpenaiEnabled ? 'text-teal-400' : 'text-zinc-500'}`}>OpenAI</span>
                        </div>
                        <ToggleSwitch checked={isOpenaiEnabled} onChange={() => onToggleProvider?.('openai')} />
                    </div>
                    {isOpenaiEnabled && openaiModels.length > 0 && (
                        <select
                            value={selectedOpenaiModel}
                            onChange={(e) => onSetOpenaiModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-teal-500/50 focus:outline-none"
                        >
                            {openaiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>



                {/* Grok (xAI Native) */}
                <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isGrokNativeEnabled ? 'border-sky-500/30' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                            <span className={`text-sm font-bold ${isGrokNativeEnabled ? 'text-sky-400' : 'text-zinc-500'}`}>Grok (xAI)</span>
                        </div>
                        <ToggleSwitch checked={isGrokNativeEnabled} onChange={() => onToggleProvider?.('grokNative')} />
                    </div>
                    {isGrokNativeEnabled && grokNativeModels.length > 0 && (
                        <select
                            value={selectedGrokNativeModel}
                            onChange={(e) => onSetGrokNativeModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-sky-500/50 focus:outline-none"
                        >
                            {grokNativeModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    )}
                </div>

                {/* Vision Model */}
                {ocrModels.length > 0 && (
                    <div className="p-4 rounded-2xl bg-zinc-900/50 border border-white/5">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-xl">👁️</span>
                            <span className="text-sm font-bold text-zinc-400">Vision Model</span>
                        </div>
                        <select
                            value={selectedOcrModel}
                            onChange={(e) => onSetOcrModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-cyan-500/50 focus:outline-none"
                        >
                            {ocrModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    </div>
                )}

                {/* Debate Moderator */}
                <div className="p-4 rounded-2xl bg-zinc-900/50 border border-cyan-500/20">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-xl">⚖️</span>
                        <span className="text-sm font-bold text-cyan-400">Debate Moderator</span>
                    </div>
                    <p className="text-xs text-zinc-500 mb-3">The AI that synthesizes ensemble responses into final analysis</p>
                    <div className="space-y-2">
                        <select
                            value={moderatorProvider || ''}
                            onChange={(e) => onSetModeratorProvider?.(e.target.value as AIProvider)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-cyan-500/50 focus:outline-none"
                        >
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
                        {/* Model dropdown based on provider */}
                        <select
                            value={moderatorModel || ''}
                            onChange={(e) => onSetModeratorModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-cyan-500/50 focus:outline-none"
                        >
                            {moderatorProvider === AIProvider.GEMINI && geminiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            {moderatorProvider === AIProvider.DEEPSEEK && deepseekModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            {moderatorProvider === AIProvider.ZHIPU && zhipuModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            {moderatorProvider === AIProvider.GROQ && groqModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            {moderatorProvider === AIProvider.GROQ_NEW && groqNewModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            {moderatorProvider === AIProvider.GROQ_ALT2 && groqAlt2Models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            {moderatorProvider === AIProvider.OPENROUTER && openrouterModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            {moderatorProvider === AIProvider.OPENAI && openaiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            {moderatorProvider === AIProvider.GROK && grokNativeModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    </div>
                </div>

                {/* Memory Provider */}
                <div className="p-4 rounded-2xl bg-zinc-900/50 border border-purple-500/20">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-xl">🧠</span>
                        <span className="text-sm font-bold text-purple-400">Memory Provider</span>
                    </div>
                    <p className="text-xs text-zinc-500 mb-3">The AI that manages pattern memory and trade history</p>
                    <div className="space-y-2">
                        <select
                            value={memoryProvider || ''}
                            onChange={(e) => setMemoryProvider?.(e.target.value as MemoryProvider)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-purple-500/50 focus:outline-none"
                        >
                            {MEMORY_PROVIDER_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        {/* Model dropdown based on provider */}
                        {memoryProvider && MEMORY_MODELS[memoryProvider] && (
                            <select
                                value={memoryModel || ''}
                                onChange={(e) => setMemoryModel?.(e.target.value)}
                                className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-purple-500/50 focus:outline-none"
                            >
                                {MEMORY_MODELS[memoryProvider].map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                {/* More advanced options link */}
                <button
                    onClick={onOpenFullSettings}
                    className="w-full p-4 rounded-2xl bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-white/10 text-zinc-300 hover:text-white hover:border-white/20 transition-all text-sm font-semibold"
                >
                    🔧 More Advanced Options →
                </button>
            </div>
        </>
    );

    // Lenses View
    const renderLensesView = () => {
        // Build list of enabled providers based on component props
        const enabledProviders: AIProvider[] = [];
        if (isGeminiEnabled) enabledProviders.push(AIProvider.GEMINI);
        if (isDeepSeekEnabled) enabledProviders.push(AIProvider.DEEPSEEK);
        if (isZhipuEnabled) enabledProviders.push(AIProvider.ZHIPU);
        if (isGroqEnabled) enabledProviders.push(AIProvider.GROQ);
        if (isGroqNewEnabled) enabledProviders.push(AIProvider.GROQ_NEW);
        if (isGroqAlt2Enabled) enabledProviders.push(AIProvider.GROQ_ALT2);
        if (isOpenrouterEnabled) enabledProviders.push(AIProvider.OPENROUTER);
        if (isOpenaiEnabled) enabledProviders.push(AIProvider.OPENAI);
        if (isGrokNativeEnabled) enabledProviders.push(AIProvider.GROK);

        return (
            <>
                {renderHeader('Analyst Lenses', true)}
                <div className="flex-1 overflow-y-auto px-4 pb-6 custom-scrollbar">
                    <AnalystLensSettings
                        config={lensConfig}
                        onChange={onSetLensConfig}
                        enabledProviders={enabledProviders}
                    />
                </div>
            </>
        );
    };

    // Instructions View
    const renderInstructionsView = () => (
        <>
            {renderHeader('Custom Instructions', true)}
            <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-4 custom-scrollbar">
                <p className="text-xs text-zinc-500 mb-4">
                    Add custom instructions to personalize AI behavior for different analysis modes.
                </p>

                {Object.entries(customInstructions).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <span className="text-4xl mb-4">📝</span>
                        <p className="text-sm text-zinc-500">No custom instructions yet</p>
                        <p className="text-xs text-zinc-600 mt-1">Add instructions in full settings</p>
                        <button
                            onClick={onOpenFullSettings}
                            className="mt-4 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors"
                        >
                            Open Full Settings
                        </button>
                    </div>
                ) : (
                    <>
                        {Object.entries(customInstructions).map(([key, instructionArray]) => {
                            // customInstructions is a map of arrays (general, accuracyOriginal, accuracyPure)
                            const instructions = instructionArray as CustomInstruction[];
                            if (!Array.isArray(instructions) || instructions.length === 0) return null;
                            return instructions.map((inst) => (
                                <div key={inst.id} className="p-4 rounded-2xl bg-zinc-900/50 border border-white/5">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-bold text-zinc-200">{inst.title}</span>
                                        <span className={`text-xs px-2 py-1 rounded-full ${inst.isActive ? 'bg-cyan-500/20 text-cyan-400' : 'bg-zinc-800 text-zinc-500'
                                            }`}>
                                            {inst.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-zinc-500 line-clamp-2">{inst.content}</p>
                                </div>
                            ));
                        })}
                        <button
                            onClick={onOpenFullSettings}
                            className="w-full p-4 rounded-2xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-white/5 transition-all text-sm"
                        >
                            Edit instructions →
                        </button>
                    </>
                )}
            </div>
        </>
    );

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 animate-fade-in"
                onClick={onClose}
            />

            {/* Panel */}
            <aside className="fixed inset-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] bg-zinc-950 z-50 flex flex-col animate-slide-up sm:animate-slide-left">
                {currentView === 'main' && renderMainView()}
                {currentView === 'models' && renderModelsView()}
                {currentView === 'lenses' && renderLensesView()}
                {currentView === 'instructions' && renderInstructionsView()}
            </aside>
        </>
    );
};

export default React.memo(SettingsMenu);
