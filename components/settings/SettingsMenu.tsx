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
import { AIProvider, AccuracySubMode, CustomInstructionsMap, AnalystLensConfig, ProviderConfig, ApiFormat } from '../../types';
import { AnalystLensSettings } from './AnalystLensSettings';
import ProviderManager from './ProviderManager';
import { ToggleSwitch } from './SettingsToggle';
import CustomInstructionsEditor, { InstructionTab } from './CustomInstructionsEditor';
import MemorySettings from './MemorySettings';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { APP_NAME, APP_VERSION } from '../../constants/version';

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

// Color class lookup — avoids dynamic Tailwind classes that the JIT can't detect
const COLOR_CLASSES: Record<string, { dot: string; text: string; border: string }> = {
    cyan: { dot: 'bg-cyan-500', text: 'text-cyan-400', border: 'border-cyan-500/30' },
    blue: { dot: 'bg-blue-500', text: 'text-blue-400', border: 'border-blue-500/30' },
    emerald: { dot: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    orange: { dot: 'bg-orange-500', text: 'text-orange-400', border: 'border-orange-500/30' },
    yellow: { dot: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500/30' },
    amber: { dot: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/30' },
    green: { dot: 'bg-green-500', text: 'text-green-400', border: 'border-green-500/30' },
    red: { dot: 'bg-red-500', text: 'text-red-400', border: 'border-red-500/30' },
    purple: { dot: 'bg-purple-500', text: 'text-purple-400', border: 'border-purple-500/30' },
    violet: { dot: 'bg-violet-500', text: 'text-violet-400', border: 'border-violet-500/30' },
    rose: { dot: 'bg-rose-500', text: 'text-rose-400', border: 'border-rose-500/30' },
    zinc: { dot: 'bg-zinc-500', text: 'text-zinc-400', border: 'border-zinc-500/30' },
};

const getColorClasses = (color: string) => COLOR_CLASSES[color] || COLOR_CLASSES.zinc;

// Model Item
const ModelItem: React.FC<{
    name: string;
    color: string;
    models: { id: string; name: string }[];
    selectedModel: string;
    onSetModel: (id: string) => void;
    isEnabled: boolean;
    onToggle: () => void;
}> = ({ name, color, models, selectedModel, onSetModel, isEnabled, onToggle }) => {
    const colors = getColorClasses(color);
    return (
    <div className={`p-4 rounded-2xl bg-zinc-900/50 border transition-all ${isEnabled ? colors.border : 'border-white/5'}`}>
        <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${colors.dot}`}></span>
                <span className={`text-sm font-bold ${isEnabled ? colors.text : 'text-zinc-500'}`}>{name}</span>
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
};

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
    memoryConfig: ProviderConfig | null;
    onMemoryConfigChange: (config: ProviderConfig | null) => void;
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
    // Provider configuration
    providerConfigs?: ProviderConfig[];
    onUpdateProvider?: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    onAddCustomProvider?: (provider: { name: string; baseUrl: string; apiKey: string; apiFormat: ApiFormat; models?: string[]; selectedModel?: string }) => Promise<void>;
    onRemoveProvider?: (id: string) => Promise<void>;
    onToggleProviderConfig?: (id: string) => Promise<void>;
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
        memoryConfig,
        onMemoryConfigChange,
        memoryModel,
        setMemoryModel,
        providerConfigs,
        onUpdateProvider,
        onAddCustomProvider,
        onRemoveProvider,
        onToggleProviderConfig,
    } = props;

    const [currentView, setCurrentView] = useState<ViewType>('main');
    // Kept here (rather than inside CustomInstructionsEditor) so the selected
    // tab persists while navigating between settings views.
    const [activeInstructionTab, setActiveInstructionTab] = useState<InstructionTab>('general');

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
                        <p className="text-[10px] text-zinc-600 leading-relaxed bg-black/20 px-3 py-2 rounded-xl border border-white/5">
                            <strong className={`uppercase block mb-0.5 ${isHybridIntelligenceEnabled ? 'text-emerald-500' : 'text-zinc-500'}`}>When Enabled:</strong>
                            Fetches real-time OHLCV from Binance, calculates RSI/MACD/EMAs/ATR via code, and injects verified data into AI prompts.
                        </p>

                        <SettingItem
                            icon={<span className="text-xl">🧠</span>}
                            title="Global Memory"
                            description={isGlobalMemoryEnabled ? 'Learning enabled' : 'Disabled'}
                            rightElement={<ToggleSwitch checked={isGlobalMemoryEnabled} onChange={setIsGlobalMemoryEnabled} />}
                            active={isGlobalMemoryEnabled}
                        />
                        <p className="text-[10px] text-zinc-600 leading-relaxed bg-black/20 px-3 py-2 rounded-xl border border-white/5">
                            <strong className="text-zinc-500 uppercase block mb-0.5">Layer 1 &amp; 2 (Always On):</strong> Isolated memory per chat thread.<br />
                            <strong className={`uppercase block mb-0.5 mt-1.5 ${isGlobalMemoryEnabled ? 'text-cyan-500' : 'text-zinc-500'}`}>Layer 3 (Global):</strong> Synthesized learning from all trades.
                        </p>
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
                    Configure your AI providers in the API Configuration section below. Add any provider, set its API key, base URL, and model.
                </p>

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
                            onChange={(e) => onSetModeratorProvider?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-cyan-500/50 focus:outline-none"
                        >
                            {(providerConfigs ?? []).length > 0 ? (
                                (providerConfigs ?? []).map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))
                            ) : (
                                <option value="" disabled>No providers configured</option>
                            )}
                        </select>
                        <select
                            value={moderatorModel || ''}
                            onChange={(e) => onSetModeratorModel?.(e.target.value)}
                            className="w-full bg-zinc-800 border border-white/10 rounded-xl text-sm p-3 text-zinc-300 focus:ring-2 focus:ring-cyan-500/50 focus:outline-none"
                        >
                            {(() => {
                                const selectedCfg = (providerConfigs ?? []).find(c => c.id === moderatorProvider);
                                if (selectedCfg && selectedCfg.models.length > 0) {
                                    return selectedCfg.models.map(m => <option key={m} value={m}>{m}</option>);
                                }
                                return <option value="" disabled>Select a provider first</option>;
                            })()}
                        </select>
                    </div>
                </div>

                {/* Memory Provider */}
                <MemorySettings
                    providerConfigs={providerConfigs ?? []}
                    memoryConfig={memoryConfig}
                    onMemoryConfigChange={onMemoryConfigChange}
                />

                {/* API Configuration */}
                <div className="pt-2">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-lg">🔑</span>
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">API Configuration</h3>
                    </div>
                    <p className="text-[10px] text-zinc-600 mb-3">Add and manage your AI providers here. Each provider needs an API key, base URL, and model.</p>
                    {providerConfigs && onUpdateProvider && onAddCustomProvider && onRemoveProvider && onToggleProviderConfig ? (
                        <ProviderManager
                            configs={providerConfigs}
                            onUpdateProvider={onUpdateProvider}
                            onAddCustomProvider={onAddCustomProvider}
                            onRemoveProvider={onRemoveProvider}
                            onToggleProvider={onToggleProviderConfig}
                        />
                    ) : (
                        <p className="text-xs text-zinc-500">Provider configuration not available.</p>
                    )}
                </div>
            </div>
        </>
    );

    // Lenses View    // Lenses View
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
            <CustomInstructionsEditor
                customInstructions={customInstructions}
                setCustomInstructions={setCustomInstructions}
                activeTab={activeInstructionTab}
                onTabChange={setActiveInstructionTab}
            />
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

                {/* Footer: Diagnostics + Version */}
                <div className="border-t border-white/5 px-5 py-4 space-y-3">
                    <DiagnosticsPanel />
                    <p className="text-[10px] text-zinc-600 text-center">
                        {APP_NAME} v{APP_VERSION}
                    </p>
                </div>
            </aside>
        </>
    );
};

export default React.memo(SettingsMenu);
