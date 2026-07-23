
import React, { useState, useEffect } from 'react';
import TradeLogContent from './TradeLog';
import PerformanceReviewContent from './PerformanceReview';
import WinRateDashboard from './WinRateDashboard';
import LearningDashboard from './LearningDashboard';
import ModelPerformanceDashboard from './ModelPerformanceDashboard';
import { CloseIcon, HistoryIcon, StarIcon, ChartBarIcon, BrainIcon } from './Icons';
import { AIProvider, LoggedTrade, TradeSummary, GlobalMemory } from '../types';

interface JournalProps {
    isVisible: boolean;
    onClose: () => void;
    initialTab: 'log' | 'performance' | 'analytics' | 'learning' | 'memory' | 'models';

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
    geminiModels: { id: string; name: string }[];
    deepseekModels: { id: string; name: string }[];
    zhipuModels: { id: string; name: string }[];
    groqModels: { id: string; name: string }[];
    groqNewModels: { id: string; name: string }[];
    groqAlt2Models: { id: string; name: string }[];

    summaryCharLimit: number;
    onUpdateSummaryCharLimit: (limit: number) => void;
    onRegenerateSummary: () => void;
    onDeleteInsight?: (id: string) => void;
    useAlgorithmicSummary: boolean;
    onToggleAlgorithmicSummary: (use: boolean) => void;
    useAlgorithmicInsights: boolean; // NEW
    onToggleAlgorithmicInsights: (use: boolean) => void; // NEW
    onRewriteInsightsWithAI: (ids?: string[]) => void; // NEW

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
    globalMemory?: GlobalMemory;
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
                    <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
                        <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Statistics</div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 bg-black/20 rounded-xl">
                                <div className="text-2xl font-bold text-white">{globalMemory.totalTradesAnalyzed ?? 0}</div>
                                <div className="text-xs text-zinc-500">Trades Analyzed</div>
                            </div>
                            <div className="p-3 bg-black/20 rounded-xl">
                                <div className="text-sm font-medium text-zinc-400 truncate">
                                    {globalMemory.lastUpdated ? new Date(globalMemory.lastUpdated).toLocaleDateString() : 'N/A'}
                                </div>
                                <div className="text-xs text-zinc-500">Last Updated</div>
                            </div>
                        </div>
                    </div>

                    {/* Pattern Recognition Card */}
                    <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
                        <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Pattern Recognition</div>
                        <div className="space-y-2">
                            {(globalMemory.aiPatternMemory ?? []).length > 0 ? (
                                globalMemory.aiPatternMemory.slice(0, 5).map((pat, i) => (
                                    <div key={i} className="p-3 bg-black/20 rounded-xl text-xs text-zinc-300 leading-relaxed">
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
                                    <div key={i} className="p-3 bg-black/20 rounded-xl text-xs text-red-200/80 leading-relaxed">
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
type TabId = 'log' | 'performance' | 'analytics' | 'learning' | 'memory' | 'models';

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
    { id: 'learning', label: 'Learning', shortLabel: 'Learn', icon: <span className="text-lg">🎓</span>, color: 'text-zinc-500', activeColor: 'text-blue-400' },
    { id: 'models', label: 'Models', shortLabel: 'AI', icon: <span className="text-lg">🤖</span>, color: 'text-zinc-500', activeColor: 'text-violet-400' },
];

const JournalInner: React.FC<JournalProps> = ({
    isVisible, onClose, initialTab,
    // Trade Log Pass-through
    trades, onDeleteTrades, onClearAllTrades, modelIdToName, ocrModelIdToName, onUpdateInsights, isSummarizing, currentInsightIds, onUpdateTradeLeverage,
    // Performance Review Pass-through
    finalSummary, individualSummaries, isLoading, isInsightGenerating, newlyAddedInsightIds, summarizationProvider, summarizationModel, onSetSummarizationProvider, onSetSummarizationModel, geminiModels, deepseekModels, zhipuModels, groqModels, groqNewModels, groqAlt2Models, summaryCharLimit, onUpdateSummaryCharLimit, onRegenerateSummary, onDeleteInsight, useAlgorithmicSummary, onToggleAlgorithmicSummary,
    // Analytics Pass-through
    familyWinRates,
    // Memory Pass-through
    globalMemory, threadSummary,
    // Model Performance Props
    enabledProviders = [AIProvider.GEMINI, AIProvider.DEEPSEEK, AIProvider.GROQ],
    selectedModels = {},
    useAlgorithmicInsights, onToggleAlgorithmicInsights, // NEW
    onRewriteInsightsWithAI // NEW
}) => {
    const [activeTab, setActiveTab] = useState<TabId>(initialTab);

    useEffect(() => {
        if (isVisible) {
            setActiveTab(initialTab);
        }
    }, [isVisible, initialTab]);

    const currentTab = TABS.find(t => t.id === activeTab) || TABS[0];

    if (!isVisible) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 animate-fade-in"
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
                        <button
                            onClick={onClose}
                            className="p-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all"
                        >
                            <CloseIcon />
                        </button>
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
                            geminiModels={geminiModels}
                            deepseekModels={deepseekModels}
                            zhipuModels={zhipuModels}
                            groqModels={groqModels}
                            groqNewModels={groqNewModels}
                            groqAlt2Models={groqAlt2Models}

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
                            <ModelPerformanceDashboard enabledProviders={enabledProviders} trades={trades} selectedModels={selectedModels} />
                        </div>
                    ) : (
                        <MemoryContent
                            threadSummary={threadSummary}
                            globalMemory={globalMemory}
                        />
                    )}
                </div>

                {/* Bottom Navigation Bar - Mobile Optimized */}
                <nav className="shrink-0 bg-zinc-900/95 backdrop-blur-xl border-t border-white/5 px-2 pb-safe">
                    <div className="flex items-center justify-around py-2">
                        {TABS.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all min-w-[56px] ${isActive
                                        ? 'bg-white/10'
                                        : 'hover:bg-white/5'
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
