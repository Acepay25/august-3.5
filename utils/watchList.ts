import { Conversation, Message, TradeAnalysis, TradeOutcome, DebateTurn, WatchEpisode } from '../types';

export interface WatchedSignal {
    messageId: string;
    conversationId: string;
    conversationTitle: string;
    analysis: TradeAnalysis;
    outcome?: TradeOutcome;
    watchedAt: string;
    createdAt: string;
    debateTurns?: DebateTurn[];
    watchEpisodes?: WatchEpisode[];
}

export const canWatchSignal = (message: Pick<Message, 'analysis'>): boolean => Boolean(message.analysis);

export const collectWatchedSignals = (conversations: Conversation[]): WatchedSignal[] => {
    const byId = new Map<string, WatchedSignal>();
    for (const conversation of conversations) {
        for (const message of conversation.messages) {
            if (!message.watched || !message.analysis) continue;
            byId.set(message.id, {
                messageId: message.id,
                conversationId: conversation.id,
                conversationTitle: conversation.title || 'Untitled chat',
                analysis: message.analysis,
                outcome: message.outcome,
                watchedAt: message.watchedAt || message.createdAt,
                createdAt: message.createdAt,
                debateTurns: message.debateTurns,
                watchEpisodes: message.watchEpisodes,
            });
        }
    }
    return [...byId.values()].sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt));
};

export const appendWatchEpisode = (message: Message, kind: WatchEpisode['kind'], detail: string): Message => {
    const episode: WatchEpisode = { at: new Date().toISOString(), kind, detail };
    return { ...message, watchEpisodes: [...(message.watchEpisodes || []), episode].slice(-20) };
};

export const toggleWatchOnMessage = (message: Message, watch: boolean): Message => {
    if (!watch) {
        return appendWatchEpisode({ ...message, watched: false, watchedAt: undefined }, 'unwatched', 'Removed from Watch list');
    }
    if (!canWatchSignal(message)) return message;
    const pinned = {
        ...message,
        watched: true,
        watchedAt: message.watchedAt || new Date().toISOString(),
    };
    return appendWatchEpisode(pinned, 'watched', 'Pinned to Watch list');
};
