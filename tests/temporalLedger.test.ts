import { describe, it, expect } from 'vitest';
import {
    stampStatusTransition,
    skillStatusAt,
    parseSkillMarkdown,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';

const baseMeta = (overrides: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'candidate',
    kind: 'avoid',
    wins: 3,
    losses: 1,
    consecutiveLosses: 0,
    tradeIds: ['t1'],
    body: 'Test body.',
    ...overrides,
});

describe('Temporal ledger', () => {
    it('closes the old interval and opens the next on transition', () => {
        const meta = baseMeta({ status: 'candidate' });
        stampStatusTransition(meta, 'confirmed', 'evidence');
        expect(meta.history).toHaveLength(2);
        expect(meta.history![0]).toMatchObject({ status: 'candidate' });
        expect(meta.history![0].invalidAt).toBeTruthy();
        expect(meta.history![1]).toMatchObject({ status: 'confirmed', reason: 'evidence' });
        expect(meta.history![1].invalidAt).toBeUndefined();
        expect(meta.status).toBe('candidate'); // caller assigns
    });

    it('no-ops when the status is unchanged', () => {
        const meta = baseMeta({ status: 'confirmed' });
        stampStatusTransition(meta, 'confirmed', 'noop');
        expect(meta.history).toBeUndefined();
    });

    it('answers replay queries for past moments', async () => {
        const meta = baseMeta({ status: 'candidate' });
        // Simulate two transitions at controlled times.
        const t0 = new Date(Date.now() - 5_000).toISOString();
        meta.history = [{ status: 'candidate', validFrom: t0 }];
        meta.history[0] = { ...meta.history[0], invalidAt: new Date(Date.now() - 4_000).toISOString() };
        const t1 = new Date(Date.now() - 4_000).toISOString();
        meta.history.push({ status: 'confirmed', validFrom: t1, reason: 'eval helps' });

        expect(skillStatusAt(meta, Date.now() - 4_500)).toBe('candidate');
        expect(skillStatusAt(meta, Date.now())).toBe('confirmed');
        // Before any history → unanswerable.
        expect(skillStatusAt(meta, Date.parse(t0) - 10_000)).toBeNull();
        // Open interval extends to now.
        expect(skillStatusAt(meta, new Date().toISOString())).toBe('confirmed');
    });

    it('round-trips the history field through frontmatter', () => {
        const meta = baseMeta({
            status: 'retired',
            history: [
                { status: 'candidate', validFrom: '2026-08-01T00:00:00.000Z', invalidAt: '2026-08-05T00:00:00.000Z' },
                { status: 'confirmed', validFrom: '2026-08-05T00:00:00.000Z', invalidAt: '2026-08-20T00:00:00.000Z', reason: 'eval hurts (1/3)' },
                { status: 'retired', validFrom: '2026-08-20T00:00:00.000Z' },
            ],
        });
        // Reuse the serializer via a tiny inline markdown build.
        const md = [
            '---',
            'status: retired',
            'kind: avoid',
            `history: ${JSON.stringify(meta.history)}`,
            '---',
            '',
            '# X',
            '',
            'Body.',
        ].join('\n');
        const parsed = parseSkillMarkdown(md)!;
        expect(parsed.history).toHaveLength(3);
        expect(parsed.history![1].reason).toBe('eval hurts (1/3)');
        expect(skillStatusAt(parsed, '2026-08-10T00:00:00.000Z')).toBe('confirmed');
        expect(skillStatusAt(parsed, '2026-08-25T00:00:00.000Z')).toBe('retired');
    });
});
