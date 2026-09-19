import { HermesBot } from '../../types/bot';
import { getMemoryFiles, slugifyName } from '../learning/MemoryFilesService';
import { MemoryFile } from '../../types';

const shortBotId = (botId: string): string => slugifyName(botId).slice(0, 24) || botId.slice(0, 8);

/** The notebook folder holding this bot's system.md + memory.md. Exported so
 *  every WRITER names it exactly like this service READS it — a lesson written
 *  under a differently-derived name is invisible to the bot forever. */
export const botMemoryFolderName = (botId: string): string => `bots-${shortBotId(botId)}`;

const findBotFile = (botId: string, name: string): MemoryFile | undefined => {
    const childName = botMemoryFolderName(botId);
    const folder = getMemoryFiles().folders.find(f => f.name === childName);
    if (!folder) return undefined;
    return getMemoryFiles().files.find(f => f.folderId === folder.id && f.name === name);
};

export const readBotSystemMarkdown = (botId: string): string | null => {
    const file = findBotFile(botId, 'system.md');
    return file?.content ?? null;
};

export const readBotMemoryMarkdown = (botId: string): string | null => {
    const file = findBotFile(botId, 'memory.md');
    return file?.content ?? null;
};

export const getBotMemoryContext = (
    botId: string,
    query?: { coin?: string; direction?: string; family?: string; regime?: string },
    memoryScope: HermesBot['memoryScope'] = 'global',
): string => {
    const parts: string[] = [];
    const sys = readBotSystemMarkdown(botId);
    const mem = readBotMemoryMarkdown(botId);
    // The setup query now filters bot notes — a line that names a
    // different coin than this setup is dead weight in every prompt. The
    // system.md persona block always passes (it defines who the seat IS).
    const memFiltered = filterBotNoteByQuery(mem, query);
    const cap = memoryScope === 'isolated' ? 1200 : 900;
    if (sys) parts.push(`[bot:${botId}/system.md]\n${sys.slice(0, cap)}`);
    if (memFiltered) parts.push(`[bot:${botId}/memory.md]\n${memFiltered.slice(0, 1200)}`);
    return parts.join('\n\n---\n\n');
};

/**
 * Keep only lines relevant to THIS setup. Empty/short notes pass
 * through whole (a 2-line note cannot mismatch); otherwise keep bullet/
 * content lines that name the queried coin or regime, or carry no coin
 * reference at all (general lessons). Returns null when nothing qualifies.
 */
export const filterBotNoteByQuery = (
    note: string | null,
    query?: { coin?: string; direction?: string; family?: string; regime?: string },
): string | null => {
    if (!note) return null;
    const trimmed = note.trim();
    if (!trimmed) return null;
    if (!query?.coin && !query?.regime) return trimmed;
    const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
    // Very short notes are kept whole — filtering would cost more than it saves.
    if (lines.length < 3) return trimmed;
    const coin = (query.coin || '').toUpperCase().replace(/USDT?$/, '');
    const regime = (query.regime || '').toLowerCase();
    const kept = lines.filter(line => {
        const upper = line.toUpperCase();
        const mentionsCoin = coin ? upper.includes(coin) : false;
        const mentionsOtherCoin = /\b(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|AVAX|LINK)\b/.test(upper) && !mentionsCoin;
        if (mentionsCoin) return true;
        if (mentionsOtherCoin) return false; // another coin's specific lesson
        if (regime && line.toLowerCase().includes(regime)) return true;
        return true; // general lesson — no coin/regime specificity
    });
    return kept.length > 0 ? kept.join('\n') : null;
};

