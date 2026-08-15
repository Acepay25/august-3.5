/**
 * AnalystLensService.ts
 * 
 * Manages user-configurable analyst roles for ensemble debates.
 * Each role provides a specialized analytical focus that gets injected into AI prompts.
 */

import { AnalystRole, AIProvider, AnalystRoleAssignment, AnalystLensConfig } from '../../types';
import {
    LENS_POSITION_PROMPTS,
    LENS_SCALP_PROMPTS,
    LENS_SWING_PROMPTS,
} from '../../constants/prompts/lensRolePrompts';
import {
    getPreferenceObject,
    setPreferenceObject,
    PREF_KEYS
} from '../infrastructure/PreferencesService';

// =============================================================================
// ROLE DEFINITIONS
// =============================================================================

export interface RoleDefinition {
    id: AnalystRole;
    name: string;
    shortName: string;
    focus: string;
    promptPrefix: string;
    emoji: string;
}

export const ANALYST_ROLE_DEFINITIONS: Record<AnalystRole, RoleDefinition> = {
    [AnalystRole.MACRO_VOLATILITY]: {
        id: AnalystRole.MACRO_VOLATILITY,
        name: 'Macro & Volatility Analyst',
        shortName: 'Macro',
        emoji: '',
        focus: 'Higher timeframes (4H/Daily), volatility regimes, liquidity zones, ATR, macro trend',
        promptPrefix: LENS_SWING_PROMPTS[AnalystRole.MACRO_VOLATILITY],
    },
    [AnalystRole.TECHNICAL_ANALYST]: {
        id: AnalystRole.TECHNICAL_ANALYST,
        name: 'Technical Analyst',
        shortName: 'Technical',
        emoji: '',
        focus: 'Patterns, SMC, order blocks, EMAs, RSI, MACD, structure, momentum',
        promptPrefix: LENS_SWING_PROMPTS[AnalystRole.TECHNICAL_ANALYST],
    },
    [AnalystRole.RISK_EXECUTION]: {
        id: AnalystRole.RISK_EXECUTION,
        name: 'Risk & Execution Specialist',
        shortName: 'Risk',
        emoji: '',
        focus: 'R:R validation, stop placement, entry timing (LTF), failure scenarios, devil\'s advocate',
        promptPrefix: LENS_SWING_PROMPTS[AnalystRole.RISK_EXECUTION],
    },
    [AnalystRole.UNASSIGNED]: {
        id: AnalystRole.UNASSIGNED,
        name: 'General Analyst',
        shortName: 'General',
        emoji: '',
        focus: 'Full analysis across all dimensions',
        promptPrefix: '',
    },
};

// =============================================================================
// STORAGE & CONFIG FUNCTIONS
// =============================================================================

// In-memory cache
let _lensConfigCache: AnalystLensConfig | null = null;
let _isInitialized = false;

/**
 * Initialize service - load config into memory
 */
export const initAnalystLensService = async (): Promise<void> => {
    if (_isInitialized) return;

    try {
        const config = await getPreferenceObject<AnalystLensConfig>(PREF_KEYS.ANALYST_LENS_CONFIG);
        if (config) {
            // Ensure tradingStyle exists (migration for old configs)
            if (!config.tradingStyle) {
                config.tradingStyle = 'swing';
            }
            _lensConfigCache = config;
        }
        _isInitialized = true;
        console.log('[AnalystLens] Service initialized with cached config');
    } catch (e) {
        console.error('[AnalystLens] Cached init failed:', e);
    }
};

/**
 * Get the role assigned to a specific provider
 */
export function getRoleForProvider(
    provider: AIProvider,
    config: AnalystRoleAssignment[]
): AnalystRole {
    // Accept both `provider::model` (canonical) and `provider:model` keys.
    // The pipeline's thoughtsKey historically used a single colon while the
    // role lookup split on double colon — that silently returned UNASSIGNED
    // and the lens prompt was never injected.
    const sep2 = provider.indexOf('::');
    const separator = sep2 >= 0 ? sep2 : provider.indexOf(':');
    const providerId = separator >= 0 ? provider.slice(0, separator) : provider;
    const modelId = separator >= 0 ? provider.slice(separator + (sep2 >= 0 ? 2 : 1)) : undefined;
    const exactAssignment = config.find(a => a.assignedProvider === providerId && a.assignedModel === modelId);
    const providerFallback = config.find(a => a.assignedProvider === providerId && !a.assignedModel);
    const assignment = exactAssignment || providerFallback;
    return assignment?.role || AnalystRole.UNASSIGNED;
}

/**
 * Get the provider assigned to a specific role
 */
export function getProviderForRole(
    role: AnalystRole,
    config: AnalystRoleAssignment[]
): AIProvider | null {
    const assignment = config.find(a => a.role === role);
    return assignment?.assignedProvider || null;
}

/**
 * Get the prompt prefix for a provider based on their assigned role
 */
export function getLensPromptForProvider(
    provider: AIProvider,
    config: AnalystRoleAssignment[]
): string {
    const role = getRoleForProvider(provider, config);
    return ANALYST_ROLE_DEFINITIONS[role].promptPrefix;
}

/**
 * Get display info for a provider based on their role
 */
export function getRoleDisplayForProvider(
    provider: AIProvider,
    config: AnalystRoleAssignment[]
): { name: string; emoji: string; focus: string; shortName: string } {
    const role = getRoleForProvider(provider, config);
    const def = ANALYST_ROLE_DEFINITIONS[role];
    return {
        name: def.name,
        emoji: def.emoji,
        focus: def.focus,
        shortName: def.shortName,
    };
}

/**
 * Load lens config
 */
export function loadLensConfig(): AnalystLensConfig {
    if (_lensConfigCache) return _lensConfigCache;

    try {
        const stored = localStorage.getItem(PREF_KEYS.ANALYST_LENS_CONFIG);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Ensure tradingStyle exists (migration for old configs)
            if (!parsed.tradingStyle) {
                parsed.tradingStyle = 'swing';
            }
            _lensConfigCache = parsed;
            return parsed;
        }
    } catch (e) {
        console.error('Failed to load lens config:', e);
    }

    const empty = {
        enabled: false,
        assignments: getDefaultLensAssignments(),
        tradingStyle: 'swing' as const,
    };
    _lensConfigCache = empty;
    return empty;
}

/**
 * Save lens config
 */
export function saveLensConfig(config: AnalystLensConfig): void {
    _lensConfigCache = config;
    setPreferenceObject(PREF_KEYS.ANALYST_LENS_CONFIG, config).catch(e =>
        console.warn('[AnalystLens] Failed to save config:', e)
    );
    // Mirror into localStorage as well: the sync load helpers (loadLensConfig
    // / loadEnsembleModelSelection) read localStorage directly, but on native
    // (Capacitor) the Preferences write is async and only restored through
    // the App startup sync — leaving the pickers empty until it ran. The
    // WebView always has localStorage, so the mirror makes save and load
    // symmetric on every platform from the first render.
    try {
        localStorage.setItem(PREF_KEYS.ANALYST_LENS_CONFIG, JSON.stringify(config));
    } catch (e) {
        console.warn('[AnalystLens] Failed to mirror lens config to localStorage:', e);
    }
}

// =============================================================================
// ORDINARY ENSEMBLE MODEL SELECTION (used when Lenses are OFF)
// =============================================================================

/**
 * The plain "pick 3 models for the debate" selection shown in the chat input
 * when Analyst Lenses are disabled. Mirrors lens role assignments: the chosen
 * models become the source of truth for the three cards and the debate.
 */
export type EnsembleModelSelection = { providerId: string; model: string }[];

/**
 * Load the ordinary ensemble model selection (max 3 entries).
 * Web reads localStorage directly (matching loadLensConfig); native reads go
 * through initAnalystLensService's Preferences sync in App.tsx.
 */
export function loadEnsembleModelSelection(): EnsembleModelSelection {
    try {
        const stored = localStorage.getItem(PREF_KEYS.ENSEMBLE_MODEL_SELECTION);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                return parsed
                    .filter((e: any) => e && typeof e.providerId === 'string' && typeof e.model === 'string')
                    .slice(0, 3);
            }
        }
    } catch (e) {
        console.error('Failed to load ensemble model selection:', e);
    }
    return [];
}

/** Keep saved slots whose provider still exists. Do not drop a model just because it is not in the cached catalog yet. */
export function retainEnsembleSelection(
    selection: EnsembleModelSelection,
    providerIds: Iterable<string>,
): EnsembleModelSelection {
    const ids = new Set(providerIds);
    // Empty catalog means providers have not loaded yet — do not wipe picks.
    if (ids.size === 0) return selection;
    return selection.filter(entry => ids.has(entry.providerId));
}

export type LastModeratorPick = { providerId: string; model: string };

export function loadLastModeratorPick(): LastModeratorPick | null {
    try {
        const stored = localStorage.getItem(PREF_KEYS.LAST_MODERATOR_PICK);
        if (!stored) return null;
        const parsed = JSON.parse(stored) as LastModeratorPick;
        if (parsed?.providerId && parsed.model) return parsed;
    } catch { /* ignore */ }
    return null;
}

export function saveLastModeratorPick(pick: LastModeratorPick): void {
    setPreferenceObject(PREF_KEYS.LAST_MODERATOR_PICK, pick).catch(() => undefined);
    try {
        localStorage.setItem(PREF_KEYS.LAST_MODERATOR_PICK, JSON.stringify(pick));
    } catch { /* ignore */ }
}

/** Persist the ordinary ensemble model selection (capped at 3 entries). */
export function saveEnsembleModelSelection(selection: EnsembleModelSelection): void {
    setPreferenceObject(PREF_KEYS.ENSEMBLE_MODEL_SELECTION, selection.slice(0, 3)).catch(e =>
        console.warn('[AnalystLens] Failed to save ensemble model selection:', e)
    );
    // localStorage mirror — same rationale as saveLensConfig: the sync load
    // helpers read localStorage directly, so writes must land there too or a
    // native (Capacitor) session sees an empty picker until the App startup
    // sync restores from Preferences.
    try {
        localStorage.setItem(PREF_KEYS.ENSEMBLE_MODEL_SELECTION, JSON.stringify(selection.slice(0, 3)));
    } catch (e) {
        console.warn('[AnalystLens] Failed to mirror ensemble model selection to localStorage:', e);
    }
}

/**
 * Default configuration (all roles unassigned)
 */
export function getDefaultLensAssignments(): AnalystRoleAssignment[] {
    return [
        { role: AnalystRole.MACRO_VOLATILITY, assignedProvider: null },
        { role: AnalystRole.TECHNICAL_ANALYST, assignedProvider: null },
        { role: AnalystRole.RISK_EXECUTION, assignedProvider: null },
    ];
}

/**
 * Validate that no model is assigned to multiple roles. The same provider may
 * appear more than once when each role uses a different model.
 */
export function validateLensConfig(config: AnalystRoleAssignment[]): string | null {
    const assignedModels = config
        .filter(a => a.assignedProvider !== null)
        .map(a => `${a.assignedProvider}::${a.assignedModel || ''}`);

    const duplicates = assignedModels.filter(
        (model, i) => assignedModels.indexOf(model) !== i
    );

    if (duplicates.length > 0) {
        return `Model ${duplicates[0].replace('::', ' · ')} is assigned to multiple roles`;
    }
    return null;
}

/**
 * Get all available roles (excluding UNASSIGNED)
 */
export function getAvailableRoles(): RoleDefinition[] {
    return Object.values(ANALYST_ROLE_DEFINITIONS).filter(
        def => def.id !== AnalystRole.UNASSIGNED
    );
}

/**
 * Check if all 3 roles are assigned (complete configuration)
 */
export function isLensConfigComplete(config: AnalystRoleAssignment[]): boolean {
    const assignedCount = config.filter(a => a.assignedProvider !== null).length;
    return assignedCount === 3;
}

/**
 * Get a summary of the current lens configuration for debugging/display
 */
export function getLensConfigSummary(config: AnalystLensConfig): string {
    if (!config.enabled) {
        return 'Analyst Lenses: Disabled';
    }

    const styleLabel = config.tradingStyle === 'auto' ? 'Auto ' :
        config.tradingStyle === 'position' ? 'Position ' :
            config.tradingStyle === 'scalp' ? 'Scalp ' : 'Swing ';

    const lines = config.assignments.map(a => {
        const def = ANALYST_ROLE_DEFINITIONS[a.role];
        const provider = a.assignedProvider || 'Not Assigned';
        return `${def.emoji} ${def.shortName}: ${provider}`;
    });

    return `Analyst Lenses: Enabled (${styleLabel})\n${lines.join('\n')}`;
}

export const SCALP_PROMPTS = LENS_SCALP_PROMPTS;
export const POSITION_PROMPTS = LENS_POSITION_PROMPTS;

/**
 * Get the lens prompt for a role and trading style directly (no provider
 * resolution needed — used by the prompt editor modal).
 */
export function getLensPromptForRole(
    role: AnalystRole,
    style: 'position' | 'swing' | 'scalp'
): string {
    if (role === AnalystRole.UNASSIGNED) return '';
    if (style === 'position') return POSITION_PROMPTS[role];
    if (style === 'scalp') return SCALP_PROMPTS[role];
    return ANALYST_ROLE_DEFINITIONS[role].promptPrefix;
}

/**
 * Get the lens prompt for a provider based on role AND trading style
 */
export function getLensPromptForStyle(
    provider: AIProvider,
    config: AnalystRoleAssignment[],
    style: 'position' | 'swing' | 'scalp'
): string {
    const role = getRoleForProvider(provider, config);

    // UNASSIGNED role always uses empty prefix (default behavior)
    if (role === AnalystRole.UNASSIGNED) {
        return '';
    }

    return getLensPromptForRole(role, style);
}

// =============================================================================
// CUSTOM PROMPT OVERRIDES (prompt editor)
// =============================================================================

/**
 * Load the user's custom Normal-mode prompt override (Lenses off). The
 * MASTER_ANALYSIS_PROMPT is used when null.
 */
export function loadCustomEnsemblePrompt(): string | null {
    try {
        return localStorage.getItem(PREF_KEYS.CUSTOM_ENSEMBLE_PROMPT);
    } catch (e) {
        console.error('Failed to load custom ensemble prompt:', e);
        return null;
    }
}

/** Persist the Normal-mode prompt override (null clears it). */
export function saveCustomEnsemblePrompt(prompt: string | null): void {
    if (prompt && prompt.trim()) {
        setPreferenceObject(PREF_KEYS.CUSTOM_ENSEMBLE_PROMPT, prompt.trim()).catch(e =>
            console.warn('[AnalystLens] Failed to save custom ensemble prompt:', e)
        );
    } else {
        setPreferenceObject(PREF_KEYS.CUSTOM_ENSEMBLE_PROMPT, '').catch(e =>
            console.warn('[AnalystLens] Failed to clear custom ensemble prompt:', e)
        );
    }
}

/**
 * Load per-role lens prompt overrides (role id → custom prompt). Roles
 * without an entry keep their built-in role prompt.
 */
export function loadCustomLensPrompts(): Record<string, string> {
    try {
        const stored = localStorage.getItem(PREF_KEYS.CUSTOM_LENS_PROMPTS);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
        }
    } catch (e) {
        console.error('Failed to load custom lens prompts:', e);
    }
    return {};
}

/** Persist per-role lens prompt overrides. */
export function saveCustomLensPrompts(prompts: Record<string, string>): void {
    const clean = Object.fromEntries(
        Object.entries(prompts).filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    );
    setPreferenceObject(PREF_KEYS.CUSTOM_LENS_PROMPTS, clean).catch(e =>
        console.warn('[AnalystLens] Failed to save custom lens prompts:', e)
    );
}

