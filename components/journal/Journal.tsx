
import React, { useState, useEffect } from 'react';
import TradeLogContent from './TradeLog';
import PerformanceReviewContent from './PerformanceReview';
import WinRateDashboard from '../dashboards/WinRateDashboard';
import LearningDashboard from '../dashboards/LearningDashboard';
import ModelPerformanceDashboard from '../dashboards/ModelPerformanceDashboard';
import ReasoningDashboard from '../dashboards/ReasoningDashboard';
import { CloseIcon, HistoryIcon, StarIcon, ChartBarIcon, BrainIcon } from '../shared/Icons';
import { exportTradesCSV, exportTradesHTML } from '../../utils/reportExport';
import { AIProvider, LoggedTrade, TradeSummary, GlobalMemory } from '../../types';
import { ProviderConfig } from '../../types/provider';

interface JournalProps {
    isVisible: boolean;
    onClose: () => void;
    initialTab: 'log' | 'performance' | 'analytics' | 'learning' | 'memory' | 'models' | 'reasoning';
    isEmbedded?: boolean;

    // Trade Log Props
    trades: LoggedTrade[];
    onDeleteTrades: (ids: string[]) => void;
    onClearAllTrades: () => void;
    modelIdToName: Record<string, string>;
    ocrModelIdToName: Record<string, string>;
    onUpdateInsights: (ids: string[]) => void;
    isSummarizing?: boolean;
    currentInsightIds: string[];
    onUpdateTradeLeverage: (id: string, leverage: number) => void;

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

const formatMemoryItem = (item: any): string => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) {
        if (item.observation) {
            const prefix = item.patternFamily ? `[${item.patternFamily}] ` : '';
            return `${prefix}${item.observation}`;
        }
        return item.text || item.message || JSON.stringify(item);
    }
    return String(item);
};

// Modern Memory Content Component
const MemoryContent: React.FC<{
    threadSummary?: string;
    globalMemory?: GlobalMemory | null;
}> = ({ threadSummary, globalMemory }) => {
    return (
        <div className="flex flex-col h-full bg-transparent p-4 sm:p-6 space-y-6 overflow-y-auto custom-scrollbar">
            {/* Header Card */}
            <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-2xl border border-purple-500/20">
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                    <BrainIcon className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-white">Global Memory</h3>
                    <p className="text-xs text-zinc-400">AI learns from your trade history</p>
                </div>
            </div>

            {globalMemory ? (
                <div className="space-y-4">
                    {/* Stats Card */}
                    <div className="p-4 bg-zinc-800 rounded-2xl border border-white/5">
                        <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Statistics</div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 bg-zinc-800 rounded-xl">
                                <div className="text-2xl font-bold text-white">{globalMemory.totalTradesAnalyzed ?? 0}</div>
                                <div className="text-xs text-zinc-500">Trades Analyzed</div>
                            </div>
                            <div className="p-3 bg-zinc-800 rounded-xl">
                                <div className="text-sm font-medium text-zinc-400 truncate">
                                    {globalMemory.lastUpdated ? new Date(globalMemory.lastUpdated).toLocaleDateString() : 'N/A'}
                                </div>
                                <div className="text-xs text-zinc-500">Last Updated</div>
                            </div>
                        </div>
                    </div>

                    {/* Pattern Recognition Card */}
                    <div className="p-4 bg-zinc-800 rounded-2xl border border-white/5">
                        <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Pattern Recognition</div>
                        <div className="space-y-2">
                            {(globalMemory.aiPatternMemory ?? []).length > 0 ? (
                                globalMemory.aiPatternMemory.slice(0, 5).map((pat, i) => (
                                    <div key={i} className="p-3 bg-zinc-800 rounded-xl text-xs text-zinc-300 leading-relaxed">
                                        {formatMemoryItem(pat)}
                                    </div>
                                ))
                            ) : (
                                <div className="p-4 text-center text-zinc-600 text-xs italic">
                                    No patterns recorded yet
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Corrections Card */}
                    {(globalMemory.globalCorrections ?? []).length > 0 && (
                        <div className="p-4 bg-red-950/30 rounded-2xl border border-red-500/20">
                            <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-3">Corrections</div>
                            <div className="space-y-2">
                                {globalMemory.globalCorrections.slice(0, 3).map((cor, i) => (
                                    <div key={i} className="p-3 bg-zinc-800 rounded-xl text-xs text-red-200/80 leading-relaxed">
                                        {formatMemoryItem(cor)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center flex-1 gap-4">
                    <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center">
                        <BrainIcon className="w-8 h-8 text-zinc-700" />
                    </div>
                    <div className="text-center">
                        <p className="text-sm text-zinc-500">Memory not initialized</p>
                        <p className="text-xs text-zinc-600 mt-1">Complete some trades to build memory</p>
                    </div>
                </div>
            )}
        </div>
    );
};

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
    { id: 'memory', label: 'Memory', shortLabel: 'Mem', icon: <BrainIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-emerald-400' },
    { id: 'learning', label: 'Learning', shortLabel: 'Learn', icon: <span className="text-lg"></span>, color: 'text-zinc-500', activeColor: 'text-blue-400' },
    { id: 'models', label: 'Models', shortLabel: 'AI', icon: <span className="text-lg"></span>, color: 'text-zinc-500', activeColor: 'text-violet-400' },
    { id: 'reasoning', label: 'Reasoning', shortLabel: 'Think', icon: <BrainIcon className="w-5 h-5" />, color: 'text-zinc-500', activeColor: 'text-cyan-400' },
];

const JournalInner: React.FC<JournalProps> = ({
    isVisible, onClose, initialTab, isEmbedded = false,
    // Trade Log Pass-through
    trades, onDeleteTrades, onClearAllTrades, modelIdToName, ocrModelIdToName, onUpdateInsights, isSummarizing, currentInsightIds, onUpdateTradeLeverage,
    // Performance Review Pass-through
    finalSummary, individualSummaries, isLoading, isInsightGenerating, newlyAddedInsightIds, summarizationProvider, summarizationModel, onSetSummarizationProvider, onSetSummarizationModel, providers = [], summaryCharLimit = 1000, onUpdateSummaryCharLimit = () => {}, onRegenerateSummary = () => {}, onDeleteInsight, useAlgorithmicSummary = false, onToggleAlgorithmicSummary = () => {},
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

    // Derive enabled providers from dynamic configs when not passed explicitly
    const effectiveEnabledProviders: AIProvider[] = enabledProviders
        ?? providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0).map(p => p.id);

    useEffect(() => {
        if (isVisible) {
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
                ocrModelIdToName={ocrModelIdToName}
                onUpdateInsights={onUpdateInsights}
                isSummarizing={isSummarizing}
                currentInsightIds={currentInsightIds}
                onUpdateTradeLeverage={onUpdateTradeLeverage}
            />
        ) : activeTab === 'performance' ? (
            <PerformanceReviewContent
                finalSummary={finalSummary || null}
                individualSummaries={individualSummaries || []}
                isLoading={isLoading}
                isInsightGenerating={isInsightGenerating}
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
            <WinRateDashboard trades={trades} />
        ) : activeTab === 'learning' ? (
            <div className="h-full overflow-y-auto">
                <LearningDashboard trades={trades} />
            </div>
        ) : activeTab === 'models' ? (
            <div className="p-4 sm:p-6 overflow-y-auto h-full">
                <ModelPerformanceDashboard enabledProviders={effectiveEnabledProviders} trades={trades} selectedModels={selectedModels} />
            </div>
        ) : activeTab === 'reasoning' ? (
            <div className="p-4 sm:p-6 overflow-y-auto h-full">
                <ReasoningDashboard username={typeof localStorage !== 'undefined' ? (localStorage.getItem('last_active_user') || 'default') : 'default'} />
            </div>
        ) : (
            <MemoryContent
                threadSummary={threadSummary}
                globalMemory={globalMemory}
            />
        )
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
            <aside className="fixed inset-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[480px] bg-zinc-950 z-50 flex flex-col animate-slide-up sm:animate-slide-left">

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
                            >
                                <CloseIcon />
                            </button>
                        </div>
                    </div>
                </header>

                {/* Content Area */}
                <div className="flex-1 overflow-hidden">
                    {activeTab === 'log' ? (
                        <TradeLogContent
                            trades={trades}
                            onDeleteTrades={onDeleteTrades}
                            onClearAllTrades={onClearAllTrades}
                            modelIdToName={modelIdToName}
                            ocrModelIdToName={ocrModelIdToName}
                            onUpdateInsights={onUpdateInsights}
                            isSummarizing={isSummarizing}
                            currentInsightIds={currentInsightIds}
                            onUpdateTradeLeverage={onUpdateTradeLeverage}
                        />
                    ) : activeTab === 'performance' ? (
                        <PerformanceReviewContent
                            finalSummary={finalSummary}
                            individualSummaries={individualSummaries}
                            isLoading={isLoading}
                            isInsightGenerating={isInsightGenerating}
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
                        <WinRateDashboard trades={trades} />
                    ) : activeTab === 'learning' ? (
                        <div className="h-full overflow-y-auto">
                            <LearningDashboard trades={trades} />
                        </div>
                    ) : activeTab === 'models' ? (
                        <div className="p-4 sm:p-6 overflow-y-auto h-full">
                            <ModelPerformanceDashboard enabledProviders={effectiveEnabledProviders} trades={trades} selectedModels={selectedModels} />
                        </div>
                    ) : activeTab === 'reasoning' ? (
                        <div className="p-4 sm:p-6 overflow-y-auto h-full">
                            <ReasoningDashboard username={typeof localStorage !== 'undefined' ? (localStorage.getItem('last_active_user') || 'default') : 'default'} />
                        </div>
                    ) : (
                        <MemoryContent
                            threadSummary={threadSummary}
                            globalMemory={globalMemory}
                        />
                    )}
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

export const Journal = React.memo(JournalInner);
