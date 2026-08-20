/**
 * PreferencesService.ts
 * 
 * Native key-value storage service using @capacitor/preferences.
 * Uses Android SharedPreferences / iOS UserDefaults for reliable persistence.
 * Falls back to localStorage on web.
 * 
 * Use this for:
 * - API keys
 * - User settings/preferences
 * - Small configuration values
 * - Feature flags
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// Storage keys
export const PREF_KEYS = {
    // Provider metadata is portable; API keys are deliberately redacted by
    // ExportService before backups leave the device.
    PROVIDER_CONFIGS: 'provider_configs_v1',
    // Core AI Handling
    MEMORY_PROVIDER: 'memory_provider', // ProviderConfig id of the provider used for memory synthesis

    // Settings
    ANALYST_LENS_CONFIG: 'analyst_lens_config',
    ENSEMBLE_MODEL_SELECTION: 'ensemble_model_selection', // Ordinary 3-model picker used when Lenses are off
    LAST_MODERATOR_PICK: 'last_moderator_pick_v1',
    CUSTOM_ENSEMBLE_PROMPT: 'custom_ensemble_prompt',     // Normal-mode base prompt override (prompt editor)
    CUSTOM_LENS_PROMPTS: 'custom_lens_prompts',           // Per-role lens prompt overrides (prompt editor)
    CASUAL_CHAT_MODEL: 'casual_chat_model',
    HYBRID_PANEL_POSITION: 'hybrid_panel_position',
    MODEL_PERFORMANCE_DATA: 'model_performance_data',
    ROLLING_WINDOW_DATA: 'rolling_window_data',
    CONFIDENCE_CALIBRATION: 'confidence_calibration',
    PROVIDER_PAIR_STATS: 'provider_pair_stats',
    INVALIDATION_RULES: 'invalidation_rules',
    POST_MORTEM_INSIGHTS: 'post_mortem_insights',
    CONFLUENCE_STATS: 'confluence_historical_stats',
    ATTRIBUTED_INSIGHTS: 'attributed_insights_kb',
    LEARNING_WRITE_APPROVAL: 'learning_write_approval',
    LEARNING_PENDING_RULES: 'learning_pending_rules_v1',

    // Alerts
    PRICE_ALERTS: 'price_alerts',
    SETUP_WATCHES: 'setup_watches',
    OUTCOME_AUTOPILOT_STATE: 'outcome_autopilot_state',

    BOTS: 'bots_v1',
    // Data integrity
    LAST_TRADE_COUNT: 'last_trade_count',
    LAST_SESSION: 'last_session',
    DATA_VERSION: 'data_version',
    DATA_INTEGRITY_LOG: 'data_integrity_log',

    // Error tracking
    LAST_CRASH_ERROR: 'lastCrashError',
    LAST_PROMISE_ERROR: 'lastPromiseError',
    LAST_GLOBAL_ERROR: 'lastGlobalError',

    // Migration flag
    SQLITE_MIGRATED: 'sqlite_migrated',
};

/**
 * Check if running on native platform
 */
const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Set a value in preferences
 */
export const setPreference = async (key: string, value: string): Promise<void> => {
    if (isNative()) {
        await Preferences.set({ key, value });
    } else {
        localStorage.setItem(key, value);
    }
};

/**
 * Get a value from preferences
 */
export const getPreference = async (key: string): Promise<string | null> => {
    if (isNative()) {
        const result = await Preferences.get({ key });
        return result.value;
    } else {
        return localStorage.getItem(key);
    }
};

/**
 * Remove a value from preferences
 */
export const removePreference = async (key: string): Promise<void> => {
    if (isNative()) {
        await Preferences.remove({ key });
    } else {
        localStorage.removeItem(key);
    }
};

/**
 * Store a JSON object
 */
export const setPreferenceObject = async <T>(key: string, value: T): Promise<void> => {
    await setPreference(key, JSON.stringify(value));
};

/**
 * Get a JSON object
 */
export const getPreferenceObject = async <T>(key: string): Promise<T | null> => {
    const value = await getPreference(key);
    if (!value) return null;
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
};

/**
 * Check if a key exists
 */
export const hasPreference = async (key: string): Promise<boolean> => {
    const value = await getPreference(key);
    return value !== null;
};

/**
 * Get all keys (native only returns plugin-managed keys)
 */
export const getAllKeys = async (): Promise<string[]> => {
    if (isNative()) {
        const result = await Preferences.keys();
        return result.keys;
    } else {
        return Object.keys(localStorage);
    }
};

/**
 * Clear all preferences
 */
export const clearAllPreferences = async (): Promise<void> => {
    if (isNative()) {
        await Preferences.clear();
    } else {
        localStorage.clear();
    }
};

// ============================================================================
// CONVENIENCE FUNCTIONS FOR COMMON OPERATIONS
// ============================================================================

/**
 * Check if SQLite migration has been completed
 */
export const isSqliteMigrated = async (): Promise<boolean> => {
    const value = await getPreference(PREF_KEYS.SQLITE_MIGRATED);
    return value === 'true';
};

/**
 * Mark SQLite migration as complete
 */
export const setSqliteMigrated = async (): Promise<void> => {
    await setPreference(PREF_KEYS.SQLITE_MIGRATED, 'true');
};

// ============================================================================
// MIGRATION HELPER - Move localStorage to Preferences
// ============================================================================

/**
 * Migrate specific localStorage keys to Preferences
 */
export const migrateLocalStorageToPreferences = async (): Promise<number> => {
    if (!isNative()) return 0;

    let migratedCount = 0;
    const keysToMigrate = Object.values(PREF_KEYS);

    for (const key of keysToMigrate) {
        // Check if already exists in Preferences
        const existing = await getPreference(key);
        if (existing) continue;

        // Try to get from localStorage (in case still accessible)
        try {
            const localValue = localStorage.getItem(key);
            if (localValue) {
                await setPreference(key, localValue);
                migratedCount++;
                console.log(`[PreferencesService] Migrated key: ${key}`);
            }
        } catch (e) {
            // localStorage may not be accessible
        }
    }

    // Per-user scoped keys (learning_rules_v2_<user>, attributed_insights_kb_<user>,
    // global_learning_state_<user>, rl_signals_data) are NOT in PREF_KEYS, so the
    // loop above skips them and they silently die on an Android WebView data
    // clear. Sweep every remaining localStorage key so none is left behind.
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || keysToMigrate.includes(key)) continue;
            const existing = await getPreference(key);
            if (existing) continue;
            const localValue = localStorage.getItem(key);
            if (localValue) {
                await setPreference(key, localValue);
                migratedCount++;
                console.log(`[PreferencesService] Migrated key: ${key}`);
            }
        }
    } catch (e) {
        console.warn('[PreferencesService] Per-user key sweep failed:', e);
    }

    console.log(`[PreferencesService] Migrated ${migratedCount} keys to Preferences`);
    return migratedCount;
};
