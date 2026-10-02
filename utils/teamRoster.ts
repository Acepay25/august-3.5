/**
 * teamRoster — the seat-count bounds the analysis pipeline enforces.
 *
 * These are the only seat bounds in the app: the debate seats come from the
 * ensemble selection (or the Lens pod), and `TEAM_MAX_SEATS` is the hard cap
 * the pipeline clamps them to, so a run can never try to seat more analysts
 * than the pod logic supports.
 *
 * The roster STORE that once lived beside these bounds (services/agents/
 * agentRoster's AgentTeam — the trader's own saved seat list) was removed
 * 2026-10-02: nothing read or wrote it, so it was backed up as a namespace
 * that no code ever produced. The Talk-to chips and the rail read the lens
 * config and the ensemble selection instead.
 */

import { AnalystRole } from '../types/enums';

/** Two analysts minimum: the debate engine needs a second voice to argue with. */
export const TEAM_MIN_SEATS = 2;
/**
 * 2–10. Above the flat floor of 6, seats run as LENS PODS — three pods whose
 * representatives take the floor while every seat still emits its own
 * sealed conviction.
 */
export const TEAM_MAX_SEATS = 10;

/** The three lens seats, in floor order (macro → technical → risk). */
export const LENS_ROSTER_ROLES: AnalystRole[] = [
    AnalystRole.MACRO_VOLATILITY,
    AnalystRole.TECHNICAL_ANALYST,
    AnalystRole.RISK_EXECUTION,
];
