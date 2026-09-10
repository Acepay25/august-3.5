import { describe, it, expect } from 'vitest';
import { buildTradeChatContext, TRADE_CHAT_SYSTEM_PROMPT } from '../services/trade/tradeChatContext';

describe('buildTradeChatContext (the model sees the chart)', () => {
    it('labels the packet with symbol, interval, and an exact UTC fetch time', () => {
        const ctx = buildTradeChatContext({
            symbol: 'BTCUSDT',
            interval: '15m',
            packetMarkdown: '## Hybrid market packet\nPrice 100,500',
            fetchedAtMs: Date.parse('2026-09-10T04:05:06.000Z'),
        });
        expect(ctx).toContain('LIVE CHART CONTEXT');
        expect(ctx).toContain('BTCUSDT · 15m');
        expect(ctx).toContain('2026-09-10 04:05:06');
        expect(ctx).toContain('Price 100,500');
        // The anti-invention instruction rides with every packet.
        expect(ctx).toContain('never invent a number');
        expect(ctx).toContain('get_order_book');
    });

    it('a failed packet fetch degrades to an explicit unavailable note', () => {
        const ctx = buildTradeChatContext({ symbol: 'ETHUSDT', interval: '1h', packetMarkdown: '   ', fetchedAtMs: Date.now() });
        expect(ctx).toContain('packet unavailable');
        expect(ctx).toContain('instead of guessing');
    });

    it('the system prompt frames the copilot without promising outcomes', () => {
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('live chart copilot');
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('not financial advice');
    });
});
