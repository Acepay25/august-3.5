import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import SessionUsagePanel from './SessionUsagePanel';
import { BackupManager } from './BackupManager';
import { AlertManager } from './AlertManager';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { ActivityIcon, AISettingsIcon, ChevronLeftIcon, HistoryIcon, SettingsIcon, SwitchUserIcon, CodeIcon } from '../shared/Icons';
import PromptManager from './PromptManager';
import StrategiesManager from './StrategiesManager';
import MemoryFilesManager from './MemoryFilesManager';
import ModelPicker from '../shared/ModelPicker';
import { Journal } from '../journal/Journal';
import { getHarnessSettings, saveHarnessSettings } from '../../utils/harnessSettings';

export type SettingsTab = 'general' | 'models' | 'journal' | 'lenses' | 'instructions' | 'memory' | 'actions' | 'prompts' | 'strategies';

const SETTINGS_TABS: SettingsTab[] = ['general', 'models', 'journal', 'lenses', 'instructions', 'memory', 'actions', 'prompts', 'strategies'];

const isSettingsTab = (value?: string): value is SettingsTab =>
    !!value && SETTINGS_TABS.includes(value as SettingsTab);

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

const SettingsSubNav: React.FC<{
    items: { id: SettingsTab; label: string }[];
    value: SettingsTab;
    onChange: (id: SettingsTab) => void;
}> = ({ items, value, onChange }) => (
    <div className="flex gap-1 border-b border-zinc-800 px-1 pb-3">
        {items.map(item => (
            <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] ${value === item.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
                {item.label}
            </button>
        ))}
    </div>
);

const NavTabButton: React.FC<{
    id: SettingsTab;
    activeTab: SettingsTab;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    badge?: string;
    activeWhen?: SettingsTab[];
}> = ({ activeTab, id, onClick, icon, label, badge, activeWhen }) => {
    const isActive = activeWhen ? activeWhen.includes(activeTab) : activeTab === id;
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-sm ${
                isActive
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
        >
            <div className="flex items-center gap-3 min-w-0">
                <span className={`shrink-0 ${isActive ? 'text-zinc-100' : 'text-zinc-500'}`}>{icon}</span>
                <span className="truncate">{label}</span>
            </div>
            {badge && (
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-400">
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
        if (isSettingsTab(props.settingsInitialTab)) {
            return props.settingsInitialTab;
        }
        const hasReadyProvider = (providerConfigs ?? []).some(c => c.isEnabled && c.apiKey.trim().length > 0);
        return hasReadyProvider ? 'general' : 'models';
    });
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [deskToolsEnabled, setDeskToolsEnabled] = useState(() => getHarnessSettings().deskToolsEnabled);
    const [activeInstructionTab, setActiveInstructionTab] = useState<InstructionTab>('general');
    const [isDirty, setIsDirty] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const initialTabResolvedRef = useRef(false);

    // Handle settingsInitialTab prop changes (e.g., when handleOpenJournal sets it)
    useEffect(() => {
        if (isSettingsTab(props.settingsInitialTab)) {
            setActiveTab(props.settingsInitialTab);
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
    const readyConfigProviders = useMemo(
        () => (providerConfigs ?? []).filter(c => c.isEnabled && c.apiKey.trim().length > 0),
        [providerConfigs],
    );

    // Provider configs load asynchronously. Resolve the landing tab once after
    // that load so existing users do not get stranded on provider CRUD while
    // preserving deliberate tab choices after the first render.
    useEffect(() => {
        if (!isVisible || !providerConfigsLoaded || initialTabResolvedRef.current) return;
        initialTabResolvedRef.current = true;
        setActiveTab(readyConfigProviders.length > 0 ? 'general' : 'models');
    }, [isVisible, providerConfigsLoaded, readyConfigProviders.length]);

    if (!isVisible) return null;

    return (
        <>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                className="fixed inset-0 z-50 bg-zinc-950 flex flex-col animate-fade-in"
            >
                    <div className="flex-1 flex min-h-0 flex-col md:flex-row">
                        
                        <div className="w-full md:w-60 max-h-[32vh] overflow-y-auto md:max-h-none md:overflow-y-auto border-b md:border-b-0 md:border-r border-white/10 bg-zinc-950 px-3 py-5 space-y-1 shrink-0 flex flex-col justify-between custom-scrollbar">
                            <div className="space-y-1">
                                <div className="px-2 mb-5">
                                    <button
                                        type="button"
                                        onClick={requestClose}
                                        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
                                    >
                                        <ChevronLeftIcon className="w-4 h-4" /> Back to workspace
                                    </button>
                                </div>
                                <h2 id="settings-title" className="sr-only">Settings</h2>
                                <p className="ui-kicker px-3 pt-1 pb-2">
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
                                <p className="ui-kicker px-3 pt-5 pb-2">
                                    Analysis
                                </p>
                                <NavTabButton
                                    id="general"
                                    activeTab={activeTab}
                                    activeWhen={['general', 'lenses']}
                                    onClick={() => setActiveTab('general')}
                                    icon={<SettingsIcon className="w-4 h-4" />}
                                    label="Analysis"
                                />
                                <NavTabButton
                                    id="prompts"
                                    activeTab={activeTab}
                                    activeWhen={['prompts', 'instructions']}
                                    onClick={() => setActiveTab('prompts')}
                                    icon={<CodeIcon className="w-4 h-4" />}
                                    label="Prompts"
                                />
                                <NavTabButton
                                    id="memory"
                                    activeTab={activeTab}
                                    activeWhen={['memory', 'strategies']}
                                    onClick={() => setActiveTab('memory')}
                                    icon={<ActivityIcon className="w-4 h-4" />}
                                    label="Knowledge"
                                />
                                {/* Account & Data — journal, profile, backups */}
                                <p className="ui-kicker px-3 pt-5 pb-2">
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
                        <div className={`flex-1 min-h-0 overflow-y-auto bg-zinc-950 custom-scrollbar ${
                            activeTab === 'journal' || activeTab === 'prompts' || activeTab === 'memory' || activeTab === 'instructions' || activeTab === 'strategies'
                                ? ''
                                : activeTab === 'models'
                                    ? 'px-6 py-8 lg:px-12 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-6xl'
                                    : 'px-6 py-8 lg:px-10 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-3xl'
                        }`}>
                            
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
                                <div className="space-y-6 animate-fade-in min-h-0">
                                    {providerConfigsLoaded && readyConfigProviders.length === 0 && (
                                        <div className="status-surface rounded-2xl border border-zinc-700/60 bg-zinc-900 p-4">
                                            <h3 className="text-sm font-bold text-zinc-100">Connect an AI service to get started</h3>
                                            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                                                Add a provider, paste its key, pick a model, then use Test before running your first analysis.
                                            </p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                                        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800/80">
                                            <div className="text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">
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
                                    <SettingsSubNav
                                        items={[
                                            { id: 'general', label: 'Modes' },
                                            { id: 'lenses', label: 'Roles' },
                                        ]}
                                        value={activeTab}
                                        onChange={setActiveTab}
                                    />
                                    <div className="border-b border-zinc-800 pb-3">
                                        <h3 className="text-base font-bold text-white">Analysis</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Core analysis modes first; fine-tuning is under Advanced.</p>
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
                                                                ? 'bg-zinc-900 border-zinc-500 text-zinc-100'
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
                                                                ? 'bg-zinc-900 border-zinc-500 text-zinc-100'
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

                                        {/* Desk Tools */}
                                        <div className="p-5 rounded-2xl bg-zinc-800 border border-zinc-800 flex items-center justify-between">
                                            <div>
                                                <h4 className="text-sm font-bold text-white">Desk Tools</h4>
                                                <p className="text-xs text-zinc-400 mt-0.5">Lets analysts and the moderator call live tools anytime — opening, rebuttal, clarification, or verdict: web search, funding/OI, order book, liquidations, BTC context, session timing. Default: on.</p>
                                            </div>
                                            <ToggleSwitch
                                                checked={deskToolsEnabled}
                                                onChange={() => {
                                                    const next = !deskToolsEnabled;
                                                    setDeskToolsEnabled(next);
                                                    saveHarnessSettings({ deskToolsEnabled: next });
                                                }}
                                                label="Toggle Desk Tools"
                                            />
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

                            {(activeTab === 'general' || activeTab === 'lenses') && activeTab === 'lenses' && (
                                <div className="space-y-4 animate-fade-in">
                                    <SettingsSubNav
                                        items={[
                                            { id: 'general', label: 'Modes' },
                                            { id: 'lenses', label: 'Roles' },
                                        ]}
                                        value={activeTab}
                                        onChange={setActiveTab}
                                    />
                                    <div className="border-b border-zinc-800 pb-3">
                                        <h3 className="text-base font-bold text-white">Analyst roles</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Assign Technical, Risk, and Macro personas to models.</p>
                                    </div>
                                    <AnalystLensSettings
                                        config={lensConfig}
                                        onChange={onSetLensConfig}
                                        providers={providerConfigs ?? []}
                                    />
                                </div>
                            )}

                            {(activeTab === 'prompts' || activeTab === 'instructions') && (
                                <div className="h-full min-h-0 animate-fade-in flex flex-col">
                                    <div className="px-4 pt-4 shrink-0">
                                        <SettingsSubNav
                                            items={[
                                                { id: 'prompts', label: 'Registry' },
                                                { id: 'instructions', label: 'Instructions' },
                                            ]}
                                            value={activeTab === 'instructions' ? 'instructions' : 'prompts'}
                                            onChange={setActiveTab}
                                        />
                                    </div>
                                    {activeTab === 'instructions' ? (
                                        <div className="flex-1 min-h-[480px] px-4 pb-4">
                                            <CustomInstructionsEditor
                                                customInstructions={customInstructions}
                                                setCustomInstructions={setCustomInstructions}
                                                activeTab={activeInstructionTab}
                                                onTabChange={setActiveInstructionTab}
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex-1 min-h-0">
                                            <PromptManager username={props.username} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {(activeTab === 'memory' || activeTab === 'strategies') && (
                                <div className="h-full min-h-0 animate-fade-in flex flex-col">
                                    <div className="px-4 pt-4 shrink-0">
                                        <SettingsSubNav
                                            items={[
                                                { id: 'memory', label: 'Memory' },
                                                { id: 'strategies', label: 'Playbooks' },
                                            ]}
                                            value={activeTab === 'strategies' ? 'strategies' : 'memory'}
                                            onChange={setActiveTab}
                                        />
                                    </div>
                                    <div className="flex-1 min-h-0">
                                        {activeTab === 'strategies' ? (
                                            <StrategiesManager
                                                username={props.username}
                                                providerConfigs={providerConfigs ?? []}
                                                visionConfig={visionConfig ?? null}
                                                isStrategiesEnabled={isStrategiesEnabled}
                                                setIsStrategiesEnabled={setIsStrategiesEnabled}
                                            />
                                        ) : (
                                            <MemoryFilesManager
                                                username={username}
                                                isGlobalMemoryEnabled={isGlobalMemoryEnabled}
                                                setIsGlobalMemoryEnabled={setIsGlobalMemoryEnabled}
                                                memoryConfig={memoryConfig ?? null}
                                                memorySettings={
                                                    <MemorySettings
                                                        providerConfigs={providerConfigs ?? []}
                                                        memoryConfig={memoryConfig ?? null}
                                                        onMemoryConfigChange={onMemoryConfigChange}
                                                    />
                                                }
                                            />
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* TAB 6: Data — Backups & Alerts */}
                            {activeTab === 'actions' && (
                                <div className="space-y-6 max-w-3xl animate-fade-in">
                                    <div className="border-b border-zinc-800 pb-3">
                                        <h3 className="text-base font-bold text-white">Data</h3>
                                        <p className="text-xs text-zinc-500 mt-1">Usage, backups, and price alerts.</p>
                                    </div>

                                    <SessionUsagePanel />

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
            {ConfirmDialogComponent}
        </>
    );
};

export default React.memo(SettingsMenu);
