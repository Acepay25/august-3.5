/**
 * The desk loop writes app-authored text into a user-role turn (tool results,
 * a continue nudge, a clipped payload). The harness contract is the only place
 * that says whose words those are, so every surface that emits the marker must
 * receive the contract exactly once.
 */

import { describe, it, expect } from 'vitest';
import { withDeskToolsSystemPrompt } from '../services/analysis/DeskToolsService';

const system = (content: string) => [{ role: 'system' as const, content }];

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
