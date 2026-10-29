/**
 * signalLedger — the append-only record of emitted signals and their
 * resolutions.
 *
 * STORAGE. One localStorage namespace per user (`signal_ledger_v1:<user>`),
 * the same local-first path the notebook and the learning stores use; the
 * backup sweep already walks every scoped key, and the namespace is registered
 * in `ExportService` on both the export and restore lists so a backup carries
 * it (see RAW_LOCAL_STORAGE_PREFIXES / RESTORABLE_PREFERENCE_KEY_PREFIXES).
 *
 * APPEND-ONLY. An emission, each shadow check and the resolution are separate
 * events; nothing is rewritten. The store refuses a second resolution for the
 * same signal, so a later re-settlement cannot quietly improve the record.
 * The only mutation is the CAP: the oldest complete signals (every event of
 * theirs) are dropped together, never an event in isolation.
 *
 * CAP. 150 signals or 200 KiB of JSON, whichever binds first — a resolution
 * event is small, but the whole store must stay far inside a backup's byte
 * budget and the shared 5 MiB origin quota.
 */

import type { SignalEvent, SignalRow, SignalResolution } from '../../types/signal';
import { getActiveUsername } from '../../utils/activeUser';

export const SIGNAL_LEDGER_KEY = 'signal_ledger_v1';
export const MAX_SIGNALS = 150;
export const LEDGER_BYTE_CAP = 200 * 1024;

export const signalLedgerKey = (user: string = getActiveUsername()): string =>
    `${SIGNAL_LEDGER_KEY}:${user}`;

const isEvent = (value: unknown): value is SignalEvent => {
    if (!value || typeof value !== 'object') return false;
    const e = value as Partial<SignalEvent>;
    return e.v === 1
        && typeof e.id === 'string' && e.id.length > 0
        && typeof e.at === 'number'
        && (e.type === 'emit' || e.type === 'gate' || e.type === 'ground' || e.type === 'resolve');
};

export const readSignalEvents = (user: string = getActiveUsername()): SignalEvent[] => {
    try {
        const raw = localStorage.getItem(signalLedgerKey(user));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isEvent);
    } catch {
        // An unreadable ledger is not an empty one, but there is nothing to
        // return that would be truthful. `appendSignalEvent` overwrites only
        // after this read, so a corrupt store is preserved on disk until a
        // write. Callers show "no signals yet"; the record's own bytes remain.
        return [];
    }
};

/** Drop whole signals, oldest first, until the count and byte caps hold. */
export const pruneLedgerEvents = (events: readonly SignalEvent[], byteCap: number = LEDGER_BYTE_CAP): SignalEvent[] => {
    let kept = [...events];
    const idsInOrder = (): string[] => {
        const seen = new Map<string, number>();
        for (const e of kept) {
            if (!seen.has(e.id)) seen.set(e.id, e.type === 'emit' && e.signal ? e.signal.emittedAt : e.at);
        }
        return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    };
    const overCap = (): boolean => {
        const ids = new Set(kept.map(e => e.id));
        return ids.size > MAX_SIGNALS || JSON.stringify(kept).length > byteCap;
    };
    while (kept.length > 0 && overCap()) {
        const oldest = idsInOrder()[0];
        kept = kept.filter(e => e.id !== oldest);
    }
    return kept;
};

export interface LedgerWrite {
    ok: boolean;
    error?: string;
    events?: SignalEvent[];
}

/**
 * Append one event. Refuses a second `emit` or a second `resolve` for the same
 * id, and a duplicate shadow check of the same kind — the ledger's whole claim
 * is that history is not rewritten.
 */
export const appendSignalEvent = (event: SignalEvent, user: string = getActiveUsername()): LedgerWrite => {
    const events = readSignalEvents(user);
    const mine = events.filter(e => e.id === event.id);
    if (event.type === 'emit' && mine.some(e => e.type === 'emit')) {
        return { ok: false, error: 'a signal with this id already exists' };
    }
    if (event.type === 'resolve' && mine.some(e => e.type === 'resolve')) {
        return { ok: false, error: 'this signal is already resolved' };
    }
    if ((event.type === 'gate' || event.type === 'ground') && mine.some(e => e.type === event.type)) {
        return { ok: false, error: `this signal already has a ${event.type} event` };
    }
    const next = pruneLedgerEvents([...events, event]);
    try {
        localStorage.setItem(signalLedgerKey(user), JSON.stringify(next));
        // Read back: a quota failure can throw on write, but a backend that
        // silently drops bytes would otherwise report a save that never landed.
        const back = localStorage.getItem(signalLedgerKey(user));
        if (back !== JSON.stringify(next)) {
            return { ok: false, error: 'the ledger write could not be read back' };
        }
        return { ok: true, events: next };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
};

export const foldSignals = (events: readonly SignalEvent[]): SignalRow[] => {
    const byId = new Map<string, SignalRow>();
    for (const event of events) {
        if (event.type !== 'emit') continue;
        byId.set(event.id, { signal: event.signal, status: 'open' });
    }
    for (const event of events) {
        const row = byId.get(event.id);
        if (!row) continue;
        if (event.type === 'gate') row.gate = event.gate;
        else if (event.type === 'ground') row.grounding = event.grounding;
        else if (event.type === 'resolve') {
            row.resolution = event.resolution;
            row.status = event.resolution.status;
        }
    }
    return [...byId.values()].sort((a, b) => b.signal.emittedAt - a.signal.emittedAt);
};

export const readSignals = (user: string = getActiveUsername()): SignalRow[] =>
    foldSignals(readSignalEvents(user));

export const recordSignalResolution = (
    signalId: string,
    resolution: SignalResolution,
    user: string = getActiveUsername(),
): LedgerWrite => appendSignalEvent(
    { v: 1, type: 'resolve', at: resolution.at, id: signalId, resolution },
    user,
);

/** Test-only: wipe the namespace for one user. */
export const __clearSignalLedgerForTests = (user: string = getActiveUsername()): void => {
    try { localStorage.removeItem(signalLedgerKey(user)); } catch { /* no storage */ }
};
