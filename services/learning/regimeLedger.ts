/**
 * Regime ledger — one line per coin × day of the market regime the harness
 * observed (Phase 3).
 *
 * The Macro lens is the regime seat, but until this ledger existed it had no
 * memory: it could not say "BTC has spent 58% of the last 90 days ranging,
 * and the current ranging stretch is day 4". recordRegimeDay is called by the
 * analysis pipeline whenever fresh hybrid data names a regime; entries are
 * deduped per coin × day (same-day re-observations overwrite).
 *
 * Persistence rides Preferences (regime_ledger_v1_<user>), bounded. A small
 * module-level cache mirrors the last hydrated user so prompt-side readers
 * (regimeSummaryBlock, doctrine) stay synchronous — hydrateRegimeLedger runs
 * at boot and recordRegimeDay keeps the cache warm on every write.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';

export type LedgerRegime = 'trending' | 'ranging' | 'volatile' | 'compression';

export interface RegimeDay {
    /** YYYY-MM-DD (UTC). */
    date: string;
    /** Normalized coin (BTC, ETH — no USDT suffix). */
    coin: string;
    regime: LedgerRegime;
    source: 'hybrid' | 'inferred';
}

export interface RegimeSummary {
    currentRegime: LedgerRegime | null;
    /** Consecutive calendar days (ending today/latest) in currentRegime. */
    currentStreak: number;
    /** Share of windowed days per regime, percentages summing to ~100. */
    distribution: Partial<Record<LedgerRegime, number>>;
    /** Days observed inside the window. */
    samples: number;
}

const KEY_PREFIX = 'regime_ledger_v1_';
/** Bounded history: ~2 years of daily observations for two coins. */
const MAX_ENTRIES = 1500;

const REGIMES: LedgerRegime[] = ['trending', 'ranging', 'volatile', 'compression'];

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

/** Normalize a coin symbol to the ledger's canonical form (BTC, not BTCUSDT). */
export const normalizeLedgerCoin = (coin: string): string =>
    (coin || '').toUpperCase().replace(/USDT?$/, '').replace(/USD$/, '').trim();

const isLedgerRegime = (v: unknown): v is LedgerRegime =>
    typeof v === 'string' && (REGIMES as string[]).includes(v);

/**
 * Map a raw market-regime label (the hybrid pipeline's `MarketRegime`, e.g.
 * 'strong_trend_up' / 'volatile_chop') onto the ledger's four canonical
 * regimes. Returns null for labels that carry no regime signal. Without this
 * the ledger would silently drop every trend/volatile observation, since only
 * 'ranging' and 'compression' pass through isLedgerRegime unchanged.
 */
export const marketRegimeToLedger = (raw: string | undefined | null): LedgerRegime | null => {
    if (!raw) return null;
    const r = String(raw).toLowerCase();
    if (isLedgerRegime(r)) return r;
    if (r.includes('trend')) return 'trending';
    if (r.includes('volatil') || r.includes('chop')) return 'volatile';
    if (r.includes('rang')) return 'ranging';
    if (r.includes('compress') || r.includes('squeeze')) return 'compression';
    return null;
};

// ── Module cache (sync reads for prompt assembly) ──────────────────────
let cache: RegimeDay[] = [];
let cacheUser: string | null = null;

/** Load one user's ledger into the sync cache. Best-effort. */
export const hydrateRegimeLedger = async (username: string): Promise<void> => {
    try {
        const raw = await getPreferenceObject<RegimeDay[]>(keyFor(username));
        cache = Array.isArray(raw)
            ? raw.filter(e => e && typeof e.date === 'string' && typeof e.coin === 'string' && isLedgerRegime(e.regime))
            : [];
        cacheUser = username;
    } catch {
        cache = [];
        cacheUser = username;
    }
};

/** Record (or same-day overwrite) one regime observation. Best-effort:
 *  telemetry must never break the analysis path. */
export const recordRegimeDay = async (
    day: { date?: string; coin: string; regime: string; source?: 'hybrid' | 'inferred' },
    username: string,
): Promise<void> => {
    const coin = normalizeLedgerCoin(day.coin);
    if (!coin || !isLedgerRegime(day.regime)) return;
    const date = day.date || new Date().toISOString().slice(0, 10);
    try {
        const list = (await getPreferenceObject<RegimeDay[]>(keyFor(username))) ?? [];
        const kept = Array.isArray(list)
            ? list.filter(e => !(e.coin === coin && e.date === date))
            : [];
        kept.push({ date, coin, regime: day.regime, source: day.source ?? 'hybrid' });
        kept.sort((a, b) => a.date.localeCompare(b.date));
        await setPreferenceObject(keyFor(username), kept.slice(-MAX_ENTRIES));
        if (cacheUser === username) {
            cache = [...kept.filter(e => !(e.coin === coin && e.date === date)), { date, coin, regime: day.regime, source: day.source ?? 'hybrid' }]
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(-MAX_ENTRIES);
        }
    } catch { /* best-effort */ }
};

/** Distinct coins in the sync cache, alphabetical. */
export const listLedgerCoins = (): string[] =>
    [...new Set(cache.map(e => e.coin))].sort();

const shiftDays = (isoDate: string, days: number): string => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
};

/**
 * Summarize one coin's regime history from the sync cache. `days` bounds the
 * window; the streak counts consecutive calendar days in the current regime
 * ending at the newest observation. Returns an empty summary when the cache
 * holds nothing for the coin (callers render nothing, never an error).
 */
export const getRegimeSummary = (coin: string, days = 90): RegimeSummary => {
    const empty: RegimeSummary = { currentRegime: null, currentStreak: 0, distribution: {}, samples: 0 };
    const norm = normalizeLedgerCoin(coin);
    if (!norm) return empty;
    const mine = cache.filter(e => e.coin === norm);
    if (mine.length === 0) return empty;
    const sorted = [...mine].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const cutoff = shiftDays(latest.date, days);
    const windowed = sorted.filter(e => e.date >= cutoff);

    const distribution: Partial<Record<LedgerRegime, number>> = {};
    for (const r of REGIMES) {
        const n = windowed.filter(e => e.regime === r).length;
        if (n > 0) distribution[r] = Math.round((n / windowed.length) * 100);
    }

    // Streak: walk backward from the newest observation; each step must be
    // the previous calendar day AND the same regime.
    const byDate = new Map(windowed.map(e => [e.date, e]));
    let streak = 0;
    let cursor = latest.date;
    while (byDate.get(cursor)?.regime === latest.regime) {
        streak += 1;
        cursor = shiftDays(cursor, 1);
    }

    return { currentRegime: latest.regime, currentStreak: streak, distribution, samples: windowed.length };
};

/**
 * One-line prompt block for the Macro lens (the regime seat), capped at
 * `max` chars. '' when the ledger has nothing on this coin.
 */
export const regimeSummaryBlock = (coin: string | undefined, days = 90, max = 150): string => {
    if (!coin) return '';
    const s = getRegimeSummary(coin, days);
    if (!s.currentRegime || s.samples === 0) return '';
    const mix = Object.entries(s.distribution)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .map(([r, pct]) => `${r} ${pct}%`)
        .join(' / ');
    const line = `REGIME LEDGER (${normalizeLedgerCoin(coin)}, last ${days}d, ${s.samples} observed days): ${s.currentRegime} now (day ${s.currentStreak} of this stretch) · mix: ${mix}`;
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};
