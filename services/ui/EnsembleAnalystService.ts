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
import { AnalystLensConfig, AnalystRole } from '../../types';
import { ANALYST_ROLE_DEFINITIONS, getRoleForProvider, EnsembleModelSelection } from './AnalystLensService';

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
 *   - Lenses OFF + picker selection     → the "Debate Models" picker entries
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

    // A role is "missing" when it has no assigned provider, or its resolved
    // model no longer exists anywhere on that provider.
    const missingAnalystRoles = REQUIRED_ANALYST_ROLES.filter(role => {
        const assignment = assignmentForRole(role);
        const provider = providerConfigs.find(item => item.id === assignment?.assignedProvider);
        return !assignment?.assignedProvider || resolveAssignedModel(assignment, provider) === null;
    });

    const hasCompleteAnalystAssignments = missingAnalystRoles.length === 0 && (() => {
        const identities = REQUIRED_ANALYST_ROLES.map(role => {
            const assignment = assignmentForRole(role)!;
            const provider = providerConfigs.find(item => item.id === assignment.assignedProvider);
            return `${assignment.assignedProvider}::${resolveAssignedModel(assignment, provider) ?? ''}`;
        });
        return new Set(identities).size === identities.length;
    })();

    const analysts: EnsembleAnalystEntry[] = providerConfigs
        .filter(c => c.isEnabled && c.apiKey.trim().length > 0)
        .flatMap(c => {
            // Lens assignments for THIS provider, resolved against its current
            // model list (stale assigned ids fall back to the selected model).
            const assignedModels = assignments
                .filter(assignment => assignment.assignedProvider === c.id)
                .map(assignment => resolveAssignedModel(assignment, c))
                .filter((model): model is string => Boolean(model));
            const configuredModels = c.ensembleModels?.filter(model => c.models.includes(model)).slice(0, 3) || [];
            if (configuredModels.length === 0 && c.selectedModel) configuredModels.push(c.selectedModel);
            const uniqueAssignedModels = [...new Set(assignedModels)].slice(0, 3);
            // Lenses OFF: the plain 3-model picker in the chat input is the
            // source of truth for the cards + debate.
            const selectionModels = (isEnsembleEnabled && !lensConfig.enabled && ensembleModelSelection && ensembleModelSelection.length > 0)
                ? ensembleModelSelection.filter(s => s.providerId === c.id && c.models.includes(s.model)).map(s => s.model)
                : [];
            const models = isEnsembleEnabled
                ? (lensConfig.enabled && hasCompleteAnalystAssignments
                    ? uniqueAssignedModels
                    : (selectionModels.length > 0 ? selectionModels : configuredModels))
                : (c.selectedModel ? [c.selectedModel] : []);
            return models.map(model => ({
                config: { ...c, selectedModel: model },
                name: (() => {
                    if (!isEnsembleEnabled || !hasCompleteAnalystAssignments) return isEnsembleEnabled && models.length > 1 ? `${c.name} · ${model}` : c.name;
                    const role = getRoleForProvider(`${c.id}::${model}`, assignments);
                    return role !== AnalystRole.UNASSIGNED ? ANALYST_ROLE_DEFINITIONS[role].name : c.name;
                })(),
                model,
                useImages: false as const,
                thoughtsKey: `${c.id}:${model}`,
            }));
        })
        .slice(0, 3);

    return { analysts, missingAnalystRoles, hasCompleteAnalystAssignments };
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
        const label = provider ? `${provider.name} · ${provider.model}` : `#${index}`;
        const reason = settled.reason instanceof Error ? settled.reason.message : String(settled.reason ?? 'Unknown error');
        lines.push(`• ${label} — ${reason}`);
    });
    return lines.join('\n');
};
