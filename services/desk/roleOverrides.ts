/**
 * roleOverrides — per-user seat-name → role override table for the desk
 * view. The heuristic in `pixelAvatars.roleForName` works for the 8
 * default presets (Macro / Technical / Risk / etc.) but a custom roster
 * (e.g. "Satoshi", "Fibonacci", "Liquidity Hunter") falls into the wing
 * fan-out. The Settings → Roles panel lets the trader pin a custom
 * actor name to one of the 8 known roles. This module owns the
 * persistence + the live read API.
 *
 * Persistence: localStorage under `desk_role_overrides_v1`. The user
 * is part of the key (the trader may have multiple users) so the table
 * is scoped per user, matching the rest of the desk view's behavior.
 *
 * The DeskScene subscribes to updates via `subscribeRoleOverrides` so a
 * Settings edit propagates without a reload.
 */

import { roleForName, type RolePreset } from '../../components/desk/pixelAvatars';

const STORAGE_KEY = 'desk_role_overrides_v1';

export type RoleOverrides = Record<string, RolePreset>;

const safeParse = (raw: string | null): RoleOverrides => {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Keep only the role-preset keys we know about.
            const out: RoleOverrides = {};
            for (const [name, role] of Object.entries(parsed)) {
                if (typeof name !== 'string' || !name) continue;
                if (typeof role !== 'string') continue;
                if (isKnownRole(role)) out[name] = role;
            }
            return out;
        }
    } catch {
        // Fall through — corrupted localStorage entry is treated as empty.
    }
    return {};
};

const isKnownRole = (role: string): role is RolePreset => {
    return ['risk', 'macro', 'technical', 'sentiment', 'moderator',
        'followup', 'postmortem', 'execution', 'unknown'].includes(role);
};

const read = (): RoleOverrides => {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
};

const write = (overrides: RoleOverrides): void => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
        // Quota exceeded / private mode — ignore; the table is non-critical.
    }
};

// Tiny pub/sub so the desk view re-renders on Settings edits without
// needing React Context (the store lives in localStorage and is the same
// across all mounts of the desk scene).
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = (): void => {
    for (const l of listeners) l();
};

/** Read the current override table. */
export const getRoleOverrides = (): RoleOverrides => read();

/** Replace the entire override table. */
export const setRoleOverrides = (next: RoleOverrides): void => {
    write(next);
    notify();
};

/** Add or update a single mapping. */
export const setRoleOverride = (name: string, role: RolePreset): void => {
    const next = { ...read(), [name]: role };
    write(next);
    notify();
};

/** Remove a single mapping (falls back to the heuristic). */
export const clearRoleOverride = (name: string): void => {
    const next = { ...read() };
    delete next[name];
    write(next);
    notify();
};

/** Subscribe to override table changes. Returns an unsubscribe fn. */
export const subscribeRoleOverrides = (l: Listener): (() => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
};

/** Resolve a seat name to a role, honoring the user's overrides first. */
export const resolveRole = (name: string): RolePreset => {
    const overrides = read();
    if (overrides[name]) return overrides[name];
    return roleForName(name);
};
