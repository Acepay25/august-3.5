import { DeskToolDefinition } from './DeskToolsService';

/**
 * Debate mailbox: inter-seat DIRECT MESSAGING over real tool
 * calls. A seat ends (or accompanies) its turn by calling `send_message`
 * with the target seat and the note; the note lands in exactly that seat's
 * inbox. The recipient learns about unread mail deterministically — the
 * ORCHESTRATOR knows which seats have unread messages when it builds their
 * next prompt, so it injects an inbox notice telling them to call
 * `read_message` first. Models never poll blindly.
 *
 * Delivery semantics mirror the text-era REPLY-TO routing: a sent message
 * becomes a routed reply (the sender's public turn carries a synthesized
 * "REPLY-TO:" line), so transcript building, addressing filters, and the
 * tool-style reply rows in the side panel all keep working unchanged.
 */

export interface DebateMessage {
    /** Sending seat's display name ('Moderator' included). */
    from: string;
    /** Recipient seat's display name (lowercased key). */
    toKey: string;
    /** Recipient display name as addressed. */
    toLabel: string;
    text: string;
    /** Debate round the message was sent in. */
    round: number;
}

export interface DebateMailbox {
    /** Deliver a message. Returns a model-visible receipt (error text on a
     *  bad call — unknown recipient or empty message). */
    send: (from: string, round: number, args: { to?: unknown; message?: unknown }) => string;
    /** Drain a seat's inbox — marks everything read, returns the display block. */
    read: (name: string) => string;
    /** Unread count for a seat. */
    unreadCount: (name: string) => number;
    /** One-line summary for prompts ("2 unread from Macro Analyst"). */
    unreadSummary: (name: string) => string;
    /** Deterministic prompt injection when the seat has unread mail ('' otherwise). */
    inboxNotice: (name: string) => string;
    /** Distinct recipients this seat successfully messaged in a round. */
    recipientsFor: (name: string, round: number) => string[];
    /** Every message ever sent (for DM visibility lines in the transcript). */
    all: () => DebateMessage[];
}

export const createDebateMailbox = (rosterNames: string[]): DebateMailbox => {
    const aliases = rosterNames.map(n => ({ label: n, key: n.trim().toLowerCase() })).filter(a => a.key);
    // Inbox keyed by recipient lowercased name.
    const inbox = new Map<string, DebateMessage[]>();
    // All deliveries, in arrival order (for DM lines + recipient lookup).
    const sent: DebateMessage[] = [];

    const resolveTarget = (raw: unknown): { label: string; key: string } | null => {
        const needle = String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
        if (!needle) return null;
        return aliases.find(a => a.key === needle) ?? null;
    };

    return {
        send: (from, round, args) => {
            const text = String(args.message ?? '').trim();
            const target = resolveTarget(args.to);
            if (!target || !text) {
                return `send_message failed: address the message to exactly ONE seat (${rosterNames.join(', ')}) and include non-empty text.`;
            }
            const msg: DebateMessage = { from, toKey: target.key, toLabel: target.label, text, round };
            const box = inbox.get(target.key) ?? [];
            box.push(msg);
            inbox.set(target.key, box);
            sent.push(msg);
            return `Delivered to ${target.label}. They will receive it before their next turn.`;
        },
        read: name => {
            const key = name.trim().toLowerCase();
            const box = inbox.get(key) ?? [];
            inbox.set(key, []);
            if (box.length === 0) return 'Inbox empty — no direct messages.';
            return box
                .map(m => `From ${m.from} (Round ${m.round}):\n${m.text}`)
                .join('\n\n---\n\n');
        },
        unreadCount: name => (inbox.get(name.trim().toLowerCase()) ?? []).length,
        unreadSummary: name => {
            const box = inbox.get(name.trim().toLowerCase()) ?? [];
            if (box.length === 0) return '';
            const bySender = new Map<string, number>();
            for (const m of box) bySender.set(m.from, (bySender.get(m.from) ?? 0) + 1);
            return [...bySender.entries()].map(([f, n]) => `${n} from ${f}`).join(', ');
        },
        inboxNotice: name => {
            const summary = (() => {
                const box = inbox.get(name.trim().toLowerCase()) ?? [];
                if (box.length === 0) return '';
                const bySender = new Map<string, number>();
                for (const m of box) bySender.set(m.from, (bySender.get(m.from) ?? 0) + 1);
                return [...bySender.entries()].map(([f, n]) => `${n} from ${f}`).join(', ');
            })();
            if (!summary) return '';
            return (
                `**DIRECT MESSAGES WAITING:** you have ${summary}. Call the read_message tool FIRST ` +
                'to open them, then factor them into your turn. If a message argues something you dispute, ' +
                'address it in your public reply.'
            );
        },
        recipientsFor: (name, round) => [
            ...new Set(sent.filter(m => m.from === name && m.round === round).map(m => m.toLabel)),
        ],
        all: () => [...sent],
    };
};

/** The two floor-messaging tool definitions (OpenAI function schema). */
export const DEBATE_MAIL_TOOLS: DeskToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'send_message',
            description:
                'Send a DIRECT MESSAGE to exactly one other debate seat (another analyst or the Moderator). ' +
                'Use to answer a specific argument without broadcasting, to ask a rival to reconsider a level, ' +
                'or to privately concede. The recipient is told they have unread mail and will read it before their next turn. ' +
                'Your public Floor turn is separate — send_message does not replace it.',
            parameters: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Recipient seat name exactly as shown, e.g. "Risk Analyst" or "Moderator".' },
                    message: { type: 'string', description: 'The note — concrete and level-specific, 1-4 sentences.' },
                },
                required: ['to', 'message'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_message',
            description:
                'Read your direct-message inbox — notes other seats addressed to you. Call this BEFORE speaking when ' +
                'you have been told you have unread messages.',
            parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
        },
    },
];

/** Names recognized by send_message validation (for prompts + errors). */
export const mailboxRosterHint = (rosterNames: string[]): string =>
    `Direct messages go ONLY to: ${rosterNames.join(', ')}.`;

/**
 * Synthesize the REPLY-TO routing line for a turn whose messages were sent
 * via tool calls — downstream parsing (applyReplyTo), addressing filters,
 * and the side-panel tool-style reply rows all key off this marker.
 * Returns '' when nothing was sent or the text already routes explicitly.
 */
export const synthesizeReplyToLine = (
    turnText: string,
    recipients: string[],
): string => {
    if (recipients.length === 0) return '';
    if (/(^|\n)\s*REPLY-TO:/i.test(turnText)) return ''; // explicit routing wins
    return `\n\nREPLY-TO: ${[...new Set(recipients)].join(', ')}\n`;
};

/** Compact transcript line for a delivered DM (visibility in the thread). */
export const formatDmEventLine = (m: DebateMessage): string => {
    const snippet = m.text.length > 220 ? `${m.text.slice(0, 220).trimEnd()}…` : m.text;
    return `${m.from} → ${m.toLabel} (direct message): "${snippet}"`;
};
