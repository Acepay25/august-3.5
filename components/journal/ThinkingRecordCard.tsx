import React, { useState } from 'react';
import { Brain, ChevronDown, MessageSquare } from 'lucide-react';
import { ThinkingRecord } from '../../types/thinking';
import { TradeOutcome } from '../../types';
import ThinkingModal from '../analysis/ThinkingModal';

interface ThinkingRecordCardProps {
  record: ThinkingRecord;
}

const PROVIDER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  gemini: { bg: 'bg-blue-950/20', border: 'border-blue-500/20', text: 'text-blue-400' },
  deepseek: { bg: 'bg-emerald-950/20', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  zhipu: { bg: 'bg-orange-950/20', border: 'border-orange-500/20', text: 'text-orange-400' },
  groq: { bg: 'bg-yellow-950/20', border: 'border-yellow-500/20', text: 'text-yellow-400' },
  moderator: { bg: 'bg-cyan-950/20', border: 'border-cyan-500/20', text: 'text-cyan-400' },
  openrouter: { bg: 'bg-emerald-950/20', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  openai: { bg: 'bg-emerald-950/20', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  grok: { bg: 'bg-zinc-800', border: 'border-zinc-500/20', text: 'text-zinc-300' },
};

export const getProviderColor = (provider: string) => PROVIDER_COLORS[provider.toLowerCase()] || {
  bg: 'bg-zinc-800',
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

const roleLabel = (record: ThinkingRecord): string => {
  if (record.role === 'moderator') return 'Moderator';
  if (record.role === 'debate_turn') return `Debate Turn ${(record.debateTurnIndex ?? 0) + 1}`;
  return 'Analyst';
};

const Section: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen = false }) => (
  <details className="rounded-md border border-white/5 bg-black/20" open={defaultOpen}>
    <summary className="cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 select-none">
      <ChevronDown className="w-3 h-3 transition-transform" />
      {title}
    </summary>
    <div className="px-2.5 pb-2.5 pt-1 text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto custom-scrollbar">
      {children}
    </div>
  </details>
);

/**
 * One model's stored reasoning record: reasoning (CoT), final output, raw
 * streamed chain-of-thought, and the analysis JSON — full text, no truncation.
 */
export const ThinkingRecordCard: React.FC<ThinkingRecordCardProps> = ({ record }) => {
  const colors = getProviderColor(record.provider);
  const isTurn = record.role === 'debate_turn';
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-3`}>
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
        <div className="flex items-center gap-2">
          {isTurn ? (
            <MessageSquare className={`w-3.5 h-3.5 ${colors.text}`} />
          ) : (
            <Brain className={`w-3.5 h-3.5 ${colors.text}`} />
          )}
          <span className={`text-xs font-bold ${colors.text} uppercase tracking-wider`}>
            {roleLabel(record)}
            {!isTurn && record.provider !== 'moderator' && (
              <span className="ml-2 normal-case text-[10px] font-mono text-zinc-500">{record.provider}</span>
            )}
            {record.modelName && <span className="ml-2 text-[10px] font-mono text-zinc-500">{record.modelName}</span>}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {record.confidence && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-zinc-400">{record.confidence}</span>
          )}
          {record.probability != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-zinc-400">{record.probability}%</span>
          )}
          {record.outcome && (
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] border ${OUTCOME_BADGE[record.outcome] || ''}`}>
              {record.outcome}
            </span>
          )}
        </div>
      </div>

      {isTurn && record.debateTurnSpeaker && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">
          {record.debateTurnSpeaker}
        </p>
      )}

      <button type="button" onClick={() => setIsModalOpen(true)} className="mt-3 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition-colors hover:border-cyan-400/30 hover:bg-zinc-800 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" aria-haspopup="dialog">
        <span>View full thinking</span>
        <span aria-hidden="true">Open →</span>
      </button>

      <ThinkingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${roleLabel(record)}${record.provider !== 'moderator' ? ` · ${record.provider}` : ''}`}
        subtitle={record.modelName || (record.outcome ? `Outcome: ${record.outcome}` : undefined)}
      >
        <div className="space-y-2">
          {record.reasoning && <Section title={isTurn ? 'Turn Text' : 'Reasoning (CoT)'}>{record.reasoning}</Section>}
          {record.finalOutput && <Section title="Final Output">{record.finalOutput}</Section>}
          {record.rawReasoning && <Section title="Raw Chain-of-Thought">{record.rawReasoning}</Section>}
          {record.analysisJson && <Section title="Analysis JSON">{(() => { try { return JSON.stringify(JSON.parse(record.analysisJson), null, 2); } catch { return record.analysisJson; } })()}</Section>}
          {!record.reasoning && !record.finalOutput && !record.rawReasoning && !record.analysisJson && <p className="text-sm italic text-zinc-600">No detailed thinking was stored for this analyst.</p>}
        </div>
      </ThinkingModal>
    </div>
  );
};

export default ThinkingRecordCard;
