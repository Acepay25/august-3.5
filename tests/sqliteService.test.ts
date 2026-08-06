import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the native path and stub the capacitor SQLite layer with an
// in-memory stand-in so initSqlite wires the module connection to a fake.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

/**
 * In-memory SQLite stand-in covering the statements SqliteService issues:
 * CREATE/ALTER (swallowed), BEGIN/COMMIT/ROLLBACK, INSERT OR REPLACE with
 * named column lists, DELETE with optional IN filters, and SELECT * / COUNT
 * / MAX queries.
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

  // initSqlite calls db.open() after wiring the module connection.
  open = async (): Promise<void> => undefined;

  async execute(sql: string): Promise<void> {
    // DDL + transaction control are no-ops in the fake.
    return;
  }

  async run(sql: string, params: any[] = []): Promise<void> {
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

    const del = sql.match(/DELETE FROM (\w+)\s+WHERE username = \?(?:\s+AND id NOT IN \(([^)]*)\))?/i);
    if (del) {
      const table = del[1];
      const username = params[0];
      const keptIds = del[2]
        ? params.slice(1).map(p => String(p))
        : null;
      this.rows[table] = this.rows[table].filter(r => {
        if (r.username !== username) return true;
        if (keptIds === null) return false;
        return keptIds.includes(String(r.id));
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
