import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import StatusBar from '../components/shell/StatusBar';
import { getHarnessSettings, saveHarnessSettings, subscribeHarnessSettings } from '../utils/harnessSettings';

/**
 * The 28px bar is the app's only always-on telemetry surface, so two things are
 * pinned here: that it reports what is TRUE (a gap reads as a gap, never 0%),
 * and that its density control is the shared setting rather than a second copy
 * — a toggle that only repaints itself is how a UI ends up showing a panel the
 * stored view says is resting.
 */

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

const mount = (over: Partial<React.ComponentProps<typeof StatusBar>> = {}) => render(
    <StatusBar
        modelLabel="step-3.7"
        contextPercent={41}
        contextWindowTokens={65536}
        supervisorAuto
        pendingApprovals={3}
        onOpenApprovals={vi.fn()}
        onOpenModels={vi.fn()}
        onOpenHealth={vi.fn()}
        {...over}
    />,
);

describe('the harness density setting', () => {
    it('ships on Focus, and only an explicit detail opens the telemetry', () => {
        expect(getHarnessSettings().viewDensity).toBe('focus');
        saveHarnessSettings({ viewDensity: 'detail' });
        expect(getHarnessSettings().viewDensity).toBe('detail');
        // A stored value that cannot be read back is a setting that does nothing.
        saveHarnessSettings({ viewDensity: 'nonsense' as never });
        expect(getHarnessSettings().viewDensity).toBe('focus');
    });

    it('notifies every subscriber on save, and unsubscribing stops it', () => {
        const seen: string[] = [];
        const off = subscribeHarnessSettings(next => seen.push(next.viewDensity));
        saveHarnessSettings({ viewDensity: 'detail' });
        saveHarnessSettings({ viewDensity: 'focus' });
        off();
        saveHarnessSettings({ viewDensity: 'detail' });
        expect(seen).toEqual(['detail', 'focus']);
    });
});

describe('the status bar', () => {
    it('shows the model, the context fill, the supervisor and what is waiting', () => {
        mount();
        expect(screen.getByTestId('status-model').textContent).toContain('step-3.7');
        expect(screen.getByTestId('status-context').textContent).toContain('41%');
        expect(screen.getByTestId('status-context').textContent).toContain('65,536');
        expect(screen.getByTestId('status-supervisor').textContent).toContain('auto');
        expect(screen.getByTestId('status-approvals').textContent).toContain('3 waiting');
    });

    it('renders no context percentage it cannot measure', () => {
        mount({ contextPercent: null, contextWindowTokens: null, modelLabel: null });
        expect(screen.queryByTestId('status-context')).toBeNull();
        // An unset provider is said plainly rather than shown as a blank slot.
        expect(screen.getByTestId('status-model').textContent).toBe('no model ready');
    });

    it('says nothing is waiting instead of hiding the slot and moving the bar', () => {
        mount({ pendingApprovals: 0 });
        expect(screen.queryByTestId('status-approvals')).toBeNull();
        expect(screen.getByTestId('status-approvals-empty').textContent).toContain('nothing waiting');
    });

    it('the waiting count goes to the inbox, and the supervisor readout goes to Health', () => {
        const onOpenApprovals = vi.fn();
        const onOpenHealth = vi.fn();
        mount({ onOpenApprovals, onOpenHealth });
        fireEvent.click(screen.getByTestId('status-approvals'));
        expect(onOpenApprovals).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('status-supervisor'));
        expect(onOpenHealth).toHaveBeenCalledTimes(1);
    });

    it('the density pair writes the shared setting, and reflects it', () => {
        mount();
        const detail = screen.getByTestId('status-density-detail');
        const focus = screen.getByTestId('status-density-focus');
        expect(focus.getAttribute('aria-pressed')).toBe('true');
        expect(detail.getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(detail);
        expect(getHarnessSettings().viewDensity).toBe('detail');
        // The bar repaints from the subscription, not from local optimism: a
        // control that only changes its own look is the duplicate-toggle bug.
        expect(screen.getByTestId('status-density-detail').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('status-density-focus').getAttribute('aria-pressed')).toBe('false');
    });

    it('the supervisor readout says paused when it is paused', () => {
        mount({ supervisorAuto: false });
        expect(screen.getByTestId('status-supervisor').textContent).toContain('paused');
    });
});
