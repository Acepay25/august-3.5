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
    'last_moderator_pick_v1',
];

/** Per-user stores the current roster does not read. The old BotRegistry wrote
 *  `bots_v1_<user>`; the new roster is `agents_bots_v1_<user>`. The old key is
 *  dead bytes, not a migration source: the owner ruled the desk starts empty. */
const REMOVED_PREFIXES = ['bots_v1_'];

export async function stripRemovedAppSettings(): Promise<void> {
    for (const key of REMOVED_KEYS) {
        // removePreference removes the Preferences copy on native and the
        // localStorage copy on web. Older native builds dual-wrote these keys,
        // so the WebView localStorage copy can still exist there; nothing reads
        // it any more, and this cleanup removes the bytes as well.
        try { await removePreference(key); } catch { /* best-effort */ }
        try {
            if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
        } catch { /* best-effort */ }
    }
    try {
        if (typeof localStorage !== 'undefined') {
            for (let i = localStorage.length - 1; i >= 0; i -= 1) {
                const key = localStorage.key(i);
                if (key && REMOVED_PREFIXES.some(prefix => key.startsWith(prefix))) {
                    localStorage.removeItem(key);
                }
            }
        }
    } catch { /* best-effort */ }
}
