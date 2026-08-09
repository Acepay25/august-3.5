import React, { useState } from 'react';
import { AnalystConsensus, TradeAnalysis } from '../../types';

interface ConsensusPanelProps {
  /** Per-analyst calls + pre-debate divergence, attached by the pipeline. */
  consensus: AnalystConsensus;
  /** The final (moderator) analysis this panel audits. */
  verdict: TradeAnalysis;
}

const DIVERGENCE_LABELS: Record<AnalystConsensus['divergence']['divergenceType'], string> = {
  none: 'Aligned',
  direction: 'Direction split',
  confidence: 'Confidence spread',
  entry: 'Entry divergence',
  multiple: 'Multiple disagreements',
};

/**
 * Consensus explainability panel — audits the ensemble verdict against its
 * own inputs: each analyst's direction/entry/SL/TP/confidence/probability
 * vs the moderator's call, plus the pre-debate divergence score and echo
 * chamber flag. Rendered from persisted data, so it also works on historical
 * cards and in the journal.
 */
const ConsensusPanel: React.FC<ConsensusPanelProps> = ({ consensus, verdict }) => {
  const [isOpen, setIsOpen] = useState(true);
  const { entries, divergence } = consensus;
  if (!entries.length) return null;

  const verdictRow = {
    key: '__verdict__',
    displayName: 'VERDICT',
    direction: verdict.direction,
    entry: verdict.entryPoints?.[0]?.price ? String(verdict.entryPoints[0].price) : undefined,
    stopLoss: verdict.stopLoss || undefined,
    takeProfit: verdict.takeProfit?.[0]?.price ? String(verdict.takeProfit[0].price) : undefined,
    confidence: verdict.confidence,
    probability: typeof verdict.probability === 'number' ? verdict.probability : undefined,
  };

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-zinc-900/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">
          Consensus Breakdown
        </span>
        <span className="flex items-center gap-2">
          {divergence.isEchoChamber && (
            <span className="status-surface rounded px-1.5 py-0.5 text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 uppercase tracking-wide">
              Echo chamber
            </span>
          )}
          <span className="text-[10px] text-zinc-400">
            Divergence {divergence.score}/100 · {DIVERGENCE_LABELS[divergence.divergenceType]}
          </span>
          <span className={`text-zinc-500 transition-transform ${isOpen ? '' : 'rotate-180'}`}>▾</span>
        </span>
      </button>

      {isOpen && (
        <div className="px-3 pb-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[10px] border-collapse">
              <thead>
                <tr className="text-zinc-500 uppercase tracking-wide text-[9px]">
                  <th className="py-1 pr-2 font-semibold">Analyst</th>
                  <th className="py-1 pr-2 font-semibold">Dir</th>
                  <th className="py-1 pr-2 font-semibold">Entry</th>
                  <th className="py-1 pr-2 font-semibold">SL</th>
                  <th className="py-1 pr-2 font-semibold">TP</th>
                  <th className="py-1 pr-2 font-semibold">Conf</th>
                  <th className="py-1 font-semibold">Prob</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.providerId} className="border-t border-white/5 text-zinc-300">
                    <td className="py-1 pr-2 whitespace-nowrap max-w-[140px] truncate" title={e.displayName}>{e.displayName}</td>
                    <td className="py-1 pr-2">{e.direction ?? '—'}</td>
                    <td className="py-1 pr-2">{e.entry ?? '—'}</td>
                    <td className="py-1 pr-2">{e.stopLoss ?? '—'}</td>
                    <td className="py-1 pr-2">{e.takeProfit ?? '—'}</td>
                    <td className="py-1 pr-2">{e.confidence ?? '—'}</td>
                    <td className="py-1">{typeof e.probability === 'number' ? `${e.probability}%` : '—'}</td>
                  </tr>
                ))}
                <tr className="border-t border-white/10 bg-zinc-800/60 text-zinc-100">
                  <td className="py-1 pr-2 font-bold">{verdictRow.displayName}</td>
                  <td className="py-1 pr-2 font-semibold">{verdictRow.direction ?? '—'}</td>
                  <td className="py-1 pr-2">{verdictRow.entry ?? '—'}</td>
                  <td className="py-1 pr-2">{verdictRow.stopLoss ?? '—'}</td>
                  <td className="py-1 pr-2">{verdictRow.takeProfit ?? '—'}</td>
                  <td className="py-1 pr-2">{verdictRow.confidence ?? '—'}</td>
                  <td className="py-1">{typeof verdictRow.probability === 'number' ? `${verdictRow.probability}%` : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {divergence.details.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {divergence.details.map((detail, i) => (
                <li key={i} className="text-[10px] text-zinc-500 leading-relaxed">{detail}</li>
              ))}
            </ul>
          )}
          {divergence.isEchoChamber && (
            <p className="mt-2 status-surface text-[10px] text-amber-400/90 leading-relaxed">
              All analysts converged with minimal disagreement — the debate ran a synthetic
              devil's advocate round to stress-test the consensus before the verdict.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ConsensusPanel;
