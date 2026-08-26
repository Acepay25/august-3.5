import { describe, it, expect } from 'vitest';
import { assignDebateProtocol } from '../services/providers/ensembleService';
import { summarizeDebateProtocols } from '../utils/promptVersionStats';
import { collectApprovalItems } from '../utils/approvalInbox';
import type { LoggedTrade } from '../types';
import { TradeOutcome } from '../types';
import type { Message } from '../types/message';

describe('Protocol A/B lanes', () => {
    it('assigns only valid protocols', () => {
        for (let i = 0; i < 50; i++) {
            expect(['standard', 'extended', 'efficient']).toContain(assignDebateProtocol());
        }
    });

    it('summarizes per-protocol outcomes', () => {
        const trade = (outcome: TradeOutcome): LoggedTrade =>
            ({ outcome }) as unknown as LoggedTrade;
        const stats = summarizeDebateProtocols({
            standard: [trade(TradeOutcome.WIN), trade(TradeOutcome.LOSS), trade(TradeOutcome.PENDING)],
            extended: [trade(TradeOutcome.WIN)],
            efficient: [],
        });
        expect(stats.find(s => s.protocol === 'standard')).toMatchObject({ trades: 2, wins: 1, winRate: 50 });
        expect(stats.find(s => s.protocol === 'extended')).toMatchObject({ trades: 1, wins: 1, winRate: 100 });
        expect(stats.find(s => s.protocol === 'efficient')).toMatchObject({ trades: 0, winRate: null });
    });
});

describe('Inline approval cards', () => {
    it('collects autopilot + skill items keyed by messageId', () => {
        const aiMessage = {
            id: 'msg1',
            role: 'ai',
            analysis: { coinName: 'BTC' },
            outcome: TradeOutcome.PENDING,
        } as unknown as Message;
        const items = collectApprovalItems([aiMessage], {
            msg1: { detail: 'TP hit — +2.1R', outcome: TradeOutcome.WIN },
        } as never, 'tester');
        const ap = items.find(i => i.kind === 'autopilot');
        expect(ap).toBeTruthy();
        expect(ap!.messageId).toBe('msg1');
        // MessageItem filters inlineApprovals by messageId — this is what the
        // inline card renders.
        const mine = items.filter(i => i.messageId === 'msg1');
        expect(mine.length).toBeGreaterThan(0);
    });
});
