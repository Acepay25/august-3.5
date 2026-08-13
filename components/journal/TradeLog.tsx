
import React, { useState, useMemo, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Bookmark } from 'lucide-react';
import { AIProvider, LoggedTrade, TradeOutcome, TradeSummary } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, TrashIcon, StarIcon, LoadingIcon, FileTextIcon, RefreshIcon } from '../shared/Icons';
import ImageViewerModal from '../modals/ImageViewerModal';
import { EmptyState } from '../ui/EmptyState';
import { ReasoningPanel } from './ReasoningPanel';
import { getThinkingTradeId } from '../../services/infrastructure/ThinkingStoreService';
import { DEFAULT_LEVERAGE } from '../../utils/conversationUtils';
import SetupLifecycleCard from '../analysis/SetupLifecycleCard';
import MarkdownContent from '../shared/MarkdownContent';
import { getMemoryFiles, toPatternMemoryMarkdown, patternMemoryStatsFromTrades } from '../../services/learning/MemoryFilesService';

interface TradeLogContentProps {
    trades: LoggedTrade[];
    onDeleteTrades: (ids: string[]) => void;
    onClearAllTrades: () => void;
    modelIdToName: Record<string, string>;
    onUpdateInsights: (ids: string[]) => void;
    isSummarizing?: boolean;
    currentInsightIds: string[];
    onUpdateTradeLeverage: (id: string, leverage: number) => void;
    /** Correct a mis-logged outcome from the expanded card. */
    onUpdateOutcome?: (id: string, outcome: TradeOutcome) => void;
    /** Edit PnL (dollar amount + leveraged percent) from the expanded card. */
    onUpdatePnL?: (id: string, pnl: { pnlAmount?: number; pnlPercent?: number }) => void;
    /** Active user — scopes the reasoning-record lookup per trade. */
    username?: string;
    finalSummary?: string | null;
    individualSummaries?: TradeSummary[];
    isReviewLoading?: boolean;
    isInsightGenerating?: boolean;
    insightProgress?: { done: number; total: number } | null;
    newlyAddedInsightIds?: Set<string>;
    summarizationProvider?: AIProvider;
    summarizationModel?: string;
    onSetSummarizationProvider?: (provider: AIProvider) => void;
    onSetSummarizationModel?: (modelId: string) => void;
    providers?: ProviderConfig[];
    summaryCharLimit?: number;
    onUpdateSummaryCharLimit?: (limit: number) => void;
    onRegenerateSummary?: () => void;
    onDeleteInsight?: (id: string) => void;
    useAlgorithmicSummary?: boolean;
    onToggleAlgorithmicSummary?: (use: boolean) => void;
    useAlgorithmicInsights?: boolean;
    onToggleAlgorithmicInsights?: (use: boolean) => void;
    onRewriteInsightsWithAI?: (ids?: string[]) => void;
    onDocumentOpenChange?: (open: boolean) => void;
}

const OutcomeBadge: React.FC<{ outcome: TradeOutcome }> = ({ outcome }) => {
    const styles: { [key in TradeOutcome]?: string } = {
        [TradeOutcome.WIN]: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
        [TradeOutcome.LOSS]: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
        [TradeOutcome.ENTRY_NOT_HIT]: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
        [TradeOutcome.SKIPPED]: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
    };
    const text: { [key in TradeOutcome]?: string } = {
        [TradeOutcome.WIN]: 'WIN',
        [TradeOutcome.LOSS]: 'LOSS',
        [TradeOutcome.ENTRY_NOT_HIT]: 'NO ENTRY',
        [TradeOutcome.SKIPPED]: 'SKIPPED',
    };
    if (!styles[outcome]) return null;
    return (
        <span className={`status-surface px-2.5 py-1 text-[11px] font-semibold tracking-widest rounded-md uppercase ${styles[outcome]}`}>
            {text[outcome]}
        </span>
    );
};

/**
 * Full-screen trade detail — the drill-down destination when a row is
 * clicked (the old inline expansion dropped the content down inside the
 * list, with no way back but re-clicking). Has an explicit Back button that
 * returns to the trade list.
 */
const TradeDetailView: React.FC<{
    trade: LoggedTrade;
    onBack: () => void;
    modelIdToName: Record<string, string>;
    onUpdateLeverage: (id: string, leverage: number) => void;
    onUpdateOutcome?: (id: string, outcome: TradeOutcome) => void;
    onUpdatePnL?: (id: string, pnl: { pnlAmount?: number; pnlPercent?: number }) => void;
    username?: string;
}> = ({ trade, onBack, modelIdToName, onUpdateLeverage, onUpdateOutcome, onUpdatePnL, username }) => {
    const { analysis, outcome, timestamp, postMortem, postMortemImages, correctedEntry, correctedStopLoss, correctedTakeProfit, pnlAmount, pnlPercent, modelsUsed, geminiModelUsed, deepseekModelUsed, zhipuModelUsed, groqModelUsed, groqNewModelUsed, groqAlt2ModelUsed, openrouterModelUsed, moderatorModel, leverage, isAccuracyMode, accuracySubMode } = trade;
    const { direction, stopLoss, stopLossPercentage, entryPoints, takeProfit, activeStrategies, coinName, invalidationCriteria } = analysis;
    const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);
    const [localLeverage, setLocalLeverage] = useState<string>(String(leverage || DEFAULT_LEVERAGE));
    // PnL edit state — autopilot-logged trades only carry a percent, so the
    // dollar figure often needs a manual fill.
    const [pnlDraftAmount, setPnlDraftAmount] = useState<string>(pnlAmount !== undefined ? String(pnlAmount) : '');
    const [pnlDraftPercent, setPnlDraftPercent] = useState<string>(pnlPercent !== undefined ? String(pnlPercent) : '');

    const safeDirection = direction || 'Neutral';

    const handleLeverageBlur = () => {
        let val = parseInt(localLeverage, 10);
        if (isNaN(val)) val = DEFAULT_LEVERAGE;
        val = Math.max(1, Math.min(125, val));
        setLocalLeverage(String(val));
        if (val !== leverage) {
            onUpdateLeverage(trade.id, val);
        }
    };

    const handlePresetClick = (e: React.MouseEvent, val: number) => {
        e.stopPropagation();
        setLocalLeverage(String(val));
        onUpdateLeverage(trade.id, val);
    };

    // --- Dynamic Mode Styling ---
    let containerClass = "bg-zinc-900/50 border border-zinc-800";
    let modeBadge = null;

    if (isAccuracyMode) {
        containerClass = "bg-zinc-900 border border-zinc-700";
        modeBadge = (
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-md border border-zinc-600 bg-zinc-800 text-zinc-300 ml-1">
                {accuracySubMode === 'pure_ai' ? 'Pure AI' : 'Strict Mode'}
            </span>
        );
    }

    return (
        <div className="flex flex-col h-full bg-zinc-950">
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="px-8 pt-2 pb-16 w-full max-w-4xl mx-auto">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-8"
                        aria-label="Back to trade list"
                    >
                        <ChevronLeftIcon className="w-4 h-4" /> Back
                    </button>

                    <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight">{coinName}.md</h2>
                    <p className="text-sm text-zinc-500 mt-2 mb-8">
                        {safeDirection}
                        {' · '}
                        {new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        {modeBadge}
                    </p>

                    <div className="mb-4">
                        <OutcomeBadge outcome={outcome} />
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-8 py-8 lg:px-10 lg:py-10">
                        {postMortem ? (
                            <MarkdownContent content={postMortem} className="text-[15px] text-zinc-200 leading-8" />
                        ) : (
                            <p className="text-sm text-zinc-500 leading-7">
                                No post-mortem report yet. Log a WIN or LOSS with ensemble analysis to generate one.
                            </p>
                        )}
                    </div>

                    {Array.isArray(postMortemImages) && postMortemImages.length > 0 && (
                        <div className="mt-8">
                            <p className="text-sm text-zinc-500 mb-3">Evidence</p>
                            <div className="flex gap-3 overflow-x-auto pb-2">
                                {(postMortemImages || []).map((img, i) => (
                                    <img key={i} src={img} className="h-24 w-auto rounded-lg border border-zinc-800 cursor-pointer" onClick={() => setViewerImageUrl(img)} alt="" />
                                ))}
                            </div>
                        </div>
                    )}

                    <details className="mt-10 group">
                        <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200 list-none flex items-center gap-2">
                            <ChevronDownIcon className="w-4 h-4 transition-transform group-open:rotate-180" />
                            Trade setup
                        </summary>
                        <div className={`mt-6 rounded-xl overflow-hidden ${containerClass}`}>
                        <div className="px-5 py-6 space-y-5">
                            <SetupLifecycleCard analysis={analysis} outcome={outcome} triggeredEntryIndices={trade.triggeredEntryIndices} compact />
                            <div className="grid grid-cols-2 gap-4 text-sm pt-2 font-mono">

                                {/* Trade Settings Row */}
                                <div className="col-span-2 flex items-center justify-between bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 mb-1 flex-wrap gap-3">
                                    <span className="text-[11px] uppercase font-semibold text-zinc-500 tracking-widest">Trade Parameters</span>
                                    <div className="flex items-center gap-2.5 flex-wrap">
                                        <span className="text-xs text-zinc-400">Leverage:</span>
                                        <div className="flex items-center bg-zinc-800 rounded-lg border border-zinc-700 px-2.5 py-1">
                                            <input
                                                type="number"
                                                value={localLeverage}
                                                onChange={(e) => setLocalLeverage(e.target.value)}
                                                onBlur={handleLeverageBlur}
                                                onKeyDown={(e) => e.key === 'Enter' && handleLeverageBlur()}
                                                className="w-8 bg-transparent text-center font-mono font-bold text-zinc-200 outline-none text-sm"
                                            />
                                            <span className="text-zinc-600 text-xs">x</span>
                                        </div>

                                        <div className="flex gap-1.5 ml-1 pl-3 border-l border-zinc-800">
                                            {[25, 50, 75, 100].map(val => (
                                                <button
                                                    key={val}
                                                    onClick={(e) => handlePresetClick(e, val)}
                                                    className={`text-[10px] px-2 py-1 rounded-md border transition-all ${parseInt(localLeverage) === val
                                                        ? 'bg-zinc-700 border-zinc-500 text-zinc-100 font-semibold'
                                                        : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300'
                                                        }`}
                                                >
                                                    {val}x
                                                </button>
                                            ))}
                                        </div>

                                        {/* Outcome correction — segmented buttons
                                            (the old <select> dropdown is gone). */}
                                        {onUpdateOutcome && (
                                            <div className="flex items-center gap-1 ml-2 pl-2 border-l border-white/10 flex-wrap">
                                                <span className="text-[10px] text-zinc-400">Outcome:</span>
                                                {[TradeOutcome.WIN, TradeOutcome.LOSS, TradeOutcome.ENTRY_NOT_HIT, TradeOutcome.SKIPPED].map(o => (
                                                    <button
                                                        key={o}
                                                        onClick={() => onUpdateOutcome(trade.id, o)}
                                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-all ${
                                                            trade.outcome === o
                                                                ? o === TradeOutcome.WIN
                                                                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                                                    : o === TradeOutcome.LOSS
                                                                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                                                                        : 'bg-zinc-700 border-white/20 text-zinc-200'
                                                                : 'bg-zinc-800 border-white/10 text-zinc-500 hover:text-zinc-300'
                                                        }`}
                                                        title={`Set outcome to ${o === TradeOutcome.ENTRY_NOT_HIT ? 'NO ENTRY' : o}`}
                                                    >
                                                        {o === TradeOutcome.ENTRY_NOT_HIT ? 'NO ENTRY' : o}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {/* PnL editing — dollar amount + leveraged percent
                                            (autopilot trades only carry the percent). */}
                                        {onUpdatePnL && (
                                            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-white/10">
                                                <span className="text-[10px] text-zinc-400">PnL $</span>
                                                <input
                                                    type="number"
                                                    value={pnlDraftAmount}
                                                    onChange={(e) => setPnlDraftAmount(e.target.value)}
                                                    placeholder={pnlAmount !== undefined ? undefined : '—'}
                                                    className="w-20 bg-zinc-800 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 outline-none focus:border-cyan-500/40"
                                                    aria-label="PnL in dollars"
                                                />
                                                <span className="text-[10px] text-zinc-400">%</span>
                                                <input
                                                    type="number"
                                                    value={pnlDraftPercent}
                                                    onChange={(e) => setPnlDraftPercent(e.target.value)}
                                                    placeholder={pnlPercent !== undefined ? undefined : '—'}
                                                    className="w-14 bg-zinc-800 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 outline-none focus:border-cyan-500/40"
                                                    aria-label="PnL as leveraged percent"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => onUpdatePnL(trade.id, {
                                                        pnlAmount: pnlDraftAmount.trim() !== '' ? parseFloat(pnlDraftAmount) : undefined,
                                                        pnlPercent: pnlDraftPercent.trim() !== '' ? parseFloat(pnlDraftPercent) : undefined,
                                                    })}
                                                    className="px-2 py-1 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-[10px] font-semibold uppercase tracking-widest transition-colors"
                                                    title="Save PnL"
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800">
                                    <span className="text-[11px] uppercase font-semibold text-zinc-500 block mb-1.5">Entry Zone</span>
                                    <span className="text-cyan-200 font-bold text-sm">{(entryPoints || [])[0]?.price || 'N/A'}</span>
                                </div>
                                <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800">
                                    <span className="text-[11px] uppercase font-semibold text-zinc-500 block mb-1.5">Stop Loss</span>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-rose-300 font-bold text-sm">{stopLoss}</span>
                                        {stopLossPercentage && <span className="text-rose-500/60 text-[9px]">{stopLossPercentage}</span>}
                                    </div>
                                </div>
                                <div className="col-span-2 p-4 bg-zinc-950 rounded-xl border border-zinc-800">
                                    <span className="text-[11px] uppercase font-semibold text-zinc-500 block mb-2">Take Profit Targets</span>
                                    <div className="flex flex-wrap gap-2">
                                        {(takeProfit || []).map((tp, i) => (
                                            <div key={i} className="flex items-center gap-1 bg-emerald-900/20 px-2 py-1 rounded border border-emerald-500/10">
                                                <span className="text-emerald-300 font-bold">{tp.price}</span>
                                                {tp.percentage && <span className="text-emerald-600 text-[9px]">{tp.percentage}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {invalidationCriteria && invalidationCriteria.length > 0 && (
                                    <div className="col-span-2 p-2.5 bg-rose-950/20 rounded-lg border border-rose-500/15 hover:border-rose-500/30 transition-colors">
                                        <span className="text-[9px] uppercase font-bold text-rose-400/80 block mb-1">Invalidation Contract</span>
                                        <div className="space-y-1">
                                            {invalidationCriteria.map((c, i) => (
                                                <div key={i} className="text-[10px] text-rose-100/80 leading-snug">
                                                    <span className="font-mono font-bold text-rose-300">{c.level}</span>
                                                    <span className="text-rose-200/70"> — {c.condition}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {correctedEntry && <div className="col-span-2 bg-yellow-500/10 p-2 rounded border border-yellow-500/20 text-yellow-200 font-medium">Corrected Entry: {correctedEntry}</div>}

                                <div className="col-span-2 text-[9px] text-zinc-600 pt-3 mt-1 border-t border-white/5 flex justify-between uppercase tracking-wider">
                                    <span>Analyst: {(() => {
                                        const usedEntries = modelsUsed && Object.keys(modelsUsed).length > 0 ? Object.entries(modelsUsed) : [];
                                        if (usedEntries.length > 0) {
                                            return usedEntries.map(([, modelId]) => modelIdToName[modelId] ?? modelId).join(' + ');
                                        }
                                        const legacyModels = [geminiModelUsed, deepseekModelUsed, zhipuModelUsed, groqModelUsed, groqNewModelUsed, groqAlt2ModelUsed, openrouterModelUsed].filter(Boolean) as string[];
                                        if (legacyModels.length > 0) {
                                            return legacyModels.map(m => modelIdToName[m] ?? m).join(' + ');
                                        }
                                        return 'Ensemble';
                                    })()}</span>
                                    {moderatorModel && <span>Mod: {modelIdToName[moderatorModel] || 'AI'}</span>}
                                </div>

                                {/* Pattern-memory gate at analysis time — shows when
                                    memory halted / downsized / warned this trade. */}
                                {trade.patternMemoryGate && trade.patternMemoryGate.gateResult !== 'PASS' && (
                                    <div className={`col-span-2 rounded-lg border px-3 py-2 ${trade.patternMemoryGate.gateResult === 'HALT'
                                        ? 'status-surface border-rose-500/40 bg-rose-500/10'
                                        : 'status-surface border-amber-500/40 bg-amber-500/10'}`}>
                                        <span className={`text-[9px] font-black uppercase tracking-widest ${trade.patternMemoryGate.gateResult === 'HALT' ? 'text-rose-400' : 'text-amber-400'}`}>
                                            {trade.patternMemoryGate.gateResult === 'HALT' ? '⛔ Memory gate: halted' : trade.patternMemoryGate.gateResult === 'REDUCE_SIZE' ? '⚠️ Memory gate: reduce size' : '⚡ Memory gate: warning'}
                                        </span>
                                        <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{trade.patternMemoryGate.reason}</p>
                                        {trade.patternMemoryGate.historicalFailures.length > 0 && (
                                            <p className="text-[10px] text-zinc-500 mt-1">
                                                Matched: {trade.patternMemoryGate.historicalFailures.map(f => `${f.outcome ?? ''}${f.coinName ? ` ${f.coinName}` : ''}${f.direction ? ` ${f.direction}` : ''}`).join(' · ')}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Reasoning Panel — per-analyst reasoning + debate transcript */}
                                <div className="col-span-2">
                                    <ReasoningPanel tradeId={getThinkingTradeId(trade.analysis?.createdAt, trade.id)} outcome={outcome} username={username} />
                                </div>
                            </div>
                        </div>
                        </div>
                    </details>
                </div>
            </div>

            {/* Image Viewer Modal */}
            <ImageViewerModal
                imageUrl={viewerImageUrl}
                onClose={() => setViewerImageUrl(null)}
            />
        </div>
    );
};

/**
 * Compact list row — clicking it NAVIGATES to the full trade detail screen
 * (with its own Back button) instead of expanding inline.
 */
const TradeLogRow: React.FC<{
    trade: LoggedTrade;
    onOpenDetail: () => void;
    isSelected: boolean;
    onSelect: (id: string) => void;
    isInsight: boolean;
}> = ({ trade, onOpenDetail, isSelected, onSelect, isInsight }) => {
    const { analysis, outcome, timestamp, pnlPercent, pnlAmount } = trade;
    const coinName = analysis?.coinName || 'Unknown';
    const direction = analysis?.direction || 'Neutral';
    const rawStrategy = (analysis?.activeStrategies || [])[0] || analysis?.strategy || '';
    const strategy = rawStrategy && !/\*\*|FINAL TRADE PLAN|#\s/.test(rawStrategy)
        ? rawStrategy
        : (analysis?.detectedPatternFamily || '');
    const pnlLabel = pnlAmount !== undefined
        ? `${pnlAmount >= 0 ? '+' : ''}${pnlAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
        : pnlPercent !== undefined
            ? `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
            : null;

    return (
        <div className={`flex items-center gap-3 px-5 py-5 hover:bg-zinc-800/80 transition-colors ${isSelected ? 'bg-zinc-800' : ''}`}>
            <div onClick={(e) => e.stopPropagation()}>
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onSelect(trade.id)}
                    className="form-checkbox h-4 w-4 bg-zinc-950 border-zinc-600 text-zinc-300 rounded focus:ring-zinc-500 cursor-pointer"
                />
            </div>
            <button type="button" onClick={onOpenDetail} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                <FileTextIcon className="w-5 h-5 text-zinc-500 shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-zinc-100 truncate">{coinName}.md</span>
                        <OutcomeBadge outcome={outcome} />
                        {isInsight && <span className="text-[10px] uppercase tracking-widest text-zinc-500">memory</span>}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 truncate">
                        {direction}{strategy ? ` · ${strategy}` : ''} · {new Date(timestamp).toLocaleDateString()}
                        {pnlLabel ? ` · ${pnlLabel}` : ''}
                    </p>
                </div>
                <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0" />
            </button>
        </div>
    );
};

const PatternMemoryDetailView: React.FC<{
    markdown: string;
    isLoading: boolean;
    onBack: () => void;
    onRegenerate: () => void;
}> = ({ markdown, isLoading, onBack, onRegenerate }) => (
    <div className="flex flex-col h-full bg-zinc-950">
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <div className="px-8 pt-2 pb-16 w-full max-w-4xl mx-auto">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors mb-8"
                    aria-label="Back to trade list"
                >
                    <ChevronLeftIcon className="w-4 h-4" /> Back
                </button>

                <div className="flex items-start justify-between gap-3 mb-2">
                    <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight">pattern-memory.md</h2>
                    <button
                        type="button"
                        onClick={onRegenerate}
                        disabled={isLoading}
                        className="p-2 text-zinc-500 hover:text-zinc-100 rounded-lg hover:bg-zinc-900 transition-colors disabled:opacity-50"
                        title="Regenerate synthesis"
                    >
                        <RefreshIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                <p className="text-sm text-zinc-500 mt-2 mb-8">Rewritten by the Memory model when the journal updates</p>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-8 py-8 lg:px-10 lg:py-10">
                        {isLoading && !markdown.trim() ? (
                            <div className="flex items-center gap-2 text-sm text-zinc-500">
                                <LoadingIcon className="w-4 h-4" /> Synthesizing…
                            </div>
                        ) : (
                            <MarkdownContent content={markdown} className="text-[15px] text-zinc-200 leading-8" />
                        )}
                </div>
            </div>
        </div>
    </div>
);

const TradeLogContent: React.FC<TradeLogContentProps> = ({
    trades, onDeleteTrades, onClearAllTrades, modelIdToName, onUpdateInsights, isSummarizing, currentInsightIds, onUpdateTradeLeverage, onUpdateOutcome, onUpdatePnL, username,
    finalSummary = null,
    individualSummaries = [],
    isReviewLoading = false,
    isInsightGenerating = false,
    insightProgress = null,
    newlyAddedInsightIds,
    summarizationProvider = '',
    summarizationModel = '',
    onSetSummarizationProvider = () => {},
    onSetSummarizationModel = () => {},
    providers = [],
    summaryCharLimit = 1000,
    onUpdateSummaryCharLimit = () => {},
    onRegenerateSummary = () => {},
    onDeleteInsight,
    useAlgorithmicSummary = false,
    onToggleAlgorithmicSummary = () => {},
    useAlgorithmicInsights = false,
    onToggleAlgorithmicInsights = () => {},
    onRewriteInsightsWithAI = () => {},
    onDocumentOpenChange,
}) => {
    // Drill-down navigation: the trade currently on the full detail screen
    // (null = the list is showing).
    const [detailTradeId, setDetailTradeId] = useState<string | null>(null);
    const [showPatternMemory, setShowPatternMemory] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);
    const [tradeTypeFilter, setTradeTypeFilter] = useState<'all' | 'scalp' | 'swing'>('all');
    const [outcomeFilter, setOutcomeFilter] = useState<'all' | TradeOutcome>('all');

    const detailTrade = trades.find(t => t.id === detailTradeId);

    useEffect(() => {
        onDocumentOpenChange?.(showPatternMemory || !!detailTradeId);
        return () => onDocumentOpenChange?.(false);
    }, [showPatternMemory, detailTradeId, onDocumentOpenChange]);

    const filteredTrades = useMemo(() => (trades || []).filter(trade => {
        if (tradeTypeFilter !== 'all') {
            const tt = trade.tradeType || trade.analysis.tradeType;
            if (tradeTypeFilter === 'scalp') return tt === 'scalp';
            if (tradeTypeFilter === 'swing') return tt === 'swing' || !tt;
        }
        if (outcomeFilter !== 'all' && trade.outcome !== outcomeFilter) return false;
        return true;
    }), [trades, tradeTypeFilter, outcomeFilter]);

    const patternMemoryMarkdown = useMemo(() => {
        const store = getMemoryFiles();
        const folder = store.folders.find(f => f.name === 'profile');
        const file = store.files.find(f => f.name === 'pattern-memory.md' && (!folder || f.folderId === folder.id));
        if (file?.content.trim()) return file.content;
        return toPatternMemoryMarkdown(finalSummary, patternMemoryStatsFromTrades(trades));
    }, [finalSummary, isReviewLoading, showPatternMemory, trades]);

    if (showPatternMemory) {
        return (
            <PatternMemoryDetailView
                markdown={patternMemoryMarkdown}
                isLoading={isReviewLoading}
                onBack={() => setShowPatternMemory(false)}
                onRegenerate={onRegenerateSummary}
            />
        );
    }

    // Full-screen trade detail (Back button returns to the list).
    // Must sit AFTER every hook — opening a trade used to return here before
    // filter state, which crashed with "Rendered fewer hooks than expected".
    if (detailTrade) {
        return (
            <TradeDetailView
                trade={detailTrade}
                onBack={() => setDetailTradeId(null)}
                modelIdToName={modelIdToName}
                onUpdateLeverage={onUpdateTradeLeverage}
                onUpdateOutcome={onUpdateOutcome}
                onUpdatePnL={onUpdatePnL}
                username={username}
            />
        );
    }

    const handleSelect = (id: string) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(tradeId => tradeId !== id) : [...prev, id]
        );
    };

    const handleSelectActiveInsights = () => {
        const validIds = currentInsightIds.filter(id => trades.some(t => t.id === id));
        setSelectedIds(validIds);
    };

    const handleDeleteSelected = () => {
        if (selectedIds.length > 0) {
            onDeleteTrades(selectedIds);
            setSelectedIds([]);
        }
    };

    const handleUpdateInsights = () => {
        if (selectedIds.length > 0) {
            onUpdateInsights(selectedIds);
        }
    };

    const duplicateCount = selectedIds.filter(id => currentInsightIds.includes(id)).length;
    const newCount = selectedIds.length - duplicateCount;

    const totalTrades = filteredTrades.length;

    return (
        <div className="flex flex-col h-full bg-transparent w-full max-w-4xl mx-auto">
            {/* Filters: trade type + outcome */}
            <div className="px-8 pt-2 pb-6 shrink-0 space-y-5">
                <div className="flex items-center gap-2 flex-wrap">
                    {(['all', 'scalp', 'swing'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => setTradeTypeFilter(type)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                                tradeTypeFilter === type
                                    ? 'bg-zinc-800 text-zinc-100'
                                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'}`}
                        >
                            {type === 'scalp' ? '◆ ' : type === 'swing' ? '◇ ' : ''}{type}
                        </button>
                    ))}
                    <span className="w-px h-4 bg-white/10 mx-1" />
                    {[TradeOutcome.WIN, TradeOutcome.LOSS, TradeOutcome.ENTRY_NOT_HIT, TradeOutcome.SKIPPED].map(o => (
                        <button
                            key={o}
                            onClick={() => setOutcomeFilter(prev => prev === o ? 'all' : o)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                                outcomeFilter === o
                                    ? 'bg-zinc-800 text-zinc-100'
                                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900'
                            }`}
                        >
                            {o === TradeOutcome.ENTRY_NOT_HIT ? 'NO ENTRY' : o}
                        </button>
                    ))}
                    {outcomeFilter !== 'all' && (
                        <button
                            onClick={() => setOutcomeFilter('all')}
                            className="text-[9px] text-zinc-500 hover:text-zinc-300 px-1"
                            aria-label="Clear outcome filter"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {trades.length > 0 && (
                <div className="px-8 pb-3 shrink-0 flex items-center justify-end">
                    <button
                        type="button"
                        onClick={onClearAllTrades}
                        className="text-xs text-zinc-500 hover:text-rose-400 transition-colors"
                        title="Delete all logged trades (with 5s undo)"
                    >
                        Clear all
                    </button>
                </div>
            )}

            {currentInsightIds.length > 0 && (
                <div className="px-8 pb-4 shrink-0">
                    <button onClick={handleSelectActiveInsights} className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
                        Select {currentInsightIds.length} memory trades
                    </button>
                </div>
            )}

            {/* Selected Actions */}
            {selectedIds.length > 0 && (
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 shrink-0 animate-fade-in">
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={handleUpdateInsights}
                            disabled={isSummarizing || newCount === 0}
                            className={`w-full flex items-center justify-center gap-2 font-semibold py-3 px-4 rounded-xl transition-all uppercase text-xs tracking-widest disabled:opacity-50 disabled:cursor-not-allowed ${duplicateCount > 0 && newCount === 0
                                ? 'bg-zinc-800 border border-zinc-700 text-zinc-500'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-600'
                                }`}
                        >
                            {isSummarizing ? <LoadingIcon className="w-4 h-4" /> : <StarIcon className="w-4 h-4" />}
                            {isSummarizing ? 'Synthesizing...' :
                                duplicateCount > 0
                                    ? `Add ${newCount} New (${duplicateCount} Duplicates)`
                                    : `Set as Recent Insights (${selectedIds.length})`
                            }
                        </button>
                        {duplicateCount > 0 && (
                            <div className="text-[10px] text-center text-orange-400/80 uppercase font-bold tracking-wider animate-pulse">
                                {duplicateCount === selectedIds.length
                                    ? 'All selected trades are already in Recent Insights'
                                    : `${duplicateCount} duplicate(s) will be skipped`
                                }
                            </div>
                        )}
                        <button onClick={handleDeleteSelected} disabled={isSummarizing} className="status-surface w-full flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-semibold py-3 px-4 rounded-xl transition-all uppercase text-xs tracking-widest disabled:opacity-50">
                            <TrashIcon /> Delete Selected ({selectedIds.length})
                        </button>
                    </div>
                </div>
            )}

            {/* Trade List - Virtualized */}
            <div className="flex-1 overflow-hidden px-8 pb-8">
                {totalTrades === 0 && trades.length === 0 ? (
                    <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                        <button
                            type="button"
                            onClick={() => setShowPatternMemory(true)}
                            className="flex items-center gap-3 px-5 py-5 hover:bg-zinc-800/80 transition-colors border-b border-zinc-800 text-left shrink-0 w-full"
                        >
                            <FileTextIcon className="w-5 h-5 text-zinc-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-zinc-100">pattern-memory.md</span>
                                <p className="text-xs text-zinc-500 mt-1 truncate">
                                    {isReviewLoading ? 'Synthesizing…' : 'Pattern synthesis'}
                                </p>
                            </div>
                            <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0" />
                        </button>
                        <EmptyState
                            icon={<Bookmark className="w-8 h-8" />}
                            title="No trades logged yet"
                            description="Run an analysis and log your first trade to start building your journal."
                            className="flex-1"
                        />
                    </div>
                ) : totalTrades === 0 ? (
                    <EmptyState
                        icon={<Bookmark className="w-8 h-8" />}
                        title="No matching trades"
                        description="Nothing matches the current filters."
                        className="h-full"
                    />
                ) : (
                    <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col">
                        <button
                            type="button"
                            onClick={() => setShowPatternMemory(true)}
                            className="flex items-center gap-3 px-5 py-5 hover:bg-zinc-800/80 transition-colors border-b border-zinc-800 text-left shrink-0 w-full"
                        >
                            <FileTextIcon className="w-5 h-5 text-zinc-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-zinc-100">pattern-memory.md</span>
                                <p className="text-xs text-zinc-500 mt-1 truncate">
                                    {isReviewLoading ? 'Synthesizing…' : 'Pattern synthesis'}
                                </p>
                            </div>
                            <ChevronRightIcon className="w-4 h-4 text-zinc-600 shrink-0" />
                        </button>
                        <Virtuoso
                            style={{ height: '100%' }}
                            data={filteredTrades}
                            itemContent={(_index, trade) => (
                                <div className="border-b border-zinc-800 last:border-b-0">
                                    <TradeLogRow
                                        trade={trade}
                                        onOpenDetail={() => setDetailTradeId(trade.id)}
                                        isSelected={selectedIds.includes(trade.id)}
                                        onSelect={handleSelect}
                                        isInsight={currentInsightIds.includes(trade.id)}
                                    />
                                </div>
                            )}
                        />
                    </div>
                )}
            </div>

            {/* Image Viewer Modal */}
            <ImageViewerModal
                imageUrl={viewerImageUrl}
                onClose={() => setViewerImageUrl(null)}
            />
        </div>
    );
};

export default React.memo(TradeLogContent);
