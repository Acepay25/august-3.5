import { getMemoryFiles, slugifyName } from '../learning/MemoryFilesService';
import { clipNote } from '../../utils/harnessMarks';
import { BOT_MEMORY_PER_AGENT_CHAR_BUDGET } from './botMemoryBudget';
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

/**
 * What this agent carries into a turn: its `system.md` persona block plus the
 * parts of its `memory.md` that fit THIS setup.
 *
 * `budgetChars` is the caller's decision, not this function's. A surface that
 * merges N agents divides its allowance between them; a surface answering as
 * ONE agent gives it the whole thing. It is deliberately NOT derived from
 * `memoryScope`: scope decides whose notes are SHARED (enforced in
 * `buildBotSharedMemoryContext` and `botLearning`), and reading it here used to
 * hand an ISOLATED bot a larger budget than a global one — the opposite of why
 * the field exists, and invisible because nothing said so.
 *
 * A file that does not fit says so. Silently head-slicing meant the model read
 * 900 characters of a longer notebook as the whole of it, which is the exact
 * failure `harnessMarks` exists to prevent.
 */
export const getBotMemoryContext = (
    botId: string,
    query?: { coin?: string; direction?: string; family?: string; regime?: string; knownCoins?: string[] },
    budgetChars: number = BOT_MEMORY_PER_AGENT_CHAR_BUDGET,
): string => {
    const sys = readBotSystemMarkdown(botId);
    const mem = readBotMemoryMarkdown(botId);
    // The setup query filters bot notes — a line that names a different coin
    // than this setup is dead weight in every prompt. The system.md persona
    // block always passes (it defines who the seat IS).
    const memFiltered = filterBotNoteByQuery(mem, query);
    const parts: string[] = [];
    let room = Math.max(0, budgetChars);
    for (const [label, text] of [['system.md', sys], ['memory.md', memFiltered]] as const) {
        if (!text || room <= 0) continue;
        const whole = `[bot:${botId}/${label}]\n${text}`;
        if (whole.length <= room) {
            parts.push(whole);
            room -= whole.length;
            continue;
        }
        // Spend what is left on the CONTENT, then name the gap in the
        // canonical dialect so the count is re-parseable by this app.
        const header = `[bot:${botId}/${label}]\n`;
        const kept = Math.max(0, room - header.length - clipNote({ source: 'x', kept: 0, total: 0 }).length);
        if (kept < 40) {
            parts.push(`${header}${clipNote({ source: label, kept: 0, total: text.length, guidance: 'this agent carries more notes than the prompt had room for' })}`);
            room = 0;
            continue;
        }
        parts.push(
            `${header}${text.slice(0, kept)}\n`
            + clipNote({ source: label, kept, total: text.length, guidance: 'the withheld lines are older notes, not absent ones' }),
        );
        room = 0;
    }
    return parts.join('\n\n---\n\n');
};

/**
 * Keep only lines relevant to THIS setup. Empty/short notes pass
 * through whole (a 2-line note cannot mismatch); otherwise keep bullet/
 * content lines that name the queried coin or regime, or carry no coin
 * reference at all (general lessons). Returns null when nothing qualifies.
 */
/**
 * The baseline coin vocabulary a note may name. This is a FLOOR, not the
 * truth: it used to be the entire universe, so on any symbol outside these
 * nine the "another coin's lesson" test never fired and the filter silently
 * kept every line — BTC-only advice on an ARBITRUM chart read as general.
 * Callers that know more (the trader's own traded symbols) pass `knownCoins`
 * and it is added here rather than replacing this.
 */
const BASELINE_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK'];

const bareCoin = (c: string): string => (c || '').toUpperCase().replace(/USDT?$/, '');

const otherCoinPattern = (self: string, knownCoins?: string[]): RegExp | null => {
    const universe = [...BASELINE_COINS, ...(knownCoins ?? []).map(bareCoin)]
        .map(bareCoin)
        .filter(c => c.length >= 2 && c !== self);
    if (universe.length === 0) return null;
    // Symbols arrive from an exchange and from user data, so they are data
    // here, not pattern source.
    const escaped = [...new Set(universe)].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`\\b(${escaped.join('|')})\\b`);
};

export const filterBotNoteByQuery = (
    note: string | null,
    query?: { coin?: string; direction?: string; family?: string; regime?: string; knownCoins?: string[] },
): string | null => {
    if (!note) return null;
    const trimmed = note.trim();
    if (!trimmed) return null;
    if (!query?.coin && !query?.regime) return trimmed;
    const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
    // Very short notes are kept whole — filtering would cost more than it saves.
    if (lines.length < 3) return trimmed;
    const coin = bareCoin(query.coin || '');
    const regime = (query.regime || '').toLowerCase();
    const others = otherCoinPattern(coin, query.knownCoins);
    const coinRe = coin ? new RegExp(`\\b${coin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : null;
    const kept = lines.filter(line => {
        const upper = line.toUpperCase();
        // Word boundaries for the queried coin too, not just the others: a bare
        // `includes()` matched 'OP' inside "LondOPen" and 'IN' inside "MARGIN",
        // so a short symbol quietly turned every note into "about this coin".
        const mentionsCoin = coinRe ? coinRe.test(upper) : false;
        if (mentionsCoin) return true;
        if (others && others.test(upper)) return false; // another coin's specific lesson
        if (regime && line.toLowerCase().includes(regime)) return true;
        return true; // general lesson — no coin/regime specificity
    });
    return kept.length > 0 ? kept.join('\n') : null;
};

