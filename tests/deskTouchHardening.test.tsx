import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { DeskScene } from '../components/desk/DeskScene';
import type { DebateStageActor } from '../components/analysis/DebateStage';

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as any;
    }
});

afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined') window.localStorage.clear();
});

const actor = (over: Partial<DebateStageActor>): DebateStageActor => ({
    id: 'macro', name: 'Macro', ...over,
});

describe('DeskScene — touch drag hardening', () => {
    it('adds a non-passive touchstart listener on the floor while editRoom is on', () => {
        // jsdom doesn't support the third arg of addEventListener
        // (the options object) for `passive` precisely, but the
        // capture / passive options ARE recorded on the event itself.
        // We verify the listener is attached and the third arg is
        // `{ passive: false }` by spying on addEventListener.
        const original = HTMLElement.prototype.addEventListener;
        type Call = [string, EventListenerOrEventListenerObject, AddEventListenerOptions | boolean | undefined];
        const calls: Call[] = [];
        const patched = function (
            this: HTMLElement,
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: AddEventListenerOptions | boolean,
        ): void {
            if (type === 'touchstart') calls.push([type, listener, options]);
            return original.call(this, type, listener, options);
        } as typeof HTMLElement.prototype.addEventListener;
        HTMLElement.prototype.addEventListener = patched;

        try {
            render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
            // editRoom is off: no non-passive touchstart expected.
            const beforeEdit = calls.filter(c => c[2] && typeof c[2] === 'object' && (c[2] as { passive?: boolean }).passive === false);
            expect(beforeEdit).toHaveLength(0);
            // Enter edit mode.
            fireEvent.click(screen.getByTestId('desk-edit-room'));
            const afterEdit = calls.filter(c => c[2] && typeof c[2] === 'object' && (c[2] as { passive?: boolean }).passive === false);
            expect(afterEdit.length).toBeGreaterThan(0);
        } finally {
            HTMLElement.prototype.addEventListener = original;
        }
    });

    it('the floor sets touchAction=none while editRoom is on (CSS hardens touch)', () => {
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        const floor = screen.getByTestId('desk-floor');
        // Initial: touchAction=auto.
        expect((floor as HTMLElement).style.touchAction).toBe('auto');
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        // After enabling edit room: touchAction=none.
        expect((floor as HTMLElement).style.touchAction).toBe('none');
    });
});
