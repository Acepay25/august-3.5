/**
 * teamRoster — the single source of "who is on the Team". Both the
 * composer's Talk-to count/mention chips and the rail's Team row
 * derive from this, so the team is always the LIVE ensemble
 * configuration (lens roles when lenses are on, otherwise the three
 * configured experts) — never a hardcoded list.
 *
 * Team sends route through the full harness (ensemble debate + hybrid
 * intelligence + trade log + learning memory); this roster describes
 * the agents that harness will seat.
 */

import { EnsembleModelSelection, ANALYST_ROLE_DEFINITIONS } from '../services/ui/AnalystLensService';
import { AnalystRole } from '../types/enums';
import { AnalystLensConfig } from '../types/lens';
import { ProviderConfig } from '../types/provider';
import { formatModelDisplayName } from './providerUtils';
import { avatarRoleForName, type RolePreset } from '../components/desk/pixelAvatars';
import type { AgentTeam } from '../services/agents/agentRoster';

/** The debate engine rejects fewer than 2 analysts. Teams seat 2–5 on the
 *  flat floor; 6–10 run as LENS PODS (plan §9.1) — three pods whose
 *  representatives take the floor while every seat still emits its own
 *  sealed conviction. */
export const TEAM_MIN_SEATS = 2;
export const TEAM_MAX_SEATS = 10;

/** The three lens seats, in floor order (macro → technical → risk). */
export const LENS_ROSTER_ROLES: AnalystRole[] = [
    AnalystRole.MACRO_VOLATILITY,
    AnalystRole.TECHNICAL_ANALYST,
    AnalystRole.RISK_EXECUTION,
];

/** Lens role → pixel identity color (the same roles the floor seats use). */
const LENS_ROLE_PRESETS: Record<string, RolePreset> = {
    [AnalystRole.MACRO_VOLATILITY]: 'macro',
    [AnalystRole.TECHNICAL_ANALYST]: 'technical',
    [AnalystRole.RISK_EXECUTION]: 'risk',
};

export interface TeamSlot {
    /** Display label — lens short name ("Macro") or provider name. */
    label: string;
    /** Resolved model display ("OpenAI · GPT-5.2") or '' when unassigned. */
    model: string;
    /** Composer glyph: lens role initial (M/T/R) or fixed seat number
     *  (1/2/3 — never provider initials; three K-providers once spelled
     *  an unfortunate word in the avatar stack). */
    initial: string;
    /** Pixel role for identity color on the rail's Team row. */
    role: RolePreset;
    /** Seat role short name ("Macro"/"Technical"/"Risk") when the seat
     *  carries a built-in team role — shown on the rail's team row. */
    roleTag?: string;
}

export const buildTeamRoster = (
    lensConfig: AnalystLensConfig,
    ensembleModelSelection: EnsembleModelSelection,
    providers: ProviderConfig[],
): TeamSlot[] => {
    const readyProviders = providers.filter(p => p.isEnabled && p.apiKey.trim().length > 0);
    if (lensConfig.enabled) {
        return LENS_ROSTER_ROLES.map(role => {
            const def = ANALYST_ROLE_DEFINITIONS[role as AnalystRole];
            const assignment = lensConfig.assignments?.find(item => item.role === role);
            const provider = readyProviders.find(item => item.id === assignment?.assignedProvider);
            const model = assignment?.assignedModel || provider?.models[0] || '';
            return {
                // Lens seats keep their role glyph — role identity,
                // not provider name.
                initial: def.shortName.charAt(0).toUpperCase(),
                label: def.shortName,
                model: provider && model ? `${provider.name} · ${formatModelDisplayName(model)}` : '',
                role: LENS_ROLE_PRESETS[role] ?? 'unknown',
            };
        }).filter(slot => slot.model);
    }
    return (ensembleModelSelection || [])
        .filter(entry => entry?.providerId && entry.model)
        .slice(0, 3)
        .map((entry, index) => {
            const provider = readyProviders.find(item => item.id === entry.providerId);
            const label = provider?.name || `Expert ${index + 1}`;
            return {
                initial: `${index + 1}`,
                label,
                model: formatModelDisplayName(entry.model),
                role: avatarRoleForName(label),
            };
        });
};

/** Render slots for a USER TEAM: identity discs + subtitle labels for
 *  the rail. Seat N on one provider reads "Kilocode · model #N". */
export const teamSlots = (team: AgentTeam, providers: ProviderConfig[]): TeamSlot[] =>
    (team.seats || []).slice(0, TEAM_MAX_SEATS).map((seat, index) => {
        const provider = providers.find(p => p.id === seat.providerId);
        const label = provider?.name || formatModelDisplayName(seat.modelId);
        return {
            initial: `${index + 1}`,
            label,
            model: formatModelDisplayName(seat.modelId),
            role: avatarRoleForName(label),
            roleTag: seat.role && seat.role !== AnalystRole.UNASSIGNED
                ? ANALYST_ROLE_DEFINITIONS[seat.role]?.shortName
                : undefined,
        };
    });
