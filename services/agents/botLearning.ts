/**
 * botLearning — the bot half of the learning loop (WS-3).
 *
 * Until now bots were READ-ONLY learners: the chart pipeline merges bot
 * memory into analyst prompts, and bots read their own system/notes, but a
 * bot turn never consulted the shared notebook and never wrote anything
 * back. This module closes both directions:
 *
 *  - buildBotSharedMemoryContext: a budgeted slice of the same
 *    MemoryRetrievalService retrieval the debate analysts get, mined from the
 *    turn's prompt, attributed under the turn's id so a trade that follows a
 *    bot's call can credit the skills the bot was shown. Isolated-scope bots
 *    skip shared retrieval entirely.
 *  - recordBotTurnOutcome: writes the turn's lesson into the bot's own
 *    memory.md and folds closed bot-authored trades into the shared evidence
 *    path (syncClosedTradeToNotebook — the same write-back the chart AI's
 *    post-mortems get, worth gate included).
 *
 * Everything here is fire-and-forget safe: a failure logs and returns, never
 * breaks the turn.
 */

import type { LoggedTrade } from '../../types';
import { getMemoryFilesContext, listRetrievedMemorySources, type MemoryRetrievalQuery } from '../learning/MemoryRetrievalService';
import { recordMemoryInjection } from '../learning/MemoryInjectionService';
import { readBotMemoryMarkdown, botMemoryFolderName } from '../bots/BotMemoryService';
import {
    createMemoryFile,
    createMemoryFolder,
    findFolderByName,
    getMemoryFiles,
    updateMemoryFile,
    extractLessonFromPostMortem,
} from '../learning/MemoryFilesService';
import { syncClosedTradeToNotebook, listSkills, stampSkillOrigin } from '../learning/SkillMemoryService';
import { getBots } from './agentRoster';
import { COMMON_WORDS } from '../../constants/commonWords';

/** Bots get the smallest honest slice — their persona/notes already ride the
 *  system prompt; the shared slice is evidence, not a second personality. */
const BOT_SHARED_MEMORY_CAP = 700;
const BOT_LESSON_MAX_CHARS = 280;
/** Below this a "lesson" is a fragment, not something worth spending prompt
 *  budget on every future turn. */
const BOT_LESSON_MIN_CHARS = 20;
const BOT_MEMORY_FILE_MAX_CHARS = 4000;

/** Mine the setup query from a bot turn's prompt — the same coin/direction
 *  discipline as hooks/analysisPipeline/memoryContext.ts, kept local so the
 *  agents layer never imports a hook. */
export const mineBotTurnQuery = (prompt: string): MemoryRetrievalQuery => {
    const coinRaw = prompt.match(/\b([A-Z]{2,10})(?:USDT?)?/)?.[1]?.toUpperCase();
    const lower = prompt.toLowerCase();
    return {
        coin: coinRaw && !COMMON_WORDS.includes(coinRaw) ? coinRaw : undefined,
        direction: lower.includes('long') ? 'Long' : lower.includes('short') ? 'Short' : 'Neutral',
    };
};

/**
 * The shared notebook slice for one bot turn. Returns '' when the bot is
 * isolated-scope or nothing matched.
 */
export const buildBotSharedMemoryContext = (
    prompt: string,
    opts: { botId: string; memoryScope: 'global' | 'isolated' },
): string => {
    if (opts.memoryScope === 'isolated') return '';
    try {
        // No runId: the ε-holdout exists for debate runs that produce trades;
        // withholding skills from a bot's chat turn would grow no control
        // group (bot turns rarely log trades) — attribution rides
        // recordBotTurnInjection instead.
        const ctx = getMemoryFilesContext(mineBotTurnQuery(prompt), undefined, 'analyst', 'opening');
        if (!ctx.trim()) return '';
        return ctx.length > BOT_SHARED_MEMORY_CAP ? `${ctx.slice(0, BOT_SHARED_MEMORY_CAP).trimEnd()}\n…` : ctx;
    } catch {
        return '';
    }
};

/** Attribution record for the bot's turn: which memory sources (plus the
 *  bot's own notes) shaped the reply. Fire-and-forget. */
export const recordBotTurnInjection = (
    opts: { botId: string; username: string; runId: string; prompt: string; memoryScope: 'global' | 'isolated' },
): void => {
    try {
        const sources: Array<{ path: string; kind: string }> = [];
        if (readBotMemoryMarkdown(opts.botId)) sources.push({ path: `${botMemoryFolderName(opts.botId)}/memory.md`, kind: 'bot' });
        if (opts.memoryScope !== 'isolated') {
            for (const s of listRetrievedMemorySources(mineBotTurnQuery(opts.prompt), undefined, 'analyst')) {
                sources.push({ path: s.path, kind: s.kind });
            }
        }
        void recordMemoryInjection(opts.username, {
            stage: 'opening',
            audience: `bot:${opts.botId}`,
            runId: opts.runId,
            sources,
        });
    } catch { /* telemetry must never break a turn */ }
};

/**
 * Trade ids already folded into the notebook this session, per bot.
 * syncClosedTradeToNotebook is idempotent for its diary/evidence writes, but
 * its worth-gate leg is a LIVE LLM call that fires whenever a cluster has no
 * matching skill yet — so re-feeding the same closed trades on every DM turn
 * would turn casual chat into an unbounded spend with nothing to show for it.
 */
const foldedTrades = new Map<string, Set<string>>();

/**
 * The lesson in a bot turn's reply — or '' when there isn't one.
 *
 * extractLessonFromPostMortem is built for post-mortems: structured text whose
 * prose FALLBACK (first sentence over 20 chars) is already known to be a
 * lesson. A chat reply carries no such guarantee, so using it directly
 * memorialized refusals, disclaimers and "I have no price data here" into the
 * bot's memory.md — where retrieval feeds it back into every future turn of
 * that bot. So: require the reply to label a lesson before extracting one.
 */
const BOT_LESSON_LABEL = /(?:key\s+)?(?:lesson|takeaway|learning|correction|next\s+time)\s*[:\-–]/i;

export const lessonFromBotTurn = (reply: string): string => {
    if (!reply || !BOT_LESSON_LABEL.test(reply)) return '';
    const lesson = extractLessonFromPostMortem(reply);
    return lesson.length >= BOT_LESSON_MIN_CHARS ? lesson : '';
};

/**
 * Persist what a bot turn learned. Two writes:
 *  1. A one-line lesson appended to the bot's own memory.md (capped so the
 *     file can't grow unbounded; query-filtered retrieval keeps it relevant).
 *  2. Closed bot-authored trades fold into the shared evidence path — a trade
 *     whose modelsUsed pair IS this bot's identity (utils/agentThreads
 *     single-model rule) is this bot's call, and it earns the same
 *     syncClosedTradeToNotebook write-back a chart-AI trade gets.
 */
export const recordBotTurnOutcome = async (
    bot: { id: string; name: string; providerId: string },
    prompt: string,
    reply: string,
    opts: { username: string; trades: LoggedTrade[] },
): Promise<void> => {
    try {
        // 1. The lesson line. Only a reply that LABELS a lesson earns one —
        //    refusals, disclaimers and empty turns are not lessons.
        const lesson = lessonFromBotTurn(reply);
        if (lesson) {
            const folderName = botMemoryFolderName(bot.id);
            let folder = findFolderByName(folderName);
            if (!folder) folder = await createMemoryFolder(folderName, opts.username);
            const existing = getMemoryFiles().files.find(f => f.folderId === folder.id && f.name === 'memory.md');
            const stamp = new Date().toISOString().slice(0, 10);
            const line = `- [${stamp}] ${lesson.slice(0, BOT_LESSON_MAX_CHARS)}`;
            const next = existing
                ? `${existing.content.trimEnd()}\n${line}`.slice(-BOT_MEMORY_FILE_MAX_CHARS)
                : `# ${bot.name} — learned memory\n\n${line}`;
            if (existing) await updateMemoryFile(existing.id, { content: next }, opts.username);
            else await createMemoryFile(folder.id, 'memory.md', next, opts.username, true);
        }

        // 2. Closed bot-authored trades fold into the shared evidence path.
        //    Snapshot the skill set first: provenance belongs only on files
        //    THIS fold created, never on a chart-AI skill that happened to
        //    count the same trade.
        const before = new Set(listSkills().map(({ file }) => file.id));
        const seen = foldedTrades.get(bot.id) ?? new Set<string>();
        const botTrades = opts.trades.filter(t => {
            const keys = Object.keys(t.modelsUsed ?? {});
            return keys.length === 1 && keys[0] === bot.providerId
                && (t.outcome === 'WIN' || t.outcome === 'LOSS')
                && !seen.has(t.id);
        });
        for (const trade of botTrades.slice(-2)) {
            // Mark before awaiting: a throw halfway must not make the next
            // turn re-fold it.
            seen.add(trade.id);
            foldedTrades.set(bot.id, seen);
            await syncClosedTradeToNotebook(trade, opts.trades, opts.username, { botId: bot.id, botName: bot.name });
        }
        for (const { file } of listSkills()) {
            if (!before.has(file.id)) await stampSkillOrigin(file.id, bot, opts.username);
        }
    } catch (e) {
        console.warn('[BotLearning] outcome write failed (non-fatal):', e instanceof Error ? e.message : e);
    }
};

/** How many lesson lines this bot has earned. The cheap read side of the
 *  per-bot learning stats the roster surfaces, and the only way to tell a
 *  written lesson apart from an empty notebook. */
export const botLessonCount = (botId: string): number => {
    const note = readBotMemoryMarkdown(botId);
    if (!note) return 0;
    return note.split('\n').filter(l => l.trim().startsWith('- [')).length;
};

export interface BotLearningStat {
    id: string;
    name: string;
    /** Lesson lines in the bot's own memory.md. */
    lessons: number;
    /** Skills this bot authored (WS-3.3 provenance). */
    skillsAuthored: number;
    /** Counted trades behind those skills. */
    evidence: number;
    /** Newest lesson date in the bot's notes, YYYY-MM-DD, or null. */
    lastLessonAt: string | null;
}

/** Per-bot learning stats for the roster rail / Learn surface (WS-3.4). */
export const loadBotLearningStats = (): BotLearningStat[] => {
    const skills = listSkills();
    return getBots().map(b => {
        const own = skills.filter(s => s.meta.originBotId === b.id);
        const note = readBotMemoryMarkdown(b.id) ?? '';
        const dates = [...note.matchAll(/-\s+\[(\d{4}-\d{2}-\d{2})\]/g)].map(m => m[1]);
        return {
            id: b.id,
            name: b.name,
            lessons: botLessonCount(b.id),
            skillsAuthored: own.length,
            evidence: own.reduce((n, s) => n + (s.meta.evidenceCount ?? s.meta.tradeIds.length), 0),
            lastLessonAt: dates.length ? dates.reduce((a, d) => (d > a ? d : a)) : null,
        };
    });
};

