import { HermesBot } from '../../types/bot';
import {
    createMemoryFile,
    createMemoryFolder,
    deleteMemoryFile,
    getMemoryFiles,
    slugifyName,
    updateMemoryFile,
} from '../learning/MemoryFilesService';
import { MemoryFile } from '../../types';

export const botMemoryFolder = (botId: string): string => `bots/${botId}`;

const BOTS_PARENT = 'bots';

const shortBotId = (botId: string): string => slugifyName(botId).slice(0, 24) || botId.slice(0, 8);

const ensureBotsParentFolder = async (username: string): Promise<string> => {
    const existing = getMemoryFiles().folders.find(f => f.name === BOTS_PARENT);
    if (existing) return existing.id;
    const created = await createMemoryFolder(BOTS_PARENT, username);
    return created.id;
};

const ensureBotChildFolder = async (botId: string, username: string): Promise<string> => {
    const parentId = await ensureBotsParentFolder(username);
    const childName = `bots-${shortBotId(botId)}`;
    const existing = getMemoryFiles().folders.find(f => f.name === childName);
    if (existing) return existing.id;
    const created = await createMemoryFolder(childName, username);
    void parentId;
    return created.id;
};

const botSystemContent = (bot: HermesBot): string => {
    const lines: string[] = [
        `# ${bot.name} — System Prompt`,
        `> Role: ${bot.role} · ${bot.providerId}:${bot.model}${bot.job ? ` · ${bot.job}` : ''}`,
        '',
    ];
    if (bot.systemPromptOverride) {
        lines.push(bot.systemPromptOverride.trim(), '');
    }
    if (bot.personality) {
        lines.push('## Personality', '', bot.personality.trim(), '');
    }
    if (!bot.systemPromptOverride && !bot.personality) {
        lines.push('_No custom system prompt — using role default._', '');
    }
    return lines.join('\n');
};

const findBotFile = (botId: string, name: string): MemoryFile | undefined => {
    const childName = `bots-${shortBotId(botId)}`;
    const folder = getMemoryFiles().folders.find(f => f.name === childName);
    if (!folder) return undefined;
    return getMemoryFiles().files.find(f => f.folderId === folder.id && f.name === name);
};

export const ensureBotMemoryFiles = async (bot: HermesBot, username: string): Promise<void> => {
    const folderId = await ensureBotChildFolder(bot.id, username);
    const system = findBotFile(bot.id, 'system.md');
    const sysContent = botSystemContent(bot);
    if (!system) {
        await createMemoryFile(folderId, 'system.md', sysContent, username, true);
    } else if (system.content.trim() !== sysContent.trim()) {
        // JSON is newer than the file (edited in drawer) — sync to file.
        // If the file was edited in the notebook, the JSON sync runs separately.
        await updateMemoryFile(system.id, { content: sysContent }, username);
    }
    const memory = findBotFile(bot.id, 'memory.md');
    if (!memory) {
        await createMemoryFile(folderId, 'memory.md', `# ${bot.name} — Memory\n\nDurable notes for this bot. The model can append learnings here.\n`, username, true);
    }
};

export const readBotSystemMarkdown = (botId: string): string | null => {
    const file = findBotFile(botId, 'system.md');
    return file?.content ?? null;
};

export const readBotMemoryMarkdown = (botId: string): string | null => {
    const file = findBotFile(botId, 'memory.md');
    return file?.content ?? null;
};

export const writeBotSystemMarkdown = async (botId: string, content: string, username: string): Promise<void> => {
    const folderId = await ensureBotChildFolder(botId, username);
    const existing = findBotFile(botId, 'system.md');
    const trimmed = content.trim();
    if (!trimmed) throw new Error('System prompt is empty');
    if (existing) await updateMemoryFile(existing.id, { content: trimmed + '\n' }, username);
    else await createMemoryFile(folderId, 'system.md', trimmed + '\n', username, true);
};

export const writeBotMemoryMarkdown = async (botId: string, content: string, username: string): Promise<void> => {
    const folderId = await ensureBotChildFolder(botId, username);
    const existing = findBotFile(botId, 'memory.md');
    if (existing) await updateMemoryFile(existing.id, { content }, username);
    else await createMemoryFile(folderId, 'memory.md', content, username, true);
};

export const getBotMemoryContext = (
    botId: string,
    query?: { coin?: string; direction?: string; family?: string; regime?: string },
    memoryScope: HermesBot['memoryScope'] = 'global',
): string => {
    void query;
    const parts: string[] = [];
    const sys = readBotSystemMarkdown(botId);
    const mem = readBotMemoryMarkdown(botId);
    const cap = memoryScope === 'isolated' ? 1200 : 900;
    if (sys) parts.push(`[bot:${botId}/system.md]\n${sys.slice(0, cap)}`);
    if (mem) parts.push(`[bot:${botId}/memory.md]\n${mem.slice(0, 1200)}`);
    return parts.join('\n\n---\n\n');
};

export const shouldIncludeSkillForBot = (
    bot: HermesBot | undefined,
    skill: { coin?: string; family?: string }
): boolean => {
    if (!bot?.skillFilter) return true;
    const { coins, families } = bot.skillFilter;
    if (coins && coins.length > 0 && skill.coin && !coins.includes(skill.coin)) return false;
    if (families && families.length > 0 && skill.family && !families.includes(skill.family)) return false;
    return true;
};

export const botScopedSkillKey = (botId: string, skillId: string): string => `${botId}:${skillId}`;

export const syncBotSystemFromFile = (bot: HermesBot): HermesBot => {
    const content = readBotSystemMarkdown(bot.id);
    if (!content) return bot;
    const personalitySplit = content.split(/^##\s+Personality\s*$/m);
    const main = personalitySplit[0]
        .replace(/^#.*\n/, '')
        .replace(/^>.*\n/, '')
        .trim();
    const personality = personalitySplit[1]?.trim() || undefined;
    if (main && main !== '_No custom system prompt — using role default._') {
        return { ...bot, systemPromptOverride: main, personality: personality || bot.personality, updatedAt: Date.now() };
    }
    return bot;
};

export const deleteBotMemoryFolder = async (botId: string, username: string): Promise<void> => {
    const childName = `bots-${shortBotId(botId)}`;
    const folder = getMemoryFiles().folders.find(f => f.name === childName);
    if (!folder) return;
    const files = getMemoryFiles().files.filter(f => f.folderId === folder.id);
    for (const f of files) await deleteMemoryFile(f.id, username);
    const { deleteMemoryFolder } = await import('../learning/MemoryFilesService');
    await deleteMemoryFolder(folder.id, username);
};
