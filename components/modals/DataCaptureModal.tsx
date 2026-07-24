
import React, { useState } from 'react';
import { Message, TradeOutcome } from '../../types';

interface DataCaptureModalProps {
    message: Message;
    outcome: TradeOutcome;
    onClose: () => void;
    onUploadScreenshot: (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; selectedEntryIndices?: number[]; }) => void;
    onAutoCapture: (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; selectedEntryIndices?: number[]; }) => void;
    onSkip: (feedback: { pnlAmount: number; correctedStopLoss?: string; correctedTakeProfit?: string; selectedEntryIndices?: number[]; }) => void;
    isCapturing?: boolean;
}

export const DataCaptureModal: React.FC<DataCaptureModalProps> = ({
    message,
    outcome,
    onClose,
    onUploadScreenshot,
    onAutoCapture,
    onSkip,
    isCapturing = false
}) => {
    const coinName = message.analysis?.coinName || 'this trade';
    const [pnl, setPnl] = useState('');
    const [correctedValue, setCorrectedValue] = useState('');
    const [isAdvanced, setIsAdvanced] = useState(false);

    // Entry selection state - for trades with multiple entry points
    const entryPoints = message.analysis?.entryPoints || [];
    const hasMultipleEntries = entryPoints.length > 1;
    // Default: all entries selected
    const [selectedEntryIndices, setSelectedEntryIndices] = useState<number[]>(
        entryPoints.map((_, idx) => idx)
    );

    const outcomeColors = {
        [TradeOutcome.WIN]: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', glow: 'shadow-emerald-500/20' },
        [TradeOutcome.LOSS]: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400', glow: 'shadow-rose-500/20' },
        [TradeOutcome.ENTRY_NOT_HIT]: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', glow: 'shadow-yellow-500/20' },
        [TradeOutcome.SKIPPED]: { bg: 'bg-zinc-500/10', border: 'border-zinc-500/30', text: 'text-zinc-400', glow: 'shadow-zinc-500/20' },
        [TradeOutcome.PENDING]: { bg: 'bg-zinc-500/10', border: 'border-zinc-500/30', text: 'text-zinc-400', glow: 'shadow-zinc-500/20' },
    };

    const colors = outcomeColors[outcome] || outcomeColors[TradeOutcome.PENDING];

    const isWin = outcome === TradeOutcome.WIN;

    const content = isWin ? {
        title: 'Log Trade Win',
        emoji: '🎯',
        pnlLabel: 'Profit Amount ($)',
        advancedToggle: 'Provide Final Take Profit',
        advancedLabel: 'Final Take Profit Price',
        advancedPlaceholder: 'e.g., 4987.0',
        advancedHelp: 'This helps the AI learn if it was too conservative.'
    } : {
        title: 'Log Trade Loss',
        emoji: '📉',
        pnlLabel: 'Loss Amount ($)',
        advancedToggle: 'Provide Corrected Stop Loss',
        advancedLabel: 'Corrected Stop Loss Price',
        advancedPlaceholder: 'e.g., 4123.5',
        advancedHelp: 'This helps the AI understand why the original stop loss failed.'
    };

    // Parse and validate P/L
    const pnlNum = parseFloat(pnl);
    const isPnlValid = !isNaN(pnlNum) && pnlNum >= 0 && pnl.trim() !== '';

    // Build feedback object
    const buildFeedback = () => {
        const finalPnl = isWin ? Math.abs(pnlNum) : -Math.abs(pnlNum);
        return {
            pnlAmount: finalPnl,
            correctedStopLoss: !isWin && isAdvanced ? correctedValue : undefined,
            correctedTakeProfit: isWin && isAdvanced ? correctedValue : undefined,
            // Include selected entries if multiple entries exist
            selectedEntryIndices: hasMultipleEntries ? selectedEntryIndices : undefined,
        };
    };

    const handleAutoCapture = () => {
        if (isPnlValid) {
            onAutoCapture(buildFeedback());
        }
    };

    const handleUpload = () => {
        if (isPnlValid) {
            onUploadScreenshot(buildFeedback());
        }
    };

    const handleSkip = () => {
        if (isPnlValid) {
            onSkip(buildFeedback());
        }
    };

    return (
        <div role="dialog" aria-modal="true" aria-label="Capture trade data" className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className={`bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg border ${colors.border} animate-fade-in`}>
                {/* Header */}
                <div className={`p-5 border-b border-white/5 ${colors.bg}`}>
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">{content.emoji}</span>
                        <div>
                            <h3 className={`text-lg font-bold ${colors.text}`}>
                                {content.title}
                            </h3>
                            <p className="text-sm text-zinc-400 mt-0.5">
                                <span className="text-white font-semibold">{coinName}</span>
                            </p>
                        </div>
                    </div>
                </div>

                {/* P/L Input Section */}
                <div className="p-5 border-b border-white/5">
                    <div className="space-y-4">
                        {/* Main P/L Input */}
                        <div>
                            <label htmlFor="pnl-amount" className="block text-sm font-medium text-zinc-300 mb-2">
                                {content.pnlLabel} <span className="text-rose-400">*</span>
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono">$</span>
                                <input
                                    type="number"
                                    id="pnl-amount"
                                    value={pnl}
                                    onChange={e => setPnl(e.target.value)}
                                    placeholder="250"
                                    className="w-full bg-zinc-800 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-white font-mono text-lg focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                                    autoFocus
                                />
                            </div>
                            {pnl && !isPnlValid && (
                                <p className="mt-1.5 text-xs text-rose-400">Please enter a valid positive number</p>
                            )}
                        </div>

                        {/* Entry Point Selector - shown when multiple entries exist */}
                        {hasMultipleEntries && (
                            <div className="pt-3 border-t border-white/5">
                                <label className="block text-sm font-medium text-zinc-300 mb-2">
                                    📍 Which entry was triggered?
                                </label>
                                <div className="space-y-2 pl-1">
                                    {entryPoints.map((entry, idx) => (
                                        <label key={idx} className="flex items-center cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={selectedEntryIndices.includes(idx)}
                                                onChange={() => {
                                                    if (selectedEntryIndices.includes(idx)) {
                                                        // Don't allow deselecting all entries
                                                        if (selectedEntryIndices.length > 1) {
                                                            setSelectedEntryIndices(prev => prev.filter(i => i !== idx));
                                                        }
                                                    } else {
                                                        setSelectedEntryIndices(prev => [...prev, idx]);
                                                    }
                                                }}
                                                className="h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-cyan-600 focus:ring-cyan-500"
                                            />
                                            <span className="ml-3 text-sm font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">
                                                <span className="text-zinc-500">Entry {idx + 1}:</span>{' '}
                                                <span className="font-mono text-white">${entry.price}</span>
                                                {entry.description && (
                                                    <span className="text-zinc-500 text-xs ml-2">({entry.description})</span>
                                                )}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                <p className="mt-2 text-xs text-zinc-500">
                                    Select which entry price(s) were filled. This helps with accurate backtesting.
                                </p>
                            </div>
                        )}

                        {/* Advanced Toggle */}
                        <div className="pt-2">
                            <label className="flex items-center cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={isAdvanced}
                                    onChange={() => setIsAdvanced(!isAdvanced)}
                                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-cyan-600 focus:ring-cyan-500"
                                />
                                <span className="ml-3 text-sm font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">
                                    {content.advancedToggle}
                                </span>
                            </label>
                        </div>

                        {/* Advanced Input */}
                        {isAdvanced && (
                            <div className="animate-fade-in pl-7">
                                <label htmlFor="corrected-value" className="block text-sm font-medium text-zinc-400 mb-1.5">
                                    {content.advancedLabel}
                                </label>
                                <input
                                    type="text"
                                    id="corrected-value"
                                    value={correctedValue}
                                    onChange={e => setCorrectedValue(e.target.value)}
                                    placeholder={content.advancedPlaceholder}
                                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                />
                                <p className="mt-1.5 text-xs text-zinc-500">{content.advancedHelp}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Data Capture Options - only enabled when P/L is valid */}
                <div className={`p-5 space-y-3 ${!isPnlValid ? 'opacity-50 pointer-events-none' : ''}`}>
                    <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-3">
                        Choose how to capture trade data
                    </p>

                    {/* Auto-Capture Option */}
                    <button
                        onClick={handleAutoCapture}
                        disabled={isCapturing || !isPnlValid}
                        className="w-full p-4 rounded-xl border border-cyan-500/20 bg-cyan-950/30 hover:bg-cyan-950/50 hover:border-cyan-500/40 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden"
                    >
                        {isCapturing && (
                            <div className="absolute inset-0 bg-cyan-500/10 animate-pulse" />
                        )}
                        <div className="flex items-start gap-4 relative z-10">
                            <div className="text-3xl">{isCapturing ? '⏳' : '⚡'}</div>
                            <div className="flex-1">
                                <div className="font-bold text-cyan-300 group-hover:text-cyan-200 transition-colors flex items-center gap-2">
                                    {isCapturing ? 'Capturing...' : 'Auto-Capture & Log'}
                                    {!isCapturing && (
                                        <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">
                                            Recommended
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-zinc-400 mt-1 leading-relaxed">
                                    {isCapturing
                                        ? 'Fetching market data from Binance...'
                                        : 'Instantly fetch current market data. Trade will be logged after capture completes.'
                                    }
                                </div>
                            </div>
                        </div>
                    </button>

                    {/* Upload Screenshot Option */}
                    <button
                        onClick={handleUpload}
                        disabled={isCapturing || !isPnlValid}
                        className="w-full p-4 rounded-xl border border-white/10 bg-zinc-800/50 hover:bg-zinc-800 hover:border-cyan-500/30 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <div className="flex items-start gap-4">
                            <div className="text-3xl">📸</div>
                            <div className="flex-1">
                                <div className="font-bold text-white group-hover:text-cyan-300 transition-colors">
                                    Upload Screenshot & Log
                                </div>
                                <div className="text-xs text-zinc-500 mt-1 leading-relaxed">
                                    Manually upload a screenshot. Trade will be logged after upload.
                                </div>
                            </div>
                        </div>
                    </button>

                    {/* Skip Option */}
                    <button
                        onClick={handleSkip}
                        disabled={isCapturing || !isPnlValid}
                        className="w-full p-3 rounded-xl border border-white/5 bg-zinc-900/50 hover:bg-zinc-800/50 hover:border-white/10 transition-all text-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <span className="text-sm text-zinc-500 hover:text-zinc-400 transition-colors">
                            Log without data capture →
                        </span>
                    </button>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-white/5 bg-zinc-950/50">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] text-zinc-600 max-w-[200px]">
                            Trade will only be finalized after you confirm the capture method
                        </p>
                        <button
                            onClick={onClose}
                            disabled={isCapturing}
                            className="py-2 px-4 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors text-sm disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DataCaptureModal;
