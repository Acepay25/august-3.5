/**
 * Unit tests for hooks/analysisPipeline/streamThrottlers.ts — the pure
 * updater functions only. The hook wrapper is covered by the integration
 * tests in the host hook; here we exercise the un-throttled per-message
 * patchers so the field-shape contract is locked in.
 */
import { describe, it, expect } from 'vitest';
import type { Message, DebateTurn } from '../types';
import { MessageRole } from '../types';
import {
    applyDebateStreamUpdate,
    applyProvisionalVerdictUpdate,
    applyEnsembleProgressUpdate,
    applyCasualStreamUpdate,
    applyOpeningThinkingUpdate,
    type AnalystSeed,
} from '../hooks/analysisPipeline/streamThrottlers';

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-1',
    role: MessageRole.AI,
    text: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    isStreaming: false,
    ...overrides,
});

describe('applyDebateStreamUpdate', () => {
    it('returns prev unchanged when the target message is not found', () => {
        const prev = [baseMessage({ id: 'other' })];
        const result = applyDebateStreamUpdate(
            prev, 'missing',
            [], {}, {}, {}, undefined, {}, [],
        );
        expect(result).toBe(prev);
    });

    it('patches turns + thought/reasoning maps + active speakers + checkpoint', () => {
        const turns: DebateTurn[] = [
            { speaker: 'Macro', round: 1, text: 'macro-thesis', reasoning: 'macro-cot' },
            { speaker: 'Technical', round: 1, text: 'tech-thesis', reasoning: 'tech-cot' },
        ];
        const thoughtMap = { Macro: 'thought-1' };
        const reasoningMap = { Macro: 'reason-1' };
        const active = { Macro: 1 };
        const liveTools = { Macro: 'fetched chart' };
        const runLog: any[] = [{ at: 'now', kind: 'budget', detail: 'wire ok' }];
        const runContract = [{ id: 'opening', label: 'opening', state: 'done' as const }];

        const prev = [baseMessage({ id: 'debate-msg', debateTurns: [] })];
        const result = applyDebateStreamUpdate(
            prev, 'debate-msg', turns, thoughtMap, reasoningMap, active,
            runContract, liveTools, runLog,
        );

        expect(result[0].debateTurns).toEqual(turns);
        expect(result[0].thoughtProcesses).toBe(thoughtMap);
        expect(result[0].reasoningProcesses).toBe(reasoningMap);
        expect(result[0].activeDebateSpeakers).toEqual(active);
        expect(result[0].liveToolEvents).toEqual(liveTools);
        expect(result[0].debateRunLog).toEqual(runLog);
        expect(result[0].runContract).toEqual(runContract);
        // Checkpoint is rebuilt whenever there are turns.
        expect(result[0].debateCheckpoint).toBeDefined();
        expect(result[0].debateCheckpoint?.analystNames).toEqual(['Macro', 'Technical']);
    });

    it('clones live-tool + run-log maps so later mutations do not leak', () => {
        const prev = [baseMessage({ id: 'debate-msg' })];
        const liveTools = { Macro: 'first' };
        const runLog: any[] = [{ at: '1', kind: 'budget', detail: 'first' }];

        const result = applyDebateStreamUpdate(
            prev, 'debate-msg', [], {}, {}, {}, undefined, liveTools, runLog,
        );

        liveTools.Macro = 'second';
        runLog.push({ at: '2', kind: 'budget', detail: 'second' });

        expect(result[0].liveToolEvents?.Macro).toBe('first');
        expect(result[0].debateRunLog).toHaveLength(1);
    });
});

describe('applyProvisionalVerdictUpdate', () => {
    it('skips the patch when the final analysis is already committed', () => {
        const committed = baseMessage({ id: 'debate-msg', analysis: { coinName: 'BTC' } as any });
        const result = applyProvisionalVerdictUpdate([committed], 'debate-msg', undefined, undefined);
        expect(result).toHaveLength(1);
        expect(result[0].provisionalAnalysis).toBeUndefined();
    });

    it('patches provisionalAnalysis + provisionalPlanFields when no final exists', () => {
        const prev = [baseMessage({ id: 'debate-msg' })];
        const provisional: any = { coinName: 'ETH', direction: 'Long' };
        const planFields: Message['provisionalPlanFields'] = { coin: 'ETH', direction: 'Long' };
        const result = applyProvisionalVerdictUpdate(prev, 'debate-msg', provisional, planFields);
        expect(result[0].provisionalAnalysis).toBe(provisional);
        expect(result[0].provisionalPlanFields).toBe(planFields);
    });

    it('returns prev unchanged when target is missing', () => {
        const prev = [baseMessage({ id: 'other' })];
        const result = applyProvisionalVerdictUpdate(prev, 'missing', undefined, undefined);
        expect(result).toBe(prev);
    });
});

describe('applyEnsembleProgressUpdate', () => {
    it('initializes ensembleProgress on a placeholder without one', () => {
        const prev = [baseMessage({ id: 'placeholder' })];
        const result = applyEnsembleProgressUpdate(prev, 'placeholder', 'analyst-A', 'thinking…');
        const progress = result[0].ensembleProgress!;
        expect(progress.analysts).toEqual([]);
        expect(progress.moderator).toEqual({ status: 'waiting' });
    });

    it('patches a single analyst row by thoughtsKey and leaves siblings alone', () => {
        const initial = baseMessage({
            id: 'placeholder',
            ensembleProgress: {
                analysts: [
                    { key: 'analyst-A', displayName: 'A', providerId: 'p1', providerName: 'P1', modelId: 'm1', modelName: 'M1', status: 'analyzing' as const, reasoning: '' },
                    { key: 'analyst-B', displayName: 'B', providerId: 'p2', providerName: 'P2', modelId: 'm2', modelName: 'M2', status: 'analyzing' as const, reasoning: '' },
                ],
                moderator: { status: 'waiting' as const },
            },
        });
        const result = applyEnsembleProgressUpdate([initial], 'placeholder', 'analyst-B', 'b-cot');
        const analysts = result[0].ensembleProgress!.analysts;
        expect(analysts[0].reasoning).toBe('');
        expect(analysts[1].reasoning).toBe('b-cot');
    });

    it('returns prev unchanged when the placeholder id is missing', () => {
        const prev = [baseMessage({ id: 'other' })];
        const result = applyEnsembleProgressUpdate(prev, 'missing', 'analyst-A', 'x');
        expect(result).toBe(prev);
    });
});

describe('applyCasualStreamUpdate', () => {
    it('patches text + isStreaming + thoughtProcesses keyed by providerId', () => {
        const prev = [baseMessage({
            id: 'bubble',
            thoughtProcesses: { prevProvider: 'old' },
        })];
        const result = applyCasualStreamUpdate(prev, 'bubble', 'Hello', 'thinking…', 'gemini', true);
        expect(result[0].text).toBe('Hello');
        expect(result[0].isStreaming).toBe(true);
        expect(result[0].thoughtProcesses).toEqual({ gemini: 'thinking…' });
    });

    it('preserves thoughtProcesses when thinking is empty', () => {
        const prev = [baseMessage({ id: 'bubble', thoughtProcesses: { gemini: 'kept' } })];
        const result = applyCasualStreamUpdate(prev, 'bubble', 'Hello', '', 'gemini', true);
        expect(result[0].thoughtProcesses).toEqual({ gemini: 'kept' });
    });

    it('returns prev unchanged when the bubble id is missing', () => {
        const prev = [baseMessage({ id: 'other' })];
        const result = applyCasualStreamUpdate(prev, 'missing', 'x', 'y', 'p', true);
        expect(result).toBe(prev);
    });
});

describe('applyOpeningThinkingUpdate', () => {
    const analysts: AnalystSeed[] = [
        { name: 'Macro', thoughtsKey: 'k-macro' },
        { name: 'Technical', thoughtsKey: 'k-tech' },
    ];

    it('returns prev unchanged when nothing accumulates yet', () => {
        const prev = [baseMessage({ id: 'opening' })];
        const result = applyOpeningThinkingUpdate(prev, 'opening', analysts, {}, {});
        expect(result).toBe(prev);
    });

    it('folds reasoning + partial text into round-1 turns for each analyst', () => {
        const prev = [baseMessage({ id: 'opening' })];
        const reasoning = { 'k-macro': 'macro-cot', 'k-tech': '' };
        const partial = { 'k-macro': '', 'k-tech': 'tech-partial' };
        const result = applyOpeningThinkingUpdate(prev, 'opening', analysts, reasoning, partial);

        expect(result[0].isDebating).toBe(true);
        expect(result[0].debateTurns).toEqual([
            { speaker: 'Macro', round: 1, text: '', reasoning: 'macro-cot' },
            { speaker: 'Technical', round: 1, text: 'tech-partial', reasoning: '' },
        ]);
        expect(result[0].activeDebateSpeakers).toEqual({ Macro: 1, Technical: 1 });
    });

    it('falls back to analyst name when thoughtsKey is empty', () => {
        const prev = [baseMessage({ id: 'opening' })];
        const noKey: AnalystSeed[] = [{ name: 'Solo', thoughtsKey: '' }];
        const reasoning = { Solo: 'solo-cot' };
        const result = applyOpeningThinkingUpdate(prev, 'opening', noKey, reasoning, {});
        expect(result[0].debateTurns).toEqual([
            { speaker: 'Solo', round: 1, text: '', reasoning: 'solo-cot' },
        ]);
    });

    it('skips analysts whose reasoning AND partial text are both empty', () => {
        const prev = [baseMessage({ id: 'opening' })];
        const reasoning = { 'k-macro': 'macro-cot' }; // tech has none
        const result = applyOpeningThinkingUpdate(prev, 'opening', analysts, reasoning, {});
        expect(result[0].debateTurns).toHaveLength(1);
        expect(result[0].debateTurns[0]!.speaker).toBe('Macro');
    });

    it('returns prev unchanged when the opening message id is missing', () => {
        const prev = [baseMessage({ id: 'other' })];
        const result = applyOpeningThinkingUpdate(prev, 'missing', analysts, { 'k-macro': 'cot' }, {});
        expect(result).toBe(prev);
    });
});