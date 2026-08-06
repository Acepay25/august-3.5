import React, { useState, useEffect, useRef } from 'react';
import { APP_NAME, APP_VERSION } from '../../constants/version';
import { AIProvider, AccuracySubMode, LoggedTrade, GlobalMemory, TradeSummary } from '../../types';
import { AnalystLensConfig } from '../../types/lens';
import { CustomInstructionsMap } from '../../types/user';
import { ProviderConfig, ApiFormat } from '../../types/provider';
import ProviderManager from './ProviderManager';
import AnalystLensSettings from './AnalystLensSettings';
import CustomInstructionsEditor, { InstructionTab } from './CustomInstructionsEditor';
import MemorySettings from './MemorySettings';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { BackupManager } from './BackupManager';
import { AlertManager } from './AlertManager';
import { Journal } from '../journal/Journal';
import { ActivityIcon, AISettingsIcon, BrainIcon, CloseIcon, EditIcon, HistoryIcon, BookmarkIcon, SettingsIcon, UserIcon, ExportIcon, SearchIcon, SwitchUserIcon } from '../shared/Icons';

export type SettingsTab = 'general' | 'models' | 'journal' | 'lenses' | 'instructions' | 'memory' | 'actions';

interface SettingsMenuProps {
    isVisible: boolean;
    onClose: () => void;
    isLoading?: boolean;
    // Accuracy Mode
    isAccuracyModeEnabled: boolean;
    onToggleAccuracyMode: () => void;
    accuracySubMode: AccuracySubMode;
    onSelectAccuracySubMode?: (subMode: AccuracySubMode) => void;
    setAccuracySubMode?: (subMode: AccuracySubMode) => void;
    // Hybrid & Capturing
    isHybridIntelligenceEnabled: boolean;
    onToggleHybridIntelligence?: () => void;
    setIsHybridIntelligenceEnabled?: (enabled: boolean) => void;
    isAutoCapturing?: boolean;
    onToggleAutoCapturing?: () => void;
    isUpdateAutoCapturing?: boolean;
    onToggleUpdateAutoCapturing?: () => void;
    isEntryNotHitCapturing?: boolean;
    onToggleEntryNotHitCapturing?: () => void;
    // Memory
    isGlobalMemoryEnabled?: boolean;
    setIsGlobalMemoryEnabled?: (enabled: boolean) => void;
    memoryConfig?: ProviderConfig | null;
    onMemoryConfigChange?: (config: ProviderConfig | null) => void;
    memoryModel?: string;
    setMemoryModel?: (model: string) => void;
    // Pure AI options
    isPlaybookEnabledInPureAI?: boolean;
    setIsPlaybookEnabledInPureAI?: (enabled: boolean) => void;
    isFamiliesEnabledInPureAI?: boolean;
    setIsFamiliesEnabledInPureAI?: (enabled: boolean) => void;
    isMemoryEnabledInPureAI?: boolean;
    setIsMemoryEnabledInPureAI?: (enabled: boolean) => void;
    // Instructions
    customInstructions: CustomInstructionsMap;
    setCustomInstructions: (instructions: CustomInstructionsMap) => void;
    // Lenses
    lensConfig: AnalystLensConfig;
    onSetLensConfig: (config: AnalystLensConfig) => void;
    // Modals & Navigation triggers from main view
    onOpenSavedAnalyses?: () => void;
    onOpenPlaybook?: () => void;
    onOpenUserProfile?: () => void;
    onOpenStrategySearch?: () => void;
    onSwitchUser?: () => void;
    onExportData?: () => Promise<void> | void;
    /** Active profile — enables the backup management section. */
    username?: string;
    /** Called after a backup restore replaces the profile (App reloads it). */
    onProfileRestored?: (username: string) => void;
    onOpenJournal?: (tab?: string) => void;
    summarizationProvider?: AIProvider;
    summarizationModel?: string;
    onSetSummarizationProvider?: (provider: AIProvider) => void;
    onSetSummarizationModel?: (model: string) => void;
    summaryCharLimit?: number;
    onUpdateSummaryCharLimit?: (limit: number) => void;
    onRegenerateSummary?: () => Promise<void> | void;
    useAlgorithmicSummary?: boolean;
    onToggleAlgorithmicSummary?: (enabled: boolean) => void;
    useAlgorithmicInsights?: boolean;
    onToggleAlgorithmicInsights?: (enabled: boolean) => void;
    // Journal Props for Embedded View
    loggedTrades?: LoggedTrade[];
    onDeleteTrades?: (ids: string[]) => void;
    onClearAllTrades?: () => void;
    modelIdToName?: Record<string, string>;
    ocrModelIdToName?: Record<string, string>;
    onUpdateInsights?: (ids: string[]) => void;
    isSummarizing?: boolean;
    currentInsightIds?: string[];
    onUpdateTradeLeverage?: (id: string, leverage: number) => void;
    finalSummary?: string | null;
    individualSummaries?: TradeSummary[];
    familyWinRates?: Record<string, { total: number; wins: number; winRate: number }>;
    globalMemory?: GlobalMemory | null;
    threadSummary?: string;
    // Models
    selectedOcrModel?: string;
    onSetOcrModel?: (modelId: string) => void;
    moderatorProvider?: AIProvider;
    moderatorModel?: string;
    onSetModeratorProvider?: (provider: string) => void;
    onSetModeratorModel?: (model: string) => void;
    // Dynamic Providers
    providerConfigs?: ProviderConfig[];
    onUpdateProvider?: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    onAddCustomProvider?: (provider: { name: string; baseUrl: string; apiKey: string; apiFormat: ApiFormat; models?: string[]; selectedModel?: string }) => Promise<void>;
    onRemoveProvider?: (id: string) => Promise<void>;
    onToggleProviderConfig?: (id: string) => Promise<void>;
    onAddModel?: (providerId: string, modelId: string) => Promise<void>;
    onRemoveModel?: (providerId: string, modelId: string) => Promise<void>;
    onUpdateModel?: (providerId: string, oldModelId: string, newModelId: string) => Promise<void>;
}

// ─── Shared UI Helpers ────────────────────────────────────────────────────────

const ToggleSwitch: React.FC<{ checked: boolean; onChange: () => void; label?: string }> = ({ checked, onChange, label = 'Toggle setting' }) => (
    <button
        type="button"
        onClick={onChange}
        aria-label={label}
        aria-pressed={checked}
        className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out ${
            checked ? 'bg-cyan-500' : 'bg-zinc-700'
        }`}
    >
        <div
            className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                checked ? 'translate-x-5' : 'translate-x-0'
            }`}
        />
    </button>
);

const NavTabButton: React.FC<{
    id: SettingsTab;
    activeTab: SettingsTab;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    badge?: string;
}> = ({ activeTab, id, onClick, icon, label, badge }) => {
    const isActive = activeTab === id;
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-all font-medium text-xs ${
                isActive
                    ? 'bg-zinc-800 text-white border border-zinc-700/80 shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
            }`}
        >
            <div className="flex items-center gap-3 min-w-0">
                <span className={`text-base shrink-0 ${isActive ? 'text-cyan-400' : 'text-zinc-500'}`}>{icon}</span>
                <span className="truncate">{label}</span>
            </div>
            {badge && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    {badge}
                </span>
            )}
        </button>
    );
};

const SettingsMenu: React.FC<SettingsMenuProps> = (props) => {
    const {
        isVisible,
        onClose,
        isAccuracyModeEnabled,
        onToggleAccuracyMode,
        accuracySubMode,
        onSelectAccuracySubMode,
        customInstructions,
        setCustomInstructions,
        lensConfig,
        onSetLensConfig,
        onOpenSavedAnalyses,
        onOpenPlaybook,
        onOpenUserProfile,
        onOpenStrategySearch,
        onSwitchUser,
        onExportData,
        username,
        onProfileRestored,
        isHybridIntelligenceEnabled,
        onToggleHybridIntelligence,
        isAutoCapturing,
        onToggleAutoCapturing,
        isUpdateAutoCapturing,
        onToggleUpdateAutoCapturing,
        isEntryNotHitCapturing,
        onToggleEntryNotHitCapturing,
        isGlobalMemoryEnabled,
        setIsGlobalMemoryEnabled,
        isPlaybookEnabledInPureAI,
        setIsPlaybookEnabledInPureAI,
        isFamiliesEnabledInPureAI,
        setIsFamiliesEnabledInPureAI,
        isMemoryEnabledInPureAI,
        setIsMemoryEnabledInPureAI,
        selectedOcrModel,
        onSetOcrModel,
        moderatorProvider,
        moderatorModel,
        onSetModeratorProvider,
        onSetModeratorModel,
        memoryConfig = null,
        onMemoryConfigChange = () => {},
        providerConfigs,
        onUpdateProvider,
        onAddCustomProvider,
        onRemoveProvider,
        onToggleProviderConfig,
        onAddModel,
        onRemoveModel,
        onUpdateModel,
    } = props;

    const [activeTab, setActiveTab] = useState<SettingsTab>('models');
    const [activeInstructionTab, setActiveInstructionTab] = useState<InstructionTab>('general');
    const dialogRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!isVisible) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', handleKeyDown);
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button')?.focus());
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isVisible, onClose]);

    // Enabled providers list for lens settings —
    // derived from dynamic provider configs (ready = enabled + API key).
    const readyConfigProviders = (providerConfigs ?? []).filter(c => c.isEnabled && c.apiKey.trim().length > 0);
    const enabledProvidersList: AIProvider[] = readyConfigProviders.map(c => c.id);

    // First ready provider — used as the default summarization provider for the embedded journal
    const firstReadyProvider = readyConfigProviders[0];

    // Heal a stale vision-model selection: `selectedOcrModel` is a bare model
    // id, and if its provider was disabled/removed it appears in no dropdown
    // option (the select renders blank). Fall back to the first ready
    // provider's model so the UI and the vision path stay in sync.
    // NOTE: this effect must stay ABOVE the `!isVisible` early return — React
    // forbids conditional hook order.
    useEffect(() => {
        if (!selectedOcrModel || readyConfigProviders.length === 0) return;
        const known = readyConfigProviders.some(p => p.models.includes(selectedOcrModel));
        if (!known) {
            onSetOcrModel?.(firstReadyProvider?.selectedModel || firstReadyProvider?.models?.[0] || '');
        }
    }, [readyConfigProviders, selectedOcrModel, firstReadyProvider, onSetOcrModel]);

    if (!isVisible) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/80 z-40 animate-fade-in"
                onClick={onClose}
            />

            {/* Centered Desktop Settings Modal */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
                <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="pointer-events-auto w-[1150px] max-w-[95vw] h-[750px] max-h-[92vh] bg-zinc-950 border border-zinc-800/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in">
                    
                    {/* Modal Top Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-950 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#b0b0b6]" />
                            <h2 id="settings-title" className="text-lg font-bold text-white tracking-tight">Settings</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition-all"
                            aria-label="Close settings"
                        >
                            <CloseIcon />
                        </button>
                    </div>

                    {/* Main Layout: Left Tab Bar + Right Workspace */}
                    <div className="flex-1 flex min-h-0 flex-col md:flex-row">
                        
                        {/* Left Tab Navigation Sidebar */}
                        <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-zinc-800/80 bg-zinc-950 p-4 space-y-1 shrink-0 flex flex-col justify-between">
                            <div className="space-y-1">
                                <NavTabButton
                                    id="models"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('models')}
                                    icon={<AISettingsIcon className="w-4 h-4" />}
                                    label="AI Models & Providers"
                                />
                                <NavTabButton
                                    id="journal"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('journal')}
                                    icon={<HistoryIcon className="w-4 h-4" />}
                                    label="Trading Journal"
                                    badge={props.loggedTrades && props.loggedTrades.length > 0 ? `${props.loggedTrades.length}` : undefined}
                                />
                                <NavTabButton
                                    id="general"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('general')}
                                    icon={<SettingsIcon className="w-4 h-4" />}
                                    label="General & Analysis"
                                />
                                <NavTabButton
                                    id="lenses"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('lenses')}
                                    icon={<BrainIcon className="w-4 h-4" />}
                                    label="Analyst Lenses"
                                />
                                <NavTabButton
                                    id="instructions"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('instructions')}
                                    icon={<EditIcon className="w-4 h-4" />}
                                    label="Custom Instructions"
                                />
                                <NavTabButton
                                    id="memory"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('memory')}
                                    icon={<ActivityIcon className="w-4 h-4" />}
                                    label="Memory & Learning"
                                />
                                <NavTabButton
                                    id="actions"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('actions')}
                                    icon={<SwitchUserIcon className="w-4 h-4" />}
                                    label="Profile & Quick Actions"
                                />
                            </div>

                            {/* Diagnostics & Version at bottom of nav */}
                            <div className="pt-4 border-t border-zinc-800/80 space-y-2">
                                <DiagnosticsPanel />
                                <p className="text-[10px] text-zinc-600 text-center font-mono">
                                    {APP_NAME} v{APP_VERSION}
                                </p>
                            </div>
                        </div>

                        {/* Right Content Workspace */}
                        <div className="flex-1 overflow-y-auto p-6 bg-zinc-950 custom-scrollbar">
                            
                            {/* TAB 0: Trading Journal */}
                            {activeTab === 'journal' && (
                                <div className="h-full animate-fade-in">
                                    <Journal
                                        isVisible={true}
                                        onClose={() => setActiveTab('models')}
                                        initialTab="log"
                                        isEmbedded={true}
                                        trades={props.loggedTrades || []}
                                        onDeleteTrades={props.onDeleteTrades || (() => {})}
                                        onClearAllTrades={props.onClearAllTrades || (() => {})}
                                        modelIdToName={props.modelIdToName || {}}
                                        ocrModelIdToName={props.ocrModelIdToName || {}}
                                        onUpdateInsights={props.onUpdateInsights || (() => {})}
                                        isSummarizing={props.isSummarizing}
                                        currentInsightIds={props.currentInsightIds || []}
                                        onUpdateTradeLeverage={props.onUpdateTradeLeverage || (() => {})}
                                        finalSummary={props.finalSummary || null}
                                        individualSummaries={props.individualSummaries || []}
                                        isLoading={!!props.isLoading}
                                        summarizationProvider={props.summarizationProvider || firstReadyProvider?.id || ''}
                                        summarizationModel={props.summarizationModel || firstReadyProvider?.selectedModel || ''}
                                        onSetSummarizationProvider={props.onSetSummarizationProvider || (() => {})}
                                        onSetSummarizationModel={props.onSetSummarizationModel || (() => {})}
                                        providers={readyConfigProviders}
                                        summaryCharLimit={props.summaryCharLimit || 1000}
                                        onUpdateSummaryCharLimit={props.onUpdateSummaryCharLimit || (() => {})}
                                        onRegenerateSummary={props.onRegenerateSummary || (() => {})}
                                        useAlgorithmicSummary={props.useAlgorithmicSummary ?? false}
                                        onToggleAlgorithmicSummary={props.onToggleAlgorithmicSummary || (() => {})}
                                        useAlgorithmicInsights={props.useAlgorithmicInsights ?? false}
                                        onToggleAlgorithmicInsights={props.onToggleAlgorithmicInsights || (() => {})}
                                        familyWinRates={props.familyWinRates || {}}
                                        globalMemory={props.globalMemory ?? undefined}
                                        threadSummary={props.threadSummary || ''}
                                    />
                                </div>
                            )}

                            {/* TAB 1: AI Models & Providers */}
                            {activeTab === 'models' && (
                                <div className="space-y-6 animate-fade-in">
                                    {/* Vision & Moderator Controls Header bar */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* Vision Model Selector — models from ready providers */}
                                        {readyConfigProviders.length > 0 && (
                                            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800/80">
                                                <div className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
                                                    Vision Model
                                                </div>
                                                <select
                                                    value={selectedOcrModel}
                                                    onChange={(e) => onSetOcrModel?.(e.target.value)}
                                                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all duration-200 appearance-none cursor-pointer bg-no-repeat bg-[right_0.9rem_center] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')] text-xs"
                                                >
                                                    {readyConfigProviders.flatMap(p => p.models.map(m => (
                                                        <option key={`${p.id}-${m}`} value={m}>{p.name}: {m}</option>
                                                    )))}
                                                </select>
                                            </div>
                                        )}

                                        {/* Debate Moderator Selector */}
                                        <div className="p-4 rounded-xl bg-zinc-900 border border-cyan-500/20">
                                            <div className="text-xs font-bold text-cyan-400 mb-2 uppercase tracking-wider">
                                                Debate Moderator
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[10px] text-zinc-500 font-bold uppercase mb-1 block">Provider</label>
                                                    <select
                                                        value={moderatorProvider || (providerConfigs && providerConfigs[0]?.id) || ''}
                                                        onChange={(e) => {
                                                            const newProviderId = e.target.value;
                                                            onSetModeratorProvider?.(newProviderId);
                                                            const selectedCfg = (providerConfigs ?? []).find(c => c.id === newProviderId);
                                                            if (selectedCfg && selectedCfg.models.length > 0) {
                                                                onSetModeratorModel?.(selectedCfg.selectedModel || selectedCfg.models[0]);
                                                            }
                                                        }}
                                                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all duration-200 appearance-none cursor-pointer bg-no-repeat bg-[right_0.9rem_center] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')] text-xs"
                                                    >
                                                        {(providerConfigs ?? []).length > 0 ? (
                                                            (providerConfigs ?? []).map(c => (
                                                                <option key={c.id} value={c.id}>{c.name}</option>
                                                            ))
                                                        ) : (
                                                            <option value="" disabled>No providers</option>
                                                        )}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-zinc-500 font-bold uppercase mb-1 block">Model ID</label>
                                                    <select
                                                        value={moderatorModel || ''}
                                                        onChange={(e) => onSetModeratorModel?.(e.target.value)}
                                                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all duration-200 appearance-none cursor-pointer bg-no-repeat bg-[right_0.9rem_center] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222.5%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')] text-xs"
                                                    >
                                                        {(() => {
                                                            const activeProvId = moderatorProvider || (providerConfigs && providerConfigs[0]?.id);
                                                            const selectedCfg = (providerConfigs ?? []).find(c => c.id === activeProvId);
                                                            if (selectedCfg && selectedCfg.models.length > 0) {
                                                                return selectedCfg.models.map(m => <option key={m} value={m}>{m}</option>);
                                                            }
                                                            return <option value="" disabled>Select model</option>;
                                                        })()}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Main Provider Manager UI */}
                                    {providerConfigs && onUpdateProvider && onAddCustomProvider && onRemoveProvider && onToggleProviderConfig ? (
                                        <ProviderManager
                                            configs={providerConfigs}
                                            onUpdateProvider={onUpdateProvider}
                                            onAddCustomProvider={onAddCustomProvider}
                                            onRemoveProvider={onRemoveProvider}
                                            onToggleProvider={onToggleProviderConfig}
                                            onAddModel={onAddModel}
                                            onRemoveModel={onRemoveModel}
                                            onUpdateModel={onUpdateModel}
                                        />
                                    ) : (
                                        <p className="text-xs text-zinc-500">Provider configuration loading…</p>
                                    )}
                                </div>
                            )}

                            {/* TAB 2: General & Analysis */}
                            {activeTab === 'general' && (
                                <div className="space-y-6 max-w-3xl animate-fade-in">
                                    <div className="border-b border-zinc-800 pb-3">
                                        <h3 className="text-base font-bold text-white">General & Analysis Modes</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Configure accuracy protocol, real-time market feeds, and automated data capture.</p>
                                    </div>

                                    {/* Accuracy Mode */}
                                    <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className="text-sm font-bold text-white">Accuracy Mode</h4>
                                                <p className="text-xs text-zinc-400 mt-0.5">
                                                    {isAccuracyModeEnabled
                                                        ? (accuracySubMode === 'original' ? 'Strict Protocol enabled' : 'Pure AI enabled')
                                                        : 'Standard speed mode'}
                                                </p>
                                            </div>
                                            <ToggleSwitch checked={isAccuracyModeEnabled} onChange={onToggleAccuracyMode} label="Toggle Accuracy Mode" />
                                        </div>

                                        {isAccuracyModeEnabled && (
                                            <div className="grid grid-cols-2 gap-3 pt-2">
                                                <button
                                                    onClick={() => (onSelectAccuracySubMode || props.setAccuracySubMode)?.('original')}
                                                    className={`p-3 rounded-xl border text-left transition-all ${
                                                        accuracySubMode === 'original'
                                                            ? 'bg-cyan-500/10 border-cyan-500/60 text-cyan-300'
                                                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                                                    }`}
                                                >
                                                    <div className="text-xs font-bold">Strict Protocol</div>
                                                    <div className="text-[11px] text-zinc-500 mt-1">Multi-stage validation and strict consensus</div>
                                                </button>
                                                <button
                                                    onClick={() => (onSelectAccuracySubMode || props.setAccuracySubMode)?.('pure_ai')}
                                                    className={`p-3 rounded-xl border text-left transition-all ${
                                                        accuracySubMode === 'pure_ai'
                                                            ? 'bg-cyan-500/10 border-cyan-500/60 text-cyan-300'
                                                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                                                    }`}
                                                >
                                                    <div className="text-xs font-bold">Pure AI</div>
                                                    <div className="text-[11px] text-zinc-500 mt-1">Unfiltered AI reasoning without strict formatting gates</div>
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Pure AI Context — only relevant in Accuracy Mode → Pure AI */}
                                    {isAccuracyModeEnabled && accuracySubMode === 'pure_ai' && (setIsPlaybookEnabledInPureAI || setIsFamiliesEnabledInPureAI || setIsMemoryEnabledInPureAI) && (
                                        <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 space-y-4 animate-fade-in">
                                            <div>
                                                <h4 className="text-sm font-bold text-white">Pure AI Context</h4>
                                                <p className="text-xs text-zinc-400 mt-0.5">Choose which structured context is injected during Pure AI analysis.</p>
                                            </div>
                                            <div className="space-y-3">
                                                {setIsPlaybookEnabledInPureAI && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs text-zinc-300">Strategy Playbook</span>
                                                    <ToggleSwitch checked={!!isPlaybookEnabledInPureAI} onChange={() => setIsPlaybookEnabledInPureAI(!isPlaybookEnabledInPureAI)} label="Toggle Strategy Playbook in Pure AI" />
                                                    </div>
                                                )}
                                                {setIsFamiliesEnabledInPureAI && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs text-zinc-300">Pattern Families</span>
                                                    <ToggleSwitch checked={!!isFamiliesEnabledInPureAI} onChange={() => setIsFamiliesEnabledInPureAI(!isFamiliesEnabledInPureAI)} label="Toggle Pattern Families in Pure AI" />
                                                    </div>
                                                )}
                                                {setIsMemoryEnabledInPureAI && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs text-zinc-300">Historical Memory</span>
                                                    <ToggleSwitch checked={!!isMemoryEnabledInPureAI} onChange={() => setIsMemoryEnabledInPureAI(!isMemoryEnabledInPureAI)} label="Toggle Historical Memory in Pure AI" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Hybrid Intelligence */}
                                    <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-bold text-white">Hybrid Intelligence</h4>
                                            <p className="text-xs text-zinc-400 mt-0.5">Fetches real-time Binance OHLCV data and calculates RSI, MACD, and EMAs for AI context.</p>
                                        </div>
                                        <ToggleSwitch checked={isHybridIntelligenceEnabled} onChange={() => {
                                            if (onToggleHybridIntelligence) onToggleHybridIntelligence();
                                            else if (props.setIsHybridIntelligenceEnabled) props.setIsHybridIntelligenceEnabled(!isHybridIntelligenceEnabled);
                                        }} label="Toggle Hybrid Intelligence" />
                                    </div>

                                    {/* Auto-Capture Options */}
                                    <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 space-y-4">
                                        <h4 className="text-sm font-bold text-white">Automated Capture Prompts</h4>
                                        <div className="space-y-3">
                                            {onToggleAutoCapturing && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-zinc-300">Prompt for post-trade result capture</span>
                                                    <ToggleSwitch checked={!!isAutoCapturing} onChange={onToggleAutoCapturing} label="Toggle post-trade result capture" />
                                                </div>
                                            )}
                                            {onToggleUpdateAutoCapturing && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-zinc-300">Prompt for active trade updates</span>
                                                    <ToggleSwitch checked={!!isUpdateAutoCapturing} onChange={onToggleUpdateAutoCapturing} label="Toggle active trade update capture" />
                                                </div>
                                            )}
                                            {onToggleEntryNotHitCapturing && (
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-zinc-300">Prompt when entry price is not hit</span>
                                                    <ToggleSwitch checked={!!isEntryNotHitCapturing} onChange={onToggleEntryNotHitCapturing} label="Toggle entry not hit capture" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 3: Analyst Lenses */}
                            {activeTab === 'lenses' && (
                                <div className="space-y-4 animate-fade-in">
                                    <div className="border-b border-zinc-800 pb-3">
                                        <h3 className="text-base font-bold text-white">Analyst Lenses</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Assign role-based personas (Technical, Risk, Macro) to AI models.</p>
                                    </div>
                                    <AnalystLensSettings
                                        config={lensConfig}
                                        onChange={onSetLensConfig}
                                        providers={providerConfigs ?? []}
                                    />
                                </div>
                            )}

                            {/* TAB 4: Custom Instructions */}
                            {activeTab === 'instructions' && (
                                <div className="space-y-4 animate-fade-in h-full flex flex-col">
                                    <div className="border-b border-zinc-800 pb-3 shrink-0">
                                        <h3 className="text-base font-bold text-white">Custom Instructions</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Define global rules, trading strategies, and behavioral prompts for the AI ensemble.</p>
                                    </div>
                                    <div className="flex-1 min-h-[480px]">
                                        <CustomInstructionsEditor
                                            customInstructions={customInstructions}
                                            setCustomInstructions={setCustomInstructions}
                                            activeTab={activeInstructionTab}
                                            onTabChange={setActiveInstructionTab}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* TAB 5: Memory & Learning */}
                            {activeTab === 'memory' && (
                                <div className="space-y-4 max-w-3xl animate-fade-in">
                                    <div className="border-b border-zinc-800 pb-3">
                                        <h3 className="text-base font-bold text-white">Memory & Learning Layers</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Configure global trade learning synthesis and historical memory injection.</p>
                                    </div>
                                    {setIsGlobalMemoryEnabled && (
                                        <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h4 className="text-sm font-bold text-white">Global Memory (Layer 3)</h4>
                                                    <p className="text-xs text-zinc-400 mt-0.5">
                                                        {isGlobalMemoryEnabled
                                                            ? 'Synthesized learning from all trades is injected into analysis.'
                                                            : 'Only per-thread memory (Layers 1 & 2) is active.'}
                                                    </p>
                                                </div>
                                                <ToggleSwitch checked={!!isGlobalMemoryEnabled} onChange={() => setIsGlobalMemoryEnabled(!isGlobalMemoryEnabled)} label="Toggle Global Memory" />
                                            </div>
                                        </div>
                                    )}
                                    <MemorySettings
                                        providerConfigs={providerConfigs ?? []}
                                        memoryConfig={memoryConfig}
                                        onMemoryConfigChange={onMemoryConfigChange}
                                    />
                                </div>
                            )}

                            {/* TAB 6: Profile & Quick Actions */}
                            {activeTab === 'actions' && (
                                <div className="space-y-6 max-w-3xl animate-fade-in">
                                    <div className="border-b border-zinc-800 pb-3">
                                        <h3 className="text-base font-bold text-white">Profile & Quick Actions</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Access saved analyses, trading playbook, user profiles, and data exports.</p>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        {onOpenSavedAnalyses && (
                                            <button
                                                onClick={onOpenSavedAnalyses}
                                                className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 hover:bg-zinc-900 transition-all text-center group"
                                            >
                                                <BookmarkIcon className="w-6 h-6 text-zinc-400 group-hover:text-cyan-400 mb-2 transition-colors" />
                                                <span className="text-xs font-bold text-zinc-200">Saved Analyses</span>
                                            </button>
                                        )}
                                        {onOpenStrategySearch && (
                                            <button
                                                onClick={onOpenStrategySearch}
                                                className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 hover:bg-zinc-900 transition-all text-center group"
                                            >
                                                <SearchIcon className="w-6 h-6 text-zinc-400 group-hover:text-cyan-400 mb-2 transition-colors" />
                                                <span className="text-xs font-bold text-zinc-200">Strategy Search</span>
                                            </button>
                                        )}
                                        {onOpenPlaybook && (
                                            <button
                                                onClick={onOpenPlaybook}
                                                className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 hover:bg-zinc-900 transition-all text-center group"
                                            >
                                                <BookmarkIcon className="w-6 h-6 text-zinc-400 group-hover:text-cyan-400 mb-2 transition-colors" />
                                                <span className="text-xs font-bold text-zinc-200">Playbook</span>
                                            </button>
                                        )}
                                        {onOpenUserProfile && (
                                            <button
                                                onClick={onOpenUserProfile}
                                                className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 hover:bg-zinc-900 transition-all text-center group"
                                            >
                                                <UserIcon className="w-6 h-6 text-zinc-400 group-hover:text-cyan-400 mb-2 transition-colors" />
                                                <span className="text-xs font-bold text-zinc-200">User Profile</span>
                                            </button>
                                        )}
                                        {onSwitchUser && (
                                            <button
                                                onClick={onSwitchUser}
                                                className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 hover:bg-zinc-900 transition-all text-center group"
                                            >
                                                <SwitchUserIcon className="w-6 h-6 text-zinc-400 group-hover:text-cyan-400 mb-2 transition-colors" />
                                                <span className="text-xs font-bold text-zinc-200">Switch User</span>
                                            </button>
                                        )}
                                        {onExportData && (
                                            <button
                                                onClick={onExportData}
                                                className="flex flex-col items-center justify-center p-5 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 hover:bg-zinc-900 transition-all text-center group"
                                            >
                                                <ExportIcon className="w-6 h-6 text-zinc-400 group-hover:text-cyan-400 mb-2 transition-colors" />
                                                <span className="text-xs font-bold text-zinc-200">Export / Import</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Backups — list/export/restore/delete the 30-min auto-backups */}
                            {username && onProfileRestored && (
                                <div className="border-t border-zinc-800 pt-6">
                                    <BackupManager username={username} onProfileRestored={onProfileRestored} />
                                </div>
                            )}

                            {/* Price alerts — list/toggle/delete */}
                            <div className="border-t border-zinc-800 pt-6">
                                <AlertManager />
                            </div>

                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default React.memo(SettingsMenu);
