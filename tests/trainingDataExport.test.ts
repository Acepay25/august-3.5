/**
 * The training corpus's shape — pinned because a fine-tune reads these lines
 * with a script, and a ragged or lossy record teaches the wrong lesson.
 */

import { describe, it, expect } from 'vitest';
import { TradeOutcome, type LoggedTrade } from '../types';
import { trainingRecordFor } from '../utils/reportExport';
import { summarizeChecklist, DEFAULT_CHECKLIST } from '../utils/checklist';

const trade = (over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't1',
    timestamp: '2026-10-04T10:00:00.000Z',
    outcome: TradeOutcome.LOSS,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Long',
        probability: 62,
        strategy: 'Breakout retest',
        stopLoss: '94000',
        takeProfit: [{ price: '96000' }, { price: '97000' }],
        entryPoints: [{ price: '95000' }],
    } as unknown as LoggedTrade['analysis'],
    ...over,
} as LoggedTrade);

describe('trainingRecordFor', () => {
    it('keeps every key on every record, null where the app never learned the fact', () => {
        const rec = trainingRecordFor(trade());
        expect(rec.planId).toBeNull();
        expect(rec.outcomeResolvedAt).toBeNull();
        expect(rec.realizedR).toBeNull();
        expect(rec.maxAdverseExcursion).toBeNull();
        expect(rec.checklist).toBeNull();
        // The schema must not change shape between rows: a script reading the
        // file cannot tell "absent from this row" from "absent from this version".
        const full = trainingRecordFor(trade({
            planId: 'btc-abc',
            outcomeResolvedAt: '2026-10-05T09:00:00.000Z',
            realizedR: -1.2,
            maxAdverseExcursion: 180,
        }));
        expect(Object.keys(rec).sort()).toEqual(Object.keys(full).sort());
    });

    it('carries the stage-3 facts a settled row now has', () => {
        const rec = trainingRecordFor(trade({
            planId: 'btc-abc',
            outcomeResolvedAt: '2026-10-05T09:00:00.000Z',
            pnlPercent: -200,
            maxAdverseExcursion: 180,
            maxFavorableExcursion: 60,
            mistakeTags: ['revenge'],
        }));
        expect(rec.planId).toBe('btc-abc');
        expect(rec.outcomeResolvedAt).toBe('2026-10-05T09:00:00.000Z');
        expect(rec.maxAdverseExcursion).toBe(180);
        expect(rec.mistakeTags).toEqual(['revenge']);
    });

    it('never converts percent PnL into dollars it does not have', () => {
        const rec = trainingRecordFor(trade({ pnlPercent: -200 }));
        expect(rec.pnlPercent).toBe(-200);
        // A derived dollar figure would be indistinguishable from a captured one.
        expect(rec.pnlAmount).toBeNull();
    });

    it('counts the debate transcript instead of pasting it, keeping the run id', () => {
        const rec = trainingRecordFor(trade({
            sourceRunId: 'run-77',
            debateTurns: [{ provider: 'p', model: 'm', content: 'x'.repeat(5000) }] as never,
            moderatorSynthesis: 'the verdict text',
        }));
        expect(rec.debateTurnCount).toBe(1);
        expect(rec.sourceRunId).toBe('run-77');
        expect(rec.moderatorSynthesis).toBe('the verdict text');
        expect(JSON.stringify(rec)).not.toContain('xxxx');
    });

    it('includes unresolved rows rather than biasing the corpus to settled trades', () => {
        const rec = trainingRecordFor(trade({ outcome: TradeOutcome.PENDING }));
        expect(rec.outcome).toBe('PENDING');
    });
});

describe('summarizeChecklist', () => {
    it('records WHICH items were skipped, not just how many', () => {
        const res = summarizeChecklist(DEFAULT_CHECKLIST, new Set(['news', 'sl-tp']));
        expect(res.done).toBe(2);
        expect(res.total).toBe(DEFAULT_CHECKLIST.length);
        expect(res.items).toHaveLength(DEFAULT_CHECKLIST.length);
        const byId = Object.fromEntries(res.items.map(i => [i.id, i.checked]));
        expect(byId['news']).toBe(true);
        expect(byId['mental-state']).toBe(false);
        expect(byId['invalidation']).toBe(false);
    });
});
