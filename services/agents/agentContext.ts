/**
 * agentContext — the one place an agent's identity is assembled for a prompt.
 *
 * An agent is four things a surface needs together: the persona it argues as,
 * the notes it carries, and the model pair it thinks with. Until now each
 * surface picked some subset and composed it its own way — the Chart AI dock
 * took the persona and (as of today) the notes, `botLearning` took the notes
 * alone, the worth gate took the notes alone again, and each chose its own
 * byte allowance. That is how one named agent ends up knowing measurably
 * different things in two places while carrying the same name, which reads to
 * the trader as two different agents wearing one label.
 *
 * The lesson taken from hermes-agent's profile loader: make the resolution
 * target explicit rather than letting a surface fall back to whatever it
 * happens to have in scope. Their own regression test calls that whole failure
 * a bug class — a profile that loads from the ambient home instead of its own.
 */

import { getBotMemoryContext } from '../bots/BotMemoryService';
import {
    BOT_MEMORY_PER_AGENT_CHAR_BUDGET,
    BOT_MEMORY_TOTAL_CHAR_BUDGET,
} from '../bots/botMemoryBudget';
import { seatPersonaPrompt } from './seatPersonas';
import type { AgentBot } from './agentRoster';

/** Anything that identifies an agent well enough to answer as it: a full
 *  roster bot, or the narrow `BotIdentity` a background learner carries. Kept
 *  structural on purpose — requiring the avatar fields would push every caller
 *  back to assembling persona and notes by hand, which is the divergence this
 *  module exists to end. */
export type AgentLike = {
    id: string;
    name: string;
    providerId: string;
    modelId?: string;
    role?: AgentBot['role'];
    customPrompt?: string;
};

/** The setup an agent is being asked about — passed through to the note
 *  filter so a line about another coin does not ride in. */
export interface AgentSetupQuery {
    coin?: string;
    direction?: string;
    family?: string;
    regime?: string;
    /** Coins to treat as "another coin's lesson". Pass the trader's own
     *  journaled symbols; the reader's baseline list alone is a floor. */
    knownCoins?: string[];
}

export interface ResolvedAgentContext {
    botId: string;
    /** The roster name. Rows are claimed by THIS, never by the model slug. */
    name: string;
    persona: string;
    notes: string;
    providerId: string;
    modelId?: string;
}

/**
 * `budgetChars` defaults to the conservative per-agent share, because the
 * caller is the only one who knows whether this agent is speaking alone or as
 * one of a merged roster. A surface answering AS one agent passes
 * `SINGLE_AGENT_MEMORY_BUDGET`.
 */
export const resolveAgentContext = (
    bot: AgentLike,
    setup?: AgentSetupQuery,
    budgetChars: number = BOT_MEMORY_PER_AGENT_CHAR_BUDGET,
): ResolvedAgentContext => ({
    botId: bot.id,
    name: bot.name,
    persona: seatPersonaPrompt(bot),
    notes: getBotMemoryContext(bot.id, setup, budgetChars),
    providerId: bot.providerId,
    modelId: bot.modelId,
});

/** What ONE agent gets when nothing else is competing for the allowance. Named
 *  so a new surface does not invent a fifth budget number; a roster merge
 *  divides the same total instead. */
export const SINGLE_AGENT_MEMORY_BUDGET = BOT_MEMORY_TOTAL_CHAR_BUDGET;

/** The transcript label for a row this agent answered with. Kept next to the
 *  resolver so the identity stamped on a row and the identity the row was
 *  answered as cannot drift apart. */
export const agentRowLabel = (ctx: ResolvedAgentContext): string => ctx.name;
