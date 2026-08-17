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
