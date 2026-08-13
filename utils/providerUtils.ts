// =============================================================================
// Provider Utilities
// Dynamic, config-driven helpers that replace the legacy hardcoded provider
// constants (per-provider model arrays, modelIdToName maps, default picks).
// =============================================================================

import { ProviderConfig } from '../types/provider';

/**
 * A provider is "ready" when it is enabled AND has an API key configured.
 * Mirrors getReadyProviders() in ProviderConfigService (kept dependency-free
 * so it can be used inside hooks/memos without service imports).
 */
export function isProviderReady(config: ProviderConfig): boolean {
    return config.isEnabled && config.apiKey.trim().length > 0;
}

/**
 * First ready provider, or null when nothing is configured.
 * Used for default selection (summarization, moderator, vision, memory).
 */
export function getFirstReadyProvider(configs: ProviderConfig[]): ProviderConfig | null {
    return configs.find(isProviderReady) ?? null;
}

/**
 * Build a model-id → display label map from all configured providers.
 * Replaces the legacy static `modelIdToName` / `ocrModelIdToName` constants.
 * Label format: "ProviderName · model-id". Consumers fall back to the raw
 * model id when a lookup misses.
 */
export function buildModelIdToName(configs: ProviderConfig[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const config of configs) {
        for (const model of config.models) {
            if (!model) continue;
            // First provider wins if two providers list the same model id.
            if (!(model in map)) {
                map[model] = `${config.name} · ${model}`;
            }
        }
    }
    return map;
}

/**
 * Build a provider display-name → provider-id map.
 * Used by the debate UI to map speaker names back to provider configs
 * (lens role lookup, model tooltips).
 */
export function buildProviderNameToId(configs: ProviderConfig[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const config of configs) {
        // First provider wins if two providers share a display name — matches
        // buildModelIdToName's convention (a stable map, not last-write-wins).
        if (!(config.name in map)) {
            map[config.name] = config.id;
        }
    }
    return map;
}

/**
 * Resolve a human-readable label for a model id, falling back to the raw id.
 */
export function resolveModelLabel(modelId: string | undefined, modelIdToName: Record<string, string>): string {
    if (!modelId) return 'Unknown';
    return modelIdToName[modelId] ?? modelId;
}

/**
 * True when a model id is a free-tier listing (OpenRouter `:free`,
 * `*-free` slugs like `hy3-free`). Avoids matching names like "freedom".
 */
export function isFreeModelId(modelId: string): boolean {
    const id = modelId.trim().toLowerCase();
    if (!id) return false;
    return /(^|[/:\-_.])free($|[/:\-_.])/.test(id);
}
