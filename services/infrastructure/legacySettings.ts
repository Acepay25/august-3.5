/**
 * Removed-setting cleanup. The analyst-role / lens / ensemble settings were
 * deleted by owner ruling (2026-10-19); their preference keys are deleted here
 * on boot so a profile upgraded from an older build does not keep settings the
 * app can no longer read or explain.
 */
import { removePreference } from './PreferencesService';

const REMOVED_KEYS = [
    'analyst_lens_config',
    'ensemble_model_selection',
    'custom_ensemble_prompt',
    'custom_lens_prompts',
];

export async function stripRemovedAppSettings(): Promise<void> {
    for (const key of REMOVED_KEYS) {
        // removePreference owns both sides (Preferences on native, localStorage
        // on web); touching localStorage here would be a second, unregistered
        // raw store.
        try { await removePreference(key); } catch { /* best-effort */ }
    }
}
