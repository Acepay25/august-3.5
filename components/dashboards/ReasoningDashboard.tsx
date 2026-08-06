import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Brain, ChevronDown, ChevronRight, Download, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { getProviderReasoningStats, getAllThinkingForExport, getThinkingByTrade, getThinkingTrades } from '../../services/infrastructure/ThinkingStoreService';
import { ThinkingRecordStats, ThinkingTradeSummary, ThinkingRecord } from '../../types/thinking';
import { ThinkingRecordCard } from '../journal/ThinkingRecordCard';

interface ReasoningDashboardProps {
  username: string;
  /** Deep link: auto-select this analysis run when the dashboard opens. */
  initialTradeId?: string;
  /** Called after the deep-linked trade has been consumed. */
  onInitialTradeConsumed?: () => void;
  onClose?: () => void;
}

/**
 * Reasoning Analytics Dashboard (Trading Journal → Think tab)
 *
 * Two sections:
 * 1. Per-provider reasoning statistics (win/loss rate, calibration) +
 *    JSONL training-data export.
 * 2. Per-Trade Reasoning browser — one entry per analysis run (card
 *    prediction), expandable to the full reasoning, final output, raw
 *    chain-of-thought and analysis JSON of every model in the debate.
 */
export const ReasoningDashboard: React.FC<ReasoningDashboardProps> = ({ username, initialTradeId, onInitialTradeConsumed }) => {
  const [stats, setStats] = useState<ThinkingRecordStats[]>([]);
  const [trades, setTrades] = useState<ThinkingTradeSummary[]>([]);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [records, setRecords] = useState<ThinkingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Deep link is consumed once per target — a new initialTradeId re-triggers
  // it, but App re-renders (new callback identity every render) must not.
  const lastConsumedInitialTradeId = useRef<string | null>(null);

  // Load stats + trade list. `onInitialTradeConsumed` is deliberately absent
  // from the deps: it is an inline arrow in App that changes identity on
  // every render, which would refire this effect (and re-query the store)
  // on each App re-render while the tab is open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statsData, tradesData] = await Promise.all([
          getProviderReasoningStats(username),
          getThinkingTrades(username),
        ]);
        if (cancelled) return;
        setStats(statsData);
        setTrades(tradesData);
        setIsLoading(false);
      } catch (err) {
        console.warn('[ReasoningDashboard] Failed to load reasoning data:', err);
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  // Deep link: auto-select the requested analysis run. The trade may or may
  // not appear in the grouped list (records exist either way) — select it
  // regardless, then notify the caller once.
  useEffect(() => {
    if (!initialTradeId || lastConsumedInitialTradeId.current === initialTradeId) return;
    lastConsumedInitialTradeId.current = initialTradeId;
    let cancelled = false;
    (async () => {
      try {
        const deepRecords = await getThinkingByTrade(initialTradeId, username);
        if (cancelled) return;
        setSelectedTradeId(initialTradeId);
        setRecords(deepRecords);
        onInitialTradeConsumed?.();
      } catch (err) {
        console.warn('[ReasoningDashboard] Failed to load deep-linked reasoning:', err);
        if (!cancelled) onInitialTradeConsumed?.();
      }
    })();
    return () => { cancelled = true; };
  }, [initialTradeId, onInitialTradeConsumed]);

  const handleSelectTrade = useCallback(async (tradeId: string) => {
    setSelectedTradeId(tradeId);
    setIsLoadingRecords(true);
    try {
      const tradeRecords = await getThinkingByTrade(tradeId, username);
      setRecords(tradeRecords);
    } catch (err) {
      console.warn('[ReasoningDashboard] Failed to load records:', err);
      setRecords([]);
    } finally {
      setIsLoadingRecords(false);
    }
  }, [username]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const recordsToExport = await getAllThinkingForExport(username);
      // Build JSONL (one JSON object per line — standard format for LLM fine-tuning)
      const jsonl = recordsToExport
        .map(r => JSON.stringify({
          provider: r.provider,
          model: r.modelName,
          role: r.role,
          reasoning: r.reasoning,
          finalOutput: r.finalOutput,
          rawReasoning: r.rawReasoning,
          messageId: r.messageId,
          analysis: r.analysis,
          confidence: r.confidence,
          probability: r.probability,
          outcome: r.outcome,
          tradeId: r.tradeId,
          createdAt: r.createdAt,
        }))
        .join('\n');

      // Download as file
      const blob = new Blob([jsonl], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `august-reasoning-${new Date().toISOString().slice(0, 10)}.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ReasoningDashboard] Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const totalRecords = stats.reduce((sum, s) => sum + s.total, 0);
  const totalWins = stats.reduce((sum, s) => sum + s.wins, 0);
  const totalLosses = stats.reduce((sum, s) => sum + s.losses, 0);
  const overallWinRate = totalWins + totalLosses > 0
    ? Math.round((totalWins / (totalWins + totalLosses)) * 1000) / 10
    : 0;

  const selectedTrade = trades.find(t => t.tradeId === selectedTradeId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
            <Brain className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Reasoning Analytics</h2>
            <p className="text-xs text-zinc-500">{totalRecords} reasoning records across {stats.length} providers</p>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={isExporting || totalRecords === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Export reasoning data as JSONL"
        >
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {isExporting ? 'Exporting...' : 'Export JSONL'}
        </button>
      </div>

      {/* Overall stats */}
      {totalRecords > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-800 border border-white/5 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-white">{totalRecords}</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-1">Total Records</p>
          </div>
          <div className="bg-zinc-800 border border-white/5 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{totalWins}</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-1">Wins</p>
          </div>
          <div className="bg-zinc-800 border border-white/5 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-rose-400">{totalLosses}</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-1">Losses</p>
          </div>
        </div>
      )}

      {/* Per-provider breakdown */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      ) : stats.length > 0 ? (
        <div className="space-y-2">
          {stats.map(stat => (
            <div key={stat.provider} className="bg-zinc-800 border border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-white capitalize">{stat.provider}</span>
                <span className="text-xs text-zinc-500">{stat.total} analyses</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-emerald-400">{stat.wins}</p>
                  <p className="text-[9px] text-zinc-600 uppercase">Wins</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-rose-400">{stat.losses}</p>
                  <p className="text-[9px] text-zinc-600 uppercase">Losses</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-cyan-400">{stat.avgProbability.toFixed(0)}%</p>
                  <p className="text-[9px] text-zinc-600 uppercase">Avg Prob</p>
                </div>
                <div>
                  <p className={`text-lg font-bold ${stat.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {stat.winRate > 0 ? `${stat.winRate}%` : '—'}
                  </p>
                  <p className="text-[9px] text-zinc-600 uppercase">Win Rate</p>
                </div>
              </div>
              {/* Calibration indicator */}
              {stat.winRate > 0 && stat.avgProbability > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                  {stat.winRate > stat.avgProbability ? (
                    <><TrendingUp className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Underconfident (actual {stat.winRate}% vs predicted {stat.avgProbability.toFixed(0)}%)</span></>
                  ) : (
                    <><TrendingDown className="w-3 h-3 text-rose-400" /><span className="text-rose-400">Overconfident (actual {stat.winRate}% vs predicted {stat.avgProbability.toFixed(0)}%)</span></>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {/* Export info */}
      {totalRecords > 0 && (
        <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-xl p-3">
          <p className="text-xs text-cyan-300/80 leading-relaxed">
            <strong>Export JSONL</strong> downloads all reasoning records in JSON Lines format —
            one record per line. Each record contains the provider, model, reasoning text,
            final output, raw chain-of-thought, analysis JSON, confidence, and outcome. This
            is the standard format for LLM fine-tuning datasets.
          </p>
        </div>
      )}

      {/* ============ PER-TRADE REASONING BROWSER ============ */}
      <div className="bg-zinc-800/60 border border-white/5 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Per-Trade Reasoning</h3>
            <span className="text-[10px] text-zinc-500">one entry per analysis card — every model's CoT + final output</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : trades.length === 0 ? (
          <div className="text-center py-8">
            <Brain className="w-10 h-10 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">No reasoning records yet</p>
            <p className="text-xs text-zinc-600 mt-1">Run an ensemble analysis to build your training dataset</p>
          </div>
        ) : (
          <>
            {/* Trade list */}
            <div className="divide-y divide-white/5 max-h-64 overflow-y-auto custom-scrollbar">
              {trades.map(trade => {
                const isSelected = trade.tradeId === selectedTradeId;
                const date = trade.createdAt ? new Date(trade.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
                return (
                  <button
                    key={trade.tradeId}
                    onClick={() => handleSelectTrade(trade.tradeId)}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors ${isSelected ? 'bg-cyan-500/10' : 'hover:bg-white/5'}`}
                  >
                    {isSelected ? <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-zinc-300 truncate font-mono">{trade.tradeId}</p>
                      <p className="text-[10px] text-zinc-500">{date} · {trade.recordCount} records</p>
                    </div>
                    {trade.outcome && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] border shrink-0 ${
                        trade.outcome === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : trade.outcome === 'LOSS' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                      }`}>
                        {trade.outcome}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected trade detail */}
            {selectedTradeId && (
              <div className="p-3 border-t border-white/5 space-y-2 bg-zinc-900/50">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    {selectedTrade ? 'Full reasoning for this analysis' : 'Reasoning for this analysis'}
                  </p>
                  <span className="text-[10px] text-zinc-600 font-mono">{selectedTradeId}</span>
                </div>
                {isLoadingRecords ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-zinc-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Loading reasoning...</span>
                  </div>
                ) : records.length === 0 ? (
                  <p className="text-xs text-zinc-600 py-2 text-center">No reasoning records stored for this trade.</p>
                ) : (
                  records.map(record => (
                    <ThinkingRecordCard key={record.id} record={record} />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ReasoningDashboard;
