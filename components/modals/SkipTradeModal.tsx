
import React from 'react';
import { TradeOutcome } from '../../types';

interface SkipTradeModalProps {
  onClose: () => void;
  onConfirm: (reason: TradeOutcome.ENTRY_NOT_HIT | TradeOutcome.SKIPPED) => void;
  skipReason: TradeOutcome.ENTRY_NOT_HIT | TradeOutcome.SKIPPED | null;
  setSkipReason: (reason: TradeOutcome.ENTRY_NOT_HIT | TradeOutcome.SKIPPED | null) => void;
  correctedEntry: string;
  setCorrectedEntry: (value: string) => void;
}

export const SkipTradeModal: React.FC<SkipTradeModalProps> = ({
  onClose,
  onConfirm,
  skipReason,
  setSkipReason,
  correctedEntry,
  setCorrectedEntry,
}) => {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Trade not executed">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md border border-yellow-500/30 animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-5 border-b border-white/5 bg-yellow-500/10">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⏭️</span>
            <div>
              <h3 className="text-lg font-bold text-yellow-400">
                Trade Not Executed
              </h3>
              <p className="text-sm text-zinc-400 mt-0.5">
                Select the reason for not taking this trade
              </p>
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="p-5 space-y-3">
          {/* Entry Not Hit Option */}
          <label
            htmlFor="reason-entry-not-hit"
            className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${skipReason === TradeOutcome.ENTRY_NOT_HIT
                ? 'bg-cyan-950/30 border-cyan-500/50 shadow-[0_0_15px_-3px_rgba(34,211,238,0.3)]'
                : 'bg-zinc-800/50 border-white/10 hover:bg-zinc-800 hover:border-white/20'
              }`}
          >
            <input
              type="radio"
              id="reason-entry-not-hit"
              name="skip-reason"
              value={TradeOutcome.ENTRY_NOT_HIT}
              checked={skipReason === TradeOutcome.ENTRY_NOT_HIT}
              onChange={() => setSkipReason(TradeOutcome.ENTRY_NOT_HIT)}
              className="mt-1 h-5 w-5 text-cyan-600 bg-zinc-800 border-zinc-600 focus:ring-cyan-500"
            />
            <div className="flex-1">
              <div className="font-bold text-white flex items-center gap-2">
                🎯 Entry Not Hit
                <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">
                  Logged
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                The market never reached the specified entry price. This will be recorded for analysis.
              </p>
            </div>
          </label>

          {/* Skipped Option */}
          <label
            htmlFor="reason-skipped"
            className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${skipReason === TradeOutcome.SKIPPED
                ? 'bg-zinc-800 border-zinc-500/50'
                : 'bg-zinc-800/50 border-white/10 hover:bg-zinc-800 hover:border-white/20'
              }`}
          >
            <input
              type="radio"
              id="reason-skipped"
              name="skip-reason"
              value={TradeOutcome.SKIPPED}
              checked={skipReason === TradeOutcome.SKIPPED}
              onChange={() => setSkipReason(TradeOutcome.SKIPPED)}
              className="mt-1 h-5 w-5 text-zinc-600 bg-zinc-800 border-zinc-600 focus:ring-zinc-500"
            />
            <div className="flex-1">
              <div className="font-bold text-white flex items-center gap-2">
                🚫 Skipped Trade
              </div>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                You chose not to take the trade for other reasons. This will not be logged.
              </p>
            </div>
          </label>

          {/* Corrected Entry Input (for Entry Not Hit) */}
          {skipReason === TradeOutcome.ENTRY_NOT_HIT && (
            <div className="mt-4 pl-9 animate-fade-in">
              <label htmlFor="corrected-entry" className="block text-sm font-medium text-zinc-400 mb-1.5">
                Optional: What was the correct entry?
              </label>
              <input
                type="text"
                id="corrected-entry"
                value={correctedEntry}
                onChange={(e) => setCorrectedEntry(e.target.value)}
                placeholder="e.g., 4321.5"
                className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
              <p className="mt-1.5 text-xs text-zinc-500">
                This helps the AI learn why its original entry was missed.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/5 bg-zinc-950/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => skipReason && onConfirm(skipReason)}
            disabled={!skipReason}
            className="py-2 px-4 rounded-lg text-white bg-cyan-600 hover:bg-cyan-700 transition-colors font-bold disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};
