/**
 * Stateful desk tools must NEVER be served from the 30s result cache, and a
 * refusal must be an honest error result. This suite pins the exact failure
 * from 2026-09-14's transcript: `write_memory_note` reported "saved", the
 * next `get_notebook_map` replayed the PRE-WRITE cached map, the model
 * retracted a write that had actually landed, and re-saved it under a new
 * name (duplicate) — while `recall` structurally couldn't see notebook notes
 * at all, and `revise_skill` rejections rode ok:true receipts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'test-user',
}));
// The provider layer must not be reachable from read paths (doctrine render).
vi.mock('../services/providers/GenericProviderService', () => ({
    getQuickResponse: vi.fn(async () => ''),
    sendChatRequest: vi.fn(async () => ''),
}));

import { executeDeskTool, clearDeskToolCache } from '../services/analysis/DeskToolsService';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { queueSkillDraft } from '../utils/skillDrafts';

beforeEach(async () => {
    localStorage.clear();
    store = {};
    clearDeskToolCache();
    await initMemoryFiles('test-user');
});

const call = (id: string, name: string, args: Record<string, unknown> = {}) =>
    executeDeskTool({ id, name, arguments: args });

describe('notebook read-your-writes (cache policy)', () => {
    it('get_notebook_map shows a note written moments before — no cached stale replay', async () => {
        const before = await call('m1', 'get_notebook_map');
        expect(before.ok).toBe(true);
        expect(before.content).not.toContain('ethusdt-range-fade-stop-and-tp-design');

        const write = await call('w1', 'write_memory_note', {
            folder: 'lessons',
            file_name: 'ethusdt-range-fade-stop-and-tp-design',
            content: 'Stop sat outside the 4h cloud floor; TP overshot the proven 2534 ceiling.',
        });
        expect(write.ok).toBe(true);
        expect(write.content).toContain('"saved":true');

        // Same call, same arguments, same instant — this is exactly what the
        // old TTL cache poisoned with the pre-write map.
        const after = await call('m2', 'get_notebook_map');
        expect(after.content).toContain('ethusdt-range-fade-stop-and-tp-design');
    });

    it('recall finds the written note (the lessons tier the description promises)', async () => {
        await call('w1', 'write_memory_note', {
            folder: 'lessons',
            file_name: 'ethusdt-range-fade-stops',
            content: 'Range fades: stop below the cloud floor, TP at the proven ceiling only.',
        });
        const res = await call('r1', 'recall', { topic: 'ETH range fade stop' });
        expect(res.content).toContain('NOTE lessons/ethusdt-range-fade-stops.md');
    });

    it('a re-issued identical write RUNS (folds via append) — never replays a cached receipt', async () => {
        const args = {
            folder: 'lessons',
            file_name: 'funding-exhaustion',
            content: 'Fade funding > 0.1% only after a reclaim fails twice.',
        };
        const first = await call('w1', 'write_memory_note', args);
        const second = await call('w2', 'write_memory_note', args);
        // No name-2.md duplicate: decision:'append' folds into the same file.
        expect(first.content).toContain('"file":"funding-exhaustion.md"');
        expect(second.content).toContain('"file":"funding-exhaustion.md"');
        const files = getMemoryFiles().files.filter(f => f.name === 'funding-exhaustion.md');
        expect(files).toHaveLength(1);
        // The append path ran (second copy of the sentence rides the file).
        const hits = files[0].content.split('reclaim fails twice').length - 1;
        expect(hits).toBeGreaterThanOrEqual(2);
    });
});

describe('write-side refusals are error results', () => {
    it('write_memory_note into a harness-owned folder → ok:false, "rejected:" prefix', async () => {
        const res = await call('w1', 'write_memory_note', {
            folder: 'trader-diary',
            file_name: 'my-note',
            content: 'anything',
        });
        expect(res.ok).toBe(false);
        expect(res.content.startsWith('write_memory_note rejected:')).toBe(true);
    });

    it('revise_skill on an unknown slug → ok:false', async () => {
        const res = await call('r1', 'revise_skill', {
            skill_slug: 'no-such-skill',
            reason: 'tighten the trigger',
        });
        expect(res.ok).toBe(false);
        expect(res.content.startsWith('revise_skill rejected:')).toBe(true);
        expect(res.content).toContain('no-such-skill');
    });

    it('revise_skill on a PENDING DRAFT says so — drafts cannot be revised', async () => {
        queueSkillDraft({
            tradeId: 'chat-test',
            coin: 'ETH',
            crafted: { name: 'Book Range Fade Boundaries' } as never,
        }, 'test-user');
        const res = await call('r1', 'revise_skill', {
            skill_slug: 'book-range-fade-boundaries',
            reason: 'fold in the stop/TP lesson',
        });
        expect(res.ok).toBe(false);
        expect(res.content).toContain('PENDING DRAFT');
    });

    it('remember with an invalid kind → ok:false (and re-issuing runs again, uncached)', async () => {
        const res = await call('m1', 'remember', { kind: 'vibes', description: 'd', body: 'b' });
        expect(res.ok).toBe(false);
        expect(res.content.startsWith('remember rejected:')).toBe(true);
    });
});
