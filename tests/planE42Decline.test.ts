/**
 * E-42(a) — a decline is a first-class object.
 *
 * The app could present a trade but could not record a DECISION NOT TO. "Are
 * we skipping winners?" was unanswerable because the skip left no row. This
 * drives the real executor, so the only way it passes is for `decline_trade`
 * to be offered and to actually write the HOLD record.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    setPreference: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
    getAllKeys: vi.fn(async () => []),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'e42',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import { executeDeskTool } from '../services/analysis/DeskToolsService';
import { listDeclines, recordDecline, MAX_DECLINES } from '../services/trade/declineLog';
import { CHAT_SURFACE_TOOLS } from '../services/trade/chatSurfaceTurn';
import { AUTOMATION_TOOLS } from '../services/trade/automationTurn';

beforeEach(() => {
    store = {};
    localStorage.clear();
});

const call = (args: Record<string, unknown> = {}) => ({
    id: 'd1',
    name: 'decline_trade',
    arguments: {
        symbol: 'BTCUSDT', direction: 'Long', reason: 'Chop under the range high; no edge.',
        entry: 100, stopLoss: 95, takeProfits: [110], invalidation: 'A close above 112',
        ...args,
    },
});

describe('decline_trade is offered on every surface that can present', () => {
    it('is on the Chat and scheduled-run allow-lists', () => {
        expect(CHAT_SURFACE_TOOLS).toContain('decline_trade');
        expect(AUTOMATION_TOOLS).toContain('decline_trade');
        // The dock's list is the same surface's tool turn.
        const dock = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
        expect(dock).toMatch(/'present_trade',\s*\n\s*'decline_trade'/);
    });
});

describe('the executor writes the HOLD record', () => {
    it('records the reason, the side and the rejected levels', async () => {
        const result = await executeDeskTool(call());
        expect(result.ok).toBe(true);
        expect(result.content).toMatch(/HOLD recorded/);

        const rows = listDeclines('e42');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            symbol: 'BTCUSDT',
            direction: 'Long',
            reason: expect.stringMatching(/Chop under the range high/),
            entry: 100,
            stopLoss: 95,
            takeProfits: [110],
            invalidation: 'A close above 112',
            source: 'desk',
        });
        expect(rows[0].createdAt).toBeTruthy();
    });

    it('refuses a decline with no reason and writes nothing', async () => {
        const result = await executeDeskTool(call({ reason: '   ' }));
        expect(result.ok).toBe(false);
        expect(result.content).toMatch(/reason are required/);
        expect(listDeclines('e42')).toEqual([]);
    });

    it('honours the seat allow-list (a seat without the tool cannot call it)', async () => {
        const result = await executeDeskTool(call(), { allowedTools: ['get_price_snapshot'] });
        expect(result.ok).toBe(false);
        expect(result.content).toMatch(/not available on this seat/);
        expect(listDeclines('e42')).toEqual([]);
    });

    it('is bounded, keeping the newest declines', () => {
        for (let i = 0; i < MAX_DECLINES + 5; i++) {
            recordDecline({ symbol: 'BTCUSDT', reason: `skip ${i}` }, 'e42');
        }
        const rows = listDeclines('e42');
        expect(rows).toHaveLength(MAX_DECLINES);
        expect(rows[0].reason).toBe(`skip ${MAX_DECLINES + 4}`);
    });
});
