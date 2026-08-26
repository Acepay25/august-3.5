import type { Conversation } from '../../types/trade';
import { MessageRole } from '../../types/enums';

/**
 * SessionSearch: unified FTS-style search over the user's
 * stored conversation history — one backend powering both:
 *  - the `recall_chat` desk tool (seats can search past debates mid-run), and
 *  - future UI search surfaces.
 *
 * Conversations persist on the UserProfile (`profile.conversations`), so the
 * search loads them via dbService and scores matches with a lightweight
 * term-frequency ranking (no index file needed at this scale).
 */

export interface ChatSearchHit {
    conversationId: string;
    conversationTitle: string;
    /** ISO date of the matched message. */
    at: string;
    speaker: string;
    /** Matched excerpt, trimmed to ~240 chars around the first hit. */
    excerpt: string;
    /** Simple relevance score: term hits × role weight × recency boost. */
    score: number;
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'was', 'for', 'on', 'it', 'at', 'as']);

const tokenize = (q: string): string[] =>
    q.toLowerCase().split(/[^a-z0-9%$.]+/).filter(t => t.length >= 3 && !STOP_WORDS.has(t));

const excerptAround = (text: string, lowerTerm: string): string => {
    const idx = text.toLowerCase().indexOf(lowerTerm);
    if (idx < 0) return text.slice(0, 240);
    const start = Math.max(0, idx - 100);
    const end = Math.min(text.length, idx + 140);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
};

/** Search every stored conversation's messages for a query. Returns top N. */
export const searchChatHistory = async (
    query: string,
    username?: string,
    limit = 5,
): Promise<ChatSearchHit[]> => {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const { getUserProfile } = await import('./dbService');
    const user = username
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('last_active_user') || undefined : undefined)
        || 'default';
    let conversations: Conversation[];
    try {
        const profile = await getUserProfile(user);
        conversations = profile?.conversations ?? [];
    } catch {
        return [];
    }

    const hits: ChatSearchHit[] = [];
    for (const conv of conversations) {
        for (const msg of conv.messages ?? []) {
            const text = typeof msg.text === 'string' ? msg.text : '';
            if (!text) continue;
            const lower = text.toLowerCase();
            let score = 0;
            for (const term of terms) {
                const occurrences = lower.split(term).length - 1;
                if (occurrences > 0) score += Math.min(occurrences, 4);
            }
            if (score === 0) continue;
            // Prefer AI/moderator analysis over short user prompts.
            const roleWeight = msg.role === MessageRole.USER ? 0.6 : 1;
            // Recency boost: newer conversations surface first on ties.
            const ageDays = Math.max(0, (Date.now() - conv.timestamp) / 86_400_000);
            const recency = Math.exp(-ageDays / 60);
            const matched = terms.find(t => lower.includes(t)) ?? terms[0];
            hits.push({
                conversationId: conv.id,
                conversationTitle: conv.title || 'Untitled session',
                at: msg.createdAt ?? new Date(conv.timestamp).toISOString(),
                speaker: String(msg.role ?? ''),
                excerpt: excerptAround(text, matched),
                score: score * roleWeight * (1 + recency),
            });
        }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
};

/** Compact digest block for the `recall_chat` desk tool (≤1600 chars like recall). */
export const formatChatHitsDigest = (hits: ChatSearchHit[]): string => {
    if (hits.length === 0) return 'No matching passages found in your past sessions.';
    const rows = hits.map(h =>
        `- [${h.conversationTitle} · ${h.at.slice(0, 10)} · ${h.speaker}] ${h.excerpt.replace(/\s+/g, ' ')}`,
    );
    let out = '';
    for (const row of rows) {
        if (out.length + row.length > 1600) break;
        out += `${row}\n`;
    }
    return out.trim() || 'No matching passages found in your past sessions.';
};
