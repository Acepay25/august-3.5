
import React, { useState } from 'react';
import { Message, TradeOutcome } from '../types';

export const LogTradeModal: React.FC<{
  message: Message;
  outcome: TradeOutcome.WIN | TradeOutcome.LOSS;
  onClose: () => void;
  onConfirm: (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; }) => void;
}> = ({ message, outcome, onClose, onConfirm }) => {
  const [pnl, setPnl] = useState('');
  const [correctedValue, setCorrectedValue] = useState('');
  const [isAdvanced, setIsAdvanced] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pnlNum = parseFloat(pnl);

    if (!isNaN(pnlNum) && pnlNum >= 0) {
      // Store losses as negative values for proper display in journal
      const finalPnl = outcome === TradeOutcome.LOSS ? -Math.abs(pnlNum) : Math.abs(pnlNum);
      onConfirm({
        pnlAmount: finalPnl,
        correctedStopLoss: outcome === TradeOutcome.LOSS && isAdvanced ? correctedValue : undefined,
        correctedTakeProfit: outcome === TradeOutcome.WIN && isAdvanced ? correctedValue : undefined,
      });
    } else {
      alert("Please enter a valid, positive number for the amount.");
    }
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
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md border border-gray-700 animate-fade-in">
        <h3 className={`text-lg font-bold mb-4 ${outcome === TradeOutcome.WIN ? 'text-green-400' : 'text-red-400'}`}>
          {content.title}
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="pnl-amount" className="block text-sm font-medium text-gray-300">{content.pnlLabel}</label>
              <input type="number" id="pnl-amount" value={pnl} onChange={e => setPnl(e.target.value)} placeholder="e.g., 250" className="mt-1 block w-full bg-gray-900 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500" required autoFocus />
            </div>

            <div className="border-t border-gray-700 pt-4">
              <label className="flex items-center cursor-pointer">
                <input type="checkbox" checked={isAdvanced} onChange={() => setIsAdvanced(!isAdvanced)} className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-cyan-600 focus:ring-cyan-500" />
                <span className="ml-3 text-sm font-medium text-gray-300">{content.advancedToggle}</span>
              </label>
            </div>

            {isAdvanced && (
              <div className="animate-fade-in">
                <label htmlFor="corrected-value" className="block text-sm font-medium text-gray-300">{content.advancedLabel}</label>
                <input type="text" id="corrected-value" value={correctedValue} onChange={e => setCorrectedValue(e.target.value)} placeholder={content.advancedPlaceholder} className="mt-1 block w-full bg-gray-900 border border-gray-600 rounded-md p-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                <p className="mt-2 text-xs text-gray-500">{content.advancedHelp}</p>
              </div>
            )}
          </div>
          <div className="mt-6 flex justify-end gap-4">
            <button type="button" onClick={onClose} className="py-2 px-4 rounded-md text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors">Cancel</button>
            <button type="submit" className="py-2 px-4 rounded-md text-white bg-cyan-600 hover:bg-cyan-700 transition-colors">Confirm & Log</button>
          </div>
        </form>
      </div>
    </div>
  );
};
