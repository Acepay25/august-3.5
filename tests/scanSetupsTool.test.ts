/**
 * scan_setups desk tool + book skill drafts. The tool test drives
 * executeDeskTool with a mocked kline source and a matching library skill, so
 * the whole path (fetch → scan → skill cross-reference → receipt) is covered.
 * The drafts test proves the one-time, idempotent, approval-gated seeding.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/analysis/KlineService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/KlineService')>();
    return { ...actual, fetchKlines: vi.fn() };
});
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: vi.fn(() => []),
}));

import { executeDeskTool } from '../services/analysis/DeskToolsService';
import { fetchKlines } from '../services/analysis/KlineService';
import { listSkills } from '../services/learning/SkillMemoryService';
import { ensureBookSkillDrafts, BOOK_SKILL_DRAFTS } from '../services/learning/bookSkillDrafts';
import { listSkillDrafts } from '../utils/skillDrafts';

const bar = (time: number, open: number, high: number, low: number, close: number) =>
    ({ time, open, high, low, close, volume: 10 });

/** A tight base then a full-bodied close above the range high → breakout. */
const breakoutCandles = () => {
    const c = [];
    for (let i = 0; i < 30; i += 1) c.push(bar(i, 100, 101, 99, 100));
    c.push(bar(30, 100, 104, 100, 103.5));
    return c;
};

beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchKlines).mockReset();
    vi.mocked(listSkills).mockReset();
    vi.mocked(listSkills).mockReturnValue([]);
});

describe('scan_setups tool', () => {
    it('returns live setups with evidence and cites a matching skill', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(breakoutCandles() as never);
        vi.mocked(listSkills).mockReturnValue([{
            file: { name: 'breakout-retest.md' } as never,
            meta: { status: 'confirmed', ifCondition: 'IF price breaks out of the range THEN retest' } as never,
        }]);
        const r = await executeDeskTool({ id: 'c1', name: 'scan_setups', arguments: { symbol: 'BTCUSDT', interval: '15m' } });
        expect(r.ok).toBe(true);
        expect(r.content).toContain('SETUP SCAN BTCUSDT 15m');
        expect(r.content).toContain('Range breakout');
        expect(r.content).toContain('breakout-retest');
        expect(fetchKlines).toHaveBeenCalledWith('BTCUSDT', '15m', 60);
    });

    it('says nothing is live when the tape is flat (no invented setups)', async () => {
        const flat = [];
        for (let i = 0; i < 40; i += 1) flat.push(bar(i, 100, 100.4, 99.6, 100));
        vi.mocked(fetchKlines).mockResolvedValue(flat as never);
        const r = await executeDeskTool({ id: 'c1', name: 'scan_setups', arguments: {} }, { defaultSymbol: 'ETHUSDT', chartInterval: '1h' });
        expect(r.content).toContain('nothing live');
        expect(r.content).toContain('Do not invent a setup');
    });

    it('surfaces DATA_UNAVAILABLE when the candles do not come back', async () => {
        vi.mocked(fetchKlines).mockResolvedValue([] as never);
        const r = await executeDeskTool({ id: 'c1', name: 'scan_setups', arguments: { symbol: 'SOLUSDT' } });
        expect(r.content).toContain('DATA_UNAVAILABLE');
    });
});

describe('book skill drafts', () => {
    it('queues every book playbook once, as approval-gated drafts', () => {
        const queued = ensureBookSkillDrafts('alice');
        expect(queued).toBe(BOOK_SKILL_DRAFTS.length);
        const drafts = listSkillDrafts('alice');
        expect(drafts.length).toBe(BOOK_SKILL_DRAFTS.length);
        expect(drafts.every(d => d.tradeId.startsWith('book:'))).toBe(true);
        // Every draft carries a real IF/THEN pair.
        expect(drafts.every(d => d.crafted.ifCondition.length > 8 && d.crafted.thenAction.length > 8)).toBe(true);
    });

    it('is idempotent — a second call queues nothing (flag guard)', () => {
        ensureBookSkillDrafts('alice');
        expect(ensureBookSkillDrafts('alice')).toBe(0);
        expect(listSkillDrafts('alice').length).toBe(BOOK_SKILL_DRAFTS.length);
    });

    it('does not re-add a draft the trader already dismissed', () => {
        ensureBookSkillDrafts('alice');
        // Simulate approval/dismissal clearing one draft, then a later boot.
        localStorage.setItem('book_drafts_seeded_v1', '1');
        expect(ensureBookSkillDrafts('alice')).toBe(0);
    });
});
