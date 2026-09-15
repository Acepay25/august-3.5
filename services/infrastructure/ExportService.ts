/**
 * ExportService - Cross-platform data export
 * Uses Capacitor Filesystem + Share API for Android/iOS, blob download for web
 */

import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

/**
 * Check if running in Capacitor (native APK/iOS)
 */
const isNativePlatform = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

/**
 * Export data as a downloadable/shareable JSON file
 * 
 * On Android/iOS: Writes to cache directory then shares the file
 * On Web: Creates a blob download
 * 
 * @param data - The data object to export
 * @param filename - The filename (without path)
 * @returns Promise resolving to success status
 */
export const exportTextAsFile = async (
    content: string,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    if (isNativePlatform()) {
        return exportNative(content, filename);
    }
    return exportWeb(content, filename);
};

export const exportDataAsFile = async (
    data: any,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    const jsonContent = JSON.stringify(data, null, 2);

    if (isNativePlatform()) {
        return exportNative(jsonContent, filename);
    } else {
        return exportWeb(jsonContent, filename);
    }
};

/**
 * Native export using Capacitor Filesystem + Share API
 * Writes file to cache directory first, then shares via file URI
 * This avoids Android's intent size limit (~1MB) that causes crashes
 */
const exportNative = async (
    content: string,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        console.log('[ExportService] Writing file to cache directory...');

        // Step 1: Write file to cache directory
        const result = await Filesystem.writeFile({
            path: filename,
            data: content,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
        });

        console.log('[ExportService] File written:', result.uri);

        // Step 2: Share the file URI instead of raw text
        // This avoids the intent size limit that crashes the app
        try {
            await Share.share({
                title: `August Backup`,
                url: result.uri, // Share file URI, not text
                dialogTitle: 'Save or Share Your Backup',
            });

            console.log('[ExportService] Share dialog opened successfully');
            return { success: true };
        } catch (shareError: any) {
            // Check for share cancellation (not an error)
            if (shareError.message?.includes('cancel') || shareError.message?.includes('abort') || shareError.message?.includes('dismiss')) {
                return { success: true }; // User cancelled, not an error
            }

            // If share fails, try to copy to downloads as fallback
            console.warn('[ExportService] Share failed, trying fallback copy:', shareError);
            return await fallbackCopyToDownloads(content, filename);
        }
    } catch (error: any) {
        console.error('[ExportService] Native export failed:', error);

        // Final fallback: Try text-based share with truncation warning
        return {
            success: false,
            error: `Export failed: ${error.message || 'Unknown error'}. Try reducing trade log size.`,
        };
    }
};

/**
 * Fallback: Copy content to clipboard with instructions
 */
const fallbackCopyToDownloads = async (
    content: string,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        // Try to write to Documents directory (more accessible)
        await Filesystem.writeFile({
            path: `Download/${filename}`,
            data: content,
            directory: Directory.ExternalStorage, // Public external storage
            encoding: Encoding.UTF8,
            recursive: true,
        });

        return {
            success: true,
            error: `Saved to Downloads folder: ${filename}`
        };
    } catch (downloadError: any) {
        console.error('[ExportService] Fallback also failed:', downloadError);

        // Last resort: Copy to clipboard
        try {
            if (navigator.clipboard && content.length < 1000000) {
                await navigator.clipboard.writeText(content);
                return {
                    success: true,
                    error: 'Backup copied to clipboard. Paste into a text file to save.'
                };
            }
        } catch (clipError) {
            console.error('[ExportService] Clipboard fallback failed:', clipError);
        }

        return {
            success: false,
            error: `Export failed. Data may be too large. Try exporting less data.`,
        };
    }
};

/**
 * Web export using blob download
 */
const exportWeb = async (
    content: string,
    filename: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        console.log('[ExportService] Using blob download (Web)');

        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('[ExportService] Web download initiated');
        return { success: true };
    } catch (error: any) {
        console.error('[ExportService] Web export failed:', error);
        return {
            success: false,
            error: `Export failed: ${error.message || 'Unknown error'}`,
        };
    }
};

/**
 * Check if the Share API is available
 */
export const canShare = async (): Promise<boolean> => {
    if (!isNativePlatform()) {
        return true; // Web can always use blob download
    }

    try {
        const result = await Share.canShare();
        return result.value;
    } catch {
        return false;
    }
};


import { getAllKeys, getPreferenceObject, setPreferenceObject, PREF_KEYS } from './PreferencesService';
import { ProviderConfig } from '../../types/provider';
import { validateProviderUrl } from '../../utils/providerUrlValidation';

const redactPreferenceValue = (key: string, value: unknown): unknown => {
    if (key !== PREF_KEYS.PROVIDER_CONFIGS || !Array.isArray(value)) return value;
    return value.map((provider: ProviderConfig) => ({
        ...provider,
        apiKey: '',
    }));
};

/**
 * Export all preference keys as a supplementary backup
 * This captures settings that aren't in database
 */
export const exportPreferencesData = async (): Promise<Record<string, any>> => {
    const backup: Record<string, any> = {};

    // Get all values from PreferencesService (handles native/web abstraction)
    const keysToBackup = Object.values(PREF_KEYS);

    for (const key of keysToBackup) {
        try {
            const value = await getPreferenceObject(key);
            if (value !== null) {
                backup[key] = redactPreferenceValue(key, value);
            }
        } catch (e) {
            console.warn(`[ExportService] Failed to export key ${key}:`, e);
        }
    }

    // Per-user scoped keys (memory_files_v1_<user>, memory_injections_v1_<user>,
    // learning_rules_v2_<user>, attributed_insights_kb_<user>,
    // global_learning_state_<user>, rl_signals_data) are NOT in PREF_KEYS.
    // Sweep BOTH sources: localStorage keys (web fallback) and the full
    // Preferences key list via getAllKeys() — on native, Capacitor Preferences
    // is NOT localStorage, so the notebook would silently vanish from backups
    // without the abstraction-level sweep.
    try {
        const swept = new Set<string>();
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) swept.add(key);
        }
        try {
            for (const key of await getAllKeys()) swept.add(key);
        } catch { /* abstraction listing unavailable — localStorage sweep still ran */ }
        for (const key of swept) {
            if (!key || keysToBackup.includes(key)) continue;
            const value = await getPreferenceObject(key);
            if (value !== null) {
                backup[key] = redactPreferenceValue(key, value);
            }
        }
    } catch (e) {
        console.warn('[ExportService] Per-user key sweep failed:', e);
    }

    return backup;
};

/**
 * Preference keys a backup is allowed to restore.
 *
 * `exportPreferencesData` sweeps EVERY key in the Preferences/localStorage
 * store, so an unfiltered import lets a crafted backup plant arbitrary keys
 * (arbitrary pref-key injection). Restores are therefore gated by this
 * allow-list, which enumerates what the app itself writes at backup time:
 * the PREF_KEYS constants plus every username-scoped / service namespace
 * greppable in the codebase (memory files, learning rules, chat sessions,
 * drawings, automations, desk state, forged tools, agent roster, …).
 * Unknown keys are skipped and reported, never silently persisted.
 */
const RESTORABLE_PREFERENCE_KEYS: ReadonlySet<string> = new Set<string>(
    Object.values(PREF_KEYS) as string[],
);

/** Prefix-matched namespaces for dynamic/scoped keys. */
const RESTORABLE_PREFERENCE_KEY_PREFIXES: readonly string[] = [
    // Learning / memory (username-scoped)
    'memory_files_v1_',
    'memory_injections_v1_',
    'learning_rules_v2_',
    'global_learning_state_',
    'rl_signals_data',
    'profile_memory_v1',
    'belief_challenge_v1_',
    'monthly_report_v1_',
    'meta_calibration_v1_',
    'regime_ledger_v1_',
    'preflight_results_v1_',
    'skill_graveyard_v1_',
    'strategy_regime_matrix_v1_',
    'weekly_review_v1_',
    'weekly_rollup_v1_',
    'pass_mining_v1_',
    'skill_veto_ledger_v1_',
    'learning_proposals_v1',
    'skill_drafts_v1',
    'session_review_counter_v1',
    'session_review_drafted_v1',
    'session_review_open_theses_v1',
    'session_review_resolver_v1',
    'trader_learning_v1',
    'trader_learner_counter_v1',
    'supervisor_auto_v1',
    // Per-user prompt/strategy docs + automations
    'prompt_overrides_v1_',
    'strategy_docs_v1_',
    'automations_v1_',
    'automation_runs_v1_',
    'automation_last_seen_v1_',
    // Trading surface (watches, levels, chat sessions, drawings)
    'trade_level_hits_v1',
    'trade_level_arms_v1',
    'trade_watches_v1',
    'trade_chat_sessions_v1_',
    'trade_chat_active_v1_',
    'trade_drawings_v1_',
    'trade_session_drawings_v1_',
    'trade_sidebar_open_v1',
    'trade_tf_bar_v1',
    // Bots / agents / desk
    'bots_v1_',
    'agents_bots_v1',
    'agents_groups_v1',
    'agents_teams_v1',
    'agents_active_team_v1',
    'agent_threads_opened_v1',
    'desk_tools_forged_v1',
    'desk_idle_motion_v1',
    'desk_role_overrides_v1',
    'desk_room_layout_v1',
    // Shell / misc app state
    'harness_settings_v1',
    'book_drafts_seeded_v1',
    'august_active_user',
    'last_active_user',
    'august_sidebar_pane',
    // Per-user variants of PREF_KEYS values (`<key>_<username>`)
    'data_version_',
    'last_session_',
    'last_trade_count_',
];

export const isRestorablePreferenceKey = (key: string): boolean =>
    RESTORABLE_PREFERENCE_KEYS.has(key) ||
    RESTORABLE_PREFERENCE_KEY_PREFIXES.some(prefix => key.startsWith(prefix));

/** Outcome of an importPreferencesData run (returned + logged; callers may ignore). */
export interface ImportPreferencesReport {
    /** Allowed keys successfully persisted. */
    keysWritten: number;
    /** Keys present in the backup that are NOT on the restore allow-list. */
    skippedKeys: string[];
    /** Allowed keys whose write threw (restore was partial). */
    failedKeys: string[];
    /** Provider entries accepted into provider_configs_v1. */
    providersImported: number;
    /** Provider entries dropped for an unparseable/invalid baseUrl or shape. */
    providersDropped: number;
    /** Entries that inherited the live key (backup pointed at the same endpoint). */
    providersKeyGrafted: number;
    /** Entries kept but with an EMPTY key — the user must re-enter it. */
    providersRequiringKeyReentry: number;
}

/**
 * Merge a backup's provider list into the live one WITHOUT ever letting the
 * merge exfiltrate a live API key. Exported backups redact keys, so a naive
 * "keep the current key when the backup's is empty" graft lets a crafted
 * backup pair `{apiKey:'', baseUrl:'https://evil.tld'}` with the user's REAL
 * key (key grafting onto an attacker-chosen host). Rules:
 *  - every imported baseUrl must pass validateProviderUrl or the entry is
 *    dropped (counted);
 *  - the live key is grafted ONLY when the backup entry points at exactly the
 *    same validated endpoint as the current config for that id;
 *  - a changed or absent baseUrl with an empty backup key yields a
 *    present-but-not-ready entry (empty key) so the UI asks the user to
 *    re-enter it instead of silently sending their key somewhere new.
 */
const mergeProviderConfigsForImport = async (
    backupProviders: unknown[],
    existing: ProviderConfig[],
): Promise<{ merged: ProviderConfig[]; dropped: number; grafted: number; reentry: number }> => {
    const merged: ProviderConfig[] = [];
    let dropped = 0;
    let grafted = 0;
    let reentry = 0;

    for (const raw of backupProviders) {
        if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') {
            dropped += 1;
            continue;
        }
        const provider = raw as ProviderConfig;
        const rawBaseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : '';

        let normalizedBackupUrl: string | null = null;
        if (rawBaseUrl) {
            const validation = validateProviderUrl(rawBaseUrl);
            if (!validation.valid) {
                console.warn(`[ExportService] Dropped imported provider "${provider.id}": invalid baseUrl (${validation.message})`);
                dropped += 1;
                continue;
            }
            normalizedBackupUrl = validation.normalizedUrl;
        }

        const backupKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : '';
        if (backupKey) {
            // The backup carries its own key (non-redacted / hand-made file) —
            // keep it; nothing is grafted from the live config.
            merged.push({ ...provider, baseUrl: normalizedBackupUrl ?? provider.baseUrl });
            continue;
        }

        // Empty backup key (the normal redacted case). Graft the live key only
        // when both sides validate to the SAME endpoint.
        const current = existing.find(item => item?.id === provider.id);
        const currentKey = typeof current?.apiKey === 'string' ? current.apiKey : '';
        const currentBaseUrl = typeof current?.baseUrl === 'string' ? current.baseUrl.trim() : '';
        const currentValidation = currentBaseUrl ? validateProviderUrl(currentBaseUrl) : null;
        if (
            currentKey &&
            normalizedBackupUrl &&
            currentValidation?.valid &&
            currentValidation.normalizedUrl === normalizedBackupUrl
        ) {
            merged.push({ ...provider, baseUrl: normalizedBackupUrl, apiKey: currentKey });
            grafted += 1;
        } else {
            if (currentKey) reentry += 1; // would have been grafted pre-fix
            merged.push({ ...provider, apiKey: '' });
        }
    }

    return { merged, dropped, grafted, reentry };
};

/**
 * Import preference keys from backup.
 *
 * SECURITY: only allow-listed keys are persisted (see
 * {@link isRestorablePreferenceKey}); provider entries go through the
 * hardened key-graft rules (see {@link mergeProviderConfigsForImport}).
 * The returned report counts drops/skips so restore callers can surface
 * a partial restore instead of it being silent.
 */
export const importPreferencesData = async (
    backup: Record<string, any>,
): Promise<ImportPreferencesReport> => {
    const report: ImportPreferencesReport = {
        keysWritten: 0,
        skippedKeys: [],
        failedKeys: [],
        providersImported: 0,
        providersDropped: 0,
        providersKeyGrafted: 0,
        providersRequiringKeyReentry: 0,
    };

    for (const [key, value] of Object.entries(backup)) {
        try {
            if (!isRestorablePreferenceKey(key)) {
                console.warn(`[ExportService] Skipped non-allow-listed backup key: ${key}`);
                report.skippedKeys.push(key);
                continue;
            }
            if (key === PREF_KEYS.PROVIDER_CONFIGS && Array.isArray(value)) {
                const existing = await getPreferenceObject<ProviderConfig[]>(key) || [];
                const { merged, dropped, grafted, reentry } = await mergeProviderConfigsForImport(value, existing);
                await setPreferenceObject(key, merged);
                report.keysWritten += 1;
                report.providersImported = merged.length;
                report.providersDropped = dropped;
                report.providersKeyGrafted = grafted;
                report.providersRequiringKeyReentry = reentry;
                continue;
            }
            // Known preference key — persist exactly as before.
            if (typeof value === 'object') {
                await setPreferenceObject(key, value);
            } else {
                // If it's a string, we might need setPreference, but setPreferenceObject handles objects
                // wrapper might be needed if base is string
                await setPreferenceObject(key, value);
            }
            report.keysWritten += 1;
        } catch (error) {
            console.error(`[ExportService] Failed to import key ${key}:`, error);
            report.failedKeys.push(key);
        }
    }

    if (report.skippedKeys.length || report.failedKeys.length || report.providersDropped || report.providersRequiringKeyReentry) {
        console.warn('[ExportService] importPreferencesData report:', report);
    }
    return report;
};
