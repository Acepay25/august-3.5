
import React, { useState, useMemo, useCallback } from 'react';
import { Bookmark, ChevronDownIcon, SearchIcon, TrashIcon } from '../shared/Icons';
import { SavedAnalysis } from '../../types';

import { EmptyState } from '../ui/EmptyState';

interface SavedAnalysesProps {
  analyses: SavedAnalysis[];
  onDelete: (ids: string[]) => void;
  onClearAll: () => void;
  modelIdToName: Record<string, string>;
  ocrModelIdToName: Record<string, string>;
  /** Scrolls the originating analysis into view on the Trade surface. The
   *  saved id IS the message id. Absent ⇒ the Locate action does not render. */
  onLocateMessage?: (messageId: string) => void;
}

// Memoized row. The toggle handler takes the id (rather than closing over it
// per row) so the prop identity stays stable across parent re-renders — an
// inline arrow would rebuild on every render and defeat the memo.
const SavedAnalysisRowImpl: React.FC<{
  item: SavedAnalysis;
  onToggle: (id: string) => void;
  isExpanded: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onLocate?: (id: string) => void;
  modelIdToName: Record<string, string>;
  ocrModelIdToName: Record<string, string>;
}> = ({ item, onToggle, isExpanded, isSelected, onSelect, onLocate, modelIdToName, ocrModelIdToName }) => {
  const { analysis, timestamp, userPrompt, modelsUsed, geminiModelUsed, deepseekModelUsed, zhipuModelUsed, ocrModelUsed, moderatorProvider, moderatorModel } = item;
  const { direction, entryPoints, stopLoss, takeProfit, activeStrategies, coinName } = analysis;
  const safeDirection = direction || 'Neutral';

  return (
    <div className={`bg-zinc-950 rounded-lg border ${isSelected ? 'border-cyan-500' : 'border-white/10'}`}>
      <div className="flex items-center p-3 cursor-pointer" onClick={() => onToggle(item.id)}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(item.id)}
          onClick={(e) => e.stopPropagation()}
          className="form-checkbox h-5 w-5 bg-zinc-900 border-white/10 text-cyan-600 focus-visible:ring-cyan-500 rounded cursor-pointer flex-shrink-0"
          aria-label={`Select ${coinName || 'analysis'} for deletion`}
        />
        <div className="flex-1 min-w-0 ml-4">
          <div className="flex items-center gap-3">
            <span className={`font-bold ${safeDirection === 'Long' ? 'text-emerald-400' : safeDirection === 'Short' ? 'text-rose-400' : 'text-zinc-400'}`}>{safeDirection}</span>
            <span className="font-mono text-sm font-bold text-zinc-300">{coinName}</span>
            <span className="text-zinc-300 truncate hidden sm:block">{(activeStrategies || []).join(', ')}</span>
          </div>
          <p className="text-sm text-zinc-300 mt-1 truncate">Prompt: "{userPrompt}"</p>
          <p className="text-xs text-zinc-500 mt-1">{new Date(timestamp).toLocaleString()}</p>
        </div>
        {onLocate && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onLocate(item.id); }}
            className="mr-2 shrink-0 rounded-md border border-white/10 px-2 py-1 text-ui-xs text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-200"
            aria-label={`Locate ${coinName || 'analysis'} in the chat`}
          >
            Locate
          </button>
        )}
        <ChevronDownIcon className={`w-5 h-5 text-zinc-400 transform transition-transform duration-[150ms] ease-[var(--ease-snappy)] ${isExpanded ? 'rotate-180' : ''}`} />
      </div>
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-white/10 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm pt-3">
            <div>
              <strong className="text-zinc-400 block mb-1">Entry:</strong>
              <p className="font-mono text-cyan-300">{(entryPoints || [])[0]?.price}</p>
            </div>
            <div>
              <strong className="text-zinc-400 block mb-1">Stop Loss:</strong>
              <p className="font-mono text-rose-400">{stopLoss}</p>
            </div>
            <div className="md:col-span-2">
              <strong className="text-zinc-400 block mb-1">Take Profit Targets:</strong>
              <div className="flex flex-col gap-2">
                {(takeProfit || []).map((tp, i) => (
                  <div key={i} className="flex items-center justify-between font-mono text-emerald-400 bg-zinc-900 p-2 rounded-md border border-white/5">
                    <span>{tp.price}</span>
                    <div className="flex items-center gap-2 text-xs">
                      {tp.percentage && <span className="text-cyan-300 bg-cyan-900/50 px-2 py-0.5 rounded-md">{tp.percentage}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 mt-2 pt-3 border-t border-white/5">
              <h4 className="font-semibold text-cyan-400 mb-2">Original User Prompt</h4>
              <p className="italic text-zinc-300">"{userPrompt}"</p>
            </div>
            <div className="md:col-span-2 mt-2 pt-3 border-t border-white/5 text-xs text-zinc-500 flex flex-col sm:flex-row sm:items-center sm:flex-wrap sm:gap-x-4 sm:gap-y-1">
              {modelsUsed && Object.keys(modelsUsed).length > 0 ? (
                Object.entries(modelsUsed).map(([providerId, modelId]) => (
                  <span key={providerId} className="mt-1 sm:mt-0"><strong className="font-semibold">{providerId}:</strong> {modelIdToName[modelId] || modelId}</span>
                ))
              ) : (
                <>
                  {geminiModelUsed && <span><strong className="font-semibold">Gemini Analyst:</strong> {modelIdToName[geminiModelUsed] || geminiModelUsed}</span>}
                  {deepseekModelUsed && <span className="mt-1 sm:mt-0"><strong className="font-semibold">DeepSeek Analyst:</strong> {modelIdToName[deepseekModelUsed] || deepseekModelUsed}</span>}
                  {zhipuModelUsed && <span className="mt-1 sm:mt-0"><strong className="font-semibold">Zhipu Analyst:</strong> {modelIdToName[zhipuModelUsed] || zhipuModelUsed}</span>}
                </>
              )}
              {ocrModelUsed && <span className="mt-1 sm:mt-0"><strong className="font-semibold">Vision:</strong> {ocrModelIdToName[ocrModelUsed] || ocrModelUsed}</span>}
              {moderatorModel && (
                <span className="mt-1 sm:mt-0">
                  <strong className="font-semibold text-cyan-400/80">Moderator:</strong> {modelIdToName[moderatorModel] || moderatorModel}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SavedAnalysisRow = React.memo(SavedAnalysisRowImpl);

/**
 * Saved analyses, embedded. Stage 3: this was a right-sheet overlay whose
 * only opener was the command palette, and the Analysis Gallery was a second
 * browser over the same store whose only opener was the same palette. The
 * Journal's "Saved" tab is now the ONE home, and it absorbed the gallery's
 * search + direction filter + Locate alongside the archive's delete/clear.
 */
const SavedAnalyses: React.FC<SavedAnalysesProps> = ({ analyses, onDelete, onClearAll, modelIdToName, ocrModelIdToName, onLocateMessage }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...analyses]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .filter(sa => direction === 'All' || sa.analysis.direction === direction)
      .filter(sa => {
        if (!q) return true;
        const coin = (sa.analysis.coinName || '').toLowerCase();
        const prompt = (sa.userPrompt || '').toLowerCase();
        return coin.includes(q) || prompt.includes(q);
      });
  }, [analyses, query, direction]);

  const handleToggle = useCallback((id: string) => {
    setExpandedId(prevId => (prevId === id ? null : id));
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(tradeId => tradeId !== id) : [...prev, id]
    );
  }, []);

  const handleDeleteSelected = () => {
    if (selectedIds.length > 0) {
      onDelete(selectedIds);
      setSelectedIds([]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search symbol or prompt…"
            aria-label="Search saved analyses"
            className="w-full rounded-control border border-white/10 bg-zinc-950/70 py-1.5 pl-8 pr-2 text-ui-dense text-zinc-200 outline-none placeholder:text-zinc-600 transition-colors focus:border-white/25"
          />
        </div>
        <div className="flex gap-1">
          {['All', 'Long', 'Short', 'Neutral'].map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => setDirection(opt)}
              aria-pressed={direction === opt}
              className={`rounded-full px-2.5 py-1 text-ui-xs font-semibold uppercase tracking-wider transition-colors ${
                direction === opt ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-300' : 'border border-white/10 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <span className="ml-auto text-ui-dense text-zinc-600">{filtered.length} of {analyses.length}</span>
      </div>

      <div className="border-t border-white/5 pt-3">
        {selectedIds.length > 0 ? (
          <button
            type="button"
            onClick={handleDeleteSelected}
            className="w-full flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 px-4 rounded-md"
          >
            <TrashIcon /> Delete Selected ({selectedIds.length})
          </button>
        ) : (
          <button
            type="button"
            onClick={onClearAll}
            disabled={(analyses || []).length === 0}
            className="w-full flex items-center justify-center gap-1.5 bg-rose-900/50 hover:bg-rose-900/80 text-rose-400 font-bold py-2 px-4 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <TrashIcon /> Clear All Saved
          </button>
        )}
      </div>

      <div className="min-h-0">
        {(filtered || []).length === 0 ? (
          <EmptyState
            icon={<Bookmark className="w-8 h-8" />}
            title={query || direction !== 'All' ? 'No saved analyses match' : 'No saved analyses'}
            description={query || direction !== 'All' ? 'Loosen the search or filter.' : 'Bookmark analyses you want to revisit later.'}
          />
        ) : (
          <ul className="space-y-3">
            {(filtered || []).map(item => (
              <li key={item.id}>
                <SavedAnalysisRow
                  item={item}
                  onToggle={handleToggle}
                  isExpanded={expandedId === item.id}
                  isSelected={selectedIds.includes(item.id)}
                  onSelect={handleSelect}
                  onLocate={onLocateMessage}
                  modelIdToName={modelIdToName}
                  ocrModelIdToName={ocrModelIdToName}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default React.memo(SavedAnalyses);
