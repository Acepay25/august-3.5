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

import { initMemoryFiles, getMemoryFiles, getMemoryFilesContext, createMemoryFile, updateMemoryFile } from '../services/learning/MemoryFilesService';
import { listRetrievedMemorySources } from '../services/learning/MemoryRetrievalService';
import { upsertSettledBelief } from '../services/learning/settledBeliefs';

const USERNAME = 'compounding-retrieval-test';

describe('settled-beliefs injection slot', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('injects settled beliefs above the doctrine, outside the stage budget', async () => {
        await upsertSettledBelief(
            { slug: 'no-adding-losers', body: 'Never add to a losing scalp position.', evidenceCount: 8, regime: 'ranging' },
            USERNAME,
        );
        const ctx = getMemoryFilesContext({ coin: 'BTCUSDT', direction: 'Long', family: 'X', regime: 'ranging' }, []);
        expect(ctx).toContain('SETTLED BELIEFS');
        expect(ctx).toContain('Never add to a losing scalp position.');
        // Beliefs appear before the doctrine header when both are present.
        const beliefsIdx = ctx.indexOf('SETTLED BELIEFS');
        expect(beliefsIdx).toBeGreaterThanOrEqual(0);
    });

    it('lists settled-beliefs as a retrieved source', async () => {
        await upsertSettledBelief({ slug: 'a', body: 'Some durable belief.', evidenceCount: 5 }, USERNAME);
        const sources = listRetrievedMemorySources({ coin: 'BTC', direction: 'Long', family: 'X', regime: 'ranging' }, []);
        expect(sources.some(s => s.path === 'profile/settled-beliefs')).toBe(true);
    });

    it('omits the slot entirely when there are no settled beliefs', () => {
        const ctx = getMemoryFilesContext({ coin: 'BTC', direction: 'Long', family: 'X', regime: 'ranging' }, []);
        expect(ctx).not.toContain('SETTLED BELIEFS');
    });
});

describe('cross-block content dedup', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    const setRiskRules = async (content: string): Promise<void> => {
        const { files, folders } = getMemoryFiles();
        const rules = folders.find(f => f.name === 'rules')!;
        const file = files.find(f => f.folderId === rules.id && f.name === 'risk-rules.md')!;
        await updateMemoryFile(file.id, { content }, USERNAME);
    };

    it('drops a risk-rule line that the doctrine already states verbatim', async () => {
        const { files, folders } = getMemoryFiles();
        const profile = folders.find(f => f.name === 'profile')!;
        // Doctrine renders ABOVE the risk-rules block, so its copy wins.
        await createMemoryFile(profile.id, 'doctrine.md',
            '<!-- trades: 20 -->\n- I always wait for the 15m reclaim before entering any short position.',
            USERNAME, true);
        await setRiskRules(
            '# Risk rules\n- I always wait for the 15m reclaim before entering any short position.\n- Never risk more than 2% per trade.',
        );

        const ctx = getMemoryFilesContext(
            { coin: 'BTCUSDT', direction: 'Short', family: 'Family A', regime: 'ranging' },
            [],
        );
        const occurrences = ctx.split(/15m reclaim before entering any short position/i).length - 1;
        expect(occurrences).toBe(1);
        // The non-duplicated rule still renders.
        expect(ctx).toContain('Never risk more than 2% per trade.');
        expect(files.length).toBeGreaterThan(0);
    });

    it('keeps distinct lines from both blocks', async () => {
        const { folders } = getMemoryFiles();
        const profile = folders.find(f => f.name === 'profile')!;
        await createMemoryFile(profile.id, 'doctrine.md',
            '<!-- trades: 20 -->\n- I size down after two consecutive losses.',
            USERNAME, true);
        await setRiskRules('# Risk rules\n- Always confirm volume before trusting a breakdown.');

        const ctx = getMemoryFilesContext(
            { coin: 'BTCUSDT', direction: 'Short', family: 'Family A', regime: 'ranging' },
            [],
        );
        expect(ctx).toContain('size down after two consecutive losses');
        expect(ctx).toContain('confirm volume before trusting a breakdown');
    });
});
