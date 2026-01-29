
import React, { useState, useEffect } from 'react';
import { Conversation, MessageRole } from '../types';
import { CloseIcon, TrashIcon } from './Icons';

interface ConversationHistoryProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  isVisible: boolean;
  onClose: () => void;
  onLoadConversation: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onClearAll: () => void;
  onStartNew: () => void;
}

const ConversationHistory: React.FC<ConversationHistoryProps> = ({
  conversations,
  activeConversationId,
  isVisible,
  onClose,
  onLoadConversation,
  onDelete,
  onClearAll,
  onStartNew,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isVisible) {
      setSelectedIds([]);
    }
  }, [isVisible]);

  const handleSelectConversation = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(convId => convId !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length > 0) {
      onDelete(selectedIds);
      setSelectedIds([]);
    }
  };

  const getConversationPreview = (conv: Conversation): string => {
    const firstUserMessage = (conv.messages || []).find(m => m.role === MessageRole.USER && m.text.trim());
    return firstUserMessage ? firstUserMessage.text : "New Conversation";
  };
  
  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      ></div>

      <aside className={`fixed top-0 right-0 h-full w-full sm:max-w-md bg-zinc-900/95 backdrop-blur-xl border-l border-white/10 shadow-2xl z-50 transform transition-transform duration-300 cubic-bezier(0.16, 1, 0.3, 1) flex flex-col ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <header className="flex items-center justify-between p-5 border-b border-white/5 bg-black/20">
            <h2 className="text-lg font-bold text-zinc-100 tracking-tight">History</h2>
            <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white transition-colors">
              <CloseIcon />
            </button>
          </header>

          <div className="p-4 border-b border-white/5 space-y-3 bg-zinc-900/50">
            <button 
                onClick={onStartNew}
                className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:shadow-lg hover:scale-[1.02] transition-all shadow-cyan-900/20"
            >
                Start New Conversation
            </button>
            {selectedIds.length > 0 ? (
                <button
                    onClick={handleDeleteSelected}
                    className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold py-2.5 px-4 rounded-lg transition-all"
                >
                    <TrashIcon /> Delete Selected ({selectedIds.length})
                </button>
            ) : (
                <button
                    onClick={onClearAll}
                    disabled={(conversations || []).length <= 1}
                    className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-bold py-2.5 px-4 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <TrashIcon /> Clear All
                </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            {(conversations || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                <p>No saved conversations.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {(conversations || []).map((conv) => (
                  <li 
                    key={conv.id} 
                    className={`group relative rounded-xl border transition-all duration-200 ${activeConversationId === conv.id ? 'bg-cyan-900/20 border-cyan-500/50 shadow-[0_0_15px_-5px_rgba(34,211,238,0.2)]' : selectedIds.includes(conv.id) ? 'bg-blue-900/20 border-blue-500/50' : 'bg-zinc-800/30 border-white/5 hover:bg-zinc-800/60 hover:border-white/10'}`}
                  >
                    <div className="flex justify-between items-start p-4">
                      <div className="flex-1 min-w-0 flex items-start gap-3">
                        <div className="pt-1">
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(conv.id)}
                                onChange={() => handleSelectConversation(conv.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="form-checkbox h-4 w-4 bg-zinc-900 border-zinc-600 text-cyan-500 rounded focus:ring-cyan-500/50 cursor-pointer"
                                disabled={activeConversationId === conv.id}
                            />
                        </div>
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onLoadConversation(conv.id)}>
                            <p className="text-[10px] font-mono text-zinc-500 mb-1">
                                {new Date(conv.timestamp).toLocaleString()}
                            </p>
                            <p className={`text-sm font-medium truncate leading-tight ${activeConversationId === conv.id ? 'text-cyan-100' : 'text-zinc-300 group-hover:text-zinc-100'}`}>
                                {getConversationPreview(conv)}
                            </p>
                        </div>
                      </div>
                      
                      <div className="flex-shrink-0 flex items-center gap-1 ml-2">
                         {activeConversationId === conv.id && (
                             <span className="px-2 py-1 rounded-md bg-cyan-500/20 text-cyan-400 text-[10px] uppercase font-bold tracking-wider border border-cyan-500/20">Active</span>
                         )}
                         {activeConversationId !== conv.id && (
                            <button
                              onClick={() => onDelete([conv.id])}
                              className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                              title="Delete"
                            >
                              <TrashIcon />
                            </button>
                         )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default React.memo(ConversationHistory);
