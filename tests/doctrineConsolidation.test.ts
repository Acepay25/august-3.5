import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// In-memory Preferences + scripted model output — no network, no disk.
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

const { turnMock } = vi.hoisted(() => ({
    turnMock: vi.fn() as Mock<(...args: unknown[]) => Promise<{ text: string }>>,
}));
vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatTurn: ((...args: unknown[]) => turnMock(...args)) as never,
}));

import { shouldConsolidateDoctrine, buildDoctrinePrompt, consolidateDoctrine } from '../services/learning/DoctrineConsolidationService';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { upsertSettledBelief, readSettledBeliefs } from '../services/learning/settledBeliefs';
import { LoggedTrade, TradeOutcome, TradeAnalysis } from '../types';
import type { ProviderConfig } from '../types/provider';

const config: ProviderConfig = {
    id: 'prov-a',
    name: 'Provider A',
    apiKey: 'test',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: ['model-1'],
    selectedModel: 'model-1',
};

const trade = (i: number, outcome: TradeOutcome): LoggedTrade => ({
    id: `t${i}`,
    timestamp: new Date(Date.UTC(2026, 7, i + 1)).toISOString(),
    outcome,
    analysis: {
        coinName: 'BTC',
        direction: 'Long',
    } as TradeAnalysis,
});

describe('shouldConsolidateDoctrine', () => {
    it('returns false below the evidence threshold', async () => {
        await initMemoryFiles('doctrine-test');
        const trades = Array.from({ length: 5 }, (_, i) => trade(i, TradeOutcome.WIN));
        expect(shouldConsolidateDoctrine(trades)).toBe(false);
    });

    it('returns true at the threshold when no doctrine exists yet', async () => {
        await initMemoryFiles('doctrine-test-2');
        const trades = Array.from({ length: 15 }, (_, i) => trade(i, i % 3 === 0 ? TradeOutcome.LOSS : TradeOutcome.WIN));
        // No doctrine file exists → lastCount = 0 → closed(10) - 0 >= 10.
        expect(shouldConsolidateDoctrine(trades)).toBe(true);
    });
});

describe('buildDoctrinePrompt', () => {
    it('includes recent trades and current doctrine in first-person framing', () => {
        const trades = [trade(0, TradeOutcome.WIN), trade(1, TradeOutcome.LOSS)];
        const prompt = buildDoctrinePrompt(trades, 'I wait for reclaims.');
        expect(prompt).toContain('your own trading doctrine');
        expect(prompt).toContain('I wait for reclaims.');
        expect(prompt).toContain('BTC Long WIN');
        expect(prompt).toContain('BTC Long LOSS');
        expect(prompt).toContain('First person');
    });

    it('adds the INVALIDATE protocol only when settled beliefs exist', () => {
        const trades = [trade(0, TradeOutcome.WIN)];
        const withoutBeliefs = buildDoctrinePrompt(trades, '');
        expect(withoutBeliefs).not.toContain('INVALIDATE <slug>');
        const withBeliefs = buildDoctrinePrompt(trades, '', {
            settledBeliefs: '- Never add to a losing scalp. (evidence: 8)',
            rollupNotes: '- 3 of 4 NY-session breakouts failed.',
        });
        expect(withBeliefs).toContain('SETTLED BELIEFS (permanent registry');
        expect(withBeliefs).toContain('Never add to a losing scalp.');
        expect(withBeliefs).toContain('INVALIDATE <slug>: <short reason>');
        expect(withBeliefs).toContain('ROLLOUP NOTES');
        expect(withBeliefs).toContain('3 of 4 NY-session breakouts failed.');
    });
});

describe('INVALIDATE protocol (end to end)', () => {
    const USERNAME = 'doctrine-invalidate-test';

    const doctrineFileContent = (): string | undefined => {
        const { files } = getMemoryFiles();
        return files.find(f => f.name === 'doctrine.md')?.content;
    };

    beforeEach(async () => {
        store = {};
        turnMock.mockReset();
        await initMemoryFiles(USERNAME);
    });

    it('applies an INVALIDATE directive to the registry and strips it from the doctrine', async () => {
        await upsertSettledBelief(
            { slug: 'fade-news-spikes', body: 'I fade news spikes.', evidenceCount: 6 },
            USERNAME,
        );
        const trades = Array.from({ length: 16 }, (_, i) => trade(i, i % 4 === 0 ? TradeOutcome.LOSS : TradeOutcome.WIN));
        turnMock.mockResolvedValue({
            text: '- I let news spikes run when momentum confirms.\nINVALIDATE fade-news-spikes: three consecutive CPI spikes followed through\n',
        });

        const res = await consolidateDoctrine(trades, USERNAME, config);
        expect(res.updated).toBe(true);

        // The directive never lands in the doctrine file…
        const doctrine = doctrineFileContent() ?? '';
        expect(doctrine).toContain('news spikes run');
        expect(doctrine).not.toContain('INVALIDATE');
        // …and the belief is now invalidated (kept for audit).
        const beliefs = readSettledBeliefs();
        expect(beliefs).toHaveLength(1);
        expect(beliefs[0].status).toBe('invalidated');
        expect(beliefs[0].invalidationReason).toContain('CPI spikes');
    });

    it('keeps the doctrine untouched when the model returns only an invalidation', async () => {
        const trades = Array.from({ length: 16 }, (_, i) => trade(i, TradeOutcome.WIN));
        turnMock.mockResolvedValue({ text: 'INVALIDATE some-belief: reason only\n' });
        const res = await consolidateDoctrine(trades, USERNAME, config);
        expect(res.updated).toBe(false);
        expect(res.reason).toBe('model returned only invalidations');
        expect(doctrineFileContent()).toBeUndefined();
    });

    it('ignores invalidations for unknown slugs without failing the rewrite', async () => {
        const trades = Array.from({ length: 16 }, (_, i) => trade(i, TradeOutcome.WIN));
        turnMock.mockResolvedValue({ text: '- I size down after two losses.\nINVALIDATE ghost-belief: never existed\n' });
        const res = await consolidateDoctrine(trades, USERNAME, config);
        expect(res.updated).toBe(true);
        expect(doctrineFileContent()).toContain('size down');
        expect(doctrineFileContent()).not.toContain('INVALIDATE');
    });
});
