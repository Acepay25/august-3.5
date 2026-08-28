import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getIdleMotionEnabled,
    setIdleMotionEnabled,
    subscribeIdleMotion,
    reapplyIdleMotionClass,
} from '../services/desk/idleMotion';

beforeEach(() => {
    if (typeof window !== 'undefined') {
        window.localStorage.clear();
        window.localStorage.setItem('last_active_user', 'default');
        document.body.classList.remove('desk-idle-motion-off');
    }
});

afterEach(() => {
    if (typeof window !== 'undefined') {
        window.localStorage.clear();
        window.localStorage.setItem('last_active_user', 'default');
        document.body.classList.remove('desk-idle-motion-off');
    }
});

describe('idleMotion', () => {
    it('defaults to enabled when localStorage is empty', () => {
        expect(getIdleMotionEnabled()).toBe(true);
    });

    it('setIdleMotionEnabled(false) persists and notifies', () => {
        const cb = vi.fn();
        const off = subscribeIdleMotion(cb);
        setIdleMotionEnabled(false);
        expect(getIdleMotionEnabled()).toBe(false);
        expect(cb).toHaveBeenCalledWith(false);
        off();
    });

    it('setIdleMotionEnabled(true) re-enables and clears the body class', () => {
        setIdleMotionEnabled(false);
        expect(document.body.classList.contains('desk-idle-motion-off')).toBe(true);
        setIdleMotionEnabled(true);
        expect(document.body.classList.contains('desk-idle-motion-off')).toBe(false);
    });

    it('reapplyIdleMotionClass reads the persisted value and applies the body class', () => {
        // Pre-seed a disabled value in localStorage.
        window.localStorage.setItem('desk_idle_motion_v1_default', '0');
        reapplyIdleMotionClass();
        expect(document.body.classList.contains('desk-idle-motion-off')).toBe(true);
        // Now flip to enabled and re-apply.
        window.localStorage.setItem('desk_idle_motion_v1_default', '1');
        reapplyIdleMotionClass();
        expect(document.body.classList.contains('desk-idle-motion-off')).toBe(false);
    });

    it('isolates the preference per active user', () => {
        setIdleMotionEnabled(false);
        expect(getIdleMotionEnabled()).toBe(false);
        window.localStorage.setItem('last_active_user', 'alice');
        // Alice has no entry → default true.
        expect(getIdleMotionEnabled()).toBe(true);
        window.localStorage.setItem('last_active_user', 'default');
        // Default's persisted false is still there.
        expect(getIdleMotionEnabled()).toBe(false);
    });

    it('rejects non-boolean strings (anything other than "0"/"false" is truthy)', () => {
        window.localStorage.setItem('desk_idle_motion_v1_default', 'no');
        expect(getIdleMotionEnabled()).toBe(true);
    });
});
