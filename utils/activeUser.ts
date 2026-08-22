/**
 * Single home for "which user is active right now" reads. Trade logging,
 * post-mortem and pipeline write paths run outside React render context, so
 * they read the persisted marker directly — but through this helper so the
 * key and fallback live in exactly one place.
 */
const LAST_ACTIVE_USER_KEY = 'last_active_user';

export const getActiveUsername = (): string =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(LAST_ACTIVE_USER_KEY)) || 'default';
