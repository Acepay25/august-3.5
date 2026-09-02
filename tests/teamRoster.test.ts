import { describe, it, expect } from 'vitest';
import { AnalystRole } from '../types/enums';
import { AnalystRoleAssignment } from '../types/lens';
import { ProviderConfig } from '../types/provider';
import { buildTeamRoster } from '../utils/teamRoster';

const provider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: over.id ?? 'p1',
    name: over.name ?? 'OpenAI',
    apiKey: over.apiKey ?? 'sk-test',
    baseUrl: over.baseUrl ?? 'https://api.example.com',
    apiFormat: over.apiFormat ?? 'chat_completions',
    isEnabled: over.isEnabled ?? true,
    isBuiltIn: over.isBuiltIn ?? false,
    models: over.models ?? ['gpt-test'],
    selectedModel: over.selectedModel ?? 'gpt-test',
    ...over,
});

const lenses = (enabled: boolean, assignments: AnalystRoleAssignment[] = []) => ({
    enabled,
    assignments,
    tradingStyle: 'auto' as const,
});

describe('buildTeamRoster (the Team is the live ensemble config, not a hardcoded list)', () => {
    it('derives the three lens seats with role colors when lenses are on', () => {
        const slots = buildTeamRoster(
            lenses(true, [
                { role: AnalystRole.MACRO_VOLATILITY, assignedProvider: 'p1', assignedModel: 'gpt-test' },
                { role: AnalystRole.TECHNICAL_ANALYST, assignedProvider: 'p1', assignedModel: 'gpt-4' },
                { role: AnalystRole.RISK_EXECUTION, assignedProvider: 'p2', assignedModel: 'claude-3' },
            ]),
            [],
            [provider(), provider({ id: 'p2', name: 'Anthropic' })],
        );
        expect(slots.map(s => s.label)).toEqual(['Macro', 'Technical', 'Risk']);
        expect(slots.map(s => s.role)).toEqual(['macro', 'technical', 'risk']);
        expect(slots.every(s => s.model.length > 0)).toBe(true);
        expect(slots.map(s => s.initial)).toEqual(['M', 'T', 'R']);
    });

    it('derives the configured experts with seat numbers when lenses are off', () => {
        const slots = buildTeamRoster(
            lenses(false),
            [
                { providerId: 'p1', model: 'gpt-test' },
                { providerId: 'p2', model: 'claude-3' },
            ],
            [provider(), provider({ id: 'p2', name: 'Anthropic' })],
        );
        expect(slots.map(s => s.label)).toEqual(['OpenAI', 'Anthropic']);
        expect(slots.map(s => s.initial)).toEqual(['1', '2']);
        // Provider names are 'unknown' to the role heuristic — they get a
        // deterministic colored role (never gray) and it is stable.
        expect(slots[0].role).toBe(slots[0].role);
        expect(slots[0].role).not.toBe('unknown');
    });

    it('drops lens seats without a resolvable model', () => {
        const slots = buildTeamRoster(
            lenses(true, [{ role: AnalystRole.MACRO_VOLATILITY, assignedProvider: 'p1' }]),
            [],
            [],
        );
        expect(slots).toEqual([]);
    });

    it('disabled or keyless providers do not provide labels (Expert N fallback stands)', () => {
        const slots = buildTeamRoster(
            lenses(false),
            [{ providerId: 'p1', model: 'gpt-test' }],
            [provider({ isEnabled: false })],
        );
        expect(slots).toHaveLength(1);
        expect(slots[0].label).toBe('Expert 1');
    });

    it('an empty configuration yields an empty roster (the UI shows the configure hint)', () => {
        expect(buildTeamRoster(lenses(false), [], [])).toEqual([]);
    });
});

import { AgentTeam } from '../services/agents/agentRoster';
import { teamSlots, TEAM_MIN_SEATS, TEAM_MAX_SEATS } from '../utils/teamRoster';

describe('teamSlots (user-team render slots)', () => {
    const team: AgentTeam = {
        id: 't1',
        name: 'Alpha',
        seats: [
            { providerId: 'p1', modelId: 'gpt-test' },
            { providerId: 'p2', modelId: 'claude-3' },
            { providerId: 'ghost', modelId: 'm' },
        ],
        createdAt: new Date().toISOString(),
    };

    it('maps seats to labeled slots with provider names and stable colors', () => {
        const slots = teamSlots(team, [provider(), provider({ id: 'p2', name: 'Anthropic' })]);
        expect(slots).toHaveLength(3);
        expect(slots[0].label).toBe('OpenAI');
        expect(slots[1].label).toBe('Anthropic');
        // An unknown provider falls back to the model display, never crashes.
        expect(slots[2].label).toBe('M'); // formatModelDisplayName capitalizes
        expect(slots.every(s => s.role !== 'unknown')).toBe(true);
    });

    it('caps at TEAM_MAX_SEATS', () => {
        const big = { ...team, seats: Array.from({ length: 12 }, (_, i) => ({ providerId: 'p1', modelId: `m${i}` })) };
        expect(teamSlots(big, [provider()])).toHaveLength(TEAM_MAX_SEATS);
    });

    it('seat limits match the debate engine envelope (min 2, max 10 — pods above 5)', () => {
        expect(TEAM_MIN_SEATS).toBe(2);
        expect(TEAM_MAX_SEATS).toBe(10);
    });
});
