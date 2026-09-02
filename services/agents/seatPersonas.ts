/**
 * seatPersonas — per-seat debate personas for USER TEAMS.
 *
 * A team seat carries an optional role (a built-in AnalystRole) and
 * optional trader instructions (customPrompt). This module turns that
 * pair into the system directive each seat receives:
 *
 *  - role, no instructions → the built-in role prompt (AnalystLensService's
 *    curated persona), inherited as-is but editable later.
 *  - role + instructions   → role prompt + a TRADER INSTRUCTIONS block
 *    (refinement; instructions win on conflict).
 *  - no role, instructions → the instructions REPLACE the default mandate.
 *  - no role, no instructions → the general-analyst default: full-scope
 *    market analysis aimed at the best signal, grounded in real data via
 *    desk tools + web search.
 *
 * The same string feeds BOTH prompt seams — the openings phase
 * (useAnalysisPipeline seatDirective) and the rebuttal rounds
 * (ensembleService seatPersonas → rolePrefix) — so a seat's persona
 * survives the whole debate.
 */

import { AnalystRole } from '../../types/enums';
import { ANALYST_ROLE_DEFINITIONS } from '../ui/AnalystLensService';
import type { AgentTeamSeat } from './agentRoster';

/** Default mandate when a seat has no role and no instructions. */
export const GENERAL_ANALYST_DEFAULT_PROMPT = [
    'You are a GENERAL MARKET ANALYST. Your mandate: analyze the market across every dimension available to you and help build the strongest, most actionable trading signal on the floor.',
    'Ground every claim in real data FIRST — use your desk tools (price snapshot, order book, derivatives, session context) and web search before reasoning; never argue from a stale snapshot or invent numbers.',
    'Cover market structure and trend context, key levels (support/resistance/liquidity), momentum, the volatility regime, and the risk picture (invalidation, failure scenarios).',
    'End with a clear, falsifiable read: direction, conviction, entry/stop/take-profit levels where the data supports them, and exactly what would prove you wrong.',
].join('\n');

/** The built-in prompt for a seat role ('' for UNASSIGNED / absent). */
export const builtInPromptForRole = (role?: AnalystRole): string => {
    if (!role || role === AnalystRole.UNASSIGNED) return '';
    return ANALYST_ROLE_DEFINITIONS[role]?.promptPrefix ?? '';
};

/** True when the seat carries an explicit persona (role or instructions). */
export const seatHasPersona = (seat?: Pick<AgentTeamSeat, 'role' | 'customPrompt'> | null): boolean =>
    Boolean(seat && (seat.role || (seat.customPrompt ?? '').trim()));

/**
 * The full persona directive for one seat. Always non-empty — an
 * unroled seat gets the general-analyst default mandate.
 */
export const seatPersonaPrompt = (seat?: Pick<AgentTeamSeat, 'role' | 'customPrompt'> | null): string => {
    const custom = (seat?.customPrompt ?? '').trim();
    const builtIn = builtInPromptForRole(seat?.role);
    if (builtIn && custom) {
        return `${builtIn}\n\nTRADER INSTRUCTIONS (refine your role with these — they win on conflict):\n${custom}`;
    }
    if (builtIn) return builtIn;
    if (custom) return custom;
    return GENERAL_ANALYST_DEFAULT_PROMPT;
};
