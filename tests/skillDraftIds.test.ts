/**
 * Legacy skill-draft ids.
 *
 * A draft's id used to be a bare `Date.now()`, so drafts that closed in the
 * same millisecond shared one. `takeSkillDraft` matches by id, which meant
 * supervising one deleted its twins without ingesting either, and a repeated
 * React key makes the queue render fewer rows than the store holds. The
 * generator was fixed in 55d36d4; these cover the rows written before it, which
 * still ship inside stored drafts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { listSkillDrafts, queueSkillDraft, takeSkillDraft } from '../utils/skillDrafts';

const USER = 'draft-ids-user';
const KEY = `skill_drafts_v1:${USER}`;

const crafted = (name: string) => ({
    name, kind: 'avoid', when: 'BTC reclaims the prior low',
    inputs: ['price'], steps: ['wait for the close'], validate: 'closed above',
    output: 'skip', approval: 'size changes',
    ifCondition: 'BTC sweeps the prior low and reclaims it',
    thenAction: 'Do not short — the failed sweep removes the edge',
});

const legacyDraft = (id: string, name: string) => ({
    id,
    tradeId: `t-${name}`,
    crafted: crafted(name),
    createdAt: '2026-09-18T12:15:24.234Z',
});

const seed = (rows: unknown[]): void => { localStorage.setItem(KEY, JSON.stringify(rows)); };

beforeEach(() => { localStorage.clear(); });

describe('repeated legacy draft ids', () => {
    it('get distinct identities while the first keeps its own', () => {
        seed([legacyDraft('sk-1', 'a'), legacyDraft('sk-1', 'b'), legacyDraft('sk-2', 'c')]);
        const ids = listSkillDrafts(USER).map(d => d.id);
        expect(ids).toEqual(['sk-1', 'sk-1#1', 'sk-2']);
        expect(new Set(ids).size).toBe(3);
    });

    it('are stable across reads, so an id a caller read still resolves', () => {
        seed([legacyDraft('sk-1', 'a'), legacyDraft('sk-1', 'b')]);
        expect(listSkillDrafts(USER).map(d => d.id))
            .toEqual(listSkillDrafts(USER).map(d => d.id));
    });

    it('leave the twin in the queue when one is taken', () => {
        seed([legacyDraft('sk-1', 'a'), legacyDraft('sk-1', 'b')]);
        expect(takeSkillDraft('sk-1', USER)?.crafted.name).toBe('a');
        expect(listSkillDrafts(USER).map(d => d.crafted.name)).toEqual(['b']);
    });

    it('heal into storage on the next write', () => {
        seed([legacyDraft('sk-1', 'a'), legacyDraft('sk-1', 'b')]);
        takeSkillDraft('sk-1', USER);
        expect(listSkillDrafts(USER).map(d => d.id)).toEqual(['sk-1#1']);
    });

    it('new drafts never share an id', () => {
        const a = queueSkillDraft({ tradeId: 't-a', crafted: crafted('a') } as never, USER);
        const b = queueSkillDraft({ tradeId: 't-b', crafted: crafted('b') } as never, USER);
        expect(a.id).not.toBe(b.id);
    });
});
