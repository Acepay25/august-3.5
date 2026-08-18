import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown, serializeSkill, SkillMeta } from '../services/learning/SkillMemoryService';

const baseMeta = (overrides: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'confirmed',
    kind: 'avoid',
    coin: 'BTC',
    direction: 'Long',
    wins: 3,
    losses: 4,
    consecutiveLosses: 0,
    tradeIds: ['t1', 't2'],
    ifCondition: 'price is extended above the 1h 200EMA',
    thenAction: 'wait for a reclaim before entering',
    body: '**Trigger:** BTC Long\n**Procedure:** wait for reclaim',
    ...overrides,
});

describe('skill refinement evidence (previousVersion round-trip)', () => {
    it('serializes and re-parses refinedAt + previousVersion', () => {
        const meta = baseMeta({
            refinedAt: '2026-08-18T10:00:00.000Z',
            previousVersion: {
                kind: 'avoid',
                ifCondition: 'price is extended',
                thenAction: 'skip the trade',
            },
        });
        const content = serializeSkill(meta, 'Avoid BTC Long');
        expect(content).toContain('refinedAt: 2026-08-18T10:00:00.000Z');
        expect(content).toContain('previousVersion:');

        const parsed = parseSkillMarkdown(content);
        expect(parsed).not.toBeNull();
        expect(parsed?.refinedAt).toBe('2026-08-18T10:00:00.000Z');
        expect(parsed?.previousVersion?.kind).toBe('avoid');
        expect(parsed?.previousVersion?.ifCondition).toBe('price is extended');
        expect(parsed?.previousVersion?.thenAction).toBe('skip the trade');
        // Current clauses survive alongside the snapshot.
        expect(parsed?.ifCondition).toBe('price is extended above the 1h 200EMA');
        expect(parsed?.thenAction).toBe('wait for a reclaim before entering');
    });

    it('omits the fields when the skill was never refined', () => {
        const content = serializeSkill(baseMeta(), 'Avoid BTC Long');
        expect(content).not.toContain('refinedAt');
        expect(content).not.toContain('previousVersion');
        const parsed = parseSkillMarkdown(content);
        expect(parsed?.refinedAt).toBeUndefined();
        expect(parsed?.previousVersion).toBeUndefined();
    });

    it('tolerates a corrupt previousVersion JSON blob', () => {
        const content = [
            '---',
            'status: confirmed',
            'kind: avoid',
            'wins: 1',
            'losses: 1',
            'previousVersion: {not-json',
            'tradeIds: t1',
            '---',
            '',
            '# Skill',
            'body',
        ].join('\n');
        const parsed = parseSkillMarkdown(content);
        expect(parsed).not.toBeNull();
        expect(parsed?.previousVersion).toBeUndefined();
        expect(parsed?.status).toBe('confirmed');
    });
});
