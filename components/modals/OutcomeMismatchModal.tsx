import React from 'react';
import { TradeOutcomeValidation } from '../../services/backtesting/BacktestingService';
import { CloseIcon, AlertTriangleIcon } from '../shared/Icons';

interface OutcomeMismatchModalProps {
    isVisible: boolean;
    onClose: () => void;
    userOutcome: 'WIN' | 'LOSS';
    priceValidation: TradeOutcomeValidation;
    onResolve: (outcome: 'WIN' | 'LOSS') => void;
}

const OutcomeMismatchModal: React.FC<OutcomeMismatchModalProps> = ({
    isVisible,
    onClose,
    userOutcome,
    priceValidation,
    onResolve
}) => {
    if (!isVisible) return null;

    const tpFirstTime = priceValidation.tpHits.length > 0 ? priceValidation.tpHits[0].candleTime : null;
    const slTouchTime = priceValidation.slTouched ? priceValidation.slTouchTime : null;

    return (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-label="Outcome mismatch warning">
            <div className="bg-zinc-900 border border-yellow-500/30 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl transform transition-all scale-100 max-h-[90vh] overflow-y-auto">

                {/* Header */}
                <div className="bg-yellow-500/10 p-5 border-b border-yellow-500/20 flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 text-yellow-500">
                        <AlertTriangleIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-yellow-500">Outcome Discrepancy</h3>
                        <p className="text-zinc-400 text-xs mt-1">
                            Price data conflicts with your logged outcome.
                        </p>
                    </div>
                    <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-white">
                        <CloseIcon />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-zinc-950/50 border border-zinc-800 text-center">
                            <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">You Logged</div>
                            <div className={`text-xl font-black mt-1 ${userOutcome === 'WIN' ? 'text-green-400' : 'text-red-400'}`}>
                                {userOutcome}
                            </div>
                        </div>
                        <div className="p-4 rounded-xl bg-zinc-950/50 border border-zinc-800 text-center">
                            <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Price Shows</div>
                            <div className={`text-xl font-black mt-1 ${priceValidation.outcome === 'WIN' ? 'text-green-400' : 'text-red-400'}`}>
                                {priceValidation.outcome}
                            </div>
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-zinc-800/50 border border-white/10 text-sm text-zinc-300 space-y-2">
                        <p className="font-semibold text-white">Analysis:</p>
                        <ul className="list-disc pl-4 space-y-1 text-xs sm:text-sm">
                            {tpFirstTime && (
                                <li>
                                    <span className="text-green-400 font-bold">TP Hit</span> at {new Date(tpFirstTime).toLocaleTimeString()}
                                </li>
                            )}
                            {slTouchTime && (
                                <li>
                                    <span className="text-red-400 font-bold">SL Touched</span> at {new Date(slTouchTime).toLocaleTimeString()}
                                </li>
                            )}
                        </ul>
                        <p className="text-xs text-yellow-500/80 mt-2 bg-yellow-500/10 p-2 rounded-lg">
                            The Take Profit was reached <strong>BEFORE</strong> the Stop Loss.
                        </p>
                    </div>

                    <p className="text-center text-sm text-zinc-400">
                        Which outcome should be used for analysis?
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => onResolve('WIN')}
                            className="p-3 rounded-xl bg-green-500/10 border border-green-500/50 hover:bg-green-500/20 text-green-400 font-bold transition-all active:scale-95"
                        >
                            Select WIN
                        </button>
                        <button
                            onClick={() => onResolve('LOSS')}
                            className="p-3 rounded-xl bg-red-500/10 border border-red-500/50 hover:bg-red-500/20 text-red-400 font-bold transition-all active:scale-95"
                        >
                            Select LOSS
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OutcomeMismatchModal;
