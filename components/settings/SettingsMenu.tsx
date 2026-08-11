import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useConfirmDialog } from '../shared/ConfirmDialog';
import { APP_NAME, APP_VERSION } from '../../constants/version';
import { AIProvider, AccuracySubMode, LoggedTrade } from '../../types';
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
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { ActivityIcon, AISettingsIcon, BrainIcon, CloseIcon, EditIcon, HistoryIcon, BookmarkIcon, SettingsIcon, UserIcon, ExportIcon, SearchIcon, SwitchUserIcon, CodeIcon } from '../shared/Icons';
import PromptManager from './PromptManager';
import StrategiesManager from './StrategiesManager';
import MemoryBrowser from '../journal/MemoryBrowser';
import ModelPicker from '../shared/ModelPicker';
import { Journal } from '../journal/Journal';

export type SettingsTab = 'general' | 'models' | 'journal' | 'lenses' | 'instructions' | 'memory' | 'actions' | 'prompts' | 'strategies';

interface SettingsMenuProps {
    isVisible: boolean;
    onClose: () => void;
    isLoading?: boolean;
    // Accuracy Mode
    isAccuracyModeEnabled: boolean;
    onToggleAccuracyMode: () => void;
    accuracySubMode: AccuracySubMode;
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
    // Uploaded strategy books (Settings → Strategies)
    isStrategiesEnabled?: boolean;
    setIsStrategiesEnabled?: (enabled: boolean) => void;
    memoryConfig?: ProviderConfig | null;
    onMemoryConfigChange?: (config: ProviderConfig | null) => void;
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
    /** Trade count for the "Journal & automation" nav badge. The journal
     *  itself is the SHARED overlay (single instance, always in sync with
     *  the sidebar one — the old embedded duplicate drifted). */
    loggedTrades?: LoggedTrade[];
    // Models
    selectedOcrModel?: string;
    onSetOcrModel?: (modelId: string) => void;
    /** Global vision model (Settings → AI setup → Vision Model): one model
     *  for EVERY vision feature (chart OCR, post-trade uploads, PDF OCR). */
    visionModel?: string;
    onSetVisionModel?: (modelId: string) => void;
    /** Resolved vision ProviderConfig (global → conversation → first ready). */
    visionConfig?: ProviderConfig | null;
    moderatorProvider?: AIProvider;
    moderatorModel?: string;
    onSetModeratorProvider?: (provider: string) => void;
    onSetModeratorModel?: (model: string) => void;
    // Dynamic Providers
    providerConfigs?: ProviderConfig[];
    /** False while provider configs are still loading — avoids the
     *  "No providers configured" empty-state flash. */
    providerConfigsLoaded?: boolean;
    onUpdateProvider?: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    onAddCustomProvider?: (provider: { name: string; baseUrl: string; apiKey: string; apiFormat: ApiFormat; models?: string[]; selectedModel?: string }) => Promise<void>;
    onRemoveProvider?: (id: string) => Promise<void>;
    onToggleProviderConfig?: (id: string) => Promise<void>;
    onAddModel?: (providerId: string, modelId: string) => Promise<void>;
    onRemoveModel?: (providerId: string, modelId: string) => Promise<void>;
    // Journal embedded props
    onDeleteTrades?: (ids: string[]) => void;
    onClearAllTrades?: () => void;
    modelIdToName?: Record<string, string>;
    onUpdateInsights?: (ids: string[]) => void;
    isSummarizing?: boolean;
    currentInsightIds?: string[];
    onUpdateTradeLeverage?: (id: string, leverage: number) => void;
    onUpdateOutcome?: (id: string, outcome: any) => void;
    onUpdatePnL?: (id: string, pnl: { pnlAmount?: number; pnlPercent?: number }) => void;
    finalSummary?: string | null;
    individualSummaries?: any[];
    isInsightGenerating?: boolean;
    insightProgress?: { done: number; total: number } | null;
    newlyAddedInsightIds?: Set<string>;
    onDeleteInsight?: (id: string) => void;
    onRewriteInsightsWithAI?: (ids?: string[]) => void;
    familyWinRates?: Record<string, { total: number; wins: number; winRate: number }>;
    enabledProviders?: AIProvider[];
    selectedModels?: Record<string, string>;
    onUpdateModel?: (providerId: string, oldModelId: string, newModelId: string) => Promise<void>;
    // Settings initial tab (set by handleOpenJournal to open Journal tab directly)
    settingsInitialTab?: string;
    onSettingsInitialTabConsumed?: () => void;
}

// ─── Shared UI Helpers ────────────────────────────────────────────────────────

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
    const { confirm, ConfirmDialogComponent } = useConfirmDialog();
    const {
        isVisible,
        onClose,
        isAccuracyModeEnabled,
        onToggleAccuracyMode,
        accuracySubMode,
        setAccuracySubMode,
        customInstructions,
        setCustomInstructions,
        lensConfig,
        onSetLensConfig,
        onOpenSavedAnalyses,
        onOpenPlaybook,
        onOpenUserProfile,
        onOpenStrategySearch,
        onOpenJournal,
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
        isStrategiesEnabled,
        setIsStrategiesEnabled,
        isPlaybookEnabledInPureAI,
        setIsPlaybookEnabledInPureAI,
        isFamiliesEnabledInPureAI,
        setIsFamiliesEnabledInPureAI,
        isMemoryEnabledInPureAI,
        setIsMemoryEnabledInPureAI,
        selectedOcrModel,
        onSetOcrModel,
        visionModel,
        onSetVisionModel,
        visionConfig,
        moderatorProvider,
        moderatorModel,
        onSetModeratorProvider,
        onSetModeratorModel,
        memoryConfig = null,
        onMemoryConfigChange = () => {},
        providerConfigs,
        providerConfigsLoaded,
        onUpdateProvider,
        onAddCustomProvider,
        onRemoveProvider,
        onToggleProviderConfig,
        onAddModel,
        onRemoveModel,
        onUpdateModel,
    } = props;

    // Land on the friendliest tab: General when a provider is already
    // configured, otherwise the Get Started provider setup (the onboarding
    // card points beginners there anyway). The old default was the most
    // technical tab (provider CRUD).
    const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
        // If settingsInitialTab is provided (e.g., from handleOpenJournal), use it
        if (props.settingsInitialTab && props.settingsInitialTab in ['general', 'models', 'journal', 'lenses', 'instructions', 'memory', 'actions', 'prompts', 'strategies']) {
            return props.settingsInitialTab as SettingsTab;
        }
        const hasReadyProvider = (providerConfigs ?? []).some(c => c.isEnabled && c.apiKey.trim().length > 0);
        return hasReadyProvider ? 'general' : 'models';
    });
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [activeInstructionTab, setActiveInstructionTab] = useState<InstructionTab>('general');
    const [isDirty, setIsDirty] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const initialTabResolvedRef = useRef(false);

    // Handle settingsInitialTab prop changes (e.g., when handleOpenJournal sets it)
    useEffect(() => {
        if (props.settingsInitialTab && props.settingsInitialTab in ['general', 'models', 'journal', 'lenses', 'instructions', 'memory', 'actions', 'prompts', 'strategies']) {
            setActiveTab(props.settingsInitialTab as SettingsTab);
            props.onSettingsInitialTabConsumed?.();
        }
    }, [props.settingsInitialTab]);

    // Closing with a staged (unsaved) provider draft would silently discard
    // the user's edits — confirm first (Escape, backdrop, and the X all route
    // through here).
    const requestClose = useCallback(() => {
        if (!isDirty) {
            onClose();
            return;
        }
        void confirm({
            title: 'Discard unsaved changes?',
            message: 'You have unsaved provider edits. Closing Settings will discard them.',
            confirmLabel: 'Discard',
            destructive: true,
        }).then(ok => { if (ok) onClose(); });
    }, [isDirty, onClose, confirm]);

    useEffect(() => {
        if (!isVisible) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                requestClose();
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
    }, [isVisible, requestClose]);

    // Enabled providers list for lens settings —
    // derived from dynamic provider configs (ready = enabled + API key).
    const readyConfigProviders = (providerConfigs ?? []).filter(c => c.isEnabled && c.apiKey.trim().length > 0);
    // First ready provider — used as the default summarization provider for the embedded journal
    const firstReadyProvider = readyConfigProviders[0];

    // Provider configs load asynchronously. Resolve the landing tab once after
    // that load so existing users do not get stranded on provider CRUD while
    // preserving deliberate tab choices after the first render.
    useEffect(() => {
        if (!isVisible || !providerConfigsLoaded || initialTabResolvedRef.current) return;
        initialTabResolvedRef.current = true;
        setActiveTab(readyConfigProviders.length > 0 ? 'general' : 'models');
    }, [isVisible, providerConfigsLoaded, readyConfigProviders.length]);

    // Heal stale vision-model selections: both the global `visionModel` and
    // the legacy per-conversation `selectedOcrModel` are bare model ids, and
    // if their provider was disabled/removed they appear in no dropdown
    // option (the select renders blank). Fall back to the first ready
    // provider's model so the UI and the vision path stay in sync.
    // NOTE: this effect must stay ABOVE the `!isVisible` early return — React
    // forbids conditional hook order.
    useEffect(() => {
        if (readyConfigProviders.length === 0) return;
        if (!visionModel || !readyConfigProviders.some(p => p.models.includes(visionModel))) {
            onSetVisionModel?.(firstReadyProvider?.selectedModel || firstReadyProvider?.models?.[0] || '');
        }
        if (selectedOcrModel && !readyConfigProviders.some(p => p.models.includes(selectedOcrModel))) {
            onSetOcrModel?.(firstReadyProvider?.selectedModel || firstReadyProvider?.models?.[0] || '');
        }
    }, [readyConfigProviders, selectedOcrModel, visionModel, firstReadyProvider, onSetOcrModel, onSetVisionModel]);

    if (!isVisible) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/80 z-40 animate-fade-in"
                onClick={requestClose}
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
                            onClick={requestClose}
                            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition-all"
                            aria-label="Close settings"
                        >
                            <CloseIcon />
                        </button>
                    </div>

                    {/* Main Layout: Left Tab Bar + Right Workspace */}
                    <div className="flex-1 flex min-h-0 flex-col md:flex-row">
                        
                        {/* Left Tab Navigation Sidebar */}
                        <div className="w-full md:w-64 max-h-[32vh] overflow-y-auto md:max-h-none md:overflow-visible border-b md:border-b-0 md:border-r border-zinc-800/80 bg-zinc-950 p-4 space-y-1 shrink-0 flex flex-col justify-between custom-scrollbar">
                            <div className="space-y-1">
                                {/* Get Started — what a new user needs first */}
                                <p className="px-3.5 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                                    Get Started
                                </p>
                                <NavTabButton
                                    id="models"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('models')}
                                    icon={<AISettingsIcon className="w-4 h-4" />}
                                    label="AI setup"
                                />
                                {/* Analysis — how analyses behave */}
                                <p className="px-3.5 pt-3 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                                    Analysis
                                </p>
                                <NavTabButton
                                    id="general"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('general')}
                                    icon={<SettingsIcon className="w-4 h-4" />}
                                    label="Analysis"
                                />
                                <NavTabButton
                                    id="lenses"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('lenses')}
                                    icon={<BrainIcon className="w-4 h-4" />}
                                    label="Analyst roles"
                                />
                                <NavTabButton
                                    id="instructions"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('instructions')}
                                    icon={<EditIcon className="w-4 h-4" />}
                                    label="Response preferences"
                                />
                                <NavTabButton
                                    id="prompts"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('prompts')}
                                    icon={<CodeIcon className="w-4 h-4" />}
                                    label="Prompts"
                                />
                                <NavTabButton
                                    id="strategies"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('strategies')}
                                    icon={<BookmarkIcon className="w-4 h-4" />}
                                    label="Strategies"
                                />
                                <NavTabButton
                                    id="memory"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('memory')}
                                    icon={<ActivityIcon className="w-4 h-4" />}
                                    label="Personal edge"
                                />
                                {/* Account & Data — journal, profile, backups */}
                                <p className="px-3.5 pt-3 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                                    Account & Data
                                </p>
                        <NavTabButton
                            id="journal"
                            activeTab={activeTab}
                            onClick={() => setActiveTab('journal')}
                            icon={<HistoryIcon className="w-4 h-4" />}
                            label="Journal"
                            badge={props.loggedTrades && props.loggedTrades.length > 0 ? `${props.loggedTrades.length}` : undefined}
                        />
                                <NavTabButton
                                    id="actions"
                                    activeTab={activeTab}
                                    onClick={() => setActiveTab('actions')}
                                    icon={<SwitchUserIcon className="w-4 h-4" />}
                                    label="Data"
                                />
                            </div>

                            {/* Diagnostics & Version at bottom of nav — developer
                                tooling tucked behind a collapsible so it doesn't
                                sit on a user-facing screen. */}
                            <div className="pt-4 border-t border-zinc-800/80 space-y-2">
                                <details className="group">
                                    <summary className="text-[10px] text-zinc-600 hover:text-zinc-400 cursor-pointer select-none font-mono list-none flex items-center justify-between">
                                        <span>Developer</span>
                                        <span className="text-zinc-700 group-open:hidden">▸</span>
                                        <span className="text-zinc-700 hidden group-open:inline">▾</span>
                                    </summary>
                                    <div className="mt-2">
                                        <DiagnosticsPanel />
                                    </div>
                                </details>
                                <p className="text-[10px] text-zinc-600 text-center font-mono">
                                    {APP_NAME} v{APP_VERSION}
                                </p>
                            </div>
                        </div>

                        {/* Right Content Workspace */}
                        <div className="flex-1 overflow-y-auto p-6 bg-zinc-950 custom-scrollbar">
                            
                            {/* TAB 0: Trading Journal — embedded inside Settings */}
                            {activeTab === 'journal' && (
                                <div className="h-full animate-fade-in">
                                    <Journal
                                        isVisible={true}
                                        onClose={() => {}}
                                        initialTab="log"
                                        isEmbedded={true}
                                        username={username}
                                        trades={props.loggedTrades ?? []}
                                        onDeleteTrades={props.onDeleteTrades ?? (() => {})}
                                        onClearAllTrades={props.onClearAllTrades ?? (() => {})}
                                        modelIdToName={props.modelIdToName ?? {}}
                                        onUpdateInsights={props.onUpdateInsights ?? (() => {})}
                                        isSummarizing={props.isSummarizing}
                                        currentInsightIds={props.currentInsightIds ?? []}
                                        onUpdateTradeLeverage={props.onUpdateTradeLeverage ?? (() => {})}
                                        onUpdateOutcome={props.onUpdateOutcome}
                                        onUpdatePnL={props.onUpdatePnL}
                                        finalSummary={props.finalSummary ?? null}
                                        individualSummaries={props.individualSummaries ?? []}
                                        isLoading={props.isLoading ?? false}
                                        isInsightGenerating={props.isInsightGenerating}
                                        insightProgress={props.insightProgress}
                                        newlyAddedInsightIds={props.newlyAddedInsightIds}
                                        summarizationProvider={props.summarizationProvider ?? ''}
                                        summarizationModel={props.summarizationModel ?? ''}
                                        onSetSummarizationProvider={props.onSetSummarizationProvider ?? (() => {})}
                                        onSetSummarizationModel={props.onSetSummarizationModel ?? (() => {})}
                                        providers={props.providerConfigs}
                                        summaryCharLimit={props.summaryCharLimit ?? 1000}
                                        onUpdateSummaryCharLimit={props.onUpdateSummaryCharLimit ?? (() => {})}
                                        onRegenerateSummary={props.onRegenerateSummary ?? (() => {})}
                                        onDeleteInsight={props.onDeleteInsight}
                                        useAlgorithmicSummary={props.useAlgorithmicSummary ?? false}
                                        onToggleAlgorithmicSummary={props.onToggleAlgorithmicSummary ?? (() => {})}
                                        useAlgorithmicInsights={props.useAlgorithmicInsights}
                                        onToggleAlgorithmicInsights={props.onToggleAlgorithmicInsights}
                                        onRewriteInsightsWithAI={props.onRewriteInsightsWithAI}
                                        familyWinRates={props.familyWinRates ?? {}}
                                        enabledProviders={props.enabledProviders}
                                        selectedModels={props.selectedModels}
                                    />
                                </div>
                            )}

                            {/* TAB 1: AI Models & Providers */}
                            {activeTab === 'models' && (
                                <div className="space-y-6 animate-fade-in">
                                    {providerConfigsLoaded && readyConfigProviders.length === 0 && (
                                        <div className="status-surface rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                                            <h3 className="text-sm font-bold text-zinc-100">Connect an AI service to get started</h3>
                                            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                                                Choose a provider below, paste your key, select a model, then use Test before running your first analysis. Connection type, custom endpoints, and model IDs are advanced options.
                                            </p>
                                        </div>
                                    )}
                                    {/* Vision & Moderator Controls Header bar */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* Vision Model Selector — models from ready providers */}
                                        {readyConfigProviders.length > 0 && (
                                            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800/80">
                                                <div className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
                                                    Vision Model
                                                </div>
                                                <ModelPicker
                                                    providers={providerConfigs ?? []}
                                                    value={visionModel || selectedOcrModel || ''}
                                                    onChange={(v) => onSetVisionModel?.(v)}
                                                    mode="model-only"
                                                />
                                                <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
                                                    One model for every vision feature — chart OCR, post-trade uploads, and PDF book OCR.
                                                </p>
                                            </div>
                                        )}

                                        {/* Debate Moderator Selector */}
                                        <div className="p-4 rounded-xl bg-zinc-900 border border-cyan-500/20">
                                            <div className="text-xs font-bold text-cyan-400 mb-2 uppercase tracking-wider">
                                                Debate Moderator
                                            </div>
                                            <ModelPicker
                                                providers={providerConfigs ?? []}
                                                value={moderatorProvider && moderatorModel ? `${moderatorProvider}::${moderatorModel}` : moderatorProvider || ''}
                                                onChange={(v) => {
                                                    const separator = v.indexOf('::');
                                                    if (separator >= 0) {
                                                        const providerId = v.slice(0, separator);
                                                        const modelId = v.slice(separator + 2);
                                                        onSetModeratorProvider?.(providerId);
                                                        onSetModeratorModel?.(modelId);
                                                    } else {
                                                        onSetModeratorProvider?.(v);
                                                        const selectedCfg = (providerConfigs ?? []).find(c => c.id === v);
                                                        if (selectedCfg && selectedCfg.models.length > 0) {
                                                            onSetModeratorModel?.(selectedCfg.selectedModel || selectedCfg.models[0]);
                                                        }
                                                    }
                                                }}
                                                mode="provider-model"
                                            />
                                        </div>
                                    </div>

                                    {/* Main Provider Manager UI */}
                                    {providerConfigs && onUpdateProvider && onAddCustomProvider && onRemoveProvider && onToggleProviderConfig ? (
                                        <ProviderManager
                                            configs={providerConfigs}
                                            isLoaded={providerConfigsLoaded}
                                            onUpdateProvider={onUpdateProvider}
                                            onAddCustomProvider={onAddCustomProvider}
                                            onRemoveProvider={onRemoveProvider}
                                            onToggleProvider={onToggleProviderConfig}
                                            onAddModel={onAddModel}
                                            onRemoveModel={onRemoveModel}
                                            onUpdateModel={onUpdateModel}
                                            onDirtyChange={setIsDirty}
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
                                        <p className="text-xs text-zinc-500 mt-1">Core analysis modes first; fine-tuning options are tucked under Advanced.</p>
                                    </div>

                                    {/* CORE — the two modes that change how analyses behave */}
                                    <div className="space-y-4">
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
                                                        onClick={() => setAccuracySubMode?.('original')}
                                                        className={`p-3 rounded-xl border text-left transition-all ${
                                                            accuracySubMode === 'original'
                                                                ? 'bg-cyan-500/10 border-cyan-500/60 text-cyan-300'
                                                                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                                                        }`}
                                                    >
                                                        <div className="text-xs font-bold">Strict Protocol</div>
                                                        <div className="text-[11px] text-zinc-500 mt-1">Validated multi-step analysis with consensus checks. Slower but more thorough.</div>
                                                    </button>
                                                    <button
                                                        onClick={() => setAccuracySubMode?.('pure_ai')}
                                                        className={`p-3 rounded-xl border text-left transition-all ${
                                                            accuracySubMode === 'pure_ai'
                                                                ? 'bg-cyan-500/10 border-cyan-500/60 text-cyan-300'
                                                                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                                                        }`}
                                                    >
                                                        <div className="text-xs font-bold">Pure AI</div>
                                                        <div className="text-[11px] text-zinc-500 mt-1">Faster, unfiltered reasoning with fewer formatting checks.</div>
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Hybrid Intelligence */}
                                        <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 flex items-center justify-between">
                                            <div>
                                                <h4 className="text-sm font-bold text-white">Hybrid Intelligence</h4>
                                                <p className="text-xs text-zinc-400 mt-0.5">Adds real-time market data (price, RSI, MACD, EMAs) to give the AI live context. Default: off.</p>
                                            </div>
                                            <ToggleSwitch checked={isHybridIntelligenceEnabled} onChange={() => {
                                                if (onToggleHybridIntelligence) onToggleHybridIntelligence();
                                                else if (props.setIsHybridIntelligenceEnabled) props.setIsHybridIntelligenceEnabled(!isHybridIntelligenceEnabled);
                                            }} label="Toggle Hybrid Intelligence" />
                                        </div>
                                    </div>

                                    {/* ADVANCED — fine-tuning; most users never touch these */}
                                    <button
                                        type="button"
                                        onClick={() => setIsAdvancedOpen(p => !p)}
                                        className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
                                        aria-expanded={isAdvancedOpen}
                                    >
                                        <div className="text-left">
                                            <h4 className="text-sm font-bold text-white">Advanced</h4>
                                            <p className="text-xs text-zinc-500 mt-0.5">Prompt injection and capture behavior — most users can leave these as-is.</p>
                                        </div>
                                        <span className={`text-zinc-500 text-sm transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`}>▾</span>
                                    </button>
                                    {isAdvancedOpen && (
                                        <div className="space-y-4 animate-fade-in">
                                            {/* Pure AI Context — only relevant in Accuracy Mode → Pure AI */}
                                            {isAccuracyModeEnabled && accuracySubMode === 'pure_ai' && (setIsPlaybookEnabledInPureAI || setIsFamiliesEnabledInPureAI || setIsMemoryEnabledInPureAI) && (
                                                <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 space-y-4 animate-fade-in">
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white">Pure AI Context</h4>
                                                        <p className="text-xs text-zinc-400 mt-0.5">Choose which structured context is injected during Pure AI analysis. All default: off.</p>
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

                                            {/* Auto-Capture Options */}
                                            <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 space-y-4">
                                                <div>
                                                    <h4 className="text-sm font-bold text-white">Automated Capture Prompts</h4>
                                                    <p className="text-xs text-zinc-400 mt-0.5">Ask for trade results automatically. All default: off.</p>
                                                </div>
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

                            {/* TAB 5: Prompts — browse + edit every prompt the app sends */}
                            {activeTab === 'prompts' && (
                                <div className="h-full min-h-0 animate-fade-in">
                                    <PromptManager username={props.username} />
                                </div>
                            )}

                            {/* TAB 5b: Strategies — upload PDF books, summarize, inject */}
                            {activeTab === 'strategies' && (
                                <div className="h-full min-h-0 animate-fade-in">
                                    <StrategiesManager
                                        username={props.username}
                                        providerConfigs={providerConfigs ?? []}
                                        visionConfig={visionConfig ?? null}
                                        isStrategiesEnabled={isStrategiesEnabled}
                                        setIsStrategiesEnabled={setIsStrategiesEnabled}
                                    />
                                </div>
                            )}

                            {/* TAB 6: Memory & Learning */}
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
                                                    <h4 className="text-sm font-bold text-white">Global Memory</h4>
                                                    <p className="text-xs text-zinc-400 mt-0.5">
                                                        {isGlobalMemoryEnabled
                                                            ? 'On — lessons from all your trades are injected into future analyses. Default: off.'
                                                            : 'Off — only this chat\'s own context is used. Default: off.'}
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
                                    {/* Memory Browser — ZCode-style drill-down view */}
                                    <div className="border-t border-zinc-800 pt-4">
                                        <div className="h-[440px]">
                                            <MemoryBrowser username={username} isGlobalMemoryEnabled={isGlobalMemoryEnabled} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 6: Data — Backups & Alerts */}
                            {activeTab === 'actions' && (
                                <div className="space-y-6 max-w-3xl animate-fade-in">
                                    <div className="border-b border-zinc-800 pb-3">
                                        <h3 className="text-base font-bold text-white">Data</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Backups and price alerts.</p>
                                    </div>

                                    {/* Backups — list/export/restore/delete the 30-min auto-backups */}
                                    {username && onProfileRestored && (
                                        <BackupManager username={username} onProfileRestored={onProfileRestored} />
                                    )}

                                    {/* Price alerts — list/toggle/delete */}
                                    <div className="border-t border-zinc-800 pt-6">
                                        <AlertManager />
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>
                </div>
            </div>
            {ConfirmDialogComponent}
        </>
    );
};

export default React.memo(SettingsMenu);
