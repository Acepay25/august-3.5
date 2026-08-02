import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTypingEffect } from '../../hooks/useTypingEffect';
import { CloseIcon, LoadingIcon, BotIcon } from '../shared/Icons';
import { LiveThoughts } from '../../types';
import { ProviderConfig } from '../../types/provider';

interface LiveStreamViewProps {
  isVisible: boolean;
  onClose: () => void;
  thoughts: LiveThoughts;
  /** Ready provider configs — one panel per participating provider. */
  providers: ProviderConfig[];
  onAllTypingComplete: () => void;
  /** 'analysis' for live analysis, 'postmortem' for post-trade forensics */
  variant: 'analysis' | 'postmortem';
}

const VARIANT_CONFIG = {
  analysis: {
    title: 'Live Neural Analysis',
    subtitle: 'Multiple LLMs are analyzing market structures in real-time.',
    dotColor: 'bg-cyan-500',
    dotShadow: 'shadow-[0_0_10px_#d4d4d8]',
    loadingIdle: 'Initializing Neural Net...',
    loadingStreaming: 'Decoding Output...',
  },
  postmortem: {
    title: 'Live Post-Mortem Forensics',
    subtitle: 'Ensemble models are dissecting trade performance and verifying outcomes.',
    dotColor: 'bg-purple-500',
    dotShadow: 'shadow-[0_0_10px_#a1a1aa]',
    loadingIdle: 'Analyzing Outcome...',
    loadingStreaming: 'Rendering Report...',
  },
} as const;

const COLOR_PALETTE = [
  { bg: 'bg-blue-950/10', border: 'border-blue-500/20', text: 'text-blue-100/90', title: 'text-blue-400', accent: 'bg-blue-500' },
  { bg: 'bg-purple-950/10', border: 'border-purple-500/20', text: 'text-purple-100/90', title: 'text-purple-400', accent: 'bg-purple-500' },
  { bg: 'bg-emerald-950/10', border: 'border-emerald-500/20', text: 'text-emerald-100/90', title: 'text-emerald-400', accent: 'bg-emerald-500' },
  { bg: 'bg-amber-950/10', border: 'border-amber-500/20', text: 'text-amber-100/90', title: 'text-amber-400', accent: 'bg-amber-500' },
  { bg: 'bg-cyan-950/10', border: 'border-cyan-500/20', text: 'text-cyan-100/90', title: 'text-cyan-400', accent: 'bg-cyan-500' },
];

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
  loadingIdle: string;
  loadingStreaming: string;
  onTypingComplete: () => void;
}> = ({ title, modelName, text, colorClasses, loadingIdle, loadingStreaming, onTypingComplete }) => {
  const [typedText, isFinished] = useTypingEffect(text, 4);

  useEffect(() => {
    if (isFinished && text !== null) {
      onTypingComplete();
    }
  }, [isFinished, text, onTypingComplete]);

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
            <span className="text-xs font-mono uppercase tracking-widest">{text === null ? loadingIdle : loadingStreaming}</span>
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

const LiveStreamView: React.FC<LiveStreamViewProps> = ({
  isVisible, onClose, thoughts, providers,
  onAllTypingComplete, variant,
}) => {
  const [completedTyping, setCompletedTyping] = useState<Set<string>>(new Set());
  const config = VARIANT_CONFIG[variant];

  const activePanels = useMemo(() => (
    providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0).map((p, idx) => ({
      key: p.id,
      title: p.name,
      modelName: p.selectedModel,
      colors: COLOR_PALETTE[idx % COLOR_PALETTE.length],
    }))
  ), [providers]);

  const activeAnalysts = useMemo(() => activePanels.map(p => p.key), [activePanels]);

  useEffect(() => {
    if (isVisible) {
      setCompletedTyping(new Set());
    }
  }, [isVisible]);

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

  const count = activePanels.length;
  const gridCols = count === 1 ? 'grid-cols-1' : count === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="fixed inset-0 bg-zinc-950/95 z-50 flex items-center justify-center p-4 sm:p-8 backdrop-blur-sm animate-fade-in" style={{ transition: 'opacity 0.2s ease-in-out' }}>
      <div className="flex flex-col w-full h-full max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-4 sm:mb-6 flex-shrink-0">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${config.dotColor} animate-pulse ${config.dotShadow}`}></span>
              {config.title}
            </h2>
            <p className="text-zinc-500 text-xs sm:text-sm mt-1 font-medium">{config.subtitle}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/10 transition-all" aria-label="Close live view">
            <CloseIcon />
          </button>
        </header>

        <main className={`flex-1 grid ${gridCols} gap-4 sm:gap-6 min-h-0`}>
          {activePanels.map(panel => (
            <AnalystPanel
              key={panel.key}
              title={panel.title}
              modelName={panel.modelName}
              text={thoughts[panel.key as keyof LiveThoughts] || null}
              colorClasses={panel.colors}
              loadingIdle={config.loadingIdle}
              loadingStreaming={config.loadingStreaming}
              onTypingComplete={() => handleTypingComplete(panel.key)}
            />
          ))}
        </main>
      </div>
    </div>
  );
};

export default LiveStreamView;
