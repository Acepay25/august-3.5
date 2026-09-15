/**
 * Strategy Studio "Prove on history" — the detail pane's free history-proof
 * button must reach skillProof with the skill's coin/timeframe/clauses and
 * paint the verdict without any provider call. The proof engine itself is
 * covered in skillProof.test.ts; the kline source is mocked so no network
 * rides the run. (Formerly tests/skillsGridProof.test.tsx, before the merge.)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

const { fetchKlinesMock } = vi.hoisted(() => ({
    fetchKlinesMock: vi.fn() as Mock<(...args: any[]) => any>,
}));
vi.mock('../services/analysis/KlineService', () => ({ fetchKlines: fetchKlinesMock }));
vi.mock('../services/learning/strategyRegimeMatrix', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/learning/strategyRegimeMatrix')>();
    return { ...actual, hydrateStrategyRegimeMatrix: vi.fn(async () => {}) };
});

import {
    initMemoryFiles,
    getMemoryFiles,
    createMemoryFile,
} from '../services/learning/MemoryFilesService';
import { ToastProvider } from '../components/shared/Toast';
import StrategyStudio from '../components/dashboards/StrategyStudio';

const SKILL = [
    '---',
    'status: confirmed',
    'kind: repeat',
    'coin: BTC',
    'timeframe: 15m',
    'ifCondition: IF a bullish pin bar rejects the local low on volume',
    'thenAction: THEN go long at the trigger close',
    'wins: 2',
    'losses: 1',
    '---',
    '',
    '# BTC 15m Pin Bar Reclaim',
    '',
    'IF a bullish pin bar rejects the local low on volume THEN go long at the close.',
].join('\n');

/** Pin-rewarding tape (the shape the scan suites use): flat base, deep-wick
 *  pin, then a two-bar thrust that makes it a first-touch win. */
const bar = (t: number, o: number, h: number, l: number, c: number) =>
    ({ time: t * 900_000, open: o, high: h, low: l, close: c, volume: 10 });
const tape = () => {
    const c: ReturnType<typeof bar>[] = [];
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

beforeEach(async () => {
    store = {};
    fetchKlinesMock.mockReset();
    fetchKlinesMock.mockResolvedValue(tape());
    await initMemoryFiles('tester');
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) throw new Error('skills folder missing after init');
    await createMemoryFile(folder.id, 'btc-15m-pin-bar-reclaim.md', `${SKILL}\n`, 'tester');
});

describe('Strategy Studio history proof', () => {
    it("detail pane proves the coin's tape and shows the win-rate verdict", { timeout: 30_000 }, async () => {
        render(<ToastProvider><StrategyStudio trades={[]} username="tester" /></ToastProvider>);
        // Open the skill's detail from its library card.
        await userEvent.click(await screen.findByTestId('studio-wl-btc-15m-pin-bar-reclaim'));

        const btn = await screen.findByTestId('prove-skill-history');
        await userEvent.click(btn);

        // The proof fetched the normalized symbol at the skill's OWN timeframe.
        await waitFor(() => expect(fetchKlinesMock).toHaveBeenCalledWith('BTCUSDT', '15m', 1000), { timeout: 20_000 });
        const verdict = await screen.findByTestId('skill-proof-verdict', {}, { timeout: 20_000 });
        expect(/^\d+%$|NO OUTCOMES/.test(verdict.textContent ?? '')).toBe(true);
    });
});
