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
    // API Keys
    OPENAI_API_KEY: 'openai_api_key',
    GROK_API_KEY: 'grok_api_key',
    GEMINI_API_KEY: 'gemini_api_key',
    DEEPSEEK_API_KEY: 'deepseek_api_key',

    // Core AI Handling
    MEMORY_PROVIDER: 'memory_provider', // 'gemini' | 'openai' | 'deepseek' | etc.

    // Settings
    ANALYST_LENS_CONFIG: 'analyst_lens_config',
    MODEL_PERFORMANCE_DATA: 'model_performance_data',
    ROLLING_WINDOW_DATA: 'rolling_window_data',
    CONFIDENCE_CALIBRATION: 'confidence_calibration',
    PROVIDER_PAIR_STATS: 'provider_pair_stats',
    INVALIDATION_RULES: 'invalidation_rules',
    POST_MORTEM_INSIGHTS: 'post_mortem_insights',
    CONFLUENCE_STATS: 'confluence_historical_stats',
    ATTRIBUTED_INSIGHTS: 'attributed_insights_kb',

    // Alerts
    PRICE_ALERTS: 'price_alerts',

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
 * Get API key by provider
 */
export const getApiKey = async (provider: 'openai' | 'grok' | 'gemini' | 'deepseek'): Promise<string> => {
    const keyMap = {
        openai: PREF_KEYS.OPENAI_API_KEY,
        grok: PREF_KEYS.GROK_API_KEY,
        gemini: PREF_KEYS.GEMINI_API_KEY,
        deepseek: PREF_KEYS.DEEPSEEK_API_KEY,
    };
    return (await getPreference(keyMap[provider])) || '';
};

/**
 * Set API key by provider
 */
export const setApiKey = async (provider: 'openai' | 'grok' | 'gemini' | 'deepseek', key: string): Promise<void> => {
    const keyMap = {
        openai: PREF_KEYS.OPENAI_API_KEY,
        grok: PREF_KEYS.GROK_API_KEY,
        gemini: PREF_KEYS.GEMINI_API_KEY,
        deepseek: PREF_KEYS.DEEPSEEK_API_KEY,
    };
    await setPreference(keyMap[provider], key);
};

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

    console.log(`[PreferencesService] Migrated ${migratedCount} keys to Preferences`);
    return migratedCount;
};
