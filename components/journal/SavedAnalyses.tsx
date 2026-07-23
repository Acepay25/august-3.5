
import React, { useState, useEffect } from 'react';
import { SavedAnalysis } from '../../types';
import { CloseIcon, ChevronDownIcon, TrashIcon } from '../shared/Icons';
import { modelIdToName, ocrModelIdToName } from '../../constants/models';

interface SavedAnalysesProps {
  analyses: SavedAnalysis[];
  onClose: () => void;
  isVisible: boolean;
  onDelete: (ids: string[]) => void;
  onClearAll: () => void;
  modelIdToName: Record<string, string>;
  ocrModelIdToName: Record<string, string>;
}

const SavedAnalysisRow: React.FC<{
  item: SavedAnalysis;
  onToggle: () => void;
  isExpanded: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  modelIdToName: Record<string, string>;
  ocrModelIdToName: Record<string, string>;
}> = ({ item, onToggle, isExpanded, isSelected, onSelect, modelIdToName, ocrModelIdToName }) => {
  const { analysis, timestamp, userPrompt, geminiModelUsed, deepseekModelUsed, zhipuModelUsed, ocrModelUsed, moderatorProvider, moderatorModel } = item;
  const { direction, entryPoints, stopLoss, takeProfit, activeStrategies, coinName } = analysis;
  const safeDirection = direction || 'Neutral';

  return (
    <div className={`bg-gray-900/50 rounded-lg border ${isSelected ? 'border-blue-500' : 'border-gray-700'}`}>
      <div className="flex items-center p-3 cursor-pointer" onClick={onToggle}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(item.id)}
          onClick={(e) => e.stopPropagation()}
          className="form-checkbox h-5 w-5 bg-gray-800 border-gray-600 text-cyan-600 focus:ring-cyan-500 rounded cursor-pointer flex-shrink-0"
        />
        <div className="flex-1 min-w-0 ml-4">
          <div className="flex items-center gap-3">
            <span className={`font-bold ${safeDirection === 'Long' ? 'text-green-400' : safeDirection === 'Short' ? 'text-red-400' : 'text-gray-400'}`}>{safeDirection}</span>
            <span className="font-mono text-sm font-bold text-gray-300">{coinName}</span>
            <span className="text-gray-300 truncate hidden sm:block">{(activeStrategies || []).join(', ')}</span>
          </div>
          <p className="text-sm text-gray-300 mt-1 truncate">Prompt: "{userPrompt}"</p>
          <p className="text-xs text-gray-500 mt-1">{new Date(timestamp).toLocaleString()}</p>
        </div>
        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
      </div>
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-700 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm pt-3">
            <div>
              <strong className="text-gray-400 block mb-1">Entry:</strong>
              <p className="font-mono text-cyan-300">{(entryPoints || [])[0]?.price}</p>
            </div>
            <div>
              <strong className="text-gray-400 block mb-1">Stop Loss:</strong>
              <p className="font-mono text-red-400">{stopLoss}</p>
            </div>
            <div className="md:col-span-2">
              <strong className="text-gray-400 block mb-1">Take Profit Targets:</strong>
              <div className="flex flex-col gap-2">
                {(takeProfit || []).map((tp, i) => (
                  <div key={i} className="flex items-center justify-between font-mono text-green-400 bg-gray-900/30 p-2 rounded-md border border-gray-700/50">
                    <span>{tp.price}</span>
                    <div className="flex items-center gap-2 text-xs">
                      {tp.percentage && <span className="text-cyan-300 bg-cyan-900/50 px-2 py-0.5 rounded-md">{tp.percentage}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 mt-2 pt-3 border-t border-gray-700/50">
              <h4 className="font-semibold text-cyan-400 mb-2">Original User Prompt</h4>
              <p className="italic text-gray-300">"{userPrompt}"</p>
            </div>
            <div className="md:col-span-2 mt-2 pt-3 border-t border-gray-700/50 text-xs text-gray-500 flex flex-col sm:flex-row sm:items-center sm:flex-wrap sm:gap-x-4 sm:gap-y-1">
              {geminiModelUsed && <span><strong className="font-semibold">Gemini Analyst:</strong> {modelIdToName[geminiModelUsed] || geminiModelUsed}</span>}
              {deepseekModelUsed && <span className="mt-1 sm:mt-0"><strong className="font-semibold">DeepSeek Analyst:</strong> {modelIdToName[deepseekModelUsed] || deepseekModelUsed}</span>}
              {zhipuModelUsed && <span className="mt-1 sm:mt-0"><strong className="font-semibold">Zhipu Analyst:</strong> {modelIdToName[zhipuModelUsed] || zhipuModelUsed}</span>}
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

const SavedAnalyses: React.FC<SavedAnalysesProps> = ({ analyses, onClose, isVisible, onDelete, onClearAll, modelIdToName, ocrModelIdToName }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isVisible) {
      setExpandedId(null);
      setSelectedIds([]);
    }
  }, [isVisible]);

  const handleToggle = (id: string) => {
    setExpandedId(prevId => (prevId === id ? null : id));
  };

  const handleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(tradeId => tradeId !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length > 0) {
      onDelete(selectedIds);
      setSelectedIds([]);
    }
  };

  if (!isVisible) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose}></div>
      <aside className="fixed top-0 right-0 h-full w-full sm:max-w-2xl bg-gray-800 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-cyan-400">Saved Analyses for Review</h2>
          <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white">
            <CloseIcon />
          </button>
        </header>

        <div className="p-3 border-b border-gray-700">
          {selectedIds.length > 0 ? (
            <button
              onClick={handleDeleteSelected}
              className="w-full flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md"
            >
              <TrashIcon /> Delete Selected ({selectedIds.length})
            </button>
          ) : (
            <button
              onClick={onClearAll}
              disabled={(analyses || []).length === 0}
              className="w-full flex items-center justify-center gap-1.5 bg-red-900/50 hover:bg-red-900/80 text-red-400 font-bold py-2 px-4 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <TrashIcon /> Clear All Saved
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          {(analyses || []).length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>No analyses have been saved yet.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {(analyses || []).map(item => (
                <li key={item.id}>
                  <SavedAnalysisRow
                    item={item}
                    onToggle={() => handleToggle(item.id)}
                    isExpanded={expandedId === item.id}
                    isSelected={selectedIds.includes(item.id)}
                    onSelect={handleSelect}
                    modelIdToName={modelIdToName}
                    ocrModelIdToName={ocrModelIdToName}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
};

export default React.memo(SavedAnalyses);
