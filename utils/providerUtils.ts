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

const KNOWN_MODEL_TOKENS: Record<string, string> = {
    gpt: 'GPT',
    glm: 'GLM',
    llama: 'Llama',
    qwen: 'Qwen',
    claude: 'Claude',
    gemini: 'Gemini',
    deepseek: 'Deepseek',
    mistral: 'Mistral',
    grok: 'Grok',
    o1: 'O1',
    o3: 'O3',
    o4: 'O4',
};

/**
 * Turn a model slug into a short label: `deepseek-v4-flash` → `Deepseek V4 Flash`.
 * Provider prefixes (`openrouter/…`) and `:free` suffixes are stripped to words.
 */
export function formatModelDisplayName(modelId: string | undefined): string {
    if (!modelId) return '';
    const trimmed = modelId.trim();
    if (!trimmed) return '';
    const slug = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
    return slug
        .split(/[:]+/)
        .flatMap(part => part.split(/[-_]+/))
        .map(token => token.trim())
        .filter(Boolean)
        .map(formatModelToken)
        .join(' ');
}

/** Pretty-print a seat/team label that may still contain a raw model slug. */
export function formatSeatLabel(name: string | undefined): string {
    if (!name) return '';
    const sep = name.indexOf(' · ');
    if (sep >= 0) {
        const prefix = name.slice(0, sep).trim();
        const slug = name.slice(sep + 3).trim();
        return slug ? `${prefix} · ${formatModelDisplayName(slug)}` : prefix;
    }
    if (/[/:_]/.test(name) || /^[a-z0-9]+(?:-[a-z0-9.]+)+$/i.test(name)) {
        return formatModelDisplayName(name) || name;
    }
    return name;
}

const formatModelToken = (token: string): string => {
    const lower = token.toLowerCase();
    if (KNOWN_MODEL_TOKENS[lower]) return KNOWN_MODEL_TOKENS[lower];
    if (/^v\d/i.test(token)) return `V${token.slice(1)}`;
    if (/^\d/.test(token)) return token;
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
};

/**
 * Build a model-id → display label map from all configured providers.
 * Replaces the legacy static `modelIdToName` / `ocrModelIdToName` constants.
 * Label format: "ProviderName · Pretty Model". Consumers fall back to a
 * formatted slug when a lookup misses.
 */
export function buildModelIdToName(configs: ProviderConfig[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const config of configs) {
        for (const model of config.models) {
            if (!model) continue;
            // First provider wins if two providers list the same model id.
            if (!(model in map)) {
                map[model] = `${config.name} · ${formatModelDisplayName(model)}`;
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
    return modelIdToName[modelId] ?? formatModelDisplayName(modelId);
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

/** Stable unique list with free-tier ids first, original order preserved within each group. */
export function sortModelsFreeFirst(modelIds: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const id of modelIds) {
        const trimmed = id.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        unique.push(trimmed);
    }
    return [
        ...unique.filter(isFreeModelId),
        ...unique.filter(id => !isFreeModelId(id)),
    ];
}

/** Merge a /models catalog with ids the user already saved (keep custom extras). */
export function mergeDiscoveredModels(existing: string[], discovered: string[]): string[] {
    return sortModelsFreeFirst([...discovered, ...existing]);
}
