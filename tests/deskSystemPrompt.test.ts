/**
 * The desk loop writes app-authored text into a user-role turn (tool results,
 * a continue nudge, a clipped payload). The harness contract is the only place
 * that says whose words those are, so every surface that emits the marker must
 * receive the contract exactly once.
 */

import { describe, it, expect } from 'vitest';
import {
    withDeskToolsSystemPrompt,
    deskToolsMandateFor,
    DESK_TOOLS_PROMPT,
    DESK_TOOL_DEFINITIONS,
    CHART_ACTION_TOOL_DEFS,
} from '../services/analysis/DeskToolsService';
import { CHAT_SURFACE_TOOLS } from '../services/trade/chatSurfaceTurn';

const system = (content: string) => [{ role: 'system' as const, content }];

/** Every tool name the prose advertises, in the backticks the mandate uses. */
const namedTools = (mandate: string): string[] => {
    const known = new Set<string>([
        ...DESK_TOOL_DEFINITIONS.map(d => d.function.name),
        ...CHART_ACTION_TOOL_DEFS.map(d => d.function.name),
    ]);
    const found: string[] = [];
    for (const m of mandate.matchAll(/`([a-z_]{3,})`/g)) {
        if (known.has(m[1])) found.push(m[1]);
    }
    return [...new Set(found)];
};

describe('withDeskToolsSystemPrompt', () => {
    it('adds the harness contract to a chat surface that has none', () => {
        const [out] = withDeskToolsSystemPrompt(system('CHAT SURFACE'), false);
        expect(out.content).toContain('HARNESS CONTRACT');
        expect(out.content).toContain('HARNESS NOTE (this app, not the trader)');
        expect(out.content).toContain('DESK TOOLS');
    });

    it('does not duplicate a contract the analysis prompt already composed', () => {
        const [out] = withDeskToolsSystemPrompt(system('HARNESS CONTRACT\nanalysis'), true);
        expect((String(out.content).match(/HARNESS CONTRACT/g) ?? []).length).toBe(1);
        expect(out.content).toContain('DESK TOOLS');
    });

    it('still adds both to a turn with no system message', () => {
        const out = withDeskToolsSystemPrompt([{ role: 'user', content: 'hi' }], true);
        expect(out[0].role).toBe('system');
        expect(out[0].content).toContain('HARNESS CONTRACT');
        expect(out[0].content).toContain('DESK TOOLS');
    });
});

/**
 * O-60. The mandate used to be one static string on every tool turn, and it
 * ordered the seat to read `get_chart_view` before naming a shape and to name
 * `draw_on_chart` to make a level visible — both refused on the Chat surface.
 * A duty the executor refuses does not read as "this home has no chart"; it
 * reads as a rule to satisfy, so the turn burns a round or invents the shape.
 */
describe('the desk mandate advertises only what this turn can call', () => {
    it('names no tool the offer set refuses', () => {
        const mandate = deskToolsMandateFor(CHAT_SURFACE_TOOLS);
        for (const named of namedTools(mandate)) {
            expect(
                CHAT_SURFACE_TOOLS.includes(named),
                `the mandate advertises ${named}, which this surface refuses`,
            ).toBe(true);
        }
    });

    it('falls back to a read that EXISTS here when there is no chart', () => {
        const mandate = deskToolsMandateFor(CHAT_SURFACE_TOOLS);
        expect(mandate).toMatch(/NO CHART to read on this home/);
        expect(mandate).toMatch(/must come from `get_all_timeframes`/);
        expect(mandate).not.toMatch(/requires `get_chart_view`/);
        // The instruction is still a mandate, not a permission.
        expect(mandate).toMatch(/say it came from the candles, not from the picture/);
    });

    it('stops promising that a named level becomes visible', () => {
        const mandate = deskToolsMandateFor(CHAT_SURFACE_TOOLS);
        expect(mandate).toMatch(/There is NO CANVAS on this home/);
        expect(mandate).toMatch(/do not offer to draw/);
        expect(mandate).not.toMatch(/something the trader can see/);
        // Still tells the seat to pass real prices — the rule was never the tool.
        expect(mandate).toMatch(/the exact prices you are citing, never restated ones/);
    });

    it('keeps the chart instruction for a turn that can call it', () => {
        const mandate = deskToolsMandateFor([
            ...CHAT_SURFACE_TOOLS, 'get_chart_view', 'draw_on_chart', 'mark_trade_levels',
        ]);
        expect(mandate).toMatch(/requires `get_chart_view`/);
        expect(mandate).toMatch(/Naming `draw_on_chart` or `mark_trade_levels` is how a level becomes/);
    });

    it('with no offer list at all it is the all-tools mandate, unchanged', () => {
        // The dock and an analysis send offer everything, so their bytes must not
        // move when a surface-specific branch is added.
        expect(deskToolsMandateFor()).toBe(DESK_TOOLS_PROMPT);
        expect(DESK_TOOLS_PROMPT).toMatch(/requires `get_chart_view`/);
    });

    it('says so when there is nothing to ground a shape in at all', () => {
        const mandate = deskToolsMandateFor(['present_trade', 'decline_trade', 'read_tool_output']);
        expect(mandate).toMatch(/no market read is offered on this turn/);
        expect(mandate).toMatch(/name none of them and say you had nothing to look at/);
    });

    it('the transport enrichment uses the same composition, not the constant', () => {
        const [out] = withDeskToolsSystemPrompt(system('CHAT SURFACE'), true, CHAT_SURFACE_TOOLS);
        expect(String(out.content)).toMatch(/NO CHART to read on this home/);
        expect(String(out.content)).not.toMatch(/requires `get_chart_view`/);
    });
});
