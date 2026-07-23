// =============================================================================
// ANALYST LENS TYPES - Specialized roles for 3-analyst ensemble debates
// =============================================================================

import { AIProvider, AnalystRole } from './enums';

/**
 * User's role assignment configuration.
 * Maps a role to a specific AI provider.
 */
export interface AnalystRoleAssignment {
  role: AnalystRole;
  assignedProvider: AIProvider | null;
  assignedModel?: string;  // Optional specific model override
}

/**
 * Trading style for analyst lenses
 * - position: Long-term position trades (Daily/Weekly focus)
 * - swing: Standard swing/intraday trading (4H/Daily focus)
 * - scalp: Quick scalp trades (1m/5m/15m focus)
 * - auto: Automatically detect based on market conditions
 */
export type TradingStyle = 'position' | 'swing' | 'scalp' | 'auto';

/**
 * Full configuration for analyst lenses.
 */
export interface AnalystLensConfig {
  enabled: boolean;
  assignments: AnalystRoleAssignment[];
  tradingStyle: TradingStyle;  // Trading style mode
}
