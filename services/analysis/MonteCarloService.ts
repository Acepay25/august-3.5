/**
 * MonteCarloService
 * Simulates randomized price paths to stress-test trade setups.
 * 
 * Features:
 * 1. Run 1000 Monte Carlo simulations using Geometric Brownian Motion
 * 2. Calculate probability distribution of outcomes (TP1/TP2/TP3/SL)
 * 3. Calculate ruin risk given position sizing
 * 4. Generate UI-friendly summaries
 */

// =============================================================================
// TYPES
// =============================================================================

export interface MonteCarloResult {
    simulations: number;
    winRate: number;                  // % of sims hitting any TP
    winCount: number;                 // Number of winning sims
    expectedValue: number;            // Average PnL % per trade
    timeframe: string;                // Timeframe used for simulation
    probabilities: {
        tp1Hit: number;
        tp2Hit: number;
        tp3Hit: number;
        slHit: number;
        timeout: number;              // Neither TP nor SL hit within max steps
    };
    maxDrawdownAvg: number;           // Average max drawdown before outcome
    timeToOutcomeAvg: number;         // Average steps until resolution
    confidenceInterval: {
        lower: number;                // 5th percentile outcome
        upper: number;                // 95th percentile outcome
    };
}

// Labeled Monte Carlo result for per-AI display
export interface LabeledMonteCarloResult {
    provider: string;                 // e.g., "Gemini", "DeepSeek", "Moderator"
    result: MonteCarloResult;
    isModeratorFinal?: boolean;       // True if this is from the final moderated setup
}

export interface RuinRiskResult {
    prob25pctDrawdown: number;
    prob50pctDrawdown: number;
    prob75pctDrawdown: number;
    expectedEquityAfter100: number;   // Expected account value after 100 trades
    kellyOptimalSize: number;         // Kelly criterion position size (0-1)
}

export interface SimulationConfig {
    entry: number;
    stopLoss: number;
    takeProfits: number[];            // [TP1, TP2, TP3]
    direction: 'Long' | 'Short';
    atr: number;                      // Current ATR for volatility
    timeframe: string;                // Timeframe of the chart
    trendBias?: number;               // -1 to 1 (negative = bearish, positive = bullish)
    numSimulations?: number;          // Default 1000
    maxSteps?: number;                // Max candles to simulate (default 100)
    marketRegime?: 'strong_trend_up' | 'strong_trend_down' | 'weak_trend_up' | 'weak_trend_down' | 'ranging' | 'volatile_chop' | 'compression';
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEFAULT_SIMULATIONS = 1000;
const DEFAULT_MAX_STEPS = 100;
const ATR_VOLATILITY_FACTOR = 0.5;    // How much of ATR represents per-step volatility
const BIAS_STRENGTH = 0.001;          // How much trend bias affects drift

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a random number from standard normal distribution (Box-Muller transform)
 */
const randomNormal = (): number => {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/**
 * Volatility Regime Configuration
 */
export interface VolatilityRegimeConfig {
    currentRegime: 'strong_trend' | 'volatile_chop' | 'compression' | 'normal';
    regimeMultipliers: {
        strong_trend: { vol: number; drift: number };
        volatile_chop: { vol: number; drift: number };
        compression: { vol: number; drift: number };
        normal: { vol: number; drift: number };
    };
    switchProb: number; // Probability of switching regime per step (Markov chain)
}

const DEFAULT_REGIME_CONFIG: VolatilityRegimeConfig = {
    currentRegime: 'normal',
    regimeMultipliers: {
        strong_trend: { vol: 0.8, drift: 1.2 },    // Smoother moves, stronger trend
        volatile_chop: { vol: 1.5, drift: 0.2 },   // Wild swings, weak trend
        compression: { vol: 0.5, drift: 0.1 },     // Tight range, no trend
        normal: { vol: 1.0, drift: 1.0 }           // Baseline
    },
    switchProb: 0.05 // 5% chance to switch regime per candle
};

/**
 * Simulate one price path using Geometric Brownian Motion with Regime Switching
 */
const simulatePricePath = (
    startPrice: number,
    baseVolatility: number,
    baseDrift: number,
    steps: number,
    regimeConfig: VolatilityRegimeConfig = DEFAULT_REGIME_CONFIG
): number[] => {
    const path = [startPrice];
    let price = startPrice;
    let currentRegime = regimeConfig.currentRegime;

    const regimes = Object.keys(regimeConfig.regimeMultipliers) as (keyof typeof regimeConfig.regimeMultipliers)[];

    for (let i = 0; i < steps; i++) {
        // Markov chain regime switching
        if (Math.random() < regimeConfig.switchProb) {
            // Switch to a random other regime
            const otherRegimes = regimes.filter(r => r !== currentRegime);
            currentRegime = otherRegimes[Math.floor(Math.random() * otherRegimes.length)];
        }

        const multipliers = regimeConfig.regimeMultipliers[currentRegime];

        // Adjust volatility and drift based on current regime
        const effectiveVol = baseVolatility * multipliers.vol;
        const effectiveDrift = baseDrift * multipliers.drift;

        // GBM: dS = μS*dt + σS*dW
        const z = randomNormal();
        const logReturn = effectiveDrift - 0.5 * effectiveVol * effectiveVol + effectiveVol * z;
        price = price * Math.exp(logReturn);
        path.push(price);
    }

    return path;
};

/**
 * Check if price path hits targets or stop loss
 */
const evaluatePath = (
    path: number[],
    entry: number,
    stopLoss: number,
    takeProfits: number[],
    direction: 'Long' | 'Short'
): {
    outcome: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'TIMEOUT';
    pnlPercent: number;
    maxDrawdown: number;
    stepsToOutcome: number;
} => {
    let maxDrawdown = 0;
    let currentDrawdown = 0;
    let outcome: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'TIMEOUT' = 'TIMEOUT';
    let stepsToOutcome = path.length - 1;
    let exitPrice = path[path.length - 1];

    const isLong = direction === 'Long';
    const tp1 = takeProfits[0] || (isLong ? entry * 1.02 : entry * 0.98);
    const tp2 = takeProfits[1] || (isLong ? entry * 1.04 : entry * 0.96);
    const tp3 = takeProfits[2] || (isLong ? entry * 1.06 : entry * 0.94);

    for (let i = 1; i < path.length; i++) {
        const price = path[i];

        // Calculate drawdown from entry
        if (isLong) {
            currentDrawdown = Math.max(0, (entry - price) / entry);
        } else {
            currentDrawdown = Math.max(0, (price - entry) / entry);
        }
        maxDrawdown = Math.max(maxDrawdown, currentDrawdown);

        // Check stop loss
        if (isLong && price <= stopLoss) {
            outcome = 'SL';
            exitPrice = stopLoss;
            stepsToOutcome = i;
            break;
        } else if (!isLong && price >= stopLoss) {
            outcome = 'SL';
            exitPrice = stopLoss;
            stepsToOutcome = i;
            break;
        }

        // Check take profits (check higher TPs first for shorts, lower for longs)
        if (isLong) {
            if (price >= tp3) {
                outcome = 'TP3';
                exitPrice = tp3;
                stepsToOutcome = i;
                break;
            } else if (price >= tp2) {
                outcome = 'TP2';
                exitPrice = tp2;
                stepsToOutcome = i;
                break;
            } else if (price >= tp1) {
                outcome = 'TP1';
                exitPrice = tp1;
                stepsToOutcome = i;
                break;
            }
        } else {
            if (price <= tp3) {
                outcome = 'TP3';
                exitPrice = tp3;
                stepsToOutcome = i;
                break;
            } else if (price <= tp2) {
                outcome = 'TP2';
                exitPrice = tp2;
                stepsToOutcome = i;
                break;
            } else if (price <= tp1) {
                outcome = 'TP1';
                exitPrice = tp1;
                stepsToOutcome = i;
                break;
            }
        }
    }

    // Calculate PnL
    let pnlPercent: number;
    if (isLong) {
        pnlPercent = ((exitPrice - entry) / entry) * 100;
    } else {
        pnlPercent = ((entry - exitPrice) / entry) * 100;
    }

    return {
        outcome,
        pnlPercent,
        maxDrawdown: maxDrawdown * 100,
        stepsToOutcome
    };
};

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Run Monte Carlo simulation for a trade setup
 */
export const runSimulation = (config: SimulationConfig): MonteCarloResult => {
    const {
        entry,
        stopLoss,
        takeProfits,
        direction,
        atr,
        timeframe,
        trendBias = 0,
        numSimulations = DEFAULT_SIMULATIONS,
        maxSteps = DEFAULT_MAX_STEPS,
        marketRegime
    } = config;

    // Calculate volatility from ATR (as percentage of price)
    const volatility = (atr / entry) * ATR_VOLATILITY_FACTOR;

    // Calculate drift (trend bias)
    const drift = trendBias * BIAS_STRENGTH;

    // Map regime from RegimeAnalysis string to internal VolatilityRegimeConfig
    const regimeConfig = { ...DEFAULT_REGIME_CONFIG };
    if (marketRegime) {
        if (marketRegime === 'strong_trend_up' || marketRegime === 'strong_trend_down') {
            regimeConfig.currentRegime = 'strong_trend';
        } else if (marketRegime === 'volatile_chop' || marketRegime === 'weak_trend_up' || marketRegime === 'weak_trend_down') {
            // Treat weak trends as potentially choppy or normal. Mapping weak -> volatile_chop for conservative "stress test"
            // or we could map to normal. Let's map weak -> normal, chop -> volatile_chop
            if (marketRegime.includes('weak')) {
                regimeConfig.currentRegime = 'normal';
            } else {
                regimeConfig.currentRegime = 'volatile_chop';
            }
        } else if (marketRegime === 'compression') {
            regimeConfig.currentRegime = 'compression';
        } else {
            regimeConfig.currentRegime = 'normal'; // 'ranging' falls here
        }
    }

    // Results tracking
    const outcomes: ('TP1' | 'TP2' | 'TP3' | 'SL' | 'TIMEOUT')[] = [];
    const pnls: number[] = [];
    const drawdowns: number[] = [];
    const stepsToResolution: number[] = [];

    // Run simulations
    for (let i = 0; i < numSimulations; i++) {
        const path = simulatePricePath(entry, volatility, drift, maxSteps, regimeConfig);
        const result = evaluatePath(path, entry, stopLoss, takeProfits, direction);

        outcomes.push(result.outcome);
        pnls.push(result.pnlPercent);
        drawdowns.push(result.maxDrawdown);
        stepsToResolution.push(result.stepsToOutcome);
    }

    // Aggregate results
    const tp1Count = outcomes.filter(o => o === 'TP1').length;
    const tp2Count = outcomes.filter(o => o === 'TP2').length;
    const tp3Count = outcomes.filter(o => o === 'TP3').length;
    const slCount = outcomes.filter(o => o === 'SL').length;
    const timeoutCount = outcomes.filter(o => o === 'TIMEOUT').length;

    const winCount = tp1Count + tp2Count + tp3Count;
    const winRate = (winCount / numSimulations) * 100;

    const expectedValue = pnls.reduce((a, b) => a + b, 0) / numSimulations;
    const maxDrawdownAvg = drawdowns.reduce((a, b) => a + b, 0) / numSimulations;
    const timeToOutcomeAvg = stepsToResolution.reduce((a, b) => a + b, 0) / numSimulations;

    // Calculate confidence interval (5th and 95th percentile)
    const sortedPnls = [...pnls].sort((a, b) => a - b);
    const lowerIdx = Math.floor(numSimulations * 0.05);
    const upperIdx = Math.floor(numSimulations * 0.95);

    return {
        simulations: numSimulations,
        winRate: Math.round(winRate * 10) / 10,
        winCount,
        expectedValue: Math.round(expectedValue * 100) / 100,
        timeframe,
        probabilities: {
            tp1Hit: Math.round((tp1Count / numSimulations) * 1000) / 10,
            tp2Hit: Math.round((tp2Count / numSimulations) * 1000) / 10,
            tp3Hit: Math.round((tp3Count / numSimulations) * 1000) / 10,
            slHit: Math.round((slCount / numSimulations) * 1000) / 10,
            timeout: Math.round((timeoutCount / numSimulations) * 1000) / 10
        },
        maxDrawdownAvg: Math.round(maxDrawdownAvg * 100) / 100,
        timeToOutcomeAvg: Math.round(timeToOutcomeAvg * 10) / 10,
        confidenceInterval: {
            lower: Math.round(sortedPnls[lowerIdx] * 100) / 100,
            upper: Math.round(sortedPnls[upperIdx] * 100) / 100
        }
    };
};

/**
 * Calculate ruin risk given position sizing
 */
export const calculateRuinRisk = (
    accountBalance: number,
    positionSize: number,
    leverage: number,
    monteCarloResult: MonteCarloResult
): RuinRiskResult => {
    const winRate = monteCarloResult.winRate / 100;
    const lossRate = 1 - winRate;

    // Calculate average win and loss based on probabilities
    const avgWinPercent = monteCarloResult.expectedValue > 0
        ? monteCarloResult.expectedValue / winRate
        : 2; // Default 2% if unknown

    const avgLossPercent = monteCarloResult.probabilities.slHit > 0
        ? Math.abs(monteCarloResult.confidenceInterval.lower)
        : 1; // Default 1% if unknown

    // Risk per trade as fraction of account
    const riskPerTrade = (positionSize / accountBalance) * (avgLossPercent / 100) * leverage;

    // Simulate 1000 sequences of 100 trades
    const sequenceCount = 1000;
    const tradesPerSequence = 100;

    let count25pct = 0;
    let count50pct = 0;
    let count75pct = 0;
    const finalEquities: number[] = [];

    for (let seq = 0; seq < sequenceCount; seq++) {
        let equity = accountBalance;
        let maxEquity = accountBalance;
        let maxDrawdownReached = 0;

        for (let trade = 0; trade < tradesPerSequence; trade++) {
            const isWin = Math.random() < winRate;

            if (isWin) {
                equity += (positionSize * (avgWinPercent / 100) * leverage);
            } else {
                equity -= (positionSize * (avgLossPercent / 100) * leverage);
            }

            maxEquity = Math.max(maxEquity, equity);
            const currentDrawdown = (maxEquity - equity) / maxEquity;
            maxDrawdownReached = Math.max(maxDrawdownReached, currentDrawdown);
        }

        if (maxDrawdownReached >= 0.25) count25pct++;
        if (maxDrawdownReached >= 0.50) count50pct++;
        if (maxDrawdownReached >= 0.75) count75pct++;
        finalEquities.push(equity);
    }

    const expectedEquity = finalEquities.reduce((a, b) => a + b, 0) / sequenceCount;

    // Kelly Criterion: f* = (bp - q) / b
    // where b = odds (avgWin/avgLoss), p = win prob, q = loss prob
    const b = avgWinPercent / avgLossPercent;
    const kellyFraction = Math.max(0, (b * winRate - lossRate) / b);

    return {
        prob25pctDrawdown: Math.round((count25pct / sequenceCount) * 1000) / 10,
        prob50pctDrawdown: Math.round((count50pct / sequenceCount) * 1000) / 10,
        prob75pctDrawdown: Math.round((count75pct / sequenceCount) * 1000) / 10,
        expectedEquityAfter100: Math.round(expectedEquity),
        kellyOptimalSize: Math.round(kellyFraction * 1000) / 10
    };
};

/**
 * Generate UI-friendly summary of Monte Carlo results
 */
export const generateMonteCarloSummary = (
    result: MonteCarloResult,
    ruinRisk?: RuinRiskResult
): string => {
    let summary = `
╔═══════════════════════════════════════════════════════════════╗
║           MONTE CARLO SIMULATION (${result.simulations} scenarios)           ║
╠═══════════════════════════════════════════════════════════════╣
║ Timeframe: ${result.timeframe.padEnd(8)}                                   ║
║ Win Rate: ${result.winRate.toFixed(1)}% (${result.winCount} / ${result.simulations})              ║
║ Expected Value: ${result.expectedValue >= 0 ? '+' : ''}${result.expectedValue.toFixed(2)}% per trade                         ║
╠═══════════════════════════════════════════════════════════════╣
║ PROBABILITY DISTRIBUTION:                                     ║
║   TP1 Hit: ${result.probabilities.tp1Hit.toFixed(1)}%                                         ║
║   TP2 Hit: ${result.probabilities.tp2Hit.toFixed(1)}%                                         ║
║   TP3 Hit: ${result.probabilities.tp3Hit.toFixed(1)}%                                         ║
║   SL Hit:  ${result.probabilities.slHit.toFixed(1)}%                                         ║
╠═══════════════════════════════════════════════════════════════╣
║ 95% Confidence: ${result.confidenceInterval.lower.toFixed(2)}% to ${result.confidenceInterval.upper.toFixed(2)}%                    ║
║ Avg Drawdown: ${result.maxDrawdownAvg.toFixed(2)}%                                    ║
║ Avg Resolution: ${result.timeToOutcomeAvg.toFixed(0)} candles                              ║
`;

    if (ruinRisk) {
        summary += `╠═══════════════════════════════════════════════════════════════╣
║ RUIN RISK (100 trade sequence):                               ║
║   Prob 25% DD: ${ruinRisk.prob25pctDrawdown.toFixed(1)}%                                       ║
║   Prob 50% DD: ${ruinRisk.prob50pctDrawdown.toFixed(1)}%                                       ║
║   Kelly Size:  ${ruinRisk.kellyOptimalSize.toFixed(1)}% of account                          ║
`;
    }

    summary += `╚═══════════════════════════════════════════════════════════════╝`;

    return summary;
};

/**
 * Generate prompt injection with Monte Carlo context
 */
export const generateMonteCarloPromptInjection = (result: MonteCarloResult): string => {
    const evSign = result.expectedValue >= 0 ? '+' : '';
    const evWarning = result.expectedValue < 0
        ? '⚠️ NEGATIVE EXPECTED VALUE - This setup has historically lost money on average.'
        : '';

    return `
📊 **MONTE CARLO VALIDATION (${result.simulations} simulations on ${result.timeframe.padEnd(8)}):**
- Simulated Win Rate: ${result.winRate.toFixed(1)}% (${result.winCount}/${result.simulations})
- Expected Value: ${evSign}${result.expectedValue.toFixed(2)}% per trade
- TP1 Probability: ${result.probabilities.tp1Hit.toFixed(1)}%
- TP2 Probability: ${result.probabilities.tp2Hit.toFixed(1)}%
- SL Probability: ${result.probabilities.slHit.toFixed(1)}%
- 95% Confidence Range: ${result.confidenceInterval.lower.toFixed(2)}% to ${result.confidenceInterval.upper.toFixed(2)}%
${evWarning}

**Use this data to validate your confidence level.**
`;
};

// =============================================================================
// WEB WORKER API — runs simulations off the main thread
// =============================================================================

let workerInstance: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

const getWorker = (): Worker => {
    if (!workerInstance) {
        workerInstance = new Worker(
            new URL('./monteCarlo.worker.ts', import.meta.url),
            { type: 'module' }
        );
        workerInstance.onmessage = (e: MessageEvent) => {
            const { type, id, result, error } = e.data;
            const pending = pendingRequests.get(id);
            if (!pending) return;
            pendingRequests.delete(id);
            if (type === 'error') {
                pending.reject(new Error(error));
            } else {
                pending.resolve(result);
            }
        };
        workerInstance.onerror = (e) => {
            // Reject all pending requests on worker crash
            for (const [id, pending] of pendingRequests) {
                pending.reject(new Error(e.message || 'Worker crashed'));
                pendingRequests.delete(id);
            }
        };
    }
    return workerInstance;
};

/**
 * Run Monte Carlo simulation in a Web Worker (non-blocking).
 * Falls back to synchronous execution if Workers are unavailable.
 */
export const runSimulationAsync = (config: SimulationConfig): Promise<MonteCarloResult> => {
    if (typeof Worker === 'undefined') {
        return Promise.resolve(runSimulation(config));
    }
    const id = `mc-${++requestId}`;
    return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        getWorker().postMessage({ type: 'runSimulation', id, config });
    });
};

/**
 * Calculate ruin risk in a Web Worker (non-blocking).
 * Falls back to synchronous execution if Workers are unavailable.
 */
export const calculateRuinRiskAsync = (
    accountBalance: number,
    positionSize: number,
    leverage: number,
    monteCarloResult: MonteCarloResult
): Promise<RuinRiskResult> => {
    if (typeof Worker === 'undefined') {
        return Promise.resolve(calculateRuinRisk(accountBalance, positionSize, leverage, monteCarloResult));
    }
    const id = `mc-${++requestId}`;
    return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        getWorker().postMessage({ type: 'calculateRuinRisk', id, accountBalance, positionSize, leverage, monteCarloResult });
    });
};
