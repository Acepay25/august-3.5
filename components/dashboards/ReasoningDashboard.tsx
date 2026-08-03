import React, { useState, useEffect } from 'react';
import { Brain, Download, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { getProviderReasoningStats, getAllThinkingForExport } from '../../services/infrastructure/ThinkingStoreService';
import { ThinkingRecordStats } from '../../types/thinking';

interface ReasoningDashboardProps {
  username: string;
  onClose?: () => void;
}

/**
 * Reasoning Analytics Dashboard
 *
 * Shows per-provider reasoning statistics:
 * - Total analyses per provider
 * - Win/loss rate per provider
 * - Average predicted probability vs actual win rate (calibration)
 * - Export button to download JSONL training data
 */
export const ReasoningDashboard: React.FC<ReasoningDashboardProps> = ({ username }) => {
  const [stats, setStats] = useState<ThinkingRecordStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    getProviderReasoningStats(username)
      .then(data => {
        setStats(data);
        setIsLoading(false);
      })
      .catch(err => {
        console.warn('[ReasoningDashboard] Failed to load stats:', err);
        setIsLoading(false);
      });
  }, [username]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const records = await getAllThinkingForExport(username);
      // Build JSONL (one JSON object per line — standard format for LLM fine-tuning)
      const jsonl = records
        .map(r => JSON.stringify({
          provider: r.provider,
          model: r.modelName,
          role: r.role,
          reasoning: r.reasoning,
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
      ) : stats.length === 0 ? (
        <div className="text-center py-12">
          <Brain className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No reasoning data yet</p>
          <p className="text-xs text-zinc-600 mt-1">Run analyses to start building your training dataset</p>
        </div>
      ) : (
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
      )}

      {/* Export info */}
      {totalRecords > 0 && (
        <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-xl p-3">
          <p className="text-xs text-cyan-300/80 leading-relaxed">
            <strong>Export JSONL</strong> downloads all reasoning records in JSON Lines format —
            one record per line. Each record contains the provider, model, reasoning text,
            analysis JSON, confidence, and outcome. This is the standard format for LLM
            fine-tuning datasets.
          </p>
        </div>
      )}
    </div>
  );
};

export default ReasoningDashboard;
