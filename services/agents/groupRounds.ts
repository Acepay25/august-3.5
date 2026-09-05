/**
 * Group room rounds (plan botmode-scan G2) — the pure half of Hermes
 * group-rounds semantics: bounded round-robin where the NEXT speakers are
 * chosen by a deterministic @mention parse (no LLM router), "(pass)" is a
 * first-class outcome, an all-pass round settles the room, and each turn
 * is fed only the room messages it hasn't seen yet (what makes
 * multi-round cheap).
 */

import type { AgentBot } from './agentRoster';
import { botHandle, resolveRosterHandle } from './botMailbox';
import { seatHasPersona, seatPersonaPrompt } from './seatPersonas';

/** Max rounds per send (Hermes group-rounds parity). */
export const ROOM_ROUND_CAP = 3;
/** Max model turns per send — the storm budget. */
export const ROOM_TURN_CAP = 12;

/** One thing said in the room (user prompt or a member's reply). The
 *  human's speaker label is 'Trader' — never 'You', because renderRoomTurn
 *  reserves 'You' for the CURRENT speaker's own lines (a collision here
 *  would make the model think the human's prompt was its own speech). */
export const ROOM_HUMAN_LABEL = 'Trader';
export interface RoomEntry {
    speaker: string;
    text: string;
}

/** Silence token: replying exactly this means "nothing to add". */
export const PASS_TOKEN = '(pass)';

export const isPassReply = (text: string): boolean => {
    const t = text.trim().toLowerCase();
    return t === '' || t === PASS_TOKEN;
};

/** True while accumulated stream text could still turn into a pure pass —
 *  the bubble stays un-appended until we know the member actually spoke. */
export const couldStillBePass = (accumulated: string): boolean =>
    PASS_TOKEN.startsWith(accumulated.trim().toLowerCase());

/**
 * Deterministic mention parse: every @token resolved against the member
 * roster (exact handle, no-space collapse, title — same rules as DM
 * handles). @everyone addresses all members. Returns unique bots in first
 * mention order; a bot not in the room is ignored (no ghost routing).
 */
export const parseRoomMentions = (text: string, members: AgentBot[]): AgentBot[] => {
    if (/@everyone\b/i.test(text)) return [...members];
    const out: AgentBot[] = [];
    const seen = new Set<string>();
    const re = /@([a-z0-9][a-z0-9_-]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const bot = resolveRosterHandle(members, m[1]);
        if (bot && !seen.has(bot.id)) {
            seen.add(bot.id);
            out.push(bot);
        }
    }
    return out;
};

/**
 * The room protocol section — replaces the 1:1 teammate-DM protocol for
 * group turns (byte-stable for a given member set so caching survives).
 * DM markers are explicitly OFF here: the room routes by @mention.
 */
export const buildRoomProtocolSection = (bot: AgentBot, members: AgentBot[]): string => {
    const others = members.filter(b => b.id !== bot.id);
    const lines = others.map(b => `- @${botHandle(b.name)} (${b.name})${b.title ? ` — ${b.title}` : ''}`);
    return [
        '## Group room',
        `You are ${bot.name} (@${botHandle(bot.name)}) in a room with:`,
        lines.length ? lines.join('\n') : '- (no one else — just answer)',
        '- Speak only when you have something to add. If not, reply with exactly (pass) — silence is a valid, useful answer.',
        '- To hand work to a teammate, @mention them in your reply; they speak in the next round.',
        '- Never use [[dm:@…]] markers here — @mentions are how this room routes.',
        '- Keep it short: this is a trading-room chat, not a report.',
    ].join('\n');
};

/** Persona (system.md) + debate role (seatPersonaPrompt) + notes + room
 *  protocol. A bot with a role or trader instructions carries that persona
 *  into every room turn (Group Settings edits it); an unroled bot keeps the
 *  plain identity line — the room protocol, not the general-analyst desk
 *  mandate, is its default voice. */
export const buildRoomSystemPrompt = (
    bot: AgentBot,
    opts: { persona?: string | null; notes?: string | null; members: AgentBot[] },
): string => {
    const parts: string[] = [];
    parts.push(
        opts.persona?.trim()
            || `You are ${bot.name}${bot.title ? `, ${bot.title}` : ''}. ${bot.description ?? ''}`.trim(),
    );
    if (seatHasPersona(bot)) parts.push(`## Your role\n${seatPersonaPrompt(bot)}`);
    if (opts.notes?.trim()) parts.push(`## Your private notes\n${opts.notes.trim()}`);
    parts.push(buildRoomProtocolSection(bot, opts.members));
    return parts.join('\n\n');
};

/**
 * Render a member's turn: only the room entries newer than what they last
 * saw. Their own lines render as "You" so the model keeps perspective.
 */
export const renderRoomTurn = (botName: string, unseen: RoomEntry[]): string => {
    const lines = unseen.map(e => `${e.speaker === botName ? 'You' : e.speaker}: ${e.text}`);
    return `Messages in the room since you last spoke:\n${lines.join('\n')}\n\nYour turn, ${botName}:`;
};
