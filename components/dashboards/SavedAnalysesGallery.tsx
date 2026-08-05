import React, { useMemo, useState } from 'react';
import { SavedAnalysis } from '../../types';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface SavedAnalysesGalleryProps {
  savedAnalyses: SavedAnalysis[];
  modelIdToName: Record<string, string>;
  /** Scrolls the main chat to the original message (if it still exists). */
  onLocateMessage?: (messageId: string) => void;
  onClose: () => void;
}

const DirectionFilter: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const options = ['All', 'Long', 'Short', 'Neutral'];
  return (
    <div className="flex gap-1">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
            value === opt ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-300' : 'border border-white/10 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
};

/**
 * Filterable gallery of saved analyses — search by symbol/prompt, filter by
 * direction, expand a saved plan's stat summary, or locate it in the chat.
 */
const SavedAnalysesGallery: React.FC<SavedAnalysesGalleryProps> = ({ savedAnalyses, modelIdToName, onLocateMessage, onClose }) => {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  useEscapeClose(true, onClose);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...savedAnalyses]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .filter(sa => direction === 'All' || sa.analysis.direction === direction)
      .filter(sa => {
        if (!q) return true;
        const coin = (sa.analysis.coinName || '').toLowerCase();
        const prompt = (sa.userPrompt || '').toLowerCase();
        return coin.includes(q) || prompt.includes(q);
      });
  }, [savedAnalyses, query, direction]);

  const modelsLabel = (sa: SavedAnalysis): string =>
    Object.values(sa.modelsUsed ?? {}).map(m => modelIdToName[m] ?? m).join(', ') || '—';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Saved analyses" className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-cyan-300">Saved analyses</div>
            <div className="text-[10px] text-zinc-500">{savedAnalyses.length} saved · click a row to expand</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white" aria-label="Close">✕</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol or prompt…"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400/40"
          />
          <DirectionFilter value={direction} onChange={setDirection} />
        </div>

        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
          {filtered.length === 0 && (
            <div className="py-10 text-center text-xs text-zinc-500">
              {savedAnalyses.length === 0 ? 'Nothing saved yet — use "Save" on a trade card.' : 'No saved analyses match the current filters.'}
            </div>
          )}
          {filtered.map(sa => {
            const a = sa.analysis;
            const expanded = expandedId === sa.id;
            return (
              <div key={sa.id} className="mb-1.5 overflow-hidden rounded-xl border border-white/5 bg-zinc-950/60">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : sa.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/60"
                >
                  <span className={`text-[10px] font-black uppercase tracking-wider ${a.direction === 'Long' ? 'text-emerald-400' : a.direction === 'Short' ? 'text-rose-400' : 'text-zinc-400'}`}>{a.direction}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-zinc-200">{a.coinName || 'Unknown asset'}</span>
                    <span className="block truncate text-[10px] text-zinc-500">{sa.userPrompt || modelsLabel(sa)}</span>
                  </span>
                  <span className="shrink-0 text-[9px] text-zinc-500">{new Date(sa.timestamp).toLocaleString()}</span>
                  <span className="shrink-0 text-[9px] text-zinc-500">{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && (
                  <div className="border-t border-white/5 px-3 py-2">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                      <span className="text-zinc-500">Entry</span><span className="font-mono text-zinc-200 text-right">{a.entryPoints?.[0]?.price || '—'}</span>
                      <span className="text-zinc-500">Stop loss</span><span className="font-mono text-zinc-200 text-right">{a.stopLoss || '—'}</span>
                      <span className="text-zinc-500">Take profit</span><span className="font-mono text-zinc-200 text-right">{a.takeProfit?.map(t => t.price).join(' / ') || '—'}</span>
                      <span className="text-zinc-500">Confidence</span><span className="font-mono text-zinc-200 text-right">{a.confidence}{a.probability !== undefined ? ` · ${a.probability}%` : ''}</span>
                      <span className="text-zinc-500">Grade</span><span className="font-mono text-zinc-200 text-right">{a.grade || '—'}</span>
                      <span className="text-zinc-500">Models</span><span className="text-zinc-200 text-right truncate">{modelsLabel(sa)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[9px] italic text-zinc-600">“{sa.userPrompt || '—'}”</span>
                      {onLocateMessage && (
                        <button
                          type="button"
                          onClick={() => onLocateMessage(sa.id)}
                          className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
                        >
                          Locate in chat
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default React.memo(SavedAnalysesGallery);
