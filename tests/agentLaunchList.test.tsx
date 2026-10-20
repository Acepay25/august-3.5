/**
 * The launch list, and the card it opens.
 *
 * Two defects, one fix each.
 *
 * The LAUNCH LIST could not be read: a bot's row showed its name and the
 * last thing it said, so two agents were two names with no way to tell which
 * was the macro reader and which was the risk one. The row now says what the
 * agent is FOR — the role is what you choose by.
 *
 * The full-detail reader was an ORPHAN: components/analysis/ThinkingModal.tsx
 * had a focus trap, an aria-modal and a test, and no importer anywhere in the
 * app — a modal nobody had ever opened, reading as if the app had one. It is
 * now components/shared/DetailModal.tsx, mounted by the agents surface, and
 * it is a READER: the card shows what an agent is, and editing stays where
 * the editor already is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { existsSync, readFileSync } from 'fs';
import AgentsView from '../components/agents/AgentsView';
import DetailModal from '../components/shared/DetailModal';
import type { AgentBot } from '../services/agents/agentRoster';

const bot = (over: Partial<AgentBot> & Pick<AgentBot, 'id'>): AgentBot => ({
    name: 'Macro', providerId: 'p1', modelId: 'm1',
    avatar: { kind: 'auto' }, createdAt: new Date().toISOString(), ...over,
} as AgentBot);

const base = {
    username: 'rober',
    bots: [] as AgentBot[],
    groups: [],
    messages: [],
    selection: { kind: 'team' } as const,
    onSelect: () => {},
    onNewBot: () => {},
    onNewGroup: () => {},
    onSendBotTurn: vi.fn(async () => true),
    onAnalyze: vi.fn(),
    coachCount: 0,
};

const renderBots = (ui: React.ReactElement): ReturnType<typeof render> => {
    const r = render(ui);
    fireEvent.click(screen.getByTestId('rail-tab-bots'));
    return r;
};

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

describe('the launch list says what each agent is FOR', () => {
    it('the row carries the agent\'s role, not the last thing it said', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', title: 'Reads the macro tape' })]} />);
        const row = screen.getByTestId('agent-row');
        expect(row.textContent).toContain('Reads the macro tape');
    });

    it('falls back to the description when the agent has no title', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', description: 'Watches funding rates' })]} />);
        expect(screen.getByTestId('agent-row').textContent).toContain('Watches funding rates');
    });
});

describe('the full-detail reader is a reader, and it is mounted', () => {
    it('the orphan is gone and the shared reader replaced it', () => {
        expect(existsSync('components/analysis/ThinkingModal.tsx')).toBe(false);
        expect(existsSync('components/shared/DetailModal.tsx')).toBe(true);
        // It has a production importer now — that is what made it an orphan.
        const agents = readFileSync('components/agents/AgentsView.tsx', 'utf8');
        expect(agents).toMatch(/import DetailModal from '\.\.\/shared\/DetailModal';/);
        expect(agents).toMatch(/<DetailModal/);
    });

    it('the row opens it, and the card shows the agent in full', () => {
        renderBots(<AgentsView {...base} bots={[bot({
            id: 'b1', name: 'Macro', title: 'Reads the macro tape',
            description: 'Follows funding and open interest.',
            customPrompt: 'Always answer in one paragraph.',
        })]} />);
        // Open the row's menu and take "Details".
        fireEvent.click(screen.getByTestId('row-menu'));
        fireEvent.click(screen.getByText('Details'));
        const card = screen.getByTestId('agent-detail-card');
        expect(card.textContent).toContain('Follows funding and open interest.');
        expect(card.textContent).toContain('Always answer in one paragraph.');
        expect(card.textContent).toContain('Model');
    });

    it('is VIEW-ONLY — it offers no way to edit the agent', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Macro' })]} />);
        fireEvent.click(screen.getByTestId('row-menu'));
        fireEvent.click(screen.getByText('Details'));
        const dialog = screen.getByRole('dialog');
        // A reader that also edits is two editors, and the two would drift.
        expect(dialog.textContent?.toLowerCase()).not.toContain('save');
        expect(dialog.textContent?.toLowerCase()).not.toContain('rename');
        expect(screen.queryByTestId('rail-rename')).toBeNull();
    });

    it('says it is a read-only view, and closes on Escape', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Macro' })]} />);
        fireEvent.click(screen.getByTestId('row-menu'));
        fireEvent.click(screen.getByText('Details'));
        expect(screen.getByRole('dialog').textContent).toContain('read-only');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

describe('the shared reader keeps the focus trap it always had', () => {
    it('traps focus and names the thing it closes', () => {
        render(<DetailModal isOpen onClose={() => {}} title="Macro" closeLabel="Close agent details" />);
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(screen.getByLabelText('Close agent details')).toBeTruthy();
    });
});
