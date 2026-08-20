import { HermesBot, defaultToolsForRole } from '../../types/bot';
import { AnalystRole } from '../../types/enums';
import { PREF_KEYS, getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';

const MAX_BOTS = 12;

let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op, op);
    queue = run.catch(() => undefined);
    return run;
};

const botKey = (): string => {
    const user = (typeof localStorage !== 'undefined' ? localStorage.getItem('last_active_user') : null) || 'default';
    return `${PREF_KEYS.BOTS}_${user}`;
};

interface BotStorage {
    bots: HermesBot[];
    updatedAt: string;
}

const nowIso = (): string => new Date().toISOString();

const empty = (): BotStorage => ({ bots: [], updatedAt: nowIso() });

async function loadRaw(): Promise<BotStorage> {
    try {
        const data = await getPreferenceObject<BotStorage>(botKey());
        if (data && Array.isArray(data.bots)) return data;
    } catch { /* empty */ }
    return empty();
}

async function saveRaw(storage: BotStorage): Promise<void> {
    await setPreferenceObject(botKey(), { ...storage, updatedAt: nowIso() });
}

const newId = (): string => `bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const normalize = (bot: HermesBot): HermesBot => ({
    ...bot,
    id: bot.id || newId(),
    name: (bot.name || 'Bot').trim().slice(0, 32) || 'Bot',
    role: bot.role || AnalystRole.UNASSIGNED,
    providerId: (bot.providerId || '').trim(),
    model: (bot.model || '').trim(),
    memoryScope: bot.memoryScope || 'global',
    enabledTools: Array.isArray(bot.enabledTools) && bot.enabledTools.length > 0
        ? bot.enabledTools
        : defaultToolsForRole(bot.role || AnalystRole.UNASSIGNED),
    createdAt: bot.createdAt || Date.now(),
    updatedAt: Date.now(),
});

export const BotRegistry = {
    async list(): Promise<HermesBot[]> {
        return (await loadRaw()).bots;
    },

    async get(id: string): Promise<HermesBot | undefined> {
        return (await loadRaw()).bots.find(b => b.id === id);
    },

    upsert(bot: HermesBot): Promise<HermesBot> {
        return enqueue(async () => {
            const storage = await loadRaw();
            const normalized = normalize(bot);
            const idx = storage.bots.findIndex(b => b.id === normalized.id);
            if (idx >= 0) storage.bots[idx] = normalized;
            else {
                if (storage.bots.length >= MAX_BOTS) throw new Error(`Bot limit reached (${MAX_BOTS})`);
                storage.bots.push(normalized);
            }
            await saveRaw(storage);
            return normalized;
        });
    },

    create(partial: Partial<HermesBot> & { name: string; providerId: string; model: string }): Promise<HermesBot> {
        const bot: HermesBot = {
            id: newId(),
            name: partial.name,
            avatarUrl: partial.avatarUrl,
            role: partial.role || AnalystRole.UNASSIGNED,
            providerId: partial.providerId,
            model: partial.model,
            job: partial.job,
            description: partial.description,
            systemPromptOverride: partial.systemPromptOverride,
            personality: partial.personality,
            memoryScope: partial.memoryScope || 'global',
            enabledTools: partial.enabledTools || defaultToolsForRole(partial.role || AnalystRole.UNASSIGNED),
            skillFilter: partial.skillFilter,
            hidden: partial.hidden,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        return this.upsert(bot);
    },

    remove(id: string): Promise<void> {
        return enqueue(async () => {
            const storage = await loadRaw();
            storage.bots = storage.bots.filter(b => b.id !== id);
            await saveRaw(storage);
        });
    },

    setHidden(id: string, hidden: boolean): Promise<void> {
        return enqueue(async () => {
            const storage = await loadRaw();
            const bot = storage.bots.find(b => b.id === id);
            if (!bot) return;
            bot.hidden = hidden || undefined;
            bot.updatedAt = Date.now();
            await saveRaw(storage);
        });
    },

    duplicate(id: string): Promise<HermesBot | undefined> {
        return enqueue(async () => {
            const storage = await loadRaw();
            const src = storage.bots.find(b => b.id === id);
            if (!src) return undefined;
            if (storage.bots.length >= MAX_BOTS) throw new Error(`Bot limit reached (${MAX_BOTS})`);
            const copy: HermesBot = {
                ...src,
                id: newId(),
                name: `${src.name} copy`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            storage.bots.push(copy);
            await saveRaw(storage);
            return copy;
        });
    },

    async seedIfEmpty(fallback: Array<{ providerId: string; model: string; role: AnalystRole; name: string }>): Promise<HermesBot[]> {
        const storage = await loadRaw();
        if (storage.bots.length > 0) return storage.bots;
        const seeded: HermesBot[] = fallback.slice(0, 3).map(f => ({
            id: newId(),
            name: f.name,
            role: f.role,
            providerId: f.providerId,
            model: f.model,
            memoryScope: 'global' as const,
            enabledTools: defaultToolsForRole(f.role),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }));
        await saveRaw({ bots: seeded, updatedAt: nowIso() });
        return seeded;
    },
};
