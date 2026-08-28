import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getRoleOverrides,
    setRoleOverride,
    clearRoleOverride,
    setRoleOverrides,
    subscribeRoleOverrides,
    resolveRole,
} from '../services/desk/roleOverrides';
import { roleForName } from '../components/desk/pixelAvatars';

const STORAGE_KEY = 'desk_role_overrides_v1';

describe('roleOverrides', () => {
    beforeEach(() => {
        if (typeof window !== 'undefined') window.localStorage.clear();
    });
    afterEach(() => {
        if (typeof window !== 'undefined') window.localStorage.clear();
    });

    it('starts empty when localStorage is empty', () => {
        expect(getRoleOverrides()).toEqual({});
    });

    it('setRoleOverride persists and notifies subscribers', () => {
        const cb = vi.fn();
        const unsubscribe = subscribeRoleOverrides(cb);
        setRoleOverride('Satoshi', 'risk');
        expect(getRoleOverrides()).toEqual({ Satoshi: 'risk' });
        expect(cb).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('clearRoleOverride removes a single mapping and notifies', () => {
        const cb = vi.fn();
        setRoleOverride('A', 'risk');
        setRoleOverride('B', 'macro');
        const unsubscribe = subscribeRoleOverrides(cb);
        clearRoleOverride('A');
        expect(getRoleOverrides()).toEqual({ B: 'macro' });
        expect(cb).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('setRoleOverrides replaces the whole table', () => {
        setRoleOverride('A', 'risk');
        setRoleOverrides({ X: 'technical', Y: 'sentiment' });
        expect(getRoleOverrides()).toEqual({ X: 'technical', Y: 'sentiment' });
    });

    it('ignores unknown role keys when parsing localStorage', () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            A: 'risk',
            B: 'totally-not-a-role',
            C: 42,
        }));
        expect(getRoleOverrides()).toEqual({ A: 'risk' });
    });

    it('returns an empty table when localStorage is corrupted JSON', () => {
        window.localStorage.setItem(STORAGE_KEY, 'not json');
        expect(getRoleOverrides()).toEqual({});
    });

    it('resolveRole honors overrides first, then the heuristic', () => {
        expect(resolveRole('Macro')).toBe('macro'); // heuristic
        expect(resolveRole('Satoshi')).toBe('unknown'); // heuristic default
        setRoleOverride('Satoshi', 'risk');
        expect(resolveRole('Satoshi')).toBe('risk');
        // The heuristic still works for an unmapped name.
        expect(resolveRole('Technical')).toBe('technical');
    });

    it('roleForName is unchanged (heuristic only)', () => {
        // Sanity: the heuristic is still exported and used as the fallback.
        expect(roleForName('Macro')).toBe('macro');
        expect(roleForName('Satoshi')).toBe('unknown');
    });

    it('subscribers can be added/removed without affecting others', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const off1 = subscribeRoleOverrides(cb1);
        subscribeRoleOverrides(cb2);
        setRoleOverride('A', 'risk');
        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
        off1();
        setRoleOverride('B', 'macro');
        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(2);
    });
});
