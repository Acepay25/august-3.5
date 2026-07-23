/**
 * ScenarioSimulator
 * 
 * Fullscreen modal for "What If" trade parameter adjustment.
 * Clean, modern design with real-time R:R calculation and Monte Carlo integration.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Message, LoggedTrade, TradeOutcome } from '../../types';
import { CloseIcon } from '../shared/Icons';
import {
    ScenarioConfig,
    ScenarioMetrics,
    ScenarioResult,
    extractConfigFromAnalysis,
    calculateMetrics,
    compareScenarios,
    findHistoricalMatches,
    calculateHistoricalWinRate,
    runScenarioMonteCarlo,
    generateSuggestions,
} from '../../services/backtesting/ScenarioSimulatorService';

interface ScenarioSimulatorProps {
    message: Message;
    loggedTrades: LoggedTrade[];
    leverage: number;
    onClose: () => void;
}

const ScenarioSimulator: React.FC<ScenarioSimulatorProps> = ({
    message,
    loggedTrades,
    leverage,
    onClose,
}) => {
    // Extract original config from analysis
    const originalConfig = useMemo(() => {
        if (!message.analysis) return null;
        return extractConfigFromAnalysis(message.analysis, leverage, 1000);
    }, [message.analysis, leverage]);

    // Scenario state (user-adjustable values)
    const [entry, setEntry] = useState<string>('');
    const [stopLoss, setStopLoss] = useState<string>('');
    const [target1, setTarget1] = useState<string>('');
    const [target2, setTarget2] = useState<string>('');
    const [scenarioLeverage, setScenarioLeverage] = useState<number>(leverage);
    const [positionSize, setPositionSize] = useState<string>('1000');

    // Results state
    const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    // Initialize values from original config
    useEffect(() => {
        if (originalConfig) {
            setEntry(originalConfig.entry.toString());
            setStopLoss(originalConfig.stopLoss.toString());
            setTarget1(originalConfig.takeProfits[0]?.toString() || '');
            setTarget2(originalConfig.takeProfits[1]?.toString() || '');
            setScenarioLeverage(originalConfig.leverage);
            setPositionSize(originalConfig.positionSizeUSD.toString());
        }
    }, [originalConfig]);

    // Build current scenario config from inputs
    const currentScenarioConfig: ScenarioConfig | null = useMemo(() => {
        const entryNum = parseFloat(entry);
        const slNum = parseFloat(stopLoss);
        const tp1Num = parseFloat(target1);

        if (isNaN(entryNum) || isNaN(slNum) || entryNum <= 0 || slNum <= 0) {
            return null;
        }

        const takeProfits: number[] = [];
        if (!isNaN(tp1Num) && tp1Num > 0) takeProfits.push(tp1Num);
        const tp2Num = parseFloat(target2);
        if (!isNaN(tp2Num) && tp2Num > 0) takeProfits.push(tp2Num);

        // Estimate TP if not provided
        if (takeProfits.length === 0) {
            const distance = Math.abs(entryNum - slNum);
            const direction = originalConfig?.direction || 'Long';
            takeProfits.push(direction === 'Long' ? entryNum + distance * 2 : entryNum - distance * 2);
        }

        return {
            entry: entryNum,
            stopLoss: slNum,
            takeProfits,
            direction: originalConfig?.direction || 'Long',
            leverage: scenarioLeverage,
            positionSizeUSD: parseFloat(positionSize) || 1000,
            coinName: originalConfig?.coinName || 'Unknown',
            patternFamily: originalConfig?.patternFamily,
        };
    }, [entry, stopLoss, target1, target2, scenarioLeverage, positionSize, originalConfig]);

    // Calculate metrics in real-time (no Monte Carlo - fast)
    const currentMetrics = useMemo(() => {
        if (!currentScenarioConfig) return null;
        return calculateMetrics(currentScenarioConfig);
    }, [currentScenarioConfig]);

    // Compare with original
    const comparison = useMemo(() => {
        if (!originalConfig || !currentScenarioConfig) return null;
        return compareScenarios(originalConfig, currentScenarioConfig);
    }, [originalConfig, currentScenarioConfig]);

    // Run full analysis with Monte Carlo (debounced)
    const runFullAnalysis = useCallback(() => {
        if (!currentScenarioConfig) return;

        setIsCalculating(true);

        // Use setTimeout to allow UI to update before heavy computation
        setTimeout(() => {
            const historicalMatches = findHistoricalMatches(currentScenarioConfig, loggedTrades);
            const monteCarlo = runScenarioMonteCarlo(currentScenarioConfig, 300);
            const metrics = calculateMetrics(currentScenarioConfig);
            const suggestions = generateSuggestions(currentScenarioConfig, metrics, historicalMatches);

            setScenarioResult({
                config: currentScenarioConfig,
                metrics,
                monteCarlo,
                historicalMatches,
                suggestions,
            });
            setIsCalculating(false);
        }, 50);
    }, [currentScenarioConfig, loggedTrades]);

    // Run analysis when scenario changes
    useEffect(() => {
        if (currentScenarioConfig) {
            const timeout = setTimeout(runFullAnalysis, 300); // Debounce
            return () => clearTimeout(timeout);
        }
    }, [currentScenarioConfig, runFullAnalysis]);

    // Reset to original values
    const handleReset = () => {
        if (originalConfig) {
            setEntry(originalConfig.entry.toString());
            setStopLoss(originalConfig.stopLoss.toString());
            setTarget1(originalConfig.takeProfits[0]?.toString() || '');
            setTarget2(originalConfig.takeProfits[1]?.toString() || '');
            setScenarioLeverage(originalConfig.leverage);
            setPositionSize(originalConfig.positionSizeUSD.toString());
        }
    };

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Get direction color
    const directionColor = originalConfig?.direction === 'Long'
        ? 'text-emerald-400'
        : 'text-rose-400';

    const directionBg = originalConfig?.direction === 'Long'
        ? 'bg-emerald-500/10 border-emerald-500/30'
        : 'bg-rose-500/10 border-rose-500/30';

    if (!originalConfig) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                <div className="bg-zinc-900 rounded-2xl p-8 border border-white/10 text-center">
                    <p className="text-zinc-400">Unable to load scenario data</p>
                    <button onClick={onClose} className="mt-4 px-4 py-2 bg-zinc-800 rounded-lg text-zinc-300 hover:bg-zinc-700">
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
            {/* Modal Container */}
            <div className="relative w-full max-w-5xl h-[90vh] mx-4 bg-zinc-950 rounded-2xl border border-purple-500/30 shadow-2xl shadow-purple-500/10 overflow-hidden flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-purple-950/50 to-zinc-950">
                    <div className="flex items-center gap-4">
                        <span className="text-2xl">🎮</span>
                        <div>
                            <h2 className="text-lg font-black text-white tracking-tight">
                                SCENARIO SIMULATOR
                            </h2>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-sm font-mono text-purple-300">{originalConfig.coinName}</span>
                                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded border ${directionBg} ${directionColor}`}>
                                    {originalConfig.direction}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleReset}
                            className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                        >
                            Reset
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                        {/* LEFT COLUMN - Parameter Controls */}
                        <div className="space-y-5">
                            {/* Helper for Step Calculation */}
                            {(() => {
                                const getSmartStep = (valStr: string) => {
                                    const val = parseFloat(valStr);
                                    if (isNaN(val) || val === 0) return 1;
                                    if (val > 10000) return 10;
                                    if (val > 1000) return 1;
                                    if (val > 100) return 0.5;
                                    if (val > 10) return 0.1;
                                    if (val > 1) return 0.01;
                                    return 0.0001;
                                };

                                const adjust = (setter: (v: string) => void, current: string, factor: number) => {
                                    const val = parseFloat(current) || 0;
                                    const step = getSmartStep(current);
                                    const newVal = val + (step * factor);
                                    // Handle precision to avoid floating point errors
                                    const precision = step.toString().split('.')[1]?.length || 0;
                                    setter(newVal.toFixed(precision));
                                };

                                return (
                                    <div className="bg-zinc-900/50 rounded-xl border border-white/10 p-5">
                                        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">
                                            Adjust Parameters
                                        </h3>

                                        {/* Entry Price */}
                                        <div className="mb-4">
                                            <label className="block text-[10px] uppercase font-bold text-blue-400 tracking-wider mb-1.5">
                                                Entry Price
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => adjust(setEntry, entry, -1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                    -
                                                </button>
                                                <input
                                                    type="number"
                                                    value={entry}
                                                    onChange={(e) => setEntry(e.target.value)}
                                                    className="w-full bg-zinc-800 border border-blue-500/30 rounded-lg px-4 py-3 text-lg font-mono text-center text-blue-200 focus:outline-none focus:border-blue-500/60"
                                                    step="any"
                                                />
                                                <button onClick={() => adjust(setEntry, entry, 1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                    +
                                                </button>
                                            </div>
                                        </div>

                                        {/* Stop Loss */}
                                        <div className="mb-4">
                                            <label className="block text-[10px] uppercase font-bold text-rose-400 tracking-wider mb-1.5">
                                                Stop Loss
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => adjust(setStopLoss, stopLoss, -1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                    -
                                                </button>
                                                <input
                                                    type="number"
                                                    value={stopLoss}
                                                    onChange={(e) => setStopLoss(e.target.value)}
                                                    className="w-full bg-zinc-800 border border-rose-500/30 rounded-lg px-4 py-3 text-lg font-mono text-center text-rose-200 focus:outline-none focus:border-rose-500/60"
                                                    step="any"
                                                />
                                                <button onClick={() => adjust(setStopLoss, stopLoss, 1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                    +
                                                </button>
                                            </div>
                                        </div>

                                        {/* Take Profit 1 */}
                                        <div className="mb-4">
                                            <label className="block text-[10px] uppercase font-bold text-emerald-400 tracking-wider mb-1.5">
                                                Target 1
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => adjust(setTarget1, target1, -1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                    -
                                                </button>
                                                <input
                                                    type="number"
                                                    value={target1}
                                                    onChange={(e) => setTarget1(e.target.value)}
                                                    className="w-full bg-zinc-800 border border-emerald-500/30 rounded-lg px-4 py-3 text-lg font-mono text-center text-emerald-200 focus:outline-none focus:border-emerald-500/60"
                                                    step="any"
                                                />
                                                <button onClick={() => adjust(setTarget1, target1, 1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                    +
                                                </button>
                                            </div>
                                        </div>

                                        {/* Take Profit 2 */}
                                        <div className="mb-4">
                                            <label className="block text-[10px] uppercase font-bold text-emerald-400/70 tracking-wider mb-1.5">
                                                Target 2 (Optional)
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => adjust(setTarget2, target2, -1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                    -
                                                </button>
                                                <input
                                                    type="number"
                                                    value={target2}
                                                    onChange={(e) => setTarget2(e.target.value)}
                                                    className="w-full bg-zinc-800 border border-emerald-500/20 rounded-lg px-4 py-3 text-lg font-mono text-center text-emerald-200/80 focus:outline-none focus:border-emerald-500/40"
                                                    step="any"
                                                    placeholder="—"
                                                />
                                                <button onClick={() => adjust(setTarget2, target2, 1)} className="p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                    +
                                                </button>
                                            </div>
                                        </div>

                                        {/* Leverage & Position Size */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-[10px] uppercase font-bold text-yellow-400 tracking-wider mb-1.5">
                                                    Leverage
                                                </label>
                                                <select
                                                    value={scenarioLeverage}
                                                    onChange={(e) => setScenarioLeverage(parseInt(e.target.value))}
                                                    className="w-full bg-zinc-800 border border-yellow-500/30 rounded-lg px-4 py-3 text-lg font-mono text-center text-yellow-200 focus:outline-none focus:border-yellow-500/60 appearance-none"
                                                >
                                                    {[1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125].map((lev) => (
                                                        <option key={lev} value={lev}>{lev}x</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] uppercase font-bold text-purple-400 tracking-wider mb-1.5">
                                                    Position ($)
                                                </label>
                                                <input
                                                    type="number"
                                                    value={positionSize}
                                                    onChange={(e) => setPositionSize(e.target.value)}
                                                    className="w-full bg-zinc-800 border border-purple-500/30 rounded-lg px-4 py-3 text-lg font-mono text-center text-purple-200 focus:outline-none focus:border-purple-500/60"
                                                    step="100"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Suggestions */}
                            {scenarioResult?.suggestions && scenarioResult.suggestions.length > 0 && (
                                <div className="bg-cyan-950/20 rounded-xl border border-cyan-500/20 p-4">
                                    <h4 className="text-[10px] uppercase font-bold text-cyan-400 tracking-widest mb-3">
                                        💡 Suggestions
                                    </h4>
                                    <div className="space-y-2">
                                        {scenarioResult.suggestions.map((s, i) => (
                                            <p key={i} className="text-xs text-cyan-100/80">{s}</p>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* RIGHT COLUMN - Results */}
                        <div className="space-y-5">

                            {/* R:R Comparison Card */}
                            <div className="bg-zinc-900/50 rounded-xl border border-white/10 p-5">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">
                                    Impact Analysis
                                </h3>

                                <div className="grid grid-cols-2 gap-4">
                                    {/* Original */}
                                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-white/5">
                                        <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest">Original</span>
                                        <div className="text-3xl font-black text-zinc-400 mt-1">
                                            1:{comparison?.original.rrRatio || '—'}
                                        </div>
                                        <div className="text-[10px] text-zinc-600 mt-1">
                                            Risk: {comparison?.original.riskPercent || 0}%
                                        </div>
                                    </div>

                                    {/* Scenario */}
                                    <div className={`rounded-lg p-4 border ${comparison && comparison.rrChange > 0
                                        ? 'bg-emerald-950/30 border-emerald-500/30'
                                        : comparison && comparison.rrChange < 0
                                            ? 'bg-rose-950/30 border-rose-500/30'
                                            : 'bg-zinc-800/50 border-white/5'
                                        }`}>
                                        <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-widest">Scenario</span>
                                        <div className={`text-3xl font-black mt-1 ${comparison && comparison.rrChange > 0 ? 'text-emerald-400' :
                                            comparison && comparison.rrChange < 0 ? 'text-rose-400' : 'text-white'
                                            }`}>
                                            1:{currentMetrics?.rrRatio || '—'}
                                        </div>
                                        <div className="text-[10px] text-zinc-600 mt-1">
                                            Risk: {currentMetrics?.riskPercent || 0}%
                                        </div>
                                    </div>
                                </div>

                                {/* Change Badge */}
                                {comparison && comparison.rrChange !== 0 && (
                                    <div className={`mt-4 text-center text-sm font-bold py-2 rounded-lg ${comparison.rrChange > 0
                                        ? 'bg-emerald-500/10 text-emerald-400'
                                        : 'bg-rose-500/10 text-rose-400'
                                        }`}>
                                        R:R {comparison.rrChange > 0 ? '+' : ''}{comparison.rrChange}
                                        <span className="text-xs opacity-70 ml-2">
                                            ({comparison.rrChangePercent > 0 ? '+' : ''}{comparison.rrChangePercent}%)
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Monte Carlo Results */}
                            {scenarioResult?.monteCarlo && (
                                <div className="bg-zinc-900/50 rounded-xl border border-white/10 p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
                                            Monte Carlo Simulation
                                        </h3>
                                        {isCalculating && (
                                            <span className="text-[9px] text-cyan-400 animate-pulse">Calculating...</span>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-3 gap-3 mb-4">
                                        <div className="text-center p-3 rounded-lg bg-black/30">
                                            <span className="text-[9px] text-zinc-500 block">Win Rate</span>
                                            <span className={`text-xl font-black ${scenarioResult.monteCarlo.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'
                                                }`}>
                                                {scenarioResult.monteCarlo.winRate}%
                                            </span>
                                        </div>
                                        <div className="text-center p-3 rounded-lg bg-black/30">
                                            <span className="text-[9px] text-zinc-500 block">EV</span>
                                            <span className={`text-xl font-black ${scenarioResult.monteCarlo.expectedValue >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                                }`}>
                                                {scenarioResult.monteCarlo.expectedValue >= 0 ? '+' : ''}
                                                {scenarioResult.monteCarlo.expectedValue}%
                                            </span>
                                        </div>
                                        <div className="text-center p-3 rounded-lg bg-black/30">
                                            <span className="text-[9px] text-zinc-500 block">Max DD</span>
                                            <span className="text-xl font-black text-amber-400">
                                                {scenarioResult.monteCarlo.maxDrawdownAvg}%
                                            </span>
                                        </div>
                                    </div>

                                    {/* Outcome Distribution Bar */}
                                    <div className="mt-3">
                                        <div className="flex justify-between text-[8px] text-zinc-500 mb-1">
                                            <span>TP1: {scenarioResult.monteCarlo.probabilities.tp1Hit}%</span>
                                            <span>TP2: {scenarioResult.monteCarlo.probabilities.tp2Hit}%</span>
                                            <span>SL: {scenarioResult.monteCarlo.probabilities.slHit}%</span>
                                        </div>
                                        <div className="h-3 rounded-full overflow-hidden flex bg-zinc-800">
                                            <div
                                                className="h-full bg-emerald-500"
                                                style={{ width: `${scenarioResult.monteCarlo.probabilities.tp1Hit}%` }}
                                            />
                                            <div
                                                className="h-full bg-emerald-400"
                                                style={{ width: `${scenarioResult.monteCarlo.probabilities.tp2Hit}%` }}
                                            />
                                            <div
                                                className="h-full bg-rose-500"
                                                style={{ width: `${scenarioResult.monteCarlo.probabilities.slHit}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Historical Matches */}
                            {scenarioResult?.historicalMatches && scenarioResult.historicalMatches.length > 0 && (
                                <div className="bg-zinc-900/50 rounded-xl border border-white/10 p-5">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">
                                        Historical Matches
                                    </h3>

                                    {(() => {
                                        const stats = calculateHistoricalWinRate(scenarioResult.historicalMatches);
                                        return (
                                            <div className={`text-center p-3 rounded-lg mb-4 ${stats.winRate >= 60 ? 'bg-emerald-950/30 border border-emerald-500/20' :
                                                stats.winRate >= 40 ? 'bg-yellow-950/30 border border-yellow-500/20' :
                                                    'bg-rose-950/30 border border-rose-500/20'
                                                }`}>
                                                <span className="text-2xl font-black">
                                                    {stats.winRate}%
                                                </span>
                                                <span className="text-xs text-zinc-400 ml-2">
                                                    win rate ({stats.wins}W / {stats.losses}L)
                                                </span>
                                            </div>
                                        );
                                    })()}

                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {scenarioResult.historicalMatches.slice(0, 3).map((match, i) => (
                                            <div
                                                key={i}
                                                className={`text-[10px] px-3 py-2 rounded-lg flex items-center justify-between ${match.trade.outcome === TradeOutcome.WIN
                                                    ? 'bg-emerald-950/20 text-emerald-300'
                                                    : 'bg-rose-950/20 text-rose-300'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold">
                                                        {match.trade.outcome === TradeOutcome.WIN ? '✓' : '✗'}
                                                    </span>
                                                    <span className="font-mono">{match.trade.analysis.coinName}</span>
                                                </div>
                                                <span className="text-zinc-500">{match.similarityScore}% match</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* USD Risk/Reward Display */}
                            {currentMetrics && (
                                <div className="bg-zinc-900/50 rounded-xl border border-white/10 p-5">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">
                                        Dollar Impact
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="text-center p-3 rounded-lg bg-rose-950/20 border border-rose-500/20">
                                            <span className="text-[9px] text-rose-400 block">Risk</span>
                                            <span className="text-xl font-black text-rose-400">
                                                ${currentMetrics.riskUSD.toLocaleString()}
                                            </span>
                                            <span className="text-[9px] text-zinc-500 block">
                                                {currentMetrics.leveragedRiskPercent}% of position
                                            </span>
                                        </div>
                                        <div className="text-center p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/20">
                                            <span className="text-[9px] text-emerald-400 block">Reward (TP1)</span>
                                            <span className="text-xl font-black text-emerald-400">
                                                ${currentMetrics.rewardUSD.toLocaleString()}
                                            </span>
                                            <span className="text-[9px] text-zinc-500 block">
                                                {currentMetrics.leveragedRewardPercent}% of position
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-white/10 bg-zinc-950 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-600">
                        Press <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-[9px]">ESC</kbd> to close
                    </span>
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm rounded-lg transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScenarioSimulator;
