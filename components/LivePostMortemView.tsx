
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTypingEffect } from '../hooks/useTypingEffect';
import { CloseIcon, LoadingIcon, BotIcon } from './Icons';
import { LiveThoughts } from '../types';

interface LivePostMortemViewProps {
  isVisible: boolean;
  onClose: () => void;
  thoughts: LiveThoughts;
  geminiModelName?: string;
  deepseekModelName?: string;
  zhipuModelName?: string;
  groqModelName?: string;
  groqNewModelName?: string;
  groqAlt2ModelName?: string;
  openrouterModelName?: string;

  onAllTypingComplete: () => void;
}

const AnalystPanel: React.FC<{
  title: string;
  modelName?: string;
  text: string | null;
  colorClasses: {
    bg: string;
    border: string;
    text: string;
    title: string;
    accent: string;
  };
  onTypingComplete: () => void;
}> = ({ title, modelName, text, colorClasses, onTypingComplete }) => {
  const [typedText, isFinished] = useTypingEffect(text, 4); // Faster base speed

  useEffect(() => {
    if (isFinished && text !== null) {
      onTypingComplete();
    }
  }, [isFinished, text, onTypingComplete]);

  // Check if we are still thinking OR if typing hasn't started yet (typedText is empty) to prevent empty flash
  const showLoadingState = text === null || (text !== null && typedText.length === 0 && !isFinished);

  return (
    <div className={`flex flex-col h-full rounded-2xl border ${colorClasses.border} ${colorClasses.bg} shadow-xl transition-all duration-300 overflow-hidden relative group will-change-transform`}>
      <div className={`absolute top-0 left-0 w-full h-1 ${colorClasses.accent} opacity-50`}></div>
      <div className="p-4 sm:p-5 flex justify-between items-start border-b border-white/5 bg-black/20">
        <div>
          <h4 className={`font-bold text-base sm:text-lg tracking-tight ${colorClasses.title}`}>{title}</h4>
          {modelName && <div className="text-[10px] font-mono text-zinc-500 mt-1 uppercase tracking-wider">{modelName}</div>}
        </div>
        <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center border border-white/10 bg-black/40 ${colorClasses.title}`}>
          <BotIcon />
        </div>
      </div>
      <div className="flex-1 p-4 sm:p-5 overflow-y-auto custom-scrollbar relative">
        {showLoadingState ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-3 animate-pulse">
            <LoadingIcon className={`w-6 h-6 ${colorClasses.text}`} />
            <span className="text-xs font-mono uppercase tracking-widest">{text === null ? 'Analyzing Outcome...' : 'Rendering Report...'}</span>
          </div>
        ) : (
          <div className={`text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans ${colorClasses.text} animate-fade-in`}>
            {typedText}
            {!isFinished && <span className={`inline-block w-1.5 h-4 ml-1 align-middle ${colorClasses.accent} animate-pulse`}></span>}
          </div>
        )}
      </div>
      {!showLoadingState && isFinished && (
        <div className="absolute bottom-2 right-2">
          <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${colorClasses.border} bg-black/60 text-zinc-400`}>Complete</span>
        </div>
      )}
    </div>
  );
};

const LivePostMortemView: React.FC<LivePostMortemViewProps> = ({ isVisible, onClose, thoughts, geminiModelName, deepseekModelName, zhipuModelName, groqModelName, groqNewModelName, groqAlt2ModelName, openrouterModelName, onAllTypingComplete }) => {
  const [completedTyping, setCompletedTyping] = useState<Set<string>>(new Set());




  const activeAnalysts = useMemo(() => {
    const active: string[] = [];
    if (geminiModelName) active.push('gemini');
    if (deepseekModelName) active.push('deepseek');
    if (zhipuModelName) active.push('zhipu');
    if (groqModelName) active.push('groq');
    if (groqNewModelName) active.push('groqNew');
    if (groqAlt2ModelName) active.push('groqAlt2');
    if (openrouterModelName) active.push('openrouter');
    return active;
  }, [geminiModelName, deepseekModelName, zhipuModelName, groqModelName, groqNewModelName, groqAlt2ModelName, openrouterModelName]);

  useEffect(() => {
    if (isVisible) {
      setCompletedTyping(new Set());
    }
  }, [isVisible]);

  // Memoize to prevent infinite loops in children
  const handleTypingComplete = useCallback((analyst: string) => {
    setCompletedTyping(prev => {
      if (prev.has(analyst)) return prev;
      return new Set(prev).add(analyst);
    });
  }, []);

  useEffect(() => {
    if (isVisible && activeAnalysts.length > 0 && activeAnalysts.every(analyst => completedTyping.has(analyst))) {
      const timer = setTimeout(() => {
        onAllTypingComplete();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [completedTyping, activeAnalysts, isVisible, onAllTypingComplete]);

  if (!isVisible) return null;

  const count = activeAnalysts.length;
  const gridCols = count === 1 ? 'grid-cols-1' : count === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="fixed inset-0 bg-zinc-950/95 z-50 flex items-center justify-center p-4 sm:p-8 backdrop-blur-sm animate-fade-in" style={{ transition: 'opacity 0.2s ease-in-out' }}>
      <div className="flex flex-col w-full h-full max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-4 sm:mb-6 flex-shrink-0">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-purple-500 animate-pulse shadow-[0_0_10px_#a855f7]"></span>
              Live Post-Mortem Forensics
            </h2>
            <p className="text-zinc-500 text-xs sm:text-sm mt-1 font-medium">Ensemble models are dissecting trade performance and verifying outcomes.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/10 transition-all">
            <CloseIcon />
          </button>
        </header>

        <main className={`flex-1 grid ${gridCols} gap-4 sm:gap-6 min-h-0`}>
          {geminiModelName && (
            <AnalystPanel
              title="Gemini"
              modelName={geminiModelName}
              text={thoughts.gemini}
              colorClasses={{
                bg: 'bg-blue-950/10',
                border: 'border-blue-500/20',
                text: 'text-blue-100/90',
                title: 'text-blue-400',
                accent: 'bg-blue-500'
              }}
              onTypingComplete={() => handleTypingComplete('gemini')}
            />
          )}
          {deepseekModelName && (
            <AnalystPanel
              title="DeepSeek"
              modelName={deepseekModelName}
              text={thoughts.deepseek}
              colorClasses={{
                bg: 'bg-emerald-950/10',
                border: 'border-emerald-500/20',
                text: 'text-emerald-100/90',
                title: 'text-emerald-400',
                accent: 'bg-emerald-500'
              }}
              onTypingComplete={() => handleTypingComplete('deepseek')}
            />
          )}
          {zhipuModelName && (
            <AnalystPanel
              title="Zhipu AI"
              modelName={zhipuModelName}
              text={thoughts.zhipu}
              colorClasses={{
                bg: 'bg-orange-950/10',
                border: 'border-orange-500/20',
                text: 'text-orange-100/90',
                title: 'text-orange-400',
                accent: 'bg-orange-500'
              }}
              onTypingComplete={() => handleTypingComplete('zhipu')}
            />
          )}
          {groqModelName && (
            <AnalystPanel
              title="Groq"
              modelName={groqModelName}
              text={thoughts.groq}
              colorClasses={{
                bg: 'bg-yellow-950/10',
                border: 'border-yellow-500/20',
                text: 'text-yellow-100/90',
                title: 'text-yellow-400',
                accent: 'bg-yellow-500'
              }}
              onTypingComplete={() => handleTypingComplete('groq')}
            />
          )}
          {groqNewModelName && (
            <AnalystPanel
              title="Groq (Alt)"
              modelName={groqNewModelName}
              text={thoughts.groqNew}
              colorClasses={{
                bg: 'bg-yellow-900/10',
                border: 'border-yellow-300/20',
                text: 'text-yellow-100/90',
                title: 'text-yellow-200',
                accent: 'bg-yellow-300'
              }}
              onTypingComplete={() => handleTypingComplete('groqNew')}
            />
          )}
          {groqAlt2ModelName && (
            <AnalystPanel
              title="Groq (Alt 2)"
              modelName={groqAlt2ModelName}
              text={thoughts.groqAlt2}
              colorClasses={{
                bg: 'bg-amber-950/10',
                border: 'border-amber-500/20',
                text: 'text-amber-100/90',
                title: 'text-amber-400',
                accent: 'bg-amber-500'
              }}
              onTypingComplete={() => handleTypingComplete('groqAlt2')}
            />
          )}
          {openrouterModelName && (
            <AnalystPanel
              title="OpenRouter"
              modelName={openrouterModelName}
              text={thoughts.openrouter}
              colorClasses={{
                bg: 'bg-green-950/10',
                border: 'border-green-500/20',
                text: 'text-green-100/90',
                title: 'text-green-400',
                accent: 'bg-green-500'
              }}
              onTypingComplete={() => handleTypingComplete('openrouter')}
            />
          )}

        </main>
      </div>
    </div>
  );
};

export default LivePostMortemView;
