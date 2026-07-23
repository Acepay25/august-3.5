
import React, { useState } from 'react';
import ImagePreview from '../shared/ImagePreview';
import { PlusIcon, LoadingIcon, SendIcon, ChevronDownIcon, ChevronUpIcon, BotIcon } from '../shared/Icons';
import { ImageMetadata, AnalystLensConfig, AIProvider } from '../../types';
import { OCR_MODELS } from '../../constants/models';

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
    loadingMessage: string | null;
    isSummarizing: boolean;
    isRateLimited: boolean;
    isAnyProviderEnabled: boolean;
    // Ensemble Intelligence Configuration (matching Settings)
    isGeminiEnabled: boolean;
    setIsGeminiEnabled: (enabled: boolean) => void;
    isDeepSeekEnabled: boolean;
    setIsDeepSeekEnabled: (enabled: boolean) => void;
    isZhipuEnabled: boolean;
    setIsZhipuEnabled: (enabled: boolean) => void;
    isGroqEnabled: boolean;
    setIsGroqEnabled: (enabled: boolean) => void;
    isGroqNewEnabled: boolean;
    setIsGroqNewEnabled: (enabled: boolean) => void;
    isGroqAlt2Enabled: boolean;
    setIsGroqAlt2Enabled: (enabled: boolean) => void;
    isOpenrouterEnabled: boolean;
    setIsOpenrouterEnabled: (enabled: boolean) => void;
    isOpenaiEnabled: boolean;
    setIsOpenaiEnabled: (enabled: boolean) => void;
    isGrokNativeEnabled: boolean;
    setIsGrokNativeEnabled: (enabled: boolean) => void;
    // Vision Model Selection
    // Vision Model Selection
    selectedVisionModel: string;
    setSelectedVisionModel: (modelId: string) => void;

    // Lens Config
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
}

// AI Provider configuration for list-style display
const AI_PROVIDERS = [
    { id: 'gemini', name: 'Gemini', description: 'Google AI', icon: '✦', color: 'blue' },
    { id: 'deepseek', name: 'DeepSeek', description: 'Reasoning AI', icon: '◈', color: 'purple' },
    { id: 'zhipu', name: 'Zhipu', description: 'GLM Vision', icon: '◇', color: 'emerald' },
    { id: 'groq', name: 'Groq', description: 'Fast Inference', icon: '⚡', color: 'orange' },
    { id: 'groqNew', name: 'Groq (Alt)', description: 'Kimi K2', icon: '⚡', color: 'amber' },
    { id: 'groqAlt2', name: 'Groq (Alt 2)', description: 'Llama 4', icon: '⚡', color: 'yellow' },
    { id: 'openrouter', name: 'OpenRouter', description: 'Free Models', icon: '◎', color: 'green' },
    { id: 'openai', name: 'OpenAI', description: 'GPT Models', icon: '●', color: 'teal' },
    { id: 'grokNative', name: 'Grok (xAI)', description: 'Grok AI', icon: '◐', color: 'sky' },
];

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
    loadingMessage,
    isSummarizing,
    isRateLimited,
    isAnyProviderEnabled,
    isGeminiEnabled,
    setIsGeminiEnabled,
    isDeepSeekEnabled,
    setIsDeepSeekEnabled,
    isZhipuEnabled,
    setIsZhipuEnabled,
    isGroqEnabled,
    setIsGroqEnabled,
    isGroqNewEnabled,
    setIsGroqNewEnabled,
    isGroqAlt2Enabled,
    setIsGroqAlt2Enabled,
    isOpenrouterEnabled,
    setIsOpenrouterEnabled,
    isOpenaiEnabled,
    setIsOpenaiEnabled,
    isGrokNativeEnabled,
    setIsGrokNativeEnabled,
    selectedVisionModel,
    setSelectedVisionModel,
    lensConfig,
    setLensConfig
}) => {
    const [showAISettings, setShowAISettings] = useState(false);
    const [showLensSettings, setShowLensSettings] = useState(false);

    // Count enabled providers
    const enabledCount = [isGeminiEnabled, isDeepSeekEnabled, isZhipuEnabled, isGroqEnabled, isGroqNewEnabled, isGroqAlt2Enabled, isOpenrouterEnabled, isOpenaiEnabled, isGrokNativeEnabled].filter(Boolean).length;
    // Global limit reached if 3 providers are enabled
    const globalLimitReached = enabledCount >= 3;

    // Map provider ID to enabled state and setter
    const providerStates: Record<string, { enabled: boolean; setEnabled: (v: boolean) => void }> = {
        gemini: { enabled: isGeminiEnabled, setEnabled: setIsGeminiEnabled },
        deepseek: { enabled: isDeepSeekEnabled, setEnabled: setIsDeepSeekEnabled },
        zhipu: { enabled: isZhipuEnabled, setEnabled: setIsZhipuEnabled },
        groq: { enabled: isGroqEnabled, setEnabled: setIsGroqEnabled },
        groqNew: { enabled: isGroqNewEnabled, setEnabled: setIsGroqNewEnabled },
        groqAlt2: { enabled: isGroqAlt2Enabled, setEnabled: setIsGroqAlt2Enabled },
        openrouter: { enabled: isOpenrouterEnabled, setEnabled: setIsOpenrouterEnabled },
        openai: { enabled: isOpenaiEnabled, setEnabled: setIsOpenaiEnabled },
        grokNative: { enabled: isGrokNativeEnabled, setEnabled: setIsGrokNativeEnabled },
    };

    // Get color classes for a provider
    const getColorClasses = (color: string, enabled: boolean): string => {
        if (!enabled) return 'text-zinc-500';
        const colorMap: Record<string, string> = {
            blue: 'text-blue-400',
            purple: 'text-purple-400',
            emerald: 'text-emerald-400',
            orange: 'text-orange-400',
            amber: 'text-amber-400',
            yellow: 'text-yellow-400',
            green: 'text-green-400',
            violet: 'text-violet-400',
            teal: 'text-teal-400',
            sky: 'text-sky-400',
        };
        return colorMap[color] || 'text-cyan-400';
    };

    return (
        <div className="absolute bottom-0 left-0 right-0 px-3 sm:px-4 lg:px-8 pointer-events-none z-10 pb-[calc(env(safe-area-inset-bottom,16px)+0.5rem)] sm:pb-[calc(env(safe-area-inset-bottom,24px)+1rem)] lg:pb-8 transition-all duration-300">
            <div className="w-full lg:max-w-3xl lg:mx-auto pointer-events-auto">
                {/* Main Input Container - Desktop: cleaner centered, Mobile: original */}
                <div className="glass p-3 sm:p-4 lg:p-4 rounded-3xl lg:rounded-2xl shadow-2xl border border-white/10 transition-all focus-within:border-cyan-500/40 lg:focus-within:border-white/20 bg-zinc-900/90 lg:bg-zinc-800 backdrop-blur-xl lg:backdrop-blur-none">

                    {/* Image Preview */}
                    <ImagePreview images={images} onRemoveImage={removeImage} />

                    {/* Main Input Row - Desktop: with inline upload/send */}
                    <div className="flex items-end gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey ? (e.preventDefault(), handleSendMessage()) : null}
                            placeholder={images.length > 0 ? "Analyze charts..." : "Message August"}
                            className="flex-1 bg-transparent px-2 py-2 text-sm lg:text-base text-white placeholder-zinc-500 focus:outline-none transition-all min-h-[44px] lg:min-h-[48px] max-h-32 resize-none leading-relaxed"
                            rows={1}
                            disabled={!!loadingMessage || isRateLimited || !isAnyProviderEnabled}
                            style={{ overflow: 'hidden' }}
                        />

                        {/* Desktop only: inline upload and send buttons */}
                        <div className="hidden lg:flex items-center gap-2">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`h-9 w-9 rounded-full transition-all shrink-0 flex items-center justify-center ${isImageUploadDisabled ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-white'}`}
                                disabled={isImageUploadDisabled}
                                title="Upload charts"
                            >
                                <PlusIcon className="h-5 w-5" />
                            </button>
                            <button
                                onClick={handleSendMessage}
                                disabled={!!loadingMessage || isSummarizing || (!input.trim() && images.length === 0) || isRateLimited || !isAnyProviderEnabled}
                                className="h-9 w-9 rounded-full bg-cyan-500 hover:bg-cyan-400 text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-zinc-600 transition-all flex items-center justify-center shrink-0"
                            >
                                {isSummarizing ? <LoadingIcon className="h-5 w-5" /> : <SendIcon />}
                            </button>
                        </div>
                    </div>
                    <input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" disabled={isImageUploadDisabled} />

                    {/* Bottom Toolbar - Different layouts for mobile vs desktop */}
                    <div className="flex items-center justify-between pt-2 sm:pt-3 mt-2 border-t border-white/5 lg:border-none lg:mt-3 lg:pt-0">
                        {/* Left Side: Action Pills */}
                        <div className="flex items-center gap-1.5 sm:gap-2">
                            {/* Ensemble Button */}
                            <button
                                onClick={() => setShowAISettings(!showAISettings)}
                                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 lg:px-4 py-1 sm:py-1.5 lg:py-2 rounded-full transition-all text-xs sm:text-sm ${showAISettings ? 'bg-cyan-600 text-white' : 'bg-zinc-700/80 lg:bg-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-600'}`}
                            >
                                <span className="font-medium hidden xs:inline sm:inline">Ensemble</span>
                            </button>

                            {/* Lens Mode Split Button */}
                            <div className={`relative group flex items-center shadow-sm rounded-full transition-all ${lensConfig.enabled ? 'bg-indigo-600' : 'bg-zinc-700/80 lg:bg-zinc-700 hover:bg-zinc-600'}`}>
                                {/* Main Toggle */}
                                <button
                                    onClick={() => setLensConfig({ ...lensConfig, enabled: !lensConfig.enabled })}
                                    className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 lg:py-2 transition-all text-xs sm:text-sm border-r border-black/10 rounded-l-full ${lensConfig.enabled ? 'text-white shadow-[inset_0_0_10px_rgba(0,0,0,0.1)]' : 'text-zinc-400 hover:text-white'}`}
                                >
                                    <span className="text-xs sm:text-sm">🎭</span>
                                    <span className="font-medium hidden xs:inline sm:inline">Lenses</span>
                                </button>

                                {/* Dropdown Trigger */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowLensSettings(!showLensSettings);
                                    }}
                                    className={`px-1.5 sm:px-2 py-1 sm:py-1.5 lg:py-2 transition-colors flex items-center justify-center rounded-r-full ${lensConfig.enabled ? 'text-white hover:bg-indigo-700' : 'text-zinc-400 hover:text-white hover:bg-zinc-500'}`}
                                >
                                    <ChevronDownIcon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 transition-transform duration-200 ${showLensSettings ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Role Assignment Dropdown */}
                                {showLensSettings && (
                                    <div className="absolute bottom-full left-0 mb-2 w-64 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fade-in divide-y divide-white/5">
                                        <div className="px-3 py-2 bg-zinc-800/50 text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                                            Assign Analysts
                                        </div>
                                        {/* Macro Analyst */}
                                        <div className="p-2">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs">🌊</span>
                                                <span className="text-[10px] font-medium text-zinc-400">Macro & Volatility</span>
                                            </div>
                                            <select
                                                value={lensConfig.assignments?.find(a => a.role === 'macro_volatility')?.assignedProvider || ''}
                                                onChange={(e) => {
                                                    const newConfig = { ...lensConfig };
                                                    if (!newConfig.assignments) newConfig.assignments = [];
                                                    const idx = newConfig.assignments.findIndex(a => a.role === 'macro_volatility');
                                                    if (idx >= 0) {
                                                        newConfig.assignments[idx].assignedProvider = e.target.value as AIProvider;
                                                    } else {
                                                        // @ts-ignore
                                                        newConfig.assignments.push({ role: 'macro_volatility', assignedProvider: e.target.value as AIProvider });
                                                    }
                                                    setLensConfig(newConfig);
                                                }}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50"
                                            >
                                                <option value="" disabled>Select Provider</option>
                                                {isGeminiEnabled && <option value="gemini">Gemini</option>}
                                                {isDeepSeekEnabled && <option value="deepseek">DeepSeek</option>}
                                                {isZhipuEnabled && <option value="zhipu">ZhipuGLM</option>}
                                                {isGroqEnabled && <option value="groq">Groq (LLaMA)</option>}
                                                {isGroqNewEnabled && <option value="groq_new">Groq (Alt)</option>}
                                                {isGroqAlt2Enabled && <option value="groq_alt2">Groq (Alt 2)</option>}
                                                {isOpenrouterEnabled && <option value="openrouter">OpenRouter</option>}
                                                {isOpenaiEnabled && <option value="openai">OpenAI</option>}
                                                {isGrokNativeEnabled && <option value="grok">Grok</option>}
                                            </select>
                                        </div>

                                        {/* Technical Analyst */}
                                        <div className="p-2">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs">📊</span>
                                                <span className="text-[10px] font-medium text-zinc-400">Technical Analyst</span>
                                            </div>
                                            <select
                                                value={lensConfig.assignments?.find(a => a.role === 'technical_analyst')?.assignedProvider || ''}
                                                onChange={(e) => {
                                                    const newConfig = { ...lensConfig };
                                                    if (!newConfig.assignments) newConfig.assignments = [];
                                                    const idx = newConfig.assignments.findIndex(a => a.role === 'technical_analyst');
                                                    if (idx >= 0) {
                                                        newConfig.assignments[idx].assignedProvider = e.target.value as AIProvider;
                                                    } else {
                                                        // @ts-ignore
                                                        newConfig.assignments.push({ role: 'technical_analyst', assignedProvider: e.target.value as AIProvider });
                                                    }
                                                    setLensConfig(newConfig);
                                                }}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50"
                                            >
                                                <option value="" disabled>Select Provider</option>
                                                {isGeminiEnabled && <option value="gemini">Gemini</option>}
                                                {isDeepSeekEnabled && <option value="deepseek">DeepSeek</option>}
                                                {isZhipuEnabled && <option value="zhipu">ZhipuGLM</option>}
                                                {isGroqEnabled && <option value="groq">Groq (LLaMA)</option>}
                                                {isGroqNewEnabled && <option value="groq_new">Groq (Alt)</option>}
                                                {isGroqAlt2Enabled && <option value="groq_alt2">Groq (Alt 2)</option>}
                                                {isOpenrouterEnabled && <option value="openrouter">OpenRouter</option>}
                                                {isOpenaiEnabled && <option value="openai">OpenAI</option>}
                                                {isGrokNativeEnabled && <option value="grok">Grok</option>}
                                            </select>
                                        </div>

                                        {/* Risk Manager */}
                                        <div className="p-2">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs">🛡️</span>
                                                <span className="text-[10px] font-medium text-zinc-400">Risk Manager</span>
                                            </div>
                                            <select
                                                value={lensConfig.assignments?.find(a => a.role === 'risk_execution')?.assignedProvider || ''}
                                                onChange={(e) => {
                                                    const newConfig = { ...lensConfig };
                                                    if (!newConfig.assignments) newConfig.assignments = [];
                                                    const idx = newConfig.assignments.findIndex(a => a.role === 'risk_execution');
                                                    if (idx >= 0) {
                                                        newConfig.assignments[idx].assignedProvider = e.target.value as AIProvider;
                                                    } else {
                                                        // @ts-ignore
                                                        newConfig.assignments.push({ role: 'risk_execution', assignedProvider: e.target.value as AIProvider });
                                                    }
                                                    setLensConfig(newConfig);
                                                }}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50"
                                            >
                                                <option value="" disabled>Select Provider</option>
                                                {isGeminiEnabled && <option value="gemini">Gemini</option>}
                                                {isDeepSeekEnabled && <option value="deepseek">DeepSeek</option>}
                                                {isZhipuEnabled && <option value="zhipu">ZhipuGLM</option>}
                                                {isGroqEnabled && <option value="groq">Groq (LLaMA)</option>}
                                                {isGroqNewEnabled && <option value="groq_new">Groq (Alt)</option>}
                                                {isGroqAlt2Enabled && <option value="groq_alt2">Groq (Alt 2)</option>}
                                                {isOpenrouterEnabled && <option value="openrouter">OpenRouter</option>}
                                                {isOpenaiEnabled && <option value="openai">OpenAI</option>}
                                                {isGrokNativeEnabled && <option value="grok">Grok</option>}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Leverage Button - Visible on all screens */}
                            <div className="relative" ref={leverageRef}>
                                <button
                                    onClick={() => setIsLeverageDropdownOpen(!isLeverageDropdownOpen)}
                                    className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full transition-all text-xs sm:text-sm ${isLeverageDropdownOpen ? 'bg-zinc-700 text-white' : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                                >
                                    <span className="text-xs sm:text-sm">🌐</span>
                                    <span className="font-medium">{leverageInput}x</span>
                                </button>
                                {isLeverageDropdownOpen && (
                                    <div className="absolute bottom-full left-0 mb-2 w-28 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fade-in">
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
                                                className="w-full bg-zinc-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm font-mono text-cyan-300 focus:outline-none focus:border-cyan-500/50"
                                                min="1"
                                                max="125"
                                                placeholder="Custom"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right Side: Upload + Send - Mobile only */}
                        <div className="flex lg:hidden items-center gap-1.5 sm:gap-2">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`h-8 w-8 sm:h-10 sm:w-10 rounded-full transition-all shrink-0 flex items-center justify-center ${isImageUploadDisabled ? 'text-zinc-600 bg-zinc-800/50 cursor-not-allowed' : 'text-zinc-400 bg-zinc-800/80 hover:text-white hover:bg-zinc-700'}`}
                                disabled={isImageUploadDisabled}
                                title="Upload charts"
                            >
                                <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                            </button>
                            <button
                                onClick={handleSendMessage}
                                disabled={!!loadingMessage || isSummarizing || (!input.trim() && images.length === 0) || isRateLimited || !isAnyProviderEnabled}
                                className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center shrink-0"
                            >
                                {isSummarizing ? <LoadingIcon className="h-4 w-4 sm:h-5 sm:w-5" /> : <SendIcon />}
                            </button>
                        </div>
                    </div>

                    {/* Ensemble Intelligence Panel - List Style */}
                    {showAISettings && (
                        <div className="mt-4 bg-zinc-900/80 rounded-2xl border border-white/10 overflow-hidden animate-fade-in">
                            {/* AI Providers List */}
                            <div className="max-h-[300px] overflow-y-auto">
                                {AI_PROVIDERS.map((provider, index) => {
                                    const state = providerStates[provider.id];
                                    const isEnabled = state?.enabled || false;
                                    const isDisabled = !isEnabled && globalLimitReached;

                                    return (
                                        <button
                                            key={provider.id}
                                            onClick={() => state?.setEnabled(!isEnabled)}
                                            disabled={isDisabled}
                                            className={`w-full flex items-center justify-between px-4 py-3 transition-all ${index !== 0 ? 'border-t border-white/5' : ''
                                                } ${isEnabled
                                                    ? 'bg-cyan-500/10'
                                                    : isDisabled
                                                        ? 'opacity-40 cursor-not-allowed'
                                                        : 'hover:bg-white/5'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className={`text-lg ${getColorClasses(provider.color, isEnabled)}`}>
                                                    {provider.icon}
                                                </span>
                                                <div className="text-left">
                                                    <div className={`text-sm font-medium ${isEnabled ? 'text-white' : 'text-zinc-300'}`}>
                                                        {provider.name}
                                                    </div>
                                                    <div className="text-[11px] text-zinc-500">
                                                        {isDisabled ? 'Limit reached' : provider.description}
                                                    </div>
                                                </div>
                                            </div>
                                            {isEnabled && (
                                                <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center">
                                                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>



                            {/* Vision Model Selector */}
                            <div className="px-4 py-3 border-t border-white/10 bg-white/[0.02]">
                                <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-2">Vision Model</div>
                                <select
                                    value={selectedVisionModel}
                                    onChange={(e) => setSelectedVisionModel(e.target.value)}
                                    className="w-full bg-zinc-800/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-cyan-500/50"
                                >
                                    {OCR_MODELS.map(model => (
                                        <option key={model.id} value={model.id} className="bg-zinc-900">
                                            {model.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Warning if no providers enabled */}
                            {enabledCount === 0 && (
                                <div className="px-4 py-3 text-[11px] text-red-400 bg-red-500/10 border-t border-red-500/20">
                                    ⚠️ Enable at least one AI provider to send messages
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const ChatInput = React.memo(ChatInputInner);
