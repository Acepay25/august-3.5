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
            'web_search',
            'get_derivatives',
            'get_order_book',
            'get_liquidations',
            'get_btc_context',
            'get_session_context',
            'get_price_snapshot',
            'get_setup_history_stats',
            'recall',
            'recall_chat',
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
