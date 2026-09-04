import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    ToolForgeProposal,
    validateProposal,
    proposeForgedTool,
    approveForgedTool,
    retireForgedTool,
    deleteForgedTool,
    loadForgedTools,
    executeForgedTool,
    forgedToolDefinition,
    confirmedForgedToolDefinitions,
    clearForgedToolCache,
    forgedToolStats,
} from '../services/tools/toolForge';

const validProposal = (over: Partial<ToolForgeProposal> = {}): ToolForgeProposal => ({
    name: 'funding_history',
    description: 'Funding-rate history for a symbol from a public API.',
    urlTemplate: 'https://api.example.com/v1/funding/{symbol}',
    parameters: { symbol: 'string' },
    extractPath: 'data.history',
    ...over,
});

const call = (args: Record<string, unknown> = { symbol: 'BTCUSDT' }, id = 'c1') => ({
    id,
    name: 'custom_funding_history',
    arguments: args,
});

beforeEach(() => {
    window.localStorage.clear();
    clearForgedToolCache();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ToolForge — validation (models propose, harness hardens)', () => {
    it('accepts a well-formed https proposal', () => {
        const v = validateProposal(validProposal());
        expect(v.ok).toBe(true);
        expect(v.errors).toEqual([]);
    });

    it('rejects non-https, localhost, and private-network URLs (SSRF guard)', () => {
        expect(validateProposal(validProposal({ urlTemplate: 'http://api.example.com/x' })).ok).toBe(false);
        expect(validateProposal(validProposal({ urlTemplate: 'https://localhost/v1' })).ok).toBe(false);
        expect(validateProposal(validProposal({ urlTemplate: 'https://192.168.1.4/v1' })).ok).toBe(false);
        expect(validateProposal(validProposal({ urlTemplate: 'https://127.0.0.1/v1' })).ok).toBe(false);
        expect(validateProposal(validProposal({ urlTemplate: 'https://10.0.0.3/v1' })).ok).toBe(false);
        expect(validateProposal(validProposal({ urlTemplate: 'not a url' })).ok).toBe(false);
    });

    it('rejects credentials in URLs and param slots in headers', () => {
        expect(validateProposal(validProposal({ urlTemplate: 'https://user:pass@api.example.com/x' })).ok).toBe(false);
        expect(validateProposal(validProposal({ headers: { 'X-Key': '{symbol}' } })).ok).toBe(false);
    });

    it('rejects missing name/description and bad parameter types', () => {
        expect(validateProposal(validProposal({ name: '' })).ok).toBe(false);
        expect(validateProposal(validProposal({ description: '  ' })).ok).toBe(false);
        expect(validateProposal(validProposal({ parameters: { symbol: 'object' as 'string' } })).ok).toBe(false);
    });
});

describe('ToolForge — lifecycle: candidate → human approval → confirmed', () => {
    it('propose stores a CANDIDATE that cannot execute', async () => {
        const tool = proposeForgedTool(validProposal(), 'model:test');
        expect(tool.id).toBe('custom_funding_history');
        expect(tool.status).toBe('candidate');
        // Unapproved tool refuses to run — no network is attempted.
        const res = await executeForgedTool(tool.id, call());
        expect(res?.ok).toBe(false);
        expect(res?.content).toContain('not an approved tool');
    });

    it('approval is the human gate; only confirmed tools execute', async () => {
        proposeForgedTool(validProposal());
        approveForgedTool('custom_funding_history');
        const stored = loadForgedTools().find(t => t.id === 'custom_funding_history');
        expect(stored?.status).toBe('confirmed');

        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { history: [{ rate: '0.01' }] } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await executeForgedTool('custom_funding_history', call());
        expect(res?.ok).toBe(true);
        expect(res?.content).toContain('0.01');
        // The URL template expanded with the call arguments.
        expect(String(fetchMock.mock.calls[0][0])).toContain('https://api.example.com/v1/funding/BTCUSDT');
    });

    it('candidate proposals are excluded from the desk definition set', () => {
        proposeForgedTool(validProposal());
        expect(confirmedForgedToolDefinitions()).toHaveLength(0);
        approveForgedTool('custom_funding_history');
        expect(confirmedForgedToolDefinitions()).toHaveLength(1);
        expect(confirmedForgedToolDefinitions()[0].function.name).toBe('custom_funding_history');
        expect(forgedToolDefinition(loadForgedTools()[0]).function.parameters.required).toEqual(['symbol']);
    });

    it('re-proposing the same name replaces the stored candidate', () => {
        proposeForgedTool(validProposal({ description: 'v1' }));
        proposeForgedTool(validProposal({ description: 'v2' }));
        const items = loadForgedTools();
        expect(items).toHaveLength(1);
        expect(items[0].proposal.description).toBe('v2');
    });

    it('retire removes it from the desk set; delete removes it entirely', async () => {
        proposeForgedTool(validProposal());
        approveForgedTool('custom_funding_history');
        retireForgedTool('custom_funding_history');
        expect(confirmedForgedToolDefinitions()).toHaveLength(0);
        const res = await executeForgedTool('custom_funding_history', call());
        expect(res?.ok).toBe(false);
        deleteForgedTool('custom_funding_history');
        expect(loadForgedTools()).toHaveLength(0);
    });
});

describe('ToolForge — execution hardening', () => {
    it('extracts the dot path and caches repeat calls within the TTL', async () => {
        proposeForgedTool(validProposal({ ttlMs: 60_000 }));
        approveForgedTool('custom_funding_history');
        const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":{"history":"R1"}}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await executeForgedTool('custom_funding_history', call());
        const second = await executeForgedTool('custom_funding_history', call({ symbol: 'BTCUSDT' }));
        // Same args → served from the forged cache, not the network.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(second?.content).toBe('R1');
    });

    it('non-2xx responses fail without throwing; failures count in stats', async () => {
        proposeForgedTool(validProposal());
        approveForgedTool('custom_funding_history');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })));
        const res = await executeForgedTool('custom_funding_history', call());
        expect(res?.ok).toBe(false);
        expect(res?.content).toContain('503');
        const stats = forgedToolStats('custom_funding_history');
        expect(stats.uses).toBe(1);
        expect(stats.successRate).toBe(0);
    });

    it('unknown custom_ tools fail closed; non-custom names fall through (null)', async () => {
        const unknown = await executeForgedTool('custom_nope', call());
        expect(unknown?.ok).toBe(false);
        expect(await executeForgedTool('web_search', call())).toBeNull();
    });

    it('successful uses drive the promotion stats', async () => {
        proposeForgedTool(validProposal());
        approveForgedTool('custom_funding_history');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":1}', { status: 200 })));
        await executeForgedTool('custom_funding_history', call());
        const stats = forgedToolStats('custom_funding_history');
        expect(stats).toEqual({ uses: 1, successRate: 1 });
    });
});
