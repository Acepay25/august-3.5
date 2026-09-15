import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the native path and stub the capacitor SQLite layer with an
// in-memory stand-in so initSqlite wires the module connection to a fake.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

/**
 * In-memory SQLite stand-in covering the statements SqliteService issues:
 * CREATE/ALTER (swallowed), BEGIN/COMMIT/ROLLBACK (writes are snapshotted on
 * BEGIN and restored on ROLLBACK, mirroring real transaction semantics),
 * INSERT OR REPLACE with named column lists, DELETE with optional
 * (NOT) IN filters, and SELECT * / SELECT id / COUNT / MAX queries.
 * `failNext` injects a one-shot failure for any statement matching the
 * regex, for testing rollback paths.
 */
class FakeSqliteDb {
  rows: Record<string, Array<Record<string, any>>> = {
    users: [],
    trades: [],
    conversations: [],
    trade_summaries: [],
    saved_analyses: [],
    thinking_records: [],
    schema_migrations: [],
  };

  // One-shot failure injection: any execute()/run() whose SQL matches this
  // regex throws once (then the armed failure clears).
  failNext: RegExp | null = null;
  // Every statement passed to run(), for asserting emitted SQL.
  runLog: string[] = [];

  private snapshot: Record<string, Array<Record<string, any>>> | null = null;

  // initSqlite calls db.open() after wiring the module connection.
  open = async (): Promise<void> => undefined;

  private maybeFail(sql: string): void {
    if (this.failNext && this.failNext.test(sql)) {
      this.failNext = null;
      throw new Error('injected failure');
    }
  }

  async execute(sql: string): Promise<void> {
    this.maybeFail(sql);
    if (/BEGIN TRANSACTION/i.test(sql)) {
      this.snapshot = JSON.parse(JSON.stringify(this.rows));
      return;
    }
    if (/ROLLBACK/i.test(sql)) {
      if (this.snapshot) this.rows = this.snapshot;
      this.snapshot = null;
      return;
    }
    if (/COMMIT/i.test(sql)) {
      this.snapshot = null;
      return;
    }
    // DDL is a no-op in the fake.
    return;
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    this.maybeFail(sql);
    this.runLog.push(sql);

    const insert = sql.match(/INSERT OR REPLACE INTO (\w+)\s*\(([^)]+)\)\s*VALUES/i);
    if (insert) {
      const table = insert[1];
      const cols = insert[2].split(',').map(c => c.trim());
      const row: Record<string, any> = {};
      cols.forEach((c, i) => {
        const v = params[i];
        if (v !== null && v !== undefined) row[c] = v;
      });
      const existing = this.rows[table].findIndex(r => r.id === row.id);
      if (existing >= 0) this.rows[table][existing] = row;
      else this.rows[table].push(row);
      return;
    }

    const del = sql.match(/DELETE FROM (\w+)\s+WHERE username = \?(?:\s+AND id (NOT )?IN \(([^)]*)\))?/i);
    if (del) {
      const table = del[1];
      const username = params[0];
      const notIn = del[2] !== undefined;
      const idList = del[3] ? params.slice(1).map(p => String(p)) : null;
      this.rows[table] = this.rows[table].filter(r => {
        if (r.username !== username) return true;
        if (idList === null) return false; // delete-all for this user
        const inList = idList.includes(String(r.id));
        // NOT IN (…) keeps listed ids; IN (…) removes listed ids.
        return notIn ? inList : !inList;
      });
      return;
    }

    const simpleDelete = sql.match(/DELETE FROM (\w+) WHERE (\w+) = \?/i);
    if (simpleDelete) {
      const table = simpleDelete[1];
      const col = simpleDelete[2];
      this.rows[table] = this.rows[table].filter(r => r[col] !== params[0]);
      return;
    }
  }

  async query(sql: string, params: any[] = []): Promise<{ values: any[] }> {
    if (/SELECT COUNT\(\*\)/.test(sql)) {
      const table = sql.match(/FROM (\w+)/)?.[1] || '';
      const username = params[0];
      return { values: [{ count: this.rows[table].filter(r => r.username === username).length }] };
    }
    if (/SELECT COALESCE\(MAX\(version\)/.test(sql)) {
      const applied = this.rows.schema_migrations.map(r => r.version);
      return { values: [{ v: applied.length > 0 ? Math.max(...applied) : 0 }] };
    }
    const selectIds = sql.match(/SELECT id FROM (\w+)\s+WHERE username = \?/i);
    if (selectIds) {
      const table = selectIds[1];
      return { values: this.rows[table].filter(r => r.username === params[0]).map(r => ({ id: r.id })) };
    }
    const select = sql.match(/SELECT \* FROM (\w+)\s+WHERE (\w+) = \?/i);
    if (select) {
      const table = select[1];
      const col = select[2];
      return { values: this.rows[table].filter(r => r[col] === params[0]) };
    }
    return { values: [] };
  }
}

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class {
    async checkConnectionsConsistency() {
      return { result: false };
    }
    async isConnection() {
      return { result: false };
    }
    async createConnection() {
      return fakeDb;
    }
  },
  SQLiteDBConnection: class {},
}));

vi.mock('../services/infrastructure/SqliteServiceHelpers', async () => {
  const actual = await vi.importActual<typeof import('../services/infrastructure/SqliteServiceHelpers')>('../services/infrastructure/SqliteServiceHelpers');
  return {
    ...actual,
    runExclusiveWrite: (fn: () => Promise<any>) => fn(),
  };
});

import { initSqlite } from '../services/infrastructure/SqliteService';
import * as sqlite from '../services/infrastructure/SqliteService';
import { UserProfile } from '../types';

const fakeDb = new FakeSqliteDb();

const baseProfile = (username: string): UserProfile => ({
  username,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  settings: { activeFrameworks: [] },
  conversations: [],
  tradeLog: [],
  tradeSummaries: [],
  savedAnalyses: [],
  finalTradeSummary: null,
});

const trade = (id: string, outcome: string) => ({
  id,
  timestamp: new Date().toISOString(),
  outcome,
  analysis: {
    direction: 'Long',
    coinName: 'BTCUSDT',
    entryPoints: [{ price: '95000', description: 'entry' }],
    stopLoss: '94000',
    takeProfit: [{ price: '96000', percentage: '100%' }],
  },
  leverage: 100,
});

beforeEach(async () => {
  fakeDb.rows = {
    users: [],
    trades: [],
    conversations: [],
    trade_summaries: [],
    saved_analyses: [],
    thinking_records: [],
    schema_migrations: [],
  };
  fakeDb.failNext = null;
  fakeDb.runLog = [];
  await initSqlite();
});

describe('SqliteService profile persistence', () => {
  it('round-trips a profile with trades, summaries and saved analyses', async () => {
    const profile: UserProfile = {
      ...baseProfile('bob'),
      tradeLog: [trade('t1', 'WIN') as any, trade('t2', 'LOSS') as any],
      tradeSummaries: [{ id: 's1', summaryText: 'good setup', timestamp: new Date().toISOString() }],
      savedAnalyses: [{ id: 'a1', analysis: trade('t1', 'WIN').analysis as any, userPrompt: 'chart', timestamp: new Date().toISOString() }],
    };

    await sqlite.sqliteSaveUserProfile(profile);

    const loaded = await sqlite.sqliteGetUserProfile('bob');
    expect(loaded?.tradeLog).toHaveLength(2);
    expect(loaded?.tradeLog.find(t => t.id === 't1')?.outcome).toBe('WIN');
    expect(loaded?.tradeSummaries[0].summaryText).toBe('good setup');
    expect(loaded?.savedAnalyses[0].userPrompt).toBe('chart');
  });

  it('deletes rows absent from the saved profile (deletion sync)', async () => {
    await sqlite.sqliteSaveUserProfile({
      ...baseProfile('bob'),
      tradeLog: [trade('t1', 'WIN') as any, trade('t2', 'LOSS') as any, trade('t3', 'WIN') as any],
    });
    // Re-save with t2 removed (e.g. user deleted it).
    await sqlite.sqliteSaveUserProfile({
      ...baseProfile('bob'),
      tradeLog: [trade('t1', 'WIN') as any, trade('t3', 'WIN') as any],
    });

    const loaded = await sqlite.sqliteGetUserProfile('bob');
    const ids = loaded?.tradeLog.map(t => t.id);
    expect(ids).toEqual(['t1', 't3']);
  });

  it('survives a corrupt JSON cell without aborting the whole load', async () => {
    await sqlite.sqliteSaveUserProfile({
      ...baseProfile('bob'),
      tradeLog: [trade('t1', 'WIN') as any],
    });
    // Corrupt the stored analysis blob directly (simulates an interrupted write).
    fakeDb.rows.trades[0].analysis = '{truncated-json';

    const loaded = await sqlite.sqliteGetUserProfile('bob');
    expect(loaded).not.toBeNull();
    expect(loaded?.tradeLog).toHaveLength(1);
    expect(loaded?.tradeLog[0].analysis).toBeUndefined();
  });

  it('deletes a user across all tables including thinking records', async () => {
    await sqlite.sqliteSaveUserProfile({
      ...baseProfile('bob'),
      tradeLog: [trade('t1', 'WIN') as any],
      conversations: [{ id: 'c1', title: 'conv', timestamp: Date.now(), messages: [], ocrModel: '', moderatorProviderId: '', moderatorModel: '', leverage: 100 } as any],
    });
    fakeDb.rows.thinking_records.push({ id: 'think-1', username: 'bob', tradeId: 't1' });

    await sqlite.sqliteDeleteUser('bob');

    expect(fakeDb.rows.users).toHaveLength(0);
    expect(fakeDb.rows.trades).toHaveLength(0);
    expect(fakeDb.rows.conversations).toHaveLength(0);
    expect(fakeDb.rows.thinking_records).toHaveLength(0);
    expect(await sqlite.sqliteGetUserProfile('bob')).toBeNull();
  });
});

describe('SqliteService deleteAbsentRows with >400 rows', () => {
  // Regression: the old implementation looped `DELETE ... AND id NOT IN
  // (chunk)` over 400-ID chunks — every chunk's delete treated only that
  // chunk as the retained set, destroying all rows in the other chunks
  // whenever the collection exceeded 400 ids.
  const idsOf = (table: Array<Record<string, any>>, username: string): string[] =>
    table.filter(r => r.username === username).map(r => r.id).sort();

  const saveTrades = (ids: string[]) => sqlite.sqliteSaveUserProfile({
    ...baseProfile('bob'),
    tradeLog: ids.map(id => trade(id, 'WIN') as any),
  });

  it.each([401, 800, 1000])(
    'dirty save of %i rows keeps every present row and deletes only the absent id',
    async (count) => {
      const ids = Array.from({ length: count }, (_, i) => `t${i}`);
      await saveTrades(ids);
      expect(fakeDb.rows.trades).toHaveLength(count);

      // Re-save with t0 removed (a legitimate "dirty save" over one chunk).
      await saveTrades(ids.slice(1));

      const remaining = idsOf(fakeDb.rows.trades, 'bob');
      expect(remaining).toHaveLength(count - 1);
      expect(remaining).not.toContain('t0');
      // Every retained id survived — the old NOT IN chunking wiped the
      // chunks after the first one entirely.
      expect(remaining).toEqual(ids.slice(1).sort());
    }
  );

  it('deletes many absent ids in ≤400-placeholder chunks without touching other users', async () => {
    const bobIds = Array.from({ length: 1000 }, (_, i) => `b${i}`);
    await saveTrades(bobIds);
    // A second user's rows must survive bob's deletion sync untouched.
    fakeDb.rows.trades.push({ id: 'a1', username: 'alice' }, { id: 'a2', username: 'alice' });

    // Keep only the first 400 → 600 stale ids → two DELETE chunks (400 + 200).
    await saveTrades(bobIds.slice(0, 400));

    expect(idsOf(fakeDb.rows.trades, 'bob')).toEqual(bobIds.slice(0, 400).sort());
    expect(idsOf(fakeDb.rows.trades, 'alice')).toEqual(['a1', 'a2']);

    const inDeletes = fakeDb.runLog.filter(s => /AND id IN \(/i.test(s));
    expect(inDeletes).toHaveLength(2);
    for (const sql of inDeletes) {
      const placeholders = sql.match(/IN \(([^)]*)\)/)?.[1] || '';
      expect(placeholders.split(',').length).toBeLessThanOrEqual(400);
    }
  });

  it('short-circuits without any DELETE when nothing is absent (empty diff)', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `t${i}`);
    await saveTrades(ids);
    fakeDb.runLog = [];

    // Same trades but a changed summary field → section rewrites, zero stale.
    await sqlite.sqliteSaveUserProfile({
      ...baseProfile('bob'),
      finalTradeSummary: 'changed',
      tradeLog: ids.map(id => ({ ...trade(id, 'WIN'), outcome: id === 't0' ? 'LOSS' : 'WIN' }) as any),
    });

    expect(fakeDb.runLog.some(s => /DELETE FROM trades/i.test(s))).toBe(false);
    expect(idsOf(fakeDb.rows.trades, 'bob')).toHaveLength(450);
  });
});

describe('SqliteService fingerprint publishing after COMMIT', () => {
  // Regression: lastSavedSections used to be updated INSIDE the open
  // transaction. A mid-transaction failure ROLLBACKed the DB but left the
  // fingerprints behind, so the next save's dirty-section gate skipped the
  // section whose rows never actually landed — silent permanent data loss.

  it('retry after a mid-transaction failure persists the rolled-back section', async () => {
    const profile: UserProfile = {
      ...baseProfile('bob'),
      tradeLog: [trade('t1', 'WIN') as any, trade('t2', 'LOSS') as any],
      conversations: [{ id: 'c1', title: 'conv', timestamp: Date.now(), messages: [], ocrModel: '', moderatorProviderId: '', moderatorModel: '', leverage: 100 } as any],
    };

    // Trades write first, then the conversations INSERT blows up mid-txn.
    fakeDb.failNext = /INSERT OR REPLACE INTO conversations/i;
    await expect(sqlite.sqliteSaveUserProfile(profile)).rejects.toThrow('injected failure');
    // The fake honors rollback semantics: nothing persisted.
    expect(fakeDb.rows.trades).toHaveLength(0);
    expect(fakeDb.rows.conversations).toHaveLength(0);

    // Retry with the IDENTICAL profile: with the bug, the trades fingerprint
    // was already "saved", so the gate would skip rewriting trades forever.
    await sqlite.sqliteSaveUserProfile(profile);

    const loaded = await sqlite.sqliteGetUserProfile('bob');
    expect(loaded?.tradeLog.map(t => t.id).sort()).toEqual(['t1', 't2']);
    expect(loaded?.conversations.map(c => c.id)).toEqual(['c1']);
  });

  it('a failing COMMIT still leaves fingerprints unpublished', async () => {
    const profile: UserProfile = {
      ...baseProfile('bob'),
      tradeLog: [trade('t1', 'WIN') as any],
    };

    fakeDb.failNext = /COMMIT/i;
    await expect(sqlite.sqliteSaveUserProfile(profile)).rejects.toThrow('injected failure');
    // ROLLBACK restored the pre-transaction (empty) state.
    expect(fakeDb.rows.trades).toHaveLength(0);

    // Retry succeeds and the trade lands — the dirty-section gate must not
    // have swallowed it on the strength of an uncommitted fingerprint.
    await sqlite.sqliteSaveUserProfile(profile);
    const loaded = await sqlite.sqliteGetUserProfile('bob');
    expect(loaded?.tradeLog.map(t => t.id)).toEqual(['t1']);
  });
});
