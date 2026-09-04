import { describe, it, expect } from 'vitest';

import { isEnsembleMessage, stageActorsForMessage } from '../utils/debateStageActors';
import type { Message } from '../types';
import { MessageRole } from '../types';

const base = (over: Partial<Message>): Message => ({
    id: 'm1',
    role: MessageRole.AI,
    text: '',
    createdAt: '2026-08-28T00:00:00.000Z',
    ...over,
});

describe('isEnsembleMessage', () => {
    it('is false for a plain chat message', () => {
        expect(isEnsembleMessage(base({}))).toBe(false);
    });
    it('is true when isDebating', () => {
        expect(isEnsembleMessage(base({ isDebating: true }))).toBe(true);
    });
    it('is true when ensembleProgress is present', () => {
        expect(isEnsembleMessage(base({
            ensembleProgress: { analysts: [], moderator: { status: 'waiting' } },
        }))).toBe(true);
    });
    it('is true when more than one model contributed', () => {
        expect(isEnsembleMessage(base({ modelsUsed: { a: 'm-a', b: 'm-b' } }))).toBe(true);
    });
    it('is false for a single-model message', () => {
        expect(isEnsembleMessage(base({ modelsUsed: { a: 'm-a' } }))).toBe(false);
    });
});

describe('stageActorsForMessage', () => {
    it('returns [] for a non-ensemble message', () => {
        expect(stageActorsForMessage(base({}))).toEqual([]);
    });

    it('builds one actor per distinct speaker, in first-seen order', () => {
        const msg = base({
            isDebating: true,
            debateTurns: [
                { speaker: 'Macro', text: 'ranging regime' },
                { speaker: 'Technical', text: 'two false breakouts' },
                { speaker: 'Macro', text: 'still ranging' },
            ],
        });
        const actors = stageActorsForMessage(msg);
        expect(actors.map(a => a.name)).toEqual(['Macro', 'Technical']);
    });

    it('adds active speakers that have no turn yet', () => {
        const msg = base({
            isDebating: true,
            debateTurns: [{ speaker: 'Macro', text: 'hello' }],
            activeDebateSpeakers: { Risk: 1 },
        });
        const actors = stageActorsForMessage(msg);
        expect(actors.map(a => a.name)).toContain('Risk');
    });

    it('seeds a Moderator actor when debating but no speakers exist yet', () => {
        const msg = base({ isDebating: true, debateTurns: [] });
        const actors = stageActorsForMessage(msg);
        expect(actors).toHaveLength(1);
        expect(actors[0].name).toBe('Moderator');
    });

    it('carries seat role/focus tags from the run ledger onto the actor (u1)', () => {
        const msg = base({
            isDebating: true,
            debateTurns: [
                { speaker: 'Kilo', text: 'structure intact' },
                { speaker: 'Kilo #2', text: 'risk is the trade' },
            ],
            runStats: {
                startedAt: '2026-09-04T00:00:00.000Z',
                finishedAt: '2026-09-04T00:01:00.000Z',
                durationMs: 60_000,
                analysts: [
                    { providerId: 'p1', displayName: 'Kilo', modelId: 'm1', seatRole: 'Macro' },
                    { providerId: 'p2', displayName: 'Kilo #2', modelId: 'm2', seatFocus: 'risk' },
                ],
            },
        });
        const actors = stageActorsForMessage(msg);
        const kilo = actors.find(a => a.name === 'Kilo');
        const kilo2 = actors.find(a => a.name === 'Kilo #2');
        expect(kilo?.seatRole).toBe('Macro');
        expect(kilo?.seatFocus).toBeUndefined();
        expect(kilo2?.seatRole).toBeUndefined();
        expect(kilo2?.seatFocus).toBe('risk');
    });

    it('fuzzy-matches ledger display names to speaker names (suffix variants)', () => {
        const msg = base({
            isDebating: true,
            debateTurns: [{ speaker: 'Gemini Pro', text: 'go' }],
            runStats: {
                startedAt: '2026-09-04T00:00:00.000Z',
                finishedAt: '2026-09-04T00:01:00.000Z',
                durationMs: 60_000,
                analysts: [{ providerId: 'p1', displayName: 'Gemini Pro (2)', modelId: 'm1', seatRole: 'Risk' }],
            },
        });
        const [actor] = stageActorsForMessage(msg);
        expect(actor.seatRole).toBe('Risk');
    });

    it('marks the active speaker as speaking with its newest speech line', () => {
        const msg = base({
            isDebating: true,
            debateTurns: [
                { speaker: 'Macro', text: 'first thought' },
                { speaker: 'Macro', text: 'newer thought' },
            ],
            activeDebateSpeakers: { Macro: 1 },
        });
        const [macro] = stageActorsForMessage(msg);
        expect(macro.speaking).toBe(true);
        expect(macro.thinking).toBe(false);
        expect(macro.speech).toBe('newer thought');
    });

    it('marks an active speaker with no text yet as thinking', () => {
        const msg = base({
            isDebating: true,
            debateTurns: [],
            activeDebateSpeakers: { Macro: 1 },
        });
        const actors = stageActorsForMessage(msg);
        const macro = actors.find(a => a.name === 'Macro');
        expect(macro?.thinking).toBe(true);
        expect(macro?.speaking).toBe(false);
    });

    it('builds a replying-to chip from the turn addressing', () => {
        const msg = base({
            isDebating: true,
            debateTurns: [
                { speaker: 'Technical', text: 'I disagree', to: ['Macro'] } as never,
            ],
        });
        const [tech] = stageActorsForMessage(msg);
        expect(tech.toolChip).toBe('replying to Macro');
    });

    it('falls back to the newest live tool line when there is no reply-to', () => {
        const msg = base({
            isDebating: true,
            debateTurns: [{ speaker: 'Macro', text: 'checking' }],
            liveToolEvents: { Macro: 'fetched klines\ncomputed ADX' },
        });
        const [macro] = stageActorsForMessage(msg);
        expect(macro.toolChip).toBe('fetched klines');
    });

    it('builds the cost/latency meta from run stats', () => {
        const msg = base({
            isDebating: false,
            modelsUsed: { a: 'm-a', b: 'm-b' },
            debateTurns: [{ speaker: 'Macro', text: 'done' }],
            runStats: {
                startedAt: '2026-08-28T00:00:00.000Z',
                finishedAt: '2026-08-28T00:01:00.000Z',
                durationMs: 60000,
                costUsd: 0.02,
                analysts: [
                    { providerId: 'a', displayName: 'Macro', modelId: 'gemini-2.5-pro', durationMs: 41000, charsOut: 1200 },
                ],
            },
        });
        const [macro] = stageActorsForMessage(msg);
        expect(macro.meta).toContain('Macro');
        expect(macro.meta).toContain('gemini-2.5-pro');
        expect(macro.meta).toContain('41s');
    });
});
