/**
 * botRoutine (plan botmode-scan G5) — the bot-scoped Routines half.
 *
 * A bot-scoped automation run is NOT the ensemble debate pipeline: the run
 * executes AS the bot, exactly like its G1 DM turns — persona system.md +
 * notes memory.md + teammate protocol (buildBotSystemPrompt), the bot's
 * own provider/model, casual-chat transport (streamQuickResponse), and the
 * reply persisted as an AI message attributed to the bot's identity pair so
 * threadForProvider files it into the bot's 1:1 thread. Everything here is
 * pure or injectable — the useAutomations hook only wires storage + toast.
 *
 * Fire-time invariants (same doctrine as validateDM): a configured bot that
 * has left the roster or lost its provider is a VISIBLE skip with the
 * reason stored on the run — never a silent no-show. DM markers in a
 * routine reply are stripped from the persisted text and delivered as
 * teammate DMs so a scheduled bot can hand work to a teammate, bounded by
 * the same hop ceiling as any other turn (a routine sits one hop below a
 * direct DM turn).
 */

import type { AgentBot } from './agentRoster';
import type { AutomationConfig, AutomationRun } from '../../types/automation';
import type { ProviderConfig } from '../../types/provider';
import type { Message } from '../../types';
import { MessageRole } from '../../types/enums';
import { threadForProvider } from '../../utils/agentThreads';
import {
    DM_MAX_HOPS,
    buildBotSystemPrompt,
    parseDmMarkers,
    validateDM,
    type DMEnvelope,
} from './botMailbox';

export type BotRoutineOutcome =
    | { status: 'complete'; systemPrompt: string; providerUsed: ProviderConfig; bot: AgentBot; reply: string; dmEnvelopes: DMEnvelope[] }
    | { status: 'skipped'; skipReason: string };

export interface BotRoutineTurnDeps {
    bots: AgentBot[];
    providerConfigs: ProviderConfig[];
    /** The full message array — history is the bot's own derived thread. */
    messages: Message[];
    persona: string | null;
    notes: string | null;
    /** Injected transport (production passes streamQuickResponse). */
    stream: (config: ProviderConfig, prompt: string, history: Message[], system: string) => Promise<string>;
}

/** A teammate's reply is one hop below the routine (DM_MAX_HOPS still bounds the chain). */
export const BOT_ROUTINE_HOP = DM_MAX_HOPS - 1;

/** The ready provider a bot thinks with, or null (G1's readiness rule). */
export const botRoutineProvider = (
    bots: AgentBot[],
    providerConfigs: ProviderConfig[],
    botId: string,
): { bot: AgentBot; provider: ProviderConfig } | null => {
    const bot = bots.find(b => b.id === botId);
    if (!bot) return null;
    const provider = providerConfigs.find(
        c => c.id === bot.providerId && c.isEnabled && c.apiKey.trim().length > 0 && c.models.includes(bot.modelId),
    );
    return provider ? { bot, provider } : null;
};

/**
 * Run one bot-scoped turn with the G1 persona machinery. Pure besides the
 * injected transport. The caller persists the reply and hands any DM
 * envelopes to the mailbox.
 */
export const runBotRoutineTurn = async (
    botId: string,
    prompt: string,
    deps: BotRoutineTurnDeps,
): Promise<BotRoutineOutcome> => {
    const resolved = botRoutineProvider(deps.bots, deps.providerConfigs, botId);
    if (!resolved) {
        const gone = deps.bots.find(b => b.id === botId);
        return gone
            ? { status: 'skipped', skipReason: `${gone.name}'s provider is not configured (missing, disabled, or the model is off the list).` }
            : { status: 'skipped', skipReason: 'The bot this routine runs as is no longer on the roster.' };
    }
    const { bot, provider } = resolved;

    const system = buildBotSystemPrompt(bot, {
        persona: deps.persona,
        notes: deps.notes,
        teammates: deps.bots,
    });
    const history = threadForProvider(deps.messages, bot.providerId, bot.modelId);
    const reply = (await deps.stream(provider, prompt, history, system)).trim();

    // The model composes; the harness owns delivery + attribution: strip
    // markers from the persisted text, deliver the rest as envelopes.
    const { clean, marks } = parseDmMarkers(reply);
    const dmEnvelopes: DMEnvelope[] = [];
    for (const mark of marks) {
        const v = validateDM(deps.bots, bot, mark.handle, mark.text, BOT_ROUTINE_HOP,
            (pid, mid) => !!deps.providerConfigs.find(
                c => c.id === pid && c.isEnabled && c.apiKey.trim().length > 0 && c.models.includes(mid),
            ));
        if (v.ok) dmEnvelopes.push(v.envelope);
    }

    return { status: 'complete', systemPrompt: system, providerUsed: provider, bot, reply: clean || '(no reply)', dmEnvelopes };
};

/** Resolve a routine's bot (null when the id dangles or none is set). */
export const routineBot = (bots: AgentBot[], config: AutomationConfig): AgentBot | null =>
    config.botId ? bots.find(b => b.id === config.botId) ?? null : null;

/** Fire-time skip reason for a bot-scoped routine, or null when runnable. */
export const botRoutineSkipReason = (
    bots: AgentBot[],
    config: AutomationConfig,
    providerConfigs: ProviderConfig[],
): string | null => {
    if (!botRoutineProvider(bots, providerConfigs, config.botId ?? '')) {
        const gone = routineBot(bots, config);
        return gone
            ? `${gone.name}'s provider is not configured (missing, disabled, or the model is off the list).`
            : 'The bot this routine runs as is no longer on the roster.';
    }
    return null;
};

/** The persisted AI message row for a completed bot run — attributed to the
 *  bot's identity pair so the reply lands in the bot's own thread. */
export const botRoutineMessageRow = (bot: AgentBot, reply: string, id: string): Message => ({
    id,
    role: MessageRole.AI,
    text: reply,
    createdAt: new Date().toISOString(),
    modelsUsed: { [bot.providerId]: bot.modelId },
});

/** The stored AutomationRun for a completed bot run (no analysis card —
 *  the feed renders the reply text; outcome buttons need an analysis). */
export const botRoutineRunRow = (
    config: AutomationConfig,
    prompt: string,
    runId: string,
    startedAt: string,
    row: Message,
): AutomationRun => ({
    id: runId,
    automationId: config.id,
    status: 'complete',
    startedAt,
    finishedAt: new Date().toISOString(),
    userMessage: {
        id: `u-${runId}`,
        role: MessageRole.USER,
        text: prompt,
        createdAt: row.createdAt,
    },
    message: row,
});
