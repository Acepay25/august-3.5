
import React, { useState, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Bookmark } from 'lucide-react';
import { LoggedTrade, TradeOutcome, AccuracySubMode } from '../../types';
import { ChevronDownIcon, TrashIcon, StarIcon, LoadingIcon, BrainIcon, EditIcon } from '../shared/Icons';
import ImageViewerModal from '../modals/ImageViewerModal';
import { EmptyState } from '../ui/EmptyState';
import { ReasoningPanel } from './ReasoningPanel';
import { getThinkingTradeId } from '../../services/infrastructure/ThinkingStoreService';
import { DEFAULT_LEVERAGE } from '../../utils/conversationUtils';
import SetupLifecycleCard from '../analysis/SetupLifecycleCard';

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
}

const OutcomeBadge: React.FC<{ outcome: TradeOutcome }> = ({ outcome }) => {
    const styles: { [key in TradeOutcome]?: string } = {
        [TradeOutcome.WIN]: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_-3px_rgba(176, 176, 182,0.3)]',
        [TradeOutcome.LOSS]: 'bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-[0_0_10px_-3px_rgba(107, 107, 115,0.3)]',
        [TradeOutcome.ENTRY_NOT_HIT]: 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
        [TradeOutcome.SKIPPED]: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    };
    const text: { [key in TradeOutcome]?: string } = {
        [TradeOutcome.WIN]: 'WIN',
        [TradeOutcome.LOSS]: 'LOSS',
        [TradeOutcome.ENTRY_NOT_HIT]: 'NO ENTRY',
        [TradeOutcome.SKIPPED]: 'SKIPPED',
    };
    if (!styles[outcome]) return null;
    return (
        <span className={`px-2 py-0.5 text-[10px] font-black tracking-widest rounded uppercase ${styles[outcome]}`}>
            {text[outcome]}
        </span>
    );
};

/**
 * Extract the first IF/THEN learning rule from a post-mortem text so it can
 * be surfaced on the trade card (the learning loop the app already generates).
 */
const extractIfThenRule = (text: string | undefined): string | null => {
    if (!text) return null;
    const match = text.match(/IF\s+([^.]{5,220}?)\s+THEN\s+([^.]{5,220}?)[.\n]/i);
    if (!match) return null;
    const rule = `IF ${match[1].trim()} THEN ${match[2].trim()}`;
    return rule.length > 240 ? rule.slice(0, 240) + '…' : rule;
};

const TradeLogRow: React.FC<{
    trade: LoggedTrade;
    onToggle: () => void;
    isExpanded: boolean;
    isSelected: boolean;
    onSelect: (id: string) => void;
    onViewImage: (url: string) => void;
    modelIdToName: Record<string, string>;
    isInsight: boolean;
    onUpdateLeverage: (id: string, leverage: number) => void;
    onUpdateOutcome?: (id: string, outcome: TradeOutcome) => void;
    onUpdatePnL?: (id: string, pnl: { pnlAmount?: number; pnlPercent?: number }) => void;
    username?: string;
}> = ({ trade, onToggle, isExpanded, isSelected, onSelect, onViewImage, modelIdToName, isInsight, onUpdateLeverage, onUpdateOutcome, onUpdatePnL, username }) => {
    const { analysis, outcome, timestamp, postMortem, postMortemImages, correctedEntry, correctedStopLoss, correctedTakeProfit, pnlAmount, pnlPercent, modelsUsed, geminiModelUsed, deepseekModelUsed, zhipuModelUsed, groqModelUsed, groqNewModelUsed, groqAlt2ModelUsed, openrouterModelUsed, moderatorModel, leverage, isAccuracyMode, accuracySubMode } = trade;
    const { direction, stopLoss, stopLossPercentage, entryPoints, takeProfit, activeStrategies, coinName, invalidationCriteria } = analysis;
    const [isInsightsVisible, setIsInsightsVisible] = useState(false);
    const [isPostMortemVisible, setIsPostMortemVisible] = useState(false);
    const [isScreenshotsVisible, setIsScreenshotsVisible] = useState(false);
    const [localLeverage, setLocalLeverage] = useState<string>(String(leverage || DEFAULT_LEVERAGE));
    // PnL edit state (expanded card) — autopilot-logged trades only carry a
    // percent, so the dollar figure often needs a manual fill.
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
    let containerClass = "glass-panel border-white/5 hover:border-white/10"; // Default
    let modeBadge = null;

    if (isAccuracyMode) {
        // All accuracy modes use cyan dark theme
        containerClass = "bg-cyan-950/20 border border-cyan-500/30 hover:border-cyan-500/50 shadow-[0_0_15px_-5px_rgba(176, 176, 182,0.1)]";
        modeBadge = (
            <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-900/30 text-cyan-300 ml-2 animate-pulse">
                {accuracySubMode === 'pure_ai' ? 'Pure AI' : 'Strict Mode'}
            </span>
        );
    }

    if (isSelected) {
        containerClass += " border-cyan-500/50 ring-1 ring-cyan-500/20";
    }

    return (
        <div className={`rounded-xl mb-3 transition-all duration-300 ${containerClass}`}>
            <div className="p-4 cursor-pointer" onClick={onToggle}>
                <div className="flex items-start gap-3">
                    <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                        <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onSelect(trade.id)}
                            className="form-checkbox h-5 w-5 bg-zinc-900 border-zinc-600 text-cyan-500 rounded focus:ring-cyan-500/50 cursor-pointer transition-all"
                        />
                    </div>
                    <div className="flex-1 min-w-0">
                        {/* Header Row */}
                        <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2.5">
                                <OutcomeBadge outcome={outcome} />
                                <span className={`font-black text-sm tracking-wider uppercase ${safeDirection === 'Long' ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(228,228,231,0.5)]' : safeDirection === 'Short' ? 'text-rose-400 drop-shadow-[0_0_5px_rgba(161,161,170,0.5)]' : 'text-gray-400'}`}>{safeDirection}</span>
                                <span className="font-mono text-xs font-bold text-zinc-300">{coinName}</span>
                                {modeBadge}
                                {isInsight && (
                                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-[9px] font-bold text-cyan-300 uppercase tracking-widest" title="This trade is currently included in Recent Insights">
                                        <BrainIcon className="w-3 h-3" /> Memory
                                    </div>
                                )}
                                {/* Trade Type Badge - Scalp vs Swing */}
                                {(trade.tradeType || trade.analysis.tradeType) && (
                                    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border
                                        ${(trade.tradeType || trade.analysis.tradeType) === 'scalp'
                                            ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                                            : 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'}`}>
                                        <span>{(trade.tradeType || trade.analysis.tradeType) === 'scalp' ? '◆' : '◇'}</span>
                                        {(trade.tradeType || trade.analysis.tradeType)?.toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <span className="text-[10px] font-mono text-zinc-500">{new Date(timestamp).toLocaleDateString()}</span>
                        </div>

                        {/* Strategy & PnL Row */}
                        <div className="flex justify-between items-end">
                            <div className="flex-1 pr-4">
                                <span className="text-xs text-zinc-300 font-semibold block mb-1 truncate" title={(activeStrategies || []).join(', ')}>
                                    {(activeStrategies || []).length > 0 ? (activeStrategies || []).join(', ') : 'Discretionary Trade'}
                                </span>
                                <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
                                    <span>Entry: <span className="text-zinc-300">{(entryPoints || [])[0]?.price || 'N/A'}</span></span>
                                    <span>SL: <span className="text-rose-300/80">{stopLoss || 'N/A'}</span></span>
                                </div>
                            </div>

                            {/* Prominent PnL Display */}
                            {/* Dollar PnL (user-entered) takes precedence; a percent-only
                                trade (outcome autopilot) renders its leveraged % instead. */}
                            {pnlAmount !== undefined ? (
                                <div className={`flex flex-col items-end px-3 py-1.5 rounded-lg border min-w-[80px] ${pnlAmount >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_-5px_rgba(176, 176, 182,0.2)]' : 'bg-rose-500/10 border-rose-500/20 shadow-[0_0_15px_-5px_rgba(107, 107, 115,0.2)]'}`}>
                                    <span className={`font-mono font-black text-lg leading-none ${pnlAmount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {pnlAmount >= 0 ? '+' : ''}{pnlAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                                    </span>
                                    <span className={`text-[9px] font-bold uppercase tracking-widest opacity-70 ${pnlAmount >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>PnL</span>
                                </div>
                            ) : pnlPercent !== undefined ? (
                                <div className={`flex flex-col items-end px-3 py-1.5 rounded-lg border min-w-[80px] ${pnlPercent >= 0 ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_-5px_rgba(176, 176, 182,0.2)]' : 'bg-rose-500/10 border-rose-500/20 shadow-[0_0_15px_-5px_rgba(107, 107, 115,0.2)]'}`}>
                                    <span className={`font-mono font-black text-lg leading-none ${pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toLocaleString('en-US', { maximumFractionDigits: 1 })}%
                                    </span>
                                    <span className={`text-[9px] font-bold uppercase tracking-widest opacity-70 ${pnlPercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>PnL</span>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>

            {isExpanded && (
                <div className="px-4 pb-4 border-t border-white/5 animate-fade-in bg-zinc-800 rounded-b-xl" onClick={(e) => e.stopPropagation()}>
                    <div className="pt-4">
                        <SetupLifecycleCard analysis={analysis} outcome={outcome} triggeredEntryIndices={trade.triggeredEntryIndices} compact />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs pt-4 font-mono">

                        {/* Trade Settings Row */}
                        <div className="col-span-2 flex items-center justify-between bg-zinc-900 p-2 rounded-lg border border-white/5 mb-1">
                            <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest pl-1">Trade Parameters</span>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-zinc-400">Leverage:</span>
                                <div className="flex items-center bg-zinc-800 rounded border border-white/10 px-2 py-0.5">
                                    <input
                                        type="number"
                                        value={localLeverage}
                                        onChange={(e) => setLocalLeverage(e.target.value)}
                                        onBlur={handleLeverageBlur}
                                        onKeyDown={(e) => e.key === 'Enter' && handleLeverageBlur()}
                                        className="w-8 bg-transparent text-center font-mono font-bold text-cyan-300 outline-none text-xs"
                                    />
                                    <span className="text-zinc-600 text-[10px]">x</span>
                                </div>

                                {/* Preset Buttons */}
                                <div className="flex gap-1 ml-2 pl-2 border-l border-white/10">
                                    {[25, 50, 75, 100].map(val => (
                                        <button
                                            key={val}
                                            onClick={(e) => handlePresetClick(e, val)}
                                            className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${parseInt(localLeverage) === val
                                                ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300 font-bold shadow-[0_0_10px_-3px_rgba(176, 176, 182,0.3)]'
                                                : 'bg-zinc-800 border-white/5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                                                }`}
                                        >
                                            {val}x
                                        </button>
                                    ))}
                                </div>

                                {/* Outcome correction — the only way to fix a
                                    mis-logged WIN/LOSS was delete + re-log. */}
                                {onUpdateOutcome && (
                                    <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-white/10">
                                        <span className="text-[10px] text-zinc-400">Outcome:</span>
                                        <select
                                            value={trade.outcome}
                                            onChange={(e) => onUpdateOutcome(trade.id, e.target.value as TradeOutcome)}
                                            className="bg-zinc-800 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 outline-none focus:border-cyan-500/40 cursor-pointer"
                                            aria-label="Trade outcome"
                                        >
                                            {Object.values(TradeOutcome).map(o => (
                                                <option key={o} value={o}>{o === TradeOutcome.ENTRY_NOT_HIT ? 'NO ENTRY' : o}</option>
                                            ))}
                                        </select>
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
                                            className="px-1.5 py-0.5 rounded bg-cyan-600/80 hover:bg-cyan-600 text-white text-[9px] font-bold uppercase tracking-widest transition-colors"
                                            title="Save PnL"
                                        >
                                            Save
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="p-2.5 bg-zinc-800 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                            <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Entry Zone</span>
                            <span className="text-cyan-200 font-bold text-sm">{(entryPoints || [])[0]?.price || 'N/A'}</span>
                        </div>
                        <div className="p-2.5 bg-zinc-800 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                            <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Stop Loss</span>
                            <div className="flex items-baseline gap-2">
                                <span className="text-rose-300 font-bold text-sm">{stopLoss}</span>
                                {stopLossPercentage && <span className="text-rose-500/60 text-[9px]">{stopLossPercentage}</span>}
                            </div>
                        </div>
                        <div className="col-span-2 p-2.5 bg-zinc-800 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                            <span className="text-[9px] uppercase font-bold text-zinc-500 block mb-1">Take Profit Targets</span>
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

                        {(() => {
                            const rule = extractIfThenRule(postMortem);
                            return rule ? (
                                <div className="col-span-2 bg-zinc-800 border border-zinc-600/40 rounded-lg px-3 py-2">
                                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Rule</span>
                                    <p className="text-xs text-zinc-200 mt-0.5 leading-relaxed">{rule}</p>
                                </div>
                            ) : null;
                        })()}

                        {postMortem && (
                            <div className="col-span-2 mt-2">
                                <button onClick={() => setIsPostMortemVisible(!isPostMortemVisible)} className="text-purple-400 hover:text-purple-300 text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 mb-2 transition-colors">
                                    Post-Mortem Analysis <ChevronDownIcon className={`w-3 h-3 transition-transform ${isPostMortemVisible ? 'rotate-180' : ''}`} />
                                </button>
                                <div className={`collapsible-content ${isPostMortemVisible ? 'expanded' : ''} p-4 bg-purple-900/10 border border-purple-500/20 rounded-lg text-zinc-300 leading-relaxed text-sm font-sans`}>
                                    {postMortem}
                                </div>
                            </div>
                        )}

                        {Array.isArray(postMortemImages) && postMortemImages.length > 0 && (
                            <div className="col-span-2 mt-1">
                                <button onClick={() => setIsScreenshotsVisible(!isScreenshotsVisible)} className="text-zinc-400 hover:text-white text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 mb-2 transition-colors">
                                    Evidence ({postMortemImages.length}) <ChevronDownIcon className={`w-3 h-3 transition-transform ${isScreenshotsVisible ? 'rotate-180' : ''}`} />
                                </button>
                                <div className={`collapsible-content ${isScreenshotsVisible ? 'expanded' : ''} flex gap-2 overflow-x-auto pb-2`}>
                                    {(postMortemImages || []).map((img, i) => (
                                        <img key={i} src={img} className="h-20 w-auto rounded-lg border border-white/10 cursor-pointer hover:border-cyan-500 transition-colors" onClick={() => onViewImage(img)} />
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="col-span-2 text-[9px] text-zinc-600 pt-3 mt-1 border-t border-white/5 flex justify-between uppercase tracking-wider">
                            <span>Analyst: {(() => {
                                // Dynamic provider record first (keyed by provider id),
                                // legacy per-provider fields as read-only fallback for historical rows.
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
                            <ReasoningPanel tradeId={getThinkingTradeId(trade.analysis?.createdAt, trade.id)} outcome={trade.outcome} username={username} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const TradeLogContent: React.FC<TradeLogContentProps> = ({ trades, onDeleteTrades, onClearAllTrades, modelIdToName, onUpdateInsights, isSummarizing, currentInsightIds, onUpdateTradeLeverage, onUpdateOutcome, onUpdatePnL, username }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);

    const handleToggle = (id: string) => {
        setExpandedId(prevId => (prevId === id ? null : id));
    };

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

    // Trade type filter
    const [tradeTypeFilter, setTradeTypeFilter] = useState<'all' | 'scalp' | 'swing'>('all');
    // Outcome filter + free-text search (coin / strategy / post-mortem)
    const [outcomeFilter, setOutcomeFilter] = useState<'all' | TradeOutcome>('all');
    const [searchQuery, setSearchQuery] = useState('');

    const filteredTrades = (trades || []).filter(trade => {
        if (tradeTypeFilter !== 'all') {
            const tt = trade.tradeType || trade.analysis.tradeType;
            if (tradeTypeFilter === 'scalp') return tt === 'scalp';
            if (tradeTypeFilter === 'swing') return tt === 'swing' || !tt; // Legacy trades default to swing
        }
        if (outcomeFilter !== 'all' && trade.outcome !== outcomeFilter) return false;
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            const haystack = [
                trade.analysis?.coinName,
                trade.analysis?.direction,
                (trade.analysis?.activeStrategies || []).join(' '),
                trade.analysis?.strategy,
                trade.tradeType || trade.analysis?.tradeType,
                trade.postMortem,
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        return true;
    });

    const totalTrades = filteredTrades.length;

    return (
        <div className="flex flex-col h-full bg-transparent">
            {/* Filters: search + trade type + outcome */}
            <div className="px-4 py-2 border-b border-white/5 bg-zinc-900 shrink-0 space-y-2">
                <div className="flex items-center gap-2">
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search coin, strategy, post-mortem…"
                        className="flex-1 min-w-0 bg-zinc-800 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/40"
                        aria-label="Search trades"
                    />
                    <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest shrink-0">Filter</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                    {(['all', 'scalp', 'swing'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => setTradeTypeFilter(type)}
                            className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded transition-all border
                                ${tradeTypeFilter === type
                                    ? type === 'scalp'
                                        ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                                        : type === 'swing'
                                            ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                                            : 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
                                    : 'bg-zinc-800 border-white/10 text-zinc-500 hover:text-zinc-300'}`}
                        >
                            {type === 'scalp' ? '◆ ' : type === 'swing' ? '◇ ' : ''}{type}
                        </button>
                    ))}
                    <span className="w-px h-4 bg-white/10 mx-1" />
                    {[TradeOutcome.WIN, TradeOutcome.LOSS, TradeOutcome.ENTRY_NOT_HIT, TradeOutcome.SKIPPED].map(o => (
                        <button
                            key={o}
                            onClick={() => setOutcomeFilter(prev => prev === o ? 'all' : o)}
                            className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded transition-all border ${
                                outcomeFilter === o
                                    ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
                                    : 'bg-zinc-800 border-white/10 text-zinc-500 hover:text-zinc-300'
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
                <div className="px-4 py-1.5 border-b border-white/5 bg-zinc-900/60 shrink-0 flex items-center justify-end">
                    <button
                        type="button"
                        onClick={onClearAllTrades}
                        className="text-[10px] uppercase font-bold tracking-widest text-rose-400/80 hover:text-rose-300 transition-colors flex items-center gap-1.5"
                        title="Delete all logged trades (with 5s undo)"
                    >
                        <TrashIcon className="w-3 h-3" /> Clear all trades
                    </button>
                </div>
            )}

            {/* Optional Action Header */}
            {currentInsightIds.length > 0 && (
                <div className="p-3 border-b border-white/5 bg-zinc-900 shrink-0">
                    <button onClick={handleSelectActiveInsights} className="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 text-cyan-400 text-[10px] font-bold uppercase tracking-widest transition-all">
                        <BrainIcon className="w-3 h-3" /> Select {currentInsightIds.length} Active Memory Trades
                    </button>
                </div>
            )}

            {/* Selected Actions */}
            {selectedIds.length > 0 && (
                <div className="p-4 border-b border-white/5 bg-cyan-900/10 shrink-0 animate-fade-in">
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={handleUpdateInsights}
                            disabled={isSummarizing || newCount === 0}
                            className={`w-full flex items-center justify-center gap-2 font-bold py-3 px-4 rounded-xl transition-all uppercase text-xs tracking-widest shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${duplicateCount > 0 && newCount === 0
                                ? 'bg-zinc-800 border-zinc-700 text-zinc-500'
                                : 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 shadow-cyan-900/20'
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
                        <button onClick={handleDeleteSelected} disabled={isSummarizing} className="w-full flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold py-3 px-4 rounded-xl transition-all uppercase text-xs tracking-widest shadow-lg shadow-rose-900/20 disabled:opacity-50">
                            <TrashIcon /> Delete Selected ({selectedIds.length})
                        </button>
                    </div>
                </div>
            )}

            {/* Trade List - Virtualized */}
            <div className="flex-1 overflow-hidden">
                {totalTrades === 0 ? (
                    <EmptyState
                        icon={<Bookmark className="w-8 h-8" />}
                        title="No trades logged yet"
                        description="Run an analysis and log your first trade to start building your journal."
                        className="h-full"
                    />
                ) : (
                    <Virtuoso
                        style={{ height: '100%' }}
                        data={filteredTrades}
                        itemContent={(index, trade) => (
                            <div className="px-5 py-0.5">
                                <TradeLogRow
                                    key={trade.id}
                                    trade={trade}
                                    onToggle={() => handleToggle(trade.id)}
                                    isExpanded={expandedId === trade.id}
                                    isSelected={selectedIds.includes(trade.id)}
                                    onSelect={handleSelect}
                                    onViewImage={(url) => setViewerImageUrl(url)}
                                    modelIdToName={modelIdToName}
                                    isInsight={currentInsightIds.includes(trade.id)}
                                    onUpdateLeverage={onUpdateTradeLeverage}
                                    onUpdateOutcome={onUpdateOutcome}
                                    onUpdatePnL={onUpdatePnL}
                                    username={username}
                                />
                            </div>
                        )}
                    />
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
