import React, { useState, useEffect } from 'react';
import { Brain, ChevronDown, Download, Loader2, MessageSquare } from 'lucide-react';
import { getThinkingByTrade } from '../../services/infrastructure/ThinkingStoreService';
import { ThinkingRecord } from '../../types/thinking';
import { TradeOutcome } from '../../types';

interface ReasoningPanelProps {
  tradeId: string;
  outcome?: TradeOutcome;
}

const PROVIDER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  gemini: { bg: 'bg-blue-950/20', border: 'border-blue-500/20', text: 'text-blue-400' },
  deepseek: { bg: 'bg-emerald-950/20', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  zhipu: { bg: 'bg-orange-950/20', border: 'border-orange-500/20', text: 'text-orange-400' },
  groq: { bg: 'bg-yellow-950/20', border: 'border-yellow-500/20', text: 'text-yellow-400' },
  moderator: { bg: 'bg-cyan-950/20', border: 'border-cyan-500/20', text: 'text-cyan-400' },
  openrouter: { bg: 'bg-emerald-950/20', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  openai: { bg: 'bg-emerald-950/20', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  grok: { bg: 'bg-zinc-800/20', border: 'border-zinc-500/20', text: 'text-zinc-300' },
};

const getColor = (provider: string) => PROVIDER_COLORS[provider.toLowerCase()] || {
  bg: 'bg-zinc-800/20',
  border: 'border-white/10',
  text: 'text-zinc-400',
};

const OUTCOME_BADGE: Record<string, string> = {
  [TradeOutcome.WIN]: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  [TradeOutcome.LOSS]: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  [TradeOutcome.PENDING]: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  [TradeOutcome.SKIPPED]: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  [TradeOutcome.ENTRY_NOT_HIT]: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

/**
 * Expandable reasoning panel for a trade.
 * Shows per-analyst reasoning, moderator synthesis, and debate turns.
 */
export const ReasoningPanel: React.FC<ReasoningPanelProps> = ({ tradeId, outcome }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [records, setRecords] = useState<ThinkingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isExpanded || records.length > 0) return;
    setIsLoading(true);
    getThinkingByTrade(tradeId)
      .then(data => {
        setRecords(data);
        setIsLoading(false);
      })
      .catch(err => {
        console.warn('[ReasoningPanel] Failed to load:', err);
        setIsLoading(false);
      });
  }, [isExpanded, tradeId]);

  const analysts = records.filter(r => r.role === 'analyst');
  const moderator = records.find(r => r.role === 'moderator');
  const debateTurns = records.filter(r => r.role === 'debate_turn');

  return (
    <div className="border-t border-white/5 mt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 py-2 text-xs font-medium text-zinc-500 hover:text-cyan-400 transition-colors"
        aria-label={isExpanded ? 'Collapse reasoning' : 'Expand reasoning'}
      >
        <Brain className="w-3.5 h-3.5" />
        <span>Model Reasoning ({records.length || '?'} records)</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        {outcome && (
          <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] border ${OUTCOME_BADGE[outcome] || ''}`}>
            {outcome}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="pb-3 space-y-2 animate-fade-in">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Loading reasoning...</span>
            </div>
          ) : records.length === 0 ? (
            <p className="text-xs text-zinc-600 py-2 text-center">
              No reasoning records stored for this trade.
            </p>
          ) : (
            <>
              {/* Analyst reasoning */}
              {analysts.map((record, idx) => {
                const colors = getColor(record.provider);
                return (
                  <div key={record.id} className={`rounded-lg border ${colors.border} ${colors.bg} p-3`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold ${colors.text} uppercase tracking-wider`}>
                        {record.provider}
                        {record.modelName && <span className="ml-2 text-[10px] font-mono text-zinc-500">{record.modelName}</span>}
                      </span>
                      <div className="flex items-center gap-2">
                        {record.confidence && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-zinc-400">{record.confidence}</span>
                        )}
                        {record.probability != null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-zinc-400">{record.probability}%</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">
                      {record.reasoning.slice(0, 500)}
                      {record.reasoning.length > 500 && '...'}
                    </p>
                  </div>
                );
              })}

              {/* Moderator synthesis */}
              {moderator && (
                <div className={`rounded-lg border ${getColor('moderator').border} ${getColor('moderator').bg} p-3`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                      Moderator Synthesis
                      {moderator.modelName && <span className="ml-2 text-[10px] font-mono text-zinc-500">{moderator.modelName}</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      {moderator.confidence && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-zinc-400">{moderator.confidence}</span>
                      )}
                      {moderator.probability != null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-cyan-400">{moderator.probability}%</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">
                    {moderator.reasoning.slice(0, 800)}
                    {moderator.reasoning.length > 800 && '...'}
                  </p>
                </div>
              )}

              {/* Debate turns (collapsible) */}
              {debateTurns.length > 0 && (
                <details className="rounded-lg border border-white/5 bg-black/20 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-300 flex items-center gap-2">
                    <MessageSquare className="w-3 h-3" />
                    Debate Transcript ({debateTurns.length} turns)
                  </summary>
                  <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar">
                    {debateTurns.map((turn, idx) => {
                      const colors = getColor(turn.provider);
                      return (
                        <div key={turn.id} className="text-xs">
                          <span className={`font-bold ${colors.text}`}>{turn.debateTurnSpeaker || turn.provider}:</span>{' '}
                          <span className="text-zinc-500">{turn.reasoning.slice(0, 200)}{turn.reasoning.length > 200 && '...'}</span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ReasoningPanel;
