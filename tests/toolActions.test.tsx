import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import { toolActionFromResult } from '../services/analysis/DeskToolsService';
import { ToolActionsRow } from '../components/chat/ToolActionsRow';
import { appendToolActions, toolActionStamp, MAX_TOOL_ACTIONS } from '../utils/toolActions';
import { Message, ToolAction } from '../types/message';
import { MessageRole } from '../types/enums';

afterEach(cleanup);

describe('toolActionFromResult (proposal classification)', () => {
    it('forge_tool receipt → proposed action pointing at Settings → AI Models', () => {
        const action = toolActionFromResult(
            'forge_tool', true,
            JSON.stringify({ proposed: true, id: 'tool-123', status: 'candidate' }),
            'Macro',
        );
        expect(action).not.toBeNull();
        expect(action!.tool).toBe('forge_tool');
        expect(action!.verb).toBe('proposed');
        expect(action!.label).toBe('tool-123');
        expect(action!.review).toBe('Settings → AI Models');
        expect(action!.speaker).toBe('Macro');
        expect(action!.ok).toBe(true);
    });

    it('amend_memory receipt → amended action pointing at Settings → Memory', () => {
        const action = toolActionFromResult(
            'amend_memory', true,
            JSON.stringify({ proposed: true, id: 'amend-9', status: 'pending' }),
            'Ledger',
        );
        expect(action!.verb).toBe('amended');
        expect(action!.label).toBe('notebook/amend-9');
        expect(action!.review).toBe('Settings → Memory');
    });

    it('custom_ tool receipt → created action', () => {
        const action = toolActionFromResult(
            'custom_sketch-momentum', true,
            JSON.stringify({ name: 'sketch-momentum', rows: 3 }),
            '',
        );
        expect(action!.verb).toBe('created');
        expect(action!.label).toBe('sketch-momentum');
    });

    it('data tools are NOT actions (reads, not changes)', () => {
        expect(toolActionFromResult('get_order_book', true, '{"bids":[]}', 'Macro')).toBeNull();
        expect(toolActionFromResult('web_search', true, '{"hits":[]}', 'Macro')).toBeNull();
        expect(toolActionFromResult('amend_memory', true, 'x', 'M')).not.toBeNull();
    });

    it('a rejected proposal is a failed action with nothing stored', () => {
        const action = toolActionFromResult('forge_tool', false, 'forge_tool rejected: name too short', 'Macro');
        expect(action!.ok).toBe(false);
        expect(action!.label).toBe('rejected');
        expect(action!.review).toBe('');
    });
});

describe('ToolActionsRow (Hermes-style status rows)', () => {
    it('groups by tool with a count chip and the review location', () => {
        render(
            <ToolActionsRow
                actions={[
                    { at: new Date().toISOString(), speaker: 'Macro', tool: 'forge_tool', ok: true, verb: 'proposed', label: 'tool-a', review: 'Settings → AI Models' },
                    { at: new Date().toISOString(), speaker: 'Ledger', tool: 'forge_tool', ok: true, verb: 'proposed', label: 'tool-b', review: 'Settings → AI Models' },
                    { at: new Date().toISOString(), speaker: 'Raven', tool: 'amend_memory', ok: true, verb: 'amended', label: 'notebook/x', review: 'Settings → Memory' },
                ]}
            />,
        );
        const row = screen.getByTestId('tool-actions-row');
        expect(row.textContent).toContain('Desk tools proposed — review in Settings → AI Models');
        expect(row.textContent).toContain('Memory amendment proposed — review in Settings → Memory');
        expect(row.textContent).toContain('2');
        expect(row.textContent).toContain('Macro, Ledger');
    });

    it('failed proposals render the ⚠ nothing-stored row', () => {
        render(
            <ToolActionsRow
                actions={[
                    { at: new Date().toISOString(), speaker: 'Macro', tool: 'amend_memory', ok: false, verb: 'amended', label: 'rejected', review: '' },
                ]}
            />,
        );
        const row = screen.getByTestId('tool-actions-row');
        expect(row.textContent).toContain('⚠');
        expect(row.textContent).toContain('rejected — nothing stored');
    });

    it('renders nothing without actions', () => {
        const { container } = render(<ToolActionsRow actions={[]} />);
        expect(container.querySelector('[data-testid="tool-actions-row"]')).toBeNull();
    });

    it('skill draft rows point at the Coach inbox', () => {
        render(
            <ToolActionsRow
                actions={[{ at: toolActionStamp(), speaker: 'Coach', tool: 'skill_draft', ok: true, verb: 'crafted', label: 'Fade the reclaim', review: 'the Coach inbox' }]}
            />,
        );
        expect(screen.getByTestId('tool-actions-row').textContent).toContain('Skill draft queued — review with the Coach');
    });

    it('evidence-created skills show the skill slug', () => {
        render(
            <ToolActionsRow
                actions={[{ at: toolActionStamp(), speaker: 'Coach', tool: 'skill_ingest', ok: true, verb: 'created', label: 'fade-reclaim-btc', review: 'Settings → Skills' }]}
            />,
        );
        expect(screen.getByTestId('tool-actions-row').textContent).toContain('Skill created from evidence — fade-reclaim-btc');
    });

    it('notebook notes show created vs appended with the file path', () => {
        const { rerender } = render(
            <ToolActionsRow
                actions={[{ at: toolActionStamp(), speaker: 'Coach', tool: 'notebook_note', ok: true, verb: 'created', label: 'lessons/reclaim-fades', review: 'Settings → Memory' }]}
            />,
        );
        expect(screen.getByTestId('tool-actions-row').textContent).toContain('Notebook created — lessons/reclaim-fades');
        rerender(
            <ToolActionsRow
                actions={[{ at: toolActionStamp(), speaker: 'Coach', tool: 'notebook_note', ok: true, verb: 'appended', label: 'lessons/reclaim-fades', review: 'Settings → Memory' }]}
            />,
        );
        expect(screen.getByTestId('tool-actions-row').textContent).toContain('Notebook appended — lessons/reclaim-fades');
    });
});

describe('appendToolActions (ledger helper)', () => {
    const base: Message[] = [{
        id: 'm1', role: MessageRole.AI, text: 'x', createdAt: new Date().toISOString(),
    }];
    const action: ToolAction = {
        at: toolActionStamp(), speaker: 'Macro', tool: 'forge_tool', ok: true,
        verb: 'proposed', label: 'tool-1', review: 'Settings → AI Models',
    };

    it('appends onto the target message only', () => {
        const next = appendToolActions(base, 'm1', [action]);
        expect(next[0].toolActions?.length).toBe(1);
        expect(next.length).toBe(1);
    });

    it('is a no-op when the message id is missing', () => {
        const next = appendToolActions(base, 'nope', [action]);
        expect(next[0].toolActions).toBeUndefined();
    });

    it('caps the ledger at MAX_TOOL_ACTIONS', () => {
        const many: ToolAction[] = Array.from({ length: MAX_TOOL_ACTIONS + 10 }, (_, i) => ({ ...action, label: `t${i}` }));
        const next = appendToolActions(base, 'm1', many);
        expect(next[0].toolActions?.length).toBe(MAX_TOOL_ACTIONS);
    });
});
