/**
 * skillProof — on-demand history proof for a skill. Mocks the kline source,
 * reuses the pin-bar tape the scan tests use so the detector actually fires
 * and produces a win-rate readout. No model: it's pure scanHistorySetups.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/analysis/KlineService', () => ({ fetchKlines: vi.fn() }));
import { fetchKlines } from '../services/analysis/KlineService';
import { proofSkillOnHistory, matchDetector, skillProofText } from '../services/learning/skillProof';
import { scanHistorySetups, type ScanCandle } from '../services/trade/setupScan';

const bar = (t: number, o: number, h: number, l: number, c: number): ScanCandle =>
    ({ time: t * 900_000, open: o, high: h, low: l, close: c });

const tape = (): ScanCandle[] => {
    const c: ScanCandle[] = [];
    for (let i = 0; i < 6; i += 1) c.push(bar(i, 100, 101, 99, 100));
    for (let k = 0; k < 6; k += 1) {
        const t0 = c.length;
        c.push(
            bar(t0, 100, 101, 99, 100), bar(t0 + 1, 100, 101, 99, 100),
            bar(t0 + 2, 100, 101, 99, 100), bar(t0 + 3, 100, 101, 99, 100),
            bar(t0 + 4, 99.2, 99.4, 95, 99.3),
            bar(t0 + 5, 100, 101, 99, 100), bar(t0 + 6, 100, 101, 99, 100),
            bar(t0 + 7, 99.5, 102, 99.5, 101.5), bar(t0 + 8, 101.5, 104.5, 101, 104),
        );
    }
    return c;
};

beforeEach(() => { vi.mocked(fetchKlines).mockReset(); vi.mocked(fetchKlines).mockResolvedValue(tape() as never); });

describe('skillProofText + matchDetector', () => {
    it('joins the searchable clauses', () => {
        const text = skillProofText({ ifCondition: 'pin bar at low', thenAction: 'go long' });
        expect(text).toContain('pin bar at low');
        expect(text).toContain('go long');
    });
    it('matches pin-bar text to a pin-bar-family detector', () => {
        const stats = scanHistorySetups(tape());
        const stat = matchDetector('bullish pin bar rejection at the local low wick', stats);
        expect(stat).not.toBeNull();
        // pin-bar-buy and range-fade-bottom share the 'pin bar'/'rejection'
        // keywords, so the matcher lands on one of them (tie → more hits).
        expect(['pin-bar-buy', 'range-fade-bottom']).toContain(stat!.id);
        expect(stat!.keywords).toContain('pin bar');
    });
    it('returns null when nothing overlaps', () => {
        const stats = scanHistorySetups(tape());
        expect(matchDetector('totally unrelated funding basis clause', stats)).toBeNull();
    });
});

describe('proofSkillOnHistory', () => {
    it('normalizes a bare coin to a USDT symbol and proves the matched detector', async () => {
        const r = await proofSkillOnHistory({ coin: 'BTC', timeframe: '15m', text: 'bullish pin bar at the local low' });
        expect(fetchKlines).toHaveBeenCalledWith('BTCUSDT', '15m', 1000);
        expect(r.status).toBe('ok');
        if (r.status === 'ok') {
            expect(['pin-bar-buy', 'range-fade-bottom']).toContain(r.proof.detectorId);
            expect(r.proof.hits).toBeGreaterThan(0);
            expect(r.proof.symbol).toBe('BTCUSDT');
            expect(r.proof.winRate).not.toBeNull();
        }
    });
    it('leaves an already-suffixed symbol untouched', async () => {
        await proofSkillOnHistory({ coin: 'ETHUSDT', timeframe: '1h', text: 'pin bar' });
        expect(fetchKlines).toHaveBeenCalledWith('ETHUSDT', '1h', 1000);
    });
    it('reports no-data when the history is too short', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(tape().slice(0, 20) as never);
        const r = await proofSkillOnHistory({ coin: 'BTC', timeframe: '15m', text: 'pin bar' });
        expect(r.status).toBe('no-data');
    });
    it('reports no-match when no detector overlaps the clauses', async () => {
        const r = await proofSkillOnHistory({ coin: 'BTC', timeframe: '15m', text: 'funding basis carry trade at 03:00' });
        expect(r.status).toBe('no-match');
    });
    it('defaults the timeframe to 1h when blank', async () => {
        await proofSkillOnHistory({ coin: 'SOL', timeframe: '', text: 'pin bar' });
        expect(fetchKlines).toHaveBeenCalledWith('SOLUSDT', '1h', 1000);
    });
});
