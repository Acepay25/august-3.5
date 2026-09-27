/**
 * The write mutex around the profile save.
 *
 * `sqliteSaveUserProfile` opens BEGIN TRANSACTION on the SHARED connection,
 * which cannot nest — so it must hold the write mutex itself. It did not:
 * correctness depended on every caller remembering to wrap the call in
 * `runExclusiveWrite`, and a caller that forgot produced either
 * "cannot start a transaction within a transaction" or two flows interleaving
 * (one flow's ROLLBACK discarding the other's uncommitted rows).
 *
 * The mutex is a plain promise chain with no async context, so nested
 * acquisition DEADLOCKS: the inner write queues behind a promise the outer
 * write is itself waiting on. The resolution is a `WritePermit` capability
 * issued to the body of a `runExclusiveWrite` and handed to the nested
 * writer, which then re-enters inline. These tests pin both halves:
 *   · with a permit  → the nested save completes (no deadlock) and is still
 *     fully serialized against a THIRD, unrelated flow;
 *   · without one    → a top-level save waits for the current holder instead
 *     of barging into its open transaction.
 *
 * The inverse is the footgun these tests also cover: a save issued from
 * INSIDE a runExclusiveWrite body that does NOT forward its permit queues
 * behind that body's own pending promise. dbService is the only such caller,
 * and tests/dbServiceWritePermit.test.ts pins that it forwards.
 *
 * This file uses the REAL SqliteServiceHelpers (unlike tests/sqliteService.
 * test.ts, which stubs the mutex out) and a fake connection that enforces
 * SQLite's real "no nested transaction" rule.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true },
}));

type Row = Record<string, unknown>;
const TABLE_NAMES = [
    'users', 'trades', 'conversations',
    'trade_summaries', 'saved_analyses', 'thinking_records', 'schema_migrations',
] as const;

/**
 * Minimal in-memory stand-in that behaves like SQLite where it matters for
 * this suite: BEGIN while a transaction is open THROWS (the exact error the
 * real connection raises), and ROLLBACK restores the pre-transaction rows.
 */
class FakeMutexDb {
    rows: Record<string, Row[]> = Object.fromEntries(TABLE_NAMES.map(t => [t, []]));

    /** Statements in issue order — proves WHO held the connection. */
    statements: string[] = [];
    /** Live test hook: awaited after every statement. */
    onExecute: ((sql: string) => Promise<void> | void) | null = null;

    private snapshot: Record<string, Row[]> | null = null;
    private inTransaction = false;

    open = async (): Promise<void> => undefined;

    private async record(sql: string): Promise<void> {
        this.statements.push(sql);
        if (this.onExecute) await this.onExecute(sql);
    }

    async execute(sql: string): Promise<void> {
        await this.record(sql);
        if (/BEGIN TRANSACTION/i.test(sql)) {
            if (this.inTransaction) {
                throw new Error('cannot start a transaction within a transaction');
            }
            this.inTransaction = true;
            this.snapshot = Object.fromEntries(
                TABLE_NAMES.map(t => [t, [...this.rows[t]]]),
            );
            return;
        }
        if (/COMMIT/i.test(sql)) {
            this.inTransaction = false;
            this.snapshot = null;
            return;
        }
        if (/ROLLBACK/i.test(sql)) {
            if (this.snapshot) {
                for (const table of TABLE_NAMES) this.rows[table] = this.snapshot[table];
            }
            this.inTransaction = false;
            this.snapshot = null;
        }
    }

    async run(sql: string, params: unknown[] = []): Promise<void> {
        await this.record(sql);
        const insert = sql.match(/INSERT OR REPLACE INTO (\w+)\s*\(([^)]+)\)\s*VALUES/i);
        if (insert) {
            const rows = this.rows[insert[1]] ?? (this.rows[insert[1]] = []);
            const row: Row = {};
            insert[2].split(',').map(c => c.trim())
                .forEach((c, i) => { row[c] = params[i]; });
            const at = rows.findIndex(r => r.id === row.id);
            if (at >= 0) rows[at] = row; else rows.push(row);
            return;
        }
        const del = sql.match(/DELETE FROM (\w+)\s+WHERE username = \?/i);
        if (del) {
            this.rows[del[1]] = (this.rows[del[1]] ?? []).filter(r => r.username !== params[0]);
        }
    }

    async query(sql: string, params: unknown[] = []): Promise<{ values: Row[] }> {
        await this.record(sql);
        if (/SELECT COALESCE\(MAX\(version\)/.test(sql)) return { values: [{ v: 0 }] };
        const ids = sql.match(/SELECT id FROM (\w+)\s+WHERE username = \?/i);
        if (ids) {
            return { values: (this.rows[ids[1]] ?? []).filter(r => r.username === params[0]).map(r => ({ id: r.id })) };
        }
        const star = sql.match(/SELECT \* FROM (\w+) WHERE (\w+) = \?/i);
        if (star) {
            const col = star[2];
            return { values: (this.rows[star[1]] ?? []).filter(r => r[col] === params[0]) };
        }
        if (/SELECT COUNT/.test(sql)) return { values: [{ count: 0 }] };
        return { values: [] };
    }
}

const fakeDb = new FakeMutexDb();

vi.mock('@capacitor-community/sqlite', () => ({
    CapacitorSQLite: {},
    SQLiteConnection: class {
        async checkConnectionsConsistency() { return { result: false }; }
        async isConnection() { return { result: false }; }
        async createConnection() { return fakeDb; }
    },
    SQLiteDBConnection: class {},
}));

import { initSqlite, sqliteSaveUserProfile, sqliteGetUserProfile } from '../services/infrastructure/SqliteService';
import { runExclusiveWrite } from '../services/infrastructure/SqliteServiceHelpers';
import type { UserProfile } from '../types';

/** Fails the test instead of hanging when a flow deadlocks. */
const withDeadline = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${label} did not settle — the write mutex deadlocked`)), 2000);
    });
    return Promise.race([promise, timeout]);
};

const release: { gate: () => void } = { gate: () => {} };
const gate = () => new Promise<void>((resolve) => { release.gate = resolve; });

const baseProfile = (username: string, extra: Partial<UserProfile> = {}): UserProfile => ({
    username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: { activeFrameworks: [] },
    conversations: [],
    tradeLog: [],
    tradeSummaries: [],
    savedAnalyses: [],
    finalTradeSummary: null,
    ...extra,
});

beforeEach(async () => {
    await initSqlite();
    fakeDb.rows = Object.fromEntries(TABLE_NAMES.map(t => [t, []]));
    fakeDb.statements = [];
    fakeDb.onExecute = null;
});

describe('sqliteSaveUserProfile takes the write mutex itself', () => {
    it('a lock-free caller cannot barge into a transaction another flow has open', async () => {
        const holder = gate();
        const holding = runExclusiveWrite(async () => { await holder; });

        // Let the holder take the queue, then save WITHOUT any permit — the
        // pre-fix call shape, which opened BEGIN while the holder was mid-flow.
        const saving = sqliteSaveUserProfile(baseProfile('bob'));
        await Promise.resolve();
        await Promise.resolve();

        expect(fakeDb.statements).not.toContain('BEGIN TRANSACTION');

        release.gate();
        await withDeadline(Promise.all([holding, saving]), 'the queued save');
        expect(fakeDb.statements.filter(s => s === 'BEGIN TRANSACTION')).toHaveLength(1);
    });

    it('a permit-holder\'s nested save completes and still excludes other flows', async () => {
        const order: string[] = [];
        // Flow A mirrors dbService.saveUserProfile exactly: a read-modify-write
        // under ONE lock, with the permit handed to the nested save.
        const flowA = runExclusiveWrite(async (permit) => {
            await sqliteGetUserProfile('bob');
            order.push('A:read');
            await sqliteSaveUserProfile(baseProfile('bob', { finalTradeSummary: 'A' }), permit);
            order.push('A:written');
        });
        // Flow B is an unrelated top-level writer. It must never interleave
        // with A's open transaction — and it holds no permit, because the
        // queue's tail is its own pending promise: a save issued from INSIDE a
        // lock without the permit would queue behind itself (see the note in
        // this suite's header).
        const flowB = runExclusiveWrite(async () => {
            order.push('B:start');
            await new Promise(r => setTimeout(r, 5));
            order.push('B:written');
        });

        await withDeadline(Promise.all([flowA, flowB]), 'the nested + competing flows');

        expect(order).toEqual(['A:read', 'A:written', 'B:start', 'B:written']);
        // Exactly one transaction at a time, and the rows landed.
        expect(fakeDb.statements.filter(s => s === 'BEGIN TRANSACTION')).toHaveLength(1);
        expect(fakeDb.rows.users.find(u => u.username === 'bob')?.finalTradeSummary).toBe('A');    });

    it('a failing save inside a lock releases the queue for the next writer', async () => {
        // A rejected write must not poison the chain (the old queue survived
        // failures; the new one does too, and the permit path is no exception).
        const failing = runExclusiveWrite(async (permit) => {
            fakeDb.onExecute = (sql) => { if (/BEGIN/i.test(sql)) throw new Error('disk full'); };
            await expect(withDeadline(
                sqliteSaveUserProfile(baseProfile('bob'), permit),
                'the failing save',
            )).rejects.toThrow('disk full');
            fakeDb.onExecute = null;
        });
        await withDeadline(failing, 'the failing flow');

        // The queue survived the rejection: a healthy write still runs.
        fakeDb.statements = [];
        await withDeadline(
            sqliteSaveUserProfile(baseProfile('carol', { finalTradeSummary: 'ok' })),
            'the write after the failure',
        );
        expect((await sqliteGetUserProfile('carol'))?.finalTradeSummary).toBe('ok');
    });
});

describe('runExclusiveWrite permit semantics', () => {
    it('serializes unrelated flows and hands each one its own permit', async () => {
        const seen: Array<{ held: boolean }> = [];
        const make = (ms: number) => runExclusiveWrite(async (permit) => {
            seen.push(permit);
            await new Promise(r => setTimeout(r, ms));
        });
        await withDeadline(Promise.all([make(20), make(0), make(10)]), 'three queued writes');
        expect(seen).toHaveLength(3);
        expect(seen.every(p => p.held === true)).toBe(true);
    });

    it('re-entry with a permit runs inline instead of queueing behind its own holder', async () => {
        const trace: string[] = [];
        await withDeadline(runExclusiveWrite(async (permit) => {
            trace.push('outer:start');
            await runExclusiveWrite(async () => { trace.push('inner'); }, permit);
            trace.push('outer:end');
        }), 'the re-entrant write');
        expect(trace).toEqual(['outer:start', 'inner', 'outer:end']);
    });
});
