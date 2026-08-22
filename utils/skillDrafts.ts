import { CraftedSkill } from '../schemas/learning';

export interface SkillDraft {
    id: string;
    tradeId: string;
    coin?: string;
    crafted: CraftedSkill;
    createdAt: string;
}

const KEY_PREFIX = 'skill_drafts_v1';
const LEGACY_KEY = KEY_PREFIX;

const storageKey = (username?: string): string =>
    `${KEY_PREFIX}:${(username || 'default').trim() || 'default'}`;

const read = (username?: string): SkillDraft[] => {
    try {
        const scopedKey = storageKey(username);
        const raw = localStorage.getItem(scopedKey)
            ?? (!username ? localStorage.getItem(LEGACY_KEY) : null);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const write = (drafts: SkillDraft[], username?: string): void => {
    try {
        localStorage.setItem(storageKey(username), JSON.stringify(drafts.slice(-20)));
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('august-skill-drafts'));
    } catch { /* ignore */ }
};

export const listSkillDrafts = (username?: string): SkillDraft[] =>
    typeof localStorage === 'undefined' ? [] : read(username);

export const queueSkillDraft = (draft: Omit<SkillDraft, 'id' | 'createdAt'>, username?: string): SkillDraft => {
    const next: SkillDraft = {
        ...draft,
        id: `sk-${Date.now()}`,
        createdAt: new Date().toISOString(),
    };
    const rest = listSkillDrafts(username).filter(d => d.tradeId !== draft.tradeId);
    write([...rest, next], username);
    return next;
};

export const takeSkillDraft = (id: string, username?: string): SkillDraft | null => {
    const drafts = listSkillDrafts(username);
    const hit = drafts.find(d => d.id === id) ?? null;
    write(drafts.filter(d => d.id !== id), username);
    return hit;
};

// ─── Rejection tombstones ───────────────────────────────────────────────────
// Discarding a draft used to leave no trace, so the next verdict citing the
// same pattern re-queued it immediately — the approval inbox became noise.
// A rejected trigger stays quiet for the cooldown window instead.

export const DRAFT_REJECT_COOLDOWN_MS = 7 * 24 * 3_600_000;

export interface SkillDraftTombstone {
    key: string;
    ts: string;
}

const tombstonesKey = (username?: string): string =>
    `${KEY_PREFIX}_rejected:${(username || 'default').trim() || 'default'}`;

const readTombstones = (username?: string): SkillDraftTombstone[] => {
    try {
        const raw = localStorage.getItem(tombstonesKey(username));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

/** Stable trigger identity of a draft: coin + kind + IF condition. */
export const draftTriggerKey = (
    coin: string | undefined,
    crafted: Pick<SkillDraft['crafted'], 'kind' | 'ifCondition'>,
): string =>
    [
        (coin || '').toUpperCase().replace(/USDT?$/, ''),
        crafted?.kind ?? '',
        crafted?.ifCondition ?? '',
    ].join('|').toLowerCase();

export const isDraftTombstoned = (
    key: string,
    username?: string,
    cooldownMs: number = DRAFT_REJECT_COOLDOWN_MS,
): boolean => {
    if (!key || typeof localStorage === 'undefined') return false;
    const cutoff = Date.now() - cooldownMs;
    return readTombstones(username).some(t => t.key === key && Date.parse(t.ts) > cutoff);
};

/** Record a user rejection — the matching trigger won't be re-queued during the cooldown. */
export const tombstoneSkillDraftKey = (key: string, username?: string): void => {
    if (!key || typeof localStorage === 'undefined') return;
    const next = [
        { key, ts: new Date().toISOString() },
        ...readTombstones(username).filter(t => t.key !== key),
    ].slice(0, 50);
    try {
        localStorage.setItem(tombstonesKey(username), JSON.stringify(next));
    } catch { /* ignore */ }
};
