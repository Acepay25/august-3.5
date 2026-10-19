/**
 * The last moderator pick, persisted so a scheduled run and a fresh session
 * start from the model the trader last chose. This survived the analyst-role
 * removal: a moderator is a SEAT PICK, not a role.
 */
import { setPreferenceObject, PREF_KEYS } from './PreferencesService';

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
