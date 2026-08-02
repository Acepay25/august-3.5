
import React, { useState } from 'react';
import ImagePreview from '../shared/ImagePreview';
import { PlusIcon, LoadingIcon, SendIcon, ChevronDownIcon, ChevronUpIcon, BotIcon } from '../shared/Icons';
import { ImageMetadata, AnalystLensConfig } from '../../types';

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
    loadingMessage: string | null;
    isSummarizing: boolean;
    isRateLimited: boolean;
    isAnyProviderEnabled: boolean;
    // Ensemble Intelligence Configuration — dynamic provider list
    providers: ProviderConfig[];
    onToggleProvider: (id: string) => void;
    onUpdateProvider?: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    // Vision Model Selection
    selectedVisionModel: string;
    setSelectedVisionModel: (modelId: string) => void;
    // Lens Config
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
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
    loadingMessage,
    isSummarizing,
    isRateLimited,
    isAnyProviderEnabled,
    providers,
    onToggleProvider,
    onUpdateProvider,
    selectedVisionModel,
    setSelectedVisionModel,
    lensConfig,
    setLensConfig
}) => {
    const [showAISettings, setShowAISettings] = useState(false);
    const [showLensSettings, setShowLensSettings] = useState(false);

    return (
        <div className="absolute bottom-0 left-0 right-0 px-3 sm:px-4 lg:px-8 pointer-events-none z-10 pb-[calc(env(safe-area-inset-bottom,16px)+0.5rem)] sm:pb-[calc(env(safe-area-inset-bottom,24px)+1rem)] lg:pb-8 transition-all duration-300">
            <div className="w-full lg:max-w-3xl lg:mx-auto pointer-events-auto">
                {/* Main Input Container - Desktop: cleaner centered, Mobile: original */}
                <div className="glass p-3 sm:p-4 lg:p-4 rounded-2xl shadow-2xl border border-white/10 transition-all bg-zinc-900/90 backdrop-blur-md">

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
                                    <span className="text-xs sm:text-sm"></span>
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
                                                <span className="text-xs"></span>
                                                <span className="text-[10px] font-medium text-zinc-400">Macro & Volatility</span>
                                            </div>
                                            <select
                                                value={lensConfig.assignments?.find(a => a.role === 'macro_volatility')?.assignedProvider || ''}
                                                onChange={(e) => {
                                                    const newConfig = { ...lensConfig };
                                                    if (!newConfig.assignments) newConfig.assignments = [];
                                                    const idx = newConfig.assignments.findIndex(a => a.role === 'macro_volatility');
                                                    if (idx >= 0) {
                                                        newConfig.assignments[idx].assignedProvider = e.target.value;
                                                    } else {
                                                        // @ts-expect-error -- role literal not in LensAssignment union
                                                        newConfig.assignments.push({ role: 'macro_volatility', assignedProvider: e.target.value });
                                                    }
                                                    setLensConfig(newConfig);
                                                }}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50"
                                            >
                                                <option value="" disabled>Select Provider</option>
                                                {providers.filter(p => p.isEnabled).map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Technical Analyst */}
                                        <div className="p-2">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs"></span>
                                                <span className="text-[10px] font-medium text-zinc-400">Technical Analyst</span>
                                            </div>
                                            <select
                                                value={lensConfig.assignments?.find(a => a.role === 'technical_analyst')?.assignedProvider || ''}
                                                onChange={(e) => {
                                                    const newConfig = { ...lensConfig };
                                                    if (!newConfig.assignments) newConfig.assignments = [];
                                                    const idx = newConfig.assignments.findIndex(a => a.role === 'technical_analyst');
                                                    if (idx >= 0) {
                                                        newConfig.assignments[idx].assignedProvider = e.target.value;
                                                    } else {
                                                        // @ts-expect-error -- role literal not in LensAssignment union
                                                        newConfig.assignments.push({ role: 'technical_analyst', assignedProvider: e.target.value });
                                                    }
                                                    setLensConfig(newConfig);
                                                }}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50"
                                            >
                                                <option value="" disabled>Select Provider</option>
                                                {providers.filter(p => p.isEnabled).map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Risk Manager */}
                                        <div className="p-2">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs"></span>
                                                <span className="text-[10px] font-medium text-zinc-400">Risk Manager</span>
                                            </div>
                                            <select
                                                value={lensConfig.assignments?.find(a => a.role === 'risk_execution')?.assignedProvider || ''}
                                                onChange={(e) => {
                                                    const newConfig = { ...lensConfig };
                                                    if (!newConfig.assignments) newConfig.assignments = [];
                                                    const idx = newConfig.assignments.findIndex(a => a.role === 'risk_execution');
                                                    if (idx >= 0) {
                                                        newConfig.assignments[idx].assignedProvider = e.target.value;
                                                    } else {
                                                        // @ts-expect-error -- role literal not in LensAssignment union
                                                        newConfig.assignments.push({ role: 'risk_execution', assignedProvider: e.target.value });
                                                    }
                                                    setLensConfig(newConfig);
                                                }}
                                                className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50"
                                            >
                                                <option value="" disabled>Select Provider</option>
                                                {providers.filter(p => p.isEnabled).map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
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
                                    <span className="text-xs sm:text-sm"></span>
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
                                {providers.length > 0 ? (
                                    providers.map((provider, index) => {
                                        const isConfigured = provider.apiKey.trim().length > 0;
                                        const isEnabled = provider.isEnabled && isConfigured;

                                        return (
                                            <div
                                                key={provider.id}
                                                className={`w-full flex items-center justify-between px-4 py-3 transition-all ${index !== 0 ? 'border-t border-white/5' : ''
                                                    } ${isEnabled
                                                        ? 'bg-cyan-500/10'
                                                        : 'hover:bg-white/5 opacity-60'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <svg className={`w-4 h-4 ${isEnabled ? 'text-cyan-400' : 'text-zinc-500'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                                        <line x1="12" y1="22.08" x2="12" y2="12" />
                                                    </svg>
                                                    <div className="text-left">
                                                        <div className={`text-sm font-medium ${isEnabled ? 'text-white' : 'text-zinc-400'}`}>
                                                            {provider.name}
                                                        </div>
                                                        <div className="mt-1 flex items-center gap-1.5">
                                                            <select
                                                                value={provider.selectedModel || provider.models[0] || ''}
                                                                onChange={(e) => {
                                                                    const selected = e.target.value;
                                                                    if (onUpdateProvider) onUpdateProvider(provider.id, { selectedModel: selected });
                                                                }}
                                                                disabled={!isConfigured || provider.models.length === 0}
                                                                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-0.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-cyan-500/60 disabled:opacity-50"
                                                            >
                                                                {provider.models.length > 0 ? (
                                                                    provider.models.map(m => (
                                                                        <option key={m} value={m}>{m}</option>
                                                                    ))
                                                                ) : (
                                                                    <option value="" disabled>No models</option>
                                                                )}
                                                            </select>
                                                            {!isConfigured && <span className="text-[10px] text-red-400 font-mono">(No API key)</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => onToggleProvider(provider.id)}
                                                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                                                        isEnabled
                                                            ? 'bg-cyan-500 text-white shadow-sm'
                                                            : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-zinc-700'
                                                    }`}
                                                    title={isEnabled ? 'Enabled for debate' : 'Disabled'}
                                                >
                                                    {isEnabled && (
                                                        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="px-4 py-6 text-center text-xs text-zinc-500">
                                        No providers configured. Configure your providers in Settings → AI Models.
                                    </div>
                                )}
                            </div>

                            {/* Vision Model Selector */}
                            <div className="px-4 py-3 border-t border-white/10 bg-white/[0.02]">
                                <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-2">Vision Model</div>
                                <select
                                    value={selectedVisionModel}
                                    onChange={(e) => setSelectedVisionModel(e.target.value)}
                                    className="w-full bg-zinc-800/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-cyan-500/50"
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
        </div>
    );
};

export const ChatInput = React.memo(ChatInputInner);
