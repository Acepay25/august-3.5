/**
 * SetupWatchService profile isolation (audit §2.5): watches persist under
 * `setup_watches_v1_<username>` — the old single global key + `init()`'s
 * unconditional early-return meant a profile switch kept the OUTGOING user's
 * armed watches live under the incoming one. Tests: per-user keys, switch
 * reload (reset + init, and init-for-another-user WITHOUT reset), legacy
 * global-blob adoption, and ref-count release of the outgoing symbols.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Key-aware Preferences fake (the shared setupWatch.test mock ignores keys —
// per-user scoping is exactly what this file asserts).
const pref = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => pref.data[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        pref.data[key] = JSON.parse(JSON.stringify(value));
    }),
    removePreference: vi.fn(async (key: string) => { delete pref.data[key]; }),
    PREF_KEYS: { SETUP_WATCHES: 'setup_watches' },
}));

const feed = vi.hoisted(() => ({
    tickCallbacks: [] as Array<(symbol: string, price: number) => void>,
    tracked: [] as string[],
    untracked: [] as string[],
}));
vi.mock('../services/ui/PriceAlertService', () => ({
    PriceAlertService: {
        acquireMonitor: vi.fn(() => () => {}),
        subscribePrices: vi.fn((cb: (symbol: string, price: number) => void) => {
            feed.tickCallbacks.push(cb);
            return () => {
                const i = feed.tickCallbacks.indexOf(cb);
                if (i >= 0) feed.tickCallbacks.splice(i, 1);
            };
        }),
        getCurrentPrice: vi.fn(() => undefined),
        trackSymbol: vi.fn((s: string) => { feed.tracked.push(s); return true; }),
        untrackSymbol: vi.fn((s: string) => { feed.untracked.push(s); return true; }),
        normalizeSymbol: (name: string) => {
            const cleaned = name.replace(/[^A-Z0-9]/gi, '').toUpperCase();
            return cleaned.includes('USDT') ? cleaned : `${cleaned}USDT`;
        },
    },
}));

import { SetupWatchService } from '../services/ui/SetupWatchService';

const drain = () => new Promise(r => setTimeout(r, 0));
const tick = (symbol: string, price: number) => feed.tickCallbacks.forEach(cb => cb(symbol, price));

const watchFor = (messageId: string, coinName = 'BTC') => ({
    messageId,
    coinName,
    triggerType: 'PRICE_ABOVE' as const,
    priceLevel: 100,
    referencePrice: 95,
});

beforeEach(() => {
    pref.data = {};
    feed.tickCallbacks.length = 0;
    feed.tracked.length = 0;
    feed.untracked.length = 0;
    SetupWatchService.resetForTest();
});

describe('SetupWatchService per-user storage + switch reload', () => {
    it('watches save under the loaded user\u2019s key only', async () => {
        await SetupWatchService.init('alice');
        SetupWatchService.createWatch(watchFor('m-1'));
        await drain();

        expect(pref.data['setup_watches_v1_alice']).toHaveLength(1);
        expect(pref.data['setup_watches']).toBeUndefined(); // never the global key
        expect(pref.data['setup_watches_v1_bob']).toBeUndefined();
    });

    it('switching users (reset + init) reloads the incoming user empty, then hands the outgoing set back to them', async () => {
        await SetupWatchService.init('alice');
        SetupWatchService.createWatch(watchFor('m-1'));
        await drain();

        // Loader switch path: reset() then init(incoming).
        SetupWatchService.reset();
        await SetupWatchService.init('bob');
        expect(SetupWatchService.getAllWatches()).toHaveLength(0);

        SetupWatchService.createWatch(watchFor('m-2', 'ETH'));
        await drain();
        expect(pref.data['setup_watches_v1_bob']).toHaveLength(1);
        expect(pref.data['setup_watches_v1_alice']).toHaveLength(1); // untouched by bob

        // Alice returns: her ARMED watch is back and fires again.
        SetupWatchService.reset();
        await SetupWatchService.init('alice');
        expect(SetupWatchService.getWatchForMessage('m-1')?.status).toBe('ARMED');
        const fires: string[] = [];
        SetupWatchService.subscribe(t => fires.push(t.watch.messageId));
        tick('BTCUSDT', 100);
        expect(fires).toEqual(['m-1']);
    });

    it('init for a DIFFERENT user reloads even without a preceding reset (no `initialized` early-return across users)', async () => {
        await SetupWatchService.init('alice');
        SetupWatchService.createWatch(watchFor('m-1'));
        await drain();

        await SetupWatchService.init('bob');
        expect(SetupWatchService.getAllWatches()).toHaveLength(0);
        // …and bob's teardown gave Alice's symbols back to the feed.
        expect(feed.untracked).toContain('BTCUSDT');
    });

    it('reset() clears memory and forces a real reload for the next init', async () => {
        await SetupWatchService.init('alice');
        SetupWatchService.createWatch(watchFor('m-1'));
        await drain();

        SetupWatchService.reset();
        expect(SetupWatchService.getAllWatches()).toHaveLength(0);

        // init('alice') again must re-read storage (the OLD `if (initialized)
        // return` made this a silent no-op after a switch).
        await SetupWatchService.init('alice');
        expect(SetupWatchService.getAllWatches()).toHaveLength(1);
    });

    it('a legacy GLOBAL blob is adopted once by the first loader', async () => {
        pref.data['setup_watches'] = [{
            id: 'w-old', messageId: 'm-old', coinName: 'BTC', symbol: 'BTCUSDT',
            triggerType: 'PRICE_ABOVE', priceLevel: 100, referencePrice: 95,
            status: 'ARMED', createdAt: new Date().toISOString(), triggerCount: 0,
        }];

        await SetupWatchService.init('dana');
        expect(SetupWatchService.getWatchForMessage('m-old')?.status).toBe('ARMED');
        await drain();
        expect(pref.data['setup_watches_v1_dana']).toHaveLength(1);

        // The blob moved out of the shared key into Dana's own partition.
        SetupWatchService.reset();
        await SetupWatchService.init('erin');
        expect(SetupWatchService.getAllWatches()).toHaveLength(0);
    });
});
