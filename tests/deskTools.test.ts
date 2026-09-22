import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    DESK_TOOL_DEFINITIONS,
    DESK_TOOLS_PROMPT,
    parseOpenAIToolCalls,
    parseTextToolCalls,
    stripTextToolCalls,
    formatToolResultsForModel,
    executeDeskTool,
    toAnthropicTools,
} from '../services/analysis/DeskToolsService';

describe('DeskToolsService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('exports a focused trading tool catalog', () => {
        const names = DESK_TOOL_DEFINITIONS.map(t => t.function.name);
        expect(names).toEqual([
            'amend_memory',
            'forge_tool',
            'write_memory_note',
            'get_notebook_map',
            'remember',
            'read_memory',
            'forget',
            'propose_skill',
            'revise_skill',
            // Redeems the `ta-…` receipt a clipped tool result carries; without
            // it a seat is told the rest exists and given no way to get it.
            'read_tool_output',
            'web_search',
            'get_derivatives',
            'get_order_book',
            'get_liquidations',
            'get_btc_context',
            'get_market_packet',
            'get_all_timeframes',
            'get_chart_view',
            'get_session_context',
            'get_price_snapshot',
            'get_setup_history_stats',
            'recall',
            'recall_chat',
            'scan_setups',
            'scan_chart_skills',
            'project_future_price',
            'run_screener',
            'run_monte_carlo',
        ]);
        expect(toAnthropicTools().find(t => (t as { name: string }).name === 'web_search')).toMatchObject({
            name: 'web_search',
            input_schema: expect.objectContaining({ type: 'object' }),
        });
    });

    it('parses OpenAI-style tool_calls', () => {
        const calls = parseOpenAIToolCalls({
            tool_calls: [
                {
                    id: 'call_1',
                    function: { name: 'web_search', arguments: '{"query":"FOMC this week"}' },
                },
            ],
        });
        expect(calls).toEqual([{
            id: 'call_1',
            name: 'web_search',
            arguments: { query: 'FOMC this week' },
        }]);
    });

    it('parses and strips the text-protocol fallback', () => {
        const text = `Need funding first.
<tool_call name="get_derivatives">{"symbol":"ETH"}</tool_call>
Then I'll write the call.`;
        expect(parseTextToolCalls(text)).toEqual([{
            id: 'text_0',
            name: 'get_derivatives',
            arguments: { symbol: 'ETH' },
        }]);
        expect(stripTextToolCalls(text)).toContain('Need funding first.');
        expect(stripTextToolCalls(text)).not.toContain('<tool_call');
    });

    it('formats tool results for the model', () => {
        const block = formatToolResultsForModel([
            { toolCallId: '1', name: 'get_session_context', ok: true, content: '{"session":"london"}' },
        ]);
        expect(block).toContain('TOOL RESULT: get_session_context');
        expect(block).toContain('london');
    });

    it('runs get_session_context without network', async () => {
        const result = await executeDeskTool({
            id: 'c1',
            name: 'get_session_context',
            arguments: {},
        });
        expect(result.ok).toBe(true);
        expect(result.content).toContain('currentSession');
    });

    it('injects desk tools into a system prompt via stream helper path (prompt text)', () => {
        expect(DESK_TOOLS_PROMPT).toContain('available anytime');
        expect(DESK_TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(5);
    });
});

describe('allowedTools is enforced in the EXECUTOR (transport-agnostic)', () => {
    // The offer-time filter only shapes what a NATIVE-format provider sees;
    // a text-protocol seat can emit a tag for ANY tool (observed: arbiter
    // seats calling remember/write_memory_note/forget despite their policy).
    // The executor is the one chokepoint every transport passes through.
    it('refuses an off-list write tool even though nothing about the transport says so', async () => {
        const res = await executeDeskTool(
            { id: 'r1', name: 'remember', arguments: { kind: 'user', description: 'd', body: 'b' } },
            { allowedTools: ['recall', 'web_search'] },
        );
        expect(res.ok).toBe(false);
        expect(res.content.startsWith('remember rejected:')).toBe(true);
        expect(res.content).toContain('not available on this seat');
    });

    it('refuses write_memory_note / forget off-list, passes an on-list read', async () => {
        const wn = await executeDeskTool(
            { id: 'r2', name: 'write_memory_note', arguments: { folder: 'lessons', file_name: 'x', content: 'y' } },
            { allowedTools: ['get_session_context'] },
        );
        expect(wn.ok).toBe(false);
        const fg = await executeDeskTool(
            { id: 'r3', name: 'forget', arguments: { slug: 'whatever' } },
            { allowedTools: ['get_session_context'] },
        );
        expect(fg.ok).toBe(false);
        const ok = await executeDeskTool(
            { id: 'r4', name: 'get_session_context', arguments: {} },
            { allowedTools: ['get_session_context'] },
        );
        expect(ok.ok).toBe(true);
    });

    it('empty/absent allow-list stays unrestricted (legacy debate/analysis callers)', async () => {
        const res = await executeDeskTool(
            { id: 'r5', name: 'get_session_context', arguments: {} },
            { allowedTools: [] },
        );
        expect(res.ok).toBe(true);
    });
});
