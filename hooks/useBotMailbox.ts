/**
 * useBotMailbox (plan botmode-scan G1) — the async half of teammate DMs.
 *
 * Pure logic (validation, protocol text, marker grammar) lives in
 * services/agents/botMailbox.ts. This hook owns the per-target queues and
 * drains them: deliver a DM → run the target bot's turn (persona + notes +
 * teammate protocol over its own thread history) → parse its reply for
 * [[dm:@…]] markers → deliver the next hop or wake the sender with a
 * "replied to your DM" notice. Serial per target (Hermes's per-profile
 * lock), TTL at drain time, global rate budget, hop cap.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { AgentBot } from '../services/agents/agentRoster';
import type { ProviderConfig } from '../types/provider';
import type { Message } from '../types';
import { MessageRole } from '../types/enums';
import { streamQuickResponse } from '../services/providers/GenericAnalysisService';
import {
    readBotSystemMarkdown,
    readBotMemoryMarkdown,
} from '../services/bots/BotMemoryService';
import { threadForProvider } from '../utils/agentThreads';
import {
    DM_ENVELOPE_TTL_MS,
    DM_RATE_LIMIT,
    DM_RATE_WINDOW_MS,
    buildBotSystemPrompt,
    dmEnvelopeText,
    dmMessageRow,
    dmNoticeRow,
    dmReplyNoticeText,
    parseDmMarkers,
    refuseText,
    validateDM,
    type DMEnvelope,
} from '../services/agents/botMailbox';

export interface UseBotMailboxArgs {
    bots: AgentBot[];
    providerConfigs: ProviderConfig[];
    username: string | null;
    messagesRef: React.MutableRefObject<Message[]>;
    appendMessage: (msg: Message) => void;
    patchMessage: (id: string, patch: Partial<Message>) => void;
}

export interface UseBotMailboxResult {
    /** DMs completed since boot — bump the roster rail's Coach-style badge. */
    dmActivityCount: number;
    /** True while any queue is draining (rail "working" affordance). */
    dmBusy: boolean;
    /** Bot ids whose queue is draining right now (rail working-pulse). */
    dmBusyBotIds: string[];
    /** Deliver an envelope into the target's queue and drain it. */
    deliverDM: (envelope: DMEnvelope, fromBot: AgentBot) => void;
    /** Scan a finished bot reply for DM markers: strips them from the
     *  bubble, delivers/queues valid ones, posts refusals as notices.
     *  Returns true when markers were present. */
    dispatchFromBotReply: (bot: AgentBot, messageId: string, rawText: string, hop: number) => boolean;
    /** A user-initiated turn in a bot's 1:1 thread: persona + notes +
     *  teammate protocol, reply dispatched for DM markers. Returns false
     *  when the bot's provider is not ready (caller falls back). */
    runUserBotTurn: (bot: AgentBot, prompt: string) => Promise<boolean>;
}

const isProviderReadyFor = (configs: ProviderConfig[], providerId: string, modelId: string): boolean => {
    const p = configs.find(c => c.id === providerId);
    return !!p && p.isEnabled && p.apiKey.trim().length > 0 && p.models.includes(modelId);
};

export const useBotMailbox = ({
    bots, providerConfigs, username, messagesRef, appendMessage, patchMessage,
}: UseBotMailboxArgs): UseBotMailboxResult => {
    // Per-target serial queues (Hermes's per-profile lock, in-memory).
    const queues = useRef<Map<string, DMEnvelope[]>>(new Map());
    const busy = useRef<Set<string>>(new Set());
    const rate = useRef<number[]>([]);
    const processed = useRef<Set<string>>(new Set());
    const [dmActivityCount, setDmActivityCount] = useState(0);
    const [dmBusy, setDmBusy] = useState(false);
    // Which bots are draining a queue right now (rail working-pulse).
    const [busyIds, setBusyIds] = useState<string[]>([]);
    const syncBusy = useCallback(() => {
        const ids = [...busy.current];
        setBusyIds(ids);
        setDmBusy(ids.length > 0);
    }, []);

    const botsRef = useRef(bots);
    botsRef.current = bots;
    const configsRef = useRef(providerConfigs);
    configsRef.current = providerConfigs;

    const botById = useCallback((id: string): AgentBot | null =>
        botsRef.current.find(b => b.id === id) ?? null, []);

    const notice = useCallback((bot: AgentBot, text: string): void => {
        appendMessage(dmNoticeRow(text, bot.providerId, bot.modelId, `dmn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`));
    }, [appendMessage]);

    const runBotTurn = useCallback(async (bot: AgentBot, prompt: string, opts: {
        /** The DM that triggered this turn (undefined = user-initiated). */
        triggeredBy?: { envelope: DMEnvelope; from: AgentBot };
    }): Promise<void> => {
        const configs = configsRef.current;
        const provider = configs.find(c => c.id === bot.providerId && c.isEnabled && c.apiKey.trim().length > 0 && c.models.includes(bot.modelId));
        if (!provider) {
            if (opts.triggeredBy) notice(opts.triggeredBy.from, refuseText('no_provider', bot.name));
            return;
        }
        const persona = username ? readBotSystemMarkdown(bot.id) : null;
        const notes = username ? readBotMemoryMarkdown(bot.id) : null;
        const system = buildBotSystemPrompt(bot, { persona, notes, teammates: botsRef.current });
        const history = threadForProvider(messagesRef.current, bot.providerId, bot.modelId);

        const replyId = `dmr-${Date.now()}-${bot.id}`;
        // The incoming DM itself must be VISIBLE in the target's thread
        // (the texting metaphor): a user-role dmFrom row that the reply
        // below claims via threadForProvider's pending-user rule.
        if (opts.triggeredBy) {
            appendMessage(dmMessageRow(
                dmEnvelopeText(opts.triggeredBy.from.name, opts.triggeredBy.envelope.text),
                `dmr-in-${opts.triggeredBy.envelope.id}`,
            ));
        }
        appendMessage({
            id: replyId,
            role: MessageRole.AI,
            text: '',
            createdAt: new Date().toISOString(),
            modelsUsed: { [bot.providerId]: bot.modelId },
            isStreaming: true,
        });
        try {
            const raw = await streamQuickResponse(
                { ...provider, selectedModel: bot.modelId },
                prompt,
                history,
                system,
            );
            // The bubble must carry the reply (markers included for now —
            // dispatch strips them when present). Without this the DM
            // answer renders as an empty row.
            patchMessage(replyId, { text: raw, isStreaming: false });
            // Chain depth: a DM-triggered turn's own DMs are one hop deeper
            // than the envelope that woke it.
            const nextHop = opts.triggeredBy ? opts.triggeredBy.envelope.hop + 1 : 0;
            dispatchRef.current(bot, replyId, raw, nextHop);
            if (opts.triggeredBy) {
                // The reply IS the answer to the DM — wake the sender with a
                // notice in THEIR thread (never auto-run the sender: that is
                // the storm the hop cap exists to bound).
                appendMessage(dmNoticeRow(
                    dmReplyNoticeText(bot.name, raw.trim()),
                    opts.triggeredBy.from.providerId, opts.triggeredBy.from.modelId,
                    `dmw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                ));
                setDmActivityCount(n => n + 1);
            }
        } catch (error) {
            // Surface the transport's user-safe reason (toFriendlyProviderError)
            // — a bare "provider error" hid WHY every DM turn was dying.
            const rawReason = error instanceof Error ? error.message.trim() : '';
            const reason = rawReason
                ? /[.!?]$/.test(rawReason) ? rawReason.slice(0, 160) : `${rawReason.slice(0, 160)}.`
                : 'provider error';
            patchMessage(replyId, {
                text: `(${bot.name} could not process the DM — ${reason})`,
                isStreaming: false,
            });
        }
    }, [appendMessage, patchMessage, messagesRef, notice, username]);

    const drain = useCallback(async (botId: string): Promise<void> => {
        if (busy.current.has(botId)) return; // serial per target
        const q = queues.current.get(botId);
        if (!q || q.length === 0) return;
        busy.current.add(botId);
        syncBusy();
        try {
            while (q.length > 0) {
                const env = q.shift()!;
                const target = botById(env.toBotId);
                const from = botById(env.fromBotId);
                if (!target) continue;
                if (Date.now() - env.queuedAt > DM_ENVELOPE_TTL_MS) {
                    if (from) notice(from, refuseText('expired', target.name));
                    continue;
                }
                rate.current = rate.current.filter(t => Date.now() - t < DM_RATE_WINDOW_MS);
                if (rate.current.length >= DM_RATE_LIMIT) {
                    if (from) notice(from, refuseText('rate_limited', target.name));
                    continue;
                }
                rate.current.push(Date.now());
                await runBotTurn(target, dmEnvelopeText(from?.name ?? 'a teammate', env.text), {
                    triggeredBy: from ? { envelope: env, from } : undefined,
                });
            }
        } finally {
            busy.current.delete(botId);
            syncBusy();
        }
    }, [botById, notice, runBotTurn, syncBusy]);

    const deliverDM = useCallback((env: DMEnvelope, fromBot: AgentBot): void => {
        const q = queues.current.get(env.toBotId) ?? [];
        q.push(env);
        queues.current.set(env.toBotId, q);
        void drain(env.toBotId);
        void fromBot; // attribution already rides the envelope text
    }, [drain]);

    const runUserBotTurn = useCallback(async (bot: AgentBot, prompt: string): Promise<boolean> => {
        if (!isProviderReadyFor(configsRef.current, bot.providerId, bot.modelId)) return false;
        await runBotTurn(bot, prompt, {});
        return true;
    }, [runBotTurn]);

    // dispatchFromBotReply needs deliverDM, and runBotTurn (via drain) needs
    // dispatch — break the cycle with a ref assigned after both exist.
    const dispatchRef = useRef<(bot: AgentBot, messageId: string, rawText: string, hop: number) => boolean>(
        () => false,
    );

    const dispatchFromBotReply = useCallback((bot: AgentBot, messageId: string, rawText: string, hop: number): boolean => {
        if (processed.current.has(messageId)) return false;
        const { clean, marks } = parseDmMarkers(rawText);
        if (marks.length === 0) return false;
        processed.current.add(messageId);
        patchMessage(messageId, { text: clean });
        for (const mark of marks) {
            const v = validateDM(botsRef.current, bot, mark.handle, mark.text, hop,
                (pid, mid) => isProviderReadyFor(configsRef.current, pid, mid));
            if (v.ok) {
                deliverDM(v.envelope, bot);
            } else {
                notice(bot, refuseText(v.reason, mark.handle));
            }
        }
        return true;
    }, [patchMessage, deliverDM, notice]);
    dispatchRef.current = dispatchFromBotReply;

    return useMemo(
        () => ({ dmActivityCount, dmBusy, dmBusyBotIds: busyIds, deliverDM, dispatchFromBotReply, runUserBotTurn }),
        [dmActivityCount, dmBusy, busyIds, deliverDM, dispatchFromBotReply, runUserBotTurn],
    );
};

export default useBotMailbox;
