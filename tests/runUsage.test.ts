import { describe, expect, it } from 'vitest';
import { formatChars, summarizeRunUsage } from '../utils/runUsage';
import { RunStats } from '../types';

describe('summarizeRunUsage', () => {
    it('estimates tokens from analyst output chars', () => {
        const stats: RunStats = {
            startedAt: '2026-08-15T00:00:00.000Z',
            finishedAt: '2026-08-15T00:00:41.200Z',
            durationMs: 41200,
            analystCount: 3,
            gateCap: 0.72,
            mcWinRate: 58,
            mcEV: 0.4,
            btMatches: 11,
            btWinRate: 64,
            btEV: 0.3,
            analysts: [
                { providerId: 'a', displayName: 'A', modelId: 'm1', charsOut: 20000 },
                { providerId: 'b', displayName: 'B', modelId: 'm2', charsOut: 28200 },
            ],
        };
        const usage = summarizeRunUsage(stats);
        expect(usage.durationSec).toBe(41);
        expect(usage.analystCount).toBe(3);
        expect(usage.charsOut).toBe(48200);
        expect(usage.tokensEst).toBe(12050);
        expect(usage.tokensExact).toBe(false);
        expect(usage.gateCapPct).toBe(72);
        expect(usage.similarSetups).toBe(11);
    });

    it('formats char counts compactly', () => {
        expect(formatChars(48200)).toBe('48.2k');
        expect(formatChars(900)).toBe('900');
    });
});
