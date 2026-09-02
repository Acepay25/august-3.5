import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { TeamDialog } from '../components/chat/TeamDialog';
import { AgentTeam } from '../services/agents/agentRoster';
import { ProviderConfig } from '../types/provider';
import { AnalystRole } from '../types/enums';

// Seat provider/model pickers are SelectMenus (styled listbox in a portal):
// open via the trigger's data-testid, choose via [data-option="<value>"].
const pickSeatOption = (testId: string, optionValue: string): void => {
    fireEvent.click(screen.getByTestId(testId));
    const opt = document.querySelector(`[data-option="${optionValue}"]`) as HTMLElement;
    if (!opt) throw new Error(`option ${optionValue} not rendered for ${testId}`);
    fireEvent.click(opt);
};

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: () => {}, removeListener: () => {},
            addEventListener: () => {}, removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia;
    }
});

afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined') window.localStorage.clear();
});

const provider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: over.id ?? 'p1',
    name: over.name ?? 'OpenAI',
    apiKey: over.apiKey ?? 'sk-test',
    baseUrl: over.baseUrl ?? 'https://api.example.com',
    apiFormat: over.apiFormat ?? 'chat_completions',
    isEnabled: over.isEnabled ?? true,
    isBuiltIn: over.isBuiltIn ?? false,
    models: over.models ?? ['gpt-a', 'gpt-b'],
    selectedModel: over.selectedModel ?? 'gpt-a',
    ...over,
});

const base = {
    onClose: () => {},
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    providers: [provider(), provider({ id: 'p2', name: 'Anthropic', models: ['claude-1'], selectedModel: 'claude-1' }), provider({ id: 'p3', name: 'EmptyCo', models: [], selectedModel: '' })],
};

beforeEach(() => {
    base.onCreate.mockClear();
    base.onUpdate.mockClear();
});

describe('TeamDialog (the Team is user-created and modifiable)', () => {
    it('creates a team from seeded seats', () => {
        render(<TeamDialog {...base} open />);
        fireEvent.change(screen.getByTestId('team-name'), { target: { value: 'Alpha Desk' } });
        // Seeded with two usable seats — pick the second provider for seat 2.
        pickSeatOption('team-seat-provider-1', 'p2');
        fireEvent.click(screen.getByTestId('save-team'));
        expect(base.onCreate).toHaveBeenCalledTimes(1);
        const draft = base.onCreate.mock.calls[0][0];
        expect(draft.name).toBe('Alpha Desk');
        expect(draft.seats).toEqual([
            { providerId: 'p1', modelId: 'gpt-a' },
            { providerId: 'p2', modelId: 'claude-1' },
        ]);
    });

    it('adds and removes seats within the 2–5 envelope', () => {
        render(<TeamDialog {...base} open />);
        // Remove is blocked at the floor of 2.
        expect((screen.getByTestId('team-seat-remove-1') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByTestId('add-team-seat'));
        expect(screen.getByTestId('team-seat-2')).toBeTruthy();
        // Fill the new seat, then remove seat 0 — still 2 valid seats.
        pickSeatOption('team-seat-model-2', 'gpt-b');
        fireEvent.click(screen.getByTestId('team-seat-remove-0'));
        fireEvent.click(screen.getByTestId('save-team'));
        const draft = base.onCreate.mock.calls[0][0];
        expect(draft.seats).toHaveLength(2);
    });

    it('an optional moderator rides along', () => {
        render(<TeamDialog {...base} open />);
        fireEvent.click(screen.getByTestId('team-moderator-toggle'));
        fireEvent.click(screen.getByTestId('save-team'));
        const draft = base.onCreate.mock.calls[0][0];
        expect(draft.moderator).toEqual({ providerId: 'p1', modelId: 'gpt-a' });
    });

    it('edit mode prefills and routes through onUpdate', () => {
        const initial: AgentTeam = {
            id: 't1',
            name: 'Old Name',
            seats: [{ providerId: 'p1', modelId: 'gpt-a' }, { providerId: 'p2', modelId: 'claude-1' }],
            createdAt: new Date().toISOString(),
        };
        render(<TeamDialog {...base} open initial={initial} />);
        expect((screen.getByTestId('team-name') as HTMLInputElement).value).toBe('Old Name');
        fireEvent.change(screen.getByTestId('team-name'), { target: { value: 'New Name' } });
        fireEvent.click(screen.getByTestId('save-team'));
        expect(base.onUpdate).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'New Name' }));
        expect(base.onCreate).not.toHaveBeenCalled();
    });

    it('invalid seats (no model) do not count toward the minimum', () => {
        render(<TeamDialog {...base} open />);
        // Point seat 0 at a provider whose model list is empty (p3 has no
        // models) → its modelId clears → only 1 valid seat → save disabled.
        pickSeatOption('team-seat-provider-0', 'p3');
        expect((screen.getByTestId('save-team') as HTMLButtonElement).disabled).toBe(true);
    });

    it('assigns a built-in role to a seat and persists it on save', () => {
        render(<TeamDialog {...base} open />);
        fireEvent.change(screen.getByTestId('team-name'), { target: { value: 'Roled' } });
        pickSeatOption('team-seat-role-0', AnalystRole.RISK_EXECUTION);
        fireEvent.click(screen.getByTestId('save-team'));
        const draft = base.onCreate.mock.calls[0][0];
        expect(draft.seats[0]).toEqual({ providerId: 'p1', modelId: 'gpt-a', role: AnalystRole.RISK_EXECUTION });
        // Seat 1 stays unroled — the selector defaults to general.
        expect(draft.seats[1].role).toBeUndefined();
    });

    it('per-seat instructions ride the seat (customPrompt persisted)', () => {
        render(<TeamDialog {...base} open />);
        fireEvent.click(screen.getByTestId('team-seat-instructions-0'));
        fireEvent.change(screen.getByTestId('team-seat-prompt-0'), {
            target: { value: 'Focus on funding-rate extremes and liquidity sweeps.' },
        });
        fireEvent.click(screen.getByTestId('save-team'));
        const draft = base.onCreate.mock.calls[0][0];
        expect(draft.seats[0].customPrompt).toBe('Focus on funding-rate extremes and liquidity sweeps.');
    });

    it('a blank instructions box is not persisted as noise', () => {
        render(<TeamDialog {...base} open />);
        fireEvent.click(screen.getByTestId('team-seat-instructions-0'));
        fireEvent.change(screen.getByTestId('team-seat-prompt-0'), { target: { value: '   ' } });
        fireEvent.click(screen.getByTestId('save-team'));
        const draft = base.onCreate.mock.calls[0][0];
        expect(draft.seats[0].customPrompt).toBeUndefined();
        expect(draft.seats[0].role).toBeUndefined();
    });

    it('edit mode prefills saved roles and instructions', () => {
        const initial: AgentTeam = {
            id: 't1',
            name: 'Roled Team',
            seats: [
                { providerId: 'p1', modelId: 'gpt-a', role: AnalystRole.MACRO_VOLATILITY, customPrompt: 'watch DXY' },
                { providerId: 'p2', modelId: 'claude-1' },
            ],
            createdAt: new Date().toISOString(),
        };
        render(<TeamDialog {...base} open initial={initial} />);
        fireEvent.click(screen.getByTestId('save-team'));
        const draft = base.onUpdate.mock.calls[0][1];
        expect(draft.seats[0].role).toBe(AnalystRole.MACRO_VOLATILITY);
        expect(draft.seats[0].customPrompt).toBe('watch DXY');
        expect(draft.seats[1].role).toBeUndefined();
    });
});
