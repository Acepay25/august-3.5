import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoggedTrade } from '../types';
import { TradeOutcome } from '../types';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { findRelevantTrades } from '../services/learning/PatternMemorySynthesisService';
import { buildVerdictEvidencePack } from '../services/learning/EvidencePackService';
import { filterBotNoteByQuery } from '../services/bots/BotMemoryService';
import { parseSkillMarkdown } from '../services/learning/SkillMemoryService';

const day = 86_400_000;

const makeTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    analysis: { coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A' } as LoggedTrade['analysis'],
    outcome: TradeOutcome.LOSS,
    timestamp: new Date().toISOString(),
    postMortem: '**Key Lesson:** Wait for the reclaim.',
    ...overrides,
} as LoggedTrade);

describe('ROUND-31 memory honesty', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles('test-user');
    });

    it('decays old-trade similarity in prompts but not by default', () => {
        const fresh = makeTrade({ id: 'fresh' });
        const ancient = makeTrade({ id: 'old', timestamp: new Date(Date.now() - 360 * day).toISOString() });
        const setup = { coin: 'BTC', direction: 'Short' as const };

        const plainOld = findRelevantTrades(setup, [ancient])[0].similarity;
        const decayedOld = findRelevantTrades(setup, [ancient], { decayByAge: true })[0].similarity;
        expect(plainOld).toBeGreaterThan(20);
        expect(decayedOld).toBeLessThan(plainOld);
        // 360 days at exp(-t/120) ⇒ ~5% of the raw score remains.
        expect(decayedOld).toBeLessThanOrEqual(Math.ceil(plainOld * 0.06));

        // Today's trade barely decays: compare against ITS OWN raw score.
        const rawFresh = findRelevantTrades(setup, [fresh])[0].similarity;
        const decayedFresh = findRelevantTrades(setup, [fresh], { decayByAge: true })[0].similarity;
        expect(Math.abs(decayedFresh - rawFresh)).toBeLessThanOrEqual(1);
    });

    it('keeps the evidence pack consistent with the decayed block', () => {
        const trades = [
            makeTrade({ id: 'a', timestamp: new Date(Date.now() - 300 * day).toISOString() }),
            makeTrade({ id: 'b' }),
        ];
        const pack = buildVerdictEvidencePack(
            { coin: 'BTC', direction: 'Short', family: undefined, pattern: undefined },
            trades,
        );
        const oldRow = pack.ui.similar.find(s => s.date !== new Date().toLocaleDateString());
        if (oldRow) {
            // The UI row must show the DECAYED similarity, not raw.
            expect(oldRow.similarity).toBeLessThan(100);
        }
    });

    it('filters bot notes to this setup and drops other-coin lines', () => {
        const note = [
            '- BTC short fakeouts fail when funding is positive.',
            '- ETH longs need HTF alignment first.',
            '- SOL momentum fades after 3 pushes.',
            '- General: never move a stop further away.',
        ].join('\n');
        const filtered = filterBotNoteByQuery(note, { coin: 'BTC', regime: undefined })!;
        expect(filtered).toContain('BTC');
        expect(filtered).not.toContain('ETH');
        expect(filtered).toContain('never move a stop');

        // No query → whole note passes.
        expect(filterBotNoteByQuery(note, {})).toBe(note.trim());
        // Short notes pass whole regardless.
        expect(filterBotNoteByQuery('- one line', { coin: 'BTC' })).toBe('- one line');
        // All-other-coin note → nothing survives.
        const otherCoinOnly = '- ETH line one\n- ETH line two\n- ETH line three';
        expect(filterBotNoteByQuery(otherCoinOnly, { coin: 'BTC' })).toBeNull();
    });

    it('parses and serializes the evidenceCount provenance counter', () => {
        const md = [
            '---',
            'status: confirmed',
            'kind: avoid',
            'coin: BTC',
            'direction: Short',
            'wins: 1',
            'losses: 6',
            'tradeIds: t1,t2,t3',
            'evidenceCount: 27',
            '---',
            '',
            '# Avoid BTC Short',
            '',
            'Body.',
        ].join('\n');
        const meta = parseSkillMarkdown(md)!;
        expect(meta.evidenceCount).toBe(27);
        expect(meta.tradeIds.length).toBe(3);
    });
});
