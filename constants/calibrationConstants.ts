/**
 * Calibration Constants
 * Named constants for confidence calibration to eliminate magic numbers
 */

// ============================================================================
// SAMPLE SIZE THRESHOLDS
// ============================================================================

/**
 * Minimum number of trades required before calibration data is considered statistically reliable.
 * Increased from 3 to 10 for better statistical significance.
 */
export const MIN_TRADES_FOR_CALIBRATION = 10;

/**
 * Minimum trades needed before showing calibration data in AI prompts.
 */
export const MIN_TRADES_FOR_PROMPT_DISPLAY = 5;

/**
 * Minimum trades needed before calibration notes appear in recommendations.
 */
export const MIN_TRADES_FOR_CALIBRATION_NOTE = 10;

// ============================================================================
// TIME DECAY CONFIGURATION
// ============================================================================

/**
 * Exponential decay factor for time-weighted calibration.
 * A trade from 30 days ago will have weight: 0.95^30 ≈ 21.5%
 * A trade from 7 days ago will have weight: 0.95^7 ≈ 69.8%
 */
export const DECAY_FACTOR = 0.95;

/**
 * Maximum age in days to consider a trade for calibration.
 * Trades older than this are excluded from decay calculations.
 */
export const MAX_TRADE_AGE_DAYS = 90;

// ============================================================================
// CONFIDENCE SCORE SYSTEM (Point-based cascade)
// ============================================================================

/**
 * Starting score for confidence calculation.
 * Penalties are deducted from this base.
 */
export const CONFIDENCE_BASE_SCORE = 100;

/**
 * Score thresholds for confidence level mapping.
 */
export const CONFIDENCE_THRESHOLDS = {
    HIGH: 80,      // Score >= 80 → High confidence
    MEDIUM: 55,    // Score >= 55 → Medium confidence
    LOW: 30,       // Score >= 30 → Low confidence
    // Below 30 → Avoid
} as const;

/**
 * Point penalties for various validation failures.
 * These accumulate to determine final confidence level.
 */
export const CONFIDENCE_PENALTIES = {
    // Confluence penalties
    CONFLUENCE_CONFLICT: 25,           // MTF confluence contradicts direction
    WEAK_CONFLUENCE: 10,               // Weak MTF confluence
    CONFLUENCE_MULTIPLE_CONFLICTS: 15, // Multiple conflicting signals

    // Risk/Reward penalties
    RR_BELOW_MINIMUM: 15,              // R:R ratio below required minimum
    TIGHT_STOP_LOSS: 20,               // Stop loss tighter than 1x ATR
    WIDE_STOP_LOSS: 5,                 // Stop loss > 3x ATR (minor warning)

    // Volume penalties
    LOW_VOLUME: 10,                    // Low volume detected
    OBV_DIVERGENCE: 20,                // OBV divergence against trade
    CVD_OPPOSITE: 15,                  // CVD trend opposite to direction

    // Regime penalties
    COUNTER_TREND_STRONG: 25,          // Counter-trend in strong trend
    BREAKOUT_IN_RANGE: 15,             // Breakout trade in ranging market
    RANGE_IN_TREND: 10,                // Range trade in trending market
    VOLATILE_CHOP: 20,                 // Volatile chop market
    REGIME_AVOID: 25,                  // Regime suggests avoiding trades

    // Devil's Advocate penalties
    DEVILS_ADVOCATE_MODERATE: 15,      // Risk score 50-69
    DEVILS_ADVOCATE_HIGH: 25,          // Risk score >= 70

    // Calibration penalties
    POOR_HISTORICAL_ACCURACY: 15,      // Historical accuracy < 60% for High conf
} as const;

// ============================================================================
// STREAK DETECTION CONFIGURATION
// ============================================================================

/**
 * Number of consecutive wins/losses to trigger streak detection.
 */
export const STREAK_THRESHOLD = 3;

/**
 * Maximum streak adjustment to confidence penalty (in points).
 */
export const MAX_STREAK_PENALTY = 20;

/**
 * Points to add/subtract per streak trade beyond threshold.
 */
export const STREAK_PENALTY_PER_TRADE = 5;

// ============================================================================
// SESSION CALIBRATION CONFIGURATION
// ============================================================================

/**
 * Session performance thresholds.
 */
export const SESSION_THRESHOLDS = {
    POOR: 2,     // 2+ consecutive losses = poor session
    CRITICAL: 4, // 4+ losses today = critical session (suggest stop)
} as const;

/**
 * Maximum session penalty points.
 */
export const MAX_SESSION_PENALTY = 25;

// ============================================================================
// BAYESIAN CONFIGURATION
// ============================================================================

/**
 * Prior win rate assumptions (beta distribution parameters).
 * Using weak priors: alpha=2, beta=2 centers around 50%.
 */
export const BAYESIAN_PRIOR = {
    ALPHA: 2,  // Prior wins
    BETA: 2,   // Prior losses
} as const;

/**
 * Minimum sample size for high confidence in Bayesian estimate.
 */
export const BAYESIAN_MIN_SAMPLES_HIGH_CONFIDENCE = 20;

/**
 * Minimum sample size for medium confidence in Bayesian estimate.
 */
export const BAYESIAN_MIN_SAMPLES_MEDIUM_CONFIDENCE = 10;

// ============================================================================
// EXPECTED WIN RATES BY CONFIDENCE LEVEL
// ============================================================================

/**
 * Expected minimum win rates for each confidence level.
 * If actual win rate falls below these, penalties apply.
 */
export const EXPECTED_WIN_RATES = {
    HIGH: 70,    // High confidence should win 70%+
    MEDIUM: 55,  // Medium confidence should win 55%+
    LOW: 40,     // Low confidence should win 40%+
    AVOID: 0,    // Avoid trades shouldn't be taken
} as const;

// ============================================================================
// CROSS-CORRELATION DETECTION
// ============================================================================

/**
 * Minimum win rate threshold to flag a dangerous combination.
 * Combinations below this trigger warnings.
 */
export const DANGEROUS_COMBINATION_THRESHOLD = 45;

/**
 * Minimum sample size for cross-correlation to be considered significant.
 */
export const MIN_SAMPLES_FOR_CORRELATION = 5;
