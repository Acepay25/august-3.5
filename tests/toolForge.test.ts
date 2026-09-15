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

    it('rejects the full private ranges (172.16-31) and host-position {param} slots at save time', () => {
        expect(validateProposal(validProposal({ urlTemplate: 'https://172.16.5.4/v1' })).ok).toBe(false);
        expect(validateProposal(validProposal({ urlTemplate: 'https://172.31.255.1/v1' })).ok).toBe(false);
        expect(validateProposal(validProposal({ urlTemplate: 'https://169.254.1.1/v1' })).ok).toBe(false);
        // 172.15 is NOT in the private 172.16/12 range — must still pass.
        expect(validateProposal(validProposal({ urlTemplate: 'https://172.15.0.1/v1' })).ok).toBe(true);
        // A {param} in the host turns model args into the request destination.
        expect(validateProposal(validProposal({ urlTemplate: 'https://{host}/v1/x' })).ok).toBe(false);
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

describe('ToolForge — exec-time URL re-validation (expanded args)', () => {
    // A tool crafted/stored BEFORE the host-slot rule (or planted directly in
    // storage): only EXEC-time re-validation of the EXPANDED url can stop it.
    const craftStoredTool = (urlTemplate: string, parameters: Record<string, 'string'>) => {
        window.localStorage.setItem('desk_tools_forged_v1', JSON.stringify([{
            id: 'custom_hostprobe',
            proposal: {
                name: 'hostprobe',
                description: 'Crafted probe with a host-position slot.',
                urlTemplate,
                parameters,
            },
            status: 'confirmed',
            uses: 0,
            successes: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }]));
    };
    const probeCall = (args: Record<string, unknown>) => ({ id: 'c1', name: 'custom_hostprobe', arguments: args });

    it('rejects a 172.16.x host built from call args WITHOUT touching the network', async () => {
        craftStoredTool('https://{host}/v1/x', { host: 'string' });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const res = await executeForgedTool('custom_hostprobe', probeCall({ host: '172.16.5.4' }));
        expect(res?.ok).toBe(false);
        expect(res?.content).toMatch(/private\/loopback/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects loopback/metadata expansions too', async () => {
        craftStoredTool('https://{host}/v1/x', { host: 'string' });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        for (const host of ['127.0.0.1', '169.254.169.254', 'localhost']) {
            const res = await executeForgedTool('custom_hostprobe', probeCall({ host }));
            expect(res?.ok).toBe(false);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still executes a host-slot expansion that lands on a safe public host (pre-fix template remains usable)', async () => {
        craftStoredTool('https://{host}/v1/x', { host: 'string' });
        const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":1}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await executeForgedTool('custom_hostprobe', probeCall({ host: 'api.example.com' }));
        expect(res?.ok).toBe(true);
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/v1/x');
    });
});

describe('ToolForge — redirect policy (never hop hosts)', () => {
    beforeEach(() => {
        proposeForgedTool(validProposal());
        approveForgedTool('custom_funding_history');
    });

    it('fetches with redirect:"manual" and REFUSES a cross-host redirect', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response('', { status: 302, headers: { Location: 'https://evil.tld/x' } }),
        );
        vi.stubGlobal('fetch', fetchMock);
        const res = await executeForgedTool('custom_funding_history', call());
        expect(res?.ok).toBe(false);
        expect(res?.content).toMatch(/different host/);
        // The redirect was never followed.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    });

    it('refuses a redirect that lands on a private host', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: 'https://169.254.169.254/latest' } }))
            .mockResolvedValue(new Response('{"ok":1}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await executeForgedTool('custom_funding_history', call());
        expect(res?.ok).toBe(false);
        expect(res?.content).toMatch(/redirect refused/);
        // Never followed to the internal target.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('follows a same-host redirect after re-validating the Location', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: 'https://api.example.com/v2/funding/BTCUSDT' } }))
            .mockResolvedValue(new Response('{"result":"ok"}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const res = await executeForgedTool('custom_funding_history', call());
        expect(res?.ok).toBe(true);
        expect(res?.content).toContain('ok');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.example.com/v2/funding/BTCUSDT');
    });
});

describe('ToolForge — method-aware cache (POST receipts are never replayed)', () => {
    const postTool = (name: string) => {
        proposeForgedTool(validProposal({ name, method: 'POST' }));
        approveForgedTool(`custom_${name}`);
    };

    it('GET results ARE served from the cache on repeat calls', async () => {
        proposeForgedTool(validProposal());
        approveForgedTool('custom_funding_history');
        const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":{"history":"G1"}}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const first = await executeForgedTool('custom_funding_history', call());
        const second = await executeForgedTool('custom_funding_history', call());
        expect(first?.content).toBe('G1');
        expect(second?.content).toBe('G1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    });

    it('POST responses are NEVER cached: each call re-hits the network', async () => {
        postTool('order_ack');
        // Fresh Response per call — a Response body can only be read once.
        const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            new Response('{"queued":true}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const c = { id: 'c1', name: 'custom_order_ack', arguments: { symbol: 'BTCUSDT' } };
        const first = await executeForgedTool('custom_order_ack', c);
        const second = await executeForgedTool('custom_order_ack', { ...c, id: 'c2' });
        expect(first?.ok).toBe(true);
        expect(second?.ok).toBe(true);
        // The re-issued POST must NOT be served a cached success receipt.
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    });
});
