// Ensemble analyst construction + failure reporting.
//
// Pure helpers extracted from useAnalysisPipeline so the analyst-list logic —
// the path that decides which models reach the parallel analysis and the
// debate — is unit-testable. Two hardenings over the old inline logic:
//   1. Lens-assignment model ids are resolved against each provider's CURRENT
//      model list (a persisted assignment referencing a removed model used to
//      create an analyst with a dead model id, which failed at runtime and
//      silently shrank the debate to "1 provided").
//   2. The completeness checks use those resolved models, so a role that can
//      no longer resolve counts as missing instead of running a dead model.

import { ProviderConfig } from '../../types/provider';
import { AnalystLensConfig, AnalystRole, AnalystRoleAssignment } from '../../types';
import { ANALYST_ROLE_DEFINITIONS, EnsembleModelSelection } from './AnalystLensService';
import { formatModelDisplayName } from '../../utils/providerUtils';

/** One ensemble participant — a model-level entry (several per provider possible). */
export interface EnsembleAnalystEntry {
    config: ProviderConfig;
    name: string;
    model: string;
    useImages: false;
    thoughtsKey: string;
}

export interface EnsembleAnalystPlan {
    analysts: EnsembleAnalystEntry[];
    /** Roles whose assignment can't resolve to a live provider + model. */
    missingAnalystRoles: AnalystRole[];
    /** All 3 roles assigned to 3 distinct (resolved) provider::model identities. */
    hasCompleteAnalystAssignments: boolean;
    /**
     * The lens assignments with stale model ids rewritten to the model the
     * analyst will actually run (resolveAssignedModel's fallback). Callers
     * must use THIS for role lookups (getRoleForProvider / getLensPromptForStyle)
     * — the raw assignments silently returned UNASSIGNED for a stale model,
     * so the analyst passed the completeness check but ran with NO lens
     * persona and the generic provider name.
     */
    resolvedAssignments: AnalystRoleAssignment[];
}

const REQUIRED_ANALYST_ROLES = [
    AnalystRole.MACRO_VOLATILITY,
    AnalystRole.TECHNICAL_ANALYST,
    AnalystRole.RISK_EXECUTION,
];

/**
 * Resolve the model an assignment actually points at. A persisted assignment
 * may reference a model id that no longer exists in the provider's model list;
 * fall back to the provider's selected model. Returns null only when nothing
 * valid remains (or the provider itself no longer exists).
 */
const resolveAssignedModel = (
    assignment: { assignedProvider: string | null; assignedModel?: string },
    provider?: ProviderConfig
): string | null => {
    if (!provider) return null;
    const candidates = [assignment.assignedModel, provider.selectedModel].filter((m): m is string => Boolean(m));
    for (const candidate of candidates) {
        if (provider.models.includes(candidate)) return candidate;
    }
    return null;
};

/**
 * Build the ensemble analyst list (model-level entries) from the ready
 * providers, honoring (in order of precedence, mirroring the old hook logic):
 *   - Lenses ON + complete assignments  → the 3 assigned (resolved) models
 *   - otherwise + Team dropdown slots   → those models, in slot order
 *   - otherwise                         → per-provider ensembleModels
 *                                     (falling back to selectedModel)
 * Capped at 3 entries total.
 */
export const buildEnsembleAnalysts = (
    providerConfigs: ProviderConfig[],
    lensConfig: AnalystLensConfig,
    ensembleModelSelection: EnsembleModelSelection | undefined,
    isEnsembleEnabled: boolean
): EnsembleAnalystPlan => {
    const assignments = lensConfig.assignments || [];

    const assignmentForRole = (role: AnalystRole) => assignments.find(item => item.role === role);

    // A role is "missing" when it has no assigned provider, its provider is
    // NOT ready (disabled / no API key — a role on a disabled provider used
    // to count as "complete", so the run silently launched 2 analysts), or
    // its resolved model no longer exists anywhere on that provider.
    const missingAnalystRoles = REQUIRED_ANALYST_ROLES.filter(role => {
        const assignment = assignmentForRole(role);
        const provider = providerConfigs.find(item => item.id === assignment?.assignedProvider);
        const providerReady = !!provider && provider.isEnabled && provider.apiKey.trim().length > 0;
        return !assignment?.assignedProvider || !providerReady || resolveAssignedModel(assignment, provider) === null;
    });

    const hasCompleteAnalystAssignments = missingAnalystRoles.length === 0 && (() => {
        const identities = REQUIRED_ANALYST_ROLES.map(role => {
            const assignment = assignmentForRole(role)!;
            const provider = providerConfigs.find(item => item.id === assignment.assignedProvider);
            return `${assignment.assignedProvider}::${resolveAssignedModel(assignment, provider) ?? ''}`;
        });
        return new Set(identities).size === identities.length;
    })();

    // Assignments rewritten to the models the analysts will ACTUALLY run.
    // getRoleForProvider/getLensPromptForStyle match the literal
    // assignedModel; without this rewrite a stale persisted model id made
    // the role lookup return UNASSIGNED even though the analyst runs (on the
    // provider's current selectedModel) — no persona, generic name.
    const resolvedAssignments: AnalystRoleAssignment[] = assignments
        .filter(a => a.assignedProvider && a.role !== AnalystRole.UNASSIGNED)
        .map(a => {
            const provider = providerConfigs.find(p => p.id === a.assignedProvider);
            const resolved = resolveAssignedModel(a, provider);
            return resolved ? { ...a, assignedModel: resolved } : a;
        });

    const ready = (id: string | null | undefined): ProviderConfig | undefined =>
        providerConfigs.find(c => c.id === id && c.isEnabled && c.apiKey.trim().length > 0);

    const toEntry = (c: ProviderConfig, model: string, name: string): EnsembleAnalystEntry => ({
        config: { ...c, selectedModel: model },
        name,
        model,
        useImages: false,
        thoughtsKey: `${c.id}:${model}`,
    });

    let analysts: EnsembleAnalystEntry[] = [];

    if (isEnsembleEnabled && lensConfig.enabled && hasCompleteAnalystAssignments) {
        analysts = REQUIRED_ANALYST_ROLES.flatMap(role => {
            const assignment = assignmentForRole(role);
            const provider = ready(assignment?.assignedProvider);
            const model = assignment ? resolveAssignedModel(assignment, provider) : null;
            if (!provider || !model) return [];
            const roleName = ANALYST_ROLE_DEFINITIONS[role].name;
            return [toEntry(provider, model, roleName)];
        });
    } else if (isEnsembleEnabled) {
        // Normal mode: Team dropdown slots are the only roster. Do not fall
        // back to provider.ensembleModels — those leftover defaults used to
        // fill the first provider and hide the models the user just picked.
        const slots = (ensembleModelSelection ?? []).filter(s => s?.providerId && s.model).slice(0, 3);
        if (slots.length > 0) {
            analysts = slots.flatMap(slot => {
                const provider = ready(slot.providerId);
                if (!provider) return [];
                const model = slot.model;
                const pretty = formatModelDisplayName(model);
                const sameProvider = slots.filter(s => s.providerId === slot.providerId).length > 1;
                return [toEntry(provider, model, sameProvider ? `${provider.name} · ${pretty}` : pretty)];
            });
        } else {
            analysts = providerConfigs
                .filter(c => c.isEnabled && c.apiKey.trim().length > 0)
                .flatMap(c => {
                    const configuredModels = c.ensembleModels?.filter(model => c.models.includes(model)).slice(0, 3) || [];
                    if (configuredModels.length === 0 && c.selectedModel) configuredModels.push(c.selectedModel);
                    return configuredModels.map(model => toEntry(
                        c,
                        model,
                        configuredModels.length > 1 ? `${c.name} · ${formatModelDisplayName(model)}` : formatModelDisplayName(model),
                    ));
                })
                .slice(0, 3);
        }
    } else {
        analysts = providerConfigs
            .filter(c => c.isEnabled && c.apiKey.trim().length > 0)
            .flatMap(c => (c.selectedModel ? [toEntry(c, c.selectedModel, c.name)] : []))
            .slice(0, 3);
    }

    return { analysts, missingAnalystRoles, hasCompleteAnalystAssignments, resolvedAssignments };
};

/**
 * Build the user-facing "Failed analysts:" block from the parallel analysis
 * results, aligned to the original provider index so a failed analyst can
 * never shift another provider's attribution. Returns '' when nothing failed.
 */
export const buildAnalystFailureReport = (
    settledResults: readonly PromiseSettledResult<unknown>[],
    enabledProviders: readonly { name: string; model: string }[]
): string => {
    const lines: string[] = [];
    settledResults.forEach((settled, index) => {
        if (settled.status !== 'rejected') return;
        const provider = enabledProviders[index];
        const label = provider ? `${provider.name} · ${formatModelDisplayName(provider.model)}` : `#${index}`;
        const reason = settled.reason instanceof Error ? settled.reason.message : String(settled.reason ?? 'Unknown error');
        lines.push(`• ${label} — ${reason}`);
    });
    return lines.join('\n');
};
