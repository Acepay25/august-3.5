
import React, { useState, useEffect, useMemo, useRef } from 'react';
import TradeLogContent from './TradeLog';
import WinRateDashboard from '../dashboards/WinRateDashboard';
import EquityCurveDashboard from '../dashboards/EquityCurveDashboard';
import LearningDashboard from '../dashboards/LearningDashboard';
import ModelPerformanceDashboard from '../dashboards/ModelPerformanceDashboard';
import ReasoningDashboard from '../dashboards/ReasoningDashboard';
import { WeeklyReviewCard } from './WeeklyReviewCard';
import { CloseIcon, HistoryIcon, ChartBarIcon, BrainIcon } from '../shared/Icons';
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

const resolveTab = (tab: TabId): TabId => (tab === 'performance' ? 'log' : tab);

const TABS: TabConfig[] = [
    { id: 'log', label: 'History', shortLabel: 'History', icon: <HistoryIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-zinc-100' },
    { id: 'analytics', label: 'Stats', shortLabel: 'Stats', icon: <ChartBarIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-zinc-100' },
    { id: 'learning', label: 'Learning', shortLabel: 'Learn', icon: <span className="text-lg"></span>, color: 'text-zinc-500', activeColor: 'text-zinc-100' },
    { id: 'models', label: 'Models', shortLabel: 'AI', icon: <span className="text-lg"></span>, color: 'text-zinc-500', activeColor: 'text-zinc-100' },
    { id: 'reasoning', label: 'Reasoning', shortLabel: 'Think', icon: <BrainIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-zinc-100' },
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
    const [activeTab, setActiveTab] = useState<TabId>(resolveTab(initialTab));
    const [documentOpen, setDocumentOpen] = useState(false);

    useEffect(() => {
        if (activeTab !== 'log' && activeTab !== 'reasoning') setDocumentOpen(false);
    }, [activeTab]);

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
    const lastInitialTabRef = useRef<TabId>(resolveTab(initialTab));
    useEffect(() => {
        const next = resolveTab(initialTab);
        if (isVisible && next !== lastInitialTabRef.current) {
            lastInitialTabRef.current = next;
            setActiveTab(next);
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
                finalSummary={finalSummary || null}
                individualSummaries={individualSummaries || []}
                isReviewLoading={isLoading}
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
                onRegenerateSummary={onRegenerateSummary}
                onDeleteInsight={onDeleteInsight}
                useAlgorithmicSummary={useAlgorithmicSummary}
                onToggleAlgorithmicSummary={onToggleAlgorithmicSummary}
                useAlgorithmicInsights={useAlgorithmicInsights}
                onToggleAlgorithmicInsights={onToggleAlgorithmicInsights}
                onRewriteInsightsWithAI={onRewriteInsightsWithAI}
                onDocumentOpenChange={setDocumentOpen}
            />
        ) : activeTab === 'analytics' ? (
            <div className="h-full overflow-y-auto">
                <div className="p-6 sm:p-8 space-y-8">
                    <WeeklyReviewCard username={activeUsername} />
                    <JournalAnalyticsSummary trades={trades} />
                    <EquityCurveDashboard trades={trades} />
                    <WinRateDashboard trades={trades} />
                </div>
            </div>
        ) : activeTab === 'learning' ? (
            <div className="h-full overflow-y-auto">
                <LearningDashboard trades={trades} username={activeUsername} />
            </div>
        ) : activeTab === 'models' ? (
            <div className="p-8 sm:p-8">
                <ModelPerformanceDashboard enabledProviders={effectiveEnabledProviders} trades={trades} selectedModels={selectedModels} />
            </div>
        ) : activeTab === 'reasoning' ? (
            <div className="h-full overflow-hidden">
                <ReasoningDashboard
                    username={activeUsername}
                    initialTradeId={initialTradeId}
                    onInitialTradeConsumed={onInitialTradeConsumed}
                    onDocumentOpenChange={setDocumentOpen}
                />
            </div>
        ) : null
    );

    if (isEmbedded) {
        return (
            <div className="flex flex-col h-full bg-zinc-950 overflow-hidden animate-fade-in">
                <div className="shrink-0 px-8 pt-10 pb-2">
                    <h2 className="text-3xl font-semibold text-zinc-100 tracking-tight">Journal</h2>
                    {!documentOpen && (
                        <p className="text-sm text-zinc-500 mt-3">{trades.length} {trades.length === 1 ? 'trade' : 'trades'}</p>
                    )}
                </div>
                {!documentOpen && (
                <div className="shrink-0 px-8 pt-4 pb-6 flex items-center gap-1 overflow-x-auto custom-scrollbar">
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-3.5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                                    isActive
                                        ? 'bg-zinc-800 text-zinc-100'
                                        : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
                )}
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
            <aside role="dialog" aria-modal="true" aria-label="Trading Journal" className="status-surface fixed inset-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[560px] lg:w-[640px] bg-zinc-950 z-50 flex flex-col border-l border-zinc-800 animate-slide-up sm:animate-slide-left">

                {/* Modern Header */}
                <header className="shrink-0 px-6 pt-6 pb-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">Journal</h1>
                            <p className="text-sm text-zinc-500 mt-2">{trades.length} {trades.length === 1 ? 'trade' : 'trades'}</p>
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

                <div className="flex-1 overflow-hidden">
                    {renderContent()}
                </div>

                {/* Bottom Navigation Bar - Mobile Optimized */}
                <nav className="shrink-0 bg-zinc-950 border-t border-zinc-800 px-3 pb-safe">
                    <div className="flex items-center justify-around py-3">
                        {TABS.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl transition-all min-w-[56px] ${isActive
                                        ? 'bg-zinc-800 ring-1 ring-zinc-600'
                                        : 'hover:bg-zinc-900'
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
    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
    <div className="text-base font-semibold text-zinc-100 truncate">{value}</div>
    {sub && <div className="text-[11px] text-zinc-500 truncate mt-0.5">{sub}</div>}
  </div>
);

const JournalAnalyticsSummary: React.FC<{ trades: LoggedTrade[] }> = ({ trades }) => {
  const stats = useMemo(() => computeJournalStats(trades), [trades]);
  if (stats.total === 0) return null;
  const top = stats.perStrategy[0];
  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
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
