
import React from 'react';
import { BotIcon, CloseIcon } from './Icons';

interface AccuracyModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isEnabling: boolean;
}

export const AccuracyModeModal: React.FC<AccuracyModeModalProps> = ({ isOpen, onClose, onConfirm, isEnabling }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className={`bg-zinc-950 border-2 ${isEnabling ? 'border-cyan-600' : 'border-zinc-700'} rounded-2xl max-w-md w-full overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.3)]`}>
        <div className="p-6 text-center">
          {isEnabling ? (
            <>
              <div className="w-16 h-16 bg-cyan-900/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-cyan-500 animate-pulse">
                <BotIcon />
              </div>
              <h2 className="text-2xl font-black text-cyan-400 uppercase tracking-tight mb-2">Enable Accuracy Mode?</h2>
              <p className="text-cyan-200/80 text-sm mb-6 leading-relaxed">
                This will activate the <strong>10-Layer Accuracy Protocol</strong>.
              </p>
              <ul className="text-left text-xs text-cyan-300 space-y-2 bg-black/40 p-4 rounded-xl border border-cyan-900/50 mb-6">
                <li className="flex gap-2">🔥 <strong>Strict Logic:</strong> Lazy analysis is forbidden.</li>
                <li className="flex gap-2">🔒 <strong>Model Lockdown:</strong> Dropdowns will disappear.</li>

                <li className="flex gap-2">🤖 <strong>Ensemble:</strong> Forced debate & cross-validation.</li>
              </ul>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-600">
                <CloseIcon className="w-8 h-8 text-zinc-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Disable Accuracy Mode?</h2>
              <p className="text-zinc-400 text-sm mb-6">
                Analysis will return to normal speed. Dropdowns will be restored.
              </p>
            </>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-bold text-zinc-400 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 py-3 rounded-xl font-bold text-white transition-all ${isEnabling ? 'bg-cyan-600 hover:bg-cyan-500 shadow-lg shadow-cyan-900/40' : 'bg-zinc-700 hover:bg-zinc-600'}`}
            >
              {isEnabling ? 'Enable Mode' : 'Disable Mode'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
