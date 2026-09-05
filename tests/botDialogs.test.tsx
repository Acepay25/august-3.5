import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { NewBotDialog } from '../components/chat/NewBotDialog';
import { NewGroupDialog } from '../components/chat/NewGroupDialog';
import { AgentBot, AgentGroup } from '../services/agents/agentRoster';
import { AnalystRole } from '../types/enums';
import { ProviderConfig } from '../types/provider';

afterEach(cleanup);

let seq = 0;
const bot = (over: Partial<AgentBot>): AgentBot => ({
    id: over.id ?? `b${seq += 1}`,
    name: over.name ?? 'Scout',
    providerId: over.providerId ?? 'p1',
    modelId: over.modelId ?? 'gpt-test',
    avatar: over.avatar ?? { kind: 'auto' },
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const provider = (over: Partial<ProviderConfig>): ProviderConfig => ({
    id: over.id ?? 'p1',
    name: over.name ?? 'Test Provider',
    apiFormat: over.apiFormat ?? 'chat_completions',
    baseUrl: over.baseUrl ?? 'https://example.test/v1',
    apiKey: over.apiKey ?? 'sk-test',
    isEnabled: over.isEnabled ?? true,
    models: over.models ?? ['model-a', 'model-b'],
    selectedModel: over.selectedModel ?? 'model-a',
    ...over,
} as ProviderConfig);

describe('NewBotDialog — Upload tab (R3)', () => {
    const base = {
        open: true,
        onClose: () => {},
        onCreate: () => {},
        providers: [provider({})],
    };

    it('exposes Faces / Upload / Pixel tabs with container-shape choices', () => {
        render(<NewBotDialog {...base} />);
        fireEvent.click(screen.getByTestId('avatar-tab-upload'));
        expect(screen.getByTestId('upload-shape-circle')).toBeTruthy();
        expect(screen.getByTestId('upload-shape-square')).toBeTruthy();
        expect(screen.getByTestId('upload-shape-blob')).toBeTruthy();
        expect(screen.getByTestId('upload-input')).toBeTruthy();
    });

    it('create with an uploaded image stores the upload avatar', () => {
        const onCreate = vi.fn();
        render(<NewBotDialog {...base} onCreate={onCreate} />);
        fireEvent.click(screen.getByTestId('avatar-tab-upload'));
        fireEvent.click(screen.getByTestId('upload-shape-blob'));
        // No image picked: uploadSrc is null, so create falls back to the
        // Auto face — the upload branch requires an actual file.
        fireEvent.change(screen.getByTestId('bot-name'), { target: { value: 'Raven' } });
        fireEvent.click(screen.getByTestId('create-bot'));
        expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Raven',
            avatar: { kind: 'auto' },
        }));
    });
});

describe('NewGroupDialog — edit mode (R4 gear)', () => {
    const bots = [bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' }), bot({ id: 'b3', name: 'Raven' })];
    const grp: AgentGroup = { id: 'g1', memberIds: ['b1', 'b2'], createdAt: new Date().toISOString() };
    const base = {
        open: true,
        onClose: () => {},
        onCreate: () => {},
        bots,
    };

    it('renders as Group Settings with members pre-checked and Save wired', () => {
        const onUpdate = vi.fn();
        render(<NewGroupDialog {...base} initialGroup={grp} onUpdate={onUpdate} />);
        expect(screen.getByText('Group Settings')).toBeTruthy();
        const save = screen.getByTestId('create-group') as HTMLButtonElement;
        expect(save.textContent).toBe('Save');
        // Unchanged membership → Save disabled.
        expect(save.disabled).toBe(true);
        // Add a member → enabled, and Save persists the new roster.
        fireEvent.click(screen.getByTestId('group-member-b3'));
        expect(save.disabled).toBe(false);
        fireEvent.click(save);
        expect(onUpdate).toHaveBeenCalledWith('g1', ['b1', 'b2', 'b3'], {});
    });

    it('a member role change enables Save and rides onUpdate as a botId→role patch', () => {
        const onUpdate = vi.fn();
        render(<NewGroupDialog {...base} initialGroup={grp} onUpdate={onUpdate} />);
        const save = screen.getByTestId('create-group') as HTMLButtonElement;
        // Membership untouched → role picker visible for checked members.
        expect(screen.getByTestId('group-role-row-b1')).toBeTruthy();
        expect(save.disabled).toBe(true);
        fireEvent.click(screen.getByTestId('group-role-b1'));
        fireEvent.click(screen.getByText('Risk'));
        expect(save.disabled).toBe(false);
        fireEvent.click(save);
        expect(onUpdate).toHaveBeenCalledWith('g1', ['b1', 'b2'], { b1: 'risk_execution' });
    });

    it('create mode reports only the roles that differ from the bots’ stored persona', () => {
        const onCreate = vi.fn();
        const roled = [
            bot({ id: 'b1', name: 'Scout', role: AnalystRole.RISK_EXECUTION }),
            bot({ id: 'b2', name: 'Ledger' }),
        ];
        render(<NewGroupDialog open onClose={() => {}} onCreate={onCreate} bots={roled} />);
        fireEvent.click(screen.getByTestId('group-member-b1'));
        fireEvent.click(screen.getByTestId('group-member-b2'));
        // b1 already carries Risk — leaving it untouched is not a change.
        fireEvent.click(screen.getByTestId('create-group'));
        expect(onCreate).toHaveBeenCalledWith(['b1', 'b2'], {});
    });

    it('without edit props it stays the plain create dialog', () => {
        render(<NewGroupDialog {...base} />);
        expect(screen.getByText('New Group Chat')).toBeTruthy();
        expect((screen.getByTestId('create-group') as HTMLButtonElement).textContent).toContain('Create Group');
    });
});

describe('NewBotDialog — debate persona on the bot itself (Team/group merge)', () => {
    const base = {
        open: true,
        onClose: () => {},
        onCreate: () => {},
        providers: [provider({})],
    };

    it('role picker + inherit + instructions ride the bot, not a team seat', () => {
        const onCreate = vi.fn();
        render(<NewBotDialog {...base} onCreate={onCreate} />);
        expect(screen.getByTestId('bot-role')).toBeTruthy();
        // Inherit is absent on the general-analyst default (nothing to inherit).
        expect(screen.queryByTestId('bot-inherit')).toBeNull();
        // Pick Macro via the SelectMenu trigger.
        fireEvent.click(screen.getByTestId('bot-role'));
        fireEvent.click(screen.getByText('Macro'));
        // Inherit fills the instructions box with the built-in role prompt.
        fireEvent.click(screen.getByTestId('bot-inherit'));
        const instructions = screen.getByTestId('bot-instructions') as HTMLTextAreaElement;
        expect(instructions.value.length).toBeGreaterThan(20);
        // Editing wins on conflict.
        fireEvent.change(instructions, { target: { value: 'Focus on funding extremes.' } });
        expect((screen.getByTestId('bot-instructions') as HTMLTextAreaElement).value).toBe('Focus on funding extremes.');
        // The persona rides onCreate (the draft carries role + customPrompt).
        fireEvent.change(screen.getByTestId('bot-name'), { target: { value: 'Macro Bot' } });
        fireEvent.click(screen.getByTestId('create-bot'));
        expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
            role: 'macro_volatility',
            customPrompt: 'Focus on funding extremes.',
        }));
    });
});
