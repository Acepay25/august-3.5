import React from 'react';
import { Message } from '../../types';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface CompareModalProps {
  primary: Message;
  /** Second analysis chosen by the user (null while picking). */
  secondary: Message | null;
  analysisMessages: Message[];
  modelIdToName: Record<string, string>;
  onPickSecondary: (messageId: string) => void;
  onClose: () => void;
}

const StatRow: React.FC<{ label: string; a: React.ReactNode; b: React.ReactNode }> = ({ label, a, b }) => (
  <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-b border-white/5 py-1.5 text-[11px]">
    <span className="text-zinc-500 uppercase tracking-wider text-[9px] self-center">{label}</span>
    <span className="font-mono text-zinc-200 text-right">{a}</span>
    <span className="font-mono text-zinc-200 text-right">{b}</span>
  </div>
);

const summaryOf = (message: Message, modelIdToName: Record<string, string>) => {
  const a = message.analysis;
  if (!a) return null;
  const modelNames = Object.entries(message.modelsUsed ?? {})
    .map(([, modelId]) => modelIdToName[modelId] ?? modelId)
    .join(', ');
  return {
    direction: a.direction,
    entry: a.entryPoints?.[0]?.price || '—',
    sl: a.stopLoss || '—',
    tp: a.takeProfit?.map(t => t.price).join(' / ') || '—',
    confidence: a.confidence,
    probability: a.probability !== undefined ? `${a.probability}%` : '—',
    grade: a.grade || '—',
    gateCap: a.gateResult?.confidenceCap !== undefined ? `${Math.round(a.gateResult.confidenceCap * 100)}%` : '—',
    mcWinRate: message.runStats?.mcWinRate !== undefined ? `${message.runStats.mcWinRate}%` : '—',
    duration: message.runStats ? `${Math.round(message.runStats.durationMs / 1000)}s` : '—',
    models: modelNames || '—',
    createdAt: new Date(message.createdAt).toLocaleString(),
  };
};

/**
 * Side-by-side comparison of two analysis cards (stat rows only — compact
 * enough to scan direction/levels/confidence/quality side by side).
 */
const CompareModal: React.FC<CompareModalProps> = ({ primary, secondary, analysisMessages, modelIdToName, onPickSecondary, onClose }) => {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeClose(true, onClose);

  const a = summaryOf(primary, modelIdToName);
  const b = secondary ? summaryOf(secondary, modelIdToName) : null;
  if (!a) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Compare analyses" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-cyan-300">Compare analyses</div>
            <div className="text-[10px] text-zinc-500">Side-by-side stat comparison of two trade cards</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white" aria-label="Close">✕</button>
        </div>

        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-b border-white/10 bg-zinc-950/60 px-4 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Metric</span>
          <span className="text-right text-zinc-300">{a.models || `#${primary.id.slice(0, 6)}`}</span>
          <span className="text-right text-zinc-300">{b ? (b.models || `#${secondary?.id.slice(0, 6)}`) : 'Pick a second analysis…'}</span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-4 py-2 custom-scrollbar">
          <StatRow label="Created" a={a.createdAt} b={b?.createdAt ?? '—'} />
          <StatRow label="Direction" a={a.direction} b={b?.direction ?? '—'} />
          <StatRow label="Entry" a={a.entry} b={b?.entry ?? '—'} />
          <StatRow label="Stop loss" a={a.sl} b={b?.sl ?? '—'} />
          <StatRow label="Take profit" a={a.tp} b={b?.tp ?? '—'} />
          <StatRow label="Confidence" a={a.confidence} b={b?.confidence ?? '—'} />
          <StatRow label="Probability" a={a.probability} b={b?.probability ?? '—'} />
          <StatRow label="Grade" a={a.grade} b={b?.grade ?? '—'} />
          <StatRow label="Gate cap" a={a.gateCap} b={b?.gateCap ?? '—'} />
          <StatRow label="MC win rate" a={a.mcWinRate} b={b?.mcWinRate ?? '—'} />
          <StatRow label="Run time" a={a.duration} b={b?.duration ?? '—'} />

          {!secondary && (
            <div className="mt-3">
              <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-500">Pick a second analysis</div>
              <div className="max-h-40 space-y-1 overflow-y-auto custom-scrollbar">
                {analysisMessages
                  .filter(m => m.id !== primary.id && m.analysis)
                  .slice(0, 20)
                  .map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onPickSecondary(m.id)}
                      className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-zinc-950/60 px-3 py-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:border-cyan-400/30 hover:bg-zinc-800"
                    >
                      <span className="truncate">{m.analysis?.direction} {m.analysis?.coinName || ''} · {m.analysis?.confidence}</span>
                      <span className="shrink-0 text-[9px] text-zinc-500">{new Date(m.createdAt).toLocaleString()}</span>
                    </button>
                  ))}
                {analysisMessages.filter(m => m.id !== primary.id && m.analysis).length === 0 && (
                  <div className="py-3 text-center text-[10px] text-zinc-500">No other analyses in this conversation.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(CompareModal);
