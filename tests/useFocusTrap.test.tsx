/**
 * useFocusTrap — the audit-2026-09-15 keyboard-freeze fix:
 * an UNATTACHED trap used to preventDefault Tab document-wide (zero
 * focusables, container never rendered) — freezing the whole app's
 * keyboard while the modal was mounted. It must be inert instead.
 * Also covers DataCaptureModal (the offender: dialogRef returned but
 * never placed on the role=dialog div) actually wiring the trap.
 */

import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import DataCaptureModal from '../components/modals/DataCaptureModal';
import { TradeOutcome } from '../types';

// jsdom has no layout: every element's offsetParent is null, which the
// trap's visible-only filter would read as "nothing is focusable".
// Emulate layout so the attached-trap behavior tests are meaningful.
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get(this: HTMLElement): HTMLElement | null {
            return this.parentElement ?? null;
        },
    });
});

const TrapProbe: React.FC<{ attach: boolean }> = ({ attach }) => {
    const ref = useFocusTrap<HTMLDivElement>(true);
    return (
        <div ref={attach ? ref : undefined}>
            <button type="button">first</button>
            <button type="button">second</button>
        </div>
    );
};

const pressTab = (shift = false): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev;
};

describe('useFocusTrap', () => {
    it('is INERT when the ref is never attached — Tab is not prevented document-wide', () => {
        render(<TrapProbe attach={false} />);
        const ev = pressTab();
        expect(ev.defaultPrevented).toBe(false);
    });

    it('attached: traps the keyboard — Tab on the last focusable wraps to the first', async () => {
        render(<TrapProbe attach />);
        const first = screen.getByText('first');
        const second = screen.getByText('second');
        // The trap autofocuses the first focusable once mounted.
        await waitFor(() => expect(document.activeElement).toBe(first));
        second.focus();
        const ev = pressTab();
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
        // Shift+Tab on the first wraps back to the last.
        const ev2 = pressTab(true);
        expect(ev2.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(second);
    });
});

describe('DataCaptureModal focus-trap wiring', () => {
    it('puts the focus-trap ref on the role=dialog container', () => {
        render(
            <DataCaptureModal
                message={{ analysis: { coinName: 'BTCUSDT' } } as never}
                outcome={TradeOutcome.WIN}
                onClose={() => {}}
                onUploadScreenshot={() => {}}
                onAutoCapture={() => {}}
                onSkip={() => {}}
            />
        );
        const dialog = screen.getByRole('dialog');
        // tabIndex -1 marks the trap container (the hook focuses it when the
        // subtree has no tabbable elements); before the fix the ref was
        // never attached and Tab was frozen document-wide.
        expect(dialog.getAttribute('tabindex')).toBe('-1');
        expect(dialog.contains(screen.getByText('Auto-Capture & Log'))).toBe(true);
    });
});
