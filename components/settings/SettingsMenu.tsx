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
import ToolForgeManager from './ToolForgeManager';
import { loadForgedTools } from '../../services/tools/toolForge';
import { listAmendments } from '../../services/learning/memoryAmendments';
import DeskSeatMappingEditor from './DeskSeatMappingEditor';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import SessionUsagePanel from './SessionUsagePanel';
import { BackupManager } from './BackupManager';
import { StorageLocationCard } from './StorageLocationCard';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { EmptyState } from '../ui/EmptyState';
import { AISettingsIcon, HistoryIcon, SettingsIcon, CodeIcon, SearchIcon, CloseIcon } from '../shared/Icons';
import { getIdleMotionEnabled, setIdleMotionEnabled, subscribeIdleMotion } from '../../services/desk/idleMotion';
import PromptManager from './PromptManager';
import StrategiesManager from './StrategiesManager';
import ProfileMemoryCard from './ProfileMemoryCard';
import SupervisorCard from './SupervisorCard';
import AutoJournalRulesCard from './AutoJournalRulesCard';
import type { LearnTab } from '../learn/LearnView';
import ModelPicker from '../shared/ModelPicker';
import {
    User, Users, Bot, FileText, Brain, Sparkles, BookOpen, Database, HardDrive, ShieldCheck,
    Wrench, Eye, Activity, ArrowUpRight, Search, X, ChevronDown, ChevronRight, Layers
} from 'lucide-react';
import { getHarnessSettings, saveHarnessSettings } from '../../utils/harnessSettings';

export type SettingsTab = 'profile' | 'general' | 'models' | 'journal' | 'lenses' | 'instructions' | 'memory' | 'actions' | 'prompts' | 'strategies' | 'skills';

const SETTINGS_TABS: SettingsTab[] = ['profile', 'general', 'models', 'journal', 'lenses', 'instructions', 'memory', 'actions', 'prompts', 'strategies', 'skills'];

/** Tabs whose embedded manager owns the whole scroll container (their own
 *  padding, their own sticky headers) — the workspace adds none. */
const FULL_BLEED_TABS: SettingsTab[] = ['prompts', 'memory', 'instructions', 'strategies', 'skills'];

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
    /** Opens the Strategy Studio — the browse/annotate playbook library. */
    onOpenStrategyStudio?: () => void;
    /** Opens the Learn surface — the one home for the queues, the notebook and
     *  memory health. Settings keeps the provider/model switches and links here.
     *  Pass a tab to land somewhere specific. */
    onOpenLearn?: (tab?: LearnTab) => void;
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
    // A 16-prop "Journal embedded props" block used to sit here, left behind
    // when the Journal stopped being an overlay inside Settings and became a
    // surface: every prop declared, none read, all still computed and passed by
    // App. The journal's editors live in <Journal>/<TradeLog> now. The names are
    // deliberately not listed — tests/deadControlsGuard.test.ts forbids them in
    // this file, comment included.
    familyWinRates?: Record<string, { total: number; wins: number; winRate: number }>;
    enabledProviders?: AIProvider[];
    selectedModels?: Record<string, string>;
    onUpdateModel?: (providerId: string, oldModelId: string, newModelId: string) => Promise<void>;
    // Settings initial tab (set by handleOpenJournal to open Journal tab directly)
    settingsInitialTab?: string;
    onSettingsInitialTabConsumed?: () => void;
}

// ─── Shared UI Helpers ────────────────────────────────────────────────────────
// The reference settings layout is: grouped sidebar → page header → cards of
// hairline rows, each row an icon tile, a title + description, and the control
// pushed to the right edge. These four helpers are that shape; every tab here
// composes them instead of hand-rolling the same row again.

const NavTabButton: React.FC<{
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    badge?: string;
}> = ({ active, onClick, icon, label, badge }) => (
    <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium transition-colors ${
            active
                ? 'bg-zinc-800 text-zinc-100 shadow-sm ring-1 ring-white/[0.07]'
                : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
        }`}
    >
        <span className="flex min-w-0 items-center gap-2.5">
            <span className={`shrink-0 ${active ? 'text-zinc-100' : 'text-zinc-500'}`}>{icon}</span>
            <span className="truncate">{label}</span>
        </span>
        {badge && (
            <span className="shrink-0 rounded-full bg-zinc-700 px-1.5 py-0.5 font-mono text-ui-2xs font-bold leading-none text-zinc-200">
                {badge}
            </span>
        )}
    </button>
);

const SettingsGroup: React.FC<{
    title?: string;
    description?: string;
    children: React.ReactNode;
}> = ({ title, description, children }) => (
    <section className="space-y-1.5">
        {title && (
            <div className="px-1">
                <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{title}</h4>
                {description && <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-600">{description}</p>}
            </div>
        )}
        <div className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/50">
            {children}
        </div>
    </section>
);

const SettingsRow: React.FC<{
    icon?: React.ReactNode;
    title: string;
    description?: React.ReactNode;
    control?: React.ReactNode;
    /** For a control that needs the row's full width (an editor, not a
     *  switch) — it drops below the label instead of squeezing the text. */
    stacked?: boolean;
}> = ({ icon, title, description, control, stacked = false }) => (
    <div className={`flex gap-4 p-4 transition-colors hover:bg-white/[0.015] ${
        stacked ? 'flex-col items-start' : 'items-center justify-between'
    }`}>
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
            {icon && (
                <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-zinc-400">
                    {icon}
                </span>
            )}
            <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-5 text-zinc-200">{title}</div>
                {description && (
                    <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{description}</div>
                )}
            </div>
        </div>
        {control && <div className={stacked ? 'w-full' : 'shrink-0'}>{control}</div>}
    </div>
);

const SettingsPageHeader: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
    <header className="border-b border-white/[0.06] pb-3.5">
        <h3 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p>}
    </header>
);

/** Two-choice setting that belongs INSIDE a row rather than as two full-width
 *  cards — the reference keeps the control on the row's right edge. */
const SegmentedControl: React.FC<{
    value: string;
    options: Array<{ id: string; label: string; title?: string }>;
    onChange: (id: string) => void;
    ariaLabel: string;
}> = ({ value, options, onChange, ariaLabel }) => (
    <div role="radiogroup" aria-label={ariaLabel}
        className="flex items-center gap-0.5 rounded-full border border-white/[0.07] bg-zinc-800/70 p-0.5">
        {options.map(o => (
            <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={value === o.id}
                title={o.title}
                onClick={() => onChange(o.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 ease-[var(--ease-snappy)] ${
                    value === o.id ? 'bg-zinc-700 text-zinc-100 ring-1 ring-white/[0.07]' : 'text-zinc-500 hover:text-zinc-300'
                }`}
            >
                {o.label}
            </button>
        ))}
    </div>
);

const NAV_ICON = 'h-4 w-4 shrink-0';

interface NavEntry {
    id: SettingsTab;
    label: string;
    icon: React.ReactNode;
    /** Content words the search box matches beyond the label itself — the
     *  sidebar says "Playbooks" but a user types "strategy", and both must
     *  find it. */
    keywords: string;
}

interface NavGroup { title: string; entries: NavEntry[] }

/** The sidebar is this list, filtered — not a hand-written button per tab.
 *  Adding a tab used to mean remembering to also add its group header and its
 *  own navMatch() clause, which is how 'profile' ended up reachable from the
 *  account menu but absent from the nav (and never rendered). */
const NAV_GROUPS: NavGroup[] = [
    {
        title: 'Setup',
        entries: [
            { id: 'models', label: 'AI setup', icon: <AISettingsIcon className={NAV_ICON} />, keywords: 'provider api key model vision moderator memory ocr connect' },
        ],
    },
    {
        title: 'Analysis',
        entries: [
            { id: 'general', label: 'Analysis', icon: <SettingsIcon className={NAV_ICON} />, keywords: 'accuracy hybrid desk tools idle motion capture pure ai advanced strict protocol' },
            { id: 'lenses', label: 'Roles', icon: <Eye className={NAV_ICON} />, keywords: 'lens analyst technical risk macro persona' },
            { id: 'prompts', label: 'Prompts', icon: <CodeIcon className={NAV_ICON} />, keywords: 'template library editing' },
            { id: 'instructions', label: 'Instructions', icon: <FileText className={NAV_ICON} />, keywords: 'custom system instruction rules' },
        ],
    },
    {
        title: 'Knowledge',
        entries: [
            { id: 'memory', label: 'Memory', icon: <Brain className={NAV_ICON} />, keywords: 'notebook amendment supervisor profile memory files global' },
            { id: 'skills', label: 'Skills', icon: <Sparkles className={NAV_ICON} />, keywords: 'forged tool approval candidate library learned' },
            { id: 'strategies', label: 'Playbooks', icon: <BookOpen className={NAV_ICON} />, keywords: 'strategy book pdf upload studio families import' },
        ],
    },
    {
        title: 'Account',
        entries: [
            { id: 'profile', label: 'Profile', icon: <User className={NAV_ICON} />, keywords: 'account trader switch export data version about' },
            { id: 'journal', label: 'Journal', icon: <HistoryIcon className={NAV_ICON} />, keywords: 'trades log summary insights statistics win rate' },
            { id: 'actions', label: 'Data', icon: <Database className={NAV_ICON} />, keywords: 'usage backup restore session tokens' },
        ],
    },
];

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
        onOpenStrategyStudio,
        onOpenLearn,
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
    // Bound once so the narrowing survives into the callback the children get.
    const openLearnQueue = onOpenLearn ? () => onOpenLearn('queue') : undefined;
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [deskToolsEnabled, setDeskToolsEnabled] = useState(() => getHarnessSettings().deskToolsEnabled);
    // Idle motion (breath / fidget / blink / sway). Default ON. The
    // toggle is per-user, persisted via services/desk/idleMotion.
    const [idleMotionEnabled, setIdleMotionState] = useState(() => getIdleMotionEnabled());
    useEffect(() => subscribeIdleMotion(setIdleMotionState), []);
    const [activeInstructionTab, setActiveInstructionTab] = useState<InstructionTab>('general');
    const [isDirty, setIsDirty] = useState(false);
    const [navQuery, setNavQuery] = useState('');
    // Pending-proposal counters for the nav badges: model-authored tools
    // and notebook amendments waiting for a human decision.
    const [pendingForged, setPendingForged] = useState(() => loadForgedTools().filter(t => t.status === 'candidate').length);
    const [pendingAmendments, setPendingAmendments] = useState(() => listAmendments('pending').length);
    useEffect(() => {
        const sync = (): void => {
            setPendingForged(loadForgedTools().filter(t => t.status === 'candidate').length);
            setPendingAmendments(listAmendments('pending').length);
        };
        sync();
        // Proposals arrive via custom events; poll as a cheap fallback
        // (the panels also self-refresh on the same cadence).
        const t = window.setInterval(sync, 5000);
        window.addEventListener('august:forged-proposal', sync);
        window.addEventListener('august:memory-amendment', sync);
        return () => {
            window.clearInterval(t);
            window.removeEventListener('august:forged-proposal', sync);
            window.removeEventListener('august:memory-amendment', sync);
        };
    }, []);
    const navQ = navQuery.trim().toLowerCase();
    const navMatches = (entry: NavEntry): boolean =>
        !navQ
        || entry.label.toLowerCase().includes(navQ)
        || entry.keywords.includes(navQ);
    const navBadge = (id: SettingsTab): string | undefined => {
        if (id === 'memory') return pendingAmendments > 0 ? String(pendingAmendments) : undefined;
        if (id === 'skills') return pendingForged > 0 ? String(pendingForged) : undefined;
        if (id === 'journal') return props.loggedTrades && props.loggedTrades.length > 0 ? String(props.loggedTrades.length) : undefined;
        return undefined;
    };
    const dialogRef = useRef<HTMLDivElement>(null);
    const initialTabResolvedRef = useRef(false);
    /** A tab the parent explicitly ASKED FOR outranks the heuristic landing.
     *  Recorded here because the requested prop is consumed immediately, so by
     *  the time the landing effect runs — declared later, same commit — there
     *  is nothing left for it to see, and it used to overwrite the choice. */
    const explicitTabChosenRef = useRef(false);

    // Handle settingsInitialTab prop changes (e.g., when handleOpenJournal sets it)
    useEffect(() => {
        if (isSettingsTab(props.settingsInitialTab)) {
            setActiveTab(props.settingsInitialTab);
            explicitTabChosenRef.current = true;
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

    // The open-effect below must re-run ONLY when the dialog opens/closes.
    // Depending on `requestClose` directly (inline-identity `onClose` from the
    // parent) re-added the keydown listener and re-queued the autofocus on
    // every parent render — stealing focus mid-typing in provider forms.
    // Route the latest callback through a ref and focus once per open.
    const requestCloseRef = useRef(requestClose);
    useEffect(() => {
        requestCloseRef.current = requestClose;
    }, [requestClose]);

    useEffect(() => {
        if (!isVisible) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                requestCloseRef.current();
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
    }, [isVisible]);

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
        // Do not step on a deliberate first landing: the very first Profile
        // click opened Analysis, because this effect ran after it.
        if (explicitTabChosenRef.current) return;
        setActiveTab(readyConfigProviders.length > 0 ? 'general' : 'models');
    }, [isVisible, providerConfigsLoaded, readyConfigProviders.length]);

    if (!isVisible) return null;

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={requestClose} aria-hidden="true" />
                <div
                    ref={dialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="settings-title"
                    className="relative flex h-[min(860px,94vh)] w-[min(1180px,97vw)] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl animate-fade-in"
                >
                    <button
                        type="button"
                        onClick={requestClose}
                        aria-label="Close settings"
                        className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                    >
                        <CloseIcon className="h-5 w-5" />
                    </button>
                    <div className="flex-1 flex min-h-0 flex-col md:flex-row">
                        
                        <div className="w-full md:w-64 max-h-[32vh] overflow-y-auto md:max-h-none md:overflow-y-auto border-b md:border-b-0 md:border-r border-white/[0.06] bg-black/20 px-3 py-4 space-y-1 shrink-0 flex flex-col justify-between custom-scrollbar">
                            <div className="space-y-1">
                                <div className="px-1 pb-4">
                                    <div className="flex items-center gap-2 rounded-control border border-white/[0.07] bg-zinc-800/80 px-2.5 py-2 transition-colors focus-within:border-white/20">
                                        <SearchIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                                        <input
                                            value={navQuery}
                                            onChange={e => setNavQuery(e.target.value)}
                                            placeholder="Search settings"
                                            aria-label="Search settings"
                                            className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                                        />
                                    </div>
                                </div>
                                <h2 id="settings-title" className="sr-only">Settings</h2>
                                {NAV_GROUPS.map(group => {
                                    const entries = group.entries.filter(navMatches);
                                    if (entries.length === 0) return null;
                                    return (
                                        <div key={group.title} className="space-y-0.5 pt-5 first:pt-0">
                                            <p className="ui-kicker px-2.5 pb-1">{group.title}</p>
                                            {entries.map(entry => (
                                                <NavTabButton
                                                    key={entry.id}
                                                    active={activeTab === entry.id}
                                                    onClick={() => setActiveTab(entry.id)}
                                                    icon={entry.icon}
                                                    label={entry.label}
                                                    badge={navBadge(entry.id)}
                                                />
                                            ))}
                                        </div>
                                    );
                                })}
                                {navQ && !NAV_GROUPS.some(g => g.entries.some(navMatches)) && (
                                    <EmptyState
                                        compact
                                        iconVariant="subtle"
                                        align="start"
                                        icon={<Search className="h-5 w-5" />}
                                        title={`Nothing matches "${navQuery.trim()}"`}
                                    />
                                )}
                            </div>

                            {/* Diagnostics & Version at bottom of nav — developer
                                tooling tucked behind a collapsible so it doesn't
                                sit on a user-facing screen. */}
                            <div className="pt-4 border-t border-zinc-800/80 space-y-2">
                                <details className="group">
                                    <summary className="flex cursor-pointer select-none list-none items-center justify-between font-mono text-ui-xs text-zinc-600 hover:text-zinc-400">
                                        <span>Developer</span>
                                        <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-150 ease-[var(--ease-snappy)] group-open:rotate-90" aria-hidden="true" />
                                    </summary>
                                    <div className="mt-2">
                                        <DiagnosticsPanel />
                                    </div>
                                </details>
                                <p className="text-ui-xs text-zinc-600 text-center font-mono">
                                    {APP_NAME} v{APP_VERSION}
                                </p>
                            </div>
                        </div>

                        {/* Right Content Workspace. Three layout modes: tabs
                            that own their whole scroll container (the embedded
                            managers), a wide measure for data-dense pages, and
                            a reading measure for preference pages. */}
                        <div className={`flex-1 min-h-0 overflow-y-auto bg-zinc-900 custom-scrollbar ${
                            FULL_BLEED_TABS.includes(activeTab)
                                ? ''
                                : activeTab === 'models' || activeTab === 'journal'
                                    ? 'px-6 py-8 lg:px-10 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-5xl'
                                    : 'px-6 py-8 lg:px-10 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-3xl'
                        }`}>
                            
                            {/* TAB 0: Trading Journal — Hub & Quick Launcher */}
                            {activeTab === 'journal' && (() => {
                                const trades = props.loggedTrades ?? [];
                                const totalTrades = trades.length;
                                const winTrades = trades.filter(t => t.outcome === 'WIN').length;
                                const lossTrades = trades.filter(t => t.outcome === 'LOSS').length;
                                const pendingTrades = trades.filter(t => !t.outcome || t.outcome === 'PENDING' || t.outcome === 'ENTRY_NOT_HIT').length;
                                const decidedTrades = winTrades + lossTrades;
                                const winRate = decidedTrades > 0 ? Math.round((winTrades / decidedTrades) * 100) : 0;

                                return (
                                    <div className="space-y-5 animate-fade-in">
                                        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                                            <SettingsPageHeader
                                                title="Journal"
                                                description="Review past trades, AI pattern memory, and model performance metrics."
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onClose();
                                                    onOpenJournal?.('log');
                                                }}
                                                className="mb-3.5 inline-flex items-center justify-center gap-2 rounded-control border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700 hover:text-zinc-100 active:scale-[0.98]"
                                            >
                                                <span>Open Trading Journal</span>
                                                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                                            </button>
                                        </div>

                                        {/* Stats grid */}
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <div className="rounded-xl border border-white/[0.06] bg-zinc-800/40 p-3.5">
                                                <span className="text-ui-xs uppercase font-semibold tracking-wider text-zinc-500">Total Logged</span>
                                                <p className="mt-1 font-mono text-xl font-bold text-zinc-100">{totalTrades}</p>
                                            </div>
                                            <div className="rounded-xl border border-white/[0.06] bg-zinc-800/40 p-3.5">
                                                <span className="text-ui-xs uppercase font-semibold tracking-wider text-zinc-500">Win Rate</span>
                                                <p className="mt-1 font-mono text-xl font-bold text-emerald-400">{decidedTrades > 0 ? `${winRate}%` : '—'}</p>
                                            </div>
                                            <div className="rounded-xl border border-white/[0.06] bg-zinc-800/40 p-3.5">
                                                <span className="text-ui-xs uppercase font-semibold tracking-wider text-zinc-500">Wins / Losses</span>
                                                <p className="mt-1 font-mono text-xl font-bold text-zinc-200">
                                                    <span className="text-emerald-400">{winTrades}</span>
                                                    <span className="text-zinc-600 mx-1">/</span>
                                                    <span className="text-rose-400">{lossTrades}</span>
                                                </p>
                                            </div>
                                            <div className="rounded-xl border border-white/[0.06] bg-zinc-800/40 p-3.5">
                                                <span className="text-ui-xs uppercase font-semibold tracking-wider text-zinc-500">Open / Pending</span>
                                                <p className="mt-1 font-mono text-xl font-bold text-amber-400">{pendingTrades}</p>
                                            </div>
                                        </div>

                                        {/* Quick navigation cards */}
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onClose();
                                                    onOpenJournal?.('log');
                                                }}
                                                className="group flex flex-col rounded-xl border border-white/[0.06] bg-zinc-800/30 p-4 text-left transition-colors hover:border-cyan-500/40 hover:bg-zinc-800/60"
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <span className="font-semibold text-xs text-zinc-200 group-hover:text-cyan-400 transition-colors">Trade Log</span>
                                                    <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                                                </div>
                                                <p className="mt-1.5 text-[11px] text-zinc-400">View and manage all recorded trades, outcomes, and screenshots.</p>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onClose();
                                                    onOpenLearn?.('health');
                                                }}
                                                className="group flex flex-col rounded-xl border border-white/[0.06] bg-zinc-800/30 p-4 text-left transition-colors hover:border-cyan-500/40 hover:bg-zinc-800/60"
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <span className="font-semibold text-xs text-zinc-200 group-hover:text-cyan-400 transition-colors">Pattern Memory</span>
                                                    <Sparkles className="h-3.5 w-3.5 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                                                </div>
                                                <p className="mt-1.5 text-[11px] text-zinc-400">Review lessons learned and recurring patterns identified across your trades.</p>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onClose();
                                                    onOpenJournal?.('models');
                                                }}
                                                className="group flex flex-col rounded-xl border border-white/[0.06] bg-zinc-800/30 p-4 text-left transition-colors hover:border-cyan-500/40 hover:bg-zinc-800/60"
                                            >
                                                <div className="flex items-center justify-between w-full">
                                                    <span className="font-semibold text-xs text-zinc-200 group-hover:text-cyan-400 transition-colors">Model Performance</span>
                                                    <Bot className="h-3.5 w-3.5 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                                                </div>
                                                <p className="mt-1.5 text-[11px] text-zinc-400">Compare win rates and accuracy across different AI providers and models.</p>
                                            </button>
                                        </div>

                                        {/* The approvals inbox's standing Always/Never rules: created
                                            by one click, enforced on every pinned setup — and with this
                                            card, listable and revocable for the first time. */}
                                        <AutoJournalRulesCard username={username} />

                                        {/* Journal Configuration */}
                                        <SettingsGroup
                                            title="Summaries"
                                            description="How the journal writes its own review text."
                                        >
                                            <SettingsRow
                                                icon={<Activity className="h-4 w-4" />}
                                                title="Algorithmic summary"
                                                description="Instant calculation from the trade ledger instead of a model call."
                                                control={
                                                    <ToggleSwitch
                                                        checked={props.useAlgorithmicSummary ?? false}
                                                        onChange={() => props.onToggleAlgorithmicSummary?.(!props.useAlgorithmicSummary)}
                                                        label="Toggle algorithmic summary"
                                                    />
                                                }
                                            />
                                            <SettingsRow
                                                icon={<Sparkles className="h-4 w-4" />}
                                                title="Algorithmic pattern insights"
                                                description="Extract insights with local heuristics alongside AI pattern memory."
                                                control={
                                                    <ToggleSwitch
                                                        checked={props.useAlgorithmicInsights ?? false}
                                                        onChange={() => props.onToggleAlgorithmicInsights?.(!props.useAlgorithmicInsights)}
                                                        label="Toggle algorithmic pattern insights"
                                                    />
                                                }
                                            />
                                            {props.onUpdateSummaryCharLimit && (
                                                <SettingsRow
                                                    icon={<FileText className="h-4 w-4" />}
                                                    title="Summary character limit"
                                                    description="Maximum length for AI-generated journal review summaries."
                                                    control={
                                                        <input
                                                            type="number"
                                                            value={props.summaryCharLimit ?? 1000}
                                                            onChange={e => props.onUpdateSummaryCharLimit?.(Number(e.target.value))}
                                                            aria-label="Summary character limit"
                                                            className="w-24 rounded-control border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-right font-mono text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
                                                            min={200}
                                                            max={5000}
                                                            step={100}
                                                        />
                                                    }
                                                />
                                            )}
                                        </SettingsGroup>
                                    </div>
                                );
                            })()}

                            {/* TAB 1: AI Models & Providers */}
                            {activeTab === 'models' && (
                                <div className="space-y-5 animate-fade-in min-h-0">
                                    <SettingsPageHeader
                                        title="AI setup"
                                        description="Connect a provider, then choose which model fills each seat on the desk."
                                    />
                                    {providerConfigsLoaded && readyConfigProviders.length === 0 && (
                                        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-4">
                                            <h3 className="text-sm font-semibold text-zinc-100">Connect an AI service to get started</h3>
                                            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                                                Add a provider below, paste its key, pick a model, then use Test before running your first analysis.
                                            </p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {readyConfigProviders.length > 0 && (
                                            <div className="rounded-2xl border border-white/[0.07] bg-zinc-900/50 p-4">
                                                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                                                    Vision Model
                                                </div>
                                                <ModelPicker
                                                    providers={providerConfigs ?? []}
                                                    value={visionModel || selectedOcrModel || ''}
                                                    onChange={(v) => onSetVisionModel?.(v)}
                                                    mode="model-only"
                                                />
                                                <p className="text-ui-xs text-zinc-600 mt-2 leading-relaxed">
                                                    One model for every vision feature — chart OCR, post-trade uploads, and PDF book OCR.
                                                </p>
                                            </div>
                                        )}

                                        <div className="rounded-2xl border border-white/[0.07] bg-zinc-900/50 p-4">
                                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                                                Memory Model
                                            </div>
                                            <ModelPicker
                                                providers={providerConfigs ?? []}
                                                value={memoryConfig?.id && memoryConfig?.selectedModel ? `${memoryConfig.id}::${memoryConfig.selectedModel}` : memoryConfig?.id ?? ''}
                                                onChange={(v) => {
                                                    const separator = v.indexOf('::');
                                                    if (separator >= 0) {
                                                        const providerId = v.slice(0, separator);
                                                        const modelId = v.slice(separator + 2);
                                                        const selected = (providerConfigs ?? []).find(p => p.id === providerId) ?? null;
                                                        if (selected) onMemoryConfigChange?.({ ...selected, selectedModel: modelId });
                                                    } else {
                                                        onMemoryConfigChange?.((providerConfigs ?? []).find(p => p.id === v) ?? null);
                                                    }
                                                }}
                                                mode="provider-model"
                                            />
                                            <p className="text-ui-xs text-zinc-600 mt-2 leading-relaxed">
                                                The librarian: reviews the notebook, distills skills, organizes memory files, and runs every background learning pass.
                                            </p>
                                        </div>

                                        <div className="rounded-2xl border border-white/[0.07] bg-zinc-900/50 p-4">
                                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
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

                            {/* TAB 1: Profile — who is signed in and what their
                                desk holds. The account menu has linked here all
                                along; the tab itself was never rendered, so
                                Profile opened an empty pane. */}
                            {activeTab === 'profile' && (() => {
                                const trades = props.loggedTrades ?? [];
                                const wins = trades.filter(t => t.outcome === 'WIN').length;
                                const losses = trades.filter(t => t.outcome === 'LOSS').length;
                                const decided = wins + losses;
                                const readyProviders = (providerConfigs ?? []).filter(c => c.isEnabled && c.apiKey.trim().length > 0).length;
                                const initial = (username || '?').trim().charAt(0).toUpperCase();
                                return (
                                    <div className="space-y-5 animate-fade-in">
                                        <SettingsPageHeader
                                            title="Profile"
                                            description="The active trader profile — its journal, memory and backups are separate from every other profile on this device."
                                        />

                                        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/[0.07] bg-zinc-900/50 p-5">
                                            <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-xl font-semibold text-zinc-100">
                                                {initial}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-base font-semibold text-zinc-100">{username || 'Trader'}</div>
                                                <div className="mt-0.5 text-[11px] text-zinc-500">
                                                    {APP_NAME} v{APP_VERSION}
                                                    {providerConfigsLoaded
                                                        ? ` · ${readyProviders} ${readyProviders === 1 ? 'provider' : 'providers'} connected`
                                                        : ' · loading providers…'}
                                                </div>
                                            </div>
                                            {onSwitchUser && (
                                                <button
                                                    type="button"
                                                    onClick={onSwitchUser}
                                                    className="inline-flex items-center gap-1.5 rounded-control border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-700 hover:text-zinc-100"
                                                >
                                                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                                                    Switch profile
                                                </button>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                            {[
                                                { label: 'Trades logged', value: String(trades.length), tone: 'text-zinc-100' },
                                                { label: 'Win rate', value: decided > 0 ? `${Math.round((wins / decided) * 100)}%` : '—', tone: decided > 0 && wins >= losses ? 'text-emerald-400' : decided > 0 ? 'text-rose-400' : 'text-zinc-100' },
                                                { label: 'Wins / Losses', value: `${wins}/${losses}`, tone: 'text-zinc-100' },
                                                { label: 'Open / Pending', value: String(trades.length - decided), tone: trades.length - decided > 0 ? 'text-amber-400' : 'text-zinc-100' },
                                            ].map(stat => (
                                                <div key={stat.label} className="rounded-xl border border-white/[0.06] bg-zinc-800/40 px-3.5 py-3">
                                                    <div className="text-ui-xs font-semibold uppercase tracking-wider text-zinc-500">{stat.label}</div>
                                                    <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${stat.tone}`}>{stat.value}</div>
                                                </div>
                                            ))}
                                        </div>

                                        <SettingsGroup title="Account">
                                            <SettingsRow
                                                icon={<User className="h-4 w-4" />}
                                                title="Trading journal"
                                                description="Trade log, pattern memory, model performance and reasoning history."
                                                control={
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab('journal')}
                                                        className="inline-flex items-center gap-1 rounded-control border border-white/10 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
                                                    >
                                                        Open <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                                                    </button>
                                                }
                                            />
                                            {onExportData && (
                                                <SettingsRow
                                                    icon={<Database className="h-4 w-4" />}
                                                    title="Export this profile"
                                                    description="Download trades, analyses and memory as a JSON archive."
                                                    control={
                                                        <button
                                                            type="button"
                                                            onClick={() => void onExportData()}
                                                            className="inline-flex items-center gap-1 rounded-control border border-white/10 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
                                                        >
                                                            Export
                                                        </button>
                                                    }
                                                />
                                            )}
                                            <SettingsRow
                                                icon={<HardDrive className="h-4 w-4" />}
                                                title="Backups & usage"
                                                description="Auto-backups run every 30 minutes while a profile is open."
                                                control={
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveTab('actions')}
                                                        className="inline-flex items-center gap-1 rounded-control border border-white/10 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
                                                    >
                                                        Open <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                                                    </button>
                                                }
                                            />
                                        </SettingsGroup>
                                    </div>
                                );
                            })()}

                            {/* TAB 2: General & Analysis */}                            {activeTab === 'general' && (
                                <div className="space-y-5 animate-fade-in">
                                    <SettingsPageHeader
                                        title="Analysis"
                                        description="How the harness thinks, what it is allowed to call, and how still the desk sits."
                                    />

                                    <SettingsGroup title="Analysis modes">
                                        <SettingsRow
                                            icon={<ShieldCheck className="h-4 w-4" />}
                                            title="Accuracy Mode"
                                            description={isAccuracyModeEnabled
                                                ? (accuracySubMode === 'original'
                                                    ? 'On — Strict Protocol: validated multi-step analysis with consensus checks.'
                                                    : 'On — Pure AI: faster, unfiltered reasoning with fewer formatting checks.')
                                                : 'Off — standard speed. Debate runs without the strict validation pass.'}
                                            control={<ToggleSwitch checked={isAccuracyModeEnabled} onChange={onToggleAccuracyMode} label="Toggle Accuracy Mode" />}
                                        />
                                        {isAccuracyModeEnabled && setAccuracySubMode && (
                                            <SettingsRow
                                                icon={<Layers className="h-4 w-4" />}
                                                title="Strictness"
                                                description="Which protocol runs while Accuracy Mode is on."
                                                control={
                                                    <SegmentedControl
                                                        ariaLabel="Accuracy protocol"
                                                        value={accuracySubMode}
                                                        onChange={id => setAccuracySubMode(id as AccuracySubMode)}
                                                        options={[
                                                            { id: 'original', label: 'Strict', title: 'Validated multi-step analysis with consensus checks. Slower but more thorough.' },
                                                            { id: 'pure_ai', label: 'Pure AI', title: 'Faster, unfiltered reasoning with fewer formatting checks.' },
                                                        ]}
                                                    />
                                                }
                                            />
                                        )}
                                        <SettingsRow
                                            icon={<Activity className="h-4 w-4" />}
                                            title="Hybrid Intelligence"
                                            description="Adds real-time market data (price, RSI, MACD, EMAs) so the models reason over live context."
                                            control={
                                                <ToggleSwitch checked={isHybridIntelligenceEnabled} onChange={() => {
                                                    if (onToggleHybridIntelligence) onToggleHybridIntelligence();
                                                    else if (props.setIsHybridIntelligenceEnabled) props.setIsHybridIntelligenceEnabled(!isHybridIntelligenceEnabled);
                                                }} label="Toggle Hybrid Intelligence" />
                                            }
                                        />
                                    </SettingsGroup>

                                    <SettingsGroup title="Analyst desk">
                                        <SettingsRow
                                            icon={<Wrench className="h-4 w-4" />}
                                            title="Desk Tools"
                                            description="Lets analysts and the moderator call live tools anytime — web search, funding/OI, order book, liquidations, BTC context, session timing."
                                            control={
                                                <ToggleSwitch
                                                    checked={deskToolsEnabled}
                                                    onChange={() => {
                                                        const next = !deskToolsEnabled;
                                                        setDeskToolsEnabled(next);
                                                        saveHarnessSettings({ deskToolsEnabled: next });
                                                    }}
                                                    label="Toggle Desk Tools"
                                                />
                                            }
                                        />
                                        <SettingsRow
                                            icon={<Sparkles className="h-4 w-4" />}
                                            title="Desk idle motion"
                                            description="Subtle micro-motion on the pixel seats (breath, cap-tilt, eye-blink while thinking, moderator sway). Turning this off makes the desk perfectly still."
                                            control={
                                                <ToggleSwitch
                                                    checked={idleMotionEnabled}
                                                    onChange={() => setIdleMotionEnabled(!idleMotionEnabled)}
                                                    label="Toggle desk idle motion"
                                                />
                                            }
                                        />
                                    </SettingsGroup>

                                    {/* The editor brings its own heading and
                                        explanation — the card frames it, it
                                        doesn't restate it. */}
                                    <SettingsGroup>
                                        <div className="p-4">
                                            <DeskSeatMappingEditor />
                                        </div>
                                    </SettingsGroup>

                                    {/* ADVANCED — fine-tuning; most users never touch these. */}
                                    <section>
                                        <button
                                            type="button"
                                            onClick={() => setIsAdvancedOpen(p => !p)}
                                            aria-expanded={isAdvancedOpen}
                                            className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-zinc-900/50 px-4 py-3 text-left transition-colors hover:bg-zinc-800/40"
                                        >
                                            <span className="min-w-0">
                                                <span className="block text-[13px] font-semibold text-zinc-200">Advanced</span>
                                                <span className="mt-0.5 block text-[11px] text-zinc-500">Context injection and capture prompts — most users can leave these as-is.</span>
                                            </span>
                                            <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-150 ease-[var(--ease-snappy)] ${isAdvancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                                        </button>
                                        {isAdvancedOpen && (
                                            <div className="mt-3 space-y-3 animate-fade-in">
                                                {isAccuracyModeEnabled && accuracySubMode === 'pure_ai' && (setIsPlaybookEnabledInPureAI || setIsFamiliesEnabledInPureAI || setIsMemoryEnabledInPureAI) && (
                                                    <SettingsGroup title="Pure AI context" description="Structured context injected during Pure AI analysis. All default: off.">
                                                        {setIsPlaybookEnabledInPureAI && (
                                                            <SettingsRow
                                                                title="Strategy Playbook"
                                                                description="The uploaded strategy books."
                                                                control={<ToggleSwitch checked={!!isPlaybookEnabledInPureAI} onChange={() => setIsPlaybookEnabledInPureAI(!isPlaybookEnabledInPureAI)} label="Toggle Strategy Playbook in Pure AI" />}
                                                            />
                                                        )}
                                                        {setIsFamiliesEnabledInPureAI && (
                                                            <SettingsRow
                                                                title="Pattern Families"
                                                                description="Learned pattern-family classifications."
                                                                control={<ToggleSwitch checked={!!isFamiliesEnabledInPureAI} onChange={() => setIsFamiliesEnabledInPureAI(!isFamiliesEnabledInPureAI)} label="Toggle Pattern Families in Pure AI" />}
                                                            />
                                                        )}
                                                        {setIsMemoryEnabledInPureAI && (
                                                            <SettingsRow
                                                                title="Historical Memory"
                                                                description="Past-trade lessons from the notebook."
                                                                control={<ToggleSwitch checked={!!isMemoryEnabledInPureAI} onChange={() => setIsMemoryEnabledInPureAI(!isMemoryEnabledInPureAI)} label="Toggle Historical Memory in Pure AI" />}
                                                            />
                                                        )}
                                                    </SettingsGroup>
                                                )}

                                                {onToggleAutoCapturing && (
                                                    <SettingsGroup title="Automated capture prompts" description="When to ask for trade results automatically. All default: off.">
                                                        <SettingsRow
                                                            title="Post-trade result capture"
                                                            description="Ask for the outcome after a trade settles."
                                                            control={<ToggleSwitch checked={!!isAutoCapturing} onChange={onToggleAutoCapturing} label="Toggle post-trade result capture" />}
                                                        />
                                                        {onToggleUpdateAutoCapturing && (
                                                            <SettingsRow
                                                                title="Active trade updates"
                                                                description="Ask to refresh an open position's status."
                                                                control={<ToggleSwitch checked={!!isUpdateAutoCapturing} onChange={onToggleUpdateAutoCapturing} label="Toggle active trade update capture" />}
                                                            />
                                                        )}
                                                        {onToggleEntryNotHitCapturing && (
                                                            <SettingsRow
                                                                title="Entry not hit"
                                                                description="Ask what happened when price never reached the entry."
                                                                control={<ToggleSwitch checked={!!isEntryNotHitCapturing} onChange={onToggleEntryNotHitCapturing} label="Toggle entry not hit capture" />}
                                                            />
                                                        )}
                                                    </SettingsGroup>
                                                )}
                                            </div>
                                        )}
                                    </section>
                                </div>
                            )}

                            {activeTab === 'lenses' && (
                                <div className="space-y-5 animate-fade-in">
                                    <SettingsPageHeader
                                        title="Analyst roles"
                                        description="Assign Technical, Risk, and Macro personas to models."
                                    />
                                    <AnalystLensSettings
                                        config={lensConfig}
                                        onChange={onSetLensConfig}
                                        providers={providerConfigs ?? []}
                                    />
                                </div>
                            )}

                            {(activeTab === 'prompts' || activeTab === 'instructions') && (
                                <div className="h-full min-h-0 animate-fade-in flex flex-col">
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

                            {activeTab === 'memory' && (
                                <div className="h-full min-h-0 animate-fade-in flex flex-col gap-4">
                                    {/* Settings owns the SWITCHES; the notebook
                                        itself, the amendment inbox and the
                                        supervisor's decision stream all live on
                                        the Learn surface now. Mounting them in
                                        both places meant two ways to reach the
                                        same file and neither was obviously
                                        canonical. */}
                                    <div className="px-4 pt-4">
                                        <h3 className="text-[13px] font-bold text-zinc-100">Memory</h3>
                                        <p className="mt-0.5 mb-3 text-[11px] text-zinc-500">
                                            The notebook, the skill library, the approval queues and memory
                                            health all live on the Learn surface. Settings keeps the switches.
                                        </p>
                                        <div className="flex flex-wrap items-center gap-3 rounded-control border border-zinc-800 bg-zinc-950/40 p-2.5">
                                            {memoryConfig && (
                                                <span className="text-[11px] text-zinc-400">
                                                    <span className="text-ui-xs uppercase tracking-widest text-zinc-600">Managed by </span>
                                                    {memoryConfig.selectedModel || memoryConfig.name || 'memory model'}
                                                </span>
                                            )}
                                            {setIsGlobalMemoryEnabled && (
                                                <label className="flex cursor-pointer items-center gap-2" data-testid="global-memory-setting">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!isGlobalMemoryEnabled}
                                                        onChange={() => setIsGlobalMemoryEnabled(!isGlobalMemoryEnabled)}
                                                        className="h-3.5 w-3.5 accent-cyan-400"
                                                    />
                                                    <span className="text-[11px] text-zinc-300">Global memory</span>
                                                </label>
                                            )}
                                            {onOpenLearn && (
                                                <button type="button" onClick={() => onOpenLearn('memory')}
                                                    data-testid="open-learn-memory"
                                                    className="ml-auto rounded-control border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800">
                                                    Open the notebook
                                                    <span className="ml-1 font-mono text-ui-xs text-zinc-600">Alt+5</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <SupervisorCard onOpenLearn={openLearnQueue} />
                                    <ProfileMemoryCard />
                                </div>
                            )}

                            {activeTab === 'skills' && (
                                <div className="h-full min-h-0 animate-fade-in flex flex-col px-4 pb-4 gap-6">
                                    {/* The skill library now lives in the
                                        full-screen Strategy Studio; Settings
                                        keeps only the pointer + forged-tool
                                        approvals (which have no Studio home). */}
                                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-[13px] font-bold text-zinc-100">Skills</h3>
                                                <p className="mt-0.5 text-[11px] text-zinc-500">
                                                    Browse, prove, retire and import your skill library in the Strategy Studio.
                                                </p>
                                            </div>
                                            {onOpenStrategyStudio && (
                                                <button
                                                    type="button"
                                                    onClick={onOpenStrategyStudio}
                                                    className="shrink-0 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-200 hover:border-white/20 hover:bg-zinc-700"
                                                >
                                                    Open Strategy Studio
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="border-t border-zinc-800 pt-4">
                                        <h3 className="text-[13px] font-bold text-zinc-100">Forged tools</h3>
                                        <p className="mt-0.5 text-[11px] text-zinc-500 mb-3">
                                            Model-authored desk tools awaiting your approval.
                                        </p>
                                        <ToolForgeManager />
                                    </div>
                                </div>
                            )}

                            {activeTab === 'strategies' && (
                                <div className="h-full min-h-0 animate-fade-in flex flex-col">
                                    {onOpenStrategyStudio && (
                                        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2.5">
                                            <p className="text-[11px] text-zinc-500">Upload playbooks below — or browse everything the harness knows as one library.</p>
                                            <button
                                                type="button"
                                                onClick={onOpenStrategyStudio}
                                                className="shrink-0 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-200 hover:border-white/20 hover:bg-zinc-700"
                                            >
                                                Strategy Studio
                                            </button>
                                        </div>
                                    )}
                                    <StrategiesManager
                                        username={props.username}
                                        providerConfigs={providerConfigs ?? []}
                                        visionConfig={visionConfig ?? null}
                                        isStrategiesEnabled={isStrategiesEnabled}
                                        setIsStrategiesEnabled={setIsStrategiesEnabled}
                                    />
                                </div>
                            )}

                            {/* TAB 6: Data — Backups & Alerts */}
                            {activeTab === 'actions' && (
                                <div className="space-y-5 animate-fade-in">
                                    <SettingsPageHeader
                                        title="Data"
                                        description="Session usage and the profile's automatic backups."
                                    />

                                    <StorageLocationCard />

                                    <SessionUsagePanel />

                                    {/* Backups — list/export/restore/delete the 30-min auto-backups */}
                                    {username && onProfileRestored && (
                                        <BackupManager username={username} onProfileRestored={onProfileRestored} />
                                    )}
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
