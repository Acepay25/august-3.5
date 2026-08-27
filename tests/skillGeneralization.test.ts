import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown, listSkills } from '../services/learning/SkillMemoryService';
import {
    findGeneralizationCandidates,
    generalizeSkillCluster,
    runGeneralizationPass,
} from '../services/learning/skillGeneralization';

const USERNAME = 'generalization-test';

const seedConfirmed = async (name: string, coin: string, family = 'breakout', regime = 'ranging'): Promise<void> => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, `${name}.md`, `---
status: confirmed
kind: avoid
coin: ${coin}
direction: Short
family: ${family}
regime: ${regime}
wins: 2
losses: 5
tradeIds: ${name}-a,${name}-b,${name}-c,${name}-d,${name}-e,${name}-f,${name}-g
---

# Avoid ${coin} Short ${family}

**Procedure:** Wait for the reclaim on ${coin}.
`, USERNAME, true);
};

describe('findGeneralizationCandidates', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('finds a cluster of confirmed skills sharing family+kind+regime across 2+ coins', async () => {
        await seedConfirmed('btc-short-breakout', 'BTCUSDT');
        await seedConfirmed('eth-short-breakout', 'ETHUSDT');
        const found = findGeneralizationCandidates();
        expect(found).toHaveLength(1);
        expect(found[0].scope).toMatchObject({ family: 'breakout', kind: 'avoid', regime: 'ranging' });
        expect(found[0].coins.sort()).toEqual(['BTC', 'ETH']);
        expect(found[0].rows).toHaveLength(2);
    });

    it('does not generalize a single-coin cluster', async () => {
        await seedConfirmed('btc-short-breakout', 'BTCUSDT');
        expect(findGeneralizationCandidates()).toHaveLength(0);
    });

    it('does not group skills with different regimes or families', async () => {
        await seedConfirmed('btc-short-breakout', 'BTCUSDT', 'breakout', 'ranging');
        await seedConfirmed('eth-short-breakout', 'ETHUSDT', 'breakout', 'trending');
        await seedConfirmed('sol-short-sweep', 'SOLUSDT', 'liquidity sweep', 'ranging');
        expect(findGeneralizationCandidates()).toHaveLength(0);
    });

    it('ignores candidate (unconfirmed) and already-superseded skills', async () => {
        await seedConfirmed('btc-short-breakout', 'BTCUSDT');
        const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(folder.id, 'eth-short-breakout.md', `---
status: candidate
kind: avoid
coin: ETHUSDT
direction: Short
family: breakout
regime: ranging
wins: 2
losses: 5
tradeIds: e1,e2,e3,e4,e5,e6,e7
---

# candidate
`, USERNAME, true);
        expect(findGeneralizationCandidates()).toHaveLength(0);
    });
});

describe('generalizeSkillCluster', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('creates a coin-less candidate skill, sums evidence, and supersedes the sources', async () => {
        await seedConfirmed('btc-short-breakout', 'BTCUSDT');
        await seedConfirmed('eth-short-breakout', 'ETHUSDT');
        const [candidate] = findGeneralizationCandidates();
        const made = await generalizeSkillCluster(candidate, USERNAME);
        expect(made).not.toBeNull();
        expect(made!.coin).toBeUndefined();
        expect(made!.family).toBe('breakout');
        expect(made!.regime).toBe('ranging');
        expect(made!.status).toBe('candidate');
        expect(made!.wins).toBe(4);
        expect(made!.losses).toBe(10);
        expect(made!.evidenceCount).toBe(14);

        // Sources are retired + tagged.
        const sources = listSkills().filter(r => r.meta.supersededBy);
        expect(sources).toHaveLength(2);
        for (const s of sources) {
            expect(s.meta.status).toBe('retired');
            expect(s.file.enabled).toBe(false);
            expect(s.meta.supersededBy).toMatch(/breakout/);
        }
        // The generalized skill is the only active member of the cluster now.
        const active = listSkills().filter(r => !r.meta.supersededBy && r.meta.status !== 'retired');
        expect(active).toHaveLength(1);
        expect(active[0].meta.coin).toBeUndefined();
    });

    it('is idempotent — a second pass creates nothing new', async () => {
        await seedConfirmed('btc-short-breakout', 'BTCUSDT');
        await seedConfirmed('eth-short-breakout', 'ETHUSDT');
        const created = await runGeneralizationPass(USERNAME);
        expect(created).toBe(1);
        const second = await runGeneralizationPass(USERNAME);
        expect(second).toBe(0);
    });

    it('keeps direction only when all sources agree', async () => {
        await seedConfirmed('btc-short-breakout', 'BTCUSDT');
        const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
        await createMemoryFile(folder.id, 'eth-long-breakout.md', `---
status: confirmed
kind: avoid
coin: ETHUSDT
direction: Long
family: breakout
regime: ranging
wins: 2
losses: 5
tradeIds: e1,e2,e3,e4,e5,e6,e7
---

# Avoid ETHUSDT Long breakout
`, USERNAME, true);
        const [candidate] = findGeneralizationCandidates();
        const made = await generalizeSkillCluster(candidate, USERNAME);
        expect(made!.direction).toBeUndefined();
    });
});
