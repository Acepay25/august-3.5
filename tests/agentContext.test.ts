import { describe, it, expect, vi, beforeEach } from 'vitest';
import { botMemoryFolderName } from '../services/bots/BotMemoryService';
import type { AgentBot } from '../services/agents/agentRoster';

/**
 * resolveAgentContext — the one loader that decides what an agent carries into
 * a prompt. Every surface that answers AS an agent goes through it, so persona
 * and notes cannot be assembled one way at the chart and another way at the
 * desk. These cases pin the four parts a surface depends on.
 */

const BOT: AgentBot = {
    id: 'bot-aria',
    name: 'Aria',
    providerId: 'prov-a',
    modelId: 'model-a',
    customPrompt: 'Only trade with the 4h trend.',
    avatar: { kind: 'auto' },
    createdAt: '2026-09-01T00:00:00.000Z',
};

const NOTES = [
    '- BTC: the third touch is the entry, not the first.',
    '- ETH: funding above 0.05% means the crowd is long.',
    '- Always ask for the invalidation price.',
].join('\n');

const load = async () => {
    vi.resetModules();
    vi.doMock('../services/learning/MemoryFilesService', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../services/learning/MemoryFilesService')>()),
        getMemoryFiles: () => ({
            folders: [{ id: 'f1', name: botMemoryFolderName(BOT.id) }],
            files: [{ id: 'x1', folderId: 'f1', name: 'memory.md', content: NOTES }],
        }),
    }));
    return await import('../services/agents/agentContext');
};

beforeEach(() => { vi.resetModules(); });

describe('resolveAgentContext', () => {
    it('returns the persona, the notes and the model pair together', async () => {
        const { resolveAgentContext } = await load();
        const ctx = resolveAgentContext(BOT);
        expect(ctx.persona).toContain('Only trade with the 4h trend.');
        expect(ctx.notes).toContain('the third touch is the entry');
        expect([ctx.providerId, ctx.modelId]).toEqual(['prov-a', 'model-a']);
        expect(ctx.name).toBe('Aria');
        expect(ctx.botId).toBe(BOT.id);
    });

    it('carries the setup query through to the note filter', async () => {
        const { resolveAgentContext } = await load();
        const onBtc = resolveAgentContext(BOT, { coin: 'BTCUSDT', knownCoins: ['ETHUSDT'] });
        // The ETH line is another coin's lesson once ETH is a known symbol and
        // BTC is the one being asked about.
        expect(onBtc.notes).toContain('BTC');
        expect(onBtc.notes).not.toContain('funding above 0.05%');
        expect(onBtc.notes).toContain('invalidation price');
    });

    it('gives a lone agent more room than a roster share, without inventing a number', async () => {
        const { resolveAgentContext, SINGLE_AGENT_MEMORY_BUDGET } = await load();
        const { BOT_MEMORY_PER_AGENT_CHAR_BUDGET } = await import('../services/bots/botMemoryBudget');
        expect(SINGLE_AGENT_MEMORY_BUDGET).toBeGreaterThan(BOT_MEMORY_PER_AGENT_CHAR_BUDGET);
        // Resolving twice — once for a chart turn, once for a desk turn — must
        // hand back the same bytes, which is the whole point of one loader.
        const a = resolveAgentContext(BOT, { coin: 'BTCUSDT' }, SINGLE_AGENT_MEMORY_BUDGET);
        const b = resolveAgentContext(BOT, { coin: 'BTCUSDT' }, SINGLE_AGENT_MEMORY_BUDGET);
        expect(a.notes).toBe(b.notes);
        expect(a.persona).toBe(b.persona);
    });

    it('reads the agent name from the roster, never from the model slug', async () => {
        const { resolveAgentContext, agentRowLabel } = await load();
        expect(agentRowLabel(resolveAgentContext(BOT))).toBe('Aria');
    });
});
