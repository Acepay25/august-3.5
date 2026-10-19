/**
 * Migration for the owner's 2026-10-19 role removal: a stored bot row that still
 * carries `role` or `enabledTools` must be rewritten without them the first time
 * the roster is read — not merely tolerated by the type system.
 *
 * The gate here is the STORED BYTES, not the returned object: a getter that
 * filters on the way out would leave the profile carrying dead fields forever.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getBots } from '../services/agents/agentRoster';

const USER = 'migration-user';
const KEY = `agents_bots_v1_${USER}`;

const seed = (rows: unknown[]) => localStorage.setItem(KEY, JSON.stringify(rows));
const stored = (): Array<Record<string, unknown>> => JSON.parse(localStorage.getItem(KEY) || '[]');

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
});
