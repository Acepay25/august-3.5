/**
 * E-18 — the outcome loop closes without a human click, but stays reversible
 * and provenanced.
 *
 * The autopilot already detected outcomes; the write waited on
 * `handleConfirmAutopilot`. This drives the REAL subscription hook with a fake
 * clock, so the only way the assertions pass is for the settlement decision to
 * actually schedule (or refuse) the write.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { settlementActionFor, SETTLEMENT_UNDO_MS } from '../utils/outcomeSettlement';
import { saveHarnessSettings } from '../utils/harnessSettings';
import type { AutopilotResolution } from '../services/ui/OutcomeAutopilotService';
import { TradeOutcome } from '../types/enums';

const subscriber = vi.hoisted(() => ({ fn: null as null | ((id: string, r: AutopilotResolution) => void) }));
vi.mock('../services/ui/OutcomeAutopilotService', () => ({
    OutcomeAutopilotService: {
        subscribe: (fn: (id: string, r: AutopilotResolution) => void) => { subscriber.fn = fn; return () => { subscriber.fn = null; }; },
        subscribeTicks: () => () => {},
    },
}));
const policy = vi.hoisted(() => ({ value: 'ask' as 'ask' | 'always' | 'deny' }));
vi.mock('../utils/approvalInbox', () => ({
    autoJournalPolicyFor: () => policy.value,
}));

import { useWatchSideEffects } from '../hooks/useWatchSideEffects';

const resolution = (over: Partial<AutopilotResolution> = {}): AutopilotResolution => ({
    outcome: TradeOutcome.WIN,
    expiredOpen: false,
    detail: 'TP1 hit',
    detectedAt: new Date().toISOString(),
    ...over,
});

const render = (watched: boolean) => {
    const confirmAutopilot = { current: vi.fn() };
    const toast = { success: vi.fn(), warning: vi.fn() };
    const hook = renderHook(() => useWatchSideEffects({
        messagesRef: {
            current: [{
                id: 'm1',
                role: 'ai',
                text: '',
                createdAt: new Date().toISOString(),
                watched,
                analysis: { coinName: 'BTCUSDT' },
            }],
        } as never,
        setConversationHistory: vi.fn(),
        setAutopilotResolutions: vi.fn(),
        toast,
        confirmAutopilot: confirmAutopilot as never,
        activeUsername: 'e18',
    }));
    return { ...hook, confirmAutopilot, toast };
};

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    policy.value = 'ask';
    subscriber.fn = null;
    saveHarnessSettings({ outcomeSettlement: 'automatic' });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the settlement table', () => {
    it('an explicit deny wins over every global mode', () => {
        expect(settlementActionFor({ watched: true, policy: 'deny', settlement: 'automatic', expiredOpen: false })).toBe('ignore');
        expect(settlementActionFor({ watched: false, policy: 'deny', settlement: 'shadow', expiredOpen: false })).toBe('ignore');
    });

    it('an explicit always logs now', () => {
        expect(settlementActionFor({ watched: false, policy: 'always', settlement: 'confirm', expiredOpen: false })).toBe('log-now');
    });

    it('shadow never records, confirm waits, automatic takes the undo window', () => {
        expect(settlementActionFor({ watched: true, policy: 'ask', settlement: 'shadow', expiredOpen: false })).toBe('shadow');
        expect(settlementActionFor({ watched: true, policy: 'ask', settlement: 'confirm', expiredOpen: false })).toBe('notify-only');
        expect(settlementActionFor({ watched: false, policy: 'ask', settlement: 'automatic', expiredOpen: false })).toBe('log-after-undo');
    });

    it('expired-while-open is never auto-recorded', () => {
        expect(settlementActionFor({ watched: true, policy: 'always', settlement: 'automatic', expiredOpen: true })).toBe('notify-only');
    });
});

describe('the hook performs the action', () => {
    it('automatic records a NON-watched resolution after the undo window (the loop closes)', () => {
        const { confirmAutopilot, toast } = render(false);
        act(() => { subscriber.fn?.('m1', resolution()); });
        expect(confirmAutopilot.current).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Logging in 15s', expect.any(String), expect.any(Object));
        act(() => { vi.advanceTimersByTime(SETTLEMENT_UNDO_MS); });
        expect(confirmAutopilot.current).toHaveBeenCalledWith('m1');
    });

    it('Undo cancels the pending write', () => {
        const { confirmAutopilot, toast } = render(false);
        act(() => { subscriber.fn?.('m1', resolution()); });
        const undo = toast.success.mock.calls[0][2] as { onClick: () => void };
        act(() => { undo.onClick(); vi.advanceTimersByTime(SETTLEMENT_UNDO_MS * 2); });
        expect(confirmAutopilot.current).not.toHaveBeenCalled();
    });

    it('shadow shows the result and never writes', () => {
        saveHarnessSettings({ outcomeSettlement: 'shadow' });
        const { confirmAutopilot, toast } = render(false);
        act(() => { subscriber.fn?.('m1', resolution()); });
        act(() => { vi.advanceTimersByTime(SETTLEMENT_UNDO_MS * 2); });
        expect(confirmAutopilot.current).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Shadow: outcome detected (not recorded)', expect.stringContaining('shadow'));
    });

    it('confirm waits for the trader', () => {
        saveHarnessSettings({ outcomeSettlement: 'confirm' });
        const { confirmAutopilot } = render(true);
        act(() => { subscriber.fn?.('m1', resolution()); });
        act(() => { vi.advanceTimersByTime(SETTLEMENT_UNDO_MS * 2); });
        expect(confirmAutopilot.current).not.toHaveBeenCalled();
    });

    it('a per-coin deny still holds even in automatic mode', () => {
        policy.value = 'deny';
        const { confirmAutopilot } = render(false);
        act(() => { subscriber.fn?.('m1', resolution()); });
        act(() => { vi.advanceTimersByTime(SETTLEMENT_UNDO_MS * 2); });
        expect(confirmAutopilot.current).not.toHaveBeenCalled();
    });
});
