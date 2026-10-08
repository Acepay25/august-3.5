import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
  getPreference: vi.fn(async (key: string) => store[key] ?? null),
  getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
      const raw = store[key];
      if (!Array.isArray(raw)) return [];
      return guard ? raw.filter(guard) : raw;
  }),
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  setPreference: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  removePreference: vi.fn(async (key: string) => {
    delete store[key];
  }),
}));

import { initMemoryFiles, createMemoryFile, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { getMemoryFilesContext } from '../services/learning/MemoryRetrievalService';
import { buildMemoryGraph } from '../services/learning/MemoryGraph';

describe('Memory graph retrieval', () => {
  beforeEach(async () => {
    store = {};
    await initMemoryFiles('graph-user');
  });

  it('links a user ranging playbook to the ranging dimension and not to an unrelated coin', async () => {
    // ranging-day.md is no longer seeded (unread template), so the graph
    // test creates its own playbook in market-conditions.
    const folder = getMemoryFiles().folders.find(f => f.name === 'market-conditions')!;
    await createMemoryFile(folder.id, 'ranging-day.md', `# Ranging / Low-ADX Day Playbook

When the market is ranging (ADX < 20, price inside a 2×ATR range):
- Trade the range edges, not the middle. Buy support, sell resistance.
- Take profit at the opposite edge — do not expect a breakout.
- If a range-edge candle closes beyond the level, the range may be breaking — stand aside.`, 'graph-user', true);
    const graph = buildMemoryGraph({ coin: 'ETHUSDT', direction: 'Long', regime: 'trending' });
    const ranging = [...graph.nodes.values()].find(n => n.path === 'market-conditions/ranging-day.md');
    expect(ranging).toBeDefined();
    const applies = graph.edges.filter(e => e.from === ranging!.id && e.kind === 'appliesWhen');
    expect(applies.some(e => e.to.includes('ranging'))).toBe(true);
    // The EDGE is the claim under test (a trending setup does not link to a
    // ranging playbook). This used to read `walkMemoryNeighbors`, a parallel
    // graph walker with no production caller; the assertion now goes through
    // the reader retrieval actually uses, so it cannot pass while the shipped
    // path behaves differently.
    const injected = getMemoryFilesContext({ coin: 'ETHUSDT', direction: 'Long', regime: 'trending' });
    expect(injected).not.toContain('ranging-day.md');
  });

  it('retrieves a matching skill and skips a skill for a different coin', async () => {
    const skills = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(skills.id, 'btc-short-avoid.md', `---
status: confirmed
kind: avoid
coin: BTCUSDT
direction: Short
family: Family A
wins: 1
losses: 6
approvedBy: grandfathered
tradeIds: a,b,c
approvedBy: grandfathered
---

# Avoid BTC short
`, 'graph-user', true);
    await createMemoryFile(skills.id, 'eth-long-avoid.md', `---
status: confirmed
kind: avoid
coin: ETHUSDT
direction: Long
family: Family C
wins: 0
losses: 5
approvedBy: grandfathered
tradeIds: d,e,f
approvedBy: grandfathered
---

# Avoid ETH long
`, 'graph-user', true);

    const btc = getMemoryFilesContext({
      coin: 'BTCUSDT',
      direction: 'Short',
      family: 'Family A',
      regime: 'ranging',
    });
    // Matched skill injects as a capped block with its filename.
    expect(btc).toContain('btc-short-avoid.md');
    expect(btc).not.toContain('eth-long-avoid.md');
  });
});
