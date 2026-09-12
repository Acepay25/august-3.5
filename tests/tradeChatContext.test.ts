import { describe, it, expect } from 'vitest';
import { buildSkillsIndexForPrompt, buildTradeChatContext, describeChartSnapshotForModel, TRADE_CHAT_SYSTEM_PROMPT } from '../services/trade/tradeChatContext';

describe('buildTradeChatContext (the model sees the chart)', () => {
    it('labels the packet with symbol, interval, and an exact PHT fetch time', () => {
        const ctx = buildTradeChatContext({
            symbol: 'BTCUSDT',
            interval: '15m',
            packetMarkdown: '## Hybrid market packet\nPrice 100,500',
            fetchedAtMs: Date.parse('2026-09-10T04:05:06.000Z'),
        });
        expect(ctx).toContain('LIVE CHART CONTEXT');
        expect(ctx).toContain('BTCUSDT · 15m');
        // 04:05:06 UTC = 12:05:06 PHT — the clock the user actually reads.
        expect(ctx).toContain('Sep 10, 12:05:06');
        expect(ctx).toContain('PHT (UTC+8)');
        expect(ctx).not.toContain('UTC —');
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

    it('threads the on-screen snapshot + drawings as separate labeled blocks', () => {
        const ctx = buildTradeChatContext({
            symbol: 'BTCUSDT', interval: '15m', packetMarkdown: '## packet',
            fetchedAtMs: Date.now(),
            onScreenDescription: '[ON SCREEN — painted]',
            drawingsDescription: 'USER DRAWINGS ON THE CHART (1 shape):',
        });
        expect(ctx).toContain('[ON SCREEN — painted]');
        expect(ctx).toContain('USER DRAWINGS ON THE CHART (1 shape):');
        expect(ctx).toContain('propose_skill');
    });

    it('threads the armed-plan block so the model always knows the live plan', () => {
        const ctx = buildTradeChatContext({
            symbol: 'BTCUSDT', interval: '15m', packetMarkdown: '## packet', fetchedAtMs: Date.now(),
            plansDescription: '[ARMED PLAN — harness level watch on Long BTCUSDT, plan btc-1]',
        });
        expect(ctx).toContain('[ARMED PLAN');
        expect(ctx).toContain('plan btc-1');
        // Absent plans leave no trace.
        expect(buildTradeChatContext({ symbol: 'BTCUSDT', interval: '15m', packetMarkdown: 'p', fetchedAtMs: Date.now() })).not.toContain('ARMED PLAN');
    });

    it('the system prompt teaches the harness-signal protocol', () => {
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('[HARNESS SIGNAL]');
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('NEVER re-announce a level already marked fired');
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('does not place, close or resolve trades');
    });

    it('describeChartSnapshotForModel renders painted candles, mark and levels', () => {
        const text = describeChartSnapshotForModel({
            candles: [{ time: 1757500000, open: 100, high: 105, low: 99, close: 104 }],
            markPrice: 104.7,
            levels: [{ label: 'Entry', price: 101.5 }],
            capturedAt: Date.now(),
        });
        expect(text).toContain('what the canvas is literally displaying');
        expect(text).toContain('Live mark shown on the chart: 104.7');
        expect(text).toContain('Entry 101.5');
        expect(text).toContain('O100 H105 L99 C104');
    });

    it('describeChartSnapshotForModel returns empty text for an empty canvas', () => {
        expect(describeChartSnapshotForModel({ candles: [], markPrice: null, levels: [], capturedAt: 0 })).toBe('');
    });

    it('the system prompt frames the copilot without promising outcomes', () => {
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('live chart copilot');
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('not financial advice');
    });

    it('the system prompt MANDATES desk tools, skills and growth', () => {
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('ALWAYS ground market claims');
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('ALWAYS consult the skills library');
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('revise_skill');
        expect(TRADE_CHAT_SYSTEM_PROMPT).toContain('propose_skill');
    });
});

describe('buildSkillsIndexForPrompt', () => {
    it('returns empty text for an empty library', () => {
        expect(buildSkillsIndexForPrompt([])).toBe('');
    });

    it('lists slug + IF/THEN rules so the model applies existing skills', () => {
        const block = buildSkillsIndexForPrompt([
            { slug: 'sweep-reclaim', status: 'active', ifCondition: 'liquidity sweep reclaims the level', thenAction: 'enter on the retest' },
            { slug: 'asia-range-fade', status: 'shadow' },
        ]);
        expect(block).toContain('## Skills library — 2 skills');
        expect(block).toContain('- sweep-reclaim [active] — IF liquidity sweep reclaims the level → THEN enter on the retest');
        expect(block).toContain('- asia-range-fade [shadow]');
        expect(block).toContain('APPLY');
    });

    it('caps the index and points to the full library beyond the cap', () => {
        const rows = Array.from({ length: 40 }, (_, i) => ({ slug: `skill-${i}` }));
        const block = buildSkillsIndexForPrompt(rows, 30);
        expect(block).toContain('skill-29');
        expect(block).not.toContain('skill-30\n');
        expect(block).toContain('…and 10 more');
    });
});
