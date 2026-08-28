/**
 * idleMotion — per-user "is the desk breathing" preference.
 *
 * Persists to localStorage under `desk_idle_motion_v1_<user>` and
 * exposes a React-friendly pub/sub so the Settings menu toggle and
 * the desk view (which adds a className to <body>) stay in sync.
 *
 * The CSS gates the actual animations on this pref via the
 * `.desk-idle-motion-off` body class. prefers-reduced-motion is a
 * separate, OS-level signal; this is the user-tunable equivalent.
 */

import { getActiveUsername } from '../../utils/activeUser';

const STORAGE_KEY_PREFIX = 'desk_idle_motion_v1';
const DEFAULT_VALUE = true;

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

const storageKey = (): string => `${STORAGE_KEY_PREFIX}_${getActiveUsername()}`;

const read = (): boolean => {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_VALUE;
    const raw = window.localStorage.getItem(storageKey());
    if (raw === null) return DEFAULT_VALUE;
    return raw !== '0' && raw !== 'false';
};

const write = (value: boolean): void => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        window.localStorage.setItem(storageKey(), value ? '1' : '0');
    } catch {
        // Quota / private mode — ignore.
    }
};

const applyToBody = (enabled: boolean): void => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('desk-idle-motion-off', !enabled);
};

applyToBody(DEFAULT_VALUE);

/** Read the current setting for the active user. */
export const getIdleMotionEnabled = (): boolean => read();

/** Set the setting for the active user. Applies the body class and
 *  notifies subscribers. The body toggle is idempotent so we always
 *  apply it — no last-applied shortcut. */
export const setIdleMotionEnabled = (enabled: boolean): void => {
    write(enabled);
    applyToBody(enabled);
    for (const l of listeners) l(enabled);
};

/** Subscribe to setting changes. Returns an unsubscribe fn. */
export const subscribeIdleMotion = (l: Listener): (() => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
};

/** Apply the active user's stored preference to the body class.
 *  Call on app startup so the body class reflects the persisted
 *  value before the desk view mounts. */
export const reapplyIdleMotionClass = (): void => {
    applyToBody(read());
};
