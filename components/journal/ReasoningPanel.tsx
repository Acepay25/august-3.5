import React, { useState, useEffect } from 'react';
import { Brain, ChevronDown, Loader2 } from '../shared/Icons';
import { getThinkingByTrade } from '../../services/infrastructure/ThinkingStoreService';
import { ThinkingRecord } from '../../types/thinking';
import { TradeOutcome } from '../../types';
import { ThinkingRecordCard } from './ThinkingRecordCard';

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
 *
 * One flat list of the records that answered, then the moderator synthesis.
 * The Macro / Technical / Risk buckets went with the analyst-role removal: a
 * historical record may still carry a lens label, but nothing groups by it.
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

  return (
    <div className="border-t border-zinc-800 mt-4 pt-1">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 py-3 text-ui-base font-medium text-zinc-400 hover:text-zinc-100 transition-colors"
        aria-label={isExpanded ? 'Collapse reasoning' : 'Expand reasoning'}
      >
        <Brain className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Model Reasoning ({records.length || '?'} records)</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        {outcome && (
          <span className={`ml-auto px-2 py-0.5 rounded-full text-ui-xs border ${OUTCOME_BADGE[outcome] || ''}`}>
            {outcome}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="pb-3 space-y-2 animate-fade-in">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span className="text-ui-sm">Loading reasoning...</span>
            </div>
          ) : records.length === 0 ? (
            <p className="text-ui-sm text-zinc-600 py-2 text-center">
              No reasoning records stored for this trade.
            </p>
          ) : (
            <>
              {analysts.map(record => (
                <ThinkingRecordCard key={record.id} record={record} />
              ))}
              {moderator && <ThinkingRecordCard key={moderator.id} record={moderator} />}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ReasoningPanel;
