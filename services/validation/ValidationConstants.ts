/**
 * ValidationConstants.ts - Centralized configuration for trade validation thresholds
 * 
 * These values control the sensitivity of various validation checks.
 * Adjusting these allows you to make the system stricter or more lenient
 * without modifying the core validation logic.
 */

// =============================================================================
// PATTERN MEMORY THRESHOLDS
// =============================================================================

/** Similarity % to trigger a warning alert */
export const PATTERN_MEMORY_WARNING_THRESHOLD = 70;

/** Similarity % to trigger automatic confidence downgrade */
export const PATTERN_MEMORY_DOWNGRADE_THRESHOLD = 80;

// =============================================================================
// CROWDED TRADE DETECTION
// =============================================================================

/** Funding rate threshold to consider a trade "crowded" (0.0005 = 0.05%) */
export const FUNDING_RATE_WARNING_THRESHOLD = 0.0005;

/** Funding rate threshold to force confidence downgrade (0.001 = 0.1%) */
export const FUNDING_RATE_DOWNGRADE_THRESHOLD = 0.001;

/** L/S Ratio above which longs are considered "extremely crowded" */
export const LS_RATIO_EXTREME_LONG_THRESHOLD = 2.0;

/** L/S Ratio below which shorts are considered "extremely crowded" (squeeze risk) */
export const LS_RATIO_EXTREME_SHORT_THRESHOLD = 0.5;

// =============================================================================
// DEVIL'S ADVOCATE
// =============================================================================

/** Risk score at or above which confidence is forced to Low */
export const DEVILS_ADVOCATE_HIGH_RISK_THRESHOLD = 70;

/** Risk score at or above which High confidence is downgraded to Medium */
export const DEVILS_ADVOCATE_MEDIUM_RISK_THRESHOLD = 50;

// =============================================================================
// ENTRY TIMING
// =============================================================================

/** Entry timing score below which High confidence is capped at Medium */
export const ENTRY_TIMING_POOR_THRESHOLD = 35;

// =============================================================================
// VALIDATION SCORING
// =============================================================================

/** Score assigned when Risk/Reward validation passes */
export const RR_VALIDATION_PASS_SCORE = 80;

/** Score assigned when Risk/Reward validation fails */
export const RR_VALIDATION_FAIL_SCORE = 30;

// =============================================================================
// SESSION RISK
// =============================================================================

/** Minutes to session end that triggers "closing soon" warning */
export const SESSION_CLOSING_SOON_MINUTES = 15;

// =============================================================================
// CALIBRATION
// =============================================================================

/** Minimum trades required to consider calibration data significant */
export const CALIBRATION_MIN_TRADES = 3;

/** Win rate % below which a "High" confidence level triggers a recalibration warning */
export const HIGH_CONFIDENCE_MIN_WIN_RATE = 60;

// =============================================================================
// SL OPTIMIZATION
// =============================================================================

/** Minimum trades required to calculate SL optimization */
export const SL_OPTIMIZATION_MIN_TRADES = 5;

// =============================================================================
// TIMEFRAME ALIGNMENT
// =============================================================================

/** Timeframes required for each confidence level */
export const TIMEFRAME_REQUIREMENTS: Record<'High' | 'Medium' | 'Low' | 'Avoid', number> = {
    High: 3,
    Medium: 2,
    Low: 1,
    Avoid: 0
};

/** Maximum conflicting signals before forcing downgrade from High */
export const MAX_CONFLICTS_FOR_HIGH_CONFIDENCE = 3;
