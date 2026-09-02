/**
 * Bot Mailbox (plan botmode-scan G1) — teammate DMs, Hermes Bot Mode style.
 *
 * Hermes runs its bots as separate gateway processes and needs a socket
 * relay; august's bots are IN-PROCESS — same message array, same provider
 * configs — so the whole relay layer collapses to this file: a per-target
 * queue with TTL semantics plus the pure logic (roster validation,
 * attribution, the teammate protocol text, the DM marker grammar).
 *
 * The contract copied from Hermes (tools/bot_mode_dm.py):
 *   • DMs are TEXTING: validate the target against the live roster, prefix
 *     the sender's attribution server-side (never trust the model's own
 *     prefix), ack immediately, and the reply WAKES the sender later.
 *   • A busy target queues (Hermes: file lock + turn_wait); an envelope
 *     older than the TTL is refused at drain time, not delivered as a
 *     zombie (Hermes: envelope_ttl_seconds = 900).
 *   • Containment: the protocol section is injected ONLY into bot threads
 *     — never Team debates, never Coach, never post-mortems.
 *   • Loop guard: a DM chain carries a hop count; replies past the cap
 *     become notices instead of new turns (august addition — Hermes caps
 *     group rounds instead; a cap on either axis is mandatory).
 *
 * The transport is the message array itself: threads are DERIVED views
 * (threadForProvider), so appending a user-role DM + an AI reply attributed
 * to the target's (providerId, modelId) lands both in the target's thread
 * no matter which thread is open. Name-as-identity, no pointers — the same
 * invariant Hermes converged on after five incident waves.
 */

import type { AgentBot } from './agentRoster';
import type { Message } from '../../types';
import { MessageRole } from '../../types/enums';

/** Hermes parity: an envelope this old is refused at drain time. */
export const DM_ENVELOPE_TTL_MS = 15 * 60_000;
/** A DM chain deeper than this stops auto-running; the text becomes a
 *  plain notice in the target thread instead. */
export const DM_MAX_HOPS = 3;
/** Global anti-storm budget: DM turns per rolling window. */
export const DM_RATE_LIMIT = 12;
export const DM_RATE_WINDOW_MS = 60_000;

export interface DMMark {
    /** Raw handle as the model typed it (without @). */
    handle: string;
    text: string;
}

/** Collapse a display name to its mention handle: lowercase, alphanumerics
 *  only (Hermes matches name, title, and collapsed no-space forms). */
export const botHandle = (name: string): string =>
    name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Resolve a typed handle against the live roster. Case-insensitive;
 *  matches the exact handle, the no-space collapse, and the title. */
export const resolveRosterHandle = (bots: AgentBot[], handle: string): AgentBot | null => {
    const needle = handle.toLowerCase().replace(/^@/, '').trim();
    if (!needle) return null;
    const collapsed = needle.replace(/[\s_-]+/g, '');
    return bots.find(b =>
        botHandle(b.name) === needle
        || botHandle(b.name) === collapsed
        || (b.title ? botHandle(b.title) === collapsed : false),
    ) ?? null;
};

/**
 * Parse `[[dm:@handle]] text` markers out of a bot reply. Returns the
 * cleaned display text (markers stripped) and the marks in order. The
 * model composes the message; the harness owns delivery + attribution —
 * exactly the message_agent split.
 */
export const parseDmMarkers = (raw: string): { clean: string; marks: DMMark[] } => {
    const marks: DMMark[] = [];
    // Body = up to the next marker or the end of the line (the protocol:
    // one marker per line, at the end of the reply). A line-scoped body
    // means prose AFTER the marker stays in the bubble instead of being
    // swallowed into the DM.
    const re = /\[\[dm:@([^\]\s]+)\]\][ \t]*([^\n]*?)(?=\[\[dm:@|\n|$)/g;
    const clean = raw.replace(re, (_all, handle: string, text: string) => {
        const trimmed = text.trim();
        if (trimmed) marks.push({ handle, text: trimmed });
        return '';
    }).trimEnd();
    return { clean, marks };
};

/** The sender-attribution prefix, applied by the harness (never the model). */
export const dmEnvelopeText = (fromName: string, text: string): string =>
    `📩 ${fromName} (teammate DM): ${text}`;

/** The wake-up notice delivered into the SENDER's thread when the target
 *  replies — the completion-notification shape Hermes uses. */
export const dmReplyNoticeText = (targetName: string, reply: string): string =>
    `↩ ${targetName} replied to your DM: ${reply}`;

/**
 * The teammate protocol section (bot_mode_probe.py parity): injected ONLY
 * into bot-thread turns. Byte-stable for a given roster so prompt caching
 * survives; roster rendered as `- @handle — role` lines so every bot knows
 * WHO to message for which job.
 */
export const buildTeammateProtocolSection = (bots: AgentBot[], me: AgentBot): string => {
    const teammates = bots.filter(b => b.id !== me.id);
    const lines = teammates.map(b => {
        const role = [b.title, b.description].filter(Boolean).join(' — ');
        return `- @${botHandle(b.name)}${role ? ` — ${role}` : ''}`;
    });
    return [
        '## Messaging teammates',
        `You share this app with other analyst bots. To hand work to one of them, end your reply with a DM marker on its own line:`,
        `[[dm:@handle]] your message to them`,
        rulesFor(me, lines.join('\n')),
    ].join('\n');
};

const rulesFor = (me: AgentBot, rosterLines: string): string => [
    'Rules:',
    `- You are @${botHandle(me.name)}. Teammates currently reachable:`,
    rosterLines || '- (none — you are the only bot; do not emit DM markers)',
    '- DMs are fire-and-forget like texting: emit the marker, finish your reply, and the answer arrives later in YOUR thread as a "replied to your DM" notice. Never invent or predict a teammate\'s answer.',
    '- Only DM for work you genuinely need from them (a second opinion, a risk check, data you cannot compute). One DM per teammate per reply, at most two teammates.',
    '- If a teammate DMs YOU, answer it in your reply; add your own [[dm:@…]] marker only if the chain truly needs another hop.',
].join('\n');

/**
 * The persona system prompt for one bot's casual/DM turn (G1 also fixes a
 * pre-existing gap: bot threads used the generic assistant prompt).
 * Persona (system.md) + the bot's own notes (memory.md) + the teammate
 * protocol. Deterministic for stable inputs.
 */
export const buildBotSystemPrompt = (
    bot: AgentBot,
    opts: { persona?: string | null; notes?: string | null; teammates: AgentBot[] },
): string => {
    const parts: string[] = [];
    parts.push(
        opts.persona?.trim()
            || `You are ${bot.name}${bot.title ? `, ${bot.title}` : ''}. ${bot.description ?? ''}`.trim(),
    );
    if (opts.notes?.trim()) parts.push(`## Your private notes\n${opts.notes.trim()}`);
    parts.push(buildTeammateProtocolSection(opts.teammates, bot));
    return parts.join('\n\n');
};

// ─── The queue (pure state; the hook drives the async drain) ────────────────

export interface DMEnvelope {
    id: string;
    fromBotId: string;
    toBotId: string;
    text: string;
    hop: number;
    queuedAt: number;
}

export type RefuseReason = 'unknown_target' | 'self_dm' | 'no_provider' | 'expired' | 'rate_limited' | 'hop_cap' | 'malformed';

export const refuseText = (reason: RefuseReason, handle: string): string => {
    switch (reason) {
        case 'unknown_target': return `(undeliverable: @${handle} is not on the roster)`;
        case 'self_dm': return `(undeliverable: @${handle} is you — no self-DMs)`;
        case 'no_provider': return `(undeliverable: @${handle}'s provider is not configured)`;
        case 'expired': return `(undeliverable: the DM to @${handle} sat queued past its TTL and expired)`;
        case 'rate_limited': return `(undeliverable: DM budget exhausted for this minute)`;
        case 'hop_cap': return `(held: @${handle} — the DM chain reached its hop cap; answer without pinging back)`;
        case 'malformed': return `(undeliverable: the DM to @${handle} was empty)`;
    }
};

/** Ready = enabled + key + the bot's exact model on the list. */
export const botIsReachable = (
    bot: AgentBot,
    isReady: (providerId: string, modelId: string) => boolean,
): boolean => isReady(bot.providerId, bot.modelId);

/**
 * Validate an outgoing DM against the roster. Pure — the caller turns a
 * refusal into a notice in the sender's thread (fail VISIBLE, never
 * silently drop: a lost DM is the bug class Hermes's #93091 fixed).
 */
export const validateDM = (
    bots: AgentBot[],
    from: AgentBot,
    handle: string,
    text: string,
    hop: number,
    isReady: (providerId: string, modelId: string) => boolean,
): { ok: true; envelope: DMEnvelope } | { ok: false; reason: RefuseReason } => {
    const target = resolveRosterHandle(bots, handle);
    if (!target) return { ok: false, reason: 'unknown_target' };
    if (target.id === from.id) return { ok: false, reason: 'self_dm' };
    if (!botIsReachable(target, isReady)) return { ok: false, reason: 'no_provider' };
    if (hop >= DM_MAX_HOPS) return { ok: false, reason: 'hop_cap' };
    if (!text.trim()) return { ok: false, reason: 'malformed' };
    return {
        ok: true,
        envelope: {
            id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fromBotId: from.id,
            toBotId: target.id,
            text: text.trim(),
            hop,
            queuedAt: Date.now(),
        },
    };
};

/** A DM message row for the target thread (user-role: the thread derives
 *  it into place and the model treats it as an incoming turn). */
export const dmMessageRow = (text: string, id: string): Message => ({
    id,
    role: MessageRole.USER,
    text,
    createdAt: new Date().toISOString(),
    dmFrom: true,
});

/** A notice row for a thread (system-role, attributed so threadForProvider
 *  files it into the right bot's thread). */
export const dmNoticeRow = (text: string, providerId: string, modelId: string, id: string): Message => ({
    id,
    role: MessageRole.SYSTEM,
    text,
    createdAt: new Date().toISOString(),
    modelsUsed: { [providerId]: modelId },
    dmNotice: true,
});
