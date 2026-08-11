
import React, { useState, useEffect, useMemo, useRef } from 'react';
import TradeLogContent from './TradeLog';
import PerformanceReviewContent from './PerformanceReview';
import WinRateDashboard from '../dashboards/WinRateDashboard';
import EquityCurveDashboard from '../dashboards/EquityCurveDashboard';
import LearningDashboard from '../dashboards/LearningDashboard';
import ModelPerformanceDashboard from '../dashboards/ModelPerformanceDashboard';
import ReasoningDashboard from '../dashboards/ReasoningDashboard';
import { CloseIcon, HistoryIcon, StarIcon, ChartBarIcon, BrainIcon } from '../shared/Icons';
import { exportTradesCSV, exportTradesHTML } from '../../utils/reportExport';
import { AIProvider, LoggedTrade, TradeSummary, GlobalMemory, TradeOutcome } from '../../types';
import { computeJournalStats } from '../../utils/journalAnalytics';
import { ProviderConfig } from '../../types/provider';
import { useEscapeClose } from '../../hooks/useEscapeClose';

interface JournalProps {
    isVisible: boolean;
    onClose: () => void;
    initialTab: 'log' | 'performance' | 'analytics' | 'learning' | 'memory' | 'models' | 'reasoning';
    isEmbedded?: boolean;
    /** Deep link: auto-select this analysis run in the Think (reasoning) tab. */
    initialTradeId?: string;
    /** Called once the deep-linked trade has been consumed by the dashboard. */
    onInitialTradeConsumed?: () => void;
    /** Active user — scopes reasoning-record lookups (falls back to localStorage). */
    username?: string;

    // Trade Log Props
    trades: LoggedTrade[];
    onDeleteTrades: (ids: string[]) => void;
    onClearAllTrades: () => void;
    modelIdToName: Record<string, string>;
    onUpdateInsights: (ids: string[]) => void;
    isSummarizing?: boolean;
    currentInsightIds: string[];
    /** (i/n) progress for manual insight-generation loops. */
    insightProgress?: { done: number; total: number } | null;
    onUpdateTradeLeverage: (id: string, leverage: number) => void;
    /** Correct a mis-logged outcome from the expanded card. */
    onUpdateOutcome?: (id: string, outcome: TradeOutcome) => void;
    /** Edit PnL (dollar + percent) from the expanded card. */
    onUpdatePnL?: (id: string, pnl: { pnlAmount?: number; pnlPercent?: number }) => void;

    // PerformanceReview Props
    finalSummary: string | null;
    individualSummaries: TradeSummary[];
    isLoading: boolean;
    isInsightGenerating?: boolean;
    newlyAddedInsightIds?: Set<string>;
    summarizationProvider: AIProvider;
    summarizationModel: string;
    onSetSummarizationProvider: (provider: AIProvider) => void;
    onSetSummarizationModel: (modelId: string) => void;
    /** Ready provider configs available for summarization (dynamic, user-configured). */
    providers?: ProviderConfig[];

    summaryCharLimit: number;
    onUpdateSummaryCharLimit: (limit: number) => void;
    onRegenerateSummary: () => void;
    onDeleteInsight?: (id: string) => void;
    useAlgorithmicSummary: boolean;
    onToggleAlgorithmicSummary: (use: boolean) => void;
    useAlgorithmicInsights?: boolean;
    onToggleAlgorithmicInsights?: (use: boolean) => void;
    onRewriteInsightsWithAI?: (ids?: string[]) => void;

    // Analytics Props
    familyWinRates: Record<string, { total: number; wins: number; winRate: number }>;

    // Memory Props
    globalMemory?: GlobalMemory;
    threadSummary?: string;

    // Model Performance Props
    enabledProviders?: AIProvider[];
    selectedModels?: Record<string, string>;
}

// Tab configuration
type TabId = 'log' | 'performance' | 'analytics' | 'learning' | 'memory' | 'models' | 'reasoning';

interface TabConfig {
    id: TabId;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    color: string;
    activeColor: string;
}

const TABS: TabConfig[] = [
    { id: 'log', label: 'History', shortLabel: 'History', icon: <HistoryIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-cyan-400' },
    { id: 'performance', label: 'AI Review', shortLabel: 'Review', icon: <StarIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-purple-400' },
    { id: 'analytics', label: 'Stats', shortLabel: 'Stats', icon: <ChartBarIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-yellow-400' },
    { id: 'learning', label: 'Learning', shortLabel: 'Learn', icon: <span className="text-lg"></span>, color: 'text-zinc-500', activeColor: 'text-blue-400' },
    { id: 'models', label: 'Models', shortLabel: 'AI', icon: <span className="text-lg"></span>, color: 'text-zinc-500', activeColor: 'text-violet-400' },
    { id: 'reasoning', label: 'Reasoning', shortLabel: 'Think', icon: <BrainIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-cyan-400' },
];

const JournalInner: React.FC<JournalProps> = ({
    isVisible, onClose, initialTab, isEmbedded = false,
    initialTradeId, onInitialTradeConsumed, username,
    // Trade Log Pass-through
    trades, onDeleteTrades, onClearAllTrades, modelIdToName, onUpdateInsights, isSummarizing, currentInsightIds, onUpdateTradeLeverage, onUpdateOutcome, onUpdatePnL,
    // Performance Review Pass-through
    finalSummary, individualSummaries, isLoading, isInsightGenerating, insightProgress, newlyAddedInsightIds, summarizationProvider, summarizationModel, onSetSummarizationProvider, onSetSummarizationModel, providers = [], summaryCharLimit = 1000, onUpdateSummaryCharLimit = () => {}, onRegenerateSummary = () => {}, onDeleteInsight, useAlgorithmicSummary = false, onToggleAlgorithmicSummary = () => {},
    // Analytics Pass-through
    familyWinRates = {},
    // Memory Pass-through
    globalMemory = null, threadSummary = '',
    // Model Performance Props
    enabledProviders,
    selectedModels = {},
    useAlgorithmicInsights = false, onToggleAlgorithmicInsights = () => {}, // NEW
    onRewriteInsightsWithAI = () => {} // NEW
}) => {
    const [activeTab, setActiveTab] = useState<TabId>(initialTab);

    // Active user for reasoning-record lookups. Threaded from App; falls back
    // to the legacy localStorage key the analysis pipeline writes.
    const activeUsername = username
        || (typeof localStorage !== 'undefined' ? (localStorage.getItem('last_active_user') || 'default') : 'default');

    // Derive enabled providers from dynamic configs when not passed explicitly
    const effectiveEnabledProviders: AIProvider[] = enabledProviders
        ?? providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0).map(p => p.id);

    // Esc closes the overlay (the biggest navigation dead-end in the app).
    useEscapeClose(isVisible, onClose);

    // Remember the last active tab across opens. Only re-apply `initialTab`
    // when it actually CHANGES (a deep-link), not on every visibility flip —
    // the old effect dumped users back to History every time they reopened.
    const lastInitialTabRef = useRef<TabId>(initialTab);
    useEffect(() => {
        if (isVisible && initialTab !== lastInitialTabRef.current) {
            lastInitialTabRef.current = initialTab;
            setActiveTab(initialTab);
        }
    }, [isVisible, initialTab]);

    const currentTab = TABS.find(t => t.id === activeTab) || TABS[0];

    if (!isVisible) return null;

    const renderContent = () => (
        activeTab === 'log' ? (
            <TradeLogContent
                trades={trades}
                onDeleteTrades={onDeleteTrades}
                onClearAllTrades={onClearAllTrades}
                modelIdToName={modelIdToName}
                onUpdateInsights={onUpdateInsights}
                isSummarizing={isSummarizing}
                currentInsightIds={currentInsightIds}
                onUpdateTradeLeverage={onUpdateTradeLeverage}
                onUpdateOutcome={onUpdateOutcome}
                onUpdatePnL={onUpdatePnL}
                username={activeUsername}
            />
        ) : activeTab === 'performance' ? (
            <PerformanceReviewContent
                finalSummary={finalSummary || null}
                individualSummaries={individualSummaries || []}
                isLoading={isLoading}
                isInsightGenerating={isInsightGenerating}
                insightProgress={insightProgress}
                newlyAddedInsightIds={newlyAddedInsightIds}
                summarizationProvider={summarizationProvider}
                summarizationModel={summarizationModel}
                onSetSummarizationProvider={onSetSummarizationProvider}
                onSetSummarizationModel={onSetSummarizationModel}
                providers={providers}
                summaryCharLimit={summaryCharLimit}
                onUpdateSummaryCharLimit={onUpdateSummaryCharLimit}
                onManageInsights={() => setActiveTab('log')}
                onRegenerateSummary={onRegenerateSummary}
                onDeleteInsight={onDeleteInsight}
                useAlgorithmicSummary={useAlgorithmicSummary}
                onToggleAlgorithmicSummary={onToggleAlgorithmicSummary}
                useAlgorithmicInsights={useAlgorithmicInsights}
                onToggleAlgorithmicInsights={onToggleAlgorithmicInsights}
                onRewriteInsightsWithAI={onRewriteInsightsWithAI}
            />
        ) : activeTab === 'analytics' ? (
            <div className="h-full overflow-y-auto">
                <div className="p-3 sm:p-4 md:p-5">
                    <EquityCurveDashboard trades={trades} />
                    <WinRateDashboard trades={trades} />
                </div>
            </div>
        ) : activeTab === 'learning' ? (
            <div className="h-full overflow-y-auto">
                <LearningDashboard trades={trades} username={activeUsername} />
            </div>
        ) : activeTab === 'models' ? (
            <div className="p-4 sm:p-6 overflow-y-auto h-full">
                <ModelPerformanceDashboard enabledProviders={effectiveEnabledProviders} trades={trades} selectedModels={selectedModels} />
            </div>
        ) : activeTab === 'reasoning' ? (
            <div className="p-4 sm:p-6 overflow-y-auto h-full">
                <ReasoningDashboard
                    username={activeUsername}
                    initialTradeId={initialTradeId}
                    onInitialTradeConsumed={onInitialTradeConsumed}
                />
            </div>
        ) : null
    );

    if (isEmbedded) {
        return (
            <div className="flex flex-col h-full bg-zinc-950 rounded-2xl border border-zinc-800/80 overflow-hidden animate-fade-in">
                {/* Embedded Header & Tab Navigation */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_6px_#8a8a92]" />
                        <h3 className="text-sm font-bold text-white tracking-tight">Trading Journal & Performance</h3>
                        <span className="text-xs text-zinc-500 font-mono">({trades.length} logged trades)</span>
                    </div>
                    <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar max-w-full">
                        {TABS.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all font-medium whitespace-nowrap ${
                                        isActive
                                            ? 'bg-zinc-800 text-white font-bold shadow-sm border border-zinc-700'
                                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
                                    }`}
                                >
                                    <span className={isActive ? tab.activeColor : 'text-zinc-500'}>{tab.icon}</span>
                                    <span>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Analytics summary — streaks, expectancy, win rate, top strategy */}
                <JournalAnalyticsSummary trades={trades} />

                {/* Embedded Tab Content Area */}
                <div className="flex-1 overflow-hidden min-h-[480px]">
                    {renderContent()}
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/70 z-40 animate-fade-in"
                onClick={onClose}
            />

            {/* Main Panel - Full screen on mobile, side panel on desktop */}
            <aside role="dialog" aria-modal="true" aria-label="Trading Journal" className="status-surface fixed inset-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[480px] bg-zinc-950 z-50 flex flex-col animate-slide-up sm:animate-slide-left">

                {/* Modern Header */}
                <header className="shrink-0 relative">
                    {/* Gradient accent line */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500" />

                    <div className="flex items-center justify-between px-4 sm:px-6 pt-5 pb-4">
                        <div>
                            <h1 className="text-xl font-bold text-white tracking-tight">Trading Journal</h1>
                            <p className="text-xs text-zinc-500 mt-0.5">{trades.length} trades logged</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => exportTradesCSV(trades)}
                                disabled={trades.length === 0}
                                title="Download trade log as CSV"
                                className="p-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white text-[10px] font-bold uppercase tracking-wide transition-all disabled:opacity-40"
                            >
                                CSV
                            </button>
                            <button
                                onClick={() => exportTradesHTML(trades)}
                                disabled={trades.length === 0}
                                title="Open printable report (Ctrl+P to save as PDF)"
                                className="p-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white text-[10px] font-bold uppercase tracking-wide transition-all disabled:opacity-40"
                            >
                                Report
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all"
                                aria-label="Close journal"
                            >
                                <CloseIcon />
                            </button>
                        </div>
                    </div>
                </header>

                {/* Analytics summary — streaks, expectancy, win rate, top strategy */}
                <JournalAnalyticsSummary trades={trades} />

                {/* Content Area — same renderContent as the embedded variant */}
                <div className="flex-1 overflow-hidden">
                    {renderContent()}
                </div>

                {/* Bottom Navigation Bar - Mobile Optimized */}
                <nav className="shrink-0 bg-zinc-900 border-t border-white/5 px-2 pb-safe">
                    <div className="flex items-center justify-around py-2">
                        {TABS.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl transition-all min-w-[56px] ${isActive
                                        ? 'bg-gradient-to-b from-white/15 to-white/5 ring-1 ring-white/10'
                                        : 'hover:bg-zinc-800'
                                        }`}
                                >
                                    <div className={`transition-colors ${isActive ? tab.activeColor : tab.color}`}>
                                        {tab.icon}
                                    </div>
                                    <span className={`text-[10px] font-medium transition-colors ${isActive ? tab.activeColor : 'text-zinc-600'
                                        }`}>
                                        {tab.shortLabel}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </nav>
            </aside>
        </>
    );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: string }> = ({ label, value, sub }) => (
  <div className="min-w-0">
    <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
    <div className="text-sm font-bold text-white truncate">{value}</div>
    {sub && <div className="text-[9px] text-zinc-600 truncate">{sub}</div>}
  </div>
);

const JournalAnalyticsSummary: React.FC<{ trades: LoggedTrade[] }> = ({ trades }) => {
  const stats = useMemo(() => computeJournalStats(trades), [trades]);
  if (stats.total === 0) return null;
  const top = stats.perStrategy[0];
  return (
    <div className="grid grid-cols-2 gap-3 border-b border-zinc-800 bg-zinc-950/60 px-4 py-3 sm:grid-cols-4">
      <Stat label="Win rate" value={`${stats.winRate}%`} sub={`${stats.wins}W / ${stats.losses}L of ${stats.total}`} />
      <Stat label="Expectancy" value={`${stats.expectancyR > 0 ? '+' : ''}${stats.expectancyR}R`} sub={`avg win ${stats.avgWinR}R · avg loss ${stats.avgLossR}R`} />
      <Stat
        label="Streak"
        value={stats.currentStreak > 0 ? `${stats.currentStreak}W` : stats.currentStreak < 0 ? `${-stats.currentStreak}L` : '—'}
        sub={`best ${stats.bestWinStreak}W / ${-stats.bestLossStreak}L`}
      />
      <Stat label="Top strategy" value={top?.key ?? '—'} sub={top ? `${top.trades} trades · ${top.winRate}% WR` : undefined} />
    </div>
  );
};

export const Journal = React.memo(JournalInner);
