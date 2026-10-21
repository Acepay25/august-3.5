import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import AutomationEditorModal from '../components/automation/AutomationEditorModal';
import AutomationRunCard from '../components/automation/AutomationRunCard';
import AutomationView from '../components/automation/AutomationView';
import type { AgentBot } from '../services/agents/agentRoster';
import type { AutomationConfig, AutomationRun } from '../types/automation';
import { MessageRole } from '../types/enums';
import type { Message } from '../types/message';

// The two automation surfaces: the "Run as bot" selector in the automation
// editor, and how a run renders in the card feed. The per-bot Routines
// disclosure lives on the Agents surface and is covered in
// tests/agentsSurface.test.tsx.

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
 promptTemplate: 'brief me', mode: 'standard',
 moderatorModel: { providerId: '', modelId: '' },
    createdAt: 0, updatedAt: 0, runCount: 0, ...over,
});

describe('AutomationEditorModal — Run as bot', () => {
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
        expect(saved.moderatorModel).toEqual({ providerId: '', modelId: '' });
    });

    it('switching back from a bot run saves the moderator-only route', () => {
        const onSave = vi.fn();
        render(
            <AutomationEditorModal
                {...editorBase}
                isVisible
                initial={routine({ botId: 'b1', moderatorModel: { providerId: 'p1', modelId: 'm1' } })}
                onSave={onSave}
                bots={[bot({ id: 'b1', name: 'Macro' })]}
            />,
        );
        fireEvent.click(screen.getByTestId('automation-run-as-bot'));
        fireEvent.click(screen.getByRole('option', { name: /No — run the analysis pipeline/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(onSave).toHaveBeenCalledTimes(1);
        const saved = onSave.mock.calls[0][0] as AutomationConfig;
        expect(saved.botId).toBeUndefined();
        expect(saved.moderatorModel).toEqual({ providerId: 'p1', modelId: 'm1' });
    });
});

describe('AutomationRunCard — bot runs & skips', () => {
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

    it('keeps an analysis rendering byte-identical (regression guard)', () => {
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

// E-57 §6. The run's caveats used to be a toast and a sentence of prose; this is
// the half that makes them a RECORD the trader can still read after the toast is
// gone — and the half that keeps the record from printing the same sentence
// twice on a card that already shows the prose.
describe('AutomationRunCard — the caveats a run recorded (E-57 §6)', () => {
    const run = (over: Partial<AutomationRun>): AutomationRun => ({
        id: 'run1', automationId: 'a1', status: 'complete',
        startedAt: '2026-09-02T09:00:00.000Z', finishedAt: '2026-09-02T09:00:05.000Z',
        ...over,
    });
    const analysisMessage = {
        id: 'm1', role: MessageRole.AI, text: '', createdAt: '2026-09-02T09:00:05.000Z',
        analysis: { direction: 'Long', coinName: 'BTCUSDT', confidence: 'High' },
        modelsUsed: { p1: 'gpt-x' },
    } as unknown as Message;

    it('prints the caveat in the open, not behind a toggle, on the bubble that drops the prose', () => {
        const { container } = render(<AutomationRunCard run={run({
            message: analysisMessage,
            notices: ['NO MARKET LOOKUP: this turn answered without calling a market tool.'],
            plans: { presented: 1, refused: 1 },
        })} modelIdToName={{ 'gpt-x': 'OpenAI · GPT-X' }} />);
        const block = screen.getByTestId('automation-run-caveats');
        expect(block.textContent).toContain('NO MARKET LOOKUP');
        expect(block.textContent).toContain('1 caveat on this run');
        // The whole point of the block is that it is read WITHOUT a click, so it
        // must not be a disclosure's hidden body.
        expect(block.querySelector('details')).toBeNull();
        expect(block.closest('details')).toBeNull();
        // The bubble path that dropped the caveats before this landed still
        // renders its own summary — the block is additive, not a replacement.
        expect(container.textContent).toContain('BTCUSDT · Long · High');
        expect(screen.getByTestId('automation-run-plans').textContent)
            .toContain('Plans: 1 allowed, 1 refused by the ration.');
    });

    it('shows which model answered, read off the row that already stores it', () => {
        render(<AutomationRunCard run={run({ message: analysisMessage })} modelIdToName={{ 'gpt-x': 'OpenAI · GPT-X' }} />);
        expect(screen.getByTestId('automation-run-model').textContent).toBe('OpenAI · GPT-X');
    });

    it('falls back to the raw id when the label map misses, instead of saying nothing', () => {
        render(<AutomationRunCard run={run({ message: analysisMessage })} modelIdToName={{}} />);
        expect(screen.getByTestId('automation-run-model').textContent).toBe('gpt-x');
    });

    it('does NOT repeat a caveat the bubble already prints in full', () => {
        // The proposal path and a bot reply render `message.text` whole, and the
        // turn writes its notices INTO that text on purpose (the next scheduled
        // run reads them off the wire). A second copy under the sentence would be
        // one caveat spelled twice on one card.
        const notice = 'PLAN CAP REACHED: 1 extra plan(s) refused by this schedule.';
        const { container } = render(<AutomationRunCard run={run({
            message: {
                id: 'm1', role: MessageRole.AI, createdAt: '2026-09-02T09:00:05.000Z',
                text: `Reclaim of the daily VWAP.\n\n${notice}`,
                proposal: {
                    symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 95,
                    takeProfits: [115], planId: 'p1',
                },
            } as unknown as Message,
            notices: [notice],
        })} modelIdToName={{}} />);
        expect(screen.queryByTestId('automation-run-caveats')).toBeNull();
        const occurrences = (container.textContent || '').split(notice).length - 1;
        expect(occurrences).toBe(1);
    });

    it('an error run with no message at all still carries its caveats', () => {
        render(<AutomationRunCard run={run({
            status: 'error', error: '429 from the provider',
            notices: ['TOOL FAILURE(S): get_order_book came back with no data.'],
        })} modelIdToName={{}} />);
        expect(screen.getByText('429 from the provider')).toBeTruthy();
        expect(screen.getByTestId('automation-run-caveats').textContent).toContain('get_order_book');
        // No message, so no model line — absence, not a guess.
        expect(screen.queryByTestId('automation-run-model')).toBeNull();
    });

    it('control: a clean run with nothing to report prints nothing', () => {
        render(<AutomationRunCard run={run({ message: analysisMessage })} modelIdToName={{ 'gpt-x': 'OpenAI · GPT-X' }} />);
        expect(screen.queryByTestId('automation-run-caveats')).toBeNull();
        expect(screen.queryByTestId('automation-run-plans')).toBeNull();
    });
});

describe('AutomationView — the breaker says what it did (E-57 §6)', () => {
    const viewConfig = (over: Partial<AutomationConfig>): AutomationConfig => ({
        id: 'a1', name: 'Hourly sweep', enabled: false, schedule: { cron: '0 * * * *' },
        inputSource: 'template', promptTemplate: 'sweep BTC', mode: 'standard',
        moderatorModel: { providerId: '', modelId: '' },
        createdAt: 0, updatedAt: 0, runCount: 9, ...over,
    });
    const handlers = {
        isLoadingRuns: false, isRunning: false, onBack: vi.fn(), onEdit: vi.fn(),
        onDelete: vi.fn(), onRunNow: vi.fn(), onToggleEnabled: vi.fn(), onRefresh: vi.fn(),
        modelIdToName: {},
    };

    it('names the breaker as the reason, in the open', () => {
        render(<AutomationView config={viewConfig({
            disabledReason: 'Turned itself off after 3 runs in a row that produced nothing (last: 429). Switch Scheduled back on to let it try again — that clears the counter.',
            consecutiveFailures: 3,
        })} runs={[]} {...handlers} />);
        const banner = screen.getByTestId('automation-disabled-reason');
        expect(banner.textContent).toContain('Turned off after runs that produced nothing');
        expect(banner.textContent).toContain('3 runs in a row');
        // The badge alone cannot tell the two apart, so the banner is the claim.
        expect(screen.getByText('Off')).toBeTruthy();
    });

    it('control: a schedule the trader switched off shows no breaker banner', () => {
        render(<AutomationView config={viewConfig({})} runs={[]} {...handlers} />);
        expect(screen.queryByTestId('automation-disabled-reason')).toBeNull();
        expect(screen.getByText('Off')).toBeTruthy();
    });
});
