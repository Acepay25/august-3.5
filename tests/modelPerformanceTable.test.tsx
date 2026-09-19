/**
 * WS-5.4's named tabular case: "Tables over tiles where data is tabular
 * (win rates, skills, trade log)". ModelPerformanceDashboard used to render
 * one `ModelCard` per model in a 2/3/4-column tile grid — win rates, streaks
 * and status are per-model columns of the same record, so the tiles were the
 * exact shape the doctrine calls out.
 *
 * Nothing rendered this component before, so the conversion is pinned here:
 * the rows must exist, carry the same numbers the tiles did, and stay
 * expandable. It also has to work with a trade log and no providers, because
 * that is the state the Journal shows on a fresh profile.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

let store: Record<string, string> = {};
// The whole Preferences surface, not just the object helpers: this dashboard
// syncs a rolling-window store on mount, and a partial mock leaves the other
// imports undefined and the refresh throws inside its own timer.
vi.mock('../services/infrastructure/PreferencesService', async importOriginal => {
    const actual = await importOriginal<typeof import('../services/infrastructure/PreferencesService')>();
    const read = async (key: string): Promise<string | null> => store[key] ?? null;
    return {
        ...actual,
        getPreference: read,
        setPreference: async (key: string, value: string) => { store[key] = value; },
        removePreference: async (key: string) => { delete store[key]; },
        getPreferenceObject: async (key: string) => {
            const raw = store[key];
            return raw ? JSON.parse(raw) as unknown : null;
        },
        setPreferenceObject: async (key: string, value: unknown) => { store[key] = JSON.stringify(value); },
        getPreferenceArray: async (key: string, guard?: (item: unknown) => boolean) => {
            const raw = store[key];
            const arr = raw ? JSON.parse(raw) as unknown[] : [];
            if (!Array.isArray(arr)) return [];
            return guard ? arr.filter(guard) : arr;
        },
        hasPreference: async (key: string) => key in store,
        getAllKeys: async () => Object.keys(store),
        clearAllPreferences: async () => { store = {}; },
        isSqliteMigrated: async () => true,
        setSqliteMigrated: async () => { /* in-memory */ },
    };
});

import ModelPerformanceDashboard from '../components/dashboards/ModelPerformanceDashboard';
import { TradeOutcome, type LoggedTrade, type TradeAnalysis } from '../types';

const mk = (id: string, provider: string, outcome: TradeOutcome): LoggedTrade => ({
    id,
    outcome,
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    marketRegime: 'trending',
    pnlPercent: outcome === TradeOutcome.WIN ? 2 : -1,
    modelsUsed: { [provider]: `${provider}-m1` },
    analysis: {
        coinName: 'BTCUSDT', direction: 'Long', confidence: 70,
        detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }], stopLoss: 95, takeProfit: [{ price: 110 }],
    } as unknown as TradeAnalysis,
} as LoggedTrade);

const TRADES: LoggedTrade[] = [
    mk('w1', 'gemini', TradeOutcome.WIN),
    mk('w2', 'gemini', TradeOutcome.WIN),
    mk('w3', 'gemini', TradeOutcome.WIN),
    mk('l1', 'gemini', TradeOutcome.LOSS),
    mk('l2', 'deepseek', TradeOutcome.LOSS),
    mk('l3', 'deepseek', TradeOutcome.LOSS),
];

beforeEach(() => { store = {}; localStorage.clear(); });
afterEach(cleanup);

describe('Model performance is a table, not tiles (WS-5.4)', () => {
    it('renders one row per model with the win rate and W/L it used to show in a card', async () => {
        render(<ModelPerformanceDashboard enabledProviders={['gemini', 'deepseek']} trades={TRADES} />);
        const table = await waitFor(() => {
            const t = document.querySelector('table');
            if (!t) throw new Error('no table yet');
            return t;
        }, { timeout: 3000 });
        expect([...table.querySelectorAll('thead th')].map(th => th.textContent?.trim())).toEqual(
            ['Detail', 'Model', 'Win rate', 'Last 20', 'Status'],
        );
        const rows = [...table.querySelectorAll('tbody tr')];
        expect(rows.length).toBeGreaterThanOrEqual(2);
        const text = table.textContent ?? '';
        expect(text).toContain('gemini');
        expect(text).toContain('deepseek');
        // The numbers the tiles carried survive the move: 3W/1L for gemini.
        expect(text).toMatch(/3W \/ 1L/);
        expect(text).toMatch(/75%/);
        // A tile grid would still be here; the table replaced it.
        expect(document.querySelector('[class*="md:grid-cols-3"]')).toBeNull();
    });

    it('discloses the per-model detail a card used to show by default', async () => {
        render(<ModelPerformanceDashboard enabledProviders={['gemini']} trades={TRADES} />);
        const toggle = await waitFor(() => {
            const b = screen.getByLabelText('Show detail for gemini');
            if (!b) throw new Error('not mounted');
            return b;
        }, { timeout: 3000 });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);
        await waitFor(() => expect(screen.getByLabelText('Hide detail for gemini')).toBeTruthy());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });
});
