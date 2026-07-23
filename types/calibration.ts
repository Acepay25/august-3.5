// Confidence Calibration - tracks actual outcomes per AI confidence level

import { AIProvider } from './enums';

/**
 * Individual calibration entry for time-decay calculations.
 * Each logged trade creates a new entry to enable recency weighting.
 */
export interface CalibrationEntry {
  timestamp: string;  // ISO string when trade was logged
  confidence: 'High' | 'Medium' | 'Low' | 'Avoid';
  outcome: 'WIN' | 'LOSS';
}

/**
 * Trading session based on UTC time
 * - Asian: 00:00-08:00 UTC (Tokyo/Singapore)
 * - London: 08:00-16:00 UTC
 * - New York: 13:00-21:00 UTC
 * - Overlap: 13:00-16:00 UTC (London/NY overlap - highest volume)
 */
export type TradingSession = 'asian' | 'london' | 'new_york' | 'overlap';

/**
 * Extended calibration entry with granular tracking dimensions.
 * Tracks accuracy by coin, pattern, timeframe, regime, and AI provider.
 */
export interface GranularCalibrationEntry extends CalibrationEntry {
  coin?: string;                    // e.g., "BTCUSDT"
  pattern?: string;                 // e.g., "Family C", "Bull Flag"
  timeframe?: string;               // e.g., "1h", "4h"
  regime?: 'trending' | 'ranging' | 'volatile' | 'compression';
  provider?: AIProvider;            // Which AI made this prediction
  session?: TradingSession;         // Trading session when trade was taken
}

export interface ConfidenceCalibrationStats {
  wins: number;
  losses: number;
  total: number;
}

/**
 * Provider-specific calibration stats
 */
export interface ProviderCalibration {
  [providerId: string]: ConfidenceCalibrationStats;
}

/**
 * Granular calibration data for multi-dimensional accuracy tracking
 */
export interface GranularCalibration {
  byCoin: { [coin: string]: ConfidenceCalibrationStats };
  byPattern: { [pattern: string]: ConfidenceCalibrationStats };
  byTimeframe: { [tf: string]: ConfidenceCalibrationStats };
  byRegime: { [regime: string]: ConfidenceCalibrationStats };
  byProvider: ProviderCalibration;
  bySession: { [session: string]: ConfidenceCalibrationStats }; // Asian/London/NY/Overlap
  byDayOfWeek: { [day: string]: ConfidenceCalibrationStats };   // Monday, Tuesday, etc.
}

/**
 * Correlation risk assessment result
 */
export interface CorrelationRiskResult {
  btcDominance: number;             // Current BTC dominance %
  btcDominanceTrend: 'rising' | 'falling' | 'stable';
  btcAtMajorLevel: boolean;
  btcLevelType: 'support' | 'resistance' | 'none';
  btcLevelPrice: number | null;
  correlationRiskScore: number;     // 0-100, higher = more risk
  warnings: string[];
}

/**
 * Backtest simulation result for a trade signal
 */
export interface BacktestResult {
  wouldHaveTriggered: boolean;      // Did price reach entry?
  outcome: 'WIN' | 'LOSS' | 'NOT_TRIGGERED';
  hitTarget: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'NONE';
  maxDrawdown: number;              // % drawdown during trade
  timeToOutcome: number;            // Candles until outcome
  priceAtExit: number;
  simulationDetails: string;
}

export interface ConfidenceCalibration {
  high: ConfidenceCalibrationStats;
  medium: ConfidenceCalibrationStats;
  low: ConfidenceCalibrationStats;
  avoid: ConfidenceCalibrationStats;
  lastUpdated?: string;
  /**
   * Individual timestamped entries for time-decay calibration.
   * Used by getCalibratedWinRateWithDecay() to weight recent trades more heavily.
   */
  entries?: CalibrationEntry[];
  /**
   * Granular calibration data for multi-dimensional accuracy tracking.
   * Tracks accuracy by coin, pattern, timeframe, regime, and provider.
   */
  granular?: GranularCalibration;
  /**
   * Extended entries with granular dimensions for detailed analysis.
   */
  granularEntries?: GranularCalibrationEntry[];
}
