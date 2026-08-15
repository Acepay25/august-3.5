import { CraftedSkill } from '../schemas/learning';

export interface SkillDraft {
    id: string;
    tradeId: string;
    coin?: string;
    crafted: CraftedSkill;
    createdAt: string;
}

const KEY = 'skill_drafts_v1';

const read = (): SkillDraft[] => {
    try {
        const raw = localStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const write = (drafts: SkillDraft[]): void => {
    try {
        localStorage.setItem(KEY, JSON.stringify(drafts.slice(-20)));
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('august-skill-drafts'));
    } catch { /* ignore */ }
};

export const listSkillDrafts = (): SkillDraft[] =>
    typeof localStorage === 'undefined' ? [] : read();

export const queueSkillDraft = (draft: Omit<SkillDraft, 'id' | 'createdAt'>): SkillDraft => {
    const next: SkillDraft = {
        ...draft,
        id: `sk-${Date.now()}`,
        createdAt: new Date().toISOString(),
    };
    const rest = listSkillDrafts().filter(d => d.tradeId !== draft.tradeId);
    write([...rest, next]);
    return next;
};

export const takeSkillDraft = (id: string): SkillDraft | null => {
    const drafts = listSkillDrafts();
    const hit = drafts.find(d => d.id === id) ?? null;
    write(drafts.filter(d => d.id !== id));
    return hit;
};
