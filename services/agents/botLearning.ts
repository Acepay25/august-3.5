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
 *    memory.md, runs the bot's closed trades through the SAME draft chain the
 *    chart AI's post-mortems use (craftSkillFromPostMortem → the evidence-
 *    backed draft gate, with that bot's memory as the gate's context), and
 *    folds them into the shared evidence path via syncClosedTradeToNotebook.
 *
 * Everything here is fire-and-forget safe: a failure logs and returns, never
 * breaks the turn.
 */

import type { LoggedTrade } from '../../types';
import { getMemoryFilesContext, listRetrievedMemorySources, type MemoryRetrievalQuery } from '../learning/MemoryRetrievalService';
import { recordMemoryInjection } from '../learning/MemoryInjectionService';
import { readBotMemoryMarkdown, botMemoryFolderName, getBotMemoryContext } from '../bots/BotMemoryService';
import {
    createMemoryFile,
    createMemoryFolder,
    findFolderByName,
    getMemoryFiles,
    updateMemoryFile,
    extractLessonFromPostMortem,
} from '../learning/MemoryFilesService';
import { syncClosedTradeToNotebook, listSkills, stampSkillOrigin } from '../learning/SkillMemoryService';
import { craftSkillFromPostMortem } from '../learning/SkillCraftService';
import { gateEvidenceBackedDraft } from '../learning/draftGates';
import type { CraftedSkill } from '../../schemas/learning';
import { loadProviderConfigs } from '../infrastructure/ProviderConfigService';
import { isProviderReady } from '../../utils/providerUtils';
import { TradeOutcome } from '../../types/enums';
import type { ProviderConfig } from '../../types/provider';
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

/** What this module needs to know about the acting bot. `modelId` lets a bot
 *  craft with the model it thinks with rather than the provider's default. */
export interface BotIdentity {
    id: string;
    name: string;
    providerId: string;
    modelId?: string;
}

/** The bot's own provider, bound to its own model — the same seat resolution
 *  the Chart AI dock uses, so a bot crafts with the model it thinks with. */
const configForBot = async (bot: BotIdentity): Promise<ProviderConfig | null> => {
    try {
        const configs = await loadProviderConfigs();
        const base = configs.find(c => c.id === bot.providerId && isProviderReady(c))
            ?? configs.find(c => c.id === bot.providerId && c.isEnabled);
        if (!base) return null;
        return bot.modelId ? { ...base, selectedModel: bot.modelId } : base;
    } catch {
        return null;
    }
};

/** Mirrors SkillMemoryService's internal cluster key: the closed-trade cluster
 *  a draft's evidence claim is measured against. */
const setupKey = (t: LoggedTrade): string => [
    (t.analysis?.coinName || 'GEN').toUpperCase().replace(/USDT?$/, ''),
    t.analysis?.direction === 'Long' || t.analysis?.direction === 'Short' ? t.analysis.direction : 'Neutral',
    t.analysis?.detectedPatternFamily || t.analysis?.marketConditions?.pattern || 'any',
].join('|');

/**
 * WS-3.2's craft leg: a bot's closed trade goes through the SAME draft chain
 * the chart AI's post-mortems do — craft a procedure from the post-mortem,
 * then the evidence-backed draft gate (tombstone, duplicate-draft and worth
 * checks, prediction required) — with THAT bot's own memory as the gate's
 * context, so the judgement is made against what this bot already believes.
 *
 * Returns the queued draft, or null when anything declined it: no ready
 * provider, a post-mortem too thin to craft from, a duplicate already pending,
 * or a gate refusal. Fail-safe by construction — the deterministic tier inside
 * the gate still queues offline, and a throw here never reaches the turn.
 */
export const craftAndGateBotTrade = async (
    bot: BotIdentity,
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string,
): Promise<CraftedSkill | null> => {
    try {
        const config = await configForBot(bot);
        if (!config) return null;
        const crafted = await craftSkillFromPostMortem(trade, config);
        if (!crafted) return null;
        const setup = {
            coin: trade.analysis?.coinName,
            direction: trade.analysis?.direction,
            family: trade.analysis?.detectedPatternFamily,
            regime: trade.marketRegime,
        };
        const cluster = allTrades.filter(t =>
            (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS)
            && setupKey(t) === setupKey(trade));
        const gate = await gateEvidenceBackedDraft({
            crafted,
            tradeId: trade.id,
            cluster: cluster.length > 0 ? cluster : [trade],
            username,
            config,
            allTrades,
            coin: trade.analysis?.coinName,
            direction: trade.analysis?.direction,
            family: trade.analysis?.detectedPatternFamily,
            // The acting bot's persona + notes, not the roster head's.
            botContext: getBotMemoryContext(bot.id, setup, 'global') || trade.postMortem || '',
        });
        return gate.action === 'queued' ? gate.crafted : null;
    } catch (e) {
        console.warn('[BotLearning] craft/gate failed (non-fatal):', e instanceof Error ? e.message : e);
        return null;
    }
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
    bot: BotIdentity,
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
            // The draft chain first (craft → worth gate → queue, where the
            // supervisor or the human approves it), then the evidence fold.
            await craftAndGateBotTrade(bot, trade, opts.trades, opts.username);
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

