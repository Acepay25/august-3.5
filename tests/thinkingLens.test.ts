import { describe, expect, it } from 'vitest';
import { AnalystRole } from '../types/enums';
import { ThinkingRecord } from '../types/thinking';
import {
    isModeratorThinking,
    lensFromAnalystRole,
    lensFromSpeakerName,
    resolveAnalystLens,
} from '../utils/thinkingLens';

const record = (overrides: Partial<ThinkingRecord>): ThinkingRecord => ({
    id: 't1',
    tradeId: 'trade-1',
    username: 'u',
    provider: 'openai:gpt-4o',
    role: 'analyst',
    reasoning: 'cot',
    createdAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
});

describe('lensFromAnalystRole', () => {
    it('maps the three accuracy roles when lenses are on', () => {
        expect(lensFromAnalystRole(AnalystRole.MACRO_VOLATILITY, true)).toBe('macro');
        expect(lensFromAnalystRole(AnalystRole.TECHNICAL_ANALYST, true)).toBe('technical');
        expect(lensFromAnalystRole(AnalystRole.RISK_EXECUTION, true)).toBe('risk');
    });

    it('files every model under normal when lenses are off', () => {
        expect(lensFromAnalystRole(AnalystRole.MACRO_VOLATILITY, false)).toBe('normal');
        expect(lensFromAnalystRole(AnalystRole.TECHNICAL_ANALYST, false)).toBe('normal');
        expect(lensFromAnalystRole(AnalystRole.UNASSIGNED, false)).toBe('normal');
    });
});

describe('lensFromSpeakerName', () => {
    it('reads Macro / Technical / Risk from analyst display names', () => {
        expect(lensFromSpeakerName('Macro & Volatility Analyst')).toBe('macro');
        expect(lensFromSpeakerName('Technical Analyst')).toBe('technical');
        expect(lensFromSpeakerName('Risk & Execution Specialist')).toBe('risk');
    });

    it('returns null for generic provider names', () => {
        expect(lensFromSpeakerName('OpenAI · gpt-4o')).toBeNull();
        expect(lensFromSpeakerName('Moderator')).toBeNull();
    });
});

describe('resolveAnalystLens', () => {
    it('prefers the stored analystLens field', () => {
        expect(resolveAnalystLens(record({ analystLens: 'risk', debateTurnSpeaker: 'Macro Analyst' }))).toBe('risk');
    });

    it('infers from debate speaker names on legacy records', () => {
        expect(resolveAnalystLens(record({
            role: 'debate_turn',
            debateTurnSpeaker: 'Macro & Volatility Analyst',
        }))).toBe('macro');
    });

    it('falls back to normal for unlabelled models', () => {
        expect(resolveAnalystLens(record({ provider: 'openai:gpt-4o' }))).toBe('normal');
    });
});

describe('isModeratorThinking', () => {
    it('detects moderator role and speaker', () => {
        expect(isModeratorThinking(record({ role: 'moderator', provider: 'moderator' }))).toBe(true);
        expect(isModeratorThinking(record({ role: 'debate_turn', debateTurnSpeaker: 'Moderator', provider: 'moderator' }))).toBe(true);
        expect(isModeratorThinking(record({ role: 'analyst' }))).toBe(false);
    });
});
