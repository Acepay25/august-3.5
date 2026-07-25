
import React, { useState } from 'react';
import { Message, TradeOutcome } from '../../types';

export const LogTradeModal: React.FC<{
  message: Message;
  outcome: TradeOutcome.WIN | TradeOutcome.LOSS;
  onClose: () => void;
  onConfirm: (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; }) => void;
}> = ({ message, outcome, onClose, onConfirm }) => {
  const [pnl, setPnl] = useState('');
  const [correctedValue, setCorrectedValue] = useState('');
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [pnlError, setPnlError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pnlNum = parseFloat(pnl);

    if (isNaN(pnlNum) || pnlNum < 0) {
      setPnlError('Please enter a valid, positive number for the amount.');
      return;
    }
    setPnlError('');
    // Store losses as negative values for proper display in journal
    const finalPnl = outcome === TradeOutcome.LOSS ? -Math.abs(pnlNum) : Math.abs(pnlNum);
    onConfirm({
      pnlAmount: finalPnl,
      correctedStopLoss: outcome === TradeOutcome.LOSS && isAdvanced ? correctedValue : undefined,
      correctedTakeProfit: outcome === TradeOutcome.WIN && isAdvanced ? correctedValue : undefined,
    });
  };

  const lossContent = {
    title: 'Log Trade Loss',
    pnlLabel: 'Loss Amount ($)',
    advancedToggle: 'Provide Corrected Stop Loss',
    advancedLabel: 'Corrected Stop Loss Price',
    advancedPlaceholder: 'e.g., ₮4,123.5',
    advancedHelp: 'This helps the AI understand why the original stop loss failed.'
  };

  const winContent = {
    title: 'Log Trade Win',
    pnlLabel: 'Profit Amount ($)',
    advancedToggle: 'Provide Final Take Profit',
    advancedLabel: 'Final Take Profit Price',
    advancedPlaceholder: 'e.g., ₮4,987.0',
    advancedHelp: 'This helps the AI learn if it was too conservative and let winners run longer.'
  };

  const content = outcome === TradeOutcome.WIN ? winContent : lossContent;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Log trade">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md border border-white/10 animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className={`p-5 border-b border-white/5 ${outcome === TradeOutcome.WIN ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{outcome === TradeOutcome.WIN ? '🎯' : '📉'}</span>
            <div>
              <h3 className={`text-lg font-bold ${outcome === TradeOutcome.WIN ? 'text-emerald-400' : 'text-rose-400'}`}>
                {content.title}
              </h3>
            </div>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4">
            <div>
              <label htmlFor="pnl-amount" className="block text-sm font-medium text-zinc-300 mb-2">{content.pnlLabel} <span className="text-rose-400">*</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono">$</span>
                <input type="number" id="pnl-amount" value={pnl} onChange={e => { setPnl(e.target.value); setPnlError(''); }} placeholder="250" className={`w-full bg-zinc-800 border rounded-xl pl-8 pr-4 py-3 text-white font-mono text-lg focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all ${pnlError ? 'border-rose-500' : 'border-white/10'}`} required autoFocus aria-invalid={!!pnlError} aria-describedby={pnlError ? 'pnl-error' : undefined} />
              </div>
              {pnlError && <p id="pnl-error" className="mt-1.5 text-xs text-rose-400" role="alert">{pnlError}</p>}
            </div>

            <div className="border-t border-white/5 pt-4">
              <label className="flex items-center cursor-pointer">
                <input type="checkbox" checked={isAdvanced} onChange={() => setIsAdvanced(!isAdvanced)} className="h-4 w-4 rounded border-white/10 bg-zinc-800 text-cyan-600 focus:ring-cyan-500" />
                <span className="ml-3 text-sm font-medium text-zinc-300">{content.advancedToggle}</span>
              </label>
            </div>

            {isAdvanced && (
              <div className="animate-fade-in">
                <label htmlFor="corrected-value" className="block text-sm font-medium text-zinc-300 mb-2">{content.advancedLabel}</label>
                <input type="text" id="corrected-value" value={correctedValue} onChange={e => setCorrectedValue(e.target.value)} placeholder={content.advancedPlaceholder} className="w-full bg-zinc-800 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all" />
                <p className="mt-2 text-xs text-zinc-500">{content.advancedHelp}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-white/5 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="py-2.5 px-5 rounded-xl text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors font-medium">Cancel</button>
            <button type="submit" className="py-2.5 px-5 rounded-xl text-white bg-cyan-600 hover:bg-cyan-700 transition-colors font-bold">Confirm & Log</button>
          </div>
        </form>
      </div>
    </div>
  );
};
