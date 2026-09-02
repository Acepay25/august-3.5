import { describe, it, expect } from 'vitest';

import { AnalystRole } from '../types/enums';
import { AgentTeamSeat } from '../services/agents/agentRoster';
import {
    seatPersonaPrompt,
    builtInPromptForRole,
    seatHasPersona,
    GENERAL_ANALYST_DEFAULT_PROMPT,
} from '../services/agents/seatPersonas';

describe('seatPersonas — team seat persona resolution', () => {
    it('general-analyst default when the seat has no role and no instructions', () => {
        const seat: AgentTeamSeat = { providerId: 'p1', modelId: 'm1' };
        const prompt = seatPersonaPrompt(seat);
        expect(prompt).toBe(GENERAL_ANALYST_DEFAULT_PROMPT);
        // The default mandate covers the trader's requirements: market
        // analysis, best-signal framing, and data grounding via tools/web.
        expect(prompt).toContain('GENERAL MARKET ANALYST');
        expect(prompt).toContain('strongest, most actionable trading signal');
        expect(prompt).toContain('web search');
    });

    it('built-in role prompt is inherited verbatim when no custom instructions', () => {
        const seat: AgentTeamSeat = { providerId: 'p1', modelId: 'm1', role: AnalystRole.TECHNICAL_ANALYST };
        expect(seatPersonaPrompt(seat)).toBe(builtInPromptForRole(AnalystRole.TECHNICAL_ANALYST));
        expect(seatPersonaPrompt(seat)).toContain('**ROLE — Technical Analyst**');
    });

    it('custom instructions REFINE a built-in role (role prompt + trader block)', () => {
        const seat: AgentTeamSeat = {
            providerId: 'p1', modelId: 'm1',
            role: AnalystRole.RISK_EXECUTION,
            customPrompt: 'Focus on funding-rate extremes.',
        };
        const prompt = seatPersonaPrompt(seat);
        expect(prompt).toContain(builtInPromptForRole(AnalystRole.RISK_EXECUTION));
        expect(prompt).toContain('TRADER INSTRUCTIONS');
        expect(prompt).toContain('Focus on funding-rate extremes.');
    });

    it('custom instructions REPLACE the default on an unroled seat', () => {
        const seat: AgentTeamSeat = {
            providerId: 'p1', modelId: 'm1',
            customPrompt: 'You are a copy-trade analyst: mirror the desk lead only.',
        };
        const prompt = seatPersonaPrompt(seat);
        expect(prompt).toBe('You are a copy-trade analyst: mirror the desk lead only.');
        expect(prompt).not.toContain('GENERAL MARKET ANALYST');
    });

    it('UNASSIGNED behaves as no role', () => {
        const seat: AgentTeamSeat = { providerId: 'p1', modelId: 'm1', role: AnalystRole.UNASSIGNED };
        expect(builtInPromptForRole(AnalystRole.UNASSIGNED)).toBe('');
        expect(seatPersonaPrompt(seat)).toBe(GENERAL_ANALYST_DEFAULT_PROMPT);
    });

    it('seatHasPersona discriminates roled vs default seats', () => {
        expect(seatHasPersona({ role: AnalystRole.MACRO_VOLATILITY })).toBe(true);
        expect(seatHasPersona({ customPrompt: '  do x  ' })).toBe(true);
        expect(seatHasPersona({ customPrompt: '   ' })).toBe(false);
        expect(seatHasPersona({})).toBe(false);
        expect(seatHasPersona(undefined)).toBe(false);
    });

    it('every prompt is non-empty, even for a wholly empty seat', () => {
        expect(seatPersonaPrompt(null).length).toBeGreaterThan(0);
        expect(seatPersonaPrompt({}).length).toBeGreaterThan(0);
        expect(seatPersonaPrompt(undefined).length).toBeGreaterThan(0);
    });
});
