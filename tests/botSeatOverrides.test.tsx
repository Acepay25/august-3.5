/**
 * BotSeatOverridesDialog — the only editor for the three per-seat overrides the
 * debate engine reads (systemPromptOverride, personality, enabledTools).
 *
 * They live on the BotRegistry record whose provider + model match the roster
 * bot, NOT on the roster bot itself, so the two behaviors worth pinning are the
 * match and the miss: a matched row prefills and writes back to that same
 * record, and an unmatched bot says so instead of saving into nothing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

type Row = Record<string, unknown>;

const h = vi.hoisted((): { rows: Row[]; writes: Row[]; set: (rows: Row[]) => void } => {
    const rows: Row[] = [];
    const writes: Row[] = [];
    return {
        rows,
        writes,
        set: (next: Row[]): void => { rows.length = 0; writes.length = 0; rows.push(...next); },
    };
});

vi.mock('../services/bots/BotRegistry', () => ({
    BotRegistry: {
        list: async (): Promise<Row[]> => h.rows.map(r => ({ ...r })),
        upsert: async (bot: Row): Promise<Row> => {
            const i = h.rows.findIndex(r => r.id === bot.id);
            if (i >= 0) h.rows[i] = bot; else h.rows.push(bot);
            h.writes.push(bot);
            return bot;
        },
    },
}));

vi.mock('../services/analysis/DeskToolsService', () => ({
    DESK_TOOL_DEFINITIONS: [
        { function: { name: 'get_price_snapshot' } },
        { function: { name: 'web_search' } },
        { function: { name: 'run_monte_carlo' } },
    ],
}));

import BotSeatOverridesDialog from '../components/agents/BotSeatOverridesDialog';
import type { AgentBot } from '../services/agents/agentRoster';
import { AnalystRole } from '../types/enums';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const seat = (over: Row = {}): Row => ({
    id: 'seat-1',
    name: 'Macro',
    role: AnalystRole.MACRO_VOLATILITY,
    providerId: 'gemini',
    model: 'gemini-2.5-pro',
    memoryScope: 'global',
    enabledTools: ['get_price_snapshot'],
    createdAt: 1,
    updatedAt: 1,
    ...over,
});

const rosterBot: AgentBot = {
    id: 'b1',
    name: 'Scout',
    providerId: 'gemini',
    modelId: 'gemini-2.5-pro',
    avatar: { kind: 'auto' },
    createdAt: new Date().toISOString(),
};

const value = (id: string): string => (screen.getByTestId(id) as HTMLTextAreaElement).value;

describe('BotSeatOverridesDialog', () => {
    it('prefills the seat matched by provider + model', async () => {
        h.set([seat({ systemPromptOverride: 'Only argue from invalidation levels.', personality: 'terse' })]);
        render(<BotSeatOverridesDialog open bot={rosterBot} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('override-prompt')).toBeTruthy());
        expect(value('override-prompt')).toBe('Only argue from invalidation levels.');
        expect(value('override-personality')).toBe('terse');
        expect(screen.getByTestId('override-tool-get_price_snapshot').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('override-tool-web_search').getAttribute('aria-pressed')).toBe('false');
    });

    it('writes the three fields back to that same seat record', async () => {
        h.set([seat()]);
        render(<BotSeatOverridesDialog open bot={rosterBot} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('save-seat-overrides')).toBeTruthy());
        fireEvent.change(screen.getByTestId('override-prompt'), { target: { value: '  refuse ungrounded entries  ' } });
        fireEvent.change(screen.getByTestId('override-personality'), { target: { value: 'terse' } });
        fireEvent.click(screen.getByTestId('override-tool-run_monte_carlo'));
        fireEvent.click(screen.getByTestId('save-seat-overrides'));
        await waitFor(() => expect(h.writes).toHaveLength(1));
        const written = h.writes[0];
        expect(written.id).toBe('seat-1');
        expect(written.systemPromptOverride).toBe('refuse ungrounded entries');
        expect(written.personality).toBe('terse');
        expect(written.enabledTools).toEqual(['get_price_snapshot', 'run_monte_carlo']);
    });

    it('an emptied tool pick keeps the role default rather than revoking everything', async () => {
        h.set([seat({ enabledTools: ['web_search'] })]);
        render(<BotSeatOverridesDialog open bot={rosterBot} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('override-tool-web_search')).toBeTruthy());
        fireEvent.click(screen.getByTestId('override-tool-web_search'));
        expect(screen.getByText(/keeps the role default/)).toBeTruthy();
        fireEvent.click(screen.getByTestId('save-seat-overrides'));
        await waitFor(() => expect(h.writes).toHaveLength(1));
        expect(h.writes[0].enabledTools).toEqual(['web_search']);
    });

    it('says there is nothing to override when no debate seat runs this model', async () => {
        h.set([seat({ providerId: 'other', model: 'something-else' })]);
        render(<BotSeatOverridesDialog open bot={rosterBot} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('save-seat-overrides')).toBeTruthy());
        expect(screen.getByText(/No debate seat runs gemini \/ gemini-2\.5-pro/)).toBeTruthy();
        expect(screen.queryByTestId('override-prompt')).toBeNull();
        expect(screen.getByTestId('save-seat-overrides').hasAttribute('disabled')).toBe(true);
    });
});
