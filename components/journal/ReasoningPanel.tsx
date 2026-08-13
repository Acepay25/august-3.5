import React, { useState, useEffect } from 'react';
import { Brain, ChevronDown, Loader2, MessageSquare } from 'lucide-react';
import { getThinkingByTrade } from '../../services/infrastructure/ThinkingStoreService';
import { ThinkingRecord } from '../../types/thinking';
import { TradeOutcome } from '../../types';
import { ThinkingRecordCard, getProviderColor } from './ThinkingRecordCard';
import { ANALYST_LENS_LABEL, ANALYST_LENS_ORDER, resolveAnalystLens } from '../../utils/thinkingLens';

interface ReasoningPanelProps {
  tradeId: string;
  outcome?: TradeOutcome;
  /** Scopes the record lookup to a user (tradeId keys are timestamp-derived). */
  username?: string;
}

const OUTCOME_BADGE: Record<string, string> = {
  [TradeOutcome.WIN]: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  [TradeOutcome.LOSS]: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  [TradeOutcome.PENDING]: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  [TradeOutcome.SKIPPED]: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  [TradeOutcome.ENTRY_NOT_HIT]: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

/**
 * Expandable reasoning panel for a trade (History tab).
 * Shows per-analyst reasoning + final output, moderator synthesis, and debate turns.
 */
export const ReasoningPanel: React.FC<ReasoningPanelProps> = ({ tradeId, outcome, username }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [records, setRecords] = useState<ThinkingRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isExpanded || records.length > 0) return;
    setIsLoading(true);
    getThinkingByTrade(tradeId, username)
      .then(data => {
        setRecords(data);
        setIsLoading(false);
      })
      .catch(err => {
        console.warn('[ReasoningPanel] Failed to load:', err);
        setIsLoading(false);
      });
  }, [isExpanded, tradeId, username]);

  const analysts = records.filter(r => r.role === 'analyst');
  const moderator = records.find(r => r.role === 'moderator');
  const debateTurns = records.filter(r => r.role === 'debate_turn');

  const byLens = ANALYST_LENS_ORDER
    .map(lens => ({
      lens,
      items: analysts.filter(r => resolveAnalystLens(r) === lens),
    }))
    .filter(group => group.items.length > 0);

  return (
    <div className="border-t border-zinc-800 mt-4 pt-1">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 py-3 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors"
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
              {byLens.map(group => (
                <div key={group.lens} className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 px-0.5">
                    {ANALYST_LENS_LABEL[group.lens]}
                  </p>
                  {group.items.map(record => (
                    <ThinkingRecordCard key={record.id} record={record} />
                  ))}
                </div>
              ))}

              {/* Moderator synthesis */}
              {moderator && (
                <ThinkingRecordCard key={moderator.id} record={moderator} />
              )}

              {/* Debate turns (collapsible) */}
              {debateTurns.length > 0 && (
                <details className="rounded-lg border border-white/5 bg-zinc-800 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-300 flex items-center gap-2">
                    <MessageSquare className="w-3 h-3" />
                    Debate Transcript ({debateTurns.length} turns)
                  </summary>
                  <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar">
                    {debateTurns.map((turn, idx) => {
                      const colors = getProviderColor(turn.provider);
                      return (
                        <div key={turn.id} className="text-xs">
                          <span className={`font-bold ${colors.text}`}>{turn.debateTurnSpeaker || turn.provider}:</span>{' '}
                          <span className="text-zinc-500">{(turn.finalOutput || turn.reasoning).slice(0, 200)}{(turn.finalOutput || turn.reasoning).length > 200 && '...'}</span>
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
