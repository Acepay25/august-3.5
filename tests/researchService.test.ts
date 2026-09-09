import { describe, it, expect, vi, beforeEach } from 'vitest';

// Deep Research pipeline (Minara port): every stage is mocked at its transport
// (sendChatRequest + executeDeskTool) so the orchestration contract — plan
// fallback, serial grounding, honest salvage, contradiction capture, degraded
// reports — is testable without a model or a network. Same pattern as
// debateFlow.test.ts.

const { sendChatMock, deskToolMock } = vi.hoisted(() => ({
    sendChatMock: vi.fn(),
    deskToolMock: vi.fn(),
}));

vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: ((...args: unknown[]) => sendChatMock(...args)) as never,
}));
vi.mock('../services/analysis/DeskToolsService', () => ({
    executeDeskTool: ((...args: unknown[]) => deskToolMock(...args)) as never,
    isDataUnavailable: (content: string) => content?.startsWith('DATA_UNAVAILABLE:'),
}));

import { runDeepResearch } from '../services/research/ResearchService';
import { parseResearchSubtasks, parseResearchFinding, parseResearchContradictions } from '../schemas/research';
import type { ProviderConfig } from '../types/provider';

const config = { id: 'p', name: 'P', apiFormat: 'chat_completions', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', models: ['m'], selectedModel: 'm' } as ProviderConfig;

describe('research schema boundaries', () => {
    it('subtask coercion: arrays, wrappers, caps, junk', () => {
        expect(parseResearchSubtasks(['a', 'b'])).toEqual(['a', 'b']);
        expect(parseResearchSubtasks({ subtasks: ['a', ''] })).toEqual(['a']);
        expect(parseResearchSubtasks({ subtasks: Array.from({ length: 10 }, (_, i) => `t${i}`) })).toHaveLength(6);
        expect(parseResearchSubtasks('garbage')).toEqual([]);
    });
    it('finding salvage: bare prose becomes a low-confidence answer', () => {
        expect(parseResearchFinding('just prose')).toEqual({ answer: 'just prose', sources: [], confidence: 'low' });
        expect(parseResearchFinding({ answer: '', sources: [] })).toBeNull();
        expect(parseResearchFinding({ answer: 'ok', sources: ['src'], confidence: 'weird' })).toEqual({ answer: 'ok', sources: ['src'], confidence: 'medium' });
    });
    it('contradictions coerce only real lists', () => {
        expect(parseResearchContradictions({ contradictions: ['x', 3, ''] })).toEqual(['x']);
        expect(parseResearchContradictions({ note: 'no list here' })).toEqual([]);
    });
});

describe('runDeepResearch', () => {
    beforeEach(() => {
        sendChatMock.mockReset();
        deskToolMock.mockReset();
    });

    it('happy path: plan → grounded findings → contradictions → cited report', async () => {
        sendChatMock
            .mockResolvedValueOnce('{"subtasks": ["funding", "regulation"]}')
            .mockResolvedValueOnce('{"answer": "Funding is 0.01%", "sources": ["Binance"], "confidence": "high"}')
            .mockResolvedValueOnce('{"answer": "No bill passed.", "sources": ["CoinDesk"], "confidence": "medium"}')
            .mockResolvedValueOnce('{"contradictions": ["Sources disagree on volume"]}')
            .mockResolvedValueOnce('# Report\nFunding 0.01% [1].');
        deskToolMock.mockImplementation(async () => ({ ok: true, name: 'web_search', toolCallId: 'x', content: 'Query: ...\nHeadlines:\n- Funding rates 0.01% | https://src' }));
        const res = await runDeepResearch({ config, question: 'BTC outlook?' });
        expect(res.subtasks).toEqual(['funding', 'regulation']);
        expect(res.findings).toHaveLength(2);
        expect(res.findings[0].evidence).toContain('Funding rates');
        expect(res.contradictions).toEqual(['Sources disagree on volume']);
        expect(res.report).toContain('# Report');
        expect(res.degraded).toBe(false);
        // Every subtask got GROUNDING before the model was asked (anti-fabrication).
        expect(deskToolMock).toHaveBeenCalledTimes(2);
    });

    it('a dead planner degrades to a single subtask — the question itself', async () => {
        sendChatMock
            .mockResolvedValueOnce('planner said nothing parseable')
            .mockResolvedValueOnce('{"answer": "an answer", "sources": ["s"], "confidence": "low"}')
            .mockResolvedValueOnce('# fallback report');
        deskToolMock.mockResolvedValue({ ok: true, name: 'web_search', toolCallId: 'x', content: 'some evidence' });
        const res = await runDeepResearch({ config, question: 'why ETH?' });
        expect(res.subtasks).toEqual(['why ETH?']);
        expect(res.findings).toHaveLength(1);
        expect(res.report).toBe('# fallback report');
    });

    it('all-search-failure + no-usable-findings marks the run degraded and says so', async () => {
        sendChatMock
            .mockResolvedValueOnce('{"subtasks": ["a"]}')
            .mockResolvedValueOnce('{"answer": "Evidence unavailable — cannot answer.", "sources": [], "confidence": "low"}')
            .mockResolvedValueOnce('');
        deskToolMock.mockResolvedValue({ ok: true, name: 'web_search', toolCallId: 'x', content: 'DATA_UNAVAILABLE: web_search — no reachable results' });
        const res = await runDeepResearch({ config, question: 'obscure thing?' });
        expect(res.degraded).toBe(true);
        expect(res.report).toContain('cannot answer');
        // The unavailable evidence must not masquerade as a provenance block.
        expect(res.findings[0].evidence).toBeUndefined();
    });

    it('empty findings produce the honest empty report, not a hallucination', async () => {
        sendChatMock
            .mockResolvedValueOnce('{"subtasks": ["a"]}')
            .mockResolvedValueOnce(''); // investigator answered nothing
        deskToolMock.mockResolvedValue({ ok: true, name: 'web_search', toolCallId: 'x', content: 'evidence' });
        const res = await runDeepResearch({ config, question: 'q' });
        expect(res.findings).toHaveLength(0);
        expect(res.report).toContain('No conclusion is offered');
        expect(res.degraded).toBe(true);
    });
});
