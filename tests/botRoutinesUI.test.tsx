import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { AgentRosterRail } from '../components/chat/AgentRosterRail';
import AutomationEditorModal from '../components/automation/AutomationEditorModal';
import AutomationRunCard from '../components/automation/AutomationRunCard';
import type { AgentBot } from '../services/agents/agentRoster';
import type { AutomationConfig, AutomationRun } from '../types/automation';
import { MessageRole } from '../types/enums';
import type { Message } from '../types/message';

// Bot Mode G5 (plan botmode-scan): the Routines disclosure on the roster
// rail + the "Run as bot" selector in the automation editor.

afterEach(() => { cleanup(); window.localStorage.clear(); });

let seq = 0;
const bot = (over: Partial<AgentBot>): AgentBot => ({
    id: over.id ?? `b${seq += 1}`,
    name: over.name ?? 'Macro',
    providerId: over.providerId ?? 'p1',
    modelId: over.modelId ?? 'm1',
    avatar: over.avatar ?? { kind: 'auto' },
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const routine = (over: Partial<AutomationConfig>): AutomationConfig => ({
    id: over.id ?? `r${seq += 1}`, name: over.name ?? 'Morning brief', enabled: true,
    schedule: { cron: '0 9 * * 1-5' }, inputSource: 'template',
    promptTemplate: 'brief me', mode: 'standard', useLenses: false,
    analystModels: [], moderatorModel: { providerId: '', modelId: '' },
    createdAt: 0, updatedAt: 0, runCount: 0, ...over,
});

const railBase = {
    messages: [],
    bots: [],
    groups: [],
    selection: { kind: 'team' } as const,
    onSelectTeam: () => {},
    onSelectBot: () => {},
    onSelectGroup: () => {},
    onNewBot: () => {},
    onNewGroup: () => {},
};

describe('AgentRosterRail — Routines disclosure (G5)', () => {
    it('shows no disclosure for bots without routines', () => {
        render(<AgentRosterRail {...railBase} bots={[bot({ id: 'b1' })]} />);
        expect(screen.queryByTestId('routine-disclosure')).toBeNull();
    });

    it('discloses a bot\u2019s routines: toggle, next-fire line, and Run now', () => {
        const onRunRoutine = vi.fn();
        const r = routine({ id: 'r1', botId: 'b1' });
        render(
            <AgentRosterRail
                {...railBase}
                bots={[bot({ id: 'b1', name: 'Macro' })]}
                botRoutines={{ b1: [r] }}
                onRunRoutine={onRunRoutine}
            />,
        );
        expect(screen.getByTestId('routine-disclosure').textContent).toContain('Routines (1)');
        // Collapsed by default — no Run button visible yet.
        expect(screen.queryByTestId('routine-run-r1')).toBeNull();
        fireEvent.click(screen.getByTestId('routine-disclosure-toggle'));
        expect(screen.getByTestId('routine-run-r1')).toBeTruthy();
        expect(screen.getByTestId('routine-disclosure').textContent).toContain('Morning brief');
        expect(screen.getByTestId('routine-disclosure').textContent).toContain('next');
        fireEvent.click(screen.getByTestId('routine-run-r1'));
        expect(onRunRoutine).toHaveBeenCalledWith(r);
    });

    it('no disclosure without the onRunRoutine handler (embedders opt in)', () => {
        render(
            <AgentRosterRail
                {...railBase}
                bots={[bot({ id: 'b1' })]}
                botRoutines={{ b1: [routine({ botId: 'b1' })] }}
            />,
        );
        expect(screen.queryByTestId('routine-disclosure')).toBeNull();
    });
});

describe('AutomationEditorModal — Run as bot (G5)', () => {
    const editorBase = {
        modelOptions: [],
        providers: [],
        onClose: () => {},
    };

    it('hides the selector entirely when no bots exist on the roster', () => {
        render(<AutomationEditorModal {...editorBase} isVisible onSave={vi.fn()} />);
        expect(screen.queryByTestId('automation-run-as-bot')).toBeNull();
    });

    it('saves a bot-scoped routine: botId set, ensemble seats cleared', () => {
        const onSave = vi.fn();
        render(
            <AutomationEditorModal
                {...editorBase}
                isVisible
                onSave={onSave}
                bots={[bot({ id: 'b1', name: 'Macro', title: 'Macro analyst' })]}
            />,
        );
        // Open the SelectMenu and pick the bot.
        fireEvent.click(screen.getByTestId('automation-run-as-bot'));
        fireEvent.click(screen.getByRole('option', { name: /Macro/ }));
        // The helper copy flips to bot mode.
        expect(screen.getByTestId('automation-run-as-bot').textContent).toContain('Macro');

        fireEvent.change(screen.getByPlaceholderText('e.g. BTCUSDT hourly check'), { target: { value: 'Morning routine' } });
        // A template prompt is still required for bot routines.
        fireEvent.change(screen.getByPlaceholderText(/Analyze BTCUSDT/), { target: { value: 'brief me at open' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0] as AutomationConfig;
        expect(saved.name).toBe('Morning routine');
        expect(saved.botId).toBe('b1');
        expect(saved.analystModels).toEqual([]);
        expect(saved.moderatorModel).toEqual({ providerId: '', modelId: '' });
    });

    it('switching back to the ensemble clears botId and re-requires the seats', () => {
        const onSave = vi.fn();
        render(
            <AutomationEditorModal
                {...editorBase}
                isVisible
                initial={routine({ botId: 'b1' })}
                onSave={onSave}
                bots={[bot({ id: 'b1', name: 'Macro' })]}
            />,
        );
        fireEvent.click(screen.getByTestId('automation-run-as-bot'));
        fireEvent.click(screen.getByRole('option', { name: /No — run the full ensemble/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        // Ensemble mode without analyst seats → validation error, not a save.
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByText('Pick at least one analyst model.')).toBeTruthy();
    });
});

describe('AutomationRunCard — bot runs & skips (G5)', () => {
    const botRun = (over: Partial<AutomationRun>): AutomationRun => ({
        id: 'run1', automationId: 'a1', status: 'complete',
        startedAt: '2026-09-02T09:00:00.000Z', finishedAt: '2026-09-02T09:00:05.000Z',
        ...over,
    });

    it('renders the persona reply in the bubble (never an empty Neutral card)', () => {
        render(<AutomationRunCard run={botRun({
            userMessage: { id: 'u1', role: MessageRole.USER, text: 'brief me', createdAt: '2026-09-02T09:00:00.000Z' } as Message,
            message: { id: 'm1', role: MessageRole.AI, text: 'Dollar bid into the open.', createdAt: '2026-09-02T09:00:05.000Z' } as Message,
        })} modelIdToName={{}} />);
        expect(screen.getByText('Dollar bid into the open.')).toBeTruthy();
        expect(screen.getByText('Bot reply')).toBeTruthy();
        expect(screen.queryByText('Neutral')).toBeNull();
        // No outcome buttons — nothing to confirm without an analysis.
        expect(screen.queryByRole('button', { name: 'Win' })).toBeNull();
    });

    it('surfaces the skip reason in the card body and on the badge tooltip', () => {
        render(<AutomationRunCard run={botRun({
            status: 'skipped',
            error: "Macro's provider is not configured (missing, disabled, or the model is off the list).",
        })} modelIdToName={{}} />);
        expect(screen.getByText(/Skipped — Macro's provider is not configured/)).toBeTruthy();
        expect(screen.getByText('Skipped').getAttribute('title')).toContain('not configured');
    });

    it('keeps the ensemble analysis rendering byte-identical (regression guard)', () => {
        const { container } = render(<AutomationRunCard run={botRun({
            message: {
                id: 'm1', role: MessageRole.AI, text: '', createdAt: '2026-09-02T09:00:05.000Z',
                analysis: { direction: 'Long', coinName: 'BTCUSDT', confidence: 'High' },
            } as unknown as Message,
        })} modelIdToName={{}} />);
        // The markdown summary renders through MarkdownContent (inline
        // elements), so assert on the flattened text.
        expect(container.textContent).toContain('BTCUSDT · Long · High');
        expect(screen.getByText('Long')).toBeTruthy();
        expect(screen.queryByText('Bot reply')).toBeNull();
    });
});
