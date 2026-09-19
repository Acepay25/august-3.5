
import React from 'react';
import { ShieldCheck, Lock, Users } from 'lucide-react';
import { BotIcon, CloseIcon } from '../shared/Icons';

import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface AccuracyModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isEnabling: boolean;
}

export const AccuracyModeModal: React.FC<AccuracyModeModalProps> = ({ isOpen, onClose, onConfirm, isEnabling }) => {
    useEscapeClose(isOpen, onClose);
    const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);

  if (!isOpen) return null;

  return (
    <div ref={dialogRef} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="Accuracy mode">
      <div className={`bg-zinc-950 border ${isEnabling ? 'border-cyan-500/30 shadow-2xl shadow-cyan-950/30' : 'border-zinc-800 shadow-2xl shadow-black/60'} rounded-2xl max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto`}>
        <div className="p-6 text-center">
          {isEnabling ? (
            <>
              <div className="w-14 h-14 bg-cyan-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-cyan-500/30 text-cyan-400 animate-pulse">
                <BotIcon />
              </div>
              <h2 className="text-xl font-bold text-zinc-100 tracking-tight mb-2">Enable Accuracy Mode?</h2>
              <p className="text-zinc-400 text-xs mb-6 leading-relaxed">
                This will activate the <strong>10-Layer Accuracy Protocol</strong>.
              </p>
              <ul className="text-left text-xs text-zinc-300 space-y-2.5 bg-zinc-900/80 p-4 rounded-xl border border-white/10 mb-6">
                <li className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span><strong>Strict Logic:</strong> Lazy analysis is forbidden.</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Lock className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span><strong>Model Lockdown:</strong> Dropdowns will disappear.</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Users className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span><strong>Ensemble:</strong> Forced debate &amp; cross-validation.</span>
                </li>
              </ul>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-zinc-800 text-zinc-400">
                <CloseIcon className="w-6 h-6 text-zinc-400" />
              </div>
              <h2 className="text-xl font-bold text-zinc-100 mb-2">Disable Accuracy Mode?</h2>
              <p className="text-zinc-400 text-xs mb-6">
                Analysis will return to normal speed. Dropdowns will be restored.
              </p>
            </>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-bold text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 py-3 rounded-xl font-bold text-white transition-colors duration-[150ms] ease-[var(--ease-snappy)] ${isEnabling ? 'bg-cyan-600 hover:bg-cyan-500 shadow-lg shadow-cyan-900/40' : 'bg-zinc-700 hover:bg-zinc-600'}`}
            >
              {isEnabling ? 'Enable Mode' : 'Disable Mode'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
