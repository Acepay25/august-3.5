import { useState, useCallback } from 'react';
import { TradeOutcome } from '../types';

interface CaptureFormConfig {
  outcome: TradeOutcome.WIN | TradeOutcome.LOSS;
}

interface CaptureFormState {
  pnl: string;
  correctedValue: string;
  isAdvanced: boolean;
  pnlError: string;
}

interface CaptureFormActions {
  setPnl: (value: string) => void;
  setCorrectedValue: (value: string) => void;
  toggleAdvanced: () => void;
  validate: () => boolean;
  buildFeedback: () => {
    pnlAmount: number;
    correctedStopLoss?: string;
    correctedTakeProfit?: string;
  };
  reset: () => void;
}

const WIN_CONTENT = {
  title: 'Log Trade Win',
  emoji: '🎯',
  pnlLabel: 'Profit Amount ($)',
  advancedToggle: 'Provide Final Take Profit',
  advancedLabel: 'Final Take Profit Price',
  advancedPlaceholder: 'e.g., 4987.0',
  advancedHelp: 'This helps the AI learn if it was too conservative.',
};

const LOSS_CONTENT = {
  title: 'Log Trade Loss',
  emoji: '📉',
  pnlLabel: 'Loss Amount ($)',
  advancedToggle: 'Provide Corrected Stop Loss',
  advancedLabel: 'Corrected Stop Loss Price',
  advancedPlaceholder: 'e.g., 4123.5',
  advancedHelp: 'This helps the AI understand why the original stop loss failed.',
};

/**
 * Shared form logic for trade capture modals.
 * Used by LogTradeModal, DataCaptureModal, and EntryNotHitCaptureModal.
 */
export function useCaptureForm({ outcome }: CaptureFormConfig): {
  state: CaptureFormState;
  actions: CaptureFormActions;
  content: typeof WIN_CONTENT;
  isWin: boolean;
} {
  const [pnl, setPnlRaw] = useState('');
  const [correctedValue, setCorrectedValue] = useState('');
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [pnlError, setPnlError] = useState('');

  const isWin = outcome === TradeOutcome.WIN;
  const content = isWin ? WIN_CONTENT : LOSS_CONTENT;

  const setPnl = useCallback((value: string) => {
    setPnlRaw(value);
    setPnlError('');
  }, []);

  const validate = useCallback((): boolean => {
    const pnlNum = parseFloat(pnl);
    if (isNaN(pnlNum) || pnlNum < 0 || pnl.trim() === '') {
      setPnlError('Please enter a valid, positive number.');
      return false;
    }
    setPnlError('');
    return true;
  }, [pnl]);

  const buildFeedback = useCallback(() => {
    const pnlNum = parseFloat(pnl);
    const finalPnl = isWin ? Math.abs(pnlNum) : -Math.abs(pnlNum);
    return {
      pnlAmount: finalPnl,
      correctedStopLoss: !isWin && isAdvanced ? correctedValue : undefined,
      correctedTakeProfit: isWin && isAdvanced ? correctedValue : undefined,
    };
  }, [pnl, isWin, isAdvanced, correctedValue]);

  const reset = useCallback(() => {
    setPnlRaw('');
    setCorrectedValue('');
    setIsAdvanced(false);
    setPnlError('');
  }, []);

  return {
    state: { pnl, correctedValue, isAdvanced, pnlError },
    actions: {
      setPnl,
      setCorrectedValue,
      toggleAdvanced: () => setIsAdvanced(prev => !prev),
      validate,
      buildFeedback,
      reset,
    },
    content,
    isWin,
  };
}
