
import React from 'react';
import { CloseIcon, CodeIcon } from './Icons';

interface VisionDataViewerProps {
  isVisible: boolean;
  onClose: () => void;
  visionData: string[];
}

const VisionDataViewer: React.FC<VisionDataViewerProps> = ({ isVisible, onClose, visionData }) => {
  if (!isVisible) return null;

  return (
    <>
      <div className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose}></div>
      <aside className={`fixed top-0 right-0 h-full w-full sm:max-w-xl bg-zinc-900/95 backdrop-blur-xl border-l border-white/10 shadow-2xl z-50 transform transition-transform duration-300 cubic-bezier(0.16, 1, 0.3, 1) flex flex-col ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="flex items-center justify-between p-5 border-b border-white/5 bg-black/20">
          <div className="flex items-center gap-3 text-cyan-400">
            <CodeIcon />
            <h2 className="text-lg font-bold tracking-tight">Raw Vision Telemetry</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white transition-colors">
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {(visionData || []).length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-600 flex-col gap-3">
              <CodeIcon />
              <p>No vision data captured.</p>
            </div>
          ) : (
            (visionData || []).map((data, index) => (
              <div key={index} className="animate-fade-in">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 pl-1">Chart {index + 1} Extraction</h3>
                <div className="bg-black/50 p-4 rounded-xl border border-white/10 overflow-x-auto shadow-inner">
                    <pre className="whitespace-pre-wrap text-xs text-emerald-300/90 font-mono leading-relaxed">{data}</pre>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
};

export default React.memo(VisionDataViewer);
