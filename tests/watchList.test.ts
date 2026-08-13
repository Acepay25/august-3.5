import { describe, expect, it } from 'vitest';
import { Conversation, Message, MessageRole, TradeAnalysis, TradeOutcome } from '../types';
import { canWatchSignal, collectWatchedSignals, toggleWatchOnMessage } from '../utils/watchList';

const analysis = {
    direction: 'Long',
    confidence: 'High',
    entryPoints: [{ price: '1' }],
    stopLoss: '0.9',
} as TradeAnalysis;

const message = (overrides: Partial<Message> = {}): Message => ({
    id: 'm1',
    role: MessageRole.AI,
    text: 'setup',
    createdAt: '2026-08-13T00:00:00.000Z',
    analysis,
    outcome: TradeOutcome.PENDING,
    ...overrides,
});

const conversation = (messages: Message[], id = 'c1'): Conversation => ({
    id,
    timestamp: 1,
    title: 'BTC',
    messages,
    ocrModel: '',
    moderatorProviderId: '',
    moderatorModel: '',
    leverage: 10,
});

describe('watchList', () => {
    it('allows any trading signal with analysis, including Avoid', () => {
        expect(canWatchSignal(message({ analysis: { ...analysis, confidence: 'Avoid', direction: 'Neutral' } }))).toBe(true);
        expect(canWatchSignal(message())).toBe(true);
        expect(canWatchSignal(message({ analysis: undefined }))).toBe(false);
    });

    it('collects watched signals across conversations, newest first', () => {
        const older = message({ id: 'a', watched: true, watchedAt: '2026-08-01T00:00:00.000Z' });
        const newer = message({ id: 'b', watched: true, watchedAt: '2026-08-13T00:00:00.000Z' });
        const ignored = message({ id: 'c', watched: false });
        const list = collectWatchedSignals([
            conversation([older, ignored], 'c1'),
            conversation([newer], 'c2'),
        ]);
        expect(list.map(item => item.messageId)).toEqual(['b', 'a']);
        expect(list[0].conversationId).toBe('c2');
    });

    it('records watch-thread episodes without changing outcome', () => {
        const on = toggleWatchOnMessage(message(), true);
        expect(on.watched).toBe(true);
        expect(on.watchEpisodes?.at(-1)?.kind).toBe('watched');
        expect(on.outcome).toBe(TradeOutcome.PENDING);
        const off = toggleWatchOnMessage(on, false);
        expect(off.watched).toBe(false);
        expect(off.watchEpisodes?.at(-1)?.kind).toBe('unwatched');
    });
});
