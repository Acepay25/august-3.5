import { DebateTurn } from '../types';

/**
 * Addressed debate routing (ROUND-34): speakers end a turn with a
 * "REPLY-TO: name1, name2" line. Only the named seats (plus the sender's own
 * history) feed the next prompt — each model reads what was sent TO it, not
 * the whole floor. Absent marker (or "all") = floor-wide broadcast.
 */

const REPLY_TO_RE = /(^|\n)\s*REPLY-TO:\s*([^\n]+)\s*$/im;

export const parseReplyTo = (text: string): string[] | null => {
    const m = text.match(REPLY_TO_RE);
    if (!m) return null;
    const list = m[2]
        .split(/[,;]+/)
        .map(s => s.replace(/^@/, '').trim().toLowerCase())
        .filter(Boolean);
    if (list.length === 0 || list.includes('all') || list.includes('floor')) return null;
    return list;
};

/** Whether a turn's text is addressed to (readable by) the named seat. */
export const turnAddressedTo = (text: string, name: string): boolean => {
    const to = parseReplyTo(text);
    if (!to) return true;
    return to.includes(name.trim().toLowerCase());
};

/** Strip the routing marker from display text and persist it as `to`. */
export const applyReplyTo = <T extends { text: string }>(turn: T): T & Pick<DebateTurn, 'to'> => {
    const to = parseReplyTo(turn.text);
    if (!to) return turn;
    return { ...turn, text: turn.text.replace(REPLY_TO_RE, '').trimEnd(), to };
};
