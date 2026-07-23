
import React, { useState, useEffect, useRef } from 'react';
import { AIProvider, TradeSummary } from '../../types';
import { LoadingIcon, EditIcon, ChevronDownIcon, RefreshIcon, TrashIcon } from '../shared/Icons';

interface PerformanceReviewContentProps {
    finalSummary: string | null;
    individualSummaries: TradeSummary[];
    isLoading: boolean;
    isInsightGenerating?: boolean; // Loading state for auto-insight generation
    newlyAddedInsightIds?: Set<string>; // IDs of newly added insights for animation
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

    onUpdateSummaryCharLimit: (limit: number) => void;
    onManageInsights: () => void;
    onRegenerateSummary: () => void;
    onDeleteInsight?: (id: string) => void;
    summaryCharLimit: number;
    useAlgorithmicSummary: boolean;
    onToggleAlgorithmicSummary: (use: boolean) => void;
    useAlgorithmicInsights: boolean; // NEW
    onToggleAlgorithmicInsights: (use: boolean) => void; // NEW
    onRewriteInsightsWithAI: (ids?: string[]) => void; // NEW
}

const PerformanceReviewContent: React.FC<PerformanceReviewContentProps> = ({
    finalSummary,
    individualSummaries,
    isLoading,
    isInsightGenerating = false,
    newlyAddedInsightIds = new Set(),
    summarizationProvider,
    summarizationModel,
    onSetSummarizationProvider,
    onSetSummarizationModel,
    geminiModels,
    deepseekModels,
    zhipuModels,
    groqModels,
    groqNewModels,
    groqAlt2Models,

    summaryCharLimit,
    onUpdateSummaryCharLimit,
    onManageInsights,
    onRegenerateSummary,
    onDeleteInsight,
    useAlgorithmicSummary,
    onToggleAlgorithmicSummary,
    useAlgorithmicInsights,
    onToggleAlgorithmicInsights,
    onRewriteInsightsWithAI,
}) => {
    const [localLimit, setLocalLimit] = useState<string | number>(summaryCharLimit);
    const [isPatternMemoryVisible, setIsPatternMemoryVisible] = useState(true);
    const [isRecentInsightsVisible, setIsRecentInsightsVisible] = useState(true);
    const [isModelSettingsVisible, setIsModelSettingsVisible] = useState(false);
    const [selectedInsightIds, setSelectedInsightIds] = useState<Set<string>>(new Set());
    const scrollRef = useRef<HTMLDivElement>(null);

    const toggleInsightSelection = (id: string) => {
        setSelectedInsightIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const clearSelection = () => setSelectedInsightIds(new Set());

    useEffect(() => {
        setLocalLimit(summaryCharLimit);
    }, [summaryCharLimit]);

    const getProviderModels = (provider: AIProvider) => {
        switch (provider) {
            case AIProvider.GEMINI: return geminiModels || [];
            case AIProvider.DEEPSEEK: return deepseekModels || [];
            case AIProvider.ZHIPU: return zhipuModels || [];
            case AIProvider.GROQ: return groqModels || [];
            case AIProvider.GROQ_NEW: return groqNewModels || [];
            case AIProvider.GROQ_ALT2: return groqAlt2Models || [];

            default: return [];
        }
    };

    const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newProvider = e.target.value as AIProvider;
        onSetSummarizationProvider(newProvider);
        const models = getProviderModels(newProvider);
        if (models.length > 0) {
            onSetSummarizationModel(models[0].id);
        }
    };

    const handleLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalLimit(e.target.value);
    };

    const handleLimitBlur = () => {
        let val = parseInt(String(localLimit), 10);

        if (isNaN(val)) {
            setLocalLimit(summaryCharLimit);
            return;
        }

        // Enforce bounds
        if (val < 500) val = 500;
        if (val > 100000) val = 100000;

        setLocalLimit(val);

        if (val !== summaryCharLimit) {
            onUpdateSummaryCharLimit(val);
        }
    };

    return (
        <div className="flex flex-col h-full bg-transparent">
            <div className="p-3 sm:p-5 border-b border-white/5 bg-zinc-900/50 shrink-0">
                <div className="flex flex-col gap-3 sm:gap-4">
                    <div>
                        <button
                            onClick={() => setIsModelSettingsVisible(!isModelSettingsVisible)}
                            className="flex items-center justify-between w-full group"
                        >
                            <h3 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2 group-hover:text-zinc-300 transition-colors">
                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500"></span> Model Settings
                            </h3>
                            <ChevronDownIcon className={`w-3 h-3 sm:w-4 sm:h-4 text-zinc-600 transition-transform duration-200 ${isModelSettingsVisible ? 'rotate-180' : ''}`} />
                        </button>

                        <div className={`collapsible-content ${isModelSettingsVisible ? 'expanded' : ''}`}>
                            <div className="grid grid-cols-1 gap-2 sm:gap-3 mt-3">
                                <div>
                                    <select
                                        id="summarization-provider"
                                        value={summarizationProvider}
                                        onChange={handleProviderChange}
                                        className="w-full bg-zinc-950 border border-white/10 text-zinc-300 text-sm rounded-lg focus:ring-cyan-500/50 focus:border-cyan-500/50 p-2.5 transition-all focus:outline-none"
                                    >
                                        <option value={AIProvider.GEMINI}>Gemini</option>
                                        <option value={AIProvider.DEEPSEEK}>DeepSeek</option>
                                        <option value={AIProvider.ZHIPU}>Zhipu AI</option>
                                        <option value={AIProvider.GROQ}>Groq</option>
                                        <option value={AIProvider.GROQ_NEW}>Groq (Alt)</option>
                                        <option value={AIProvider.GROQ_ALT2}>Groq (Alt 2)</option>

                                    </select>
                                </div>
                                <div>
                                    <select
                                        id="summarization-model"
                                        value={summarizationModel}
                                        onChange={(e) => onSetSummarizationModel(e.target.value)}
                                        className="w-full bg-zinc-950 border border-white/10 text-zinc-300 text-sm rounded-lg focus:ring-cyan-500/50 focus:border-cyan-500/50 p-2.5 transition-all focus:outline-none"
                                    >
                                        {getProviderModels(summarizationProvider).map(model => (
                                            <option key={model.id} value={model.id}>{model.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="pt-2 border-t border-white/5">
                                    <h3 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Summary Length</h3>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                                        <input
                                            type="number"
                                            value={localLimit}
                                            onChange={handleLimitChange}
                                            onBlur={handleLimitBlur}
                                            onKeyDown={(e) => e.key === 'Enter' && handleLimitBlur()}
                                            className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:border-cyan-500 outline-none w-full sm:w-32 font-mono"
                                            min="500"
                                            max="100000"
                                            step="100"
                                            disabled={isLoading}
                                        />
                                        <span className="text-[10px] sm:text-xs text-zinc-600">Adjust to trigger auto-regeneration</span>
                                    </div>
                                </div>

                                {/* Summary Mode Toggle */}
                                <div className="pt-2 border-t border-white/5">
                                    <h3 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Summary Mode</h3>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => onToggleAlgorithmicSummary(true)}
                                            className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border transition-all ${useAlgorithmicSummary
                                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                                                : 'bg-zinc-800/50 text-zinc-500 border-white/10 hover:border-white/20'
                                                }`}
                                        >
                                            ⚡ Algorithmic (Free)
                                        </button>
                                        <button
                                            onClick={() => onToggleAlgorithmicSummary(false)}
                                            className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border transition-all ${!useAlgorithmicSummary
                                                ? 'bg-purple-500/20 text-purple-400 border-purple-500/50'
                                                : 'bg-zinc-800/50 text-zinc-500 border-white/10 hover:border-white/20'
                                                }`}
                                        >
                                            🤖 AI (Tokens)
                                        </button>
                                    </div>
                                </div>

                                {/* Insight Generation Mode Toggle */}
                                <div className="pt-2 border-t border-white/5">
                                    <h3 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Insight Generation Mode</h3>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => onToggleAlgorithmicInsights(true)}
                                            className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border transition-all ${useAlgorithmicInsights
                                                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50'
                                                : 'bg-zinc-800/50 text-zinc-500 border-white/10 hover:border-white/20'
                                                }`}
                                        >
                                            ⚡ Algo (Free)
                                        </button>
                                        <button
                                            onClick={() => onToggleAlgorithmicInsights(false)}
                                            className={`flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border transition-all ${!useAlgorithmicInsights
                                                ? 'bg-rose-500/20 text-rose-400 border-rose-500/50'
                                                : 'bg-zinc-800/50 text-zinc-500 border-white/10 hover:border-white/20'
                                                }`}
                                        >
                                            🤖 AI (Tokens)
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-6 custom-scrollbar" style={{ overflowAnchor: 'none' }}>
                <div>
                    <div className="flex items-center justify-between mb-2 sm:mb-3">
                        <button
                            onClick={() => setIsPatternMemoryVisible(!isPatternMemoryVisible)}
                            className="flex items-center gap-2 group"
                        >
                            <h3 className="text-xs sm:text-sm font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-1 sm:gap-2 group-hover:text-cyan-300 transition-colors">
                                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-cyan-400 animate-pulse"></span> Pattern Memory
                            </h3>
                            <ChevronDownIcon className={`w-3 h-3 sm:w-4 sm:h-4 text-cyan-500 transition-transform duration-200 ${isPatternMemoryVisible ? 'rotate-180' : ''}`} />
                        </button>

                        <button
                            onClick={onRegenerateSummary}
                            disabled={isLoading}
                            className="p-1.5 text-cyan-500 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Regenerate Analysis"
                        >
                            <RefreshIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    <div className={`collapsible-content ${isPatternMemoryVisible ? 'expanded' : ''}`}>
                        <div className="p-3 sm:p-5 bg-gradient-to-br from-cyan-950/30 to-zinc-900/50 rounded-xl border border-cyan-500/20 min-h-[120px] sm:min-h-[150px] max-h-[300px] sm:max-h-[400px] overflow-y-auto relative mb-2 custom-scrollbar">
                            {isLoading && !finalSummary ? (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-8">
                                    <LoadingIcon className="w-8 h-8 mb-3 text-cyan-500" />
                                    <span className="font-mono text-xs uppercase tracking-widest">Synthesizing Trade Data...</span>
                                </div>
                            ) : (
                                <p className="text-sm text-cyan-100/90 whitespace-pre-wrap leading-relaxed">
                                    {finalSummary || "Log more trades to generate a performance synthesis."}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-2 sm:mb-3 pl-1">
                        <button
                            onClick={() => setIsRecentInsightsVisible(!isRecentInsightsVisible)}
                            className="flex items-center justify-between group gap-2"
                        >
                            <h3 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">
                                Recent Insights <span className="text-zinc-600 font-mono ml-1">({individualSummaries.length})</span>
                            </h3>
                            <ChevronDownIcon className={`w-3 h-3 sm:w-4 sm:h-4 text-zinc-600 transition-transform duration-200 ${isRecentInsightsVisible ? 'rotate-180' : ''}`} />
                        </button>
                        <button onClick={onManageInsights} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] uppercase font-bold tracking-widest bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors border border-white/5" title="Manually select trades from Log to include here">
                            <EditIcon className="w-3 h-3" /> Edit Source
                        </button>
                        {selectedInsightIds.size > 0 && (
                            <button
                                onClick={clearSelection}
                                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] uppercase font-bold tracking-widest bg-zinc-700/50 hover:bg-zinc-600/50 text-zinc-300 hover:text-white transition-colors border border-white/10"
                                title="Clear selection"
                            >
                                ✕ Clear ({selectedInsightIds.size})
                            </button>
                        )}
                        <button
                            onClick={() => {
                                onRewriteInsightsWithAI(selectedInsightIds.size > 0 ? Array.from(selectedInsightIds) : undefined);
                                clearSelection();
                            }}
                            disabled={isLoading || individualSummaries.length === 0}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] uppercase font-bold tracking-widest transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${selectedInsightIds.size > 0
                                ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 hover:text-purple-300 border-purple-500/30'
                                : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border-rose-500/20'
                                }`}
                            title={selectedInsightIds.size > 0 ? `Rewrite ${selectedInsightIds.size} selected insight(s) with AI` : "Rewrite all insights using AI"}
                        >
                            <RefreshIcon className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                            {selectedInsightIds.size > 0 ? `AI Rewrite (${selectedInsightIds.size})` : 'AI Rewrite All'}
                        </button>
                    </div>

                    <div className={`collapsible-content ${isRecentInsightsVisible ? 'expanded' : ''}`}>
                        {/* Loading indicator for insight generation */}
                        {isInsightGenerating && (
                            <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg animate-pulse">
                                <LoadingIcon className="w-4 h-4 text-cyan-400" />
                                <span className="text-xs text-cyan-300 font-medium">Adding trade to Recent Insights...</span>
                            </div>
                        )}
                        <div className="space-y-2 sm:space-y-3">
                            {([...individualSummaries].reverse() || []).length > 0 ? (
                                [...individualSummaries].reverse().map(summary => {
                                    const isNewlyAdded = newlyAddedInsightIds.has(summary.id);
                                    const isSelected = selectedInsightIds.has(summary.id);
                                    return (
                                        <div
                                            key={summary.id}
                                            onClick={() => toggleInsightSelection(summary.id)}
                                            className={`p-3 sm:p-4 bg-zinc-800/30 hover:bg-zinc-800/50 rounded-xl border transition-all group relative cursor-pointer ${isSelected
                                                ? 'border-purple-500/50 bg-purple-500/10 ring-1 ring-purple-500/30'
                                                : isNewlyAdded
                                                    ? 'border-cyan-500/50 bg-cyan-500/10 animate-slide-in-right shadow-[0_0_15px_-3px_rgba(34,211,238,0.3)]'
                                                    : 'border-white/5'
                                                }`}
                                        >
                                            {/* Selection checkbox */}
                                            <div className={`absolute top-3 left-3 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${isSelected
                                                ? 'bg-purple-500 border-purple-500'
                                                : 'border-zinc-600 group-hover:border-zinc-400'
                                                }`}>
                                                {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                                            </div>
                                            {isNewlyAdded && (
                                                <div className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-cyan-500 text-white text-[8px] font-bold uppercase rounded-full animate-bounce">
                                                    New
                                                </div>
                                            )}
                                            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed pl-6 pr-8">{summary.summaryText}</p>
                                            <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-white/5 flex justify-between items-center pl-6">
                                                <span className="text-[10px] font-mono text-zinc-500">{new Date(summary.timestamp).toLocaleString()}</span>
                                                {onDeleteInsight && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onDeleteInsight(summary.id); }}
                                                        className="p-1 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                                        title="Remove from Recent Insights"
                                                    >
                                                        <TrashIcon className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-center text-zinc-600 py-8 border border-dashed border-white/5 rounded-xl">
                                    <p>No individual summaries available.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
};

export default React.memo(PerformanceReviewContent);
