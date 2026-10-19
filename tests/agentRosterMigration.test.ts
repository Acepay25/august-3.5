/**
 * Migration for the owner's 2026-10-19 role removal: a stored bot row that still
 * carries `role` or `enabledTools` must be rewritten without them the first time
 * the roster is read — not merely tolerated by the type system.
 *
 * The gate here is the STORED BYTES, not the returned object: a getter that
 * filters on the way out would leave the profile carrying dead fields forever.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getBots, getGroups } from '../services/agents/agentRoster';
import { stripRemovedAppSettings } from '../services/infrastructure/legacySettings';

const USER = 'migration-user';
const KEY = `agents_bots_v1_${USER}`;
const GROUP_KEY = `agents_groups_v1_${USER}`;

const seed = (rows: unknown[]) => localStorage.setItem(KEY, JSON.stringify(rows));
const seedGroups = (rows: unknown[]) => localStorage.setItem(GROUP_KEY, JSON.stringify(rows));
const stored = (): Array<Record<string, unknown>> => JSON.parse(localStorage.getItem(KEY) || '[]');
const storedGroups = (): Array<Record<string, unknown>> => JSON.parse(localStorage.getItem(GROUP_KEY) || '[]');

describe('agentRoster migration — roles and tool presets are stripped from stored profiles', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('last_active_user', USER);
    });

    it('removes role + enabledTools from a legacy row and REWRITES the stored blob', () => {
        seed([{ id: 'b1', name: 'Macro', providerId: 'p1', modelId: 'm1', role: 'macro_volatility', enabledTools: ['get_btc_context'], createdAt: '2026-01-01' }]);
        const bots = getBots();
        expect(bots).toHaveLength(1);
        expect('role' in bots[0]).toBe(false);
        expect('enabledTools' in bots[0]).toBe(false);
        // the bytes on disk, not just the returned row
        const rows = stored();
        expect('role' in rows[0]).toBe(false);
        expect('enabledTools' in rows[0]).toBe(false);
        // nothing else was dropped by the rewrite
        expect(rows[0].name).toBe('Macro');
        expect(rows[0].providerId).toBe('p1');
    });

    it('leaves a clean row byte-identical (no rewrite when nothing to strip)', () => {
        const clean = [{ id: 'b2', name: 'Scout', providerId: 'p2', modelId: 'm2', avatar: { kind: 'auto' }, createdAt: '2026-01-02' }];
        seed(clean);
        const before = localStorage.getItem(KEY);
        expect(getBots()).toHaveLength(1);
        expect(localStorage.getItem(KEY)).toBe(before);
    });

    it('handles a mixed roster: only the legacy rows change, names and ids survive', () => {
        seed([
            { id: 'old', name: 'Legacy', role: 'risk_execution' },
            { id: 'new', name: 'Fresh' },
        ]);
        const bots = getBots();
        expect(bots.map((b) => b.id)).toEqual(['old', 'new']);
        const rows = stored();
        expect('role' in rows[0]).toBe(false);
        expect(rows.every((r) => !('role' in r))).toBe(true);
    });

    it('drops an unusable row instead of throwing inside the roster read', () => {
        // Raw localStorage is an unvalidated boundary: a foreign/corrupted
        // import can place null in the array, and `'role' in null` used to throw
        // from a useState initializer.
        seed([null, { id: 'keep', name: 'Keep' }, ['not', 'a', 'bot']]);
        let bots: Array<{ id: string }> = [];
        expect(() => { bots = getBots() as Array<{ id: string }>; }).not.toThrow();
        expect(bots.map(b => b.id)).toEqual(['keep']);
        expect(stored().map((r) => (r as { id?: string }).id)).toEqual(['keep']);
    });

    it('drops an unusable group row and rewrites the stored blob', () => {
        // Every stored group is dereferenced as `g.memberIds.length` by the rail;
        // a null/array row or a row without the array is the same crash class as
        // the null bot above.
        seedGroups([
            null,
            ['not', 'a', 'group'],
            { id: 'no-members' },
            { id: 'g1', memberIds: ['b1', null as unknown as string], createdAt: '2026-01-01' },
        ]);
        let groups: Array<{ id: string; memberIds: string[] }> = [];
        expect(() => { groups = getGroups() as Array<{ id: string; memberIds: string[] }>; }).not.toThrow();
        expect(groups.map(g => g.id)).toEqual(['g1']);
        expect(groups[0].memberIds).toEqual(['b1']);
        expect(storedGroups().map((r) => (r as { id?: string }).id)).toEqual(['g1']);
        expect((storedGroups()[0] as { memberIds: unknown[] }).memberIds).toEqual(['b1']);
    });
});

describe('legacy app-settings cleanup', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('last_active_user', USER);
    });

    it('removes the dead old roster key and the last moderator pick, and nothing else', async () => {
        localStorage.setItem(`bots_v1_${USER}`, JSON.stringify([{ id: 'old' }]));
        localStorage.setItem('last_moderator_pick_v1', 'p-1:model-1');
        localStorage.setItem('agents_bots_v1_keep', JSON.stringify([{ id: 'keep' }]));

        await stripRemovedAppSettings();

        expect(localStorage.getItem(`bots_v1_${USER}`)).toBeNull();
        expect(localStorage.getItem('last_moderator_pick_v1')).toBeNull();
        expect(localStorage.getItem('agents_bots_v1_keep')).not.toBeNull();
    });
});
