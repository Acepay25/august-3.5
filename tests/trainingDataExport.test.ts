/**
 * The training corpus's shape — pinned because a fine-tune reads these lines
 * with a script, and a ragged, leaking or lossy record teaches the wrong lesson.
 */

import { describe, it, expect } from 'vitest';
import { TradeOutcome, type LoggedTrade } from '../types';
import { TRAINING_SCHEMA_VERSION, trainingRecordFor } from '../utils/reportExport';
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
        createdAt: '2026-10-04T09:55:00.000Z',
    } as unknown as LoggedTrade['analysis'],
    ...over,
} as LoggedTrade);

describe('trainingRecordFor', () => {
    it('carries a schema version on every line', () => {
        expect(trainingRecordFor(trade()).schemaVersion).toBe(TRAINING_SCHEMA_VERSION);
    });

    it('separates decision-time inputs from outcome and lesson', () => {
        const rec = trainingRecordFor(trade({ realizedR: -1.2, postMortem: 'moved the stop' }));
        const d = rec.decision as Record<string, unknown>;
        const o = rec.outcome as Record<string, unknown>;
        const l = rec.lesson as Record<string, unknown>;
        expect(d.entry).toBe('95000');
        expect(d.stopLoss).toBe('94000');
        expect(d.verdictProbability).toBe(62);
        // What the market said, and what was written afterwards, are NOT inputs.
        expect(o.realizedR).toBe(-1.2);
        expect(l.postMortem).toBe('moved the stop');
        expect(d).not.toHaveProperty('realizedR');
        expect(d).not.toHaveProperty('postMortem');
        expect(d).not.toHaveProperty('outcome');
    });

    it('keeps every key on every line, null where the fact was never learned', () => {
        const bare = trainingRecordFor(trade());
        const full = trainingRecordFor(trade({
            planId: 'btc-abc',
            outcomeResolvedAt: '2026-10-05T09:00:00.000Z',
            realizedR: 2,
            maxAdverseExcursion: 180,
            checklistCompleted: summarizeChecklist(DEFAULT_CHECKLIST, new Set(['news'])),
            postMortem: 'text',
        }));
        // Each nest keeps its own keys whatever the row holds — the interior of
        // an optional payload (a checklist) legitimately varies with the user's
        // own checklist config, so the contract is per-nest, not global.
        for (const nest of ['decision', 'outcome', 'lesson', 'provenance'] as const) {
            expect(Object.keys(bare[nest] as object).sort())
                .toEqual(Object.keys(full[nest] as object).sort());
        }
        expect(Object.keys(bare).sort()).toEqual(Object.keys(full).sort());
        const b = bare as Record<string, any>;
        expect(b.decision.planId).toBeNull();
        expect(b.outcome.outcomeResolvedAt).toBeNull();
        expect(b.outcome.realizedR).toBeNull();
        expect(b.decision.checklist).toBeNull();
    });

    it('flags an incomplete row instead of hiding or padding it', () => {
        const open = trainingRecordFor(trade({ outcome: TradeOutcome.PENDING }));
        expect(open.incomplete).toBe(true);
        expect((open.missing as string[])).toContain('outcome');
        const complete = trainingRecordFor(trade({
            realizedR: -1,
            pnlAmount: -50,
            maxAdverseExcursion: 90,
            postMortem: 'why it failed',
            checklistCompleted: summarizeChecklist(DEFAULT_CHECKLIST, new Set()),
        }));
        expect(complete.incomplete).toBe(false);
        expect(complete.missing).toEqual([]);
    });

    it('never converts percent PnL into dollars it does not have', () => {
        const o = trainingRecordFor(trade({ pnlPercent: -200 })).outcome as Record<string, unknown>;
        expect(o.pnlPercent).toBe(-200);
        expect(o.pnlAmount).toBeNull();
    });

    it('records which writer measured R and the excursions', () => {
        const o = trainingRecordFor(trade({ realizedR: 1.5, rSource: 'autopilot', maxAdverseExcursion: 60, excursionSource: 'postMortem' })).outcome as Record<string, unknown>;
        expect(o.rSource).toBe('autopilot');
        expect(o.excursionSource).toBe('postMortem');
    });

    it('counts the debate transcript instead of pasting it, keeping the run id', () => {
        const rec = trainingRecordFor(trade({
            sourceRunId: 'run-77',
            debateTurns: [{ provider: 'p', model: 'm', content: 'x'.repeat(5000) }] as never,
        }));
        const prov = rec.provenance as Record<string, unknown>;
        expect(prov.debateTurnCount).toBe(1);
        expect(prov.sourceRunId).toBe('run-77');
        expect(JSON.stringify(rec)).not.toContain('xxxx');
    });

    it('gives the tape anchors so entry-time candles can be refetched', () => {
        const d = trainingRecordFor(trade()).decision as Record<string, unknown>;
        expect(d.symbol).toBe('BTCUSDT');
        expect(d.analysisCreatedAt).toBe('2026-10-04T09:55:00.000Z');
        expect(d.entry).toBe('95000');
    });
});

describe('summarizeChecklist', () => {
    it('records WHICH items were skipped, not just how many', () => {
        const res = summarizeChecklist(DEFAULT_CHECKLIST, new Set(['news', 'sl-tp']));
        expect(res.done).toBe(2);
        expect(res.total).toBe(DEFAULT_CHECKLIST.length);
        const byId = Object.fromEntries(res.items.map(i => [i.id, i.checked]));
        expect(byId['news']).toBe(true);
        expect(byId['invalidation']).toBe(false);
    });
});
