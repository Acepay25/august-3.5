import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeRule, LearningRulesStorage } from '../services/learning/LearningRulesService';
import { LearningRule } from '../types/learning';

// StorageService delegates profile reads to dbService (IndexedDB) — mock the
// delegation so the test focuses on the raw last_active_user read.
vi.mock('../services/infrastructure/dbService', () => ({
  getUserProfile: vi.fn(async () => ({ tradeLog: [] })),
}));

import { storageService } from '../services/infrastructure/StorageService';

const makeRule = (overrides: Partial<LearningRule> = {}): LearningRule => ({
  id: `rule-${Math.random().toString(36).slice(2, 10)}`,
  ifCondition: 'BTCUSDT + Long + Breakout',
  thenAction: 'Apply extra scrutiny - similar setup recently lost',
  sourceTradeId: 'trade-1',
  outcome: 'LOSS',
  coin: 'BTCUSDT',
  pattern: 'Breakout',
  direction: 'Long',
  createdAt: new Date().toISOString(),
  useCount: 0,
  ...overrides,
});

const emptyStorage = (): LearningRulesStorage => ({
  version: 2,
  rules: [],
  lastUpdated: new Date().toISOString(),
});

describe('storeRule — outcome-aware dedupe', () => {
  it('stores a LOSS rule with the same text as an existing WIN rule', () => {
    const storage = storeRule(emptyStorage(), makeRule({ outcome: 'WIN' }));
    const withLoss = storeRule(storage, makeRule({ outcome: 'LOSS' }));

    expect(withLoss.rules).toHaveLength(2);
    expect(withLoss.rules.filter(r => r.outcome === 'LOSS')).toHaveLength(1);
  });

  it('still dedupes an identical rule with the same outcome', () => {
    const storage = storeRule(emptyStorage(), makeRule());
    const again = storeRule(storage, makeRule());

    expect(again.rules).toHaveLength(1);
  });
});

describe('storeRule — value-based pruning', () => {
  it('evicts low-value rules instead of the oldest (value over insertion order)', () => {
    // Seed at the cap: 99 unused LOSS rules (score 10) + 1 unused WIN (score 5).
    // Each has a distinct condition so the dedupe check can't block the add.
    const storage: LearningRulesStorage = {
      ...emptyStorage(),
      rules: Array.from({ length: 99 }, (_, i) =>
        makeRule({ id: `loss-${i}`, ifCondition: `LOSS-IF-${i}`, useCount: 0 })
      ).concat([makeRule({ id: 'win-0', outcome: 'WIN', ifCondition: 'WIN-IF-0', useCount: 0 })]),
    };

    // Adding a USED LOSS rule (useCount 5 → score 15) pushes past the cap.
    // The old newest-100 pruning dropped loss-0 (oldest); value-based pruning
    // must drop the unused WIN first.
    const result = storeRule(storage, makeRule({ id: 'used-loss', ifCondition: 'USED-LOSS-IF', useCount: 5 }));

    expect(result.rules).toHaveLength(100);
    expect(result.rules.some(r => r.id === 'used-loss')).toBe(true);
    expect(result.rules.some(r => r.id === 'win-0')).toBe(false);
    // The oldest LOSS rule survives — value beats insertion order.
    expect(result.rules.some(r => r.id === 'loss-0')).toBe(true);
  });
});

describe('storageService — per-user learning rules', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('scopes rules by the active user', () => {
    localStorage.setItem('last_active_user', 'alice');
    storageService.saveLearningRules({ version: 2, rules: [makeRule()], lastUpdated: new Date().toISOString() });

    localStorage.setItem('last_active_user', 'bob');
    expect(storageService.loadLearningRules().rules).toHaveLength(0);

    localStorage.setItem('last_active_user', 'alice');
    expect(storageService.loadLearningRules().rules).toHaveLength(1);
  });

  it('migrates the legacy unscoped key exactly once', () => {
    // Simulate a pre-upgrade install: unscoped key with data, no scoped key.
    const legacyData = { version: 2, rules: [makeRule()], lastUpdated: new Date().toISOString() };
    localStorage.setItem('learning_rules_v2', JSON.stringify(legacyData));
    localStorage.setItem('last_active_user', 'carol');

    const first = storageService.loadLearningRules();
    expect(first.rules).toHaveLength(1);
    // Legacy key removed after migration.
    expect(localStorage.getItem('learning_rules_v2')).toBeNull();

    // A second user must NOT inherit the migrated snapshot.
    localStorage.setItem('last_active_user', 'dave');
    expect(storageService.loadLearningRules().rules).toHaveLength(0);
  });

  it('reads getTradeLogs for the raw last_active_user value', async () => {
    // App writes last_active_user with setItem (RAW string, not JSON).
    localStorage.setItem('last_active_user', 'zed');
    const logs = await storageService.getTradeLogs();
    expect(Array.isArray(logs)).toBe(true);
  });
});
