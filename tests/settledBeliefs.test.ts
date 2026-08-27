import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Preferences layer so initMemoryFiles runs in-memory.
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import {
    SETTLED_BELIEFS_FILE_NAME,
    parseSettledBeliefs,
    serializeSettledBeliefs,
    readSettledBeliefs,
    listActiveBeliefs,
    upsertSettledBelief,
    invalidateSettledBelief,
    settledBeliefsBlock,
    extractInvalidations,
    stripInvalidationLines,
} from '../services/learning/settledBeliefs';

const USERNAME = 'settled-beliefs-test';

const beliefsFileContent = (): string | undefined => {
    const { files, folders } = getMemoryFiles();
    const hosts = ['settled-beliefs', 'profile']
        .map(n => folders.find(f => f.name === n))
        .filter((f): f is NonNullable<typeof f> => Boolean(f));
    for (const folder of hosts) {
        const hit = files.find(f => f.folderId === folder.id && f.name === SETTLED_BELIEFS_FILE_NAME);
        if (hit) return hit.content;
    }
    return undefined;
};

describe('parseSettledBeliefs / serializeSettledBeliefs', () => {
    it('round-trips a belief with full metadata', () => {
        const content = [
            '## chase-extended-moves',
            'status: settled · added: 2026-08-01 · evidence: 7 · regime: compression',
            'I lose when I chase extended moves. Wait for the retest.',
        ].join('\n');
        const parsed = parseSettledBeliefs(content);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({
            slug: 'chase-extended-moves',
            status: 'settled',
            added: '2026-08-01',
            evidenceCount: 7,
            regime: 'compression',
        });
        expect(parsed[0].body).toContain('chase extended moves');
        const reserialized = serializeSettledBeliefs(parsed);
        expect(parseSettledBeliefs(reserialized)).toEqual(parsed);
    });

    it('parses invalidated beliefs with a reason', () => {
        const content = [
            '## fade-news-spikes',
            'status: invalidated · added: 2026-07-01 · evidence: 4 · reason: two CPI spikes followed through',
            'Fade news spikes.',
        ].join('\n');
        const parsed = parseSettledBeliefs(content);
        expect(parsed[0].status).toBe('invalidated');
        expect(parsed[0].invalidationReason).toBe('two CPI spikes followed through');
    });

    it('returns [] for empty content and ignores preamble', () => {
        expect(parseSettledBeliefs('')).toEqual([]);
        const parsed = parseSettledBeliefs('# Settled beliefs\nsome preamble\n## a\nstatus: settled\ntext');
        expect(parsed).toHaveLength(1);
        expect(parsed[0].slug).toBe('a');
    });
});

describe('upsert / invalidate / read', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('creates the file on first upsert and reads it back', async () => {
        await upsertSettledBelief(
            { slug: 'Wait For Retest!', body: 'I wait for the retest before entering.', evidenceCount: 6, regime: 'ranging' },
            USERNAME,
        );
        const beliefs = readSettledBeliefs();
        expect(beliefs).toHaveLength(1);
        expect(beliefs[0].slug).toBe('wait-for-retest');
        expect(beliefs[0].status).toBe('settled');
        expect(beliefs[0].evidenceCount).toBe(6);
        expect(beliefs[0].added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Persisted, not just cached.
        expect(beliefsFileContent()).toContain('## wait-for-retest');
    });

    it('upsert refreshes evidence/body but preserves the first-settled date', async () => {
        await upsertSettledBelief({ slug: 'a', body: 'first version', evidenceCount: 5 }, USERNAME);
        const addedBefore = readSettledBeliefs()[0].added;
        await upsertSettledBelief({ slug: 'a', body: 'second version', evidenceCount: 9 }, USERNAME);
        const [belief] = readSettledBeliefs();
        expect(belief.body).toBe('second version');
        expect(belief.evidenceCount).toBe(9);
        expect(belief.added).toBe(addedBefore);
    });

    it('invalidate flips status, keeps the belief for audit, and excludes it from active list', async () => {
        await upsertSettledBelief({ slug: 'b', body: 'some belief', evidenceCount: 5 }, USERNAME);
        expect(await invalidateSettledBelief('b', 'stopped holding in new evidence', USERNAME)).toBe(true);
        const all = readSettledBeliefs();
        expect(all).toHaveLength(1);
        expect(all[0].status).toBe('invalidated');
        expect(all[0].invalidationReason).toBe('stopped holding in new evidence');
        expect(listActiveBeliefs()).toHaveLength(0);
        // Invalidating again (or an unknown slug) is a no-op.
        expect(await invalidateSettledBelief('b', 'again', USERNAME)).toBe(false);
        expect(await invalidateSettledBelief('nope', 'x', USERNAME)).toBe(false);
    });

    it('skips empty bodies and slug-collides gracefully', async () => {
        await upsertSettledBelief({ slug: 'c', body: '   ', evidenceCount: 5 }, USERNAME);
        expect(readSettledBeliefs()).toHaveLength(0);
    });
});

describe('settledBeliefsBlock', () => {
    beforeEach(async () => {
        store = {};
        await initMemoryFiles(USERNAME);
    });

    it('returns "" with no beliefs and renders settled ones with evidence', async () => {
        expect(settledBeliefsBlock()).toBe('');
        await upsertSettledBelief({ slug: 'd', body: 'Never add to a losing scalp.', evidenceCount: 8, regime: 'trending' }, USERNAME);
        await upsertSettledBelief({ slug: 'e', body: 'Hidden one.', evidenceCount: 3 }, USERNAME);
        await invalidateSettledBelief('e', 'wrong', USERNAME);
        const block = settledBeliefsBlock();
        expect(block).toContain('SETTLED BELIEFS');
        expect(block).toContain('Never add to a losing scalp.');
        expect(block).toContain('evidence: 8');
        expect(block).toContain('trending');
        expect(block).not.toContain('Hidden one.');
    });

    it('truncates to the cap', async () => {
        for (let i = 0; i < 8; i++) {
            await upsertSettledBelief({ slug: `belief-${i}`, body: `Belief number ${i} with a reasonably long body.`, evidenceCount: 5 }, USERNAME);
        }
        const block = settledBeliefsBlock(200);
        expect(block.length).toBeLessThanOrEqual(202);
        expect(block.endsWith('…')).toBe(true);
    });
});

describe('extractInvalidations / stripInvalidationLines', () => {
    it('parses INVALIDATE directives (plain, bulleted, case-insensitive)', () => {
        const text = [
            '- I wait for retests.',
            'INVALIDATE chase-extended: three follow-through wins in a row',
            '* invalidate fade_news: stopped working after regime shift',
            'Some other line.',
        ].join('\n');
        const found = extractInvalidations(text);
        expect(found).toEqual([
            { slug: 'chase-extended', reason: 'three follow-through wins in a row' },
            { slug: 'fade_news', reason: 'stopped working after regime shift' },
        ]);
        const stripped = stripInvalidationLines(text);
        expect(stripped).toContain('I wait for retests.');
        expect(stripped).toContain('Some other line.');
        expect(stripped).not.toContain('INVALIDATE');
        expect(stripped).not.toContain('invalidate');
    });

    it('returns [] when there are no directives', () => {
        expect(extractInvalidations('just a doctrine\n- bullet')).toEqual([]);
        expect(stripInvalidationLines('just a doctrine')).toBe('just a doctrine');
    });
});
