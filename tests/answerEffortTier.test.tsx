/**
 * The thinking tier lands on the ANSWER.
 *
 * The composer lets the trader pick a tier, and the tier decides how hard the
 * model is asked to think — but nothing about the ANSWER recorded which tier
 * produced it. So a transcript could not say "this one was a Max run" and a
 * cost could not be compared across two answers: the fact existed only in the
 * request, which is gone by the time the row is read.
 *
 * This pins the whole path, because a tier that is written but not shown, or
 * shown but not written, is the same defect wearing a different hat:
 *
 *   the executor RESOLVES the tier → the outcome CARRIES it → the run/entry
 *   RECORDS it → the row SHOWS it.
 *
 * And the chip's word comes from the ONE ladder (`effortScale.ts`), so the
 * composer's panel and the answer's row cannot spell the same tier two ways.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { render, screen } from '@testing-library/react';
import ChatTranscriptRow, { type ChatRowView } from '../components/shared/ChatTranscriptRow';
import { messageTraceText } from '../utils/traceText';
import { EFFORT_CHOICES, effortChoiceOf } from '../components/shared/effortScale';

const base: ChatRowView = {
    id: 'm1',
    role: 'ai',
    text: 'long above 69000, stop 67500',
    timeLabel: '5m ago',
};

describe('the thinking tier on the answer row', () => {
    it('shows the tier, spelled by the one ladder', () => {
        render(<ChatTranscriptRow row={{ ...base, effort: 'high' }} />);
        const chip = screen.getByTestId('thinking-tier-chip');
        expect(chip.textContent).toBe(effortChoiceOf('high').label);
        expect(chip.textContent).toBe('High');
    });

    it('says what it is — the glyph alone would be a riddle', () => {
        render(<ChatTranscriptRow row={{ ...base, effort: 'max' }} />);
        expect(screen.getByLabelText('Thinking tier: Max')).toBeDefined();
        expect(screen.getByTitle('Thinking tier: Max')).toBeDefined();
    });

    it('is a REPORT, not a control — a chip you can press is a second dial', () => {
        // The tier was decided when the turn was sent. The row reports it; it
        // does not offer a second place to change it.
        const { container } = render(<ChatTranscriptRow row={{ ...base, effort: 'high' }} />);
        const chip = screen.getByTestId('thinking-tier-chip');
        expect(chip.tagName).toBe('SPAN');
        expect(container.querySelector('button [data-testid="thinking-tier-chip"]')).toBeNull();
    });

    it('is MUTED — it must not compete with the answer', () => {
        const { container } = render(<ChatTranscriptRow row={{ ...base, effort: 'high' }} />);
        const chip = screen.getByTestId('thinking-tier-chip');
        expect(chip.className).toMatch(/text-zinc-6/);
        expect(chip.className).not.toMatch(/text-zinc-100/);
    });

    it('shows nothing on a row that does not know its tier', () => {
        // Rows written before the tier was recorded must show nothing, not a
        // guess: a wrong tier on an old answer is a lie about the run.
        render(<ChatTranscriptRow row={base} />);
        expect(screen.queryByTestId('thinking-tier-chip')).toBeNull();
    });

    it('never shows on the trader\'s own row', () => {
        render(<ChatTranscriptRow row={{ ...base, role: 'user', effort: 'high' }} />);
        expect(screen.queryByTestId('thinking-tier-chip')).toBeNull();
    });

    it('reads every tier on the ladder without a special case', () => {
        for (const choice of EFFORT_CHOICES) {
            const { unmount } = render(<ChatTranscriptRow row={{ ...base, effort: choice.id }} />);
            expect(screen.getByTestId('thinking-tier-chip').textContent).toBe(choice.label);
            unmount();
        }
    });
});

describe('the tier is written once, by the executor that sent it', () => {
    it('the tool turn carries the tier OUT of the outcome', () => {
        // Source contract: the outcome is where every writer reads it from. A
        // second resolution at the write site is how two rows end up claiming
        // different tiers for one turn.
        const src = readFileSync('services/trade/toolTurn.ts', 'utf8');
        expect(src).toMatch(/effort: req\.effort/);
        expect(src).toMatch(/effort: ReasoningEffort;/);
    });

    it('the pipeline records it on the run, and the Chat surface reads it there', () => {
        const pipeline = readFileSync('hooks/useAnalysisPipeline.ts', 'utf8');
        expect(pipeline).toMatch(/effort: toolTurn\.effort/);
        expect(pipeline).toMatch(/effort: out\.effort/);

        const agents = readFileSync('components/agents/AgentsView.tsx', 'utf8');
        expect(agents).toMatch(/effort: m\.runStats\?\.effort/);
    });

    it('the dock records it on the entry, and the dock\'s row shows it', () => {
        const runner = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
        expect(runner).toMatch(/effort: outcome\.effort/);

        const list = readFileSync('components/trade/panels/ChatTranscriptList.tsx', 'utf8');
        expect(list).toMatch(/ThinkingTierChip effort=\{e\.effort\}/);
    });

    it('a dock-originated answer keeps its tier in the OTHER home', () => {
        // The dock commits its answer into the Chat thread. If the tier stopped
        // at the dock's edge, the same answer would show a tier in one home and
        // none in the other — and the Chat surface renders from the Message, so
        // the Message is the carrier.
        const runner = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
        expect(runner).toMatch(/workedMs: workedMsFor\(soloStartedAt\), effort: turnEffort/);

        const app = readFileSync('App.tsx', 'utf8');
        expect(app).toMatch(/effort: row\.effort/);
        expect(app).toMatch(/\(effort \? \{ effort \} : \{\}\)/);
    });

    it('resolves the tier ONCE per runner, so the request and the row agree', () => {
        const runner = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
        // Exactly one resolution in the runner: the transport, the tool turn
        // and the recorded row all read the same value.
        const resolutions = runner.match(/resolveComposerEffort\(/g) ?? [];
        expect(resolutions).toHaveLength(1);
        expect(runner).toMatch(/const turnEffort = resolveComposerEffort\(effort, 'tradingDecision'\);/);
    });
});

describe('messageTraceText — ONE seam for a message\'s trace', () => {
    it('joins the live map\'s lanes', () => {
        expect(messageTraceText({ thoughtProcesses: { a: 'one', b: 'two' } })).toBe('one\n\ntwo');
    });

    it('folds the deleted debate engine\'s lane in, so old rows keep their trace', () => {
        // The engine wrote the moderator's trace into `reasoningProcesses`.
        // Nothing writes that key any more, but rows persisted before the
        // deletion still carry it — and dropping it unread would blank the
        // Thinking row on those old transcripts.
        const legacy = { reasoningProcesses: { moderator: 'Weighing the sweep.' } };
        expect(messageTraceText(legacy as never)).toContain('Weighing the sweep.');
    });

    it('skips empty lanes and joins the rest', () => {
        expect(messageTraceText({ thoughtProcesses: { a: '  ', b: 'two' } })).toBe('two');
        expect(messageTraceText({})).toBe('');
    });
});
